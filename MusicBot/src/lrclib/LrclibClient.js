const axios = require('axios');

const LRCLIB_BASE_URL = 'https://lrclib.net/api';

const axiosInstance = axios.create({
    timeout: 2000,
    headers: {
        'User-Agent': 'VoxariaMusicBot/1.0.0'
    }
});

// Helper function to retry an async axios request when timeouts or transient network errors occur
async function requestWithRetry(fn, retries = 2, delayMs = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
            console.warn(`[LrclibClient] Request attempt ${attempt} failed: ${error.message}.${attempt < retries ? ` Retrying in ${delayMs}ms...` : ''}`);
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                throw error;
            }
        }
    }
}

class LrclibClient {
    static async searchTrack(title, artist) {
        try {
            const response = await requestWithRetry(() => axiosInstance.get(`${LRCLIB_BASE_URL}/search`, {
                params: {
                    track_name: title,
                    artist_name: artist
                }
            }));

            if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                return null;
            }

            const syncedResults = response.data.filter(r => r.syncedLyrics);
            const results = syncedResults.length > 0 ? syncedResults : response.data;

            const bestMatch = results[0];
            
            return {
                title: bestMatch.trackName,
                artist: bestMatch.artistName,
                album: bestMatch.albumName,
                durationMs: bestMatch.duration * 1000,
                durationSec: bestMatch.duration,
                hasSyncedLyrics: !!bestMatch.syncedLyrics,
                syncedLyrics: bestMatch.syncedLyrics,
                plainLyrics: bestMatch.plainLyrics,
                lrclibId: bestMatch.id
            };
        } catch (error) {
            console.error('[LrclibClient] Search error:', error.message);
            return null;
        }
    }

    static async searchAllTracks(title, artist) {
        try {
            const response = await requestWithRetry(() => axiosInstance.get(`${LRCLIB_BASE_URL}/search`, {
                params: {
                    track_name: title,
                    artist_name: artist
                }
            }));

            if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                return [];
            }

            const candidates = response.data
                .filter(r => r.syncedLyrics)
                .map(match => ({
                    title: match.trackName,
                    artist: match.artistName,
                    album: match.albumName,
                    durationMs: match.duration * 1000,
                    durationSec: match.duration,
                    hasSyncedLyrics: !!match.syncedLyrics,
                    syncedLyrics: match.syncedLyrics,
                    plainLyrics: match.plainLyrics,
                    lrclibId: match.id
                }));

            console.log(`[LrclibClient] Found ${candidates.length} synced lyric candidates for "${title}" - "${artist}"`);
            return candidates;
        } catch (error) {
            console.error('[LrclibClient] SearchAllTracks error:', error.message);
            return [];
        }
    }

    static async getTrackById(id) {
        try {
            const response = await requestWithRetry(() => axiosInstance.get(`${LRCLIB_BASE_URL}/get/${id}`));
            return response.data;
        } catch (error) {
            console.error('[LrclibClient] Get by ID error:', error.message);
            return null;
        }
    }
}

module.exports = LrclibClient;