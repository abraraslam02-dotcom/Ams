import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';
import { assertPeriodOpen } from '../utils/periodLock.ts';

export const inventoryRouter = Router();

function round2(val: unknown): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val || 0));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function parsePacking(packingStr: string): {
  stripsPerBox: number;
  unitsPerStrip: number;
  unitsPerPack: number;
  packing: string;
} {
  const clean = String(packingStr || '1x1').trim();
  const matrixMatch = clean.match(/^(\d+)\s*[xX*]\s*(\d+)/);
  if (matrixMatch) {
    const strips = Math.max(1, parseInt(matrixMatch[1], 10) || 1);
    const units = Math.max(1, parseInt(matrixMatch[2], 10) || 1);
    return {
      stripsPerBox: strips,
      unitsPerStrip: units,
      unitsPerPack: strips * units,
      packing: `${strips}x${units}`,
    };
  }
  const singleMatch = clean.match(/^(\d+)\s*(tab|cap|sachet|amp|vial|strip|pack|unit)s?$/i);
  if (singleMatch) {
    const units = Math.max(1, parseInt(singleMatch[1], 10) || 1);
    return {
      stripsPerBox: 1,
      unitsPerStrip: units,
      unitsPerPack: units,
      packing: `${units}`,
    };
  }
  return { stripsPerBox: 1, unitsPerStrip: 1, unitsPerPack: 1, packing: clean || '1x1' };
}

function computeExpiryStatus(expiryDate: string, nearExpiryDays: number = 90): {
  status: 'valid' | 'expiring_30' | 'expiring_60' | 'expiring_90' | 'expired';
  tier: 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS' | 'BEYOND_90';
  datasheetStatus: 'EXPIRED' | 'NEAR_EXPIRY' | 'GOOD';
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
} {
  if (!expiryDate) {
    return {
      status: 'valid',
      tier: 'BEYOND_90',
      datasheetStatus: 'GOOD',
      daysToExpiry: 9999,
      isExpired: false,
      isNearExpiry: false,
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);

  const diffTime = exp.getTime() - today.getTime();
  const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysToExpiry < 0) {
    return {
      status: 'expired',
      tier: 'EXPIRED',
      datasheetStatus: 'EXPIRED',
      daysToExpiry,
      isExpired: true,
      isNearExpiry: false,
    };
  } else if (daysToExpiry <= 30) {
    return {
      status: 'expiring_30',
      tier: '30_DAYS',
      datasheetStatus: 'NEAR_EXPIRY',
      daysToExpiry,
      isExpired: false,
      isNearExpiry: true,
    };
  } else if (daysToExpiry <= 60) {
    return {
      status: 'expiring_60',
      tier: '60_DAYS',
      datasheetStatus: 'NEAR_EXPIRY',
      daysToExpiry,
      isExpired: false,
      isNearExpiry: true,
    };
  } else if (daysToExpiry <= nearExpiryDays) {
    return {
      status: 'expiring_90',
      tier: '90_DAYS',
      datasheetStatus: 'NEAR_EXPIRY',
      daysToExpiry,
      isExpired: false,
      isNearExpiry: true,
    };
  }
  return {
    status: 'valid',
    tier: 'BEYOND_90',
    datasheetStatus: 'GOOD',
    daysToExpiry,
    isExpired: false,
    isNearExpiry: false,
  };
}

function computeBatchStockStatus(
  currentPackQty: number,
  expiryDate: string,
  minStock: number = 0
): 'in_stock' | 'low_stock' | 'out_of_stock' | 'expired' {
  const { isExpired } = computeExpiryStatus(expiryDate);
  if (isExpired) return 'expired';
  if (currentPackQty <= 0) return 'out_of_stock';
  if (minStock > 0 && currentPackQty <= minStock) return 'low_stock';
  return 'in_stock';
}

function getAccountIdByCode(code: string): number {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM accounts WHERE account_code = ?').get(code) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Required accounting ledger "${code}" not found.`);
  }
  return row.id;
}

function parseListParam(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val
      .flatMap((v) => String(v).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIdListParam(val: unknown): number[] {
  return parseListParam(val)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n) && n > 0);
}

