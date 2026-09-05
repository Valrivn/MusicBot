const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const config = require('../../../config');
const { cleanupAudioCache } = require('../../SessionManager');

const router = express.Router();

module.exports = (client, requirePermission) => {
    router.get('/health/live', (req, res) => {
        res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
    });

    router.get('/health/ready', async (req, res) => {
        let redisStatus = 'unknown';
        try {
            const { redisConnection } = require('../../queue/karaoke-queue');
            redisStatus = redisConnection.status;
        } catch (e) {
            redisStatus = 'error';
        }
        const isReady = redisStatus === 'ready' && client?.ws?.ping !== undefined;
        res.status(isReady ? 200 : 503).json({
            status: isReady ? 'ready' : 'not_ready',
            checks: {
                redis: redisStatus,
                discord: client?.ws?.ping !== undefined ? 'connected' : 'disconnected',
            },
            timestamp: new Date().toISOString(),
        });
    });

    router.get('/bot/status', (req, res) => {
        res.json({
            activeShard: client.shard?.ids[0] ?? 0,
            pingMs: client.ws.ping,
            uptime: client.uptime || (process.uptime() * 1000),
            online: true
        });
    });

    router.get('/system/settings', (req, res) => {
        res.json({ sessionRestoreEnabled: config.sessionRestore?.enabled !== false });
    });

    router.get('/system/audio-cache', requirePermission('settings', 'read'), async (req, res) => {
        const cacheDir = path.join(__dirname, '..', '..', '..', 'audio_cache');
        let totalSize = 0;
        try {
            if (fs.existsSync(cacheDir)) {
                const files = await fsPromises.readdir(cacheDir);
                for (const file of files) {
                    const stats = await fsPromises.stat(path.join(cacheDir, file));
                    totalSize += stats.size;
                }
            }
        } catch (e) {
            console.error('Error reading cache size:', e);
        }
        const sizeMb = totalSize / (1024 * 1024);
        res.json({ sizeMb: Number(sizeMb.toFixed(2)) });
    });

    router.post('/api/cache/clean', requirePermission('settings', 'write'), async (req, res) => {
        try {
            await cleanupAudioCache();
            res.json({ success: true, message: 'Audio cache cleaned successfully.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/system/audio-cache/clean', requirePermission('settings', 'write'), async (req, res) => {
        try {
            await cleanupAudioCache();
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    router.post('/api/settings/session-restore', requirePermission('settings', 'write'), (req, res) => {
        const { enabled } = req.body;
        if (typeof enabled === 'boolean') {
            config.sessionRestore.enabled = enabled;
            res.json({ success: true, message: `Session restore feature ${enabled ? 'enabled' : 'disabled'}.` });
        } else {
            res.status(400).json({ success: false, error: 'Invalid boolean value for "enabled".' });
        }
    });

    return router;
};