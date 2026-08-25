import { TelegramBotConfig } from './config.js';
import { TelegramSecurityGuard } from './security/guard.js';
import { CommandRouter } from './handlers/commands.js';
import { TaskRepository } from '@atlas/database';
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

export interface AtlasTelegramBotOptions {
  config: TelegramBotConfig;
  taskRepo?: TaskRepository;
  registry?: AgentRegistry;
  taskQueue?: TaskQueue;
  runner?: AgentRunner;
}

export class AtlasTelegramBot {
  private guard: TelegramSecurityGuard;
  private router: CommandRouter;
  private isPaused = false;
  private pollingTimer: NodeJS.Timeout | null = null;

  constructor(private options: AtlasTelegramBotOptions) {
    this.guard = new TelegramSecurityGuard(options.config.allowedUserIds);

    this.router = new CommandRouter({
      taskRepo: options.taskRepo,
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
        const responseText = await this.router.handle(action, [requestId]);
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
      const responseText = await this.router.handle(command, args);
      return { responseText };
    } else {
      // Natural language treated as a new task for Chief
      const responseText = await this.router.handle('new', [text]);
      return { responseText };
    }
  }

  public async start(): Promise<void> {
    rootLogger.info('Atlas Telegram Bot service started');
  }

  public async stop(): Promise<void> {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    rootLogger.info('Atlas Telegram Bot service stopped');
  }

  public getRouter(): CommandRouter {
    return this.router;
  }
}
