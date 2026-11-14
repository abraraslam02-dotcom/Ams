import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import pg from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { getDatabase, syncRuntimeToSeedDatabase } from '../db/connection.ts';
import { getDbResetEpoch, getDbResetTimestamp } from '../db/resetState.ts';

const { Pool } = pg;

const PERSISTED_TABLES = [
  'database_migrations',
  'company_settings',
  'advance_tax_settings',
  'advance_tax_history',
  'accounting_periods',
  'financial_closings',
  'closing_account_snapshots',
  'closing_stock_snapshots',
  'closing_audit_logs',
  'users',
  'user_permissions',
  'role_permissions',
  'password_recovery_codes',
  'auth_audit_logs',
  'items',
  'accounts',
  'account_sequences',
  'account_code_history',
  'salesmen',
  'salesman_sequences',
  'deliverymen',
  'towns',
  'town_areas',
  'salesman_towns',
  'salesman_areas',
  'salesman_parties',
  'trade_offers',
  'party_discounts',
  'supply_bookings',
  'supply_booking_items',
  'town_supplies',
  'town_supply_items',
  'party_supplies',
  'party_supply_items',
  'mobile_booking_imports',
  'mobile_submitted_batches',
  'inventory',
  'invoice_sequences',
  'invoice_number_registry',
  'purchases',
  'purchase_items',
  'purchase_returns',
  'purchase_return_items',
  'sales',
  'sale_items',
  'sale_returns',
  'sale_return_items',
  'stock_adjustments',
  'stock_adjustment_items',
  'stock_transfers',
  'stock_transfer_items',
  'physical_verifications',
  'physical_verification_items',
  'stock_ledger',
  'journal_entries',
  'journal_entry_lines',
  'accounting_vouchers',
  'accounting_voucher_lines',
  'payment_vouchers',
  'cash_book_sequences',
  'cash_book_vouchers',
  'cash_book_audit_history',
  'salesman_commission_payments',
  'whatsapp_log',
  'whatsapp_logs',
  'whatsapp_settings',
  'backup_history',
  'sync_audit_log',
  'sync_tombstones',
  'system_error_logs',
  'idempotency_keys',
  'employee_sequences',
  'employees',
  'employee_salary_structures',
  'employee_attendance',
  'employee_leaves',
  'employee_advances_loans',
  'employee_advance_loan_recoveries',
  'payroll_records',
  'salary_payments',
  'employee_financial_ledger',
  'payroll_audit_logs',
  'app_system_state',
];

export type DatabaseProviderType = 'postgres-cloudsql' | 'sqlite-persistent-central';

export interface CloudSyncState {
  enabled: boolean;
  provider: DatabaseProviderType;
  connected: boolean;
  lastRestoredAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  snapshotVersion: number;
  restoredFromCloud: boolean;
  totalRowsSynced: number;
}

const syncState: CloudSyncState = {
  enabled: false,
  provider: 'sqlite-persistent-central',
  connected: true,
  lastRestoredAt: null,
  lastSyncedAt: null,
  lastError: null,
  snapshotVersion: 0,
  restoredFromCloud: false,
  totalRowsSynced: 0,
};

let pgPool: pg.Pool | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let seedMirrorTimer: NodeJS.Timeout | null = null;
let isSyncing = false;
let pendingSync = false;
let lastUploadedChecksum: string | null = null;
let initPersistencePromise: Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> | null = null;

export function getCloudSyncStatus(): CloudSyncState {
  return { ...syncState };
}

export function getCloudPersistenceStatus(): CloudSyncState {
  return { ...syncState };
}

