const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config');
const LanguageManager = require('../LanguageManager');

class PlayerUI {
    constructor(player) {
        this.player = player;
    }

    async createNowPlayingEmbed(track) {
        const guildId = this.player.guild.id;
        const nowPlayingTitle = await LanguageManager.getTranslation(guildId, 'commands.play.now_playing');

        const embed = new EmbedBuilder()
            .setTitle(nowPlayingTitle)
            .setDescription(`**[${track.title}](${track.url})**`)
            .setColor(config.bot.embedColor)
            .setTimestamp();

        // Artist
        if (track.artist) {
            const artistLabel = await LanguageManager.getTranslation(guildId, 'commands.play.artist');
            embed.addFields({
                name: artistLabel,
                value: track.artist,
                inline: true
            });
        }

        // Duration
        if (track.duration) {
            const durationLabel = await LanguageManager.getTranslation(guildId, 'commands.play.duration');
            embed.addFields({
                name: durationLabel,
                value: this.formatDuration(track.duration),
                inline: true
            });
        }

        // Platform
        if (track.platform) {
            const platformLabel = await LanguageManager.getTranslation(guildId, 'commands.play.platform');
            embed.addFields({
                name: platformLabel,
                value: this.getPlatformEmoji(track.platform) + ' ' +
                    track.platform.charAt(0).toUpperCase() + track.platform.slice(1),
                inline: true
            });
        }

        // Progress bar
        if (track.duration && this.player.getCurrentTime) {
            const currentTime = this.player.getCurrentTime() || 0;
            const progressBar = this.createProgressBar(currentTime, track.duration);
            const progressLabel = await LanguageManager.getTranslation(guildId, 'commands.nowplaying.progress');
            embed.addFields({
                name: progressLabel,
                value: progressBar,
                inline: false
            });
        }

        // Status
        const statusLabel = await LanguageManager.getTranslation(guildId, 'commands.nowplaying.status');
        const statusKey = this.player.paused
            ? 'commands.nowplaying.status_paused'
            : 'commands.nowplaying.status_playing';
        let statusValue = await LanguageManager.getTranslation(guildId, statusKey);

        if (this.player.pauseReasons && this.player.pauseReasons.has('mute')) {
            statusValue += ' 🔇';
        } else if (this.player.pauseReasons && this.player.pauseReasons.has('alone')) {
            statusValue += ' ⏳';
        }

        embed.addFields({
            name: statusLabel,
            value: statusValue,
            inline: true
        });

        // Thumbnail
        if (track.thumbnail) {
            embed.setThumbnail(track.thumbnail);
        }

        // Permission info and Queue info in footer
        const footerParts = [];
        
        // Add permission info
        const permissionInfo = await LanguageManager.getTranslation(guildId, 'musicmanager.control_permission_info');
        footerParts.push(permissionInfo);
        
        // Add queue info if available
        if (this.player.queue.length > 0) {
            const queueInfo = await LanguageManager.getTranslation(guildId, 'commands.play.more_songs_in_queue', { count: this.player.queue.length });
            footerParts.push(queueInfo);
        }
        
        if (footerParts.length > 0) {
            embed.setFooter({ text: footerParts.join(' • ') });
        }

        return embed;
    }

