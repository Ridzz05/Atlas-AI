import { rootLogger } from '@atlas/observability';

export class TelegramSecurityGuard {
  private seenUpdateIds = new Set<number>();
  private maxCacheSize = 10000;

  constructor(private allowedUserIds: Set<string>) {}

  public isUserAllowed(userId: number | string): boolean {
    const idStr = String(userId);
    // If no allowlist configured in local dev, warn and allow, but in production strictly enforce
    if (this.allowedUserIds.size === 0) {
      rootLogger.warn('No TELEGRAM_ALLOWED_USER_IDS configured. Accepting requests for development.');
      return true;
    }

    const isAllowed = this.allowedUserIds.has(idStr);
    if (!isAllowed) {
      rootLogger.warn(`Blocked unauthorized access attempt from Telegram user ${idStr}`);
    }
    return isAllowed;
  }

  public isDuplicateUpdate(updateId: number): boolean {
    if (this.seenUpdateIds.has(updateId)) {
      return true;
    }

    if (this.seenUpdateIds.size >= this.maxCacheSize) {
      // Clear oldest half of cache to prevent memory unbounded growth
      const items = Array.from(this.seenUpdateIds);
      this.seenUpdateIds = new Set(items.slice(items.length / 2));
    }

    this.seenUpdateIds.add(updateId);
    return false;
  }
}
