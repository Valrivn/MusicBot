/**
 * Circuit Breaker Trigger Tests
 * Tests each circuit breaker by simulating failure conditions
 */

const { runYtdlp, runYtdlpWrap, runFfmpeg, runHttpRequest, runDiscordApiCall, getCircuitBreakerStatus } = require('../src/resilience/external-calls');
const { demucsBreaker, runDemucsWithFallback } = require('../src/resilience/demucs-breaker');
const { setCircuitBreakerState } = require('../src/observability/metrics');
const path = require('path');
const fs = require('fs');

const TEST_RESULTS = {
    'yt-dlp': { passed: false, details: '' },
    'yt-dlp-wrap': { passed: false, details: '' },
    'ffmpeg': { passed: false, details: '' },
    'http': { passed: false, details: '' },
    'discord-api': { passed: false, details: '' },
    'demucs': { passed: false, details: '' }
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testYtDlpCircuitBreaker() {
    console.log('\n🧪 Testing yt-dlp circuit breaker...');
    const breaker = require('../src/resilience/external-calls').ytdlpBreaker;
    let breakerOpened = false;
    
    breaker.on('open', () => { breakerOpened = true; });
    
    // Force open the circuit breaker by directly manipulating it
    // We'll simulate failures by calling with invalid arguments
    for (let i = 0; i < 10; i++) {
        try {
            await runYtdlp('invalid-url-that-will-fail', { timeout: 1000 });
        } catch (e) {
            // Expected to fail
        }
    }
    
    await sleep(500);
    
    const isOpen = breaker.opened === true;
    console.log(`  yt-dlp breaker opened: ${isOpen}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['yt-dlp'].passed = true;
        TEST_RESULTS['yt-dlp'].details = 'Circuit breaker opened after repeated failures';
        console.log('  ✅ yt-dlp circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['yt-dlp'].details = `Breaker opened: ${breaker.opened}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ yt-dlp circuit breaker did not trigger');
    }
    
    // Reset for next tests
    breaker.close();
    await sleep(500);
}

async function testYtDlpWrapCircuitBreaker() {
    console.log('\n🧪 Testing yt-dlp-wrap circuit breaker...');
    const breaker = require('../src/resilience/external-calls').ytdlpWrapBreaker;
    let breakerOpened = false;
    
    breaker.on('open', () => { breakerOpened = true; });
    
    for (let i = 0; i < 10; i++) {
        try {
            await runYtdlpWrap(['invalid-search-query']);
        } catch (e) {
            // Expected
        }
    }
    
    await sleep(500);
    
    const isOpen = breaker.opened === true;
    console.log(`  yt-dlp-wrap breaker opened: ${isOpen}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['yt-dlp-wrap'].passed = true;
        TEST_RESULTS['yt-dlp-wrap'].details = 'Circuit breaker opened after repeated failures';
        console.log('  ✅ yt-dlp-wrap circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['yt-dlp-wrap'].details = `Breaker opened: ${breaker.opened}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ yt-dlp-wrap circuit breaker did not trigger');
    }
    
    breaker.close();
    await sleep(500);
}

async function testFfmpegCircuitBreaker() {
    console.log('\n🧪 Testing FFmpeg circuit breaker...');
    const breaker = require('../src/resilience/external-calls').ffmpegBreaker;
    let breakerOpened = false;
    
    breaker.on('open', () => { breakerOpened = true; });
    
    // Use a mock approach - directly call the breaker's fire with a failing function
    // This avoids actually spawning FFmpeg which can hang
    for (let i = 0; i < 10; i++) {
        try {
            await breaker.fire(async () => {
                throw new Error('Simulated FFmpeg failure');
            });
        } catch (e) {
            // Expected
        }
    }
    
    await sleep(500);
    
    const isOpen = breaker.opened === true;
    console.log(`  ffmpeg breaker opened: ${isOpen}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['ffmpeg'].passed = true;
        TEST_RESULTS['ffmpeg'].details = 'Circuit breaker opened after repeated simulated failures';
        console.log('  ✅ FFmpeg circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['ffmpeg'].details = `Breaker opened: ${breaker.opened}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ FFmpeg circuit breaker did not trigger');
    }
    
    breaker.close();
    await sleep(500);
}

async function testHttpCircuitBreaker() {
    console.log('\n🧪 Testing HTTP circuit breaker...');
    const breaker = require('../src/resilience/external-calls').httpBreaker;
    let breakerOpened = false;
    
    breaker.on('open', () => { breakerOpened = true; });
    
    // Use invalid URLs that will fail
    for (let i = 0; i < 10; i++) {
        try {
            await runHttpRequest('http://invalid-domain-that-does-not-exist-12345.com/api/test');
        } catch (e) {
            // Expected
        }
    }
    
    await sleep(500);
    
    const isOpen = breaker.opened === true;
    console.log(`  http breaker opened: ${isOpen}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['http'].passed = true;
        TEST_RESULTS['http'].details = 'Circuit breaker opened after repeated HTTP failures';
        console.log('  ✅ HTTP circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['http'].details = `Breaker opened: ${breaker.opened}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ HTTP circuit breaker did not trigger');
    }
    
    breaker.close();
    await sleep(500);
}

async function testDiscordApiCircuitBreaker() {
    console.log('\n🧪 Testing Discord API circuit breaker...');
    const breaker = require('../src/resilience/external-calls').discordApiBreaker;
    let breakerOpened = false;
    
    breaker.on('open', () => { breakerOpened = true; });
    
    // Simulate failing Discord API calls
    for (let i = 0; i < 10; i++) {
        try {
            await runDiscordApiCall(async () => {
                throw new Error('Simulated Discord API error');
            });
        } catch (e) {
            // Expected
        }
    }
    
    await sleep(500);
    
    const isOpen = breaker.opened === true;
    console.log(`  discord-api breaker opened: ${isOpen}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['discord-api'].passed = true;
        TEST_RESULTS['discord-api'].details = 'Circuit breaker opened after repeated Discord API failures';
        console.log('  ✅ Discord API circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['discord-api'].details = `Breaker opened: ${breaker.opened}, closed: ${breaker.closed}, halfOpen: ${breaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ Discord API circuit breaker did not trigger');
    }
    
    breaker.close();
    await sleep(500);
}

async function testDemucsCircuitBreaker() {
    console.log('\n🧪 Testing Demucs circuit breaker...');
    let breakerOpened = false;
    
    demucsBreaker.on('open', () => { breakerOpened = true; });
    
    // Create a mock job that will fail
    const mockJob = {
        trackHash: 'test_hash_123',
        audioFile: path.join(__dirname, 'nonexistent_audio.wav'),
        outputDir: path.join(__dirname, 'test_output'),
        pythonScript: path.join(__dirname, 'nonexistent_script.py')
    };
    
    // Ensure output dir exists
    if (!fs.existsSync(mockJob.outputDir)) {
        fs.mkdirSync(mockJob.outputDir, { recursive: true });
    }
    
    for (let i = 0; i < 10; i++) {
        try {
            await runDemucsWithFallback(mockJob);
        } catch (e) {
            // Expected
        }
    }
    
    await sleep(500);
    
    const isOpen = demucsBreaker.opened === true;
    console.log(`  demucs breaker opened: ${isOpen}, closed: ${demucsBreaker.closed}, halfOpen: ${demucsBreaker.halfOpen}`);
    
    if (isOpen || breakerOpened) {
        TEST_RESULTS['demucs'].passed = true;
        TEST_RESULTS['demucs'].details = 'Circuit breaker opened after repeated Demucs failures';
        console.log('  ✅ Demucs circuit breaker triggered correctly');
    } else {
        TEST_RESULTS['demucs'].details = `Breaker opened: ${demucsBreaker.opened}, closed: ${demucsBreaker.closed}, halfOpen: ${demucsBreaker.halfOpen} (expected: opened=true)`;
        console.log('  ❌ Demucs circuit breaker did not trigger');
    }
    
    demucsBreaker.close();
    await sleep(500);
    
    // Cleanup
    if (fs.existsSync(mockJob.outputDir)) {
        fs.rmSync(mockJob.outputDir, { recursive: true, force: true });
    }
}

async function testFallbackBehavior() {
    console.log('\n🧪 Testing fallback behavior...');
    
    // Test yt-dlp fallback to Invidious
    console.log('  Testing yt-dlp → Invidious fallback...');
    const mediaResolver = require('../src/services/media-resolver').defaultResolver;
    
    // Open yt-dlp breaker
    const ytdlpBreaker = require('../src/resilience/external-calls').ytdlpBreaker;
    ytdlpBreaker.open();
    await sleep(500);
    
    try {
        // This should fail on yt-dlp and fallback to Invidious
        const result = await mediaResolver.resolve('test query');
        console.log('  Fallback result:', result ? 'Success' : 'Failed');
    } catch (e) {
        console.log('  Fallback error:', e.message);
    }
    
    ytdlpBreaker.close();
}

async function runAllTests() {
    console.log('═══════════════════════════════════════');
    console.log('  CIRCUIT BREAKER TRIGGER TESTS');
    console.log('═══════════════════════════════════════');
    
    await testYtDlpCircuitBreaker();
    await testYtDlpWrapCircuitBreaker();
    await testFfmpegCircuitBreaker();
    await testHttpCircuitBreaker();
    await testDiscordApiCircuitBreaker();
    await testDemucsCircuitBreaker();
    await testFallbackBehavior();
    
    console.log('\n═══════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════');
    
    let allPassed = true;
    for (const [name, result] of Object.entries(TEST_RESULTS)) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`  ${status} - ${name}: ${result.details}`);
        if (!result.passed) allPassed = false;
    }
    
    console.log('\n' + (allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'));
    
    return allPassed;
}

// Run tests if executed directly
if (require.main === module) {
    runAllTests()
        .then(passed => {
            process.exit(passed ? 0 : 1);
        })
        .catch(err => {
            console.error('Test runner error:', err);
            process.exit(1);
        });
}

module.exports = { runAllTests, TEST_RESULTS };