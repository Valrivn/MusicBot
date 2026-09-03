# 🚀 MusicBot Architectural Refactor Blueprint

## 🔄 Phase 1: AudioEngine Core Split
- [x] Create `src/player/LyricsHandler.js` (Extracted & Hardened)
- [x] Create `src/player/StreamResolver.js` -> Platform streams (YT, Spotify, SC)
- [x] Create `src/player/AudioResourceFactory.js` -> FFmpeg & seek logic
- [x] Create `src/player/DownloadManager.js` -> Cache & file handling
- [x] Create `src/player/PlaybackController.js` -> Play/pause/skip state machine
- [x] Create `src/player/AutoPlayEngine.js` -> Smart recommendations
- [x] Re-architect `src/player/AudioEngineCore.js` to delegate to above modules

## 📦 Phase 2: MusicPlayer Class Split
- [x] Create `src/player/TrackManager.js` -> Queue arrays & Spotify resolutions
- [x] Create `src/player/StatePersistence.js` -> Disk saves & dynamic restoration
- [x] Create `src/player/PlayerUI.js` -> Now Playing embeds & buttons layout
- [x] Re-architect `src/player/PlayerCore.js` to coordinate the new sub-modules

## 🥾 Phase 3: Root Initialization Split
- [x] Create `src/bootstrap/DiscordClient.js` -> Intents, collections, client instantiation
- [x] Create `src/bootstrap/EventHandlers.js` -> Discord Gateway events hook
- [x] Create `src/bootstrap/ProcessHandlers.js` -> Crash prevention (SIGINT, uncaughtException)
- [x] Create `src/bootstrap/Bootstrap.js` -> Clean orchestration entry point

## 🧹 Phase 4: Verification & Cleanup
- [x ] Audit all internal relative `require()` paths across the new files
- [ ] Run bot smoke tests to verify connection stability
- [ ] Permanently delete old monolithic legacy file. 