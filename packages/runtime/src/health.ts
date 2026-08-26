import { createServer, type Server } from 'node:http';

export interface HealthCheckDependency {
  healthCheck(): Promise<boolean>;
}

export interface ServiceReadinessOptions {
  service: string;
  isRunning: () => boolean;
  database: HealthCheckDependency;
  queue: HealthCheckDependency;
}

export interface ServiceReadiness {
  ready: boolean;
  database: boolean;
  queue: boolean;
}

export async function getServiceReadiness(options: ServiceReadinessOptions): Promise<ServiceReadiness> {
  if (!options.isRunning()) {
    return { ready: false, database: false, queue: false };
  }

  const [database, queue] = await Promise.all([
    checkDependency(options.database),
    checkDependency(options.queue)
  ]);

  return {
    ready: database && queue,
    database,
    queue
  };
}

export interface ServiceHealthServer {
  server: Server;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceHealthServerListenOptions {
  host?: string;
  port?: number;
}

export function createServiceHealthServer(
  options: ServiceReadinessOptions,
  listenOptions: ServiceHealthServerListenOptions = {}
): ServiceHealthServer {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method !== 'GET') {
      response.statusCode = 405;
      response.setHeader('allow', 'GET');
      response.end();
      return;
    }

    if (pathname !== '/health' && pathname !== '/ready') {
      response.statusCode = 404;
      response.end();
      return;
    }

    const readiness = await getServiceReadiness(options);
    const live = options.isRunning();
    const healthy = pathname === '/health' ? live : readiness.ready;
    response.statusCode = healthy ? 200 : 503;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      status: healthy ? (pathname === '/health' ? 'ok' : 'ready') : 'degraded',
      service: options.service,
      database: readiness.database ? 'connected' : 'disconnected',
      queue: readiness.queue ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    }));
  });

  let listening = false;

  return {
    server,
    start: () => new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        listening = true;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({
        host: listenOptions.host || '127.0.0.1',
        port: listenOptions.port ?? 8081
      });
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      if (!listening) {
        resolve();
        return;
      }
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        listening = false;
        resolve();
      });
    })
  };
}

async function checkDependency(dependency: HealthCheckDependency): Promise<boolean> {
  try {
    return await dependency.healthCheck();
  } catch {
    return false;
  }
}
