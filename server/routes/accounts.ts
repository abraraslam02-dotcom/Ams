import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import {
  peekNextAccountCode,
  allocateNextAccountCode,
  recordAccountCodeDeletion,
} from '../utils/accountCodeGenerator.ts';

export const accountsRouter = Router();

export const MAIN_ACCOUNT_GROUPS = [
  'PARTY ACCOUNTS',
  'FINANCIAL ACCOUNTS',
  'INCOME & EXPENSE ACCOUNTS',
] as const;

export const STANDARD_ACCOUNT_GROUPS: Record<string, string[]> = {
  'PARTY ACCOUNTS': ['Customer', 'Supplier', 'Customer & Supplier'],
  'FINANCIAL ACCOUNTS': [
    'Cash in Hand',
    'Bank',
    'Capital',
    'Drawings',
    'Loans',
    'Assets',
    'Liabilities',
  ],
  'INCOME & EXPENSE ACCOUNTS': [
    'Sales Income',
    'Purchase Discount',
    'Other Income',
    'Purchases',
    'Purchase Returns',
    'Rent',
    'Electricity',
    'Salaries',
    'Shop Expenses',
    'Other Expenses',
  ],
};

export interface AccountRow {
  id: number;
  account_code: string;
  account_name: string;
  main_group: 'PARTY ACCOUNTS' | 'FINANCIAL ACCOUNTS' | 'INCOME & EXPENSE ACCOUNTS';
  account_group: string;
  parent_account_id: number | null;
  parent_account_name?: string | null;
  parent_account_code?: string | null;
  opening_balance: number;
  opening_balance_type: 'Debit' | 'Credit';
  total_debit: number;
  total_credit: number;
  current_balance: number;
  current_balance_type: 'Debit' | 'Credit';
  customer_debit: number;
  customer_credit: number;
  supplier_debit: number;
  supplier_credit: number;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  ntn_cnic: string | null;
  ntn: string | null;
  strn: string | null;
  filer_status: 'Filer' | 'Non-Filer' | 'Exempt';
  tax_registration_details: string | null;
  address: string | null;
  city: string | null;
  town_id?: number | null;
  town_name?: string | null;
  area_id?: number | null;
  area_name?: string | null;
  assigned_salesman_id?: number | null;
  assigned_salesman_name?: string | null;
  credit_limit: number;
  is_system_account: number;
  status: 'Active' | 'Inactive';
  notes: string | null;
  sub_accounts_count?: number;
  linked_transactions_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to recalculate an account's accurate Debit, Credit, Net Balance,
 * and separate Customer vs. Supplier ledger balances from Opening Balance + Journal Lines.
 */
export function recalculateAccountBalance(accountId: number): void {
  const db = getDatabase();
  const acc = db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(accountId) as AccountRow | undefined;

  if (!acc) return;

  const openBal = Math.round((Number(acc.opening_balance) || 0) * 100) / 100;
  const openType = acc.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';

  const openDebit = openType === 'Debit' ? openBal : 0;
  const openCredit = openType === 'Credit' ? openBal : 0;

  // Sum posted journal entry lines for this account
  const lineSums = db
    .prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount), 0) as tx_debit,
        COALESCE(SUM(jl.credit_amount), 0) as tx_credit,
        COALESCE(SUM(CASE WHEN jl.ledger_type = 'customer' THEN jl.debit_amount ELSE 0 END), 0) as cust_tx_debit,
        COALESCE(SUM(CASE WHEN jl.ledger_type = 'customer' THEN jl.credit_amount ELSE 0 END), 0) as cust_tx_credit,
        COALESCE(SUM(CASE WHEN jl.ledger_type = 'supplier' THEN jl.debit_amount ELSE 0 END), 0) as sup_tx_debit,
        COALESCE(SUM(CASE WHEN jl.ledger_type = 'supplier' THEN jl.credit_amount ELSE 0 END), 0) as sup_tx_credit
      FROM journal_entry_lines jl
      INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = ? AND je.status = 'posted' AND je.reference_type != 'OPENING_BALANCE'
    `)
    .get(accountId) as {
    tx_debit: number;
    tx_credit: number;
    cust_tx_debit: number;
    cust_tx_credit: number;
    sup_tx_debit: number;
    sup_tx_credit: number;
  };

  const totalDebit = Math.round((openDebit + (lineSums.tx_debit || 0)) * 100) / 100;
  const totalCredit = Math.round((openCredit + (lineSums.tx_credit || 0)) * 100) / 100;

  const netDiff = Math.round((totalDebit - totalCredit) * 100) / 100;
  const currentBalance = Math.abs(netDiff);
  const currentBalanceType: 'Debit' | 'Credit' =
    netDiff > 0 ? 'Debit' : netDiff < 0 ? 'Credit' : openType;

  // Separate Customer and Supplier sub-ledger tracking
  let customerDebit = lineSums.cust_tx_debit || 0;
  let customerCredit = lineSums.cust_tx_credit || 0;
  let supplierDebit = lineSums.sup_tx_debit || 0;
  let supplierCredit = lineSums.sup_tx_credit || 0;

  if (acc.account_group === 'Customer') {
    customerDebit = Math.round((customerDebit + openDebit) * 100) / 100;
    customerCredit = Math.round((customerCredit + openCredit) * 100) / 100;
  } else if (acc.account_group === 'Supplier') {
    supplierDebit = Math.round((supplierDebit + openDebit) * 100) / 100;
    supplierCredit = Math.round((supplierCredit + openCredit) * 100) / 100;
  } else if (acc.account_group === 'Customer & Supplier') {
    // For dual Customer & Supplier accounts, Debit opening attaches to Customer receivable side, Credit opening to Supplier payable side
    if (openType === 'Debit') {
      customerDebit = Math.round((customerDebit + openDebit) * 100) / 100;
    } else {
      supplierCredit = Math.round((supplierCredit + openCredit) * 100) / 100;
    }
  }

  db.prepare(`
    UPDATE accounts SET
      total_debit = ?,
      total_credit = ?,
      current_balance = ?,
      current_balance_type = ?,
      customer_debit = ?,
      customer_credit = ?,
      supplier_debit = ?,
      supplier_credit = ?
    WHERE id = ?
  `).run(
    totalDebit,
    totalCredit,
    currentBalance,
    currentBalanceType,
    customerDebit,
    customerCredit,
    supplierDebit,
    supplierCredit,
    accountId
  );
}

/**
 * Helper to count linked financial transactions for an account to protect against unsafe deletion
 */
function getLinkedTransactionCount(accountId: number): {
  total: number;
  sales: number;
  saleReturns: number;
  purchases: number;
  purchaseReturns: number;
  journalLines: number;
  subAccounts: number;
} {
  const db = getDatabase();
  const sales = (
    db.prepare('SELECT COUNT(*) as c FROM sales WHERE customer_account_id = ?').get(accountId) as { c: number }
  ).c;
  const saleReturns = (
    db.prepare('SELECT COUNT(*) as c FROM sale_returns WHERE customer_account_id = ?').get(accountId) as { c: number }
  ).c;
  const purchases = (
    db.prepare('SELECT COUNT(*) as c FROM purchases WHERE supplier_account_id = ?').get(accountId) as { c: number }
  ).c;
  const purchaseReturns = (
    db.prepare('SELECT COUNT(*) as c FROM purchase_returns WHERE supplier_account_id = ?').get(accountId) as { c: number }
  ).c;
  const journalLines = (
    db.prepare('SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?').get(accountId) as { c: number }
  ).c;
  const subAccounts = (
    db.prepare('SELECT COUNT(*) as c FROM accounts WHERE parent_account_id = ?').get(accountId) as { c: number }
  ).c;

  return {
    total: sales + saleReturns + purchases + purchaseReturns + journalLines,
    sales,
    saleReturns,
    purchases,
    purchaseReturns,
    journalLines,
    subAccounts,
  };
}

/**
 * GET /api/accounts/groups
 * Returns standard and user-defined account groups organized by the 3 main groups
 */
accountsRouter.get('/groups', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const customRows = db
      .prepare('SELECT DISTINCT main_group, account_group FROM accounts ORDER BY main_group, account_group')
      .all() as Array<{ main_group: string; account_group: string }>;

    const mergedGroups: Record<string, string[]> = {
      'PARTY ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['PARTY ACCOUNTS']],
      'FINANCIAL ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['FINANCIAL ACCOUNTS']],
      'INCOME & EXPENSE ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['INCOME & EXPENSE ACCOUNTS']],
    };

    for (const row of customRows) {
      if (mergedGroups[row.main_group] && !mergedGroups[row.main_group].includes(row.account_group)) {
        mergedGroups[row.main_group].push(row.account_group);
      }
    }

    return res.json({
      success: true,
      mainGroups: MAIN_ACCOUNT_GROUPS,
      groupsByMain: mergedGroups,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/accounts/next-code
 * Universal automatic account code generator preview endpoint.
 * Returns the next sequential code for the specified account type/group (e.g. Cus-024, Sup-038, Exp-001).
 */
accountsRouter.get('/next-code', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const accountGroup = String(req.query.account_group || req.query.account_type || 'Customer');
    const mainGroup = req.query.main_group ? String(req.query.main_group) : undefined;

    const result = peekNextAccountCode(db, accountGroup, mainGroup);
    return res.json({
      success: true,
      prefix: result.prefix,
      next_code: result.nextCode,
      next_number: result.nextNumber,
      account_type: result.accountType,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/accounts/check-code/:code
 * Real-time duplicate Account Code check
 */
accountsRouter.get('/check-code/:code', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { code } = req.params;
    const { excludeId } = req.query;

    let sql = 'SELECT id, account_code, account_name FROM accounts WHERE UPPER(TRIM(account_code)) = UPPER(TRIM(?))';
    const params: unknown[] = [code];

    if (excludeId) {
      sql += ' AND id != ?';
      params.push(parseInt(String(excludeId), 10));
    }

    const existing = db.prepare(sql).get(...params) as
      | { id: number; account_code: string; account_name: string }
      | undefined;

    return res.json({
      exists: Boolean(existing),
      account: existing || null,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/accounts
 * Fast search, category filtering, ledger view filtering, and hierarchical lookup
 */
accountsRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      q,
      mainGroup,
      accountGroup,
      parentAccountId,
      status,
      ledgerView, // 'all' | 'customer' | 'supplier'
      townId,
      town,
      areaId,
      area,
      sortBy = 'account_code',
      sortOrder = 'asc',
    } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim().length > 0) {
      const term = `%${q.trim()}%`;
      conditions.push(
        '(a.account_code LIKE ? OR a.account_name LIKE ? OR a.account_group LIKE ? OR a.contact_person LIKE ? OR a.phone LIKE ? OR a.address LIKE ? OR a.ntn_cnic LIKE ? OR a.town_name LIKE ? OR a.area_name LIKE ?)'
      );
      params.push(term, term, term, term, term, term, term, term, term);
    }

    if (townId && typeof townId === 'string' && townId !== 'all') {
      conditions.push('a.town_id = ?');
      params.push(parseInt(townId, 10));
    } else if (town && typeof town === 'string' && town !== 'all' && town.trim().length > 0) {
      conditions.push('(LOWER(a.town_name) = LOWER(?) OR LOWER(a.city) = LOWER(?))');
      params.push(town.trim(), town.trim());
    }

    if (areaId && typeof areaId === 'string' && areaId !== 'all') {
      conditions.push('a.area_id = ?');
      params.push(parseInt(areaId, 10));
    } else if (area && typeof area === 'string' && area !== 'all' && area.trim().length > 0) {
      conditions.push('LOWER(a.area_name) = LOWER(?)');
      params.push(area.trim());
    }

    if (mainGroup && typeof mainGroup === 'string' && mainGroup !== 'all') {
      conditions.push('a.main_group = ?');
      params.push(mainGroup);
    }

    if (accountGroup && typeof accountGroup === 'string' && accountGroup !== 'all') {
      conditions.push('a.account_group = ?');
      params.push(accountGroup);
    }

    if (parentAccountId && typeof parentAccountId === 'string' && parentAccountId !== 'all') {
      if (parentAccountId === 'root') {
        conditions.push('a.parent_account_id IS NULL');
      } else {
        conditions.push('a.parent_account_id = ?');
        params.push(parseInt(parentAccountId, 10));
      }
    }

    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push('a.status = ?');
      params.push(status);
    }

    // Separate Customer Ledger vs Supplier Ledger filter (includes 'Customer & Supplier' in both!)
    if (ledgerView === 'customer') {
      conditions.push("a.account_group IN ('Customer', 'Customer & Supplier')");
    } else if (ledgerView === 'supplier') {
      conditions.push("a.account_group IN ('Supplier', 'Customer & Supplier')");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSortColumns: Record<string, string> = {
      account_code: 'a.account_code',
      account_name: 'a.account_name',
      main_group: 'a.main_group',
      account_group: 'a.account_group',
      opening_balance: 'a.opening_balance',
      current_balance: 'a.current_balance',
      status: 'a.status',
      created_at: 'a.created_at',
    };

    const sortCol = allowedSortColumns[String(sortBy)] || 'a.account_code';
    const sortDir = String(sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const sql = `
      SELECT
        a.*,
        p.account_name as parent_account_name,
        p.account_code as parent_account_code,
        (SELECT COUNT(*) FROM accounts sub WHERE sub.parent_account_id = a.id) as sub_accounts_count,
        (
          (SELECT COUNT(*) FROM sales s WHERE s.customer_account_id = a.id) +
          (SELECT COUNT(*) FROM sale_returns sr WHERE sr.customer_account_id = a.id) +
          (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_account_id = a.id) +
          (SELECT COUNT(*) FROM purchase_returns pr WHERE pr.supplier_account_id = a.id) +
          (SELECT COUNT(*) FROM journal_entry_lines jl WHERE jl.account_id = a.id)
        ) as linked_transactions_count
      FROM accounts a
      LEFT JOIN accounts p ON p.id = a.parent_account_id
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
    `;

    const accounts = db.prepare(sql).all(...params) as AccountRow[];

    // Summary statistics across all accounts in database
    const statsRow = db
      .prepare(`
        SELECT
          COUNT(*) as total_accounts,
          SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_accounts,
          SUM(CASE WHEN main_group = 'PARTY ACCOUNTS' THEN 1 ELSE 0 END) as party_accounts_count,
          SUM(CASE WHEN main_group = 'FINANCIAL ACCOUNTS' THEN 1 ELSE 0 END) as financial_accounts_count,
          SUM(CASE WHEN main_group = 'INCOME & EXPENSE ACCOUNTS' THEN 1 ELSE 0 END) as income_expense_count,
          SUM(CASE WHEN account_group IN ('Customer', 'Customer & Supplier') THEN 1 ELSE 0 END) as customer_ledger_count,
          SUM(CASE WHEN account_group IN ('Supplier', 'Customer & Supplier') THEN 1 ELSE 0 END) as supplier_ledger_count,
          COALESCE(SUM(CASE WHEN opening_balance_type = 'Debit' THEN opening_balance ELSE 0 END), 0) as total_opening_debit,
          COALESCE(SUM(CASE WHEN opening_balance_type = 'Credit' THEN opening_balance ELSE 0 END), 0) as total_opening_credit,
          COALESCE(SUM(total_debit), 0) as grand_total_debit,
          COALESCE(SUM(total_credit), 0) as grand_total_credit,
          COALESCE(SUM(CASE WHEN account_group IN ('Customer', 'Customer & Supplier') AND current_balance_type = 'Debit' THEN current_balance ELSE 0 END), 0) as total_customer_receivables,
          COALESCE(SUM(CASE WHEN account_group IN ('Supplier', 'Customer & Supplier') AND current_balance_type = 'Credit' THEN current_balance ELSE 0 END), 0) as total_supplier_payables
        FROM accounts
      `)
      .get() as {
      total_accounts: number;
      active_accounts: number;
      party_accounts_count: number;
      financial_accounts_count: number;
      income_expense_count: number;
      customer_ledger_count: number;
      supplier_ledger_count: number;
      total_opening_debit: number;
      total_opening_credit: number;
      grand_total_debit: number;
      grand_total_credit: number;
      total_customer_receivables: number;
      total_supplier_payables: number;
    };

    // Get distinct account groups for filters
    const distinctGroups = (
      db
        .prepare("SELECT DISTINCT main_group, account_group FROM accounts WHERE account_group != '' ORDER BY main_group, account_group")
        .all() as Array<{ main_group: string; account_group: string }>
    );

    const groupsByMain: Record<string, string[]> = {
      'PARTY ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['PARTY ACCOUNTS']],
      'FINANCIAL ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['FINANCIAL ACCOUNTS']],
      'INCOME & EXPENSE ACCOUNTS': [...STANDARD_ACCOUNT_GROUPS['INCOME & EXPENSE ACCOUNTS']],
    };

    for (const g of distinctGroups) {
      if (groupsByMain[g.main_group] && !groupsByMain[g.main_group].includes(g.account_group)) {
        groupsByMain[g.main_group].push(g.account_group);
      }
    }

    // All accounts minimal list for parent account selector
    const parentCandidates = db
      .prepare('SELECT id, account_code, account_name, main_group, account_group FROM accounts ORDER BY account_code ASC')
      .all();

    const activeTowns = db
      .prepare('SELECT id, town_code, town_name, status FROM towns WHERE status = \'Active\' ORDER BY town_name ASC')
      .all();

    const activeAreas = db
      .prepare('SELECT id, area_code, area_name, town_id, town_name, status FROM town_areas WHERE status = \'Active\' ORDER BY town_name ASC, area_name ASC')
      .all();

    return res.json({
      success: true,
      accounts,
      count: accounts.length,
      stats: {
        totalAccounts: statsRow.total_accounts || 0,
        activeAccounts: statsRow.active_accounts || 0,
        partyAccountsCount: statsRow.party_accounts_count || 0,
        financialAccountsCount: statsRow.financial_accounts_count || 0,
        incomeExpenseCount: statsRow.income_expense_count || 0,
        customerLedgerCount: statsRow.customer_ledger_count || 0,
        supplierLedgerCount: statsRow.supplier_ledger_count || 0,
        totalOpeningDebit: Math.round((statsRow.total_opening_debit || 0) * 100) / 100,
        totalOpeningCredit: Math.round((statsRow.total_opening_credit || 0) * 100) / 100,
        grandTotalDebit: Math.round((statsRow.grand_total_debit || 0) * 100) / 100,
        grandTotalCredit: Math.round((statsRow.grand_total_credit || 0) * 100) / 100,
        totalCustomerReceivables: Math.round((statsRow.total_customer_receivables || 0) * 100) / 100,
        totalSupplierPayables: Math.round((statsRow.total_supplier_payables || 0) * 100) / 100,
      },
      filters: {
        mainGroups: MAIN_ACCOUNT_GROUPS,
        groupsByMain,
        parentCandidates,
        towns: activeTowns,
        areas: activeAreas,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to fetch accounts: ${errorMsg}` });
  }
});

