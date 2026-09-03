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
 * - Actions not in either set fall through to one of two paths:
 *   - If `options.knownActions` is provided and the action is NOT a member,
 *     the action is treated as unknown and blocked at high risk.
 *   - If the action IS a known action but not covered by any explicit rule
 *     and not a safe-prefix match, the matrix returns
 *     `requiresApproval: true, blocked: false, riskLevel: 'medium'`
 *     so that unknown-but-registered actions still demand human approval.
 *   - If `options.knownActions` is NOT provided, the matrix defaults to
 *     fail-closed for any unrecognized action (blocked: true, high risk).
 * - A small set of read/draft prefixes (`memory.search`, `artifacts.read`,
 *   `tasks.get`, `communication.create_draft`, `artifacts.write`) is allowed
 *   without approval because they are internal, non-side-effecting actions.
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

  private static readonly KNOWN_ACTIONS = new Set<string>();

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

    if (action.startsWith('memory.search') || action.startsWith('artifacts.read') || action.startsWith('tasks.get')) {
      return {
        requiresApproval: false,
        blocked: false,
        riskLevel: 'read'
      };
    }

    if (action.startsWith('communication.create_draft') || action.startsWith('artifacts.write')) {
      return {
        requiresApproval: false,
        blocked: false,
        riskLevel: 'low'
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

  public static getKnownActions(): ReadonlySet<string> {
    return this.KNOWN_ACTIONS;
  }
}
