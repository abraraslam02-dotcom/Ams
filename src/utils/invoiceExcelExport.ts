import * as XLSX from 'xlsx';
import { formatItemNameWithRemarks } from './itemDisplay';

function toNum(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cleanDate(val: unknown): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str;
}

function applyColumnWidths(ws: XLSX.WorkSheet, headers: string[], rows: Array<Record<string, any>>) {
  ws['!cols'] = headers.map((header) => {
    let maxLen = header.length;
    for (const row of rows) {
      const cellVal = row[header];
      const strLen = cellVal !== null && cellVal !== undefined ? String(cellVal).length : 0;
      if (strLen > maxLen) {
        maxLen = strLen;
      }
    }
    return { wch: Math.min(42, Math.max(12, maxLen + 3)) };
  });
}

/**
 * Exports one or multiple Sales Invoices into a properly formatted Excel (.xlsx) workbook
 * with two separate worksheets:
 *   1. "Invoice Summary"
 *   2. "Invoice Details" (all line items with complete invoice & item fields)
 */
export function exportSalesInvoicesToExcel(
  invoices: Array<Record<string, any>>,
  customFileName?: string
): void {
  if (!invoices || invoices.length === 0) return;

  // 1. Build "Invoice Summary" rows
  const summaryHeaders = [
    'Invoice Number',
    'Invoice Date',
    'Account / Party Name',
    'Invoice Type',
    'Payment Mode',
    'Total Items',
    'Quantity',
    'Loose Quantity',
    'Bonus',
    'Gross Amount',
    'Discount',
    'Tax',
    'Advance Tax',
    'Net Total',
    'Paid Amount',
    'Balance',
    'Salesman',
    'Status',
    'Remarks',
  ];

  let sumItemsCount = 0;
  let sumQty = 0;
  let sumLooseQty = 0;
  let sumBonus = 0;
  let sumGross = 0;
  let sumDiscount = 0;
  let sumTax = 0;
  let sumAdvTax = 0;
  let sumNetTotal = 0;
  let sumPaid = 0;
  let sumBalance = 0;

  const summaryRows: Array<Record<string, any>> = invoices.map((inv) => {
    const items: Array<Record<string, any>> = Array.isArray(inv.items) ? inv.items : [];
    const invQty = items.reduce((s, it) => s + toNum(it.quantity), 0);
    const invLoose = items.reduce((s, it) => s + toNum(it.loose_quantity), 0);
    const invBonus = items.reduce((s, it) => s + toNum(it.bonus_quantity), 0);

    const gross = toNum(
      inv.gross_total ??
        inv.gross_amount ??
        items.reduce((s, it) => s + toNum(it.gross_amount || toNum(it.quantity) * toNum(it.unit_price)), 0)
    );
    const itemDiscSum = items.reduce((s, it) => s + toNum(it.discount_amount), 0);
    const headerDisc = toNum(inv.discount_amount ?? inv.invoice_discount_amount ?? 0);
    // Total discount (either stored on invoice or sum of item + bill discounts)
    const discount = toNum(headerDisc > 0 ? headerDisc : itemDiscSum);
    const tax = toNum(
      inv.tax_amount ?? items.reduce((s, it) => s + toNum(it.tax_amount), 0)
    );
    const advTax = toNum(inv.advance_tax_amount ?? 0);
    const netTotal = toNum(inv.net_total ?? gross - discount + tax + advTax);
    const paid = toNum(inv.paid_amount ?? 0);
    const balance = toNum(inv.balance_amount ?? Math.max(0, netTotal - paid));
    const itemCount = items.length || Number(inv.item_count || 0);

    sumItemsCount += itemCount;
    sumQty = toNum(sumQty + invQty);
    sumLooseQty = toNum(sumLooseQty + invLoose);
    sumBonus = toNum(sumBonus + invBonus);
    sumGross = toNum(sumGross + gross);
    sumDiscount = toNum(sumDiscount + discount);
    sumTax = toNum(sumTax + tax);
    sumAdvTax = toNum(sumAdvTax + advTax);
    sumNetTotal = toNum(sumNetTotal + netTotal);
    sumPaid = toNum(sumPaid + paid);
    sumBalance = toNum(sumBalance + balance);

    return {
      'Invoice Number': String(inv.invoice_number || ''),
      'Invoice Date': cleanDate(inv.invoice_date),
      'Account / Party Name': String(inv.customer_name || 'Walk-in Cash Customer'),
      'Invoice Type': String(inv.invoice_type || 'Retail'),
      'Payment Mode': String(inv.payment_mode || 'Cash'),
      'Total Items': itemCount,
      Quantity: invQty,
      'Loose Quantity': invLoose,
      Bonus: invBonus,
      'Gross Amount': gross,
      Discount: discount,
      Tax: tax,
      'Advance Tax': advTax,
      'Net Total': netTotal,
      'Paid Amount': paid,
      Balance: balance,
      Salesman: String(inv.salesman || ''),
      Status: String(inv.status || 'completed'),
      Remarks: String(inv.remarks || ''),
    };
  });

  if (summaryRows.length > 1) {
    summaryRows.push({
      'Invoice Number': 'TOTAL',
      'Invoice Date': '',
      'Account / Party Name': `${invoices.length} Invoices`,
      'Invoice Type': '',
      'Payment Mode': '',
      'Total Items': sumItemsCount,
      Quantity: sumQty,
      'Loose Quantity': sumLooseQty,
      Bonus: sumBonus,
      'Gross Amount': sumGross,
      Discount: sumDiscount,
      Tax: sumTax,
      'Advance Tax': sumAdvTax,
      'Net Total': sumNetTotal,
      'Paid Amount': sumPaid,
      Balance: sumBalance,
      Salesman: '',
      Status: '',
      Remarks: '',
    });
  }

  // 2. Build "Invoice Details" rows (all line items with full required columns)
  const detailHeaders = [
    'Invoice Number',
    'Invoice Date',
    'Account / Party Name',
    'Item Code',
    'Item Name',
    'Company',
    'Packing',
    'Batch Number',
    'Expiry Date',
    'Quantity',
    'Loose Quantity',
    'Bonus',
    'Rate',
    'Loose Rate',
    'Gross Amount',
    'Discount %',
    'Discount',
    'Tax %',
    'Tax',
    'Amount',
    'Remarks',
    'Net Total',
    'Paid Amount',
    'Balance',
  ];

  let detQty = 0;
  let detLooseQty = 0;
  let detBonus = 0;
  let detGross = 0;
  let detDisc = 0;
  let detTax = 0;
  let detLineAmount = 0;

  const detailRows: Array<Record<string, any>> = [];

  for (const inv of invoices) {
    const items: Array<Record<string, any>> = Array.isArray(inv.items) ? inv.items : [];
    const invNumber = String(inv.invoice_number || '');
    const invDate = cleanDate(inv.invoice_date);
    const partyName = String(inv.customer_name || 'Walk-in Cash Customer');
    const invNetTotal = toNum(inv.net_total ?? 0);
    const invPaid = toNum(inv.paid_amount ?? 0);
    const invBalance = toNum(inv.balance_amount ?? Math.max(0, invNetTotal - invPaid));

    if (items.length === 0) {
      detailRows.push({
        'Invoice Number': invNumber,
        'Invoice Date': invDate,
        'Account / Party Name': partyName,
        'Item Code': '',
        'Item Name': '(No line items)',
        Company: '',
        Packing: '',
        'Batch Number': '',
        'Expiry Date': '',
        Quantity: 0,
        'Loose Quantity': 0,
        Bonus: 0,
        Rate: 0,
        'Loose Rate': 0,
        'Gross Amount': toNum(inv.gross_total ?? 0),
        'Discount %': 0,
        Discount: toNum(inv.discount_amount ?? 0),
        'Tax %': 0,
        Tax: toNum(inv.tax_amount ?? 0),
        Amount: invNetTotal,
        Remarks: '',
        'Net Total': invNetTotal,
        'Paid Amount': invPaid,
        Balance: invBalance,
      });
      continue;
    }

    for (const item of items) {
      const qty = toNum(item.quantity);
      const looseQty = toNum(item.loose_quantity);
      const bonus = toNum(item.bonus_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const looseRate = toNum(item.loose_rate);
      const grossAmt = toNum(
        item.gross_amount ?? qty * rate + looseQty * looseRate
      );
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(
        item.discount_amount ?? (grossAmt * discPct) / 100
      );
      const taxableAmt = Math.max(0, toNum(grossAmt - discAmt));
      const taxPct = toNum(item.tax_percent);
      const taxAmt = toNum(
        item.tax_amount ?? (taxableAmt * taxPct) / 100
      );
      const lineAmount = toNum(item.line_total ?? taxableAmt + taxAmt);

      detQty = toNum(detQty + qty);
      detLooseQty = toNum(detLooseQty + looseQty);
      detBonus = toNum(detBonus + bonus);
      detGross = toNum(detGross + grossAmt);
      detDisc = toNum(detDisc + discAmt);
      detTax = toNum(detTax + taxAmt);
      detLineAmount = toNum(detLineAmount + lineAmount);

      detailRows.push({
        'Invoice Number': invNumber,
        'Invoice Date': invDate,
        'Account / Party Name': partyName,
        'Item Code': String(item.item_code || ''),
        'Item Name': formatItemNameWithRemarks(item.item_name, item.remarks),
        Company: String(item.company_name || item.company || ''),
        Packing: String(item.packing || ''),
        'Batch Number': String(item.batch_number || ''),
        'Expiry Date': cleanDate(item.expiry_date),
        Quantity: qty,
        'Loose Quantity': looseQty,
        Bonus: bonus,
        Rate: rate,
        'Loose Rate': looseRate,
        'Gross Amount': grossAmt,
        'Discount %': discPct,
        Discount: discAmt,
        'Tax %': taxPct,
        Tax: taxAmt,
        Amount: lineAmount,
        Remarks: String(item.remarks || ''),
        'Net Total': invNetTotal,
        'Paid Amount': invPaid,
        Balance: invBalance,
      });
    }
  }

  if (detailRows.length > 1) {
    detailRows.push({
      'Invoice Number': 'TOTAL',
      'Invoice Date': '',
      'Account / Party Name': `${detailRows.length} Line Items`,
      'Item Code': '',
      'Item Name': '',
      Company: '',
      Packing: '',
      'Batch Number': '',
      'Expiry Date': '',
      Quantity: detQty,
      'Loose Quantity': detLooseQty,
      Bonus: detBonus,
      Rate: '',
      'Loose Rate': '',
      'Gross Amount': detGross,
      'Discount %': '',
      Discount: detDisc,
      'Tax %': '',
      Tax: detTax,
      Amount: detLineAmount,
      Remarks: '',
      'Net Total': sumNetTotal,
      'Paid Amount': sumPaid,
      Balance: sumBalance,
    });
  }

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { header: summaryHeaders });
  applyColumnWidths(wsSummary, summaryHeaders, summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Invoice Summary');

  const wsDetails = XLSX.utils.json_to_sheet(detailRows, { header: detailHeaders });
  applyColumnWidths(wsDetails, detailHeaders, detailRows);
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Invoice Details');

  const defaultName =
    invoices.length === 1
      ? `Sales_Invoice_${String(invoices[0].invoice_number || 'Export').replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
      : `Sales_Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`;

  XLSX.writeFile(wb, customFileName || defaultName);
}

/**
 * Exports one or multiple Purchase Invoices into a properly formatted Excel (.xlsx) workbook
 * with two separate worksheets:
 *   1. "Invoice Summary"
 *   2. "Invoice Details" (all line items with complete invoice & item fields)
 */
export function exportPurchaseInvoicesToExcel(
  purchases: Array<Record<string, any>>,
  customFileName?: string
): void {
  if (!purchases || purchases.length === 0) return;

  // 1. Build "Invoice Summary" rows
  const summaryHeaders = [
    'Invoice Number',
    'Invoice Date',
    'Account / Party Name',
    'Supplier Invoice #',
    'Filer Status',
    'Payment Mode',
    'Total Items',
    'Quantity',
    'Loose Quantity',
    'Bonus',
    'Gross Amount',
    'Discount',
    'Tax',
    'Advance Tax',
    'Net Total',
    'Paid Amount',
    'Balance',
    'Status',
    'Remarks',
  ];

  let sumItemsCount = 0;
  let sumQty = 0;
  let sumLooseQty = 0;
  let sumBonus = 0;
  let sumGross = 0;
  let sumDiscount = 0;
  let sumTax = 0;
  let sumAdvTax = 0;
  let sumNetTotal = 0;
  let sumPaid = 0;
  let sumBalance = 0;

  const summaryRows: Array<Record<string, any>> = purchases.map((pur) => {
    const items: Array<Record<string, any>> = Array.isArray(pur.items) ? pur.items : [];
    const invQty = items.reduce((s, it) => s + toNum(it.quantity), 0);
    const invLoose = items.reduce((s, it) => s + toNum(it.loose_quantity), 0);
    const invBonus = items.reduce((s, it) => s + toNum(it.bonus_quantity), 0);

    const gross = toNum(
      pur.gross_total ??
        pur.gross_amount ??
        items.reduce((s, it) => s + toNum(it.gross_amount || toNum(it.quantity) * toNum(it.purchase_rate ?? it.purchase_price)), 0)
    );
    const itemDiscSum = items.reduce((s, it) => s + toNum(it.discount_amount), 0);
    const headerDisc = toNum(pur.discount_amount ?? pur.invoice_discount_amount ?? 0);
    const discount = toNum(headerDisc > 0 ? headerDisc : itemDiscSum);
    const gst = toNum(
      pur.gst_amount ?? pur.tax_amount ?? items.reduce((s, it) => s + toNum(it.tax_amount), 0)
    );
    const advTax = toNum(pur.advance_tax_amount ?? 0);
    const totalTax = toNum(gst + advTax);
    const netTotal = toNum(pur.net_total ?? gross - discount + totalTax);
    const paid = toNum(pur.paid_amount ?? 0);
    const balance = toNum(
      pur.balance_amount ?? pur.remaining_balance ?? Math.max(0, netTotal - paid)
    );
    const itemCount = items.length || Number(pur.item_count || 0);

    sumItemsCount += itemCount;
    sumQty = toNum(sumQty + invQty);
    sumLooseQty = toNum(sumLooseQty + invLoose);
    sumBonus = toNum(sumBonus + invBonus);
    sumGross = toNum(sumGross + gross);
    sumDiscount = toNum(sumDiscount + discount);
    sumTax = toNum(sumTax + gst);
    sumAdvTax = toNum(sumAdvTax + advTax);
    sumNetTotal = toNum(sumNetTotal + netTotal);
    sumPaid = toNum(sumPaid + paid);
    sumBalance = toNum(sumBalance + balance);

    return {
      'Invoice Number': String(pur.bill_number || pur.invoice_number || ''),
      'Invoice Date': cleanDate(pur.bill_date || pur.invoice_date),
      'Account / Party Name': String(pur.supplier_name || ''),
      'Supplier Invoice #': String(pur.supplier_invoice_number || pur.supplier_invoice_no || ''),
      'Filer Status': String(pur.supplier_filer_status || 'Filer'),
      'Payment Mode': String(pur.payment_mode || 'Cash'),
      'Total Items': itemCount,
      Quantity: invQty,
      'Loose Quantity': invLoose,
      Bonus: invBonus,
      'Gross Amount': gross,
      Discount: discount,
      Tax: gst,
      'Advance Tax': advTax,
      'Net Total': netTotal,
      'Paid Amount': paid,
      Balance: balance,
      Status: String(pur.status || 'completed'),
      Remarks: String(pur.remarks || pur.notes || ''),
    };
  });

  if (summaryRows.length > 1) {
    summaryRows.push({
      'Invoice Number': 'TOTAL',
      'Invoice Date': '',
      'Account / Party Name': `${purchases.length} Invoices`,
      'Supplier Invoice #': '',
      'Filer Status': '',
      'Payment Mode': '',
      'Total Items': sumItemsCount,
      Quantity: sumQty,
      'Loose Quantity': sumLooseQty,
      Bonus: sumBonus,
      'Gross Amount': sumGross,
      Discount: sumDiscount,
      Tax: sumTax,
      'Advance Tax': sumAdvTax,
      'Net Total': sumNetTotal,
      'Paid Amount': sumPaid,
      Balance: sumBalance,
      Status: '',
      Remarks: '',
    });
  }

  // 2. Build "Invoice Details" rows (all line items with full required columns)
  const detailHeaders = [
    'Invoice Number',
    'Invoice Date',
    'Account / Party Name',
    'Item Code',
    'Item Name',
    'Qty',
    'Discount',
    'Bonus',
    'Gross Amount',
    'Net Amount',
    'Packing',
    'Batch/Expiry',
    'Purchase Rate',
    'MRP',
    'GST',
    'Taxable',
    'Line Total',
    'Remarks',
    'Paid Amount',
    'Balance',
  ];

  let detQty = 0;
  let detBonus = 0;
  let detGross = 0;
  let detDisc = 0;
  let detTaxable = 0;
  let detTax = 0;
  let detLineAmount = 0;

  const detailRows: Array<Record<string, any>> = [];

  for (const pur of purchases) {
    const items: Array<Record<string, any>> = Array.isArray(pur.items) ? pur.items : [];
    const invNumber = String(pur.bill_number || pur.invoice_number || '');
    const invDate = cleanDate(pur.bill_date || pur.invoice_date);
    const partyName = String(pur.supplier_name || '');
    const invNetTotal = toNum(pur.net_total ?? 0);
    const invPaid = toNum(pur.paid_amount ?? 0);
    const invBalance = toNum(
      pur.balance_amount ?? pur.remaining_balance ?? Math.max(0, invNetTotal - invPaid)
    );

    if (items.length === 0) {
      detailRows.push({
        'Invoice Number': invNumber,
        'Invoice Date': invDate,
        'Account / Party Name': partyName,
        'Item Code': '',
        'Item Name': '(No line items)',
        Qty: 0,
        Discount: toNum(pur.discount_amount ?? 0),
        Bonus: 0,
        'Gross Amount': toNum(pur.gross_total ?? 0),
        'Net Amount': toNum(pur.taxable_amount ?? 0),
        Packing: '',
        'Batch/Expiry': '',
        'Purchase Rate': 0,
        MRP: 0,
        GST: toNum(pur.gst_amount ?? 0),
        Taxable: toNum(pur.taxable_amount ?? 0),
        'Line Total': invNetTotal,
        Remarks: '',
        'Paid Amount': invPaid,
        Balance: invBalance,
      });
      continue;
    }

    for (const item of items) {
      const qty = toNum(item.quantity);
      const bonus = toNum(item.bonus_quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const mrp = toNum(item.mrp_rate ?? item.mrp);
      const grossAmt = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (grossAmt * discPct) / 100);
      const taxableAmt = Math.max(0, toNum(item.taxable_amount ?? (grossAmt - discAmt)));
      const taxPct = toNum(item.tax_percent);
      const taxAmt = toNum(item.tax_amount ?? (taxableAmt * taxPct) / 100);
      const lineAmount = toNum(item.line_total ?? taxableAmt + taxAmt);
      const batchExp = [String(item.batch_number || '').trim(), cleanDate(item.expiry_date)]
        .filter(Boolean)
        .join(' / ');

      detQty = toNum(detQty + qty);
      detBonus = toNum(detBonus + bonus);
      detGross = toNum(detGross + grossAmt);
      detDisc = toNum(detDisc + discAmt);
      detTaxable = toNum(detTaxable + taxableAmt);
      detTax = toNum(detTax + taxAmt);
      detLineAmount = toNum(detLineAmount + lineAmount);

      detailRows.push({
        'Invoice Number': invNumber,
        'Invoice Date': invDate,
        'Account / Party Name': partyName,
        'Item Code': String(item.item_code || ''),
        'Item Name': formatItemNameWithRemarks(item.item_name, item.remarks),
        Qty: qty,
        Discount: discAmt,
        Bonus: bonus,
        'Gross Amount': grossAmt,
        'Net Amount': taxableAmt,
        Packing: String(item.packing || ''),
        'Batch/Expiry': batchExp,
        'Purchase Rate': rate,
        MRP: mrp,
        GST: taxAmt,
        Taxable: taxableAmt,
        'Line Total': lineAmount,
        Remarks: String(item.remarks || ''),
        'Paid Amount': invPaid,
        Balance: invBalance,
      });
    }
  }

  if (detailRows.length > 1) {
    detailRows.push({
      'Invoice Number': 'TOTAL',
      'Invoice Date': '',
      'Account / Party Name': `${detailRows.length} Line Items`,
      'Item Code': '',
      'Item Name': '',
      Qty: detQty,
      Discount: detDisc,
      Bonus: detBonus,
      'Gross Amount': detGross,
      'Net Amount': detTaxable,
      Packing: '',
      'Batch/Expiry': '',
      'Purchase Rate': '',
      MRP: '',
      GST: detTax,
      Taxable: detTaxable,
      'Line Total': detLineAmount,
      Remarks: '',
      'Paid Amount': sumPaid,
      Balance: sumBalance,
    });
  }

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { header: summaryHeaders });
  applyColumnWidths(wsSummary, summaryHeaders, summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Invoice Summary');

  const wsDetails = XLSX.utils.json_to_sheet(detailRows, { header: detailHeaders });
  applyColumnWidths(wsDetails, detailHeaders, detailRows);
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Invoice Details');

  const defaultName =
    purchases.length === 1
      ? `Purchase_Invoice_${String(
          purchases[0].bill_number || purchases[0].invoice_number || 'Export'
        ).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
      : `Purchase_Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`;

  XLSX.writeFile(wb, customFileName || defaultName);
}

// ============================================================================
// CUSTOM EXCEL EXPORT ENGINE (FIELD SELECTION, DRAG-AND-DROP ORDER & TEMPLATES)
// ============================================================================

export type CustomExportCategory =
  | 'Invoice Information'
  | 'Item Information'
  | 'Financial Information';

export interface CustomExportFieldDef {
  key: string;
  label: string;
  category: CustomExportCategory;
  format: 'text' | 'date' | 'number' | 'currency';
  getValue: (invoice: Record<string, any>, item: Record<string, any>) => string | number;
}

/**
 * Verified Sales Export Fields from `sales` and `sale_items` database tables
 */
export const SALES_CUSTOM_EXPORT_FIELDS: CustomExportFieldDef[] = [
  // 1. Invoice Information
  {
    key: 'invoice_number',
    label: 'Invoice Number',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.invoice_number || ''),
  },
  {
    key: 'invoice_date',
    label: 'Invoice Date',
    category: 'Invoice Information',
    format: 'date',
    getValue: (inv) => cleanDate(inv.invoice_date),
  },
  {
    key: 'customer_name',
    label: 'Customer Name',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.customer_name || 'Walk-in Cash Customer'),
  },
  {
    key: 'customer_code',
    label: 'Customer Code',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.customer_code || ''),
  },
  {
    key: 'buyer_name',
    label: 'Buyer Name',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.buyer_name || ''),
  },
  {
    key: 'invoice_type',
    label: 'Invoice Type',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.invoice_type || 'Retail'),
  },
  {
    key: 'payment_mode',
    label: 'Payment Mode',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.payment_mode || 'Cash'),
  },
  {
    key: 'salesman',
    label: 'Salesman',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.salesman || ''),
  },
  {
    key: 'remarks',
    label: 'Remarks / Notes',
    category: 'Invoice Information',
    format: 'text',
    getValue: (inv) => String(inv.remarks || ''),
  },

  // 2. Item Information
  {
    key: 'item_code',
    label: 'Item Code',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => String(item.item_code || ''),
  },
  {
    key: 'item_name',
    label: 'Item Name',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => formatItemNameWithRemarks(item.item_name, item.remarks),
  },
  {
    key: 'company_name',
    label: 'Company',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => String(item.company_name || item.company || ''),
  },
  {
    key: 'packing',
    label: 'Packing',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => String(item.packing || ''),
  },
  {
    key: 'batch_number',
    label: 'Batch Number',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => String(item.batch_number || ''),
  },
  {
    key: 'expiry_date',
    label: 'Expiry',
    category: 'Item Information',
    format: 'date',
    getValue: (_inv, item) => cleanDate(item.expiry_date),
  },
  {
    key: 'quantity',
    label: 'Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_inv, item) => toNum(item.quantity),
  },
  {
    key: 'loose_quantity',
    label: 'Loose Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_inv, item) => toNum(item.loose_quantity),
  },
  {
    key: 'bonus_quantity',
    label: 'Bonus Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_inv, item) => toNum(item.bonus_quantity),
  },
  {
    key: 'total_units',
    label: 'Total Units',
    category: 'Item Information',
    format: 'number',
    getValue: (_inv, item) =>
      toNum(
        item.total_units ??
          toNum(item.quantity) + toNum(item.loose_quantity) + toNum(item.bonus_quantity)
      ),
  },
  {
    key: 'item_remarks',
    label: 'Remarks',
    category: 'Item Information',
    format: 'text',
    getValue: (_inv, item) => String(item.remarks || ''),
  },

  // 3. Financial Information
  {
    key: 'unit_price',
    label: 'Rate',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => toNum(item.unit_price ?? item.rate),
  },
  {
    key: 'loose_rate',
    label: 'Loose Rate',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => toNum(item.loose_rate),
  },
  {
    key: 'gross_amount',
    label: 'Gross Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => {
      const qty = toNum(item.quantity);
      const loose = toNum(item.loose_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const lRate = toNum(item.loose_rate);
      return toNum(item.gross_amount ?? qty * rate + loose * lRate);
    },
  },
  {
    key: 'discount_percent',
    label: 'Discount %',
    category: 'Financial Information',
    format: 'number',
    getValue: (_inv, item) => toNum(item.discount_percent),
  },
  {
    key: 'discount_amount',
    label: 'Discount Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => {
      const qty = toNum(item.quantity);
      const loose = toNum(item.loose_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const lRate = toNum(item.loose_rate);
      const gross = toNum(item.gross_amount ?? qty * rate + loose * lRate);
      const discPct = toNum(item.discount_percent);
      return toNum(item.discount_amount ?? (gross * discPct) / 100);
    },
  },
  {
    key: 'taxable_amount',
    label: 'Taxable Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => {
      const qty = toNum(item.quantity);
      const loose = toNum(item.loose_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const lRate = toNum(item.loose_rate);
      const gross = toNum(item.gross_amount ?? qty * rate + loose * lRate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      return Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
    },
  },
  {
    key: 'tax_percent',
    label: 'Tax %',
    category: 'Financial Information',
    format: 'number',
    getValue: (_inv, item) => toNum(item.tax_percent),
  },
  {
    key: 'tax_amount',
    label: 'Tax Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => {
      const qty = toNum(item.quantity);
      const loose = toNum(item.loose_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const lRate = toNum(item.loose_rate);
      const gross = toNum(item.gross_amount ?? qty * rate + loose * lRate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      const taxable = Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
      const taxPct = toNum(item.tax_percent);
      return toNum(item.tax_amount ?? (taxable * taxPct) / 100);
    },
  },
  {
    key: 'line_total',
    label: 'Net Line Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_inv, item) => {
      const qty = toNum(item.quantity);
      const loose = toNum(item.loose_quantity);
      const rate = toNum(item.unit_price ?? item.rate);
      const lRate = toNum(item.loose_rate);
      const gross = toNum(item.gross_amount ?? qty * rate + loose * lRate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      const taxable = Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
      const taxPct = toNum(item.tax_percent);
      const taxAmt = toNum(item.tax_amount ?? (taxable * taxPct) / 100);
      return toNum(item.line_total ?? taxable + taxAmt);
    },
  },
  {
    key: 'invoice_gross_total',
    label: 'Invoice Gross Total',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) => toNum(inv.gross_total ?? inv.gross_amount ?? 0),
  },
  {
    key: 'invoice_discount_amount',
    label: 'Invoice Discount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) => toNum(inv.discount_amount ?? inv.invoice_discount_amount ?? 0),
  },
  {
    key: 'invoice_tax_amount',
    label: 'Invoice Tax',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) => toNum(inv.tax_amount ?? 0),
  },
  {
    key: 'net_total',
    label: 'Total / Net Invoice Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) => toNum(inv.net_total ?? 0),
  },
  {
    key: 'paid_amount',
    label: 'Paid Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) => toNum(inv.paid_amount ?? 0),
  },
  {
    key: 'balance_amount',
    label: 'Balance',
    category: 'Financial Information',
    format: 'currency',
    getValue: (inv) =>
      toNum(
        inv.balance_amount ?? Math.max(0, toNum(inv.net_total ?? 0) - toNum(inv.paid_amount ?? 0))
      ),
  },
];

