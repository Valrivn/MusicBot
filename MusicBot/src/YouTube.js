const { runYtdlp, runYtdlpWrap, getYtDlpOptions } = require('./resilience/external-calls');
const config = require('../config');
const LanguageManager = require('./LanguageManager');
const path = require('path');
const { defaultResolver } = require('./services/media-resolver');
const fs = require('fs');

class YouTube {
    static async search(query, limit = 10, guildId = null) {
        if (!query || !query.trim()) {
            return [];
        }

        const searchCommand = `ytsearch${limit}:${query.trim()}`;
        const ytDlpOptions = getYtDlpOptions();

        try {
            const results = await runYtdlpWrap([
                searchCommand,
                '--extractor-args', ytDlpOptions.extractorArgs || 'youtube:player_client=web',
                '--flat-playlist', '--skip-download', '--dump-json'
            ]);

            if (!results || results.length === 0) {
                return [];
            }

            return results.map(candidate => ({
                title: candidate.title || candidate.fulltitle || 'Unknown Title',
                artist: candidate.channel || candidate.uploader || 'Unknown Artist',
                url: candidate.webpage_url || candidate.url || (candidate.id ? `https://www.youtube.com/watch?v=${candidate.id}` : null),
                duration: candidate.duration || 0,
                durationMs: candidate.durationMs || (candidate.duration * 1000) || 0,
                thumbnail: candidate.thumbnail || (candidate.thumbnails?.length ? candidate.thumbnails[candidate.thumbnails.length - 1].url : null),
                id: candidate.id,
                platform: 'youtube'
            }));

        } catch (err) {
            console.warn(`[YouTube.search] Search failed for query "${query}":`, err.message);
            return [];
        }
    }

