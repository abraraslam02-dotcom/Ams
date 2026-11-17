import { getDatabase } from '../db/connection.ts';

function round2(n: unknown): number {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function parseUnitsFromPacking(packingStr: string): number {
  const raw = String(packingStr || '1x1').trim().toLowerCase();
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

export interface VariantBarcodeRecord {
  id: number;
  item_id: number;
  variant_id: number | null;
  barcode: string;
  barcode_type: 'manufacturer' | 'generated';
  is_primary: number;
  created_at: string;
}

export interface EnrichedVariantRecord {
  id: number;
  parent_item_id: number;
  parent_item_code: string;
  parent_item_name: string;
  company_name: string;
  category: string;
  variant_code: string;
  variant_name: string;
  colour: string;
  flavour: string;
  variant_type: string;
  other_attributes: string;
  barcode: string;
  barcodes: VariantBarcodeRecord[];
  packing: string;
  effective_packing: string;
  use_parent_pricing: number;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  loose_rate: number;
  discount_percent: number;
  tax_percent: number;
  effective_purchase_price: number;
  effective_trade_price: number;
  effective_wholesale_price: number;
  effective_retail_price: number;
  effective_loose_rate: number;
  effective_discount_percent: number;
  effective_tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  effective_minimum_stock: number;
  rack_number: string;
  effective_rack_number: string;
  image_id: number | null;
  image_url: string;
  thumbnail_url: string;
  own_image_url: string;
  own_thumbnail_url: string;
  effective_image_url: string;
  effective_thumbnail_url: string;
  image_inherited: boolean;
  current_stock_packs: number;
  current_stock_units: number;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

/**
 * Generates the next sequential unique variant code under a Main Product, e.g. 1001 -> 100101, 100102...
 * Checks both item_variants.variant_code AND items.item_code to avoid collisions.
 */
export function getNextVariantCodeForItem(parentItemId: number): string {
  const db = getDatabase();
  const parent = db
    .prepare('SELECT item_code FROM items WHERE id = ?')
    .get(parentItemId) as { item_code: string } | undefined;

  if (!parent) {
    throw new Error('Parent item not found.');
  }

  const baseCode = String(parent.item_code || '').trim();
  const existing = db
    .prepare('SELECT variant_code FROM item_variants WHERE parent_item_id = ?')
    .all(parentItemId) as Array<{ variant_code: string }>;

  let maxSuffix = 0;
  for (const row of existing) {
    const vCode = String(row.variant_code || '').trim();
    if (vCode.toLowerCase().startsWith(baseCode.toLowerCase())) {
      const tail = vCode.slice(baseCode.length).replace(/[^0-9]/g, '');
      const num = parseInt(tail, 10);
      if (Number.isFinite(num) && num > maxSuffix) {
        maxSuffix = num;
      }
    }
  }

  let seq = Math.max(1, maxSuffix + 1);
  while (true) {
    const candidate = `${baseCode}${String(seq).padStart(2, '0')}`;
    const conflictVariant = db
      .prepare('SELECT id FROM item_variants WHERE UPPER(TRIM(variant_code)) = UPPER(TRIM(?))')
      .get(candidate);
    const conflictItem = db
      .prepare('SELECT id FROM items WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(?))')
      .get(candidate);
    if (!conflictVariant && !conflictItem) {
      return candidate;
    }
    seq += 1;
  }
}

/**
 * Computes a valid EAN-13 check digit for 12 numeric digits.
 */
function computeEan13CheckDigit(twelveDigits: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(twelveDigits[i], 10) || 0;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const mod = sum % 10;
  return String(mod === 0 ? 0 : 10 - mod);
}

/**
 * Generates a guaranteed unique EAN-13 internal barcode when manufacturer barcode is absent.
 */
export function generateUniqueVariantBarcode(variantCode?: string): string {
  const db = getDatabase();
  const numericSeed = String(variantCode || '').replace(/\D/g, '').slice(-5).padStart(5, '0');

  for (let attempt = 0; attempt < 200; attempt++) {
    const randPart = String(Math.floor(1000 + Math.random() * 9000));
    const body12 = `20${numericSeed}${randPart}${attempt % 10}`;
    const ean13 = `${body12.slice(0, 12)}${computeEan13CheckDigit(body12.slice(0, 12))}`;
    if (!isBarcodeInUse(ean13)) {
      return ean13;
    }
  }

  return `AMS${Date.now().toString().slice(-9)}`;
}

/**
 * Checks globally across items.barcode, item_variants.barcode, and item_variant_barcodes.barcode
 * whether a barcode already belongs to another item/variant.
 */
export function findBarcodeConflict(
  rawBarcode: string,
  options?: { excludeItemId?: number | null; excludeVariantId?: number | null }
): { ownerType: 'item' | 'variant'; ownerLabel: string; itemId: number; variantId: number | null } | null {
  const clean = String(rawBarcode || '').trim();
  if (!clean) return null;

  const db = getDatabase();

  const itemMatch = db
    .prepare(
      `SELECT id, item_code, item_name FROM items
       WHERE barcode IS NOT NULL AND TRIM(barcode) != '' AND LOWER(TRIM(barcode)) = LOWER(TRIM(?))`
    )
    .get(clean) as { id: number; item_code: string; item_name: string } | undefined;

  if (itemMatch && (!options?.excludeItemId || itemMatch.id !== Number(options.excludeItemId))) {
    return {
      ownerType: 'item',
      ownerLabel: `[${itemMatch.item_code}] ${itemMatch.item_name}`,
      itemId: Number(itemMatch.id),
      variantId: null,
    };
  }

  const varMatch = db
    .prepare(
      `SELECT v.id, v.parent_item_id, v.variant_code, v.variant_name, i.item_name
       FROM item_variants v
       INNER JOIN items i ON i.id = v.parent_item_id
       WHERE v.barcode IS NOT NULL AND TRIM(v.barcode) != '' AND LOWER(TRIM(v.barcode)) = LOWER(TRIM(?))`
    )
    .get(clean) as
    | { id: number; parent_item_id: number; variant_code: string; variant_name: string; item_name: string }
    | undefined;

  if (varMatch && (!options?.excludeVariantId || varMatch.id !== Number(options.excludeVariantId))) {
    return {
      ownerType: 'variant',
      ownerLabel: `[${varMatch.variant_code}] ${varMatch.item_name} — ${varMatch.variant_name}`,
      itemId: Number(varMatch.parent_item_id),
      variantId: Number(varMatch.id),
    };
  }

  const extraMatch = db
    .prepare(
      `SELECT b.item_id, b.variant_id, v.variant_code, v.variant_name, i.item_code, i.item_name
       FROM item_variant_barcodes b
       INNER JOIN items i ON i.id = b.item_id
       LEFT JOIN item_variants v ON v.id = b.variant_id
       WHERE LOWER(TRIM(b.barcode)) = LOWER(TRIM(?))`
    )
    .get(clean) as
    | {
        item_id: number;
        variant_id: number | null;
        variant_code: string | null;
        variant_name: string | null;
        item_code: string;
        item_name: string;
      }
    | undefined;

  if (extraMatch) {
    const sameVariant =
      options?.excludeVariantId && extraMatch.variant_id && Number(extraMatch.variant_id) === Number(options.excludeVariantId);
    const sameItem =
      options?.excludeItemId && !extraMatch.variant_id && Number(extraMatch.item_id) === Number(options.excludeItemId);
    if (!sameVariant && !sameItem) {
      return {
        ownerType: extraMatch.variant_id ? 'variant' : 'item',
        ownerLabel: extraMatch.variant_id
          ? `[${extraMatch.variant_code}] ${extraMatch.item_name} — ${extraMatch.variant_name}`
          : `[${extraMatch.item_code}] ${extraMatch.item_name}`,
        itemId: Number(extraMatch.item_id),
        variantId: extraMatch.variant_id ? Number(extraMatch.variant_id) : null,
      };
    }
  }

  return null;
}

export function isBarcodeInUse(
  rawBarcode: string,
  options?: { excludeItemId?: number | null; excludeVariantId?: number | null }
): boolean {
  return Boolean(findBarcodeConflict(rawBarcode, options));
}

/**
 * Fetches variants (optionally filtered by parentItemId or status) with inherited image/pricing/packing & live stock.
 */
export function getEnrichedVariants(filters?: {
  parentItemId?: number | null;
  parentItemIds?: number[];
  includeInactive?: boolean;
}): EnrichedVariantRecord[] {
  const db = getDatabase();
  const conds: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.parentItemId) {
    conds.push('v.parent_item_id = ?');
    params.push(Number(filters.parentItemId));
  } else if (filters?.parentItemIds && filters.parentItemIds.length > 0) {
    const ph = filters.parentItemIds.map(() => '?').join(',');
    conds.push(`v.parent_item_id IN (${ph})`);
    params.push(...filters.parentItemIds);
  }

  if (!filters?.includeInactive) {
    conds.push("LOWER(COALESCE(v.status, 'Active')) = 'active'");
  }

  const whereSql = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        v.*,
        i.item_code AS parent_item_code,
        i.item_name AS parent_item_name,
        i.company_name AS parent_company_name,
        i.category AS parent_category,
        i.packing AS parent_packing,
        i.purchase_price AS parent_purchase_price,
        i.trade_price AS parent_trade_price,
        i.wholesale_price AS parent_wholesale_price,
        i.retail_price AS parent_retail_price,
        i.loose_rate AS parent_loose_rate,
        i.discount_percent AS parent_discount_percent,
        i.tax_percent AS parent_tax_percent,
        i.minimum_stock AS parent_minimum_stock,
        i.rack_number AS parent_rack_number,
        i.image_url AS parent_image_url,
        i.thumbnail_url AS parent_thumbnail_url,
        COALESCE((SELECT SUM(inv.current_pack_qty) FROM inventory inv WHERE inv.variant_id = v.id), 0) AS inv_packs,
        COALESCE((SELECT SUM(inv.total_stock_units) FROM inventory inv WHERE inv.variant_id = v.id), 0) AS inv_units,
        (SELECT COUNT(*) FROM inventory inv WHERE inv.variant_id = v.id) AS inv_batch_count
      FROM item_variants v
      INNER JOIN items i ON i.id = v.parent_item_id
      ${whereSql}
      ORDER BY i.item_name ASC, v.variant_code ASC, v.id ASC
    `
    )
    .all(...params) as Array<Record<string, any>>;

  if (rows.length === 0) return [];

  const variantIds = rows.map((r) => Number(r.id));
  const vPh = variantIds.map(() => '?').join(',');
  const barcodeRows = db
    .prepare(`SELECT * FROM item_variant_barcodes WHERE variant_id IN (${vPh}) ORDER BY is_primary DESC, id ASC`)
    .all(...variantIds) as VariantBarcodeRecord[];

  const barcodesByVariant = new Map<number, VariantBarcodeRecord[]>();
  for (const br of barcodeRows) {
    if (!br.variant_id) continue;
    const vid = Number(br.variant_id);
    if (!barcodesByVariant.has(vid)) barcodesByVariant.set(vid, []);
    barcodesByVariant.get(vid)!.push(br);
  }

  return rows.map((r) => {
    const vid = Number(r.id);
    const useParent = Number(r.use_parent_pricing ?? 1) === 1;
    const effectivePacking = String(r.packing || r.parent_packing || '1x1');
    const unitsPerPack = parseUnitsFromPacking(effectivePacking);

    const effPurchase = round2(useParent ? r.parent_purchase_price : r.purchase_price || r.parent_purchase_price);
    const effTrade = round2(useParent ? r.parent_trade_price : r.trade_price || r.parent_trade_price);
    const effWholesale = round2(useParent ? r.parent_wholesale_price : r.wholesale_price || r.parent_wholesale_price);
    const effRetail = round2(useParent ? r.parent_retail_price : r.retail_price || r.parent_retail_price);
    const effLoose = round2(
      useParent
        ? r.parent_loose_rate || (effRetail > 0 ? effRetail / unitsPerPack : 0)
        : r.loose_rate || (effRetail > 0 ? effRetail / unitsPerPack : 0)
    );
    const effDiscount = round2(useParent ? r.parent_discount_percent : r.discount_percent);
    const effTax = round2(useParent ? r.parent_tax_percent : r.tax_percent);

    const ownImg = String(r.image_url || '').trim();
    const ownThumb = String(r.thumbnail_url || '').trim();
    const parentImg = String(r.parent_image_url || '').trim();
    const parentThumb = String(r.parent_thumbnail_url || '').trim();

    const effImg = ownImg || parentImg;
    const effThumb = ownThumb || ownImg || parentThumb || parentImg;
    const imgInherited = !ownImg && Boolean(parentImg);

    const hasBatches = Number(r.inv_batch_count || 0) > 0;
    const currentPacks = hasBatches ? round2(r.inv_packs) : round2(r.opening_stock);
    const currentUnits = hasBatches
      ? round2(r.inv_units)
      : round2(Number(r.opening_stock || 0) * unitsPerPack);

    const vBarcodes = barcodesByVariant.get(vid) || [];
    const primaryBarcode =
      String(r.barcode || '').trim() ||
      vBarcodes.find((b) => Number(b.is_primary) === 1)?.barcode ||
      vBarcodes[0]?.barcode ||
      '';

    return {
      id: vid,
      parent_item_id: Number(r.parent_item_id),
      parent_item_code: String(r.parent_item_code || ''),
      parent_item_name: String(r.parent_item_name || ''),
      company_name: String(r.parent_company_name || ''),
      category: String(r.parent_category || ''),
      variant_code: String(r.variant_code || ''),
      variant_name: String(r.variant_name || ''),
      colour: String(r.colour || ''),
      flavour: String(r.flavour || ''),
      variant_type: String(r.variant_type || ''),
      other_attributes: String(r.other_attributes || ''),
      barcode: primaryBarcode,
      barcodes: vBarcodes,
      packing: String(r.packing || ''),
      effective_packing: effectivePacking,
      use_parent_pricing: useParent ? 1 : 0,
      purchase_price: round2(r.purchase_price),
      trade_price: round2(r.trade_price),
      wholesale_price: round2(r.wholesale_price),
      retail_price: round2(r.retail_price),
      loose_rate: round2(r.loose_rate),
      discount_percent: round2(r.discount_percent),
      tax_percent: round2(r.tax_percent),
      effective_purchase_price: effPurchase,
      effective_trade_price: effTrade,
      effective_wholesale_price: effWholesale,
      effective_retail_price: effRetail,
      effective_loose_rate: effLoose,
      effective_discount_percent: effDiscount,
      effective_tax_percent: effTax,
      opening_stock: round2(r.opening_stock),
      minimum_stock: round2(r.minimum_stock),
      effective_minimum_stock: round2(Number(r.minimum_stock || 0) > 0 ? r.minimum_stock : r.parent_minimum_stock),
      rack_number: String(r.rack_number || ''),
      effective_rack_number: String(r.rack_number || r.parent_rack_number || ''),
      image_id: r.image_id ? Number(r.image_id) : null,
      image_url: effImg,
      thumbnail_url: effThumb,
      own_image_url: ownImg,
      own_thumbnail_url: ownThumb,
      effective_image_url: effImg,
      effective_thumbnail_url: effThumb,
      image_inherited: imgInherited,
      current_stock_packs: currentPacks,
      current_stock_units: currentUnits,
      status: String(r.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active',
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || ''),
    };
  });
}

/**
 * Resolves a scanned barcode directly to either an exact Item+Variant or a standalone Item.
 */
export function lookupItemByBarcodeExact(rawBarcode: string): {
  matched: boolean;
  matchType: 'variant' | 'item' | null;
  item: Record<string, any> | null;
  variant: EnrichedVariantRecord | null;
} {
  const clean = String(rawBarcode || '').trim();
  if (!clean) {
    return { matched: false, matchType: null, item: null, variant: null };
  }

  const db = getDatabase();

  // 1. Check multi-barcode table first (variant-linked or item-linked)
  const extraRow = db
    .prepare('SELECT item_id, variant_id FROM item_variant_barcodes WHERE LOWER(TRIM(barcode)) = LOWER(TRIM(?)) LIMIT 1')
    .get(clean) as { item_id: number; variant_id: number | null } | undefined;

  let resolvedItemId = extraRow?.item_id ? Number(extraRow.item_id) : 0;
  let resolvedVariantId = extraRow?.variant_id ? Number(extraRow.variant_id) : 0;

  // 2. Check primary variant barcode / variant code
  if (!resolvedVariantId) {
    const varRow = db
      .prepare(
        `SELECT id, parent_item_id FROM item_variants
         WHERE (LOWER(TRIM(barcode)) = LOWER(TRIM(?)) OR LOWER(TRIM(variant_code)) = LOWER(TRIM(?)))
           AND LOWER(COALESCE(status, 'Active')) = 'active'
         LIMIT 1`
      )
      .get(clean, clean) as { id: number; parent_item_id: number } | undefined;
    if (varRow) {
      resolvedVariantId = Number(varRow.id);
      resolvedItemId = Number(varRow.parent_item_id);
    }
  }

  // 3. Check item master barcode / item_code
  if (!resolvedItemId) {
    const itemRow = db
      .prepare(
        `SELECT id FROM items
         WHERE (LOWER(TRIM(barcode)) = LOWER(TRIM(?)) OR LOWER(TRIM(item_code)) = LOWER(TRIM(?)))
           AND LOWER(COALESCE(status, 'Active')) = 'active'
         LIMIT 1`
      )
      .get(clean, clean) as { id: number } | undefined;
    if (itemRow) {
      resolvedItemId = Number(itemRow.id);
    }
  }

  if (!resolvedItemId) {
    return { matched: false, matchType: null, item: null, variant: null };
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(resolvedItemId) as Record<string, any> | undefined;
  if (!item) {
    return { matched: false, matchType: null, item: null, variant: null };
  }

  if (resolvedVariantId) {
    const variants = getEnrichedVariants({ parentItemId: resolvedItemId, includeInactive: true });
    const variant = variants.find((v) => v.id === resolvedVariantId) || null;
    if (variant && variant.status === 'Active') {
      return { matched: true, matchType: 'variant', item, variant };
    }
  }

  return { matched: true, matchType: 'item', item, variant: null };
}