/**
 * GET /api/accounts/:id/balance-summary
 * Returns live ledger balance (before posting current invoice) and last payment date/amount for Customer or Supplier
 */
accountsRouter.get('/:id/balance-summary', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const role = String(req.query.role || '').toLowerCase(); // 'customer' | 'supplier'
    const excludeSaleId = Number(req.query.excludeSaleId || 0);
    const excludePurchaseId = Number(req.query.excludePurchaseId || 0);

    recalculateAccountBalance(id);

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(id) as AccountRow | undefined;

    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    const isSupplierRole =
      role === 'supplier' || (role !== 'customer' && account.account_group === 'Supplier');

    const openBal = Math.round((Number(account.opening_balance) || 0) * 100) / 100;
    const openType = account.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
    const openDebit = openType === 'Debit' ? openBal : 0;
    const openCredit = openType === 'Credit' ? openBal : 0;

    // Sum posted journal entry lines, optionally excluding the current sale or purchase being edited so it is never counted twice
    let excludeClause = '';
    const params: Array<number | string> = [id];
    if (excludeSaleId > 0) {
      excludeClause += " AND NOT (je.reference_type = 'SALE' AND je.reference_id = ?) ";
      params.push(excludeSaleId);
    }
    if (excludePurchaseId > 0) {
      excludeClause += " AND NOT (je.reference_type = 'PURCHASE' AND je.reference_id = ?) ";
      params.push(excludePurchaseId);
    }

    const lineSums = db
      .prepare(`
        SELECT
          COALESCE(SUM(jl.debit_amount), 0) as tx_debit,
          COALESCE(SUM(jl.credit_amount), 0) as tx_credit
        FROM journal_entry_lines jl
        INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_id = ?
          AND je.status = 'posted'
          AND je.reference_type != 'OPENING_BALANCE'
          ${excludeClause}
      `)
      .get(...params) as { tx_debit: number; tx_credit: number };

    const totalDebit = Math.round((openDebit + Number(lineSums?.tx_debit || 0)) * 100) / 100;
    const totalCredit = Math.round((openCredit + Number(lineSums?.tx_credit || 0)) * 100) / 100;

    // For a Customer: Receivable is Debit - Credit
    // For a Supplier: Payable is Credit - Debit
    const signedReceivable = Math.round((totalDebit - totalCredit) * 100) / 100;
    const signedPayable = Math.round((totalCredit - totalDebit) * 100) / 100;

    const netDiff = Math.round((totalDebit - totalCredit) * 100) / 100;
    const balanceAbs = Math.abs(netDiff);
    const balanceType: 'Debit' | 'Credit' =
      netDiff > 0 ? 'Debit' : netDiff < 0 ? 'Credit' : openType;

    // Find Last Payment Date & Amount
    interface PaymentCandidate {
      payment_date: string;
      amount: number;
      reference_no: string;
      payment_mode: string;
      source: string;
    }
    const candidates: PaymentCandidate[] = [];

    if (!isSupplierRole) {
      // Customer receipts from payment_vouchers
      const pvRow = db
        .prepare(`
          SELECT voucher_date as payment_date, amount, voucher_number as reference_no, payment_method as payment_mode
          FROM payment_vouchers
          WHERE party_account_id = ? AND voucher_type IN ('Customer Receipt', 'receive_payment') AND status = 'completed'
          ORDER BY voucher_date DESC, id DESC
          LIMIT 1
        `)
        .get(id) as Record<string, unknown> | undefined;
      if (pvRow && Number(pvRow.amount) > 0) {
        candidates.push({
          payment_date: String(pvRow.payment_date),
          amount: Math.round(Number(pvRow.amount) * 100) / 100,
          reference_no: String(pvRow.reference_no || ''),
          payment_mode: String(pvRow.payment_mode || 'Cash'),
          source: 'Customer Receipt Voucher',
        });
      }

      // Customer receipts from accounting vouchers (CRV / BRV)
      const avRow = db
        .prepare(`
          SELECT av.voucher_date as payment_date, avl.credit_amount as amount, av.voucher_number as reference_no, av.voucher_type as payment_mode
          FROM accounting_voucher_lines avl
          INNER JOIN accounting_vouchers av ON av.id = avl.voucher_id
          WHERE avl.account_id = ? AND avl.credit_amount > 0 AND av.status = 'Posted'
            AND av.voucher_type IN ('CRV', 'BRV', 'JV')
          ORDER BY av.voucher_date DESC, av.id DESC
          LIMIT 1
        `)
        .get(id) as Record<string, unknown> | undefined;
      if (avRow && Number(avRow.amount) > 0) {
        candidates.push({
          payment_date: String(avRow.payment_date),
          amount: Math.round(Number(avRow.amount) * 100) / 100,
          reference_no: String(avRow.reference_no || ''),
          payment_mode: String(avRow.payment_mode || 'Voucher'),
          source: 'Accounting Voucher',
        });
      }

      // Paid amount on completed sales invoices
      const salePayRow = db
        .prepare(`
          SELECT invoice_date as payment_date, paid_amount as amount, invoice_number as reference_no, payment_mode
          FROM sales
          WHERE customer_account_id = ? AND status = 'completed' AND paid_amount > 0
            ${excludeSaleId > 0 ? 'AND id != ?' : ''}
          ORDER BY invoice_date DESC, id DESC
          LIMIT 1
        `)
        .get(...(excludeSaleId > 0 ? [id, excludeSaleId] : [id])) as Record<string, unknown> | undefined;
      if (salePayRow && Number(salePayRow.amount) > 0) {
        candidates.push({
          payment_date: String(salePayRow.payment_date),
          amount: Math.round(Number(salePayRow.amount) * 100) / 100,
          reference_no: String(salePayRow.reference_no || ''),
          payment_mode: String(salePayRow.payment_mode || 'Cash'),
          source: 'Invoice Payment',
        });
      }
    } else {
      // Supplier payments from payment_vouchers
      const pvRow = db
        .prepare(`
          SELECT voucher_date as payment_date, amount, voucher_number as reference_no, payment_method as payment_mode
          FROM payment_vouchers
          WHERE party_account_id = ? AND voucher_type IN ('Supplier Payment', 'pay_supplier') AND status = 'completed'
          ORDER BY voucher_date DESC, id DESC
          LIMIT 1
        `)
        .get(id) as Record<string, unknown> | undefined;
      if (pvRow && Number(pvRow.amount) > 0) {
        candidates.push({
          payment_date: String(pvRow.payment_date),
          amount: Math.round(Number(pvRow.amount) * 100) / 100,
          reference_no: String(pvRow.reference_no || ''),
          payment_mode: String(pvRow.payment_mode || 'Cash'),
          source: 'Supplier Payment Voucher',
        });
      }

      // Supplier payments from accounting vouchers (CPV / BPV)
      const avRow = db
        .prepare(`
          SELECT av.voucher_date as payment_date, avl.debit_amount as amount, av.voucher_number as reference_no, av.voucher_type as payment_mode
          FROM accounting_voucher_lines avl
          INNER JOIN accounting_vouchers av ON av.id = avl.voucher_id
          WHERE avl.account_id = ? AND avl.debit_amount > 0 AND av.status = 'Posted'
            AND av.voucher_type IN ('CPV', 'BPV', 'JV')
          ORDER BY av.voucher_date DESC, av.id DESC
          LIMIT 1
        `)
        .get(id) as Record<string, unknown> | undefined;
      if (avRow && Number(avRow.amount) > 0) {
        candidates.push({
          payment_date: String(avRow.payment_date),
          amount: Math.round(Number(avRow.amount) * 100) / 100,
          reference_no: String(avRow.reference_no || ''),
          payment_mode: String(avRow.payment_mode || 'Voucher'),
          source: 'Accounting Voucher',
        });
      }

      // Paid amount on completed purchase bills
      const purPayRow = db
        .prepare(`
          SELECT bill_date as payment_date, paid_amount as amount, bill_number as reference_no, payment_mode
          FROM purchases
          WHERE supplier_account_id = ? AND status = 'completed' AND paid_amount > 0
            ${excludePurchaseId > 0 ? 'AND id != ?' : ''}
          ORDER BY bill_date DESC, id DESC
          LIMIT 1
        `)
        .get(...(excludePurchaseId > 0 ? [id, excludePurchaseId] : [id])) as Record<string, unknown> | undefined;
      if (purPayRow && Number(purPayRow.amount) > 0) {
        candidates.push({
          payment_date: String(purPayRow.payment_date),
          amount: Math.round(Number(purPayRow.amount) * 100) / 100,
          reference_no: String(purPayRow.reference_no || ''),
          payment_mode: String(purPayRow.payment_mode || 'Cash'),
          source: 'Purchase Payment',
        });
      }
    }

    candidates.sort((a, b) => (a.payment_date < b.payment_date ? 1 : a.payment_date > b.payment_date ? -1 : 0));
    const lastPayment = candidates.length > 0 ? candidates[0] : null;

    return res.json({
      success: true,
      account: {
        id: account.id,
        account_code: account.account_code,
        account_name: account.account_name,
        account_group: account.account_group,
        phone: account.phone,
        city: account.city,
        filer_status: account.filer_status,
        credit_limit: account.credit_limit,
      },
      totalDebit,
      totalCredit,
      previousBalance: isSupplierRole ? signedPayable : signedReceivable,
      previousBalanceAbs: balanceAbs,
      previousBalanceType: balanceType,
      signedReceivable,
      signedPayable,
      lastPayment,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/accounts/:id
 * Detailed Account View including parent, sub-accounts, Customer vs Supplier ledger split, and protection status
 */
accountsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const account = db
      .prepare(`
        SELECT
          a.*,
          p.account_name as parent_account_name,
          p.account_code as parent_account_code
        FROM accounts a
        LEFT JOIN accounts p ON p.id = a.parent_account_id
        WHERE a.id = ?
      `)
      .get(id) as AccountRow | undefined;

    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    const subAccounts = db
      .prepare('SELECT id, account_code, account_name, account_group, current_balance, current_balance_type, status FROM accounts WHERE parent_account_id = ? ORDER BY account_code ASC')
      .all(id);

    const protection = getLinkedTransactionCount(id);

    return res.json({
      success: true,
      account: {
        ...account,
        sub_accounts_count: subAccounts.length,
        linked_transactions_count: protection.total,
      },
      subAccounts,
      protection: {
        ...protection,
        isSystemAccount: account.is_system_account === 1,
        canDelete: account.is_system_account === 0 && protection.total === 0 && protection.subAccounts === 0,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/accounts
 * Create a new Account with hierarchical support, Debit/Credit opening balance, and duplicate prevention
 */
accountsRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      account_code,
      account_name,
      main_group,
      account_group,
      parent_account_id = null,
      opening_balance = 0,
      opening_balance_type = 'Debit',
      contact_person = '',
      phone = '',
      email = '',
      ntn_cnic = '',
      ntn = '',
      strn = '',
      filer_status = 'Filer',
      tax_registration_details = '',
      address = '',
      city = '',
      credit_limit = 0,
      status = 'Active',
      notes = '',
    } = req.body;

    if (!account_name || String(account_name).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Account Name is required.' });
    }
    if (!main_group || !MAIN_ACCOUNT_GROUPS.includes(main_group)) {
      return res.status(400).json({
        success: false,
        error: 'Main Account Group must be PARTY ACCOUNTS, FINANCIAL ACCOUNTS, or INCOME & EXPENSE ACCOUNTS.',
      });
    }
    if (!account_group || String(account_group).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Account Group is required.' });
    }

    // Rules 1, 2, 4, 5, 6, 8, 9: Allocate authoritative sequential account code atomically
    const cleanGroup = String(account_group).trim();
    const allocated = allocateNextAccountCode(db, cleanGroup, main_group);
    const cleanCode = allocated.nextCode;

    let parentId: number | null = null;
    if (parent_account_id !== null && parent_account_id !== undefined && String(parent_account_id) !== '') {
      parentId = parseInt(String(parent_account_id), 10);
      const parentExists = db.prepare('SELECT id, main_group FROM accounts WHERE id = ?').get(parentId) as
        | { id: number; main_group: string }
        | undefined;
      if (!parentExists) {
        return res.status(400).json({ success: false, error: 'Selected Parent Account does not exist.' });
      }
      if (parentExists.main_group !== main_group) {
        return res.status(400).json({
          success: false,
          error: `Parent account belongs to "${parentExists.main_group}". Sub-accounts must be in the same Main Group.`,
        });
      }
    }

    const openBal = Math.max(0, Math.round((parseFloat(opening_balance) || 0) * 100) / 100);
    const openType: 'Debit' | 'Credit' = opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
    const credLimit = Math.max(0, Math.round((parseFloat(credit_limit) || 0) * 100) / 100);
    const accStatus: 'Active' | 'Inactive' = status === 'Inactive' ? 'Inactive' : 'Active';
    const validFiler: 'Filer' | 'Non-Filer' | 'Exempt' =
      ['Filer', 'Non-Filer', 'Exempt'].includes(filer_status) ? filer_status : 'Filer';

    const insertStmt = db.prepare(`
      INSERT INTO accounts (
        account_code, account_name, main_group, account_group, parent_account_id,
        opening_balance, opening_balance_type,
        total_debit, total_credit, current_balance, current_balance_type,
        contact_person, phone, email, ntn_cnic, ntn, strn, filer_status, tax_registration_details,
        address, city, credit_limit,
        is_system_account, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    const result = insertStmt.run(
      cleanCode,
      String(account_name).trim(),
      main_group,
      String(account_group).trim(),
      parentId,
      openBal,
      openType,
      openType === 'Debit' ? openBal : 0,
      openType === 'Credit' ? openBal : 0,
      openBal,
      openType,
      contact_person ? String(contact_person).trim() : null,
      phone ? String(phone).trim() : null,
      email ? String(email).trim() : null,
      ntn_cnic ? String(ntn_cnic).trim() : (ntn ? String(ntn).trim() : null),
      ntn ? String(ntn).trim() : (ntn_cnic ? String(ntn_cnic).trim() : null),
      strn ? String(strn).trim() : null,
      validFiler,
      tax_registration_details ? String(tax_registration_details).trim() : null,
      address ? String(address).trim() : null,
      city ? String(city).trim() : null,
      credLimit,
      accStatus,
      notes ? String(notes).trim() : null
    );

    const newId = Number(result.lastInsertRowid);
    let townId: number | null = req.body.town_id ? parseInt(String(req.body.town_id), 10) : null;
    let townName = String(req.body.town_name || '').trim();
    let areaId: number | null = req.body.area_id ? parseInt(String(req.body.area_id), 10) : null;
    let areaName = String(req.body.area_name || '').trim();
    let salesmanId: number | null = req.body.assigned_salesman_id ? parseInt(String(req.body.assigned_salesman_id), 10) : null;
    let salesmanName = String(req.body.assigned_salesman_name || '').trim();

    if (townId) {
      const t = db.prepare('SELECT id, town_name FROM towns WHERE id = ?').get(townId) as { id: number; town_name: string } | undefined;
      if (t) townName = t.town_name;
    } else if (townName) {
      const t = db.prepare('SELECT id, town_name FROM towns WHERE LOWER(town_name) = LOWER(?)').get(townName) as { id: number; town_name: string } | undefined;
      if (t) {
        townId = t.id;
        townName = t.town_name;
      }
    }

    if (areaId) {
      const a = db.prepare('SELECT id, area_name, town_id, town_name FROM town_areas WHERE id = ?').get(areaId) as { id: number; area_name: string; town_id: number; town_name: string } | undefined;
      if (a) {
        areaName = a.area_name;
        if (!townId) {
          townId = a.town_id;
          townName = a.town_name;
        }
      }
    } else if (areaName && townId) {
      const a = db.prepare('SELECT id, area_name FROM town_areas WHERE town_id = ? AND LOWER(area_name) = LOWER(?)').get(townId, areaName) as { id: number; area_name: string } | undefined;
      if (a) {
        areaId = a.id;
        areaName = a.area_name;
      }
    }

    if (salesmanId) {
      const s = db.prepare('SELECT id, full_name FROM salesmen WHERE id = ?').get(salesmanId) as { id: number; full_name: string } | undefined;
      if (s) salesmanName = s.full_name;
    }

    db.prepare(`
      UPDATE accounts SET
        town_id = ?,
        town_name = ?,
        city = COALESCE(NULLIF(?, ''), city),
        area_id = ?,
        area_name = ?,
        assigned_salesman_id = ?,
        assigned_salesman_name = ?
      WHERE id = ?
    `).run(townId, townName || null, townName || null, areaId, areaName || null, salesmanId, salesmanName || null, newId);

    recalculateAccountBalance(newId);

    const created = db
      .prepare(`
        SELECT a.*, p.account_name as parent_account_name, p.account_code as parent_account_code
        FROM accounts a
        LEFT JOIN accounts p ON p.id = a.parent_account_id
        WHERE a.id = ?
      `)
      .get(newId) as AccountRow;

    return res.status(201).json({
      success: true,
      message: `Account "${created.account_name}" (${created.account_code}) created successfully.`,
      account: created,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to create account: ${errorMsg}` });
  }
});

/**
 * PUT /api/accounts/:id
 * Update an existing Account and recalculate Debit/Credit balances
 */
accountsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    const {
      account_code,
      account_name,
      main_group,
      account_group,
      parent_account_id,
      opening_balance,
      opening_balance_type,
      contact_person,
      phone,
      email,
      ntn_cnic,
      ntn,
      strn,
      filer_status,
      tax_registration_details,
      address,
      city,
      credit_limit,
      status,
      notes,
      expected_updated_at,
      force_overwrite,
    } = req.body;

    // Multi-Computer Simultaneous Editing Conflict Detection
    if (
      expected_updated_at &&
      existing.updated_at &&
      String(expected_updated_at) !== String(existing.updated_at) &&
      !force_overwrite
    ) {
      return res.status(409).json({
        success: false,
        conflict: true,
        server_updated_at: existing.updated_at,
        error:
          'Simultaneous Edit Conflict Detected: This account was modified by another computer after you opened it. Please refresh to view the latest changes so newer data is not overwritten.',
      });
    }

    // Rule 10: Editing an existing account must never change its Account Code
    const cleanCode = existing.account_code;

    const nextMainGroup = main_group !== undefined ? main_group : existing.main_group;
    if (!MAIN_ACCOUNT_GROUPS.includes(nextMainGroup)) {
      return res.status(400).json({ success: false, error: 'Invalid Main Account Group.' });
    }

    let nextParentId: number | null = existing.parent_account_id;
    if (parent_account_id !== undefined) {
      if (parent_account_id === null || String(parent_account_id) === '') {
        nextParentId = null;
      } else {
        nextParentId = parseInt(String(parent_account_id), 10);
        if (nextParentId === id) {
          return res.status(400).json({
            success: false,
            error: 'An account cannot be set as its own parent account.',
          });
        }
        const parentRow = db
          .prepare('SELECT id, main_group, parent_account_id FROM accounts WHERE id = ?')
          .get(nextParentId) as { id: number; main_group: string; parent_account_id: number | null } | undefined;
        if (!parentRow) {
          return res.status(400).json({ success: false, error: 'Selected Parent Account does not exist.' });
        }
        if (parentRow.main_group !== nextMainGroup) {
          return res.status(400).json({
            success: false,
            error: `Parent account belongs to "${parentRow.main_group}". Sub-accounts must share the same Main Group.`,
          });
        }
        // Prevent circular parent chain
        let cursorParentId: number | null = parentRow.parent_account_id;
        while (cursorParentId !== null) {
          if (cursorParentId === id) {
            return res.status(400).json({
              success: false,
              error: 'Circular hierarchy detected: cannot assign a descendant account as parent.',
            });
          }
          const nextCursor = db
            .prepare('SELECT parent_account_id FROM accounts WHERE id = ?')
            .get(cursorParentId) as { parent_account_id: number | null } | undefined;
          cursorParentId = nextCursor ? nextCursor.parent_account_id : null;
        }
      }
    }

    const openBal =
      opening_balance !== undefined
        ? Math.max(0, Math.round((parseFloat(opening_balance) || 0) * 100) / 100)
        : existing.opening_balance;
    const openType: 'Debit' | 'Credit' =
      opening_balance_type !== undefined
        ? opening_balance_type === 'Credit'
          ? 'Credit'
          : 'Debit'
        : existing.opening_balance_type;
    const credLimit =
      credit_limit !== undefined
        ? Math.max(0, Math.round((parseFloat(credit_limit) || 0) * 100) / 100)
        : existing.credit_limit;
    const accStatus: 'Active' | 'Inactive' =
      status !== undefined ? (status === 'Inactive' ? 'Inactive' : 'Active') : existing.status;
    const nextFilerStatus: 'Filer' | 'Non-Filer' | 'Exempt' =
      filer_status !== undefined && ['Filer', 'Non-Filer', 'Exempt'].includes(filer_status)
        ? filer_status
        : existing.filer_status || 'Filer';

    const resolvedTown =
      req.body.town_name !== undefined
        ? String(req.body.town_name || '').trim()
        : city !== undefined
        ? String(city || '').trim()
        : String(existing.city || '');

    db.prepare(`
      UPDATE accounts SET
        account_code = ?,
        account_name = ?,
        main_group = ?,
        account_group = ?,
        parent_account_id = ?,
        opening_balance = ?,
        opening_balance_type = ?,
        contact_person = ?,
        phone = ?,
        email = ?,
        ntn_cnic = ?,
        ntn = ?,
        strn = ?,
        filer_status = ?,
        tax_registration_details = ?,
        address = ?,
        city = ?,
        town_name = ?,
        credit_limit = ?,
        status = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cleanCode,
      account_name !== undefined ? String(account_name).trim() : existing.account_name,
      nextMainGroup,
      account_group !== undefined ? String(account_group).trim() : existing.account_group,
      nextParentId,
      openBal,
      openType,
      contact_person !== undefined ? (contact_person ? String(contact_person).trim() : null) : existing.contact_person,
      phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
      email !== undefined ? (email ? String(email).trim() : null) : existing.email,
      ntn_cnic !== undefined ? (ntn_cnic ? String(ntn_cnic).trim() : null) : existing.ntn_cnic,
      ntn !== undefined ? (ntn ? String(ntn).trim() : null) : existing.ntn,
      strn !== undefined ? (strn ? String(strn).trim() : null) : existing.strn,
      nextFilerStatus,
      tax_registration_details !== undefined
        ? tax_registration_details
          ? String(tax_registration_details).trim()
          : null
        : existing.tax_registration_details,
      address !== undefined ? (address ? String(address).trim() : null) : existing.address,
      resolvedTown || null,
      resolvedTown,
      credLimit,
      accStatus,
      notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes,
      id
    );

    // Update Town, Area and Salesman assignments
    let nextTownId = req.body.town_id !== undefined ? (req.body.town_id ? parseInt(String(req.body.town_id), 10) : null) : existing.town_id;
    let nextTownName = req.body.town_name !== undefined ? String(req.body.town_name || '').trim() : (existing.town_name || resolvedTown || '');
    let nextAreaId = req.body.area_id !== undefined ? (req.body.area_id ? parseInt(String(req.body.area_id), 10) : null) : existing.area_id;
    let nextAreaName = req.body.area_name !== undefined ? String(req.body.area_name || '').trim() : (existing.area_name || '');
    let nextSalesmanId = req.body.assigned_salesman_id !== undefined ? (req.body.assigned_salesman_id ? parseInt(String(req.body.assigned_salesman_id), 10) : null) : existing.assigned_salesman_id;
    let nextSalesmanName = req.body.assigned_salesman_name !== undefined ? String(req.body.assigned_salesman_name || '').trim() : (existing.assigned_salesman_name || '');

    if (nextTownId) {
      const t = db.prepare('SELECT id, town_name FROM towns WHERE id = ?').get(nextTownId) as { id: number; town_name: string } | undefined;
      if (t) nextTownName = t.town_name;
    } else if (nextTownName) {
      const t = db.prepare('SELECT id, town_name FROM towns WHERE LOWER(town_name) = LOWER(?)').get(nextTownName) as { id: number; town_name: string } | undefined;
      if (t) {
        nextTownId = t.id;
        nextTownName = t.town_name;
      }
    }

    if (nextAreaId) {
      const a = db.prepare('SELECT id, area_name, town_id, town_name FROM town_areas WHERE id = ?').get(nextAreaId) as { id: number; area_name: string; town_id: number; town_name: string } | undefined;
      if (a) {
        nextAreaName = a.area_name;
        if (!nextTownId) {
          nextTownId = a.town_id;
          nextTownName = a.town_name;
        }
      }
    } else if (nextAreaName && nextTownId) {
      const a = db.prepare('SELECT id, area_name FROM town_areas WHERE town_id = ? AND LOWER(area_name) = LOWER(?)').get(nextTownId, nextAreaName) as { id: number; area_name: string } | undefined;
      if (a) {
        nextAreaId = a.id;
        nextAreaName = a.area_name;
      }
    }

    if (nextSalesmanId) {
      const s = db.prepare('SELECT id, full_name FROM salesmen WHERE id = ?').get(nextSalesmanId) as { id: number; full_name: string } | undefined;
      if (s) nextSalesmanName = s.full_name;
    }

    db.prepare(`
      UPDATE accounts SET
        town_id = ?,
        town_name = ?,
        city = COALESCE(NULLIF(?, ''), city),
        area_id = ?,
        area_name = ?,
        assigned_salesman_id = ?,
        assigned_salesman_name = ?
      WHERE id = ?
    `).run(nextTownId, nextTownName || null, nextTownName || null, nextAreaId, nextAreaName || null, nextSalesmanId, nextSalesmanName || null, id);

    recalculateAccountBalance(id);

    const updated = db
      .prepare(`
        SELECT a.*, p.account_name as parent_account_name, p.account_code as parent_account_code
        FROM accounts a
        LEFT JOIN accounts p ON p.id = a.parent_account_id
        WHERE a.id = ?
      `)
      .get(id) as AccountRow;

    return res.json({
      success: true,
      message: `Account "${updated.account_name}" (${updated.account_code}) updated successfully.`,
      account: updated,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to update account: ${errorMsg}` });
  }
});

