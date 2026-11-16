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
  // Optional extras used by the thermal-style invoice PDF
  documentTime?: string;
  customerAddress?: string;
  grossTotal?: number;
  totalDiscount?: number;
  totalTax?: number;
  addExpense?: number;
  previousBalance?: number;
  netPayable?: number;
  items?: Array<{
    item_name?: string;
    company_name?: string;
    packing?: string;
    quantity?: number;
    loose_quantity?: number;
    bonus_quantity?: number;
    unit_price?: number;
    loose_rate?: number;
    discount_amount?: number;
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
function generateTextDocumentPdf(payload: WhatsAppDocumentPayload): {
  blob: Blob;
  file: File;
  filename: string;
} {
  const storeName = (payload.storeName || 'ABRAR MEDICAL STORE').toUpperCase();
  const safeDocNo = String(payload.documentNumber || 'DOC').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeDocNo}.pdf`;

  const RULE = '------------------------------------------------------------------------';
  const TABLE_HEAD = ' #  Item Description                  Qty        Rate        Total (PKR)';

  type PdfLine = { text: string; size: number; isItemRow?: boolean };
  const lines: PdfLine[] = [];
  const push = (text: string, size = 9.5, isItemRow = false) =>
    lines.push({ text, size, isItemRow });

  push(storeName, 14);
  push(RULE);
  push(`Document Type : ${payload.documentType.toUpperCase()}`);
  push(`Document No   : ${payload.documentNumber}`);
  push(`Date          : ${formatWhatsAppDate(payload.documentDate)}`);
  push(`Customer      : ${payload.customerName || 'Walk-in Cash Customer'}`);
  push(`Phone         : ${payload.customerPhone || 'N/A'}`);
  push(RULE);

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    push(TABLE_HEAD);
    push(RULE);
    // All items are included; the PDF continues onto extra pages when needed.
    payload.items.forEach((it, idx) => {
      const num = String(idx + 1).padStart(2, ' ');
      const name = String(it.item_name || 'Medicine').slice(0, 30).padEnd(32, ' ');
      const qtyStr = `${Number(it.quantity || 0)}P${
        Number(it.loose_quantity || 0) > 0 ? `+${Number(it.loose_quantity)}L` : ''
      }`.padEnd(9, ' ');
      const rateStr = formatPKR(Number(it.unit_price || 0), false).padStart(10, ' ');
      const totalStr = formatPKR(Number(it.line_total || 0), false).padStart(12, ' ');
      push(`${num}  ${name} ${qtyStr} ${rateStr} ${totalStr}`, 9.5, true);
    });
    push(RULE);
  }

  push(`Total Amount      : ${formatPKR(payload.totalAmount)}`);
  push(`Paid Amount       : ${formatPKR(payload.paidAmount)}`);
  push(
    `Remaining Balance : ${formatPKR(payload.remainingBalance)}${
      payload.balanceType ? ` (${payload.balanceType})` : ''
    }`
  );
  push(RULE);
  push(`Thank you for choosing ${storeName}!`);

  // Lay lines out on as many US Legal Portrait (8.5in x 14in = 612 x 1008 pt) pages as needed.
  type PlacedLine = { text: string; size: number; y: number };
  const PAGE_TOP = 956;
  const PAGE_MIN_Y = 40;
  const pages: PlacedLine[][] = [[]];
  let y = PAGE_TOP;
  lines.forEach((ln) => {
    if (y < PAGE_MIN_Y) {
      pages.push([]);
      y = PAGE_TOP;
      const cur = pages[pages.length - 1];
      cur.push({
        text: `${storeName} - ${payload.documentNumber} (page ${pages.length})`,
        size: 9.5,
        y,
      });
      y -= 14;
      if (ln.isItemRow) {
        cur.push({ text: TABLE_HEAD, size: 9.5, y });
        y -= 14;
        cur.push({ text: RULE, size: 9.5, y });
        y -= 14;
      }
    }
    pages[pages.length - 1].push({ text: ln.text, size: ln.size, y });
    y -= ln.size >= 14 ? 20 : 14;
  });

  // PDF objects: 1 Catalog, 2 Pages, 3 Font, then (Page, Content) pairs.
  const objects: string[] = [];
  const pageObjNums = pages.map((_, i) => 4 + i * 2);
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');
  pages.forEach((pageLines, i) => {
    const pageNo = 4 + i * 2;
    const contentNo = pageNo + 1;
    const ops: string[] = ['BT'];
    pageLines.forEach((l) => {
      ops.push(`/F1 ${l.size} Tf`);
      ops.push(`1 0 0 1 40 ${l.y} Tm (${escapePdfText(l.text)}) Tj`);
    });
    ops.push('ET');
    const streamContent = ops.join('\n');
    objects.push(
      `${pageNo} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1008] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentNo} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`
    );
  });

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

// ---------------------------------------------------------------------------
// Thermal (80mm) style invoice PDF - same look as the Sales thermal invoice
// ---------------------------------------------------------------------------

// Helvetica / Helvetica-Bold glyph widths (1/1000 em) for ASCII 32..126
const HELV_REGULAR_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD_W = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
  722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const PDF_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// 2026-11-14 -> 14-nov-2026
function formatDateDMY(raw?: string | null): string {
  const str = String(raw || '').trim();
  const now = new Date();
  if (!str) {
    return `${String(now.getDate()).padStart(2, '0')}-${PDF_MONTHS[now.getMonth()]}-${now.getFullYear()}`;
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${PDF_MONTHS[Number(m[2]) - 1] || m[2]}-${m[1]}`;
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, '0')}-${PDF_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  }
  return str;
}

