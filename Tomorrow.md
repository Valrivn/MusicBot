# Tomorrow — Voxaria Music Bot: State + Tomorrow's Plan

> **Last session: Sept 13, 2026** — Full-stack connectivity fixes, auth token unification, tRPC AI router, orchestrator integration, crash-resilient launchers, committed & pushed to `master` (`<new-commit-hash>`).

---

## What We Did Sept 13, 2026 — FULL-STACK CONNECTIVITY RESTORED

### 1. Frontend Auth & tRPC Unification (COMPLETED ✅)
- **`accessToken` ReferenceError Fixed:** Unified token management in `voxaria-dashboard/src/lib/auth.ts` — single source of truth with `getAccessToken()`/`setAccessToken()` syncing to `localStorage`.
- **Discord OAuth Token Preservation:** `loginWithDiscord()` now stores `access_token`; `Index.tsx` delegates to `auth.ts` instead of inline fetch.
- **tRPC Client Consolidation:** Created shared `trpc-client.ts`; both `trpc.ts` (React Query) and `voxaria-api.ts` now use the same instance with centralized auth headers.
- **WebSocket JWT Passing:** `useKaraokeWS` now receives valid token via `getAccessToken()`; WS connection no longer aborts on `undefined`.
- **Environment Alignment:** `trpc.ts` reads `VITE_TRPC_URL` (matches `.env`); Vite dev proxy added for `/api` and `/ws` → `localhost:3002`.

### 2. Backend Hardening Verified (COMPLETED ✅)
- **CORS/Preflight:** Dynamic origin matching (`*.lovable.app`, `*.ngrok-free.dev`, `localhost:*`); `allowedHeaders` includes `guild-id`, `x-user-username`, `ngrok-skip-browser-warning`, etc.; `maxAge: 86400`.
- **Policy Fix:** `/system/audio-cache` 403 resolved — `policy.csv` already grants `role:user, settings, read`.
- **Pitch-Map Endpoint:** `/music/pitch-map` alias already exists in `karaoke.js` forwarding to `/karaoke/pitch-data`.
- **Database Bootstrap:** `src/db/index.js` has idempotent `BOOTSTRAP_DDL` (6 tables) — fresh deploys get schema automatically.
- **Redis Config:** `.env` uses `REDIS_PORT=6379`; both `rate-limit.js` and `karaoke-queue.js` support `REDIS_URL` fallback for Railway.

