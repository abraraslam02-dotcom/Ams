import type { Database } from 'better-sqlite3';

/**
 * Universal Automatic Account Code Generator
 * Strictly enforces continuous independent sequential numbering per account type/prefix.
 * Format: PREFIX-001 (e.g. Cus-001, Sup-001, Exp-001, Fin-001, Bank-001, Cash-001, Cap-001, Inc-001, Emp-001, Oth-001).
 *
 * Rules:
 * 1. Unique prefix and independent sequential numbering for every account type.
 * 2. Never allow manual overriding or editing of account codes.
 * 3. Never reuse deleted account codes.
 * 4. Atomic lock-guaranteed sequential assignment preventing multi-user race conditions.
 * 5. Editing an account never modifies its assigned Account Code.
 */

export interface NextAccountCodeResult {
  prefix: string;
  nextNumber: number;
  nextCode: string;
  accountType: string;
}

/**
 * Standard prefix dictionary according to user specification and domain accounting rules.
 */
export const STANDARD_ACCOUNT_TYPE_PREFIXES: Record<string, { prefix: string; standardType: string }> = {
  // 1. Customer
  customer: { prefix: 'Cus', standardType: 'Customer' },
  customers: { prefix: 'Cus', standardType: 'Customer' },
  'trade customer': { prefix: 'Cus', standardType: 'Customer' },
  'trade customers': { prefix: 'Cus', standardType: 'Customer' },
  client: { prefix: 'Cus', standardType: 'Customer' },
  patient: { prefix: 'Cus', standardType: 'Customer' },

  // 2. Supplier
  supplier: { prefix: 'Sup', standardType: 'Supplier' },
  suppliers: { prefix: 'Sup', standardType: 'Supplier' },
  vendor: { prefix: 'Sup', standardType: 'Supplier' },
  vendors: { prefix: 'Sup', standardType: 'Supplier' },
  distributor: { prefix: 'Sup', standardType: 'Supplier' },
  distributors: { prefix: 'Sup', standardType: 'Supplier' },
  'pharmaceutical supplier': { prefix: 'Sup', standardType: 'Supplier' },
  'pharmaceutical suppliers': { prefix: 'Sup', standardType: 'Supplier' },

  // Dual Party
  'customer & supplier': { prefix: 'Dual', standardType: 'Customer & Supplier' },
  'supplier & customer': { prefix: 'Dual', standardType: 'Customer & Supplier' },
  'dual party': { prefix: 'Dual', standardType: 'Customer & Supplier' },
  party: { prefix: 'Pty', standardType: 'Party' },

  // 3. Expense
  expense: { prefix: 'Exp', standardType: 'Expense' },
  expenses: { prefix: 'Exp', standardType: 'Expense' },
  'shop expenses': { prefix: 'Exp', standardType: 'Expense' },
  'other expenses': { prefix: 'Exp', standardType: 'Expense' },
  rent: { prefix: 'Exp', standardType: 'Expense' },
  electricity: { prefix: 'Exp', standardType: 'Expense' },
  salaries: { prefix: 'Exp', standardType: 'Expense' },
  salary: { prefix: 'Exp', standardType: 'Expense' },
  utility: { prefix: 'Exp', standardType: 'Expense' },
  utilities: { prefix: 'Exp', standardType: 'Expense' },
  maintenance: { prefix: 'Exp', standardType: 'Expense' },
  fuel: { prefix: 'Exp', standardType: 'Expense' },
  generator: { prefix: 'Exp', standardType: 'Expense' },
  'tea & refreshments': { prefix: 'Exp', standardType: 'Expense' },

  // 4. Finance
  finance: { prefix: 'Fin', standardType: 'Finance' },
  financial: { prefix: 'Fin', standardType: 'Finance' },
  'financial accounts': { prefix: 'Fin', standardType: 'Finance' },
  assets: { prefix: 'Fin', standardType: 'Finance' },
  liabilities: { prefix: 'Fin', standardType: 'Finance' },
  loans: { prefix: 'Fin', standardType: 'Finance' },

  // 5. Bank
  bank: { prefix: 'Bank', standardType: 'Bank' },
  banks: { prefix: 'Bank', standardType: 'Bank' },
  'bank account': { prefix: 'Bank', standardType: 'Bank' },
  'bank accounts': { prefix: 'Bank', standardType: 'Bank' },

  // 6. Cash
  cash: { prefix: 'Cash', standardType: 'Cash' },
  'cash in hand': { prefix: 'Cash', standardType: 'Cash' },
  'petty cash': { prefix: 'Cash', standardType: 'Cash' },
  'counter cash': { prefix: 'Cash', standardType: 'Cash' },

  // 7. Capital
  capital: { prefix: 'Cap', standardType: 'Capital' },
  'owner capital': { prefix: 'Cap', standardType: 'Capital' },
  equity: { prefix: 'Cap', standardType: 'Capital' },
  drawings: { prefix: 'Cap', standardType: 'Capital' },
  'owner drawings': { prefix: 'Cap', standardType: 'Capital' },

  // 8. Income
  income: { prefix: 'Inc', standardType: 'Income' },
  'sales income': { prefix: 'Inc', standardType: 'Income' },
  'other income': { prefix: 'Inc', standardType: 'Income' },
  revenue: { prefix: 'Inc', standardType: 'Income' },
  'purchase discount': { prefix: 'Inc', standardType: 'Income' },

  // 9. Employee
  employee: { prefix: 'Emp', standardType: 'Employee' },
  employees: { prefix: 'Emp', standardType: 'Employee' },
  staff: { prefix: 'Emp', standardType: 'Employee' },
  salesman: { prefix: 'Emp', standardType: 'Employee' },
  salesmen: { prefix: 'Emp', standardType: 'Employee' },
  deliveryman: { prefix: 'Emp', standardType: 'Employee' },
  deliverymen: { prefix: 'Emp', standardType: 'Employee' },
  rider: { prefix: 'Emp', standardType: 'Employee' },

  // 10. Other
  other: { prefix: 'Oth', standardType: 'Other' },
  others: { prefix: 'Oth', standardType: 'Other' },
  miscellaneous: { prefix: 'Oth', standardType: 'Other' },
  general: { prefix: 'Oth', standardType: 'Other' },
};

