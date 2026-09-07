const { PermissionService } = require('./permission-service');
const { verifyAccessToken } = require('./jwt');

let permissionService = null;

function initPermissionService(client) {
    permissionService = new PermissionService(client);
    return permissionService.initialize();
}

function getPermissionService() {
    return permissionService;
}

function hashIP(ip) {
    if (!ip) return null;
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

// Resolve the caller identity from either a stored session token or a signed JWT
// access token. The web dashboard sends a JWT via the Authorization header.
async function resolveUser(authHeader, sessionStore, req = null) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];
    if (!token) return null;

    // 1. Try session store (legacy Map-based sessions)
    if (sessionStore) {
        const sessionUser = sessionStore.get(token);
        if (sessionUser) return sessionUser;
    }

    // 2. Try verifying as a signed JWT access token
    try {
        const payload = await verifyAccessToken(token);
        if (payload && payload.sub) {
            // SOFT BINDING: Log mismatch but don't reject
            if (req) {
                const requestUA = req.headers['user-agent'];
                const requestIP = req.ip;
                if (payload.userAgent && payload.userAgent !== requestUA) {
                    console.warn(`[SECURITY] UA mismatch for user ${payload.sub}: token=${payload.userAgent?.substring(0,30)}... request=${requestUA?.substring(0,30)}...`);
                }
                if (payload.ipHash && payload.ipHash !== hashIP(requestIP)) {
                    console.warn(`[SECURITY] IP mismatch for user ${payload.sub}: token=${payload.ipHash} request=${hashIP(requestIP)}`);
                }
            }
            return {
                id: payload.sub,
                username: payload.username || null,
                roles: payload.roles || [],
                guildId: payload.guildId || null
            };
        }
    } catch (e) {
        // Not a valid JWT — fall through
    }

    return null;
}

function requirePermission(resource, action) {
    return async (req, res, next) => {
        if (!permissionService) {
            return res.status(500).json({ error: 'Permission service not initialized' });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const sessionStore = req.app.get('sessionStore');

        const user = await resolveUser(authHeader, sessionStore, req);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        const guildId = req.headers['x-guild-id'] || req.headers['X-Guild-Id'] || req.body?.guildId;
        const hasPermission = await permissionService.can(user.id, resource, action, guildId);

        if (!hasPermission) {
            return res.status(403).json({ 
                error: `Forbidden: Requires ${resource}:${action} permission` 
            });
        }

        req.user = { 
            ...user, 
            role: await getUserRoleLevel(user.id, guildId)
        };
        next();
    };
}

async function getUserRoleLevel(userId, guildId = null) {
    if (userId === '895441968241459271') return 3;
    
    const ROLES_FILE = require('path').join(__dirname, '..', '..', 'roles.json');
    const fs = require('fs');
    
    try {
        if (fs.existsSync(ROLES_FILE)) {
            const roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
            return roles[userId] !== undefined ? roles[userId] : 0;
        }
    } catch (e) {
        console.error('Failed to read roles.json:', e.message);
    }
    return 0;
}

function optionalAuth() {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        const sessionStore = req.app.get('sessionStore');
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const user = await resolveUser(authHeader, sessionStore, req);
            if (user) {
                req.user = { 
                    ...user, 
                    role: await getUserRoleLevel(user.id)
                };
            }
        }
        
        if (!req.user) {
            req.user = { 
                id: req.headers['x-user-id'] || 'guest', 
                username: req.headers['x-user-username'] || 'Guest', 
                role: 0 
            };
        }
        next();
    };
}

module.exports = {
    initPermissionService,
    getPermissionService,
    requirePermission,
    optionalAuth
};