const { SlashCommandBuilder } = require('discord.js');
const MusicPlayer = require('../MusicPlayer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube or SoundCloud')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The song name, URL, or playlist link')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query');
        const guildId = interaction.guildId;
        
        let player = interaction.client.players?.get(guildId);
        if (!player) {
            player = new MusicPlayer(interaction.client, guildId);
            interaction.client.players?.set(guildId, player);
        }

        try {
            const track = await player.trackManager.addTrack(query, interaction.user);
            await player.audioEngine.play(track);
            const embed = await player.ui.createNowPlayingEmbed(track);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Playback Router Exception:', error);
            await interaction.editReply({ 
                content: `❌ Failed to resolve audio query: ${error.message}` 
            });
        }
    }
};