/**
 * PATCH /api/accounts/:id/opening-balance
 * Dedicated Opening Balance update with immediate Debit/Credit recalculation
 */
accountsRouter.patch('/:id/opening-balance', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    const { opening_balance, opening_balance_type } = req.body;
    const openBal = Math.max(0, Math.round((parseFloat(opening_balance) || 0) * 100) / 100);
    const openType: 'Debit' | 'Credit' = opening_balance_type === 'Credit' ? 'Credit' : 'Debit';

    db.prepare(`
      UPDATE accounts SET
        opening_balance = ?,
        opening_balance_type = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(openBal, openType, id);

    recalculateAccountBalance(id);

    const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;

    return res.json({
      success: true,
      message: `Opening balance for "${updated.account_name}" updated to Rs. ${openBal.toFixed(2)} (${openType}).`,
      account: updated,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/accounts/opening-balances/bulk
 * Batch update Opening Balances across multiple accounts in a single transaction
 */
accountsRouter.post('/opening-balances/bulk', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { entries } = req.body as {
      entries: Array<{ id: number; opening_balance: number; opening_balance_type: 'Debit' | 'Credit' }>;
    };

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'No opening balance entries provided.' });
    }

    const updateBatch = db.transaction(() => {
      const stmt = db.prepare(`
        UPDATE accounts SET
          opening_balance = ?,
          opening_balance_type = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (const entry of entries) {
        const bal = Math.max(0, Math.round((Number(entry.opening_balance) || 0) * 100) / 100);
        const bType: 'Debit' | 'Credit' = entry.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
        stmt.run(bal, bType, entry.id);
        recalculateAccountBalance(entry.id);
      }
    });

    updateBatch();

    return res.json({
      success: true,
      message: `Updated opening balances for ${entries.length} account(s).`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * DELETE /api/accounts/:id
 * Strictly protects accounts linked to financial transactions, sub-accounts, or core system control heads
 */
accountsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const existing = db
      .prepare('SELECT id, account_code, account_name, main_group, account_group, is_system_account FROM accounts WHERE id = ?')
      .get(id) as {
        id: number;
        account_code: string;
        account_name: string;
        main_group: string;
        account_group: string;
        is_system_account: number;
      } | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    const isProtectedFinancialOrControl =
      existing.is_system_account === 1 ||
      existing.main_group === 'FINANCIAL ACCOUNTS' ||
      existing.main_group === 'INCOME & EXPENSE ACCOUNTS' ||
      ['ACC-1000', 'ACC-2000', 'ACC-3000', 'CUS-1001', 'FIN-1010', 'FIN-1020', 'FIN-1021', 'FIN-3010'].includes(
        existing.account_code.toUpperCase()
      );

    if (isProtectedFinancialOrControl) {
      return res.status(400).json({
        success: false,
        error: `Account "${existing.account_name}" (${existing.account_code}) is a protected Financial / Chart of Accounts head and can never be deleted. You may mark it as Inactive if needed.`,
      });
    }

    const protection = getLinkedTransactionCount(id);

    if (protection.subAccounts > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete "${existing.account_name}" (${existing.account_code}) because it has ${protection.subAccounts} sub-account(s). Please reassign or remove sub-accounts first.`,
      });
    }

    if (protection.total > 0) {
      return res.status(400).json({
        success: false,
        error: `Account "${existing.account_name}" (${existing.account_code}) is linked to ${protection.total} financial transaction(s) and is strictly protected from deletion. Change its status to Inactive instead.`,
      });
    }

    // Rule 8: Record deleted account code in history so it is never reused
    recordAccountCodeDeletion(
      db,
      existing.id,
      existing.account_code,
      existing.account_name,
      existing.account_group
    );

    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);

    return res.json({
      success: true,
      message: `Account "${existing.account_name}" (${existing.account_code}) has been permanently deleted.`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to delete account: ${errorMsg}` });
  }
});

