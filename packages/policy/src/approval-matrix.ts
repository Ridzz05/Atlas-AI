import { ToolRiskLevel } from '@atlas/shared';

export interface ActionPolicy {
  requiresApproval: boolean;
  blocked: boolean;
  riskLevel: ToolRiskLevel;
  reason?: string;
}

/**
 * ApprovalMatrix evaluates tool actions against an explicit allow/deny model.
 *
 * Fail-closed semantics (P0.1):
 * - Actions in `BLOCKED_ACTIONS` are always denied (critical risk).
 * - Actions in `HUMAN_APPROVAL_REQUIRED_ACTIONS` require human approval and
 *   are blocked when external writes are disabled by configuration.
 * - Actions in `NO_APPROVAL_ACTIONS` execute without approval (exact match only).
 * - Anything else falls through:
 *   - If `options.knownActions` is provided and the action is NOT a member,
 *     the action is treated as unknown and blocked at high risk.
 *   - If the action IS a known action but not covered by any explicit rule,
 *     the matrix returns
 *     `requiresApproval: true, blocked: false, riskLevel: 'medium'`
 *     so that unknown-but-registered actions still demand human approval.
 *   - If `options.knownActions` is NOT provided, the matrix defaults to
 *     fail-closed for any unrecognized action (blocked: true, high risk).
 *
 * Every match is exact. An earlier version also accepted a *prefix* match
 * (`action.startsWith('artifacts.write')`), which meant any tool whose name was a
 * superstring of a safe action — `artifacts.write_production` — was auto-approved.
 * A naming choice is not an authorization decision, so prefixes are gone.
 *
 * In short: an unknown action NEVER silently executes. Either the registry
 * declares it known and the operator is asked for approval, or it is denied.
 */
export class ApprovalMatrix {
  private static readonly BLOCKED_ACTIONS = new Set([
    'shell.execute',
    'bash.run',
    'finance.transfer',
    'finance.execute_payment',
    'admin.bypass_permissions'
  ]);

  private static readonly HUMAN_APPROVAL_REQUIRED_ACTIONS = new Set([
    'communication.send_approved',
    'communication.send_message',
    'outreach.publish_campaign',
    'database.write_production',
    'system.deploy',
    'memory.delete_canonical'
  ]);

  private static readonly EXTERNAL_WRITE_ACTIONS = new Set([
    'communication.send_approved',
    'communication.send_message',
    'outreach.publish_campaign',
    'database.write_production',
    'system.deploy'
  ]);

  /**
   * Internal read/analysis actions that never mutate external, production, or canonical
   * state, and therefore execute without human approval.
   *
   * This set is the SINGLE OWNER of the "no approval needed" decision. It exists because
   * the decision used to have two owners: every tool definition declared
   * `requiresApproval: false` and `ToolRegistry.registerLegacy` copied that into a manifest
   * with `approval: 'auto'`, which the registry then used to override this matrix. The
   * result was that a tool author could opt their own action out of approval — including
   * actions on HUMAN_APPROVAL_REQUIRED_ACTIONS. The registry now only lets a manifest
   * escalate, so any action not listed here falls through to the fail-closed default below
   * and demands human approval.
   */
  private static readonly NO_APPROVAL_ACTIONS = new Set([
    'web.search',
    'web.fetch_safe',
    'company.lookup',
    'lead.enrich',
    'lead.score',
    'policy.verify',
    'memory.search',
    'memory.get',
    'memory.propose_write',
    'artifacts.read',
    'artifacts.write',
    'communication.create_draft',
    'tasks.get',
    'tasks.list',
    'second_brain.search',
    'second_brain.read_note',
    'second_brain.list_notes',
    'second_brain.query',
    'second_brain.sync_vault'
  ]);

  private static readonly KNOWN_ACTIONS = new Set<string>();

  /**
   * Safe actions that still WRITE something (a draft, an artifact). This set affects only the
   * reported `riskLevel` — it is NOT consulted for the approval decision, which belongs to
   * `NO_APPROVAL_ACTIONS` alone. It exists so an audit record does not label a write as a read.
   */
  private static readonly SAFE_WRITE_ACTIONS = new Set(['artifacts.write', 'communication.create_draft']);

  public static evaluate(action: string, options?: { externalWritesEnabled?: boolean; knownActions?: ReadonlySet<string> }): ActionPolicy {
    if (this.BLOCKED_ACTIONS.has(action)) {
      return {
        requiresApproval: true,
        blocked: true,
        riskLevel: 'critical',
        reason: `Action '${action}' is strictly forbidden on MVP.`
      };
    }

    if (this.HUMAN_APPROVAL_REQUIRED_ACTIONS.has(action)) {
      if (this.EXTERNAL_WRITE_ACTIONS.has(action) && options?.externalWritesEnabled !== true) {
        return {
          requiresApproval: true,
          blocked: true,
          riskLevel: 'high',
          reason: 'External writes are currently disabled by global configuration.'
        };
      }

      return {
        requiresApproval: true,
        blocked: false,
        riskLevel: 'high',
        reason: `Action '${action}' modifies external or production state and requires human approval.`
      };
    }

    if (this.NO_APPROVAL_ACTIONS.has(action)) {
      return {
        requiresApproval: false,
        blocked: false,
        riskLevel: this.SAFE_WRITE_ACTIONS.has(action) ? 'low' : 'read'
      };
    }

    const known = options?.knownActions ?? this.KNOWN_ACTIONS;
    if (!known.has(action)) {
      return {
        requiresApproval: true,
        blocked: true,
        riskLevel: 'high',
        reason: 'Unknown action; registration required.'
      };
    }

    return {
      requiresApproval: true,
      blocked: false,
      riskLevel: 'medium',
      reason: 'Action not covered by an explicit policy rule; defaulting to human approval.'
    };
  }

  public static registerKnownAction(action: string): void {
    this.KNOWN_ACTIONS.add(action);
  }

  /**
   * Registers an action as internal-read at the policy layer, so it executes without human
   * approval. This is the ONLY supported way to grant that, and it lives on the matrix
   * precisely so the decision has one owner. Tool definitions and tool manifests must never
   * be able to do this — see the escalate-only rule in ToolRegistry.execute.
   */
  public static registerSafeAction(action: string): void {
    this.NO_APPROVAL_ACTIONS.add(action);
  }

  public static getKnownActions(): ReadonlySet<string> {
    return this.KNOWN_ACTIONS;
  }
}
