const CircuitBreaker = require('opossum');

/**
 * Creates a circuit breaker for external service calls
 * @param {string} name - Service name for logging/metrics
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Circuit breaker options
 * @returns {CircuitBreaker}
 */
function createCircuitBreaker(name, fn, options = {}) {
    const defaultOptions = {
        timeout: 30000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
        name,
        ...options
    };

    const breaker = new CircuitBreaker(fn, defaultOptions);

    breaker.on('open', () => {
        console.warn(`[CB] ${name} OPENED - failing fast`);
    });

    breaker.on('close', () => {
        console.log(`[CB] ${name} CLOSED - recovered`);
    });

    breaker.on('halfOpen', () => {
        console.log(`[CB] ${name} HALF_OPEN - testing`);
    });

    breaker.on('fallback', (err) => {
        console.warn(`[CB] ${name} FALLBACK triggered:`, err?.message);
    });

    breaker.on('timeout', () => {
        console.warn(`[CB] ${name} TIMEOUT`);
    });

    breaker.on('reject', () => {
        console.warn(`[CB] ${name} REJECTED (circuit open)`);
    });

    return breaker;
}

/**
 * Creates a circuit breaker with a fallback function
 * @param {string} name 
 * @param {Function} fn 
 * @param {Function} fallback 
 * @param {Object} options 
 * @returns {CircuitBreaker}
 */
function createCircuitBreakerWithFallback(name, fn, fallback, options = {}) {
    const breaker = createCircuitBreaker(name, fn, options);
    breaker.fallback(fallback);
    return breaker;
}

module.exports = {
    createCircuitBreaker,
    createCircuitBreakerWithFallback
};