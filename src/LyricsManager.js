const axios = require('axios');
const Genius = require('genius-lyrics');
const config = require('../config');

class LyricsManager {
    constructor() {
        this.cache = new Map(); // Cache lyrics by track URL
        this.cacheTimers = new Map(); // Track cache expiration timers
        
        // Initialize Genius client (works without token via web scraping)
        // Token can be added later for higher rate limits: new Genius.Client(token)
        this.geniusClient = new Genius.Client();
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

    storeInCache(trackId, data) {
        if (!trackId || !data) return;

        this.cache.set(trackId, data);

        const fs = require('fs');
        const path = require('path');
        const cacheFilePath = path.join(__dirname, '..', 'audio_cache', `lyrics_${trackId}.json`);

        let shouldWrite = true;
        if (fs.existsSync(cacheFilePath)) {
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
    async fetchLyrics(track, forceResync = false) {
        if (!track || !track.title) return null;

        const videoId = track.url ? this.extractYtVideoId(track.url) : 'unknown';
        const cleanTitle = this.cleanTrackTitle(track.title);
        const cleanArtist = (track.artist || track.uploader || '').trim();
        const crypto = require('crypto');
        const trackId = videoId !== 'unknown' ? videoId : crypto.createHash('md5').update(`${cleanTitle}-${cleanArtist}`).digest('hex');

        const fs = require('fs');
        const path = require('path');
        const cacheFilePath = path.join(__dirname, '..', 'audio_cache', `lyrics_${trackId}.json`);

        // Lock Down Active API Bypassing
        if (forceResync !== true && fs.existsSync(cacheFilePath)) {
            try {
                const cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                console.log(`[LyricsManager] Cache hit (file): Returning cached lyrics for ${trackId}`);
                return cachedData;
            } catch (e) {
                console.error("Failed to read cached lyrics file:", e);
            }
        }

        // Try Genius first
        const geniusResult = await this.fetchFromGenius(track);
        if (geniusResult && geniusResult.plain) {
            this.storeInCache(trackId, geniusResult);
            return geniusResult;
        }

        // Fallback to LRCLIB
        const lrclibResult = await this.fetchFromLrclib(track);
        if (lrclibResult && lrclibResult.plain) {
            this.storeInCache(trackId, lrclibResult);
            return lrclibResult;
        }

        // Cache null result to avoid repeated lookups
        this.cache.set(trackId, null);
        return null;
    }





    async fetchFromLrclib(track) {
        try {
            const artist = track.artist || track.uploader || '';
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
            const artist = track.artist || track.uploader || '';
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
