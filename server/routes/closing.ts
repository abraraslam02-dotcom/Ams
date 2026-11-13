import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { parsePacking, round2 } from './purchases.ts';
import { triggerPreChangeBackupIfEnabled } from '../services/backupService.ts';

export const closingRouter = Router();

function addDaysIso(dateStr: string, days: number): string {
  const clean = String(dateStr || '').trim().slice(0, 10);
  const [y, m, d] = clean.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return clean;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getMonthDateRange(monthStr?: string): { startDate: string; endDate: string; periodName: string } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim())) {
    const parts = monthStr.trim().split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  }
  const startDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const periodName = `${monthNames[month - 1] || 'Month'} ${year}`;
  return { startDate, endDate, periodName };
}

function getNextClosingCode(prefix: 'CLS-DAY' | 'CLS-MON' | 'CLS-YRL' | 'CLS-STK'): string {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const rows = db
    .prepare('SELECT closing_code FROM financial_closings WHERE closing_code LIKE ? ORDER BY id DESC LIMIT 1')
    .get(`${prefix}-${year}-%`) as { closing_code: string } | undefined;
  let seq = 1;
  if (rows?.closing_code) {
    const m = rows.closing_code.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  while (
    db
      .prepare('SELECT id FROM financial_closings WHERE closing_code = ?')
      .get(`${prefix}-${year}-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

export interface ComputedAccountPeriodRow {
  account_id: number;
  account_code: string;
  account_name: string;
  main_group: string;
  account_group: string;
  account_type: string;
  financial_category: string;
  town_name: string;
  area_name: string;
  is_system_account: number;
  status: string;
  opening_debit: number;
  opening_credit: number;
  opening_signed: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
  closing_signed: number;
  closing_balance_amount: number;
  closing_balance_type: 'Debit' | 'Credit';
  carried_forward_amount: number;
  carried_forward_type: 'Debit' | 'Credit';
}

/**
 * Computes exact opening (before startDate), period movement ([startDate, endDate]),
 * closing (as of endDate), and carried-forward opening balance (for endDate + 1 day)
 * for all accounts in the Chart of Accounts.
 */
export function computeAllAccountsClosingState(startDate: string, endDate: string): ComputedAccountPeriodRow[] {
  const db = getDatabase();
  const accounts = db
    .prepare(
      `
      SELECT
        a.id,
        a.account_code,
        a.account_name,
        a.main_group,
        a.account_group,
        COALESCE(NULLIF(TRIM(a.account_type), ''), a.account_group) as account_type,
        a.financial_category,
        COALESCE(NULLIF(TRIM(a.town_name), ''), a.city, '') as town_name,
        COALESCE(a.area_name, '') as area_name,
        a.opening_balance,
        a.opening_balance_type,
        a.is_system_account,
        a.status,
        COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND DATE(je.entry_date) < DATE(?) THEN jel.debit_amount ELSE 0 END), 0) as pre_debit,
        COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND DATE(je.entry_date) < DATE(?) THEN jel.credit_amount ELSE 0 END), 0) as pre_credit,
        COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND DATE(je.entry_date) >= DATE(?) AND DATE(je.entry_date) <= DATE(?) THEN jel.debit_amount ELSE 0 END), 0) as period_debit,
        COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND DATE(je.entry_date) >= DATE(?) AND DATE(je.entry_date) <= DATE(?) THEN jel.credit_amount ELSE 0 END), 0) as period_credit
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
      GROUP BY a.id
      ORDER BY a.account_code ASC
    `
    )
    .all(startDate, startDate, startDate, endDate, startDate, endDate) as Array<Record<string, unknown>>;

  return accounts.map((a) => {
    const baseOpen = round2(Number(a.opening_balance || 0));
    const baseOpenSigned = String(a.opening_balance_type || 'Debit') === 'Debit' ? baseOpen : -baseOpen;
    const preDebit = round2(Number(a.pre_debit || 0));
    const preCredit = round2(Number(a.pre_credit || 0));
    const periodDebit = round2(Number(a.period_debit || 0));
    const periodCredit = round2(Number(a.period_credit || 0));

    const openingSigned = round2(baseOpenSigned + preDebit - preCredit);
    const closingSigned = round2(openingSigned + periodDebit - periodCredit);

    const openingDebit = openingSigned > 0 ? openingSigned : 0;
    const openingCredit = openingSigned < 0 ? Math.abs(openingSigned) : 0;
    const closingDebit = closingSigned > 0 ? closingSigned : 0;
    const closingCredit = closingSigned < 0 ? Math.abs(closingSigned) : 0;

    const closingBalanceAmount = round2(Math.abs(closingSigned));
    const closingBalanceType: 'Debit' | 'Credit' =
      closingSigned > 0
        ? 'Debit'
        : closingSigned < 0
        ? 'Credit'
        : String(a.opening_balance_type || 'Debit') === 'Credit'
        ? 'Credit'
        : 'Debit';

    // Income & Expense accounts reset their period flow in the new period (their net profit/loss is retained in Equity),
    // whereas all Balance Sheet accounts (Customer, Supplier, Cash, Bank, Assets, Liabilities, Capital) carry forward 100% of their exact closing balance.
    const isIncomeOrExpense =
      String(a.financial_category) === 'Income' ||
      String(a.financial_category) === 'Expenses' ||
      String(a.main_group) === 'INCOME & EXPENSE ACCOUNTS';

    const carriedForwardAmount = isIncomeOrExpense ? 0 : closingBalanceAmount;
    const carriedForwardType: 'Debit' | 'Credit' = closingBalanceType;

    return {
      account_id: Number(a.id),
      account_code: String(a.account_code || ''),
      account_name: String(a.account_name || ''),
      main_group: String(a.main_group || ''),
      account_group: String(a.account_group || ''),
      account_category: String(a.financial_category || a.account_group || ''),
      account_type: String(a.account_type || ''),
      financial_category: String(a.financial_category || ''),
      town_name: String(a.town_name || ''),
      area_name: String(a.area_name || ''),
      is_system_account: Number(a.is_system_account || 0),
      status: String(a.status || 'Active'),
      opening_debit: openingDebit,
      opening_credit: openingCredit,
      opening_signed: openingSigned,
      opening_balance: openingSigned,
      period_debit: periodDebit,
      period_credit: periodCredit,
      closing_debit: closingDebit,
      closing_credit: closingCredit,
      closing_signed: closingSigned,
      closing_balance: closingSigned,
      payable_balance: closingSigned < 0 ? Math.abs(closingSigned) : 0,
      closing_balance_amount: closingBalanceAmount,
      closing_balance_type: closingBalanceType,
      carried_forward_amount: carriedForwardAmount,
      carried_forward_type: carriedForwardType,
      carried_forward_balance: isIncomeOrExpense ? 0 : closingSigned,
    };
  });
}

export interface ComputedStockClosingItem {
  s_no: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  category: string;
  packing: string;
  opening_qty: number;
  purchased_qty: number;
  sold_qty: number;
  purchase_returns_qty: number;
  sales_returns_qty: number;
  adjustments_qty: number;
  closing_qty: number;
  unit_cost_rate: number;
  trade_price: number;
  opening_stock_value: number;
  closing_stock_value: number;
  costing_method: string;
}

/**
 * Computes item-by-item Stock Closing for [startDate, endDate] using the exact Full Pack
 * movement formula and Weighted Average / FIFO batch cost valuation.
 */
export function computePeriodStockClosing(startDate: string, endDate: string): {
  items: ComputedStockClosingItem[];
  summary: {
    totalItems: number;
    openingInventoryQty: number;
    openingInventoryValue: number;
    purchasedQty: number;
    soldQty: number;
    purchaseReturnsQty: number;
    salesReturnsQty: number;
    adjustmentsQty: number;
    closingInventoryQty: number;
    closingInventoryValue: number;
    costingMethod: string;
  };
} {
  const db = getDatabase();
  const settingsRow = db
    .prepare('SELECT costing_method FROM company_settings ORDER BY id ASC LIMIT 1')
    .get() as { costing_method?: string } | undefined;
  const costingMethod = String(settingsRow?.costing_method || 'Weighted Average / FIFO');

  const allItems = db
    .prepare('SELECT * FROM items ORDER BY company_name ASC, item_name ASC')
    .all() as Array<Record<string, unknown>>;

  const priorPurchases = new Map<number, number>();
  const periodPurchases = new Map<number, number>();
  const pRows = db
    .prepare(
      `
      SELECT pi.item_id, p.bill_date, pi.quantity, pi.bonus_quantity, pi.pack_quantity, pi.loose_quantity, i.packing
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN items i ON pi.item_id = i.id
      WHERE p.status = 'completed' AND DATE(p.bill_date) <= DATE(?)
    `
    )
    .all(endDate) as Array<Record<string, unknown>>;

  for (const r of pRows) {
    const itemId = Number(r.item_id);
    const parsed = parsePacking(String(r.packing || '1x1'));
    const packs =
      Number(r.pack_quantity ?? r.quantity ?? 0) +
      Number(r.bonus_quantity || 0) +
      Number(r.loose_quantity || 0) / parsed.unitsPerPack;
    const bDate = String(r.bill_date || '').slice(0, 10);
    if (bDate < startDate) {
      priorPurchases.set(itemId, (priorPurchases.get(itemId) || 0) + packs);
    } else {
      periodPurchases.set(itemId, (periodPurchases.get(itemId) || 0) + packs);
    }
  }

  const priorPurReturns = new Map<number, number>();
  const periodPurReturns = new Map<number, number>();
  const prRows = db
    .prepare(
      `
      SELECT pri.item_id, pr.return_date, pri.return_quantity
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
      WHERE pr.status = 'completed' AND DATE(pr.return_date) <= DATE(?)
    `
    )
    .all(endDate) as Array<Record<string, unknown>>;

  for (const r of prRows) {
    const itemId = Number(r.item_id);
    const packs = Number(r.return_quantity || 0);
    const rDate = String(r.return_date || '').slice(0, 10);
    if (rDate < startDate) {
      priorPurReturns.set(itemId, (priorPurReturns.get(itemId) || 0) + packs);
    } else {
      periodPurReturns.set(itemId, (periodPurReturns.get(itemId) || 0) + packs);
    }
  }

  const priorSales = new Map<number, number>();
  const periodSales = new Map<number, number>();
  const sRows = db
    .prepare(
      `
      SELECT si.item_id, s.invoice_date, si.quantity, si.bonus_quantity, si.loose_quantity, si.total_units, si.units_per_pack, i.packing
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN items i ON si.item_id = i.id
      WHERE s.status = 'completed' AND DATE(s.invoice_date) <= DATE(?)
    `
    )
    .all(endDate) as Array<Record<string, unknown>>;

  for (const r of sRows) {
    const itemId = Number(r.item_id);
    const parsed = parsePacking(String(r.packing || '1x1'));
    const upp = Math.max(1, Number(r.units_per_pack || parsed.unitsPerPack || 1));
    const totalUnits = Number(r.total_units || 0);
    const packs =
      totalUnits > 0
        ? totalUnits / upp
        : Number(r.quantity || 0) + Number(r.bonus_quantity || 0) + Number(r.loose_quantity || 0) / upp;
    const iDate = String(r.invoice_date || '').slice(0, 10);
    if (iDate < startDate) {
      priorSales.set(itemId, (priorSales.get(itemId) || 0) + packs);
    } else {
      periodSales.set(itemId, (periodSales.get(itemId) || 0) + packs);
    }
  }

  const priorSaleReturns = new Map<number, number>();
  const periodSaleReturns = new Map<number, number>();
  const srRows = db
    .prepare(
      `
      SELECT sri.item_id, sr.return_date, sri.return_pack_qty, sri.return_bonus_qty, sri.return_loose_qty, sri.returned_units, sri.units_per_pack, i.packing
      FROM sale_return_items sri
      JOIN sale_returns sr ON sri.sale_return_id = sr.id
      LEFT JOIN items i ON sri.item_id = i.id
      WHERE sr.status = 'completed' AND DATE(sr.return_date) <= DATE(?)
    `
    )
    .all(endDate) as Array<Record<string, unknown>>;

  for (const r of srRows) {
    const itemId = Number(r.item_id);
    const parsed = parsePacking(String(r.packing || '1x1'));
    const upp = Math.max(1, Number(r.units_per_pack || parsed.unitsPerPack || 1));
    const retUnits = Number(r.returned_units || 0);
    const packs =
      retUnits > 0
        ? retUnits / upp
        : Number(r.return_pack_qty || 0) + Number(r.return_bonus_qty || 0) + Number(r.return_loose_qty || 0) / upp;
    const rDate = String(r.return_date || '').slice(0, 10);
    if (rDate < startDate) {
      priorSaleReturns.set(itemId, (priorSaleReturns.get(itemId) || 0) + packs);
    } else {
      periodSaleReturns.set(itemId, (periodSaleReturns.get(itemId) || 0) + packs);
    }
  }

  const priorAdj = new Map<number, number>();
  const periodAdj = new Map<number, number>();
  const adjRows = db
    .prepare(
      `
      SELECT sai.item_id, sa.adjustment_date, sai.adjustment_mode, sai.pack_qty, sai.loose_qty, sai.total_units, sai.units_per_pack, i.packing
      FROM stock_adjustment_items sai
      JOIN stock_adjustments sa ON sai.adjustment_id = sa.id
      LEFT JOIN items i ON sai.item_id = i.id
      WHERE sa.status = 'completed' AND DATE(sa.adjustment_date) <= DATE(?)
    `
    )
    .all(endDate) as Array<Record<string, unknown>>;

  for (const r of adjRows) {
    const itemId = Number(r.item_id);
    const parsed = parsePacking(String(r.packing || '1x1'));
    const upp = Math.max(1, Number(r.units_per_pack || parsed.unitsPerPack || 1));
    const totUnits = Number(r.total_units || 0);
    const absPacks =
      totUnits > 0 ? totUnits / upp : Number(r.pack_qty || 0) + Number(r.loose_qty || 0) / upp;
    const signedPacks = String(r.adjustment_mode) === 'Increase' ? absPacks : -absPacks;
    const aDate = String(r.adjustment_date || '').slice(0, 10);
    if (aDate < startDate) {
      priorAdj.set(itemId, (priorAdj.get(itemId) || 0) + signedPacks);
    } else {
      periodAdj.set(itemId, (periodAdj.get(itemId) || 0) + signedPacks);
    }
  }

  // Batch-level weighted average cost per pack lookup
  const batchCostMap = new Map<number, number>();
  const batchRows = db
    .prepare(
      `
      SELECT
        item_id,
        SUM(CASE WHEN current_pack_qty > 0 THEN current_pack_qty * COALESCE(NULLIF(pack_cost, 0), cost_price, 0) ELSE 0 END) as weighted_cost_sum,
        SUM(CASE WHEN current_pack_qty > 0 THEN current_pack_qty ELSE 0 END) as active_packs,
        AVG(COALESCE(NULLIF(pack_cost, 0), cost_price, 0)) as avg_batch_cost
      FROM inventory
      GROUP BY item_id
    `
    )
    .all() as Array<Record<string, unknown>>;

  for (const b of batchRows) {
    const itemId = Number(b.item_id);
    const activePacks = Number(b.active_packs || 0);
    const weightedSum = Number(b.weighted_cost_sum || 0);
    const avgCost = Number(b.avg_batch_cost || 0);
    if (activePacks > 0 && weightedSum > 0) {
      batchCostMap.set(itemId, round2(weightedSum / activePacks));
    } else if (avgCost > 0) {
      batchCostMap.set(itemId, round2(avgCost));
    }
  }

  let openingInventoryQty = 0;
  let openingInventoryValue = 0;
  let totalPurchasedQty = 0;
  let totalSoldQty = 0;
  let totalPurRetQty = 0;
  let totalSaleRetQty = 0;
  let totalAdjQty = 0;
  let closingInventoryQty = 0;
  let closingInventoryValue = 0;

  const computedItems: ComputedStockClosingItem[] = allItems.map((item, idx) => {
    const itemId = Number(item.id);
    const initialOpening = Number(item.opening_stock || 0);
    const pPrior = priorPurchases.get(itemId) || 0;
    const prPrior = priorPurReturns.get(itemId) || 0;
    const sPrior = priorSales.get(itemId) || 0;
    const srPrior = priorSaleReturns.get(itemId) || 0;
    const aPrior = priorAdj.get(itemId) || 0;

    const openingQty = round2(initialOpening + pPrior - prPrior - sPrior + srPrior + aPrior);
    const purchasedQty = round2(periodPurchases.get(itemId) || 0);
    const purchaseReturnsQty = round2(periodPurReturns.get(itemId) || 0);
    const soldQty = round2(periodSales.get(itemId) || 0);
    const salesReturnsQty = round2(periodSaleReturns.get(itemId) || 0);
    const adjustmentsQty = round2(periodAdj.get(itemId) || 0);

    const closingQty = round2(
      openingQty + purchasedQty - purchaseReturnsQty - soldQty + salesReturnsQty + adjustmentsQty
    );

    const itemPurchasePrice = Number(item.purchase_price || 0);
    const itemTradePrice = Number(item.trade_price || 0);
    const unitCostRate = round2(
      batchCostMap.get(itemId) || (itemPurchasePrice > 0 ? itemPurchasePrice : itemTradePrice)
    );

    const openingVal = round2(Math.max(0, openingQty) * unitCostRate);
    const closingVal = round2(Math.max(0, closingQty) * unitCostRate);

    openingInventoryQty = round2(openingInventoryQty + openingQty);
    openingInventoryValue = round2(openingInventoryValue + openingVal);
    totalPurchasedQty = round2(totalPurchasedQty + purchasedQty);
    totalSoldQty = round2(totalSoldQty + soldQty);
    totalPurRetQty = round2(totalPurRetQty + purchaseReturnsQty);
    totalSaleRetQty = round2(totalSaleRetQty + salesReturnsQty);
    totalAdjQty = round2(totalAdjQty + adjustmentsQty);
    closingInventoryQty = round2(closingInventoryQty + closingQty);
    closingInventoryValue = round2(closingInventoryValue + closingVal);

    return {
      s_no: idx + 1,
      item_id: itemId,
      item_code: String(item.item_code || ''),
      item_name: String(item.item_name || ''),
      company_name: String(item.company_name || ''),
      category: String(item.category || 'Tablet'),
      packing: String(item.packing || '1x1'),
      opening_qty: openingQty,
      opening_quantity: openingQty,
      purchased_qty: purchasedQty,
      purchased_quantity: purchasedQty,
      sold_qty: soldQty,
      sold_quantity: soldQty,
      purchase_returns_qty: purchaseReturnsQty,
      purchase_return_quantity: purchaseReturnsQty,
      sales_returns_qty: salesReturnsQty,
      sales_return_quantity: salesReturnsQty,
      adjustments_qty: adjustmentsQty,
      adjustment_quantity: adjustmentsQty,
      closing_qty: closingQty,
      closing_quantity: closingQty,
      unit_cost_rate: unitCostRate,
      unit_cost: unitCostRate,
      trade_price: round2(itemTradePrice),
      opening_stock_value: openingVal,
      closing_stock_value: closingVal,
      closing_valuation: closingVal,
      costing_method: costingMethod,
    };
  });

  return {
    items: computedItems,
    summary: {
      totalItems: computedItems.length,
      openingInventoryQty,
      openingInventoryValue,
      purchasedQty: totalPurchasedQty,
      soldQty: totalSoldQty,
      purchaseReturnsQty: totalPurRetQty,
      salesReturnsQty: totalSaleRetQty,
      adjustmentsQty: totalAdjQty,
      closingInventoryQty,
      closingInventoryValue,
      costingMethod,
      opening_quantity: openingInventoryQty,
      purchased_quantity: totalPurchasedQty,
      sold_quantity: totalSoldQty,
      purchase_return_quantity: totalPurRetQty,
      sales_return_quantity: totalSaleRetQty,
      adjustment_quantity: totalAdjQty,
      closing_quantity: closingInventoryQty,
      closing_valuation: closingInventoryValue,
    },
  };
}

/**
 * Computes complete financial & operational closing metrics for any date range [startDate, endDate].
 */
export function computeFinancialPeriodClosingPreview(
  startDate: string,
  endDate: string,
  closingType: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'STOCK' = 'MONTHLY',
  periodNameOverride?: string
) {
  const db = getDatabase();
  const nextPeriodStartDate = addDaysIso(endDate, 1);

  const accountRows = computeAllAccountsClosingState(startDate, endDate);
  const stockClosing = computePeriodStockClosing(startDate, endDate);

  // Classify accounts (including 'Cash in Hand' and all non-control Customer/Supplier accounts)
  const CONTROL_CODES = new Set(['ACC-1000', 'ACC-2000', 'ACC-3000', 'FIN-1020']);
  const cashAccounts = accountRows.filter(
    (a) => a.account_group === 'Cash' || a.account_group.toLowerCase().includes('cash')
  );
  const bankAccounts = accountRows.filter(
    (a) =>
      (a.account_group === 'Bank' || a.account_group.toLowerCase().includes('bank')) &&
      !CONTROL_CODES.has(a.account_code)
  );
  const customerAccounts = accountRows.filter(
    (a) =>
      (a.account_group === 'Customer' || a.account_type === 'Customer' || a.account_type === 'Customer & Supplier') &&
      !CONTROL_CODES.has(a.account_code)
  );
  const supplierAccounts = accountRows.filter(
    (a) =>
      (a.account_group === 'Supplier' || a.account_type === 'Supplier' || a.account_type === 'Customer & Supplier') &&
      !CONTROL_CODES.has(a.account_code)
  );
  const financialAccounts = accountRows.filter(
    (a) => a.main_group === 'FINANCIAL ACCOUNTS' || ['Cash', 'Bank', 'Assets', 'Liabilities', 'Capital'].includes(a.account_group)
  );

  // Cash & Bank opening, period movement, and closing balances
  const openingCashBalance = round2(cashAccounts.reduce((s, a) => s + a.opening_signed, 0));
  const closingCashBalance = round2(cashAccounts.reduce((s, a) => s + a.closing_signed, 0));
  const totalCashDebits = round2(cashAccounts.reduce((s, a) => s + a.period_debit, 0));
  const totalCashCredits = round2(cashAccounts.reduce((s, a) => s + a.period_credit, 0));

  const openingBankBalance = round2(bankAccounts.reduce((s, a) => s + a.opening_signed, 0));
  const closingBankBalance = round2(bankAccounts.reduce((s, a) => s + a.closing_signed, 0));
  const bankReceipts = round2(bankAccounts.reduce((s, a) => s + a.period_debit, 0));
  const bankPayments = round2(bankAccounts.reduce((s, a) => s + a.period_credit, 0));
  const bankTransactionsNet = round2(bankReceipts - bankPayments);

  // Sales breakdown in period
  const salesAgg = db
    .prepare(
      `
      SELECT
        COUNT(*) as invoice_count,
        COALESCE(SUM(net_total), 0) as total_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'Cash' THEN net_total WHEN payment_mode = 'Partial' THEN paid_amount ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_mode = 'Credit' THEN net_total WHEN payment_mode = 'Partial' THEN (net_total - paid_amount) ELSE 0 END), 0) as credit_sales,
        COALESCE(SUM(CASE WHEN payment_mode IN ('Bank', 'Bank Transfer', 'Online', 'Card') THEN net_total ELSE 0 END), 0) as bank_sales
      FROM sales
      WHERE status = 'completed'
        AND DATE(invoice_date) >= DATE(?)
        AND DATE(invoice_date) <= DATE(?)
    `
    )
    .get(startDate, endDate) as Record<string, number>;

  const salesReturnsAgg = db
    .prepare(
      `
      SELECT
        COUNT(*) as return_count,
        COALESCE(SUM(total_refund_amount), 0) as total_returns,
        COALESCE(SUM(CASE WHEN refund_mode = 'Cash Refund' THEN total_refund_amount ELSE 0 END), 0) as cash_refunds
      FROM sale_returns
      WHERE status = 'completed'
        AND DATE(return_date) >= DATE(?)
        AND DATE(return_date) <= DATE(?)
    `
    )
    .get(startDate, endDate) as Record<string, number>;

  // Purchases breakdown in period
  const purchasesAgg = db
    .prepare(
      `
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(net_total), 0) as total_purchases,
        COALESCE(SUM(CASE WHEN payment_mode = 'Cash' THEN net_total WHEN payment_mode = 'Partial' THEN paid_amount ELSE 0 END), 0) as cash_purchases,
        COALESCE(SUM(CASE WHEN payment_mode = 'Credit' THEN net_total WHEN payment_mode = 'Partial' THEN (net_total - paid_amount) ELSE 0 END), 0) as credit_purchases,
        COALESCE(SUM(CASE WHEN payment_mode IN ('Bank', 'Bank Transfer', 'Online', 'Cheque') THEN net_total ELSE 0 END), 0) as bank_purchases
      FROM purchases
      WHERE status = 'completed'
        AND DATE(bill_date) >= DATE(?)
        AND DATE(bill_date) <= DATE(?)
    `
    )
    .get(startDate, endDate) as Record<string, number>;

  const purchaseReturnsAgg = db
    .prepare(
      `
      SELECT
        COUNT(*) as return_count,
        COALESCE(SUM(total_debit_amount), 0) as total_returns,
        COALESCE(SUM(CASE WHEN settlement_mode = 'Cash Refund' THEN total_debit_amount ELSE 0 END), 0) as cash_refunds
      FROM purchase_returns
      WHERE status = 'completed'
        AND DATE(return_date) >= DATE(?)
        AND DATE(return_date) <= DATE(?)
    `
    )
    .get(startDate, endDate) as Record<string, number>;

  const totalSales = round2(Number(salesAgg?.total_sales || 0));
  const cashSales = round2(Number(salesAgg?.cash_sales || 0));
  const creditSales = round2(Number(salesAgg?.credit_sales || 0));
  const salesReturns = round2(Number(salesReturnsAgg?.total_returns || 0));
  const netSales = round2(totalSales - salesReturns);

  const totalPurchases = round2(Number(purchasesAgg?.total_purchases || 0));
  const cashPurchases = round2(Number(purchasesAgg?.cash_purchases || 0));
  const creditPurchases = round2(Number(purchasesAgg?.credit_purchases || 0));
  const purchaseReturns = round2(Number(purchaseReturnsAgg?.total_returns || 0));
  const netPurchases = round2(totalPurchases - purchaseReturns);

  // Cash receipts (non-cash-sale inflows into Cash accounts) & Cash payments (non-cash-purchase outflows from Cash accounts)
  const cashReceiptsOther = round2(Math.max(0, totalCashDebits - cashSales));
  const cashPaymentsOther = round2(Math.max(0, totalCashCredits - cashPurchases));

  // Income & Expenses from GL accounts in period
  const otherIncomeAccounts = accountRows.filter(
    (a) => a.account_group === 'Other Income' || (a.financial_category === 'Income' && a.account_group !== 'Sales')
  );
  const otherIncome = round2(
    otherIncomeAccounts.reduce((s, a) => s + Math.max(0, a.period_credit - a.period_debit), 0)
  );

  const operatingExpenseAccounts = accountRows.filter(
    (a) =>
      a.account_group === 'Other Expenses' ||
      (a.financial_category === 'Expenses' &&
        a.account_group !== 'Purchases' &&
        a.account_code !== 'EXP-5005')
  );
  const totalExpenses = round2(
    operatingExpenseAccounts.reduce((s, a) => s + Math.max(0, a.period_debit - a.period_credit), 0)
  );

  // COGS: From COGS GL head EXP-5005 + Inventory cost formula fallback
  const cogsAcc = accountRows.find((a) => a.account_code === 'EXP-5005');
  const glCogs = round2(cogsAcc ? Math.max(0, cogsAcc.period_debit - cogsAcc.period_credit) : 0);
  const formulaCogs = round2(
    Math.max(
      0,
      stockClosing.summary.openingInventoryValue +
        netPurchases -
        stockClosing.summary.closingInventoryValue
    )
  );
  const costOfGoodsSold = glCogs > 0 ? glCogs : formulaCogs;

  const grossProfit = round2(netSales - costOfGoodsSold);
  const netProfitLoss = round2(grossProfit + otherIncome - totalExpenses);

  // Customer Receivables & Supplier Payables (carried forward to next period)
  const totalReceivables = round2(
    customerAccounts.reduce((s, a) => s + (a.closing_signed > 0 ? a.closing_signed : 0), 0)
  );
  const customerAdvanceCredits = round2(
    customerAccounts.reduce((s, a) => s + (a.closing_signed < 0 ? Math.abs(a.closing_signed) : 0), 0)
  );
  const netCustomerOutstanding = round2(
    customerAccounts.reduce((s, a) => s + a.closing_signed, 0)
  );

  const totalPayables = round2(
    supplierAccounts.reduce((s, a) => s + (a.closing_signed < 0 ? Math.abs(a.closing_signed) : 0), 0)
  );
  const supplierDebitAdvances = round2(
    supplierAccounts.reduce((s, a) => s + (a.closing_signed > 0 ? a.closing_signed : 0), 0)
  );
  const netSupplierOutstanding = round2(
    supplierAccounts.reduce((s, a) => s + (a.closing_signed < 0 ? Math.abs(a.closing_signed) : -a.closing_signed), 0)
  );

  // Assets, Liabilities, and Equity summary for Monthly / Yearly Balance Sheet Carry-Forward
  const assetAccounts = accountRows.filter((a) => a.financial_category === 'Assets');
  const liabilityAccounts = accountRows.filter((a) => a.financial_category === 'Liabilities');
  const equityAccounts = accountRows.filter((a) => a.financial_category === 'Capital / Equity');

  const totalAssets = round2(
    assetAccounts.reduce((s, a) => s + a.closing_signed, 0) + stockClosing.summary.closingInventoryValue
  );
  const totalLiabilities = round2(
    liabilityAccounts.reduce((s, a) => s + -a.closing_signed, 0)
  );
  const baseEquity = round2(
    equityAccounts.reduce((s, a) => s + -a.closing_signed, 0)
  );

  // Check if an active CLOSED record already exists for this exact type and period
  const existingClosing = db
    .prepare(
      `
      SELECT *
      FROM financial_closings
      WHERE closing_type = ?
        AND DATE(period_start_date) = DATE(?)
        AND DATE(period_end_date) = DATE(?)
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(closingType, startDate, endDate) as Record<string, unknown> | undefined;

  const lockedPeriod = db
    .prepare(
      `
      SELECT *
      FROM accounting_periods
      WHERE is_closed = 1
        AND DATE(start_date) <= DATE(?)
        AND DATE(end_date) >= DATE(?)
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(endDate, startDate) as Record<string, unknown> | undefined;

  return {
    closingType,
    periodName: periodNameOverride || `${startDate} to ${endDate}`,
    periodStartDate: startDate,
    periodEndDate: endDate,
    period_start: startDate,
    period_end: endDate,
    nextPeriodStartDate,
    alreadyClosed: Boolean(existingClosing && existingClosing.status === 'CLOSED'),
    existingClosing: existingClosing
      ? {
          ...existingClosing,
          closed_by_username: existingClosing.closed_by,
          cash_discrepancy_reason: existingClosing.discrepancy_explanation,
        }
      : null,
    existing_closing: existingClosing
      ? {
          ...existingClosing,
          closed_by_username: existingClosing.closed_by,
          cash_discrepancy_reason: existingClosing.discrepancy_explanation,
        }
      : null,
    isPeriodLocked: Boolean(lockedPeriod),
    lockedPeriod: lockedPeriod || null,
    // Flat snake_case convenience properties
    opening_cash: openingCashBalance,
    opening_bank: openingBankBalance,
    cash_sales: cashSales,
    credit_sales: creditSales,
    total_sales: totalSales,
    sales_returns: salesReturns,
    net_sales: netSales,
    cash_purchases: cashPurchases,
    credit_purchases: creditPurchases,
    total_purchases: totalPurchases,
    purchase_returns: purchaseReturns,
    net_purchases: netPurchases,
    cash_receipts: totalCashDebits,
    cash_payments: totalCashCredits,
    expenses: totalExpenses,
    total_expenses: totalExpenses,
    income: otherIncome,
    other_income: otherIncome,
    bank_transactions: {
      deposits: bankReceipts,
      withdrawals: bankPayments,
      net_movement: bankTransactionsNet,
    },
    expected_cash: closingCashBalance,
    closing_cash: closingCashBalance,
    closing_bank: closingBankBalance,
    cash_balance: closingCashBalance,
    bank_balance: closingBankBalance,
    cogs: costOfGoodsSold,
    gross_profit: grossProfit,
    net_profit_loss: netProfitLoss,
    total_receivables: totalReceivables,
    total_payables: totalPayables,
    closing_inventory_qty: stockClosing.summary.closingInventoryQty,
    closing_inventory_value: stockClosing.summary.closingInventoryValue,
    cash_accounts: cashAccounts,
    bank_accounts: bankAccounts,
    customer_carry_forward: customerAccounts,
    supplier_carry_forward: supplierAccounts,
    cash_and_bank_carry_forward: [...cashAccounts, ...bankAccounts],
    financial_account_carry_forward: financialAccounts,
    stock_valuation: {
      items: stockClosing.items,
      totals: stockClosing.summary,
    },
    carry_forward_Verification: {
      next_period_opening_date: nextPeriodStartDate,
    },
    summary: {
      openingCashBalance,
      openingBankBalance,
      cashSales,
      creditSales,
      totalSales,
      salesReturns,
      netSales,
      cashPurchases,
      creditPurchases,
      totalPurchases,
      purchaseReturns,
      netPurchases,
      cashReceipts: cashReceiptsOther,
      cashPayments: cashPaymentsOther,
      totalCashInflows: totalCashDebits,
      totalCashOutflows: totalCashCredits,
      bankReceipts,
      bankPayments,
      bankTransactionsNet,
      totalExpenses,
      otherIncome,
      expectedClosingCash: closingCashBalance,
      closingCashBalance,
      closingBankBalance,
      cash_balance: closingCashBalance,
      bank_balance: closingBankBalance,
      openingInventoryQty: stockClosing.summary.openingInventoryQty,
      openingInventoryValue: stockClosing.summary.openingInventoryValue,
      closingInventoryQty: stockClosing.summary.closingInventoryQty,
      closingInventoryValue: stockClosing.summary.closingInventoryValue,
      costOfGoodsSold,
      grossProfit,
      netProfitLoss,
      totalReceivables,
      customerAdvanceCredits,
      netCustomerOutstanding,
      totalPayables,
      supplierDebitAdvances,
      netSupplierOutstanding,
      totalAssets,
      totalLiabilities,
      baseEquity,
      customerCount: customerAccounts.length,
      supplierCount: supplierAccounts.length,
      stockItemCount: stockClosing.summary.totalItems,
      costingMethod: stockClosing.summary.costingMethod,
      salesInvoiceCount: Number(salesAgg?.invoice_count || 0),
      purchaseInvoiceCount: Number(purchasesAgg?.bill_count || 0),
    },
    cashAndBankAccounts: [...cashAccounts, ...bankAccounts],
    customerCarryForward: customerAccounts,
    supplierCarryForward: supplierAccounts,
    financialAccountCarryForward: financialAccounts,
    incomeAndExpenseSummary: accountRows.filter(
      (a) => a.financial_category === 'Income' || a.financial_category === 'Expenses'
    ),
    stockValuationItems: stockClosing.items,
    stockSummary: stockClosing.summary,
    allAccountsState: accountRows,
  };
}

/**
 * Helper to persist account and stock snapshots for a closing record inside a transaction
 */
function persistClosingSnapshots(
  closingId: number,
  closingCode: string,
  closingType: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'STOCK',
  startDate: string,
  endDate: string,
  nextPeriodStartDate: string,
  accountsToPersist: ComputedAccountPeriodRow[],
  stockItemsToPersist: ComputedStockClosingItem[]
) {
  const db = getDatabase();

  if (accountsToPersist.length > 0) {
    const insertAccSnap = db.prepare(`
      INSERT INTO closing_account_snapshots (
        closing_id, closing_code, closing_type, period_start_date, period_end_date, next_period_start_date,
        account_id, account_code, account_name, main_group, account_group, account_type, financial_category,
        town_name, area_name,
        opening_debit, opening_credit, period_debit, period_credit,
        closing_debit, closing_credit, closing_signed_balance,
        closing_balance_amount, closing_balance_type,
        carried_forward_amount, carried_forward_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const a of accountsToPersist) {
      insertAccSnap.run(
        closingId,
        closingCode,
        closingType,
        startDate,
        endDate,
        nextPeriodStartDate,
        a.account_id,
        a.account_code,
        a.account_name,
        a.main_group,
        a.account_group,
        a.account_type,
        a.financial_category,
        a.town_name,
        a.area_name,
        a.opening_debit,
        a.opening_credit,
        a.period_debit,
        a.period_credit,
        a.closing_debit,
        a.closing_credit,
        a.closing_signed,
        a.closing_balance_amount,
        a.closing_balance_type,
        a.carried_forward_amount,
        a.carried_forward_type
      );
    }
  }

  if (stockItemsToPersist.length > 0) {
    const insertStkSnap = db.prepare(`
      INSERT INTO closing_stock_snapshots (
        closing_id, closing_code, closing_type, period_start_date, period_end_date, next_period_start_date,
        item_id, item_code, item_name, company_name, category, packing,
        opening_qty, purchased_qty, sold_qty, purchase_returns_qty, sales_returns_qty, adjustments_qty,
        closing_qty, unit_cost_rate, trade_price, closing_stock_value, costing_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const st of stockItemsToPersist) {
      insertStkSnap.run(
        closingId,
        closingCode,
        closingType,
        startDate,
        endDate,
        nextPeriodStartDate,
        st.item_id,
        st.item_code,
        st.item_name,
        st.company_name,
        st.category,
        st.packing,
        st.opening_qty,
        st.purchased_qty,
        st.sold_qty,
        st.purchase_returns_qty,
        st.sales_returns_qty,
        st.adjustments_qty,
        st.closing_qty,
        st.unit_cost_rate,
        st.trade_price,
        st.closing_stock_value,
        st.costing_method
      );
    }
  }
}

/**
 * Helper to record closing audit log in closing_audit_logs, protected_audit_logs, and auth_audit_logs
 */
function recordClosingAudit(params: {
  closingId: number | null;
  closingCode: string;
  closingType: string;
  action: string;
  startDate: string;
  endDate: string;
  username: string;
  userRole: string;
  userId?: number | null;
  reason?: string;
  details: Record<string, unknown>;
}) {
  const db = getDatabase();
  const detailsJson = JSON.stringify(params.details || {});

  db.prepare(`
    INSERT INTO closing_audit_logs (
      closing_id, closing_code, closing_type, action,
      period_start_date, period_end_date,
      performed_by, performed_by_role, reason, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.closingId,
    params.closingCode,
    params.closingType,
    params.action,
    params.startDate,
    params.endDate,
    params.username,
    params.userRole,
    params.reason || '',
    detailsJson
  );

  db.prepare(`
    INSERT INTO protected_audit_logs (
      user_id, username, user_role, action, module, record_reference, new_value_json, result, details
    ) VALUES (?, ?, ?, ?, 'CLOSING_MANAGEMENT', ?, ?, 'SUCCESS', ?)
  `).run(
    params.userId || null,
    params.username,
    params.userRole,
    params.action,
    params.closingCode,
    detailsJson,
    params.reason || `${params.action} (${params.startDate} to ${params.endDate})`
  );

  db.prepare(`
    INSERT INTO auth_audit_logs (user_id, username, action, status, details)
    VALUES (?, ?, ?, 'SUCCESS', ?)
  `).run(
    params.userId || null,
    params.username,
    params.action,
    `${params.closingCode} [${params.closingType}] ${params.startDate} to ${params.endDate} — ${params.reason || 'Completed'}`
  );
}

/**
 * Upserts and locks an accounting period in accounting_periods
 */
function lockAccountingPeriod(
  periodName: string,
  periodType: 'MONTHLY' | 'YEARLY',
  startDate: string,
  endDate: string,
  closingId: number,
  closedBy: string,
  notes: string
): number {
  const db = getDatabase();
  const existing = db
    .prepare(
      `
      SELECT id FROM accounting_periods
      WHERE (DATE(start_date) = DATE(?) AND DATE(end_date) = DATE(?))
         OR LOWER(period_name) = LOWER(?)
      LIMIT 1
    `
    )
    .get(startDate, endDate, periodName) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE accounting_periods
      SET period_name = ?,
          period_type = ?,
          start_date = ?,
          end_date = ?,
          is_closed = 1,
          closing_id = ?,
          closed_by = ?,
          closed_at = CURRENT_TIMESTAMP,
          notes = ?
      WHERE id = ?
    `).run(periodName, periodType, startDate, endDate, closingId, closedBy, notes, existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO accounting_periods (
        period_name, period_type, start_date, end_date, is_closed, closing_id, closed_by, closed_at, notes
      ) VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(periodName, periodType, startDate, endDate, closingId, closedBy, notes);
    return Number(res.lastInsertRowid);
  }
}

/**
 * GET /api/closing/overview
 * Dashboard summary for Closing Management workspace
 */
closingRouter.get('/overview', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const settings = db
      .prepare(
        `
        SELECT
          store_name,
          COALESCE(financial_year_start_month, 7) as financial_year_start_month,
          COALESCE(financial_year_start_day, 1) as financial_year_start_day,
          COALESCE(current_financial_year_start, '2025-07-01') as current_financial_year_start,
          COALESCE(current_financial_year_end, '2026-06-30') as current_financial_year_end,
          COALESCE(costing_method, 'Weighted Average / FIFO') as costing_method
        FROM company_settings
        ORDER BY id ASC
        LIMIT 1
      `
      )
      .get() as Record<string, unknown> | undefined;

    const latestByType = db
      .prepare(
        `
        SELECT fc.*
        FROM financial_closings fc
        INNER JOIN (
          SELECT closing_type, MAX(id) as max_id
          FROM financial_closings
          GROUP BY closing_type
        ) latest ON fc.id = latest.max_id
      `
      )
      .all() as Array<Record<string, unknown>>;

    const activeLocks = db
      .prepare(
        `
        SELECT ap.*, fc.closing_code, fc.closing_type, fc.net_profit_loss, fc.closing_cash_balance, fc.closing_inventory_value
        FROM accounting_periods ap
        LEFT JOIN financial_closings fc ON fc.id = ap.closing_id
        WHERE ap.is_closed = 1
        ORDER BY ap.end_date DESC
      `
      )
      .all();

    const allPeriods = db
      .prepare(
        `
        SELECT ap.*, fc.closing_code, fc.closing_type, fc.status as closing_status
        FROM accounting_periods ap
        LEFT JOIN financial_closings fc ON fc.id = ap.closing_id
        ORDER BY ap.start_date DESC
      `
      )
      .all();

    const counts = db
      .prepare(
        `
        SELECT
          COUNT(*) as total_closings,
          SUM(CASE WHEN closing_type = 'DAILY' AND status = 'CLOSED' THEN 1 ELSE 0 END) as daily_closed,
          SUM(CASE WHEN closing_type = 'MONTHLY' AND status = 'CLOSED' THEN 1 ELSE 0 END) as monthly_closed,
          SUM(CASE WHEN closing_type = 'YEARLY' AND status = 'CLOSED' THEN 1 ELSE 0 END) as yearly_closed,
          SUM(CASE WHEN closing_type = 'STOCK' AND status = 'CLOSED' THEN 1 ELSE 0 END) as stock_closed,
          SUM(CASE WHEN status = 'REOPENED' THEN 1 ELSE 0 END) as reopened_count
        FROM financial_closings
      `
      )
      .get();

    const recentAuditLogs = db
      .prepare('SELECT * FROM closing_audit_logs ORDER BY id DESC LIMIT 30')
      .all();

    const companySettingsObj = settings || {
      store_name: 'ABRAR MEDICAL STORE',
      financial_year_start_month: 7,
      financial_year_start_day: 1,
      current_financial_year_start: '2025-07-01',
      current_financial_year_end: '2026-06-30',
      costing_method: 'AVERAGE',
    };

    return res.json({
      success: true,
      financialYearConfig: companySettingsObj,
      company_settings: companySettingsObj,
      latestByType,
      activeLocks,
      locked_periods: activeLocks,
      allPeriods,
      counts,
      recentAuditLogs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/daily/preview
 * Preview Daily Closing calculations for a selected date
 */
closingRouter.get('/daily/preview', (req: Request, res: Response) => {
  try {
    const targetDate = String(req.query.date || new Date().toISOString().slice(0, 10)).trim().slice(0, 10);
    const preview = computeFinancialPeriodClosingPreview(
      targetDate,
      targetDate,
      'DAILY',
      `Daily Closing - ${targetDate}`
    );

    return res.json({
      success: true,
      date: targetDate,
      ...preview,
      preview,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/closing/daily/execute
 * Execute Daily Closing with physical cash verification and mandatory discrepancy explanation
 */
closingRouter.post('/daily/execute', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const targetDate = String(body.date || body.period_start_date || new Date().toISOString().slice(0, 10))
      .trim()
      .slice(0, 10);

    if (body.actual_physical_cash === undefined || body.actual_physical_cash === null || body.actual_physical_cash === '') {
      return res.status(400).json({
        success: false,
        error: 'Actual Physical Cash count is required to complete Daily Closing.',
      });
    }

    const actualPhysicalCash = round2(Number(body.actual_physical_cash));
    if (!Number.isFinite(actualPhysicalCash) || actualPhysicalCash < 0) {
      return res.status(400).json({
        success: false,
        error: 'Actual Physical Cash must be a valid non-negative amount.',
      });
    }

    const discrepancyExplanation = String(body.discrepancy_explanation || '').trim();
    const notes = String(body.notes || '').trim();
    const postDiscrepancyAdjustment = Boolean(body.post_discrepancy_adjustment);
    const username = req.user?.username || 'Super Admin';
    const userRole = req.user?.role || 'Super Admin';
    const userId = req.user?.id || null;

    const preview = computeFinancialPeriodClosingPreview(
      targetDate,
      targetDate,
      'DAILY',
      `Daily Closing - ${targetDate}`
    );

    if (preview.alreadyClosed) {
      return res.status(409).json({
        success: false,
        error: `Duplicate Daily Closing prevented: Date ${targetDate} is already closed under ${preview.existingClosing?.closing_code}.`,
      });
    }

    const expectedCash = round2(preview.summary.expectedClosingCash);
    const cashDifference = round2(actualPhysicalCash - expectedCash);

    if (Math.abs(cashDifference) >= 0.01 && !discrepancyExplanation) {
      return res.status(400).json({
        success: false,
        error: `Cash Discrepancy Detected (Expected: Rs. ${expectedCash.toLocaleString()}, Actual: Rs. ${actualPhysicalCash.toLocaleString()}, Difference: Rs. ${cashDifference.toLocaleString()}). A discrepancy explanation is required.`,
      });
    }

    const closingCode = getNextClosingCode('CLS-DAY');
    let createdClosingId = 0;
    let discrepancyJournalId: number | null = null;

    const tx = db.transaction(() => {
      // Optional: if user requested posting physical cash adjustment to Cash & Adjustment Income/Expense GL
      if (postDiscrepancyAdjustment && Math.abs(cashDifference) >= 0.01) {
        const cashAcc = db
          .prepare("SELECT id FROM accounts WHERE account_code = 'FIN-1010' OR account_group = 'Cash' ORDER BY id ASC LIMIT 1")
          .get() as { id: number } | undefined;
        const surplusAcc = db
          .prepare("SELECT id FROM accounts WHERE account_code = 'ADJ-4035' LIMIT 1")
          .get() as { id: number } | undefined;
        const shortageAcc = db
          .prepare("SELECT id FROM accounts WHERE account_code = 'ADJ-5035' LIMIT 1")
          .get() as { id: number } | undefined;

        if (cashAcc && surplusAcc && shortageAcc) {
          const absDiff = round2(Math.abs(cashDifference));
          const jeNo = `JE-DAY-${closingCode}`;
          const jeDesc = `Daily Closing ${closingCode} Physical Cash Reconciliation (${cashDifference > 0 ? 'Surplus' : 'Shortage'}): ${discrepancyExplanation}`;
          const jeRes = db
            .prepare(`
              INSERT INTO journal_entries (
                entry_number, entry_date, reference_type, reference_id, description,
                total_debit, total_credit, is_balanced, status
              ) VALUES (?, ?, 'ADJUSTMENT', 0, ?, ?, ?, 1, 'posted')
            `)
            .run(jeNo, targetDate, jeDesc, absDiff, absDiff);
          discrepancyJournalId = Number(jeRes.lastInsertRowid);

          const insLine = db.prepare(`
            INSERT INTO journal_entry_lines (
              journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
            ) VALUES (?, ?, 'general', ?, ?, ?)
          `);

          if (cashDifference > 0) {
            insLine.run(discrepancyJournalId, cashAcc.id, absDiff, 0, jeDesc);
            insLine.run(discrepancyJournalId, surplusAcc.id, 0, absDiff, jeDesc);
            recalculateAccountBalance(cashAcc.id);
            recalculateAccountBalance(surplusAcc.id);
          } else {
            insLine.run(discrepancyJournalId, shortageAcc.id, absDiff, 0, jeDesc);
            insLine.run(discrepancyJournalId, cashAcc.id, 0, absDiff, jeDesc);
            recalculateAccountBalance(shortageAcc.id);
            recalculateAccountBalance(cashAcc.id);
          }
        }
      }

      const finalClosingCash = postDiscrepancyAdjustment ? actualPhysicalCash : expectedCash;

      const snapshotPayload = {
        summary: {
          ...preview.summary,
          expectedClosingCash: expectedCash,
          actualPhysicalCash,
          cashDifference,
          discrepancyExplanation,
          closingCashBalance: finalClosingCash,
        },
        cashAndBankAccounts: preview.cashAndBankAccounts,
        incomeAndExpenseSummary: preview.incomeAndExpenseSummary,
      };

      const insertRes = db
        .prepare(`
          INSERT INTO financial_closings (
            closing_code, closing_type, period_name, period_start_date, period_end_date, next_period_start_date,
            status, is_locked,
            opening_cash_balance, opening_bank_balance,
            cash_sales, credit_sales, total_sales, sales_returns, net_sales,
            cash_purchases, credit_purchases, total_purchases, purchase_returns, net_purchases,
            cash_receipts, cash_payments, bank_receipts, bank_payments, bank_transactions_net,
            total_expenses, other_income,
            expected_closing_cash, actual_physical_cash, cash_difference, discrepancy_explanation,
            closing_cash_balance, closing_bank_balance,
            opening_inventory_qty, opening_inventory_value,
            closing_inventory_qty, closing_inventory_value,
            cost_of_goods_sold, gross_profit, net_profit_loss,
            total_receivables, total_payables,
            customer_count, supplier_count, stock_item_count,
            costing_method, carry_forward_completed, discrepancy_journal_id,
            notes, snapshot_json, closed_by, closed_by_role
          ) VALUES (
            ?, 'DAILY', ?, ?, ?, ?,
            'CLOSED', 0,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, 1, ?,
            ?, ?, ?, ?
          )
        `)
        .run(
          closingCode,
          `Daily Closing - ${targetDate}`,
          targetDate,
          targetDate,
          preview.nextPeriodStartDate,
          preview.summary.openingCashBalance,
          preview.summary.openingBankBalance,
          preview.summary.cashSales,
          preview.summary.creditSales,
          preview.summary.totalSales,
          preview.summary.salesReturns,
          preview.summary.netSales,
          preview.summary.cashPurchases,
          preview.summary.creditPurchases,
          preview.summary.totalPurchases,
          preview.summary.purchaseReturns,
          preview.summary.netPurchases,
          preview.summary.cashReceipts,
          preview.summary.cashPayments,
          preview.summary.bankReceipts,
          preview.summary.bankPayments,
          preview.summary.bankTransactionsNet,
          preview.summary.totalExpenses,
          preview.summary.otherIncome,
          expectedCash,
          actualPhysicalCash,
          cashDifference,
          discrepancyExplanation,
          finalClosingCash,
          preview.summary.closingBankBalance,
          preview.summary.openingInventoryQty,
          preview.summary.openingInventoryValue,
          preview.summary.closingInventoryQty,
          preview.summary.closingInventoryValue,
          preview.summary.costOfGoodsSold,
          preview.summary.grossProfit,
          preview.summary.netProfitLoss,
          preview.summary.totalReceivables,
          preview.summary.totalPayables,
          preview.summary.customerCount,
          preview.summary.supplierCount,
          preview.summary.stockItemCount,
          preview.summary.costingMethod,
          discrepancyJournalId,
          notes,
          JSON.stringify(snapshotPayload),
          username,
          userRole
        );

      createdClosingId = Number(insertRes.lastInsertRowid);

      if (discrepancyJournalId) {
        db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(
          createdClosingId,
          discrepancyJournalId
        );
      }

      persistClosingSnapshots(
        createdClosingId,
        closingCode,
        'DAILY',
        targetDate,
        targetDate,
        preview.nextPeriodStartDate,
        preview.cashAndBankAccounts,
        []
      );

      recordClosingAudit({
        closingId: createdClosingId,
        closingCode,
        closingType: 'DAILY',
        action: 'DAILY_CLOSING_COMPLETED',
        startDate: targetDate,
        endDate: targetDate,
        username,
        userRole,
        userId,
        reason: discrepancyExplanation || 'Daily cash & bank reconciliation completed',
        details: {
          date: targetDate,
          expectedCash,
          actualPhysicalCash,
          cashDifference,
          discrepancyExplanation,
          closingBankBalance: preview.summary.closingBankBalance,
        },
      });
    });

    tx();

    const created = db.prepare('SELECT * FROM financial_closings WHERE id = ?').get(createdClosingId);

    return res.status(201).json({
      success: true,
      message: `Daily Closing ${closingCode} for ${targetDate} completed successfully.`,
      closing_id: createdClosingId,
      closing_code: closingCode,
      closing: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/monthly/preview
 * Preview Monthly Financial Closing & Carry-Forward balances
 */
closingRouter.get('/monthly/preview', (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month ? String(req.query.month) : undefined;
    const { startDate: defaultStart, endDate: defaultEnd, periodName: defaultName } = getMonthDateRange(monthParam);

    const startDate = String(req.query.startDate || req.query.start_date || defaultStart).trim().slice(0, 10);
    const endDate = String(req.query.endDate || req.query.end_date || defaultEnd).trim().slice(0, 10);
    const periodName = String(req.query.periodName || defaultName).trim();

    const preview = computeFinancialPeriodClosingPreview(startDate, endDate, 'MONTHLY', periodName);

    return res.json({
      success: true,
      month: monthParam || startDate.slice(0, 7),
      ...preview,
      preview,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/closing/monthly/execute
 * Execute Monthly Financial Closing, Carry Forward all Customer/Supplier/Cash/Bank/Financial/Stock balances,
 * and lock the closed period.
 */
closingRouter.post('/monthly/execute', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const monthParam = body.month ? String(body.month) : undefined;
    const { startDate: defaultStart, endDate: defaultEnd, periodName: defaultName } = getMonthDateRange(monthParam);

    const startDate = String(body.start_date || body.startDate || defaultStart).trim().slice(0, 10);
    const endDate = String(body.end_date || body.endDate || defaultEnd).trim().slice(0, 10);
    const periodName = String(body.period_name || body.periodName || defaultName).trim();
    const lockPeriod = body.lock_period !== undefined ? Boolean(body.lock_period) : true;
    const notes = String(body.notes || '').trim();
    const username = req.user?.username || 'Super Admin';
    const userRole = req.user?.role || 'Super Admin';
    const userId = req.user?.id || null;

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: 'Period Start Date cannot be after Period End Date.',
      });
    }

    // Never allow locking a period whose start date is strictly in the future
    const todayIso = new Date().toISOString().slice(0, 10);
    if (lockPeriod && startDate > todayIso) {
      return res.status(400).json({
        success: false,
        error: `Cannot lock a future period (${startDate} to ${endDate}). Future periods must remain open.`,
      });
    }

    const preview = computeFinancialPeriodClosingPreview(startDate, endDate, 'MONTHLY', periodName);
    if (preview.alreadyClosed) {
      return res.status(409).json({
        success: false,
        error: `Duplicate Monthly Closing prevented: Period "${periodName}" (${startDate} to ${endDate}) is already closed under ${preview.existingClosing?.closing_code}.`,
      });
    }

    triggerPreChangeBackupIfEnabled(`Monthly Closing ${periodName} (${startDate} to ${endDate})`, username);

    const closingCode = getNextClosingCode('CLS-MON');
    let createdClosingId = 0;
    let accountingPeriodId: number | null = null;

    const tx = db.transaction(() => {
      // 1. Synchronize all account current_balance fields so ledger & party balances are 100% accurate
      const allAccIds = db.prepare('SELECT id FROM accounts').all() as Array<{ id: number }>;
      for (const a of allAccIds) {
        recalculateAccountBalance(a.id);
      }

      const snapshotPayload = {
        summary: preview.summary,
        cashAndBankAccounts: preview.cashAndBankAccounts,
        customerCarryForwardCount: preview.customerCarryForward.length,
        supplierCarryForwardCount: preview.supplierCarryForward.length,
        financialAccountCarryForwardCount: preview.financialAccountCarryForward.length,
        stockSummary: preview.stockSummary,
        incomeAndExpenseSummary: preview.incomeAndExpenseSummary,
      };

      // 2. Insert financial_closings master record
      const insertRes = db
        .prepare(`
          INSERT INTO financial_closings (
            closing_code, closing_type, period_name, period_start_date, period_end_date, next_period_start_date,
            status, is_locked,
            opening_cash_balance, opening_bank_balance,
            cash_sales, credit_sales, total_sales, sales_returns, net_sales,
            cash_purchases, credit_purchases, total_purchases, purchase_returns, net_purchases,
            cash_receipts, cash_payments, bank_receipts, bank_payments, bank_transactions_net,
            total_expenses, other_income,
            expected_closing_cash, actual_physical_cash, cash_difference, discrepancy_explanation,
            closing_cash_balance, closing_bank_balance,
            opening_inventory_qty, opening_inventory_value,
            closing_inventory_qty, closing_inventory_value,
            cost_of_goods_sold, gross_profit, net_profit_loss,
            total_receivables, total_payables,
            customer_count, supplier_count, stock_item_count,
            costing_method, carry_forward_completed,
            notes, snapshot_json, closed_by, closed_by_role
          ) VALUES (
            ?, 'MONTHLY', ?, ?, ?, ?,
            'CLOSED', ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, 0.0, '',
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, 1,
            ?, ?, ?, ?
          )
        `)
        .run(
          closingCode,
          periodName,
          startDate,
          endDate,
          preview.nextPeriodStartDate,
          lockPeriod ? 1 : 0,
          preview.summary.openingCashBalance,
          preview.summary.openingBankBalance,
          preview.summary.cashSales,
          preview.summary.creditSales,
          preview.summary.totalSales,
          preview.summary.salesReturns,
          preview.summary.netSales,
          preview.summary.cashPurchases,
          preview.summary.creditPurchases,
          preview.summary.totalPurchases,
          preview.summary.purchaseReturns,
          preview.summary.netPurchases,
          preview.summary.cashReceipts,
          preview.summary.cashPayments,
          preview.summary.bankReceipts,
          preview.summary.bankPayments,
          preview.summary.bankTransactionsNet,
          preview.summary.totalExpenses,
          preview.summary.otherIncome,
          preview.summary.closingCashBalance,
          preview.summary.closingCashBalance,
          preview.summary.closingCashBalance,
          preview.summary.closingBankBalance,
          preview.summary.openingInventoryQty,
          preview.summary.openingInventoryValue,
          preview.summary.closingInventoryQty,
          preview.summary.closingInventoryValue,
          preview.summary.costOfGoodsSold,
          preview.summary.grossProfit,
          preview.summary.netProfitLoss,
          preview.summary.totalReceivables,
          preview.summary.totalPayables,
          preview.summary.customerCount,
          preview.summary.supplierCount,
          preview.summary.stockItemCount,
          preview.summary.costingMethod,
          notes,
          JSON.stringify(snapshotPayload),
          username,
          userRole
        );

      createdClosingId = Number(insertRes.lastInsertRowid);

      // 3. Persist immutable carry-forward snapshots for ALL accounts and ALL stock items
      persistClosingSnapshots(
        createdClosingId,
        closingCode,
        'MONTHLY',
        startDate,
        endDate,
        preview.nextPeriodStartDate,
        preview.allAccountsState,
        preview.stockValuationItems
      );

      // 4. Lock the closed accounting period if requested
      if (lockPeriod) {
        accountingPeriodId = lockAccountingPeriod(
          periodName,
          'MONTHLY',
          startDate,
          endDate,
          createdClosingId,
          username,
          `Locked by Monthly Closing ${closingCode}`
        );
        db.prepare('UPDATE financial_closings SET accounting_period_id = ? WHERE id = ?').run(
          accountingPeriodId,
          createdClosingId
        );
      }

      // 5. Record complete audit log
      recordClosingAudit({
        closingId: createdClosingId,
        closingCode,
        closingType: 'MONTHLY',
        action: 'MONTHLY_CLOSING_COMPLETED',
        startDate,
        endDate,
        username,
        userRole,
        userId,
        reason: notes || `Monthly Closing & Balance Carry-Forward completed for ${periodName}`,
        details: {
          periodName,
          nextPeriodStartDate: preview.nextPeriodStartDate,
          totalSales: preview.summary.totalSales,
          totalPurchases: preview.summary.totalPurchases,
          grossProfit: preview.summary.grossProfit,
          netProfitLoss: preview.summary.netProfitLoss,
          closingCashBalance: preview.summary.closingCashBalance,
          closingBankBalance: preview.summary.closingBankBalance,
          totalReceivables: preview.summary.totalReceivables,
          totalPayables: preview.summary.totalPayables,
          closingInventoryQty: preview.summary.closingInventoryQty,
          closingInventoryValue: preview.summary.closingInventoryValue,
          periodLocked: lockPeriod,
        },
      });
    });

    tx();

    const created = db.prepare('SELECT * FROM financial_closings WHERE id = ?').get(createdClosingId);

    return res.status(201).json({
      success: true,
      message: `Monthly Closing ${closingCode} (${periodName}) completed. All Customer, Supplier, Cash, Bank, Financial, and Inventory balances carried forward to ${preview.nextPeriodStartDate}.`,
      closing_id: createdClosingId,
      closing_code: closingCode,
      summary: preview.summary,
      closing: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/stock/preview
 * Preview Stock Closing & Item-by-Item Valuation for a selected period
 */
closingRouter.get('/stock/preview', (req: Request, res: Response) => {
  try {
    const { startDate: defaultStart, endDate: defaultEnd } = getMonthDateRange();
    const startDate = String(req.query.startDate || req.query.start_date || defaultStart).trim().slice(0, 10);
    const endDate = String(req.query.endDate || req.query.end_date || defaultEnd).trim().slice(0, 10);

    const stockClosing = computePeriodStockClosing(startDate, endDate);
    const db = getDatabase();
    const existingClosing = db
      .prepare(
        `
        SELECT * FROM financial_closings
        WHERE closing_type = 'STOCK'
          AND DATE(period_start_date) = DATE(?)
          AND DATE(period_end_date) = DATE(?)
        ORDER BY id DESC LIMIT 1
      `
      )
      .get(startDate, endDate) as Record<string, unknown> | undefined;

    return res.json({
      success: true,
      periodStartDate: startDate,
      periodEndDate: endDate,
      period_start: startDate,
      period_end: endDate,
      nextPeriodStartDate: addDaysIso(endDate, 1),
      alreadyClosed: Boolean(existingClosing && existingClosing.status === 'CLOSED'),
      existingClosing: existingClosing || null,
      existing_closing: existingClosing
        ? { ...existingClosing, closed_by_username: existingClosing.closed_by }
        : null,
      summary: stockClosing.summary,
      totals: stockClosing.summary,
      items: stockClosing.items,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/closing/stock/execute
 * Execute Stock Closing, persist item-by-item valuation snapshot, and prevent duplicate stock closing
 */
closingRouter.post('/stock/execute', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const { startDate: defaultStart, endDate: defaultEnd } = getMonthDateRange();
    const startDate = String(body.start_date || body.startDate || defaultStart).trim().slice(0, 10);
    const endDate = String(body.end_date || body.endDate || defaultEnd).trim().slice(0, 10);
    const periodName = String(body.period_name || body.periodName || `Stock Closing (${startDate} to ${endDate})`).trim();
    const notes = String(body.notes || '').trim();
    const username = req.user?.username || 'Super Admin';
    const userRole = req.user?.role || 'Super Admin';
    const userId = req.user?.id || null;

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start Date cannot be after End Date.',
      });
    }

    const existing = db
      .prepare(
        `
        SELECT * FROM financial_closings
        WHERE closing_type = 'STOCK'
          AND status = 'CLOSED'
          AND DATE(period_start_date) = DATE(?)
          AND DATE(period_end_date) = DATE(?)
        LIMIT 1
      `
      )
      .get(startDate, endDate) as Record<string, unknown> | undefined;

    if (existing) {
      return res.status(409).json({
        success: false,
        error: `Duplicate Stock Closing prevented: Stock closing for ${startDate} to ${endDate} is already recorded under ${existing.closing_code}.`,
      });
    }

    const stockClosing = computePeriodStockClosing(startDate, endDate);
    const nextPeriodStartDate = addDaysIso(endDate, 1);
    const closingCode = getNextClosingCode('CLS-STK');
    let createdClosingId = 0;

    const tx = db.transaction(() => {
      const insertRes = db
        .prepare(`
          INSERT INTO financial_closings (
            closing_code, closing_type, period_name, period_start_date, period_end_date, next_period_start_date,
            status, is_locked,
            opening_inventory_qty, opening_inventory_value,
            closing_inventory_qty, closing_inventory_value,
            stock_item_count, costing_method, carry_forward_completed,
            notes, snapshot_json, closed_by, closed_by_role
          ) VALUES (
            ?, 'STOCK', ?, ?, ?, ?,
            'CLOSED', 0,
            ?, ?,
            ?, ?,
            ?, ?, 1,
            ?, ?, ?, ?
          )
        `)
        .run(
          closingCode,
          periodName,
          startDate,
          endDate,
          nextPeriodStartDate,
          stockClosing.summary.openingInventoryQty,
          stockClosing.summary.openingInventoryValue,
          stockClosing.summary.closingInventoryQty,
          stockClosing.summary.closingInventoryValue,
          stockClosing.summary.totalItems,
          stockClosing.summary.costingMethod,
          notes,
          JSON.stringify({ summary: stockClosing.summary }),
          username,
          userRole
        );

      createdClosingId = Number(insertRes.lastInsertRowid);

      persistClosingSnapshots(
        createdClosingId,
        closingCode,
        'STOCK',
        startDate,
        endDate,
        nextPeriodStartDate,
        [],
        stockClosing.items
      );

      recordClosingAudit({
        closingId: createdClosingId,
        closingCode,
        closingType: 'STOCK',
        action: 'STOCK_CLOSING_COMPLETED',
        startDate,
        endDate,
        username,
        userRole,
        userId,
        reason: notes || `Stock Closing & Valuation completed (${stockClosing.summary.totalItems} items)`,
        details: {
          ...stockClosing.summary,
          nextPeriodStartDate,
        },
      });
    });

    tx();

    const created = db.prepare('SELECT * FROM financial_closings WHERE id = ?').get(createdClosingId);

    return res.status(201).json({
      success: true,
      message: `Stock Closing ${closingCode} completed. ${stockClosing.summary.totalItems} medicine items valued at Rs. ${stockClosing.summary.closingInventoryValue.toLocaleString()} and carried forward to ${nextPeriodStartDate}.`,
      closing_id: createdClosingId,
      closing_code: closingCode,
      closing: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/yearly/preview
 * Preview Yearly Financial Closing & Next Financial Year Opening Balance Generation
 */
closingRouter.get('/yearly/preview', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const settings = db
      .prepare(
        `
        SELECT
          COALESCE(current_financial_year_start, '2025-07-01') as current_financial_year_start,
          COALESCE(current_financial_year_end, '2026-06-30') as current_financial_year_end
        FROM company_settings
        ORDER BY id ASC LIMIT 1
      `
      )
      .get() as { current_financial_year_start: string; current_financial_year_end: string } | undefined;

    const startDate = String(
      req.query.startDate || req.query.start_date || settings?.current_financial_year_start || '2025-07-01'
    )
      .trim()
      .slice(0, 10);
    const endDate = String(
      req.query.endDate || req.query.end_date || settings?.current_financial_year_end || '2026-06-30'
    )
      .trim()
      .slice(0, 10);
    const periodName = String(req.query.periodName || `FY ${startDate} to ${endDate}`).trim();

    const preview = computeFinancialPeriodClosingPreview(startDate, endDate, 'YEARLY', periodName);

    return res.json({
      success: true,
      financialYearConfig: settings,
      ...preview,
      preview,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/closing/financial-year-config
 * Update configurable Financial Year start and end dates in company_settings
 */
closingRouter.put('/financial-year-config', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const startDate = String(body.current_financial_year_start || body.startDate || '2025-07-01').trim().slice(0, 10);
    const endDate = String(body.current_financial_year_end || body.endDate || '2026-06-30').trim().slice(0, 10);
    const costingMethod = String(body.costing_method || 'Weighted Average / FIFO').trim();

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        error: 'Financial Year Start Date must be before End Date.',
      });
    }

    const [, mStr, dStr] = startDate.split('-');
    const startMonth = Math.max(1, Math.min(12, parseInt(mStr, 10) || 7));
    const startDay = Math.max(1, Math.min(31, parseInt(dStr, 10) || 1));

    db.prepare(`
      UPDATE company_settings
      SET financial_year_start_month = ?,
          financial_year_start_day = ?,
          current_financial_year_start = ?,
          current_financial_year_end = ?,
          costing_method = ?,
          updated_at = CURRENT_TIMESTAMP
    `).run(startMonth, startDay, startDate, endDate, costingMethod);

    const updated = db
      .prepare(
        `
        SELECT
          financial_year_start_month,
          financial_year_start_day,
          current_financial_year_start,
          current_financial_year_end,
          costing_method
        FROM company_settings
        ORDER BY id ASC LIMIT 1
      `
      )
      .get();

    return res.json({
      success: true,
      message: `Financial Year dates configured to ${startDate} — ${endDate}.`,
      financialYearConfig: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * POST /api/closing/yearly/execute
 * Execute Yearly Financial Closing, Carry Forward all Assets, Liabilities, Equity (with Net Profit/Loss retained),
 * Customer balances, Supplier balances, and Stock balances into the Next Financial Year, and lock the closed year.
 */
closingRouter.post('/yearly/execute', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const settings = db
      .prepare(
        `
        SELECT
          COALESCE(current_financial_year_start, '2025-07-01') as current_financial_year_start,
          COALESCE(current_financial_year_end, '2026-06-30') as current_financial_year_end
        FROM company_settings
        ORDER BY id ASC LIMIT 1
      `
      )
      .get() as { current_financial_year_start: string; current_financial_year_end: string } | undefined;

    const startDate = String(body.start_date || body.startDate || settings?.current_financial_year_start || '2025-07-01')
      .trim()
      .slice(0, 10);
    const endDate = String(body.end_date || body.endDate || settings?.current_financial_year_end || '2026-06-30')
      .trim()
      .slice(0, 10);
    const periodName = String(body.period_name || body.periodName || `Financial Year ${startDate} to ${endDate}`).trim();
    const lockPeriod = body.lock_period !== undefined ? Boolean(body.lock_period) : true;
    const advanceFinancialYearDates = Boolean(body.advance_financial_year_dates);
    const notes = String(body.notes || '').trim();
    const username = req.user?.username || 'Super Admin';
    const userRole = req.user?.role || 'Super Admin';
    const userId = req.user?.id || null;

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        error: 'Financial Year Start Date must be before End Date.',
      });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (lockPeriod && startDate > todayIso) {
      return res.status(400).json({
        success: false,
        error: `Cannot lock a future financial year (${startDate} to ${endDate}).`,
      });
    }

    const preview = computeFinancialPeriodClosingPreview(startDate, endDate, 'YEARLY', periodName);
    if (preview.alreadyClosed) {
      return res.status(409).json({
        success: false,
        error: `Duplicate Yearly Closing prevented: Financial Year "${periodName}" (${startDate} to ${endDate}) is already closed under ${preview.existingClosing?.closing_code}.`,
      });
    }

    triggerPreChangeBackupIfEnabled(`Yearly Closing ${periodName} (${startDate} to ${endDate})`, username);

    const closingCode = getNextClosingCode('CLS-YRL');
    let createdClosingId = 0;
    let accountingPeriodId: number | null = null;

    const tx = db.transaction(() => {
      // 1. Synchronize all account current_balance fields
      const allAccIds = db.prepare('SELECT id FROM accounts').all() as Array<{ id: number }>;
      for (const a of allAccIds) {
        recalculateAccountBalance(a.id);
      }

      const snapshotPayload = {
        summary: preview.summary,
        cashAndBankAccounts: preview.cashAndBankAccounts,
        customerCarryForwardCount: preview.customerCarryForward.length,
        supplierCarryForwardCount: preview.supplierCarryForward.length,
        financialAccountCarryForwardCount: preview.financialAccountCarryForward.length,
        stockSummary: preview.stockSummary,
        incomeAndExpenseSummary: preview.incomeAndExpenseSummary,
        retainedEarningsTransfer: {
          targetAccountCode: 'EQT-3030',
          targetAccountName: 'Retained Earnings & Period Profit/Loss Summary',
          annualNetProfitLoss: preview.summary.netProfitLoss,
          nextFinancialYearStart: preview.nextPeriodStartDate,
        },
      };

      const insertRes = db
        .prepare(`
          INSERT INTO financial_closings (
            closing_code, closing_type, period_name, period_start_date, period_end_date, next_period_start_date,
            status, is_locked,
            opening_cash_balance, opening_bank_balance,
            cash_sales, credit_sales, total_sales, sales_returns, net_sales,
            cash_purchases, credit_purchases, total_purchases, purchase_returns, net_purchases,
            cash_receipts, cash_payments, bank_receipts, bank_payments, bank_transactions_net,
            total_expenses, other_income,
            expected_closing_cash, actual_physical_cash, cash_difference, discrepancy_explanation,
            closing_cash_balance, closing_bank_balance,
            opening_inventory_qty, opening_inventory_value,
            closing_inventory_qty, closing_inventory_value,
            cost_of_goods_sold, gross_profit, net_profit_loss,
            total_receivables, total_payables,
            customer_count, supplier_count, stock_item_count,
            costing_method, carry_forward_completed,
            notes, snapshot_json, closed_by, closed_by_role
          ) VALUES (
            ?, 'YEARLY', ?, ?, ?, ?,
            'CLOSED', ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, 0.0, '',
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, 1,
            ?, ?, ?, ?
          )
        `)
        .run(
          closingCode,
          periodName,
          startDate,
          endDate,
          preview.nextPeriodStartDate,
          lockPeriod ? 1 : 0,
          preview.summary.openingCashBalance,
          preview.summary.openingBankBalance,
          preview.summary.cashSales,
          preview.summary.creditSales,
          preview.summary.totalSales,
          preview.summary.salesReturns,
          preview.summary.netSales,
          preview.summary.cashPurchases,
          preview.summary.creditPurchases,
          preview.summary.totalPurchases,
          preview.summary.purchaseReturns,
          preview.summary.netPurchases,
          preview.summary.cashReceipts,
          preview.summary.cashPayments,
          preview.summary.bankReceipts,
          preview.summary.bankPayments,
          preview.summary.bankTransactionsNet,
          preview.summary.totalExpenses,
          preview.summary.otherIncome,
          preview.summary.closingCashBalance,
          preview.summary.closingCashBalance,
          preview.summary.closingCashBalance,
          preview.summary.closingBankBalance,
          preview.summary.openingInventoryQty,
          preview.summary.openingInventoryValue,
          preview.summary.closingInventoryQty,
          preview.summary.closingInventoryValue,
          preview.summary.costOfGoodsSold,
          preview.summary.grossProfit,
          preview.summary.netProfitLoss,
          preview.summary.totalReceivables,
          preview.summary.totalPayables,
          preview.summary.customerCount,
          preview.summary.supplierCount,
          preview.summary.stockItemCount,
          preview.summary.costingMethod,
          notes,
          JSON.stringify(snapshotPayload),
          username,
          userRole
        );

      createdClosingId = Number(insertRes.lastInsertRowid);

      // Update EQT-3030 carry-forward in snapshot so Retained Earnings explicitly shows the annual profit/loss transfer
      const accountsWithProfitTransfer = preview.allAccountsState.map((a) => {
        if (a.account_code === 'EQT-3030') {
          const newSigned = round2(a.closing_signed - preview.summary.netProfitLoss);
          return {
            ...a,
            carried_forward_amount: round2(Math.abs(newSigned)),
            carried_forward_type: (newSigned <= 0 ? 'Credit' : 'Debit') as 'Debit' | 'Credit',
          };
        }
        return a;
      });

      persistClosingSnapshots(
        createdClosingId,
        closingCode,
        'YEARLY',
        startDate,
        endDate,
        preview.nextPeriodStartDate,
        accountsWithProfitTransfer,
        preview.stockValuationItems
      );

      if (lockPeriod) {
        accountingPeriodId = lockAccountingPeriod(
          periodName,
          'YEARLY',
          startDate,
          endDate,
          createdClosingId,
          username,
          `Locked by Yearly Closing ${closingCode}`
        );
        db.prepare('UPDATE financial_closings SET accounting_period_id = ? WHERE id = ?').run(
          accountingPeriodId,
          createdClosingId
        );
      }

      if (advanceFinancialYearDates) {
        const nextStart = preview.nextPeriodStartDate;
        const [ny, nm, nd] = nextStart.split('-').map((n) => parseInt(n, 10));
        const nextEndDt = new Date(Date.UTC(ny + 1, nm - 1, nd - 1));
        const nextEnd = nextEndDt.toISOString().slice(0, 10);
        db.prepare(`
          UPDATE company_settings
          SET current_financial_year_start = ?,
              current_financial_year_end = ?,
              updated_at = CURRENT_TIMESTAMP
        `).run(nextStart, nextEnd);
      }

      recordClosingAudit({
        closingId: createdClosingId,
        closingCode,
        closingType: 'YEARLY',
        action: 'YEARLY_CLOSING_COMPLETED',
        startDate,
        endDate,
        username,
        userRole,
        userId,
        reason: notes || `Yearly Closing & Next FY Opening Balance Generation completed for ${periodName}`,
        details: {
          periodName,
          nextPeriodStartDate: preview.nextPeriodStartDate,
          totalSales: preview.summary.totalSales,
          totalPurchases: preview.summary.totalPurchases,
          grossProfit: preview.summary.grossProfit,
          netProfitLoss: preview.summary.netProfitLoss,
          closingCashBalance: preview.summary.closingCashBalance,
          closingBankBalance: preview.summary.closingBankBalance,
          totalReceivables: preview.summary.totalReceivables,
          totalPayables: preview.summary.totalPayables,
          closingInventoryValue: preview.summary.closingInventoryValue,
          periodLocked: lockPeriod,
        },
      });
    });

    tx();

    const created = db.prepare('SELECT * FROM financial_closings WHERE id = ?').get(createdClosingId);

    return res.status(201).json({
      success: true,
      message: `Yearly Closing ${closingCode} (${periodName}) completed. Annual Profit/Loss transferred and all Asset, Liability, Customer, Supplier, Cash, Bank, and Inventory balances carried forward to ${preview.nextPeriodStartDate}.`,
      closing_id: createdClosingId,
      closing_code: closingCode,
      next_financial_year: {
        start_date: preview.nextPeriodStartDate,
        end_date: addDaysIso(preview.nextPeriodStartDate, 364),
      },
      closing: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/history
 * Searchable & filterable Closing History table + audit trail
 */
closingRouter.get('/history', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { closingType, closing_type, status, startDate, start_date, endDate, end_date, q, search } = req.query;

    let sql = `
      SELECT *
      FROM financial_closings
      WHERE 1=1
    `;
    const params: Array<string | number> = [];

    const effType = closingType || closing_type;
    if (effType && effType !== 'ALL') {
      sql += ' AND closing_type = ? ';
      params.push(String(effType).toUpperCase());
    }
    if (status && status !== 'ALL') {
      sql += ' AND status = ? ';
      params.push(String(status).toUpperCase());
    }
    const effStart = startDate || start_date;
    if (effStart) {
      sql += ' AND DATE(period_end_date) >= DATE(?) ';
      params.push(String(effStart).slice(0, 10));
    }
    const effEnd = endDate || end_date;
    if (effEnd) {
      sql += ' AND DATE(period_start_date) <= DATE(?) ';
      params.push(String(effEnd).slice(0, 10));
    }
    const effQ = q || search;
    if (effQ && String(effQ).trim() !== '') {
      const term = `%${String(effQ).trim()}%`;
      sql += ' AND (closing_code LIKE ? OR period_name LIKE ? OR closed_by LIKE ? OR notes LIKE ? OR discrepancy_explanation LIKE ?) ';
      params.push(term, term, term, term, term);
    }

    sql += ' ORDER BY id DESC ';
    const rawClosings = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    const closings = rawClosings.map((c) => ({
      ...c,
      period_start: c.period_start_date,
      period_end: c.period_end_date,
      closed_by_username: c.closed_by,
      reopened_by_username: c.reopened_by,
      opening_cash: c.opening_cash_balance,
      closing_cash: c.closing_cash_balance,
      closing_bank: c.closing_bank_balance,
      closing_stock_value: c.closing_inventory_value,
    }));

    const rawAuditLogs = db
      .prepare('SELECT * FROM closing_audit_logs ORDER BY id DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
    const auditLogs = rawAuditLogs.map((l) => ({
      ...l,
      period_start: l.period_start_date,
      period_end: l.period_end_date,
      performed_by_username: l.performed_by,
    }));

    const periods = db
      .prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC')
      .all();

    return res.json({
      success: true,
      count: closings.length,
      closings,
      items: closings,
      periods,
      auditLogs,
      audit_logs: auditLogs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/closing/history/:id
 * Full details of a historical closing record including all account carry-forward snapshots,
 * item stock valuation snapshots, audit logs, and next-period opening balance verification.
 */
closingRouter.get('/history/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const closing = db
      .prepare('SELECT * FROM financial_closings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!closing) {
      return res.status(404).json({ success: false, error: 'Closing record not found.' });
    }

    const rawAccountSnapshots = db
      .prepare('SELECT * FROM closing_account_snapshots WHERE closing_id = ? ORDER BY account_code ASC')
      .all(id) as Array<Record<string, unknown>>;

    const accountSnapshots = rawAccountSnapshots.map((a) => {
      const grp = String(a.account_group || '');
      const typ = String(a.account_type || '');
      let snapshotGroup = 'FINANCIAL';
      if (grp === 'Customer' || typ === 'Customer' || typ === 'Customer & Supplier') {
        snapshotGroup = 'CUSTOMER';
      } else if (grp === 'Supplier' || typ === 'Supplier') {
        snapshotGroup = 'SUPPLIER';
      } else if (grp === 'Cash' || grp.toLowerCase().includes('cash')) {
        snapshotGroup = 'CASH';
      } else if (grp === 'Bank' || grp.toLowerCase().includes('bank')) {
        snapshotGroup = 'BANK';
      }
      return {
        ...a,
        snapshot_group: snapshotGroup,
        opening_balance: Number(a.opening_debit || 0) - Number(a.opening_credit || 0),
        closing_balance: Number(a.closing_signed_balance || 0),
        carried_forward_balance:
          String(a.carried_forward_type) === 'Credit'
            ? -Number(a.carried_forward_amount || 0)
            : Number(a.carried_forward_amount || 0),
      };
    });

    const rawStockSnapshots = db
      .prepare('SELECT * FROM closing_stock_snapshots WHERE closing_id = ? ORDER BY company_name ASC, item_name ASC')
      .all(id) as Array<Record<string, unknown>>;

    const stockSnapshots = rawStockSnapshots.map((s) => ({
      ...s,
      opening_quantity: s.opening_qty,
      purchased_quantity: s.purchased_qty,
      sold_quantity: s.sold_qty,
      purchase_return_quantity: s.purchase_returns_qty,
      sales_return_quantity: s.sales_returns_qty,
      adjustment_quantity: s.adjustments_qty,
      closing_quantity: s.closing_qty,
      unit_cost: s.unit_cost_rate,
      closing_valuation: s.closing_stock_value,
    }));

    const rawAuditLogs = db
      .prepare('SELECT * FROM closing_audit_logs WHERE closing_id = ? ORDER BY id DESC')
      .all(id) as Array<Record<string, unknown>>;
    const auditLogs = rawAuditLogs.map((l) => ({
      ...l,
      period_start: l.period_start_date,
      period_end: l.period_end_date,
      performed_by_username: l.performed_by,
    }));

    let parsedSnapshot: Record<string, unknown> = {};
    try {
      parsedSnapshot = JSON.parse(String(closing.snapshot_json || '{}'));
    } catch {}

    // Classify account snapshots for dedicated reports
    const customerCarryForward = accountSnapshots.filter(
      (a) =>
        (a.account_group === 'Customer' || a.account_type === 'Customer' || a.account_type === 'Customer & Supplier')
    );
    const supplierCarryForward = accountSnapshots.filter(
      (a) =>
        (a.account_group === 'Supplier' || a.account_type === 'Supplier' || a.account_type === 'Customer & Supplier')
    );
    const cashAndBankCarryForward = accountSnapshots.filter(
      (a) =>
        a.account_group === 'Cash' ||
        String(a.account_group || '').toLowerCase().includes('cash') ||
        a.account_group === 'Bank' ||
        String(a.account_group || '').toLowerCase().includes('bank')
    );
    const financialAccountCarryForward = accountSnapshots.filter(
      (a) =>
        a.main_group === 'FINANCIAL ACCOUNTS' ||
        ['Cash', 'Bank', 'Assets', 'Liabilities', 'Capital'].includes(String(a.account_group))
    );
    const incomeAndExpenseAccounts = accountSnapshots.filter(
      (a) => a.financial_category === 'Income' || a.financial_category === 'Expenses'
    );

    const enrichedClosing = {
      ...closing,
      period_start: closing.period_start_date,
      period_end: closing.period_end_date,
      closed_by_username: closing.closed_by,
      reopened_by_username: closing.reopened_by,
      opening_cash: closing.opening_cash_balance,
      closing_cash: closing.closing_cash_balance,
      closing_bank: closing.closing_bank_balance,
      closing_stock_value: closing.closing_inventory_value,
    };

    return res.json({
      success: true,
      ...enrichedClosing,
      closing: enrichedClosing,
      parsedSnapshot,
      accountSnapshots,
      account_snapshots: accountSnapshots,
      customerCarryForward,
      customer_carry_forward: customerCarryForward,
      supplierCarryForward,
      supplier_carry_forward: supplierCarryForward,
      cashAndBankCarryForward,
      cash_and_bank_carry_forward: cashAndBankCarryForward,
      financialAccountCarryForward,
      financial_account_carry_forward: financialAccountCarryForward,
      incomeAndExpenseAccounts,
      stockSnapshots,
      stock_snapshots: stockSnapshots,
      auditLogs,
      audit_logs: auditLogs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/closing/:id/reopen
 * Super Admin ONLY: Reopen a closed period with a mandatory reason and complete audit trail.
 */
closingRouter.post('/:id/reopen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const userRole = req.user?.role || '';
    const username = req.user?.username || 'Super Admin';
    const userId = req.user?.id || null;

    if (userRole !== 'Super Admin') {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only Super Admin is authorized to reopen a closed financial period.',
      });
    }

    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'A mandatory reason is required to reopen a closed financial period.',
      });
    }

    const existing = db
      .prepare('SELECT * FROM financial_closings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Closing record not found.' });
    }

    if (existing.status === 'REOPENED') {
      return res.status(400).json({
        success: false,
        error: `Closing ${existing.closing_code} is already marked REOPENED.`,
      });
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE financial_closings
        SET status = 'REOPENED',
            is_locked = 0,
            reopened_by = ?,
            reopened_by_role = ?,
            reopened_at = CURRENT_TIMESTAMP,
            reopen_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(username, userRole, reason, id);

      // Unlock linked accounting_periods row(s)
      db.prepare(`
        UPDATE accounting_periods
        SET is_closed = 0,
            reopened_by = ?,
            reopened_at = CURRENT_TIMESTAMP,
            reopen_reason = ?
        WHERE closing_id = ?
           OR (DATE(start_date) = DATE(?) AND DATE(end_date) = DATE(?))
      `).run(
        username,
        reason,
        id,
        String(existing.period_start_date),
        String(existing.period_end_date)
      );

      recordClosingAudit({
        closingId: id,
        closingCode: String(existing.closing_code),
        closingType: String(existing.closing_type),
        action: 'CLOSED_PERIOD_REOPENED',
        startDate: String(existing.period_start_date),
        endDate: String(existing.period_end_date),
        username,
        userRole,
        userId,
        reason,
        details: {
          closingId: id,
          closingCode: existing.closing_code,
          closingType: existing.closing_type,
          periodName: existing.period_name,
          periodStartDate: existing.period_start_date,
          periodEndDate: existing.period_end_date,
          reopenedBy: username,
          reopenReason: reason,
        },
      });
    });

    tx();

    const updated = db.prepare('SELECT * FROM financial_closings WHERE id = ?').get(id);

    return res.json({
      success: true,
      message: `Period "${existing.period_name}" (${existing.closing_code}) has been REOPENED by Super Admin (${username}) and audit log recorded.`,
      closing: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});
