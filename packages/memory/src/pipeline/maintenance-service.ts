import { AuditService } from '@atlas/observability';
import { MemoryItem } from '@atlas/shared';
import {
  MemoryAuditSink,
  MemoryMaintenanceOptions,
  MemoryMaintenanceResult
} from '../types.js';
import { isMemoryExpired, MemoryStore } from '../store/memory-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class MemoryMaintenanceService {
  constructor(
    private store: MemoryStore,
    private auditSink?: MemoryAuditSink
  ) {}

  public async run(options: MemoryMaintenanceOptions = {}): Promise<MemoryMaintenanceResult> {
    const now = options.now || new Date();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new Error('Memory maintenance requires a valid current time.');
    }

    const deletionGraceDays = options.deletionGraceDays ?? 7;
    if (!Number.isFinite(deletionGraceDays) || deletionGraceDays < 0) {
      throw new Error('Memory deletion grace period must be a non-negative number.');
    }

    const candidates = await this.store.listExpired({
      now,
      limit: options.batchSize
    });
    const deletionCutoffMs = nowMs - deletionGraceDays * DAY_MS;
    let deprecated = 0;
    let deleted = 0;

    for (const item of candidates) {
      if (!isMemoryExpired(item, nowMs)) continue;

      if (item.status !== 'deprecated') {
        const updated = await this.store.updateStatus(item.id, 'deprecated');
        if (updated) {
          deprecated++;
          await this.audit('memory.deprecated', updated, {
            reason: 'expired',
            expiresAt: updated.expiresAt
          });
        }
        continue;
      }

      const updatedAtMs = new Date(item.updatedAt).getTime();
      if (!Number.isFinite(updatedAtMs) || updatedAtMs > deletionCutoffMs) continue;

      if (await this.store.delete(item.id)) {
        deleted++;
        await this.audit('memory.deleted', item, {
          reason: 'expired_after_grace_period',
          expiresAt: item.expiresAt,
          deletionGraceDays
        });
      }
    }

    return {
      inspected: candidates.length,
      deprecated,
      deleted
    };
  }

  private async audit(action: string, item: MemoryItem, details: Record<string, unknown>): Promise<void> {
    if (!this.auditSink) return;
    await this.auditSink.record(AuditService.format({
      actor: 'memory-maintenance',
      action,
      target: item.id,
      taskId: item.taskId || undefined,
      details: {
        memoryType: item.type,
        scope: item.scope,
        ...details
      }
    }));
  }
}
