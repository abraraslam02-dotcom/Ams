import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import {
  getDatabase,
  isDatabaseOpen,
  checkpointDatabaseWal,
} from '../db/connection.ts';
import {
  isOfflineOperatingMode,
  getPersistedOperatingModeState,
  recordLocalPendingMutation,
  updatePersistedOperatingModeState,
} from './operatingModeStore.ts';
import {
  ALLOWED_CONFLICT_TABLES,
  checkPostgresReachability,
  collectSqliteRecordCounts,
  computeSqliteLogicalFingerprint,
  getCloudSqlLocationLabel,
  getCloudSqlStatusSummary,
  isCloudSqlConfigured,
  runRelationalBidirectionalSync,
  type ConflictTableRule,
  type PostgresRecordCounts,
} from './postgresSyncService.ts';

export { ALLOWED_CONFLICT_TABLES, type ConflictTableRule };

export type CloudRecordCounts = PostgresRecordCounts;

export interface DeploymentSafetyReport {
  safeToDeploy: boolean;
  localIntegrityOk: boolean;
  message: string;
  externalDbConnected: boolean;
  externalDbLocation: string;
  existingRecordCounts: CloudRecordCounts;
  schemaValid: boolean;
  dataProtectionLockActive: boolean;
  warnings: string[];
  errors: string[];
  checkedAt: string;
}

export interface CloudPersistenceStatus {
  provider: string;
  enabled: boolean;
  connected: boolean;
  initialized: boolean;
  syncing: boolean;
  connectionBlocked: boolean;
  connectionError: string | null;
  databaseIdentity: string;
  externalLocation: string;
  lastVersionSeq: number;
  lastSha256: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingLocalChangesCount: number;
  quotaExhausted: boolean;
  quotaCooldownUntilMs: number;
  dataProtectionLockActive: boolean;
  existingRecordCounts: CloudRecordCounts;
  storageMode: string;
}

export interface CloudSyncResponseMeta {
  status: 'local_saved' | 'pending_sync' | 'synced' | 'sync_error';
  cloudConfirmed: boolean;
  offlineMode: boolean;
  quotaExhausted: boolean;
  pendingCloudSyncCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  versionSeq: number;
}

export interface CloudReachabilityResult {
  reachable: boolean;
  exists: boolean;
  versionSeq: number;
  counts: CloudRecordCounts | null;
  error: string | null;
  location: string;
  quotaExhausted?: boolean;
}

export interface ManualCloudSyncResult {
  status: 'Successful' | 'Failed' | 'Pending';
  reachable: boolean;
  mergedFromCloud: number;
  updatedFromCloud: number;
  conflictsDetected: number;
  unresolvedConflictsCount: number;
  cloudVersionSeq: number;
  message: string;
  error: string | null;
  quotaExhausted?: boolean;
}

let initialized = false;
let syncing = false;
let lastVersionSeq = 0;
let lastSha256: string | null = null;
let lastSyncAt: string | null = null;
let lastError: string | null = null;

function emptyRecordCounts(): CloudRecordCounts {
  return {
    users: 0,
    items: 0,
    accounts: 0,
    inventory: 0,
    sales: 0,
    sale_items: 0,
    sale_returns: 0,
    purchases: 0,
    purchase_items: 0,
    purchase_returns: 0,
    journal_entries: 0,
    accounting_vouchers: 0,
    cash_book_vouchers: 0,
    backup_history: 0,
  };
}

function getLiveRecordCountsSafe(): CloudRecordCounts {
  if (!isDatabaseOpen()) return emptyRecordCounts();
  try {
    return collectSqliteRecordCounts(getDatabase());
  } catch {
    return emptyRecordCounts();
  }
}

/**
 * Ensures the durable pending_cloud_sync_queue and cloud_sync_cursor tables exist in local SQLite.
 */