    static async resolveMetadataTrack(targetTitle, targetArtists = [], targetDurationMs, targetAlbumCover, guildId = null) {
        const cleanTitle = targetTitle.replace(/[\[\]()]/g, '').toLowerCase().trim();
        const primaryArtist = targetArtists[0] ? (typeof targetArtists[0] === 'string' ? targetArtists[0].toLowerCase() : (targetArtists[0].name || '').toLowerCase()) : '';
        const cleanArtists = (Array.isArray(targetArtists) ? targetArtists : [targetArtists]).map(a => {
            const name = typeof a === 'string' ? a : (a.name || '');
            return name.toLowerCase();
        }).filter(Boolean);
        const refDurationMs = Number(targetDurationMs);

        const searchStrategies = [
            `${primaryArtist} - ${cleanTitle} Official Audio`.trim(),
            `${primaryArtist} - ${cleanTitle}`.trim(),
            `${cleanTitle} ${primaryArtist}`.trim(),
            cleanTitle
        ].filter(Boolean);

        let candidates = [];

        for (const searchQuery of searchStrategies) {
            const searchCommand = `ytsearch5:${searchQuery}`;
            try {
                const results = await runYtdlpWrap([
                    searchCommand,
                    '--extractor-args', 'youtube:player_client=web',
                    '--flat-playlist', '--skip-download', '--dump-json'
                ]);

                if (results && results.length > 0) {
                    candidates = results;
                    console.log(`[YouTube] Found ${candidates.length} candidates with query: "${searchQuery}"`);
                    break;
                }
            } catch (err) {
                console.warn(`[YouTube] Search failed for query "${searchQuery}":`, err.message);
                continue;
            }
        }

        if (!candidates || candidates.length === 0) return null;

        console.log(`\n================================================================================`);
        console.log(`🔎 [ULTIMATUM MATRIX AUDIT] RESOLVING: "${targetTitle}"`);
        console.log(`👤 Target Artist(s): [${cleanArtists.join(', ')}]`);
        console.log(`⏱️ Target Duration: ${(refDurationMs / 1000).toFixed(2)}s (${refDurationMs} ms)`);
        console.log(`================================================================================`);
        console.log(`Evaluating ${candidates.length} search results in real time:\n`);

        const excludeKeywords = [
            'nightcore', 'remix', 'cover', 'live', 'karaoke', 'instrumental', 
            '8d', 'slowed', 'reverb', 'sped up', 'pitch', 'bass boost', 
            'mashup', 'extended', '1 hour', 'loop', 'lyrics', 'lyric video',
            'acoustic', 'piano', 'guitar', 'tutorial', 'how to play'
        ];

        const officialKeywords = ['official audio', 'topic', 'vevo', 'records', 'music'];

        const scoredCandidates = candidates.map((candidate, index) => {
            const cTitle = (candidate.title || '').toLowerCase();
            const cChannel = (candidate.channelName || candidate.uploader || '').toLowerCase();
            const cDurationMs = candidate.durationMs || (candidate.duration * 1000) || 0;
            const deltaSeconds = Math.abs(cDurationMs - refDurationMs) / 1000;

            const hasExcludedKeyword = excludeKeywords.some(kw => cTitle.includes(kw) || cChannel.includes(kw));
            if (hasExcludedKeyword) {
                console.log(`[#${index + 1}] ❌ EXCLUDED: "${candidate.title}" - contains filtered keyword`);
                return null;
            }

            const isDisqualified = deltaSeconds > 3;

            let driftPenalty = deltaSeconds * 25000;
            const hasArtist = cleanArtists.some(art => cChannel.includes(art) || cTitle.includes(art));
            
            let artistWeight = 25000;
            if (hasArtist) {
                artistWeight = -50000;
                
                const isTopicChannel = cChannel.includes('topic');
                if (isTopicChannel) {
                    artistWeight -= 20000;
                }
            }

            const isOfficialChannel = officialKeywords.some(kw => cChannel.includes(kw) || cTitle.includes(kw));
            if (isOfficialChannel) {
                artistWeight -= 15000;
            }

            const hasTitle = cTitle.includes(cleanTitle);
            let titleWeight = hasTitle ? -10000 : 0;

            let score = driftPenalty + artistWeight + titleWeight;

            console.log(`[#${index + 1}] Title: "${candidate.title || candidate.fulltitle}"`);
            console.log(`     Channel: "${candidate.channel || candidate.uploader}" | Duration: ${(cDurationMs / 1000).toFixed(2)}s (Delta: ${deltaSeconds.toFixed(2)}s)`);
            if (isDisqualified) {
                console.log(`     ❌ DISQUALIFIED: Duration drift of ${deltaSeconds.toFixed(2)}s exceeds the strict 3.0s limit.`);
            } else {
                console.log(`     ⚖️ Weights Breakdown (Golf Rules: Lowest wins):`);
                console.log(`        • Duration Drift Penalty:  +${driftPenalty.toFixed(0)}  (Delta * 25000)`);
                console.log(`        • Artist Match Adjustment: ${artistWeight >= 0 ? '+' : ''}${artistWeight} (${hasArtist ? 'Matched' : 'Mismatched'})`);
                console.log(`        • Title Match Adjustment:  ${titleWeight >= 0 ? '+' : ''}${titleWeight} (${hasTitle ? 'Matched' : 'Mismatched'})`);
                console.log(`        • TOTAL SCORE:             ${score.toFixed(0)}`);
            }
            console.log(`--------------------------------------------------------------------------------`);

            if (isDisqualified) return null;

            let reason = `Drift: ${deltaSeconds.toFixed(2)}s (+${driftPenalty.toFixed(0)} weight). `;
            if (hasArtist) {
                reason += `Artist matched (-50000). `;
            } else {
                reason += `Artist mismatched (+25000). `;
            }
            if (hasTitle) {
                reason += `Title matched (-10000).`;
            }

            return {
                title: candidate.title || candidate.fulltitle || 'Unknown Title',
                artist: candidate.channel || candidate.uploader || 'Unknown Artist',
                channelName: candidate.channel || candidate.uploader || 'Unknown Artist',
                uploader: candidate.uploader || candidate.channel || 'Unknown Artist',
                url: candidate.webpage_url || candidate.url || (candidate.id ? `https://www.youtube.com/watch?v=${candidate.id}` : null),
                duration: candidate.duration || 0,
                durationMs: cDurationMs,
                thumbnail: candidate.thumbnail || (candidate.thumbnails?.length ? candidate.thumbnails[candidate.thumbnails.length - 1].url : null),
                platform: 'youtube',
                type: 'track',
                id: candidate.id,
                matrixScore: score,
                calculatedDrift: deltaSeconds,
                matrixReason: reason
            };
        });

        const validMatches = scoredCandidates.filter(Boolean);

        try {
            const auditData = {
                target: {
                    title: targetTitle,
                    artists: cleanArtists,
                    durationMs: refDurationMs,
                    durationSec: (refDurationMs / 1000).toFixed(2)
                },
                timestamp: new Date().toISOString(),
                candidates: candidates.map((candidate, idx) => {
                    const cTitle = (candidate.title || '').toLowerCase();
                    const cChannel = (candidate.channelName || candidate.uploader || '').toLowerCase();
                    const cDurationMs = candidate.durationMs || (candidate.duration * 1000) || 0;
                    const deltaSeconds = Math.abs(cDurationMs - refDurationMs) / 1000;
                    const isDisqualified = deltaSeconds > 3;

                    let driftPenalty = deltaSeconds * 25000;
                    const hasArtist = cleanArtists.some(art => cChannel.includes(art) || cTitle.includes(art));
                    
                    let artistWeight = 25000;
                    if (hasArtist) {
                        artistWeight = -50000;
                        const isTopicChannel = cChannel.includes('topic');
                        if (isTopicChannel) {
                            artistWeight -= 20000;
                        }
                    }

                    const isOfficialChannel = officialKeywords.some(kw => cChannel.includes(kw) || cTitle.includes(kw));
                    if (isOfficialChannel) {
                        artistWeight -= 15000;
                    }

                    const hasTitle = cTitle.includes(cleanTitle);
                    let titleWeight = hasTitle ? -10000 : 0;
                    let totalScore = driftPenalty + artistWeight + titleWeight;

                    return {
                        rank: idx + 1,
                        title: candidate.title || candidate.fulltitle || 'Unknown Title',
                        channel: candidate.channel || candidate.uploader || 'Unknown Artist',
                        durationMs: cDurationMs,
                        durationSec: (cDurationMs / 1000).toFixed(2),
                        deltaSeconds: deltaSeconds.toFixed(2),
                        isDisqualified,
                        scores: {
                            driftPenalty: Math.round(driftPenalty),
                            artistWeight,
                            titleWeight,
                            totalScore: Math.round(totalScore)
                        }
                    };
                })
            };
            const auditFilePath = path.join(__dirname, '..', 'matrix_audit.json');
            fs.writeFileSync(auditFilePath, JSON.stringify(auditData, null, 2));
            console.log(`💾 Saved Ultimatum Matrix Audit details to: ${auditFilePath}`);
        } catch (fileErr) {
            console.error('❌ Failed to save matrix_audit.json:', fileErr.message);
        }

        if (validMatches.length === 0) {
            console.log(`⚠️ [ENGINE ALERT] 0 candidates passed the strict 3-second fence. Falling back to primary index.`);
            const fallback = candidates[0];
            return {
                youtubeId: fallback.id,
                url: fallback.webpage_url || fallback.url || (fallback.id ? `https://www.youtube.com/watch?v=${fallback.id}` : null),
                title: targetTitle,
                artist: (Array.isArray(targetArtists) ? targetArtists : [targetArtists]).map(a => typeof a === 'string' ? a : (a.name || '')).join(', '),
                albumCover: targetAlbumCover,
                durationMs: fallback.durationMs || (fallback.duration * 1000) || 0,
                id: fallback.id,
                platform: 'youtube',
                type: 'track',
                matrixLogs: [{ title: fallback.title || 'Unknown', score: 0, reason: "Fallback (0 candidates passed 3-second fence)" }]
            };
        }

        validMatches.sort((a, b) => a.matrixScore - b.matrixScore);
        const rawWinner = validMatches[0];

        const matrixLogs = validMatches.map(m => ({
            title: m.title,
            score: m.matrixScore,
            reason: m.matrixReason
        }));

        console.log(`🏆 MATRIX LOCK: "${rawWinner.title}" | Drift: ${rawWinner.calculatedDrift}s | Score: ${rawWinner.matrixScore}`);

        return {
            youtubeId: rawWinner.id || rawWinner.youtubeId,
            url: rawWinner.url,
            title: targetTitle,
            artist: targetArtists.join(', '),
            albumCover: targetAlbumCover,
            durationMs: rawWinner.durationMs || (rawWinner.duration * 1000),
            platform: 'youtube',
            type: 'track',
            id: rawWinner.id,
            thumbnail: rawWinner.thumbnail
        };
    }

