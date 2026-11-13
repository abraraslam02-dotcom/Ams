import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { round2, parsePacking } from './purchases.ts';
import { triggerPreChangeBackupIfEnabled, logSystemError } from '../services/backupService.ts';
import {
  peekNextInvoiceNumber,
  allocateNextInvoiceNumber,
  bindInvoiceNumberRecordId,
} from '../services/invoiceSequenceService.ts';
import {
  previewFIFOAllocation,
  evaluateLineOfferAndPartyDiscount,
  recordBatchStockMovement,
} from '../services/fifoAndOfferEngine.ts';

export const salesRouter = Router();

function getSystemAccountId(accountCode: string): number {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM accounts WHERE account_code = ?')
    .get(accountCode) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Required Chart of Accounts head "${accountCode}" is missing.`);
  }
  return row.id;
}

function computeBatchStatus(packQty: number, expiryDate: string, minStock: number = 0): string {
  if (packQty <= 0) return 'out_of_stock';
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate && expiryDate < today) return 'expired';
  if (minStock > 0 && packQty <= minStock) return 'low_stock';
  return 'in_stock';
}

function getNextSalesInvoiceNumber(dateStr?: string): string {
  return peekNextInvoiceNumber(dateStr);
}

function getNextSaleReturnNumber(): string {
  const db = getDatabase();
  const row = db
    .prepare("SELECT return_number FROM sale_returns WHERE return_number LIKE 'SRN-2026-%' ORDER BY id DESC LIMIT 1")
    .get() as { return_number: string } | undefined;
  let seq = 1;
  if (row?.return_number) {
    const match = row.return_number.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  while (
    db.prepare('SELECT id FROM sale_returns WHERE return_number = ?').get(`SRN-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `SRN-2026-${String(seq).padStart(4, '0')}`;
}

function getNextVoucherNumber(): string {
  const db = getDatabase();
  const row = db
    .prepare("SELECT voucher_number FROM payment_vouchers WHERE voucher_number LIKE 'VCH-2026-%' ORDER BY id DESC LIMIT 1")
    .get() as { voucher_number: string } | undefined;
  let seq = 1;
  if (row?.voucher_number) {
    const match = row.voucher_number.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  while (
    db.prepare('SELECT id FROM payment_vouchers WHERE voucher_number = ?').get(`VCH-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `VCH-2026-${String(seq).padStart(4, '0')}`;
}

function getNextJournalNumber(prefix: string): string {
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

/**
 * Helper to revert inventory & journal entries when an existing 'completed' sale is updated or cancelled
 */
function revertCompletedSaleEffects(saleId: number) {
  const db = getDatabase();
  const existingSale = db
    .prepare('SELECT * FROM sales WHERE id = ?')
    .get(saleId) as Record<string, unknown> | undefined;

  if (!existingSale || existingSale.status !== 'completed') return;

  const existingItems = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
    .all(saleId) as Array<Record<string, unknown>>;

  const stockAlreadyManagedBySupply = Number(existingSale.stock_deducted_at_dispatch || 0) === 1;

  for (const line of existingItems) {
    if (stockAlreadyManagedBySupply) break;
    const itemId = Number(line.item_id);
    const batchNumber = String(line.batch_number);
    const totalUnitsSold = Number(line.total_units || 0);
    const parsed = parsePacking(String(line.packing || '1x1'));
    const packSoldEquivalent = round2(totalUnitsSold / parsed.unitsPerPack);

    const inv = db
      .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
      .get(itemId, batchNumber) as Record<string, unknown> | undefined;

    if (inv) {
      const newSoldQty = round2(Math.max(0, Number(inv.sold_qty || 0) - packSoldEquivalent));
      const newTotalUnits = round2(Number(inv.total_stock_units || 0) + totalUnitsSold);
      const newPackQty = round2(newTotalUnits / parsed.unitsPerPack);
      const newStripQty = round2(newPackQty * parsed.stripsPerBox);
      const newLooseQty = round2(newTotalUnits % parsed.unitsPerPack);

      const itemRow = db
        .prepare('SELECT minimum_stock FROM items WHERE id = ?')
        .get(itemId) as { minimum_stock: number } | undefined;
      const status = computeBatchStatus(
        newPackQty,
        String(inv.expiry_date || ''),
        Number(itemRow?.minimum_stock || 0)
      );

      db.prepare(`
        UPDATE inventory
        SET sold_qty = ?,
            current_pack_qty = ?,
            current_strip_qty = ?,
            current_loose_qty = ?,
            total_stock_units = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newSoldQty, newPackQty, newStripQty, newLooseQty, newTotalUnits, status, Number(inv.id));
    }
  }

  // Delete all linked journal entries for this sale (by stored IDs AND by reference_type='SALE' & reference_id=saleId)
  // so editing or cancelling an invoice reverses 100% of its accounting effect and never creates duplicate ledger entries.
  const allSaleJournalRows = db
    .prepare("SELECT id FROM journal_entries WHERE reference_type = 'SALE' AND reference_id = ?")
    .all(saleId) as Array<{ id: number }>;

  const journalIdSet = new Set<number>([
    Number(existingSale.journal_entry_id || 0),
    Number(existingSale.payment_journal_entry_id || 0),
    ...allSaleJournalRows.map((r) => Number(r.id)),
  ]);
  journalIdSet.delete(0);

  const affectedAccounts = new Set<number>();
  if (existingSale.customer_account_id) affectedAccounts.add(Number(existingSale.customer_account_id));
  if (existingSale.payment_account_id) affectedAccounts.add(Number(existingSale.payment_account_id));

  for (const jId of journalIdSet) {
    const lines = db
      .prepare('SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = ?')
      .all(jId) as Array<{ account_id: number }>;
    for (const l of lines) affectedAccounts.add(Number(l.account_id));
    db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
  }

  db.prepare(
    'UPDATE sales SET journal_entry_id = NULL, payment_journal_entry_id = NULL WHERE id = ?'
  ).run(saleId);

  for (const accId of affectedAccounts) {
    recalculateAccountBalance(accId);
  }
}

/**
 * GET /api/sales/next-numbers
 */
