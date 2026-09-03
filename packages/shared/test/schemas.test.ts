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
    expect(env.MODEL_PROVIDER).toBe('openrouter');
    expect(env.WORKER_HEALTH_PORT).toBe(8081);
    expect(env.TELEGRAM_HEALTH_PORT).toBe(8082);
    expect(env.MAX_DELEGATION_DEPTH).toBe(2);
    expect(env.EXTERNAL_WRITES_ENABLED).toBe(false);
    expect(env.MEMORY_MAINTENANCE_INTERVAL_SECONDS).toBe(3600);
    expect(env.MEMORY_DELETION_GRACE_DAYS).toBe(7);
  });

  it('treats blank optional secrets as unset values', () => {
    const env = EnvConfigSchema.parse({ API_AUTH_TOKEN: '', ENCRYPTION_KEY: '' });

    expect(env.API_AUTH_TOKEN).toBeUndefined();
    expect(env.ENCRYPTION_KEY).toHaveLength(64);
  });

  it('parses separate native health ports for worker and Telegram', () => {
    expect(
      EnvConfigSchema.parse({
        WORKER_HEALTH_PORT: '18081',
        TELEGRAM_HEALTH_PORT: '18082'
      })
    ).toMatchObject({ WORKER_HEALTH_PORT: 18081, TELEGRAM_HEALTH_PORT: 18082 });
  });

  it('parses the external writes environment flag strictly and fail-closed', () => {
    expect(EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: 'false' }).EXTERNAL_WRITES_ENABLED).toBe(false);
    expect(EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: 'true' }).EXTERNAL_WRITES_ENABLED).toBe(true);
    expect(EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: '' }).EXTERNAL_WRITES_ENABLED).toBe(false);
    expect(() => EnvConfigSchema.parse({ EXTERNAL_WRITES_ENABLED: 'yes' })).toThrow('EXTERNAL_WRITES_ENABLED');
  });

  it('requires an API auth token in production', () => {
    expect(() => EnvConfigSchema.parse({ NODE_ENV: 'production' })).toThrow('API_AUTH_TOKEN');
  });

  it('accepts a production configuration with an explicit auth token', () => {
    const token = 'a'.repeat(32);
    const env = EnvConfigSchema.parse({
      NODE_ENV: 'production',
      API_AUTH_TOKEN: token,
      ENCRYPTION_KEY: 'b'.repeat(64),
      MODEL_PROVIDER: 'openai',
      MODEL_API_KEY: 'test-model-key'
    });

    expect(env.API_AUTH_TOKEN).toBe(token);
    expect(env.CORS_ALLOWED_ORIGINS).toBe('http://localhost:3000');
  });

  it('allows production OpenRouter to receive its key through the authenticated Settings flow', () => {
    expect(() =>
      EnvConfigSchema.parse({
        NODE_ENV: 'production',
        API_AUTH_TOKEN: 'a'.repeat(32),
        ENCRYPTION_KEY: 'b'.repeat(64),
        MODEL_PROVIDER: 'openrouter',
        MODEL_NAME: 'z-ai/glm-5.2:free'
      })
    ).not.toThrow();
  });

  it('rejects the development encryption key and mock provider in production', () => {
    const token = 'a'.repeat(32);
    expect(() =>
      EnvConfigSchema.parse({
        NODE_ENV: 'production',
        API_AUTH_TOKEN: token,
        MODEL_PROVIDER: 'openai',
        MODEL_API_KEY: 'test-model-key'
      })
    ).toThrow('ENCRYPTION_KEY');

    expect(() =>
      EnvConfigSchema.parse({
        NODE_ENV: 'production',
        API_AUTH_TOKEN: token,
        ENCRYPTION_KEY: 'b'.repeat(64),
        MODEL_PROVIDER: 'mock'
      })
    ).toThrow('MODEL_PROVIDER');
  });

  it('rejects an unsupported model provider', () => {
    expect(() => EnvConfigSchema.parse({ MODEL_PROVIDER: 'typo-provider' })).toThrow('MODEL_PROVIDER');
  });

  it('requires provider-specific model configuration in production', () => {
    const base = {
      NODE_ENV: 'production',
      API_AUTH_TOKEN: 'a'.repeat(32),
      ENCRYPTION_KEY: 'b'.repeat(64),
      MODEL_PROVIDER: 'groq',
      MODEL_API_KEY: 'test-model-key'
    };

    expect(() => EnvConfigSchema.parse(base)).toThrow('MODEL_NAME');
    expect(() => EnvConfigSchema.parse({ ...base, MODEL_NAME: 'llama-model' })).not.toThrow();
    expect(() =>
      EnvConfigSchema.parse({
        ...base,
        MODEL_NAME: 'llama-model',
        MODEL_API_KEY: undefined
      })
    ).toThrow('MODEL_API_KEY');
  });

  it('defaults research to fail-closed and requires a key for Brave', () => {
    expect(EnvConfigSchema.parse({}).RESEARCH_PROVIDER).toBe('none');
    expect(() => EnvConfigSchema.parse({ RESEARCH_PROVIDER: 'brave' })).toThrow('RESEARCH_API_KEY');
    expect(
      EnvConfigSchema.parse({
        RESEARCH_PROVIDER: 'brave',
        RESEARCH_API_KEY: 'test-research-key'
      })
    ).toMatchObject({ RESEARCH_PROVIDER: 'brave', RESEARCH_COUNTRY: 'ID', RESEARCH_SEARCH_LANG: 'id' });
  });

  it('rejects unsupported research providers', () => {
    expect(() => EnvConfigSchema.parse({ RESEARCH_PROVIDER: 'unsupported' })).toThrow('RESEARCH_PROVIDER');
  });
});