    static async getStream(url, guildId = null, startSeconds = 0) {
        try {
            if (!url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.url_required') : 'URL is required';
                throw new Error(errorMsg);
            }

            const mediaResult = await defaultResolver.resolve(url, { quality: 'high' });
            
            if (!mediaResult || !mediaResult.url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_stream_url') : 'No stream URL found';
                throw new Error(errorMsg);
            }

            const baseUrl = mediaResult.url;
            const canSeek = /googlevideo\.com/i.test(baseUrl) || mediaResult.source === 'youtube';
            let finalUrl = baseUrl;

            const seekSeconds = Math.max(0, Number(startSeconds) || 0);
            if (seekSeconds > 0 && canSeek) {
                const startMs = Math.floor(seekSeconds * 1000);
                const separator = baseUrl.includes('?') ? '&' : '?';
                finalUrl = `${baseUrl}${separator}begin=${startMs}`;
            }

            return {
                url: finalUrl,
                rawUrl: baseUrl,
                type: 'opus',
                duration: mediaResult.duration || 0,
                bitrate: 128000,
                canSeek,
                format: 'bestaudio',
                httpHeaders: {},
                source: mediaResult.source,
                probeInfo: mediaResult.probeInfo
            };

        } catch (error) {
            console.warn('[YouTube.getStream] MediaResolver failed, falling back to direct yt-dlp:', error.message);
            return await this._getStreamDirect(url, guildId, startSeconds);
        }
    }

