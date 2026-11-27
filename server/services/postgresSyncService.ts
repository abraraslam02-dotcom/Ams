import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { PoolClient } from 'pg';
import { pool, isPostgresEnvConfigured } from '../../src/db/index.ts';
import * as pgSchema from '../../src/db/schema.ts';
import { getDatabase, isDatabaseOpen } from '../db/connection.ts';
import { parseUtcTimestamp } from '../utils/pakistanTime.ts';

/**
 * Authoritative Relational Sync Engine: Local SQLite <-> Google Cloud SQL (PostgreSQL).
 *
 * Design Guarantees:
 * - Zero Firebase / Firestore dependencies.
 * - Local SQLite (D:\AbrarMedicalStore\Database\ams_medical.db on Windows) is always primary and works 100% offline.
 * - Cloud SQL PostgreSQL is the single central multi-device database.
 * - Manual Sync Now pushes pending local mutations and pulls remote changes relationally.
 * - Duplicate invoices, stock movements, and vouchers are prevented via immutable client_tx_id / client_request_id
 *   tracking (ams_pg_sync_tx_log) and natural key checks.
 * - Conflicts are detected via field-level comparison and logged into sync_conflicts; newer local edits are never
 *   silently overwritten and existing records are never silently deleted.
 */

export interface PostgresRecordCounts {
  users: number;
  items: number;
  accounts: number;
  inventory: number;
  sales: number;
  sale_items: number;
  sale_returns: number;
  purchases: number;
  purchase_items: number;
  purchase_returns: number;
  journal_entries: number;
  accounting_vouchers: number;
  cash_book_vouchers: number;
  backup_history: number;
}

export interface ConflictTableRule {
  table: string;
  labelCol: string;
  naturalKeyCol: string | null;
  clientTxCol?: string | null;
  compareCols: string[];
}

export const ALLOWED_CONFLICT_TABLES: readonly ConflictTableRule[] = [
  {
    table: 'items',
    labelCol: 'item_name',
    naturalKeyCol: 'item_code',
    compareCols: [
      'item_name',
      'generic_name',
      'company_name',
      'category',
      'packing',
      'purchase_price',
      'trade_price',
      'wholesale_price',
      'retail_price',
      'discount_percent',
      'tax_percent',
      'status',
    ],
  },
  {
    table: 'accounts',
    labelCol: 'account_name',
    naturalKeyCol: 'account_code',
    compareCols: [
      'account_name',
      'account_group',
      'phone',
      'address',
      'city',
      'opening_balance',
      'credit_limit',
      'status',
    ],
  },
  {
    table: 'sales',
    labelCol: 'invoice_number',
    naturalKeyCol: 'invoice_number',
    clientTxCol: 'client_request_id',
    compareCols: [
      'invoice_date',
      'customer_name',
      'payment_mode',
      'gross_total',
      'discount_amount',
      'tax_amount',
      'net_total',
      'paid_amount',
      'balance_amount',
      'status',
      'remarks',
    ],
  },
  {
    table: 'purchases',
    labelCol: 'bill_number',
    naturalKeyCol: 'bill_number',
    clientTxCol: 'client_request_id',
    compareCols: [
      'bill_date',
      'supplier_account_id',
      'payment_mode',
      'gross_total',
      'discount_amount',
      'tax_amount',
      'net_total',
      'paid_amount',
      'remaining_balance',
      'status',
      'remarks',
    ],
  },
  {
    table: 'inventory',
    labelCol: 'batch_number',
    naturalKeyCol: null,
    compareCols: [
      'batch_number',
      'expiry_date',
      'cost_price',
      'trade_price',
      'retail_price',
      'current_pack_qty',
      'current_loose_qty',
      'total_stock_units',
      'status',
    ],
  },
  {
    table: 'cash_book_vouchers',
    labelCol: 'voucher_number',
    naturalKeyCol: 'voucher_number',
    compareCols: [
      'voucher_date',
      'transaction_type',
      'category',
      'head_account_name',
      'receipt_amount',
      'payment_amount',
      'net_amount',
      'narration',
      'status',
    ],
  },
  {
    table: 'sale_returns',
    labelCol: 'return_number',
    naturalKeyCol: 'return_number',
    compareCols: ['return_date', 'net_total', 'status', 'remarks'],
  },
  {
    table: 'purchase_returns',
    labelCol: 'return_number',
    naturalKeyCol: 'return_number',
    compareCols: ['return_date', 'net_total', 'status', 'remarks'],
  },
];

