# Voxaria Music Bot

A production-ready Discord music bot with karaoke, playlists, lyrics, and a modern web dashboard.

## Features

- **Multi-source playback**: YouTube, Invidious, Piped, SoundCloud, direct links
- **Karaoke support**: Stem separation (Demucs), pitch detection, real-time WebSocket streaming
- **Playlist management**: Create, share, and manage playlists with persistence
- **Lyrics display**: Synced and plain lyrics from multiple sources
- **Event-sourced queue**: Undo/redo, crash recovery, snapshot-based persistence
- **Role-based access**: Casbin authorization (Owner → Admin → DJ → VIP → User)
- **Observability**: Prometheus metrics, Pino logging, circuit breakers, health checks
- **Modern web dashboard**: React + TypeScript + Tailwind + tRPC (deployed on Lovable)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Discord       │────▶│   MusicBot       │────▶│   Lavalink/     │
│   Gateway       │     │   (Node.js)      │     │   FFmpeg        │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  SQLite  │ │  Redis   │ │  BullMQ  │
              │ (Drizzle)│ │ (BullMQ) │ │ Workers  │
              └──────────┘ └──────────┘ └──────────┘
                    ▲            ▲
                    │            │
              ┌──────────┐ ┌──────────┐
              │  tRPC    │ │  WebSocket│
              │  API     │ │  (Karaoke)│
              └──────────┘ └──────────┘
                    ▲            ▲
                    └────────────┘
                         │
                    ┌────────────┐
                    │  Voxaria-Web│
                    │  (Lovable)  │
                    └────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Redis)
- Discord Bot Token
- Spotify API credentials (optional)
- Genius API credentials (optional)

### Local Development

```bash
# 1. Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# 2. Configure environment
cp MusicBot/.env.example MusicBot/.env
# Edit MusicBot/.env with your credentials

# 3. Start the bot
cd MusicBot
npm install
npm start

# 4. Start karaoke worker (separate terminal)
npm run worker:karaoke

# 5. (Optional) Expose API for Lovable frontend
ngrok http 3002
# Update Discord OAuth redirect URI to: https://your-ngrok-url.ngrok-free.app/auth/callback
```

### Frontend (Voxaria-Web)

The frontend is deployed on **Lovable** at https://voxaria.lovable.app

For local development:
```bash
cd Voxaria-Web
npm install
npm run dev
```

## Environment Variables

