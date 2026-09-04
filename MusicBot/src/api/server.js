const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const config = require('../../config');
const AuditLog = require('../AuditLog');

const sessionStore = new Map();
const ROLES_FILE = path.join(__dirname, '..', '..', 'roles.json');
const OWNER_ID = '895441968241459271';

function getUserRole(discordId) {
    if (discordId === OWNER_ID) return 3; // Owner implicitly has highest role
    try {
        if (fs.existsSync(ROLES_FILE)) {
            const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
            return roles[discordId] !== undefined ? roles[discordId] : 0; // 0: Guest
        }
    } catch (e) {
        console.error('❌ Failed to read roles.json:', e.message);
    }
    return 0; // Guest
}

// Numeric Role Hierarchy: 3: Owner, 2: Staff, 1: DJ, 0: Guest
function checkPermission(requiredLevel) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (requiredLevel > 0) {
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Missing or invalid Authorization header' });
            }
            const token = authHeader.split(' ')[1];
            const user = sessionStore.get(token);

            if (!user) {
                return res.status(401).json({ error: 'Invalid or expired session' });
            }

            const userRoleLevel = getUserRole(user.id);

            if (userRoleLevel < requiredLevel) {
                return res.status(403).json({ error: `Forbidden: Requires permission level ${requiredLevel}` });
            }

            req.user = { ...user, role: userRoleLevel };
        } else {
            // For Guest (0), if token is provided, resolve the user. Otherwise, set fallback guest values.
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                const user = sessionStore.get(token);
                if (user) {
                    req.user = { ...user, role: getUserRole(user.id) };
                }
            }
            if (!req.user) {
                req.user = { id: req.headers['x-user-id'] || 'guest', username: req.headers['x-user-username'] || 'Guest', role: 0 };
            }
        }
        next();
    };
}

function startServer(client) {
    const app = express();

    const corsOptions = {
        origin: [
            'https://voxaria.lovable.app', 
            'http://localhost:3000', 
            'http://localhost:5173' 
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

    // Handle preflight OPTIONS requests explicitly BEFORE cors middleware
    app.options('*path', cors(corsOptions));
    
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    // 🛡️ THE NGROK INTERCEPT BYPASS GUARD:
    // Force your server to attach the header that tells ngrok to disable the splash alert
    app.use((req, res, next) => {
        res.setHeader('ngrok-skip-browser-warning', 'true');
        // Ensure CORS headers are set on every response
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

    // --- ADMIN ENDPOINTS ---
    app.post('/admin/set-role', checkPermission(3), (req, res) => {
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

    // --- DISCORD OAUTH ENDPOINTS ---
    app.post('/auth/discord', async (req, res) => {
        const { code, redirectUri } = req.body;
        if (!code || !redirectUri) {
            return res.status(400).json({ error: 'Missing code or redirectUri' });
        }

        if (!config.discord.clientSecret) {
            return res.status(500).json({ error: 'Backend is missing DISCORD_CLIENT_SECRET in config' });
        }

        try {
            // 1. Exchange code for token
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

            // 2. Fetch User Profile
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
            });

            if (!userResponse.ok) {
                return res.status(400).json({ error: 'Failed to fetch user profile' });
            }

            const userData = await userResponse.json();

            // 3. Create Session
            const sessionToken = crypto.randomBytes(32).toString('hex');
            const userInfo = {
                id: userData.id,
                username: userData.username,
                global_name: userData.global_name,
                avatar: userData.avatar
            };

            sessionStore.set(sessionToken, userInfo);

            res.json({ token: sessionToken, user: { ...userInfo, role: getUserRole(userData.id) } });

        } catch (error) {
            console.error('OAuth2 Error:', error);
            res.status(500).json({ error: 'Internal server error during authentication' });
        }
    });

    app.get('/auth/session', (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing token' });
        }
        const token = authHeader.split(' ')[1];
        const user = sessionStore.get(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        res.json({ user: { ...user, role: getUserRole(user.id) } });
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
    app.use('/', require('./routes/music')(client, checkPermission));
    app.use('/', require('./routes/karaoke')(client, checkPermission));
    app.use('/', require('./routes/presets')(client, checkPermission));
    app.use('/', require('./routes/system')(client, checkPermission));

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

    const PORT = process.env.MUSIC_API_PORT || 3002;
    const server = app.listen(PORT, () => {
        console.log(chalk.blue(`🌐 API Bridge running on port ${PORT}`));
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(chalk.red(`❌ Port ${PORT} already in use. API Bridge cannot start.`));
            console.error(chalk.yellow(`ℹ️  Another process may be using the port. Try: lsof -i :${PORT}`));
        } else {
            console.error(chalk.red('❌ API Server error:'), error);
        }
    });

    return server;
}

module.exports = {
    startServer
};
