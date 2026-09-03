export const MODEL_CONFIG = {
  opencode: {
    provider: 'opencode',
    baseUrl: process.env.OPENCODE_API_URL || 'http://localhost:3000/api',
    models: {
      'nemotron-3-ultra-free': {
        name: 'Nemotron 3 Ultra Free',
        maxTokens: 4096,
        costPer1kTokens: 0,
        capabilities: ['text', 'code'],
        parallelWeight: 1.0
      },
      'nemotron-3.5-lightning-free': {
        name: 'Nemotron 3.5 Lightning Free',
        maxTokens: 4096,
        costPer1kTokens: 0,
        capabilities: ['text', 'code'],
        speed: 'fast',
        parallelWeight: 1.2
      },
      'zenbig-pickle': {
        name: 'OpenCode ZenBig Pickle',
        maxTokens: 8192,
        costPer1kTokens: 0,
        capabilities: ['text', 'code', 'analysis'],
        parallelWeight: 0.9
      },
      'zenimage-2muse-spark-1.3-free': {
        name: 'OpenCode ZenImage 2Muse Spark 1.3 Free',
        maxTokens: 4096,
        costPer1kTokens: 0,
        capabilities: ['text', 'image'],
        parallelWeight: 0.8
      },
      'muse-spark-1.2-free': {
        name: 'Muse Spark 1.2 Free',
        maxTokens: 4096,
        costPer1kTokens: 0,
        capabilities: ['text', 'code'],
        parallelWeight: 1.0
      },
      'mimo-v2.5-free': {
        name: 'MiMo V2.5 Free',
        maxTokens: 8192,
        costPer1kTokens: 0,
        capabilities: ['text', 'code', 'reasoning'],
        parallelWeight: 1.1
      }
    }
  },
  antigravity: {
    provider: 'antigravity',
    baseUrl: process.env.ANTIGRAVITY_API_URL || 'https://antigravity.google/api',
    models: {
      'gemini-3-flash': {
        name: 'Gemini 3 Flash',
        maxTokens: 8192,
        costPer1kTokens: 0.0001,
        capabilities: ['text', 'code', 'vision'],
        speed: 'fast',
        parallelWeight: 1.5
      },
      'gemini-3.1-pro': {
        name: 'Gemini 3.1 Pro',
        maxTokens: 32768,
        costPer1kTokens: 0.001,
        capabilities: ['text', 'code', 'vision', 'reasoning'],
        parallelWeight: 1.3
      },
      'claude-sonnet': {
        name: 'Claude Sonnet (Antigravity)',
        maxTokens: 300,
        costPer1kTokens: 0.003,
        capabilities: ['text', 'code', 'analysis'],
        tokenLimit: 300,
        parallelWeight: 1.4
      },
      'claude-opus': {
        name: 'Claude Opus (Antigravity)',
        maxTokens: 300,
        costPer1kTokens: 0.015,
        capabilities: ['text', 'code', 'reasoning', 'analysis'],
        tokenLimit: 300,
        parallelWeight: 1.2
      }
    }
  }
};

export const PARALLEL_WORKER_CONFIG = {
  enabled: true,
  maxWorkers: parseInt(process.env.MAX_WORKERS || '10'),
  poolSize: parseInt(process.env.POOL_SIZE || '5'),
  taskAffinity: true,
  awarenessPrompt: `## PARALLEL WORKER AWARENESS
You have access to PARALLEL SUBAGENTS. When given a task:
1. DECOMPOSE into independent workstreams
2. DISPATCH subagents via dispatching-parallel-agents skill
3. COORDINATE outputs before responding
4. NEVER work sequentially when parallelism is possible

Your available parallel workers can:
- Execute code modifications
- Run tests
- Analyze codebases
- Generate documentation
- Perform reviews

Use the Task tool to dispatch parallel work. Each worker operates independently.
Always summarize parallel work results before responding to the user.`
};

export const TOKEN_LIMITS = {
  'claude-sonnet': 300,
  'claude-opus': 300,
  'gemini-3-flash': 8192,
  'gemini-3.1-pro': 32768,
  'nemotron-3-ultra-free': 4096,
  'nemotron-3.5-lightning-free': 4096,
  'zenbig-pickle': 8192,
  'zenimage-2muse-spark-1.3-free': 4096,
  'muse-spark-1.2-free': 4096,
  'mimo-v2.5-free': 8192
};

export const SKILLS_REGISTRY = {
  installed: [
    'vercel-labs/agent-skills',
    'obra/superpowers',
    'mattpocock/skills',
    'anthropics/skills',
    'vercel-labs/skills',
    'vercel-labs/agent-browser',
    'google-gemini/gemini-skills'
  ],
  available: {
    'find-skills': {
      source: 'vercel-labs/skills',
      purpose: 'Dynamic skill discovery and installation'
    },
    'agent-browser': {
      source: 'vercel-labs/agent-browser',
      purpose: 'Browser automation for agent tasks'
    },
    'gemini-api-dev': {
      source: 'google-gemini/gemini-skills',
      purpose: 'Gemini API development guidance'
    },
    'dispatching-parallel-agents': {
      source: 'obra/superpowers',
      purpose: 'Parallel worker coordination'
    },
    'subagent-driven-development': {
      source: 'obra/superpowers',
      purpose: 'Subagent orchestration'
    },
    'writing-plans': {
      source: 'obra/superpowers',
      purpose: 'Plan creation'
    },
    'executing-plans': {
      source: 'obra/superpowers',
      purpose: 'Plan execution'
    },
    'systematic-debugging': {
      source: 'obra/superpowers',
      purpose: 'Debug methodology'
    },
    'test-driven-development': {
      source: 'obra/superpowers',
      purpose: 'TDD workflow'
    },
    'frontend-design': {
      source: 'anthropics/skills',
      purpose: 'UI/UX design guidance'
    },
    'skill-creator': {
      source: 'anthropics/skills',
      purpose: 'Create new skills'
    },
    'to-spec': {
      source: 'mattpocock/skills',
      purpose: 'Spec-driven development'
    },
    'tdd': {
      source: 'mattpocock/skills',
      purpose: 'Test-driven development'
    },
    'code-review': {
      source: 'mattpocock/skills',
      purpose: 'Code review workflows'
    },
    'implement': {
      source: 'mattpocock/skills',
      purpose: 'Implementation guidance'
    }
  }
};
