# Voxaria Contracts Architecture & API Taxonomy (`voxaria-contracts/src`)

The `@voxaria/contracts` package serves as the **single source of truth** for typed contracts between Voxaria's Frontend (`Voxaria-Web`), Backend (`MusicBot`), and Orchestrator (`voxaria-orchestrator`). It exports:
1. **Error Taxonomy & Envelopes (`errors.ts`)**: Unified error codes and structured error response payloads.
2. **Zod Validation Schemas (`schemas.ts`)**: Runtime validation and inferred TypeScript types for requests, responses, models, and payloads.
3. **Typed tRPC Router (`router.ts`)**: End-to-end type-safe API definitions covering auth, player controls, queue, lyrics, playlists, and karaoke.

---

## 1. Error Taxonomy (`errors.ts`)

### `VoxariaErrorCode` Enum
Categorized error codes for deterministic classification and error handling:

| Domain | Error Code | Description |
|---|---|---|
| **AUTH** | `AUTH_UNAUTHORIZED` | Request requires authentication or bearer token is missing |
| | `AUTH_TOKEN_EXPIRED` | Provided JWT/session token has expired |
| | `AUTH_FORBIDDEN` | Caller lacks required permissions (e.g., non-owner calling owner endpoints) |
| **PLAYER** | `PLAYER_BOT_NOT_IN_VOICE` | Action attempted while the bot is not connected to a voice channel |
| | `PLAYER_QUEUE_EMPTY` | Skip or playback action invoked on an empty queue |
| | `TRACK_NOT_FOUND` | Track ID or URL could not be resolved |
| | `SOURCE_EXTRACT_FAILED` | Audio source extractor (YouTube, SoundCloud, Spotify) failed |
| **KARAOKE** | `KARAOKE_REDIS_UNAVAILABLE` | Redis worker connection or queue unavailable |
| | `KARAOKE_STEM_FAILED` | Demucs stem separation job failed or timed out |
| | `KARAOKE_NO_PITCH_DATA` | Pitch detection (Crepe/Torch) returned empty frames |
| **RECORDS & PLAYLISTS** | `RECORD_INVALID_SCORE` | Score submission payload contains invalid numbers or missing fields |
| | `PLAYLIST_DUPLICATE_NAME` | Playlist creation failed due to duplicate name collision |
| | `PLAYLIST_NOT_FOUND` | Specified playlist ID does not exist |

### Interfaces & Helpers
- `ApiErrorResponse`:
  ```typescript
  interface ApiErrorResponse {
    success: false;
    error: {
      code: VoxariaErrorCode;
      message: string;
      details?: unknown;
    };
  }
  ```
- `createApiError(code, message, details?)`: Constructs a standardized `ApiErrorResponse`.
- `VoxariaApiError`: Custom Error class encapsulating `code` and optional `details`.
- `isApiErrorResponse(obj)`: Type guard for detecting typed API error responses.

---

## 2. Zod Schemas & Inferred Types (`schemas.ts`)

### Core Entities
- **Track & Queue**: `TrackSchema`, `QueueItemSchema`, `PlayerSchema`
- **Playlists & Presets**: `PlaylistSchema`, `PresetSchema`, `PlaylistCreateInputSchema`, `PlaylistAddTrackInputSchema`, `PlaylistSearchInputSchema`, `PlaylistDeleteInputSchema`, `PresetSaveInputSchema`, `PresetLoadInputSchema`
- **Lyrics & Pitch**: `LyricsSchema`, `LyricsInputSchema`, `PitchFrameSchema`, `PitchMapSchema`
- **Bot & System**: `BotStatusSchema`, `CacheSchema`, `SettingsSchema`, `AuditLogEntrySchema`, `VolumeInputSchema`, `SeekInputSchema`, `QueueReorderInputSchema`, `QueueDeleteInputSchema`, `SystemSettingsInputSchema`
- **Auth**: `AuthDiscordInputSchema`, `DiscordJoinInputSchema`
- **Search**: `SearchResultSchema`, `SearchResultsResponseSchema`, `SearchInputSchema`, `RequestSongInputSchema`

### Karaoke & Duet Contracts
- **`KaraokeRecordSchema` / `KaraokeRecord`**:
  ```typescript
  {
    id?: number | string;
    guildId: string;
    trackId: string;
    trackTitle?: string;
    trackArtist?: string | null;
    userId?: string;
    username?: string;
    avatarUrl?: string | null;
    score: number;
    accuracy?: number;
    accuracyPercent?: number;
    maxCombo: number;
    grade: string;
    sungAt?: number | string;
    rank?: number;
  }
  ```
