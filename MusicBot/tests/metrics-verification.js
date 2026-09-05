/**
 * Metrics Verification Script
 * Verifies Prometheus metrics are correctly populated during tests
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

const REQUIRED_METRICS = [
    'voxaria_http_requests_total',
    'voxaria_http_request_duration_seconds',
    'voxaria_queue_depth',
    'voxaria_voice_connection_state',
    'voxaria_karaoke_job_duration_seconds',
    'voxaria_active_players',
    'voxaria_ytdlp_calls_total',
    'voxaria_ffmpeg_calls_total',
    'voxaria_discord_api_calls_total',
    'voxaria_external_http_calls_total',
    'voxaria_circuit_breaker_state',
    'voxaria_cache_hits_total',
    'voxaria_cache_misses_total'
];

const CIRCUIT_BREAKER_SERVICES = [
    'yt-dlp',
    'yt-dlp-wrap',
    'ffmpeg',
    'http',
    'discord-api',
    'demucs'
];

async function fetchMetrics() {
    try {
        const response = await axios.get(`${BASE_URL}/metrics`, {
            timeout: 10000,
            headers: { 'Accept': 'text/plain' }
        });
        return response.data;
    } catch (error) {
        console.error('Failed to fetch metrics:', error.message);
        return null;
    }
}

function parseMetrics(text) {
    const metrics = {};
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || line.trim() === '') continue;
        
        // Parse metric line: metric_name{labels} value
        const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?)/);
        if (match) {
            const name = match[1];
            const labels = match[2] || '';
            const value = parseFloat(match[3]);
            
            if (!metrics[name]) {
                metrics[name] = [];
            }
            metrics[name].push({ labels, value });
        }
    }
    
    return metrics;
}

function checkMetricExists(metrics, name) {
    return metrics[name] && metrics[name].length > 0;
}

function getMetricValue(metrics, name, labels = {}) {
    if (!metrics[name]) return null;
    
    for (const m of metrics[name]) {
        let matches = true;
        for (const [key, value] of Object.entries(labels)) {
            if (!m.labels.includes(`${key}="${value}"`)) {
                matches = false;
                break;
            }
        }
        if (matches) return m.value;
    }
    
    // Return first value if no labels specified
    return metrics[name][0]?.value || null;
}

function verifyMetrics(metrics) {
    console.log('\n📊 METRICS VERIFICATION');
    console.log('═══════════════════════════════════════');
    
    const results = {
        required: {},
        circuitBreakers: {},
        values: {}
    };
    
    // Check required metrics
    console.log('\n✅ Required Metrics:');
    for (const metric of REQUIRED_METRICS) {
        const exists = checkMetricExists(metrics, metric);
        results.required[metric] = exists;
        const status = exists ? '✅' : '❌';
        console.log(`   ${status} ${metric}`);
    }
    
    // Check circuit breaker state metrics
    console.log('\n🔌 Circuit Breaker States:');
    for (const service of CIRCUIT_BREAKER_SERVICES) {
        const value = getMetricValue(metrics, 'voxaria_circuit_breaker_state', { service });
        const stateMap = { 0: 'closed', 1: 'half-open', 2: 'open' };
        const state = value !== null ? stateMap[value] : 'missing';
        results.circuitBreakers[service] = { value, state };
        const status = value !== null ? '✅' : '❌';
        console.log(`   ${status} ${service}: ${state} (value: ${value})`);
    }
    
    // Check specific metric values
    console.log('\n📈 Key Metric Values:');
    
    // HTTP requests
    const httpTotal = getMetricValue(metrics, 'voxaria_http_requests_total');
    results.values.httpRequestsTotal = httpTotal;
    console.log(`   HTTP Requests Total: ${httpTotal || 'N/A'}`);
    
    // Queue depth (check for any guild)
    const queueDepthMetrics = metrics['voxaria_queue_depth'] || [];
    if (queueDepthMetrics.length > 0) {
        console.log(`   Queue Depth (per guild):`);
        for (const m of queueDepthMetrics) {
            console.log(`      ${m.labels}: ${m.value}`);
        }
    } else {
        console.log(`   Queue Depth: No data`);
    }
    results.values.queueDepth = queueDepthMetrics.length > 0;
    
    // Voice connection state
    const voiceStateMetrics = metrics['voxaria_voice_connection_state'] || [];
    if (voiceStateMetrics.length > 0) {
        console.log(`   Voice Connection State:`);
        for (const m of voiceStateMetrics) {
            console.log(`      ${m.labels}: ${m.value} (${m.value === 1 ? 'connected' : 'disconnected'})`);
        }
    } else {
        console.log(`   Voice Connection State: No data`);
    }
    results.values.voiceConnectionState = voiceStateMetrics.length > 0;
    
    // Karaoke job duration
    const karaokeDuration = getMetricValue(metrics, 'voxaria_karaoke_job_duration_seconds');
    results.values.karaokeDuration = karaokeDuration;
    console.log(`   Karaoke Job Duration: ${karaokeDuration || 'N/A'} (count: ${metrics['voxaria_karaoke_job_duration_seconds_count']?.[0]?.value || 0})`);
    
    // yt-dlp calls
    const ytdlpSuccess = getMetricValue(metrics, 'voxaria_ytdlp_calls_total', { status: 'success' });
    const ytdlpError = getMetricValue(metrics, 'voxaria_ytdlp_calls_total', { status: 'error' });
    results.values.ytdlpCalls = { success: ytdlpSuccess, error: ytdlpError };
    console.log(`   yt-dlp Calls: success=${ytdlpSuccess || 0}, error=${ytdlpError || 0}`);
    
    // FFmpeg calls
    const ffmpegSuccess = getMetricValue(metrics, 'voxaria_ffmpeg_calls_total', { status: 'success' });
    const ffmpegError = getMetricValue(metrics, 'voxaria_ffmpeg_calls_total', { status: 'error' });
    results.values.ffmpegCalls = { success: ffmpegSuccess, error: ffmpegError };
    console.log(`   FFmpeg Calls: success=${ffmpegSuccess || 0}, error=${ffmpegError || 0}`);
    
    // Active players
    const activePlayers = getMetricValue(metrics, 'voxaria_active_players');
    results.values.activePlayers = activePlayers;
    console.log(`   Active Players: ${activePlayers || 0}`);
    
    // Cache hits/misses
    const cacheHits = getMetricValue(metrics, 'voxaria_cache_hits_total');
    const cacheMisses = getMetricValue(metrics, 'voxaria_cache_misses_total');
    results.values.cache = { hits: cacheHits, misses: cacheMisses };
    console.log(`   Cache: hits=${cacheHits || 0}, misses=${cacheMisses || 0}`);
    
    return results;
}

function generateReport(results) {
    console.log('\n═══════════════════════════════════════');
    console.log('  METRICS VERIFICATION SUMMARY');
    console.log('═══════════════════════════════════════');
    
    const requiredPassed = Object.values(results.required).filter(v => v).length;
    const requiredTotal = Object.keys(results.required).length;
    
    const cbPassed = Object.values(results.circuitBreakers).filter(v => v.value !== null).length;
    const cbTotal = Object.keys(results.circuitBreakers).length;
    
    console.log(`\nRequired Metrics: ${requiredPassed}/${requiredTotal} present`);
    console.log(`Circuit Breaker Metrics: ${cbPassed}/${cbTotal} present`);
    
    const allRequired = requiredPassed === requiredTotal;
    const allCB = cbPassed === cbTotal;
    
    console.log(`\n${allRequired && allCB ? '✅ ALL METRICS VERIFIED' : '❌ SOME METRICS MISSING'}`);
    
    return { allRequired, allCB, results };
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  METRICS VERIFICATION');
    console.log('═══════════════════════════════════════');
    console.log(`Fetching metrics from ${BASE_URL}/metrics`);
    
    const metricsText = await fetchMetrics();
    if (!metricsText) {
        console.log('❌ Failed to fetch metrics');
        return false;
    }
    
    console.log(`\nFetched ${metricsText.length} characters of metrics`);
    
    const metrics = parseMetrics(metricsText);
    console.log(`Parsed ${Object.keys(metrics).length} unique metric names`);
    
    const results = verifyMetrics(metrics);
    const report = generateReport(results);
    
    return report.allRequired && report.allCB;
}

if (require.main === module) {
    main()
        .then(passed => process.exit(passed ? 0 : 1))
        .catch(err => {
            console.error('Metrics verification error:', err);
            process.exit(1);
        });
}

module.exports = { main, fetchMetrics, parseMetrics, verifyMetrics, REQUIRED_METRICS, CIRCUIT_BREAKER_SERVICES };