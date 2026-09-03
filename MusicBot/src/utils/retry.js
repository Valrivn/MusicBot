/**
 * Retry utility with exponential backoff and jitter
 * Handles network errors like ECONNRESET, ETIMEDOUT, etc.
 */

const RETRYABLE_ERROR_CODES = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EPROTO',
    'ESOCKETTIMEDOUT'
];

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function isRetryableError(error) {
    if (!error) return false;
    
    if (error.code && RETRYABLE_ERROR_CODES.includes(error.code)) {
        return true;
    }
    
    if (error.response && RETRYABLE_STATUS_CODES.includes(error.response.status)) {
        return true;
    }
    
    if (error.status && RETRYABLE_STATUS_CODES.includes(error.status)) {
        return true;
    }
    
    if (error.message && (
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('socket hang up') ||
        error.message.includes('network error') ||
        error.message.includes('timeout')
    )) {
        return true;
    }
    
    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(fn, options = {}) {
    const {
        retries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        jitter = 0.3,
        onRetry = null
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === retries) {
                break;
            }

            if (!isRetryableError(error)) {
                throw error;
            }

            const delay = Math.min(
                baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay * jitter,
                maxDelay
            );

            if (onRetry) {
                onRetry(attempt + 1, retries, delay, error);
            } else {
                console.log(`[Retry] Attempt ${attempt + 1}/${retries} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
            }

            await sleep(delay);
        }
    }

    throw lastError;
}

async function axiosWithRetry(axiosInstance, config, options = {}) {
    return fetchWithRetry(
        () => axiosInstance.request(config),
        options
    );
}

async function fetchWithRetryNative(url, init, options = {}) {
    return fetchWithRetry(
        () => fetch(url, init),
        options
    );
}

module.exports = {
    fetchWithRetry,
    axiosWithRetry,
    fetchWithRetryNative,
    isRetryableError,
    RETRYABLE_ERROR_CODES,
    RETRYABLE_STATUS_CODES
};