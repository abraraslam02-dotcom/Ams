import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';
import { getDatabase, isDatabaseOpen, checkpointDatabaseWal } from '../db/connection.ts';
import { createDatabaseBackup, type BackupRecord } from './backupService.ts';
import {
  getDurablePendingCloudSyncCount,
  markDurablePendingCloudSyncCompleted,
} from './cloudPersistenceService.ts';
import {
  getPersistedOperatingModeState,
  updatePersistedOperatingModeState,
} from './operatingModeStore.ts';
import { recalculateAccountBalance } from '../routes/accounts.ts';

/**
 * Strictly Business Transaction & Master Data Tables ONLY.
 * Ordered by relational dependency so parent tables are exported and restored before child tables.
 * Excludes all technical, session, log, cache, and system settings tables.
 */
export const BUSINESS_SYNC_TABLES: readonly string[] = [
  // 1. Accounts, Parties, Customers, Suppliers & Cities
  'cities',
  'accounts',
  // 2. Items, Barcodes, Packing Levels, Companies & Inventory Batches
  'item_companies',
  'items',
  'item_variants',
  'item_variant_barcodes',
  'item_packing_levels',
  'item_purchase_units',
  'inventory',
  'trade_offers',
  'party_discounts',
  'party_discount_history',
  // 3. Salesmen, Deliverymen, Towns & Employees
  'salesmen',
  'deliverymen',
  'towns',
  'town_areas',
  'employees',
  'employee_salary_structures',
  // 4. Purchases & Purchase Returns
  'purchases',
  'purchase_items',
  'purchase_returns',
  'purchase_return_items',
  // 5. Sales & Sales Returns
  'sales',
  'sale_items',
  'sale_returns',
  'sale_return_items',
  // 6. Ledgers, Journal Entries, Cash Book, Vouchers & Expenses
  'journal_entries',
  'journal_entry_lines',
  'cash_book_vouchers',
  'accounting_vouchers',
  'accounting_voucher_lines',
  'payment_vouchers',
  'expenses',
  // 7. Stock Movements, Stock Ledger & Adjustments
  'batch_stock_movements',
  'stock_ledger',
  'stock_adjustments',
  'stock_adjustment_items',
  'stock_transfers',
  'stock_transfer_items',
  'physical_verifications',
  'physical_verification_items',
  // 8. Supply Operations, Settlements & Payroll Transactions
  'supply_bookings',
  'supply_booking_items',
  'town_supplies',
  'town_supply_items',
  'party_supplies',
  'party_supply_items',
  'supply_dispatches',
  'supply_returns',
  'supply_return_items',
  'supply_recoveries',
  'salesman_settlements',
  'salesman_settlement_expenses',
  'salesman_commission_payments',
  'payroll_records',
  'salary_payments',
  'employee_advances_loans',
  'employee_advance_loan_recoveries',
  'employee_financial_ledger',
  // 9. Deletion Tombstones (prevents deleted business transactions from reappearing)
  'sync_tombstones',
] as const;

/**
 * Natural unique keys per table used for strict duplicate prevention during manual restore/merge.
 */
const TABLE_NATURAL_UNIQUE_COLUMNS: Record<string, string[]> = {
  accounts: ['account_code'],
  items: ['item_code'],
  sales: ['invoice_number', 'client_request_id'],
  sale_returns: ['return_number', 'client_request_id'],
  purchases: ['bill_number', 'client_request_id'],
  purchase_returns: ['return_number', 'client_request_id'],
  journal_entries: ['entry_number'],
  cash_book_vouchers: ['voucher_number', 'client_request_id'],
  accounting_vouchers: ['voucher_number', 'client_request_id'],
  payment_vouchers: ['voucher_number'],
  stock_adjustments: ['adjustment_number'],
  stock_transfers: ['transfer_number'],
  physical_verifications: ['verification_number'],
  supply_bookings: ['booking_number'],
  town_supplies: ['supply_number'],
  party_supplies: ['supply_number'],
  supply_returns: ['return_number'],
  supply_recoveries: ['recovery_number'],
  salesman_settlements: ['settlement_number'],
  employees: ['employee_code'],
};

