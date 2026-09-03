# MasterFramework.md

## Overview
This document provides a complete file tree and feature summary of the Beatra Discord music bot backend codebase. It serves as a token-saving reference for future audits.

**Bot Name:** Beatra  
**Version:** 16.0.0  
**Core Stack:** discord.js v14.22, @discordjs/voice, Express v5, FFmpeg, Prism.js, Python 3.x  
**Platform Support:** YouTube (via yt-dlp), SoundCloud, Direct audio links  
**Sharding:** Auto/Process mode with Redis/file-lock fallback  

---

## File Tree

```
C:\Bot\MusicBot\
├── index.js
├── shard.js
├── config.js
├── package.json
├── package-lock.json
├── start.bat
├── .env
├── README.md
├── AGENTS.md
├── MasterFramework.md  ← (this file)
├── commands.json
├── commands/
│   ├── general/
│   ├── music/
│   └── staff/
├── src/
│   ├── YouTube.js
│   ├── SoundCloud.js
│   ├── DirectLink.js
│   ├── MusicPlayer.js
│   ├── PlayerStateManager.js
│   ├── SessionManager.js
│   ├── LyricsManager.js
│   ├── LyricsMatcher.js
│   ├── LanguageManager.js
│   ├── ErrorHandler.js
│   ├── trackCache.js
│   ├── AuditLog.js
│   ├── commandLoader.js
│   ├── utils/
│   │   └── retry.js
│   ├── player/
│   │   ├── PlayerCore.js
│   │   ├── AudioEngineCore.js
│   │   ├── TrackManager.js
│   │   ├── VoiceConnection.js
│   │   ├── PlaybackController.js
│   │   ├── PlayerUI.js
│   │   ├── StreamResolver.js
│   │   ├── DownloadManager.js
│   │   ├── AutoPlayEngine.js
│   │   ├── AudioResourceFactory.js
│   │   ├── LyricsHandler.js
│   │   └── StatePersistence.js
│   ├── commands/
│   │   ├── play.js
│   │   ├── help.js
│   │   ├── search.js
│   │   ├── nowplaying.js
│   │   └── language.js
│   ├── musicbrainz/
│   │   ├── MusicBrainzClient.js
│   │   ├── CoverArtResolver.js
│   │   ├── Cache.js
│   │   ├── RateLimiter.js
│   │   └── RequestQueue.js
│   ├── lrclib/
│   │   └── LrclibClient.js
│   ├── api/
│   │   ├── server.js
│   │   └── routes/
│   │       ├── music.js
│   │       ├── system.js
│   │       ├── presets.js
│   │       └── karaoke.js
│   ├── bootstrap/
│   │   ├── Bootstrap.js
│   │   ├── DiscordClient.js
│   │   ├── EventHandlers.js
│   │   ├── ProcessHandlers.js
│   │   └── SessionRestore.js
│   └── ...
├── events/
│   ├── buttonHandler.js
│   └── modalHandler.js
├── database/
│   └── playerState.json
├── languages/
│   ├── en.json
│   ├── es.json
│   ├── fr.json
│   ├── de.json
│   ├── ja.json
│   ├── ko.json
│   ├── zh-CN.json
│   ├── zh-TW.json
│   ├── pt-BR.json
│   ├── ru.json
│   ├── it.json
│   ├── nl.json
│   ├── pl.json
│   ├── tr.json
│   ├── th.json
│   ├── vi.json
│   ├── id.json
│   ├── ms.json
│   ├── ar.json
│   ├── hi.json
│   ├── uk.json
│   └── cs.json
├── scripts/
│   ├── karaoke_worker.py
│   ├── ytmusic_lyrics.py
│   ├── pitch_extractor.py
│   ├── pitch_quantizer.py
│   ├── update-ytdlp.js
│   └── youtube_transcript.py
├── Agent/
│   ├── commands/
│   │   └── .gitkeep
│   ├── discord/
│   │   └── .gitkeep
│   └── planning/
│       └── .gitkeep
├── bin/
│   └── ffmpeg.exe (expected)
├── public/
│   ├── index.html
│   ├── dashboard.html
│   ├── login.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── dashboard.js
└── scratch/
    └── (temporary test files)
```

