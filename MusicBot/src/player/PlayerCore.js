const { EmbedBuilder } = require('discord.js');
const config = require('../../config');
const YouTube = require('../YouTube');

const SoundCloud = require('../SoundCloud');
const DirectLink = require('../DirectLink');
const LanguageManager = require('../LanguageManager');
const ErrorHandler = require('../ErrorHandler');
const PlayerStateManager = require('../PlayerStateManager');
const LyricsManager = require('../LyricsManager');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const AuditLog = require('../AuditLog');
const TrackManager = require('./TrackManager');
const VoiceConnectionHandler = require('./VoiceConnection');
const AudioEngineCore = require('./AudioEngineCore');
const StatePersistence = require('./StatePersistence');
const PlayerUI = require('./PlayerUI');
const QueueEventStore = require('../services/queue-event-store');

// Cache directory for downloaded audio files
const CACHE_DIR = path.join(__dirname, '..', '..', 'audio_cache');

// Ensure cache directory exists
if (!fsSync.existsSync(CACHE_DIR)) {
    fsSync.mkdirSync(CACHE_DIR, { recursive: true });
}

let cachedFetch;
async function ensureFetch() {
    if (cachedFetch) return cachedFetch;
    if (typeof global.fetch === 'function') {
        cachedFetch = global.fetch.bind(global);
    } else {
        const mod = await import('node-fetch');
        cachedFetch = mod.default;
    }
    return cachedFetch;
}

class PlayerCore {
    constructor(guild, textChannel, voiceChannel) {
        this.guild = guild;
        this.textChannel = textChannel;
        this.voiceChannel = voiceChannel;

        // Initialize track manager (Queue state and resolutions)
        this.trackManager = new TrackManager(this);

        // Initialize voice handler
        this.voiceHandler = new VoiceConnectionHandler(this);

        // Initialize audio engine
        this.audioEngine = new AudioEngineCore(this);

        // Player settings
        this.loop = false; // false, 'track', 'queue'
        this.shuffle = false;
        this.autoplay = false; // false or genre string: 'pop', 'rock', 'hiphop', etc.

        // Filters
        this.currentFilter = null;

        // UI Management
        this.nowPlayingMessage = null;
        this.requesterId = null;

// Session management - unique ID to prevent old button interactions
        this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);

        // Persistence management
        this.statePersistence = new StatePersistence(this);

        // Event-sourced queue persistence
        this.eventStore = QueueEventStore;
        this._eventStoreInitialized = false;

