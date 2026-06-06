const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('./config');
const PlayerStateManager = require('./src/PlayerStateManager');
const MusicPlayer = require('./src/MusicPlayer');
const chalk = require('chalk');

require("./src/commandLoader"); // Load and deploy commands

// Clean up audio cache directory on startup
async function cleanupAudioCache() {
    const cacheDir = path.join(__dirname, 'audio_cache');

    try {
        if (fs.existsSync(cacheDir)) {
            const files = await fsPromises.readdir(cacheDir);
            const protectedFiles = PlayerStateManager.getProtectedCacheFiles();

            let deletedCount = 0;
            let skippedCount = 0;

            for (const file of files) {
                const absolutePath = path.join(cacheDir, file);

                if (protectedFiles.has(path.resolve(absolutePath))) {
                    skippedCount++;
                    continue;
                }

                try {
                    await fsPromises.unlink(absolutePath);
                    deletedCount++;
                } catch (err) {
                    console.error(chalk.red(`❌ Failed to delete ${file}:`), err.message);
                }
            }
        } else {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
    } catch (error) {
        console.error(chalk.red('❌ Failed to cleanup audio cache:'), error.message);
    }
}

async function restoreSavedPlayers(client) {
    const savedStates = PlayerStateManager.getAllStates();
    const entries = Object.entries(savedStates || {});
    if (entries.length === 0) return;

    console.log(chalk.cyan(`🔄 Found ${entries.length} saved session(s) to restore...`));

    for (const [guildId, state] of entries) {
        try {
            // Wait for guild to be available in cache
            let guild = client.guilds.cache.get(guildId);

            if (!guild) {
                // Try fetching with retry logic for sharding
                let retries = 3;
                while (!guild && retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                        guild = await client.guilds.fetch(guildId).catch(() => null);
                        if (guild) break;
                    } catch (error) {
                        retries--;
                    }
                }
            }

            if (!guild) {
                console.log(chalk.yellow(`⚠️ Guild ${guildId} not found or not accessible, removing state...`));
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const voiceChannelId = state.voiceChannelId;
            const textChannelId = state.textChannelId;

            if (!voiceChannelId || !textChannelId) {
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            let voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
            if (!voiceChannel) {
                voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
            }

            let textChannel = guild.channels.cache.get(textChannelId) || null;
            if (!textChannel) {
                textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
            }

            const isVoiceValid = voiceChannel && typeof voiceChannel.isVoiceBased === 'function' && voiceChannel.isVoiceBased();
            const isTextValid = textChannel && typeof textChannel.isTextBased === 'function' && textChannel.isTextBased();

            if (!isVoiceValid || !isTextValid) {
                console.log(chalk.yellow(`⚠️ Invalid channels for guild ${guild.name}, removing state...`));
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const player = new MusicPlayer(guild, textChannel, voiceChannel);
            client.players.set(guildId, player);

            try {
                await player.restoreFromState(state);
                console.log(chalk.green(`✅ Successfully restored session for guild ${guild.name}`));
            } catch (error) {
                console.error(chalk.red(`❌ Failed to restore music session for guild ${guild.name} (${guildId}):`), error.message);
                client.players.delete(guildId);
                player.cleanup();
                await PlayerStateManager.removeState(guildId);
            }
        } catch (error) {
            console.error(chalk.red(`❌ Error during session restoration for guild ${guildId}:`), error.message);
            await PlayerStateManager.removeState(guildId);
        }
    }
}

// Don't cleanup audio cache yet - wait until after we check saved states
setTimeout(() => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ]
        // ShardingManager automatically sets shard ID and count via environment variables
        // No need to specify shards/shardCount here - they are auto-injected
    });

    // Collections for commands and music players
    client.commands = new Collection();
    client.players = new Collection();

    // Initialize Music Embed Manager
    const MusicEmbedManager = require('./src/MusicEmbedManager');
    client.musicEmbedManager = new MusicEmbedManager(client);

    // Global reference for MusicPlayer'dan erişim
    if (!global.clients) global.clients = {};
    global.clients.musicEmbedManager = client.musicEmbedManager;

    // Load command files
    const loadCommands = () => {
        const commandsPath = path.join(__dirname, 'commands');

        // Create commands directory if it doesn't exist
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
        }

        try {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);

                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    console.log(chalk.green(`✓ Loaded command: ${command.data.name}`));
                } else {
                    console.log(chalk.yellow(`⚠ Warning: ${file} is missing required "data" or "execute" property.`));
                }
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No commands directory found, skipping command loading.'));
        }
    };

    // Load event handlers
    const loadEvents = () => {
        const eventsPath = path.join(__dirname, 'events');

        // Create events directory if it doesn't exist
        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(eventsPath, { recursive: true });
        }

        try {
            const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

            for (const file of eventFiles) {
                const filePath = path.join(eventsPath, file);
                const event = require(filePath);

                if (event.once) {
                    client.once(event.name, (...args) => event.execute(...args));
                } else {
                    client.on(event.name, (...args) => event.execute(...args));
                }
                console.log(chalk.green(`✓ Loaded event: ${event.name}`));
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No events directory found, using default events.'));
        }
    };

    // Basic ready event
    client.once(Events.ClientReady, async () => {
        console.log(chalk.green(`✅ [SHARD ${client.shard?.ids[0] ?? 0}] ${client.user.tag} is online and ready!`));
        console.log(chalk.cyan(`🎵 [SHARD ${client.shard?.ids[0] ?? 0}] Music bot serving ${client.guilds.cache.size} servers on this shard!`));

        // Log total guild count across all shards (only if running with sharding)
        // Wait a bit to ensure all shards are ready before fetching
        if (client.shard) {
            setTimeout(() => {
                client.shard.fetchClientValues('guilds.cache.size')
                    .then(results => {
                        const totalGuilds = results.reduce((acc, guildCount) => acc + guildCount, 0);
                        console.log(chalk.magenta(`🌐 [SHARD ${client.shard.ids[0]}] Total servers across all shards: ${totalGuilds}`));
                    })
                    .catch(err => {
                        // Silently fail if shards are still spawning
                        if (!err.message.includes('still being spawned')) {
                            console.error(chalk.red('Error fetching total guild count:'), err);
                        }
                    });
            }, 10000); // Wait 10 seconds for other shards to be ready
        }

        // Set bot activity
        setInterval(() => client.user.setActivity({ name: `${config.bot.status}`, type: ActivityType.Listening }), 10000);

        // Don't restore here in sharded mode - wait for shard manager to broadcast
        // For non-sharded mode, restore immediately
        if (!client.shard) {
            console.log(chalk.cyan('⏳ Non-sharded mode: waiting for guilds to be fully cached...'));
            await new Promise(resolve => setTimeout(resolve, 5000));
            await client.restoreSessions();
        }
    });

    // Add restore function to client for shard manager to call
    client.restoreSessions = async function () {
        //console.log(chalk.cyan(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] 🔄 Starting session restore...`));
        //await restoreSavedPlayers(client);
        //await cleanupAudioCache();
        //console.log(chalk.green(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ✅ Session restore complete`));
    };

    // Handle interactions (slash commands)
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(chalk.red(`❌ Error executing ${interaction.commandName}:`), error);

            const errorMessage = '❌ An error occurred while executing this command!';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    // Handle voice state updates for pause/resume and cleanup
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        const guild = oldState.guild;
        const player = client.players.get(guild.id);
        if (!player) return;

        const botMember = guild.members.me;
        const botId = botMember?.id ?? client.user.id;
        const involvesBot = oldState.id === botId || newState.id === botId;

        if (involvesBot) {
            const oldChannelId = oldState.channelId;
            const newChannelId = newState.channelId;

            if (oldChannelId && !newChannelId) {
                try {
                    const embedManager = client.musicEmbedManager || global.clients?.musicEmbedManager;

                    // Mark state as ended so UI reflects the change
                    player.pendingEndReason = 'forced-disconnect';
                    player.queue = [];
                    player.currentTrack = null;

                    if (embedManager) {
                        await embedManager.handlePlaybackEnd(player);
                    } else if (typeof player.showQueueCompleted === 'function') {
                        await player.showQueueCompleted();
                    }
                } catch (error) {
                    console.error('❌ Failed to update playback UI after forced disconnect:', error);
                } finally {
                    player.cleanup();
                    client.players.delete(guild.id);
                }
                return;
            }

            if (newChannelId && oldChannelId !== newChannelId) {
                if (newState.channel) {
                    await player.moveToChannel(newState.channel);
                    player.clearInactivityTimer(false);
                    if (client.musicEmbedManager) {
                        await client.musicEmbedManager.updateNowPlayingEmbed(player);
                    }
                }
            }

            const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
            const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;

            if (!wasMuted && isMuted) {
                const paused = player.pauseFor('mute');
                if (paused && client.musicEmbedManager) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }
            } else if (wasMuted && !isMuted) {
                const resumed = player.resumeFor('mute');
                if (client.musicEmbedManager && (resumed || !player.pauseReasons.has('mute'))) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }
            }
        }

        const voiceChannelId = player.voiceChannel?.id;
        if (!voiceChannelId) return;

        if (oldState.channelId === voiceChannelId || newState.channelId === voiceChannelId) {
            const channel = guild.channels.cache.get(voiceChannelId);

            if (!channel) {
                player.cleanup();
                client.players.delete(guild.id);
                return;
            }

            const listeners = channel.members.filter(member => !member.user.bot).size;

            if (listeners === 0) {
                const alreadyPaused = player.pauseReasons.has('alone');
                player.startInactivityTimer();
                if (!alreadyPaused && client.musicEmbedManager && player.currentTrack) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }
            } else {
                const wasPausedForAlone = player.pauseReasons.has('alone');
                player.clearInactivityTimer(true);
                if (wasPausedForAlone && client.musicEmbedManager && player.currentTrack) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }
            }
        }
    });

    // Handle process termination
    process.on('SIGINT', () => {

        // Disconnect from all voice channels
        client.players.forEach((player, guildId) => {
            player.stop();
            const connection = getVoiceConnection(guildId);
            if (connection) connection.destroy();
        });

        client.destroy();
        process.exit(0);
    });

    // Error handling
    process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

        // Discord API error handling
        if (reason && reason.code) {
            switch (reason.code) {
                case 10062: // Unknown interaction
                    console.log(chalk.yellow('ℹ️ Interaction has expired, safely ignoring...'));
                    return;
                case 40060: // Interaction already acknowledged
                    console.log(chalk.yellow('ℹ️ Interaction already acknowledged, safely ignoring...'));
                    return;
                case 50013: // Missing permissions
                    console.error(chalk.red('❌ Missing permissions for Discord action'));
                    return;
            }
        }

        // Voice connection errors
        if (reason && reason.message && reason.message.includes('IP discovery')) {
            // Clean up any voice connections
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
            return;
        }
    });

    process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught Exception:'), error);

        // Don't exit on Discord API errors
        if (error.code === 10062 || error.code === 40060) {
            console.log(chalk.yellow('ℹ️ Discord interaction error handled, continuing...'));
            return;
        }

        // Handle fetch/network termination errors - don't crash
        if (error.message && (error.message.includes('terminated') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT'))) {
            console.log(chalk.yellow('⚠️ Network error occurred, but bot continues running...'));
            return;
        }

        // For other critical errors, graceful shutdown
        console.log(chalk.red('🛑 Critical error occurred, shutting down...'));

        // Clean up all music players
        if (client && client.players) {
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
        }

        process.exit(1);
    });

    // Initialize bot
    const init = async () => {
        try {
            console.log(chalk.blue('🤖 Starting Discord Music Bot...'));

            // Load commands and events
            loadCommands();
            loadEvents();

            // Graceful shutdown handler
            const gracefulShutdown = async (signal) => {
                // Save all active player states before shutdown
                const savePromises = [];
                for (const [guildId, player] of client.players) {
                    if (player && typeof player.persistState === 'function') {
                        if (global.sessionRestoreEnabled !== false) {
                            // Use immediate=true to bypass debouncing
                            savePromises.push(player.persistState('shutdown', true).catch(err => {
                                console.error(chalk.red(`Failed to save state for guild ${guildId}:`), err);
                            }));
                        }
                    }
                }

                await Promise.all(savePromises);
                // Give time for saves to complete
                await new Promise(resolve => setTimeout(resolve, 1000));

                process.exit(0);
            };

            // Register shutdown handlers
            process.on('SIGINT', () => gracefulShutdown('SIGINT'));
            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

            // Windows specific handlers
            if (process.platform === 'win32') {
                const readline = require('readline');
                if (process.stdin.isTTY) {
                    readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    }).on('SIGINT', () => gracefulShutdown('SIGINT'));
                }
            }

            // Setup API Bridge
            const express = require('express');
            const cors = require('cors');
            const app = express();
            const AuditLog = require('./src/AuditLog');

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

            app.use(cors(corsOptions));
            app.use(express.json());

            app.use((req, res, next) => {
                console.log(chalk.cyan(`📡 [${req.method}] ${req.path}`));
                console.log(chalk.gray(`🆔 Guild Header: ${req.headers['x-guild-id'] || req.headers['X-Guild-Id'] || req.headers['guild-id'] || 'None'}`));
                console.log(chalk.gray(`📦 Body: ${req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : 'undefined'}`));
                next();
            });

            // --- AUTHENTICATION & PERMISSIONS ---
            const sessionStore = new Map();
            const crypto = require('crypto');
            const ROLES_FILE = path.join(__dirname, 'roles.json');
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

            app.get('/api/audit', async (req, res) => {
                const logs = await AuditLog.read();
                const sanitizedLogs = logs.map((log, idx) => ({
                    ...log,
                    id: log.id || log.timestamp || `audit-${idx}`
                }));
                res.json(sanitizedLogs);
            });

            app.get('/bot/status', (req, res) => {
                res.json({
                    activeShard: client.shard?.ids[0] ?? 0,
                    pingMs: client.ws.ping,
                    uptime: client.uptime || (process.uptime() * 1000),
                    online: true
                });
            });

            // Helper: extract YouTube video ID from any YT URL
            const extractYtVideoId = (url) => {
                if (!url) return null;
                const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                return match ? match[1] : null;
            };

            app.get('/music/player', (req, res) => {
                const player = client.players.first();
                if (!player) return res.json(null);

                const track = player.currentTrack;

                // Calculate absolute timestamps for precise UI syncing
                // Buffer Adjusted Start Time: take the moment the audio stream actually hits the connection
                const streamTimeMs = player.resource ? player.resource.playbackDuration : 0;
                const currentPosMs = (player.currentTrackStartOffsetMs || 0) + streamTimeMs;
                
                const bufferAdjustedStartTime = Date.now() - currentPosMs;
                const lastPausedAt = player.paused ? Date.now() : null;

                // Derive thumbnail: prefer stored value, fall back to YouTube CDN URL from video ID
                const ytVideoId = extractYtVideoId(track?.url);
                const resolvedArt = track?.thumbnail ||
                    (ytVideoId ? `https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg` : null);

                res.json({
                    id: track?.id || track?.url || null,
                    title: track?.title || null,
                    artist: track?.artist || null,
                    url: track?.url || null,
                    trackUrl: track?.url || null,
                    durationSec: track?.duration || 0,
                    positionSec: Math.floor(currentPosMs / 1000),
                    startTime: bufferAdjustedStartTime,
                    serverTime: Date.now(),
                    lastPausedAt: lastPausedAt,
                    isPaused: player.paused,
                    playing: !player.paused,
                    art: resolvedArt,
                    thumbnail: resolvedArt,
                    volume: player.volume || 100,
                    requesterName: track?.requestedBy?.tag || track?.requestedBy?.username || track?.requesterTag || null,
                    requesterAvatar: track?.requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${track.requestedBy.id}/${track.requestedBy.avatar}.png` : null
                });
            });

            // 1. Universal Summon: Finds Hayden in any server
            app.post('/discord/join', async (req, res) => {
                console.log("🚀 SUMMON: Request received from dashboard.");
                try {
                    const myUserId = "895441968241459271";
                    console.log("🔍 SUMMON: Searching for User ID: " + myUserId);
                    let member = null;

                    // Search every server for Hayden
                    for (const guild of client.guilds.cache.values()) {
                        member = await guild.members.fetch(myUserId).catch(() => null);
                        if (member?.voice.channel) break;
                    }

                    const results = member?.voice.channel ? [{ guild: member.guild.name, channel: member.voice.channel.name }] : [];
                    console.log("📊 SUMMON: Shard results found: ", JSON.stringify(results));

                    if (!member?.voice.channel) {
                        return res.status(400).json({ error: "I couldn't find you in any voice channel!" });
                    }

                    // Using the native voice utility
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

            // 2. Multi-Provider Lyrics route with console auditing
            app.post('/music/lyrics', async (req, res) => {
                let { title, artist, trackUrl, forceResync } = req.body;
                
                // Helper: extract YouTube video ID from any YT URL
                const extractYtVideoId = (url) => {
                    if (!url) return 'unknown';
                    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                    return match ? match[1] : 'unknown';
                };

                const videoId = extractYtVideoId(trackUrl || '');

                // 1. Check if the Title contains a dash (e.g. "Artist - Song")
                if (title && title.includes(" - ")) {
                    const parts = title.split(" - ");
                    artist = parts[0];
                    title = parts[1];
                }

                // 2. Robust Metadata Cleaning
                const cleanMetadata = (str) => {
                    if (!str) return "";
                    let cleaned = str;
                    cleaned = cleaned.replace(/\(.*?\)|\[.*?\]|【.*?】/g, ' ');
                    cleaned = cleaned.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
                    cleaned = cleaned.replace(/\b(MV|Lyrics|High Quality|HD|Official|Video|Audio|4K|Remastered|Topic|Records|Channel)\b/gi, ' ');
                    cleaned = cleaned.split(/[-—|]/)[0];
                    cleaned = cleaned.replace(/\s+/g, ' ').trim();
                    const duplicateRegex = /^(.+?)(?:\s+\1)+$/i;
                    const match = cleaned.match(duplicateRegex);
                    if (match) {
                        cleaned = match[1];
                    }
                    return cleaned.trim();
                };

                const cleanTitle = cleanMetadata(title);
                const cleanArtist = cleanMetadata(artist);

                const trackId = videoId !== 'unknown' ? videoId : crypto.createHash('md5').update(`${cleanTitle}-${cleanArtist}`).digest('hex');
                const cacheFilePath = path.join(__dirname, 'audio_cache', `lyrics_${trackId}.json`);

                if (forceResync !== true && fs.existsSync(cacheFilePath)) {
                    try {
                        const cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                        console.log(chalk.green(`💾 [LyricsManager] Cache hit (file): Returning cached lyrics for ${trackId}`));
                        return res.json(cachedData);
                    } catch (e) {
                        console.error("Failed to read cached lyrics file:", e);
                    }
                }

                console.log(chalk.cyan(`🔍 [LyricsManager] Starting fetchLyrics for title: "${title}", artist: "${artist}", platform: "youtube", id: "${videoId}"`));

                console.log(chalk.blue(`[LyricsManager] Attempting Genius search with query: "${cleanArtist} ${cleanTitle}"...`));
                console.log(chalk.blue(`[LyricsManager] Attempting parallel LRCLIB lookup for clean title: "${cleanTitle}", artist: "${cleanArtist}"...`));
                console.log(chalk.gray(`[LyricsManager] Launching LRCLIB query 1/5: {"q":"${cleanTitle}"}`));
                console.log(chalk.gray(`[LyricsManager] Launching LRCLIB query 2/5: {"q":"${cleanTitle} by ${cleanArtist}"}`));
                console.log(chalk.gray(`[LyricsManager] Launching LRCLIB query 3/5: {"q":"${cleanArtist} ${cleanTitle}"}`));
                console.log(chalk.gray(`[LyricsManager] Launching LRCLIB query 4/5: {"track_name":"${cleanTitle}","artist_name":"${cleanArtist}"}`));
                console.log(chalk.gray(`[LyricsManager] Launching LRCLIB query 5/5: {"q":"${cleanTitle}"}`));
                console.log(chalk.cyan(`📡 [LyricsManager] Dispatching concurrent requests to Genius, LRCLIB, and YouTube Music...`));

                let lrclibLyrics = null;
                let lrclibSynced = false;
                let geniusLyrics = null;
                let ytmusicLyrics = null;
                let ytmusicSynced = false;

                // Create parallel fetch promises
                const lrclibPromise = (async () => {
                    try {
                        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
                        const response = await fetch(url);
                        const data = await response.json();
                        if (data && data.length > 0) {
                            const match = data[0];
                            lrclibLyrics = match.syncedLyrics || match.plainLyrics || null;
                            lrclibSynced = !!match.syncedLyrics;
                            if (lrclibLyrics) {
                                console.log(chalk.green(`[LyricsManager] LRCLIB successfully retrieved lyrics (length: ${lrclibLyrics.length}, synced: ${lrclibSynced}).`));
                            }
                        }
                    } catch (e) {
                        console.log(chalk.yellow(`[LyricsManager] LRCLIB query failed: ${e.message}`));
                    }
                })();

                const geniusPromise = (async () => {
                    try {
                        const Genius = require('genius-lyrics');
                        const geniusClient = new Genius.Client();
                        const query = `${cleanArtist} ${cleanTitle}`.trim();
                        const searches = await geniusClient.songs.search(query);
                        if (searches && searches.length > 0) {
                            geniusLyrics = await searches[0].lyrics();
                            if (geniusLyrics) {
                                console.log(chalk.green(`[LyricsManager] Genius lyrics retrieved successfully (length: ${geniusLyrics.length}).`));
                            }
                        }
                    } catch (e) {
                        console.log(chalk.yellow(`[LyricsManager] Genius search failed/no results: ${e.message}`));
                    }
                })();

                const ytmusicPromise = (async () => {
                    try {
                        const { execFile } = require('child_process');
                        const pythonScript = path.join(__dirname, 'scripts', 'ytmusic_lyrics.py');
                        
                        await new Promise((resolve) => {
                            execFile('python', [pythonScript, videoId, cleanTitle, cleanArtist], { timeout: 10000 }, (error, stdout) => {
                                try {
                                    if (!error && stdout) {
                                        const resData = JSON.parse(stdout);
                                        if (resData.success && resData.lyrics) {
                                            ytmusicLyrics = resData.lyrics;
                                            ytmusicSynced = resData.synced;
                                            console.log(chalk.green(`[LyricsManager] YouTube Music successfully retrieved lyrics (length: ${ytmusicLyrics.length}, synced: ${ytmusicSynced}).`));
                                        }
                                    }
                                } catch (_) {}
                                resolve();
                            });
                        });
                    } catch (e) {
                        console.log(chalk.yellow(`[LyricsManager] YouTube Music query failed: ${e.message}`));
                    }
                })();

                // Wait for all concurrent queries (10s max timeout total)
                await Promise.all([lrclibPromise, geniusPromise, ytmusicPromise]);

                // Sort/Resolve priorities:
                // 1. LRCLIB Synced
                // 2. YouTube Music Synced
                // 3. Genius (Plain) / YouTube Music Plain / LRCLIB Plain
                let selectedLyrics = null;
                let selectedSource = "None";

                if (lrclibLyrics && lrclibSynced) {
                    selectedLyrics = lrclibLyrics;
                    selectedSource = "LRCLIB (Synced)";
                    console.log(chalk.green(`🏆 [LyricsManager] Priority 1: Selected official LRCLIB Synced lyrics.`));
                } else if (ytmusicLyrics && ytmusicSynced) {
                    selectedLyrics = ytmusicLyrics;
                    selectedSource = "YouTube Music (Synced)";
                    console.log(chalk.green(`🏆 [LyricsManager] Priority 2: Selected YouTube Music Synced lyrics.`));
                } else if (geniusLyrics) {
                    selectedLyrics = geniusLyrics;
                    selectedSource = "Genius (Plain)";
                    console.log(chalk.green(`🏆 [LyricsManager] Priority 3: Selected Genius Plain lyrics.`));
                } else if (ytmusicLyrics) {
                    selectedLyrics = ytmusicLyrics;
                    selectedSource = "YouTube Music (Plain)";
                    console.log(chalk.green(`🏆 [LyricsManager] Priority 3: Selected YouTube Music Plain lyrics.`));
                } else if (lrclibLyrics) {
                    selectedLyrics = lrclibLyrics;
                    selectedSource = "LRCLIB (Plain)";
                    console.log(chalk.green(`🏆 [LyricsManager] Priority 3: Selected LRCLIB Plain lyrics.`));
                }

                if (selectedLyrics) {
                    console.log(chalk.green(`💾 [LyricsManager] Lyrics resolved from: ${selectedSource}. Storing in cache.`));
                    const isSynced = selectedSource.includes("(Synced)");
                    const payload = {
                        title: cleanTitle,
                        artist: cleanArtist,
                        source: selectedSource,
                        synced: isSynced ? selectedLyrics : "",
                        plain: !isSynced ? selectedLyrics : "",
                        hasSynced: isSynced,
                        lines: selectedLyrics.split('\n')
                    };

                    let shouldWrite = true;
                    if (fs.existsSync(cacheFilePath)) {
                        try {
                            const existing = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                            const existingSynced = existing && (existing.hasSynced || existing.synced);
                            if (existingSynced && !isSynced) {
                                shouldWrite = false;
                                console.log(chalk.yellow(`[LyricsManager] Overwrite check: Synced lyrics already exist. Rejecting plain lyrics overwrite for ${trackId}.`));
                            }
                        } catch (e) {
                            console.error("Failed to parse existing cached lyrics file for overwrite check:", e);
                        }
                    }

                    if (shouldWrite) {
                        try {
                            fs.writeFileSync(cacheFilePath, JSON.stringify(payload, null, 2), 'utf8');
                        } catch (e) {
                            console.error("Failed to write lyrics to file cache:", e);
                        }
                    }

                    return res.json(payload);
                }

                console.log(chalk.red(`⚠️ [LyricsManager] No lyrics resolved from any source.`));
                return res.json({
                    title: cleanTitle,
                    artist: cleanArtist,
                    source: "None",
                    synced: "",
                    plain: "",
                    hasSynced: false,
                    lines: []
                });
            });

            app.get('/music/queue', (req, res) => {
                const player = client.players.first();
                if (!player || !player.queue) return res.json([]);

                res.json(player.queue.map(track => {
                    const ytId = extractYtVideoId(track.url);
                    const art = track.thumbnail ||
                        (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
                    return {
                        id: track.id || track.url || Math.random().toString(36).substr(2, 9),
                        title: track.title || 'Unknown',
                        artist: track.artist || 'Unknown',
                        url: track.url || null,
                        trackUrl: track.url || null,
                        thumbnail: art,
                        art: art,
                        artworkUrl: art,
                        duration: track.duration || 0,
                        length: track.duration || 0,
                        requestedBy: track.requestedBy?.tag || track.requestedBy?.username || track.requesterTag || 'Unknown',
                        requesterName: track.requestedBy?.tag || track.requestedBy?.username || track.requesterTag || 'Unknown',
                        requesterAvatar: track.requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${track.requestedBy.id}/${track.requestedBy.avatar}.png` : null
                    };
                }));
            });

            app.post('/music/playback', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                const { action } = req.body;
                if (action === 'play_pause') {
                    if (player.paused) player.resumeFor('api');
                    else player.pauseFor('api');
                } else if (action === 'next') {
                    if (typeof player.skip === 'function') player.skip();
                } else if (action === 'previous') {
                    if (typeof player.previous === 'function') player.previous();
                } else if (action === 'stop') {
                    if (typeof player.stop === 'function') player.stop();
                }
                res.json({ success: true });
            });

            app.post('/music/skip', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });
                if (typeof player.skip === 'function') player.skip();
                res.json({ success: true });
            });

            app.post('/music/previous', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });
                if (typeof player.previous === 'function') player.previous();
                res.json({ success: true });
            });

            app.post('/music/stop', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });
                if (typeof player.stop === 'function') player.stop();
                res.json({ success: true });
            });

            app.post('/music/volume', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                const { volume } = req.body;
                if (typeof volume === 'number') {
                    if (typeof player.setVolume === 'function') player.setVolume(volume);
                    res.json({ success: true, volume });
                } else {
                    res.status(400).json({ error: 'Invalid volume' });
                }
            });

            app.get('/music/history', (req, res) => {
                const player = client.players.first();
                if (!player || !player.previousTracks) return res.json([]);

                res.json(player.previousTracks.map(track => {
                    const ytId = extractYtVideoId(track.url);
                    const art = track.thumbnail ||
                        (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
                    return {
                        id: track.id || track.url || Math.random().toString(36).substr(2, 9),
                        title: track.title || 'Unknown',
                        artist: track.artist || 'Unknown',
                        url: track.url || null,
                        trackUrl: track.url || null,
                        thumbnail: art,
                        art: art,
                        artworkUrl: art,
                        duration: track.duration || 0,
                        length: track.duration || 0,
                        requestedBy: track.requestedBy?.tag || track.requestedBy?.username || track.requesterTag || 'Unknown',
                        requesterName: track.requestedBy?.tag || track.requestedBy?.username || track.requesterTag || 'Unknown',
                        requesterAvatar: track.requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${track.requestedBy.id}/${track.requestedBy.avatar}.png` : null
                    };
                }));
            });

            app.get('/system/settings', (req, res) => {
                res.json({ sessionRestoreEnabled: global.sessionRestoreEnabled !== false });
            });

            const requestHandler = async (req, res) => {
                const { query, guildId } = req.body;
                if (!query) return res.status(400).json({ error: 'Query is required' });

                const targetGuildId = guildId || req.headers['x-guild-id'];
                let player = null;
                
                if (targetGuildId) {
                    player = client.players.get(targetGuildId);
                }
                
                if (!player) {
                    const targetUserId = req.user?.id || req.headers['x-user-id'];
                    let voiceChannel = null;
                    let guild = null;

                    if (targetGuildId) {
                        guild = client.guilds.cache.get(targetGuildId);
                        if (guild && targetUserId) {
                            const member = guild.members.cache.get(targetUserId);
                            if (member && member.voice.channel) {
                                voiceChannel = member.voice.channel;
                            }
                        }
                    }

                    if (!voiceChannel && targetUserId) {
                        for (const g of client.guilds.cache.values()) {
                            const member = g.members.cache.get(targetUserId);
                            if (member && member.voice.channel) {
                                voiceChannel = member.voice.channel;
                                guild = g;
                                break;
                            }
                        }
                    }

                    if (!voiceChannel) {
                        const firstGuild = client.guilds.cache.first();
                        if (firstGuild) {
                            guild = firstGuild;
                            voiceChannel = guild.channels.cache.find(c => c.type === 2 || c.type === 'GUILD_VOICE');
                        }
                    }

                    if (!voiceChannel) {
                        return res.status(400).json({ error: 'User not in a voice channel, and no voice channels available.' });
                    }

                    const textChannel = guild.channels.cache.find(c => c.isTextBased()) || null;
                    const MusicPlayer = require('./src/MusicPlayer');
                    player = new MusicPlayer(guild, textChannel, voiceChannel);
                    client.players.set(guild.id, player);
                }

                try {
                    const requesterTag = req.user?.username || req.headers['x-user-username'] || 'Dashboard User';
                    const requesterId = req.user?.id || req.headers['x-user-id'] || '1';

                    const isPlaying = player.currentTrack && player.audioPlayer && player.audioPlayer.state && player.audioPlayer.state.status !== 'idle';
                    
                    if (isPlaying) {
                        const platform = player.detectPlatform(query);
                        const Spotify = require('./src/Spotify');
                        const YouTube = require('./src/YouTube');
                        const SoundCloud = require('./src/SoundCloud');
                        const DirectLink = require('./src/DirectLink');
                        let tracks = [];

                        if (platform === 'youtube') {
                            if (typeof YouTube.isPlaylist === 'function' && YouTube.isPlaylist(query)) {
                                const playlistData = await YouTube.getPlaylist(query, player.guild.id);
                                tracks = playlistData ? playlistData.tracks : [];
                            } else {
                                tracks = await YouTube.search(query, 3, player.guild.id);
                                if (tracks && tracks.length > 0) {
                                    tracks.sort((a, b) => (b.views || 0) - (a.views || 0));
                                    tracks = [tracks[0]];
                                }
                            }
                        } else if (platform === 'spotify') {
                            if (Spotify.isSpotifyURL(query)) {
                                tracks = await Spotify.getFromURL(query, player.guild.id);
                            } else {
                                tracks = await Spotify.search(query, 1, 'track', player.guild.id);
                            }
                        } else if (platform === 'soundcloud') {
                            tracks = await SoundCloud.search(query, 1, player.guild.id);
                        } else if (platform === 'direct') {
                            tracks = await DirectLink.getInfo(query);
                        } else {
                            try {
                                tracks = await Spotify.search(query, 1, 'track', player.guild.id);
                            } catch (_) {}
                            if (!tracks || tracks.length === 0) {
                                tracks = await YouTube.search(query, 3, player.guild.id);
                                if (tracks && tracks.length > 0) {
                                    tracks.sort((a, b) => (b.views || 0) - (a.views || 0));
                                    tracks = [tracks[0]];
                                }
                            }
                        }

                        if (!tracks || tracks.length === 0) {
                            return res.status(400).json({ error: 'No results found' });
                        }

                        for (const track of tracks) {
                            track.requestedBy = { tag: requesterTag, id: requesterId };
                            track.addedAt = Date.now();
                            player.queue.push(track);
                            player.preloadTrack(track).catch(err => console.error("Preload error:", err));
                        }
                    } else {
                        await player.addTrack(query, { tag: requesterTag, id: requesterId });
                    }

                    res.json({ success: true, ok: true });
                } catch (error) {
                    res.status(500).json({ error: error.message });
                }
            };

            app.post('/music/search', checkPermission(0), requestHandler);
            app.post('/music/request', checkPermission(0), requestHandler);

            app.get('/system/audio-cache', async (req, res) => {
                const cacheDir = path.join(__dirname, 'audio_cache');
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

            app.post('/api/cache/clean', async (req, res) => {
                try {
                    await cleanupAudioCache();
                    res.json({ success: true, message: 'Audio cache cleaned successfully.' });
                } catch (error) {
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            global.sessionRestoreEnabled = true;
            app.post('/api/settings/session-restore', (req, res) => {
                const { enabled } = req.body;
                if (typeof enabled === 'boolean') {
                    global.sessionRestoreEnabled = enabled;
                    res.json({ success: true, message: `Session restore feature ${enabled ? 'enabled' : 'disabled'}.` });
                } else {
                    res.status(400).json({ success: false, error: 'Invalid boolean value for "enabled".' });
                }
            });

            // ── Queue Mutation API ──────────────────────────────────────────

            app.post('/queue/reorder', checkPermission(2), (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                const { oldIndex, newIndex } = req.body;
                if (typeof oldIndex !== 'number' || typeof newIndex !== 'number') {
                    return res.status(400).json({ error: 'oldIndex and newIndex must be numbers' });
                }
                if (oldIndex < 0 || oldIndex >= player.queue.length || newIndex < 0 || newIndex >= player.queue.length) {
                    return res.status(400).json({ error: 'Index out of bounds' });
                }

                const success = player.moveInQueue(oldIndex, newIndex);
                if (success) {
                    console.log(chalk.cyan(`🔀 Queue reordered: index ${oldIndex} → ${newIndex}`));
                    res.json({ success: true, queue: player.queue.map(t => ({ title: t.title, artist: t.artist })) });
                } else {
                    res.status(400).json({ error: 'Failed to reorder queue' });
                }
            });

            app.delete('/queue/:index', checkPermission(0), (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                const index = parseInt(req.params.index, 10);
                if (isNaN(index) || index < 0 || index >= player.queue.length) {
                    return res.status(400).json({ error: 'Invalid index' });
                }

                const track = player.queue[index];
                if (req.user.role < 2 && track.requestedBy?.id !== req.user.id) {
                    return res.status(403).json({ error: 'Forbidden: You can only remove songs you added.' });
                }

                const removed = player.removeFromQueue(index);
                if (removed) {
                    console.log(chalk.cyan(`🗑️ Removed from queue: ${removed.title} by ${req.user.username}`));
                    res.json({ success: true, removed: { title: removed.title, artist: removed.artist } });
                } else {
                    res.status(400).json({ error: 'Failed to remove track' });
                }
            });

            // ── Playback History (Back Button) ─────────────────────────────

            app.post('/player/previous', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                if (!player.previousTracks || player.previousTracks.length === 0) {
                    return res.status(400).json({ error: 'No previous tracks in history' });
                }

                const success = player.previous();
                if (success) {
                    console.log(chalk.cyan('⏮️ Playing previous track from history'));
                    res.json({ success: true });
                } else {
                    res.status(400).json({ error: 'Failed to go to previous track' });
                }
            });

            // ── Persistent Presets ──────────────────────────────────────────

            const PRESETS_PATH = path.join(__dirname, 'presets.json');

            function readPresets() {
                try {
                    if (fs.existsSync(PRESETS_PATH)) {
                        const raw = fs.readFileSync(PRESETS_PATH, 'utf-8');
                        return JSON.parse(raw);
                    }
                } catch (e) {
                    console.error(chalk.red('❌ Failed to read presets.json:'), e.message);
                }
                return {};
            }

            function writePresets(data) {
                try {
                    const content = JSON.stringify(data, null, 2);
                    fs.writeFileSync(PRESETS_PATH, content, 'utf-8');
                    return true;
                } catch (e) {
                    console.error(chalk.red('❌ Failed to write presets.json:'), e.message);
                    return false;
                }
            }

            app.post('/presets/save', checkPermission(2), (req, res) => {
                const { name } = req.body;
                if (!name || typeof name !== 'string') {
                    return res.status(400).json({ error: 'Preset name is required' });
                }

                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                const tracks = [];
                if (player.currentTrack) {
                    tracks.push({
                        title: player.currentTrack.title,
                        artist: player.currentTrack.artist,
                        url: player.currentTrack.url,
                        duration: player.currentTrack.duration,
                        thumbnail: player.currentTrack.thumbnail,
                        platform: player.currentTrack.platform
                    });
                }
                for (const t of player.queue) {
                    tracks.push({
                        title: t.title,
                        artist: t.artist,
                        url: t.url,
                        duration: t.duration,
                        thumbnail: t.thumbnail,
                        platform: t.platform
                    });
                }

                if (tracks.length === 0) {
                    return res.status(400).json({ error: 'Queue is empty, nothing to save' });
                }

                const presets = readPresets();
                presets[name] = { tracks, savedAt: new Date().toISOString() };
                const success = writePresets(presets);

                if (success) {
                    console.log(chalk.green(`💾 Preset saved: "${name}" (${tracks.length} tracks)`));
                    res.json({ success: true, name, trackCount: tracks.length });
                } else {
                    res.status(500).json({ error: 'Failed to write presets file' });
                }
            });

            app.get('/presets', (req, res) => {
                const presets = readPresets();
                const result = Object.entries(presets).map(([name, data]) => ({
                    name,
                    trackCount: data.tracks?.length || 0,
                    savedAt: data.savedAt || null,
                    tracks: data.tracks || []
                }));
                res.json(result);
            });

            app.post('/presets/load', checkPermission(2), async (req, res) => {
                const { name } = req.body;
                if (!name || typeof name !== 'string') {
                    return res.status(400).json({ error: 'Preset name is required' });
                }

                const presets = readPresets();
                if (!presets[name]) {
                    return res.status(404).json({ error: `Preset "${name}" not found` });
                }

                const preset = presets[name];
                let player = client.players.first();

                if (!player) {
                    // Auto-create a player if user is in a voice channel
                    const targetUserId = '895441968241459271';
                    let voiceChannel = null;
                    let guild = null;

                    for (const g of client.guilds.cache.values()) {
                        const member = g.members.cache.get(targetUserId);
                        if (member && member.voice.channel) {
                            voiceChannel = member.voice.channel;
                            guild = g;
                            break;
                        }
                    }

                    if (!voiceChannel) {
                        return res.status(400).json({ error: 'User not in a voice channel.' });
                    }

                    const textChannel = guild.channels.cache.find(c => c.isTextBased()) || null;
                    const MusicPlayerClass = require('./src/MusicPlayer');
                    player = new MusicPlayerClass(guild, textChannel, voiceChannel);
                    client.players.set(guild.id, player);
                }

                const wasIdle = !player.currentTrack;
                let loadedCount = 0;
                const resolvedTracks = [];
                for (const track of preset.tracks) {
                    try {
                        const query = track.url || `${track.title} ${track.artist}`;
                        const platform = player.detectPlatform(query);
                        const Spotify = require('./src/Spotify');
                        const YouTube = require('./src/YouTube');
                        const SoundCloud = require('./src/SoundCloud');
                        const DirectLink = require('./src/DirectLink');
                        let tracks = [];

                        if (platform === 'youtube') {
                            tracks = await YouTube.search(query, 3, player.guild.id);
                            if (tracks && tracks.length > 0) {
                                tracks.sort((a, b) => (b.views || 0) - (a.views || 0));
                                tracks = [tracks[0]];
                            }
                        } else if (platform === 'spotify') {
                            if (Spotify.isSpotifyURL(query)) {
                                tracks = await Spotify.getFromURL(query, player.guild.id);
                            } else {
                                tracks = await Spotify.search(query, 1, 'track', player.guild.id);
                            }
                        } else if (platform === 'soundcloud') {
                            tracks = await SoundCloud.search(query, 1, player.guild.id);
                        } else if (platform === 'direct') {
                            tracks = await DirectLink.getInfo(query);
                        } else {
                            try {
                                tracks = await Spotify.search(query, 1, 'track', player.guild.id);
                            } catch (_) {}
                            if (!tracks || tracks.length === 0) {
                                tracks = await YouTube.search(query, 3, player.guild.id);
                                if (tracks && tracks.length > 0) {
                                    tracks.sort((a, b) => (b.views || 0) - (a.views || 0));
                                    tracks = [tracks[0]];
                                }
                            }
                        }

                        if (tracks && tracks.length > 0) {
                            for (const t of tracks) {
                                t.requestedBy = { tag: 'Dashboard Preset', id: 'API' };
                                t.addedAt = Date.now();
                                resolvedTracks.push(t);
                                loadedCount++;
                            }
                        }
                    } catch (e) {
                        console.error(chalk.yellow(`⚠️ Failed to resolve preset track: ${track.title}`), e.message);
                    }
                }

                // Append all cleanly to the queue
                for (const t of resolvedTracks) {
                    if (player.currentTrack) {
                        player.queue.push(t);
                    } else {
                        player.currentTrack = t;
                    }
                    player.preloadTrack(t).catch(err => console.error("Preload error:", err));
                }

                // If player was idle, start playing the first track
                if (wasIdle && player.currentTrack) {
                    await player.play(null, 0);
                }

                console.log(chalk.green(`📂 Preset loaded: "${name}" (${loadedCount}/${preset.tracks.length} tracks)`));
                res.json({ success: true, name, loaded: loadedCount, total: preset.tracks.length });
            });

            // ── Karaoke Stem & Pitch API ────────────────────────────────────

            const { execFile } = require('child_process');
            const STEMS_DIR = path.join(__dirname, 'audio_cache', 'stems');
            const karaokeJobs = new Map(); // jobId -> { status, outputDir, error? }

            if (!fs.existsSync(STEMS_DIR)) {
                fs.mkdirSync(STEMS_DIR, { recursive: true });
            }

            const getFormattedPitchMap = (outputDir) => {
                const pitchMapPath = path.join(outputDir, 'pitch_map.json');
                let rawPitchMap = [];
                try {
                    rawPitchMap = JSON.parse(fs.readFileSync(pitchMapPath, 'utf-8'));
                } catch (_) {}

                return rawPitchMap.map(f => {
                    const freq = f.freq;
                    const midi = freq > 0 ? Math.round(12 * Math.log2(freq / 440) + 69) : 0;
                    return {
                        timeMs: Math.round(f.time * 1000),
                        midi: midi
                    };
                });
            };

            const karaokePrepareHandler = async (req, res) => {
                try {
                    const player = client.players.first();
                    const trackUrl = req.body.trackUrl || player?.currentTrack?.url;

                    if (!trackUrl) {
                        return res.status(400).json({ error: 'No track URL provided and no track is currently playing' });
                    }

                    const track = player?.currentTrack && player.currentTrack.url === trackUrl ? player.currentTrack : { title: 'Unknown', artist: 'Unknown', url: trackUrl };

                    // Derive a deterministic cache key from the track URL
                    const trackHash = require('crypto').createHash('md5').update(trackUrl).digest('hex');
                    const outputDir = path.join(STEMS_DIR, trackHash);
                    const doneMarker = path.join(outputDir, '.done');
                    const errorMarker = path.join(outputDir, '.error');

                    // Cache hit — stems already exist
                    if (fs.existsSync(doneMarker)) {
                        const frames = getFormattedPitchMap(outputDir);
                        return res.json({
                            status: 'ready',
                            jobId: trackHash,
                            stems: {
                                vocals: `/karaoke/stems/${trackHash}/vocals.wav`,
                                instrumental: `/karaoke/stems/${trackHash}/no_vocals.wav`
                            },
                            frames: frames,
                            pitchMap: {
                                title: track.title,
                                artist: track.artist,
                                frames: frames
                            }
                        });
                    }

                    // Already processing
                    if (karaokeJobs.has(trackHash) && karaokeJobs.get(trackHash).status === 'processing') {
                        return res.json({ status: 'processing', jobId: trackHash });
                    }

                    // Need an audio file to process — check cache
                    const audioHash = require('crypto').createHash('md5').update(trackUrl).digest('hex');
                    const audioFile = path.join(__dirname, 'audio_cache', `track_${audioHash}.opus`);

                    if (!fs.existsSync(audioFile)) {
                        return res.status(400).json({
                            error: 'Track audio not cached yet. Play the track first so it downloads, then retry.'
                        });
                    }

                    // Start the Python worker
                    karaokeJobs.set(trackHash, { status: 'processing', outputDir });
                    fs.mkdirSync(outputDir, { recursive: true });

                    const pythonScript = path.join(__dirname, 'scripts', 'karaoke_worker.py');

                    console.log(chalk.magenta(`🎤 [KARAOKE] Starting pitch extraction for: ${audioFile}`));

                    const child = execFile('python', [pythonScript, audioFile, outputDir], {
                        timeout: 600000 // 10 minute max
                    }, (error, stdout, stderr) => {
                        if (error) {
                            console.error(chalk.red(`❌ Karaoke worker failed: ${error.message}`));
                            karaokeJobs.set(trackHash, { status: 'error', outputDir, error: error.message });
                        } else {
                            console.log(chalk.green(`✅ [KARAOKE] Pitch map generated successfully! (and stems separated) for ${trackHash}`));
                            karaokeJobs.set(trackHash, { status: 'ready', outputDir });
                        }
                    });

                    // Stream Python stdout & stderr in real-time
                    child.stdout.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        for (const line of lines) {
                            if (line.trim()) {
                                console.log(chalk.gray(`🐍 [KARAOKE WORKER] ${line.trim()}`));
                            }
                        }
                    });

                    child.stderr.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        for (const line of lines) {
                            if (line.trim()) {
                                console.error(chalk.red(`🐍 [KARAOKE WORKER ERR] ${line.trim()}`));
                            }
                        }
                    });

                    // Detach so it doesn't block the event loop
                    child.unref?.();

                    res.json({ status: 'processing', jobId: trackHash });

                } catch (error) {
                    console.error(chalk.red('❌ Karaoke prepare error:'), error.message);
                    res.status(500).json({ error: error.message });
                }
            };

            app.post('/karaoke/prepare', karaokePrepareHandler);
            app.post('/music/karaoke', checkPermission(0), karaokePrepareHandler);

            app.get('/karaoke/status/:jobId', (req, res) => {
                const { jobId } = req.params;
                const job = karaokeJobs.get(jobId);

                if (!job) {
                    // Check if stems exist on disk (from a previous server session)
                    const doneMarker = path.join(STEMS_DIR, jobId, '.done');
                    if (fs.existsSync(doneMarker)) {
                        const frames = getFormattedPitchMap(path.join(STEMS_DIR, jobId));
                        return res.json({
                            status: 'ready',
                            jobId,
                            stems: {
                                vocals: `/karaoke/stems/${jobId}/vocals.wav`,
                                instrumental: `/karaoke/stems/${jobId}/no_vocals.wav`
                            },
                            frames: frames,
                            pitchMap: {
                                frames: frames
                            }
                        });
                    }
                    return res.status(404).json({ error: 'Job not found' });
                }

                if (job.status === 'ready') {
                    const frames = getFormattedPitchMap(job.outputDir);
                    return res.json({
                        status: 'ready',
                        jobId,
                        stems: {
                            vocals: `/karaoke/stems/${jobId}/vocals.wav`,
                            instrumental: `/karaoke/stems/${jobId}/no_vocals.wav`
                        },
                        frames: frames,
                        pitchMap: {
                            frames: frames
                        }
                    });
                }

                if (job.status === 'error') {
                    return res.json({ status: 'error', jobId, error: job.error });
                }

                res.json({ status: 'processing', jobId });
            });

            app.get('/music/karaoke/pitch-data', (req, res) => {
                const player = client.players.first();
                if (!player) return res.json([]);

                const trackId = req.query.trackId;
                let track = player.currentTrack;

                if (trackId) {
                    if (player.currentTrack && (player.currentTrack.id === trackId || player.currentTrack.url === trackId)) {
                        track = player.currentTrack;
                    } else {
                        const queued = player.queue.find(t => t.id === trackId || t.url === trackId);
                        if (queued) {
                            track = queued;
                        } else {
                            const historical = player.previousTracks.find(t => t.id === trackId || t.url === trackId);
                            if (historical) {
                                track = historical;
                            }
                        }
                    }
                }

                if (!track || !track.url) {
                    return res.json([]);
                }

                const trackHash = require('crypto').createHash('md5').update(track.url).digest('hex');
                const outputDir = path.join(STEMS_DIR, trackHash);
                const doneMarker = path.join(outputDir, '.done');

                if (!fs.existsSync(doneMarker)) {
                    if (karaokeJobs.has(trackHash) && karaokeJobs.get(trackHash).status === 'processing') {
                        return res.json({ status: 'processing', jobId: trackHash });
                    }
                    return res.json([]);
                }

                const frames = getFormattedPitchMap(outputDir);
                return res.json(frames);
            });

            // Serve stem files statically
            app.use('/karaoke/stems', require('express').static(STEMS_DIR));

            // ── Queue Shuffle Endpoint ──────────────────────────────────────

            app.post('/queue/shuffle', (req, res) => {
                const player = client.players.first();
                if (!player) return res.status(404).json({ error: 'No active player' });

                if (!player.queue || player.queue.length < 2) {
                    return res.status(400).json({ error: 'Not enough tracks in queue to shuffle' });
                }

                const success = player.shuffleQueue();
                if (success) {
                    console.log(chalk.cyan(`🔀 Queue shuffled (${player.queue.length} tracks)`));
                    res.json({
                        success: true,
                        queue: player.queue.map(t => ({
                            title: t.title,
                            artist: t.artist,
                            duration: t.duration
                        }))
                    });
                } else {
                    res.status(400).json({ error: 'Failed to shuffle queue' });
                }
            });

            // ── Independent Library Manager ─────────────────────────────────

            const YouTube = require('./src/YouTube');
            const Spotify = require('./src/Spotify');

            app.get('/library/search', async (req, res) => {
                const query = req.query.q;
                if (!query || typeof query !== 'string' || query.trim().length === 0) {
                    return res.status(400).json({ error: 'Query parameter "q" is required' });
                }

                try {
                    console.log(chalk.cyan(`🔍 Library search: "${query}"`));

                    // Search YouTube for results with full metadata
                    const ytResults = await YouTube.search(query.trim(), 10);

                    // Enrich thumbnails — ensure highest resolution
                    const results = ytResults.map(track => ({
                        title: track.title || 'Unknown',
                        artist: track.artist || 'Unknown',
                        url: track.url,
                        duration: track.duration || 0,
                        thumbnail: track.id
                            ? `https://img.youtube.com/vi/${track.id}/maxresdefault.jpg`
                            : (track.thumbnail || null),
                        thumbnailFallback: track.thumbnail || null,
                        platform: track.platform || 'youtube',
                        id: track.id || null,
                        views: track.views || null,
                        uploadDate: track.uploadDate || null
                    }));

                    res.json({ results, count: results.length });

                } catch (error) {
                    console.error(chalk.red('❌ Library search error:'), error.message);
                    res.status(500).json({ error: 'Search failed: ' + error.message });
                }
            });

            app.get('/library/playlists', (req, res) => {
                const presets = readPresets();
                const playlists = Object.entries(presets).map(([name, data]) => ({
                    name,
                    trackCount: data.tracks?.length || 0,
                    savedAt: data.savedAt || null
                }));
                res.json(playlists);
            });

            app.post('/library/playlists/:name', checkPermission(0), (req, res) => {
                const { name } = req.params;
                const track = req.body;

                if (!name || typeof name !== 'string') {
                    return res.status(400).json({ error: 'Playlist name is required' });
                }

                if (!track || !track.title) {
                    return res.status(400).json({ error: 'Track object with at least a title is required in the request body' });
                }

                // Sanitize the track object — only keep what we need
                const sanitizedTrack = {
                    title: track.title,
                    artist: track.artist || 'Unknown',
                    url: track.url || null,
                    duration: track.duration || 0,
                    thumbnail: track.thumbnail || null,
                    platform: track.platform || 'youtube'
                };

                const presets = readPresets();

                if (!presets[name]) {
                    // Create new playlist
                    presets[name] = {
                        tracks: [sanitizedTrack],
                        savedAt: new Date().toISOString()
                    };
                } else {
                    // Append to existing playlist
                    if (!Array.isArray(presets[name].tracks)) {
                        presets[name].tracks = [];
                    }

                    // Deduplicate by URL if available
                    const isDuplicate = sanitizedTrack.url && presets[name].tracks.some(
                        t => t.url === sanitizedTrack.url
                    );

                    if (isDuplicate) {
                        return res.status(409).json({ error: 'Track already exists in this playlist' });
                    }

                    presets[name].tracks.push(sanitizedTrack);
                    presets[name].savedAt = new Date().toISOString();
                }

                const success = writePresets(presets);

                if (success) {
                    console.log(chalk.green(`📚 Library: Added "${sanitizedTrack.title}" to playlist "${name}" by ${req.user.username}`));
                    res.json({
                        success: true,
                        playlist: name,
                        trackCount: presets[name].tracks.length
                    });
                } else {
                    res.status(500).json({ error: 'Failed to save playlist' });
                }
            });

            app.delete('/library/playlists/:name', checkPermission(2), (req, res) => {
                const { name } = req.params;

                const presets = readPresets();
                if (!presets[name]) {
                    return res.status(404).json({ error: `Playlist "${name}" not found` });
                }

                delete presets[name];
                const success = writePresets(presets);

                if (success) {
                    console.log(chalk.yellow(`🗑️ Library: Deleted playlist "${name}" by ${req.user.username}`));
                    res.json({ success: true, deleted: name });
                } else {
                    res.status(500).json({ error: 'Failed to delete playlist' });
                }
            });

            app.listen(3001, () => {
                console.log(chalk.blue('🌐 API Bridge running on port 3001'));
            });

            // Login to Discord
            await client.login(config.discord.token);

        } catch (error) {
            console.error(chalk.red('❌ Failed to start bot:'), error);
            process.exit(1);
        }
    };

    // Start the bot
    init();

    module.exports = client;
}, 5000);

// Global error handlers to prevent process crashes from unhandled errors (like EAI_AGAIN DNS errors)
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception thrown:', err);
});