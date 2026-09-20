import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const migrationsDir = path.resolve(__dirname, '../src/migrations');

function readMigration(name: string): string {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
}

function createTableBlock(sql: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!match) throw new Error(`Could not find a CREATE TABLE block for '${table}'`);
  return match[1];
}

/** Column names declared NOT NULL with no DEFAULT — an insert must supply every one. */
function notNullWithoutDefault(block: string): string[] {
  const columns: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    const column = line.match(/^([a-z_][a-z0-9_]*)\s+/i);
    if (!column) continue;

    const rest = line.slice(column[0].length);
    if (!/NOT NULL/i.test(rest)) continue;
    if (/DEFAULT/i.test(rest)) continue;

    columns.push(column[1].toLowerCase());
  }

  return columns;
}

function relaxedColumns(sql: string, table: string): string[] {
  return [...sql.matchAll(new RegExp(`ALTER TABLE\\s+${table}\\s+ALTER COLUMN\\s+([a-z_][a-z0-9_]*)\\s+DROP NOT NULL`, 'gi'))].map(match =>
    match[1].toLowerCase()
  );
}

function insertedColumns(repositoryPath: string, table: string): string[] {
  const source = fs.readFileSync(repositoryPath, 'utf-8');
  const match = source.match(new RegExp(`INSERT INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES`, 'i'));
  if (!match) throw new Error(`Could not find an INSERT statement for '${table}'`);

  return match[1]
    .split(',')
    .map(column => column.trim().toLowerCase())
    .filter(Boolean);
}

describe('scheduled_jobs schema contract', () => {
  const schema = readMigration('001_initial_schema.sql');
  const upgrade = readMigration('012_scheduled_jobs.sql');
  const repository = path.resolve(__dirname, '../src/repositories/scheduled-job.repository.ts');

  it('never leaves a required column that ScheduledJobRepository.create does not write', () => {
    // This is the regression guard for the clean-host failure that the README described as a
    // boot blocker: 001 declares `cron_expression` and `agent_id` NOT NULL, 012 adds the
    // columns the repository actually uses, but the repository writes neither of the legacy
    // two. The migration chain applied fine while the first real insert failed, so the bug
    // was invisible to every existing test. Here the two sides are compared directly.
    const required = [
      ...notNullWithoutDefault(createTableBlock(schema, 'scheduled_jobs')),
      ...notNullWithoutDefault(createTableBlock(upgrade, 'scheduled_jobs'))
    ];
    const written = insertedColumns(repository, 'scheduled_jobs');
    const relaxed = relaxedColumns(upgrade, 'scheduled_jobs');

    const unpopulated = [...new Set(required)].filter(column => !written.includes(column) && !relaxed.includes(column));

    expect(unpopulated).toEqual([]);
  });

  it('relaxes the legacy 001-only columns', () => {
    const relaxed = relaxedColumns(upgrade, 'scheduled_jobs');

    expect(relaxed).toContain('cron_expression');
    expect(relaxed).toContain('agent_id');
  });
});
