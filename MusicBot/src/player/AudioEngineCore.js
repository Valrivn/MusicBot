const {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    entersState,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const config = require('../../config');
const StreamResolver = require('./StreamResolver');
const LanguageManager = require('../LanguageManager');
const DownloadManager = require('./DownloadManager');
const PlaybackController = require('./PlaybackController');
const AutoPlayEngine = require('./AutoPlayEngine');
const ErrorHandler = require('../ErrorHandler');
const PlayerStateManager = require('../PlayerStateManager');
const LyricsHandler = require('./LyricsHandler');
const AudioResourceFactory = require('./AudioResourceFactory');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const { promisify } = require('util');
const { Readable } = require('stream');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const AuditLog = require('../AuditLog');

const CACHE_DIR = path.join(__dirname, '..', '..', 'audio_cache');

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

class AudioEngineCore {
    constructor(player) {
        this.player = player;

        // Audio player setup
        this.audioPlayer = createAudioPlayer();
        this.resource = null;

        // Player states/settings
        this.volume = config.bot.defaultVolume;
        this.paused = false;
        this.isPlaying = false;
        
        // Timestamps
        this.startTime = null;
        this.pausedTime = 0;

        // Preloading system
        this.preloadedStreams = new Map(); // trackUrl -> streamInfo
        this.preloadingQueue = []; // URLs being preloaded

        // Playback lifecycle state
        this.trackTimer = null;
        this.isTransitioning = false;
        this.pendingEndReason = null;
        this.currentTrackRetries = 0;
        this.skipRequested = false;
        this.stopRequested = false;
        this.expectedTrackEndTs = null;
        this.currentTrackCache = null;
        this.activeStreamInfo = null;
        this.lastPlaybackPosition = 0;
        this.currentTrackStartOffsetMs = 0;

        // Lyrics system
        this.currentLyrics = null;

        // Pause reasons
        this.pauseReasons = new Set();

        // Inactivity timeout
        this.inactivityTimer = null;
        this.inactivityTimeoutMs = 2 * 60 * 1000;

        // Local file caching
        this.currentDownloadedFile = null;

        this.setupEvents();
    }

    setupEvents() {
        this.audioPlayer.on('stateChange', (oldState, newState) => {
            if (newState.status === AudioPlayerStatus.Playing) {
                this.isPlaying = true;
                this.startTime = Date.now();
                if (oldState.status !== AudioPlayerStatus.Paused) {
                    this.currentTrackStartOffsetMs = this.currentTrackStartOffsetMs || 0;
                }
                this.paused = false;
                console.log("🎵 [@discordjs/voice] Stream is actively Playing. Karaoke sync timeline anchored!");
            }
        });

        this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
            this.isPlaying = false;
            if (this.startTime) {
                this.pausedTime += Date.now() - this.startTime;
            }
            this.paused = true;
        });

        this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
            this.isPlaying = false;
            PlaybackController.handleTrackEnd(this, 'idle');
        });

        this.audioPlayer.on('error', (error) => {
            console.error('🎵 Audio player error:', error);

            if (this.player.currentTrack && error.message &&
                (error.message.includes('stream') || error.message.includes('network'))) {
                this.player.voiceHandler.startConnectionRecovery();
            } else {
                this.handleError(error);
            }
        });
    }

    async playStream(trackPayload) {
        this.player.currentTrack = trackPayload;
        return await this.play(null, 0);
    }

    async play(trackIndex = null, seekMs = 0) {
        try {
            if (!this.player.currentTrack) {
                if (this.player.queue.length === 0) {
                    const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.no_tracks_in_queue');
                    return { success: false, message: errorMsg };
                }
                this.player.currentTrack = this.player.queue.shift();
            }

            if (trackIndex !== null && this.player.queue[trackIndex]) {
                this.player.currentTrack = this.player.queue.splice(trackIndex, 1)[0];
            }

            if (!this.player.connection) {
                const connected = await this.player.connect();
                if (!connected) {
                    const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.failed_connect_voice');
                    return { success: false, message: errorMsg };
                }
            }

            this.pendingEndReason = null;
            this.skipRequested = false;
            this.stopRequested = false;
            const resumeFromMs = Math.max(0, Math.floor(Number(seekMs) || 0));
            const resumeFromSeconds = resumeFromMs / 1000;
            this.currentTrackStartOffsetMs = resumeFromMs;
            this.lastPlaybackPosition = resumeFromMs;
            this.pausedTime = 0;
            this.startTime = null;

            let streamUrl = this.player.currentTrack.url;
            let streamInfo;

            if (resumeFromMs > 0) {
                const cached = this.getCachedStreamForCurrentTrack(resumeFromSeconds);
                if (cached) {
                    streamInfo = cached;
                }
            }

            const preloaded = (!streamInfo && resumeFromMs === 0)
                ? this.preloadedStreams.get(this.player.currentTrack.url)
                : null;
            if (!streamInfo && preloaded) {
                streamInfo = preloaded.info;
                this.preloadedStreams.delete(this.player.currentTrack.url);
            }

            if (!streamInfo) {
                streamInfo = await StreamResolver.resolveStream(this.player.currentTrack, this.player.guild.id, resumeFromSeconds);
            }

            if (!streamInfo) {
                const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.failed_get_audio_stream');
                throw new Error(errorMsg);
            }

            let streamUrl_final = (typeof streamInfo === 'string')
                ? streamInfo
                : (streamInfo.stream ? streamInfo.stream : streamInfo.url);

            let downloadedFile;
            let shouldDownload = false;
            
            if (this.currentDownloadedFile && fsSync.existsSync(this.currentDownloadedFile)) {
                downloadedFile = this.currentDownloadedFile;
            } else {
                const hash = crypto.createHash('md5').update(this.player.currentTrack.url).digest('hex');
                const filepath = path.join(CACHE_DIR, `track_${hash}.opus`);
                
                if (fsSync.existsSync(filepath)) {
                    const stats = fsSync.statSync(filepath);
                    if (stats.size > 0) {
                        downloadedFile = filepath;
                        DownloadManager.downloadedFiles.add(filepath);
                        this.currentDownloadedFile = filepath;
                    } else {
                        shouldDownload = true;
                    }
                } else {
                    shouldDownload = true;
                }
            }

            if (shouldDownload) {
                const hash = crypto.createHash('md5').update(this.player.currentTrack.url).digest('hex');
                const filepath = path.join(CACHE_DIR, `track_${hash}.opus`);
                const trackToDownload = this.player.currentTrack;
                
                DownloadManager.downloadTrack(trackToDownload, streamUrl_final, streamInfo, this.player)
                    .then(file => {
                        if (this.player.currentTrack && this.player.currentTrack.url === trackToDownload.url) {
                            this.currentDownloadedFile = file;
                        }
                    })
                    .catch(err => {
                        if (err && err.message) {
                            console.error(`⚠️ Background download failed: ${err.message}`);
                        }
                    });

                let audioStream;
                if (typeof streamInfo === 'object' && streamInfo.stream) {
                    audioStream = streamInfo.stream;
                } else if (typeof streamUrl_final === 'string') {
                    const fetch = await ensureFetch();
                    try {
                        const response = await fetch(streamUrl_final, {
                            headers: streamInfo?.httpHeaders || {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        });
                        if (!response.ok) throw new Error(`Failed to fetch stream: ${response.status}`);
                        audioStream = typeof response.body?.getReader === 'function' && typeof Readable.fromWeb === 'function' 
                            ? Readable.fromWeb(response.body) 
                            : response.body;
                    } catch (fetchError) {
                        for (let i = 0; i < 30; i++) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            if (fsSync.existsSync(filepath)) {
                                const stats = fsSync.statSync(filepath);
                                if (stats.size > 0) {
                                    shouldDownload = false;
                                    downloadedFile = filepath;
                                    break;
                                }
                            }
                        }
                        if (!downloadedFile) throw fetchError;
                    }
                } else {
                    audioStream = streamUrl_final;
                }

                if (!audioStream && downloadedFile) {
                    shouldDownload = false;
                } else if (audioStream) {
                    this.resource = AudioResourceFactory.createFromStream(
                        audioStream, 
                        this.player.currentTrack, 
                        streamInfo, 
                        resumeFromMs
                    );
                }
            }
            
            if (!shouldDownload && downloadedFile) {
                console.log(`🎵 Playing from cached file: ${path.basename(downloadedFile)} (seek: ${resumeFromMs}ms)`);
                this.resource = AudioResourceFactory.createFromFile(
                    downloadedFile, 
                    this.player.currentTrack, 
                    streamInfo, 
                    resumeFromMs
                );
            }

            if (!this.resource) {
                throw new Error('Failed to create audio resource');
            }

            if (this.resource.volume) {
                this.resource.volume.setVolume(this.volume / 100);
            }

            if (streamInfo && streamInfo.duration && streamInfo.duration > 0) {
                this.player.currentTrack.duration = streamInfo.duration;
            }

            console.log(`▶️  Playing: ${this.player.currentTrack.title} (${this.player.currentTrack.duration}s, offset: ${resumeFromMs}ms)`);

            this.audioPlayer.play(this.resource);

            if (this.pauseReasons.size > 0) {
                console.log(`⏸️  Paused due to: ${Array.from(this.pauseReasons).join(', ')}`);
                this.audioPlayer.pause();
            }

            const baseSourceUrl = typeof streamInfo === 'object'
                ? (streamInfo.rawUrl || streamInfo.url || (typeof streamUrl_final === 'string' ? streamUrl_final : null))
                : streamUrl_final;

            this.activeStreamInfo = {
                trackKey: this.getTrackCacheKey(this.player.currentTrack),
                platform: this.player.currentTrack.platform,
                fetchedAt: Date.now(),
                resumeSupported: typeof streamInfo === 'object' ? Boolean(streamInfo.canSeek) : false,
                baseUrl: baseSourceUrl,
                info: typeof streamInfo === 'object' ? streamInfo : { url: streamUrl_final }
            };

            this.currentTrackCache = this.activeStreamInfo;
            this.scheduleTrackWatchdog(streamInfo);
            this.player.startStateSync();
            await this.player.persistState(resumeFromMs > 0 ? 'resume-playback' : 'play');
            this.fetchAndStartLyrics();

            return { success: true, track: this.player.currentTrack };

        } catch (error) {
            if (this.currentDownloadedFile) {
                await this.deleteDownloadedFile(this.currentDownloadedFile);
                this.currentDownloadedFile = null;
            }
            const errorMsg = await ErrorHandler.handle(error, this.player.guild.id, 'MusicPlayer.play');
            await this.handleError(error, errorMsg);
            return { success: false, message: errorMsg };
        }
    }

    async deleteDownloadedFile(filepath) {
        const DownloadManager = require('./DownloadManager');
        return await DownloadManager.deleteDownloadedFile(filepath, this.player);
    }

    scheduleTrackWatchdog(streamInfo = null) {
        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
        }

        const streamDuration = streamInfo && Number(streamInfo.duration) > 0 ? Number(streamInfo.duration) : null;
        const trackDuration = this.player.currentTrack && Number(this.player.currentTrack.duration) > 0 ? Number(this.player.currentTrack.duration) : null;
        const durationSeconds = streamDuration || trackDuration;

        if (durationSeconds && durationSeconds > 0) {
            const startOffsetSeconds = Math.floor((this.currentTrackStartOffsetMs || 0) / 1000);
            const remainingSeconds = Math.max(1, durationSeconds - startOffsetSeconds);
            
            this.expectedTrackEndTs = Date.now() + (remainingSeconds * 1000);
            const timeoutMs = Math.max(remainingSeconds * 1000 + 4000, 5000);
            
            console.log(`🕒 Track watchdog: ${remainingSeconds}s remaining (${durationSeconds}s total, ${startOffsetSeconds}s offset)`);
            this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), timeoutMs);
        } else {
            this.expectedTrackEndTs = null;
            this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 5 * 60 * 1000);
        }
    }

    getTrackCacheKey(track) {
        if (!track) return null;
        return track.id || track.url || `${track.title}-${track.duration}`;
    }

    getCachedStreamForCurrentTrack(seekSeconds) {
        if (!this.currentTrackCache) return null;
        const key = this.getTrackCacheKey(this.player.currentTrack);
        if (!key || this.currentTrackCache.trackKey !== key) return null;
        if (!this.currentTrackCache.resumeSupported || !this.currentTrackCache.baseUrl) return null;
        const seekUrl = this.applySeekToUrl(this.currentTrackCache.baseUrl, seekSeconds);
        if (!seekUrl) return null;

        return {
            ...this.currentTrackCache.info,
            url: seekUrl,
            canSeek: true,
            fromCache: true,
            duration: this.currentTrackCache.info?.duration || this.player.currentTrack.duration
        };
    }

    applySeekToUrl(baseUrl, seekSeconds) {
        if (!baseUrl) return null;
        if (seekSeconds <= 0) return baseUrl;

        let url = baseUrl.replace(/(&|\?)begin=\d+/g, '');
        url = url.replace(/(&|\?)start=\d+/g, '');

        const isYouTubeStream = /googlevideo\.com/i.test(url);
        if (!isYouTubeStream) {
            return null;
        }

        const separator = url.includes('?') ? '&' : '?';
        const startMs = Math.max(0, Math.floor(seekSeconds * 1000));
        return `${url}${separator}begin=${startMs}`;
    }

    ensureTrackCompletion() {
        if (!this.player.currentTrack) {
            this.trackTimer = null;
            return;
        }

        const status = this.audioPlayer.state?.status;

        if (status === AudioPlayerStatus.Playing) {
            const playbackMs = this.resource?.playbackDuration || 0;
            const durationMs = (Number(this.player.currentTrack.duration) || 0) * 1000;

            if (durationMs > 0 && playbackMs + 1500 < durationMs) {
                const remainingMs = Math.max(durationMs - playbackMs, 2000);
                this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), remainingMs);
                return;
            }

            if (!this.pendingEndReason) {
                this.pendingEndReason = 'watchdog';
            }
            this.audioPlayer.stop();
            this.trackTimer = null;
            return;
        }

        if (status === AudioPlayerStatus.Idle || status === AudioPlayerStatus.AutoPaused) {
            this.trackTimer = null;
            return;
        }

        this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 2000);
    }

    onPlayerIdle(trigger = 'idle') {
        const reason = this.consumePendingEndReason(trigger);
        setTimeout(() => {
            this.handleTrackEnd(reason).catch(console.error);
        }, 60);
    }

    consumePendingEndReason(defaultReason = 'idle') {
        const reason = this.pendingEndReason || defaultReason;
        this.pendingEndReason = null;
        return reason;
    }

    pause() {
        return PlaybackController.pause(this);
    }

    resume(reason = 'manual') {
        return PlaybackController.resume(this, reason);
    }

    pauseFor(reason = null) {
        return PlaybackController.pauseFor(this, reason);
    }

    resumeFor(reason = null) {
        return PlaybackController.resumeFor(this, reason);
    }

    startInactivityTimer() {
        if (this.inactivityTimer) return;
        this.pauseFor('alone');

        this.inactivityTimer = setTimeout(async () => {
            this.inactivityTimer = null;

            const channelId = this.player.voiceChannel?.id;
            const channel = channelId ? this.player.guild.channels.cache.get(channelId) : null;
            const hasListeners = channel ? channel.members.filter(member => !member.user.bot).size > 0 : false;

            if (hasListeners) {
                // Refresh UI if needed
                if (this.player.ui) {
                    await this.player.ui.updateNowPlayingEmbed();
                }
                return;
            }

            this.pauseReasons.clear();
            this.pendingEndReason = 'inactivity-timeout';
            this.player.queue = [];
            this.player.currentTrack = null;

            try {
                if (this.player.ui) {
                    await this.player.ui.updateNowPlayingEmbed();
                } else if (typeof this.player.showQueueCompleted === 'function') {
                    await this.player.showQueueCompleted();
                }
                await this.player.persistState('inactivity-timeout');
            } catch (error) {
                console.error('❌ Failed to update playback UI after inactivity timeout:', error);
            } finally {
                try {
                    this.player.cleanup();
                } finally {
                    const client = this.player.guild?.client;
                    if (client?.players) {
                        client.players.delete(this.player.guild.id);
                    }
                }
            }
        }, Math.max(this.inactivityTimeoutMs, 0));
    }

    clearInactivityTimer(shouldResume = true) {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }

        if (shouldResume) {
            this.resumeFor('alone');
        } else {
            this.pauseReasons.delete('alone');
        }
    }

    stop() {
        PlaybackController.stop(this);
    }

    skip() {
        return PlaybackController.skip(this);
    }

    previous() {
        return PlaybackController.previous(this);
    }

    async seek(positionMs) {
        return await PlaybackController.seek(this, positionMs);
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(100, volume));
        if (this.resource && this.resource.volume) {
            this.resource.volume.setVolume(this.volume / 100);
        }
        this.player.scheduleStatePersist('volume', 200);
        return this.volume;
    }

    getCurrentTime() {
        const playbackDuration = this.audioPlayer?.state?.resource?.playbackDuration;
        if (typeof playbackDuration === 'number' && Number.isFinite(playbackDuration)) {
            return this.currentTrackStartOffsetMs + playbackDuration;
        }

        if (!this.startTime) return this.currentTrackStartOffsetMs;
        if (this.paused) {
            return this.currentTrackStartOffsetMs + this.pausedTime;
        }
        return this.currentTrackStartOffsetMs + (Date.now() - this.startTime) + this.pausedTime;
    }

    async handleTrackEnd(reason = 'idle') {
        await PlaybackController.handleTrackEnd(this, reason);
    }

    async handleAutoplay() {
        await AutoPlayEngine.handleAutoplay(this);
    }

    async handleError(error, userMessage = null) {
        if (this.player.queue.length > 0) {
            if (userMessage && this.player.textChannel) {
                try {
                    await this.player.textChannel.send(userMessage);
                } catch (_) {}
            }
            this.player.currentTrack = this.player.queue.shift();
            await this.play(null, 0);
        } else {
            this.player.currentTrack = null;
            const msg = userMessage || await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.error_playlist_stopped');
            if (this.player.textChannel) {
                try {
                    await this.player.textChannel.send(msg);
                } catch (_) {}
            }
        }
    }

    detectPlatform(query) {
        return StreamResolver.detectPlatform(query);
    }

    async preloadTrack(track) {
        if (!track || !track.url) return;

        // Check queue position - only preload if position < 2 (first 2 tracks)
        const queueIndex = this.player.queue.findIndex(t => t.url === track.url);
        if (queueIndex >= 2) return;

        const hash = crypto.createHash('md5').update(track.url).digest('hex');
        const filepath = path.join(CACHE_DIR, `track_${hash}.opus`);
        
        if (fsSync.existsSync(filepath)) {
            const stats = fsSync.statSync(filepath);
            if (stats.size > 0) {
                return;
            }
        }

        if (this.preloadedStreams.has(track.url) || 
            this.preloadingQueue.includes(track.url) ||
            DownloadManager.downloadingFiles.has(filepath)) {
            return;
        }

        this.preloadingQueue.push(track.url);

        try {
            let streamInfo;
            try {
                streamInfo = await StreamResolver.resolveStream(track, this.player.guild.id, 0);
            } catch (err) {
                console.error(`[StreamResolver] Preload stream resolve failed:`, err);
            }

            if (streamInfo) {
                let streamUrl_final = (typeof streamInfo === 'string')
                    ? streamInfo
                    : (streamInfo.stream || streamInfo.url);

                await DownloadManager.downloadTrack(track, streamUrl_final, streamInfo, this.player);
                
                this.preloadedStreams.set(track.url, {
                    info: streamInfo,
                    track: track,
                    downloaded: true
                });
            }
        } catch (error) {
            if (error && error.message) {
                console.error(`❌ Pre-download failed for ${track.title}:`, error.message);
            }
        } finally {
            const index = this.preloadingQueue.indexOf(track.url);
            if (index > -1) this.preloadingQueue.splice(index, 1);
        }
    }

    async fetchAndStartLyrics() {
        try {
            if (!this.player.currentTrack) return;
            this.currentLyrics = await LyricsHandler.fetchLyrics(this.player.currentTrack);

            if (this.currentLyrics && this.currentLyrics.plain) {
                if (this.player.ui && this.player.nowPlayingMessage) {
                    try {
                        await this.player.ui.updateNowPlayingEmbed();
                    } catch (error) {}
                }
            }
        } catch (error) {
            console.error('❌ Failed to fetch lyrics:', error.message);
            this.currentLyrics = null;
        }
    }

    hasLyrics() {
        return Boolean(this.currentLyrics && this.currentLyrics.plain);
    }

    cleanup() {
        this.clearInactivityTimer(false);

        if (this.currentDownloadedFile) {
            DownloadManager.deleteDownloadedFile(this.currentDownloadedFile, this.player).catch(() => {});
            this.currentDownloadedFile = null;
        }

        for (const filepath of DownloadManager.downloadedFiles) {
            DownloadManager.deleteDownloadedFile(filepath, this.player).catch(() => {});
        }
        DownloadManager.downloadedFiles.clear();

        if (this.trackTimer) {
            clearTimeout(this.trackTimer);
            this.trackTimer = null;
        }

        if (this.audioPlayer) {
            this.audioPlayer.stop();
            this.audioPlayer.removeAllListeners();
        }

        this.preloadedStreams.clear();
        this.preloadingQueue = [];

        this.startTime = null;
        this.pausedTime = 0;
        this.currentTrackCache = null;
        this.activeStreamInfo = null;

        this.lastPlaybackPosition = 0;
        this.currentTrackStartOffsetMs = 0;

        this.pauseReasons.clear();
        this.paused = false;
    }
}

module.exports = AudioEngineCore;
