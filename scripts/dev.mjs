import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseDotEnv(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    values[key] = value;
  }

  return values;
}

export function loadDotEnvFile(filePath, environment = process.env) {
  if (!existsSync(filePath)) return environment;

  const values = parseDotEnv(readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

export function endpointFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const defaultPort = url.protocol === 'redis:' || url.protocol === 'rediss:' ? 6379 : 5432;
  return {
    host: url.hostname,
    port: Number(url.port) || defaultPort
  };
}

export function checkTcpEndpoint(endpoint, timeoutMs = 1500) {
  return new Promise(resolve => {
    let socket;
    try {
      socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export function developmentFilters(environment) {
  const filters = ['@atlas/dashboard', '@atlas/agent-service', '@atlas/worker'];
  if (environment.TELEGRAM_BOT_TOKEN?.trim()) filters.push('@atlas/telegram-bot');
  return filters;
}

export function prepareDevelopmentEnvironment(environment) {
  const prepared = { ...environment };
  if (!prepared.ATLAS_API_AUTH_TOKEN && prepared.API_AUTH_TOKEN) {
    prepared.ATLAS_API_AUTH_TOKEN = prepared.API_AUTH_TOKEN;
  }
  return prepared;
}

export async function assertNativeDependencies(environment) {
  const dependencies = [
    {
      name: 'PostgreSQL',
      variable: 'DATABASE_URL',
      fallback: 'postgresql://atlas:atlas@localhost:5432/atlas'
    },
    {
      name: 'Redis',
      variable: 'REDIS_URL',
      fallback: 'redis://localhost:6379'
    }
  ];
  const results = await Promise.all(
    dependencies.map(async dependency => {
      const rawUrl = environment[dependency.variable] || dependency.fallback;
      try {
        const endpoint = endpointFromUrl(rawUrl);
        return (await checkTcpEndpoint(endpoint)) ? null : `${dependency.name} (${endpoint.host}:${endpoint.port})`;
      } catch {
        return `${dependency.name} (${dependency.variable} is invalid)`;
      }
    })
  );
  const unavailable = results.filter(Boolean);

  if (unavailable.length > 0) {
    throw new Error(
      [
        'Native development dependencies are unavailable:',
        ...unavailable.map(item => `- ${item}`),
        'Start PostgreSQL and Redis as native host services, then run npm run dev again.',
        'Docker is optional and is not started by this command.'
      ].join('\n')
    );
  }
}

function packageManagerCommand() {
  if (process.platform !== 'win32') return 'pnpm';
  // Windows: use absolute path to avoid 'pnpm.cmd not recognized' when spawned via cmd.exe /d /s /c
  try {
    const candidate = path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd');
    if (candidate && existsSync(candidate)) return candidate;
  } catch {}
  return 'pnpm.cmd';
}

export function spawnCommand(command, args, options = {}) {
  if (process.platform !== 'win32') return spawn(command, args, options);

  const env = options.env || process.env;
  let pathEnv = env.PATH || env.Path || process.env.PATH || '';
  if (process.env.APPDATA) {
    const npmPath = path.join(process.env.APPDATA, 'npm');
    if (!pathEnv.toLowerCase().includes(npmPath.toLowerCase())) {
      pathEnv = `${npmPath};${pathEnv}`;
    }
  }

  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
    ...options,
    env: { ...env, PATH: pathEnv }
  });
}

function runProcess(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd: rootDir,
      env: environment,
      stdio: 'inherit',
      windowsHide: false
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runDevelopment(environment) {
  try {
    rmSync(path.join(rootDir, 'apps/dashboard/.next'), { recursive: true, force: true });
    rmSync(path.join(rootDir, 'apps/dashboard/.next-dev'), { recursive: true, force: true });
  } catch {}

  const packageManager = packageManagerCommand();
  const initialBuild = await runProcess(packageManager, ['exec', 'tsc', '--build', 'tsconfig.dev.json'], environment);
  if (initialBuild !== 0) process.exitCode = initialBuild;
  if (initialBuild !== 0) return;

  const compiler = spawnCommand(packageManager, ['exec', 'tsc', '--build', '--watch', 'tsconfig.dev.json', '--preserveWatchOutput'], {
    cwd: rootDir,
    env: environment,
    stdio: 'inherit',
    windowsHide: false
  });

  let services;
  let extraChildren = [];
  // Windows: turbo fails to locate pnpm binary (cannot find binary path) due to shim resolution.
  // Fallback: spawn each workspace dev directly via pnpm --filter, bypassing turbo.
  if (process.platform === 'win32') {
    const filters = developmentFilters(environment);
    const filterToPkg = {
      '@atlas/dashboard': { dir: 'apps/dashboard', cmd: packageManager, args: ['exec', 'next', 'dev', '-p', '3000'] },
      '@atlas/agent-service': { dir: 'apps/agent-service', cmd: packageManager, args: ['exec', 'node', '--watch', 'dist/index.js'] },
      '@atlas/worker': { dir: 'apps/worker', cmd: packageManager, args: ['exec', 'node', '--watch', 'dist/index.js'] },
      '@atlas/telegram-bot': { dir: 'apps/telegram-bot', cmd: packageManager, args: ['exec', 'node', '--watch', 'dist/index.js'] }
    };
    const devProcesses = filters
      .map(f => filterToPkg[f])
      .filter(Boolean)
      .map(cfg =>
        spawnCommand(cfg.cmd, cfg.args, {
          cwd: path.join(rootDir, cfg.dir),
          env: environment,
          stdio: 'inherit',
          windowsHide: false
        })
      );
    // Use first as primary `services`, rest as extraChildren so signal handling covers all
    services = devProcesses[0];
    extraChildren = devProcesses.slice(1);
    // Dashboard needs its own .next cleanup already done; ensure Next can start without turbo
    if (!services) {
      throw new Error('No development filters matched for Windows fallback');
    }
  } else {
    const turboFilters = developmentFilters(environment).map(filter => `--filter=${filter}`);
    services = spawnCommand(packageManager, ['exec', 'turbo', 'run', 'dev', ...turboFilters], {
      cwd: rootDir,
      env: environment,
      stdio: 'inherit',
      windowsHide: false
    });
  }
  const children = [compiler, services, ...extraChildren];
  let stopping = false;

  const stopChildren = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGINT');
    setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      }
    }, 2000).unref();
  };

  const handleSignal = () => stopChildren();
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  await new Promise(resolve => {
    let remaining = children.length;
    for (const child of children) {
      child.once('error', error => {
        if (!stopping) {
          console.error(error.message);
          process.exitCode = 1;
          stopChildren();
        }
      });
      child.once('exit', code => {
        if (!stopping) {
          process.exitCode = code ?? 1;
          stopChildren();
        }
        remaining -= 1;
        if (remaining === 0) resolve();
      });
    }
  });
  process.removeListener('SIGINT', handleSignal);
  process.removeListener('SIGTERM', handleSignal);
}

export async function main(argv = process.argv.slice(2), environment = loadDotEnvFile(path.join(rootDir, '.env'), { ...process.env })) {
  const preparedEnvironment = prepareDevelopmentEnvironment(environment);
  await assertNativeDependencies(preparedEnvironment);
  if (argv.includes('--check')) {
    process.stdout.write('Native development dependencies are reachable. Docker is optional.\n');
    return;
  }
  await runDevelopment(preparedEnvironment);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
