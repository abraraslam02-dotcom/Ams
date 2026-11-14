import type Database from 'better-sqlite3';

export function ensureResetStateTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_system_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getDbResetEpoch(db: Database.Database): string | null {
  try {
    ensureResetStateTable(db);
    const row = db
      .prepare("SELECT state_value FROM app_system_state WHERE state_key = 'db_reset_epoch' LIMIT 1")
      .get() as { state_value?: string } | undefined;
    return row?.state_value ? String(row.state_value) : null;
  } catch {
    return null;
  }
}

export function getDbResetTimestamp(db: Database.Database): string | null {
  try {
    ensureResetStateTable(db);
    const row = db
      .prepare("SELECT state_value FROM app_system_state WHERE state_key = 'db_reset_at' LIMIT 1")
      .get() as { state_value?: string } | undefined;
    return row?.state_value ? String(row.state_value) : null;
  } catch {
    return null;
  }
}

export function bumpDbResetEpoch(
  db: Database.Database,
  reason = 'manual_reset'
): { epoch: string; resetAt: string } {
  ensureResetStateTable(db);
  const nowIso = new Date().toISOString();
  const epoch = `RESET-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const upsert = db.prepare(`
    INSERT INTO app_system_state (state_key, state_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET
      state_value = excluded.state_value,
      updated_at = CURRENT_TIMESTAMP
  `);

  upsert.run('db_reset_epoch', epoch);
  upsert.run('db_reset_at', nowIso);
  upsert.run('db_reset_reason', reason);

  return { epoch, resetAt: nowIso };
}
