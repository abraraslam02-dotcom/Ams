import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import pg from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { getDatabase, syncRuntimeToSeedDatabase } from '../db/connection.ts';
import { ensureAuthTables } from './authService.ts';
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

interface CloudSyncState {
  enabled: boolean;
  provider: 'postgres-cloudsql' | 'firestore-cloud' | 'local-sqlite-only';
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
  provider: 'local-sqlite-only',
  connected: false,
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
let firestoreWriteQuotaExhausted = false;
let firestoreQuotaResetAt = 0;
let initPersistencePromise: Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> | null = null;

interface FirestoreRestConfig {
  projectId: string;
  databaseId: string;
  apiKey: string;
}

let firestoreConfigCache: FirestoreRestConfig | null = null;

export function getCloudSyncStatus(): CloudSyncState {
  return { ...syncState };
}

export function getCloudPersistenceStatus(): CloudSyncState {
  return { ...syncState };
}

function getPostgresPool(): pg.Pool | null {
  if (pgPool) return pgPool;

  const connUrl = process.env.DATABASE_URL;
  const host = process.env.PGHOST || process.env.DB_HOST;
  const user = process.env.PGUSER || process.env.DB_USER || 'postgres';
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.PGDATABASE || process.env.DB_NAME || 'postgres';
  const port = Number(process.env.PGPORT || process.env.DB_PORT || 5432);
  const instanceConnName = process.env.INSTANCE_CONNECTION_NAME || process.env.CLOUD_SQL_CONNECTION_NAME;

  if (connUrl) {
    pgPool = new Pool({
      connectionString: connUrl,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    return pgPool;
  }

  if (host) {
    pgPool = new Pool({
      host,
      user,
      password,
      database,
      port,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    return pgPool;
  }

  if (instanceConnName && password) {
    const socketPath = `/cloudsql/${instanceConnName}`;
    pgPool = new Pool({
      user,
      password,
      database,
      host: socketPath,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2500,
    });
    return pgPool;
  }

  try {
    const cloudSqlBase = '/app/cloudsql';
    if (fs.existsSync(cloudSqlBase)) {
      const entries = fs.readdirSync(cloudSqlBase);
      for (const entry of entries) {
        const candidateDir = path.join(cloudSqlBase, entry);
        const pgSocket = path.join(candidateDir, '.s.PGSQL.5432');
        if (fs.existsSync(pgSocket)) {
          pgPool = new Pool({
            user: user || 'postgres',
            password: password || '',
            database: database || 'postgres',
            host: candidateDir,
            max: 3,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2500,
          });
          return pgPool;
        }
      }
    }
  } catch {
    // Ignore socket scan errors
  }

  return null;
}

function getFirestoreRestConfig(): FirestoreRestConfig | null {
  if (firestoreConfigCache) return firestoreConfigCache;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!raw.projectId || !raw.apiKey) return null;

    firestoreConfigCache = {
      projectId: String(raw.projectId),
      databaseId: String(raw.firestoreDatabaseId || '(default)'),
      apiKey: String(raw.apiKey),
    };
    return firestoreConfigCache;
  } catch {
    return null;
  }
}

function getFirestoreDocUrl(cfg: FirestoreRestConfig, docId: string): string {
  const encodedDb = encodeURIComponent(cfg.databaseId);
  const encodedDoc = encodeURIComponent(docId);
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${encodedDb}/documents/ams_cloud_snapshots/${encodedDoc}?key=${encodeURIComponent(cfg.apiKey)}`;
}

function parseFirestoreRestValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) {
    const vals = Array.isArray(v.arrayValue?.values) ? v.arrayValue.values : [];
    return vals.map(parseFirestoreRestValue);
  }
  if ('mapValue' in v) {
    const out: Record<string, any> = {};
    const fields = v.mapValue?.fields || {};
    for (const [mk, mv] of Object.entries<any>(fields)) {
      out[mk] = parseFirestoreRestValue(mv);
    }
    return out;
  }
  return null;
}

function parseFirestoreDocFields(docJson: any): Record<string, any> | null {
  if (!docJson || !docJson.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries<any>(docJson.fields)) {
    out[k] = parseFirestoreRestValue(v);
  }
  return out;
}

function toFirestoreDocFields(obj: Record<string, string | number | boolean>): { fields: Record<string, any> } {
  const fields: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      fields[k] = { stringValue: val };
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        fields[k] = { integerValue: String(val) };
      } else {
        fields[k] = { doubleValue: val };
      }
    } else if (typeof val === 'boolean') {
      fields[k] = { booleanValue: val };
    }
  }
  return { fields };
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
  rowCount: number;
  checksum: string;
  exportedAt: string;
} {
  const db = getDatabase();
  const tables: Record<string, any[]> = {};
  let rowCount = 0;

  const orderedTables = getOrderedExportTables(db);

  for (const table of orderedTables) {
    try {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      tables[table] = rows;
      rowCount += rows.length;
    } catch {
      // Skip tables that fail to read
    }
  }

  const exportedAt = new Date().toISOString();
  const rawJson = JSON.stringify(tables);
  const checksum = crypto.createHash('sha256').update(rawJson).digest('hex');

  return {
    tables,
    rowCount,
    checksum,
    exportedAt,
  };
}

function isLocalDatabaseFreshDefault(): boolean {
  const db = getDatabase();
  try {
    const salesCount = Number(
      (db.prepare('SELECT COUNT(*) as c FROM sales').get() as { c: number })?.c || 0
    );
    const purchasesCount = Number(
      (db.prepare('SELECT COUNT(*) as c FROM purchases').get() as { c: number })?.c || 0
    );
    const itemsCount = Number(
      (db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number })?.c || 0
    );
    const cashBookCount = Number(
      (db.prepare('SELECT COUNT(*) as c FROM cash_book_vouchers').get() as { c: number })?.c || 0
    );
    const customAccountsCount = Number(
      (
        db
          .prepare('SELECT COUNT(*) as c FROM accounts WHERE is_system_account = 0')
          .get() as { c: number }
      )?.c || 0
    );

    return (
      salesCount === 0 &&
      purchasesCount === 0 &&
      itemsCount === 0 &&
      cashBookCount === 0 &&
      customAccountsCount === 0
    );
  } catch {
    return true;
  }
}

interface DatabaseActivityMetrics {
  txRowCount: number;
  maxSaleId: number;
  maxPurchaseId: number;
  maxJournalId: number;
  maxCashBookId: number;
  maxPaymentVoucherId: number;
  maxAccountingVoucherId: number;
  accountsCount: number;
  itemsCount: number;
  inventoryCount: number;
  usersCount: number;
  tombstonesCount: number;
  latestTimestamp: string;
}

function normalizeDbTimestamp(ts: unknown): string {
  const clean = String(ts || '').trim();
  if (!clean) return '';
  return clean.replace(' ', 'T');
}

function getLocalActivityMetrics(): DatabaseActivityMetrics {
  const db = getDatabase();
  const safeCount = (table: string): number => {
    try {
      return Number((db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number })?.c || 0);
    } catch {
      return 0;
    }
  };
  const safeMaxId = (table: string): number => {
    try {
      return Number((db.prepare(`SELECT COALESCE(MAX(id), 0) as m FROM "${table}"`).get() as { m: number })?.m || 0);
    } catch {
      return 0;
    }
  };
  const safeMaxTs = (table: string, col = 'updated_at'): string => {
    try {
      const r = db.prepare(`SELECT COALESCE(MAX("${col}"), '') as ts FROM "${table}"`).get() as { ts: string };
      return normalizeDbTimestamp(r?.ts);
    } catch {
      return '';
    }
  };

  const txTables = [
    'sales',
    'sale_items',
    'purchases',
    'purchase_items',
    'cash_book_vouchers',
    'accounting_vouchers',
    'payment_vouchers',
    'journal_entries',
    'sale_returns',
    'purchase_returns',
    'stock_adjustments',
  ];
  const txRowCount = txTables.reduce((sum, t) => sum + safeCount(t), 0);

  const timestamps = [
    safeMaxTs('sales', 'updated_at'),
    safeMaxTs('sales', 'created_at'),
    safeMaxTs('purchases', 'updated_at'),
    safeMaxTs('purchases', 'created_at'),
    safeMaxTs('cash_book_vouchers', 'updated_at'),
    safeMaxTs('journal_entries', 'created_at'),
    safeMaxTs('accounts', 'updated_at'),
    safeMaxTs('accounts', 'created_at'),
    safeMaxTs('items', 'updated_at'),
    safeMaxTs('items', 'created_at'),
    safeMaxTs('inventory', 'updated_at'),
    safeMaxTs('inventory', 'created_at'),
    safeMaxTs('users', 'updated_at'),
    safeMaxTs('company_settings', 'updated_at'),
    safeMaxTs('sync_tombstones', 'deleted_at'),
  ].filter(Boolean);
  timestamps.sort();

  return {
    txRowCount,
    maxSaleId: safeMaxId('sales'),
    maxPurchaseId: safeMaxId('purchases'),
    maxJournalId: safeMaxId('journal_entries'),
    maxCashBookId: safeMaxId('cash_book_vouchers'),
    maxPaymentVoucherId: safeMaxId('payment_vouchers'),
    maxAccountingVoucherId: safeMaxId('accounting_vouchers'),
    accountsCount: safeCount('accounts'),
    itemsCount: safeCount('items'),
    inventoryCount: safeCount('inventory'),
    usersCount: safeCount('users'),
    tombstonesCount: safeCount('sync_tombstones'),
    latestTimestamp: timestamps[timestamps.length - 1] || '',
  };
}

function getRemoteActivityMetrics(tables: Record<string, any[]>): DatabaseActivityMetrics {
  const arr = (t: string): any[] => (Array.isArray(tables?.[t]) ? tables[t] : []);
  const maxId = (t: string): number =>
    arr(t).reduce((m, r) => Math.max(m, Number(r?.id || 0)), 0);
  const maxTs = (t: string, col: string): string =>
    arr(t).reduce((m, r) => {
      const val = normalizeDbTimestamp(r?.[col]);
      return val > m ? val : m;
    }, '');

  const txTables = [
    'sales',
    'sale_items',
    'purchases',
    'purchase_items',
    'cash_book_vouchers',
    'accounting_vouchers',
    'payment_vouchers',
    'journal_entries',
    'sale_returns',
    'purchase_returns',
    'stock_adjustments',
  ];
  const txRowCount = txTables.reduce((sum, t) => sum + arr(t).length, 0);

  const timestamps = [
    maxTs('sales', 'updated_at'),
    maxTs('sales', 'created_at'),
    maxTs('purchases', 'updated_at'),
    maxTs('purchases', 'created_at'),
    maxTs('cash_book_vouchers', 'updated_at'),
    maxTs('journal_entries', 'created_at'),
    maxTs('accounts', 'updated_at'),
    maxTs('accounts', 'created_at'),
    maxTs('items', 'updated_at'),
    maxTs('items', 'created_at'),
    maxTs('inventory', 'updated_at'),
    maxTs('inventory', 'created_at'),
    maxTs('users', 'updated_at'),
    maxTs('company_settings', 'updated_at'),
    maxTs('sync_tombstones', 'deleted_at'),
  ].filter(Boolean);
  timestamps.sort();

  return {
    txRowCount,
    maxSaleId: maxId('sales'),
    maxPurchaseId: maxId('purchases'),
    maxJournalId: maxId('journal_entries'),
    maxCashBookId: maxId('cash_book_vouchers'),
    maxPaymentVoucherId: maxId('payment_vouchers'),
    maxAccountingVoucherId: maxId('accounting_vouchers'),
    accountsCount: arr('accounts').length,
    itemsCount: arr('items').length,
    inventoryCount: arr('inventory').length,
    usersCount: arr('users').length,
    tombstonesCount: arr('sync_tombstones').length,
    latestTimestamp: timestamps[timestamps.length - 1] || '',
  };
}

function extractRemoteResetEpoch(tables: Record<string, any[]>): { epoch: string | null; resetAt: string | null } {
  const rows = Array.isArray(tables?.app_system_state) ? tables.app_system_state : [];
  let epoch: string | null = null;
  let resetAt: string | null = null;
  for (const r of rows) {
    if (r?.state_key === 'db_reset_epoch' && r?.state_value) epoch = String(r.state_value);
    if (r?.state_key === 'db_reset_at' && r?.state_value) resetAt = String(r.state_value);
  }
  return { epoch, resetAt };
}

function shouldRestoreFromRemoteSnapshot(remoteTables: Record<string, any[]>): boolean {
  if (!remoteTables || typeof remoteTables !== 'object') return false;

  const db = getDatabase();
  const localEpoch = getDbResetEpoch(db);
  const localResetAt = getDbResetTimestamp(db);
  const remoteReset = extractRemoteResetEpoch(remoteTables);

  // Never allow a pre-reset or mismatched-epoch remote snapshot to overwrite an intentionally reset DB
  if (localEpoch) {
    if (!remoteReset.epoch || remoteReset.epoch !== localEpoch) {
      // Only accept a different epoch if the remote reset itself happened strictly later than local reset
      if (!remoteReset.resetAt || !localResetAt || remoteReset.resetAt <= localResetAt) {
        return false;
      }
    }
  }

  if (isLocalDatabaseFreshDefault()) {
    // Only auto-restore into a blank DB if remote actually belongs to the current epoch (or no reset epoch exists)
    if (localEpoch && remoteReset.epoch !== localEpoch) {
      return false;
    }
    return true;
  }

  const local = getLocalActivityMetrics();
  const remote = getRemoteActivityMetrics(remoteTables);

  // Never overwrite local if remote has fewer items/accounts AND fewer transactions
  if (remote.itemsCount === 0 && local.itemsCount > 0) return false;

  // Never downgrade local data if local has newer timestamps than remote
  if (local.latestTimestamp && remote.latestTimestamp && local.latestTimestamp > remote.latestTimestamp) {
    return false;
  }

  // Never downgrade local transactions if local has newer/more transactions than remote
  const localHasNewerTx =
    local.txRowCount > remote.txRowCount ||
    local.maxSaleId > remote.maxSaleId ||
    local.maxPurchaseId > remote.maxPurchaseId ||
    local.maxJournalId > remote.maxJournalId ||
    local.maxCashBookId > remote.maxCashBookId ||
    local.tombstonesCount > remote.tombstonesCount;

  if (localHasNewerTx) {
    return false;
  }

  // Restore if remote has more transactions, higher transaction IDs, or newer timestamps
  const remoteHasMoreTx =
    remote.txRowCount > local.txRowCount ||
    remote.maxSaleId > local.maxSaleId ||
    remote.maxPurchaseId > local.maxPurchaseId ||
    remote.maxJournalId > local.maxJournalId ||
    remote.maxCashBookId > local.maxCashBookId ||
    remote.maxPaymentVoucherId > local.maxPaymentVoucherId ||
    remote.maxAccountingVoucherId > local.maxAccountingVoucherId ||
    remote.tombstonesCount > local.tombstonesCount;

  if (remoteHasMoreTx) {
    return true;
  }

  if (
    remote.txRowCount === local.txRowCount &&
    (remote.accountsCount > local.accountsCount ||
      remote.itemsCount > local.itemsCount ||
      remote.inventoryCount > local.inventoryCount ||
      remote.usersCount > local.usersCount ||
      (remote.latestTimestamp && remote.latestTimestamp > local.latestTimestamp))
  ) {
    return true;
  }

  return false;
}

function restoreSnapshotIntoLocalSqlite(tables: Record<string, any[]>): number {
  const db = getDatabase();
  let restoredRows = 0;

  const orderedTables = getOrderedExportTables(db);
  const existingTables = new Set(orderedTables);
  const remoteHasUsers = Array.isArray(tables.users) && tables.users.length > 0;

  const restoreTx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');

    for (const table of [...orderedTables].reverse()) {
      if (!existingTables.has(table)) continue;
      if ((table === 'users' || table === 'user_permissions') && !remoteHasUsers) {
        continue;
      }
      if (Array.isArray(tables[table])) {
        db.prepare(`DELETE FROM "${table}"`).run();
      }
    }

    for (const table of orderedTables) {
      if (!existingTables.has(table)) continue;
      const rows = tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const tableInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      const validColumns = new Set(tableInfo.map((c) => c.name));

      const sampleCols = Object.keys(rows[0]).filter((col) => validColumns.has(col));
      if (sampleCols.length === 0) continue;

      const colList = sampleCols.map((c) => `"${c}"`).join(', ');
      const placeholders = sampleCols.map(() => '?').join(', ');
      const insertStmt = db.prepare(
        `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`
      );

      for (const row of rows) {
        const values = sampleCols.map((col) => (row[col] !== undefined ? row[col] : null));
        insertStmt.run(...values);
        restoredRows++;
      }
    }

    db.pragma('foreign_keys = ON');
  });

  restoreTx();

  try {
    ensureAuthTables(db);
    db.exec('REINDEX;');
    syncRuntimeToSeedDatabase();
  } catch {
    // ignore post-restore reindex/mirror warning
  }

  return restoredRows;
}

async function saveSnapshotToFirestore(snapshot: {
  tables: Record<string, any[]>;
  rowCount: number;
  checksum: string;
  exportedAt: string;
}): Promise<boolean> {
  if (firestoreWriteQuotaExhausted && Date.now() < firestoreQuotaResetAt) {
    return false;
  }

  const cfg = getFirestoreRestConfig();
  if (!cfg) return false;

  if (lastUploadedChecksum && lastUploadedChecksum === snapshot.checksum) {
    return true;
  }

  const compressedBase64 = zlib
    .gzipSync(Buffer.from(JSON.stringify(snapshot.tables), 'utf-8'))
    .toString('base64');

  const CHUNK_SIZE = 700_000;
  const chunks: string[] = [];
  for (let i = 0; i < compressedBase64.length; i += CHUNK_SIZE) {
    chunks.push(compressedBase64.slice(i, i + CHUNK_SIZE));
  }

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkUrl = getFirestoreDocUrl(cfg, `primary_chunk_${idx}`);
    const body = toFirestoreDocFields({
      syncKey: 'ams_erp_cloud_sync_v2_2026',
      snapshotKey: 'primary',
      chunkIndex: idx,
      totalChunks: chunks.length,
      checksum: snapshot.checksum,
      data: chunks[idx],
      updatedAt: snapshot.exportedAt || new Date().toISOString(),
    });

    const res = await fetch(chunkUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      if (res.status === 429) {
        firestoreWriteQuotaExhausted = true;
        firestoreQuotaResetAt = Date.now() + 60 * 60 * 1000; // Pause writes for 1 hour
        syncState.lastError = 'Firestore daily free write quota reached; using local SQLite persistence.';
        return false;
      }
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`Firestore chunk write failed (${res.status}): ${errText.slice(0, 180)}`);
    }
  }

  const metaUrl = getFirestoreDocUrl(cfg, 'primary_meta');
  const metaBody = toFirestoreDocFields({
    syncKey: 'ams_erp_cloud_sync_v2_2026',
    snapshotKey: 'primary',
    totalChunks: chunks.length,
    rowCount: snapshot.rowCount,
    checksum: snapshot.checksum,
    exportedAt: snapshot.exportedAt,
    updatedAt: new Date().toISOString(),
  });

  const metaRes = await fetch(metaUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metaBody),
    signal: AbortSignal.timeout(5000),
  });

  if (!metaRes.ok) {
    if (metaRes.status === 429) {
      firestoreWriteQuotaExhausted = true;
      firestoreQuotaResetAt = Date.now() + 60 * 60 * 1000;
      syncState.lastError = 'Firestore daily free write quota reached; using local SQLite persistence.';
      return false;
    }
    const errText = await metaRes.text().catch(() => `HTTP ${metaRes.status}`);
    throw new Error(`Firestore meta write failed (${metaRes.status}): ${errText.slice(0, 180)}`);
  }

  lastUploadedChecksum = snapshot.checksum;
  return true;
}

async function loadSnapshotFromFirestore(): Promise<{
  tables: Record<string, any[]>;
  rowCount: number;
  checksum: string;
  exportedAt: string;
} | null> {
  const cfg = getFirestoreRestConfig();
  if (!cfg) return null;

  const metaUrl = getFirestoreDocUrl(cfg, 'primary_meta');
  const metaRes = await fetch(metaUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });

  if (metaRes.status === 404) {
    return null;
  }
  if (!metaRes.ok) {
    return null;
  }

  const metaDoc = await metaRes.json();
  const meta = parseFirestoreDocFields(metaDoc);
  if (!meta) return null;

  const totalChunks = Number(meta.totalChunks || 0);
  if (totalChunks <= 0) return null;

  const parts: string[] = [];
  for (let idx = 0; idx < totalChunks; idx++) {
    const chunkUrl = getFirestoreDocUrl(cfg, `primary_chunk_${idx}`);
    const chunkRes = await fetch(chunkUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!chunkRes.ok) return null;
    const chunkDoc = await chunkRes.json();
    const chunkFields = parseFirestoreDocFields(chunkDoc);
    if (!chunkFields || typeof chunkFields.data !== 'string') return null;
    parts.push(chunkFields.data);
  }

  const compressedBase64 = parts.join('');
  const decompressedJson = zlib
    .gunzipSync(Buffer.from(compressedBase64, 'base64'))
    .toString('utf-8');
  const tables = JSON.parse(decompressedJson);

  return {
    tables,
    rowCount: Number(meta.rowCount || 0),
    checksum: String(meta.checksum || ''),
    exportedAt: String(meta.exportedAt || ''),
  };
}

async function queryFirestoreCollectionBySyncKey(
  cfg: FirestoreRestConfig,
  collectionId: 'items' | 'invoices'
): Promise<Array<Record<string, any>>> {
  const encodedDb = encodeURIComponent(cfg.databaseId);
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${encodedDb}/documents:runQuery?key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'syncKey' },
          op: 'EQUAL',
          value: { stringValue: 'ams_erp_cloud_sync_v2_2026' },
        },
      },
      limit: 5000,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];
  const results: Array<Record<string, any>> = [];
  for (const r of rows) {
    if (r?.document?.fields) {
      const parsed = parseFirestoreDocFields(r.document);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

export function hydrateSqliteFromCloudRecords(
  items: Array<Record<string, any>> = [],
  invoices: Array<Record<string, any>> = []
): { restoredItems: number; restoredInvoices: number } {
  const db = getDatabase();
  let restoredItems = 0;
  let restoredInvoices = 0;

  const tx = db.transaction(() => {
    const findItemStmt = db.prepare('SELECT id, updated_at, company_name FROM items WHERE LOWER(item_code) = LOWER(?) LIMIT 1');
    const insertItemStmt = db.prepare(`
      INSERT INTO items (
        item_code, barcode, item_name, generic_name, category, company_name,
        packing, purchase_price, trade_price, wholesale_price, retail_price,
        loose_rate, tax_percent, discount_percent, minimum_stock, opening_stock,
        rack_number, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateItemStmt = db.prepare(`
      UPDATE items SET
        barcode = COALESCE(?, barcode),
        item_name = ?,
        generic_name = ?,
        category = ?,
        company_name = ?,
        packing = ?,
        purchase_price = ?,
        trade_price = ?,
        wholesale_price = ?,
        retail_price = ?,
        loose_rate = ?,
        tax_percent = ?,
        discount_percent = ?,
        minimum_stock = ?,
        opening_stock = ?,
        rack_number = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `);

    for (const it of items) {
      const code = String(it?.item_code || '').trim();
      const name = String(it?.item_name || '').trim();
      if (!code || !name) continue;
      const existing = findItemStmt.get(code) as { id: number; updated_at?: string; company_name?: string } | undefined;
      const incomingTs = normalizeDbTimestamp(it?.updated_at || it?.updatedAt || '');
      const status = String(it?.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
      const packing = String(it?.packing || '1x1').trim() || '1x1';
      const companyName = String(it?.company_name || 'General').trim() || 'General';
      const category = String(it?.category || 'Medicine').trim() || 'Medicine';
      const retailPrice = Number(it?.retail_price || 0);
      const looseRate = Number(it?.loose_rate || 0);

      if (!existing) {
        insertItemStmt.run(
          code,
          it?.barcode || null,
          name,
          it?.generic_name || '',
          category,
          companyName,
          packing,
          Number(it?.purchase_price || 0),
          Number(it?.trade_price || 0),
          Number(it?.wholesale_price || 0),
          retailPrice,
          looseRate,
          Number(it?.tax_percent || 0),
          Number(it?.discount_percent || 0),
          Number(it?.minimum_stock ?? it?.reorder_level ?? 10),
          Number(it?.opening_stock ?? it?.current_stock ?? 0),
          String(it?.rack_number ?? it?.rack_location ?? ''),
          status,
          String(it?.created_at || it?.createdAt || new Date().toISOString()),
          String(it?.updated_at || it?.updatedAt || new Date().toISOString())
        );
        restoredItems++;
      } else if (incomingTs && incomingTs > normalizeDbTimestamp(existing.updated_at)) {
        updateItemStmt.run(
          it?.barcode || null,
          name,
          it?.generic_name || '',
          category,
          companyName,
          packing,
          Number(it?.purchase_price || 0),
          Number(it?.trade_price || 0),
          Number(it?.wholesale_price || 0),
          retailPrice,
          looseRate,
          Number(it?.tax_percent || 0),
          Number(it?.discount_percent || 0),
          Number(it?.minimum_stock ?? it?.reorder_level ?? 10),
          Number(it?.opening_stock ?? it?.current_stock ?? 0),
          String(it?.rack_number ?? it?.rack_location ?? ''),
          status,
          String(it?.updated_at || it?.updatedAt || new Date().toISOString()),
          existing.id
        );
        restoredItems++;
      }
    }

    const findSaleByTx = db.prepare('SELECT id FROM sales WHERE client_request_id = ? LIMIT 1');
    const findSaleByInv = db.prepare('SELECT id FROM sales WHERE LOWER(invoice_number) = LOWER(?) LIMIT 1');
    const insertSaleStmt = db.prepare(`
      INSERT INTO sales (
        invoice_number, invoice_date, customer_account_id, customer_name,
        customer_filer_status, salesman, invoice_type, payment_mode,
        gross_total, discount_amount, tax_amount, net_total,
        paid_amount, balance_amount, status, remarks,
        client_request_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSaleLineStmt = db.prepare(`
      INSERT INTO sale_items (
        sale_id, item_id, item_code, company_name, item_name, packing, units_per_pack,
        batch_number, expiry_date, quantity, bonus_quantity, loose_quantity, total_units,
        unit_price, loose_rate, discount_percent, discount_amount,
        gross_amount, taxable_amount, tax_percent, tax_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const inv of invoices) {
      const txId = String(inv?.clientTxId || inv?.client_tx_id || inv?.client_request_id || '').trim();
      const invNo = String(inv?.invoice_number || txId).trim();
      if (!invNo) continue;
      const existing =
        (txId ? findSaleByTx.get(txId) : undefined) ||
        findSaleByInv.get(invNo);
      if (existing) continue;

      const rawType = String(inv?.invoice_type || 'Retail');
      const invType = rawType === 'Wholesale' ? 'Wholesale' : 'Retail';
      const rawPay = String(inv?.payment_mode || 'Cash');
      const payMode = ['Cash', 'Credit', 'Partial', 'Bank'].includes(rawPay) ? rawPay : 'Cash';
      const rawSt = String(inv?.status || 'completed').toLowerCase();
      const saleStatus = ['completed', 'held', 'draft', 'cancelled'].includes(rawSt) ? rawSt : 'completed';

      let custId: number | null = null;
      if (Number(inv?.customer_account_id) > 0) {
        const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(inv.customer_account_id)) as { id: number } | undefined;
        if (acc) custId = acc.id;
      }

      const info = insertSaleStmt.run(
        invNo,
        String(inv?.invoice_date || new Date().toISOString().slice(0, 10)),
        custId,
        String(inv?.customer_name || 'Walk-in Cash Customer'),
        String(inv?.customer_filer_status || 'Non-Filer'),
        String(inv?.salesman || 'Counter Pharmacist'),
        invType,
        payMode,
        Number(inv?.gross_total || 0),
        Number(inv?.discount_total ?? inv?.discount_amount ?? 0),
        Number(inv?.tax_total ?? inv?.tax_amount ?? 0),
        Number(inv?.net_total || 0),
        Number(inv?.paid_amount || 0),
        Number(inv?.balance_amount || 0),
        saleStatus,
        String(inv?.remarks || ''),
        txId || null,
        String(inv?.created_at || inv?.createdAt || new Date().toISOString()),
        String(inv?.updated_at || inv?.updatedAt || new Date().toISOString())
      );
      const newSaleId = Number(info.lastInsertRowid);
      const lines = Array.isArray(inv?.items) ? inv.items : [];
      for (const ln of lines) {
        const lineCode = String(ln?.item_code || '').trim();
        let matchedItem = lineCode
          ? (findItemStmt.get(lineCode) as { id: number; company_name?: string } | undefined)
          : undefined;
        if (!matchedItem && Number(ln?.item_id) > 0) {
          matchedItem = db.prepare('SELECT id, company_name FROM items WHERE id = ?').get(Number(ln.item_id)) as { id: number; company_name?: string } | undefined;
        }
        if (!matchedItem) continue;
        const qty = Number(ln?.quantity || 0);
        const looseQty = Number(ln?.loose_quantity || 0);
        const bonusQty = Number(ln?.bonus_quantity || 0);
        const uPerPack = Number(ln?.units_per_pack || 1) || 1;
        const unitPrice = Number(ln?.unit_price || 0);
        const looseRate = Number(ln?.loose_rate || 0);
        const lineTotal = Number(ln?.line_total || 0);
        const discAmt = Number(ln?.discount_amount || 0);
        const taxAmt = Number(ln?.tax_amount || 0);
        const grossAmt = Number(ln?.gross_amount ?? (qty * unitPrice + looseQty * looseRate));
        const taxableAmt = Number(ln?.taxable_amount ?? Math.max(0, grossAmt - discAmt));
        insertSaleLineStmt.run(
          newSaleId,
          matchedItem.id,
          lineCode || String(ln?.item_id),
          String(ln?.company_name || matchedItem.company_name || 'General'),
          String(ln?.item_name || 'Item'),
          String(ln?.packing || '1x1'),
          uPerPack,
          String(ln?.batch_number || 'DEFAULT-BATCH'),
          String(ln?.expiry_date || '2028-12-31'),
          qty,
          bonusQty,
          looseQty,
          Number(ln?.total_units ?? (qty * uPerPack + looseQty)),
          unitPrice,
          looseRate,
          Number(ln?.discount_percent || 0),
          discAmt,
          grossAmt,
          taxableAmt,
          Number(ln?.tax_percent || 0),
          taxAmt,
          lineTotal
        );
      }
      restoredInvoices++;
    }
  });

  tx();
  if (restoredItems > 0 || restoredInvoices > 0) {
    try {
      syncRuntimeToSeedDatabase();
    } catch {
      // ignore mirror warning
    }
  }
  return { restoredItems, restoredInvoices };
}

export async function restoreItemsAndInvoicesFromFirestoreCollections(): Promise<{
  restoredItems: number;
  restoredInvoices: number;
}> {
  const cfg = getFirestoreRestConfig();
  if (!cfg) return { restoredItems: 0, restoredInvoices: 0 };

  const db = getDatabase();
  const resetAt = getDbResetTimestamp(db);

  const [rawRemoteItems, rawRemoteInvoices] = await Promise.all([
    queryFirestoreCollectionBySyncKey(cfg, 'items').catch((e) => {
      console.warn('[AMS Cloud Persistence] Firestore items query warning:', e?.message || e);
      return [];
    }),
    queryFirestoreCollectionBySyncKey(cfg, 'invoices').catch((e) => {
      console.warn('[AMS Cloud Persistence] Firestore invoices query warning:', e?.message || e);
      return [];
    }),
  ]);

  // Never pull pre-reset records back into a freshly reset database
  const isPostResetRecord = (rec: Record<string, any>): boolean => {
    if (!resetAt) return true;
    const recTs = normalizeDbTimestamp(rec?.updatedAt || rec?.updated_at || rec?.createdAt || rec?.created_at);
    return Boolean(recTs && recTs > normalizeDbTimestamp(resetAt));
  };

  const remoteItems = rawRemoteItems.filter(isPostResetRecord);
  const remoteInvoices = rawRemoteInvoices.filter(isPostResetRecord);

  if (remoteItems.length === 0 && remoteInvoices.length === 0) {
    return { restoredItems: 0, restoredInvoices: 0 };
  }

  try {
    return hydrateSqliteFromCloudRecords(remoteItems, remoteInvoices);
  } catch (err: any) {
    console.error('[AMS Cloud Persistence] SQLite hydration error:', err?.message || err);
    throw err;
  }
}

export async function resetCloudPersistenceState(): Promise<void> {
  lastUploadedChecksum = null;
  syncState.lastSyncedAt = null;
  syncState.restoredFromCloud = false;
  syncState.totalRowsSynced = 0;
  syncState.snapshotVersion = 0;

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  const pool = getPostgresPool();
  if (pool) {
    try {
      await pool.query(`DELETE FROM ams_cloud_snapshots WHERE snapshot_key = 'primary'`);
    } catch {
      // Ignore if Cloud SQL proxy unavailable
    }
  }

  // Also clear legacy Firestore ams_cloud_snapshots chunks if rules permit
  const cfg = getFirestoreRestConfig();
  if (cfg) {
    const chunkIds = ['primary_meta', ...Array.from({ length: 20 }, (_, i) => `primary_chunk_${i}`)];
    await Promise.allSettled(
      chunkIds.map((id) =>
        fetch(getFirestoreDocUrl(cfg, id), {
          method: 'DELETE',
          signal: AbortSignal.timeout(4000),
        })
      )
    );
  }
}

/**
 * Initializes persistent Cloud SQL / Firestore storage on startup.
 * Runs non-blocking after the HTTP server starts listening so container health probes never time out.
 */
export async function ensureCloudPersistenceReady(timeoutMs = 3500): Promise<void> {
  if (!initPersistencePromise) return;
  try {
    await Promise.race([
      initPersistencePromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // ignore init error
  }
}

export async function initCloudPersistence(): Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> {
  if (initPersistencePromise) {
    return initPersistencePromise;
  }
  initPersistencePromise = runInitCloudPersistence();
  return initPersistencePromise;
}

async function runInitCloudPersistence(): Promise<{
  provider: string;
  restored: boolean;
  rowsRestored: number;
}> {
  const localIsFresh = isLocalDatabaseFreshDefault();

  // 1. Try Cloud SQL PostgreSQL first if configured
  const pool = getPostgresPool();
  if (pool) {
    try {
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
      syncState.lastError = null;

      const res = await pool.query(
        `SELECT compressed_data, checksum, row_count, updated_at FROM ams_cloud_snapshots WHERE snapshot_key = 'primary'`
      );

      if (res.rows.length > 0) {
        const remoteRow = res.rows[0];
        lastUploadedChecksum = String(remoteRow.checksum || '');

        const jsonStr = zlib
          .gunzipSync(Buffer.from(remoteRow.compressed_data, 'base64'))
          .toString('utf-8');
        const tables = JSON.parse(jsonStr);

        if (shouldRestoreFromRemoteSnapshot(tables)) {
          const restoredCount = restoreSnapshotIntoLocalSqlite(tables);
          syncState.restoredFromCloud = true;
          syncState.lastRestoredAt = new Date().toISOString();
          syncState.totalRowsSynced = restoredCount;
          console.log(
            `[AMS Cloud Persistence] Restored ${restoredCount} records from Cloud SQL PostgreSQL.`
          );
          return { provider: 'postgres-cloudsql', restored: true, rowsRestored: restoredCount };
        }
      }

      if (!localIsFresh) {
        await syncDatabaseToCloudSQL();
      }
      return { provider: 'postgres-cloudsql', restored: false, rowsRestored: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AMS Cloud Persistence] Cloud SQL unavailable (${msg}), checking Firestore fallback...`);
      pgPool = null;
    }
  }

  // 2. Fallback to Firebase Firestore via timeout-bounded REST API
  const fsCfg = getFirestoreRestConfig();
  if (fsCfg) {
    try {
      syncState.enabled = true;
      syncState.provider = 'firestore-cloud';
      syncState.connected = true;
      syncState.lastError = null;

      const remoteSnapshot = await loadSnapshotFromFirestore();
      if (remoteSnapshot && remoteSnapshot.rowCount > 0) {
        lastUploadedChecksum = remoteSnapshot.checksum;

        if (shouldRestoreFromRemoteSnapshot(remoteSnapshot.tables)) {
          const restoredCount = restoreSnapshotIntoLocalSqlite(remoteSnapshot.tables);
          syncState.restoredFromCloud = true;
          syncState.lastRestoredAt = new Date().toISOString();
          syncState.totalRowsSynced = restoredCount;
          console.log(
            `[AMS Cloud Persistence] Restored ${restoredCount} records from Cloud Firestore.`
          );
          return { provider: 'firestore-cloud', restored: true, rowsRestored: restoredCount };
        }
      }

      // If no full snapshot existed (or local SQLite is still fresh with 0 items/sales), restore items & invoices directly from Firestore collections
      const localMetrics = getLocalActivityMetrics();
      if (localMetrics.itemsCount === 0 || localMetrics.maxSaleId === 0) {
        const collectionRestore = await restoreItemsAndInvoicesFromFirestoreCollections().catch(() => ({
          restoredItems: 0,
          restoredInvoices: 0,
        }));
        const totalCollectionRestored =
          collectionRestore.restoredItems + collectionRestore.restoredInvoices;
        if (totalCollectionRestored > 0) {
          syncState.restoredFromCloud = true;
          syncState.lastRestoredAt = new Date().toISOString();
          syncState.totalRowsSynced = totalCollectionRestored;
          console.log(
            `[AMS Cloud Persistence] Hydrated ${collectionRestore.restoredItems} items and ${collectionRestore.restoredInvoices} invoices from Firestore collections.`
          );
          return {
            provider: 'firestore-cloud',
            restored: true,
            rowsRestored: totalCollectionRestored,
          };
        }
      }

      // Upload to Firestore on startup if remote snapshot does not exist or is missing newly added tables (e.g. journal_entry_lines)
      const remoteMissingCoreTables =
        !remoteSnapshot ||
        !Array.isArray(remoteSnapshot.tables?.journal_entry_lines) ||
        !Array.isArray(remoteSnapshot.tables?.invoice_number_registry);

      if ((remoteMissingCoreTables || !remoteSnapshot) && !localIsFresh && !firestoreWriteQuotaExhausted) {
        lastUploadedChecksum = null;
        const snapshot = exportLocalDatabaseSnapshot();
        const saved = await saveSnapshotToFirestore(snapshot);
        if (saved) {
          syncState.lastSyncedAt = new Date().toISOString();
          syncState.totalRowsSynced = snapshot.rowCount;
          syncState.snapshotVersion += 1;
        }
      }

      return { provider: 'firestore-cloud', restored: false, rowsRestored: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      syncState.lastError = msg;
      console.warn(`[AMS Cloud Persistence] Firestore fallback warning: ${msg}`);
    }
  }

  return { provider: 'local-sqlite-only', restored: false, rowsRestored: 0 };
}

/**
 * Synchronizes the current SQLite state to workspace seed DB and Cloud SQL / Cloud Firestore.
 */
export async function syncDatabaseToCloudSQL(_reason?: string): Promise<boolean> {
  // Always mirror runtime SQLite to workspace seed DB first
  syncRuntimeToSeedDatabase();

  if (!syncState.enabled) return false;
  if (
    syncState.provider === 'firestore-cloud' &&
    firestoreWriteQuotaExhausted &&
    Date.now() < firestoreQuotaResetAt
  ) {
    return false;
  }

  if (isSyncing) {
    pendingSync = true;
    return false;
  }

  isSyncing = true;
  try {
    const snapshot = exportLocalDatabaseSnapshot();
    if (lastUploadedChecksum && lastUploadedChecksum === snapshot.checksum) {
      return true;
    }

    if (syncState.provider === 'postgres-cloudsql' && pgPool) {
      const compressedBase64 = zlib
        .gzipSync(Buffer.from(JSON.stringify(snapshot.tables), 'utf-8'))
        .toString('base64');

      await pgPool.query(
        `
        INSERT INTO ams_cloud_snapshots (snapshot_key, compressed_data, checksum, row_count, updated_at)
        VALUES ('primary', $1, $2, $3, NOW())
        ON CONFLICT (snapshot_key) DO UPDATE SET
          compressed_data = EXCLUDED.compressed_data,
          checksum = EXCLUDED.checksum,
          row_count = EXCLUDED.row_count,
          updated_at = NOW();
        `,
        [compressedBase64, snapshot.checksum, snapshot.rowCount]
      );

      lastUploadedChecksum = snapshot.checksum;
      syncState.connected = true;
      syncState.lastSyncedAt = new Date().toISOString();
      syncState.totalRowsSynced = snapshot.rowCount;
      syncState.snapshotVersion += 1;
      syncState.lastError = null;
      return true;
    }

    if (syncState.provider === 'firestore-cloud') {
      const saved = await saveSnapshotToFirestore(snapshot);
      if (saved) {
        syncState.connected = true;
        syncState.lastSyncedAt = new Date().toISOString();
        syncState.totalRowsSynced = snapshot.rowCount;
        syncState.snapshotVersion += 1;
        syncState.lastError = null;
      }
      return saved;
    }

    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    syncState.lastError = msg;
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
        `
        INSERT INTO ams_cloud_backups (filename, compressed_blob, file_size_bytes, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (filename) DO UPDATE SET
          compressed_blob = EXCLUDED.compressed_blob,
          file_size_bytes = EXCLUDED.file_size_bytes,
          created_at = NOW();
        `,
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
  // Always schedule a fast local seed mirror (500ms) even if cloud quota is paused
  if (seedMirrorTimer) {
    clearTimeout(seedMirrorTimer);
  }
  seedMirrorTimer = setTimeout(() => {
    seedMirrorTimer = null;
    syncRuntimeToSeedDatabase();
  }, Math.min(delayMs, 500));

  if (!syncState.enabled) return;
  if (
    syncState.provider === 'firestore-cloud' &&
    firestoreWriteQuotaExhausted &&
    Date.now() < firestoreQuotaResetAt
  ) {
    return;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncDatabaseToCloudSQL().catch(() => {});
  }, delayMs);
}

/**
 * Express middleware that schedules a fast background seed mirror & cloud snapshot after successful mutating API calls.
 */
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