        // UI Management logic
        this.ui = new PlayerUI(this);
    }

    /**
     * Initialize event store and rebuild state from persistence
     */
    async initializeEventStore() {
        if (this._eventStoreInitialized) return;
        
        try {
            const guildId = this.guild?.id;
            if (!guildId) return;

            console.log(`[EventStore] Initializing for guild ${guildId}`);
            
            // Rebuild state from events
            const state = await this.eventStore.rebuildState(guildId);
            
            if (state && (state.currentTrack || state.queue?.length > 0 || state.previousTracks?.length > 0)) {
                console.log(`[EventStore] Restored state for guild ${guildId}:`, {
                    currentTrack: state.currentTrack?.title,
                    queueLength: state.queue?.length || 0,
                    historyLength: state.previousTracks?.length || 0,
                    volume: state.volume,
                    loop: state.loop,
                    shuffle: state.shuffle
                });
                
                // Apply restored state
                this._applyRestoredState(state);
            }

            // Start periodic snapshot timer
            this.eventStore.startSnapshotTimer(guildId, () => this.getQueueState());
            
            this._eventStoreInitialized = true;
        } catch (error) {
            console.error('[EventStore] Initialization error:', error);
        }
    }

    /**
     * Get current queue state for snapshotting
     */
    getQueueState() {
        return {
            currentTrack: this.currentTrack ? this._serializeTrack(this.currentTrack) : null,
            queue: this.queue.map(t => this._serializeTrack(t)).filter(Boolean),
            previousTracks: this.previousTracks.slice(-50).map(t => this._serializeTrack(t)).filter(Boolean),
            volume: this.volume,
            loop: this.loop,
            shuffle: this.shuffle,
            autoplay: this.autoplay,
            paused: this.paused,
            playbackPositionMs: this.getCurrentTime() || 0,
            currentTrackStartOffsetMs: this.currentTrackStartOffsetMs || 0,
            lastPlaybackPosition: this.lastPlaybackPosition || 0
        };
    }

    /**
     * Serialize track for storage
     */
    _serializeTrack(track) {
        if (!track) return null;
        return {
            id: track.id || null,
            title: track.title || null,
            url: track.url || null,
            duration: typeof track.duration === 'number' ? track.duration : Number(track.duration) || null,
            thumbnail: track.thumbnail || null,
            artist: track.artist || null,
            album: track.album || null,
            platform: track.platform || null,
            uploader: track.uploader || null,
            youtubeUrl: track.youtubeUrl || null,
            soundcloudUrl: track.soundcloudUrl || null,
            isLive: track.isLive || track.live || false,
            addedAt: track.addedAt || Date.now(),
            requesterId: track.requesterId || track.requestedBy?.id || null,
            requesterTag: track.requesterTag || track.requestedBy?.tag || null,
            extra: track.extra || null
        };
    }

    /**
     * Apply restored state from event store
     */
    _applyRestoredState(state) {
        this.volume = typeof state.volume === 'number' ? state.volume : this.volume;
        this.loop = state.loop ?? false;
        this.shuffle = state.shuffle ?? false;
        this.autoplay = state.autoplay ?? false;

        this.previousTracks = (state.previousTracks || [])
            .map(serialized => this.trackManager._deserializeTrack ? this.trackManager._deserializeTrack(serialized) : this._deserializeTrack(serialized))
            .filter(Boolean);

        const restoredQueue = (state.queue || [])
            .map(serialized => this.trackManager._deserializeTrack ? this.trackManager._deserializeTrack(serialized) : this._deserializeTrack(serialized))
            .filter(Boolean);

        this.currentTrack = state.currentTrack ? (this.trackManager._deserializeTrack ? this.trackManager._deserializeTrack(state.currentTrack) : this._deserializeTrack(state.currentTrack)) : null;

        if (!this.currentTrack && restoredQueue.length > 0) {
            this.currentTrack = restoredQueue.shift();
        }
        
        this.queue = restoredQueue;

        this.currentTrackStartOffsetMs = Math.max(Number(state.currentTrackStartOffsetMs) || 0, 0);
        this.lastPlaybackPosition = Math.max(Number(state.playbackPositionMs) || 0, 0);
        this.paused = false; // Will be resumed by caller
    }

    /**
     * Deserialize track from storage
     */
    _deserializeTrack(data) {
        if (!data) return null;

        const track = {
            id: data.id || null,
            title: data.title || null,
            url: data.url || null,
            duration: typeof data.duration === 'number' ? data.duration : Number(data.duration) || null,
            thumbnail: data.thumbnail || null,
            artist: data.artist || null,
            album: data.album || null,
            platform: data.platform || null,
            uploader: data.uploader || null,
            youtubeUrl: data.youtubeUrl || null,
            soundcloudUrl: data.soundcloudUrl || null,
            isLive: Boolean(data.isLive),
            addedAt: data.addedAt || Date.now(),
            extra: data.extra || null
        };

        if (data.requesterId) {
            const cachedMember = this.guild?.members?.cache?.get?.(data.requesterId) || null;
            track.requestedBy = cachedMember || { id: data.requesterId, tag: data.requesterTag || data.requesterId };
            track.requesterId = data.requesterId;
            track.requesterTag = data.requesterTag || null;
        }

        return track;
    }

    /**
     * Emit a queue event to the event store
     */
    async _emitEvent(eventType, payload) {
        if (!this.guild?.id) return;
        try {
            await this.eventStore.append(this.guild.id, { type: eventType, payload });
        } catch (error) {
            console.error(`[EventStore] Failed to emit ${eventType}:`, error);
        }
    }

    get connection() {
        return this.voiceHandler ? this.voiceHandler.connection : null;
    }

    set connection(val) {
        if (this.voiceHandler) {
            this.voiceHandler.connection = val;
        }
    }

    get isRecovering() {
        return this.voiceHandler ? this.voiceHandler.isRecovering : false;
    }

    set isRecovering(val) {
        if (this.voiceHandler) {
            this.voiceHandler.isRecovering = val;
        }
    }

    get audioPlayer() { return this.audioEngine ? this.audioEngine.audioPlayer : null; }
    get resource() { return this.audioEngine ? this.audioEngine.resource : null; }
    set resource(val) { if (this.audioEngine) this.audioEngine.resource = val; }
    get volume() { return this.audioEngine ? this.audioEngine.volume : config.bot.defaultVolume; }
    set volume(val) { if (this.audioEngine) this.audioEngine.volume = val; }
    get paused() { return this.audioEngine ? this.audioEngine.paused : false; }
    set paused(val) { if (this.audioEngine) this.audioEngine.paused = val; }
    get isPlaying() { return this.audioEngine ? this.audioEngine.isPlaying : false; }
    set isPlaying(val) { if (this.audioEngine) this.audioEngine.isPlaying = val; }
    get startTime() { return this.audioEngine ? this.audioEngine.startTime : null; }
    set startTime(val) { if (this.audioEngine) this.audioEngine.startTime = val; }
    get pausedTime() { return this.audioEngine ? this.audioEngine.pausedTime : 0; }
    set pausedTime(val) { if (this.audioEngine) this.audioEngine.pausedTime = val; }
    get preloadedStreams() { return this.audioEngine ? this.audioEngine.preloadedStreams : null; }
    get preloadingQueue() { return this.audioEngine ? this.audioEngine.preloadingQueue : null; }
    set preloadingQueue(val) { if (this.audioEngine) this.audioEngine.preloadingQueue = val; }
    get trackTimer() { return this.audioEngine ? this.audioEngine.trackTimer : null; }
    set trackTimer(val) { if (this.audioEngine) this.audioEngine.trackTimer = val; }
    get isTransitioning() { return this.audioEngine ? this.audioEngine.isTransitioning : false; }
    set isTransitioning(val) { if (this.audioEngine) this.audioEngine.isTransitioning = val; }
    get pendingEndReason() { return this.audioEngine ? this.audioEngine.pendingEndReason : null; }
    set pendingEndReason(val) { if (this.audioEngine) this.audioEngine.pendingEndReason = val; }
    get currentTrackRetries() { return this.audioEngine ? this.audioEngine.currentTrackRetries : 0; }
    set currentTrackRetries(val) { if (this.audioEngine) this.audioEngine.currentTrackRetries = val; }
    get skipRequested() { return this.audioEngine ? this.audioEngine.skipRequested : false; }
    set skipRequested(val) { if (this.audioEngine) this.audioEngine.skipRequested = val; }
    get stopRequested() { return this.audioEngine ? this.audioEngine.stopRequested : false; }
    set stopRequested(val) { if (this.audioEngine) this.audioEngine.stopRequested = val; }
    get expectedTrackEndTs() { return this.audioEngine ? this.audioEngine.expectedTrackEndTs : null; }
    set expectedTrackEndTs(val) { if (this.audioEngine) this.audioEngine.expectedTrackEndTs = val; }
    get currentTrackCache() { return this.audioEngine ? this.audioEngine.currentTrackCache : null; }
    set currentTrackCache(val) { if (this.audioEngine) this.audioEngine.currentTrackCache = val; }
    get activeStreamInfo() { return this.audioEngine ? this.audioEngine.activeStreamInfo : null; }
    set activeStreamInfo(val) { if (this.audioEngine) this.audioEngine.activeStreamInfo = val; }
    get lastPlaybackPosition() { return this.audioEngine ? this.audioEngine.lastPlaybackPosition : 0; }
    set lastPlaybackPosition(val) { if (this.audioEngine) this.audioEngine.lastPlaybackPosition = val; }
    get currentTrackStartOffsetMs() { return this.audioEngine ? this.audioEngine.currentTrackStartOffsetMs : 0; }
    set currentTrackStartOffsetMs(val) { if (this.audioEngine) this.audioEngine.currentTrackStartOffsetMs = val; }
    get currentLyrics() { return this.audioEngine ? this.audioEngine.currentLyrics : null; }
    set currentLyrics(val) { if (this.audioEngine) this.audioEngine.currentLyrics = val; }
    get pauseReasons() { return this.audioEngine ? this.audioEngine.pauseReasons : null; }
    set pauseReasons(val) { if (this.audioEngine) this.audioEngine.pauseReasons = val; }
    get inactivityTimer() { return this.audioEngine ? this.audioEngine.inactivityTimer : null; }
    set inactivityTimer(val) { if (this.audioEngine) this.audioEngine.inactivityTimer = val; }
    get inactivityTimeoutMs() { return this.audioEngine ? this.audioEngine.inactivityTimeoutMs : 120000; }
    set inactivityTimeoutMs(val) { if (this.audioEngine) this.audioEngine.inactivityTimeoutMs = val; }
    get currentDownloadedFile() { return this.audioEngine ? this.audioEngine.currentDownloadedFile : null; }
    set currentDownloadedFile(val) { if (this.audioEngine) this.audioEngine.currentDownloadedFile = val; }
    get downloadedFiles() { return this.audioEngine ? this.audioEngine.downloadedFiles : null; }
    set downloadedFiles(val) { if (this.audioEngine) this.audioEngine.downloadedFiles = val; }
    get downloadingFiles() { return this.audioEngine ? this.audioEngine.downloadingFiles : null; }
    set downloadingFiles(val) { if (this.audioEngine) this.audioEngine.downloadingFiles = val; }

    // Queue state delegates
    get queue() { return this.trackManager ? this.trackManager.queue : []; }
    set queue(val) { if (this.trackManager) this.trackManager.queue = val; }
    get currentTrack() { return this.trackManager ? this.trackManager.currentTrack : null; }
    set currentTrack(val) { if (this.trackManager) this.trackManager.currentTrack = val; }
    get history() { return this.trackManager ? this.trackManager.history : []; }
    set history(val) { if (this.trackManager) this.trackManager.history = val; }
    get previousTracks() { return this.trackManager ? this.trackManager.previousTracks : []; }
    set previousTracks(val) { if (this.trackManager) this.trackManager.previousTracks = val; }
    get isProcessingRequest() { return this.trackManager ? this.trackManager.isProcessingRequest : false; }
    set isProcessingRequest(val) { if (this.trackManager) this.trackManager.isProcessingRequest = val; }

    savePlaybackPosition() {
        if (this.startTime && !this.paused) {
            const elapsedMs = (Date.now() - this.startTime) + this.pausedTime;
            const totalMs = this.currentTrackStartOffsetMs + elapsedMs;
            this.lastPlaybackPosition = totalMs;
        }
    }

    async resumePlaybackAfterRecovery() {
        if (!this.currentTrack) return;

        try {
            const resumeMs = this.resource
                ? this.currentTrackStartOffsetMs + (this.resource.playbackDuration || 0)
                : this.lastPlaybackPosition || 0;
            await this.play(null, resumeMs);

        } catch (error) {
            console.error('❌ Failed to resume playback:', error);
            // Try to continue with next track
            await this.handleTrackEnd('error');
        }
    }

    async connect() {
        return await this.voiceHandler.connect();
    }

    async moveToChannel(newChannel) {
        return await this.voiceHandler.moveToChannel(newChannel);
    }

    disconnect() {
        this.voiceHandler.disconnect();
    }

    async addTrack(query, requestedBy, platform = 'auto') {
        return await this.trackManager.addTrack(query, requestedBy, platform);
    }

    async downloadTrack(track, streamUrl, streamInfo) {
        return await this.audioEngine.downloadTrack(track, streamUrl, streamInfo);
    }

    async deleteDownloadedFile(filepath) {
        return await this.audioEngine.deleteDownloadedFile(filepath);
    }

    async playStream(trackPayload) {
        return await this.audioEngine.playStream(trackPayload);
    }

    async play(trackIndex = null, seekMs = 0) {
        return await this.audioEngine.play(trackIndex, seekMs);
    }

