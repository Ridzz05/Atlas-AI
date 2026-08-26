import { describe, expect, it } from 'vitest';
import { defaultAgentRegistry } from '@atlas/agents';
import { PlanValidator } from '../src/index.js';

describe('PlanValidator', () => {
  it('accepts a dependency-ordered plan using registered agents', () => {
    const result = PlanValidator.validate(
      {
        goal: 'Research and verify',
        steps: [
          { id: 'research', agent: 'ned', objective: 'Gather sources', depends_on: [] },
          { id: 'verify', agent: 'argus', objective: 'Verify sources', depends_on: ['research'] }
        ],
        approval_points: [],
        estimated_cost_usd: 0.2
      },
      { registry: defaultAgentRegistry }
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown agents, duplicate step IDs, missing dependencies, and cycles', () => {
    const result = PlanValidator.validate(
      {
        goal: 'Invalid plan',
        steps: [
          { id: 'same', agent: 'unknown', objective: 'One', depends_on: ['missing'] },
          { id: 'same', agent: 'ned', objective: 'Two', depends_on: ['same'] }
        ],
        approval_points: [],
        estimated_cost_usd: 0.2
      },
      { registry: defaultAgentRegistry }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Step 'same' uses unknown agent 'unknown'.",
        "Duplicate plan step id 'same'.",
        "Step 'same' depends on unknown step 'missing'.",
        'Plan dependency cycle detected.'
      ])
    );
  });

  it('rejects plans exceeding the configured step and cost limits', () => {
    const result = PlanValidator.validate(
      {
        goal: 'Too large',
        steps: Array.from({ length: 9 }, (_, index) => ({
          id: `step-${index}`,
          agent: 'ned',
          objective: 'Work',
          depends_on: []
        })),
        approval_points: [],
        estimated_cost_usd: 5
      },
      { registry: defaultAgentRegistry, maxSteps: 8, maxEstimatedCostUsd: 1 }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['Plan contains 9 steps; maximum is 8.', 'Plan estimated cost $5.0000 exceeds maximum $1.0000.'])
    );
  });

  it('rejects malformed plans without throwing', () => {
    const result = PlanValidator.validate({ goal: 'Missing steps' }, { registry: defaultAgentRegistry });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Plan schema validation failed:');
  });
});
