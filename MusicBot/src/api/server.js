const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const { createServer } = require('http');
const { fetchRequestHandler } = require('@trpc/server/adapters/fetch');
const config = require('../../config');
const AuditLog = require('../AuditLog');
const { createAccessToken, createRefreshToken, verifyAccessToken, verifyRefreshToken, revokeRefreshToken, revokeAllUserRefreshTokens, getJWKS, rotateRefreshToken } = require('../auth/jwt');
const { setupWebSocket, broadcastToGuild } = require('../utils/websocket');
// Lazy load karaoke queue to avoid Redis version check at startup
let _karaokeQueue = null;
function getKaraokeQueue() {
    if (!_karaokeQueue) {
        _karaokeQueue = require('../queue/karaoke-queue').karaokeQueue;
    }
    return _karaokeQueue;
}
const { appRouter, createContext } = require('@voxaria/contracts');

const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const { initPermissionService, requirePermission, optionalAuth, getPermissionService } = require('../auth/middleware');
const { addPolicy, removePolicy, getAllPolicies, addGroupingPolicy, removeGroupingPolicy, reloadPolicy } = require('../auth/casbin');
const { apiLimiter, truncLimiter, authLimiter, createRateLimiter } = require('../auth/rate-limit');

const ROLES_FILE = path.join(__dirname, '..', '..', 'roles.json');
const OWNER_ID = '895441968241459271';

function getUserRole(discordId) {
    if (discordId === OWNER_ID) return 3;
    try {
        if (fs.existsSync(ROLES_FILE)) {
            const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
            return roles[discordId] !== undefined ? roles[discordId] : 0;
        }
    } catch (e) {
        console.error('❌ Failed to read roles.json:', e.message);
    }
    return 0;
}