pause(reason = 'manual') {
        const result = this.audioEngine.pause(reason);
        this._emitEvent('pause', {});
        return result;
    }

    resume(reason = 'manual') {
        const result = this.audioEngine.resume(reason);
        this._emitEvent('resume', {});
        return result;
    }

    pauseFor(reason = null) {
        const result = this.audioEngine.pauseFor(reason);
        this._emitEvent('pause', {});
        return result;
    }

    resumeFor(reason = null) {
        const result = this.audioEngine.resumeFor(reason);
        this._emitEvent('resume', {});
        return result;
    }

    startInactivityTimer() {
        this.audioEngine.startInactivityTimer();
    }

    clearInactivityTimer(shouldResume = true) {
        this.audioEngine.clearInactivityTimer(shouldResume);
    }

stop() {
        this.audioEngine.stop();
        this._emitEvent('stop', {});
    }

skip() {
        const fromTrack = this.currentTrack;
        const result = this.audioEngine.skip();
        const toTrack = this.currentTrack;
        if (fromTrack || toTrack) {
            this._emitEvent('skip', {
                fromTrackId: fromTrack?.id || fromTrack?.url,
                toTrackId: toTrack?.id || toTrack?.url
            });
        }
        return result;
    }

previous() {
        const result = this.audioEngine.previous();
        if (this.currentTrack) {
            this._emitEvent('play', {
                track: this._serializeTrack(this.currentTrack),
                guildId: this.guild.id,
                requestedBy: this.currentTrack?.requesterId || null
            });
        }
        return result;
    }

    async seek(positionMs) {
        const result = await this.audioEngine.seek(positionMs);
        this._emitEvent('seek', { positionMs });
        return result;
    }

    setVolume(volume) {
        const result = this.audioEngine.setVolume(volume);
        this._emitEvent('volume', { volume });
        return result;
    }

    getCurrentTime() {
        return this.audioEngine.getCurrentTime();
    }

    async handleTrackEnd(reason = 'idle') {
        return await this.audioEngine.handleTrackEnd(reason);
    }

    async handleAutoplay() {
        return await this.audioEngine.handleAutoplay();
    }

    async handleError(error, userMessage = null) {
        return await this.audioEngine.handleError(error, userMessage);
    }

