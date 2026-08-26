import { DatabaseClient } from '../client.js';

export interface TelegramControlState {
  paused: boolean;
  emergencyStop: boolean;
  updatedBy: string | null;
  updatedAt: Date | string | null;
}

export class TelegramStateRepository {
  constructor(private db: DatabaseClient) {}

  public async claimUpdate(updateId: number): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO telegram_updates (update_id)
       VALUES ($1)
       ON CONFLICT (update_id) DO NOTHING
       RETURNING update_id`,
      [updateId]
    );
    return result.rows.length > 0;
  }

  public async getControlState(): Promise<TelegramControlState> {
    const result = await this.db.query(
      `SELECT paused, emergency_stop, updated_by, updated_at
       FROM telegram_control_state
       WHERE id = 'singleton'`
    );
    return this.mapState(result.rows[0]);
  }

  public async setPaused(paused: boolean, updatedBy: string): Promise<TelegramControlState> {
    const result = await this.db.query(
      `INSERT INTO telegram_control_state (id, paused, emergency_stop, updated_by, updated_at)
       VALUES ('singleton', $1, FALSE, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         paused = $1,
         updated_by = $2,
         updated_at = NOW()
       RETURNING paused, emergency_stop, updated_by, updated_at`,
      [paused, updatedBy]
    );
    return this.mapState(result.rows[0]);
  }

  public async setEmergencyStop(active: boolean, updatedBy: string): Promise<TelegramControlState> {
    const result = await this.db.query(
      `INSERT INTO telegram_control_state (id, paused, emergency_stop, updated_by, updated_at)
       VALUES ('singleton', $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         paused = CASE WHEN $2 THEN TRUE ELSE FALSE END,
         emergency_stop = $2,
         updated_by = $3,
         updated_at = NOW()
       RETURNING paused, emergency_stop, updated_by, updated_at`,
      [active, active, updatedBy]
    );
    return this.mapState(result.rows[0]);
  }

  public async resume(updatedBy: string): Promise<TelegramControlState> {
    return this.setEmergencyStop(false, updatedBy);
  }

  public async pruneUpdates(olderThanDays = 30): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM telegram_updates
       WHERE claimed_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [olderThanDays]
    );
    return result.rowCount || 0;
  }

  private mapState(row: any): TelegramControlState {
    return {
      paused: Boolean(row?.paused),
      emergencyStop: Boolean(row?.emergency_stop),
      updatedBy: row?.updated_by || null,
      updatedAt: row?.updated_at || null
    };
  }
}
