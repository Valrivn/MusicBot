import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Workflow, CircleDot, Loader2, CheckCircle2, Cpu } from 'lucide-react';
import { getMetrics, subscribeToEvents } from '../../lib/orchestrator-api';

interface SubTaskEvent {
  event?: string;
  data?: {
    subtaskId?: string;
    workerId?: string;
    taskId?: string;
    duration?: number;
    status?: string;
  };
}

interface WorkerState {
  id: string;
  status: string;
  currentTask: string | null;
  tasksCompleted: number;
}

interface MetricsData {
  parallelCoordinator?: {
    workers?: {
      total: number;
      idle: number;
      busy: number;
      tasksCompleted: number;
      avgLatency: number;
    };
    runningTasks: number;
    completedTasks: number;
  };
  modelRouter?: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
  };
}

export function ParallelWorkerMonitor() {
  const [liveEvents, setLiveEvents] = useState<SubTaskEvent[]>([]);
  const [workers, setWorkers] = useState<Record<string, WorkerState>>({});

  const { data: metrics, isLoading } = useQuery<unknown>({
    queryKey: ['orchestrator-metrics'],
    queryFn: getMetrics,
    refetchInterval: 3000,
  });

  const m = (metrics as MetricsData) || {};

  useEffect(() => {
    const unsubscribe = subscribeToEvents((raw) => {
      const event = raw as SubTaskEvent;
      setLiveEvents((prev) => [event, ...prev].slice(0, 20));

      if (event.event === 'subtask-assigned' && event.data?.workerId && event.data?.subtaskId) {
        setWorkers((prev) => ({
          ...prev,
          [event.data!.workerId!]: {
            id: event.data!.workerId!,
            status: 'busy',
            currentTask: event.data!.subtaskId!,
            tasksCompleted: prev[event.data!.workerId!]?.tasksCompleted || 0,
          },
        }));
      }

      if (event.event === 'subtask-completed' && event.data?.workerId) {
        setWorkers((prev) => ({
          ...prev,
          [event.data!.workerId!]: {
            id: event.data!.workerId!,
            status: 'idle',
            currentTask: null,
            tasksCompleted: (prev[event.data!.workerId!]?.tasksCompleted || 0) + 1,
          },
        }));
      }
    });
    return unsubscribe;
  }, []);

  const workerStats = m.parallelCoordinator?.workers;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b border-surfaceHighlight pb-4">
        <Workflow className="text-neonGreen w-5 h-5" />
        <h2 className="text-lg font-semibold">Parallel Workers</h2>
      </div>

      {/* Worker pool stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: workerStats?.total ?? 0, color: 'text-white' },
          { label: 'Idle', value: workerStats?.idle ?? 0, color: 'text-blue-400' },
          { label: 'Busy', value: workerStats?.busy ?? 0, color: 'text-neonGreen' },
          { label: 'Completed', value: workerStats?.tasksCompleted ?? 0, color: 'text-yellow-400' },
        ].map((s) => (
          <div key={s.label} className="glass-panel p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Worker breakdown */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Worker Pool</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.values(workers).map((w) => (
            <div
              key={w.id}
              className={`p-3 rounded-xl border ${
                w.status === 'busy'
                  ? 'border-neonGreen/50 bg-neonGreen/5'
                  : 'border-surfaceHighlight bg-surface'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-gray-400">{w.id.replace('worker-', 'w-').slice(0, 8)}</span>
                {w.status === 'busy' ? (
                  <Loader2 className="w-4 h-4 text-neonGreen animate-spin" />
                ) : (
                  <CircleDot className="w-4 h-4 text-blue-400" />
                )}
              </div>
              <div className="flex justify-between mt-2 text-xs">
                <span className="text-gray-500">tasks</span>
                <span className="text-neonGreen">{w.tasksCompleted}</span>
              </div>
            </div>
          ))}
          {Object.values(workers).length === 0 && (
            <div className="col-span-full text-sm text-gray-500 py-6 text-center flex items-center justify-center gap-2">
              <Cpu className="w-4 h-4" /> {isLoading ? 'Loading worker pool...' : 'No active workers yet. Dispatch a parallel task.'}
            </div>
          )}
        </div>
      </div>

      {/* Live event log */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Live Activity</h3>
        <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
          {liveEvents.length === 0 && (
            <div className="text-sm text-gray-500 py-4 text-center">Waiting for parallel task events...</div>
          )}
          {liveEvents.map((evt, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-neonGreen shrink-0" />
              <span className="text-neonGreen">{evt.event}</span>
              <span className="text-gray-500">
                {evt.data?.subtaskId && <>sub: {evt.data.subtaskId} </>}
                {evt.data?.workerId && <>worker: {evt.data.workerId.slice(0, 8)}</>}
                {evt.data?.duration && <>({evt.data.duration}ms)</>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
