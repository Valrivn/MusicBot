import EventEmitter from 'eventemitter3';
import { MODEL_CONFIG, TOKEN_LIMITS } from '../config/models.js';
import { v4 as uuidv4 } from 'uuid';

export class ModelRouter extends EventEmitter {
  constructor() {
    super();
    this.models = new Map();
    this.requestQueue = new Map();
    this.healthStatus = new Map();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatency: 0,
      requestsByModel: new Map()
    };
    this._initializeModels();
  }

  _initializeModels() {
    for (const [provider, config] of Object.entries(MODEL_CONFIG)) {
      for (const [modelId, modelConfig] of Object.entries(config.models)) {
        this.models.set(modelId, {
          ...modelConfig,
          provider,
          baseUrl: config.baseUrl,
          status: 'healthy',
          lastHealthCheck: Date.now(),
          activeRequests: 0,
          queueLength: 0
        });
        this.healthStatus.set(modelId, {
          healthy: true,
          lastCheck: Date.now(),
          errorCount: 0,
          successCount: 0
        });
      }
    }
  }

  getModel(modelId) {
    return this.models.get(modelId);
  }

  getModelsByCapability(capability) {
    const models = [];
    for (const [id, config] of this.models) {
      if (config.capabilities.includes(capability)) {
        models.push({ id, ...config });
      }
    }
    return models;
  }

  getFastestModels(count = 3) {
    const models = [];
    for (const [id, config] of this.models) {
      if (config.speed === 'fast' || config.parallelWeight >= 1.3) {
        models.push({ id, ...config });
      }
    }
    return models
      .sort((a, b) => (b.parallelWeight || 1) - (a.parallelWeight || 1))
      .slice(0, count);
  }

  selectModelForTask(task) {
    const { capability, priority, maxTokens } = task;
    let candidates = [];

    for (const [id, config] of this.models) {
      const health = this.healthStatus.get(id);
      if (!health.healthy) continue;
      if (capability && !config.capabilities.includes(capability)) continue;
      if (maxTokens && config.maxTokens < maxTokens) continue;
      candidates.push({ id, ...config, health });
    }

    if (priority === 'speed') {
      candidates = candidates.filter(c => c.speed === 'fast');
    }

    if (candidates.length === 0) {
      return this._getFallbackModel();
    }

    candidates.sort((a, b) => {
      const scoreA = (a.parallelWeight || 1) * (a.health.successCount + 1);
      const scoreB = (b.parallelWeight || 1) * (b.health.successCount + 1);
      return scoreB - scoreA;
    });

    return candidates[0].id;
  }

  _getFallbackModel() {
    for (const [id, config] of this.models) {
      if (config.capabilities.includes('text')) {
        return id;
      }
    }
    return this.models.keys().next().value;
  }

  async routeRequest(request) {
    const requestId = uuidv4();
    const startTime = Date.now();

    const modelId = request.model || this.selectModelForTask({
      capability: request.capability || 'text',
      priority: request.priority || 'balanced',
      maxTokens: request.maxTokens
    });

    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const tokenLimit = TOKEN_LIMITS[modelId] || model.maxTokens;
    if (request.maxTokens && request.maxTokens > tokenLimit) {
      request.maxTokens = tokenLimit;
    }

    model.activeRequests++;
    this.metrics.totalRequests++;
    this.metrics.requestsByModel.set(
      modelId,
      (this.metrics.requestsByModel.get(modelId) || 0) + 1
    );

    this.emit('request:routed', {
      requestId,
      modelId,
      provider: model.provider,
      timestamp: Date.now()
    });

    return {
      requestId,
      modelId,
      provider: model.provider,
      baseUrl: model.baseUrl,
      maxTokens: request.maxTokens || tokenLimit,
      tokenLimit,
      metadata: {
        startTime,
        model: model.name,
        capabilities: model.capabilities
      }
    };
  }

  recordResult(requestId, modelId, success, latency) {
    const model = this.models.get(modelId);
    if (model) {
      model.activeRequests = Math.max(0, model.activeRequests - 1);
    }

    const health = this.healthStatus.get(modelId);
    if (health) {
      if (success) {
        health.successCount++;
        health.errorCount = Math.max(0, health.errorCount - 1);
      } else {
        health.errorCount++;
        if (health.errorCount > 5) {
          health.healthy = false;
          this.emit('model:unhealthy', { modelId, errorCount: health.errorCount });
        }
      }
      health.lastCheck = Date.now();
    }

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    this.metrics.avgLatency = (this.metrics.avgLatency + latency) / 2;
  }

  getMetrics() {
    return {
      ...this.metrics,
      modelsByStatus: Object.fromEntries(
        Array.from(this.models.entries()).map(([id, config]) => [
          id,
          {
            status: config.status,
            activeRequests: config.activeRequests,
            healthy: this.healthStatus.get(id)?.healthy
          }
        ])
      )
    };
  }

  async healthCheck() {
    for (const [modelId, model] of this.models) {
      const health = this.healthStatus.get(modelId);
      if (health && health.errorCount > 10) {
        health.healthy = true;
        health.errorCount = 0;
        this.emit('model:recovered', { modelId });
      }
    }
    return this.getMetrics();
  }
}

export default new ModelRouter();
