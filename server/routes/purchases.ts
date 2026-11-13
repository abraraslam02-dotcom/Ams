import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { triggerPreChangeBackupIfEnabled, logSystemError } from '../services/backupService.ts';
import {
  peekNextInvoiceNumber,
  allocateNextInvoiceNumber,
  bindInvoiceNumberRecordId,
} from '../services/invoiceSequenceService.ts';
import { recordBatchStockMovement } from '../services/fifoAndOfferEngine.ts';
import { assertPeriodOpen } from '../utils/periodLock.ts';

export const purchasesRouter = Router();

export function round2(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface ParsedPacking {
  packing: string;
  stripsPerBox: number;
  unitsPerStrip: number;
  unitsPerPack: number;
}

/**
 * Parses pharmaceutical packing strings such as "20x10", "10x10", "3x10", "1x1", "120ml"
 * into Box -> Strip -> Loose Unit conversion factors.
 */
export function parsePacking(packingStr?: string | null): ParsedPacking {
  const clean = (packingStr || '1x1').trim();
  const matrixMatch = clean.match(/(\d+)\s*[xX*×]\s*(\d+)/);
  if (matrixMatch) {
    const stripsPerBox = Math.max(1, parseInt(matrixMatch[1], 10) || 1);
    const unitsPerStrip = Math.max(1, parseInt(matrixMatch[2], 10) || 1);
    return {
      packing: clean,
      stripsPerBox,
      unitsPerStrip,
      unitsPerPack: stripsPerBox * unitsPerStrip,
    };
  }
  const singleNum = clean.match(/(\d+)\s*(tab|cap|sachet|amp|vial|strip|pack|unit|pc|pill|softgel|lozenge|'s|s\b)s?/i);
  if (singleNum) {
    const units = Math.max(1, parseInt(singleNum[1], 10) || 1);
    return {
      packing: clean,
      stripsPerBox: 1,
      unitsPerStrip: units,
      unitsPerPack: units,
    };
  }
  if (!/ml|mg|gm|g\b|kg|l\b|oz|drop|syr|susp|cream|oint|gel|lotion|inj|inf/i.test(clean)) {
    const plainNum = clean.match(/^(\d+)$/);
    if (plainNum) {
      const units = Math.max(1, parseInt(plainNum[1], 10) || 1);
      return {
        packing: clean,
        stripsPerBox: 1,
        unitsPerStrip: units,
        unitsPerPack: units,
      };
    }
  }
  return {
    packing: clean || '1x1',
    stripsPerBox: 1,
    unitsPerStrip: 1,
    unitsPerPack: 1,
  };
}

/**
 * Helper to look up core system account IDs by code
 */
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

/**
 * Helper to recalculate batch status based on quantity and expiry date
 */
function computeBatchStatus(packQty: number, expiryDate: string, minStock: number = 0): string {
  if (packQty <= 0) return 'out_of_stock';
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate && expiryDate < today) return 'expired';
  if (minStock > 0 && packQty <= minStock) return 'low_stock';
  return 'in_stock';
}

/**
 * GET /api/purchases/tax-settings
 * Fetch configurable Advance Tax settings and rate change audit history
 */
purchasesRouter.get('/tax-settings', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let settings = db
      .prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;

    if (!settings) {
      db.prepare(`
        INSERT INTO advance_tax_settings (
          tax_name, filer_rate, non_filer_rate, exempt_rate,
          calculation_basis, effective_from, status, tax_applicability, updated_by
        ) VALUES ('Advance Tax u/s 236H', 0.5, 2.5, 0.0, 'taxable_plus_gst', '2026-01-01', 'Active', 'All Taxable Purchases', 'Administrator')
      `).run();
      settings = db.prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1').get() as Record<
        string,
        unknown
      >;
    }

    const history = db
      .prepare('SELECT * FROM advance_tax_history ORDER BY id DESC LIMIT 100')
      .all();

    return res.json({
      success: true,
      settings,
      history,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * PUT /api/purchases/tax-settings
 * Update Configurable Advance Tax Settings & record in advance_tax_history.
 * Never modifies historical purchase invoices!
 */
purchasesRouter.put('/tax-settings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      tax_name = 'Advance Tax u/s 236H',
      filer_rate,
      non_filer_rate,
      exempt_rate = 0,
      calculation_basis = 'taxable_plus_gst',
      effective_from = '2026-01-01',
      status = 'Active',
      tax_applicability = 'All Taxable Purchases',
      change_reason = 'Updated Advance Tax rate configuration',
      changed_by = 'Authorized Administrator',
    } = req.body;

    const fRate = round2(filer_rate);
    const nfRate = round2(non_filer_rate);
    const exRate = round2(exempt_rate);

    if (fRate < 0 || nfRate < 0 || exRate < 0) {
      return res.status(400).json({ success: false, error: 'Advance Tax rates cannot be negative.' });
    }

    const allowedBasis = ['taxable_plus_gst', 'taxable_amount', 'gross_amount'];
    const cleanBasis = allowedBasis.includes(calculation_basis) ? calculation_basis : 'taxable_plus_gst';
    const cleanStatus = status === 'Inactive' ? 'Inactive' : 'Active';

    const updateTx = db.transaction(() => {
      const existing = db
        .prepare('SELECT id FROM advance_tax_settings ORDER BY id DESC LIMIT 1')
        .get() as { id: number } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE advance_tax_settings SET
            tax_name = ?,
            filer_rate = ?,
            non_filer_rate = ?,
            exempt_rate = ?,
            calculation_basis = ?,
            effective_from = ?,
            status = ?,
            tax_applicability = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          String(tax_name).trim(),
          fRate,
          nfRate,
          exRate,
          cleanBasis,
          String(effective_from).trim(),
          cleanStatus,
          String(tax_applicability).trim(),
          String(changed_by).trim(),
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO advance_tax_settings (
            tax_name, filer_rate, non_filer_rate, exempt_rate,
            calculation_basis, effective_from, status, tax_applicability, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          String(tax_name).trim(),
          fRate,
          nfRate,
          exRate,
          cleanBasis,
          String(effective_from).trim(),
          cleanStatus,
          String(tax_applicability).trim(),
          String(changed_by).trim()
        );
      }

      db.prepare(`
        INSERT INTO advance_tax_history (
          tax_name, filer_rate, non_filer_rate, exempt_rate,
          calculation_basis, effective_from, status, tax_applicability,
          change_reason, changed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(tax_name).trim(),
        fRate,
        nfRate,
        exRate,
        cleanBasis,
        String(effective_from).trim(),
        cleanStatus,
        String(tax_applicability).trim(),
        String(change_reason || 'Administrative rate update').trim(),
        String(changed_by || 'Authorized Administrator').trim()
      );
    });

    updateTx();

    const updatedSettings = db
      .prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1')
      .get();
    const history = db
      .prepare('SELECT * FROM advance_tax_history ORDER BY id DESC LIMIT 100')
      .all();

    return res.json({
      success: true,
      message: `Advance Tax settings updated (Filer: ${fRate}%, Non-Filer: ${nfRate}%). Historical invoices remain untouched.`,
      settings: updatedSettings,
      history,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/next-numbers
 * Generate next auto Purchase Invoice Number (Inv-YYYY-MM-XX) and Purchase Return Debit Note Number
 */
purchasesRouter.get('/next-numbers', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dateParam = req.query.date ? String(req.query.date) : undefined;
    const year = new Date().getFullYear();

    const lastRet = db
      .prepare('SELECT id, debit_note_number FROM purchase_returns ORDER BY id DESC LIMIT 1')
      .get() as { id: number; debit_note_number: string } | undefined;

    let nextRetSeq = (lastRet?.id || 0) + 1;
    if (lastRet?.debit_note_number) {
      const m = lastRet.debit_note_number.match(/(\d+)$/);
      if (m) nextRetSeq = Math.max(nextRetSeq, parseInt(m[1], 10) + 1);
    }

    return res.json({
      success: true,
      nextPurchaseNumber: peekNextInvoiceNumber(dateParam),
      nextReturnNumber: `PRN-${year}-${String(nextRetSeq).padStart(4, '0')}`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/fast-search
 * Ultra-fast indexed item search for Purchase Module (by Item Name, Generic Name, Brand/Category, Company, Item Code, Barcode)
 */
purchasesRouter.get('/fast-search', (req: Request, res: Response) => {
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
      const tokens = q.split(/\s+/).filter(Boolean);
      for (const tok of tokens) {
        const likeTok = `%${tok}%`;
        sql += `
          AND (
            item_code LIKE ?
            OR barcode LIKE ?
            OR item_name LIKE ?
            OR generic_name LIKE ?
            OR company_name LIKE ?
            OR category LIKE ?
            OR packing LIKE ?
          )
        `;
        params.push(likeTok, likeTok, likeTok, likeTok, likeTok, likeTok, likeTok);
      }

      const exactTerm = q;
      const prefixTerm = `${q}%`;
      sql += `
        ORDER BY
          CASE
            WHEN LOWER(item_code) = LOWER(?) THEN 0
            WHEN LOWER(barcode) = LOWER(?) THEN 1
            WHEN LOWER(item_name) LIKE LOWER(?) THEN 2
            WHEN LOWER(item_code) LIKE LOWER(?) THEN 3
            ELSE 4
          END,
          item_name ASC
        LIMIT ?
      `;
      params.push(exactTerm, exactTerm, prefixTerm, prefixTerm, limit);
    } else {
      sql += ` ORDER BY item_name ASC LIMIT ?`;
      params.push(limit);
    }

    const items = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return res.json({
      success: true,
      items,
      data: items,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/fast-search-suppliers
 * Fast supplier search by Supplier Name, Account Code, Mobile Number
 */
purchasesRouter.get('/fast-search-suppliers', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(60, Math.max(5, Number(req.query.limit || 40)));

    let sql = `
      SELECT *
      FROM accounts
      WHERE account_group IN ('Supplier', 'Customer & Supplier')
        AND is_system_account = 0
        AND status = 'Active'
    `;
    const params: Array<string | number> = [];

    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      for (const tok of tokens) {
        const likeTok = `%${tok}%`;
        sql += `
          AND (
            account_name LIKE ?
            OR account_code LIKE ?
            OR phone LIKE ?
            OR contact_person LIKE ?
            OR city LIKE ?
          )
        `;
        params.push(likeTok, likeTok, likeTok, likeTok, likeTok);
      }
      sql += ` ORDER BY account_name ASC LIMIT ?`;
      params.push(limit);
    } else {
      sql += ` ORDER BY account_name ASC LIMIT ?`;
      params.push(limit);
    }

    const suppliers = db.prepare(sql).all(...params);
    return res.json({
      success: true,
      suppliers,
      data: suppliers,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/batches
 * Live Batch-wise Inventory Stock with Box/Strip/Loose conversions and expiry tracking
 */
purchasesRouter.get('/batches', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { itemId, q, status, inStockOnly } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (itemId) {
      conditions.push('inv.item_id = ?');
      params.push(parseInt(String(itemId), 10));
    }
    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        '(inv.batch_number LIKE ? OR i.item_code LIKE ? OR i.item_name LIKE ? OR i.company_name LIKE ?)'
      );
      params.push(term, term, term, term);
    }
    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push('inv.status = ?');
      params.push(status);
    }
    if (inStockOnly === 'true') {
      conditions.push('inv.current_pack_qty > 0');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const batches = db
      .prepare(`
        SELECT
          inv.*,
          i.item_code,
          i.item_name,
          i.company_name,
          i.generic_name,
          i.category,
          i.minimum_stock,
          a.account_name as last_supplier_name
        FROM inventory inv
        INNER JOIN items i ON i.id = inv.item_id
        LEFT JOIN accounts a ON a.id = inv.last_supplier_id
        ${whereClause}
        ORDER BY inv.expiry_date ASC, i.item_name ASC
      `)
      .all(...params);

    return res.json({
      success: true,
      batches,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/returns/list
 * List all Purchase Returns (Debit Notes) with filtering
 */
purchasesRouter.get('/returns/list', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { q, supplierId, startDate, endDate, status } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        '(pr.debit_note_number LIKE ? OR pr.original_bill_number LIKE ? OR a.account_name LIKE ? OR pr.return_reason LIKE ?)'
      );
      params.push(term, term, term, term);
    }
    if (supplierId && supplierId !== 'all') {
      conditions.push('pr.supplier_account_id = ?');
      params.push(parseInt(String(supplierId), 10));
    }
    if (startDate && typeof startDate === 'string') {
      conditions.push('DATE(pr.return_date) >= DATE(?)');
      params.push(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      conditions.push('DATE(pr.return_date) <= DATE(?)');
      params.push(endDate);
    }
    if (status && status !== 'all') {
      conditions.push('pr.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const returns = db
      .prepare(`
        SELECT
          pr.*,
          a.account_code as supplier_code,
          a.account_name as supplier_name,
          a.ntn as supplier_ntn,
          a.strn as supplier_strn,
          a.phone as supplier_phone,
          a.address as supplier_address,
          (SELECT COUNT(*) FROM purchase_return_items pri WHERE pri.purchase_return_id = pr.id) as item_count
        FROM purchase_returns pr
        INNER JOIN accounts a ON a.id = pr.supplier_account_id
        ${whereClause}
        ORDER BY pr.id DESC
      `)
      .all(...params);

    return res.json({
      success: true,
      returns,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/returns/:id
 * Single Purchase Return with line items and double-entry journal lines
 */
purchasesRouter.get('/returns/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const purchaseReturn = db
      .prepare(`
        SELECT
          pr.*,
          a.account_code as supplier_code,
          a.account_name as supplier_name,
          a.ntn as supplier_ntn,
          a.strn as supplier_strn,
          a.phone as supplier_phone,
          a.address as supplier_address,
          a.city as supplier_city
        FROM purchase_returns pr
        INNER JOIN accounts a ON a.id = pr.supplier_account_id
        WHERE pr.id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;

    if (!purchaseReturn) {
      return res.status(404).json({ success: false, error: 'Purchase Return not found.' });
    }

    const items = db
      .prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ? ORDER BY id ASC')
      .all(id);

    let journalEntry = null;
    let journalLines: unknown[] = [];
    if (purchaseReturn.journal_entry_id) {
      journalEntry = db
        .prepare('SELECT * FROM journal_entries WHERE id = ?')
        .get(purchaseReturn.journal_entry_id);
      journalLines = db
        .prepare(`
          SELECT jl.*, a.account_code, a.account_name
          FROM journal_entry_lines jl
          INNER JOIN accounts a ON a.id = jl.account_id
          WHERE jl.journal_entry_id = ?
          ORDER BY jl.id ASC
        `)
        .all(purchaseReturn.journal_entry_id);
    }

    return res.json({
      success: true,
      purchaseReturn,
      items,
      journalEntry,
      journalLines,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/purchases/returns
 * Confirm and post a Purchase Return (Debit Note):
 * - Validates original purchase invoice and line eligible quantities (prevents returning > purchased)
 * - Reduces correct batch stock in inventory
 * - Records GST & Advance Tax adjustments
 * - Posts balanced Double-Entry accounting entries
 * - Updates supplier payable balance
 */
purchasesRouter.post('/returns', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      debit_note_number,
      return_date,
      original_purchase_id,
      supplier_account_id,
      settlement_mode = 'Account Adjustment',
      settlement_account_id = null,
      return_reason = 'Damaged / Near-Expiry Return',
      items = [],
    } = req.body;

    if (!original_purchase_id) {
      return res.status(400).json({
        success: false,
        error: 'Original Purchase Invoice must be selected for a Purchase Return.',
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one item with return quantity > 0 is required.',
      });
    }
    if (!return_reason || String(return_reason).trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Return Reason is required.',
      });
    }

    const targetReturnDate = String(return_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    assertPeriodOpen(targetReturnDate, 'record a purchase return');

    const origPurchase = db
      .prepare('SELECT * FROM purchases WHERE id = ?')
      .get(parseInt(String(original_purchase_id), 10)) as Record<string, any> | undefined;

    if (!origPurchase) {
      return res.status(404).json({
        success: false,
        error: 'Original Purchase Invoice not found.',
      });
    }
    if (origPurchase.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cannot return items against a cancelled Purchase Invoice.',
      });
    }

    const supplierId = supplier_account_id
      ? parseInt(String(supplier_account_id), 10)
      : Number(origPurchase.supplier_account_id);

    if (supplierId !== Number(origPurchase.supplier_account_id)) {
      return res.status(400).json({
        success: false,
        error: 'Selected Supplier does not match the Supplier on the original Purchase Invoice.',
      });
    }

    let createdReturnId = 0;

    const executeReturn = db.transaction(() => {
      // Determine debit note number (auto-advance if blank or already exists)
      const year = new Date().getFullYear();
      let dnNumber = debit_note_number ? String(debit_note_number).trim() : '';
      const lastRet = db
        .prepare('SELECT id FROM purchase_returns ORDER BY id DESC LIMIT 1')
        .get() as { id: number } | undefined;
      let retSeq = (lastRet?.id || 0) + 1;
      if (!dnNumber) {
        dnNumber = `PRN-${year}-${String(retSeq).padStart(4, '0')}`;
      }
      while (
        db
          .prepare('SELECT id FROM purchase_returns WHERE UPPER(TRIM(debit_note_number)) = UPPER(TRIM(?))')
          .get(dnNumber)
      ) {
        dnNumber = `PRN-${year}-${String(retSeq).padStart(4, '0')}`;
        retSeq++;
      }

      let grossReturnTotal = 0;
      let returnDiscountTotal = 0;
      let taxableReturnTotal = 0;
      let gstAdjustmentTotal = 0;
      let advanceTaxAdjustmentTotal = 0;

      const invoiceAdvTaxRate = round2(origPurchase.advance_tax_rate || 0);
      const invoiceAdvTaxBasis = String(origPurchase.advance_tax_basis || 'taxable_plus_gst');
      // Invoice-level discount ratio on original purchase (if invoice discount was applied)
      const origGrossAfterItemDisc = round2(
        Number(origPurchase.gross_total || 0) - Number(origPurchase.item_discount_amount || 0)
      );
      const origInvDiscRatio =
        origGrossAfterItemDisc > 0
          ? Number(origPurchase.invoice_discount_amount || 0) / origGrossAfterItemDisc
          : 0;

      const preparedLines: Array<Record<string, any>> = [];

      for (const line of items) {
        const retQty = round2(line.return_quantity);
        if (retQty <= 0) continue;

        const origItemId = parseInt(String(line.original_purchase_item_id), 10);
        const origItem = db
          .prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?')
          .get(origItemId, origPurchase.id) as Record<string, any> | undefined;

        if (!origItem) {
          throw new Error(`Original purchase item line (ID: ${origItemId}) not found on invoice ${origPurchase.bill_number}.`);
        }

        const purchasedQty = round2(origItem.quantity);
        const alreadyReturnedQty = round2(origItem.returned_quantity || 0);
        const eligibleQty = round2(purchasedQty - alreadyReturnedQty);

        if (retQty > eligibleQty) {
          throw new Error(
            `Cannot return ${retQty} of "${origItem.item_name}" (Batch: ${origItem.batch_number}). Purchased: ${purchasedQty}, Already Returned: ${alreadyReturnedQty}, Maximum Eligible Return: ${eligibleQty}.`
          );
        }

        // Verify batch stock availability in inventory
        const batchRow = db
          .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
          .get(origItem.item_id, origItem.batch_number) as Record<string, any> | undefined;

        if (!batchRow || round2(batchRow.current_pack_qty) < retQty) {
          const avail = batchRow ? round2(batchRow.current_pack_qty) : 0;
          throw new Error(
            `Insufficient batch stock for "${origItem.item_name}" (Batch: ${origItem.batch_number}). Available in batch: ${avail}, Requested return: ${retQty}.`
          );
        }

        const returnRate =
          line.debit_unit_rate !== undefined ? round2(line.debit_unit_rate) : round2(origItem.purchase_rate);
        const discPct =
          line.discount_percent !== undefined ? round2(line.discount_percent) : round2(origItem.discount_percent);
        const gstPct =
          line.tax_percent !== undefined ? round2(line.tax_percent) : round2(origItem.tax_percent);
        const lineAdvTaxRate =
          line.advance_tax_rate !== undefined ? round2(line.advance_tax_rate) : invoiceAdvTaxRate;

        const lineGross = round2(retQty * returnRate);
        const lineItemDisc = round2(lineGross * (discPct / 100));
        const lineAfterItemDisc = round2(lineGross - lineItemDisc);
        const lineProratedInvDisc =
          line.discount_amount !== undefined
            ? round2(Number(line.discount_amount) - lineItemDisc)
            : round2(lineAfterItemDisc * origInvDiscRatio);
        const lineTotalDisc = round2(lineItemDisc + Math.max(0, lineProratedInvDisc));
        const lineTaxable = round2(lineGross - lineTotalDisc);
        const lineGst = round2(lineTaxable * (gstPct / 100));

        let lineAdvBase = round2(lineTaxable + lineGst);
        if (invoiceAdvTaxBasis === 'taxable_amount') {
          lineAdvBase = lineTaxable;
        } else if (invoiceAdvTaxBasis === 'gross_amount') {
          lineAdvBase = lineGross;
        }
        const lineAdvTax = round2(lineAdvBase * (lineAdvTaxRate / 100));
        const lineNetTotal = round2(lineTaxable + lineGst + lineAdvTax);

        const parsedPack = parsePacking(origItem.packing);
        const returnUnits = round2(retQty * parsedPack.unitsPerPack);

        grossReturnTotal = round2(grossReturnTotal + lineGross);
        returnDiscountTotal = round2(returnDiscountTotal + lineTotalDisc);
        taxableReturnTotal = round2(taxableReturnTotal + lineTaxable);
        gstAdjustmentTotal = round2(gstAdjustmentTotal + lineGst);
        advanceTaxAdjustmentTotal = round2(advanceTaxAdjustmentTotal + lineAdvTax);

        preparedLines.push({
          origItem,
          batchRow,
          retQty,
          returnUnits,
          returnRate,
          discPct,
          lineTotalDisc,
          lineTaxable,
          gstPct,
          lineGst,
          lineAdvTaxRate,
          lineAdvTax,
          lineNetTotal,
          lineReason: line.return_reason ? String(line.return_reason).trim() : String(return_reason).trim(),
        });
      }

      if (preparedLines.length === 0) {
        throw new Error('No valid return items with quantity > 0 were provided.');
      }

      const totalDebitAmount = round2(
        taxableReturnTotal + gstAdjustmentTotal + advanceTaxAdjustmentTotal
      );

      // 1. Insert Purchase Return Header
      const insertRetResult = db
        .prepare(`
          INSERT INTO purchase_returns (
            debit_note_number, return_date, original_purchase_id, original_bill_number,
            supplier_account_id, supplier_filer_status,
            gross_return_amount, return_discount_amount, taxable_return_amount,
            gst_adjustment_amount, advance_tax_rate, advance_tax_adjustment_amount,
            total_debit_amount, settlement_mode, settlement_account_id,
            return_reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
        `)
        .run(
          dnNumber,
          return_date || new Date().toISOString().slice(0, 10),
          origPurchase.id,
          origPurchase.bill_number,
          supplierId,
          origPurchase.supplier_filer_status || 'Filer',
          grossReturnTotal,
          returnDiscountTotal,
          taxableReturnTotal,
          gstAdjustmentTotal,
          invoiceAdvTaxRate,
          advanceTaxAdjustmentTotal,
          totalDebitAmount,
          settlement_mode,
          settlement_account_id ? parseInt(String(settlement_account_id), 10) : null,
          String(return_reason).trim()
        );

      createdReturnId = Number(insertRetResult.lastInsertRowid);

      // 2. Insert Purchase Return Items, update purchase_items.returned_quantity, and reduce batch stock
      const insertRetItemStmt = db.prepare(`
        INSERT INTO purchase_return_items (
          purchase_return_id, original_purchase_item_id, item_id, inventory_id,
          item_code, company_name, item_name, packing, units_per_pack,
          batch_number, manufacturing_date, expiry_date,
          purchased_quantity, return_quantity, return_units,
          debit_unit_rate, discount_percent, discount_amount,
          taxable_amount, tax_percent, gst_amount,
          advance_tax_rate, advance_tax_amount, line_total, return_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const pl of preparedLines) {
        insertRetItemStmt.run(
          createdReturnId,
          pl.origItem.id,
          pl.origItem.item_id,
          pl.batchRow.id,
          pl.origItem.item_code,
          pl.origItem.company_name,
          pl.origItem.item_name,
          pl.origItem.packing,
          pl.origItem.units_per_pack,
          pl.origItem.batch_number,
          pl.origItem.manufacturing_date,
          pl.origItem.expiry_date,
          pl.origItem.quantity,
          pl.retQty,
          pl.returnUnits,
          pl.returnRate,
          pl.discPct,
          pl.lineTotalDisc,
          pl.lineTaxable,
          pl.gstPct,
          pl.lineGst,
          pl.lineAdvTaxRate,
          pl.lineAdvTax,
          pl.lineNetTotal,
          pl.lineReason
        );

        // Update returned_quantity on original purchase item
        db.prepare(`
          UPDATE purchase_items
          SET returned_quantity = ROUND(returned_quantity + ?, 2)
          WHERE id = ?
        `).run(pl.retQty, pl.origItem.id);

        // Reduce batch stock in inventory
        const parsedPack = parsePacking(pl.origItem.packing);
        const newPackQty = round2(Number(pl.batchRow.current_pack_qty) - pl.retQty);
        const newReturnedQty = round2(Number(pl.batchRow.returned_qty || 0) + pl.retQty);
        const newStripQty = round2(newPackQty * parsedPack.stripsPerBox);
        const newTotalUnits = round2(newPackQty * parsedPack.unitsPerPack);
        const newStatus = computeBatchStatus(newPackQty, pl.batchRow.expiry_date);

        db.prepare(`
          UPDATE inventory SET
            returned_qty = ?,
            current_pack_qty = ?,
            current_strip_qty = ?,
            current_loose_qty = ?,
            total_stock_units = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          newReturnedQty,
          newPackQty,
          newStripQty,
          newTotalUnits,
          newTotalUnits,
          newStatus,
          pl.batchRow.id
        );
      }

      // 3. Post Balanced Double-Entry Accounting Entries for Purchase Return
      const purchaseReturnAccId = getSystemAccountId('PUR-5002');
      const inventoryAssetAccId = getSystemAccountId('INV-1030');
      const gstAccId = getSystemAccountId('TAX-1045');
      const advTaxAccId = getSystemAccountId('TAX-1040');

      let refundCashOrBankAccId: number | null = null;
      if (settlement_mode === 'Cash Refund') {
        refundCashOrBankAccId = settlement_account_id
          ? parseInt(String(settlement_account_id), 10)
          : getSystemAccountId('FIN-1010');
      } else if (settlement_mode === 'Bank Refund') {
        refundCashOrBankAccId = settlement_account_id
          ? parseInt(String(settlement_account_id), 10)
          : getSystemAccountId('FIN-1021');
      }

      const jeLines: Array<{
        account_id: number;
        ledger_type: 'general' | 'customer' | 'supplier';
        debit_amount: number;
        credit_amount: number;
        narration: string;
      }> = [];

      // Debit Supplier Payable (reduces liability to supplier)
      jeLines.push({
        account_id: supplierId,
        ledger_type: 'supplier',
        debit_amount: totalDebitAmount,
        credit_amount: 0,
        narration: `Purchase Return ${dnNumber} against Invoice ${origPurchase.bill_number} (${return_reason})`,
      });

      // Credit Purchase Return Account & Reduce Inventory Asset (INV-1030)
      if (taxableReturnTotal > 0) {
        jeLines.push({
          account_id: purchaseReturnAccId,
          ledger_type: 'general',
          debit_amount: 0,
          credit_amount: taxableReturnTotal,
          narration: `Taxable Medicine Return on ${dnNumber}`,
        });
        jeLines.push({
          account_id: purchaseReturnAccId,
          ledger_type: 'general',
          debit_amount: taxableReturnTotal,
          credit_amount: 0,
          narration: `Purchase Return ${dnNumber} transferred to reduce Inventory Asset`,
        });
        jeLines.push({
          account_id: inventoryAssetAccId,
          ledger_type: 'general',
          debit_amount: 0,
          credit_amount: taxableReturnTotal,
          narration: `Medicine Inventory Asset reduced on Purchase Return ${dnNumber}`,
        });
      }

      // Credit GST / Input Tax Adjustable
      if (gstAdjustmentTotal > 0) {
        jeLines.push({
          account_id: gstAccId,
          ledger_type: 'general',
          debit_amount: 0,
          credit_amount: gstAdjustmentTotal,
          narration: `GST Input Tax Reversal on Purchase Return ${dnNumber}`,
        });
      }

      // Credit Advance Tax Receivable
      if (advanceTaxAdjustmentTotal > 0) {
        jeLines.push({
          account_id: advTaxAccId,
          ledger_type: 'general',
          debit_amount: 0,
          credit_amount: advanceTaxAdjustmentTotal,
          narration: `Advance Tax (${invoiceAdvTaxRate}%) Adjustment on Purchase Return ${dnNumber}`,
        });
      }

      // If Cash Refund or Bank Refund received immediately
      if (refundCashOrBankAccId && totalDebitAmount > 0) {
        jeLines.push({
          account_id: refundCashOrBankAccId,
          ledger_type: 'general',
          debit_amount: totalDebitAmount,
          credit_amount: 0,
          narration: `${settlement_mode} received for Purchase Return ${dnNumber}`,
        });
        jeLines.push({
          account_id: supplierId,
          ledger_type: 'supplier',
          debit_amount: 0,
          credit_amount: totalDebitAmount,
          narration: `${settlement_mode} settled against Purchase Return ${dnNumber}`,
        });
      }

      const sumDr = round2(jeLines.reduce((acc, l) => acc + l.debit_amount, 0));
      const sumCr = round2(jeLines.reduce((acc, l) => acc + l.credit_amount, 0));

      if (sumDr !== sumCr) {
        throw new Error(`Double-entry imbalance on Purchase Return: Dr ${sumDr} != Cr ${sumCr}`);
      }

      const jeNumber = `JE-${dnNumber}-${Date.now().toString().slice(-4)}`;
      const jeResult = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id,
            description, total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'PURCHASE_RETURN', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(
          jeNumber,
          return_date || new Date().toISOString().slice(0, 10),
          createdReturnId,
          `Purchase Return Debit Note ${dnNumber} (Ref Bill: ${origPurchase.bill_number})`,
          sumDr,
          sumCr
        );

      const jeId = Number(jeResult.lastInsertRowid);

      const insertLineStmt = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const touchedAccounts = new Set<number>();
      for (const l of jeLines) {
        insertLineStmt.run(jeId, l.account_id, l.ledger_type, l.debit_amount, l.credit_amount, l.narration);
        touchedAccounts.add(l.account_id);
      }

      db.prepare('UPDATE purchase_returns SET journal_entry_id = ? WHERE id = ?').run(jeId, createdReturnId);

      // Recalculate all touched account balances
      touchedAccounts.forEach((accId) => recalculateAccountBalance(accId));
    });

    executeReturn();

    const createdReturn = db
      .prepare(`
        SELECT pr.*, a.account_name as supplier_name, a.account_code as supplier_code
        FROM purchase_returns pr
        INNER JOIN accounts a ON a.id = pr.supplier_account_id
        WHERE pr.id = ?
      `)
      .get(createdReturnId);

    const createdItems = db
      .prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?')
      .all(createdReturnId);

    return res.status(201).json({
      success: true,
      message: 'Purchase Return confirmed. Batch stock reduced and supplier ledger updated.',
      purchaseReturn: createdReturn,
      items: createdItems,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/reports/:reportType
 * All 8 Mandatory Purchase & Tax Reports with Date Filters
 */
purchasesRouter.get('/reports/:reportType', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { reportType } = req.params;
    const { startDate, endDate, supplierId, itemId, filerStatus } = req.query;

    const purWhere: string[] = ["p.status = 'completed'"];
    const purParams: unknown[] = [];

    if (startDate && typeof startDate === 'string') {
      purWhere.push('DATE(p.bill_date) >= DATE(?)');
      purParams.push(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      purWhere.push('DATE(p.bill_date) <= DATE(?)');
      purParams.push(endDate);
    }
    if (supplierId && supplierId !== 'all') {
      purWhere.push('p.supplier_account_id = ?');
      purParams.push(parseInt(String(supplierId), 10));
    }
    if (filerStatus && filerStatus !== 'all') {
      purWhere.push('p.supplier_filer_status = ?');
      purParams.push(filerStatus);
    }

    const purWhereSql = `WHERE ${purWhere.join(' AND ')}`;

    switch (reportType) {
      case 'purchase-register': {
        const rows = db
          .prepare(`
            SELECT
              p.*,
              a.account_code as supplier_code,
              a.account_name as supplier_name,
              a.ntn as supplier_ntn,
              a.strn as supplier_strn,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count
            FROM purchases p
            INNER JOIN accounts a ON a.id = p.supplier_account_id
            ${purWhereSql}
            ORDER BY DATE(p.bill_date) DESC, p.id DESC
          `)
          .all(...purParams);
        return res.json({ success: true, reportType, rows });
      }

      case 'supplier-wise': {
        const rows = db
          .prepare(`
            SELECT
              a.id as supplier_account_id,
              a.account_code as supplier_code,
              a.account_name as supplier_name,
              a.filer_status,
              a.ntn,
              a.strn,
              COUNT(p.id) as invoice_count,
              COALESCE(SUM(p.gross_total), 0) as gross_total,
              COALESCE(SUM(p.discount_amount), 0) as discount_amount,
              COALESCE(SUM(p.taxable_amount), 0) as taxable_amount,
              COALESCE(SUM(p.gst_amount), 0) as gst_amount,
              COALESCE(SUM(p.advance_tax_amount), 0) as advance_tax_amount,
              COALESCE(SUM(p.net_total), 0) as net_total,
              COALESCE(SUM(p.paid_amount), 0) as paid_amount,
              a.supplier_debit,
              a.supplier_credit,
              ROUND(a.supplier_credit - a.supplier_debit, 2) as net_payable
            FROM accounts a
            LEFT JOIN purchases p ON p.supplier_account_id = a.id AND p.status = 'completed'
              ${startDate ? 'AND DATE(p.bill_date) >= DATE(?)' : ''}
              ${endDate ? 'AND DATE(p.bill_date) <= DATE(?)' : ''}
            WHERE a.account_group IN ('Supplier', 'Customer & Supplier')
              AND a.is_system_account = 0
              ${supplierId && supplierId !== 'all' ? 'AND a.id = ?' : ''}
            GROUP BY a.id
            ORDER BY net_total DESC, a.account_name ASC
          `)
          .all(
            ...(startDate ? [startDate] : []),
            ...(endDate ? [endDate] : []),
            ...(supplierId && supplierId !== 'all' ? [parseInt(String(supplierId), 10)] : [])
          );
        return res.json({ success: true, reportType, rows });
      }

      case 'item-wise': {
        const itemConds = [...purWhere];
        const itemParams = [...purParams];
        if (itemId && itemId !== 'all') {
          itemConds.push('pi.item_id = ?');
          itemParams.push(parseInt(String(itemId), 10));
        }
        const rows = db
          .prepare(`
            SELECT
              pi.item_id,
              pi.item_code,
              pi.item_name,
              pi.company_name,
              pi.packing,
              COUNT(DISTINCT p.id) as invoice_count,
              COUNT(DISTINCT pi.batch_number) as batch_count,
              COALESCE(SUM(pi.quantity), 0) as total_purchased_qty,
              COALESCE(SUM(pi.bonus_quantity), 0) as total_bonus_qty,
              COALESCE(SUM(pi.returned_quantity), 0) as total_returned_qty,
              COALESCE(SUM(pi.total_units), 0) as total_loose_units,
              ROUND(AVG(pi.purchase_rate), 2) as avg_purchase_rate,
              COALESCE(SUM(pi.gross_amount), 0) as gross_amount,
              COALESCE(SUM(pi.discount_amount), 0) as discount_amount,
              COALESCE(SUM(pi.taxable_amount), 0) as taxable_amount,
              COALESCE(SUM(pi.tax_amount), 0) as gst_amount,
              COALESCE(SUM(pi.line_total), 0) as net_line_total
            FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            WHERE ${itemConds.join(' AND ')}
            GROUP BY pi.item_id
            ORDER BY net_line_total DESC
          `)
          .all(...itemParams);
        return res.json({ success: true, reportType, rows });
      }

      case 'batch-wise': {
        const batchConds = [...purWhere];
        const batchParams = [...purParams];
        if (itemId && itemId !== 'all') {
          batchConds.push('pi.item_id = ?');
          batchParams.push(parseInt(String(itemId), 10));
        }
        const rows = db
          .prepare(`
            SELECT
              pi.*,
              p.bill_number,
              p.supplier_invoice_number,
              p.bill_date,
              p.supplier_filer_status,
              p.advance_tax_rate,
              a.account_name as supplier_name,
              inv.current_pack_qty as current_batch_stock,
              inv.total_stock_units as current_batch_loose_units
            FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            INNER JOIN accounts a ON a.id = p.supplier_account_id
            LEFT JOIN inventory inv ON inv.item_id = pi.item_id AND inv.batch_number = pi.batch_number
            WHERE ${batchConds.join(' AND ')}
            ORDER BY DATE(p.bill_date) DESC, pi.id DESC
          `)
          .all(...batchParams);
        return res.json({ success: true, reportType, rows });
      }

      case 'return-register': {
        const retWhere: string[] = ["pr.status = 'completed'"];
        const retParams: unknown[] = [];
        if (startDate && typeof startDate === 'string') {
          retWhere.push('DATE(pr.return_date) >= DATE(?)');
          retParams.push(startDate);
        }
        if (endDate && typeof endDate === 'string') {
          retWhere.push('DATE(pr.return_date) <= DATE(?)');
          retParams.push(endDate);
        }
        if (supplierId && supplierId !== 'all') {
          retWhere.push('pr.supplier_account_id = ?');
          retParams.push(parseInt(String(supplierId), 10));
        }

        const rows = db
          .prepare(`
            SELECT
              pr.*,
              a.account_code as supplier_code,
              a.account_name as supplier_name,
              a.ntn as supplier_ntn,
              (SELECT COUNT(*) FROM purchase_return_items pri WHERE pri.purchase_return_id = pr.id) as item_count
            FROM purchase_returns pr
            INNER JOIN accounts a ON a.id = pr.supplier_account_id
            WHERE ${retWhere.join(' AND ')}
            ORDER BY DATE(pr.return_date) DESC, pr.id DESC
          `)
          .all(...retParams);
        return res.json({ success: true, reportType, rows });
      }

      case 'supplier-outstanding': {
        const rows = db
          .prepare(`
            SELECT
              a.id,
              a.account_code,
              a.account_name,
              a.account_group,
              a.filer_status,
              a.ntn,
              a.strn,
              a.contact_person,
              a.phone,
              a.city,
              a.opening_balance,
              a.opening_balance_type,
              a.supplier_debit,
              a.supplier_credit,
              ROUND(a.supplier_credit - a.supplier_debit, 2) as net_payable_balance,
              (SELECT COUNT(*) FROM purchases p WHERE p.supplier_account_id = a.id AND p.status = 'completed') as total_bills,
              (SELECT COUNT(*) FROM purchase_returns pr WHERE pr.supplier_account_id = a.id AND pr.status = 'completed') as total_returns
            FROM accounts a
            WHERE a.account_group IN ('Supplier', 'Customer & Supplier')
              AND a.is_system_account = 0
              ${supplierId && supplierId !== 'all' ? 'AND a.id = ?' : ''}
            ORDER BY net_payable_balance DESC, a.account_name ASC
          `)
          .all(...(supplierId && supplierId !== 'all' ? [parseInt(String(supplierId), 10)] : []));
        return res.json({ success: true, reportType, rows });
      }

      case 'advance-tax-summary': {
        const rows = db
          .prepare(`
            SELECT
              p.id,
              p.bill_number,
              p.supplier_invoice_number,
              p.bill_date,
              a.account_code as supplier_code,
              a.account_name as supplier_name,
              a.ntn as supplier_ntn,
              a.strn as supplier_strn,
              p.supplier_filer_status,
              p.taxable_amount,
              p.gst_amount,
              p.advance_tax_name,
              p.advance_tax_basis,
              p.advance_tax_rate,
              p.advance_tax_amount,
              p.is_tax_overridden,
              p.tax_override_reason,
              p.tax_override_authorized_by,
              p.net_total
            FROM purchases p
            INNER JOIN accounts a ON a.id = p.supplier_account_id
            ${purWhereSql}
            ORDER BY DATE(p.bill_date) DESC, p.id DESC
          `)
          .all(...purParams);
        return res.json({ success: true, reportType, rows });
      }

      case 'expiry-wise': {
        const expConds = [...purWhere];
        const expParams = [...purParams];
        if (itemId && itemId !== 'all') {
          expConds.push('pi.item_id = ?');
          expParams.push(parseInt(String(itemId), 10));
        }
        const rows = db
          .prepare(`
            SELECT
              pi.id,
              pi.item_id,
              pi.item_code,
              pi.item_name,
              pi.company_name,
              pi.packing,
              pi.batch_number,
              pi.manufacturing_date,
              pi.expiry_date,
              pi.quantity as purchased_qty,
              pi.bonus_quantity as bonus_qty,
              pi.returned_quantity as returned_qty,
              pi.purchase_rate,
              pi.line_total,
              p.bill_number,
              p.bill_date,
              a.account_name as supplier_name,
              inv.current_pack_qty as remaining_batch_qty,
              inv.status as batch_status,
              CAST(julianday(pi.expiry_date) - julianday('now') AS INTEGER) as days_to_expiry
            FROM purchase_items pi
            INNER JOIN purchases p ON p.id = pi.purchase_id
            INNER JOIN accounts a ON a.id = p.supplier_account_id
            LEFT JOIN inventory inv ON inv.item_id = pi.item_id AND inv.batch_number = pi.batch_number
            WHERE ${expConds.join(' AND ')}
            ORDER BY DATE(pi.expiry_date) ASC, pi.item_name ASC
          `)
          .all(...expParams);
        return res.json({ success: true, reportType, rows });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown report type: ${reportType}` });
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases
 * List all Purchase Invoices with search, supplier, date, and status filters
 */
purchasesRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { q, supplierId, filerStatus, paymentMode, status, startDate, endDate } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        '(p.bill_number LIKE ? OR p.supplier_invoice_number LIKE ? OR a.account_name LIKE ? OR p.remarks LIKE ?)'
      );
      params.push(term, term, term, term);
    }
    if (supplierId && supplierId !== 'all') {
      conditions.push('p.supplier_account_id = ?');
      params.push(parseInt(String(supplierId), 10));
    }
    if (filerStatus && filerStatus !== 'all') {
      conditions.push('p.supplier_filer_status = ?');
      params.push(filerStatus);
    }
    if (paymentMode && paymentMode !== 'all') {
      conditions.push('p.payment_mode = ?');
      params.push(paymentMode);
    }
    if (status && status !== 'all') {
      if (status === 'held_or_draft' || status === 'held') {
        conditions.push("p.status IN ('draft', 'held')");
      } else {
        conditions.push('p.status = ?');
        params.push(status);
      }
    } else {
      conditions.push("p.status IN ('completed', 'cancelled')");
    }
    if (startDate && typeof startDate === 'string') {
      conditions.push('DATE(p.bill_date) >= DATE(?)');
      params.push(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      conditions.push('DATE(p.bill_date) <= DATE(?)');
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const purchases = db
      .prepare(`
        SELECT
          p.*,
          a.account_code as supplier_code,
          a.account_name as supplier_name,
          a.ntn as supplier_ntn,
          a.strn as supplier_strn,
          a.phone as supplier_phone,
          a.address as supplier_address,
          payAcc.account_name as payment_account_name,
          (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count,
          (SELECT COALESCE(SUM(pi.quantity + pi.bonus_quantity), 0) FROM purchase_items pi WHERE pi.purchase_id = p.id) as total_packs
        FROM purchases p
        INNER JOIN accounts a ON a.id = p.supplier_account_id
        LEFT JOIN accounts payAcc ON payAcc.id = p.payment_account_id
        ${whereClause}
        ORDER BY p.id DESC
      `)
      .all(...params) as Array<Record<string, unknown>>;

    if (purchases.length > 0) {
      const purchaseIds = purchases.map((p) => Number(p.id));
      const placeholders = purchaseIds.map(() => '?').join(',');
      const allPurchaseItems = db
        .prepare(`
          SELECT
            pi.*,
            COALESCE(NULLIF(TRIM(pi.company_name), ''), i.company_name, '') as company_name,
            COALESCE(NULLIF(TRIM(pi.item_name), ''), i.item_name, '') as item_name,
            COALESCE(NULLIF(TRIM(pi.item_code), ''), i.item_code, '') as item_code
          FROM purchase_items pi
          LEFT JOIN items i ON pi.item_id = i.id
          WHERE pi.purchase_id IN (${placeholders})
          ORDER BY pi.purchase_id DESC, pi.id ASC
        `)
        .all(...purchaseIds) as Array<Record<string, unknown>>;

      const itemsByPurchaseId = new Map<number, Array<Record<string, unknown>>>();
      for (const item of allPurchaseItems) {
        const pid = Number(item.purchase_id);
        if (!itemsByPurchaseId.has(pid)) {
          itemsByPurchaseId.set(pid, []);
        }
        itemsByPurchaseId.get(pid)!.push(item);
      }

      for (const p of purchases) {
        p.items = itemsByPurchaseId.get(Number(p.id)) || [];
      }
    }

    const stats = db
      .prepare(`
        SELECT
          COUNT(*) as total_invoices,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_total ELSE 0 END), 0) as total_gross,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_amount ELSE 0 END), 0) as total_discount,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN taxable_amount ELSE 0 END), 0) as total_taxable,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN gst_amount ELSE 0 END), 0) as total_gst,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN advance_tax_amount ELSE 0 END), 0) as total_advance_tax,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN net_total ELSE 0 END), 0) as total_net_purchases,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN paid_amount ELSE 0 END), 0) as total_paid
        FROM purchases
        WHERE status IN ('completed', 'cancelled')
      `)
      .get();

    return res.json({
      success: true,
      purchases,
      stats,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/purchases/:id
 * Detailed Purchase Invoice with Line Items and Double-Entry Journal Lines
 */
purchasesRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const purchase = db
      .prepare(`
        SELECT
          p.*,
          a.account_code as supplier_code,
          a.account_name as supplier_name,
          a.ntn as supplier_ntn,
          a.strn as supplier_strn,
          a.phone as supplier_phone,
          a.address as supplier_address,
          a.city as supplier_city,
          payAcc.account_code as payment_account_code,
          payAcc.account_name as payment_account_name
        FROM purchases p
        INNER JOIN accounts a ON a.id = p.supplier_account_id
        LEFT JOIN accounts payAcc ON payAcc.id = p.payment_account_id
        WHERE p.id = ?
      `)
      .get(id) as Record<string, any> | undefined;

    if (!purchase) {
      return res.status(404).json({ success: false, error: 'Purchase Invoice not found.' });
    }

    const items = db
      .prepare(`
        SELECT
          pi.*,
          COALESCE(NULLIF(TRIM(pi.company_name), ''), i.company_name, '') as company_name,
          COALESCE(NULLIF(TRIM(pi.item_name), ''), i.item_name, '') as item_name,
          COALESCE(NULLIF(TRIM(pi.item_code), ''), i.item_code, '') as item_code
        FROM purchase_items pi
        LEFT JOIN items i ON pi.item_id = i.id
        WHERE pi.purchase_id = ?
        ORDER BY pi.id ASC
      `)
      .all(id);

    let journalEntry = null;
    let journalLines: unknown[] = [];
    if (purchase.journal_entry_id) {
      journalEntry = db
        .prepare('SELECT * FROM journal_entries WHERE id = ?')
        .get(purchase.journal_entry_id);
      journalLines = db
        .prepare(`
          SELECT jl.*, a.account_code, a.account_name
          FROM journal_entry_lines jl
          INNER JOIN accounts a ON a.id = jl.account_id
          WHERE jl.journal_entry_id = ?
          ORDER BY jl.id ASC
        `)
        .all(purchase.journal_entry_id);
    }

    return res.json({
      success: true,
      purchase,
      items,
      journalEntry,
      journalLines,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * Internal helper to post a Purchase Invoice (used by POST /api/purchases and PUT /api/purchases/:id)
 */
export function executePurchasePosting(payload: Record<string, any>, existingPurchaseId?: number): number {
  const db = getDatabase();
  const {
    bill_number,
    supplier_invoice_number = '',
    bill_date,
    supplier_account_id,
    supplier_filer_status,
    invoice_discount_percent = 0,
    invoice_discount_amount: rawInvoiceDiscountAmount,
    is_tax_overridden = false,
    advance_tax_rate: customAdvanceTaxRate,
    tax_override_reason = '',
    tax_override_authorized_by = '',
    payment_mode = 'Credit',
    payment_account_id = null,
    paid_amount: rawPaidAmount = 0,
    remarks = '',
    items = [],
  } = payload;

  if (!supplier_account_id) {
    throw new Error('Supplier Account is required.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one line item is required on a Purchase Invoice.');
  }

  const supplierId = parseInt(String(supplier_account_id), 10);
  const supplier = db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(supplierId) as Record<string, any> | undefined;

  if (!supplier) {
    throw new Error('Selected Supplier Account does not exist.');
  }

  const rawStatusLower = String(payload.status || 'completed').trim().toLowerCase();
  const targetStatus: 'draft' | 'held' | 'completed' =
    rawStatusLower === 'held'
      ? 'held'
      : rawStatusLower === 'draft'
      ? 'draft'
      : 'completed';

  const companySettingsRow = db
    .prepare('SELECT batch_wise_purchase FROM company_settings ORDER BY id ASC LIMIT 1')
    .get() as { batch_wise_purchase?: number } | undefined;
  const defaultBatchWisePurchase =
    companySettingsRow && companySettingsRow.batch_wise_purchase !== undefined
      ? Number(companySettingsRow.batch_wise_purchase) !== 0
      : true;
  const batchWisePurchase =
    payload.batch_wise_purchase !== undefined
      ? !(
          payload.batch_wise_purchase === false ||
          payload.batch_wise_purchase === 0 ||
          payload.batch_wise_purchase === '0' ||
          payload.batch_wise_purchase === 'false'
        )
      : defaultBatchWisePurchase;

  const invoiceDate = String(bill_date || new Date().toISOString().slice(0, 10)).trim();

  // Enforce server-side numbering:
  // - If target is held/draft: generate a temporary HLD-PUR-YYYY-MM-XXXX code without consuming canonical sequence
  // - If confirming a previously held draft into completed: allocate canonical sequence (Inv-YYYY-MM-XX) and bind it
  // - If standard create completed: allocate next canonical sequence
  let finalBillNumber: string;
  if (existingPurchaseId) {
    const existingPurRow = db
      .prepare('SELECT bill_number, status FROM purchases WHERE id = ?')
      .get(existingPurchaseId) as { bill_number: string; status: string } | undefined;
    if (!existingPurRow) {
      throw new Error(`Purchase Invoice #${existingPurchaseId} not found.`);
    }

    if (
      (existingPurRow.status === 'held' ||
        existingPurRow.status === 'draft' ||
        existingPurRow.bill_number.startsWith('HLD-')) &&
      targetStatus === 'completed'
    ) {
      finalBillNumber = allocateNextInvoiceNumber('PURCHASE', invoiceDate);
      bindInvoiceNumberRecordId(finalBillNumber, 'PURCHASE', existingPurchaseId);
    } else {
      finalBillNumber = String(existingPurRow.bill_number);
    }
  } else {
    if (targetStatus === 'held' || targetStatus === 'draft') {
      const year = invoiceDate.slice(0, 4) || String(new Date().getFullYear());
      const month = invoiceDate.slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
      const draftSeq = String(Date.now()).slice(-5);
      finalBillNumber = `HLD-PUR-${year}-${month}-${draftSeq}`;
    } else {
      finalBillNumber = allocateNextInvoiceNumber('PURCHASE', invoiceDate);
    }
  }

  // Prevent duplicate Supplier Invoice Number for the same Supplier (when completed)
  const rawSupInvNo = String(supplier_invoice_number || '').trim();
  const cleanSupInvNo =
    !rawSupInvNo ||
    (bill_number && rawSupInvNo.toUpperCase() === String(bill_number).trim().toUpperCase())
      ? finalBillNumber
      : rawSupInvNo;
  if (targetStatus === 'completed' && cleanSupInvNo.length > 0) {
    const dupSupInv = db
      .prepare(
        `SELECT id, bill_number FROM purchases
         WHERE supplier_account_id = ?
           AND UPPER(TRIM(supplier_invoice_number)) = UPPER(TRIM(?))
           AND status = 'completed'
           ${existingPurchaseId ? 'AND id != ?' : ''}`
      )
      .get(
        ...(existingPurchaseId
          ? [supplierId, cleanSupInvNo, existingPurchaseId]
          : [supplierId, cleanSupInvNo])
      ) as { id: number; bill_number: string } | undefined;

    if (dupSupInv) {
      throw new Error(
        `Duplicate Supplier Invoice prevented: Supplier Invoice "${cleanSupInvNo}" is already recorded under Purchase Bill "${dupSupInv.bill_number}" for this supplier.`
      );
    }
  }

  // Supplier Filer Status (from invoice header or supplier account)
  const filerStatus: 'Filer' | 'Non-Filer' | 'Exempt' = ['Filer', 'Non-Filer', 'Exempt'].includes(
    supplier_filer_status
  )
    ? supplier_filer_status
    : ['Filer', 'Non-Filer', 'Exempt'].includes(supplier.filer_status)
    ? supplier.filer_status
    : 'Filer';

  // Fetch active Advance Tax settings from DB (never hard-coded!)
  const taxSettings = db
    .prepare('SELECT * FROM advance_tax_settings ORDER BY id DESC LIMIT 1')
    .get() as Record<string, any> | undefined;

  const settingsActive = !taxSettings || taxSettings.status === 'Active';
  const taxName = taxSettings?.tax_name || 'Advance Tax u/s 236H';
  const taxBasis = taxSettings?.calculation_basis || 'taxable_plus_gst';

  let defaultAdvRate = 0;
  if (settingsActive) {
    if (filerStatus === 'Filer') {
      defaultAdvRate = round2(taxSettings?.filer_rate ?? 0.5);
    } else if (filerStatus === 'Non-Filer') {
      defaultAdvRate = round2(taxSettings?.non_filer_rate ?? 2.5);
    } else {
      defaultAdvRate = round2(taxSettings?.exempt_rate ?? 0);
    }
  }

  const overridden = Boolean(is_tax_overridden);
  let appliedAdvRate = defaultAdvRate;
  if (overridden) {
    if (!tax_override_reason || String(tax_override_reason).trim().length === 0) {
      throw new Error('Transaction-level Advance Tax override requires a valid Override Reason.');
    }
    if (!tax_override_authorized_by || String(tax_override_authorized_by).trim().length === 0) {
      throw new Error('Transaction-level Advance Tax override requires Authorization (Authorized By).');
    }
    appliedAdvRate = Math.max(0, round2(customAdvanceTaxRate));
  }

  // Process Line Items with strict decimal precision
  let grossTotal = 0;
  let itemDiscountTotal = 0;

  const processedLines: Array<Record<string, any>> = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const rowIdx = i + 1;

    const itemId = parseInt(String(raw.item_id), 10);
    const dbItem = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as
      | Record<string, any>
      | undefined;
    if (!dbItem) {
      throw new Error(`Row ${rowIdx}: Selected Item does not exist in Items Master.`);
    }

    const existingPrimaryBatch = !batchWisePurchase
      ? (db
          .prepare(`
            SELECT * FROM inventory
            WHERE item_id = ?
            ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, id DESC
            LIMIT 1
          `)
          .get(itemId) as Record<string, any> | undefined)
      : undefined;

    const batchNo = batchWisePurchase
      ? String(raw.batch_number || '').trim() || `B-${dbItem.item_code}-01`
      : String(existingPrimaryBatch?.batch_number || raw.batch_number || `B-${dbItem.item_code}-01`).trim();
    const expiryDate = batchWisePurchase
      ? String(raw.expiry_date || '').trim() || '2028-12-31'
      : String(existingPrimaryBatch?.expiry_date || raw.expiry_date || '2028-12-31').trim();

    const mfgDate = raw.manufacturing_date ? String(raw.manufacturing_date).trim() : null;
    if (batchWisePurchase && mfgDate && expiryDate && mfgDate >= expiryDate) {
      throw new Error(
        `Row ${rowIdx} (${dbItem.item_name}): Expiry Date (${expiryDate}) must be after Manufacturing Date (${mfgDate}).`
      );
    }

    const rawQty = round2(raw.quantity);
    const bonusQty = Math.max(0, round2(raw.bonus_quantity || 0));
    const qty = rawQty <= 0 && bonusQty <= 0 ? 1 : rawQty;

    const purchaseRate = Math.max(0, round2(raw.purchase_rate ?? dbItem.purchase_price));
    const mrpRate = Math.max(0, round2(raw.mrp_rate ?? dbItem.retail_price));
    const discPct = Math.max(0, round2(raw.discount_percent ?? 0));
    const taxPct = Math.max(0, round2(raw.tax_percent ?? dbItem.tax_percent ?? 0));

    const lineGross = round2(qty * purchaseRate);
    const lineItemDisc =
      raw.discount_amount !== undefined && Number(raw.discount_percent || 0) === 0
        ? Math.min(lineGross, Math.max(0, round2(raw.discount_amount)))
        : round2(lineGross * (discPct / 100));

    const lineAfterItemDisc = round2(lineGross - lineItemDisc);

    const packingStr = String(raw.packing || dbItem.packing || '1x1').trim();
    const parsedPack = parsePacking(packingStr);
    const totalPacksAdded = round2(qty + bonusQty);
    const totalLooseUnits = round2(totalPacksAdded * parsedPack.unitsPerPack);

    grossTotal = round2(grossTotal + lineGross);
    itemDiscountTotal = round2(itemDiscountTotal + lineItemDisc);

    processedLines.push({
      dbItem,
      itemId,
      itemCode: dbItem.item_code,
      companyName: raw.company_name || dbItem.company_name,
      itemName: dbItem.item_name,
      packing: packingStr,
      parsedPack,
      batchNo,
      mfgDate,
      expiryDate,
      qty,
      bonusQty,
      totalPacksAdded,
      totalLooseUnits,
      purchaseRate,
      mrpRate,
      lineGross,
      discPct,
      lineItemDisc,
      lineAfterItemDisc,
      taxPct,
      updateMasterPurchasePrice: raw.update_master_purchase_price === true,
      updateMasterRetailPrice: raw.update_master_retail_price === true,
    });
  }

  const subtotalAfterItemDisc = round2(grossTotal - itemDiscountTotal);
  const invDiscPct = Math.max(0, round2(invoice_discount_percent || 0));
  const invoiceDiscountAmount =
    rawInvoiceDiscountAmount !== undefined && Number(rawInvoiceDiscountAmount) > 0 && invDiscPct === 0
      ? Math.min(subtotalAfterItemDisc, round2(rawInvoiceDiscountAmount))
      : round2(subtotalAfterItemDisc * (invDiscPct / 100));

  const totalDiscountAmount = round2(itemDiscountTotal + invoiceDiscountAmount);
  const taxableAmount = round2(grossTotal - totalDiscountAmount);

  // Prorate invoice discount across lines to compute exact GST per line
  let gstTotal = 0;
  let allocatedTaxable = 0;

  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    let lineTaxable = line.lineAfterItemDisc;
    if (invoiceDiscountAmount > 0 && subtotalAfterItemDisc > 0) {
      if (i === processedLines.length - 1) {
        lineTaxable = round2(taxableAmount - allocatedTaxable);
      } else {
        const share = line.lineAfterItemDisc / subtotalAfterItemDisc;
        lineTaxable = round2(line.lineAfterItemDisc - invoiceDiscountAmount * share);
        allocatedTaxable = round2(allocatedTaxable + lineTaxable);
      }
    }
    const lineTaxAmount = round2(lineTaxable * (line.taxPct / 100));
    const lineNet = round2(lineTaxable + lineTaxAmount);

    line.lineTaxable = lineTaxable;
    line.lineTaxAmount = lineTaxAmount;
    line.lineNet = lineNet;
    gstTotal = round2(gstTotal + lineTaxAmount);
  }

  // Calculate Advance Tax according to configured basis
  let advTaxBase = round2(taxableAmount + gstTotal);
  if (taxBasis === 'taxable_amount') {
    advTaxBase = taxableAmount;
  } else if (taxBasis === 'gross_amount') {
    advTaxBase = grossTotal;
  }

  const advanceTaxAmount = round2(advTaxBase * (appliedAdvRate / 100));
  const netInvoiceAmount = round2(taxableAmount + gstTotal + advanceTaxAmount);

  // Previous Supplier Balance before this invoice
  const prevNetPayable = round2(
    Number(supplier.supplier_credit || 0) - Number(supplier.supplier_debit || 0)
  );
  const previousSupplierBalance = Math.abs(prevNetPayable);
  const previousBalanceType: 'Credit' | 'Debit' = prevNetPayable >= 0 ? 'Credit' : 'Debit';

  const totalPayable = round2(prevNetPayable + netInvoiceAmount);

  // Payment mode & Paid Amount
  const validPaymentMode: 'Credit' | 'Cash' | 'Bank' | 'Partial' = [
    'Credit',
    'Cash',
    'Bank',
    'Partial',
  ].includes(payment_mode)
    ? payment_mode
    : 'Credit';

  let paidAmount = Math.max(0, round2(rawPaidAmount));
  if (validPaymentMode === 'Credit') {
    paidAmount = 0;
  } else if (
    (validPaymentMode === 'Cash' || validPaymentMode === 'Bank') &&
    rawPaidAmount === undefined
  ) {
    paidAmount = netInvoiceAmount;
  }

  const remainingBalance = round2(totalPayable - paidAmount);
  const paymentStatus: 'unpaid' | 'partial' | 'paid' =
    paidAmount <= 0 ? 'unpaid' : paidAmount >= netInvoiceAmount ? 'paid' : 'partial';

  // Resolve Payment Account if paidAmount > 0
  let resolvedPaymentAccountId: number | null = null;
  if (paidAmount > 0) {
    if (payment_account_id) {
      resolvedPaymentAccountId = parseInt(String(payment_account_id), 10);
    } else if (validPaymentMode === 'Bank') {
      resolvedPaymentAccountId = getSystemAccountId('FIN-1021');
    } else {
      resolvedPaymentAccountId = getSystemAccountId('FIN-1010');
    }
  }

  // Insert or Update Purchase Header
  let purchaseId = existingPurchaseId || 0;
  if (existingPurchaseId) {
    db.prepare(`
      UPDATE purchases SET
        bill_number = ?,
        supplier_invoice_number = ?,
        bill_date = ?,
        supplier_account_id = ?,
        supplier_filer_status = ?,
        gross_total = ?,
        item_discount_amount = ?,
        invoice_discount_percent = ?,
        invoice_discount_amount = ?,
        discount_amount = ?,
        taxable_amount = ?,
        gst_amount = ?,
        tax_amount = ?,
        advance_tax_name = ?,
        advance_tax_rate = ?,
        advance_tax_basis = ?,
        advance_tax_amount = ?,
        is_tax_overridden = ?,
        tax_override_reason = ?,
        tax_override_authorized_by = ?,
        net_total = ?,
        previous_supplier_balance = ?,
        previous_balance_type = ?,
        total_payable = ?,
        paid_amount = ?,
        remaining_balance = ?,
        payment_mode = ?,
        payment_account_id = ?,
        payment_status = ?,
        status = ?,
        remarks = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      finalBillNumber,
      cleanSupInvNo,
      invoiceDate,
      supplierId,
      filerStatus,
      grossTotal,
      itemDiscountTotal,
      invDiscPct,
      invoiceDiscountAmount,
      totalDiscountAmount,
      taxableAmount,
      gstTotal,
      round2(gstTotal + advanceTaxAmount),
      taxName,
      appliedAdvRate,
      taxBasis,
      advanceTaxAmount,
      overridden ? 1 : 0,
      overridden ? String(tax_override_reason).trim() : null,
      overridden ? String(tax_override_authorized_by).trim() : null,
      netInvoiceAmount,
      previousSupplierBalance,
      previousBalanceType,
      totalPayable,
      paidAmount,
      remainingBalance,
      validPaymentMode,
      resolvedPaymentAccountId,
      paymentStatus,
      targetStatus,
      remarks ? String(remarks).trim() : null,
      existingPurchaseId
    );
  } else {
    const insertResult = db
      .prepare(`
        INSERT INTO purchases (
          bill_number, supplier_invoice_number, bill_date,
          supplier_account_id, supplier_filer_status,
          gross_total, item_discount_amount, invoice_discount_percent, invoice_discount_amount,
          discount_amount, taxable_amount, gst_amount, tax_amount,
          advance_tax_name, advance_tax_rate, advance_tax_basis, advance_tax_amount,
          is_tax_overridden, tax_override_reason, tax_override_authorized_by,
          net_total, previous_supplier_balance, previous_balance_type,
          total_payable, paid_amount, remaining_balance,
          payment_mode, payment_account_id, payment_status,
          status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        finalBillNumber,
        cleanSupInvNo,
        invoiceDate,
        supplierId,
        filerStatus,
        grossTotal,
        itemDiscountTotal,
        invDiscPct,
        invoiceDiscountAmount,
        totalDiscountAmount,
        taxableAmount,
        gstTotal,
        round2(gstTotal + advanceTaxAmount),
        taxName,
        appliedAdvRate,
        taxBasis,
        advanceTaxAmount,
        overridden ? 1 : 0,
        overridden ? String(tax_override_reason).trim() : null,
        overridden ? String(tax_override_authorized_by).trim() : null,
        netInvoiceAmount,
        previousSupplierBalance,
        previousBalanceType,
        totalPayable,
        paidAmount,
        remainingBalance,
        validPaymentMode,
        resolvedPaymentAccountId,
        paymentStatus,
        targetStatus,
        remarks ? String(remarks).trim() : null
      );

    purchaseId = Number(insertResult.lastInsertRowid);
    if (targetStatus === 'completed') {
      bindInvoiceNumberRecordId(finalBillNumber, 'PURCHASE', purchaseId);
    }
  }

  // Insert Purchase Items & Update Batch-wise Stock in Inventory
  const insertItemStmt = db.prepare(`
    INSERT INTO purchase_items (
      purchase_id, item_id, inventory_id,
      item_code, company_name, item_name, packing, units_per_pack,
      batch_number, manufacturing_date, expiry_date,
      quantity, bonus_quantity, pack_quantity, loose_quantity, total_units,
      purchase_rate, mrp_rate, gross_amount,
      discount_percent, discount_amount, taxable_amount,
      tax_percent, tax_amount, line_total, returned_quantity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  for (const line of processedLines) {
    let inventoryId: number | null = null;

    if (targetStatus === 'completed') {
      // Upsert batch in inventory (when batchWisePurchase is OFF, update the item's existing active batch record while preserving its batch_number & expiry_date)
      const existingBatch = batchWisePurchase
        ? (db
            .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
            .get(line.itemId, line.batchNo) as Record<string, any> | undefined)
        : (db
            .prepare(`
              SELECT * FROM inventory
              WHERE item_id = ?
              ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, id DESC
              LIMIT 1
            `)
            .get(line.itemId) as Record<string, any> | undefined);

      if (existingBatch) {
        const nextPurchasedQty = round2(Number(existingBatch.purchased_qty || 0) + line.qty);
        const nextBonusQty = round2(Number(existingBatch.bonus_qty || 0) + line.bonusQty);
        const nextTotalUnits = round2(Number(existingBatch.total_stock_units || 0) + line.totalLooseUnits);
        const nextPackQty = round2(nextTotalUnits / line.parsedPack.unitsPerPack);
        const nextStripQty = round2(nextPackQty * line.parsedPack.stripsPerBox);
        const nextLooseQty = round2(nextTotalUnits % line.parsedPack.unitsPerPack);
        const preservedExpiryDate = batchWisePurchase
          ? line.expiryDate
          : String(existingBatch.expiry_date || line.expiryDate);
        const nextStatus = computeBatchStatus(
          nextPackQty,
          preservedExpiryDate,
          Number(line.dbItem.minimum_stock || 0)
        );

        db.prepare(`
          UPDATE inventory SET
            manufacturing_date = COALESCE(?, manufacturing_date),
            expiry_date = ?,
            packing = ?,
            strips_per_box = ?,
            units_per_strip = ?,
            units_per_pack = ?,
            cost_price = ?,
            retail_price = ?,
            pack_cost = ?,
            pack_retail = ?,
            purchased_qty = ?,
            bonus_qty = ?,
            current_pack_qty = ?,
            current_strip_qty = ?,
            current_loose_qty = ?,
            total_stock_units = ?,
            last_purchase_id = ?,
            last_supplier_id = ?,
            purchase_date = COALESCE(NULLIF(purchase_date, ''), ?),
            purchase_invoice_number = ?,
            supplier_name = ?,
            status = ?,
            batch_status = 'Active',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          line.mfgDate,
          preservedExpiryDate,
          line.packing,
          line.parsedPack.stripsPerBox,
          line.parsedPack.unitsPerStrip,
          line.parsedPack.unitsPerPack,
          line.purchaseRate,
          line.mrpRate,
          line.purchaseRate,
          line.mrpRate,
          nextPurchasedQty,
          nextBonusQty,
          nextPackQty,
          nextStripQty,
          nextLooseQty,
          nextTotalUnits,
          purchaseId,
          supplierId,
          invoiceDate,
          finalBillNumber,
          String(supplier.account_name || ''),
          nextStatus,
          existingBatch.id
        );
        inventoryId = Number(existingBatch.id);

        recordBatchStockMovement({
          movementDate: invoiceDate,
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemName: line.itemName,
          companyName: line.companyName,
          inventoryId,
          batchNumber: String(existingBatch.batch_number || line.batchNo),
          expiryDate: preservedExpiryDate,
          purchaseDate: invoiceDate,
          movementType: 'PURCHASE_IN',
          referenceType: 'PURCHASE_INVOICE',
          referenceId: purchaseId,
          referenceNumber: finalBillNumber,
          partyAccountId: supplierId,
          partyName: String(supplier.account_name || ''),
          quantityPacks: line.qty,
          bonusPacks: line.bonusQty,
          totalUnits: line.totalLooseUnits,
          purchaseRate: line.purchaseRate,
          tradePrice: Number(line.dbItem.trade_price || line.mrpRate || 0),
          balanceAfterPacks: nextPackQty,
          remarks: `Purchase Invoice ${finalBillNumber}`,
          performedBy: 'Super Admin',
        });
      } else {
        const nextPackQty = line.totalPacksAdded;
        const nextStripQty = round2(nextPackQty * line.parsedPack.stripsPerBox);
        const nextTotalUnits = round2(nextPackQty * line.parsedPack.unitsPerPack);
        const nextStatus = computeBatchStatus(
          nextPackQty,
          line.expiryDate,
          Number(line.dbItem.minimum_stock || 0)
        );

        const invResult = db
          .prepare(`
            INSERT INTO inventory (
              item_id, batch_number, manufacturing_date, expiry_date,
              packing, strips_per_box, units_per_strip, units_per_pack,
              cost_price, trade_price, wholesale_price, retail_price,
              pack_cost, pack_retail,
              purchased_qty, bonus_qty, returned_qty, sold_qty,
              current_pack_qty, current_strip_qty, current_loose_qty, total_stock_units,
              rack_shelf, last_purchase_id, last_supplier_id,
              purchase_date, purchase_invoice_number, supplier_name, status, batch_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
          `)
          .run(
            line.itemId,
            line.batchNo,
            line.mfgDate,
            line.expiryDate,
            line.packing,
            line.parsedPack.stripsPerBox,
            line.parsedPack.unitsPerStrip,
            line.parsedPack.unitsPerPack,
            line.purchaseRate,
            line.dbItem.trade_price || line.purchaseRate,
            line.dbItem.wholesale_price || line.purchaseRate,
            line.mrpRate,
            line.purchaseRate,
            line.mrpRate,
            line.qty,
            line.bonusQty,
            nextPackQty,
            nextStripQty,
            nextTotalUnits,
            nextTotalUnits,
            line.dbItem.rack_number || null,
            purchaseId,
            supplierId,
            invoiceDate,
            finalBillNumber,
            String(supplier.account_name || ''),
            nextStatus
          );
        inventoryId = Number(invResult.lastInsertRowid);

        recordBatchStockMovement({
          movementDate: invoiceDate,
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemName: line.itemName,
          companyName: line.companyName,
          inventoryId,
          batchNumber: line.batchNo,
          expiryDate: line.expiryDate,
          purchaseDate: invoiceDate,
          movementType: 'PURCHASE_IN',
          referenceType: 'PURCHASE_INVOICE',
          referenceId: purchaseId,
          referenceNumber: finalBillNumber,
          partyAccountId: supplierId,
          partyName: String(supplier.account_name || ''),
          quantityPacks: line.qty,
          bonusPacks: line.bonusQty,
          totalUnits: nextTotalUnits,
          purchaseRate: line.purchaseRate,
          tradePrice: Number(line.dbItem.trade_price || line.mrpRate || 0),
          balanceAfterPacks: nextPackQty,
          remarks: `Purchase Invoice ${finalBillNumber}`,
          performedBy: 'Super Admin',
        });
      }

      // Update Item Master prices ONLY when explicitly approved by user confirmation
      if (line.updateMasterPurchasePrice) {
        if (line.updateMasterRetailPrice) {
          const roundedRetail =
            line.purchaseRate > 0
              ? round2(line.purchaseRate / 0.85)
              : line.mrpRate;
          const unitsPerPack = Math.max(1, Number(line.parsedPack.unitsPerPack) || 1);
          const nextLooseRate = round2(roundedRetail / unitsPerPack);
          db.prepare(`
            UPDATE items SET
              purchase_price = ?,
              retail_price = ?,
              loose_rate = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(line.purchaseRate, roundedRetail, nextLooseRate, line.itemId);
        } else {
          db.prepare(`
            UPDATE items SET
              purchase_price = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(line.purchaseRate, line.itemId);
        }
      }
    }

    insertItemStmt.run(
      purchaseId,
      line.itemId,
      inventoryId,
      line.itemCode,
      line.companyName,
      line.itemName,
      line.packing,
      line.parsedPack.unitsPerPack,
      line.batchNo,
      line.mfgDate,
      line.expiryDate,
      line.qty,
      line.bonusQty,
      line.totalPacksAdded,
      line.totalLooseUnits,
      line.totalLooseUnits,
      line.purchaseRate,
      line.mrpRate,
      line.lineGross,
      line.discPct,
      line.lineItemDisc,
      line.lineTaxable,
      line.taxPct,
      line.lineTaxAmount,
      line.lineNet
    );
  }

  // Post Balanced Double-Entry Accounting Entries (strictly for completed purchases)
  if (targetStatus === 'completed') {
    const purchaseAccId = getSystemAccountId('PUR-5001');
    const purchaseDiscountAccId = getSystemAccountId('INC-4020');
    const inventoryAssetAccId = getSystemAccountId('INV-1030');
    const gstAccId = getSystemAccountId('TAX-1045');
    const advTaxAccId = getSystemAccountId('TAX-1040');

    const jeLines: Array<{
      account_id: number;
      ledger_type: 'general' | 'customer' | 'supplier';
      debit_amount: number;
      credit_amount: number;
      narration: string;
    }> = [];

    // 1. Debit Medicine Purchases Account & Capitalize Net Stock into Inventory Asset (INV-1030)
    const purchaseGrossOrTaxable = totalDiscountAmount > 0 ? grossTotal : taxableAmount;
    if (purchaseGrossOrTaxable > 0) {
      jeLines.push({
        account_id: purchaseAccId,
        ledger_type: 'general',
        debit_amount: purchaseGrossOrTaxable,
        credit_amount: 0,
        narration: `Medicine Purchase Invoice ${finalBillNumber} (Supplier Inv: ${cleanSupInvNo || 'N/A'})`,
      });
    }
    if (totalDiscountAmount > 0) {
      jeLines.push({
        account_id: purchaseDiscountAccId,
        ledger_type: 'general',
        debit_amount: 0,
        credit_amount: totalDiscountAmount,
        narration: `Purchase Discount earned on Invoice ${finalBillNumber}`,
      });
    }
    if (taxableAmount > 0) {
      jeLines.push({
        account_id: inventoryAssetAccId,
        ledger_type: 'general',
        debit_amount: taxableAmount,
        credit_amount: 0,
        narration: `Medicine Inventory Asset addition from Purchase ${finalBillNumber}`,
      });
      jeLines.push({
        account_id: purchaseAccId,
        ledger_type: 'general',
        debit_amount: 0,
        credit_amount: taxableAmount,
        narration: `Net Purchase Stock capitalized to Medicine Inventory (${finalBillNumber})`,
      });
    }

    // 2. Debit GST / Applicable Input Tax Account
    if (gstTotal > 0) {
      jeLines.push({
        account_id: gstAccId,
        ledger_type: 'general',
        debit_amount: gstTotal,
        credit_amount: 0,
        narration: `GST / Input Tax on Purchase Invoice ${finalBillNumber}`,
      });
    }

    // 3. Debit Advance Tax Receivable Account (kept strictly separate from purchase discounts)
    if (advanceTaxAmount > 0) {
      jeLines.push({
        account_id: advTaxAccId,
        ledger_type: 'general',
        debit_amount: advanceTaxAmount,
        credit_amount: 0,
        narration: `${taxName} (${appliedAdvRate}% - ${filerStatus}) on Purchase Invoice ${finalBillNumber}`,
      });
    }

    // 4. Credit Supplier Payable Account
    if (netInvoiceAmount > 0) {
      jeLines.push({
        account_id: supplierId,
        ledger_type: 'supplier',
        debit_amount: 0,
        credit_amount: netInvoiceAmount,
        narration: `Payable against Purchase Invoice ${finalBillNumber} (Supplier Inv: ${cleanSupInvNo || 'N/A'})`,
      });
    }

    // 5. If Paid Amount > 0 (Cash, Bank, or Partial Payment), Debit Supplier Payable and Credit Cash/Bank
    if (paidAmount > 0 && resolvedPaymentAccountId) {
      jeLines.push({
        account_id: supplierId,
        ledger_type: 'supplier',
        debit_amount: paidAmount,
        credit_amount: 0,
        narration: `${validPaymentMode} Payment against Purchase Invoice ${finalBillNumber}`,
      });
      jeLines.push({
        account_id: resolvedPaymentAccountId,
        ledger_type: 'general',
        debit_amount: 0,
        credit_amount: paidAmount,
        narration: `Paid to ${supplier.account_name} for Purchase Invoice ${finalBillNumber}`,
      });
    }

    const totalDebit = round2(jeLines.reduce((sum, l) => sum + l.debit_amount, 0));
    const totalCredit = round2(jeLines.reduce((sum, l) => sum + l.credit_amount, 0));

    if (totalDebit !== totalCredit) {
      throw new Error(`Double-Entry Accounting Error: Total Debit (${totalDebit}) != Total Credit (${totalCredit}).`);
    }

    const jeNumber = `JE-${finalBillNumber}-${Date.now().toString().slice(-4)}`;
    const jeInsert = db
      .prepare(`
        INSERT INTO journal_entries (
          entry_number, entry_date, reference_type, reference_id,
          description, total_debit, total_credit, is_balanced, status
        ) VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, 1, 'posted')
      `)
      .run(
        jeNumber,
        invoiceDate,
        purchaseId,
        `Purchase Invoice ${finalBillNumber} - ${supplier.account_name}`,
        totalDebit,
        totalCredit
      );

    const jeId = Number(jeInsert.lastInsertRowid);
    const insertLineStmt = db.prepare(`
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const touchedAccounts = new Set<number>();
    for (const line of jeLines) {
      insertLineStmt.run(
        jeId,
        line.account_id,
        line.ledger_type,
        line.debit_amount,
        line.credit_amount,
        line.narration
      );
      touchedAccounts.add(line.account_id);
    }

    db.prepare('UPDATE purchases SET journal_entry_id = ? WHERE id = ?').run(jeId, purchaseId);

    // Recalculate all touched account balances
    touchedAccounts.forEach((accId) => recalculateAccountBalance(accId));
  } else {
    // If held/draft, ensure no journal entry is bound
    db.prepare('UPDATE purchases SET journal_entry_id = NULL WHERE id = ?').run(purchaseId);
  }

  return purchaseId;
}

/**
 * Internal helper to reverse stock and accounting entries of an existing Purchase Invoice
 * (used for safe cancellation and safe editing via reversal entries)
 */
function reverseExistingPurchase(purchaseId: number, reason: string): void {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM purchases WHERE id = ?')
    .get(purchaseId) as Record<string, any> | undefined;

  if (!existing) {
    throw new Error('Purchase Invoice not found.');
  }
  if (existing.status === 'cancelled') {
    throw new Error(`Purchase Invoice "${existing.bill_number}" is already cancelled.`);
  }

  // Held and draft purchase invoices never updated stock or accounting ledgers
  if (existing.status === 'held' || existing.status === 'draft') {
    return;
  }

  // Check if any purchase returns are active against this invoice
  const activeReturns = db
    .prepare(
      "SELECT COUNT(*) as c FROM purchase_returns WHERE original_purchase_id = ? AND status = 'completed'"
    )
    .get(purchaseId) as { c: number };
  if (activeReturns.c > 0) {
    throw new Error(
      `Cannot modify or cancel Purchase Invoice "${existing.bill_number}" because ${activeReturns.c} Purchase Return(s) have already been posted against it.`
    );
  }

  // 1. Reverse batch stock for each line item
  const oldItems = db
    .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
    .all(purchaseId) as Array<Record<string, any>>;

  for (const item of oldItems) {
    const batch = db
      .prepare('SELECT * FROM inventory WHERE item_id = ? AND batch_number = ?')
      .get(item.item_id, item.batch_number) as Record<string, any> | undefined;

    if (batch) {
      const packsToRemove = round2(Number(item.quantity || 0) + Number(item.bonus_quantity || 0));
      const newPackQty = Math.max(0, round2(Number(batch.current_pack_qty || 0) - packsToRemove));
      const newPurQty = Math.max(0, round2(Number(batch.purchased_qty || 0) - Number(item.quantity || 0)));
      const newBonusQty = Math.max(0, round2(Number(batch.bonus_qty || 0) - Number(item.bonus_quantity || 0)));
      const parsedPack = parsePacking(batch.packing);
      const newStripQty = round2(newPackQty * parsedPack.stripsPerBox);
      const newTotalUnits = round2(newPackQty * parsedPack.unitsPerPack);
      const newStatus = computeBatchStatus(newPackQty, batch.expiry_date);

      db.prepare(`
        UPDATE inventory SET
          purchased_qty = ?,
          bonus_qty = ?,
          current_pack_qty = ?,
          current_strip_qty = ?,
          current_loose_qty = ?,
          total_stock_units = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        newPurQty,
        newBonusQty,
        newPackQty,
        newStripQty,
        newTotalUnits,
        newTotalUnits,
        newStatus,
        batch.id
      );
    }
  }

  // 2. Post formal Double-Entry Reversal Journal Entry (swapping Debits & Credits of original entry)
  const touchedAccounts = new Set<number>([Number(existing.supplier_account_id)]);
  if (existing.journal_entry_id) {
    const origEntry = db
      .prepare('SELECT * FROM journal_entries WHERE id = ?')
      .get(existing.journal_entry_id) as Record<string, any> | undefined;

    const origLines = db
      .prepare('SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?')
      .all(existing.journal_entry_id) as Array<Record<string, any>>;

    if (origEntry && origLines.length > 0) {
      const revEntryNumber = `REV-${existing.bill_number}-${Date.now().toString().slice(-4)}`;
      const revJe = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id,
            description, total_debit, total_credit, is_balanced, status
          ) VALUES (?, CURRENT_TIMESTAMP, 'ADJUSTMENT', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(
          revEntryNumber,
          purchaseId,
          `Reversal of Purchase Invoice ${existing.bill_number}: ${reason}`,
          origEntry.total_credit,
          origEntry.total_debit
        );

      const revJeId = Number(revJe.lastInsertRowid);
      const insertRevLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const ol of origLines) {
        insertRevLine.run(
          revJeId,
          ol.account_id,
          ol.ledger_type,
          ol.credit_amount, // Swap Credit -> Debit
          ol.debit_amount,  // Swap Debit -> Credit
          `Reversal (${reason}): ${ol.narration}`
        );
        touchedAccounts.add(Number(ol.account_id));
      }
    }
  }

  // Recalculate all touched account balances after reversal
  touchedAccounts.forEach((accId) => recalculateAccountBalance(accId));
}

