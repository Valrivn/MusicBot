const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ]
});

client.once('ready', async () => {
    console.log('Bot ready to find user...');
    for (const guild of client.guilds.cache.values()) {
        console.log(`Checking guild: ${guild.name}`);
        const members = await guild.members.fetch();
        for (const member of members.values()) {
            if (member.voice.channel) {
                console.log(`FOUND: ${member.user.tag} (${member.user.id}) in channel: ${member.voice.channel.name}`);
            }
        }
    }
    process.exit(0);
});

client.login(config.discord.token);
