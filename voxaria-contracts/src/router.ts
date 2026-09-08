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

// ---------------------------------------------------------------------------
// Auth / Context
//
// The host application (MusicBot) passes a JWT verifier into `createContext`
// via `opts.verifyToken`. `createContext` reads `Authorization: Bearer <jwt>`
// from the request, resolves the caller identity, and attaches `ctx.user`
// ({ id, username, role }) when valid. Unauthenticated callers always get a
// neutral guest identity ({ id: 'guest', role: 0 }) — never a crash, and never
// a client-spoofable identity (x-user-id / x-user-username headers are ignored).
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  username: string | null;
  /** 0 = guest, 1 = user, 2 = staff, 3 = owner */
  role: number;
}

export interface TrpcContext {
  /** Discord.js client (opaque passthrough from the host application). */
  client?: unknown;
  /** Resolved caller identity; always present (guest fallback for anonymous). */
  user: AuthUser;
  /** Guild context from x-guild-id / X-Guild-Id / guild-id request headers. */
  guildId?: string | null;
}

export type VerifyTokenFn = (token: string) => Promise<AuthUser | null> | AuthUser | null;

export interface CreateContextOptions {
  /** Incoming HTTP request (Express or any { headers }-shaped object). */
  req?: {
    headers?: Record<string, string | string[] | undefined>;
    app?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  /** Opaque host-application payload passed through to the context. */
  client?: unknown;
  /**
   * Async (or sync) JWT verifier supplied by the host application.
   * Receives the raw Bearer token; returns { id, username, role } or null.
   * When omitted (standalone usage / tests) the context degrades to guest.
   */
  verifyToken?: VerifyTokenFn;
  /** Optional legacy session store (Map-like). Consulted before verifyToken. */
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
      // 1. Legacy session-store hit short-circuits (mirrors MusicBot's resolveUser).
      let fromSession = false;
      if (sessionStore && typeof sessionStore.get === 'function') {
        try {
          const sessionUser = sessionStore.get(token) as Partial<AuthUser> | null | undefined;
          if (sessionUser && typeof sessionUser === 'object' && sessionUser.id) {
            user = {
              id: sessionUser.id,
              username: typeof sessionUser.username === 'string' ? sessionUser.username : null,
              role: typeof sessionUser.role === 'number' ? sessionUser.role : 0,
            };
            fromSession = true;
          }
        } catch {
          // A broken session store must never crash the context; stay guest.
        }
      }

      // 2. Caller-supplied JWT verifier (authoritative identity source).
      if (!fromSession && verifyToken) {
        try {
          const verified = await verifyToken(token);
          if (verified && verified.id) {
            user = {
              id: verified.id,
              username: typeof verified.username === 'string' ? verified.username : null,
              role: typeof verified.role === 'number' ? verified.role : 0,
            };
          }
        } catch {
          // Invalid / expired token -> stay guest; never reject the request here.
        }
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

/** Any authenticated caller (role >= 1). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 1) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  return next({ ctx });
});

/** Staff and above (role >= 2). */
export const staffProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 2) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Staff permissions required' });
  }
  return next({ ctx });
});

/** Owner only (role >= 3). */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 3) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner permissions required' });
  }
  return next({ ctx });
});

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

    cleanCache: staffProcedure
      .output(ApiResponseSchema)
      .mutation(async () => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    updateSessionRestore: ownerProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),

    setRole: ownerProcedure
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

    updateSettings: ownerProcedure
      .input(SystemSettingsInputSchema)
      .output(ApiResponseSchema)
      .mutation(async ({ input }) => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Backend implementation required' });
      }),
  }),
});

export type AppRouter = typeof appRouter;