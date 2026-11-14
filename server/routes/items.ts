import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { triggerPreChangeBackupIfEnabled } from '../services/backupService.ts';
import {
  previewNextItemCode,
  allocateNextItemCode,
  ensureItemCodeSequenceTable,
} from '../utils/itemCodeGenerator.ts';

export const itemsRouter = Router();

export interface ItemRow {
  id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string | null;
  category: string;
  packing: string;
  barcode: string | null;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  loose_rate?: number;
  discount_percent: number;
  tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  rack_number: string | null;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

function parseUnitsFromPacking(packingStr: string): number {
  const raw = (packingStr || '1x1').trim().toLowerCase();
  const multMatch = raw.match(/(\d+)\s*[x*×]\s*(\d+)/);
  if (multMatch) {
    return Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10));
  }
  const singleMatch = raw.match(/(\d+)\s*(tab|cap|sachet|amp|vial|strip|unit|pc|pack|pill|softgel|lozenge|'s|s\b)/i);
  if (singleMatch) {
    return Math.max(1, parseInt(singleMatch[1], 10));
  }
  if (!/ml|mg|gm|g\b|kg|l\b|oz|drop|syr|susp|cream|oint|gel|lotion|inj|inf/i.test(raw)) {
    const plainNum = raw.match(/^(\d+)$/);
    if (plainNum) {
      return Math.max(1, parseInt(plainNum[1], 10));
    }
  }
  return 1;
}

export function calculateRetailPriceFromPurchase(purchasePrice: number): {
  retailBase: number;
  roundedRetailPrice: number;
} {
  const p = Math.max(0, Number(purchasePrice) || 0);
  const retailBase = p > 0 ? round2(p / 0.85) : 0;
  return { retailBase, roundedRetailPrice: retailBase };
}

function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * GET /api/items
 * Fast search and filtering by Item Code, Barcode, Item Name, Company Name
 */
itemsRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      q,
      category,
      company,
      status,
      lowStock,
      sortBy = 'item_name',
      sortOrder = 'asc',
    } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Fast search across Item Code, Barcode, Item Name, and Company Name
    if (q && typeof q === 'string' && q.trim().length > 0) {
      const term = `%${q.trim()}%`;
      conditions.push(
        '(item_code LIKE ? OR barcode LIKE ? OR item_name LIKE ? OR company_name LIKE ? OR generic_name LIKE ?)'
      );
      params.push(term, term, term, term, term);
    }

    if (category && typeof category === 'string' && category !== 'all') {
      conditions.push('category = ?');
      params.push(category);
    }

    if (company && typeof company === 'string' && company !== 'all') {
      conditions.push('company_name = ?');
      params.push(company);
    }

    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    if (lowStock === 'true') {
      conditions.push('opening_stock <= minimum_stock');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowed sort columns to prevent SQL injection
    const allowedSortColumns: Record<string, string> = {
      item_name: 'item_name',
      item_code: 'item_code',
      company_name: 'company_name',
      category: 'category',
      retail_price: 'retail_price',
      trade_price: 'trade_price',
      purchase_price: 'purchase_price',
      opening_stock: 'opening_stock',
      rack_number: 'rack_number',
      created_at: 'created_at',
    };

    const sortCol = allowedSortColumns[String(sortBy)] || 'item_name';
    const sortDir = String(sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const sql = `
      SELECT * FROM items 
      ${whereClause} 
      ORDER BY ${sortCol} ${sortDir}
    `;

    const items = db.prepare(sql).all(...params) as ItemRow[];

    // Calculate store summary statistics
    const statsSql = `
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_items,
        SUM(CASE WHEN opening_stock <= minimum_stock THEN 1 ELSE 0 END) as low_stock_items,
        SUM(opening_stock * trade_price) as total_trade_value,
        SUM(opening_stock * retail_price) as total_retail_value,
        SUM(opening_stock) as total_stock_units
      FROM items
    `;
    const stats = db.prepare(statsSql).get() as {
      total_items: number;
      active_items: number;
      low_stock_items: number;
      total_trade_value: number;
      total_retail_value: number;
      total_stock_units: number;
    };

    // Distinct categories and companies for filter dropdowns
    const categories = (
      db.prepare("SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != '' ORDER BY category ASC").all() as Array<{ category: string }>
    ).map((r) => r.category);

    const companies = (
      db.prepare("SELECT DISTINCT company_name FROM items WHERE company_name IS NOT NULL AND company_name != '' ORDER BY company_name ASC").all() as Array<{ company_name: string }>
    ).map((r) => r.company_name);

    return res.json({
      success: true,
      items,
      count: items.length,
      stats: {
        totalItems: stats.total_items || 0,
        activeItems: stats.active_items || 0,
        lowStockItems: stats.low_stock_items || 0,
        totalTradeValue: stats.total_trade_value || 0,
        totalRetailValue: stats.total_retail_value || 0,
        totalStockUnits: stats.total_stock_units || 0,
      },
      filters: {
        categories,
        companies,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to fetch items: ${errorMsg}` });
  }
});

/**
 * GET /api/items/next-code
 * Preview the next automatic sequential Item Code from the persistent SQLite database
 */
itemsRouter.get('/next-code', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const codeInfo = previewNextItemCode(db);
    return res.json({
      success: true,
      ...codeInfo,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to generate next item code: ${errorMsg}` });
  }
});

