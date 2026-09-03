const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const config = require('../config');
const PlayerStateManager = require('./PlayerStateManager');
const MusicPlayer = require('./MusicPlayer');

/**
 * Checks if the session restore feature is enabled.
 * @returns {boolean}
 */
function isSessionRestoreEnabled() {
    return config.sessionRestore?.enabled !== false;
}

/**
 * Clean up audio cache directory on startup.
 */
async function cleanupAudioCache() {
    const cacheDir = path.join(__dirname, '..', 'audio_cache');

    try {
        if (fs.existsSync(cacheDir)) {
            const files = await fsPromises.readdir(cacheDir);
            const protectedFiles = PlayerStateManager.getProtectedCacheFiles();

            let deletedCount = 0;
            let skippedCount = 0;

            for (const file of files) {
                const absolutePath = path.join(cacheDir, file);

                if (protectedFiles.has(path.resolve(absolutePath))) {
                    skippedCount++;
                    continue;
                }

                try {
                    const stat = await fsPromises.stat(absolutePath);
                    if (stat.isFile()) {
                        await fsPromises.unlink(absolutePath);
                        deletedCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (err) {
                    console.error(chalk.red(`❌ Failed to delete ${file}:`), err.message);
                }
            }
        } else {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
    } catch (error) {
        console.error(chalk.red('❌ Failed to cleanup audio cache:'), error.message);
    }
}

/**
 * Restores saved players' states for all guilds.
 * @param {Client} client 
 */
async function restoreSavedPlayers(client) {
    const savedStates = PlayerStateManager.getAllStates();
    const entries = Object.entries(savedStates || {});
    if (entries.length === 0) return;

    console.log(chalk.cyan(`🔄 Found ${entries.length} saved session(s) to restore...`));

    for (const [guildId, state] of entries) {
        try {
            // Wait for guild to be available in cache
            let guild = client.guilds.cache.get(guildId);

            if (!guild) {
                // Try fetching with retry logic for sharding
                let retries = 3;
                while (!guild && retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                        guild = await client.guilds.fetch(guildId).catch(() => null);
                        if (guild) break;
                    } catch (error) {
                        retries--;
                    }
                }
            }

            if (!guild) {
                console.log(chalk.yellow(`⚠️ Guild ${guildId} not found or not accessible, removing state...`));
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const voiceChannelId = state.voiceChannelId;
            const textChannelId = state.textChannelId;

            if (!voiceChannelId || !textChannelId) {
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            let voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
            if (!voiceChannel) {
                voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
            }

            let textChannel = guild.channels.cache.get(textChannelId) || null;
            if (!textChannel) {
                textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
            }

            const isVoiceValid = voiceChannel && typeof voiceChannel.isVoiceBased === 'function' && voiceChannel.isVoiceBased();
            const isTextValid = textChannel && typeof textChannel.isTextBased === 'function' && textChannel.isTextBased();

            if (!isVoiceValid || !isTextValid) {
                console.log(chalk.yellow(`⚠️ Invalid channels for guild ${guild.name}, removing state...`));
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const player = new MusicPlayer(guild, textChannel, voiceChannel);
            client.players.set(guildId, player);

            try {
                await player.restoreFromState(state);
                console.log(chalk.green(`✅ Successfully restored session for guild ${guild.name}`));
            } catch (error) {
                console.error(chalk.red(`❌ Failed to restore music session for guild ${guild.name} (${guildId}):`), error.message);
                client.players.delete(guildId);
                player.cleanup();
                await PlayerStateManager.removeState(guildId);
            }
        } catch (error) {
            console.error(chalk.red(`❌ Error during session restoration for guild ${guildId}:`), error.message);
            await PlayerStateManager.removeState(guildId);
        }
    }
}

module.exports = {
    cleanupAudioCache,
    restoreSavedPlayers,
    isSessionRestoreEnabled
};
