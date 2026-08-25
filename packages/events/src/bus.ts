import { SystemEvent, EventType } from '@atlas/shared';

export type EventHandler = (event: SystemEvent) => Promise<void> | void;

export interface EventBus {
  publish(event: SystemEvent): Promise<void>;
  subscribe(eventType: EventType | '*', handler: EventHandler): () => void;
  clear(): void;
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  public async publish(event: SystemEvent): Promise<void> {
    const specificHandlers = this.handlers.get(event.type) || new Set();
    const wildcardHandlers = this.handlers.get('*') || new Set();

    const allHandlers = [...specificHandlers, ...wildcardHandlers];
    await Promise.all(allHandlers.map(handler => handler(event)));
  }

  public subscribe(eventType: EventType | '*', handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  public clear(): void {
    this.handlers.clear();
  }
}

export interface PostgresListenerClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification', handler: (message: { channel?: string; payload?: string }) => void): void;
  release(): void;
}

export interface PostgresEventStore {
  query(sql: string, params?: any[]): Promise<any>;
  getPool?(): { connect(): Promise<PostgresListenerClient> };
}

export class PostgresEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private listenerClient: PostgresListenerClient | null = null;
  private listenerStarting: Promise<void> | null = null;
  private localPublished = new Set<string>();

  constructor(private store: PostgresEventStore, private channel = 'atlas_events') {
    if (!/^[a-zA-Z0-9_]+$/.test(channel)) throw new Error('Invalid PostgreSQL event channel.');
  }

  public async publish(event: SystemEvent): Promise<void> {
    await this.store.query(
      `INSERT INTO event_outbox (event_id, event_type, task_id, run_id, agent_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type, event.taskId || null, event.runId || null, event.agentId || null, JSON.stringify(event.payload), event.timestamp]
    );
    if (this.listenerClient) this.localPublished.add(event.id);
    await this.store.query('SELECT pg_notify($1, $2)', [this.channel, JSON.stringify(event)]);
    await this.dispatch(event);
  }

  public subscribe(eventType: EventType | '*', handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    void this.startListener();
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  public clear(): void {
    this.handlers.clear();
  }

  public async close(): Promise<void> {
    this.handlers.clear();
    this.listenerClient?.release();
    this.listenerClient = null;
    this.listenerStarting = null;
    this.localPublished.clear();
  }

  private async startListener(): Promise<void> {
    if (this.listenerClient || this.listenerStarting || !this.store.getPool) return;
    this.listenerStarting = (async () => {
      const client = await this.store.getPool!().connect();
      await client.query(`LISTEN "${this.channel}"`);
      this.listenerClient = client;
      client.on('notification', message => {
        if (message.channel !== this.channel || !message.payload) return;
        try {
          const event = JSON.parse(message.payload) as SystemEvent;
          if (this.localPublished.delete(event.id)) return;
          void this.dispatch(event);
        } catch (error) {
          console.error('Failed to decode PostgreSQL event notification', error);
        }
      });
    })().catch(error => {
      console.error('Failed to start PostgreSQL event listener', error);
    }).finally(() => {
      this.listenerStarting = null;
    });
    await this.listenerStarting;
  }

  private async dispatch(event: SystemEvent): Promise<void> {
    const specificHandlers = this.handlers.get(event.type) || new Set();
    const wildcardHandlers = this.handlers.get('*') || new Set();
    await Promise.all([...specificHandlers, ...wildcardHandlers].map(handler => handler(event)));
  }
}
