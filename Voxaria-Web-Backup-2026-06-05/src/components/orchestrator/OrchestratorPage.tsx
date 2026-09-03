import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, FlaskConical } from 'lucide-react';
import { ModelSelector } from './ModelSelector';
import { ParallelWorkerMonitor } from './ParallelWorkerMonitor';
import { SkillManager } from './SkillManager';
import { getTokenLimits, dispatchTask } from '../../lib/orchestrator-api';

export function OrchestratorPage() {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [dispatchMessage, setDispatchMessage] = useState<string>('');

  const { data: tokenLimits = {} } = useQuery<Record<string, number>>({
    queryKey: ['orchestrator-token-limits'],
    queryFn: getTokenLimits,
    refetchInterval: 10000,
  });

  const handleDispatch = async () => {
    try {
      const result = await dispatchTask([
        { capability: 'code' },
        { capability: 'analysis' },
        { capability: 'text' },
      ]);
      setDispatchMessage(`Dispatched ${result.subtasks.length} subtasks -> ${result.taskId.slice(0, 8)}`);
    } catch (error) {
      setDispatchMessage(`Dispatch failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
      {/* Left: model selector + token budget */}
      <div className="lg:col-span-1">
        <div className="glass-panel p-6 flex flex-col gap-4 h-full">
          <ModelSelector onSelect={setSelectedModel} />

          {/* Token budget */}
          <div className="border-t border-surfaceHighlight pt-4 mt-2">
            <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" /> Token Budgets
            </h3>
            <div className="flex flex-col gap-1.5">
              {Object.entries(tokenLimits)
                .filter(([, limit]) => limit <= 300)
                .map(([model, limit]) => (
                  <div key={model} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-gray-400">{model}</span>
                    <span className="text-yellow-400 font-mono">≤ {limit} tok</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Dispatch control */}
          <div className="border-t border-surfaceHighlight pt-4 mt-auto">
            <p className="text-xs text-gray-500 mb-3">
              Selected model: <span className="text-neonGreen">{selectedModel || 'none'}</span>
            </p>
            <button
              onClick={handleDispatch}
              className="w-full py-3 px-4 rounded-xl bg-surfaceHighlight hover:bg-neonGreen hover:text-black border border-neonGreen/20 transition-all duration-300 flex items-center justify-center gap-2 font-medium"
            >
              <FlaskConical className="w-4 h-4" /> Run Parallel Dispatch Test
            </button>
            {dispatchMessage && (
              <p className="text-xs text-center mt-2 text-gray-400">{dispatchMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Right: workers + skills */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        <div className="glass-panel p-6">
          <ParallelWorkerMonitor />
        </div>

        <div className="glass-panel p-6">
          <SkillManager />
        </div>
      </div>
    </div>
  );
}
