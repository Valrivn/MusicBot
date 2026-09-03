const {
    VoiceConnectionStatus,
    joinVoiceChannel,
    entersState
} = require('@discordjs/voice');

class VoiceConnectionHandler {
    constructor(player) {
        this.player = player;
        this.connection = null;
        
        // Voice connection recovery system
        this.isRecovering = false;
        this.maxRecoveryAttempts = 5;
        this.recoveryAttempts = 0;
        this.recoveryInterval = null;
        this.connectionHealthCheck = null;
    }

    setupConnectionEvents() {
        if (!this.connection) return;

        this.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
            // Don't trigger recovery if we're already recovering or if user disconnected bot
            if (this.isRecovering || newState.reason === 'Manual disconnect') {
                return;
            }

            // Try to auto-reconnect immediately for network disconnections
            try {
                await entersState(this.connection, VoiceConnectionStatus.Connecting, 5000);
                // If we get here, Discord is trying to reconnect automatically
                await entersState(this.connection, VoiceConnectionStatus.Ready, 10000);

            } catch (error) {
                // Auto-reconnect failed, start our recovery system if music is playing
                if (this.player.currentTrack && !this.player.paused) {
                    this.startConnectionRecovery();
                }
            }
        });

        this.connection.on(VoiceConnectionStatus.Destroyed, () => {
            // Only start recovery if we have music playing and we're not already recovering
            if (this.player.currentTrack && !this.player.paused && !this.isRecovering) {
                this.startConnectionRecovery();
            }
        });

        this.connection.on('error', (error) => {
            console.error('🚨 Voice connection error:', error);
            if (this.player.currentTrack && !this.player.paused) {
                this.startConnectionRecovery();
            }
        });

        // Monitor connection status changes
        this.connection.on('stateChange', (oldState, newState) => {
            if (newState.status === VoiceConnectionStatus.Ready) {
                // Connection recovered successfully
                if (this.isRecovering) {
                    this.stopConnectionRecovery();
                }
                this.recoveryAttempts = 0;
            }
        });
    }

    startConnectionHealthCheck() {
        // Check connection health every 30 seconds
        this.connectionHealthCheck = setInterval(async () => {
            try {
                // Check connection health
                if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
                    if (this.player.currentTrack && !this.player.paused && !this.isRecovering) {
                        this.startConnectionRecovery();
                    }
                }

                // Check if voice channel still exists
                const channel = this.player.guild.channels.cache.get(this.player.voiceChannel.id);
                if (!channel) {
                    this.player.cleanup();
                    return;
                }
            } catch (error) {
                console.error('❌ Health check error:', error);
            }
        }, 30000);
    }

    async startConnectionRecovery() {
        if (this.isRecovering) return;

        this.isRecovering = true;
        this.recoveryAttempts = 0;

        // Save current playback position
        this.player.savePlaybackPosition();

        // Start recovery attempts
        this.recoveryInterval = setInterval(async () => {
            this.recoveryAttempts++;
            if (this.recoveryAttempts > this.maxRecoveryAttempts) {
                this.stopConnectionRecovery();
                return;
            }

            try {
                // Check if voice channel still exists and bot is still in it
                const channel = this.player.guild.channels.cache.get(this.player.voiceChannel.id);
                if (!channel) {
                    this.stopConnectionRecovery();
                    return;
                }

                // Try to reconnect
                const reconnected = await this.forceReconnect();

                if (reconnected) {
                    // Resume playback from where we left off
                    await this.player.resumePlaybackAfterRecovery();
                    this.stopConnectionRecovery();
                }
            } catch (error) {
                console.error(`❌ Recovery attempt ${this.recoveryAttempts} failed:`, error);
            }
        }, 3000); // Try every 3 seconds
    }

    stopConnectionRecovery() {
        if (this.recoveryInterval) {
            clearInterval(this.recoveryInterval);
            this.recoveryInterval = null;
        }
        this.isRecovering = false;
        this.recoveryAttempts = 0;
    }

    async forceReconnect() {
        try {
            // Destroy old connection
            if (this.connection) {
                this.connection.destroy();
            }

            // Create new connection
            this.connection = joinVoiceChannel({
                channelId: this.player.voiceChannel.id,
                guildId: this.player.guild.id,
                adapterCreator: this.player.guild.voiceAdapterCreator,
            });

            // Set up events for new connection
            this.setupConnectionEvents();

            // Subscribe audio player
            this.connection.subscribe(this.player.audioPlayer);

            // Wait for connection to be ready
            await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
            return true;
        } catch (error) {
            console.error('❌ Force reconnect failed:', error);
            return false;
        }
    }

    async connect() {
        try {
            // Wait for guild's WebSocket to be ready (critical for sharding)
            if (!this.player.guild.voiceAdapterCreator) {
                // Wait up to 10 seconds for the adapter to become available
                const maxWait = 10000;
                const startTime = Date.now();
                
                while (!this.player.guild.voiceAdapterCreator && (Date.now() - startTime) < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    // Try to fetch the guild again to refresh its state
                    if (this.player.guild.client) {
                        try {
                            const freshGuild = await this.player.guild.client.guilds.fetch(this.player.guild.id);
                            if (freshGuild && freshGuild.voiceAdapterCreator) {
                                // Update our guild reference
                                Object.assign(this.player.guild, freshGuild);
                                break;
                            }
                        } catch (e) {
                            // Ignore fetch errors
                        }
                    }
                }
                
                if (!this.player.guild.voiceAdapterCreator) {
                    throw new Error('Guild voice adapter not ready after waiting');
                }
            }

            this.connection = joinVoiceChannel({
                channelId: this.player.voiceChannel.id,
                guildId: this.player.guild.id,
                adapterCreator: this.player.guild.voiceAdapterCreator,
            });

            // Set up connection events
            this.setupConnectionEvents();

            this.connection.subscribe(this.player.audioPlayer);

            // Wait for connection to be ready
            await entersState(this.connection, VoiceConnectionStatus.Ready, 30000);
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to voice channel:', error.message);
            throw error; // Re-throw so restoreFromState can handle it
        }
    }

    async moveToChannel(newChannel) {
        if (!newChannel) return false;

        this.player.voiceChannel = newChannel;

        if (this.connection) {
            try {
                this.connection.rejoin({
                    channelId: newChannel.id,
                    selfDeaf: false,
                    selfMute: false
                });

                await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
                return true;
            } catch (error) {
                console.error('❌ Failed to rejoin new voice channel:', error);
                try {
                    this.connection.destroy();
                } catch (destroyError) {
                    console.error('❌ Error destroying old connection:', destroyError);
                }
                this.connection = null;
            }
        }

        return await this.connect();
    }

    disconnect() {
        if (this.connection && this.connection.state && this.connection.state.status !== 'destroyed') {
            try {
                this.connection.destroy();
            } catch (error) {
            }
        }
        this.connection = null;
    }

    cleanup() {
        this.stopConnectionRecovery();

        if (this.connectionHealthCheck) {
            clearInterval(this.connectionHealthCheck);
            this.connectionHealthCheck = null;
        }

        if (this.connection) {
            this.connection.removeAllListeners();
            if (this.connection.state && this.connection.state.status !== 'destroyed') {
                try {
                    this.connection.destroy();
                } catch (error) {
                    console.error('Error destroying connection:', error);
                }
            }
            this.connection = null;
        }
    }
}

module.exports = VoiceConnectionHandler;
