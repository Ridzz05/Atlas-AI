import { TelegramBotConfig } from './config.js';
import { TelegramSecurityGuard } from './security/guard.js';
import { CommandRouter } from './handlers/commands.js';
import { ApprovalRepository, TaskRepository } from '@atlas/database';
import { AgentRegistry, defaultAgentRegistry } from '@atlas/agents';
import { TaskQueue, AgentRunner } from '@atlas/orchestration';
import { rootLogger } from '@atlas/observability';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
    };
    data: string;
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
  };
}

export interface TelegramApiClient {
  getUpdates(offset: number | undefined, timeoutSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string, signal: AbortSignal): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, signal: AbortSignal): Promise<void>;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class FetchTelegramApiClient implements TelegramApiClient {
  private readonly baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  public async getUpdates(
    offset: number | undefined,
    timeoutSeconds: number,
    signal: AbortSignal
  ): Promise<TelegramUpdate[]> {
    const updates = await this.request<TelegramUpdate[]>('getUpdates', {
      ...(offset === undefined ? {} : { offset }),
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query']
    }, signal);
    return Array.isArray(updates) ? updates : [];
  }

  public async sendMessage(chatId: number, text: string, signal: AbortSignal): Promise<void> {
    await this.request('sendMessage', { chat_id: chatId, text }, signal);
  }

  public async answerCallbackQuery(callbackQueryId: string, signal: AbortSignal): Promise<void> {
    await this.request('answerCallbackQuery', { callback_query_id: callbackQueryId }, signal);
  }

  private async request<T>(method: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const body = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !body.ok) {
      throw new Error(`Telegram API ${method} failed: ${body.description || response.statusText}`);
    }
    return body.result as T;
  }
}

export interface AtlasTelegramBotOptions {
  config: TelegramBotConfig;
  taskRepo?: TaskRepository;
  approvalRepo?: ApprovalRepository;
  registry?: AgentRegistry;
  taskQueue?: TaskQueue;
  runner?: AgentRunner;
  apiClient?: TelegramApiClient;
  pollTimeoutSeconds?: number;
  retryDelayMs?: number;
}

export class AtlasTelegramBot {
  private guard: TelegramSecurityGuard;
  private router: CommandRouter;
  private isPaused = false;
  private pollingPromise: Promise<void> | null = null;
  private pollingAbortController: AbortController | null = null;
  private nextUpdateOffset: number | undefined;
  private readonly apiClient: TelegramApiClient;

  constructor(private options: AtlasTelegramBotOptions) {
    this.guard = new TelegramSecurityGuard(options.config.allowedUserIds);
    this.apiClient = options.apiClient || new FetchTelegramApiClient(options.config.botToken);

    this.router = new CommandRouter({
      taskRepo: options.taskRepo,
      approvalRepo: options.approvalRepo,
      registry: options.registry || defaultAgentRegistry,
      taskQueue: options.taskQueue,
      runner: options.runner,
      isPaused: this.isPaused,
      setPaused: (paused) => {
        this.isPaused = paused;
      }
    });
  }

  public async processUpdate(update: TelegramUpdate): Promise<{ responseText?: string; ignored?: boolean }> {
    // 1. Deduplication check
    if (this.guard.isDuplicateUpdate(update.update_id)) {
      rootLogger.debug(`Duplicate update ignored: ${update.update_id}`);
      return { ignored: true };
    }

    // 2. Callback query handling (Inline buttons)
    if (update.callback_query) {
      const fromId = update.callback_query.from.id;
      if (!this.guard.isUserAllowed(fromId)) {
        return { responseText: '⛔ Unauthorized access.', ignored: true };
      }

      const data = update.callback_query.data;
      const [action, requestId] = data.split(':');
      if (action && requestId) {
        const responseText = await this.router.handle(action, [requestId], String(fromId));
        return { responseText };
      }
      return { responseText: 'Unknown action.' };
    }

    // 3. Message handling
    const msg = update.message;
    if (!msg || !msg.text) {
      return { ignored: true };
    }

    const fromId = msg.from.id;
    if (!this.guard.isUserAllowed(fromId)) {
      return {
        responseText: '⛔ You are not authorized to use this ATLAS AI OS instance.'
      };
    }

    const text = msg.text.trim();
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const command = parts[0] || '/help';
      const args = parts.slice(1);
      const responseText = await this.router.handle(command, args, String(fromId));
      return { responseText };
    } else {
      // Natural language treated as a new task for Chief
      const responseText = await this.router.handle('new', [text], String(fromId));
      return { responseText };
    }
  }

  public async start(): Promise<void> {
    if (!this.options.config.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required to start the Telegram bot.');
    }
    if (!this.options.config.isPolling) {
      throw new Error('Telegram webhook transport is not configured for this service; unset TELEGRAM_WEBHOOK_SECRET to use polling.');
    }
    if (this.pollingPromise) return;

    this.pollingAbortController = new AbortController();
    this.pollingPromise = this.poll(this.pollingAbortController.signal);
    this.pollingPromise.catch(error => {
      if (!this.pollingAbortController?.signal.aborted) {
        rootLogger.error('Telegram polling stopped unexpectedly', { error: String(error) });
      }
    });
    rootLogger.info('Atlas Telegram Bot service started');
  }

  public async stop(): Promise<void> {
    this.pollingAbortController?.abort();
    await this.pollingPromise;
    this.pollingPromise = null;
    this.pollingAbortController = null;
    rootLogger.info('Atlas Telegram Bot service stopped');
  }

  public getRouter(): CommandRouter {
    return this.router;
  }

  private async poll(signal: AbortSignal): Promise<void> {
    const timeoutSeconds = this.options.pollTimeoutSeconds ?? 25;
    const retryDelayMs = this.options.retryDelayMs ?? 2000;

    while (!signal.aborted) {
      try {
        const updates = await this.apiClient.getUpdates(this.nextUpdateOffset, timeoutSeconds, signal);
        for (const update of updates) {
          this.nextUpdateOffset = Math.max(this.nextUpdateOffset ?? 0, update.update_id + 1);
          await this.deliverUpdate(update, signal);
        }
      } catch (error) {
        if (signal.aborted) return;
        rootLogger.error('Telegram polling request failed; retrying', { error: String(error) });
        await this.delay(retryDelayMs, signal);
      }
    }
  }

  private async deliverUpdate(update: TelegramUpdate, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.processUpdate(update);
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (response.responseText && chatId !== undefined) {
        await this.apiClient.sendMessage(chatId, response.responseText, signal);
      }
      if (update.callback_query) {
        await this.apiClient.answerCallbackQuery(update.callback_query.id, signal);
      }
    } catch (error) {
      rootLogger.error('Telegram update handling failed', {
        updateId: update.update_id,
        error: String(error)
      });
    }
  }

  private async delay(durationMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, durationMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
