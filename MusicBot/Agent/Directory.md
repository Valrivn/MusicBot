Enhanced Directory.md Plan: The Permanent Architectural Blueprint
📁 Category 1: Structural File-to-Function Mapping (Domain Architecture)
Domain	File	Core Responsibility	Key Data Contracts
Bootstrap	src/bootstrap/Bootstrap.js	App entry, shard orchestration, client lifecycle	Bootstrap.start(), Bootstrap.shutdown()
 	src/bootstrap/DiscordClient.js	Discord.js client wrapper, intent config, shard events	DiscordClient.create(), DiscordClient.login()
 	src/bootstrap/EventHandlers.js	Discord event bindings (ready, interactionCreate, voiceStateUpdate)	EventHandlers.register(client)
 	src/bootstrap/ProcessHandlers.js	SIGINT/SIGTERM, unhandledRejection, graceful shutdown	ProcessHandlers.register()
 	src/bootstrap/SessionRestore.js	Restore PlayerCore state from database/playerState.json on startup	SessionRestore.restoreAll(client)
Core Player	src/MusicPlayer.js	Guild player registry, singleton per guild	MusicPlayer.get(guildId), MusicPlayer.create(guild, textCh, voiceCh)
 	src/player/PlayerCore.js	High-level facade: queue, playback, UI, persistence delegates	PlayerCore.play(), PlayerCore.addTrack(), PlayerCore.getQueue()
 	src/player/AudioEngineCore.js	Low-level audio: @discordjs/voice player, stream resolution, watchdog	AudioEngineCore.play(), AudioEngineCore.preloadTrack(), AudioEngineCore.fetchAndStartLyrics()
 	src/player/TrackManager.js	LRCLIB-Anchored Pipeline (5 stages): query parse → LRCLIB anchor → MB harvest → Cover Art → YT filter (±3s)	TrackManager.addTrack(), TrackManager._resolveTextQuery(), TrackManager._parseTextQuery()
 	src/player/StreamResolver.js	Platform detection, fresh stream resolution (never cached URLs)	StreamResolver.detectPlatform(), StreamResolver.resolveStream()
 	src/player/PlaybackController.js	Pause/resume/skip/previous/stop logic, loop modes	PlaybackController.pause(), PlaybackController.skip(), PlaybackController.handleTrackEnd()
 	src/player/AudioResourceFactory.js	Creates AudioResource from stream/file with Opus/FFmpeg	AudioResourceFactory.createFromStream(), AudioResourceFactory.createFromFile()
 	src/player/DownloadManager.js	Background Opus download, cache management (audio_cache/track_<hash>.opus)	DownloadManager.downloadTrack(), DownloadManager.deleteDownloadedFile()
 	src/player/StatePersistence.js	Serializes PlayerCore state to database/playerState.json	StatePersistence.persistState(), StatePersistence.restoreFromState()
 	src/player/PlayerUI.js	Discord embed builders, button components, progress bars	PlayerUI.createNewMusicEmbed(), PlayerUI.updateNowPlayingEmbed()
 	src/player/LyricsHandler.js	Wave orchestration: Wave 1 (cache+Matcher) → Wave 2 (Genius+YTMusic) → Final Resort	LyricsHandler.fetchLyrics(), LyricsHandler.formatFullLyrics()
 	src/player/AutoPlayEngine.js	Autoplay recommendations based on last track	AutoPlayEngine.handleAutoplay()
 	src/player/VoiceConnection.js	Voice connection lifecycle, reconnection, recovery	VoiceConnectionHandler.connect(), VoiceConnectionHandler.startConnectionRecovery()
Commands	src/commands/play.js	/play - queue tracks from YT/SC/Direct/Text	execute(interaction, query)
 	src/commands/search.js	/search - search YT/SC, return select menu	execute(interaction, query)
 	src/commands/nowplaying.js	/nowplaying - current track + lyrics pagination	execute(interaction)
 	src/commands/help.js	/help - command reference embed	execute(interaction)
 	src/commands/language.js	/language - set guild language	execute(interaction, locale)
Music Sources	src/YouTube.js	Ultimatum Matrix: search → score (drift±3s, artist match, Topic channel) → audit log	YouTube.search(), YouTube.resolveMetadataTrack(), YouTube.getStream(), YouTube.getTranscript()
 	src/SoundCloud.js	SC resolve, stream extraction	SoundCloud.getInfo(), SoundCloud.getStream()
 	src/DirectLink.js	Direct audio URL handling	DirectLink.getInfo(), DirectLink.getStream()
