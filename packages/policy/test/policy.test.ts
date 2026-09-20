import { describe, it, expect } from 'vitest';
import { ApprovalMatrix, TokenVerifier, DepthGuard } from '../src/index.js';

describe('@atlas/policy tests', () => {
  describe('ApprovalMatrix', () => {
    it('blocks dangerous arbitrary shell actions', () => {
      const evaluation = ApprovalMatrix.evaluate('shell.execute');
      expect(evaluation.blocked).toBe(true);
      expect(evaluation.riskLevel).toBe('critical');
    });

    it('requires human approval for external messages', () => {
      const evaluation = ApprovalMatrix.evaluate('communication.send_approved', {
        externalWritesEnabled: true
      });
      expect(evaluation.requiresApproval).toBe(true);
      expect(evaluation.blocked).toBe(false);
      expect(evaluation.riskLevel).toBe('high');
    });

    it('blocks outbound sending if external writes are disabled', () => {
      const evaluation = ApprovalMatrix.evaluate('communication.send_approved', {
        externalWritesEnabled: false
      });
      expect(evaluation.blocked).toBe(true);
    });

    it('blocks every external side-effect class when external writes are disabled', () => {
      for (const action of ['communication.send_message', 'outreach.publish_campaign', 'database.write_production', 'system.deploy']) {
        const evaluation = ApprovalMatrix.evaluate(action, { externalWritesEnabled: false });
        expect(evaluation.blocked, action).toBe(true);
      }
    });

    it('fails closed when external write configuration is omitted', () => {
      const evaluation = ApprovalMatrix.evaluate('outreach.publish_campaign');
      expect(evaluation.blocked).toBe(true);
    });

    it('allows read memory without approval', () => {
      const evaluation = ApprovalMatrix.evaluate('memory.search');
      expect(evaluation.requiresApproval).toBe(false);
      expect(evaluation.blocked).toBe(false);
    });
  });

  describe('TokenVerifier', () => {
    const secret = 'test-secret-key-32-chars-length!!';
    const payload = { target: '+628123456789', body: 'Hello' };

    it('generates and verifies a valid token', () => {
      const token = TokenVerifier.generateToken('req-1', 'communication.send_approved', payload, secret, 300);
      const result = TokenVerifier.verifyToken(token, payload, secret);
      expect(result.valid).toBe(true);
    });

    it('rejects if the payload has been tampered with', () => {
      const token = TokenVerifier.generateToken('req-1', 'communication.send_approved', payload, secret, 300);
      const tamperedPayload = { target: '+628123456789', body: 'Malicious modification' };
      const result = TokenVerifier.verifyToken(token, tamperedPayload, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Payload has changed');
    });

    it('binds nested payload contents to the signature', () => {
      const approved = {
        recipient: 'ops@corp.com',
        channel: 'email',
        content: 'Quarterly update',
        meta: { cc: 'auditor@corp.com', bcc: 'none' }
      };
      const tampered = {
        recipient: 'ops@corp.com',
        channel: 'email',
        content: 'Quarterly update',
        meta: { cc: 'attacker@evil.com', bcc: 'leak@evil.com' }
      };

      expect(TokenVerifier.hashPayload(approved)).not.toBe(TokenVerifier.hashPayload(tampered));

      const token = TokenVerifier.generateToken('req-nested', 'communication.send_approved', approved, secret, 300);
      const result = TokenVerifier.verifyToken(token, tampered, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Payload has changed');
    });

    it('is stable across key order for equal nested payloads', () => {
      expect(TokenVerifier.hashPayload({ a: 1, b: { c: 2, d: 3 } })).toBe(TokenVerifier.hashPayload({ b: { d: 3, c: 2 }, a: 1 }));
    });

    it('rejects if the token is expired', () => {
      const token = TokenVerifier.generateToken('req-1', 'communication.send_approved', payload, secret, -10);
      const result = TokenVerifier.verifyToken(token, payload, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });
  });

  describe('DepthGuard', () => {
    it('prevents self-delegation', () => {
      const result = DepthGuard.validateDelegation({
        parentAgentId: 'chief',
        targetAgentId: 'chief',
        currentDepth: 0
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot delegate to itself');
    });

    it('allows depth 0 -> 1 delegation', () => {
      const result = DepthGuard.validateDelegation({
        parentAgentId: 'chief',
        targetAgentId: 'ned',
        currentDepth: 0
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks depth > 2 delegation', () => {
      const result = DepthGuard.validateDelegation({
        parentAgentId: 'argus',
        targetAgentId: 'ned',
        currentDepth: 2
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds maximum allowed depth');
    });

    it('blocks cyclic delegation loops', () => {
      const result = DepthGuard.validateDelegation({
        parentAgentId: 'layla',
        targetAgentId: 'ned',
        currentDepth: 1,
        callChain: ['chief', 'ned', 'layla']
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cyclic delegation detected');
    });
  });

  describe('ApprovalMatrix fail-closed semantics (P0.1)', () => {
    it('fails closed for completely unknown actions', () => {
      const evaluation = ApprovalMatrix.evaluate('integration.unknown_action');
      expect(evaluation.blocked).toBe(true);
      expect(evaluation.riskLevel).toBe('high');
      expect(evaluation.reason).toContain('Unknown action');
    });

    it('fails closed for unknown actions even when knownActions is provided', () => {
      const known = new Set<string>(['integration.known_action']);
      const evaluation = ApprovalMatrix.evaluate('integration.different_unknown', {
        knownActions: known
      });
      expect(evaluation.blocked).toBe(true);
      expect(evaluation.riskLevel).toBe('high');
      expect(evaluation.reason).toContain('Unknown action');
    });

    it('treats known actions not covered by any rule as human-approval required', () => {
      const known = new Set<string>(['integration.known_but_unruled']);
      const evaluation = ApprovalMatrix.evaluate('integration.known_but_unruled', {
        knownActions: known
      });
      expect(evaluation.requiresApproval).toBe(true);
      expect(evaluation.blocked).toBe(false);
      expect(evaluation.riskLevel).toBe('medium');
    });

    it('preserves existing safe-prefix defaults', () => {
      const evaluation = ApprovalMatrix.evaluate('memory.search');
      expect(evaluation.requiresApproval).toBe(false);
      expect(evaluation.blocked).toBe(false);
    });

    it('preserves existing blocked actions', () => {
      const evaluation = ApprovalMatrix.evaluate('shell.execute');
      expect(evaluation.blocked).toBe(true);
      expect(evaluation.riskLevel).toBe('critical');
    });

    it('registerKnownAction makes subsequent evaluations fail open to human approval', () => {
      ApprovalMatrix.registerKnownAction('integration.registered_action');
      const evaluation = ApprovalMatrix.evaluate('integration.registered_action');
      expect(evaluation.requiresApproval).toBe(true);
      expect(evaluation.blocked).toBe(false);
      expect(evaluation.riskLevel).toBe('medium');
    });

    // The matrix used to accept `action.startsWith('artifacts.write')` etc. as a safe read/low-risk
    // action. A tool named `artifacts.write_production` is a superstring of that prefix, so a
    // one-word naming choice silently converted an approval-required action into an auto-approved
    // one. Approval is decided by exact membership only.
    it('does not auto-approve an action that merely starts with a safe prefix', () => {
      for (const action of [
        'artifacts.write_production',
        'artifacts.read_secrets',
        'memory.search_all_scopes',
        'tasks.get_secret',
        'communication.create_draft_external'
      ]) {
        const evaluation = ApprovalMatrix.evaluate(action, { knownActions: new Set([action]) });
        expect(evaluation.requiresApproval, action).toBe(true);
        expect(evaluation.blocked, action).toBe(false);
        expect(evaluation.riskLevel, action).toBe('medium');
      }
    });

    it('still auto-approves the exact safe actions it declares', () => {
      for (const action of ['memory.search', 'artifacts.read', 'tasks.get', 'artifacts.write']) {
        const evaluation = ApprovalMatrix.evaluate(action);
        expect(evaluation.requiresApproval, action).toBe(false);
        expect(evaluation.blocked, action).toBe(false);
      }
    });
  });
});
