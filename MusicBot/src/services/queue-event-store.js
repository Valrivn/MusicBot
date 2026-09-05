const { db, queueEventQueries, queueSnapshotQueries, eq, desc, asc, sql, and } = require('../db');
const schema = require('../db/schema');

class QueueEventStore {
    constructor() {
        this.eventTypeMap = {
            'play': 'play',
            'skip': 'skip',
            'seek': 'seek',
            'volume': 'volume',
            'pause': 'pause',
            'resume': 'resume',
            'stop': 'stop',
            'clear': 'clear',
            'shuffle': 'shuffle',
            'loop': 'loop',
            'add': 'add',
            'remove': 'remove',
            'reorder': 'reorder'
        };
        
        this.snapshotIntervalMs = 5 * 60 * 1000; // 5 minutes
        this.snapshotEventThreshold = 50; // Save snapshot every 50 events
        this.eventCounters = new Map(); // guildId -> event count since last snapshot
        this.snapshotTimers = new Map(); // guildId -> timer
    }

    /**
     * Append a new event to the event store
     */
    async append(guildId, event) {
        if (!guildId || !event) {
            throw new Error('guildId and event are required');
        }

        const sequence = await this._getNextSequence(guildId);
        
        const eventData = {
            guildId,
            eventType: event.type || event.eventType,
            payload: JSON.stringify(event.payload || event),
            sequence,
            timestamp: new Date().toISOString()
        };

        await queueEventQueries.create(eventData);
        
        // Increment event counter for snapshot threshold
        const count = (this.eventCounters.get(guildId) || 0) + 1;
        this.eventCounters.set(guildId, count);

        // Check if we should save a snapshot
        if (count >= this.snapshotEventThreshold) {
            await this._maybeSaveSnapshot(guildId);
        }

        return eventData;
    }

    /**
     * Get events for a guild, optionally from a specific sequence
     */
    async getEvents(guildId, fromSequence = 0) {
        if (!guildId) return [];

        const events = await db.query.queueEvents.findMany({
            where: and(
                eq(schema.queueEvents.guildId, guildId),
                sql`${schema.queueEvents.sequence} > ${fromSequence}`
            ),
            orderBy: asc(schema.queueEvents.sequence),
        });

        return events.map(e => ({
            ...e,
            payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload
        }));
    }

    /**
     * Get the latest snapshot for a guild
     */
    async getLatestSnapshot(guildId) {
        if (!guildId) return null;

        const snapshot = await queueSnapshotQueries.findLatest(guildId);
        if (!snapshot) return null;

        return {
            ...snapshot,
            state: typeof snapshot.state === 'string' ? JSON.parse(snapshot.state) : snapshot.state
        };
    }

    /**
     * Save a snapshot of the current queue state
     */
    async saveSnapshot(guildId, state) {
        if (!guildId || !state) return null;

        const snapshotData = {
            guildId,
            state: JSON.stringify(state),
            timestamp: new Date().toISOString()
        };

        const result = await queueSnapshotQueries.create(snapshotData);
        
        // Reset event counter
        this.eventCounters.set(guildId, 0);
        
        // Clean up old snapshots
        await queueSnapshotQueries.deleteOldSnapshots(guildId, 10);

        return result;
    }

    /**
     * Rebuild queue state from events and snapshots
     */
    async rebuildState(guildId) {
        if (!guildId) return null;

        // Get latest snapshot
        const snapshot = await this.getLatestSnapshot(guildId);
        let state = snapshot?.state || this._getInitialState();
        let fromSequence = snapshot?.id ? await this._getSequenceAtTimestamp(guildId, snapshot.timestamp) : 0;

        // Get events after snapshot
        const events = await this.getEvents(guildId, fromSequence);

        // Replay events
        for (const event of events) {
            state = this._applyEvent(state, event);
        }

        return state;
    }

    /**
     * Start periodic snapshot timer for a guild
     */
    startSnapshotTimer(guildId, getStateFn) {
        if (this.snapshotTimers.has(guildId)) {
            return; // Already running
        }

        const timer = setInterval(async () => {
            try {
                const state = getStateFn();
                if (state && (state.currentTrack || state.queue?.length > 0)) {
                    await this.saveSnapshot(guildId, state);
                }
            } catch (error) {
                console.error(`[QueueEventStore] Snapshot timer error for guild ${guildId}:`, error);
            }
        }, this.snapshotIntervalMs);

        this.snapshotTimers.set(guildId, timer);
        timer.unref(); // Don't prevent process exit
    }

    /**
     * Stop periodic snapshot timer for a guild
     */
    stopSnapshotTimer(guildId) {
        const timer = this.snapshotTimers.get(guildId);
        if (timer) {
            clearInterval(timer);
            this.snapshotTimers.delete(guildId);
        }
    }

    /**
     * Get next sequence number for a guild
     */
    async _getNextSequence(guildId) {
        const maxSeq = await queueEventQueries.getMaxSequence(guildId);
        return maxSeq + 1;
    }

