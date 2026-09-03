/**
 * AuditLog.js
 * Manages the persistent audit_log.json file.
 * Entries are prepended (newest first) and the file is capped at MAX_ENTRIES.
 */

const fse = require('fs-extra');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'audit_log.json');
const MAX_ENTRIES = 200;

/**
 * Appends a new receipt to the top of the audit log.
 * Keeps only the latest MAX_ENTRIES records.
 *
 * @param {object} receipt
 * @param {string} receipt.title          - Track title
 * @param {string} receipt.url            - Track URL
 * @param {string} receipt.requesterId    - Discord user ID of the requester
 * @param {string} receipt.requesterTag   - Discord username/tag (e.g. "Hayden#0001")
 * @param {string} receipt.requesterAvatar - CDN URL of the requester's avatar
 * @param {string} receipt.timestamp      - ISO-8601 timestamp
 */
async function append(receipt) {
    try {
        console.log(`📝 [AUDIT LOG ENTRY] ${new Date().toISOString()}`);
        console.log(JSON.stringify(receipt, null, 2));
        console.log(`--------------------------------------------------------------------------------`);

        let entries = [];

        if (await fse.pathExists(LOG_PATH)) {
            try {
                entries = await fse.readJson(LOG_PATH);
                if (!Array.isArray(entries)) entries = [];
            } catch (_) {
                entries = [];
            }
        }

        // Prepend new entry (newest first)
        entries.unshift(receipt);

        // Cap at MAX_ENTRIES
        if (entries.length > MAX_ENTRIES) {
            entries = entries.slice(0, MAX_ENTRIES);
        }

        // Ensure the directory exists
        await fse.ensureDir(path.dirname(LOG_PATH));

        await fse.outputJson(LOG_PATH, entries, { spaces: 2 });
    } catch (err) {
        console.error('❌ [AuditLog] Failed to write audit_log.json:', err.message);
    }
}

/**
 * Reads and returns all audit log entries (newest first).
 * Returns an empty array if the file doesn't exist or is corrupt.
 *
 * @returns {Promise<object[]>}
 */
async function read() {
    try {
        if (await fse.pathExists(LOG_PATH)) {
            const entries = await fse.readJson(LOG_PATH);
            return Array.isArray(entries) ? entries : [];
        }
    } catch (err) {
        console.error('❌ [AuditLog] Failed to read audit_log.json:', err.message);
    }
    return [];
}

module.exports = { append, read };
