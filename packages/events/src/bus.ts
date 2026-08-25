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
