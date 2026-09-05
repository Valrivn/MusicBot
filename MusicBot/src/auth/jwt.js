const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SignJWT, jwtVerify, createRemoteJWKSet, importSPKI, importPKCS8, exportJWK } = require('jose');
const Database = require('better-sqlite3');

const KEYS_DIR = path.join(__dirname, '..', '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const DB_PATH = path.join(__dirname, '..', '..', 'database', 'auth.db');

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const ISSUER = 'voxaria-bot';
const AUDIENCE = 'voxaria-web';

let privateKey = null;
let publicKey = null;
let db = null;

function initKeys() {
    if (!fs.existsSync(KEYS_DIR)) {
        fs.mkdirSync(KEYS_DIR, { recursive: true });
    }

    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
        privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
        publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
        return;
    }

    const { generateKeyPairSync } = require('crypto');
    const { privateKey: privKey, publicKey: pubKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PRIVATE_KEY_PATH, privKey);
    fs.writeFileSync(PUBLIC_KEY_PATH, pubKey);

    privateKey = privKey;
    publicKey = pubKey;
}

function initDatabase() {
    db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            revoked_at INTEGER DEFAULT NULL,
            user_agent TEXT,
            ip_address TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    `);
}

async function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function getPrivateKey() {
    if (!privateKey) initKeys();
    return await importPKCS8(privateKey, 'RS256');
}

async function getPublicKey() {
    if (!publicKey) initKeys();
    return await importSPKI(publicKey, 'RS256');
}

function getDb() {
    if (!db) initDatabase();
    return db;
}

async function createAccessToken(user) {
    const key = await getPrivateKey();
    return new SignJWT({
        sub: user.id,
        roles: user.roles || [],
        guildId: user.guildId || null,
        username: user.username || null
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime(ACCESS_TOKEN_EXPIRY)
        .sign(key);
}

async function createRefreshToken(user, userAgent = null, ipAddress = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = await hashToken(token);
    const expiresAt = Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    const database = getDb();
    database.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id, tokenHash, expiresAt, userAgent, ipAddress);

    return token;
}

async function verifyAccessToken(token) {
    const key = await getPublicKey();
    const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE
    });
    return payload;
}

async function verifyRefreshToken(token) {
    const tokenHash = await hashToken(token);
    const database = getDb();
    const row = database.prepare(`
        SELECT * FROM refresh_tokens 
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(tokenHash, Date.now());

    if (!row) return null;

    return {
        userId: row.user_id,
        expiresAt: row.expires_at
    };
}

async function revokeRefreshToken(token) {
    const tokenHash = await hashToken(token);
    const database = getDb();
    database.prepare(`
        UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?
    `).run(Date.now(), tokenHash);
}

async function revokeAllUserRefreshTokens(userId) {
    const database = getDb();
    database.prepare(`
        UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).run(Date.now(), userId);
}

async function rotateRefreshToken(oldToken, user, userAgent = null, ipAddress = null) {
    await revokeRefreshToken(oldToken);
    return await createRefreshToken(user, userAgent, ipAddress);
}

async function getJWKS() {
    const key = await getPublicKey();
    const jwk = await exportJWK(key);
    return {
        keys: [{
            ...jwk,
            use: 'sig',
            alg: 'RS256',
            kid: 'voxaria-1'
        }]
    };
}

async function cleanupExpiredTokens() {
    const database = getDb();
    database.prepare(`
        DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL
    `).run(Date.now());
}

function getAccessTokenExpiry() {
    return ACCESS_TOKEN_EXPIRY;
}

function getRefreshTokenExpiryDays() {
    return REFRESH_TOKEN_EXPIRY_DAYS;
}

initKeys();
initDatabase();

setInterval(cleanupExpiredTokens, 24 * 60 * 60 * 1000);

module.exports = {
    createAccessToken,
    createRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllUserRefreshTokens,
    rotateRefreshToken,
    getJWKS,
    getAccessTokenExpiry,
    getRefreshTokenExpiryDays,
    hashToken,
    ISSUER,
    AUDIENCE
};