const express = require('express');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { execFile } = require('child_process');
const LyricsManager = require('../../LyricsManager');
const { demucsBreaker, getCachedKaraoke, runDemucsWithFallback } = require('../../resilience/demucs-breaker');
const { recordKaraokeJobDuration } = require('../../observability/metrics');

const router = express.Router();
const STEMS_DIR = path.join(__dirname, '..', '..', '..', 'audio_cache', 'stems');
const karaokeJobs = new Map();

const { optionalAuth } = require('../../auth/middleware');

if (!fs.existsSync(STEMS_DIR)) {
    fs.mkdirSync(STEMS_DIR, { recursive: true });
}

const getFormattedPitchMap = (outputDir) => {
    const quantizedPath = path.join(outputDir, 'pitch_quantized.json');
    let quantizedBlocks = [];
    try {
        quantizedBlocks = JSON.parse(fs.readFileSync(quantizedPath, 'utf-8'));
    } catch (_) {
        const pitchMapPath = path.join(outputDir, 'pitch_map.json');
        let rawPitchMap = [];
        try {
            rawPitchMap = JSON.parse(fs.readFileSync(pitchMapPath, 'utf-8'));
        } catch (__) {}
        return rawPitchMap.map(f => {
            const freq = f.freq;
            const midi = freq > 0 ? Math.round(12 * Math.log2(freq / 440) + 69) : 0;
            return {
                timeMs: Math.round(f.time * 1000),
                midi: midi
            };
        });
    }

    const frames = [];
    for (const block of quantizedBlocks) {
        const startMs = Math.round(block.start * 1000);
        const durationMs = Math.round(block.duration * 1000);
        const endMs = startMs + durationMs;
        for (let t = startMs; t < endMs; t += 100) {
            frames.push({
                timeMs: t,
                midi: block.note
            });
        }
    }
    return frames;
};

