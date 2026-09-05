# MusicBot Deployment Guide

## Platform: Railway (Recommended)

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository with this code
- Discord Bot application with token
- Spotify Developer application
- Genius API credentials

### Quick Deploy (Automated)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Add Railway deployment config"
   git push origin main
   ```

2. **Connect to Railway**
   - Go to https://railway.app/new
   - Select "Deploy from GitHub repo"
   - Choose this repository
   - Railway will auto-detect `railway.json`

3. **Add Redis Plugin**
   - In Railway dashboard, click "New" → "Database" → "Add Redis"
   - This automatically injects `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

4. **Add Persistent Volume**
   - In Railway dashboard, click "New" → "Volume"
   - Name: `voxaria-data`
   - Mount Path: `/app/data`
   - Size: 1GB

5. **Configure Environment Variables**
   Go to each service (web + worker) → Variables tab, add:
   ```
   DISCORD_TOKEN=your_bot_token
   CLIENT_ID=your_client_id
   DISCORD_CLIENT_SECRET=your_oauth_secret
   SPOTIFY_CLIENT_ID=your_spotify_id
   SPOTIFY_CLIENT_SECRET=your_spotify_secret
   GENIUS_CLIENT_ID=your_genius_id
   GENIUS_CLIENT_SECRET=your_genius_secret
   JWT_PRIVATE_KEY=your_rsa_private_key
   JWT_PUBLIC_KEY=your_rsa_public_key
   COOKIES_FILE=/app/data/cookies.txt
   DATABASE_PATH=/app/data/voxaria.db
   NODE_ENV=production
   CORS_ORIGINS=https://your-dashboard-domain.com
   ```

6. **Upload cookies.txt**
   - In Railway dashboard → Volume `voxaria-data` → Files
   - Upload your `cookies.txt` (exported from browser with YouTube cookies)

7. **Deploy**
   - Railway auto-deploys on push
   - Or manually: `railway up`

### Manual Deploy (CLI)

```bash
cd MusicBot
railway login
railway link  # Select your project
railway up    # Deploys web service
railway up --service karaoke-worker  # Deploys worker service
```

### Service Architecture

| Service | Command | Purpose |
|---------|---------|---------|
| `musicbot-web` | `npm start` | Discord bot + API + WebSocket + Bull Board |
| `karaoke-worker` | `npm run worker:karaoke` | Background job processor for karaoke stems |

Both services share:
- Redis (BullMQ queue)
- Persistent volume `/app/data` (SQLite + cookies.txt)

### Health Checks

- **Liveness**: `GET /health/live` - Returns 200 if process alive
- **Readiness**: `GET /health/ready` - Returns 200 if Redis + Discord connected

### Access Points

After deployment:
- **API**: `https://musicbot-web.railway.app`
- **WebSocket**: `wss://musicbot-web.railway.app/ws/karaoke?guildId=<id>`
- **Bull Board**: `https://musicbot-web.railway.app/admin/queues`
- **Health**: `https://musicbot-web.railway.app/health/ready`

### Generate JWT Keys

```bash
node -e "
const {generateKeyPairSync} = require('crypto');
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
console.log('JWT_PRIVATE_KEY=' + privateKey.export({type: 'pkcs1', format: 'pem'}).replace(/\n/g, '\\n'));
console.log('JWT_PUBLIC_KEY=' + publicKey.export({type: 'pkcs1', format: 'pem'}).replace(/\n/g, '\\n'));
"
```

### Local Development with Docker

```bash
cd MusicBot
cp .env.production .env  # Fill in your values
docker-compose up --build
```

### Troubleshooting

**Build fails on contracts:**
- Ensure build context is repository root (`C:\Bot`)
- Railway uses repo root as context by default

**Worker crashes on Demucs:**
- Increase memory limit in Railway (worker needs ~4GB for Demucs + torch)
- Check logs for CUDA/MPS errors (CPU-only PyTorch used)

**WebSocket not working:**
- Railway supports WebSockets natively
- Ensure `ws://` → `wss://` in frontend

**SQLite errors:**
- Verify `DATABASE_PATH=/app/data/voxaria.db`
- Volume must be mounted before app starts

### Scaling

- **Web service**: Single instance (Discord bot sharding handles scale)
- **Worker service**: Scale horizontally in Railway dashboard
- **Redis**: Upgrade plan for higher throughput

### Cost Estimate (Railway Hobby)

- Web service: ~$5/mo
- Worker service: ~$5/mo (only when processing)
- Redis: ~$5/mo
- Volume (1GB): ~$1/mo
- **Total: ~$16/mo**