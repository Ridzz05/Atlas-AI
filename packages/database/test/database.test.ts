import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Migrator } from '../src/migrator.js';

describe('@atlas/database tests', () => {
  it('has valid SQL migration files', () => {
    const migrationsDir = path.resolve(__dirname, '../src/migrations');
    expect(fs.existsSync(migrationsDir)).toBe(true);

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('001_initial_schema.sql');
    expect(files).toContain('006_durable_budget_reservations.sql');
    expect(files).toContain('007_run_leases.sql');
    expect(files).toContain('008_memory_maintenance.sql');
    expect(files).toContain('009_persisted_lead_rubrics.sql');

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      if (file === '001_initial_schema.sql') {
        expect(content).toContain('CREATE TABLE IF NOT EXISTS');
        expect(content).toContain('tasks');
        expect(content).toContain('runs');
        expect(content).toContain('approvals');
        expect(content).toContain('memory_items');
      }
      if (file === '003_durable_approval_execution.sql') {
        expect(content).toContain('ALTER TABLE approvals');
        expect(content).toContain('execution_token_signature');
        expect(content).toContain('idx_approvals_active_request_dedup');
      }
      if (file === '005_durable_run_cancellation.sql') {
        expect(content).toContain('cancel_requested');
        expect(content).toContain('cancel_reason');
      }
      if (file === '006_durable_budget_reservations.sql') {
        expect(content).toContain('reserved_usd');
        expect(content).toContain('budget_reservations');
      }
      if (file === '007_run_leases.sql') {
        expect(content).toContain('worker_id');
        expect(content).toContain('lease_expires_at');
      }
      if (file === '008_memory_maintenance.sql') {
        expect(content).toContain('idx_memory_items_expiry_lifecycle');
        expect(content).toContain('expires_at');
      }
      if (file === '009_persisted_lead_rubrics.sql') {
        expect(content).toContain('lead_rubrics');
        expect(content).toContain('is_active');
        expect(content).toContain('idx_lead_rubrics_single_active');
      }
    }
  });

  it('serializes concurrent migration runners with a PostgreSQL advisory lock', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql.trim());
        return { rows: [] };
      }),
      getPool: () => ({ connect: vi.fn().mockResolvedValue(client) })
    } as any;

    await new Migrator(db).runMigrations(path.resolve(__dirname, '../src/migrations'));

    expect(queries[0]).toContain('pg_advisory_lock');
    expect(queries.some(query => query.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    expect(queries.at(-1)).toContain('pg_advisory_unlock');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
