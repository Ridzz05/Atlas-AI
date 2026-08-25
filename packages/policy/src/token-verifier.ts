import * as crypto from 'node:crypto';
import { ApprovalToken } from '@atlas/shared';

export class TokenVerifier {
  public static hashPayload(payload: unknown): string {
    const normalized = JSON.stringify(payload, Object.keys(payload as object || {}).sort());
    return crypto.createHash('sha256').update(normalized || '').digest('hex');
  }

  public static generateToken(
    requestId: string,
    action: string,
    payload: unknown,
    secretKey: string,
    ttlSeconds = 3600
  ): ApprovalToken {
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
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('hex');

    return {
      requestId,
      action,
      payloadHash,
      signature,
      expiresAt
    };
  }

  public static verifyToken(
    token: ApprovalToken,
    currentPayload: unknown,
    secretKey: string
  ): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    if (token.expiresAt <= now) {
      return { valid: false, reason: 'Approval token has expired' };
    }

    const currentHash = this.hashPayload(currentPayload);
    if (currentHash !== token.payloadHash) {
      return { valid: false, reason: 'Payload has changed since approval was granted' };
    }

    const dataToSign = `${token.requestId}:${token.action}:${token.payloadHash}:${token.expiresAt}`;
    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('hex');

    if (!/^[0-9a-f]+$/i.test(token.signature) || token.signature.length !== expectedSignature.length) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    const signatureMatch = crypto.timingSafeEqual(
      Buffer.from(token.signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!signatureMatch) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    return { valid: true };
  }
}
