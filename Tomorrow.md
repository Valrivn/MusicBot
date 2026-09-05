# Tomorrow — Voxaria Music Bot Finish Line

## What We Did Today (Sept 4, 2026) — ARCHITECTURAL FOUNDATION COMPLETE

### Core Architecture Implemented (8 Major Systems)

| # | System | Status | Key Deliverables |
|---|--------|--------|------------------|
| 1 | **SQLite + Drizzle ORM** | ✅ **DONE** | `voxaria.db` with WAL mode, 7 tables, 24 playlists migrated, type-safe queries |
| 2 | **MediaResolver Abstraction** | ✅ **DONE** | 4 sources (YouTube/Invidious/Piped/LocalCache), ffprobe probing, studio cut fingerprinting, 24hr cache |
| 3 | **tRPC + Zod Contracts** | ✅ **DONE** | `@voxaria/contracts` package (42 procedures, 9 routers), backend `/api/trpc`, frontend hooks, dual REST+tRPC |
| 4 | **Event-Sourced Queue** | ✅ **DONE** | `QueueEventStore` with snapshots every 50 events/5min, `PlayerCore` integration, undo API, restart survival |
| 5 | **BullMQ Karaoke Workers** | ✅ **DONE** | Async queue (concurrency=2), worker process, WebSocket progress (10→100%), Bull Board at `/admin/queues` |
| 6 | **JWT Authentication** | ✅ **DONE** | RS256 keys, 15min access / 7day refresh (HttpOnly), JWKS endpoint, auto-refresh frontend, token rotation |
| 7 | **Circuit Breakers + Observability** | ✅ **DONE** | 5 breakers (yt-dlp/FFmpeg/HTTP/Discord/Demucs) with fallbacks, Pino + correlation IDs, Prometheus `/metrics`, health endpoints |
| 8 | **Casbin Authorization** | ✅ **DONE** | Policy CSV (owner→admin→dj→vip→user), 36 endpoints migrated, admin API with hot reload, default-deny |

### Infrastructure & Configuration
- **Redis Setup** — Installed and verified for BullMQ (required for karaoke workers)
- **Environment Config** — Complete `.env` files for MusicBot (50+ vars) and Voxaria-Web (25+ vars) with validation script
- **Production Templates** — `.env.production.example` for both projects
- **Gitignore** — Verified `.env`, `keys/`, `*.pem` excluded in both projects
- **Railway Deployment** — Dockerfile, `railway.json` (web + worker services), persistent volume for SQLite, Redis plugin, health checks
- **Lovable Frontend** — Deployed at https://voxaria.lovable.app (auto-deploys from GitHub)

### Testing & Verification (Static)
- **Studio Cut Verification** — 2/3 test songs pass ±2s threshold (Never Gonna Give You Up ✅, Billie Jean ✅, Bohemian Rhapsody ⚠️ ±4s)
- **TypeScript** — Both projects compile clean (`npx tsc -b` passes)
- **Contract Audit** — 42/42 frontend hooks mapped to contract procedures, zero `any` types
- **Permission Matrix** — 5 roles × 10 actions documented (1 issue: DJ incorrectly inherits playlist:write via VIP hierarchy)

---

## What We Did Sept 5, 2026 — POLISH + INFRASTRUCTURE

### Bug Fixes (Priority 4 — ALL COMPLETED)
| # | Fix | File | Details |
|---|-----|------|---------|
| 1 | **DJ Permission Bug** | `MusicBot/policy.csv:33` | Changed `g, role:dj, role:vip` → `g, role:dj, role:user` — DJ no longer inherits VIP's `playlist:write` |
| 2 | **Queue Serialization** | `MusicBot/src/player/StatePersistence.js:80` | Added `currentTrackUrl` filter — deduplicates current track from queue array on save |
| 3 | **Karaoke Type Fix** | `MusicBot/src/trpc/router.ts:383` | Added `.output()` Zod schema + `PitchFrameSchema.parse()` runtime validation |

