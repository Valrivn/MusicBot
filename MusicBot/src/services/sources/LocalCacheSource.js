const { MediaSource } = require('../media-source');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', '..', 'audio_cache');

class LocalCacheSource extends MediaSource {
    constructor() {
        super('local');
    }

    async resolve(query) {
        if (!query || !query.trim()) {
            return [];
        }

        const isUrl = this._isYouTubeURL(query);
        
        if (!isUrl) {
            return [];
        }

        const videoId = this._extractVideoId(query);
        if (!videoId) return [];

        const hash = crypto.createHash('md5').update(query).digest('hex');
        const filepath = path.join(CACHE_DIR, `track_${hash}.opus`);

        try {
            if (!fsSync.existsSync(filepath)) {
                return [];
            }

            const stats = await fs.stat(filepath);
            if (stats.size === 0) {
                return [];
            }

            return [{
                url: filepath,
                title: query,
                duration: 0,
                thumbnail: null,
                source: 'local',
                quality: 'high',
                id: videoId,
                localPath: filepath,
                fileSize: stats.size
            }];
        } catch (err) {
            console.warn('[LocalCacheSource] Resolve failed:', err.message);
            return [];
        }
    }

    async probe(url) {
        if (!url || !fsSync.existsSync(url)) return null;

        try {
            const stats = await fs.stat(url);
            if (stats.size === 0) return null;

            return {
                codec: 'opus',
                bitrate: 128000,
                duration: 0,
                isStudioCut: true,
                fingerprint: crypto.createHash('sha256').update(url).digest('hex').substring(0, 16),
                source: 'local'
            };
        } catch (err) {
            console.warn(`[LocalCacheSource] Probe failed for ${url}:`, err.message);
            return null;
        }
    }

    _isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    _extractVideoId(url) {
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

    static getCachePath(query) {
        const hash = crypto.createHash('md5').update(query).digest('hex');
        return path.join(CACHE_DIR, `track_${hash}.opus`);
    }

    static async hasCached(query) {
        const filepath = this.getCachePath(query);
        try {
            const stats = await fs.stat(filepath);
            return stats.size > 0;
        } catch {
            return false;
        }
    }
}

module.exports = LocalCacheSource;