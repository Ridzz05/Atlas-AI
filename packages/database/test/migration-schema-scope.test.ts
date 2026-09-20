import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Static contract: a migration's existence checks must look at the table its DDL targets.
 *
 * `012` runs `CREATE TABLE IF NOT EXISTS scheduled_jobs` — which is a no-op on a clean host, because
 * `001` already created that table — and then does the real work through `DO $$` guards that read
 * `information_schema.columns`. Those guards had no `table_schema` filter, so they matched a
 * `scheduled_jobs` in ANY schema the role can see. The DDL writes to the first schema in
 * `search_path`; the guard read from every schema. When the two disagree the guard skips an `ALTER`
 * that was needed and the statement after it fails on a missing column.
 *
 * That is how the failure surfaced: applying the chain to a scratch schema reported
 * `column "enabled" does not exist`, because a `scheduled_jobs` in `public` already had `enabled`.
 * The production schema is the only one, so it happened to work there — and that is exactly why
 * `packages/database` could never run the chain in a test.
 */
const migrationsDir = path.join(__dirname, '..', 'src', 'migrations');

function migrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort();
}

describe('migration schema qualification', () => {
  it('finds the migration files', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(17);
  });

  it('scopes every information_schema column check to the current schema', () => {
    const offenders: string[] = [];

    for (const file of migrationFiles()) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const checks = sql.match(/SELECT 1 FROM information_schema\.columns[\s\S]{0,220}?THEN/g) ?? [];
      for (const check of checks) {
        if (!/table_schema\s*=\s*current_schema\(\)/.test(check)) {
          offenders.push(
            `${file}: ${check
              .split('\n')
              .find(line => line.includes('information_schema'))
              ?.trim()}`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('scopes every pg_constraint check to the current schema', () => {
    const offenders: string[] = [];

    for (const file of migrationFiles()) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Check the whole statement, not the line: the query is spread over several lines.
      const statements = sql.match(/SELECT 1 FROM pg_constraint[\s\S]{0,300}?\)\s*THEN/g) ?? [];
      for (const statement of statements) {
        if (!/n\.nspname\s*=\s*current_schema\(\)/.test(statement)) {
          offenders.push(`${file}: ${statement.split('\n').slice(0, 2).join(' ').trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // A migration that reads another schema's table also cannot be applied twice safely, so this
  // doubles as a check that the chain is idempotent in an isolated schema.
  it('keeps the scheduled-jobs upgrade guards pointed at one table', () => {
    const sql = fs.readFileSync(path.join(migrationsDir, '012_scheduled_jobs.sql'), 'utf8');
    const guards = sql.match(/information_schema\.columns WHERE[^\n]*/g) ?? [];

    expect(guards.length).toBeGreaterThan(5);
    for (const guard of guards) {
      expect(guard).toContain("table_name = 'scheduled_jobs'");
      expect(guard).toContain('table_schema = current_schema()');
    }
  });
});
