export type ItemTaxType = 'percentage' | 'amount';

export function round2(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function normalizeTaxType(val: unknown): ItemTaxType {
  if (typeof val === 'string') {
    const cleaned = val.trim().toLowerCase();
    if (
      cleaned === 'amount' ||
      cleaned === 'fixed' ||
      cleaned === 'fixed amount' ||
      cleaned === 'fixed tax' ||
      cleaned === 'rs' ||
      cleaned === 'rs.' ||
      cleaned === 'pkr' ||
      cleaned === 'flat'
    ) {
      return 'amount';
    }
  }
  return 'percentage';
}

export interface TaxConfigSource {
  tax_type?: string | null;
  tax_value?: number | string | null;
  tax_percent?: number | string | null;
}

export interface ResolvedTaxConfig {
  tax_type: ItemTaxType;
  tax_value: number;
  tax_percent: number;
}

/**
 * Resolves a consistent { tax_type, tax_value, tax_percent } triplet from any item, variant, or invoice line payload.
 * - For 'percentage': tax_percent === tax_value.
 * - For 'amount' (fixed tax per pack/base unit): tax_percent === 0, tax_value holds the fixed currency amount.
 */
export function resolveItemTaxConfig(src?: TaxConfigSource | null): ResolvedTaxConfig {
  if (!src) {
    return { tax_type: 'percentage', tax_value: 0, tax_percent: 0 };
  }
  const tax_type = normalizeTaxType(src.tax_type);
  const rawValue =
    src.tax_value !== undefined && src.tax_value !== null && src.tax_value !== ''
      ? Number(src.tax_value)
      : src.tax_percent !== undefined && src.tax_percent !== null && src.tax_percent !== ''
        ? Number(src.tax_percent)
        : 0;
  const tax_value = Number.isFinite(rawValue) && rawValue > 0 ? round2(rawValue) : 0;
  const tax_percent = tax_type === 'percentage' ? tax_value : 0;
  return { tax_type, tax_value, tax_percent };
}

export interface LineTaxCalculationInput {
  grossAmount: number;
  quantity?: number;
  looseQuantity?: number;
  unitsPerPack?: number;
  taxType?: string | null;
  taxValue?: number | null;
  taxPercent?: number | null;
}

/**
 * Calculates line tax strictly on the ORIGINAL gross amount BEFORE ANY discounts.
 * Discounts NEVER reduce tax.
 *
 * - Percentage: Tax = Gross Amount × Tax Percentage / 100
 * - Fixed Amount: Tax = (Quantity + Loose Quantity / Units Per Pack) × Fixed Tax Value
 */
export function calculateLineTax(input: LineTaxCalculationInput): number {
  const gross = Number(input.grossAmount) || 0;
  if (gross === 0) {
    return 0;
  }

  const resolved = resolveItemTaxConfig({
    tax_type: input.taxType,
    tax_value: input.taxValue,
    tax_percent: input.taxPercent,
  });

  if (resolved.tax_value <= 0) return 0;

  if (resolved.tax_type === 'amount') {
    const qty = Number(input.quantity) || 0;
    const looseQty = Number(input.looseQuantity) || 0;
    const unitsPerPack = Math.max(1, Number(input.unitsPerPack) || 1);
    const effectiveBaseUnits = qty + looseQty / unitsPerPack;
    if (effectiveBaseUnits === 0) return 0;
    return round2(effectiveBaseUnits * resolved.tax_value);
  }

  return round2((gross * resolved.tax_value) / 100);
}

export function formatTaxDisplay(
  taxType?: string | null,
  taxValue?: number | null,
  taxPercent?: number | null
): string {
  const resolved = resolveItemTaxConfig({
    tax_type: taxType,
    tax_value: taxValue,
    tax_percent: taxPercent,
  });
  if (resolved.tax_value <= 0) return '0%';
  if (resolved.tax_type === 'amount') {
    return `Rs. ${resolved.tax_value.toFixed(2)}`;
  }
  return `${resolved.tax_value}%`;
}

export function clampDiscountPercent(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (num >= 100) return 100;
  return round2(num);
}

/**
 * Computes sequential Net Rate:
 * Net Rate = Original Rate * (1 - D1 / 100) * (1 - D2 / 100)
 */
export function calculateSequentialNetRate(
  originalRate: number,
  discount1Percent: number,
  discount2Percent: number
): number {
  const rate = Number(originalRate) || 0;
  const d1 = clampDiscountPercent(discount1Percent);
  const d2 = clampDiscountPercent(discount2Percent);
  const factor = (1 - d1 / 100) * (1 - d2 / 100);
  return round2(rate * factor);
}

export interface SequentialLineDiscountResult {
  discount_1_percent: number;
  discount_2_percent: number;
  effective_discount_percent: number;
  discount_amount: number;
  net_rate: number;
  net_loose_rate: number;
  taxable_amount: number;
}

/**
 * Computes sequential line discount figures using exact factor (1 - d1/100) * (1 - d2/100)
 * without rounding the combined percentage prior to computing discount_amount.
 * Tax is NOT calculated here and remains strictly on original grossAmount before discounts.
 */
export function calculateSequentialLineDiscount(input: {
  originalRate: number;
  looseRate?: number;
  grossAmount: number;
  discount1Percent?: number | null;
  discount2Percent?: number | null;
}): SequentialLineDiscountResult {
  const d1 = clampDiscountPercent(input.discount1Percent);
  const d2 = clampDiscountPercent(input.discount2Percent);
  const factor = (1 - d1 / 100) * (1 - d2 / 100);
  const effective_discount_percent = round2((1 - factor) * 100);
  const gross = Number(input.grossAmount) || 0;
  const discount_amount = round2(gross * (1 - factor));
  const net_rate = round2((Number(input.originalRate) || 0) * factor);
  const net_loose_rate = round2((Number(input.looseRate) || 0) * factor);
  const taxable_amount = round2(gross - discount_amount);
  return {
    discount_1_percent: d1,
    discount_2_percent: d2,
    effective_discount_percent,
    discount_amount,
    net_rate,
    net_loose_rate,
    taxable_amount,
  };
}

/**
 * Resolves sequential discount fields on read/edit without mutating historical DB rows:
 * - If discount_1_percent > 0 or discount_2_percent > 0: uses stored sequential fields directly.
 * - Else if legacy discount_percent > 0: maps to D1 = discount_percent, D2 = 0.
 * - Else returns 0 / 0 and full original rate.
 */
export function resolveLineSequentialDiscounts(
  line: {
    discount_1_percent?: number | string | null;
    discount_2_percent?: number | string | null;
    discount_percent?: number | string | null;
    net_rate?: number | string | null;
  },
  originalRate: number
): {
  discount_1_percent: number;
  discount_2_percent: number;
  discount_percent: number;
  net_rate: number;
} {
  const rawD1 = clampDiscountPercent(line.discount_1_percent);
  const rawD2 = clampDiscountPercent(line.discount_2_percent);
  const legacyDisc = clampDiscountPercent(line.discount_percent);
  const rate = Number(originalRate) || 0;

  let d1 = rawD1;
  let d2 = rawD2;
  if (d1 === 0 && d2 === 0 && legacyDisc > 0) {
    d1 = legacyDisc;
    d2 = 0;
  }

  const factor = (1 - d1 / 100) * (1 - d2 / 100);
  const effectiveDisc = round2((1 - factor) * 100);
  const storedNet = Number(line.net_rate || 0);
  const computedNet = round2(rate * factor);
  const net_rate =
    storedNet > 0 && (rawD1 > 0 || rawD2 > 0)
      ? round2(storedNet)
      : d1 === 0 && d2 === 0
        ? round2(rate)
        : computedNet;

  return {
    discount_1_percent: d1,
    discount_2_percent: d2,
    discount_percent: d1 === 0 && d2 === 0 ? legacyDisc : effectiveDisc,
    net_rate,
  };
}

export function formatSequentialDiscountLabel(
  d1?: number | null,
  d2?: number | null,
  fallbackPercent?: number | null
): string {
  const v1 = clampDiscountPercent(d1);
  const v2 = clampDiscountPercent(d2);
  if (v1 > 0 && v2 > 0) return `${v1}% + ${v2}%`;
  if (v1 > 0) return `${v1}%`;
  if (v2 > 0) return `0% + ${v2}%`;
  const fb = clampDiscountPercent(fallbackPercent);
  return fb > 0 ? `${fb}%` : '0%';
}

