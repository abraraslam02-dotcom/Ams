import { getDatabase } from '../db/connection.ts';

export type InvoiceModuleType = 'SALE' | 'PURCHASE';

const MONTH_ABBR = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/**
 * Ensures the permanent date-wise independent invoice sequence and registry tables exist.
 * Safe and idempotent — never drops or resets existing sequences.
 */
export function ensureInvoiceSequenceTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_invoice_sequences (
      invoice_type TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (invoice_type, invoice_date)
    );

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
    CREATE INDEX IF NOT EXISTS idx_inv_registry_module_period ON invoice_number_registry(module_type, period_key, seq_number);
  `);
}

/**
 * Normalizes an input date string into canonical 'YYYY-MM-DD'.
 * Supports 'YYYY-MM-DD', ISO timestamps, 'DD-MMM-YYYY', or 'YYYY-MM'.
 * Falls back to current Pakistan Standard Time (UTC+5) date if omitted/invalid.
 */
export function normalizeInvoiceDateKey(dateStr?: string | null): string {
  if (dateStr && typeof dateStr === 'string') {
    const trimmed = dateStr.trim();
    // 1. Standard YYYY-MM-DD (or YYYY-MM-DDTHH:mm:ss...)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      if (year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      }
    }

    // 2. DD-MMM-YYYY (e.g., 17-NOV-2026)
    const dmyMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (dmyMatch) {
      const day = String(Number(dmyMatch[1])).padStart(2, '0');
      const monIdx = MONTH_ABBR.indexOf(dmyMatch[2].toUpperCase() as any);
      const year = Number(dmyMatch[3]);
      if (monIdx >= 0 && year >= 1990 && year <= 2100) {
        const month = String(monIdx + 1).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }

    // 3. YYYY-MM fallback
    const ymMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
    if (ymMatch) {
      const year = Number(ymMatch[1]);
      const month = Number(ymMatch[2]);
      if (year >= 1990 && year <= 2100 && month >= 1 && month <= 12) {
        return `${ymMatch[1]}-${ymMatch[2]}-01`;
      }
    }
  }

  const nowPkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const yyyy = nowPkt.getUTCFullYear();
  const mm = String(nowPkt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nowPkt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formats a date string into 'DD-MMM-YYYY' in uppercase (e.g., '17-NOV-2026').
 */
export function formatInvoiceDateToken(dateStr?: string | null): string {
  const dateKey = normalizeInvoiceDateKey(dateStr);
  const [yyyy, mm, dd] = dateKey.split('-');
  const monthIndex = Math.max(0, Math.min(11, (parseInt(mm, 10) || 1) - 1));
  const monAbbr = MONTH_ABBR[monthIndex];
  return `${dd}-${monAbbr}-${yyyy}`;
}

/**
 * Returns the canonical prefix for the module type:
 * - 'SALE' -> 'SI'
 * - 'PURCHASE' -> 'PI'
 */
export function getInvoiceTypePrefix(moduleType: InvoiceModuleType): 'SI' | 'PI' {
  return moduleType === 'PURCHASE' ? 'PI' : 'SI';
}

/**
 * Builds the composite sequence period key for a moduleType and date:
 * e.g., 'SALE:2026-11-17' or 'PURCHASE:2026-11-17'
 */
export function extractPeriodKey(dateStr?: string | null, moduleType: InvoiceModuleType = 'SALE'): string {
  const dateKey = normalizeInvoiceDateKey(dateStr);
  return `${moduleType}:${dateKey}`;
}

/**
 * Formats a sequence integer and date into:
 * - Sales: "SI-001-17-NOV-2026"
 * - Purchase: "PI-001-17-NOV-2026"
 */
export function formatInvoiceNumber(
  moduleTypeOrPeriodKey: InvoiceModuleType | string,
  dateOrSeq?: string | number | null,
  maybeSeq?: number
): string {
  let moduleType: InvoiceModuleType = 'SALE';
  let dateStr: string | null | undefined;
  let seq: number;

  if (typeof maybeSeq === 'number') {
    moduleType = moduleTypeOrPeriodKey === 'PURCHASE' ? 'PURCHASE' : 'SALE';
    dateStr = typeof dateOrSeq === 'string' ? dateOrSeq : null;
    seq = maybeSeq;
  } else {
    const rawKey = String(moduleTypeOrPeriodKey || '');
    if (rawKey.startsWith('PURCHASE:') || rawKey === 'PURCHASE' || rawKey === 'PI') {
      moduleType = 'PURCHASE';
      dateStr = rawKey.includes(':') ? rawKey.split(':')[1] : null;
    } else if (rawKey.startsWith('SALE:') || rawKey === 'SALE' || rawKey === 'SI') {
      moduleType = 'SALE';
      dateStr = rawKey.includes(':') ? rawKey.split(':')[1] : null;
    } else {
      moduleType = 'SALE';
      dateStr = rawKey;
    }
    seq = Number(dateOrSeq) || 1;
  }

  const safeSeq = Math.max(1, Math.floor(Number(seq) || 1));
  const prefix = getInvoiceTypePrefix(moduleType);
  const dateToken = formatInvoiceDateToken(dateStr);
  return `${prefix}-${String(safeSeq).padStart(3, '0')}-${dateToken}`;
}

/**
 * Parses the daily sequence number from an invoice number matching 'SI-001-17-NOV-2026' or 'PI-001-17-NOV-2026'
 * for the specified moduleType and date.
 */
export function parseInvoiceSeqForDate(
  invoiceNo: string | null | undefined,
  moduleType: InvoiceModuleType,
  dateStr?: string | null
): number {
  if (!invoiceNo || typeof invoiceNo !== 'string') return 0;
  const prefix = getInvoiceTypePrefix(moduleType);
  const dateToken = formatInvoiceDateToken(dateStr);
  const trimmed = invoiceNo.trim().toUpperCase();
  const expectedPrefix = `${prefix}-`;
  const expectedSuffix = `-${dateToken}`;

  if (!trimmed.startsWith(expectedPrefix) || !trimmed.endsWith(expectedSuffix)) {
    return 0;
  }

  const middle = trimmed.slice(expectedPrefix.length, trimmed.length - expectedSuffix.length).trim();
  if (!/^\d+$/.test(middle)) return 0;
  const parsed = parseInt(middle, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Checks whether an invoice number or status represents a temporary Held/Draft invoice
 * that has not been assigned a permanent SI/PI invoice number.
 */
export function isTemporaryOrHeldInvoiceNumber(
  invoiceNo?: string | null,
  status?: string | null
): boolean {
  const normStatus = String(status || '').trim().toLowerCase();
  if (['held', 'draft', 'on_hold', 'on hold', 'hold'].includes(normStatus)) {
    return true;
  }
  const normNo = String(invoiceNo || '').trim().toUpperCase();
  if (!normNo) return true;
  return /^(HLD|HOLD|DRF|DRAFT)-/.test(normNo);
}

/**
 * Generates a unique temporary reference for a Held or Draft invoice
 * without touching or incrementing the permanent SI/PI sequence tables.
 */
export function generateTemporaryHeldInvoiceNumber(
  moduleType: InvoiceModuleType,
  status: 'held' | 'draft' = 'held',
  dateStr?: string | null
): string {
  const typeCode = getInvoiceTypePrefix(moduleType);
  const statusPrefix = status === 'draft' ? 'DRF' : 'HLD';
  const dateToken = formatInvoiceDateToken(dateStr);
  const uniqueSuffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  return `${statusPrefix}-${typeCode}-${dateToken}-${uniqueSuffix}`;
}

/**
 * Computes the highest permanently allocated sequence number for a given (moduleType, invoiceDate) across:
 * 1) daily_invoice_sequences table (for (moduleType, dateKey))
 * 2) invoice_sequences table (for period_key = "moduleType:dateKey")
 * 3) invoice_number_registry table (preserves cancelled and deleted numbers forever)
 * 4) sales.invoice_number (ONLY when moduleType === 'SALE') OR purchases.bill_number (ONLY when moduleType === 'PURCHASE')
 *
 * Sales and Purchase sequences are 100% independent and never affect each other.
 */
export function getHighestSequenceForDate(
  moduleType: InvoiceModuleType,
  dateStr?: string | null
): number {
  ensureInvoiceSequenceTables();
  const db = getDatabase();
  const dateKey = normalizeInvoiceDateKey(dateStr);
  const dateToken = formatInvoiceDateToken(dateKey);
  const prefix = getInvoiceTypePrefix(moduleType);
  const periodKey = `${moduleType}:${dateKey}`;
  const likePattern = `${prefix}-%-${dateToken}`;

  const dailySeqRow = db
    .prepare(
      `SELECT last_seq FROM daily_invoice_sequences WHERE invoice_type = ? AND invoice_date = ?`
    )
    .get(moduleType, dateKey) as { last_seq: number } | undefined;

  const seqRow = db
    .prepare(`SELECT last_seq FROM invoice_sequences WHERE period_key = ?`)
    .get(periodKey) as { last_seq: number } | undefined;

  const regRow = db
    .prepare(
      `SELECT MAX(seq_number) as max_seq
       FROM invoice_number_registry
       WHERE module_type = ? AND (period_key = ? OR UPPER(invoice_number) LIKE ?)`
    )
    .get(moduleType, periodKey, likePattern) as { max_seq: number | null } | undefined;

  let highest = Math.max(
    Number(dailySeqRow?.last_seq || 0),
    Number(seqRow?.last_seq || 0),
    Number(regRow?.max_seq || 0)
  );

  // Also inspect registry invoice_number strings matching the pattern in case seq_number differed
  const regMatchingRows = db
    .prepare(
      `SELECT invoice_number FROM invoice_number_registry WHERE module_type = ? AND UPPER(invoice_number) LIKE ?`
    )
    .all(moduleType, likePattern) as Array<{ invoice_number: string }>;

  for (const r of regMatchingRows) {
    const n = parseInvoiceSeqForDate(r.invoice_number, moduleType, dateKey);
    if (n > highest) highest = n;
  }

  if (moduleType === 'SALE') {
    const salesRows = db
      .prepare(
        `SELECT invoice_number, status FROM sales WHERE UPPER(invoice_number) LIKE ?`
      )
      .all(likePattern) as Array<{ invoice_number: string; status: string }>;

    for (const r of salesRows) {
      if (isTemporaryOrHeldInvoiceNumber(r.invoice_number, r.status)) continue;
      const n = parseInvoiceSeqForDate(r.invoice_number, 'SALE', dateKey);
      if (n > highest) highest = n;
    }
  } else {
    const purchaseRows = db
      .prepare(
        `SELECT bill_number, status FROM purchases WHERE UPPER(bill_number) LIKE ?`
      )
      .all(likePattern) as Array<{ bill_number: string; status: string }>;

    for (const r of purchaseRows) {
      if (isTemporaryOrHeldInvoiceNumber(r.bill_number, r.status)) continue;
      const n = parseInvoiceSeqForDate(r.bill_number, 'PURCHASE', dateKey);
      if (n > highest) highest = n;
    }
  }

  return highest;
}

/**
 * Peeks the next available invoice number ('SI-001-17-NOV-2026' or 'PI-001-17-NOV-2026')
 * for display in the UI without reserving or incrementing the sequence.
 */
export function peekNextInvoiceNumber(
  moduleTypeOrDate?: InvoiceModuleType | string | null,
  dateStr?: string | null
): string {
  let moduleType: InvoiceModuleType = 'SALE';
  let targetDate: string | null | undefined = dateStr;

  if (moduleTypeOrDate === 'SALE' || moduleTypeOrDate === 'PURCHASE') {
    moduleType = moduleTypeOrDate;
  } else if (typeof moduleTypeOrDate === 'string' && moduleTypeOrDate.trim() !== '') {
    moduleType = 'SALE';
    targetDate = moduleTypeOrDate;
  }

  const dateKey = normalizeInvoiceDateKey(targetDate);
  const highest = getHighestSequenceForDate(moduleType, dateKey);
  return formatInvoiceNumber(moduleType, dateKey, highest + 1);
}

/**
 * Atomically allocates and permanently registers the next independent date-wise invoice number
 * ('SI-001-17-NOV-2026' for SALE, 'PI-001-17-NOV-2026' for PURCHASE) on the server.
 * Must be called ONLY when saving a completed invoice.
 * Safe to call inside or outside an existing SQLite transaction (better-sqlite3 supports nested savepoints,
 * so if the surrounding invoice save transaction fails and rolls back, this allocation is also rolled back!).
 */
export function allocateNextInvoiceNumber(
  moduleType: InvoiceModuleType,
  dateStr?: string | null,
  recordId?: number | null
): string {
  ensureInvoiceSequenceTables();
  const db = getDatabase();
  const dateKey = normalizeInvoiceDateKey(dateStr);
  const periodKey = `${moduleType}:${dateKey}`;

  const allocateTx = db.transaction(() => {
    let nextSeq = getHighestSequenceForDate(moduleType, dateKey) + 1;
    let candidate = formatInvoiceNumber(moduleType, dateKey, nextSeq);

    // Guarantee uniqueness across the registry and the respective module table
    while (true) {
      const inRegistry = db
        .prepare(`SELECT 1 FROM invoice_number_registry WHERE UPPER(invoice_number) = UPPER(?)`)
        .get(candidate);

      const inModuleTable =
        moduleType === 'SALE'
          ? db.prepare(`SELECT 1 FROM sales WHERE UPPER(invoice_number) = UPPER(?)`).get(candidate)
          : db.prepare(`SELECT 1 FROM purchases WHERE UPPER(bill_number) = UPPER(?)`).get(candidate);

      if (!inRegistry && !inModuleTable) {
        break;
      }
      nextSeq += 1;
      candidate = formatInvoiceNumber(moduleType, dateKey, nextSeq);
    }

    db.prepare(`
      INSERT INTO daily_invoice_sequences (invoice_type, invoice_date, last_seq, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(invoice_type, invoice_date) DO UPDATE SET
        last_seq = MAX(daily_invoice_sequences.last_seq, excluded.last_seq),
        updated_at = CURRENT_TIMESTAMP
    `).run(moduleType, dateKey, nextSeq);

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