export function ensurePendingCloudSyncQueueTables(): void {
  try {
    if (!isDatabaseOpen()) return;
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_cloud_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_label TEXT NOT NULL,
        method TEXT NOT NULL,
        table_name TEXT,
        record_id TEXT,
        client_tx_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_cloud_sync_unsynced
        ON pending_cloud_sync_queue(synced, id);

      CREATE TABLE IF NOT EXISTS cloud_sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_version_seq INTEGER NOT NULL DEFAULT 0,
        last_synced_sha256 TEXT,
        last_synced_at TEXT,
        quota_exhausted INTEGER NOT NULL DEFAULT 0,
        quota_cooldown_until_ms INTEGER NOT NULL DEFAULT 0
      );
    `);

    const cursorRow = db
      .prepare('SELECT * FROM cloud_sync_cursor WHERE id = 1')
      .get() as
      | {
          last_synced_version_seq: number;
          last_synced_sha256: string | null;
          last_synced_at: string | null;
        }
      | undefined;

    if (cursorRow) {
      if (cursorRow.last_synced_version_seq > lastVersionSeq) {
        lastVersionSeq = cursorRow.last_synced_version_seq;
      }
      if (cursorRow.last_synced_sha256 && !lastSha256) {
        lastSha256 = cursorRow.last_synced_sha256;
      }
      if (cursorRow.last_synced_at && !lastSyncAt) {
        lastSyncAt = cursorRow.last_synced_at;
      }
    } else {
      db.prepare(
        `INSERT OR IGNORE INTO cloud_sync_cursor (
           id, last_synced_version_seq, last_synced_sha256, last_synced_at, quota_exhausted, quota_cooldown_until_ms
         ) VALUES (1, ?, ?, ?, 0, 0)`
      ).run(lastVersionSeq, lastSha256, lastSyncAt);
    }
  } catch {
    // ignore during early boot
  }
}

export function enqueueLocalMutationForCloudSync(
  method: string,
  routeLabel: string,
  meta?: { tableName?: string; recordId?: string; clientTxId?: string }
): number {
  try {
    ensurePendingCloudSyncQueueTables();
    const db = getDatabase();
    const cleanTxId = meta?.clientTxId ? String(meta.clientTxId).trim() : null;

    if (cleanTxId) {
      const existing = db
        .prepare('SELECT id FROM pending_cloud_sync_queue WHERE synced = 0 AND client_tx_id = ? LIMIT 1')
        .get(cleanTxId) as { id: number } | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO pending_cloud_sync_queue (route_label, method, table_name, record_id, client_tx_id, synced)
           VALUES (?, ?, ?, ?, ?, 0)`
        ).run(
          routeLabel,
          method,
          meta?.tableName || null,
          meta?.recordId || null,
          cleanTxId
        );
      }
    } else {
      db.prepare(
        `INSERT INTO pending_cloud_sync_queue (route_label, method, table_name, record_id, client_tx_id, synced)
         VALUES (?, ?, ?, ?, NULL, 0)`
      ).run(routeLabel, method, meta?.tableName || null, meta?.recordId || null);
    }

    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM pending_cloud_sync_queue WHERE synced = 0')
      .get() as { cnt: number } | undefined;
    const totalPending = Math.max(1, Number(countRow?.cnt || 1));

    updatePersistedOperatingModeState({
      pendingLocalChangesCount: totalPending,
      cloudSyncStatus: 'Pending',
    });
    return totalPending;
  } catch {
    const st = recordLocalPendingMutation();
    return st.pendingLocalChangesCount;
  }
}

export function getDurablePendingCloudSyncCount(): number {
  try {
    ensurePendingCloudSyncQueueTables();
    const db = getDatabase();
    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM pending_cloud_sync_queue WHERE synced = 0')
      .get() as { cnt: number } | undefined;
    const dbCount = Number(countRow?.cnt || 0);
    const persistedCount = getPersistedOperatingModeState().pendingLocalChangesCount;
    return Math.max(dbCount, persistedCount);
  } catch {
    return getPersistedOperatingModeState().pendingLocalChangesCount;
  }
}

