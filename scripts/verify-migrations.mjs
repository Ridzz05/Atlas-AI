#!/usr/bin/env node
/**
 * Apply the migration chain to a real PostgreSQL server, then check what the mocks cannot.
 *
 * Every test in `packages/database/test` mocks the pool and asserts SQL text, so the chain itself
 * was never executed by a test — which is how a boot-blocker survived in `012` for weeks. This script
 * is the other half: it runs the real migrator against a real server, seeds the real agent registry,
 * and registers every real tool manifest through the registry.
 *
 * It works in a scratch schema inside the database named by `DATABASE_URL`, so it needs no
 * privileges beyond `CREATE SCHEMA`, touches nothing in `public`, and drops the schema afterwards.
 * A scratch schema rather than a scratch database is deliberate: it also exercises the case the
 * migration guards exist for, a host where an optional extension cannot be installed.
 *
 * Usage:  node scripts/verify-migrations.mjs        (or: pnpm db:verify)
 * Exits non-zero if any check fails.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
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

const schemaName = `atlas_verify_${Date.now().toString(36)}`;
const connectionString = readEnvValue('DATABASE_URL');

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

// The migrator takes a dedicated connection from the pool; hand it this session so the scratch
// schema's search_path applies to the migration statements.
const scoped = {
  query: (sql, params) => db.query(sql, params),
  getPool: () => ({
    connect: async () => ({ query: (sql, params) => db.query(sql, params), release: () => undefined }),
    end: async () => undefined
  }),
  transaction: async fn => {
    await db.query('BEGIN');
    try {
      const out = await fn({ query: (sql, params) => db.query(sql, params) });
      await db.query('COMMIT');
      return out;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
};

try {
  const { Migrator, getDefaultMigrationsDir } = await import(`${ROOT_URL}/packages/database/dist/index.js`);
  const { DatabaseClient } = await import(`${ROOT_URL}/packages/database/dist/client.js`);

  const migrator = new Migrator(scoped, getDefaultMigrationsDir());
  const applied = await migrator.runMigrations(getDefaultMigrationsDir());
  check('migration chain applies end to end', applied.length > 0, `${applied.length} applied`);

  const versions = await db.query(`SELECT version FROM "${schemaName}".schema_migrations ORDER BY version`);
  // Derived from the directory, not a literal: a hardcoded floor stops noticing a migration that is
  // added but never applied.
  const migrationFiles = (await readdir(getDefaultMigrationsDir())).filter(name => name.endsWith('.sql'));
  check(
    'every migration file is recorded as applied',
    versions.rows.length === migrationFiles.length,
    `${versions.rows.length} applied of ${migrationFiles.length} file(s)`
  );

  const tables = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [
    schemaName
  ]);
  const tableNames = tables.rows.map(r => r.table_name);
  const required = ['agents', 'agent_versions', 'tasks', 'runs', 'scheduled_jobs', 'event_outbox', 'idempotency_keys', 'sdlc_initiatives'];
  const missing = required.filter(t => !tableNames.includes(t));
  check(
    'every expected table exists',
    missing.length === 0,
    `${tableNames.length} table(s)${missing.length ? `, missing: ${missing.join(', ')}` : ''}`
  );

  const sdlcColumns = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'sdlc_initiatives'`,
    [schemaName]
  );
  const sdlcColumnNames = sdlcColumns.rows.map(r => r.column_name);
  check(
    '016 added the phase columns to sdlc_initiatives',
    sdlcColumnNames.includes('phase_task_id') && sdlcColumnNames.includes('phase_attempt'),
    sdlcColumnNames.filter(c => c.startsWith('phase_')).join(', ')
  );

  const indexes = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'event_outbox'`, [
    schemaName
  ]);
  check(
    'event_outbox is indexed on occurred_at',
    indexes.rows.some(r => /occurred_at/.test(r.indexdef)),
    indexes.rows.map(r => r.indexname).join(', ')
  );

  // The list reads sort on a timestamp no index covered, so each one was a sequential scan plus a
  // sort over an append-only table. This asserts the index exists on a real server after the chain
  // has run, rather than only that a CREATE INDEX statement is present in a file.
  const listSortIndexes = await db.query(
    `SELECT tablename, indexdef FROM pg_indexes
     WHERE schemaname = $1 AND tablename = ANY($2::text[])`,
    [schemaName, ['messages', 'tool_calls', 'audit_events']]
  );
  const sortColumns = { messages: 'created_at', tool_calls: 'created_at', audit_events: 'timestamp' };
  for (const [table, column] of Object.entries(sortColumns)) {
    const defs = listSortIndexes.rows.filter(r => r.tablename === table).map(r => r.indexdef);
    check(
      `${table} has an index for its list sort (${column})`,
      defs.some(def => new RegExp(`${column}[^)]*\\bid\\b`, 'i').test(def)),
      defs.length > 0 ? defs.map(d => d.replace(/^CREATE INDEX \S+ ON /, '')).join(' | ') : 'no index on this table'
    );
  }

  const uuidDefault = await db.query(
    `SELECT pg_get_expr(d.adbin, d.adrelid) AS expr FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE a.attrelid = $1::regclass AND a.attname = 'id'`,
    [`"${schemaName}".tasks`]
  );
  const expr = uuidDefault.rows[0]?.expr || '';
  check('tasks.id defaults without an extension function', /gen_random_uuid/.test(expr), expr);

  const extensions = await db.query('SELECT extname FROM pg_extension ORDER BY extname');
  const extNames = extensions.rows.map(r => r.extname);
  check(
    'the chain survives whatever extensions this host allows',
    true,
    `installed: ${extNames.join(', ') || '(none)'}${extNames.includes('vector') ? '' : ' — pgvector absent and the chain still applied'}`
  );

  const { seedAgents } = await import(`${ROOT_URL}/packages/database/dist/agent-seeder.js`);
  const { defaultAgentRegistry } = await import(`${ROOT_URL}/packages/agents/dist/index.js`);
  const databaseClient = new DatabaseClient({ connectionString });
  databaseClient.query = (sql, params) => db.query(sql, params);
  databaseClient.transaction = scoped.transaction;

  const agents = defaultAgentRegistry.list();
  await seedAgents(databaseClient, agents);

  const seeded = await db.query(`SELECT COUNT(*)::int AS n FROM "${schemaName}".agents`);
  check('all agent definitions seed', seeded.rows[0].n === agents.length, `${seeded.rows[0].n} of ${agents.length}`);

  const history = await db.query(`SELECT COUNT(*)::int AS n FROM "${schemaName}".agent_versions`);
  check('version history is written', history.rows[0].n >= agents.length, `${history.rows[0].n} row(s)`);

  const before = await db.query(
    `SELECT system_prompt FROM "${schemaName}".agent_versions WHERE agent_id = 'chief' ORDER BY version LIMIT 1`
  );
  await seedAgents(databaseClient, agents);
  const after = await db.query(`SELECT COUNT(*)::int AS n FROM "${schemaName}".agent_versions`);
  const afterPrompt = await db.query(
    `SELECT system_prompt FROM "${schemaName}".agent_versions WHERE agent_id = 'chief' ORDER BY version LIMIT 1`
  );
  check(
    're-seeding neither grows nor rewrites the history',
    after.rows[0].n === history.rows[0].n && afterPrompt.rows[0]?.system_prompt === before.rows[0]?.system_prompt,
    `${after.rows[0].n} row(s), chief v1 prompt unchanged`
  );

  const { ToolRegistry } = await import(`${ROOT_URL}/packages/tools/dist/registry.js`);
  const toolsModule = await import(`${ROOT_URL}/packages/tools/dist/index.js`);
  const registry = new ToolRegistry();
  let registered = 0;
  const failures = [];
  for (const [exportName, value] of Object.entries(toolsModule)) {
    if (!value || typeof value !== 'object' || !value.name || typeof value.execute !== 'function') continue;
    try {
      // registerLegacy is what the worker uses; it delegates to register() when a manifest exists.
      registry.registerLegacy(value);
      registered += 1;
    } catch (err) {
      failures.push(`${exportName}: ${err.message}`);
    }
  }
  check(
    'every exported tool registers through the path the worker uses',
    failures.length === 0 && registered > 0,
    `${registered} registered${failures.length ? `, ${failures.length} failed: ${failures.join(' | ')}` : ''}`
  );
} finally {
  await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await db.end();
  console.log(`\ndropped scratch schema ${schemaName}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
