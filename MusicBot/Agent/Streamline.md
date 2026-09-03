[•] Create Implementation Plan Document
[ ] Phase 1+2: New Track Cache Module (src/trackCache.js)
[ ] Phase 1+2: MusicBrainz In-Memory Request Queue (src/musicbrainz/RequestQueue.js)
[ ] Phase 1+2: LRCLIB Timeout & Retry Removal (src/lrclib/LrclibClient.js)
[ ] Phase 1+2: LyricsManager Timeout Consistency (src/LyricsManager.js)
[ ] Phase 1+2: TrackManager Cache Integration (src/player/TrackManager.js)
[ ] Phase 1+2: StreamResolver Force Re-Resolution (src/player/StreamResolver.js)
[ ] Phase 1+2: AudioEngineCore Preload Limit & Play Resolution (src/player/AudioEngineCore.js)
[ ] Phase 1+2: PlayerCore Sequential Preload Limit (src/player/PlayerCore.js)
[ ] Phase 1+2: Config Updates (config.js)
[ ] Phase 1+2: MusicBrainzClient Integration (src/musicbrainz/MusicBrainzClient.js)
+ Thought: 3.9s
Implementation Plan: Unified Phase 1+2 Patch
Architecture Overview
┌─────────────────────────────────────────────────────────────────┐
│                        TRACK RESOLUTION PIPELINE                │
├─────────────────────────────────────────────────────────────────┤
│  1. TrackManager.addTrack()                                     │
│     └─► _resolveTextQuery()                                     │
│         ├─► CHECK trackCache (NEW) ──► HIT: Return metadata    │
│         │       (no streamUrl)                                  │
│         │                                                       │
│         │       MISS: Run full pipeline                         │
│         │       ├─► LRCLIB (2s timeout, 0 retries)             │
│         │       ├─► MusicBrainz (via RequestQueue, 1050ms)     │
│         │       ├─► CoverArt                                    │
│         │       └─► YouTube Metadata Match (±3s)               │
│         │                                                       │
│         │       ON SUCCESS: Cache rich metadata to trackCache  │
│         │       (tier: mainstream=30d / indie=7d)              │
│         │                                                       │
│         └─► Return track object WITHOUT streamUrl              │
│                                                                 │
│  2. PlayerCore.play() / AudioEngineCore.play()                 │
│     └─► StreamResolver.resolveStream() (NEW: ALWAYS fresh)     │
│         └─► YouTube.getStream() ──► Fresh 6-hr valid URL       │
│                                                                 │
│  3. Pre-warm: PlayerCore.sequentialPreload()                   │
│     └─► Only queue[0] and queue[1] (max 2 tracks)              │
└─────────────────────────────────────────────────────────────────┘
1. New File: src/trackCache.js
Location: cache/tracks/ (project-level, not tmp/)
// Cache structure per entry:
{
  "value": {
    "title": "Song Title",
    "artist": "Artist Name", 
    "durationMs": 213000,
    "thumbnail": "https://...",
    "albumCover": "https://...",
    "lyrics": { "synced": "...", "plain": "...", "hasSynced": true, "source": "LRCLIB" },
    "platform": "youtube",
    "mbid": "recording-mbid",
    "releaseMbid": "release-mbid",
    "releaseGroupMbid": "release-group-mbid",
    "popularityCount": 42,
    "lrclibAnchor": true,
    "youtubeFallback": false,
    "originalPlatform": "text"
  },
  "createdAt": 1699999999999,
  "expiresAt": 1702591999999,  // 30 days or 7 days
  "tier": "mainstream"  // or "indie"
}
Key Methods:
- get(key) → returns value or null (checks expiry)
- set(key, value, tier) → tier determines TTL (mainstream=30d, indie=7d)
- delete(key)
- clear()
Cache Key Strategy: track:${normalizedTitle}:${normalizedArtist}:${durationSec}
Tier Detection: 
- popularityCount >= 10 OR majorLabel === true → "mainstream" (30d)
- Else → "indie" (7d)
2. New File: src/musicbrainz/RequestQueue.js
In-Memory Only (per-process, no persistence)
class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.minIntervalMs = 1050;
    this.lastRequestTime = 0;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const waitTime = Math.max(0, this.minIntervalMs - (now - this.lastRequestTime));
      if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));

      const { fn, resolve, reject } = this.queue.shift();
      this.lastRequestTime = Date.now();
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    }
    this.processing = false;
  }
}