### 3. Middleware/Orchestrator Integration (COMPLETED ✅)
- **PM2 Management:** `ecosystem.config.js` includes `voxaria-orchestrator` (port 3001) with log rotation, restart policy.
- **ModelRouter.recordResult() Wired:** `/api/route` now calls `recordResult()` on success/failure — `activeRequests` decrements, health tracking works.
- **Task TTL & Auto-Fail:** `ParallelCoordinator` has 10-min TLD; tasks stuck in `running` now auto-fail with `status: 'failed'`.
- **tRPC AI Router:** New `ai` router in `@voxaria/contracts` with `models.getAll`, `models.route`, `tasks.dispatch`, `tasks.getStatus`, `tasks.getResult` — proxies to orchestrator via `MusicBot/src/orchestrator.js`.
- **WS Browser Auth:** Orchestrator WS accepts `?token=` query param (browsers can't set headers on `new WebSocket()`).

### 4. Launcher Scripts Hardened (COMPLETED ✅)
- **`C:\Bot\start.bat`**: Interactive menu + CLI args (`--musicbot`, `--orchestrator`, `--both`, `--pm2`, `--status`); crash loop with 5s restart delay; prerequisite checks (Node, Redis, `.env`); orphan DB cleanup (`C:\Bot\voxaria.db`); colored output.
- **`C:\Bot\run.bat`**: One-click quick start — Orchestrator in new window, MusicBot in current window with crash loop.
- **`C:\Bot\MusicBot\start.bat`**: Same hardening applied; consistent branding.

---

## 🚧 What We Are Working On Right Now

1. **tRPC End-to-End Verification:** Testing `voxaria-dashboard` (`https://voxaria.lovable.app`) against live ngrok backend (`https://unhitched-shrink-dorsal.ngrok-free.dev/api/trpc?batch=1`) — player polling, queue, playlists, karaoke WS.
2. **WebSocket Real-time Sync:** Verifying karaoke WS connection with JWT token auth (`wss://unhitched-shrink-dorsal.ngrok-free.dev/ws/karaoke`).
3. **Orchestrator AI Routing:** Confirm `/api/route` → model selection → `recordResult()` health tracking works end-to-end.

---

## Today's Stack State (READY TO RUN)

```powershell
# Terminal 1: Redis (if not already running)
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: Full stack via PM2 (daemon mode)
cd C:\Bot\MusicBot
pm2 start ecosystem.config.js
pm2 status
# Expected: voxaria-api (3002), voxaria-karaoke, voxaria-orchestrator (3001) all online

# Terminal 3: Ngrok tunnel
C:\Bot\ngrok.exe http 3002 --url=https://unhitched-shrink-dorsal.ngrok-free.dev

# Terminal 4: Health checks
curl https://unhitched-shrink-dorsal.ngrok-free.dev/health/live -H "ngrok-skip-browser-warning: true"
curl -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" http://localhost:3001/api/health
```

**Or use the hardened launcher (keeps terminal open on crash):**
```powershell
C:\Bot\start.bat
# Select option 3 (Both services) or 4 (PM2 daemon)
```

---

## 🎯 Tomorrow's Action Plan (priority order)

### P0 — End-to-End Verification (Lovable ↔ ngrok ↔ backend)
- [ ] Confirm tRPC client calls from `voxaria-dashboard` (login, queue get, playback, presets, audit log)
- [ ] Confirm REST endpoints return 200 with proper CORS headers for `https://voxaria.lovable.app`
- [ ] Test WebSocket karaoke connection (`wss://unhitched-shrink-dorsal.ngrok-free.dev/ws/karaoke?guildId=...&token=<jwt>`) — real-time pitch progress events
- [ ] Verify orchestrator AI routing: `ai.models.route` → `/api/route` → `recordResult()` updates model health

### P1 — Server & Config Hardening
- [ ] Set `ORCHESTRATOR_API_KEY` in production environment (Railway/Vercel)
- [ ] Decide `voxaria-dashboard/` repo placement (tracked vs sub-repo)
- [ ] Add `ORCHESTRATOR_URL` to `MusicBot/.env.production` (currently only in `.env.production.example`)

### P2 — Observability & Reliability
- [ ] Add structured logging correlation IDs across MusicBot → Orchestrator calls
- [ ] Implement orchestrator task persistence to Redis (survive restarts)
- [ ] Add `/health/ready` probe for orchestrator in MusicBot's `health.js`

### P3 — GitHub Release Preparation
- [ ] Final `git status` + secret scan: `git ls-files | Select-String "\.env|\.pem|\.db"`
- [ ] Add deployment setup documentation to `README.md`
- [ ] Tag release `v1.0.0-rc.1` with changelog

---

## Quick Reference

### Start Everything (PM2 Daemon Mode)
```powershell
# Terminal 1: Redis
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: PM2 (starts bot + karaoke worker + orchestrator + logrotate)
cd C:\Bot\MusicBot
pm2 start ecosystem.config.js
pm2 logs

# Terminal 3: Ngrok
C:\Bot\ngrok.exe http 3002 --url=https://unhitched-shrink-dorsal.ngrok-free.dev

# Terminal 4: Health Check
curl https://unhitched-shrink-dorsal.ngrok-free.dev/health/live -H "ngrok-skip-browser-warning: true"
curl -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" http://localhost:3001/api/health
```

### Start Everything (Interactive / Debug Mode)
```powershell
# Single command - keeps terminals open on crash
C:\Bot\start.bat
# → Select option 3 for both services in separate windows
# → Or option 4 for PM2 daemon mode
```

### One-Click Quick Start
```powershell
C:\Bot\run.bat
# Opens Orchestrator in new window, runs MusicBot here with auto-restart
```