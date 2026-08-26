import { describe, expect, it, vi } from 'vitest';
import { ArtifactService } from '../src/index.js';

describe('ArtifactService metadata persistence', () => {
  it('passes task and run context to the metadata writer after saving', async () => {
    const writer = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new ArtifactService('./data/test-artifacts-persistence', writer);
    const meta = service.save('persisted.md', 'hello', 'text/markdown');

    await service.recordMetadata(meta, {
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      runId: '123e4567-e89b-12d3-a456-426614174001'
    });

    expect(writer.record).toHaveBeenCalledWith({
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      runId: '123e4567-e89b-12d3-a456-426614174001',
      ...meta
    });
  });
});
