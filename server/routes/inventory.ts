import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';

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
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
} {
  if (!expiryDate) {
    return { status: 'valid', daysToExpiry: 9999, isExpired: false, isNearExpiry: false };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);

  const diffTime = exp.getTime() - today.getTime();
  const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysToExpiry < 0) {
    return { status: 'expired', daysToExpiry, isExpired: true, isNearExpiry: false };
  } else if (daysToExpiry <= 30) {
    return { status: 'expiring_30', daysToExpiry, isExpired: false, isNearExpiry: true };
  } else if (daysToExpiry <= 60) {
    return { status: 'expiring_60', daysToExpiry, isExpired: false, isNearExpiry: true };
  } else if (daysToExpiry <= nearExpiryDays) {
    return { status: 'expiring_90', daysToExpiry, isExpired: false, isNearExpiry: true };
  }
  return { status: 'valid', daysToExpiry, isExpired: false, isNearExpiry: false };
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
      .prepare("SELECT COUNT(*) as cnt FROM items WHERE status = 'active'")
      .get() as { cnt: number };

    const batchStats = db
      .prepare(`
        SELECT
          COUNT(*) as total_batches,
          SUM(current_pack_qty) as total_packs,
          SUM(total_stock_units) as total_units,
          SUM(current_pack_qty * pack_cost) as total_cost_value,
          SUM(current_pack_qty * pack_retail) as total_retail_value,
          SUM(CASE WHEN current_pack_qty > 0 THEN 1 ELSE 0 END) as active_batches_in_stock
        FROM inventory
      `)
      .get() as Record<string, number>;

    const todayStr = new Date().toISOString().slice(0, 10);
    const targetNearDate = new Date();
    targetNearDate.setDate(targetNearDate.getDate() + nearExpiryThreshold);
    const nearExpiryDateStr = targetNearDate.toISOString().slice(0, 10);

    const expiredBatches = db
      .prepare(`
        SELECT COUNT(*) as cnt, SUM(current_pack_qty) as packs, SUM(current_pack_qty * pack_cost) as cost_val
        FROM inventory
        WHERE expiry_date < ? AND current_pack_qty > 0
      `)
      .get(todayStr) as { cnt: number; packs: number; cost_val: number };

    const nearExpiryBatches = db
      .prepare(`
        SELECT COUNT(*) as cnt, SUM(current_pack_qty) as packs, SUM(current_pack_qty * pack_cost) as cost_val
        FROM inventory
        WHERE expiry_date >= ? AND expiry_date <= ? AND current_pack_qty > 0
      `)
      .get(todayStr, nearExpiryDateStr) as { cnt: number; packs: number; cost_val: number };

    const lowStockItems = db
      .prepare(`
        SELECT COUNT(*) as cnt
        FROM items i
        LEFT JOIN (
          SELECT item_id, SUM(current_pack_qty) as total_packs
          FROM inventory
          GROUP BY item_id
        ) inv ON i.id = inv.item_id
        WHERE i.status = 'active'
          AND i.minimum_stock > 0
          AND COALESCE(inv.total_packs, 0) <= i.minimum_stock
      `)
      .get() as { cnt: number };

    res.json({
      success: true,
      summary: {
        totalItems: itemCount.cnt || 0,
        totalBatches: batchStats.total_batches || 0,
        activeBatchesInStock: batchStats.active_batches_in_stock || 0,
        totalStockPacks: round2(batchStats.total_packs || 0),
        totalStockUnits: round2(batchStats.total_units || 0),
        totalStockValueCost: round2(batchStats.total_cost_value || 0),
        totalStockValueRetail: round2(batchStats.total_retail_value || 0),
        potentialProfitMargin: round2(
          (batchStats.total_retail_value || 0) - (batchStats.total_cost_value || 0)
        ),
        nearExpiryDaysThreshold: nearExpiryThreshold,
        nearExpiryCount: nearExpiryBatches.cnt || 0,
        nearExpiryPacks: round2(nearExpiryBatches.packs || 0),
        nearExpiryValueCost: round2(nearExpiryBatches.cost_val || 0),
        expiredCount: expiredBatches.cnt || 0,
        expiredPacks: round2(expiredBatches.packs || 0),
        expiredValueCost: round2(expiredBatches.cost_val || 0),
        lowStockCount: lowStockItems.cnt || 0,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 2. GET /api/inventory/datasheet
 * Full 18-Column Professional Spreadsheet-Style Inventory Table
 */
inventoryRouter.get('/datasheet', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      q,
      itemCode,
      barcode,
      company,
      category,
      batch,
      expiryFilter,
      statusFilter,
      inStockOnly,
      sortBy = 'item_name',
      sortOrder = 'ASC',
      page = 1,
      pageSize = 50,
    } = req.query;

    const settings = db
      .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
      .get() as { near_expiry_days?: number } | undefined;
    const nearExpiryDays = settings?.near_expiry_days || 90;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim()) {
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

    if (itemCode && typeof itemCode === 'string' && itemCode.trim()) {
      conditions.push('i.item_code = ?');
      params.push(itemCode.trim());
    }

    if (barcode && typeof barcode === 'string' && barcode.trim()) {
      conditions.push('i.barcode = ?');
      params.push(barcode.trim());
    }

    if (company && typeof company === 'string' && company !== 'all') {
      conditions.push('i.company_name = ?');
      params.push(company);
    }

    if (category && typeof category === 'string' && category !== 'all') {
      conditions.push('i.category = ?');
      params.push(category);
    }

    if (batch && typeof batch === 'string' && batch.trim()) {
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

    if (expiryFilter === 'expired') {
      conditions.push('inv.expiry_date < ?');
      params.push(todayStr);
    } else if (expiryFilter === 'expiring_30') {
      conditions.push('inv.expiry_date >= ? AND inv.expiry_date <= ?');
      params.push(todayStr, str30);
    } else if (expiryFilter === 'expiring_60') {
      conditions.push('inv.expiry_date > ? AND inv.expiry_date <= ?');
      params.push(str30, str60);
    } else if (expiryFilter === 'expiring_90') {
      conditions.push('inv.expiry_date > ? AND inv.expiry_date <= ?');
      params.push(str60, strNear);
    } else if (expiryFilter === 'near_expiry') {
      conditions.push('inv.expiry_date >= ? AND inv.expiry_date <= ?');
      params.push(todayStr, strNear);
    } else if (expiryFilter === 'valid') {
      conditions.push('inv.expiry_date > ?');
      params.push(strNear);
    }

    if (statusFilter && typeof statusFilter === 'string' && statusFilter !== 'all') {
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

    // Allowed sort columns
    const allowedSortColumns: Record<string, string> = {
      item_code: 'i.item_code',
      item_name: 'i.item_name',
      company_name: 'i.company_name',
      category: 'i.category',
      batch_number: 'inv.batch_number',
      expiry_date: 'inv.expiry_date',
      current_pack_qty: 'inv.current_pack_qty',
      total_stock_units: 'inv.total_stock_units',
      pack_cost: 'inv.pack_cost',
      pack_retail: 'inv.pack_retail',
      stock_value: '(inv.current_pack_qty * inv.pack_cost)',
    };

    const sortCol = allowedSortColumns[String(sortBy)] || 'i.item_name';
    const orderDirection = String(sortOrder).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Count query
    const countSql = `
      SELECT
        COUNT(*) as totalRows,
        SUM(inv.current_pack_qty) as totalPacks,
        SUM(inv.total_stock_units) as totalUnits,
        SUM(inv.current_pack_qty * inv.pack_cost) as totalStockValue,
        SUM(inv.current_pack_qty * inv.pack_retail) as totalRetailValue
      FROM inventory inv
      JOIN items i ON inv.item_id = i.id
      ${whereSql}
    `;

    const summaryRow = db.prepare(countSql).get(...params) as Record<string, number>;
    const totalCount = Number(summaryRow?.totalRows || 0);

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(500, Math.max(10, parseInt(String(pageSize), 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const dataSql = `
      SELECT
        inv.id as inventory_id,
        inv.item_id,
        i.item_code,
        i.barcode,
        i.company_name,
        i.item_name,
        i.generic_name,
        i.category,
        i.packing,
        inv.batch_number,
        inv.manufacturing_date,
        inv.expiry_date,
        inv.pack_cost as purchase_rate,
        inv.pack_retail as retail_price,
        inv.cost_price as cost_price_per_unit,
        inv.retail_price as retail_price_per_unit,
        inv.units_per_pack,
        inv.strips_per_box,
        inv.units_per_strip,
        COALESCE(inv.opening_stock_packs, 0.0) as opening_stock,
        inv.purchased_qty,
        inv.bonus_qty,
        inv.sold_qty,
        COALESCE(inv.purchase_return_qty, inv.returned_qty) as purchase_return_qty,
        COALESCE(inv.sales_return_qty, 0.0) as sales_return_qty,
        COALESCE(inv.adjusted_qty, 0.0) as adjusted_qty,
        inv.current_pack_qty as current_stock,
        inv.current_strip_qty,
        inv.current_loose_qty,
        inv.total_stock_units,
        ROUND(inv.current_pack_qty * inv.pack_cost, 2) as stock_value,
        ROUND(inv.current_pack_qty * inv.pack_retail, 2) as retail_value,
        inv.rack_shelf,
        i.minimum_stock,
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
        Number(r.minimum_stock || 0)
      );
      return {
        ...r,
        expiry_status: expStatus.status,
        days_to_expiry: expStatus.daysToExpiry,
        is_expired: expStatus.isExpired,
        is_near_expiry: expStatus.isNearExpiry,
        stock_status: stockStatus,
      };
    });

    res.json({
      success: true,
      data: rows,
      totalCount,
      page: pageNum,
      pageSize: limitNum,
      summary: {
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
    const { q, company, category, inStockOnly } = req.query;

    const conditions: string[] = ["i.status = 'active'"];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push('(i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ? OR i.barcode LIKE ?)');
      params.push(term, term, term, term);
    }
    if (company && typeof company === 'string' && company !== 'all') {
      conditions.push('i.company_name = ?');
      params.push(company);
    }
    if (category && typeof category === 'string' && category !== 'all') {
      conditions.push('i.category = ?');
      params.push(category);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        i.id as item_id,
        i.item_code,
        i.barcode,
        i.company_name,
        i.item_name,
        i.generic_name,
        i.category,
        i.packing,
        i.purchase_price as default_purchase_price,
        i.retail_price as default_retail_price,
        i.minimum_stock,
        i.rack_number,
        COUNT(inv.id) as batch_count,
        COALESCE(SUM(inv.current_pack_qty), 0.0) as total_packs,
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

    const enriched = rows.map((r) => {
      const totalPacks = round2(r.total_packs);
      const totalCost = round2(r.total_stock_value);
      const minStock = Number(r.minimum_stock || 0);
      const weightedAvgCost = totalPacks > 0 ? round2(totalCost / totalPacks) : round2(r.default_purchase_price);

      return {
        ...r,
        total_packs: totalPacks,
        total_units: round2(r.total_units),
        weighted_avg_cost: weightedAvgCost,
        total_stock_value: totalCost,
        total_retail_value: round2(r.total_retail_value),
        is_low_stock: minStock > 0 && totalPacks <= minStock,
        reorder_suggested: minStock > 0 && totalPacks < minStock ? round2(minStock - totalPacks) : 0,
      };
    });

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
 * 4. GET /api/inventory/expiry-alerts
 * Expiry categorization and alert lists
 */
inventoryRouter.get('/expiry-alerts', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { days } = req.query;

    const settings = db
      .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
      .get() as { near_expiry_days?: number } | undefined;
    const thresholdDays = days ? parseInt(String(days), 10) : settings?.near_expiry_days || 90;

    const todayStr = new Date().toISOString().slice(0, 10);
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + thresholdDays);
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    const expired = db
      .prepare(`
        SELECT inv.*, i.item_code, i.item_name, i.company_name, i.packing, i.rack_number
        FROM inventory inv
        JOIN items i ON inv.item_id = i.id
        WHERE inv.expiry_date < ? AND inv.current_pack_qty > 0
        ORDER BY inv.expiry_date ASC
      `)
      .all(todayStr) as Array<Record<string, unknown>>;

    const nearExpiry = db
      .prepare(`
        SELECT inv.*, i.item_code, i.item_name, i.company_name, i.packing, i.rack_number
        FROM inventory inv
        JOIN items i ON inv.item_id = i.id
        WHERE inv.expiry_date >= ? AND inv.expiry_date <= ? AND inv.current_pack_qty > 0
        ORDER BY inv.expiry_date ASC
      `)
      .all(todayStr, targetDateStr) as Array<Record<string, unknown>>;

    const enrichList = (list: Array<Record<string, unknown>>) =>
      list.map((item) => {
        const exp = computeExpiryStatus(String(item.expiry_date), thresholdDays);
        return {
          ...item,
          days_to_expiry: exp.daysToExpiry,
          expiry_status: exp.status,
          stock_value: round2(Number(item.current_pack_qty || 0) * Number(item.pack_cost || 0)),
        };
      });

    res.json({
      success: true,
      thresholdDays,
      expired: enrichList(expired),
      nearExpiry: enrichList(nearExpiry),
      summary: {
        expiredCount: expired.length,
        expiredPacks: round2(expired.reduce((sum, i) => sum + Number(i.current_pack_qty || 0), 0)),
        expiredCostValue: round2(expired.reduce((sum, i) => sum + Number(i.current_pack_qty || 0) * Number(i.pack_cost || 0), 0)),
        nearExpiryCount: nearExpiry.length,
        nearExpiryPacks: round2(nearExpiry.reduce((sum, i) => sum + Number(i.current_pack_qty || 0), 0)),
        nearExpiryCostValue: round2(nearExpiry.reduce((sum, i) => sum + Number(i.current_pack_qty || 0) * Number(i.pack_cost || 0), 0)),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 5. GET /api/inventory/low-stock
 * Low Stock Items with Reorder Planning
 */
inventoryRouter.get('/low-stock', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const sql = `
      SELECT
        i.id as item_id,
        i.item_code,
        i.item_name,
        i.company_name,
        i.category,
        i.packing,
        i.purchase_price,
        i.retail_price,
        i.minimum_stock,
        i.rack_number,
        COALESCE(inv.total_packs, 0.0) as current_stock_packs,
        COALESCE(inv.total_units, 0.0) as current_stock_units,
        (i.minimum_stock - COALESCE(inv.total_packs, 0.0)) as deficit_packs,
        ROUND((i.minimum_stock - COALESCE(inv.total_packs, 0.0)) * i.purchase_price, 2) as estimated_reorder_cost
      FROM items i
      LEFT JOIN (
        SELECT item_id, SUM(current_pack_qty) as total_packs, SUM(total_stock_units) as total_units
        FROM inventory
        GROUP BY item_id
      ) inv ON i.id = inv.item_id
      WHERE i.status = 'active'
        AND i.minimum_stock > 0
        AND COALESCE(inv.total_packs, 0.0) <= i.minimum_stock
      ORDER BY deficit_packs DESC, i.item_name ASC
    `;

    const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;

    res.json({
      success: true,
      count: rows.length,
      data: rows,
      totalEstimatedCost: round2(rows.reduce((sum, r) => sum + Number(r.estimated_reorder_cost || 0), 0)),
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
    const { startDate, endDate, type } = req.query;

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

    const adjustments = db
      .prepare(`
        SELECT
          adj.*,
          je.entry_number as journal_entry_number
        FROM stock_adjustments adj
        LEFT JOIN journal_entries je ON adj.journal_entry_id = je.id
        ${whereSql}
        ORDER BY adj.adjustment_date DESC, adj.id DESC
      `)
      .all(...params);

    res.json({ success: true, count: adjustments.length, data: adjustments });
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

    const items = db
      .prepare('SELECT * FROM stock_adjustment_items WHERE adjustment_id = ?')
      .all(id);

    res.json({ success: true, data: { ...adj, items } });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/inventory/adjustments
 * Create confirmed stock adjustment (Increase, Decrease, Damage, Expired, Physical Difference)
 * Generates automatic balanced Double-Entry Accounting journal posting
 */
inventoryRouter.post('/adjustments', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body;
    const currentUser = req.user?.username || 'Super Admin';
    const currentUserId = req.user?.id || null;

    const {
      adjustment_date = new Date().toISOString().slice(0, 10),
      adjustment_type,
      reason,
      items,
    } = body;

    if (!adjustment_type || !['Increase', 'Decrease', 'Damage', 'Expired', 'Physical Difference', 'Correction'].includes(adjustment_type)) {
      return res.status(400).json({ success: false, error: 'Invalid adjustment type.' });
    }

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, error: 'Adjustment reason is required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine line item is required.' });
    }

    let createdAdjId = 0;
    let finalAdjustmentNumber = '';

    const executeAdjustment = db.transaction(() => {
      const year = new Date().getFullYear();
      const lastAdj = db
        .prepare('SELECT id FROM stock_adjustments ORDER BY id DESC LIMIT 1')
        .get() as { id: number } | undefined;
      const nextSeq = (lastAdj?.id || 0) + 1;
      finalAdjustmentNumber = `ADJ-${year}-${String(nextSeq).padStart(4, '0')}`;

      let totalCostImpact = 0;

      // Validate and compute items
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
        reasonCategory: string;
        remarks: string;
      }

      const validatedLines: ValidatedAdjLine[] = [];

      for (let i = 0; i < items.length; i++) {
        const line = items[i];
        const inventoryId = Number(line.inventory_id);
        if (!inventoryId) {
          throw new Error(`Row #${i + 1}: Batch selection is required.`);
        }

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

        const unitsPerPack = Number(invRow.units_per_pack || 1);
        const packQty = round2(Math.max(0, Number(line.pack_qty || 0)));
        const looseQty = round2(Math.max(0, Number(line.loose_qty || 0)));
        const deltaUnits = round2(packQty * unitsPerPack + looseQty);

        if (deltaUnits <= 0) {
          throw new Error(`Row #${i + 1} (${invRow.item_name}): Adjustment quantity must be greater than 0.`);
        }

        const mode: 'Increase' | 'Decrease' = line.adjustment_mode === 'Increase' ? 'Increase' : 'Decrease';
        const currentStockUnits = Number(invRow.total_stock_units || 0);

        if (mode === 'Decrease' && deltaUnits > currentStockUnits) {
          throw new Error(
            `Row #${i + 1} (${invRow.item_name}): Cannot decrease by ${packQty} packs (${deltaUnits} units). Available stock is only ${round2(currentStockUnits / unitsPerPack)} packs (${currentStockUnits} units).`
          );
        }

        const newStockUnits = mode === 'Increase'
          ? round2(currentStockUnits + deltaUnits)
          : round2(currentStockUnits - deltaUnits);

        const costPerUnit = Number(invRow.cost_price || 0);
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
          reasonCategory: String(line.reason_category || adjustment_type || 'General Adjustment'),
          remarks: String(line.remarks || '').trim(),
        });
      }

      // Insert Header
      const insertAdj = db.prepare(`
        INSERT INTO stock_adjustments (
          adjustment_number, adjustment_date, adjustment_type, total_items,
          total_cost_impact, created_by_user_id, created_by_username,
          reason, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')
      `).run(
        finalAdjustmentNumber,
        adjustment_date,
        adjustment_type,
        validatedLines.length,
        totalCostImpact,
        currentUserId,
        currentUser,
        String(reason).trim()
      );

      createdAdjId = Number(insertAdj.lastInsertRowid);

      // Insert Items and apply stock updates
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

        // Update inventory batch record
        const newPackQty = round2(line.newStockUnits / line.unitsPerPack);
        const newLooseQty = round2(line.newStockUnits % line.unitsPerPack);
        const parsed = parsePacking(line.packing);
        const newStripQty = round2(newPackQty * parsed.stripsPerBox);

        const deltaPacks = line.mode === 'Increase'
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

      // Generate Double-Entry Accounting Entry
      const absCostImpact = round2(Math.abs(totalCostImpact));
      if (absCostImpact > 0) {
        const invAssetAccId = getAccountIdByCode('INV-1030');
        const adjExpenseAccId = getAccountIdByCode('ADJ-5035');
        const adjIncomeAccId = getAccountIdByCode('ADJ-4035');

        const entryNumber = `JE-ADJ-${year}-${String(createdAdjId).padStart(4, '0')}`;
        const desc = `Stock Adjustment ${finalAdjustmentNumber} (${adjustment_type}): ${reason}`;

        const insertJe = db.prepare(`
          INSERT INTO journal_entries (
            entry_number, reference_type, reference_id, description,
            total_debit, total_credit, is_balanced, status
          ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, 1, 'posted')
        `).run(
          entryNumber,
          createdAdjId,
          desc,
          absCostImpact,
          absCostImpact
        );

        const jeId = Number(insertJe.lastInsertRowid);

        const insertLine = db.prepare(`
          INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
          ) VALUES (?, ?, 'general', ?, ?, ?)
        `);

        if (totalCostImpact < 0) {
          // Stock Reduction (Loss / Damage / Expiry)
          // Debit: Stock Adjustment Expense (ADJ-5035)
          // Credit: Medicine Inventory Asset (INV-1030)
          insertLine.run(jeId, adjExpenseAccId, absCostImpact, 0, `Stock reduction loss: ${reason}`);
          insertLine.run(jeId, invAssetAccId, 0, absCostImpact, `Inventory asset write-off: ${reason}`);
        } else {
          // Stock Increase (Surplus)
          // Debit: Medicine Inventory Asset (INV-1030)
          // Credit: Stock Adjustment Surplus Income (ADJ-4035)
          insertLine.run(jeId, invAssetAccId, absCostImpact, 0, `Inventory asset increase: ${reason}`);
          insertLine.run(jeId, adjIncomeAccId, 0, absCostImpact, `Stock surplus income: ${reason}`);
        }

        db.prepare('UPDATE stock_adjustments SET journal_entry_id = ? WHERE id = ?').run(jeId, createdAdjId);
      }
    });

    executeAdjustment();

    res.json({
      success: true,
      message: `Stock Adjustment ${finalAdjustmentNumber} recorded and stock successfully adjusted.`,
      adjustmentId: createdAdjId,
      adjustmentNumber: finalAdjustmentNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 7. GET /api/inventory/transfers & POST /api/inventory/transfers
 * Stock Transfers (Rack/Shelf and Store Locations)
 */
inventoryRouter.get('/transfers', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM stock_transfers ORDER BY id DESC').all();
    res.json({ success: true, count: rows.length, data: rows });
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
      reason,
      items,
    } = body;

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

      const insertTrf = db.prepare(`
        INSERT INTO stock_transfers (
          transfer_number, transfer_date, from_location, to_location,
          total_items, total_units, created_by_username, reason, status
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'completed')
      `).run(
        transferNumber,
        transfer_date,
        String(from_location).trim(),
        String(to_location).trim(),
        items.length,
        currentUser,
        String(reason || '').trim()
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

        const unitsPerPack = Number(inv.units_per_pack || 1);
        const packQty = round2(Number(line.pack_qty || 0));
        const looseQty = round2(Number(line.loose_qty || 0));
        const lineUnits = round2(packQty * unitsPerPack + looseQty);

        totalUnits = round2(totalUnits + lineUnits);

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
          String(line.from_shelf || inv.rack_shelf || from_location),
          String(line.to_shelf || to_location),
          String(line.remarks || '')
        );

        // Update rack_shelf on batch if moved to a new shelf/location
        if (line.to_shelf || to_location) {
          db.prepare('UPDATE inventory SET rack_shelf = ? WHERE id = ?').run(
            String(line.to_shelf || to_location),
            invId
          );
        }
      }

      db.prepare('UPDATE stock_transfers SET total_units = ? WHERE id = ?').run(totalUnits, createdTrfId);
    });

    executeTransfer();

    res.json({
      success: true,
      message: `Stock Transfer ${transferNumber} recorded successfully.`,
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
 * Chronological Item Movement History & Running Balance
 */
inventoryRouter.get('/stock-ledger', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { itemId, batchNumber, startDate, endDate } = req.query;

    if (!itemId) {
      return res.status(400).json({ success: false, error: 'Please select an item to view its Stock Ledger.' });
    }

    const itemRow = db
      .prepare('SELECT * FROM items WHERE id = ?')
      .get(Number(itemId)) as Record<string, unknown> | undefined;

    if (!itemRow) {
      return res.status(404).json({ success: false, error: 'Item not found in Items Master.' });
    }

    const parsedPacking = parsePacking(String(itemRow.packing || '1x1'));

    interface LedgerEntry {
      date: string;
      timestamp: string;
      docNumber: string;
      docType: 'Opening Stock' | 'Purchase' | 'Purchase Bonus' | 'Sale' | 'Purchase Return' | 'Sales Return' | 'Adjustment Increase' | 'Adjustment Decrease' | 'Stock Transfer';
      partyName: string;
      batchNumber: string;
      expiryDate: string;
      inPacks: number;
      inLoose: number;
      inTotalUnits: number;
      outPacks: number;
      outLoose: number;
      outTotalUnits: number;
      unitRate: number;
      totalAmount: number;
      runningBalancePacks: number;
      runningBalanceUnits: number;
      notes: string;
    }

    const entries: LedgerEntry[] = [];

    // A. Initial Opening Stock from inventory batch creation
    const openingBatches = db
      .prepare(`
        SELECT *
        FROM inventory
        WHERE item_id = ? ${batchNumber ? 'AND batch_number = ?' : ''}
          AND (last_purchase_id IS NULL OR last_purchase_id = 0)
          AND opening_stock_packs > 0
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const b of openingBatches) {
      const packs = Number(b.opening_stock_packs || 0);
      const units = round2(packs * parsedPacking.unitsPerPack);
      entries.push({
        date: String(b.created_at || '2026-01-01').slice(0, 10),
        timestamp: String(b.created_at || '2026-01-01 00:00:00'),
        docNumber: `OPN-${b.id}`,
        docType: 'Opening Stock',
        partyName: 'Store Initial Balance',
        batchNumber: String(b.batch_number),
        expiryDate: String(b.expiry_date),
        inPacks: packs,
        inLoose: 0,
        inTotalUnits: units,
        outPacks: 0,
        outLoose: 0,
        outTotalUnits: 0,
        unitRate: round2(b.pack_cost || itemRow.purchase_price),
        totalAmount: round2(packs * Number(b.pack_cost || itemRow.purchase_price)),
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: 'Initial inventory setup',
      });
    }

    // B. Purchases (Confirmed Supplier Goods Receipts)
    const purchases = db
      .prepare(`
        SELECT
          p.bill_number,
          p.bill_date,
          p.created_at,
          a.account_name as supplier_name,
          pi.batch_number,
          pi.expiry_date,
          pi.quantity,
          pi.bonus_quantity,
          pi.purchase_rate,
          pi.line_total
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN accounts a ON p.supplier_account_id = a.id
        WHERE pi.item_id = ? AND p.status = 'completed'
          ${batchNumber ? 'AND pi.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const p of purchases) {
      const purchasedPacks = Number(p.quantity || 0);
      const bonusPacks = Number(p.bonus_quantity || 0);

      if (purchasedPacks > 0) {
        entries.push({
          date: String(p.bill_date),
          timestamp: String(p.created_at || p.bill_date),
          docNumber: String(p.bill_number),
          docType: 'Purchase',
          partyName: String(p.supplier_name || 'Pharmaceutical Supplier'),
          batchNumber: String(p.batch_number),
          expiryDate: String(p.expiry_date),
          inPacks: purchasedPacks,
          inLoose: 0,
          inTotalUnits: round2(purchasedPacks * parsedPacking.unitsPerPack),
          outPacks: 0,
          outLoose: 0,
          outTotalUnits: 0,
          unitRate: round2(p.purchase_rate),
          totalAmount: round2(p.line_total),
          runningBalancePacks: 0,
          runningBalanceUnits: 0,
          notes: 'Confirmed Supplier Purchase',
        });
      }

      if (bonusPacks > 0) {
        entries.push({
          date: String(p.bill_date),
          timestamp: String(p.created_at || p.bill_date),
          docNumber: String(p.bill_number),
          docType: 'Purchase Bonus',
          partyName: String(p.supplier_name || 'Pharmaceutical Supplier'),
          batchNumber: String(p.batch_number),
          expiryDate: String(p.expiry_date),
          inPacks: bonusPacks,
          inLoose: 0,
          inTotalUnits: round2(bonusPacks * parsedPacking.unitsPerPack),
          outPacks: 0,
          outLoose: 0,
          outTotalUnits: 0,
          unitRate: 0, // Bonus stock has 0 invoice charge
          totalAmount: 0,
          runningBalancePacks: 0,
          runningBalanceUnits: 0,
          notes: 'Free scheme / bonus quantity received',
        });
      }
    }

    // C. Sales (Completed Customer Invoices)
    const sales = db
      .prepare(`
        SELECT
          s.invoice_number,
          s.invoice_date,
          s.created_at,
          s.customer_name,
          si.batch_number,
          si.expiry_date,
          si.quantity,
          si.loose_quantity,
          si.total_units,
          si.unit_price,
          si.line_total
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.item_id = ? AND s.status = 'completed'
          ${batchNumber ? 'AND si.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const s of sales) {
      entries.push({
        date: String(s.invoice_date),
        timestamp: String(s.created_at || s.invoice_date),
        docNumber: String(s.invoice_number),
        docType: 'Sale',
        partyName: String(s.customer_name || 'Customer'),
        batchNumber: String(s.batch_number),
        expiryDate: String(s.expiry_date),
        inPacks: 0,
        inLoose: 0,
        inTotalUnits: 0,
        outPacks: Number(s.quantity || 0),
        outLoose: Number(s.loose_quantity || 0),
        outTotalUnits: Number(s.total_units || 0),
        unitRate: round2(s.unit_price),
        totalAmount: round2(s.line_total),
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: 'Sales billing dispatch',
      });
    }

    // D. Purchase Returns (Supplier Debit Notes)
    const purReturns = db
      .prepare(`
        SELECT
          pr.debit_note_number,
          pr.return_date,
          pr.created_at,
          a.account_name as supplier_name,
          pri.batch_number,
          pri.expiry_date,
          pri.return_quantity,
          pri.return_units,
          pri.debit_unit_rate,
          pri.line_total,
          pri.return_reason
        FROM purchase_return_items pri
        JOIN purchase_returns pr ON pri.purchase_return_id = pr.id
        LEFT JOIN accounts a ON pr.supplier_account_id = a.id
        WHERE pri.item_id = ? AND pr.status = 'completed'
          ${batchNumber ? 'AND pri.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const pr of purReturns) {
      entries.push({
        date: String(pr.return_date),
        timestamp: String(pr.created_at || pr.return_date),
        docNumber: String(pr.debit_note_number),
        docType: 'Purchase Return',
        partyName: String(pr.supplier_name || 'Supplier'),
        batchNumber: String(pr.batch_number),
        expiryDate: String(pr.expiry_date),
        inPacks: 0,
        inLoose: 0,
        inTotalUnits: 0,
        outPacks: Number(pr.return_quantity || 0),
        outLoose: 0,
        outTotalUnits: Number(pr.return_units || 0),
        unitRate: round2(pr.debit_unit_rate),
        totalAmount: round2(pr.line_total),
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: `Returned to supplier: ${pr.return_reason || ''}`,
      });
    }

    // E. Sales Returns (Customer Credit Notes & Restocks)
    const saleReturns = db
      .prepare(`
        SELECT
          sr.return_number,
          sr.return_date,
          sr.created_at,
          sr.customer_name,
          sri.batch_number,
          sri.expiry_date,
          sri.return_pack_qty,
          sri.return_loose_qty,
          sri.returned_units,
          sri.return_rate,
          sri.line_total,
          sri.return_reason
        FROM sale_return_items sri
        JOIN sale_returns sr ON sri.sale_return_id = sr.id
        WHERE sri.item_id = ? AND sr.status = 'completed' AND sri.restock_status = 'restocked'
          ${batchNumber ? 'AND sri.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const sr of saleReturns) {
      entries.push({
        date: String(sr.return_date),
        timestamp: String(sr.created_at || sr.return_date),
        docNumber: String(sr.return_number),
        docType: 'Sales Return',
        partyName: String(sr.customer_name || 'Customer'),
        batchNumber: String(sr.batch_number),
        expiryDate: String(sr.expiry_date),
        inPacks: Number(sr.return_pack_qty || 0),
        inLoose: Number(sr.return_loose_qty || 0),
        inTotalUnits: Number(sr.returned_units || 0),
        outPacks: 0,
        outLoose: 0,
        outTotalUnits: 0,
        unitRate: round2(sr.return_rate),
        totalAmount: round2(sr.line_total),
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: `Customer return restocked: ${sr.return_reason || ''}`,
      });
    }

    // F. Stock Adjustments (Increase / Decrease)
    const adjustments = db
      .prepare(`
        SELECT
          adj.adjustment_number,
          adj.adjustment_date,
          adj.created_at,
          adj.adjustment_type,
          adj.reason,
          ai.batch_number,
          ai.expiry_date,
          ai.adjustment_mode,
          ai.pack_qty,
          ai.loose_qty,
          ai.total_units,
          ai.cost_price_per_unit,
          ai.total_cost,
          ai.reason_category,
          ai.remarks
        FROM stock_adjustment_items ai
        JOIN stock_adjustments adj ON ai.adjustment_id = adj.id
        WHERE ai.item_id = ? AND adj.status = 'completed'
          ${batchNumber ? 'AND ai.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const a of adjustments) {
      const isInc = a.adjustment_mode === 'Increase';
      entries.push({
        date: String(a.adjustment_date),
        timestamp: String(a.created_at || a.adjustment_date),
        docNumber: String(a.adjustment_number),
        docType: isInc ? 'Adjustment Increase' : 'Adjustment Decrease',
        partyName: `Adjustment: ${a.reason_category}`,
        batchNumber: String(a.batch_number),
        expiryDate: String(a.expiry_date),
        inPacks: isInc ? Number(a.pack_qty || 0) : 0,
        inLoose: isInc ? Number(a.loose_qty || 0) : 0,
        inTotalUnits: isInc ? Number(a.total_units || 0) : 0,
        outPacks: !isInc ? Number(a.pack_qty || 0) : 0,
        outLoose: !isInc ? Number(a.loose_qty || 0) : 0,
        outTotalUnits: !isInc ? Number(a.total_units || 0) : 0,
        unitRate: round2(Number(a.cost_price_per_unit || 0) * parsedPacking.unitsPerPack),
        totalAmount: round2(a.total_cost),
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: String(a.remarks || a.reason || ''),
      });
    }

    // G. Stock Transfers
    const transfers = db
      .prepare(`
        SELECT
          trf.transfer_number,
          trf.transfer_date,
          trf.created_at,
          trf.from_location,
          trf.to_location,
          trf.reason,
          ti.batch_number,
          ti.pack_qty,
          ti.loose_qty,
          ti.total_units,
          ti.from_shelf,
          ti.to_shelf
        FROM stock_transfer_items ti
        JOIN stock_transfers trf ON ti.transfer_id = trf.id
        WHERE ti.item_id = ? AND trf.status = 'completed'
          ${batchNumber ? 'AND ti.batch_number = ?' : ''}
      `)
      .all(...(batchNumber ? [Number(itemId), String(batchNumber)] : [Number(itemId)])) as Array<Record<string, unknown>>;

    for (const t of transfers) {
      entries.push({
        date: String(t.transfer_date),
        timestamp: String(t.created_at || t.transfer_date),
        docNumber: String(t.transfer_number),
        docType: 'Stock Transfer',
        partyName: `Move: ${t.from_shelf || t.from_location} → ${t.to_shelf || t.to_location}`,
        batchNumber: String(t.batch_number),
        expiryDate: '',
        inPacks: 0,
        inLoose: 0,
        inTotalUnits: 0,
        outPacks: 0,
        outLoose: 0,
        outTotalUnits: 0,
        unitRate: 0,
        totalAmount: 0,
        runningBalancePacks: 0,
        runningBalanceUnits: 0,
        notes: `Internal transfer: ${t.reason || ''}`,
      });
    }

    // Sort chronologically
    entries.sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return a.timestamp.localeCompare(b.timestamp);
    });

    // Compute running balance
    let currentUnits = 0;
    for (const e of entries) {
      currentUnits = round2(currentUnits + e.inTotalUnits - e.outTotalUnits);
      e.runningBalanceUnits = currentUnits;
      e.runningBalancePacks = round2(currentUnits / parsedPacking.unitsPerPack);
    }

    // Filter by date range if requested
    let filteredEntries = entries;
    if (startDate) {
      filteredEntries = filteredEntries.filter((e) => e.date >= String(startDate));
    }
    if (endDate) {
      filteredEntries = filteredEntries.filter((e) => e.date <= String(endDate));
    }

    res.json({
      success: true,
      item: {
        id: itemRow.id,
        item_code: itemRow.item_code,
        item_name: itemRow.item_name,
        company_name: itemRow.company_name,
        packing: itemRow.packing,
        units_per_pack: parsedPacking.unitsPerPack,
        closing_balance_packs: round2(currentUnits / parsedPacking.unitsPerPack),
        closing_balance_units: currentUnits,
      },
      count: filteredEntries.length,
      entries: filteredEntries,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * 9. Physical Stock Verifications (Count Sheet, Variance & Reconciliation)
 */
inventoryRouter.get('/physical-verifications', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM physical_verifications ORDER BY id DESC').all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

inventoryRouter.get('/physical-verifications/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    const record = db.prepare('SELECT * FROM physical_verifications WHERE id = ?').get(id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Verification count sheet not found.' });
    }

    const items = db.prepare('SELECT * FROM physical_verification_items WHERE verification_id = ?').all(id);

    res.json({ success: true, data: { ...record, items } });
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
      items,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one medicine item count is required.' });
    }

    let createdId = 0;
    let verificationNumber = '';

    const executeCreate = db.transaction(() => {
      const year = new Date().getFullYear();
      const lastVer = db.prepare('SELECT id FROM physical_verifications ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
      verificationNumber = `STK-VER-${year}-${String((lastVer?.id || 0) + 1).padStart(4, '0')}`;

      let discrepancyCount = 0;
      let netCostDiscrepancy = 0;

      const insertVer = db.prepare(`
        INSERT INTO physical_verifications (
          verification_number, verification_date, verified_by,
          total_items_checked, total_discrepancies, net_cost_discrepancy,
          status, remarks
        ) VALUES (?, ?, ?, ?, 0, 0, 'pending', ?)
      `).run(
        verificationNumber,
        verification_date,
        currentUser,
        items.length,
        String(remarks || '').trim()
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

      for (const line of items) {
        const invId = Number(line.inventory_id);
        const inv = db
          .prepare('SELECT inv.*, i.item_name, i.item_code, i.company_name FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ?')
          .get(invId) as Record<string, unknown> | undefined;

        if (!inv) throw new Error(`Batch ID ${invId} does not exist.`);

        const unitsPerPack = Number(inv.units_per_pack || 1);
        const systemUnits = Number(inv.total_stock_units || 0);
        const systemPacks = round2(systemUnits / unitsPerPack);

        const physicalPacks = round2(Math.max(0, Number(line.physical_packs ?? systemPacks)));
        const physicalLoose = round2(Math.max(0, Number(line.physical_loose ?? 0)));
        const physicalUnits = round2(physicalPacks * unitsPerPack + physicalLoose);

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
          physicalPacks,
          diffUnits,
          diffPacks,
          costPerUnit,
          discCost,
          String(line.adjustment_reason || '').trim()
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
      message: `Physical Stock Count ${verificationNumber} saved with status "pending". Review variances and confirm reconciliation.`,
      verificationId: createdId,
      verificationNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/inventory/physical-verifications/:id/reconcile
 * Authorized reconciliation: applies stock adjustment and updates batch stock
 */
inventoryRouter.post('/physical-verifications/:id/reconcile', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const currentUser = req.user?.username || 'Super Admin';
    const currentUserId = req.user?.id || null;

    const ver = db.prepare('SELECT * FROM physical_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!ver) {
      return res.status(404).json({ success: false, error: 'Physical verification record not found.' });
    }
    if (ver.status === 'reconciled') {
      return res.status(400).json({ success: false, error: 'This verification has already been reconciled.' });
    }

    const items = db
      .prepare('SELECT * FROM physical_verification_items WHERE verification_id = ?')
      .all(id) as Array<Record<string, unknown>>;

    const discrepancyItems = items.filter((i) => Number(i.difference_units || 0) !== 0);

    let adjustmentId: number | null = null;
    let adjNumber = '';

    const executeReconciliation = db.transaction(() => {
      if (discrepancyItems.length > 0) {
        const year = new Date().getFullYear();
        const lastAdj = db.prepare('SELECT id FROM stock_adjustments ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
        adjNumber = `ADJ-${year}-${String((lastAdj?.id || 0) + 1).padStart(4, '0')}`;

        let totalCostImpact = 0;

        const insertAdj = db.prepare(`
          INSERT INTO stock_adjustments (
            adjustment_number, adjustment_date, adjustment_type, total_items,
            total_cost_impact, created_by_user_id, created_by_username,
            reason, status
          ) VALUES (?, ?, 'Physical Difference', ?, 0, ?, ?, ?, 'completed')
        `).run(
          adjNumber,
          new Date().toISOString().slice(0, 10),
          discrepancyItems.length,
          currentUserId,
          currentUser,
          `Physical Stock Audit Reconciliation (${ver.verification_number})`
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
          const diffUnits = Number(item.difference_units || 0);
          const mode: 'Increase' | 'Decrease' = diffUnits > 0 ? 'Increase' : 'Decrease';
          const absDiffUnits = Math.abs(diffUnits);
          const unitsPerPack = Number(invRow.units_per_pack || 1);
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

          // Update inventory batch stock to exact physical count
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

        db.prepare('UPDATE stock_adjustments SET total_cost_impact = ? WHERE id = ?').run(
          totalCostImpact,
          adjustmentId
        );

        // Accounting GL Entries
        const absCostImpact = round2(Math.abs(totalCostImpact));
        if (absCostImpact > 0) {
          const invAssetAccId = getAccountIdByCode('INV-1030');
          const adjExpenseAccId = getAccountIdByCode('ADJ-5035');
          const adjIncomeAccId = getAccountIdByCode('ADJ-4035');

          const entryNumber = `JE-AUDIT-${year}-${String(adjustmentId).padStart(4, '0')}`;
          const desc = `Physical Stock Verification Reconciliation (${ver.verification_number})`;

          const insertJe = db.prepare(`
            INSERT INTO journal_entries (
              entry_number, reference_type, reference_id, description,
              total_debit, total_credit, is_balanced, status
            ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, 1, 'posted')
          `).run(
            entryNumber,
            adjustmentId,
            desc,
            absCostImpact,
            absCostImpact
          );

          const jeId = Number(insertJe.lastInsertRowid);
          const insertLine = db.prepare(`
            INSERT INTO journal_entry_lines (
              journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
            ) VALUES (?, ?, 'general', ?, ?, ?)
          `);

          if (totalCostImpact < 0) {
            insertLine.run(jeId, adjExpenseAccId, absCostImpact, 0, `Physical shortage write-off: ${ver.verification_number}`);
            insertLine.run(jeId, invAssetAccId, 0, absCostImpact, `Inventory asset physical count correction: ${ver.verification_number}`);
          } else {
            insertLine.run(jeId, invAssetAccId, absCostImpact, 0, `Inventory asset physical surplus: ${ver.verification_number}`);
            insertLine.run(jeId, adjIncomeAccId, 0, absCostImpact, `Physical surplus gain: ${ver.verification_number}`);
          }

          db.prepare('UPDATE stock_adjustments SET journal_entry_id = ? WHERE id = ?').run(jeId, adjustmentId);
        }
      }

      // Mark verification as reconciled
      db.prepare(`
        UPDATE physical_verifications
        SET status = 'reconciled',
            reconciled_at = CURRENT_TIMESTAMP,
            reconciled_by = ?,
            adjustment_id = ?
        WHERE id = ?
      `).run(currentUser, adjustmentId, id);

      db.prepare('UPDATE physical_verification_items SET is_reconciled = 1 WHERE verification_id = ?').run(id);
    });

    executeReconciliation();

    res.json({
      success: true,
      message: `Physical count sheet ${ver.verification_number} reconciled successfully.${adjustmentId ? ` Adjustment voucher ${adjNumber} created.` : ' No stock variances found.'}`,
      adjustmentId,
      adjustmentNumber: adjNumber,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: errorMsg });
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
    res.json({
      success: true,
      settings: {
        near_expiry_days: settings?.near_expiry_days || 90,
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
