import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseClient } from './client.js';
import { rootLogger } from '@atlas/observability';

export class Migrator {
  constructor(private db: DatabaseClient) {}

  public async initMigrationTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async getAppliedMigrations(): Promise<Set<string>> {
    await this.initMigrationTable();
    const result = await this.db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
    return new Set(result.rows.map(r => r.version));
  }

  public async runMigrations(migrationsDir: string): Promise<string[]> {
    const applied = await this.getAppliedMigrations();
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const newlyApplied: string[] = [];

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      rootLogger.info(`Applying migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      const client = await this.db.getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        newlyApplied.push(file);
        rootLogger.info(`Successfully applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        rootLogger.error(`Failed to apply migration ${file}`, { error: String(err) });
        throw err;
      } finally {
        client.release();
      }
    }

    return newlyApplied;
  }
}
