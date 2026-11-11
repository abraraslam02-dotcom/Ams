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
 * Format:
 *   ABRAR MEDICAL STORE
 *
 *   1 = Panadol (5%)
 *   2 = Brufen (10%)
 *   3 = Syrup (0%)
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

  const itemLines = populatedLines.map((line, idx) => {
    const sNo = idx + 1;
    const itemName = String(line.item_name || line.item_code || 'Item').trim();
    const rawDiscount = Number(line.discount_percent);
    const discountVal = Number.isFinite(rawDiscount) && rawDiscount >= 0 ? rawDiscount : 0;
    return `${sNo} = ${itemName} (${formatSmsNumber(discountVal)}%)`;
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
