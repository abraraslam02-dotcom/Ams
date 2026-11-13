import type { Database } from 'better-sqlite3';

/**
 * Authoritative Salesman Number Generator & Cross-Module Sync Helper
 *
 * Rules:
 * 1. Format: "SAL-001", "SAL-002", "SAL-003", etc.
 * 2. Automatic sequential assignment on creation; read-only in UI and API.
 * 3. Never reuse or reset existing/deleted numbers (tracked via persistent monotonic high-water mark).
 * 4. Preserves all pre-existing salesman_code values without alteration.
 */

const SALESMAN_SEQ_KEY = 'salesman_sal';

function parseSalNumber(code: string | null | undefined): number {
  if (!code || typeof code !== 'string') return 0;
  const match = code.trim().match(/^SAL-(\d+)$/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function formatSalesmanCode(seq: number): string {
  const safeSeq = Math.max(1, Math.floor(Number(seq) || 1));
  return `SAL-${String(safeSeq).padStart(3, '0')}`;
}

export function ensureSalesmanSequenceTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sequences (
      seq_key TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const rows = db
    .prepare("SELECT salesman_code FROM salesmen WHERE UPPER(salesman_code) LIKE 'SAL-%'")
    .all() as Array<{ salesman_code: string }>;

  let maxExisting = 0;
  for (const r of rows) {
    const n = parseSalNumber(r.salesman_code);
    if (n > maxExisting) maxExisting = n;
  }

  const currentSeqRow = db
    .prepare('SELECT last_seq FROM app_sequences WHERE seq_key = ?')
    .get(SALESMAN_SEQ_KEY) as { last_seq: number } | undefined;

  if (!currentSeqRow) {
    db.prepare(
      'INSERT INTO app_sequences (seq_key, last_seq, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(SALESMAN_SEQ_KEY, maxExisting);
  } else if (Number(currentSeqRow.last_seq || 0) < maxExisting) {
    db.prepare(
      'UPDATE app_sequences SET last_seq = ?, updated_at = CURRENT_TIMESTAMP WHERE seq_key = ?'
    ).run(maxExisting, SALESMAN_SEQ_KEY);
  }
}

export function peekNextSalesmanCode(db: Database): string {
  ensureSalesmanSequenceTable(db);

  const seqRow = db
    .prepare('SELECT last_seq FROM app_sequences WHERE seq_key = ?')
    .get(SALESMAN_SEQ_KEY) as { last_seq: number } | undefined;

  let nextSeq = Number(seqRow?.last_seq || 0) + 1;
  while (
    db
      .prepare('SELECT id FROM salesmen WHERE UPPER(salesman_code) = UPPER(?)')
      .get(formatSalesmanCode(nextSeq))
  ) {
    nextSeq++;
  }
  return formatSalesmanCode(nextSeq);
}

export function allocateNextSalesmanCode(db: Database): string {
  ensureSalesmanSequenceTable(db);

  const allocateTx = db.transaction(() => {
    const seqRow = db
      .prepare('SELECT last_seq FROM app_sequences WHERE seq_key = ?')
      .get(SALESMAN_SEQ_KEY) as { last_seq: number } | undefined;

    let nextSeq = Number(seqRow?.last_seq || 0) + 1;
    let candidate = formatSalesmanCode(nextSeq);

    while (
      db.prepare('SELECT id FROM salesmen WHERE UPPER(salesman_code) = UPPER(?)').get(candidate)
    ) {
      nextSeq++;
      candidate = formatSalesmanCode(nextSeq);
    }

    db.prepare(
      `INSERT INTO app_sequences (seq_key, last_seq, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(seq_key) DO UPDATE SET
         last_seq = MAX(last_seq, excluded.last_seq),
         updated_at = CURRENT_TIMESTAMP`
    ).run(SALESMAN_SEQ_KEY, nextSeq);

    return candidate;
  });

  return allocateTx();
}

/**
 * Synchronizes a Salesman's updated name across all denormalized tables
 * so Main App, Supply & Distribution, Party Accounts, and Reports match immediately.
 */
export function syncSalesmanDenormalizedReferences(
  db: Database,
  salesmanId: number,
  newName: string
): void {
  const cleanName = String(newName || '').trim();
  if (!salesmanId || !cleanName) return;

  const updates: Array<[string, string]> = [
    ['sales', 'salesman'],
    ['accounts', 'assigned_salesman_name'],
    ['supply_order_forms', 'salesman_name'],
    ['supply_bookings', 'salesman_name'],
    ['town_supplies', 'salesman_name'],
    ['party_supplies', 'salesman_name'],
    ['supply_dispatches', 'salesman_name'],
    ['supply_returns', 'salesman_name'],
    ['supply_recoveries', 'salesman_name'],
    ['salesman_settlements', 'salesman_name'],
    ['batch_stock_movements', 'salesman_name'],
    ['trade_offers', 'salesman_name'],
    ['mobile_booking_imports', 'salesman_name'],
  ];

  for (const [table, col] of updates) {
    const tblExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!tblExists) continue;

    const idCol = table === 'accounts' ? 'assigned_salesman_id' : 'salesman_id';
    db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE "${idCol}" = ?`).run(
      cleanName,
      salesmanId
    );
  }
}

/**
 * Refreshes salesmen.assigned_parties_json from salesman_parties junction table.
 */
export function refreshSalesmanPartiesJson(db: Database, salesmanId: number): void {
  if (!salesmanId) return;
  const rows = db
    .prepare('SELECT party_account_id FROM salesman_parties WHERE salesman_id = ? ORDER BY id ASC')
    .all(salesmanId) as Array<{ party_account_id: number }>;
  const ids = rows.map((r) => Number(r.party_account_id)).filter(Boolean);
  db.prepare(
    'UPDATE salesmen SET assigned_parties_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(ids), salesmanId);
}

/**
 * Counts linked records for safe delete protection.
 */
export function getSalesmanLinkedRecordCount(
  db: Database,
  salesmanId: number
): { total: number; breakdown: Record<string, number> } {
  const checks: Array<[string, string]> = [
    ['sales', 'salesman_id'],
    ['accounts', 'assigned_salesman_id'],
    ['supply_order_forms', 'salesman_id'],
    ['supply_bookings', 'salesman_id'],
    ['town_supplies', 'salesman_id'],
    ['party_supplies', 'salesman_id'],
    ['supply_dispatches', 'salesman_id'],
    ['supply_returns', 'salesman_id'],
    ['supply_recoveries', 'salesman_id'],
    ['salesman_settlements', 'salesman_id'],
    ['salesman_commission_payments', 'salesman_id'],
  ];

  const breakdown: Record<string, number> = {};
  let total = 0;

  for (const [table, col] of checks) {
    const tblExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!tblExists) continue;
    const cnt = Number(
      (
        db.prepare(`SELECT COUNT(*) as c FROM "${table}" WHERE "${col}" = ?`).get(salesmanId) as {
          c: number;
        }
      )?.c || 0
    );
    if (cnt > 0) {
      breakdown[table] = cnt;
      total += cnt;
    }
  }

  return { total, breakdown };
}
