import { describe, expect, it, vi } from 'vitest';
import { TelegramStateRepository } from '../src/index.js';

describe('TelegramStateRepository', () => {
  it('claims an update once across processes', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ update_id: 101 }] })
        .mockResolvedValueOnce({ rows: [] })
    } as any;
    const repository = new TelegramStateRepository(db);

    await expect(repository.claimUpdate(101)).resolves.toBe(true);
    await expect(repository.claimUpdate(101)).resolves.toBe(false);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (update_id) DO NOTHING'), [101]);
  });

  it('persists pause and emergency-stop control state', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ paused: false, emergency_stop: false, updated_by: null, updated_at: null }] })
        .mockResolvedValueOnce({ rows: [{ paused: true, emergency_stop: false, updated_by: 'owner', updated_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ paused: true, emergency_stop: true, updated_by: 'owner', updated_at: new Date() }] })
    } as any;
    const repository = new TelegramStateRepository(db);

    await expect(repository.getControlState()).resolves.toMatchObject({ paused: false, emergencyStop: false });
    await expect(repository.setPaused(true, 'owner')).resolves.toMatchObject({ paused: true, emergencyStop: false });
    await expect(repository.setEmergencyStop(true, 'owner')).resolves.toMatchObject({ paused: true, emergencyStop: true });
  });
});