Lyrics System	src/LyricsManager.js	Wave Engine: W0(cache) → W1.1(LRCLIB handshake) → W1.2(YTMusic) → W1.3(prefetch) → W2(plain) → Final Resort	LyricsManager.fetchLyrics(), LyricsManager.selectBestLyrics(), LyricsManager.runLyricsMatcher()
 	src/LyricsMatcher.js	Handshake Protocol: LRCLIB candidates ±3s of Studio Baseline → MB Consensus fallback	LyricsMatcher.match(title, artist) → {lockedDurationMs, candidates[], fallbackUsed}
 	src/lrclib/LrclibClient.js	lrclib.net API client (synced lyrics priority)	LrclibClient.searchTrack(), LrclibClient.searchAllTracks()
MusicBrainz	src/musicbrainz/MusicBrainzClient.js	Consensus Engine: studio album baseline, major-label filter, duration consensus, LRCLIB anchor filter (±3s)	MusicBrainzClient.searchRecordingWithDurationAnchor(), MusicBrainzClient.getStudioAlbumBaseline()
 	src/musicbrainz/CoverArtResolver.js	Cover Art Archive: release → release-group fallback, size selection	CoverArtResolver.resolveCoverArt(releaseMbid, releaseGroupMbid, size)
 	src/musicbrainz/RateLimiter.js	Token bucket (1 req/sec)	RateLimiter.acquire()
 	src/musicbrainz/RequestQueue.js	Sequential request queue with retry	RequestQueue.enqueue(fn)
 	src/musicbrainz/Cache.js	In-memory + disk cache (cache/musicbrainz/)	Cache.get(key), Cache.set(key, value)
Utilities	src/SessionManager.js	Per-guild session state (voice, text, player ref)	SessionManager.get(guildId), SessionManager.set(guildId, data)
 	src/PlayerStateManager.js	Player state persistence to disk	PlayerStateManager.saveState(guildId, state), PlayerStateManager.loadState(guildId)
 	src/LanguageManager.js	i18n: loads database/languages.json, per-guild locale	LanguageManager.getTranslation(guildId, key)
 	src/ErrorHandler.js	Centralized error handling, user-facing messages	ErrorHandler.handle(error, guildId, context)
 	src/AuditLog.js	Command audit trail to audit_log.json	AuditLog.append(entry)
 	src/trackCache.js	Tiered TTL Cache: mainstream (30d) vs indie (7d), key: track:{normTitle}:{normArtist}:{durationSec}	trackCache.get(key), trackCache.set(key, value, tier), trackCache.normalizeKey()
 	src/utils/retry.js	Generic retry with exponential backoff	fetchWithRetry(fn, {retries, baseDelay, maxDelay})
 	src/commandLoader.js	Dynamic command registration from src/commands/	commandLoader.loadCommands(client)
API Server	src/api/server.js	Express app, middleware, health check	server.start(port)
 	src/api/routes/system.js	/api/system/health, /api/system/stats, /api/system/version	REST endpoints
 	src/api/routes/presets.js	/api/presets CRUD (EQ presets)	REST endpoints
 	src/api/routes/music.js	/api/music/play, /api/music/queue, /api/music/skip	REST endpoints
 	src/api/routes/karaoke.js	/api/karaoke/remove-vocals, /api/karaoke/status	REST endpoints
📐 Category 2: Interface Skeletons (Method Signatures + Return Contracts)
// ============================================================
// BOOTSTRAP LAYER
// ============================================================
class Bootstrap {
  static async start(): Promise<DiscordClient>           // Returns logged-in client
  static async shutdown(): Promise<void>                 // Graceful shutdown all shards
}

class DiscordClient {
  static create(config: Config): Discord.Client          // Configured client instance
  async login(token: string): Promise<string>            // Returns gateway URL
}

class EventHandlers {
  static register(client: Discord.Client): void          // Binds ready, interactionCreate, voiceStateUpdate
}

class ProcessHandlers {
  static register(): void                                // SIGINT, SIGTERM, unhandledRejection
}

class SessionRestore {
  static async restoreAll(client: Discord.Client): Promise<Map<string, PlayerState>>  // guildId → restored state
}

// ============================================================
// CORE PLAYER - PLAYERCORE (Facade)
// ============================================================
class PlayerCore {
  constructor(guild: Guild, textChannel: TextChannel, voiceChannel: VoiceChannel)
  
  // Queue & Playback
  async addTrack(query: string, requestedBy: User, platform?: 'auto'|'youtube'|'soundcloud'|'direct'): Promise<AddTrackResult>
  async play(trackIndex?: number, seekMs?: number): Promise<PlayResult>
  pause(reason?: string): boolean
  resume(reason?: string): boolean
  skip(): boolean
  previous(): boolean
  stop(): void
  setVolume(volume: number): number
  
  // Queue Management
  getQueue(): QueueState                    // {current, queue[], previous[], totalTracks, duration}
  shuffleQueue(): Track[]
  setLoop(mode: false|'track'|'queue'): false|'track'|'queue'
  setShuffle(enabled: boolean): boolean
  clear(): number
  removeFromQueue(index: number): Track|null
  moveInQueue(from: number, to: number): boolean
  
