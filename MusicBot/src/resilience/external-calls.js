const { createCircuitBreaker, createCircuitBreakerWithFallback } = require('../resilience/circuit-breaker');
const { recordYtdlpCall, recordFfmpegCall, recordDiscordApiCall, recordExternalHttpCall, setCircuitBreakerState } = require('../observability/metrics');
const { logger } = require('../observability/logger');

const youtubedl = require('youtube-dl-exec');
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const config = require('../../config');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');
const fs = require('fs').promises;
const fsSync = require('fs');

const binaryPath = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpWrap = new YTDlpWrap(binaryPath);

// Configure youtube-dl-exec to use local binary
const youtubedlWithBinary = youtubedl.create(binaryPath);

/**
 * Circuit breakers for external services
 */

// yt-dlp circuit breaker
const ytdlpBreaker = createCircuitBreaker('yt-dlp', async (args, options = {}) => {
    const startTime = Date.now();
    try {
        const result = await youtubedlWithBinary(args, options);
        recordYtdlpCall(options.format || 'info', true);
        return result;
    } catch (error) {
        recordYtdlpCall(options.format || 'info', false);
        throw error;
    }
}, {
    timeout: 60000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

ytdlpBreaker.on('open', () => setCircuitBreakerState('yt-dlp', 'open'));
ytdlpBreaker.on('close', () => setCircuitBreakerState('yt-dlp', 'closed'));
ytdlpBreaker.on('halfOpen', () => setCircuitBreakerState('yt-dlp', 'halfOpen'));

// yt-dlp wrap circuit breaker (for search operations)
const ytdlpWrapBreaker = createCircuitBreaker('yt-dlp-wrap', async (args) => {
    const startTime = Date.now();
    try {
        const emitter = ytDlpWrap.exec(args);
        let stdoutBuffer = '';
        emitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });
        
        const results = await new Promise((resolve, reject) => {
            emitter.on('close', () => {
                const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                try {
                    resolve(lines.map(l => JSON.parse(l)));
                } catch (err) {
                    reject(err);
                }
            });
            emitter.on('error', (err) => reject(err));
        });
        
        recordYtdlpCall('search', true);
        return results;
    } catch (error) {
        recordYtdlpCall('search', false);
        throw error;
    }
}, {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

ytdlpWrapBreaker.on('open', () => setCircuitBreakerState('yt-dlp-wrap', 'open'));
ytdlpWrapBreaker.on('close', () => setCircuitBreakerState('yt-dlp-wrap', 'closed'));
ytdlpWrapBreaker.on('halfOpen', () => setCircuitBreakerState('yt-dlp-wrap', 'halfOpen'));

// FFmpeg circuit breaker
const ffmpegBreaker = createCircuitBreaker('ffmpeg', async (args, inputStream = null) => {
    return new Promise((resolve, reject) => {
        const ffmpegProcess = new prism.FFmpeg({
            command: ffmpegPath,
            args
        });

        if (inputStream) {
            inputStream.pipe(ffmpegProcess);
        }

        ffmpegProcess.on('close', (code) => {
            if (code === 0) {
                recordFfmpegCall('transcode', true);
                resolve();
            } else {
                recordFfmpegCall('transcode', false);
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });

        ffmpegProcess.on('error', (error) => {
            recordFfmpegCall('transcode', false);
            reject(error);
        });
    });
}, {
    timeout: 120000,
    errorThresholdPercentage: 50,
    resetTimeout: 60000
});

ffmpegBreaker.on('open', () => setCircuitBreakerState('ffmpeg', 'open'));
ffmpegBreaker.on('close', () => setCircuitBreakerState('ffmpeg', 'closed'));
ffmpegBreaker.on('halfOpen', () => setCircuitBreakerState('ffmpeg', 'halfOpen'));

// HTTP circuit breaker (for Invidious, YouTube API, etc.)
const httpBreaker = createCircuitBreaker('http', async (url, options = {}) => {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
}, {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

httpBreaker.on('open', () => setCircuitBreakerState('http', 'open'));
httpBreaker.on('close', () => setCircuitBreakerState('http', 'closed'));
httpBreaker.on('halfOpen', () => setCircuitBreakerState('http', 'halfOpen'));

// Discord API circuit breaker
const discordApiBreaker = createCircuitBreaker('discord-api', async (fn) => {
    return await fn();
}, {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

discordApiBreaker.on('open', () => setCircuitBreakerState('discord-api', 'open'));
discordApiBreaker.on('close', () => setCircuitBreakerState('discord-api', 'closed'));
discordApiBreaker.on('halfOpen', () => setCircuitBreakerState('discord-api', 'halfOpen'));

/**
 * Common yt-dlp options
 */
function getYtDlpOptions(extraOptions = {}) {
    const baseOptions = {
        noCheckCertificates: true,
        noWarnings: true,
        retries: 3,
        fragmentRetries: 3,
        addHeader: [
            'referer:youtube.com',
            'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        ...extraOptions
    };

    if (config.ytdl.poToken) {
        baseOptions.extractorArgs = `youtube:po_token=web+${config.ytdl.poToken};player_client=web`;
    } else if (config.ytdl.cookiesFromBrowser) {
        baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
    } else if (config.ytdl.cookiesFile) {
        baseOptions.cookies = config.ytdl.cookiesFile;
    } else {
        baseOptions.extractorArgs = 'youtube:player_client=web';
    }

    return baseOptions;
}

/**
 * Executes yt-dlp with circuit breaker protection
 * @param {string|string[]} args - yt-dlp arguments
 * @param {Object} options - yt-dlp options
 * @returns {Promise<any>}
 */
async function runYtdlp(args, options = {}) {
    return ytdlpBreaker.fire(args, { ...getYtDlpOptions(), ...options });
}

/**
 * Executes yt-dlp wrap (search) with circuit breaker protection
 * @param {string[]} args - yt-dlp wrap arguments
 * @returns {Promise<any[]>}
 */
async function runYtdlpWrap(args) {
    return ytdlpWrapBreaker.fire(args);
}

/**
 * Executes FFmpeg with circuit breaker protection
 * @param {string[]} args - FFmpeg arguments
 * @param {Readable} inputStream - Optional input stream
 * @returns {Promise<void>}
 */
async function runFfmpeg(args, inputStream = null) {
    return ffmpegBreaker.fire(args, inputStream);
}

/**
 * Makes HTTP request with circuit breaker protection
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function runHttpRequest(url, options = {}) {
    return httpBreaker.fire(url, options);
}

/**
 * Executes Discord API call with circuit breaker protection
 * @param {Function} fn - Discord API function
 * @returns {Promise<any>}
 */
async function runDiscordApiCall(fn) {
    return discordApiBreaker.fire(fn);
}

/**
 * Gets circuit breaker status for monitoring
 * @returns {Object}
 */
function getCircuitBreakerStatus() {
    return {
        'yt-dlp': ytdlpBreaker.status,
        'yt-dlp-wrap': ytdlpWrapBreaker.status,
        'ffmpeg': ffmpegBreaker.status,
        'http': httpBreaker.status,
        'discord-api': discordApiBreaker.status
    };
}

module.exports = {
    runYtdlp,
    runYtdlpWrap,
    runFfmpeg,
    runHttpRequest,
    runDiscordApiCall,
    getCircuitBreakerStatus,
    ytdlpBreaker,
    ytdlpWrapBreaker,
    ffmpegBreaker,
    httpBreaker,
    discordApiBreaker,
    getYtDlpOptions
};