async handleMusicData(trackData, member, interaction = null) {
        // Çakışma önleme (Concurrency lock) can be handled by just queueing things, but we'll adapt _processMusic
        const wasPlayingBefore = this.currentTrack !== null;
        const isPlaylist = trackData.isPlaylist || false;
        const tracks = trackData.tracks;

        try {
            let firstTrackResult = null;
            const wasIdle = (!this.currentTrack && this.queue.length === 0);

            for (let i = 0; i < tracks.length; i++) {
                const track = { ...tracks[i] };
                track.requestedBy = member;
                track.addedAt = Date.now();

                if (i === 0 && wasIdle) {
                    this.currentTrack = track;
                    try {
                        if (!this.connection) {
                            await this.connect();
                        }
                        await this.play();
                        firstTrackResult = await this.ui.createNewMusicEmbed(track, member, interaction);
                        
                        // Emit play event
                        await this._emitEvent('play', {
                            track: this._serializeTrack(track),
                            guildId: this.guild.id,
                            requestedBy: member?.id || null
                        });
                    } catch (playError) {
                        console.error('Error in play process:', playError);
                        this.currentTrack = null;
                        this.queue.push(track);
                    }
                } else {
                    this.queue.push(track);
                    // Emit add event
                    await this._emitEvent('add', {
                        track: this._serializeTrack(track),
                        position: this.queue.length - 1
                    });
                }
            }

            // Sequential preload
            this.sequentialPreload(this.queue.slice()).catch(err =>
                console.error('❌ Sequential preload error:', err.message)
            );

            if (firstTrackResult && tracks.length > 1) {
                await this.ui.showPlaylistAdditionMessage(tracks, member, interaction, isPlaylist);
                await this.ui.updateNowPlayingEmbed();
                return firstTrackResult;
            }

            if (wasPlayingBefore || (!firstTrackResult && tracks.length > 0)) {
                return await this.ui.handleQueueAddition(tracks, member, interaction, isPlaylist);
            }

            if (firstTrackResult) {
                return firstTrackResult;
            }

            return { success: true, message: 'Track processed successfully' };
        } catch (error) {
            console.error('Error processing music data:', error);
            return { success: false, message: 'Error processing music' };
        }
    }

    async sequentialPreload(tracks) {
        // Only preload first 2 tracks
        const preloadTracks = tracks.slice(0, 2);
        for (const track of preloadTracks) {
            if (this.preloadedStreams?.has(track.url) || this.preloadingQueue?.includes(track.url)) {
                continue;
            }
            try {
                await this.preloadTrack(track);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`❌ Preload error for ${track.title}:`, err.message);
            }
        }
    }

    detectPlatform(query) {
        return this.audioEngine.detectPlatform(query);
    }

    async preloadTrack(track) {
        return await this.audioEngine.preloadTrack(track);
    }

    async fetchAndStartLyrics() {
        return await this.audioEngine.fetchAndStartLyrics();
    }

    hasLyrics() {
        return this.audioEngine.hasLyrics();
    }


