import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { round2 } from './purchases.ts';

export const accountingRouter = Router();

export type FinancialPillar =
  | 'Assets'
  | 'Liabilities'
  | 'Capital / Equity'
  | 'Income'
  | 'Expenses';

export const FINANCIAL_PILLARS: FinancialPillar[] = [
  'Assets',
  'Liabilities',
  'Capital / Equity',
  'Income',
  'Expenses',
];

export function resolveFinancialPillar(accountGroup: string, balanceType: string = 'Debit'): FinancialPillar {
  if (['Customer', 'Cash in Hand', 'Bank', 'Assets'].includes(accountGroup)) return 'Assets';
  if (['Supplier', 'Liabilities', 'Loans'].includes(accountGroup)) return 'Liabilities';
  if (['Capital', 'Drawings'].includes(accountGroup)) return 'Capital / Equity';
  if (['Sales Income', 'Purchase Discount', 'Other Income'].includes(accountGroup)) return 'Income';
  if (
    [
      'Purchases',
      'Purchase Returns',
      'Rent',
      'Electricity',
      'Salaries',
      'Shop Expenses',
      'Other Expenses',
    ].includes(accountGroup)
  ) {
    return 'Expenses';
  }
  if (accountGroup === 'Customer & Supplier') {
    return balanceType === 'Credit' ? 'Liabilities' : 'Assets';
  }
  return 'Assets';
}

export function resolveMainGroupFromPillar(
  pillar: FinancialPillar,
  accountGroup: string
): 'PARTY ACCOUNTS' | 'FINANCIAL ACCOUNTS' | 'INCOME & EXPENSE ACCOUNTS' {
  if (['Customer', 'Supplier', 'Customer & Supplier'].includes(accountGroup)) {
    return 'PARTY ACCOUNTS';
  }
  if (pillar === 'Income' || pillar === 'Expenses') {
    return 'INCOME & EXPENSE ACCOUNTS';
  }
  return 'FINANCIAL ACCOUNTS';
}

