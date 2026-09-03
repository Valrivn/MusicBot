const chalk = require('chalk');
const { restoreSavedPlayers, cleanupAudioCache, isSessionRestoreEnabled } = require('../SessionManager');

/**
 * Restores saved sessions and cleans up the audio cache
 * @param {Client} client 
 */
async function restoreSessions(client) {
    if (!isSessionRestoreEnabled()) {
        console.log(chalk.yellow(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ⏭ Session restore disabled, skipping...`));
        await cleanupAudioCache();
        return;
    }
    console.log(chalk.cyan(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] 🔄 Starting session restore...`));
    try {
        await restoreSavedPlayers(client);
        await cleanupAudioCache();
        console.log(chalk.green(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ✅ Session restore complete`));
    } catch (error) {
        console.error(chalk.red(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ❌ Session restore failed:`), error);
    }
}

module.exports = { restoreSessions };
