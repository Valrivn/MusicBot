const express = require('express');
const chalk = require('chalk');
const MusicPlayer = require('../../MusicPlayer');
const YouTube = require('../../YouTube');
const { optionalAuth } = require('../../auth/middleware');
const { apiLimiter } = require('../../auth/rate-limit');

const router = express.Router();

const extractYtVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

const isYouTubeUrl = (url) => {
    return url && (url.includes('youtube.com') || url.includes('youtu.be'));
};

module.exports = (client, requirePermission) => {
    router.get('/music/player', optionalAuth, (req, res) => {
        const player = client.players.first();
        if (!player) return res.json(null);

        const track = player.currentTrack;

        const streamTimeMs = player.resource ? player.resource.playbackDuration : 0;
        const currentPosMs = (player.currentTrackStartOffsetMs || 0) + streamTimeMs;
        
        const bufferAdjustedStartTime = Date.now() - currentPosMs;
        const lastPausedAt = player.paused ? Date.now() : null;

        const ytVideoId = extractYtVideoId(track?.url);
        const resolvedArt = track?.albumCover || track?.thumbnail ||
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

    router.get('/music/queue', optionalAuth, (req, res) => {
        const player = client.players.first();
        if (!player || !player.queue) return res.json([]);

        res.json(player.queue.map(track => {
            const ytId = extractYtVideoId(track.url);
            const art = track.albumCover || track.thumbnail ||
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

    router.post('/music/playback', requirePermission('queue', 'write'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });

        const { action } = req.body;
        const allowedActions = ['play_pause', 'next', 'previous', 'stop', 'pause', 'resume'];
        if (!action || !allowedActions.includes(action)) {
            return res.status(400).json({ error: `Invalid action. Allowed: ${allowedActions.join(', ')}` });
        }
        if (action === 'play_pause') {
            if (player.paused) player.resumeFor('api');
            else player.pauseFor('api');
        } else if (action === 'next') {
            if (typeof player.skip === 'function') player.skip();
        } else if (action === 'previous') {
            if (typeof player.previous === 'function') player.previous();
        } else if (action === 'stop') {
            if (typeof player.stop === 'function') player.stop();
        } else if (action === 'pause') {
            if (!player.paused) player.pauseFor('api');
        } else if (action === 'resume') {
            if (player.paused) player.resumeFor('api');
        }
        res.json({ success: true });
    });

    router.post('/music/skip', requirePermission('queue', 'write'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });
        if (typeof player.skip === 'function') player.skip();
        res.json({ success: true });
    });

    router.post('/music/previous', requirePermission('queue', 'write'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });
        if (typeof player.previous === 'function') player.previous();
        res.json({ success: true });
    });

    router.post('/music/stop', requirePermission('queue', 'write'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });
        if (typeof player.stop === 'function') player.stop();
        res.json({ success: true });
    });

    router.post('/music/queue/clear', requirePermission('queue', 'write'), (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });
        if (Array.isArray(player.queue)) {
            player.queue.length = 0;
        }
        player.currentTrack = null;
        if (typeof player.stop === 'function') player.stop();
        res.json({ ok: true });
    });

    router.post('/music/volume', requirePermission('queue', 'write'), (req, res) => {
        const { volume } = req.body;
        if (typeof volume !== 'number' || volume < 0 || volume > 100) {
            return res.status(400).json({ error: 'Invalid volume (must be 0-100)' });
        }

        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });

        if (typeof player.setVolume === 'function') player.setVolume(volume);
        res.json({ success: true, volume });
    });

    router.post('/music/seek', requirePermission('queue', 'write'), (req, res) => {
        const { positionMs } = req.body;
        if (typeof positionMs !== 'number' || positionMs < 0) {
            return res.status(400).json({ error: 'Invalid positionMs (must be non-negative number)' });
        }

        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });

        if (typeof player.seek === 'function') {
            try {
                player.seek(positionMs);
                res.json({ success: true, positionMs });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        } else {
            res.status(500).json({ error: 'Seek not supported by player' });
        }
    });

    router.get('/music/history', optionalAuth, (req, res) => {
        const player = client.players.first();
        if (!player || !player.previousTracks) return res.json([]);

        res.json(player.previousTracks.map(track => {
            const ytId = extractYtVideoId(track.url);
            const art = track.albumCover || track.thumbnail ||
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

    const requestHandler = async (req, res) => {
        const { query, guildId } = req.body;
        if (!query || !query.trim()) return res.status(400).json({ error: 'Query is required' });

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
            player = new MusicPlayer(guild, textChannel, voiceChannel);
            client.players.set(guild.id, player);
        }

        try {
            const requesterTag = req.user?.username || req.headers['x-user-username'] || 'Dashboard User';
            const requesterId = req.user?.id || req.headers['x-user-id'] || '1';

            await player.addTrack(query, { tag: requesterTag, id: requesterId });

            res.json({ success: true, ok: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    };

    router.post('/music/search', apiLimiter, requirePermission('queue', 'write'), requestHandler);

    router.post('/music/request', apiLimiter, requirePermission('queue', 'write'), async (req, res) => {
        const { query, guildId } = req.body;
        
        if (!query || !query.trim()) {
            return res.status(400).json({ error: 'Query is required' });
        }
        
        const musicManager = {
            getPlayer: (gId) => {
                const target = gId === 'owner' ? (client.guilds.cache.first()?.id) : gId;
                return client.players.get(target) || null;
            },
            createPlayer: async (gId) => {
                const target = gId === 'owner' ? (client.guilds.cache.first()?.id) : gId;
                let guild = client.guilds.cache.get(target);
                if (!guild) {
                    guild = client.guilds.cache.first();
                }
                if (!guild) throw new Error('No guild available for player context');
                
                let voiceChannel = null;
                const targetUserId = req.user?.id || req.headers['x-user-id'];
                if (guild && targetUserId) {
                    const member = guild.members.cache.get(targetUserId);
                    if (member && member.voice.channel) {
                        voiceChannel = member.voice.channel;
                    }
                }
                
                if (!voiceChannel) {
                    voiceChannel = guild.channels.cache.find(c => c.type === 2 || c.type === 'GUILD_VOICE');
                }
                
                if (!voiceChannel) {
                    throw new Error('No voice channel available for player context');
                }
                
                const textChannel = guild.channels.cache.find(c => c.isTextBased()) || null;
                const newPlayer = new MusicPlayer(guild, textChannel, voiceChannel);
                client.players.set(guild.id, newPlayer);
                return newPlayer;
            }
        };

        let trackData = null;

        try {
            const requesterTag = req.user?.username || req.headers['x-user-username'] || 'Dashboard User';
            const requesterId = req.user?.id || req.headers['x-user-id'] || '1';

            if (isYouTubeUrl(query)) {
                console.log(`🎵 [DIRECT YT] YouTube URL detected, playing directly: ${query}`);
                let player = musicManager.getPlayer(guildId);
                if (!player) {
                    player = await musicManager.createPlayer(guildId);
                }
                await player.addTrack(query, { tag: requesterTag, id: requesterId });
                return res.status(200).json({ status: "success", track: { url: query, platform: 'youtube' } });
            }

            const MusicBrainzClient = require('../../musicbrainz/MusicBrainzClient');
            const CoverArtResolver = require('../../musicbrainz/CoverArtResolver');

            const parseQuery = (q) => {
                const trimmed = q.trim();
                const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
                if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
                const dashParts = trimmed.split(/\s+-\s+/);
                if (dashParts.length >= 2) return { title: dashParts[1].trim(), artist: dashParts[0].trim() };
                return { title: trimmed, artist: '' };
            };

            const { title, artist } = parseQuery(query);
            console.log(`🔍 [FUZZY LOOKUP] Plain text query detected. Scanning MusicBrainz catalog for: "${title}" - "${artist}"`);
            const mbRecord = await MusicBrainzClient.searchRecording(title, artist);

            let player = musicManager.getPlayer(guildId);
            if (!player) {
                player = await musicManager.createPlayer(guildId);
            }

            if (mbRecord) {
                const premiumArt = await CoverArtResolver.resolveCoverArt(mbRecord.releaseMbid, mbRecord.releaseGroupMbid);
                const bestAudioMatch = await YouTube.resolveMetadataTrack(
                    mbRecord.title,
                    [mbRecord.artist],
                    mbRecord.durationMs || 0,
                    premiumArt,
                    guildId
                );

                if (bestAudioMatch) {
                    await player.addTrack(bestAudioMatch, { tag: requesterTag, id: requesterId });
                    return res.status(200).json({ status: "success", track: bestAudioMatch });
                }
            }

            await player.addTrack({ title: query, url: query, platform: 'youtube' }, { tag: requesterTag, id: requesterId });
            return res.status(200).json({ status: "fallback_youtube" });

        } catch (err) {
            console.error("❌ Request processing failure:", err);
            return res.status(500).json({ error: "Internal processing error" });
        }
    });

    router.post('/queue/reorder', requirePermission('queue', 'write'), (req, res) => {
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

    router.delete('/queue/:index', optionalAuth, (req, res) => {
        const player = client.players.first();
        if (!player) return res.status(404).json({ error: 'No active player' });

        const index = parseInt(req.params.index, 10);
        if (isNaN(index) || index < 0 || index >= player.queue.length) {
            return res.status(400).json({ error: 'Invalid index' });
        }

        const track = player.queue[index];
        const userRole = req.user?.role || 0;
        if (userRole < 2 && track.requestedBy?.id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden: You can only remove songs you added.' });
        }

        const updatedQueue = player.removeQueueItem(index);
        if (updatedQueue) {
            console.log(chalk.cyan(`🗑️ Removed from queue at index ${index} by ${req.user.username}`));
            return res.status(200).json({ 
                message: "Item removed safely", 
                queue: updatedQueue.map(t => {
                    const ytId = extractYtVideoId(t.url);
                    const art = t.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
                    return {
                        id: t.id || t.url || Math.random().toString(36).substr(2, 9),
                        title: t.title || 'Unknown',
                        artist: t.artist || 'Unknown',
                        url: t.url || null,
                        trackUrl: t.url || null,
                        thumbnail: art,
                        art: art,
                        artworkUrl: art,
                        duration: t.duration || 0,
                        length: t.duration || 0,
                        requestedBy: t.requestedBy?.tag || t.requestedBy?.username || t.requesterTag || 'Unknown',
                        requesterName: t.requestedBy?.tag || t.requestedBy?.username || t.requesterTag || 'Unknown',
                        requesterAvatar: t.requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${t.requestedBy.id}/${t.requestedBy.avatar}.png` : null
                    };
                })
            });
        } else {
            res.status(400).json({ error: 'Failed to remove track' });
        }
    });

    router.post('/player/previous', requirePermission('queue', 'write'), (req, res) => {
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

    router.post('/queue/shuffle', requirePermission('queue', 'write'), (req, res) => {
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

    router.get('/library/search', optionalAuth, async (req, res) => {
        const query = req.query.q;
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        try {
            console.log(chalk.cyan(`🔍 Library search: "${query}"`));

            const ytResults = await YouTube.search(query.trim(), 10);

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

    // GET /api/queue/:guildId/events - Get event history for debugging
    router.get('/api/queue/:guildId/events', async (req, res) => {
        const { guildId } = req.params;
        const { fromSequence } = req.query;
        
        if (!guildId) {
            return res.status(400).json({ error: 'guildId is required' });
        }

        try {
            const QueueEventStore = require('../../services/queue-event-store');
            const events = await QueueEventStore.getEvents(guildId, parseInt(fromSequence) || 0);
            res.json({ events, count: events.length });
        } catch (error) {
            console.error('❌ Failed to get queue events:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/queue/:guildId/undo - Revert last N events (bonus)
    router.post('/api/queue/:guildId/undo', async (req, res) => {
        const { guildId } = req.params;
        const { count = 1 } = req.body;
        
        if (!guildId) {
            return res.status(400).json({ error: 'guildId is required' });
        }

        try {
            const QueueEventStore = require('../../services/queue-event-store');
            const result = await QueueEventStore.undoEvents(guildId, parseInt(count) || 1);
            
            if (result.success) {
                // Update the player's state if it exists
                const player = client.players.get(guildId);
                if (player) {
                    player._applyRestoredState(result.newState);
                }
                
                res.json({ success: true, undoneEvents: result.undoneEvents, newState: result.newState });
            } else {
                res.status(400).json({ success: false, error: result.error });
            }
        } catch (error) {
            console.error('❌ Failed to undo queue events:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};