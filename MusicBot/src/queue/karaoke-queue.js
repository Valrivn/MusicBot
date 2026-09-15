const { Queue } = require('bullmq');
const Redis = require('ioredis');

let karaokeQueue = null;
let redisConnection = null;

function initKaraokeQueue() {
    if (karaokeQueue) return { karaokeQueue, redisConnection };
    
    // Prefer an injected REDIS_URL (Railway provides one) and fall back to
    // explicit host/port vars. Defaults target a local Redis on 127.0.0.1:6379.
    const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

    redisConnection = new Redis(redisUrl, {
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => Math.min(times * 200, 2000),
        enableReadyCheck: true,
        lazyConnect: true,
    });

    redisConnection.on('error', (err) => {
        console.error('[KaraokeQueue] Redis connection error:', err.message);
    });

    redisConnection.on('connect', () => {
        console.log('[KaraokeQueue] Redis connected');
    });

    karaokeQueue = new Queue('karaoke', {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: 100,
            removeOnFail: 50,
            priority: 10,
        },
    });

    karaokeQueue.on('error', (err) => {
        console.error('[KaraokeQueue] Queue error:', err.message);
    });

    return { karaokeQueue, redisConnection };
}

// Lazy initialization - only initialize when actually needed
module.exports = {
    get karaokeQueue() {
        return initKaraokeQueue().karaokeQueue;
    },
    get redisConnection() {
        return initKaraokeQueue().redisConnection;
    },
    initKaraokeQueue,
};