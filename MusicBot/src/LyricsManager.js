const axios = require('axios');
const Genius = require('genius-lyrics');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const LyricsMatcher = require('./LyricsMatcher');
const YouTube = require('./YouTube');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'lyrics');
const TRACK_CACHE_DIR = path.join(__dirname, '..', 'audio_cache');

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true' || (global.config?.debug === true);

class LyricsManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimers = new Map();

        const geniusToken = global.config?.genius?.clientId || process.env.GENIUS_API_KEY || '';
        this.geniusClient = geniusToken ? new Genius.Client(geniusToken) : new Genius.Client();
    }



    getCacheKey(track) {
        if (!track) return 'unknown';
        const title = (track.title || '').toLowerCase();
        const artist = (track.artist || track.uploader || '').toLowerCase();
        return `${title}-${artist}` || title || 'unknown';
    }

    extractYtVideoId(url) {
        if (!url) return 'unknown';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : 'unknown';
    }

    storeInCache(trackId, data, forceResync = false) {
        if (!trackId || !data) return;

        this.cache.set(trackId, data);

        const fs = require('fs');
        const path = require('path');
        const cacheFilePath = path.join(__dirname, '..', 'audio_cache', `lyrics_${trackId}.json`);

        let shouldWrite = true;
        if (!forceResync && fs.existsSync(cacheFilePath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                const existingSynced = existing && (existing.hasSynced || existing.synced);
                const newSynced = data.hasSynced || data.synced;
                if (existingSynced && !newSynced) {
                    shouldWrite = false;
                    console.log(`[LyricsManager] Sync safety lockout: Synced lyrics already exist. Rejecting plain lyrics overwrite for ${trackId}.`);
                }
            } catch (e) {
                console.error("Failed to parse existing cached lyrics file for overwrite check:", e);
            }
        }

        if (shouldWrite) {
            try {
                fs.writeFileSync(cacheFilePath, JSON.stringify(data, null, 2), 'utf8');
            } catch (e) {
                console.error("Failed to write lyrics to file cache:", e);
            }
        }
    }

    checkYTCache(videoId) {
        if (!videoId || videoId === 'unknown') return null;
        const cacheFile = path.join(CACHE_DIR, `YT_${videoId}.json`);
        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (cached && (cached.plain || cached.synced)) {
                    if (isDebug) console.log(`[LyricsManager] YT cache hit for ${videoId}`);
                    return cached;
                }
            } catch (e) {
                if (isDebug) console.warn(`[LyricsManager] YT cache read failed: ${e.message}`);
            }
        }
        return null;
    }

    checkTrackCache(trackId) {
        if (!trackId) return null;
        const cacheFile = path.join(TRACK_CACHE_DIR, `lyrics_${trackId}.json`);
        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (cached) {
                    if (isDebug) console.log(`[LyricsManager] Track cache hit for ${trackId}`);
                    return cached;
                }
            } catch (e) {
                if (isDebug) console.warn(`[LyricsManager] Track cache read failed: ${e.message}`);
            }
        }
        return null;
    }

    async runLyricsMatcher(title, artist, forceResync = false, options = {}) {
        try {
            const timeoutMs = forceResync ? 15000 : 12000;
            const matchResult = await Promise.race([
                LyricsMatcher.match(title, artist, options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('LRCLIB timeout')), timeoutMs))
            ]);
            if (matchResult.success) {
                const lockedDurationMs = matchResult.lockedDurationMs;
                const lrclibCandidates = matchResult.candidates.map(c => ({
                    synced: c.syncedLyrics,
                    plain: c.plainLyrics || "",
                    artistName: c.artist,
                    trackName: c.title,
                    duration: c.durationSec,
                    durationMs: c.durationMs,
                    source: 'LRCLIB (Synced)',
                    lrclibId: c.lrclibId
                }));
                if (isDebug) console.log(`[LyricsManager] LyricsMatcher locked duration: ${lockedDurationMs}ms (fallback: ${matchResult.fallbackUsed})`);
                return { lockedDurationMs, lrclibCandidates };
            }
        } catch (e) {
            if (isDebug) console.log(`[LyricsManager] LyricsMatcher error/timeout: ${e.message}`);
        }
        return { lockedDurationMs: null, lrclibCandidates: [] };
    }

    buildCandidateFromTrackLyrics(track, lockedDurationMs) {
        if (!track.lyrics || (!track.lyrics.plain && !track.lyrics.synced)) return null;
        const cleanTitle = this.cleanTrackTitle(track.title);
        const cleanArtist = (track.lyricArtist || track.artist || '').trim();
        return {
            synced: track.lyrics.synced || "",
            plain: track.lyrics.plain || "",
            artistName: cleanArtist,
            trackName: cleanTitle,
            durationMs: lockedDurationMs || track.durationMs || (track.duration * 1000),
            source: track.lyrics.hasSynced ? 'YouTube Transcript (Synced)' : 'YouTube Transcript'
        };
    }

    async runYTMusicHarvest(videoId, cleanTitle, cleanArtist, lockedDurationMs, track) {
        if (videoId === 'unknown') {
            return { isSynced: false, plain: null, synced: null, source: 'YouTube Music' };
        }

        if (isDebug) console.log(`[LyricsManager] Wave 1.2: Harvesting YouTube Music for videoId="${videoId}"`);
        const { execFile } = require('child_process');
        const pythonScript = path.join(__dirname, '..', 'scripts', 'ytmusic_lyrics.py');

        try {
            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'timeout' });
                }, 4000);

                execFile('python', [pythonScript, videoId, cleanTitle, cleanArtist], { timeout: 4000 }, (error, stdout) => {
                    clearTimeout(timeout);
                    try {
                        if (!error && stdout) {
                            const resData = JSON.parse(stdout);
                            if (resData.success && resData.lyrics) {
                                resolve({
                                    success: true,
                                    isSynced: !!resData.synced,
                                    synced: resData.synced ? resData.lyrics : "",
                                    plain: resData.lyrics || "",
                                    source: 'YouTube Music'
                                });
                            } else {
                                resolve({ success: false, error: 'no lyrics' });
                            }
                        } else {
                            resolve({ success: false, error: error?.message || 'no output' });
                        }
                    } catch (e) {
                        resolve({ success: false, error: 'parse error' });
                    }
                });
            });

            if (result.success) {
                if (isDebug) console.log(`[LyricsManager] Wave 1.2: YouTube Music ${result.isSynced ? 'SYNCED' : 'plain only'} lyrics found`);
                return {
                    isSynced: result.isSynced,
                    plain: result.plain,
                    synced: result.synced,
                    source: 'YouTube Music'
                };
            }
        } catch (e) {
            if (isDebug) console.log(`[LyricsManager] Wave 1.2: YouTube Music failed: ${e.message}`);
        }
        return { isSynced: false, plain: null, synced: null, source: 'YouTube Music' };
    }

    async runGeniusPlain(cleanTitle, cleanArtist, lockedDurationMs, track) {
        try {
            if (isDebug) console.log(`[LyricsManager] Wave 2: Trying Genius for "${cleanTitle}" - "${cleanArtist}"`);
            const query = cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle;
            const searches = await this.geniusClient.songs.search(query);
            if (searches && searches.length > 0) {
                const lyrics = await searches[0].lyrics();
                if (lyrics) {
                    const cleanedGenius = this.cleanGeniusLyrics(lyrics);
                    if (cleanedGenius) {
                        if (isDebug) console.log(`[LyricsManager] Wave 2: Genius found plain lyrics`);
                        return {
                            synced: "",
                            plain: cleanedGenius,
                            artistName: searches[0].artist?.name || cleanArtist,
                            trackName: searches[0].title || cleanTitle,
                            durationMs: lockedDurationMs || track.durationMs || (track.duration * 1000),
                            source: 'Genius (Plain)'
                        };
                    }
                }
            }
        } catch (e) {
            if (isDebug) console.log(`[LyricsManager] Wave 2: Genius failed: ${e.message}`);
        }
        return null;
    }

    async runFinalResort(videoId, cleanTitle, cleanArtist, lockedDurationMs, track) {
        if (videoId === 'unknown') return null;
        if (isDebug) console.log(`[LyricsManager] Final Resort: Actively fetching YouTube transcript for ${videoId}...`);
        try {
            const ytTranscript = await YouTube.getTranscript(videoId);
            if (ytTranscript && (ytTranscript.plain || ytTranscript.synced)) {
                if (isDebug) console.log(`[LyricsManager] Final Resort: Found ${ytTranscript.hasSynced ? 'synced' : 'plain'} lyrics`);
                return {
                    synced: ytTranscript.synced || "",
                    plain: ytTranscript.plain || "",
                    artistName: cleanArtist,
                    trackName: cleanTitle,
                    durationMs: lockedDurationMs || track.durationMs || (track.duration * 1000),
                    source: ytTranscript.hasSynced ? 'YouTube Transcript (Synced)' : 'YouTube Transcript'
                };
            }
        } catch (e) {
            if (isDebug) console.log(`[LyricsManager] Final Resort: YouTube Transcript fetch failed: ${e.message}`);
        }
        return null;
    }

    formatAndCache(winner, trackId, title, artist, forceResync = false) {
        if (!winner) return null;
        const isSynced = winner.source?.includes("(Synced)") || false;
        const payload = {
            title: winner.trackName || title,
            artist: winner.artistName || artist,
            source: winner.source,
            synced: isSynced ? winner.synced : "",
            plain: !isSynced ? winner.plain : "",
            hasSynced: isSynced,
            lines: (isSynced ? winner.synced : winner.plain).split('\n')
        };
        this.storeInCache(trackId, payload, forceResync);
        return payload;
    }

    cleanTrackTitle(title = '') {
        return title
            .replace(/\(.*?\)/g, '') // Remove parentheses content
            .replace(/\[.*?\]/g, '') // Remove brackets content
            .replace(/official video/gi, '')
            .replace(/official audio/gi, '')
            .replace(/lyric video/gi, '')
            .replace(/lyrics/gi, '')
            .replace(/4k/gi, '')
            .replace(/hd/gi, '')
            .trim();
    }

    /**
     * Build simple lyrics data object (no sync support)
     */
    buildLyricsData(track, data = {}) {
        return {
            plain: data.plain ?? null,
            source: data.source ?? null,
            artist: data.artist ?? track?.artist ?? track?.uploader ?? null,
            title: data.title ?? track?.title ?? null,
            album: data.album ?? null
        };
    }

    /**
     * Fetch lyrics - first from Genius, fallback to LRCLIB
     * @param {Object} track - Track object with title and artist
     * @returns {Promise<Object|null>} Lyrics object or null
     */
    // --- START LYRICS ALIGNMENT PENALTY ENGINE ---
    selectBestLyrics(lyricCandidates, targetTrack) {
        if (!lyricCandidates || lyricCandidates.length === 0) return null;

        const playingDurationMs = targetTrack.durationMs || (targetTrack.duration * 1000);
        const refArtist = (targetTrack.artist || '').toLowerCase();

        const scoredLyrics = lyricCandidates.map(candidate => {
            let lyricPenalty = 0;

            // 1. Mandatory Sync Check Gating
            if (!candidate.synced) {
                lyricPenalty += 5000; // Drastically penalize non-synced plain text
            }

            // 2. Strict Artist Presence Verification
            const lyricArtist = (candidate.artistName || candidate.artist || '').toLowerCase();
            if (refArtist && !lyricArtist.includes(refArtist) && !refArtist.includes(lyricArtist)) {
                lyricPenalty += 1000; // Heavy penalty if the uploader misattributed the artist
            }

            // 3. YouTube Music Trust Boost (Wave 2 safety net)
            // When user provided no artist hint, YouTube Music's streaming-velocity ordering
            // acts as ground truth for which version is the preferred one
            const isYouTubeMusic = candidate.source?.includes('YouTube Music');
            const hasNoArtistHint = !refArtist || refArtist === '';
            if (isYouTubeMusic && hasNoArtistHint) {
                lyricPenalty -= 20000; // Let YT Music overrule other sources when no artist specified
            }

            // 3. High-Precision Duration Proximity Check (The Drift Fix)
            // Compare the lyric metadata length to the actual playing track length
            const candidateDurationMs = candidate.duration ? (candidate.duration * 1000) : candidate.durationMs;

            if (candidateDurationMs) {
                const timeDeltaSec = Math.abs(candidateDurationMs - playingDurationMs) / 1000;

                // Apply a progressive, harsh weight multiplier to time deviations
                if (timeDeltaSec <= 2) {
                    lyricPenalty += timeDeltaSec * 15; // Very low penalty for minor padding variations
                } else {
                    lyricPenalty += 500 + (timeDeltaSec * 100); // Sharp penalty scaling for high-drift tracks
                }
            } else {
                lyricPenalty += 300; // Moderate penalty if the lyric source doesn't provide duration metadata
            }

            return { ...candidate, lyricPenalty };
        });

        // Sort ascending: absolute lowest penalty wins the match
        scoredLyrics.sort((a, b) => a.lyricPenalty - b.lyricPenalty);

        console.log(`📡 [LYRICS ENGINE] Evaluated ${scoredLyrics.length} lyric sources.`);
        scoredLyrics.forEach(cand => {
            console.log(`   - Source: ${cand.source} | Penalty: ${cand.lyricPenalty.toFixed(2)}`);
        });
        console.log(`🏆 Selected Lyrics Source: ${scoredLyrics[0].source || 'Unknown'} | Penalty Score: ${scoredLyrics[0].lyricPenalty.toFixed(2)}`);

        return scoredLyrics[0];
    }
    // --- END LYRICS ALIGNMENT PENALTY ENGINE ---

    async fetchLyrics(track, forceResync = false, options = {}) {
        if (!track || !track.title) return null;

        const videoId = track.url ? this.extractYtVideoId(track.url) : 'unknown';
        const cleanTitle = this.cleanTrackTitle(track.title);
        const cleanArtist = (track.lyricArtist || track.artist || '').trim();
        const crypto = require('crypto');
        const trackId = videoId !== 'unknown' ? videoId : crypto.createHash('md5').update(`${cleanTitle}-${cleanArtist}`).digest('hex');

        // ── Wave 0: Unified Caches ─────────────────────────────────
        if (!forceResync) {
            const ytCached = this.checkYTCache(videoId);
            if (ytCached) {
                if (isDebug) console.log(`🌊 Wave 0: YT Cache hit`);
                return this.formatAndCache({
                    synced: ytCached.synced || "",
                    plain: ytCached.plain || "",
                    artistName: cleanArtist,
                    trackName: cleanTitle,
                    durationMs: track.durationMs || (track.duration * 1000),
                    source: ytCached.hasSynced ? 'YouTube Transcript (Synced)' : 'YouTube Transcript'
                }, trackId, cleanTitle, cleanArtist);
            }

            const trackCached = this.checkTrackCache(trackId);
            if (trackCached) {
                if (isDebug) console.log(`🌊 Wave 0: Track Cache hit`);
                return trackCached;
            }
        }

        // ── Wave 1.1: LRCLIB Handshake ─────────────────────────────
        if (isDebug) console.log(`🌊 Wave 1.1: LRCLIB Handshake...`);
        const { lockedDurationMs, lrclibCandidates } = await this.runLyricsMatcher(cleanTitle, cleanArtist, forceResync, options);
        
        const syncedLRCLIB = lrclibCandidates.find(c => c.synced && c.synced.trim());
        if (syncedLRCLIB) {
            console.log(`✅ Wave 1.1 Early Exit: LRCLIB Synced (${syncedLRCLIB.source})`);
            return this.formatAndCache(syncedLRCLIB, trackId, cleanTitle, cleanArtist, forceResync);
        }
        
        // Store LRCLIB plain candidates for Wave 2
        const lrclibPlainCandidates = lrclibCandidates.filter(c => c.plain && c.plain.trim());

        // ── Wave 1.2: YT Music Harvest ─────────────────────────────
        if (isDebug) console.log(`🌊 Wave 1.2: YouTube Music Harvest...`);
        const ytmResult = await this.runYTMusicHarvest(videoId, cleanTitle, cleanArtist, lockedDurationMs, track);
        
        if (ytmResult?.isSynced && ytmResult.synced?.trim()) {
            console.log(`✅ Wave 1.2 Early Exit: YouTube Music Synced`);
            return this.formatAndCache({
                synced: ytmResult.synced,
                plain: ytmResult.plain || "",
                artistName: cleanArtist,
                trackName: cleanTitle,
                durationMs: lockedDurationMs || track.durationMs || (track.duration * 1000),
                source: 'YouTube Music (Synced)'
            }, trackId, cleanTitle, cleanArtist, forceResync);
        }
        
        // Pre-harvest plain for Wave 2 reuse
        const ytmPreHarvested = ytmResult?.plain?.trim() ? {
            synced: "",
            plain: ytmResult.plain,
            artistName: cleanArtist,
            trackName: cleanTitle,
            durationMs: lockedDurationMs || track.durationMs || (track.duration * 1000),
            source: 'YouTube Music (Plain)'
        } : null;

        // ── Wave 1.3: Pre-fetched Memory Check ─────────────────────
        if (isDebug) console.log(`🌊 Wave 1.3: Pre-fetched Memory Check...`);
        const preFetched = this.buildCandidateFromTrackLyrics(track, lockedDurationMs);
        if (preFetched?.synced?.trim()) {
            console.log(`✅ Wave 1.3 Early Exit: Pre-fetched Synced`);
            return this.formatAndCache(preFetched, trackId, cleanTitle, cleanArtist, forceResync);
        }

        // ── Wave 2: Plain Fallback Layer ───────────────────────────
        console.log(`🌊 Wave 2: Plain Fallback Layer...`);
        
        const geniusPlain = await this.runGeniusPlain(cleanTitle, cleanArtist, lockedDurationMs, track);
        
        // Build Wave 2 candidate pool
        const wave2Candidates = [
            geniusPlain,
            ytmPreHarvested,
            ...lrclibPlainCandidates
        ].filter(Boolean);

        let winner = wave2Candidates.length > 0 
            ? this.selectBestLyrics(wave2Candidates, track) 
            : null;

        // ── Final Resort ───────────────────────────────────────────
        if (!winner) {
            console.log(`🌊 Final Resort: YouTube Transcript...`);
            winner = await this.runFinalResort(videoId, cleanTitle, cleanArtist, lockedDurationMs, track);
        }

        if (winner) {
            if (isDebug) console.log(`[LyricsManager] Selected winner: ${winner.source}`);
            return this.formatAndCache(winner, trackId, cleanTitle, cleanArtist, forceResync);
        }

        // Cache null result to avoid repeated lookups
        this.cache.set(trackId, null);
        return null;
    }





    async fetchFromLrclib(track) {
        try {
            const artist = track.lyricArtist || track.artist || track.uploader || '';
            const searchUrl = 'https://lrclib.net/api/search';
            const cleanTitle = this.cleanTrackTitle(track.title || '');

            const attempts = [];
            attempts.push({ track_name: cleanTitle, artist_name: artist });
            if (artist) {
                attempts.push({ track_name: cleanTitle });
            }
            if (cleanTitle && cleanTitle !== track.title) {
                attempts.push({ track_name: track.title, artist_name: artist });
            }

            for (let i = 0; i < attempts.length; i++) {
                const params = attempts[i];
                if (!params.track_name) continue;

                try {
                    const response = await axios.get(searchUrl, {
                        params,
                        timeout: 5000
                    });

                    if (response.data && response.data.length > 0) {
                        const result = response.data[0];
                        // Only use plain lyrics from LRCLIB
                        if (!result.plainLyrics) continue;

                        return this.buildLyricsData(track, {
                            plain: result.plainLyrics,
                            source: 'LRCLIB'
                        });
                    }
                } catch (error) {
                    if (i === attempts.length - 1) {
                        console.error('❌ Failed to fetch lyrics from LRCLIB:', error.message);
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to fetch lyrics from LRCLIB:', error.message);
            return null;
        }
    }

    async fetchFromGenius(track) {
        try {
            const artist = track.lyricArtist || track.artist || track.uploader || '';
            const title = this.cleanTrackTitle(track.title || '');

            if (!title) return null;

            const query = artist ? `${artist} ${title}` : title;
            const searches = await this.geniusClient.songs.search(query);

            if (!searches || searches.length === 0) return null;

            const firstSong = searches[0];
            const lyrics = await firstSong.lyrics();

            if (!lyrics) return null;

            // Clean Genius lyrics from metadata and HTML tags
            const cleanedLyrics = this.cleanGeniusLyrics(lyrics);
            if (!cleanedLyrics) return null;

            return this.buildLyricsData(track, {
                plain: cleanedLyrics,
                source: 'Genius'
            });
        } catch (error) {
            console.error('❌ Failed to fetch lyrics from Genius:', error.message);
            return null;
        }
    }

    cleanGeniusLyrics(lyrics) {
        if (!lyrics) return null;

        let cleaned = lyrics;

        // Step 1: Remove contributor/translation header (everything before actual lyrics start)
        // Match: "131 Contributors...Lyrics" or "131 Contributors...Lyrics<img...>"
        cleaned = cleaned.replace(/^\d+\s+Contributors.*?Lyrics(<[^>]+>)*\s*/is, '');

        // Step 2: Remove HTML tags
        cleaned = cleaned.replace(/<[^>]*>/g, '');

        // Step 3: Remove description paragraphs (usually before [Verse] tags)
        // Match lines that end with "..." and "Read More"
        cleaned = cleaned.replace(/^[^\[]+?\.{3}\s*Read More\s*/im, '');

        // Step 4: Remove bracketed descriptions with quotes (like ["Susamam" ft. ...])
        cleaned = cleaned.replace(/\[[""][^\]]{50,}\]/g, '');

        // Step 5: Clean up whitespace
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        cleaned = cleaned.trim();

        return cleaned || null;
    }



    /**
     * Format full lyrics for display (with pagination support)
     * @param {Object} lyricsData - Lyrics data
     * @param {number} maxLength - Max character length per page
     * @returns {Array<string>} Array of lyric pages
     */
    formatFullLyrics(lyricsData, maxLength = 4000) {
        if (!lyricsData) return [];

        const text = lyricsData.plain || lyricsData.synced?.replace(/\[\d+:\d+\.\d+\]/g, '') || '';
        if (!text) return [];

        const pages = [];
        const lines = text.split('\n').filter(line => line.trim());

        let currentPage = '';
        for (const line of lines) {
            if ((currentPage + line + '\n').length > maxLength) {
                if (currentPage) pages.push(currentPage.trim());
                currentPage = line + '\n';
            } else {
                currentPage += line + '\n';
            }
        }

        if (currentPage) pages.push(currentPage.trim());

        return pages;
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        for (const timer of this.cacheTimers.values()) {
            clearTimeout(timer);
        }
        this.cacheTimers.clear();
    }
}

module.exports = new LyricsManager();