// Tables excluded from cross-device overwrite (device-local runtime/sync/backup bookkeeping)
const LOCAL_ONLY_TABLES = new Set<string>([
  'pending_cloud_sync_queue',
  'cloud_sync_cursor',
  'sync_conflicts',
  'sync_tombstones',
  'backup_history',
  'sqlite_sequence',
]);

export interface PostgresTableSchemaPlan {
  tableName: string;
  columns: Array<{ name: string; pgType: string; isPk: boolean }>;
  primaryKeys: string[];
  createSql: string;
  addColumnSqls: string[];
  uniqueIndexSqls: string[];
}

export interface PostgresReachabilityResult {
  configured: boolean;
  reachable: boolean;
  exists: boolean;
  versionSeq: number;
  counts: PostgresRecordCounts | null;
  serverVersion: string | null;
  host: string;
  database: string;
  location: string;
  error: string | null;
}

export interface RelationalMergeSummary {
  insertedFromCloud: number;
  updatedFromCloud: number;
  keptLocalNewer: number;
  conflictsDetected: number;
  pushedTables: number;
  pushedRows: number;
  deduplicatedTxCount: number;
  versionSeq: number;
  syncedAt: string;
  sha256: string;
  conflictDetails: Array<{
    table: string;
    recordId: string;
    label: string;
    changedFields: string[];
  }>;
}

let pgSchemaInitialized = false;
let pgAvailable = false;
let lastPgError: string | null = null;
let lastPgVersionSeq = 0;

export function isCloudSqlConfigured(): boolean {
  return isPostgresEnvConfigured();
}

export function getCloudSqlLocationLabel(): string {
  const host = String(process.env.SQL_HOST || 'not-configured');
  const dbName = String(process.env.SQL_DB_NAME || 'cloud_sql_development_database');
  return `postgresql://${host}/${dbName}`;
}

export function getCloudSqlStatusSummary(): {
  configured: boolean;
  connected: boolean;
  host: string;
  database: string;
  location: string;
  versionSeq: number;
  lastError: string | null;
} {
  return {
    configured: isCloudSqlConfigured(),
    connected: pgAvailable,
    host: String(process.env.SQL_HOST || ''),
    database: String(process.env.SQL_DB_NAME || 'cloud_sql_development_database'),
    location: getCloudSqlLocationLabel(),
    versionSeq: lastPgVersionSeq,
    lastError: lastPgError,
  };
}

function mapSqliteTypeToPostgres(rawType: string | null | undefined): string {
  const up = String(rawType || 'TEXT').toUpperCase();
  if (up.includes('INT')) return 'BIGINT';
  if (up.includes('REAL') || up.includes('FLOA') || up.includes('DOUB') || up.includes('NUM') || up.includes('DEC')) {
    return 'DOUBLE PRECISION';
  }
  if (up.includes('BLOB')) return 'BYTEA';
  if (up.includes('BOOL')) return 'BOOLEAN';
  return 'TEXT';
}

function normalizeCompareValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '0';
    return String(Math.round(val * 10000) / 10000);
  }
  return String(val).trim();
}

function parseComparableTimestamp(raw: unknown): number {
  if (!raw) return 0;
  const parsed = parseUtcTimestamp(raw as string | Date | number);
  return parsed ? parsed.getTime() : 0;
}