/**
 * Resolves or creates a unique, consistent prefix from any account category / custom type.
 */
export function resolveAccountPrefix(
  accountGroupOrType: string,
  mainGroup?: string
): { prefix: string; standardType: string } {
  const raw = String(accountGroupOrType || '').trim();
  const normalized = raw.toLowerCase();

  if (STANDARD_ACCOUNT_TYPE_PREFIXES[normalized]) {
    return STANDARD_ACCOUNT_TYPE_PREFIXES[normalized];
  }

  // Check mainGroup fallback context
  if (mainGroup) {
    const mg = String(mainGroup).trim().toLowerCase();
    if (mg.includes('party')) {
      if (normalized.includes('customer')) return { prefix: 'Cus', standardType: 'Customer' };
      if (normalized.includes('supplier')) return { prefix: 'Sup', standardType: 'Supplier' };
    } else if (mg.includes('financial')) {
      if (normalized.includes('bank')) return { prefix: 'Bank', standardType: 'Bank' };
      if (normalized.includes('cash')) return { prefix: 'Cash', standardType: 'Cash' };
      if (normalized.includes('capital') || normalized.includes('drawing')) {
        return { prefix: 'Cap', standardType: 'Capital' };
      }
      return { prefix: 'Fin', standardType: 'Finance' };
    } else if (mg.includes('income')) {
      if (normalized.includes('income') || normalized.includes('sales')) {
        return { prefix: 'Inc', standardType: 'Income' };
      }
      return { prefix: 'Exp', standardType: 'Expense' };
    }
  }

  // Dynamic custom prefix creation:
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) {
    return { prefix: 'Oth', standardType: 'Other' };
  }

  // Capitalize first, lowercase rest (3-4 chars)
  let cand = cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 3).toLowerCase();
  if (cand.length < 3) {
    cand = cand.padEnd(3, 'x');
  }

  // Collision check against standard prefixes for a different category
  const reserved = new Set(
    Object.values(STANDARD_ACCOUNT_TYPE_PREFIXES).map((item) => item.prefix.toLowerCase())
  );
  if (reserved.has(cand.toLowerCase())) {
    if (cleaned.length >= 4) {
      cand = cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 4).toLowerCase();
    } else {
      cand = cand + 'c';
    }
  }

  return {
    prefix: cand,
    standardType: raw,
  };
}

/**
 * Formats a sequence number into PREFIX-001 format (3+ digits zero-padded).
 */
export function formatAccountCode(prefix: string, seqNumber: number): string {
  const padLen = seqNumber > 999 ? String(seqNumber).length : 3;
  return `${prefix}-${String(seqNumber).padStart(padLen, '0')}`;
}

/**
 * Checks if a specific account code is currently in use or was previously assigned/deleted.
 */
function isCodeInUseOrReserved(db: Database, code: string): boolean {
  const upper = code.trim().toUpperCase();
  const acc = db
    .prepare('SELECT id FROM accounts WHERE UPPER(TRIM(account_code)) = ?')
    .get(upper);
  if (acc) return true;

  const hist = db
    .prepare('SELECT id FROM account_code_history WHERE UPPER(TRIM(account_code)) = ?')
    .get(upper);
  if (hist) return true;

  return false;
}

/**
 * Finds the highest number previously assigned for a given prefix.
 */
/**
 * Finds the highest number previously assigned for a given prefix in the sequential series.
 * Prioritizes account_sequences high-water mark, and only considers 3-digit series (<= 900)
 * so legacy 4-digit chart of account codes (e.g. EXP-5010, INC-4010, CUS-1001, FIN-1010)
 * do not disrupt the clean PREFIX-001 sequence series.
 */
