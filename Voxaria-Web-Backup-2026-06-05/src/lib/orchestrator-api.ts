export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  maxTokens: number;
  costPer1kTokens: number;
  capabilities: string[];
  speed?: string;
  tokenLimit?: number;
  parallelWeight?: number;
  health: {
    healthy: boolean;
    lastCheck: number;
    errorCount: number;
    successCount: number;
  };
}

export interface DispatchResult {
  taskId: string;
  status: string;
  subtasks: Array<{
    subtaskId: string;
    workerId?: string;
    status: string;
    position?: number;
  }>;
  awarenessPrompt: string;
}

const ORCHESTRATOR_BASE_URL = 'http://localhost:3001';

export async function getModels(): Promise<ModelInfo[]> {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/models`);
  if (!response.ok) {
    throw new Error(`Error fetching models: ${response.statusText}`);
  }
  return response.json();
}

export async function getTokenLimits(): Promise<Record<string, number>> {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/token-limits`);
  if (!response.ok) {
    throw new Error(`Error fetching token limits: ${response.statusText}`);
  }
  return response.json();
}

export async function getTokenUsage(): Promise<Record<string, unknown>> {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/token-usage`);
  if (!response.ok) {
    throw new Error(`Error fetching token usage: ${response.statusText}`);
  }
  return response.json();
}

export async function getMetrics() {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/metrics`);
  if (!response.ok) {
    throw new Error(`Error fetching metrics: ${response.statusText}`);
  }
  return response.json();
}

export async function getWorkerAwareness() {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/worker-awareness`);
  if (!response.ok) {
    throw new Error(`Error fetching worker awareness: ${response.statusText}`);
  }
  return response.json();
}

export async function dispatchTask(subtasks: Array<{ capability: string; [key: string]: unknown }>): Promise<DispatchResult> {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ subtasks })
  });
  if (!response.ok) {
    throw new Error(`Error dispatching task: ${response.statusText}`);
  }
  return response.json();
}

export function subscribeToEvents(onEvent: (data: unknown) => void): () => void {
  const ws = new WebSocket(`ws://localhost:3001/ws`);
  ws.onmessage = (event) => {
    onEvent(JSON.parse(event.data));
  };
  return () => ws.close();
}
