const { newEnforcer } = require('casbin');
const path = require('path');

const MODEL_PATH = path.join(__dirname, 'casbin-model.conf');
const POLICY_PATH = path.join(__dirname, '..', '..', 'policy.csv');

let enforcer = null;

async function createEnforcer() {
    if (enforcer) {
        return enforcer;
    }
    
    enforcer = await newEnforcer(MODEL_PATH, POLICY_PATH);
    return enforcer;
}

function getEnforcer() {
    return enforcer;
}

async function reloadPolicy() {
    if (enforcer) {
        await enforcer.loadPolicy();
    }
}

async function addPolicy(sub, obj, act) {
    if (enforcer) {
        const added = await enforcer.addPolicy(sub, obj, act);
        if (added) {
            await enforcer.savePolicy();
        }
        return added;
    }
    return false;
}

async function removePolicy(sub, obj, act) {
    if (enforcer) {
        const removed = await enforcer.removePolicy(sub, obj, act);
        if (removed) {
            await enforcer.savePolicy();
        }
        return removed;
    }
    return false;
}

async function getAllPolicies() {
    if (enforcer) {
        return await enforcer.getPolicy();
    }
    return [];
}

async function addGroupingPolicy(user, role) {
    if (enforcer) {
        const added = await enforcer.addGroupingPolicy(user, role);
        if (added) {
            await enforcer.savePolicy();
        }
        return added;
    }
    return false;
}

async function removeGroupingPolicy(user, role) {
    if (enforcer) {
        const removed = await enforcer.removeGroupingPolicy(user, role);
        if (removed) {
            await enforcer.savePolicy();
        }
        return removed;
    }
    return false;
}

async function getRolesForUser(user) {
    if (enforcer) {
        return await enforcer.getRolesForUser(user);
    }
    return [];
}

async function getUsersForRole(role) {
    if (enforcer) {
        return await enforcer.getUsersForRole(role);
    }
    return [];
}

module.exports = {
    createEnforcer,
    getEnforcer,
    reloadPolicy,
    addPolicy,
    removePolicy,
    getAllPolicies,
    addGroupingPolicy,
    removeGroupingPolicy,
    getRolesForUser,
    getUsersForRole
};