import * as path from 'node:path';
import { AgentRegistry, defaultAgentRegistry } from '@atlas/agents';
import {
  DatabaseClient,
  Migrator,
  ApprovalRepository,
  ArtifactRepository,
  AuditRepository,
  SystemEventRepository,
  TelegramStateRepository,
  RunRepository,
  MessageRepository,
  ToolCallRepository,
  BudgetRepository,
  LeadRubricRepository,
  seedAgents,
  TaskRepository
} from '@atlas/database';
import { DatabaseMemoryStore } from '@atlas/memory';
import { EventBus, PostgresEventBus } from '@atlas/events';
import { BullMqTaskQueue, TaskQueue } from '@atlas/orchestration';
import { createModelProvider, ModelProvider } from '@atlas/providers';
import { AgentDefinition, EnvConfig } from '@atlas/shared';
import { DEFAULT_LEAD_RUBRIC, LeadRubricDefinitionSchema, RubricEngine } from '@atlas/tools';

export * from './health.js';

export interface AtlasRuntime {
  db: DatabaseClient;
  taskRepo: TaskRepository;
  runRepo: RunRepository;
  approvalRepo: ApprovalRepository;
  artifactRepo: ArtifactRepository;
  auditRepo: AuditRepository;
  memoryStore: DatabaseMemoryStore;
  eventRepo: SystemEventRepository;
  telegramStateRepo: TelegramStateRepository;
  messageRepo: MessageRepository;
  toolCallRepo: ToolCallRepository;
  budgetRepo: BudgetRepository;
  rubricRepo: LeadRubricRepository;
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
    apiKey: config.MODEL_API_KEY,
    baseUrl: config.MODEL_BASE_URL,
    model: config.MODEL_NAME
  });

  const taskRepo = new TaskRepository(db);
  const runRepo = new RunRepository(db);
  const approvalRepo = new ApprovalRepository(db, config.ENCRYPTION_KEY);
  const artifactRepo = new ArtifactRepository(db);
  const auditRepo = new AuditRepository(db);
  const memoryStore = new DatabaseMemoryStore(db);
  const eventRepo = new SystemEventRepository(db);
  const telegramStateRepo = new TelegramStateRepository(db);
  const messageRepo = new MessageRepository(db);
  const toolCallRepo = new ToolCallRepository(db);
  const budgetRepo = new BudgetRepository(db);
  const rubricRepo = new LeadRubricRepository(db);

  if (typeof (db as any).query === 'function') {
    await budgetRepo.recoverStaleReservations();
    await rubricRepo.ensureDefault({
      version: DEFAULT_LEAD_RUBRIC.version,
      definition: DEFAULT_LEAD_RUBRIC,
      createdBy: 'system'
    });
    const persistedRubrics = await rubricRepo.list();
    const activeRubric = await rubricRepo.getActive();
    if (!activeRubric) {
      throw new Error('No active lead rubric is configured.');
    }
    RubricEngine.hydrate(
      persistedRubrics.map(record => LeadRubricDefinitionSchema.parse(record.definition)),
      activeRubric.version
    );
  }

  return {
    db,
    taskRepo,
    runRepo,
    approvalRepo,
    artifactRepo,
    auditRepo,
    memoryStore,
    eventRepo,
    telegramStateRepo,
    messageRepo,
    toolCallRepo,
    budgetRepo,
    rubricRepo,
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
