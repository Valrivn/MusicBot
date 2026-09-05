/**
 * OpenTelemetry Tracing Setup
 * Phase 2 - Optional
 * Requires: @opentelemetry/sdk-node, @opentelemetry/exporter-jaeger, @opentelemetry/auto-instrumentations-node
 */

const { logger } = require('./logger');

let tracer = null;
let tracingEnabled = false;

/**
 * Initializes OpenTelemetry tracing
 * @returns {Object|null} Tracer instance or null if disabled
 */
function initTracing() {
    if (tracingEnabled) {
        return tracer;
    }

    // Check if tracing is enabled via env var
    if (process.env.ENABLE_TRACING !== 'true') {
        logger.info({ msg: 'OpenTelemetry tracing disabled (set ENABLE_TRACING=true to enable)' });
        return null;
    }

    try {
        // Dynamic imports to avoid errors if packages not installed
        const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
        const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
        const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
        const { Resource } = require('@opentelemetry/resources');
        const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
        const { registerInstrumentations } = require('@opentelemetry/instrumentation');
        const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
        const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
        const { context, propagation, trace } = require('@opentelemetry/api');

        const provider = new NodeTracerProvider({
            resource: new Resource({
                [SemanticResourceAttributes.SERVICE_NAME]: 'voxaria-bot',
                [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '16.0.0',
            }),
        });

        // Jaeger exporter
        const jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
        const exporter = new JaegerExporter({
            endpoint: jaegerEndpoint,
        });

        provider.addSpanProcessor(new BatchSpanProcessor(exporter));
        provider.register();

        // Auto-instrumentations
        registerInstrumentations({
            instrumentations: [
                new HttpInstrumentation(),
                new ExpressInstrumentation(),
            ],
        });

        tracer = trace.getTracer('voxaria-bot');
        tracingEnabled = true;

        logger.info({ msg: 'OpenTelemetry tracing initialized', jaegerEndpoint });
        return tracer;

    } catch (error) {
        logger.warn({ msg: 'Failed to initialize OpenTelemetry tracing', error: error.message });
        return null;
    }
}

/**
 * Creates a span for a specific operation
 * @param {string} name - Span name
 * @param {Object} attributes - Span attributes
 * @param {Function} fn - Function to execute within the span
 * @returns {Promise<any>} Result of the function
 */
async function withSpan(name, attributes = {}, fn) {
    if (!tracer) {
        return fn();
    }

    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            const result = await fn(span);
            span.setStatus({ code: trace.SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.setStatus({ 
                code: trace.SpanStatusCode.ERROR, 
                message: error.message 
            });
            span.recordException(error);
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Gets the current tracer
 * @returns {Tracer|null}
 */
function getTracer() {
    return tracer;
}

/**
 * Checks if tracing is enabled
 * @returns {boolean}
 */
function isTracingEnabled() {
    return tracingEnabled;
}

module.exports = {
    initTracing,
    withSpan,
    getTracer,
    isTracingEnabled
};