export function getPendingCloudClientTxIds(): Set<string> {
  const out = new Set<string>();
  try {
    ensurePendingCloudSyncQueueTables();
    const db = getDatabase();
    const rows = db
      .prepare(
        "SELECT client_tx_id FROM pending_cloud_sync_queue WHERE synced = 0 AND client_tx_id IS NOT NULL AND TRIM(client_tx_id) != ''"
      )
      .all() as Array<{ client_tx_id: string }>;
    for (const r of rows) {
      if (r.client_tx_id) out.add(String(r.client_tx_id).trim());
    }
  } catch {
    // ignore
  }
  return out;
}

export function markDurablePendingCloudSyncCompleted(params: {
  versionSeq: number;
  sha256: string;
  syncedAt: string;
}): void {
  try {
    ensurePendingCloudSyncQueueTables();
    const db = getDatabase();
    db.prepare(
      `UPDATE pending_cloud_sync_queue
       SET synced = 1, synced_at = ?
       WHERE synced = 0`
    ).run(params.syncedAt);

    db.prepare(
      `INSERT INTO cloud_sync_cursor (
         id, last_synced_version_seq, last_synced_sha256, last_synced_at, quota_exhausted, quota_cooldown_until_ms
       ) VALUES (1, ?, ?, ?, 0, 0)
       ON CONFLICT(id) DO UPDATE SET
         last_synced_version_seq = excluded.last_synced_version_seq,
         last_synced_sha256 = excluded.last_synced_sha256,
         last_synced_at = excluded.last_synced_at,
         quota_exhausted = 0,
         quota_cooldown_until_ms = 0`
    ).run(params.versionSeq, params.sha256, params.syncedAt);

    lastVersionSeq = params.versionSeq;
    lastSha256 = params.sha256;
    lastSyncAt = params.syncedAt;
    lastError = null;
  } catch {
    // ignore
  }
}

export function getCloudSyncResponseMeta(clientTxId?: string | null): CloudSyncResponseMeta {
  const offlineMode = isOfflineOperatingMode();
  const pendingCount = getDurablePendingCloudSyncCount();
  const cleanTx = clientTxId ? String(clientTxId).trim() : '';
  const pendingIds = cleanTx ? getPendingCloudClientTxIds() : null;
  const txIsPending = Boolean(cleanTx && pendingIds?.has(cleanTx));

  if (offlineMode) {
    return {
      status: 'local_saved',
      cloudConfirmed: false,
      offlineMode: true,
      quotaExhausted: false,
      pendingCloudSyncCount: pendingCount,
      lastSyncAt,
      lastError: null,
      versionSeq: lastVersionSeq,
    };
  }

  if (lastError && pendingCount > 0) {
    return {
      status: 'sync_error',
      cloudConfirmed: false,
      offlineMode: false,
      quotaExhausted: false,
      pendingCloudSyncCount: pendingCount,
      lastSyncAt,
      lastError,
      versionSeq: lastVersionSeq,
    };
  }

  if (txIsPending || pendingCount > 0) {
    return {
      status: 'pending_sync',
      cloudConfirmed: false,
      offlineMode: false,
      quotaExhausted: false,
      pendingCloudSyncCount: pendingCount,
      lastSyncAt,
      lastError: null,
      versionSeq: lastVersionSeq,
    };
  }

  return {
    status: 'synced',
    cloudConfirmed: Boolean(lastSyncAt),
    offlineMode: false,
    quotaExhausted: false,
    pendingCloudSyncCount: 0,
    lastSyncAt,
    lastError: null,
    versionSeq: lastVersionSeq,
  };
}

export function recordCloudMutationCommittedInRoute(
  res: Response,
  method: string,
  routeLabel: string,
  meta?: { tableName?: string; recordId?: string; clientTxId?: string }
): CloudSyncResponseMeta {
  enqueueLocalMutationForCloudSync(method, routeLabel, meta);
  res.locals.__amsMutationQueued = true;
  return getCloudSyncResponseMeta(meta?.clientTxId);
}

