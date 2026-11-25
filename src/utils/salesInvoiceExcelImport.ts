import * as XLSX from 'xlsx';

export interface ParsedExcelSaleLineInput {
  row_number: number;
  item_code: string;
  item_name: string;
  company_name?: string;
  packing?: string;
  batch_number?: string;
  expiry_date?: string;
  quantity: unknown;
  loose_quantity?: unknown;
  bonus_quantity?: unknown;
  unit_price?: unknown;
  loose_rate?: unknown;
  gross_amount?: unknown;
  discount_1_percent?: unknown;
  discount_2_percent?: unknown;
  discount_percent?: unknown;
  discount_amount?: unknown;
  tax_percent?: unknown;
  tax_amount?: unknown;
  net_amount?: unknown;
  remarks?: string;
}

export interface ParsedExcelSaleInvoiceInput {
  invoice_number: string;
  invoice_date: string;
  customer_code: string;
  customer_name: string;
  buyer_name?: string;
  invoice_type?: string;
  payment_mode?: string;
  salesman?: string;
  gross_total?: unknown;
  discount_amount?: unknown;
  invoice_discount_amount?: unknown;
  tax_amount?: unknown;
  advance_tax_amount?: unknown;
  net_total?: unknown;
  paid_amount?: unknown;
  balance_amount?: unknown;
  remarks?: string;
  items: ParsedExcelSaleLineInput[];
}

function normalizeHeaderKey(key: string): string {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '')
    .trim();
}

function pickField(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedAliases = aliases.map(normalizeHeaderKey);
  const entries = Object.entries(row);
  for (const target of normalizedAliases) {
    for (const [k, v] of entries) {
      if (normalizeHeaderKey(k) === target) {
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return v;
        }
      }
    }
  }
  return undefined;
}

function formatExcelDateValue(val: unknown): string {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof val === 'number' && val > 20000 && val < 90000) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  return String(val).trim();
}

function isTotalFooterRow(row: Record<string, unknown>): boolean {
  const invNo = String(
    pickField(row, ['Invoice Number', 'Invoice No', 'Invoice #', 'Inv No', 'Bill Number']) ?? ''
  )
    .trim()
    .toUpperCase();
  if (invNo === 'TOTAL' || invNo === 'GRAND TOTAL' || invNo === 'SUBTOTAL') {
    return true;
  }
  const firstVal = String(Object.values(row)[0] ?? '')
    .trim()
    .toUpperCase();
  if (firstVal === 'TOTAL' || firstVal === 'GRAND TOTAL') {
    return true;
  }
  return false;
}

function isRowCompletelyEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === '');
}

/**
 * Parses an uploaded Sales Invoice .xlsx file into structured invoices + line items.
 * Compatible with:
 * 1. Standard AMS Sales Invoice Excel Export ("Invoice Summary" + "Invoice Details" sheets)
 * 2. Custom Sales Excel Export ("Custom Sales Export" single sheet)
 * 3. General single-sheet or multi-sheet Sales Invoice Excel files
 */
