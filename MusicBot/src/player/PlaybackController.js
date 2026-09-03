const { AudioPlayerStatus } = require('@discordjs/voice');
const PlayerStateManager = require('../PlayerStateManager');
const DownloadManager = require('./DownloadManager');

class PlaybackController {
    /**
     * Pauses the audio engine manually.
     */
    static pause(engine) {
        return this.pauseFor(engine, 'manual');
    }

    /**
     * Resumes the audio engine manually.
     */
    static resume(engine, reason = 'manual') {
        return this.resumeFor(engine, reason);
    }

    /**
     * Pauses the audio engine for a specific reason.
     */
    static pauseFor(engine, reason = null) {
        if (reason) {
            engine.pauseReasons.add(reason);
            engine.player.scheduleStatePersist('pause-update', 200);
        }

        const status = engine.audioPlayer.state.status;
        if (status === AudioPlayerStatus.Paused) {
            engine.paused = true;
            engine.player.scheduleStatePersist('pause', 0);
            return true;
        }

        if (status === AudioPlayerStatus.Playing) {
            const paused = engine.audioPlayer.pause();
            if (paused) {
                engine.paused = true;
                engine.player.scheduleStatePersist('pause', 0);
                return true;
            }
        }
        return false;
    }

    /**
     * Resumes the audio engine if the specified reason is cleared.
     */
    static resumeFor(engine, reason = null) {
        if (reason) {
            engine.pauseReasons.delete(reason);
            engine.player.scheduleStatePersist('resume-update', 200);
        }

        if (engine.pauseReasons.size > 0) {
            return false;
        }

        const status = engine.audioPlayer.state.status;
        if (status === AudioPlayerStatus.Paused) {
            const resumed = engine.audioPlayer.unpause();
            if (resumed) {
                engine.paused = false;
                engine.player.scheduleStatePersist('resume', 0);
                return true;
            }
            return false;
        }

        if (status === AudioPlayerStatus.Playing) {
            engine.paused = false;
            engine.player.scheduleStatePersist('resume', 0);
            return true;
        }
        return false;
    }

    /**
     * Completely stops playback and tears down current stream caches.
     */
    static stop(engine) {
        engine.clearInactivityTimer(false);
        engine.pauseReasons.clear();
        engine.paused = false;

        engine.player.stopStateSync();
        if (engine.player.guild?.id) {
            PlayerStateManager.removeState(engine.player.guild.id).catch(() => {});
        }

        if (engine.trackTimer) {
            clearTimeout(engine.trackTimer);
            engine.trackTimer = null;
        }

        if (engine.currentDownloadedFile) {
            DownloadManager.deleteDownloadedFile(engine.currentDownloadedFile, engine.player);
            engine.currentDownloadedFile = null;
        }

        for (const filepath of DownloadManager.downloadedFiles) {
            DownloadManager.deleteDownloadedFile(filepath, engine.player);
        }
        DownloadManager.downloadedFiles.clear();

        engine.player.queue = [];
        engine.player.currentTrack = null;
        engine.pendingEndReason = 'stop';
        engine.stopRequested = true;
        engine.currentTrackStartOffsetMs = 0;
        engine.lastPlaybackPosition = 0;
        engine.audioPlayer.stop(true);
        engine.player.disconnect();
    }

    /**
     * Skips the current track, forcing the AudioPlayer to transition.
     */
    static skip(engine) {
        if (engine.player.currentTrack) {
            if (engine.trackTimer) {
                clearTimeout(engine.trackTimer);
                engine.trackTimer = null;
            }

            engine.pendingEndReason = 'skip';
            engine.skipRequested = true;
            engine.audioPlayer.stop(true);
            engine.player.scheduleStatePersist('skip', 0);
            return true;
        }
        return false;
    }

    /**
     * Rewinds to the previous track and plays it.
     */
    static previous(engine) {
        if (engine.player.previousTracks.length > 0) {
            if (engine.trackTimer) {
                clearTimeout(engine.trackTimer);
                engine.trackTimer = null;
            }

            if (engine.player.currentTrack) {
                engine.player.queue.unshift(engine.player.currentTrack);
            }
            engine.player.currentTrack = engine.player.previousTracks.pop();

            engine.pendingEndReason = 'previous';
            engine.skipRequested = true;
            engine.audioPlayer.stop(true);
            engine.player.scheduleStatePersist('previous', 0);
            return true;
        }
        return false;
    }

