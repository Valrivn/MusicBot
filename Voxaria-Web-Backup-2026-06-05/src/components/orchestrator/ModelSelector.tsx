import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Zap, Gauge, Check } from 'lucide-react';
import { getModels } from '../../lib/orchestrator-api';
import type { ModelInfo } from '../../lib/orchestrator-api';
interface ModelSelectorProps {
  onSelect: (modelId: string) => void;
}

const CAPABILITY_COLORS: Record<string, string> = {
  code: 'text-neonGreen border-neonGreen/40 bg-neonGreen/10',
  text: 'text-blue-400 border-blue-400/40 bg-blue-400/10',
  vision: 'text-purple-400 border-purple-400/40 bg-purple-400/10',
  reasoning: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10',
  analysis: 'text-pink-400 border-pink-400/40 bg-pink-400/10',
  image: 'text-cyan-400 border-cyan-400/40 bg-cyan-400/10',
};

const PROVIDER_COLORS: Record<string, string> = {
  opencode: 'text-orange-400',
  antigravity: 'text-blue-400',
};

export function ModelSelector({ onSelect }: ModelSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);

  const { data: models = [], isLoading } = useQuery<ModelInfo[]>({
    queryKey: ['orchestrator-models'],
    queryFn: getModels,
    refetchInterval: 15000,
  });

  const providers = Array.from(new Set(models.map(m => m.provider)));
  const filtered = providerFilter
    ? models.filter(m => m.provider === providerFilter)
    : models;

  const handleSelect = (modelId: string) => {
    setSelected(modelId);
    onSelect(modelId);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-surfaceHighlight pb-4">
        <Cpu className="text-neonGreen w-5 h-5" />
        <h2 className="text-lg font-semibold">Model Selector</h2>
      </div>

      {/* Provider filters */}
      <div className="flex gap-2">
        <button
          onClick={() => setProviderFilter(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!providerFilter ? 'bg-neonGreen text-black' : 'bg-surfaceHighlight text-gray-400 hover:text-white'}`}
        >
          All
        </button>
        {providers.map(p => (
          <button
            key={p}
            onClick={() => setProviderFilter(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${providerFilter === p ? 'bg-neonGreen text-black' : 'bg-surfaceHighlight text-gray-400 hover:text-white'}`}
          >
            {p}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading models...</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-2">
          {filtered.map((model) => (
            <button
              key={model.id}
              onClick={() => handleSelect(model.id)}
              className={`p-4 rounded-xl border text-left transition-all duration-200 group ${
                selected === model.id
                  ? 'border-neonGreen bg-neonGreen/10 shadow-[0_0_15px_rgba(57,255,20,0.15)]'
                  : 'border-surfaceHighlight bg-surface hover:border-neonGreen/50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{model.name}</span>
                    {model.health?.healthy === false && (
                      <span className="text-xs text-red-400 border border-red-400/40 bg-red-400/10 px-1.5 py-0.5 rounded">down</span>
                    )}
                    {model.tokenLimit && model.tokenLimit <= 300 && (
                      <span className="text-[10px] text-yellow-400 border border-yellow-400/40 bg-yellow-400/10 px-1.5 py-0.5 rounded">≤300 tok</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`${PROVIDER_COLORS[model.provider] || 'text-gray-400'}`}>
                      {model.provider}
                    </span>
                    <span className="text-gray-500 flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {model.maxTokens.toLocaleString()} max
                    </span>
                    {model.speed === 'fast' && (
                      <span className="text-neonGreen flex items-center gap-0.5">
                        <Gauge className="w-3 h-3" /> fast
                      </span>
                    )}
                  </div>
                </div>

                {selected === model.id && <Check className="text-neonGreen w-5 h-5 shrink-0" />}

                {/* Capabilities */}
                <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[180px]">
                  {model.capabilities.map(cap => (
                    <span
                      key={cap}
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${CAPABILITY_COLORS[cap] || 'text-gray-400 border-gray-400/40'}`}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
