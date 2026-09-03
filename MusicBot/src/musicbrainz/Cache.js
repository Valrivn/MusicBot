const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'tmp', 'musicbrainz_cache');
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

class FileCache {
    constructor(options = {}) {
        this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    }

    _getCachePath(key) {
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 200);
        return path.join(CACHE_DIR, `${safeKey}.json`);
    }

    async get(key) {
        const cachePath = this._getCachePath(key);
        try {
            if (!fs.existsSync(cachePath)) return null;

            const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const now = Date.now();

            if (data.expiresAt && now > data.expiresAt) {
                fs.unlinkSync(cachePath);
                return null;
            }

            return data.value;
        } catch (err) {
            return null;
        }
    }

    async set(key, value) {
        const cachePath = this._getCachePath(key);
        try {
            const data = {
                value,
                createdAt: Date.now(),
                expiresAt: Date.now() + this.ttlMs
            };
            fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
        } catch (err) {
            // Ignore cache write errors
        }
    }

    async delete(key) {
        const cachePath = this._getCachePath(key);
        try {
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        } catch (err) {
            // Ignore
        }
    }

    async clear() {
        try {
            const files = fs.readdirSync(CACHE_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                }
            }
        } catch (err) {
            // Ignore
        }
    }
}

const recordingCache = new FileCache({ ttlMs: 30 * 24 * 60 * 60 * 1000 }); // 30 days for recordings
const artworkCache = new FileCache({ ttlMs: 7 * 24 * 60 * 60 * 1000 }); // 7 days for artwork

module.exports = { FileCache, recordingCache, artworkCache };