function getPostgresPool(): pg.Pool | null {
  if (pgPool) return pgPool;

  const connUrl = process.env.DATABASE_URL;
  const host = process.env.PGHOST || process.env.DB_HOST || process.env.SQL_HOST;
  const user = process.env.PGUSER || process.env.DB_USER || process.env.SQL_USER || 'postgres';
  const password =
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.SQL_PASSWORD ||
    process.env.POSTGRES_PASSWORD;
  const database =
    process.env.PGDATABASE || process.env.DB_NAME || process.env.SQL_DB_NAME || 'postgres';
  const port = Number(process.env.PGPORT || process.env.DB_PORT || 5432);
  const instanceConnName =
    process.env.INSTANCE_CONNECTION_NAME || process.env.CLOUD_SQL_CONNECTION_NAME;

  if (connUrl) {
    pgPool = new Pool({
      connectionString: connUrl,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    pgPool.on('error', () => {});
    return pgPool;
  }

  if (host && (password || host.startsWith('/'))) {
    pgPool = new Pool({
      host,
      user,
      password: password || '',
      database,
      port,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    pgPool.on('error', () => {});
    return pgPool;
  }

  if (instanceConnName && password) {
    pgPool = new Pool({
      user,
      password,
      database,
      host: `/cloudsql/${instanceConnName}`,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    pgPool.on('error', () => {});
    return pgPool;
  }

  return null;
}

function getOrderedExportTables(db: ReturnType<typeof getDatabase>): string[] {
  const existingTables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name)
  );

  const ordered: string[] = [];
  for (const table of PERSISTED_TABLES) {
    if (existingTables.has(table) && !ordered.includes(table)) {
      ordered.push(table);
    }
  }
  for (const table of existingTables) {
    if (!ordered.includes(table)) {
      ordered.push(table);
    }
  }
  return ordered;
}

function exportLocalDatabaseSnapshot(): {
  tables: Record<string, any[]>;
  checksum: string;
  rowCount: number;
} {
  const db = getDatabase();
  const tableNames = getOrderedExportTables(db);
  const tables: Record<string, any[]> = {};
  let rowCount = 0;

  for (const table of tableNames) {
    try {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      tables[table] = rows;
      rowCount += rows.length;
    } catch {
      tables[table] = [];
    }
  }

  const checksum = crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
  return { tables, checksum, rowCount };
}

function getLocalActivityMetrics(): {
  itemsCount: number;
  accountsCount: number;
  salesCount: number;
  purchasesCount: number;
  maxItemId: number;
  maxSaleId: number;
  maxPurchaseId: number;
  maxCashBookId: number;
} {
  try {
    const db = getDatabase();
    const q = (sql: string) => {
      try {
        const r = db.prepare(sql).get() as { val: number } | undefined;
        return Number(r?.val || 0);
      } catch {
        return 0;
      }
    };
    return {
      itemsCount: q('SELECT COUNT(*) as val FROM items'),
      accountsCount: q('SELECT COUNT(*) as val FROM accounts'),
      salesCount: q('SELECT COUNT(*) as val FROM sales'),
      purchasesCount: q('SELECT COUNT(*) as val FROM purchases'),
      maxItemId: q('SELECT COALESCE(MAX(id), 0) as val FROM items'),
      maxSaleId: q('SELECT COALESCE(MAX(id), 0) as val FROM sales'),
      maxPurchaseId: q('SELECT COALESCE(MAX(id), 0) as val FROM purchases'),
      maxCashBookId: q('SELECT COALESCE(MAX(id), 0) as val FROM cash_book_vouchers'),
    };
  } catch {
    return {
      itemsCount: 0,
      accountsCount: 0,
      salesCount: 0,
      purchasesCount: 0,
      maxItemId: 0,
      maxSaleId: 0,
      maxPurchaseId: 0,
      maxCashBookId: 0,
    };
  }
}

function restoreSnapshotIntoLocalSqlite(tables: Record<string, any[]>): number {
  const db = getDatabase();
  const tableNames = Object.keys(tables || {});
  if (tableNames.length === 0) return 0;

  let restoredRows = 0;
  db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      const existingTables = new Set(
        (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all() as Array<{ name: string }>
        ).map((t) => t.name)
      );

      for (const table of PERSISTED_TABLES) {
        if (!existingTables.has(table)) continue;
        const rows = tables[table];
        if (!Array.isArray(rows)) continue;

        const colRows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        const validCols = new Set(colRows.map((c) => c.name));
        db.prepare(`DELETE FROM "${table}"`).run();
        if (rows.length === 0) continue;

        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const cols = Object.keys(row).filter((c) => validCols.has(c));
          if (cols.length === 0) continue;
          const colSql = cols.map((c) => `"${c}"`).join(', ');
          const phSql = cols.map(() => '?').join(', ');
          const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
          db.prepare(`INSERT OR REPLACE INTO "${table}" (${colSql}) VALUES (${phSql})`).run(...vals);
          restoredRows++;
        }
      }
    });
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return restoredRows;
}

export const AUTO_CLOUD_RESTORE_ENABLED = false;

function shouldRestoreFromRemoteSnapshot(_remoteTables: Record<string, any[]>): boolean {
  // Automatic snapshot restoration on startup / republish is permanently disabled
  // to prevent live database records from ever being wiped or replaced by old snapshots.
  // Restoration is only allowed when Super Admin explicitly confirms a manual restore.
  if (!AUTO_CLOUD_RESTORE_ENABLED) {
    return false;
  }
  return false;
}

/**
 * Clean non-Firebase record hydration into SQLite from provided JSON payload arrays
 * (automatically rehydrates server SQLite from client IndexedDB after a Cloud Run republish).
 */
export function hydrateSqliteFromCloudRecords(
  remoteItems: any[],
  remoteInvoices: any[],
  extra?: {
    accounts?: any[];
    inventory?: any[];
    purchases?: any[];
    cashBookVouchers?: any[];
  }
): {
  restoredItems: number;
  restoredInvoices: number;
  restoredAccounts: number;
  restoredInventory: number;
  restoredPurchases: number;
  restoredVouchers: number;
} {
  const db = getDatabase();
  let restoredItems = 0;
  let restoredInvoices = 0;
  let restoredAccounts = 0;
  let restoredInventory = 0;
  let restoredPurchases = 0;
  let restoredVouchers = 0;

  const normalizeTs = (v: unknown) => String(v || '').trim().replace(' ', 'T');

  // 1. Restore custom Accounts (Customers, Suppliers, etc.) or updated balances
  const remoteAccounts = Array.isArray(extra?.accounts) ? extra!.accounts! : [];
  if (remoteAccounts.length > 0) {
    const upsertAccountsTx = db.transaction(() => {
      for (const acc of remoteAccounts) {
        const code = String(acc?.account_code || '').trim();
        const name = String(acc?.account_name || '').trim();
        if (!code && !name) continue;

        const existing =
          (Number(acc?.id) > 0
            ? (db.prepare('SELECT * FROM accounts WHERE id = ? LIMIT 1').get(Number(acc.id)) as any)
            : undefined) ||
          (code
            ? (db.prepare('SELECT * FROM accounts WHERE LOWER(account_code) = LOWER(?) LIMIT 1').get(code) as any)
            : undefined);

        if (!existing) {
          db.prepare(
            `INSERT INTO accounts (
              id, account_code, account_name, account_type, account_group, main_group,
              contact_person, phone, whatsapp_number, mobile_Alert_number, email,
              address, city, area, ntn_cnic, credit_limit, credit_days,
              opening_balance, balance_type, current_balance, current_balance_type,
              total_debit, total_credit, is_system_account, status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            Number(acc?.id) > 0 && Number(acc.id) < 1_000_000_000 ? Number(acc.id) : null,
            code || `ACC-${Date.now().toString().slice(-5)}`,
            name,
            String(acc?.account_type || acc?.account_group || 'Customer'),
            String(acc?.account_group || 'Customer'),
            String(acc?.main_group || 'BALANCE SHEET ACCOUNTS'),
            acc?.contact_person || '',
            acc?.phone || '',
            acc?.whatsapp_number || '',
            acc?.mobile_Alert_number || '',
            acc?.email || '',
            acc?.address || '',
            acc?.city || '',
            acc?.area || '',
            acc?.ntn_cnic || '',
            Number(acc?.credit_limit || 0),
            Number(acc?.credit_days || 0),
            Number(acc?.opening_balance || 0),
            String(acc?.balance_type || 'Debit'),
            Number(acc?.current_balance ?? acc?.opening_balance ?? 0),
            String(acc?.current_balance_type || acc?.balance_type || 'Debit'),
            Number(acc?.total_debit || 0),
            Number(acc?.total_credit || 0),
            Number(acc?.is_system_account ? 1 : 0),
            String(acc?.status || 'Active'),
            acc?.notes || '',
            acc?.created_at || new Date().toISOString(),
            acc?.updated_at || new Date().toISOString()
          );
          restoredAccounts++;
        }
      }
    });
    try {
      upsertAccountsTx();
    } catch {
      // ignore partial account conflict
    }
  }

  // 2. Restore Items
  if (Array.isArray(remoteItems) && remoteItems.length > 0) {
    const upsertItemsTx = db.transaction(() => {
      for (const r of remoteItems) {
        const code = String(r?.item_code || '').trim();
        const name = String(r?.item_name || '').trim();
        if (!code && !name) continue;
        const incomingTs = normalizeTs(r?.updated_at || r?.created_at);

        const existing =
          (Number(r?.id) > 0
            ? (db.prepare('SELECT * FROM items WHERE id = ? LIMIT 1').get(Number(r.id)) as any)
            : undefined) ||
          (code
            ? (db
                .prepare('SELECT * FROM items WHERE LOWER(item_code) = LOWER(?) LIMIT 1')
                .get(code) as any)
            : undefined);

        if (existing) {
          const existingTs = normalizeTs(existing.updated_at || existing.created_at);
          if (existingTs && incomingTs && existingTs >= incomingTs) continue;
          db.prepare(
            `UPDATE items SET
              item_name = COALESCE(?, item_name),
              generic_name = COALESCE(?, generic_name),
              company_name = COALESCE(?, company_name),
              category = COALESCE(?, category),
              packing = COALESCE(?, packing),
              purchase_price = COALESCE(?, purchase_price),
              trade_price = COALESCE(?, trade_price),
              wholesale_price = COALESCE(?, wholesale_price),
              retail_price = COALESCE(?, retail_price),
              loose_rate = COALESCE(?, loose_rate),
              opening_stock = COALESCE(?, opening_stock),
              status = COALESCE(?, status),
              updated_at = ?
            WHERE id = ?`
          ).run(
            name || null,
            r?.generic_name ?? null,
            r?.company_name ?? null,
            r?.category ?? null,
            r?.packing ?? null,
            r?.purchase_price ?? null,
            r?.trade_price ?? null,
            r?.wholesale_price ?? null,
            r?.retail_price ?? null,
            r?.loose_rate ?? null,
            r?.opening_stock ?? null,
            r?.status ?? null,
            incomingTs || new Date().toISOString(),
            existing.id
          );
          restoredItems++;
        } else {
          db.prepare(
            `INSERT INTO items (
              id, item_code, barcode, item_name, generic_name, category, company_name,
              packing, purchase_price, trade_price, wholesale_price, retail_price,
              loose_rate, tax_percent, discount_percent, reorder_level, opening_stock,
              rack_location, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            Number(r?.id) > 0 && Number(r.id) < 1_000_000_000 ? Number(r.id) : null,
            code || `MED-${Date.now().toString().slice(-5)}`,
            r?.barcode || null,
            name || 'Medicine Item',
            r?.generic_name || '',
            r?.category || 'Medicine',
            r?.company_name || '',
            r?.packing || '1x1',
            Number(r?.purchase_price || 0),
            Number(r?.trade_price || r?.purchase_price || 0),
            Number(r?.wholesale_price || r?.retail_price || 0),
            Number(r?.retail_price || 0),
            Number(r?.loose_rate || 0),
            Number(r?.tax_percent || 0),
            Number(r?.discount_percent || 0),
            Number(r?.reorder_level ?? r?.minimum_stock ?? 10),
            Number(r?.opening_stock || 0),
            r?.rack_location || r?.rack_number || '',
            r?.status || 'Active',
            r?.created_at || incomingTs || new Date().toISOString(),
            incomingTs || new Date().toISOString()
          );
          restoredItems++;
        }
      }
    });
    try {
      upsertItemsTx();
    } catch {
      // ignore partial item conflict
    }
  }

  // 3. Restore Inventory Batches
  const remoteInventory = Array.isArray(extra?.inventory) ? extra!.inventory! : [];
  if (remoteInventory.length > 0) {
    const upsertInvTx = db.transaction(() => {
      for (const b of remoteInventory) {
        const itemId = Number(b?.item_id || 0);
        const batchNo = String(b?.batch_number || '').trim();
        if (!itemId || !batchNo) continue;

        const existing = db
          .prepare('SELECT id FROM inventory WHERE item_id = ? AND batch_number = ? LIMIT 1')
          .get(itemId, batchNo) as any;
        if (existing) continue;

        db.prepare(
          `INSERT INTO inventory (
            item_id, batch_number, manufacturing_date, expiry_date,
            packing, strips_per_box, units_per_strip, units_per_pack,
            cost_price, trade_price, wholesale_price, retail_price,
            pack_cost, pack_retail, purchased_qty, bonus_qty, returned_qty, sold_qty,
            current_pack_qty, current_strip_qty, current_loose_qty, total_stock_units, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          itemId,
          batchNo,
          b?.manufacturing_date || '2025-01-01',
          b?.expiry_date || '2028-12-31',
          b?.packing || '1x1',
          Number(b?.strips_per_box || 1),
          Number(b?.units_per_strip || 1),
          Number(b?.units_per_pack || 1),
          Number(b?.cost_price || 0),
          Number(b?.trade_price || 0),
          Number(b?.wholesale_price || 0),
          Number(b?.retail_price || 0),
          Number(b?.pack_cost || 0),
          Number(b?.pack_retail || 0),
          Number(b?.purchased_qty || 0),
          Number(b?.bonus_qty || 0),
          Number(b?.returned_qty || 0),
          Number(b?.sold_qty || 0),
          Number(b?.current_pack_qty || 0),
          Number(b?.current_strip_qty || 0),
          Number(b?.current_loose_qty || 0),
          Number(b?.total_stock_units ?? b?.quantity_in_stock ?? 0),
          String(b?.status || 'in_stock')
        );
        restoredInventory++;
      }
    });
    try {
      upsertInvTx();
    } catch {
      // ignore partial inventory conflict
    }
  }

  // 4. Restore Sales Invoices
  if (Array.isArray(remoteInvoices) && remoteInvoices.length > 0) {
    const upsertSalesTx = db.transaction(() => {
      for (const inv of remoteInvoices) {
        const invNo = String(inv?.invoice_number || '').trim();
        const txId = String(inv?.client_tx_id || inv?.client_request_id || '').trim();
        if (!invNo && !txId) continue;

        const existing =
          (txId
            ? (db.prepare('SELECT id FROM sales WHERE client_request_id = ? LIMIT 1').get(txId) as any)
            : undefined) ||
          (invNo
            ? (db.prepare('SELECT id FROM sales WHERE LOWER(invoice_number) = LOWER(?) LIMIT 1').get(invNo) as any)
            : undefined);
        if (existing) continue;

        const ins = db
          .prepare(
            `INSERT INTO sales (
              invoice_number, invoice_date, invoice_type, payment_mode,
              customer_account_id, customer_name, salesman,
              gross_total, discount_total, tax_total, net_total,
              paid_amount, balance_amount, status, client_request_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            invNo || `INV-${Date.now().toString().slice(-6)}`,
            String(inv?.invoice_date || new Date().toISOString().slice(0, 10)),
            String(inv?.invoice_type || 'Retail'),
            String(inv?.payment_mode || 'Cash'),
            inv?.customer_account_id ? Number(inv.customer_account_id) : null,
            String(inv?.customer_name || 'Walk-in Customer'),
            String(inv?.salesman || ''),
            Number(inv?.gross_total ?? inv?.net_total ?? 0),
            Number(inv?.discount_total ?? inv?.discount_amount ?? 0),
            Number(inv?.tax_total ?? 0),
            Number(inv?.net_total ?? inv?.total_amount ?? 0),
            Number(inv?.paid_amount ?? 0),
            Number(inv?.balance_amount ?? 0),
            String(inv?.status || 'completed'),
            txId || null,
            inv?.created_at || new Date().toISOString(),
            inv?.updated_at || new Date().toISOString()
          );

        const saleId = Number(ins.lastInsertRowid);
        const lines = Array.isArray(inv?.items) ? inv.items : Array.isArray(inv?.lines) ? inv.lines : [];
        for (const line of lines) {
          const itemId = Number(line?.item_id || 0);
          if (!itemId) continue;
          db.prepare(
            `INSERT INTO sale_items (
              sale_id, item_id, item_code, item_name, batch_number,
              quantity, loose_quantity, bonus_quantity, unit_price, discount_percent, line_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            saleId,
            itemId,
            String(line?.item_code || ''),
            String(line?.item_name || ''),
            String(line?.batch_number || ''),
            Number(line?.quantity || 0),
            Number(line?.loose_quantity || 0),
            Number(line?.bonus_quantity || 0),
            Number(line?.unit_price || 0),
            Number(line?.discount_percent || 0),
            Number(line?.line_total || 0)
          );
        }
        restoredInvoices++;
      }
    });
    try {
      upsertSalesTx();
    } catch {
      // ignore partial sales conflict
    }
  }

  // 5. Restore Purchases
  const remotePurchases = Array.isArray(extra?.purchases) ? extra!.purchases! : [];
  if (remotePurchases.length > 0) {
    const upsertPurchasesTx = db.transaction(() => {
      for (const pur of remotePurchases) {
        const billNo = String(pur?.bill_number || pur?.invoice_number || '').trim();
        const txId = String(pur?.client_tx_id || pur?.client_request_id || '').trim();
        if (!billNo && !txId) continue;

        const existing =
          (txId
            ? (db.prepare('SELECT id FROM purchases WHERE client_request_id = ? LIMIT 1').get(txId) as any)
            : undefined) ||
          (billNo
            ? (db.prepare('SELECT id FROM purchases WHERE LOWER(bill_number) = LOWER(?) LIMIT 1').get(billNo) as any)
            : undefined);
        if (existing) continue;

        const ins = db
          .prepare(
            `INSERT INTO purchases (
              bill_number, bill_date, supplier_account_id, supplier_name,
              payment_mode, subtotal_gross, total_discount, total_tax,
              total_payable, paid_amount, balance_due, status, client_request_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            billNo || `PUR-${Date.now().toString().slice(-6)}`,
            String(pur?.bill_date || new Date().toISOString().slice(0, 10)),
            pur?.supplier_account_id ? Number(pur.supplier_account_id) : null,
            String(pur?.supplier_name || 'Supplier'),
            String(pur?.payment_mode || 'Credit'),
            Number(pur?.subtotal_gross ?? pur?.gross_total ?? pur?.total_payable ?? 0),
            Number(pur?.total_discount ?? pur?.discount_total ?? 0),
            Number(pur?.total_tax ?? pur?.tax_total ?? 0),
            Number(pur?.total_payable ?? pur?.net_total ?? 0),
            Number(pur?.paid_amount ?? 0),
            Number(pur?.balance_due ?? pur?.balance_amount ?? 0),
            String(pur?.status || 'Completed'),
            txId || null,
            pur?.created_at || new Date().toISOString(),
            pur?.updated_at || new Date().toISOString()
          );

        const purchaseId = Number(ins.lastInsertRowid);
        const lines = Array.isArray(pur?.items) ? pur.items : [];
        for (const line of lines) {
          const itemId = Number(line?.item_id || 0);
          if (!itemId) continue;
          db.prepare(
            `INSERT INTO purchase_items (
              purchase_id, item_id, item_code, item_name, batch_number,
              expiry_date, quantity, bonus_quantity, purchase_rate, mrp_rate, discount_percent, line_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            purchaseId,
            itemId,
            String(line?.item_code || ''),
            String(line?.item_name || ''),
            String(line?.batch_number || ''),
            String(line?.expiry_date || '2028-12-31'),
            Number(line?.quantity || 0),
            Number(line?.bonus_quantity || 0),
            Number(line?.purchase_rate ?? line?.purchase_price ?? 0),
            Number(line?.mrp_rate ?? line?.retail_price ?? 0),
            Number(line?.discount_percent || 0),
            Number(line?.line_total || 0)
          );
        }
        restoredPurchases++;
      }
    });
    try {
      upsertPurchasesTx();
    } catch {
      // ignore partial purchase conflict
    }
  }

  // 6. Restore Cash Book Vouchers
  const remoteVouchers = Array.isArray(extra?.cashBookVouchers) ? extra!.cashBookVouchers! : [];
  if (remoteVouchers.length > 0) {
    const upsertVouchersTx = db.transaction(() => {
      for (const v of remoteVouchers) {
        const vNo = String(v?.voucher_number || '').trim();
        const txId = String(v?.client_tx_id || '').trim();
        if (!vNo && !txId) continue;

        const existing =
          (txId
            ? (db.prepare('SELECT id FROM cash_book_vouchers WHERE client_tx_id = ? LIMIT 1').get(txId) as any)
            : undefined) ||
          (vNo
            ? (db.prepare('SELECT id FROM cash_book_vouchers WHERE voucher_number = ? LIMIT 1').get(vNo) as any)
            : undefined);
        if (existing) continue;

        db.prepare(
          `INSERT INTO cash_book_vouchers (
            voucher_number, sequence_number, voucher_date, transaction_type, category,
            head_account_id, head_account_code, head_account_name,
            cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
            receipt_amount, payment_amount, net_amount, narration, reference_number,
            status, client_tx_id, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          vNo || String(Date.now()).slice(-4),
          Number(v?.sequence_number || 1),
          String(v?.voucher_date || new Date().toISOString().slice(0, 10)),
          String(v?.transaction_type || 'Receipt'),
          String(v?.category || 'general'),
          Number(v?.head_account_id || 1),
          String(v?.head_account_code || ''),
          String(v?.head_account_name || 'Account'),
          Number(v?.cash_bank_account_id || 1),
          String(v?.cash_bank_account_code || 'FIN-1010'),
          String(v?.cash_bank_account_name || 'Cash in Hand'),
          Number(v?.receipt_amount || 0),
          Number(v?.payment_amount || 0),
          Number(v?.net_amount || 0),
          String(v?.narration || ''),
          String(v?.reference_number || ''),
          String(v?.status || 'posted'),
          txId || null,
          String(v?.created_by || 'Super Admin'),
          v?.created_at || new Date().toISOString()
        );
        restoredVouchers++;
      }
    });
    try {
      upsertVouchersTx();
    } catch {
      // ignore partial voucher conflict
    }
  }

  return {
    restoredItems,
    restoredInvoices,
    restoredAccounts,
    restoredInventory,
    restoredPurchases,
    restoredVouchers,
  };
}

export async function resetCloudPersistenceState(): Promise<void> {
  lastUploadedChecksum = null;
  syncState.lastError = null;

  if (pgPool && syncState.provider === 'postgres-cloudsql') {
    try {
      const snapshot = exportLocalDatabaseSnapshot();
      const compressedBase64 = zlib
        .gzipSync(Buffer.from(JSON.stringify(snapshot.tables), 'utf-8'))
        .toString('base64');
      await pgPool.query(
        `INSERT INTO ams_cloud_snapshots (snapshot_key, compressed_data, checksum, row_count, updated_at)
         VALUES ('primary', $1, $2, $3, NOW())
         ON CONFLICT (snapshot_key) DO UPDATE SET
           compressed_data = EXCLUDED.compressed_data,
           checksum = EXCLUDED.checksum,
           row_count = EXCLUDED.row_count,
           updated_at = NOW()`,
        [compressedBase64, snapshot.checksum, snapshot.rowCount]
      );
      lastUploadedChecksum = snapshot.checksum;
    } catch {
      // ignore if PG unavailable
    }
  }
}

export async function ensureCloudPersistenceReady(timeoutMs = 2500): Promise<void> {
  if (!initPersistencePromise) return;
  await Promise.race([
    initPersistencePromise.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Initializes persistent storage on startup.
 * Attempts PostgreSQL (if configured & reachable); otherwise uses persistent workspace SQLite central DB.
 */
export async function initCloudPersistence(): Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> {
  if (!initPersistencePromise) {
    initPersistencePromise = runInitCloudPersistence();
  }
  return initPersistencePromise;
}

async function runInitCloudPersistence(): Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> {
  const pool = getPostgresPool();
  if (pool) {
    try {
      await pool.query('SELECT 1');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ams_cloud_snapshots (
          snapshot_key TEXT PRIMARY KEY,
          compressed_data TEXT NOT NULL,
          checksum TEXT NOT NULL,
          row_count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      syncState.enabled = true;
      syncState.provider = 'postgres-cloudsql';
      syncState.connected = true;
      syncState.restoredFromCloud = false;
      syncState.lastError = null;

      // Automatic startup/republish restoration is disabled (AUTO_CLOUD_RESTORE_ENABLED = false).
      // Preserve existing active database records unconditionally; only manual Super Admin restore may replace data.
      return { provider: 'postgres-cloudsql', restored: false, rowsRestored: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[AMS DB] External PostgreSQL unreachable (${msg}); using permanent workspace SQLite database.`
      );
      pgPool = null;
    }
  }

  syncState.enabled = false;
  syncState.provider = 'sqlite-persistent-central';
  syncState.connected = true;
  syncState.restoredFromCloud = false;
  syncState.lastError = null;
  syncRuntimeToSeedDatabase();
  return { provider: 'sqlite-persistent-central', restored: false, rowsRestored: 0 };
}

export async function syncDatabaseToCloudSQL(_reason?: string): Promise<boolean> {
  syncRuntimeToSeedDatabase();

  if (!syncState.enabled || syncState.provider !== 'postgres-cloudsql' || !pgPool) {
    return false;
  }
  if (isSyncing) {
    pendingSync = true;
    return false;
  }

  const metrics = getLocalActivityMetrics();
  if (metrics.accountsCount === 0) {
    return false;
  }

  isSyncing = true;
  try {
    const snapshot = exportLocalDatabaseSnapshot();
    if (snapshot.rowCount === 0) {
      return false;
    }
    if (lastUploadedChecksum && lastUploadedChecksum === snapshot.checksum) {
      return true;
    }

    const compressedBase64 = zlib
      .gzipSync(Buffer.from(JSON.stringify(snapshot.tables), 'utf-8'))
      .toString('base64');

    await pgPool.query(
      `INSERT INTO ams_cloud_snapshots (snapshot_key, compressed_data, checksum, row_count, updated_at)
       VALUES ('primary', $1, $2, $3, NOW())
       ON CONFLICT (snapshot_key) DO UPDATE SET
         compressed_data = EXCLUDED.compressed_data,
         checksum = EXCLUDED.checksum,
         row_count = EXCLUDED.row_count,
         updated_at = NOW();`,
      [compressedBase64, snapshot.checksum, snapshot.rowCount]
    );

    lastUploadedChecksum = snapshot.checksum;
    syncState.connected = true;
    syncState.lastSyncedAt = new Date().toISOString();
    syncState.totalRowsSynced = snapshot.rowCount;
    syncState.snapshotVersion += 1;
    syncState.lastError = null;
    return true;
  } catch (err: unknown) {
    syncState.lastError = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      scheduleCloudSync(2500);
    }
  }
}

export async function uploadBackupToCloudSQL(
  filenameOrOpts:
    | string
    | {
        filename: string;
        filePath: string;
        backupType?: string;
        notes?: string;
        counts?: Record<string, number>;
      },
  filePathArg?: string,
  _backupType = 'manual'
): Promise<boolean> {
  try {
    const filename =
      typeof filenameOrOpts === 'string' ? filenameOrOpts : filenameOrOpts.filename;
    const filePath =
      typeof filenameOrOpts === 'string' ? filePathArg || '' : filenameOrOpts.filePath;

    if (!filePath || !fs.existsSync(filePath)) return false;
    if (syncState.provider === 'postgres-cloudsql' && pgPool) {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS ams_cloud_backups (
          filename TEXT PRIMARY KEY,
          compressed_blob TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const rawBuf = fs.readFileSync(filePath);
      const compressedBase64 = zlib.gzipSync(rawBuf).toString('base64');
      await pgPool.query(
        `INSERT INTO ams_cloud_backups (filename, compressed_blob, file_size_bytes, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (filename) DO UPDATE SET
           compressed_blob = EXCLUDED.compressed_blob,
           file_size_bytes = EXCLUDED.file_size_bytes,
           created_at = NOW();`,
        [filename, compressedBase64, rawBuf.length]
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function ensureLocalBackupFileFromCloudSQL(
  filename: string,
  targetPath: string
): Promise<boolean> {
  try {
    if (fs.existsSync(targetPath)) return true;
    if (syncState.provider === 'postgres-cloudsql' && pgPool) {
      const res = await pgPool.query(
        'SELECT compressed_blob FROM ams_cloud_backups WHERE filename = $1 LIMIT 1',
        [filename]
      );
      if (res.rows.length > 0 && res.rows[0].compressed_blob) {
        const rawBuf = zlib.gunzipSync(Buffer.from(res.rows[0].compressed_blob, 'base64'));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, rawBuf);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function scheduleCloudSync(delayMs = 2500): void {
  if (seedMirrorTimer) {
    clearTimeout(seedMirrorTimer);
  }
  seedMirrorTimer = setTimeout(() => {
    seedMirrorTimer = null;
    syncRuntimeToSeedDatabase();
  }, Math.min(delayMs, 500));

  if (!syncState.enabled || syncState.provider !== 'postgres-cloudsql') return;
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncDatabaseToCloudSQL().catch(() => {});
  }, delayMs);
}

export function cloudPersistenceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        scheduleCloudSync(2500);
      }
    });
  }
  next();
}