function sanitizeIdentifier(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe SQL identifier blocked: ${name}`);
  }
  return `"${name}"`;
}

export function collectSqliteRecordCounts(sqliteDb: Database.Database): PostgresRecordCounts {
  const countOf = (table: string): number => {
    try {
      const row = sqliteDb
        .prepare(`SELECT COUNT(*) as cnt FROM ${sanitizeIdentifier(table)}`)
        .get() as { cnt: number } | undefined;
      return Number(row?.cnt || 0);
    } catch {
      return 0;
    }
  };
  return {
    users: countOf('users'),
    items: countOf('items'),
    accounts: countOf('accounts'),
    inventory: countOf('inventory'),
    sales: countOf('sales'),
    sale_items: countOf('sale_items'),
    sale_returns: countOf('sale_returns'),
    purchases: countOf('purchases'),
    purchase_items: countOf('purchase_items'),
    purchase_returns: countOf('purchase_returns'),
    journal_entries: countOf('journal_entries'),
    accounting_vouchers: countOf('accounting_vouchers'),
    cash_book_vouchers: countOf('cash_book_vouchers'),
    backup_history: countOf('backup_history'),
  };
}

export function computeSqliteLogicalFingerprint(sqliteDb: Database.Database): string {
  const counts = collectSqliteRecordCounts(sqliteDb);
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(counts));
  const keyTables = ['sales', 'purchases', 'items', 'accounts', 'inventory', 'cash_book_vouchers'];
  for (const tbl of keyTables) {
    try {
      const row = sqliteDb
        .prepare(`SELECT MAX(id) as max_id, COUNT(*) as cnt FROM ${sanitizeIdentifier(tbl)}`)
        .get() as { max_id: number | null; cnt: number } | undefined;
      hash.update(`${tbl}:${row?.cnt || 0}:${row?.max_id || 0}|`);
    } catch {
      // ignore
    }
  }
  return hash.digest('hex');
}

/**
 * Generates an idempotent PostgreSQL DDL schema plan for all local SQLite tables,
 * including primary keys, type mapping, and duplicate-prevention unique partial indexes.
 */
export function buildPostgresSchemaPlanFromSqlite(
  sqliteDb: Database.Database
): PostgresTableSchemaPlan[] {
  const tables = sqliteDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
    )
    .all() as Array<{ name: string }>;

  const plans: PostgresTableSchemaPlan[] = [];

  for (const t of tables) {
    if (LOCAL_ONLY_TABLES.has(t.name)) continue;
    const cols = sqliteDb.prepare(`PRAGMA table_info(${sanitizeIdentifier(t.name)})`).all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    if (cols.length === 0) continue;

    const pks = cols
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);

    const mappedCols = cols.map((c) => ({
      name: c.name,
      pgType: mapSqliteTypeToPostgres(c.type),
      isPk: c.pk > 0,
    }));

    const colDefs = mappedCols.map((c) => `${sanitizeIdentifier(c.name)} ${c.pgType}`);
    if (pks.length > 0) {
      colDefs.push(`PRIMARY KEY (${pks.map(sanitizeIdentifier).join(', ')})`);
    }

    const createSql = `CREATE TABLE IF NOT EXISTS ${sanitizeIdentifier(t.name)} (${colDefs.join(', ')})`;
    const addColumnSqls = mappedCols.map(
      (c) =>
        `ALTER TABLE ${sanitizeIdentifier(t.name)} ADD COLUMN IF NOT EXISTS ${sanitizeIdentifier(c.name)} ${c.pgType}`
    );

    const uniqueIndexSqls: string[] = [];
    const colNameSet = new Set(cols.map((c) => c.name));
    if (colNameSet.has('client_request_id')) {
      uniqueIndexSqls.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${sanitizeIdentifier(`uq_pg_${t.name}_client_req_id`)} ON ${sanitizeIdentifier(t.name)} ("client_request_id") WHERE "client_request_id" IS NOT NULL AND TRIM("client_request_id") <> ''`
      );
    }
    if (t.name === 'sales' && colNameSet.has('invoice_number')) {
      uniqueIndexSqls.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pg_sales_invoice_number" ON "sales" ("invoice_number") WHERE "invoice_number" IS NOT NULL AND TRIM("invoice_number") <> ''`
      );
    }
    if (t.name === 'purchases' && colNameSet.has('bill_number')) {
      uniqueIndexSqls.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pg_purchases_bill_number" ON "purchases" ("bill_number") WHERE "bill_number" IS NOT NULL AND TRIM("bill_number") <> ''`
      );
    }
    if (t.name === 'cash_book_vouchers' && colNameSet.has('voucher_number')) {
      uniqueIndexSqls.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pg_cashbook_voucher_number" ON "cash_book_vouchers" ("voucher_number") WHERE "voucher_number" IS NOT NULL AND TRIM("voucher_number") <> ''`
      );
    }

    plans.push({
      tableName: t.name,
      columns: mappedCols,
      primaryKeys: pks,
      createSql,
      addColumnSqls,
      uniqueIndexSqls,
    });
  }

  return plans;
}

