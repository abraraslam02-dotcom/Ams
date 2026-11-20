import { getDatabase } from '../db/connection.ts';
import { recalculateAccountBalance, POSTED_INVOICE_JE_FILTER_SQL } from '../routes/accounts.ts';

export type CanonicalInvoiceStatus = 'draft' | 'held' | 'completed' | 'cancelled';

const HELD_OR_DRAFT_STATUSES = new Set([
  'held',
  'hold',
  'on_hold',
  'on hold',
  'draft',
  'temp',
  'temporary',
  'pending_hold',
]);

const COMPLETED_STATUSES = new Set(['completed', 'posted', 'confirmed', 'final']);

export function isHeldOrDraftStatus(statusVal: unknown): boolean {
  const normalized = String(statusVal ?? '').trim().toLowerCase();
  return HELD_OR_DRAFT_STATUSES.has(normalized);
}

export function isPostedCompletedStatus(statusVal: unknown): boolean {
  const normalized = String(statusVal ?? '').trim().toLowerCase();
  return COMPLETED_STATUSES.has(normalized);
}

export function normalizeInvoiceStatus(
  rawStatus: unknown,
  defaultStatus: 'completed' | 'held' | 'draft' = 'completed'
): CanonicalInvoiceStatus {
  const normalized = String(rawStatus ?? '').trim().toLowerCase();
  if (!normalized) return defaultStatus;
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'draft') return 'draft';
  if (HELD_OR_DRAFT_STATUSES.has(normalized)) return 'held';
  if (COMPLETED_STATUSES.has(normalized)) return 'completed';
  return defaultStatus;
}

/**
 * Removes all journal entries linked to a Sale ID (used when a held/draft sale is saved/discarded,
 * or before re-posting an edited sale) and recalculates any affected accounts.
 */
export function cleanupSaleJournalEntries(saleId: number): number {
  const db = getDatabase();
  const existingSale = db
    .prepare(
      'SELECT id, customer_account_id, payment_account_id, journal_entry_id, payment_journal_entry_id FROM sales WHERE id = ?'
    )
    .get(saleId) as
    | {
        id: number;
        customer_account_id: number | null;
        payment_account_id: number | null;
        journal_entry_id: number | null;
        payment_journal_entry_id: number | null;
      }
    | undefined;

  const linkedRows = db
    .prepare(
      "SELECT id FROM journal_entries WHERE reference_type IN ('SALE', 'SALES') AND reference_id = ?"
    )
    .all(saleId) as Array<{ id: number }>;

  const journalIdSet = new Set<number>(linkedRows.map((r) => Number(r.id)));
  if (existingSale?.journal_entry_id) journalIdSet.add(Number(existingSale.journal_entry_id));
  if (existingSale?.payment_journal_entry_id) {
    journalIdSet.add(Number(existingSale.payment_journal_entry_id));
  }
  journalIdSet.delete(0);

  const affectedAccounts = new Set<number>();
  if (existingSale?.customer_account_id) {
    affectedAccounts.add(Number(existingSale.customer_account_id));
  }
  if (existingSale?.payment_account_id) {
    affectedAccounts.add(Number(existingSale.payment_account_id));
  }

  for (const jId of journalIdSet) {
    const lines = db
      .prepare('SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = ?')
      .all(jId) as Array<{ account_id: number }>;
    for (const l of lines) {
      if (l.account_id) affectedAccounts.add(Number(l.account_id));
    }
    db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
  }

  if (existingSale) {
    db.prepare(
      'UPDATE sales SET journal_entry_id = NULL, payment_journal_entry_id = NULL WHERE id = ?'
    ).run(saleId);
  }

  for (const accId of affectedAccounts) {
    recalculateAccountBalance(accId);
  }

  return journalIdSet.size;
}

/**
 * Removes PURCHASE journal entries (and any prior edit-reversal adjustment JEs) linked to a Purchase ID
 * when holding, editing, or discarding a purchase invoice, then recalculates all touched accounts.
 */
