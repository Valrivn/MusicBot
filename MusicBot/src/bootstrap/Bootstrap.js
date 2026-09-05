const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const config = require('../../config');

const { createDiscordClient } = require('./DiscordClient');
const { setupEventHandlers } = require('./EventHandlers');
const { setupProcessHandlers } = require('./ProcessHandlers');
const { startServer } = require('../api/server');

/**
 * Loads command modules from the commands directory into the client's collection.
 */
function loadCommands(client) {
    const commandsPath = path.join(__dirname, '../commands');

    // Create commands directory if it doesn't exist
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
        console.log(chalk.cyan(`📁 Created commands directory: ${commandsPath}`));
        return;
    }

    let commandFiles;
    try {
        commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    } catch (error) {
        console.error(chalk.red('❌ Failed to read commands directory:'), error.message);
        return;
    }

    if (commandFiles.length === 0) {
        console.log(chalk.yellow('⚠ No command files found in commands directory.'));
        return;
    }

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);

            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                console.log(chalk.green(`✓ Loaded command: ${command.data.name}`));
            } else {
                console.log(chalk.yellow(`⚠ Warning: ${file} is missing required "data" or "execute" property.`));
            }
        } catch (error) {
            console.error(chalk.red(`❌ Failed to load command file: ${file}`), error.message);
        }
    }
}

/**
 * Orchestrates the bootstrapping of the entire Discord bot application.
 */
async function startBot() {
    try {
        console.log(chalk.blue('🤖 Starting Discord Music Bot...'));

        // 1. Create the base client with intents and partials
        const client = createDiscordClient();

        // 2. Setup Process Handlers (Crash Prevention & Graceful Shutdown)
        setupProcessHandlers(client, config.sessionRestore.enabled);

        // 3. Setup Discord Event Handlers (Gateway hook)
        setupEventHandlers(client);

        // 4. Load Commands into Collection
        loadCommands(client);

        // 5. Setup API Bridge
        const apiServer = await startServer(client);
        apiServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(chalk.red(`❌ API Bridge port ${process.env.MUSIC_API_PORT || 3002} in use - dashboard features unavailable`));
            }
        });

        // 6. Login to Discord
        await client.login(config.discord.token);

        return client;
    } catch (error) {
        console.error(chalk.red('❌ Failed to start bot:'), error);
        process.exit(1);
    }
}

module.exports = { startBot };