/**
 * POST /api/accounts/bulk-import
 * Excel Import with validation, hierarchy resolution, and duplicate protection
 */
accountsRouter.post('/bulk-import', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { accounts, updateExisting = false } = req.body;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ success: false, error: 'No accounts provided for import.' });
    }

    const errors: string[] = [];
    const seenCodes = new Set<string>();

    accounts.forEach((acc, idx) => {
      const rowNum = idx + 2;
      const code = acc.account_code ? String(acc.account_code).trim() : '';
      if (!code) {
        errors.push(`Row ${rowNum}: Account Code is missing.`);
      } else {
        const upper = code.toUpperCase();
        if (seenCodes.has(upper)) {
          errors.push(`Row ${rowNum}: Duplicate Account Code "${code}" inside spreadsheet.`);
        } else {
          seenCodes.add(upper);
        }
      }

      if (!acc.account_name || String(acc.account_name).trim().length === 0) {
        errors.push(`Row ${rowNum}: Account Name is missing.`);
      }
      if (!acc.main_group || !MAIN_ACCOUNT_GROUPS.includes(acc.main_group)) {
        errors.push(
          `Row ${rowNum}: Invalid Main Group "${acc.main_group}". Must be PARTY ACCOUNTS, FINANCIAL ACCOUNTS, or INCOME & EXPENSE ACCOUNTS.`
        );
      }
      if (!acc.account_group || String(acc.account_group).trim().length === 0) {
        errors.push(`Row ${rowNum}: Account Group is missing.`);
      }
    });

    if (errors.length === 0 && !updateExisting) {
      const existingCodes = (
        db.prepare('SELECT account_code FROM accounts').all() as Array<{ account_code: string }>
      ).map((r) => r.account_code.toUpperCase());

      const conflicts: string[] = [];
      seenCodes.forEach((code) => {
        if (existingCodes.includes(code)) {
          conflicts.push(code);
        }
      });

      if (conflicts.length > 0) {
        errors.push(
          `Account Code(s) already exist in database: ${conflicts.join(', ')}. Enable "Update Existing" to overwrite them.`
        );
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Accounts Excel import validation failed.',
        errors,
      });
    }

    let insertedCount = 0;
    let updatedCount = 0;

    const executeImport = db.transaction(() => {
      const findByCodeStmt = db.prepare('SELECT id FROM accounts WHERE UPPER(TRIM(account_code)) = UPPER(TRIM(?))');
      const insertStmt = db.prepare(`
        INSERT INTO accounts (
          account_code, account_name, main_group, account_group, parent_account_id,
          opening_balance, opening_balance_type,
          total_debit, total_credit, current_balance, current_balance_type,
          contact_person, phone, email, ntn_cnic, address, city, credit_limit,
          is_system_account, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      const updateStmt = db.prepare(`
        UPDATE accounts SET
          account_name = ?,
          main_group = ?,
          account_group = ?,
          parent_account_id = ?,
          opening_balance = ?,
          opening_balance_type = ?,
          contact_person = ?,
          phone = ?,
          email = ?,
          ntn_cnic = ?,
          address = ?,
          city = ?,
          credit_limit = ?,
          status = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (const acc of accounts) {
        const code = String(acc.account_code).trim();
        const existing = findByCodeStmt.get(code) as { id: number } | undefined;

        let parentId: number | null = null;
        if (acc.parent_account_code) {
          const pMatch = findByCodeStmt.get(String(acc.parent_account_code).trim()) as { id: number } | undefined;
          if (pMatch) parentId = pMatch.id;
        }

        const openBal = Math.max(0, Math.round((parseFloat(acc.opening_balance) || 0) * 100) / 100);
        const openType: 'Debit' | 'Credit' =
          String(acc.opening_balance_type || 'Debit').toLowerCase() === 'credit' ? 'Credit' : 'Debit';
        const credLimit = Math.max(0, Math.round((parseFloat(acc.credit_limit) || 0) * 100) / 100);
        const status: 'Active' | 'Inactive' =
          String(acc.status || 'Active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

        if (existing) {
          if (updateExisting) {
            updateStmt.run(
              String(acc.account_name).trim(),
              acc.main_group,
              String(acc.account_group).trim(),
              parentId,
              openBal,
              openType,
              acc.contact_person ? String(acc.contact_person).trim() : null,
              acc.phone ? String(acc.phone).trim() : null,
              acc.email ? String(acc.email).trim() : null,
              acc.ntn_cnic ? String(acc.ntn_cnic).trim() : null,
              acc.address ? String(acc.address).trim() : null,
              acc.city ? String(acc.city).trim() : null,
              credLimit,
              status,
              acc.notes ? String(acc.notes).trim() : null,
              existing.id
            );
            recalculateAccountBalance(existing.id);
            updatedCount++;
          }
        } else {
          const info = insertStmt.run(
            code,
            String(acc.account_name).trim(),
            acc.main_group,
            String(acc.account_group).trim(),
            parentId,
            openBal,
            openType,
            openType === 'Debit' ? openBal : 0,
            openType === 'Credit' ? openBal : 0,
            openBal,
            openType,
            acc.contact_person ? String(acc.contact_person).trim() : null,
            acc.phone ? String(acc.phone).trim() : null,
            acc.email ? String(acc.email).trim() : null,
            acc.ntn_cnic ? String(acc.ntn_cnic).trim() : null,
            acc.address ? String(acc.address).trim() : null,
            acc.city ? String(acc.city).trim() : null,
            credLimit,
            status,
            acc.notes ? String(acc.notes).trim() : null
          );
          recalculateAccountBalance(Number(info.lastInsertRowid));
          insertedCount++;
        }
      }
    });

    executeImport();

    return res.json({
      success: true,
      message: `Accounts Excel import complete. Added: ${insertedCount}, Updated: ${updatedCount}.`,
      insertedCount,
      updatedCount,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to import accounts: ${errorMsg}` });
  }
});
