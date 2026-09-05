import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const searchLatency = new Trend('search_latency');
const queueLatency = new Trend('queue_latency');
const karaokeLatency = new Trend('karaoke_latency');
const wsLatency = new Trend('ws_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 10 },    // Stay at 10 users
    { duration: '30s', target: 50 },   // Spike to 50 users
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.05'],
    search_latency: ['p(95)<1000'],
    queue_latency: ['p(95)<200'],
    karaoke_latency: ['p(95)<5000'],
  },
};

// Base URL - set via environment variable or default to local
const BASE_URL = __ENV.API_URL || 'http://localhost:3002';
const TRPC_URL = `${BASE_URL}/api/trpc`;

// Test data
const testQueries = [
  'Never Gonna Give You Up',
  'Billie Jean',
  'Bohemian Rhapsody',
  'Sweet Child O Mine',
  'Hotel California',
  'Stairway to Heaven',
  'Imagine',
  'Smells Like Teen Spirit',
];

function getRandomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

function makeTrpcCall(method, path, body = null) {
  const url = `${TRPC_URL}/${path}`;
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '30s',
  };
  
  if (body) {
    return http.request(method, url, JSON.stringify(body), params);
  }
  return http.request(method, url, null, params);
}

export default function () {
  const startTime = Date.now();
  
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health/live`, { timeout: '10s' });
  check(healthRes, {
    'health check status 200': (r) => r.status === 200,
  });
  errorRate.add(healthRes.status !== 200);

  // 2. Search catalog
  const searchQuery = getRandomQuery();
  const searchStart = Date.now();
  const searchRes = makeTrpcCall('POST', 'music.searchCatalog', {
    json: { query: searchQuery },
  });
  const searchDuration = Date.now() - searchStart;
  searchLatency.add(searchDuration);
  
  check(searchRes, {
    'search status 200': (r) => r.status === 200,
    'search returns results': (r) => {
      try {
        const data = r.json();
        return data.result?.data?.results?.length > 0;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(searchRes.status !== 200);

  // 3. Get queue
  const queueStart = Date.now();
  const queueRes = makeTrpcCall('GET', 'queue.get');
  const queueDuration = Date.now() - queueStart;
  queueLatency.add(queueDuration);
  
  check(queueRes, {
    'queue status 200': (r) => r.status === 200,
  });
  errorRate.add(queueRes.status !== 200);

  // 4. Get player status
  const playerRes = makeTrpcCall('GET', 'player.get');
  check(playerRes, {
    'player status 200': (r) => r.status === 200,
  });
  errorRate.add(playerRes.status !== 200);

  // 5. Karaoke prepare (simulate)
  const karaokeStart = Date.now();
  const karaokeRes = makeTrpcCall('POST', 'karaoke.prepare', {
    json: { trackUrl: `https://youtube.com/watch?v=${Math.random().toString(36).substring(7)}` },
  });
  const karaokeDuration = Date.now() - karaokeStart;
  karaokeLatency.add(karaokeDuration);
  
  check(karaokeRes, {
    'karaoke prepare status 200': (r) => r.status === 200,
  });
  errorRate.add(karaokeRes.status !== 200);

  // 6. Get bot status
  const statusRes = makeTrpcCall('GET', 'bot.getStatus');
  check(statusRes, {
    'bot status 200': (r) => r.status === 200,
  });
  errorRate.add(statusRes.status !== 200);

  // 7. Get cache info
  const cacheRes = makeTrpcCall('GET', 'bot.getCache');
  check(cacheRes, {
    'cache status 200': (r) => r.status === 200,
  });
  errorRate.add(cacheRes.status !== 200);

  // 8. Get presets
  const presetsRes = makeTrpcCall('GET', 'presets.getAll');
  check(presetsRes, {
    'presets status 200': (r) => r.status === 200,
  });
  errorRate.add(presetsRes.status !== 200);

  // Sleep between iterations (simulate user think time)
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

// Setup function - runs once before the test
export function setup() {
  console.log(`Testing against: ${BASE_URL}`);
  
  // Verify API is reachable
  const res = http.get(`${BASE_URL}/health/live`);
  if (res.status !== 200) {
    throw new Error(`API not reachable at ${BASE_URL}/health/live`);
  }
  
  return { baseUrl: BASE_URL };
}

// Teardown function - runs once after the test
export function teardown(data) {
  console.log('Load test completed');
}