module.exports = (client, requirePermission) => {
    const { karaokeLimiter } = require('../../auth/rate-limit');

    const extractYtVideoId = (url) => {
        if (!url) return 'unknown';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : 'unknown';
    };

    const cleanMetadata = (str) => {
        if (!str) return "";
        let cleaned = str;
        cleaned = cleaned.replace(/\(.*?\)|\[.*?\]|【.*?】/g, ' ');
        cleaned = cleaned.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
        cleaned = cleaned.replace(/\b(MV|Lyrics|High Quality|HD|Official|Video|Audio|4K|Remastered|Topic|Records|Channel)\b/gi, ' ');
        cleaned = cleaned.split(/[-—|]/)[0];
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        const duplicateRegex = /^(.+?)(?:\s+\1)+$/i;
        const match = cleaned.match(duplicateRegex);
        if (match) {
            cleaned = match[1];
        }
        return cleaned.trim();
    };

    router.post('/music/lyrics', requirePermission('karaoke', 'read'), async (req, res) => {
        let { title, artist, trackUrl, forceResync } = req.body;
        const videoId = extractYtVideoId(trackUrl || '');

        if (title && title.includes(" - ")) {
            const parts = title.split(" - ");
            artist = parts[0];
            title = parts[1];
        }

        const cleanTitle = cleanMetadata(title);
        const cleanArtist = cleanMetadata(artist);

        const targetTrack = {
            title,
            artist,
            url: trackUrl,
            duration: req.body.duration || 0,
            durationMs: req.body.durationMs || 0
        };

        let matchedPlayer = null;
        const players = Array.from(client.players.values());
        for (const p of players) {
            if (p.currentTrack && (p.currentTrack.title === title || p.currentTrack.url === trackUrl)) {
                targetTrack.duration = p.currentTrack.duration;
                targetTrack.durationMs = p.currentTrack.durationMs || (p.currentTrack.duration * 1000);
                matchedPlayer = p;
                break;
            }
        }

        console.log(chalk.cyan(`🔍 [LyricsManager] Starting fetchLyrics for title: "${title}", artist: "${artist}", platform: "youtube", id: "${videoId}"`));
        const payload = await LyricsManager.fetchLyrics(targetTrack, forceResync);

        if (payload) {
            if (matchedPlayer) {
                matchedPlayer.currentLyrics = payload;
                if (matchedPlayer.currentTrack) {
                    matchedPlayer.currentTrack.lyrics = {
                        synced: payload.synced,
                        plain: payload.plain,
                        hasSynced: payload.hasSynced,
                        source: payload.source
                    };
                }
                if (typeof matchedPlayer.broadcastStateUpdate === 'function') {
                    matchedPlayer.broadcastStateUpdate();
                }
            }
            return res.json(payload);
        }

        console.log(chalk.red(`⚠️ [LyricsManager] No lyrics resolved from any source.`));
        return res.json({
            title: cleanTitle,
            artist: cleanArtist,
            source: "None",
            synced: "",
            plain: "",
            hasSynced: false,
            lines: []
        });
    });

    const karaokePrepareHandler = async (req, res) => {
        const startTime = Date.now();
        try {
            const player = client.players.first();
            const trackUrl = req.body.trackUrl || player?.currentTrack?.url;

            if (!trackUrl) {
                return res.status(400).json({ error: 'No track URL provided and no track is currently playing' });
            }

            const track = player?.currentTrack && player.currentTrack.url === trackUrl ? player.currentTrack : { title: 'Unknown', artist: 'Unknown', url: trackUrl };

            const trackHash = require('crypto').createHash('md5').update(trackUrl).digest('hex');
            const outputDir = path.join(STEMS_DIR, trackHash);
            const doneMarker = path.join(outputDir, '.done');

            if (fs.existsSync(doneMarker)) {
                const frames = getFormattedPitchMap(outputDir);
                return res.json({
                    status: 'ready',
                    jobId: trackHash,
                    stems: {
                        vocals: `/karaoke/stems/${trackHash}/vocals.wav`,
                        instrumental: `/karaoke/stems/${trackHash}/no_vocals.wav`
                    },
                    frames: frames,
                    pitchMap: {
                        title: track.title,
                        artist: track.artist,
                        frames: frames
                    }
                });
            }

            if (karaokeJobs.has(trackHash) && karaokeJobs.get(trackHash).status === 'processing') {
                return res.json({ status: 'processing', jobId: trackHash });
            }

            const audioHash = require('crypto').createHash('md5').update(trackUrl).digest('hex');
            const audioFile = path.join(__dirname, '..', '..', '..', 'audio_cache', `track_${audioHash}.opus`);

            if (!fs.existsSync(audioFile)) {
                return res.status(400).json({
                    error: 'Track audio not cached yet. Play the track first so it downloads, then retry.'
                });
            }

            karaokeJobs.set(trackHash, { status: 'processing', outputDir });
            fs.mkdirSync(outputDir, { recursive: true });

            const pythonScript = path.join(__dirname, '..', '..', '..', 'scripts', 'karaoke_worker.py');

            console.log(chalk.magenta(`🎤 [KARAOKE] Starting pitch extraction for: ${audioFile}`));

            // Run Demucs with circuit breaker and fallback
            const job = { trackHash, audioFile, outputDir, pythonScript };
            const result = await runDemucsWithFallback(job);

            const duration = (Date.now() - startTime) / 1000;
            recordKaraokeJobDuration(duration);

            if (result.status === 'ready') {
                karaokeJobs.set(trackHash, { status: 'ready', outputDir: result.outputDir });
                console.log(chalk.green(`✅ [KARAOKE] Pitch map generated successfully! (and stems separated) for ${trackHash}`));
            } else if (result.status === 'error') {
                karaokeJobs.set(trackHash, { status: 'error', outputDir, error: result.error });
                console.error(chalk.red(`❌ Karaoke worker failed: ${result.error}`));
            }

            res.json(result);

        } catch (error) {
            const duration = (Date.now() - startTime) / 1000;
            recordKaraokeJobDuration(duration);
            
            console.error(chalk.red('❌ Karaoke prepare error:'), error.message);
            res.status(500).json({ error: error.message });
        }
    };

    router.post('/karaoke/prepare', karaokeLimiter, requirePermission('karaoke', 'write'), karaokePrepareHandler);

    router.post('/music/karaoke', karaokeLimiter, requirePermission('karaoke', 'write'), karaokePrepareHandler);

    router.get('/karaoke/status/:jobId', requirePermission('karaoke', 'read'), (req, res) => {
        const { jobId } = req.params;
        const job = karaokeJobs.get(jobId);

        if (!job) {
            const doneMarker = path.join(STEMS_DIR, jobId, '.done');
            if (fs.existsSync(doneMarker)) {
                const frames = getFormattedPitchMap(path.join(STEMS_DIR, jobId));
                return res.json({
                    status: 'ready',
                    jobId,
                    stems: {
                        vocals: `/karaoke/stems/${jobId}/vocals.wav`,
                        instrumental: `/karaoke/stems/${jobId}/no_vocals.wav`
                    },
                    frames: frames,
                    pitchMap: {
                        frames: frames
                    }
                });
            }
            return res.status(404).json({ error: 'Job not found' });
        }

        if (job.status === 'ready') {
            const frames = getFormattedPitchMap(job.outputDir);
            return res.json({
                status: 'ready',
                jobId,
                stems: {
                    vocals: `/karaoke/stems/${jobId}/vocals.wav`,
                    instrumental: `/karaoke/stems/${jobId}/no_vocals.wav`
                },
                frames: frames,
                pitchMap: {
                    frames: frames
                }
            });
        }

        if (job.status === 'error') {
            return res.json({ status: 'error', jobId, error: job.error });
        }

        res.json({ status: 'processing', jobId });
    });

    router.get('/music/karaoke/pitch-data', requirePermission('karaoke', 'read'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.json([]);

        const trackId = req.query.trackId;
        let track = player.currentTrack;

        if (trackId) {
            if (player.currentTrack && (player.currentTrack.id === trackId || player.currentTrack.url === trackId)) {
                track = player.currentTrack;
            } else {
                const queued = player.queue.find(t => t.id === trackId || t.url === trackId);
                if (queued) {
                    track = queued;
                } else {
                    const historical = player.previousTracks.find(t => t.id === trackId || t.url === trackId);
                    if (historical) {
                        track = historical;
                    }
                }
            }
        }

        if (!track || !track.url) {
            return res.json([]);
        }

        const trackHash = require('crypto').createHash('md5').update(track.url).digest('hex');
        const outputDir = path.join(STEMS_DIR, trackHash);
        const doneMarker = path.join(outputDir, '.done');

        if (!fs.existsSync(doneMarker)) {
            if (karaokeJobs.has(trackHash) && karaokeJobs.get(trackHash).status === 'processing') {
                return res.json({ status: 'processing', jobId: trackHash });
            }
            return res.json([]);
        }

        const frames = getFormattedPitchMap(outputDir);
        return res.json(frames);
    });

    router.use('/karaoke/stems', optionalAuth(), (req, res, next) => {
        next();
    }, express.static(STEMS_DIR));

    return router;
};