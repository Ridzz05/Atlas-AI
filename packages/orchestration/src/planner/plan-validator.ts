import { TaskPlan, TaskPlanSchema } from '@atlas/shared';
import { AgentRegistry } from '@atlas/agents';

export interface PlanValidationOptions {
  registry?: AgentRegistry;
  maxSteps?: number;
  maxEstimatedCostUsd?: number;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

export class PlanValidator {
  public static validate(plan: unknown, options: PlanValidationOptions = {}): PlanValidationResult {
    const parsed = TaskPlanSchema.safeParse(plan);
    if (!parsed.success) {
      return {
        valid: false,
        errors: [`Plan schema validation failed: ${parsed.error.message}`]
      };
    }

    const value = parsed.data;
    const maxSteps = options.maxSteps ?? 8;
    const maxEstimatedCostUsd = options.maxEstimatedCostUsd ?? Number.POSITIVE_INFINITY;
    const errors: string[] = [];

    if (value.steps.length > maxSteps) {
      errors.push(`Plan contains ${value.steps.length} steps; maximum is ${maxSteps}.`);
    }

    if (value.estimated_cost_usd > maxEstimatedCostUsd) {
      errors.push(
        `Plan estimated cost $${value.estimated_cost_usd.toFixed(4)} exceeds maximum $${maxEstimatedCostUsd.toFixed(4)}.`
      );
    }

    const stepIds = new Set<string>();
    for (const step of value.steps) {
      if (stepIds.has(step.id)) {
        errors.push(`Duplicate plan step id '${step.id}'.`);
      }
      stepIds.add(step.id);

      if (options.registry && !options.registry.has(step.agent)) {
        errors.push(`Step '${step.id}' uses unknown agent '${step.agent}'.`);
      }
    }

    const knownStepIds = new Set(value.steps.map(step => step.id));
    for (const step of value.steps) {
      for (const dependency of step.depends_on) {
        if (!knownStepIds.has(dependency)) {
          errors.push(`Step '${step.id}' depends on unknown step '${dependency}'.`);
        }
      }
    }

    if (this.hasCycle(value)) {
      errors.push('Plan dependency cycle detected.');
    }

    return { valid: errors.length === 0, errors };
  }

  public static assertValid(plan: TaskPlan, options: PlanValidationOptions = {}): TaskPlan {
    const result = this.validate(plan, options);
    if (!result.valid) {
      throw new Error(`Invalid task plan: ${result.errors.join(' ')}`);
    }
    return plan;
  }

  private static hasCycle(plan: TaskPlan): boolean {
    const dependencies = new Map(plan.steps.map(step => [step.id, step.depends_on]));
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (stepId: string): boolean => {
      if (visiting.has(stepId)) return true;
      if (visited.has(stepId)) return false;

      visiting.add(stepId);
      for (const dependency of dependencies.get(stepId) || []) {
        if (dependencies.has(dependency) && visit(dependency)) return true;
      }
      visiting.delete(stepId);
      visited.add(stepId);
      return false;
    };

    return plan.steps.some(step => visit(step.id));
  }
}