export function getCloudPersistenceStatus(): CloudPersistenceStatus {
  const pgSummary = getCloudSqlStatusSummary();
  const pendingCount = getDurablePendingCloudSyncCount();
  const persisted = getPersistedOperatingModeState();
  const offlineMode = isOfflineOperatingMode();

  return {
    provider: 'Google Cloud SQL (PostgreSQL)',
    enabled: pgSummary.configured,
    connected: pgSummary.connected,
    initialized,
    syncing,
    connectionBlocked: false,
    connectionError: offlineMode ? null : lastError || pgSummary.lastError,
    databaseIdentity: `Local SQLite (${config.databasePath}) + Cloud SQL PostgreSQL (${pgSummary.database})`,
    externalLocation: pgSummary.location,
    lastVersionSeq: Math.max(lastVersionSeq, pgSummary.versionSeq),
    lastSha256,
    lastSyncAt: lastSyncAt || persisted.lastSuccessfulCloudSyncAt,
    lastError: lastError || pgSummary.lastError,
    pendingLocalChangesCount: pendingCount,
    quotaExhausted: false,
    quotaCooldownUntilMs: 0,
    dataProtectionLockActive: true,
    existingRecordCounts: getLiveRecordCountsSafe(),
    storageMode: offlineMode
      ? 'LOCAL_SQLITE_OFFLINE'
      : 'LOCAL_SQLITE_PRIMARY_WITH_CLOUDSQL_POSTGRESQL',
  };
}

/**
 * Initializes local SQLite sync queue tables without making any blocking network call at startup.
 */
export async function initCloudPersistence(): Promise<void> {
  ensurePendingCloudSyncQueueTables();
  if (isDatabaseOpen() && !lastSha256) {
    try {
      lastSha256 = computeSqliteLogicalFingerprint(getDatabase());
    } catch {
      // ignore
    }
  }
  initialized = true;
}

export async function ensureCloudPersistenceReady(): Promise<void> {
  if (!initialized) {
    await initCloudPersistence();
  }
}

export async function reconnectToCurrentDatabase(_force = true): Promise<{
  connected: boolean;
  blocked: boolean;
  databaseIdentity: string;
  recordCounts: CloudRecordCounts;
  error: string | null;
}> {
  await ensureCloudPersistenceReady();
  const counts = getLiveRecordCountsSafe();
  if (isOfflineOperatingMode()) {
    return {
      connected: isDatabaseOpen(),
      blocked: false,
      databaseIdentity: `Local SQLite (${config.databasePath}) — Offline Mode`,
      recordCounts: counts,
      error: null,
    };
  }
  const pgCheck = await checkPostgresReachability();
  lastError = pgCheck.error;
  return {
    connected: isDatabaseOpen(),
    blocked: false,
    databaseIdentity: pgCheck.location,
    recordCounts: counts,
    error: pgCheck.error,
  };
}

