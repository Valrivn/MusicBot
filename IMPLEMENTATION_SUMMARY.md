# Circuit Breakers + Observability Implementation Summary

## Overview
Implemented comprehensive resilience patterns and observability for Voxaria MusicBot.

## Files Created

### Circuit Breakers (`src/resilience/`)
| File | Purpose |
|------|---------|
| `circuit-breaker.js` | Core circuit breaker factory using Opossum |
| `external-calls.js` | Wrappers for yt-dlp, FFmpeg, HTTP, Discord API |
| `demucs-breaker.js` | Circuit breaker for Demucs/Python karaoke worker |

### Observability (`src/observability/`)
| File | Purpose |
|------|---------|
| `logger.js` | Pino structured logger with correlation ID support |
| `metrics.js` | Prometheus metrics (counters, histograms, gauges) |
| `correlation.js` | cls-rtracer middleware for request correlation IDs |
| `tracing.js` | OpenTelemetry tracing setup (Phase 2, optional) |

### Health Checks (`src/api/routes/`)
| File | Purpose |
|------|---------|
| `health.js` | `/health`, `/health/live`, `/health/ready`, `/metrics` endpoints |

## Files Modified
- `src/YouTube.js` - Uses `runYtdlp`/`runYtdlpWrap` circuit breakers
- `src/SoundCloud.js` - Uses circuit breakers for all yt-dlp calls
- `src/DirectLink.js` - Uses HTTP circuit breaker for all requests
- `src/player/DownloadManager.js` - Uses circuit breakers for yt-dlp & FFmpeg
- `src/api/routes/karaoke.js` - Uses Demucs circuit breaker with fallback
- `src/api/server.js` - Added correlation ID middleware + health routes

## Circuit Breaker Configurations

| Service | Timeout | Error Threshold | Reset Timeout | Rolling Window |
|---------|---------|-----------------|---------------|----------------|
| yt-dlp | 60s | 50% | 30s | 10s |
| yt-dlp-wrap (search) | 30s | 50% | 30s | 10s |
| FFmpeg | 120s | 50% | 60s | 10s |
| HTTP (Invidious, etc.) | 30s | 50% | 30s | 10s |
| Discord API | 15s | 50% | 30s | 10s |
| Demucs | 600s | 50% | 60s | 30s |

## Fallback Strategies

1. **yt-dlp**: Falls back to Invidious via HTTP breaker
2. **Demucs**: Falls back to cached stems → instrumental-only mode
3. **HTTP**: Retries with exponential backoff (existing retry.js)

## Prometheus Metrics Exposed

### HTTP
- `voxaria_http_requests_total` (method, route, status)
- `voxaria_http_request_duration_seconds` (method, route)

### Music Bot
- `voxaria_queue_depth` (guild_id)
- `voxaria_voice_connection_state` (guild_id)
- `voxaria_karaoke_job_duration_seconds`
- `voxaria_track_play_duration_seconds` (platform)
- `voxaria_active_players`

### External Calls
- `voxaria_ytdlp_calls_total` (operation, status)
- `voxaria_ffmpeg_calls_total` (operation, status)
- `voxaria_discord_api_calls_total` (endpoint, status)
- `voxaria_external_http_calls_total` (service, status)

### Circuit Breakers
- `voxaria_circuit_breaker_state` (service: 0=closed, 1=half-open, 2=open)

### Cache
- `voxaria_cache_hits_total` (cache_type)
- `voxaria_cache_misses_total` (cache_type)

## Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health/live` | Liveness probe - always returns ok |
| `GET /health/ready` | Readiness probe - checks Discord, cache, memory |
| `GET /health` | Detailed health with all checks |
| `GET /metrics` | Prometheus metrics (text format) |
| `GET /metrics/json` | Prometheus metrics (JSON format) |

## Correlation IDs
- Header: `x-request-id` (echoed back in response)
- Available via `cls-rtracer` in async context
- Logger automatically includes `requestId` in all logs

## Usage

### Accessing Circuit Breaker Status
```javascript
const { getCircuitBreakerStatus } = require('./src/resilience/external-calls');
const status = getCircuitBreakerStatus();
// { 'yt-dlp': 'closed', 'ffmpeg': 'closed', ... }
```

### Using Structured Logger
```javascript
const { logger, getRequestLogger } = require('./src/observability/logger');
const { getCorrelationId } = require('./src/observability/correlation');

// With correlation ID (in request handler)
const log = getRequestLogger({ guildId: '123' });
log.info({ msg: 'Processing track', track: 'Never Gonna Give You Up' });

// Standalone
logger.info({ msg: 'Bot started', version: '16.0.0' });
```

### Recording Metrics
```javascript
const { 
  recordHttpRequest, 
  setQueueDepth, 
  recordYtdlpCall,
  setCircuitBreakerState 
} = require('./src/observability/metrics');

// In Express middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    recordHttpRequest(req.method, req.route?.path || req.path, res.statusCode, Date.now() - start);
  });
  next();
});
```

### OpenTelemetry Tracing (Optional)
```bash
ENABLE_TRACING=true JAEGER_ENDPOINT=http://jaeger:14268/api/traces npm start
```

```javascript
const { initTracing, withSpan } = require('./src/observability/tracing');
initTracing(); // Call once at startup

// Trace an operation
await withSpan('youtube.search', { query }, async (span) => {
  span.setAttribute('query.length', query.length);
  return await YouTube.search(query);
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Pino log level |
| `NODE_ENV` | `development` | Production disables pretty printing |
| `ENABLE_TRACING` | `false` | Enable OpenTelemetry |
| `JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` | Jaeger collector URL |
| `MUSIC_API_PORT` | `3002` | API server port |

## Verification

All modules load without errors:
```bash
node --check index.js           # Main entry
node -e "require('./src/resilience/circuit-breaker.js')"
node -e "require('./src/observability/logger.js')"
node -e "require('./src/observability/metrics.js')"
node -e "require('./src/YouTube.js')"
# etc.
```

## Next Steps (Optional)

1. **OpenTelemetry**: Install `@opentelemetry/sdk-node`, `@opentelemetry/exporter-jaeger`, `@opentelemetry/auto-instrumentations-node`
2. **Grafana Dashboards**: Import Voxaria dashboard for metrics visualization
3. **Alerting**: Set up alerts for circuit breaker open states, high error rates, queue depth
4. **Log Aggregation**: Ship Pino JSON logs to Loki/ELK