export async function parseSalesInvoicesFromExcelFile(file: File): Promise<{
  invoices: ParsedExcelSaleInvoiceInput[];
  detectedFormat: 'standard_two_sheet' | 'single_sheet_details';
  sheetNames: string[];
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The selected Excel file contains no worksheets.');
  }

  // Detect if workbook has "Invoice Summary" and "Invoice Details" (Standard AMS Export format)
  const summarySheetName = workbook.SheetNames.find((n) => {
    const lower = n.trim().toLowerCase();
    return lower === 'invoice summary' || lower === 'summary' || lower === 'invoices';
  });
  const detailsSheetName = workbook.SheetNames.find((n) => {
    const lower = n.trim().toLowerCase();
    return (
      lower === 'invoice details' ||
      lower === 'details' ||
      lower === 'line items' ||
      lower === 'items' ||
      lower === 'sale items'
    );
  });

  // Map of summary headers keyed by uppercase Invoice Number (if a Summary sheet exists)
  const summaryByInvoiceNo = new Map<string, Record<string, unknown>>();
  const summaryRowsWithoutDetails: Array<Record<string, unknown>> = [];

  if (summarySheetName && detailsSheetName && summarySheetName !== detailsSheetName) {
    const summarySheet = workbook.Sheets[summarySheetName];
    const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, {
      defval: '',
    });
    for (const sRow of summaryRows) {
      if (isRowCompletelyEmpty(sRow) || isTotalFooterRow(sRow)) continue;
      const invNo = String(
        pickField(sRow, ['Invoice Number', 'Invoice No', 'Invoice #', 'Inv No', 'Invoice']) ?? ''
      ).trim();
      if (invNo) {
        summaryByInvoiceNo.set(invNo.toUpperCase(), sRow);
      } else {
        summaryRowsWithoutDetails.push(sRow);
      }
    }
  }

  // Choose the primary details sheet to read line items from
  const activeDetailsSheetName = detailsSheetName || workbook.SheetNames[0];
  const detailsSheet = workbook.Sheets[activeDetailsSheetName];
  const rawDetailRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(detailsSheet, {
    defval: '',
  });

  const invoicesMap = new Map<string, ParsedExcelSaleInvoiceInput>();
  const orderedKeys: string[] = [];
  let lastActiveInvoiceKey = '';
  let autoGroupCounter = 0;

  for (let idx = 0; idx < rawDetailRows.length; idx++) {
    const row = rawDetailRows[idx];
    const excelRowNumber = idx + 2; // 1-based header row + 1
    if (isRowCompletelyEmpty(row) || isTotalFooterRow(row)) continue;

    const rawInvNo = String(
      pickField(row, ['Invoice Number', 'Invoice No', 'Invoice #', 'Inv No', 'Invoice']) ?? ''
    ).trim();
    const rawInvDate = formatExcelDateValue(
      pickField(row, ['Invoice Date', 'Date', 'Sale Date', 'Bill Date'])
    );
    const rawCustCode = String(
      pickField(row, ['Customer Code', 'Account Code', 'Party Code', 'Cust Code']) ?? ''
    ).trim();
    const rawCustName = String(
      pickField(row, [
        'Customer Name',
        'Account / Party Name',
        'Account Name',
        'Party Name',
        'Customer',
        'Party',
      ]) ?? ''
    ).trim();

    const rawItemCode = String(
      pickField(row, ['Item Code', 'Product Code', 'Medicine Code', 'SKU', 'Code', 'Variant Code']) ?? ''
    ).trim();
    const rawItemName = String(
      pickField(row, ['Item Name', 'Product Name', 'Medicine Name', 'Description', 'Item', 'Medicine']) ?? ''
    ).trim();

    const rawQty = pickField(row, ['Quantity', 'Qty', 'Packs', 'Pack Qty', 'Sale Qty']);
    const rawLooseQty = pickField(row, ['Loose Quantity', 'Loose Qty', 'Loose', 'Loose Units']);
    const rawBonusQty = pickField(row, ['Bonus', 'Bonus Quantity', 'Bonus Qty', 'Free']);

    // Skip rows that have neither item code/name nor quantity nor customer/invoice info
    if (!rawItemCode && !rawItemName && (rawQty === undefined || rawQty === '') && !rawInvNo) {
      continue;
    }

    // Determine which invoice group this row belongs to
    let groupKey = '';
    if (rawInvNo) {
      groupKey = `INV:${rawInvNo.toUpperCase()}`;
      lastActiveInvoiceKey = groupKey;
    } else if (lastActiveInvoiceKey && !rawCustName && !rawCustCode && !rawInvDate) {
      // Multi-line invoice where Invoice Number was only entered on the first row
      groupKey = lastActiveInvoiceKey;
    } else if (
      lastActiveInvoiceKey &&
      invoicesMap.has(lastActiveInvoiceKey) &&
      (!rawCustName ||
        invoicesMap.get(lastActiveInvoiceKey)!.customer_name.toLowerCase() === rawCustName.toLowerCase()) &&
      (!rawCustCode ||
        invoicesMap.get(lastActiveInvoiceKey)!.customer_code.toLowerCase() === rawCustCode.toLowerCase()) &&
      (!rawInvDate || invoicesMap.get(lastActiveInvoiceKey)!.invoice_date === rawInvDate)
    ) {
      groupKey = lastActiveInvoiceKey;
    } else {
      autoGroupCounter += 1;
      groupKey = `AUTO:${autoGroupCounter}`;
      lastActiveInvoiceKey = groupKey;
    }

    let invoiceGroup = invoicesMap.get(groupKey);
    if (!invoiceGroup) {
      const summaryRow = rawInvNo ? summaryByInvoiceNo.get(rawInvNo.toUpperCase()) : undefined;

      const summaryDate = summaryRow
        ? formatExcelDateValue(pickField(summaryRow, ['Invoice Date', 'Date', 'Sale Date']))
        : '';
      const summaryCustCode = summaryRow
        ? String(pickField(summaryRow, ['Customer Code', 'Account Code', 'Party Code']) ?? '').trim()
        : '';
      const summaryCustName = summaryRow
        ? String(
            pickField(summaryRow, [
              'Customer Name',
              'Account / Party Name',
              'Account Name',
              'Party Name',
              'Customer',
            ]) ?? ''
          ).trim()
        : '';
      const summaryInvoiceType = summaryRow
        ? String(pickField(summaryRow, ['Invoice Type', 'Type', 'Sale Type']) ?? '').trim()
        : '';
      const summaryPaymentMode = summaryRow
        ? String(pickField(summaryRow, ['Payment Mode', 'Mode', 'Payment Type', 'Terms']) ?? '').trim()
        : '';
      const summarySalesman = summaryRow
        ? String(pickField(summaryRow, ['Salesman', 'Salesperson', 'Booked By']) ?? '').trim()
        : '';
      const summaryRemarks = summaryRow
        ? String(pickField(summaryRow, ['Remarks', 'Remarks / Notes', 'Notes']) ?? '').trim()
        : '';

      const rowInvoiceType = String(
        pickField(row, ['Invoice Type', 'Type', 'Sale Type']) ?? ''
      ).trim();
      const rowPaymentMode = String(
        pickField(row, ['Payment Mode', 'Mode', 'Payment Type', 'Terms']) ?? ''
      ).trim();
      const rowSalesman = String(
        pickField(row, ['Salesman', 'Salesperson', 'Booked By']) ?? ''
      ).trim();
      const rowHeaderRemarks = String(
        pickField(row, ['Remarks / Notes', 'Invoice Remarks', 'Notes']) ?? ''
      ).trim();

      const headerGross = summaryRow
        ? pickField(summaryRow, ['Gross Amount', 'Invoice Gross Total', 'Gross Total'])
        : pickField(row, ['Invoice Gross Total', 'Gross Total']);

      const headerDiscount = summaryRow
        ? pickField(summaryRow, ['Discount', 'Invoice Discount', 'Total Discount'])
        : pickField(row, ['Invoice Discount', 'Header Discount', 'Bill Discount']);

      const headerInvoiceLevelDiscount = pickField(row, ['Invoice Discount', 'Bill Discount']);

      const headerTax = summaryRow
        ? pickField(summaryRow, ['Tax', 'Invoice Tax', 'GST', 'Total Tax'])
        : pickField(row, ['Invoice Tax', 'Total Tax']);

      const headerAdvanceTax = summaryRow
        ? pickField(summaryRow, ['Advance Tax', 'Adv Tax', 'WHT'])
        : pickField(row, ['Advance Tax', 'Adv Tax', 'WHT']);

      const headerNetTotal = summaryRow
        ? pickField(summaryRow, ['Net Total', 'Total / Net Invoice Amount', 'Invoice Net Total', 'Grand Total'])
        : pickField(row, ['Net Total', 'Total / Net Invoice Amount', 'Invoice Net Total', 'Grand Total']);

      const headerPaidAmount = summaryRow
        ? pickField(summaryRow, ['Paid Amount', 'Paid', 'Received Amount', 'Cash Received'])
        : pickField(row, ['Paid Amount', 'Paid', 'Received Amount', 'Cash Received']);

      const headerBalance = summaryRow
        ? pickField(summaryRow, ['Balance', 'Balance Amount', 'Remaining Balance'])
        : pickField(row, ['Balance', 'Balance Amount', 'Remaining Balance']);

      invoiceGroup = {
        invoice_number: rawInvNo,
        invoice_date: rawInvDate || summaryDate,
        customer_code: rawCustCode || summaryCustCode,
        customer_name: rawCustName || summaryCustName,
        buyer_name: String(pickField(row, ['Buyer Name', 'Buyer']) ?? '').trim(),
        invoice_type: rowInvoiceType || summaryInvoiceType || 'Retail',
        payment_mode: rowPaymentMode || summaryPaymentMode || '',
        salesman: rowSalesman || summarySalesman || '',
        gross_total: headerGross,
        discount_amount: headerDiscount,
        invoice_discount_amount: headerInvoiceLevelDiscount,
        tax_amount: headerTax,
        advance_tax_amount: headerAdvanceTax,
        net_total: headerNetTotal,
        paid_amount: headerPaidAmount,
        balance_amount: headerBalance,
        remarks: summaryRemarks || rowHeaderRemarks,
        items: [],
      };

      invoicesMap.set(groupKey, invoiceGroup);
      orderedKeys.push(groupKey);
    } else {
      // Fill any header level fields if they were present on subsequent rows
      if (!invoiceGroup.invoice_date && rawInvDate) invoiceGroup.invoice_date = rawInvDate;
      if (!invoiceGroup.customer_code && rawCustCode) invoiceGroup.customer_code = rawCustCode;
      if (!invoiceGroup.customer_name && rawCustName) invoiceGroup.customer_name = rawCustName;
      if (invoiceGroup.net_total === undefined) {
        const rowNetTotal = pickField(row, ['Net Total', 'Total / Net Invoice Amount', 'Invoice Net Total']);
        if (rowNetTotal !== undefined) invoiceGroup.net_total = rowNetTotal;
      }
      if (invoiceGroup.paid_amount === undefined) {
        const rowPaid = pickField(row, ['Paid Amount', 'Paid', 'Received Amount']);
        if (rowPaid !== undefined) invoiceGroup.paid_amount = rowPaid;
      }
      if (!invoiceGroup.payment_mode) {
        const rowMode = String(pickField(row, ['Payment Mode', 'Mode', 'Payment Type']) ?? '').trim();
        if (rowMode) invoiceGroup.payment_mode = rowMode;
      }
    }

    // Parse line item fields
    const lineRate = pickField(row, ['Rate', 'Sale Rate', 'Unit Price', 'Unit Rate', 'Price', 'TP', 'MRP']);
    const lineLooseRate = pickField(row, ['Loose Rate', 'Unit Loose Rate']);
    const lineGross = pickField(row, ['Gross Amount', 'Line Gross']);
    const lineD1 = pickField(row, ['Discount 1 %', 'Disc 1 %', 'D1 %', 'Discount1%']);
    const lineD2 = pickField(row, ['Discount 2 %', 'Disc 2 %', 'D2 %', 'Discount2%']);
    const lineDiscPct = pickField(row, ['Discount %', 'Disc %', 'Line Discount %']);
    const lineDiscAmt = pickField(row, ['Discount', 'Discount Amount', 'Disc Amount', 'Line Discount']);
    const lineTaxPct = pickField(row, ['Tax %', 'GST %', 'Line Tax %']);
    const lineTaxAmt = pickField(row, ['Tax', 'Tax Amount', 'GST Amount', 'Line Tax']);

    // Note: In Standard Export "Invoice Details", the line net total column is named "Amount",
    // whereas in Custom Export it is named "Net Line Amount", and in simple sheets it may be "Net Amount" or "Amount".
    let lineNetAmt = pickField(row, ['Amount', 'Net Line Amount', 'Line Total', 'Line Net Amount']);
    if (lineNetAmt === undefined) {
      // If "Net Amount" is present and there is no separate "Net Total" column, treat "Net Amount" as the line net amount
      const netAmtVal = pickField(row, ['Net Amount']);
      if (netAmtVal !== undefined) {
        lineNetAmt = netAmtVal;
      }
    }

    const lineRemarks = String(pickField(row, ['Remarks', 'Line Remarks', 'Item Remarks']) ?? '').trim();

    invoiceGroup.items.push({
      row_number: excelRowNumber,
      item_code: rawItemCode,
      item_name: rawItemName,
      company_name: String(pickField(row, ['Company', 'Company Name', 'Manufacturer']) ?? '').trim(),
      packing: String(pickField(row, ['Packing', 'Pack', 'Pack Size']) ?? '').trim(),
      batch_number: String(pickField(row, ['Batch Number', 'Batch', 'Batch No', 'Lot']) ?? '').trim(),
      expiry_date: formatExcelDateValue(pickField(row, ['Expiry Date', 'Expiry', 'Exp Date', 'Exp'])),
      quantity: rawQty !== undefined && rawQty !== '' ? rawQty : 0,
      loose_quantity: rawLooseQty,
      bonus_quantity: rawBonusQty,
      unit_price: lineRate,
      loose_rate: lineLooseRate,
      gross_amount: lineGross,
      discount_1_percent: lineD1,
      discount_2_percent: lineD2,
      discount_percent: lineDiscPct,
      discount_amount: lineDiscAmt,
      tax_percent: lineTaxPct,
      tax_amount: lineTaxAmt,
      net_amount: lineNetAmt,
      remarks: lineRemarks,
    });
  }

  const invoices = orderedKeys
    .map((k) => invoicesMap.get(k)!)
    .filter((inv) => inv && inv.items.length > 0);

  // If a single-line invoice only had "Net Amount" filled and no "Net Total" column,
  // copy line net_amount to invoice net_total if invoice net_total is blank
  for (const inv of invoices) {
    if (inv.net_total === undefined && inv.items.length === 1 && inv.items[0].net_amount !== undefined) {
      inv.net_total = inv.items[0].net_amount;
    }
  }

  return {
    invoices,
    detectedFormat:
      summarySheetName && detailsSheetName && summarySheetName !== detailsSheetName
        ? 'standard_two_sheet'
        : 'single_sheet_details',
    sheetNames: workbook.SheetNames,
  };
}

