import { MemoryStore } from '../store/memory-store.js';
import { MemoryAuditSink, ProposeMemoryInput } from '../types.js';
import { MemoryItem, MemoryStatus } from '@atlas/shared';
import { AuditService, rootLogger } from '@atlas/observability';

export interface ProposeResult {
  item: MemoryItem;
  /**
   * Whether an existing item matched, so nothing new was written.
   *
   * Returned rather than inferred by the caller: only this method knows whether it saved or matched,
   * and `memory.propose_write` reports it to the agent.
   */
  duplicate: boolean;
}

export class MemoryProposalService {
  constructor(
    private store: MemoryStore,
    private auditSink?: MemoryAuditSink
  ) {}

  public async propose(input: ProposeMemoryInput): Promise<ProposeResult> {
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

    // Deduplicate against live items only. Matching `deprecated` or `archived` content meant a new
    // proposal resolved to an already-rejected record: the proposal was silently discarded and
    // nothing appeared for a human to review. A deprecation is a decision about one record, not
    // about the content forever.
    const existing = await this.store.search({ scopes: [memoryItem.scope], types: [memoryItem.type] });
    const live = existing.filter(item => item.status === 'unverified' || item.status === 'verified');
    const isDuplicate = live.some(item => item.content.toLowerCase() === memoryItem.content.toLowerCase());

    if (isDuplicate) {
      const matched = live.find(item => item.content.toLowerCase() === memoryItem.content.toLowerCase())!;
      rootLogger.debug(`Duplicate memory proposal ignored for scope ${memoryItem.scope}`, { matchedId: matched.id });
      return { item: matched, duplicate: true };
    }

    const saved = await this.store.save(memoryItem);
    rootLogger.info(`New memory item proposed [${saved.id}] by ${saved.author} (${saved.type})`);
    return { item: saved, duplicate: false };
  }

  /**
   * Promote a proposal to a canonical fact.
   *
   * Refuses when the store cannot read the item back. `updateStatus` does not filter on expiry, so it
   * would happily mark an expired item `verified` — but every read path does filter, so the item would
   * stay invisible to every agent while the operator was told the promotion succeeded. The whole point
   * of verifying is to make the fact readable.
   */
  public async verify(id: string): Promise<MemoryItem | null> {
    const current = await this.store.findById(id);
    if (!current) {
      rootLogger.warn(`Memory item ${id} cannot be verified: it is not readable (unknown id or expired).`);
      return null;
    }
    const updated = await this.store.updateStatus(id, 'verified');
    if (updated) {
      await this.audit('memory.verified', updated);
      rootLogger.info(`Memory item ${id} promoted to verified canonical fact.`);
    }
    return updated;
  }

  /** Deprecate an item. Same readability precondition as `verify`, for the same reason. */
  public async deprecate(id: string): Promise<MemoryItem | null> {
    const current = await this.store.findById(id);
    if (!current) {
      rootLogger.warn(`Memory item ${id} cannot be deprecated: it is not readable (unknown id or expired).`);
      return null;
    }
    const updated = await this.store.updateStatus(id, 'deprecated');
    if (updated) {
      await this.audit('memory.deprecated', updated);
      rootLogger.info(`Memory item ${id} marked as deprecated.`);
    }
    return updated;
  }

  private async audit(action: string, item: MemoryItem): Promise<void> {
    if (!this.auditSink) return;
    await this.auditSink.record(
      AuditService.format({
        actor: 'memory-governance',
        action,
        target: item.id,
        taskId: item.taskId || undefined,
        details: {
          memoryType: item.type,
          scope: item.scope,
          status: item.status
        }
      })
    );
  }
}
