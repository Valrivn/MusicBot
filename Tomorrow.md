# Tomorrow — Voxaria Music Bot: State + Tomorrow's Plan

> **Last session: Sept 9, 2026** — Log cleanup completed, PM2 logrotate installed, parallel 5-file audit completed, stack verification in progress.

---

## What We Did Sept 9, 2026 — LOG CLEANUP + PARALLEL AUDIT

### 1. P0 Log Cleanup & PM2 Log Rotation (COMPLETED ✅)
- **Deleted rotated oversized logs:** Cleaned up `worker-error-1__*.log` files in `C:\Bot\MusicBot\logs\` freeing ~2 GB of disk space (previous session 94GB total split log risk cleared).
- **Truncated active error log:** `C:\Bot\MusicBot\logs\worker-error-1.log` truncated to **0 bytes**.
- **Installed log rotation:** Successfully installed and started `pm2-logrotate` module (PM2 Module ID 0 online).

### 2. Parallel Deep Audit (5 Core Files & Testing Readiness ✅)
Dispatched parallel exploration subagents (`gemini-worker` + `bigpickle-worker`) to review the 5 most critical codebase files:
- **`MusicBot/src/api/server.js`:** Express tRPC middleware correctly mounted on `/api/trpc` using `createExpressMiddleware`. *Audit note:* Needs `app.set('trust proxy', 1)` so ngrok traffic isn't rate-limited under single local IP.
- **`voxaria-contracts/src/router.ts`:** tRPC procedure guards (`publicProcedure`, `protectedProcedure`, `ownerProcedure`) properly wrap state-mutating endpoints. *Audit note:* `auth.discord` is a stub; production auth flows through Discord OAuth.
- **`voxaria-contracts/src/context.ts`:** Resolves Bearer JWT tokens dynamically and attaches `user`, `client`, and `guildId`.
- **`voxaria-orchestrator/src/server.js`:** API keys validated using timing-safe pre-checked comparisons (`crypto.timingSafeEqual`).
- **`MusicBot/src/db/`:** Refresh tokens stored hashed with WAL mode enabled. *Audit note:* Database path `DATABASE_PATH` should be absolute to avoid launching empty root databases when cwd changes.

---

## 🚧 What We Are Working On Right Now

1. **tRPC End-to-End Verification:** Testing the `voxaria-dashboard` client (`https://voxaria.lovable.app`) against the live ngrok backend (`https://unhitched-shrink-dorsal.ngrok-free.dev/api/trpc?batch=1`).
2. **Trust Proxy & Proxy Headers:** Adding `app.set('trust proxy', 1)` to Express to prevent rate-limit IP collisions behind ngrok.
3. **Database Path Hardening:** Ensuring absolute database resolution for SQLite tables (`voxaria.db`).

---

## Today's Stack State (currently RUNNING)

```powershell
pm2 status                      # pm2-logrotate (online)
# ngrok tunnel UP: https://unhitched-shrink-dorsal.ngrok-free.dev -> localhost:3002
```

---

## 🎯 Tomorrow's Action Plan (priority order)

### P0 — End-to-End Verification (Lovable ↔ ngrok ↔ backend)
- [ ] Confirm tRPC client calls from `voxaria-dashboard` (login, queue get, playback)
- [ ] Confirm REST endpoints return 200 with proper CORS headers for `https://voxaria.lovable.app`
- [ ] Test WebSocket karaoke connection (`wss://unhitched-shrink-dorsal.ngrok-free.dev`) with JWT

### P1 — Server & Config Hardening
- [ ] Add `app.set('trust proxy', 1)` in `MusicBot/src/api/server.js`
- [ ] Set `ORCHESTRATOR_API_KEY` env var in production environment
- [ ] Decide `voxaria-dashboard/` repo placement (tracked vs sub-repo)

### P2 — GitHub Release Preparation
- [ ] Final `git status` + secret scan: `git ls-files | Select-String "\.env|\.pem|\.db"`
- [ ] Add deployment setup documentation to `README.md`

---

## Quick Reference

### Start Everything
```powershell
# Terminal 1: Redis
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: PM2 (starts bot + karaoke worker + logrotate)
cd C:\Bot\MusicBot; pm2 start ecosystem.config.js

# Terminal 3: Ngrok
C:\Bot\ngrok.exe http 3002 --url=https://unhitched-shrink-dorsal.ngrok-free.dev

# Terminal 4: Health Check
curl https://unhitched-shrink-dorsal.ngrok-free.dev/health/live -H "ngrok-skip-browser-warning: true"
```