/**
 * GET /api/items/check-code/:code
 * Real-time check to prevent duplicate Item Codes
 */
itemsRouter.get('/check-code/:code', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { code } = req.params;
    const { excludeId } = req.query;

    let sql = 'SELECT id, item_code, item_name FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?))';
    const params: unknown[] = [code];

    if (excludeId) {
      sql += ' AND id != ?';
      params.push(parseInt(String(excludeId), 10));
    }

    const existing = db.prepare(sql).get(...params) as { id: number; item_code: string; item_name: string } | undefined;

    return res.json({
      exists: Boolean(existing),
      item: existing || null,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/:id
 */
itemsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    return res.json({ success: true, item });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/items
 * Add new Item with duplicate Item Code prevention and decimal pricing
 */
itemsRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      item_code,
      company_name,
      item_name,
      generic_name = '',
      category,
      packing = '1x1',
      barcode = '',
      purchase_price = 0,
      trade_price = 0,
      wholesale_price = 0,
      retail_price = 0,
      loose_rate,
      discount_percent = 0,
      tax_percent = 0,
      opening_stock = 0,
      minimum_stock = 0,
      rack_number = '',
      status = 'Active',
    } = req.body;

    // Required fields validation
    if (!company_name || String(company_name).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Company Name is required.' });
    }
    if (!item_name || String(item_name).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Item Name is required.' });
    }
    if (!category || String(category).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Category is required.' });
    }
    if (!packing || String(packing).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Packing is required.' });
    }

    // Decimal numbers parsing
    const pPrice = Math.round((parseFloat(purchase_price) || 0.0) * 100) / 100;
    const tPrice = Math.round((parseFloat(trade_price) || 0.0) * 100) / 100;
    const wPrice = Math.round((parseFloat(wholesale_price) || 0.0) * 100) / 100;
    const rPrice = Math.round((parseFloat(retail_price) || 0.0) * 100) / 100;
    const packingUnits = parseUnitsFromPacking(String(packing));
    const parsedLoose = loose_rate !== undefined && loose_rate !== null && String(loose_rate).trim() !== ''
      ? parseFloat(loose_rate)
      : NaN;
    const lRate = !isNaN(parsedLoose) && parsedLoose >= 0
      ? round2(parsedLoose > 0 ? parsedLoose : rPrice / Math.max(1, packingUnits))
      : round2(rPrice / Math.max(1, packingUnits));
    const dPercent = Math.round((parseFloat(discount_percent) || 0.0) * 100) / 100;
    const tPercent = Math.round((parseFloat(tax_percent) || 0.0) * 100) / 100;
    const oStock = Math.round((parseFloat(opening_stock) || 0.0) * 100) / 100;
    const mStock = Math.round((parseFloat(minimum_stock) || 0.0) * 100) / 100;
    const itemStatus = status === 'Inactive' ? 'Inactive' : 'Active';

    const createItemTx = db.transaction(() => {
      const requestedCode = item_code ? String(item_code).trim() : '';
      // Atomically allocate a guaranteed unique sequential item code
      // (If requestedCode is empty or already taken due to simultaneous creation, allocateNextItemCode advances to the next unused sequential code)
      const allocated = allocateNextItemCode(db, requestedCode);
      const finalCode = allocated.next_code;

      const insertSql = `
        INSERT INTO items (
          item_code, company_name, item_name, generic_name, category, packing, barcode,
          purchase_price, trade_price, wholesale_price, retail_price, loose_rate, discount_percent, tax_percent,
          opening_stock, minimum_stock, rack_number, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = db.prepare(insertSql).run(
        finalCode,
        String(company_name).trim(),
        String(item_name).trim(),
        generic_name ? String(generic_name).trim() : null,
        String(category).trim(),
        String(packing).trim(),
        barcode ? String(barcode).trim() : null,
        pPrice,
        tPrice,
        wPrice,
        rPrice,
        lRate,
        dPercent,
        tPercent,
        oStock,
        mStock,
        rack_number ? String(rack_number).trim() : null,
        itemStatus
      );

      const newItemId = Number(result.lastInsertRowid);
      db.prepare('UPDATE item_code_history SET item_id = ? WHERE LOWER(item_code) = LOWER(?)').run(
        newItemId,
        finalCode
      );

      return db.prepare('SELECT * FROM items WHERE id = ?').get(newItemId) as ItemRow;
    });

    const newItem = createItemTx();

    return res.status(201).json({
      success: true,
      message: `Item "${newItem.item_name}" (${newItem.item_code}) created successfully.`,
      item: newItem,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to create item: ${errorMsg}` });
  }
});