function getNextAccountingVoucherNumber(voucherType: string): string {
  const db = getDatabase();
  const validType = ['CRV', 'CPV', 'BRV', 'BPV', 'JV', 'CV'].includes(voucherType.toUpperCase())
    ? voucherType.toUpperCase()
    : 'JV';
  const prefix = `${validType}-2026-`;
  const lastRow = db
    .prepare(
      'SELECT voucher_number FROM accounting_vouchers WHERE voucher_number LIKE ? ORDER BY id DESC LIMIT 1'
    )
    .get(`${prefix}%`) as { voucher_number: string } | undefined;

  let seq = 1;
  if (lastRow?.voucher_number) {
    const m = lastRow.voucher_number.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  while (
    db
      .prepare('SELECT id FROM accounting_vouchers WHERE voucher_number = ?')
      .get(`${prefix}${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function getNextJournalEntryNumber(prefix: string): string {
  const db = getDatabase();
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM journal_entries').get() as { cnt: number };
  let seq = (countRow?.cnt || 0) + 1;
  while (
    db
      .prepare('SELECT id FROM journal_entries WHERE entry_number = ?')
      .get(`${prefix}-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `${prefix}-2026-${String(seq).padStart(4, '0')}`;
}

function checkPeriodOpen(dateStr: string): void {
  const db = getDatabase();
  const closedPeriod = db
    .prepare(
      `SELECT period_name, start_date, end_date
       FROM accounting_periods
       WHERE is_closed = 1
         AND DATE(?) >= DATE(start_date)
         AND DATE(?) <= DATE(end_date)
       LIMIT 1`
    )
    .get(dateStr, dateStr) as { period_name: string; start_date: string; end_date: string } | undefined;

  if (closedPeriod) {
    throw new Error(
      `Accounting period "${closedPeriod.period_name}" (${closedPeriod.start_date} to ${closedPeriod.end_date}) is closed and locked. Transactions cannot be posted or modified in a closed period.`
    );
  }
}

/**
 * Helper to compute an account's Opening Balance (signed, where positive = Debit, negative = Credit)
 * as of a specific startDate (including initial opening_balance + all posted journal lines strictly before startDate).
 */
function computeAccountSignedOpeningAsOf(accountId: number, startDate?: string): {
  account: Record<string, any>;
  signedOpening: number;
  openingBalance: number;
  openingType: 'Debit' | 'Credit';
} {
  const db = getDatabase();
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Record<string, any> | undefined;
  if (!acc) {
    throw new Error(`Account ID ${accountId} not found.`);
  }

  const baseOpen = round2(Number(acc.opening_balance || 0));
  const baseOpenType = acc.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
  let signed = baseOpenType === 'Debit' ? baseOpen : -baseOpen;

  if (startDate && startDate.trim()) {
    const priorSums = db
      .prepare(
        `SELECT
           COALESCE(SUM(jl.debit_amount), 0) as dr,
           COALESCE(SUM(jl.credit_amount), 0) as cr
         FROM journal_entry_lines jl
         INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE jl.account_id = ?
           AND je.status = 'posted'
           AND DATE(je.entry_date) < DATE(?)`
      )
      .get(accountId, startDate.trim()) as { dr: number; cr: number };

    signed = round2(signed + Number(priorSums?.dr || 0) - Number(priorSums?.cr || 0));
  }

  const naturalType: 'Debit' | 'Credit' = [
    'Supplier',
    'Liabilities',
    'Capital',
    'Loans',
    'Sales Income',
    'Purchase Discount',
    'Purchase Returns',
    'Other Income',
  ].includes(String(acc.account_group))
    ? 'Credit'
    : 'Debit';

  return {
    account: acc,
    signedOpening: signed,
    openingBalance: round2(Math.abs(signed)),
    openingType: signed > 0 ? 'Debit' : signed < 0 ? 'Credit' : naturalType,
  };
}

/**
 * 1. GET /api/accounting/coa
 * Hierarchical 5-Pillar Chart of Accounts (Assets, Liabilities, Capital / Equity, Income, Expenses)
 */
accountingRouter.get('/coa', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { q, pillar, status } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push('(a.account_code LIKE ? OR a.account_name LIKE ? OR a.account_group LIKE ?)');
      params.push(term, term, term);
    }
    if (status && status !== 'all') {
      conditions.push('a.status = ?');
      params.push(status);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT
           a.*,
           p.account_code as parent_account_code,
           p.account_name as parent_account_name,
           (SELECT COUNT(*) FROM accounts c WHERE c.parent_account_id = a.id) as sub_accounts_count,
           (SELECT COUNT(*) FROM journal_entry_lines jl WHERE jl.account_id = a.id) as linked_transactions_count
         FROM accounts a
         LEFT JOIN accounts p ON p.id = a.parent_account_id
         ${whereSql}
         ORDER BY a.account_code ASC`
      )
      .all(...params) as Array<Record<string, any>>;

    const enriched: Array<Record<string, any>> = rows.map((r) => {
      const resolvedPillar =
        (r.financial_category as FinancialPillar) ||
        resolveFinancialPillar(String(r.account_group), String(r.current_balance_type));
      return {
        ...r,
        financial_category: resolvedPillar,
      };
    });

    const filtered =
      pillar && pillar !== 'all'
        ? enriched.filter((r) => r.financial_category === pillar)
        : enriched;

    // Build parent-child tree within each of the 5 pillars
    const pillarSummary = FINANCIAL_PILLARS.map((pil) => {
      const pillarAccounts = enriched.filter((a) => a.financial_category === pil);
      const byId = new Map<number, Record<string, any>>();
      pillarAccounts.forEach((a) => byId.set(Number(a.id), { ...a, children: [] }));

      const roots: Array<Record<string, any>> = [];
      byId.forEach((node) => {
        if (node.parent_account_id && byId.has(Number(node.parent_account_id))) {
          byId.get(Number(node.parent_account_id))!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      const totalDebit = round2(
        pillarAccounts.reduce(
          (s, a) => s + (a.current_balance_type === 'Debit' ? Number(a.current_balance || 0) : 0),
          0
        )
      );
      const totalCredit = round2(
        pillarAccounts.reduce(
          (s, a) => s + (a.current_balance_type === 'Credit' ? Number(a.current_balance || 0) : 0),
          0
        )
      );

      return {
        pillar: pil,
        accountCount: pillarAccounts.length,
        totalDebit,
        totalCredit,
        netBalance: round2(Math.abs(totalDebit - totalCredit)),
        netBalanceType: totalDebit >= totalCredit ? 'Debit' : 'Credit',
        roots,
      };
    });

    const periods = db.prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC').all();

    return res.json({
      success: true,
      accounts: filtered,
      pillarSummary,
      periods,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/accounting/coa
 * Create a new Account in the Hierarchical Chart of Accounts (prevents duplicate codes or names)
 */
accountingRouter.post('/coa', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      account_code,
      account_name,
      financial_category = 'Assets',
      account_group = 'Assets',
      parent_account_id = null,
      opening_balance = 0,
      opening_balance_type,
      contact_person = null,
      phone = null,
      ntn = null,
      strn = null,
      filer_status = 'Filer',
      city = null,
      address = null,
      credit_limit = 0,
      notes = null,
    } = req.body || {};

    const cleanName = String(account_name || '').trim();
    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'Account Name is required.' });
    }

    let cleanCode = String(account_code || '').trim().toUpperCase();
    if (!cleanCode) {
      const prefixMap: Record<string, string> = {
        Assets: 'AST',
        Liabilities: 'LIA',
        'Capital / Equity': 'EQT',
        Income: 'INC',
        Expenses: 'EXP',
      };
      const pfx = prefixMap[String(financial_category)] || 'ACC';
      let seq = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c + 1001;
      while (db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(`${pfx}-${seq}`)) {
        seq++;
      }
      cleanCode = `${pfx}-${seq}`;
    }

    const dupCode = db
      .prepare('SELECT id FROM accounts WHERE UPPER(TRIM(account_code)) = UPPER(TRIM(?))')
      .get(cleanCode);
    if (dupCode) {
      return res
        .status(409)
        .json({ success: false, error: `Duplicate Account Code "${cleanCode}" is not allowed.` });
    }

    const dupName = db
      .prepare(
        'SELECT id, account_code FROM accounts WHERE UPPER(TRIM(account_name)) = UPPER(TRIM(?)) AND account_group = ?'
      )
      .get(cleanName, account_group) as { id: number; account_code: string } | undefined;
    if (dupName) {
      return res.status(409).json({
        success: false,
        error: `Account "${cleanName}" already exists under ${account_group} (${dupName.account_code}).`,
      });
    }

    const pillar = FINANCIAL_PILLARS.includes(financial_category)
      ? (financial_category as FinancialPillar)
      : resolveFinancialPillar(account_group);
    const mainGroup = resolveMainGroupFromPillar(pillar, account_group);
    const defaultBalType: 'Debit' | 'Credit' =
      opening_balance_type === 'Credit' || opening_balance_type === 'Debit'
        ? opening_balance_type
        : ['Liabilities', 'Capital / Equity', 'Income'].includes(pillar)
        ? 'Credit'
        : 'Debit';

    const openBal = round2(Math.max(0, Number(opening_balance || 0)));

    const resolvedAccountType =
      String(account_group || '').trim().toLowerCase() === 'customers'
        ? 'Customer'
        : String(account_group || '').trim().toLowerCase() === 'suppliers'
        ? 'Supplier'
        : String(account_group || mainGroup).trim();

    const resInsert = db
      .prepare(
        `INSERT INTO accounts (
           account_code, account_name, main_group, account_group, account_type, financial_category,
           parent_account_id, opening_balance, opening_balance_type,
           current_balance, current_balance_type, contact_person, phone,
           ntn, strn, filer_status, city, address, credit_limit,
           is_system_account, status, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Active', ?)`
      )
      .run(
        cleanCode,
        cleanName,
        mainGroup,
        account_group,
        resolvedAccountType,
        pillar,
        parent_account_id ? Number(parent_account_id) : null,
        openBal,
        defaultBalType,
        openBal,
        defaultBalType,
        contact_person,
        phone,
        ntn,
        strn,
        ['Filer', 'Non-Filer', 'Exempt'].includes(filer_status) ? filer_status : 'Filer',
        city,
        address,
        round2(Number(credit_limit || 0)),
        notes
      );

    const newId = Number(resInsert.lastInsertRowid);
    recalculateAccountBalance(newId);
    const created = db.prepare('SELECT * FROM accounts WHERE id = ?').get(newId);

    return res.status(201).json({
      success: true,
      message: `Account "${cleanName}" (${cleanCode}) created under ${pillar}.`,
      account: created,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * 2. VOUCHER MANAGEMENT (CRV, CPV, BRV, BPV, JV, Contra)
 */
accountingRouter.get('/vouchers/next-number', (req: Request, res: Response) => {
  try {
    const type = String(req.query.type || 'JV').toUpperCase();
    return res.json({
      success: true,
      voucherType: type,
      nextVoucherNumber: getNextAccountingVoucherNumber(type),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

accountingRouter.get('/vouchers', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { voucherType, status, startDate, endDate, q, accountId } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (voucherType && voucherType !== 'all') {
      conditions.push('v.voucher_type = ?');
      params.push(String(voucherType).toUpperCase());
    }
    if (status && status !== 'all') {
      conditions.push('v.status = ?');
      params.push(status);
    }
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      conditions.push('DATE(v.voucher_date) >= DATE(?)');
      params.push(startDate.trim());
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      conditions.push('DATE(v.voucher_date) <= DATE(?)');
      params.push(endDate.trim());
    }
    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        `(v.voucher_number LIKE ? OR v.reference_number LIKE ? OR v.narration LIKE ? OR EXISTS (
           SELECT 1 FROM accounting_voucher_lines vl
           WHERE vl.voucher_id = v.id AND (vl.account_name LIKE ? OR vl.account_code LIKE ? OR vl.description LIKE ?)
         ))`
      );
      params.push(term, term, term, term, term, term);
    }
    if (accountId && accountId !== 'all') {
      conditions.push(
        'EXISTS (SELECT 1 FROM accounting_voucher_lines vl WHERE vl.voucher_id = v.id AND vl.account_id = ?)'
      );
      params.push(Number(accountId));
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const vouchers = db
      .prepare(
        `SELECT v.*
         FROM accounting_vouchers v
         ${whereSql}
         ORDER BY DATE(v.voucher_date) DESC, v.id DESC`
      )
      .all(...params) as Array<Record<string, any>>;

    const linesStmt = db.prepare(
      `SELECT vl.*, a.account_group, a.financial_category
       FROM accounting_voucher_lines vl
       LEFT JOIN accounts a ON a.id = vl.account_id
       WHERE vl.voucher_id = ?
       ORDER BY vl.line_order ASC, vl.id ASC`
    );

    const populated = vouchers.map((v) => ({
      ...v,
      lines: linesStmt.all(v.id),
    }));

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) as total_vouchers,
           COALESCE(SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END), 0) as posted_count,
           COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) as draft_count,
           COALESCE(SUM(CASE WHEN status = 'reversed' THEN 1 ELSE 0 END), 0) as reversed_count,
           COALESCE(SUM(CASE WHEN status = 'posted' THEN total_debit ELSE 0 END), 0) as total_posted_amount
         FROM accounting_vouchers`
      )
      .get();

    return res.json({
      success: true,
      vouchers: populated,
      stats,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

accountingRouter.get('/vouchers/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;

    if (!voucher) {
      return res.status(404).json({ success: false, error: 'Voucher not found.' });
    }

    const lines = db
      .prepare(
        `SELECT vl.*, a.account_group, a.financial_category
         FROM accounting_voucher_lines vl
         LEFT JOIN accounts a ON a.id = vl.account_id
         WHERE vl.voucher_id = ?
         ORDER BY vl.line_order ASC, vl.id ASC`
      )
      .all(id);

    return res.json({
      success: true,
      voucher: { ...voucher, lines },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

function postVoucherToJournal(voucherId: number): number {
  const db = getDatabase();
  const voucher = db
    .prepare('SELECT * FROM accounting_vouchers WHERE id = ?')
    .get(voucherId) as Record<string, any> | undefined;

  if (!voucher) {
    throw new Error('Voucher not found.');
  }
  if (voucher.journal_entry_id) {
    throw new Error(
      `Duplicate posting prevented: Voucher "${voucher.voucher_number}" is already posted to Journal Entry #${voucher.journal_entry_id}.`
    );
  }

  checkPeriodOpen(String(voucher.voucher_date));

  const lines = db
    .prepare('SELECT * FROM accounting_voucher_lines WHERE voucher_id = ? ORDER BY line_order ASC, id ASC')
    .all(voucherId) as Array<Record<string, any>>;

  if (lines.length < 2) {
    throw new Error('A double-entry voucher must have at least two lines (Debit and Credit).');
  }

  const totalDebit = round2(lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0));

  if (totalDebit <= 0 || totalCredit <= 0) {
    throw new Error('Voucher Total Debit and Total Credit must be greater than zero.');
  }
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Double-Entry Validation Failed: Total Debit (Rs. ${totalDebit.toFixed(2)}) must equal Total Credit (Rs. ${totalCredit.toFixed(2)}) before posting.`
    );
  }

  const jeNumber = getNextJournalEntryNumber(`JE-${voucher.voucher_type}`);
  const jeRes = db
    .prepare(
      `INSERT INTO journal_entries (
         entry_number, entry_date, reference_type, reference_id, description,
         total_debit, total_credit, is_balanced, status
       ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')`
    )
    .run(
      jeNumber,
      voucher.voucher_date,
      voucherId,
      `${voucher.voucher_type} Voucher ${voucher.voucher_number}${
        voucher.reference_number ? ` (Ref: ${voucher.reference_number})` : ''
      } - ${voucher.narration || ''}`,
      totalDebit,
      totalCredit
    );

  const jeId = Number(jeRes.lastInsertRowid);
  const insertJeLine = db.prepare(
    `INSERT INTO journal_entry_lines (
       journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const touchedAccounts = new Set<number>();
  for (const line of lines) {
    const accId = Number(line.account_id);
    insertJeLine.run(
      jeId,
      accId,
      line.ledger_type || 'general',
      round2(Number(line.debit_amount || 0)),
      round2(Number(line.credit_amount || 0)),
      line.description || voucher.narration || `${voucher.voucher_type} ${voucher.voucher_number}`
    );
    touchedAccounts.add(accId);
  }

  db.prepare(
    `UPDATE accounting_vouchers
     SET status = 'posted',
         approval_status = 'Approved',
         total_debit = ?,
         total_credit = ?,
         journal_entry_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(totalDebit, totalCredit, jeId, voucherId);

  touchedAccounts.forEach((accId) => recalculateAccountBalance(accId));
  return jeId;
}

/**
 * POST /api/accounting/vouchers
 * Create a new Multi-Line Voucher (Save as Draft or Post Immediately)
 */
accountingRouter.post('/vouchers', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      voucher_number,
      voucher_type = 'JV',
      voucher_date,
      reference_number = '',
      narration = '',
      created_by = 'Super Admin',
      status = 'posted',
      lines = [],
    } = req.body || {};

    const cleanType = String(voucher_type || 'JV').toUpperCase();
    if (!['CRV', 'CPV', 'BRV', 'BPV', 'JV', 'CV'].includes(cleanType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid voucher_type. Must be one of CRV, CPV, BRV, BPV, JV, CV.',
      });
    }

    const vDate = String(voucher_date || new Date().toISOString().slice(0, 10)).trim();
    checkPeriodOpen(vDate);

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one voucher line is required.',
      });
    }

    const tx = db.transaction(() => {
      const finalVoucherNo =
        String(voucher_number || '').trim() || getNextAccountingVoucherNumber(cleanType);

      const dup = db
        .prepare('SELECT id FROM accounting_vouchers WHERE UPPER(TRIM(voucher_number)) = UPPER(TRIM(?))')
        .get(finalVoucherNo);
      if (dup) {
        throw new Error(`Duplicate Voucher Number "${finalVoucherNo}" is not allowed.`);
      }

      const preparedLines: Array<{
        account_id: number;
        account_code: string;
        account_name: string;
        ledger_type: 'general' | 'customer' | 'supplier';
        debit_amount: number;
        credit_amount: number;
        description: string;
        line_order: number;
      }> = [];

      let sumDr = 0;
      let sumCr = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] as Record<string, any>;
        const accId = Number(raw.account_id || 0);
        const dr = round2(Math.max(0, Number(raw.debit_amount || 0)));
        const cr = round2(Math.max(0, Number(raw.credit_amount || 0)));

        if (!accId && dr === 0 && cr === 0) continue;
        if (!accId) {
          throw new Error(`Row #${i + 1}: Please select a valid Account.`);
        }
        if (dr > 0 && cr > 0) {
          throw new Error(`Row #${i + 1}: A single line cannot have both Debit and Credit amounts.`);
        }
        if (dr === 0 && cr === 0) continue;

        const accRow = db
          .prepare('SELECT id, account_code, account_name, account_group FROM accounts WHERE id = ?')
          .get(accId) as
          | { id: number; account_code: string; account_name: string; account_group: string }
          | undefined;

        if (!accRow) {
          throw new Error(`Row #${i + 1}: Account ID ${accId} does not exist.`);
        }

        let ledgerType: 'general' | 'customer' | 'supplier' = 'general';
        if (accRow.account_group === 'Customer') ledgerType = 'customer';
        else if (accRow.account_group === 'Supplier') ledgerType = 'supplier';
        else if (
          accRow.account_group === 'Customer & Supplier' &&
          (raw.ledger_type === 'customer' || raw.ledger_type === 'supplier')
        ) {
          ledgerType = raw.ledger_type;
        }

        sumDr = round2(sumDr + dr);
        sumCr = round2(sumCr + cr);

        preparedLines.push({
          account_id: accRow.id,
          account_code: accRow.account_code,
          account_name: accRow.account_name,
          ledger_type: ledgerType,
          debit_amount: dr,
          credit_amount: cr,
          description: String(raw.description || narration || '').trim(),
          line_order: i + 1,
        });
      }

      if (preparedLines.length === 0) {
        throw new Error('Please enter at least one valid line with a Debit or Credit amount.');
      }

      const targetStatus = status === 'draft' ? 'draft' : 'posted';
      if (targetStatus === 'posted') {
        if (preparedLines.length < 2) {
          throw new Error('A posted voucher must contain at least one Debit line and one Credit line.');
        }
        if (sumDr !== sumCr) {
          throw new Error(
            `Voucher is unbalanced: Total Debit (Rs. ${sumDr.toFixed(2)}) does not equal Total Credit (Rs. ${sumCr.toFixed(2)}). Difference: Rs. ${Math.abs(sumDr - sumCr).toFixed(2)}.`
          );
        }
      }

      const ins = db
        .prepare(
          `INSERT INTO accounting_vouchers (
             voucher_number, voucher_type, voucher_date, reference_number,
             narration, total_debit, total_credit, status, approval_status,
             created_by, approved_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          finalVoucherNo,
          cleanType,
          vDate,
          String(reference_number || '').trim(),
          String(narration || '').trim(),
          sumDr,
          sumCr,
          'draft',
          targetStatus === 'draft' ? 'Draft' : 'Approved',
          String(created_by || 'Super Admin'),
          targetStatus === 'draft' ? null : String(created_by || 'Super Admin')
        );

      const newVoucherId = Number(ins.lastInsertRowid);

      const insLine = db.prepare(
        `INSERT INTO accounting_voucher_lines (
           voucher_id, account_id, account_code, account_name,
           ledger_type, debit_amount, credit_amount, description, line_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const pl of preparedLines) {
        insLine.run(
          newVoucherId,
          pl.account_id,
          pl.account_code,
          pl.account_name,
          pl.ledger_type,
          pl.debit_amount,
          pl.credit_amount,
          pl.description,
          pl.line_order
        );
      }

      if (targetStatus === 'posted') {
        postVoucherToJournal(newVoucherId);
      }

      return newVoucherId;
    });

    const voucherId = tx();
    const created = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId) as Record<
      string,
      any
    >;
    const savedLines = db
      .prepare('SELECT * FROM accounting_voucher_lines WHERE voucher_id = ? ORDER BY line_order ASC')
      .all(voucherId);

    return res.status(201).json({
      success: true,
      message:
        created.status === 'posted'
          ? `Voucher ${created.voucher_number} posted to General Ledger.`
          : `Draft Voucher ${created.voucher_number} saved (balances unaffected).`,
      voucher: { ...created, lines: savedLines },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/accounting/vouchers/:id
 * Update an existing Draft Voucher (and optionally post it)
 */
accountingRouter.put('/vouchers/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const voucherId = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM accounting_vouchers WHERE id = ?')
      .get(voucherId) as Record<string, any> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Voucher not found.' });
    }
    if (existing.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: `Posted or reversed vouchers (${existing.voucher_number}) cannot be directly overwritten. Use a formal Reversal entry instead.`,
      });
    }

    const {
      voucher_date,
      reference_number,
      narration,
      status = 'draft',
      lines = [],
    } = req.body || {};

    const vDate = String(voucher_date || existing.voucher_date).trim();
    checkPeriodOpen(vDate);

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM accounting_voucher_lines WHERE voucher_id = ?').run(voucherId);

      let sumDr = 0;
      let sumCr = 0;
      const insLine = db.prepare(
        `INSERT INTO accounting_voucher_lines (
           voucher_id, account_id, account_code, account_name,
           ledger_type, debit_amount, credit_amount, description, line_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let validCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] as Record<string, any>;
        const accId = Number(raw.account_id || 0);
        const dr = round2(Math.max(0, Number(raw.debit_amount || 0)));
        const cr = round2(Math.max(0, Number(raw.credit_amount || 0)));
        if (!accId || (dr === 0 && cr === 0)) continue;

        const accRow = db
          .prepare('SELECT id, account_code, account_name, account_group FROM accounts WHERE id = ?')
          .get(accId) as
          | { id: number; account_code: string; account_name: string; account_group: string }
          | undefined;
        if (!accRow) throw new Error(`Account ID ${accId} not found.`);

        let ledgerType: 'general' | 'customer' | 'supplier' = 'general';
        if (accRow.account_group === 'Customer') ledgerType = 'customer';
        else if (accRow.account_group === 'Supplier') ledgerType = 'supplier';

        sumDr = round2(sumDr + dr);
        sumCr = round2(sumCr + cr);
        validCount++;

        insLine.run(
          voucherId,
          accRow.id,
          accRow.account_code,
          accRow.account_name,
          ledgerType,
          dr,
          cr,
          String(raw.description || narration || ''),
          validCount
        );
      }

      if (validCount === 0) {
        throw new Error('At least one valid line is required.');
      }

      db.prepare(
        `UPDATE accounting_vouchers
         SET voucher_date = ?,
             reference_number = ?,
             narration = ?,
             total_debit = ?,
             total_credit = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        vDate,
        String(reference_number ?? existing.reference_number),
        String(narration ?? existing.narration),
        sumDr,
        sumCr,
        voucherId
      );

      if (status === 'posted') {
        postVoucherToJournal(voucherId);
      }
    });

    tx();
    const updated = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId) as Record<
      string,
      any
    >;
    const savedLines = db
      .prepare('SELECT * FROM accounting_voucher_lines WHERE voucher_id = ? ORDER BY line_order ASC')
      .all(voucherId);

    return res.json({
      success: true,
      message:
        updated.status === 'posted'
          ? `Voucher ${updated.voucher_number} posted successfully.`
          : `Draft Voucher ${updated.voucher_number} updated.`,
      voucher: { ...updated, lines: savedLines },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * POST /api/accounting/vouchers/:id/post
 * Post an existing Draft Voucher to the General Ledger
 */
accountingRouter.post('/vouchers/:id/post', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const voucherId = Number(req.params.id);
    const tx = db.transaction(() => {
      postVoucherToJournal(voucherId);
    });
    tx();

    const updated = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId) as Record<
      string,
      any
    >;
    const lines = db
      .prepare('SELECT * FROM accounting_voucher_lines WHERE voucher_id = ? ORDER BY line_order ASC')
      .all(voucherId);

    return res.json({
      success: true,
      message: `Voucher ${updated.voucher_number} posted to General Ledger.`,
      voucher: { ...updated, lines },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * POST /api/accounting/vouchers/:id/reverse
 * Safe accounting reversal of a posted voucher (creates a contra/reversal JV & preserves audit trail)
 */
accountingRouter.post('/vouchers/:id/reverse', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const voucherId = Number(req.params.id);
    const { reason = 'Authorized Accounting Reversal', reversed_by = 'Super Admin' } = req.body || {};

    const orig = db
      .prepare('SELECT * FROM accounting_vouchers WHERE id = ?')
      .get(voucherId) as Record<string, any> | undefined;

    if (!orig) {
      return res.status(404).json({ success: false, error: 'Voucher not found.' });
    }
    if (orig.status === 'draft') {
      db.prepare("UPDATE accounting_vouchers SET status = 'cancelled', approval_status = 'Cancelled' WHERE id = ?").run(
        voucherId
      );
      return res.json({
        success: true,
        message: `Draft Voucher ${orig.voucher_number} cancelled.`,
      });
    }
    if (orig.status === 'reversed') {
      return res.status(400).json({
        success: false,
        error: `Voucher ${orig.voucher_number} has already been reversed.`,
      });
    }

    const origLines = db
      .prepare('SELECT * FROM accounting_voucher_lines WHERE voucher_id = ? ORDER BY line_order ASC')
      .all(voucherId) as Array<Record<string, any>>;

    const tx = db.transaction(() => {
      const revVoucherNo = getNextAccountingVoucherNumber('JV');
      const revDate = new Date().toISOString().slice(0, 10);
      checkPeriodOpen(revDate);

      const insRev = db
        .prepare(
          `INSERT INTO accounting_vouchers (
             voucher_number, voucher_type, voucher_date, reference_number,
             narration, total_debit, total_credit, status, approval_status,
             created_by, approved_by, reversed_from_voucher_id
           ) VALUES (?, 'JV', ?, ?, ?, ?, ?, 'draft', 'Approved', ?, ?, ?)`
        )
        .run(
          revVoucherNo,
          revDate,
          orig.voucher_number,
          `REVERSAL of ${orig.voucher_number}: ${reason}`,
          orig.total_credit,
          orig.total_debit,
          reversed_by,
          reversed_by,
          voucherId
        );

      const revVoucherId = Number(insRev.lastInsertRowid);
      const insLine = db.prepare(
        `INSERT INTO accounting_voucher_lines (
           voucher_id, account_id, account_code, account_name,
           ledger_type, debit_amount, credit_amount, description, line_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const l of origLines) {
        insLine.run(
          revVoucherId,
          l.account_id,
          l.account_code,
          l.account_name,
          l.ledger_type,
          l.credit_amount, // Swap Credit -> Debit
          l.debit_amount,  // Swap Debit -> Credit
          `Reversal of ${orig.voucher_number}: ${l.description || reason}`,
          l.line_order
        );
      }

      postVoucherToJournal(revVoucherId);

      db.prepare(
        `UPDATE accounting_vouchers
         SET status = 'reversed',
             approval_status = 'Reversed',
             reversal_voucher_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(revVoucherId, voucherId);

      return revVoucherId;
    });

    const revId = tx();
    const revVoucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(revId);

    return res.json({
      success: true,
      message: `Voucher ${orig.voucher_number} safely reversed via Reversal Voucher ${(revVoucher as any)?.voucher_number}.`,
      reversalVoucher: revVoucher,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * 3. CUSTOMER LEDGER, SUPPLIER LEDGER, GENERAL LEDGER, CASH BOOK & BANK BOOK
 */
function buildDetailedAccountLedger(
  accountId: number,
  startDate?: string,
  endDate?: string,
  searchQuery?: string
) {
  const db = getDatabase();
  const openInfo = computeAccountSignedOpeningAsOf(accountId, startDate);
  const acc = openInfo.account;

  const conds: string[] = ['jl.account_id = ?', "je.status = 'posted'"];
  const params: unknown[] = [accountId];

  if (startDate && startDate.trim()) {
    conds.push('DATE(je.entry_date) >= DATE(?)');
    params.push(startDate.trim());
  }
  if (endDate && endDate.trim()) {
    conds.push('DATE(je.entry_date) <= DATE(?)');
    params.push(endDate.trim());
  }
  if (searchQuery && searchQuery.trim()) {
    const term = `%${searchQuery.trim()}%`;
    conds.push('(je.entry_number LIKE ? OR je.description LIKE ? OR jl.narration LIKE ?)');
    params.push(term, term, term);
  }

  const lines = db
    .prepare(
      `SELECT
         jl.id,
         jl.journal_entry_id,
         DATE(je.entry_date) as entry_date,
         je.entry_number,
         je.reference_type,
         je.reference_id,
         je.description as header_description,
         jl.narration,
         jl.ledger_type,
         jl.debit_amount,
         jl.credit_amount,
         CASE
           WHEN je.reference_type = 'SALE' THEN (SELECT invoice_number FROM sales WHERE id = je.reference_id)
           WHEN je.reference_type = 'SALE_RETURN' THEN (SELECT return_number FROM sale_returns WHERE id = je.reference_id)
           WHEN je.reference_type = 'PURCHASE' THEN (SELECT bill_number FROM purchases WHERE id = je.reference_id)
           WHEN je.reference_type = 'PURCHASE_RETURN' THEN (SELECT debit_note_number FROM purchase_returns WHERE id = je.reference_id)
           WHEN je.reference_type = 'VOUCHER' THEN COALESCE(
             (SELECT voucher_number FROM accounting_vouchers WHERE journal_entry_id = je.id),
             (SELECT voucher_number FROM payment_vouchers WHERE journal_entry_id = je.id),
             je.entry_number
           )
           WHEN je.reference_type = 'ADJUSTMENT' THEN COALESCE(
             (SELECT adjustment_number FROM stock_adjustments WHERE journal_entry_id = je.id),
             je.entry_number
           )
           ELSE je.entry_number
         END as document_number
       FROM journal_entry_lines jl
       INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE ${conds.join(' AND ')}
       ORDER BY DATE(je.entry_date) ASC, je.id ASC, jl.id ASC`
    )
    .all(...params) as Array<Record<string, any>>;

  let runningSigned = openInfo.signedOpening;
  let totalDebit = 0;
  let totalCredit = 0;

  let salesAmount = 0;
  let salesReturnsAmount = 0;
  let customerReceiptsAmount = 0;
  let purchasesAmount = 0;
  let purchaseReturnsAmount = 0;
  let supplierPaymentsAmount = 0;
  let adjustmentsAmount = 0;

  const naturalType: 'Debit' | 'Credit' = [
    'Supplier',
    'Liabilities',
    'Capital',
    'Loans',
    'Sales Income',
    'Purchase Discount',
    'Purchase Returns',
    'Other Income',
  ].includes(String(acc.account_group))
    ? 'Credit'
    : 'Debit';

  const entries = lines.map((l) => {
    const dr = round2(Number(l.debit_amount || 0));
    const cr = round2(Number(l.credit_amount || 0));
    totalDebit = round2(totalDebit + dr);
    totalCredit = round2(totalCredit + cr);
    runningSigned = round2(runningSigned + dr - cr);

    if (l.reference_type === 'SALE') {
      if (dr > 0) salesAmount = round2(salesAmount + dr);
      if (cr > 0) customerReceiptsAmount = round2(customerReceiptsAmount + cr);
    } else if (l.reference_type === 'SALE_RETURN') {
      salesReturnsAmount = round2(salesReturnsAmount + cr + dr);
    } else if (l.reference_type === 'PURCHASE') {
      if (cr > 0) purchasesAmount = round2(purchasesAmount + cr);
      if (dr > 0) supplierPaymentsAmount = round2(supplierPaymentsAmount + dr);
    } else if (l.reference_type === 'PURCHASE_RETURN') {
      purchaseReturnsAmount = round2(purchaseReturnsAmount + dr + cr);
    } else if (l.reference_type === 'VOUCHER') {
      if (cr > 0) customerReceiptsAmount = round2(customerReceiptsAmount + cr);
      if (dr > 0) supplierPaymentsAmount = round2(supplierPaymentsAmount + dr);
    } else {
      adjustmentsAmount = round2(adjustmentsAmount + dr + cr);
    }

    return {
      ...l,
      document_number: l.document_number || l.entry_number,
      description: l.narration || l.header_description || '',
      debit_amount: dr,
      credit_amount: cr,
      running_balance: round2(Math.abs(runningSigned)),
      running_balance_type: runningSigned > 0 ? 'Debit' : runningSigned < 0 ? 'Credit' : naturalType,
    };
  });

  return {
    account: acc,
    openingBalance: openInfo.openingBalance,
    openingBalanceType: openInfo.openingType,
    totalDebit,
    totalCredit,
    closingBalance: round2(Math.abs(runningSigned)),
    closingBalanceType: runningSigned > 0 ? 'Debit' : runningSigned < 0 ? 'Credit' : naturalType,
    breakdown: {
      salesAmount,
      salesReturnsAmount,
      customerReceiptsAmount,
      purchasesAmount,
      purchaseReturnsAmount,
      supplierPaymentsAmount,
      adjustmentsAmount,
    },
    entries,
  };
}

/**
 * GET /api/accounting/ledgers/customer
 */
accountingRouter.get('/ledgers/customer', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accountId, startDate, endDate, q } = req.query;

    const customers = db
      .prepare(
        `SELECT id, account_code, account_name, phone, city, filer_status,
                opening_balance, opening_balance_type, current_balance, current_balance_type
         FROM accounts
         WHERE account_group IN ('Customer', 'Customer & Supplier')
           AND is_system_account = 0
         ORDER BY account_name ASC`
      )
      .all() as Array<Record<string, any>>;

    const walkIn = db
      .prepare("SELECT id, account_code, account_name, phone, city, filer_status, opening_balance, opening_balance_type, current_balance, current_balance_type FROM accounts WHERE account_code = 'CUS-1001'")
      .get() as Record<string, any> | undefined;
    const allCustomerList = walkIn ? [walkIn, ...customers] : customers;

    const targetId =
      accountId && accountId !== 'all'
        ? Number(accountId)
        : allCustomerList[0]?.id || 0;

    if (!targetId) {
      return res.json({ success: true, customers: allCustomerList, ledger: null });
    }

    const ledger = buildDetailedAccountLedger(
      targetId,
      typeof startDate === 'string' ? startDate : undefined,
      typeof endDate === 'string' ? endDate : undefined,
      typeof q === 'string' ? q : undefined
    );

    return res.json({
      success: true,
      customers: allCustomerList,
      ledger,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/accounting/ledgers/supplier
 */
accountingRouter.get('/ledgers/supplier', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accountId, startDate, endDate, q } = req.query;

    const suppliers = db
      .prepare(
        `SELECT id, account_code, account_name, phone, city, ntn, strn, filer_status,
                opening_balance, opening_balance_type, current_balance, current_balance_type
         FROM accounts
         WHERE account_group IN ('Supplier', 'Customer & Supplier')
           AND is_system_account = 0
         ORDER BY account_name ASC`
      )
      .all() as Array<Record<string, any>>;

    const targetId =
      accountId && accountId !== 'all'
        ? Number(accountId)
        : suppliers[0]?.id || 0;

    if (!targetId) {
      return res.json({ success: true, suppliers, ledger: null });
    }

    const ledger = buildDetailedAccountLedger(
      targetId,
      typeof startDate === 'string' ? startDate : undefined,
      typeof endDate === 'string' ? endDate : undefined,
      typeof q === 'string' ? q : undefined
    );

    return res.json({
      success: true,
      suppliers,
      ledger,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/accounting/ledgers/general
 */
accountingRouter.get('/ledgers/general', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accountId, startDate, endDate, q } = req.query;

    const accounts = db
      .prepare(
        `SELECT id, account_code, account_name, main_group, account_group, financial_category,
                opening_balance, opening_balance_type, current_balance, current_balance_type
         FROM accounts
         ORDER BY account_code ASC`
      )
      .all() as Array<Record<string, any>>;

    const defaultAcc =
      accounts.find((a) => a.account_code === 'FIN-1010') || accounts[0];
    const targetId =
      accountId && accountId !== 'all' ? Number(accountId) : Number(defaultAcc?.id || 0);

    if (!targetId) {
      return res.json({ success: true, accounts, ledger: null });
    }

    const ledger = buildDetailedAccountLedger(
      targetId,
      typeof startDate === 'string' ? startDate : undefined,
      typeof endDate === 'string' ? endDate : undefined,
      typeof q === 'string' ? q : undefined
    );

    return res.json({
      success: true,
      accounts,
      ledger,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/accounting/ledgers/cash-book
 * Cash Book: Opening Cash, Cash Receipts, Cash Payments, Closing Cash & Daily Cash Balance
 */
accountingRouter.get('/ledgers/cash-book', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accountId, startDate, endDate, q } = req.query;

    const cashAccounts = db
      .prepare("SELECT * FROM accounts WHERE account_group = 'Cash in Hand' ORDER BY account_code ASC")
      .all() as Array<Record<string, any>>;

    const targetId =
      accountId && accountId !== 'all'
        ? Number(accountId)
        : Number(cashAccounts[0]?.id || 0);

    if (!targetId) {
      return res.status(404).json({ success: false, error: 'No Cash in Hand account found.' });
    }

    const ledger = buildDetailedAccountLedger(
      targetId,
      typeof startDate === 'string' ? startDate : undefined,
      typeof endDate === 'string' ? endDate : undefined,
      typeof q === 'string' ? q : undefined
    );

    // Group daily cash balances
    const dailyMap = new Map<
      string,
      {
        date: string;
        openingCash: number;
        cashReceipts: number;
        cashPayments: number;
        closingCash: number;
        txCount: number;
      }
    >();

    let runningDayBal =
      ledger.openingBalanceType === 'Debit' ? ledger.openingBalance : -ledger.openingBalance;

    for (const entry of ledger.entries as Array<Record<string, any>>) {
      const d = String(entry.entry_date);
      if (!dailyMap.has(d)) {
        dailyMap.set(d, {
          date: d,
          openingCash: round2(runningDayBal),
          cashReceipts: 0,
          cashPayments: 0,
          closingCash: round2(runningDayBal),
          txCount: 0,
        });
      }
      const bucket = dailyMap.get(d)!;
      bucket.cashReceipts = round2(bucket.cashReceipts + entry.debit_amount);
      bucket.cashPayments = round2(bucket.cashPayments + entry.credit_amount);
      runningDayBal = round2(runningDayBal + entry.debit_amount - entry.credit_amount);
      bucket.closingCash = runningDayBal;
      bucket.txCount += 1;
    }

    return res.json({
      success: true,
      cashAccounts,
      ledger,
      dailySummary: Array.from(dailyMap.values()),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/accounting/ledgers/bank-book
 * Bank Book: Bank Deposits, Withdrawals, Payments, Receipts & Running Bank Balance
 */
accountingRouter.get('/ledgers/bank-book', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accountId, startDate, endDate, q } = req.query;

    const bankAccounts = db
      .prepare(
        "SELECT * FROM accounts WHERE account_group = 'Bank' AND account_code != 'FIN-1020' ORDER BY account_code ASC"
      )
      .all() as Array<Record<string, any>>;

    const allBanks =
      bankAccounts.length > 0
        ? bankAccounts
        : (db
            .prepare("SELECT * FROM accounts WHERE account_group = 'Bank' ORDER BY account_code ASC")
            .all() as Array<Record<string, any>>);

    const targetId =
      accountId && accountId !== 'all' ? Number(accountId) : Number(allBanks[0]?.id || 0);

    if (!targetId) {
      return res.status(404).json({ success: false, error: 'No Bank Account found.' });
    }

    const ledger = buildDetailedAccountLedger(
      targetId,
      typeof startDate === 'string' ? startDate : undefined,
      typeof endDate === 'string' ? endDate : undefined,
      typeof q === 'string' ? q : undefined
    );

    return res.json({
      success: true,
      bankAccounts: allBanks,
      ledger,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * 4. ADVANCE TAX ACCOUNTING MODULE
 * Advance Tax Ledger, Collection/Deduction Details, Rate History, Register & Reconciliation
 */
accountingRouter.get('/advance-tax', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { startDate, endDate, filerStatus, q } = req.query;

    const settings = db.prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1').get();
    const history = db.prepare('SELECT * FROM advance_tax_history ORDER BY id DESC').all();

    const receivableAcc = db
      .prepare("SELECT id FROM accounts WHERE account_code = 'TAX-1040'")
      .get() as { id: number } | undefined;
    const payableAcc = db
      .prepare("SELECT id FROM accounts WHERE account_code = 'TAX-2040'")
      .get() as { id: number } | undefined;

    const receivableLedger = receivableAcc
      ? buildDetailedAccountLedger(
          receivableAcc.id,
          typeof startDate === 'string' ? startDate : undefined,
          typeof endDate === 'string' ? endDate : undefined,
          typeof q === 'string' ? q : undefined
        )
      : null;

    const payableLedger = payableAcc
      ? buildDetailedAccountLedger(
          payableAcc.id,
          typeof startDate === 'string' ? startDate : undefined,
          typeof endDate === 'string' ? endDate : undefined,
          typeof q === 'string' ? q : undefined
        )
      : null;

    // Build Tax Transaction Register across Purchases, Purchase Returns, Sales, and Sales Returns
    const purConds: string[] = ["p.status = 'completed'"];
    const purParams: unknown[] = [];
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      purConds.push('DATE(p.bill_date) >= DATE(?)');
      purParams.push(startDate.trim());
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      purConds.push('DATE(p.bill_date) <= DATE(?)');
      purParams.push(endDate.trim());
    }
    if (filerStatus && filerStatus !== 'all') {
      purConds.push('p.supplier_filer_status = ?');
      purParams.push(filerStatus);
    }

    const purchaseTaxRows = db
      .prepare(
        `SELECT
           'PURCHASE' as tx_type,
           p.id as tx_id,
           p.bill_number as document_number,
           p.bill_date as tx_date,
           a.account_code as party_code,
           a.account_name as party_name,
           a.ntn as party_ntn,
           a.strn as party_strn,
           p.supplier_filer_status as filer_status,
           p.taxable_amount,
           p.gst_amount,
           p.advance_tax_basis as tax_basis,
           p.advance_tax_rate as tax_rate,
           p.advance_tax_amount as tax_amount,
           p.is_tax_overridden,
           p.tax_override_reason,
           p.net_total,
           'TAX-1040 (Receivable)' as tax_account_head
         FROM purchases p
         INNER JOIN accounts a ON a.id = p.supplier_account_id
         WHERE ${purConds.join(' AND ')}
         ORDER BY DATE(p.bill_date) DESC, p.id DESC`
      )
      .all(...purParams) as Array<Record<string, any>>;

    const prConds: string[] = ["pr.status = 'completed'"];
    const prParams: unknown[] = [];
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      prConds.push('DATE(pr.return_date) >= DATE(?)');
      prParams.push(startDate.trim());
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      prConds.push('DATE(pr.return_date) <= DATE(?)');
      prParams.push(endDate.trim());
    }
    if (filerStatus && filerStatus !== 'all') {
      prConds.push('pr.supplier_filer_status = ?');
      prParams.push(filerStatus);
    }

    const purchaseReturnTaxRows = db
      .prepare(
        `SELECT
           'PURCHASE_RETURN' as tx_type,
           pr.id as tx_id,
           pr.debit_note_number as document_number,
           pr.return_date as tx_date,
           a.account_code as party_code,
           a.account_name as party_name,
           a.ntn as party_ntn,
           a.strn as party_strn,
           pr.supplier_filer_status as filer_status,
           pr.taxable_return_amount as taxable_amount,
           pr.gst_adjustment_amount as gst_amount,
           'taxable_plus_gst' as tax_basis,
           pr.advance_tax_rate as tax_rate,
           -pr.advance_tax_adjustment_amount as tax_amount,
           0 as is_tax_overridden,
           pr.return_reason as tax_override_reason,
           pr.total_debit_amount as net_total,
           'TAX-1040 (Receivable Reversal)' as tax_account_head
         FROM purchase_returns pr
         INNER JOIN accounts a ON a.id = pr.supplier_account_id
         WHERE ${prConds.join(' AND ')} AND pr.advance_tax_adjustment_amount > 0`
      )
      .all(...prParams) as Array<Record<string, any>>;

    const salConds: string[] = ["s.status = 'completed'"];
    const salParams: unknown[] = [];
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      salConds.push('DATE(s.invoice_date) >= DATE(?)');
      salParams.push(startDate.trim());
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      salConds.push('DATE(s.invoice_date) <= DATE(?)');
      salParams.push(endDate.trim());
    }
    if (filerStatus && filerStatus !== 'all') {
      salConds.push('s.customer_filer_status = ?');
      salParams.push(filerStatus);
    }

    const salesTaxRows = db
      .prepare(
        `SELECT
           'SALE' as tx_type,
           s.id as tx_id,
           s.invoice_number as document_number,
           s.invoice_date as tx_date,
           COALESCE(a.account_code, 'CUS-1001') as party_code,
           s.customer_name as party_name,
           a.ntn as party_ntn,
           a.strn as party_strn,
           s.customer_filer_status as filer_status,
           s.taxable_amount,
           s.gst_amount,
           'taxable_plus_gst' as tax_basis,
           s.advance_tax_rate as tax_rate,
           s.advance_tax_amount as tax_amount,
           s.is_tax_overridden,
           s.tax_override_reason,
           s.net_total,
           'TAX-2040 (Payable Collected)' as tax_account_head
         FROM sales s
         LEFT JOIN accounts a ON a.id = s.customer_account_id
         WHERE ${salConds.join(' AND ')} AND (s.advance_tax_applicable = 1 OR s.advance_tax_amount > 0)`
      )
      .all(...salParams) as Array<Record<string, any>>;

    const srConds: string[] = ["sr.status = 'completed'"];
    const srParams: unknown[] = [];
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      srConds.push('DATE(sr.return_date) >= DATE(?)');
      srParams.push(startDate.trim());
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      srConds.push('DATE(sr.return_date) <= DATE(?)');
      srParams.push(endDate.trim());
    }

    const salesReturnTaxRows = db
      .prepare(
        `SELECT
           'SALE_RETURN' as tx_type,
           sr.id as tx_id,
           sr.return_number as document_number,
           sr.return_date as tx_date,
           COALESCE(a.account_code, 'CUS-1001') as party_code,
           sr.customer_name as party_name,
           a.ntn as party_ntn,
           a.strn as party_strn,
           COALESCE(a.filer_status, 'Non-Filer') as filer_status,
           sr.taxable_return_amount as taxable_amount,
           sr.gst_adjustment_amount as gst_amount,
           'taxable_plus_gst' as tax_basis,
           0 as tax_rate,
           -sr.advance_tax_adjustment_amount as tax_amount,
           0 as is_tax_overridden,
           sr.return_reason as tax_override_reason,
           sr.total_refund_amount as net_total,
           'TAX-2040 (Payable Reversal)' as tax_account_head
         FROM sale_returns sr
         LEFT JOIN accounts a ON a.id = sr.customer_account_id
         WHERE ${srConds.join(' AND ')} AND sr.advance_tax_adjustment_amount > 0`
      )
      .all(...srParams) as Array<Record<string, any>>;

    const register = [
      ...purchaseTaxRows,
      ...purchaseReturnTaxRows,
      ...salesTaxRows,
      ...salesReturnTaxRows,
    ].sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)));

    // Reconciliation between Invoice Records and General Ledger Accounts
    const invoicePurchaseAdvTax = round2(
      purchaseTaxRows.reduce((s, r) => s + Number(r.tax_amount || 0), 0) +
        purchaseReturnTaxRows.reduce((s, r) => s + Number(r.tax_amount || 0), 0)
    );
    const glPurchaseAdvTax = receivableLedger
      ? round2(receivableLedger.totalDebit - receivableLedger.totalCredit)
      : 0;

    const invoiceSalesAdvTax = round2(
      salesTaxRows.reduce((s, r) => s + Number(r.tax_amount || 0), 0) +
        salesReturnTaxRows.reduce((s, r) => s + Number(r.tax_amount || 0), 0)
    );
    const glSalesAdvTax = payableLedger
      ? round2(payableLedger.totalCredit - payableLedger.totalDebit)
      : 0;

    return res.json({
      success: true,
      settings,
      history,
      receivableLedger,
      payableLedger,
      register,
      reconciliation: {
        invoicePurchaseAdvTax,
        glPurchaseAdvTax,
        purchaseVariance: round2(invoicePurchaseAdvTax - glPurchaseAdvTax),
        invoiceSalesAdvTax,
        glSalesAdvTax,
        salesVariance: round2(invoiceSalesAdvTax - glSalesAdvTax),
        netAdvanceTaxPosition: round2(glPurchaseAdvTax - glSalesAdvTax),
        isReconciled:
          round2(invoicePurchaseAdvTax - glPurchaseAdvTax) === 0 &&
          round2(invoiceSalesAdvTax - glSalesAdvTax) === 0,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * Helper to compute all accounts' Opening, Period Debit/Credit, and Closing Balances for Financial Statements
 */
function computeAllAccountPeriodBalances(startDate?: string, endDate?: string) {
  const db = getDatabase();
  const accounts = db
    .prepare('SELECT * FROM accounts ORDER BY account_code ASC')
    .all() as Array<Record<string, any>>;

  const priorMap = new Map<number, { dr: number; cr: number }>();
  if (startDate && startDate.trim()) {
    const priorRows = db
      .prepare(
        `SELECT
           jl.account_id,
           COALESCE(SUM(jl.debit_amount), 0) as dr,
           COALESCE(SUM(jl.credit_amount), 0) as cr
         FROM journal_entry_lines jl
         INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.status = 'posted'
           AND DATE(je.entry_date) < DATE(?)
         GROUP BY jl.account_id`
      )
      .all(startDate.trim()) as Array<{ account_id: number; dr: number; cr: number }>;
    for (const r of priorRows) {
      priorMap.set(Number(r.account_id), { dr: Number(r.dr || 0), cr: Number(r.cr || 0) });
    }
  }

  const periodConds: string[] = ["je.status = 'posted'"];
  const periodParams: unknown[] = [];
  if (startDate && startDate.trim()) {
    periodConds.push('DATE(je.entry_date) >= DATE(?)');
    periodParams.push(startDate.trim());
  }
  if (endDate && endDate.trim()) {
    periodConds.push('DATE(je.entry_date) <= DATE(?)');
    periodParams.push(endDate.trim());
  }

  const periodRows = db
    .prepare(
      `SELECT
         jl.account_id,
         COALESCE(SUM(jl.debit_amount), 0) as dr,
         COALESCE(SUM(jl.credit_amount), 0) as cr
       FROM journal_entry_lines jl
       INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE ${periodConds.join(' AND ')}
       GROUP BY jl.account_id`
    )
    .all(...periodParams) as Array<{ account_id: number; dr: number; cr: number }>;

  const periodMap = new Map<number, { dr: number; cr: number }>();
  for (const r of periodRows) {
    periodMap.set(Number(r.account_id), { dr: Number(r.dr || 0), cr: Number(r.cr || 0) });
  }

  return accounts.map((acc) => {
    const id = Number(acc.id);
    const baseOpen = round2(Number(acc.opening_balance || 0));
    const baseOpenType = acc.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
    let signedOpen = baseOpenType === 'Debit' ? baseOpen : -baseOpen;

    const prior = priorMap.get(id);
    if (prior) {
      signedOpen = round2(signedOpen + prior.dr - prior.cr);
    }

    const period = periodMap.get(id) || { dr: 0, cr: 0 };
    const periodDebit = round2(period.dr);
    const periodCredit = round2(period.cr);
    const signedClosing = round2(signedOpen + periodDebit - periodCredit);

    const pillar =
      (acc.financial_category as FinancialPillar) ||
      resolveFinancialPillar(String(acc.account_group), String(acc.current_balance_type));

    return {
      id,
      account_code: String(acc.account_code),
      account_name: String(acc.account_name),
      main_group: String(acc.main_group),
      account_group: String(acc.account_group),
      financial_category: pillar,
      parent_account_id: acc.parent_account_id,
      is_system_account: Number(acc.is_system_account || 0),
      opening_debit: signedOpen > 0 ? round2(signedOpen) : 0,
      opening_credit: signedOpen < 0 ? round2(Math.abs(signedOpen)) : 0,
      period_debit: periodDebit,
      period_credit: periodCredit,
      closing_debit: signedClosing > 0 ? round2(signedClosing) : 0,
      closing_credit: signedClosing < 0 ? round2(Math.abs(signedClosing)) : 0,
      signed_closing: signedClosing,
    };
  });
}

/**
 * 5. GET /api/accounting/reports/:reportType
 * All 11 Financial Reports generated from actual posted accounting entries
 */
accountingRouter.get('/reports/:reportType', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { reportType } = req.params;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const accountId = req.query.accountId ? String(req.query.accountId) : 'all';

    const balances = computeAllAccountPeriodBalances(startDate, endDate);

    switch (reportType) {
      case 'trial-balance': {
        const activeRows = balances.filter(
          (b) =>
            b.opening_debit > 0 ||
            b.opening_credit > 0 ||
            b.period_debit > 0 ||
            b.period_credit > 0 ||
            b.closing_debit > 0 ||
            b.closing_credit > 0
        );

        const totals = activeRows.reduce(
          (acc, r) => ({
            openingDebit: round2(acc.openingDebit + r.opening_debit),
            openingCredit: round2(acc.openingCredit + r.opening_credit),
            periodDebit: round2(acc.periodDebit + r.period_debit),
            periodCredit: round2(acc.periodCredit + r.period_credit),
            closingDebit: round2(acc.closingDebit + r.closing_debit),
            closingCredit: round2(acc.closingCredit + r.closing_credit),
          }),
          {
            openingDebit: 0,
            openingCredit: 0,
            periodDebit: 0,
            periodCredit: 0,
            closingDebit: 0,
            closingCredit: 0,
          }
        );

        return res.json({
          success: true,
          reportType,
          rows: activeRows,
          totals: {
            ...totals,
            isBalanced:
              round2(totals.periodDebit - totals.periodCredit) === 0 &&
              round2(totals.closingDebit - totals.closingCredit) === 0,
          },
        });
      }

      case 'profit-loss': {
        const salesAcc = balances.find((b) => b.account_code === 'INC-4010');
        const salesRetAcc = balances.find((b) => b.account_code === 'SAL-4015');
        const salesDiscAcc = balances.find((b) => b.account_code === 'DIS-5015');
        const cogsAcc = balances.find((b) => b.account_code === 'EXP-5005');
        const purAcc = balances.find((b) => b.account_code === 'PUR-5001');
        const purRetAcc = balances.find((b) => b.account_code === 'PUR-5002');
        const invAcc = balances.find((b) => b.account_code === 'INV-1030');

        const grossSales = round2((salesAcc?.period_credit || 0) - (salesAcc?.period_debit || 0));
        const salesReturns = round2((salesRetAcc?.period_debit || 0) - (salesRetAcc?.period_credit || 0));
        const salesDiscounts = round2((salesDiscAcc?.period_debit || 0) - (salesDiscAcc?.period_credit || 0));
        const netSalesRevenue = round2(grossSales - salesReturns - salesDiscounts);

        const costOfGoodsSold = round2((cogsAcc?.period_debit || 0) - (cogsAcc?.period_credit || 0));
        const grossProfit = round2(netSalesRevenue - costOfGoodsSold);

        const otherIncomeRows = balances
          .filter(
            (b) =>
              b.financial_category === 'Income' &&
              !['INC-4010', 'SAL-4015'].includes(b.account_code) &&
              b.period_credit - b.period_debit !== 0
          )
          .map((b) => ({
            ...b,
            amount: round2(b.period_credit - b.period_debit),
          }));

        const totalOtherIncome = round2(otherIncomeRows.reduce((s, r) => s + r.amount, 0));

        const operatingExpenseRows = balances
          .filter(
            (b) =>
              b.financial_category === 'Expenses' &&
              !['EXP-5005', 'DIS-5015', 'PUR-5001', 'PUR-5002'].includes(b.account_code) &&
              b.period_debit - b.period_credit !== 0
          )
          .map((b) => ({
            ...b,
            amount: round2(b.period_debit - b.period_credit),
          }));

        const totalOperatingExpenses = round2(
          operatingExpenseRows.reduce((s, r) => s + r.amount, 0)
        );
        const netProfit = round2(grossProfit + totalOtherIncome - totalOperatingExpenses);

        return res.json({
          success: true,
          reportType,
          statement: {
            grossSales,
            salesReturns,
            salesDiscounts,
            netSalesRevenue,
            costOfGoodsSold,
            grossPurchasesMemo: round2(purAcc?.period_debit || 0),
            purchaseReturnsMemo: round2(purRetAcc?.period_credit || 0),
            closingInventoryMemo: round2(invAcc?.closing_debit || 0),
            grossProfit,
            otherIncomeRows,
            totalOtherIncome,
            operatingExpenseRows,
            totalOperatingExpenses,
            netProfit,
          },
        });
      }

      case 'balance-sheet': {
        // Compute cumulative Net Profit up to endDate for Retained Earnings / Equity
        const cumulativeBalances = computeAllAccountPeriodBalances(undefined, endDate);

        const incomeNet = round2(
          cumulativeBalances
            .filter((b) => b.financial_category === 'Income')
            .reduce((s, b) => s + (b.closing_credit - b.closing_debit), 0)
        );
        const expenseNet = round2(
          cumulativeBalances
            .filter((b) => b.financial_category === 'Expenses')
            .reduce((s, b) => s + (b.closing_debit - b.closing_credit), 0)
        );
        const retainedNetProfit = round2(incomeNet - expenseNet);

        const assetRows = cumulativeBalances
          .filter((b) => b.financial_category === 'Assets' && b.signed_closing !== 0)
          .map((b) => ({
            ...b,
            amount: round2(b.signed_closing),
          }));

        const liabilityRows = cumulativeBalances
          .filter((b) => b.financial_category === 'Liabilities' && b.signed_closing !== 0)
          .map((b) => ({
            ...b,
            amount: round2(-b.signed_closing),
          }));

        const equityRows = cumulativeBalances
          .filter((b) => b.financial_category === 'Capital / Equity' && b.signed_closing !== 0)
          .map((b) => ({
            ...b,
            amount: round2(-b.signed_closing), // Capital is Credit (+), Drawings is Debit (-)
          }));

        const totalAssets = round2(assetRows.reduce((s, r) => s + r.amount, 0));
        const totalLiabilities = round2(liabilityRows.reduce((s, r) => s + r.amount, 0));
        const baseEquity = round2(equityRows.reduce((s, r) => s + r.amount, 0));
        const totalEquity = round2(baseEquity + retainedNetProfit);
        const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);

        return res.json({
          success: true,
          reportType,
          balanceSheet: {
            assetRows,
            liabilityRows,
            equityRows,
            retainedNetProfit,
            totalAssets,
            totalLiabilities,
            baseEquity,
            totalEquity,
            totalLiabilitiesAndEquity,
            isBalanced: round2(totalAssets - totalLiabilitiesAndEquity) === 0,
          },
        });
      }

      case 'cash-flow': {
        const cashAndBankAccounts = balances.filter((b) =>
          ['Cash in Hand', 'Bank'].includes(b.account_group)
        );
        const cashIds = cashAndBankAccounts.map((a) => a.id);

        const openingCashAndBank = round2(
          cashAndBankAccounts.reduce((s, a) => s + (a.opening_debit - a.opening_credit), 0)
        );
        const closingCashAndBank = round2(
          cashAndBankAccounts.reduce((s, a) => s + (a.closing_debit - a.closing_credit), 0)
        );

        let inflowsFromCustomers = 0;
        let outflowsToSuppliers = 0;
        let outflowsForExpensesAndTax = 0;
        let financingFlows = 0;

        if (cashIds.length > 0) {
          const conds: string[] = [
            `jl.account_id IN (${cashIds.join(',')})`,
            "je.status = 'posted'",
          ];
          const params: unknown[] = [];
          if (startDate && startDate.trim()) {
            conds.push('DATE(je.entry_date) >= DATE(?)');
            params.push(startDate.trim());
          }
          if (endDate && endDate.trim()) {
            conds.push('DATE(je.entry_date) <= DATE(?)');
            params.push(endDate.trim());
          }

          const cashLines = db
            .prepare(
              `SELECT jl.debit_amount, jl.credit_amount, je.reference_type, je.description
               FROM journal_entry_lines jl
               INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
               WHERE ${conds.join(' AND ')}`
            )
            .all(...params) as Array<Record<string, any>>;

          for (const cl of cashLines) {
            const net = round2(Number(cl.debit_amount || 0) - Number(cl.credit_amount || 0));
            if (cl.reference_type === 'SALE' || cl.reference_type === 'SALE_RETURN') {
              inflowsFromCustomers = round2(inflowsFromCustomers + net);
            } else if (cl.reference_type === 'PURCHASE' || cl.reference_type === 'PURCHASE_RETURN') {
              outflowsToSuppliers = round2(outflowsToSuppliers + net);
            } else if (String(cl.description || '').toLowerCase().includes('capital') || String(cl.description || '').toLowerCase().includes('drawing')) {
              financingFlows = round2(financingFlows + net);
            } else if (net > 0) {
              inflowsFromCustomers = round2(inflowsFromCustomers + net);
            } else {
              outflowsForExpensesAndTax = round2(outflowsForExpensesAndTax + net);
            }
          }
        }

        const netCashChange = round2(closingCashAndBank - openingCashAndBank);

        return res.json({
          success: true,
          reportType,
          cashFlow: {
            openingCashAndBank,
            inflowsFromCustomers,
            outflowsToSuppliers,
            outflowsForExpensesAndTax,
            operatingCashFlow: round2(
              inflowsFromCustomers + outflowsToSuppliers + outflowsForExpensesAndTax
            ),
            financingFlows,
            netCashChange,
            closingCashAndBank,
            accounts: cashAndBankAccounts,
          },
        });
      }

      case 'day-book': {
        const conds: string[] = ["je.status = 'posted'"];
        const params: unknown[] = [];
        if (startDate && startDate.trim()) {
          conds.push('DATE(je.entry_date) >= DATE(?)');
          params.push(startDate.trim());
        }
        if (endDate && endDate.trim()) {
          conds.push('DATE(je.entry_date) <= DATE(?)');
          params.push(endDate.trim());
        }

        const entries = db
          .prepare(
            `SELECT je.*
             FROM journal_entries je
             WHERE ${conds.join(' AND ')}
             ORDER BY DATE(je.entry_date) DESC, je.id DESC`
          )
          .all(...params) as Array<Record<string, any>>;

        const lineStmt = db.prepare(
          `SELECT jl.*, a.account_code, a.account_name, a.account_group
           FROM journal_entry_lines jl
           INNER JOIN accounts a ON a.id = jl.account_id
           WHERE jl.journal_entry_id = ?
           ORDER BY jl.id ASC`
        );

        const rows = entries.map((e) => ({
          ...e,
          lines: lineStmt.all(e.id),
        }));

        return res.json({
          success: true,
          reportType,
          rows,
        });
      }

      case 'account-summary': {
        const rows =
          accountId !== 'all'
            ? balances.filter((b) => String(b.id) === accountId)
            : balances;
        return res.json({
          success: true,
          reportType,
          rows,
        });
      }

      case 'customer-outstanding': {
        const rows = balances
          .filter(
            (b) =>
              ['Customer', 'Customer & Supplier'].includes(b.account_group) &&
              b.is_system_account === 0
          )
          .map((b) => ({
            ...b,
            net_receivable: round2(b.closing_debit - b.closing_credit),
          }));
        return res.json({
          success: true,
          reportType,
          rows,
        });
      }

      case 'supplier-outstanding': {
        const rows = balances
          .filter(
            (b) =>
              ['Supplier', 'Customer & Supplier'].includes(b.account_group) &&
              b.is_system_account === 0
          )
          .map((b) => ({
            ...b,
            net_payable: round2(b.closing_credit - b.closing_debit),
          }));
        return res.json({
          success: true,
          reportType,
          rows,
        });
      }

      case 'expense-summary': {
        const rows = balances
          .filter((b) => b.financial_category === 'Expenses' && (b.period_debit > 0 || b.closing_debit > 0))
          .map((b) => ({
            ...b,
            net_expense: round2(b.period_debit - b.period_credit),
          }));
        const totalExpense = round2(rows.reduce((s, r) => s + r.net_expense, 0));
        return res.json({
          success: true,
          reportType,
          rows,
          totalExpense,
        });
      }

      case 'income-summary': {
        const rows = balances
          .filter((b) => b.financial_category === 'Income' && (b.period_credit > 0 || b.closing_credit > 0))
          .map((b) => ({
            ...b,
            net_income: round2(b.period_credit - b.period_debit),
          }));
        const totalIncome = round2(rows.reduce((s, r) => s + r.net_income, 0));
        return res.json({
          success: true,
          reportType,
          rows,
          totalIncome,
        });
      }

      case 'advance-tax-report': {
        const taxAccounts = balances.filter((b) =>
          ['TAX-1040', 'TAX-1045', 'TAX-2040', 'TAX-2045'].includes(b.account_code)
        );
        return res.json({
          success: true,
          reportType,
          rows: taxAccounts,
        });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown report type: ${reportType}` });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});