export interface FirebaseSyncBatchPayload {
  batchId: string;
  syncSessionId: string;
  tableName: string;
  batchIndex: number;
  totalBatches: number;
  recordCount: number;
  recordsPayload: string;
  checksum: string;
}

export interface BusinessDataSummary {
  salesCount: number;
  saleItemsCount: number;
  saleReturnsCount: number;
  purchasesCount: number;
  purchaseItemsCount: number;
  purchaseReturnsCount: number;
  accountsCount: number;
  customersCount: number;
  suppliersCount: number;
  cashBankAccountsCount: number;
  itemsCount: number;
  inventoryBatchesCount: number;
  totalStockQuantity: number;
  journalEntriesCount: number;
  journalLinesCount: number;
  totalJournalDebit: number;
  totalJournalCredit: number;
  ledgerBalanced: boolean;
  cashBookVouchersCount: number;
  accountingVouchersCount: number;
  paymentVouchersCount: number;
  expensesCount: number;
  stockMovementsCount: number;
  totalBusinessRecords: number;
  tableCounts: Record<string, number>;
}

export interface FirebaseSyncErrorEntry {
  id: string;
  timestamp: string;
  operation: 'upload' | 'restore' | 'connection';
  message: string;
  details?: string;
}

export interface FirebaseSyncHistoryEntry {
  id: string;
  timestamp: string;
  operation: 'upload' | 'restore';
  status: 'Successful' | 'Failed';
  recordCount: number;
  batchCount: number;
  operator: string;
  message: string;
}

export interface PersistedFirebaseSyncState {
  syncStatus: 'Successful' | 'Pending' | 'Failed' | 'Not Run';
  lastSuccessfulSyncAt: string | null;
  lastSyncDirection: 'upload' | 'restore' | null;
  lastSyncRecordCount: number;
  lastSyncBatchCount: number;
  lastSyncSessionId: string | null;
  lastSyncSha256: string | null;
  lastSyncOperator: string | null;
  lastSyncError: string | null;
  syncErrors: FirebaseSyncErrorEntry[];
  syncHistory: FirebaseSyncHistoryEntry[];
}

const DEFAULT_FIREBASE_SYNC_STATE: PersistedFirebaseSyncState = {
  syncStatus: 'Not Run',
  lastSuccessfulSyncAt: null,
  lastSyncDirection: null,
  lastSyncRecordCount: 0,
  lastSyncBatchCount: 0,
  lastSyncSessionId: null,
  lastSyncSha256: null,
  lastSyncOperator: null,
  lastSyncError: null,
  syncErrors: [],
  syncHistory: [],
};

function getFirebaseSyncStateFilePath(): string {
  const dir = path.dirname(config.operatingModeConfigPath);
  return path.join(dir, 'ams_firebase_manual_sync.json');
}

export function getPersistedFirebaseSyncState(): PersistedFirebaseSyncState {
  try {
    const filePath = getFirebaseSyncStateFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedFirebaseSyncState>;
      return {
        ...DEFAULT_FIREBASE_SYNC_STATE,
        ...parsed,
        syncErrors: Array.isArray(parsed.syncErrors) ? parsed.syncErrors.slice(0, 50) : [],
        syncHistory: Array.isArray(parsed.syncHistory) ? parsed.syncHistory.slice(0, 50) : [],
      };
    }
  } catch {
    // ignore read error and fall back to default
  }
  return { ...DEFAULT_FIREBASE_SYNC_STATE };
}

export function updatePersistedFirebaseSyncState(
  patch: Partial<PersistedFirebaseSyncState>
): PersistedFirebaseSyncState {
  const current = getPersistedFirebaseSyncState();
  const next: PersistedFirebaseSyncState = {
    ...current,
    ...patch,
    syncErrors: Array.isArray(patch.syncErrors)
      ? patch.syncErrors.slice(0, 50)
      : current.syncErrors,
    syncHistory: Array.isArray(patch.syncHistory)
      ? patch.syncHistory.slice(0, 50)
      : current.syncHistory,
  };
  try {
    const filePath = getFirebaseSyncStateFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn('[AMS Firebase Manual Sync] Failed to persist state file:', err);
  }
  return next;
}

