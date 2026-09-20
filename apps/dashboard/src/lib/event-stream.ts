import { EventTypeSchema } from '@atlas/shared';

export const atlasEventTypes = [...EventTypeSchema.options];

export interface AtlasEventStream {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function subscribeToAtlasEvents(stream: AtlasEventStream, onEvent: () => void): () => void {
  const listener: EventListener = () => onEvent();
  const eventTypes = ['message', ...atlasEventTypes];

  eventTypes.forEach(eventType => stream.addEventListener(eventType, listener));

  return () => {
    eventTypes.forEach(eventType => stream.removeEventListener(eventType, listener));
  };
}

/** What the operator is actually looking at. */
export type AtlasStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * The label for a status. One owner for the wording, so no page can claim a connection it does not have:
 * the two pages that showed 'reconnecting' had no reconnection attempt at all, and 'live stream' was
 * shown for a stream that had never opened.
 */
export function streamStatusLabel(status: AtlasStreamStatus): string {
  switch (status) {
    case 'open':
      return 'live stream';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'closed':
      return 'stream closed';
  }
}

/** The parts of an EventSource this module uses, so a test can supply its own. */
export interface AtlasEventSource extends AtlasEventStream {
  close(): void;
}

export interface AtlasEventStreamHandle {
  close(): void;
  getStatus(): AtlasStreamStatus;
}

export interface AtlasEventStreamOptions {
  url: string;
  onEvent: () => void;
  onStatus?: (status: AtlasStreamStatus) => void;
  /** Injectable so tests do not need a browser. Defaults to the global EventSource. */
  createSource?: (url: string) => AtlasEventSource;
  /** First retry delay; doubles up to `maxRetryDelayMs`. */
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  schedule?: (fn: () => void, delayMs: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}

/**
 * Own the EventSource lifecycle, including what happens when it fails.
 *
 * Every page created its own `EventSource` once, inside a `useEffect`, and never re-created it. That is
 * fine until the connection fails: the dashboard's API proxy answers a stream path with HTTP 503 when
 * it cannot reach the API, and per the EventSource spec a non-200 response fails the connection
 * permanently — the browser does not retry. Nothing re-created the source, so after a single API blip
 * the command centre silently stopped updating, and the tasks and communications pages went on printing
 * "reconnecting" over a connection that was never going to come back.
 *
 * This re-creates the source with a capped backoff and reports the real status, so a page can say what
 * is true instead of guessing.
 */
export function createAtlasEventStream(options: AtlasEventStreamOptions): AtlasEventStreamHandle {
  const {
    url,
    onEvent,
    onStatus,
    createSource = defaultCreateSource,
    retryDelayMs = 1000,
    maxRetryDelayMs = 15000,
    schedule = defaultSchedule,
    cancelScheduled = defaultCancelScheduled
  } = options;

  let source: AtlasEventSource | null = null;
  let unsubscribe: (() => void) | null = null;
  let retryTimer: unknown = null;
  let delay = retryDelayMs;
  let status: AtlasStreamStatus = 'closed';
  let closed = false;

  function setStatus(next: AtlasStreamStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  function detach(): void {
    unsubscribe?.();
    unsubscribe = null;
    if (source) {
      // `close()` stops the browser's own retry timer as well; without it a re-created source would
      // race a still-live old one and every event would arrive twice.
      try {
        source.close();
      } catch {
        // A source that is already closed is not an error worth surfacing.
      }
      source = null;
    }
  }

  function connect(): void {
    if (closed) return;

    setStatus(status === 'closed' ? 'connecting' : 'reconnecting');

    const next = createSource(url);
    source = next;
    unsubscribe = subscribeToAtlasEvents(next, onEvent);

    next.addEventListener('open', () => {
      delay = retryDelayMs;
      setStatus('open');
    });

    next.addEventListener('error', () => {
      if (closed) return;
      // The old connection is dead in every case, including the permanent-failure case where the
      // browser will not retry it. Tear it down before scheduling the replacement.
      detach();
      setStatus('reconnecting');

      const wait = delay;
      delay = Math.min(delay * 2, maxRetryDelayMs);
      retryTimer = schedule(() => {
        retryTimer = null;
        connect();
      }, wait);
    });
  }

  connect();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (retryTimer !== null) {
        cancelScheduled(retryTimer);
        retryTimer = null;
      }
      detach();
      setStatus('closed');
    },
    getStatus(): AtlasStreamStatus {
      return status;
    }
  };
}

function defaultCreateSource(url: string): AtlasEventSource {
  const Source = (globalThis as { EventSource?: new (url: string) => AtlasEventSource }).EventSource;
  if (!Source) throw new Error('EventSource is not available in this environment.');
  return new Source(url);
}

function defaultSchedule(fn: () => void, delayMs: number): unknown {
  return setTimeout(fn, delayMs);
}

function defaultCancelScheduled(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