  // State & Persistence
  persistState(reason: string, immediate?: boolean): Promise<void>
  restoreFromState(state: PlayerState): Promise<void>
  broadcastStateUpdate(): void
  getStatus(): PlayerStatus
  
  // Lyrics
  async fetchAndStartLyrics(): Promise<LyricsData|null>
  hasLyrics(): boolean
  
  // Cleanup
  cleanup(isShutdown?: boolean): Promise<void>
  destroy(): void
}

// AddTrackResult Contract
interface AddTrackResult {
  success: boolean
  message?: string
  tracks?: Track[]
  isPlaylist?: boolean
  position?: number
}

// Track Contract (returned by TrackManager pipeline)
interface Track {
  url: string                    // YouTube watch URL (never direct stream URL)
  rawUrl?: string                // Direct stream URL (ephemeral, 6hr TTL)
  title: string
  artist: string
  duration: number               // seconds
  durationMs: number             // milliseconds (authoritative)
  thumbnail: string
  albumCover: string
  platform: 'youtube'|'soundcloud'|'direct'
  originalPlatform: 'text'|'youtube'|'youtube-url'|'soundcloud'|'direct'
  type: 'track'
  id: string                     // YouTube video ID
  canSeek: boolean
  lrclibAnchor: boolean          // True if LRCLIB duration anchor locked
  youtubeFallback: boolean       // True if YT fallback used
  lyrics?: LyricsData            // Pre-fetched transcript if available
  mbid?: string                  // MusicBrainz recording MBID
  releaseMbid?: string
  releaseGroupMbid?: string
  popularityCount?: number
  majorLabel?: boolean
}

// ============================================================
// CORE PLAYER - AUDIOENGINECORE (Low-Level)
// ============================================================
class AudioEngineCore {
  constructor(player: PlayerCore)
  
  async play(trackIndex?: number, seekMs?: number): Promise<PlayResult>
  async playStream(trackPayload: Track): Promise<PlayResult>
  async preloadTrack(track: Track): Promise<void>
  async fetchAndStartLyrics(): Promise<LyricsData|null>
  hasLyrics(): boolean
  
  // Stream Resolution (delegates to StreamResolver)
  detectPlatform(query: string): 'youtube'|'soundcloud'|'direct'|'text'
  
  // Download & Cache
  async downloadTrack(track: Track, streamUrl: string, streamInfo: any): Promise<string>  // Returns filepath
  async deleteDownloadedFile(filepath: string): Promise<void>
  
  // Volume & Time
  setVolume(volume: number): number
  getCurrentTime(): number                    // milliseconds from track start
  
  // Lifecycle
  cleanup(): void
}

// ============================================================
// TRACK MANAGER - LRCLIB-ANCHORED PIPELINE
// ============================================================
class TrackManager {
  constructor(player: PlayerCore)
  
  async addTrack(query: string|Track, requestedBy: User, platform?: string): Promise<AddTrackResult>
  
  // Pipeline Stages (private but documented for architecture)
  async _resolveTextQuery(query: string, guildId: string): Promise<Track|null>
  async _resolveYouTubeTrack(query: string, guildId: string): Promise<Track|null>
  async _resolveSoundCloudTrack(query: string, guildId: string): Promise<Track|null>
  async _resolveDirectTrack(query: string, guildId: string): Promise<Track|null>
  
  _parseTextQuery(query: string): {title: string, artist: string}
  _parseYouTubeTitle(title: string): {title: string, artist: string}|null
  
  // Queue Operations
  removeTrack(index: number): Track|null
  moveToHistory(track: Track): void
  shuffle(): Track[]
  clear(): number
  getQueue(): QueueState
  getTotalDuration(): number
}

// ============================================================
// STREAM RESOLVER
// ============================================================
class StreamResolver {
  static detectPlatform(query: string): 'youtube'|'soundcloud'|'direct'|'text'
  static async resolveStream(track: Track, guildId: string, resumeFromSeconds: number): Promise<StreamInfo|null>
  static async resolveDownloadUrl(track: Track, guildId: string): Promise<string>
}

interface StreamInfo {
  url: string                    // Direct stream URL (googlevideo.com)
  stream?: Readable              // Optional readable stream
  duration: number               // seconds
  canSeek: boolean
  httpHeaders?: Record<string, string>
  rawUrl?: string
}

// ============================================================
// YOUTUBE - ULTIMATUM MATRIX
// ============================================================
class YouTube {
  static getYtDlpOptions(extra?: object): object
  
  // Search & Metadata
  static async search(query: string, limit: number, guildId: string): Promise<YTSearchResult[]>
  static async getVideoMetadata(url: string): Promise<YTVideoMeta|null>
  static async getTranscript(videoId: string): Promise<TranscriptData|null>
  