/**
 * POST /api/purchases
 * Create and confirm a new Purchase Invoice in an atomic transaction with idempotent client_request_id protection
 */
purchasesRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const clientRequestId = req.body?.client_request_id
      ? String(req.body.client_request_id).trim()
      : '';

    if (clientRequestId) {
      const existingByReq = db
        .prepare(
          `
          SELECT p.*, a.account_name as supplier_name, a.account_code as supplier_code
          FROM purchases p
          INNER JOIN accounts a ON a.id = p.supplier_account_id
          WHERE p.client_request_id = ?
          LIMIT 1
        `
        )
        .get(clientRequestId) as Record<string, unknown> | undefined;

      if (existingByReq) {
        const existingItems = db
          .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
          .all(existingByReq.id);
        return res.status(200).json({
          success: true,
          idempotentDuplicatePrevented: true,
          message: 'Purchase Invoice was already confirmed and saved.',
          purchase: existingByReq,
          items: existingItems,
        });
      }
    }

    const targetBillDate = String(
      req.body?.bill_date || req.body?.invoice_date || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    assertPeriodOpen(targetBillDate, 'create a purchase invoice');

    const username = req.user?.username || 'Super Admin';
    let newPurchaseId = 0;

    const createTx = db.transaction(() => {
      newPurchaseId = executePurchasePosting(req.body);
      db.prepare(
        'UPDATE purchases SET created_by = ?, updated_by = ?, client_request_id = ? WHERE id = ?'
      ).run(username, username, clientRequestId || null, newPurchaseId);
    });

    createTx();

    const created = db
      .prepare(`
        SELECT p.*, a.account_name as supplier_name, a.account_code as supplier_code
        FROM purchases p
        INNER JOIN accounts a ON a.id = p.supplier_account_id
        WHERE p.id = ?
      `)
      .get(newPurchaseId) as Record<string, unknown>;

    const items = db
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
      .all(newPurchaseId);

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'PURCHASE_INVOICE_CREATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      username,
      req.ip || '',
      `Created Purchase Invoice ${created.bill_number} (Supplier: ${created.supplier_name}, Net: Rs. ${created.net_total})`
    );

    return res.status(201).json({
      success: true,
      message: 'Purchase Invoice confirmed. Batch stock, Advance Tax, and Double-Entry ledgers updated.',
      purchase: created,
      items,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      module: 'purchases',
      operation: 'POST /api/purchases',
      userMessage: errorMsg,
      username: req.user?.username,
    });
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * PUT /api/purchases/:id
 * Safe editing of an existing Purchase Invoice (restricted to Super Admin / Administrator for posted invoices):
 * Reverses previous stock & accounting entries via formal reversal entry, then posts updated invoice.
 */
purchasesRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Purchase Invoice not found.' });
    }

    if (existing.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cancelled purchase invoices are permanently locked and cannot be edited.',
      });
    }

    if (existing.status === 'completed') {
      const role = req.user?.role || '';
      if (role !== 'Super Admin' && role !== 'Administrator') {
        return res.status(403).json({
          success: false,
          error:
            'Posted purchase invoices cannot be edited by non-administrative staff. Please use Purchase Return or contact a Super Admin.',
        });
      }
      triggerPreChangeBackupIfEnabled(
        `Modify Posted Purchase Invoice ${existing.bill_number}`,
        req.user?.username || 'Administrator'
      );
    }

    assertPeriodOpen(String(existing.bill_date || ''), 'edit an existing purchase invoice');
    if (req.body?.bill_date || req.body?.invoice_date) {
      assertPeriodOpen(
        String(req.body.bill_date || req.body.invoice_date),
        'move a purchase invoice into a closed period'
      );
    }

    const username = req.user?.username || 'Super Admin';
    const editTx = db.transaction(() => {
      reverseExistingPurchase(id, 'Invoice Edit & Re-posting');
      db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id);
      executePurchasePosting(req.body, id);
      db.prepare('UPDATE purchases SET updated_by = ? WHERE id = ?').run(username, id);
    });

    editTx();

    const updated = db
      .prepare(`
        SELECT p.*, a.account_name as supplier_name, a.account_code as supplier_code
        FROM purchases p
        INNER JOIN accounts a ON a.id = p.supplier_account_id
        WHERE p.id = ?
      `)
      .get(id) as Record<string, unknown>;

    const items = db
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
      .all(id);

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'PURCHASE_INVOICE_UPDATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      username,
      req.ip || '',
      `Updated Purchase Invoice ${updated.bill_number} (Net: Rs. ${updated.net_total})`
    );

    return res.json({
      success: true,
      message: 'Purchase Invoice updated with formal double-entry reversal and re-posting.',
      purchase: updated,
      items,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/purchases/:id/cancel & DELETE /api/purchases/:id
 * Safe cancellation of a Purchase Invoice through formal stock & double-entry accounting reversal (never physically deletes posted invoices)
 */
function handleCancelOrDeletePurchase(req: Request, res: Response) {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Purchase Invoice not found.' });
    }

    assertPeriodOpen(String(existing.bill_date || ''), 'cancel or delete a purchase invoice');

    // Held or draft purchases never affected stock or ledgers; allow clean discarding
    if (existing.status === 'held' || existing.status === 'draft') {
      const discardTx = db.transaction(() => {
        db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id);
        db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
      });
      discardTx();
      return res.json({
        success: true,
        message: `Held purchase draft ${existing.bill_number} discarded successfully.`,
      });
    }

    const role = req.user?.role || '';
    if (role !== 'Super Admin' && role !== 'Administrator') {
      return res.status(403).json({
        success: false,
        error: 'Only Super Admin or Administrator can cancel a posted Purchase Invoice.',
      });
    }

    const username = req.user?.username || 'Super Admin';
    const reason =
      req.body?.reason || req.body?.cancel_reason || 'Administrative Cancellation with Reversal';

    triggerPreChangeBackupIfEnabled(
      `Cancel Purchase Invoice ${existing.bill_number}`,
      username
    );

    const cancelTx = db.transaction(() => {
      reverseExistingPurchase(id, String(reason).trim());
      db.prepare(`
        UPDATE purchases SET
          status = 'cancelled',
          cancelled_by = ?,
          cancelled_at = CURRENT_TIMESTAMP,
          cancel_reason = ?,
          updated_by = ?,
          remarks = COALESCE(remarks, '') || ' [CANCELLED: ' || ? || ']',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(username, String(reason).trim(), username, String(reason).trim(), id);

      db.prepare(
        `
        INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
        VALUES (?, ?, 'PURCHASE_INVOICE_CANCELLED', 'WARNING', ?, ?)
      `
      ).run(
        req.user?.id || null,
        username,
        req.ip || '',
        `Cancelled Purchase Invoice ${existing.bill_number} (Reason: ${String(reason).trim()})`
      );
    });

    cancelTx();

    return res.json({
      success: true,
      message: `Purchase Invoice ${existing.bill_number} marked CANCELLED safely with formal stock and accounting reversal entries.`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
}

purchasesRouter.post('/:id/cancel', handleCancelOrDeletePurchase);
purchasesRouter.delete('/:id', handleCancelOrDeletePurchase);
