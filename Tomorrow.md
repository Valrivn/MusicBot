# Tomorrow — Voxaria Music Bot: State + Tomorrow's Plan

> **Last session: Sept 8, 2026** — Security audit + hardening + tRPC auth fully wired. Stack is RUNNING.

---

## What We Did Sept 8, 2026 — SECURITY AUDIT + FULL tRPC AUTH

### Audit performed (3 parallel agents: gemini-worker, bigpickle-worker, general)
Covered: ngrok tunnel config, Lovable frontend chain, backend auth/session/API security, secrets & `.env` exposure, git tracking of secrets.

### Commits created today
| Commit | Contents |
|--------|----------|
| `27b5e0d` | **Security hardening** — orchestrator shared-secret API key auth (timingSafeEqual), CORS lockdown to Lovable+localhost, WS auth via Authorization header (no query-string key leak), security headers, fail-fast key policy in prod; fixed command injection in SkillExecutor (exec→execFile); MusicBot optionalAuth/tRPC no longer trust spoofable `x-user-id`/`x-user-username` headers; refresh token removed from JSON body in prod; CSRF origin guard on refresh+OAuth; `rotateRefreshToken` in better-sqlite3 transaction (race-safe); WAL mode on auth.db; owner ID → `DISCORD_OWNER_ID` env; removed hardcoded `OWNER_API_KEY="owner"` from both frontends; gitignore hardening + untracked runtime state files |
| `c09297c` | **tRPC auth wired into `@voxaria/contracts`** (single source of truth) — `createContext` resolves Bearer JWT via injected `verifyToken`; `protectedProcedure` (role≥1), `staffProcedure` (role≥2), `ownerProcedure` (role≥3) throw TRPCError; 4 privileged procedures upgraded (bot.cleanCache=staff, bot.updateSessionRestore=owner, **bot.setRole=owner** — closed self-escalation hole, system.updateSettings=owner); deleted dead `MusicBot/src/trpc/` (874 lines); server.js switched from `fetchRequestHandler` (crashes on Express relative req.url in tRPC v11) → `createExpressMiddleware` |

### Verified live (Sept 8)
- ✅ Orchestrator: `POST /api/route` without key → **401**; injection attempt `'user/repo; calc.exe'` → **blocked**
- ✅ tRPC guards: GUEST→`bot.setRole` **FORBIDDEN**, USER→`bot.cleanCache` **FORBIDDEN**, OWNER→allowed (input validation reached)
- ✅ `voxaria-contracts` build + typecheck clean; `node --check` clean on all server files
- ✅ Stack running: PM2 `voxaria-api` (port 3002) + `voxaria-karaoke` online; ngrok tunnel `https://unhitched-shrink-dorsal.ngrok-free.dev` → localhost:3002 **UP**
- ✅ Through ngrok: `GET /health/live` → **200**
- ✅ CORS from Lovable origin: `Access-Control-Allow-Origin: https://voxaria.lovable.app`, `Credentials: true`, `Vary: Origin` — all correct
- ⚠️ **tRPC through ngrok returned `"No procedure found on path """`** for a raw POST — payload was NOT the real tRPC client format (likely wrong body/query shape). **Still needs verification with the actual dashboard client.** See tomorrow P0.

---

## ⚠️ CRITICAL — Verify tRPC with the REAL Dashboard Client (P0)

The tRPC endpoint must be exercised by the actual Lovable/`voxaria-dashboard` client, not curl. Likely causes for the `No procedure found` blip (investigate in order):
1. **Payload format** — tRPC v11 expects `?batch=1` query + `{"json":...}` body with proper procedure paths. My raw test may not have matched.
2. **`createExpressMiddleware` prefix** — check that the mount at `/api/trpc` + `endpoint` config matches what the client sends.
3. Test plan:
   - Open `https://voxaria.lovable.app` → log in via Discord → play a song → verify queue/status render.
   - Watch `pm2 logs voxaria-api --lines 20` for tRPC errors (`❌ tRPC error on ...`).
   - If needed, `node -e` with the real `@voxaria/contracts` client from `voxaria-dashboard` against `https://unhitched-shrink-dorsal.ngrok-free.dev/api/trpc?batch=1`.

---

## 🔧 URGENT OPERATIONAL ITEM — 94 GB Log File

- `C:\Bot\MusicBot\logs\worker-error-1.log` is **~94 GB** (`94081461437` bytes). Disk space risk!
- Action: stop karaoke worker → truncate/delete the log → investigate what errored repeatedly (likely the karaoke/demucs stub loop) → restart worker.
- Also consider `pm2` log rotation: `pm2 install pm2-logrotate` (max_size 50M, retain 10).

---

## Today's Stack State (currently RUNNING — do not re-start blindly)

```powershell
pm2 status                      # voxaria-api (online) + voxaria-karaoke (online)
# ngrok tunnel UP: https://unhitched-shrink-dorsal.ngrok-free.dev -> localhost:3002
```

---

## 🎯 Tomorrow's Action Plan (priority order)