export function cleanupPurchaseJournalEntries(
  purchaseId: number,
  options?: { includeEditReversalAdjustments?: boolean }
): number {
  const db = getDatabase();
  const includeEditAdj = options?.includeEditReversalAdjustments !== false;

  const existingPurchase = db
    .prepare(
      'SELECT id, supplier_account_id, payment_account_id, journal_entry_id FROM purchases WHERE id = ?'
    )
    .get(purchaseId) as
    | {
        id: number;
        supplier_account_id: number | null;
        payment_account_id: number | null;
        journal_entry_id: number | null;
      }
    | undefined;

  const purchaseJeRows = db
    .prepare("SELECT id FROM journal_entries WHERE reference_type = 'PURCHASE' AND reference_id = ?")
    .all(purchaseId) as Array<{ id: number }>;

  const journalIdSet = new Set<number>(purchaseJeRows.map((r) => Number(r.id)));
  if (existingPurchase?.journal_entry_id) {
    const refTypeRow = db
      .prepare('SELECT id, reference_type FROM journal_entries WHERE id = ?')
      .get(existingPurchase.journal_entry_id) as { id: number; reference_type: string } | undefined;
    if (refTypeRow && refTypeRow.reference_type === 'PURCHASE') {
      journalIdSet.add(Number(refTypeRow.id));
    }
  }

  if (includeEditAdj) {
    const editRevRows = db
      .prepare(
        `SELECT id FROM journal_entries
         WHERE reference_type = 'ADJUSTMENT'
           AND reference_id = ?
           AND (
             description LIKE '%Invoice Edit & Re-posting%'
             OR description LIKE '%Offline Sync Edit & Re-posting%'
           )`
      )
      .all(purchaseId) as Array<{ id: number }>;
    for (const er of editRevRows) {
      journalIdSet.add(Number(er.id));
    }
  }

  journalIdSet.delete(0);

  const affectedAccounts = new Set<number>();
  if (existingPurchase?.supplier_account_id) {
    affectedAccounts.add(Number(existingPurchase.supplier_account_id));
  }
  if (existingPurchase?.payment_account_id) {
    affectedAccounts.add(Number(existingPurchase.payment_account_id));
  }

  for (const jId of journalIdSet) {
    const lines = db
      .prepare('SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = ?')
      .all(jId) as Array<{ account_id: number }>;
    for (const l of lines) {
      if (l.account_id) affectedAccounts.add(Number(l.account_id));
    }
    db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
  }

  if (existingPurchase) {
    db.prepare('UPDATE purchases SET journal_entry_id = NULL WHERE id = ?').run(purchaseId);
  }

  for (const accId of affectedAccounts) {
    recalculateAccountBalance(accId);
  }

  return journalIdSet.size;
}

export interface LedgerIntegrityAuditReport {
  removedNonPostedSaleJEs: number;
  removedNonPostedPurchaseJEs: number;
  removedDuplicateSaleJEs: number;
  removedDuplicatePurchaseJEs: number;
  recalculatedAccounts: number;
}

/**
 * Audits and repairs any journal entries incorrectly created for held/draft/cancelled/orphaned
 * sales or purchases, removes redundant invoice-edit duplicate JEs while strictly preserving
 * all genuine posted invoices and manual ledger vouchers, and recalculates affected account balances.
 */
