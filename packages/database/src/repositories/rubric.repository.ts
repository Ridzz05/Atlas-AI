import { DatabaseClient } from '../client.js';

export interface LeadRubricRecord {
  version: string;
  definition: Record<string, unknown>;
  isActive: boolean;
  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface LeadRubricDefinitionInput {
  version: string;
  definition: Record<string, unknown>;
  createdBy: string;
  activate?: boolean;
}

export class LeadRubricRepository {
  private static readonly ACTIVE_LOCK_KEY = 'atlas:lead-rubrics:active';

  constructor(private db: DatabaseClient) {}

  public async list(): Promise<LeadRubricRecord[]> {
    const result = await this.db.query(
      `
      SELECT version, definition, is_active, created_by, created_at, updated_at
      FROM lead_rubrics
      ORDER BY created_at ASC, version ASC
    `,
      []
    );
    return result.rows.map(row => this.mapRow(row));
  }

  public async get(version: string): Promise<LeadRubricRecord | null> {
    this.assertVersion(version);
    const result = await this.db.query(
      `
      SELECT version, definition, is_active, created_by, created_at, updated_at
      FROM lead_rubrics
      WHERE version = $1
    `,
      [version]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async getActive(): Promise<LeadRubricRecord | null> {
    const result = await this.db.query(
      `
      SELECT version, definition, is_active, created_by, created_at, updated_at
      FROM lead_rubrics
      WHERE is_active = TRUE
      LIMIT 1
    `,
      []
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  public async create(input: LeadRubricDefinitionInput): Promise<LeadRubricRecord> {
    this.assertInput(input);
    return this.db.transaction(async client => {
      if (input.activate) {
        await this.lockActive(client);
        await client.query(`
          UPDATE lead_rubrics
          SET is_active = FALSE, updated_at = NOW()
          WHERE is_active = TRUE
        `);
      }

      const result = await client.query(
        `
        INSERT INTO lead_rubrics (version, definition, is_active, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING version, definition, is_active, created_by, created_at, updated_at
      `,
        [input.version, JSON.stringify(input.definition), input.activate === true, input.createdBy]
      );
      return this.mapRow(result.rows[0]);
    });
  }

  public async ensureDefault(input: LeadRubricDefinitionInput): Promise<void> {
    this.assertInput(input);
    await this.db.transaction(async client => {
      await this.lockActive(client);
      await client.query(
        `
        INSERT INTO lead_rubrics (version, definition, is_active, created_by)
        VALUES ($1, $2, FALSE, $3)
        ON CONFLICT (version) DO NOTHING
      `,
        [input.version, JSON.stringify(input.definition), input.createdBy]
      );

      const active = await client.query('SELECT version FROM lead_rubrics WHERE is_active = TRUE LIMIT 1');
      if (active.rows.length > 0) return;

      await client.query(
        `
        UPDATE lead_rubrics
        SET is_active = TRUE, updated_at = NOW()
        WHERE version = $1
      `,
        [input.version]
      );
    });
  }

  public async activate(version: string): Promise<LeadRubricRecord | null> {
    this.assertVersion(version);
    return this.db.transaction(async client => {
      await this.lockActive(client);
      const existing = await client.query('SELECT version FROM lead_rubrics WHERE version = $1 FOR UPDATE', [version]);
      if (existing.rows.length === 0) return null;

      await client.query(`
        UPDATE lead_rubrics
        SET is_active = FALSE, updated_at = NOW()
        WHERE is_active = TRUE
      `);
      const updated = await client.query(
        `
        UPDATE lead_rubrics
        SET is_active = TRUE, updated_at = NOW()
        WHERE version = $1
        RETURNING version, definition, is_active, created_by, created_at, updated_at
      `,
        [version]
      );
      return this.mapRow(updated.rows[0]);
    });
  }

  private async lockActive(client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LeadRubricRepository.ACTIVE_LOCK_KEY]);
  }

  private assertInput(input: LeadRubricDefinitionInput): void {
    this.assertVersion(input.version);
    if (!input.createdBy || input.createdBy.trim().length === 0 || input.createdBy.length > 128) {
      throw new RangeError('createdBy must be a non-empty string of at most 128 characters.');
    }
    if (!input.definition || typeof input.definition !== 'object' || Array.isArray(input.definition)) {
      throw new TypeError('definition must be a JSON object.');
    }
  }

  private assertVersion(version: string): void {
    if (!version || version.trim().length === 0 || version.length > 128) {
      throw new RangeError('version must be a non-empty string of at most 128 characters.');
    }
  }

  private mapRow(row: any): LeadRubricRecord {
    if (!row) throw new Error('Lead rubric repository returned an empty row.');
    let definition = row.definition;
    if (typeof definition === 'string') definition = JSON.parse(definition);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error('Lead rubric repository returned an invalid definition.');
    }
    return {
      version: row.version,
      definition,
      isActive: Boolean(row.is_active),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