export function recordFirebaseSyncResult(params: {
  operation: 'upload' | 'restore';
  status: 'Successful' | 'Failed';
  recordCount?: number;
  batchCount?: number;
  syncSessionId?: string;
  sha256?: string;
  operator?: string;
  message: string;
  errorDetails?: string;
}): PersistedFirebaseSyncState {
  const nowIso = new Date().toISOString();
  const current = getPersistedFirebaseSyncState();
  const operator = params.operator || 'Super Admin';
  const recordCount = Number(params.recordCount || 0);
  const batchCount = Number(params.batchCount || 0);

  const historyEntry: FirebaseSyncHistoryEntry = {
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: nowIso,
    operation: params.operation,
    status: params.status,
    recordCount,
    batchCount,
    operator,
    message: params.message,
  };

  const nextHistory = [historyEntry, ...current.syncHistory].slice(0, 50);

  if (params.status === 'Successful') {
    const sha256 = params.sha256 || current.lastSyncSha256 || 'firebase_manual_sync';
    markDurablePendingCloudSyncCompleted({
      versionSeq: current.syncHistory.length + 1,
      sha256,
      syncedAt: nowIso,
    });
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Successful',
      lastSuccessfulCloudSyncAt: nowIso,
      lastCloudSyncError: null,
      pendingLocalChangesCount: 0,
    });

    return updatePersistedFirebaseSyncState({
      syncStatus: 'Successful',
      lastSuccessfulSyncAt: nowIso,
      lastSyncDirection: params.operation,
      lastSyncRecordCount: recordCount,
      lastSyncBatchCount: batchCount,
      lastSyncSessionId: params.syncSessionId || current.lastSyncSessionId,
      lastSyncSha256: sha256,
      lastSyncOperator: operator,
      lastSyncError: null,
      syncHistory: nextHistory,
    });
  } else {
    const errorEntry: FirebaseSyncErrorEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: nowIso,
      operation: params.operation,
      message: params.message,
      details: params.errorDetails,
    };
    const nextErrors = [errorEntry, ...current.syncErrors].slice(0, 50);

    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Failed',
      lastCloudSyncError: params.message,
    });

    return updatePersistedFirebaseSyncState({
      syncStatus: 'Failed',
      lastSyncError: params.message,
      syncErrors: nextErrors,
      syncHistory: nextHistory,
    });
  }
}

export function clearFirebaseSyncErrors(): PersistedFirebaseSyncState {
  updatePersistedOperatingModeState({
    lastCloudSyncError: null,
  });
  return updatePersistedFirebaseSyncState({
    lastSyncError: null,
    syncErrors: [],
  });
}

