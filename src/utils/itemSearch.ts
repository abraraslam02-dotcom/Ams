/**
 * High-Performance Unified Item Search Engine for Abrar Medical Store
 * Optimized for 10,000+ items with sub-millisecond local in-memory search.
 *
 * Scoring Hierarchy:
 * 1. Exact Matches (Barcode, Item Code, Item Name, Company Name)
 * 2. Prefix / Starts With (Item Name, Code, Barcode, Company, Word prefix)
 * 3. Partial Multi-Token Matches across all fields
 */

export interface BaseSearchableItem {
  id: number;
  item_code: string;
  item_name: string;
  company_name?: string | null;
  generic_name?: string | null;
  category?: string | null;
  packing?: string | null;
  barcode?: string | null;
  purchase_price: number;
  retail_price: number;
  wholesale_price?: number;
  trade_price?: number;
  loose_rate?: number;
  retail_loose_rate?: number;
  wholesale_loose_rate?: number;
  units_per_pack?: number;
  strips_per_box?: number;
  units_per_strip?: number;
  total_available_packs?: number;
  total_available_units?: number;
  batches?: any[];
  default_batch?: any;
  [key: string]: any;
}

export interface IndexedItem<T extends BaseSearchableItem = BaseSearchableItem> {
  item: T;
  id: number;
  cleanName: string;
  cleanCode: string;
  cleanBarcode: string;
  cleanCompany: string;
  cleanGeneric: string;
  cleanPacking: string;
  searchHay: string;
  nameWords: string[];
}

/**
 * Normalizes an array of items for instant O(1) keyword filtering and scoring.
 */
export function prepareItemIndex<T extends BaseSearchableItem>(items: T[]): IndexedItem<T>[] {
  if (!Array.isArray(items)) return [];
  const indexed: IndexedItem<T>[] = [];
  const seenIds = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it.id !== 'number') continue;
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);

    const cleanName = String(it.item_name || '').toLowerCase().trim();
    const cleanCode = String(it.item_code || '').toLowerCase().trim();
    const cleanBarcode = String(it.barcode || '').toLowerCase().trim();
    const cleanCompany = String(it.company_name || '').toLowerCase().trim();
    const cleanGeneric = String(it.generic_name || '').toLowerCase().trim();
    const cleanPacking = String(it.packing || '').toLowerCase().trim();
    const cleanCategory = String(it.category || '').toLowerCase().trim();

    const searchHay = `${cleanName} ${cleanCompany} ${cleanCode} ${cleanBarcode} ${cleanGeneric} ${cleanPacking} ${cleanCategory}`;
    const nameWords = cleanName.split(/[\s\-()/]+/).filter(Boolean);

    indexed.push({
      item: it,
      id: it.id,
      cleanName,
      cleanCode,
      cleanBarcode,
      cleanCompany,
      cleanGeneric,
      cleanPacking,
      searchHay,
      nameWords,
    });
  }

  return indexed;
}

/**
 * Searches indexed items with prioritization:
 * Exact match -> Starts with -> Partial match -> Word boundary match.
 */
export function searchItems<T extends BaseSearchableItem>(
  indexed: IndexedItem<T>[],
  queryStr: string,
  limit: number = 40
): T[] {
  if (!Array.isArray(indexed) || indexed.length === 0) return [];
  const q = String(queryStr || '').trim().toLowerCase();

  // If query is empty, return top items without sorting overhead
  if (!q) {
    return indexed.slice(0, limit).map((x) => x.item);
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const matches: Array<{ item: T; score: number }> = [];

  for (let i = 0; i < indexed.length; i++) {
    const x = indexed[i];

    // Must match all tokens across any of the item's searchable fields
    let allTokensMatch = true;
    for (let t = 0; t < tokens.length; t++) {
      if (!x.searchHay.includes(tokens[t])) {
        allTokensMatch = false;
        break;
      }
    }
    if (!allTokensMatch) continue;

    let score = 0;

    // 1. EXACT MATCHES (Top Priority)
    if (x.cleanBarcode && x.cleanBarcode === q) {
      score += 1_000_000;
    } else if (x.cleanCode === q) {
      score += 600_000;
    } else if (x.cleanName === q) {
      score += 400_000;
    } else if (x.cleanCompany === q) {
      score += 200_000;
    }

    // 2. STARTS WITH / PREFIX MATCHES (Second Priority)
    if (x.cleanName.startsWith(q)) {
      score += 120_000 + Math.max(0, 500 - x.cleanName.length);
    } else if (x.cleanCode.startsWith(q)) {
      score += 90_000;
    } else if (x.cleanBarcode && x.cleanBarcode.startsWith(q)) {
      score += 80_000;
    } else if (x.cleanCompany.startsWith(q)) {
      score += 60_000;
    }

    // Word prefix matching (e.g. typing "pan" matches "Tab Panadol")
    for (let w = 0; w < x.nameWords.length; w++) {
      if (x.nameWords[w].startsWith(q)) {
        score += 55_000;
        break;
      } else if (tokens[0] && x.nameWords[w].startsWith(tokens[0])) {
        score += 30_000;
        break;
      }
    }

    // 3. PARTIAL MATCHES
    if (x.cleanName.includes(q)) {
      score += 25_000;
    }
    if (x.cleanCompany.includes(q)) {
      score += 18_000;
    }
    if (x.cleanGeneric && (x.cleanGeneric.startsWith(q) || x.cleanGeneric.includes(q))) {
      score += 12_000;
    }

    // Availability bonus (available stock ranks higher among identical scores)
    const stockPacks = Number(x.item.total_available_packs || x.item.opening_stock || 0);
    if (stockPacks > 0) {
      score += 100;
    }

    matches.push({ item: x.item, score });
  }

  matches.sort((a, b) => b.score - a.score || a.item.item_name.localeCompare(b.item.item_name));
  return matches.slice(0, limit).map((m) => m.item);
}
