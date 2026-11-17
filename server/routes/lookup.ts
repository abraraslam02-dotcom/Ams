import { Router, type Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';

export const lookupRouter = Router();

function cleanStr(val: unknown): string {
  return String(val ?? '').trim();
}

function round2(n: unknown): number {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface LookupSearchFilters {
  scope?: 'sales' | 'purchase' | 'all';
  invoiceNumber?: string;
  invoiceDate?: string;
  startDate?: string;
  endDate?: string;
  customerName?: string;
  supplierName?: string;
  buyerName?: string;
  itemCode?: string;
  itemName?: string;
  barcode?: string;
  companyName?: string;
  genericName?: string;
  category?: string;
  packing?: string;
  rackNumber?: string;
  sortBy?: 'invoice_date' | 'invoice_number';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export function executeLookupQuery(
  filters: LookupSearchFilters,
  access: { canViewSales: boolean; canViewPurchases: boolean }
) {
  const db = getDatabase();

  const scope =
    filters.scope === 'sales' || filters.scope === 'purchase' ? filters.scope : 'all';
  const invoiceNumber = cleanStr(filters.invoiceNumber);
  const invoiceDate = cleanStr(filters.invoiceDate);
  const startDate = cleanStr(filters.startDate);
  const endDate = cleanStr(filters.endDate);
  const customerName = cleanStr(filters.customerName);
  const supplierName = cleanStr(filters.supplierName);
  const buyerName = cleanStr(filters.buyerName);

  const itemCode = cleanStr(filters.itemCode);
  const itemName = cleanStr(filters.itemName);
  const barcode = cleanStr(filters.barcode);
  const companyName = cleanStr(filters.companyName);
  const genericName = cleanStr(filters.genericName);
  const category = cleanStr(filters.category);
  const packing = cleanStr(filters.packing);
  const rackNumber = cleanStr(filters.rackNumber);

  const sortBy = filters.sortBy === 'invoice_number' ? 'invoice_number' : 'invoice_date';
  const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(1000, Math.max(10, Number(filters.limit || 300)));

  const hasItemCriteria = Boolean(
    itemCode ||
      itemName ||
      barcode ||
      companyName ||
      genericName ||
      category ||
      packing ||
      rackNumber
  );

  const shouldSearchSales =
    access.canViewSales &&
    (scope === 'all' || scope === 'sales') &&
    !supplierName;

  const shouldSearchPurchases =
    access.canViewPurchases &&
    (scope === 'all' || scope === 'purchase') &&
    !customerName &&
    !buyerName;

  const results: Array<Record<string, unknown>> = [];

  // --------------------------------------------------------------------------
  // 1. SALES INVOICES LOOKUP (Each matching invoice returned ONLY ONCE)
  // --------------------------------------------------------------------------
  if (shouldSearchSales) {
    const whereClauses: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (invoiceNumber) {
      whereClauses.push('s.invoice_number LIKE ?');
      params.push(`%${invoiceNumber}%`);
    }
    if (invoiceDate) {
      whereClauses.push('DATE(s.invoice_date) = DATE(?)');
      params.push(invoiceDate);
    }
    if (startDate) {
      whereClauses.push('DATE(s.invoice_date) >= DATE(?)');
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push('DATE(s.invoice_date) <= DATE(?)');
      params.push(endDate);
    }
    if (customerName) {
      whereClauses.push(
        "(COALESCE(s.customer_name, '') LIKE ? OR COALESCE(a.account_name, '') LIKE ? OR COALESCE(a.account_code, '') LIKE ?)"
      );
      const term = `%${customerName}%`;
      params.push(term, term, term);
    }
    if (buyerName) {
      whereClauses.push("COALESCE(s.buyer_name, '') LIKE ?");
      params.push(`%${buyerName}%`);
    }

    if (itemCode) {
      whereClauses.push("COALESCE(NULLIF(TRIM(si.item_code), ''), i.item_code, '') LIKE ?");
      params.push(`%${itemCode}%`);
    }
    if (itemName) {
      whereClauses.push("COALESCE(NULLIF(TRIM(si.item_name), ''), i.item_name, '') LIKE ?");
      params.push(`%${itemName}%`);
    }
    if (barcode) {
      whereClauses.push(
        "(COALESCE(i.barcode, '') LIKE ? OR COALESCE(iv.barcode, '') LIKE ? OR EXISTS (SELECT 1 FROM item_variant_barcodes ivb WHERE ivb.item_id = i.id AND (ivb.variant_id IS NULL OR ivb.variant_id = si.variant_id) AND ivb.barcode LIKE ?))"
      );
      const bTerm = `%${barcode}%`;
      params.push(bTerm, bTerm, bTerm);
    }
    if (companyName) {
      whereClauses.push("COALESCE(NULLIF(TRIM(si.company_name), ''), i.company_name, '') LIKE ?");
      params.push(`%${companyName}%`);
    }
    if (genericName) {
      whereClauses.push("COALESCE(i.generic_name, '') LIKE ?");
      params.push(`%${genericName}%`);
    }
    if (category) {
      whereClauses.push("COALESCE(i.category, '') LIKE ?");
      params.push(`%${category}%`);
    }
    if (packing) {
      whereClauses.push("COALESCE(NULLIF(TRIM(si.packing), ''), i.packing, '') LIKE ?");
      params.push(`%${packing}%`);
    }
    if (rackNumber) {
      whereClauses.push("COALESCE(i.rack_number, '') LIKE ?");
      params.push(`%${rackNumber}%`);
    }

    const itemJoinType = hasItemCriteria ? 'INNER JOIN' : 'LEFT JOIN';
    const orderExpr =
      sortBy === 'invoice_number'
        ? `s.invoice_number ${sortOrder.toUpperCase()}, s.id DESC`
        : `s.invoice_date ${sortOrder.toUpperCase()}, s.id DESC`;

    const saleHeaders = db
      .prepare(`
        SELECT
          s.id,
          s.invoice_number,
          s.invoice_date,
          COALESCE(NULLIF(TRIM(s.customer_name), ''), a.account_name, 'Walk-in Cash Customer') as party_name,
          COALESCE(s.buyer_name, '') as buyer_name,
          COALESCE(s.net_total, 0) as invoice_total,
          COALESCE(s.paid_amount, 0) as paid_amount,
          s.payment_mode,
          s.status,
          MIN(si.id) as first_line_id,
          ROUND(COALESCE(SUM(COALESCE(si.quantity, 0)), 0), 2) as matched_quantity,
          COUNT(si.id) as matched_item_count,
          (SELECT COUNT(*) FROM sale_items all_si WHERE all_si.sale_id = s.id) as total_item_count
        FROM sales s
        LEFT JOIN accounts a ON a.id = s.customer_account_id
        ${itemJoinType} sale_items si ON si.sale_id = s.id
        LEFT JOIN items i ON i.id = si.item_id
        LEFT JOIN item_variants iv ON iv.id = si.variant_id
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY s.id
        ORDER BY ${orderExpr}
        LIMIT ?
      `)
      .all(...params, limit) as Array<Record<string, unknown>>;

    const firstLineIds = saleHeaders
      .map((r) => Number(r.first_line_id || 0))
      .filter((id) => id > 0);

    const lineById = new Map<number, Record<string, unknown>>();
    if (firstLineIds.length > 0) {
      const ph = firstLineIds.map(() => '?').join(',');
      const lineRows = db
        .prepare(`
          SELECT
            si.id,
            COALESCE(NULLIF(TRIM(si.item_code), ''), i.item_code, '') as item_code,
            COALESCE(NULLIF(TRIM(si.item_name), ''), i.item_name, '') as item_name,
            COALESCE(NULLIF(TRIM(si.variant_name), ''), iv.variant_name, '') as variant_name,
            COALESCE(NULLIF(TRIM(si.company_name), ''), i.company_name, '') as company_name
          FROM sale_items si
          LEFT JOIN items i ON i.id = si.item_id
          LEFT JOIN item_variants iv ON iv.id = si.variant_id
          WHERE si.id IN (${ph})
        `)
        .all(...firstLineIds) as Array<Record<string, unknown>>;
      for (const lr of lineRows) {
        lineById.set(Number(lr.id), lr);
      }
    }

    for (const row of saleHeaders) {
      const rep = lineById.get(Number(row.first_line_id || 0));
      results.push({
        uid: `sale-${row.id}`,
        invoice_id: Number(row.id),
        invoice_type: 'Sales',
        invoice_number: String(row.invoice_number || ''),
        invoice_date: String(row.invoice_date || ''),
        party_name: String(row.party_name || ''),
        buyer_name: String(row.buyer_name || ''),
        item_code: String(rep?.item_code || ''),
        item_name: rep?.variant_name
          ? `${String(rep?.item_name || '')} (${String(rep.variant_name)})`
          : String(rep?.item_name || ''),
        company_name: String(rep?.company_name || ''),
        quantity: round2(row.matched_quantity),
        invoice_total: round2(row.invoice_total),
        paid_amount: round2(row.paid_amount),
        payment_mode: String(row.payment_mode || ''),
        status: String(row.status || ''),
        matched_item_count: Number(row.matched_item_count || 0),
        total_item_count: Number(row.total_item_count || 0),
      });
    }
  }

  // --------------------------------------------------------------------------
  // 2. PURCHASE INVOICES LOOKUP (Each matching invoice returned ONLY ONCE)
  // --------------------------------------------------------------------------
  if (shouldSearchPurchases) {
    const whereClauses: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (invoiceNumber) {
      whereClauses.push(
        "(p.bill_number LIKE ? OR COALESCE(p.supplier_invoice_number, '') LIKE ?)"
      );
      const term = `%${invoiceNumber}%`;
      params.push(term, term);
    }
    if (invoiceDate) {
      whereClauses.push('DATE(p.bill_date) = DATE(?)');
      params.push(invoiceDate);
    }
    if (startDate) {
      whereClauses.push('DATE(p.bill_date) >= DATE(?)');
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push('DATE(p.bill_date) <= DATE(?)');
      params.push(endDate);
    }
    if (supplierName) {
      whereClauses.push(
        "(COALESCE(a.account_name, '') LIKE ? OR COALESCE(a.account_code, '') LIKE ?)"
      );
      const term = `%${supplierName}%`;
      params.push(term, term);
    }

    if (itemCode) {
      whereClauses.push("COALESCE(NULLIF(TRIM(pi.item_code), ''), i.item_code, '') LIKE ?");
      params.push(`%${itemCode}%`);
    }
    if (itemName) {
      whereClauses.push("COALESCE(NULLIF(TRIM(pi.item_name), ''), i.item_name, '') LIKE ?");
      params.push(`%${itemName}%`);
    }
    if (barcode) {
      whereClauses.push(
        "(COALESCE(i.barcode, '') LIKE ? OR COALESCE(iv.barcode, '') LIKE ? OR EXISTS (SELECT 1 FROM item_variant_barcodes ivb WHERE ivb.item_id = i.id AND (ivb.variant_id IS NULL OR ivb.variant_id = pi.variant_id) AND ivb.barcode LIKE ?))"
      );
      const bTerm = `%${barcode}%`;
      params.push(bTerm, bTerm, bTerm);
    }
    if (companyName) {
      whereClauses.push("COALESCE(NULLIF(TRIM(pi.company_name), ''), i.company_name, '') LIKE ?");
      params.push(`%${companyName}%`);
    }
    if (genericName) {
      whereClauses.push("COALESCE(i.generic_name, '') LIKE ?");
      params.push(`%${genericName}%`);
    }
    if (category) {
      whereClauses.push("COALESCE(i.category, '') LIKE ?");
      params.push(`%${category}%`);
    }
    if (packing) {
      whereClauses.push("COALESCE(NULLIF(TRIM(pi.packing), ''), i.packing, '') LIKE ?");
      params.push(`%${packing}%`);
    }
    if (rackNumber) {
      whereClauses.push("COALESCE(i.rack_number, '') LIKE ?");
      params.push(`%${rackNumber}%`);
    }

    const itemJoinType = hasItemCriteria ? 'INNER JOIN' : 'LEFT JOIN';
    const orderExpr =
      sortBy === 'invoice_number'
        ? `p.bill_number ${sortOrder.toUpperCase()}, p.id DESC`
        : `p.bill_date ${sortOrder.toUpperCase()}, p.id DESC`;

    const purchaseHeaders = db
      .prepare(`
        SELECT
          p.id,
          p.bill_number as invoice_number,
          p.bill_date as invoice_date,
          COALESCE(a.account_name, 'Unknown Supplier') as party_name,
          COALESCE(p.net_total, 0) as invoice_total,
          COALESCE(p.paid_amount, 0) as paid_amount,
          p.payment_mode,
          p.status,
          p.supplier_invoice_number,
          MIN(pi.id) as first_line_id,
          ROUND(COALESCE(SUM(COALESCE(pi.quantity, 0)), 0), 2) as matched_quantity,
          COUNT(pi.id) as matched_item_count,
          (SELECT COUNT(*) FROM purchase_items all_pi WHERE all_pi.purchase_id = p.id) as total_item_count
        FROM purchases p
        LEFT JOIN accounts a ON a.id = p.supplier_account_id
        ${itemJoinType} purchase_items pi ON pi.purchase_id = p.id
        LEFT JOIN items i ON i.id = pi.item_id
        LEFT JOIN item_variants iv ON iv.id = pi.variant_id
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY p.id
        ORDER BY ${orderExpr}
        LIMIT ?
      `)
      .all(...params, limit) as Array<Record<string, unknown>>;

    const firstLineIds = purchaseHeaders
      .map((r) => Number(r.first_line_id || 0))
      .filter((id) => id > 0);

    const lineById = new Map<number, Record<string, unknown>>();
    if (firstLineIds.length > 0) {
      const ph = firstLineIds.map(() => '?').join(',');
      const lineRows = db
        .prepare(`
          SELECT
            pi.id,
            COALESCE(NULLIF(TRIM(pi.item_code), ''), i.item_code, '') as item_code,
            COALESCE(NULLIF(TRIM(pi.item_name), ''), i.item_name, '') as item_name,
            COALESCE(NULLIF(TRIM(pi.variant_name), ''), iv.variant_name, '') as variant_name,
            COALESCE(NULLIF(TRIM(pi.company_name), ''), i.company_name, '') as company_name
          FROM purchase_items pi
          LEFT JOIN items i ON i.id = pi.item_id
          LEFT JOIN item_variants iv ON iv.id = pi.variant_id
          WHERE pi.id IN (${ph})
        `)
        .all(...firstLineIds) as Array<Record<string, unknown>>;
      for (const lr of lineRows) {
        lineById.set(Number(lr.id), lr);
      }
    }

    for (const row of purchaseHeaders) {
      const rep = lineById.get(Number(row.first_line_id || 0));
      results.push({
        uid: `purchase-${row.id}`,
        invoice_id: Number(row.id),
        invoice_type: 'Purchase',
        invoice_number: String(row.invoice_number || ''),
        invoice_date: String(row.invoice_date || ''),
        party_name: String(row.party_name || ''),
        buyer_name: '',
        supplier_invoice_number: String(row.supplier_invoice_number || ''),
        item_code: String(rep?.item_code || ''),
        item_name: rep?.variant_name
          ? `${String(rep?.item_name || '')} (${String(rep.variant_name)})`
          : String(rep?.item_name || ''),
        company_name: String(rep?.company_name || ''),
        quantity: round2(row.matched_quantity),
        invoice_total: round2(row.invoice_total),
        paid_amount: round2(row.paid_amount),
        payment_mode: String(row.payment_mode || ''),
        status: String(row.status || ''),
        matched_item_count: Number(row.matched_item_count || 0),
        total_item_count: Number(row.total_item_count || 0),
      });
    }
  }

  // Merge and sort deterministically across Sales & Purchase results
  results.sort((a, b) => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'invoice_number') {
      const cmp = String(a.invoice_number || '').localeCompare(String(b.invoice_number || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (cmp !== 0) return cmp * dir;
    } else {
      const cmp = String(a.invoice_date || '').localeCompare(String(b.invoice_date || ''));
      if (cmp !== 0) return cmp * dir;
    }
    const dateTie = String(a.invoice_date || '').localeCompare(String(b.invoice_date || ''));
    if (dateTie !== 0) return -dateTie;
    return Number(b.invoice_id || 0) - Number(a.invoice_id || 0);
  });

  const sliced = results.slice(0, limit);
  return {
    rows: sliced,
    totalCount: results.length,
  };
}

/**
 * GET /api/lookup/invoices
 * Unified fast search across Sales & Purchase invoices and Item Master attributes.
 * Each matching invoice is returned at most once.
 */
lookupRouter.get('/invoices', (req: AuthenticatedRequest, res: Response) => {
  try {
    const isSuperAdmin = req.user?.role === 'Super Admin';
    const canViewSales = isSuperAdmin || Boolean(req.permissions?.sales?.can_view);
    const canViewPurchases = isSuperAdmin || Boolean(req.permissions?.purchases?.can_view);

    if (!canViewSales && !canViewPurchases) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You do not have permission to view Sales or Purchase invoices.',
      });
    }

    const q = req.query;
    const result = executeLookupQuery(
      {
        scope:
          q.scope === 'sales' || q.scope === 'purchase' || q.scope === 'all'
            ? q.scope
            : 'all',
        invoiceNumber: cleanStr(q.invoiceNumber),
        invoiceDate: cleanStr(q.invoiceDate),
        startDate: cleanStr(q.startDate),
        endDate: cleanStr(q.endDate),
        customerName: cleanStr(q.customerName),
        supplierName: cleanStr(q.supplierName),
        buyerName: cleanStr(q.buyerName),
        itemCode: cleanStr(q.itemCode),
        itemName: cleanStr(q.itemName),
        barcode: cleanStr(q.barcode),
        companyName: cleanStr(q.companyName),
        genericName: cleanStr(q.genericName),
        category: cleanStr(q.category),
        packing: cleanStr(q.packing),
        rackNumber: cleanStr(q.rackNumber),
        sortBy: q.sortBy === 'invoice_number' ? 'invoice_number' : 'invoice_date',
        sortOrder: q.sortOrder === 'asc' ? 'asc' : 'desc',
        limit: q.limit ? Number(q.limit) : 300,
      },
      { canViewSales, canViewPurchases }
    );

    return res.json({
      success: true,
      count: result.rows.length,
      totalCount: result.totalCount,
      data: result.rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});
