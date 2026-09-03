import { exec } from 'child_process';
import { promisify } from 'util';
import { SKILLS_REGISTRY } from '../config/models.js';

const execAsync = promisify(exec);

export class SkillExecutor {
  constructor() {
    this.skills = SKILLS_REGISTRY;
    this.executions = new Map();
  }

  async installSkill(source) {
    const { stdout, stderr } = await execAsync(`npx skills add ${source} -y`);
    return {
      source,
      installed: !stderr.includes('error'),
      output: stdout
    };
  }

  async execute(skillName, context) {
    const skill = this._findSkill(skillName);
    if (!skill) {
      throw new Error(`Skill ${skillName} not found`);
    }

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.executions.set(executionId, {
      id: executionId,
      skill: skillName,
      context,
      startedAt: Date.now(),
      status: 'running'
    });

    try {
      switch (skillName) {
        case 'dispatching-parallel-agents':
          return await this._dispatch(context);
        case 'writing-plans':
          return this._writePlan(context);
        case 'executing-plans':
          return this._executePlan(context);
        case 'systematic-debugging':
          return this._debug(context);
        default:
          return this._genericExecute(skill, context);
      }
    } finally {
      const execution = this.executions.get(executionId);
      if (execution) {
        execution.status = 'completed';
        execution.completedAt = Date.now();
      }
    }
  }

  _findSkill(name) {
    if (this.skills.available[name]) return this.skills.available[name];
    return null;
  }

  async _dispatch(context) {
    return {
      status: 'ready',
      workers: context.workers || [],
      prompt: 'Dispatching parallel workers with task decomposition...'
    };
  }

  _writePlan(context) {
    return {
      status: 'planned',
      steps: context.steps || [],
      dependencies: context.dependencies || []
    };
  }

  _executePlan(context) {
    return {
      status: 'executing',
      currentStep: context.currentStep,
      remainingSteps: context.remainingSteps || []
    };
  }

  _debug(context) {
    return {
      status: 'debugging',
      hypothesis: context.hypothesis,
      tests: context.tests || []
    };
  }

  _genericExecute(skill, context) {
    return {
      status: 'executed',
      skill: skill.name,
      purpose: skill.purpose,
      source: skill.source,
      context
    };
  }

  getExecution(id) {
    return this.executions.get(id);
  }

  getExecutions() {
    return Array.from(this.executions.values());
  }
}

export default new SkillExecutor();