/**
 * PUT /api/items/:id
 * Edit existing item with duplicate code protection
 */
itemsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const existingItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
    if (!existingItem) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    const {
      item_code,
      company_name,
      item_name,
      generic_name,
      category,
      packing,
      barcode,
      purchase_price,
      trade_price,
      wholesale_price,
      retail_price,
      loose_rate,
      discount_percent,
      tax_percent,
      opening_stock,
      minimum_stock,
      rack_number,
      status,
      expected_updated_at,
      force_overwrite,
    } = req.body;

    // Multi-Computer Simultaneous Editing Conflict Detection
    if (
      expected_updated_at &&
      existingItem.updated_at &&
      String(expected_updated_at) !== String(existingItem.updated_at) &&
      !force_overwrite
    ) {
      return res.status(409).json({
        success: false,
        conflict: true,
        server_updated_at: existingItem.updated_at,
        error:
          'Simultaneous Edit Conflict Detected: This item was modified by another computer after you opened it. Please refresh to view the latest changes so newer data is not overwritten.',
      });
    }

    const cleanCode = item_code ? String(item_code).trim() : existingItem.item_code;

    // Check for duplicate code excluding current item
    const duplicateCheck = db
      .prepare('SELECT id FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?)) AND id != ?')
      .get(cleanCode, id) as { id: number } | undefined;

    if (duplicateCheck) {
      return res.status(400).json({
        success: false,
        error: `Item Code "${cleanCode}" is already in use by another item. Duplicate codes are not allowed.`,
      });
    }

    const pPrice = purchase_price !== undefined ? Math.round((parseFloat(purchase_price) || 0.0) * 100) / 100 : existingItem.purchase_price;
    const tPrice = trade_price !== undefined ? Math.round((parseFloat(trade_price) || 0.0) * 100) / 100 : existingItem.trade_price;
    const wPrice = wholesale_price !== undefined ? Math.round((parseFloat(wholesale_price) || 0.0) * 100) / 100 : existingItem.wholesale_price;
    const rPrice = retail_price !== undefined ? Math.round((parseFloat(retail_price) || 0.0) * 100) / 100 : existingItem.retail_price;
    const finalPacking = packing !== undefined ? String(packing).trim() : existingItem.packing;
    const packingUnits = parseUnitsFromPacking(finalPacking);
    const existingLoose = Number(existingItem.loose_rate || 0) > 0
      ? round2(Number(existingItem.loose_rate))
      : round2(rPrice / Math.max(1, packingUnits));
    const lRate =
      loose_rate !== undefined && loose_rate !== null && String(loose_rate).trim() !== ''
        ? round2(Math.max(0, parseFloat(loose_rate) || 0.0))
        : existingLoose;
    const dPercent = discount_percent !== undefined ? Math.round((parseFloat(discount_percent) || 0.0) * 100) / 100 : existingItem.discount_percent;
    const tPercent = tax_percent !== undefined ? Math.round((parseFloat(tax_percent) || 0.0) * 100) / 100 : existingItem.tax_percent;
    const oStock = opening_stock !== undefined ? Math.round((parseFloat(opening_stock) || 0.0) * 100) / 100 : existingItem.opening_stock;
    const mStock = minimum_stock !== undefined ? Math.round((parseFloat(minimum_stock) || 0.0) * 100) / 100 : existingItem.minimum_stock;
    const itemStatus = status !== undefined ? (status === 'Inactive' ? 'Inactive' : 'Active') : existingItem.status;

    const updateSql = `
      UPDATE items SET
        item_code = ?,
        company_name = ?,
        item_name = ?,
        generic_name = ?,
        category = ?,
        packing = ?,
        barcode = ?,
        purchase_price = ?,
        trade_price = ?,
        wholesale_price = ?,
        retail_price = ?,
        loose_rate = ?,
        discount_percent = ?,
        tax_percent = ?,
        opening_stock = ?,
        minimum_stock = ?,
        rack_number = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    db.prepare(updateSql).run(
      cleanCode,
      company_name !== undefined ? String(company_name).trim() : existingItem.company_name,
      item_name !== undefined ? String(item_name).trim() : existingItem.item_name,
      generic_name !== undefined ? (generic_name ? String(generic_name).trim() : null) : existingItem.generic_name,
      category !== undefined ? String(category).trim() : existingItem.category,
      finalPacking,
      barcode !== undefined ? (barcode ? String(barcode).trim() : null) : existingItem.barcode,
      pPrice,
      tPrice,
      wPrice,
      rPrice,
      lRate,
      dPercent,
      tPercent,
      oStock,
      mStock,
      rack_number !== undefined ? (rack_number ? String(rack_number).trim() : null) : existingItem.rack_number,
      itemStatus,
      id
    );

    const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow;

    return res.json({
      success: true,
      message: `Item "${updatedItem.item_name}" updated successfully.`,
      item: updatedItem,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to update item: ${errorMsg}` });
  }
});