export async function runPreDeploymentSafetyChecks(): Promise<DeploymentSafetyReport> {
  await ensureCloudPersistenceReady();
  const counts = getLiveRecordCountsSafe();
  const warnings: string[] = [];
  const errors: string[] = [];

  const localOpen = isDatabaseOpen();
  if (!localOpen) {
    errors.push('Local SQLite database is not open.');
  }

  let pgReachable = false;
  if (isCloudSqlConfigured() && !isOfflineOperatingMode()) {
    const check = await checkPostgresReachability();
    pgReachable = check.reachable;
    if (!check.reachable && check.error) {
      warnings.push(check.error);
    }
  } else if (isOfflineOperatingMode()) {
    warnings.push('System is in Offline Mode (Local SQLite active; Cloud SQL PostgreSQL sync paused until manual Sync Now).');
  } else {
    warnings.push('Cloud SQL PostgreSQL credentials are not configured on this machine (Local SQLite offline mode active).');
  }

  return {
    safeToDeploy: localOpen && errors.length === 0,
    localIntegrityOk: localOpen,
    message: localOpen
      ? `Local SQLite verified (${counts.items} items, ${counts.sales} sales, ${counts.purchases} purchases). Cloud SQL PostgreSQL: ${pgReachable ? 'connected' : 'standby/offline-safe'}.`
      : 'Local SQLite database is not open.',
    externalDbConnected: pgReachable,
    externalDbLocation: getCloudSqlLocationLabel(),
    existingRecordCounts: counts,
    schemaValid: localOpen,
    dataProtectionLockActive: true,
    warnings,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

export async function checkCloudDatabaseReachability(): Promise<CloudReachabilityResult> {
  const res = await checkPostgresReachability();
  lastError = res.error;
  return {
    reachable: res.reachable,
    exists: res.exists,
    versionSeq: res.versionSeq,
    counts: res.counts,
    error: res.error,
    location: res.location,
    quotaExhausted: false,
  };
}

/**
 * Manual-control architecture: never auto-polls in the background.
 */
export async function pullFromCloudPersistenceIfNewer(_reason = 'manual'): Promise<boolean> {
  return false;
}

export function scheduleCloudUpload(_reason = 'mutation'): void {
  // Manual Sync Now architecture: mutations are durably queued in pending_cloud_sync_queue.
}

export function startCloudPersistenceBackgroundLoop(): void {
  // Intentionally disabled: strict Manual Sync Now architecture (no background cloud polling).
}

export function stopCloudPersistenceBackgroundLoop(): void {
  // No background timer to clear.
}

export async function syncDatabaseToCloudSQL(reason = 'manual_sync'): Promise<boolean> {
  if (syncing) return false;
  if (!isCloudSqlConfigured()) {
    lastError = 'Cloud SQL PostgreSQL is not configured on this machine.';
    return false;
  }

  syncing = true;
  try {
    checkpointDatabaseWal();
    const summary = await runRelationalBidirectionalSync({
      reason,
      actor: reason,
    });
    markDurablePendingCloudSyncCompleted({
      versionSeq: summary.versionSeq,
      sha256: summary.sha256,
      syncedAt: summary.syncedAt,
    });
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Successful',
      lastSuccessfulCloudSyncAt: summary.syncedAt,
      lastCloudSyncError: null,
      pendingLocalChangesCount: 0,
    });
    return true;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Failed',
      lastCloudSyncError: lastError,
    });
    return false;
  } finally {
    syncing = false;
  }
}

export async function resetCloudPersistenceState(reason = 'master_reset'): Promise<void> {
  if (!isOfflineOperatingMode() && isCloudSqlConfigured()) {
    await syncDatabaseToCloudSQL(reason).catch(() => {});
  }
}

/**
 * Manual Sync Now handler called by Super Admin Operating Mode & Sync endpoints.
 * Performs conflict-aware bidirectional sync between Local SQLite and Cloud SQL PostgreSQL.
 */
