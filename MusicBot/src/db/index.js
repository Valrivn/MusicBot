const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const schema = require('./schema');
const { eq, desc, and, asc, sql } = require('drizzle-orm');

const path = require('path');

/**
 * Resolve the SQLite database path immune to the process CWD.
 *  - Absolute DATABASE_PATH (docker volumes, Railway) is used as-is.
 *  - Relative DATABASE_PATH is pinned to the MusicBot root (src/db/..),
 *    never to the directory the process happened to be started from.
 *  - No DATABASE_PATH falls back to <MusicBot root>/voxaria.db.
 */
function resolveDbPath() {
    if (process.env.DATABASE_PATH) {
        return path.isAbsolute(process.env.DATABASE_PATH)
            ? process.env.DATABASE_PATH
            : path.join(__dirname, '..', process.env.DATABASE_PATH);
    }
    return path.join(__dirname, '..', 'voxaria.db');
}

const dbPath = resolveDbPath();
let dbInstance = null;

/**
 * Bootstrap DDL — mirrors src/db/schema.js (drizzle) as plain SQL so a fresh
 * deploy gets all tables without a manual migration step. Re-runs are no-ops
 * thanks to IF NOT EXISTS.
 */
const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    is_public INTEGER DEFAULT 1 NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS playlists_owner_name_idx ON playlists (owner_id, name);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    id TEXT PRIMARY KEY NOT NULL,
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    url TEXT,
    duration INTEGER DEFAULT 0,
    thumbnail TEXT,
    cover TEXT,
    platform TEXT DEFAULT 'youtube',
    position INTEGER NOT NULL,
    added_by TEXT,
    added_at TEXT DEFAULT (datetime('now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tracks_playlist_position_idx ON playlist_tracks (playlist_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tracks_playlist_track_idx ON playlist_tracks (playlist_id, track_id);

CREATE TABLE IF NOT EXISTS queue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')) NOT NULL,
    sequence INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS queue_events_guild_sequence_idx ON queue_events (guild_id, sequence);

CREATE TABLE IF NOT EXISTS queue_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    state TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS queue_snapshots_guild_timestamp_idx ON queue_snapshots (guild_id, timestamp);

CREATE TABLE IF NOT EXISTS karaoke_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    song_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    progress REAL DEFAULT 0,
    result_path TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS karaoke_jobs_status_idx ON karaoke_jobs (status);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    role INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);
`;

function getDb() {
    if (!dbInstance) {
        const sqlite = new Database(dbPath);

        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('synchronous = NORMAL');
        sqlite.pragma('cache_size = 10000');
        sqlite.pragma('temp_store = MEMORY');

        // Create schema on first open — idempotent on subsequent opens.
        sqlite.exec(BOOTSTRAP_DDL);

        dbInstance = drizzle(sqlite, { schema });
    }
    return dbInstance;
}

const db = getDb();

module.exports = {
    db,
    eq,
    desc,
    and,
    asc,
    sql,
    schema,
    playlistQueries: {
        async create(data) {
            return await db.insert(schema.playlists).values(data).returning();
        },

        async findById(id) {
            return await db.query.playlists.findFirst({
                where: eq(schema.playlists.id, id),
                with: {
                    tracks: {
                        orderBy: asc(schema.playlistTracks.position),
                    },
                },
            });
        },

        async findAll() {
            return await db.query.playlists.findMany({
                orderBy: desc(schema.playlists.createdAt),
                with: {
                    tracks: {
                        orderBy: asc(schema.playlistTracks.position),
                    },
                },
            });
        },

        async findByOwner(ownerId) {
            return await db.query.playlists.findMany({
                where: eq(schema.playlists.ownerId, ownerId),
                orderBy: desc(schema.playlists.createdAt),
                with: {
                    tracks: {
                        orderBy: asc(schema.playlistTracks.position),
                    },
                },
            });
        },

        async findPublic() {
            return await db.query.playlists.findMany({
                where: eq(schema.playlists.isPublic, 1),
                orderBy: desc(schema.playlists.createdAt),
                with: {
                    tracks: {
                        orderBy: asc(schema.playlistTracks.position),
                    },
                },
            });
        },

        async update(id, data) {
            return await db
                .update(schema.playlists)
                .set({ ...data, updatedAt: sql`(datetime('now'))` })
                .where(eq(schema.playlists.id, id))
                .returning();
        },

        async delete(id) {
            return await db.delete(schema.playlists).where(eq(schema.playlists.id, id)).returning();
        },

        async findByNameAndOwner(name, ownerId) {
            return await db.query.playlists.findFirst({
                where: and(
                    eq(schema.playlists.name, name),
                    eq(schema.playlists.ownerId, ownerId)
                ),
            });
        },
    },

    playlistTrackQueries: {
        async create(data) {
            return await db.insert(schema.playlistTracks).values(data).returning();
        },

        async findByPlaylist(playlistId) {
            return await db.query.playlistTracks.findMany({
                where: eq(schema.playlistTracks.playlistId, playlistId),
                orderBy: asc(schema.playlistTracks.position),
            });
        },

        async addTrack(playlistId, track) {
            const existingTracks = await db.query.playlistTracks.findMany({
                where: eq(schema.playlistTracks.playlistId, playlistId),
                columns: { position: true },
            });
            const nextPosition = existingTracks.length > 0
                ? Math.max(...existingTracks.map(t => t.position)) + 1
                : 0;

            return await db.insert(schema.playlistTracks).values({
                ...track,
                id: Math.random().toString(36).substring(2, 11),
                playlistId,
                position: nextPosition,
            }).returning();
        },

        async removeTrack(playlistId, trackId) {
            const result = await db
                .delete(schema.playlistTracks)
                .where(
                    and(
                        eq(schema.playlistTracks.playlistId, playlistId),
                        eq(schema.playlistTracks.trackId, trackId)
                    )
                )
                .returning();

            if (result.length > 0) {
                await this.reorderPositions(playlistId);
            }
            return result;
        },

        async reorderPositions(playlistId) {
            const tracks = await db.query.playlistTracks.findMany({
                where: eq(schema.playlistTracks.playlistId, playlistId),
                orderBy: asc(schema.playlistTracks.position),
            });

            for (let i = 0; i < tracks.length; i++) {
                if (tracks[i].position !== i) {
                    await db
                        .update(schema.playlistTracks)
                        .set({ position: i })
                        .where(eq(schema.playlistTracks.id, tracks[i].id));
                }
            }
        },

        async findDuplicate(playlistId, url) {
            return await db.query.playlistTracks.findFirst({
                where: and(
                    eq(schema.playlistTracks.playlistId, playlistId),
                    eq(schema.playlistTracks.url, url)
                ),
            });
        },

        async updatePositions(playlistId, trackPositions) {
            for (const { trackId, position } of trackPositions) {
                await db
                    .update(schema.playlistTracks)
                    .set({ position })
                    .where(
                        and(
                            eq(schema.playlistTracks.playlistId, playlistId),
                            eq(schema.playlistTracks.trackId, trackId)
                        )
                    );
            }
        },
    },

    queueEventQueries: {
        async create(data) {
            return await db.insert(schema.queueEvents).values(data).returning();
        },

        async findByGuild(guildId, limit = 100) {
            return await db.query.queueEvents.findMany({
                where: eq(schema.queueEvents.guildId, guildId),
                orderBy: desc(schema.queueEvents.sequence),
                limit,
            });
        },

        async getMaxSequence(guildId) {
            const result = await db
                .select({ maxSeq: sql`MAX(${schema.queueEvents.sequence})` })
                .from(schema.queueEvents)
                .where(eq(schema.queueEvents.guildId, guildId));
            return result[0]?.maxSeq ?? 0;
        },

        async deleteOldEvents(guildId, keepCount = 1000) {
            const maxSeq = await this.getMaxSequence(guildId);
            const threshold = maxSeq - keepCount;
            if (threshold > 0) {
                return await db
                    .delete(schema.queueEvents)
                    .where(
                        and(
                            eq(schema.queueEvents.guildId, guildId),
                            sql`${schema.queueEvents.sequence} < ${threshold}`
                        )
                    );
            }
        },
    },

    queueSnapshotQueries: {
        async create(data) {
            return await db.insert(schema.queueSnapshots).values(data).returning();
        },

        async findLatest(guildId) {
            return await db.query.queueSnapshots.findFirst({
                where: eq(schema.queueSnapshots.guildId, guildId),
                orderBy: desc(schema.queueSnapshots.timestamp),
            });
        },

        async deleteOldSnapshots(guildId, keepCount = 10) {
            const snapshots = await db.query.queueSnapshots.findMany({
                where: eq(schema.queueSnapshots.guildId, guildId),
                orderBy: desc(schema.queueSnapshots.timestamp),
            });
            if (snapshots.length > keepCount) {
                const toDelete = snapshots.slice(keepCount);
                const ids = toDelete.map(s => s.id);
                return await db.delete(schema.queueSnapshots).where(sql`${schema.queueSnapshots.id} IN (${ids.join(',')})`);
            }
        },
    },

    karaokeJobQueries: {
        async create(data) {
            return await db.insert(schema.karaokeJobs).values(data).returning();
        },

        async findById(id) {
            return await db.query.karaokeJobs.findFirst({
                where: eq(schema.karaokeJobs.id, id),
            });
        },

        async findBySongId(songId) {
            return await db.query.karaokeJobs.findFirst({
                where: eq(schema.karaokeJobs.songId, songId),
                orderBy: desc(schema.karaokeJobs.createdAt),
            });
        },

        async findPending() {
            return await db.query.karaokeJobs.findMany({
                where: eq(schema.karaokeJobs.status, 'pending'),
                orderBy: asc(schema.karaokeJobs.createdAt),
            });
        },

        async updateStatus(id, status, progress, resultPath, errorMessage) {
            const updateData = { status };
            if (progress !== undefined) updateData.progress = progress;
            if (resultPath !== undefined) updateData.resultPath = resultPath;
            if (errorMessage !== undefined) updateData.errorMessage = errorMessage;
            if (status === 'completed' || status === 'failed') {
                updateData.completedAt = sql`(datetime('now'))`;
            }
            return await db
                .update(schema.karaokeJobs)
                .set(updateData)
                .where(eq(schema.karaokeJobs.id, id))
                .returning();
        },
    },

    userQueries: {
        async create(data) {
            return await db.insert(schema.users).values(data).returning();
        },

        async findByDiscordId(discordId) {
            return await db.query.users.findFirst({
                where: eq(schema.users.discordId, discordId),
            });
        },

        async findById(id) {
            return await db.query.users.findFirst({
                where: eq(schema.users.id, id),
            });
        },

        async update(id, data) {
            return await db
                .update(schema.users)
                .set({ ...data, updatedAt: sql`(datetime('now'))` })
                .where(eq(schema.users.id, id))
                .returning();
        },

        async upsert(discordId, data) {
            const existing = await this.findByDiscordId(discordId);
            if (existing) {
                return await this.update(existing.id, data);
            }
            return await this.create({ discordId, ...data });
        },
    },

    closeDb() {
        if (dbInstance) {
            const sqlite = dbInstance.$.client;
            if (sqlite && typeof sqlite.close === 'function') {
                sqlite.close();
            }
            dbInstance = null;
        }
    },
};

process.on('SIGINT', () => {
    module.exports.closeDb();
    process.exit(0);
});

process.on('SIGTERM', () => {
    module.exports.closeDb();
    process.exit(0);
});