function tableExists(db: ReturnType<typeof getDatabase>, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function safeCount(db: ReturnType<typeof getDatabase>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { cnt?: number } | undefined;
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

/**
 * Computes a complete live summary of all business transactions and ledger integrity in Local SQLite.
 */
export function getLocalBusinessDataSummary(): BusinessDataSummary {
  const empty: BusinessDataSummary = {
    salesCount: 0,
    saleItemsCount: 0,
    saleReturnsCount: 0,
    purchasesCount: 0,
    purchaseItemsCount: 0,
    purchaseReturnsCount: 0,
    accountsCount: 0,
    customersCount: 0,
    suppliersCount: 0,
    cashBankAccountsCount: 0,
    itemsCount: 0,
    inventoryBatchesCount: 0,
    totalStockQuantity: 0,
    journalEntriesCount: 0,
    journalLinesCount: 0,
    totalJournalDebit: 0,
    totalJournalCredit: 0,
    ledgerBalanced: true,
    cashBookVouchersCount: 0,
    accountingVouchersCount: 0,
    paymentVouchersCount: 0,
    expensesCount: 0,
    stockMovementsCount: 0,
    totalBusinessRecords: 0,
    tableCounts: {},
  };

  if (!isDatabaseOpen()) return empty;
  const db = getDatabase();

  const tableCounts: Record<string, number> = {};
  let totalBusinessRecords = 0;

  for (const table of BUSINESS_SYNC_TABLES) {
    if (!tableExists(db, table)) {
      tableCounts[table] = 0;
      continue;
    }
    const cnt = safeCount(db, `SELECT COUNT(*) as cnt FROM "${table}"`);
    tableCounts[table] = cnt;
    if (table !== 'sync_tombstones') {
      totalBusinessRecords += cnt;
    }
  }

  const customersCount = safeCount(
    db,
    "SELECT COUNT(*) as cnt FROM accounts WHERE LOWER(account_type) IN ('customer', 'party')"
  );
  const suppliersCount = safeCount(
    db,
    "SELECT COUNT(*) as cnt FROM accounts WHERE LOWER(account_type) IN ('supplier', 'vendor', 'company')"
  );
  const cashBankAccountsCount = safeCount(
    db,
    "SELECT COUNT(*) as cnt FROM accounts WHERE LOWER(account_type) IN ('cash', 'bank')"
  );
  const totalStockQuantity = safeCount(
    db,
    'SELECT COALESCE(SUM(quantity), 0) as cnt FROM inventory'
  );

  let totalJournalDebit = 0;
  let totalJournalCredit = 0;
  try {
    const jeSums = db
      .prepare(
        `SELECT
           ROUND(COALESCE(SUM(jel.debit_amount), 0), 2) as totalDebit,
           ROUND(COALESCE(SUM(jel.credit_amount), 0), 2) as totalCredit
         FROM journal_entry_lines jel
         INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE LOWER(COALESCE(je.status, 'posted')) != 'cancelled'`
      )
      .get() as { totalDebit: number; totalCredit: number } | undefined;
    totalJournalDebit = Number(jeSums?.totalDebit || 0);
    totalJournalCredit = Number(jeSums?.totalCredit || 0);
  } catch {
    // ignore
  }

  const ledgerBalanced = Math.abs(totalJournalDebit - totalJournalCredit) <= 0.05;

  return {
    salesCount: tableCounts.sales || 0,
    saleItemsCount: tableCounts.sale_items || 0,
    saleReturnsCount: tableCounts.sale_returns || 0,
    purchasesCount: tableCounts.purchases || 0,
    purchaseItemsCount: tableCounts.purchase_items || 0,
    purchaseReturnsCount: tableCounts.purchase_returns || 0,
    accountsCount: tableCounts.accounts || 0,
    customersCount,
    suppliersCount,
    cashBankAccountsCount,
    itemsCount: tableCounts.items || 0,
    inventoryBatchesCount: tableCounts.inventory || 0,
    totalStockQuantity,
    journalEntriesCount: tableCounts.journal_entries || 0,
    journalLinesCount: tableCounts.journal_entry_lines || 0,
    totalJournalDebit,
    totalJournalCredit,
    ledgerBalanced,
    cashBookVouchersCount: tableCounts.cash_book_vouchers || 0,
    accountingVouchersCount: tableCounts.accounting_vouchers || 0,
    paymentVouchersCount: tableCounts.payment_vouchers || 0,
    expensesCount: tableCounts.expenses || 0,
    stockMovementsCount:
      (tableCounts.batch_stock_movements || 0) + (tableCounts.stock_ledger || 0),
    totalBusinessRecords,
    tableCounts,
  };
}

/**
 * Returns full Manual Firebase Sync status combined with live Local SQLite health.
 */
export function getFirebaseManualSyncStatus() {
  const syncState = getPersistedFirebaseSyncState();
  const opState = getPersistedOperatingModeState();
  const pendingCount = getDurablePendingCloudSyncCount();
  const summary = getLocalBusinessDataSummary();

  const effectiveStatus =
    syncState.syncStatus === 'Failed'
      ? 'Failed'
      : pendingCount > 0
      ? 'Pending'
      : syncState.lastSuccessfulSyncAt || opState.lastSuccessfulCloudSyncAt
      ? 'Successful'
      : 'Not Run';

  return {
    primaryDatabase: 'Local SQLite (better-sqlite3) — 100% Offline-First',
    databasePath: config.databasePath,
    dDriveDatabasePath: 'D:\\AbrarMedicalStore\\Database\\ams_medical.db',
    localDatabaseConnected: isDatabaseOpen(),
    cloudDestination: 'Firebase Firestore (Manual Sync Only)',
    autoSyncEnabled: false,
    backgroundListenersEnabled: false,
    syncStatus: effectiveStatus,
    lastSuccessfulSyncAt:
      syncState.lastSuccessfulSyncAt || opState.lastSuccessfulCloudSyncAt || null,
    lastSyncDirection: syncState.lastSyncDirection,
    lastSyncRecordCount: syncState.lastSyncRecordCount,
    lastSyncBatchCount: syncState.lastSyncBatchCount,
    lastSyncSessionId: syncState.lastSyncSessionId,
    lastSyncSha256: syncState.lastSyncSha256,
    lastSyncOperator: syncState.lastSyncOperator,
    lastSyncError: syncState.lastSyncError,
    pendingLocalChangesCount: pendingCount,
    syncErrors: syncState.syncErrors,
    syncHistory: syncState.syncHistory,
    businessDataSummary: summary,
  };
}

/**
 * Exports all actual business transactions from Local SQLite into deterministic,
 * checksum-verified batches ready for manual upload to Firebase Firestore.
 */
export function exportBusinessTransactionsForFirebase(): {
  syncSessionId: string;
  exportedAt: string;
  totalRecords: number;
  totalBatches: number;
  overallSha256: string;
  summary: BusinessDataSummary;
  batches: FirebaseSyncBatchPayload[];
} {
  if (!isDatabaseOpen()) {
    throw new Error('Local SQLite database is not open.');
  }
  checkpointDatabaseWal();
  const db = getDatabase();
  const exportedAt = new Date().toISOString();
  const syncSessionId = `sync_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const summary = getLocalBusinessDataSummary();

  const MAX_PAYLOAD_CHARS = 120000; // ~120 KB per batch document (well under Firestore 1MB limit & 800KB rule limit)
  const rawChunks: Array<{
    tableName: string;
    recordsPayload: string;
    recordCount: number;
    checksum: string;
  }> = [];

  const overallHash = crypto.createHash('sha256');

  for (const tableName of BUSINESS_SYNC_TABLES) {
    if (!tableExists(db, tableName)) continue;

    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    const hasId = cols.some((c) => c.name === 'id');
    const orderClause = hasId ? 'ORDER BY id ASC' : '';
    const rows = (
      tableName === 'sync_tombstones'
        ? db.prepare(`SELECT * FROM "sync_tombstones" ORDER BY id DESC LIMIT 1000`).all()
        : db.prepare(`SELECT * FROM "${tableName}" ${orderClause}`).all()
    ) as Array<Record<string, unknown>>;

    if (rows.length === 0) continue;

    let currentBatchRows: Array<Record<string, unknown>> = [];
    let currentSize = 2;

    const flushChunk = (chunkRows: Array<Record<string, unknown>>) => {
      if (chunkRows.length === 0) return;
      const recordsPayload = JSON.stringify(chunkRows);
      const checksum = crypto.createHash('sha256').update(recordsPayload).digest('hex');
      overallHash.update(`${tableName}:${checksum};`);
      rawChunks.push({
        tableName,
        recordsPayload,
        recordCount: chunkRows.length,
        checksum,
      });
    };

    for (const row of rows) {
      const rowJson = JSON.stringify(row);
      if (currentBatchRows.length > 0 && currentSize + rowJson.length + 2 > MAX_PAYLOAD_CHARS) {
        flushChunk(currentBatchRows);
        currentBatchRows = [];
        currentSize = 2;
      }
      currentBatchRows.push(row);
      currentSize += rowJson.length + 1;
    }

    if (currentBatchRows.length > 0) {
      flushChunk(currentBatchRows);
    }
  }

  // If database has 0 business records (e.g., fresh clean store), still emit 1 metadata checkpoint batch
  if (rawChunks.length === 0) {
    const emptyPayload = '[]';
    const checksum = crypto.createHash('sha256').update(emptyPayload).digest('hex');
    overallHash.update(`accounts:${checksum};`);
    rawChunks.push({
      tableName: 'accounts',
      recordsPayload: emptyPayload,
      recordCount: 0,
      checksum,
    });
  }

  const totalBatches = rawChunks.length;
  let totalRecords = 0;

  const batches: FirebaseSyncBatchPayload[] = rawChunks.map((chunk, idx) => {
    totalRecords += chunk.recordCount;
    const seq = String(idx + 1).padStart(4, '0');
    const safeTable = chunk.tableName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const batchId = `batch_${seq}_${safeTable}`;
    return {
      batchId,
      syncSessionId,
      tableName: chunk.tableName,
      batchIndex: idx,
      totalBatches,
      recordCount: chunk.recordCount,
      recordsPayload: chunk.recordsPayload,
      checksum: chunk.checksum,
    };
  });

  const overallSha256 = overallHash.digest('hex');

  return {
    syncSessionId,
    exportedAt,
    totalRecords,
    totalBatches,
    overallSha256,
    summary,
    batches,
  };
}

function parseTimestampMs(val: unknown): number {
  if (!val || typeof val !== 'string') return 0;
  const normalized = val.includes('T') ? val : `${val.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Restores and merges business transactions downloaded from Firebase Firestore into Local SQLite.
 *
 * SAFETY & INTEGRITY GUARANTEES:
 * 1. Automatically creates a full verified local SQLite backup before modifying any data.
 * 2. Executes inside a single atomic SQLite transaction with automatic rollback on any error.
 * 3. Respects sync_tombstones so deleted records are never resurrected.
 * 4. Deduplicates by permanent ID, client_request_id, and natural keys (invoice_number, bill_number, voucher_number, entry_number, item_code, account_code).
 * 5. Never overwrites newer local transactions with older cloud records (compares updated_at).
 * 6. Recalculates all account balances and updates sqlite_sequence after restoration.
 */
export function restoreBusinessTransactionsFromFirebase(params: {
  batches: Array<{
    batchId?: string;
    tableName: string;
    batchIndex?: number;
    recordCount?: number;
    recordsPayload: string;
    checksum?: string;
  }>;
  initiatedBy?: string;
}): {
  success: boolean;
  preRestoreBackup: BackupRecord;
  insertedCount: number;
  updatedCount: number;
  skippedDuplicateOrNewerLocalCount: number;
  skippedTombstonedCount: number;
  tablesProcessed: number;
  summaryAfterRestore: BusinessDataSummary;
  message: string;
} {
  if (!isDatabaseOpen()) {
    throw new Error('Local SQLite database is not open.');
  }

  const allowedTableSet = new Set<string>(BUSINESS_SYNC_TABLES);
  const rowsByTable = new Map<string, Array<Record<string, unknown>>>();

  // 1. Validate all incoming batches & checksums before touching SQLite
  for (const batch of params.batches || []) {
    if (!batch || typeof batch.tableName !== 'string') continue;
    if (!allowedTableSet.has(batch.tableName)) {
      continue; // Ignore any non-business table
    }
    const payloadStr = typeof batch.recordsPayload === 'string' ? batch.recordsPayload : '[]';
    if (batch.checksum) {
      const actualHash = crypto.createHash('sha256').update(payloadStr).digest('hex');
      if (actualHash !== batch.checksum) {
        throw new Error(
          `Data integrity checksum mismatch in batch for table "${batch.tableName}". Restoration aborted without modifying local data.`
        );
      }
    }

    let parsedRows: unknown;
    try {
      parsedRows = JSON.parse(payloadStr);
    } catch {
      throw new Error(
        `Invalid JSON payload in batch for table "${batch.tableName}". Restoration aborted without modifying local data.`
      );
    }

    if (!Array.isArray(parsedRows)) continue;
    const list = rowsByTable.get(batch.tableName) || [];
    for (const r of parsedRows) {
      if (r && typeof r === 'object') {
        list.push(r as Record<string, unknown>);
      }
    }
    rowsByTable.set(batch.tableName, list);
  }

  // 2. Create mandatory pre-restore local SQLite safety backup
  const preRestoreBackup = createDatabaseBackup({
    backupType: 'pre_restore_safety',
    createdBy: params.initiatedBy || 'Super Admin',
    notes: 'Automatic safety backup created prior to manual restoration from Firebase',
  });

  const db = getDatabase();
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedDuplicateOrNewerLocalCount = 0;
  let skippedTombstonedCount = 0;
  let tablesProcessed = 0;

  // 3. Execute atomic SQLite transaction across all business tables in dependency order
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    const runAtomicMerge = db.transaction(() => {
      // First apply incoming sync_tombstones so deletions are registered
      const incomingTombstones = rowsByTable.get('sync_tombstones') || [];
      if (incomingTombstones.length > 0 && tableExists(db, 'sync_tombstones')) {
        const upsertTombstone = db.prepare(`
          INSERT OR IGNORE INTO sync_tombstones (table_name, record_id, client_tx_id, deleted_at)
          VALUES (?, ?, ?, COALESCE(?, datetime('now')))
        `);
        for (const t of incomingTombstones) {
          const tbl = t.table_name || t.entity_type;
          const recId = t.record_id ?? t.entity_id;
          if (tbl && recId !== undefined && recId !== null) {
            upsertTombstone.run(
              String(tbl),
              String(recId),
              t.client_tx_id ? String(t.client_tx_id) : null,
              t.deleted_at ? String(t.deleted_at) : null
            );
          }
        }
      }

      // Build fast lookup of all tombstoned records
      const tombstoneSet = new Set<string>();
      if (tableExists(db, 'sync_tombstones')) {
        const localTombstones = db
          .prepare('SELECT table_name, record_id FROM sync_tombstones')
          .all() as Array<{ table_name: string; record_id: string }>;
        for (const t of localTombstones) {
          tombstoneSet.add(`${t.table_name}:${t.record_id}`);
        }
      }

      for (const tableName of BUSINESS_SYNC_TABLES) {
        if (tableName === 'sync_tombstones') continue;
        const incomingRows = rowsByTable.get(tableName);
        if (!incomingRows || incomingRows.length === 0) continue;
        if (!tableExists(db, tableName)) continue;

        tablesProcessed += 1;

        const colsInfo = db
          .prepare(`PRAGMA table_info("${tableName}")`)
          .all() as Array<{ name: string; pk: number }>;
        if (colsInfo.length === 0) continue;

        const colNames = colsInfo.map((c) => c.name);
        const colSet = new Set(colNames);
        const hasIdCol = colSet.has('id');
        const hasUpdatedAt = colSet.has('updated_at');
        const hasCreatedAt = colSet.has('created_at');
        const naturalCols = (TABLE_NATURAL_UNIQUE_COLUMNS[tableName] || []).filter((c) =>
          colSet.has(c)
        );

        for (const row of incomingRows) {
          if (hasIdCol && row.id !== undefined && row.id !== null) {
            if (tombstoneSet.has(`${tableName}:${String(row.id)}`)) {
              skippedTombstonedCount += 1;
              continue;
            }
          }

          // Locate existing local record by primary key `id` OR any natural unique key (`invoice_number`, `bill_number`, `account_code`, `item_code`, `client_request_id`, etc.)
          let existingLocal: Record<string, unknown> | undefined;

          if (hasIdCol && row.id !== undefined && row.id !== null) {
            existingLocal = db
              .prepare(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`)
              .get(row.id) as Record<string, unknown> | undefined;
          }

          if (!existingLocal && naturalCols.length > 0) {
            for (const natCol of naturalCols) {
              const natVal = row[natCol];
              if (natVal !== undefined && natVal !== null && String(natVal).trim() !== '') {
                existingLocal = db
                  .prepare(`SELECT * FROM "${tableName}" WHERE "${natCol}" = ? LIMIT 1`)
                  .get(natVal) as Record<string, unknown> | undefined;
                if (existingLocal) break;
              }
            }
          }

          const presentCols = colNames.filter((c) => row[c] !== undefined);
          if (presentCols.length === 0) continue;

          if (!existingLocal) {
            // Insert missing record with its exact original ID, invoice number, dates, and relationships
            const insertColsSql = presentCols.map((c) => `"${c}"`).join(', ');
            const placeholders = presentCols.map(() => '?').join(', ');
            const values = presentCols.map((c) => (row[c] === undefined ? null : row[c]));
            const info = db
              .prepare(`INSERT OR IGNORE INTO "${tableName}" (${insertColsSql}) VALUES (${placeholders})`)
              .run(...values);
            if (info.changes > 0) {
              insertedCount += 1;
            } else {
              skippedDuplicateOrNewerLocalCount += 1;
            }
          } else {
            // Record exists locally: NEVER overwrite newer local transactions with older cloud records
            const localTimeMs = hasUpdatedAt
              ? parseTimestampMs(existingLocal.updated_at || existingLocal.created_at)
              : hasCreatedAt
              ? parseTimestampMs(existingLocal.created_at)
              : 0;
            const cloudTimeMs = hasUpdatedAt
              ? parseTimestampMs(row.updated_at || row.created_at)
              : hasCreatedAt
              ? parseTimestampMs(row.created_at)
              : 0;

            if (cloudTimeMs > 0 && localTimeMs > 0 && cloudTimeMs > localTimeMs) {
              const mutableCols = presentCols.filter((c) => c !== 'id');
              if (mutableCols.length > 0 && hasIdCol && existingLocal.id !== undefined) {
                const setClause = mutableCols.map((c) => `"${c}" = ?`).join(', ');
                const values = mutableCols.map((c) => (row[c] === undefined ? null : row[c]));
                const info = db
                  .prepare(`UPDATE "${tableName}" SET ${setClause} WHERE id = ?`)
                  .run(...values, existingLocal.id);
                if (info.changes > 0) {
                  updatedCount += 1;
                } else {
                  skippedDuplicateOrNewerLocalCount += 1;
                }
              } else {
                skippedDuplicateOrNewerLocalCount += 1;
              }
            } else {
              // Local record is newer or identical -> preserve local record untouched
              skippedDuplicateOrNewerLocalCount += 1;
            }
          }
        }

        // Synchronize sqlite_sequence so future offline inserts never collide with restored IDs
        if (hasIdCol) {
          try {
            const maxRow = db
              .prepare(`SELECT COALESCE(MAX(id), 0) as maxId FROM "${tableName}"`)
              .get() as { maxId: number } | undefined;
            const maxId = Number(maxRow?.maxId || 0);
            if (maxId > 0) {
              const seqExists = db
                .prepare('SELECT 1 FROM sqlite_sequence WHERE name = ? LIMIT 1')
                .get(tableName);
              if (seqExists) {
                db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(
                  maxId,
                  tableName
                );
              } else {
                db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(
                  tableName,
                  maxId
                );
              }
            }
          } catch {
            // table may not use AUTOINCREMENT
          }
        }
      }

      // Recalculate all account current_balance values from opening balances + posted journal lines
      if (tableExists(db, 'accounts')) {
        const allAccountIds = db.prepare('SELECT id FROM accounts').all() as Array<{ id: number }>;
        for (const acc of allAccountIds) {
          recalculateAccountBalance(acc.id);
        }
      }
    });

    runAtomicMerge();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  checkpointDatabaseWal();
  const summaryAfterRestore = getLocalBusinessDataSummary();
  const message = `Restored ${insertedCount} new record(s) and updated ${updatedCount} record(s) across ${tablesProcessed} business table(s). Protected ${skippedDuplicateOrNewerLocalCount} existing/newer local record(s). Pre-restore local backup saved as ${preRestoreBackup.filename}.`;

  recordFirebaseSyncResult({
    operation: 'restore',
    status: 'Successful',
    recordCount: insertedCount + updatedCount,
    batchCount: params.batches.length,
    operator: params.initiatedBy || 'Super Admin',
    message,
  });

  return {
    success: true,
    preRestoreBackup,
    insertedCount,
    updatedCount,
    skippedDuplicateOrNewerLocalCount,
    skippedTombstonedCount,
    tablesProcessed,
    summaryAfterRestore,
    message,
  };
}
