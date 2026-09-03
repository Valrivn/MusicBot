# Voxaria AI Orchestrator — Agent Guidelines

This document defines how every AI agent operating in this repository should behave. **Read this before starting any task.**

## Models Available

You are limited to the models listed below. **Never assume access to models outside this list.**

### OpenCode Zen (free models)
| Model | Capabilities |
|-------|--------------|
| `nemotron-3-ultra-free` | text, code |
| `nemotron-3.5-lightning-free` | text, code (fast) |
| `zenbig-pickle` | text, code, analysis |
| `zenimage-2muse-spark-1.3-free` | text, image |
| `muse-spark-1.2-free` | text, code |
| `mimo-v2.5-free` | text, code, reasoning |

### Antigravity (Gemini + Claude)
| Model | Capabilities | Token Limit |
|-------|--------------|-------------|
| `gemini-3-flash` | text, code, vision (fast) | 8192 |
| `gemini-3.1-pro` | text, code, vision, reasoning | 32768 |
| `claude-sonnet` | text, code, analysis | **300** |
| `claude-opus` | text, code, reasoning, analysis | **300** |

> **CLAUDE TOKEN RULE:** Claude Sonnet and Claude Opus responses **MUST be under 300 tokens**. Exceeding this limit is a violation. Keep Claude responses terse: one recommendation, a verdict, or a short decision. When Claude needs to convey more, delegate to a non-Claude worker.

## Parallel Worker Awareness (MANDATORY)

**You have access to parallel subagents.** This is not optional — use it.

When given a task:

1. **DECOMPOSE** the task into independent workstreams.
2. **DISPATCH** subagents via the `dispatching-parallel-agents` skill. Launch multiple workers in parallel whenever work divides cleanly (e.g., one writes implementation, another writes tests).
3. **COORDINATE** outputs before responding. Gather all parallel results.
4. **NEVER** work sequentially when parallelism is possible. If you catch yourself doing things one-at-a-time that could be parallel, stop and dispatch instead.

Available parallel workers can:
- Execute code modifications
- Run tests
- Analyze codebases
- Generate documentation
- Perform reviews

Use the `Task` tool to dispatch parallel work. Each worker operates independently. Always summarize parallel work results before responding to the user.

## Services

Start the orchestrator backend (port 3001):
```bash
cd voxaria-orchestrator
npm install
npm start
```

API endpoints:
- `GET /api/models` — model inventory
- `POST /api/route` — route a request to best model
- `POST /api/dispatch` — dispatch parallel subtasks
- `GET /api/tasks/:id` — task status
- `GET/POST /api/token-limits` — Claude token limits
- `POST /api/token-mode` — enforcement mode (hard/soft/summarize)
- `GET /api/worker-awareness` — parallel worker prompt
- `GET /api/metrics` — router + worker + token metrics
- `GET /api/skills` — skills registry

MusicBot exposes `/ai status` and `/ai dispatch` Discord commands.

## Skills

Skills are installed from skills.sh via `npx skills add <owner>/repo -y`. Installed packs:
- `vercel-labs/agent-skills` (React/design best practices)
- `obra/superpowers` (parallel dispatch, plans, debugging)
- `mattpocock/skills` (tdd, to-spec, implement, code-review)
- `anthropics/skills` (frontend-design, skill-creator, documents)
- `vercel-labs/skills` (find-skills — discover/install new skills mid-session)
- `vercel-labs/agent-browser` (browser automation)
- `google-gemini/gemini-skills` (Gemini API development)

Skills live under `.agents/skills/` in the project root.