export function reconcileHeldAndDuplicateLedgerEntries(): LedgerIntegrityAuditReport {
  const db = getDatabase();
  const report: LedgerIntegrityAuditReport = {
    removedNonPostedSaleJEs: 0,
    removedNonPostedPurchaseJEs: 0,
    removedDuplicateSaleJEs: 0,
    removedDuplicatePurchaseJEs: 0,
    recalculatedAccounts: 0,
  };

  const tx = db.transaction(() => {
    const affectedAccounts = new Set<number>();

    const deleteJeIds = (ids: number[]): number => {
      let count = 0;
      for (const jeId of ids) {
        if (!jeId) continue;
        const lines = db
          .prepare('SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = ?')
          .all(jeId) as Array<{ account_id: number }>;
        for (const l of lines) {
          if (l.account_id) affectedAccounts.add(Number(l.account_id));
        }
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jeId);
        const del = db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jeId);
        count += Number(del.changes || 0);
      }
      return count;
    };

    // 1. Remove any SALE journal entries whose sale row does not exist OR is not 'completed'
    const invalidSaleJEs = db
      .prepare(`
        SELECT je.id, s.customer_account_id
        FROM journal_entries je
        LEFT JOIN sales s ON s.id = je.reference_id
        WHERE je.reference_type IN ('SALE', 'SALES')
          AND (s.id IS NULL OR LOWER(TRIM(COALESCE(s.status, ''))) != 'completed')
      `)
      .all() as Array<{ id: number; customer_account_id: number | null }>;

    for (const r of invalidSaleJEs) {
      if (r.customer_account_id) affectedAccounts.add(Number(r.customer_account_id));
    }
    report.removedNonPostedSaleJEs = deleteJeIds(invalidSaleJEs.map((r) => Number(r.id)));

    // Ensure non-completed sales never retain dangling journal_entry_id pointers
    const nonCompletedSalesWithPtrs = db
      .prepare(`
        SELECT id, customer_account_id, journal_entry_id, payment_journal_entry_id
        FROM sales
        WHERE LOWER(TRIM(COALESCE(status, ''))) != 'completed'
          AND (journal_entry_id IS NOT NULL OR payment_journal_entry_id IS NOT NULL)
      `)
      .all() as Array<{
        id: number;
        customer_account_id: number | null;
        journal_entry_id: number | null;
        payment_journal_entry_id: number | null;
      }>;
    for (const s of nonCompletedSalesWithPtrs) {
      if (s.customer_account_id) affectedAccounts.add(Number(s.customer_account_id));
      const extraIds = [Number(s.journal_entry_id || 0), Number(s.payment_journal_entry_id || 0)].filter(Boolean);
      report.removedNonPostedSaleJEs += deleteJeIds(extraIds);
      db.prepare('UPDATE sales SET journal_entry_id = NULL, payment_journal_entry_id = NULL WHERE id = ?').run(s.id);
    }

    // 2. Remove any PURCHASE journal entries whose purchase row does not exist OR is not 'completed'
    const invalidPurchaseJEs = db
      .prepare(`
        SELECT je.id, p.supplier_account_id
        FROM journal_entries je
        LEFT JOIN purchases p ON p.id = je.reference_id
        WHERE je.reference_type = 'PURCHASE'
          AND (p.id IS NULL OR LOWER(TRIM(COALESCE(p.status, ''))) != 'completed')
      `)
      .all() as Array<{ id: number; supplier_account_id: number | null }>;

    for (const r of invalidPurchaseJEs) {
      if (r.supplier_account_id) affectedAccounts.add(Number(r.supplier_account_id));
    }
    report.removedNonPostedPurchaseJEs = deleteJeIds(invalidPurchaseJEs.map((r) => Number(r.id)));

    const nonCompletedPurchasesWithPtrs = db
      .prepare(`
        SELECT id, supplier_account_id, journal_entry_id
        FROM purchases
        WHERE LOWER(TRIM(COALESCE(status, ''))) != 'completed'
          AND journal_entry_id IS NOT NULL
      `)
      .all() as Array<{ id: number; supplier_account_id: number | null; journal_entry_id: number | null }>;
    for (const p of nonCompletedPurchasesWithPtrs) {
      if (p.supplier_account_id) affectedAccounts.add(Number(p.supplier_account_id));
      if (p.journal_entry_id) {
        report.removedNonPostedPurchaseJEs += deleteJeIds([Number(p.journal_entry_id)]);
      }
      db.prepare('UPDATE purchases SET journal_entry_id = NULL WHERE id = ?').run(p.id);
    }

    // 3. Remove duplicate non-receipt SALE journal entries (more than 1 JE-SAL per sale_id)
    const dupSaleHeaderGroups = db
      .prepare(`
        SELECT reference_id
        FROM journal_entries
        WHERE reference_type = 'SALE' AND status = 'posted' AND entry_number NOT LIKE 'JE-SRC-%'
        GROUP BY reference_id
        HAVING COUNT(*) > 1
      `)
      .all() as Array<{ reference_id: number }>;

    for (const grp of dupSaleHeaderGroups) {
      const saleRow = db
        .prepare('SELECT id, journal_entry_id FROM sales WHERE id = ?')
        .get(grp.reference_id) as { id: number; journal_entry_id: number | null } | undefined;
      const allJes = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE reference_type = 'SALE' AND reference_id = ? AND status = 'posted' AND entry_number NOT LIKE 'JE-SRC-%'
          ORDER BY id DESC
        `)
        .all(grp.reference_id) as Array<{ id: number }>;
      const keepId =
        saleRow?.journal_entry_id && allJes.some((j) => Number(j.id) === Number(saleRow.journal_entry_id))
          ? Number(saleRow.journal_entry_id)
          : Number(allJes[0]?.id || 0);
      const toRemove = allJes.map((j) => Number(j.id)).filter((id) => id !== keepId);
      report.removedDuplicateSaleJEs += deleteJeIds(toRemove);
      if (saleRow && keepId && Number(saleRow.journal_entry_id || 0) !== keepId) {
        db.prepare('UPDATE sales SET journal_entry_id = ? WHERE id = ?').run(keepId, saleRow.id);
      }
    }

    // Also dedupe duplicate payment receipt JEs (JE-SRC-*) per sale_id if any
    const dupSalePayGroups = db
      .prepare(`
        SELECT reference_id
        FROM journal_entries
        WHERE reference_type = 'SALE' AND status = 'posted' AND entry_number LIKE 'JE-SRC-%'
        GROUP BY reference_id
        HAVING COUNT(*) > 1
      `)
      .all() as Array<{ reference_id: number }>;

    for (const grp of dupSalePayGroups) {
      const saleRow = db
        .prepare('SELECT id, payment_journal_entry_id FROM sales WHERE id = ?')
        .get(grp.reference_id) as { id: number; payment_journal_entry_id: number | null } | undefined;
      const allJes = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE reference_type = 'SALE' AND reference_id = ? AND status = 'posted' AND entry_number LIKE 'JE-SRC-%'
          ORDER BY id DESC
        `)
        .all(grp.reference_id) as Array<{ id: number }>;
      const keepId =
        saleRow?.payment_journal_entry_id &&
        allJes.some((j) => Number(j.id) === Number(saleRow.payment_journal_entry_id))
          ? Number(saleRow.payment_journal_entry_id)
          : Number(allJes[0]?.id || 0);
      const toRemove = allJes.map((j) => Number(j.id)).filter((id) => id !== keepId);
      report.removedDuplicateSaleJEs += deleteJeIds(toRemove);
      if (saleRow && keepId && Number(saleRow.payment_journal_entry_id || 0) !== keepId) {
        db.prepare('UPDATE sales SET payment_journal_entry_id = ? WHERE id = ?').run(keepId, saleRow.id);
      }
    }

    // 4. Clean up redundant duplicate PURCHASE JEs (created by older edit reversal+repost cycles)
    const dupPurchaseGroups = db
      .prepare(`
        SELECT reference_id
        FROM journal_entries
        WHERE reference_type = 'PURCHASE' AND status = 'posted'
        GROUP BY reference_id
        HAVING COUNT(*) > 1
      `)
      .all() as Array<{ reference_id: number }>;

    for (const grp of dupPurchaseGroups) {
      const purRow = db
        .prepare('SELECT id, journal_entry_id, supplier_account_id FROM purchases WHERE id = ?')
        .get(grp.reference_id) as
        | { id: number; journal_entry_id: number | null; supplier_account_id: number | null }
        | undefined;
      const allPurchaseJes = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE reference_type = 'PURCHASE' AND reference_id = ? AND status = 'posted'
          ORDER BY id DESC
        `)
        .all(grp.reference_id) as Array<{ id: number }>;
      const keepId =
        purRow?.journal_entry_id && allPurchaseJes.some((j) => Number(j.id) === Number(purRow.journal_entry_id))
          ? Number(purRow.journal_entry_id)
          : Number(allPurchaseJes[0]?.id || 0);

      // Remove superseded PURCHASE JEs only along with their edit-reversal ADJUSTMENT JEs so net accounting stays exact
      const editRevAdjs = db
        .prepare(`
          SELECT id FROM journal_entries
          WHERE reference_type = 'ADJUSTMENT'
            AND reference_id = ?
            AND (
              description LIKE '%Invoice Edit & Re-posting%'
              OR description LIKE '%Offline Sync Edit & Re-posting%'
            )
        `)
        .all(grp.reference_id) as Array<{ id: number }>;

      const supersededPurchaseJes = allPurchaseJes.map((j) => Number(j.id)).filter((id) => id !== keepId);
      if (supersededPurchaseJes.length > 0 && editRevAdjs.length > 0) {
        report.removedDuplicatePurchaseJEs += deleteJeIds([
          ...supersededPurchaseJes,
          ...editRevAdjs.map((a) => Number(a.id)),
        ]);
      } else if (supersededPurchaseJes.length > 0) {
        report.removedDuplicatePurchaseJEs += deleteJeIds(supersededPurchaseJes);
      }

      if (purRow && keepId && Number(purRow.journal_entry_id || 0) !== keepId) {
        db.prepare('UPDATE purchases SET journal_entry_id = ? WHERE id = ?').run(keepId, purRow.id);
      }
      if (purRow?.supplier_account_id) {
        affectedAccounts.add(Number(purRow.supplier_account_id));
      }
    }

    // 5. Also verify all accounts for any balance drift vs posted journal entries
    const allAccounts = db
      .prepare(`
        SELECT a.id, a.opening_balance, a.opening_balance_type, a.current_balance, a.current_balance_type,
               a.total_debit, a.total_credit,
               COALESCE(SUM(CASE WHEN je.status = 'posted' AND je.reference_type != 'OPENING_BALANCE' AND ${POSTED_INVOICE_JE_FILTER_SQL} THEN jl.debit_amount ELSE 0 END), 0) as tx_dr,
               COALESCE(SUM(CASE WHEN je.status = 'posted' AND je.reference_type != 'OPENING_BALANCE' AND ${POSTED_INVOICE_JE_FILTER_SQL} THEN jl.credit_amount ELSE 0 END), 0) as tx_cr
        FROM accounts a
        LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
        LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
        GROUP BY a.id
      `)
      .all() as Array<Record<string, any>>;

    for (const acc of allAccounts) {
      const id = Number(acc.id);
      if (affectedAccounts.has(id)) continue;
      const openBal = Math.round((Number(acc.opening_balance) || 0) * 100) / 100;
      const openType = acc.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';
      const expDr = Math.round(((openType === 'Debit' ? openBal : 0) + Number(acc.tx_dr || 0)) * 100) / 100;
      const expCr = Math.round(((openType === 'Credit' ? openBal : 0) + Number(acc.tx_cr || 0)) * 100) / 100;
      const net = Math.round((expDr - expCr) * 100) / 100;
      const expBal = Math.abs(net);
      const expType = net > 0 ? 'Debit' : net < 0 ? 'Credit' : openType;
      if (
        Math.abs(expBal - Number(acc.current_balance || 0)) > 0.01 ||
        expType !== acc.current_balance_type ||
        Math.abs(expDr - Number(acc.total_debit || 0)) > 0.01 ||
        Math.abs(expCr - Number(acc.total_credit || 0)) > 0.01
      ) {
        affectedAccounts.add(id);
      }
    }

    for (const accId of affectedAccounts) {
      recalculateAccountBalance(accId);
      report.recalculatedAccounts++;
    }
  });

  tx();
  return report;
}
