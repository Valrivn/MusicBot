import { initTRPC, TRPCError } from '@trpc/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  PlaylistSchema,
  PresetSchema,
  QueueItemSchema,
  PlayerSchema,
  BotStatusSchema,
  CacheSchema,
  SettingsSchema,
  LyricsSchema,
  PitchMapSchema,
  KaraokePrepareResponseSchema,
  KaraokeStatusResponseSchema,
  KaraokeRecordSchema,
  KaraokeGetRecordsInputSchema,
  KaraokeGetRecordsResponseSchema,
  KaraokeSubmitRecordInputSchema,
  KaraokeSubmitRecordResponseSchema,
  DuetPartitionInputSchema,
  DuetPartitionResponseSchema,
  SearchResultsResponseSchema,
  AuditLogEntrySchema,
  PlaybackActionSchema,
  VolumeInputSchema,
  SeekInputSchema,
  QueueReorderInputSchema,
  LyricsInputSchema,
  KaraokePrepareInputSchema,
  SearchInputSchema,
  RequestSongInputSchema,
  PlaylistCreateInputSchema,
  PlaylistAddTrackInputSchema,
  PlaylistSearchInputSchema,
  PresetSaveInputSchema,
  PresetLoadInputSchema,
  PlaylistDeleteInputSchema,
  QueueDeleteInputSchema,
  SystemSettingsInputSchema,
  AuthDiscordInputSchema,
  DiscordJoinInputSchema,
  ApiResponseSchema,
} from './schemas';

// ---------------------------------------------------------------------------
// Auth / Context
// ---------------------------------------------------------------------------

const OWNER_ID = process.env.DISCORD_OWNER_ID || '895441968241459271';

export interface AuthUser {
  id: string;
  username: string | null;
  /** 0 = guest, 1 = user, 3 = owner */
  role: number;
}

export interface TrpcContext {
  /** Discord.js client (opaque passthrough from host application). */
  client?: unknown;
  /** Resolved caller identity. */
  user: AuthUser;
  /** Guild context from headers. */
  guildId?: string | null;
}

export type VerifyTokenFn = (token: string) => Promise<AuthUser | null> | AuthUser | null;

export interface CreateContextOptions {
  req?: {
    headers?: Record<string, string | string[] | undefined>;
    app?: any;
    [key: string]: any;
  };
  client?: unknown;
  verifyToken?: VerifyTokenFn;
  sessionStore?: { get(key: string): unknown } | null;
}

const GUEST_USER: AuthUser = { id: 'guest', username: 'Guest', role: 0 };

function readHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function createContext(opts: CreateContextOptions = {}): Promise<TrpcContext> {
  const { req, client, verifyToken, sessionStore } = opts;
  const headers = (req && req.headers) || {};

  let user: AuthUser = GUEST_USER;

  const authHeader = readHeaderValue(headers, 'authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      let fromSession = false;
      if (sessionStore && typeof sessionStore.get === 'function') {
        try {
          const sessionUser = sessionStore.get(token) as Partial<AuthUser> | null | undefined;
          if (sessionUser && typeof sessionUser === 'object' && sessionUser.id) {
            user = {
              id: sessionUser.id,
              username: typeof sessionUser.username === 'string' ? sessionUser.username : null,
              role: sessionUser.id === OWNER_ID ? 3 : 1,
            };
            fromSession = true;
          }
        } catch {}
      }

      if (!fromSession && verifyToken) {
        try {
          const verified = await verifyToken(token);
          if (verified && verified.id) {
            user = {
              id: verified.id,
              username: typeof verified.username === 'string' ? verified.username : null,
              role: verified.id === OWNER_ID ? 3 : 1,
            };
          }
        } catch {}
      }
    }
  }

  const guildId =
    readHeaderValue(headers, 'x-guild-id') ||
    readHeaderValue(headers, 'X-Guild-Id') ||
    readHeaderValue(headers, 'guild-id') ||
    null;

  return { client, user, guildId };
}

const t = initTRPC.context<TrpcContext>().create();

export const publicProcedure = t.procedure;