async function startServer(client) {
    await initPermissionService(client);
    
    const app = express();
    app.set('sessionStore', new Map());

    const extraOrigins = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const corsOptions = {
        origin: [
            'https://voxaria.lovable.app',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:8080',
            ...extraOrigins
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'ngrok-skip-browser-warning',
            'x-guild-id',
            'X-Guild-Id',
            'x-user-id',
            'X-User-Id',
            'x-api-key',
            'X-API-KEY',
            'apikey',
            'X-Client-Info',
            'Accept',
            'Origin'
        ]
    };

    app.options('*path', cors(corsOptions));
    app.use(cors(corsOptions));
    app.use(cookieParser());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    app.use((req, res, next) => {
        res.setHeader('ngrok-skip-browser-warning', 'true');
        const origin = req.headers.origin;
        if (corsOptions.origin.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        next();
    });

    app.use((req, res, next) => {
        console.log(chalk.cyan(`📡 [${req.method}] ${req.path}`));
        console.log(chalk.gray(`🆔 Guild Header: ${req.headers['x-guild-id'] || req.headers['X-Guild-Id'] || req.headers['guild-id'] || 'None'}`));
        console.log(chalk.gray(`📦 Body: ${req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : 'undefined'}`));
        next();
    });

    // --- tRPC ENDPOINT ---
    app.use('/api/trpc', truncLimiter, async (req, res) => {
        const response = await fetchRequestHandler({
            endpoint: '/api/trpc',
            req,
            router: appRouter,
            createContext: typeof createContext === 'function' ? () => createContext({ req, client }) : () => ({}),
            onError: ({ path, error }) => {
                console.error(`❌ tRPC error on ${path}:`, error);
            },
        });
        
        res.status(response.status);
        for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value);
        }
        const body = await response.text();
        res.send(body);
    });

    // --- JWKS ENDPOINT (for key rotation) ---
    app.get('/.well-known/jwks.json', async (req, res) => {
        try {
            const jwks = await getJWKS();
            res.json(jwks);
        } catch (error) {
            console.error('JWKS error:', error);
            res.status(500).json({ error: 'Failed to generate JWKS' });
        }
    });

    // --- REFRESH TOKEN ENDPOINT ---
    app.post('/api/auth/refresh', authLimiter, async (req, res) => {
        const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required', code: 'MISSING_REFRESH_TOKEN' });
        }

        try {
            const refreshData = await verifyRefreshToken(refreshToken);

            if (!refreshData) {
                return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
            }

            const role = getUserRole(refreshData.userId);

            const newAccessToken = await createAccessToken({
                id: refreshData.userId,
                roles: role >= 2 ? ['staff'] : role >= 1 ? ['dj'] : [],
                guildId: req.headers['x-guild-id'] || null,
                username: req.headers['x-user-username'] || null
            });

            const userAgent = req.headers['user-agent'] || null;
            const ipAddress = req.ip || req.connection?.remoteAddress || null;
            const newRefreshToken = await rotateRefreshToken(refreshToken, {
                id: refreshData.userId,
                roles: role >= 2 ? ['staff'] : role >= 1 ? ['dj'] : [],
                guildId: req.headers['x-guild-id'] || null,
                username: req.headers['x-user-username'] || null
            }, userAgent, ipAddress);

            res.cookie('refresh_token', newRefreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/'
            });

            res.json({
                access_token: newAccessToken,
                token_type: 'Bearer',
                expires_in: 900
            });

        } catch (error) {
            console.error('Refresh token error:', error);
            res.status(500).json({ error: 'Failed to refresh token' });
        }
    });

    // --- LOGOUT ENDPOINT ---
    app.post('/api/auth/logout', authLimiter, async (req, res) => {
        const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

        if (refreshToken) {
            await revokeRefreshToken(refreshToken);
        }

        res.clearCookie('refresh_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            path: '/'
        });

        res.json({ success: true, message: 'Logged out successfully' });
    });

    // --- ADMIN ENDPOINTS (Legacy - keep for backward compatibility) ---
    app.post('/admin/set-role', requirePermission('settings', 'write'), (req, res) => {
        const { userId, role } = req.body;
        if (!userId || typeof role !== 'number' || role < 0 || role > 2) {
            return res.status(400).json({ error: 'Invalid userId or role (0: Guest, 1: DJ, 2: Staff)' });
        }

        try {
            let roles = {};
            if (fs.existsSync(ROLES_FILE)) {
                roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
            }
            roles[userId] = role;
            fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2), 'utf-8');
            res.json({ success: true, message: `Role updated for ${userId} to level ${role}` });
        } catch (e) {
            console.error('Failed to update roles.json:', e);
            res.status(500).json({ error: 'Failed to update roles database' });
        }
    });

    // --- CASBIN POLICY MANAGEMENT API ---
    app.get('/api/admin/policies', requirePermission('settings', 'write'), async (req, res) => {
        try {
            const policies = await getAllPolicies();
            res.json({ policies });
        } catch (e) {
            console.error('Failed to get policies:', e);
            res.status(500).json({ error: 'Failed to retrieve policies' });
        }
    });

    app.post('/api/admin/policies', requirePermission('settings', 'write'), async (req, res) => {
        const { sub, obj, act } = req.body;
        if (!sub || !obj || !act) {
            return res.status(400).json({ error: 'Missing sub, obj, or act' });
        }
        try {
            const added = await addPolicy(sub, obj, act);
            if (added) {
                await reloadPolicy();
                res.json({ success: true, message: `Policy added: ${sub}, ${obj}, ${act}` });
            } else {
                res.status(409).json({ error: 'Policy already exists' });
            }
        } catch (e) {
            console.error('Failed to add policy:', e);
            res.status(500).json({ error: 'Failed to add policy' });
        }
    });

    app.delete('/api/admin/policies', requirePermission('settings', 'write'), async (req, res) => {
        const { sub, obj, act } = req.body;
        if (!sub || !obj || !act) {
            return res.status(400).json({ error: 'Missing sub, obj, or act' });
        }
        try {
            const removed = await removePolicy(sub, obj, act);
            if (removed) {
                await reloadPolicy();
                res.json({ success: true, message: `Policy removed: ${sub}, ${obj}, ${act}` });
            } else {
                res.status(404).json({ error: 'Policy not found' });
            }
        } catch (e) {
            console.error('Failed to remove policy:', e);
            res.status(500).json({ error: 'Failed to remove policy' });
        }
    });

    app.post('/api/admin/policies/reload', requirePermission('settings', 'write'), async (req, res) => {
        try {
            await reloadPolicy();
            res.json({ success: true, message: 'Policy reloaded' });
        } catch (e) {
            console.error('Failed to reload policy:', e);
            res.status(500).json({ error: 'Failed to reload policy' });
        }
    });

    app.post('/api/admin/roles', requirePermission('settings', 'write'), async (req, res) => {
        const { userId, role } = req.body;
        if (!userId || !role) {
            return res.status(400).json({ error: 'Missing userId or role' });
        }
        try {
            const added = await addGroupingPolicy(userId, role);
            if (added) {
                await reloadPolicy();
                res.json({ success: true, message: `Role ${role} assigned to ${userId}` });
            } else {
                res.status(409).json({ error: 'Role assignment already exists' });
            }
        } catch (e) {
            console.error('Failed to assign role:', e);
            res.status(500).json({ error: 'Failed to assign role' });
        }
    });

    app.delete('/api/admin/roles', requirePermission('settings', 'write'), async (req, res) => {
        const { userId, role } = req.body;
        if (!userId || !role) {
            return res.status(400).json({ error: 'Missing userId or role' });
        }
        try {
            const removed = await removeGroupingPolicy(userId, role);
            if (removed) {
                await reloadPolicy();
                res.json({ success: true, message: `Role ${role} removed from ${userId}` });
            } else {
                res.status(404).json({ error: 'Role assignment not found' });
            }
        } catch (e) {
            console.error('Failed to remove role:', e);
            res.status(500).json({ error: 'Failed to remove role' });
        }
    });

    // --- DISCORD OAUTH ENDPOINTS ---
    app.post('/auth/discord', authLimiter, async (req, res) => {
        const { code, redirectUri } = req.body;
        if (!code || !redirectUri) {
            return res.status(400).json({ error: 'Missing code or redirectUri' });
        }

        if (!config.discord.clientSecret) {
            return res.status(500).json({ error: 'Backend is missing DISCORD_CLIENT_SECRET in config' });
        }

        try {
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: config.discord.clientId,
                    client_secret: config.discord.clientSecret,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri
                })
            });

            if (!tokenResponse.ok) {
                const err = await tokenResponse.text();
                console.error('Discord Token Error:', err);
                return res.status(400).json({ error: 'Failed to exchange code for token' });
            }

            const tokenData = await tokenResponse.json();

            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
            });

            if (!userResponse.ok) {
                return res.status(400).json({ error: 'Failed to fetch user profile' });
            }

            const userData = await userResponse.json();

            const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
            });

            let guildId = null;
            if (guildsResponse.ok) {
                const guilds = await guildsResponse.json();
                if (guilds.length > 0) {
                    guildId = guilds[0].id;
                }
            }

            const role = getUserRole(userData.id);
            const roles = role >= 2 ? ['staff'] : role >= 1 ? ['dj'] : [];

            const accessToken = await createAccessToken({
                id: userData.id,
                username: userData.username,
                roles,
                guildId
            });

            const refreshToken = await createRefreshToken({
                id: userData.id,
                username: userData.username,
                roles,
                guildId
            }, req.headers['user-agent'], req.ip);

            const userInfo = {
                id: userData.id,
                username: userData.username,
                global_name: userData.global_name,
                avatar: userData.avatar,
                role
            };

            res.cookie('refresh_token', refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/'
            });

            res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: 900,
                refresh_token: refreshToken,
                user: userInfo
            });

        } catch (error) {
            console.error('OAuth2 Error:', error);
            res.status(500).json({ error: 'Internal server error during authentication' });
        }
    });

    // --- DISCORD OAUTH GET FLOW (browser redirect) ---
    const DISCORD_SCOPES = 'identify guilds guilds.members.read email';

    async function exchangeDiscordCode(code, redirectUri) {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.discord.clientId,
                client_secret: config.discord.clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            })
        });
        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            console.error('Discord Token Error:', errText);
            const error = new Error('Failed to exchange code for token');
            error.status = 400;
            throw error;
        }
        const tokenData = await tokenResponse.json();

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
        });
        if (!userResponse.ok) throw new Error('Failed to fetch user profile');
        const userData = await userResponse.json();

        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
        });
        let guildId = null;
        if (guildsResponse.ok) {
            const guilds = await guildsResponse.json();
            if (guilds.length > 0) guildId = guilds[0].id;
        }
        return { userData, guildId };
    }

    function buildFrontendUserPayload(userData, role) {
        return {
            id: userData.id,
            name: userData.username || userData.global_name || userData.id,
            username: userData.username,
            discordId: userData.id,
            avatar: userData.avatar,
            roleLevel: role,
            permissions: { dj: role >= 1, staff: role >= 2 }
        };
    }

    app.get('/auth/discord', (req, res) => {
        if (!config.discord.clientId || !config.discord.clientSecret) {
            return res.status(500).json({ error: 'Backend is missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in config' });
        }
        const redirectUri = `${req.protocol}://${req.get('host')}/auth/discord/callback`;
        const authorizeUrl =
            'https://discord.com/oauth2/authorize' +
            '?client_id=' + encodeURIComponent(config.discord.clientId) +
            '&response_type=code' +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&scope=' + encodeURIComponent(DISCORD_SCOPES) +
            '&prompt=consent';
        res.redirect(authorizeUrl);
    });

    app.get('/auth/discord/callback', async (req, res) => {
        const { code, error } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'https://voxaria.lovable.app';
        if (error || !code) {
            return res.redirect(`${frontendUrl}?login_status=failed`);
        }
        const redirectUri = `${req.protocol}://${req.get('host')}/auth/discord/callback`;
        try {
            const { userData, guildId } = await exchangeDiscordCode(code, redirectUri);
            const role = getUserRole(userData.id);
            const roles = role >= 2 ? ['staff'] : role >= 1 ? ['dj'] : [];

            const accessToken = await createAccessToken({ id: userData.id, username: userData.username, roles, guildId });
            const refreshToken = await createRefreshToken({ id: userData.id, username: userData.username, roles, guildId }, req.headers['user-agent'], req.ip);

            res.cookie('refresh_token', refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/'
            });

            const userPayload = buildFrontendUserPayload(userData, role);
            res.redirect(`${frontendUrl}?login_status=success&user=${encodeURIComponent(JSON.stringify(userPayload))}`);
        } catch (err) {
            console.error('OAuth callback error:', err.message);
            res.redirect(`${frontendUrl}?login_status=failed`);
        }
    });

    // --- SESSION VALIDATION (for backward compatibility) ---
    app.get('/auth/session', optionalAuth(), (req, res) => {
        res.json({ user: req.user });
    });

    // --- AUDIT LOGS ---
    app.get('/api/audit', async (req, res) => {
        const logs = await AuditLog.read();
        const sanitizedLogs = logs.map((log, idx) => ({
            ...log,
            id: log.id || log.timestamp || `audit-${idx}`
        }));
        res.json(sanitizedLogs);
    });

    // --- MODULAR ROUTERS ---
    app.use('/', require('./routes/music')(client, requirePermission));
    app.use('/', require('./routes/karaoke')(client, requirePermission));
    app.use('/', require('./routes/presets')(client, requirePermission));
    app.use('/', require('./routes/system')(client, requirePermission));

    // --- DISCORD SUMMON / JOIN ---
    app.post('/discord/join', async (req, res) => {
        console.log("🚀 SUMMON: Request received from dashboard.");
        try {
            const targetUserId = req.body?.userId || "895441968241459271";
            console.log("🔍 SUMMON: Searching for User ID: " + targetUserId);
            let member = null;

            for (const guild of client.guilds.cache.values()) {
                member = await guild.members.fetch(targetUserId).catch(() => null);
                if (member?.voice.channel) break;
            }

            const results = member?.voice.channel ? [{ guild: member.guild.name, channel: member.voice.channel.name }] : [];
            console.log("📊 SUMMON: Shard results found: ", JSON.stringify(results));

            if (!member?.voice.channel) {
                return res.status(400).json({ error: "I couldn't find that user in any voice channel!" });
            }

            const { joinVoiceChannel } = require('@discordjs/voice');
            joinVoiceChannel({
                channelId: member.voice.channel.id,
                guildId: member.guild.id,
                adapterCreator: member.guild.voiceAdapterCreator,
            });

            return res.json({ ok: true, channel: member.voice.channel.name });
        } catch (e) {
            console.error("❌ ERROR in Summon Route:", e.message);
            return res.status(500).json({ error: e.message });
        }
    });

    const { getVoiceConnection } = require('@discordjs/voice');

    app.post('/discord/leave', async (req, res) => {
        try {
            if (client.players && typeof client.players.forEach === 'function') {
                for (const player of client.players.values()) {
                    try {
                        if (typeof player.stop === 'function') player.stop();
                        const connection = getVoiceConnection(player.guild?.id);
                        if (connection) connection.destroy();
                    } catch (e) {
                        console.error('Leave: error stopping player:', e.message);
                    }
                }
                client.players.clear();
            }
            return res.json({ ok: true });
        } catch (e) {
            console.error('❌ ERROR in Leave Route:', e.message);
            return res.status(500).json({ error: e.message });
        }
    });

    // --- BULL BOARD DASHBOARD ---
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
        queues: [new BullMQAdapter(getKaraokeQueue())],
        serverAdapter,
    });

    app.use('/admin/queues', serverAdapter.getRouter());

    const PORT = process.env.MUSIC_API_PORT || 3002;
    const httpServer = createServer(app);

    setupWebSocket(httpServer);

    httpServer.listen(PORT, () => {
        console.log(chalk.blue(`🌐 API Bridge running on port ${PORT}`));
        console.log(chalk.green(`🔐 JWT Auth enabled with RS256`));
        console.log(chalk.green(`🔑 JWKS available at /.well-known/jwks.json`));
        console.log(chalk.green(`📊 Bull Board dashboard at http://localhost:${PORT}/admin/queues`));
        console.log(chalk.green(`🔌 WebSocket available at ws://localhost:${PORT}/ws/karaoke?guildId=<guildId>`));
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(chalk.red(`❌ Port ${PORT} already in use. API Bridge cannot start.`));
            console.error(chalk.yellow(`ℹ️  Another process may be using the port. Try: lsof -i :${PORT}`));
        } else {
            console.error(chalk.red('❌ API Server error:'), error);
        }
    });

    return httpServer;
}

module.exports = {
    startServer,
    broadcastToGuild,
};