---

## Feature Summaries by File

### Root Files

#### `index.js`
**Purpose:** Application entry point  
**Key Behavior:** Loads all commands via `commandLoader`, then waits 5 seconds before calling `startBot()` to allow Discord gateway connections to settle. Calls `Bootstrap.start()` which initializes the Discord client, event handlers, and API server.  
**Dependencies:** `commandLoader`, `Bootstrap`

#### `shard.js`
**Purpose:** Sharding manager for multi-process scaling  
**Key Behavior:** Creates a `ShardingManager` with auto-shard count detection. Handles shard events (death, disconnect, ready). Spawns shards with respawn enabled. Logs shard lifecycle events.  
**Dependencies:** `discord.js`, `config`

#### `config.js`
**Purpose:** Central configuration hub  
**Key Sections:**
- `token`, `clientId`, `guildId` - Discord credentials
- `geniusApiKey` - Lyrics API
- `audioSettings` - Default volume (0.25), bass boost, filters
- `ytdlpAuth` - YouTube authentication (cookies, PO tokens, OAuth refresh tokens)
- `sharding` - Mode (auto/process), cluster count
- `trackCache` - TTL (48 hours), max entries (1000)
- `apiServer` - Port, session secret
- `karaoke` - Demucs model, pitch extraction settings
- `rateLimiting` - MusicBrainz 1 req/sec, global request queue

#### `package.json`
**Purpose:** Node.js package manifest  
**Version:** 16.0.0  
**Scripts:** `start` (node index.js), `shard` (node shard.js)  
**Key Dependencies:** discord.js 14.22.2, @discordjs/voice 0.18.0, express 5.1.0, prism-media, sodium-native, ws

#### `start.bat`
**Purpose:** Windows startup script  
**Behavior:** Sets console title to "Beatra", then runs `node index.js`

#### `commands.json`
**Purpose:** Command metadata for help system and slash command registration  
**Structure:** Array of command objects with `name`, `description`, `category`, `options`, `cooldown`

---

### `src/` - Core Modules

#### `src/YouTube.js`
**Purpose:** YouTube URL extraction and metadata fetching  
**Key Features:**
- Multi-method extraction: yt-dlp → PO Token → Cookie auth → OAuth refresh tokens
- `getSongDetails(url)` - Returns `{title, artist, duration, url, thumbnail, isLive}`
- `stream(url)` - Returns readable stream with best audio format selection
- `getVideoInfo(url)` - Raw yt-dlp JSON metadata
- Rate limiting on yt-dlp calls
- Handles live streams, age-restricted content, playlist extraction
- `searchYouTube(query)` - Search via yt-dlp `ytsearch:`
- **Rate Limits:** Sequential extraction, 5s timeout per method

#### `src/SoundCloud.js`
**Purpose:** SoundCloud track/playlist extraction  
**Key Features:**
- `resolveUrl(url)` - Resolves short/permalink URLs to track info
- `getTrackDetails(url)` - Returns `{title, artist, duration, url, thumbnail}`
- `stream(url)` - Returns playable stream (128kbps default)
- Client ID resolution via `https://api.soundcloud.com/resolve`
- Playlist support with sequential track resolution
- **Rate Limits:** None configured (SoundCloud API is permissive)

#### `src/DirectLink.js`
**Purpose:** Direct audio file handling  
**Key Features:**
- Detects direct audio URLs (`.mp3`, `.flac`, `.ogg`, `.wav`, `.m4a`, `.opus`, `.aac`)
- Returns stream URL directly without metadata extraction
- Supports HTTP/HTTPS URLs
- **Rate Limits:** N/A

#### `src/MusicPlayer.js`
**Purpose:** Legacy music player (being replaced by `PlayerCore.js`)  
**Key Features:**
- `play(url)` - Start playback
- `pause()` / `resume()` - Playback control
- `stop()` - Stop and clear queue
- `skip()` - Skip to next track
- `queue` - Track queue array
- `volume` - Current volume level
- **Note:** This is the older monolithic player; new code uses `PlayerCore` + subsystems

