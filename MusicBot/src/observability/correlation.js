const rtrace = require('cls-rtracer');
const { logger } = require('./logger');

/**
 * Express middleware to add correlation ID to requests
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function correlationIdMiddleware(options = {}) {
    const headerName = options.headerName || 'x-request-id';
    const useHeader = options.useHeader !== false;

    return rtrace.expressMiddleware({
        headerName,
        useHeader,
        echoHeader: true,
        getUuid: () => {
            // Generate a short, readable ID
            return `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
        }
    });
}

/**
 * Gets the current correlation ID from the CLS context
 * @returns {string|undefined}
 */
function getCorrelationId() {
    return rtrace.id();
}

/**
 * Creates a logger with the current correlation ID bound
 * @param {Object} additionalContext - Additional context to bind
 * @returns {pino.Logger}
 */
function getRequestLogger(additionalContext = {}) {
    const correlationId = getCorrelationId();
    const baseContext = { requestId: correlationId };
    return logger.child({ ...baseContext, ...additionalContext });
}

/**
 * Wraps a function with correlation ID context
 * @param {Function} fn - Function to wrap
 * @returns {Function} Wrapped function
 */
function withCorrelationId(fn) {
    return rtrace.wrapWithTraceId(fn);
}

/**
 * Creates a new correlation ID context for background jobs
 * @param {string} prefix - Prefix for the ID
 * @returns {string} New correlation ID
 */
function createCorrelationId(prefix = 'job') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Runs a function within a new correlation ID context
 * @param {Function} fn - Function to run
 * @param {string} correlationId - Optional correlation ID (generated if not provided)
 * @returns {Promise<any>} Result of the function
 */
function runWithCorrelationId(fn, correlationId = null) {
    const id = correlationId || createCorrelationId();
    return rtrace.runWithId(id, fn);
}

module.exports = {
    correlationIdMiddleware,
    getCorrelationId,
    getRequestLogger,
    withCorrelationId,
    createCorrelationId,
    runWithCorrelationId
};