  // Core Resolution (Strict ±3s Duration Matching)
  static async resolveMetadataTrack(
    targetTitle: string,
    targetArtists: string[],
    targetDurationMs: number,
    targetAlbumCover: string,
    guildId: string
  ): Promise<Track|null>
  
  // Stream Extraction (Fresh every play - 6hr TTL)
  static async getStream(url: string, guildId: string, resumeFromSeconds: number): Promise<StreamInfo>
  
  // Helpers
  static isYouTubeURL(url: string): boolean
  static extractVideoId(url: string): string|null
}

interface YTSearchResult {
  id: string
  title: string
  channel: string
  uploader: string
  duration: number
  durationMs: number
  thumbnail: string
  webpage_url: string
  url: string
}

interface YTVideoMeta {
  title: string
  artist: string
  durationMs: number
  thumbnail: string
  videoId: string
}

interface TranscriptData {
  synced: string
  plain: string
  hasSynced: boolean
  language: string
  source: 'youtube-transcript'
}

// ============================================================
// LYRICS SYSTEM - WAVE ENGINE
// ============================================================
class LyricsManager {
  // Main Entry
  async fetchLyrics(track: Track, forceResync?: boolean): Promise<LyricsData|null>
  
  // Wave 0: Unified Caches
  checkYTCache(videoId: string): LyricsData|null
  checkTrackCache(trackId: string): LyricsData|null
  
  // Wave 1.1: LRCLIB Handshake (via LyricsMatcher)
  async runLyricsMatcher(title: string, artist: string, forceResync?: boolean): Promise<MatcherResult>
  
  // Wave 1.2: YouTube Music Harvest (Python script)
  async runYTMusicHarvest(videoId: string, title: string, artist: string, lockedDurationMs: number, track: Track): Promise<HarvestResult>
  
  // Wave 1.3: Pre-fetched Memory Check
  buildCandidateFromTrackLyrics(track: Track, lockedDurationMs: number): LyricsCandidate|null
  
  // Wave 2: Plain Fallback Layer (Penalty Engine)
  async runGeniusPlain(title: string, artist: string, lockedDurationMs: number, track: Track): Promise<LyricsCandidate|null>
  selectBestLyrics(candidates: LyricsCandidate[], targetTrack: Track): LyricsCandidate|null
  
  // Final Resort
  async runFinalResort(videoId: string, title: string, artist: string, lockedDurationMs: number, track: Track): Promise<LyricsCandidate|null>
  
  // Cache & Format
  formatAndCache(winner: LyricsCandidate, trackId: string, title: string, artist: string, forceResync?: boolean): LyricsData
  storeInCache(trackId: string, data: LyricsData, forceResync?: boolean): void
  clearCache(): void
}

interface LyricsData {
  title: string
  artist: string
  source: string
  synced: string              // "[mm:ss.xx] line" format
  plain: string
  hasSynced: boolean
  lines: string[]
}

interface LyricsCandidate {
  synced: string
  plain: string
  artistName: string
  trackName: string
  durationMs: number
  source: string
  lrclibId?: string
}

interface MatcherResult {
  success: boolean
  lockedDurationMs: number|null
  lockedCandidate: LyricsCandidate|null
  candidates: LyricsCandidate[]      // Filtered ±3s of locked duration
  allCandidates: LyricsCandidate[]   // All LRCLIB results
  fallbackUsed: 'studio-match'|'mb-consensus'|'first-candidate'|'no-candidates'
  studioBaseline: number|null
}

interface HarvestResult {
  isSynced: boolean
  synced: string
  plain: string
  source: 'YouTube Music'
}

// ============================================================
// LYRICS MATCHER - HANDSHAKE PROTOCOL
// ============================================================
class LyricsMatcher {
  static async match(title: string, artist: string): Promise<MatcherResult>
}

// ============================================================
// LRCLIB CLIENT
// ============================================================
class LrclibClient {
  static async searchTrack(title: string, artist: string): Promise<LRCLIBTrack|null>
  static async searchAllTracks(title: string, artist: string): Promise<LRCLIBTrack[]>
  static async getTrackById(id: string): Promise<any>
}

interface LRCLIBTrack {
  title: string
  artist: string
  album: string
  durationMs: number
  durationSec: number
  hasSyncedLyrics: boolean
  syncedLyrics: string
  plainLyrics: string
  lrclibId: string
}

// ============================================================
// MUSICBRAINZ - CONSENSUS ENGINE
// ============================================================
class MusicBrainzClient {
  static async fetchWithRateLimit(url: string): Promise<any>
  static _sanitizeQuery(str: string): string
  static parseQuery(query: string): {title: string, artist: string}
  
