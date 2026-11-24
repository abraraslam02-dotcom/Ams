import { calculateLineTax, resolveItemTaxConfig, resolveLineSequentialDiscounts } from './taxCalculation';
import { formatAppDate } from './formatters';
import type { PageMarginOption, FontSizeScaleOption } from './printEngine';

export interface GroupedPurchaseLine {
  sNo: number;
  originalIndex: number;
  raw: Record<string, any>;
  itemName: string;
  variantName?: string;
  variantCode?: string;
  itemCode: string;
  companyName: string;
  packing: string;
  quantity: number;
  looseQuantity: number;
  bonusQuantity: number;
  batchNumber: string;
  expiryDate: string;
  tradePrice: number;
  discount1Percent: number;
  discount2Percent: number;
  discountPercent: number;
  netRate: number;
  discountAmount: number;
  grossAmount: number;
  taxableAmount: number;
  salesTaxAmount: number;
  advanceTaxAmount: number;
  valueWithAllTaxes: number;
  remarks: string;
}

export interface CompanyPurchaseGroup {
  companyKey: string;
  companyName: string;
  items: GroupedPurchaseLine[];
  totalQuantity: number;
  totalLooseQuantity: number;
  totalBonus: number;
  grossAmount: number;
  totalDiscountAmount: number;
  totalSalesTax: number;
  totalAdvanceTax: number;
  totalValueWithAllTaxes: number;
}

export interface PurchaseInvoiceGroupedSummary {
  groups: CompanyPurchaseGroup[];
  summary: {
    totalQuantity: number;
    totalLooseQuantity: number;
    totalBonus: number;
    grossAmount: number;
    totalDiscount: number;
    itemDiscountAmount: number;
    invoiceDiscountAmount: number;
    taxableAmount: number;
    totalSalesTax: number;
    totalAdvanceTax: number;
    grandTotal: number;
  };
}