#### `src/PlayerStateManager.js`
**Purpose:** Player state persistence across restarts  
**Key Features:**
- Saves current queue, position, volume, filters to `database/playerState.json`
- `saveState(guildId, state)` - Persists player state
- `restoreState(guildId)` - Retrieves saved state
- Debounced saves (5s delay) to avoid excessive I/O
- **Storage:** JSON file per guild

#### `src/SessionManager.js`
**Purpose:** User session management for API authentication  
**Key Features:**
- `createSession(userId)` - Creates JWT-like session token
- `validateSession(token)` - Verifies token validity
- `destroySession(token)` - Invalidates session
- Redis-backed with file-lock fallback
- **Storage:** Redis key/value or file lock

#### `src/LyricsManager.js`
**Purpose:** Multi-source lyrics acquisition with Wave-based orchestration  
**Key Features:**
- **Wave Pipeline:**
  1. **Cache Check** - In-memory cache (1 hour TTL)
  2. **MusicBrainz + LRCLIB** - Official metadata + synchronized lyrics
  3. **Genius + YTMusic** - Web scraping fallback
  4. **YouTube Transcript** - Auto-generated captions
- `getLyrics(song, artist)` - Returns `{lyrics, source, synchronized}`
- `matchLyrics(lyrics, position)` - Syncs lyrics to playback position
- Handles rate limits across all sources
- **Rate Limits:** MusicBrainz 1 req/sec, LRCLIB 1 req/sec, Genius 1 req/2s

#### `src/LyricsMatcher.js`
**Purpose:** Synchronized lyrics timing matcher  
**Key Features:**
- Parses LRC format timestamps
- `getCurrentLine(timestamp)` - Returns current lyric line
- `getNextLine(timestamp)` - Returns next upcoming line
- Handles offset adjustment for drift compensation
- **Rate Limits:** N/A

#### `src/LanguageManager.js`
**Purpose:** Internationalization (i18n) support  
**Key Features:**
- Loads language files from `languages/*.json`
- `getTranslation(key, lang)` - Returns translated string
- Supports 22 languages
- Fallback to English if key missing
- `getSupportedLanguages()` - Returns available locale codes
- **Rate Limits:** N/A

#### `src/ErrorHandler.js`
**Purpose:** Centralized error handling and reporting  
**Key Features:**
- `handleError(error, context)` - Logs and categorizes errors
- User-friendly error messages for Discord embeds
- API error responses with status codes
- Rate limit detection and retry guidance
- **Rate Limits:** None (error handler itself)

#### `src/trackCache.js`
**Purpose:** In-memory cache for track metadata  
**Key Features:**
- LRU cache with configurable TTL (default 48 hours)
- `get(key)` / `set(key, value)` - Cache operations
- `has(key)` - Check existence
- `delete(key)` - Remove entry
- Max 1000 entries (configurable)
- **Storage:** In-memory Map with eviction

#### `src/AuditLog.js`
**Purpose:** Command and event audit logging  
**Key Features:**
- `logCommand(user, command, guild)` - Logs slash command usage
- `logEvent(event, guild)` - Logs significant events
- Writes to `database/audit.log` (append mode)
- Timestamps and user IDs for accountability
- **Storage:** File append

#### `src/commandLoader.js`
**Purpose:** Dynamic command loading from `src/commands/`  
**Key Features:**
- Reads all `.js` files in `src/commands/`
- Validates command structure (name, execute function)
- Returns array of command objects for slash command registration
- Supports hot-reload via `reloadCommands()`
- **Rate Limits:** N/A

#### `src/utils/retry.js`
**Purpose:** Generic retry utility with exponential backoff  
**Key Features:**
- `retry(fn, options)` - Retries async function
- Options: `maxRetries` (default 3), `delay` (default 1000ms), `backoff` (default 2x)
- Handles network errors, rate limits, timeouts
- **Rate Limits:** Implements backoff for rate-limited APIs

