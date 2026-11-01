# `Voxaria-Web/src/lib/api/` — Modular REST API Client Layer

## Functional Role
Type-safe REST API client layer communicating with the Voxaria backend and music bot service. Encapsulates HTTP transport, Bearer token injection, request batching, and schema typing across distinct domain verticals (playback, queue, karaoke, presets, metrics, and system configuration).

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `auth-client.ts` | Base API transport; provides `apiFetch`, Bearer authorization injection, error handling, and core DTO type declarations. | `apiFetch`, `setAuthToken`, `getAuthToken`, types `ApiTrack`, `ApiStatus`, `ApiCache`, `ApiSettings`, `ApiPlayer`, `ApiPreset`, `ApiAuditTrack`, etc. | `@/lib/auth` |
| `index.ts` | Consolidated barrel exposing all sub-APIs unified under the `voxariaApi` facade object, plus type re-exports. | `voxariaApi`, re-exports of all domain APIs | `./auth-client`, `./player`, `./queue`, `./search-library`, `./presets-playlists`, `./karaoke`, `./system-settings`, `./metrics-audit` |
| `karaoke.ts` | Karaoke operations; synchronized lyrics retrieval, vocal stem toggles, pitch map generation, and server battle record persistence. | `karaokeApi`, types `KaraokeRecord`, `ServerRecordsResponse`, `LyricsLine`, `PitchMapData` | `./auth-client` |
| `metrics-audit.ts` | Observability client; fetches latency histograms, system stats, and playback audit logs. | `metricsAuditApi` | `./auth-client` |
| `player.ts` | Music playback controls; handles play/pause state, track skipping, seek positions, volume modification, and previous track jumps. | `playerApi` | `./auth-client` |
| `presets-playlists.ts`| Preset and playlist lifecycle; save/load queue presets, import external playlists, and manage custom tracklists. | `presetsPlaylistsApi` | `./auth-client` |
| `queue.ts` | Queue management; queue retrieval, track addition/requests, reordering, shuffling, individual item removal, and queue clearing. | `queueApi` | `./auth-client` |
| `search-library.ts` | Search operations; query local audio files and external platforms (YouTube, SoundCloud) with caching. | `searchLibraryApi` | `./auth-client` |
| `system-settings.ts`| Discord bot system operations; shard status, audio cache cleanup, guild summon, and voice channel disconnect. | `systemSettingsApi` | `./auth-client` |

## Common Error Scenarios & Troubleshooting Tips
- **HTTP 401 Unauthorized**: Occurs when access token in `localStorage` has expired and automatic refresh in `auth.ts` fails. Handled by redirecting to auth flow or presenting login dialog.
- **Backend Offline / Network Refusal (`ECONNREFUSED`)**: `apiFetch` throws descriptive error messages with endpoint path and status. UI components should wrap queries in `try/catch` or rely on React Query's `isError` status.
- **Out-of-Sync Player Position**: `ApiPlayer` delivers both `currentPositionMs` and `serverTimestampMs`. Client drift should be corrected against `Date.now() - serverTimestampMs`.
- **CORS Errors**: Ensure backend server exposes matching origins (`localhost:5173`, `localhost:8080`, `voxaria.lovable.app`).

## Upstream / Downstream Dataflow
- **Upstream**: Ingests auth tokens and session data from `@/lib/auth` and target server URL from environment settings.
- **Downstream**: Supplies data endpoints and mutation triggers to React Query hooks, `Index.tsx`, `AuditLogViewer.tsx`, and `ServerBattleModal.tsx`.