salesRouter.get('/next-numbers', (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date ? String(req.query.date) : undefined;
    res.json({
      success: true,
      nextInvoiceNumber: getNextSalesInvoiceNumber(dateParam),
      nextReturnNumber: getNextSaleReturnNumber(),
      nextVoucherNumber: getNextVoucherNumber(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/fast-search
 * Ultra-fast indexed item & batch search by Item Code, Barcode, Item Name, Company Name, Generic Name
 */
salesRouter.get('/fast-search', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(10000, Math.max(5, Number(req.query.limit || 50)));

    let sql = `
      SELECT *
      FROM items
      WHERE status = 'Active'
    `;
    const params: Array<string | number> = [];

    if (q) {
      const exactTerm = q;
      const likeTerm = `%${q}%`;
      const prefixTerm = `${q}%`;
      sql += `
        AND (
          item_code LIKE ?
          OR barcode LIKE ?
          OR item_name LIKE ?
          OR company_name LIKE ?
          OR generic_name LIKE ?
        )
        ORDER BY
          CASE
            WHEN LOWER(item_code) = LOWER(?) THEN 0
            WHEN LOWER(barcode) = LOWER(?) THEN 1
            WHEN LOWER(item_name) LIKE LOWER(?) THEN 2
            ELSE 3
          END,
          item_name ASC
        LIMIT ?
      `;
      params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, exactTerm, exactTerm, prefixTerm, limit);
    } else {
      sql += ` ORDER BY item_name ASC LIMIT ?`;
      params.push(limit);
    }

    const items = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    // Fetch all batches for the matched items in one query
    const itemIds = items.map((i) => Number(i.id));
    const batchesByItem = new Map<number, Array<Record<string, unknown>>>();

    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => '?').join(',');
      const batchRows = db
        .prepare(`
          SELECT *
          FROM inventory
          WHERE item_id IN (${placeholders})
          ORDER BY
            CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END,
            expiry_date ASC,
            id ASC
        `)
        .all(...itemIds) as Array<Record<string, unknown>>;

      for (const b of batchRows) {
        const iId = Number(b.item_id);
        if (!batchesByItem.has(iId)) batchesByItem.set(iId, []);
        batchesByItem.get(iId)!.push(b);
      }
    }

    const enriched = items.map((item) => {
      const itemId = Number(item.id);
      const parsed = parsePacking(String(item.packing || '1x1'));
      const batches = batchesByItem.get(itemId) || [];

      const totalStockUnits = batches.reduce(
        (sum, b) => sum + Number(b.total_stock_units || 0),
        0
      );
      const totalStockPacks = round2(totalStockUnits / parsed.unitsPerPack);
      const retailPrice = round2(item.retail_price);
      const wholesalePrice = round2(Number(item.wholesale_price || item.trade_price || item.retail_price));
      const purchasePrice = round2(item.purchase_price);
      const itemMasterLooseRate = round2(retailPrice / parsed.unitsPerPack);

      const defaultBatch = batches[0] || null;

      return {
        ...item,
        strips_per_box: parsed.stripsPerBox,
        units_per_strip: parsed.unitsPerStrip,
        units_per_pack: parsed.unitsPerPack,
        loose_rate: itemMasterLooseRate,
        retail_loose_rate: itemMasterLooseRate,
        wholesale_loose_rate: round2(wholesalePrice / parsed.unitsPerPack),
        cost_price_per_unit: round2(purchasePrice / parsed.unitsPerPack),
        total_available_units: round2(totalStockUnits),
        total_available_packs: totalStockPacks,
        default_batch: defaultBatch
          ? {
              inventory_id: Number(defaultBatch.id),
              batch_number: String(defaultBatch.batch_number),
              expiry_date: String(defaultBatch.expiry_date),
              available_packs: round2(defaultBatch.current_pack_qty),
              available_units: round2(defaultBatch.total_stock_units),
            }
          : {
              inventory_id: null,
              batch_number: `BATCH-${String(item.item_code || itemId)}-01`,
              expiry_date: '2028-12-31',
              available_packs: 0,
              available_units: 0,
            },
        batches: batches.map((b) => ({
          id: Number(b.id),
          batch_number: String(b.batch_number),
          manufacturing_date: String(b.manufacturing_date || ''),
          expiry_date: String(b.expiry_date || ''),
          current_pack_qty: round2(b.current_pack_qty),
          current_strip_qty: round2(b.current_strip_qty),
          current_loose_qty: round2(b.current_loose_qty),
          total_stock_units: round2(b.total_stock_units),
          units_per_pack: Number(b.units_per_pack || parsed.unitsPerPack),
          mrp_per_pack: round2(b.pack_retail || b.retail_price || retailPrice),
          purchase_price_per_pack: round2(b.pack_cost || purchasePrice),
          status: String(b.status || 'in_stock'),
        })),
      };
    });

    res.json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales
 * Fetch Sales Register or Held/Draft Invoices with filters & pagination
 */
salesRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      q,
      customerId,
      paymentMode,
      invoiceType,
      status,
      salesman,
      salesmanId,
      deliverymanId,
      deliveryStatus,
      startDate,
      endDate,
      page = '1',
      pageSize = '50',
    } = req.query;

    let whereSql = ' WHERE 1=1 ';
    const params: Array<string | number> = [];

    if (status && status !== 'All') {
      if (status === 'held_or_draft') {
        whereSql += " AND s.status IN ('draft', 'held') ";
      } else if (status === 'register') {
        whereSql += " AND s.status IN ('completed', 'cancelled') ";
      } else {
        whereSql += ' AND s.status = ? ';
        params.push(String(status));
      }
    }

    if (customerId && customerId !== 'All') {
      whereSql += ' AND s.customer_account_id = ? ';
      params.push(Number(customerId));
    }

    if (paymentMode && paymentMode !== 'All') {
      whereSql += ' AND s.payment_mode = ? ';
      params.push(String(paymentMode));
    }

    if (invoiceType && invoiceType !== 'All') {
      whereSql += ' AND s.invoice_type = ? ';
      params.push(String(invoiceType));
    }

    if (salesman && salesman !== 'All') {
      whereSql += ' AND s.salesman LIKE ? ';
      params.push(`%${String(salesman).trim()}%`);
    }

    if (salesmanId && salesmanId !== 'All') {
      whereSql += ' AND s.salesman_id = ? ';
      params.push(Number(salesmanId));
    }

    if (deliverymanId && deliverymanId !== 'All') {
      whereSql += ' AND s.deliveryman_id = ? ';
      params.push(Number(deliverymanId));
    }

    if (deliveryStatus && deliveryStatus !== 'All') {
      whereSql += ' AND s.delivery_status = ? ';
      params.push(String(deliveryStatus));
    }

    if (startDate) {
      whereSql += ' AND s.invoice_date >= ? ';
      params.push(String(startDate));
    }

    if (endDate) {
      whereSql += ' AND s.invoice_date <= ? ';
      params.push(String(endDate));
    }

    if (q && String(q).trim() !== '') {
      const term = `%${String(q).trim()}%`;
      whereSql += ` AND (
        s.invoice_number LIKE ?
        OR s.customer_name LIKE ?
        OR a.account_code LIKE ?
        OR s.salesman LIKE ?
        OR s.remarks LIKE ?
      ) `;
      params.push(term, term, term, term, term);
    }

    const countRow = db
      .prepare(`
        SELECT COUNT(*) as totalCount,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.gross_total ELSE 0 END), 0) as totalGross,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.discount_amount ELSE 0 END), 0) as totalDiscount,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.tax_amount ELSE 0 END), 0) as totalTax,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.advance_tax_amount ELSE 0 END), 0) as totalAdvanceTax,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.net_total ELSE 0 END), 0) as totalNet,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.paid_amount ELSE 0 END), 0) as totalPaid,
               COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.balance_amount ELSE 0 END), 0) as totalBalance
        FROM sales s
        LEFT JOIN accounts a ON s.customer_account_id = a.id
        ${whereSql}
      `)
      .get(...params) as Record<string, number>;

    const isExportAll = req.query.exportAll === 'true' || req.query.all === 'true';
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = isExportAll
      ? 10000
      : Math.min(500, Math.max(10, parseInt(String(pageSize), 10) || 50));
    const offset = isExportAll ? 0 : (pageNum - 1) * limitNum;

    const rows = db
      .prepare(`
        SELECT
          s.*,
          a.account_code as customer_code,
          a.phone as customer_phone,
          a.city as customer_city,
          a.ntn as customer_ntn,
          payAcc.account_name as payment_account_name,
          (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
        FROM sales s
        LEFT JOIN accounts a ON s.customer_account_id = a.id
        LEFT JOIN accounts payAcc ON s.payment_account_id = payAcc.id
        ${whereSql}
        ORDER BY s.invoice_date DESC, s.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limitNum, offset) as Array<Record<string, unknown>>;

    if (rows.length > 0) {
      const saleIds = rows.map((r) => Number(r.id));
      const placeholders = saleIds.map(() => '?').join(',');
      const allSaleItems = db
        .prepare(`
          SELECT
            si.*,
            COALESCE(NULLIF(TRIM(si.company_name), ''), i.company_name, '') as company_name,
            COALESCE(NULLIF(TRIM(si.item_name), ''), i.item_name, '') as item_name,
            COALESCE(NULLIF(TRIM(si.item_code), ''), i.item_code, '') as item_code
          FROM sale_items si
          LEFT JOIN items i ON si.item_id = i.id
          WHERE si.sale_id IN (${placeholders})
          ORDER BY si.sale_id DESC, si.id ASC
        `)
        .all(...saleIds) as Array<Record<string, unknown>>;

      const itemsBySaleId = new Map<number, Array<Record<string, unknown>>>();
      for (const item of allSaleItems) {
        const sid = Number(item.sale_id);
        if (!itemsBySaleId.has(sid)) {
          itemsBySaleId.set(sid, []);
        }
        itemsBySaleId.get(sid)!.push(item);
      }

      for (const row of rows) {
        row.items = itemsBySaleId.get(Number(row.id)) || [];
      }
    }

    res.json({
      success: true,
      count: rows.length,
      totalCount: Number(countRow?.totalCount || 0),
      page: pageNum,
      pageSize: limitNum,
      summary: {
        totalGross: round2(countRow?.totalGross),
        totalDiscount: round2(countRow?.totalDiscount),
        totalTax: round2(countRow?.totalTax),
        totalAdvanceTax: round2(countRow?.totalAdvanceTax),
        totalNet: round2(countRow?.totalNet),
        totalPaid: round2(countRow?.totalPaid),
        totalBalance: round2(countRow?.totalBalance),
      },
      data: rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/item-history/:itemId
 * Retrieves:
 * 1) Customer-specific previous sale history for this item (only confirmed 'completed' sales to the selected customer)
 *    - Last Sale Rate to this Customer, Last Discount Given, Last Sale Date, Last Sold Qty, Last Invoice Number
 *    - Previous Sale Rate before the last sale (if available)
 * 2) Last Purchase Cost & Purchase History for this item (from confirmed 'completed' purchases)
 */
salesRouter.get('/item-history/:itemId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const itemId = Number(req.params.itemId || 0);
    const customerId = Number(req.query.customerId || 0);

    if (!itemId) {
      return res.status(400).json({ success: false, error: 'Valid itemId is required.' });
    }

    const itemRow = db
      .prepare('SELECT id, item_code, item_name, company_name, packing, purchase_price, trade_price, wholesale_price, retail_price, tax_percent FROM items WHERE id = ?')
      .get(itemId) as Record<string, unknown> | undefined;

    if (!itemRow) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    // 1. Customer-Specific Confirmed Sales History (strictly filtered by customer_account_id and s.status = 'completed')
    let customerSalesHistory: Array<Record<string, unknown>> = [];
    if (customerId > 0) {
      customerSalesHistory = db
        .prepare(`
          SELECT
            si.id as sale_item_id,
            si.sale_id,
            si.item_id,
            si.item_code,
            si.item_name,
            si.packing,
            si.batch_number,
            si.expiry_date,
            si.quantity,
            si.loose_quantity,
            si.total_units,
            si.unit_price,
            si.loose_rate,
            si.discount_percent,
            si.discount_amount,
            si.tax_percent,
            si.tax_amount,
            si.line_total,
            s.invoice_number,
            s.invoice_date,
            s.invoice_type,
            s.payment_mode,
            s.customer_account_id,
            s.customer_name,
            s.salesman
          FROM sale_items si
          INNER JOIN sales s ON s.id = si.sale_id
          WHERE si.item_id = ?
            AND s.customer_account_id = ?
            AND s.status = 'completed'
          ORDER BY s.invoice_date DESC, s.id DESC, si.id DESC
          LIMIT 25
        `)
        .all(itemId, customerId) as Array<Record<string, unknown>>;
    }

    const lastCustomerSale = customerSalesHistory.length > 0 ? customerSalesHistory[0] : null;
    const previousCustomerSaleBeforeLast = customerSalesHistory.length > 1 ? customerSalesHistory[1] : null;

    // 2. Confirmed Purchase History for this Item (strictly s.status = 'completed')
    const purchaseHistory = db
      .prepare(`
        SELECT
          pi.id as purchase_item_id,
          pi.purchase_id,
          pi.item_id,
          pi.batch_number,
          pi.manufacturing_date,
          pi.expiry_date,
          pi.packing,
          pi.quantity,
          pi.bonus_quantity,
          pi.purchase_price,
          pi.trade_price,
          pi.wholesale_price,
          pi.retail_price,
          pi.discount_percent,
          pi.discount_amount,
          pi.tax_percent,
          pi.tax_amount,
          pi.line_total,
          CASE
            WHEN (pi.quantity + pi.bonus_quantity) > 0
            THEN ROUND(pi.line_total / (pi.quantity + pi.bonus_quantity), 2)
            ELSE pi.purchase_price
          END as effective_cost_per_pack,
          p.bill_number,
          p.supplier_invoice_no,
          p.bill_date,
          p.supplier_account_id,
          p.supplier_name
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id
        WHERE pi.item_id = ?
          AND p.status = 'completed'
        ORDER BY p.bill_date DESC, p.id DESC, pi.id DESC
        LIMIT 25
      `)
      .all(itemId) as Array<Record<string, unknown>>;

    const lastPurchase = purchaseHistory.length > 0 ? purchaseHistory[0] : null;

    return res.json({
      success: true,
      item: itemRow,
      customerId: customerId || null,
      hasCustomerHistory: customerSalesHistory.length > 0,
      lastCustomerSale,
      previousCustomerSaleBeforeLast,
      customerSalesHistory,
      lastPurchase,
      purchaseHistory,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/:id
 * Fetch single Sales Invoice with 14-column line items & double-entry journal lines
 */
salesRouter.get('/:id', (req: Request, res: Response, next) => {
  const rawId = req.params.id;
  if (['next-numbers', 'fast-search', 'item-history', 'returns', 'payments', 'ledgers', 'reports'].includes(rawId)) {
    return next();
  }
  try {
    const db = getDatabase();
    const saleId = Number(rawId);
    const invoice = db
      .prepare(`
        SELECT
          s.*,
          a.account_code as customer_code,
          a.phone as customer_phone,
          a.address as customer_address,
          a.city as customer_city,
          a.ntn as customer_ntn,
          a.strn as customer_strn,
          payAcc.account_name as payment_account_name,
          payAcc.account_code as payment_account_code
        FROM sales s
        LEFT JOIN accounts a ON s.customer_account_id = a.id
        LEFT JOIN accounts payAcc ON s.payment_account_id = payAcc.id
        WHERE s.id = ?
      `)
      .get(saleId) as Record<string, unknown> | undefined;

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Sales invoice not found.' });
    }

    const items = db
      .prepare(`
        SELECT
          si.*,
          COALESCE(NULLIF(TRIM(si.company_name), ''), i.company_name, '') as company_name,
          (si.total_units - si.returned_total_units) as eligible_return_units
        FROM sale_items si
        LEFT JOIN items i ON si.item_id = i.id
        WHERE si.sale_id = ?
        ORDER BY si.id ASC
      `)
      .all(saleId);

    const journalIds = [
      Number(invoice.journal_entry_id || 0),
      Number(invoice.payment_journal_entry_id || 0),
    ].filter((id) => id > 0);

    let journalLines: Array<Record<string, unknown>> = [];
    if (journalIds.length > 0) {
      const placeholders = journalIds.map(() => '?').join(',');
      journalLines = db
        .prepare(`
          SELECT
            jel.*,
            je.entry_number,
            je.entry_date,
            je.reference_type as source_type,
            acc.account_code,
            acc.account_name,
            acc.account_group
          FROM journal_entry_lines jel
          JOIN journal_entries je ON jel.journal_entry_id = je.id
          JOIN accounts acc ON jel.account_id = acc.id
          WHERE jel.journal_entry_id IN (${placeholders})
          ORDER BY jel.id ASC
        `)
        .all(...journalIds) as Array<Record<string, unknown>>;
    }

    res.json({
      success: true,
      data: {
        ...invoice,
        items,
        journalLines,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * Shared transactional processor for creating or updating a Sales Invoice
 */
export function processSaleUpsert(saleId: number | null, body: Record<string, unknown>) {
  const db = getDatabase();

  const tx = db.transaction(() => {
    if (saleId) {
      revertCompletedSaleEffects(saleId);
    }

    const rawSaleStatus = String(body.status || 'completed').trim().toLowerCase();
    const status = rawSaleStatus === 'confirmed' ? 'completed' : rawSaleStatus;
    if (!['draft', 'held', 'completed'].includes(status)) {
      throw new Error('Invalid invoice status. Must be draft, held, or completed.');
    }

    const invoiceDate = String(body.invoice_date || new Date().toISOString().slice(0, 10)).trim();

    // Enforce server-side automatic numbering on create and strict immutability on edit
    let invoiceNumber: string;
    if (saleId) {
      const existingSaleRow = db
        .prepare('SELECT invoice_number FROM sales WHERE id = ?')
        .get(saleId) as { invoice_number: string } | undefined;
      if (!existingSaleRow) {
        throw new Error(`Sales invoice #${saleId} not found.`);
      }
      invoiceNumber = String(existingSaleRow.invoice_number);
    } else {
      invoiceNumber = allocateNextInvoiceNumber('SALE', invoiceDate);
    }

    const invoiceType = String(body.invoice_type || 'Retail') === 'Wholesale' ? 'Wholesale' : 'Retail';
    const paymentMode = ['Cash', 'Credit', 'Partial', 'Bank'].includes(String(body.payment_mode))
      ? String(body.payment_mode)
      : 'Cash';

    // Resolve Salesman (by salesman_id or salesman name)
    let salesmanId: number | null = body.salesman_id ? Number(body.salesman_id) : null;
    let salesman = String(body.salesman || '').trim();
    if (salesmanId) {
      const smRow = db
        .prepare("SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) as name FROM salesmen WHERE id = ?")
        .get(salesmanId) as { id: number; name: string } | undefined;
      if (smRow) {
        salesman = smRow.name;
      } else {
        salesmanId = null;
      }
    } else if (salesman) {
      const smByName = db
        .prepare("SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) as name FROM salesmen WHERE LOWER(name) = LOWER(?) OR LOWER(full_name) = LOWER(?) LIMIT 1")
        .get(salesman, salesman) as { id: number; name: string } | undefined;
      if (smByName) {
        salesmanId = smByName.id;
        salesman = smByName.name;
      }
    }
    if (!salesman) {
      salesman = 'Counter Pharmacist';
    }

    // Resolve Deliveryman & Delivery Tracking (completely independent of Salesman)
    let deliverymanId: number | null = body.deliveryman_id ? Number(body.deliveryman_id) : null;
    let deliverymanName: string | null = body.deliveryman_name ? String(body.deliveryman_name).trim() : null;
    if (deliverymanId) {
      const dmRow = db
        .prepare('SELECT id, name FROM deliverymen WHERE id = ?')
        .get(deliverymanId) as { id: number; name: string } | undefined;
      if (dmRow) {
        deliverymanName = dmRow.name;
      } else {
        deliverymanId = null;
      }
    } else if (deliverymanName) {
      const dmByName = db
        .prepare('SELECT id, name FROM deliverymen WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(deliverymanName) as { id: number; name: string } | undefined;
      if (dmByName) {
        deliverymanId = dmByName.id;
        deliverymanName = dmByName.name;
      }
    }

    const validDeliveryStatuses = ['Pending', 'Assigned', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];
    const deliveryStatus = validDeliveryStatuses.includes(String(body.delivery_status))
      ? String(body.delivery_status)
      : deliverymanId
      ? 'Assigned'
      : 'Pending';
    const deliveryDate = body.delivery_date ? String(body.delivery_date).trim() : null;
    const deliveryTime = body.delivery_time ? String(body.delivery_time).trim() : null;
    const deliveryNotes = body.delivery_notes ? String(body.delivery_notes).trim() : null;
    const deliveryCharges = round2(Math.max(0, Number(body.delivery_charges || 0)));
    const deliveryCompletedBy =
      deliveryStatus === 'Delivered'
        ? String(body.delivery_completed_by || body.updated_by || 'Counter Staff')
        : null;
    const deliveryCompletedAt =
      deliveryStatus === 'Delivered' ? new Date().toISOString() : null;

    const companySettingsRow = db
      .prepare('SELECT allow_negative_stock, batch_wise_sales FROM company_settings ORDER BY id ASC LIMIT 1')
      .get() as { allow_negative_stock?: number; batch_wise_sales?: number } | undefined;
    const defaultAllowNeg =
      companySettingsRow && companySettingsRow.allow_negative_stock !== undefined
        ? Number(companySettingsRow.allow_negative_stock) === 1
        : true;
    const allowNegativeStock =
      body.allow_negative_stock !== undefined
        ? body.allow_negative_stock === true ||
          body.allow_negative_stock === 1 ||
          body.allow_negative_stock === '1' ||
          body.allow_negative_stock === 'true'
          ? 1
          : 0
        : defaultAllowNeg
        ? 1
        : 0;

    const defaultBatchWiseSales =
      companySettingsRow && companySettingsRow.batch_wise_sales !== undefined
        ? Number(companySettingsRow.batch_wise_sales) !== 0
        : true;
    const batchWiseSales =
      body.batch_wise_sales !== undefined
        ? !(
            body.batch_wise_sales === false ||
            body.batch_wise_sales === 0 ||
            body.batch_wise_sales === '0' ||
            body.batch_wise_sales === 'false'
          )
        : defaultBatchWiseSales;

    // Resolve customer account
    let customerAccountId = Number(body.customer_account_id || 0);
    if (!customerAccountId) {
      customerAccountId = getSystemAccountId('CUS-1001');
    }

    const customer = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(customerAccountId) as Record<string, unknown> | undefined;

    if (!customer) {
      throw new Error('Selected Customer Account does not exist.');
    }

    const customerName = String(body.customer_name || customer.account_name || 'Walk-in Cash Customer').trim();
    const customerFilerStatus = ['Filer', 'Non-Filer', 'Exempt'].includes(String(body.customer_filer_status))
      ? String(body.customer_filer_status)
      : String(customer.filer_status || 'Non-Filer');

    const rawItems = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.lines)
      ? body.lines
      : [];
    if (status === 'completed' && rawItems.length === 0) {
      throw new Error('At least one medicine item is required to complete a Sales Invoice.');
    }

    let grossTotal = 0;
    let itemDiscountTotal = 0;
    let totalGst = 0;

    interface ProcessedSaleLine {
      itemId: number;
      inventoryId: number | null;
      itemCode: string;
      companyName: string;
      itemName: string;
      packing: string;
      unitsPerPack: number;
      stripsPerBox: number;
      batchNumber: string;
      expiryDate: string;
      availablePacks: number;
      availableUnits: number;
      quantity: number;
      bonusQuantity: number;
      unitPrice: number;
      discountPercent: number;
      discountAmount: number;
      looseQuantity: number;
      looseRate: number;
      totalUnits: number;
      costPricePerUnit: number;
      grossAmount: number;
      taxableAmount: number;
      taxPercent: number;
      taxAmount: number;
      lineTotal: number;
      offerId: number | null;
      offerName: string;
      offerDiscountPercent: number;
      offerDiscountAmount: number;
      partyDiscountId: number | null;
      partyDiscountPercent: number;
      partyDiscountAmount: number;
      manualOverrideReason: string;
      fifoBatchesJson: string;
    }

    const processedLines: ProcessedSaleLine[] = [];

    for (let idx = 0; idx < rawItems.length; idx++) {
      const line = rawItems[idx] as Record<string, unknown>;
      const itemId = Number(line.item_id || 0);
      if (!itemId) continue;

      const itemRow = db
        .prepare('SELECT * FROM items WHERE id = ?')
        .get(itemId) as Record<string, unknown> | undefined;

      if (!itemRow) {
        throw new Error(`Row #${idx + 1}: Item ID ${itemId} does not exist in Items Master.`);
      }

      const parsed = parsePacking(String(line.packing || itemRow.packing || '1x1'));
      const quantity = round2(Math.max(0, Number(line.quantity ?? line.packs_quantity ?? 0)));
      const looseQuantity = round2(Math.max(0, Number(line.loose_quantity || 0)));

      const defaultBoxPrice =
        invoiceType === 'Wholesale'
          ? round2(Number(itemRow.wholesale_price || itemRow.trade_price || itemRow.retail_price))
          : round2(Number(itemRow.retail_price));

      const rawPriceVal =
        line.unit_price !== undefined && line.unit_price !== '' ? line.unit_price : line.unit_rate;
      const unitPrice =
        rawPriceVal !== undefined && rawPriceVal !== ''
          ? round2(Math.max(0, Number(rawPriceVal)))
          : defaultBoxPrice;

      // Evaluate Trade Deals & Party Discounts automatically
      const evalOffer = evaluateLineOfferAndPartyDiscount({
        itemId,
        quantity,
        tradePrice: unitPrice,
        partyAccountId: customerAccountId,
        townId: customer.town_id ? Number(customer.town_id) : null,
        townName: String(customer.town_name || customer.city || ''),
        salesmanId,
        invoiceDate,
        manualDiscountPercent:
          line.manual_override_reason && line.discount_percent !== undefined
            ? Number(line.discount_percent)
            : null,
        manualBonusQuantity:
          line.bonus_quantity !== undefined && line.bonus_quantity !== ''
            ? Number(line.bonus_quantity)
            : null,
        manualOverrideReason: line.manual_override_reason ? String(line.manual_override_reason) : undefined,
        preferredInventoryId: line.inventory_id ? Number(line.inventory_id) : null,
      });

      const bonusQuantity =
        line.bonus_quantity !== undefined && line.bonus_quantity !== ''
          ? round2(Math.max(0, Number(line.bonus_quantity)))
          : evalOffer.bonus_quantity;

      const totalUnits = round2((quantity + bonusQuantity) * parsed.unitsPerPack + looseQuantity);

      if (status === 'completed' && totalUnits <= 0) {
        throw new Error(`Row #${idx + 1} (${itemRow.item_name}): Quantity, Bonus Quantity, or Loose Quantity must be greater than 0.`);
      }

      const defaultItemLooseRate = round2(unitPrice / parsed.unitsPerPack);
      const looseRate =
        line.loose_rate !== undefined && line.loose_rate !== '' && Number(line.loose_rate) > 0
          ? round2(Math.max(0, Number(line.loose_rate)))
          : defaultItemLooseRate;

      const grossAmount = round2(quantity * unitPrice + looseQuantity * looseRate);

      let discountPercent =
        line.discount_percent !== undefined && line.discount_percent !== '' && Number(line.discount_percent) > 0
          ? round2(Math.max(0, Math.min(100, Number(line.discount_percent))))
          : evalOffer.effective_discount_percent;
      let discountAmount = round2((grossAmount * discountPercent) / 100);
      if (
        line.discount_amount !== undefined &&
        Number(line.discount_amount) >= 0 &&
        discountPercent === 0 &&
        Number(line.discount_amount) > 0
      ) {
        discountAmount = round2(Math.min(grossAmount, Number(line.discount_amount)));
        discountPercent = grossAmount > 0 ? round2((discountAmount / grossAmount) * 100) : 0;
      }

      const taxableAmount = round2(Math.max(0, grossAmount - discountAmount));
      const taxPercent = round2(Math.max(0, Number(line.tax_percent ?? itemRow.tax_percent ?? 0)));
      const taxAmount = round2((taxableAmount * taxPercent) / 100);
      const lineTotal = round2(taxableAmount + taxAmount);

      // Resolve batch in inventory with strict FIFO & Expiry / Block validation
      const todayIso = new Date().toISOString().slice(0, 10);
      let batchRow: Record<string, unknown> | undefined;
      if (batchWiseSales) {
        if (line.inventory_id) {
          batchRow = db
            .prepare('SELECT * FROM inventory WHERE id = ? AND item_id = ?')
            .get(Number(line.inventory_id), itemId) as Record<string, unknown> | undefined;
        }
        if (!batchRow && line.batch_number) {
          batchRow = db
            .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
            .get(itemId, String(line.batch_number).trim()) as Record<string, unknown> | undefined;
        }
        // If explicitly selected batch is blocked or expired, reject or fallback if auto
        if (batchRow && (line.inventory_id || line.batch_number)) {
          if (Number(batchRow.is_blocked || 0) === 1) {
            throw new Error(
              `Row #${idx + 1} (${itemRow.item_name}): Batch "${batchRow.batch_number}" is Blocked (${batchRow.blocked_reason || 'Hold'}) and cannot be sold.`
            );
          }
          const expStr = String(batchRow.expiry_date || '').slice(0, 10);
          if (expStr && /^\d{4}-\d{2}-\d{2}$/.test(expStr) && expStr < todayIso) {
            throw new Error(
              `Row #${idx + 1} (${itemRow.item_name}): Batch "${batchRow.batch_number}" is Expired (${expStr}) and cannot be sold.`
            );
          }
        }
      }
      if (!batchRow) {
        // Strict FIFO order: oldest purchase_date first, then earliest non-expired expiry_date, then id ASC
        batchRow = db
          .prepare(`
            SELECT * FROM inventory
            WHERE item_id = ?
              AND COALESCE(is_blocked, 0) = 0
              AND (expiry_date IS NULL OR expiry_date = '' OR DATE(expiry_date) >= DATE(?))
            ORDER BY
              CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END,
              COALESCE(NULLIF(purchase_date, ''), DATE(created_at)) ASC,
              CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN '9999-12-31' ELSE expiry_date END ASC,
              id ASC
            LIMIT 1
          `)
          .get(itemId, todayIso) as Record<string, unknown> | undefined;
      }

      // Compute total eligible FIFO stock across all non-blocked, non-expired batches of this item
      const itemTotalEligibleRow = db
        .prepare(`
          SELECT
            COALESCE(SUM(total_stock_units), 0) AS total_units,
            COALESCE(SUM(current_pack_qty), 0) AS total_packs
          FROM inventory
          WHERE item_id = ?
            AND COALESCE(is_blocked, 0) = 0
            AND (expiry_date IS NULL OR expiry_date = '' OR DATE(expiry_date) >= DATE(?))
        `)
        .get(itemId, todayIso) as { total_units: number; total_packs: number } | undefined;

      const availableUnits = round2(Number(itemTotalEligibleRow?.total_units || 0));
      const availablePacks = round2(Number(itemTotalEligibleRow?.total_packs || 0));
      const batchNumber = String(
        batchRow?.batch_number || (batchWiseSales && line.batch_number) || `BATCH-${String(itemRow.item_code)}-01`
      ).trim();
      const expiryDate = String(
        batchRow?.expiry_date || (batchWiseSales && line.expiry_date) || '2028-12-31'
      ).trim();

      if (status === 'completed' && !allowNegativeStock && totalUnits > availableUnits) {
        throw new Error(
          `Insufficient eligible FIFO stock for "${itemRow.item_name}". Available Eligible: ${availablePacks} Packs (${availableUnits} Units), Requested: ${quantity} Sale + ${bonusQuantity} Bonus (${totalUnits} Units).`
        );
      }

      const purchasePricePerPack = round2(
        Number(batchRow?.pack_cost || itemRow.purchase_price || 0)
      );
      const costPricePerUnit = round2(purchasePricePerPack / parsed.unitsPerPack);

      grossTotal = round2(grossTotal + grossAmount);
      itemDiscountTotal = round2(itemDiscountTotal + discountAmount);
      totalGst = round2(totalGst + taxAmount);

      processedLines.push({
        itemId,
        inventoryId: batchRow ? Number(batchRow.id) : null,
        itemCode: String(itemRow.item_code),
        companyName: String(itemRow.company_name || ''),
        itemName: String(itemRow.item_name),
        packing: parsed.packing,
        unitsPerPack: parsed.unitsPerPack,
        stripsPerBox: parsed.stripsPerBox,
        batchNumber,
        expiryDate,
        availablePacks,
        availableUnits,
        quantity,
        bonusQuantity,
        unitPrice,
        discountPercent,
        discountAmount,
        looseQuantity,
        looseRate,
        totalUnits,
        costPricePerUnit,
        grossAmount,
        taxableAmount,
        taxPercent,
        taxAmount,
        lineTotal,
        offerId: line.offer_id !== undefined ? (line.offer_id ? Number(line.offer_id) : null) : evalOffer.offer_id,
        offerName: line.offer_name !== undefined ? String(line.offer_name || '') : evalOffer.offer_name,
        offerDiscountPercent:
          line.offer_discount_percent !== undefined
            ? Number(line.offer_discount_percent)
            : evalOffer.offer_discount_percent,
        offerDiscountAmount:
          line.offer_discount_amount !== undefined
            ? Number(line.offer_discount_amount)
            : evalOffer.offer_discount_amount,
        partyDiscountId:
          line.party_discount_id !== undefined
            ? line.party_discount_id
              ? Number(line.party_discount_id)
              : null
            : evalOffer.party_discount_id,
        partyDiscountPercent:
          line.party_discount_percent !== undefined
            ? Number(line.party_discount_percent)
            : evalOffer.party_discount_percent,
        partyDiscountAmount:
          line.party_discount_amount !== undefined
            ? Number(line.party_discount_amount)
            : evalOffer.party_discount_amount,
        manualOverrideReason: String(line.manual_override_reason || ''),
        fifoBatchesJson: JSON.stringify(evalOffer.fifo_allocation.allocations || []),
      });
    }

    // Invoice-level discount
    const subtotalAfterItemDisc = round2(Math.max(0, grossTotal - itemDiscountTotal));
    let invoiceDiscountPercent = round2(Math.max(0, Math.min(100, Number(body.invoice_discount_percent || 0))));
    let invoiceDiscountAmount = round2(Math.max(0, Number(body.invoice_discount_amount || 0)));

    if (invoiceDiscountPercent > 0 && invoiceDiscountAmount === 0) {
      invoiceDiscountAmount = round2((subtotalAfterItemDisc * invoiceDiscountPercent) / 100);
    } else if (invoiceDiscountAmount > 0 && invoiceDiscountPercent === 0 && subtotalAfterItemDisc > 0) {
      invoiceDiscountAmount = round2(Math.min(subtotalAfterItemDisc, invoiceDiscountAmount));
      invoiceDiscountPercent = round2((invoiceDiscountAmount / subtotalAfterItemDisc) * 100);
    }

    const totalDiscountAmount = round2(itemDiscountTotal + invoiceDiscountAmount);
    const taxableAmount = round2(Math.max(0, grossTotal - totalDiscountAmount));

    // Advance Tax calculation (only when advance_tax_applicable is enabled or overridden)
    const taxSettings = db
      .prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;

    const advanceTaxApplicable = body.advance_tax_applicable ? 1 : 0;
    const isTaxOverridden = body.is_tax_overridden ? 1 : 0;
    const taxOverrideReason = body.tax_override_reason ? String(body.tax_override_reason).trim() : null;
    const taxOverrideAuthorizedBy = body.tax_override_authorized_by
      ? String(body.tax_override_authorized_by).trim()
      : null;

    let configuredRate = 0;
    if (customerFilerStatus === 'Filer') {
      configuredRate = round2(taxSettings?.filer_rate ?? 0.5);
    } else if (customerFilerStatus === 'Non-Filer') {
      configuredRate = round2(taxSettings?.non_filer_rate ?? 2.5);
    } else {
      configuredRate = round2(taxSettings?.exempt_rate ?? 0);
    }

    let advanceTaxRate = 0;
    if (advanceTaxApplicable) {
      if (isTaxOverridden && body.advance_tax_rate !== undefined) {
        advanceTaxRate = round2(Math.max(0, Number(body.advance_tax_rate)));
      } else {
        advanceTaxRate = configuredRate;
      }
    }

    const taxBasis = String(taxSettings?.calculation_basis || 'taxable_plus_gst');
    let baseForAdvanceTax = round2(taxableAmount + totalGst);
    if (taxBasis === 'taxable_amount') baseForAdvanceTax = taxableAmount;
    else if (taxBasis === 'gross_amount') baseForAdvanceTax = grossTotal;

    const advanceTaxAmount = advanceTaxApplicable
      ? round2((baseForAdvanceTax * advanceTaxRate) / 100)
      : 0;

    const totalTaxAmount = round2(totalGst + advanceTaxAmount);
    const netTotal = round2(taxableAmount + totalTaxAmount);

    // Customer previous balance before this invoice
    recalculateAccountBalance(customerAccountId);
    const freshCustomer = db
      .prepare('SELECT current_balance, current_balance_type FROM accounts WHERE id = ?')
      .get(customerAccountId) as { current_balance: number; current_balance_type: 'Debit' | 'Credit' };

    const previousCustomerBalance = round2(freshCustomer?.current_balance || 0);
    const previousBalanceType = freshCustomer?.current_balance_type || 'Debit';
    const signedPrevReceivable =
      previousBalanceType === 'Debit' ? previousCustomerBalance : -previousCustomerBalance;

    const totalReceivable = round2(signedPrevReceivable + netTotal);

    let paidAmount = round2(Math.max(0, Number(body.paid_amount || 0)));
    if ((paymentMode === 'Cash' || paymentMode === 'Bank') && (body.paid_amount === undefined || body.paid_amount === null || body.paid_amount === '')) {
      paidAmount = netTotal;
    }

    const balanceAmount = round2(totalReceivable - paidAmount);

    let paymentAccountId: number | null = body.payment_account_id ? Number(body.payment_account_id) : null;
    if (paidAmount > 0 && !paymentAccountId) {
      paymentAccountId =
        paymentMode === 'Bank' ? getSystemAccountId('FIN-1021') : getSystemAccountId('FIN-1010');
    }

    let finalSaleId = saleId;

    if (saleId) {
      db.prepare(`
        UPDATE sales
        SET invoice_number = ?,
            invoice_date = ?,
            customer_account_id = ?,
            customer_name = ?,
            customer_filer_status = ?,
            salesman_id = ?,
            salesman = ?,
            deliveryman_id = ?,
            deliveryman_name = ?,
            delivery_status = ?,
            delivery_date = ?,
            delivery_time = ?,
            delivery_notes = ?,
            delivery_charges = ?,
            delivery_completed_by = ?,
            delivery_completed_at = ?,
            invoice_type = ?,
            payment_mode = ?,
            payment_account_id = ?,
            gross_total = ?,
            item_discount_amount = ?,
            invoice_discount_percent = ?,
            invoice_discount_amount = ?,
            discount_override_by = ?,
            discount_override_reason = ?,
            discount_amount = ?,
            taxable_amount = ?,
            gst_amount = ?,
            advance_tax_applicable = ?,
            advance_tax_rate = ?,
            advance_tax_amount = ?,
            is_tax_overridden = ?,
            tax_override_reason = ?,
            tax_override_authorized_by = ?,
            tax_amount = ?,
            net_total = ?,
            previous_customer_balance = ?,
            previous_balance_type = ?,
            total_receivable = ?,
            paid_amount = ?,
            balance_amount = ?,
            allow_negative_stock = ?,
            journal_entry_id = NULL,
            payment_journal_entry_id = NULL,
            status = ?,
            remarks = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        invoiceNumber,
        invoiceDate,
        customerAccountId,
        customerName,
        customerFilerStatus,
        salesmanId,
        salesman,
        deliverymanId,
        deliverymanName,
        deliveryStatus,
        deliveryDate,
        deliveryTime,
        deliveryNotes,
        deliveryCharges,
        deliveryCompletedBy,
        deliveryCompletedAt,
        invoiceType,
        paymentMode,
        paymentAccountId,
        grossTotal,
        itemDiscountTotal,
        invoiceDiscountPercent,
        invoiceDiscountAmount,
        body.discount_override_by ? String(body.discount_override_by) : null,
        body.discount_override_reason ? String(body.discount_override_reason) : null,
        totalDiscountAmount,
        taxableAmount,
        totalGst,
        advanceTaxApplicable,
        advanceTaxRate,
        advanceTaxAmount,
        isTaxOverridden,
        taxOverrideReason,
        taxOverrideAuthorizedBy,
        totalTaxAmount,
        netTotal,
        previousCustomerBalance,
        previousBalanceType,
        totalReceivable,
        paidAmount,
        balanceAmount,
        allowNegativeStock,
        status,
        body.remarks ? String(body.remarks) : '',
        saleId
      );

      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    } else {
      const insertSale = db.prepare(`
        INSERT INTO sales (
          invoice_number, invoice_date, customer_account_id, customer_name,
          customer_filer_status, salesman_id, salesman,
          deliveryman_id, deliveryman_name, delivery_status, delivery_date, delivery_time,
          delivery_notes, delivery_charges, delivery_completed_by, delivery_completed_at,
          invoice_type, payment_mode, payment_account_id,
          gross_total, item_discount_amount, invoice_discount_percent, invoice_discount_amount,
          discount_override_by, discount_override_reason, discount_amount, taxable_amount,
          gst_amount, advance_tax_applicable, advance_tax_rate, advance_tax_amount,
          is_tax_overridden, tax_override_reason, tax_override_authorized_by,
          tax_amount, net_total, previous_customer_balance, previous_balance_type,
          total_receivable, paid_amount, balance_amount, allow_negative_stock,
          status, remarks
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        )
      `);

      const resInsert = insertSale.run(
        invoiceNumber,
        invoiceDate,
        customerAccountId,
        customerName,
        customerFilerStatus,
        salesmanId,
        salesman,
        deliverymanId,
        deliverymanName,
        deliveryStatus,
        deliveryDate,
        deliveryTime,
        deliveryNotes,
        deliveryCharges,
        deliveryCompletedBy,
        deliveryCompletedAt,
        invoiceType,
        paymentMode,
        paymentAccountId,
        grossTotal,
        itemDiscountTotal,
        invoiceDiscountPercent,
        invoiceDiscountAmount,
        body.discount_override_by ? String(body.discount_override_by) : null,
        body.discount_override_reason ? String(body.discount_override_reason) : null,
        totalDiscountAmount,
        taxableAmount,
        totalGst,
        advanceTaxApplicable,
        advanceTaxRate,
        advanceTaxAmount,
        isTaxOverridden,
        taxOverrideReason,
        taxOverrideAuthorizedBy,
        totalTaxAmount,
        netTotal,
        previousCustomerBalance,
        previousBalanceType,
        totalReceivable,
        paidAmount,
        balanceAmount,
        allowNegativeStock,
        status,
        body.remarks ? String(body.remarks) : ''
      );
      finalSaleId = Number(resInsert.lastInsertRowid);
      bindInvoiceNumberRecordId(invoiceNumber, 'SALE', finalSaleId);
    }

    const insertLineStmt = db.prepare(`
      INSERT INTO sale_items (
        sale_id, item_id, inventory_id, item_code, company_name, item_name,
        packing, units_per_pack, batch_number, expiry_date,
        available_stock_packs, available_stock_units,
        quantity, bonus_quantity, unit_price, discount_percent, discount_amount,
        loose_quantity, loose_rate, total_units, cost_price_per_unit,
        gross_amount, taxable_amount, tax_percent, tax_amount, line_total,
        offer_id, offer_name, offer_discount_percent, offer_discount_amount,
        party_discount_id, party_discount_percent, party_discount_amount,
        manual_override_reason, fifo_batches_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const todayIso = new Date().toISOString().slice(0, 10);

    for (const pLine of processedLines) {
      let invId = pLine.inventoryId;
      let recordedBatchString = pLine.batchNumber;
      let recordedExpiryString = pLine.expiryDate;
      const fifoDedicatedSlices: Array<Record<string, unknown>> = [];

      if (status === 'completed') {
        // Fetch all FIFO-eligible batches for this item (putting preferred invId first if eligible)
        const allEligibleBatches = db
          .prepare(`
            SELECT * FROM inventory
            WHERE item_id = ?
              AND COALESCE(is_blocked, 0) = 0
              AND (expiry_date IS NULL OR expiry_date = '' OR DATE(expiry_date) >= DATE(?))
            ORDER BY
              CASE WHEN id = ? THEN 0 ELSE 1 END,
              CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END,
              COALESCE(NULLIF(purchase_date, ''), DATE(created_at)) ASC,
              CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN '9999-12-31' ELSE expiry_date END ASC,
              id ASC
          `)
          .all(pLine.itemId, todayIso, invId || -1) as Array<Record<string, unknown>>;

        if (allEligibleBatches.length > 0) {
          const itemMinRow = db
            .prepare('SELECT minimum_stock FROM items WHERE id = ?')
            .get(pLine.itemId) as { minimum_stock: number } | undefined;
          const minStock = Number(itemMinRow?.minimum_stock || 0);

          let remainingUnitsToDeduct = pLine.totalUnits;
          invId = Number(allEligibleBatches[0].id);
          const usedBatchNames: string[] = [];
          const usedExpiries: string[] = [];

          for (let bIdx = 0; bIdx < allEligibleBatches.length; bIdx++) {
            if (remainingUnitsToDeduct <= 0) break;
            const bRow = allEligibleBatches[bIdx];
            const bId = Number(bRow.id);
            const bCurrentUnits = round2(Number(bRow.total_stock_units || 0));
            const isLastBatch = bIdx === allEligibleBatches.length - 1;

            let unitsFromThisBatch = 0;
            if (bCurrentUnits >= remainingUnitsToDeduct) {
              unitsFromThisBatch = remainingUnitsToDeduct;
            } else if (bCurrentUnits > 0 && !isLastBatch) {
              unitsFromThisBatch = bCurrentUnits;
            } else if (isLastBatch && allowNegativeStock) {
              unitsFromThisBatch = remainingUnitsToDeduct;
            }

            if (unitsFromThisBatch > 0) {
              remainingUnitsToDeduct = round2(remainingUnitsToDeduct - unitsFromThisBatch);
              const packSoldEq = round2(unitsFromThisBatch / pLine.unitsPerPack);
              const newSoldQty = round2(Number(bRow.sold_qty || 0) + packSoldEq);
              const newDispatchedQty = round2(Number(bRow.dispatched_pack_qty || 0) + packSoldEq);
              const newTotalUnits = round2(bCurrentUnits - unitsFromThisBatch);
              const newPackQty = round2(newTotalUnits / pLine.unitsPerPack);
              const newStripQty = round2(newPackQty * pLine.stripsPerBox);
              const newLooseQty = round2(newTotalUnits % pLine.unitsPerPack);
              const batchStatus = computeBatchStatus(
                newPackQty,
                String(bRow.expiry_date || pLine.expiryDate),
                minStock
              );

              db.prepare(`
                UPDATE inventory
                SET sold_qty = ?,
                    dispatched_pack_qty = ?,
                    current_pack_qty = ?,
                    current_strip_qty = ?,
                    current_loose_qty = ?,
                    total_stock_units = ?,
                    status = ?,
                    batch_status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(
                newSoldQty,
                newDispatchedQty,
                newPackQty,
                newStripQty,
                newLooseQty,
                newTotalUnits,
                batchStatus,
                newPackQty <= 0 ? 'Out of Stock' : 'Active',
                bId
              );

              const bNo = String(bRow.batch_number || pLine.batchNumber);
              const bExp = String(bRow.expiry_date || pLine.expiryDate);
              usedBatchNames.push(bNo);
              if (bExp) usedExpiries.push(bExp);

              fifoDedicatedSlices.push({
                inventory_id: bId,
                batch_number: bNo,
                expiry_date: bExp,
                allocated_packs: packSoldEq,
                allocated_units: unitsFromThisBatch,
                remaining_after_packs: newPackQty,
              });

              recordBatchStockMovement({
                movementDate: invoiceDate,
                itemId: pLine.itemId,
                itemCode: pLine.itemCode,
                itemName: pLine.itemName,
                companyName: pLine.companyName,
                inventoryId: bId,
                batchNumber: bNo,
                expiryDate: bExp,
                purchaseDate: String(bRow.purchase_date || ''),
                movementType: 'COUNTER_SALE_OUT',
                referenceType: 'SALE_INVOICE',
                referenceId: finalSaleId,
                referenceNumber: invoiceNumber,
                partyAccountId: customerAccountId,
                partyName: customerName,
                salesmanId,
                salesmanName: salesman,
                townName: String(customer.town_name || customer.city || ''),
                quantityPacks: packSoldEq,
                bonusPacks: usedBatchNames.length === 1 ? pLine.bonusQuantity : 0,
                totalUnits: unitsFromThisBatch,
                purchaseRate: Number(bRow.pack_cost || bRow.cost_price || 0),
                tradePrice: pLine.unitPrice,
                balanceAfterPacks: newPackQty,
                remarks: `Sales Invoice ${invoiceNumber}`,
                performedBy: String(body.created_by || 'Super Admin'),
              });
            }
          }

          if (usedBatchNames.length > 0) {
            recordedBatchString = usedBatchNames.join(', ');
          }
          if (usedExpiries.length > 0) {
            recordedExpiryString = usedExpiries[0];
          }
        } else if (allowNegativeStock) {
          // Create negative batch record if administrator authorized negative stock and no batch existed
          const packSoldEquivalent = round2(pLine.totalUnits / pLine.unitsPerPack);
          const negTotalUnits = round2(-pLine.totalUnits);
          const negPackQty = round2(negTotalUnits / pLine.unitsPerPack);
          const negStripQty = round2(negPackQty * pLine.stripsPerBox);
          const negLooseQty = round2(negTotalUnits % pLine.unitsPerPack);

          const newInv = db.prepare(`
            INSERT INTO inventory (
              item_id, batch_number, manufacturing_date, expiry_date,
              packing, strips_per_box, units_per_strip, units_per_pack,
              cost_price, trade_price, wholesale_price, retail_price,
              pack_cost, pack_retail, purchased_qty, bonus_qty, returned_qty, sold_qty,
              current_pack_qty, current_strip_qty, current_loose_qty, total_stock_units,
              status
            ) VALUES (?, ?, '2025-06-01', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 'out_of_stock')
          `).run(
            pLine.itemId,
            pLine.batchNumber,
            pLine.expiryDate,
            pLine.packing,
            pLine.stripsPerBox,
            Math.max(1, Math.round(pLine.unitsPerPack / pLine.stripsPerBox)),
            pLine.unitsPerPack,
            pLine.costPricePerUnit,
            pLine.unitPrice,
            round2(pLine.costPricePerUnit * pLine.unitsPerPack),
            pLine.unitPrice,
            packSoldEquivalent,
            negPackQty,
            negStripQty,
            negLooseQty,
            negTotalUnits
          );
          invId = Number(newInv.lastInsertRowid);
        }
      }

      insertLineStmt.run(
        finalSaleId,
        pLine.itemId,
        invId,
        pLine.itemCode,
        pLine.companyName,
        pLine.itemName,
        pLine.packing,
        pLine.unitsPerPack,
        recordedBatchString,
        recordedExpiryString,
        pLine.availablePacks,
        pLine.availableUnits,
        pLine.quantity,
        pLine.bonusQuantity,
        pLine.unitPrice,
        pLine.discountPercent,
        pLine.discountAmount,
        pLine.looseQuantity,
        pLine.looseRate,
        pLine.totalUnits,
        pLine.costPricePerUnit,
        pLine.grossAmount,
        pLine.taxableAmount,
        pLine.taxPercent,
        pLine.taxAmount,
        pLine.lineTotal,
        pLine.offerId,
        pLine.offerName,
        pLine.offerDiscountPercent,
        pLine.offerDiscountAmount,
        pLine.partyDiscountId,
        pLine.partyDiscountPercent,
        pLine.partyDiscountAmount,
        pLine.manualOverrideReason,
        fifoDedicatedSlices.length > 0 ? JSON.stringify(fifoDedicatedSlices) : pLine.fifoBatchesJson
      );
    }

    // Post Double-Entry Accounting if completed
    if (status === 'completed' && netTotal > 0) {
      const salesIncomeAccountId = getSystemAccountId('INC-4010');
      const salesDiscountAccountId = getSystemAccountId('DIS-5015');
      const gstPayableAccountId = getSystemAccountId('TAX-2045');
      const advTaxPayableAccountId = getSystemAccountId('TAX-2040');
      const cogsAccountId = getSystemAccountId('EXP-5005');
      const inventoryAssetAccountId = getSystemAccountId('INV-1030');

      const totalCostOfGoodsSold = round2(
        processedLines.reduce((sum, l) => sum + l.totalUnits * l.costPricePerUnit, 0)
      );

      const jeTotalSide = round2(
        (totalDiscountAmount > 0 ? grossTotal : taxableAmount) +
          totalGst +
          advanceTaxAmount +
          totalCostOfGoodsSold
      );

      const jeNumber = getNextJournalNumber('JE-SAL');
      const jeRes = db.prepare(`
        INSERT INTO journal_entries (
          entry_number, entry_date, reference_type, reference_id, description,
          total_debit, total_credit, is_balanced, status
        ) VALUES (?, ?, 'SALE', ?, ?, ?, ?, 1, 'posted')
      `).run(
        jeNumber,
        invoiceDate,
        finalSaleId,
        `Sales Invoice ${invoiceNumber} (${invoiceType} - ${customerName})`,
        jeTotalSide,
        jeTotalSide
      );
      const journalEntryId = Number(jeRes.lastInsertRowid);

      const insertJeLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      // 1. Debit Customer Account for Net Invoice Amount
      insertJeLine.run(
        journalEntryId,
        customerAccountId,
        'customer',
        netTotal,
        0,
        `Sales Invoice ${invoiceNumber} receivable from ${customerName}`
      );

      // 2. Debit Sales Discount Allowed if > 0
      if (totalDiscountAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          salesDiscountAccountId,
          'general',
          totalDiscountAmount,
          0,
          `Discount allowed on Sales Invoice ${invoiceNumber}`
        );
      }

      // 3. Credit Medicine Sales Income (Gross Sales if discount recorded separately, else Taxable)
      const salesCreditAmount = totalDiscountAmount > 0 ? grossTotal : taxableAmount;
      if (salesCreditAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          salesIncomeAccountId,
          'general',
          0,
          salesCreditAmount,
          `Medicine Sales Income on ${invoiceNumber}`
        );
      }

      // 4. Credit GST Payable if > 0
      if (totalGst > 0) {
        insertJeLine.run(
          journalEntryId,
          gstPayableAccountId,
          'general',
          0,
          totalGst,
          `Output GST collected on ${invoiceNumber}`
        );
      }

      // 5. Credit Advance Tax Collected if > 0
      if (advanceTaxAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          advTaxPayableAccountId,
          'general',
          0,
          advanceTaxAmount,
          `Advance Tax (${advanceTaxRate}%) collected on ${invoiceNumber}`
        );
      }

      // 6. Record Cost of Goods Sold (Debit EXP-5005) and Reduce Inventory Asset (Credit INV-1030)
      if (totalCostOfGoodsSold > 0) {
        insertJeLine.run(
          journalEntryId,
          cogsAccountId,
          'general',
          totalCostOfGoodsSold,
          0,
          `Cost of Goods Sold (Weighted-Avg Batch Cost) on ${invoiceNumber}`
        );
        insertJeLine.run(
          journalEntryId,
          inventoryAssetAccountId,
          'general',
          0,
          totalCostOfGoodsSold,
          `Inventory Stock Reduction on ${invoiceNumber}`
        );
      }

      let paymentJournalEntryId: number | null = null;
      if (paidAmount > 0 && paymentAccountId) {
        const payJeNumber = getNextJournalNumber('JE-SRC');
        const payJeRes = db.prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id, description,
            total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'SALE', ?, ?, ?, ?, 1, 'posted')
        `).run(
          payJeNumber,
          invoiceDate,
          finalSaleId,
          `Receipt against Sales Invoice ${invoiceNumber} (${paymentMode})`,
          paidAmount,
          paidAmount
        );
        paymentJournalEntryId = Number(payJeRes.lastInsertRowid);

        // Debit Cash / Bank Account
        insertJeLine.run(
          paymentJournalEntryId,
          paymentAccountId,
          'general',
          paidAmount,
          0,
          `Payment received against ${invoiceNumber} (${paymentMode})`
        );

        // Credit Customer Account
        insertJeLine.run(
          paymentJournalEntryId,
          customerAccountId,
          'customer',
          0,
          paidAmount,
          `Payment received from ${customerName} against ${invoiceNumber}`
        );
      }

      db.prepare(`
        UPDATE sales
        SET journal_entry_id = ?, payment_journal_entry_id = ?
        WHERE id = ?
      `).run(journalEntryId, paymentJournalEntryId, finalSaleId);

      // Recalculate balances of all affected accounts
      recalculateAccountBalance(customerAccountId);
      recalculateAccountBalance(salesIncomeAccountId);
      if (totalDiscountAmount > 0) recalculateAccountBalance(salesDiscountAccountId);
      if (totalGst > 0) recalculateAccountBalance(gstPayableAccountId);
      if (advanceTaxAmount > 0) recalculateAccountBalance(advTaxPayableAccountId);
      if (totalCostOfGoodsSold > 0) {
        recalculateAccountBalance(cogsAccountId);
        recalculateAccountBalance(inventoryAssetAccountId);
      }
      if (paymentAccountId) recalculateAccountBalance(paymentAccountId);
    }

    return finalSaleId!;
  });

  return tx();
}

/**
 * POST /api/sales
 * Create a new Sales Invoice (completed, held, or draft) with idempotent client_request_id protection
 */
salesRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const clientRequestId = body.client_request_id ? String(body.client_request_id).trim() : '';

    // Prevent duplicate invoice posting on network retry
    if (clientRequestId) {
      const existingByReqId = db
        .prepare('SELECT * FROM sales WHERE client_request_id = ? LIMIT 1')
        .get(clientRequestId) as Record<string, unknown> | undefined;
      if (existingByReqId) {
        const existingItems = db
          .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
          .all(existingByReqId.id);
        return res.status(200).json({
          success: true,
          idempotentDuplicatePrevented: true,
          message: 'Sales invoice was already confirmed and saved.',
          data: { ...existingByReqId, items: existingItems },
        });
      }
    }

    const username = req.user?.username || 'Super Admin';
    const saleId = processSaleUpsert(null, body);

    db.prepare(
      'UPDATE sales SET created_by = ?, updated_by = ?, client_request_id = ? WHERE id = ?'
    ).run(username, username, clientRequestId || null, saleId);

    const created = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, unknown>;
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'SALE_INVOICE_CREATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      username,
      req.ip || '',
      `Created Sales Invoice ${created.invoice_number} (Status: ${created.status}, Net: Rs. ${created.net_total})`
    );

    return res.status(201).json({
      success: true,
      message: 'Sales invoice saved successfully.',
      data: { ...created, items },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logSystemError({
      module: 'sales',
      operation: 'POST /api/sales',
      userMessage: msg,
      username: req.user?.username,
    });
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/sales/:id
 * Update an existing Sales Invoice (resume held/draft; protect posted completed invoices from unauthorized editing)
 */
salesRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const saleId = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM sales WHERE id = ?')
      .get(saleId) as Record<string, unknown> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Sales invoice not found.' });
    }

    if (existing.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cancelled invoices are permanently locked and cannot be edited.',
      });
    }

    // Protect posted (completed) invoices from unauthorized editing
    if (existing.status === 'completed') {
      const role = req.user?.role || '';
      if (role !== 'Super Admin' && role !== 'Administrator') {
        return res.status(403).json({
          success: false,
          error:
            'Posted invoices cannot be modified by non-administrative staff. Please use Sales Return or contact a Super Admin.',
        });
      }
      triggerPreChangeBackupIfEnabled(
        `Modify Posted Sales Invoice ${existing.invoice_number}`,
        req.user?.username || 'Administrator'
      );
    }

    const username = req.user?.username || 'Super Admin';
    processSaleUpsert(saleId, req.body || {});
    db.prepare('UPDATE sales SET updated_by = ? WHERE id = ?').run(username, saleId);

    const updated = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, unknown>;
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'SALE_INVOICE_UPDATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      username,
      req.ip || '',
      `Updated Sales Invoice ${updated.invoice_number} (Status: ${updated.status}, Net: Rs. ${updated.net_total})`
    );

    return res.json({
      success: true,
      message: 'Sales invoice updated successfully.',
      data: { ...updated, items },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logSystemError({
      module: 'sales',
      operation: `PUT /api/sales/${req.params.id}`,
      userMessage: msg,
      username: req.user?.username,
    });
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/sales/:id & POST /api/sales/:id/cancel
 * Discard a draft/held invoice or cancel a completed invoice with full stock & accounting reversal (never physically deletes posted invoices)
 */
function handleCancelOrDeleteSale(req: Request, res: Response) {
  try {
    const db = getDatabase();
    const saleId = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM sales WHERE id = ?')
      .get(saleId) as Record<string, unknown> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Sales invoice not found.' });
    }

    if (existing.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'This sales invoice is already cancelled.',
      });
    }

    const username = req.user?.username || 'Super Admin';
    const cancelReason = req.body?.cancel_reason
      ? String(req.body.cancel_reason).trim()
      : 'Cancelled by authorized administrator with full stock & GL reversal';

    if (existing.status === 'completed') {
      const role = req.user?.role || '';
      if (role !== 'Super Admin' && role !== 'Administrator') {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admin or Administrator can cancel a posted Sales Invoice.',
        });
      }
      triggerPreChangeBackupIfEnabled(`Cancel Sales Invoice ${existing.invoice_number}`, username);
    }

    const tx = db.transaction(() => {
      if (existing.status === 'completed') {
        revertCompletedSaleEffects(saleId);
        db.prepare(
          `
          UPDATE sales
          SET status = 'cancelled',
              cancelled_by = ?,
              cancelled_at = CURRENT_TIMESTAMP,
              cancel_reason = ?,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        ).run(username, cancelReason, username, saleId);

        db.prepare(
          `
          INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
          VALUES (?, ?, 'SALE_INVOICE_CANCELLED', 'WARNING', ?, ?)
        `
        ).run(
          req.user?.id || null,
          username,
          req.ip || '',
          `Cancelled posted Sales Invoice ${existing.invoice_number} (Reason: ${cancelReason})`
        );
      } else {
        db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
        db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
      }
    });

    tx();
    return res.json({
      success: true,
      message:
        existing.status === 'completed'
          ? `Sales invoice ${existing.invoice_number} marked CANCELLED and stock/accounting entries reversed.`
          : 'Held/Draft invoice discarded.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
}

salesRouter.delete('/:id', handleCancelOrDeleteSale);
salesRouter.post('/:id/cancel', handleCancelOrDeleteSale);

/**
 * GET /api/sales/returns/list
 * List all Sales Returns with search & date filters
 */
salesRouter.get('/returns/list', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { q, customerId, startDate, endDate } = req.query;

    let sql = `
      SELECT
        sr.*,
        a.account_code as customer_code,
        (SELECT COUNT(*) FROM sale_return_items sri WHERE sri.sale_return_id = sr.id) as item_count
      FROM sale_returns sr
      LEFT JOIN accounts a ON sr.customer_account_id = a.id
      WHERE 1=1
    `;
    const params: Array<string | number> = [];

    if (customerId && customerId !== 'All') {
      sql += ' AND sr.customer_account_id = ? ';
      params.push(Number(customerId));
    }
    if (startDate) {
      sql += ' AND sr.return_date >= ? ';
      params.push(String(startDate));
    }
    if (endDate) {
      sql += ' AND sr.return_date <= ? ';
      params.push(String(endDate));
    }
    if (q && String(q).trim() !== '') {
      const term = `%${String(q).trim()}%`;
      sql += ' AND (sr.return_number LIKE ? OR sr.original_invoice_number LIKE ? OR sr.customer_name LIKE ? OR sr.return_reason LIKE ?) ';
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY sr.return_date DESC, sr.id DESC ';
    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const totalRefund = rows.reduce((sum, r) => sum + Number(r.total_refund_amount || 0), 0);

    res.json({
      success: true,
      count: rows.length,
      summary: {
        totalReturns: rows.length,
        totalRefundAmount: round2(totalRefund),
      },
      data: rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/returns/:id
 * Get single Sales Return with items & double-entry journal lines
 */
salesRouter.get('/returns/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const returnId = Number(req.params.id);
    const ret = db
      .prepare(`
        SELECT sr.*, a.account_code as customer_code
        FROM sale_returns sr
        LEFT JOIN accounts a ON sr.customer_account_id = a.id
        WHERE sr.id = ?
      `)
      .get(returnId) as Record<string, unknown> | undefined;

    if (!ret) {
      return res.status(404).json({ success: false, error: 'Sales return not found.' });
    }

    const items = db
      .prepare('SELECT * FROM sale_return_items WHERE sale_return_id = ? ORDER BY id ASC')
      .all(returnId);

    const journalLines = ret.journal_entry_id
      ? db
          .prepare(`
            SELECT jel.*, acc.account_code, acc.account_name, je.entry_number
            FROM journal_entry_lines jel
            JOIN accounts acc ON jel.account_id = acc.id
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.journal_entry_id = ?
          `)
          .all(Number(ret.journal_entry_id))
      : [];

    res.json({
      success: true,
      data: {
        ...ret,
        items,
        journalLines,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales/returns
 * Create a Sales Return against an Original Sales Invoice, restore batch stock, and post Double-Entry reversal
 */
salesRouter.post('/returns', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};

    const tx = db.transaction(() => {
      const originalSaleId = Number(body.original_sale_id || 0);
      if (!originalSaleId) {
        throw new Error('Original Sales Invoice is required for a Sales Return.');
      }

      const sale = db
        .prepare('SELECT * FROM sales WHERE id = ?')
        .get(originalSaleId) as Record<string, unknown> | undefined;

      if (!sale || sale.status !== 'completed') {
        throw new Error('Original Sales Invoice must be a confirmed completed invoice.');
      }

      const returnNumber = String(body.return_number || '').trim() || getNextSaleReturnNumber();
      const dupCheck = db
        .prepare('SELECT id FROM sale_returns WHERE LOWER(return_number) = LOWER(?)')
        .get(returnNumber);
      if (dupCheck) {
        throw new Error(`Duplicate Sales Return Number "${returnNumber}" is not allowed.`);
      }

      const returnDate = String(body.return_date || new Date().toISOString().slice(0, 10)).trim();
      const refundMode = ['Account Adjustment', 'Cash Refund', 'Bank Refund'].includes(String(body.refund_mode))
        ? String(body.refund_mode)
        : 'Account Adjustment';
      const returnReason = String(body.return_reason || 'Customer medicine return').trim();

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        throw new Error('At least one returned item is required.');
      }

      let grossReturnAmount = 0;
      let returnDiscountAmount = 0;
      let taxableReturnAmount = 0;
      let gstAdjustmentAmount = 0;

      interface ProcessedReturnItem {
        originalSaleItemId: number;
        itemId: number;
        inventoryId: number | null;
        itemCode: string;
        companyName: string;
        itemName: string;
        packing: string;
        unitsPerPack: number;
        stripsPerBox: number;
        batchNumber: string;
        expiryDate: string;
        soldPackQty: number;
        soldBonusQty: number;
        soldLooseQty: number;
        soldTotalUnits: number;
        returnPackQty: number;
        returnBonusQty: number;
        returnLooseQty: number;
        returnedUnits: number;
        returnRate: number;
        looseReturnRate: number;
        discountPercent: number;
        discountAmount: number;
        taxPercent: number;
        taxAmount: number;
        lineTotal: number;
        reason: string;
      }

      const processedItems: ProcessedReturnItem[] = [];

      for (const rItem of rawItems) {
        const origItemId = Number(rItem.original_sale_item_id || 0);
        const origLine = db
          .prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?')
          .get(origItemId, originalSaleId) as Record<string, unknown> | undefined;

        if (!origLine) {
          throw new Error(`Invalid original sale line item ID ${origItemId}.`);
        }

        const parsed = parsePacking(String(origLine.packing || '1x1'));
        const unitsPerPack = Math.max(1, Number(origLine.units_per_pack || parsed.unitsPerPack));
        const returnPackQty = round2(Math.max(0, Number(rItem.return_pack_qty || 0)));
        const returnBonusQty = round2(Math.max(0, Number(rItem.return_bonus_qty || 0)));
        const returnLooseQty = round2(Math.max(0, Number(rItem.return_loose_qty || 0)));
        const returnedUnits = round2((returnPackQty + returnBonusQty) * unitsPerPack + returnLooseQty);

        if (returnedUnits <= 0) continue;

        const soldTotalUnits = round2(Number(origLine.total_units || 0));
        const alreadyReturnedUnits = round2(Number(origLine.returned_total_units || 0));
        const eligibleUnits = round2(soldTotalUnits - alreadyReturnedUnits);

        if (returnedUnits > eligibleUnits) {
          throw new Error(
            `Cannot return ${returnedUnits} units of "${origLine.item_name}" (Batch ${origLine.batch_number}). Eligible remaining sold units: ${eligibleUnits}.`
          );
        }

        const returnRate = round2(Number(rItem.return_rate ?? origLine.unit_price));
        const looseReturnRate = round2(Number(rItem.loose_return_rate ?? origLine.loose_rate ?? returnRate / unitsPerPack));
        const lineGross = round2(returnPackQty * returnRate + returnLooseQty * looseReturnRate);

        const discountPercent = round2(Number(origLine.discount_percent || 0));
        const lineDiscount = round2((lineGross * discountPercent) / 100);
        const lineTaxable = round2(Math.max(0, lineGross - lineDiscount));
        const taxPercent = round2(Number(origLine.tax_percent || 0));
        const lineTax = round2((lineTaxable * taxPercent) / 100);
        const lineTotal = round2(lineTaxable + lineTax);

        grossReturnAmount = round2(grossReturnAmount + lineGross);
        returnDiscountAmount = round2(returnDiscountAmount + lineDiscount);
        taxableReturnAmount = round2(taxableReturnAmount + lineTaxable);
        gstAdjustmentAmount = round2(gstAdjustmentAmount + lineTax);

        processedItems.push({
          originalSaleItemId: origItemId,
          itemId: Number(origLine.item_id),
          inventoryId: origLine.inventory_id ? Number(origLine.inventory_id) : null,
          itemCode: String(origLine.item_code),
          companyName: String(origLine.company_name || ''),
          itemName: String(origLine.item_name),
          packing: String(origLine.packing || '1x1'),
          unitsPerPack,
          stripsPerBox: parsed.stripsPerBox,
          batchNumber: String(origLine.batch_number),
          expiryDate: String(origLine.expiry_date),
          soldPackQty: round2(Number(origLine.quantity || 0)),
          soldBonusQty: round2(Number(origLine.bonus_quantity || 0)),
          soldLooseQty: round2(Number(origLine.loose_quantity || 0)),
          soldTotalUnits,
          returnPackQty,
          returnBonusQty,
          returnLooseQty,
          returnedUnits,
          returnRate,
          looseReturnRate,
          discountPercent,
          discountAmount: lineDiscount,
          taxPercent,
          taxAmount: lineTax,
          lineTotal,
          reason: String(rItem.return_reason || returnReason),
        });
      }

      if (processedItems.length === 0) {
        throw new Error('Please enter a return quantity greater than 0 for at least one sold item.');
      }

      // Proportional invoice-level discount adjustment if original sale had an invoice discount
      const origInvoiceDiscPercent = round2(Number(sale.invoice_discount_percent || 0));
      if (origInvoiceDiscPercent > 0) {
        const extraInvDisc = round2((taxableReturnAmount * origInvoiceDiscPercent) / 100);
        returnDiscountAmount = round2(returnDiscountAmount + extraInvDisc);
        taxableReturnAmount = round2(Math.max(0, grossReturnAmount - returnDiscountAmount));
      }

      // Proportional Advance Tax reversal if original sale had Advance Tax
      const origAdvTaxRate = Number(sale.advance_tax_applicable) ? round2(Number(sale.advance_tax_rate || 0)) : 0;
      const advanceTaxAdjustmentAmount =
        origAdvTaxRate > 0 ? round2(((taxableReturnAmount + gstAdjustmentAmount) * origAdvTaxRate) / 100) : 0;

      const totalRefundAmount = round2(taxableReturnAmount + gstAdjustmentAmount + advanceTaxAdjustmentAmount);

      const customerAccountId = Number(sale.customer_account_id || getSystemAccountId('CUS-1001'));
      let refundAccountId: number | null = body.refund_account_id ? Number(body.refund_account_id) : null;
      if (refundMode === 'Cash Refund' && !refundAccountId) {
        refundAccountId = getSystemAccountId('FIN-1010');
      } else if (refundMode === 'Bank Refund' && !refundAccountId) {
        refundAccountId = getSystemAccountId('FIN-1021');
      }

      const srInsert = db.prepare(`
        INSERT INTO sale_returns (
          return_number, return_date, original_sale_id, original_invoice_number,
          customer_account_id, customer_name, refund_mode, refund_account_id,
          gross_return_amount, return_discount_amount, taxable_return_amount,
          gst_adjustment_amount, advance_tax_adjustment_amount, total_refund_amount,
          return_reason, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
      `).run(
        returnNumber,
        returnDate,
        originalSaleId,
        String(sale.invoice_number),
        customerAccountId,
        String(sale.customer_name || 'Walk-in Cash Customer'),
        refundMode,
        refundAccountId,
        grossReturnAmount,
        returnDiscountAmount,
        taxableReturnAmount,
        gstAdjustmentAmount,
        advanceTaxAdjustmentAmount,
        totalRefundAmount,
        returnReason
      );

      const saleReturnId = Number(srInsert.lastInsertRowid);

      const insertReturnItemStmt = db.prepare(`
        INSERT INTO sale_return_items (
          sale_return_id, original_sale_item_id, item_id, inventory_id,
          item_code, company_name, item_name, packing, units_per_pack,
          batch_number, expiry_date, sold_pack_qty, sold_bonus_qty, sold_loose_qty, sold_total_units,
          return_pack_qty, return_bonus_qty, return_loose_qty, returned_units,
          return_rate, loose_return_rate, discount_percent, discount_amount,
          tax_percent, tax_amount, line_total, return_reason, restock_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'restocked')
      `);

      for (const pItem of processedItems) {
        insertReturnItemStmt.run(
          saleReturnId,
          pItem.originalSaleItemId,
          pItem.itemId,
          pItem.inventoryId,
          pItem.itemCode,
          pItem.companyName,
          pItem.itemName,
          pItem.packing,
          pItem.unitsPerPack,
          pItem.batchNumber,
          pItem.expiryDate,
          pItem.soldPackQty,
          pItem.soldBonusQty,
          pItem.soldLooseQty,
          pItem.soldTotalUnits,
          pItem.returnPackQty,
          pItem.returnBonusQty,
          pItem.returnLooseQty,
          pItem.returnedUnits,
          pItem.returnRate,
          pItem.looseReturnRate,
          pItem.discountPercent,
          pItem.discountAmount,
          pItem.taxPercent,
          pItem.taxAmount,
          pItem.lineTotal,
          pItem.reason
        );

        // Update returned counters on original sale_items row
        db.prepare(`
          UPDATE sale_items
          SET returned_pack_qty = ROUND(returned_pack_qty + ?, 2),
              returned_loose_qty = ROUND(returned_loose_qty + ?, 2),
              returned_total_units = ROUND(returned_total_units + ?, 2)
          WHERE id = ?
        `).run(pItem.returnPackQty, pItem.returnLooseQty, pItem.returnedUnits, pItem.originalSaleItemId);

        // Restore stock to the original batch in inventory
        let invRow = pItem.inventoryId
          ? (db.prepare('SELECT * FROM inventory WHERE id = ?').get(pItem.inventoryId) as Record<string, unknown> | undefined)
          : undefined;
        if (!invRow) {
          invRow = db
            .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
            .get(pItem.itemId, pItem.batchNumber) as Record<string, unknown> | undefined;
        }

        if (invRow) {
          const packRestored = round2(pItem.returnedUnits / pItem.unitsPerPack);
          const newSoldQty = round2(Math.max(0, Number(invRow.sold_qty || 0) - packRestored));
          const newTotalUnits = round2(Number(invRow.total_stock_units || 0) + pItem.returnedUnits);
          const newPackQty = round2(newTotalUnits / pItem.unitsPerPack);
          const newStripQty = round2(newPackQty * pItem.stripsPerBox);
          const newLooseQty = round2(newTotalUnits % pItem.unitsPerPack);

          const itemMin = db
            .prepare('SELECT minimum_stock FROM items WHERE id = ?')
            .get(pItem.itemId) as { minimum_stock: number } | undefined;
          const batchStatus = computeBatchStatus(
            newPackQty,
            pItem.expiryDate,
            Number(itemMin?.minimum_stock || 0)
          );

          db.prepare(`
            UPDATE inventory
            SET sold_qty = ?,
                current_pack_qty = ?,
                current_strip_qty = ?,
                current_loose_qty = ?,
                total_stock_units = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            newSoldQty,
            newPackQty,
            newStripQty,
            newLooseQty,
            newTotalUnits,
            batchStatus,
            Number(invRow.id)
          );
        }
      }

      // Post balanced Double-Entry Journal Entry for the Sales Return
      const salesReturnsAccountId = getSystemAccountId('SAL-4015');
      const gstPayableAccountId = getSystemAccountId('TAX-2045');
      const advTaxPayableAccountId = getSystemAccountId('TAX-2040');
      const cogsAccountId = getSystemAccountId('EXP-5005');
      const inventoryAssetAccountId = getSystemAccountId('INV-1030');

      let totalCostReversed = 0;
      for (const pItem of processedItems) {
        const origLineCost = db
          .prepare('SELECT cost_price_per_unit FROM sale_items WHERE id = ?')
          .get(pItem.originalSaleItemId) as { cost_price_per_unit: number } | undefined;
        let unitCost = Number(origLineCost?.cost_price_per_unit || 0);
        if (unitCost <= 0 && pItem.inventoryId) {
          const invCost = db
            .prepare('SELECT pack_cost, units_per_pack FROM inventory WHERE id = ?')
            .get(pItem.inventoryId) as { pack_cost: number; units_per_pack: number } | undefined;
          if (invCost) {
            unitCost = round2(Number(invCost.pack_cost || 0) / Math.max(1, Number(invCost.units_per_pack || 1)));
          }
        }
        totalCostReversed = round2(totalCostReversed + pItem.returnedUnits * unitCost);
      }

      const creditTargetAccountId =
        refundMode === 'Account Adjustment'
          ? customerAccountId
          : refundAccountId || getSystemAccountId('FIN-1010');

      const jeTotalSide = round2(totalRefundAmount + totalCostReversed);

      const jeNumber = getNextJournalNumber('JE-SRN');
      const jeRes = db.prepare(`
        INSERT INTO journal_entries (
          entry_number, entry_date, reference_type, reference_id, description,
          total_debit, total_credit, is_balanced, status
        ) VALUES (?, ?, 'SALE_RETURN', ?, ?, ?, ?, 1, 'posted')
      `).run(
        jeNumber,
        returnDate,
        saleReturnId,
        `Sales Return ${returnNumber} against Invoice ${sale.invoice_number} (${refundMode})`,
        jeTotalSide,
        jeTotalSide
      );

      const journalEntryId = Number(jeRes.lastInsertRowid);
      const insertJeLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Debit Sales Returns Account
      if (taxableReturnAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          salesReturnsAccountId,
          'general',
          taxableReturnAmount,
          0,
          `Medicine Sales Return ${returnNumber} against ${sale.invoice_number}`
        );
      }

      // Debit GST Payable if > 0
      if (gstAdjustmentAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          gstPayableAccountId,
          'general',
          gstAdjustmentAmount,
          0,
          `GST reversal on Sales Return ${returnNumber}`
        );
      }

      // Debit Advance Tax Collected if > 0
      if (advanceTaxAdjustmentAmount > 0) {
        insertJeLine.run(
          journalEntryId,
          advTaxPayableAccountId,
          'general',
          advanceTaxAdjustmentAmount,
          0,
          `Advance Tax reversal on Sales Return ${returnNumber}`
        );
      }

      // Credit Customer Account (or Cash/Bank if refunded directly)
      insertJeLine.run(
        journalEntryId,
        creditTargetAccountId,
        creditTargetAccountId === customerAccountId ? 'customer' : 'general',
        0,
        totalRefundAmount,
        `Sales Return ${returnNumber} credit/refund (${refundMode})`
      );

      // Restore Inventory Asset (Debit INV-1030) and Reverse COGS (Credit EXP-5005)
      if (totalCostReversed > 0) {
        insertJeLine.run(
          journalEntryId,
          inventoryAssetAccountId,
          'general',
          totalCostReversed,
          0,
          `Inventory Stock Restored on Sales Return ${returnNumber}`
        );
        insertJeLine.run(
          journalEntryId,
          cogsAccountId,
          'general',
          0,
          totalCostReversed,
          `Cost of Goods Sold Reversed on Sales Return ${returnNumber}`
        );
      }

      db.prepare('UPDATE sale_returns SET journal_entry_id = ? WHERE id = ?').run(
        journalEntryId,
        saleReturnId
      );

      recalculateAccountBalance(salesReturnsAccountId);
      if (gstAdjustmentAmount > 0) recalculateAccountBalance(gstPayableAccountId);
      if (advanceTaxAdjustmentAmount > 0) recalculateAccountBalance(advTaxPayableAccountId);
      if (totalCostReversed > 0) {
        recalculateAccountBalance(inventoryAssetAccountId);
        recalculateAccountBalance(cogsAccountId);
      }
      recalculateAccountBalance(creditTargetAccountId);
      recalculateAccountBalance(customerAccountId);

      return saleReturnId;
    });

    const newReturnId = tx();
    const created = db.prepare('SELECT * FROM sale_returns WHERE id = ?').get(newReturnId);
    const items = db
      .prepare('SELECT * FROM sale_return_items WHERE sale_return_id = ?')
      .all(newReturnId);

    res.status(201).json({
      success: true,
      message: 'Sales Return recorded, batch stock restored, and accounting entries balanced.',
      data: { ...(created as Record<string, unknown>), items },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/payments
 * List Payment & Receipt Vouchers (Receive Payment, Customer Receipt, Cash Payment, Bank Payment)
 */
salesRouter.get('/payments', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { voucherType, partyId, startDate, endDate, q } = req.query;

    let sql = `
      SELECT
        pv.*,
        pa.account_code as party_code,
        pa.account_name as party_name,
        pa.account_group as party_group,
        fa.account_code as financial_code,
        fa.account_name as financial_name,
        je.entry_number as journal_entry_number
      FROM payment_vouchers pv
      JOIN accounts pa ON pv.party_account_id = pa.id
      JOIN accounts fa ON pv.financial_account_id = fa.id
      LEFT JOIN journal_entries je ON pv.journal_entry_id = je.id
      WHERE 1=1
    `;
    const params: Array<string | number> = [];

    if (voucherType && voucherType !== 'All') {
      sql += ' AND pv.voucher_type = ? ';
      params.push(String(voucherType));
    }
    if (partyId && partyId !== 'All') {
      sql += ' AND pv.party_account_id = ? ';
      params.push(Number(partyId));
    }
    if (startDate) {
      sql += ' AND pv.voucher_date >= ? ';
      params.push(String(startDate));
    }
    if (endDate) {
      sql += ' AND pv.voucher_date <= ? ';
      params.push(String(endDate));
    }
    if (q && String(q).trim() !== '') {
      const term = `%${String(q).trim()}%`;
      sql += ' AND (pv.voucher_number LIKE ? OR pa.account_name LIKE ? OR pv.reference_number LIKE ? OR pv.description LIKE ?) ';
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY pv.voucher_date DESC, pv.id DESC LIMIT 200 ';
    const rows = db.prepare(sql).all(...params);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales/payments
 * Create a Payment or Receipt Voucher with balanced Double-Entry posting
 */
salesRouter.post('/payments', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};

    const tx = db.transaction(() => {
      const voucherType = String(body.voucher_type || 'receive_payment');
      if (!['receive_payment', 'customer_receipt', 'cash_payment', 'bank_payment'].includes(voucherType)) {
        throw new Error('Invalid voucher type.');
      }

      const partyAccountId = Number(body.party_account_id || 0);
      if (!partyAccountId) {
        throw new Error('Please select a Customer / Supplier / Party Account.');
      }

      let financialAccountId = Number(body.financial_account_id || 0);
      if (!financialAccountId) {
        financialAccountId =
          voucherType === 'bank_payment' || String(body.payment_method) === 'Bank Transfer'
            ? getSystemAccountId('FIN-1021')
            : getSystemAccountId('FIN-1010');
      }

      const amount = round2(Number(body.amount || 0));
      if (amount <= 0) {
        throw new Error('Payment amount must be greater than 0.');
      }

      const voucherNumber = String(body.voucher_number || '').trim() || getNextVoucherNumber();
      const voucherDate = String(body.voucher_date || new Date().toISOString().slice(0, 10)).trim();
      const paymentMethod = ['Cash', 'Bank Transfer', 'Cheque', 'Online'].includes(String(body.payment_method))
        ? String(body.payment_method)
        : voucherType === 'bank_payment'
        ? 'Bank Transfer'
        : 'Cash';
      const referenceNumber = String(body.reference_number || '').trim();

      const partyAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(partyAccountId) as Record<
        string,
        unknown
      >;
      const finAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(financialAccountId) as Record<
        string,
        unknown
      >;

      if (!partyAcc || !finAcc) {
        throw new Error('Selected accounts could not be found.');
      }

      const isReceipt = voucherType === 'receive_payment' || voucherType === 'customer_receipt';
      const defaultDesc = isReceipt
        ? `Payment received from ${partyAcc.account_name} into ${finAcc.account_name}`
        : `Payment made to ${partyAcc.account_name} from ${finAcc.account_name}`;
      const description = String(body.description || defaultDesc).trim();

      const jeNumber = getNextJournalNumber(isReceipt ? 'JE-RCV' : 'JE-PAY');
      const jeRes = db.prepare(`
        INSERT INTO journal_entries (
          entry_number, entry_date, reference_type, reference_id, description,
          total_debit, total_credit, is_balanced, status
        ) VALUES (?, ?, 'VOUCHER', NULL, ?, ?, ?, 1, 'posted')
      `).run(
        jeNumber,
        voucherDate,
        description,
        amount,
        amount
      );
      const journalEntryId = Number(jeRes.lastInsertRowid);

      const insertJeLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?)
      `);

      if (isReceipt) {
        // Debit Cash/Bank, Credit Customer/Party
        insertJeLine.run(journalEntryId, financialAccountId, amount, 0, description);
        insertJeLine.run(journalEntryId, partyAccountId, 0, amount, description);
      } else {
        // Debit Supplier/Party/Expense, Credit Cash/Bank
        insertJeLine.run(journalEntryId, partyAccountId, amount, 0, description);
        insertJeLine.run(journalEntryId, financialAccountId, 0, amount, description);
      }

      const vchRes = db.prepare(`
        INSERT INTO payment_vouchers (
          voucher_number, voucher_date, voucher_type,
          party_account_id, financial_account_id, amount,
          payment_method, reference_number, description,
          journal_entry_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted')
      `).run(
        voucherNumber,
        voucherDate,
        voucherType,
        partyAccountId,
        financialAccountId,
        amount,
        paymentMethod,
        referenceNumber,
        description,
        journalEntryId
      );

      const voucherId = Number(vchRes.lastInsertRowid);
      db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(voucherId, journalEntryId);

      recalculateAccountBalance(partyAccountId);
      recalculateAccountBalance(financialAccountId);

      return voucherId;
    });

    const newVoucherId = tx();
    const created = db
      .prepare(`
        SELECT pv.*, pa.account_name as party_name, fa.account_name as financial_name
        FROM payment_vouchers pv
        JOIN accounts pa ON pv.party_account_id = pa.id
        JOIN accounts fa ON pv.financial_account_id = fa.id
        WHERE pv.id = ?
      `)
      .get(newVoucherId);

    res.status(201).json({
      success: true,
      message: 'Payment voucher posted and account ledgers updated.',
      data: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/ledgers
 * Comprehensive Account Ledger & Statement endpoint for:
 * Customer Ledger, Supplier Ledger, Cash Account Ledger, Bank Account Ledger, General Ledger, Account Statement
 */
salesRouter.get('/ledgers', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { ledgerType = 'customer', accountId, startDate, endDate } = req.query;

    // 1. Filter eligible accounts for the selected ledgerType
    let accWhere = ' WHERE 1=1 ';
    if (ledgerType === 'customer') {
      accWhere += " AND account_group IN ('Customer', 'Customer & Supplier') ";
    } else if (ledgerType === 'supplier') {
      accWhere += " AND account_group IN ('Supplier', 'Customer & Supplier') ";
    } else if (ledgerType === 'cash') {
      accWhere += " AND account_group = 'Cash in Hand' ";
    } else if (ledgerType === 'bank') {
      accWhere += " AND account_group = 'Bank' ";
    }

    const eligibleAccounts = db
      .prepare(`SELECT * FROM accounts ${accWhere} ORDER BY account_code ASC`)
      .all() as Array<Record<string, unknown>>;

    const selectedAccountId = accountId
      ? Number(accountId)
      : eligibleAccounts[0]
      ? Number(eligibleAccounts[0].id)
      : 0;

    if (ledgerType === 'general' && !accountId) {
      // Return General Ledger across all accounts
      let glWhere = " WHERE je.status = 'posted' ";
      const glParams: Array<string | number> = [];
      if (startDate) {
        glWhere += ' AND je.entry_date >= ? ';
        glParams.push(String(startDate));
      }
      if (endDate) {
        glWhere += ' AND je.entry_date <= ? ';
        glParams.push(String(endDate));
      }

      const lines = db
        .prepare(`
          SELECT
            jel.id,
            je.entry_number,
            je.entry_date,
            je.reference_type as source_type,
            je.description as entry_description,
            acc.id as account_id,
            acc.account_code,
            acc.account_name,
            acc.account_group,
            jel.debit_amount,
            jel.credit_amount,
            jel.narration
          FROM journal_entry_lines jel
          JOIN journal_entries je ON jel.journal_entry_id = je.id
          JOIN accounts acc ON jel.account_id = acc.id
          ${glWhere}
          ORDER BY je.entry_date DESC, je.id DESC, jel.id ASC
          LIMIT 500
        `)
        .all(...glParams) as Array<Record<string, unknown>>;

      const totalDebit = lines.reduce((s, r) => s + Number(r.debit_amount || 0), 0);
      const totalCredit = lines.reduce((s, r) => s + Number(r.credit_amount || 0), 0);

      return res.json({
        success: true,
        ledgerType,
        accounts: eligibleAccounts,
        selectedAccount: null,
        summary: {
          openingBalance: 0,
          openingBalanceType: 'Debit',
          totalDebit: round2(totalDebit),
          totalCredit: round2(totalCredit),
          closingBalance: round2(Math.abs(totalDebit - totalCredit)),
          closingBalanceType: totalDebit >= totalCredit ? 'Debit' : 'Credit',
        },
        entries: lines,
      });
    }

    const selectedAccount = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(selectedAccountId) as Record<string, unknown> | undefined;

    if (!selectedAccount) {
      return res.json({
        success: true,
        ledgerType,
        accounts: eligibleAccounts,
        selectedAccount: null,
        summary: {
          openingBalance: 0,
          openingBalanceType: 'Debit',
          totalDebit: 0,
          totalCredit: 0,
          closingBalance: 0,
          closingBalanceType: 'Debit',
        },
        entries: [],
      });
    }

    // Calculate opening balance prior to startDate
    const baseOpening = Number(selectedAccount.opening_balance || 0);
    const baseOpeningType = String(selectedAccount.opening_balance_type || 'Debit') as 'Debit' | 'Credit';
    let runningSigned = baseOpeningType === 'Debit' ? baseOpening : -baseOpening;

    if (startDate) {
      const priorSums = db
        .prepare(`
          SELECT
            COALESCE(SUM(jel.debit_amount), 0) as priorDebit,
            COALESCE(SUM(jel.credit_amount), 0) as priorCredit
          FROM journal_entry_lines jel
          JOIN journal_entries je ON jel.journal_entry_id = je.id
          WHERE jel.account_id = ?
            AND je.status = 'posted'
            AND je.entry_date < ?
        `)
        .get(selectedAccountId, String(startDate)) as { priorDebit: number; priorCredit: number };

      runningSigned = round2(runningSigned + Number(priorSums.priorDebit || 0) - Number(priorSums.priorCredit || 0));
    }

    const effectiveOpeningBalance = round2(Math.abs(runningSigned));
    const effectiveOpeningType: 'Debit' | 'Credit' = runningSigned >= 0 ? 'Debit' : 'Credit';

    let entryWhere = " WHERE jel.account_id = ? AND je.status = 'posted' ";
    const entryParams: Array<string | number> = [selectedAccountId];

    if (startDate) {
      entryWhere += ' AND je.entry_date >= ? ';
      entryParams.push(String(startDate));
    }
    if (endDate) {
      entryWhere += ' AND je.entry_date <= ? ';
      entryParams.push(String(endDate));
    }

    const rawEntries = db
      .prepare(`
        SELECT
          jel.id,
          je.id as journal_entry_id,
          je.entry_number,
          je.entry_date,
          je.reference_type as source_type,
          je.reference_id as source_id,
          je.description as entry_description,
          jel.debit_amount,
          jel.credit_amount,
          jel.narration
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.journal_entry_id = je.id
        ${entryWhere}
        ORDER BY je.entry_date ASC, je.id ASC, jel.id ASC
      `)
      .all(...entryParams) as Array<Record<string, unknown>>;

    let periodDebit = 0;
    let periodCredit = 0;

    const entriesWithRunning = rawEntries.map((row) => {
      const dr = round2(row.debit_amount);
      const cr = round2(row.credit_amount);
      periodDebit = round2(periodDebit + dr);
      periodCredit = round2(periodCredit + cr);
      runningSigned = round2(runningSigned + dr - cr);
      return {
        ...row,
        debit_amount: dr,
        credit_amount: cr,
        running_balance: round2(Math.abs(runningSigned)),
        running_balance_type: runningSigned >= 0 ? 'Debit' : 'Credit',
      };
    });

    res.json({
      success: true,
      ledgerType,
      accounts: eligibleAccounts,
      selectedAccount,
      summary: {
        openingBalance: effectiveOpeningBalance,
        openingBalanceType: effectiveOpeningType,
        totalDebit: periodDebit,
        totalCredit: periodCredit,
        closingBalance: round2(Math.abs(runningSigned)),
        closingBalanceType: runningSigned >= 0 ? 'Debit' : 'Credit',
      },
      entries: entriesWithRunning,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales/reports/:reportType
 * Comprehensive Sales, Return, Profit, Discount & Tax Analytics Suite:
 * - company-group-sales
 * - yearly-sales
 * - monthly-sales
 * - customer-wise-sales (Party-wise Sales)
 * - party-monthly-sales
 * - yearly-party-comparison
 * - item-wise-sales (Full Pack Equivalent)
 * - salesman-wise-sales
 * - daily-sales
 * - profit-report
 * - discount-report
 * - sales-return-report
 * - tax-summary
 */
salesRouter.get('/reports/:reportType', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { reportType } = req.params;
    const rawStart = req.query.startDate || req.query.fromDate;
    const rawEnd = req.query.endDate || req.query.toDate;
    const startDate = rawStart ? String(rawStart).trim() : '';
    const endDate = rawEnd ? String(rawEnd).trim() : '';
    const customerId = req.query.customerId ? String(req.query.customerId).trim() : '';
    const itemId = req.query.itemId ? String(req.query.itemId).trim() : '';
    const salesmanId = req.query.salesmanId ? String(req.query.salesmanId).trim() : '';
    const itemGroup = req.query.itemGroup ? String(req.query.itemGroup).trim() : '';
    const townName = req.query.townName ? String(req.query.townName).trim() : '';
    const areaName = req.query.areaName ? String(req.query.areaName).trim() : '';

    const parseStrList = (val: unknown): string[] => {
      if (!val) return [];
      const arr = Array.isArray(val) ? val : [val];
      return arr
        .flatMap((v) => String(v).split(','))
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toUpperCase() !== 'ALL');
    };
    const parseNumList = (val: unknown): number[] =>
      parseStrList(val)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);

    const companiesFilter = parseStrList(req.query.companies || req.query.companyNames);
    const itemIdsFilter = parseNumList(req.query.itemIds || (itemId && itemId !== 'All' ? itemId : ''));
    const partyIdsFilter = parseNumList(req.query.partyIds || req.query.customerIds);
    const hasItemScopeFilter =
      companiesFilter.length > 0 ||
      itemIdsFilter.length > 0 ||
      (Boolean(itemGroup) && itemGroup.toUpperCase() !== 'ALL');

    const buildSalesHeaderFilter = () => {
      let where = " WHERE s.status = 'completed' ";
      const params: Array<string | number> = [];
      if (startDate) {
        where += ' AND s.invoice_date >= ? ';
        params.push(startDate);
      }
      if (endDate) {
        where += ' AND s.invoice_date <= ? ';
        params.push(endDate);
      }
      if (partyIdsFilter.length > 0) {
        where += ` AND s.customer_account_id IN (${partyIdsFilter.map(() => '?').join(',')}) `;
        params.push(...partyIdsFilter);
      } else if (customerId && customerId.toUpperCase() !== 'ALL') {
        where += ' AND s.customer_account_id = ? ';
        params.push(Number(customerId));
      }
      if (salesmanId && salesmanId.toUpperCase() !== 'ALL') {
        where += ' AND s.salesman_id = ? ';
        params.push(Number(salesmanId));
      }
      if (townName && townName.toUpperCase() !== 'ALL') {
        where += " AND COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '') = ? ";
        params.push(townName);
      }
      if (areaName && areaName.toUpperCase() !== 'ALL') {
        where += " AND COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '') = ? ";
        params.push(areaName);
      }
      return { where, params };
    };

    const buildItemScopeClause = () => {
      let clause = '';
      const params: Array<string | number> = [];
      if (companiesFilter.length > 0) {
        clause += ` AND COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(si.company_name), ''), 'General') IN (${companiesFilter.map(() => '?').join(',')}) `;
        params.push(...companiesFilter);
      }
      if (itemIdsFilter.length > 0) {
        clause += ` AND si.item_id IN (${itemIdsFilter.map(() => '?').join(',')}) `;
        params.push(...itemIdsFilter);
      }
      if (itemGroup && itemGroup.toUpperCase() !== 'ALL') {
        clause += ` AND COALESCE(NULLIF(TRIM(i.category), ''), 'General') = ? `;
        params.push(itemGroup);
      }
      return { clause, params };
    };

    const buildReturnScopeClause = () => {
      let clause = '';
      const params: Array<string | number> = [];
      if (companiesFilter.length > 0) {
        clause += ` AND COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(sri.company_name), ''), 'General') IN (${companiesFilter.map(() => '?').join(',')}) `;
        params.push(...companiesFilter);
      }
      if (itemIdsFilter.length > 0) {
        clause += ` AND sri.item_id IN (${itemIdsFilter.map(() => '?').join(',')}) `;
        params.push(...itemIdsFilter);
      }
      if (itemGroup && itemGroup.toUpperCase() !== 'ALL') {
        clause += ` AND COALESCE(NULLIF(TRIM(i.category), ''), 'General') = ? `;
        params.push(itemGroup);
      }
      return { clause, params };
    };

    // Helper: aggregate Full Pack quantities + returns cleanly without inflating invoice totals
    const fullPackSaleExpr =
      'COALESCE(si.quantity, 0) + (COALESCE(si.loose_quantity, 0) / CASE WHEN COALESCE(si.units_per_pack, 1) > 0 THEN si.units_per_pack ELSE 1 END)';
    const fullPackRetExpr =
      'COALESCE(sri.return_pack_qty, 0) + (COALESCE(sri.return_loose_qty, 0) / CASE WHEN COALESCE(sri.units_per_pack, 1) > 0 THEN sri.units_per_pack ELSE 1 END)';

    // Simple header filter without accounts join for simple routes
    let dateFilterSales = " WHERE s.status = 'completed' ";
    const salesParams: Array<string | number> = [];
    if (startDate) {
      dateFilterSales += ' AND s.invoice_date >= ? ';
      salesParams.push(startDate);
    }
    if (endDate) {
      dateFilterSales += ' AND s.invoice_date <= ? ';
      salesParams.push(endDate);
    }
    if (customerId && customerId.toUpperCase() !== 'ALL') {
      dateFilterSales += ' AND s.customer_account_id = ? ';
      salesParams.push(Number(customerId));
    }
    if (salesmanId && salesmanId.toUpperCase() !== 'ALL') {
      dateFilterSales += ' AND s.salesman_id = ? ';
      salesParams.push(Number(salesmanId));
    }

    // -----------------------------------------------------------------------
    // 1. COMPANY-WISE ITEM GROUP SALES REPORT
    // -----------------------------------------------------------------------
    if (reportType === 'company-group-sales') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      const saleRows = db
        .prepare(`
          SELECT
            COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(si.company_name), ''), 'General') AS company_name,
            COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
            COUNT(DISTINCT s.id) AS invoice_count,
            ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
            ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty,
            ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_sales,
            ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS discount_amount,
            ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS line_net_sales
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN items i ON si.item_id = i.id
          LEFT JOIN accounts a ON s.customer_account_id = a.id
          ${where} ${itemScope.clause}
          GROUP BY company_name, item_group
          ORDER BY company_name ASC, line_net_sales DESC
        `)
        .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;

      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND sr.customer_account_id = ? ';
        retParams.push(Number(customerId));
      }

      const retRows = db
        .prepare(`
          SELECT
            COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(sri.company_name), ''), 'General') AS company_name,
            COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
            ROUND(SUM(${fullPackRetExpr}), 2) AS return_qty,
            ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return
          FROM sale_return_items sri
          JOIN sale_returns sr ON sri.sale_return_id = sr.id
          LEFT JOIN items i ON sri.item_id = i.id
          ${retWhere} ${retScope.clause}
          GROUP BY company_name, item_group
        `)
        .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>;

      const retMap = new Map<string, { return_qty: number; sales_return: number }>();
      for (const r of retRows) {
        retMap.set(`${r.company_name}::${r.item_group}`, {
          return_qty: round2(r.return_qty),
          sales_return: round2(r.sales_return),
        });
      }

      const merged = saleRows.map((r) => {
        const key = `${r.company_name}::${r.item_group}`;
        const ret = retMap.get(key) || { return_qty: 0, sales_return: 0 };
        const gross = round2(r.gross_sales);
        const disc = round2(r.discount_amount);
        const lineNet = round2(r.line_net_sales);
        const netAfterReturn = round2(lineNet - ret.sales_return);
        return {
          company_name: String(r.company_name || 'General'),
          item_group: String(r.item_group || 'General'),
          invoice_count: Number(r.invoice_count || 0),
          sale_qty: round2(r.sale_qty),
          bonus_qty: round2(r.bonus_qty),
          return_qty: ret.return_qty,
          gross_sales: gross,
          sales_return: ret.sales_return,
          discount_amount: disc,
          net_sales: netAfterReturn,
        };
      });

      const companySubtotalsMap = new Map<string, Record<string, number>>();
      for (const row of merged) {
        const cur = companySubtotalsMap.get(row.company_name) || {
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          return_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
        };
        cur.invoice_count += row.invoice_count;
        cur.sale_qty = round2(cur.sale_qty + row.sale_qty);
        cur.bonus_qty = round2(cur.bonus_qty + row.bonus_qty);
        cur.return_qty = round2(cur.return_qty + row.return_qty);
        cur.gross_sales = round2(cur.gross_sales + row.gross_sales);
        cur.sales_return = round2(cur.sales_return + row.sales_return);
        cur.discount_amount = round2(cur.discount_amount + row.discount_amount);
        cur.net_sales = round2(cur.net_sales + row.net_sales);
        companySubtotalsMap.set(row.company_name, cur);
      }

      const companySubtotals = Array.from(companySubtotalsMap.entries()).map(([company_name, s]) => ({
        company_name,
        ...s,
      }));

      const totals = merged.reduce(
        (acc, r) => ({
          invoice_count: acc.invoice_count + r.invoice_count,
          sale_qty: round2(acc.sale_qty + r.sale_qty),
          bonus_qty: round2(acc.bonus_qty + r.bonus_qty),
          return_qty: round2(acc.return_qty + r.return_qty),
          gross_sales: round2(acc.gross_sales + r.gross_sales),
          sales_return: round2(acc.sales_return + r.sales_return),
          discount_amount: round2(acc.discount_amount + r.discount_amount),
          net_sales: round2(acc.net_sales + r.net_sales),
        }),
        {
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          return_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
        }
      );

      return res.json({ success: true, reportType, data: merged, companySubtotals, totals });
    }

    // -----------------------------------------------------------------------
    // 2. YEARLY SALES REPORT & 3. MONTH-WISE SALES REPORT
    // -----------------------------------------------------------------------
    if (reportType === 'yearly-sales' || reportType === 'monthly-sales') {
      const periodExpr =
        reportType === 'yearly-sales' ? 'SUBSTR(s.invoice_date, 1, 4)' : 'SUBSTR(s.invoice_date, 1, 7)';
      const retPeriodExpr =
        reportType === 'yearly-sales' ? 'SUBSTR(sr.return_date, 1, 4)' : 'SUBSTR(sr.return_date, 1, 7)';
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      let qtyByPeriod = new Map<string, { sale_qty: number; bonus_qty: number }>();
      let rows: Array<Record<string, unknown>> = [];

      if (hasItemScopeFilter) {
        rows = db
          .prepare(`
            SELECT
              ${periodExpr} AS period_key,
              COUNT(DISTINCT s.id) AS invoice_count,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty,
              ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_sales,
              ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS total_discount,
              ROUND(SUM(COALESCE(si.tax_amount, 0)), 2) AS total_tax,
              ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS net_sales,
              ROUND(SUM(
                CASE WHEN s.net_total > 0 THEN COALESCE(si.line_total, 0) * (COALESCE(s.paid_amount, 0) / s.net_total) ELSE 0 END
              ), 2) AS received_amount
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN items i ON si.item_id = i.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where} ${itemScope.clause}
            GROUP BY period_key
            ORDER BY period_key DESC
          `)
          .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;
      } else {
        rows = db
          .prepare(`
            SELECT
              ${periodExpr} AS period_key,
              COUNT(s.id) AS invoice_count,
              ROUND(SUM(s.gross_total), 2) AS gross_sales,
              ROUND(SUM(s.discount_amount), 2) AS total_discount,
              ROUND(SUM(s.tax_amount), 2) AS total_tax,
              ROUND(SUM(s.net_total), 2) AS net_sales,
              ROUND(SUM(s.paid_amount), 2) AS received_amount,
              ROUND(SUM(s.net_total - s.paid_amount), 2) AS outstanding_balance
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY period_key
            ORDER BY period_key DESC
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const qtyRows = db
          .prepare(`
            SELECT
              ${periodExpr} AS period_key,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY period_key
          `)
          .all(...params) as Array<Record<string, unknown>>;
        qtyByPeriod = new Map(
          qtyRows.map((q) => [
            String(q.period_key),
            { sale_qty: round2(q.sale_qty), bonus_qty: round2(q.bonus_qty) },
          ])
        );
      }

      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND sr.customer_account_id = ? ';
        retParams.push(Number(customerId));
      }

      const retRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT ${retPeriodExpr} AS period_key, ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return
              FROM sale_return_items sri
              JOIN sale_returns sr ON sri.sale_return_id = sr.id
              LEFT JOIN items i ON sri.item_id = i.id
              ${retWhere} ${retScope.clause}
              GROUP BY period_key
            `)
            .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT ${retPeriodExpr} AS period_key, ROUND(SUM(COALESCE(sr.total_refund_amount, 0)), 2) AS sales_return
              FROM sale_returns sr
              ${retWhere}
              GROUP BY period_key
            `)
            .all(...retParams) as Array<Record<string, unknown>>);

      const retByPeriod = new Map(retRows.map((r) => [String(r.period_key), round2(r.sales_return)]));

      const enriched = rows.map((r) => {
        const key = String(r.period_key || '');
        const qty = hasItemScopeFilter
          ? { sale_qty: round2(r.sale_qty), bonus_qty: round2(r.bonus_qty) }
          : qtyByPeriod.get(key) || { sale_qty: 0, bonus_qty: 0 };
        const salesReturn = retByPeriod.get(key) || 0;
        const gross = round2(r.gross_sales);
        const disc = round2(r.total_discount);
        const netRaw = round2(r.net_sales);
        const netAfterReturn = round2(netRaw - salesReturn);
        const received = round2(r.received_amount);
        const outstanding = round2(Math.max(0, netRaw - received));
        return {
          ...(reportType === 'yearly-sales' ? { sale_year: key } : { sale_month: key }),
          invoice_count: Number(r.invoice_count || 0),
          sale_qty: qty.sale_qty,
          bonus_qty: qty.bonus_qty,
          gross_sales: gross,
          sales_return: salesReturn,
          total_discount: disc,
          discount_amount: disc,
          total_tax: round2(r.total_tax),
          net_sales: netAfterReturn,
          gross_net_sales: netRaw,
          received_amount: received,
          cash_collected: received,
          outstanding_balance: outstanding,
          credit_extended: outstanding,
        };
      });

      const totals = enriched.reduce(
        (acc, r) => ({
          invoice_count: acc.invoice_count + r.invoice_count,
          sale_qty: round2(acc.sale_qty + r.sale_qty),
          bonus_qty: round2(acc.bonus_qty + r.bonus_qty),
          gross_sales: round2(acc.gross_sales + r.gross_sales),
          sales_return: round2(acc.sales_return + r.sales_return),
          discount_amount: round2(acc.discount_amount + r.discount_amount),
          total_tax: round2(acc.total_tax + r.total_tax),
          net_sales: round2(acc.net_sales + r.net_sales),
          received_amount: round2(acc.received_amount + r.received_amount),
          outstanding_balance: round2(acc.outstanding_balance + r.outstanding_balance),
        }),
        {
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          total_tax: 0,
          net_sales: 0,
          received_amount: 0,
          outstanding_balance: 0,
        }
      );

      return res.json({ success: true, reportType, data: enriched, totals });
    }

    // -----------------------------------------------------------------------
    // 4. PARTY-WISE SALES REPORT (customer-wise-sales)
    // -----------------------------------------------------------------------
    if (reportType === 'customer-wise-sales') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      let partyRows: Array<Record<string, unknown>> = [];
      let qtyByParty = new Map<string, { sale_qty: number; bonus_qty: number }>();

      if (hasItemScopeFilter) {
        partyRows = db
          .prepare(`
            SELECT
              s.customer_account_id,
              COALESCE(a.account_code, 'WALK-IN') AS customer_code,
              s.customer_name,
              COALESCE(a.phone, '') AS customer_phone,
              COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
              COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
              COALESCE(NULLIF(TRIM(a.assigned_salesman_name), ''), MAX(NULLIF(TRIM(s.salesman), '')), 'Counter') AS salesman_name,
              s.customer_filer_status,
              COUNT(DISTINCT s.id) AS invoice_count,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty,
              ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_sales,
              ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS discount_amount,
              ROUND(SUM(COALESCE(si.tax_amount, 0)), 2) AS advance_tax_amount,
              ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS net_sales,
              ROUND(SUM(
                CASE WHEN s.net_total > 0 THEN COALESCE(si.line_total, 0) * (COALESCE(s.paid_amount, 0) / s.net_total) ELSE 0 END
              ), 2) AS paid_amount,
              ROUND(COALESCE(a.current_balance, 0), 2) AS current_ledger_balance,
              COALESCE(a.current_balance_type, 'Debit') AS current_balance_type
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN items i ON si.item_id = i.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where} ${itemScope.clause}
            GROUP BY s.customer_account_id, s.customer_name
            ORDER BY net_sales DESC
          `)
          .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;
      } else {
        partyRows = db
          .prepare(`
            SELECT
              s.customer_account_id,
              COALESCE(a.account_code, 'WALK-IN') AS customer_code,
              s.customer_name,
              COALESCE(a.phone, '') AS customer_phone,
              COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
              COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
              COALESCE(NULLIF(TRIM(a.assigned_salesman_name), ''), MAX(NULLIF(TRIM(s.salesman), '')), 'Counter') AS salesman_name,
              s.customer_filer_status,
              COUNT(s.id) AS invoice_count,
              ROUND(SUM(s.gross_total), 2) AS gross_sales,
              ROUND(SUM(s.discount_amount), 2) AS discount_amount,
              ROUND(SUM(s.advance_tax_amount), 2) AS advance_tax_amount,
              ROUND(SUM(s.net_total), 2) AS net_sales,
              ROUND(SUM(s.paid_amount), 2) AS paid_amount,
              ROUND(COALESCE(a.current_balance, 0), 2) AS current_ledger_balance,
              COALESCE(a.current_balance_type, 'Debit') AS current_balance_type
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY s.customer_account_id, s.customer_name
            ORDER BY net_sales DESC
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const qtyRows = db
          .prepare(`
            SELECT
              COALESCE(CAST(s.customer_account_id AS TEXT), s.customer_name) AS pkey,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY pkey
          `)
          .all(...params) as Array<Record<string, unknown>>;
        qtyByParty = new Map(
          qtyRows.map((q) => [
            String(q.pkey),
            { sale_qty: round2(q.sale_qty), bonus_qty: round2(q.bonus_qty) },
          ])
        );
      }

      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND sr.customer_account_id = ? ';
        retParams.push(Number(customerId));
      }

      const retRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) AS pkey, ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return
              FROM sale_return_items sri
              JOIN sale_returns sr ON sri.sale_return_id = sr.id
              LEFT JOIN items i ON sri.item_id = i.id
              ${retWhere} ${retScope.clause}
              GROUP BY pkey
            `)
            .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) AS pkey, ROUND(SUM(COALESCE(sr.total_refund_amount, 0)), 2) AS sales_return
              FROM sale_returns sr
              ${retWhere}
              GROUP BY pkey
            `)
            .all(...retParams) as Array<Record<string, unknown>>);

      const retMap = new Map(retRows.map((r) => [String(r.pkey), round2(r.sales_return)]));

      const enriched = partyRows.map((r) => {
        const pkey = r.customer_account_id ? String(r.customer_account_id) : String(r.customer_name);
        const qty = hasItemScopeFilter
          ? { sale_qty: round2(r.sale_qty), bonus_qty: round2(r.bonus_qty) }
          : qtyByParty.get(pkey) || { sale_qty: 0, bonus_qty: 0 };
        const salesReturn = retMap.get(pkey) || 0;
        const netRaw = round2(r.net_sales);
        const netAfterRet = round2(netRaw - salesReturn);
        const paid = round2(r.paid_amount);
        return {
          ...r,
          party_code: String(r.customer_code || ''),
          party_name: String(r.customer_name || ''),
          sale_qty: qty.sale_qty,
          bonus_qty: qty.bonus_qty,
          sales_return: salesReturn,
          net_sales: netAfterRet,
          received_amount: paid,
          outstanding_balance: round2(r.current_ledger_balance),
        };
      });

      const totals = enriched.reduce(
        (acc, r: any) => ({
          invoice_count: acc.invoice_count + Number(r.invoice_count || 0),
          sale_qty: round2(acc.sale_qty + Number(r.sale_qty || 0)),
          bonus_qty: round2(acc.bonus_qty + Number(r.bonus_qty || 0)),
          gross_sales: round2(acc.gross_sales + Number(r.gross_sales || 0)),
          sales_return: round2(acc.sales_return + Number(r.sales_return || 0)),
          discount_amount: round2(acc.discount_amount + Number(r.discount_amount || 0)),
          net_sales: round2(acc.net_sales + Number(r.net_sales || 0)),
          received_amount: round2(acc.received_amount + Number(r.received_amount || 0)),
          outstanding_balance: round2(acc.outstanding_balance + Number(r.outstanding_balance || 0)),
        }),
        {
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
          received_amount: 0,
          outstanding_balance: 0,
        }
      );

      return res.json({ success: true, reportType, data: enriched, totals });
    }

    // -----------------------------------------------------------------------
    // 5. PARTY-WISE MONTHLY SALES REPORT
    // -----------------------------------------------------------------------
    if (reportType === 'party-monthly-sales') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      let rows: Array<Record<string, unknown>> = [];
      let qtyMap = new Map<string, { sale_qty: number; bonus_qty: number }>();

      if (hasItemScopeFilter) {
        rows = db
          .prepare(`
            SELECT
              s.customer_account_id,
              COALESCE(a.account_code, 'WALK-IN') AS party_code,
              s.customer_name AS party_name,
              COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
              COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
              COALESCE(NULLIF(TRIM(a.assigned_salesman_name), ''), MAX(NULLIF(TRIM(s.salesman), '')), 'Counter') AS salesman_name,
              SUBSTR(s.invoice_date, 1, 7) AS sale_month,
              COUNT(DISTINCT s.id) AS invoice_count,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty,
              ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_sales,
              ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS discount_amount,
              ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS net_sales,
              ROUND(SUM(
                CASE WHEN s.net_total > 0 THEN COALESCE(si.line_total, 0) * (COALESCE(s.paid_amount, 0) / s.net_total) ELSE 0 END
              ), 2) AS received_amount,
              ROUND(COALESCE(a.current_balance, 0), 2) AS outstanding_balance
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN items i ON si.item_id = i.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where} ${itemScope.clause}
            GROUP BY s.customer_account_id, s.customer_name, sale_month
            ORDER BY party_name ASC, sale_month DESC
          `)
          .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;
      } else {
        rows = db
          .prepare(`
            SELECT
              s.customer_account_id,
              COALESCE(a.account_code, 'WALK-IN') AS party_code,
              s.customer_name AS party_name,
              COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
              COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
              COALESCE(NULLIF(TRIM(a.assigned_salesman_name), ''), MAX(NULLIF(TRIM(s.salesman), '')), 'Counter') AS salesman_name,
              SUBSTR(s.invoice_date, 1, 7) AS sale_month,
              COUNT(s.id) AS invoice_count,
              ROUND(SUM(s.gross_total), 2) AS gross_sales,
              ROUND(SUM(s.discount_amount), 2) AS discount_amount,
              ROUND(SUM(s.net_total), 2) AS net_sales,
              ROUND(SUM(s.paid_amount), 2) AS received_amount,
              ROUND(COALESCE(a.current_balance, 0), 2) AS outstanding_balance
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY s.customer_account_id, s.customer_name, sale_month
            ORDER BY party_name ASC, sale_month DESC
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const qtyRows = db
          .prepare(`
            SELECT
              COALESCE(CAST(s.customer_account_id AS TEXT), s.customer_name) || '::' || SUBSTR(s.invoice_date, 1, 7) AS pm_key,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            ${where}
            GROUP BY pm_key
          `)
          .all(...params) as Array<Record<string, unknown>>;
        qtyMap = new Map(
          qtyRows.map((q) => [String(q.pm_key), { sale_qty: round2(q.sale_qty), bonus_qty: round2(q.bonus_qty) }])
        );
      }

      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND sr.customer_account_id = ? ';
        retParams.push(Number(customerId));
      }

      const retRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT
                COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) || '::' || SUBSTR(sr.return_date, 1, 7) AS pm_key,
                ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return
              FROM sale_return_items sri
              JOIN sale_returns sr ON sri.sale_return_id = sr.id
              LEFT JOIN items i ON sri.item_id = i.id
              ${retWhere} ${retScope.clause}
              GROUP BY pm_key
            `)
            .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT
                COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) || '::' || SUBSTR(sr.return_date, 1, 7) AS pm_key,
                ROUND(SUM(COALESCE(sr.total_refund_amount, 0)), 2) AS sales_return
              FROM sale_returns sr
              ${retWhere}
              GROUP BY pm_key
            `)
            .all(...retParams) as Array<Record<string, unknown>>);

      const retMap = new Map(retRows.map((r) => [String(r.pm_key), round2(r.sales_return)]));

      const enriched = rows.map((r) => {
        const pmKey = `${r.customer_account_id ? String(r.customer_account_id) : String(r.party_name)}::${r.sale_month}`;
        const qty = hasItemScopeFilter
          ? { sale_qty: round2(r.sale_qty), bonus_qty: round2(r.bonus_qty) }
          : qtyMap.get(pmKey) || { sale_qty: 0, bonus_qty: 0 };
        const salesReturn = retMap.get(pmKey) || 0;
        const netAfterRet = round2(Number(r.net_sales || 0) - salesReturn);
        return {
          ...r,
          sale_qty: qty.sale_qty,
          bonus_qty: qty.bonus_qty,
          sales_return: salesReturn,
          net_sales: netAfterRet,
          received_amount: round2(r.received_amount),
          outstanding_balance: round2(r.outstanding_balance),
        };
      });

      const partySubtotalsMap = new Map<string, Record<string, any>>();
      for (const r of enriched as any[]) {
        const pKey = String(r.party_name || 'Walk-in');
        const cur = partySubtotalsMap.get(pKey) || {
          party_code: r.party_code,
          party_name: pKey,
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
          received_amount: 0,
        };
        cur.invoice_count += Number(r.invoice_count || 0);
        cur.sale_qty = round2(cur.sale_qty + Number(r.sale_qty || 0));
        cur.bonus_qty = round2(cur.bonus_qty + Number(r.bonus_qty || 0));
        cur.gross_sales = round2(cur.gross_sales + Number(r.gross_sales || 0));
        cur.sales_return = round2(cur.sales_return + Number(r.sales_return || 0));
        cur.discount_amount = round2(cur.discount_amount + Number(r.discount_amount || 0));
        cur.net_sales = round2(cur.net_sales + Number(r.net_sales || 0));
        cur.received_amount = round2(cur.received_amount + Number(r.received_amount || 0));
        partySubtotalsMap.set(pKey, cur);
      }

      const totals = enriched.reduce(
        (acc, r: any) => ({
          invoice_count: acc.invoice_count + Number(r.invoice_count || 0),
          sale_qty: round2(acc.sale_qty + Number(r.sale_qty || 0)),
          bonus_qty: round2(acc.bonus_qty + Number(r.bonus_qty || 0)),
          gross_sales: round2(acc.gross_sales + Number(r.gross_sales || 0)),
          sales_return: round2(acc.sales_return + Number(r.sales_return || 0)),
          discount_amount: round2(acc.discount_amount + Number(r.discount_amount || 0)),
          net_sales: round2(acc.net_sales + Number(r.net_sales || 0)),
          received_amount: round2(acc.received_amount + Number(r.received_amount || 0)),
        }),
        {
          invoice_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
          received_amount: 0,
        }
      );

      return res.json({
        success: true,
        reportType,
        data: enriched,
        partySubtotals: Array.from(partySubtotalsMap.values()),
        totals,
      });
    }

    // -----------------------------------------------------------------------
    // 6. YEARLY PARTY COMPARISON
    // -----------------------------------------------------------------------
    if (reportType === 'yearly-party-comparison') {
      const currentYear = new Date().getFullYear();
      const year2 = req.query.year2 ? String(req.query.year2).trim() : String(currentYear);
      const year1 = req.query.year1 ? String(req.query.year1).trim() : String(Number(year2) - 1);
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      let baseWhere = " WHERE s.status = 'completed' AND SUBSTR(s.invoice_date, 1, 4) IN (?, ?) ";
      const baseParams: Array<string | number> = [year1, year2];
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        baseWhere += ' AND s.customer_account_id = ? ';
        baseParams.push(Number(customerId));
      }
      if (townName && townName.toUpperCase() !== 'ALL') {
        baseWhere += " AND COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '') = ? ";
        baseParams.push(townName);
      }

      const rawRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT
                COALESCE(CAST(s.customer_account_id AS TEXT), s.customer_name) AS pkey,
                s.customer_account_id,
                COALESCE(a.account_code, 'WALK-IN') AS party_code,
                s.customer_name AS party_name,
                COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
                COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
                SUBSTR(s.invoice_date, 1, 4) AS yr,
                COUNT(DISTINCT s.id) AS invoice_count,
                ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
                ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS net_sales
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              LEFT JOIN items i ON si.item_id = i.id
              LEFT JOIN accounts a ON s.customer_account_id = a.id
              ${baseWhere} ${itemScope.clause}
              GROUP BY pkey, yr
            `)
            .all(...baseParams, ...itemScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT
                COALESCE(CAST(s.customer_account_id AS TEXT), s.customer_name) AS pkey,
                s.customer_account_id,
                COALESCE(a.account_code, 'WALK-IN') AS party_code,
                s.customer_name AS party_name,
                COALESCE(NULLIF(TRIM(s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '—') AS town_name,
                COALESCE(NULLIF(TRIM(s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '—') AS area_name,
                SUBSTR(s.invoice_date, 1, 4) AS yr,
                COUNT(s.id) AS invoice_count,
                0 AS sale_qty,
                ROUND(SUM(s.net_total), 2) AS net_sales
              FROM sales s
              LEFT JOIN accounts a ON s.customer_account_id = a.id
              ${baseWhere}
              GROUP BY pkey, yr
            `)
            .all(...baseParams) as Array<Record<string, unknown>>);

      const qtyYearRows = hasItemScopeFilter
        ? []
        : (db
            .prepare(`
              SELECT
                COALESCE(CAST(s.customer_account_id AS TEXT), s.customer_name) AS pkey,
                SUBSTR(s.invoice_date, 1, 4) AS yr,
                ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              LEFT JOIN accounts a ON s.customer_account_id = a.id
              ${baseWhere}
              GROUP BY pkey, yr
            `)
            .all(...baseParams) as Array<Record<string, unknown>>);
      const qtyYearMap = new Map(qtyYearRows.map((q) => [`${q.pkey}::${q.yr}`, round2(q.sale_qty)]));

      // Subtract returns for accurate net comparison
      const retCompRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT
                COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) AS pkey,
                SUBSTR(sr.return_date, 1, 4) AS yr,
                ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS ret_amt
              FROM sale_return_items sri
              JOIN sale_returns sr ON sri.sale_return_id = sr.id
              LEFT JOIN items i ON sri.item_id = i.id
              WHERE sr.status = 'completed' AND SUBSTR(sr.return_date, 1, 4) IN (?, ?) ${retScope.clause}
              GROUP BY pkey, yr
            `)
            .all(year1, year2, ...retScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT
                COALESCE(CAST(sr.customer_account_id AS TEXT), sr.customer_name) AS pkey,
                SUBSTR(sr.return_date, 1, 4) AS yr,
                ROUND(SUM(COALESCE(sr.total_refund_amount, 0)), 2) AS ret_amt
              FROM sale_returns sr
              WHERE sr.status = 'completed' AND SUBSTR(sr.return_date, 1, 4) IN (?, ?)
              GROUP BY pkey, yr
            `)
            .all(year1, year2) as Array<Record<string, unknown>>);
      const retCompMap = new Map(retCompRows.map((r) => [`${r.pkey}::${r.yr}`, round2(r.ret_amt)]));

      const partyCompMap = new Map<string, any>();
      for (const r of rawRows) {
        const pkey = String(r.pkey);
        if (!partyCompMap.has(pkey)) {
          partyCompMap.set(pkey, {
            customer_account_id: r.customer_account_id,
            party_code: String(r.party_code || ''),
            party_name: String(r.party_name || ''),
            town_name: String(r.town_name || '—'),
            area_name: String(r.area_name || '—'),
            year1,
            year2,
            year1_invoices: 0,
            year1_qty: 0,
            year1_net_sales: 0,
            year2_invoices: 0,
            year2_qty: 0,
            year2_net_sales: 0,
          });
        }
        const entry = partyCompMap.get(pkey);
        const yr = String(r.yr);
        const qty = hasItemScopeFilter ? round2(r.sale_qty) : qtyYearMap.get(`${pkey}::${yr}`) || 0;
        const retAmt = retCompMap.get(`${pkey}::${yr}`) || 0;
        const net = round2(Number(r.net_sales || 0) - retAmt);
        if (yr === year1) {
          entry.year1_invoices = Number(r.invoice_count || 0);
          entry.year1_qty = qty;
          entry.year1_net_sales = net;
        } else if (yr === year2) {
          entry.year2_invoices = Number(r.invoice_count || 0);
          entry.year2_qty = qty;
          entry.year2_net_sales = net;
        }
      }

      const comparisonRows = Array.from(partyCompMap.values())
        .map((c) => {
          const diffAmt = round2(c.year2_net_sales - c.year1_net_sales);
          const diffQty = round2(c.year2_qty - c.year1_qty);
          const growthPct =
            c.year1_net_sales > 0
              ? round2((diffAmt / c.year1_net_sales) * 100)
              : c.year2_net_sales > 0
              ? 100
              : 0;
          return {
            ...c,
            variance_qty: diffQty,
            variance_amount: diffAmt,
            growth_percent: growthPct,
          };
        })
        .sort((a, b) => b.year2_net_sales - a.year2_net_sales);

      const totals = comparisonRows.reduce(
        (acc, r) => ({
          year1_qty: round2(acc.year1_qty + r.year1_qty),
          year1_net_sales: round2(acc.year1_net_sales + r.year1_net_sales),
          year2_qty: round2(acc.year2_qty + r.year2_qty),
          year2_net_sales: round2(acc.year2_net_sales + r.year2_net_sales),
          variance_qty: round2(acc.variance_qty + r.variance_qty),
          variance_amount: round2(acc.variance_amount + r.variance_amount),
        }),
        {
          year1_qty: 0,
          year1_net_sales: 0,
          year2_qty: 0,
          year2_net_sales: 0,
          variance_qty: 0,
          variance_amount: 0,
        }
      );

      return res.json({ success: true, reportType, year1, year2, data: comparisonRows, totals });
    }

    // -----------------------------------------------------------------------
    // 7. ITEM-WISE SALES REPORT (Enforces Compulsory Full Pack Rule, NO Loose Qty!)
    // -----------------------------------------------------------------------
    if (reportType === 'item-wise-sales') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      const saleRows = db
        .prepare(`
          SELECT
            si.item_id,
            COALESCE(NULLIF(TRIM(i.item_code), ''), si.item_code) AS item_code,
            COALESCE(NULLIF(TRIM(i.item_name), ''), si.item_name) AS item_name,
            COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(si.company_name), ''), 'General') AS company_name,
            COALESCE(NULLIF(TRIM(i.category), ''), 'General') AS item_group,
            COALESCE(NULLIF(TRIM(i.packing), ''), si.packing) AS packing,
            COUNT(DISTINCT s.id) AS invoice_count,
            ROUND(SUM(${fullPackSaleExpr}), 2) AS total_pack_qty,
            ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS total_bonus_qty,
            ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_amount,
            ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS discount_amount,
            ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS line_net_sales
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN items i ON si.item_id = i.id
          LEFT JOIN accounts a ON s.customer_account_id = a.id
          ${where} ${itemScope.clause}
          GROUP BY COALESCE(si.item_id, si.item_code)
          ORDER BY company_name ASC, line_net_sales DESC
        `)
        .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;

      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (partyIdsFilter.length > 0) {
        retWhere += ` AND COALESCE(sr.customer_account_id, orig_s.customer_account_id) IN (${partyIdsFilter.map(() => '?').join(',')}) `;
        retParams.push(...partyIdsFilter);
      } else if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND COALESCE(sr.customer_account_id, orig_s.customer_account_id) = ? ';
        retParams.push(Number(customerId));
      }
      if (salesmanId && salesmanId.toUpperCase() !== 'ALL') {
        retWhere += ' AND COALESCE(orig_s.salesman_id, a.assigned_salesman_id) = ? ';
        retParams.push(Number(salesmanId));
      }
      if (townName && townName.toUpperCase() !== 'ALL') {
        retWhere += " AND COALESCE(NULLIF(TRIM(orig_s.town_name), ''), NULLIF(TRIM(a.town_name), ''), NULLIF(TRIM(a.city), ''), '') = ? ";
        retParams.push(townName);
      }
      if (areaName && areaName.toUpperCase() !== 'ALL') {
        retWhere += " AND COALESCE(NULLIF(TRIM(orig_s.area_name), ''), NULLIF(TRIM(a.area_name), ''), '') = ? ";
        retParams.push(areaName);
      }

      const retRows = db
        .prepare(`
          SELECT
            sri.item_id,
            ROUND(SUM(${fullPackRetExpr}), 2) AS return_pack_qty,
            ROUND(SUM(COALESCE(sri.return_bonus_qty, 0)), 2) AS return_bonus_qty,
            ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return_amount
          FROM sale_return_items sri
          JOIN sale_returns sr ON sri.sale_return_id = sr.id
          LEFT JOIN sales orig_s ON sr.original_sale_id = orig_s.id
          LEFT JOIN items i ON sri.item_id = i.id
          LEFT JOIN accounts a ON COALESCE(sr.customer_account_id, orig_s.customer_account_id) = a.id
          ${retWhere} ${retScope.clause}
          GROUP BY sri.item_id
        `)
        .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>;

      const retByItem = new Map(
        retRows.map((r) => [
          Number(r.item_id),
          {
            return_pack_qty: round2(r.return_pack_qty),
            return_bonus_qty: round2(r.return_bonus_qty),
            sales_return_amount: round2(r.sales_return_amount),
          },
        ])
      );

      const enriched = saleRows.map((r) => {
        const ret = retByItem.get(Number(r.item_id)) || {
          return_pack_qty: 0,
          return_bonus_qty: 0,
          sales_return_amount: 0,
        };
        const netSales = round2(Number(r.line_net_sales || 0) - ret.sales_return_amount);
        return {
          ...r,
          sale_qty: round2(r.total_pack_qty),
          bonus_qty: round2(r.total_bonus_qty),
          return_qty: ret.return_pack_qty,
          sales_return: ret.sales_return_amount,
          net_sales_amount: netSales,
        };
      });

      const companySubtotalsMap = new Map<string, Record<string, number>>();
      for (const r of enriched as any[]) {
        const comp = String(r.company_name || 'General');
        const cur = companySubtotalsMap.get(comp) || {
          invoice_count: 0,
          total_pack_qty: 0,
          total_bonus_qty: 0,
          return_qty: 0,
          gross_amount: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales_amount: 0,
        };
        cur.invoice_count += Number(r.invoice_count || 0);
        cur.total_pack_qty = round2(cur.total_pack_qty + Number(r.total_pack_qty || 0));
        cur.total_bonus_qty = round2(cur.total_bonus_qty + Number(r.total_bonus_qty || 0));
        cur.return_qty = round2(cur.return_qty + Number(r.return_qty || 0));
        cur.gross_amount = round2(cur.gross_amount + Number(r.gross_amount || 0));
        cur.sales_return = round2(cur.sales_return + Number(r.sales_return || 0));
        cur.discount_amount = round2(cur.discount_amount + Number(r.discount_amount || 0));
        cur.net_sales_amount = round2(cur.net_sales_amount + Number(r.net_sales_amount || 0));
        companySubtotalsMap.set(comp, cur);
      }

      const totals = enriched.reduce(
        (acc, r: any) => ({
          invoice_count: acc.invoice_count + Number(r.invoice_count || 0),
          total_pack_qty: round2(acc.total_pack_qty + Number(r.total_pack_qty || 0)),
          total_bonus_qty: round2(acc.total_bonus_qty + Number(r.total_bonus_qty || 0)),
          return_qty: round2(acc.return_qty + Number(r.return_qty || 0)),
          gross_amount: round2(acc.gross_amount + Number(r.gross_amount || 0)),
          sales_return: round2(acc.sales_return + Number(r.sales_return || 0)),
          discount_amount: round2(acc.discount_amount + Number(r.discount_amount || 0)),
          net_sales_amount: round2(acc.net_sales_amount + Number(r.net_sales_amount || 0)),
        }),
        {
          invoice_count: 0,
          total_pack_qty: 0,
          total_bonus_qty: 0,
          return_qty: 0,
          gross_amount: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales_amount: 0,
        }
      );

      return res.json({
        success: true,
        reportType,
        data: enriched,
        companySubtotals: Array.from(companySubtotalsMap.entries()).map(([company_name, sub]) => ({
          company_name,
          ...sub,
        })),
        totals,
      });
    }

    // -----------------------------------------------------------------------
    // 8. SALESMAN-WISE SALES REPORT
    // -----------------------------------------------------------------------
    if (reportType === 'salesman-wise-sales') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const retScope = buildReturnScopeClause();

      let salRows: Array<Record<string, unknown>> = [];
      let qtyBySalesman = new Map<string, { sale_qty: number; bonus_qty: number }>();

      if (hasItemScopeFilter) {
        salRows = db
          .prepare(`
            SELECT
              COALESCE(s.salesman_id, 0) AS salesman_id,
              COALESCE(sal.salesman_code, 'COUNTER') AS salesman_code,
              COALESCE(NULLIF(TRIM(sal.full_name), ''), NULLIF(TRIM(sal.name), ''), NULLIF(TRIM(s.salesman), ''), 'Counter Sales') AS salesman_name,
              COUNT(DISTINCT s.id) AS invoice_count,
              COUNT(DISTINCT s.customer_account_id) AS party_count,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty,
              ROUND(SUM(COALESCE(si.gross_amount, 0)), 2) AS gross_sales,
              ROUND(SUM(COALESCE(si.discount_amount, 0)), 2) AS discount_amount,
              ROUND(SUM(COALESCE(si.line_total, 0)), 2) AS net_sales,
              ROUND(SUM(
                CASE WHEN s.net_total > 0 THEN COALESCE(si.line_total, 0) * (COALESCE(s.paid_amount, 0) / s.net_total) ELSE 0 END
              ), 2) AS received_amount
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN items i ON si.item_id = i.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            LEFT JOIN salesmen sal ON s.salesman_id = sal.id
            ${where} ${itemScope.clause}
            GROUP BY salesman_id, salesman_name
            ORDER BY net_sales DESC
          `)
          .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;
      } else {
        salRows = db
          .prepare(`
            SELECT
              COALESCE(s.salesman_id, 0) AS salesman_id,
              COALESCE(sal.salesman_code, 'COUNTER') AS salesman_code,
              COALESCE(NULLIF(TRIM(sal.full_name), ''), NULLIF(TRIM(sal.name), ''), NULLIF(TRIM(s.salesman), ''), 'Counter Sales') AS salesman_name,
              COUNT(s.id) AS invoice_count,
              COUNT(DISTINCT s.customer_account_id) AS party_count,
              ROUND(SUM(s.gross_total), 2) AS gross_sales,
              ROUND(SUM(s.discount_amount), 2) AS discount_amount,
              ROUND(SUM(s.net_total), 2) AS net_sales,
              ROUND(SUM(s.paid_amount), 2) AS received_amount,
              ROUND(SUM(s.net_total - s.paid_amount), 2) AS outstanding_balance
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            LEFT JOIN salesmen sal ON s.salesman_id = sal.id
            ${where}
            GROUP BY salesman_id, salesman_name
            ORDER BY net_sales DESC
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const qtyRows = db
          .prepare(`
            SELECT
              COALESCE(s.salesman_id, 0) || '::' || COALESCE(NULLIF(TRIM(sal.full_name), ''), NULLIF(TRIM(sal.name), ''), NULLIF(TRIM(s.salesman), ''), 'Counter Sales') AS skey,
              ROUND(SUM(${fullPackSaleExpr}), 2) AS sale_qty,
              ROUND(SUM(COALESCE(si.bonus_quantity, 0)), 2) AS bonus_qty
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            LEFT JOIN salesmen sal ON s.salesman_id = sal.id
            ${where}
            GROUP BY skey
          `)
          .all(...params) as Array<Record<string, unknown>>;
        qtyBySalesman = new Map(
          qtyRows.map((q) => [String(q.skey), { sale_qty: round2(q.sale_qty), bonus_qty: round2(q.bonus_qty) }])
        );
      }

      // Link returns back to original invoice salesman
      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (salesmanId && salesmanId.toUpperCase() !== 'ALL') {
        retWhere += ' AND orig.salesman_id = ? ';
        retParams.push(Number(salesmanId));
      }

      const retRows = hasItemScopeFilter
        ? (db
            .prepare(`
              SELECT
                COALESCE(orig.salesman_id, 0) || '::' || COALESCE(NULLIF(TRIM(sal.full_name), ''), NULLIF(TRIM(sal.name), ''), NULLIF(TRIM(orig.salesman), ''), 'Counter Sales') AS skey,
                ROUND(SUM(COALESCE(sri.line_total, 0)), 2) AS sales_return
              FROM sale_return_items sri
              JOIN sale_returns sr ON sri.sale_return_id = sr.id
              LEFT JOIN sales orig ON sr.original_sale_id = orig.id
              LEFT JOIN salesmen sal ON orig.salesman_id = sal.id
              LEFT JOIN items i ON sri.item_id = i.id
              ${retWhere} ${retScope.clause}
              GROUP BY skey
            `)
            .all(...retParams, ...retScope.params) as Array<Record<string, unknown>>)
        : (db
            .prepare(`
              SELECT
                COALESCE(orig.salesman_id, 0) || '::' || COALESCE(NULLIF(TRIM(sal.full_name), ''), NULLIF(TRIM(sal.name), ''), NULLIF(TRIM(orig.salesman), ''), 'Counter Sales') AS skey,
                ROUND(SUM(COALESCE(sr.total_refund_amount, 0)), 2) AS sales_return
              FROM sale_returns sr
              LEFT JOIN sales orig ON sr.original_sale_id = orig.id
              LEFT JOIN salesmen sal ON orig.salesman_id = sal.id
              ${retWhere}
              GROUP BY skey
            `)
            .all(...retParams) as Array<Record<string, unknown>>);
      const retBySalesman = new Map(retRows.map((r) => [String(r.skey), round2(r.sales_return)]));

      const enriched: Array<Record<string, any>> = salRows.map((r) => {
        const skey = `${r.salesman_id}::${r.salesman_name}`;
        const qty = hasItemScopeFilter
          ? { sale_qty: round2(r.sale_qty), bonus_qty: round2(r.bonus_qty) }
          : qtyBySalesman.get(skey) || { sale_qty: 0, bonus_qty: 0 };
        const salesReturn = retBySalesman.get(skey) || 0;
        const netRaw = round2(r.net_sales);
        const netAfterRet = round2(netRaw - salesReturn);
        const received = round2(r.received_amount);
        const outstanding = hasItemScopeFilter
          ? round2(Math.max(0, netRaw - received))
          : round2(Math.max(0, Number(r.outstanding_balance || 0)));
        return {
          ...r,
          sale_qty: qty.sale_qty,
          bonus_qty: qty.bonus_qty,
          sales_return: salesReturn,
          net_sales: netAfterRet,
          received_amount: received,
          outstanding_balance: outstanding,
        };
      });

      const totals = enriched.reduce(
        (acc, r) => ({
          invoice_count: acc.invoice_count + Number(r.invoice_count || 0),
          party_count: acc.party_count + Number(r.party_count || 0),
          sale_qty: round2(acc.sale_qty + Number(r.sale_qty || 0)),
          bonus_qty: round2(acc.bonus_qty + Number(r.bonus_qty || 0)),
          gross_sales: round2(acc.gross_sales + Number(r.gross_sales || 0)),
          sales_return: round2(acc.sales_return + Number(r.sales_return || 0)),
          discount_amount: round2(acc.discount_amount + Number(r.discount_amount || 0)),
          net_sales: round2(acc.net_sales + Number(r.net_sales || 0)),
          received_amount: round2(acc.received_amount + Number(r.received_amount || 0)),
          outstanding_balance: round2(acc.outstanding_balance + Number(r.outstanding_balance || 0)),
        }),
        {
          invoice_count: 0,
          party_count: 0,
          sale_qty: 0,
          bonus_qty: 0,
          gross_sales: 0,
          sales_return: 0,
          discount_amount: 0,
          net_sales: 0,
          received_amount: 0,
          outstanding_balance: 0,
        }
      );

      return res.json({ success: true, reportType, data: enriched, totals });
    }

    // -----------------------------------------------------------------------
    // EXISTING REPORTS (Preserved & Full Pack Standardized)
    // -----------------------------------------------------------------------
    if (reportType === 'daily-sales') {
      const rows = db
        .prepare(`
          SELECT
            s.invoice_date as sale_date,
            COUNT(s.id) as invoice_count,
            ROUND(SUM(s.gross_total), 2) as gross_sales,
            ROUND(SUM(s.discount_amount), 2) as total_discount,
            ROUND(SUM(s.tax_amount), 2) as total_tax,
            ROUND(SUM(s.net_total), 2) as net_sales,
            ROUND(SUM(s.paid_amount), 2) as cash_collected,
            ROUND(SUM(s.net_total - s.paid_amount), 2) as credit_extended
          FROM sales s
          ${dateFilterSales}
          GROUP BY s.invoice_date
          ORDER BY s.invoice_date DESC
        `)
        .all(...salesParams);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'profit-report') {
      const { where, params } = buildSalesHeaderFilter();
      const itemScope = buildItemScopeClause();
      const rows = db
        .prepare(`
          SELECT
            si.item_code,
            si.item_name,
            COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(si.company_name), ''), 'General') as company_name,
            si.packing,
            ROUND(SUM((si.total_units - si.returned_total_units) / CASE WHEN COALESCE(si.units_per_pack, 1) > 0 THEN si.units_per_pack ELSE 1 END), 2) as net_packs_sold,
            ROUND(SUM((si.total_units - si.returned_total_units) * si.cost_price_per_unit), 2) as total_cost_amount,
            ROUND(SUM(
              CASE
                WHEN si.total_units > 0
                THEN si.taxable_amount * ((si.total_units - si.returned_total_units) / si.total_units)
                ELSE 0
              END
            ), 2) as net_revenue_amount
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN items i ON si.item_id = i.id
          LEFT JOIN accounts a ON s.customer_account_id = a.id
          ${where} ${itemScope.clause}
          GROUP BY si.item_id, si.item_code, si.item_name, company_name, si.packing
          ORDER BY net_revenue_amount DESC
        `)
        .all(...params, ...itemScope.params) as Array<Record<string, unknown>>;

      const enriched = rows.map((r) => {
        const rev = round2(r.net_revenue_amount);
        const cost = round2(r.total_cost_amount);
        const profit = round2(rev - cost);
        const marginPercent = rev > 0 ? round2((profit / rev) * 100) : 0;
        return {
          ...r,
          net_units_sold: round2(r.net_packs_sold),
          gross_profit: profit,
          profit_margin_percent: marginPercent,
        };
      });

      return res.json({ success: true, reportType, data: enriched });
    }

    if (reportType === 'discount-report') {
      const rows = db
        .prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.invoice_date,
            s.customer_name,
            s.invoice_type,
            s.salesman,
            s.gross_total,
            s.item_discount_amount,
            s.invoice_discount_percent,
            s.invoice_discount_amount,
            s.discount_amount as total_discount,
            s.discount_override_by,
            s.discount_override_reason,
            s.net_total
          FROM sales s
          ${dateFilterSales}
          AND s.discount_amount > 0
          ORDER BY s.invoice_date DESC, s.id DESC
        `)
        .all(...salesParams);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'sales-return-report') {
      let retWhere = " WHERE sr.status = 'completed' ";
      const retParams: Array<string | number> = [];
      if (startDate) {
        retWhere += ' AND sr.return_date >= ? ';
        retParams.push(startDate);
      }
      if (endDate) {
        retWhere += ' AND sr.return_date <= ? ';
        retParams.push(endDate);
      }
      if (customerId && customerId.toUpperCase() !== 'ALL') {
        retWhere += ' AND sr.customer_account_id = ? ';
        retParams.push(Number(customerId));
      }

      const rows = db
        .prepare(`
          SELECT
            sr.return_number,
            sr.return_date,
            sr.original_invoice_number,
            sr.customer_name,
            sr.refund_mode,
            sri.item_code,
            sri.item_name,
            COALESCE(NULLIF(TRIM(i.company_name), ''), NULLIF(TRIM(sri.company_name), ''), 'General') as company_name,
            sri.batch_number,
            ROUND(${fullPackRetExpr}, 2) as return_pack_qty,
            ROUND(COALESCE(sri.return_bonus_qty, 0), 2) as return_bonus_qty,
            sri.line_total,
            sr.return_reason
          FROM sale_return_items sri
          JOIN sale_returns sr ON sri.sale_return_id = sr.id
          LEFT JOIN items i ON sri.item_id = i.id
          ${retWhere}
          ORDER BY sr.return_date DESC, sr.id DESC
        `)
        .all(...retParams);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'tax-summary') {
      const salesTax = db
        .prepare(`
          SELECT
            COUNT(s.id) as sales_invoice_count,
            COALESCE(SUM(s.taxable_amount), 0) as sales_taxable_amount,
            COALESCE(SUM(s.gst_amount), 0) as sales_gst_collected,
            COALESCE(SUM(s.advance_tax_amount), 0) as sales_advance_tax_collected
          FROM sales s
          ${dateFilterSales}
        `)
        .get(...salesParams) as Record<string, number>;

      const purchaseTax = db
        .prepare(`
          SELECT
            COUNT(p.id) as purchase_invoice_count,
            COALESCE(SUM(p.taxable_amount), 0) as purchase_taxable_amount,
            COALESCE(SUM(p.gst_amount), 0) as purchase_gst_paid,
            COALESCE(SUM(p.advance_tax_amount), 0) as purchase_advance_tax_paid
          FROM purchases p
          WHERE p.status = 'completed'
        `)
        .get() as Record<string, number>;

      const settings = db.prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1').get();
      const history = db.prepare('SELECT * FROM advance_tax_history ORDER BY id DESC LIMIT 50').all();

      return res.json({
        success: true,
        reportType,
        data: {
          salesTax: {
            invoiceCount: Number(salesTax?.sales_invoice_count || 0),
            taxableAmount: round2(salesTax?.sales_taxable_amount),
            gstCollected: round2(salesTax?.sales_gst_collected),
            advanceTaxCollected: round2(salesTax?.sales_advance_tax_collected),
          },
          purchaseTax: {
            invoiceCount: Number(purchaseTax?.purchase_invoice_count || 0),
            taxableAmount: round2(purchaseTax?.purchase_taxable_amount),
            gstPaid: round2(purchaseTax?.purchase_gst_paid),
            advanceTaxPaid: round2(purchaseTax?.purchase_advance_tax_paid),
          },
          settings,
          history,
        },
      });
    }

    res.status(400).json({ success: false, error: `Unknown report type: ${reportType}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});