export async function runConflictAwareBidirectionalCloudSync(options: {
  lastSyncedAt: string | null;
  switchedAt: string | null;
  hasLocalPendingChanges: boolean;
  initiatedBy: string;
}): Promise<ManualCloudSyncResult> {
  await ensureCloudPersistenceReady();

  if (syncing) {
    return {
      status: 'Pending',
      reachable: false,
      mergedFromCloud: 0,
      updatedFromCloud: 0,
      conflictsDetected: 0,
      unresolvedConflictsCount: getUnresolvedConflictsCountLocal(),
      cloudVersionSeq: lastVersionSeq,
      message: 'A Cloud SQL synchronization is already in progress.',
      error: null,
      quotaExhausted: false,
    };
  }

  const reachability = await checkCloudDatabaseReachability();
  if (!reachability.reachable) {
    const errMsg =
      reachability.error ||
      'Unable to connect to Google Cloud SQL PostgreSQL. Your local SQLite data is completely safe and queued for the next manual Sync Now.';
    lastError = errMsg;
    return {
      status: 'Failed',
      reachable: false,
      mergedFromCloud: 0,
      updatedFromCloud: 0,
      conflictsDetected: 0,
      unresolvedConflictsCount: getUnresolvedConflictsCountLocal(),
      cloudVersionSeq: lastVersionSeq,
      message: errMsg,
      error: errMsg,
      quotaExhausted: false,
    };
  }

  syncing = true;
  try {
    checkpointDatabaseWal();
    const res = await runRelationalBidirectionalSync({
      reason: `manual_sync_by_${options.initiatedBy || 'Super Admin'}`,
      actor: options.initiatedBy || 'Super Admin',
    });

    markDurablePendingCloudSyncCompleted({
      versionSeq: res.versionSeq,
      sha256: res.sha256,
      syncedAt: res.syncedAt,
    });

    const unresolvedCount = getUnresolvedConflictsCountLocal();
    const parts: string[] = [
      `Synced ${res.pushedTables} tables (${res.pushedRows} rows) with Cloud SQL PostgreSQL (Version #${res.versionSeq}).`,
    ];
    if (res.insertedFromCloud > 0) {
      parts.push(`Downloaded ${res.insertedFromCloud} new cloud record(s).`);
    }
    if (res.deduplicatedTxCount > 0) {
      parts.push(`Prevented ${res.deduplicatedTxCount} duplicate transaction(s).`);
    }
    if (res.conflictsDetected > 0) {
      parts.push(
        `Detected ${res.conflictsDetected} conflict(s) logged for Super Admin review without overwriting local edits.`
      );
    }

    return {
      status: 'Successful',
      reachable: true,
      mergedFromCloud: res.insertedFromCloud,
      updatedFromCloud: res.updatedFromCloud,
      conflictsDetected: res.conflictsDetected,
      unresolvedConflictsCount: unresolvedCount,
      cloudVersionSeq: res.versionSeq,
      message: parts.join(' '),
      error: null,
      quotaExhausted: false,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    lastError = errMsg;
    return {
      status: 'Failed',
      reachable: false,
      mergedFromCloud: 0,
      updatedFromCloud: 0,
      conflictsDetected: 0,
      unresolvedConflictsCount: getUnresolvedConflictsCountLocal(),
      cloudVersionSeq: lastVersionSeq,
      message: errMsg,
      error: errMsg,
      quotaExhausted: false,
    };
  } finally {
    syncing = false;
  }
}

function getUnresolvedConflictsCountLocal(): number {
  try {
    if (!isDatabaseOpen()) return 0;
    const db = getDatabase();
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM sync_conflicts WHERE status = 'unresolved'")
      .get() as { cnt: number } | undefined;
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

/**
 * Express middleware that records every committed API write mutation into the durable
 * SQLite pending_cloud_sync_queue so offline & online changes are reliably tracked
 * for the next manual Sync Now without blocking or slowing down local SQLite operations.
 */
export async function cloudPersistenceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const method = req.method.toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const routeLabel = req.originalUrl || req.url || '';

  const skipQueue =
    routeLabel.startsWith('/api/auth/login') ||
    routeLabel.startsWith('/api/auth/logout') ||
    routeLabel.startsWith('/api/system/backups') ||
    routeLabel.startsWith('/api/system/operating-mode') ||
    routeLabel.startsWith('/api/system/cloud-sync-now') ||
    routeLabel.startsWith('/api/system/reconnect-db');

  if (isMutation && !skipQueue) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && !res.locals.__amsMutationQueued) {
        const bodyTxId =
          req.body && typeof req.body === 'object'
            ? String(req.body.client_request_id || req.body.client_tx_id || '').trim() || undefined
            : undefined;
        enqueueLocalMutationForCloudSync(method, routeLabel, { clientTxId: bodyTxId });
      }
    });
  }

  next();
}

