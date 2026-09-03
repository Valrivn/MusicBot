import EventEmitter from 'eventemitter3';
import { PARALLEL_WORKER_CONFIG } from '../config/models.js';
import { v4 as uuidv4 } from 'uuid';

export class ParallelCoordinator extends EventEmitter {
  constructor() {
    super();
    this.workers = new Map();
    this.tasks = new Map();
    this.results = new Map();
    this.config = PARALLEL_WORKER_CONFIG;
    this.maxWorkers = this.config.maxWorkers;
    this.activeWorkers = 0;
    this.taskQueue = [];
    this._initializeWorkerPool();
  }

  _initializeWorkerPool() {
    for (let i = 0; i < this.config.poolSize; i++) {
      const workerId = `worker-${uuidv4().slice(0, 8)}`;
      this.workers.set(workerId, {
        id: workerId,
        status: 'idle',
        currentTask: null,
        capabilities: ['text', 'code', 'analysis'],
        tasksCompleted: 0,
        avgLatency: 0,
        createdAt: Date.now()
      });
    }
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }

  getIdleWorkers() {
    return Array.from(this.workers.values()).filter(w => w.status === 'idle');
  }

  getWorkerStats() {
    const workers = Array.from(this.workers.values());
    return {
      total: workers.length,
      idle: workers.filter(w => w.status === 'idle').length,
      busy: workers.filter(w => w.status === 'busy').length,
      tasksCompleted: workers.reduce((sum, w) => sum + w.tasksCompleted, 0),
      avgLatency: workers.reduce((sum, w) => sum + w.avgLatency, 0) / workers.length || 0
    };
  }

  async dispatchParallel(taskDefinition) {
    const taskId = uuidv4();
    const { subtasks, coordinationStrategy = 'gather' } = taskDefinition;

    if (!subtasks || subtasks.length === 0) {
      throw new Error('No subtasks provided for parallel dispatch');
    }

    const task = {
      id: taskId,
      subtasks: subtasks.map((st, idx) => ({
        id: `${taskId}-sub-${idx}`,
        ...st,
        status: 'pending',
        workerId: null,
        result: null,
        startTime: null,
        endTime: null
      })),
      coordinationStrategy,
      status: 'dispatching',
      createdAt: Date.now(),
      completedAt: null
    };

    this.tasks.set(taskId, task);
    this.emit('task:created', { taskId, subtaskCount: subtasks.length });

    const dispatchResults = await this._dispatchSubtasks(task);

    return {
      taskId,
      status: 'dispatched',
      subtasks: dispatchResults,
      awarenessPrompt: this.config.awarenessPrompt
    };
  }

  async _dispatchSubtasks(task) {
    const results = [];

    for (const subtask of task.subtasks) {
      const worker = this._assignWorker(subtask);
      if (worker) {
        subtask.workerId = worker.id;
        subtask.status = 'assigned';
        subtask.startTime = Date.now();
        worker.status = 'busy';
        worker.currentTask = subtask.id;

        this.emit('subtask:assigned', {
          taskId: task.id,
          subtaskId: subtask.id,
          workerId: worker.id
        });

        results.push({
          subtaskId: subtask.id,
          workerId: worker.id,
          status: 'assigned'
        });
      } else {
        this.taskQueue.push({ task, subtask });
        results.push({
          subtaskId: subtask.id,
          status: 'queued',
          position: this.taskQueue.length
        });
      }
    }

    task.status = 'running';
    return results;
  }

  _assignWorker(subtask) {
    const idleWorkers = this.getIdleWorkers();
    if (idleWorkers.length === 0) return null;

    if (this.config.taskAffinity) {
      const matchingWorker = idleWorkers.find(w =>
        subtask.capability
          ? w.capabilities.includes(subtask.capability)
          : true
      );
      if (matchingWorker) return matchingWorker;
    }

    return idleWorkers[0];
  }

  completeSubtask(subtaskId, result) {
    for (const [taskId, task] of this.tasks) {
      const subtask = task.subtasks.find(st => st.id === subtaskId);
      if (subtask) {
        subtask.status = 'completed';
        subtask.result = result;
        subtask.endTime = Date.now();

        const worker = this.workers.get(subtask.workerId);
        if (worker) {
          worker.status = 'idle';
          worker.currentTask = null;
          worker.tasksCompleted++;
          worker.avgLatency = (worker.avgLatency + (subtask.endTime - subtask.startTime)) / 2;
        }

        this.emit('subtask:completed', {
          taskId,
          subtaskId,
          workerId: subtask.workerId,
          duration: subtask.endTime - subtask.startTime
        });

        this._processQueue();
        this._checkTaskCompletion(taskId);

        return { taskId, subtask };
      }
    }
    return null;
  }

  _processQueue() {
    while (this.taskQueue.length > 0) {
      const idleWorkers = this.getIdleWorkers();
      if (idleWorkers.length === 0) break;

      const { task, subtask } = this.taskQueue.shift();
      const worker = this._assignWorker(subtask);
      if (worker) {
        subtask.workerId = worker.id;
        subtask.status = 'assigned';
        subtask.startTime = Date.now();
        worker.status = 'busy';
        worker.currentTask = subtask.id;

        this.emit('subtask:assigned', {
          taskId: task.id,
          subtaskId: subtask.id,
          workerId: worker.id
        });
      }
    }
  }

  _checkTaskCompletion(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const allCompleted = task.subtasks.every(st => st.status === 'completed');
    if (allCompleted) {
      task.status = 'completed';
      task.completedAt = Date.now();

      const results = task.subtasks.map(st => ({
        subtaskId: st.id,
        result: st.result,
        duration: st.endTime - st.startTime
      }));

      this.results.set(taskId, {
        taskId,
        strategy: task.coordinationStrategy,
        results,
        totalDuration: task.completedAt - task.createdAt
      });

      this.emit('task:completed', {
        taskId,
        duration: task.completedAt - task.createdAt,
        subtaskCount: task.subtasks.length
      });
    }
  }

  getTaskResult(taskId) {
    return this.results.get(taskId) || this.tasks.get(taskId);
  }

  getMetrics() {
    const tasks = Array.from(this.tasks.values());
    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      runningTasks: tasks.filter(t => t.status === 'running').length,
      queuedSubtasks: this.taskQueue.length,
      workers: this.getWorkerStats(),
      avgTaskDuration: tasks
        .filter(t => t.completedAt)
        .reduce((sum, t) => sum + (t.completedAt - t.createdAt), 0) /
        (tasks.filter(t => t.completedAt).length || 1)
    };
  }

  getAwarenessPrompt() {
    return this.config.awarenessPrompt;
  }
}

export default new ParallelCoordinator();
