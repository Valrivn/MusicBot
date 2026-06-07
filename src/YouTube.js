const youtubedl = require('youtube-dl-exec');
const config = require('../config');
const LanguageManager = require('./LanguageManager');
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');

const binaryPath = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpWrap = new YTDlpWrap(binaryPath);

class YouTube {
    // yt-dlp için ortak parametreleri döndüren yardımcı fonksiyon
    static getYtDlpOptions(extraOptions = {}) {
        const baseOptions = {
            noCheckCertificates: true,
            noWarnings: true,
            retries: 3,
            fragmentRetries: 3,
            // User-Agent header ekle
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...extraOptions
        };

        // Auth öncelik sırası: PO Token > Browser Cookie > Cookie Dosyası > iOS client (fallback)
        if (config.ytdl.poToken) {
            // PO Token varsa web client'ı ile yüksek kaliteli stream
            baseOptions.extractorArgs = `youtube:po_token=web+${config.ytdl.poToken};player_client=web`;
        } else if (config.ytdl.cookiesFromBrowser) {
            baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
        } else if (config.ytdl.cookiesFile) {
            baseOptions.cookies = config.ytdl.cookiesFile;
        } else {
            // Forces stable web client routing to drop problematic network wrappers
            baseOptions.extractorArgs = 'youtube:player_client=web';
        }

        return baseOptions;
    }

    static async executeYtdlpSearch(searchQuery, limit, guildId) {
        const results = await youtubedl(searchQuery, this.getYtDlpOptions({
            dumpSingleJson: true,
            flatPlaylist: true,
            playlistEnd: limit,
        }));

        if (!results || !results.entries) {
            return [];
        }

        const tracks = [];
        for (const item of results.entries.slice(0, limit)) {
            try {
                const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
                const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

                const track = {
                    title: item.title || item.fulltitle || unknownTitle,
                    artist: item.uploader || item.channel || unknownArtist,
                    url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
                    duration: item.duration || 0,
                    thumbnail: item.thumbnail ||
                        (item.thumbnails?.length ? item.thumbnails[item.thumbnails.length - 1].url : null) ||
                        (item.id ? `https://img.youtube.com/vi/${item.id}/hqdefault.jpg` : null),
                    platform: 'youtube',
                    type: item._type || item.type || 'track',
                    id: item.id,
                    views: item.view_count,
                    uploadDate: item.upload_date,
                    description: item.description,
                };

                // Filter out non-playable URLs (like channel browse pages, playlists or albums)
                const isPlayable = track.url && (track.url.includes('watch?v=') || track.url.includes('youtu.be/') || track.url.includes('embed/'));
                if (!isPlayable || track.type === 'playlist' || track.type === 'album') {
                    continue;
                }

                if (!track.duration || track.duration === 0) {
                    const detailedInfo = await this.getInfo(track.url, guildId);
                    if (detailedInfo) {
                        if (detailedInfo.duration) track.duration = detailedInfo.duration;
                        if (detailedInfo.artist && detailedInfo.artist !== unknownArtist) {
                            track.artist = detailedInfo.artist;
                        }
                        if (detailedInfo.views) track.views = detailedInfo.views;
                        if (detailedInfo.description) track.description = detailedInfo.description;
                    }
                }

                tracks.push(track);
            } catch (error) {
                continue;
            }
        }
        return tracks;
    }

    static async resolveSpotifyTrack(spotifyTitle, spotifyArtists = [], spotifyDurationMs, album = '', guildId = null) {
        const cleanTitle = spotifyTitle.replace(/[\[\]()]/g, '').toLowerCase().trim();
        const primaryArtist = spotifyArtists[0] ? (typeof spotifyArtists[0] === 'string' ? spotifyArtists[0].toLowerCase() : (spotifyArtists[0].name || '').toLowerCase()) : '';
        const cleanArtists = (Array.isArray(spotifyArtists) ? spotifyArtists : [spotifyArtists]).map(a => {
            const name = typeof a === 'string' ? a : (a.name || '');
            return name.toLowerCase();
        }).filter(Boolean);
        const refDurationMs = Number(spotifyDurationMs);

        // Strict top-5 pool query string to completely bypass playlist spam
        const searchCommand = `ytsearch5:${cleanTitle} ${primaryArtist}`.trim();
        let candidates = [];

        try {
            const ytDlpEventEmitter = ytDlpWrap.exec([
                searchCommand,
                '--extractor-args', 'youtube:player_client=web',
                '--flat-playlist', '--skip-download', '--dump-json'
            ]);

            let stdoutBuffer = '';
            ytDlpEventEmitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });
            