/**
 * Ensures the central PostgreSQL sync metadata, transaction deduplication log,
 * conflict archive, and all 106 relational business tables exist in Cloud SQL PostgreSQL.
 */
export async function ensurePostgresSchemaFromSqlite(
  sqliteDb: Database.Database,
  existingClient?: PoolClient
): Promise<{ tablesEnsured: number }> {
  if (!isCloudSqlConfigured()) {
    pgAvailable = false;
    throw new Error('Cloud SQL PostgreSQL environment variables (SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME) are not configured.');
  }

  const client = existingClient || (await pool.connect());
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ams_cloud_sync_meta (
        meta_key TEXT PRIMARY KEY,
        version_seq INTEGER NOT NULL DEFAULT 1,
        sha256 TEXT,
        updated_at TEXT,
        updated_by TEXT,
        summary_json TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ams_pg_sync_tx_log (
        client_tx_id TEXT PRIMARY KEY,
        table_name TEXT,
        record_id TEXT,
        route_label TEXT,
        device_id TEXT,
        synced_at TEXT NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ams_pg_conflicts (
        conflict_key TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_label TEXT,
        local_updated_at TEXT,
        cloud_updated_at TEXT,
        local_snapshot_json TEXT NOT NULL,
        cloud_snapshot_json TEXT NOT NULL,
        changed_fields_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unresolved',
        detected_at TEXT NOT NULL
      );
    `);

    const plans = buildPostgresSchemaPlanFromSqlite(sqliteDb);
    for (const plan of plans) {
      await client.query(plan.createSql);
      for (const alterSql of plan.addColumnSqls) {
        await client.query(alterSql);
      }
      for (const idxSql of plan.uniqueIndexSqls) {
        await client.query(idxSql).catch(() => {
          // Existing legacy data may contain duplicates on optional text columns; do not abort migration
        });
      }
    }

    pgSchemaInitialized = true;
    pgAvailable = true;
    lastPgError = null;
    void pgSchema.amsCloudSyncMeta;
    return { tablesEnsured: plans.length };
  } catch (error: unknown) {
    pgAvailable = false;
    const msg = error instanceof Error ? error.message : String(error);
    lastPgError = msg;
    throw new Error(`Cloud SQL PostgreSQL schema migration failed: ${msg}`, { cause: error });
  } finally {
    if (!existingClient) {
      client.release();
    }
  }
}

/**
 * Tests live connectivity to Cloud SQL PostgreSQL without infinite loops or startup blocking.
 */
export async function checkPostgresReachability(): Promise<PostgresReachabilityResult> {
  const host = String(process.env.SQL_HOST || '');
  const database = String(process.env.SQL_DB_NAME || 'cloud_sql_development_database');
  const location = getCloudSqlLocationLabel();

  if (!isCloudSqlConfigured()) {
    pgAvailable = false;
    lastPgError = 'Cloud SQL PostgreSQL environment variables are not configured.';
    return {
      configured: false,
      reachable: false,
      exists: false,
      versionSeq: lastPgVersionSeq,
      counts: null,
      serverVersion: null,
      host,
      database,
      location,
      error: lastPgError,
    };
  }

  try {
    const verRes = await pool.query('SELECT version() AS server_version');
    const serverVersion = String(verRes.rows?.[0]?.server_version || 'PostgreSQL');

    let exists = false;
    let versionSeq = 0;
    let counts: PostgresRecordCounts | null = null;

    const metaTableCheck = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ams_cloud_sync_meta'
       ) AS has_meta`
    );
    if (metaTableCheck.rows?.[0]?.has_meta) {
      const metaRes = await pool.query(
        `SELECT version_seq, summary_json FROM ams_cloud_sync_meta WHERE meta_key = 'primary_store' LIMIT 1`
      );
      if (metaRes.rows && metaRes.rows.length > 0) {
        exists = true;
        versionSeq = Number(metaRes.rows[0].version_seq || 0);
        lastPgVersionSeq = versionSeq;
        if (metaRes.rows[0].summary_json) {
          try {
            counts = JSON.parse(String(metaRes.rows[0].summary_json)) as PostgresRecordCounts;
          } catch {
            counts = null;
          }
        }
      }
    }

    pgAvailable = true;
    lastPgError = null;
    return {
      configured: true,
      reachable: true,
      exists,
      versionSeq,
      counts,
      serverVersion,
      host,
      database,
      location,
      error: null,
    };
  } catch (error: unknown) {
    pgAvailable = false;
    const msg = error instanceof Error ? error.message : String(error);
    lastPgError = msg;
    return {
      configured: true,
      reachable: false,
      exists: false,
      versionSeq: lastPgVersionSeq,
      counts: null,
      serverVersion: null,
      host,
      database,
      location,
      error: `Cloud SQL PostgreSQL unreachable: ${msg}`,
    };
  }
}