### Infrastructure Built
| # | System | Files | Details |
|---|--------|-------|---------|
| 4 | **Docker Compose** | `docker-compose.yml` | Redis 7 + MusicBot + Karaoke Worker (3 services) |
| 5 | **Voxaria-Web Dockerfile** | `Voxaria-Web/Dockerfile`, `nginx.conf` | Removed — frontend is on Lovable |
| 6 | **Ngrok Config** | `ngrok.yml` | Tunnel template for API (port 3002) |
| 7 | **Load Tests (k6)** | `tests/load-test.k6.js`, `tests/ws-load-test.k6.js` | HTTP + WebSocket load tests with custom metrics |
| 8 | **Load Tests (Artillery)** | `tests/load-test.artillery.yml`, `tests/artillery-processor.js` | tRPC batch-format artillery config |
| 9 | **README** | `README.md` | Full docs: architecture, API, deployment, troubleshooting |

### Config Updates
- **Frontend → Lovable**: Removed `vercel.json`, updated all `.env` files to point to `voxaria.lovable.app`
- **Frontend URL**: `FRONTEND_URL=https://voxaria.lovable.app` in MusicBot `.env` + production template
- **OAuth Redirect**: `VITE_DISCORD_REDIRECT_URI=https://voxaria.lovable.app/auth/callback`
- **Tomorrow.md**: Updated all Vercel references → Lovable

### Additional Production Hardening (Priority 3)
| # | System | Files | Details |
|---|--------|-------|---------|
| 10 | **Rate Limiting** | `src/auth/rate-limit.js`, `src/api/server.js`, routes | Redis-backed token bucket per user/IP (RATE_LIMIT_MAX=100/min, burst=20), fallback in-memory, specialized limiters for auth (20/min) + karaoke (30/min) + tRPC (300/min), metric recording |
| 11 | **Error Handling Audit** | `docs/error-handling-audit.md` | Full failure-mode matrix: 7 categories, 25+ failure modes, recovery strategies, 8 gaps identified |
| 12 | **Demucs cleanup** | `src/resilience/demucs-breaker.js` | Partial output cleanup on failed jobs (prevents corrupt cache polluting retries) |
| 13 | **Metrics bug fix** | `src/observability/metrics.js` | `recordFfmpegCall` was counting successes as errors → fixed to `success ? 'success' : 'error'` |
| 14 | **Rate limit metric** | `src/observability/metrics.js` | `voxaria_rate_limit_rejections_total` gauge + alert in prometheus-alerts.yml |

