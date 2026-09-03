# Voxaria AI Orchestrator

Multi-model AI orchestrator with parallel worker awareness, skills.sh integration, and enforced Claude <300 token budgets.

## Models Supported

| Model | Provider | Max Tokens | Claude Cap |
|-------|----------|-----------|------------|
| nemotron-3-ultra-free | OpenCode Zen | 4096 | - |
| nemotron-3.5-lightning-free | OpenCode Zen | 4096 | - |
| zenbig-pickle | OpenCode Zen | 8192 | - |
| zenimage-2muse-spark-1.3-free | OpenCode Zen | 4096 | - |
| muse-spark-1.2-free | OpenCode Zen | 4096 | - |
| mimo-v2.5-free | OpenCode Zen | 8192 | - |
| gemini-3-flash | Antigravity | 8192 | - |
| gemini-3.1-pro | Antigravity | 32768 | - |
| claude-sonnet | Antigravity | 300 | strict |
| claude-opus | Antigravity | 300 | strict |

## Quick Start

```bash
npm install
npm start
```

Server runs on `http://localhost:3001`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health + model/worker counts |
| GET | `/api/models` | Full model inventory with health |
| POST | `/api/route` | Route request to best model |
| POST | `/api/dispatch` | Dispatch parallel subtasks to worker pool |
| GET | `/api/tasks/:id` | Task status / result |
| POST | `/api/tasks/:id/subtasks/:sid/complete` | Mark subtask complete |
| GET | `/api/token-limits` | Per-model token budgets |
| POST | `/api/token-limits/:model` | Update a model's token limit |
| GET | `/api/token-usage` | Live token usage stats |
| POST | `/api/token-mode` | Claude enforcement: hard/soft/summarize |
| GET | `/api/skills` | Installed + available skills registry |
| GET | `/api/worker-awareness` | Parallel worker awareness prompt |
| GET | `/api/metrics` | Router + worker + token metrics |

## Parallel Worker Dispatch

```bash
curl -X POST http://localhost:3001/api/dispatch \
  -H "Content-Type: application/json" \
  -d '{"subtasks":[{"capability":"code"},{"capability":"analysis"}]}'
```

Each subtask is assigned an idle worker from the pool. Completion can be posted back:

```bash
curl -X POST http://localhost:3001/api/tasks/<taskId>/subtasks/<subtaskId>/complete \
  -H "Content-Type: application/json" \
  -d '{"result":"done"}'
```

## WebSocket Events

Connect to `ws://localhost:3001/ws` for real-time events:
- `task-created`, `subtask-assigned`, `subtask-completed`, `task-completed`
- `request-routed`

## Skills

All installed skills live in `.agents/skills/` (see root). Installed packs:
- `vercel-labs/agent-skills` (9)
- `obra/superpowers` (14) — parallel dispatch, plans, debugging
- `mattpocock/skills` (37) — tdd, to-spec, implement, code-review
- `anthropics/skills` (20) — frontend-design, skill-creator, documents
