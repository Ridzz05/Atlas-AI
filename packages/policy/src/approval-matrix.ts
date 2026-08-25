import { ToolRiskLevel } from '@atlas/shared';

export interface ActionPolicy {
  requiresApproval: boolean;
  blocked: boolean;
  riskLevel: ToolRiskLevel;
  reason?: string;
}

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

  public static evaluate(action: string, options?: { externalWritesEnabled?: boolean }): ActionPolicy {
    if (this.BLOCKED_ACTIONS.has(action)) {
      return {
        requiresApproval: true,
        blocked: true,
        riskLevel: 'critical',
        reason: `Action '${action}' is strictly forbidden on MVP.`
      };
    }

    if (this.HUMAN_APPROVAL_REQUIRED_ACTIONS.has(action)) {
      if (options?.externalWritesEnabled === false && action.startsWith('communication.send')) {
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

    // Default safe actions: reading memory, drafting artifacts, internal computation
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

    return {
      requiresApproval: false,
      blocked: false,
      riskLevel: 'low'
    };
  }
}
