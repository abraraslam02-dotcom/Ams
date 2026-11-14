import Database from 'better-sqlite3';

export interface NextItemCodeInfo {
  prefix: string;
  next_number: number;
  next_code: string;
}

const DEFAULT_BASE_NUMBER = 10000; // First auto-generated code when DB is empty: 10001

/**
 * Ensures the persistent item_code_sequences and item_code_history tables exist
 * and are synchronized with all existing records in the items table.
 * Safe, idempotent, and never modifies or deletes existing items.
 */
export function ensureItemCodeSequenceTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_code_sequences (
      sequence_key TEXT PRIMARY KEY,
      prefix TEXT NOT NULL DEFAULT '',
      last_number INTEGER NOT NULL DEFAULT 10000,
      pad_length INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_code_history (
      item_code TEXT PRIMARY KEY COLLATE NOCASE,
      sequence_number INTEGER NOT NULL DEFAULT 0,
      item_id INTEGER,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  syncItemCodeSequenceWithExistingData(db);
}

/**
 * Parses an item code into an optional prefix, numeric value, and digit length.
 * Examples:
 *  - "10025"     -> { prefix: "", num: 10025, padLength: 5 }
 *  - "0042"      -> { prefix: "", num: 42, padLength: 4 }
 *  - "MED-10025" -> { prefix: "MED-", num: 10025, padLength: 5 }
 */
export function parseItemCodePattern(rawCode: string): {
  prefix: string;
  num: number;
  padLength: number;
} | null {
  const trimmed = String(rawCode || '').trim();
  if (!trimmed) return null;

  // Match optional non-digit prefix followed by trailing digits
  const match = trimmed.match(/^([^\d]*?)(\d+)$/);
  if (!match) return null;

  const prefix = match[1] || '';
  const digits = match[2];
  const num = parseInt(digits, 10);
  if (Number.isNaN(num) || num < 0) return null;

  const padLength = digits.startsWith('0') ? digits.length : 0;
  return { prefix, num, padLength };
}

export function formatItemCodeFromParts(
  prefix: string,
  num: number,
  padLength: number = 0
): string {
  const numStr = padLength > 0 ? String(num).padStart(padLength, '0') : String(num);
  return `${prefix}${numStr}`;
}

/**
 * Synchronizes item_code_sequences and item_code_history with existing items in SQLite
 * so that sequence numbers never go backwards and deleted codes are never reused.
 */
export function syncItemCodeSequenceWithExistingData(db: Database.Database): void {
  const existingItems = db
    .prepare('SELECT id, item_code FROM items ORDER BY id ASC')
    .all() as Array<{ id: number; item_code: string }>;

  const insertHistory = db.prepare(`
    INSERT OR IGNORE INTO item_code_history (item_code, sequence_number, item_id)
    VALUES (?, ?, ?)
  `);

  let latestPrefix = '';
  let latestPadLength = 0;
  let hasItems = false;

  const maxByPrefix = new Map<string, number>();
  let globalMaxNumeric = 0;

  for (const row of existingItems) {
    const code = String(row.item_code || '').trim();
    if (!code) continue;
    const parsed = parseItemCodePattern(code);
    const seqNum = parsed ? parsed.num : 0;
    insertHistory.run(code, seqNum, row.id);

    if (parsed) {
      hasItems = true;
      latestPrefix = parsed.prefix;
      latestPadLength = parsed.padLength;
      const key = parsed.prefix.toUpperCase();
      const prevMax = maxByPrefix.get(key) || 0;
      if (parsed.num > prevMax) {
        maxByPrefix.set(key, parsed.num);
      }
      if (parsed.num > globalMaxNumeric) {
        globalMaxNumeric = parsed.num;
      }
    }
  }

  // Also check item_code_history in case items were deleted previously
  const historyRows = db
    .prepare('SELECT item_code, sequence_number FROM item_code_history')
    .all() as Array<{ item_code: string; sequence_number: number }>;

  for (const h of historyRows) {
    const parsed = parseItemCodePattern(h.item_code);
    const num = Math.max(Number(h.sequence_number || 0), parsed ? parsed.num : 0);
    if (parsed) {
      const key = parsed.prefix.toUpperCase();
      const prevMax = maxByPrefix.get(key) || 0;
      if (num > prevMax) {
        maxByPrefix.set(key, num);
      }
    }
    if (num > globalMaxNumeric) {
      globalMaxNumeric = num;
    }
  }

  const existingSeq = db
    .prepare("SELECT prefix, last_number, pad_length FROM item_code_sequences WHERE sequence_key = 'DEFAULT'")
    .get() as { prefix: string; last_number: number; pad_length: number } | undefined;

  const activePrefix = hasItems ? latestPrefix : existingSeq?.prefix ?? '';
  const activePadLength = hasItems ? latestPadLength : existingSeq?.pad_length ?? 0;
  const prefixMax = maxByPrefix.get(activePrefix.toUpperCase()) || 0;

  let highestNumber = Math.max(
    existingSeq?.last_number || 0,
    prefixMax,
    activePrefix === '' ? globalMaxNumeric : prefixMax
  );

  if (highestNumber <= 0) {
    highestNumber = DEFAULT_BASE_NUMBER;
  }

  db.prepare(`
    INSERT INTO item_code_sequences (sequence_key, prefix, last_number, pad_length, updated_at)
    VALUES ('DEFAULT', ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sequence_key) DO UPDATE SET
      prefix = excluded.prefix,
      last_number = MAX(item_code_sequences.last_number, excluded.last_number),
      pad_length = excluded.pad_length,
      updated_at = CURRENT_TIMESTAMP
  `).run(activePrefix, highestNumber, activePadLength);
}

/**
 * Previews the next sequential item code without incrementing the counter.
 * Used when opening the "Add New Item" form so the user sees the exact upcoming code.
 */
export function previewNextItemCode(db: Database.Database): NextItemCodeInfo {
  ensureItemCodeSequenceTable(db);

  const seqRow = db
    .prepare("SELECT prefix, last_number, pad_length FROM item_code_sequences WHERE sequence_key = 'DEFAULT'")
    .get() as { prefix: string; last_number: number; pad_length: number } | undefined;

  const prefix = seqRow?.prefix ?? '';
  const padLength = Number(seqRow?.pad_length || 0);
  let candidateNumber = Math.max(Number(seqRow?.last_number || DEFAULT_BASE_NUMBER), 0) + 1;

  const checkInItems = db.prepare('SELECT 1 FROM items WHERE LOWER(item_code) = LOWER(?)');
  const checkInHistory = db.prepare('SELECT 1 FROM item_code_history WHERE LOWER(item_code) = LOWER(?)');

  let candidateCode = formatItemCodeFromParts(prefix, candidateNumber, padLength);
  while (checkInItems.get(candidateCode) || checkInHistory.get(candidateCode)) {
    candidateNumber++;
    candidateCode = formatItemCodeFromParts(prefix, candidateNumber, padLength);
  }

  return {
    prefix,
    next_number: candidateNumber,
    next_code: candidateCode,
  };
}

/**
 * Atomically allocates and reserves the next sequential item code inside a transaction.
 * Guarantees no duplicates even under simultaneous item creation.
 */
export function allocateNextItemCode(
  db: Database.Database,
  requestedCode?: string
): NextItemCodeInfo {
  ensureItemCodeSequenceTable(db);

  const checkInItems = db.prepare('SELECT 1 FROM items WHERE LOWER(item_code) = LOWER(?)');
  const checkInHistory = db.prepare('SELECT 1 FROM item_code_history WHERE LOWER(item_code) = LOWER(?)');

  const trimmedRequested = String(requestedCode || '').trim();
  if (trimmedRequested) {
    const existsInItems = checkInItems.get(trimmedRequested);
    if (!existsInItems) {
      const parsed = parseItemCodePattern(trimmedRequested);
      const seqNum = parsed ? parsed.num : 0;

      db.prepare(`
        INSERT OR IGNORE INTO item_code_history (item_code, sequence_number)
        VALUES (?, ?)
      `).run(trimmedRequested, seqNum);

      if (parsed && parsed.num > 0) {
        db.prepare(`
          UPDATE item_code_sequences
          SET last_number = MAX(last_number, ?),
              prefix = ?,
              pad_length = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE sequence_key = 'DEFAULT'
        `).run(parsed.num, parsed.prefix, parsed.padLength);
      }

      return {
        prefix: parsed?.prefix ?? '',
        next_number: seqNum,
        next_code: trimmedRequested,
      };
    }
  }

  const seqRow = db
    .prepare("SELECT prefix, last_number, pad_length FROM item_code_sequences WHERE sequence_key = 'DEFAULT'")
    .get() as { prefix: string; last_number: number; pad_length: number } | undefined;

  const prefix = seqRow?.prefix ?? '';
  const padLength = Number(seqRow?.pad_length || 0);
  let nextNumber = Math.max(Number(seqRow?.last_number || DEFAULT_BASE_NUMBER), 0) + 1;
  let nextCode = formatItemCodeFromParts(prefix, nextNumber, padLength);

  while (checkInItems.get(nextCode) || checkInHistory.get(nextCode)) {
    nextNumber++;
    nextCode = formatItemCodeFromParts(prefix, nextNumber, padLength);
  }

  db.prepare(`
    UPDATE item_code_sequences
    SET last_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE sequence_key = 'DEFAULT'
  `).run(nextNumber);

  db.prepare(`
    INSERT OR IGNORE INTO item_code_history (item_code, sequence_number)
    VALUES (?, ?)
  `).run(nextCode, nextNumber);

  return {
    prefix,
    next_number: nextNumber,
    next_code: nextCode,
  };
}
