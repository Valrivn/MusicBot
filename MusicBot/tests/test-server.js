/**
 * Minimal Test API Server
 * Runs just the Express API with mocked dependencies
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const chalk = require('chalk');
const { createServer } = require('http');
const { getMetrics } = require('../src/observability/metrics');
const { recordHttpRequest } = require('../src/observability/metrics');
const { setQueueDepth } = require('../src/observability/metrics');
const { setVoiceConnectionState } = require('../src/observability/metrics');

// Mock Discord client for testing
const mockClient = {
    guilds: {
        cache: new Map([
            ['test-guild-123', {
                id: 'test-guild-123',
                name: 'Test Guild',
                members: {
                    cache: new Map([
                        ['test-user-456', {
                            id: 'test-user-456',
                            user: { username: 'TestUser', tag: 'TestUser#1234', avatar: null },
                            voice: { channel: { id: 'voice-channel-1', name: 'General', type: 2 } }
                        }]
                    ])
                },
                channels: {
                    cache: new Map([
                        ['text-channel-1', { id: 'text-channel-1', isTextBased: () => true, type: 0 }],
                        ['voice-channel-1', { id: 'voice-channel-1', type: 2, name: 'General' }]
                    ])
                },
                voiceAdapterCreator: {}
            }]
        ])
    },
    players: new Map(),
    ws: { status: 0, ping: 50 }
};

// Mock MusicPlayer
class MockMusicPlayer {
    constructor(guild, textChannel, voiceChannel) {
        this.guild = guild;
        this.queue = [];
        this.currentTrack = null;
        this.paused = false;
        this.volume = 100;
        this.previousTracks = [];
    }
    
    async addTrack(query, requester) {
        const track = {
            id: `track-${Date.now()}`,
            title: typeof query === 'string' ? query : (query.title || 'Test Track'),
            artist: 'Test Artist',
            url: typeof query === 'string' ? query : (query.url || 'https://youtube.com/watch?v=test'),
            duration: 180,
            requestedBy: requester
        };
        this.queue.push(track);
        if (!this.currentTrack) this.currentTrack = track;
        return track;
    }
    
    skip() { this.queue.shift(); }
    stop() { this.queue = []; this.currentTrack = null; }
    pauseFor() { this.paused = true; }
    resumeFor() { this.paused = false; }
    setVolume(v) { this.volume = v; }
    seek() {}
    shuffleQueue() { return true; }
    moveInQueue() { return true; }
    removeQueueItem() { return this.queue; }
    previous() { return true; }
}

mockClient.players = new Map();

// Simple requirePermission middleware
const mockRequirePermission = (resource, action) => (req, res, next) => next();
const mockOptionalAuth = (req, res, next) => next();

// Extract YouTube video ID
const extractYtVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

const isYouTubeUrl = (url) => {
    return url && (url.includes('youtube.com') || url.includes('youtu.be'));
};

async function startTestServer() {
    // Override config for testing
    process.env.DISCORD_TOKEN = 'test_token';
    process.env.CLIENT_ID = '123456789';
    process.env.MUSIC_API_PORT = '3002';
    
    const app = express();
    
    const corsOptions = {
        origin: [
            'https://voxaria.lovable.app',
            'http://localhost:3000',
            'http://localhost:5173'
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-guild-id', 'x-user-id']
    };
    
    app.options('*path', cors(corsOptions));
    app.use(cors(corsOptions));
    app.use(cookieParser());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            recordHttpRequest(req.method, req.path, res.statusCode, Date.now() - start);
        });
        next();
    });
    
    // Health endpoints
    app.get('/health/live', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
    });
    
    app.get('/health/ready', async (req, res) => {
        res.json({ status: 'ready', timestamp: new Date().toISOString(), checks: { discord: true, cache: true, memory: true } });
    });
    
    app.get('/health', async (req, res) => {
        res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() });
    });
    
    app.get('/metrics', async (req, res) => {
        try {
            const metrics = await getMetrics();
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(metrics);
        } catch (error) {
            res.status(500).send('Error generating metrics');
        }
    });
    
    // Music endpoints
    app.get('/music/player', mockOptionalAuth, (req, res) => {
        const player = mockClient.players.get('test-guild-123');
        if (!player || !player.currentTrack) return res.json(null);
        
        const track = player.currentTrack;
        const ytVideoId = extractYtVideoId(track.url);
        const resolvedArt = track.thumbnail || (ytVideoId ? `https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg` : null);
        
        res.json({
            id: track.id, title: track.title, artist: track.artist, url: track.url,
            durationSec: track.duration, positionSec: 0, startTime: Date.now(),
            isPaused: player.paused, playing: !player.paused, art: resolvedArt,
            volume: player.volume, requesterName: track.requestedBy?.tag || 'Test'
        });
    });
    
    app.get('/music/queue', mockOptionalAuth, (req, res) => {
        const player = mockClient.players.get('test-guild-123');
        if (!player) return res.json([]);
        
        res.json(player.queue.map(track => {
            const ytId = extractYtVideoId(track.url);
            const art = track.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
            return {
                id: track.id, title: track.title, artist: track.artist, url: track.url,
                thumbnail: art, art: art, duration: track.duration,
                requestedBy: track.requestedBy?.tag || 'Test'
            };
        }));
    });
    
    app.post('/music/playback', mockRequirePermission('queue', 'write'), (req, res) => {
        const player = mockClient.players.get('test-guild-123');
        if (!player) return res.status(404).json({ error: 'No active player' });
        
        const { action } = req.body;
        if (action === 'play_pause') player.paused ? player.resumeFor() : player.pauseFor();
        else if (action === 'next') player.skip();
        else if (action === 'previous') player.previous();
        else if (action === 'stop') player.stop();
        else if (action === 'pause') player.pauseFor();
        else if (action === 'resume') player.resumeFor();
        
        res.json({ success: true });
    });
    
    app.post('/music/skip', mockRequirePermission('queue', 'write'), (req, res) => {
        const player = mockClient.players.get('test-guild-123');
        if (!player) return res.status(404).json({ error: 'No active player' });
        player.skip();
        res.json({ success: true });
    });
    
    app.post('/music/stop', mockRequirePermission('queue', 'write'), (req, res) => {
        const player = mockClient.players.get('test-guild-123');
        if (!player) return res.status(404).json({ error: 'No active player' });
        player.stop();
        res.json({ success: true });
    });
    
    app.post('/music/volume', mockRequirePermission('queue', 'write'), (req, res) => {
        const { volume } = req.body;
        if (typeof volume !== 'number' || volume < 0 || volume > 100) {
            return res.status(400).json({ error: 'Invalid volume (must be 0-100)' });
        }
        const player = mockClient.players.get('test-guild-123');
        if (!player) return res.status(404).json({ error: 'No active player' });
        player.setVolume(volume);
        res.json({ success: true, volume });
    });
    
    app.post('/music/search', mockRequirePermission('queue', 'write'), async (req, res) => {
        const { query, guildId } = req.body;
        if (!query || !query.trim()) return res.status(400).json({ error: 'Query is required' });
        
        // Simulate search delay
        await new Promise(r => setTimeout(r, Math.random() * 100 + 50));
        
        // Return mock results
        res.json({ 
            success: true, 
            results: [
                { title: `Result 1 for ${query}`, artist: 'Artist 1', url: 'https://youtube.com/watch?v=test1', duration: 180 },
                { title: `Result 2 for ${query}`, artist: 'Artist 2', url: 'https://youtube.com/watch?v=test2', duration: 240 }
            ]
        });
    });
    
    app.post('/music/request', mockRequirePermission('queue', 'write'), async (req, res) => {
        const { query, guildId } = req.body;
        if (!query || !query.trim()) return res.status(400).json({ error: 'Query is required' });
        
        let player = mockClient.players.get(guildId || 'test-guild-123');
        if (!player) {
            player = new MockMusicPlayer(
                mockClient.guilds.cache.get(guildId || 'test-guild-123'),
                mockClient.guilds.cache.get(guildId || 'test-guild-123')?.channels.cache.get('text-channel-1'),
                mockClient.guilds.cache.get(guildId || 'test-guild-123')?.channels.cache.get('voice-channel-1')
            );
            mockClient.players.set(guildId || 'test-guild-123', player);
            setQueueDepth(guildId || 'test-guild-123', 0);
            setVoiceConnectionState(guildId || 'test-guild-123', true);
        }
        
        await player.addTrack(query, { tag: 'TestUser', id: 'test-user-456' });
        setQueueDepth(guildId || 'test-guild-123', player.queue.length);
        
        res.json({ success: true, ok: true });
    });
    
    // Karaoke endpoints (mock)
    app.post('/karaoke/request', mockRequirePermission('queue', 'write'), async (req, res) => {
        const { songId, url, guildId } = req.body;
        if (!songId || !url) return res.status(400).json({ error: 'songId and url required' });
        
        // Simulate job submission
        res.json({ success: true, jobId: songId, status: 'queued' });
    });
    
    // Start server
    const PORT = process.env.MUSIC_API_PORT || 3002;
    const httpServer = createServer(app);
    
    httpServer.listen(PORT, () => {
        console.log(chalk.blue(`🌐 Test API server running on port ${PORT}`));
        console.log(chalk.green(`✅ Health: http://localhost:${PORT}/health/live`));
        console.log(chalk.green(`✅ Metrics: http://localhost:${PORT}/metrics`));
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        httpServer.close(() => process.exit(0));
    });
    
    // Keep process alive
    setInterval(() => {}, 1000);
}

startTestServer().catch(err => {
    console.error('❌ Failed to start test server:', err);
    process.exit(1);
});