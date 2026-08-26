import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('@atlas/database tests', () => {
  it('has valid SQL migration files', () => {
    const migrationsDir = path.resolve(__dirname, '../src/migrations');
    expect(fs.existsSync(migrationsDir)).toBe(true);

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('001_initial_schema.sql');

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
    }
  });
});
