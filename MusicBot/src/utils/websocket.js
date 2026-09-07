const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../auth/jwt');

let wss = null;
const guildRooms = new Map();
const connectionTracker = new Map();

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.socket?.remoteAddress || 
           'unknown';
}

function trackConnection(ip) {
    const now = Date.now();
    const entry = connectionTracker.get(ip) || { count: 0, firstSeen: now };
    entry.count++;
    entry.lastSeen = now;
    connectionTracker.set(ip, entry);
    
    setTimeout(() => {
        const current = connectionTracker.get(ip);
        if (current && current.lastSeen === now) {
            connectionTracker.delete(ip);
        } else if (current) {
            current.count = Math.max(0, current.count - 1);
            if (current.count === 0) {
                connectionTracker.delete(ip);
            }
        }
    }, 60000);
}

function getConnectionCount(ip) {
    const entry = connectionTracker.get(ip);
    return entry ? entry.count : 0;
}

function setupWebSocket(server) {
    wss = new WebSocketServer({ server, path: '/ws/karaoke' });

    wss.on('connection', async (ws, req) => {
        const clientIp = getClientIp(req);
        trackConnection(clientIp);
        
        if (getConnectionCount(clientIp) > 10) {
            ws.close(4003, 'Too many connections from this IP');
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const guildId = url.searchParams.get('guildId');
        const token = url.searchParams.get('token');

        if (!guildId) {
            ws.close(4000, 'Missing guildId parameter');
            return;
        }

        if (!token) {
            ws.close(4001, 'Missing auth token');
            return;
        }

        try {
            const payload = await verifyAccessToken(token);
            ws.userId = payload.sub;
            ws.guildId = guildId;
            console.log(`[WS] Authenticated user ${payload.sub} for karaoke:${guildId} (IP: ${clientIp})`);
        } catch (err) {
            ws.close(4002, 'Invalid token');
            return;
        }

        if (!guildRooms.has(guildId)) {
            guildRooms.set(guildId, new Set());
        }
        guildRooms.get(guildId).add(ws);

        console.log(`[WS] Client connected to karaoke:${guildId}`);

        ws.on('close', () => {
            const room = guildRooms.get(guildId);
            if (room) {
                room.delete(ws);
                if (room.size === 0) {
                    guildRooms.delete(guildId);
                }
            }
            console.log(`[WS] Client disconnected from karaoke:${guildId}`);
        });

        ws.on('error', (err) => {
            console.error(`[WS] Error for karaoke:${guildId}:`, err.message);
        });
    });

    return wss;
}

function broadcastToGuild(guildId, event, data) {
    const room = guildRooms.get(guildId);
    if (!room) return;

    const message = JSON.stringify({ event, data });
    for (const client of room) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}

function getWSS() {
    return wss;
}

function getGuildRooms() {
    return guildRooms;
}

module.exports = {
    setupWebSocket,
    broadcastToGuild,
    getWSS,
    getGuildRooms,
};