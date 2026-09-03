const config = require('../../config');
const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, '..', '..', 'tmp', 'musicbrainz_ratelimit.lock');
const LOCK_DIR = path.dirname(LOCK_FILE);

if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
}

let redisClient = null;
if (config.redis?.enabled && config.redis?.url) {
    try {
        const { createClient } = require('redis');
        redisClient = createClient({ url: config.redis.url });
        redisClient.connect().catch(err => {
            console.warn('[RateLimiter] Redis connection failed, falling back to file lock:', err.message);
            redisClient = null;
        });
    } catch (err) {
        console.warn('[RateLimiter] Redis module not available, using file lock');
    }
}

class ShardSafeRateLimiter {
    constructor(options = {}) {
        this.requestsPerSecond = options.requestsPerSecond || 1;
        this.minIntervalMs = 1000 / this.requestsPerSecond;
        this.lastRequestTime = 0;
    }

    async acquire() {
        if (redisClient) {
            return this._acquireRedis();
        }
        return this._acquireFileLock();
    }

    async _acquireRedis() {
        const key = 'musicbrainz:ratelimit';
        const now = Date.now();
        const windowMs = 1000;

        while (true) {
            const current = await redisClient.get(key);
            const timestamps = current ? JSON.parse(current) : [];
            
            const validTimestamps = timestamps.filter(ts => now - ts < windowMs);
            
            if (validTimestamps.length < this.requestsPerSecond) {
                validTimestamps.push(now);
                await redisClient.setEx(key, 2, JSON.stringify(validTimestamps));
                this.lastRequestTime = now;
                return;
            }

            const oldestValid = validTimestamps[0];
            const waitTime = windowMs - (now - oldestValid) + 10;
            await new Promise(resolve => setTimeout(resolve, Math.max(10, waitTime)));
        }
    }

    async _acquireFileLock() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest >= this.minIntervalMs) {
            this.lastRequestTime = now;
            this._writeLockFile(now);
            return;
        }

        const waitTime = this.minIntervalMs - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        this.lastRequestTime = Date.now();
        this._writeLockFile(this.lastRequestTime);
    }

    _writeLockFile(timestamp) {
        try {
            fs.writeFileSync(LOCK_FILE, timestamp.toString(), { flag: 'w' });
        } catch (err) {
            // Ignore write errors
        }
    }

    static createGlobalLimiter() {
        return new ShardSafeRateLimiter({ requestsPerSecond: 1 });
    }
}

module.exports = { ShardSafeRateLimiter, redisClient };