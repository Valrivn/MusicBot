# Error Handling Audit — Voxaria Music Bot

## Overview

This document catalogs all known failure modes in the Voxaria Music Bot, their detection mechanisms, recovery strategies, and any gaps that need addressing.

## Failure Mode Matrix

### 1. Media Resolution Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **yt-dlp extraction fails** | `ytdlp` | Circuit breaker (yt-dlp), exception catch | Invidious → Piped → Local cache | Playback request fails gracefully |
| **YouTube rate limiting/blocking** | `ytdlp` | HTTP 429 / bot detection | Invidious instances, cookies refresh | Delayed playback |
| **Invidious instance down** | HTTP | Circuit breaker (HTTP), timeout | Rotate to next instance in list | No impact (transparent fallback) |
| **Piped instance down** | HTTP | Circuit breaker (HTTP), timeout | Rotate to next instance | No impact (transparent fallback) |
| **Live stream resolution** | `ytdlp` | Stream duration = 0 | Direct stream URL | Can't seek/stream buffering |
| **Geo-blocked content** | `ytdlp` | Error code 100/38 | Skip track, notify requester | Track skipped |

### 2. Audio Processing Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **FFmpeg decode error** | `ffmpeg` | Circuit breaker, stderr parse | Re-probe, retry once | Track skip or re-queue |
| **Corrupt audio file** | `ffmpeg` | ffprobe validation | Skip track, remove from cache | Track skip |
| **Demucs stem separation fails** | `demucs` | Circuit breaker, Python process exit code | Queue retry (BullMQ), noise reduction fallback | Karaoke unavailable for that track |
| **Demucs OOM** | `demucs` | Process killed, karaoke job failed | Queue retry with lower concurrency | Delayed karaoke |
| **karaoke worker crashes** | `bullmq` | Worker process exit, job stuck | BullMQ auto-retry, worker restart | Temporary karaoke outage |

### 3. Discord Connection Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **Voice disconnect** | Discord | `voiceStateUpdate`, player state check | Auto-reconnect, session restore | Queue pauses, resumes on reconnect |
| **Gateway disconnect** | Discord | `disconnect` event, heartbeat timeout | Auto-reconnect with exponential backoff | Brief bot unavailability |
| **Rate limited by Discord** | Discord | 429 responses | Wait & retry (built-in) | Delayed commands |
| **Member not in voice** | Discord | `member.voice.channel` = null | Return error to user | Command rejected |
| **Bot lacks VOICE_CONNECT perm** | Discord | Permission check | Log clear error | Command rejected |
| **Session restore failure** | `SessionRestore` | Restore timeout, guild not found | Safe shutdown | Queue not restored |

### 4. Database Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **SQLite lock** | `sqlite3` | `SQLITE_BUSY` error | Retry with backoff (WAL mode mitigates) | Brief API delay |
| **Database corrupt** | `sqlite3` | Failing queries, schema mismatch | Restore from WAL, backup | Data loss possible |
| **Disk full** | Node | ENOENT/ENOSPC errors | Trim cache, fail gracefully | Cache cleaning warning |
| **Migrate error** | Drizzle | Schema diff error | Rollback, log | Bot fails to start |

### 5. External API Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **Spotify API down** | HTTP | Circuit breaker, 5xx status | Skip metadata enrichment | Search results lack metadata |
| **Genius API down** | HTTP | Circuit breaker, 5xx status | Skip lyrics (empty state) | Lyrics unavailable |
| **MusicBrainz rate limit** | HTTP | 429 status | Cache with exponential backoff | Delayed metadata enrichment |
| **LRCLIB down** | HTTP | Circuit breaker, timeout | Genius fallback | Lyrics from alternate source |
| **YouTube API quota exhausted** | HTTP | 403 status | Invidious/Piped fallback | Search degraded |

### 6. Network Infrastructure

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **Redis outage** | `ioredis` | Connection error, health check | In-memory queue operations, degrade | Queue/persistence degraded |
| **Redis OOM** | `ioredis` | Connection refused | Reconnect, cache eviction | Brief cache loss |
| **Network partition** | `opossum` | Circuit breaker opens | Use cached data, local sources | External features degrade |
| **DNS failure** | HTTP | ENOTFOUND error | Circuit breaker, wait & retry | Temporary external API failure |

### 7. Application Failures

| Failure Mode | Error Class | Detection | Fallback | Impact |
|---|---|---|---|---|
| **OOM crash** | Node | Process exit, `osu` handler | Process manager restarts, session restore | Brief downtime |
| **Unhandled rejection** | Node | `unhandledRejection` handler | Log + continue | None (handler catches) |
| **Memory leak** | Node | Gradual memory growth, Prometheus metric | Restart, trim cache, GC hints | Slower performance |
| **JWT key missing** | `jose` | Cannot find private key | Auto-generate keys on boot | Auth unavailable until fixed |
| **Secrets not set** | Validation | `validate-env.js` fails | Show clear error message | Bot refuses to start |

## Recovery Strategies

### Automatic (No Human Intervention)
- BullMQ job retries (karaoke: 3 attempts with backoff)
- Circuit breaker auto-recovery (half-open → closed after success)
- Gateway/voice auto-reconnect
- SQLite WAL mode for crash recovery
- Session restore on restart (playlists, queue, position)
- Invidious/Piped instance rotation

### Manual (Documented Runbooks)
- Redis restart: `docker start <container>` or `redis-server`
- Karaoke worker restart: `npm run worker:karaoke`
- Database backup restore: `restore from voxaria.db-wal`
- Cache cleaning: `/clean-cache` command or API endpoint
- Demucs model reinstall: `pip3 install demucs`

## Monitoring Integration

All failure modes above have corresponding Prometheus metrics and Grafana alerts:

| Metric | Alert | Threshold |
|---|---|---|
| `voxaria_circuit_breaker_state` | `VoxariaCircuitBreakerOpen` | = 2 (open) for 1m |
| `voxaria_ytdlp_calls_total` | `VoxariaHighYtdlpFailureRate` | > 10% failures |
| `voxaria_ffmpeg_calls_total` | `VoxariaHighFfmpegFailureRate` | > 10% failures |
| `voxaria_discord_api_calls_total` | `VoxariaHighDiscordApiErrorRate` | > 5% failures |
| `voxaria_queue_depth` | `VoxariaQueueStuck` | > 0 with 0 players |
| `voxaria_karaoke_job_duration` | `VoxariaKaraokeJobDurationHigh` | P95 > 300s |

## Identified Gaps & Next Steps

| # | Gap | Recommendation | Priority |
|---|---|---|---|
| 1 | Demucs OOM kills cause partial cache corruption | Add file cleanup on failed job | High |
| 2 | No explicit handling for `yt-dlp` age restriction errors | Add age-restricted detection and graceful skip | Medium |
| 3 | Redis outage not monitored locally (only via `up{job="redis"}`) | Add Redis-specific health metric | Medium |
| 4 | No timeout on Demucs Python subprocess (can hang indefinitely) | Add kill timer (e.g., 15min max) | High |
| 5 | Voice disconnect auto-reconnect may loop infinitely | Add max reconnect attempts with backoff | Medium |
| 6 | Rate limiting (Redis token bucket) not yet implemented | Implement middleware for API endpoints | High |
| 7 | No disk space pre-check before Demucs download+separation | Add disk space check (need 1GB+ for stems) | Medium |
| 8 | MusicBrainz rate limit cache is memory-only | Move to Redis with TTL | Low |