import dotenv from 'dotenv';
import { createApiServer } from './api/server.js';
import modelRouter from './models/ModelRouter.js';
import tokenLimiter from './models/TokenLimiter.js';
import { PARALLEL_WORKER_CONFIG } from './config/models.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

const { app, server } = createApiServer();

server.listen(PORT, () => {
  console.log(`[Voxaria Orchestrator] Running on port ${PORT}`);
  console.log(`[Parallel Workers] Enabled: ${PARALLEL_WORKER_CONFIG.enabled}, Max: ${PARALLEL_WORKER_CONFIG.maxWorkers}, Pool: ${PARALLEL_WORKER_CONFIG.poolSize}`);
  console.log(`[Models] ${modelRouter.models.size} models registered`);
  console.log(`[Claude Token Limit] sonnet=${tokenLimiter.getLimit('claude-sonnet')} tokens, opus=${tokenLimiter.getLimit('claude-opus')} tokens`);
});

setInterval(() => {
  modelRouter.healthCheck();
}, 30000);