/**
 * Generates and downloads a clean sample Sales Invoice Import Excel template (.xlsx)
 * matching the standard AMS 2-sheet Sales Invoice Excel format ("Invoice Summary" + "Invoice Details").
 */
export function downloadSalesInvoiceImportTemplate(
  sampleCustomer?: { account_code?: string; account_name?: string },
  sampleItems?: Array<{ item_code?: string; item_name?: string; company_name?: string; packing?: string; retail_price?: number }>
) {
  const today = new Date().toISOString().slice(0, 10);
  const custCode = sampleCustomer?.account_code || 'CUS-1001';
  const custName = sampleCustomer?.account_name || 'Walk-in Cash Customer';

  const item1 = sampleItems?.[0] || {
    item_code: 'MED-1001',
    item_name: 'Panadol 500mg Tablet',
    company_name: 'GSK',
    packing: '10x10',
    retail_price: 350,
  };
  const item2 = sampleItems?.[1] || sampleItems?.[0] || {
    item_code: 'MED-1002',
    item_name: 'Augmentin 625mg Tablet',
    company_name: 'GSK',
    packing: '1x6',
    retail_price: 420,
  };

  const rate1 = Number(item1.retail_price || 350);
  const rate2 = Number(item2.retail_price || 420);
  const qty1 = 2;
  const qty2 = 1;
  const gross1 = qty1 * rate1;
  const gross2 = qty2 * rate2;
  const totalGross = gross1 + gross2;

  const wb = XLSX.utils.book_new();

  const summaryRows = [
    {
      'Invoice Number': '',
      'Invoice Date': today,
      'Customer Code': custCode,
      'Account / Party Name': custName,
      'Invoice Type': 'Retail',
      'Payment Mode': 'Cash',
      'Total Items': 2,
      Quantity: qty1 + qty2,
      'Loose Quantity': 0,
      Bonus: 0,
      'Gross Amount': totalGross,
      Discount: 0,
      Tax: 0,
      'Advance Tax': 0,
      'Net Total': totalGross,
      'Paid Amount': totalGross,
      Balance: 0,
      Salesman: 'Counter Pharmacist',
      Status: 'completed',
      Remarks: 'Sample Excel Import Invoice',
    },
  ];

  const detailRows = [
    {
      'Invoice Number': '',
      'Invoice Date': today,
      'Customer Code': custCode,
      'Account / Party Name': custName,
      'Item Code': item1.item_code || '',
      'Item Name': item1.item_name || '',
      Company: item1.company_name || '',
      Packing: item1.packing || '1x10',
      'Batch Number': '',
      'Expiry Date': '',
      Quantity: qty1,
      'Loose Quantity': 0,
      Bonus: 0,
      Rate: rate1,
      'Loose Rate': 0,
      'Gross Amount': gross1,
      'Discount 1 %': 0,
      'Discount 2 %': 0,
      'Net Rate': rate1,
      'Discount %': 0,
      Discount: 0,
      'Tax %': 0,
      Tax: 0,
      Amount: gross1,
      Remarks: '',
      'Net Total': totalGross,
      'Paid Amount': totalGross,
      Balance: 0,
      'Payment Mode': 'Cash',
    },
    {
      'Invoice Number': '',
      'Invoice Date': today,
      'Customer Code': custCode,
      'Account / Party Name': custName,
      'Item Code': item2.item_code || '',
      'Item Name': item2.item_name || '',
      Company: item2.company_name || '',
      Packing: item2.packing || '1x10',
      'Batch Number': '',
      'Expiry Date': '',
      Quantity: qty2,
      'Loose Quantity': 0,
      Bonus: 0,
      Rate: rate2,
      'Loose Rate': 0,
      'Gross Amount': gross2,
      'Discount 1 %': 0,
      'Discount 2 %': 0,
      'Net Rate': rate2,
      'Discount %': 0,
      Discount: 0,
      'Tax %': 0,
      Tax: 0,
      Amount: gross2,
      Remarks: '',
      'Net Total': totalGross,
      'Paid Amount': totalGross,
      Balance: 0,
      'Payment Mode': 'Cash',
    },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  const wsDetails = XLSX.utils.json_to_sheet(detailRows);

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Invoice Summary');
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Invoice Details');

  XLSX.writeFile(wb, `AMS_Sales_Invoice_Import_Template_${today}.xlsx`);
}
