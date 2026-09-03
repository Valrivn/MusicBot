const { Client, GatewayIntentBits, Collection, Partials, Options } = require('discord.js');
const { restoreSessions } = require('./SessionRestore');

/**
 * Creates and configures the Discord Client instance.
 * Sharding is supported automatically as ShardingManager injects the appropriate environment variables
 * (SHARD_IDS, SHARD_COUNT) which are automatically detected by the discord.js Client constructor.
 * 
 * @returns {Client} The configured Discord client
 */
function createDiscordClient() {
    try {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers,
            ],
            // Partials configuration for handling uncached structures (e.g. messages/reactions)
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction,
            ],
            // Memory optimization via custom cache configuration and sweepers
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
                MessageManager: 50, // Limit cached messages to prevent memory leaks
                StageInstanceManager: 0,
                PresenceManager: 0,
            }),
            sweepers: {
                ...Options.DefaultSweeperSettings,
                messages: {
                    interval: 3600, // Sweep messages every hour
                    lifetime: 1800, // Keep messages for up to 30 minutes
                },
            },
        });

        // Collections for commands and music players
        client.commands = new Collection();
        client.players = new Collection();

        // Attach restore sessions function to the client for ShardingManager compatibility
        // (Allows shard manager to invoke it via broadcastEval)
        // Use regular function so `this` is properly bound when called via broadcastEval
        client.restoreSessions = function() {
            return restoreSessions(this);
        };

        return client;
    } catch (error) {
        console.error('❌ Failed to initialize Discord client:', error);
        throw error;
    }
}

module.exports = { createDiscordClient };
