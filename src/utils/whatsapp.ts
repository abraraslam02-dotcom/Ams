import { formatPKR, formatPKTDate } from './formatters';

/**
 * Normalizes a Pakistani phone/mobile number for WhatsApp (wa.me & WhatsApp Business Cloud API).
 * Rules:
 * - Removes spaces, dashes, brackets, dots, and "+"
 * - 0300xxxxxxx (11 digits) -> 92300xxxxxxx
 * - 300xxxxxxx (10 digits) -> 92300xxxxxxx
 * - 0092300xxxxxxx -> 92300xxxxxxx
 * - Numbers already starting with 92 stay as they are
 * Returns null if the number is missing or invalid.
 */
export function normalizeWhatsAppNumber(phone?: string | null): string | null {
  if (!phone) return null;
  let cleaned = String(phone)
    .trim()
    .replace(/[\s\-().+]/g, '');

  if (!cleaned) return null;

  if (cleaned.startsWith('0092')) {
    cleaned = '92' + cleaned.slice(4);
  } else if (cleaned.startsWith('03') && cleaned.length === 11) {
    cleaned = '92' + cleaned.slice(1);
  } else if (cleaned.startsWith('3') && cleaned.length === 10) {
    cleaned = '92' + cleaned;
  } else if (cleaned.startsWith('0') && cleaned.length >= 10) {
    cleaned = '92' + cleaned.slice(1);
  }

  // Validate digits only: Pakistan mobile (923xxxxxxxxx = 12 digits) or valid 11-15 digit number
  if (!/^\d{11,15}$/.test(cleaned)) {
    return null;
  }
  if (cleaned.startsWith('92') && cleaned.length !== 12) {
    return null;
  }

  return cleaned;
}

/**
 * Formats a date string/object as DD/MM/YYYY while also respecting PKT date formatting.
 */