// "Abrar" + "123"  ->  "Abrar Invoice No 123.pdf"
function buildInvoicePdfFilename(customerName: string, documentNumber: string): string {
  const base = `${customerName || 'Walk-in Cash Customer'} Invoice No ${documentNumber || ''}`
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .trim();
  return `${base || 'Invoice'}.pdf`;
}

type PdfCmd =
  | { t: 'text'; x: number; y: number; s: string; size: number; bold: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number; lw: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; lw: number };

function generateThermalInvoicePdf(payload: WhatsAppDocumentPayload): {
  blob: Blob;
  file: File;
  filename: string;
} {
  const storeName = (payload.storeName || 'Abrar Medical Store').trim();
  const filename = buildInvoicePdfFilename(payload.customerName, payload.documentNumber);

  const PAGE_W = 226.77; // 80mm
  const ML = 8;
  const CW = PAGE_W - ML * 2;
  const cmds: PdfCmd[] = [];

  const clean = (v: unknown) => String(v ?? '').replace(/[^\x20-\x7E]/g, ' ');
  const textW = (str: string, size: number, bold: boolean) => {
    const table = bold ? HELV_BOLD_W : HELV_REGULAR_W;
    let w = 0;
    for (let i = 0; i < str.length; i++) w += table[str.charCodeAt(i) - 32] ?? 556;
    return (w * size) / 1000;
  };
  const wrap = (v: unknown, maxW: number, size: number, bold: boolean): string[] => {
    const words = clean(v).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const word of words) {
      let w = word;
      while (textW(w, size, bold) > maxW && w.length > 1) {
        let k = w.length;
        while (k > 1 && textW(w.slice(0, k), size, bold) > maxW) k--;
        if (cur) {
          out.push(cur);
          cur = '';
        }
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      const trial = cur ? `${cur} ${w}` : w;
      if (textW(trial, size, bold) <= maxW) cur = trial;
      else {
        if (cur) out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const fitSize = (str: string, maxW: number, size: number, bold: boolean) => {
    let sz = size;
    while (sz > 5 && textW(str, sz, bold) > maxW) sz -= 0.25;
    return sz;
  };
  const putText = (
    v: unknown,
    x: number,
    top: number,
    size: number,
    bold: boolean,
    align: 'l' | 'c' | 'r' = 'l',
    boxW = 0
  ) => {
    const str = clean(v);
    const w = textW(str, size, bold);
    const px = align === 'c' ? x + (boxW - w) / 2 : align === 'r' ? x + boxW - w : x;
    cmds.push({ t: 'text', x: px, y: top + size * 0.82, s: str, size, bold });
  };
  const hLine = (x1: number, x2: number, y: number, lw = 0.7) =>
    cmds.push({ t: 'line', x1, y1: y, x2, y2: y, lw });
  const vLine = (x: number, y1: number, y2: number, lw = 0.7) =>
    cmds.push({ t: 'line', x1: x, y1, x2: x, y2, lw });
  const box = (x: number, y: number, w: number, h: number, lw = 0.9) =>
    cmds.push({ t: 'rect', x, y, w, h, lw });
  const money = (n: unknown) => formatPKR(Number(n || 0), false);

  let y = 10;

  // 1. Header: store name
  wrap(storeName, CW, 14, true).forEach((ln) => {
    putText(ln, ML, y, 14, true, 'c', CW);
    y += 17;
  });
  y += 3;

  // 2. Meta table: Bill No, Date, Account, Mobile No, Address
  const labW = CW * 0.27;
  const valW = CW - labW - 6;
  const timeStr = String(payload.documentTime || '').trim();
  const metaRows: Array<{ label: string; lines: string[]; size: number; bold: boolean }> = [
    {
      label: 'Bill No',
      lines: wrap(payload.documentNumber, valW, 9.5, true),
      size: 9.5,
      bold: true,
    },
    {
      label: 'Date',
      lines: wrap(`${formatDateDMY(payload.documentDate)}${timeStr ? ' ' + timeStr : ''}`, valW, 8.5, false),
      size: 8.5,
      bold: false,
    },
    {
      label: 'Account',
      lines: wrap(payload.customerName || 'Walk-in Cash Customer', valW, 10.5, true),
      size: 10.5,
      bold: true,
    },
  ];
  if (String(payload.customerPhone || '').trim()) {
    metaRows.push({
      label: 'Mobile No',
      lines: wrap(payload.customerPhone, valW, 8.5, true),
      size: 8.5,
      bold: true,
    });
  }
  if (String(payload.customerAddress || '').trim()) {
    metaRows.push({
      label: 'Address',
      lines: wrap(payload.customerAddress, valW, 8, false),
      size: 8,
      bold: false,
    });
  }
  const metaTop = y;
  metaRows.forEach((r) => {
    const rowH = r.lines.length * r.size * 1.25 + 5;
    r.lines.forEach((ln, i) => putText(ln, ML + labW + 3, y + 2.5 + i * r.size * 1.25, r.size, r.bold));
    putText(r.label, ML + 3, y + 2.5, 8.5, false);
    y += rowH;
    hLine(ML, ML + CW, y);
  });
  box(ML, metaTop, CW, y - metaTop);
  vLine(ML + labW, metaTop, y);

  // 3. Items table: # | Item Details | Qty | Bonus | Rate | Disc | Amount
  const wNo = 12;
  const wQty = 22;
  const wBonus = 22;
  const wRate = 26;
  const wDisc = 22;
  const wAmt = 36;
  const wItem = CW - (wNo + wQty + wBonus + wRate + wDisc + wAmt);
  const xNo = ML;
  const xItem = xNo + wNo;
  const xQty = xItem + wItem;
  const xBonus = xQty + wQty;
  const xRate = xBonus + wBonus;
  const xDisc = xRate + wRate;
  const xAmt = xDisc + wDisc;
  const colXs = [xItem, xQty, xBonus, xRate, xDisc, xAmt];

  const tblTop = y;
  const headH = 15;
  putText('Item Details', xNo, y + 4, 7.5, true, 'c', wNo + wItem);
  putText('Qty', xQty, y + 4, 7.5, true, 'c', wQty);
  putText('Bonus', xBonus, y + 4, 7.5, true, 'c', wBonus);
  putText('Rate', xRate, y + 4, 7.5, true, 'c', wRate);
  putText('Disc', xDisc, y + 4, 7.5, true, 'c', wDisc);
  putText('Amount', xAmt, y + 4, 7.5, true, 'c', wAmt);
  y += headH;
  hLine(ML, ML + CW, y);

  const items = Array.isArray(payload.items) ? payload.items : [];
  let totalQtyCount = 0;
  items.forEach((it, idx) => {
    const packQty = Number(it.quantity ?? 0);
    const looseQty = Number(it.loose_quantity ?? 0);
    const bonusQty = Number(it.bonus_quantity ?? 0);
    const discAmt = Number(it.discount_amount ?? 0);
    totalQtyCount += packQty + looseQty + bonusQty;

    const qtyText =
      packQty > 0 && looseQty > 0
        ? `${packQty}+${looseQty}L`
        : packQty > 0
        ? String(packQty)
        : looseQty > 0
        ? String(looseQty)
        : '0';
    const rateVal =
      packQty === 0 && looseQty > 0 && Number(it.loose_rate || 0) > 0
        ? Number(it.loose_rate)
        : Number(it.unit_price || 0);
    const rateText = rateVal % 1 === 0 ? rateVal.toFixed(0) : rateVal.toFixed(1);

    const nameLines = wrap(it.item_name || 'Medicine', wItem - 5, 8, true);
    const subText = [it.company_name, it.packing]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(' ');
    const subLines = subText ? wrap(subText, wItem - 5, 6.2, false) : [];
    const rowH = Math.max(15, nameLines.length * 9.6 + subLines.length * 7.4 + 5);

    nameLines.forEach((ln, i) => putText(ln, xItem + 2.5, y + 2.5 + i * 9.6, 8, true));
    subLines.forEach((ln, i) =>
      putText(ln, xItem + 2.5, y + 2.5 + nameLines.length * 9.6 + i * 7.4, 6.2, false)
    );

    const cell = (text: string, x: number, w: number, size: number, align: 'c' | 'r') => {
      const sz = fitSize(text, w - 3, size, true);
      putText(text, x, y + (rowH - sz * 1.2) / 2, sz, true, align, w);
    };
    cell(String(idx + 1), xNo, wNo, 7.5, 'c');
    cell(qtyText, xQty, wQty, 8, 'c');
    cell(bonusQty > 0 ? String(bonusQty) : '-', xBonus, wBonus, 7.5, 'c');
    cell(rateText, xRate, wRate, 7.5, 'c');
    cell(discAmt > 0 ? discAmt.toFixed(0) : '-', xDisc, wDisc, 7.5, 'c');
    cell(Number(it.line_total || 0).toFixed(1), xAmt, wAmt - 2, 8, 'r');

    y += rowH;
    hLine(ML, ML + CW, y, 0.5);
  });
  box(ML, tblTop, CW, y - tblTop);
  colXs.forEach((x) => vLine(x, tblTop, y));

  // 4. Summary box (label ... value rows)
  type SumRow = { label: string; value: string; kind: 'n' | 'm' | 'b' };
  const sum: SumRow[] = [];
  if (payload.grossTotal !== undefined) sum.push({ label: 'Gross Total', value: money(payload.grossTotal), kind: 'n' });
  if (Number(payload.totalDiscount || 0) > 0)
    sum.push({ label: 'Discount', value: `- ${money(payload.totalDiscount)}`, kind: 'n' });
  if (Number(payload.totalTax || 0) > 0)
    sum.push({ label: 'Tax (GST/Adv)', value: money(payload.totalTax), kind: 'n' });
  if (Number(payload.addExpense || 0) > 0)
    sum.push({ label: 'Add Expense', value: money(payload.addExpense), kind: 'n' });
  sum.push({ label: 'TOTAL BILL', value: money(payload.totalAmount), kind: 'b' });
  if (payload.previousBalance !== undefined) {
    sum.push({ label: 'Previous Balance', value: money(payload.previousBalance), kind: 'n' });
    sum.push({
      label: 'Net Payable',
      value: money(payload.netPayable ?? Number(payload.totalAmount || 0) + Number(payload.previousBalance || 0)),
      kind: 'm',
    });
  }
  sum.push({ label: 'Cash Received', value: money(payload.paidAmount), kind: 'n' });
  sum.push({ label: 'BALANCE', value: money(payload.remainingBalance), kind: 'b' });

  const sumTop = y;
  const qtyRounded = Math.round(totalQtyCount * 100) / 100;
  putText(`Items: ${items.length}`, ML + 4, y + 3.5, 8.5, true);
  putText(`Total Qty: ${qtyRounded}`, ML, y + 3.5, 8.5, true, 'r', CW - 4);
  y += 16;
  hLine(ML, ML + CW, y);
  sum.forEach((r) => {
    const size = r.kind === 'b' ? 11 : r.kind === 'm' ? 9.5 : 8.5;
    const rowH = r.kind === 'b' ? 18 : 13;
    if (r.kind === 'b') hLine(ML, ML + CW, y, 1.6);
    const bold = r.kind !== 'n';
    const top = y + (rowH - size * 1.2) / 2;
    putText(r.label, ML + 4, top, size, bold || r.kind === 'n' ? bold : false);
    putText(r.value, ML, top, size, true, 'r', CW - 4);
    y += rowH;
  });
  box(ML, sumTop, CW, y - sumTop);

  // 5. Footer
  y += 8;
  wrap(`Thank you for choosing ${storeName}!`, CW, 8.5, true).forEach((ln) => {
    putText(ln, ML, y, 8.5, true, 'c', CW);
    y += 11;
  });
  const PAGE_H = Math.max(200, y + 12);

  // Build the PDF (single tall page, like a receipt roll)
  const f2 = (n: number) => n.toFixed(2);
  const ops: string[] = ['0 G', '0 g'];
  cmds.forEach((c) => {
    if (c.t === 'text') {
      ops.push(
        `BT /F${c.bold ? 2 : 1} ${f2(c.size)} Tf 1 0 0 1 ${f2(c.x)} ${f2(PAGE_H - c.y)} Tm (${escapePdfText(c.s)}) Tj ET`
      );
    } else if (c.t === 'rect') {
      ops.push(`${c.lw} w ${f2(c.x)} ${f2(PAGE_H - c.y - c.h)} ${f2(c.w)} ${f2(c.h)} re S`);
    } else {
      ops.push(`${c.lw} w ${f2(c.x1)} ${f2(PAGE_H - c.y1)} m ${f2(c.x2)} ${f2(PAGE_H - c.y2)} l S`);
    }
  });
  const streamContent = ops.join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(PAGE_W)} ${f2(PAGE_H)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );
  objects.push(`4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`);
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
  );
  objects.push(
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n'
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
 * Invoices use the thermal (80mm) design; ledgers / statements / reports keep the text layout.
 */
export function generateWhatsAppPdfFile(payload: WhatsAppDocumentPayload): {
  blob: Blob;
  file: File;
  filename: string;
} {
  if (payload.documentType === 'invoice') return generateThermalInvoicePdf(payload);
  return generateTextDocumentPdf(payload);
}

/**
 * Phase 1 (Free, No API):
 * - Generates the invoice/report as a PDF.
 * - On mobile devices supporting Web Share API with files, shares the PDF file + message directly.
 * - On desktop, downloads the PDF file and opens https://wa.me/<number>?text=<encoded message> so the user can attach it.
 */
export class WhatsAppNeedsUserClickError extends Error {
  constructor() {
    super('Auto-send needs a click: press the WhatsApp button.');
    this.name = 'WhatsAppNeedsUserClick';
  }
}

export async function shareOrOpenWhatsAppPhase1(
  normalizedNumber: string,
  payload: WhatsAppDocumentPayload,
  options?: { auto?: boolean }
): Promise<{ method: 'web_share' | 'wa_link_and_pdf' }> {
  // Browsers block opening WhatsApp / share sheets without a recent user click.
  // For auto-send (after save) we stop here instead of pretending it was sent.
  if (options?.auto) {
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) throw new WhatsAppNeedsUserClickError();
  }
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