- **`KaraokeGetRecordsInputSchema`**: `{ guildId: string, trackId: string }`
- **`KaraokeGetRecordsResponseSchema`**: `{ highscore: KaraokeRecord | null, leaderboard: KaraokeRecord[] }`
- **`KaraokeSubmitRecordInputSchema`**: `{ guildId: string, trackId: string, score: number, accuracy: number, maxCombo: number, grade: string }`
- **`KaraokeSubmitRecordResponseSchema`**: `{ success: boolean, record: KaraokeRecord, isNewRecord: boolean }`
- **`DuetPartitionLineInputSchema`**: `{ text: string, timeSeconds: number, part?: string }`
- **`DuetPartitionInputSchema`**: `{ lines: DuetPartitionLineInput[] }`
- **`DuetPartitionLineOutputSchema`**: `{ text: string, timeSeconds: number, part: string, singerLabel?: string }`
- **`DuetPartitionResponseSchema`**: `{ lines: DuetPartitionLineOutput[] }`

---

## 3. Router Procedures (`router.ts`)

The root `appRouter` is partitioned into modular tRPC sub-routers:

| Sub-Router | Procedure | Type | Input | Output | Description |
|---|---|---|---|---|---|
| **`auth`** | `discord` | Mutation | `AuthDiscordInputSchema` | Auth token & profile | Exchanges Discord OAuth code |
| | `join` | Mutation | `DiscordJoinInputSchema` | `ApiResponseSchema` | Connects bot to caller voice |
| **`bot`** | `status` | Query | None | `BotStatusSchema` | Shard status, ping, uptime |
| | `cache` | Query | None | `CacheSchema` | Audio cache size in MB |
| **`player`** | `get` | Query | None | `PlayerSchema` | Current playback state |
| | `playbackAction` | Mutation | `PlaybackActionSchema` | `ApiResponseSchema` | Pause, resume, skip, stop |
| | `setVolume` | Mutation | `VolumeInputSchema` | `ApiResponseSchema` | Adjust volume (0-100) |
| | `seek` | Mutation | `SeekInputSchema` | `ApiResponseSchema` | Seek playback to position (ms) |
| **`queue`** | `get` | Query | None | `QueueItem[]` | Current guild track queue |
| | `delete` | Mutation | `QueueDeleteInputSchema` | `ApiResponseSchema` | Remove item at index |
| | `reorder` | Mutation | `QueueReorderInputSchema` | `ApiResponseSchema` | Reorder queue positions |
| **`lyrics`** | `get` | Query | `LyricsInputSchema` | `LyricsSchema` | Fetches synchronized lyrics |
| **`karaoke`** | `prepare` | Mutation | `KaraokePrepareInputSchema` | `KaraokePrepareResponseSchema` | Dispatches Demucs stem job |
| | `getStatus` | Query | `{ jobId: string }` | `KaraokeStatusResponseSchema` | Polls stem & pitch job status |
| | `getPitchData` | Query | `{ trackId?: string }` | `PitchFrame[]` | Raw pitch frames for track |
| | `getRecords` | Query | `KaraokeGetRecordsInputSchema` | `KaraokeGetRecordsResponseSchema` | Retrieves track #1 record and leaderboard |
| | `submitRecord` | Mutation | `KaraokeSubmitRecordInputSchema` | `KaraokeSubmitRecordResponseSchema` | Submits score, combo, and rank |
| | `duetPartition` | Mutation | `DuetPartitionInputSchema` | `DuetPartitionResponseSchema` | Smule-style A/B/BOTH duet partitioning |
| **`presets`** | `getAll` | Query | None | `Preset[]` | All saved queue presets |
| | `save` | Mutation | `PresetSaveInputSchema` | `ApiResponseSchema` | Saves current queue as preset |
| | `load` | Mutation | `PresetLoadInputSchema` | `ApiResponseSchema` | Restores queue from preset |
| **`playlists`** | `getAll` | Query | None | `Playlist[]` | User playlists |
| | `getById` | Query | `{ id: string }` | `Playlist` | Fetches playlist with tracks |
| | `create` | Mutation | `PlaylistCreateInputSchema` | `Playlist` | Creates a new playlist |
| | `addTrack` | Mutation | `PlaylistAddTrackInputSchema` | `ApiResponseSchema` | Appends track to playlist |
| | `delete` | Mutation | `PlaylistDeleteInputSchema` | `ApiResponseSchema` | Removes playlist |
| | `search` | Query | `PlaylistSearchInputSchema` | `Playlist[]` | Searches public playlists |
| **`search`** | `tracks` | Query | `SearchInputSchema` | `SearchResultsResponseSchema` | Searches YouTube / SoundCloud |
| **`audit`** | `get` | Query | None | `AuditLogEntry[]` | Recent audit events |
| **`system`** | `setSettings` | Mutation | `SystemSettingsInputSchema` | `ApiResponseSchema` | Toggles persistence settings |

---

## 4. Building & Publishing

- **Build command**:
  ```bash
  cd voxaria-contracts
  npm run build
  ```
- **Output artifacts**: Emitted into `dist/` with `.js`, `.d.ts`, and source maps for CommonJS and ESM module targets.
- **Exports configured**:
  - `@voxaria/contracts` (all schemas, router, and errors)
  - `@voxaria/contracts/schemas`
  - `@voxaria/contracts/router`
  - `@voxaria/contracts/errors`
