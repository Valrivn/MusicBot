const Redis = require('ioredis');

let redis = null;
let memoryStore = new Map();
const config = {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    burstMax: parseInt(process.env.RATE_LIMIT_BURST || '20', 10),
};

function getRedis() {
    if (redis) return redis;
    try {
        redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
        });
        redis.connect().catch(() => {
            console.error('⚠️ Rate limiter: Redis unavailable, falling back to in-memory');
            redis = null;
        });
    } catch (e) {
        console.error('⚠️ Rate limiter: Redis init failed, using in-memory');
        redis = null;
    }
    return redis;
}

async function checkRedis(key, limit, windowSec) {
    try {
        const r = getRedis();
        if (!r) return null;
        
        const current = await r.incr(key);
        if (current === 1) {
            await r.expire(key, windowSec);
        }
        return current;
    } catch (e) {
        return null;
    }
}

function checkMemory(key, limit, windowMs) {
    const now = Date.now();
    const entry = memoryStore.get(key);
    
    if (!entry || now - entry.resetAt > windowMs) {
        memoryStore.set(key, { count: 1, resetAt: now + windowMs });
        // Trim old entries
        if (memoryStore.size > 10000) {
            for (const [k, v] of memoryStore) {
                if (now - v.resetAt > windowMs) memoryStore.delete(k);
            }
        }
        return { count: 1, allowed: true };
    }
    
    entry.count++;
    return { count: entry.count, allowed: entry.count <= limit, resetAt: entry.resetAt };
}

function getClientKey(req) {
    // Use x-user-id if provided (authenticated), else IP
    const userId = req.headers['x-user-id'] || req.headers['X-User-Id'];
    if (userId) return `rl:user:${userId}`;
    
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    return `rl:ip:${ip}`;
}

function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || config.windowMs;
    const max = options.max || config.maxRequests;
    const burstMax = options.burstMax || config.burstMax;
    
    return async function rateLimit(req, res, next) {
        if (!config.enabled) return next();
        
        const key = getClientKey(req);
        const windowSec = Math.ceil(windowMs / 1000);
        
        // Try Redis first
        let result = await checkRedis(key, max, windowSec);
        
        if (result === null) {
            // Fallback to in-memory
            const memResult = checkMemory(key, max, windowMs);
            result = memResult.count;
            if (!memResult.allowed) {
                const { recordRateLimitRejection } = require('../observability/metrics');
                recordRateLimitRejection('user');
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: Math.ceil((memResult.resetAt - Date.now()) / 1000),
                });
            }
        } else if (result > max) {
            // Check burst allowance
            if (result > max + burstMax) {
                const { recordRateLimitRejection } = require('../observability/metrics');
                recordRateLimitRejection('user');
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: Math.ceil(windowSec),
                });
            }
        }
        
        // Set headers
        res.setHeader('X-RateLimit-Limit', max.toString());
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - result).toString());
        
        next();
    };
}

// Specialized limiters for different endpoints
const apiLimiter = createRateLimiter({ max: 200, windowMs: 60 * 1000 });
const truncLimiter = createRateLimiter({ max: 300, windowMs: 60 * 1000 });
const authLimiter = createRateLimiter({ max: 20, windowMs: 60 * 1000 });
const karaokeLimiter = createRateLimiter({ max: 30, windowMs: 60 * 1000 });

module.exports = {
    createRateLimiter,
    apiLimiter,
    truncLimiter,
    authLimiter,
    karaokeLimiter,
};
