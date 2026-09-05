import { z } from 'zod';

export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  isPublic: z.boolean(),
  description: z.string().optional(),
  trackCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tracks: z.array(z.unknown()).optional(),
});

export const PresetSchema = z.object({
  name: z.string(),
  trackCount: z.number(),
  savedAt: z.string().nullable(),
  tracks: z.array(z.unknown()).optional(),
});

export const TrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  url: z.string().nullable(),
  duration: z.number(),
  durationSec: z.number().optional(),
  durationMs: z.number().optional(),
  length: z.number().optional(),
  thumbnail: z.string().nullable().optional(),
  art: z.string().nullable().optional(),
  artworkUrl: z.string().nullable().optional(),
  requestedBy: z.string().optional(),
  requesterName: z.string().optional(),
  requesterAvatar: z.string().nullable().optional(),
  platform: z.string().optional(),
});

export const QueueItemSchema = TrackSchema.extend({
  requestedBy: z.object({ id: z.string(), username: z.string() }).optional(),
});

export const PlayerSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  cleanedTitle: z.string().nullable().optional(),
  cleanedArtist: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  trackUrl: z.string().nullable().optional(),
  durationSec: z.number(),
  positionSec: z.number(),
  currentPositionMs: z.number().optional(),
  currentPositionSec: z.number().optional(),
  serverTimestampMs: z.number().nullable().optional(),
  startTime: z.number().nullable().optional(),
  lastPausedAt: z.number().nullable().optional(),
  isPaused: z.boolean().optional(),
  playing: z.boolean(),
  art: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  requesterName: z.string().nullable().optional(),
  requesterAvatar: z.string().nullable().optional(),
  volume: z.number(),
});

export const BotStatusSchema = z.object({
  activeShard: z.number(),
  pingMs: z.number(),
  uptime: z.number(),
  online: z.boolean(),
});

export const CacheSchema = z.object({
  sizeMb: z.number(),
  maxMb: z.number().optional(),
});

export const SettingsSchema = z.object({
  sessionRestoreEnabled: z.boolean(),
});

export const LyricsSchema = z.object({
  title: z.string(),
  artist: z.string(),
  source: z.string(),
  plain: z.string(),
  synced: z.string(),
  hasSynced: z.boolean(),
  lines: z.array(z.object({
    timeSeconds: z.number(),
    text: z.string(),
  })),
});

export const PitchFrameSchema = z.object({
  timeMs: z.number(),
  midi: z.number(),
});

export const PitchMapSchema = z.object({
  title: z.string(),
  artist: z.string(),
  frames: z.array(PitchFrameSchema),
});

export const KaraokeJobSchema = z.object({
  id: z.string(),
  songId: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  progress: z.number(),
  resultPath: z.string().optional(),
  error: z.string().optional(),
});

export const KaraokePrepareResponseSchema = z.object({
  status: z.enum(['ready', 'processing', 'error']),
  jobId: z.string(),
  stems: z.object({
    vocals: z.string(),
    instrumental: z.string(),
  }).optional(),
  frames: z.array(PitchFrameSchema).optional(),
  pitchMap: PitchMapSchema.optional(),
  error: z.string().optional(),
});

export const KaraokeStatusResponseSchema = KaraokePrepareResponseSchema;

export const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  duration: z.number().optional(),
  thumbnail: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  albumCover: z.string().nullable().optional(),
  allArtists: z.array(z.string()).optional(),
  mbid: z.string().nullable().optional(),
  releaseGroupMbid: z.string().nullable().optional(),
  popularityCount: z.number().optional(),
  views: z.number().nullable().optional(),
  uploadDate: z.string().nullable().optional(),
});

export const SearchResultsResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  count: z.number(),
});

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  requesterAvatar: z.string().nullable().optional(),
  requestedAt: z.string().optional(),
  createdAt: z.string().optional(),
  timestamp: z.string().optional(),
});

export const PlaybackActionSchema = z.enum(['play_pause', 'next', 'previous', 'stop', 'pause', 'resume']);

