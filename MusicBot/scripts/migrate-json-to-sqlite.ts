import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../src/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const PLAYLISTS_JSON_PATH = path.join(__dirname, '..', 'database', 'playlists.json');
const DB_PATH = path.join(__dirname, '..', 'voxaria.db');

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

interface JsonPlaylist {
  id: string;
  name: string;
  ownerId?: string;
  isPublic?: boolean;
  description?: string;
  tracks: Array<{
    id: string;
    title: string;
    song?: string;
    artist: string;
    url?: string;
    duration?: number;
    thumbnail?: string | null;
    cover?: string | null;
    platform?: string;
    addedBy?: string;
    addedAt?: string;
  }>;
  savedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

function readJsonPlaylists(): JsonPlaylist[] {
  if (!fs.existsSync(PLAYLISTS_JSON_PATH)) {
    console.log('❌ playlists.json not found at:', PLAYLISTS_JSON_PATH);
    return [];
  }
  
  const raw = fs.readFileSync(PLAYLISTS_JSON_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('❌ Failed to parse playlists.json:', e);
    return [];
  }
}

async function migrate() {
  console.log('🚀 Starting JSON to SQLite migration...');
  
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  
  const db = drizzle(sqlite, { schema });
  
  const jsonPlaylists = readJsonPlaylists();
  console.log(`📊 Found ${jsonPlaylists.length} playlists in JSON`);
  
  let migratedPlaylists = 0;
  let migratedTracks = 0;
  let errors = 0;
  
  for (const jsonPlaylist of jsonPlaylists) {
    try {
      const playlistId = jsonPlaylist.id || generateId();
      const ownerId = jsonPlaylist.ownerId || 'unknown';
      const isPublic = jsonPlaylist.isPublic ?? true;
      const description = jsonPlaylist.description || '';
      const createdAt = jsonPlaylist.createdAt || jsonPlaylist.savedAt || new Date().toISOString();
      const updatedAt = jsonPlaylist.updatedAt || jsonPlaylist.savedAt || new Date().toISOString();
      
      // Check if playlist already exists
      const existing = await db.query.playlists.findFirst({
        where: eq(schema.playlists.id, playlistId),
      });
      
      if (existing) {
        console.log(`⏭️  Playlist "${jsonPlaylist.name}" (${playlistId}) already exists, skipping...`);
        continue;
      }
      
      // Insert playlist
      await db.insert(schema.playlists).values({
        id: playlistId,
        name: jsonPlaylist.name,
        ownerId,
        isPublic: isPublic ? 1 : 0,
        description,
        createdAt,
        updatedAt,
      });
      
      migratedPlaylists++;
      console.log(`✅ Created playlist: "${jsonPlaylist.name}" (${playlistId})`);
      
      // Insert tracks
      const tracks = jsonPlaylist.tracks || [];
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const trackId = track.id || track.url || generateId();
        
        // Check for duplicate
        const existingTrack = await db.query.playlistTracks.findFirst({
          where: (fields, { and, eq }) => and(
            eq(fields.playlistId, playlistId),
            eq(fields.trackId, trackId)
          ),
        });
        
        if (existingTrack) {
          console.log(`  ⏭️  Track "${track.title}" already exists, skipping...`);
          continue;
        }
        
        await db.insert(schema.playlistTracks).values({
          id: generateId(),
          playlistId,
          trackId,
          title: track.title || track.song || 'Unknown',
          artist: track.artist || 'Unknown',
          url: track.url || null,
          duration: track.duration || 0,
          thumbnail: track.thumbnail || track.cover || null,
          cover: track.cover || track.thumbnail || null,
          platform: track.platform || 'youtube',
          position: i,
          addedBy: track.addedBy || ownerId,
          addedAt: track.addedAt || createdAt,
        });
        
        migratedTracks++;
        console.log(`  🎵 Added track: "${track.title || track.song || 'Unknown'}"`);
      }
      
    } catch (error) {
      errors++;
      console.error(`❌ Error migrating playlist "${jsonPlaylist.name}":`, error);
    }
  }
  
  console.log('\n📈 Migration Summary:');
  console.log(`   Playlists migrated: ${migratedPlaylists}`);
  console.log(`   Tracks migrated: ${migratedTracks}`);
  console.log(`   Errors: ${errors}`);
  
  // Verify migration
  const totalPlaylists = await db.select({ count: sql`COUNT(*)` }).from(schema.playlists);
  const totalTracks = await db.select({ count: sql`COUNT(*)` }).from(schema.playlistTracks);
  
  console.log('\n🔍 Verification:');
  console.log(`   Total playlists in DB: ${totalPlaylists[0].count}`);
  console.log(`   Total tracks in DB: ${totalTracks[0].count}`);
  
  sqlite.close();
  console.log('\n✨ Migration complete!');
}

migrate().catch(console.error);