shuffleQueue() {
        const shuffled = this.trackManager.shuffle();
        if (shuffled) {
            this._emitEvent('shuffle', { enabled: true });
            this.scheduleStatePersist('shuffle-queue', 200);
        }
        return shuffled;
    }

    setLoop(mode) {
        // mode: false, 'track', 'queue'
        this.loop = mode;
        this._emitEvent('loop', { mode });
        this.scheduleStatePersist('loop', 200);
        return this.loop;
    }

    setShuffle(enabled) {
        this.shuffle = enabled;
        this._emitEvent('shuffle', { enabled });
        this.scheduleStatePersist('shuffle-toggle', 200);
        return this.shuffle;
    }

clear() {
        const cleared = this.trackManager.clear();
        this._emitEvent('clear', {});
        this.scheduleStatePersist('clear-queue', 0);
        return cleared;
    }

removeFromQueue(index) {
        const removed = this.trackManager.removeTrack(index);
        if (removed) {
            this._emitEvent('remove', { trackId: removed.id || removed.url });
            this.scheduleStatePersist('queue-remove', 200);
        }
        return removed;
    }

    removeQueueItem(index) {
        const removed = this.trackManager.removeTrack(index);
        if (removed) {
            console.log(`🗑️ [QUEUE MUTATION] Cleared index ${index}: ${removed.title}`);
            this._emitEvent('remove', { trackId: removed.id || removed.url });
            this.broadcastStateUpdate(); // Real-time UI refresh anchor
        }
        return this.queue;
    }

    broadcastStateUpdate() {
        console.log(`📢 [STATE BROADCAST] Emitting real-time state sync.`);
        this.persistState('api-sync', true).catch(() => {});
    }

    moveInQueue(from, to) {
        if (from >= 0 && from < this.queue.length && to >= 0 && to < this.queue.length) {
            const track = this.queue.splice(from, 1)[0];
            this.queue.splice(to, 0, track);
            this._emitEvent('reorder', { trackIds: this.queue.map(t => t.id || t.url) });
            this.scheduleStatePersist('queue-move', 200);
            return true;
        }
        return false;
    }

    getQueue() {
        return this.trackManager.getQueue();
    }

    getTotalDuration() {
        return this.trackManager.getTotalDuration();
    }


    async showQueueCompleted() {
        if (!this.nowPlayingMessage || !this.textChannel) return;

        try {
            const completedTitle = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.queue_completed');
            const completedDesc = await LanguageManager.getTranslation(this.guild.id, 'musicplayer.queue_completed_desc');

            const embed = new EmbedBuilder()
                .setTitle(completedTitle)
                .setDescription(completedDesc)
                .setColor('#00ff00')
                .setTimestamp();

            // Create disabled buttons
            const disabledButtons = await this.ui.createControlButtons(true);

            await this.nowPlayingMessage.edit({
                embeds: [embed],
                components: disabledButtons
            });

        } catch (error) {
            // Message might be deleted, clear reference
            this.nowPlayingMessage = null;
        }
    }

