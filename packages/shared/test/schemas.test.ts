import { describe, it, expect } from 'vitest';
import {
  TaskSchema,
  CreateTaskInputSchema,
  TaskPlanSchema,
  AgentDefinitionSchema,
  ApprovalRequestSchema,
  ToolCallSchema,
  MemoryItemSchema,
  EnvConfigSchema
} from '../src/index.js';

describe('@atlas/shared schema tests', () => {
  it('validates a valid task object', () => {
    const validTask = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      parentId: null,
      title: 'Analyze Gym Leads',
      goal: 'Find and score 30 gyms in Palembang',
      assignedAgent: 'chief',
      depth: 0,
      status: 'queued',
      priority: 'normal',
      context: {},
      plan: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    const parsed = TaskSchema.parse(validTask);
    expect(parsed.assignedAgent).toBe('chief');
    expect(parsed.depth).toBe(0);
  });

  it('rejects a task with depth exceeding max (depth > 2)', () => {
    const invalidTask = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Deep subtask',
      goal: 'Too deep',
      assignedAgent: 'ned',
      depth: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    expect(() => TaskSchema.parse(invalidTask)).toThrow();
  });

  it('validates a structured plan', () => {
    const validPlan = {
      goal: 'Find gyms',
      assumptions: [],
      questions: [],
      steps: [
        {
          id: 'step_1',
          agent: 'ned',
          objective: 'Research 30 gym locations',
          depends_on: [],
          parallelizable: true,
          expected_artifact: 'gyms.json'
        }
      ],
      approval_points: [],
      estimated_cost_usd: 0.25
    };

    const parsed = TaskPlanSchema.parse(validPlan);
    expect(parsed.steps.length).toBe(1);
    expect(parsed.steps[0]?.agent).toBe('ned');
  });

  it('validates an agent definition', () => {
    const chief = {
      id: 'chief',
      name: 'Chief',
      role: 'orchestrator',
      version: 1,
      description: 'Root Orchestrator',
      systemPrompt: 'You are Chief...',
      limits: {
        maxTurns: 10,
        maxDelegationDepth: 2,
        timeoutSeconds: 180,
        maxCostUsd: 1.0
      },
      permissions: {
        tools: ['tasks.create_child', 'memory.search'],
        dataScopes: ['global'],
        externalWrites: false
      }
    };

    const parsed = AgentDefinitionSchema.parse(chief);
    expect(parsed.id).toBe('chief');
    expect(parsed.role).toBe('orchestrator');
  });

  it('validates environment config defaults', () => {
    const env = EnvConfigSchema.parse({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.MAX_DELEGATION_DEPTH).toBe(2);
    expect(env.EXTERNAL_WRITES_ENABLED).toBe(false);
  });

  it('requires an API auth token in production', () => {
    expect(() => EnvConfigSchema.parse({ NODE_ENV: 'production' })).toThrow('API_AUTH_TOKEN');
  });

  it('accepts a production configuration with an explicit auth token', () => {
    const token = 'a'.repeat(32);
    const env = EnvConfigSchema.parse({ NODE_ENV: 'production', API_AUTH_TOKEN: token });

    expect(env.API_AUTH_TOKEN).toBe(token);
    expect(env.CORS_ALLOWED_ORIGINS).toBe('http://localhost:3000');
  });
});
