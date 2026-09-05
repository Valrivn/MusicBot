const { createEnforcer, getEnforcer, reloadPolicy } = require('./casbin');
const fs = require('fs');
const path = require('path');

const ROLES_FILE = path.join(__dirname, '..', '..', 'roles.json');
const OWNER_ID = '895441968241459271';

const DISCORD_ROLE_MAP = {
    'Admin': 'role:admin',
    'Staff': 'role:admin',
    'DJ': 'role:dj',
    'VIP': 'role:vip',
    'Vip': 'role:vip'
};

class PermissionService {
    constructor(client) {
        this.client = client;
        this.enforcer = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        this.enforcer = await createEnforcer();
        this.initialized = true;
    }

    async getUserRoles(userId, guildId = null) {
        const roles = ['role:user'];

        if (userId === OWNER_ID) {
            return ['role:owner'];
        }

        try {
            if (fs.existsSync(ROLES_FILE)) {
                const roleData = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
                const roleLevel = roleData[userId];
                if (roleLevel !== undefined) {
                    if (roleLevel >= 3) roles.push('role:owner');
                    else if (roleLevel >= 2) roles.push('role:admin');
                    else if (roleLevel >= 1) roles.push('role:dj');
                }
            }
        } catch (e) {
            console.error('Failed to read roles.json:', e.message);
        }

        if (guildId && this.client) {
            const guild = this.client.guilds.cache.get(guildId);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    for (const [_, role] of member.roles.cache) {
                        const mappedRole = DISCORD_ROLE_MAP[role.name];
                        if (mappedRole && !roles.includes(mappedRole)) {
                            roles.push(mappedRole);
                        }
                    }
                }
            }
        }

        return roles;
    }

    async can(userId, resource, action, guildId = null) {
        if (!this.initialized) {
            await this.initialize();
        }

        const roles = await this.getUserRoles(userId, guildId);
        
        for (const role of roles) {
            if (await this.enforcer.enforce(role, resource, action)) {
                return true;
            }
        }
        return false;
    }

    async canWithUserObject(user, resource, action) {
        const userId = user.id || user.userId;
        const guildId = user.guildId || (user.guild ? user.guild.id : null);
        return this.can(userId, resource, action, guildId);
    }

    async reload() {
        await reloadPolicy();
    }
}

module.exports = { PermissionService };