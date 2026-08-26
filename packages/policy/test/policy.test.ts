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
      for (const action of [
        'communication.send_message',
        'outreach.publish_campaign',
        'database.write_production',
        'system.deploy'
      ]) {
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
});