  // Studio Album Baseline (Major Label Only)
  static async getStudioAlbumBaseline(title: string, artist: string): Promise<number|null>  // Returns durationMs
  
  // Consensus Search with LRCLIB Anchor Filter (±3s)
  static async searchRecordingWithDurationAnchor(title: string, artist: string, lrclibDurationMs: number): Promise<MBRecording|null>
  static async searchRecording(title: string, artist: string): Promise<MBRecording|null>
  
  // Title Search (Playlist Builder)
  static async searchRecordingsByTitle(title: string, limit?: number): Promise<MBTitleSearchResult[]>
}

interface MBRecording {
  title: string
  artist: string
  durationMs: number
  releaseMbid: string
  releaseGroupMbid: string
  mbid: string
  popularityCount: number
  majorLabel: boolean
}

interface MBTitleSearchResult {
  title: string
  artist: string
  allArtists: string[]
  durationMs: number
  durationSec: number
  releaseMbid: string
  releaseGroupMbid: string
  mbid: string
  popularityCount: number
  recordingCount: number
}

// ============================================================
// COVER ART RESOLVER
// ============================================================
class CoverArtResolver {
  static async resolveCoverArt(releaseMbid: string, releaseGroupMbid: string, size: '250'|'500'|'1200'): Promise<string|null>
}

// ============================================================
// TRACK CACHE - TIERED TTL
// ============================================================
class TrackCache {
  constructor()
  
  get(key: string): Track|null
  set(key: string, value: Track, tier?: 'mainstream'|'indie'): void
  delete(key: string): void
  clear(): void
  
  // Key Format: track:{normTitle}:{normArtist}:{durationSec}
  normalizeKey(title: string, artist: string, durationSec: number): string
  
  // TTL Config (from config.js)
  // mainstream: 30 days (popularityCount >= 10 AND majorLabel)
  // indie: 7 days
}

// ============================================================
// UTILITIES
// ============================================================
class LanguageManager {
  static async getTranslation(guildId: string, key: string): Promise<string>
  static getSupportedLanguages(): string[]
  static setGuildLanguage(guildId: string, locale: string): void
}

class ErrorHandler {
  static async handle(error: Error, guildId: string, context: string): Promise<string>  // Returns user-facing message
}

class AuditLog {
  static append(entry: AuditEntry): Promise<void>
}

interface AuditEntry {
  id: string
  title: string
  url: string
  requesterId: string
  requesterTag: string
  requesterAvatar: string
  timestamp: string  // ISO8601
}

// ============================================================
// API ROUTES (Express)
// ============================================================
// GET  /api/system/health          → {status, uptime, memory, shards}
// GET  /api/system/stats           → {guilds, users, players, queueTotal}
// GET  /api/system/version         → {version, node, discordjs}
//
// GET  /api/presets                → Preset[]
// POST /api/presets                → {name, bands: number[]}
// PUT  /api/presets/:name          → {bands: number[]}
// DELETE /api/presets/:name        → void
//
// POST /api/music/play             → {guildId, query, requestedBy}
// GET  /api/music/queue/:guildId   → QueueState
// POST /api/music/skip/:guildId    → void
// POST /api/music/stop/:guildId    → void
// POST /api/music/volume/:guildId  → {volume}
//
// POST /api/karaoke/remove-vocals  → {guildId, trackUrl}
// GET  /api/karaoke/status/:guildId → {processing, progress, outputUrl}
🗂️ Category 3: Shared Global Constants & Cache Contract Paths
// ============================================================
// FILESYSTEM CONTRACTS (Hardcoded Paths - DO NOT CHANGE)
// ============================================================

// Track Metadata Cache (Tiered TTL)
// Location: ./cache/tracks/track_{normTitle}_{normArtist}_{durationSec}.json
// Key Format: track:{normTitle}:{normArtist}:{durationSec}
// TTL: mainstream=30d (popularityCount>=10 && majorLabel), indie=7d
// Schema: {key, value: Track, createdAt, expiresAt, tier}

// Lyrics Cache (YouTube Video ID)
// Location: ./audio_cache/lyrics_YT_{videoId}.json
// Key: videoId (11-char) or MD5(title-artist) if no videoId
// Schema: {title, artist, source, synced, plain, hasSynced, lines[]}
// Sync Safety Lock: Never overwrite synced lyrics with plain lyrics

// Lyrics Cache (Track ID - fallback)
// Location: ./audio_cache/lyrics_{trackId}.json
// trackId = videoId || MD5(title-artist)

// Downloaded Audio Cache (Opus)
// Location: ./audio_cache/track_{md5(url)}.opus
// Hash: MD5 of track.url
// Managed by: DownloadManager.downloadedFiles (Set<string>)