module.exports = new RequestQueue();
Integration: Replace rateLimiter.acquire() in MusicBrainzClient.fetchWithRateLimit() with requestQueue.enqueue(() => fetch(...))
3. src/lrclib/LrclibClient.js Changes
Current
timeout: 5000
retries: 4
baseDelay: 1000
Both searchTrack() and searchAllTracks() - direct axios call, no retry wrapper.
4. src/LyricsManager.js Changes
Method
runLyricsMatcher()
runYTMusicHarvest()
5. src/player/TrackManager.js Changes
In _resolveTextQuery():
// At start of method - CHECK CACHE FIRST
const cacheKey = `track:${normalizedTitle}:${normalizedArtist}:${anchorDurationSec}`;
const cached = await trackCache.get(cacheKey);
if (cached) {
  console.log(`[TrackCache] HIT: "${refTitle}" - "${refArtist}"`);
  return { ...cached, url: null }; // Explicitly no streamUrl
}

// ... existing pipeline runs ...

// At end - ON SUCCESS, CACHE RESULT
const tier = (mbRecord?.popularityCount >= 10 || mbRecord?.majorLabel) ? 'mainstream' : 'indie';
await trackCache.set(cacheKey, richMetadata, tier);
Returned track object: Exclude url, streamUrl, rawUrl - only metadata.
6. src/player/StreamResolver.js Changes
resolveStream(): 
- For YouTube: Always call YouTube.getStream(track.url, guildId, resumeFromSeconds) fresh
- Never use track.url if it's a cached stream URL (track objects from cache won't have valid streamUrl anyway)
- Remove any logic that returns cached stream info
7. src/player/AudioEngineCore.js Changes
preloadTrack(track):
// Check queue position - only preload if position < 2
const queueIndex = this.player.queue.findIndex(t => t.url === track.url);
if (queueIndex >= 2) return; // Skip pre-warm for position 2+
play(): Already calls StreamResolver.resolveStream() - ensure it passes fresh.
8. src/player/PlayerCore.js Changes
sequentialPreload(tracks):
async sequentialPreload(tracks) {
  // Only preload first 2 tracks
  const preloadTracks = tracks.slice(0, 2);
  for (const track of preloadTracks) {
    // ... existing logic
  }
}
9. config.js Additions
trackCache: {
  enabled: true,
  directory: './cache/tracks',
  ttl: {
    mainstream: 30 * 24 * 60 * 60 * 1000,  // 30 days
    indie: 7 * 24 * 60 * 60 * 1000         // 7 days
  },
  mainstreamThreshold: {
    popularityCount: 10,
    requireMajorLabel: true
  }
}
10. src/musicbrainz/MusicBrainzClient.js Changes
- Import requestQueue from ./RequestQueue
- Replace await rateLimiter.acquire() with await requestQueue.enqueue(async () => { ... fetch ... })
- Remove ShardSafeRateLimiter import and redisClient dependency
- Keep file-based lock as fallback only (or remove entirely since in-memory queue is per-process)
File Dependency Graph
config.js
    │
    ├─► src/trackCache.js (NEW)
    │       │
    │       └─► src/player/TrackManager.js (modified)
    │
    ├─► src/musicbrainz/RequestQueue.js (NEW)
    │       │
    │       └─► src/musicbrainz/MusicBrainzClient.js (modified)
    │
    ├─► src/lrclib/LrclibClient.js (modified)
    │       │
    │       └─► src/LyricsManager.js (modified)
    │
    ├─► src/player/StreamResolver.js (modified)
    │       │
    │       └─► src/player/AudioEngineCore.js (modified)
    │
    └─► src/player/PlayerCore.js (modified)
Testing Checklist
Test
Cache hit returns metadata
Cache miss runs full pipeline
Stream re-resolution on play
Pre-warm limit
LRCLIB timeout
MB rate limit
Cache TTL tiers
Rollback Plan
If issues arise:
1. Disable trackCache.enabled: false in config
2. Revert StreamResolver to use cached URLs (temporary)
3. Revert RequestQueue to old ShardSafeRateLimiter