### P0 — Verify the full Lovable ↔ ngrok ↔ backend chain end-to-end
- [ ] Fix/confirm tRPC client calls (see CRITICAL above) — login, queue get, playback, presets save, karaoke prep
- [ ] Confirm REST endpoints used by dashboard (music/history, playlists, auth/session) return 200 through ngrok with Lovable Origin
- [ ] Confirm WebSocket (karaoke progress) connects through `wss://unhitched-shrink-dorsal.ngrok-free.dev` with JWT auth
- [ ] Run `verify-pipeline.ps1` (exists at repo root, untracked — review it first)

### P1 — Config & operational hardening
- [ ] Generate + set `ORCHESTRATOR_API_KEY` env var (server **fails fast in production** without it; dev generates ephemeral key)
- [ ] Optionally set `DISCORD_OWNER_ID` in `MusicBot/.env` (owner override for hardcoded default)
- [ ] Cull the 94 GB `worker-error-1.log`; install `pm2-logrotate`
- [ ] Decide `voxaria-dashboard/` repo status: it's **entirely untracked** in this repo (`?? voxaria-dashboard/`) — either `git add` it here, or keep it as its own GitHub repo (currently `Valrivn/voxaria-dashboard-ca90559f`)

### P2 — GitHub-public readiness (repo will be shared for private self-hosting)
- [ ] Final `git status` + secret scan before any push: `git ls-files | Select-String "\.env|\.pem|\.db|keys/|credentials"` should return only `.example` placeholders
- [ ] Review remaining untracked: `.opencode/` (tooling — likely keep out), `verify-pipeline.ps1` (decide include or delete)
- [ ] `MusicBot/database/*.json` runtime files are now untracked (committed deletion in `27b5e0d`) — confirm they regenerate on boot (already verified: bot boots fine)
- [ ] Consider adding a `README` note: "set `ORCHESTRATOR_API_KEY`, `DISCORD_OWNER_ID`, real Discord creds in `.env`"

### P3 — Remaining from previous sessions (not yet done)
- [ ] **Discord OAuth redirect URI**: register `https://unhitched-shrink-dorsal.ngrok-free.dev/auth/discord/callback` in Discord Developer Portal (needed for the Lovable login flow)
- [ ] **PM2 Windows Service** (auto-start on reboot): `pm2-service-install -n "VoxariaMusicBot"` as admin
- [ ] **Auto-start script** for ngrok on reboot (ngrok dies on reboot — see Quick Reference for the exact command)
- [ ] E2E playback tests (join voice → play YouTube → seek/volume/skip/stop), studio-cut verification, playlist persistence across restart, second-user role permissions
- [ ] Karaoke unison design (bot streams instrumental over Discord voice; web syncs lyrics to bot clock)

---

## Quick Reference (rates as of Sept 8 — VERIFIED)

### Start everything
```powershell
# Terminal 1: Redis (Docker recommended)
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: PM2 (starts bot + karaoke worker)
cd C:\Bot\MusicBot; pm2 start ecosystem.config.js

# Terminal 3: Ngrok (API tunnel)
C:\Bot\ngrok.exe http 3002 --url=https://unhitched-shrink-dorsal.ngrok-free.dev
# (real authtoken lives at C:\Users\Hayden\AppData\Local\ngrok\ngrok.yml — repo ngrok.yml has placeholder)

# Terminal 4: Verify
curl https://unhitched-shrink-dorsal.ngrok-free.dev/health/live -H "ngrok-skip-browser-warning: true"
```

### PM2
```powershell
pm2 status | pm2 logs voxaria-api | pm2 restart all | pm2 stop all | pm2 delete all
```

### API surface (through ngrok)
- API base: `https://unhitched-shrink-dorsal.ngrok-free.dev` / local `http://localhost:3002`
- tRPC: `.../api/trpc` (now `createExpressMiddleware` + JWT verify → `protected/staff/owner` guards)
- Health: `/health/live`, `/health/ready` (public); `/metrics`, `/admin/queues` — **verify still reachable / intended exposure**
- Orchestrator (port 3001): write endpoints + WS require `ORCHESTRATOR_API_KEY`

### Git
- Repo: `C:\Bot` (master) — remote `Valrivn/MusicBot.git`
- Last commits: `27b5e0d` (hardening), `c09297c` (contracts tRPC auth)
- **Uncommitted right now:** only `Tomorrow.md` (this file) + untracked `voxaria-dashboard/`, `.opencode/`, `verify-pipeline.ps1` — commit/decide these tomorrow

---

## Resume Checklist (next session, in order)
1. [ ] Verify tRPC via real dashboard client through ngrok (P0) — fix if `No procedure found`
2. [ ] Cull 94 GB karaoke log; install pm2-logrotate
3. [ ] Commit/decide `voxaria-dashboard/` repo placement
4. [ ] Set `ORCHESTRATOR_API_KEY` + optional `DISCORD_OWNER_ID`
5. [ ] Pre-public GitHub secret scan (git ls-files audit)
6. [ ] Register Discord OAuth redirect URI (ngrok callback)
7. [ ] PM2 Windows service + ngrok auto-start on reboot
8. [ ] E2E playback + permissions testing