// MusicBrainz Cache
// Location: ./cache/musicbrainz/{cacheKey}.json
// Keys: 
//   - recording:{title}:{artist}
//   - studio_baseline:{title}:{artist}
//   - title_search:{title}:{limit}

// Player State Persistence
// Location: ./database/playerState.json
// Schema: {guildId: PlayerState}
// PlayerState: {queue[], currentTrack, history[], volume, loop, shuffle, voiceChannelId, textChannelId, timestamp}

// Audit Log
// Location: ./audit_log.json
// Schema: AuditEntry[]

// Presets
// Location: ./database/presets.json
// Schema: {name: string, bands: number[10]}[]

// Playlists
// Location: ./database/playlists.json
// Schema: {name: string, tracks: Track[]}[]

// Languages
// Location: ./database/languages.json
// Schema: {locale: {key: string}}

// Users
// Location: ./users.json
// Schema: {userId: {language, volume, preferences}}

// Cookies (YouTube Auth)
// Location: ./cookies.txt
// Format: Netscape cookie jar

// Matrix Audit (YouTube Resolution Debug)
// Location: ./matrix_audit.json
// Written by: YouTube.resolveMetadataTrack()
// Schema: {target, timestamp, candidates: [{rank, title, channel, durationMs, deltaSeconds, isDisqualified, scores}]}

// ============================================================
// CONFIGURATION CONSTANTS (from config.js)
// ============================================================
const CONFIG = {
  // Audio
  audio: {
    quality: 'highestaudio',
    format: 'mp3',
    bitrate: 320,
    filters: { bassboost, nightcore, vaporwave, _8d }
  },
  
  // yt-dlp Auth Priority: PO Token > Browser Cookies > Cookie File > iOS Client
  ytdl: {
    poToken: process.env.YOUTUBE_PO_TOKEN,
    cookiesFromBrowser: process.env.COOKIES_FROM_BROWSER,  // 'chrome'|'firefox'|'edge'|'safari'
    cookiesFile: process.env.COOKIES_FILE || './cookies.txt',
    extractorArgs: 'youtube:player_client=web'  // Forces web client (stable)
  },
  
  // Track Cache
  trackCache: {
    enabled: true,
    directory: './cache/tracks',
    ttl: { mainstream: 30*24*60*60*1000, indie: 7*24*60*60*1000 },
    mainstreamThreshold: { popularityCount: 10, requireMajorLabel: true }
  },
  
  // Bot
  bot: {
    defaultVolume: 100,
    maxQueueSize: 100,
    maxPlaylistSize: 50,
    embedColor: '#FF6B6B'
  },
  
  // Sharding
  sharding: {
    totalShards: 'auto',
    mode: 'process',  // 'process' | 'worker'
    respawn: true,
    spawnDelay: 5500,
    spawnTimeout: 30000
  },
  
  // Session Restore
  sessionRestore: { enabled: true }
}

// ============================================================
// DURATION MATCHING CONSTANTS (Architecture Invariants)
// ============================================================
const DURATION_TOLERANCE_MS = 3000        // ±3 seconds (STRICT - used everywhere)
const DURATION_TOLERANCE_SEC = 3
const LRCLIB_TIMEOUT_MS = 2000            // Wave 1.1 timeout
const LRCLIB_FORCE_RESYNC_TIMEOUT_MS = 15000
const YTMUSIC_TIMEOUT_MS = 4000
const YTDLP_SEARCH_LIMIT = 5
const YTDLP_EXCLUDE_KEYWORDS = [
  'nightcore', 'remix', 'cover', 'live', 'karaoke', 'instrumental',
  '8d', 'slowed', 'reverb', 'sped up', 'pitch', 'bass boost',
  'mashup', 'extended', '1 hour', 'loop', 'lyrics', 'lyric video',
  'acoustic', 'piano', 'guitar', 'tutorial', 'how to play'
]
const YTDLP_OFFICIAL_KEYWORDS = ['official audio', 'topic', 'vevo', 'records', 'music']

// ============================================================
// LYRICS WAVE ORCHESTRATION CONSTANTS
// ============================================================
const LYRICS_WAVES = {
  wave0: 'cache',           // YT cache + Track cache
  wave1_1: 'lrclib-handshake',  // LRCLIB search + duration anchor
  wave1_2: 'ytmusic-harvest',   // YouTube Music (Python script)
  wave1_3: 'prefetched',        // Track.lyrics from resolution pipeline
  wave2: 'plain-fallback',      // Genius + YTMusic plain + LRCLIB plain
  finalResort: 'youtube-transcript'  // Active YT transcript fetch
}

const LYRICS_PENALTY_WEIGHTS = {
  noSync: 5000,                    // Mandatory sync gating
  artistMismatch: 1000,            // Artist presence verification
  durationDrift: {
    <=2s: 15,                      // per second
    >2s: 500 + (driftSec * 100)    // Sharp penalty scaling
  },
  noDurationMeta: 300
}

