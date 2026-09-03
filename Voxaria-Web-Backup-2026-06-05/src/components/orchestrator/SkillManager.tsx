import { useQuery } from '@tanstack/react-query';
import { Package, Download, CheckCircle2 } from 'lucide-react';

interface SkillsData {
  installed: string[];
  available: Record<string, { source: string; purpose: string }>;
}

type SkillsResponse = SkillsData;

const ORCHESTRATOR_BASE_URL = 'http://localhost:3001';

async function getSkills(): Promise<SkillsResponse> {
  const response = await fetch(`${ORCHESTRATOR_BASE_URL}/api/skills`);
  if (!response.ok) {
    throw new Error(`Error fetching skills: ${response.statusText}`);
  }
  return response.json();
}

export function SkillManager() {
  const { data, isLoading } = useQuery({
    queryKey: ['orchestrator-skills'],
    queryFn: getSkills,
    refetchInterval: 30000,
  });

  const skills = (data as SkillsResponse | undefined) || { installed: [], available: {} };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-surfaceHighlight pb-4">
        <Package className="text-neonGreen w-5 h-5" />
        <h2 className="text-lg font-semibold">Skills Registry</h2>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-neonGreen" /> Installed Packs ({skills.installed.length})
        </h3>
        <div className="flex flex-col gap-2">
          {skills.installed.map((pack) => (
            <div key={pack} className="p-3 rounded-xl border border-neonGreen/40 bg-neonGreen/5 flex items-center justify-between">
              <span className="font-mono text-sm">{pack}</span>
              <span className="text-[10px] text-neonGreen border border-neonGreen/40 px-1.5 py-0.5 rounded">installed</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Available Skills ({Object.keys(skills.available).length})</h3>
        {isLoading ? (
          <div className="text-sm text-gray-500 py-4 text-center">Loading skills...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
            {Object.entries(skills.available).map(([name, skill]) => (
              <div key={name} className="p-3 rounded-xl border border-surfaceHighlight bg-surface">
                <div className="flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-gray-500" />
                  <span className="font-mono text-sm text-neonGreen">{name}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{skill.purpose}</div>
                <div className="text-[10px] text-gray-500 mt-1.5 font-mono">source: {skill.source}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
