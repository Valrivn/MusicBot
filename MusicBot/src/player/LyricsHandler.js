const LyricsManager = require('../LyricsManager');

class LyricsHandler {
    constructor() {
        this.manager = LyricsManager;
    }

    /**
     * Fetch lyrics with wave-based orchestration
     * Wave 1: Cache checks + LyricsMatcher (LRCLIB + MusicBrainz) + pre-fetched transcript
     * Wave 2: Parallel Genius + YouTube Music
     * Final Resort: Active YouTube transcript fetch
     * @param {Object} track - Track object with title, artist, url
     * @param {boolean} forceResync - Bypass all caches
     * @returns {Promise<Object|null>} Lyrics object or null
     */
    async fetchLyrics(track, forceResync = false) {
        if (!track || !track.title) {
            if (this.isDebug) console.log('[LyricsHandler] No track or title provided');
            return null;
        }

        const cleanTitle = this.cleanTrackTitleForLogging(track.title);
        const cleanArtist = (track.lyricArtist || track.artist || '').trim();
        const videoId = track.url ? this.extractYtVideoIdForLogging(track.url) : 'unknown';

        console.log(`🌊 [LyricsHandler] Wave orchestration started for "${cleanTitle}" - "${cleanArtist}" (videoId: ${videoId})`);

        if (forceResync) {
            console.log(`🔄 [LyricsHandler] forceResync=true - bypassing all caches`);
        }

        // Wave 1: Cache checks + LyricsMatcher handshake + pre-fetched transcript
        if (this.isDebug) console.log(`📥 [LyricsHandler] Wave 1: Checking caches & LyricsMatcher...`);
        
        const wave1Result = await this.manager.fetchLyrics(track, forceResync);
        
        if (wave1Result) {
            const isSynced = wave1Result.hasSynced || wave1Result.synced;
            console.log(`✅ [LyricsHandler] Wave 1 completed: Found lyrics from ${wave1Result.source} (synced: ${isSynced})`);
            return wave1Result;
        }

        if (this.isDebug) console.log(`⬇️ [LyricsHandler] Wave 1 yielded no results, proceeding to Wave 2...`);

        // Wave 2: Parallel Genius + YouTube Music (already handled inside LyricsManager.fetchLyrics)
        // Note: LyricsManager.fetchLyrics already runs Wave 2 internally if Wave 1 has no synced match
        // But we only reach here if Wave 1 returned NO results at all (not even plain text)
        // In that case, LyricsManager has already attempted Wave 2 and Final Resort internally

        // If we're here, LyricsManager returned null - meaning all waves exhausted
        console.log(`❌ [LyricsHandler] All waves exhausted - no lyrics found`);
        return null;
    }

    /**
     * Clean track title for logging (UI-specific helper)
     */
    cleanTrackTitleForLogging(title = '') {
        return title
            .replace(/\(.*?\)/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/official video/gi, '')
            .replace(/official audio/gi, '')
            .replace(/lyric video/gi, '')
            .replace(/lyrics/gi, '')
            .replace(/4k/gi, '')
            .replace(/hd/gi, '')
            .trim();
    }

    /**
     * Extract YouTube video ID for logging (UI-specific helper)
     */
    extractYtVideoIdForLogging(url) {
        if (!url) return 'unknown';
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : 'unknown';
    }

    /**
     * Debug flag helper
     */
    get isDebug() {
        return process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true' || (global.config?.debug === true);
    }

    /**
     * Format full lyrics for display (with pagination support) - UI-specific
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
     * Clear cache - UI-specific
     */
    clearCache() {
        this.manager.clearCache();
    }

    /**
     * Backward compatibility wrapper for fetchFromLrclib
     * @deprecated Use LyricsManager.fetchFromLrclib directly
     */
    async fetchFromLrclib(track) {
        return this.manager.fetchFromLrclib(track);
    }

    /**
     * Backward compatibility wrapper for fetchFromGenius
     * @deprecated Use LyricsManager.fetchFromGenius directly
     */
    async fetchFromGenius(track) {
        return this.manager.fetchFromGenius(track);
    }
}

module.exports = new LyricsHandler();