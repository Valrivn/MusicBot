import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getUserRole } from '../auth/middleware';

export interface TrpcContext {
  client: any;
  user?: {
    id: string;
    username: string;
    role: number;
  };
  guildId?: string;
}

export function createContext({
  req,
  client,
}: {
  req: any;
  client: any;
}): TrpcContext {
  const authHeader = req.headers.authorization;
  let user: TrpcContext['user'] = undefined;
  let guildId = req.headers['x-guild-id'] as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const sessionStore = req.app.get('sessionStore');
    if (sessionStore) {
      const sessionUser = sessionStore.get(token);
      if (sessionUser) {
        user = {
          id: sessionUser.id,
          username: sessionUser.username,
          role: getUserRole(sessionUser.id),
        };
      }
    }
  }

  if (!user) {
    user = {
      id: req.headers['x-user-id'] as string || 'guest',
      username: req.headers['x-user-username'] as string || 'Guest',
      role: 0,
    };
  }

  return {
    client,
    user,
    guildId,
  };
}

const t = initTRPC.context<TrpcContext>().create();

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role === 0) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({ ctx });
});

export const staffProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 2) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Staff permissions required',
    });
  }
  return next({ ctx });
});

export const ownerProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 3) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Owner permissions required',
    });
  }
  return next({ ctx });
});

export const router = t.router;
export const middleware = t.middleware;