function getHighestExistingNumber(db: Database, prefix: string): number {
  let highest = 0;

  // 1. Check authoritative account_sequences table
  const seqRow = db
    .prepare('SELECT last_number FROM account_sequences WHERE LOWER(prefix) = LOWER(?)')
    .get(prefix) as { last_number: number } | undefined;
  if (seqRow && typeof seqRow.last_number === 'number') {
    highest = Math.max(highest, seqRow.last_number);
  }

  // 2. Check accounts table for historical records matching prefix in the 3-digit series (<= 900)
  const accCodes = db
    .prepare(`
      SELECT account_code FROM accounts
      WHERE UPPER(TRIM(account_code)) LIKE UPPER(?) || '-%'
    `)
    .all(prefix) as Array<{ account_code: string }>;

  for (const row of accCodes) {
    const code = row.account_code.trim();
    const match = code.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (match) {
      const num = parseInt(match[1], 10);
      // Only consider numbers in the sequential 1..900 range, ignoring 4-digit legacy COA heads
      if (num > 0 && num <= 900) {
        highest = Math.max(highest, num);
      }
    }
  }

  // 3. Check account_code_history table
  const histRow = db
    .prepare(`
      SELECT COALESCE(MAX(sequence_number), 0) as max_num
      FROM account_code_history
      WHERE LOWER(prefix) = LOWER(?) AND sequence_number <= 900
    `)
    .get(prefix) as { max_num: number } | undefined;
  if (histRow && histRow.max_num) {
    highest = Math.max(highest, histRow.max_num);
  }

  return highest;
}

/**
 * Peeks the next available Account Code for preview without consuming the sequence.
 */
export function peekNextAccountCode(
  db: Database,
  accountGroupOrType: string,
  mainGroup?: string
): NextAccountCodeResult {
  const { prefix, standardType } = resolveAccountPrefix(accountGroupOrType, mainGroup);
  let nextNum = getHighestExistingNumber(db, prefix) + 1;

  // Guarantee code is not taken or reserved
  while (isCodeInUseOrReserved(db, formatAccountCode(prefix, nextNum))) {
    nextNum++;
  }

  return {
    prefix,
    nextNumber: nextNum,
    nextCode: formatAccountCode(prefix, nextNum),
    accountType: standardType,
  };
}

/**
 * Atomically allocates the next Account Code in a database transaction.
 * Updates account_sequences high-water mark and writes to account_code_history.
 * Prevents race conditions during simultaneous multi-user creation.
 */
export function allocateNextAccountCode(
  db: Database,
  accountGroupOrType: string,
  mainGroup?: string
): NextAccountCodeResult {
  const { prefix, standardType } = resolveAccountPrefix(accountGroupOrType, mainGroup);

  const allocateTx = db.transaction(() => {
    // Ensure row exists in account_sequences
    const existingSeq = db
      .prepare('SELECT id, last_number FROM account_sequences WHERE LOWER(prefix) = LOWER(?)')
      .get(prefix) as { id: number; last_number: number } | undefined;

    let currentHigh = getHighestExistingNumber(db, prefix);
    let candidateNum = currentHigh + 1;

    // Scan until candidate code is genuinely unused across accounts and history
    while (isCodeInUseOrReserved(db, formatAccountCode(prefix, candidateNum))) {
      candidateNum++;
    }

    const finalCode = formatAccountCode(prefix, candidateNum);

    if (existingSeq) {
      db.prepare(`
        UPDATE account_sequences
        SET last_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(candidateNum, existingSeq.id);
    } else {
      db.prepare(`
        INSERT INTO account_sequences (prefix, account_type, last_number, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(prefix, standardType, candidateNum);
    }

    // Record allocation in history
    db.prepare(`
      INSERT OR REPLACE INTO account_code_history (
        account_code, prefix, sequence_number, account_group, action, created_at
      ) VALUES (?, ?, ?, ?, 'ALLOCATED', CURRENT_TIMESTAMP)
    `).run(finalCode, prefix, candidateNum, standardType);

    return {
      prefix,
      nextNumber: candidateNum,
      nextCode: finalCode,
      accountType: standardType,
    };
  });

  return allocateTx();
}

/**
 * Records an account deletion so that deleted numbers are NEVER reused.
 */
export function recordAccountCodeDeletion(
  db: Database,
  accountId: number,
  accountCode: string,
  accountName: string,
  accountGroup: string
): void {
  const code = accountCode.trim();
  const match = code.match(/^([A-Za-z]+)-(\d+)$/);
  const prefix = match ? match[1] : 'Oth';
  const seqNum = match ? parseInt(match[2], 10) : 0;

  db.prepare(`
    INSERT INTO account_code_history (
      account_id, account_code, prefix, sequence_number, account_name, account_group, action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'DELETED', CURRENT_TIMESTAMP)
    ON CONFLICT(account_code) DO UPDATE SET
      account_id = excluded.account_id,
      action = 'DELETED',
      created_at = CURRENT_TIMESTAMP
  `).run(accountId, code, prefix, seqNum, accountName, accountGroup);
}
