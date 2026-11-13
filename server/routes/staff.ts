import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { round2 } from './purchases.ts';
import { hashPassword } from '../services/authService.ts';
import {
  allocateNextSalesmanCode,
  peekNextSalesmanCode,
  syncSalesmanDenormalizedReferences,
  getSalesmanLinkedRecordCount,
} from '../utils/salesmanCodeGenerator.ts';

export const staffRouter = Router();

function getNextSalesmanCode(): string {
  return peekNextSalesmanCode(getDatabase());
}

function getNextDeliverymanCode(): string {
  const db = getDatabase();
  const row = db
    .prepare("SELECT deliveryman_code FROM deliverymen WHERE deliveryman_code LIKE 'DM-%' ORDER BY id DESC LIMIT 1")
    .get() as { deliveryman_code: string } | undefined;
  let seq = 1;
  if (row?.deliveryman_code) {
    const m = row.deliveryman_code.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  while (
    db
      .prepare('SELECT id FROM deliverymen WHERE UPPER(deliveryman_code) = UPPER(?)')
      .get(`DM-${String(seq).padStart(3, '0')}`)
  ) {
    seq++;
  }
  return `DM-${String(seq).padStart(3, '0')}`;
}

function getNextCommissionPaymentNumber(): string {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT payment_number FROM salesman_commission_payments WHERE payment_number LIKE 'CMP-2026-%' ORDER BY id DESC LIMIT 1"
    )
    .get() as { payment_number: string } | undefined;
  let seq = 1;
  if (row?.payment_number) {
    const m = row.payment_number.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  while (
    db
      .prepare('SELECT id FROM salesman_commission_payments WHERE payment_number = ?')
      .get(`CMP-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `CMP-2026-${String(seq).padStart(4, '0')}`;
}

// ============================================================================
// 1. SALESMAN MANAGEMENT
// ============================================================================

/**
 * GET /api/staff/salesmen
 * List all salesmen with live performance summary & synchronized territory counts
 */
staffRouter.get('/salesmen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { status, q } = req.query;

    let whereSql = ' WHERE 1=1 ';
    const params: Array<string | number> = [];

    if (status && status !== 'All') {
      whereSql += ' AND sm.status = ? ';
      params.push(String(status));
    }

    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      whereSql +=
        ' AND (sm.salesman_code LIKE ? OR sm.name LIKE ? OR sm.full_name LIKE ? OR sm.mobile LIKE ? OR sm.phone LIKE ? OR sm.address LIKE ? OR sm.assigned_area LIKE ?) ';
      params.push(term, term, term, term, term, term, term);
    }

    const rows = db
      .prepare(`
        SELECT
          sm.*,
          COALESCE(NULLIF(TRIM(sm.name), ''), NULLIF(TRIM(sm.full_name), ''), '') as display_name,
          COALESCE(NULLIF(TRIM(sm.mobile), ''), NULLIF(TRIM(sm.phone), ''), '') as display_mobile,
          (
            SELECT COUNT(*)
            FROM salesman_towns st
            WHERE st.salesman_id = sm.id
          ) as assigned_towns_count,
          (
            SELECT COUNT(*)
            FROM salesman_areas sa
            WHERE sa.salesman_id = sm.id
          ) as assigned_areas_count,
          (
            SELECT COUNT(*)
            FROM salesman_parties sp
            WHERE sp.salesman_id = sm.id
          ) as assigned_parties_count,
          (
            SELECT COUNT(*)
            FROM sales s
            WHERE s.status = 'completed'
              AND (s.salesman_id = sm.id OR (s.salesman_id IS NULL AND (LOWER(s.salesman) = LOWER(sm.name) OR LOWER(s.salesman) = LOWER(sm.full_name))))
          ) as completed_invoices_count,
          (
            SELECT COALESCE(SUM(s.net_total), 0)
            FROM sales s
            WHERE s.status = 'completed'
              AND (s.salesman_id = sm.id OR (s.salesman_id IS NULL AND (LOWER(s.salesman) = LOWER(sm.name) OR LOWER(s.salesman) = LOWER(sm.full_name))))
          ) as total_net_sales,
          (
            SELECT COALESCE(SUM(scp.amount), 0)
            FROM salesman_commission_payments scp
            WHERE scp.salesman_id = sm.id
          ) as total_commission_paid
        FROM salesmen sm
        ${whereSql}
        ORDER BY CASE WHEN sm.status = 'Active' THEN 0 ELSE 1 END, sm.salesman_code ASC
      `)
      .all(...params) as Array<Record<string, unknown>>;

    const enriched = rows.map((r) => {
      const count = Number(r.completed_invoices_count || 0);
      const netSales = round2(Number(r.total_net_sales || 0));
      const commType = String(r.commission_type || 'Percentage');
      const commRate = round2(Number(r.commission_rate || 0));
      const commEarned =
        commType === 'Fixed Amount'
          ? round2(count * commRate)
          : round2((netSales * commRate) / 100);
      const commPaid = round2(Number(r.total_commission_paid || 0));
      const commOutstanding = round2(commEarned - commPaid);
      const resolvedName = String(r.display_name || r.name || r.full_name || '').trim();
      const resolvedMobile = String(r.display_mobile || r.mobile || r.phone || '').trim();

      return {
        ...r,
        name: resolvedName,
        full_name: resolvedName,
        mobile: resolvedMobile,
        phone: resolvedMobile,
        completed_invoices_count: count,
        total_net_sales: netSales,
        total_commission_earned: commEarned,
        total_commission_paid: commPaid,
        commission_outstanding: commOutstanding,
      };
    });

    res.json({
      success: true,
      nextSalesmanCode: getNextSalesmanCode(),
      data: enriched,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/staff/salesmen
 * Create a new Salesman with monotonic read-only SAL-### number
 */
staffRouter.post('/salesmen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const name = String(body.name || body.full_name || body.salesman_name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Salesman Name is required.' });
    }

    const mobile = String(body.mobile || body.phone || body.mobile_number || '').trim();
    const address = String(body.address || '').trim();
    const joiningDate = String(body.joining_date || new Date().toISOString().slice(0, 10)).trim();
    const commissionType =
      body.commission_type === 'Fixed Amount' ? 'Fixed Amount' : 'Percentage';
    const commissionRate = round2(Math.max(0, Number(body.commission_rate || 0)));
    const commissionPercent =
      commissionType === 'Percentage'
        ? commissionRate
        : round2(Math.max(0, Number(body.commission_percent || 0)));
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = String(body.notes || '').trim();

    const created = db.transaction(() => {
      // Strictly automatic & monotonic; ignores any client-supplied salesman_code
      const code = allocateNextSalesmanCode(db);
      const username = String(body.username || code.toLowerCase()).trim();
      const plainPassword = String(body.password || '123456').trim();
      const { salt, hash } = hashPassword(plainPassword);
      const passwordHash = `${salt}:${hash}`;

      const result = db
        .prepare(`
          INSERT INTO salesmen (
            salesman_code, name, full_name, mobile, phone, address, joining_date,
            commission_type, commission_rate, commission_percent,
            username, password_hash, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          code,
          name,
          name,
          mobile,
          mobile,
          address,
          joiningDate,
          commissionType,
          commissionRate,
          commissionPercent,
          username,
          passwordHash,
          status,
          notes
        );

      return db.prepare('SELECT * FROM salesmen WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    })();

    return res.status(201).json({
      success: true,
      message: `Salesman "${name}" (${created.salesman_code}) created successfully.`,
      nextSalesmanCode: getNextSalesmanCode(),
      data: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/staff/salesmen/:id
 * Update Salesman profile & commission rules (Salesman Number is immutable & read-only)
 */
staffRouter.put('/salesmen/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Salesman not found.' });
    }

    const body = req.body || {};
    // Preserve existing salesman_code — never editable once generated
    const immutableCode = String(existing.salesman_code);
    const name =
      body.name !== undefined || body.full_name !== undefined || body.salesman_name !== undefined
        ? String(body.name ?? body.full_name ?? body.salesman_name ?? '').trim()
        : String(existing.name || existing.full_name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Salesman Name cannot be empty.' });
    }

    const mobile =
      body.mobile !== undefined || body.phone !== undefined
        ? String(body.mobile ?? body.phone ?? '').trim()
        : String(existing.mobile || existing.phone || '');
    const address = body.address !== undefined ? String(body.address).trim() : String(existing.address || '');
    const joiningDate =
      body.joining_date !== undefined ? String(body.joining_date).trim() : String(existing.joining_date || '');
    const commissionType =
      body.commission_type !== undefined
        ? body.commission_type === 'Fixed Amount'
          ? 'Fixed Amount'
          : 'Percentage'
        : String(existing.commission_type || 'Percentage');
    const commissionRate =
      body.commission_rate !== undefined
        ? round2(Math.max(0, Number(body.commission_rate)))
        : round2(Number(existing.commission_rate || 0));
    const commissionPercent =
      commissionType === 'Percentage'
        ? commissionRate
        : round2(Number(existing.commission_percent || 0));
    const status =
      body.status !== undefined
        ? body.status === 'Inactive'
          ? 'Inactive'
          : 'Active'
        : String(existing.status || 'Active');
    const notes = body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || '');

    db.transaction(() => {
      db.prepare(`
        UPDATE salesmen
        SET salesman_code = ?,
            name = ?,
            full_name = ?,
            mobile = ?,
            phone = ?,
            address = ?,
            joining_date = ?,
            commission_type = ?,
            commission_rate = ?,
            commission_percent = ?,
            status = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        immutableCode,
        name,
        name,
        mobile,
        mobile,
        address,
        joiningDate,
        commissionType,
        commissionRate,
        commissionPercent,
        status,
        notes,
        id
      );

      syncSalesmanDenormalizedReferences(db, id, name);
    })();

    const updated = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    return res.json({
      success: true,
      message: `Salesman "${name}" (${immutableCode}) updated successfully.`,
      data: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/staff/salesmen/:id/status
 * Activate / Deactivate Salesman
 */
staffRouter.patch('/salesmen/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Salesman not found.' });
    }
    const nextStatus = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
    db.prepare('UPDATE salesmen SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, id);
    const updated = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    return res.json({
      success: true,
      message: `Salesman "${existing.name || existing.full_name}" marked as ${nextStatus}.`,
      data: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/staff/salesmen/:id
 * Safe deletion only when zero linked invoices/bookings/supplies/parties exist.
 * Never resets or reuses the deleted salesman's SAL-### sequence number.
 */
staffRouter.delete('/salesmen/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Salesman not found.' });
    }

    const linked = getSalesmanLinkedRecordCount(db, id);
    if (linked.total > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete Salesman "${existing.name || existing.full_name}" (${existing.salesman_code}) because ${linked.total} linked record(s) exist. Please mark as Inactive instead.`,
      });
    }

    db.prepare('DELETE FROM salesmen WHERE id = ?').run(id);
    return res.json({
      success: true,
      message: `Salesman "${existing.name || existing.full_name}" (${existing.salesman_code}) deleted. Sequence number will not be reused.`,
      nextSalesmanCode: getNextSalesmanCode(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * POST /api/staff/salesmen/:id/pay-commission
 * Record a commission payment to a salesman
 */
staffRouter.post('/salesmen/:id/pay-commission', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const salesmanId = Number(req.params.id);
    const sm = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(salesmanId) as Record<string, unknown> | undefined;
    if (!sm) {
      return res.status(404).json({ success: false, error: 'Salesman not found.' });
    }

    const body = req.body || {};
    const amountPaid = round2(Number(body.amount_paid || 0));
    if (amountPaid <= 0) {
      return res.status(400).json({ success: false, error: 'Commission payment amount must be greater than 0.' });
    }

    const paymentNumber = String(body.payment_number || '').trim() || getNextCommissionPaymentNumber();
    const paymentDate = String(body.payment_date || new Date().toISOString().slice(0, 10)).trim();
    const periodStart = body.period_start ? String(body.period_start).trim() : null;
    const periodEnd = body.period_end ? String(body.period_end).trim() : null;
    const paymentMode = ['Cash', 'Bank', 'Cheque', 'Online'].includes(String(body.payment_mode))
      ? String(body.payment_mode)
      : 'Cash';
    const referenceNo = String(body.reference_no || '').trim();
    const notes = String(body.notes || '').trim();
    const paidBy = req.user?.username || 'Super Admin';

    const result = db
      .prepare(`
        INSERT INTO salesman_commission_payments (
          payment_number, payment_date, salesman_id, reference_period,
          amount, payment_mode, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        paymentNumber,
        paymentDate,
        salesmanId,
        referenceNo || 'Current Settlement',
        amountPaid,
        paymentMode,
        notes,
        paidBy
      );

    const created = db
      .prepare('SELECT * FROM salesman_commission_payments WHERE id = ?')
      .get(Number(result.lastInsertRowid));

    return res.status(201).json({
      success: true,
      message: `Commission payment ${paymentNumber} of Rs. ${amountPaid.toLocaleString()} recorded for ${sm.name}.`,
      data: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/staff/salesmen/reports/:reportType
 * Supports:
 * 1) daily-sales
 * 2) monthly-performance
 * 3) customer-sales
 * 4) profit
 * 5) commission
 * 6) commission-outstanding
 */
staffRouter.get('/salesmen/reports/:reportType', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const reportType = String(req.params.reportType || 'daily-sales').toLowerCase();
    const salesmanId = req.query.salesmanId && req.query.salesmanId !== 'All' ? Number(req.query.salesmanId) : 0;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : '';
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : '';

    let saleFilter = " WHERE s.status = 'completed' ";
    const params: Array<string | number> = [];

    if (salesmanId > 0) {
      saleFilter += ' AND s.salesman_id = ? ';
      params.push(salesmanId);
    }
    if (startDate) {
      saleFilter += ' AND s.invoice_date >= ? ';
      params.push(startDate);
    }
    if (endDate) {
      saleFilter += ' AND s.invoice_date <= ? ';
      params.push(endDate);
    }

    if (reportType === 'daily-sales') {
      const rows = db
        .prepare(`
          SELECT
            s.invoice_date as sale_date,
            COALESCE(sm.id, 0) as salesman_id,
            COALESCE(sm.salesman_code, 'SM-UNASSIGNED') as salesman_code,
            COALESCE(sm.name, s.salesman, 'Counter Pharmacist') as salesman_name,
            COUNT(s.id) as invoice_count,
            COALESCE(SUM((SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)), 0) as total_line_items,
            ROUND(COALESCE(SUM(s.gross_total), 0), 2) as gross_sales,
            ROUND(COALESCE(SUM(s.discount_amount), 0), 2) as discount_amount,
            ROUND(COALESCE(SUM(s.tax_amount), 0), 2) as tax_amount,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as net_sales,
            ROUND(COALESCE(SUM(s.paid_amount), 0), 2) as cash_received,
            ROUND(COALESCE(SUM(s.net_total - s.paid_amount), 0), 2) as credit_amount
          FROM sales s
          LEFT JOIN salesmen sm ON sm.id = s.salesman_id OR (s.salesman_id IS NULL AND LOWER(sm.name) = LOWER(s.salesman))
          ${saleFilter}
          GROUP BY s.invoice_date, COALESCE(sm.id, s.salesman)
          ORDER BY s.invoice_date DESC, net_sales DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'monthly-performance') {
      const rows = db
        .prepare(`
          SELECT
            SUBSTR(s.invoice_date, 1, 7) as sale_month,
            COALESCE(sm.id, 0) as salesman_id,
            COALESCE(sm.salesman_code, 'SM-UNASSIGNED') as salesman_code,
            COALESCE(sm.name, s.salesman, 'Counter Pharmacist') as salesman_name,
            COUNT(s.id) as invoice_count,
            COUNT(DISTINCT s.customer_account_id) as unique_customers,
            ROUND(COALESCE(SUM(s.gross_total), 0), 2) as gross_sales,
            ROUND(COALESCE(SUM(s.discount_amount), 0), 2) as discount_amount,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as net_sales,
            ROUND(COALESCE(SUM(s.paid_amount), 0), 2) as amount_collected,
            ROUND(COALESCE(SUM(s.net_total - s.paid_amount), 0), 2) as credit_extended
          FROM sales s
          LEFT JOIN salesmen sm ON sm.id = s.salesman_id OR (s.salesman_id IS NULL AND LOWER(sm.name) = LOWER(s.salesman))
          ${saleFilter}
          GROUP BY SUBSTR(s.invoice_date, 1, 7), COALESCE(sm.id, s.salesman)
          ORDER BY sale_month DESC, net_sales DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'customer-sales') {
      const rows = db
        .prepare(`
          SELECT
            COALESCE(sm.id, 0) as salesman_id,
            COALESCE(sm.salesman_code, 'SM-UNASSIGNED') as salesman_code,
            COALESCE(sm.name, s.salesman, 'Counter Pharmacist') as salesman_name,
            s.customer_account_id,
            COALESCE(a.account_code, 'CUS-000') as customer_code,
            s.customer_name,
            COUNT(s.id) as invoice_count,
            MAX(s.invoice_date) as last_sale_date,
            ROUND(COALESCE(SUM(s.gross_total), 0), 2) as gross_sales,
            ROUND(COALESCE(SUM(s.discount_amount), 0), 2) as discount_amount,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as net_sales,
            ROUND(COALESCE(SUM(s.paid_amount), 0), 2) as paid_amount,
            ROUND(COALESCE(SUM(s.net_total - s.paid_amount), 0), 2) as credit_amount
          FROM sales s
          LEFT JOIN salesmen sm ON sm.id = s.salesman_id OR (s.salesman_id IS NULL AND LOWER(sm.name) = LOWER(s.salesman))
          LEFT JOIN accounts a ON a.id = s.customer_account_id
          ${saleFilter}
          GROUP BY COALESCE(sm.id, s.salesman), s.customer_account_id
          ORDER BY salesman_name ASC, net_sales DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'profit') {
      const rows = db
        .prepare(`
          SELECT
            COALESCE(sm.id, 0) as salesman_id,
            COALESCE(sm.salesman_code, 'SM-UNASSIGNED') as salesman_code,
            COALESCE(sm.name, s.salesman, 'Counter Pharmacist') as salesman_name,
            COUNT(DISTINCT s.id) as invoice_count,
            ROUND(COALESCE(SUM(s.gross_total), 0), 2) as gross_sales,
            ROUND(COALESCE(SUM(s.discount_amount), 0), 2) as discount_amount,
            ROUND(COALESCE(SUM(s.taxable_amount), 0), 2) as net_revenue_ex_tax,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as net_invoice_total,
            ROUND(
              COALESCE(
                SUM((
                  SELECT COALESCE(SUM(si.total_units * si.cost_price_per_unit), 0)
                  FROM sale_items si
                  WHERE si.sale_id = s.id
                )),
                0
              ),
              2
            ) as total_cogs
          FROM sales s
          LEFT JOIN salesmen sm ON sm.id = s.salesman_id OR (s.salesman_id IS NULL AND LOWER(sm.name) = LOWER(s.salesman))
          ${saleFilter}
          GROUP BY COALESCE(sm.id, s.salesman)
          ORDER BY net_revenue_ex_tax DESC
        `)
        .all(...params) as Array<Record<string, unknown>>;

      const enriched = rows.map((r) => {
        const netRev = round2(Number(r.net_revenue_ex_tax || 0));
        const cogs = round2(Number(r.total_cogs || 0));
        const grossProfit = round2(netRev - cogs);
        const marginPct = netRev > 0 ? round2((grossProfit / netRev) * 100) : 0;
        return {
          ...r,
          gross_profit: grossProfit,
          profit_margin_percent: marginPct,
        };
      });

      return res.json({ success: true, reportType, data: enriched });
    }

    if (reportType === 'commission') {
      // Invoice-by-invoice commission calculation for eligible completed sales (never double-counted)
      const invoices = db
        .prepare(`
          SELECT
            s.id as sale_id,
            s.invoice_number,
            s.invoice_date,
            s.customer_name,
            s.invoice_type,
            s.payment_mode,
            s.gross_total,
            s.discount_amount,
            s.taxable_amount,
            s.net_total,
            sm.id as salesman_id,
            COALESCE(sm.salesman_code, 'SM-UNASSIGNED') as salesman_code,
            COALESCE(sm.name, s.salesman, 'Counter Pharmacist') as salesman_name,
            COALESCE(sm.commission_type, 'Percentage') as commission_type,
            COALESCE(sm.commission_rate, 0) as commission_rate
          FROM sales s
          LEFT JOIN salesmen sm ON sm.id = s.salesman_id OR (s.salesman_id IS NULL AND LOWER(sm.name) = LOWER(s.salesman))
          ${saleFilter}
          ORDER BY s.invoice_date DESC, s.id DESC
        `)
        .all(...params) as Array<Record<string, unknown>>;

      const data = invoices.map((inv) => {
        const commType = String(inv.commission_type || 'Percentage');
        const commRate = round2(Number(inv.commission_rate || 0));
        const netTotal = round2(Number(inv.net_total || 0));
        const commissionAmount =
          commType === 'Fixed Amount' ? commRate : round2((netTotal * commRate) / 100);
        return {
          ...inv,
          commission_amount: commissionAmount,
        };
      });

      return res.json({ success: true, reportType, data });
    }

    if (reportType === 'commission-outstanding') {
      const salesmenRows = db
        .prepare(`
          SELECT * FROM salesmen
          ${salesmanId > 0 ? 'WHERE id = ?' : ''}
          ORDER BY salesman_code ASC
        `)
        .all(...(salesmanId > 0 ? [salesmanId] : [])) as Array<Record<string, unknown>>;

      const summary = salesmenRows.map((sm) => {
        const smId = Number(sm.id);
        const smName = String(sm.name);
        const dateClauses: string[] = [];
        const dateParams: Array<string | number> = [smId, smName];
        if (startDate) {
          dateClauses.push('AND s.invoice_date >= ?');
          dateParams.push(startDate);
        }
        if (endDate) {
          dateClauses.push('AND s.invoice_date <= ?');
          dateParams.push(endDate);
        }

        const saleAgg = db
          .prepare(`
            SELECT
              COUNT(s.id) as eligible_invoices,
              COALESCE(SUM(s.net_total), 0) as eligible_sales_amount
            FROM sales s
            WHERE s.status = 'completed'
              AND (s.salesman_id = ? OR (s.salesman_id IS NULL AND LOWER(s.salesman) = LOWER(?)))
              ${dateClauses.join(' ')}
          `)
          .get(...dateParams) as { eligible_invoices: number; eligible_sales_amount: number };

        const payDateClauses: string[] = [];
        const payParams: Array<string | number> = [smId];
        if (startDate) {
          payDateClauses.push('AND scp.payment_date >= ?');
          payParams.push(startDate);
        }
        if (endDate) {
          payDateClauses.push('AND scp.payment_date <= ?');
          payParams.push(endDate);
        }

        const payAgg = db
          .prepare(`
            SELECT COALESCE(SUM(scp.amount), 0) as paid_amount
            FROM salesman_commission_payments scp
            WHERE scp.salesman_id = ?
              ${payDateClauses.join(' ')}
          `)
          .get(...payParams) as { paid_amount: number };

        const eligibleInvoices = Number(saleAgg?.eligible_invoices || 0);
        const eligibleSalesAmount = round2(Number(saleAgg?.eligible_sales_amount || 0));
        const commType = String(sm.commission_type || 'Percentage');
        const commRate = round2(Number(sm.commission_rate || 0));

        const commissionEarned =
          commType === 'Fixed Amount'
            ? round2(eligibleInvoices * commRate)
            : round2((eligibleSalesAmount * commRate) / 100);

        const commissionPaid = round2(Number(payAgg?.paid_amount || 0));
        const commissionOutstanding = round2(commissionEarned - commissionPaid);

        return {
          salesman_id: smId,
          salesman_code: sm.salesman_code,
          salesman_name: smName,
          mobile: sm.mobile,
          status: sm.status,
          commission_type: commType,
          commission_rate: commRate,
          eligible_invoices: eligibleInvoices,
          eligible_sales_amount: eligibleSalesAmount,
          commission_earned: commissionEarned,
          commission_paid: commissionPaid,
          commission_outstanding: commissionOutstanding,
        };
      });

      const payments = db
        .prepare(`
          SELECT
            scp.*,
            sm.salesman_code,
            sm.name as salesman_name
          FROM salesman_commission_payments scp
          INNER JOIN salesmen sm ON sm.id = scp.salesman_id
          ${salesmanId > 0 ? 'WHERE scp.salesman_id = ?' : ''}
          ORDER BY scp.payment_date DESC, scp.id DESC
          LIMIT 100
        `)
        .all(...(salesmanId > 0 ? [salesmanId] : []));

      return res.json({
        success: true,
        reportType,
        data: summary,
        payments,
      });
    }

    return res.status(400).json({ success: false, error: `Unknown salesman report type "${reportType}".` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

// ============================================================================
// 2. DELIVERYMAN MANAGEMENT & DELIVERY TRACKING
// ============================================================================

/**
 * GET /api/staff/deliverymen
 * List all deliverymen with live delivery metrics
 */
staffRouter.get('/deliverymen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { status, q } = req.query;

    let whereSql = ' WHERE 1=1 ';
    const params: Array<string | number> = [];

    if (status && status !== 'All') {
      whereSql += ' AND dm.status = ? ';
      params.push(String(status));
    }

    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      whereSql += ' AND (dm.deliveryman_code LIKE ? OR dm.name LIKE ? OR dm.mobile LIKE ? OR dm.address LIKE ?) ';
      params.push(term, term, term, term);
    }

    const rows = db
      .prepare(`
        SELECT
          dm.*,
          (
            SELECT COUNT(*)
            FROM sales s
            WHERE s.status = 'completed' AND s.deliveryman_id = dm.id
          ) as total_assigned_invoices,
          (
            SELECT COUNT(*)
            FROM sales s
            WHERE s.status = 'completed' AND s.deliveryman_id = dm.id AND s.delivery_status = 'Delivered'
          ) as delivered_count,
          (
            SELECT COUNT(*)
            FROM sales s
            WHERE s.status = 'completed' AND s.deliveryman_id = dm.id AND s.delivery_status IN ('Pending', 'Assigned', 'Out for Delivery')
          ) as pending_count,
          (
            SELECT COUNT(*)
            FROM sales s
            WHERE s.status = 'completed' AND s.deliveryman_id = dm.id AND s.delivery_status IN ('Failed', 'Returned')
          ) as failed_or_returned_count,
          (
            SELECT COALESCE(SUM(s.delivery_charges), 0)
            FROM sales s
            WHERE s.status = 'completed' AND s.deliveryman_id = dm.id
          ) as total_delivery_charges
        FROM deliverymen dm
        ${whereSql}
        ORDER BY CASE WHEN dm.status = 'Active' THEN 0 ELSE 1 END, dm.deliveryman_code ASC
      `)
      .all(...params);

    res.json({
      success: true,
      nextDeliverymanCode: getNextDeliverymanCode(),
      data: rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/staff/deliverymen
 * Create a new Deliveryman
 */
staffRouter.post('/deliverymen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const code = String(body.deliveryman_code || '').trim() || getNextDeliverymanCode();
    const name = String(body.name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Deliveryman Name is required.' });
    }

    const dupCode = db
      .prepare('SELECT id FROM deliverymen WHERE UPPER(deliveryman_code) = UPPER(?)')
      .get(code);
    if (dupCode) {
      return res.status(400).json({ success: false, error: `Deliveryman Code "${code}" already exists.` });
    }

    const mobile = String(body.mobile || '').trim();
    const address = String(body.address || '').trim();
    const joiningDate = String(body.joining_date || new Date().toISOString().slice(0, 10)).trim();
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = String(body.notes || '').trim();

    const result = db
      .prepare(`
        INSERT INTO deliverymen (
          deliveryman_code, name, mobile, address, joining_date, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(code, name, mobile, address, joiningDate, status, notes);

    const created = db
      .prepare('SELECT * FROM deliverymen WHERE id = ?')
      .get(Number(result.lastInsertRowid));

    return res.status(201).json({
      success: true,
      message: `Deliveryman "${name}" (${code}) created successfully.`,
      data: created,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/staff/deliverymen/:id
 * Update Deliveryman profile
 */
staffRouter.put('/deliverymen/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM deliverymen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Deliveryman not found.' });
    }

    const body = req.body || {};
    const code =
      body.deliveryman_code !== undefined ? String(body.deliveryman_code).trim() : String(existing.deliveryman_code);
    const name = body.name !== undefined ? String(body.name).trim() : String(existing.name);

    if (!name) {
      return res.status(400).json({ success: false, error: 'Deliveryman Name cannot be empty.' });
    }

    const dupCode = db
      .prepare('SELECT id FROM deliverymen WHERE UPPER(deliveryman_code) = UPPER(?) AND id != ?')
      .get(code, id);
    if (dupCode) {
      return res.status(400).json({ success: false, error: `Deliveryman Code "${code}" is already in use.` });
    }

    const mobile = body.mobile !== undefined ? String(body.mobile).trim() : String(existing.mobile || '');
    const address = body.address !== undefined ? String(body.address).trim() : String(existing.address || '');
    const joiningDate =
      body.joining_date !== undefined ? String(body.joining_date).trim() : String(existing.joining_date || '');
    const status =
      body.status !== undefined
        ? body.status === 'Inactive'
          ? 'Inactive'
          : 'Active'
        : String(existing.status || 'Active');
    const notes = body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || '');

    db.prepare(`
      UPDATE deliverymen
      SET deliveryman_code = ?,
          name = ?,
          mobile = ?,
          address = ?,
          joining_date = ?,
          status = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(code, name, mobile, address, joiningDate, status, notes, id);

    // Sync denormalized deliveryman_name on linked sales
    db.prepare('UPDATE sales SET deliveryman_name = ? WHERE deliveryman_id = ?').run(name, id);

    const updated = db.prepare('SELECT * FROM deliverymen WHERE id = ?').get(id);
    return res.json({
      success: true,
      message: `Deliveryman "${name}" updated successfully.`,
      data: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/staff/deliverymen/:id/status
 * Activate / Deactivate Deliveryman
 */
staffRouter.patch('/deliverymen/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM deliverymen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Deliveryman not found.' });
    }
    const nextStatus = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
    db.prepare('UPDATE deliverymen SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, id);
    const updated = db.prepare('SELECT * FROM deliverymen WHERE id = ?').get(id);
    return res.json({
      success: true,
      message: `Deliveryman "${existing.name}" marked as ${nextStatus}.`,
      data: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/staff/deliveries
 * List sales invoices for Delivery Management with filters & status KPIs
 */
staffRouter.get('/deliveries', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { deliveryStatus, deliverymanId, salesmanId, startDate, endDate, q } = req.query;

    let whereSql = " WHERE s.status = 'completed' ";
    const params: Array<string | number> = [];

    if (deliveryStatus && deliveryStatus !== 'All') {
      whereSql += ' AND COALESCE(s.delivery_status, \'Pending\') = ? ';
      params.push(String(deliveryStatus));
    }

    if (deliverymanId && deliverymanId !== 'All') {
      if (deliverymanId === 'Unassigned') {
        whereSql += ' AND s.deliveryman_id IS NULL ';
      } else {
        whereSql += ' AND s.deliveryman_id = ? ';
        params.push(Number(deliverymanId));
      }
    }

    if (salesmanId && salesmanId !== 'All') {
      whereSql += ' AND s.salesman_id = ? ';
      params.push(Number(salesmanId));
    }

    if (startDate) {
      whereSql += ' AND s.invoice_date >= ? ';
      params.push(String(startDate));
    }

    if (endDate) {
      whereSql += ' AND s.invoice_date <= ? ';
      params.push(String(endDate));
    }

    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      whereSql += ` AND (
        s.invoice_number LIKE ?
        OR s.customer_name LIKE ?
        OR s.deliveryman_name LIKE ?
        OR s.salesman LIKE ?
        OR s.delivery_notes LIKE ?
        OR a.phone LIKE ?
        OR a.address LIKE ?
      ) `;
      params.push(term, term, term, term, term, term, term);
    }

    const rows = db
      .prepare(`
        SELECT
          s.id,
          s.invoice_number,
          s.invoice_date,
          s.customer_account_id,
          s.customer_name,
          a.account_code as customer_code,
          a.phone as customer_phone,
          a.address as customer_address,
          a.city as customer_city,
          s.salesman_id,
          s.salesman,
          s.deliveryman_id,
          s.deliveryman_name,
          dm.deliveryman_code,
          dm.mobile as deliveryman_mobile,
          COALESCE(s.delivery_status, 'Pending') as delivery_status,
          s.delivery_date,
          s.delivery_time,
          s.delivery_notes,
          COALESCE(s.delivery_charges, 0) as delivery_charges,
          s.delivery_completed_by,
          s.delivery_completed_at,
          s.invoice_type,
          s.payment_mode,
          s.net_total,
          s.paid_amount,
          s.balance_amount,
          (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
        FROM sales s
        LEFT JOIN accounts a ON a.id = s.customer_account_id
        LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
        ${whereSql}
        ORDER BY s.invoice_date DESC, s.id DESC
        LIMIT 250
      `)
      .all(...params);

    const summary = db
      .prepare(`
        SELECT
          COUNT(*) as total_invoices,
          SUM(CASE WHEN COALESCE(delivery_status, 'Pending') = 'Pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN delivery_status = 'Assigned' THEN 1 ELSE 0 END) as assigned_count,
          SUM(CASE WHEN delivery_status = 'Out for Delivery' THEN 1 ELSE 0 END) as out_for_delivery_count,
          SUM(CASE WHEN delivery_status = 'Delivered' THEN 1 ELSE 0 END) as delivered_count,
          SUM(CASE WHEN delivery_status = 'Failed' THEN 1 ELSE 0 END) as failed_count,
          SUM(CASE WHEN delivery_status = 'Returned' THEN 1 ELSE 0 END) as returned_count,
          ROUND(COALESCE(SUM(delivery_charges), 0), 2) as total_delivery_charges
        FROM sales
        WHERE status = 'completed'
      `)
      .get();

    return res.json({
      success: true,
      summary,
      data: rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/staff/deliveries/:saleId
 * Update deliveryman assignment, delivery status, delivery date/time/notes/charges, or salesman assignment
 * CRITICAL: Never alters invoice amounts (gross_total, net_total, paid_amount, balance_amount) or creates/edits journal entries!
 */
staffRouter.patch('/deliveries/:saleId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const saleId = Number(req.params.saleId);
    const existing = db
      .prepare('SELECT * FROM sales WHERE id = ?')
      .get(saleId) as Record<string, unknown> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Sales invoice not found.' });
    }

    const body = req.body || {};

    // Salesman assignment (optional update)
    let salesmanId: number | null =
      body.salesman_id !== undefined
        ? body.salesman_id
          ? Number(body.salesman_id)
          : null
        : existing.salesman_id
        ? Number(existing.salesman_id)
        : null;
    let salesman =
      body.salesman !== undefined ? String(body.salesman).trim() : String(existing.salesman || 'Counter Pharmacist');

    if (salesmanId) {
      const smRow = db
        .prepare('SELECT id, name FROM salesmen WHERE id = ?')
        .get(salesmanId) as { id: number; name: string } | undefined;
      if (smRow) salesman = smRow.name;
    }

    // Deliveryman assignment
    let deliverymanId: number | null =
      body.deliveryman_id !== undefined
        ? body.deliveryman_id
          ? Number(body.deliveryman_id)
          : null
        : existing.deliveryman_id
        ? Number(existing.deliveryman_id)
        : null;
    let deliverymanName: string | null =
      body.deliveryman_name !== undefined
        ? body.deliveryman_name
          ? String(body.deliveryman_name).trim()
          : null
        : existing.deliveryman_name
        ? String(existing.deliveryman_name)
        : null;

    if (deliverymanId) {
      const dmRow = db
        .prepare('SELECT id, name FROM deliverymen WHERE id = ?')
        .get(deliverymanId) as { id: number; name: string } | undefined;
      if (dmRow) {
        deliverymanName = dmRow.name;
      } else {
        deliverymanId = null;
        deliverymanName = null;
      }
    } else if (body.deliveryman_id === null || body.deliveryman_id === '') {
      deliverymanId = null;
      deliverymanName = null;
    }

    const validStatuses = ['Pending', 'Assigned', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];
    const deliveryStatus =
      body.delivery_status && validStatuses.includes(String(body.delivery_status))
        ? String(body.delivery_status)
        : String(existing.delivery_status || 'Pending');

    const deliveryDate =
      body.delivery_date !== undefined
        ? body.delivery_date
          ? String(body.delivery_date).trim()
          : null
        : existing.delivery_date
        ? String(existing.delivery_date)
        : deliveryStatus === 'Delivered'
        ? new Date().toISOString().slice(0, 10)
        : null;

    const deliveryTime =
      body.delivery_time !== undefined
        ? body.delivery_time
          ? String(body.delivery_time).trim()
          : null
        : existing.delivery_time
        ? String(existing.delivery_time)
        : deliveryStatus === 'Delivered'
        ? new Date().toTimeString().slice(0, 5)
        : null;

    const deliveryNotes =
      body.delivery_notes !== undefined
        ? body.delivery_notes
          ? String(body.delivery_notes).trim()
          : null
        : existing.delivery_notes
        ? String(existing.delivery_notes)
        : null;

    const deliveryCharges =
      body.delivery_charges !== undefined
        ? round2(Math.max(0, Number(body.delivery_charges)))
        : round2(Number(existing.delivery_charges || 0));

    const username = req.user?.username || 'Super Admin';
    const deliveryCompletedBy =
      deliveryStatus === 'Delivered'
        ? String(body.delivery_completed_by || existing.delivery_completed_by || username)
        : null;
    const deliveryCompletedAt =
      deliveryStatus === 'Delivered'
        ? String(existing.delivery_completed_at || new Date().toISOString())
        : null;

    db.prepare(`
      UPDATE sales
      SET salesman_id = ?,
          salesman = ?,
          deliveryman_id = ?,
          deliveryman_name = ?,
          delivery_status = ?,
          delivery_date = ?,
          delivery_time = ?,
          delivery_notes = ?,
          delivery_charges = ?,
          delivery_completed_by = ?,
          delivery_completed_at = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      salesmanId,
      salesman,
      deliverymanId,
      deliverymanName,
      deliveryStatus,
      deliveryDate,
      deliveryTime,
      deliveryNotes,
      deliveryCharges,
      deliveryCompletedBy,
      deliveryCompletedAt,
      username,
      saleId
    );

    const updated = db
      .prepare('SELECT * FROM sales WHERE id = ?')
      .get(saleId);

    return res.json({
      success: true,
      message: `Delivery tracking updated for Invoice ${existing.invoice_number} (Status: ${deliveryStatus}).`,
      data: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/staff/deliveries/reports/:reportType
 * Supports:
 * 1) daily-deliveries
 * 2) monthly-deliveries
 * 3) pending-deliveries
 * 4) failed-deliveries
 * 5) delivery-charges
 */
staffRouter.get('/deliveries/reports/:reportType', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const reportType = String(req.params.reportType || 'daily-deliveries').toLowerCase();
    const deliverymanId =
      req.query.deliverymanId && req.query.deliverymanId !== 'All' ? Number(req.query.deliverymanId) : 0;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : '';
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : '';

    let filterSql = " WHERE s.status = 'completed' ";
    const params: Array<string | number> = [];

    if (deliverymanId > 0) {
      filterSql += ' AND s.deliveryman_id = ? ';
      params.push(deliverymanId);
    }
    if (startDate) {
      filterSql += ' AND COALESCE(s.delivery_date, s.invoice_date) >= ? ';
      params.push(startDate);
    }
    if (endDate) {
      filterSql += ' AND COALESCE(s.delivery_date, s.invoice_date) <= ? ';
      params.push(endDate);
    }

    if (reportType === 'daily-deliveries') {
      const rows = db
        .prepare(`
          SELECT
            COALESCE(s.delivery_date, s.invoice_date) as report_date,
            COALESCE(dm.id, 0) as deliveryman_id,
            COALESCE(dm.deliveryman_code, 'DM-UNASSIGNED') as deliveryman_code,
            COALESCE(dm.name, s.deliveryman_name, 'Unassigned / Counter Pickup') as deliveryman_name,
            COUNT(s.id) as total_invoices,
            SUM(CASE WHEN s.delivery_status = 'Delivered' THEN 1 ELSE 0 END) as delivered_count,
            SUM(CASE WHEN s.delivery_status = 'Out for Delivery' THEN 1 ELSE 0 END) as out_for_delivery_count,
            SUM(CASE WHEN COALESCE(s.delivery_status, 'Pending') IN ('Pending', 'Assigned') THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN s.delivery_status IN ('Failed', 'Returned') THEN 1 ELSE 0 END) as failed_or_returned_count,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as total_invoice_value,
            ROUND(COALESCE(SUM(s.delivery_charges), 0), 2) as total_delivery_charges
          FROM sales s
          LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
          ${filterSql}
          GROUP BY COALESCE(s.delivery_date, s.invoice_date), COALESCE(dm.id, s.deliveryman_name)
          ORDER BY report_date DESC, total_invoices DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'monthly-deliveries') {
      const rows = db
        .prepare(`
          SELECT
            SUBSTR(COALESCE(s.delivery_date, s.invoice_date), 1, 7) as report_month,
            COALESCE(dm.id, 0) as deliveryman_id,
            COALESCE(dm.deliveryman_code, 'DM-UNASSIGNED') as deliveryman_code,
            COALESCE(dm.name, s.deliveryman_name, 'Unassigned / Counter Pickup') as deliveryman_name,
            COUNT(s.id) as total_invoices,
            SUM(CASE WHEN s.delivery_status = 'Delivered' THEN 1 ELSE 0 END) as delivered_count,
            SUM(CASE WHEN COALESCE(s.delivery_status, 'Pending') IN ('Pending', 'Assigned', 'Out for Delivery') THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN s.delivery_status = 'Failed' THEN 1 ELSE 0 END) as failed_count,
            SUM(CASE WHEN s.delivery_status = 'Returned' THEN 1 ELSE 0 END) as returned_count,
            ROUND(COALESCE(SUM(s.net_total), 0), 2) as total_invoice_value,
            ROUND(COALESCE(SUM(s.delivery_charges), 0), 2) as total_delivery_charges
          FROM sales s
          LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
          ${filterSql}
          GROUP BY SUBSTR(COALESCE(s.delivery_date, s.invoice_date), 1, 7), COALESCE(dm.id, s.deliveryman_name)
          ORDER BY report_month DESC, total_invoices DESC
        `)
        .all(...params) as Array<Record<string, unknown>>;

      const enriched = rows.map((r) => {
        const total = Number(r.total_invoices || 0);
        const delivered = Number(r.delivered_count || 0);
        const successRate = total > 0 ? round2((delivered / total) * 100) : 0;
        return {
          ...r,
          success_rate_percent: successRate,
        };
      });

      return res.json({ success: true, reportType, data: enriched });
    }

    if (reportType === 'pending-deliveries') {
      const rows = db
        .prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.invoice_date,
            s.customer_name,
            a.phone as customer_phone,
            a.address as customer_address,
            a.city as customer_city,
            s.salesman,
            s.deliveryman_id,
            COALESCE(dm.deliveryman_code, '') as deliveryman_code,
            COALESCE(s.deliveryman_name, 'Unassigned') as deliveryman_name,
            COALESCE(s.delivery_status, 'Pending') as delivery_status,
            s.delivery_date,
            s.delivery_time,
            s.delivery_notes,
            COALESCE(s.delivery_charges, 0) as delivery_charges,
            s.net_total,
            s.balance_amount
          FROM sales s
          LEFT JOIN accounts a ON a.id = s.customer_account_id
          LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
          ${filterSql}
            AND COALESCE(s.delivery_status, 'Pending') IN ('Pending', 'Assigned', 'Out for Delivery')
          ORDER BY s.invoice_date ASC, s.id ASC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'failed-deliveries') {
      const rows = db
        .prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.invoice_date,
            s.customer_name,
            a.phone as customer_phone,
            a.address as customer_address,
            s.salesman,
            s.deliveryman_id,
            COALESCE(dm.deliveryman_code, '') as deliveryman_code,
            COALESCE(s.deliveryman_name, 'Unassigned') as deliveryman_name,
            s.delivery_status,
            s.delivery_date,
            s.delivery_time,
            s.delivery_notes,
            COALESCE(s.delivery_charges, 0) as delivery_charges,
            s.net_total,
            s.balance_amount
          FROM sales s
          LEFT JOIN accounts a ON a.id = s.customer_account_id
          LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
          ${filterSql}
            AND s.delivery_status IN ('Failed', 'Returned')
          ORDER BY s.invoice_date DESC, s.id DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    if (reportType === 'delivery-charges') {
      const rows = db
        .prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.invoice_date,
            s.customer_name,
            s.salesman,
            s.deliveryman_id,
            COALESCE(dm.deliveryman_code, '') as deliveryman_code,
            COALESCE(s.deliveryman_name, 'Unassigned') as deliveryman_name,
            COALESCE(s.delivery_status, 'Pending') as delivery_status,
            s.delivery_date,
            s.delivery_time,
            s.delivery_notes,
            COALESCE(s.delivery_charges, 0) as delivery_charges,
            s.net_total,
            s.delivery_completed_by
          FROM sales s
          LEFT JOIN deliverymen dm ON dm.id = s.deliveryman_id
          ${filterSql}
            AND (COALESCE(s.delivery_charges, 0) > 0 OR s.deliveryman_id IS NOT NULL)
          ORDER BY s.invoice_date DESC, s.id DESC
        `)
        .all(...params);

      return res.json({ success: true, reportType, data: rows });
    }

    return res.status(400).json({ success: false, error: `Unknown delivery report type "${reportType}".` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});
