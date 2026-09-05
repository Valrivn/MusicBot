const pino = require('pino');

/**
 * Creates a structured logger with correlation ID support
 * @returns {pino.Logger}
 */
function createLogger() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    const logger = pino({
        level: process.env.LOG_LEVEL || 'info',
        transport: isProduction 
            ? undefined 
            : { 
                target: 'pino-pretty', 
                options: { 
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname'
                } 
            },
        base: { 
            service: 'voxaria-bot', 
            version: process.env.npm_package_version || '16.0.0',
            pid: process.pid
        },
        formatters: {
            level: (label) => {
                return { level: label };
            }
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
            paths: [
                '*.token',
                '*.password',
                '*.secret',
                '*.authorization',
                '*.cookie',
                'req.headers.authorization',
                'req.headers.cookie'
            ],
            censor: '[REDACTED]'
        }
    });

    return logger;
}

const logger = createLogger();

/**
 * Creates a child logger with additional context
 * @param {Object} context - Additional context to bind
 * @returns {pino.Logger}
 */
function createChildLogger(context) {
    return logger.child(context);
}

module.exports = {
    logger,
    createLogger,
    createChildLogger
};