    /**
     * Get sequence number at a specific timestamp
     */
    async _getSequenceAtTimestamp(guildId, timestamp) {
        const events = await db.query.queueEvents.findMany({
            where: and(
                eq(schema.queueEvents.guildId, guildId),
                sql`${schema.queueEvents.timestamp} <= ${timestamp}`
            ),
            orderBy: desc(schema.queueEvents.sequence),
            limit: 1,
        });
        return events[0]?.sequence || 0;
    }

    /**
     * Maybe save snapshot if threshold reached
     */
    async _maybeSaveSnapshot(guildId) {
        // This will be called with state from the player
        // The actual saveSnapshot with state is called from the player
        this.eventCounters.set(guildId, 0);
    }

    /**
     * Get initial empty state
     */
    _getInitialState() {
        return {
            currentTrack: null,
            queue: [],
            previousTracks: [],
            volume: 100,
            loop: false,
            shuffle: false,
            autoplay: false,
            paused: false,
            playbackPositionMs: 0,
            currentTrackStartOffsetMs: 0
        };
    }

    /**
     * Apply an event to the state
     */
    _applyEvent(state, event) {
        const payload = event.payload;
        const newState = { ...state };

        switch (event.eventType) {
            case 'play':
                newState.currentTrack = payload.track;
                newState.playbackPositionMs = 0;
                newState.currentTrackStartOffsetMs = 0;
                newState.paused = false;
                break;

            case 'skip':
                if (newState.currentTrack) {
                    newState.previousTracks = [...newState.previousTracks, newState.currentTrack].slice(-50);
                }
                newState.currentTrack = payload.toTrack || newState.queue.shift() || null;
                newState.playbackPositionMs = 0;
                newState.currentTrackStartOffsetMs = 0;
                break;

            case 'seek':
                newState.playbackPositionMs = payload.positionMs || 0;
                newState.currentTrackStartOffsetMs = payload.positionMs || 0;
                break;

            case 'volume':
                newState.volume = payload.volume !== undefined ? payload.volume : newState.volume;
                break;

            case 'pause':
                newState.paused = true;
                break;

            case 'resume':
                newState.paused = false;
                break;

            case 'stop':
                if (newState.currentTrack) {
                    newState.previousTracks = [...newState.previousTracks, newState.currentTrack].slice(-50);
                }
                newState.currentTrack = null;
                newState.queue = [];
                newState.playbackPositionMs = 0;
                newState.currentTrackStartOffsetMs = 0;
                newState.paused = false;
                break;

            case 'clear':
                newState.queue = [];
                break;

            case 'shuffle':
                newState.shuffle = payload.enabled !== undefined ? payload.enabled : !newState.shuffle;
                if (newState.shuffle && newState.queue.length > 1) {
                    newState.queue = this._shuffleArray([...newState.queue]);
                }
                break;

            case 'loop':
                newState.loop = payload.mode !== undefined ? payload.mode : newState.loop;
                break;

            case 'add':
                const track = payload.track;
                const position = payload.position !== undefined ? payload.position : newState.queue.length;
                newState.queue.splice(position, 0, track);
                break;

            case 'remove':
                const removeIndex = newState.queue.findIndex(t => t.id === payload.trackId || t.url === payload.trackId);
                if (removeIndex >= 0) {
                    newState.queue.splice(removeIndex, 1);
                }
                break;

            case 'reorder':
                if (Array.isArray(payload.trackIds)) {
                    const trackMap = new Map();
                    for (const t of newState.queue) {
                        const key = t.id || t.url;
                        if (key) trackMap.set(key, t);
                    }
                    newState.queue = payload.trackIds
                        .map(id => trackMap.get(id))
                        .filter(Boolean);
                }
                break;
        }

        return newState;
    }

    /**
     * Shuffle array in place (Fisher-Yates)
     */
    _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Undo last N events (bonus feature)
     */
    async undoEvents(guildId, count = 1) {
        if (!guildId || count <= 0) return { success: false, error: 'Invalid parameters' };

        // Get current state
        const currentState = await this.rebuildState(guildId);
        
        // Get events to undo
        const events = await db.query.queueEvents.findMany({
            where: eq(schema.queueEvents.guildId, guildId),
            orderBy: desc(schema.queueEvents.sequence),
            limit: count,
        });

        if (events.length === 0) {
            return { success: false, error: 'No events to undo' };
        }

        // Delete the events
        const eventIds = events.map(e => e.id);
        await db.delete(schema.queueEvents).where(sql`${schema.queueEvents.id} IN (${eventIds.join(',')})`);

        // Rebuild state without those events
        const newState = await this.rebuildState(guildId);
        
        // Save new snapshot
        await this.saveSnapshot(guildId, newState);

        return { success: true, undoneEvents: events.length, newState };
    }
}

module.exports = new QueueEventStore();