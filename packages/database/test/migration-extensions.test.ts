import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Static contract for the migration chain's optional dependencies.
 *
 * `migrator.ts` applies each file inside one transaction and rethrows on failure, so a single
 * unguarded statement that a host cannot satisfy aborts the whole chain: every later migration
 * never applies, and the database is left half-built while the process still boots.
 *
 * `001_initial_schema.sql` shows the intended pattern for an optional extension — a `DO $$` block
 * with `EXCEPTION WHEN OTHERS THEN NULL`. `014` and `015` created `pgcrypto` bare, which raises
 * `could not open extension control file` or `permission denied to create extension` on a host
 * without contrib or without extension rights. `pgcrypto` was also unnecessary: the defaults only
 * need `uuid_generate_v4()` (already created by `uuid-ossp` at `001`) and `gen_random_uuid()`
 * (built into PostgreSQL 13+).
 *
 * This is a text-level assertion because the database package has no integration test that runs a
 * migration — see `scheduled-jobs-schema.test.ts` for the same reasoning.
 */
describe('migration chain optional dependencies', () => {
  const migrationsDir = path.resolve(__dirname, '../src/migrations');

  const files = fs
    .readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort();

  /** Line numbers where a CREATE EXTENSION appears outside a `DO $$ ... END $$;` guard. */
  function unguardedExtensions(sql: string): number[] {
    const lines = sql.split(/\r?\n/);
    const offenders: number[] = [];
    let insideDoBlock = false;

    lines.forEach((line, index) => {
      if (/^\s*DO\s+\$\$/i.test(line)) insideDoBlock = true;
      else if (insideDoBlock && /^\s*END\s*\$\$\s*;?\s*$/i.test(line)) insideDoBlock = false;

      if (!insideDoBlock && /^\s*CREATE\s+EXTENSION/i.test(line)) {
        offenders.push(index + 1);
      }
    });

    return offenders;
  }

  it('finds the migration files it is meant to check', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('001_initial_schema.sql');
  });

  it('creates every extension inside an exception-guarded DO block', () => {
    const violations: string[] = [];

    for (const name of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
      for (const line of unguardedExtensions(sql)) {
        violations.push(`${name}:${line}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not depend on pgcrypto for a uuid default', () => {
    // gen_random_uuid() is core since PG13 and uuid_generate_v4() comes from uuid-ossp, which 001
    // already creates — so no default needs pgcrypto.
    const needingPgcrypto = files.filter(name => /pgcrypto/i.test(fs.readFileSync(path.join(migrationsDir, name), 'utf-8')));

    expect(needingPgcrypto).toEqual([]);
  });

  it('does not depend on a contrib extension for uuid generation', () => {
    // uuid_generate_v4() requires uuid-ossp, a contrib module. gen_random_uuid() is core since
    // PostgreSQL 13 (the deployment pins pg16), so the schema can build on a stock server with no
    // contrib packages and no extension privileges at all.
    const dependingOnUuidOssp = files.filter(name => /uuid_generate_v4/i.test(fs.readFileSync(path.join(migrationsDir, name), 'utf-8')));

    expect(dependingOnUuidOssp).toEqual([]);
  });
});
