export interface DelegationContext {
  parentAgentId: string;
  targetAgentId: string;
  currentDepth: number;
  maxAllowedDepth?: number;
  callChain?: string[];
}

export class DepthGuard {
  public static readonly DEFAULT_MAX_DEPTH = 2;

  public static validateDelegation(context: DelegationContext): { allowed: boolean; reason?: string } {
    const maxDepth = context.maxAllowedDepth ?? this.DEFAULT_MAX_DEPTH;

    // Self-delegation check
    if (context.parentAgentId === context.targetAgentId) {
      return {
        allowed: false,
        reason: `Agent '${context.parentAgentId}' cannot delegate to itself.`
      };
    }

    // Depth limit check
    const nextDepth = context.currentDepth + 1;
    if (nextDepth > maxDepth) {
      return {
        allowed: false,
        reason: `Delegation depth ${nextDepth} exceeds maximum allowed depth of ${maxDepth}.`
      };
    }

    // Cycle check
    if (context.callChain && context.callChain.includes(context.targetAgentId)) {
      return {
        allowed: false,
        reason: `Cyclic delegation detected: [${context.callChain.join(' -> ')} -> ${context.targetAgentId}].`
      };
    }

    return { allowed: true };
  }
}
