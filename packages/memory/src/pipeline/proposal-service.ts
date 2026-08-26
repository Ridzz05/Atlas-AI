import { MemoryStore } from '../store/memory-store.js';
import { MemoryAuditSink, ProposeMemoryInput } from '../types.js';
import { MemoryItem, MemoryStatus } from '@atlas/shared';
import { AuditService, rootLogger } from '@atlas/observability';

export class MemoryProposalService {
  constructor(
    private store: MemoryStore,
    private auditSink?: MemoryAuditSink
  ) {}

  public async propose(input: ProposeMemoryInput): Promise<MemoryItem> {
    const memoryItem: MemoryItem = {
      id: crypto.randomUUID(),
      type: input.type,
      status: 'unverified',
      content: input.content.trim(),
      scope: input.scope || 'global',
      author: input.author,
      source: input.source || 'agent',
      confidence: input.confidence ?? 0.8,
      taskId: input.taskId || null,
      artifactId: input.artifactId || null,
      metadata: input.metadata || {},
      expiresAt: input.expiresAt || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Check for exact duplicates in the same scope
    const existing = await this.store.search({ scopes: [memoryItem.scope], types: [memoryItem.type] });
    const isDuplicate = existing.some(item => item.content.toLowerCase() === memoryItem.content.toLowerCase());

    if (isDuplicate) {
      rootLogger.debug(`Duplicate memory proposal ignored for scope ${memoryItem.scope}`);
      const matched = existing.find(item => item.content.toLowerCase() === memoryItem.content.toLowerCase())!;
      return matched;
    }

    const saved = await this.store.save(memoryItem);
    rootLogger.info(`New memory item proposed [${saved.id}] by ${saved.author} (${saved.type})`);
    return saved;
  }

  public async verify(id: string): Promise<MemoryItem | null> {
    const updated = await this.store.updateStatus(id, 'verified');
    if (updated) {
      await this.audit('memory.verified', updated);
      rootLogger.info(`Memory item ${id} promoted to verified canonical fact.`);
    }
    return updated;
  }

  public async deprecate(id: string): Promise<MemoryItem | null> {
    const updated = await this.store.updateStatus(id, 'deprecated');
    if (updated) {
      await this.audit('memory.deprecated', updated);
      rootLogger.info(`Memory item ${id} marked as deprecated.`);
    }
    return updated;
  }

  private async audit(action: string, item: MemoryItem): Promise<void> {
    if (!this.auditSink) return;
    await this.auditSink.record(AuditService.format({
      actor: 'memory-governance',
      action,
      target: item.id,
      taskId: item.taskId || undefined,
      details: {
        memoryType: item.type,
        scope: item.scope,
        status: item.status
      }
    }));
  }
}
