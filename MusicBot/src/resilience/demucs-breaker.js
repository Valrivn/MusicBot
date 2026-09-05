const { createCircuitBreaker } = require('./circuit-breaker');
const { setCircuitBreakerState } = require('../observability/metrics');
const { promisify } = require('util');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const execFileAsync = promisify(execFile);

const demucsBreaker = createCircuitBreaker('demucs', async (pythonScript, audioFile, outputDir) => {
    const child = execFile('python', [pythonScript, audioFile, outputDir], {
        timeout: 600000
    });

    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Demucs exited with code ${code}: ${stderr}`));
            }
        });

        child.on('error', reject);
    });
}, {
    timeout: 600000,
    errorThresholdPercentage: 50,
    resetTimeout: 60000,
    rollingCountTimeout: 30000,
    rollingCountBuckets: 6
});

demucsBreaker.on('open', () => setCircuitBreakerState('demucs', 'open'));
demucsBreaker.on('close', () => setCircuitBreakerState('demucs', 'closed'));
demucsBreaker.on('halfOpen', () => setCircuitBreakerState('demucs', 'halfOpen'));

/**
 * Gets cached karaoke stems as fallback
 * @param {string} trackHash - Track hash
 * @returns {Object|null} Cached stems info or null
 */
function getCachedKaraoke(trackHash) {
    const STEMS_DIR = path.join(__dirname, '..', '..', 'audio_cache', 'stems');
    const outputDir = path.join(STEMS_DIR, trackHash);
    const doneMarker = path.join(outputDir, '.done');

    if (fs.existsSync(doneMarker)) {
        return {
            status: 'ready',
            outputDir,
            stems: {
                vocals: `/karaoke/stems/${trackHash}/vocals.wav`,
                instrumental: `/karaoke/stems/${trackHash}/no_vocals.wav`
            }
        };
    }

    return null;
}

/**
 * Runs Demucs with circuit breaker and fallback to cached stems
 * @param {Object} job - Karaoke job object
 * @returns {Promise<Object>} Job result
 */
async function runDemucsWithFallback(job) {
    const { trackHash, audioFile, outputDir, pythonScript } = job;

    try {
        const result = await demucsBreaker.fire(pythonScript, audioFile, outputDir);
        
        // Mark as done
        fs.writeFileSync(path.join(outputDir, '.done'), 'done');
        
        return {
            status: 'ready',
            jobId: trackHash,
            stems: {
                vocals: `/karaoke/stems/${trackHash}/vocals.wav`,
                instrumental: `/karaoke/stems/${trackHash}/no_vocals.wav`
            },
            outputDir
        };
    } catch (error) {
        // Clean up partial output on failure to avoid corrupt cache polluting retries
        try {
            if (fs.existsSync(outputDir)) {
                const files = fs.readdirSync(outputDir);
                for (const file of files) {
                    const filePath = path.join(outputDir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        fs.unlinkSync(filePath);
                    } else if (stat.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    }
                }
                // Remove the empty output dir itself
                fs.rmdirSync(outputDir, { recursive: true });
            }
        } catch (cleanupError) {
            console.error(`[Demucs] Failed to clean up partial output for ${trackHash}:`, cleanupError.message);
        }

        // Fallback to cached stems
        const cached = getCachedKaraoke(trackHash);
        if (cached) {
            console.warn(`[Demucs] Circuit breaker open, falling back to cached stems for ${trackHash}`);
            return cached;
        }
        
        // If no cache, return instrumental-only fallback
        return {
            status: 'error',
            jobId: trackHash,
            error: error.message,
            fallback: {
                instrumentalOnly: true,
                message: 'Demucs unavailable, instrumental-only playback available'
            }
        };
    }
}

module.exports = {
    demucsBreaker,
    getCachedKaraoke,
    runDemucsWithFallback
};