import { describe, it, expect, vi } from 'vitest';
import { defaultAgentRegistry } from '@atlas/agents';
import { EventTypeSchema } from '@atlas/shared';
import { subscribeToAtlasEvents } from '../src/lib/event-stream';

class FakeEventSource {
  private listeners = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string): void {
    this.listeners.get(type)?.forEach(listener => listener(new Event(type)));
  }
}

describe('@atlas/dashboard Integration Tests', () => {
  it('loads the core agent roster with all 5 specialist definitions', () => {
    const agents = defaultAgentRegistry.list();
    expect(agents.length).toBe(5);

    const ids = agents.map(a => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
  });

  it('validates agent limits and security configurations', () => {
    const chief = defaultAgentRegistry.getOrThrow('chief');
    expect(chief.limits.maxDelegationDepth).toBe(2);
    expect(chief.limits.maxTurns).toBe(15);

    const argus = defaultAgentRegistry.getOrThrow('argus');
    expect(argus.role).toBe('qa_verifier');
  });

  it('subscribes to named ATLAS events and removes every listener on cleanup', () => {
    const stream = new FakeEventSource();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAtlasEvents(stream, refresh);

    stream.emit('task.updated');
    stream.emit('run.completed');
    stream.emit('message');
    expect(refresh).toHaveBeenCalledTimes(3);

    unsubscribe();
    stream.emit('task.updated');
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(EventTypeSchema.options).toContain('task.updated');
  });
});