---

### `src/player/` - Player Subsystems

#### `src/player/PlayerCore.js`
**Purpose:** Main player orchestrator (replaces `MusicPlayer.js`)  
**Key Features:**
- Coordinates all subsystems: TrackManager, AudioEngineCore, VoiceConnection, PlaybackController, PlayerUI, LyricsHandler, AutoPlayEngine
- `play(url, options)` - Full playback pipeline
- `pause()` / `resume()` / `stop()` / `skip()`
- `setVolume(level)` / `setFilter(filter)`
- `getQueue()` / `clearQueue()`
- Guild-specific instances (one PlayerCore per guild)
- **Rate Limits:** None (internal orchestrator)

#### `src/player/AudioEngineCore.js`
**Purpose:** FFmpeg-based audio processing engine  
**Key Features:**
- Creates FFmpeg pipeline with filters (bass boost, nightcore, etc.)
- `createStream(input, filters)` - Returns processed audio stream
- Volume control via FFmpeg `volume` filter
- Prismatic media for Opus encoding
- `getFilters()` - Returns available filter presets
- **Rate Limits:** None

#### `src/player/TrackManager.js`
**Purpose:** Queue management and track resolution  
**Key Features:**
- `addTrack(url)` - Resolves and adds to queue
- `removeTrack(index)` - Removes from queue
- `next()` / `previous()` - Queue navigation
- Playlist expansion (YouTube/SoundCloud playlists)
- `getQueue()` - Returns formatted queue
- Auto-play adjacent tracks from same artist
- **Rate Limits:** Inherits from YouTube/SoundCloud extractors

#### `src/player/VoiceConnection.js`
**Purpose:** Discord voice channel connection management  
**Key Features:**
- `connect(channel)` - Joins voice channel
- `disconnect()` - Leaves channel
- `getVoiceConnection()` - Returns active connection
- Handles connection state changes (reconnecting, destroyed)
- Audio player subscription management
- **Rate Limits:** Discord gateway rate limits (5 per second per guild)