    static async _getStreamDirect(url, guildId = null, startSeconds = 0) {
        try {
            if (!url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.url_required') : 'URL is required';
                throw new Error(errorMsg);
            }

            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
                format: 'bestaudio/best',
            }));

            if (!info || !info.url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_stream_url') : 'No stream URL found';
                throw new Error(errorMsg);
            }

            const baseUrl = info.url;
            const canSeek = /googlevideo\.com/i.test(baseUrl);
            let finalUrl = baseUrl;

            const seekSeconds = Math.max(0, Number(startSeconds) || 0);
            if (seekSeconds > 0 && canSeek) {
                const startMs = Math.floor(seekSeconds * 1000);
                const separator = baseUrl.includes('?') ? '&' : '?';
                finalUrl = `${baseUrl}${separator}begin=${startMs}`;
            }

            return {
                url: finalUrl,
                rawUrl: baseUrl,
                type: info.acodec && info.acodec.includes('opus') ? 'opus' : 'arbitrary',
                duration: info.duration || 0,
                bitrate: info.abr || info.tbr || 0,
                canSeek,
                format: info.format,
                httpHeaders: info.http_headers || {}
            };

        } catch (error) {
            throw error;
        }
    }

    static isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    static isPlaylist(url) {
        return url.includes('list=') &&
            (url.includes('youtube.com/playlist') ||
                url.includes('youtube.com/watch') ||
                url.includes('youtu.be'));
    }

    static parseDuration(durationString) {
        if (!durationString) return 0;

        const parts = durationString.split(':').reverse();
        let seconds = 0;

        for (let i = 0; i < parts.length; i++) {
            seconds += parseInt(parts[i]) * Math.pow(60, i);
        }

        return seconds;
    }

    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';

        const totalSeconds = Math.floor(Number(seconds) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    static extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
            /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    static extractPlaylistId(url) {
        const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    static createThumbnailUrl(videoId, quality = 'maxresdefault') {
        return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    }

    static createVideoUrl(videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    static async validateUrl(url) {
        try {
            if (!this.isYouTubeURL(url)) {
                return false;
            }

            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));

            return !!info && !!info.title;
        } catch (error) {
            return false;
        }
    }

    static async getVideoInfo(url) {
        try {
            if (!this.isYouTubeURL(url)) {
                return null;
            }

            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));

            if (!info || !info.title) return null;

            return {
                id: info.id,
                title: info.title,
                channel: info.channel || info.uploader,
                uploader: info.uploader,
                duration: info.duration,
                thumbnail: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
                webpage_url: info.webpage_url,
            };
        } catch (error) {
            return null;
        }
    }

    static async getVideoMetadata(url) {
        try {
            if (!this.isYouTubeURL(url)) {
                return null;
            }

            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));

            if (!info || !info.title) return null;

            const videoId = info.id;
            const thumbnail = info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : null) || this.createThumbnailUrl(videoId, 'maxresdefault');

            return {
                videoId,
                title: info.title,
                artist: info.channel || info.uploader || 'Unknown Artist',
                channel: info.channel || info.uploader,
                uploader: info.uploader,
                durationMs: (info.duration || 0) * 1000,
                duration: info.duration || 0,
                thumbnail,
                webpage_url: info.webpage_url,
                rawUrl: info.webpage_url,
                url: `https://www.youtube.com/watch?v=${videoId}`,
            };
        } catch (error) {
            console.error('[YouTube.getVideoMetadata] Error:', error.message);
            return null;
        }
    }

    static async getTranscript(videoId) {
        const cacheDir = path.join(__dirname, '..', '..', 'cache', 'lyrics');
        
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cacheFile = path.join(cacheDir, `YT_${videoId}.json`);

        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                console.log(`[YouTube.getTranscript] Cache hit for ${videoId}`);
                return cached;
            } catch (e) {
                console.warn(`[YouTube.getTranscript] Cache read failed, re-fetching: ${e.message}`);
            }
        }

        const langs = ['en', 'en-US', 'en-GB', 'auto'];
        
        for (const lang of langs) {
            try {
                console.log(`[YouTube.getTranscript] Fetching subtitles for ${videoId} (lang: ${lang})`);
                
                const results = await runYtdlpWrap([
                    `https://www.youtube.com/watch?v=${videoId}`,
                    '--skip-download',
                    '--write-auto-sub',
                    '--sub-lang', lang,
                    '--sub-format', 'vtt',
                    '-o', '-',
                ]);

                let stdoutBuffer = '';
                if (results && results.length > 0) {
                    stdoutBuffer = JSON.stringify(results);
                }

                if (!stdoutBuffer.trim()) {
                    continue;
                }

                const parsed = this.parseWebVTT(stdoutBuffer);
                if (parsed && (parsed.plain || parsed.synced)) {
                    const result = {
                        plain: parsed.plain || '',
                        synced: parsed.synced || '',
                        hasSynced: !!parsed.synced,
                        source: 'YouTube Transcript',
                        language: lang,
                    };

                    try {
                        fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
                        console.log(`[YouTube.getTranscript] Cached transcript for ${videoId} (${lang})`);
                    } catch (e) {
                        console.warn(`[YouTube.getTranscript] Cache write failed: ${e.message}`);
                    }

                    return result;
                }
            } catch (err) {
                const msg = err.message || String(err);
                if (msg.includes('no subtitles') || msg.includes('Subtitles') || msg.includes('404') || msg.includes('unavailable')) {
                    console.log(`[YouTube.getTranscript] No ${lang} subtitles for ${videoId}, trying next language...`);
                    continue;
                }
                console.warn(`[YouTube.getTranscript] Error with lang ${lang}: ${msg}`);
            }
        }

        console.log(`[YouTube.getTranscript] No subtitles found for ${videoId} in any language`);
        return null;
    }

    static parseWebVTT(vttText) {
        if (!vttText || !vttText.includes('WEBVTT')) {
            return null;
        }

        const lines = vttText.split('\n');
        const cues = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();
            
            if (line.includes('-->')) {
                const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
                if (timeMatch) {
                    const startTime = this.parseVTTTime(timeMatch[1]);
                    const endTime = this.parseVTTTime(timeMatch[2]);
                    i++;
                    let text = '';
                    while (i < lines.length && lines[i].trim() !== '') {
                        text += (text ? '\n' : '') + lines[i].trim();
                        i++;
                    }
                    if (text) {
                        cues.push({ startTime, endTime, text });
                    }
                }
            }
            i++;
        }

        if (cues.length === 0) {
            return null;
        }

        const syncedLines = cues.map(cue => 
            `[${this.formatTime(cue.startTime)}] ${cue.text}`
        );
        const synced = syncedLines.join('\n');
        const plain = cues.map(c => c.text).join('\n');

        return { synced, plain };
    }

    static parseVTTTime(timeStr) {
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const secondsParts = parts[2].split('.');
        const seconds = parseInt(secondsParts[0]) || 0;
        const milliseconds = parseInt(secondsParts[1]) || 0;
        return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
    }

    static formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const hundredths = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
    }
}

module.exports = YouTube;