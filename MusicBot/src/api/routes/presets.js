const express = require('express');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const router = express.Router();
const PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'presets.json');
const PLAYLISTS_DB_PATH = path.join(__dirname, '..', '..', '..', 'database', 'playlists.json');

function readPlaylists() {
    try {
        if (fs.existsSync(PLAYLISTS_DB_PATH)) {
            const raw = fs.readFileSync(PLAYLISTS_DB_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error(chalk.red('❌ Failed to read playlists.json:'), e.message);
    }
    return [];
}

function writePlaylists(data) {
    try {
        const content = JSON.stringify(data, null, 2);
        fs.writeFileSync(PLAYLISTS_DB_PATH, content, 'utf-8');
        return true;
    } catch (e) {
        console.error(chalk.red('❌ Failed to write playlists.json:'), e.message);
    }
    return false;
}

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
    }
    return false;
}

module.exports = (client, requirePermission) => {
    router.post('/presets/save', requirePermission('playlist', 'write'), (req, res) => {
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

    router.get('/presets', (req, res) => {
        const presets = readPresets();
        const result = Object.entries(presets).map(([name, data]) => ({
            name,
            trackCount: data.tracks?.length || 0,
            savedAt: data.savedAt || null,
            tracks: data.tracks || []
        }));
        res.json(result);
    });

    router.post('/presets/load', requirePermission('playlist', 'write'), async (req, res) => {
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
            const MusicPlayerClass = require('../../MusicPlayer');
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
                const YouTube = require('../../YouTube');
                const SoundCloud = require('../../SoundCloud');
                const DirectLink = require('../../DirectLink');
                let tracks = [];

                if (platform === 'youtube') {
                    tracks = await YouTube.search(query, 5, player.guild.id);
                } else if (platform === 'soundcloud') {
                    tracks = await SoundCloud.search(query, 1, player.guild.id);
                } else if (platform === 'direct') {
                    tracks = await DirectLink.getInfo(query);
                } else {
                    tracks = await YouTube.search(query, 5, player.guild.id);
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

        for (const t of resolvedTracks) {
            if (player.currentTrack) {
                player.queue.push(t);
            } else {
                player.currentTrack = t;
            }
            player.preloadTrack(t).catch(err => console.error("Preload error:", err));
        }

        if (wasIdle && player.currentTrack) {
            await player.play(null, 0);
        }

        console.log(chalk.green(`📂 Preset loaded: "${name}" (${loadedCount}/${preset.tracks.length} tracks)`));
        res.json({ success: true, name, loaded: loadedCount, total: preset.tracks.length });
    });

    router.get('/library/playlists', (req, res) => {
        const presets = readPresets();
        const playlists = Object.entries(presets).map(([name, data]) => ({
            name,
            trackCount: data.tracks?.length || 0,
            savedAt: data.savedAt || null
        }));
        res.json(playlists);
    });

    router.post('/library/playlists/:name', requirePermission('playlist', 'write'), (req, res) => {
        const { name } = req.params;
        const track = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Playlist name is required' });
        }

        if (!track || !track.title) {
            return res.status(400).json({ error: 'Track object with at least a title is required in the request body' });
        }

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
            presets[name] = {
                tracks: [sanitizedTrack],
                savedAt: new Date().toISOString()
            };
        } else {
            if (!Array.isArray(presets[name].tracks)) {
                presets[name].tracks = [];
            }

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

    router.post('/playlist/search', requirePermission('playlist', 'read'), async (req, res) => {
        const { query } = req.body;
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({ error: 'Query parameter "query" is required' });
        }

        try {
            console.log(chalk.cyan(`🔍 Playlist Builder Search: "${query}"`));

            const MusicBrainzClient = require('../../musicbrainz/MusicBrainzClient');
            const CoverArtResolver = require('../../musicbrainz/CoverArtResolver');
            const YouTube = require('../../YouTube');

            const parseQuery = (q) => {
                const trimmed = q.trim();
                const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
                if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
                const dashParts = trimmed.split(/\s+-\s+/);
                if (dashParts.length >= 2) return { title: dashParts[1].trim(), artist: dashParts[0].trim() };
                return { title: trimmed, artist: '' };
            };

            const { title, artist } = parseQuery(query);
            console.log(`[MusicBrainz Debug] Dissected Query -> Title: "${title}", Artist: "${artist}"`);

            const mbResults = await MusicBrainzClient.searchRecordingsByTitle(title, 15);
            
            let results = [];
            
            if (mbResults.length > 0) {
                const coverArtPromises = mbResults.map(async (mbRecord) => {
                    const premiumArt = await CoverArtResolver.resolveCoverArt(mbRecord.releaseMbid, mbRecord.releaseGroupMbid);
                    return { ...mbRecord, albumCover: premiumArt };
                });
                const mbRecordsWithArt = await Promise.all(coverArtPromises);

                const youtubePromises = mbRecordsWithArt.map(async (mbRecord) => {
                    const matchedTrack = await YouTube.resolveMetadataTrack(
                        mbRecord.title,
                        [mbRecord.artist],
                        mbRecord.durationMs || 0,
                        mbRecord.albumCover,
                        null
                    );
                    return { mbRecord, matchedTrack };
                });
                const youtubeResults = await Promise.all(youtubePromises);

                results = youtubeResults
                    .filter(({ matchedTrack }) => matchedTrack && matchedTrack.url)
                    .map(({ mbRecord, matchedTrack }) => ({
                        title: mbRecord.title,
                        artist: mbRecord.artist,
                        allArtists: mbRecord.allArtists,
                        url: matchedTrack.url,
                        duration: Math.floor((mbRecord.durationMs || 0) / 1000),
                        durationMs: mbRecord.durationMs,
                        thumbnail: mbRecord.albumCover || matchedTrack.thumbnail,
                        thumbnailFallback: matchedTrack.thumbnail || null,
                        albumCover: mbRecord.albumCover,
                        platform: 'youtube',
                        id: matchedTrack.id || null,
                        mbid: mbRecord.mbid,
                        releaseGroupMbid: mbRecord.releaseGroupMbid,
                        popularityCount: mbRecord.popularityCount,
                        views: null,
                        uploadDate: null
                    }));
            }

            if (results.length === 0) {
                const ytResults = await YouTube.search(query.trim(), 10);
                results = ytResults.map(track => ({
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
            }

            res.json({ results, count: results.length });

        } catch (error) {
            console.error(chalk.red('❌ Playlist Builder Search error:'), error.message);
            res.status(500).json({ error: 'Search failed: ' + error.message });
        }
    });

    router.post('/playlist/create', requirePermission('playlist', 'create'), (req, res) => {
        const { name, isPublic = true, description = '' } = req.body;
        const ownerId = req.user?.id || req.headers['x-user-id'] || 'unknown';

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Playlist name is required' });
        }

        const playlists = readPlaylists();
        
        const existing = playlists.find(p => p.name === name && p.ownerId === ownerId);
        if (existing) {
            return res.status(409).json({ error: 'You already have a playlist with this name' });
        }

        const playlist = {
            id: Math.random().toString(36).substr(2, 9),
            name: name.trim(),
            ownerId,
            isPublic: Boolean(isPublic),
            description: description.trim(),
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        playlists.push(playlist);
        const success = writePlaylists(playlists);

        if (success) {
            console.log(chalk.green(`📚 Playlist created: "${name}" by ${req.user.username} (public: ${isPublic})`));
            res.json({ success: true, playlist });
        } else {
            res.status(500).json({ error: 'Failed to create playlist' });
        }
    });

    router.post('/playlist/add', requirePermission('playlist', 'write'), (req, res) => {
        const { playlistId, track } = req.body;
        const userId = req.user?.id || req.headers['x-user-id'];

        if (!playlistId || typeof playlistId !== 'string') {
            return res.status(400).json({ error: 'Playlist ID is required' });
        }

        if (!track || !track.title) {
            return res.status(400).json({ error: 'Track object with at least a title is required' });
        }

        const sanitizedTrack = {
            id: track.id || track.url || Math.random().toString(36).substr(2, 9),
            title: track.title,
            song: track.title,
            artist: track.artist || 'Unknown',
            url: track.url || null,
            duration: track.duration || 0,
            thumbnail: track.thumbnail || null,
            cover: track.thumbnail || null,
            platform: track.platform || 'youtube',
            addedBy: userId,
            addedAt: new Date().toISOString()
        };

        const playlists = readPlaylists();
        let playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) {
            return res.status(404).json({ error: `Playlist "${playlistId}" not found` });
        }

        const isOwner = playlist.ownerId === userId;
        if (!isOwner && !playlist.isPublic) {
            return res.status(403).json({ error: 'This playlist is private. Only the owner can add tracks.' });
        }

        if (!Array.isArray(playlist.tracks)) {
            playlist.tracks = [];
        }

        const isDuplicate = sanitizedTrack.url && playlist.tracks.some(
            t => t.url === sanitizedTrack.url
        );

        if (isDuplicate) {
            return res.status(409).json({ error: 'Track already exists in this playlist' });
        }

        playlist.tracks.push(sanitizedTrack);
        playlist.updatedAt = new Date().toISOString();

        const success = writePlaylists(playlists);

        if (success) {
            console.log(chalk.green(`📚 Playlist: Added "${sanitizedTrack.title}" to "${playlist.name}" by ${req.user.username}`));
            res.json({
                success: true,
                playlist: playlist.name,
                trackCount: playlist.tracks.length
            });
        } else {
            res.status(500).json({ error: 'Failed to save playlist' });
        }
    });

    router.get('/playlist/:id', (req, res) => {
        const { id } = req.params;
        const playlists = readPlaylists();
        const playlist = playlists.find(p => p.id === id);

        if (!playlist) {
            return res.status(404).json({ error: `Playlist "${id}" not found` });
        }

        if (playlist.isPublic === false || playlist.isPublic === undefined) {
            const userId = req.user?.id || req.headers['x-user-id'];
            const userRole = req.user?.role || 0;
            const isOwner = playlist.ownerId === userId;
            const isStaff = userRole >= 2;

            if (!isOwner && !isStaff) {
                return res.status(403).json({ error: 'This playlist is private' });
            }
        }

        res.json(playlist);
    });

    router.get('/playlists', (req, res) => {
        const playlists = readPlaylists();
        const result = playlists.map(p => ({
            id: p.id,
            name: p.name,
            trackCount: p.tracks?.length || 0,
            savedAt: p.savedAt || null
        }));
        res.json(result);
    });

    router.delete('/playlist/:id', requirePermission('playlist', 'delete'), (req, res) => {
        const { id } = req.params;
        const userId = req.user?.id || req.headers['x-user-id'];
        const userRole = req.user?.role || 0;

        let playlists = readPlaylists();
        const index = playlists.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: `Playlist "${id}" not found` });
        }

        const playlist = playlists[index];
        const isOwner = playlist.ownerId === userId;
        const isStaff = userRole >= 2;

        if (!isOwner && !isStaff) {
            return res.status(403).json({ error: 'Only the playlist owner or staff can delete this playlist' });
        }

        const deleted = playlists.splice(index, 1)[0];
        const success = writePlaylists(playlists);

        if (success) {
            console.log(chalk.yellow(`🗑️ Playlist: Deleted "${deleted.name}" by ${req.user.username} (owner: ${isOwner})`));
            res.json({ success: true, deleted: id });
        } else {
            res.status(500).json({ error: 'Failed to delete playlist' });
        }
    });

    router.get('/playlists/my', requirePermission('playlist', 'read'), (req, res) => {
        const userId = req.user?.id || req.headers['x-user-id'];
        const playlists = readPlaylists();
        const userPlaylists = playlists
            .filter(p => p.ownerId === userId)
            .map(p => ({
                id: p.id,
                name: p.name,
                trackCount: p.tracks?.length || 0,
                isPublic: p.isPublic,
                description: p.description,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
            }));
        res.json(userPlaylists);
    });

    router.get('/playlists/public', (req, res) => {
        const playlists = readPlaylists();
        const publicPlaylists = playlists
            .filter(p => p.isPublic)
            .map(p => ({
                id: p.id,
                name: p.name,
                trackCount: p.tracks?.length || 0,
                description: p.description,
                ownerId: p.ownerId,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
            }));
        res.json(publicPlaylists);
    });

    router.delete('/library/playlists/:name', requirePermission('playlist', 'delete'), (req, res) => {
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

    return router;
};