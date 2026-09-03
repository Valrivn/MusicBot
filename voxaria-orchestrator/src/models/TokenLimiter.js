import { TOKEN_LIMITS, MODEL_CONFIG } from '../config/models.js';

export class TokenLimiter {
  constructor() {
    this.limits = new Map(Object.entries(TOKEN_LIMITS));
    this.usage = new Map();
    this.enforcementMode = 'hard';
    this.onExceed = null;
  }

  setEnforcementMode(mode) {
    if (!['hard', 'soft', 'summarize'].includes(mode)) {
      throw new Error(`Invalid enforcement mode: ${mode}. Use 'hard', 'soft', or 'summarize'`);
    }
    this.enforcementMode = mode;
  }

  setExceedCallback(callback) {
    this.onExceed = callback;
  }

  getLimit(modelId) {
    return this.limits.get(modelId) || 8192;
  }

  setLimit(modelId, limit) {
    this.limits.set(modelId, limit);
  }

  trackUsage(modelId, tokens) {
    const current = this.usage.get(modelId) || { total: 0, requests: 0, avgTokens: 0 };
    current.total += tokens;
    current.requests++;
    current.avgTokens = current.total / current.requests;
    this.usage.set(modelId, current);
  }

  checkLimit(modelId, requestedTokens) {
    const limit = this.getLimit(modelId);
    const usage = this.usage.get(modelId);

    return {
      allowed: requestedTokens <= limit,
      limit,
      requested: requestedTokens,
      remaining: Math.max(0, limit - requestedTokens),
      currentUsage: usage?.total || 0,
      enforcementMode: this.enforcementMode
    };
  }

  enforceLimit(modelId, tokens) {
    const limit = this.getLimit(modelId);
    const check = this.checkLimit(modelId, tokens);

    if (check.allowed) {
      this.trackUsage(modelId, tokens);
      return {
        allowed: true,
        tokens,
        limit
      };
    }

    switch (this.enforcementMode) {
      case 'hard':
        return this._handleHardLimit(modelId, tokens, limit);
      case 'soft':
        return this._handleSoftLimit(modelId, tokens, limit);
      case 'summarize':
        return this._handleSummarizeLimit(modelId, tokens, limit);
      default:
        return this._handleHardLimit(modelId, tokens, limit);
    }
  }

  _handleHardLimit(modelId, tokens, limit) {
    this.trackUsage(modelId, limit);
    if (this.onExceed) {
      this.onExceed({
        modelId,
        requested: tokens,
        limit,
        mode: 'hard',
        truncated: true
      });
    }
    return {
      allowed: true,
      tokens: limit,
      limit,
      truncated: true,
      originalTokens: tokens
    };
  }

  _handleSoftLimit(modelId, tokens, limit) {
    this.trackUsage(modelId, tokens);
    if (this.onExceed) {
      this.onExceed({
        modelId,
        requested: tokens,
        limit,
        mode: 'soft',
        warning: true
      });
    }
    return {
      allowed: true,
      tokens,
      limit,
      warning: true,
      message: `Token usage (${tokens}) exceeds recommended limit (${limit})`
    };
  }

  _handleSummarizeLimit(modelId, tokens, limit) {
    const reducedTokens = Math.floor(limit * 0.9);
    this.trackUsage(modelId, reducedTokens);
    if (this.onExceed) {
      this.onExceed({
        modelId,
        requested: tokens,
        limit,
        mode: 'summarize',
        reducedTo: reducedTokens
      });
    }
    return {
      allowed: true,
      tokens: reducedTokens,
      limit,
      summarized: true,
      originalTokens: tokens,
      message: `Tokens reduced from ${tokens} to ${reducedTokens} for summarization`
    };
  }

  getUsageStats() {
    const stats = {};
    for (const [modelId, usage] of this.usage) {
      stats[modelId] = {
        ...usage,
        limit: this.getLimit(modelId),
        utilization: ((usage.total / this.getLimit(modelId)) * 100).toFixed(2) + '%'
      };
    }
    return stats;
  }

  resetUsage(modelId) {
    if (modelId) {
      this.usage.delete(modelId);
    } else {
      this.usage.clear();
    }
  }
}

export default new TokenLimiter();
