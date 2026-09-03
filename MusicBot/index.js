// Ensure commands are loaded and deployed
require("./src/commandLoader");

const { startBot } = require('./src/bootstrap/Bootstrap');

// Wait 5 seconds before starting the bot to allow for session state restoration checks
setTimeout(() => {
    startBot().then(client => {
        module.exports = client;
    }).catch(error => {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    });
}, 5000);
