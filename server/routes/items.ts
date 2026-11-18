import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { triggerPreChangeBackupIfEnabled } from '../services/backupService.ts';
import {
  previewNextItemCode,
  allocateNextItemCode,
  ensureItemCodeSequenceTable,
} from '../utils/itemCodeGenerator.ts';
import { saveProductImage, deleteUnusedProductImage } from '../services/productMediaService.ts';
import {
  getNextVariantCodeForItem,
  generateUniqueVariantBarcode,
  findBarcodeConflict,
  getEnrichedVariants,
  lookupItemByBarcodeExact,
} from '../services/itemVariantService.ts';

export const itemsRouter = Router();

export interface ItemRow {
  id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string | null;
  category: string;
  packing: string;
  carton?: number | null;
  boxes_per_carton?: number | null;
  strips_per_box?: number | null;
  tablets_per_strip?: number | null;
  units_per_strip?: number | null;
  units_per_pack?: number | null;
  purchase_unit?: string | null;
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
  has_variants?: number;
  image_id?: number | null;
  image_url?: string;
  thumbnail_url?: string;
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

function parseOptionalPositiveInt(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Math.round(Number(val));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalPositiveFloat(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = round2(Number(val));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePurchaseUnit(val: unknown, fallback: string = 'Box'): 'Carton' | 'Box' | 'Strip' | 'Tablet' {
  const clean = String(val || fallback || 'Box').trim();
  if (clean === 'Carton' || clean === 'Box' || clean === 'Strip' || clean === 'Tablet') {
    return clean;
  }
  return 'Box';
}

function resolveMultiLevelPackingConfig(
  input: {
    packing?: unknown;
    carton?: unknown;
    boxes_per_carton?: unknown;
    strips_per_box?: unknown;
    tablets_per_strip?: unknown;
    units_per_strip?: unknown;
    units_per_pack?: unknown;
    purchase_unit?: unknown;
  },
  existing?: Partial<ItemRow>
) {
  const carton =
    input.carton !== undefined
      ? parseOptionalPositiveFloat(input.carton)
      : parseOptionalPositiveFloat(existing?.carton);
  const boxesPerCarton =
    input.boxes_per_carton !== undefined
      ? parseOptionalPositiveInt(input.boxes_per_carton)
      : parseOptionalPositiveInt(existing?.boxes_per_carton);
  let stripsPerBox =
    input.strips_per_box !== undefined
      ? parseOptionalPositiveInt(input.strips_per_box)
      : parseOptionalPositiveInt(existing?.strips_per_box);
  let tabletsPerStrip =
    input.tablets_per_strip !== undefined
      ? parseOptionalPositiveInt(input.tablets_per_strip)
      : input.units_per_strip !== undefined
      ? parseOptionalPositiveInt(input.units_per_strip)
      : parseOptionalPositiveInt(existing?.tablets_per_strip ?? existing?.units_per_strip);

  const purchaseUnit = normalizePurchaseUnit(input.purchase_unit, existing?.purchase_unit || 'Box');

  let finalPacking =
    input.packing !== undefined && String(input.packing).trim() !== ''
      ? String(input.packing).trim()
      : String(existing?.packing || '').trim();

  const matrixMatch = finalPacking.match(/^(\d+)\s*[xX*×]\s*(\d+)$/);

  if (stripsPerBox && tabletsPerStrip) {
    if (!finalPacking || finalPacking === '1x1' || matrixMatch) {
      finalPacking = `${stripsPerBox}x${tabletsPerStrip}`;
    }
  } else if (tabletsPerStrip && !stripsPerBox) {
    if (!finalPacking || finalPacking === '1x1') {
      finalPacking = `1x${tabletsPerStrip}`;
    }
  } else if (stripsPerBox && !tabletsPerStrip) {
    if (!finalPacking || finalPacking === '1x1') {
      finalPacking = `${stripsPerBox}x1`;
    }
  }

  if (!finalPacking) {
    finalPacking = '1x1';
  }

  const resolvedMatrix = finalPacking.match(/(\d+)\s*[xX*×]\s*(\d+)/);
  if (resolvedMatrix) {
    if (!stripsPerBox) {
      stripsPerBox = Math.max(1, parseInt(resolvedMatrix[1], 10) || 1);
    }
    if (!tabletsPerStrip) {
      tabletsPerStrip = Math.max(1, parseInt(resolvedMatrix[2], 10) || 1);
    }
  }

  const effStrips = stripsPerBox && stripsPerBox > 0 ? stripsPerBox : 1;
  const effTablets =
    tabletsPerStrip && tabletsPerStrip > 0
      ? tabletsPerStrip
      : resolvedMatrix
      ? Math.max(1, parseInt(resolvedMatrix[2], 10) || 1)
      : parseUnitsFromPacking(finalPacking);
  const unitsPerStrip = Math.max(1, effTablets);
  const unitsPerPack =
    stripsPerBox || tabletsPerStrip
      ? Math.max(1, effStrips * effTablets)
      : Math.max(1, parseUnitsFromPacking(finalPacking));

  return {
    packing: finalPacking,
    carton,
    boxes_per_carton: boxesPerCarton,
    strips_per_box: stripsPerBox,
    tablets_per_strip: tabletsPerStrip,
    units_per_strip: unitsPerStrip,
    units_per_pack: unitsPerPack,
    purchase_unit: purchaseUnit,
  };
}

function enrichItemWithPacking(it: ItemRow) {
  const resolved = resolveMultiLevelPackingConfig({}, it);
  return {
    ...it,
    packing: resolved.packing,
    carton: resolved.carton,
    boxes_per_carton: resolved.boxes_per_carton,
    strips_per_box: resolved.strips_per_box ?? 1,
    tablets_per_strip: resolved.tablets_per_strip ?? resolved.units_per_strip,
    units_per_strip: resolved.units_per_strip,
    units_per_pack: resolved.units_per_pack,
    purchase_unit: resolved.purchase_unit,
  };
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

    // Fast search across Item Code, Barcode, Item Name, Company Name, plus Variant Codes/Names/Attributes/Barcodes
    if (q && typeof q === 'string' && q.trim().length > 0) {
      const term = `%${q.trim()}%`;
      conditions.push(
        `(item_code LIKE ? OR barcode LIKE ? OR item_name LIKE ? OR company_name LIKE ? OR generic_name LIKE ? OR EXISTS (
          SELECT 1 FROM item_variants iv
          WHERE iv.parent_item_id = items.id
            AND (iv.variant_code LIKE ? OR iv.variant_name LIKE ? OR iv.colour LIKE ? OR iv.flavour LIKE ? OR iv.variant_type LIKE ? OR iv.other_attributes LIKE ? OR iv.barcode LIKE ?)
        ) OR EXISTS (
          SELECT 1 FROM item_variant_barcodes ib
          WHERE ib.item_id = items.id AND ib.barcode LIKE ?
        ))`
      );
      params.push(term, term, term, term, term, term, term, term, term, term, term, term, term);
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

    const rawItems = db.prepare(sql).all(...params) as ItemRow[];

    // Attach variants & consolidated non-double-counted inventory stock in batch
    const itemIds = rawItems.map((it) => Number(it.id));
    const variantsByItem = new Map<number, ReturnType<typeof getEnrichedVariants>>();
    const nonVariantStockByItem = new Map<number, { packs: number; hasBatches: boolean }>();

    if (itemIds.length > 0) {
      const allVariants = getEnrichedVariants({ parentItemIds: itemIds, includeInactive: true });
      for (const v of allVariants) {
        if (!variantsByItem.has(v.parent_item_id)) {
          variantsByItem.set(v.parent_item_id, []);
        }
        variantsByItem.get(v.parent_item_id)!.push(v);
      }

      const ph = itemIds.map(() => '?').join(',');
      const invSums = db
        .prepare(
          `SELECT item_id, COALESCE(SUM(current_pack_qty), 0) AS packs, COUNT(*) AS batch_count
           FROM inventory
           WHERE item_id IN (${ph}) AND COALESCE(variant_key, 0) = 0
           GROUP BY item_id`
        )
        .all(...itemIds) as Array<{ item_id: number; packs: number; batch_count: number }>;

      for (const row of invSums) {
        nonVariantStockByItem.set(Number(row.item_id), {
          packs: round2(Number(row.packs || 0)),
          hasBatches: Number(row.batch_count || 0) > 0,
        });
      }
    }

    const items = rawItems.map((it) => {
      const itemId = Number(it.id);
      const itemVariants = variantsByItem.get(itemId) || [];
      const hasVariants = Number(it.has_variants || 0) === 1;
      const activeVariants = itemVariants.filter((v) => v.status === 'Active');

      let consolidatedStockPacks = 0;
      if (hasVariants) {
        // Consolidated stock = sum of variant stocks only (never double-counts parent opening_stock)
        consolidatedStockPacks = round2(
          itemVariants.reduce((sum, v) => sum + Number(v.current_stock_packs || 0), 0)
        );
      } else {
        const invInfo = nonVariantStockByItem.get(itemId);
        consolidatedStockPacks = invInfo?.hasBatches ? invInfo.packs : round2(Number(it.opening_stock || 0));
      }

      return {
        ...enrichItemWithPacking(it),
        has_variants: hasVariants ? 1 : 0,
        image_url: String(it.image_url || ''),
        thumbnail_url: String(it.thumbnail_url || it.image_url || ''),
        variant_count: itemVariants.length,
        active_variant_count: activeVariants.length,
        consolidated_stock_packs: consolidatedStockPacks,
        variants: itemVariants,
      };
    });

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

    // Distinct categories and deduplicated companies for filter dropdowns
    const categories = (
      db.prepare("SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != '' ORDER BY category ASC").all() as Array<{ category: string }>
    ).map((r) => r.category);

    const companies = getDeduplicatedItemCompanies(db);

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
 * Normalizes a Company Name by trimming outer spaces and collapsing internal whitespace.
 */
function normalizeCompanyName(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Ensures the persistent item_companies table exists and is non-destructively synced
 * with existing item records (items.company_name). Never modifies or deletes any existing items.
 */
export function ensureItemCompaniesTableAndSync(db: ReturnType<typeof getDatabase>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const existingItemCompanies = db
    .prepare(
      `SELECT DISTINCT TRIM(company_name) as c FROM items WHERE company_name IS NOT NULL AND TRIM(company_name) != ''`
    )
    .all() as Array<{ c: string }>;

  const insertCompany = db.prepare(
    "INSERT OR IGNORE INTO item_companies (company_name, status) VALUES (?, 'Active')"
  );
  for (const row of existingItemCompanies) {
    const clean = normalizeCompanyName(row.c);
    if (clean) {
      insertCompany.run(clean);
    }
  }
}

/**
 * Returns a sorted, case-insensitively deduplicated list of all existing item companies
 * from item_companies and items.company_name.
 */
export function getDeduplicatedItemCompanies(db: ReturnType<typeof getDatabase>): string[] {
  ensureItemCompaniesTableAndSync(db);

  const rows = db
    .prepare(
      `SELECT company_name as name FROM item_companies WHERE status = 'Active' AND TRIM(company_name) != ''
       UNION
       SELECT company_name as name FROM items WHERE company_name IS NOT NULL AND TRIM(company_name) != ''`
    )
    .all() as Array<{ name: string }>;

  const byKey = new Map<string, string>();
  for (const row of rows) {
    const clean = normalizeCompanyName(row.name);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, clean);
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

/**
 * Registers a company name in item_companies if not already present (case-insensitive)
 * and returns the canonical saved company name.
 */
function registerItemCompanyIfNew(db: ReturnType<typeof getDatabase>, rawCompany: unknown): string {
  const clean = normalizeCompanyName(rawCompany);
  if (!clean) return '';
  ensureItemCompaniesTableAndSync(db);

  const existing = db
    .prepare('SELECT company_name FROM item_companies WHERE LOWER(TRIM(company_name)) = LOWER(?)')
    .get(clean) as { company_name: string } | undefined;

  if (existing) {
    return existing.company_name;
  }

  db.prepare("INSERT OR IGNORE INTO item_companies (company_name, status) VALUES (?, 'Active')").run(clean);
  return clean;
}

/**
 * GET /api/items/companies
 * Fetch all existing Company names from Company Master (items & item_companies)
 */
itemsRouter.get('/companies', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const companies = getDeduplicatedItemCompanies(db);
    return res.json({
      success: true,
      companies,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to fetch companies: ${errorMsg}` });
  }
});

/**
 * POST /api/items/companies
 * Permanently save a new company in the Company Master with case-insensitive duplicate prevention
 */
itemsRouter.post('/companies', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const cleanCompany = normalizeCompanyName(req.body?.company_name ?? req.body?.company);

    if (!cleanCompany) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required.',
      });
    }

    const existingCompanies = getDeduplicatedItemCompanies(db);
    const duplicateMatch = existingCompanies.find(
      (c) => c.toLowerCase() === cleanCompany.toLowerCase()
    );

    if (duplicateMatch) {
      return res.status(400).json({
        success: false,
        duplicate: true,
        existingCompany: duplicateMatch,
        error: `Company "${duplicateMatch}" already exists. Duplicate company names are not allowed.`,
      });
    }

    db.prepare("INSERT INTO item_companies (company_name, status) VALUES (?, 'Active')").run(cleanCompany);

    const updatedCompanies = getDeduplicatedItemCompanies(db);
    return res.status(201).json({
      success: true,
      company: cleanCompany,
      companies: updatedCompanies,
      message: `Company "${cleanCompany}" added successfully.`,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: `Failed to add company: ${errorMsg}` });
  }
});

/**
 * POST /api/items/images
 * Upload & persist compressed Product / Variant image (JPG, JPEG, PNG, WebP)
 */
itemsRouter.post('/images', (req: Request, res: Response) => {
  try {
    const { image_data_url, thumbnail_data_url, original_filename, width, height } = req.body || {};
    if (!image_data_url) {
      return res.status(400).json({ success: false, error: 'Image payload is required.' });
    }
    const stored = saveProductImage({
      imageDataUrl: String(image_data_url),
      thumbnailDataUrl: thumbnail_data_url ? String(thumbnail_data_url) : undefined,
      originalFilename: original_filename ? String(original_filename) : undefined,
      width: width ? Number(width) : 0,
      height: height ? Number(height) : 0,
      createdBy: req.user?.username || 'Super Admin',
    });
    return res.status(201).json({ success: true, image: stored });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/lookup-barcode/:code
 * Resolves any scanned barcode to the exact Main Product or specific Variant
 */
itemsRouter.get('/lookup-barcode/:code', (req: Request, res: Response) => {
  try {
    const rawCode = decodeURIComponent(String(req.params.code || '')).trim();
    if (!rawCode) {
      return res.status(400).json({ success: false, error: 'Barcode is required.' });
    }
    const match = lookupItemByBarcodeExact(rawCode);
    return res.json({ success: true, ...match });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/generate-barcode
 * Generates a unique EAN-13 internal barcode when manufacturer barcode is missing
 */
itemsRouter.get('/generate-barcode', (req: Request, res: Response) => {
  try {
    const variantCode = req.query.variantCode ? String(req.query.variantCode) : '';
    const barcode = generateUniqueVariantBarcode(variantCode);
    return res.json({ success: true, barcode });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/variants
 * List all variants across Main Products with search/filter
 */
itemsRouter.get('/variants', (req: Request, res: Response) => {
  try {
    const parentItemId = req.query.parentItemId ? parseInt(String(req.query.parentItemId), 10) : null;
    const includeInactive = req.query.includeInactive !== 'false';
    const q = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'all').toLowerCase();

    let variants = getEnrichedVariants({
      parentItemId: parentItemId && parentItemId > 0 ? parentItemId : null,
      includeInactive,
    });

    if (statusFilter === 'active') {
      variants = variants.filter((v) => v.status === 'Active');
    } else if (statusFilter === 'inactive') {
      variants = variants.filter((v) => v.status === 'Inactive');
    }

    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      variants = variants.filter((v) => {
        const hay = `${v.variant_code} ${v.variant_name} ${v.parent_item_code} ${v.parent_item_name} ${v.company_name} ${v.colour} ${v.flavour} ${v.variant_type} ${v.other_attributes} ${v.barcode} ${v.barcodes.map((b) => b.barcode).join(' ')}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }

    return res.json({ success: true, variants, count: variants.length });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/:id/variants/next-code
 */
itemsRouter.get('/:id/variants/next-code', (req: Request, res: Response) => {
  try {
    const parentItemId = parseInt(req.params.id, 10);
    const nextVariantCode = getNextVariantCodeForItem(parentItemId);
    return res.json({ success: true, next_variant_code: nextVariantCode });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/items/:id/variants
 */
itemsRouter.get('/:id/variants', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const parentItemId = parseInt(req.params.id, 10);
    if (!Number.isFinite(parentItemId) || parentItemId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid Main Product ID.' });
    }
    const parentItem = db.prepare('SELECT * FROM items WHERE id = ?').get(parentItemId) as ItemRow | undefined;
    if (!parentItem) {
      return res.status(404).json({ success: false, error: 'Main Product not found.' });
    }
    const includeInactive =
      req.query.includeInactive !== 'false' && req.query.include_inactive !== 'false';
    const variants = getEnrichedVariants({ parentItemId, includeInactive });
    const nextVariantCode = getNextVariantCodeForItem(parentItemId);
    return res.json({
      success: true,
      parent: enrichItemWithPacking(parentItem),
      variants,
      nextVariantCode,
      count: variants.length,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/items/:id/variants
 * Create a new variant under Main Product
 */
itemsRouter.post('/:id/variants', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const parentItemId = parseInt(req.params.id, 10);
    const parentItem = db.prepare('SELECT * FROM items WHERE id = ?').get(parentItemId) as ItemRow | undefined;
    if (!parentItem) {
      return res.status(404).json({ success: false, error: 'Main Product not found.' });
    }

    const safeStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
    const safeNum = (v: unknown, fallback = 0): number => {
      if (v === null || v === undefined || v === '') return Number.isFinite(fallback) ? fallback : 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.isFinite(fallback) ? fallback : 0;
    };

    const body = req.body || {};
    const colourVal = safeStr(body.colour);
    const flavourVal = safeStr(body.flavour);
    const typeVal = safeStr(body.variant_type);
    const otherAttrVal = safeStr(body.other_attributes);
    const variantName =
      safeStr(body.variant_name) ||
      [colourVal, flavourVal, typeVal, otherAttrVal].filter(Boolean).join(' / ');
    if (!variantName) {
      return res.status(400).json({
        success: false,
        error: 'Variant Name or at least one attribute (Colour / Flavour / Type) is required.',
      });
    }

    const createVariantTx = db.transaction(() => {
      let variantCode = safeStr(body.variant_code);
      if (!variantCode) {
        variantCode = getNextVariantCodeForItem(parentItemId);
      } else {
        const dupV = db
          .prepare('SELECT id FROM item_variants WHERE UPPER(TRIM(variant_code)) = UPPER(TRIM(?))')
          .get(variantCode);
        const dupI = db
          .prepare('SELECT id FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?))')
          .get(variantCode);
        if (dupV || dupI) {
          throw new Error(`Variant Code "${variantCode}" already exists. Duplicate codes are not allowed.`);
        }
      }

      const rawBarcode = safeStr(body.barcode);
      const extraBarcodesInput: Array<{ barcode: string; barcode_type?: string }> = Array.isArray(body.barcodes)
        ? body.barcodes
        : [];
      const allSubmittedBarcodes = [
        ...(rawBarcode
          ? [{ barcode: rawBarcode, barcode_type: safeStr(body.barcode_type) || 'manufacturer', is_primary: 1 }]
          : []),
        ...extraBarcodesInput
          .filter((b) => b && safeStr(b.barcode))
          .map((b) => ({
            barcode: safeStr(b.barcode),
            barcode_type: b.barcode_type === 'generated' ? 'generated' : 'manufacturer',
            is_primary: rawBarcode ? 0 : 1,
          })),
      ];

      // Deduplicate & validate against entire catalog
      const seenLocal = new Set<string>();
      const cleanBarcodes: Array<{ barcode: string; barcode_type: 'manufacturer' | 'generated'; is_primary: number }> = [];
      for (const entry of allSubmittedBarcodes) {
        const lower = entry.barcode.toLowerCase();
        if (seenLocal.has(lower)) continue;
        seenLocal.add(lower);
        const conflict = findBarcodeConflict(entry.barcode);
        if (conflict) {
          throw new Error(`Barcode "${entry.barcode}" is already assigned to ${conflict.ownerLabel}. Duplicate barcodes are not allowed.`);
        }
        cleanBarcodes.push({
          barcode: entry.barcode,
          barcode_type: entry.barcode_type === 'generated' ? 'generated' : 'manufacturer',
          is_primary: cleanBarcodes.length === 0 ? 1 : 0,
        });
      }

      const primaryBarcode = cleanBarcodes[0]?.barcode || '';
      const useParentPricing = body.use_parent_pricing === false || body.use_parent_pricing === 0 ? 0 : 1;
      const pPrice = round2(safeNum(body.purchase_price, safeNum(parentItem.purchase_price, 0)));
      const tPrice = round2(safeNum(body.trade_price, safeNum(parentItem.trade_price, 0)));
      const wPrice = round2(safeNum(body.wholesale_price, safeNum(parentItem.wholesale_price, 0)));
      const rPrice = round2(safeNum(body.retail_price, safeNum(parentItem.retail_price, 0)));
      const rawPacking = safeStr(body.packing);
      const effectivePacking = rawPacking || safeStr(parentItem.packing) || '1x1';
      const units = Math.max(1, parseUnitsFromPacking(effectivePacking));
      const lRate =
        body.loose_rate !== undefined && body.loose_rate !== null && body.loose_rate !== ''
          ? round2(safeNum(body.loose_rate, 0))
          : round2(rPrice / units);
      const dPct = round2(safeNum(body.discount_percent, safeNum(parentItem.discount_percent, 0)));
      const taxPct = round2(safeNum(body.tax_percent, safeNum(parentItem.tax_percent, 0)));
      const oStock = round2(safeNum(body.opening_stock, 0));
      const mStock = round2(safeNum(body.minimum_stock, safeNum(parentItem.minimum_stock, 0)));
      const status = body.status === 'Inactive' ? 'Inactive' : 'Active';

      // Ensure parent has_variants = 1 when variants are added
      if (Number(parentItem.has_variants || 0) !== 1) {
        db.prepare('UPDATE items SET has_variants = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(parentItemId);
      }

      const ins = db
        .prepare(
          `INSERT INTO item_variants (
            parent_item_id, variant_code, variant_name, colour, flavour, variant_type, other_attributes,
            barcode, packing, use_parent_pricing,
            purchase_price, trade_price, wholesale_price, retail_price, loose_rate, discount_percent, tax_percent,
            opening_stock, minimum_stock, rack_number,
            image_id, image_url, thumbnail_url, status, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parentItemId,
          variantCode,
          variantName,
          colourVal,
          flavourVal,
          typeVal,
          otherAttrVal,
          primaryBarcode,
          rawPacking,
          useParentPricing,
          pPrice,
          tPrice,
          wPrice,
          rPrice,
          lRate,
          dPct,
          taxPct,
          oStock,
          mStock,
          safeStr(body.rack_number),
          body.image_id ? Number(body.image_id) || null : null,
          safeStr(body.image_url),
          safeStr(body.thumbnail_url || body.image_url),
          status,
          req.user?.username || 'Super Admin'
        );

      const variantId = Number(ins.lastInsertRowid);
      const insertBc = db.prepare(
        `INSERT INTO item_variant_barcodes (item_id, variant_id, barcode, barcode_type, is_primary)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const bc of cleanBarcodes) {
        insertBc.run(parentItemId, variantId, bc.barcode, bc.barcode_type, bc.is_primary);
      }

      return variantId;
    });

    const newVariantId = createVariantTx();
    const enriched = getEnrichedVariants({ parentItemId, includeInactive: true }).find((v) => v.id === newVariantId);

    return res.status(201).json({
      success: true,
      message: `Variant "${variantName}" created successfully.`,
      variant: enriched,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * PUT /api/items/variants/:variantId
 * Update a variant (image, prices, attributes, primary barcode) without modifying Main Product image
 */
itemsRouter.put('/variants/:variantId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variantId = parseInt(req.params.variantId, 10);
    const existing = db.prepare('SELECT * FROM item_variants WHERE id = ?').get(variantId) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Variant not found.' });
    }

    const safeStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
    const safeNum = (v: unknown, fallback = 0): number => {
      if (v === null || v === undefined || v === '') return Number.isFinite(fallback) ? fallback : 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : Number.isFinite(fallback) ? fallback : 0;
    };

    const parentItem = db.prepare('SELECT * FROM items WHERE id = ?').get(existing.parent_item_id) as ItemRow;
    const body = req.body || {};

    const updateTx = db.transaction(() => {
      const nextCode =
        body.variant_code !== undefined
          ? safeStr(body.variant_code)
          : safeStr(existing.variant_code);
      if (!nextCode) throw new Error('Variant Code cannot be empty.');

      const dupV = db
        .prepare('SELECT id FROM item_variants WHERE UPPER(TRIM(variant_code)) = UPPER(TRIM(?)) AND id != ?')
        .get(nextCode, variantId);
      const dupI = db
        .prepare('SELECT id FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?))')
        .get(nextCode);
      if (dupV || dupI) {
        throw new Error(`Variant Code "${nextCode}" is already in use.`);
      }

      const nextColour = body.colour !== undefined ? safeStr(body.colour) : safeStr(existing.colour);
      const nextFlavour = body.flavour !== undefined ? safeStr(body.flavour) : safeStr(existing.flavour);
      const nextType = body.variant_type !== undefined ? safeStr(body.variant_type) : safeStr(existing.variant_type);
      const nextOtherAttr =
        body.other_attributes !== undefined ? safeStr(body.other_attributes) : safeStr(existing.other_attributes);

      const nextName =
        body.variant_name !== undefined
          ? safeStr(body.variant_name) || [nextColour, nextFlavour, nextType, nextOtherAttr].filter(Boolean).join(' / ')
          : safeStr(existing.variant_name);
      if (!nextName) throw new Error('Variant Name cannot be empty.');

      const nextBarcode = body.barcode !== undefined ? safeStr(body.barcode) : safeStr(existing.barcode);
      if (nextBarcode) {
        const conflict = findBarcodeConflict(nextBarcode, { excludeVariantId: variantId });
        if (conflict) {
          throw new Error(`Barcode "${nextBarcode}" is already assigned to ${conflict.ownerLabel}.`);
        }
      }

      const useParentPricing =
        body.use_parent_pricing !== undefined
          ? body.use_parent_pricing === false || body.use_parent_pricing === 0
            ? 0
            : 1
          : Number(existing.use_parent_pricing ?? 1);

      const pPrice = round2(safeNum(body.purchase_price, safeNum(existing.purchase_price, 0)));
      const tPrice = round2(safeNum(body.trade_price, safeNum(existing.trade_price, 0)));
      const wPrice = round2(safeNum(body.wholesale_price, safeNum(existing.wholesale_price, 0)));
      const rPrice = round2(safeNum(body.retail_price, safeNum(existing.retail_price, 0)));
      const packing = body.packing !== undefined ? safeStr(body.packing) : safeStr(existing.packing);
      const units = Math.max(1, parseUnitsFromPacking(packing || parentItem?.packing || '1x1'));
      const lRate =
        body.loose_rate !== undefined && body.loose_rate !== null && body.loose_rate !== ''
          ? round2(safeNum(body.loose_rate, 0))
          : round2(safeNum(existing.loose_rate, rPrice / units));
      const dPct = round2(safeNum(body.discount_percent, safeNum(existing.discount_percent, 0)));
      const taxPct = round2(safeNum(body.tax_percent, safeNum(existing.tax_percent, 0)));
      const oStock = round2(safeNum(body.opening_stock, safeNum(existing.opening_stock, 0)));
      const mStock = round2(safeNum(body.minimum_stock, safeNum(existing.minimum_stock, 0)));
      const rack = body.rack_number !== undefined ? safeStr(body.rack_number) : safeStr(existing.rack_number);
      const status =
        body.status !== undefined
          ? body.status === 'Inactive'
            ? 'Inactive'
            : 'Active'
          : safeStr(existing.status) === 'Inactive'
          ? 'Inactive'
          : 'Active';

      const nextImgId = body.image_id !== undefined ? (body.image_id ? Number(body.image_id) || null : null) : existing.image_id;
      const nextImgUrl = body.image_url !== undefined ? safeStr(body.image_url) : safeStr(existing.image_url);
      const nextThumbUrl =
        body.thumbnail_url !== undefined
          ? safeStr(body.thumbnail_url)
          : body.image_url !== undefined
          ? nextImgUrl
          : safeStr(existing.thumbnail_url);

      const oldImgId = existing.image_id ? Number(existing.image_id) : null;
      const oldImgUrl = safeStr(existing.image_url);

      db.prepare(
        `UPDATE item_variants SET
          variant_code = ?, variant_name = ?, colour = ?, flavour = ?, variant_type = ?, other_attributes = ?,
          barcode = ?, packing = ?, use_parent_pricing = ?,
          purchase_price = ?, trade_price = ?, wholesale_price = ?, retail_price = ?, loose_rate = ?,
          discount_percent = ?, tax_percent = ?, opening_stock = ?, minimum_stock = ?, rack_number = ?,
          image_id = ?, image_url = ?, thumbnail_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(
        nextCode,
        nextName,
        nextColour,
        nextFlavour,
        nextType,
        nextOtherAttr,
        nextBarcode,
        packing,
        useParentPricing,
        pPrice,
        tPrice,
        wPrice,
        rPrice,
        lRate,
        dPct,
        taxPct,
        oStock,
        mStock,
        rack,
        nextImgId,
        nextImgUrl,
        nextThumbUrl,
        status,
        variantId
      );

      // Sync primary barcode record in item_variant_barcodes
      if (body.barcode !== undefined) {
        if (nextBarcode) {
          const existsInMulti = db
            .prepare('SELECT id FROM item_variant_barcodes WHERE variant_id = ? AND LOWER(TRIM(barcode)) = LOWER(TRIM(?))')
            .get(variantId, nextBarcode) as { id: number } | undefined;
          db.prepare('UPDATE item_variant_barcodes SET is_primary = 0 WHERE variant_id = ?').run(variantId);
          if (existsInMulti) {
            db.prepare('UPDATE item_variant_barcodes SET is_primary = 1 WHERE id = ?').run(existsInMulti.id);
          } else {
            db.prepare(
              `INSERT INTO item_variant_barcodes (item_id, variant_id, barcode, barcode_type, is_primary)
               VALUES (?, ?, ?, ?, 1)`
            ).run(existing.parent_item_id, variantId, nextBarcode, body.barcode_type === 'generated' ? 'generated' : 'manufacturer');
          }
        }
      }

      if (oldImgId && oldImgId !== nextImgId) {
        deleteUnusedProductImage(oldImgId, oldImgUrl);
      }
    });

    updateTx();
    const enriched = getEnrichedVariants({ parentItemId: Number(existing.parent_item_id), includeInactive: true }).find(
      (v) => v.id === variantId
    );

    return res.json({
      success: true,
      message: `Variant updated successfully.`,
      variant: enriched,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * PATCH /api/items/variants/:variantId/status
 */
itemsRouter.patch('/variants/:variantId/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variantId = parseInt(req.params.variantId, 10);
    const existing = db.prepare('SELECT id, parent_item_id, variant_name, status FROM item_variants WHERE id = ?').get(variantId) as
      | { id: number; parent_item_id: number; variant_name: string; status: string }
      | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Variant not found.' });
    }

    const nextStatus = req.body?.status === 'Active' ? 'Active' : req.body?.status === 'Inactive' ? 'Inactive' : existing.status === 'Active' ? 'Inactive' : 'Active';
    db.prepare('UPDATE item_variants SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, variantId);

    const enriched = getEnrichedVariants({ parentItemId: existing.parent_item_id, includeInactive: true }).find((v) => v.id === variantId);
    return res.json({
      success: true,
      message: `Variant "${existing.variant_name}" marked ${nextStatus}. Historical invoices remain preserved.`,
      variant: enriched,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/items/variants/:variantId/barcodes
 * Add a manufacturer or software-generated barcode to a variant
 */
itemsRouter.post('/variants/:variantId/barcodes', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variantId = parseInt(req.params.variantId, 10);
    const variant = db.prepare('SELECT * FROM item_variants WHERE id = ?').get(variantId) as Record<string, any> | undefined;
    if (!variant) {
      return res.status(404).json({ success: false, error: 'Variant not found.' });
    }

    const generate = Boolean(req.body?.generate || req.body?.auto_generate);
    const rawCode = generate
      ? generateUniqueVariantBarcode(String(variant.variant_code))
      : String(req.body?.barcode || '').trim();

    if (!rawCode) {
      return res.status(400).json({ success: false, error: 'Barcode is required.' });
    }

    const conflict = findBarcodeConflict(rawCode);
    if (conflict) {
      return res.status(400).json({
        success: false,
        error: `Duplicate Barcode rejected: "${rawCode}" is already assigned to ${conflict.ownerLabel}.`,
      });
    }

    const barcodeType = generate || req.body?.barcode_type === 'generated' ? 'generated' : 'manufacturer';
    const makePrimary = Boolean(req.body?.is_primary) || !String(variant.barcode || '').trim();

    db.transaction(() => {
      if (makePrimary) {
        db.prepare('UPDATE item_variant_barcodes SET is_primary = 0 WHERE variant_id = ?').run(variantId);
        db.prepare('UPDATE item_variants SET barcode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rawCode, variantId);
      }
      db.prepare(
        `INSERT INTO item_variant_barcodes (item_id, variant_id, barcode, barcode_type, is_primary)
         VALUES (?, ?, ?, ?, ?)`
      ).run(variant.parent_item_id, variantId, rawCode, barcodeType, makePrimary ? 1 : 0);
    })();

    const enriched = getEnrichedVariants({ parentItemId: Number(variant.parent_item_id), includeInactive: true }).find(
      (v) => v.id === variantId
    );
    return res.status(201).json({
      success: true,
      barcode: rawCode,
      addedBarcode: rawCode,
      variant: enriched,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ success: false, error: errorMsg });
  }
});

/**
 * DELETE /api/items/variants/:variantId/barcodes/:barcodeId
 */
itemsRouter.delete('/variants/:variantId/barcodes/:barcodeId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variantId = parseInt(req.params.variantId, 10);
    const barcodeId = parseInt(req.params.barcodeId, 10);

    const row = db
      .prepare('SELECT * FROM item_variant_barcodes WHERE id = ? AND variant_id = ?')
      .get(barcodeId, variantId) as { id: number; item_id: number; barcode: string; is_primary: number } | undefined;

    if (!row) {
      return res.status(404).json({ success: false, error: 'Barcode record not found.' });
    }

    db.transaction(() => {
      db.prepare('DELETE FROM item_variant_barcodes WHERE id = ?').run(barcodeId);
      const remaining = db
        .prepare('SELECT * FROM item_variant_barcodes WHERE variant_id = ? ORDER BY is_primary DESC, id ASC')
        .all(variantId) as Array<{ id: number; barcode: string; is_primary: number }>;

      const nextPrimary = remaining[0];
      if (nextPrimary) {
        if (Number(nextPrimary.is_primary) !== 1) {
          db.prepare('UPDATE item_variant_barcodes SET is_primary = 1 WHERE id = ?').run(nextPrimary.id);
        }
        db.prepare('UPDATE item_variants SET barcode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          nextPrimary.barcode,
          variantId
        );
      } else {
        db.prepare("UPDATE item_variants SET barcode = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(variantId);
      }
    })();

    const variantRow = db.prepare('SELECT parent_item_id FROM item_variants WHERE id = ?').get(variantId) as { parent_item_id: number };
    const enriched = getEnrichedVariants({ parentItemId: variantRow.parent_item_id, includeInactive: true }).find(
      (v) => v.id === variantId
    );
    return res.json({ success: true, variant: enriched });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * DELETE /api/items/variants/:variantId
 */
itemsRouter.delete('/variants/:variantId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const variantId = parseInt(req.params.variantId, 10);
    const existing = db.prepare('SELECT * FROM item_variants WHERE id = ?').get(variantId) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Variant not found.' });
    }

    const salesCnt = (db.prepare('SELECT COUNT(*) as c FROM sale_items WHERE variant_id = ?').get(variantId) as { c: number }).c;
    const purCnt = (db.prepare('SELECT COUNT(*) as c FROM purchase_items WHERE variant_id = ?').get(variantId) as { c: number }).c;
    const invCnt = (db.prepare('SELECT COUNT(*) as c FROM inventory WHERE variant_id = ?').get(variantId) as { c: number }).c;

    if (salesCnt > 0 || purCnt > 0 || invCnt > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot permanently delete variant "${existing.variant_name}" because it has stock/invoice history. Deactivate it instead so historical invoices stay intact.`,
      });
    }

    db.prepare('DELETE FROM item_variants WHERE id = ?').run(variantId);
    if (existing.image_id) {
      deleteUnusedProductImage(Number(existing.image_id), String(existing.image_url || ''));
    }

    return res.json({ success: true, message: `Variant "${existing.variant_name}" deleted.` });
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

    const variants = getEnrichedVariants({ parentItemId: id, includeInactive: true });
    const hasVariants = Number(item.has_variants || 0) === 1;
    const activeVariants = variants.filter((v) => v.status === 'Active');

    let consolidatedStockPacks = 0;
    if (hasVariants) {
      consolidatedStockPacks = round2(
        variants.reduce((sum, v) => sum + Number(v.current_stock_packs || 0), 0)
      );
    } else {
      const invInfo = db
        .prepare(
          `SELECT COALESCE(SUM(current_pack_qty), 0) AS packs, COUNT(*) AS batch_count
           FROM inventory
           WHERE item_id = ? AND COALESCE(variant_key, 0) = 0`
        )
        .get(id) as { packs: number; batch_count: number } | undefined;
      consolidatedStockPacks =
        invInfo && Number(invInfo.batch_count || 0) > 0
          ? round2(Number(invInfo.packs || 0))
          : round2(Number(item.opening_stock || 0));
    }

    return res.json({
      success: true,
      item: {
        ...enrichItemWithPacking(item),
        has_variants: hasVariants ? 1 : 0,
        image_url: String(item.image_url || ''),
        thumbnail_url: String(item.thumbnail_url || item.image_url || ''),
        variant_count: variants.length,
        active_variant_count: activeVariants.length,
        consolidated_stock_packs: consolidatedStockPacks,
        variants,
      },
    });
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
      carton,
      boxes_per_carton,
      strips_per_box,
      tablets_per_strip,
      units_per_strip,
      units_per_pack,
      purchase_unit = 'Box',
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
      has_variants = 0,
      image_id = null,
      image_url = '',
      thumbnail_url = '',
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

    const packingConfig = resolveMultiLevelPackingConfig({
      packing,
      carton,
      boxes_per_carton,
      strips_per_box,
      tablets_per_strip,
      units_per_strip,
      units_per_pack,
      purchase_unit,
    });

    if (!packingConfig.packing || String(packingConfig.packing).trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Packing is required.' });
    }

    const cleanBarcode = barcode ? String(barcode).trim() : '';
    if (cleanBarcode) {
      const bcConflict = findBarcodeConflict(cleanBarcode);
      if (bcConflict) {
        return res.status(400).json({
          success: false,
          error: `Barcode "${cleanBarcode}" is already assigned to ${bcConflict.ownerLabel}. Duplicate barcodes are not allowed.`,
        });
      }
    }

    // Decimal numbers parsing
    const pPrice = Math.round((parseFloat(purchase_price) || 0.0) * 100) / 100;
    const tPrice = Math.round((parseFloat(trade_price) || 0.0) * 100) / 100;
    const wPrice = Math.round((parseFloat(wholesale_price) || 0.0) * 100) / 100;
    const rPrice = Math.round((parseFloat(retail_price) || 0.0) * 100) / 100;
    const packingUnits = Math.max(1, packingConfig.units_per_pack);
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
    const itemHasVariants = has_variants === true || has_variants === 1 || has_variants === '1' ? 1 : 0;
    const itemStatus = status === 'Inactive' ? 'Inactive' : 'Active';

    const createItemTx = db.transaction(() => {
      const requestedCode = item_code ? String(item_code).trim() : '';
      // Atomically allocate a guaranteed unique sequential item code
      // (If requestedCode is empty or already taken due to simultaneous creation, allocateNextItemCode advances to the next unused sequential code)
      const allocated = allocateNextItemCode(db, requestedCode);
      const finalCode = allocated.next_code;
      const canonicalCompany = registerItemCompanyIfNew(db, company_name) || normalizeCompanyName(company_name);

      const insertSql = `
        INSERT INTO items (
          item_code, company_name, item_name, generic_name, category, packing,
          carton, boxes_per_carton, strips_per_box, tablets_per_strip, units_per_strip, units_per_pack, purchase_unit,
          barcode, purchase_price, trade_price, wholesale_price, retail_price, loose_rate, discount_percent, tax_percent,
          opening_stock, minimum_stock, rack_number, has_variants, image_id, image_url, thumbnail_url, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = db.prepare(insertSql).run(
        finalCode,
        canonicalCompany,
        String(item_name).trim(),
        generic_name ? String(generic_name).trim() : null,
        String(category).trim(),
        packingConfig.packing,
        packingConfig.carton,
        packingConfig.boxes_per_carton,
        packingConfig.strips_per_box,
        packingConfig.tablets_per_strip,
        packingConfig.units_per_strip,
        packingConfig.units_per_pack,
        packingConfig.purchase_unit,
        cleanBarcode || null,
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
        itemHasVariants,
        image_id ? Number(image_id) : null,
        String(image_url || '').trim(),
        String(thumbnail_url || image_url || '').trim(),
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
      item: { ...enrichItemWithPacking(newItem), variants: [] },
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
      carton,
      boxes_per_carton,
      strips_per_box,
      tablets_per_strip,
      units_per_strip,
      units_per_pack,
      purchase_unit,
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
      has_variants,
      image_id,
      image_url,
      thumbnail_url,
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

    const nextBarcode = barcode !== undefined ? (barcode ? String(barcode).trim() : null) : existingItem.barcode;
    if (nextBarcode) {
      const bcConflict = findBarcodeConflict(nextBarcode, { excludeItemId: id });
      if (bcConflict) {
        return res.status(400).json({
          success: false,
          error: `Barcode "${nextBarcode}" is already assigned to ${bcConflict.ownerLabel}. Duplicate barcodes are not allowed.`,
        });
      }
    }

    const packingConfig = resolveMultiLevelPackingConfig(
      {
        packing,
        carton,
        boxes_per_carton,
        strips_per_box,
        tablets_per_strip,
        units_per_strip,
        units_per_pack,
        purchase_unit,
      },
      existingItem
    );

    const pPrice = purchase_price !== undefined ? Math.round((parseFloat(purchase_price) || 0.0) * 100) / 100 : existingItem.purchase_price;
    const tPrice = trade_price !== undefined ? Math.round((parseFloat(trade_price) || 0.0) * 100) / 100 : existingItem.trade_price;
    const wPrice = wholesale_price !== undefined ? Math.round((parseFloat(wholesale_price) || 0.0) * 100) / 100 : existingItem.wholesale_price;
    const rPrice = retail_price !== undefined ? Math.round((parseFloat(retail_price) || 0.0) * 100) / 100 : existingItem.retail_price;
    const finalPacking = packingConfig.packing;
    const packingUnits = Math.max(1, packingConfig.units_per_pack);
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
    const itemHasVariants =
      has_variants !== undefined
        ? has_variants === true || has_variants === 1 || has_variants === '1'
          ? 1
          : 0
        : Number(existingItem.has_variants || 0);
    const nextImageId = image_id !== undefined ? (image_id ? Number(image_id) : null) : existingItem.image_id ?? null;
    const nextImageUrl = image_url !== undefined ? String(image_url || '').trim() : String(existingItem.image_url || '');
    const nextThumbUrl =
      thumbnail_url !== undefined
        ? String(thumbnail_url || '').trim()
        : image_url !== undefined
        ? nextImageUrl
        : String(existingItem.thumbnail_url || '');
    const itemStatus = status !== undefined ? (status === 'Inactive' ? 'Inactive' : 'Active') : existingItem.status;

    const oldImgId = existingItem.image_id ? Number(existingItem.image_id) : null;
    const oldImgUrl = String(existingItem.image_url || '');

    const updateSql = `
      UPDATE items SET
        item_code = ?,
        company_name = ?,
        item_name = ?,
        generic_name = ?,
        category = ?,
        packing = ?,
        carton = ?,
        boxes_per_carton = ?,
        strips_per_box = ?,
        tablets_per_strip = ?,
        units_per_strip = ?,
        units_per_pack = ?,
        purchase_unit = ?,
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
        has_variants = ?,
        image_id = ?,
        image_url = ?,
        thumbnail_url = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const resolvedCompany =
      company_name !== undefined
        ? registerItemCompanyIfNew(db, company_name) || normalizeCompanyName(company_name)
        : existingItem.company_name;

    db.prepare(updateSql).run(
      cleanCode,
      resolvedCompany,
      item_name !== undefined ? String(item_name).trim() : existingItem.item_name,
      generic_name !== undefined ? (generic_name ? String(generic_name).trim() : null) : existingItem.generic_name,
      category !== undefined ? String(category).trim() : existingItem.category,
      finalPacking,
      packingConfig.carton,
      packingConfig.boxes_per_carton,
      packingConfig.strips_per_box,
      packingConfig.tablets_per_strip,
      packingConfig.units_per_strip,
      packingConfig.units_per_pack,
      packingConfig.purchase_unit,
      nextBarcode,
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
      itemHasVariants,
      nextImageId,
      nextImageUrl,
      nextThumbUrl,
      itemStatus,
      id
    );

    // Sync non-variant inventory batch packing metadata (strips_per_box, units_per_strip, units_per_pack) without altering stock counts
    db.prepare(`
      UPDATE inventory
      SET packing = ?,
          strips_per_box = ?,
          units_per_strip = ?,
          units_per_pack = ?
      WHERE item_id = ? AND COALESCE(variant_key, 0) = 0
    `).run(
      finalPacking,
      Math.max(1, Number(packingConfig.strips_per_box || 1)),
      Math.max(1, Number(packingConfig.units_per_strip || 1)),
      Math.max(1, Number(packingConfig.units_per_pack || 1)),
      id
    );

    // Changing Main Product picture never overwrites custom variant pictures; clean up unused old image only if unreferenced
    if (oldImgId && oldImgId !== nextImageId) {
      deleteUnusedProductImage(oldImgId, oldImgUrl);
    }

    const updatedItem = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow;
    const variants = getEnrichedVariants({ parentItemId: id, includeInactive: true });

    return res.json({
      success: true,
      message: `Item "${updatedItem.item_name}" updated successfully.`,
      item: { ...enrichItemWithPacking(updatedItem), variants },
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
