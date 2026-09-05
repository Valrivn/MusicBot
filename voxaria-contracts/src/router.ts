import { initTRPC, TRPCError } from '@trpc/server';
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

const t = initTRPC.create();

const publicProcedure = t.procedure;
const protectedProcedure = t.procedure;
const staffProcedure = t.procedure;
const ownerProcedure = t.procedure;

export const appRouter = t.router({
  playlist: t.router({
    create: protectedProcedure
      .input(PlaylistCreateInputSchema)
      .output(PlaylistSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getById: publicProcedure
      .input(z.object({ id: z.string() }))
      .output(PlaylistSchema)
      .query(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getAll: publicProcedure
      .output(z.array(PlaylistSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getMyPlaylists: protectedProcedure
      .output(z.array(PlaylistSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getPublicPlaylists: publicProcedure
      .output(z.array(PlaylistSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    addTrack: protectedProcedure
      .input(PlaylistAddTrackInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    search: protectedProcedure
      .input(PlaylistSearchInputSchema)
      .output(SearchResultsResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    delete: protectedProcedure
      .input(PlaylistDeleteInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  queue: t.router({
    get: publicProcedure
      .output(z.array(QueueItemSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getHistory: publicProcedure
      .output(z.array(QueueItemSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    reorder: protectedProcedure
      .input(QueueReorderInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    remove: protectedProcedure
      .input(QueueDeleteInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    shuffle: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    clear: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  player: t.router({
    get: publicProcedure
      .output(PlayerSchema.nullable())
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    playback: protectedProcedure
      .input(z.object({ action: PlaybackActionSchema }))
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    previous: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    setVolume: protectedProcedure
      .input(VolumeInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    seek: protectedProcedure
      .input(SeekInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  music: t.router({
    search: protectedProcedure
      .input(SearchInputSchema)
      .output(z.object({ ok: z.boolean(), queued: z.number().optional() }))
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    request: protectedProcedure
      .input(RequestSongInputSchema)
      .output(z.object({ ok: z.boolean(), queued: z.number().optional() }))
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    searchCatalog: protectedProcedure
      .input(SearchInputSchema)
      .output(SearchResultsResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getLyrics: protectedProcedure
      .input(LyricsInputSchema)
      .output(LyricsSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  karaoke: t.router({
    prepare: protectedProcedure
      .input(KaraokePrepareInputSchema)
      .output(KaraokePrepareResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getStatus: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .output(KaraokeStatusResponseSchema)
      .query(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getPitchData: publicProcedure
      .input(z.object({ trackId: z.string().optional() }))
      .output(z.array(PitchMapSchema.shape.frames))
      .query(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  presets: t.router({
    getAll: publicProcedure
      .output(z.array(PresetSchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    save: protectedProcedure
      .input(PresetSaveInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    load: protectedProcedure
      .input(PresetLoadInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  bot: t.router({
    getStatus: publicProcedure
      .output(BotStatusSchema)
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getCache: publicProcedure
      .output(CacheSchema)
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getSettings: publicProcedure
      .output(SettingsSchema)
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    cleanCache: protectedProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    updateSessionRestore: protectedProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    setRole: protectedProcedure
      .input(z.object({ userId: z.string(), role: z.number().min(0).max(2) }))
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    getAuditLog: publicProcedure
      .output(z.array(AuditLogEntrySchema))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  auth: t.router({
    discord: publicProcedure
      .input(AuthDiscordInputSchema)
      .output(z.object({
        token: z.string(),
        user: z.object({
          id: z.string(),
          username: z.string(),
          global_name: z.string().nullable(),
          avatar: z.string().nullable(),
          role: z.number(),
        }),
      }))
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    session: publicProcedure
      .output(z.object({
        user: z.object({
          id: z.string(),
          username: z.string(),
          global_name: z.string().nullable(),
          avatar: z.string().nullable(),
          role: z.number(),
        }),
      }))
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  discord: t.router({
    join: protectedProcedure
      .input(DiscordJoinInputSchema)
      .output(z.object({ ok: z.boolean(), channel: z.string().optional(), error: z.string().optional() }))
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    leave: protectedProcedure
      .output(z.object({ ok: z.boolean() }))
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),

  system: t.router({
    getSettings: publicProcedure
      .output(SettingsSchema)
      .query(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    updateSettings: protectedProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),
});

export type AppRouter = typeof appRouter;