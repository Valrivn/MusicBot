import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { eq, desc, and, asc, sql } from 'drizzle-orm';

const dbPath = './voxaria.db';
let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!dbInstance) {
    const sqlite = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('cache_size = 10000');
    sqlite.pragma('temp_store = MEMORY');
    
    dbInstance = drizzle(sqlite, { schema });
  }
  return dbInstance;
}

export const db = getDb();

export { eq, desc, and, asc, sql };

export const playlistQueries = {
  async create(data: schema.NewPlaylist) {
    return await db.insert(schema.playlists).values(data).returning();
  },

  async findById(id: string) {
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

  async findByOwner(ownerId: string) {
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

  async update(id: string, data: Partial<schema.NewPlaylist>) {
    return await db
      .update(schema.playlists)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.playlists.id, id))
      .returning();
  },

  async delete(id: string) {
    return await db.delete(schema.playlists).where(eq(schema.playlists.id, id)).returning();
  },

  async findByNameAndOwner(name: string, ownerId: string) {
    return await db.query.playlists.findFirst({
      where: and(
        eq(schema.playlists.name, name),
        eq(schema.playlists.ownerId, ownerId)
      ),
    });
  },
};

export const playlistTrackQueries = {
  async create(data: schema.NewPlaylistTrack) {
    return await db.insert(schema.playlistTracks).values(data).returning();
  },

  async findByPlaylist(playlistId: string) {
    return await db.query.playlistTracks.findMany({
      where: eq(schema.playlistTracks.playlistId, playlistId),
      orderBy: asc(schema.playlistTracks.position),
    });
  },

  async addTrack(playlistId: string, track: Omit<schema.NewPlaylistTrack, 'playlistId' | 'position'>) {
    const existingTracks = await db.query.playlistTracks.findMany({
      where: eq(schema.playlistTracks.playlistId, playlistId),
      columns: { position: true },
    });
    const nextPosition = existingTracks.length > 0 
      ? Math.max(...existingTracks.map(t => t.position)) + 1 
      : 0;

    return await db.insert(schema.playlistTracks).values({
      ...track,
      playlistId,
      position: nextPosition,
    }).returning();
  },

  async removeTrack(playlistId: string, trackId: string) {
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

  async reorderPositions(playlistId: string) {
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

  async findDuplicate(playlistId: string, url: string) {
    return await db.query.playlistTracks.findFirst({
      where: and(
        eq(schema.playlistTracks.playlistId, playlistId),
        eq(schema.playlistTracks.url, url)
      ),
    });
  },

  async updatePositions(playlistId: string, trackPositions: Array<{ trackId: string; position: number }>) {
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
};

export const queueEventQueries = {
  async create(data: schema.NewQueueEvent) {
    return await db.insert(schema.queueEvents).values(data).returning();
  },

  async findByGuild(guildId: string, limit = 100) {
    return await db.query.queueEvents.findMany({
      where: eq(schema.queueEvents.guildId, guildId),
      orderBy: desc(schema.queueEvents.sequence),
      limit,
    });
  },

  async getMaxSequence(guildId: string) {
    const result = await db
      .select({ maxSeq: sql`MAX(${schema.queueEvents.sequence})` })
      .from(schema.queueEvents)
      .where(eq(schema.queueEvents.guildId, guildId));
    return result[0]?.maxSeq ?? 0;
  },

  async deleteOldEvents(guildId: string, keepCount = 1000) {
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
};

export const queueSnapshotQueries = {
  async create(data: schema.NewQueueSnapshot) {
    return await db.insert(schema.queueSnapshots).values(data).returning();
  },

  async findLatest(guildId: string) {
    return await db.query.queueSnapshots.findFirst({
      where: eq(schema.queueSnapshots.guildId, guildId),
      orderBy: desc(schema.queueSnapshots.timestamp),
    });
  },

  async deleteOldSnapshots(guildId: string, keepCount = 10) {
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
};

export const karaokeJobQueries = {
  async create(data: schema.NewKaraokeJob) {
    return await db.insert(schema.karaokeJobs).values(data).returning();
  },

  async findById(id: string) {
    return await db.query.karaokeJobs.findFirst({
      where: eq(schema.karaokeJobs.id, id),
    });
  },

  async findBySongId(songId: string) {
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

  async updateStatus(id: string, status: schema.KaraokeJob['status'], progress?: number, resultPath?: string, errorMessage?: string) {
    const updateData: Partial<schema.NewKaraokeJob> = { status };
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
};

export const userQueries = {
  async create(data: schema.NewUser) {
    return await db.insert(schema.users).values(data).returning();
  },

  async findByDiscordId(discordId: string) {
    return await db.query.users.findFirst({
      where: eq(schema.users.discordId, discordId),
    });
  },

  async findById(id: string) {
    return await db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
  },

  async update(id: string, data: Partial<schema.NewUser>) {
    return await db
      .update(schema.users)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.users.id, id))
      .returning();
  },

  async upsert(discordId: string, data: Partial<schema.NewUser>) {
    const existing = await this.findByDiscordId(discordId);
    if (existing) {
      return await this.update(existing.id, data);
    }
    return await this.create({ discordId, ...data } as schema.NewUser);
  },
};

export function closeDb() {
  if (dbInstance) {
    const sqlite = (dbInstance as any).$.client;
    if (sqlite && typeof sqlite.close === 'function') {
      sqlite.close();
    }
    dbInstance = null;
  }
}

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});