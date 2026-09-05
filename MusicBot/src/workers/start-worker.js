require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const path = require('path');
const chalk = require('chalk');
const { karaokeQueue } = require('./queue/karaoke-queue');
require('./karaoke-worker');

console.log(chalk.blue('🎤 Starting Karaoke Worker Process...'));
console.log(chalk.gray(`📡 Connecting to Redis at ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`));

karaokeQueue.on('ready', () => {
    console.log(chalk.green('✅ Karaoke worker connected to queue and ready'));
});

karaokeQueue.on('error', (err) => {
    console.error(chalk.red('❌ Karaoke queue error:'), err.message);
});

process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n🛑 Shutting down karaoke worker...'));
    await karaokeQueue.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(chalk.yellow('\n🛑 Shutting down karaoke worker...'));
    await karaokeQueue.close();
    process.exit(0);
});