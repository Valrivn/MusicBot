const { Queue } = require('bullmq');
const Redis = require('ioredis');

let karaokeQueue = null;
let redisConnection = null;

function initKaraokeQueue() {
    if (karaokeQueue) return { karaokeQueue, redisConnection };
    
    redisConnection = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: 3,
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