restoreFromState(state) {
        // First initialize event store and rebuild from events
        this.initializeEventStore().catch(err => console.error('[EventStore] Init error:', err));
        
        // Then restore from legacy state persistence for backward compatibility
        return this.statePersistence.restoreFromState(state);
    }

    persistState(reason = 'manual', immediate = false) {
        return this.statePersistence.persistState(reason, immediate);
    }

    startStateSync() {
        return this.statePersistence.startStateSync();
    }

    stopStateSync() {
        return this.statePersistence.stopStateSync();
    }

    cancelStateSave() {
        return this.statePersistence.cancelStateSave();
    }

    scheduleStatePersist(reason = 'update', delay = 200) {
        return this.statePersistence.scheduleStatePersist(reason, delay);
    }

cleanup(isShutdown = false) {
        try {
            this.clearInactivityTimer(false);
            this.stopStateSync();
            if (this.statePersistence) this.statePersistence.cleanup();
            
            // Stop event store snapshot timer
            if (this.guild?.id) {
                this.eventStore.stopSnapshotTimer(this.guild.id);
            }

            // During shutdown, save state before cleanup
            if (isShutdown && this.guild?.id) {
                this.persistState('shutdown').catch(() => {});
            } else if (this.guild?.id) {
                PlayerStateManager.removeState(this.guild.id).catch(() => {});
            }

            // Clean up all downloaded files (unless shutdown)
            if (!isShutdown) {
                if (this.currentDownloadedFile) {
                    this.deleteDownloadedFile(this.currentDownloadedFile);
                    this.currentDownloadedFile = null;
                }

                for (const filepath of this.downloadedFiles) {
                    this.deleteDownloadedFile(filepath);
                }
                this.downloadedFiles.clear();
            }

            // Clean up voice connection
            if (this.voiceHandler) {
                this.voiceHandler.cleanup();
            }

            // Clear track timer
            if (this.trackTimer) {
                clearTimeout(this.trackTimer);
                this.trackTimer = null;
            }

            // Stop audio player
            if (this.audioPlayer) {
                this.audioPlayer.stop();
                this.audioPlayer.removeAllListeners();
            }

            // Clear resources
            if (this.resource) {
                try {
                    this.resource.playStream.destroy();
                } catch (e) {
                    // Stream might already be destroyed
                }
                this.resource = null;
            }

            // Clear preloaded streams
            this.preloadedStreams.clear();
            this.preloadingQueue = [];

            // Clear player data
            this.queue = [];
            this.currentTrack = null;
            this.previousTracks = [];
            this.startTime = null;
            this.pausedTime = 0;
            this.currentTrackCache = null;
            this.activeStreamInfo = null;

            // Clear recovery data
            this.isRecovering = false;
            this.recoveryAttempts = 0;
            this.lastPlaybackPosition = 0;
            this.currentTrackStartOffsetMs = 0;

            // Clear UI references
            this.nowPlayingMessage = null;
            this.requesterId = null;
            this.voiceChannel = null;
            this.textChannel = null;

            // Reset pause state
            this.pauseReasons.clear();
            this.paused = false;
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }



    getStatus() {
        return {
            connected: !!this.connection,
            playing: this.audioPlayer?.state?.status === AudioPlayerStatus.Playing,
            paused: this.audioPlayer?.state?.status === AudioPlayerStatus.Paused,
            queue: this.queue.length,
            volume: this.volume,
            loop: this.loop,
            shuffle: this.shuffle,
            currentTrack: this.currentTrack,
            voiceChannel: this.voiceChannel?.name,
            textChannel: this.textChannel?.name,
        };
    }

    // Clean up resources when destroying the player
    destroy() {
        // Clear track timer
        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
            this.currentTrackCache = null;
            this.activeStreamInfo = null;
            this.lastPlaybackPosition = 0;
        }

        // Clear preloaded streams
        if (this.preloadedStreams) {
            this.preloadedStreams.clear();
        }

        // Stop audio and disconnect
        if (this.audioPlayer) {
            this.audioPlayer.stop();
        }

        if (this.voiceHandler) {
            this.voiceHandler.cleanup();
        }
    }
}






module.exports = PlayerCore;