// ============================================================
// MUSICBRAINZ CONSTANTS
// ============================================================
const MB_RATE_LIMIT = 1000          // 1 req/sec (ms)
const MB_MAJOR_LABELS = [           // 27 major labels
  'universal music', 'sony music', 'warner music', 'emi', 'epic records',
  'rca records', 'columbia records', 'atlantic records', 'island records',
  'def jam', 'capitol records', 'polydor', 'decca', 'virgin records',
  'interscope', 'geffen', 'a&m records', 'mercury records', 'reprise',
  'elektra', 'mca', 'parlophone', 'rough trade', 'domino', 'xl recordings',
  'matador', 'sub pop', '4ad', 'nonesuch', 'verve', 'impulse', 'blue note'
]
const MB_EXCLUDED_RELEASE_TYPES = ['Live', 'Remix', 'Compilation', 'Soundtrack', 'Spokenword', 'Interview', 'Audiobook', 'Radio']
const MB_STUDIO_ALBUM_ONLY = true
const MB_OFFICIAL_RELEASES_ONLY = true
🛑 Category 4: Codebase Guardrails & "Stop-Sign" Directives
# ARCHITECTURE GUARDRAILS - VIOLATIONS BLOCK MERGE

## 🔴 LAYER SEPARATION (Hard Boundaries)

### FORBIDDEN: Processing → Orchestration Circular Dependency
❌ NEVER: src/YouTube.js → imports → src/player/LyricsHandler.js
❌ NEVER: src/YouTube.js → imports → src/player/TrackManager.js
❌ NEVER: src/LyricsManager.js → imports → src/YouTube.js (except via StreamResolver)
✅ ALLOWED: src/player/TrackManager.js → imports → src/YouTube.js (orchestration calls processing)
✅ ALLOWED: src/player/LyricsHandler.js → imports → src/LyricsManager.js (orchestration calls processing)
✅ ALLOWED: src/player/StreamResolver.js → imports → src/YouTube.js, src/SoundCloud.js (resolution layer)

**Rule**: Processing layer (extractors, API clients) must NEVER import from orchestration layer (PlayerCore, TrackManager, LyricsHandler). Data flows UP only.

---

### FORBIDDEN: Stream URL Caching
❌ NEVER cache direct stream URLs (googlevideo.com) - they expire in ~6 hours
❌ NEVER store streamInfo.url in Track object for later reuse
✅ ALWAYS call StreamResolver.resolveStream(track, guildId, resumeFromSeconds) fresh on every play
✅ Track.url = YouTube watch URL (permanent) ONLY
✅ Track.rawUrl = ephemeral, set only at play time, never persisted

**Rationale**: YouTube streaming URLs are signed, time-limited, IP-bound. Caching causes "Video unavailable" errors.

---

### FORBIDDEN: Duration Drift Beyond ±3 Seconds
❌ NEVER accept YouTube match with |candidateDurationMs - anchorDurationMs| > 3000
❌ NEVER relax the 3-second fence for "better match" - this breaks lyric sync
✅ Anchor sources (priority order):
1. LRCLIB synced lyrics duration (highest authority)
2. MusicBrainz studio album consensus (major label only)
3. YouTube metadata duration (fallback only)
✅ All matching: YouTube.resolveMetadataTrack(), LyricsMatcher.match(), LyricsManager.selectBestLyrics()

**Rationale**: Lyric synchronization (karaoke, word-by-word) requires sub-3s accuracy. Drift >3s desyncs timestamps.

---

### FORBIDDEN: Overwriting Synced Lyrics with Plain Text
❌ NEVER write plain lyrics to cache if synced lyrics already exist for that trackId
✅ LyricsManager.storeInCache() enforces: if (existing.hasSynced && !newData.hasSynced) → REJECT WRITE
✅ This applies to BOTH cache layers: ./audio_cache/lyrics_YT_{videoId}.json AND ./audio_cache/lyrics_{trackId}.json

**Rationale**: Synced lyrics are expensive to obtain (LRCLIB, YTMusic). Plain lyrics are cheap. Never downgrade.

---

### FORBIDDEN: Direct Discord.js Voice API in Business Logic
❌ NEVER use @discordjs/voice APIs directly in TrackManager, LyricsManager, YouTube.js, etc.
✅ ALL voice operations go through: AudioEngineCore → VoiceConnectionHandler → AudioResourceFactory
✅ PlayerCore delegates to AudioEngineCore for: play, pause, skip, volume, seek

**Rationale**: Voice connection recovery, stream reconnection, and Opus encoding are centralized in AudioEngineCore.

---

