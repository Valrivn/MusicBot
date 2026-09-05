/**
 * Load Test Script for Voxaria Music Bot
 * Tests concurrent requests to API endpoints
 */

const axios = require('axios');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const WS_URL = process.env.WS_URL || 'ws://localhost:3002';

const TEST_CONFIG = {
    stages: [
        { duration: 30000, target: 10, name: 'Ramp up' },
        { duration: 60000, target: 50, name: 'Sustained load' },
        { duration: 30000, target: 100, name: 'Stress' },
        { duration: 30000, target: 0, name: 'Ramp down' }
    ],
    thresholds: {
        http_req_duration: { p95: 2000 },
        http_req_failed: { rate: 0.01 }
    }
};

const METRICS = {
    requests: { total: 0, success: 0, failed: 0, durations: [] },
    wsConnections: { total: 0, active: 0, failed: 0 },
    errors: []
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function recordRequest(duration, success, error = null) {
    METRICS.requests.total++;
    METRICS.requests.durations.push(duration);
    if (success) {
        METRICS.requests.success++;
    } else {
        METRICS.requests.failed++;
        if (error) METRICS.errors.push(error);
    }
}

async function makeRequest(method, path, data = null, headers = {}) {
    const start = performance.now();
    try {
        const response = await axios({
            method,
            url: `${BASE_URL}${path}`,
            data,
            headers: {
                'Content-Type': 'application/json',
                'x-guild-id': 'test-guild-123',
                'x-user-id': 'test-user-456',
                ...headers
            },
            timeout: 10000,
            validateStatus: () => true
        });
        
        const duration = performance.now() - start;
        const success = response.status >= 200 && response.status < 400;
        recordRequest(duration, success, success ? null : `HTTP ${response.status}`);
        return { success, status: response.status, duration };
    } catch (error) {
        const duration = performance.now() - start;
        recordRequest(duration, false, error.message);
        return { success: false, error: error.message, duration };
    }
}

async function searchMusic(query = 'test song') {
    return makeRequest('POST', '/music/search', { query, guildId: 'test-guild-123' });
}

async function requestMusic(query = 'https://youtube.com/watch?v=dQw4w9WgXcQ') {
    return makeRequest('POST', '/music/request', { query, guildId: 'test-guild-123' });
}

async function getQueue() {
    return makeRequest('GET', '/music/queue');
}

async function getPlayer() {
    return makeRequest('GET', '/music/player');
}

async function healthCheck() {
    return makeRequest('GET', '/health/live');
}

async function metricsEndpoint() {
    return makeRequest('GET', '/metrics');
}

async function karaokeSubmit() {
    return makeRequest('POST', '/karaoke/request', { 
        songId: `test-song-${Date.now()}`,
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        guildId: 'test-guild-123'
    });
}

function connectWebSocket() {
    return new Promise((resolve, reject) => {
        METRICS.wsConnections.total++;
        const ws = new WebSocket(`${WS_URL}/ws/karaoke?guildId=test-guild-123`);
        
        const timeout = setTimeout(() => {
            ws.close();
            METRICS.wsConnections.failed++;
            reject(new Error('WebSocket connection timeout'));
        }, 5000);
        
        ws.on('open', () => {
            clearTimeout(timeout);
            METRICS.wsConnections.active++;
            console.log('  📡 WebSocket connected');
            
            // Send ping to keep alive
            const pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                } else {
                    clearInterval(pingInterval);
                }
            }, 10000);
            
            ws.on('close', () => {
                clearInterval(pingInterval);
                METRICS.wsConnections.active--;
            });
            
            ws.on('error', (err) => {
                METRICS.wsConnections.failed++;
                METRICS.wsConnections.active = Math.max(0, METRICS.wsConnections.active - 1);
            });
            
            resolve(ws);
        });
        
        ws.on('error', (err) => {
            clearTimeout(timeout);
            METRICS.wsConnections.failed++;
            reject(err);
        });
    });
}

async function runStage(stage) {
    console.log(`\n📊 Stage: ${stage.name} (target: ${stage.target} users, duration: ${stage.duration/1000}s)`);
    
    const startTime = Date.now();
    const endTime = startTime + stage.duration;
    let currentUsers = 0;
    const userIncrement = stage.target / (stage.duration / 1000); // users per second
    
    const activeTasks = [];
    
    while (Date.now() < endTime) {
        const elapsed = Date.now() - startTime;
        const targetUsers = Math.min(stage.target, Math.floor(elapsed / 1000 * userIncrement));
        
        // Adjust active users
        while (currentUsers < targetUsers && currentUsers < stage.target) {
            currentUsers++;
            const userId = currentUsers;
            
            // Start user simulation
            const task = simulateUser(userId, endTime);
            activeTasks.push(task);
        }
        
        // Clean up completed tasks
        const stillActive = [];
        for (const task of activeTasks) {
            if (task.isActive) {
                stillActive.push(task);
            }
        }
        activeTasks.length = 0;
        activeTasks.push(...stillActive);
        
        await sleep(1000);
    }
    
    // Wait for remaining tasks
    console.log(`  Waiting for ${activeTasks.length} active tasks to complete...`);
    await Promise.all(activeTasks.map(t => t.promise));
    
    console.log(`  Stage complete. Active tasks: ${activeTasks.length}`);
}

