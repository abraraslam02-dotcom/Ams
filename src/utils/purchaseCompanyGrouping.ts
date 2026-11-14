export interface GroupedPurchaseLine {
  sNo: number;
  raw: Record<string, any>;
  itemName: string;
  itemCode: string;
  companyName: string;
  packing: string;
  quantity: number;
  looseQuantity: number;
  bonusQuantity: number;
  batchNumber: string;
  expiryDate: string;
  tradePrice: number;
  discountPercent: number;
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
  const baseRows = items.map((item) => {
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
    const discountPercent = round2(item.discount_percent ?? 0);
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

    return {
      raw: item,
      companyName,
      companyKey: companyName.toLowerCase(),
      itemName: String(item.item_name || '').trim() || 'Unnamed Item',
      itemCode: String(item.item_code || '').trim(),
      packing: String(item.packing || '').trim(),
      quantity,
      looseQuantity,
      bonusQuantity,
      batchNumber: String(item.batch_number || '').trim() || '—',
      expiryDate: String(item.expiry_date || '').trim() || '—',
      tradePrice,
      discountPercent,
      grossAmount,
      rawItemDiscount,
      rawLineAfterItemDisc,
      rawTaxable,
      rawSalesTax,
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

  // 3. Reconcile Sales Tax (use exact saved line tax_amount unless preview differs due to invoice discount)
  let lineSalesTaxes: number[];
  if (Math.abs(sumRawSalesTax - headerSalesTax) <= 0.02) {
    lineSalesTaxes = baseRows.map((r) => r.rawSalesTax);
  } else {
    const rawTaxAtCurrentTaxable = baseRows.map((r, i) =>
      round2(lineTaxables[i] * (r.taxPercent / 100))
    );
    lineSalesTaxes = allocateAmountCents(headerSalesTax, rawTaxAtCurrentTaxable);
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
      raw: r.raw,
      itemName: r.itemName,
      itemCode: r.itemCode,
      companyName: bucket.companyName,
      packing: r.packing,
      quantity: r.quantity,
      looseQuantity: r.looseQuantity,
      bonusQuantity: r.bonusQuantity,
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate,
      tradePrice: r.tradePrice,
      discountPercent: r.discountPercent,
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
