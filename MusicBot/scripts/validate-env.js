#!/usr/bin/env node
/**
 * Environment Validation Script for Voxaria MusicBot
 * Validates all required environment variables and connectivity
 * Run with: node scripts/validate-env.js
 */

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const { REST, Routes } = require('discord-api-types/v10');

const ROOT_DIR = path.resolve(__dirname, '..');

// Load environment variables
function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found at:', envPath);
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envVars = {};

  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  // Set process.env for validation
  Object.entries(envVars).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });

  return envVars;
}

// Required environment variables
const REQUIRED_VARS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_OWNER_ID',
  'PORT',
  'NODE_ENV',
  'FRONTEND_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'DATABASE_PATH',
  'JWT_PRIVATE_KEY_PATH',
  'JWT_PUBLIC_KEY_PATH',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'GENIUS_CLIENT_ID',
  'GENIUS_CLIENT_SECRET',
  'LOG_LEVEL',
  'DEMUCS_MODEL',
  'KARAOKE_CONCURRENCY',
];

// Optional but recommended variables
const RECOMMENDED_VARS = [
  'YOUTUBE_API_KEY',
  'INVIDIOUS_INSTANCES',
  'PIPED_INSTANCES',
  'COOKIES_FILE',
  'SUPPORT_SERVER',
  'WEBSITE',
  'STATUS',
];

function validateEnvVars(envVars) {
  console.log('\n🔍 Validating Environment Variables...\n');

  let hasErrors = false;
  let hasWarnings = false;

  // Check required variables
  for (const varName of REQUIRED_VARS) {
    const value = envVars[varName] || process.env[varName];
    if (!value || value.includes('your_') || value === 'auto') {
      console.error(`❌ MISSING/INVALID: ${varName}`);
      hasErrors = true;
    } else {
      console.log(`✅ ${varName}`);
    }
  }

  // Check recommended variables
  for (const varName of RECOMMENDED_VARS) {
    const value = envVars[varName] || process.env[varName];
    if (!value || value.includes('your_')) {
      console.warn(`⚠️  RECOMMENDED: ${varName} (not set or placeholder)`);
      hasWarnings = true;
    } else {
      console.log(`✅ ${varName}`);
    }
  }

  return { hasErrors, hasWarnings };
}

