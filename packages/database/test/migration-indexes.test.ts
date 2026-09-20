import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Static contract: an index must be on the columns the query uses.
 *
 * `event_outbox` is append-only and grows without bound, and its readers both work on
 * `occurred_at` — `list()` filters `occurred_at > $1` and sorts by it, `listAfterId()` uses the
 * keyset predicate `(occurred_at, event_id) > ($1, $2)`. Migration 002 indexed `created_at`
 * instead, a column no query mentions, so every read was a sequential scan plus a sort and the
 * replay path could not use an index for its row comparison.
 *
 * This asserts the specific pairing rather than trying to derive index requirements from SQL
 * generically, which would be fragile; it exists to stop the same drift coming back.
 */
describe('event_outbox index matches its readers', () => {
  const migrationsDir = path.resolve(__dirname, '../src/migrations');
  const repositoryPath = path.resolve(__dirname, '../src/repositories/event.repository.ts');

  const indexColumns = fs
    .readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .flatMap(name => {
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
      return [...sql.matchAll(/CREATE INDEX[^;]*ON\s+event_outbox\s*\(([^)]*)\)/gi)].map(match =>
        (match[1] as string)
          .split(',')
          .map(column => column.trim().toLowerCase())
          .filter(Boolean)
      );
    });

  const repositorySource = fs.readFileSync(repositoryPath, 'utf-8');

  it('has at least one index on event_outbox', () => {
    expect(indexColumns.length).toBeGreaterThan(0);
  });

  it('indexes the columns the readers filter and sort on', () => {
    // The columns the repository actually uses on this table.
    const usedInWhere = [...repositorySource.matchAll(/occurred_at\s*>\s*\$/g)].length > 0;
    const usesKeyset = repositorySource.includes('(occurred_at, event_id) >');

    expect(usedInWhere).toBe(true);
    expect(usesKeyset).toBe(true);

    const coversOccurredAt = indexColumns.some(columns => columns[0] === 'occurred_at');
    const coversKeyset = indexColumns.some(columns => columns[0] === 'occurred_at' && columns[1] === 'event_id');

    expect(coversOccurredAt).toBe(true);
    expect(coversKeyset).toBe(true);
  });
});
