import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import modelRouter from '../models/ModelRouter.js';
import parallelCoordinator from '../workers/ParallelCoordinator.js';
import tokenLimiter from '../models/TokenLimiter.js';
import { MODEL_CONFIG, SKILLS_REGISTRY, PARALLEL_WORKER_CONFIG } from '../config/models.js';

export function createApiServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(cors());
  app.use(express.json());

  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  const broadcast = (event, data) => {
    const message = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  };

  parallelCoordinator.on('task:created', (data) => broadcast('task-created', data));
  parallelCoordinator.on('subtask:assigned', (data) => broadcast('subtask-assigned', data));
  parallelCoordinator.on('subtask:completed', (data) => broadcast('subtask-completed', data));
  parallelCoordinator.on('task:completed', (data) => broadcast('task-completed', data));
  modelRouter.on('request:routed', (data) => broadcast('request-routed', data));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      models: modelRouter.models.size,
      workers: parallelCoordinator.workers.size
    });
  });

  app.get('/api/models', (req, res) => {
    const models = [];
    for (const [provider, config] of Object.entries(MODEL_CONFIG)) {
      for (const [id, modelConfig] of Object.entries(config.models)) {
        models.push({
          id,
          provider,
          ...modelConfig,
          health: modelRouter.healthStatus.get(id)
        });
      }
    }
    res.json(models);
  });

  app.post('/api/route', async (req, res) => {
    try {
      const request = req.body;
      const result = await modelRouter.routeRequest(request);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/dispatch', async (req, res) => {
    try {
      const result = await parallelCoordinator.dispatchParallel(req.body);
      res.status(202).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/tasks/:taskId', (req, res) => {
    const result = parallelCoordinator.getTaskResult(req.params.taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
    } else {
      res.json(result);
    }
  });

  app.post('/api/tasks/:taskId/subtasks/:subtaskId/complete', (req, res) => {
    const result = parallelCoordinator.completeSubtask(req.params.subtaskId, req.body.result);
    if (!result) {
      res.status(404).json({ error: 'Subtask not found' });
    } else {
      res.json(result);
    }
  });

  app.get('/api/token-limits', (req, res) => {
    const limits = {};
    for (const [modelId, limit] of tokenLimiter.limits) {
      limits[modelId] = limit;
    }
    res.json(limits);
  });

  app.post('/api/token-limits/:modelId', (req, res) => {
    const { modelId } = req.params;
    const { limit } = req.body;
    if (!limit || limit < 1) {
      res.status(400).json({ error: 'limit must be a positive number' });
    } else {
      tokenLimiter.setLimit(modelId, limit);
      res.json({ success: true, modelId, limit });
    }
  });

  app.get('/api/token-usage', (req, res) => {
    res.json(tokenLimiter.getUsageStats());
  });

  app.post('/api/token-mode', (req, res) => {
    const { mode } = req.body;
    try {
      tokenLimiter.setEnforcementMode(mode);
      res.json({ success: true, mode });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/skills', (req, res) => {
    res.json(SKILLS_REGISTRY);
  });

  app.get('/api/worker-awareness', (req, res) => {
    res.json({
      enabled: parallelCoordinator.config.enabled,
      awarenessPrompt: parallelCoordinator.getAwarenessPrompt()
    });
  });

  app.get('/api/metrics', (req, res) => {
    res.json({
      modelRouter: modelRouter.getMetrics(),
      parallelCoordinator: parallelCoordinator.getMetrics(),
      tokenLimiter: tokenLimiter.getUsageStats()
    });
  });

  return { app, server };
}