### MusicBot (`MusicBot/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application ID from Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | Yes | Client secret from Discord Developer Portal |
| `DISCORD_OWNER_ID` | Yes | Your Discord User ID (for owner commands) |
| `PORT` | No | API port (default: 3002) |
| `FRONTEND_URL` | No | CORS origin (default: https://voxaria.lovable.app) |
| `REDIS_HOST` | No | Redis host (default: localhost) |
| `REDIS_PORT` | No | Redis port (default: 6379) |
| `DATABASE_PATH` | No | SQLite path (default: ./voxaria.db) |
| `JWT_PRIVATE_KEY_PATH` | No | RSA private key path (auto-generated) |
| `JWT_PUBLIC_KEY_PATH` | No | RSA public key path (auto-generated) |
| `SPOTIFY_CLIENT_ID` | No | Spotify API client ID |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify API client secret |
| `GENIUS_CLIENT_ID` | No | Genius API client ID |
| `GENIUS_CLIENT_SECRET` | No | Genius API client secret |
| `YOUTUBE_API_KEY` | No | YouTube Data API v3 key |
| `COOKIES_FILE` | No | Path to cookies.txt for YouTube |
| `DEMUCS_MODEL` | No | Demucs model (default: htdemucs) |
| `KARAOKE_CONCURRENCY` | No | Max concurrent karaoke jobs (default: 2) |

### Voxaria-Web (`Voxaria-Web/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | MusicBot API URL |
| `VITE_TRPC_URL` | Yes | tRPC endpoint URL |
| `VITE_DISCORD_CLIENT_ID` | Yes | Discord OAuth client ID |
| `VITE_DISCORD_REDIRECT_URI` | Yes | OAuth redirect URI |
| `VITE_SUPABASE_URL` | No | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | No | Supabase anon key |
| `VITE_ENABLE_KARAOKE` | No | Enable karaoke UI (default: true) |
| `VITE_ENABLE_PLAYLISTS` | No | Enable playlists UI (default: true) |

## API Endpoints

### REST + tRPC (Port 3002)

| Endpoint | Description |
|----------|-------------|
| `GET /health/live` | Liveness probe |
| `GET /health/ready` | Readiness probe |
| `GET /metrics` | Prometheus metrics |
| `GET /admin/queues` | Bull Board UI |
| `POST /api/trpc/*` | tRPC procedures |

### tRPC Procedures

**Playlist**: `create`, `getById`, `getAll`, `getMyPlaylists`, `getPublicPlaylists`, `addTrack`, `search`, `delete`

**Queue**: `get`, `getHistory`, `reorder`, `remove`, `shuffle`, `clear`

**Player**: `get`, `playback`, `previous`, `setVolume`, `seek`

**Music**: `search`, `request`, `searchCatalog`, `getLyrics`

**Karaoke**: `prepare`, `getStatus`, `getPitchData`

**Presets**: `getAll`, `save`, `load`

**Bot**: `getStatus`, `getCache`, `getSettings`, `cleanCache`, `updateSessionRestore`, `setRole`, `getAuditLog`

**Auth**: `discord`, `session`

**Discord**: `join`, `leave`

**System**: `getSettings`, `updateSettings`

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `ws://localhost:3002/ws/karaoke?guildId=<id>` | Real-time karaoke progress |

## Deployment

### Railway (Backend)

1. Connect GitHub repo to Railway
2. Add Redis plugin
3. Add persistent volume (`/app/data`, 1GB)
4. Set environment variables
5. Deploy - Railway uses `railway.json` for multi-service deploy:
   - `web` service: `npm start`
   - `worker` service: `npm run worker:karaoke`

### Lovable (Frontend)

1. Connect GitHub repo to Lovable
2. Set environment variables in Lovable dashboard
3. Auto-deploys on push to main

### Docker Compose (Local Stack)

```bash
docker-compose up -d
```

Services:
- `redis`: Redis 7 Alpine
- `musicbot`: API + Discord bot
- `karaoke-worker`: Background karaoke processing

## Testing

### Load Testing (k6)

```bash
# Install k6
# Run API load test
k6 run tests/load-test.k6.js -e API_URL=http://localhost:3002

# Run WebSocket load test
k6 run tests/ws-load-test.k6.js -e WS_URL=ws://localhost:3002/ws/karaoke?guildId=test
```

### Load Testing (Artillery)

```bash
# Install artillery
npm install -g artillery
artillery run tests/load-test.artillery.yml
```

### TypeScript Check

```bash
cd MusicBot && npx tsc --noEmit
cd Voxaria-Web && npx tsc --noEmit
```

## Project Structure

```
C:\Bot\
├── MusicBot/                    # Discord bot + API
│   ├── src/
│   │   ├── bootstrap/           # Discord client, event handlers
│   │   ├── db/                  # Drizzle ORM schema
│   │   ├── player/              # PlayerCore, StatePersistence
│   │   ├── trpc/                # tRPC router, context
│   │   ├── workers/             # Karaoke worker
│   │   ├── api/                 # Express server, health, metrics
│   │   └── auth/                # JWT, Casbin middleware
│   ├── Dockerfile
│   ├── railway.json
│   └── package.json
├── Voxaria-Web/                 # React dashboard (Lovable)
│   ├── src/
│   │   ├── components/          # UI components (shadcn/ui)
│   │   ├── pages/               # Dashboard pages
│   │   ├── lib/                 # tRPC client, auth, API
│   │   └── hooks/               # React hooks
│   └── package.json
├── voxaria-contracts/           # Shared tRPC schemas (Zod)
├── docker-compose.yml           # Local development stack
├── ngrok.yml                    # Ngrok tunnels
├── tests/                       # Load tests (k6, Artillery)
└── Tomorrow.md                  # Session continuity doc
```

## Key Technologies

- **Discord.js v14** - Discord API wrapper
- **tRPC + Zod** - Type-safe API contracts
- **Drizzle ORM** - Type-safe SQLite database
- **BullMQ** - Redis-based job queue (karaoke)
- **Casbin** - Authorization (RBAC)
- **Opossum** - Circuit breakers
- **Pino** - Structured logging
- **Prometheus** - Metrics
- **Demucs** - Stem separation (Python)
- **React + Vite + Tailwind** - Frontend
- **Lovable** - Frontend hosting

## Discord Commands

| Command | Description |
|---------|-------------|
| `/play <query>` | Play a song |
| `/queue` | Show queue |
| `/skip` | Skip current track |
| `/pause` / `/resume` | Pause/resume |
| `/stop` | Stop and clear queue |
| `/volume <0-100>` | Set volume |
| `/seek <position>` | Seek in track |
| `/lyrics` | Show lyrics |
| `/karaoke` | Start karaoke |
| `/playlist` | Manage playlists |
| `/settings` | Bot settings |

## Monitoring

- **Prometheus**: `/metrics` endpoint
- **Grafana**: Import `tests/grafana-dashboard.json`
- **Bull Board**: `/admin/queues` for queue monitoring
- **Health**: `/health/live`, `/health/ready`

## Troubleshooting

### Bot doesn't join voice
- Check `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID`
- Ensure bot has `Connect`, `Speak`, `Use Voice Activity` permissions

### Karaoke not working
- Verify Redis is running: `docker ps | grep redis`
- Check worker logs: `npm run worker:karaoke`
- Ensure Demucs model downloads (first run takes time)

### YouTube extraction fails
- Update `COOKIES_FILE` with fresh cookies.txt
- Or set `COOKIES_FROM_BROWSER=chrome`

### tRPC types out of sync
```bash
cd voxaria-contracts && npm run build
cd MusicBot && npm run build:contracts
```

## License

MIT License - see LICENSE file for details.

## Credits

Built with ❤️ using Discord.js, tRPC, Drizzle, BullMQ, and many amazing open-source projects.