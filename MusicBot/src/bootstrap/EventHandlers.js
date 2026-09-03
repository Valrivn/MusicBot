const { Events, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const chalk = require('chalk');

function setupEventHandlers(client) {
    // Load external event files
    const loadEvents = () => {
        const eventsPath = path.join(__dirname, '../../events');

        // Create events directory if it doesn't exist
        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(eventsPath, { recursive: true });
            console.log(chalk.cyan(`📁 Created events directory: ${eventsPath}`));
            return;
        }

        let eventFiles;
        try {
            eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
        } catch (error) {
            console.error(chalk.red('❌ Failed to read events directory:'), error.message);
            return;
        }

        if (eventFiles.length === 0) {
            console.log(chalk.yellow('⚠ No event files found in events directory.'));
            return;
        }

        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            try {
                const event = require(filePath);

                if (!event.name || typeof event.execute !== 'function') {
                    console.error(chalk.red(`❌ Invalid event file structure: ${file} (missing name or execute function)`));
                    continue;
                }

                if (event.once) {
                    client.once(event.name, (...args) => event.execute(...args));
                } else {
                    client.on(event.name, (...args) => event.execute(...args));
                }
                console.log(chalk.green(`✓ Loaded event: ${event.name}`));
            } catch (error) {
                console.error(chalk.red(`❌ Failed to load event file: ${file}`), error.message);
            }
        }
    };

    loadEvents();

    // Basic ready event
    client.once(Events.ClientReady, async () => {
        const shardId = client.shard?.ids?.[0] ?? client.shard?.id ?? 0;
        console.log(chalk.green(`✅ [SHARD ${shardId}] ${client.user.tag} is online and ready!`));
        console.log(chalk.cyan(`🎵 [SHARD ${shardId}] Music bot serving ${client.guilds.cache.size} servers on this shard!`));

        // Log total guild count across all shards (only if running with sharding)
        // Wait a bit to ensure all shards are ready before fetching
        if (client.shard) {
            setTimeout(() => {
                client.shard.fetchClientValues('guilds.cache.size')
                    .then(results => {
                        const totalGuilds = results.reduce((acc, guildCount) => acc + guildCount, 0);
                        console.log(chalk.magenta(`🌐 [SHARD ${shardId}] Total servers across all shards: ${totalGuilds}`));
                    })
                    .catch(err => {
                        // Silently fail if shards are still spawning
                        if (!err.message.includes('still being spawned')) {
                            console.error(chalk.red('Error fetching total guild count:'), err);
                        }
                    });
            }, 10000); // Wait 10 seconds for other shards to be ready
        }

        // Set bot activity
        const activityInterval = setInterval(() => client.user.setActivity({ name: `${config.bot.status}`, type: ActivityType.Listening }), 10000);
        client.activityInterval = activityInterval;

        // Don't restore here in sharded mode - wait for shard manager to broadcast
        // For non-sharded mode, guilds should already be cached at ClientReady
        if (!client.shard) {
            console.log(chalk.cyan(`✅ Non-sharded mode: guilds cached (${client.guilds.cache.size} servers)`));
            
            if (typeof client.restoreSessions === 'function') {
                await client.restoreSessions();
            }
        }
    });

    // Cleanup activity interval on client destroy
    client.once(Events.ClientDestroy, () => {
        if (client.activityInterval) {
            clearInterval(client.activityInterval);
            client.activityInterval = null;
        }
    });

    // Discord.js diagnostic events for debugging connection issues
    client.on(Events.Error, (error) => {
        console.error(chalk.red('❌ Discord client error:'), error);
    });

    client.on(Events.Warn, (warning) => {
        console.warn(chalk.yellow('⚠ Discord client warning:'), warning);
    });

    client.on(Events.ShardError, (error, shardId) => {
        console.error(chalk.red(`❌ Shard ${shardId} error:`), error);
    });

    client.on(Events.ShardDisconnect, (event, shardId) => {
        console.error(chalk.red(`❌ Shard ${shardId} disconnected:`), event.code, event.reason);
    });

    client.on(Events.ShardReconnecting, (shardId) => {
        console.log(chalk.yellow(`🔄 Shard ${shardId} reconnecting...`));
    });

    client.on(Events.ShardResume, (shardId, replayedEvents) => {
        console.log(chalk.green(`✅ Shard ${shardId} resumed (${replayedEvents} events replayed)`));
    });

    client.on(Events.Invalidated, () => {
        console.error(chalk.red('❌ Session invalidated - cannot resume, must reconnect'));
    });

    // Handle interactions (slash commands, context menus, autocomplete)
    client.on(Events.InteractionCreate, async interaction => {
        // Handle autocomplete interactions
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (command?.autocomplete) {
                try {
                    await command.autocomplete(interaction, client);
                } catch (error) {
                    console.error(chalk.red(`❌ Autocomplete error for ${interaction.commandName}:`), error);
                }
            }
            return;
        }

        // Handle chat input commands (slash) and context menu commands
        if (!interaction.isCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(chalk.red(`❌ Error executing ${interaction.commandName}:`), error);

            const errorMessage = '❌ An error occurred while executing this command!';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    // Handle voice state updates for pause/resume and cleanup
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        try {
            const guild = oldState.guild ?? newState.guild;
            if (!guild) return;

            const player = client.players.get(guild.id);
            if (!player) return;

            const botMember = guild.members.me ?? guild.members.cache.get(client.user.id);
            const botId = botMember?.id ?? client.user.id;
            const involvesBot = oldState.id === botId || newState.id === botId;

            if (involvesBot) {
                const oldChannelId = oldState.channelId;
                const newChannelId = newState.channelId;

                if (oldChannelId && !newChannelId) {
                    try {
                        // Mark state as ended so UI reflects the change
                        player.pendingEndReason = 'forced-disconnect';
                        player.queue = [];
                        player.currentTrack = null;

                        if (player.ui && typeof player.ui.handlePlaybackEnd === 'function') {
                            await player.ui.handlePlaybackEnd();
                        } else if (typeof player.showQueueCompleted === 'function') {
                            await player.showQueueCompleted();
                        }
                    } catch (error) {
                        console.error('❌ Failed to update playback UI after forced disconnect:', error);
                    } finally {
                        client.players.delete(guild.id);
                        if (typeof player.cleanup === 'function') {
                            player.cleanup();
                        }
                    }
                    return;
                }

                if (newChannelId && oldChannelId !== newChannelId) {
                    if (newState.channel?.id) {
                        if (typeof player.moveToChannel === 'function') {
                            await player.moveToChannel(newState.channel);
                        }
                        if (typeof player.clearInactivityTimer === 'function') {
                            player.clearInactivityTimer(false);
                        }
                        if (player.ui && typeof player.ui.updateNowPlayingEmbed === 'function') {
                            await player.ui.updateNowPlayingEmbed();
                        }
                    }
                }

                const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
                const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;

                if (!wasMuted && isMuted) {
                    if (typeof player.pauseFor === 'function') {
                        const paused = Boolean(player.pauseFor('mute'));
                        if (paused && player.ui && typeof player.ui.updateNowPlayingEmbed === 'function') {
                            await player.ui.updateNowPlayingEmbed();
                        }
                    }
                } else if (wasMuted && !isMuted) {
                    if (typeof player.resumeFor === 'function') {
                        const resumed = Boolean(player.resumeFor('mute'));
                        if (player.ui && typeof player.ui.updateNowPlayingEmbed === 'function' && (resumed || !player.pauseReasons?.has('mute'))) {
                            await player.ui.updateNowPlayingEmbed();
                        }
                    }
                }
            }

            const voiceChannelId = player.voiceChannel?.id;
            if (!voiceChannelId) return;

            if (oldState.channelId === voiceChannelId || newState.channelId === voiceChannelId) {
                const channel = guild.channels.cache.get(voiceChannelId);

                if (!channel) {
                    client.players.delete(guild.id);
                    if (typeof player.cleanup === 'function') {
                        player.cleanup();
                    }
                    return;
                }

                // Get accurate listener count - verify bot is still in channel first
                const botMemberInChannel = channel.members.get(client.user.id);
                if (!botMemberInChannel) {
                    // Bot not in channel member list - state is stale, clean up
                    client.players.delete(guild.id);
                    if (typeof player.cleanup === 'function') {
                        player.cleanup();
                    }
                    return;
                }

                // Count non-bot members in voice channel
                const listeners = channel.members.filter(member => !member.user.bot).size;

                if (listeners === 0) {
                    if (player.pauseReasons?.has('alone')) {
                        const alreadyPaused = true;
                        if (typeof player.startInactivityTimer === 'function') {
                            player.startInactivityTimer();
                        }
                        if (!alreadyPaused && player.ui && typeof player.ui.updateNowPlayingEmbed === 'function' && player.currentTrack) {
                            await player.ui.updateNowPlayingEmbed();
                        }
                    } else {
                        if (typeof player.startInactivityTimer === 'function') {
                            player.startInactivityTimer();
                        }
                        if (player.ui && typeof player.ui.updateNowPlayingEmbed === 'function' && player.currentTrack) {
                            await player.ui.updateNowPlayingEmbed();
                        }
                    }
                } else {
                    const wasPausedForAlone = player.pauseReasons?.has('alone') ?? false;
                    if (typeof player.clearInactivityTimer === 'function') {
                        player.clearInactivityTimer(true);
                    }
                    if (wasPausedForAlone && player.ui && typeof player.ui.updateNowPlayingEmbed === 'function' && player.currentTrack) {
                        await player.ui.updateNowPlayingEmbed();
                    }
                }
            }
        } catch (error) {
            console.error('❌ VoiceStateUpdate handler error:', error);
        }
    });
}

module.exports = { setupEventHandlers };