/**
 * Verified Purchase Export Fields from `purchases` and `purchase_items` database tables
 */
export const PURCHASE_CUSTOM_EXPORT_FIELDS: CustomExportFieldDef[] = [
  // 1. Invoice Information
  {
    key: 'bill_number',
    label: 'Invoice Number',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.bill_number || pur.invoice_number || ''),
  },
  {
    key: 'supplier_invoice_number',
    label: 'Supplier Invoice No',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.supplier_invoice_number || pur.supplier_invoice_no || ''),
  },
  {
    key: 'bill_date',
    label: 'Invoice Date',
    category: 'Invoice Information',
    format: 'date',
    getValue: (pur) => cleanDate(pur.bill_date || pur.invoice_date),
  },
  {
    key: 'supplier_name',
    label: 'Supplier Name',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.supplier_name || ''),
  },
  {
    key: 'supplier_code',
    label: 'Supplier Code',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.supplier_code || ''),
  },
  {
    key: 'payment_mode',
    label: 'Payment Mode',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.payment_mode || 'Cash'),
  },
  {
    key: 'remarks',
    label: 'Remarks / Notes',
    category: 'Invoice Information',
    format: 'text',
    getValue: (pur) => String(pur.remarks || pur.notes || ''),
  },

  // 2. Item Information
  {
    key: 'item_code',
    label: 'Item Code',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => String(item.item_code || ''),
  },
  {
    key: 'item_name',
    label: 'Item Name',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => formatItemNameWithRemarks(item.item_name, item.remarks),
  },
  {
    key: 'company_name',
    label: 'Company',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => String(item.company_name || item.company || ''),
  },
  {
    key: 'packing',
    label: 'Packing',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => String(item.packing || ''),
  },
  {
    key: 'batch_number',
    label: 'Batch Number',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => String(item.batch_number || ''),
  },
  {
    key: 'manufacturing_date',
    label: 'Manufacturing Date',
    category: 'Item Information',
    format: 'date',
    getValue: (_pur, item) => cleanDate(item.manufacturing_date),
  },
  {
    key: 'expiry_date',
    label: 'Expiry',
    category: 'Item Information',
    format: 'date',
    getValue: (_pur, item) => cleanDate(item.expiry_date),
  },
  {
    key: 'quantity',
    label: 'Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_pur, item) => toNum(item.quantity),
  },
  {
    key: 'loose_quantity',
    label: 'Loose Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_pur, item) => toNum(item.loose_quantity),
  },
  {
    key: 'bonus_quantity',
    label: 'Bonus Quantity',
    category: 'Item Information',
    format: 'number',
    getValue: (_pur, item) => toNum(item.bonus_quantity),
  },
  {
    key: 'total_units',
    label: 'Total Units',
    category: 'Item Information',
    format: 'number',
    getValue: (_pur, item) =>
      toNum(
        item.total_units ??
          toNum(item.quantity) + toNum(item.loose_quantity) + toNum(item.bonus_quantity)
      ),
  },
  {
    key: 'item_remarks',
    label: 'Remarks',
    category: 'Item Information',
    format: 'text',
    getValue: (_pur, item) => String(item.remarks || ''),
  },

  // 3. Financial Information
  {
    key: 'mrp_rate',
    label: 'Trade / Retail Price (MRP)',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => toNum(item.mrp_rate ?? item.mrp),
  },
  {
    key: 'purchase_rate',
    label: 'Purchase Rate',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => toNum(item.purchase_rate ?? item.purchase_price ?? item.rate),
  },
  {
    key: 'loose_rate',
    label: 'Loose Rate',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => toNum(item.loose_rate),
  },
  {
    key: 'gross_amount',
    label: 'Gross Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => {
      const qty = toNum(item.quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      return toNum(item.gross_amount ?? qty * rate);
    },
  },
  {
    key: 'discount_percent',
    label: 'Discount %',
    category: 'Financial Information',
    format: 'number',
    getValue: (_pur, item) => toNum(item.discount_percent),
  },
  {
    key: 'discount_amount',
    label: 'Discount Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => {
      const qty = toNum(item.quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const gross = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      return toNum(item.discount_amount ?? (gross * discPct) / 100);
    },
  },
  {
    key: 'taxable_amount',
    label: 'Taxable Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => {
      const qty = toNum(item.quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const gross = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      return Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
    },
  },
  {
    key: 'tax_percent',
    label: 'Tax %',
    category: 'Financial Information',
    format: 'number',
    getValue: (_pur, item) => toNum(item.tax_percent),
  },
  {
    key: 'tax_amount',
    label: 'Tax Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => {
      const qty = toNum(item.quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const gross = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      const taxable = Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
      const taxPct = toNum(item.tax_percent);
      return toNum(item.tax_amount ?? (taxable * taxPct) / 100);
    },
  },
  {
    key: 'line_total',
    label: 'Net Line Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (_pur, item) => {
      const qty = toNum(item.quantity);
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const gross = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (gross * discPct) / 100);
      const taxable = Math.max(0, toNum(item.taxable_amount ?? gross - discAmt));
      const taxPct = toNum(item.tax_percent);
      const taxAmt = toNum(item.tax_amount ?? (taxable * taxPct) / 100);
      return toNum(item.line_total ?? taxable + taxAmt);
    },
  },
  {
    key: 'invoice_gross_total',
    label: 'Invoice Gross Total',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) => toNum(pur.gross_total ?? pur.gross_amount ?? 0),
  },
  {
    key: 'invoice_discount_amount',
    label: 'Invoice Discount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) => toNum(pur.discount_amount ?? pur.invoice_discount_amount ?? 0),
  },
  {
    key: 'advance_tax_amount',
    label: 'Advance Tax Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) => toNum(pur.advance_tax_amount ?? 0),
  },
  {
    key: 'net_total',
    label: 'Total / Net Invoice Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) => toNum(pur.net_total ?? 0),
  },
  {
    key: 'paid_amount',
    label: 'Paid Amount',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) => toNum(pur.paid_amount ?? 0),
  },
  {
    key: 'remaining_balance',
    label: 'Balance',
    category: 'Financial Information',
    format: 'currency',
    getValue: (pur) =>
      toNum(
        pur.balance_amount ??
          pur.remaining_balance ??
          Math.max(0, toNum(pur.net_total ?? 0) - toNum(pur.paid_amount ?? 0))
      ),
  },
];

