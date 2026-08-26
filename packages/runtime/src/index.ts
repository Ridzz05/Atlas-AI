import * as path from 'node:path';
import { AgentRegistry, defaultAgentRegistry } from '@atlas/agents';
import {
  DatabaseClient,
  Migrator,
  ApprovalRepository,
  TelegramStateRepository,
  RunRepository,
  seedAgents,
  TaskRepository
} from '@atlas/database';
import { EventBus, PostgresEventBus } from '@atlas/events';
import { BullMqTaskQueue, TaskQueue } from '@atlas/orchestration';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { AgentDefinition, EnvConfig } from '@atlas/shared';

export interface AtlasRuntime {
  db: DatabaseClient;
  taskRepo: TaskRepository;
  runRepo: RunRepository;
  approvalRepo: ApprovalRepository;
  telegramStateRepo: TelegramStateRepository;
  taskQueue: TaskQueue;
  eventBus: EventBus;
  provider: ModelProvider;
  registry: AgentRegistry;
  close(): Promise<void>;
}

export interface AtlasRuntimeOptions {
  db?: DatabaseClient;
  taskQueue?: TaskQueue;
  eventBus?: EventBus;
  provider?: ModelProvider;
  registry?: AgentRegistry;
  migrationsDir?: string;
  migrate?: boolean;
  seed?: boolean;
}

export async function createAtlasRuntime(
  config: EnvConfig,
  options: AtlasRuntimeOptions = {}
): Promise<AtlasRuntime> {
  const db = options.db || new DatabaseClient({ connectionString: config.DATABASE_URL });
  const registry = options.registry || defaultAgentRegistry;

  if (options.migrate !== false) {
    const migrationsDir = options.migrationsDir || path.resolve(process.cwd(), 'packages/database/src/migrations');
    await new Migrator(db).runMigrations(migrationsDir);
  }

  if (options.seed !== false) {
    await seedAgents(db, registry.list());
  }

  const taskQueue = options.taskQueue || new BullMqTaskQueue({ redisUrl: config.REDIS_URL });
  const eventBus = options.eventBus || new PostgresEventBus(db);
  const provider = options.provider || createModelProvider({
    providerType: config.MODEL_PROVIDER,
    apiKey: config.MODEL_API_KEY
  });

  const taskRepo = new TaskRepository(db);
  const runRepo = new RunRepository(db);
  const approvalRepo = new ApprovalRepository(db, config.ENCRYPTION_KEY);
  const telegramStateRepo = new TelegramStateRepository(db);

  return {
    db,
    taskRepo,
    runRepo,
    approvalRepo,
    telegramStateRepo,
    taskQueue,
    eventBus,
    provider,
    registry,
    async close() {
      await taskQueue.close();
      if ('close' in eventBus && typeof eventBus.close === 'function') {
        await eventBus.close();
      }
      await db.close();
    }
  };
}

export function agentDefinitions(registry: AgentRegistry = defaultAgentRegistry): AgentDefinition[] {
  return registry.list();
}