### Frontend ↔ Backend Connectivity Fixes (Sept 5 — AUDIT + FIXED)
| # | Blockers Found in Audit | Fix | Files |
|---|------------------------|-----|-------|
| 15 | `VITE_VOXARIA_API_BASE_URL` never defined (both `.env` files used `VITE_API_URL`); prod fell back to dead ngrok URL (404) | Added `VITE_VOXARIA_API_BASE_URL` + `VITE_VOXARIA_GUILD_ID` to `.env` + `.env.production.example`; removed ngrok fallback, now prefers `VITE_API_URL` then localhost:3002 | `Voxaria-Web/.env`, `.env.production.example`, `src/lib/voxaria-api.ts`, `src/lib/auth.ts` |
| 16 | `config.js` read `DISCORD_TOKEN`/`CLIENT_ID` but `.env` defines `DISCORD_BOT_TOKEN`/`DISCORD_CLIENT_ID`; no `clientSecret` → `/auth/discord` 500 | Discord block now maps `DISCORD_BOT_TOKEN`/`DISCORD_CLIENT_ID` with legacy fallbacks + added `clientSecret` | `MusicBot/config.js` |
| 17 | Missing routes: `/music/queue/clear`, `/discord/leave`, `/system/audio-cache/clean`, `/presets/create`, `/presets/delete`, `/music/playlist/add-track`, `/presets/:id/remove/:trackIndex`, `/presets/:id/import` | All 8 routes added (presets ops run against `presets.json` via existing read/write helpers) | `MusicBot/src/api/routes/music.js`, `system.js`, `presets.js`, `server.js` |
| 18 | `searchOnly` posted to `/music/search-only` (didn't exist) | Rewired `ENDPOINTS.searchOnly` → `/playlist/search` (returns `{results, count}`, normalizer already handles it) | `Voxaria-Web/src/lib/voxaria-api.ts` |
| 19 | Login button hit `GET /auth/discord` (backend only had POST) | Full browser OAuth flow: `GET /auth/discord` redirects to Discord → `GET /auth/discord/callback` exchanges code, sets HttpOnly refresh cookie, redirects to `FRONTEND_URL?login_status=success&user=` (frontend already parses this) | `MusicBot/src/api/server.js` |
| 20 | Logout posted `/auth/logout` (backend serves `/api/auth/logout`) | Fixed path + SameSite cookie `strict`→`none`(prod)/`lax`(dev) so cross-site Lovable↔ngrok/Railway auth works | `Voxaria-Web/src/pages/Index.tsx`, `MusicBot/src/api/server.js` |
| 21 | tRPC client used relative `/api/trpc` (resolved to Lovable domain); backend `createContext` import was undefined → crash on request | Client URL now `${BASE_URL}/api/trpc`; server guards `typeof createContext === 'function'` | `Voxaria-Web/src/lib/trpc/client.tsx`, `MusicBot/src/api/server.js` |
| 22 | CORS missing `localhost:8080`, hardcoded origins | Added `:8080` + env-driven `CORS_ORIGINS` | `MusicBot/src/api/server.js` |

**Verification:** `node --check` passes on all modified backend files; `voxaria-contracts` tsc build passes; `Voxaria-Web npm run build` passes. Full REST contract re-audit clean — every live frontend endpoint now maps to a real backend route.

---

## What's Left To Do Next Session

### Priority 1 — LIVE E2E TESTING (Requires Credentials & Infrastructure)
| Task | Details | Blockers |
|------|---------|----------|
| **Discord Bot E2E Playback** | Join voice → play YouTube URL → confirm audio streams → seek/volume/skip/stop work | Real Discord credentials (BOT_TOKEN, CLIENT_ID, CLIENT_SECRET, OWNER_ID) |
| **Studio Cut Live Verification** | Play songs with known remixes, verify actual audio is studio version via probe logs | Discord bot running + ngrok for OAuth |
| **Playlist Persistence Live Test** | Create playlist → add tracks → play → restart bot → verify survives | Discord bot + SQLite (ready) |
| **Multi-User OAuth Flow** | Sign in → see pfp → summon bot as non-owner → verify role permissions | Discord OAuth credentials + ngrok callback URL |

### Priority 2 — INFRASTRUCTURE FINALIZATION
| Task | Details | Status |
|------|---------|--------|
| **Redis Upgrade** | Docker Compose includes Redis 7 Alpine — just need Docker installed | ✅ Config ready, needs Docker on host |
| **Vercel → Lovable** | Frontend deployed at https://voxaria.lovable.app | ✅ MIGRATED — auto-deploys from GitHub |
| **Railway Deployment** | Push to Railway, provision Redis + volume, deploy web + worker services | ✅ Config ready — needs Railway credentials |
| **Ngrok Tunnel** | `ngrok http 3002` for API webhooks | ✅ Config ready — needs `ngrok.yml` authtoken |

### Priority 3 — PRODUCTION HARDENING
| Task | Details | Status |
|------|---------|--------|
| **Load Testing** | k6/artillery scripts for concurrent search/request/karaoke/WS load | ✅ Created in `tests/` |
| **README** | Document setup, configuration, API reference, deployment | ✅ Created at root |
| **Circuit Breaker Tuning** | Adjust thresholds based on load test results | ⏳ Run load tests first |
| **Grafana Dashboard** | Import metrics dashboard, set alert rules | ⏳ Grafana JSON exists in `tests/grafana-dashboard.json` |
| **Error Handling Audit** | Document failure modes: yt-dlp fail, demucs crash, voice disconnect, concurrent play | ✅ Done — `docs/error-handling-audit.md` (7 categories, 25+ modes, 8 gaps) |
| **Rate Limiting** | Token bucket per user/IP (Redis-backed) | ✅ Done — `src/auth/rate-limit.js`, specialized limiters, metrics + alerts |

### Priority 4 — POLISH ✅ **ALL COMPLETED THIS SESSION**
| Task | Details | Status |
|------|---------|--------|
| **Fix DJ Permission Bug** | Remove `g, role:dj, role:vip` from policy.csv or restructure hierarchy | ✅ DONE — DJ now inherits from user only |
| **Queue Serialization Fix** | Filter `currentTrack` from queue array in `StatePersistence.serializeState()` | ✅ DONE — Added filter in serializeState() |
| **Karaoke Type Fix** | `karaoke.getPitchData` returns `PitchFrame[]` not `PitchMap` — add runtime validation | ✅ DONE — Added output schema + PitchFrameSchema.parse() validation |

---

## Quick Reference

### How to Start Everything (Local Development)
```powershell
# Terminal 1: Redis (Docker recommended)
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: API Bridge + Bot
cd C:\Bot\MusicBot; node index.js

# Terminal 3: Karaoke Worker
cd C:\Bot\MusicBot; npm run worker:karaoke

# Terminal 4 (optional): Ngrok for API webhooks
ngrok http 3002
# Update Discord OAuth redirect URI to ngrok URL + /auth/callback
```

### Key Commands
```powershell
# Kill and restart bot
Get-Process -Name node | Stop-Process -Force; Start-Sleep 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Bot\MusicBot; node index.js"

# Validate environment
cd C:\Bot\MusicBot; node scripts/validate-env.js

# Test endpoints
Invoke-WebRequest -Uri "http://localhost:3002/health/live" -Method GET
Invoke-WebRequest -Uri "http://localhost:3002/metrics" -Method GET
Invoke-WebRequest -Uri "http://localhost:3002/admin/queues" -Method GET
```

### API & Services
- **API Base**: `http://localhost:3002` (local) / Railway URL (production)
- **tRPC Endpoint**: `http://localhost:3002/api/trpc`
- **WebSocket Karaoke**: `ws://localhost:3002/ws/karaoke?guildId=<id>`
- **Bull Board**: `http://localhost:3002/admin/queues`
- **Prometheus Metrics**: `http://localhost:3002/metrics`
- **Health Checks**: `/health/live`, `/health/ready`, `/health`

### Ngrok
- **Current**: `https://unhitched-shrink-dorsal.ngrok-free.dev` (may need renewal)
- **Frontend (Lovable)**: No ngrok needed — Lovable handles HTTPS
- **API**: `ngrok http 3002` for webhooks → update Discord OAuth redirect URI in Lovable

### GitHub
- **Repo**: `https://github.com/Valrivn/Muscibot.git`

### Deployment Targets
- **Backend**: Railway (web + karaoke-worker services)
- **Frontend**: Lovable (https://voxaria.lovable.app)
- **Database**: SQLite on Railway persistent volume (`/app/data/voxaria.db`)
- **Cache**: Railway Redis plugin

---

## Credentials Needed (Fill in `.env` files)

### MusicBot (`C:\Bot\MusicBot\.env`)
```env
DISCORD_BOT_TOKEN=          # From Discord Developer Portal
DISCORD_CLIENT_ID=          # From Discord Developer Portal
DISCORD_CLIENT_SECRET=      # From Discord Developer Portal
DISCORD_OWNER_ID=           # Your Discord user ID (right-click → Copy ID)
SPOTIFY_CLIENT_ID=          # https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_SECRET=      # https://developer.spotify.com/dashboard
GENIUS_CLIENT_ID=           # https://genius.com/api-clients
GENIUS_CLIENT_SECRET=       # https://genius.com/api-clients
YOUTUBE_API_KEY=            # https://console.cloud.google.com/apis/credentials (optional)
```

### Voxaria-Web (`C:\Bot\Voxaria-Web\.env`)
```env
VITE_DISCORD_CLIENT_ID=     # Same as above
VITE_DISCORD_REDIRECT_URI=  # https://voxaria.lovable.app/auth/callback (Lovable production)
```

---

---

## Resume Checklist for Next Session
- [ ] Fill real credentials in both `.env` files (Discord token, client ID, secret, owner ID)
- [ ] Install Docker Desktop and run `docker-compose up -d` (brings up Redis + services)
- [ ] Add authtoken to `ngrok.yml` and start `ngrok start api`
- [ ] Update Discord OAuth redirect URI to ngrok URL + `/auth/callback`
- [ ] Start the bot (Redis, Bot, Worker)
- [ ] Run Priority 1 E2E tests (playback, karaoke, playlists, OAuth)
- [ ] Deploy to Railway (backend only)
- [ ] Run load tests (`k6 run tests/load-test.k6.js`) & tune circuit breakers