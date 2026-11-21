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
