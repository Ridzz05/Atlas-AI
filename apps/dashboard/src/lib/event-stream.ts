import { EventTypeSchema } from '@atlas/shared';

export const atlasEventTypes = [...EventTypeSchema.options];

export interface AtlasEventStream {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function subscribeToAtlasEvents(
  stream: AtlasEventStream,
  onEvent: () => void
): () => void {
  const listener: EventListener = () => onEvent();
  const eventTypes = ['message', ...atlasEventTypes];

  eventTypes.forEach(eventType => stream.addEventListener(eventType, listener));

  return () => {
    eventTypes.forEach(eventType => stream.removeEventListener(eventType, listener));
  };
}