export function formatWhatsAppDate(dateInput?: string | Date | null): string {
  if (!dateInput) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy} (${formatPKTDate(now)})`;
  }
  const raw = String(dateInput).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${dd}/${mm}/${yyyy} (${formatPKTDate(raw)})`;
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy} (${formatPKTDate(d)})`;
  }
  return formatPKTDate(dateInput);
}

export interface WhatsAppDocumentPayload {
  storeName?: string;
  documentType: 'invoice' | 'ledger' | 'statement' | 'report';
  invoiceId?: number | null;
  documentNumber: string;
  documentDate?: string;
  customerAccountId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  balanceType?: string;
  items?: Array<{
    item_name?: string;
    packing?: string;
    quantity?: number;
    loose_quantity?: number;
    unit_price?: number;
    line_total?: number;
  }>;
  extraNotes?: string;
}

/**
 * Builds the formatted WhatsApp text message for an Invoice, Ledger, Statement, or Customer Report.
 * Uses formatPKR for amounts and formatPKTDate (with DD/MM/YYYY) for dates.
 */
export function buildWhatsAppMessage(payload: WhatsAppDocumentPayload): string {
  const storeName = (payload.storeName || 'ABRAR MEDICAL STORE').trim();
  const dateFormatted = formatWhatsAppDate(payload.documentDate);
  const totalStr = formatPKR(payload.totalAmount);
  const paidStr = formatPKR(payload.paidAmount);
  const balStr = formatPKR(payload.remainingBalance);

  if (payload.documentType === 'ledger' || payload.documentType === 'statement') {
    return [
      `*${storeName}*`,
      `Account ${payload.documentType === 'statement' ? 'Statement' : 'Ledger'}: *${payload.customerName}*`,
      `Ref: ${payload.documentNumber}`,
      `Date: ${dateFormatted}`,
      `Total Debit: ${totalStr}`,
      `Total Credit / Paid: ${paidStr}`,
      `Closing Balance: *${balStr}${payload.balanceType ? ` (${payload.balanceType})` : ''}*`,
      ``,
      `Thank you for your business with ${storeName}!`,
    ].join('\n');
  }

  if (payload.documentType === 'report') {
    return [
      `*${storeName}*`,
      `Customer Sales Summary: *${payload.customerName}*`,
      `Ref: ${payload.documentNumber}`,
      `Date: ${dateFormatted}`,
      `Net Sales Total: *${totalStr}*`,
      `Paid Amount: ${paidStr}`,
      `Current Balance: *${balStr}${payload.balanceType ? ` (${payload.balanceType})` : ''}*`,
      ``,
      `Thank you for choosing ${storeName}!`,
    ].join('\n');
  }

  return [
    `*${storeName}*`,
    `Invoice No: *${payload.documentNumber}*`,
    `Customer: ${payload.customerName || 'Walk-in Customer'}`,
    `Date: ${dateFormatted}`,
    `Total Amount: *${totalStr}*`,
    `Paid Amount: ${paidStr}`,
    `Remaining Balance: *${balStr}*`,
    ``,
    `Thank you for choosing ${storeName}!`,
  ].join('\n');
}

/**
 * Escapes special characters in PDF text strings.
 */
function escapePdfText(text: string): string {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a lightweight, self-contained valid PDF File/Blob for any Invoice, Ledger, Statement, or Report.
 */
export function generateWhatsAppPdfFile(payload: WhatsAppDocumentPayload): {
  blob: Blob;
  file: File;
  filename: string;
} {
  const storeName = (payload.storeName || 'ABRAR MEDICAL STORE').toUpperCase();
  const safeDocNo = String(payload.documentNumber || 'DOC').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeDocNo}.pdf`;

  const lines: string[] = [
    storeName,
    '------------------------------------------------------------------------',
    `Document Type : ${payload.documentType.toUpperCase()}`,
    `Document No   : ${payload.documentNumber}`,
    `Date          : ${formatWhatsAppDate(payload.documentDate)}`,
    `Customer      : ${payload.customerName || 'Walk-in Cash Customer'}`,
    `Phone         : ${payload.customerPhone || 'N/A'}`,
    '------------------------------------------------------------------------',
  ];

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    lines.push(' #  Item Description                  Qty        Rate        Total (PKR)');
    lines.push('------------------------------------------------------------------------');
    payload.items.slice(0, 28).forEach((it, idx) => {
      const num = String(idx + 1).padStart(2, ' ');
      const name = String(it.item_name || 'Medicine').slice(0, 30).padEnd(32, ' ');
      const qtyStr = `${Number(it.quantity || 0)}P${
        Number(it.loose_quantity || 0) > 0 ? `+${Number(it.loose_quantity)}L` : ''
      }`.padEnd(9, ' ');
      const rateStr = formatPKR(Number(it.unit_price || 0), false).padStart(10, ' ');
      const totalStr = formatPKR(Number(it.line_total || 0), false).padStart(12, ' ');
      lines.push(`${num}  ${name} ${qtyStr} ${rateStr} ${totalStr}`);
    });
    lines.push('------------------------------------------------------------------------');
  }

  lines.push(`Total Amount      : ${formatPKR(payload.totalAmount)}`);
  lines.push(`Paid Amount       : ${formatPKR(payload.paidAmount)}`);
  lines.push(
    `Remaining Balance : ${formatPKR(payload.remainingBalance)}${
      payload.balanceType ? ` (${payload.balanceType})` : ''
    }`
  );
  lines.push('------------------------------------------------------------------------');
  lines.push(`Thank you for choosing ${storeName}!`);

  let y = 790;
  const contentOps: string[] = ['BT', '/F1 10 Tf'];
  lines.forEach((line, idx) => {
    const fontSize = idx === 0 ? 14 : 9.5;
    contentOps.push(`/F1 ${fontSize} Tf`);
    contentOps.push(`1 0 0 1 40 ${y} Tm (${escapePdfText(line)}) Tj`);
    y -= idx === 0 ? 20 : 14;
  });
  contentOps.push('ET');
  const streamContent = contentOps.join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );
  objects.push(
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n'
  );
  objects.push(
    `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const file = new File([blob], filename, { type: 'application/pdf' });
  return { blob, file, filename };
}

/**
 * Phase 1 (Free, No API):
 * - Generates the invoice/report as a PDF.
 * - On mobile devices supporting Web Share API with files, shares the PDF file + message directly.
 * - On desktop, downloads the PDF file and opens https://wa.me/<number>?text=<encoded message> so the user can attach it.
 */
export async function shareOrOpenWhatsAppPhase1(
  normalizedNumber: string,
  payload: WhatsAppDocumentPayload
): Promise<{ method: 'web_share' | 'wa_link_and_pdf' }> {
  const message = buildWhatsAppMessage(payload);
  const { blob, file, filename } = generateWhatsAppPdfFile(payload);

  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (
    isMobileDevice &&
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.share({
        title: `${payload.storeName || 'Abrar Medical Store'} - ${payload.documentNumber}`,
        text: message,
        files: [file],
      });
      return { method: 'web_share' };
    } catch {
      // Fallback to wa.me link if user cancels or share fails
    }
  }

  // Trigger PDF download so the user can attach it in WhatsApp Desktop / Web
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    // ignore download error
  }

  const waUrl = `https://wa.me/${normalizedNumber}?text=${encodeURIComponent(message)}`;
  const link = document.createElement('a');
  link.href = waUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { method: 'wa_link_and_pdf' };
}