/** Any authenticated caller (valid JWT identity, non-guest id). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.id || ctx.user.id === 'guest') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  return next({ ctx });
});

/** Owner only (userId === DISCORD_OWNER_ID from env). */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  const ownerId = process.env.DISCORD_OWNER_ID || '';
  if (!ctx.user || !ctx.user.id || ctx.user.id !== ownerId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner permissions required' });
  }
  return next({ ctx });
});

// Helper utilities for file & player operations
function getBotPath(...subPaths: string[]): string {
  const cwd = process.cwd();
  let base = cwd;
  if (fs.existsSync(path.join(cwd, 'MusicBot'))) {
    base = path.join(cwd, 'MusicBot');
  }
  return path.join(base, ...subPaths);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

function writeJsonFile<T>(filePath: string, data: T): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

function getPlayer(ctx: TrpcContext, targetGuildId?: string | null): any {
  const client = ctx.client as any;
  if (!client || !client.players) return null;
  const gId = targetGuildId || ctx.guildId;
  if (gId && client.players.has(gId)) {
    return client.players.get(gId);
  }
  if (typeof client.players.first === 'function') {
    return client.players.first();
  }
  if (client.players instanceof Map && client.players.size > 0) {
    return Array.from(client.players.values())[0];
  }
  return null;
}

function extractYtVideoId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function formatTrack(track: any) {
  if (!track) return null;
  const ytId = extractYtVideoId(track.url);
  const art =
    track.albumCover ||
    track.thumbnail ||
    (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
  const requesterTag =
    typeof track.requestedBy === 'string'
      ? track.requestedBy
      : track.requestedBy?.tag || track.requestedBy?.username || track.requesterTag || 'Unknown';
  return {
    id: String(track.id || track.url || Math.random().toString(36).substring(2, 11)),
    title: track.title || 'Unknown',
    artist: track.artist || 'Unknown',
    url: track.url || null,
    trackUrl: track.url || null,
    duration: track.duration || 0,
    durationSec: track.duration || 0,
    length: track.duration || 0,
    thumbnail: art,
    art: art,
    artworkUrl: art,
    requestedBy: requesterTag,
    requesterName: requesterTag,
    requesterAvatar: track.requestedBy?.avatar
      ? `https://cdn.discordapp.com/avatars/${track.requestedBy.id}/${track.requestedBy.avatar}.png`
      : null,
    platform: track.platform || 'youtube',
  };
}

function formatPlaylist(p: any) {
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  return {
    id: String(p.id || p.name || Math.random().toString(36).substring(2, 11)),
    name: String(p.name || 'Untitled Playlist'),
    ownerId: String(p.ownerId || 'guest'),
    isPublic: p.isPublic !== false,
    description: p.description ? String(p.description) : undefined,
    trackCount: typeof p.trackCount === 'number' ? p.trackCount : tracks.length,
    createdAt: String(p.createdAt || new Date().toISOString()),
    updatedAt: String(p.updatedAt || new Date().toISOString()),
    tracks,
  };
}

export const appRouter = t.router({
  playlist: t.router({
    create: protectedProcedure
      .input(PlaylistCreateInputSchema)
      .output(PlaylistSchema)
      .mutation(async ({ input, ctx }) => {
        const playlistsFile = getBotPath('database', 'playlists.json');
        const playlists = readJsonFile<any[]>(playlistsFile, []);
        const playlist = formatPlaylist({
          id: Math.random().toString(36).substring(2, 11),
          name: input.name.trim(),
          ownerId: ctx.user.id,
          isPublic: input.isPublic ?? true,
          description: input.description ?? '',
          tracks: [],
          trackCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        playlists.push(playlist);
        writeJsonFile(playlistsFile, playlists);
        return playlist;
      }),

    getById: publicProcedure
      .input(z.object({ id: z.string() }))
      .output(PlaylistSchema)
      .query(async ({ input }) => {
        const playlists = readJsonFile<any[]>(getBotPath('database', 'playlists.json'), []);
        const found = playlists.find((p) => p.id === input.id || p.name === input.id);
        if (!found) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Playlist ${input.id} not found` });
        }
        return formatPlaylist(found);
      }),

    getAll: publicProcedure
      .output(z.array(PlaylistSchema))
      .query(async () => {
        const playlists = readJsonFile<any[]>(getBotPath('database', 'playlists.json'), []);
        return playlists.map((p) => formatPlaylist(p));
      }),

    getMyPlaylists: protectedProcedure
      .output(z.array(PlaylistSchema))
      .query(async ({ ctx }) => {
        const playlists = readJsonFile<any[]>(getBotPath('database', 'playlists.json'), []);
        return playlists
          .filter((p) => (p.ownerId || 'guest') === ctx.user.id)
          .map((p) => formatPlaylist(p));
      }),

    getPublicPlaylists: publicProcedure
      .output(z.array(PlaylistSchema))
      .query(async () => {
        const playlists = readJsonFile<any[]>(getBotPath('database', 'playlists.json'), []);
        return playlists
          .filter((p) => p.isPublic !== false)
          .map((p) => formatPlaylist(p));
      }),

    addTrack: protectedProcedure
      .input(PlaylistAddTrackInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const playlistsFile = getBotPath('database', 'playlists.json');
        const playlists = readJsonFile<any[]>(playlistsFile, []);
        const playlist = playlists.find((p) => p.id === input.playlistId);
        if (!playlist) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Playlist ${input.playlistId} not found` });
        }
        if (!Array.isArray(playlist.tracks)) playlist.tracks = [];
        playlist.tracks.push({
          ...input.track,
          addedBy: ctx.user.id,
          addedAt: new Date().toISOString(),
        });
        playlist.updatedAt = new Date().toISOString();
        writeJsonFile(playlistsFile, playlists);
        return { success: true, message: 'Track added to playlist' };
      }),

    search: protectedProcedure
      .input(PlaylistSearchInputSchema)
      .output(SearchResultsResponseSchema)
      .mutation(async ({ input }) => {
        try {
          const YouTube = require(getBotPath('src', 'YouTube.js'));
          const results = await YouTube.search(input.query, 10);
          const formatted = results.map((r: any) => formatTrack(r)).filter(Boolean);
          return { results: formatted, count: formatted.length };
        } catch (e: any) {
          return { results: [], count: 0 };
        }
      }),

    delete: protectedProcedure
      .input(PlaylistDeleteInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        const playlistsFile = getBotPath('database', 'playlists.json');
        let playlists = readJsonFile<any[]>(playlistsFile, []);
        const initialLen = playlists.length;
        playlists = playlists.filter((p) => p.id !== input.id);
        if (playlists.length === initialLen) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Playlist ${input.id} not found` });
        }
        writeJsonFile(playlistsFile, playlists);
        return { success: true, message: 'Playlist deleted' };
      }),
  }),

  queue: t.router({
    get: publicProcedure
      .output(z.array(QueueItemSchema))
      .query(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player || !Array.isArray(player.queue)) return [];
        return player.queue.map((track: any) => formatTrack(track)).filter(Boolean);
      }),

    getHistory: publicProcedure
      .output(z.array(QueueItemSchema))
      .query(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player || !Array.isArray(player.previousTracks)) return [];
        return player.previousTracks.map((track: any) => formatTrack(track)).filter(Boolean);
      }),

    reorder: protectedProcedure
      .input(QueueReorderInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.moveInQueue === 'function') {
          player.moveInQueue(input.oldIndex, input.newIndex);
        } else if (Array.isArray(player.queue)) {
          const [item] = player.queue.splice(input.oldIndex, 1);
          if (item) player.queue.splice(input.newIndex, 0, item);
        }
        return { success: true, message: 'Queue reordered' };
      }),

    remove: protectedProcedure
      .input(QueueDeleteInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.removeQueueItem === 'function') {
          player.removeQueueItem(input.index);
        } else if (Array.isArray(player.queue)) {
          player.queue.splice(input.index, 1);
        }
        return { success: true, message: 'Item removed from queue' };
      }),

    shuffle: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.shuffleQueue === 'function') {
          player.shuffleQueue();
        }
        return { success: true, message: 'Queue shuffled' };
      }),

    clear: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (Array.isArray(player.queue)) player.queue.length = 0;
        player.currentTrack = null;
        if (typeof player.stop === 'function') player.stop();
        return { success: true, message: 'Queue cleared' };
      }),
  }),

  player: t.router({
    get: publicProcedure
      .output(PlayerSchema.nullable())
      .query(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player) return null;
        const track = player.currentTrack;
        const streamTimeMs = player.resource ? player.resource.playbackDuration : 0;
        const currentPosMs = (player.currentTrackStartOffsetMs || 0) + streamTimeMs;
        const bufferAdjustedStartTime = Date.now() - currentPosMs;
        const lastPausedAt = player.paused ? Date.now() : null;
        const formatted = formatTrack(track);

        return {
          id: formatted?.id || null,
          title: formatted?.title || null,
          artist: formatted?.artist || null,
          cleanedTitle: formatted?.title || null,
          cleanedArtist: formatted?.artist || null,
          url: formatted?.url || null,
          trackUrl: formatted?.url || null,
          durationSec: formatted?.duration || 0,
          positionSec: Math.floor(currentPosMs / 1000),
          currentPositionMs: currentPosMs,
          currentPositionSec: Math.floor(currentPosMs / 1000),
          startTime: bufferAdjustedStartTime,
          serverTimestampMs: Date.now(),
          lastPausedAt,
          isPaused: Boolean(player.paused),
          playing: !player.paused,
          art: formatted?.art || null,
          thumbnail: formatted?.thumbnail || null,
          requesterName: formatted?.requesterName || null,
          requesterAvatar: formatted?.requesterAvatar || null,
          volume: player.volume || 100,
        };
      }),

    playback: protectedProcedure
      .input(z.object({ action: PlaybackActionSchema }))
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        const { action } = input;
        if (action === 'play_pause') {
          if (player.paused) {
            if (typeof player.resumeFor === 'function') player.resumeFor('api');
            else if (typeof player.resume === 'function') player.resume();
          } else {
            if (typeof player.pauseFor === 'function') player.pauseFor('api');
            else if (typeof player.pause === 'function') player.pause();
          }
        } else if (action === 'next') {
          if (typeof player.skip === 'function') player.skip();
        } else if (action === 'previous') {
          if (typeof player.previous === 'function') player.previous();
        } else if (action === 'stop') {
          if (typeof player.stop === 'function') player.stop();
        } else if (action === 'pause') {
          if (!player.paused) {
            if (typeof player.pauseFor === 'function') player.pauseFor('api');
            else if (typeof player.pause === 'function') player.pause();
          }
        } else if (action === 'resume') {
          if (player.paused) {
            if (typeof player.resumeFor === 'function') player.resumeFor('api');
            else if (typeof player.resume === 'function') player.resume();
          }
        }
        return { success: true, message: `Action ${action} executed` };
      }),

    previous: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async ({ ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.previous === 'function') player.previous();
        return { success: true, message: 'Playing previous track' };
      }),

    setVolume: protectedProcedure
      .input(VolumeInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.setVolume === 'function') player.setVolume(input.volume);
        return { success: true, message: `Volume set to ${input.volume}` };
      }),

    seek: protectedProcedure
      .input(SeekInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        if (!player) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active player' });
        if (typeof player.seek === 'function') {
          await player.seek(input.positionMs);
        }
        return { success: true, message: `Seeked to ${input.positionMs}ms` };
      }),
  }),

  music: t.router({
    search: protectedProcedure
      .input(SearchInputSchema)
      .output(z.object({ ok: z.boolean(), queued: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        let player = getPlayer(ctx, input.guildId);
        if (player && typeof player.addTrack === 'function') {
          await player.addTrack(input.query, { tag: ctx.user.username || 'User', id: ctx.user.id });
        }
        return { ok: true, queued: 1 };
      }),

    request: protectedProcedure
      .input(RequestSongInputSchema)
      .output(z.object({ ok: z.boolean(), queued: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        let player = getPlayer(ctx, input.guildId);
        if (player && typeof player.addTrack === 'function') {
          await player.addTrack(input.query, { tag: ctx.user.username || 'User', id: ctx.user.id });
        }
        return { ok: true, queued: 1 };
      }),

    searchCatalog: protectedProcedure
      .input(SearchInputSchema)
      .output(SearchResultsResponseSchema)
      .mutation(async ({ input }) => {
        try {
          const YouTube = require(getBotPath('src', 'YouTube.js'));
          const results = await YouTube.search(input.query, 10);
          const formatted = results.map((r: any) => formatTrack(r)).filter(Boolean);
          return { results: formatted, count: formatted.length };
        } catch {
          return { results: [], count: 0 };
        }
      }),

    getLyrics: protectedProcedure
      .input(LyricsInputSchema)
      .output(LyricsSchema)
      .mutation(async ({ input }) => {
        return {
          title: input.title,
          artist: input.artist,
          source: 'Lrclib',
          plain: 'Lyrics unavailable',
          synced: '',
          hasSynced: false,
          lines: [],
        };
      }),
  }),

  karaoke: t.router({
    prepare: protectedProcedure
      .input(KaraokePrepareInputSchema)
      .output(KaraokePrepareResponseSchema)
      .mutation(async ({ input }) => {
        return { status: 'ready' as const, jobId: 'job-' + Date.now() };
      }),

    getStatus: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .output(KaraokeStatusResponseSchema)
      .query(async ({ input }) => {
        return { status: 'ready' as const, jobId: input.jobId };
      }),

    getPitchData: publicProcedure
      .input(z.object({ trackId: z.string().optional() }))
      .output(z.array(PitchMapSchema.shape.frames))
      .query(async () => {
        return [];
      }),

    getRecords: publicProcedure
      .input(KaraokeGetRecordsInputSchema)
      .output(KaraokeGetRecordsResponseSchema)
      .query(async ({ input }) => {
        try {
          const recordsServicePath = getBotPath('src', 'services', 'karaoke-records.js');
          if (fs.existsSync(recordsServicePath)) {
            const { getServerHighscore, getServerLeaderboard } = require(recordsServicePath);
            const highscore = await getServerHighscore(input.guildId, input.trackId);
            const leaderboard = await getServerLeaderboard(input.guildId, input.trackId, 10);
            return {
              highscore: highscore || null,
              leaderboard: Array.isArray(leaderboard) ? leaderboard : [],
            };
          }
        } catch (_) {}
        return {
          highscore: null,
          leaderboard: [],
        };
      }),

    submitRecord: publicProcedure
      .input(KaraokeSubmitRecordInputSchema)
      .output(KaraokeSubmitRecordResponseSchema)
      .mutation(async ({ input, ctx }) => {
        try {
          const recordsServicePath = getBotPath('src', 'services', 'karaoke-records.js');
          if (fs.existsSync(recordsServicePath)) {
            const { submitScore } = require(recordsServicePath);
            const res = await submitScore(input.guildId, input.trackId, {
              score: input.score,
              accuracyPercent: input.accuracy,
              maxCombo: input.maxCombo,
              grade: input.grade,
              userId: ctx?.user?.id || 'guest',
              username: ctx?.user?.username || 'Anonymous',
            });
            const current = res.currentRecord || {};
            return {
              success: true,
              record: {
                ...current,
                guildId: current.guildId || input.guildId,
                trackId: current.trackId || input.trackId,
                score: typeof current.score === 'number' ? current.score : input.score,
                accuracy: typeof current.accuracy === 'number' ? current.accuracy : (current.accuracyPercent ?? input.accuracy),
                accuracyPercent: current.accuracyPercent ?? input.accuracy,
                maxCombo: typeof current.maxCombo === 'number' ? current.maxCombo : input.maxCombo,
                grade: current.grade || input.grade,
                sungAt: current.sungAt || Date.now(),
              },
              isNewRecord: Boolean(res.isNewRecord),
            };
          }
        } catch (_) {}

        return {
          success: true,
          record: {
            guildId: input.guildId,
            trackId: input.trackId,
            score: input.score,
            accuracy: input.accuracy,
            accuracyPercent: input.accuracy,
            maxCombo: input.maxCombo,
            grade: input.grade,
            userId: ctx?.user?.id || 'guest',
            username: ctx?.user?.username || 'Anonymous',
            sungAt: Date.now(),
          },
          isNewRecord: true,
        };
      }),

    duetPartition: publicProcedure
      .input(DuetPartitionInputSchema)
      .output(DuetPartitionResponseSchema)
      .mutation(async ({ input }) => {
        try {
          const duetServicePath = getBotPath('src', 'services', 'duet-partitioner.js');
          if (fs.existsSync(duetServicePath)) {
            const { partitionLyrics } = require(duetServicePath);
            const partitioned = partitionLyrics(input.lines);
            return {
              lines: partitioned.map((l: any) => ({
                text: l.text,
                timeSeconds: l.timeSeconds,
                part: l.part || 'A',
                singerLabel: l.singerLabel,
              })),
            };
          }
        } catch (_) {}

        return {
          lines: input.lines.map((line, idx) => ({
            text: line.text,
            timeSeconds: line.timeSeconds,
            part: line.part || (idx % 2 === 0 ? 'A' : 'B'),
            singerLabel: line.part === 'BOTH' ? 'Both (Gold)' : (idx % 2 === 0 ? 'Singer 1 (Blue)' : 'Singer 2 (Purple)'),
          })),
        };
      }),
  }),

  presets: t.router({
    getAll: publicProcedure
      .output(z.array(PresetSchema))
      .query(async () => {
        const presets = readJsonFile<Record<string, any>>(getBotPath('presets.json'), {});
        return Object.entries(presets).map(([name, data]) => ({
          name,
          trackCount: data.tracks?.length || 0,
          savedAt: data.savedAt || null,
          tracks: data.tracks || [],
        }));
      }),

    save: protectedProcedure
      .input(PresetSaveInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const player = getPlayer(ctx);
        const tracks: any[] = [];
        if (player?.currentTrack) tracks.push(formatTrack(player.currentTrack));
        if (Array.isArray(player?.queue)) {
          player.queue.forEach((t: any) => tracks.push(formatTrack(t)));
        }
        const presetsFile = getBotPath('presets.json');
        const presets = readJsonFile<Record<string, any>>(presetsFile, {});
        presets[input.name] = { tracks, savedAt: new Date().toISOString() };
        writeJsonFile(presetsFile, presets);
        return { success: true, message: `Preset '${input.name}' saved` };
      }),

    load: protectedProcedure
      .input(PresetLoadInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input, ctx }) => {
        const presets = readJsonFile<Record<string, any>>(getBotPath('presets.json'), {});
        const preset = presets[input.name];
        if (!preset) throw new TRPCError({ code: 'NOT_FOUND', message: `Preset '${input.name}' not found` });
        const player = getPlayer(ctx);
        if (player && Array.isArray(preset.tracks)) {
          preset.tracks.forEach((t: any) => {
            if (typeof player.addTrack === 'function') {
              player.addTrack(t.url || `${t.title} ${t.artist}`, {
                tag: ctx.user.username || 'User',
                id: ctx.user.id,
              });
            } else if (Array.isArray(player.queue)) {
              player.queue.push(t);
            }
          });
        }
        return { success: true, message: `Loaded preset '${input.name}'` };
      }),
  }),

  bot: t.router({
    getStatus: publicProcedure
      .output(BotStatusSchema)
      .query(async ({ ctx }) => {
        const client = ctx.client as any;
        return {
          activeShard: client?.shard?.ids?.[0] ?? 0,
          pingMs: client?.ws?.ping ?? 0,
          uptime: Math.floor(client?.uptime || (process.uptime() * 1000)),
          online: true,
        };
      }),

    getCache: publicProcedure
      .output(CacheSchema)
      .query(async () => {
        const cacheDir = getBotPath('audio_cache');
        let totalSize = 0;
        try {
          if (fs.existsSync(cacheDir)) {
            const files = fs.readdirSync(cacheDir);
            for (const file of files) {
              const stats = fs.statSync(path.join(cacheDir, file));
              totalSize += stats.size;
            }
          }
        } catch {}
        return { sizeMb: Number((totalSize / (1024 * 1024)).toFixed(2)), maxMb: 5000 };
      }),

    getSettings: publicProcedure
      .output(SettingsSchema)
      .query(async () => {
        const configPath = getBotPath('config.js');
        let enabled = true;
        try {
          if (fs.existsSync(configPath)) {
            delete require.cache[require.resolve(configPath)];
            const cfg = require(configPath);
            enabled = cfg.sessionRestore?.enabled !== false;
          }
        } catch {}
        return { sessionRestoreEnabled: enabled };
      }),

    cleanCache: ownerProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        try {
          const { cleanupAudioCache } = require(getBotPath('src', 'SessionManager.js'));
          await cleanupAudioCache();
        } catch {}
        return { success: true, message: 'Audio cache cleaned successfully' };
      }),

    updateSessionRestore: ownerProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        try {
          const configPath = getBotPath('config.js');
          if (fs.existsSync(configPath)) {
            const cfg = require(configPath);
            if (cfg.sessionRestore) cfg.sessionRestore.enabled = input.enabled;
          }
        } catch {}
        return { success: true, message: `Session restore set to ${input.enabled}` };
      }),

    getAuditLog: publicProcedure
      .output(z.array(AuditLogEntrySchema))
      .query(async () => {
        const logs = readJsonFile<any[]>(getBotPath('audit_log.json'), []);
        return logs.map((l: any, idx: number) => ({
          id: String(l.id || l.timestamp || `audit-${idx}`),
          title: String(l.title || l.action || 'Audit Log Entry'),
          requesterAvatar: l.requesterAvatar || null,
          requestedAt: l.requestedAt || l.timestamp || new Date().toISOString(),
          createdAt: l.createdAt || l.timestamp || new Date().toISOString(),
          timestamp: l.timestamp || new Date().toISOString(),
        }));
      }),
  }),

  auth: t.router({
    discord: publicProcedure
      .input(AuthDiscordInputSchema)
      .output(
        z.object({
          token: z.string(),
          user: z.object({
            id: z.string(),
            username: z.string(),
            global_name: z.string().nullable(),
            avatar: z.string().nullable(),
            role: z.number(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        return {
          token: 'demo-token',
          user: {
            id: OWNER_ID,
            username: 'Owner',
            global_name: 'Bot Owner',
            avatar: null,
            role: 3,
          },
        };
      }),

    session: publicProcedure
      .output(
        z.object({
          user: z.object({
            id: z.string(),
            username: z.string(),
            global_name: z.string().nullable(),
            avatar: z.string().nullable(),
            role: z.number(),
          }),
        }),
      )
      .query(async ({ ctx }) => {
        return {
          user: {
            id: ctx.user.id,
            username: ctx.user.username || 'User',
            global_name: ctx.user.username,
            avatar: null,
            role: ctx.user.role,
          },
        };
      }),
  }),

  discord: t.router({
    join: protectedProcedure
      .input(DiscordJoinInputSchema)
      .output(z.object({ ok: z.boolean(), channel: z.string().optional(), error: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const client = ctx.client as any;
        if (!client) return { ok: false, error: 'Discord client not connected' };
        const targetUserId = input.userId || ctx.user.id || OWNER_ID;
        let member = null;
        if (client.guilds?.cache) {
          for (const guild of client.guilds.cache.values()) {
            try {
              member = await guild.members.fetch(targetUserId);
              if (member?.voice?.channel) break;
            } catch {}
          }
        }
        if (!member?.voice?.channel) {
          return { ok: false, error: 'User not found in any voice channel' };
        }
        const { joinVoiceChannel } = require('@discordjs/voice');
        joinVoiceChannel({
          channelId: member.voice.channel.id,
          guildId: member.guild.id,
          adapterCreator: member.guild.voiceAdapterCreator,
        });
        return { ok: true, channel: member.voice.channel.name };
      }),

    leave: protectedProcedure
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx }) => {
        const client = ctx.client as any;
        if (client?.players?.values) {
          const { getVoiceConnection } = require('@discordjs/voice');
          for (const player of client.players.values()) {
            try {
              if (typeof player.stop === 'function') player.stop();
              const conn = getVoiceConnection(player.guild?.id);
              if (conn) conn.destroy();
            } catch {}
          }
          client.players.clear();
        }
        return { ok: true };
      }),
  }),

  system: t.router({
    getSettings: publicProcedure
      .output(SettingsSchema)
      .query(async () => {
        return { sessionRestoreEnabled: true };
      }),

    updateSettings: ownerProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        return { success: true, message: `Settings updated: sessionRestoreEnabled=${input.enabled}` };
      }),
  }),

  ai: t.router({
    models: t.router({
      getAll: publicProcedure
        .output(z.array(z.object({
          id: z.string(),
          provider: z.string(),
          name: z.string().optional(),
          capabilities: z.array(z.string()).optional(),
          maxTokens: z.number().optional(),
          speed: z.string().optional(),
          health: z.object({
            healthy: z.boolean(),
            lastCheck: z.number().optional(),
            errorCount: z.number().optional(),
            successCount: z.number().optional(),
          }).optional(),
        })))
        .query(async () => {
          try {
            const axios = require('axios');
            const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
            const apiKey = process.env.ORCHESTRATOR_API_KEY;
            const response = await axios.get(`${orchestratorUrl}/api/models`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 5000,
            });
            return response.data;
          } catch (e) {
            return [];
          }
        }),

      route: protectedProcedure
        .input(z.object({
          prompt: z.string(),
          capability: z.string().optional(),
          priority: z.enum(['speed', 'quality', 'balanced']).optional(),
          maxTokens: z.number().optional(),
        }))
        .output(z.object({
          requestId: z.string(),
          modelId: z.string(),
          provider: z.string(),
          baseUrl: z.string(),
          maxTokens: z.number(),
          tokenLimit: z.number(),
          metadata: z.object({
            startTime: z.number(),
            model: z.string().optional(),
            capabilities: z.array(z.string()).optional(),
          }).optional(),
        }))
        .mutation(async ({ input }) => {
          try {
            const axios = require('axios');
            const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
            const apiKey = process.env.ORCHESTRATOR_API_KEY;
            const response = await axios.post(`${orchestratorUrl}/api/route`, input, {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 10000,
            });
            return response.data;
          } catch (e: any) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: e.message });
          }
        }),
    }),

    tasks: t.router({
      dispatch: protectedProcedure
        .input(z.object({
          subtasks: z.array(z.object({
            capability: z.string().optional(),
            prompt: z.string(),
            priority: z.enum(['speed', 'quality', 'balanced']).optional(),
            maxTokens: z.number().optional(),
          })),
          coordinationStrategy: z.enum(['gather', 'race', 'pipeline']).optional(),
        }))
        .output(z.object({
          taskId: z.string(),
          status: z.string(),
          subtasks: z.array(z.object({
            subtaskId: z.string(),
            workerId: z.string().optional(),
            status: z.string(),
          })),
          awarenessPrompt: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          try {
            const axios = require('axios');
            const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
            const apiKey = process.env.ORCHESTRATOR_API_KEY;
            const response = await axios.post(`${orchestratorUrl}/api/dispatch`, input, {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 10000,
            });
            return response.data;
          } catch (e: any) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: e.message });
          }
        }),

      getStatus: protectedProcedure
        .input(z.object({ taskId: z.string() }))
        .output(z.object({
          taskId: z.string(),
          status: z.string(),
          subtasks: z.array(z.object({
            subtaskId: z.string(),
            workerId: z.string().optional(),
            status: z.string(),
            result: z.any().optional(),
            startTime: z.number().optional(),
            endTime: z.number().optional(),
          })).optional(),
          coordinationStrategy: z.string().optional(),
          createdAt: z.number().optional(),
          completedAt: z.number().optional(),
        }))
        .query(async ({ input }) => {
          try {
            const axios = require('axios');
            const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
            const apiKey = process.env.ORCHESTRATOR_API_KEY;
            const response = await axios.get(`${orchestratorUrl}/api/tasks/${input.taskId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 5000,
            });
            return response.data;
          } catch (e: any) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
          }
        }),

      getResult: protectedProcedure
        .input(z.object({ taskId: z.string() }))
        .output(z.object({
          taskId: z.string(),
          strategy: z.string().optional(),
          results: z.array(z.object({
            subtaskId: z.string(),
            result: z.any().optional(),
            duration: z.number().optional(),
            error: z.string().optional(),
          })),
          totalDuration: z.number().optional(),
          error: z.string().optional(),
        }))
        .query(async ({ input }) => {
          try {
            const axios = require('axios');
            const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
            const apiKey = process.env.ORCHESTRATOR_API_KEY;
            const response = await axios.get(`${orchestratorUrl}/api/tasks/${input.taskId}/result`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 5000,
            });
            return response.data;
          } catch (e: any) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Task result not found' });
          }
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
