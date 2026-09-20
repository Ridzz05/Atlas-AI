import { rootLogger } from '@atlas/observability';

export interface TelegramUpdateClaimStore {
  claimUpdate(updateId: number): Promise<boolean>;
}

export class TelegramSecurityGuard {
  private seenUpdateIds = new Set<number>();
  private maxCacheSize = 10000;
  private readonly allowAllUsers: boolean;

  constructor(
    private allowedUserIds: Set<string>,
    private updateStore?: TelegramUpdateClaimStore,
    options: { allowAllUsers?: boolean } = {}
  ) {
    this.allowAllUsers = options.allowAllUsers === true;
  }

  /**
   * Fail closed. An empty allowlist denies everyone unless the composition explicitly opted in
   * (`config.allowAllUsers`, granted only in development), because a Telegram user can create
   * tasks, approve side effects and trigger an emergency stop.
   */
  public isUserAllowed(userId: number | string): boolean {
    const idStr = String(userId);

    if (this.allowedUserIds.size === 0) {
      if (this.allowAllUsers) {
        rootLogger.warn('No TELEGRAM_ALLOWED_USER_IDS configured and allowAllUsers is enabled; accepting every Telegram user.');
        return true;
      }
      rootLogger.error('No TELEGRAM_ALLOWED_USER_IDS configured; refusing every Telegram request.');
      return false;
    }

    const isAllowed = this.allowedUserIds.has(idStr);
    if (!isAllowed) {
      rootLogger.warn(`Blocked unauthorized access attempt from Telegram user ${idStr}`);
    }
    return isAllowed;
  }

  public async isDuplicateUpdate(updateId: number): Promise<boolean> {
    if (this.updateStore) {
      return !(await this.updateStore.claimUpdate(updateId));
    }

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
