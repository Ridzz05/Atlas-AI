import * as crypto from 'node:crypto';
import { ApprovalToken } from '@atlas/shared';

export class TokenVerifier {
  /**
   * Recursively sort object keys so that equal payloads always serialise to the same
   * string, at every nesting level. The previous implementation passed
   * `Object.keys(payload).sort()` as `JSON.stringify`'s second argument, which is a
   * property *whitelist* rather than a key sorter: nested objects serialised as `{}`,
   * so their contents were excluded from the signature and two different nested
   * payloads produced the same hash.
   */
  private static canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => TokenVerifier.canonicalize(item));
    }
    if (value !== null && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const ordered: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        ordered[key] = TokenVerifier.canonicalize(source[key]);
      }
      return ordered;
    }
    return value;
  }

  public static hashPayload(payload: unknown): string {
    const normalized = JSON.stringify(TokenVerifier.canonicalize(payload));
    return crypto
      .createHash('sha256')
      .update(normalized || '')
      .digest('hex');
  }

  public static generateToken(requestId: string, action: string, payload: unknown, secretKey: string, ttlSeconds = 3600): ApprovalToken {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    return this.generateTokenForExpiry(requestId, action, payload, secretKey, expiresAt);
  }

  public static generateTokenForExpiry(
    requestId: string,
    action: string,
    payload: unknown,
    secretKey: string,
    expiresAt: number
  ): ApprovalToken {
    const payloadHash = this.hashPayload(payload);

    const dataToSign = `${requestId}:${action}:${payloadHash}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('hex');

    return {
      requestId,
      action,
      payloadHash,
      signature,
      expiresAt
    };
  }

  public static verifyToken(token: ApprovalToken, currentPayload: unknown, secretKey: string): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    if (token.expiresAt <= now) {
      return { valid: false, reason: 'Approval token has expired' };
    }

    const currentHash = this.hashPayload(currentPayload);
    if (currentHash !== token.payloadHash) {
      return { valid: false, reason: 'Payload has changed since approval was granted' };
    }

    const dataToSign = `${token.requestId}:${token.action}:${token.payloadHash}:${token.expiresAt}`;
    const expectedSignature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('hex');

    if (!/^[0-9a-f]+$/i.test(token.signature) || token.signature.length !== expectedSignature.length) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    const signatureMatch = crypto.timingSafeEqual(Buffer.from(token.signature, 'hex'), Buffer.from(expectedSignature, 'hex'));

    if (!signatureMatch) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    return { valid: true };
  }
}