function round2(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function allocateAmountCents(
  totalAmount: number,
  weights: number[]
): number[] {
  const targetCents = Math.round(round2(totalAmount) * 100);
  const count = weights.length;
  if (count === 0) return [];
  if (targetCents === 0) return weights.map(() => 0);

  const safeWeights = weights.map((w) => Math.max(0, Number(w) || 0));
  const totalWeight = safeWeights.reduce((s, w) => s + w, 0);

  const exactShares = safeWeights.map((w) =>
    totalWeight > 0 ? (targetCents * w) / totalWeight : targetCents / count
  );

  const flooredCents = exactShares.map((s) => Math.floor(s + 1e-9));
  let remainderCents = targetCents - flooredCents.reduce((s, c) => s + c, 0);

  if (remainderCents > 0) {
    const order = exactShares
      .map((s, idx) => ({ idx, frac: s - flooredCents[idx] }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);

    for (let i = 0; i < order.length && remainderCents > 0; i++) {
      flooredCents[order[i].idx] += 1;
      remainderCents -= 1;
    }
  } else if (remainderCents < 0) {
    const order = exactShares
      .map((s, idx) => ({ idx, frac: s - flooredCents[idx] }))
      .sort((a, b) => a.frac - b.frac || b.idx - a.idx);

    for (let i = 0; i < order.length && remainderCents < 0; i++) {
      if (flooredCents[order[i].idx] > 0) {
        flooredCents[order[i].idx] -= 1;
        remainderCents += 1;
      }
    }
  }

  return flooredCents.map((c) => round2(c / 100));
}

/**
 * Groups saved Purchase Invoice line items by their authoritative Company Name from Item Master,
 * reconciles per-item Discount, Sales Tax, and prorated Advance Tax to exact invoice totals
 * without duplicating taxes or altering saved numbers, and computes isolated company footers
 * plus the combined invoice summary.
 */
export function buildCompanyGroupedPurchaseData(
  doc: Record<string, any> | null | undefined,
  rawItems: Array<Record<string, any>>
): PurchaseInvoiceGroupedSummary {
  const safeDoc = doc || {};
  const items = Array.isArray(rawItems) ? rawItems : [];

  if (items.length === 0) {
    return {
      groups: [],
      summary: {
        totalQuantity: 0,
        totalLooseQuantity: 0,
        totalBonus: 0,
        grossAmount: round2(safeDoc.gross_total ?? safeDoc.gross_amount ?? 0),
        totalDiscount: round2(safeDoc.discount_amount ?? 0),
        itemDiscountAmount: round2(safeDoc.item_discount_amount ?? 0),
        invoiceDiscountAmount: round2(safeDoc.invoice_discount_amount ?? 0),
        taxableAmount: round2(safeDoc.taxable_amount ?? 0),
        totalSalesTax: round2(safeDoc.gst_amount ?? 0),
        totalAdvanceTax: round2(safeDoc.advance_tax_amount ?? 0),
        grandTotal: round2(safeDoc.net_total ?? 0),
      },
    };
  }

  // 1. Extract base gross & item-level discounts/taxes from saved purchase lines (never using sales prices)
  const baseRows = items.map((item, originalIndex) => {
    const quantity = round2(item.quantity ?? item.pack_quantity ?? 0);
    const looseQuantity = round2(item.loose_quantity ?? 0);
    const bonusQuantity = round2(item.bonus_quantity ?? 0);
    const tradePrice = round2(item.purchase_rate ?? 0);
    const looseRate = round2(item.loose_rate ?? 0);
    const grossAmount = round2(
      item.gross_amount !== undefined && item.gross_amount !== null
        ? Number(item.gross_amount)
        : quantity * tradePrice + looseQuantity * looseRate
    );
    const seqDisc = resolveLineSequentialDiscounts(item, tradePrice);
    const discountPercent = round2(item.discount_percent ?? seqDisc.discount_percent);
    const rawItemDiscount = round2(item.discount_amount ?? 0);
    const rawLineAfterItemDisc = round2(Math.max(0, grossAmount - rawItemDiscount));
    const rawSalesTax = round2(item.tax_amount ?? 0);
    const rawTaxable = round2(
      item.taxable_amount !== undefined && item.taxable_amount !== null
        ? Number(item.taxable_amount)
        : rawLineAfterItemDisc
    );

    const companyName =
      String(item.company_name || item.master_company_name || 'Uncategorized Company').trim() ||
      'Uncategorized Company';

    const resolvedTax = resolveItemTaxConfig(item);
    return {
      originalIndex,
      raw: item,
      companyName,
      companyKey: companyName.toLowerCase(),
      itemName: String(item.item_name || '').trim() || 'Unnamed Item',
      variantName: String(item.variant_name || '').trim(),
      variantCode: String(item.variant_code || '').trim(),
      itemCode: String(item.item_code || '').trim(),
      packing: String(item.packing || '').trim(),
      unitsPerPack: Math.max(1, Number(item.units_per_pack || 1)),
      quantity,
      looseQuantity,
      bonusQuantity,
      batchNumber: String(item.batch_number || '').trim() || '—',
      expiryDate: formatAppDate(item.expiry_date, '—'),
      tradePrice,
      discount1Percent: seqDisc.discount_1_percent,
      discount2Percent: seqDisc.discount_2_percent,
      discountPercent,
      netRate: seqDisc.net_rate,
      grossAmount,
      rawItemDiscount,
      rawLineAfterItemDisc,
      rawTaxable,
      rawSalesTax,
      taxType: resolvedTax.tax_type,
      taxValue: resolvedTax.tax_value,
      taxPercent: round2(item.tax_percent ?? 0),
      remarks: String(item.remarks || item.line_remarks || '').trim(),
    };
  });

  const sumGross = round2(baseRows.reduce((s, r) => s + r.grossAmount, 0));
  const sumRawItemDiscount = round2(baseRows.reduce((s, r) => s + r.rawItemDiscount, 0));
  const sumRawTaxable = round2(baseRows.reduce((s, r) => s + r.rawTaxable, 0));
  const sumRawSalesTax = round2(baseRows.reduce((s, r) => s + r.rawSalesTax, 0));

  const headerGross = round2(
    safeDoc.gross_total !== undefined ? safeDoc.gross_total : safeDoc.gross_amount ?? sumGross
  );
  const headerTotalDiscount = round2(
    safeDoc.discount_amount !== undefined ? safeDoc.discount_amount : sumRawItemDiscount
  );
  const headerTaxable = round2(
    safeDoc.taxable_amount !== undefined
      ? safeDoc.taxable_amount
      : Math.max(0, headerGross - headerTotalDiscount)
  );
  const headerSalesTax = round2(
    safeDoc.gst_amount !== undefined ? safeDoc.gst_amount : sumRawSalesTax
  );
  const headerAdvanceTax = round2(safeDoc.advance_tax_amount ?? 0);

  // 2. Reconcile line discounts & taxable amounts if an invoice-level discount was also applied
  const hasExtraInvoiceDiscount = Math.abs(headerTotalDiscount - sumRawItemDiscount) > 0.02;
  let lineDiscounts: number[];
  let lineTaxables: number[];

  if (!hasExtraInvoiceDiscount) {
    lineDiscounts = baseRows.map((r) => r.rawItemDiscount);
    lineTaxables = baseRows.map((r) => round2(r.grossAmount - r.rawItemDiscount));
  } else if (Math.abs(sumRawTaxable - headerTaxable) <= 0.05) {
    // Saved DB rows already store invoice-discount-prorated taxable_amount
    const derivedDiscs = baseRows.map((r) => round2(Math.max(0, r.grossAmount - r.rawTaxable)));
    const derivedSum = round2(derivedDiscs.reduce((s, d) => s + d, 0));
    const diff = round2(headerTotalDiscount - derivedSum);
    if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.05 && derivedDiscs.length > 0) {
      derivedDiscs[derivedDiscs.length - 1] = round2(
        Math.max(0, derivedDiscs[derivedDiscs.length - 1] + diff)
      );
    }
    lineDiscounts = derivedDiscs;
    lineTaxables = baseRows.map((r, i) => round2(r.grossAmount - lineDiscounts[i]));
  } else {
    // Preview path where invoice discount has not yet been prorated onto raw lines
    const extraDiscount = round2(Math.max(0, headerTotalDiscount - sumRawItemDiscount));
    const extraAllocated = allocateAmountCents(
      extraDiscount,
      baseRows.map((r) => r.rawLineAfterItemDisc)
    );
    lineDiscounts = baseRows.map((r, i) => round2(r.rawItemDiscount + extraAllocated[i]));
    lineTaxables = baseRows.map((r, i) => round2(r.grossAmount - lineDiscounts[i]));
  }

  // 3. Reconcile Sales Tax (tax is calculated on original gross amount BEFORE discounts)
  let lineSalesTaxes: number[];
  if (Math.abs(sumRawSalesTax - headerSalesTax) <= 0.02) {
    lineSalesTaxes = baseRows.map((r) => r.rawSalesTax);
  } else {
    const rawTaxOnGross = baseRows.map((r) =>
      calculateLineTax({
        grossAmount: r.grossAmount,
        quantity: r.quantity,
        looseQuantity: r.looseQuantity,
        unitsPerPack: r.unitsPerPack,
        taxType: r.taxType,
        taxValue: r.taxValue,
        taxPercent: r.taxPercent,
      })
    );
    lineSalesTaxes = allocateAmountCents(headerSalesTax, rawTaxOnGross);
  }

  // 4. Prorate saved Invoice Advance Tax strictly without recalculating/duplicating tax
  const advBasisMode = String(safeDoc.advance_tax_basis || 'taxable_plus_gst');
  const advWeights = baseRows.map((r, i) => {
    if (advBasisMode === 'gross_amount') return r.grossAmount;
    if (advBasisMode === 'taxable_amount') return lineTaxables[i];
    return round2(lineTaxables[i] + lineSalesTaxes[i]);
  });
  const lineAdvanceTaxes = allocateAmountCents(headerAdvanceTax, advWeights);

  // 5. Group items strictly by Item Master Company Name (never mixing companies)
  const groupMap = new Map<string, { companyName: string; rows: Array<Omit<GroupedPurchaseLine, 'sNo'>> }>();

  for (let i = 0; i < baseRows.length; i++) {
    const r = baseRows[i];
    const discountAmount = lineDiscounts[i];
    const taxableAmount = lineTaxables[i];
    const salesTaxAmount = lineSalesTaxes[i];
    const advanceTaxAmount = lineAdvanceTaxes[i];
    const valueWithAllTaxes = round2(taxableAmount + salesTaxAmount + advanceTaxAmount);

    let bucket = groupMap.get(r.companyKey);
    if (!bucket) {
      bucket = { companyName: r.companyName, rows: [] };
      groupMap.set(r.companyKey, bucket);
    }

    bucket.rows.push({
      originalIndex: r.originalIndex,
      raw: r.raw,
      itemName: r.itemName,
      variantName: r.variantName,
      variantCode: r.variantCode,
      itemCode: r.itemCode,
      companyName: bucket.companyName,
      packing: r.packing,
      quantity: r.quantity,
      looseQuantity: r.looseQuantity,
      bonusQuantity: r.bonusQuantity,
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate,
      tradePrice: r.tradePrice,
      discount1Percent: r.discount1Percent,
      discount2Percent: r.discount2Percent,
      discountPercent: r.discountPercent,
      netRate: r.netRate,
      discountAmount,
      grossAmount: r.grossAmount,
      taxableAmount,
      salesTaxAmount,
      advanceTaxAmount,
      valueWithAllTaxes,
      remarks: r.remarks,
    });
  }

  // Sort company groups alphabetically so every company appears cleanly with all its items consolidated
  const sortedBuckets = Array.from(groupMap.entries())
    .sort(([, a], [, b]) => a.companyName.localeCompare(b.companyName))
    .map(([companyKey, bucket]) => ({ companyKey, ...bucket }));

  let runningSNo = 1;
  const groups: CompanyPurchaseGroup[] = sortedBuckets.map((bucket) => {
    const numberedItems: GroupedPurchaseLine[] = bucket.rows.map((row) => ({
      ...row,
      sNo: runningSNo++,
    }));

    return {
      companyKey: bucket.companyKey,
      companyName: bucket.companyName,
      items: numberedItems,
      totalQuantity: round2(numberedItems.reduce((s, x) => s + x.quantity, 0)),
      totalLooseQuantity: round2(numberedItems.reduce((s, x) => s + x.looseQuantity, 0)),
      totalBonus: round2(numberedItems.reduce((s, x) => s + x.bonusQuantity, 0)),
      grossAmount: round2(numberedItems.reduce((s, x) => s + x.grossAmount, 0)),
      totalDiscountAmount: round2(numberedItems.reduce((s, x) => s + x.discountAmount, 0)),
      totalSalesTax: round2(numberedItems.reduce((s, x) => s + x.salesTaxAmount, 0)),
      totalAdvanceTax: round2(numberedItems.reduce((s, x) => s + x.advanceTaxAmount, 0)),
      totalValueWithAllTaxes: round2(numberedItems.reduce((s, x) => s + x.valueWithAllTaxes, 0)),
    };
  });

  const combinedQty = round2(groups.reduce((s, g) => s + g.totalQuantity, 0));
  const combinedLoose = round2(groups.reduce((s, g) => s + g.totalLooseQuantity, 0));
  const combinedBonus = round2(groups.reduce((s, g) => s + g.totalBonus, 0));
  const combinedGross = round2(groups.reduce((s, g) => s + g.grossAmount, 0));
  const combinedDiscount = round2(groups.reduce((s, g) => s + g.totalDiscountAmount, 0));
  const combinedSalesTax = round2(groups.reduce((s, g) => s + g.totalSalesTax, 0));
  const combinedAdvanceTax = round2(groups.reduce((s, g) => s + g.totalAdvanceTax, 0));
  const combinedGrandTotal = round2(groups.reduce((s, g) => s + g.totalValueWithAllTaxes, 0));

  return {
    groups,
    summary: {
      totalQuantity: combinedQty,
      totalLooseQuantity: combinedLoose,
      totalBonus: combinedBonus,
      grossAmount: combinedGross,
      totalDiscount: combinedDiscount,
      itemDiscountAmount: round2(safeDoc.item_discount_amount ?? sumRawItemDiscount),
      invoiceDiscountAmount: round2(
        safeDoc.invoice_discount_amount ?? Math.max(0, combinedDiscount - sumRawItemDiscount)
      ),
      taxableAmount: round2(combinedGross - combinedDiscount),
      totalSalesTax: combinedSalesTax,
      totalAdvanceTax: combinedAdvanceTax,
      grandTotal: combinedGrandTotal,
    },
  };
}

export type PurchaseItemSortMode = 'company' | 'item_name' | 'direct';
export type PurchasePrintLayoutMode =
  | 'a4-portrait'
  | 'a4-landscape'
  | 'thermal-80mm'
  | 'thermal-58mm';

export interface PurchasePrintFieldsConfig {
  // Core 22 Purchase Print Fields
  showCompanyName: boolean;
  showItemName: boolean;
  showItemCode: boolean;
  showPacking: boolean;
  showBatchNumber: boolean;
  showExpiryDate: boolean;
  showQuantity: boolean;
  showBonusQuantity: boolean;
  showLooseQuantity: boolean;
  showPurchaseRate: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showNetAmount: boolean;
  showTotalQuantity: boolean;
  showTotalItems: boolean;
  showInvoiceNumber: boolean;
  showInvoiceDate: boolean;
  showSupplierName: boolean;
  showPreviousBalance: boolean;
  showPaidAmount: boolean;
  showRemainingBalance: boolean;
  showRemarks: boolean;
  // Store Header & Verification Fields
  showLogo: boolean;
  showDrugLicense: boolean;
  showNtn: boolean;
  showSignature: boolean;
  showAccountingVerification: boolean;
}

export interface PurchasePrintOptions {
  sortMode: PurchaseItemSortMode;
  groupByCompany: boolean;
  layout: PurchasePrintLayoutMode;
  margin: PageMarginOption;
  fontSizeScale: FontSizeScaleOption;
  copies: number;
  fields: PurchasePrintFieldsConfig;
}

export const DEFAULT_PURCHASE_PRINT_FIELDS: PurchasePrintFieldsConfig = {
  showCompanyName: true,
  showItemName: true,
  showItemCode: false, // Default off to maintain exact existing 12-column A4 Purchase Invoice layout
  showPacking: true,
  showBatchNumber: true,
  showExpiryDate: true,
  showQuantity: true,
  showBonusQuantity: true,
  showLooseQuantity: true,
  showPurchaseRate: true,
  showDiscount: true,
  showTax: true,
  showNetAmount: true,
  showTotalQuantity: true,
  showTotalItems: true,
  showInvoiceNumber: true,
  showInvoiceDate: true,
  showSupplierName: true,
  showPreviousBalance: true,
  showPaidAmount: true,
  showRemainingBalance: true,
  showRemarks: true,
  showLogo: true,
  showDrugLicense: true,
  showNtn: true,
  showSignature: true,
  showAccountingVerification: false,
};

export const DEFAULT_PURCHASE_PRINT_OPTIONS: PurchasePrintOptions = {
  sortMode: 'company',
  groupByCompany: true,
  layout: 'a4-portrait',
  margin: 'standard',
  fontSizeScale: 'normal',
  copies: 1,
  fields: { ...DEFAULT_PURCHASE_PRINT_FIELDS },
};

const VALID_SORT_MODES: PurchaseItemSortMode[] = ['company', 'item_name', 'direct'];
const VALID_LAYOUTS: PurchasePrintLayoutMode[] = [
  'a4-portrait',
  'a4-landscape',
  'thermal-80mm',
  'thermal-58mm',
];
const VALID_MARGINS: PageMarginOption[] = ['none', 'minimum', 'compact', 'standard'];
const VALID_FONT_SCALES: FontSizeScaleOption[] = ['small', 'normal', 'large'];

/**
 * Parses Purchase-specific print options from company_settings.field_visibility_json
 * without affecting Sales Invoice field visibility settings.
 */
export function parsePurchasePrintOptions(
  fieldVisibilityJson?: string | null
): PurchasePrintOptions {
  const defaults: PurchasePrintOptions = {
    ...DEFAULT_PURCHASE_PRINT_OPTIONS,
    fields: { ...DEFAULT_PURCHASE_PRINT_FIELDS },
  };
  if (!fieldVisibilityJson) return defaults;
  try {
    const parsed = JSON.parse(fieldVisibilityJson);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const saved = parsed.purchasePrintOptions;
    if (!saved || typeof saved !== 'object') {
      // Respect legacy top-level store header toggles if Purchase options were never explicitly saved
      return {
        ...defaults,
        fields: {
          ...defaults.fields,
          showLogo: typeof parsed.showLogo === 'boolean' ? parsed.showLogo : defaults.fields.showLogo,
          showDrugLicense:
            typeof parsed.showDrugLicense === 'boolean'
              ? parsed.showDrugLicense
              : defaults.fields.showDrugLicense,
          showNtn: typeof parsed.showNtn === 'boolean' ? parsed.showNtn : defaults.fields.showNtn,
          showPreviousBalance:
            typeof parsed.showPreviousBalance === 'boolean'
              ? parsed.showPreviousBalance
              : defaults.fields.showPreviousBalance,
          showSignature:
            typeof parsed.showSignature === 'boolean'
              ? parsed.showSignature
              : defaults.fields.showSignature,
          showAccountingVerification:
            typeof parsed.showAccountingVerification === 'boolean'
              ? parsed.showAccountingVerification
              : defaults.fields.showAccountingVerification,
        },
      };
    }

    const savedFields =
      saved.fields && typeof saved.fields === 'object' ? saved.fields : {};
    const mergedFields: PurchasePrintFieldsConfig = { ...DEFAULT_PURCHASE_PRINT_FIELDS };
    (Object.keys(DEFAULT_PURCHASE_PRINT_FIELDS) as Array<keyof PurchasePrintFieldsConfig>).forEach(
      (k) => {
        if (typeof savedFields[k] === 'boolean') {
          mergedFields[k] = savedFields[k];
        }
      }
    );

    return {
      sortMode: VALID_SORT_MODES.includes(saved.sortMode) ? saved.sortMode : defaults.sortMode,
      groupByCompany:
        typeof saved.groupByCompany === 'boolean' ? saved.groupByCompany : defaults.groupByCompany,
      layout: VALID_LAYOUTS.includes(saved.layout) ? saved.layout : defaults.layout,
      margin: VALID_MARGINS.includes(saved.margin) ? saved.margin : defaults.margin,
      fontSizeScale: VALID_FONT_SCALES.includes(saved.fontSizeScale)
        ? saved.fontSizeScale
        : defaults.fontSizeScale,
      copies: Math.max(1, Math.min(10, Number(saved.copies) || 1)),
      fields: mergedFields,
    };
  } catch {
    return defaults;
  }
}

/**
 * Safely merges Purchase-only print preferences into field_visibility_json
 * while preserving every existing Sales Invoice key untouched.
 */
export function mergePurchasePrintOptionsIntoJson(
  existingFieldVisibilityJson: string | null | undefined,
  options: PurchasePrintOptions
): string {
  let baseObj: Record<string, any> = {};
  if (existingFieldVisibilityJson) {
    try {
      const parsed = JSON.parse(existingFieldVisibilityJson);
      if (parsed && typeof parsed === 'object') {
        baseObj = { ...parsed };
      }
    } catch {
      baseObj = {};
    }
  }
  baseObj.purchasePrintOptions = options;
  return JSON.stringify(baseObj);
}

export interface PurchasePrintViewData {
  isGrouped: boolean;
  groups: CompanyPurchaseGroup[];
  flatItems: GroupedPurchaseLine[];
  companyCount: number;
  totalItemsCount: number;
  summary: PurchaseInvoiceGroupedSummary['summary'];
}

/**
 * Builds the Purchase Invoice print view dataset according to the selected Sorting
 * and Company Display options. Reuses buildCompanyGroupedPurchaseData so every
 * line amount, discount, tax, and invoice grand total remains 100% mathematically accurate.
 */
export function buildPurchasePrintViewData(
  doc: Record<string, any> | null | undefined,
  rawItems: Array<Record<string, any>>,
  options: { sortMode: PurchaseItemSortMode; groupByCompany: boolean; showCompanyName: boolean }
): PurchasePrintViewData {
  const baseGrouped = buildCompanyGroupedPurchaseData(doc, rawItems);
  const allReconciledLines: GroupedPurchaseLine[] = baseGrouped.groups.flatMap((g) => g.items);

  // Determine whether company headings/subtotals are shown
  // When sortMode is 'direct' ("All Items Directly") or groupByCompany is false or company name is hidden,
  // display items cleanly without company headings or empty group headers.
  const isGrouped =
    options.sortMode !== 'direct' && options.groupByCompany && options.showCompanyName;

  if (isGrouped) {
    let runningSNo = 1;
    const orderedGroups: CompanyPurchaseGroup[] = baseGrouped.groups.map((g) => {
      const sortedItems =
        options.sortMode === 'item_name'
          ? [...g.items].sort(
              (a, b) =>
                a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' }) ||
                a.originalIndex - b.originalIndex
            )
          : [...g.items].sort((a, b) => a.originalIndex - b.originalIndex);

      const renumbered = sortedItems.map((item) => ({
        ...item,
        sNo: runningSNo++,
      }));

      return {
        ...g,
        items: renumbered,
      };
    });

    return {
      isGrouped: true,
      groups: orderedGroups,
      flatItems: orderedGroups.flatMap((g) => g.items),
      companyCount: baseGrouped.groups.length,
      totalItemsCount: allReconciledLines.length,
      summary: baseGrouped.summary,
    };
  }

  // Continuous ungrouped list (no company headings or blank spaces)
  let sortedFlat: GroupedPurchaseLine[];
  if (options.sortMode === 'item_name') {
    sortedFlat = [...allReconciledLines].sort(
      (a, b) =>
        a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' }) ||
        a.originalIndex - b.originalIndex
    );
  } else if (options.sortMode === 'company') {
    sortedFlat = [...allReconciledLines].sort(
      (a, b) =>
        a.companyName.localeCompare(b.companyName, undefined, { sensitivity: 'base' }) ||
        a.originalIndex - b.originalIndex
    );
  } else {
    // 'direct': original invoice entry order
    sortedFlat = [...allReconciledLines].sort((a, b) => a.originalIndex - b.originalIndex);
  }

  const renumberedFlat = sortedFlat.map((item, idx) => ({
    ...item,
    sNo: idx + 1,
  }));

  return {
    isGrouped: false,
    groups: baseGrouped.groups,
    flatItems: renumberedFlat,
    companyCount: baseGrouped.groups.length,
    totalItemsCount: renumberedFlat.length,
    summary: baseGrouped.summary,
  };
}