    async createNewMusicEmbed(track, member, interaction = null) {
        const embed = await this.createNowPlayingEmbed(track);
        const buttons = await this.createControlButtons();

        let message;
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                message = await interaction.editReply({ content: null, embeds: [embed], components: buttons });
            } else {
                message = await interaction.reply({ embeds: [embed], components: buttons });
            }
        } else {
            message = await this.player.textChannel.send({ embeds: [embed], components: buttons });
        }

        this.player.nowPlayingMessage = message;
        this.player.requesterId = member.id;

        return { success: true, message: 'Now playing', isNewEmbed: true };
    }

    async updateNowPlayingEmbed() {
        if (!this.player.nowPlayingMessage || !this.player.currentTrack) return;

        try {
            const embed = await this.createNowPlayingEmbed(this.player.currentTrack);
            const buttons = await this.createControlButtons();

            await this.player.nowPlayingMessage.edit({
                embeds: [embed],
                components: buttons
            });
        } catch (error) {
            console.error('Error updating now playing embed:', error);
        }
    }

    async handlePlaybackEnd() {
        if (this.player.nowPlayingMessage) {
            try {
                const disabledButtons = await this.createControlButtons(true);
                await this.player.nowPlayingMessage.edit({
                    components: disabledButtons
                });
            } catch (error) {
                console.error('Error disabling buttons:', error);
            }
        }
    }

    async showPlaylistAdditionMessage(tracks, member, interaction, isPlaylist) {
        const remainingTracks = tracks.slice(1);
        const messageText = await this.createQueueAdditionMessage(remainingTracks, isPlaylist);

        let infoMessage;
        try {
            infoMessage = await this.player.textChannel.send({ content: messageText });
            setTimeout(async () => {
                try { await infoMessage.delete(); } catch (error) {}
            }, 10000);
        } catch (error) {
            console.error('Error sending playlist addition message:', error);
        }
    }

    async handleQueueAddition(tracks, member, interaction, isPlaylist) {
        if (this.player.nowPlayingMessage && this.player.currentTrack) {
            await this.updateNowPlayingEmbed();
        }

        const messageText = await this.createQueueAdditionMessage(tracks, isPlaylist);

        let infoMessage;
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                infoMessage = await interaction.editReply({ content: messageText, embeds: [], components: [] });
            } else {
                infoMessage = await interaction.reply({ content: messageText, flags: [1 << 6] });
            }
        } else {
            infoMessage = await this.player.textChannel.send({ content: messageText });
        }

        setTimeout(async () => {
            try { await infoMessage.delete(); } catch (error) {}
        }, 10000);

        return { success: true, message: 'Added to queue', isNewEmbed: false };
    }

    async createControlButtons(disabled = false) {
        const guildId = this.player.guild.id;
        const sessionId = this.player.sessionId;
        const requesterId = this.player.requesterId;

        // Button labels
        const pauseLabel = this.player.paused ?
            await LanguageManager.getTranslation(guildId, 'buttons.resume') :
            await LanguageManager.getTranslation(guildId, 'buttons.pause');

        const previousLabel = await LanguageManager.getTranslation(guildId, 'buttons.previous');
        const skipLabel = await LanguageManager.getTranslation(guildId, 'buttons.skip');
        const stopLabel = await LanguageManager.getTranslation(guildId, 'buttons.stop');
        const queueLabel = await LanguageManager.getTranslation(guildId, 'buttons.queue');
        const shuffleLabel = await LanguageManager.getTranslation(guildId, 'buttons.shuffle');

        const previousButton = new ButtonBuilder()
            .setCustomId(`music_previous:${requesterId}:${sessionId}`)
            .setLabel(previousLabel)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏮️')
            .setDisabled(disabled || this.player.previousTracks.length === 0);

        const pauseButton = new ButtonBuilder()
            .setCustomId(`music_pause:${requesterId}:${sessionId}`)
            .setLabel(pauseLabel)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(this.player.paused ? '▶️' : '⏸️')
            .setDisabled(disabled);

        const skipButton = new ButtonBuilder()
            .setCustomId(`music_skip:${requesterId}:${sessionId}`)
            .setLabel(skipLabel)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️')
            .setDisabled(disabled || this.player.queue.length === 0);

        const stopButton = new ButtonBuilder()
            .setCustomId(`music_stop:${requesterId}:${sessionId}`)
            .setLabel(stopLabel)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️')
            .setDisabled(disabled);

        const queueButton = new ButtonBuilder()
            .setCustomId(`music_queue:${requesterId}:${sessionId}`)
            .setLabel(queueLabel)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋')
            .setDisabled(false);

        const shuffleButton = new ButtonBuilder()
            .setCustomId(`music_shuffle:${requesterId}:${sessionId}`)
            .setLabel(shuffleLabel)
            .setStyle(this.player.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔀')
            .setDisabled(disabled);

        const volumeLabel = await LanguageManager.getTranslation(guildId, 'buttons.volume');
        const volumeButton = new ButtonBuilder()
            .setCustomId(`music_volume:${requesterId}:${sessionId}`)
            .setLabel(volumeLabel)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔊')
            .setDisabled(disabled);

        // Loop button - cycles through off -> track -> queue
        let loopLabel, loopEmoji, loopStyle;
        if (this.player.loop === 'track') {
            loopLabel = await LanguageManager.getTranslation(guildId, 'buttons.loop_track');
            loopEmoji = '🔂';
            loopStyle = ButtonStyle.Success;
        } else if (this.player.loop === 'queue') {
            loopLabel = await LanguageManager.getTranslation(guildId, 'buttons.loop_queue');
            loopEmoji = '🔁';
            loopStyle = ButtonStyle.Success;
        } else {
            loopLabel = await LanguageManager.getTranslation(guildId, 'buttons.loop_off');
            loopEmoji = '➡️';
            loopStyle = ButtonStyle.Secondary;
        }

        const loopButton = new ButtonBuilder()
            .setCustomId(`music_loop:${requesterId}:${sessionId}`)
            .setLabel(loopLabel)
            .setStyle(loopStyle)
            .setEmoji(loopEmoji)
            .setDisabled(disabled);

        // Autoplay button
        let autoplayLabel, autoplayEmoji, autoplayStyle;
        if (this.player.autoplay) {
            autoplayLabel = await LanguageManager.getTranslation(guildId, 'buttons.autoplay_on');
            autoplayEmoji = '🎲';
            autoplayStyle = ButtonStyle.Success;
        } else {
            autoplayLabel = await LanguageManager.getTranslation(guildId, 'buttons.autoplay_off');
            autoplayEmoji = '🎲';
            autoplayStyle = ButtonStyle.Secondary;
        }

        const autoplayButton = new ButtonBuilder()
            .setCustomId(`music_autoplay:${requesterId}:${sessionId}`)
            .setLabel(autoplayLabel)
            .setStyle(autoplayStyle)
            .setEmoji(autoplayEmoji)
            .setDisabled(disabled);

        // Lyrics button (only show if lyrics available)
        const lyricsLabel = await LanguageManager.getTranslation(guildId, 'buttons.lyrics') || 'Lyrics';
        const lyricsButton = new ButtonBuilder()
            .setCustomId(`music_lyrics:${requesterId}:${sessionId}`)
            .setLabel(lyricsLabel)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎤')
            .setDisabled(disabled || !this.player.hasLyrics());

        // Seek buttons
        const seekBackButton = new ButtonBuilder()
            .setCustomId(`music_seek_back:${requesterId}:${sessionId}`)
            .setLabel(await LanguageManager.getTranslation(guildId, 'buttons.seek_back'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏪')
            .setDisabled(disabled);

        const seekForwardButton = new ButtonBuilder()
            .setCustomId(`music_seek_forward:${requesterId}:${sessionId}`)
            .setLabel(await LanguageManager.getTranslation(guildId, 'buttons.seek_forward'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏩')
            .setDisabled(disabled);

        const row = new ActionRowBuilder()
            .addComponents(previousButton, pauseButton, skipButton, stopButton, queueButton, shuffleButton);

        const row2 = new ActionRowBuilder()
            .addComponents(volumeButton, loopButton, autoplayButton, lyricsButton);

        const row3 = new ActionRowBuilder()
            .addComponents(seekBackButton, seekForwardButton);

        return [row, row2, row3];
    }

    async createQueueAdditionMessage(tracks, isPlaylist) {
        const guildId = this.player.guild.id;
        if (isPlaylist) {
            return await LanguageManager.getTranslation(guildId, 'musicmanager.playlist_added_to_queue', {
                count: tracks.length
            });
        } else {
            const track = tracks[0];
            const title = track?.title || 'Unknown Track';
            return await LanguageManager.getTranslation(guildId, 'musicmanager.track_added_to_queue', {
                title: title
            });
        }
    }

    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';

        const totalSeconds = Math.floor(Number(seconds) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    createProgressBar(current, total) {
        if (!total || total === 0) return '0:00 / 0:00';

        const currentSeconds = Math.floor(current / 1000);
        const totalSeconds = Math.floor(total);
        const progress = Math.floor((currentSeconds / totalSeconds) * 20);

        const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

        return `${this.formatTime(currentSeconds)} [${bar}] ${this.formatTime(totalSeconds)}`;
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    getPlatformEmoji(platform) {
        const emojis = {
            youtube: '🔴',
            soundcloud: '🟠',
            direct: '🔗'
        };
        return emojis[platform] || '🎵';
    }
}

module.exports = PlayerUI;
