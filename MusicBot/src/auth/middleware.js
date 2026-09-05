const { PermissionService } = require('./permission-service');

let permissionService = null;

function initPermissionService(client) {
    permissionService = new PermissionService(client);
    return permissionService.initialize();
}

function getPermissionService() {
    return permissionService;
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

        const token = authHeader.split(' ')[1];
        const sessionStore = req.app.get('sessionStore');
        
        if (!sessionStore) {
            return res.status(500).json({ error: 'Session store not available' });
        }

        const user = sessionStore.get(token);
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
        
        if (authHeader && authHeader.startsWith('Bearer ') && sessionStore) {
            const token = authHeader.split(' ')[1];
            const user = sessionStore.get(token);
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