function getPreviousMonthRange(refDateStr: string): { prevStart: string; prevEnd: string } {
  const base = /^\d{4}-\d{2}-\d{2}/.test(refDateStr) ? new Date(refDateStr.slice(0, 10) + 'T00:00:00') : new Date();
  const year = base.getFullYear();
  const month = base.getMonth(); // 0-indexed
  const prevMonthFirst = new Date(year, month - 1, 1);
  const prevMonthLast = new Date(year, month, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { prevStart: fmt(prevMonthFirst), prevEnd: fmt(prevMonthLast) };
}

function normalizeAdjustmentHeaderCategory(raw: string): 'INCREASE' | 'DECREASE' | 'DAMAGE' | 'EXPIRED' | 'PHYSICAL_DIFFERENCE' | 'CORRECTION' {
  const s = String(raw || '').toUpperCase().replace(/\s+/g, '_');
  if (s.includes('DAMAGE') || s.includes('BREAKAGE')) return 'DAMAGE';
  if (s.includes('EXPIRE')) return 'EXPIRED';
  if (s.includes('PHYSICAL')) return 'PHYSICAL_DIFFERENCE';
  if (s.includes('CORRECT')) return 'CORRECTION';
  if (s === 'INCREASE') return 'INCREASE';
  return 'DECREASE';
}

function toDbAdjustmentType(raw: string): 'Increase' | 'Decrease' | 'Damage' | 'Expired' | 'Physical Difference' | 'Correction' {
  const s = String(raw || '').toUpperCase().replace(/\s+/g, '_');
  if (s === 'INCREASE') return 'Increase';
  if (s === 'DECREASE') return 'Decrease';
  if (s === 'DAMAGE') return 'Damage';
  if (s === 'EXPIRED') return 'Expired';
  if (s === 'PHYSICAL_DIFFERENCE' || s === 'PHYSICAL DIFFERENCE') return 'Physical Difference';
  if (s === 'CORRECTION') return 'Correction';
  return 'Physical Difference';
}

function toDbLineReasonCategory(raw: string):
  | 'Damage'
  | 'Expired'
  | 'Physical Difference'
  | 'Opening Correction'
  | 'Supplier Bonus Correction'
  | 'Breakage / Leakage'
  | 'General Adjustment' {
  const s = String(raw || '').toUpperCase().replace(/\s+/g, '_');
  if (s === 'DAMAGE') return 'Damage';
  if (s === 'EXPIRED') return 'Expired';
  if (s === 'PHYSICAL_DIFFERENCE' || s === 'PHYSICAL DIFFERENCE') return 'Physical Difference';
  if (s.includes('OPENING')) return 'Opening Correction';
  if (s.includes('BONUS')) return 'Supplier Bonus Correction';
  if (s.includes('BREAKAGE') || s.includes('LEAKAGE')) return 'Breakage / Leakage';
  if (s === 'CORRECTION') return 'Opening Correction';
  return 'General Adjustment';
}

function mapVerificationStatusOut(dbStatus: string): 'DRAFT' | 'RECONCILED' | 'CANCELLED' {
  const s = String(dbStatus || '').toLowerCase();
  if (s === 'reconciled') return 'RECONCILED';
  if (s === 'cancelled') return 'CANCELLED';
  return 'DRAFT';
}

/**
 * 0. GET /api/inventory/companies-items-meta
 * Reusable metadata for Advanced Company & Item Selection System across all reports
 */
inventoryRouter.get('/companies-items-meta', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const items = db
      .prepare(`
        SELECT
          i.id,
          i.item_code,
          i.item_name,
          COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') AS company_name,
          COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
          i.packing,
          i.trade_price,
          i.purchase_price,
          i.retail_price,
          i.opening_stock,
          COALESCE(SUM(inv.current_pack_qty), 0) AS current_packs
        FROM items i
        LEFT JOIN inventory inv ON inv.item_id = i.id
        WHERE LOWER(i.status) = 'active'
        GROUP BY i.id
        ORDER BY company_name ASC, i.item_name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const enrichedItems = items.map((it) => {
      const parsed = parsePacking(String(it.packing || '1x1'));
      return {
        id: Number(it.id),
        item_code: String(it.item_code || ''),
        item_name: String(it.item_name || ''),
        company_name: String(it.company_name || 'General'),
        item_group: String(it.item_group || 'General'),
        packing: String(it.packing || '1x1'),
        units_per_pack: parsed.unitsPerPack,
        trade_price: round2(it.trade_price || it.purchase_price),
        purchase_price: round2(it.purchase_price),
        retail_price: round2(it.retail_price),
        current_packs: round2(it.current_packs),
      };
    });

    const companies = Array.from(new Set(enrichedItems.map((i) => i.company_name))).sort((a, b) =>
      a.localeCompare(b)
    );
    const itemGroups = Array.from(new Set(enrichedItems.map((i) => i.item_group))).sort((a, b) =>
      a.localeCompare(b)
    );

    res.json({
      success: true,
      companies,
      itemGroups,
      items: enrichedItems,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 1. GET /api/inventory/overview
 * High-level KPIs, valuation, and expiry health summary
 */
inventoryRouter.get('/overview', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const settings = db
      .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
      .get() as { near_expiry_days?: number } | undefined;
    const nearExpiryThreshold = settings?.near_expiry_days || 90;

    const itemCount = db
      .prepare("SELECT COUNT(*) as cnt FROM items WHERE LOWER(status) = 'active'")
      .get() as { cnt: number };

    const batchStats = db
      .prepare(`
        SELECT
          COUNT(*) as total_batches,
          COALESCE(SUM(current_pack_qty), 0) as total_packs,
          COALESCE(SUM(total_stock_units), 0) as total_units,
          COALESCE(SUM(current_pack_qty * pack_cost), 0) as total_cost_value,
          COALESCE(SUM(current_pack_qty * pack_retail), 0) as total_retail_value,
          COALESCE(SUM(CASE WHEN current_pack_qty > 0 THEN 1 ELSE 0 END), 0) as active_batches_in_stock
        FROM inventory
      `)
      .get() as Record<string, number>;

    const todayStr = new Date().toISOString().slice(0, 10);
    const targetNearDate = new Date();
    targetNearDate.setDate(targetNearDate.getDate() + nearExpiryThreshold);
    const nearExpiryDateStr = targetNearDate.toISOString().slice(0, 10);

    const expiredBatches = db
      .prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(current_pack_qty), 0) as packs, COALESCE(SUM(current_pack_qty * pack_cost), 0) as cost_val
        FROM inventory
        WHERE expiry_date < ? AND current_pack_qty > 0
      `)
      .get(todayStr) as { cnt: number; packs: number; cost_val: number };

    const nearExpiryBatches = db
      .prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(current_pack_qty), 0) as packs, COALESCE(SUM(current_pack_qty * pack_cost), 0) as cost_val
        FROM inventory
        WHERE expiry_date >= ? AND expiry_date <= ? AND current_pack_qty > 0
      `)
      .get(todayStr, nearExpiryDateStr) as { cnt: number; packs: number; cost_val: number };

    const stockStatuses = db
      .prepare(`
        SELECT
          i.id,
          i.minimum_stock,
          COALESCE(SUM(inv.current_pack_qty), 0) as total_packs
        FROM items i
        LEFT JOIN inventory inv ON i.id = inv.item_id
        WHERE LOWER(i.status) = 'active'
        GROUP BY i.id
      `)
      .all() as Array<{ id: number; minimum_stock: number; total_packs: number }>;

    const outOfStockCount = stockStatuses.filter((r) => round2(r.total_packs) <= 0).length;
    const lowStockCount = stockStatuses.filter((r) => {
      const p = round2(r.total_packs);
      const min = Number(r.minimum_stock || 0);
      return p > 0 && min > 0 && p <= min;
    }).length;

    const overviewObj = {
      total_items: itemCount.cnt || 0,
      active_batches: batchStats.active_batches_in_stock || 0,
      total_packs_in_stock: round2(batchStats.total_packs || 0),
      total_units_in_stock: round2(batchStats.total_units || 0),
      total_cost_valuation: round2(batchStats.total_cost_value || 0),
      total_retail_valuation: round2(batchStats.total_retail_value || 0),
      potential_margin_value: round2(
        (batchStats.total_retail_value || 0) - (batchStats.total_cost_value || 0)
      ),
      near_expiry_count: nearExpiryBatches.cnt || 0,
      expired_count: expiredBatches.cnt || 0,
      low_stock_count: lowStockCount,
      out_of_stock_count: outOfStockCount,
      near_expiry_days_setting: nearExpiryThreshold,
    };

    res.json({
      success: true,
      overview: overviewObj,
      summary: {
        totalItems: overviewObj.total_items,
        totalBatches: batchStats.total_batches || 0,
        activeBatchesInStock: overviewObj.active_batches,
        totalStockPacks: overviewObj.total_packs_in_stock,
        totalStockUnits: overviewObj.total_units_in_stock,
        totalStockValueCost: overviewObj.total_cost_valuation,
        totalStockValueRetail: overviewObj.total_retail_valuation,
        potentialProfitMargin: overviewObj.potential_margin_value,
        nearExpiryDaysThreshold: nearExpiryThreshold,
        nearExpiryCount: overviewObj.near_expiry_count,
        nearExpiryPacks: round2(nearExpiryBatches.packs || 0),
        nearExpiryValueCost: round2(nearExpiryBatches.cost_val || 0),
        expiredCount: overviewObj.expired_count,
        expiredPacks: round2(expiredBatches.packs || 0),
        expiredValueCost: round2(expiredBatches.cost_val || 0),
        lowStockCount: overviewObj.low_stock_count,
        outOfStockCount: overviewObj.out_of_stock_count,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 2. GET /api/inventory/datasheet
 * Full Batch-Wise Stock & Expiry Datasheet
 */
inventoryRouter.get('/datasheet', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = (req.query.search || req.query.q) as string | undefined;
    const itemCode = (req.query.code || req.query.itemCode) as string | undefined;
    const barcode = req.query.barcode as string | undefined;
    const company = req.query.company as string | undefined;
    const category = req.query.category as string | undefined;
    const batch = req.query.batch as string | undefined;
    const expiryFilter = (req.query.expiry_status || req.query.expiryFilter) as string | undefined;
    const statusFilter = req.query.statusFilter as string | undefined;
    const inStockOnly = req.query.inStockOnly as string | undefined;
    const sortBy = String(req.query.sort_by || req.query.sortBy || 'item_name');
    const sortOrder = String(req.query.sort_order || req.query.sortOrder || 'ASC');
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.limit || req.query.pageSize || 50);

    const settings = db
      .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
      .get() as { near_expiry_days?: number } | undefined;
    const nearExpiryDays = settings?.near_expiry_days || 90;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(`(
        i.item_code LIKE ? OR
        i.barcode LIKE ? OR
        i.item_name LIKE ? OR
        i.company_name LIKE ? OR
        i.generic_name LIKE ? OR
        inv.batch_number LIKE ?
      )`);
      params.push(term, term, term, term, term, term);
    }

    if (itemCode && itemCode.trim()) {
      conditions.push('i.item_code LIKE ?');
      params.push(`%${itemCode.trim()}%`);
    }

    if (barcode && barcode.trim()) {
      conditions.push('i.barcode LIKE ?');
      params.push(`%${barcode.trim()}%`);
    }

    if (company && company.toUpperCase() !== 'ALL') {
      conditions.push('i.company_name = ?');
      params.push(company);
    }

    if (category && category.toUpperCase() !== 'ALL') {
      conditions.push('i.category = ?');
      params.push(category);
    }

    if (batch && batch.trim()) {
      conditions.push('inv.batch_number LIKE ?');
      params.push(`%${batch.trim()}%`);
    }

    if (inStockOnly === 'true') {
      conditions.push('inv.current_pack_qty > 0');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const date30 = new Date();
    date30.setDate(date30.getDate() + 30);
    const str30 = date30.toISOString().slice(0, 10);

    const date60 = new Date();
    date60.setDate(date60.getDate() + 60);
    const str60 = date60.toISOString().slice(0, 10);

    const dateNear = new Date();
    dateNear.setDate(dateNear.getDate() + nearExpiryDays);
    const strNear = dateNear.toISOString().slice(0, 10);

    const expKey = String(expiryFilter || '').toUpperCase();
    if (expKey === 'EXPIRED') {
      conditions.push('inv.expiry_date < ?');
      params.push(todayStr);
    } else if (expKey === 'EXPIRING_30') {
      conditions.push('inv.expiry_date >= ? AND inv.expiry_date <= ?');
      params.push(todayStr, str30);
    } else if (expKey === 'EXPIRING_60') {
      conditions.push('inv.expiry_date > ? AND inv.expiry_date <= ?');
      params.push(str30, str60);
    } else if (expKey === 'EXPIRING_90') {
      conditions.push('inv.expiry_date > ? AND inv.expiry_date <= ?');
      params.push(str60, strNear);
    } else if (expKey === 'NEAR_EXPIRY') {
      conditions.push('inv.expiry_date >= ? AND inv.expiry_date <= ?');
      params.push(todayStr, strNear);
    } else if (expKey === 'VALID' || expKey === 'GOOD') {
      conditions.push('inv.expiry_date > ?');
      params.push(strNear);
    }

    if (statusFilter && statusFilter.toLowerCase() !== 'all') {
      if (statusFilter === 'expired') {
        conditions.push('inv.expiry_date < ?');
        params.push(todayStr);
      } else if (statusFilter === 'out_of_stock') {
        conditions.push('inv.current_pack_qty <= 0 AND inv.expiry_date >= ?');
        params.push(todayStr);
      } else if (statusFilter === 'low_stock') {
        conditions.push('inv.current_pack_qty > 0 AND inv.current_pack_qty <= i.minimum_stock AND inv.expiry_date >= ?');
        params.push(todayStr);
      } else if (statusFilter === 'in_stock') {
        conditions.push('inv.current_pack_qty > i.minimum_stock AND inv.expiry_date >= ?');
        params.push(todayStr);
      }
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSortColumns: Record<string, string> = {
      item_code: 'i.item_code',
      item_name: 'i.item_name',
      company_name: 'i.company_name',
      category: 'i.category',
      batch_number: 'inv.batch_number',
      expiry_date: 'inv.expiry_date',
      current_pack_qty: 'inv.current_pack_qty',
      current_stock: 'inv.current_pack_qty',
      total_stock_units: 'inv.total_stock_units',
      pack_cost: 'inv.pack_cost',
      purchase_rate: 'inv.pack_cost',
      pack_retail: 'inv.pack_retail',
      retail_price: 'inv.pack_retail',
      stock_value: '(inv.current_pack_qty * inv.pack_cost)',
    };

    const sortCol = allowedSortColumns[sortBy] || 'i.item_name';
    const orderDirection = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const countSql = `
      SELECT
        COUNT(*) as totalRows,
        COUNT(DISTINCT inv.item_id) as totalItems,
        COALESCE(SUM(inv.current_pack_qty), 0) as totalPacks,
        COALESCE(SUM(inv.total_stock_units), 0) as totalUnits,
        COALESCE(SUM(inv.current_pack_qty * inv.pack_cost), 0) as totalStockValue,
        COALESCE(SUM(inv.current_pack_qty * inv.pack_retail), 0) as totalRetailValue
      FROM inventory inv
      JOIN items i ON inv.item_id = i.id
      ${whereSql}
    `;

    const summaryRow = db.prepare(countSql).get(...params) as Record<string, number>;
    const totalCount = Number(summaryRow?.totalRows || 0);

    const pageNum = Math.max(1, page || 1);
    const limitNum = Math.min(5000, Math.max(10, pageSize || 50));
    const offset = (pageNum - 1) * limitNum;

    const dataSql = `
      SELECT
        inv.id as id,
        inv.id as inventory_id,
        inv.item_id,
        i.item_code,
        COALESCE(i.barcode, '') as barcode,
        i.company_name,
        i.item_name,
        COALESCE(i.generic_name, '') as generic_name,
        i.category,
        i.packing,
        inv.batch_number,
        COALESCE(inv.manufacturing_date, '') as mfg_date,
        inv.manufacturing_date,
        inv.expiry_date,
        inv.pack_cost as purchase_rate,
        inv.pack_retail as retail_price,
        inv.pack_retail as sale_price,
        inv.cost_price as cost_price_per_unit,
        inv.retail_price as retail_price_per_unit,
        inv.units_per_pack,
        inv.strips_per_box,
        inv.units_per_strip,
        COALESCE(inv.opening_stock_packs, 0.0) as opening_stock,
        COALESCE(inv.purchased_qty, 0.0) as purchased_qty,
        COALESCE(inv.bonus_qty, 0.0) as bonus_qty,
        COALESCE(inv.sold_qty, 0.0) as sold_qty,
        COALESCE(inv.purchase_return_qty, inv.returned_qty, 0.0) as purchase_return_qty,
        COALESCE(inv.sales_return_qty, 0.0) as sales_return_qty,
        COALESCE(inv.adjusted_qty, 0.0) as adjusted_qty,
        COALESCE(inv.current_pack_qty, 0.0) as current_stock,
        COALESCE(inv.current_pack_qty, 0.0) as current_pack_qty,
        inv.current_strip_qty,
        COALESCE(inv.current_loose_qty, 0.0) as current_loose_qty,
        COALESCE(inv.total_stock_units, 0.0) as total_stock_units,
        ROUND(COALESCE(inv.current_pack_qty, 0) * COALESCE(inv.pack_cost, 0), 2) as stock_value,
        ROUND(COALESCE(inv.current_pack_qty, 0) * COALESCE(inv.pack_retail, 0), 2) as retail_value,
        COALESCE(inv.rack_shelf, i.rack_number, '') as rack_location,
        inv.rack_shelf,
        i.minimum_stock as min_stock_level,
        i.minimum_stock as reorder_level,
        inv.status,
        inv.updated_at
      FROM inventory inv
      JOIN items i ON inv.item_id = i.id
      ${whereSql}
      ORDER BY ${sortCol} ${orderDirection}, inv.expiry_date ASC
      LIMIT ? OFFSET ?
    `;

    const rawRows = db.prepare(dataSql).all(...params, limitNum, offset) as Array<Record<string, unknown>>;

    const rows = rawRows.map((r) => {
      const expStatus = computeExpiryStatus(String(r.expiry_date), nearExpiryDays);
      const stockStatus = computeBatchStockStatus(
        Number(r.current_stock || 0),
        String(r.expiry_date),
        Number(r.min_stock_level || 0)
      );
      return {
        ...r,
        expiry_status: expStatus.datasheetStatus,
        expiry_status_detail: expStatus.status,
        days_to_expiry: expStatus.daysToExpiry,
        is_expired: expStatus.isExpired,
        is_near_expiry: expStatus.isNearExpiry,
        stock_status: stockStatus,
      };
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limitNum));

    res.json({
      success: true,
      data: rows,
      totalCount,
      page: pageNum,
      pageSize: limitNum,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
      summary: {
        total_items: Number(summaryRow?.totalItems || 0),
        total_packs: round2(summaryRow?.totalPacks || 0),
        total_units: round2(summaryRow?.totalUnits || 0),
        total_cost_valuation: round2(summaryRow?.totalStockValue || 0),
        total_retail_valuation: round2(summaryRow?.totalRetailValue || 0),
        totalRows: totalCount,
        totalPacks: round2(summaryRow?.totalPacks || 0),
        totalUnits: round2(summaryRow?.totalUnits || 0),
        totalStockValue: round2(summaryRow?.totalStockValue || 0),
        totalRetailValue: round2(summaryRow?.totalRetailValue || 0),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 3. GET /api/inventory/current-stock
 * Item-Level Consolidated Stock Summary
 */
inventoryRouter.get('/current-stock', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = (req.query.search || req.query.q) as string | undefined;
    const company = req.query.company as string | undefined;
    const category = req.query.category as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const inStockOnly = req.query.inStockOnly as string | undefined;

    const conditions: string[] = ["LOWER(i.status) = 'active'"];
    const params: unknown[] = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push('(i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ? OR i.barcode LIKE ? OR i.generic_name LIKE ?)');
      params.push(term, term, term, term, term);
    }
    if (company && company.toUpperCase() !== 'ALL') {
      conditions.push('i.company_name = ?');
      params.push(company);
    }
    if (category && category.toUpperCase() !== 'ALL') {
      conditions.push('i.category = ?');
      params.push(category);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        i.id as item_id,
        i.item_code,
        COALESCE(i.barcode, '') as barcode,
        i.company_name,
        i.item_name,
        COALESCE(i.generic_name, '') as generic_name,
        i.category,
        i.packing,
        i.purchase_price as default_purchase_price,
        i.trade_price,
        i.retail_price as default_retail_price,
        i.minimum_stock,
        i.rack_number,
        COUNT(inv.id) as batch_count,
        COALESCE(SUM(inv.current_pack_qty), 0.0) as total_packs,
        COALESCE(SUM(inv.current_loose_qty), 0.0) as total_loose,
        COALESCE(SUM(inv.total_stock_units), 0.0) as total_units,
        COALESCE(SUM(inv.current_pack_qty * inv.pack_cost), 0.0) as total_stock_value,
        COALESCE(SUM(inv.current_pack_qty * inv.pack_retail), 0.0) as total_retail_value,
        MIN(CASE WHEN inv.current_pack_qty > 0 THEN inv.expiry_date ELSE NULL END) as earliest_expiry
      FROM items i
      LEFT JOIN inventory inv ON i.id = inv.item_id
      ${whereSql}
      GROUP BY i.id
      ${inStockOnly === 'true' ? 'HAVING total_packs > 0' : ''}
      ORDER BY i.item_name ASC
    `;

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    let enriched = rows.map((r) => {
      const parsed = parsePacking(String(r.packing || '1x1'));
      const totalUnits = round2(r.total_units);
      const totalPacks = round2(totalUnits > 0 ? totalUnits / parsed.unitsPerPack : r.total_packs);
      const totalCost = round2(r.total_stock_value);
      const totalRetail = round2(r.total_retail_value);
      const minStock = Number(r.minimum_stock || 0);
      const weightedAvgCost = totalPacks > 0 ? round2(totalCost / totalPacks) : round2(r.default_purchase_price);
      const latestRetail = totalPacks > 0 ? round2(totalRetail / totalPacks) : round2(r.default_retail_price);

      const stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OPTIMAL' =
        totalPacks <= 0 ? 'OUT_OF_STOCK' : minStock > 0 && totalPacks <= minStock ? 'LOW_STOCK' : 'OPTIMAL';

      return {
        ...r,
        units_per_pack: parsed.unitsPerPack,
        min_stock_level: minStock,
        reorder_level: minStock,
        total_packs: totalPacks,
        total_loose: round2(r.total_loose),
        total_units: totalUnits,
        weighted_avg_purchase_rate: weightedAvgCost,
        weighted_avg_cost: weightedAvgCost,
        latest_retail_price: latestRetail,
        total_cost_value: totalCost,
        total_stock_value: totalCost,
        total_retail_value: totalRetail,
        nearest_expiry: r.earliest_expiry || null,
        stock_status: stockStatus,
        is_low_stock: stockStatus === 'LOW_STOCK',
        reorder_suggested: minStock > 0 && totalPacks < minStock ? round2(minStock - totalPacks) : 0,
      };
    });

    if (statusFilter && statusFilter.toUpperCase() !== 'ALL') {
      const sf = statusFilter.toUpperCase();
      enriched = enriched.filter((r) => r.stock_status === sf);
    }

    res.json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 3B. GET /api/inventory/item-stock-report
 * Full Pack Rule Item Stock Report with Date Range, Multi-Company, Multi-Item, Item Group & Stock Formula
 * Formula: Opening + Purchase + Purchase Bonus - Purchase Return - Sale + Sale Return + Transfer In - Transfer Out + Physical Adjustment = Closing Stock
 */
inventoryRouter.get('/item-stock-report', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const fromDate = req.query.fromDate ? String(req.query.fromDate).trim() : '';
    const toDate = req.query.toDate ? String(req.query.toDate).trim() : '';
    const companies = parseListParam(req.query.companies || req.query.companyNames);
    const itemIds = parseIdListParam(req.query.itemIds);
    const itemGroup = req.query.itemGroup ? String(req.query.itemGroup).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';

    const conditions: string[] = ["LOWER(i.status) = 'active'"];
    const params: unknown[] = [];

    if (itemIds.length > 0) {
      conditions.push(`i.id IN (${itemIds.map(() => '?').join(',')})`);
      params.push(...itemIds);
    } else if (companies.length > 0) {
      conditions.push(`COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') IN (${companies.map(() => '?').join(',')})`);
      params.push(...companies);
    }

    if (itemGroup && itemGroup.toUpperCase() !== 'ALL') {
      conditions.push(`COALESCE(NULLIF(TRIM(i.category), ''), 'General') = ?`);
      params.push(itemGroup);
    }

    if (search) {
      const term = `%${search}%`;
      conditions.push('(i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ? OR i.category LIKE ?)');
      params.push(term, term, term, term);
    }

    const items = db
      .prepare(`
        SELECT
          i.id,
          i.item_code,
          i.item_name,
          COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') AS company_name,
          COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
          i.packing,
          i.trade_price,
          i.purchase_price,
          i.retail_price,
          i.opening_stock
        FROM items i
        WHERE ${conditions.join(' AND ')}
        ORDER BY company_name ASC, i.item_name ASC
      `)
      .all(...params) as Array<Record<string, unknown>>;

    if (items.length === 0) {
      return res.json({
        success: true,
        data: [],
        totals: {
          opening_stock: 0,
          purchase_qty: 0,
          purchase_bonus: 0,
          purchase_return: 0,
          sale_qty: 0,
          sale_bonus: 0,
          sale_return: 0,
          transfer_in: 0,
          transfer_out: 0,
          physical_adjustment: 0,
          closing_stock: 0,
          stock_value: 0,
        },
      });
    }

    const idList = items.map((i) => Number(i.id));
    const idPlaceholders = idList.map(() => '?').join(',');

    // 1. Initial Opening Stock from inventory batches (where not created by a purchase)
    const baseOpenRows = db
      .prepare(`
        SELECT
          item_id,
          COUNT(*) AS batch_count,
          COALESCE(SUM(CASE WHEN (last_purchase_id IS NULL OR last_purchase_id = 0) THEN COALESCE(opening_stock_packs, 0) ELSE 0 END), 0) AS inv_opening_packs
        FROM inventory
        WHERE item_id IN (${idPlaceholders})
        GROUP BY item_id
      `)
      .all(...idList) as Array<{ item_id: number; batch_count: number; inv_opening_packs: number }>;
    const baseOpenMap = new Map(baseOpenRows.map((r) => [Number(r.item_id), r]));

    // 2. Purchases (all completed)
    const purchaseRows = db
      .prepare(`
        SELECT
          pi.item_id,
          p.bill_date AS tx_date,
          pi.quantity,
          pi.bonus_quantity,
          pi.loose_quantity,
          pi.units_per_pack
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.status = 'completed' AND pi.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    // 3. Purchase Returns
    const purRetRows = db
      .prepare(`
        SELECT
          pri.item_id,
          pr.return_date AS tx_date,
          pri.return_quantity,
          pri.return_units,
          pri.units_per_pack
        FROM purchase_return_items pri
        JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
        WHERE pr.status = 'completed' AND pri.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    // 4. Sales (paid qty + loose converted to full pack, and bonus separate)
    const saleRows = db
      .prepare(`
        SELECT
          si.item_id,
          s.invoice_date AS tx_date,
          si.quantity,
          si.bonus_quantity,
          si.loose_quantity,
          si.units_per_pack
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed' AND si.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    // 5. Sale Returns (restocked)
    const saleRetRows = db
      .prepare(`
        SELECT
          sri.item_id,
          sr.return_date AS tx_date,
          sri.return_pack_qty,
          sri.return_bonus_qty,
          sri.return_loose_qty,
          sri.units_per_pack
        FROM sale_return_items sri
        JOIN sale_returns sr ON sri.sale_return_id = sr.id
        WHERE sr.status = 'completed' AND sri.restock_status = 'restocked' AND sri.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    // 6. Transfers (internal movement)
    const trfRows = db
      .prepare(`
        SELECT
          ti.item_id,
          trf.transfer_date AS tx_date,
          ti.total_units
        FROM stock_transfer_items ti
        JOIN stock_transfers trf ON ti.transfer_id = trf.id
        WHERE trf.status = 'completed' AND ti.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    // 7. Stock Adjustments (includes confirmed physical reconciliations)
    const adjRows = db
      .prepare(`
        SELECT
          ai.item_id,
          adj.adjustment_date AS tx_date,
          ai.adjustment_mode,
          ai.total_units,
          ai.units_per_pack
        FROM stock_adjustment_items ai
        JOIN stock_adjustments adj ON ai.adjustment_id = adj.id
        WHERE adj.status = 'completed' AND ai.item_id IN (${idPlaceholders})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const inPeriod = (txDate: string) => {
      if (fromDate && txDate < fromDate) return 'BEFORE';
      if (toDate && txDate > toDate) return 'AFTER';
      return 'IN';
    };

    const rows = items.map((item, idx) => {
      const itemId = Number(item.id);
      const parsed = parsePacking(String(item.packing || '1x1'));
      const upp = Math.max(1, parsed.unitsPerPack);
      const baseOpenInfo = baseOpenMap.get(itemId);
      const initialOpening =
        baseOpenInfo && baseOpenInfo.batch_count > 0
          ? Number(baseOpenInfo.inv_opening_packs || 0)
          : Number(item.opening_stock || 0);

      let priorDelta = initialOpening;
      let purchaseQty = 0;
      let purchaseBonus = 0;
      let purchaseReturn = 0;
      let salePaidQty = 0;
      let saleBonusQty = 0;
      let saleReturnPaidQty = 0;
      let saleReturnBonusQty = 0;
      let transferIn = 0;
      let transferOut = 0;
      let physicalAdjustment = 0;

      for (const r of purchaseRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paid = round2(Number(r.quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const bonus = round2(Number(r.bonus_quantity || 0));
        const bucket = inPeriod(String(r.tx_date || ''));
        if (bucket === 'BEFORE') {
          priorDelta += paid + bonus;
        } else if (bucket === 'IN') {
          purchaseQty += paid;
          purchaseBonus += bonus;
        }
      }

      for (const r of purRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs =
          Number(r.return_units || 0) > 0
            ? round2(Number(r.return_units) / rUpp)
            : round2(Number(r.return_quantity || 0));
        const bucket = inPeriod(String(r.tx_date || ''));
        if (bucket === 'BEFORE') {
          priorDelta -= packs;
        } else if (bucket === 'IN') {
          purchaseReturn += packs;
        }
      }

      for (const r of saleRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paidPacks = round2(Number(r.quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const bonusPacks = round2(Number(r.bonus_quantity || 0));
        const bucket = inPeriod(String(r.tx_date || ''));
        if (bucket === 'BEFORE') {
          priorDelta -= paidPacks + bonusPacks;
        } else if (bucket === 'IN') {
          salePaidQty += paidPacks;
          saleBonusQty += bonusPacks;
        }
      }

      for (const r of saleRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paidRet = round2(Number(r.return_pack_qty || 0) + Number(r.return_loose_qty || 0) / rUpp);
        const bonusRet = round2(Number(r.return_bonus_qty || 0));
        const bucket = inPeriod(String(r.tx_date || ''));
        if (bucket === 'BEFORE') {
          priorDelta += paidRet + bonusRet;
        } else if (bucket === 'IN') {
          saleReturnPaidQty += paidRet;
          saleReturnBonusQty += bonusRet;
        }
      }

      for (const r of trfRows) {
        if (Number(r.item_id) !== itemId) continue;
        const packs = round2(Number(r.total_units || 0) / upp);
        if (inPeriod(String(r.tx_date || '')) === 'IN') {
          transferIn += packs;
          transferOut += packs;
        }
      }

      for (const r of adjRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = round2(Number(r.total_units || 0) / rUpp);
        const signed = String(r.adjustment_mode) === 'Increase' ? packs : -packs;
        const bucket = inPeriod(String(r.tx_date || ''));
        if (bucket === 'BEFORE') {
          priorDelta += signed;
        } else if (bucket === 'IN') {
          physicalAdjustment += signed;
        }
      }

      const openingStock = round2(priorDelta);
      const pQty = round2(purchaseQty);
      const pBonus = round2(purchaseBonus);
      const pRet = round2(purchaseReturn);
      const sPaid = round2(salePaidQty);
      const sBonus = round2(saleBonusQty);
      const totalSaleOut = round2(sPaid + sBonus);
      const sRetTotal = round2(saleReturnPaidQty + saleReturnBonusQty);
      const tIn = round2(transferIn);
      const tOut = round2(transferOut);
      const physAdj = round2(physicalAdjustment);

      // Exact stock formula: Opening + Purchase + Purchase Bonus - Purchase Return - Sale + Sale Return + Transfer In - Transfer Out + Physical Adjustment
      const closingStock = round2(
        openingStock + pQty + pBonus - pRet - totalSaleOut + sRetTotal + tIn - tOut + physAdj
      );

      const tradePrice = round2(item.trade_price || item.purchase_price || 0);
      const stockValue = round2(closingStock * tradePrice);

      return {
        s_no: idx + 1,
        item_id: itemId,
        item_code: String(item.item_code || ''),
        item_name: String(item.item_name || ''),
        company_name: String(item.company_name || 'General'),
        item_group: String(item.item_group || 'General'),
        packing: String(item.packing || '1x1'),
        units_per_pack: upp,
        opening_stock: openingStock,
        purchase_qty: pQty,
        purchase_bonus: pBonus,
        purchase_return: pRet,
        sale_qty: totalSaleOut,
        sale_paid_qty: sPaid,
        sale_bonus: sBonus,
        sale_return: sRetTotal,
        transfer_in: tIn,
        transfer_out: tOut,
        physical_adjustment: physAdj,
        closing_stock: closingStock,
        trade_price: tradePrice,
        stock_value: stockValue,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        opening_stock: round2(acc.opening_stock + r.opening_stock),
        purchase_qty: round2(acc.purchase_qty + r.purchase_qty),
        purchase_bonus: round2(acc.purchase_bonus + r.purchase_bonus),
        purchase_return: round2(acc.purchase_return + r.purchase_return),
        sale_qty: round2(acc.sale_qty + r.sale_qty),
        sale_bonus: round2(acc.sale_bonus + r.sale_bonus),
        sale_return: round2(acc.sale_return + r.sale_return),
        transfer_in: round2(acc.transfer_in + r.transfer_in),
        transfer_out: round2(acc.transfer_out + r.transfer_out),
        physical_adjustment: round2(acc.physical_adjustment + r.physical_adjustment),
        closing_stock: round2(acc.closing_stock + r.closing_stock),
        stock_value: round2(acc.stock_value + r.stock_value),
      }),
      {
        opening_stock: 0,
        purchase_qty: 0,
        purchase_bonus: 0,
        purchase_return: 0,
        sale_qty: 0,
        sale_bonus: 0,
        sale_return: 0,
        transfer_in: 0,
        transfer_out: 0,
        physical_adjustment: 0,
        closing_stock: 0,
        stock_value: 0,
      }
    );

    res.json({ success: true, count: rows.length, data: rows, totals });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 3C. GET /api/inventory/stock-statement
 * Company-wise Stock Statement matching official tabular pharmacy stock statement layout
 */
inventoryRouter.get('/stock-statement', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const todayIso = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.fromDate ? String(req.query.fromDate).trim() : '';
    const toDate = req.query.toDate ? String(req.query.toDate).trim() : todayIso;
    const companiesFilter = parseListParam(req.query.companies || req.query.companyNames);
    const itemIds = parseIdListParam(req.query.itemIds);
    const itemGroup = req.query.itemGroup ? String(req.query.itemGroup).trim() : '';

    const conditions: string[] = ["LOWER(i.status) = 'active'"];
    const params: unknown[] = [];

    if (itemIds.length > 0) {
      conditions.push(`i.id IN (${itemIds.map(() => '?').join(',')})`);
      params.push(...itemIds);
    } else if (companiesFilter.length > 0) {
      conditions.push(`COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') IN (${companiesFilter.map(() => '?').join(',')})`);
      params.push(...companiesFilter);
    }

    if (itemGroup && itemGroup.toUpperCase() !== 'ALL') {
      conditions.push(`COALESCE(NULLIF(TRIM(i.category), ''), 'General') = ?`);
      params.push(itemGroup);
    }

    const items = db
      .prepare(`
        SELECT
          i.id,
          i.item_code,
          i.item_name,
          COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') AS company_name,
          COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
          i.packing,
          i.trade_price,
          i.purchase_price,
          i.retail_price,
          i.opening_stock
        FROM items i
        WHERE ${conditions.join(' AND ')}
        ORDER BY company_name ASC, i.item_name ASC
      `)
      .all(...params) as Array<Record<string, unknown>>;

    const store = db.prepare('SELECT store_name, address, phone, drug_license_number, ntn_tax_number FROM company_settings LIMIT 1').get();

    if (items.length === 0) {
      return res.json({
        success: true,
        store,
        fromDate,
        toDate,
        companies: [],
        grandTotal: {
          opening: 0,
          rcvd: 0,
          total: 0,
          today: 0,
          last_month_qty: 0,
          last_month_bonus: 0,
          sales_qty: 0,
          sales_bonus: 0,
          return_qty: 0,
          return_bonus: 0,
          net_sales_qty: 0,
          net_sales_bonus: 0,
          net_sales_amount: 0,
          closing_qty: 0,
          closing_amount: 0,
        },
      });
    }

    const idList = items.map((i) => Number(i.id));
    const ph = idList.map(() => '?').join(',');
    const { prevStart, prevEnd } = getPreviousMonthRange(fromDate || toDate || todayIso);

    const baseOpenRows = db
      .prepare(`
        SELECT
          item_id,
          COUNT(*) AS batch_count,
          COALESCE(SUM(CASE WHEN (last_purchase_id IS NULL OR last_purchase_id = 0) THEN COALESCE(opening_stock_packs, 0) ELSE 0 END), 0) AS inv_opening_packs
        FROM inventory
        WHERE item_id IN (${ph})
        GROUP BY item_id
      `)
      .all(...idList) as Array<{ item_id: number; batch_count: number; inv_opening_packs: number }>;
    const baseOpenMap = new Map(baseOpenRows.map((r) => [Number(r.item_id), r]));

    const purchaseRows = db
      .prepare(`
        SELECT pi.item_id, p.bill_date AS tx_date, pi.quantity, pi.bonus_quantity, pi.loose_quantity, pi.units_per_pack
        FROM purchase_items pi JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.status = 'completed' AND pi.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const purRetRows = db
      .prepare(`
        SELECT pri.item_id, pr.return_date AS tx_date, pri.return_quantity, pri.return_units, pri.units_per_pack
        FROM purchase_return_items pri JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
        WHERE pr.status = 'completed' AND pri.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const saleRows = db
      .prepare(`
        SELECT si.item_id, s.invoice_date AS tx_date, si.quantity, si.bonus_quantity, si.loose_quantity, si.units_per_pack, si.line_total
        FROM sale_items si JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed' AND si.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const saleRetRows = db
      .prepare(`
        SELECT sri.item_id, sr.return_date AS tx_date, sri.return_pack_qty, sri.return_bonus_qty, sri.return_loose_qty, sri.units_per_pack, sri.line_total, sri.restock_status
        FROM sale_return_items sri JOIN sale_returns sr ON sri.sale_return_id = sr.id
        WHERE sr.status = 'completed' AND sri.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const adjRows = db
      .prepare(`
        SELECT ai.item_id, adj.adjustment_date AS tx_date, ai.adjustment_mode, ai.total_units, ai.units_per_pack
        FROM stock_adjustment_items ai JOIN stock_adjustments adj ON ai.adjustment_id = adj.id
        WHERE adj.status = 'completed' AND ai.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const bucketOf = (txDate: string) => {
      if (fromDate && txDate < fromDate) return 'BEFORE';
      if (toDate && txDate > toDate) return 'AFTER';
      return 'IN';
    };

    type StatementRow = {
      item_id: number;
      item_code: string;
      item_name: string;
      company_name: string;
      item_group: string;
      trade_price: number;
      opening: number;
      rcvd: number;
      total: number;
      today: number;
      last_month_qty: number;
      last_month_bonus: number;
      sales_qty: number;
      sales_bonus: number;
      return_qty: number;
      return_bonus: number;
      net_sales_qty: number;
      net_sales_bonus: number;
      net_sales_amount: number;
      closing_qty: number;
      closing_amount: number;
    };

    const companyMap = new Map<string, StatementRow[]>();

    for (const item of items) {
      const itemId = Number(item.id);
      const parsed = parsePacking(String(item.packing || '1x1'));
      const upp = Math.max(1, parsed.unitsPerPack);
      const baseOpenInfo = baseOpenMap.get(itemId);
      const initialOpening =
        baseOpenInfo && baseOpenInfo.batch_count > 0
          ? Number(baseOpenInfo.inv_opening_packs || 0)
          : Number(item.opening_stock || 0);

      let priorBalance = initialOpening;
      let rcvdPeriod = 0;
      let todaySalesQty = 0;
      let lastMonthSalesQty = 0;
      let lastMonthBonusQty = 0;
      let salesQty = 0;
      let salesBonus = 0;
      let salesAmount = 0;
      let returnQty = 0;
      let returnBonus = 0;
      let returnAmount = 0;

      for (const r of purchaseRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = round2(Number(r.quantity || 0) + Number(r.bonus_quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') priorBalance += packs;
        else if (b === 'IN') rcvdPeriod += packs;
      }

      for (const r of purRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = Number(r.return_units || 0) > 0 ? round2(Number(r.return_units) / rUpp) : round2(Number(r.return_quantity || 0));
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') priorBalance -= packs;
        else if (b === 'IN') rcvdPeriod -= packs;
      }

      for (const r of adjRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = round2(Number(r.total_units || 0) / rUpp);
        const signed = String(r.adjustment_mode) === 'Increase' ? packs : -packs;
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') priorBalance += signed;
        else if (b === 'IN') rcvdPeriod += signed;
      }

      for (const r of saleRows) {
        if (Number(r.item_id) !== itemId) continue;
        const txDate = String(r.tx_date || '');
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paidPacks = round2(Number(r.quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const bonusPacks = round2(Number(r.bonus_quantity || 0));

        const b = bucketOf(txDate);
        if (b === 'BEFORE') {
          priorBalance -= paidPacks + bonusPacks;
        } else if (b === 'IN') {
          salesQty += paidPacks;
          salesBonus += bonusPacks;
          salesAmount += Number(r.line_total || 0);
        }

        if (txDate === toDate) {
          todaySalesQty += paidPacks;
        }
        if (txDate >= prevStart && txDate <= prevEnd) {
          lastMonthSalesQty += paidPacks;
          lastMonthBonusQty += bonusPacks;
        }
      }

      for (const r of saleRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const txDate = String(r.tx_date || '');
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const retPaid = round2(Number(r.return_pack_qty || 0) + Number(r.return_loose_qty || 0) / rUpp);
        const retBonus = round2(Number(r.return_bonus_qty || 0));
        const isRestocked = String(r.restock_status || 'restocked') === 'restocked';

        const b = bucketOf(txDate);
        if (b === 'BEFORE') {
          if (isRestocked) priorBalance += retPaid + retBonus;
        } else if (b === 'IN') {
          returnQty += retPaid;
          returnBonus += retBonus;
          returnAmount += Number(r.line_total || 0);
        }

        if (txDate === toDate) {
          todaySalesQty -= retPaid;
        }
        if (txDate >= prevStart && txDate <= prevEnd) {
          lastMonthSalesQty -= retPaid;
          lastMonthBonusQty -= retBonus;
        }
      }

      const tradePrice = round2(item.trade_price || item.purchase_price || 0);
      const opening = round2(priorBalance);
      const rcvd = round2(rcvdPeriod);
      const total = round2(opening + rcvd);
      const netSalesQty = round2(salesQty - returnQty);
      const netSalesBonus = round2(salesBonus - returnBonus);
      const netSalesAmount = round2(salesAmount - returnAmount);
      const closingQty = round2(total - netSalesQty - netSalesBonus);
      const closingAmount = round2(closingQty * tradePrice);

      const compName = String(item.company_name || 'General');
      if (!companyMap.has(compName)) companyMap.set(compName, []);
      companyMap.get(compName)!.push({
        item_id: itemId,
        item_code: String(item.item_code || ''),
        item_name: String(item.item_name || ''),
        company_name: compName,
        item_group: String(item.item_group || 'General'),
        trade_price: tradePrice,
        opening,
        rcvd,
        total,
        today: round2(todaySalesQty),
        last_month_qty: round2(lastMonthSalesQty),
        last_month_bonus: round2(lastMonthBonusQty),
        sales_qty: round2(salesQty),
        sales_bonus: round2(salesBonus),
        return_qty: round2(returnQty),
        return_bonus: round2(returnBonus),
        net_sales_qty: netSalesQty,
        net_sales_bonus: netSalesBonus,
        net_sales_amount: netSalesAmount,
        closing_qty: closingQty,
        closing_amount: closingAmount,
      });
    }

    const sumRows = (list: StatementRow[]) =>
      list.reduce(
        (acc, r) => ({
          opening: round2(acc.opening + r.opening),
          rcvd: round2(acc.rcvd + r.rcvd),
          total: round2(acc.total + r.total),
          today: round2(acc.today + r.today),
          last_month_qty: round2(acc.last_month_qty + r.last_month_qty),
          last_month_bonus: round2(acc.last_month_bonus + r.last_month_bonus),
          sales_qty: round2(acc.sales_qty + r.sales_qty),
          sales_bonus: round2(acc.sales_bonus + r.sales_bonus),
          return_qty: round2(acc.return_qty + r.return_qty),
          return_bonus: round2(acc.return_bonus + r.return_bonus),
          net_sales_qty: round2(acc.net_sales_qty + r.net_sales_qty),
          net_sales_bonus: round2(acc.net_sales_bonus + r.net_sales_bonus),
          net_sales_amount: round2(acc.net_sales_amount + r.net_sales_amount),
          closing_qty: round2(acc.closing_qty + r.closing_qty),
          closing_amount: round2(acc.closing_amount + r.closing_amount),
        }),
        {
          opening: 0,
          rcvd: 0,
          total: 0,
          today: 0,
          last_month_qty: 0,
          last_month_bonus: 0,
          sales_qty: 0,
          sales_bonus: 0,
          return_qty: 0,
          return_bonus: 0,
          net_sales_qty: 0,
          net_sales_bonus: 0,
          net_sales_amount: 0,
          closing_qty: 0,
          closing_amount: 0,
        }
      );

    const companyGroups = Array.from(companyMap.entries()).map(([companyName, rows]) => ({
      company_name: companyName,
      items: rows,
      subtotal: sumRows(rows),
    }));

    const allRows = companyGroups.flatMap((g) => g.items);
    const grandTotal = sumRows(allRows);

    res.json({
      success: true,
      store,
      fromDate: fromDate || 'Start',
      toDate,
      prevMonthRange: { prevStart, prevEnd },
      companies: companyGroups,
      grandTotal,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 3D. GET /api/inventory/detailed-stock-report
 * Detailed Item Stock & Transaction Report (17+ required columns + extended details)
 */
inventoryRouter.get('/detailed-stock-report', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const todayIso = new Date().toISOString().slice(0, 10);
    const fromDate = req.query.fromDate ? String(req.query.fromDate).trim() : '';
    const toDate = req.query.toDate ? String(req.query.toDate).trim() : todayIso;
    const companies = parseListParam(req.query.companies || req.query.companyNames);
    const itemIds = parseIdListParam(req.query.itemIds);
    const itemGroup = req.query.itemGroup ? String(req.query.itemGroup).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';

    const conditions: string[] = ["LOWER(i.status) = 'active'"];
    const params: unknown[] = [];

    if (itemIds.length > 0) {
      conditions.push(`i.id IN (${itemIds.map(() => '?').join(',')})`);
      params.push(...itemIds);
    } else if (companies.length > 0) {
      conditions.push(`COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') IN (${companies.map(() => '?').join(',')})`);
      params.push(...companies);
    }

    if (itemGroup && itemGroup.toUpperCase() !== 'ALL') {
      conditions.push(`COALESCE(NULLIF(TRIM(i.category), ''), 'General') = ?`);
      params.push(itemGroup);
    }

    if (search) {
      const term = `%${search}%`;
      conditions.push('(i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ? OR i.category LIKE ?)');
      params.push(term, term, term, term);
    }

    const items = db
      .prepare(`
        SELECT
          i.id,
          i.item_code,
          i.item_name,
          COALESCE(NULLIF(TRIM(i.company_name), ''), 'General') AS company_name,
          COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
          i.packing,
          i.purchase_price,
          i.trade_price,
          i.wholesale_price,
          i.retail_price,
          i.opening_stock
        FROM items i
        WHERE ${conditions.join(' AND ')}
        ORDER BY company_name ASC, i.item_name ASC
      `)
      .all(...params) as Array<Record<string, unknown>>;

    if (items.length === 0) {
      return res.json({ success: true, data: [], totals: {} });
    }

    const idList = items.map((i) => Number(i.id));
    const ph = idList.map(() => '?').join(',');
    const { prevStart, prevEnd } = getPreviousMonthRange(fromDate || toDate || todayIso);

    const invMetaRows = db
      .prepare(`
        SELECT
          item_id,
          COUNT(*) AS batch_count,
          COALESCE(SUM(CASE WHEN (last_purchase_id IS NULL OR last_purchase_id = 0) THEN COALESCE(opening_stock_packs, 0) ELSE 0 END), 0) AS inv_opening_packs,
          GROUP_CONCAT(DISTINCT CASE WHEN current_pack_qty > 0 THEN batch_number ELSE NULL END) AS active_batches,
          MIN(CASE WHEN current_pack_qty > 0 THEN expiry_date ELSE NULL END) AS nearest_expiry
        FROM inventory
        WHERE item_id IN (${ph})
        GROUP BY item_id
      `)
      .all(...idList) as Array<Record<string, unknown>>;
    const invMetaMap = new Map(invMetaRows.map((r) => [Number(r.item_id), r]));

    const purchaseRows = db
      .prepare(`
        SELECT pi.item_id, p.bill_date AS tx_date, pi.quantity, pi.bonus_quantity, pi.loose_quantity, pi.units_per_pack, pi.purchase_rate, pi.discount_amount, pi.line_total
        FROM purchase_items pi JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.status = 'completed' AND pi.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const purRetRows = db
      .prepare(`
        SELECT pri.item_id, pr.return_date AS tx_date, pri.return_quantity, pri.return_units, pri.units_per_pack, pri.line_total
        FROM purchase_return_items pri JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
        WHERE pr.status = 'completed' AND pri.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const saleRows = db
      .prepare(`
        SELECT si.item_id, s.invoice_date AS tx_date, si.quantity, si.bonus_quantity, si.loose_quantity, si.units_per_pack, si.unit_price, si.discount_amount, si.line_total
        FROM sale_items si JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed' AND si.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const saleRetRows = db
      .prepare(`
        SELECT sri.item_id, sr.return_date AS tx_date, sri.return_pack_qty, sri.return_bonus_qty, sri.return_loose_qty, sri.units_per_pack, sri.line_total, sri.restock_status
        FROM sale_return_items sri JOIN sale_returns sr ON sri.sale_return_id = sr.id
        WHERE sr.status = 'completed' AND sri.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const trfRows = db
      .prepare(`
        SELECT ti.item_id, trf.transfer_date AS tx_date, ti.total_units
        FROM stock_transfer_items ti JOIN stock_transfers trf ON ti.transfer_id = trf.id
        WHERE trf.status = 'completed' AND ti.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const adjRows = db
      .prepare(`
        SELECT ai.item_id, adj.adjustment_date AS tx_date, ai.adjustment_mode, ai.total_units, ai.units_per_pack
        FROM stock_adjustment_items ai JOIN stock_adjustments adj ON ai.adjustment_id = adj.id
        WHERE adj.status = 'completed' AND ai.item_id IN (${ph})
      `)
      .all(...idList) as Array<Record<string, unknown>>;

    const bucketOf = (txDate: string) => {
      if (fromDate && txDate < fromDate) return 'BEFORE';
      if (toDate && txDate > toDate) return 'AFTER';
      return 'IN';
    };

    const data = items.map((item, idx) => {
      const itemId = Number(item.id);
      const parsed = parsePacking(String(item.packing || '1x1'));
      const upp = Math.max(1, parsed.unitsPerPack);
      const invMeta = invMetaMap.get(itemId);
      const initialOpening =
        invMeta && Number(invMeta.batch_count || 0) > 0
          ? Number(invMeta.inv_opening_packs || 0)
          : Number(item.opening_stock || 0);

      let priorRegular = initialOpening;
      let priorBonus = 0;
      let lastMonthSale = 0;

      let purQty = 0;
      let purBonus = 0;
      let purVal = 0;
      let purRet = 0;

      let salePaid = 0;
      let saleBonus = 0;
      let saleVal = 0;
      let saleDisc = 0;
      let saleRetPaid = 0;
      let saleRetBonus = 0;
      let saleRetVal = 0;

      let trfIn = 0;
      let trfOut = 0;
      let adjNet = 0;

      for (const r of purchaseRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paid = round2(Number(r.quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const bonus = round2(Number(r.bonus_quantity || 0));
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') {
          priorRegular += paid;
          priorBonus += bonus;
        } else if (b === 'IN') {
          purQty += paid;
          purBonus += bonus;
          purVal += Number(r.line_total || 0);
        }
      }

      for (const r of purRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = Number(r.return_units || 0) > 0 ? round2(Number(r.return_units) / rUpp) : round2(Number(r.return_quantity || 0));
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') priorRegular -= packs;
        else if (b === 'IN') {
          purRet += packs;
          purVal -= Number(r.line_total || 0);
        }
      }

      for (const r of saleRows) {
        if (Number(r.item_id) !== itemId) continue;
        const txDate = String(r.tx_date || '');
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paid = round2(Number(r.quantity || 0) + Number(r.loose_quantity || 0) / rUpp);
        const bonus = round2(Number(r.bonus_quantity || 0));
        const b = bucketOf(txDate);
        if (b === 'BEFORE') {
          priorRegular -= paid;
          priorBonus -= bonus;
        } else if (b === 'IN') {
          salePaid += paid;
          saleBonus += bonus;
          saleVal += Number(r.line_total || 0);
          saleDisc += Number(r.discount_amount || 0);
        }
        if (txDate >= prevStart && txDate <= prevEnd) {
          lastMonthSale += paid + bonus;
        }
      }

      for (const r of saleRetRows) {
        if (Number(r.item_id) !== itemId) continue;
        const txDate = String(r.tx_date || '');
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const paidRet = round2(Number(r.return_pack_qty || 0) + Number(r.return_loose_qty || 0) / rUpp);
        const bonusRet = round2(Number(r.return_bonus_qty || 0));
        const isRestocked = String(r.restock_status || 'restocked') === 'restocked';
        const b = bucketOf(txDate);
        if (b === 'BEFORE') {
          if (isRestocked) {
            priorRegular += paidRet;
            priorBonus += bonusRet;
          }
        } else if (b === 'IN') {
          saleRetPaid += paidRet;
          saleRetBonus += bonusRet;
          saleRetVal += Number(r.line_total || 0);
        }
        if (txDate >= prevStart && txDate <= prevEnd) {
          lastMonthSale -= paidRet + bonusRet;
        }
      }

      for (const r of trfRows) {
        if (Number(r.item_id) !== itemId) continue;
        const packs = round2(Number(r.total_units || 0) / upp);
        if (bucketOf(String(r.tx_date || '')) === 'IN') {
          trfIn += packs;
          trfOut += packs;
        }
      }

      for (const r of adjRows) {
        if (Number(r.item_id) !== itemId) continue;
        const rUpp = Math.max(1, Number(r.units_per_pack || upp));
        const packs = round2(Number(r.total_units || 0) / rUpp);
        const signed = String(r.adjustment_mode) === 'Increase' ? packs : -packs;
        const b = bucketOf(String(r.tx_date || ''));
        if (b === 'BEFORE') priorRegular += signed;
        else if (b === 'IN') adjNet += signed;
      }

      const openingStock = round2(priorRegular);
      const openingBonus = round2(priorBonus);
      const purchaseQty = round2(purQty);
      const purchaseBonus = round2(purBonus);
      const purchaseReturn = round2(purRet);
      const saleQtyTotal = round2(salePaid + saleBonus);
      const saleReturnTotal = round2(saleRetPaid + saleRetBonus);
      const transferIn = round2(trfIn);
      const transferOut = round2(trfOut);
      const physicalAdjustment = round2(adjNet);

      const closingStock = round2(
        openingStock +
          openingBonus +
          purchaseQty +
          purchaseBonus -
          purchaseReturn -
          saleQtyTotal +
          saleReturnTotal +
          transferIn -
          transferOut +
          physicalAdjustment
      );

      const tradePrice = round2(item.trade_price || item.purchase_price || 0);
      const purchaseRate = round2(item.purchase_price || 0);
      const saleRate = round2(item.retail_price || item.wholesale_price || item.trade_price || 0);
      const stockValue = round2(closingStock * tradePrice);

      return {
        s_no: idx + 1,
        item_id: itemId,
        item_code: String(item.item_code || ''),
        item_name: String(item.item_name || ''),
        company_name: String(item.company_name || 'General'),
        item_group: String(item.item_group || 'General'),
        trade_price: tradePrice,
        last_month_sale: round2(lastMonthSale),
        opening_stock: openingStock,
        opening_bonus: openingBonus,
        purchase_qty: purchaseQty,
        purchase_bonus: purchaseBonus,
        purchase_return: purchaseReturn,
        sale_qty: saleQtyTotal,
        sale_paid_qty: round2(salePaid),
        sale_bonus_qty: round2(saleBonus),
        sale_return: saleReturnTotal,
        transfer_in: transferIn,
        transfer_out: transferOut,
        physical_adjustment: physicalAdjustment,
        closing_stock: closingStock,
        purchase_rate: purchaseRate,
        sale_rate: saleRate,
        total_purchase_value: round2(purVal),
        total_sales_value: round2(saleVal - saleRetVal),
        discount_amount: round2(saleDisc),
        batch_number: String(invMeta?.active_batches || '—'),
        expiry_date: String(invMeta?.nearest_expiry || '—'),
        packing: String(item.packing || '1x1'),
        stock_value: stockValue,
      };
    });

    const totals = data.reduce(
      (acc, r) => ({
        last_month_sale: round2(acc.last_month_sale + r.last_month_sale),
        opening_stock: round2(acc.opening_stock + r.opening_stock),
        opening_bonus: round2(acc.opening_bonus + r.opening_bonus),
        purchase_qty: round2(acc.purchase_qty + r.purchase_qty),
        purchase_bonus: round2(acc.purchase_bonus + r.purchase_bonus),
        purchase_return: round2(acc.purchase_return + r.purchase_return),
        sale_qty: round2(acc.sale_qty + r.sale_qty),
        sale_return: round2(acc.sale_return + r.sale_return),
        transfer_in: round2(acc.transfer_in + r.transfer_in),
        transfer_out: round2(acc.transfer_out + r.transfer_out),
        physical_adjustment: round2(acc.physical_adjustment + r.physical_adjustment),
        closing_stock: round2(acc.closing_stock + r.closing_stock),
        total_purchase_value: round2(acc.total_purchase_value + r.total_purchase_value),
        total_sales_value: round2(acc.total_sales_value + r.total_sales_value),
        discount_amount: round2(acc.discount_amount + r.discount_amount),
        stock_value: round2(acc.stock_value + r.stock_value),
      }),
      {
        last_month_sale: 0,
        opening_stock: 0,
        opening_bonus: 0,
        purchase_qty: 0,
        purchase_bonus: 0,
        purchase_return: 0,
        sale_qty: 0,
        sale_return: 0,
        transfer_in: 0,
        transfer_out: 0,
        physical_adjustment: 0,
        closing_stock: 0,
        total_purchase_value: 0,
        total_sales_value: 0,
        discount_amount: 0,
        stock_value: 0,
      }
    );

    res.json({ success: true, count: data.length, data, totals });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 4. GET /api/inventory/expiry-alerts
 * Expiry categorization and alert lists (supports filter: ALL | EXPIRED | 30_DAYS | 60_DAYS | 90_DAYS)
 */
inventoryRouter.get('/expiry-alerts', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { days, filter = 'ALL' } = req.query;

    const settings = db
      .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
      .get() as { near_expiry_days?: number } | undefined;
    const thresholdDays = days ? parseInt(String(days), 10) : settings?.near_expiry_days || 90;

    const allBatches = db
      .prepare(`
        SELECT
          inv.*,
          i.item_code,
          i.item_name,
          i.company_name,
          i.packing,
          COALESCE(inv.rack_shelf, i.rack_number, '') as rack_location
        FROM inventory inv
        JOIN items i ON inv.item_id = i.id
        WHERE inv.current_pack_qty > 0
        ORDER BY inv.expiry_date ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const enriched = allBatches.map((item) => {
      const exp = computeExpiryStatus(String(item.expiry_date || ''), thresholdDays);
      const costAtRisk = round2(Number(item.current_pack_qty || 0) * Number(item.pack_cost || 0));
      return {
        ...item,
        id: Number(item.id),
        mfg_date: String(item.manufacturing_date || ''),
        days_to_expiry: exp.daysToExpiry,
        expiry_status: exp.status,
        expiry_tier: exp.tier,
        total_units: round2(item.total_stock_units || 0),
        purchase_rate: round2(item.pack_cost || 0),
        retail_price: round2(item.pack_retail || 0),
        total_cost_at_risk: costAtRisk,
        stock_value: costAtRisk,
        rack_location: String(item.rack_location || ''),
      };
    });

    const expiredList = enriched.filter((e) => e.expiry_tier === 'EXPIRED');
    const days30List = enriched.filter((e) => e.expiry_tier === '30_DAYS');
    const days60List = enriched.filter((e) => e.expiry_tier === '60_DAYS');
    const days90List = enriched.filter((e) => e.expiry_tier === '90_DAYS');
    const allAlertList = enriched.filter((e) => e.expiry_tier !== 'BEYOND_90');

    const fUpper = String(filter || 'ALL').toUpperCase();
    let filteredData = allAlertList;
    if (fUpper === 'EXPIRED') filteredData = expiredList;
    else if (fUpper === '30_DAYS') filteredData = days30List;
    else if (fUpper === '60_DAYS') filteredData = days60List;
    else if (fUpper === '90_DAYS') filteredData = days90List;

    res.json({
      success: true,
      thresholdDays,
      data: filteredData,
      expired: expiredList,
      nearExpiry: [...days30List, ...days60List, ...days90List],
      summary: {
        expired: expiredList.length,
        days_30: days30List.length,
        days_60: days60List.length,
        days_90: days90List.length,
        total_cost_at_risk: round2(allAlertList.reduce((s, r) => s + r.total_cost_at_risk, 0)),
        expiredCount: expiredList.length,
        expiredPacks: round2(expiredList.reduce((sum, i: any) => sum + Number(i.current_pack_qty || 0), 0)),
        expiredCostValue: round2(expiredList.reduce((sum, i) => sum + i.total_cost_at_risk, 0)),
        nearExpiryCount: days30List.length + days60List.length + days90List.length,
        nearExpiryPacks: round2(
          [...days30List, ...days60List, ...days90List].reduce((sum, i: any) => sum + Number(i.current_pack_qty || 0), 0)
        ),
        nearExpiryCostValue: round2(
          [...days30List, ...days60List, ...days90List].reduce((sum, i) => sum + i.total_cost_at_risk, 0)
        ),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 5. GET /api/inventory/low-stock
 * Low Stock & Out-of-Stock Items with Reorder Planning
 */
inventoryRouter.get('/low-stock', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const search = req.query.search ? String(req.query.search).trim() : '';
    const company = req.query.company ? String(req.query.company).trim() : '';

    const conditions: string[] = ["LOWER(i.status) = 'active'"];
    const params: unknown[] = [];

    if (search) {
      const term = `%${search}%`;
      conditions.push('(i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ? OR i.generic_name LIKE ?)');
      params.push(term, term, term, term);
    }
    if (company && company.toUpperCase() !== 'ALL') {
      conditions.push('i.company_name = ?');
      params.push(company);
    }

    const sql = `
      SELECT
        i.id as item_id,
        i.item_code,
        i.item_name,
        COALESCE(i.generic_name, '') as generic_name,
        i.company_name,
        i.category,
        i.packing,
        i.purchase_price,
        i.retail_price,
        i.minimum_stock,
        i.rack_number,
        COALESCE(inv.total_packs, 0.0) as current_packs,
        COALESCE(inv.total_loose, 0.0) as current_loose,
        COALESCE(inv.total_units, 0.0) as total_current_units
      FROM items i
      LEFT JOIN (
        SELECT
          item_id,
          SUM(current_pack_qty) as total_packs,
          SUM(current_loose_qty) as total_loose,
          SUM(total_stock_units) as total_units
        FROM inventory
        GROUP BY item_id
      ) inv ON i.id = inv.item_id
      WHERE ${conditions.join(' AND ')}
        AND (
          COALESCE(inv.total_packs, 0.0) <= 0
          OR (i.minimum_stock > 0 AND COALESCE(inv.total_packs, 0.0) <= i.minimum_stock)
        )
      ORDER BY (i.minimum_stock - COALESCE(inv.total_packs, 0.0)) DESC, i.item_name ASC
    `;

    const rawRows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const rows = rawRows.map((r) => {
      const parsed = parsePacking(String(r.packing || '1x1'));
      const currPacks = round2(r.current_packs);
      const minLevel = Number(r.minimum_stock || 0);
      const deficit = Math.max(0, round2(minLevel - currPacks));
      const suggestedOrder = deficit > 0 ? deficit : currPacks <= 0 ? 10 : 0;
      const pRate = round2(r.purchase_price);
      const estCost = round2(suggestedOrder * pRate);
      const itemStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' = currPacks <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';

      return {
        ...r,
        units_per_pack: parsed.unitsPerPack,
        min_stock_level: minLevel,
        reorder_level: minLevel,
        current_packs: currPacks,
        current_loose: round2(r.current_loose),
        total_current_units: round2(r.total_current_units),
        deficit_packs: deficit,
        suggested_order_packs: suggestedOrder,
        last_purchase_rate: pRate,
        estimated_reorder_cost: estCost,
        status: itemStatus,
        current_stock_packs: currPacks,
        current_stock_units: round2(r.total_current_units),
      };
    });

    const outOfStockCount = rows.filter((r) => r.status === 'OUT_OF_STOCK').length;
    const lowStockCount = rows.filter((r) => r.status === 'LOW_STOCK').length;
    const totalEstimate = round2(rows.reduce((sum, r) => sum + r.estimated_reorder_cost, 0));

    res.json({
      success: true,
      count: rows.length,
      data: rows,
      totalEstimatedCost: totalEstimate,
      summary: {
        out_of_stock_count: outOfStockCount,
        low_stock_count: lowStockCount,
        total_reorder_cost_estimate: totalEstimate,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 6. GET /api/inventory/adjustments
 * List past stock adjustments with audit details
 */
inventoryRouter.get('/adjustments', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { startDate, endDate, type, limit } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (startDate) {
      conditions.push('adj.adjustment_date >= ?');
      params.push(String(startDate));
    }
    if (endDate) {
      conditions.push('adj.adjustment_date <= ?');
      params.push(String(endDate));
    }
    if (type && type !== 'all') {
      conditions.push('adj.adjustment_type = ?');
      params.push(String(type));
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitSql = limit ? `LIMIT ${Math.min(500, Math.max(1, Number(limit)))}` : '';

    const rawAdjustments = db
      .prepare(`
        SELECT
          adj.*,
          je.entry_number as journal_entry_number
        FROM stock_adjustments adj
        LEFT JOIN journal_entries je ON adj.journal_entry_id = je.id
        ${whereSql}
        ORDER BY adj.adjustment_date DESC, adj.id DESC
        ${limitSql}
      `)
      .all(...params) as Array<Record<string, unknown>>;

    const adjustments = rawAdjustments.map((adj) => ({
      ...adj,
      adjustment_no: String(adj.adjustment_number || ''),
      reason_category: normalizeAdjustmentHeaderCategory(String(adj.adjustment_type || '')),
      description: String(adj.reason || ''),
      reference_no: adj.reference_no ? String(adj.reference_no) : null,
      created_by: Number(adj.created_by_user_id || 0),
      created_by_name: String(adj.created_by_username || 'Super Admin'),
      journal_voucher_id: adj.journal_entry_id ? Number(adj.journal_entry_id) : null,
    }));

    res.json({
      success: true,
      count: adjustments.length,
      adjustments,
      data: adjustments,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/inventory/adjustments/:id
 * Get single adjustment details with items
 */
inventoryRouter.get('/adjustments/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    const adj = db
      .prepare(`
        SELECT adj.*, je.entry_number as journal_entry_number
        FROM stock_adjustments adj
        LEFT JOIN journal_entries je ON adj.journal_entry_id = je.id
        WHERE adj.id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;

    if (!adj) {
      return res.status(404).json({ success: false, error: 'Stock adjustment record not found.' });
    }

    const rawItems = db
      .prepare('SELECT * FROM stock_adjustment_items WHERE adjustment_id = ?')
      .all(id) as Array<Record<string, unknown>>;

    const items = rawItems.map((it) => ({
      ...it,
      direction: String(it.adjustment_mode) === 'Increase' ? 'INCREASE' : 'DECREASE',
      quantity_packs: round2(it.pack_qty || 0),
      quantity_loose: round2(it.loose_qty || 0),
      unit_cost: round2(Number(it.cost_price_per_unit || 0) * Math.max(1, Number(it.units_per_pack || 1))),
      reason_note: it.remarks ? String(it.remarks) : null,
    }));

    const formatted = {
      ...adj,
      adjustment_no: String(adj.adjustment_number || ''),
      reason_category: normalizeAdjustmentHeaderCategory(String(adj.adjustment_type || '')),
      description: String(adj.reason || ''),
      reference_no: adj.reference_no ? String(adj.reference_no) : null,
      created_by: Number(adj.created_by_user_id || 0),
      created_by_name: String(adj.created_by_username || 'Super Admin'),
      journal_voucher_id: adj.journal_entry_id ? Number(adj.journal_entry_id) : null,
      items,
    };

    res.json({ success: true, adjustment: formatted, data: formatted });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/inventory/adjustments
 * Create confirmed stock adjustment (supports both frontend and legacy field names + duplicate protection)
 */
inventoryRouter.post('/adjustments', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body;
    const currentUser = req.user?.username || 'Super Admin';
    const currentUserId = req.user?.id || null;

    const adjustmentDate = String(body.adjustment_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    assertPeriodOpen(adjustmentDate, 'create a stock adjustment');
    const rawType = body.adjustment_type || body.reason_category || 'Physical Difference';
    const adjustmentType = toDbAdjustmentType(String(rawType));
    const reasonText = String(body.reason || body.description || '').trim();
    const referenceNo = body.reference_no ? String(body.reference_no).trim() : null;
    const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).trim() : null;
    const items = body.items;

    if (!reasonText) {
      return res.status(400).json({ success: false, error: 'Adjustment reason / description is required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine line item is required.' });
    }

    // Duplicate prevention: idempotency_key OR identical reference_no on same date
    if (idempotencyKey) {
      const existingIdemp = db
        .prepare('SELECT id, adjustment_number FROM stock_adjustments WHERE idempotency_key = ?')
        .get(idempotencyKey) as { id: number; adjustment_number: string } | undefined;
      if (existingIdemp) {
        return res.status(409).json({
          success: false,
          error: `Duplicate stock adjustment prevented. This submission was already posted as ${existingIdemp.adjustment_number}.`,
        });
      }
    }
    if (referenceNo) {
      const existingRef = db
        .prepare("SELECT id, adjustment_number FROM stock_adjustments WHERE reference_no = ? AND status = 'completed'")
        .get(referenceNo) as { id: number; adjustment_number: string } | undefined;
      if (existingRef) {
        return res.status(409).json({
          success: false,
          error: `Duplicate Reference # "${referenceNo}" already exists on Stock Adjustment ${existingRef.adjustment_number}.`,
        });
      }
    }

    let createdAdjId = 0;
    let finalAdjustmentNumber = '';
    let createdJeId: number | null = null;

    const executeAdjustment = db.transaction(() => {
      const year = new Date().getFullYear();
      const lastAdj = db
        .prepare('SELECT id FROM stock_adjustments ORDER BY id DESC LIMIT 1')
        .get() as { id: number } | undefined;
      const nextSeq = (lastAdj?.id || 0) + 1;
      finalAdjustmentNumber = `ADJ-${year}-${String(nextSeq).padStart(4, '0')}`;

      let totalCostImpact = 0;

      interface ValidatedAdjLine {
        itemId: number;
        inventoryId: number;
        itemCode: string;
        itemName: string;
        companyName: string;
        batchNumber: string;
        expiryDate: string;
        packing: string;
        unitsPerPack: number;
        mode: 'Increase' | 'Decrease';
        packQty: number;
        looseQty: number;
        totalUnits: number;
        currentStockUnits: number;
        newStockUnits: number;
        costPerUnit: number;
        lineCost: number;
        reasonCategory:
          | 'Damage'
          | 'Expired'
          | 'Physical Difference'
          | 'Opening Correction'
          | 'Supplier Bonus Correction'
          | 'Breakage / Leakage'
          | 'General Adjustment';
        remarks: string;
      }

      const validatedLines: ValidatedAdjLine[] = [];
      const seenBatchIds = new Set<number>();

      for (let i = 0; i < items.length; i++) {
        const line = items[i];
        let inventoryId = line.inventory_id ? Number(line.inventory_id) : 0;

        // Support item_id lookup if inventory_id wasn't supplied directly
        if (!inventoryId && line.item_id) {
          const fallbackBatch = db
            .prepare(`
              SELECT id FROM inventory
              WHERE item_id = ?
              ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, expiry_date ASC, id DESC
              LIMIT 1
            `)
            .get(Number(line.item_id)) as { id: number } | undefined;
          if (fallbackBatch) {
            inventoryId = Number(fallbackBatch.id);
          }
        }

        if (!inventoryId) {
          throw new Error(`Row #${i + 1}: Batch selection is required.`);
        }
        if (seenBatchIds.has(inventoryId)) {
          throw new Error(`Duplicate batch detected in adjustment lines (Batch ID ${inventoryId}). Please combine quantities per batch.`);
        }
        seenBatchIds.add(inventoryId);

        const invRow = db
          .prepare(`
            SELECT inv.*, itm.item_name, itm.item_code, itm.company_name, itm.minimum_stock
            FROM inventory inv
            JOIN items itm ON inv.item_id = itm.id
            WHERE inv.id = ?
          `)
          .get(inventoryId) as Record<string, unknown> | undefined;

        if (!invRow) {
          throw new Error(`Row #${i + 1}: Selected batch inventory record does not exist.`);
        }

        const unitsPerPack = Math.max(1, Number(invRow.units_per_pack || 1));
        const packQty = round2(Math.max(0, Number(line.pack_qty ?? line.quantity_packs ?? 0)));
        const looseQty = round2(Math.max(0, Number(line.loose_qty ?? line.quantity_loose ?? 0)));
        const deltaUnits = round2(packQty * unitsPerPack + looseQty);

        if (deltaUnits <= 0) {
          throw new Error(`Row #${i + 1} (${invRow.item_name}): Adjustment quantity must be greater than 0.`);
        }

        const rawDir = String(line.adjustment_mode || line.direction || 'Decrease').toUpperCase();
        const mode: 'Increase' | 'Decrease' = rawDir === 'INCREASE' ? 'Increase' : 'Decrease';
        const currentStockUnits = Number(invRow.total_stock_units || 0);

        if (mode === 'Decrease' && deltaUnits > currentStockUnits) {
          throw new Error(
            `Row #${i + 1} (${invRow.item_name}): Cannot decrease by ${round2(deltaUnits / unitsPerPack)} packs (${deltaUnits} units). Available stock is only ${round2(currentStockUnits / unitsPerPack)} packs (${currentStockUnits} units).`
          );
        }

        const newStockUnits =
          mode === 'Increase'
            ? round2(currentStockUnits + deltaUnits)
            : round2(currentStockUnits - deltaUnits);

        const overridePackCost = line.unit_cost !== undefined ? Number(line.unit_cost) : null;
        const costPerUnit =
          overridePackCost !== null && overridePackCost >= 0
            ? round2(overridePackCost / unitsPerPack)
            : Number(invRow.cost_price || 0);
        const lineCost = round2(deltaUnits * costPerUnit);

        if (mode === 'Increase') {
          totalCostImpact = round2(totalCostImpact + lineCost);
        } else {
          totalCostImpact = round2(totalCostImpact - lineCost);
        }

        validatedLines.push({
          itemId: Number(invRow.item_id),
          inventoryId,
          itemCode: String(invRow.item_code),
          itemName: String(invRow.item_name),
          companyName: String(invRow.company_name || ''),
          batchNumber: String(invRow.batch_number),
          expiryDate: String(invRow.expiry_date),
          packing: String(invRow.packing || '1x1'),
          unitsPerPack,
          mode,
          packQty,
          looseQty,
          totalUnits: deltaUnits,
          currentStockUnits,
          newStockUnits,
          costPerUnit,
          lineCost,
          reasonCategory: toDbLineReasonCategory(String(line.reason_category || rawType || 'General Adjustment')),
          remarks: String(line.remarks ?? line.reason_note ?? '').trim(),
        });
      }

      const insertAdj = db
        .prepare(`
          INSERT INTO stock_adjustments (
            adjustment_number, adjustment_date, adjustment_type, total_items,
            total_cost_impact, created_by_user_id, created_by_username,
            reason, reference_no, idempotency_key, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
        `)
        .run(
          finalAdjustmentNumber,
          adjustmentDate,
          adjustmentType,
          validatedLines.length,
          totalCostImpact,
          currentUserId,
          currentUser,
          reasonText,
          referenceNo,
          idempotencyKey
        );

      createdAdjId = Number(insertAdj.lastInsertRowid);

      const insertLineStmt = db.prepare(`
        INSERT INTO stock_adjustment_items (
          adjustment_id, item_id, inventory_id, item_code, item_name, company_name,
          batch_number, expiry_date, packing, units_per_pack, adjustment_mode,
          pack_qty, loose_qty, total_units, system_stock_units, new_stock_units,
          cost_price_per_unit, total_cost, reason_category, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of validatedLines) {
        insertLineStmt.run(
          createdAdjId,
          line.itemId,
          line.inventoryId,
          line.itemCode,
          line.itemName,
          line.companyName,
          line.batchNumber,
          line.expiryDate,
          line.packing,
          line.unitsPerPack,
          line.mode,
          line.packQty,
          line.looseQty,
          line.totalUnits,
          line.currentStockUnits,
          line.newStockUnits,
          line.costPerUnit,
          line.lineCost,
          line.reasonCategory,
          line.remarks
        );

        const newPackQty = round2(line.newStockUnits / line.unitsPerPack);
        const newLooseQty = round2(line.newStockUnits % line.unitsPerPack);
        const parsed = parsePacking(line.packing);
        const newStripQty = round2(newPackQty * parsed.stripsPerBox);

        const deltaPacks =
          line.mode === 'Increase'
            ? round2(line.totalUnits / line.unitsPerPack)
            : -round2(line.totalUnits / line.unitsPerPack);

        const invRow = db.prepare('SELECT adjusted_qty FROM inventory WHERE id = ?').get(line.inventoryId) as { adjusted_qty?: number };
        const currentAdj = Number(invRow?.adjusted_qty || 0);

        const minStockRow = db.prepare('SELECT minimum_stock FROM items WHERE id = ?').get(line.itemId) as { minimum_stock?: number };
        const status = computeBatchStockStatus(newPackQty, line.expiryDate, Number(minStockRow?.minimum_stock || 0));

        db.prepare(`
          UPDATE inventory
          SET current_pack_qty = ?,
              current_strip_qty = ?,
              current_loose_qty = ?,
              total_stock_units = ?,
              adjusted_qty = ?,
              status = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          newPackQty,
          newStripQty,
          newLooseQty,
          line.newStockUnits,
          round2(currentAdj + deltaPacks),
          status,
          line.inventoryId
        );
      }

      const absCostImpact = round2(Math.abs(totalCostImpact));
      if (absCostImpact > 0) {
        const invAssetAccId = getAccountIdByCode('INV-1030');
        const adjExpenseAccId = getAccountIdByCode('ADJ-5035');
        const adjIncomeAccId = getAccountIdByCode('ADJ-4035');

        const entryNumber = `JE-ADJ-${year}-${String(createdAdjId).padStart(4, '0')}`;
        const desc = `Stock Adjustment ${finalAdjustmentNumber} (${adjustmentType}): ${reasonText}`;

        const insertJe = db
          .prepare(`
            INSERT INTO journal_entries (
              entry_number, entry_date, reference_type, reference_id, description,
              total_debit, total_credit, is_balanced, status
            ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?, 1, 'posted')
          `)
          .run(entryNumber, adjustmentDate, createdAdjId, desc, absCostImpact, absCostImpact);

        createdJeId = Number(insertJe.lastInsertRowid);

        const insertLine = db.prepare(`
          INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
          ) VALUES (?, ?, 'general', ?, ?, ?)
        `);

        if (totalCostImpact < 0) {
          insertLine.run(createdJeId, adjExpenseAccId, absCostImpact, 0, `Stock reduction loss: ${reasonText}`);
          insertLine.run(createdJeId, invAssetAccId, 0, absCostImpact, `Inventory asset write-off: ${reasonText}`);
        } else {
          insertLine.run(createdJeId, invAssetAccId, absCostImpact, 0, `Inventory asset increase: ${reasonText}`);
          insertLine.run(createdJeId, adjIncomeAccId, 0, absCostImpact, `Stock surplus income: ${reasonText}`);
        }

        db.prepare('UPDATE stock_adjustments SET journal_entry_id = ? WHERE id = ?').run(createdJeId, createdAdjId);
      }
    });

    executeAdjustment();

    res.json({
      success: true,
      message: `Stock Adjustment ${finalAdjustmentNumber} recorded and stock successfully adjusted.`,
      adjustment_no: finalAdjustmentNumber,
      adjustment_id: createdAdjId,
      journal_voucher_id: createdJeId,
      adjustmentId: createdAdjId,
      adjustmentNumber: finalAdjustmentNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * 7. GET /api/inventory/transfers & POST /api/inventory/transfers
 * Stock Transfers (Rack/Shelf and Store Locations)
 */
inventoryRouter.get('/transfers', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rawRows = db.prepare('SELECT * FROM stock_transfers ORDER BY id DESC').all() as Array<Record<string, unknown>>;
    const transfers = rawRows.map((r) => ({
      ...r,
      transfer_no: String(r.transfer_number || ''),
      reference_no: r.reference_no ? String(r.reference_no) : null,
      remarks: r.reason ? String(r.reason) : null,
      created_by: 0,
      created_by_name: String(r.created_by_username || 'Super Admin'),
    }));
    res.json({ success: true, count: transfers.length, transfers, data: transfers });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

inventoryRouter.post('/transfers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body;
    const currentUser = req.user?.username || 'Super Admin';

    const {
      transfer_date = new Date().toISOString().slice(0, 10),
      from_location,
      to_location,
      reference_no = null,
      items,
    } = body;
    assertPeriodOpen(String(transfer_date).slice(0, 10), 'create a stock transfer');
    const reasonText = String(body.reason ?? body.remarks ?? '').trim();

    if (!from_location || !to_location) {
      return res.status(400).json({ success: false, error: 'From and To locations are required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine batch item is required.' });
    }

    let createdTrfId = 0;
    let transferNumber = '';

    const executeTransfer = db.transaction(() => {
      const year = new Date().getFullYear();
      const lastTrf = db.prepare('SELECT id FROM stock_transfers ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
      transferNumber = `TRF-${year}-${String((lastTrf?.id || 0) + 1).padStart(4, '0')}`;

      let totalUnits = 0;

      const insertTrf = db
        .prepare(`
          INSERT INTO stock_transfers (
            transfer_number, transfer_date, from_location, to_location,
            total_items, total_units, created_by_username, reason, reference_no, status
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'completed')
        `)
        .run(
          transferNumber,
          transfer_date,
          String(from_location).trim(),
          String(to_location).trim(),
          items.length,
          currentUser,
          reasonText,
          reference_no ? String(reference_no).trim() : null
        );

      createdTrfId = Number(insertTrf.lastInsertRowid);

      const insertLine = db.prepare(`
        INSERT INTO stock_transfer_items (
          transfer_id, item_id, inventory_id, item_code, item_name,
          batch_number, pack_qty, loose_qty, total_units,
          from_shelf, to_shelf, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of items) {
        const invId = Number(line.inventory_id);
        const inv = db
          .prepare('SELECT inv.*, i.item_name, i.item_code FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ?')
          .get(invId) as Record<string, unknown> | undefined;

        if (!inv) throw new Error(`Batch ID ${invId} does not exist.`);

        const unitsPerPack = Math.max(1, Number(inv.units_per_pack || 1));
        const packQty = round2(Number(line.pack_qty ?? line.quantity_packs ?? 0));
        const looseQty = round2(Number(line.loose_qty ?? line.quantity_loose ?? 0));
        const lineUnits = round2(packQty * unitsPerPack + looseQty);

        totalUnits = round2(totalUnits + lineUnits);

        const fromShelf = String(line.from_shelf ?? line.from_rack ?? inv.rack_shelf ?? from_location);
        const toShelf = String(line.to_shelf ?? line.to_rack ?? to_location);

        insertLine.run(
          createdTrfId,
          inv.item_id,
          invId,
          inv.item_code,
          inv.item_name,
          inv.batch_number,
          packQty,
          looseQty,
          lineUnits,
          fromShelf,
          toShelf,
          String(line.remarks || '')
        );

        if (toShelf) {
          db.prepare('UPDATE inventory SET rack_shelf = ? WHERE id = ?').run(toShelf, invId);
        }
      }

      db.prepare('UPDATE stock_transfers SET total_units = ? WHERE id = ?').run(totalUnits, createdTrfId);
    });

    executeTransfer();

    res.json({
      success: true,
      message: `Stock Transfer ${transferNumber} recorded successfully.`,
      transfer_no: transferNumber,
      transfer_id: createdTrfId,
      transferId: createdTrfId,
      transferNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 8. GET /api/inventory/stock-ledger
 * Chronological Item Log & Transaction History (Full Pack Rule applied; supports single item or all items)
 */
inventoryRouter.get('/stock-ledger', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rawItemId = req.query.item_id ?? req.query.itemId;
    const itemIdNum = rawItemId && String(rawItemId) !== 'All' ? Number(rawItemId) : null;
    const batchNumber = (req.query.batch_number ?? req.query.batchNumber) as string | undefined;
    const fromDate = (req.query.from_date ?? req.query.startDate) as string | undefined;
    const toDate = (req.query.to_date ?? req.query.endDate) as string | undefined;

    let itemRow: Record<string, unknown> | undefined;
    if (itemIdNum) {
      itemRow = db.prepare('SELECT * FROM items WHERE id = ?').get(itemIdNum) as Record<string, unknown> | undefined;
      if (!itemRow) {
        return res.status(404).json({ success: false, error: 'Item not found in Items Master.' });
      }
    }

    const itemUppMap = new Map<number, { unitsPerPack: number; code: string; name: string; company: string; group: string; packing: string; purchasePrice: number }>();
    const allItemsMeta = db
      .prepare('SELECT id, item_code, item_name, company_name, category, packing, purchase_price FROM items')
      .all() as Array<Record<string, unknown>>;
    for (const it of allItemsMeta) {
      const parsed = parsePacking(String(it.packing || '1x1'));
      itemUppMap.set(Number(it.id), {
        unitsPerPack: Math.max(1, parsed.unitsPerPack),
        code: String(it.item_code || ''),
        name: String(it.item_name || ''),
        company: String(it.company_name || 'General'),
        group: String(it.category || 'General'),
        packing: String(it.packing || '1x1'),
        purchasePrice: round2(it.purchase_price || 0),
      });
    }

    interface RichLedgerEntry {
      transaction_id: string;
      date: string;
      timestamp: string;
      type:
        | 'OPENING'
        | 'PURCHASE'
        | 'PURCHASE_BONUS'
        | 'SALE'
        | 'PURCHASE_RETURN'
        | 'SALES_RETURN'
        | 'ADJUSTMENT_IN'
        | 'ADJUSTMENT_OUT'
        | 'TRANSFER_IN'
        | 'TRANSFER_OUT';
      type_label: string;
      docType: string;
      ref_no: string;
      docNumber: string;
      party_name: string;
      partyName: string;
      item_id: number;
      item_code: string;
      item_name: string;
      company_name: string;
      item_group: string;
      batch_number: string;
      batchNumber: string;
      expiry_date: string;
      expiryDate: string;
      opening_packs: number;
      purchase_packs: number;
      purchase_bonus_packs: number;
      purchase_return_packs: number;
      sale_packs: number;
      sale_bonus_packs: number;
      sale_return_packs: number;
      transfer_in_packs: number;
      transfer_out_packs: number;
      in_packs: number;
      in_loose: number;
      out_packs: number;
      out_loose: number;
      net_pack_change: number;
      running_pack_balance: number;
      running_loose_balance: number;
      runningBalancePacks: number;
      unit_cost: number;
      unitRate: number;
      discount_amount: number;
      debit_amount: number;
      credit_amount: number;
      totalAmount: number;
      remarks: string;
      notes: string;
      user_name: string;
    }

    const entries: RichLedgerEntry[] = [];
    const itemFilterClause = (alias: string) => (itemIdNum ? ` AND ${alias}.item_id = ? ` : '');
    const batchFilterClause = (alias: string) => (batchNumber ? ` AND ${alias}.batch_number LIKE ? ` : '');
    const buildParams = (): unknown[] => {
      const p: unknown[] = [];
      if (itemIdNum) p.push(itemIdNum);
      if (batchNumber) p.push(`%${batchNumber.trim()}%`);
      return p;
    };

    // A. Opening Stock
    const openRows = db
      .prepare(`
        SELECT inv.*
        FROM inventory inv
        WHERE (inv.last_purchase_id IS NULL OR inv.last_purchase_id = 0)
          AND COALESCE(inv.opening_stock_packs, 0) > 0
          ${itemFilterClause('inv')}
          ${batchFilterClause('inv')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const b of openRows) {
      const iid = Number(b.item_id);
      const meta = itemUppMap.get(iid);
      const packs = round2(b.opening_stock_packs || 0);
      const rate = round2(b.pack_cost || meta?.purchasePrice || 0);
      const amt = round2(packs * rate);
      entries.push({
        transaction_id: `OPN-${b.id}`,
        date: String(b.created_at || '2026-01-01').slice(0, 10),
        timestamp: String(b.created_at || '2026-01-01 00:00:00'),
        type: 'OPENING',
        type_label: 'Opening Stock',
        docType: 'Opening Stock',
        ref_no: `OPN-${b.id}`,
        docNumber: `OPN-${b.id}`,
        party_name: 'Store Initial Balance',
        partyName: 'Store Initial Balance',
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(b.batch_number || ''),
        batchNumber: String(b.batch_number || ''),
        expiry_date: String(b.expiry_date || ''),
        expiryDate: String(b.expiry_date || ''),
        opening_packs: packs,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: 0,
        sale_packs: 0,
        sale_bonus_packs: 0,
        sale_return_packs: 0,
        transfer_in_packs: 0,
        transfer_out_packs: 0,
        in_packs: packs,
        in_loose: 0,
        out_packs: 0,
        out_loose: 0,
        net_pack_change: packs,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: rate,
        unitRate: rate,
        discount_amount: 0,
        debit_amount: amt,
        credit_amount: 0,
        totalAmount: amt,
        remarks: 'Initial warehouse opening balance',
        notes: 'Initial warehouse opening balance',
        user_name: 'System',
      });
    }

    // B. Purchases & Purchase Bonus
    const purRows = db
      .prepare(`
        SELECT
          pi.id as line_id, pi.item_id, pi.batch_number, pi.expiry_date,
          pi.quantity, pi.bonus_quantity, pi.loose_quantity, pi.units_per_pack,
          pi.purchase_rate, pi.discount_amount, pi.line_total,
          p.bill_number, p.bill_date, p.created_at, p.created_by,
          COALESCE(a.account_name, 'Supplier') as supplier_name
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN accounts a ON p.supplier_account_id = a.id
        WHERE p.status = 'completed'
          ${itemFilterClause('pi')}
          ${batchFilterClause('pi')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const p of purRows) {
      const iid = Number(p.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, Number(p.units_per_pack || meta?.unitsPerPack || 1));
      const purchasedPacks = round2(Number(p.quantity || 0) + Number(p.loose_quantity || 0) / upp);
      const bonusPacks = round2(Number(p.bonus_quantity || 0));

      if (purchasedPacks > 0) {
        const amt = round2(p.line_total || 0);
        entries.push({
          transaction_id: `PUR-${p.line_id}`,
          date: String(p.bill_date),
          timestamp: String(p.created_at || p.bill_date),
          type: 'PURCHASE',
          type_label: 'Purchase',
          docType: 'Purchase',
          ref_no: String(p.bill_number),
          docNumber: String(p.bill_number),
          party_name: String(p.supplier_name || 'Supplier'),
          partyName: String(p.supplier_name || 'Supplier'),
          item_id: iid,
          item_code: meta?.code || '',
          item_name: meta?.name || '',
          company_name: meta?.company || '',
          item_group: meta?.group || 'General',
          batch_number: String(p.batch_number || ''),
          batchNumber: String(p.batch_number || ''),
          expiry_date: String(p.expiry_date || ''),
          expiryDate: String(p.expiry_date || ''),
          opening_packs: 0,
          purchase_packs: purchasedPacks,
          purchase_bonus_packs: 0,
          purchase_return_packs: 0,
          sale_packs: 0,
          sale_bonus_packs: 0,
          sale_return_packs: 0,
          transfer_in_packs: 0,
          transfer_out_packs: 0,
          in_packs: purchasedPacks,
          in_loose: 0,
          out_packs: 0,
          out_loose: 0,
          net_pack_change: purchasedPacks,
          running_pack_balance: 0,
          running_loose_balance: 0,
          runningBalancePacks: 0,
          unit_cost: round2(p.purchase_rate),
          unitRate: round2(p.purchase_rate),
          discount_amount: round2(p.discount_amount),
          debit_amount: amt,
          credit_amount: 0,
          totalAmount: amt,
          remarks: `Supplier Purchase (${p.supplier_name})`,
          notes: `Supplier Purchase (${p.supplier_name})`,
          user_name: String(p.created_by || 'System'),
        });
      }

      if (bonusPacks > 0) {
        entries.push({
          transaction_id: `PURB-${p.line_id}`,
          date: String(p.bill_date),
          timestamp: String(p.created_at || p.bill_date),
          type: 'PURCHASE_BONUS',
          type_label: 'Purchase Bonus',
          docType: 'Purchase Bonus',
          ref_no: String(p.bill_number),
          docNumber: String(p.bill_number),
          party_name: String(p.supplier_name || 'Supplier'),
          partyName: String(p.supplier_name || 'Supplier'),
          item_id: iid,
          item_code: meta?.code || '',
          item_name: meta?.name || '',
          company_name: meta?.company || '',
          item_group: meta?.group || 'General',
          batch_number: String(p.batch_number || ''),
          batchNumber: String(p.batch_number || ''),
          expiry_date: String(p.expiry_date || ''),
          expiryDate: String(p.expiry_date || ''),
          opening_packs: 0,
          purchase_packs: 0,
          purchase_bonus_packs: bonusPacks,
          purchase_return_packs: 0,
          sale_packs: 0,
          sale_bonus_packs: 0,
          sale_return_packs: 0,
          transfer_in_packs: 0,
          transfer_out_packs: 0,
          in_packs: bonusPacks,
          in_loose: 0,
          out_packs: 0,
          out_loose: 0,
          net_pack_change: bonusPacks,
          running_pack_balance: 0,
          running_loose_balance: 0,
          runningBalancePacks: 0,
          unit_cost: 0,
          unitRate: 0,
          discount_amount: 0,
          debit_amount: 0,
          credit_amount: 0,
          totalAmount: 0,
          remarks: `Free Scheme / Bonus Received (${p.supplier_name})`,
          notes: `Free Scheme / Bonus Received (${p.supplier_name})`,
          user_name: String(p.created_by || 'System'),
        });
      }
    }

    // C. Sales (Full Pack Conversion: paid = quantity + loose/upp, bonus separate)
    const saleRows = db
      .prepare(`
        SELECT
          si.id as line_id, si.item_id, si.batch_number, si.expiry_date,
          si.quantity, si.bonus_quantity, si.loose_quantity, si.units_per_pack,
          si.unit_price, si.discount_amount, si.line_total,
          s.invoice_number, s.invoice_date, s.created_at, s.created_by, s.customer_name
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status = 'completed'
          ${itemFilterClause('si')}
          ${batchFilterClause('si')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const s of saleRows) {
      const iid = Number(s.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, Number(s.units_per_pack || meta?.unitsPerPack || 1));
      const paidPacks = round2(Number(s.quantity || 0) + Number(s.loose_quantity || 0) / upp);
      const bonusPacks = round2(Number(s.bonus_quantity || 0));
      const totalOutPacks = round2(paidPacks + bonusPacks);
      const amt = round2(s.line_total || 0);

      entries.push({
        transaction_id: `SAL-${s.line_id}`,
        date: String(s.invoice_date),
        timestamp: String(s.created_at || s.invoice_date),
        type: 'SALE',
        type_label: 'Sale',
        docType: 'Sale',
        ref_no: String(s.invoice_number),
        docNumber: String(s.invoice_number),
        party_name: String(s.customer_name || 'Customer'),
        partyName: String(s.customer_name || 'Customer'),
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(s.batch_number || ''),
        batchNumber: String(s.batch_number || ''),
        expiry_date: String(s.expiry_date || ''),
        expiryDate: String(s.expiry_date || ''),
        opening_packs: 0,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: 0,
        sale_packs: paidPacks,
        sale_bonus_packs: bonusPacks,
        sale_return_packs: 0,
        transfer_in_packs: 0,
        transfer_out_packs: 0,
        in_packs: 0,
        in_loose: 0,
        out_packs: totalOutPacks,
        out_loose: 0,
        net_pack_change: -totalOutPacks,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: round2(s.unit_price),
        unitRate: round2(s.unit_price),
        discount_amount: round2(s.discount_amount),
        debit_amount: 0,
        credit_amount: amt,
        totalAmount: amt,
        remarks: bonusPacks > 0 ? `Sale (${paidPacks} pk + ${bonusPacks} bonus)` : `Sales Invoice (${s.customer_name})`,
        notes: `Sales Invoice (${s.customer_name})`,
        user_name: String(s.created_by || 'System'),
      });
    }

    // D. Purchase Returns
    const purRetRows = db
      .prepare(`
        SELECT
          pri.id as line_id, pri.item_id, pri.batch_number, pri.expiry_date,
          pri.return_quantity, pri.return_units, pri.units_per_pack,
          pri.debit_unit_rate, pri.discount_amount, pri.line_total, pri.return_reason,
          pr.debit_note_number, pr.return_date, pr.created_at, pr.created_by,
          COALESCE(a.account_name, 'Supplier') as supplier_name
        FROM purchase_return_items pri
        JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
        LEFT JOIN accounts a ON pr.supplier_account_id = a.id
        WHERE pr.status = 'completed'
          ${itemFilterClause('pri')}
          ${batchFilterClause('pri')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const pr of purRetRows) {
      const iid = Number(pr.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, Number(pr.units_per_pack || meta?.unitsPerPack || 1));
      const retPacks =
        Number(pr.return_units || 0) > 0 ? round2(Number(pr.return_units) / upp) : round2(Number(pr.return_quantity || 0));
      const amt = round2(pr.line_total || 0);

      entries.push({
        transaction_id: `PR-${pr.line_id}`,
        date: String(pr.return_date),
        timestamp: String(pr.created_at || pr.return_date),
        type: 'PURCHASE_RETURN',
        type_label: 'Purchase Return',
        docType: 'Purchase Return',
        ref_no: String(pr.debit_note_number),
        docNumber: String(pr.debit_note_number),
        party_name: String(pr.supplier_name || 'Supplier'),
        partyName: String(pr.supplier_name || 'Supplier'),
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(pr.batch_number || ''),
        batchNumber: String(pr.batch_number || ''),
        expiry_date: String(pr.expiry_date || ''),
        expiryDate: String(pr.expiry_date || ''),
        opening_packs: 0,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: retPacks,
        sale_packs: 0,
        sale_bonus_packs: 0,
        sale_return_packs: 0,
        transfer_in_packs: 0,
        transfer_out_packs: 0,
        in_packs: 0,
        in_loose: 0,
        out_packs: retPacks,
        out_loose: 0,
        net_pack_change: -retPacks,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: round2(pr.debit_unit_rate),
        unitRate: round2(pr.debit_unit_rate),
        discount_amount: round2(pr.discount_amount),
        debit_amount: 0,
        credit_amount: amt,
        totalAmount: amt,
        remarks: `Returned to supplier: ${pr.return_reason || ''}`,
        notes: `Returned to supplier: ${pr.return_reason || ''}`,
        user_name: String(pr.created_by || 'System'),
      });
    }

    // E. Sales Returns (restocked)
    const saleRetRows = db
      .prepare(`
        SELECT
          sri.id as line_id, sri.item_id, sri.batch_number, sri.expiry_date,
          sri.return_pack_qty, sri.return_bonus_qty, sri.return_loose_qty, sri.units_per_pack,
          sri.return_rate, sri.discount_amount, sri.line_total, sri.return_reason,
          sr.return_number, sr.return_date, sr.created_at, sr.created_by, sr.customer_name
        FROM sale_return_items sri
        JOIN sale_returns sr ON sri.sale_return_id = sr.id
        WHERE sr.status = 'completed' AND sri.restock_status = 'restocked'
          ${itemFilterClause('sri')}
          ${batchFilterClause('sri')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const sr of saleRetRows) {
      const iid = Number(sr.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, Number(sr.units_per_pack || meta?.unitsPerPack || 1));
      const retPaid = round2(Number(sr.return_pack_qty || 0) + Number(sr.return_loose_qty || 0) / upp);
      const retBonus = round2(Number(sr.return_bonus_qty || 0));
      const retTotal = round2(retPaid + retBonus);
      const amt = round2(sr.line_total || 0);

      entries.push({
        transaction_id: `SR-${sr.line_id}`,
        date: String(sr.return_date),
        timestamp: String(sr.created_at || sr.return_date),
        type: 'SALES_RETURN',
        type_label: 'Sale Return',
        docType: 'Sales Return',
        ref_no: String(sr.return_number),
        docNumber: String(sr.return_number),
        party_name: String(sr.customer_name || 'Customer'),
        partyName: String(sr.customer_name || 'Customer'),
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(sr.batch_number || ''),
        batchNumber: String(sr.batch_number || ''),
        expiry_date: String(sr.expiry_date || ''),
        expiryDate: String(sr.expiry_date || ''),
        opening_packs: 0,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: 0,
        sale_packs: 0,
        sale_bonus_packs: 0,
        sale_return_packs: retTotal,
        transfer_in_packs: 0,
        transfer_out_packs: 0,
        in_packs: retTotal,
        in_loose: 0,
        out_packs: 0,
        out_loose: 0,
        net_pack_change: retTotal,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: round2(sr.return_rate),
        unitRate: round2(sr.return_rate),
        discount_amount: round2(sr.discount_amount),
        debit_amount: amt,
        credit_amount: 0,
        totalAmount: amt,
        remarks: `Customer return restocked: ${sr.return_reason || ''}`,
        notes: `Customer return restocked: ${sr.return_reason || ''}`,
        user_name: String(sr.created_by || 'System'),
      });
    }

    // F. Stock Adjustments
    const adjRows = db
      .prepare(`
        SELECT
          ai.id as line_id, ai.item_id, ai.batch_number, ai.expiry_date,
          ai.adjustment_mode, ai.total_units, ai.units_per_pack,
          ai.cost_price_per_unit, ai.total_cost, ai.reason_category, ai.remarks,
          adj.adjustment_number, adj.adjustment_date, adj.created_at, adj.created_by_username, adj.reason
        FROM stock_adjustment_items ai
        JOIN stock_adjustments adj ON ai.adjustment_id = adj.id
        WHERE adj.status = 'completed'
          ${itemFilterClause('ai')}
          ${batchFilterClause('ai')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const a of adjRows) {
      const iid = Number(a.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, Number(a.units_per_pack || meta?.unitsPerPack || 1));
      const packs = round2(Number(a.total_units || 0) / upp);
      const isInc = String(a.adjustment_mode) === 'Increase';
      const rate = round2(Number(a.cost_price_per_unit || 0) * upp);
      const amt = round2(a.total_cost || 0);

      entries.push({
        transaction_id: `ADJ-${a.line_id}`,
        date: String(a.adjustment_date),
        timestamp: String(a.created_at || a.adjustment_date),
        type: isInc ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        type_label: isInc ? 'Adjustment (+)' : 'Adjustment (-)',
        docType: isInc ? 'Adjustment Increase' : 'Adjustment Decrease',
        ref_no: String(a.adjustment_number),
        docNumber: String(a.adjustment_number),
        party_name: `Adjustment (${a.reason_category})`,
        partyName: `Adjustment (${a.reason_category})`,
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(a.batch_number || ''),
        batchNumber: String(a.batch_number || ''),
        expiry_date: String(a.expiry_date || ''),
        expiryDate: String(a.expiry_date || ''),
        opening_packs: 0,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: 0,
        sale_packs: 0,
        sale_bonus_packs: 0,
        sale_return_packs: 0,
        transfer_in_packs: 0,
        transfer_out_packs: 0,
        in_packs: isInc ? packs : 0,
        in_loose: 0,
        out_packs: !isInc ? packs : 0,
        out_loose: 0,
        net_pack_change: isInc ? packs : -packs,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: rate,
        unitRate: rate,
        discount_amount: 0,
        debit_amount: isInc ? amt : 0,
        credit_amount: !isInc ? amt : 0,
        totalAmount: amt,
        remarks: String(a.remarks || a.reason || ''),
        notes: String(a.remarks || a.reason || ''),
        user_name: String(a.created_by_username || 'Admin'),
      });
    }

    // G. Stock Transfers
    const trfRows = db
      .prepare(`
        SELECT
          ti.id as line_id, ti.item_id, ti.batch_number, ti.total_units, ti.from_shelf, ti.to_shelf,
          trf.transfer_number, trf.transfer_date, trf.created_at, trf.created_by_username,
          trf.from_location, trf.to_location, trf.reason
        FROM stock_transfer_items ti
        JOIN stock_transfers trf ON ti.transfer_id = trf.id
        WHERE trf.status = 'completed'
          ${itemFilterClause('ti')}
          ${batchFilterClause('ti')}
      `)
      .all(...buildParams()) as Array<Record<string, unknown>>;

    for (const t of trfRows) {
      const iid = Number(t.item_id);
      const meta = itemUppMap.get(iid);
      const upp = Math.max(1, meta?.unitsPerPack || 1);
      const packs = round2(Number(t.total_units || 0) / upp);

      entries.push({
        transaction_id: `TRF-${t.line_id}`,
        date: String(t.transfer_date),
        timestamp: String(t.created_at || t.transfer_date),
        type: 'TRANSFER_IN',
        type_label: 'Transfer',
        docType: 'Stock Transfer',
        ref_no: String(t.transfer_number),
        docNumber: String(t.transfer_number),
        party_name: `${t.from_shelf || t.from_location} → ${t.to_shelf || t.to_location}`,
        partyName: `${t.from_shelf || t.from_location} → ${t.to_shelf || t.to_location}`,
        item_id: iid,
        item_code: meta?.code || '',
        item_name: meta?.name || '',
        company_name: meta?.company || '',
        item_group: meta?.group || 'General',
        batch_number: String(t.batch_number || ''),
        batchNumber: String(t.batch_number || ''),
        expiry_date: '',
        expiryDate: '',
        opening_packs: 0,
        purchase_packs: 0,
        purchase_bonus_packs: 0,
        purchase_return_packs: 0,
        sale_packs: 0,
        sale_bonus_packs: 0,
        sale_return_packs: 0,
        transfer_in_packs: packs,
        transfer_out_packs: packs,
        in_packs: 0,
        in_loose: 0,
        out_packs: 0,
        out_loose: 0,
        net_pack_change: 0,
        running_pack_balance: 0,
        running_loose_balance: 0,
        runningBalancePacks: 0,
        unit_cost: 0,
        unitRate: 0,
        discount_amount: 0,
        debit_amount: 0,
        credit_amount: 0,
        totalAmount: 0,
        remarks: `Location move: ${t.reason || ''}`,
        notes: `Location move: ${t.reason || ''}`,
        user_name: String(t.created_by_username || 'Admin'),
      });
    }

    // Sort chronologically
    entries.sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return a.timestamp.localeCompare(b.timestamp);
    });

    // Compute running balance per item (or globally when single item selected)
    const perItemBalance = new Map<number, number>();
    let globalRunning = 0;

    for (const e of entries) {
      const prevBal = perItemBalance.get(e.item_id) || 0;
      const nextBal = round2(prevBal + e.in_packs - e.out_packs);
      perItemBalance.set(e.item_id, nextBal);

      globalRunning = round2(globalRunning + e.in_packs - e.out_packs);
      const effectiveBal = itemIdNum ? globalRunning : nextBal;
      e.running_pack_balance = effectiveBal;
      e.runningBalancePacks = effectiveBal;
      e.running_loose_balance = 0;
    }

    // Compute Opening Balance prior to fromDate when date filter applied
    let openingPackBalance = 0;
    let filteredEntries = entries;

    if (fromDate) {
      const priorEntries = entries.filter((e) => e.date < String(fromDate));
      openingPackBalance = round2(priorEntries.reduce((acc, e) => acc + e.in_packs - e.out_packs, 0));
      filteredEntries = entries.filter((e) => e.date >= String(fromDate));
    }
    if (toDate) {
      filteredEntries = filteredEntries.filter((e) => e.date <= String(toDate));
    }

    const totalIn = round2(filteredEntries.reduce((s, e) => s + e.in_packs, 0));
    const totalOut = round2(filteredEntries.reduce((s, e) => s + e.out_packs, 0));
    const netChange = round2(totalIn - totalOut);
    const closingPackBalance =
      filteredEntries.length > 0
        ? itemIdNum
          ? filteredEntries[filteredEntries.length - 1].running_pack_balance
          : round2(openingPackBalance + netChange)
        : openingPackBalance;

    const itemUpp = itemRow ? Math.max(1, parsePacking(String(itemRow.packing || '1x1')).unitsPerPack) : 1;

    res.json({
      success: true,
      item: itemRow
        ? {
            id: itemRow.id,
            item_code: itemRow.item_code,
            item_name: itemRow.item_name,
            company_name: itemRow.company_name,
            item_group: itemRow.category || 'General',
            packing: itemRow.packing,
            units_per_pack: itemUpp,
            opening_balance_packs: openingPackBalance,
            closing_balance_packs: closingPackBalance,
          }
        : null,
      count: filteredEntries.length,
      ledger: filteredEntries,
      entries: filteredEntries,
      summary: {
        opening_pack_balance: openingPackBalance,
        total_in_packs: totalIn,
        total_out_packs: totalOut,
        net_change_packs: netChange,
        closing_pack_balance: closingPackBalance,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 9. Physical Stock Verifications (Count Sheet, Variance & Confirmed Reconciliation)
 */
inventoryRouter.get('/physical-verifications', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rawRows = db
      .prepare(`
        SELECT pv.*, sa.adjustment_number
        FROM physical_verifications pv
        LEFT JOIN stock_adjustments sa ON pv.adjustment_id = sa.id
        ORDER BY pv.id DESC
      `)
      .all() as Array<Record<string, unknown>>;

    const verifications = rawRows.map((v) => ({
      ...v,
      verification_no: String(v.verification_number || ''),
      status: mapVerificationStatusOut(String(v.status || 'pending')),
      conducted_by: 0,
      conducted_by_name: String(v.verified_by || 'Super Admin'),
      reconciled_by: v.reconciled_by ? 0 : null,
      reconciled_by_name: v.reconciled_by ? String(v.reconciled_by) : null,
      adjustment_no: v.adjustment_number ? String(v.adjustment_number) : null,
    }));

    res.json({
      success: true,
      count: verifications.length,
      verifications,
      data: verifications,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

inventoryRouter.get('/physical-verifications/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    const record = db
      .prepare(`
        SELECT pv.*, sa.adjustment_number
        FROM physical_verifications pv
        LEFT JOIN stock_adjustments sa ON pv.adjustment_id = sa.id
        WHERE pv.id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;

    if (!record) {
      return res.status(404).json({ success: false, error: 'Verification count sheet not found.' });
    }

    const rawItems = db
      .prepare(`
        SELECT pvi.*, COALESCE(NULLIF(TRIM(i.category), ''), 'General') as item_group, i.packing
        FROM physical_verification_items pvi
        LEFT JOIN items i ON pvi.item_id = i.id
        WHERE pvi.verification_id = ?
      `)
      .all(id) as Array<Record<string, unknown>>;

    const items = rawItems.map((it) => {
      const parsed = parsePacking(String(it.packing || '1x1'));
      const upp = Math.max(1, parsed.unitsPerPack);
      const sysPacks = round2(Number(it.system_units || 0) / upp);
      const physPacks = round2(Number(it.physical_units || 0) / upp);
      const diffPacks = round2(Number(it.difference_units || 0) / upp);
      return {
        ...it,
        units_per_pack: upp,
        system_pack_qty: sysPacks,
        system_loose_qty: 0,
        physical_pack_qty: physPacks,
        physical_loose_qty: 0,
        diff_pack_qty: diffPacks,
        diff_loose_qty: 0,
        unit_cost: round2(Number(it.cost_price_per_unit || 0) * upp),
        diff_cost_impact: round2(it.discrepancy_cost || 0),
        reason_note: it.adjustment_reason ? String(it.adjustment_reason) : null,
      };
    });

    const formatted = {
      ...record,
      verification_no: String(record.verification_number || ''),
      status: mapVerificationStatusOut(String(record.status || 'pending')),
      conducted_by: 0,
      conducted_by_name: String(record.verified_by || 'Super Admin'),
      reconciled_by: record.reconciled_by ? 0 : null,
      reconciled_by_name: record.reconciled_by ? String(record.reconciled_by) : null,
      adjustment_no: record.adjustment_number ? String(record.adjustment_number) : null,
      items,
    };

    res.json({ success: true, verification: formatted, data: formatted });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

inventoryRouter.post('/physical-verifications', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body;
    const currentUser = req.user?.username || 'Super Admin';

    const {
      verification_date = new Date().toISOString().slice(0, 10),
      remarks,
      idempotency_key,
      items,
    } = body;
    assertPeriodOpen(String(verification_date).slice(0, 10), 'create a physical stock verification');

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine item count is required.' });
    }

    if (idempotency_key) {
      const dup = db
        .prepare('SELECT id, verification_number FROM physical_verifications WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as { id: number; verification_number: string } | undefined;
      if (dup) {
        return res.status(409).json({
          success: false,
          error: `Duplicate submission blocked. Verification ${dup.verification_number} already exists for this request.`,
        });
      }
    }

    let createdId = 0;
    let verificationNumber = '';

    const executeCreate = db.transaction(() => {
      const year = new Date().getFullYear();
      const lastVer = db.prepare('SELECT id FROM physical_verifications ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
      verificationNumber = `STK-VER-${year}-${String((lastVer?.id || 0) + 1).padStart(4, '0')}`;

      let discrepancyCount = 0;
      let netCostDiscrepancy = 0;

      const insertVer = db
        .prepare(`
          INSERT INTO physical_verifications (
            verification_number, verification_date, verified_by,
            total_items_checked, total_discrepancies, net_cost_discrepancy,
            status, remarks, idempotency_key
          ) VALUES (?, ?, ?, ?, 0, 0, 'pending', ?, ?)
        `)
        .run(
          verificationNumber,
          verification_date,
          currentUser,
          items.length,
          String(remarks || '').trim(),
          idempotency_key ? String(idempotency_key) : null
        );

      createdId = Number(insertVer.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO physical_verification_items (
          verification_id, item_id, inventory_id, item_code, item_name, company_name,
          batch_number, expiry_date, system_units, system_packs,
          physical_units, physical_packs, difference_units, difference_packs,
          cost_price_per_unit, discrepancy_cost, adjustment_reason, is_reconciled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);

      const seenBatchIds = new Set<number>();

      for (const line of items) {
        let invId = line.inventory_id ? Number(line.inventory_id) : 0;
        if (!invId && line.item_id) {
          const fallbackBatch = db
            .prepare(`
              SELECT id FROM inventory
              WHERE item_id = ?
              ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, expiry_date ASC, id DESC
              LIMIT 1
            `)
            .get(Number(line.item_id)) as { id: number } | undefined;
          if (fallbackBatch) invId = Number(fallbackBatch.id);
        }

        if (!invId) throw new Error('Batch selection is required for every verification row.');
        if (seenBatchIds.has(invId)) {
          throw new Error(`Duplicate batch detected in physical count (Batch ID ${invId}).`);
        }
        seenBatchIds.add(invId);

        const inv = db
          .prepare('SELECT inv.*, i.item_name, i.item_code, i.company_name FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ?')
          .get(invId) as Record<string, unknown> | undefined;

        if (!inv) throw new Error(`Batch ID ${invId} does not exist.`);

        const unitsPerPack = Math.max(1, Number(inv.units_per_pack || 1));
        const systemUnits = Number(inv.total_stock_units || 0);
        const systemPacks = round2(systemUnits / unitsPerPack);

        const rawPhysPacks = line.physical_packs ?? line.physical_pack_qty ?? systemPacks;
        const rawPhysLoose = line.physical_loose ?? line.physical_loose_qty ?? 0;
        const physicalPacksInput = round2(Math.max(0, Number(rawPhysPacks)));
        const physicalLooseInput = round2(Math.max(0, Number(rawPhysLoose)));
        const physicalUnits = round2(physicalPacksInput * unitsPerPack + physicalLooseInput);
        const physicalFullPacks = round2(physicalUnits / unitsPerPack);

        const diffUnits = round2(physicalUnits - systemUnits);
        const diffPacks = round2(diffUnits / unitsPerPack);

        const costPerUnit = Number(inv.cost_price || 0);
        const discCost = round2(diffUnits * costPerUnit);

        if (diffUnits !== 0) {
          discrepancyCount++;
          netCostDiscrepancy = round2(netCostDiscrepancy + discCost);
        }

        insertItem.run(
          createdId,
          inv.item_id,
          invId,
          inv.item_code,
          inv.item_name,
          inv.company_name,
          inv.batch_number,
          inv.expiry_date,
          systemUnits,
          systemPacks,
          physicalUnits,
          physicalFullPacks,
          diffUnits,
          diffPacks,
          costPerUnit,
          discCost,
          String(line.adjustment_reason ?? line.reason_note ?? '').trim()
        );
      }

      db.prepare(`
        UPDATE physical_verifications
        SET total_discrepancies = ?,
            net_cost_discrepancy = ?
        WHERE id = ?
      `).run(discrepancyCount, netCostDiscrepancy, createdId);
    });

    executeCreate();

    res.json({
      success: true,
      message: `Physical Stock Count ${verificationNumber} saved as DRAFT. Inventory is NOT updated until you confirm reconciliation.`,
      verification_no: verificationNumber,
      verification_id: createdId,
      verificationId: createdId,
      verificationNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/inventory/physical-verifications/:id/reconcile
 * Atomic confirmation: updates inventory ONLY once, prevents duplicate stock adjustments
 */
inventoryRouter.post('/physical-verifications/:id/reconcile', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const currentUser = req.user?.username || 'Super Admin';
    const currentUserId = req.user?.id || null;

    let adjustmentId: number | null = null;
    let adjNumber = '';
    let verificationNumber = '';

    const executeReconciliation = db.transaction(() => {
      const ver = db.prepare('SELECT * FROM physical_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!ver) {
        throw new Error('Physical verification record not found.');
      }
      assertPeriodOpen(String(ver.verification_date || '').slice(0, 10), 'reconcile a physical stock verification');
      verificationNumber = String(ver.verification_number || '');

      if (String(ver.status).toLowerCase() === 'reconciled' || ver.adjustment_id) {
        throw new Error(`Duplicate adjustment prevented: Verification ${verificationNumber} has already been reconciled.`);
      }

      // Check if an adjustment already references this verification number
      const refAdj = db
        .prepare("SELECT adjustment_number FROM stock_adjustments WHERE reference_no = ? AND status = 'completed'")
        .get(verificationNumber) as { adjustment_number: string } | undefined;
      if (refAdj) {
        throw new Error(`Duplicate adjustment prevented: Adjustment ${refAdj.adjustment_number} already posted for ${verificationNumber}.`);
      }

      // Atomic state lock before applying inventory updates
      const lockRes = db
        .prepare(`
          UPDATE physical_verifications
          SET status = 'reconciled',
              reconciled_at = CURRENT_TIMESTAMP,
              reconciled_by = ?
          WHERE id = ? AND status != 'reconciled'
        `)
        .run(currentUser, id);

      if (lockRes.changes === 0) {
        throw new Error(`Verification ${verificationNumber} was already reconciled concurrently.`);
      }

      const items = db
        .prepare('SELECT * FROM physical_verification_items WHERE verification_id = ?')
        .all(id) as Array<Record<string, unknown>>;

      const discrepancyItems = items.filter((i) => Number(i.difference_units || 0) !== 0);

      if (discrepancyItems.length > 0) {
        const year = new Date().getFullYear();
        const lastAdj = db.prepare('SELECT id FROM stock_adjustments ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
        adjNumber = `ADJ-${year}-${String((lastAdj?.id || 0) + 1).padStart(4, '0')}`;

        let totalCostImpact = 0;

        const insertAdj = db
          .prepare(`
            INSERT INTO stock_adjustments (
              adjustment_number, adjustment_date, adjustment_type, total_items,
              total_cost_impact, created_by_user_id, created_by_username,
              reason, reference_no, idempotency_key, status
            ) VALUES (?, ?, 'Physical Difference', ?, 0, ?, ?, ?, ?, ?, 'completed')
          `)
          .run(
            adjNumber,
            String(ver.verification_date || new Date().toISOString().slice(0, 10)),
            discrepancyItems.length,
            currentUserId,
            currentUser,
            `Physical Stock Audit Reconciliation (${verificationNumber})`,
            verificationNumber,
            `RECONCILE-${verificationNumber}`
          );

        adjustmentId = Number(insertAdj.lastInsertRowid);

        const insertAdjLine = db.prepare(`
          INSERT INTO stock_adjustment_items (
            adjustment_id, item_id, inventory_id, item_code, item_name, company_name,
            batch_number, expiry_date, packing, units_per_pack, adjustment_mode,
            pack_qty, loose_qty, total_units, system_stock_units, new_stock_units,
            cost_price_per_unit, total_cost, reason_category, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of discrepancyItems) {
          const invId = Number(item.inventory_id);
          const invRow = db.prepare('SELECT * FROM inventory WHERE id = ?').get(invId) as Record<string, unknown>;
          if (!invRow) continue;

          const diffUnits = Number(item.difference_units || 0);
          const mode: 'Increase' | 'Decrease' = diffUnits > 0 ? 'Increase' : 'Decrease';
          const absDiffUnits = Math.abs(diffUnits);
          const unitsPerPack = Math.max(1, Number(invRow.units_per_pack || 1));
          const absPackDiff = round2(absDiffUnits / unitsPerPack);
          const costPerUnit = Number(item.cost_price_per_unit || invRow.cost_price || 0);
          const lineCost = round2(absDiffUnits * costPerUnit);

          if (mode === 'Increase') {
            totalCostImpact = round2(totalCostImpact + lineCost);
          } else {
            totalCostImpact = round2(totalCostImpact - lineCost);
          }

          const newUnits = Number(item.physical_units);
          const newPacks = round2(newUnits / unitsPerPack);
          const newLoose = round2(newUnits % unitsPerPack);
          const parsed = parsePacking(String(invRow.packing || '1x1'));
          const newStrips = round2(newPacks * parsed.stripsPerBox);

          insertAdjLine.run(
            adjustmentId,
            item.item_id,
            invId,
            item.item_code,
            item.item_name,
            item.company_name,
            item.batch_number,
            item.expiry_date,
            invRow.packing || '1x1',
            unitsPerPack,
            mode,
            absPackDiff,
            round2(absDiffUnits % unitsPerPack),
            absDiffUnits,
            item.system_units,
            newUnits,
            costPerUnit,
            lineCost,
            'Physical Difference',
            String(item.adjustment_reason || 'Count variance reconciliation')
          );

          const currentAdj = Number(invRow.adjusted_qty || 0);
          const deltaPackSigned = mode === 'Increase' ? absPackDiff : -absPackDiff;

          const itemMin = db.prepare('SELECT minimum_stock FROM items WHERE id = ?').get(Number(item.item_id)) as { minimum_stock?: number };
          const status = computeBatchStockStatus(newPacks, String(item.expiry_date), Number(itemMin?.minimum_stock || 0));

          db.prepare(`
            UPDATE inventory
            SET current_pack_qty = ?,
                current_strip_qty = ?,
                current_loose_qty = ?,
                total_stock_units = ?,
                adjusted_qty = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            newPacks,
            newStrips,
            newLoose,
            newUnits,
            round2(currentAdj + deltaPackSigned),
            status,
            invId
          );
        }

        db.prepare('UPDATE stock_adjustments SET total_cost_impact = ? WHERE id = ?').run(totalCostImpact, adjustmentId);

        const absCostImpact = round2(Math.abs(totalCostImpact));
        if (absCostImpact > 0) {
          const invAssetAccId = getAccountIdByCode('INV-1030');
          const adjExpenseAccId = getAccountIdByCode('ADJ-5035');
          const adjIncomeAccId = getAccountIdByCode('ADJ-4035');

          const entryNumber = `JE-AUDIT-${year}-${String(adjustmentId).padStart(4, '0')}`;
          const desc = `Physical Stock Verification Reconciliation (${verificationNumber})`;

          const insertJe = db
            .prepare(`
              INSERT INTO journal_entries (
                entry_number, reference_type, reference_id, description,
                total_debit, total_credit, is_balanced, status
              ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, 1, 'posted')
            `)
            .run(entryNumber, adjustmentId, desc, absCostImpact, absCostImpact);

          const jeId = Number(insertJe.lastInsertRowid);
          const insertLine = db.prepare(`
            INSERT INTO journal_entry_lines (
              journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
            ) VALUES (?, ?, 'general', ?, ?, ?)
          `);

          if (totalCostImpact < 0) {
            insertLine.run(jeId, adjExpenseAccId, absCostImpact, 0, `Physical shortage write-off: ${verificationNumber}`);
            insertLine.run(jeId, invAssetAccId, 0, absCostImpact, `Inventory asset physical count correction: ${verificationNumber}`);
          } else {
            insertLine.run(jeId, invAssetAccId, absCostImpact, 0, `Inventory asset physical surplus: ${verificationNumber}`);
            insertLine.run(jeId, adjIncomeAccId, 0, absCostImpact, `Physical surplus gain: ${verificationNumber}`);
          }

          db.prepare('UPDATE stock_adjustments SET journal_entry_id = ? WHERE id = ?').run(jeId, adjustmentId);
        }
      }

      db.prepare('UPDATE physical_verifications SET adjustment_id = ? WHERE id = ?').run(adjustmentId, id);
      db.prepare('UPDATE physical_verification_items SET is_reconciled = 1 WHERE verification_id = ?').run(id);
    });

    executeReconciliation();

    res.json({
      success: true,
      message: `Physical count sheet ${verificationNumber} reconciled successfully.${adjustmentId ? ` Adjustment voucher ${adjNumber} created.` : ' No stock variances found.'}`,
      adjustment_no: adjNumber || 'NO-VARIANCE',
      adjustment_id: adjustmentId || 0,
      adjustmentId,
      adjustmentNumber: adjNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * 10. GET & PUT /api/inventory/settings
 * Expiry alert thresholds and inventory configuration
 */
inventoryRouter.get('/settings', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const settings = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as Record<string, unknown> | undefined;
    const nearExpiryDays = Number(settings?.near_expiry_days || 90);
    res.json({
      success: true,
      near_expiry_days: nearExpiryDays,
      settings: {
        near_expiry_days: nearExpiryDays,
        low_stock_threshold_multiplier: 1.0,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

inventoryRouter.put('/settings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { near_expiry_days } = req.body;
    const days = Math.max(1, parseInt(String(near_expiry_days || 90), 10));

    db.prepare('UPDATE company_settings SET near_expiry_days = ? WHERE id = (SELECT id FROM company_settings LIMIT 1)').run(days);

    res.json({
      success: true,
      message: `Inventory alert settings updated. Near-expiry threshold set to ${days} days.`,
      near_expiry_days: days,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});