export interface ConflictMergeResult {
  insertedFromCloud: number;
  updatedFromCloud: number;
  keptLocalNewer: number;
  conflictsDetected: number;
  conflictDetails: Array<{
    table: string;
    recordId: string;
    label: string;
    changedFields: string[];
  }>;
}

/**
 * Safely merges a remote table snapshot into local SQLite without ever silently overwriting
 * newer local records or deleting existing records. Real conflicts are persisted to sync_conflicts.
 */
export function mergeRemoteTableRowsIntoSqlite(
  sqliteDb: Database.Database,
  tableRule: ConflictTableRule,
  remoteRows: Array<Record<string, unknown>>
): ConflictMergeResult {
  const result: ConflictMergeResult = {
    insertedFromCloud: 0,
    updatedFromCloud: 0,
    keptLocalNewer: 0,
    conflictsDetected: 0,
    conflictDetails: [],
  };

  if (!remoteRows || remoteRows.length === 0) return result;

  const localColsInfo = sqliteDb
    .prepare(`PRAGMA table_info(${sanitizeIdentifier(tableRule.table)})`)
    .all() as Array<{ name: string; pk: number }>;
  if (localColsInfo.length === 0) return result;

  const localColNames = localColsInfo.map((c) => c.name);
  const localColSet = new Set(localColNames);
  const pkCol = localColsInfo.find((c) => c.pk === 1)?.name || 'id';

  // Ensure sync_conflicts table exists in local SQLite
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_label TEXT,
      local_updated_at TEXT,
      cloud_updated_at TEXT,
      local_snapshot_json TEXT NOT NULL,
      cloud_snapshot_json TEXT NOT NULL,
      changed_fields_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unresolved',
      resolution_choice TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const localRows = sqliteDb
    .prepare(`SELECT * FROM ${sanitizeIdentifier(tableRule.table)}`)
    .all() as Array<Record<string, unknown>>;

  const localById = new Map<string, Record<string, unknown>>();
  const localByNaturalKey = new Map<string, Record<string, unknown>>();
  const localByClientTx = new Map<string, Record<string, unknown>>();

  for (const row of localRows) {
    if (row[pkCol] !== undefined && row[pkCol] !== null) {
      localById.set(String(row[pkCol]), row);
    }
    if (tableRule.naturalKeyCol && row[tableRule.naturalKeyCol]) {
      localByNaturalKey.set(String(row[tableRule.naturalKeyCol]).trim().toLowerCase(), row);
    }
    if (tableRule.clientTxCol && row[tableRule.clientTxCol]) {
      localByClientTx.set(String(row[tableRule.clientTxCol]).trim(), row);
    }
  }

  for (const remoteRow of remoteRows) {
    const remotePk = remoteRow[pkCol];
    if (remotePk === undefined || remotePk === null) continue;
    const pkStr = String(remotePk);

    // Duplicate prevention: match by immutable client_request_id first, then natural key, then PK
    const remoteClientTx =
      tableRule.clientTxCol && remoteRow[tableRule.clientTxCol]
        ? String(remoteRow[tableRule.clientTxCol]).trim()
        : '';
    const remoteNatKey =
      tableRule.naturalKeyCol && remoteRow[tableRule.naturalKeyCol]
        ? String(remoteRow[tableRule.naturalKeyCol]).trim().toLowerCase()
        : '';

    const localMatch =
      (remoteClientTx ? localByClientTx.get(remoteClientTx) : undefined) ||
      (remoteNatKey ? localByNaturalKey.get(remoteNatKey) : undefined) ||
      localById.get(pkStr);

    if (!localMatch) {
      // Brand-new cloud record -> insert safely into local SQLite
      const insertCols = localColNames.filter((col) => remoteRow[col] !== undefined);
      const placeholders = insertCols.map(() => '?').join(', ');
      const values = insertCols.map((col) => (remoteRow[col] === undefined ? null : remoteRow[col]));
      sqliteDb
        .prepare(
          `INSERT OR IGNORE INTO ${sanitizeIdentifier(tableRule.table)} (${insertCols
            .map(sanitizeIdentifier)
            .join(', ')}) VALUES (${placeholders})`
        )
        .run(...values);
      result.insertedFromCloud += 1;
      continue;
    }

    // Compare tracked business columns to see if records actually differ
    const changedFields: string[] = [];
    for (const col of tableRule.compareCols) {
      if (!localColSet.has(col)) continue;
      if (normalizeCompareValue(localMatch[col]) !== normalizeCompareValue(remoteRow[col])) {
        changedFields.push(col);
      }
    }

    if (changedFields.length === 0) {
      continue;
    }

    const localTs = parseComparableTimestamp(localMatch.updated_at || localMatch.created_at);
    const cloudTs = parseComparableTimestamp(remoteRow.updated_at || remoteRow.created_at);

    // Strict safety: never overwrite newer local data with older cloud data
    if (localTs > cloudTs && cloudTs > 0) {
      result.keptLocalNewer += 1;
    }

    // Record conflict for explicit Super Admin resolution instead of silently overwriting
    const recordLabel = String(
      localMatch[tableRule.labelCol] || remoteRow[tableRule.labelCol] || `${tableRule.table}#${pkStr}`
    );

    const existingConflict = sqliteDb
      .prepare(
        `SELECT id FROM sync_conflicts
         WHERE table_name = ? AND record_id = ? AND status = 'unresolved'
         LIMIT 1`
      )
      .get(tableRule.table, String(localMatch[pkCol] ?? pkStr)) as { id: number } | undefined;

    if (existingConflict) {
      sqliteDb
        .prepare(
          `UPDATE sync_conflicts
           SET record_label = ?, local_updated_at = ?, cloud_updated_at = ?,
               local_snapshot_json = ?, cloud_snapshot_json = ?, changed_fields_json = ?,
               detected_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          recordLabel,
          String(localMatch.updated_at || localMatch.created_at || ''),
          String(remoteRow.updated_at || remoteRow.created_at || ''),
          JSON.stringify(localMatch),
          JSON.stringify(remoteRow),
          JSON.stringify(changedFields),
          existingConflict.id
        );
    } else {
      sqliteDb
        .prepare(
          `INSERT INTO sync_conflicts (
             table_name, record_id, record_label, local_updated_at, cloud_updated_at,
             local_snapshot_json, cloud_snapshot_json, changed_fields_json, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unresolved')`
        )
        .run(
          tableRule.table,
          String(localMatch[pkCol] ?? pkStr),
          recordLabel,
          String(localMatch.updated_at || localMatch.created_at || ''),
          String(remoteRow.updated_at || remoteRow.created_at || ''),
          JSON.stringify(localMatch),
          JSON.stringify(remoteRow),
          JSON.stringify(changedFields)
        );
    }

    result.conflictsDetected += 1;
    result.conflictDetails.push({
      table: tableRule.table,
      recordId: String(localMatch[pkCol] ?? pkStr),
      label: recordLabel,
      changedFields,
    });
  }

  return result;
}

/**
 * Performs a full, transactional, conflict-aware bidirectional synchronization between
 * Local SQLite and Cloud SQL PostgreSQL.
 *
 * Triggered strictly via manual "Sync Now" (or authorized Super Admin action).
 */
export async function runRelationalBidirectionalSync(options: {
  reason: string;
  actor?: string;
  deviceId?: string;
  skipPull?: boolean;
}): Promise<RelationalMergeSummary> {
  if (!isCloudSqlConfigured()) {
    throw new Error('Cloud SQL PostgreSQL is not configured on this machine.');
  }
  if (!isDatabaseOpen()) {
    throw new Error('Local SQLite database is not open.');
  }

  const sqliteDb = getDatabase();
  const syncedAt = new Date().toISOString();
  const actor = options.actor || 'Super Admin';
  const deviceId = options.deviceId || 'primary-server';

  const summary: RelationalMergeSummary = {
    insertedFromCloud: 0,
    updatedFromCloud: 0,
    keptLocalNewer: 0,
    conflictsDetected: 0,
    pushedTables: 0,
    pushedRows: 0,
    deduplicatedTxCount: 0,
    versionSeq: lastPgVersionSeq,
    syncedAt,
    sha256: computeSqliteLogicalFingerprint(sqliteDb),
    conflictDetails: [],
  };

  const client = await pool.connect();
  try {
    // 1. Ensure all 106 tables + sync coordination tables exist in PostgreSQL
    await ensurePostgresSchemaFromSqlite(sqliteDb, client);

    // 2. Pull cloud changes into local SQLite safely (with conflict detection & duplicate prevention)
    if (!options.skipPull) {
      const metaCheck = await client.query(
        `SELECT version_seq FROM ams_cloud_sync_meta WHERE meta_key = 'primary_store' LIMIT 1`
      );
      const hasExistingCloudData = Boolean(metaCheck.rows && metaCheck.rows.length > 0);
      if (hasExistingCloudData) {
        sqliteDb.exec('PRAGMA foreign_keys = OFF;');
        try {
          for (const rule of ALLOWED_CONFLICT_TABLES) {
            const pgRowsRes = await client.query(
              `SELECT * FROM ${sanitizeIdentifier(rule.table)}`
            );
            const mergeRes = mergeRemoteTableRowsIntoSqlite(
              sqliteDb,
              rule,
              (pgRowsRes.rows || []) as Array<Record<string, unknown>>
            );
            summary.insertedFromCloud += mergeRes.insertedFromCloud;
            summary.updatedFromCloud += mergeRes.updatedFromCloud;
            summary.keptLocalNewer += mergeRes.keptLocalNewer;
            summary.conflictsDetected += mergeRes.conflictsDetected;
            summary.conflictDetails.push(...mergeRes.conflictDetails);
          }
        } finally {
          sqliteDb.exec('PRAGMA foreign_keys = ON;');
        }
      }
    }

    // 3. Push local pending transaction IDs & relational table state inside an atomic PG transaction
    await client.query('BEGIN');

    // Record durable pending client_tx_ids in ams_pg_sync_tx_log (idempotent duplicate prevention)
    let pendingQueueRows: Array<{
      id: number;
      route_label: string;
      table_name: string | null;
      record_id: string | null;
      client_tx_id: string | null;
    }> = [];
    try {
      pendingQueueRows = sqliteDb
        .prepare(
          `SELECT id, route_label, table_name, record_id, client_tx_id
           FROM pending_cloud_sync_queue
           WHERE synced = 0
           ORDER BY id ASC`
        )
        .all() as typeof pendingQueueRows;
    } catch {
      pendingQueueRows = [];
    }

    for (const qRow of pendingQueueRows) {
      const txId = String(qRow.client_tx_id || '').trim();
      if (!txId) continue;
      const ins = await client.query(
        `INSERT INTO ams_pg_sync_tx_log (client_tx_id, table_name, record_id, route_label, device_id, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client_tx_id) DO NOTHING
         RETURNING client_tx_id`,
        [txId, qRow.table_name, qRow.record_id, qRow.route_label, deviceId, syncedAt]
      );
      if (!ins.rows || ins.rows.length === 0) {
        summary.deduplicatedTxCount += 1;
      }
    }

    // Upsert all local SQLite tables relationally into PostgreSQL
    const plans = buildPostgresSchemaPlanFromSqlite(sqliteDb);
    for (const plan of plans) {
      const rows = sqliteDb
        .prepare(`SELECT * FROM ${sanitizeIdentifier(plan.tableName)}`)
        .all() as Array<Record<string, unknown>>;

      if (rows.length === 0) {
        summary.pushedTables += 1;
        continue;
      }

      const colNames = plan.columns.map((c) => c.name);
      const quotedCols = colNames.map(sanitizeIdentifier).join(', ');
      const pkQuoted = plan.primaryKeys.map(sanitizeIdentifier);
      const nonPkCols = colNames.filter((c) => !plan.primaryKeys.includes(c));

      // Guard: if table has primary key, upsert; never overwrite newer cloud rows when updated_at is strictly newer
      const hasUpdatedAt = colNames.includes('updated_at');
      let conflictClause = '';
      if (pkQuoted.length > 0) {
        if (nonPkCols.length > 0) {
          const updateAssignments = nonPkCols
            .map((c) => `${sanitizeIdentifier(c)} = EXCLUDED.${sanitizeIdentifier(c)}`)
            .join(', ');
          const whereNewer = hasUpdatedAt
            ? ` WHERE COALESCE(${sanitizeIdentifier(plan.tableName)}."updated_at", '') <= COALESCE(EXCLUDED."updated_at", '')`
            : '';
          conflictClause = `ON CONFLICT (${pkQuoted.join(', ')}) DO UPDATE SET ${updateAssignments}${whereNewer}`;
        } else {
          conflictClause = `ON CONFLICT (${pkQuoted.join(', ')}) DO NOTHING`;
        }
      }

      // Batch insert rows in chunks of 50 for fast multi-row PostgreSQL upserts
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const batch = rows.slice(i, i + chunkSize);
        const values: unknown[] = [];
        const tupleClauses: string[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const placeholders: string[] = [];
          for (const col of colNames) {
            placeholders.push(`$${paramIdx++}`);
            const v = row[col];
            values.push(v === undefined ? null : v);
          }
          tupleClauses.push(`(${placeholders.join(', ')})`);
        }

        const sqlText = `INSERT INTO ${sanitizeIdentifier(plan.tableName)} (${quotedCols}) VALUES ${tupleClauses.join(', ')} ${conflictClause}`;
        await client.query(sqlText, values);
        summary.pushedRows += batch.length;
      }
      summary.pushedTables += 1;
    }

    // Increment authoritative Cloud SQL version sequence & persist record counts
    const counts = collectSqliteRecordCounts(sqliteDb);
    const nextFingerprint = computeSqliteLogicalFingerprint(sqliteDb);
    const metaUpsert = await client.query(
      `INSERT INTO ams_cloud_sync_meta (meta_key, version_seq, sha256, updated_at, updated_by, summary_json)
       VALUES ('primary_store', 1, $1, $2, $3, $4)
       ON CONFLICT (meta_key) DO UPDATE SET
         version_seq = ams_cloud_sync_meta.version_seq + 1,
         sha256 = EXCLUDED.sha256,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by,
         summary_json = EXCLUDED.summary_json
       RETURNING version_seq`,
      [nextFingerprint, syncedAt, `${actor} (${options.reason})`, JSON.stringify(counts)]
    );
    const newVersionSeq = Number(metaUpsert.rows?.[0]?.version_seq || lastPgVersionSeq + 1);

    await client.query('COMMIT');

    lastPgVersionSeq = newVersionSeq;
    pgAvailable = true;
    lastPgError = null;
    summary.versionSeq = newVersionSeq;
    summary.sha256 = nextFingerprint;

    return summary;
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    pgAvailable = false;
    const msg = error instanceof Error ? error.message : String(error);
    lastPgError = msg;
    throw new Error(`Cloud SQL PostgreSQL synchronization failed: ${msg}`, { cause: error });
  } finally {
    client.release();
  }
}

/**
 * Legacy helper alias preserved for relational full-table push.
 */
export async function mirrorAllSqliteTablesToPostgres(): Promise<{
  syncedTables: number;
  totalRowsSynced: number;
}> {
  const res = await runRelationalBidirectionalSync({
    reason: 'mirror_all_tables',
    skipPull: true,
  });
  return {
    syncedTables: res.pushedTables,
    totalRowsSynced: res.pushedRows,
  };
}
