import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const wsErrorRate = new Rate('ws_errors');
const wsConnectTime = new Trend('ws_connect_time');
const wsMessageLatency = new Trend('ws_message_latency');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    ws_connect_time: ['p(95)<1000'],
    ws_message_latency: ['p(95)<100'],
    ws_errors: ['rate<0.05'],
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3002/ws/karaoke?guildId=test-guild';

export default function () {
  const startTime = Date.now();
  
  ws.connect(WS_URL, {}, function (socket) {
    const connectTime = Date.now() - startTime;
    wsConnectTime.add(connectTime);
    
    socket.on('open', () => {
      check(socket, { 'WS connected': () => true });
      
      // Send a test message
      const msgStart = Date.now();
      socket.send(JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
      }));
      
      socket.setTimeout(() => {
        const msgLatency = Date.now() - msgStart;
        wsMessageLatency.add(msgLatency);
        socket.close();
      }, 5000);
    });
    
    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'pong') {
          const msgLatency = Date.now() - data.timestamp;
          wsMessageLatency.add(msgLatency);
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    socket.on('close', () => {
      check(socket, { 'WS closed cleanly': () => true });
    });
    
    socket.on('error', (e) => {
      wsErrorRate.add(1);
      console.log('WS error:', e);
    });
  });
  
  sleep(1);
}