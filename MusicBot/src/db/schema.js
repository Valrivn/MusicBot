const { 
  sqliteTable, 
  text, 
  integer, 
  real, 
  primaryKey,
  uniqueIndex
} = require('drizzle-orm/sqlite-core');
const { sql, relations } = require('drizzle-orm');

const playlists = sqliteTable('playlists', {
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

const playlistTracks = sqliteTable('playlist_tracks', {
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

const queueEvents = sqliteTable('queue_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`).notNull(),
  sequence: integer('sequence').notNull(),
}, (table) => ({
  guildSequenceIdx: uniqueIndex('queue_events_guild_sequence_idx').on(table.guildId, table.sequence),
}));

const queueSnapshots = sqliteTable('queue_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`).notNull(),
}, (table) => ({
  guildTimestampIdx: uniqueIndex('queue_snapshots_guild_timestamp_idx').on(table.guildId, table.timestamp),
}));

const karaokeJobs = sqliteTable('karaoke_jobs', {
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

const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  discordId: text('discord_id').notNull().unique(),
  username: text('username').notNull(),
  globalName: text('global_name'),
  avatar: text('avatar'),
  role: integer('role', { mode: 'number' }).default(0).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

const playlistsRelations = relations(playlists, ({ many }) => ({
  tracks: many(playlistTracks),
}));

const playlistTracksRelations = relations(playlistTracks, ({ one }) => ({
  playlist: one(playlists, {
    fields: [playlistTracks.playlistId],
    references: [playlists.id],
  }),
}));

module.exports = {
  playlists,
  playlistTracks,
  queueEvents,
  queueSnapshots,
  karaokeJobs,
  users,
  playlistsRelations,
  playlistTracksRelations,
};