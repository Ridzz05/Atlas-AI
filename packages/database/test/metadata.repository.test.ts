import { describe, expect, it, vi } from 'vitest';
import { ArtifactRepository, AuditRepository } from '../src/index.js';

const artifactRow = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  task_id: '123e4567-e89b-12d3-a456-426614174001',
  run_id: '123e4567-e89b-12d3-a456-426614174002',
  name: 'report.md',
  mime_type: 'text/markdown',
  file_path: '/data/artifacts/report.md',
  size_bytes: '42',
  metadata: { source: 'hermes' },
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z'
};

describe('metadata repositories', () => {
  it('creates and lists artifact metadata', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [artifactRow] })
        .mockResolvedValueOnce({ rows: [artifactRow] })
    } as any;
    const repository = new ArtifactRepository(db);

    const created = await repository.create({
      taskId: artifactRow.task_id,
      runId: artifactRow.run_id,
      name: artifactRow.name,
      mimeType: artifactRow.mime_type,
      filePath: artifactRow.file_path,
      sizeBytes: 42,
      metadata: artifactRow.metadata
    });
    const listed = await repository.list({ taskId: artifactRow.task_id, limit: 10 });

    expect(created).toMatchObject({ id: artifactRow.id, sizeBytes: 42 });
    expect(listed[0]?.name).toBe('report.md');
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM artifacts'),
      [artifactRow.task_id, 10]
    );
  });

  it('writes and lists audit records', async () => {
    const auditRow = {
      id: artifactRow.id,
      timestamp: artifactRow.created_at,
      actor: 'hermes',
      action: 'tool.artifacts.write',
      target: null,
      task_id: artifactRow.task_id,
      run_id: artifactRow.run_id,
      details: { riskLevel: 'low' },
      ip_address: null
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [auditRow] })
        .mockResolvedValueOnce({ rows: [auditRow] })
    } as any;
    const repository = new AuditRepository(db);

    const created = await repository.create({
      id: auditRow.id,
      timestamp: auditRow.timestamp,
      actor: auditRow.actor,
      action: auditRow.action,
      taskId: auditRow.task_id,
      runId: auditRow.run_id,
      details: auditRow.details
    });
    const listed = await repository.list({ taskId: auditRow.task_id, limit: 10 });

    expect(created).toMatchObject({ actor: 'hermes', action: 'tool.artifacts.write' });
    expect(listed[0]?.details).toEqual({ riskLevel: 'low' });
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM audit_events'),
      [auditRow.task_id, 10]
    );
  });
});
