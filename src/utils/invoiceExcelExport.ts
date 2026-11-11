import * as XLSX from 'xlsx';

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
        'Item Name': String(item.item_name || ''),
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
    'Company',
    'Packing',
    'Batch Number',
    'Expiry Date',
    'Quantity',
    'Loose Quantity',
    'Bonus',
    'Rate',
    'Gross Amount',
    'Discount %',
    'Discount',
    'Tax %',
    'Tax',
    'Amount',
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
        Company: '',
        Packing: '',
        'Batch Number': '',
        'Expiry Date': '',
        Quantity: 0,
        'Loose Quantity': 0,
        Bonus: 0,
        Rate: 0,
        'Gross Amount': toNum(pur.gross_total ?? 0),
        'Discount %': 0,
        Discount: toNum(pur.discount_amount ?? 0),
        'Tax %': 0,
        Tax: toNum((pur.gst_amount ?? 0) + (pur.advance_tax_amount ?? 0)),
        Amount: invNetTotal,
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
      const rate = toNum(item.purchase_rate ?? item.purchase_price ?? item.rate);
      const grossAmt = toNum(item.gross_amount ?? qty * rate);
      const discPct = toNum(item.discount_percent);
      const discAmt = toNum(item.discount_amount ?? (grossAmt * discPct) / 100);
      const taxableAmt = Math.max(0, toNum(grossAmt - discAmt));
      const taxPct = toNum(item.tax_percent);
      const taxAmt = toNum(item.tax_amount ?? (taxableAmt * taxPct) / 100);
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
        'Item Name': String(item.item_name || ''),
        Company: String(item.company_name || item.company || ''),
        Packing: String(item.packing || ''),
        'Batch Number': String(item.batch_number || ''),
        'Expiry Date': cleanDate(item.expiry_date),
        Quantity: qty,
        'Loose Quantity': looseQty,
        Bonus: bonus,
        Rate: rate,
        'Gross Amount': grossAmt,
        'Discount %': discPct,
        Discount: discAmt,
        'Tax %': taxPct,
        Tax: taxAmt,
        Amount: lineAmount,
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
      'Gross Amount': detGross,
      'Discount %': '',
      Discount: detDisc,
      'Tax %': '',
      Tax: detTax,
      Amount: detLineAmount,
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
    purchases.length === 1
      ? `Purchase_Invoice_${String(
          purchases[0].bill_number || purchases[0].invoice_number || 'Export'
        ).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
      : `Purchase_Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`;

  XLSX.writeFile(wb, customFileName || defaultName);
}