/**
 * PATCH /api/items/:id/price-cascade
 * Safe transactional Item Master price update triggered during Purchase Entry.
 * - Updates ONLY purchase_price when update_purchase_price = true
 * - Updates retail_price (New Purchase Price * 1.15 rounded UP to next multiple of Rs. 50)
 *   and loose_rate (New Retail Price / Units Per Pack) ONLY when update_retail_price = true
 * - Preserves Item ID, Item Code, barcode, packing, wholesale_price, trade_price, stock, batches, and historical invoices.
 */
itemsRouter.patch('/:id/price-cascade', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Valid Item ID is required.' });
    }

    const existingItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
    if (!existingItem) {
      return res.status(404).json({ success: false, error: 'Item not found in Item Master.' });
    }

    const newPurchasePrice = round2(parseFloat(req.body.new_purchase_price));
    const updatePurchasePrice = Boolean(req.body.update_purchase_price);
    const updateRetailPrice = Boolean(req.body.update_retail_price);

    if (newPurchasePrice <= 0) {
      return res.status(400).json({ success: false, error: 'New Purchase Price must be greater than zero.' });
    }

    const unitsPerPack = Math.max(1, parseUnitsFromPacking(existingItem.packing || '1x1'));
    const { retailBase, roundedRetailPrice } = calculateRetailPriceFromPurchase(newPurchasePrice);
    const calculatedLooseRate = round2(roundedRetailPrice / unitsPerPack);

    const oldPurchasePrice = round2(existingItem.purchase_price);
    const oldRetailPrice = round2(existingItem.retail_price);
    const oldLooseRate = round2(
      existingItem.loose_rate && Number(existingItem.loose_rate) > 0
        ? existingItem.loose_rate
        : oldRetailPrice / unitsPerPack
    );

    const runCascade = db.transaction(() => {
      if (!updatePurchasePrice) {
        return;
      }

      if (updateRetailPrice) {
        db.prepare(`
          UPDATE items
          SET purchase_price = ?,
              retail_price = ?,
              loose_rate = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newPurchasePrice, roundedRetailPrice, calculatedLooseRate, id);
      } else {
        db.prepare(`
          UPDATE items
          SET purchase_price = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newPurchasePrice, id);
      }
    });

    runCascade();

    const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow;

    return res.json({
      success: true,
      item: updatedItem,
      cascade: {
        item_id: id,
        item_code: updatedItem.item_code,
        item_name: updatedItem.item_name,
        packing: updatedItem.packing,
        units_per_pack: unitsPerPack,
        old_purchase_price: oldPurchasePrice,
        new_purchase_price: round2(updatedItem.purchase_price),
        retail_base: retailBase,
        old_retail_price: oldRetailPrice,
        new_retail_price: round2(updatedItem.retail_price),
        old_loose_rate: oldLooseRate,
        new_loose_rate: round2(
          updatedItem.loose_rate && Number(updatedItem.loose_rate) > 0
            ? updatedItem.loose_rate
            : Number(updatedItem.retail_price) / unitsPerPack
        ),
        updated_purchase_price: updatePurchasePrice,
        updated_retail_price: updatePurchasePrice && updateRetailPrice,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to update Item Master prices: ${errorMsg}`,
    });
  }
});

/**
 * DELETE /api/items/:id
 * Delete an item permanently
 */
itemsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);

    const existing = db.prepare('SELECT id, item_code, item_name FROM items WHERE id = ?').get(id) as { id: number; item_code: string; item_name: string } | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    const salesCount = db.prepare('SELECT COUNT(*) as c FROM sale_items WHERE item_id = ?').get(id) as { c: number };
    const purCount = db.prepare('SELECT COUNT(*) as c FROM purchase_items WHERE item_id = ?').get(id) as { c: number };
    if (salesCount.c > 0 || purCount.c > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete "${existing.item_name}" because it is linked to historical sales/purchase invoices. Set its status to Inactive instead.`,
      });
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(id);

    return res.json({
      success: true,
      message: `Item "${existing.item_name}" (${existing.item_code}) has been permanently deleted.`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to delete item: ${errorMsg}` });
  }
});

/**
 * POST /api/items/bulk-import
 * Excel import endpoint: validates rows, detects duplicates, inserts/updates permanently
 */
itemsRouter.post('/bulk-import', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { items, updateExisting = false } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided for import.' });
    }

    const errors: string[] = [];
    const seenCodesInBatch = new Set<string>();

    // 1. Validation pass
    items.forEach((item, index) => {
      const rowNum = index + 2; // header is row 1
      const code = item.item_code ? String(item.item_code).trim() : '';

      if (!code) {
        errors.push(`Row ${rowNum}: Item Code is missing.`);
      } else {
        const upperCode = code.toUpperCase();
        if (seenCodesInBatch.has(upperCode)) {
          errors.push(`Row ${rowNum}: Duplicate Item Code "${code}" appears multiple times in this spreadsheet.`);
        } else {
          seenCodesInBatch.add(upperCode);
        }
      }

      if (!item.company_name || String(item.company_name).trim().length === 0) {
        errors.push(`Row ${rowNum}: Company Name is missing.`);
      }
      if (!item.item_name || String(item.item_name).trim().length === 0) {
        errors.push(`Row ${rowNum}: Item Name is missing.`);
      }
    });

    if (errors.length > 0 && !updateExisting) {
      // Check existing database codes
      const existingCodes = (
        db.prepare('SELECT item_code FROM items').all() as Array<{ item_code: string }>
      ).map((r) => r.item_code.toUpperCase());

      const dbDuplicates: string[] = [];
      seenCodesInBatch.forEach((code) => {
        if (existingCodes.includes(code)) {
          dbDuplicates.push(code);
        }
      });

      if (dbDuplicates.length > 0) {
        errors.push(
          `The following Item Codes already exist in the database: ${dbDuplicates.join(', ')}. Enable "Update Existing" to overwrite them, or modify the codes.`
        );
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Import validation failed.',
        errors,
      });
    }

    // 2. Create automatic pre-change safety backup before bulk import
    triggerPreChangeBackupIfEnabled(
      `Bulk Item Import (${items.length} rows)`,
      req.user?.username || 'Administrator'
    );

    // 3. Execution in a transaction
    let insertedCount = 0;
    let updatedCount = 0;

    const insertOrUpdate = db.transaction(() => {
      const checkStmt = db.prepare('SELECT id FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?))');
      const insertStmt = db.prepare(`
        INSERT INTO items (
          item_code, company_name, item_name, generic_name, category, packing, barcode,
          purchase_price, trade_price, wholesale_price, retail_price, discount_percent, tax_percent,
          opening_stock, minimum_stock, rack_number, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStmt = db.prepare(`
        UPDATE items SET
          company_name = ?,
          item_name = ?,
          generic_name = ?,
          category = ?,
          packing = ?,
          barcode = ?,
          purchase_price = ?,
          trade_price = ?,
          wholesale_price = ?,
          retail_price = ?,
          discount_percent = ?,
          tax_percent = ?,
          opening_stock = ?,
          minimum_stock = ?,
          rack_number = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (const item of items) {
        const code = String(item.item_code).trim();
        const existing = checkStmt.get(code) as { id: number } | undefined;

        const company = String(item.company_name || '').trim();
        const name = String(item.item_name || '').trim();
        const generic = item.generic_name ? String(item.generic_name).trim() : null;
        const category = String(item.category || 'Tablet').trim();
        const packing = String(item.packing || '1x1').trim();
        const barcode = item.barcode ? String(item.barcode).trim() : null;
        const pPrice = Math.round((parseFloat(item.purchase_price) || 0.0) * 100) / 100;
        const tPrice = Math.round((parseFloat(item.trade_price) || 0.0) * 100) / 100;
        const wPrice = Math.round((parseFloat(item.wholesale_price) || 0.0) * 100) / 100;
        const rPrice = Math.round((parseFloat(item.retail_price) || 0.0) * 100) / 100;
        const dPercent = Math.round((parseFloat(item.discount_percent) || 0.0) * 100) / 100;
        const tPercent = Math.round((parseFloat(item.tax_percent) || 0.0) * 100) / 100;
        const oStock = Math.round((parseFloat(item.opening_stock) || 0.0) * 100) / 100;
        const mStock = Math.round((parseFloat(item.minimum_stock) || 0.0) * 100) / 100;
        const rack = item.rack_number ? String(item.rack_number).trim() : null;
        const status = String(item.status).toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

        if (existing) {
          if (updateExisting) {
            updateStmt.run(
              company,
              name,
              generic,
              category,
              packing,
              barcode,
              pPrice,
              tPrice,
              wPrice,
              rPrice,
              dPercent,
              tPercent,
              oStock,
              mStock,
              rack,
              status,
              existing.id
            );
            updatedCount++;
          }
        } else {
          insertStmt.run(
            code,
            company,
            name,
            generic,
            category,
            packing,
            barcode,
            pPrice,
            tPrice,
            wPrice,
            rPrice,
            dPercent,
            tPercent,
            oStock,
            mStock,
            rack,
            status
          );
          insertedCount++;
        }
      }
    });

    insertOrUpdate();
    ensureItemCodeSequenceTable(db);

    return res.json({
      success: true,
      message: `Excel import processed successfully. Added: ${insertedCount}, Updated: ${updatedCount}.`,
      insertedCount,
      updatedCount,
      totalProcessed: items.length,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to import items: ${errorMsg}` });
  }
});
