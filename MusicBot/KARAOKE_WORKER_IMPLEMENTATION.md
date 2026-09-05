# BullMQ Karaoke Workers Implementation

## Summary

Implemented async karaoke processing using BullMQ + Redis for Voxaria MusicBot.

## Files Created/Modified

### New Files
1. `src/queue/karaoke-queue.js` - BullMQ queue setup with Redis connection
2. `src/workers/karaoke-worker.js` - Worker process (concurrency: 2)
3. `src/workers/start-worker.js` - Worker entry point
4. `src/utils/websocket.js` - WebSocket server for real-time progress

### Modified Files
1. `src/api/routes/karaoke.js` - Updated to use BullMQ queue instead of direct execFile
2. `src/api/server.js` - Added WebSocket support + Bull Board dashboard
3. `package.json` - Added `worker:karaoke` script
4. `.env` - Added Redis configuration

## How to Run

### Prerequisites
- Redis server running on localhost:6379 (or configure via REDIS_HOST/REDIS_PORT)
- Python with demucs installed (`pip install demucs`)
- Node.js dependencies installed (`npm install`)

### Start API Server (includes WebSocket + Bull Board)
```bash
npm start
```
- API: http://localhost:3002
- Bull Board: http://localhost:3002/admin/queues
- WebSocket: ws://localhost:3002/ws/karaoke?guildId=<guildId>

### Start Karaoke Worker (separate process)
```bash
npm run worker:karaoke
```
- Processes jobs from queue with max 2 concurrent demucs
- Auto-retries failed jobs (3 attempts, exponential backoff)
- Emits progress via WebSocket to connected clients

## API Endpoints

### POST /karaoke/prepare (or /music/karaoke)
Queue a karaoke job:
```json
{
  "trackUrl": "https://youtube.com/watch?v=..."
}
```
Response:
```json
{
  "status": "queued",
  "jobId": "md5hash"
}
```

### GET /karaoke/status/:jobId
Check job status:
```json
{
  "status": "processing|ready|error",
  "jobId": "...",
  "progress": 45,
  "stems": { "vocals": "...", "instrumental": "..." },
  "frames": [...]
}
```

## WebSocket Progress Events

Connect: `ws://localhost:3002/ws/karaoke?guildId=<guildId>`

Receive events:
```json
{
  "event": "karaoke:progress",
  "data": {
    "songId": "md5hash",
    "progress": 45,
    "status": "separating"
  }
}
```

Status values: `downloading`, `separating`, `extracting_pitch`, `saving`, `completed`, `error`

## Architecture

```
Client → API (/karaoke/prepare) → BullMQ Queue (Redis) → Worker (Python Demucs)
                ↑                                                      ↓
                └──────── WebSocket Progress ──────────────────────────┘
```

## Concurrency Control

- Worker concurrency: 2 (max 2 demucs simultaneously)
- Queue priority: Owner=1, Staff=2, DJ=3, Guest=10
- Job TTL: 100 completed, 50 failed kept in Redis

## Monitoring

- Bull Board dashboard at `/admin/queues`
- View active/waiting/completed/failed jobs
- Manual retry/cleanup actions available

## Testing

1. Start Redis: `redis-server`
2. Start API: `npm start`
3. Start Worker: `npm run worker:karaoke` (in separate terminal)
4. Call API: `POST /karaoke/prepare` with trackUrl
5. Poll `/karaoke/status/:jobId` or connect WebSocket for progress
6. When ready, stems available at `/karaoke/stems/:jobId/vocals.wav`

## Notes

- Existing karaoke_worker.py logic preserved (calls Python for Demucs)
- Backward compatible with existing /music/karaoke/pitch-data endpoint
- Graceful shutdown on SIGINT/SIGTERM
- Auto-retry with exponential backoff (5s, 10s, 20s...)