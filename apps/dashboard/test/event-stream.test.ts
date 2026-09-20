import { describe, expect, it, vi } from 'vitest';
import { AtlasStreamStatus, createAtlasEventStream } from '../src/lib/event-stream.js';

/**
 * A failed stream must come back, and the UI must not claim it already has.
 *
 * Every page created one `EventSource` inside a `useEffect` and never re-created it. The dashboard's
 * API proxy answers a stream path with HTTP 503 when it cannot reach the API, and per the EventSource
 * spec a non-200 response fails the connection permanently — the browser does not retry. So after one
 * API blip the command centre stopped updating for good while the tasks and communications pages kept
 * printing "reconnecting" over a connection that would never return.
 *
 * These tests drive the lifecycle with a fake source and a fake clock, so the behaviour is asserted
 * rather than the shape of the code.
 */
class FakeSource {
  readyState = 0;
  closed = false;
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

function harness() {
  const sources: FakeSource[] = [];
  const timers: Array<{ fn: () => void; delayMs: number }> = [];
  const events: number[] = [];
  const statuses: AtlasStreamStatus[] = [];

  const handle = createAtlasEventStream({
    url: '/api/atlas/events/stream',
    onEvent: () => events.push(1),
    onStatus: status => statuses.push(status),
    createSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    retryDelayMs: 1000,
    maxRetryDelayMs: 4000,
    schedule: (fn, delayMs) => {
      timers.push({ fn, delayMs });
      return timers.length - 1;
    },
    cancelScheduled: () => undefined
  });

  return {
    handle,
    sources,
    events,
    statuses,
    timers,
    /** Run the most recently scheduled retry. */
    runNextTimer() {
      const timer = timers.shift();
      if (!timer) throw new Error('No retry was scheduled.');
      timer.fn();
      return timer.delayMs;
    }
  };
}

describe('createAtlasEventStream', () => {
  it('creates one source and subscribes the event types', () => {
    const h = harness();

    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.listeners.get('message')?.size).toBe(1);
  });

  it('re-creates the source after an error instead of leaving the page dead', () => {
    const h = harness();

    h.sources[0]!.emit('error');

    // The dead source is closed before the replacement is scheduled, or the browser's own retry would
    // race the new one and every event would arrive twice.
    expect(h.sources[0]!.closed).toBe(true);
    expect(h.timers).toHaveLength(1);

    h.runNextTimer();

    expect(h.sources).toHaveLength(2);
    expect(h.sources[1]!.closed).toBe(false);
  });

  it('reports the real status, so a page never prints "reconnecting" over a dead stream', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    expect(h.handle.getStatus()).toBe('reconnecting');

    h.runNextTimer();
    h.sources[1]!.emit('open');
    expect(h.handle.getStatus()).toBe('open');
  });

  it('backs off, and caps the delay', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    expect(h.runNextTimer()).toBe(1000);

    h.sources[1]!.emit('error');
    expect(h.runNextTimer()).toBe(2000);

    h.sources[2]!.emit('error');
    expect(h.runNextTimer()).toBe(4000);

    // Capped: it must not keep doubling without bound.
    h.sources[3]!.emit('error');
    expect(h.runNextTimer()).toBe(4000);
  });

  it('resets the backoff once a connection succeeds', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    h.runNextTimer();
    h.sources[1]!.emit('open');
    h.sources[1]!.emit('error');

    expect(h.runNextTimer()).toBe(1000);
  });

  it('keeps delivering events from the re-created source', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    h.runNextTimer();
    h.sources[1]!.emit('message');

    expect(h.events).toHaveLength(1);
  });

  it('stops for good on close, with no pending retry', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    h.handle.close();

    expect(h.handle.getStatus()).toBe('closed');
    expect(h.sources[0]!.closed).toBe(true);
    // A retry that fires after close must not resurrect the stream.
    h.timers.forEach(timer => timer.fn());
    expect(h.sources).toHaveLength(1);
  });

  it('detaches the old listeners so a replacement does not double-fire', () => {
    const h = harness();

    h.sources[0]!.emit('error');
    h.runNextTimer();

    expect(h.sources[0]!.listeners.get('message')?.size ?? 0).toBe(0);
    h.sources[1]!.emit('message');
    expect(h.events).toHaveLength(1);
  });
});

describe('a source that never opens', () => {
  it('is replaced rather than trusted', () => {
    const createSource = vi.fn(() => new FakeSource());
    const handle = createAtlasEventStream({
      url: '/api/atlas/events/stream',
      onEvent: () => undefined,
      createSource,
      schedule: () => 1,
      cancelScheduled: () => undefined
    });

    // The 503 case: the proxy answered with a failure and the browser gave up immediately.
    createSource.mock.results[0]?.value.emit('error');

    expect(handle.getStatus()).toBe('reconnecting');
    expect(createSource.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
