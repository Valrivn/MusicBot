const promClient = require('prom-client');
const { logger } = require('./logger');

const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register, prefix: 'voxaria_' });

// HTTP Request metrics
const httpRequestsTotal = new promClient.Counter({
    name: 'voxaria_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
    name: 'voxaria_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
});

// Music bot specific metrics
const queueDepth = new promClient.Gauge({
    name: 'voxaria_queue_depth',
    help: 'Current queue depth per guild',
    labelNames: ['guild_id'],
    registers: [register]
});

const voiceConnectionState = new promClient.Gauge({
    name: 'voxaria_voice_connection_state',
    help: 'Voice connection state (1=connected, 0=disconnected)',
    labelNames: ['guild_id'],
    registers: [register]
});

const karaokeJobDuration = new promClient.Histogram({
    name: 'voxaria_karaoke_job_duration_seconds',
    help: 'Karaoke job processing time',
    buckets: [10, 30, 60, 120, 300, 600],
    registers: [register]
});

const trackPlayDuration = new promClient.Histogram({
    name: 'voxaria_track_play_duration_seconds',
    help: 'Track play duration',
    labelNames: ['platform'],
    buckets: [30, 60, 120, 180, 300, 600, 1200, 1800],
    registers: [register]
});

const activePlayers = new promClient.Gauge({
    name: 'voxaria_active_players',
    help: 'Number of active music players',
    registers: [register]
});

const ytdlpCalls = new promClient.Counter({
    name: 'voxaria_ytdlp_calls_total',
    help: 'Total yt-dlp calls',
    labelNames: ['operation', 'status'],
    registers: [register]
});

const ffmpegCalls = new promClient.Counter({
    name: 'voxaria_ffmpeg_calls_total',
    help: 'Total FFmpeg calls',
    labelNames: ['operation', 'status'],
    registers: [register]
});

const discordApiCalls = new promClient.Counter({
    name: 'voxaria_discord_api_calls_total',
    help: 'Total Discord API calls',
    labelNames: ['endpoint', 'status'],
    registers: [register]
});

const externalHttpCalls = new promClient.Counter({
    name: 'voxaria_external_http_calls_total',
    help: 'Total external HTTP calls (Invidious, YouTube API, etc.)',
    labelNames: ['service', 'status'],
    registers: [register]
});

const circuitBreakerState = new promClient.Gauge({
    name: 'voxaria_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['service'],
    registers: [register]
});

const cacheHits = new promClient.Counter({
    name: 'voxaria_cache_hits_total',
    help: 'Cache hits',
    labelNames: ['cache_type'],
    registers: [register]
});

const cacheMisses = new promClient.Counter({
    name: 'voxaria_cache_misses_total',
    help: 'Cache misses',
    labelNames: ['cache_type'],
    registers: [register]
});

const rateLimitRejections = new promClient.Counter({
    name: 'voxaria_rate_limit_rejections_total',
    help: 'Requests rejected by rate limiter',
    labelNames: ['limit_type'],
    registers: [register]
});

/**
 * Records an HTTP request
 */
function recordHttpRequest(method, route, statusCode, durationMs) {
    httpRequestsTotal.inc({ method, route, status: statusCode });
    httpRequestDuration.observe({ method, route }, durationMs / 1000);
}

/**
 * Updates queue depth for a guild
 */
function setQueueDepth(guildId, depth) {
    queueDepth.set({ guild_id: guildId }, depth);
}

/**
 * Updates voice connection state
 */
function setVoiceConnectionState(guildId, connected) {
    voiceConnectionState.set({ guild_id: guildId }, connected ? 1 : 0);
}

/**
 * Records karaoke job duration
 */
function recordKaraokeJobDuration(durationSeconds) {
    karaokeJobDuration.observe(durationSeconds);
}

/**
 * Records track play duration
 */
function recordTrackPlayDuration(platform, durationSeconds) {
    trackPlayDuration.observe({ platform }, durationSeconds);
}

/**
 * Sets active players count
 */
function setActivePlayers(count) {
    activePlayers.set(count);
}

/**
 * Records yt-dlp call
 */
function recordYtdlpCall(operation, success) {
    ytdlpCalls.inc({ operation, status: success ? 'success' : 'error' });
}

/**
 * Records FFmpeg call
 */
function recordFfmpegCall(operation, success) {
    ffmpegCalls.inc({ operation, status: success ? 'success' : 'error' });
}

/**
 * Records Discord API call
 */
function recordDiscordApiCall(endpoint, success) {
    discordApiCalls.inc({ endpoint, status: success ? 'success' : 'error' });
}

/**
 * Records external HTTP call
 */
function recordExternalHttpCall(service, success) {
    externalHttpCalls.inc({ service, status: success ? 'success' : 'error' });
}

/**
 * Updates circuit breaker state metric
 */
function setCircuitBreakerState(service, state) {
    // 0=closed, 1=half-open, 2=open
    const stateMap = { closed: 0, halfOpen: 1, open: 2 };
    circuitBreakerState.set({ service }, stateMap[state] ?? 0);
}

/**
 * Records cache hit/miss
 */
function recordCacheHit(cacheType) {
    cacheHits.inc({ cache_type: cacheType });
}

function recordCacheMiss(cacheType) {
    cacheMisses.inc({ cache_type: cacheType });
}

/**
 * Records rate limit rejection
 */
function recordRateLimitRejection(limitType) {
    rateLimitRejections.inc({ limit_type: limitType });
}

/**
 * Gets metrics in Prometheus format
 */
async function getMetrics() {
    return register.metrics();
}

/**
 * Gets metrics as JSON
 */
async function getMetricsAsJson() {
    return register.getMetricsAsJSON();
}

module.exports = {
    register,
    recordHttpRequest,
    setQueueDepth,
    setVoiceConnectionState,
    recordKaraokeJobDuration,
    recordTrackPlayDuration,
    setActivePlayers,
    recordYtdlpCall,
    recordFfmpegCall,
    recordDiscordApiCall,
    recordExternalHttpCall,
    setCircuitBreakerState,
    recordCacheHit,
    recordCacheMiss,
    recordRateLimitRejection,
    getMetrics,
    getMetricsAsJson,
    // Expose metrics for direct access
    httpRequestsTotal,
    httpRequestDuration,
    queueDepth,
    voiceConnectionState,
    karaokeJobDuration,
    trackPlayDuration,
    activePlayers,
    ytdlpCalls,
    ffmpegCalls,
    discordApiCalls,
    externalHttpCalls,
    circuitBreakerState,
    cacheHits,
    cacheMisses,
    rateLimitRejections
};