function validateJwtKeys() {
  console.log('\n🔐 Validating JWT Keys...\n');

  const privateKeyPath = path.join(ROOT_DIR, process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem');
  const publicKeyPath = path.join(ROOT_DIR, process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem');

  let hasErrors = false;

  if (!fs.existsSync(privateKeyPath)) {
    console.error(`❌ Private key not found: ${privateKeyPath}`);
    hasErrors = true;
  } else {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
    if (!privateKey.includes('BEGIN PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
      console.error(`❌ Invalid private key format: ${privateKeyPath}`);
      hasErrors = true;
    } else {
      console.log(`✅ Private key: ${privateKeyPath}`);
    }
  }

  if (!fs.existsSync(publicKeyPath)) {
    console.error(`❌ Public key not found: ${publicKeyPath}`);
    hasErrors = true;
  } else {
    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
    if (!publicKey.includes('BEGIN PUBLIC KEY') && !publicKey.includes('BEGIN RSA PUBLIC KEY')) {
      console.error(`❌ Invalid public key format: ${publicKeyPath}`);
      hasErrors = true;
    } else {
      console.log(`✅ Public key: ${publicKeyPath}`);
    }
  }

  return { hasErrors };
}

async function validateRedisConnection() {
  console.log('\n🔌 Testing Redis Connection...\n');

  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD;

  const client = new Redis({
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  client.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
  });

  try {
    await client.ping();
    console.log(`✅ Redis connected: ${host}:${port}`);
    await client.quit();
    return { hasErrors: false };
  } catch (error) {
    console.error(`❌ Redis connection failed: ${error.message}`);
    console.log('   Make sure Redis is running on', `${host}:${port}`);
    return { hasErrors: true };
  }
}

async function validateDiscordApi() {
  console.log('\n🤖 Testing Discord API Connectivity...\n');

  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId || token.includes('your_') || clientId.includes('your_')) {
    console.log('⚠️  Skipping Discord API test (placeholder credentials)');
    return { hasErrors: false, skipped: true };
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    // Test bot token validity
    const app = await rest.get(Routes.application(clientId));
    console.log(`✅ Discord API: Connected as ${app.name} (${app.id})`);

    // Test bot user
    const botUser = await rest.get(Routes.user('@me'));
    console.log(`✅ Bot user: ${botUser.username}#${botUser.discriminator || '0'}`);

    return { hasErrors: false };
  } catch (error) {
    console.error(`❌ Discord API error: ${error.message}`);
    if (error.code === 401) {
      console.log('   Invalid bot token - check DISCORD_BOT_TOKEN');
    } else if (error.code === 403) {
      console.log('   Insufficient permissions - check bot scopes');
    }
    return { hasErrors: true };
  }
}

function validateDatabase() {
  console.log('\n💾 Validating Database Path...\n');

  const dbPath = path.join(ROOT_DIR, process.env.DATABASE_PATH || './voxaria.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    console.error(`❌ Database directory does not exist: ${dbDir}`);
    return { hasErrors: true };
  }

  if (!fs.existsSync(dbPath)) {
    console.warn(`⚠️  Database file does not exist yet: ${dbPath} (will be created on first run)`);
    return { hasErrors: false, warning: true };
  }

  console.log(`✅ Database: ${dbPath}`);
  return { hasErrors: false };
}

function validateCookiesFile() {
  console.log('\n🍪 Validating Cookies File...\n');

  const cookiesPath = path.join(ROOT_DIR, process.env.COOKIES_FILE || './cookies.txt');

  if (!fs.existsSync(cookiesPath)) {
    console.warn(`⚠️  Cookies file not found: ${cookiesPath}`);
    console.log('   YouTube may return bot detection errors without cookies');
    console.log('   Export cookies from browser extension and save as cookies.txt');
    return { hasErrors: false, warning: true };
  }

  const content = fs.readFileSync(cookiesPath, 'utf-8');
  if (!content.includes('youtube.com') && !content.includes('.youtube.com')) {
    console.warn(`⚠️  Cookies file may not contain YouTube cookies`);
    return { hasErrors: false, warning: true };
  }

  console.log(`✅ Cookies file: ${cookiesPath}`);
  return { hasErrors: false };
}

function validateKaraokeSetup() {
  console.log('\n🎤 Validating Karaoke Setup...\n');

  const outputDir = path.join(ROOT_DIR, process.env.KARAOKE_OUTPUT_DIR || './audio_cache/karaoke');

  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`✅ Created karaoke output directory: ${outputDir}`);
    } catch (error) {
      console.error(`❌ Failed to create karaoke output directory: ${error.message}`);
      return { hasErrors: true };
    }
  } else {
    console.log(`✅ Karaoke output directory: ${outputDir}`);
  }

  // Check for ffmpeg
  const ffmpegPath = path.join(ROOT_DIR, 'ffmpeg.exe');
  if (fs.existsSync(ffmpegPath)) {
    console.log(`✅ FFmpeg found: ${ffmpegPath}`);
  } else {
    console.warn(`⚠️  FFmpeg not found at ${ffmpegPath} (required for karaoke)`);
  }

  return { hasErrors: false };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Voxaria MusicBot Environment Validation             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const envVars = loadEnv();

  const envValidation = validateEnvVars(envVars);
  const jwtValidation = validateJwtKeys();
  const dbValidation = validateDatabase();
  const cookiesValidation = validateCookiesFile();
  const karaokeValidation = validateKaraokeSetup();

  const redisValidation = await validateRedisConnection();
  const discordValidation = await validateDiscordApi();

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      VALIDATION SUMMARY                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const allErrors = [
    envValidation.hasErrors,
    jwtValidation.hasErrors,
    dbValidation.hasErrors,
    redisValidation.hasErrors,
    discordValidation.hasErrors,
    karaokeValidation.hasErrors,
  ].some(Boolean);

  const allWarnings = [
    envValidation.hasWarnings,
    dbValidation.warning,
    cookiesValidation.warning,
    karaokeValidation.hasErrors && !karaokeValidation.hasErrors,
    discordValidation.skipped,
  ].some(Boolean);

  if (allErrors) {
    console.log('\n❌ VALIDATION FAILED - Fix errors above before starting the bot');
    process.exit(1);
  } else if (allWarnings) {
    console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS - Review warnings above');
    console.log('   Bot will start but some features may not work correctly');
    process.exit(0);
  } else {
    console.log('\n✅ ALL VALIDATIONS PASSED - Ready to start!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n💥 Validation script crashed:', error);
  process.exit(1);
});