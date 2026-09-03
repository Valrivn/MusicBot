const chalk = require('chalk');
const { getVoiceConnection } = require('@discordjs/voice');

function setupProcessHandlers(client, sessionRestoreEnabled = true) {
    let readlineInterface = null;

    // Process error handling
    process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

        // Discord API error handling
        if (reason && reason.code) {
            switch (reason.code) {
                case 10062: // Unknown interaction
                    console.log(chalk.yellow('ℹ️ Interaction has expired, safely ignoring...'));
                    return;
                case 40060: // Interaction already acknowledged
                    console.log(chalk.yellow('ℹ️ Interaction already acknowledged, safely ignoring...'));
                    return;
                case 50013: // Missing permissions
                    console.error(chalk.red('❌ Missing permissions for Discord action'));
                    return;
            }
        }

        // Voice connection errors
        if (reason && reason.message && reason.message.includes('IP discovery')) {
            // Clean up any voice connections
            if (client && client.players) {
                client.players.forEach(player => {
                    if (player && player.cleanup) {
                        player.cleanup();
                    }
                });
                client.players.clear();
            }
            return;
        }

        // Log warning for unhandled rejection cases
        console.warn(chalk.yellow('⚠️ Unhandled rejection not caught by specific handlers - reason:'), reason);
    });

    process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught Exception:'), error);

        // Don't exit on Discord API errors
        if (error.code === 10062 || error.code === 40060) {
            console.log(chalk.yellow('ℹ️ Discord interaction error handled, continuing...'));
            return;
        }

        // Handle fetch/network termination errors - don't crash
        if (error.message && (error.message.includes('terminated') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT'))) {
            console.log(chalk.yellow('⚠️ Network error occurred, but bot continues running...'));
            return;
        }

        // For other critical errors, graceful shutdown
        console.log(chalk.red('🛑 Critical error occurred, shutting down...'));

        // Clean up all music players
        if (client && client.players) {
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
        }

        process.exit(1);
    });

    // Graceful shutdown handler
    const gracefulShutdown = async (signal) => {
        console.log(chalk.yellow(`\nReceived ${signal}. Starting graceful shutdown...`));
        
        // Save all active player states before shutdown
        const savePromises = [];
        if (client && client.players) {
            for (const [guildId, player] of client.players) {
                if (player && typeof player.persistState === 'function') {
                    if (sessionRestoreEnabled) {
                        // Use immediate=true to bypass debouncing
                        savePromises.push(player.persistState('shutdown', true).catch(err => {
                            console.error(chalk.red(`Failed to save state for guild ${guildId}:`), err);
                        }));
                    }
                }
            }
        }

        await Promise.all(savePromises);

        // Disconnect from all voice channels
        if (client && client.players) {
            client.players.forEach((player, guildId) => {
                if (typeof player.stop === 'function') player.stop();
                try {
                    const connection = getVoiceConnection(guildId);
                    if (connection) connection.destroy();
                } catch (e) {
                    // Ignore errors during destroy
                }
            });
        }

        if (client && typeof client.destroy === 'function') {
            client.destroy();
        }

        if (client && client.activityInterval) {
            clearInterval(client.activityInterval);
            client.activityInterval = null;
        }

        if (readlineInterface) {
            readlineInterface.close();
        }
        
        console.log(chalk.green('Bot shutdown completed safely.'));
        process.exit(0);
    };

    // Remove existing generic error handlers if they were attached globally elsewhere
    // Although typically we wouldn't need to do this if we run this first.

    // Register shutdown handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    if (process.platform !== 'win32') {
        process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
    }

    // Windows specific handlers
    if (process.platform === 'win32') {
        const readline = require('readline');
        if (process.stdin.isTTY) {
            readlineInterface = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            readlineInterface.on('SIGINT', () => gracefulShutdown('SIGINT'));
        }
    }
}

module.exports = { setupProcessHandlers };