/**
 * Builds custom rows (one row per invoice item, repeating selected invoice-level fields)
 * in the exact column order specified by `selectedFieldKeys`.
 */
export function buildCustomExportRows(
  moduleType: 'SALES' | 'PURCHASE',
  invoices: Array<Record<string, any>>,
  selectedFieldKeys: string[]
): {
  headers: string[];
  fieldDefs: CustomExportFieldDef[];
  rows: Array<Record<string, any>>;
} {
  const catalog =
    moduleType === 'PURCHASE' ? PURCHASE_CUSTOM_EXPORT_FIELDS : SALES_CUSTOM_EXPORT_FIELDS;
  const byKey = new Map<string, CustomExportFieldDef>();
  for (const def of catalog) {
    byKey.set(def.key, def);
  }

  const fieldDefs: CustomExportFieldDef[] = [];
  for (const key of selectedFieldKeys) {
    const def = byKey.get(key);
    if (def) {
      fieldDefs.push(def);
    }
  }

  const headers = fieldDefs.map((f) => f.label);
  const rows: Array<Record<string, any>> = [];

  for (const inv of invoices) {
    const rawItems: Array<Record<string, any>> = Array.isArray(inv.items)
      ? inv.items
      : Array.isArray(inv.lines)
      ? inv.lines
      : [];

    const itemList = rawItems.length > 0 ? rawItems : [{}];

    for (const item of itemList) {
      const rowObj: Record<string, any> = {};
      for (const def of fieldDefs) {
        rowObj[def.label] = def.getValue(inv, item);
      }
      rows.push(rowObj);
    }
  }

  return { headers, fieldDefs, rows };
}

