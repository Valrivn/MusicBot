const express = require('express');
const { logger } = require('../../observability/logger');
const { getMetrics } = require('../../observability/metrics');

const router = express.Router();

/**
 * Health check endpoint - basic liveness probe
 * GET /health/live
 */
router.get('/health/live', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * Readiness probe - checks if service can handle requests
 * GET /health/ready
 */
router.get('/health/ready', async (req, res) => {
    const checks = {
        discord: false,
        cache: false,
        memory: false
    };

    try {
        // Check Discord connection (via client)
        if (req.client && req.client.ws && req.client.ws.status === 0) {
            checks.discord = true;
        }

        // Check cache directory
        const fs = require('fs');
        const cacheDir = require('path').join(__dirname, '..', '..', '..', 'audio_cache');
        if (fs.existsSync(cacheDir)) {
            try {
                await fs.promises.access(cacheDir, fs.constants.W_OK);
                checks.cache = true;
            } catch (e) {
                checks.cache = false;
            }
        }

        // Check memory (not OOM)
        const memUsage = process.memoryUsage();
        const memUsagePercent = (memUsage.heapUsed / memUsage.heapLimit) * 100;
        checks.memory = memUsagePercent < 90;

        const allHealthy = Object.values(checks).every(v => v === true);
        
        res.status(allHealthy ? 200 : 503).json({
            status: allHealthy ? 'ready' : 'not ready',
            timestamp: new Date().toISOString(),
            checks
        });
    } catch (error) {
        logger.error({ msg: 'Health check failed', error: error.message });
        res.status(503).json({ 
            status: 'not ready', 
            timestamp: new Date().toISOString(),
            checks,
            error: error.message
        });
    }
});

/**
 * Comprehensive health check with detailed info
 * GET /health
 */
router.get('/health', async (req, res) => {
    const checks = {
        discord: { status: 'unknown', latency: null },
        cache: { status: 'unknown', writable: false, size: 0 },
        memory: { status: 'unknown', usage: {} },
        uptime: process.uptime()
    };

    try {
        // Discord check
        if (req.client && req.client.ws) {
            const start = Date.now();
            checks.discord.status = req.client.ws.status === 0 ? 'connected' : 'disconnected';
            checks.discord.latency = req.client.ws.ping;
        }

        // Cache check
        const fs = require('fs');
        const path = require('path');
        const cacheDir = path.join(__dirname, '..', '..', '..', 'audio_cache');
        
        if (fs.existsSync(cacheDir)) {
            try {
                await fs.promises.access(cacheDir, fs.constants.W_OK);
                checks.cache.writable = true;
                
                // Get cache size
                const files = await fs.promises.readdir(cacheDir);
                let totalSize = 0;
                for (const file of files) {
                    const stats = await fs.promises.stat(path.join(cacheDir, file));
                    totalSize += stats.size;
                }
                checks.cache.size = totalSize;
                checks.cache.status = 'ok';
            } catch (e) {
                checks.cache.status = 'error';
            }
        } else {
            checks.cache.status = 'missing';
        }

        // Memory check
        const memUsage = process.memoryUsage();
        checks.memory.usage = {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            heapLimit: Math.round(memUsage.heapLimit / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
        };
        
        const heapUsagePercent = (memUsage.heapUsed / memUsage.heapLimit) * 100;
        checks.memory.status = heapUsagePercent < 90 ? 'ok' : 'warning';

        // Overall status
        const hasErrors = Object.values(checks).some(c => 
            c && typeof c === 'object' && c.status === 'error'
        );
        const hasWarnings = Object.values(checks).some(c => 
            c && typeof c === 'object' && c.status === 'warning'
        );

        const overallStatus = hasErrors ? 'degraded' : (hasWarnings ? 'warning' : 'healthy');

        res.json({
            status: overallStatus,
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '16.0.0',
            checks
        });

    } catch (error) {
        logger.error({ msg: 'Health check failed', error: error.message });
        res.status(500).json({ 
            status: 'error', 
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

/**
 * Prometheus metrics endpoint
 * GET /metrics
 */
router.get('/metrics', async (req, res) => {
    try {
        const metrics = await getMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metrics);
    } catch (error) {
        logger.error({ msg: 'Metrics endpoint error', error: error.message });
        res.status(500).send('Error generating metrics');
    }
});

/**
 * Metrics as JSON
 * GET /metrics/json
 */
router.get('/metrics/json', async (req, res) => {
    try {
        const metrics = await require('../../observability/metrics').getMetricsAsJson();
        res.json(metrics);
    } catch (error) {
        logger.error({ msg: 'Metrics JSON endpoint error', error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;