    /**
     * Seeks to a specific position in the current track.
     * @param {AudioEngineCore} engine - The audio engine instance
     * @param {number} positionMs - Position in milliseconds to seek to
     * @returns {Promise<{success: boolean, positionMs: number}>}
     */
    static async seek(engine, positionMs) {
        if (!engine.player.currentTrack) {
            return { success: false, positionMs: 0 };
        }

        const durationMs = Number(engine.player.currentTrack.duration) * 1000 || 0;
        if (durationMs > 0 && (positionMs < 0 || positionMs > durationMs)) {
            return { success: false, positionMs: engine.getCurrentTime() };
        }

        if (engine.activeStreamInfo && !engine.activeStreamInfo.resumeSupported) {
            return { success: false, positionMs: engine.getCurrentTime() };
        }

        const wasPlaying = engine.audioPlayer.state.status === AudioPlayerStatus.Playing;
        
        engine.currentTrackStartOffsetMs = positionMs;
        engine.lastPlaybackPosition = positionMs;
        engine.pausedTime = 0;
        engine.startTime = null;

        if (wasPlaying) {
            engine.audioPlayer.stop(true);
            await engine.play(null, positionMs);
        }

        engine.player.scheduleStatePersist('seek', 0);
        return { success: true, positionMs };
    }

    /**
     * Handles the complex lifecycle of a track ending (natural or skipped).
     */
    static async handleTrackEnd(engine, reason = 'idle') {
        if (engine.isTransitioning) {
            return;
        }
        engine.isTransitioning = true;

        try {
            if (engine.trackTimer) {
                clearTimeout(engine.trackTimer);
                engine.trackTimer = null;
            }

            const finishedTrack = engine.player.currentTrack;
            const playbackMs = engine.resource?.playbackDuration || 0;
            const totalPlaybackMs = engine.currentTrackStartOffsetMs + playbackMs;
            engine.lastPlaybackPosition = totalPlaybackMs;
            const durationMs = finishedTrack && Number(finishedTrack.duration) > 0 ? Number(finishedTrack.duration) * 1000 : 0;
            const manualSkip = reason === 'skip' || reason === 'stop' || reason === 'previous';

            if (reason === 'previous') {
                engine.resource = null;
                engine.expectedTrackEndTs = null;
                engine.startTime = null;
                engine.pausedTime = 0;
                engine.lastPlaybackPosition = 0;
                engine.currentTrackStartOffsetMs = 0;
                engine.currentTrackCache = null;
                engine.currentTrackRetries = 0;

                if (engine.player.currentTrack) {
                    await engine.play(null, 0);

                    if (engine.player.ui) {
                        await engine.player.ui.updateNowPlayingEmbed();
                    }
                }
                return;
            }

            const endedUnexpectedly = Boolean(finishedTrack) && !manualSkip && durationMs > 0 && totalPlaybackMs + 1500 < durationMs;

            if (endedUnexpectedly) {
                engine.currentTrackRetries += 1;
                if (engine.currentTrackRetries <= 2) {
                    await engine.play(null, totalPlaybackMs);
                    return;
                }
            } else {
                engine.currentTrackRetries = 0;
            }

            if (!finishedTrack) {
                engine.resource = null;
                return;
            }

            engine.player.previousTracks.push(finishedTrack);

            if (engine.player.loop !== 'track' && engine.currentDownloadedFile) {
                await DownloadManager.deleteDownloadedFile(engine.currentDownloadedFile, engine.player);
                engine.currentDownloadedFile = null;
            }

            if (engine.player.loop === 'track') {
                await engine.play(null, 0);
                return;
            }

            if (engine.player.loop === 'queue') {
                engine.player.queue.push(finishedTrack);
            }

            engine.resource = null;
            engine.expectedTrackEndTs = null;
            engine.startTime = null;
            engine.pausedTime = 0;
            engine.lastPlaybackPosition = 0;
            engine.currentTrackStartOffsetMs = 0;
            engine.currentTrackCache = null;

            if (engine.player.queue.length > 0) {
                if (engine.player.shuffle) {
                    const randomIndex = Math.floor(Math.random() * engine.player.queue.length);
                    engine.player.currentTrack = engine.player.queue.splice(randomIndex, 1)[0];
                } else {
                    engine.player.currentTrack = engine.player.queue.shift();
                }

                await engine.play(null, 0);

                if (engine.player.ui) {
                    await engine.player.ui.updateNowPlayingEmbed();
                }
                return;
            }

            if (engine.player.autoplay) {
                engine.currentTrackRetries = 0;
                await engine.handleAutoplay();
                return;
            }

            engine.player.currentTrack = null;
            engine.currentTrackCache = null;
            engine.currentTrackStartOffsetMs = 0;

            if (engine.player.ui) {
                await engine.player.ui.handlePlaybackEnd();
            } else {
                await engine.player.showQueueCompleted();
            }

            engine.clearInactivityTimer(false);
            if (engine.player.guild?.id) {
                await PlayerStateManager.removeState(engine.player.guild.id);
            }

            setTimeout(() => {
                if (engine.player.queue.length === 0 && !engine.player.currentTrack) {
                    engine.player.cleanup();
                    const clientInstance = engine.player.guild?.client;
                    if (clientInstance?.players) {
                        clientInstance.players.delete(engine.player.guild.id);
                    }
                }
            }, 10000);
        } finally {
            engine.isTransitioning = false;
            engine.skipRequested = false;
            engine.stopRequested = false;
            engine.pendingEndReason = null;
        }
    }
}

module.exports = PlaybackController;