async function simulateUser(userId, endTime) {
    let isActive = true;
    
    const promise = (async () => {
        const ws = await connectWebSocket().catch(() => null);
        
        while (isActive && Date.now() < endTime) {
            const action = Math.random();
            
            if (action < 0.3) {
                await searchMusic(`song ${userId} ${Math.random()}`);
            } else if (action < 0.5) {
                await requestMusic();
            } else if (action < 0.6) {
                await getQueue();
            } else if (action < 0.7) {
                await getPlayer();
            } else if (action < 0.8) {
                await karaokeSubmit();
            } else if (action < 0.9) {
                await healthCheck();
            } else {
                await metricsEndpoint();
            }
            
            // Random think time
            await sleep(Math.random() * 2000 + 500);
        }
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    })();
    
    return { promise, get isActive() { return isActive; } };
}

function calculatePercentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil(p / 100 * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

function printResults() {
    console.log('\n═══════════════════════════════════════');
    console.log('  LOAD TEST RESULTS');
    console.log('═══════════════════════════════════════');
    
    const { total, success, failed, durations } = METRICS.requests;
    const successRate = total > 0 ? (success / total * 100).toFixed(2) : 0;
    const failedRate = total > 0 ? (failed / total * 100).toFixed(2) : 0;
    
    console.log(`\n📈 HTTP Requests:`);
    console.log(`   Total: ${total}`);
    console.log(`   Success: ${success} (${successRate}%)`);
    console.log(`   Failed: ${failed} (${failedRate}%)`);
    
    if (durations.length > 0) {
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        console.log(`   Avg Duration: ${avg.toFixed(2)}ms`);
        console.log(`   P50: ${calculatePercentile(durations, 50).toFixed(2)}ms`);
        console.log(`   P90: ${calculatePercentile(durations, 90).toFixed(2)}ms`);
        console.log(`   P95: ${calculatePercentile(durations, 95).toFixed(2)}ms`);
        console.log(`   P99: ${calculatePercentile(durations, 99).toFixed(2)}ms`);
    }
    
    console.log(`\n🔌 WebSocket Connections:`);
    console.log(`   Total Attempted: ${METRICS.wsConnections.total}`);
    console.log(`   Successful: ${METRICS.wsConnections.total - METRICS.wsConnections.failed}`);
    console.log(`   Failed: ${METRICS.wsConnections.failed}`);
    console.log(`   Peak Concurrent: ${METRICS.wsConnections.active}`);
    
    // Threshold checks
    console.log(`\n🎯 Threshold Checks:`);
    const p95 = calculatePercentile(durations, 95);
    const failRate = total > 0 ? failed / total : 0;
    
    console.log(`   P95 Duration < 2000ms: ${p95 < 2000 ? '✅ PASS' : '❌ FAIL'} (${p95.toFixed(2)}ms)`);
    console.log(`   Error Rate < 1%: ${failRate < 0.01 ? '✅ PASS' : '❌ FAIL'} (${(failRate * 100).toFixed(2)}%)`);
    
    if (METRICS.errors.length > 0) {
        console.log(`\n❌ Sample Errors:`);
        METRICS.errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
    }
    
    return {
        p95: p95 < 2000,
        errorRate: failRate < 0.01
    };
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  VOXARIA LOAD TEST');
    console.log('═══════════════════════════════════════');
    console.log(`Target: ${BASE_URL}`);
    
    // Warm up
    console.log('\n🔥 Warming up...');
    await healthCheck();
    await sleep(1000);
    
    // Run stages
    for (const stage of TEST_CONFIG.stages) {
        await runStage(stage);
    }
    
    // Print results
    const results = printResults();
    
    console.log('\n═══════════════════════════════════════');
    console.log(results.p95 && results.errorRate ? '✅ LOAD TEST PASSED' : '❌ LOAD TEST FAILED');
    console.log('═══════════════════════════════════════');
    
    return results.p95 && results.errorRate;
}

if (require.main === module) {
    main()
        .then(passed => process.exit(passed ? 0 : 1))
        .catch(err => {
            console.error('Load test error:', err);
            process.exit(1);
        });
}

module.exports = { main, METRICS, TEST_CONFIG };