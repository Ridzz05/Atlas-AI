import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { defaultAgentRegistry } from '@atlas/agents';
import { EventTypeSchema } from '@atlas/shared';
import { subscribeToAtlasEvents } from '../src/lib/event-stream';
import { buildCommunicationFeed } from '../src/lib/communications';
import { GET as proxyGet } from '../src/app/api/atlas/[...path]/route';

const mutableProcessEnv = process.env as Record<string, string | undefined>;

class FakeEventSource {
  private listeners = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string): void {
    this.listeners.get(type)?.forEach(listener => listener(new Event(type)));
  }
}

describe('@atlas/dashboard Integration Tests', () => {
  it('loads the core agent roster with all 5 specialist definitions', () => {
    const agents = defaultAgentRegistry.list();
    expect(agents.length).toBe(5);

    const ids = agents.map(a => a.id);
    expect(ids).toContain('chief');
    expect(ids).toContain('ned');
    expect(ids).toContain('layla');
    expect(ids).toContain('hermes');
    expect(ids).toContain('argus');
  });

  it('validates agent limits and security configurations', () => {
    const chief = defaultAgentRegistry.getOrThrow('chief');
    expect(chief.limits.maxDelegationDepth).toBe(2);
    expect(chief.limits.maxTurns).toBe(15);

    const argus = defaultAgentRegistry.getOrThrow('argus');
    expect(argus.role).toBe('qa_verifier');
  });

  it('subscribes to named ATLAS events and removes every listener on cleanup', () => {
    const stream = new FakeEventSource();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAtlasEvents(stream, refresh);

    stream.emit('task.updated');
    stream.emit('run.completed');
    stream.emit('message');
    expect(refresh).toHaveBeenCalledTimes(3);

    unsubscribe();
    stream.emit('task.updated');
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(EventTypeSchema.options).toContain('task.updated');
  });

  it('builds a newest-first communication feed without exposing tool payloads', () => {
    const feed = buildCommunicationFeed(
      [
        {
          id: '11111111-1111-4111-8111-111111111111',
          taskId: '22222222-2222-4222-8222-222222222222',
          runId: null,
          senderType: 'user',
          senderId: 'api-owner',
          recipientId: null,
          content: 'Find Palembang gyms',
          metadata: {},
          createdAt: '2026-08-26T00:00:00.000Z'
        }
      ],
      [
        {
          id: '33333333-3333-4333-8333-333333333333',
          taskId: '22222222-2222-4222-8222-222222222222',
          runId: '44444444-4444-4444-8444-444444444444',
          agentId: 'ned',
          toolName: 'web.search',
          input: { apiKey: 'must-not-render' },
          output: { results: ['source'] },
          error: null,
          durationMs: 42,
          riskLevel: 'read',
          requiresApproval: false,
          approvalId: null,
          status: 'success',
          createdAt: '2026-08-26T00:00:01.000Z'
        }
      ]
    );

    expect(feed[0]).toMatchObject({ kind: 'tool', sender: 'ned', taskId: '22222222-2222-4222-8222-222222222222' });
    expect(feed[0]?.summary).toContain('web.search');
    expect(feed[0]?.summary).not.toContain('must-not-render');
    expect(feed[1]).toMatchObject({ kind: 'message', sender: 'api-owner', summary: 'Find Palembang gyms' });
  });

  it('proxies dashboard API paths to the versioned agent-service API', async () => {
    const previousBaseUrl = process.env.ATLAS_API_BASE_URL;
    const previousNodeEnv = mutableProcessEnv.NODE_ENV;
    delete process.env.ATLAS_API_BASE_URL;
    mutableProcessEnv.NODE_ENV = 'development';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await proxyGet(new NextRequest('http://dashboard.test/api/atlas/control'), {
        params: Promise.resolve({ path: ['control'] })
      });

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4000/api/v1/control',
        expect.objectContaining({ method: 'GET', cache: 'no-store' })
      );
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ATLAS_API_BASE_URL;
      else process.env.ATLAS_API_BASE_URL = previousBaseUrl;
      if (previousNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
      else mutableProcessEnv.NODE_ENV = previousNodeEnv;
      vi.unstubAllGlobals();
    }
  });

  it('uses the Compose agent-service hostname as the production proxy default', async () => {
    const previousBaseUrl = process.env.ATLAS_API_BASE_URL;
    const previousNodeEnv = mutableProcessEnv.NODE_ENV;
    delete process.env.ATLAS_API_BASE_URL;
    mutableProcessEnv.NODE_ENV = 'production';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await proxyGet(new NextRequest('http://dashboard.test/api/atlas/control'), {
        params: Promise.resolve({ path: ['control'] })
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://agent-service:4000/api/v1/control',
        expect.objectContaining({ method: 'GET', cache: 'no-store' })
      );
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ATLAS_API_BASE_URL;
      else process.env.ATLAS_API_BASE_URL = previousBaseUrl;
      if (previousNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
      else mutableProcessEnv.NODE_ENV = previousNodeEnv;
      vi.unstubAllGlobals();
    }
  });

  it('returns a sanitized 503 when the agent-service proxy is unavailable', async () => {
    const previousBaseUrl = process.env.ATLAS_API_BASE_URL;
    const previousNodeEnv = mutableProcessEnv.NODE_ENV;
    delete process.env.ATLAS_API_BASE_URL;
    mutableProcessEnv.NODE_ENV = 'development';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND agent-service')));

    try {
      const response = await proxyGet(new NextRequest('http://dashboard.test/api/atlas/tasks'), {
        params: Promise.resolve({ path: ['tasks'] })
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'ATLAS API unavailable.' });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ATLAS_API_BASE_URL;
      else process.env.ATLAS_API_BASE_URL = previousBaseUrl;
      if (previousNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
      else mutableProcessEnv.NODE_ENV = previousNodeEnv;
      vi.unstubAllGlobals();
    }
  });

  it('keeps production Compose aligned with the versioned dashboard proxy target', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../docker-compose.prod.yml'), 'utf8');
    expect(compose).toContain('ATLAS_API_BASE_URL: http://agent-service:4000/api/v1');
  });

  it('passes the production API auth token to every shared-runtime service', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../docker-compose.prod.yml'), 'utf8');
    const worker = compose.slice(compose.indexOf('\n  worker:'), compose.indexOf('\n  telegram-bot:'));
    const telegramBot = compose.slice(compose.indexOf('\n  telegram-bot:'), compose.indexOf('\n  dashboard:'));

    expect(worker).toContain('API_AUTH_TOKEN: ${API_AUTH_TOKEN:?API_AUTH_TOKEN must be set}');
    expect(telegramBot).toContain('API_AUTH_TOKEN: ${API_AUTH_TOKEN:?API_AUTH_TOKEN must be set}');
  });

  it('keeps Compose smoke containers isolated without changing the production default names', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../docker-compose.prod.yml'), 'utf8');
    const smoke = readFileSync(resolve(process.cwd(), '../../scripts/ci-compose-smoke.sh'), 'utf8');

    for (const service of ['postgres', 'redis', 'agent_service', 'worker', 'telegram_bot', 'dashboard', 'caddy']) {
      expect(compose).toContain(`container_name: \${ATLAS_CONTAINER_PREFIX:-atlas}_${service}_prod`);
    }
    expect(smoke).toContain('export ATLAS_CONTAINER_PREFIX');
    expect(smoke).toContain('assert_task_intake_persistence');
    expect(smoke).toContain('/api/v1/messages?taskId=');
    expect(smoke).toContain('up -d telegram-bot');
    expect(smoke).toContain('wait_for_health telegram-bot');
    expect(smoke).toContain('assert_dashboard_proxy');
    expect(smoke).toContain('/api/atlas/tasks?limit=1');
    expect(smoke).toContain('/api/atlas/events/stream');

    const backup = readFileSync(resolve(process.cwd(), '../../scripts/backup-db.sh'), 'utf8');
    const restore = readFileSync(resolve(process.cwd(), '../../scripts/restore-db.sh'), 'utf8');
    expect(backup).toContain('ATLAS_CONTAINER_PREFIX:-atlas');
    expect(restore).toContain('ATLAS_CONTAINER_PREFIX:-atlas');
  });

  it('routes the dashboard proxy path through Next.js before direct API paths in Caddy', () => {
    const caddy = readFileSync(resolve(process.cwd(), '../../Caddyfile'), 'utf8');
    const dashboardProxyIndex = caddy.indexOf('handle /api/atlas/*');
    const directApiIndex = caddy.indexOf('handle /api/*');

    expect(dashboardProxyIndex).toBeGreaterThanOrEqual(0);
    expect(directApiIndex).toBeGreaterThan(dashboardProxyIndex);
    expect(caddy.slice(dashboardProxyIndex, directApiIndex)).toContain('reverse_proxy dashboard:3000');
  });

  it('excludes local secrets and generated data from Docker build contexts', () => {
    const dockerignore = readFileSync(resolve(process.cwd(), '../../.dockerignore'), 'utf8');
    expect(dockerignore.split(/\r?\n/)).toContain('.env');
    expect(dockerignore.split(/\r?\n/)).toContain('node_modules');
    expect(dockerignore.split(/\r?\n/)).toContain('.git');
    expect(dockerignore.split(/\r?\n/)).toContain('**/data');
    expect(dockerignore.split(/\r?\n/)).toContain('**/*.tsbuildinfo');
    expect(dockerignore.split(/\r?\n/)).toContain('**/.turbo');
  });

  it('keeps the dashboard runtime image able to execute its Next.js start command', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('CMD ["node", "apps/dashboard/node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", "3000"]');
  });
});
