import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { authenticateToken } from '../middleware/authMiddleware.ts';
import { assertPeriodOpen } from '../utils/periodLock.ts';

export const cashBookRouter = Router();

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Ensures Cash Book tables exist in the database
 */
function ensureCashBookSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_book_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT NOT NULL UNIQUE,
      sequence_number INTEGER NOT NULL UNIQUE,
      voucher_date TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('Receipt', 'Payment', 'Contra', 'Expense', 'Capital')),
      category TEXT NOT NULL CHECK(category IN (
        'customer_receipt',
        'supplier_payment',
        'shop_expense',
        'capital_introduced',
        'drawings',
        'cash_deposit_bank',
        'cash_withdrawal_bank',
        'bank_transfer',
        'other_receipt',
        'other_payment'
      )),
      head_account_id INTEGER NOT NULL,
      head_account_code TEXT NOT NULL,
      head_account_name TEXT NOT NULL,
      cash_bank_account_id INTEGER NOT NULL,
      cash_bank_account_code TEXT NOT NULL,
      cash_bank_account_name TEXT NOT NULL,
      receipt_amount REAL NOT NULL DEFAULT 0.0 CHECK(receipt_amount >= 0),
      payment_amount REAL NOT NULL DEFAULT 0.0 CHECK(payment_amount >= 0),
      net_amount REAL NOT NULL DEFAULT 0.0 CHECK(net_amount >= 0),
      narration TEXT DEFAULT '',
      reference_number TEXT DEFAULT '',
      journal_entry_id INTEGER,
      accounting_voucher_id INTEGER,
      status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'cancelled')),
      created_by TEXT NOT NULL DEFAULT 'Super Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (head_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
      FOREIGN KEY (cash_bank_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
      FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL,
      FOREIGN KEY (accounting_voucher_id) REFERENCES accounting_vouchers (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_no ON cash_book_vouchers(voucher_number);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_seq ON cash_book_vouchers(sequence_number);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_date ON cash_book_vouchers(voucher_date);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_type ON cash_book_vouchers(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_head ON cash_book_vouchers(head_account_id);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_cb_acc ON cash_book_vouchers(cash_bank_account_id);
    CREATE INDEX IF NOT EXISTS idx_cb_vouchers_status ON cash_book_vouchers(status);

    CREATE TABLE IF NOT EXISTS cash_book_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence_key TEXT NOT NULL UNIQUE,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_book_audit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER,
      voucher_number TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      previous_values TEXT,
      new_values TEXT,
      performed_by TEXT NOT NULL,
      performed_by_role TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Helper to record immutable audit history for cash book vouchers
 */
function recordCashBookAudit(data: {
  voucher_id?: number | null;
  voucher_number: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED' | 'CANCELLED';
  details?: string;
  previous_values?: any;
  new_values?: any;
  performed_by: string;
  performed_by_role?: string;
}) {
  try {
    ensureCashBookSchema();
    const db = getDatabase();
    db.prepare(`
      INSERT INTO cash_book_audit_history (
        voucher_id, voucher_number, action, details, previous_values, new_values, performed_by, performed_by_role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      data.voucher_id ?? null,
      data.voucher_number,
      data.action,
      data.details || '',
      data.previous_values ? JSON.stringify(data.previous_values) : null,
      data.new_values ? JSON.stringify(data.new_values) : null,
      data.performed_by,
      data.performed_by_role || 'Staff'
    );
  } catch (err) {
    console.error('[Cash Book Audit Log Error]', err);
  }
}

/**
 * Returns the next sequential continuous voucher number.
 * Example: 001, 002, 003... never resets on a new day.
 * High-water mark is persisted in cash_book_sequences so deleted voucher numbers are NEVER reused.
 */
function getNextContinuousVoucherNumber(): { nextSequence: number; nextVoucherNumber: string } {
  ensureCashBookSchema();
  const db = getDatabase();

  const curMaxVoucher = Number(
    (db.prepare('SELECT COALESCE(MAX(sequence_number), 0) as m FROM cash_book_vouchers').get() as { m: number })?.m || 0
  );

  let seqRow = db
    .prepare("SELECT last_sequence FROM cash_book_sequences WHERE sequence_key = 'voucher_continuous'")
    .get() as { last_sequence: number } | undefined;

  if (!seqRow) {
    db.prepare(`
      INSERT INTO cash_book_sequences (sequence_key, last_sequence, updated_at)
      VALUES ('voucher_continuous', ?, CURRENT_TIMESTAMP)
    `).run(curMaxVoucher);
    seqRow = { last_sequence: curMaxVoucher };
  }

  const baseSeq = Math.max(seqRow.last_sequence, curMaxVoucher);
  let nextSeq = baseSeq + 1;
  let formattedNo = String(nextSeq).padStart(3, '0');

  // Verify no duplicate in active vouchers
  while (
    db.prepare('SELECT id FROM cash_book_vouchers WHERE voucher_number = ? OR sequence_number = ?').get(formattedNo, nextSeq)
  ) {
    nextSeq++;
    formattedNo = String(nextSeq).padStart(3, '0');
  }

  return { nextSequence: nextSeq, nextVoucherNumber: formattedNo };
}

/**
 * GET /api/cash-book/next-number
 */
cashBookRouter.get('/next-number', authenticateToken, (_req: Request, res: Response) => {
  try {
    const { nextSequence, nextVoucherNumber } = getNextContinuousVoucherNumber();
    return res.json({
      success: true,
      nextSequence,
      nextVoucherNumber,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/accounts
 * Searchable list of accounts categorized for Cash Book
 */
cashBookRouter.get('/accounts', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const allAccounts = db
      .prepare(
        `SELECT id, account_code, account_name, main_group, account_group,
                current_balance, current_balance_type, opening_balance, opening_balance_type,
                phone, filer_status
         FROM accounts
         WHERE status = 'Active'
         ORDER BY account_name ASC`
      )
      .all() as Array<Record<string, any>>;

    const cashAccounts = allAccounts.filter((a) => a.account_group === 'Cash in Hand');
    const bankAccounts = allAccounts.filter((a) => a.account_group === 'Bank');
    const customerAccounts = allAccounts.filter((a) =>
      ['Customer', 'Customer & Supplier'].includes(a.account_group)
    );
    const supplierAccounts = allAccounts.filter((a) =>
      ['Supplier', 'Customer & Supplier'].includes(a.account_group)
    );
    const expenseAccounts = allAccounts.filter((a) =>
      [
        'Electricity',
        'Rent',
        'Salaries',
        'Shop Expenses',
        'Other Expenses',
        'Expenses',
      ].includes(a.account_group)
    );
    const capitalAccounts = allAccounts.filter((a) =>
      ['Capital', 'Drawings'].includes(a.account_group)
    );
    const incomeAccounts = allAccounts.filter((a) =>
      ['Sales Income', 'Other Income', 'Income'].includes(a.account_group)
    );

    // Default cash account
    const defaultCashAccount =
      cashAccounts.find((a) => a.account_code === 'FIN-1010') || cashAccounts[0] || null;

    return res.json({
      success: true,
      defaultCashAccount,
      cashAccounts,
      bankAccounts,
      customerAccounts,
      supplierAccounts,
      expenseAccounts,
      capitalAccounts,
      incomeAccounts,
      allAccounts,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/summary
 * Opening Balance, Total Receipts, Total Payments, Closing Balance & Daily Register
 */
cashBookRouter.get('/summary', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureCashBookSchema();
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const startDate = String(req.query.startDate || today).trim();
    const endDate = String(req.query.endDate || today).trim();

    // 1. Locate primary Cash in Hand and Bank accounts
    const cashAccs = db
      .prepare("SELECT id, account_code, account_name, opening_balance, opening_balance_type FROM accounts WHERE account_group = 'Cash in Hand'")
      .all() as Array<Record<string, any>>;

    const bankAccs = db
      .prepare("SELECT id, account_code, account_name, opening_balance, opening_balance_type FROM accounts WHERE account_group = 'Bank'")
      .all() as Array<Record<string, any>>;

    const cashIds = cashAccs.map((a) => Number(a.id));
    const bankIds = bankAccs.map((a) => Number(a.id));

    // Helper: Compute balance of account IDs before a given date
    const computeBalanceBeforeDate = (accIds: number[], dateStr: string): number => {
      if (accIds.length === 0) return 0;
      const placeholders = accIds.map(() => '?').join(',');

      // Opening balance defined in accounts table
      const openRows = db
        .prepare(`SELECT opening_balance, opening_balance_type FROM accounts WHERE id IN (${placeholders})`)
        .all(...accIds) as Array<{ opening_balance: number; opening_balance_type: string }>;

      let openBal = 0;
      for (const r of openRows) {
        const amt = Number(r.opening_balance || 0);
        openBal += r.opening_balance_type === 'Credit' ? -amt : amt;
      }

      // Sum posted journal transactions prior to dateStr
      const txRow = db
        .prepare(`
          SELECT
            COALESCE(SUM(jl.debit_amount), 0) as dr,
            COALESCE(SUM(jl.credit_amount), 0) as cr
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE jl.account_id IN (${placeholders})
            AND je.status = 'posted'
            AND DATE(je.entry_date) < DATE(?)
        `)
        .get(...accIds, dateStr) as { dr: number; cr: number };

      const netTx = (Number(txRow?.dr) || 0) - (Number(txRow?.cr) || 0);
      return round2(openBal + netTx);
    };

    const openingCashBalance = computeBalanceBeforeDate(cashIds, startDate);
    const openingBankBalance = computeBalanceBeforeDate(bankIds, startDate);

    // 2. Fetch all posted cash book vouchers in period
    const vouchersInPeriod = db
      .prepare(`
        SELECT *
        FROM cash_book_vouchers
        WHERE status = 'posted'
          AND DATE(voucher_date) >= DATE(?)
          AND DATE(voucher_date) <= DATE(?)
        ORDER BY DATE(voucher_date) ASC, sequence_number ASC, id ASC
      `)
      .all(startDate, endDate) as Array<Record<string, any>>;

    let totalCashReceived = 0;
    let totalCashPaid = 0;
    let totalBankDeposits = 0;
    let totalBankWithdrawals = 0;
    let totalBankPayments = 0;
    let totalBankReceipts = 0;
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalOwnerCapital = 0;
    let totalOwnerDrawings = 0;

    for (const v of vouchersInPeriod) {
      const recAmt = Number(v.receipt_amount || 0);
      const payAmt = Number(v.payment_amount || 0);
      const isCash = cashIds.includes(Number(v.cash_bank_account_id));
      const isBank = bankIds.includes(Number(v.cash_bank_account_id));

      if (v.transaction_type === 'Contra') {
        if (v.category === 'cash_deposit_bank') {
          totalCashPaid = round2(totalCashPaid + payAmt);
          totalBankDeposits = round2(totalBankDeposits + payAmt);
        } else if (v.category === 'cash_withdrawal_bank') {
          totalCashReceived = round2(totalCashReceived + recAmt);
          totalBankWithdrawals = round2(totalBankWithdrawals + recAmt);
        } else if (v.category === 'bank_transfer') {
          // Internal bank-to-bank
          totalBankDeposits = round2(totalBankDeposits + recAmt);
          totalBankPayments = round2(totalBankPayments + payAmt);
        }
      } else {
        if (isCash) {
          totalCashReceived = round2(totalCashReceived + recAmt);
          totalCashPaid = round2(totalCashPaid + payAmt);
        } else if (isBank) {
          totalBankReceipts = round2(totalBankReceipts + recAmt);
          totalBankPayments = round2(totalBankPayments + payAmt);
        }

        if (v.transaction_type === 'Receipt' || v.category === 'customer_receipt' || v.category === 'other_receipt') {
          totalIncome = round2(totalIncome + recAmt);
        }
        if (v.transaction_type === 'Expense' || v.category === 'shop_expense') {
          totalExpenses = round2(totalExpenses + payAmt);
        }
        if (v.category === 'capital_introduced') {
          totalOwnerCapital = round2(totalOwnerCapital + recAmt);
        }
        if (v.category === 'drawings') {
          totalOwnerDrawings = round2(totalOwnerDrawings + payAmt);
        }
      }
    }

    // Formulas:
    // Closing Balance = Opening Balance + Receipts - Payments
    const closingCashBalance = round2(openingCashBalance + totalCashReceived - totalCashPaid);
    const closingBankBalance = round2(
      openingBankBalance + totalBankDeposits + totalBankReceipts - (totalBankWithdrawals + totalBankPayments)
    );

    // 3. Daily chronological breakdown:
    // Formula: Next day's opening balance must automatically equal previous day's closing balance.
    const uniqueDates = Array.from(new Set(vouchersInPeriod.map((v) => String(v.voucher_date)))).sort();

    // If no transactions in date range, include at least the selected range
    if (uniqueDates.length === 0) {
      uniqueDates.push(startDate);
    }

    let runningDayCashOpen = openingCashBalance;
    let runningDayBankOpen = openingBankBalance;
    const dailyRegister: Array<{
      date: string;
      openingCash: number;
      cashIn: number;
      cashOut: number;
      closingCash: number;
      openingBank: number;
      bankIn: number;
      bankOut: number;
      closingBank: number;
      voucherCount: number;
    }> = [];

    for (const d of uniqueDates) {
      const dayVouchers = vouchersInPeriod.filter((v) => String(v.voucher_date) === d);
      let dayCashIn = 0;
      let dayCashOut = 0;
      let dayBankIn = 0;
      let dayBankOut = 0;

      for (const v of dayVouchers) {
        const rec = Number(v.receipt_amount || 0);
        const pay = Number(v.payment_amount || 0);
        const isCash = cashIds.includes(Number(v.cash_bank_account_id));
        const isBank = bankIds.includes(Number(v.cash_bank_account_id));

        if (v.transaction_type === 'Contra') {
          if (v.category === 'cash_deposit_bank') {
            dayCashOut = round2(dayCashOut + pay);
            dayBankIn = round2(dayBankIn + pay);
          } else if (v.category === 'cash_withdrawal_bank') {
            dayCashIn = round2(dayCashIn + rec);
            dayBankOut = round2(dayBankOut + rec);
          } else if (v.category === 'bank_transfer') {
            dayBankIn = round2(dayBankIn + rec);
            dayBankOut = round2(dayBankOut + pay);
          }
        } else {
          if (isCash) {
            dayCashIn = round2(dayCashIn + rec);
            dayCashOut = round2(dayCashOut + pay);
          } else if (isBank) {
            dayBankIn = round2(dayBankIn + rec);
            dayBankOut = round2(dayBankOut + pay);
          }
        }
      }

      const dayCashClose = round2(runningDayCashOpen + dayCashIn - dayCashOut);
      const dayBankClose = round2(runningDayBankOpen + dayBankIn - dayBankOut);

      dailyRegister.push({
        date: d,
        openingCash: runningDayCashOpen,
        cashIn: dayCashIn,
        cashOut: dayCashOut,
        closingCash: dayCashClose,
        openingBank: runningDayBankOpen,
        bankIn: dayBankIn,
        bankOut: dayBankOut,
        closingBank: dayBankClose,
        voucherCount: dayVouchers.length,
      });

      // Next day's opening automatically equals this day's closing
      runningDayCashOpen = dayCashClose;
      runningDayBankOpen = dayBankClose;
    }

    return res.json({
      success: true,
      startDate,
      endDate,
      openingCashBalance,
      totalCashReceived,
      totalCashPaid,
      closingCashBalance,
      openingBankBalance,
      totalBankDeposits,
      totalBankWithdrawals,
      totalBankPayments,
      totalBankReceipts,
      closingBankBalance,
      totalIncome,
      totalExpenses,
      totalOwnerCapital,
      totalOwnerDrawings,
      dailyRegister,
      totalVouchersCount: vouchersInPeriod.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/vouchers
 * List Cash Book Vouchers with search and filtering
 */
cashBookRouter.get('/vouchers', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureCashBookSchema();
    const db = getDatabase();
    const {
      q,
      startDate,
      endDate,
      transactionType,
      category,
      accountId,
      page = 1,
      pageSize = 30,
    } = req.query;

    let sql = `
      SELECT cb.*,
             ha.account_code as head_code, ha.account_name as head_name, ha.account_group as head_group,
             ca.account_code as cb_code, ca.account_name as cb_name, ca.account_group as cb_group
      FROM cash_book_vouchers cb
      LEFT JOIN accounts ha ON ha.id = cb.head_account_id
      LEFT JOIN accounts ca ON ca.id = cb.cash_bank_account_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      sql += ` AND (cb.voucher_number LIKE ? OR cb.narration LIKE ? OR ha.account_name LIKE ? OR ca.account_name LIKE ? OR cb.reference_number LIKE ?)`;
      params.push(term, term, term, term, term);
    }

    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      sql += ` AND DATE(cb.voucher_date) >= DATE(?)`;
      params.push(startDate.trim());
    }

    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      sql += ` AND DATE(cb.voucher_date) <= DATE(?)`;
      params.push(endDate.trim());
    }

    if (transactionType && typeof transactionType === 'string' && transactionType !== 'all') {
      sql += ` AND cb.transaction_type = ?`;
      params.push(transactionType);
    }

    if (category && typeof category === 'string' && category !== 'all') {
      sql += ` AND cb.category = ?`;
      params.push(category);
    }

    if (accountId && typeof accountId === 'string' && accountId !== 'all') {
      sql += ` AND (cb.head_account_id = ? OR cb.cash_bank_account_id = ?)`;
      params.push(Number(accountId), Number(accountId));
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const countRow = db.prepare(countSql).get(...params) as { total: number };
    const totalCount = countRow?.total || 0;

    sql += ` ORDER BY cb.sequence_number DESC, cb.id DESC LIMIT ? OFFSET ?`;
    const offset = (Math.max(1, Number(page)) - 1) * Number(pageSize);
    params.push(Number(pageSize), offset);

    const rows = db.prepare(sql).all(...params);

    return res.json({
      success: true,
      data: rows,
      totalCount,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/vouchers/:id
 * Retrieve a single Cash Book voucher with its journal entries
 */
cashBookRouter.get('/vouchers/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    const voucher = db
      .prepare(`
        SELECT cb.*,
               ha.account_code as head_code, ha.account_name as head_name, ha.account_group as head_group, ha.current_balance as head_balance,
               ca.account_code as cb_code, ca.account_name as cb_name, ca.account_group as cb_group, ca.current_balance as cb_balance
        FROM cash_book_vouchers cb
        LEFT JOIN accounts ha ON ha.id = cb.head_account_id
        LEFT JOIN accounts ca ON ca.id = cb.cash_bank_account_id
        WHERE cb.id = ?
      `)
      .get(id) as Record<string, any> | undefined;

    if (!voucher) {
      return res.status(404).json({ success: false, error: 'Cash Book Voucher not found.' });
    }

    let journalLines: any[] = [];
    if (voucher.journal_entry_id) {
      journalLines = db
        .prepare(`
          SELECT jl.*, a.account_code, a.account_name
          FROM journal_entry_lines jl
          LEFT JOIN accounts a ON a.id = jl.account_id
          WHERE jl.journal_entry_id = ?
          ORDER BY jl.id ASC
        `)
        .all(voucher.journal_entry_id);
    }

    return res.json({
      success: true,
      voucher,
      journalLines,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/cash-book/vouchers
 * Create a new Cash Book Voucher with complete Double-Entry Journal Posting
 */
cashBookRouter.post('/vouchers', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      voucher_date,
      transaction_type,
      category,
      head_account_id,
      cash_bank_account_id,
      receipt_amount = 0,
      payment_amount = 0,
      narration = '',
      reference_number = '',
      created_by = (req as any).user?.username || 'Super Admin',
    } = req.body || {};

    const cleanDate = String(voucher_date || new Date().toISOString().slice(0, 10)).trim();
    assertPeriodOpen(cleanDate, 'create a cash book voucher');
    const cleanType = String(transaction_type || 'Receipt');
    const recAmt = round2(Math.max(0, Number(receipt_amount || 0)));
    const payAmt = round2(Math.max(0, Number(payment_amount || 0)));
    const netAmt = recAmt > 0 ? recAmt : payAmt;

    if (netAmt <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid Receipt Amount or Payment Amount greater than 0.',
      });
    }

    const headAccId = Number(head_account_id);
    const cbAccId = Number(cash_bank_account_id);

    if (!headAccId || !cbAccId) {
      return res.status(400).json({
        success: false,
        error: 'Please select both an Account Name and a Cash / Bank Account.',
      });
    }

    if (headAccId === cbAccId) {
      return res.status(400).json({
        success: false,
        error: 'Account Name and Cash/Bank Account cannot be the same account.',
      });
    }

    const headAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(headAccId) as Record<string, any>;
    const cbAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(cbAccId) as Record<string, any>;

    if (!headAcc) {
      return res.status(404).json({ success: false, error: 'Selected Account not found.' });
    }
    if (!cbAcc) {
      return res.status(404).json({ success: false, error: 'Selected Cash / Bank Account not found.' });
    }

    // Auto compute next continuous sequence and voucher number
    const { nextSequence, nextVoucherNumber } = getNextContinuousVoucherNumber();

    const result = db.transaction(() => {
      // 1. Determine double-entry accounts and amounts
      // Double Entry Rule:
      // When receiving money:
      //   Cash / Bank Account is DEBITED
      //   Head Account (Customer / Income / Capital / Source Bank) is CREDITED
      // When paying money:
      //   Head Account (Supplier / Expense / Drawings / Dest Bank) is DEBITED
      //   Cash / Bank Account is CREDITED
      let debitAccountId: number;
      let debitAccountCode: string;
      let debitAccountName: string;
      let debitLedgerType: 'general' | 'customer' | 'supplier' = 'general';

      let creditAccountId: number;
      let creditAccountCode: string;
      let creditAccountName: string;
      let creditLedgerType: 'general' | 'customer' | 'supplier' = 'general';

      let autoNarration = narration.trim();

      if (recAmt > 0) {
        // RECEIPT: Cash/Bank is Debit, Head is Credit
        debitAccountId = cbAcc.id;
        debitAccountCode = cbAcc.account_code;
        debitAccountName = cbAcc.account_name;

        creditAccountId = headAcc.id;
        creditAccountCode = headAcc.account_code;
        creditAccountName = headAcc.account_name;
        if (headAcc.account_group === 'Customer') creditLedgerType = 'customer';
        if (headAcc.account_group === 'Supplier') creditLedgerType = 'supplier';

        if (!autoNarration) {
          autoNarration = `Cash Book Voucher #${nextVoucherNumber} Receipt from ${headAcc.account_name}`;
        }
      } else {
        // PAYMENT: Head is Debit, Cash/Bank is Credit
        debitAccountId = headAcc.id;
        debitAccountCode = headAcc.account_code;
        debitAccountName = headAcc.account_name;
        if (headAcc.account_group === 'Customer') debitLedgerType = 'customer';
        if (headAcc.account_group === 'Supplier') debitLedgerType = 'supplier';

        creditAccountId = cbAcc.id;
        creditAccountCode = cbAcc.account_code;
        creditAccountName = cbAcc.account_name;

        if (!autoNarration) {
          autoNarration = `Cash Book Voucher #${nextVoucherNumber} Payment to ${headAcc.account_name}`;
        }
      }

      // 2. Post Journal Entry
      const jeNumber = `JE-CB-${nextVoucherNumber}`;
      const jeRes = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id, description,
            total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(jeNumber, cleanDate, 0, autoNarration, netAmt, netAmt);

      const jeId = Number(jeRes.lastInsertRowid);

      // Debit Line
      db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, 0.0, ?)
      `).run(jeId, debitAccountId, debitLedgerType, netAmt, autoNarration);

      // Credit Line
      db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, 0.0, ?, ?)
      `).run(jeId, creditAccountId, creditLedgerType, netAmt, autoNarration);

      // 3. Insert into cash_book_vouchers
      const cbInsertRes = db
        .prepare(`
          INSERT INTO cash_book_vouchers (
            voucher_number, sequence_number, voucher_date, transaction_type, category,
            head_account_id, head_account_code, head_account_name,
            cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
            receipt_amount, payment_amount, net_amount,
            narration, reference_number, journal_entry_id, status, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)
        `)
        .run(
          nextVoucherNumber,
          nextSequence,
          cleanDate,
          cleanType,
          category || (recAmt > 0 ? 'customer_receipt' : 'shop_expense'),
          headAcc.id,
          headAcc.account_code,
          headAcc.account_name,
          cbAcc.id,
          cbAcc.account_code,
          cbAcc.account_name,
          recAmt,
          payAmt,
          netAmt,
          autoNarration,
          reference_number || '',
          jeId,
          created_by
        );

      const cbVoucherId = Number(cbInsertRes.lastInsertRowid);

      // Link reference_id in journal_entries
      db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(cbVoucherId, jeId);

      // Advance sequence high-water mark so deleted voucher numbers are NEVER reused
      db.prepare(`
        UPDATE cash_book_sequences
        SET last_sequence = MAX(last_sequence, ?), updated_at = CURRENT_TIMESTAMP
        WHERE sequence_key = 'voucher_continuous'
      `).run(nextSequence);

      // 4. Recalculate touched accounts to guarantee live accurate balances
      recalculateAccountBalance(debitAccountId);
      recalculateAccountBalance(creditAccountId);

      return {
        id: cbVoucherId,
        voucher_number: nextVoucherNumber,
        sequence_number: nextSequence,
        journal_entry_id: jeId,
      };
    })();

    const createdRecord = db
      .prepare('SELECT * FROM cash_book_vouchers WHERE id = ?')
      .get(result.id);

    // Record persistent audit log
    recordCashBookAudit({
      voucher_id: result.id,
      voucher_number: result.voucher_number,
      action: 'CREATED',
      details: `Created Cash Book Voucher #${result.voucher_number} (${cleanType} - Net Rs. ${netAmt})`,
      new_values: createdRecord,
      performed_by: created_by,
      performed_by_role: (req as any).user?.role || 'Staff',
    });

    return res.json({
      success: true,
      message: `Voucher #${result.voucher_number} posted successfully. Double-entry balances updated.`,
      voucher: createdRecord,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/cash-book/vouchers/:id
 * Edit existing Cash Book Voucher (retains continuous voucher number and updates double entry)
 */
cashBookRouter.put('/vouchers/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    const existing = db
      .prepare('SELECT * FROM cash_book_vouchers WHERE id = ?')
      .get(id) as Record<string, any> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Voucher not found.' });
    }

    if (existing.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cancelled vouchers cannot be modified.',
      });
    }

    const {
      voucher_date,
      transaction_type,
      category,
      head_account_id,
      cash_bank_account_id,
      receipt_amount = 0,
      payment_amount = 0,
      narration = '',
      reference_number = '',
    } = req.body || {};

    const cleanDate = String(voucher_date || existing.voucher_date).trim();
    assertPeriodOpen(String(existing.voucher_date || ''), 'edit an existing cash book voucher');
    assertPeriodOpen(cleanDate, 'move a cash book voucher into a closed period');
    const cleanType = String(transaction_type || existing.transaction_type);
    const recAmt = round2(Math.max(0, Number(receipt_amount || 0)));
    const payAmt = round2(Math.max(0, Number(payment_amount || 0)));
    const netAmt = recAmt > 0 ? recAmt : payAmt;

    if (netAmt <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid Receipt Amount or Payment Amount greater than 0.',
      });
    }

    const headAccId = Number(head_account_id || existing.head_account_id);
    const cbAccId = Number(cash_bank_account_id || existing.cash_bank_account_id);

    if (headAccId === cbAccId) {
      return res.status(400).json({
        success: false,
        error: 'Account Name and Cash/Bank Account cannot be the same account.',
      });
    }

    const headAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(headAccId) as Record<string, any>;
    const cbAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(cbAccId) as Record<string, any>;

    if (!headAcc || !cbAcc) {
      return res.status(404).json({ success: false, error: 'Accounts not found.' });
    }

    db.transaction(() => {
      // 1. Collect previously touched accounts to recalculate after modification
      const touchedAccounts = new Set<number>([
        Number(existing.head_account_id),
        Number(existing.cash_bank_account_id),
        headAcc.id,
        cbAcc.id,
      ]);

      let debitAccountId: number;
      let debitLedgerType: 'general' | 'customer' | 'supplier' = 'general';
      let creditAccountId: number;
      let creditLedgerType: 'general' | 'customer' | 'supplier' = 'general';

      let autoNarration = narration.trim();

      if (recAmt > 0) {
        debitAccountId = cbAcc.id;
        creditAccountId = headAcc.id;
        if (headAcc.account_group === 'Customer') creditLedgerType = 'customer';
        if (headAcc.account_group === 'Supplier') creditLedgerType = 'supplier';
        if (!autoNarration) {
          autoNarration = `Cash Book Voucher #${existing.voucher_number} Receipt from ${headAcc.account_name}`;
        }
      } else {
        debitAccountId = headAcc.id;
        creditAccountId = cbAcc.id;
        if (headAcc.account_group === 'Customer') debitLedgerType = 'customer';
        if (headAcc.account_group === 'Supplier') debitLedgerType = 'supplier';
        if (!autoNarration) {
          autoNarration = `Cash Book Voucher #${existing.voucher_number} Payment to ${headAcc.account_name}`;
        }
      }

      // 2. Update journal entry
      const jeId = existing.journal_entry_id;
      if (jeId) {
        db.prepare(`
          UPDATE journal_entries
          SET entry_date = ?, description = ?, total_debit = ?, total_credit = ?
          WHERE id = ?
        `).run(cleanDate, autoNarration, netAmt, netAmt, jeId);

        // Delete previous lines
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jeId);

        // Insert new lines
        db.prepare(`
          INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
          ) VALUES (?, ?, ?, ?, 0.0, ?)
        `).run(jeId, debitAccountId, debitLedgerType, netAmt, autoNarration);

        db.prepare(`
          INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
          ) VALUES (?, ?, ?, 0.0, ?, ?)
        `).run(jeId, creditAccountId, creditLedgerType, netAmt, autoNarration);
      }

      // 3. Update cash_book_vouchers record (retaining voucher_number & sequence_number)
      db.prepare(`
        UPDATE cash_book_vouchers
        SET voucher_date = ?,
            transaction_type = ?,
            category = ?,
            head_account_id = ?,
            head_account_code = ?,
            head_account_name = ?,
            cash_bank_account_id = ?,
            cash_bank_account_code = ?,
            cash_bank_account_name = ?,
            receipt_amount = ?,
            payment_amount = ?,
            net_amount = ?,
            narration = ?,
            reference_number = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        cleanDate,
        cleanType,
        category || existing.category,
        headAcc.id,
        headAcc.account_code,
        headAcc.account_name,
        cbAcc.id,
        cbAcc.account_code,
        cbAcc.account_name,
        recAmt,
        payAmt,
        netAmt,
        autoNarration,
        reference_number,
        id
      );

      // 4. Recalculate all affected accounts
      touchedAccounts.forEach((accId) => recalculateAccountBalance(accId));
    })();

    const updated = db.prepare('SELECT * FROM cash_book_vouchers WHERE id = ?').get(id);

    // Record audit log for edit
    recordCashBookAudit({
      voucher_id: id,
      voucher_number: existing.voucher_number,
      action: 'UPDATED',
      details: `Edited Voucher #${existing.voucher_number}: Amount changed from Rs. ${existing.net_amount} to Rs. ${netAmt}`,
      previous_values: existing,
      new_values: updated,
      performed_by: (req as any).user?.username || 'Super Admin',
      performed_by_role: (req as any).user?.role || 'Staff',
    });

    return res.json({
      success: true,
      message: `Voucher #${existing.voucher_number} successfully updated and reconciled.`,
      voucher: updated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/cash-book/vouchers/:id
 * Admin-only deletion and accounting reversal
 */
cashBookRouter.delete('/vouchers/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    // 1. Admin permission check
    const user = (req as any).user;
    const userRole = user?.role || '';
    const isAdmin = userRole === 'Super Admin' || userRole === 'Administrator';
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only Administrator or Super Admin can delete or reverse vouchers.',
      });
    }

    const existing = db
      .prepare('SELECT * FROM cash_book_vouchers WHERE id = ?')
      .get(id) as Record<string, any> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Voucher not found.' });
    }

    assertPeriodOpen(String(existing.voucher_date || ''), 'delete or cancel a cash book voucher');

    const hardDelete = req.query.soft !== 'true';

    db.transaction(() => {
      // 1. Reverse / remove journal entries
      if (existing.journal_entry_id) {
        // Delete journal entry lines so balances are reversed
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(
          existing.journal_entry_id
        );
        db.prepare("UPDATE journal_entries SET status = 'voided', description = description || ' [DELETED BY ADMIN]' WHERE id = ?").run(
          existing.journal_entry_id
        );
      }

      // 2. Either delete or mark cancelled
      if (hardDelete) {
        db.prepare('DELETE FROM cash_book_vouchers WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE cash_book_vouchers SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
          id
        );
      }

      // 3. Recalculate touched accounts to guarantee live accurate balances
      recalculateAccountBalance(Number(existing.head_account_id));
      recalculateAccountBalance(Number(existing.cash_bank_account_id));

      // 4. Record permanent immutable audit history
      recordCashBookAudit({
        voucher_id: id,
        voucher_number: existing.voucher_number,
        action: 'DELETED',
        details: `Admin ${user.username} (${userRole}) deleted Voucher #${existing.voucher_number} (Rs. ${existing.net_amount}) and reversed all double-entry ledger entries.`,
        previous_values: existing,
        performed_by: user.username,
        performed_by_role: userRole,
      });
    })();

    return res.json({
      success: true,
      message: `Voucher #${existing.voucher_number} deleted and double-entry accounting reversed successfully.`,
      deletedVoucherNumber: existing.voucher_number,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/audit-history
 * View audit history log of Cash Book vouchers
 */
cashBookRouter.get('/audit-history', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureCashBookSchema();
    const db = getDatabase();
    const { voucherNumber, limit = 50 } = req.query;

    let sql = 'SELECT * FROM cash_book_audit_history WHERE 1=1';
    const params: any[] = [];

    if (voucherNumber && typeof voucherNumber === 'string' && voucherNumber.trim()) {
      sql += ' AND voucher_number = ?';
      params.push(voucherNumber.trim());
    }

    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Number(limit));

    const records = db.prepare(sql).all(...params);
    return res.json({ success: true, data: records });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/cash-book/reports/breakdown
 * Detailed breakdown reports:
 * - Who paid us?
 * - Whom did we pay?
 * - Where did money come from?
 * - Where was money spent?
 * - Bank deposits & withdrawals
 * - Cash and Bank balances
 */
cashBookRouter.get('/reports/breakdown', authenticateToken, (req: Request, res: Response) => {
  try {
    ensureCashBookSchema();
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const startDate = String(req.query.startDate || today).trim();
    const endDate = String(req.query.endDate || today).trim();

    // 1. Who paid us? (Customer receipts and income)
    const whoPaidUs = db
      .prepare(`
        SELECT cb.id, cb.voucher_number, cb.voucher_date, cb.receipt_amount as amount,
               cb.head_account_name as payer_name, cb.head_account_code as payer_code,
               ha.account_group, ha.phone, cb.cash_bank_account_name as payment_account,
               cb.narration, cb.reference_number
        FROM cash_book_vouchers cb
        LEFT JOIN accounts ha ON ha.id = cb.head_account_id
        WHERE cb.status = 'posted'
          AND cb.receipt_amount > 0
          AND cb.transaction_type != 'Contra'
          AND DATE(cb.voucher_date) >= DATE(?)
          AND DATE(cb.voucher_date) <= DATE(?)
        ORDER BY cb.sequence_number DESC
      `)
      .all(startDate, endDate);

    // 2. Whom did we pay? (Supplier payments and expenses)
    const whomDidWePay = db
      .prepare(`
        SELECT cb.id, cb.voucher_number, cb.voucher_date, cb.payment_amount as amount,
               cb.head_account_name as payee_name, cb.head_account_code as payee_code,
               ha.account_group, cb.cash_bank_account_name as payment_account,
               cb.category, cb.narration, cb.reference_number
        FROM cash_book_vouchers cb
        LEFT JOIN accounts ha ON ha.id = cb.head_account_id
        WHERE cb.status = 'posted'
          AND cb.payment_amount > 0
          AND cb.transaction_type != 'Contra'
          AND DATE(cb.voucher_date) >= DATE(?)
          AND DATE(cb.voucher_date) <= DATE(?)
        ORDER BY cb.sequence_number DESC
      `)
      .all(startDate, endDate);

    // 3. Where did money come from? (Inflows by category)
    const moneyFromCategories = db
      .prepare(`
        SELECT
          CASE
            WHEN cb.category = 'customer_receipt' THEN 'Customer Receipts'
            WHEN cb.category = 'capital_introduced' THEN 'Owner Capital Introduced'
            WHEN cb.category = 'cash_withdrawal_bank' THEN 'Bank Withdrawal into Cash'
            ELSE 'Other Income & Inflows'
          END as category_label,
          COUNT(*) as voucher_count,
          SUM(cb.receipt_amount) as total_amount
        FROM cash_book_vouchers cb
        WHERE cb.status = 'posted'
          AND cb.receipt_amount > 0
          AND DATE(cb.voucher_date) >= DATE(?)
          AND DATE(cb.voucher_date) <= DATE(?)
        GROUP BY category_label
        ORDER BY total_amount DESC
      `)
      .all(startDate, endDate);

    // 4. Where was money spent? (Outflows by category)
    const moneySpentCategories = db
      .prepare(`
        SELECT
          CASE
            WHEN cb.category = 'supplier_payment' THEN 'Supplier Payments'
            WHEN cb.category = 'shop_expense' THEN 'Shop Expenses'
            WHEN cb.category = 'drawings' THEN 'Owner Drawings'
            WHEN cb.category = 'cash_deposit_bank' THEN 'Cash Deposit into Bank'
            ELSE 'Other Payments'
          END as category_label,
          COUNT(*) as voucher_count,
          SUM(cb.payment_amount) as total_amount
        FROM cash_book_vouchers cb
        WHERE cb.status = 'posted'
          AND cb.payment_amount > 0
          AND DATE(cb.voucher_date) >= DATE(?)
          AND DATE(cb.voucher_date) <= DATE(?)
        GROUP BY category_label
        ORDER BY total_amount DESC
      `)
      .all(startDate, endDate);

    // 5. Bank Contra Transfers (Deposits and Withdrawals)
    const bankContra = db
      .prepare(`
        SELECT cb.*,
               ha.account_name as bank_or_dest_name,
               ca.account_name as source_account_name
        FROM cash_book_vouchers cb
        LEFT JOIN accounts ha ON ha.id = cb.head_account_id
        LEFT JOIN accounts ca ON ca.id = cb.cash_bank_account_id
        WHERE cb.status = 'posted'
          AND cb.transaction_type = 'Contra'
          AND DATE(cb.voucher_date) >= DATE(?)
          AND DATE(cb.voucher_date) <= DATE(?)
        ORDER BY cb.sequence_number DESC
      `)
      .all(startDate, endDate);

    // 6. Current Cash and Bank Balances
    const cashAndBankAccounts = db
      .prepare(`
        SELECT id, account_code, account_name, account_group,
               opening_balance, opening_balance_type,
               total_debit, total_credit, current_balance, current_balance_type
        FROM accounts
        WHERE account_group IN ('Cash in Hand', 'Bank')
        ORDER BY account_group DESC, account_code ASC
      `)
      .all();

    return res.json({
      success: true,
      startDate,
      endDate,
      whoPaidUs,
      whomDidWePay,
      moneyFromCategories,
      moneySpentCategories,
      bankContra,
      cashAndBankAccounts,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
});
