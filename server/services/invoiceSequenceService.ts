import { getDatabase } from '../db/connection.ts';

export type InvoiceModuleType = 'SALE' | 'PURCHASE';

/**
 * Ensures the permanent monthly invoice sequence and registry tables exist.
 * Safe and idempotent — never drops or resets existing sequences.
 */
export function ensureInvoiceSequenceTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      period_key TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_number_registry (
      invoice_number TEXT PRIMARY KEY,
      period_key TEXT NOT NULL,
      seq_number INTEGER NOT NULL,
      module_type TEXT NOT NULL,
      record_id INTEGER,
      allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_inv_registry_period ON invoice_number_registry(period_key, seq_number);
  `);
}

/**
 * Extracts 'YYYY-MM' from an ISO date string ('YYYY-MM-DD' or 'YYYY-MM').
 * Falls back to current Pakistan Standard Time (UTC+5) year and month.
 */
export function extractPeriodKey(dateStr?: string | null): string {
  if (dateStr && typeof dateStr === 'string') {
    const trimmed = dateStr.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
        return `${match[1]}-${match[2]}`;
      }
    }
  }
  const nowPkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const yyyy = nowPkt.getUTCFullYear();
  const mm = String(nowPkt.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Formats a period key ('YYYY-MM') and sequence integer into 'Inv-YYYY-MM-XX'.
 * Pads 1..99 to 2 digits ('01'..'99'), and 100+ naturally ('100', '101', etc.).
 */
export function formatInvoiceNumber(periodKey: string, seq: number): string {
  const safeSeq = Math.max(1, Math.floor(Number(seq) || 1));
  return `Inv-${periodKey}-${String(safeSeq).padStart(2, '0')}`;
}

/**
 * Parses a sequence integer from an 'Inv-YYYY-MM-XX' string for a specific periodKey.
 */
export function parseInvoiceSeqForPeriod(invoiceNo: string | null | undefined, periodKey: string): number {
  if (!invoiceNo || typeof invoiceNo !== 'string') return 0;
  const prefix = `Inv-${periodKey}-`;
  if (!invoiceNo.startsWith(prefix)) return 0;
  const tail = invoiceNo.slice(prefix.length).trim();
  if (!/^\d+$/.test(tail)) return 0;
  const parsed = parseInt(tail, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Computes the highest used sequence number for a given 'YYYY-MM' period across:
 * 1) invoice_sequences table
 * 2) invoice_number_registry table (preserves cancelled/deleted numbers forever)
 * 3) sales.invoice_number
 * 4) purchases.bill_number
 */
export function getHighestSequenceForPeriod(periodKey: string): number {
  ensureInvoiceSequenceTables();
  const db = getDatabase();
  const prefix = `Inv-${periodKey}-%`;

  const seqRow = db
    .prepare(`SELECT last_seq FROM invoice_sequences WHERE period_key = ?`)
    .get(periodKey) as { last_seq: number } | undefined;

  const regRow = db
    .prepare(`SELECT MAX(seq_number) as max_seq FROM invoice_number_registry WHERE period_key = ?`)
    .get(periodKey) as { max_seq: number | null } | undefined;

  const salesRows = db
    .prepare(`SELECT invoice_number FROM sales WHERE invoice_number LIKE ?`)
    .all(prefix) as Array<{ invoice_number: string }>;

  const purchaseRows = db
    .prepare(`SELECT bill_number FROM purchases WHERE bill_number LIKE ?`)
    .all(prefix) as Array<{ bill_number: string }>;

  let highest = Math.max(
    Number(seqRow?.last_seq || 0),
    Number(regRow?.max_seq || 0)
  );

  for (const r of salesRows) {
    const n = parseInvoiceSeqForPeriod(r.invoice_number, periodKey);
    if (n > highest) highest = n;
  }

  for (const r of purchaseRows) {
    const n = parseInvoiceSeqForPeriod(r.bill_number, periodKey);
    if (n > highest) highest = n;
  }

  return highest;
}

/**
 * Peeks the next invoice number ('Inv-YYYY-MM-XX') for display in the UI without incrementing the sequence.
 */
export function peekNextInvoiceNumber(dateStr?: string | null): string {
  const periodKey = extractPeriodKey(dateStr);
  const highest = getHighestSequenceForPeriod(periodKey);
  return formatInvoiceNumber(periodKey, highest + 1);
}

/**
 * Atomically allocates and permanently registers the next globally unique invoice number ('Inv-YYYY-MM-XX')
 * for a given date/period on the server.
 * Safe to call inside or outside an existing SQLite transaction (better-sqlite3 supports nested savepoints).
 */
export function allocateNextInvoiceNumber(
  moduleType: InvoiceModuleType,
  dateStr?: string | null,
  recordId?: number | null
): string {
  ensureInvoiceSequenceTables();
  const db = getDatabase();
  const periodKey = extractPeriodKey(dateStr);

  const allocateTx = db.transaction(() => {
    let nextSeq = getHighestSequenceForPeriod(periodKey) + 1;
    let candidate = formatInvoiceNumber(periodKey, nextSeq);

    // Guarantee global uniqueness across sales, purchases, and registry
    while (true) {
      const inRegistry = db
        .prepare(`SELECT 1 FROM invoice_number_registry WHERE invoice_number = ?`)
        .get(candidate);
      const inSales = db
        .prepare(`SELECT 1 FROM sales WHERE invoice_number = ?`)
        .get(candidate);
      const inPurchases = db
        .prepare(`SELECT 1 FROM purchases WHERE bill_number = ?`)
        .get(candidate);

      if (!inRegistry && !inSales && !inPurchases) {
        break;
      }
      nextSeq += 1;
      candidate = formatInvoiceNumber(periodKey, nextSeq);
    }

    db.prepare(`
      INSERT INTO invoice_sequences (period_key, last_seq, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(period_key) DO UPDATE SET
        last_seq = MAX(invoice_sequences.last_seq, excluded.last_seq),
        updated_at = CURRENT_TIMESTAMP
    `).run(periodKey, nextSeq);

    db.prepare(`
      INSERT INTO invoice_number_registry (invoice_number, period_key, seq_number, module_type, record_id, allocated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(candidate, periodKey, nextSeq, moduleType, recordId ?? null);

    return candidate;
  });

  return allocateTx();
}

/**
 * Updates the record_id in invoice_number_registry after a new sale or purchase row is inserted.
 */
export function bindInvoiceNumberRecordId(
  invoiceNumber: string,
  moduleType: InvoiceModuleType,
  recordId: number
): void {
  ensureInvoiceSequenceTables();
  const db = getDatabase();
  db.prepare(`
    UPDATE invoice_number_registry
    SET record_id = ?
    WHERE invoice_number = ? AND module_type = ?
  `).run(recordId, invoiceNumber, moduleType);
}