/**
 * Exports selected fields in the user's chosen column order into a genuine .xlsx workbook.
 * One row per invoice item, repeating selected invoice-level fields on each item row.
 */
export function exportCustomInvoicesToExcel(
  moduleType: 'SALES' | 'PURCHASE',
  invoices: Array<Record<string, any>>,
  selectedFieldKeys: string[],
  customFileName?: string
): { rowCount: number; columnCount: number; fileName: string } {
  if (!invoices || invoices.length === 0) {
    throw new Error('No invoices available to export.');
  }
  if (!selectedFieldKeys || selectedFieldKeys.length === 0) {
    throw new Error('Please select at least one field to export.');
  }

  const { headers, rows } = buildCustomExportRows(moduleType, invoices, selectedFieldKeys);
  if (headers.length === 0) {
    throw new Error('No valid export fields selected.');
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  applyColumnWidths(ws, headers, rows);

  const sheetName = moduleType === 'PURCHASE' ? 'Custom Purchase Export' : 'Custom Sales Export';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const datePart = new Date().toISOString().slice(0, 10);
  const defaultName =
    moduleType === 'PURCHASE'
      ? invoices.length === 1
        ? `Custom_Purchase_${String(
            invoices[0].bill_number || invoices[0].invoice_number || 'Export'
          ).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        : `Custom_Purchase_Export_${datePart}.xlsx`
      : invoices.length === 1
      ? `Custom_Sales_${String(invoices[0].invoice_number || 'Export').replace(
          /[^a-zA-Z0-9_-]/g,
          '_'
        )}.xlsx`
      : `Custom_Sales_Export_${datePart}.xlsx`;

  const finalFileName = customFileName || defaultName;
  XLSX.writeFile(wb, finalFileName);

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    fileName: finalFileName,
  };
}

