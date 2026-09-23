#!/usr/bin/env node
/**
 * Live API verification: the real Fastify server against real PostgreSQL repositories.
 *
 * Everything else in the suite either mocks the database or injects a fake store, so the wiring
 * between route, repository and store is assumed rather than exercised. This boots `buildServer` with
 * the repositories `createAtlasRuntime` builds in production, injects real HTTP requests, and checks
 * the effects in the database.
 *
 * It found two things nothing else could: that the memory promotion loop was unreachable end to end,
 * and that the intake gate had no control-state source under a plain `...runtime` spread (the runtime
 * names it `telegramStateRepo`, the server option is `controlStateRepo`).
 *
 * The whole run happens inside a scratch schema — created, used, dropped — so the configured database
 * is left untouched. `packages/database`, `packages/runtime` and `apps/agent-service` must be built
 * first (`pnpm build`).
 *
 * Usage:  node scripts/verify-api-live.mjs        (or: pnpm api:verify)
 * Exits non-zero if any check fails.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_URL = `file:///${ROOT.replace(/\\/g, '/')}`;
const require = createRequire(join(ROOT, 'packages', 'database', 'package.json'));
const { Client } = require('pg');

function readEnvValue(key) {
  let text;
  try {
    text = readFileSync(join(ROOT, '.env'), 'utf8');
  } catch {
    throw new Error(`No .env at ${ROOT} — this script needs DATABASE_URL.`);
  }
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) throw new Error(`${key} not found in .env`);
  let value = match[1].trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  return value;
}

const connectionString = readEnvValue('DATABASE_URL');
const schemaName = `atlas_api_${Date.now().toString(36)}`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const db = new Client({ connectionString });
await db.connect();
await db.query(`CREATE SCHEMA "${schemaName}"`);
await db.query(`SET search_path TO "${schemaName}"`);
console.log(`scratch schema: ${schemaName}\n`);

const { DatabaseClient } = await import(`${ROOT_URL}/packages/database/dist/client.js`);
const { EnvConfigSchema } = await import(`${ROOT_URL}/packages/shared/dist/index.js`);
const { createAtlasRuntime } = await import(`${ROOT_URL}/packages/runtime/dist/index.js`);
const { buildServer } = await import(`${ROOT_URL}/apps/agent-service/dist/server.js`);
const { InMemoryTaskQueue } = await import(`${ROOT_URL}/packages/orchestration/dist/index.js`);
const { MemoryTools, MemoryRetriever, MemoryProposalService } = await import(`${ROOT_URL}/packages/memory/dist/index.js`);

// Route every connection into the scratch schema through the connection string, not by issuing
// `SET search_path` per query: DatabaseClient.query uses a pool, so a per-query SET lands on one
// pooled connection and the next query may get another. `options=-c search_path=...` applies to every
// connection the pool opens, which makes this deterministic.
const scopedUrl = new URL(connectionString);
scopedUrl.searchParams.set('options', `-c search_path=${schemaName}`);

const API_TOKEN = 'live-verify-token-32-characters-min';
const config = EnvConfigSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: connectionString,
  API_AUTH_TOKEN: API_TOKEN
});

let server;
try {
  const runtime = await createAtlasRuntime(config, {
    db: new DatabaseClient({ connectionString: scopedUrl.toString() }),
    taskQueue: new InMemoryTaskQueue(),
    migrate: true,
    seed: true
  });
  check('the runtime boots and migrates a fresh schema', Boolean(runtime.memoryStore));

  server = buildServer({
    config,
    ...runtime,
    // The runtime names this `telegramStateRepo`; the server option is `controlStateRepo`. The real
    // entry point maps it explicitly, and so must this harness — spreading the runtime alone leaves
    // the intake gate without a source, which is exactly the wiring gap the gate refuses to ignore.
    controlStateRepo: runtime.telegramStateRepo,
    processQueue: false
  });
  await server.ready();

  const auth = { authorization: `Bearer ${API_TOKEN}` };
  const json = { ...auth, 'content-type': 'application/json' };

  const unauthorized = await server.inject({ method: 'GET', url: '/api/v1/memory' });
  check('the operator token is required', unauthorized.statusCode === 401, `status ${unauthorized.statusCode}`);

  // --- the memory loop, as an agent and as the operator ----------------------
  const memoryTools = new MemoryTools(
    new MemoryRetriever(runtime.memoryStore),
    new MemoryProposalService(runtime.memoryStore, { record: event => runtime.auditRepo.create(event) }),
    runtime.memoryStore
  );

  const proposal = await memoryTools.proposeWrite({
    type: 'entity',
    content: 'Live verification: Mega Gym Palembang has 500 active members',
    author: 'ned',
    scope: 'approved_research',
    confidence: 0.9
  });
  check('an agent proposal is written as unverified', proposal.status === 'unverified' && !proposal.duplicate, proposal.id);

  const repeat = await memoryTools.proposeWrite({
    type: 'entity',
    content: 'Live verification: Mega Gym Palembang has 500 active members',
    author: 'layla',
    scope: 'approved_research'
  });
  check('an exact repeat is reported as a duplicate', repeat.duplicate && repeat.id === proposal.id);

  const beforeVerify = await memoryTools.search({ query: 'Mega Gym Palembang members', allowedScopes: ['approved_research'] });
  check('agents cannot read an unverified proposal', beforeVerify.results.length === 0, `${beforeVerify.results.length} result(s)`);

  const promote = await server.inject({ method: 'POST', url: `/api/v1/memory/${proposal.id}/verify`, headers: auth });
  check(
    'the operator route promotes the proposal',
    promote.statusCode === 200 && JSON.parse(promote.body).item.status === 'verified',
    `status ${promote.statusCode}`
  );

  const afterVerify = await memoryTools.search({ query: 'Mega Gym Palembang members', allowedScopes: ['approved_research'] });
  check(
    'agents can now read it',
    afterVerify.results.some(r => r.id === proposal.id),
    `${afterVerify.results.length} result(s)`
  );

  const auditRows = await db.query(`SELECT action, actor, target FROM "${schemaName}".audit_events ORDER BY timestamp DESC LIMIT 5`);
  const verifiedAudit = auditRows.rows.find(r => r.action === 'memory.verified');
  check(
    'the promotion is audited durably',
    Boolean(verifiedAudit) && verifiedAudit.target === proposal.id,
    verifiedAudit ? `${verifiedAudit.actor} → ${verifiedAudit.action}` : 'no memory.verified row'
  );

  const statusRow = await db.query(`SELECT status FROM "${schemaName}".memory_items WHERE id = $1`, [proposal.id]);
  check('the status change is durable in the database', statusRow.rows[0]?.status === 'verified', statusRow.rows[0]?.status);

  const deprecate = await server.inject({ method: 'POST', url: `/api/v1/memory/${proposal.id}/deprecate`, headers: auth });
  const afterDeprecate = await memoryTools.search({ query: 'Mega Gym Palembang members', allowedScopes: ['approved_research'] });
  check(
    'deprecation removes it from agent reads',
    deprecate.statusCode === 200 && afterDeprecate.results.length === 0,
    `status ${deprecate.statusCode}, ${afterDeprecate.results.length} result(s)`
  );

  // --- intake and the operator's stop ---------------------------------------
  const created = await server.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: json,
    payload: { title: 'Live intake', goal: 'Live intake verification', assignedAgent: 'chief' }
  });
  check('task intake persists through the real repository', created.statusCode === 201, `status ${created.statusCode}`);
  const taskRow = await db.query(`SELECT count(*)::int AS n FROM "${schemaName}".tasks`);
  check('the task row is durable', taskRow.rows[0].n === 1, `${taskRow.rows[0].n} row(s)`);

  const paused = await server.inject({
    method: 'POST',
    url: '/api/v1/control/pause',
    headers: json,
    payload: { reason: 'live verification' }
  });
  check('the pause action is accepted', paused.statusCode === 200, `status ${paused.statusCode}`);
  const controlState = await db.query(`SELECT paused, emergency_stop FROM "${schemaName}".telegram_control_state WHERE id = 'singleton'`);
  check('the pause is durable in the control state', controlState.rows[0]?.paused === true, JSON.stringify(controlState.rows[0] ?? null));

  const blocked = await server.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: json,
    payload: { title: 'Blocked', goal: 'Blocked intake', assignedAgent: 'chief' }
  });
  check('the intake gate blocks a paused system', blocked.statusCode === 423, `status ${blocked.statusCode}`);

  const taskCountAfter = await db.query(`SELECT count(*)::int AS n FROM "${schemaName}".tasks`);
  check('nothing was persisted behind the stop', taskCountAfter.rows[0].n === 1, `${taskCountAfter.rows[0].n} row(s)`);

  const notFound = await server.inject({
    method: 'GET',
    url: '/api/v1/memory/123e4567-e89b-12d3-a456-426614174999',
    headers: auth
  });
  check('an unknown memory id answers 404', notFound.statusCode === 404, `status ${notFound.statusCode}`);

  // --- the model provider probe ----------------------------------------------
  // The dashboard's "is this credential working?" button posts here. A route that exists in the
  // source but is not registered by the real composition root is exactly the wiring gap this harness
  // exists to catch, and an unknown provider answers without touching the network.
  const probeUnknown = await server.inject({
    method: 'POST',
    url: '/api/v1/settings/model-provider/test',
    headers: json,
    payload: { provider: 'not-a-provider' }
  });
  check(
    'the provider probe is registered and refuses a provider this system cannot build',
    probeUnknown.statusCode === 400 && JSON.parse(probeUnknown.body).supportedProviders.includes('zrouter'),
    `status ${probeUnknown.statusCode}`
  );
} finally {
  if (server) await server.close().catch(() => undefined);
  await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await db.end();
  console.log(`\ndropped scratch schema ${schemaName}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
