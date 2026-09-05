const { WebSocketServer } = require('ws');

let wss = null;
const guildRooms = new Map();

function setupWebSocket(server) {
    wss = new WebSocketServer({ server, path: '/ws/karaoke' });

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const guildId = url.searchParams.get('guildId');

        if (!guildId) {
            ws.close(4000, 'Missing guildId parameter');
            return;
        }

        ws.guildId = guildId;

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