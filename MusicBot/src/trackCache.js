const fs = require('fs');
const path = require('path');
const config = require('../config');

const CACHE_DIR = path.join(__dirname, '..', config.trackCache.directory);

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

class TrackCache {
    constructor() {
        this.cache = new Map();
        this.loadCache();
    }

    loadCache() {
        try {
            const files = fs.readdirSync(CACHE_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const filePath = path.join(CACHE_DIR, file);
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (data && data.key && data.value) {
                            if (data.expiresAt > Date.now()) {
                                this.cache.set(data.key, data);
                            } else {
                                fs.unlinkSync(filePath);
                            }
                        }
                    } catch (e) {
                        console.error(`[TrackCache] Failed to load cache file ${file}:`, e.message);
                    }
                }
            }
            console.log(`[TrackCache] Loaded ${this.cache.size} entries from disk`);
        } catch (e) {
            console.error('[TrackCache] Failed to load cache:', e.message);
        }
    }

    _getCacheFilePath(key) {
        const safeKey = key.replace(/[^a-zA-Z0-9_:]/g, '_');
        return path.join(CACHE_DIR, `${safeKey}.json`);
    }

    _getTierTTL(tier) {
        const ttlConfig = config.trackCache.ttl;
        if (tier === 'mainstream') {
            return ttlConfig.mainstream;
        }
        return ttlConfig.indie;
    }

    _determineTier(metadata) {
        const threshold = config.trackCache.mainstreamThreshold;
        const popularityCount = metadata.popularityCount || 0;
        const majorLabel = metadata.majorLabel === true;
        
        if (popularityCount >= threshold.popularityCount || (threshold.requireMajorLabel && majorLabel)) {
            return 'mainstream';
        }
        return 'indie';
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        
        if (entry.expiresAt <= Date.now()) {
            this.cache.delete(key);
            try {
                fs.unlinkSync(this._getCacheFilePath(key));
            } catch (e) {}
            return null;
        }
        return entry.value;
    }

    set(key, value, tier = null) {
        if (!tier) {
            tier = this._determineTier(value);
        }
        const ttl = this._getTierTTL(tier);
        const now = Date.now();
        const entry = {
            key,
            value,
            createdAt: now,
            expiresAt: now + ttl,
            tier
        };
        this.cache.set(key, entry);
        
        try {
            fs.writeFileSync(this._getCacheFilePath(key), JSON.stringify(entry, null, 2), 'utf8');
        } catch (e) {
            console.error('[TrackCache] Failed to write cache file:', e.message);
        }
        console.log(`[TrackCache] SET: ${key} (tier: ${tier}, TTL: ${Math.round(ttl / (24 * 60 * 60 * 1000))}d)`);
    }

    delete(key) {
        this.cache.delete(key);
        try {
            fs.unlinkSync(this._getCacheFilePath(key));
        } catch (e) {}
    }

    clear() {
        this.cache.clear();
        try {
            const files = fs.readdirSync(CACHE_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                }
            }
        } catch (e) {
            console.error('[TrackCache] Failed to clear cache:', e.message);
        }
    }

    normalizeKey(title, artist, durationSec) {
        const normalize = (str) => (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 80);
        
        return `track:${normalize(title)}:${normalize(artist)}:${durationSec}`;
    }
}

module.exports = new TrackCache();