export const VolumeInputSchema = z.object({
  volume: z.number().min(0).max(100),
});

export const SeekInputSchema = z.object({
  positionMs: z.number().min(0),
});

export const QueueReorderInputSchema = z.object({
  oldIndex: z.number(),
  newIndex: z.number(),
});

export const LyricsInputSchema = z.object({
  title: z.string(),
  artist: z.string(),
  trackUrl: z.string().optional(),
  forceResync: z.boolean().optional(),
  duration: z.number().optional(),
  durationMs: z.number().optional(),
});

export const KaraokePrepareInputSchema = z.object({
  trackUrl: z.string().optional(),
  guildId: z.string().optional(),
});

export const SearchInputSchema = z.object({
  query: z.string(),
  guildId: z.string().optional(),
});

export const RequestSongInputSchema = z.object({
  query: z.string(),
  guildId: z.string().optional(),
});

export const PlaylistCreateInputSchema = z.object({
  name: z.string(),
  isPublic: z.boolean().optional(),
  description: z.string().optional(),
});

export const PlaylistAddTrackInputSchema = z.object({
  playlistId: z.string(),
  track: TrackSchema,
});

export const PlaylistSearchInputSchema = z.object({
  query: z.string(),
});

export const PresetSaveInputSchema = z.object({
  name: z.string(),
});

export const PresetLoadInputSchema = z.object({
  name: z.string(),
});

export const PlaylistDeleteInputSchema = z.object({
  id: z.string(),
});

export const QueueDeleteInputSchema = z.object({
  index: z.number(),
});

export const SystemSettingsInputSchema = z.object({
  enabled: z.boolean(),
});

export const AuthDiscordInputSchema = z.object({
  code: z.string(),
  redirectUri: z.string(),
});

export const DiscordJoinInputSchema = z.object({
  userId: z.string().optional(),
});

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type Playlist = z.infer<typeof PlaylistSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type BotStatus = z.infer<typeof BotStatusSchema>;
export type Cache = z.infer<typeof CacheSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Lyrics = z.infer<typeof LyricsSchema>;
export type PitchFrame = z.infer<typeof PitchFrameSchema>;
export type PitchMap = z.infer<typeof PitchMapSchema>;
export type KaraokeJob = z.infer<typeof KaraokeJobSchema>;
export type KaraokePrepareResponse = z.infer<typeof KaraokePrepareResponseSchema>;
export type KaraokeStatusResponse = z.infer<typeof KaraokeStatusResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultsResponse = z.infer<typeof SearchResultsResponseSchema>;
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type PlaybackAction = z.infer<typeof PlaybackActionSchema>;
export type VolumeInput = z.infer<typeof VolumeInputSchema>;
export type SeekInput = z.infer<typeof SeekInputSchema>;
export type QueueReorderInput = z.infer<typeof QueueReorderInputSchema>;
export type LyricsInput = z.infer<typeof LyricsInputSchema>;
export type KaraokePrepareInput = z.infer<typeof KaraokePrepareInputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
export type RequestSongInput = z.infer<typeof RequestSongInputSchema>;
export type PlaylistCreateInput = z.infer<typeof PlaylistCreateInputSchema>;
export type PlaylistAddTrackInput = z.infer<typeof PlaylistAddTrackInputSchema>;
export type PlaylistSearchInput = z.infer<typeof PlaylistSearchInputSchema>;
export type PresetSaveInput = z.infer<typeof PresetSaveInputSchema>;
export type PresetLoadInput = z.infer<typeof PresetLoadInputSchema>;
export type PlaylistDeleteInput = z.infer<typeof PlaylistDeleteInputSchema>;
export type QueueDeleteInput = z.infer<typeof QueueDeleteInputSchema>;
export type SystemSettingsInput = z.infer<typeof SystemSettingsInputSchema>;
export type AuthDiscordInput = z.infer<typeof AuthDiscordInputSchema>;
export type DiscordJoinInput = z.infer<typeof DiscordJoinInputSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;