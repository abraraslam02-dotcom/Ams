import { DatasheetRow } from '../types/sales';
import { PurchaseLineItem } from '../types/purchase';

/**
 * Formats a numeric value cleanly for SMS (integers without decimals, decimals up to 2 places).
 */
export function formatSmsNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return String(rounded);
}

/**
 * Validates and normalizes a Pakistani mobile number to +923XXXXXXXXX format.
 * Accepts:
 *  - +923001234567
 *  - 923001234567
 *  - 00923001234567
 *  - 03001234567
 *  - 3001234567
 *  - With spaces, hyphens, or parentheses (e.g. 0300-1234567, +92 300 1234567)
 * Returns the normalized "+923XXXXXXXXX" string if valid, or null if invalid.
 */
export function normalizePakistaniSmsNumber(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  const cleaned = String(rawInput)
    .trim()
    .replace(/[\s\-().]/g, '');

  if (!cleaned) return null;

  let digits = cleaned;
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  if (digits.startsWith('0092')) {
    digits = '92' + digits.slice(4);
  } else if (digits.startsWith('03') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  } else if (digits.startsWith('3') && digits.length === 10) {
    digits = '92' + digits;
  }

  // Valid Pakistani mobile number in international format: 92 + 3XX + 7 digits = 12 digits
  if (/^923\d{9}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Generates the Sales Invoice Customer SMS text from the active Sales Invoice rows.
 * Format per line:
 *   S.No. Item Name  Qty @ Rate = Amount
 * Example:
 *   1. Panadol Tab  2 @ 500 = 1000
 *   2. Brufen Tab  3 @ 150 = 450
 *   3. Syrup  1 @ 200 = 200
 */
export function generateSalesInvoiceSmsText(rows: DatasheetRow[]): string {
  const populatedRows = rows.filter(
    (r) =>
      (r.item_id !== null && Number(r.item_id) > 0) ||
      Boolean(r.item_code?.trim()) ||
      Boolean(r.item_name?.trim())
  );

  const lines = populatedRows.map((row, idx) => {
    const sNo = idx + 1;
    const itemName = String(row.item_name || row.item_code || 'Item').trim();

    const packQty = Number(row.quantity || 0);
    const looseQty = Number(row.loose_quantity || 0);

    // Use pack quantity and pack unit_price by default; if only loose units are sold, use loose_quantity and loose_rate
    const qty = packQty > 0 ? packQty : looseQty > 0 ? looseQty : 0;
    const rate =
      packQty > 0
        ? Number(row.unit_price || 0)
        : looseQty > 0
        ? Number(row.loose_rate || row.unit_price || 0)
        : Number(row.unit_price || 0);

    const rawAmount =
      Number(row.line_total || 0) > 0
        ? Number(row.line_total)
        : Number(row.gross_amount || 0) > 0
        ? Number(row.gross_amount)
        : qty * rate;

    return `${sNo}. ${itemName}  ${formatSmsNumber(qty)} @ ${formatSmsNumber(rate)} = ${formatSmsNumber(rawAmount)}`;
  });

  return lines.join('\n');
}

/**
 * Generates the Purchase Invoice Order SMS text from the active Purchase Invoice lines.
 * Maps the actual item Qty from each Purchase Order detail record (never S.No / row index).
 * Shows Discount Percentage ONLY when discount_percent is valid and greater than 0.
 * Example:
 *   ABRAR MEDICAL STORE
 *
 *   10 = Panadol (5%)
 *   25 = Brufen (10%)
 *   5 = Syrup
 */
export function generatePurchaseOrderSmsText(
  lines: PurchaseLineItem[],
  storeName = 'ABRAR MEDICAL STORE'
): string {
  const header = (storeName || 'ABRAR MEDICAL STORE').trim().toUpperCase();

  const populatedLines = lines.filter(
    (line) =>
      Number(line.item_id || 0) > 0 ||
      Boolean(line.item_code?.trim()) ||
      Boolean(line.item_name?.trim())
  );

  const itemLines = populatedLines.map((line) => {
    const itemName = String(line.item_name || line.item_code || 'Item').trim();
    const rawQty = Number(line.quantity ?? 0);
    const rawLooseQty = Number(line.loose_quantity ?? 0);
    const rawPackQty = Number(line.pack_quantity ?? 0);
    const qty =
      Number.isFinite(rawQty) && rawQty > 0
        ? rawQty
        : Number.isFinite(rawLooseQty) && rawLooseQty > 0
        ? rawLooseQty
        : Number.isFinite(rawPackQty) && rawPackQty > 0
        ? rawPackQty
        : 0;
    const formattedQty = formatSmsNumber(qty);

    const rawVal = line.discount_percent as unknown;
    const isEmpty =
      rawVal === null ||
      rawVal === undefined ||
      (typeof rawVal === 'string' && rawVal.trim() === '');
    const numericDiscount = isEmpty ? 0 : Number(rawVal);
    if (Number.isFinite(numericDiscount) && numericDiscount > 0) {
      return `${formattedQty} = ${itemName} (${formatSmsNumber(numericDiscount)}%)`;
    }
    return `${formattedQty} = ${itemName}`;
  });

  return `${header}\n\n${itemLines.join('\n')}`;
}

/**
 * Builds a standard RFC 5724 sms: URI that opens the device's default SMS application
 * with the recipient number and prepared message body.
 */
export function buildDefaultSmsAppUri(recipientPlus92: string, messageBody: string): string {
  const cleanRecipient = recipientPlus92.trim();
  const encodedBody = encodeURIComponent(messageBody);
  return `sms:${cleanRecipient}?body=${encodedBody}`;
}
