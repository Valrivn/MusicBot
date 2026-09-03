const axios = require('axios');

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';

class OrchestratorClient {
  constructor() {
    this.client = axios.create({
      baseURL: ORCHESTRATOR_URL,
      timeout: 10000
    });
  }

  async getModels() {
    const { data } = await this.client.get('/api/models');
    return data;
  }

  async routeRequest({ capability, priority, maxTokens }) {
    const { data } = await this.client.post('/api/route', {
      capability,
      priority,
      maxTokens
    });
    return data;
  }

  async dispatchParallel(subtasks) {
    const { data } = await this.client.post('/api/dispatch', { subtasks });
    return data;
  }

  async getTask(taskId) {
    const { data } = await this.client.get(`/api/tasks/${taskId}`);
    return data;
  }

  async completeSubtask(taskId, subtaskId, result) {
    const { data } = await this.client.post(
      `/api/tasks/${taskId}/subtasks/${subtaskId}/complete`,
      { result }
    );
    return data;
  }

  async getTokenLimits() {
    const { data } = await this.client.get('/api/token-limits');
    return data;
  }

  async setTokenMode(mode) {
    const { data } = await this.client.post('/api/token-mode', { mode });
    return data;
  }

  async getMetrics() {
    const { data } = await this.client.get('/api/metrics');
    return data;
  }

  async getWorkerAwareness() {
    const { data } = await this.client.get('/api/worker-awareness');
    return data;
  }

  async getSkills() {
    const { data } = await this.client.get('/api/skills');
    return data;
  }
}

module.exports = new OrchestratorClient();