export const appRouter = router({
  playlist: router({
    create: protectedProcedure
      .input(z.object({ name: z.string(), isPublic: z.boolean().optional(), description: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        // Implementation would use database
        return { id: 'new-id', name: input.name, isPublic: input.isPublic ?? true, description: input.description ?? '', ownerId: ctx.user!.id, trackCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }),

    getById: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        // Implementation would use database
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Playlist not found' });
      }),

    getAll: publicProcedure
      .query(async ({ ctx }) => {
        // Implementation would use database
        return [];
      }),

    getMyPlaylists: protectedProcedure
      .query(async ({ ctx }) => {
        return [];
      }),

    getPublicPlaylists: publicProcedure
      .query(async ({ ctx }) => {
        return [];
      }),

    addTrack: protectedProcedure
      .input(z.object({ playlistId: z.string(), track: z.any() }))
      .mutation(async ({ input, ctx }) => {
        return { success: true };
      }),

    search: protectedProcedure
      .input(z.object({ query: z.string() }))
      .mutation(async ({ input }) => {
        return { results: [], count: 0 };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return { success: true };
      }),
  }),

  queue: router({
    get: publicProcedure
      .query(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player) return [];
        return player.queue.map((track: any) => ({
          id: track.id || track.url,
          title: track.title,
          artist: track.artist,
          url: track.url,
          duration: track.duration,
          thumbnail: track.thumbnail,
          requestedBy: track.requestedBy?.tag || track.requestedBy?.username || 'Unknown',
        }));
      }),

    getHistory: publicProcedure
      .query(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player) return [];
        return player.previousTracks.map((track: any) => ({
          id: track.id || track.url,
          title: track.title,
          artist: track.artist,
          url: track.url,
          duration: track.duration,
          thumbnail: track.thumbnail,
          requestedBy: track.requestedBy?.tag || track.requestedBy?.username || 'Unknown',
        }));
      }),

    reorder: protectedProcedure
      .input(z.object({ oldIndex: z.number(), newIndex: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        const success = player.moveInQueue(input.oldIndex, input.newIndex);
        return { success };
      }),

    remove: protectedProcedure
      .input(z.object({ index: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        const updatedQueue = player.removeQueueItem(input.index);
        return { success: !!updatedQueue, queue: updatedQueue };
      }),

    shuffle: protectedProcedure
      .mutation(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        const success = player.shuffleQueue();
        return { success };
      }),

    clear: protectedProcedure
      .mutation(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        player.queue = [];
        return { success: true };
      }),
  }),

  player: router({
    get: publicProcedure
      .query(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player || !player.currentTrack) return null;

        const track = player.currentTrack;
        const streamTimeMs = player.resource?.playbackDuration || 0;
        const currentPosMs = (player.currentTrackStartOffsetMs || 0) + streamTimeMs;

        return {
          id: track.id || track.url,
          title: track.title,
          artist: track.artist,
          url: track.url,
          durationSec: track.duration || 0,
          positionSec: Math.floor(currentPosMs / 1000),
          currentPositionMs: currentPosMs,
          currentPositionSec: currentPosMs / 1000,
          serverTimestampMs: Date.now(),
          startTime: Date.now() - currentPosMs,
          lastPausedAt: player.paused ? Date.now() : null,
          isPaused: player.paused,
          playing: !player.paused,
          art: track.albumCover || track.thumbnail,
          thumbnail: track.albumCover || track.thumbnail,
          requesterName: track.requestedBy?.tag || track.requestedBy?.username,
          requesterAvatar: track.requestedBy?.avatar,
          volume: player.volume || 100,
        };
      }),

    playback: protectedProcedure
      .input(z.object({ action: z.enum(['play_pause', 'next', 'previous', 'stop', 'pause', 'resume']) }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });

        switch (input.action) {
          case 'play_pause':
            if (player.paused) player.resumeFor('api');
            else player.pauseFor('api');
            break;
          case 'next':
            player.skip();
            break;
          case 'previous':
            player.previous();
            break;
          case 'stop':
            player.stop();
            break;
          case 'pause':
            if (!player.paused) player.pauseFor('api');
            break;
          case 'resume':
            if (player.paused) player.resumeFor('api');
            break;
        }
        return { success: true };
      }),

    previous: protectedProcedure
      .mutation(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        const success = player.previous();
        return { success };
      }),

    setVolume: protectedProcedure
      .input(z.object({ volume: z.number().min(0).max(100) }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.setVolume === 'function') player.setVolume(input.volume);
        return { success: true, volume: input.volume };
      }),

    seek: protectedProcedure
      .input(z.object({ positionMs: z.number().min(0) }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.seek === 'function') {
          player.seek(input.positionMs);
          return { success: true, positionMs: input.positionMs };
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Seek not supported' });
      }),
  }),

  music: router({
    search: protectedProcedure
      .input(z.object({ query: z.string(), guildId: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        await player.addTrack(input.query, { tag: ctx.user!.username, id: ctx.user!.id });
        return { ok: true, queued: 1 };
      }),

    request: protectedProcedure
      .input(z.object({ query: z.string(), guildId: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        await player.addTrack(input.query, { tag: ctx.user!.username, id: ctx.user!.id });
        return { ok: true, queued: 1 };
      }),

    searchCatalog: protectedProcedure
      .input(z.object({ query: z.string() }))
      .mutation(async ({ input }) => {
        const YouTube = (await import('../../YouTube')).default;
        const results = await YouTube.search(input.query, 10);
        return { results, count: results.length };
      }),

    getLyrics: protectedProcedure
      .input(z.object({ title: z.string(), artist: z.string(), trackUrl: z.string().optional() }))
      .mutation(async ({ input }) => {
        const LyricsManager = (await import('../../LyricsManager')).default;
        const payload = await LyricsManager.fetchLyrics({
          title: input.title,
          artist: input.artist,
          url: input.trackUrl,
          duration: 0,
        });
        if (!payload) throw new TRPCError({ code: 'NOT_FOUND', message: 'No lyrics found' });
        return payload;
      }),
  }),

  karaoke: router({
    prepare: protectedProcedure
      .input(z.object({ trackUrl: z.string().optional(), guildId: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        const trackUrl = input.trackUrl || player?.currentTrack?.url;
        if (!trackUrl) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No track URL provided' });

        const crypto = await import('crypto');
        const trackHash = crypto.createHash('md5').update(trackUrl).digest('hex');
        const STEMS_DIR = '/app/audio_cache/stems';
        const outputDir = `${STEMS_DIR}/${trackHash}`;
        const doneMarker = `${outputDir}/.done`;

        const fs = await import('fs');
        if (fs.existsSync(doneMarker)) {
          return { status: 'ready', jobId: trackHash, stems: { vocals: `/karaoke/stems/${trackHash}/vocals.wav`, instrumental: `/karaoke/stems/${trackHash}/no_vocals.wav` } };
        }

        return { status: 'processing', jobId: trackHash };
      }),

    getStatus: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const crypto = await import('crypto');
        const fs = await import('fs');
        const path = await import('path');
        const STEMS_DIR = '/app/audio_cache/stems';
        const outputDir = path.join(STEMS_DIR, input.jobId);
        const doneMarker = path.join(outputDir, '.done');

        if (fs.existsSync(doneMarker)) {
          return { status: 'ready', jobId: input.jobId, stems: { vocals: `/karaoke/stems/${input.jobId}/vocals.wav`, instrumental: `/karaoke/stems/${input.jobId}/no_vocals.wav` } };
        }

        return { status: 'processing', jobId: input.jobId };
      }),

    getPitchData: publicProcedure
      .input(z.object({ trackId: z.string().optional() }))
      .output(z.array(z.object({ timeMs: z.number(), midi: z.number() })))
      .query(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        const track = player?.currentTrack;
        if (!track || !track.url) return [];

        const crypto = await import('crypto');
        const trackHash = crypto.createHash('md5').update(track.url).digest('hex');
        const fs = await import('fs');
        const path = await import('path');
        const STEMS_DIR = '/app/audio_cache/stems';
        const outputDir = path.join(STEMS_DIR, trackHash);
        const doneMarker = path.join(outputDir, '.done');

        if (!fs.existsSync(doneMarker)) return [];

        const quantizedPath = path.join(outputDir, 'pitch_quantized.json');
        let quantizedBlocks: any[] = [];
        try {
          quantizedBlocks = JSON.parse(fs.readFileSync(quantizedPath, 'utf-8'));
        } catch (_) {
          return [];
        }

        const frames = [];
        for (const block of quantizedBlocks) {
          const startMs = Math.round(block.start * 1000);
          const durationMs = Math.round(block.duration * 1000);
          const endMs = startMs + durationMs;
          for (let t = startMs; t < endMs; t += 100) {
            frames.push({ timeMs: t, midi: block.note });
          }
        }

        // Runtime validation
        const { PitchFrameSchema } = await import('@voxaria/contracts');
        return frames.map(frame => PitchFrameSchema.parse(frame));
      }),
  }),

  presets: router({
    getAll: publicProcedure
      .query(async () => {
        const fs = await import('fs');
        const path = await import('path');
        const PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'presets.json');
        if (!fs.existsSync(PRESETS_PATH)) return [];
        const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
        return Object.entries(presets).map(([name, data]: [string, any]) => ({
          name,
          trackCount: data.tracks?.length || 0,
          savedAt: data.savedAt || null,
          tracks: data.tracks || [],
        }));
      }),

    save: protectedProcedure
      .input(z.object({ name: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const player = ctx.client.players.first();
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });

        const tracks: any[] = [];
        if (player.currentTrack) {
          tracks.push({
            title: player.currentTrack.title,
            artist: player.currentTrack.artist,
            url: player.currentTrack.url,
            duration: player.currentTrack.duration,
            thumbnail: player.currentTrack.thumbnail,
            platform: player.currentTrack.platform,
          });
        }
        for (const t of player.queue) {
          tracks.push({
            title: t.title,
            artist: t.artist,
            url: t.url,
            duration: t.duration,
            thumbnail: t.thumbnail,
            platform: t.platform,
          });
        }

        if (tracks.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Queue is empty' });

        const fs = await import('fs');
        const path = await import('path');
        const PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'presets.json');
        let presets: Record<string, any> = {};
        if (fs.existsSync(PRESETS_PATH)) {
          presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
        }
        presets[input.name] = { tracks, savedAt: new Date().toISOString() };
        fs.writeFileSync(PRESETS_PATH, JSON.stringify(presets, null, 2));

        return { success: true };
      }),

    load: protectedProcedure
      .input(z.object({ name: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const fs = await import('fs');
        const path = await import('path');
        const PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'presets.json');
        if (!fs.existsSync(PRESETS_PATH)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });

        const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
        if (!presets[input.name]) throw new TRPCError({ code: 'NOT_FOUND', message: `Preset "${input.name}" not found` });

        return { success: true, name: input.name };
      }),
  }),

  bot: router({
    getStatus: publicProcedure
      .query(async ({ ctx }) => {
        return {
          activeShard: ctx.client.shard?.ids[0] ?? 0,
          pingMs: ctx.client.ws.ping,
          uptime: ctx.client.uptime || (process.uptime() * 1000),
          online: true,
        };
      }),

    getCache: publicProcedure
      .query(async () => {
        const fs = await import('fs');
        const path = await import('path');
        const fsPromises = (await import('fs')).promises;
        const cacheDir = path.join(__dirname, '..', '..', '..', 'audio_cache');
        let totalSize = 0;
        if (fs.existsSync(cacheDir)) {
          const files = await fsPromises.readdir(cacheDir);
          for (const file of files) {
            const stats = await fsPromises.stat(path.join(cacheDir, file));
            totalSize += stats.size;
          }
        }
        return { sizeMb: Number((totalSize / (1024 * 1024)).toFixed(2)) };
      }),

    getSettings: publicProcedure
      .query(async () => {
        const config = (await import('../../../config')).default;
        return { sessionRestoreEnabled: config.sessionRestore?.enabled !== false };
      }),

    cleanCache: staffProcedure
      .mutation(async () => {
        const { cleanupAudioCache } = await import('../../SessionManager');
        await cleanupAudioCache();
        return { success: true, message: 'Audio cache cleaned successfully' };
      }),

    updateSessionRestore: ownerProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const config = (await import('../../../config')).default;
        config.sessionRestore.enabled = input.enabled;
        return { success: true, message: `Session restore ${input.enabled ? 'enabled' : 'disabled'}` };
      }),

    setRole: ownerProcedure
      .input(z.object({ userId: z.string(), role: z.number().min(0).max(2) }))
      .mutation(async ({ input }) => {
        const fs = await import('fs');
        const path = await import('path');
        const ROLES_FILE = path.join(__dirname, '..', '..', '..', 'roles.json');
        let roles: Record<string, number> = {};
        if (fs.existsSync(ROLES_FILE)) {
          roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
        }
        roles[input.userId] = input.role;
        fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
        return { success: true };
      }),

    getAuditLog: publicProcedure
      .query(async () => {
        const AuditLog = (await import('../AuditLog')).default;
        const logs = await AuditLog.read();
        return logs.map((log: any, idx: number) => ({
          ...log,
          id: log.id || log.timestamp || `audit-${idx}`,
        }));
      }),
  }),

  auth: router({
    discord: publicProcedure
      .input(z.object({ code: z.string(), redirectUri: z.string() }))
      .mutation(async ({ input }) => {
        const config = (await import('../../../config')).default;
        const crypto = await import('crypto');
        const fetch = (await import('node-fetch')).default;

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.discord.clientId,
            client_secret: config.discord.clientSecret,
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
          }),
        });

        if (!tokenResponse.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to exchange code' });
        const tokenData = await tokenResponse.json();

        const userResponse = await fetch('https://discord.com/api/users/@me', {
          headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` },
        });

        if (!userResponse.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to fetch user' });
        const userData = await userResponse.json();

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionStore = global.sessionStore || new Map();
        sessionStore.set(sessionToken, {
          id: userData.id,
          username: userData.username,
          global_name: userData.global_name,
          avatar: userData.avatar,
        });

        return {
          token: sessionToken,
          user: { ...userData, role: getUserRole(userData.id) },
        };
      }),

    session: publicProcedure
      .query(async ({ ctx }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
        return { user: ctx.user };
      }),
  }),

  discord: router({
    join: protectedProcedure
      .input(z.object({ userId: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const targetUserId = input.userId || '895441968241459271';
        let member = null;

        for (const guild of ctx.client.guilds.cache.values()) {
          member = await guild.members.fetch(targetUserId).catch(() => null);
          if (member?.voice.channel) break;
        }

        if (!member?.voice.channel) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User not in a voice channel' });
        }

        const { joinVoiceChannel } = await import('@discordjs/voice');
        joinVoiceChannel({
          channelId: member.voice.channel.id,
          guildId: member.guild.id,
          adapterCreator: member.guild.voiceAdapterCreator,
        });

        return { ok: true, channel: member.voice.channel.name };
      }),

    leave: protectedProcedure
      .mutation(async ({ ctx }) => {
        const player = ctx.client.players.first();
        if (player && typeof player.stop === 'function') {
          player.stop();
        }
        return { ok: true };
      }),
  }),

  system: router({
    getSettings: publicProcedure
      .query(async () => {
        const config = (await import('../../../config')).default;
        return { sessionRestoreEnabled: config.sessionRestore?.enabled !== false };
      }),

    updateSettings: ownerProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const config = (await import('../../../config')).default;
        config.sessionRestore.enabled = input.enabled;
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;