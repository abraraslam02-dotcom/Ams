import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { round2, parsePacking } from './purchases.ts';
import {
  allocateNextInvoiceNumber,
  bindInvoiceNumberRecordId,
} from '../services/invoiceSequenceService.ts';
import { logAuditEvent, hashPassword } from '../services/authService.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';
import { recordBatchStockMovement } from '../services/fifoAndOfferEngine.ts';
import {
  allocateNextSalesmanCode,
  peekNextSalesmanCode,
  syncSalesmanDenormalizedReferences,
  refreshSalesmanPartiesJson,
  getSalesmanLinkedRecordCount,
} from '../utils/salesmanCodeGenerator.ts';

export const supplyRouter = Router();

function getSystemAccountId(accountCode: string): number {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM accounts WHERE account_code = ?')
    .get(accountCode) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Required Chart of Accounts head "${accountCode}" is missing.`);
  }
  return row.id;
}

function computeBatchStatus(packQty: number, expiryDate: string, minStock: number = 0): string {
  if (packQty <= 0) return 'out_of_stock';
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate && expiryDate < today) return 'expired';
  if (minStock > 0 && packQty <= minStock) return 'low_stock';
  return 'in_stock';
}

function getNextSeqNumber(table: string, col: string, prefix: string): string {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const fullPrefix = `${prefix}-${year}-`;
  const row = db
    .prepare(`SELECT ${col} as val FROM ${table} WHERE ${col} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${fullPrefix}%`) as { val: string } | undefined;
  let seq = 1;
  if (row?.val) {
    const match = row.val.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  while (
    db
      .prepare(`SELECT id FROM ${table} WHERE ${col} = ?`)
      .get(`${fullPrefix}${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `${fullPrefix}${String(seq).padStart(4, '0')}`;
}

function getNextJournalNumber(prefix: string): string {
  const db = getDatabase();
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM journal_entries').get() as { cnt: number };
  let seq = (countRow?.cnt || 0) + 1;
  while (
    db
      .prepare('SELECT id FROM journal_entries WHERE entry_number = ?')
      .get(`${prefix}-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `${prefix}-2026-${String(seq).padStart(4, '0')}`;
}

function getNextVoucherNumber(): string {
  const db = getDatabase();
  const row = db
    .prepare("SELECT voucher_number FROM payment_vouchers WHERE voucher_number LIKE 'VCH-2026-%' ORDER BY id DESC LIMIT 1")
    .get() as { voucher_number: string } | undefined;
  let seq = 1;
  if (row?.voucher_number) {
    const match = row.voucher_number.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  while (
    db.prepare('SELECT id FROM payment_vouchers WHERE voucher_number = ?').get(`VCH-2026-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `VCH-2026-${String(seq).padStart(4, '0')}`;
}

function allocateContinuousCashBookVoucherNo(db: any): {
  nextSequence: number;
  nextVoucherNumber: string;
} {
  const curMaxVoucher = Number(
    (
      db.prepare('SELECT COALESCE(MAX(sequence_number), 0) as m FROM cash_book_vouchers').get() as {
        m: number;
      }
    )?.m || 0
  );

  let seqRow = db
    .prepare("SELECT last_sequence FROM cash_book_sequences WHERE sequence_key = 'voucher_continuous'")
    .get() as { last_sequence: number } | undefined;

  if (!seqRow) {
    db.prepare(`
      INSERT INTO cash_book_sequences (sequence_key, last_sequence, updated_at)
      VALUES ('voucher_continuous', ?, CURRENT_TIMESTAMP)
    `).run(curMaxVoucher);
    seqRow = { last_sequence: curMaxVoucher };
  }

  const baseSeq = Math.max(Number(seqRow.last_sequence || 0), curMaxVoucher);
  let nextSeq = baseSeq + 1;
  let formattedNo = String(nextSeq).padStart(3, '0');

  while (
    db
      .prepare('SELECT id FROM cash_book_vouchers WHERE voucher_number = ? OR sequence_number = ?')
      .get(formattedNo, nextSeq)
  ) {
    nextSeq++;
    formattedNo = String(nextSeq).padStart(3, '0');
  }

  db.prepare(`
    UPDATE cash_book_sequences
    SET last_sequence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE sequence_key = 'voucher_continuous'
  `).run(nextSeq);

  return { nextSequence: nextSeq, nextVoucherNumber: formattedNo };
}

function recordAudit(req: Request, action: string, details: string) {
  try {
    const authReq = req as AuthenticatedRequest;
    const db = getDatabase();
    logAuditEvent(db, {
      userId: authReq.user?.id || null,
      username: authReq.user?.username || 'system',
      action,
      status: 'SUCCESS',
      ipAddress: req.socket.remoteAddress || '127.0.0.1',
      userAgent: String(req.headers['user-agent'] || 'System'),
      details,
    });
  } catch {
    // Non-blocking audit log
  }
}

/**
 * Helper to get available stock packs & units for an item
 */
function getItemStockSummary(itemId: number): {
  availablePacks: number;
  availableUnits: number;
  reservedPacks: number;
  damagedPacks: number;
  netPackablePacks: number;
  defaultBatchNumber: string;
  defaultExpiryDate: string;
  defaultInventoryId: number | null;
} {
  const db = getDatabase();
  const itemRow = db
    .prepare('SELECT id, item_code, packing FROM items WHERE id = ?')
    .get(itemId) as { id: number; item_code: string; packing: string } | undefined;
  const parsed = parsePacking(String(itemRow?.packing || '1x1'));
  const batches = db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE item_id = ?
      ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, expiry_date ASC, id ASC
    `)
    .all(itemId) as Array<Record<string, unknown>>;

  const totalUnits = batches.reduce((sum, b) => sum + Number(b.total_stock_units || 0), 0);
  const availablePacks = round2(totalUnits / parsed.unitsPerPack);
  const reservedPacks = round2(batches.reduce((sum, b) => sum + Number(b.reserved_pack_qty || 0), 0));
  const damagedPacks = round2(batches.reduce((sum, b) => sum + Number(b.damaged_pack_qty || 0), 0));
  const netPackablePacks = round2(Math.max(0, availablePacks - reservedPacks));

  const firstBatch = batches[0];
  return {
    availablePacks,
    availableUnits: round2(totalUnits),
    reservedPacks,
    damagedPacks,
    netPackablePacks,
    defaultBatchNumber: firstBatch
      ? String(firstBatch.batch_number)
      : `BATCH-${String(itemRow?.item_code || itemId)}-01`,
    defaultExpiryDate: firstBatch ? String(firstBatch.expiry_date) : '2028-12-31',
    defaultInventoryId: firstBatch ? Number(firstBatch.id) : null,
  };
}

// ============================================================================
// 0. NEXT SEQUENCE NUMBERS & SUPPLY DASHBOARD
// ============================================================================

supplyRouter.get('/next-numbers', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    res.json({
      success: true,
      nextSalesmanCode: peekNextSalesmanCode(db),
      nextOrderNumber: getNextSeqNumber('supply_order_forms', 'order_number', 'ORD'),
      nextBookingNumber: getNextSeqNumber('supply_bookings', 'booking_number', 'BKG'),
      nextSupplyNumber: getNextSeqNumber('town_supplies', 'supply_number', 'SUP'),
      nextDispatchNumber: getNextSeqNumber('supply_dispatches', 'dispatch_number', 'DSP'),
      nextReturnNumber: getNextSeqNumber('supply_returns', 'return_number', 'SRT'),
      nextRecoveryNumber: getNextSeqNumber('supply_recoveries', 'recovery_receipt_number', 'REC'),
      nextSettlementNumber: getNextSeqNumber('salesman_settlements', 'settlement_number', 'STL'),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.get('/dashboard', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const today = String(req.query.date || new Date().toISOString().slice(0, 10));

    const todayOrderForms = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM supply_order_forms WHERE order_date = ? AND status != 'Cancelled'"
      )
      .get(today) as { count: number; amount: number };

    const todayBookings = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM supply_bookings WHERE booking_date = ? AND status != 'Cancelled'"
      )
      .get(today) as { count: number; amount: number };

    const todaySupplies = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_supply_amount), 0) as amount FROM town_supplies WHERE supply_date = ? AND supply_status != 'Cancelled'"
      )
      .get(today) as { count: number; amount: number };

    const pendingPacking = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_supply_amount), 0) as amount FROM town_supplies WHERE supply_status = 'Packing Pending'"
      )
      .get() as { count: number; amount: number };

    const readyForDispatch = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_supply_amount), 0) as amount FROM town_supplies WHERE supply_status = 'Ready for Dispatch'"
      )
      .get() as { count: number; amount: number };

    const dispatchedSupplies = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_supply_amount), 0) as amount FROM town_supplies WHERE supply_status IN ('Dispatched', 'Partially Returned', 'Return Pending')"
      )
      .get() as { count: number; amount: number };

    const pendingReturns = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(total_supply_amount), 0) as amount FROM town_supplies WHERE supply_status IN ('Dispatched', 'Return Pending')"
      )
      .get() as { count: number; amount: number };

    const pendingBilling = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(net_billable_amount - total_billed_amount), 0) as amount FROM town_supplies WHERE supply_status IN ('Dispatched', 'Partially Returned', 'Partially Billed') AND (net_billable_amount - total_billed_amount) > 0.01"
      )
      .get() as { count: number; amount: number };

    const todayFinalSales = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(net_total), 0) as amount FROM sales WHERE invoice_date = ? AND status = 'completed' AND town_supply_id IS NOT NULL"
      )
      .get(today) as { count: number; amount: number };

    const todayRecovery = db
      .prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(recovery_amount), 0) as amount FROM supply_recoveries WHERE recovery_date = ? AND status = 'Posted'"
      )
      .get(today) as { count: number; amount: number };

    const totalOutstandingRow = db
      .prepare(`
        SELECT COALESCE(SUM(CASE WHEN current_balance_type = 'Debit' THEN current_balance ELSE -current_balance END), 0) as total_outstanding
        FROM accounts
        WHERE account_type IN ('Customer', 'Customer & Supplier') AND is_system_account = 0 AND status = 'Active'
      `)
      .get() as { total_outstanding: number };

    // Salesman-wise performance
    const salesmanPerformance = db
      .prepare(`
        SELECT
          s.id,
          s.salesman_code,
          COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) as salesman_name,
          COALESCE(NULLIF(TRIM(s.phone), ''), s.mobile, '') as phone,
          s.status,
          COALESCE((SELECT COUNT(*) FROM supply_bookings b WHERE b.salesman_id = s.id AND b.status != 'Cancelled'), 0) as bookings_count,
          COALESCE((SELECT SUM(total_amount) FROM supply_bookings b WHERE b.salesman_id = s.id AND b.status != 'Cancelled'), 0) as bookings_amount,
          COALESCE((SELECT COUNT(*) FROM town_supplies ts WHERE ts.salesman_id = s.id AND ts.supply_status != 'Cancelled'), 0) as supplies_count,
          COALESCE((SELECT SUM(total_supply_amount) FROM town_supplies ts WHERE ts.salesman_id = s.id AND ts.supply_status != 'Cancelled'), 0) as supplies_amount,
          COALESCE((SELECT SUM(total_return_amount) FROM town_supplies ts WHERE ts.salesman_id = s.id AND ts.supply_status != 'Cancelled'), 0) as returns_amount,
          COALESCE((SELECT SUM(total_billed_amount) FROM town_supplies ts WHERE ts.salesman_id = s.id AND ts.supply_status != 'Cancelled'), 0) as billed_amount,
          COALESCE((SELECT SUM(recovery_amount) FROM supply_recoveries r WHERE r.salesman_id = s.id AND r.status = 'Posted'), 0) as recovery_amount
        FROM salesmen s
        ORDER BY s.salesman_code ASC, salesman_name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    // Town-wise performance
    const townPerformance = db
      .prepare(`
        SELECT
          t.id,
          t.town_code,
          t.town_name,
          t.status,
          COALESCE((SELECT COUNT(*) FROM accounts a WHERE a.account_type IN ('Customer', 'Customer & Supplier') AND a.is_system_account = 0 AND (a.town_id = t.id OR LOWER(a.town_name) = LOWER(t.town_name) OR LOWER(a.city) = LOWER(t.town_name))), 0) as total_parties,
          COALESCE((SELECT COUNT(*) FROM town_areas ta WHERE ta.town_id = t.id), 0) as total_areas,
          COALESCE((SELECT SUM(total_amount) FROM supply_bookings b WHERE (b.town_id = t.id OR LOWER(b.town_name) = LOWER(t.town_name)) AND b.status != 'Cancelled'), 0) as bookings_amount,
          COALESCE((SELECT SUM(total_supply_amount) FROM town_supplies ts WHERE (ts.town_id = t.id OR LOWER(ts.town_name) = LOWER(t.town_name)) AND ts.supply_status != 'Cancelled'), 0) as supply_amount,
          COALESCE((SELECT SUM(total_return_amount) FROM town_supplies ts WHERE (ts.town_id = t.id OR LOWER(ts.town_name) = LOWER(t.town_name)) AND ts.supply_status != 'Cancelled'), 0) as return_amount,
          COALESCE((SELECT SUM(total_billed_amount) FROM town_supplies ts WHERE (ts.town_id = t.id OR LOWER(ts.town_name) = LOWER(t.town_name)) AND ts.supply_status != 'Cancelled'), 0) as final_sales_amount,
          COALESCE((SELECT SUM(recovery_amount) FROM supply_recoveries r WHERE (r.town_id = t.id OR LOWER(r.town_name) = LOWER(t.town_name)) AND r.status = 'Posted'), 0) as recovery_amount,
          COALESCE((SELECT SUM(CASE WHEN a.current_balance_type = 'Debit' THEN a.current_balance ELSE -a.current_balance END) FROM accounts a WHERE a.account_type IN ('Customer', 'Customer & Supplier') AND a.is_system_account = 0 AND (a.town_id = t.id OR LOWER(a.town_name) = LOWER(t.town_name) OR LOWER(a.city) = LOWER(t.town_name))), 0) as outstanding_amount
        FROM towns t
        ORDER BY t.town_name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const recentSupplies = db
      .prepare(`
        SELECT *
        FROM town_supplies
        ORDER BY id DESC
        LIMIT 15
      `)
      .all();

    res.json({
      success: true,
      date: today,
      kpis: {
        todayOrderForms: { count: Number(todayOrderForms.count || 0), amount: round2(todayOrderForms.amount) },
        todayBookings: { count: Number(todayBookings.count || 0), amount: round2(todayBookings.amount) },
        todaySupplies: { count: Number(todaySupplies.count || 0), amount: round2(todaySupplies.amount) },
        pendingPacking: { count: Number(pendingPacking.count || 0), amount: round2(pendingPacking.amount) },
        readyForDispatch: { count: Number(readyForDispatch.count || 0), amount: round2(readyForDispatch.amount) },
        dispatchedSupplies: { count: Number(dispatchedSupplies.count || 0), amount: round2(dispatchedSupplies.amount) },
        pendingReturns: { count: Number(pendingReturns.count || 0), amount: round2(pendingReturns.amount) },
        pendingBilling: { count: Number(pendingBilling.count || 0), amount: round2(pendingBilling.amount) },
        todayFinalSales: { count: Number(todayFinalSales.count || 0), amount: round2(todayFinalSales.amount) },
        todayRecovery: { count: Number(todayRecovery.count || 0), amount: round2(todayRecovery.amount) },
        totalOutstanding: round2(Math.max(0, Number(totalOutstandingRow?.total_outstanding || 0))),
      },
      salesmanPerformance,
      townPerformance,
      recentSupplies,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 1. SALESMAN MANAGEMENT (Hierarchy: Salesman -> Town -> Area -> Party)
// ============================================================================

supplyRouter.get('/salesmen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim();

    let rows = db
      .prepare(
        `SELECT * FROM salesmen
         ORDER BY CASE WHEN status = 'Active' THEN 0 ELSE 1 END,
                  salesman_code ASC,
                  COALESCE(NULLIF(TRIM(full_name), ''), name) ASC`
      )
      .all() as Array<Record<string, unknown>>;

    if (statusFilter && statusFilter !== 'ALL') {
      rows = rows.filter((r) => String(r.status) === statusFilter);
    }
    if (q) {
      rows = rows.filter((r) => {
        const displayName = String(r.full_name || r.name || '').toLowerCase();
        const displayPhone = String(r.phone || r.mobile || '').toLowerCase();
        return (
          String(r.salesman_code || '').toLowerCase().includes(q) ||
          displayName.includes(q) ||
          displayPhone.includes(q) ||
          String(r.assigned_area || '').toLowerCase().includes(q)
        );
      });
    }

    const enriched = rows.map((s) => {
      const sId = Number(s.id);
      const canonicalName = String(s.full_name || s.name || '').trim();
      const canonicalPhone = String(s.phone || s.mobile || '').trim();

      const assignedTowns = db
        .prepare('SELECT town_id, town_name FROM salesman_towns WHERE salesman_id = ? ORDER BY town_name ASC')
        .all(sId) as Array<{ town_id: number; town_name: string }>;
      const assignedAreas = db
        .prepare('SELECT area_id, area_name, town_id, town_name FROM salesman_areas WHERE salesman_id = ? ORDER BY area_name ASC')
        .all(sId) as Array<{ area_id: number; area_name: string; town_id: number | null; town_name: string }>;
      const assignedParties = db
        .prepare(`
          SELECT sp.party_account_id, sp.party_name, sp.town_name, sp.area_name,
                 a.current_balance, a.current_balance_type, a.phone
          FROM salesman_parties sp
          LEFT JOIN accounts a ON a.id = sp.party_account_id
          WHERE sp.salesman_id = ?
          ORDER BY sp.party_name ASC
        `)
        .all(sId) as Array<Record<string, unknown>>;

      const stats = db
        .prepare(`
          SELECT
            COALESCE((SELECT COUNT(*) FROM supply_bookings b WHERE b.salesman_id = ? AND b.status != 'Cancelled'), 0) as bookings_count,
            COALESCE((SELECT SUM(total_amount) FROM supply_bookings b WHERE b.salesman_id = ? AND b.status != 'Cancelled'), 0) as bookings_amount,
            COALESCE((SELECT COUNT(*) FROM town_supplies ts WHERE ts.salesman_id = ? AND ts.supply_status != 'Cancelled'), 0) as supplies_count,
            COALESCE((SELECT SUM(total_supply_amount) FROM town_supplies ts WHERE ts.salesman_id = ? AND ts.supply_status != 'Cancelled'), 0) as supplies_amount,
            COALESCE((SELECT COUNT(*) FROM supply_returns sr WHERE sr.salesman_id = ? AND sr.status != 'Cancelled'), 0) as returns_count,
            COALESCE((SELECT SUM(total_return_amount) FROM supply_returns sr WHERE sr.salesman_id = ? AND sr.status != 'Cancelled'), 0) as returns_amount,
            COALESCE((SELECT COUNT(*) FROM sales sl WHERE sl.salesman_id = ? AND sl.status = 'completed'), 0) as sales_count,
            COALESCE((SELECT SUM(net_total) FROM sales sl WHERE sl.salesman_id = ? AND sl.status = 'completed'), 0) as sales_amount,
            COALESCE((SELECT COUNT(*) FROM supply_recoveries rc WHERE rc.salesman_id = ? AND rc.status = 'Posted'), 0) as recoveries_count,
            COALESCE((SELECT SUM(recovery_amount) FROM supply_recoveries rc WHERE rc.salesman_id = ? AND rc.status = 'Posted'), 0) as recoveries_amount
        `)
        .get(sId, sId, sId, sId, sId, sId, sId, sId, sId, sId) as Record<string, number>;

      const openingBalance = round2(Number(s.opening_balance || 0));
      const openingType = String(s.opening_balance_type || 'Debit');
      const signedOpening = openingType === 'Credit' ? -openingBalance : openingBalance;

      // Parties assigned to salesman total outstanding
      const partiesReceivable = assignedParties.reduce((sum, p) => {
        const bal = Number(p.current_balance || 0);
        return sum + (p.current_balance_type === 'Credit' ? -bal : bal);
      }, 0);

      const calculatedOutstanding = round2(
        Math.max(0, signedOpening + Number(stats.sales_amount || 0) - Number(stats.recoveries_amount || 0))
      );

      return {
        ...s,
        name: canonicalName,
        full_name: canonicalName,
        mobile: canonicalPhone,
        phone: canonicalPhone,
        opening_balance: openingBalance,
        opening_balance_type: openingType,
        assigned_towns: assignedTowns,
        assigned_areas: assignedAreas,
        assigned_parties: assignedParties,
        bookings_count: Number(stats.bookings_count || 0),
        bookings_amount: round2(stats.bookings_amount),
        supplies_count: Number(stats.supplies_count || 0),
        supplies_amount: round2(stats.supplies_amount),
        returns_count: Number(stats.returns_count || 0),
        returns_amount: round2(stats.returns_amount),
        sales_count: Number(stats.sales_count || 0),
        sales_amount: round2(stats.sales_amount),
        recoveries_count: Number(stats.recoveries_count || 0),
        recoveries_amount: round2(stats.recoveries_amount),
        parties_outstanding_balance: round2(Math.max(0, partiesReceivable)),
        outstanding_balance: round2(Math.max(partiesReceivable, calculatedOutstanding)),
      };
    });

    res.json({
      success: true,
      salesmen: enriched,
      nextSalesmanCode: peekNextSalesmanCode(db),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function saveSalesmanAssignments(
  salesmanId: number,
  salesmanName: string,
  townIds: number[],
  areaIds: number[],
  partyAccountIds: number[]
) {
  const db = getDatabase();

  const normalizedTownIds = Array.from(new Set(townIds.map(Number).filter(Boolean)));
  const normalizedAreaIds = Array.from(new Set(areaIds.map(Number).filter(Boolean)));
  const normalizedPartyIds = Array.from(new Set(partyAccountIds.map(Number).filter(Boolean)));

  // Unassign any party accounts previously linked to this salesman that were unchecked
  const previousParties = db
    .prepare('SELECT party_account_id FROM salesman_parties WHERE salesman_id = ?')
    .all(salesmanId) as Array<{ party_account_id: number }>;
  for (const prev of previousParties) {
    if (!normalizedPartyIds.includes(Number(prev.party_account_id))) {
      db.prepare(
        'UPDATE accounts SET assigned_salesman_id = NULL, assigned_salesman_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND assigned_salesman_id = ?'
      ).run(prev.party_account_id, salesmanId);
    }
  }

  db.prepare('DELETE FROM salesman_towns WHERE salesman_id = ?').run(salesmanId);
  db.prepare('DELETE FROM salesman_areas WHERE salesman_id = ?').run(salesmanId);
  db.prepare('DELETE FROM salesman_parties WHERE salesman_id = ?').run(salesmanId);

  const townNames: string[] = [];
  for (const tId of normalizedTownIds) {
    const tRow = db.prepare('SELECT id, town_name FROM towns WHERE id = ?').get(tId) as
      | { id: number; town_name: string }
      | undefined;
    if (tRow) {
      townNames.push(tRow.town_name);
      db.prepare('INSERT OR IGNORE INTO salesman_towns (salesman_id, town_id, town_name) VALUES (?, ?, ?)').run(
        salesmanId,
        tRow.id,
        tRow.town_name
      );
    }
  }

  const areaNames: string[] = [];
  for (const aId of normalizedAreaIds) {
    const aRow = db
      .prepare('SELECT id, area_name, town_id, town_name FROM town_areas WHERE id = ?')
      .get(aId) as { id: number; area_name: string; town_id: number; town_name: string } | undefined;
    if (aRow) {
      areaNames.push(aRow.area_name);
      db.prepare(
        'INSERT OR IGNORE INTO salesman_areas (salesman_id, area_id, area_name, town_id, town_name) VALUES (?, ?, ?, ?, ?)'
      ).run(salesmanId, aRow.id, aRow.area_name, aRow.town_id, aRow.town_name);
    }
  }

  for (const pId of normalizedPartyIds) {
    const pRow = db
      .prepare('SELECT id, account_name, town_name, city, area_name FROM accounts WHERE id = ?')
      .get(pId) as
      | { id: number; account_name: string; town_name: string; city: string; area_name: string }
      | undefined;
    if (pRow) {
      const townName = String(pRow.town_name || pRow.city || '');
      const areaName = String(pRow.area_name || '');
      db.prepare(
        'INSERT OR REPLACE INTO salesman_parties (salesman_id, party_account_id, party_name, town_name, area_name) VALUES (?, ?, ?, ?, ?)'
      ).run(salesmanId, pRow.id, pRow.account_name, townName, areaName);

      db.prepare(
        'UPDATE accounts SET assigned_salesman_id = ?, assigned_salesman_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(salesmanId, salesmanName, pRow.id);
    }
  }

  const summaryTerritory = [...townNames, ...areaNames].filter(Boolean).join(', ');
  db.prepare(`
    UPDATE salesmen
    SET assigned_area = ?,
        assigned_towns_json = ?,
        assigned_areas_json = ?,
        assigned_parties_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    summaryTerritory,
    JSON.stringify(normalizedTownIds),
    JSON.stringify(normalizedAreaIds),
    JSON.stringify(normalizedPartyIds),
    salesmanId
  );
}

supplyRouter.post('/salesmen', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const fullName = String(body.full_name || body.salesman_name || body.name || '').trim();
    if (!fullName) throw new Error('Salesman Name is required.');

    // Strictly monotonic automatic numbering: SAL-001, SAL-002, SAL-003... (never manual, never reused)
    const code = allocateNextSalesmanCode(db);

    const phone = String(body.phone || body.mobile_number || body.mobile || '').trim();
    const address = String(body.address || '').trim();
    const joiningDate = String(body.joining_date || new Date().toISOString().slice(0, 10)).trim();
    const username = String(body.username || code.toLowerCase()).trim();
    const plainPassword = String(body.password || '123456').trim();
    const { salt, hash } = hashPassword(plainPassword);
    const passwordHash = `${salt}:${hash}`;
    const permittedItemsJson = JSON.stringify(
      Array.isArray(body.permitted_item_ids) ? body.permitted_item_ids.map(Number) : []
    );

    const commissionType = body.commission_type === 'Fixed Amount' ? 'Fixed Amount' : 'Percentage';
    const commissionRate = round2(Number(body.commission_rate ?? body.commission_percent ?? 0));
    const commissionPercent = round2(Number(body.commission_percent ?? body.commission_rate ?? 0));
    const monthlyTarget = round2(Number(body.monthly_target || 0));
    const openingBalance = round2(Math.max(0, Number(body.opening_balance || 0)));
    const openingBalanceType = body.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = String(body.notes || '').trim();

    const insert = db
      .prepare(`
        INSERT INTO salesmen (
          salesman_code, name, full_name, mobile, phone, address, joining_date,
          commission_type, commission_rate,
          username, password_hash, permitted_items_json,
          assigned_area, commission_percent, monthly_target,
          opening_balance, opening_balance_type,
          status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        code,
        fullName,
        fullName,
        phone,
        phone,
        address,
        joiningDate,
        commissionType,
        commissionRate,
        username,
        passwordHash,
        permittedItemsJson,
        commissionPercent,
        monthlyTarget,
        openingBalance,
        openingBalanceType,
        status,
        notes
      );

    const salesmanId = Number(insert.lastInsertRowid);
    const townIds = Array.isArray(body.town_ids) ? body.town_ids.map(Number) : [];
    const areaIds = Array.isArray(body.area_ids) ? body.area_ids.map(Number) : [];
    const partyIds = Array.isArray(body.party_account_ids) ? body.party_account_ids.map(Number) : [];

    saveSalesmanAssignments(salesmanId, fullName, townIds, areaIds, partyIds);
    recordAudit(req, 'SUPPLY_SALESMAN_CREATED', `Created salesman ${fullName} (${code}) [Username: ${username}]`);

    return db.prepare('SELECT * FROM salesmen WHERE id = ?').get(salesmanId);
  });

  try {
    const record = tx(req.body || {});
    res.status(201).json({
      success: true,
      salesman: record,
      nextSalesmanCode: peekNextSalesmanCode(db),
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.put('/salesmen/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((id: number, body: Record<string, unknown>) => {
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new Error('Salesman not found.');

    const fullName = String(body.full_name || body.salesman_name || body.name || existing.full_name || existing.name || '').trim();
    if (!fullName) throw new Error('Salesman Name is required.');

    // Keep salesman_code strictly immutable / read-only
    const phone =
      body.phone !== undefined || body.mobile !== undefined
        ? String(body.phone ?? body.mobile ?? '').trim()
        : String(existing.phone || existing.mobile || '');
    const address = body.address !== undefined ? String(body.address).trim() : String(existing.address || '');
    const joiningDate =
      body.joining_date !== undefined && String(body.joining_date).trim()
        ? String(body.joining_date).trim()
        : String(existing.joining_date || new Date().toISOString().slice(0, 10));
    const username =
      body.username !== undefined && String(body.username).trim()
        ? String(body.username).trim()
        : String(existing.username || existing.salesman_code || '').toLowerCase();

    let passwordHash = String(existing.password_hash || '');
    if (body.password && String(body.password).trim().length > 0) {
      const { salt, hash } = hashPassword(String(body.password).trim());
      passwordHash = `${salt}:${hash}`;
    }

    const permittedItemsJson = Array.isArray(body.permitted_item_ids)
      ? JSON.stringify(body.permitted_item_ids.map(Number))
      : String(existing.permitted_items_json || '[]');

    const commissionType =
      body.commission_type !== undefined
        ? body.commission_type === 'Fixed Amount'
          ? 'Fixed Amount'
          : 'Percentage'
        : existing.commission_type === 'Fixed Amount'
        ? 'Fixed Amount'
        : 'Percentage';
    const commissionRate =
      body.commission_rate !== undefined
        ? round2(Number(body.commission_rate))
        : round2(Number(existing.commission_rate ?? existing.commission_percent ?? 0));
    const commissionPercent =
      body.commission_percent !== undefined
        ? round2(Number(body.commission_percent))
        : body.commission_rate !== undefined
        ? round2(Number(body.commission_rate))
        : round2(Number(existing.commission_percent ?? existing.commission_rate ?? 0));
    const monthlyTarget =
      body.monthly_target !== undefined
        ? round2(Number(body.monthly_target))
        : round2(Number(existing.monthly_target || 0));

    const openingBalance =
      body.opening_balance !== undefined
        ? round2(Math.max(0, Number(body.opening_balance)))
        : round2(Number(existing.opening_balance || 0));
    const openingBalanceType =
      body.opening_balance_type !== undefined
        ? body.opening_balance_type === 'Credit'
          ? 'Credit'
          : 'Debit'
        : String(existing.opening_balance_type || 'Debit');
    const status =
      body.status !== undefined
        ? body.status === 'Inactive'
          ? 'Inactive'
          : 'Active'
        : String(existing.status || 'Active');
    const notes = body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || '');

    db.prepare(`
      UPDATE salesmen
      SET name = ?,
          full_name = ?,
          mobile = ?,
          phone = ?,
          address = ?,
          joining_date = ?,
          commission_type = ?,
          commission_rate = ?,
          commission_percent = ?,
          monthly_target = ?,
          username = ?,
          password_hash = ?,
          permitted_items_json = ?,
          opening_balance = ?,
          opening_balance_type = ?,
          status = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      fullName,
      fullName,
      phone,
      phone,
      address,
      joiningDate,
      commissionType,
      commissionRate,
      commissionPercent,
      monthlyTarget,
      username,
      passwordHash,
      permittedItemsJson,
      openingBalance,
      openingBalanceType,
      status,
      notes,
      id
    );

    const townIds = Array.isArray(body.town_ids)
      ? body.town_ids.map(Number)
      : JSON.parse(String(existing.assigned_towns_json || '[]'));
    const areaIds = Array.isArray(body.area_ids)
      ? body.area_ids.map(Number)
      : JSON.parse(String(existing.assigned_areas_json || '[]'));
    const partyIds = Array.isArray(body.party_account_ids)
      ? body.party_account_ids.map(Number)
      : JSON.parse(String(existing.assigned_parties_json || '[]'));

    saveSalesmanAssignments(id, fullName, townIds, areaIds, partyIds);
    syncSalesmanDenormalizedReferences(db, id, fullName);
    recordAudit(req, 'SUPPLY_SALESMAN_UPDATED', `Updated salesman ${fullName} (${existing.salesman_code}) [#${id}]`);

    return db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
  });

  try {
    const record = tx(Number(req.params.id), req.body || {});
    res.json({
      success: true,
      salesman: record,
      nextSalesmanCode: peekNextSalesmanCode(db),
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.patch('/salesmen/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Salesman not found.' });
      return;
    }
    const nextStatus = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
    db.prepare('UPDATE salesmen SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, id);
    const updated = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    recordAudit(
      req,
      'SUPPLY_SALESMAN_STATUS_CHANGED',
      `Salesman "${existing.full_name || existing.name}" (${existing.salesman_code}) marked ${nextStatus}.`
    );
    res.json({ success: true, salesman: updated, message: `Salesman marked ${nextStatus}.` });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.delete('/salesmen/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Salesman not found.' });
      return;
    }
    const linked = getSalesmanLinkedRecordCount(db, id);
    if (linked.total > 0) {
      res.status(400).json({
        success: false,
        error: `Cannot delete "${existing.full_name || existing.name}" (${existing.salesman_code}) because they are linked to ${linked.total} record(s). Mark them Inactive instead.`,
      });
      return;
    }

    // Remove junction links only; sequence number is NEVER reset or decremented
    db.prepare('DELETE FROM salesman_towns WHERE salesman_id = ?').run(id);
    db.prepare('DELETE FROM salesman_areas WHERE salesman_id = ?').run(id);
    db.prepare('DELETE FROM salesman_parties WHERE salesman_id = ?').run(id);
    db.prepare('DELETE FROM salesmen WHERE id = ?').run(id);
    recordAudit(req, 'SUPPLY_SALESMAN_DELETED', `Deleted salesman "${existing.full_name || existing.name}" (${existing.salesman_code})`);
    res.json({
      success: true,
      message: `Salesman "${existing.full_name || existing.name}" deleted.`,
      nextSalesmanCode: peekNextSalesmanCode(db),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 2. TOWN / AREA / PARTY MANAGEMENT (Strictly TOWN — City & Town are unified)
// ============================================================================

supplyRouter.get('/towns', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const towns = db
      .prepare('SELECT * FROM towns ORDER BY town_name ASC')
      .all() as Array<Record<string, unknown>>;

    const areas = db
      .prepare('SELECT * FROM town_areas ORDER BY town_name ASC, area_name ASC')
      .all() as Array<Record<string, unknown>>;

    const salesmanTownLinks = db
      .prepare(`
        SELECT st.town_id, st.salesman_id,
               COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) as salesman_name,
               s.salesman_code
        FROM salesman_towns st
        JOIN salesmen s ON s.id = st.salesman_id
      `)
      .all() as Array<{ town_id: number; salesman_id: number; salesman_name: string; salesman_code: string }>;

    const customerParties = db
      .prepare(`
        SELECT id, account_code, account_name, account_group, account_type, contact_person, phone, address,
               town_id, COALESCE(NULLIF(town_name, ''), city, '') as town_name,
               area_id, COALESCE(area_name, '') as area_name,
               assigned_salesman_id, COALESCE(assigned_salesman_name, '') as assigned_salesman_name,
               current_balance, current_balance_type, status
        FROM accounts
        WHERE account_type IN ('Customer', 'Customer & Supplier') AND is_system_account = 0
        ORDER BY account_name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const enrichedTowns = towns.map((t) => {
      const tId = Number(t.id);
      const tName = String(t.town_name || '');
      const townAreas = areas.filter((a) => Number(a.town_id) === tId);
      const assignedSalesmen = salesmanTownLinks.filter((l) => Number(l.town_id) === tId);
      const partiesInTown = customerParties.filter(
        (p) => Number(p.town_id) === tId || String(p.town_name || '').toLowerCase() === tName.toLowerCase()
      );

      const stats = db
        .prepare(`
          SELECT
            COALESCE((SELECT SUM(total_supply_amount) FROM town_supplies ts WHERE (ts.town_id = ? OR LOWER(ts.town_name) = LOWER(?)) AND ts.supply_status != 'Cancelled'), 0) as total_supply_amount,
            COALESCE((SELECT SUM(total_return_amount) FROM town_supplies ts WHERE (ts.town_id = ? OR LOWER(ts.town_name) = LOWER(?)) AND ts.supply_status != 'Cancelled'), 0) as total_return_amount,
            COALESCE((SELECT SUM(total_billed_amount) FROM town_supplies ts WHERE (ts.town_id = ? OR LOWER(ts.town_name) = LOWER(?)) AND ts.supply_status != 'Cancelled'), 0) as total_sales_amount,
            COALESCE((SELECT SUM(recovery_amount) FROM supply_recoveries rc WHERE (rc.town_id = ? OR LOWER(rc.town_name) = LOWER(?)) AND rc.status = 'Posted'), 0) as total_recovery_amount
        `)
        .get(tId, tName, tId, tName, tId, tName, tId, tName) as Record<string, number>;

      const outstandingBalance = partiesInTown.reduce((sum, p) => {
        const bal = Number(p.current_balance || 0);
        return sum + (p.current_balance_type === 'Credit' ? -bal : bal);
      }, 0);

      return {
        ...t,
        areas: townAreas,
        assigned_salesmen: assignedSalesmen,
        parties: partiesInTown,
        total_parties: partiesInTown.length,
        total_areas: townAreas.length,
        total_supply_amount: round2(stats.total_supply_amount),
        total_return_amount: round2(stats.total_return_amount),
        total_sales_amount: round2(stats.total_sales_amount),
        total_recovery_amount: round2(stats.total_recovery_amount),
        outstanding_balance: round2(Math.max(0, outstandingBalance)),
      };
    });

    res.json({
      success: true,
      towns: enrichedTowns,
      areas,
      parties: customerParties,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.post('/towns', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const townName = String(body.town_name || '').trim();
    if (!townName) {
      return res.status(400).json({ success: false, error: 'Town Name is required.' });
    }

    const dup = db
      .prepare('SELECT id FROM towns WHERE LOWER(town_name) = LOWER(?)')
      .get(townName) as { id: number } | undefined;
    if (dup) {
      return res.status(400).json({ success: false, error: `Town "${townName}" already exists.` });
    }

    const townCode = String(body.town_code || '').trim().toUpperCase() || getNextSeqNumber('towns', 'town_code', 'TWN');
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = String(body.notes || '').trim();

    const insert = db
      .prepare('INSERT INTO towns (town_code, town_name, status, notes) VALUES (?, ?, ?, ?)')
      .run(townCode, townName, status, notes);
    const townId = Number(insert.lastInsertRowid);

    // Optional initial areas array
    if (Array.isArray(body.areas)) {
      for (const rawArea of body.areas) {
        const areaName = String(rawArea || '').trim();
        if (areaName) {
          const areaCode = getNextSeqNumber('town_areas', 'area_code', 'ARA');
          db.prepare(
            'INSERT OR IGNORE INTO town_areas (area_code, area_name, town_id, town_name, status) VALUES (?, ?, ?, ?, ?)'
          ).run(areaCode, areaName, townId, townName, 'Active');
        }
      }
    }

    // Sync any accounts whose city/town_name matches
    db.prepare(
      'UPDATE accounts SET town_id = ?, town_name = ?, city = ? WHERE LOWER(city) = LOWER(?) OR LOWER(town_name) = LOWER(?)'
    ).run(townId, townName, townName, townName, townName);

    recordAudit(req, 'SUPPLY_TOWN_CREATED', `Created Town ${townName} (${townCode})`);
    const record = db.prepare('SELECT * FROM towns WHERE id = ?').get(townId);
    res.status(201).json({ success: true, town: record });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.put('/towns/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const body = req.body || {};
    const existing = db.prepare('SELECT * FROM towns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ success: false, error: 'Town not found.' });

    const townName = String(body.town_name || existing.town_name || '').trim();
    if (!townName) return res.status(400).json({ success: false, error: 'Town Name is required.' });
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = body.notes !== undefined ? String(body.notes).trim() : String(existing.notes || '');

    db.prepare('UPDATE towns SET town_name = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      townName,
      status,
      notes,
      id
    );
    db.prepare('UPDATE town_areas SET town_name = ? WHERE town_id = ?').run(townName, id);
    db.prepare('UPDATE salesman_towns SET town_name = ? WHERE town_id = ?').run(townName, id);
    db.prepare('UPDATE accounts SET town_name = ?, city = ? WHERE town_id = ?').run(townName, townName, id);

    const record = db.prepare('SELECT * FROM towns WHERE id = ?').get(id);
    res.json({ success: true, town: record });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.post('/areas', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const townId = Number(body.town_id);
    const areaName = String(body.area_name || '').trim();
    if (!townId || !areaName) {
      return res.status(400).json({ success: false, error: 'Both Town and Area Name are required.' });
    }

    const townRow = db.prepare('SELECT id, town_name FROM towns WHERE id = ?').get(townId) as
      | { id: number; town_name: string }
      | undefined;
    if (!townRow) return res.status(404).json({ success: false, error: 'Selected Town not found.' });

    const dup = db
      .prepare('SELECT id FROM town_areas WHERE town_id = ? AND LOWER(area_name) = LOWER(?)')
      .get(townId, areaName) as { id: number } | undefined;
    if (dup) {
      return res.status(400).json({ success: false, error: `Area "${areaName}" already exists under ${townRow.town_name}.` });
    }

    const areaCode = String(body.area_code || '').trim().toUpperCase() || getNextSeqNumber('town_areas', 'area_code', 'ARA');
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const notes = String(body.notes || '').trim();

    const insert = db
      .prepare(
        'INSERT INTO town_areas (area_code, area_name, town_id, town_name, status, notes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(areaCode, areaName, townRow.id, townRow.town_name, status, notes);

    const record = db.prepare('SELECT * FROM town_areas WHERE id = ?').get(Number(insert.lastInsertRowid));
    res.status(201).json({ success: true, area: record });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.post('/assign-party', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const partyIds: number[] = Array.isArray(body.party_account_ids)
      ? body.party_account_ids.map(Number).filter(Boolean)
      : body.party_account_id
      ? [Number(body.party_account_id)]
      : [];

    if (partyIds.length === 0) {
      throw new Error('Select at least one Party to assign.');
    }

    const townId = body.town_id ? Number(body.town_id) : null;
    const areaId = body.area_id ? Number(body.area_id) : null;
    const salesmanId = body.salesman_id ? Number(body.salesman_id) : null;

    let townName = String(body.town_name || '').trim();
    if (townId) {
      const tRow = db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as
        | { town_name: string }
        | undefined;
      if (tRow) townName = tRow.town_name;
    }

    let areaName = String(body.area_name || '').trim();
    if (areaId) {
      const aRow = db.prepare('SELECT area_name FROM town_areas WHERE id = ?').get(areaId) as
        | { area_name: string }
        | undefined;
      if (aRow) areaName = aRow.area_name;
    }

    let salesmanName = String(body.salesman_name || '').trim();
    if (salesmanId) {
      const sRow = db
        .prepare("SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) as full_name FROM salesmen WHERE id = ?")
        .get(salesmanId) as { full_name: string } | undefined;
      if (sRow) salesmanName = sRow.full_name;
    }

    for (const pId of partyIds) {
      const partyRow = db
        .prepare('SELECT id, account_name FROM accounts WHERE id = ?')
        .get(pId) as { id: number; account_name: string } | undefined;
      if (!partyRow) continue;

      db.prepare(`
        UPDATE accounts
        SET town_id = ?,
            town_name = ?,
            city = ?,
            area_id = ?,
            area_name = ?,
            assigned_salesman_id = COALESCE(?, assigned_salesman_id),
            assigned_salesman_name = CASE WHEN ? IS NOT NULL THEN ? ELSE assigned_salesman_name END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        townId,
        townName,
        townName,
        areaId,
        areaName,
        salesmanId,
        salesmanId,
        salesmanName,
        pId
      );

      if (salesmanId) {
        db.prepare(
          'INSERT OR REPLACE INTO salesman_parties (salesman_id, party_account_id, party_name, town_name, area_name) VALUES (?, ?, ?, ?, ?)'
        ).run(salesmanId, pId, partyRow.account_name, townName, areaName);
        if (townId && townName) {
          db.prepare('INSERT OR IGNORE INTO salesman_towns (salesman_id, town_id, town_name) VALUES (?, ?, ?)').run(
            salesmanId,
            townId,
            townName
          );
        }
        if (areaId && areaName) {
          db.prepare(
            'INSERT OR IGNORE INTO salesman_areas (salesman_id, area_id, area_name, town_id, town_name) VALUES (?, ?, ?, ?, ?)'
          ).run(salesmanId, areaId, areaName, townId, townName);
        }
      }
    }

    if (salesmanId) {
      refreshSalesmanPartiesJson(db, salesmanId);
    }

    recordAudit(
      req,
      'SUPPLY_PARTY_TERRITORY_ASSIGNED',
      `Assigned ${partyIds.length} party(ies) to Town="${townName}", Area="${areaName}", Salesman="${salesmanName}"`
    );

    return { updatedCount: partyIds.length };
  });

  try {
    const result = tx(req.body || {});
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 3. ORDER FORM MODULE (Company-Wise A-Z, 1/2/3 Column & Thermal Print, Convert to Booking)
// ============================================================================

/**
 * GET /api/supply/order-forms/catalog
 * Returns active items grouped & sorted Company-Wise (A-Z companies, A-Z items inside each company)
 */
supplyRouter.get('/order-forms/catalog', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const companyFilter = String(req.query.company || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    let items = db
      .prepare(`
        SELECT id, item_code, item_name, COALESCE(NULLIF(TRIM(company_name), ''), 'GENERAL / UNASSIGNED') as company_name,
               packing, trade_price, wholesale_price, retail_price, purchase_price, discount_percent
        FROM items
        WHERE status = 'Active'
        ORDER BY LOWER(COALESCE(NULLIF(TRIM(company_name), ''), 'GENERAL / UNASSIGNED')) ASC,
                 LOWER(item_name) ASC
      `)
      .all() as Array<Record<string, unknown>>;

    if (companyFilter && companyFilter !== 'all') {
      const selectedList = companyFilter.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
      items = items.filter((i) => selectedList.includes(String(i.company_name || '').toLowerCase()));
    }

    if (q) {
      items = items.filter(
        (i) =>
          String(i.item_name || '').toLowerCase().includes(q) ||
          String(i.item_code || '').toLowerCase().includes(q) ||
          String(i.company_name || '').toLowerCase().includes(q)
      );
    }

    const companiesSet = new Set<string>();
    const enriched = items.map((item) => {
      const comp = String(item.company_name || 'GENERAL / UNASSIGNED');
      companiesSet.add(comp);
      const stock = getItemStockSummary(Number(item.id));
      const tradePrice = round2(
        Number(item.trade_price || item.wholesale_price || item.retail_price || 0)
      );
      return {
        ...item,
        trade_price: tradePrice,
        available_packs: stock.availablePacks,
        net_packable_packs: stock.netPackablePacks,
      };
    });

    res.json({
      success: true,
      companies: Array.from(companiesSet).sort((a, b) => a.localeCompare(b)),
      items: enriched,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.get('/order-forms', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const status = String(req.query.status || '').trim();
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();

    let rows = db
      .prepare('SELECT * FROM supply_order_forms ORDER BY order_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;

    if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
    if (townId) rows = rows.filter((r) => Number(r.town_id) === townId);
    if (partyId) rows = rows.filter((r) => Number(r.party_account_id) === partyId);
    if (status && status !== 'ALL') rows = rows.filter((r) => String(r.status) === status);
    if (fromDate) rows = rows.filter((r) => String(r.order_date) >= fromDate);
    if (toDate) rows = rows.filter((r) => String(r.order_date) <= toDate);
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.order_number || '').toLowerCase().includes(q) ||
          String(r.party_name || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q) ||
          String(r.area_name || '').toLowerCase().includes(q)
      );
    }

    const enriched = rows.map((row) => {
      const items = db
        .prepare(`
          SELECT *
          FROM supply_order_form_items
          WHERE order_form_id = ?
          ORDER BY LOWER(COALESCE(NULLIF(TRIM(company_name), ''), 'GENERAL')) ASC,
                   LOWER(item_name) ASC,
                   s_no ASC
        `)
        .all(Number(row.id));
      return { ...row, items };
    });

    res.json({ success: true, orderForms: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function upsertOrderForm(orderFormId: number | null, body: Record<string, unknown>) {
  const db = getDatabase();
  const orderDate = String(body.order_date || new Date().toISOString().slice(0, 10));
  const storeName = String(body.store_name || 'ABRAR MEDICAL STORE').trim();
  const salesmanId = body.salesman_id ? Number(body.salesman_id) : null;
  let salesmanName = String(body.salesman_name || '').trim();
  if (salesmanId && !salesmanName) {
    const s = db.prepare("SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) as full_name FROM salesmen WHERE id = ?").get(salesmanId) as { full_name: string } | undefined;
    if (s) salesmanName = s.full_name;
  }

  const townId = body.town_id ? Number(body.town_id) : null;
  let townName = String(body.town_name || '').trim();
  if (townId && !townName) {
    const t = db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as { town_name: string } | undefined;
    if (t) townName = t.town_name;
  }

  const areaId = body.area_id ? Number(body.area_id) : null;
  let areaName = String(body.area_name || '').trim();
  if (areaId && !areaName) {
    const a = db.prepare('SELECT area_name FROM town_areas WHERE id = ?').get(areaId) as { area_name: string } | undefined;
    if (a) areaName = a.area_name;
  }

  const partyAccountId = body.party_account_id ? Number(body.party_account_id) : null;
  let partyName = String(body.party_name || '').trim();
  if (partyAccountId && !partyName) {
    const p = db.prepare('SELECT account_name FROM accounts WHERE id = ?').get(partyAccountId) as { account_name: string } | undefined;
    if (p) partyName = p.account_name;
  }

  const printLayout = (['1-col', '2-col', '3-col', 'thermal-58', 'thermal-80'].includes(String(body.print_layout))
    ? String(body.print_layout)
    : '1-col') as string;
  const remarks = String(body.remarks || '').trim();

  const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  if (rawItems.length === 0) {
    throw new Error('Add at least one item to the Order Form.');
  }

  // Sort items Company-Wise (A-Z companies, A-Z item names)
  const normalizedItems = rawItems
    .map((line) => {
      const itemId = Number(line.item_id);
      const itemRow = db
        .prepare('SELECT id, item_code, item_name, company_name, packing, trade_price, wholesale_price, retail_price FROM items WHERE id = ?')
        .get(itemId) as Record<string, unknown> | undefined;
      if (!itemRow) throw new Error(`Item ID ${itemId} not found.`);

      const qty = round2(Math.max(0, Number(line.quantity || 0)));
      const tradePrice = round2(
        Number(
          line.trade_price ??
            itemRow.trade_price ??
            itemRow.wholesale_price ??
            itemRow.retail_price ??
            0
        )
      );
      const amount = round2(qty * tradePrice);

      return {
        itemId,
        itemCode: String(itemRow.item_code || ''),
        companyName: String(itemRow.company_name || 'GENERAL').trim() || 'GENERAL',
        itemName: String(itemRow.item_name || ''),
        packing: String(itemRow.packing || '1x1'),
        tradePrice,
        quantity: qty,
        amount,
        remarks: String(line.remarks || '').trim(),
      };
    })
    .sort((a, b) => {
      const cCmp = a.companyName.toLowerCase().localeCompare(b.companyName.toLowerCase());
      if (cCmp !== 0) return cCmp;
      return a.itemName.toLowerCase().localeCompare(b.itemName.toLowerCase());
    });

  const totalItems = normalizedItems.length;
  const totalQuantity = round2(normalizedItems.reduce((sum, i) => sum + i.quantity, 0));
  const totalAmount = round2(normalizedItems.reduce((sum, i) => sum + i.amount, 0));

  let finalId = orderFormId;
  if (orderFormId) {
    const existing = db.prepare('SELECT * FROM supply_order_forms WHERE id = ?').get(orderFormId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new Error('Order Form not found.');
    if (String(existing.status) === 'Converted') {
      throw new Error('Cannot edit an Order Form that has already been converted into a Booking.');
    }

    db.prepare(`
      UPDATE supply_order_forms
      SET store_name = ?,
          order_date = ?,
          salesman_id = ?,
          salesman_name = ?,
          town_id = ?,
          town_name = ?,
          area_id = ?,
          area_name = ?,
          party_account_id = ?,
          party_name = ?,
          print_layout = ?,
          total_items = ?,
          total_quantity = ?,
          total_amount = ?,
          remarks = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      storeName,
      orderDate,
      salesmanId,
      salesmanName,
      townId,
      townName,
      areaId,
      areaName,
      partyAccountId,
      partyName,
      printLayout,
      totalItems,
      totalQuantity,
      totalAmount,
      remarks,
      orderFormId
    );
    db.prepare('DELETE FROM supply_order_form_items WHERE order_form_id = ?').run(orderFormId);
  } else {
    const orderNumber =
      String(body.order_number || '').trim() ||
      getNextSeqNumber('supply_order_forms', 'order_number', 'ORD');
    const insert = db
      .prepare(`
        INSERT INTO supply_order_forms (
          order_number, store_name, order_date, salesman_id, salesman_name,
          town_id, town_name, area_id, area_name, party_account_id, party_name,
          print_layout, total_items, total_quantity, total_amount, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Saved', ?)
      `)
      .run(
        orderNumber,
        storeName,
        orderDate,
        salesmanId,
        salesmanName,
        townId,
        townName,
        areaId,
        areaName,
        partyAccountId,
        partyName,
        printLayout,
        totalItems,
        totalQuantity,
        totalAmount,
        remarks
      );
    finalId = Number(insert.lastInsertRowid);
  }

  const insertItemStmt = db.prepare(`
    INSERT INTO supply_order_form_items (
      order_form_id, s_no, item_id, item_code, company_name, item_name,
      packing, trade_price, quantity, amount, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  normalizedItems.forEach((item, idx) => {
    insertItemStmt.run(
      finalId,
      idx + 1,
      item.itemId,
      item.itemCode,
      item.companyName,
      item.itemName,
      item.packing,
      item.tradePrice,
      item.quantity,
      item.amount,
      item.remarks
    );
  });

  const saved = db.prepare('SELECT * FROM supply_order_forms WHERE id = ?').get(finalId) as Record<string, any>;
  const savedItems = db
    .prepare('SELECT * FROM supply_order_form_items WHERE order_form_id = ? ORDER BY s_no ASC')
    .all(finalId);
  return { ...saved, items: savedItems } as Record<string, any>;
}

supplyRouter.post('/order-forms', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction(() => upsertOrderForm(null, req.body || {}));
  try {
    const orderForm = tx();
    recordAudit(req, 'SUPPLY_ORDER_FORM_CREATED', `Created Order Form ${String(orderForm.order_number)}`);
    res.status(201).json({ success: true, orderForm });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.put('/order-forms/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction(() => upsertOrderForm(Number(req.params.id), req.body || {}));
  try {
    const orderForm = tx();
    recordAudit(req, 'SUPPLY_ORDER_FORM_UPDATED', `Updated Order Form ${String(orderForm.order_number)}`);
    res.json({ success: true, orderForm });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/supply/order-forms/:id/convert-to-booking
 * Converts Order Form into Order Booking without re-entering items, prevents duplicate conversion, does NOT deduct stock.
 */
supplyRouter.post('/order-forms/:id/convert-to-booking', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((orderFormId: number, body: Record<string, unknown>) => {
    const orderForm = db
      .prepare('SELECT * FROM supply_order_forms WHERE id = ?')
      .get(orderFormId) as Record<string, unknown> | undefined;
    if (!orderForm) throw new Error('Order Form not found.');

    if (String(orderForm.status) === 'Converted' || orderForm.converted_booking_id) {
      throw new Error(
        `Order Form ${String(orderForm.order_number)} has already been converted to Booking ${String(orderForm.converted_booking_number || '')}. Duplicate conversion is prevented.`
      );
    }
    if (String(orderForm.status) === 'Cancelled') {
      throw new Error('Cannot convert a cancelled Order Form.');
    }

    const partyAccountId = Number(body.party_account_id || orderForm.party_account_id || 0);
    if (!partyAccountId) {
      throw new Error('Please select a Customer / Party Name before converting the Order Form into a Booking.');
    }

    const partyRow = db
      .prepare('SELECT id, account_name, town_id, town_name, city, area_id, area_name, assigned_salesman_id, assigned_salesman_name FROM accounts WHERE id = ?')
      .get(partyAccountId) as Record<string, unknown> | undefined;
    if (!partyRow) throw new Error('Selected Party account not found.');

    const orderItems = db
      .prepare('SELECT * FROM supply_order_form_items WHERE order_form_id = ? AND quantity > 0 ORDER BY s_no ASC')
      .all(orderFormId) as Array<Record<string, unknown>>;

    if (orderItems.length === 0) {
      throw new Error('This Order Form has no items with quantity > 0 to convert into a Booking.');
    }

    const bookingNumber = getNextSeqNumber('supply_bookings', 'booking_number', 'BKG');
    const bookingDate = String(body.booking_date || orderForm.order_date || new Date().toISOString().slice(0, 10));
    const salesmanId = Number(body.salesman_id || orderForm.salesman_id || partyRow.assigned_salesman_id || 0) || null;
    const salesmanName = String(
      body.salesman_name || orderForm.salesman_name || partyRow.assigned_salesman_name || ''
    );
    const townId = Number(body.town_id || orderForm.town_id || partyRow.town_id || 0) || null;
    const townName = String(body.town_name || orderForm.town_name || partyRow.town_name || partyRow.city || '');
    const areaId = Number(body.area_id || orderForm.area_id || partyRow.area_id || 0) || null;
    const areaName = String(body.area_name || orderForm.area_name || partyRow.area_name || '');
    const partyName = String(partyRow.account_name || orderForm.party_name || '');

    let totalQty = 0;
    let totalBonus = 0;
    let grossAmount = 0;
    let discountAmount = 0;
    let netAmount = 0;

    const preparedLines = orderItems.map((oi, idx) => {
      const qty = round2(Number(oi.quantity || 0));
      const bonus = round2(Number(oi.bonus_quantity || 0));
      const tradePrice = round2(Number(oi.trade_price || 0));
      const discPct = round2(Number(body.default_discount_percent || 0));
      const lineGross = round2(qty * tradePrice);
      const lineDisc = round2((lineGross * discPct) / 100);
      const lineNet = round2(lineGross - lineDisc);

      totalQty = round2(totalQty + qty);
      totalBonus = round2(totalBonus + bonus);
      grossAmount = round2(grossAmount + lineGross);
      discountAmount = round2(discountAmount + lineDisc);
      netAmount = round2(netAmount + lineNet);

      return {
        sNo: idx + 1,
        itemId: Number(oi.item_id),
        itemCode: String(oi.item_code || ''),
        companyName: String(oi.company_name || ''),
        itemName: String(oi.item_name || ''),
        packing: String(oi.packing || '1x1'),
        quantity: qty,
        bonus,
        tradePrice,
        discPct,
        lineDisc,
        lineNet,
        remarks: String(oi.remarks || ''),
      };
    });

    const insertBooking = db
      .prepare(`
        INSERT INTO supply_bookings (
          booking_number, booking_date, order_form_id, order_number,
          salesman_id, salesman_name, town_id, town_name, area_id, area_name,
          party_account_id, party_name, total_items, total_quantity, total_bonus,
          gross_amount, discount_amount, total_amount, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Booking Pending', ?)
      `)
      .run(
        bookingNumber,
        bookingDate,
        orderFormId,
        String(orderForm.order_number),
        salesmanId,
        salesmanName,
        townId,
        townName,
        areaId,
        areaName,
        partyAccountId,
        partyName,
        preparedLines.length,
        totalQty,
        totalBonus,
        grossAmount,
        discountAmount,
        netAmount,
        `Converted from Order Form ${String(orderForm.order_number)}. ${String(orderForm.remarks || '')}`.trim()
      );

    const bookingId = Number(insertBooking.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO supply_booking_items (
        booking_id, s_no, item_id, item_code, company_name, item_name,
        packing, quantity, supplied_quantity, pending_quantity, bonus_quantity,
        trade_price, discount_percent, discount_amount, amount, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const l of preparedLines) {
      insertItem.run(
        bookingId,
        l.sNo,
        l.itemId,
        l.itemCode,
        l.companyName,
        l.itemName,
        l.packing,
        l.quantity,
        l.quantity,
        l.bonus,
        l.tradePrice,
        l.discPct,
        l.lineDisc,
        l.lineNet,
        l.remarks
      );
    }

    db.prepare(`
      UPDATE supply_order_forms
      SET status = 'Converted',
          converted_booking_id = ?,
          converted_booking_number = ?,
          party_account_id = COALESCE(party_account_id, ?),
          party_name = CASE WHEN party_name = '' THEN ? ELSE party_name END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(bookingId, bookingNumber, partyAccountId, partyName, orderFormId);

    recordAudit(
      req,
      'SUPPLY_ORDER_CONVERTED_TO_BOOKING',
      `Converted Order Form ${String(orderForm.order_number)} -> Booking ${bookingNumber}`
    );

    const booking = db.prepare('SELECT * FROM supply_bookings WHERE id = ?').get(bookingId) as Record<string, unknown>;
    const items = db.prepare('SELECT * FROM supply_booking_items WHERE booking_id = ? ORDER BY s_no ASC').all(bookingId);
    return { ...booking, items };
  });

  try {
    const booking = tx(Number(req.params.id), req.body || {});
    res.json({ success: true, booking });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 4. ORDER BOOKING MODULE (Does NOT deduct inventory)
// ============================================================================

supplyRouter.get('/bookings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const areaId = req.query.area_id ? Number(req.query.area_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const status = String(req.query.status || '').trim();
    const pendingOnly = req.query.pending_only === '1' || req.query.pending_only === 'true';
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();

    let rows = db
      .prepare('SELECT * FROM supply_bookings ORDER BY booking_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;

    if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
    if (townId) rows = rows.filter((r) => Number(r.town_id) === townId);
    if (areaId) rows = rows.filter((r) => Number(r.area_id) === areaId);
    if (partyId) rows = rows.filter((r) => Number(r.party_account_id) === partyId);
    if (status && status !== 'ALL') rows = rows.filter((r) => String(r.status) === status);
    if (pendingOnly) {
      rows = rows.filter((r) =>
        ['Booking Pending', 'Partially Supplied'].includes(String(r.status))
      );
    }
    if (fromDate) rows = rows.filter((r) => String(r.booking_date) >= fromDate);
    if (toDate) rows = rows.filter((r) => String(r.booking_date) <= toDate);
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.booking_number || '').toLowerCase().includes(q) ||
          String(r.order_number || '').toLowerCase().includes(q) ||
          String(r.party_name || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q) ||
          String(r.area_name || '').toLowerCase().includes(q)
      );
    }

    const enriched = rows.map((row) => {
      const items = db
        .prepare('SELECT * FROM supply_booking_items WHERE booking_id = ? ORDER BY s_no ASC')
        .all(Number(row.id)) as Array<Record<string, unknown>>;
      const totalSuppliedQty = round2(items.reduce((s, i) => s + Number(i.supplied_quantity || 0), 0));
      const totalPendingQty = round2(items.reduce((s, i) => s + Number(i.pending_quantity || 0), 0));
      return {
        ...row,
        supplied_quantity: totalSuppliedQty,
        pending_quantity: totalPendingQty,
        items,
      };
    });

    res.json({ success: true, bookings: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function upsertBooking(bookingId: number | null, body: Record<string, unknown>) {
  const db = getDatabase();
  const bookingDate = String(body.booking_date || new Date().toISOString().slice(0, 10));
  const partyAccountId = Number(body.party_account_id || 0);
  if (!partyAccountId) throw new Error('Party Name is required for Order Booking.');

  const partyRow = db
    .prepare(
      'SELECT id, account_name, town_id, town_name, city, area_id, area_name, assigned_salesman_id, assigned_salesman_name FROM accounts WHERE id = ?'
    )
    .get(partyAccountId) as Record<string, unknown> | undefined;
  if (!partyRow) throw new Error('Selected Party account not found.');

  const salesmanId = Number(body.salesman_id || partyRow.assigned_salesman_id || 0) || null;
  let salesmanName = String(body.salesman_name || partyRow.assigned_salesman_name || '').trim();
  if (salesmanId && !salesmanName) {
    const s = db.prepare("SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) as full_name FROM salesmen WHERE id = ?").get(salesmanId) as { full_name: string } | undefined;
    if (s) salesmanName = s.full_name;
  }

  const townId = Number(body.town_id || partyRow.town_id || 0) || null;
  let townName = String(body.town_name || partyRow.town_name || partyRow.city || '').trim();
  if (townId && !townName) {
    const t = db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as { town_name: string } | undefined;
    if (t) townName = t.town_name;
  }

  const areaId = Number(body.area_id || partyRow.area_id || 0) || null;
  let areaName = String(body.area_name || partyRow.area_name || '').trim();
  if (areaId && !areaName) {
    const a = db.prepare('SELECT area_name FROM town_areas WHERE id = ?').get(areaId) as { area_name: string } | undefined;
    if (a) areaName = a.area_name;
  }

  const partyName = String(partyRow.account_name);
  const remarks = String(body.remarks || '').trim();

  const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  if (rawItems.length === 0) {
    throw new Error('Add at least one item to the Order Booking.');
  }

  let totalQty = 0;
  let totalBonus = 0;
  let grossAmount = 0;
  let discountAmount = 0;
  let netAmount = 0;

  const processedLines = rawItems.map((line, idx) => {
    const itemId = Number(line.item_id);
    const itemRow = db
      .prepare('SELECT id, item_code, item_name, company_name, packing, trade_price, wholesale_price, retail_price FROM items WHERE id = ?')
      .get(itemId) as Record<string, unknown> | undefined;
    if (!itemRow) throw new Error(`Item #${itemId} not found.`);

    const quantity = round2(Math.max(0.01, Number(line.quantity || 0)));
    const bonus = round2(Math.max(0, Number(line.bonus_quantity ?? line.bonus ?? 0)));
    const tradePrice = round2(
      Math.max(
        0,
        Number(
          line.trade_price ??
            itemRow.trade_price ??
            itemRow.wholesale_price ??
            itemRow.retail_price ??
            0
        )
      )
    );
    const discPct = round2(Math.max(0, Math.min(100, Number(line.discount_percent ?? 0))));
    const lineGross = round2(quantity * tradePrice);
    const lineDisc = round2((lineGross * discPct) / 100);
    const lineNet = round2(lineGross - lineDisc);

    totalQty = round2(totalQty + quantity);
    totalBonus = round2(totalBonus + bonus);
    grossAmount = round2(grossAmount + lineGross);
    discountAmount = round2(discountAmount + lineDisc);
    netAmount = round2(netAmount + lineNet);

    return {
      sNo: idx + 1,
      itemId,
      itemCode: String(itemRow.item_code || ''),
      companyName: String(itemRow.company_name || ''),
      itemName: String(itemRow.item_name || ''),
      packing: String(itemRow.packing || '1x1'),
      quantity,
      bonus,
      tradePrice,
      discPct,
      lineDisc,
      lineNet,
      remarks: String(line.remarks || '').trim(),
    };
  });

  let finalId = bookingId;
  if (bookingId) {
    const existing = db.prepare('SELECT * FROM supply_bookings WHERE id = ?').get(bookingId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new Error('Order Booking not found.');
    if (String(existing.status) === 'Supplied') {
      throw new Error('Cannot edit an Order Booking that has already been fully converted into Supply.');
    }

    db.prepare(`
      UPDATE supply_bookings
      SET booking_date = ?,
          salesman_id = ?,
          salesman_name = ?,
          town_id = ?,
          town_name = ?,
          area_id = ?,
          area_name = ?,
          party_account_id = ?,
          party_name = ?,
          total_items = ?,
          total_quantity = ?,
          total_bonus = ?,
          gross_amount = ?,
          discount_amount = ?,
          total_amount = ?,
          remarks = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      bookingDate,
      salesmanId,
      salesmanName,
      townId,
      townName,
      areaId,
      areaName,
      partyAccountId,
      partyName,
      processedLines.length,
      totalQty,
      totalBonus,
      grossAmount,
      discountAmount,
      netAmount,
      remarks,
      bookingId
    );
    db.prepare('DELETE FROM supply_booking_items WHERE booking_id = ?').run(bookingId);
  } else {
    const bookingNumber =
      String(body.booking_number || '').trim() ||
      getNextSeqNumber('supply_bookings', 'booking_number', 'BKG');
    const insert = db
      .prepare(`
        INSERT INTO supply_bookings (
          booking_number, booking_date, salesman_id, salesman_name,
          town_id, town_name, area_id, area_name, party_account_id, party_name,
          total_items, total_quantity, total_bonus, gross_amount, discount_amount,
          total_amount, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Booking Pending', ?)
      `)
      .run(
        bookingNumber,
        bookingDate,
        salesmanId,
        salesmanName,
        townId,
        townName,
        areaId,
        areaName,
        partyAccountId,
        partyName,
        processedLines.length,
        totalQty,
        totalBonus,
        grossAmount,
        discountAmount,
        netAmount,
        remarks
      );
    finalId = Number(insert.lastInsertRowid);
  }

  const insertItemStmt = db.prepare(`
    INSERT INTO supply_booking_items (
      booking_id, s_no, item_id, item_code, company_name, item_name,
      packing, quantity, supplied_quantity, pending_quantity, bonus_quantity,
      trade_price, discount_percent, discount_amount, amount, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const l of processedLines) {
    insertItemStmt.run(
      finalId,
      l.sNo,
      l.itemId,
      l.itemCode,
      l.companyName,
      l.itemName,
      l.packing,
      l.quantity,
      l.quantity,
      l.bonus,
      l.tradePrice,
      l.discPct,
      l.lineDisc,
      l.lineNet,
      l.remarks
    );
  }

  const saved = db.prepare('SELECT * FROM supply_bookings WHERE id = ?').get(finalId) as Record<string, any>;
  const items = db.prepare('SELECT * FROM supply_booking_items WHERE booking_id = ? ORDER BY s_no ASC').all(finalId);
  return { ...saved, items } as Record<string, any>;
}

supplyRouter.post('/bookings', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction(() => upsertBooking(null, req.body || {}));
  try {
    const booking = tx();
    recordAudit(req, 'SUPPLY_BOOKING_CREATED', `Created Booking ${String(booking.booking_number)}`);
    res.status(201).json({ success: true, booking });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.put('/bookings/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction(() => upsertBooking(Number(req.params.id), req.body || {}));
  try {
    const booking = tx();
    recordAudit(req, 'SUPPLY_BOOKING_UPDATED', `Updated Booking ${String(booking.booking_number)}`);
    res.json({ success: true, booking });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 5. TOWN-WISE SUPPLY CREATION (Combines multiple bookings, generates common Supply Number)
// ============================================================================

/**
 * GET /api/supply/town-pending-bookings
 * When a Town is selected, returns assigned parties in that Town and all pending bookings with stock availability.
 */
supplyRouter.get('/town-pending-bookings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const townNameParam = String(req.query.town_name || '').trim();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const areaId = req.query.area_id ? Number(req.query.area_id) : null;

    let townName = townNameParam;
    if (townId && !townName) {
      const t = db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as { town_name: string } | undefined;
      if (t) townName = t.town_name;
    }

    let parties = db
      .prepare(`
        SELECT id, account_code, account_name, account_group, account_type, phone, address,
               town_id, COALESCE(NULLIF(town_name, ''), city, '') as town_name,
               area_id, COALESCE(area_name, '') as area_name,
               assigned_salesman_id, COALESCE(assigned_salesman_name, '') as assigned_salesman_name,
               current_balance, current_balance_type
        FROM accounts
        WHERE account_type IN ('Customer', 'Customer & Supplier') AND is_system_account = 0 AND status = 'Active'
        ORDER BY account_name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    if (townId || townName) {
      parties = parties.filter(
        (p) =>
          (townId && Number(p.town_id) === townId) ||
          (townName && String(p.town_name || '').toLowerCase() === townName.toLowerCase())
      );
    }
    if (areaId) {
      parties = parties.filter((p) => Number(p.area_id) === areaId);
    }

    let bookings = db
      .prepare(`
        SELECT *
        FROM supply_bookings
        WHERE status IN ('Booking Pending', 'Partially Supplied')
        ORDER BY booking_date ASC, id ASC
      `)
      .all() as Array<Record<string, unknown>>;

    if (townId || townName) {
      bookings = bookings.filter(
        (b) =>
          (townId && Number(b.town_id) === townId) ||
          (townName && String(b.town_name || '').toLowerCase() === townName.toLowerCase())
      );
    }
    if (salesmanId) {
      bookings = bookings.filter((b) => Number(b.salesman_id) === salesmanId);
    }
    if (areaId) {
      bookings = bookings.filter((b) => Number(b.area_id) === areaId);
    }

    const enrichedBookings = bookings
      .map((b) => {
        const items = db
          .prepare('SELECT * FROM supply_booking_items WHERE booking_id = ? AND pending_quantity > 0 ORDER BY s_no ASC')
          .all(Number(b.id)) as Array<Record<string, unknown>>;

        const itemsWithStock = items.map((item) => {
          const stock = getItemStockSummary(Number(item.item_id));
          return {
            ...item,
            available_packs: stock.availablePacks,
            net_packable_packs: stock.netPackablePacks,
            batch_number: stock.defaultBatchNumber,
            expiry_date: stock.defaultExpiryDate,
            inventory_id: stock.defaultInventoryId,
          };
        });

        return {
          ...b,
          items: itemsWithStock,
        };
      })
      .filter((b) => b.items.length > 0);

    res.json({
      success: true,
      parties,
      pendingBookings: enrichedBookings,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function hydrateTownSupply(townSupplyId: number): Record<string, any> | null {
  const db = getDatabase();
  const supply = db
    .prepare('SELECT * FROM town_supplies WHERE id = ?')
    .get(townSupplyId) as Record<string, any> | undefined;
  if (!supply) return null;

  const partySupplies = db
    .prepare('SELECT * FROM party_supplies WHERE town_supply_id = ? ORDER BY id ASC')
    .all(townSupplyId) as Array<Record<string, any>>;

  const allItems = db
    .prepare('SELECT * FROM party_supply_items WHERE town_supply_id = ? ORDER BY party_supply_id ASC, s_no ASC')
    .all(townSupplyId) as Array<Record<string, any>>;

  const enrichedItems: Array<Record<string, any>> = allItems.map((it) => {
    const stock = getItemStockSummary(Number(it.item_id));
    return {
      ...it,
      available_packs: stock.availablePacks,
      net_packable_packs: stock.netPackablePacks,
    };
  });

  const enrichedParties: Array<Record<string, any>> = partySupplies.map((ps) => {
    const psId = Number(ps.id);
    const pItems = enrichedItems.filter((i) => Number(i.party_supply_id) === psId);
    return {
      ...ps,
      items: pItems,
    };
  });

  const dispatches = db
    .prepare('SELECT * FROM supply_dispatches WHERE town_supply_id = ? ORDER BY id DESC')
    .all(townSupplyId);
  const returns = db
    .prepare('SELECT * FROM supply_returns WHERE town_supply_id = ? ORDER BY id DESC')
    .all(townSupplyId) as Array<Record<string, any>>;
  const enrichedReturns = returns.map((r) => ({
    ...r,
    items: db.prepare('SELECT * FROM supply_return_items WHERE supply_return_id = ? ORDER BY id ASC').all(Number(r.id)),
  }));
  const invoices = db
    .prepare('SELECT * FROM sales WHERE town_supply_id = ? ORDER BY id ASC')
    .all(townSupplyId);
  const recoveries = db
    .prepare('SELECT * FROM supply_recoveries WHERE town_supply_id = ? ORDER BY id DESC')
    .all(townSupplyId);

  return {
    ...supply,
    party_supplies: enrichedParties,
    items: enrichedItems,
    dispatches,
    returns: enrichedReturns,
    invoices,
    recoveries,
  };
}

supplyRouter.get('/supplies', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const supplyStatus = String(req.query.supply_status || '').trim();
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();

    let rows = db
      .prepare('SELECT id FROM town_supplies ORDER BY supply_date DESC, id DESC')
      .all() as Array<{ id: number }>;

    let hydrated = rows
      .map((r) => hydrateTownSupply(r.id))
      .filter((r): r is NonNullable<ReturnType<typeof hydrateTownSupply>> => Boolean(r));

    if (salesmanId) hydrated = hydrated.filter((r) => Number(r.salesman_id) === salesmanId);
    if (townId) hydrated = hydrated.filter((r) => Number(r.town_id) === townId);
    if (partyId) {
      hydrated = hydrated.filter((r) =>
        r.party_supplies.some((ps: Record<string, any>) => Number(ps.party_account_id) === partyId)
      );
    }
    if (supplyStatus && supplyStatus !== 'ALL') {
      hydrated = hydrated.filter((r) => String(r.supply_status) === supplyStatus);
    }
    if (fromDate) hydrated = hydrated.filter((r) => String(r.supply_date) >= fromDate);
    if (toDate) hydrated = hydrated.filter((r) => String(r.supply_date) <= toDate);
    if (q) {
      hydrated = hydrated.filter(
        (r) =>
          String(r.supply_number || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q) ||
          r.party_supplies.some((ps: Record<string, any>) => String(ps.party_name || '').toLowerCase().includes(q))
      );
    }

    res.json({ success: true, supplies: hydrated });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.get('/supplies/:id', (req: Request, res: Response) => {
  try {
    const record = hydrateTownSupply(Number(req.params.id));
    if (!record) return res.status(404).json({ success: false, error: 'Town Supply not found.' });
    res.json({ success: true, supply: record });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/supply/supplies
 * Creates a Town-Wise Supply with a common unique Supply Number and party-wise supply documents.
 * Combines multiple bookings of the same party into one party supply document.
 * Prevents duplicate conversion of the same booking quantity.
 */
supplyRouter.post('/supplies', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const supplyDate = String(body.supply_date || new Date().toISOString().slice(0, 10));
    const supplyNumber =
      String(body.supply_number || '').trim() ||
      getNextSeqNumber('town_supplies', 'supply_number', 'SUP');

    const salesmanId = body.salesman_id ? Number(body.salesman_id) : null;
    let salesmanName = String(body.salesman_name || '').trim();
    if (salesmanId && !salesmanName) {
      const s = db.prepare("SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) as full_name FROM salesmen WHERE id = ?").get(salesmanId) as { full_name: string } | undefined;
      if (s) salesmanName = s.full_name;
    }

    const townId = body.town_id ? Number(body.town_id) : null;
    let townName = String(body.town_name || '').trim();
    if (townId && !townName) {
      const t = db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as { town_name: string } | undefined;
      if (t) townName = t.town_name;
    }
    if (!townName) throw new Error('Town is required for Town-Wise Supply creation.');

    const areaId = body.area_id ? Number(body.area_id) : null;
    let areaName = String(body.area_name || '').trim();
    if (areaId && !areaName) {
      const a = db.prepare('SELECT area_name FROM town_areas WHERE id = ?').get(areaId) as { area_name: string } | undefined;
      if (a) areaName = a.area_name;
    }

    const remarks = String(body.remarks || '').trim();
    const rawLines = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    if (rawLines.length === 0) {
      throw new Error('Add at least one party item to create a Town Supply.');
    }

    // Group lines by party_account_id so multiple bookings of the same party combine into one party_supplies record
    const linesByParty = new Map<
      number,
      {
        partyAccountId: number;
        partyName: string;
        areaName: string;
        bookingIds: Set<number>;
        bookingNumbers: Set<string>;
        lines: Array<{
          bookingId: number | null;
          bookingItemId: number | null;
          bookingNumber: string;
          itemId: number;
          itemCode: string;
          companyName: string;
          itemName: string;
          packing: string;
          orderedQty: number;
          supplyQty: number;
          bonusQty: number;
          tradePrice: number;
          discountPercent: number;
          discountAmount: number;
          amount: number;
          batchNumber: string;
          expiryDate: string;
          inventoryId: number | null;
        }>;
      }
    >();

    const impactedBookingIds = new Set<number>();

    for (const raw of rawLines) {
      const partyAccountId = Number(raw.party_account_id);
      if (!partyAccountId) throw new Error('Every supply line must have a valid Party selected.');

      const partyRow = db
        .prepare('SELECT id, account_name, area_name FROM accounts WHERE id = ?')
        .get(partyAccountId) as { id: number; account_name: string; area_name: string } | undefined;
      if (!partyRow) throw new Error(`Party Account #${partyAccountId} not found.`);

      const itemId = Number(raw.item_id);
      const itemRow = db
        .prepare('SELECT id, item_code, item_name, company_name, packing, trade_price, wholesale_price, retail_price FROM items WHERE id = ?')
        .get(itemId) as Record<string, unknown> | undefined;
      if (!itemRow) throw new Error(`Item #${itemId} not found.`);

      const supplyQty = round2(Math.max(0, Number(raw.supply_quantity ?? raw.quantity ?? 0)));
      if (supplyQty <= 0) continue;

      const bookingItemId = raw.booking_item_id ? Number(raw.booking_item_id) : null;
      let bookingId = raw.booking_id ? Number(raw.booking_id) : null;
      let bookingNumber = String(raw.booking_number || '').trim();
      let orderedQty = round2(Number(raw.ordered_quantity ?? supplyQty));

      // Validate booking item pending quantity to prevent duplicate conversion
      if (bookingItemId) {
        const bItem = db
          .prepare('SELECT * FROM supply_booking_items WHERE id = ?')
          .get(bookingItemId) as Record<string, unknown> | undefined;
        if (!bItem) throw new Error(`Booking item #${bookingItemId} not found.`);
        const pendingQty = round2(Number(bItem.pending_quantity || 0));
        if (supplyQty > pendingQty) {
          throw new Error(
            `Cannot supply ${supplyQty} of "${String(itemRow.item_name)}" from Booking — only ${pendingQty} pending.`
          );
        }
        bookingId = Number(bItem.booking_id);
        orderedQty = round2(Number(bItem.quantity || orderedQty));
        const bHeader = db
          .prepare('SELECT booking_number FROM supply_bookings WHERE id = ?')
          .get(bookingId) as { booking_number: string } | undefined;
        if (bHeader) bookingNumber = bHeader.booking_number;

        // Update booking item supplied & pending quantities
        const newSupplied = round2(Number(bItem.supplied_quantity || 0) + supplyQty);
        const newPending = round2(Math.max(0, Number(bItem.quantity || 0) - newSupplied));
        db.prepare(`
          UPDATE supply_booking_items
          SET supplied_quantity = ?,
              pending_quantity = ?
          WHERE id = ?
        `).run(newSupplied, newPending, bookingItemId);

        if (bookingId) impactedBookingIds.add(bookingId);
      }

      const bonusQty = round2(Math.max(0, Number(raw.bonus_quantity ?? raw.bonus ?? 0)));
      const tradePrice = round2(
        Math.max(
          0,
          Number(
            raw.trade_price ??
              itemRow.trade_price ??
              itemRow.wholesale_price ??
              itemRow.retail_price ??
              0
          )
        )
      );
      const discountPercent = round2(Math.max(0, Math.min(100, Number(raw.discount_percent ?? 0))));
      const gross = round2(supplyQty * tradePrice);
      const discountAmount = round2((gross * discountPercent) / 100);
      const amount = round2(gross - discountAmount);

      const stock = getItemStockSummary(itemId);

      if (!linesByParty.has(partyAccountId)) {
        linesByParty.set(partyAccountId, {
          partyAccountId,
          partyName: partyRow.account_name,
          areaName: String(partyRow.area_name || areaName || ''),
          bookingIds: new Set<number>(),
          bookingNumbers: new Set<string>(),
          lines: [],
        });
      }
      const group = linesByParty.get(partyAccountId)!;
      if (bookingId) group.bookingIds.add(bookingId);
      if (bookingNumber) group.bookingNumbers.add(bookingNumber);

      group.lines.push({
        bookingId,
        bookingItemId,
        bookingNumber,
        itemId,
        itemCode: String(itemRow.item_code || ''),
        companyName: String(itemRow.company_name || ''),
        itemName: String(itemRow.item_name || ''),
        packing: String(itemRow.packing || '1x1'),
        orderedQty,
        supplyQty,
        bonusQty,
        tradePrice,
        discountPercent,
        discountAmount,
        amount,
        batchNumber: String(raw.batch_number || stock.defaultBatchNumber),
        expiryDate: String(raw.expiry_date || stock.defaultExpiryDate),
        inventoryId: raw.inventory_id ? Number(raw.inventory_id) : stock.defaultInventoryId,
      });
    }

    if (linesByParty.size === 0) {
      throw new Error('Supply quantities must be greater than zero.');
    }

    // Update statuses of impacted bookings
    for (const bId of impactedBookingIds) {
      const remRow = db
        .prepare('SELECT COALESCE(SUM(pending_quantity), 0) as rem, COALESCE(SUM(supplied_quantity), 0) as sup FROM supply_booking_items WHERE booking_id = ?')
        .get(bId) as { rem: number; sup: number };
      const newStatus =
        Number(remRow.rem) <= 0.001
          ? 'Supplied'
          : Number(remRow.sup) > 0
          ? 'Partially Supplied'
          : 'Booking Pending';
      db.prepare('UPDATE supply_bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        newStatus,
        bId
      );
    }

    // Calculate Town Supply header totals
    let totalParties = 0;
    let totalItems = 0;
    let totalOrderedQty = 0;
    let totalSupplyQty = 0;
    let totalBonusQty = 0;
    let grossAmount = 0;
    let discountAmount = 0;
    let totalSupplyAmount = 0;

    for (const [, pGroup] of linesByParty) {
      totalParties++;
      for (const l of pGroup.lines) {
        totalItems++;
        totalOrderedQty = round2(totalOrderedQty + l.orderedQty);
        totalSupplyQty = round2(totalSupplyQty + l.supplyQty);
        totalBonusQty = round2(totalBonusQty + l.bonusQty);
        grossAmount = round2(grossAmount + round2(l.supplyQty * l.tradePrice));
        discountAmount = round2(discountAmount + l.discountAmount);
        totalSupplyAmount = round2(totalSupplyAmount + l.amount);
      }
    }

    const insertTownSupply = db
      .prepare(`
        INSERT INTO town_supplies (
          supply_number, supply_date, salesman_id, salesman_name,
          town_id, town_name, area_id, area_name,
          total_parties, total_items, total_ordered_qty, total_supply_qty, total_bonus_qty,
          gross_amount, discount_amount, total_supply_amount,
          total_return_qty, total_return_amount, net_billable_amount,
          total_billed_amount, total_recovered_amount,
          packing_status, supply_status, stock_deducted, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 'Pending', 'Packing Pending', 0, ?)
      `)
      .run(
        supplyNumber,
        supplyDate,
        salesmanId,
        salesmanName,
        townId,
        townName,
        areaId,
        areaName,
        totalParties,
        totalItems,
        totalOrderedQty,
        totalSupplyQty,
        totalBonusQty,
        grossAmount,
        discountAmount,
        totalSupplyAmount,
        totalSupplyAmount,
        remarks
      );

    const townSupplyId = Number(insertTownSupply.lastInsertRowid);

    const insertPartySupply = db.prepare(`
      INSERT INTO party_supplies (
        town_supply_id, supply_number, party_supply_number, supply_date,
        salesman_id, salesman_name, town_id, town_name, area_id, area_name,
        party_account_id, party_name, booking_ids_json, booking_numbers,
        total_items, ordered_qty, supply_qty, bonus_qty,
        gross_amount, discount_amount, supply_amount,
        return_qty, return_amount, net_billable_amount,
        billed_amount, recovered_amount,
        packing_status, delivery_status, supply_status, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 'Pending', 'Pending', 'Packing Pending', ?)
    `);

    const insertPartyItem = db.prepare(`
      INSERT INTO party_supply_items (
        town_supply_id, party_supply_id, booking_id, booking_item_id, booking_number,
        party_account_id, party_name, s_no, item_id, inventory_id,
        item_code, company_name, item_name, packing, batch_number, expiry_date,
        ordered_quantity, supply_quantity, bonus_quantity,
        packed_quantity, remaining_pack_quantity, packing_status,
        returned_quantity, accepted_return_qty, damaged_return_qty,
        billed_quantity, net_billable_qty,
        trade_price, discount_percent, discount_amount, amount,
        return_amount, net_billable_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Pending', 0, 0, 0, 0, ?, ?, ?, ?, ?, 0, ?)
    `);

    let pIdx = 1;
    for (const [, pGroup] of linesByParty) {
      const partySupplyNumber = `${supplyNumber}-P${String(pIdx).padStart(2, '0')}`;
      pIdx++;

      const pOrderedQty = round2(pGroup.lines.reduce((s, l) => s + l.orderedQty, 0));
      const pSupplyQty = round2(pGroup.lines.reduce((s, l) => s + l.supplyQty, 0));
      const pBonusQty = round2(pGroup.lines.reduce((s, l) => s + l.bonusQty, 0));
      const pGross = round2(pGroup.lines.reduce((s, l) => s + round2(l.supplyQty * l.tradePrice), 0));
      const pDisc = round2(pGroup.lines.reduce((s, l) => s + l.discountAmount, 0));
      const pAmount = round2(pGroup.lines.reduce((s, l) => s + l.amount, 0));

      const psRes = insertPartySupply.run(
        townSupplyId,
        supplyNumber,
        partySupplyNumber,
        supplyDate,
        salesmanId,
        salesmanName,
        townId,
        townName,
        areaId,
        pGroup.areaName,
        pGroup.partyAccountId,
        pGroup.partyName,
        JSON.stringify(Array.from(pGroup.bookingIds)),
        Array.from(pGroup.bookingNumbers).join(', '),
        pGroup.lines.length,
        pOrderedQty,
        pSupplyQty,
        pBonusQty,
        pGross,
        pDisc,
        pAmount,
        pAmount,
        remarks
      );

      const partySupplyId = Number(psRes.lastInsertRowid);

      pGroup.lines.forEach((l, idx) => {
        insertPartyItem.run(
          townSupplyId,
          partySupplyId,
          l.bookingId,
          l.bookingItemId,
          l.bookingNumber,
          pGroup.partyAccountId,
          pGroup.partyName,
          idx + 1,
          l.itemId,
          l.inventoryId,
          l.itemCode,
          l.companyName,
          l.itemName,
          l.packing,
          l.batchNumber,
          l.expiryDate,
          l.orderedQty,
          l.supplyQty,
          l.bonusQty,
          l.supplyQty, // remaining_pack_quantity
          l.supplyQty, // net_billable_qty
          l.tradePrice,
          l.discountPercent,
          l.discountAmount,
          l.amount,
          l.amount // net_billable_amount
        );
      });
    }

    recordAudit(
      req,
      'SUPPLY_TOWN_SUPPLY_CREATED',
      `Created Town Supply ${supplyNumber} for Town ${townName} (${totalParties} parties, Rs. ${totalSupplyAmount})`
    );

    return hydrateTownSupply(townSupplyId);
  });

  try {
    const supply = tx(req.body || {});
    res.status(201).json({ success: true, supply });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 6. PACKING MANAGEMENT (Reserves stock without duplicate deduction)
// ============================================================================

/**
 * POST /api/supply/supplies/:id/pack
 * Marks individual items, party orders, or full Town Supply as packed.
 * Validates against available stock and updates inventory.reserved_pack_qty.
 */
supplyRouter.post('/supplies/:id/pack', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((townSupplyId: number, body: Record<string, unknown>) => {
    const supply = db
      .prepare('SELECT * FROM town_supplies WHERE id = ?')
      .get(townSupplyId) as Record<string, unknown> | undefined;
    if (!supply) throw new Error('Town Supply not found.');
    if (Number(supply.stock_deducted) === 1) {
      throw new Error('This supply has already been dispatched and stock deducted.');
    }

    const packAll = Boolean(body.pack_all);
    const partySupplyIdFilter = body.party_supply_id ? Number(body.party_supply_id) : null;
    const itemUpdates = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];

    const allItems = db
      .prepare('SELECT * FROM party_supply_items WHERE town_supply_id = ? ORDER BY id ASC')
      .all(townSupplyId) as Array<Record<string, unknown>>;

    for (const item of allItems) {
      const rowId = Number(item.id);
      const itemId = Number(item.item_id);
      const requiredQty = round2(Number(item.supply_quantity || 0));
      const oldPackedQty = round2(Number(item.packed_quantity || 0));

      let targetPackedQty = oldPackedQty;
      if (packAll) {
        targetPackedQty = requiredQty;
      } else if (partySupplyIdFilter && Number(item.party_supply_id) === partySupplyIdFilter) {
        targetPackedQty = requiredQty;
      } else {
        const match = itemUpdates.find((u) => Number(u.id || u.party_supply_item_id) === rowId);
        if (match && match.packed_quantity !== undefined) {
          targetPackedQty = round2(Math.max(0, Number(match.packed_quantity)));
        }
      }

      if (targetPackedQty > requiredQty) {
        throw new Error(
          `Packed quantity (${targetPackedQty}) cannot exceed required Supply quantity (${requiredQty}) for "${String(item.item_name)}".`
        );
      }

      const deltaPack = round2(targetPackedQty - oldPackedQty);
      if (Math.abs(deltaPack) > 0.0001) {
        // Check available stock if increasing packed quantity
        if (deltaPack > 0) {
          const stock = getItemStockSummary(itemId);
          if (deltaPack > stock.netPackablePacks && !body.allow_negative_stock) {
            throw new Error(
              `Insufficient available stock to pack "${String(item.item_name)}". Available unreserved stock: ${stock.netPackablePacks} Packs, Additional needed: ${deltaPack} Packs.`
            );
          }
        }

        // Reserve stock on primary inventory batch
        const batchRow = db
          .prepare(`
            SELECT * FROM inventory
            WHERE item_id = ?
            ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END, expiry_date ASC, id ASC
            LIMIT 1
          `)
          .get(itemId) as Record<string, unknown> | undefined;

        if (batchRow) {
          const newReserved = round2(Math.max(0, Number(batchRow.reserved_pack_qty || 0) + deltaPack));
          db.prepare('UPDATE inventory SET reserved_pack_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            newReserved,
            Number(batchRow.id)
          );
        }

        const remainingPack = round2(Math.max(0, requiredQty - targetPackedQty));
        const itemPackStatus =
          remainingPack <= 0.001 ? 'Packed' : targetPackedQty > 0 ? 'Partial' : 'Pending';

        db.prepare(`
          UPDATE party_supply_items
          SET packed_quantity = ?,
              remaining_pack_quantity = ?,
              packing_status = ?
          WHERE id = ?
        `).run(targetPackedQty, remainingPack, itemPackStatus, rowId);
      }
    }

    // Recompute party_supplies packing_status
    const partySupplies = db
      .prepare('SELECT id FROM party_supplies WHERE town_supply_id = ?')
      .all(townSupplyId) as Array<{ id: number }>;

    for (const ps of partySupplies) {
      const pItems = db
        .prepare('SELECT supply_quantity, packed_quantity FROM party_supply_items WHERE party_supply_id = ?')
        .all(ps.id) as Array<{ supply_quantity: number; packed_quantity: number }>;
      const reqSum = round2(pItems.reduce((s, i) => s + Number(i.supply_quantity || 0), 0));
      const pckSum = round2(pItems.reduce((s, i) => s + Number(i.packed_quantity || 0), 0));
      const pStatus = pckSum >= reqSum - 0.001 ? 'Packed' : pckSum > 0 ? 'Partial' : 'Pending';
      const sStatus = pStatus === 'Packed' ? 'Ready for Dispatch' : 'Packing Pending';
      db.prepare('UPDATE party_supplies SET packing_status = ?, supply_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        pStatus,
        sStatus,
        ps.id
      );
    }

    // Recompute town_supplies packing_status and supply_status
    const townTotals = db
      .prepare('SELECT COALESCE(SUM(supply_quantity), 0) as req, COALESCE(SUM(packed_quantity), 0) as pck FROM party_supply_items WHERE town_supply_id = ?')
      .get(townSupplyId) as { req: number; pck: number };

    const townPackStatus =
      Number(townTotals.pck) >= Number(townTotals.req) - 0.001
        ? 'Packed'
        : Number(townTotals.pck) > 0
        ? 'Partial'
        : 'Pending';
    const townSupplyStatus =
      townPackStatus === 'Packed' ? 'Ready for Dispatch' : 'Packing Pending';

    db.prepare(`
      UPDATE town_supplies
      SET packing_status = ?,
          supply_status = ?,
          packed_by = ?,
          packed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      townPackStatus,
      townSupplyStatus,
      String((req as AuthenticatedRequest).user?.full_name || 'Store Packer'),
      townSupplyId
    );

    recordAudit(
      req,
      'SUPPLY_PACKING_UPDATED',
      `Packing updated for Supply ${String(supply.supply_number)}: ${townPackStatus} (${townSupplyStatus})`
    );

    return hydrateTownSupply(townSupplyId);
  });

  try {
    const supply = tx(Number(req.params.id), req.body || {});
    res.json({ success: true, supply });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 7. DISPATCH / SUPPLY DELIVERY (Deducts stock from inventory ONCE)
// ============================================================================

supplyRouter.get('/dispatches', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();

    let rows = db
      .prepare('SELECT * FROM supply_dispatches ORDER BY dispatch_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;

    if (fromDate) rows = rows.filter((r) => String(r.dispatch_date) >= fromDate);
    if (toDate) rows = rows.filter((r) => String(r.dispatch_date) <= toDate);
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.dispatch_number || '').toLowerCase().includes(q) ||
          String(r.supply_number || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q) ||
          String(r.vehicle_number || '').toLowerCase().includes(q) ||
          String(r.delivery_person || '').toLowerCase().includes(q)
      );
    }

    const enriched = rows.map((d) => {
      const items = db
        .prepare('SELECT * FROM supply_dispatch_items WHERE dispatch_id = ? ORDER BY id ASC')
        .all(Number(d.id));
      const partySupplies = db
        .prepare('SELECT * FROM party_supplies WHERE town_supply_id = ? ORDER BY id ASC')
        .all(Number(d.town_supply_id));
      return { ...d, items, party_supplies: partySupplies };
    });

    res.json({ success: true, dispatches: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/supply/dispatches
 * Dispatches a Town Supply, generates Dispatch Number, deducts stock from inventory ONCE,
 * and releases reserved_pack_qty.
 */
supplyRouter.post('/dispatches', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const townSupplyId = Number(body.town_supply_id);
    if (!townSupplyId) throw new Error('Select a Supply Number to dispatch.');

    const supply = db
      .prepare('SELECT * FROM town_supplies WHERE id = ?')
      .get(townSupplyId) as Record<string, unknown> | undefined;
    if (!supply) throw new Error('Town Supply not found.');

    if (Number(supply.stock_deducted) === 1 || String(supply.supply_status) === 'Dispatched') {
      throw new Error(`Supply ${String(supply.supply_number)} has already been dispatched. Duplicate dispatch is prevented.`);
    }

    const dispatchDate = String(body.dispatch_date || new Date().toISOString().slice(0, 10));
    const dispatchNumber =
      String(body.dispatch_number || '').trim() ||
      getNextSeqNumber('supply_dispatches', 'dispatch_number', 'DSP');
    const vehicleNumber = String(body.vehicle_number || '').trim();
    const deliveryPerson = String(body.delivery_person || supply.salesman_name || '').trim();
    const remarks = String(body.remarks || '').trim();

    const items = db
      .prepare('SELECT * FROM party_supply_items WHERE town_supply_id = ? ORDER BY id ASC')
      .all(townSupplyId) as Array<Record<string, unknown>>;

    if (items.length === 0) throw new Error('No items found in this Town Supply.');

    // Auto-pack any unpacked items if dispatching directly, and deduct stock ONCE
    for (const line of items) {
      const itemId = Number(line.item_id);
      const supplyQty = round2(Number(line.supply_quantity || 0));
      const bonusQty = round2(Number(line.bonus_quantity || 0));
      const totalPackToDeduct = round2(supplyQty + bonusQty);
      const previouslyReserved = round2(Number(line.packed_quantity || 0));

      const itemRow = db
        .prepare('SELECT id, item_name, packing, minimum_stock FROM items WHERE id = ?')
        .get(itemId) as { id: number; item_name: string; packing: string; minimum_stock: number } | undefined;
      const parsed = parsePacking(String(itemRow?.packing || line.packing || '1x1'));
      const totalUnitsToDeduct = round2(totalPackToDeduct * parsed.unitsPerPack);

      const todayIso = new Date().toISOString().slice(0, 10);
      const allBatches = db
        .prepare(`
          SELECT * FROM inventory
          WHERE item_id = ?
            AND COALESCE(is_blocked, 0) = 0
            AND COALESCE(batch_status, 'Active') != 'Blocked'
            AND (expiry_date IS NULL OR expiry_date = '' OR expiry_date >= ?)
          ORDER BY CASE WHEN total_stock_units > 0 THEN 0 ELSE 1 END,
                   COALESCE(NULLIF(purchase_date, ''), substr(created_at, 1, 10), '1970-01-01') ASC,
                   id ASC
        `)
        .all(itemId, todayIso) as Array<Record<string, unknown>>;

      const totalAvailUnits = allBatches.reduce((s, b) => s + Number(b.total_stock_units || 0), 0);
      if (totalUnitsToDeduct > totalAvailUnits && !body.allow_negative_stock) {
        throw new Error(
          `Insufficient eligible FIFO stock to dispatch "${String(line.item_name)}". Required: ${totalPackToDeduct} Packs, Available Eligible (Non-Expired/Unblocked): ${round2(totalAvailUnits / parsed.unitsPerPack)} Packs.`
        );
      }

      // Release reserved_pack_qty first
      if (previouslyReserved > 0 && allBatches.length > 0) {
        const firstBatch = allBatches[0];
        const newRes = round2(Math.max(0, Number(firstBatch.reserved_pack_qty || 0) - previouslyReserved));
        db.prepare('UPDATE inventory SET reserved_pack_qty = ? WHERE id = ?').run(newRes, Number(firstBatch.id));
      }

      // Deduct stock across batches in strict FIFO order (oldest purchase/receipt date first)
      let remainingUnits = totalUnitsToDeduct;
      let remainingBonusPacks = bonusQty;
      const minStock = Number(itemRow?.minimum_stock || 0);

      if (allBatches.length > 0) {
        for (let bIdx = 0; bIdx < allBatches.length; bIdx++) {
          if (remainingUnits <= 0) break;
          const bRow = allBatches[bIdx];
          const bId = Number(bRow.id);
          const bCurrentUnits = round2(Number(bRow.total_stock_units || 0));
          const isLast = bIdx === allBatches.length - 1;

          let deductUnits = 0;
          if (bCurrentUnits >= remainingUnits) deductUnits = remainingUnits;
          else if (bCurrentUnits > 0 && !isLast) deductUnits = bCurrentUnits;
          else if (isLast) deductUnits = remainingUnits;

          if (deductUnits > 0) {
            remainingUnits = round2(remainingUnits - deductUnits);
            const packSoldEq = round2(deductUnits / parsed.unitsPerPack);
            const bonusPortion = round2(Math.min(remainingBonusPacks, packSoldEq));
            remainingBonusPacks = round2(Math.max(0, remainingBonusPacks - bonusPortion));
            const salePortion = round2(Math.max(0, packSoldEq - bonusPortion));

            const newSoldQty = round2(Number(bRow.sold_qty || 0) + packSoldEq);
            const newDispatchedQty = round2(Number(bRow.dispatched_pack_qty || 0) + packSoldEq);
            const newTotalUnits = round2(bCurrentUnits - deductUnits);
            const newPackQty = round2(newTotalUnits / parsed.unitsPerPack);
            const newStripQty = round2(newPackQty * parsed.stripsPerBox);
            const newLooseQty = round2(newTotalUnits % parsed.unitsPerPack);
            const status = computeBatchStatus(newPackQty, String(bRow.expiry_date || ''), minStock);
            const batchStatus = newPackQty <= 0 ? 'Exhausted' : status === 'expired' ? 'Expired' : 'Active';

            db.prepare(`
              UPDATE inventory
              SET sold_qty = ?,
                  dispatched_pack_qty = ?,
                  current_pack_qty = ?,
                  current_strip_qty = ?,
                  current_loose_qty = ?,
                  total_stock_units = ?,
                  status = ?,
                  batch_status = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(newSoldQty, newDispatchedQty, newPackQty, newStripQty, newLooseQty, newTotalUnits, status, batchStatus, bId);

            recordBatchStockMovement({
              movement_date: dispatchDate,
              item_id: itemId,
              item_code: String(line.item_code || ''),
              item_name: String(line.item_name || itemRow?.item_name || ''),
              company_name: String(line.company_name || ''),
              inventory_id: bId,
              batch_number: String(bRow.batch_number || line.batch_number || 'BATCH-1'),
              expiry_date: String(bRow.expiry_date || ''),
              purchase_date: String(bRow.purchase_date || ''),
              movement_type: 'DISPATCH_OUT',
              reference_type: 'SUPPLY_DISPATCH',
              reference_id: townSupplyId,
              reference_number: dispatchNumber,
              party_account_id: Number(line.party_account_id || 0) || null,
              party_name: String(line.party_name || ''),
              salesman_id: Number(supply.salesman_id || 0) || null,
              salesman_name: String(supply.salesman_name || ''),
              town_name: String(supply.town_name || ''),
              quantity_packs: salePortion,
              bonus_packs: bonusPortion,
              total_units: -deductUnits,
              purchase_rate: Number(bRow.cost_price || 0),
              trade_price: Number(line.trade_price || bRow.trade_price || 0),
              balance_after_packs: newPackQty,
              remarks: `Supply ${String(supply.supply_number)} Dispatched (${dispatchNumber})`,
              performed_by: deliveryPerson || 'Dispatcher',
            });
          }
        }
      }

      // Mark item as fully packed
      db.prepare(`
        UPDATE party_supply_items
        SET packed_quantity = supply_quantity,
            remaining_pack_quantity = 0,
            packing_status = 'Packed'
        WHERE id = ?
      `).run(Number(line.id));
    }

    const totalQuantity = round2(Number(supply.total_supply_qty || 0) + Number(supply.total_bonus_qty || 0));
    const insertDispatch = db
      .prepare(`
        INSERT INTO supply_dispatches (
          dispatch_number, town_supply_id, supply_number, dispatch_date,
          salesman_id, salesman_name, town_id, town_name,
          vehicle_number, delivery_person,
          total_parties, total_items, total_quantity, total_amount,
          delivery_status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Dispatched', ?)
      `)
      .run(
        dispatchNumber,
        townSupplyId,
        String(supply.supply_number),
        dispatchDate,
        supply.salesman_id,
        supply.salesman_name,
        supply.town_id,
        supply.town_name,
        vehicleNumber,
        deliveryPerson,
        Number(supply.total_parties || 0),
        Number(supply.total_items || 0),
        totalQuantity,
        round2(Number(supply.total_supply_amount || 0)),
        remarks
      );

    const dispatchId = Number(insertDispatch.lastInsertRowid);

    const insertDispItem = db.prepare(`
      INSERT INTO supply_dispatch_items (
        dispatch_id, town_supply_id, party_supply_id, party_supply_item_id,
        supply_number, party_account_id, party_name, s_no, item_id, inventory_id,
        item_code, company_name, item_name, packing, batch_number, expiry_date,
        ordered_quantity, packed_quantity, packed_qty,
        dispatched_quantity, dispatched_qty, bonus_quantity, bonus_qty,
        trade_price, discount_percent, discount_amount, amount, delivery_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Dispatched')
    `);

    for (const line of items) {
      const dispQty = round2(Number(line.supply_quantity || 0));
      const bonusQty = round2(Number(line.bonus_quantity || 0));
      insertDispItem.run(
        dispatchId,
        townSupplyId,
        Number(line.party_supply_id),
        Number(line.id),
        String(supply.supply_number || ''),
        Number(line.party_account_id),
        String(line.party_name || ''),
        Number(line.s_no || 1),
        Number(line.item_id),
        line.inventory_id ? Number(line.inventory_id) : null,
        String(line.item_code || ''),
        String(line.company_name || ''),
        String(line.item_name || ''),
        String(line.packing || '1x1'),
        String(line.batch_number || ''),
        String(line.expiry_date || ''),
        round2(Number(line.ordered_quantity || dispQty)),
        dispQty,
        dispQty,
        dispQty,
        dispQty,
        bonusQty,
        bonusQty,
        round2(Number(line.trade_price || 0)),
        round2(Number(line.discount_percent || 0)),
        round2(Number(line.discount_amount || 0)),
        round2(Number(line.amount || 0))
      );
    }

    db.prepare(`
      UPDATE party_supplies
      SET packing_status = 'Packed',
          delivery_status = 'Dispatched',
          supply_status = 'Dispatched',
          updated_at = CURRENT_TIMESTAMP
      WHERE town_supply_id = ?
    `).run(townSupplyId);

    db.prepare(`
      UPDATE town_supplies
      SET packing_status = 'Packed',
          supply_status = 'Dispatched',
          stock_deducted = 1,
          dispatched_by = ?,
          dispatched_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      deliveryPerson || String((req as AuthenticatedRequest).user?.full_name || 'Dispatcher'),
      townSupplyId
    );

    recordAudit(
      req,
      'SUPPLY_DISPATCHED',
      `Dispatched Supply ${String(supply.supply_number)} via Dispatch ${dispatchNumber} (stock deducted once)`
    );

    return {
      dispatch: db.prepare('SELECT * FROM supply_dispatches WHERE id = ?').get(dispatchId),
      supply: hydrateTownSupply(townSupplyId),
    };
  });

  try {
    const result = tx(req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.patch('/dispatches/:id/delivery', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dispatchId = Number(req.params.id);
    const body = req.body || {};
    const deliveryStatus = ['Dispatched', 'Delivered', 'Pending'].includes(String(body.delivery_status))
      ? String(body.delivery_status)
      : 'Delivered';
    const partySupplyId = body.party_supply_id ? Number(body.party_supply_id) : null;

    const dispatch = db
      .prepare('SELECT * FROM supply_dispatches WHERE id = ?')
      .get(dispatchId) as Record<string, unknown> | undefined;
    if (!dispatch) return res.status(404).json({ success: false, error: 'Dispatch record not found.' });

    if (partySupplyId) {
      db.prepare('UPDATE party_supplies SET delivery_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        deliveryStatus,
        partySupplyId
      );
      db.prepare('UPDATE supply_dispatch_items SET delivery_status = ? WHERE dispatch_id = ? AND party_supply_id = ?').run(
        deliveryStatus,
        dispatchId,
        partySupplyId
      );
    } else {
      db.prepare('UPDATE supply_dispatches SET delivery_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        deliveryStatus,
        dispatchId
      );
      db.prepare('UPDATE party_supplies SET delivery_status = ?, updated_at = CURRENT_TIMESTAMP WHERE town_supply_id = ?').run(
        deliveryStatus,
        Number(dispatch.town_supply_id)
      );
      db.prepare('UPDATE supply_dispatch_items SET delivery_status = ? WHERE dispatch_id = ?').run(
        deliveryStatus,
        dispatchId
      );
    }

    res.json({
      success: true,
      supply: hydrateTownSupply(Number(dispatch.town_supply_id)),
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 8. SALES RETURN FROM SALESMAN (Restores saleable stock, isolates damaged stock)
// ============================================================================

supplyRouter.get('/returns', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();

    let rows = db
      .prepare('SELECT * FROM supply_returns ORDER BY return_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;

    if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
    if (townId) rows = rows.filter((r) => Number(r.town_id) === townId);
    if (partyId) rows = rows.filter((r) => Number(r.party_account_id) === partyId);
    if (fromDate) rows = rows.filter((r) => String(r.return_date) >= fromDate);
    if (toDate) rows = rows.filter((r) => String(r.return_date) <= toDate);
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.return_number || '').toLowerCase().includes(q) ||
          String(r.supply_number || '').toLowerCase().includes(q) ||
          String(r.party_name || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q)
      );
    }

    const enriched = rows.map((r) => ({
      ...r,
      items: db
        .prepare('SELECT * FROM supply_return_items WHERE supply_return_id = ? ORDER BY id ASC')
        .all(Number(r.id)),
    }));

    res.json({ success: true, returns: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/supply/returns
 * Records salesman return against original Supply Number.
 * Prevents returning more than remaining unbilled supplied quantity.
 * Restores accepted saleable returns to inventory; tracks damaged returns separately.
 */
supplyRouter.post('/returns', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const townSupplyId = Number(body.town_supply_id);
    if (!townSupplyId) throw new Error('Select an original Supply Number for the return.');

    const supply = db
      .prepare('SELECT * FROM town_supplies WHERE id = ?')
      .get(townSupplyId) as Record<string, unknown> | undefined;
    if (!supply) throw new Error('Original Town Supply not found.');
    if (Number(supply.stock_deducted) !== 1) {
      throw new Error('Cannot record a Salesman Return before the Supply has been Dispatched.');
    }

    const returnDate = String(body.return_date || new Date().toISOString().slice(0, 10));
    const returnNumber =
      String(body.return_number || '').trim() ||
      getNextSeqNumber('supply_returns', 'return_number', 'SRT');
    const remarks = String(body.remarks || '').trim();

    const rawLines = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    if (rawLines.length === 0) throw new Error('Enter at least one return item.');

    let totalReturnedQty = 0;
    let totalAcceptedQty = 0;
    let totalDamagedQty = 0;
    let totalReturnAmount = 0;
    let headerPartySupplyId: number | null = body.party_supply_id ? Number(body.party_supply_id) : null;
    let headerPartyAccountId: number | null = body.party_account_id ? Number(body.party_account_id) : null;
    let headerPartyName = String(body.party_name || '');

    const validatedLines: Array<{
      psItem: Record<string, unknown>;
      newReturnQty: number;
      acceptedQty: number;
      damagedQty: number;
      returnReason: string;
      returnAmount: number;
    }> = [];

    for (const raw of rawLines) {
      const psItemId = Number(raw.party_supply_item_id || raw.id);
      const psItem = db
        .prepare('SELECT * FROM party_supply_items WHERE id = ? AND town_supply_id = ?')
        .get(psItemId, townSupplyId) as Record<string, unknown> | undefined;
      if (!psItem) throw new Error(`Supply line item #${psItemId} not found in Supply ${String(supply.supply_number)}.`);

      const suppliedQty = round2(Number(psItem.supply_quantity || 0));
      const prevReturnedQty = round2(Number(psItem.returned_quantity || 0));
      const prevBilledQty = round2(Number(psItem.billed_quantity || 0));
      const maxReturnable = round2(Math.max(0, suppliedQty - prevReturnedQty - prevBilledQty));

      const newReturnQty = round2(Math.max(0, Number(raw.new_return_quantity ?? raw.return_quantity ?? 0)));
      if (newReturnQty <= 0) continue;

      if (newReturnQty > maxReturnable + 0.001) {
        throw new Error(
          `Return quantity (${newReturnQty}) for "${String(psItem.item_name)}" exceeds remaining returnable quantity (${maxReturnable}). (Supplied: ${suppliedQty}, Prev Returned: ${prevReturnedQty}, Billed: ${prevBilledQty})`
        );
      }

      const damagedQty = round2(Math.max(0, Math.min(newReturnQty, Number(raw.damaged_quantity || 0))));
      const acceptedQty =
        raw.accepted_quantity !== undefined
          ? round2(Math.max(0, Number(raw.accepted_quantity)))
          : round2(newReturnQty - damagedQty);

      if (Math.abs(acceptedQty + damagedQty - newReturnQty) > 0.01) {
        throw new Error(
          `For "${String(psItem.item_name)}", Accepted Quantity (${acceptedQty}) + Damaged Quantity (${damagedQty}) must equal New Return Quantity (${newReturnQty}).`
        );
      }

      const tradePrice = round2(Number(psItem.trade_price || 0));
      const discPct = round2(Number(psItem.discount_percent || 0));
      const netRate = round2(tradePrice * (1 - discPct / 100));
      // Both accepted and damaged goods returned from party reduce the party's billable amount
      const returnAmount = round2(newReturnQty * netRate);

      totalReturnedQty = round2(totalReturnedQty + newReturnQty);
      totalAcceptedQty = round2(totalAcceptedQty + acceptedQty);
      totalDamagedQty = round2(totalDamagedQty + damagedQty);
      totalReturnAmount = round2(totalReturnAmount + returnAmount);

      if (!headerPartySupplyId) headerPartySupplyId = Number(psItem.party_supply_id);
      if (!headerPartyAccountId) headerPartyAccountId = Number(psItem.party_account_id);
      if (!headerPartyName) headerPartyName = String(psItem.party_name || '');

      validatedLines.push({
        psItem,
        newReturnQty,
        acceptedQty,
        damagedQty,
        returnReason: String(raw.return_reason || 'Unsold / Party Return').trim(),
        returnAmount,
      });
    }

    if (validatedLines.length === 0) {
      throw new Error('Enter a New Return Quantity greater than 0 for at least one item.');
    }

    const insertReturn = db
      .prepare(`
        INSERT INTO supply_returns (
          return_number, return_date, town_supply_id, party_supply_id, supply_number,
          salesman_id, salesman_name, town_id, town_name,
          party_account_id, party_name,
          total_returned_qty, total_accepted_qty, total_damaged_qty, total_return_amount,
          stock_restored, status, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Completed', ?)
      `)
      .run(
        returnNumber,
        returnDate,
        townSupplyId,
        headerPartySupplyId,
        String(supply.supply_number),
        supply.salesman_id,
        supply.salesman_name,
        supply.town_id,
        supply.town_name,
        headerPartyAccountId,
        headerPartyName,
        totalReturnedQty,
        totalAcceptedQty,
        totalDamagedQty,
        totalReturnAmount,
        remarks
      );

    const supplyReturnId = Number(insertReturn.lastInsertRowid);

    const insertReturnItem = db.prepare(`
      INSERT INTO supply_return_items (
        supply_return_id, town_supply_id, party_supply_id, party_supply_item_id,
        party_account_id, party_name, item_id, inventory_id,
        item_code, company_name, item_name, packing, batch_number,
        supplied_quantity, previously_returned_qty, new_return_quantity,
        accepted_quantity, damaged_quantity,
        trade_price, discount_percent, return_amount, return_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const v of validatedLines) {
      const { psItem, newReturnQty, acceptedQty, damagedQty, returnReason, returnAmount } = v;
      const itemId = Number(psItem.item_id);
      const parsed = parsePacking(String(psItem.packing || '1x1'));

      insertReturnItem.run(
        supplyReturnId,
        townSupplyId,
        Number(psItem.party_supply_id),
        Number(psItem.id),
        Number(psItem.party_account_id),
        String(psItem.party_name || ''),
        itemId,
        psItem.inventory_id ? Number(psItem.inventory_id) : null,
        String(psItem.item_code || ''),
        String(psItem.company_name || ''),
        String(psItem.item_name || ''),
        String(psItem.packing || '1x1'),
        String(psItem.batch_number || ''),
        round2(Number(psItem.supply_quantity || 0)),
        round2(Number(psItem.returned_quantity || 0)),
        newReturnQty,
        acceptedQty,
        damagedQty,
        round2(Number(psItem.trade_price || 0)),
        round2(Number(psItem.discount_percent || 0)),
        returnAmount,
        returnReason
      );

      // Update party_supply_items
      const updatedReturned = round2(Number(psItem.returned_quantity || 0) + newReturnQty);
      const updatedAccepted = round2(Number(psItem.accepted_return_qty || 0) + acceptedQty);
      const updatedDamaged = round2(Number(psItem.damaged_return_qty || 0) + damagedQty);
      const updatedReturnAmt = round2(Number(psItem.return_amount || 0) + returnAmount);
      const updatedNetBillableQty = round2(
        Math.max(0, Number(psItem.supply_quantity || 0) - updatedReturned)
      );
      const updatedNetBillableAmt = round2(
        Math.max(0, Number(psItem.amount || 0) - updatedReturnAmt)
      );

      db.prepare(`
        UPDATE party_supply_items
        SET returned_quantity = ?,
            accepted_return_qty = ?,
            damaged_return_qty = ?,
            net_billable_qty = ?,
            return_amount = ?,
            net_billable_amount = ?
        WHERE id = ?
      `).run(
        updatedReturned,
        updatedAccepted,
        updatedDamaged,
        updatedNetBillableQty,
        updatedReturnAmt,
        updatedNetBillableAmt,
        Number(psItem.id)
      );

      // Restore accepted saleable stock to inventory; record damaged_pack_qty separately
      const batchRow = db
        .prepare(`
          SELECT * FROM inventory
          WHERE item_id = ?
          ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `)
        .get(itemId, Number(psItem.inventory_id || 0)) as Record<string, unknown> | undefined;

      if (batchRow) {
        const acceptedUnits = round2(acceptedQty * parsed.unitsPerPack);
        const newTotalUnits = round2(Number(batchRow.total_stock_units || 0) + acceptedUnits);
        const newPackQty = round2(newTotalUnits / parsed.unitsPerPack);
        const newStripQty = round2(newPackQty * parsed.stripsPerBox);
        const newLooseQty = round2(newTotalUnits % parsed.unitsPerPack);
        const newReturnedQty = round2(Number(batchRow.returned_qty || 0) + acceptedQty);
        const newSoldQty = round2(Math.max(0, Number(batchRow.sold_qty || 0) - acceptedQty));
        const newDamagedQty = round2(Number(batchRow.damaged_pack_qty || 0) + damagedQty);

        const itemMinRow = db
          .prepare('SELECT minimum_stock FROM items WHERE id = ?')
          .get(itemId) as { minimum_stock: number } | undefined;
        const status = computeBatchStatus(
          newPackQty,
          String(batchRow.expiry_date || ''),
          Number(itemMinRow?.minimum_stock || 0)
        );

        db.prepare(`
          UPDATE inventory
          SET sold_qty = ?,
              returned_qty = ?,
              damaged_pack_qty = ?,
              current_pack_qty = ?,
              current_strip_qty = ?,
              current_loose_qty = ?,
              total_stock_units = ?,
              status = ?,
              batch_status = CASE WHEN ? > 0 AND batch_status = 'Exhausted' THEN 'Active' ELSE batch_status END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          newSoldQty,
          newReturnedQty,
          newDamagedQty,
          newPackQty,
          newStripQty,
          newLooseQty,
          newTotalUnits,
          status,
          newPackQty,
          Number(batchRow.id)
        );

        if (acceptedQty > 0) {
          recordBatchStockMovement({
            movement_date: returnDate,
            item_id: itemId,
            item_code: String(psItem.item_code || ''),
            item_name: String(psItem.item_name || ''),
            company_name: String(psItem.company_name || ''),
            inventory_id: Number(batchRow.id),
            batch_number: String(batchRow.batch_number || psItem.batch_number || 'BATCH-1'),
            expiry_date: String(batchRow.expiry_date || ''),
            purchase_date: String(batchRow.purchase_date || ''),
            movement_type: 'RETURN_IN_SALEABLE',
            reference_type: 'SUPPLY_RETURN',
            reference_id: supplyReturnId,
            reference_number: returnNumber,
            party_account_id: Number(psItem.party_account_id || 0) || null,
            party_name: String(psItem.party_name || ''),
            salesman_id: Number(supply.salesman_id || 0) || null,
            salesman_name: String(supply.salesman_name || ''),
            town_name: String(supply.town_name || ''),
            quantity_packs: acceptedQty,
            bonus_packs: 0,
            total_units: acceptedUnits,
            purchase_rate: Number(batchRow.cost_price || 0),
            trade_price: Number(psItem.trade_price || batchRow.trade_price || 0),
            balance_after_packs: newPackQty,
            remarks: `Saleable Return (${returnNumber}): ${returnReason}`,
            performed_by: String((req as AuthenticatedRequest).user?.full_name || 'Admin'),
          });
        }

        if (damagedQty > 0) {
          recordBatchStockMovement({
            movement_date: returnDate,
            item_id: itemId,
            item_code: String(psItem.item_code || ''),
            item_name: String(psItem.item_name || ''),
            company_name: String(psItem.company_name || ''),
            inventory_id: Number(batchRow.id),
            batch_number: String(batchRow.batch_number || psItem.batch_number || 'BATCH-1'),
            expiry_date: String(batchRow.expiry_date || ''),
            purchase_date: String(batchRow.purchase_date || ''),
            movement_type: 'RETURN_DAMAGED',
            reference_type: 'SUPPLY_RETURN',
            reference_id: supplyReturnId,
            reference_number: returnNumber,
            party_account_id: Number(psItem.party_account_id || 0) || null,
            party_name: String(psItem.party_name || ''),
            salesman_id: Number(supply.salesman_id || 0) || null,
            salesman_name: String(supply.salesman_name || ''),
            town_name: String(supply.town_name || ''),
            quantity_packs: damagedQty,
            bonus_packs: 0,
            total_units: 0,
            purchase_rate: Number(batchRow.cost_price || 0),
            trade_price: Number(psItem.trade_price || batchRow.trade_price || 0),
            balance_after_packs: newPackQty,
            remarks: `Damaged Return Isolated (${returnNumber}): ${returnReason}`,
            performed_by: String((req as AuthenticatedRequest).user?.full_name || 'Admin'),
          });
        }
      }
    }

    // Recompute party_supplies return totals
    const partySupplies = db
      .prepare('SELECT id, supply_amount, billed_amount FROM party_supplies WHERE town_supply_id = ?')
      .all(townSupplyId) as Array<{ id: number; supply_amount: number; billed_amount: number }>;

    for (const ps of partySupplies) {
      const sums = db
        .prepare(`
          SELECT COALESCE(SUM(returned_quantity), 0) as ret_qty,
                 COALESCE(SUM(return_amount), 0) as ret_amt,
                 COALESCE(SUM(net_billable_amount), 0) as net_amt
          FROM party_supply_items
          WHERE party_supply_id = ?
        `)
        .get(ps.id) as { ret_qty: number; ret_amt: number; net_amt: number };

      const pStatus =
        Number(ps.billed_amount) > 0
          ? 'Partially Billed'
          : Number(sums.ret_qty) > 0
          ? 'Partially Returned'
          : 'Dispatched';

      db.prepare(`
        UPDATE party_supplies
        SET return_qty = ?,
            return_amount = ?,
            net_billable_amount = ?,
            supply_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(round2(sums.ret_qty), round2(sums.ret_amt), round2(sums.net_amt), pStatus, ps.id);
    }

    // Recompute town_supplies return totals
    const townSums = db
      .prepare(`
        SELECT COALESCE(SUM(returned_quantity), 0) as ret_qty,
               COALESCE(SUM(return_amount), 0) as ret_amt,
               COALESCE(SUM(net_billable_amount), 0) as net_amt
        FROM party_supply_items
        WHERE town_supply_id = ?
      `)
      .get(townSupplyId) as { ret_qty: number; ret_amt: number; net_amt: number };

    db.prepare(`
      UPDATE town_supplies
      SET total_return_qty = ?,
          total_return_amount = ?,
          net_billable_amount = ?,
          supply_status = CASE WHEN total_billed_amount > 0 THEN 'Partially Billed' ELSE 'Partially Returned' END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(round2(townSums.ret_qty), round2(townSums.ret_amt), round2(townSums.net_amt), townSupplyId);

    recordAudit(
      req,
      'SUPPLY_RETURN_RECORDED',
      `Salesman Return ${returnNumber} against Supply ${String(supply.supply_number)}: Returned=${totalReturnedQty} (Accepted=${totalAcceptedQty}, Damaged=${totalDamagedQty}), Rs. ${totalReturnAmount}`
    );

    return {
      returnRecord: db.prepare('SELECT * FROM supply_returns WHERE id = ?').get(supplyReturnId),
      supply: hydrateTownSupply(townSupplyId),
    };
  });

  try {
    const result = tx(req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 9. FINAL BILLING / INVOICE COMPLETION (Posts to Sales & Accounts WITHOUT duplicate stock deduction)
// ============================================================================

/**
 * POST /api/supply/supplies/:id/finalize-billing
 * Generates separate final Sales Invoices for each party from actual delivered quantities
 * (Original Supply Amount - Accepted/Returned Amount = Final Net Bill).
 * Supports full billing, partial billing, or selected-item billing.
 * Prevents duplicate billing and does NOT deduct stock a second time.
 */
supplyRouter.post('/supplies/:id/finalize-billing', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((townSupplyId: number, body: Record<string, unknown>) => {
    const supply = db
      .prepare('SELECT * FROM town_supplies WHERE id = ?')
      .get(townSupplyId) as Record<string, unknown> | undefined;
    if (!supply) throw new Error('Town Supply not found.');
    if (Number(supply.stock_deducted) !== 1) {
      throw new Error('Please dispatch the Town Supply before generating Final Billing.');
    }

    const invoiceDate = String(body.invoice_date || new Date().toISOString().slice(0, 10));
    const partySupplyIdFilter = body.party_supply_id ? Number(body.party_supply_id) : null;
    const itemOverrides = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];

    let partySupplies = db
      .prepare('SELECT * FROM party_supplies WHERE town_supply_id = ? ORDER BY id ASC')
      .all(townSupplyId) as Array<Record<string, unknown>>;

    if (partySupplyIdFilter) {
      partySupplies = partySupplies.filter((ps) => Number(ps.id) === partySupplyIdFilter);
    }

    if (partySupplies.length === 0) {
      throw new Error('No party supply records found to bill.');
    }

    const generatedInvoices: Array<Record<string, unknown>> = [];

    const salesIncomeAccountId = getSystemAccountId('INC-4010');
    const salesDiscountAccountId = getSystemAccountId('DIS-5015');
    const cogsAccountId = getSystemAccountId('EXP-5005');
    const inventoryAssetAccountId = getSystemAccountId('INV-1030');

    for (const ps of partySupplies) {
      const psId = Number(ps.id);
      const customerAccountId = Number(ps.party_account_id);
      const customerRow = db
        .prepare('SELECT * FROM accounts WHERE id = ?')
        .get(customerAccountId) as Record<string, unknown> | undefined;
      if (!customerRow) throw new Error(`Customer account #${customerAccountId} not found.`);

      const psItems = db
        .prepare('SELECT * FROM party_supply_items WHERE party_supply_id = ? ORDER BY s_no ASC')
        .all(psId) as Array<Record<string, unknown>>;

      const linesToBill: Array<{
        psItem: Record<string, unknown>;
        billQty: number;
        bonusQty: number;
        unitPrice: number;
        discPct: number;
        grossAmount: number;
        discAmount: number;
        lineTotal: number;
        unitsPerPack: number;
        totalUnits: number;
        costPricePerUnit: number;
      }> = [];

      for (const psItem of psItems) {
        const psItemId = Number(psItem.id);
        const netBillableQty = round2(
          Math.max(0, Number(psItem.supply_quantity || 0) - Number(psItem.returned_quantity || 0))
        );
        const alreadyBilledQty = round2(Number(psItem.billed_quantity || 0));
        const remainingBillableQty = round2(Math.max(0, netBillableQty - alreadyBilledQty));

        if (remainingBillableQty <= 0) continue;

        let billQty = remainingBillableQty;
        if (itemOverrides.length > 0) {
          const override = itemOverrides.find(
            (o) => Number(o.party_supply_item_id || o.id) === psItemId
          );
          if (!override) continue;
          if (override.bill_quantity !== undefined) {
            billQty = round2(Math.max(0, Number(override.bill_quantity)));
          }
        }

        if (billQty <= 0) continue;
        if (billQty > remainingBillableQty + 0.001) {
          throw new Error(
            `Cannot bill ${billQty} of "${String(psItem.item_name)}" for ${String(ps.party_name)} — only ${remainingBillableQty} remaining unbilled.`
          );
        }

        const itemRow = db
          .prepare('SELECT packing, purchase_price FROM items WHERE id = ?')
          .get(Number(psItem.item_id)) as { packing: string; purchase_price: number } | undefined;
        const parsed = parsePacking(String(psItem.packing || itemRow?.packing || '1x1'));
        const unitPrice = round2(Number(psItem.trade_price || 0));
        const discPct = round2(Number(psItem.discount_percent || 0));
        const grossAmount = round2(billQty * unitPrice);
        const discAmount = round2((grossAmount * discPct) / 100);
        const lineTotal = round2(grossAmount - discAmount);
        const bonusQty = alreadyBilledQty === 0 ? round2(Number(psItem.bonus_quantity || 0)) : 0;
        const totalUnits = round2((billQty + bonusQty) * parsed.unitsPerPack);
        const costPricePerUnit = round2(Number(itemRow?.purchase_price || 0) / parsed.unitsPerPack);

        linesToBill.push({
          psItem,
          billQty,
          bonusQty,
          unitPrice,
          discPct,
          grossAmount,
          discAmount,
          lineTotal,
          unitsPerPack: parsed.unitsPerPack,
          totalUnits,
          costPricePerUnit,
        });
      }

      if (linesToBill.length === 0) continue;

      const invoiceNumber = allocateNextInvoiceNumber('SALE', invoiceDate);

      const grossTotal = round2(linesToBill.reduce((s, l) => s + l.grossAmount, 0));
      const itemDiscountTotal = round2(linesToBill.reduce((s, l) => s + l.discAmount, 0));
      const taxableAmount = round2(Math.max(0, grossTotal - itemDiscountTotal));
      const netTotal = taxableAmount;

      recalculateAccountBalance(customerAccountId);
      const freshCust = db
        .prepare('SELECT current_balance, current_balance_type, filer_status FROM accounts WHERE id = ?')
        .get(customerAccountId) as {
        current_balance: number;
        current_balance_type: 'Debit' | 'Credit';
        filer_status: string;
      };

      const prevBalance = round2(Number(freshCust?.current_balance || 0));
      const prevType = freshCust?.current_balance_type || 'Debit';
      const signedPrev = prevType === 'Debit' ? prevBalance : -prevBalance;
      const totalReceivable = round2(signedPrev + netTotal);

      const insertSale = db.prepare(`
        INSERT INTO sales (
          invoice_number, invoice_date, customer_account_id, customer_name,
          customer_filer_status, salesman_id, salesman,
          delivery_status, delivery_date,
          invoice_type, payment_mode,
          gross_total, item_discount_amount, discount_amount, taxable_amount,
          gst_amount, tax_amount, net_total,
          previous_customer_balance, previous_balance_type,
          total_receivable, paid_amount, balance_amount,
          status, remarks,
          town_supply_id, party_supply_id, supply_number, town_name, area_name, stock_deducted_at_dispatch
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          'Delivered', ?,
          'Wholesale', 'Credit',
          ?, ?, ?, ?,
          0, 0, ?,
          ?, ?,
          ?, 0, ?,
          'completed', ?,
          ?, ?, ?, ?, ?, 1
        )
      `);

      const saleRes = insertSale.run(
        invoiceNumber,
        invoiceDate,
        customerAccountId,
        String(ps.party_name),
        String(freshCust?.filer_status || 'Non-Filer'),
        supply.salesman_id,
        String(supply.salesman_name || ''),
        invoiceDate,
        grossTotal,
        itemDiscountTotal,
        itemDiscountTotal,
        taxableAmount,
        netTotal,
        prevBalance,
        prevType,
        totalReceivable,
        totalReceivable,
        `Final Bill against Supply ${String(supply.supply_number)} (${String(ps.party_supply_number)})`,
        townSupplyId,
        psId,
        String(supply.supply_number),
        String(supply.town_name || ''),
        String(ps.area_name || supply.area_name || '')
      );

      const saleId = Number(saleRes.lastInsertRowid);
      bindInvoiceNumberRecordId(invoiceNumber, 'SALE', saleId);

      const insertSaleItem = db.prepare(`
        INSERT INTO sale_items (
          sale_id, item_id, inventory_id, item_code, company_name, item_name,
          packing, units_per_pack, batch_number, expiry_date,
          available_stock_packs, available_stock_units,
          quantity, bonus_quantity, unit_price, discount_percent, discount_amount,
          loose_quantity, loose_rate, total_units, cost_price_per_unit,
          gross_amount, taxable_amount, tax_percent, tax_amount, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 0, 0, ?)
      `);

      for (const l of linesToBill) {
        insertSaleItem.run(
          saleId,
          Number(l.psItem.item_id),
          l.psItem.inventory_id ? Number(l.psItem.inventory_id) : null,
          String(l.psItem.item_code || ''),
          String(l.psItem.company_name || ''),
          String(l.psItem.item_name || ''),
          String(l.psItem.packing || '1x1'),
          l.unitsPerPack,
          String(l.psItem.batch_number || ''),
          String(l.psItem.expiry_date || '2028-12-31'),
          l.billQty,
          l.bonusQty,
          l.unitPrice,
          l.discPct,
          l.discAmount,
          l.totalUnits,
          l.costPricePerUnit,
          l.grossAmount,
          l.lineTotal,
          l.lineTotal
        );

        // Update party_supply_items billed_quantity
        const newBilledQty = round2(Number(l.psItem.billed_quantity || 0) + l.billQty);
        db.prepare('UPDATE party_supply_items SET billed_quantity = ? WHERE id = ?').run(
          newBilledQty,
          Number(l.psItem.id)
        );
      }

      // Post Double-Entry Journal Entry for Final Bill
      if (netTotal > 0) {
        const totalCogs = round2(linesToBill.reduce((s, l) => s + l.totalUnits * l.costPricePerUnit, 0));
        const jeTotalSide = round2(
          (itemDiscountTotal > 0 ? grossTotal : taxableAmount) + totalCogs
        );
        const jeNumber = getNextJournalNumber('JE-SAL');
        const jeRes = db
          .prepare(`
            INSERT INTO journal_entries (
              entry_number, entry_date, reference_type, reference_id, description,
              total_debit, total_credit, is_balanced, status
            ) VALUES (?, ?, 'SALE', ?, ?, ?, ?, 1, 'posted')
          `)
          .run(
            jeNumber,
            invoiceDate,
            saleId,
            `Supply Final Bill ${invoiceNumber} (Supply ${String(supply.supply_number)} - ${String(ps.party_name)})`,
            jeTotalSide,
            jeTotalSide
          );
        const journalEntryId = Number(jeRes.lastInsertRowid);

        const insertJeLine = db.prepare(`
          INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);

        insertJeLine.run(
          journalEntryId,
          customerAccountId,
          'customer',
          netTotal,
          0,
          `Final Sales Invoice ${invoiceNumber} (Supply ${String(supply.supply_number)})`
        );

        if (itemDiscountTotal > 0) {
          insertJeLine.run(
            journalEntryId,
            salesDiscountAccountId,
            'general',
            itemDiscountTotal,
            0,
            `Discount on Supply Invoice ${invoiceNumber}`
          );
        }

        const salesCredit = itemDiscountTotal > 0 ? grossTotal : taxableAmount;
        insertJeLine.run(
          journalEntryId,
          salesIncomeAccountId,
          'general',
          0,
          salesCredit,
          `Medicine Sales Revenue (${invoiceNumber})`
        );

        if (totalCogs > 0) {
          insertJeLine.run(journalEntryId, cogsAccountId, 'general', totalCogs, 0, `COGS for ${invoiceNumber}`);
          insertJeLine.run(
            journalEntryId,
            inventoryAssetAccountId,
            'general',
            0,
            totalCogs,
            `Inventory dispatched for ${invoiceNumber}`
          );
        }

        db.prepare('UPDATE sales SET journal_entry_id = ? WHERE id = ?').run(journalEntryId, saleId);
        recalculateAccountBalance(customerAccountId);
        recalculateAccountBalance(salesIncomeAccountId);
        if (itemDiscountTotal > 0) recalculateAccountBalance(salesDiscountAccountId);
      }

      // Update party_supplies billing status
      const pCheck = db
        .prepare(`
          SELECT COALESCE(SUM(net_billable_qty), 0) as net_qty,
                 COALESCE(SUM(billed_quantity), 0) as billed_qty
          FROM party_supply_items
          WHERE party_supply_id = ?
        `)
        .get(psId) as { net_qty: number; billed_qty: number };

      const newBilledAmt = round2(Number(ps.billed_amount || 0) + netTotal);
      const isFullyBilled = Number(pCheck.billed_qty) >= Number(pCheck.net_qty) - 0.001;
      const pStatus = isFullyBilled ? 'Fully Billed' : 'Partially Billed';

      db.prepare(`
        UPDATE party_supplies
        SET billed_amount = ?,
            final_sale_id = COALESCE(final_sale_id, ?),
            final_invoice_number = CASE WHEN COALESCE(TRIM(final_invoice_number), '') = '' THEN ? ELSE final_invoice_number || ', ' || ? END,
            delivery_status = 'Delivered',
            supply_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newBilledAmt, saleId, invoiceNumber, invoiceNumber, pStatus, psId);

      const createdSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, unknown>;
      generatedInvoices.push(createdSale);
    }

    if (generatedInvoices.length === 0) {
      throw new Error('All deliverable items in this selection have already been billed.');
    }

    // Recompute town_supplies billed amount and status
    const townCheck = db
      .prepare(`
        SELECT COALESCE(SUM(net_billable_qty), 0) as net_qty,
               COALESCE(SUM(billed_quantity), 0) as billed_qty
        FROM party_supply_items
        WHERE town_supply_id = ?
      `)
      .get(townSupplyId) as { net_qty: number; billed_qty: number };

    const townBilledSum = db
      .prepare('SELECT COALESCE(SUM(billed_amount), 0) as billed_amt FROM party_supplies WHERE town_supply_id = ?')
      .get(townSupplyId) as { billed_amt: number };

    const isTownFullyBilled = Number(townCheck.billed_qty) >= Number(townCheck.net_qty) - 0.001;
    const newTownStatus = isTownFullyBilled ? 'Fully Billed' : 'Partially Billed';

    db.prepare(`
      UPDATE town_supplies
      SET total_billed_amount = ?,
          supply_status = ?,
          billed_by = ?,
          billed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      round2(townBilledSum.billed_amt),
      newTownStatus,
      String((req as AuthenticatedRequest).user?.full_name || 'Billing Officer'),
      townSupplyId
    );

    recordAudit(
      req,
      'SUPPLY_FINAL_BILLING_COMPLETED',
      `Generated ${generatedInvoices.length} Final Sales Invoice(s) for Supply ${String(supply.supply_number)}`
    );

    return {
      invoices: generatedInvoices,
      supply: hydrateTownSupply(townSupplyId),
    };
  });

  try {
    const result = tx(Number(req.params.id), req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 10 & 11. RECOVERY / COLLECTION MANAGEMENT & 3 RECOVERY REPORTS
// ============================================================================

supplyRouter.get('/recoveries', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const supplyNumber = String(req.query.supply_number || '').trim().toLowerCase();
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();
    const unsettledOnly = req.query.unsettled_only === '1' || req.query.unsettled_only === 'true';

    let rows = db
      .prepare('SELECT * FROM supply_recoveries ORDER BY recovery_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;

    if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
    if (townId) rows = rows.filter((r) => Number(r.town_id) === townId);
    if (partyId) rows = rows.filter((r) => Number(r.party_account_id) === partyId);
    if (supplyNumber) rows = rows.filter((r) => String(r.supply_number || '').toLowerCase().includes(supplyNumber));
    if (fromDate) rows = rows.filter((r) => String(r.recovery_date) >= fromDate);
    if (toDate) rows = rows.filter((r) => String(r.recovery_date) <= toDate);
    if (unsettledOnly) rows = rows.filter((r) => Number(r.is_settled || 0) === 0 && String(r.status) === 'Posted');
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.recovery_receipt_number || '').toLowerCase().includes(q) ||
          String(r.party_name || '').toLowerCase().includes(q) ||
          String(r.salesman_name || '').toLowerCase().includes(q) ||
          String(r.town_name || '').toLowerCase().includes(q) ||
          String(r.supply_number || '').toLowerCase().includes(q) ||
          String(r.invoice_number || '').toLowerCase().includes(q)
      );
    }

    res.json({ success: true, recoveries: rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/supply/recoveries
 * Posts one or multiple Recovery Receipts (supports Party-Wise, Town-Wise multi-party sheet, or Supply Number-Wise).
 * Updates Party ledger, Payment Vouchers, Cashbook, Sales paid_amount, and Supply recovered_amount.
 */
supplyRouter.post('/recoveries', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const entries: Array<Record<string, unknown>> = Array.isArray(body.entries)
      ? (body.entries as Array<Record<string, unknown>>)
      : [body];

    const createdRecoveries: Array<Record<string, unknown>> = [];

    for (const entry of entries) {
      const recoveryAmount = round2(Math.max(0, Number(entry.recovery_amount || 0)));
      if (recoveryAmount <= 0) continue;

      const partyAccountId = Number(entry.party_account_id || 0);
      if (!partyAccountId) throw new Error('Party Name is required for Recovery entry.');

      const partyRow = db
        .prepare(
          'SELECT id, account_code, account_name, town_id, town_name, city, area_id, area_name, assigned_salesman_id, assigned_salesman_name FROM accounts WHERE id = ?'
        )
        .get(partyAccountId) as Record<string, unknown> | undefined;
      if (!partyRow) throw new Error(`Party account #${partyAccountId} not found.`);

      recalculateAccountBalance(partyAccountId);
      const freshParty = db
        .prepare('SELECT current_balance, current_balance_type FROM accounts WHERE id = ?')
        .get(partyAccountId) as { current_balance: number; current_balance_type: 'Debit' | 'Credit' };

      const previousOutstanding = round2(
        freshParty.current_balance_type === 'Debit'
          ? Number(freshParty.current_balance || 0)
          : -Number(freshParty.current_balance || 0)
      );
      const remainingBalance = round2(previousOutstanding - recoveryAmount);

      const recoveryDate = String(
        entry.recovery_date || body.recovery_date || new Date().toISOString().slice(0, 10)
      );
      const receiptNumber =
        String(entry.recovery_receipt_number || '').trim() ||
        getNextSeqNumber('supply_recoveries', 'receipt_number', 'REC');

      const salesmanId =
        Number(entry.salesman_id || body.salesman_id || partyRow.assigned_salesman_id || 0) || null;
      let salesmanName = String(
        entry.salesman_name || body.salesman_name || partyRow.assigned_salesman_name || ''
      ).trim();
      if (salesmanId && !salesmanName) {
        const s = db.prepare("SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) as full_name FROM salesmen WHERE id = ?").get(salesmanId) as { full_name: string } | undefined;
        if (s) salesmanName = s.full_name;
      }

      const townId = Number(entry.town_id || body.town_id || partyRow.town_id || 0) || null;
      const townName = String(
        entry.town_name || body.town_name || partyRow.town_name || partyRow.city || ''
      ).trim();
      const areaId = Number(entry.area_id || body.area_id || partyRow.area_id || 0) || null;
      const areaName = String(entry.area_name || body.area_name || partyRow.area_name || '').trim();

      const townSupplyId = entry.town_supply_id ? Number(entry.town_supply_id) : null;
      const partySupplyId = entry.party_supply_id ? Number(entry.party_supply_id) : null;
      let supplyNumber = String(entry.supply_number || '').trim();
      if (townSupplyId && !supplyNumber) {
        const ts = db.prepare('SELECT supply_number FROM town_supplies WHERE id = ?').get(townSupplyId) as
          | { supply_number: string }
          | undefined;
        if (ts) supplyNumber = ts.supply_number;
      }

      const saleId = entry.sale_id ? Number(entry.sale_id) : null;
      let invoiceNumber = String(entry.invoice_number || '').trim();
      if (saleId && !invoiceNumber) {
        const sl = db.prepare('SELECT invoice_number FROM sales WHERE id = ?').get(saleId) as
          | { invoice_number: string }
          | undefined;
        if (sl) invoiceNumber = sl.invoice_number;
      }

      const paymentMethod = (['Cash', 'Bank', 'Cheque', 'Online'].includes(String(entry.payment_method || body.payment_method))
        ? String(entry.payment_method || body.payment_method)
        : 'Cash') as string;
      const pvPaymentMethod = paymentMethod === 'Bank' ? 'Bank Transfer' : paymentMethod;

      let paymentAccountId = entry.payment_account_id
        ? Number(entry.payment_account_id)
        : body.payment_account_id
        ? Number(body.payment_account_id)
        : null;
      if (!paymentAccountId) {
        paymentAccountId =
          paymentMethod === 'Cash' ? getSystemAccountId('FIN-1010') : getSystemAccountId('FIN-1021');
      }

      const payAccRow = db
        .prepare('SELECT id, account_code, account_name FROM accounts WHERE id = ?')
        .get(paymentAccountId) as { id: number; account_code: string; account_name: string } | undefined;
      const paymentAccountCode = String(payAccRow?.account_code || (paymentMethod === 'Cash' ? 'FIN-1010' : 'FIN-1021'));
      const paymentAccountName = String(payAccRow?.account_name || (paymentMethod === 'Cash' ? 'Cash in Hand' : 'Bank Account'));

      const remarks = String(entry.remarks || body.remarks || '').trim();

      // 1. Post Double-Entry Journal Entry (Debit Cash/Bank, Credit Party Account)
      const jeNumber = getNextJournalNumber('JE-REC');
      const jeDesc = `Recovery Receipt ${receiptNumber} from ${String(partyRow.account_name)}${
        supplyNumber ? ` (Supply ${supplyNumber})` : ''
      }${invoiceNumber ? ` [Inv ${invoiceNumber}]` : ''}`;

      const jeRes = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id, description,
            total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(jeNumber, recoveryDate, partyAccountId, jeDesc, recoveryAmount, recoveryAmount);
      const journalEntryId = Number(jeRes.lastInsertRowid);

      const insertJeLine = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      insertJeLine.run(journalEntryId, paymentAccountId, 'general', recoveryAmount, 0, jeDesc);
      insertJeLine.run(journalEntryId, partyAccountId, 'customer', 0, recoveryAmount, jeDesc);

      // 2. Create Payment Voucher
      const voucherNumber = getNextVoucherNumber();
      const pvRes = db
        .prepare(`
          INSERT INTO payment_vouchers (
            voucher_number, voucher_date, voucher_type, party_account_id, financial_account_id,
            amount, payment_method, reference_number, description, journal_entry_id, status
          ) VALUES (?, ?, 'customer_receipt', ?, ?, ?, ?, ?, ?, ?, 'posted')
        `)
        .run(
          voucherNumber,
          recoveryDate,
          partyAccountId,
          paymentAccountId,
          recoveryAmount,
          pvPaymentMethod,
          invoiceNumber || supplyNumber || receiptNumber,
          jeDesc,
          journalEntryId
        );
      const paymentVoucherId = Number(pvRes.lastInsertRowid);

      // 3. Create Cash Book Voucher if Cash
      let cashBookVoucherId: number | null = null;
      if (paymentMethod === 'Cash') {
        const { nextSequence, nextVoucherNumber } = allocateContinuousCashBookVoucherNo(db);
        const cbRes = db
          .prepare(`
            INSERT INTO cash_book_vouchers (
              voucher_number, sequence_number, voucher_date, transaction_type, category,
              head_account_id, head_account_code, head_account_name,
              cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
              receipt_amount, payment_amount, net_amount,
              narration, reference_number, journal_entry_id, status, created_by
            ) VALUES (?, ?, ?, 'Receipt', 'customer_receipt', ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?, 'posted', ?)
          `)
          .run(
            nextVoucherNumber,
            nextSequence,
            recoveryDate,
            partyAccountId,
            String(partyRow.account_code || ''),
            String(partyRow.account_name),
            paymentAccountId,
            paymentAccountCode,
            paymentAccountName,
            recoveryAmount,
            recoveryAmount,
            jeDesc,
            receiptNumber,
            journalEntryId,
            salesmanName || 'Recovery Officer'
          );
        cashBookVoucherId = Number(cbRes.lastInsertRowid);
      }

      // 4. Insert supply_recoveries record (both canonical & UI alias columns)
      const createdByUser = String((req as AuthenticatedRequest).user?.full_name || salesmanName || 'Recovery Officer');
      const recRes = db
        .prepare(`
          INSERT INTO supply_recoveries (
            receipt_number, recovery_receipt_number, recovery_date,
            salesman_id, salesman_name, town_id, town_name, area_id, area_name,
            party_account_id, party_code, party_name,
            town_supply_id, party_supply_id, supply_number,
            sale_id, invoice_number,
            previous_outstanding, recovery_amount, remaining_balance,
            payment_method, financial_account_id, financial_account_name,
            payment_account_id, payment_account_name,
            journal_entry_id, payment_voucher_id, cash_book_voucher_id,
            is_settled, status, remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Posted', ?, ?)
        `)
        .run(
          receiptNumber,
          receiptNumber,
          recoveryDate,
          salesmanId,
          salesmanName,
          townId,
          townName,
          areaId,
          areaName,
          partyAccountId,
          String(partyRow.account_code || ''),
          String(partyRow.account_name),
          townSupplyId,
          partySupplyId,
          supplyNumber,
          saleId,
          invoiceNumber,
          previousOutstanding,
          recoveryAmount,
          remainingBalance,
          paymentMethod,
          paymentAccountId,
          paymentAccountName,
          paymentAccountId,
          paymentAccountName,
          journalEntryId,
          paymentVoucherId,
          cashBookVoucherId,
          remarks,
          createdByUser
        );

      const recoveryId = Number(recRes.lastInsertRowid);

      // 5. Update linked Sales Invoice paid_amount & balance_amount if saleId provided
      if (saleId) {
        const sRow = db
          .prepare('SELECT paid_amount, total_receivable FROM sales WHERE id = ?')
          .get(saleId) as { paid_amount: number; total_receivable: number } | undefined;
        if (sRow) {
          const newPaid = round2(Number(sRow.paid_amount || 0) + recoveryAmount);
          const newBal = round2(Number(sRow.total_receivable || 0) - newPaid);
          db.prepare('UPDATE sales SET paid_amount = ?, balance_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            newPaid,
            newBal,
            saleId
          );
        }
      }

      // 6. Update linked Party Supply & Town Supply recovered_amount
      if (partySupplyId) {
        db.prepare(`
          UPDATE party_supplies
          SET recovered_amount = ROUND(recovered_amount + ?, 2),
              supply_status = CASE
                WHEN supply_status = 'Fully Billed' AND ROUND(recovered_amount + ?, 2) >= net_billable_amount - 0.01 THEN 'Completed'
                ELSE supply_status
              END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(recoveryAmount, recoveryAmount, partySupplyId);
      }
      if (townSupplyId) {
        db.prepare(`
          UPDATE town_supplies
          SET total_recovered_amount = ROUND(total_recovered_amount + ?, 2),
              supply_status = CASE
                WHEN supply_status = 'Fully Billed' AND ROUND(total_recovered_amount + ?, 2) >= net_billable_amount - 0.01 THEN 'Completed'
                ELSE supply_status
              END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(recoveryAmount, recoveryAmount, townSupplyId);
      }

      recalculateAccountBalance(partyAccountId);
      recalculateAccountBalance(paymentAccountId);

      createdRecoveries.push(
        db.prepare('SELECT * FROM supply_recoveries WHERE id = ?').get(recoveryId) as Record<string, unknown>
      );
    }

    if (createdRecoveries.length === 0) {
      throw new Error('Enter a Recovery Amount greater than 0.');
    }

    recordAudit(
      req,
      'SUPPLY_RECOVERY_POSTED',
      `Posted ${createdRecoveries.length} Recovery Receipt(s)`
    );

    return createdRecoveries;
  });

  try {
    const recoveries = tx(req.body || {});
    res.status(201).json({ success: true, recoveries, recovery: recoveries[0] });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /api/supply/recovery-reports
 * Serves the 3 Specialized Recovery Reports:
 *   A. party-wise
 *   B. town-wise (with party-wise details under each Town)
 *   C. supply-wise (with multiple recovery entries per Supply Number)
 */
supplyRouter.get('/recovery-reports', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const type = String(req.query.type || 'party-wise');
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const supplyNumber = String(req.query.supply_number || '').trim().toLowerCase();

    if (type === 'party-wise') {
      let rows = db
        .prepare("SELECT * FROM supply_recoveries WHERE status = 'Posted' ORDER BY recovery_date DESC, id DESC")
        .all() as Array<Record<string, unknown>>;

      if (fromDate) rows = rows.filter((r) => String(r.recovery_date) >= fromDate);
      if (toDate) rows = rows.filter((r) => String(r.recovery_date) <= toDate);
      if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
      if (townId) rows = rows.filter((r) => Number(r.town_id) === townId);
      if (partyId) rows = rows.filter((r) => Number(r.party_account_id) === partyId);
      if (supplyNumber) rows = rows.filter((r) => String(r.supply_number || '').toLowerCase().includes(supplyNumber));

      const totalRecovered = round2(rows.reduce((s, r) => s + Number(r.recovery_amount || 0), 0));
      return res.json({
        success: true,
        type: 'party-wise',
        rows,
        totals: {
          count: rows.length,
          totalRecovered,
        },
      });
    }

    if (type === 'town-wise') {
      let towns = db.prepare('SELECT * FROM towns ORDER BY town_name ASC').all() as Array<Record<string, unknown>>;
      if (townId) towns = towns.filter((t) => Number(t.id) === townId);

      const townRows = towns.map((t) => {
        const tId = Number(t.id);
        const tName = String(t.town_name || '');

        const parties = db
          .prepare(`
            SELECT id, account_code, account_name, phone, area_name, assigned_salesman_name,
                   current_balance, current_balance_type
            FROM accounts
            WHERE account_type IN ('Customer', 'Customer & Supplier') AND is_system_account = 0
              AND (town_id = ? OR LOWER(town_name) = LOWER(?) OR LOWER(city) = LOWER(?))
            ORDER BY account_name ASC
          `)
          .all(tId, tName, tName) as Array<Record<string, unknown>>;

        const partyDetails = parties.map((p) => {
          const pId = Number(p.id);
          const pSupply = db
            .prepare(`
              SELECT COALESCE(SUM(supply_amount), 0) as sup,
                     COALESCE(SUM(return_amount), 0) as ret,
                     COALESCE(SUM(net_billable_amount), 0) as net_bill
              FROM party_supplies
              WHERE party_account_id = ? AND supply_status != 'Cancelled'
            `)
            .get(pId) as { sup: number; ret: number; net_bill: number };

          let recRows = db
            .prepare("SELECT * FROM supply_recoveries WHERE party_account_id = ? AND status = 'Posted'")
            .all(pId) as Array<Record<string, unknown>>;
          if (fromDate) recRows = recRows.filter((r) => String(r.recovery_date) >= fromDate);
          if (toDate) recRows = recRows.filter((r) => String(r.recovery_date) <= toDate);
          if (salesmanId) recRows = recRows.filter((r) => Number(r.salesman_id) === salesmanId);

          const pRecovered = round2(recRows.reduce((s, r) => s + Number(r.recovery_amount || 0), 0));
          const remBal = round2(
            p.current_balance_type === 'Debit'
              ? Number(p.current_balance || 0)
              : -Number(p.current_balance || 0)
          );

          return {
            party_account_id: pId,
            party_name: String(p.account_name),
            area_name: String(p.area_name || ''),
            salesman_name: String(p.assigned_salesman_name || ''),
            supplied_amount: round2(pSupply.sup),
            return_amount: round2(pSupply.ret),
            net_final_bill: round2(pSupply.net_bill),
            total_recovery: pRecovered,
            remaining_balance: Math.max(0, remBal),
            recoveries: recRows,
          };
        });

        return {
          town_id: tId,
          town_name: tName,
          total_parties: partyDetails.length,
          total_supplied_amount: round2(partyDetails.reduce((s, p) => s + p.supplied_amount, 0)),
          total_return_amount: round2(partyDetails.reduce((s, p) => s + p.return_amount, 0)),
          net_final_bill: round2(partyDetails.reduce((s, p) => s + p.net_final_bill, 0)),
          total_recovery: round2(partyDetails.reduce((s, p) => s + p.total_recovery, 0)),
          remaining_balance: round2(partyDetails.reduce((s, p) => s + p.remaining_balance, 0)),
          parties: partyDetails,
        };
      });

      return res.json({
        success: true,
        type: 'town-wise',
        rows: townRows,
      });
    }

    // C. supply-wise
    let supplies = db
      .prepare("SELECT * FROM town_supplies WHERE supply_status != 'Cancelled' ORDER BY supply_date DESC, id DESC")
      .all() as Array<Record<string, unknown>>;

    if (fromDate) supplies = supplies.filter((s) => String(s.supply_date) >= fromDate);
    if (toDate) supplies = supplies.filter((s) => String(s.supply_date) <= toDate);
    if (salesmanId) supplies = supplies.filter((s) => Number(s.salesman_id) === salesmanId);
    if (townId) supplies = supplies.filter((s) => Number(s.town_id) === townId);
    if (supplyNumber) {
      supplies = supplies.filter((s) => String(s.supply_number || '').toLowerCase().includes(supplyNumber));
    }

    const supplyRows = supplies.map((s) => {
      const tsId = Number(s.id);
      const recEntries = db
        .prepare("SELECT * FROM supply_recoveries WHERE town_supply_id = ? AND status = 'Posted' ORDER BY recovery_date ASC, id ASC")
        .all(tsId) as Array<Record<string, unknown>>;
      const totalRec = round2(recEntries.reduce((sum, r) => sum + Number(r.recovery_amount || 0), 0));
      const netBill = round2(Number(s.net_billable_amount || 0));
      const pendingBal = round2(Math.max(0, netBill - totalRec));

      return {
        town_supply_id: tsId,
        supply_number: String(s.supply_number),
        supply_date: String(s.supply_date),
        salesman_name: String(s.salesman_name || ''),
        town_name: String(s.town_name || ''),
        total_supply_amount: round2(Number(s.total_supply_amount || 0)),
        total_return_amount: round2(Number(s.total_return_amount || 0)),
        net_bill_amount: netBill,
        total_recovered_amount: totalRec,
        pending_balance: pendingBal,
        supply_status: String(s.supply_status),
        recovery_entries: recEntries,
      };
    });

    return res.json({
      success: true,
      type: 'supply-wise',
      rows: supplyRows,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 12. SALESMAN SETTLEMENT
// ============================================================================

supplyRouter.get('/settlements/preview', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const salesmanId = Number(req.query.salesman_id || 0);
    if (!salesmanId) {
      return res.status(400).json({ success: false, error: 'Select a Salesman to preview settlement.' });
    }

    const fromDate = String(req.query.from_date || new Date().toISOString().slice(0, 10));
    const toDate = String(req.query.to_date || new Date().toISOString().slice(0, 10));

    const salesman = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(salesmanId) as Record<string, unknown> | undefined;
    if (!salesman) return res.status(404).json({ success: false, error: 'Salesman not found.' });

    const suppliesRow = db
      .prepare(`
        SELECT COALESCE(SUM(total_supply_amount), 0) as sup_amt,
               COALESCE(SUM(total_return_amount), 0) as ret_amt,
               COALESCE(SUM(total_billed_amount), 0) as bill_amt
        FROM town_supplies
        WHERE salesman_id = ? AND supply_date BETWEEN ? AND ? AND supply_status != 'Cancelled'
      `)
      .get(salesmanId, fromDate, toDate) as { sup_amt: number; ret_amt: number; bill_amt: number };

    const unsettledRecoveries = db
      .prepare(`
        SELECT *
        FROM supply_recoveries
        WHERE salesman_id = ? AND recovery_date BETWEEN ? AND ? AND status = 'Posted' AND is_settled = 0
        ORDER BY recovery_date ASC, id ASC
      `)
      .all(salesmanId, fromDate, toDate) as Array<Record<string, unknown>>;

    const cashCollected = round2(
      unsettledRecoveries
        .filter((r) => String(r.payment_method) === 'Cash')
        .reduce((s, r) => s + Number(r.recovery_amount || 0), 0)
    );
    const bankCollected = round2(
      unsettledRecoveries
        .filter((r) => String(r.payment_method) !== 'Cash')
        .reduce((s, r) => s + Number(r.recovery_amount || 0), 0)
    );

    const assignedPartiesRow = db
      .prepare(`
        SELECT COALESCE(SUM(CASE WHEN a.current_balance_type = 'Debit' THEN a.current_balance ELSE -a.current_balance END), 0) as out_bal
        FROM accounts a
        WHERE a.assigned_salesman_id = ? AND a.account_type IN ('Customer', 'Customer & Supplier') AND a.is_system_account = 0
      `)
      .get(salesmanId) as { out_bal: number };

    res.json({
      success: true,
      preview: {
        salesman_id: salesmanId,
        salesman_name: String(salesman.full_name || salesman.name || ''),
        from_date: fromDate,
        to_date: toDate,
        total_supplies: round2(suppliesRow.sup_amt),
        total_returns: round2(suppliesRow.ret_amt),
        total_final_billing: round2(suppliesRow.bill_amt),
        total_cash_collected: cashCollected,
        total_bank_collections: bankCollected,
        total_outstanding: round2(Math.max(0, Number(assignedPartiesRow.out_bal || 0))),
        unsettled_recoveries: unsettledRecoveries,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.get('/settlements', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    let rows = db
      .prepare('SELECT * FROM salesman_settlements ORDER BY settlement_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;
    if (salesmanId) rows = rows.filter((r) => Number(r.salesman_id) === salesmanId);
    res.json({ success: true, settlements: rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

supplyRouter.post('/settlements', (req: Request, res: Response) => {
  const db = getDatabase();
  const tx = db.transaction((body: Record<string, unknown>) => {
    const salesmanId = Number(body.salesman_id || 0);
    if (!salesmanId) throw new Error('Salesman is required for Settlement.');

    const salesman = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(salesmanId) as Record<string, unknown> | undefined;
    if (!salesman) throw new Error('Salesman not found.');

    const settlementDate = String(body.settlement_date || new Date().toISOString().slice(0, 10));
    const fromDate = String(body.from_date || settlementDate);
    const toDate = String(body.to_date || settlementDate);
    const settlementNumber =
      String(body.settlement_number || '').trim() ||
      getNextSeqNumber('salesman_settlements', 'settlement_number', 'STL');

    const totalSupplies = round2(Number(body.total_supplies || 0));
    const totalReturns = round2(Number(body.total_returns || 0));
    const totalFinalBilling = round2(Number(body.total_final_billing || 0));
    const totalCashCollected = round2(Number(body.total_cash_collected || 0));
    const totalBankCollections = round2(Number(body.total_bank_collections || 0));
    const totalOutstanding = round2(Number(body.total_outstanding || 0));
    const cashSubmittedToStore = round2(Number(body.cash_submitted_to_store || 0));
    const remainingCashInHand = round2(Math.max(0, totalCashCollected - cashSubmittedToStore));
    const differenceAmount = round2(totalCashCollected - cashSubmittedToStore - remainingCashInHand);
    const remarks = String(body.remarks || '').trim();

    const salesmanDisplayName = String(salesman.full_name || salesman.name || '');
    const settledByUser = String((req as AuthenticatedRequest).user?.full_name || 'Super Admin');

    const insert = db
      .prepare(`
        INSERT INTO salesman_settlements (
          settlement_number, settlement_date, from_date, to_date,
          salesman_id, salesman_code, salesman_name,
          total_supplies, total_returns, total_final_billing,
          total_cash_collected, total_bank_collections, total_outstanding,
          cash_submitted_to_store, remaining_cash_in_hand, difference, difference_amount,
          status, created_by, settled_by, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Settled', ?, ?, ?)
      `)
      .run(
        settlementNumber,
        settlementDate,
        fromDate,
        toDate,
        salesmanId,
        String(salesman.salesman_code || ''),
        salesmanDisplayName,
        totalSupplies,
        totalReturns,
        totalFinalBilling,
        totalCashCollected,
        totalBankCollections,
        totalOutstanding,
        cashSubmittedToStore,
        remainingCashInHand,
        differenceAmount,
        differenceAmount,
        settledByUser,
        settledByUser,
        remarks
      );

    const settlementId = Number(insert.lastInsertRowid);

    // Mark unsettled recoveries in date range as settled
    db.prepare(`
      UPDATE supply_recoveries
      SET is_settled = 1,
          settlement_id = ?
      WHERE salesman_id = ? AND recovery_date BETWEEN ? AND ? AND status = 'Posted' AND is_settled = 0
    `).run(settlementId, salesmanId, fromDate, toDate);

    recordAudit(
      req,
      'SUPPLY_SALESMAN_SETTLED',
      `Completed Salesman Settlement ${settlementNumber} for ${salesmanDisplayName} (Cash Submitted: Rs. ${cashSubmittedToStore})`
    );

    return db.prepare('SELECT * FROM salesman_settlements WHERE id = ?').get(settlementId);
  });

  try {
    const settlement = tx(req.body || {});
    res.status(201).json({ success: true, settlement });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// 13. COMPLETE SUPPLY & DISTRIBUTION REPORTING ENGINE (All 38 Reports across 5 Categories)
// ============================================================================

supplyRouter.get('/reports/:category/:reportKey', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const category = String(req.params.category || '').toLowerCase();
    const reportKey = String(req.params.reportKey || '').toLowerCase();
    const fromDate = String(req.query.from_date || '').trim();
    const toDate = String(req.query.to_date || '').trim();
    const salesmanId = req.query.salesman_id ? Number(req.query.salesman_id) : null;
    const townId = req.query.town_id ? Number(req.query.town_id) : null;
    const areaId = req.query.area_id ? Number(req.query.area_id) : null;
    const partyId = req.query.party_account_id ? Number(req.query.party_account_id) : null;
    const supplyNumber = String(req.query.supply_number || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    let columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }> = [];
    let rows: Array<Record<string, unknown>> = [];

    // 1. BOOKING & ORDER REPORTS
    if (category === 'booking') {
      if (reportKey === 'order-form-report' || reportKey === 'company-wise-order-form') {
        let forms = db
          .prepare("SELECT * FROM supply_order_forms WHERE status != 'Cancelled' ORDER BY order_date DESC, id DESC")
          .all() as Array<Record<string, unknown>>;
        if (fromDate) forms = forms.filter((f) => String(f.order_date) >= fromDate);
        if (toDate) forms = forms.filter((f) => String(f.order_date) <= toDate);
        if (salesmanId) forms = forms.filter((f) => Number(f.salesman_id) === salesmanId);
        if (townId) forms = forms.filter((f) => Number(f.town_id) === townId);
        if (partyId) forms = forms.filter((f) => Number(f.party_account_id) === partyId);

        if (reportKey === 'company-wise-order-form') {
          columns = [
            { key: 'order_number', label: 'Order No' },
            { key: 'order_date', label: 'Date' },
            { key: 'company_name', label: 'Company Name' },
            { key: 'item_code', label: 'Item Code' },
            { key: 'item_name', label: 'Item Name' },
            { key: 'party_name', label: 'Party Name' },
            { key: 'town_name', label: 'Town' },
            { key: 'trade_price', label: 'Trade Price', align: 'right' },
            { key: 'quantity', label: 'Qty', align: 'right' },
            { key: 'amount', label: 'Amount', align: 'right' },
          ];
          for (const f of forms) {
            const items = db
              .prepare('SELECT * FROM supply_order_form_items WHERE order_form_id = ? ORDER BY company_name ASC, item_name ASC')
              .all(Number(f.id)) as Array<Record<string, unknown>>;
            for (const it of items) {
              rows.push({
                order_number: f.order_number,
                order_date: f.order_date,
                company_name: it.company_name,
                item_code: it.item_code,
                item_name: it.item_name,
                party_name: f.party_name || '-',
                town_name: f.town_name || '-',
                trade_price: round2(it.trade_price),
                quantity: round2(it.quantity),
                amount: round2(it.amount),
              });
            }
          }
        } else {
          columns = [
            { key: 'order_number', label: 'Order No' },
            { key: 'order_date', label: 'Order Date' },
            { key: 'salesman_name', label: 'Salesman' },
            { key: 'town_name', label: 'Town' },
            { key: 'area_name', label: 'Area' },
            { key: 'party_name', label: 'Party Name' },
            { key: 'total_items', label: 'Items', align: 'right' },
            { key: 'total_quantity', label: 'Total Qty', align: 'right' },
            { key: 'total_amount', label: 'Total Amount', align: 'right' },
            { key: 'status', label: 'Status' },
          ];
          rows = forms;
        }
      } else {
        // salesman-wise-booking, town-wise-booking, party-wise-booking, pending-booking
        let bookings = db
          .prepare("SELECT * FROM supply_bookings WHERE status != 'Cancelled' ORDER BY booking_date DESC, id DESC")
          .all() as Array<Record<string, unknown>>;
        if (fromDate) bookings = bookings.filter((b) => String(b.booking_date) >= fromDate);
        if (toDate) bookings = bookings.filter((b) => String(b.booking_date) <= toDate);
        if (salesmanId) bookings = bookings.filter((b) => Number(b.salesman_id) === salesmanId);
        if (townId) bookings = bookings.filter((b) => Number(b.town_id) === townId);
        if (areaId) bookings = bookings.filter((b) => Number(b.area_id) === areaId);
        if (partyId) bookings = bookings.filter((b) => Number(b.party_account_id) === partyId);
        if (reportKey === 'pending-booking') {
          bookings = bookings.filter((b) => ['Booking Pending', 'Partially Supplied'].includes(String(b.status)));
        }

        columns = [
          { key: 'booking_number', label: 'Booking No' },
          { key: 'booking_date', label: 'Date' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'area_name', label: 'Area' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'total_items', label: 'Items', align: 'right' },
          { key: 'total_quantity', label: 'Booked Qty', align: 'right' },
          { key: 'supplied_quantity', label: 'Supplied Qty', align: 'right' },
          { key: 'pending_quantity', label: 'Pending Qty', align: 'right' },
          { key: 'total_amount', label: 'Booking Amount', align: 'right' },
          { key: 'status', label: 'Status' },
        ];

        rows = bookings.map((b) => {
          const bSums = db
            .prepare('SELECT COALESCE(SUM(supplied_quantity), 0) as sup, COALESCE(SUM(pending_quantity), 0) as pend FROM supply_booking_items WHERE booking_id = ?')
            .get(Number(b.id)) as { sup: number; pend: number };
          return {
            ...b,
            supplied_quantity: round2(bSums.sup),
            pending_quantity: round2(bSums.pend),
          };
        });
      }
    }

    // 2. SUPPLY & DISPATCH REPORTS
    else if (category === 'supply') {
      let supplies = db
        .prepare("SELECT * FROM town_supplies WHERE supply_status != 'Cancelled' ORDER BY supply_date DESC, id DESC")
        .all() as Array<Record<string, unknown>>;
      if (fromDate) supplies = supplies.filter((s) => String(s.supply_date) >= fromDate);
      if (toDate) supplies = supplies.filter((s) => String(s.supply_date) <= toDate);
      if (salesmanId) supplies = supplies.filter((s) => Number(s.salesman_id) === salesmanId);
      if (townId) supplies = supplies.filter((s) => Number(s.town_id) === townId);
      if (supplyNumber) supplies = supplies.filter((s) => String(s.supply_number || '').toLowerCase().includes(supplyNumber));

      if (reportKey === 'item-wise-supply') {
        columns = [
          { key: 'supply_number', label: 'Supply No' },
          { key: 'supply_date', label: 'Date' },
          { key: 'town_name', label: 'Town' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'company_name', label: 'Company' },
          { key: 'item_name', label: 'Item Name' },
          { key: 'supply_quantity', label: 'Supply Qty', align: 'right' },
          { key: 'bonus_quantity', label: 'Bonus', align: 'right' },
          { key: 'returned_quantity', label: 'Returned Qty', align: 'right' },
          { key: 'net_billable_qty', label: 'Net Qty', align: 'right' },
          { key: 'amount', label: 'Supply Amount', align: 'right' },
        ];
        for (const s of supplies) {
          const items = db
            .prepare('SELECT * FROM party_supply_items WHERE town_supply_id = ? ORDER BY id ASC')
            .all(Number(s.id)) as Array<Record<string, unknown>>;
          for (const it of items) {
            if (partyId && Number(it.party_account_id) !== partyId) continue;
            rows.push({
              ...it,
              supply_number: s.supply_number,
              supply_date: s.supply_date,
              town_name: s.town_name,
            });
          }
        }
      } else if (reportKey === 'party-wise-supply') {
        columns = [
          { key: 'supply_number', label: 'Supply No' },
          { key: 'party_supply_number', label: 'Party Slip No' },
          { key: 'supply_date', label: 'Date' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'supply_qty', label: 'Supply Qty', align: 'right' },
          { key: 'supply_amount', label: 'Supply Amount', align: 'right' },
          { key: 'return_amount', label: 'Return Amount', align: 'right' },
          { key: 'net_billable_amount', label: 'Net Billable', align: 'right' },
          { key: 'supply_status', label: 'Status' },
        ];
        for (const s of supplies) {
          const psList = db
            .prepare('SELECT * FROM party_supplies WHERE town_supply_id = ? ORDER BY id ASC')
            .all(Number(s.id)) as Array<Record<string, unknown>>;
          for (const ps of psList) {
            if (partyId && Number(ps.party_account_id) !== partyId) continue;
            rows.push(ps);
          }
        }
      } else {
        // town-wise-supply, supply-number-wise, salesman-wise-supply, packing-list, pending-packing, dispatch-report, pending-dispatch
        if (reportKey === 'pending-packing') {
          supplies = supplies.filter((s) => String(s.supply_status) === 'Packing Pending');
        } else if (reportKey === 'pending-dispatch') {
          supplies = supplies.filter((s) => String(s.supply_status) === 'Ready for Dispatch');
        } else if (reportKey === 'dispatch-report') {
          supplies = supplies.filter((s) => Number(s.stock_deducted) === 1);
        }

        columns = [
          { key: 'supply_number', label: 'Supply No' },
          { key: 'supply_date', label: 'Supply Date' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'total_parties', label: 'Parties', align: 'right' },
          { key: 'total_supply_qty', label: 'Supply Qty', align: 'right' },
          { key: 'total_supply_amount', label: 'Supply Amount', align: 'right' },
          { key: 'total_return_amount', label: 'Return Amount', align: 'right' },
          { key: 'net_billable_amount', label: 'Net Billable', align: 'right' },
          { key: 'packing_status', label: 'Packing' },
          { key: 'supply_status', label: 'Status' },
        ];
        rows = supplies;
      }
    }

    // 3. RETURN REPORTS
    else if (category === 'return') {
      let retHeaders = db
        .prepare("SELECT * FROM supply_returns WHERE status != 'Cancelled' ORDER BY return_date DESC, id DESC")
        .all() as Array<Record<string, unknown>>;
      if (fromDate) retHeaders = retHeaders.filter((r) => String(r.return_date) >= fromDate);
      if (toDate) retHeaders = retHeaders.filter((r) => String(r.return_date) <= toDate);
      if (salesmanId) retHeaders = retHeaders.filter((r) => Number(r.salesman_id) === salesmanId);
      if (townId) retHeaders = retHeaders.filter((r) => Number(r.town_id) === townId);
      if (partyId) retHeaders = retHeaders.filter((r) => Number(r.party_account_id) === partyId);
      if (supplyNumber) retHeaders = retHeaders.filter((r) => String(r.supply_number || '').toLowerCase().includes(supplyNumber));

      if (reportKey === 'item-wise-return' || reportKey === 'damaged-stock-return') {
        columns = [
          { key: 'return_number', label: 'Return No' },
          { key: 'return_date', label: 'Date' },
          { key: 'supply_number', label: 'Supply No' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'town_name', label: 'Town' },
          { key: 'item_name', label: 'Item Name' },
          { key: 'new_return_quantity', label: 'Return Qty', align: 'right' },
          { key: 'accepted_quantity', label: 'Saleable Qty', align: 'right' },
          { key: 'damaged_quantity', label: 'Damaged Qty', align: 'right' },
          { key: 'return_amount', label: 'Return Amount', align: 'right' },
          { key: 'return_reason', label: 'Reason' },
        ];
        for (const r of retHeaders) {
          const items = db
            .prepare('SELECT * FROM supply_return_items WHERE supply_return_id = ? ORDER BY id ASC')
            .all(Number(r.id)) as Array<Record<string, unknown>>;
          for (const it of items) {
            if (reportKey === 'damaged-stock-return' && Number(it.damaged_quantity || 0) <= 0) continue;
            rows.push({
              ...it,
              return_number: r.return_number,
              return_date: r.return_date,
              supply_number: r.supply_number,
              town_name: r.town_name,
            });
          }
        }
      } else {
        columns = [
          { key: 'return_number', label: 'Return No' },
          { key: 'return_date', label: 'Return Date' },
          { key: 'supply_number', label: 'Supply No' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'total_returned_qty', label: 'Returned Qty', align: 'right' },
          { key: 'total_accepted_qty', label: 'Saleable Qty', align: 'right' },
          { key: 'total_damaged_qty', label: 'Damaged Qty', align: 'right' },
          { key: 'total_return_amount', label: 'Return Amount', align: 'right' },
        ];
        rows = retHeaders;
      }
    }

    // 4. BILLING & SALES REPORTS
    else if (category === 'billing') {
      if (reportKey === 'supply-vs-return-vs-final' || reportKey === 'pending-billing' || reportKey === 'partial-billing') {
        let supplies = db
          .prepare("SELECT * FROM town_supplies WHERE supply_status != 'Cancelled' ORDER BY supply_date DESC, id DESC")
          .all() as Array<Record<string, unknown>>;
        if (fromDate) supplies = supplies.filter((s) => String(s.supply_date) >= fromDate);
        if (toDate) supplies = supplies.filter((s) => String(s.supply_date) <= toDate);
        if (salesmanId) supplies = supplies.filter((s) => Number(s.salesman_id) === salesmanId);
        if (townId) supplies = supplies.filter((s) => Number(s.town_id) === townId);
        if (reportKey === 'pending-billing') {
          supplies = supplies.filter(
            (s) => Number(s.net_billable_amount || 0) - Number(s.total_billed_amount || 0) > 0.01
          );
        } else if (reportKey === 'partial-billing') {
          supplies = supplies.filter((s) => String(s.supply_status) === 'Partially Billed');
        }

        columns = [
          { key: 'supply_number', label: 'Supply No' },
          { key: 'supply_date', label: 'Date' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'total_supply_amount', label: 'Original Supply', align: 'right' },
          { key: 'total_return_amount', label: 'Return Amount', align: 'right' },
          { key: 'net_billable_amount', label: 'Net Billable', align: 'right' },
          { key: 'total_billed_amount', label: 'Final Billed', align: 'right' },
          { key: 'unbilled_amount', label: 'Pending to Bill', align: 'right' },
          { key: 'supply_status', label: 'Status' },
        ];
        rows = supplies.map((s) => ({
          ...s,
          unbilled_amount: round2(Math.max(0, Number(s.net_billable_amount || 0) - Number(s.total_billed_amount || 0))),
        }));
      } else {
        let invoices = db
          .prepare("SELECT * FROM sales WHERE status = 'completed' AND town_supply_id IS NOT NULL ORDER BY invoice_date DESC, id DESC")
          .all() as Array<Record<string, unknown>>;
        if (fromDate) invoices = invoices.filter((i) => String(i.invoice_date) >= fromDate);
        if (toDate) invoices = invoices.filter((i) => String(i.invoice_date) <= toDate);
        if (salesmanId) invoices = invoices.filter((i) => Number(i.salesman_id) === salesmanId);
        if (partyId) invoices = invoices.filter((i) => Number(i.customer_account_id) === partyId);
        if (supplyNumber) invoices = invoices.filter((i) => String(i.supply_number || '').toLowerCase().includes(supplyNumber));

        columns = [
          { key: 'invoice_number', label: 'Invoice No' },
          { key: 'invoice_date', label: 'Invoice Date' },
          { key: 'supply_number', label: 'Supply No' },
          { key: 'salesman', label: 'Salesman' },
          { key: 'town_name', label: 'Town' },
          { key: 'customer_name', label: 'Party Name' },
          { key: 'gross_total', label: 'Gross Total', align: 'right' },
          { key: 'discount_amount', label: 'Discount', align: 'right' },
          { key: 'net_total', label: 'Final Net Bill', align: 'right' },
          { key: 'paid_amount', label: 'Recovered', align: 'right' },
          { key: 'balance_amount', label: 'Balance', align: 'right' },
        ];
        rows = invoices;
      }
    }

    // 5. RECOVERY & SETTLEMENT REPORTS
    else {
      if (reportKey === 'salesman-settlement-report') {
        let settlements = db
          .prepare('SELECT * FROM salesman_settlements ORDER BY settlement_date DESC, id DESC')
          .all() as Array<Record<string, unknown>>;
        if (fromDate) settlements = settlements.filter((s) => String(s.settlement_date) >= fromDate);
        if (toDate) settlements = settlements.filter((s) => String(s.settlement_date) <= toDate);
        if (salesmanId) settlements = settlements.filter((s) => Number(s.salesman_id) === salesmanId);

        columns = [
          { key: 'settlement_number', label: 'Settlement No' },
          { key: 'settlement_date', label: 'Date' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'total_supplies', label: 'Supplies', align: 'right' },
          { key: 'total_returns', label: 'Returns', align: 'right' },
          { key: 'total_final_billing', label: 'Final Billing', align: 'right' },
          { key: 'total_cash_collected', label: 'Cash Collected', align: 'right' },
          { key: 'total_bank_collections', label: 'Bank Collected', align: 'right' },
          { key: 'cash_submitted_to_store', label: 'Cash Submitted', align: 'right' },
          { key: 'remaining_cash_in_hand', label: 'Cash in Hand', align: 'right' },
        ];
        rows = settlements;
      } else if (reportKey === 'pending-recovery' || reportKey === 'aging-outstanding') {
        let parties = db
          .prepare(`
            SELECT id, account_code, account_name, phone,
                   COALESCE(NULLIF(town_name, ''), city, '') as town_name,
                   COALESCE(area_name, '') as area_name,
                   COALESCE(assigned_salesman_name, '') as salesman_name,
                   assigned_salesman_id, town_id,
                   current_balance, current_balance_type
            FROM accounts
            WHERE account_type IN ('Customer', 'Customer & Supplier') AND is_system_account = 0 AND current_balance > 0.01 AND current_balance_type = 'Debit'
            ORDER BY current_balance DESC
          `)
          .all() as Array<Record<string, unknown>>;
        if (salesmanId) parties = parties.filter((p) => Number(p.assigned_salesman_id) === salesmanId);
        if (townId) parties = parties.filter((p) => Number(p.town_id) === townId);
        if (partyId) parties = parties.filter((p) => Number(p.id) === partyId);

        columns = [
          { key: 'account_code', label: 'Party Code' },
          { key: 'account_name', label: 'Party Name' },
          { key: 'town_name', label: 'Town' },
          { key: 'area_name', label: 'Area' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'phone', label: 'Mobile' },
          { key: 'current_balance', label: 'Outstanding Balance', align: 'right' },
        ];
        rows = parties;
      } else {
        let recoveries = db
          .prepare("SELECT * FROM supply_recoveries WHERE status = 'Posted' ORDER BY recovery_date DESC, id DESC")
          .all() as Array<Record<string, unknown>>;
        if (fromDate) recoveries = recoveries.filter((r) => String(r.recovery_date) >= fromDate);
        if (toDate) recoveries = recoveries.filter((r) => String(r.recovery_date) <= toDate);
        if (salesmanId) recoveries = recoveries.filter((r) => Number(r.salesman_id) === salesmanId);
        if (townId) recoveries = recoveries.filter((r) => Number(r.town_id) === townId);
        if (partyId) recoveries = recoveries.filter((r) => Number(r.party_account_id) === partyId);
        if (supplyNumber) recoveries = recoveries.filter((r) => String(r.supply_number || '').toLowerCase().includes(supplyNumber));

        columns = [
          { key: 'recovery_receipt_number', label: 'Receipt No' },
          { key: 'recovery_date', label: 'Date' },
          { key: 'party_name', label: 'Party Name' },
          { key: 'town_name', label: 'Town' },
          { key: 'salesman_name', label: 'Salesman' },
          { key: 'supply_number', label: 'Supply No' },
          { key: 'invoice_number', label: 'Invoice No' },
          { key: 'previous_outstanding', label: 'Previous Balance', align: 'right' },
          { key: 'recovery_amount', label: 'Recovery Amount', align: 'right' },
          { key: 'remaining_balance', label: 'Remaining Balance', align: 'right' },
          { key: 'payment_method', label: 'Method' },
        ];
        rows = recoveries;
      }
    }

    if (q) {
      rows = rows.filter((r) =>
        Object.values(r).some((val) => String(val ?? '').toLowerCase().includes(q))
      );
    }

    // Compute grand totals for numeric columns
    const grandTotals: Record<string, number> = {};
    for (const col of columns) {
      if (col.align === 'right') {
        grandTotals[col.key] = round2(
          rows.reduce((sum, r) => sum + Number(r[col.key] || 0), 0)
        );
      }
    }

    res.json({
      success: true,
      category,
      reportKey,
      columns,
      rows,
      grandTotals,
      totalCount: rows.length,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
