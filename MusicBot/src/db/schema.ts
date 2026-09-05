import { 
  sqliteTable, 
  text, 
  integer, 
  real, 
  primaryKey,
  uniqueIndex,
  relations
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  isPublic: integer('is_public', { mode: 'boolean' }).default(true).notNull(),
  description: text('description').default(''),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
}, (table) => ({
  ownerNameIdx: uniqueIndex('playlists_owner_name_idx').on(table.ownerId, table.name),
}));

export const playlistTracks = sqliteTable('playlist_tracks', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull(),
  trackId: text('track_id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  url: text('url'),
  duration: integer('duration').default(0),
  thumbnail: text('thumbnail'),
  cover: text('cover'),
  platform: text('platform').default('youtube'),
  position: integer('position').notNull(),
  addedBy: text('added_by'),
  addedAt: text('added_at').default(sql`(datetime('now'))`).notNull(),
}, (table) => ({
  playlistPositionIdx: uniqueIndex('playlist_tracks_playlist_position_idx').on(table.playlistId, table.position),
  playlistTrackIdx: uniqueIndex('playlist_tracks_playlist_track_idx').on(table.playlistId, table.trackId),
}));

export const queueEvents = sqliteTable('queue_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`).notNull(),
  sequence: integer('sequence').notNull(),
}, (table) => ({
  guildSequenceIdx: uniqueIndex('queue_events_guild_sequence_idx').on(table.guildId, table.sequence),
}));

export const queueSnapshots = sqliteTable('queue_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`).notNull(),
}, (table) => ({
  guildTimestampIdx: uniqueIndex('queue_snapshots_guild_timestamp_idx').on(table.guildId, table.timestamp),
}));

export const karaokeJobs = sqliteTable('karaoke_jobs', {
  id: text('id').primaryKey(),
  songId: text('song_id').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).default('pending').notNull(),
  progress: real('progress').default(0),
  resultPath: text('result_path'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  completedAt: text('completed_at'),
}, (table) => ({
  statusIdx: uniqueIndex('karaoke_jobs_status_idx').on(table.status),
}));

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  discordId: text('discord_id').notNull().unique(),
  username: text('username').notNull(),
  globalName: text('global_name'),
  avatar: text('avatar'),
  role: integer('role', { mode: 'number' }).default(0).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

export const playlistsRelations = relations(playlists, ({ many }) => ({
  tracks: many(playlistTracks),
}));

export const playlistTracksRelations = relations(playlistTracks, ({ one }) => ({
  playlist: one(playlists, {
    fields: [playlistTracks.playlistId],
    references: [playlists.id],
  }),
}));

export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;

export type PlaylistTrack = typeof playlistTracks.$inferSelect;
export type NewPlaylistTrack = typeof playlistTracks.$inferInsert;

export type QueueEvent = typeof queueEvents.$inferSelect;
export type NewQueueEvent = typeof queueEvents.$inferInsert;

export type QueueSnapshot = typeof queueSnapshots.$inferSelect;
export type NewQueueSnapshot = typeof queueSnapshots.$inferInsert;

export type KaraokeJob = typeof karaokeJobs.$inferSelect;
export type NewKaraokeJob = typeof karaokeJobs.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;