/**
 * Non-destructively merges client IndexedDB records that are missing from local SQLite
 * (INSERT OR IGNORE, strictly respecting sync_tombstones and immutable client_request_id / natural keys).
 */
export function hydrateSqliteFromCloudRecords(
  rawItems: Array<Record<string, unknown>> = [],
  rawInvoices: Array<Record<string, unknown>> = [],
  extra?: {
    accounts?: Array<Record<string, unknown>>;
    inventory?: Array<Record<string, unknown>>;
    purchases?: Array<Record<string, unknown>>;
    cashBookVouchers?: Array<Record<string, unknown>>;
  }
): {
  restoredItems: number;
  restoredInvoices: number;
  restoredAccounts: number;
  restoredInventory: number;
  restoredPurchases: number;
  restoredVouchers: number;
} {
  const result = {
    restoredItems: 0,
    restoredInvoices: 0,
    restoredAccounts: 0,
    restoredInventory: 0,
    restoredPurchases: 0,
    restoredVouchers: 0,
  };

  if (!isDatabaseOpen()) return result;
  const db = getDatabase();

  const isTombstoned = (entity: string, idVal: unknown): boolean => {
    try {
      if (idVal === undefined || idVal === null) return false;
      const hit = db
        .prepare('SELECT 1 FROM sync_tombstones WHERE entity_type = ? AND entity_id = ? LIMIT 1')
        .get(entity, String(idVal));
      return Boolean(hit);
    } catch {
      return false;
    }
  };

  const insertMissingRows = (
    table: string,
    entityType: string,
    rows: Array<Record<string, unknown>>,
    uniqueCol?: string
  ): number => {
    if (!rows || rows.length === 0) return 0;
    const colsInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    if (colsInfo.length === 0) return 0;
    const colNames = colsInfo.map((c) => c.name);
    let inserted = 0;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (isTombstoned(entityType, row.id)) continue;

      if (uniqueCol && row[uniqueCol]) {
        const exists = db
          .prepare(`SELECT 1 FROM "${table}" WHERE "${uniqueCol}" = ? LIMIT 1`)
          .get(String(row[uniqueCol]));
        if (exists) continue;
      }
      if (row.client_request_id && colNames.includes('client_request_id')) {
        const existsTx = db
          .prepare(`SELECT 1 FROM "${table}" WHERE "client_request_id" = ? LIMIT 1`)
          .get(String(row.client_request_id));
        if (existsTx) continue;
      }

      const presentCols = colNames.filter((c) => row[c] !== undefined);
      if (presentCols.length === 0) continue;
      const placeholders = presentCols.map(() => '?').join(', ');
      const values = presentCols.map((c) => (row[c] === undefined ? null : row[c]));
      try {
        const info = db
          .prepare(
            `INSERT OR IGNORE INTO "${table}" (${presentCols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
          )
          .run(...values);
        if (info.changes > 0) inserted += 1;
      } catch {
        // skip invalid or conflicting rows without aborting hydration
      }
    }
    return inserted;
  };

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    result.restoredItems = insertMissingRows('items', 'items', rawItems, 'item_code');
    result.restoredAccounts = insertMissingRows('accounts', 'accounts', extra?.accounts || [], 'account_code');
    result.restoredInventory = insertMissingRows('inventory', 'inventory', extra?.inventory || []);
    result.restoredInvoices = insertMissingRows('sales', 'sales', rawInvoices, 'invoice_number');
    result.restoredPurchases = insertMissingRows('purchases', 'purchases', extra?.purchases || [], 'bill_number');
    result.restoredVouchers = insertMissingRows(
      'cash_book_vouchers',
      'cash_book_vouchers',
      extra?.cashBookVouchers || [],
      'voucher_number'
    );
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return result;
}
