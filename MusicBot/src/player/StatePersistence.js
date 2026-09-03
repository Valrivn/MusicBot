const path = require('path');
const fsSync = require('fs');

class StatePersistence {
    constructor(player, dependencies = {}) {
        this.player = player;
        this.stateManager = dependencies.stateManager;
        this.languageManager = dependencies.languageManager;
        this.embedManager = dependencies.embedManager;
        this.cacheDir = dependencies.cacheDir || path.join(__dirname, '..', '..', 'audio_cache');
        
        this.stateSyncInterval = null;
        this.stateSyncIntervalMs = 5000;
        this.stateSaveTimeout = null;
        this.pendingStateSave = null;
        this.isRestoring = false;
    }

    serializeTrack(track) {
        if (!track) return null;

        const requester = track.requestedBy || null;
        const requesterId = requester?.id || track.requesterId || null;
        const requesterTag = requester?.tag || requester?.user?.tag || track.requesterTag || null;

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
            requesterId,
            requesterTag,
            extra: track.extra || null
        };
    }

    deserializeTrack(data) {
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
            const cachedMember = this.player.guild?.members?.cache?.get?.(data.requesterId) || null;
            track.requestedBy = cachedMember || { id: data.requesterId, tag: data.requesterTag || data.requesterId };
            track.requesterId = data.requesterId;
            track.requesterTag = data.requesterTag || null;
        }

        return track;
    }

    serializeState() {
        const guildId = this.player.guild?.id;
        if (!guildId) return null;

        return {
            guildId,
            voiceChannelId: this.player.voiceChannel?.id || null,
            textChannelId: this.player.textChannel?.id || null,
            currentTrack: this.serializeTrack(this.player.currentTrack),
            queue: this.player.queue.map(track => this.serializeTrack(track)).filter(Boolean),
            previousTracks: this.player.previousTracks.slice(-10).map(track => this.serializeTrack(track)).filter(Boolean),
            volume: this.player.volume,
            loop: this.player.loop,
            shuffle: this.player.shuffle,
            autoplay: this.player.autoplay,
            paused: this.player.paused,
            pauseReasons: Array.from(this.player.pauseReasons || []),
            playbackPositionMs: this.player.getCurrentTime() || 0,
            currentTrackStartOffsetMs: this.player.currentTrackStartOffsetMs || 0,
            lastPlaybackPosition: this.player.lastPlaybackPosition || 0,
            requesterId: this.player.requesterId || null,
            nowPlayingMessageId: this.player.nowPlayingMessage?.id || null,
            nowPlayingChannelId: this.player.nowPlayingMessage?.channelId || this.player.textChannel?.id || null,
            sessionId: this.player.sessionId,
            downloadedFiles: Array.from(this.player.downloadedFiles || [])
                .filter(Boolean)
                .map(filepath => path.resolve(filepath)),
            currentDownloadedFile: this.player.currentDownloadedFile ? path.resolve(this.player.currentDownloadedFile) : null,
            updatedAt: Date.now()
        };
    }

    async restoreFromState(state) {
        if (this.isRestoring) return { success: false, error: new Error('Already restoring state') };
        this.isRestoring = true;

        try {
            if (!state || !this.player.guild?.id) return { success: false, error: new Error('Invalid state or missing guild ID') };
            if (state.guildId && state.guildId !== this.player.guild.id) {
                return { success: false, error: new Error('Guild ID mismatch') };
            }

            this.stopStateSync();
        this.player.pauseReasons = new Set();
        this.player.preloadedStreams?.clear();
        if (this.player.preloadingQueue) this.player.preloadingQueue.length = 0;

        this.player.volume = typeof state.volume === 'number' ? state.volume : this.player.volume;
        this.player.loop = state.loop ?? false;
        this.player.shuffle = state.shuffle ?? false;
        this.player.autoplay = state.autoplay ?? false;
        this.player.requesterId = state.requesterId || this.player.requesterId;

        this.player.previousTracks = (state.previousTracks || [])
            .map(serialized => this.deserializeTrack(serialized))
            .filter(Boolean);

        const restoredQueue = (state.queue || [])
            .map(serialized => this.deserializeTrack(serialized))
            .filter(Boolean);

        this.player.currentTrack = this.deserializeTrack(state.currentTrack) || null;

        if (!this.player.currentTrack && restoredQueue.length > 0) {
            this.player.currentTrack = restoredQueue.shift();
        }
        
        this.player.queue = restoredQueue;

        const validDownloads = new Set();
        const warnings = [];
        for (const file of state.downloadedFiles || []) {
            if (!file) continue;
            try {
                // Resolve relative paths against cacheDir
                const fullPath = path.isAbsolute(file) ? file : path.join(this.cacheDir, file);
                if (fsSync.existsSync(fullPath)) {
                    validDownloads.add(path.resolve(fullPath));
                } else {
                    const msg = `Missing cached file: ${path.basename(file)}`;
                    console.log(`❌ ${msg}`);
                    warnings.push(msg);
                }
            } catch (error) {
                const msg = `Error checking file ${path.basename(file)}: ${error.message}`;
                console.log(`⚠️ ${msg}`);
                warnings.push(msg);
            }
        }
        this.player.downloadedFiles = validDownloads;

        if (state.currentDownloadedFile) {
            const fullPath = path.isAbsolute(state.currentDownloadedFile) ? state.currentDownloadedFile : path.join(this.cacheDir, state.currentDownloadedFile);
            if (fsSync.existsSync(fullPath)) {
                this.player.currentDownloadedFile = path.resolve(fullPath);
            } else {
                this.player.currentDownloadedFile = null;
                warnings.push(`Missing current downloaded file: ${path.basename(state.currentDownloadedFile)}`);
            }
         } else {
            this.player.currentDownloadedFile = null;
         }

        const resumeMsRaw = Number(state.playbackPositionMs) || 0;
        const trackDurationMs = this.player.currentTrack?.duration ? Number(this.player.currentTrack.duration) * 1000 : null;
        let resumeMs = Math.max(0, resumeMsRaw);
        if (trackDurationMs && resumeMs > Math.max(trackDurationMs - 2000, 0)) {
            resumeMs = 0;
        }

        this.player.currentTrackStartOffsetMs = Math.max(Number(state.currentTrackStartOffsetMs) || 0, 0);
        this.player.lastPlaybackPosition = resumeMs;
        this.player.paused = false;

        if (!this.player.connection) {
            try {
                const connected = await this.player.connect();
                if (!connected) {
                    throw new Error('Failed to reconnect to voice channel');
                }
            } catch (error) {
                console.error('❌ Failed to connect during restore:', error);
                return { success: false, error: new Error(`Failed to reconnect to voice channel: ${error.message}`, { cause: error }), warnings };
            }
        }

        if (!this.player.currentTrack) {
            if (this.stateManager) {
                await this.stateManager.removeState(this.player.guild.id);
            }
            return { success: true, warnings, removed: true };
        }

        await this.player.play(null, resumeMs);

        if (this.player.resource?.volume) {
            this.player.resource.volume.setVolume(this.player.volume / 100);
        }

        if (this.embedManager && this.player.textChannel) {
            try {
                const embed = await this.embedManager.createNowPlayingEmbed(this.player, this.player.currentTrack, this.player.guild.id);
                const buttons = await this.embedManager.createControlButtons(this.player);

                let nowPlayingMessage = null;
                if (state.nowPlayingMessageId) {
                    nowPlayingMessage = await this.player.textChannel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
                }

                if (nowPlayingMessage) {
                    await nowPlayingMessage.edit({ embeds: [embed], components: buttons });
                    this.player.nowPlayingMessage = nowPlayingMessage;
                } else {
                    this.player.nowPlayingMessage = await this.player.textChannel.send({ embeds: [embed], components: buttons });
                }
            } catch (error) {
                console.error('❌ Failed to rebuild now playing embed during restore:', error);
                warnings.push(`Failed to rebuild embed: ${error.message}`);
            }
        }

        if (this.languageManager && this.player.textChannel && this.player.currentTrack) {
            try {
                const resumeMessage = await this.languageManager.getTranslation(this.player.guild.id, 'buttonhandler.music_resumed');
                const positionSeconds = Math.floor(resumeMs / 1000);
                const positionFormatted = this.player.formatDuration(positionSeconds);

                await this.player.textChannel.send({
                    content: `▶️ ${resumeMessage} • **${this.player.currentTrack.title || 'Unknown'}** (${positionFormatted})`
                });
            } catch (error) {
                warnings.push(`Failed to send resume message: ${error.message}`);
            }
        }

        this.scheduleStatePersist('restored', 1000);
        return { success: true, warnings };

        } finally {
            this.isRestoring = false;
        }
    }

    async persistState(reason = 'manual', immediate = false) {
        if (this.isRestoring) return { success: false, error: new Error('Cannot persist state while restoring') };

        try {
            if (!this.player.guild?.id) return { success: false, error: new Error('Missing guild ID') };

            // Cancel pending save if this is immediate
            if (immediate && this.pendingStateSave) {
                clearTimeout(this.pendingStateSave);
                this.pendingStateSave = null;
            }

            if (!this.player.currentTrack && this.player.queue.length === 0) {
                if (this.stateManager) await this.stateManager.removeState(this.player.guild.id);
                return { success: true, removed: true };
            }

            const state = this.serializeState();
            if (!state) {
                if (this.stateManager) await this.stateManager.removeState(this.player.guild.id);
                return { success: true, removed: true };
            }

            state.reason = reason;
            if (this.stateManager) await this.stateManager.saveState(this.player.guild.id, state);
            return { success: true };
        } catch (error) {
            console.error(`❌ Failed to persist player state for guild ${this.player.guild?.id}:`, error);
            return { success: false, error };
        }
    }

    startStateSync() {
        if (this.stateSyncInterval) return;

        this.stateSyncInterval = setInterval(() => {
            if (!this.player.guild?.id) return;
            if (!this.player.currentTrack && this.player.queue.length === 0) return;

            this.persistState('interval').catch(() => {});
        }, this.stateSyncIntervalMs);
    }

    stopStateSync() {
        if (this.stateSyncInterval) {
            clearInterval(this.stateSyncInterval);
            this.stateSyncInterval = null;
        }

        this.cancelStateSave();
    }

    cleanup() {
        this.stopStateSync();
    }

    cancelStateSave() {
        if (this.stateSaveTimeout) {
            clearTimeout(this.stateSaveTimeout);
            this.stateSaveTimeout = null;
        }
    }

    scheduleStatePersist(reason = 'update', delay = 200) {
        this.cancelStateSave();
        this.stateSaveTimeout = setTimeout(() => {
            this.stateSaveTimeout = null;
            this.persistState(reason).catch(() => {});
        }, Math.max(delay, 0));
    }
}

module.exports = StatePersistence;
