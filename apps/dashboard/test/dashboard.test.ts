import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { defaultAgentRegistry } from '@atlas/agents';
import { EventTypeSchema } from '@atlas/shared';
import { subscribeToAtlasEvents } from '../src/lib/event-stream';
import { GET as proxyGet } from '../src/app/api/atlas/[...path]/route';

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

  it('proxies dashboard API paths to the versioned agent-service API', async () => {
    const previousBaseUrl = process.env.ATLAS_API_BASE_URL;
    delete process.env.ATLAS_API_BASE_URL;
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
        'http://agent-service:4000/api/v1/control',
        expect.objectContaining({ method: 'GET', cache: 'no-store' })
      );
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ATLAS_API_BASE_URL;
      else process.env.ATLAS_API_BASE_URL = previousBaseUrl;
      vi.unstubAllGlobals();
    }
  });

  it('keeps production Compose aligned with the versioned dashboard proxy target', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../docker-compose.prod.yml'), 'utf8');
    expect(compose).toContain('ATLAS_API_BASE_URL: http://agent-service:4000/api/v1');
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
  });
});