            candidates = await new Promise((resolve, reject) => {
                ytDlpEventEmitter.on('close', () => {
                    const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                    try {
                        resolve(lines.map(l => JSON.parse(l)));
                    } catch (err) {
                        reject(err);
                    }
                });
                ytDlpEventEmitter.on('error', (err) => reject(err));
            });
        } catch (err) {
            return null;
        }

        if (!candidates || candidates.length === 0) return null;

        // THE ULTIMATUM MATRIX: TIME PROXIMITY IS DOMINANT
        const validMatches = candidates.map((candidate) => {
            const cTitle = (candidate.title || '').toLowerCase();
            const cChannel = (candidate.channelName || candidate.uploader || '').toLowerCase();
            const cDurationMs = candidate.durationMs || (candidate.duration * 1000) || 0;
            const deltaSeconds = Math.abs(cDurationMs - refDurationMs) / 1000;

            // CRITICAL TIME CEILING: Clear out long playlists and short snippets instantly
            if (deltaSeconds > 6) return null; 

            let score = 0; // Golf rules: Lowest score wins

            // DURATION CRITERIA: Heavily weighted penalty multiplier per second of drift
            score += deltaSeconds * 25000; 

            // SECONDARY TEXT VERIFICATION: Must match artist somewhere in the data blocks
            const hasArtist = cleanArtists.some(art => cChannel.includes(art) || cTitle.includes(art));
            score += hasArtist ? -50000 : 25000; // Massive drop reward vs heavy mismatch penalty

            if (cTitle.includes(cleanTitle)) score -= 10000;

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
                calculatedDrift: deltaSeconds
            };
        }).filter(Boolean);

        // Ultimate fallback shield: if every video fails the 6s fence, use native index 0
        if (validMatches.length === 0) {
            console.log(`⚠️ [ENGINE ALERT] 0 candidates passed the strict 6-second fence. Falling back to primary index.`);
            const fallback = candidates[0];
            return {
                title: fallback.title || fallback.fulltitle || 'Unknown Title',
                artist: fallback.channel || fallback.uploader || 'Unknown Artist',
                channelName: fallback.channel || fallback.uploader || 'Unknown Artist',
                uploader: fallback.uploader || fallback.channel || 'Unknown Artist',
                url: fallback.webpage_url || fallback.url || (fallback.id ? `https://www.youtube.com/watch?v=${fallback.id}` : null),
                duration: fallback.duration || 0,
                durationMs: fallback.durationMs || (fallback.duration * 1000) || 0,
                thumbnail: fallback.thumbnail || (fallback.thumbnails?.length ? fallback.thumbnails[fallback.thumbnails.length - 1].url : null),
                platform: 'youtube',
                type: 'track',
                id: fallback.id
            };
        }

        // Sort ascending: The absolute closest timeline track wins
        validMatches.sort((a, b) => a.matrixScore - b.matrixScore);
        
        console.log(`🏆 MATRIX LOCK: "${validMatches[0].title}" | Drift: ${validMatches[0].calculatedDrift}s | Score: ${validMatches[0].matrixScore}`);
        return validMatches[0];
    }

    static async searchMusic(query, limit = 20, guildId = null) {
        // Route directly through ytDlpWrap.exec() to avoid youtube-dl-exec's Python layer
        // rejecting ytmsearch/ytsearch URL schemes as "Unsupported url scheme"
        const parseYtDlpOutput = (stdoutBuffer) => {
            const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
            const tracks = [];
            for (const line of lines) {
                try {
                    const raw = JSON.parse(line);
                    const url = raw.webpage_url || raw.url || (raw.id ? `https://www.youtube.com/watch?v=${raw.id}` : null);
                    if (!url || !url.includes('watch?v=')) continue;
                    tracks.push({
                        title: raw.title || raw.fulltitle || 'Unknown Title',
                        artist: raw.channel || raw.uploader || 'Unknown Artist',
                        channelName: raw.channel || raw.uploader || 'Unknown Artist',
                        uploader: raw.uploader || raw.channel || 'Unknown Artist',
                        url,
                        duration: raw.duration || 0,
                        durationMs: raw.duration ? (raw.duration * 1000) : 0,
                        thumbnail: raw.thumbnail || (raw.thumbnails?.length ? raw.thumbnails[raw.thumbnails.length - 1].url : null),
                        platform: 'youtube',
                        type: 'track',
                        id: raw.id,
                        views: raw.view_count,
                        uploadDate: raw.upload_date,
                    });
                } catch (_) { continue; }
            }
            return tracks;
        };

        // Primary: Standard YouTube index via ytDlpWrap.exec()
        try {
            console.log(`📡 [SEARCH] Querying YouTube (ytsearch) for: "${query}"`);
            const emitter = ytDlpWrap.exec([
                `ytsearch${limit}:${query}`,
                '--extractor-args', 'youtube:player_client=web',
                '--flat-playlist',
                '--skip-download',
                '--dump-json'
            ]);
            let buf = '';
            emitter.ytDlpProcess.stdout.on('data', d => { buf += d; });
            const tracks = await new Promise((resolve, reject) => {
                emitter.on('close', () => resolve(parseYtDlpOutput(buf)));
                emitter.on('error', reject);
            });
            if (tracks && tracks.length > 0) return tracks;
        } catch (err) {
            console.error(`[SEARCH] ytsearch failed: ${err.message}`);
        }

        return [];
    }

    static async search(query, limit = 20, guildId = null) {
        try {
            if (this.isYouTubeURL(query)) {
                const info = await this.getInfo(query, guildId);
                return info ? [info] : [];
            }
            return await this.searchMusic(query, limit, guildId);
        } catch (error) {
            console.error('[YouTube] search() failed:', error.message || error);
            return [];
        }
    }

    static async getInfo(url, guildId = null) {
        try {


            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                preferFreeFormats: true,
            }));

            if (!info) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_info_returned') : 'No info returned from youtube-dl';
                throw new Error(errorMsg);
            }

            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

            const track = {
                title: info.title || unknownTitle,
                artist: info.uploader || info.channel || unknownArtist,
                url: info.webpage_url || url,
                duration: info.duration || 0,
                thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
                platform: 'youtube',
                type: 'track',
                id: info.id,
                views: info.view_count,
                uploadDate: info.upload_date,
                description: info.description,
                formats: info.formats,
            };


            return track;

        } catch (error) {
            console.error('[YouTube] getInfo() failed:', error.message || error);
            return null;
        }
    }

    static async getStream(url, guildId = null, startSeconds = 0) {
        try {


            if (!url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.url_required') : 'URL is required';
                throw new Error(errorMsg);
            }

            // Get stream URL with simple format
            const info = await youtubedl(url, this.getYtDlpOptions({
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

    static async getPlaylist(url, guildId = null) {
        try {

            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
            }));

            if (!info) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_playlist_info') : 'No playlist info found';
                throw new Error(errorMsg);
            }

            if (!info.entries || info.entries.length === 0) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_playlist_entries') : 'No playlist entries found';
                throw new Error(errorMsg);
            }

            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

            const tracks = [];
            for (const entry of info.entries.slice(0, config.bot.maxPlaylistSize)) {
                if (entry && (entry.id || entry.url)) {
                    try {
                        const track = {
                            title: entry.title || entry.fulltitle || unknownTitle,
                            artist: entry.uploader || entry.channel || entry.uploader_id || unknownArtist,
                            url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
                            duration: entry.duration || 0,
                            thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url,
                            platform: 'youtube',
                            type: 'track',
                            id: entry.id,
                        };

                        if (track.url) {
                            tracks.push(track);
                        }
                    } catch (entryError) {
                        continue;
                    }
                }
            }

            if (tracks.length === 0) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_valid_tracks') : 'No valid tracks found in playlist';
                throw new Error(errorMsg);
            }

            const unknownPlaylist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_playlist') : 'Unknown Playlist';

            return {
                title: info.title || unknownPlaylist,
                tracks: tracks,
                totalTracks: info.playlist_count || tracks.length,
                url: url,
                platform: 'youtube',
                type: 'playlist',
            };

        } catch (error) {
            console.error('[YouTube] getPlaylist() failed:', error.message || error);
            return null;
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

        // Handle formats like "3:45", "1:23:45", etc.
        const parts = durationString.split(':').reverse();
        let seconds = 0;

        for (let i = 0; i < parts.length; i++) {
            seconds += parseInt(parts[i]) * Math.pow(60, i);
        }

        return seconds;
    }

    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';

        // Ensure we work with integers to avoid floating point errors
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

    static async getRelatedVideos(videoId, limit = 5) {
        try {
            // This would implement getting related videos
            // For now, return empty array as YouTube API v3 doesn't provide related videos

            return [];
        } catch (error) {
            return [];
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

            // Try to get basic info to validate
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));

            return !!info && !!info.title;
        } catch (error) {
            return false;
        }
    }
}

module.exports = YouTube;