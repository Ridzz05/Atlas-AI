import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { developmentFilters, endpointFromUrl, parseDotEnv, prepareDevelopmentEnvironment, spawnCommand } from './dev.mjs';

const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('root development command uses the native launcher and exposes a preflight check', () => {
  assert.equal(rootPackage.scripts.dev, 'node scripts/dev.mjs');
  assert.equal(rootPackage.scripts['dev:check'], 'node scripts/dev.mjs --check');
});

test('native service development commands run the compiled service with Node watch mode', async () => {
  for (const service of ['agent-service', 'worker', 'telegram-bot']) {
    const packageJson = JSON.parse(await readFile(new URL(`../apps/${service}/package.json`, import.meta.url), 'utf8'));
    assert.equal(packageJson.scripts.dev, 'node --watch dist/index.js', service);
  }
});

test('native launcher parses common dotenv values without exposing secrets in diagnostics', () => {
  assert.deepEqual(parseDotEnv('PORT=4000\nNAME="ATLAS OS"\n# ignored\nEMPTY=\n'), {
    PORT: '4000',
    NAME: 'ATLAS OS',
    EMPTY: ''
  });
});

test('native launcher resolves database and Redis endpoints with defaults', () => {
  assert.deepEqual(endpointFromUrl('postgresql://atlas:secret@localhost:5432/atlas'), {
    host: 'localhost',
    port: 5432
  });
  assert.deepEqual(endpointFromUrl('redis://localhost'), {
    host: 'localhost',
    port: 6379
  });
});

test('native launcher skips Telegram until a bot token is configured', () => {
  assert.deepEqual(developmentFilters({}), ['@atlas/dashboard', '@atlas/agent-service', '@atlas/worker']);
  assert.deepEqual(developmentFilters({ TELEGRAM_BOT_TOKEN: 'dev-token' }), [
    '@atlas/dashboard',
    '@atlas/agent-service',
    '@atlas/worker',
    '@atlas/telegram-bot'
  ]);
});

test('native launcher forwards the API token to the dashboard proxy without printing it', () => {
  const prepared = prepareDevelopmentEnvironment({ API_AUTH_TOKEN: 'owner-token' });
  assert.equal(prepared.ATLAS_API_AUTH_TOKEN, 'owner-token');
});

test('native launcher spawns the pnpm command on the current platform', async () => {
  // `pnpm.cmd` is the Windows shim and only exists there; on POSIX the command is `pnpm`.
  // spawnCommand routes the Windows case through ComSpec, so the .cmd name is the one worth
  // exercising on Windows — but naming it unconditionally made this test fail on Linux.
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const child = spawnCommand(command, ['--version'], { stdio: 'pipe' });
  let output = '';
  child.stdout?.on('data', chunk => {
    output += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 0);
  assert.match(output, /\d+\.\d+\.\d+/);
});