#### `src/player/PlaybackController.js`
**Purpose:** Playback state machine  
**Key Features:**
- States: `idle`, `playing`, `paused`, `buffering`, `error`
- `play()` / `pause()` / `resume()` / `stop()`
- Transition validation (can't pause if idle)
- Event emission on state changes
- **Rate Limits:** N/A

#### `src/player/PlayerUI.js`
**Purpose:** Player embed and button UI  
**Key Features:**
- `createPlayerEmbed(playerState)` - Rich embed with progress bar
- `createControlButtons()` - Row of buttons (play/pause, stop, skip, queue)
- Updates embed every 5 seconds during playback
- Handles button interactions via `buttonHandler.js`
- **Rate Limits:** Discord embed rate limits (10 per minute per channel)

#### `src/player/StreamResolver.js`
**Purpose:** Multi-platform stream URL resolution  
**Key Features:**
- `resolve(url)` - Detects platform and delegates to YouTube/SoundCloud/DirectLink
- Returns `{stream, metadata}` with playable stream and track info
- Handles redirects and stream URL expiration
- **Rate Limits:** Inherits from platform-specific resolvers

#### `src/player/DownloadManager.js`
**Purpose:** Local file download and caching  
**Key Features:**
- `download(url, filename)` - Downloads file to `audio_cache/`
- `getCached(url)` - Returns cached file path
- `clearCache()` - Removes old files (LRU eviction)
- Supports partial downloads and resume
- **Storage:** `audio_cache/` directory

#### `src/player/AutoPlayEngine.js`
**Purpose:** Automatic track queuing when queue empties  
**Key Features:**
- `getRelatedTrack(currentTrack)` - Finds similar tracks via YouTube recommendations
- `getArtistTracks(artist)` - Finds more tracks by same artist
- Respects user preferences (genre, mood)
- Configurable max auto-play tracks (default 5)
- **Rate Limits:** YouTube search rate limits

#### `src/player/AudioResourceFactory.js`
**Purpose:** Creates Discord.js AudioResource objects  
**Key Features:**
- `create(stream, options)` - Wraps stream in AudioResource
- Sets volume, input type, metadata
- Handles Opus encoding pipeline
- **Rate Limits:** N/A

#### `src/player/LyricsHandler.js`
**Purpose:** Lyrics integration for player UI  
**Key Features:**
- `fetchLyrics(track)` - Gets lyrics via LyricsManager
- `getCurrentLyrics(position)` - Returns synced lyrics line
- `formatLyrics(lyrics)` - Formats for Discord embed
- Caches lyrics per track
- **Rate Limits:** Inherits from LyricsManager

#### `src/player/StatePersistence.js`
**Purpose:** Player state save/restore (replaces `PlayerStateManager.js`)  
**Key Features:**
- `save(guildId)` - Persists queue, position, volume, filters
- `restore(guildId)` - Restores saved state
- Auto-save on track change, manual save command
- Debounced saves (5s)
- **Storage:** `database/playerState.json`

---

### `src/commands/` - Slash Commands

#### `src/commands/play.js`
**Purpose:** Play music command  
**Syntax:** `/play <query|url>`  
**Key Features:**
- Accepts YouTube URLs, search queries, SoundCloud URLs, direct links
- Searches YouTube if not a URL (`ytsearch:query`)
- Adds to queue and starts playback if idle
- Shows "Now Playing" embed
- **Cooldown:** 3 seconds
- **Permissions:** Send Messages, Connect, Speak

#### `src/commands/help.js`
**Purpose:** Command list and information  
**Syntax:** `/help [command]`  
**Key Features:**
- Lists all commands by category
- Shows detailed info for specific command
- Pagination for large command lists
- **Cooldown:** 5 seconds

#### `src/commands/search.js`
**Purpose:** YouTube search with interactive selection  
**Syntax:** `/search <query>`  
**Key Features:**
- Returns top 5 YouTube results
- Shows numbered list with title/duration
- User clicks button to select track
- Adds selected track to queue
- **Cooldown:** 5 seconds

#### `src/commands/nowplaying.js`
**Purpose:** Show currently playing track  
**Syntax:** `/nowplaying`  
**Key Features:**
- Displays track info embed (title, artist, duration, progress)
- Shows progress bar with timestamp
- Lyrics preview if available
- **Cooldown:** 3 seconds

#### `src/commands/language.js`
**Purpose:** Change bot language  
**Syntax:** `/language [locale]`  
**Key Features:**
- Lists available languages
- Sets user's preferred language
- Saves preference to user settings
- **Cooldown:** 10 seconds

---

### `src/musicbrainz/` - MusicBrainz Integration

#### `src/musicbrainz/MusicBrainzClient.js`
**Purpose:** MusicBrainz API client for metadata  
**Key Features:**
- `searchArtist(name)` - Finds artist by name
- `getReleaseGroup(mbid)` - Gets album info
- `getCoverArt(mbid)` - Returns album art URL
- Rate limited to 1 req/sec
- **Rate Limits:** 1 request per second (MusicBrainz policy)

#### `src/musicbrainz/CoverArtResolver.js`
**Purpose:** Album cover art resolution  
**Key Features:**
- `getCoverArt(artist, album)` - Searches MusicBrainz for cover
- Fallback to YouTube thumbnail if unavailable
- Returns `{url, source}` with image URL
- **Rate Limits:** Inherits from MusicBrainzClient

#### `src/musicbrainz/Cache.js`
**Purpose:** In-memory cache for MusicBrainz responses  
**Key Features:**
- LRU cache with 1 hour TTL
- Reduces API calls for repeated queries
- **Storage:** In-memory Map

#### `src/musicbrainz/RateLimiter.js`
**Purpose:** Rate limiting for MusicBrainz API  
**Key Features:**
- Token bucket algorithm (1 token/sec, max 1)
- `acquire()` - Waits for available token
- Queues requests if limit exceeded
- **Rate Limits:** 1 req/sec

#### `src/musicbrainz/RequestQueue.js`
**Purpose:** Request queuing for MusicBrainz  
**Key Features:**
- FIFO queue for pending requests
- Processes 1 request/sec
- Rejects if queue full (max 100)
- **Storage:** In-memory array

---

### `src/lrclib/` - LRCLIB Integration

#### `src/lrclib/LrclibClient.js`
**Purpose:** LRCLIB API client for synchronized lyrics  
**Key Features:**
- `getLyrics(artist, title)` - Fetches LRC lyrics
- `search(query)` - Searches lyrics database
- Returns `{lyrics, synced, duration}`
- Rate limited to 1 req/sec
- **Rate Limits:** 1 request per second

---

### `src/api/` - REST API Server

#### `src/api/server.js`
**Purpose:** Express API server with OAuth2 authentication  
**Key Features:**
- Discord OAuth2 login flow
- JWT session tokens
- Role-based middleware (Owner/Staff/DJ/Guest)
- Rate limiting (100 req/min per IP)
- Static file serving (`public/`)
- CORS configuration
- **Port:** Configurable (default 3000)

#### `src/api/routes/music.js`
**Purpose:** Music control endpoints  
**Endpoints:**
- `GET /music/status` - Player state
- `POST /music/play` - Start/resume playback
- `POST /music/pause` - Pause playback
- `POST /music/stop` - Stop playback
- `POST /music/skip` - Skip track
- `GET /music/queue` - Get queue
- `POST /music/queue/add` - Add to queue
- `DELETE /music/queue/clear` - Clear queue
- **Auth:** DJ role required for controls

#### `src/api/routes/system.js`
**Purpose:** System status endpoints  
**Endpoints:**
- `GET /system/health` - Health check
- `GET /system/stats` - Bot statistics
- `GET /system/sessions` - Active sessions
- **Auth:** Staff role required

#### `src/api/routes/presets.js`
**Purpose:** Audio filter presets  
**Endpoints:**
- `GET /presets` - List all presets
- `POST /presets/apply` - Apply filter preset
- **Auth:** DJ role required

#### `src/api/routes/karaoke.js`
**Purpose:** Karaoke system endpoints  
**Endpoints:**
- `POST /karaoke/separate` - Start stem separation
- `GET /karaoke/status/:jobId` - Check job status
- `GET /karaoke/download/:jobId` - Download separated stems
- `POST /karaoke/pitch` - Extract pitch data
- **Auth:** DJ role required  
- **Processing:** Triggers Python scripts (`karaoke_worker.py`, `pitch_extractor.py`)

---

### `src/bootstrap/` - Application Bootstrap

#### `src/bootstrap/Bootstrap.js`
**Purpose:** Application initialization orchestrator  
**Key Features:**
- `start()` - Initializes all subsystems in order
- `stop()` - Graceful shutdown
- Initializes: Discord client, event handlers, API server, session restore
- Error handling for startup failures
- **Rate Limits:** N/A

#### `src/bootstrap/DiscordClient.js`
**Purpose:** Discord client creation and configuration  
**Key Features:**
- Creates `Client` with required intents
- `getIntentFlags()` - Returns gateway intents
- Client ready event handler
- **Intents:** Guilds, GuildVoiceStates, GuildMessages, MessageContent

#### `src/bootstrap/EventHandlers.js`
**Purpose:** Discord event registration  
**Key Features:**
- `ready` - Bot online status, activity setup
- `interactionCreate` - Slash command routing
- `voiceStateUpdate` - Voice channel tracking
- `guildCreate` / `guildRemove` - Server join/leave handling
- **Rate Limits:** Discord gateway rate limits

#### `src/bootstrap/ProcessHandlers.js`
**Purpose:** Node.js process event handling  
**Key Features:**
- `uncaughtException` - Logs and continues
- `unhandledRejection` - Logs and continues
- `SIGINT` - Graceful shutdown
- `SIGTERM` - Graceful shutdown
- Saves player state before exit

#### `src/bootstrap/SessionRestore.js`
**Purpose:** Restores player state from previous session  
**Key Features:**
- Reads `database/playerState.json`
- Restores queue, position, volume for each guild
- Reconnects to voice channels if needed
- Logs restoration results
- **Storage:** Reads `database/playerState.json`

---

### `events/` - Discord Event Handlers

#### `events/buttonHandler.js`
**Purpose:** Handles button interactions from player UI  
**Key Features:**
- Routes button clicks to appropriate actions
- Handles: play/pause, stop, skip, queue navigation
- Updates player embed after action
- **Rate Limits:** Discord interaction rate limits

#### `events/modalHandler.js`
**Purpose:** Handles modal submissions  
**Key Features:**
- Processes modal inputs (e.g., search queries)
- Validates and executes actions
- Responds with embed or ephemeral message
- **Rate Limits:** Discord interaction rate limits

---

### `scripts/` - Python & Utility Scripts

#### `scripts/karaoke_worker.py`
**Purpose:** Stem separation using Demucs  
**Key Features:**
- Takes audio URL as input
- Downloads audio via yt-dlp
- Runs Demucs model (htdemucs) for vocal/instrumental separation
- Outputs: `vocals.wav`, `instrumental.wav`
- Reports progress via stdout
- **Dependencies:** demucs, torch, yt-dlp
- **Processing:** CPU/GPU intensive (5-10 minutes per track)

#### `scripts/ytmusic_lyrics.py`
**Purpose:** YouTube Music lyrics extraction  
**Key Features:**
- Takes video ID as input
- Uses `ytmusicapi` to fetch lyrics
- Returns synced lyrics in LRC format
- Handles age-restricted content
- **Dependencies:** ytmusicapi, requests

#### `scripts/pitch_extractor.py`
**Purpose:** Melody/pitch extraction from audio  
**Key Features:**
- Takes audio file path as input
- Uses librosa for pitch detection
- Returns array of `(time, frequency)` tuples
- Handles vocal/instrumental separation
- **Dependencies:** librosa, numpy, soundfile

#### `scripts/pitch_quantizer.py`
**Purpose:** Pitch quantization for visualization  
**Key Features:**
- Takes raw pitch data as input
- Quantizes to musical notes (A4=440Hz)
- Returns note names with timestamps
- Removes pitch artifacts and noise
- **Dependencies:** numpy

#### `scripts/update-ytdlp.js`
**Purpose:** Updates yt-dlp binary to latest version  
**Key Features:**
- Checks current version vs latest release
- Downloads update if available
- Handles Windows/Linux/macOS
- **Rate Limits:** GitHub API rate limits (60 req/hr unauthenticated)

#### `scripts/youtube_transcript.py`
**Purpose:** YouTube auto-generated transcript extraction  
**Key Features:**
- Takes video ID as input
- Uses `youtube_transcript_api` library
- Returns timestamped transcript lines
- Handles multiple languages
- **Dependencies:** youtube_transcript_api

---

### `languages/` - Localization Files

**22 Language Files:**
- `en.json` (English - base)
- `es.json` (Spanish)
- `fr.json` (French)
- `de.json` (German)
- `ja.json` (Japanese)
- `ko.json` (Korean)
- `zh-CN.json` (Simplified Chinese)
- `zh-TW.json` (Traditional Chinese)
- `pt-BR.json` (Brazilian Portuguese)
- `ru.json` (Russian)
- `it.json` (Italian)
- `nl.json` (Dutch)
- `pl.json` (Polish)
- `tr.json` (Turkish)
- `th.json` (Thai)
- `vi.json` (Vietnamese)
- `id.json` (Indonesian)
- `ms.json` (Malay)
- `ar.json` (Arabic)
- `hi.json` (Hindi)
- `uk.json` (Ukrainian)
- `cs.json` (Czech)

**Structure:** Each file contains key-value pairs for UI strings, error messages, and command descriptions.

---

### `public/` - Web Dashboard

#### `public/index.html`
**Purpose:** Landing page  
**Features:** Login button, bot status, invite link

#### `public/dashboard.html`
**Purpose:** Admin dashboard  
**Features:** Player controls, queue management, settings, real-time updates via WebSocket

#### `public/login.html`
**Purpose:** Discord OAuth2 login page  
**Features:** OAuth2 flow, session creation, redirect to dashboard

#### `public/css/style.css`
**Purpose:** Dashboard styling  
**Features:** Dark theme, responsive design, animations

#### `public/js/dashboard.js`
**Purpose:** Dashboard client-side logic  
**Features:** API calls, WebSocket connection, UI updates, player control buttons

---

### `database/` - Data Storage

#### `database/playerState.json`
**Purpose:** Persisted player state  
**Structure:** `{ [guildId]: { queue, position, volume, filters, voiceChannelId } }`

---

### `Agent/` - Development Documentation

#### `Agent/commands/`
**Purpose:** Command development reference  
**Contents:** `.gitkeep` (empty placeholder)

#### `Agent/discord/`
**Purpose:** Discord.js reference  
**Contents:** `.gitkeep` (empty placeholder)

#### `Agent/planning/`
**Purpose:** Planning documentation  
**Contents:** `.gitkeep` (empty placeholder)

---

## Key System Interactions

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Gateway                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Bootstrap.js                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │DiscordClient │  │EventHandlers │  │SessionRestore│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   PlayerCore.js                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ TrackManager │  │AudioEngine   │  │VoiceConnection│     │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │PlaybackCtrl  │  │  PlayerUI    │  │AutoPlayEngine│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │LyricsHandler │  │StatePersist  │                        │
│  └──────────────┘  └──────────────┘                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ YouTube  │ │SoundCloud│ │DirectLink│
   └──────────┘ └──────────┘ └──────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │        LyricsManager             │
   │  ┌────────────┐ ┌────────────┐  │
   │  │MusicBrainz │ │  LRCLIB    │  │
   │  └────────────┘ └────────────┘  │
   │  ┌────────────┐ ┌────────────┐  │
   │  │  Genius    │ │  YTMusic   │  │
   │  └────────────┘ └────────────┘  │
   └──────────────────────────────────┘
```

---

## Rate Limits Summary

| Component | Rate Limit | Notes |
|-----------|-----------|-------|
| MusicBrainz API | 1 req/sec | Enforced by RateLimiter.js |
| LRCLIB API | 1 req/sec | Enforced by LrclibClient.js |
| Genius API | 1 req/2s | Enforced by LyricsManager.js |
| Discord Gateway | 5 events/sec/guild | Native discord.js handling |
| Discord Interactions | 3 sec cooldown | Per user per command |
| YouTube (yt-dlp) | Sequential | One extraction at a time |
| SoundCloud API | None | Permissive |
| API Server | 100 req/min/IP | Express rate limiter |

---

## Storage Locations

| Data | Location | Format |
|------|----------|--------|
| Player State | `database/playerState.json` | JSON |
| Audit Log | `database/audit.log` | Text append |
| Audio Cache | `audio_cache/` | Binary files |
| Track Metadata | In-memory `trackCache.js` | Map (LRU) |
| MusicBrainz Cache | In-memory `Cache.js` | Map (LRU) |
| Sessions | Redis / File lock | Key-value |

---

## Development Notes

- **Legacy Code:** `MusicPlayer.js` and `PlayerStateManager.js` are being replaced by `PlayerCore.js` and `StatePersistence.js`
- **Python Scripts:** Require separate Python environment with `demucs`, `librosa`, `ytmusicapi`, `youtube_transcript_api`
- **Sharding:** Auto mode detects shard count from Discord; Process mode uses fixed count from config
- **OAuth2 Flow:** Discord OAuth2 → `/api/auth/callback` → JWT session → Dashboard access
- **Karaoke Pipeline:** Audio URL → yt-dlp download → Demucs separation → Pitch extraction → Visualization

---

*Last Updated: July 18, 2026*
*Generated by: OpenCode Audit*