### FORBIDDEN: Blocking I/O in Hot Paths
❌ NEVER use fs.readFileSync/writeFileSync in: play(), addTrack(), fetchLyrics(), resolveStream()
✅ Use async fs.promises or background fire-and-forget for cache writes
✅ TrackCache.loadCache() runs ONCE at startup (sync OK)
✅ LyricsManager.storeInCache() writes async (fire-and-forget)

**Rationale**: Blocking the event loop during playback causes audio stutters and Discord heartbeat misses.

---

### FORBIDDEN: Hardcoded Strings for User-Facing Text
❌ NEVER: interaction.reply('Song added to queue!')
✅ ALWAYS: await LanguageManager.getTranslation(guildId, 'musicplayer.track_added')
✅ All user-facing strings in database/languages.json

**Rationale**: Multi-language support (15+ locales). Hardcoded strings break i18n.

---

### FORBIDDEN: Mutating Track Objects After Queue Insertion
❌ NEVER: track.duration = newValue after trackManager.addTrack()
❌ NEVER: track.lyrics = newLyrics after queue push
✅ Track objects are IMMUTABLE once in queue/history
✅ For updates: removeTrack(index) → create new Track → addTrack()
✅ Lyrics updates: PlayerCore.currentLyrics (ephemeral, not in Track)

**Rationale**: Queue persistence, audit log, and UI sync rely on Track immutability.

---

### FORBIDDEN: Skipping MusicBrainz for Metadata
❌ NEVER use YouTube metadata as primary source for duration/artist/title
✅ ALWAYS: LRCLIB anchor → MusicBrainz consensus → YouTube filter (±3s)
✅ YouTube is STREAM SOURCE only, not METADATA AUTHORITY

**Rationale**: YouTube metadata is unreliable (wrong durations, misattributed artists, remixes labeled as original).

---

### FORBIDDEN: Direct MusicBrainz API Calls Without Rate Limiter
❌ NEVER: fetch('https://musicbrainz.org/ws/2/...')
✅ ALWAYS: MusicBrainzClient.fetchWithRateLimit(url) → RequestQueue → RateLimiter → fetchWithRetry
✅ Cache hits bypass queue entirely (recordingCache.get/set)

**Rationale**: MusicBrainz enforces 1 req/sec. Violations get IP banned.

---

### FORBIDDEN: Circular Import Chains
❌ PlayerCore → TrackManager → YouTube → PlayerCore (via StreamResolver)
✅ Dependency Direction:
   Bootstrap → PlayerCore → {TrackManager, AudioEngineCore, LyricsHandler}
   TrackManager → {YouTube, SoundCloud, DirectLink, MusicBrainzClient, LrclibClient}
   AudioEngineCore → {StreamResolver, DownloadManager, AudioResourceFactory, PlaybackController}
   LyricsHandler → LyricsManager → {LyricsMatcher, LrclibClient, YouTube, Genius}
   MusicBrainzClient → {RequestQueue, RateLimiter, Cache}

**Enforcement**: Run `npm run check:circular` (add to package.json) in CI.

---

### FORBIDDEN: Global Mutable State Outside Singletons
❌ NEVER: global.myCache = new Map()
❌ NEVER: module.exports.cache = {} (mutable export)
✅ Singletons: trackCache, LyricsManager, MusicBrainzClient (stateless), LrclibClient (stateless)
✅ Per-guild state: PlayerCore instance (managed by MusicPlayer registry)

---

## 🟡 SOFT GUARDRAILS (Code Review Flags)

| Pattern | Action |
|---------|--------|
| `console.log` in hot path (play, addTrack, fetchLyrics) | Replace with `isDebug` guard or remove |
| `try/catch` swallowing errors without logging | Add `console.error` with context |
| `setTimeout` without cleanup in `cleanup()` | Track timer refs, clear on destroy |
| `Promise.all` without error handling | Use `Promise.allSettled` or individual try/catch |
| Magic numbers (3000, 5000, 10000) | Extract to constants at top of file |
| Duplicate parsing logic (_parseTextQuery, _parseYouTubeTitle) | Centralize in TrackManager or utils |

---

## 🟢 ARCHITECTURAL INVARIANTS (Document, Don't Enforce)

1. **Single Source of Truth for Duration**: `Track.durationMs` (ms) is authoritative. `Track.duration` (sec) is derived.
2. **Track Identity**: `Track.id` (YouTube video ID) = primary key. `Track.mbid` = MusicBrainz link.
3. **Session Isolation**: Each `PlayerCore` has unique `sessionId`. Button interactions validate `sessionId`.
4. **State Persistence**: Only `PlayerCore.persistState()` writes to disk. Never write `playerState.json` directly.
5. **Cache Invalidation**: TTL-based only. No manual invalidation except `forceResync=true` in lyrics.
6. **Error Boundaries**: `ErrorHandler.handle()` catches ALL user-facing errors. Never throw to Discord.js unhandled.