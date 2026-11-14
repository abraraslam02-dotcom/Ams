import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import {
  getDatabase,
  closeDatabaseConnection,
  reopenDatabaseConnection,
  syncRuntimeToSeedDatabase,
  getWasDatabaseCreatedOnBoot,
  markDatabaseHydratedFromCloud,
} from '../db/connection.ts';
import { runMigrations } from '../db/migrations.ts';
import { bumpDbResetEpoch } from '../db/resetState.ts';

function loadFirebaseConfig(): { projectId?: string; firestoreDatabaseId?: string; apiKey?: string } {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {
    // fallback below
  }
  return {};
}
const firebaseConfig = loadFirebaseConfig();

export interface CloudRecordCounts {
  items: number;
  accounts: number;
  customAccounts: number;
  purchases: number;
  sales: number;
  inventoryBatches: number;
  journalEntries: number;
  cashBookEntries: number;
  users: number;
  saleReturns: number;
  purchaseReturns: number;
  supplySheets: number;
  tombstonesTotal: number;
}

export interface DeploymentSafetyReport {
  safeToDeploy: boolean;
  checkedAt: string;
  externalDbConnected: boolean;
  externalDbLocation: string;
  schemaCompatible: boolean;
  localIntegrityOk: boolean;
  protectionLockActive: boolean;
  localCounts: CloudRecordCounts;
  cloudCounts: CloudRecordCounts | null;
  cloudVersionSeq: number;
  message: string;
}

export interface CloudPersistenceStatus {
  enabled: boolean;
  connected: boolean;
  provider: 'firestore-enterprise-vault' | 'sqlite-persistent-central';
  externalLocation: string;
  projectId: string;
  databaseId: string;
  collectionPath: string;
  initialized: boolean;
  hydrationComplete: boolean;
  lastSyncAt: string | null;
  lastRestoreAt: string | null;
  lastVersionSeq: number;
  lastSha256: string | null;
  lastError: string | null;
  cloudRecordCounts: Record<string, number> | null;
  localRecordCounts: Record<string, number> | null;
  protectionLockActive: boolean;
}

const VAULT_COLLECTION = 'ams_vault_e5f2831c';
const VAULT_SERVER_KEY = 'ams_srv_vault_e5f2831c_4daf_499d_a38b_45adc902ab45';
const MAX_CHUNK_CHARS = 650000; // Safely below Firestore 1 MiB document limit

const ENV_SCOPE_PREFIX =
  config.envScope === 'production'
    ? 'prod'
    : config.envScope === 'test'
    ? 'test'
    : 'dev';
const MANIFEST_DOC_ID = `${ENV_SCOPE_PREFIX}_manifest`;

const FIRESTORE_PROJECT_ID = String(firebaseConfig.projectId || 'chromatic-concord-0pz3c');
const FIRESTORE_DATABASE_ID = String(
  firebaseConfig.firestoreDatabaseId ||
    'ai-studio-abrarmedicalstor-e5f2831c-4daf-499d-a38b-45adc902ab45'
);
const FIRESTORE_API_KEY = String(firebaseConfig.apiKey || '');

const EXTERNAL_DB_LOCATION = `projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${VAULT_COLLECTION} [${config.envScope.toUpperCase()}: ${MANIFEST_DOC_ID}]`;

// Deterministic 32-byte AES-256-GCM key derived from project & vault constants
const VAULT_AES_KEY = crypto
  .createHash('sha256')
  .update(`${VAULT_SERVER_KEY}:${FIRESTORE_PROJECT_ID}:${FIRESTORE_DATABASE_ID}`)
  .digest();

let isInitialized = false;
let isHydrationComplete = false;
let isConnected = false;
let lastSyncAt: string | null = null;
let lastRestoreAt: string | null = null;
let lastVersionSeq = 0;
let lastSha256: string | null = null;
let lastError: string | null = null;
let cloudRecordCounts: Record<string, number> | null = null;

let initPromise: Promise<void> | null = null;
let uploadTimer: NodeJS.Timeout | null = null;
let isSyncInFlight = false;
let pendingUploadAfterInFlight = false;
let pendingUploadReason = 'queued_mutation';
let backgroundInterval: NodeJS.Timeout | null = null;

interface VaultDocFields {
  vaultKey: string;
  docId: string;
  chunkIndex: number;
  totalChunks: number;
  versionSeq: number;
  sha256Hash: string;
  payload: string;
  recordCounts: string;
  updatedByEnv: string;
  updatedAt: string;
}

interface ManifestMetadata {
  slot: 'slot0' | 'slot1';
  totalChunks: number;
  sha256Hash: string;
  rawSizeBytes: number;
  compressedSizeBytes: number;
  versionSeq: number;
  counts: CloudRecordCounts;
  updatedAt: string;
  updatedByEnv: string;
}

/**
 * Encrypts a Buffer with AES-256-GCM and returns compact base64 string: ivHex.tagHex.cipherBase64
 */
function encryptBuffer(plainBuffer: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('base64')}`;
}

/**
 * Decrypts a compact string created by encryptBuffer back into a Buffer
 */
function decryptToBuffer(encoded: string): Buffer {
  const parts = encoded.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted vault payload format.');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_AES_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function buildFirestoreDocUrl(docId: string): string {
  const cleanId = encodeURIComponent(docId);
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${VAULT_COLLECTION}/${cleanId}?key=${encodeURIComponent(FIRESTORE_API_KEY)}`;
}

async function readVaultDocument(docId: string): Promise<VaultDocFields | null> {
  const url = buildFirestoreDocUrl(docId);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) {
    isConnected = true;
    return null;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Firestore GET ${docId} failed (${response.status}): ${errText.slice(0, 240)}`);
  }

  isConnected = true;
  const json = (await response.json()) as {
    fields?: Record<string, { stringValue?: string; integerValue?: string }>;
  };
  const f = json.fields || {};
  return {
    vaultKey: String(f.vaultKey?.stringValue || ''),
    docId: String(f.docId?.stringValue || docId),
    chunkIndex: Number(f.chunkIndex?.integerValue || 0),
    totalChunks: Number(f.totalChunks?.integerValue || 1),
    versionSeq: Number(f.versionSeq?.integerValue || 1),
    sha256Hash: String(f.sha256Hash?.stringValue || ''),
    payload: String(f.payload?.stringValue || ''),
    recordCounts: String(f.recordCounts?.stringValue || '{}'),
    updatedByEnv: String(f.updatedByEnv?.stringValue || 'unknown'),
    updatedAt: String(f.updatedAt?.stringValue || ''),
  };
}

async function writeVaultDocument(doc: VaultDocFields): Promise<void> {
  const url = buildFirestoreDocUrl(doc.docId);
  const body = {
    fields: {
      vaultKey: { stringValue: VAULT_SERVER_KEY },
      docId: { stringValue: doc.docId },
      chunkIndex: { integerValue: String(Math.max(0, Math.floor(doc.chunkIndex))) },
      totalChunks: { integerValue: String(Math.max(1, Math.floor(doc.totalChunks))) },
      versionSeq: { integerValue: String(Math.max(1, Math.floor(doc.versionSeq))) },
      sha256Hash: { stringValue: doc.sha256Hash },
      payload: { stringValue: doc.payload },
      recordCounts: { stringValue: doc.recordCounts.slice(0, 3900) },
      updatedByEnv: { stringValue: (doc.updatedByEnv || 'server').slice(0, 110) },
      updatedAt: { stringValue: doc.updatedAt || new Date().toISOString() },
    },
  };

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Firestore PATCH ${doc.docId} failed (${response.status}): ${errText.slice(0, 240)}`
    );
  }
  isConnected = true;
}

/**
 * Inspects a SQLite file on disk and returns detailed record counts and validity.
 */
function inspectSqliteSnapshot(filePath: string): {
  valid: boolean;
  counts: CloudRecordCounts;
} {
  const emptyCounts: CloudRecordCounts = {
    items: 0,
    accounts: 0,
    customAccounts: 0,
    purchases: 0,
    sales: 0,
    inventoryBatches: 0,
    journalEntries: 0,
    cashBookEntries: 0,
    users: 0,
    saleReturns: 0,
    purchaseReturns: 0,
    supplySheets: 0,
    tombstonesTotal: 0,
  };

  if (!fs.existsSync(filePath)) {
    return { valid: false, counts: emptyCounts };
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 4096) {
    return { valid: false, counts: emptyCounts };
  }

  let tempDb: Database.Database | null = null;
  try {
    tempDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = String(tempDb.pragma('integrity_check', { simple: true }) || '');
    if (integrity.toLowerCase() !== 'ok') {
      return { valid: false, counts: emptyCounts };
    }

    const tables = tempDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tableSet = new Set(tables.map((t) => t.name));
    const required = ['items', 'accounts', 'sales', 'purchases', 'inventory'];
    if (required.some((r) => !tableSet.has(r))) {
      return { valid: false, counts: emptyCounts };
    }

    const countTable = (name: string): number => {
      if (!tableSet.has(name)) return 0;
      const row = tempDb!.prepare(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt: number };
      return Number(row?.cnt || 0);
    };

    let customAccounts = 0;
    try {
      const caRow = tempDb
        .prepare('SELECT COUNT(*) as cnt FROM accounts WHERE is_system_account = 0')
        .get() as { cnt: number };
      customAccounts = Number(caRow?.cnt || 0);
    } catch {
      customAccounts = Math.max(0, countTable('accounts') - 35);
    }

    const counts: CloudRecordCounts = {
      items: countTable('items'),
      accounts: countTable('accounts'),
      customAccounts,
      purchases: countTable('purchases'),
      sales: countTable('sales'),
      inventoryBatches: countTable('inventory'),
      journalEntries: countTable('journal_entries'),
      cashBookEntries: countTable('cash_book_vouchers'),
      users: countTable('users'),
      saleReturns: countTable('sale_returns'),
      purchaseReturns: countTable('purchase_returns'),
      supplySheets: countTable('town_supplies'),
      tombstonesTotal: countTable('sync_tombstones'),
    };

    return { valid: true, counts };
  } catch {
    return { valid: false, counts: emptyCounts };
  } finally {
    if (tempDb) {
      try {
        tempDb.close();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Computes total user business records (excluding default system accounts & default admin user)
 * so we can reliably detect whether a database has user-created business data.
 */
function getBusinessRecordScore(counts: Partial<CloudRecordCounts> | Record<string, number> | null | undefined): number {
  if (!counts) return 0;
  const items = Number(counts.items || 0);
  const customAccounts =
    counts.customAccounts !== undefined
      ? Number(counts.customAccounts || 0)
      : Math.max(0, Number(counts.accounts || 0) - 35);
  const sales = Number(counts.sales || 0);
  const purchases = Number(counts.purchases || 0);
  const inventoryBatches = Number(counts.inventoryBatches || 0);
  const journalEntries = Number(counts.journalEntries || 0);
  const cashBookEntries = Number(counts.cashBookEntries || 0);
  const saleReturns = Number(counts.saleReturns || 0);
  const purchaseReturns = Number(counts.purchaseReturns || 0);
  const supplySheets = Number(counts.supplySheets || 0);
  const extraUsers = Math.max(0, Number(counts.users || 0) - 1);

  return (
    items +
    customAccounts +
    sales +
    purchases +
    inventoryBatches +
    journalEntries +
    cashBookEntries +
    saleReturns +
    purchaseReturns +
    supplySheets +
    extraUsers
  );
}

export function getCloudPersistenceStatus(): CloudPersistenceStatus {
  const localInspect = inspectSqliteSnapshot(config.databasePath);
  return {
    enabled: Boolean(FIRESTORE_PROJECT_ID && FIRESTORE_DATABASE_ID && FIRESTORE_API_KEY),
    connected: isConnected,
    provider: 'firestore-enterprise-vault',
    externalLocation: EXTERNAL_DB_LOCATION,
    projectId: FIRESTORE_PROJECT_ID,
    databaseId: FIRESTORE_DATABASE_ID,
    collectionPath: `/${VAULT_COLLECTION}`,
    initialized: isInitialized,
    hydrationComplete: isHydrationComplete,
    lastSyncAt,
    lastRestoreAt,
    lastVersionSeq,
    lastSha256,
    lastError,
    cloudRecordCounts,
    localRecordCounts: localInspect.counts as unknown as Record<string, number>,
    protectionLockActive: true,
  };
}

/**
 * Fetches and parses the current environment's cloud manifest from Firestore if it exists.
 */
async function fetchCloudManifest(): Promise<ManifestMetadata | null> {
  const doc = await readVaultDocument(MANIFEST_DOC_ID);
  if (!doc || !doc.payload) {
    return null;
  }
  try {
    const decrypted = decryptToBuffer(doc.payload);
    const meta = JSON.parse(decrypted.toString('utf8')) as ManifestMetadata;
    return {
      ...meta,
      versionSeq: Number(doc.versionSeq || meta.versionSeq || 1),
      sha256Hash: String(doc.sha256Hash || meta.sha256Hash || ''),
    };
  } catch {
    return null;
  }
}

/**
 * Downloads all chunks referenced by a cloud manifest, decrypts, decompresses, and verifies SHA-256.
 */
async function downloadVerifiedCloudSqliteBuffer(manifest: ManifestMetadata): Promise<Buffer> {
  const slot = manifest.slot || 'slot1';
  const totalChunks = Math.max(1, Number(manifest.totalChunks || 1));
  const chunkStrings: string[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunkDocId = `${ENV_SCOPE_PREFIX}_${slot}_chunk_${i}`;
    const chunkDoc = await readVaultDocument(chunkDocId);
    if (!chunkDoc || !chunkDoc.payload) {
      throw new Error(`Missing cloud database chunk ${chunkDocId} in Firestore.`);
    }
    chunkStrings.push(chunkDoc.payload);
  }

  const combinedEncrypted = chunkStrings.join('');
  const compressedBuffer = decryptToBuffer(combinedEncrypted);
  const rawSqliteBuffer = zlib.gunzipSync(compressedBuffer);

  const computedHash = crypto.createHash('sha256').update(rawSqliteBuffer).digest('hex');
  if (manifest.sha256Hash && computedHash !== manifest.sha256Hash) {
    throw new Error(
      `Cloud SQLite snapshot SHA-256 mismatch (expected ${manifest.sha256Hash}, got ${computedHash}).`
    );
  }

  return rawSqliteBuffer;
}

/**
 * Non-destructively merges all missing rows AND reconciles balances/stock from a verified cloud SQLite file
 * into the active local SQLite database. Never deletes existing local records unless a tombstone exists.
 */
function mergeMissingRowsFromCloudDb(cloudDbFilePath: string, reason: string): number {
  let totalInsertedOrUpdated = 0;
  try {
    const db = getDatabase();
    const escapedPath = cloudDbFilePath.replace(/'/g, "''");

    db.exec(`ATTACH DATABASE '${escapedPath}' AS cloud_snap;`);
    try {
      const localTables = new Set(
        (
          db
            .prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all() as Array<{ name: string }>
        ).map((t) => t.name)
      );
      const cloudTables = new Set(
        (
          db
            .prepare("SELECT name FROM cloud_snap.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all() as Array<{ name: string }>
        ).map((t) => t.name)
      );

      // Build tombstone lookup so explicitly deleted records are not resurrected
      const tombstones = new Set<string>();
      if (localTables.has('sync_tombstones')) {
        const localTombs = db
          .prepare('SELECT table_name, record_id FROM main.sync_tombstones')
          .all() as Array<{ table_name: string; record_id: number }>;
        for (const t of localTombs) {
          tombstones.add(`${t.table_name}:${t.record_id}`);
        }
      }
      // Merge tombstones so explicitly deleted records are not resurrected
      if (cloudTables.has('sync_tombstones') && localTables.has('sync_tombstones')) {
        db.prepare(
          `INSERT OR IGNORE INTO main.sync_tombstones (table_name, record_id, client_tx_id, deleted_at)
           SELECT table_name, record_id, client_tx_id, deleted_at FROM cloud_snap.sync_tombstones`
        ).run();
      }

      const priorityTables = [
        'users',
        'user_permissions',
        'role_permissions',
        'company_settings',
        'advance_tax_settings',
        'cities',
        'towns',
        'town_areas',
        'accounts',
        'items',
        'inventory',
        'purchases',
        'purchase_items',
        'sales',
        'sale_items',
        'sale_returns',
        'sale_return_items',
        'purchase_returns',
        'purchase_return_items',
        'journal_entries',
        'journal_entry_lines',
        'accounting_vouchers',
        'accounting_voucher_lines',
        'cash_book_vouchers',
        'payment_vouchers',
        'salesmen',
        'deliverymen',
        'town_supplies',
        'party_supplies',
        'party_supply_items',
        'trade_offers',
        'party_discounts',
        'invoice_sequences',
        'invoice_number_registry',
        'item_code_sequences',
        'cash_book_sequences',
        'account_sequences',
        'employee_sequences',
        'app_sequences',
      ];

      const skipTables = new Set(['user_sessions', 'database_migrations', 'device_registry', 'sync_tombstones']);
      const allSharedTables = [
        ...priorityTables,
        ...Array.from(localTables).filter(
          (t) => !priorityTables.includes(t) && !skipTables.has(t) && cloudTables.has(t)
        ),
      ];

      db.pragma('foreign_keys = OFF');
      const mergeTx = db.transaction(() => {
        for (const tableName of allSharedTables) {
          if (!localTables.has(tableName) || !cloudTables.has(tableName)) continue;

          const localCols = (
            db.prepare(`PRAGMA main.table_info("${tableName}")`).all() as Array<{ name: string }>
          ).map((c) => c.name);
          const cloudColsSet = new Set(
            (
              db
                .prepare(`PRAGMA cloud_snap.table_info("${tableName}")`)
                .all() as Array<{ name: string }>
            ).map((c) => c.name)
          );

          const sharedCols = localCols.filter((c) => cloudColsSet.has(c));
          if (sharedCols.length === 0) continue;

          const quotedCols = sharedCols.map((c) => `"${c}"`).join(', ');
          const hasId = sharedCols.includes('id');

          if (hasId && localTables.has('sync_tombstones')) {
            const stmt = db.prepare(
              `INSERT OR IGNORE INTO main."${tableName}" (${quotedCols})
               SELECT ${quotedCols} FROM cloud_snap."${tableName}"
               WHERE CAST(id AS TEXT) NOT IN (SELECT CAST(record_id AS TEXT) FROM main.sync_tombstones WHERE table_name = ?)`
            );
            const res = stmt.run(tableName);
            totalInsertedOrUpdated += Number(res.changes || 0);
          } else {
            const stmt = db.prepare(
              `INSERT OR IGNORE INTO main."${tableName}" (${quotedCols})
               SELECT ${quotedCols} FROM cloud_snap."${tableName}"`
            );
            const res = stmt.run();
            totalInsertedOrUpdated += Number(res.changes || 0);
          }
        }

        // Reconcile sequences so invoice / item / voucher / account codes never regress or duplicate
        if (localTables.has('invoice_sequences') && cloudTables.has('invoice_sequences')) {
          db.prepare(
            `UPDATE main.invoice_sequences
             SET last_seq = MAX(
               main.invoice_sequences.last_seq,
               COALESCE((SELECT c.last_seq FROM cloud_snap.invoice_sequences c WHERE c.period_key = main.invoice_sequences.period_key), 0)
             )`
          ).run();
        }
        if (localTables.has('item_code_sequences') && cloudTables.has('item_code_sequences')) {
          db.prepare(
            `UPDATE main.item_code_sequences
             SET last_number = MAX(
               main.item_code_sequences.last_number,
               COALESCE((SELECT c.last_number FROM cloud_snap.item_code_sequences c WHERE c.sequence_key = main.item_code_sequences.sequence_key), 0)
             )`
          ).run();
        }
        if (localTables.has('cash_book_sequences') && cloudTables.has('cash_book_sequences')) {
          db.prepare(
            `UPDATE main.cash_book_sequences
             SET last_sequence = MAX(
               main.cash_book_sequences.last_sequence,
               COALESCE((SELECT c.last_sequence FROM cloud_snap.cash_book_sequences c WHERE c.sequence_key = main.cash_book_sequences.sequence_key), 0)
             )`
          ).run();
        }

        // Reconcile custom account balances and city where cloud has newer updated_at
        if (localTables.has('accounts') && cloudTables.has('accounts')) {
          db.prepare(
            `UPDATE main.accounts
             SET current_balance = COALESCE(
                   (SELECT c.current_balance FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND COALESCE(c.updated_at, '') > COALESCE(main.accounts.updated_at, '')),
                   main.accounts.current_balance
                 ),
                 total_debit = COALESCE(
                   (SELECT c.total_debit FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND COALESCE(c.updated_at, '') > COALESCE(main.accounts.updated_at, '')),
                   main.accounts.total_debit
                 ),
                 total_credit = COALESCE(
                   (SELECT c.total_credit FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND COALESCE(c.updated_at, '') > COALESCE(main.accounts.updated_at, '')),
                   main.accounts.total_credit
                 ),
                 city = COALESCE(
                   NULLIF(main.accounts.city, ''),
                   (SELECT c.city FROM cloud_snap.accounts c WHERE c.id = main.accounts.id)
                 )`
          ).run();
        }

        // Reconcile inventory stock where cloud has newer updated_at
        if (localTables.has('inventory') && cloudTables.has('inventory')) {
          db.prepare(
            `UPDATE main.inventory
             SET current_pack_qty = COALESCE(
                   (SELECT c.current_pack_qty FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND COALESCE(c.updated_at, '') > COALESCE(main.inventory.updated_at, '')),
                   main.inventory.current_pack_qty
                 ),
                 current_loose_qty = COALESCE(
                   (SELECT c.current_loose_qty FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND COALESCE(c.updated_at, '') > COALESCE(main.inventory.updated_at, '')),
                   main.inventory.current_loose_qty
                 ),
                 total_stock_units = COALESCE(
                   (SELECT c.total_stock_units FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND COALESCE(c.updated_at, '') > COALESCE(main.inventory.updated_at, '')),
                   main.inventory.total_stock_units
                 )`
          ).run();
        }
      });

      mergeTx();
    } finally {
      db.pragma('foreign_keys = ON');
      try {
        db.exec('DETACH DATABASE cloud_snap;');
      } catch {
        // ignore
      }
    }

    if (totalInsertedOrUpdated > 0) {
      if (config.envScope === 'development') {
        syncRuntimeToSeedDatabase();
      }
      console.log(
        `[AMS Cloud Persistence] Non-destructively merged ${totalInsertedOrUpdated} record(s) from Firestore cloud snapshot (${reason}).`
      );
    }
  } catch (err) {
    console.warn('[AMS Cloud Persistence] Non-destructive cloud row merge warning:', err);
  }
  return totalInsertedOrUpdated;
}

/**
 * Restores or merges the production SQLite database from external Firestore storage.
 * - If the local database is an empty container database (0 business records) while Firestore has
 *   business records, performs a full binary restoration + schema migration + non-destructive merge.
 * - If both local and Firestore have business records, performs a non-destructive union merge so
 *   neither side ever loses a single record.
 */
async function restoreOrMergeFromCloud(reason: string): Promise<boolean> {
  try {
    const manifest = await fetchCloudManifest();
    if (!manifest) {
      return false;
    }

    cloudRecordCounts = manifest.counts as unknown as Record<string, number>;
    const cloudScore = getBusinessRecordScore(manifest.counts);
    const localInspectBefore = inspectSqliteSnapshot(config.databasePath);
    const localScore = getBusinessRecordScore(localInspectBefore.counts);

    // Download and verify cloud SQLite binary into a temporary staging file
    const rawBuffer = await downloadVerifiedCloudSqliteBuffer(manifest);
    const dataDir = path.dirname(config.databasePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const stagedCloudPath = path.join(dataDir, `ams_cloud_staged_${Date.now()}.db`);
    fs.writeFileSync(stagedCloudPath, rawBuffer);

    const stagedInspect = inspectSqliteSnapshot(stagedCloudPath);
    if (!stagedInspect.valid) {
      try {
        fs.unlinkSync(stagedCloudPath);
      } catch {
        // ignore
      }
      throw new Error('Downloaded cloud SQLite database failed PRAGMA integrity_check.');
    }

    try {
      const freshlyBootedContainerDb = getWasDatabaseCreatedOnBoot();
      if ((localScore === 0 || freshlyBootedContainerDb) && cloudScore > 0) {
        // Freshly deployed/republished container (or empty DB) -> Full authoritative restoration from Firestore!
        const backupDir = path.join(dataDir, 'backups');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        if (fs.existsSync(config.databasePath)) {
          const preHydrateSafetyPath = path.join(
            backupDir,
            `Pre_CloudHydrate_${Date.now()}.db`
          );
          try {
            fs.copyFileSync(config.databasePath, preHydrateSafetyPath);
          } catch {
            // ignore
          }
        }

        closeDatabaseConnection();
        const walPath = `${config.databasePath}-wal`;
        const shmPath = `${config.databasePath}-shm`;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

        fs.copyFileSync(stagedCloudPath, config.databasePath);

        reopenDatabaseConnection();
        runMigrations();
        if (config.envScope === 'development') {
          syncRuntimeToSeedDatabase();
        }
        markDatabaseHydratedFromCloud();

        lastVersionSeq = manifest.versionSeq;
        lastSha256 = manifest.sha256Hash;
        lastRestoreAt = new Date().toISOString();
        cloudRecordCounts = stagedInspect.counts as unknown as Record<string, number>;

        console.log(
          `[AMS Cloud Persistence] RESTORED LIVE ${config.envScope.toUpperCase()} DATABASE FROM FIRESTORE (${reason}) — Version #${manifest.versionSeq}:`,
          stagedInspect.counts
        );
        return true;
      }

      // Both local and cloud have data -> Non-destructive union merge!
      const mergedCount = mergeMissingRowsFromCloudDb(stagedCloudPath, reason);
      markDatabaseHydratedFromCloud();
      if (manifest.versionSeq > lastVersionSeq) {
        lastVersionSeq = manifest.versionSeq;
      }
      lastSha256 = manifest.sha256Hash;
      lastRestoreAt = new Date().toISOString();
      return mergedCount > 0;
    } finally {
      try {
        if (fs.existsSync(stagedCloudPath)) {
          fs.unlinkSync(stagedCloudPath);
        }
      } catch {
        // ignore
      }
    }
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[AMS Cloud Persistence] Cloud restore/merge check (${reason}) warning:`, lastError);
    return false;
  }
}

/**
 * Atomically snapshots the active SQLite database and uploads it to Firestore in encrypted chunks.
 * Includes strict anti-data-loss protection checks to NEVER overwrite a non-empty cloud database
 * with an empty container database.
 */
async function uploadLocalDbToCloud(
  reason: string,
  options?: { forceOverwrite?: boolean }
): Promise<boolean> {
  if (isSyncInFlight) {
    pendingUploadAfterInFlight = true;
    pendingUploadReason = reason;
    return false;
  }

  isSyncInFlight = true;
  const dataDir = path.dirname(config.databasePath);
  const tempSnapPath = path.join(dataDir, `ams_upload_snap_${Date.now()}.db`);

  try {
    const db = getDatabase();

    // 1. Flush WAL and create atomic snapshot via VACUUM INTO
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }

    try {
      const escaped = tempSnapPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}';`);
    } catch {
      fs.copyFileSync(config.databasePath, tempSnapPath);
    }

    const localInspection = inspectSqliteSnapshot(tempSnapPath);
    if (!localInspection.valid) {
      throw new Error('Local SQLite snapshot failed integrity verification before cloud upload.');
    }

    // 2. Check existing cloud manifest BEFORE uploading to prevent overwriting live data
    const existingManifest = await fetchCloudManifest();
    const localScore = getBusinessRecordScore(localInspection.counts);
    const cloudScore = existingManifest ? getBusinessRecordScore(existingManifest.counts) : 0;

    if (existingManifest && !options?.forceOverwrite) {
      // CRITICAL PROTECTION #1: Never let an empty container database overwrite a non-empty cloud database!
      if (cloudScore > 0 && localScore === 0) {
        console.warn(
          `[AMS Cloud Persistence] SAFETY LOCK ENGAGED: Blocked empty container database from overwriting live Firestore database (cloudScore=${cloudScore}, localScore=0). Hydrating from Firestore instead!`
        );
        try {
          if (fs.existsSync(tempSnapPath)) fs.unlinkSync(tempSnapPath);
        } catch {
          // ignore
        }
        isSyncInFlight = false;
        await restoreOrMergeFromCloud(`safety_lock_blocked_empty_upload:${reason}`);
        return false;
      }

      // CRITICAL PROTECTION #2: If cloud has more business records than local without new local tombstones,
      // merge cloud records into local FIRST so no records from cloud are ever lost!
      const localTombstones = Number(localInspection.counts.tombstonesTotal || 0);
      const cloudTombstones = Number(existingManifest.counts?.tombstonesTotal || 0);
      const hasMissingCloudItems =
        Number(existingManifest.counts?.items || 0) > Number(localInspection.counts.items || 0) ||
        Number(existingManifest.counts?.sales || 0) > Number(localInspection.counts.sales || 0) ||
        Number(existingManifest.counts?.purchases || 0) > Number(localInspection.counts.purchases || 0) ||
        Number(existingManifest.counts?.customAccounts || 0) >
          Number(localInspection.counts.customAccounts || 0);

      if (hasMissingCloudItems && localTombstones <= cloudTombstones) {
        try {
          const cloudBuf = await downloadVerifiedCloudSqliteBuffer(existingManifest);
          const mergeTempPath = path.join(dataDir, `ams_preupload_merge_${Date.now()}.db`);
          fs.writeFileSync(mergeTempPath, cloudBuf);
          try {
            mergeMissingRowsFromCloudDb(mergeTempPath, `pre_upload_reconcile:${reason}`);
          } finally {
            if (fs.existsSync(mergeTempPath)) fs.unlinkSync(mergeTempPath);
          }

          // Re-snapshot after merging cloud rows
          if (fs.existsSync(tempSnapPath)) fs.unlinkSync(tempSnapPath);
          const escapedRetry = tempSnapPath.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${escapedRetry}';`);
        } catch (mergeErr) {
          console.warn('[AMS Cloud Persistence] Pre-upload cloud reconcile warning:', mergeErr);
        }
      }
    }

    const finalInspection = inspectSqliteSnapshot(tempSnapPath);
    const rawBuffer = fs.readFileSync(tempSnapPath);
    const sha256Hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    if (
      existingManifest &&
      existingManifest.sha256Hash === sha256Hash &&
      !options?.forceOverwrite
    ) {
      lastSha256 = sha256Hash;
      lastVersionSeq = existingManifest.versionSeq;
      lastSyncAt = new Date().toISOString();
      cloudRecordCounts = finalInspection.counts as unknown as Record<string, number>;
      return true;
    }

    // 3. Compress & AES-256-GCM encrypt the SQLite binary
    const compressedBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
    const encryptedString = encryptBuffer(compressedBuffer);

    const totalChunks = Math.max(1, Math.ceil(encryptedString.length / MAX_CHUNK_CHARS));
    const nextVersionSeq = Math.max(
      1,
      lastVersionSeq + 1,
      (existingManifest?.versionSeq || 0) + 1
    );
    const targetSlot: 'slot0' | 'slot1' = nextVersionSeq % 2 === 0 ? 'slot0' : 'slot1';
    const nowIso = new Date().toISOString();
    const countsJson = JSON.stringify(finalInspection.counts);
    const envLabel = `${config.nodeEnv}:${reason}`.slice(0, 110);

    // 4. Write all chunks to targetSlot FIRST (leaving previous slot untouched until manifest commits)
    for (let i = 0; i < totalChunks; i++) {
      const slice = encryptedString.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS);
      await writeVaultDocument({
        vaultKey: VAULT_SERVER_KEY,
        docId: `${ENV_SCOPE_PREFIX}_${targetSlot}_chunk_${i}`,
        chunkIndex: i,
        totalChunks,
        versionSeq: nextVersionSeq,
        sha256Hash,
        payload: slice,
        recordCounts: countsJson,
        updatedByEnv: envLabel,
        updatedAt: nowIso,
      });
    }

    // 5. Commit the atomic manifest pointing to targetSlot
    const manifestMeta: ManifestMetadata = {
      slot: targetSlot,
      totalChunks,
      sha256Hash,
      rawSizeBytes: rawBuffer.length,
      compressedSizeBytes: compressedBuffer.length,
      versionSeq: nextVersionSeq,
      counts: finalInspection.counts,
      updatedAt: nowIso,
      updatedByEnv: envLabel,
    };

    const encryptedManifestPayload = encryptBuffer(
      Buffer.from(JSON.stringify(manifestMeta), 'utf8')
    );

    await writeVaultDocument({
      vaultKey: VAULT_SERVER_KEY,
      docId: MANIFEST_DOC_ID,
      chunkIndex: 0,
      totalChunks,
      versionSeq: nextVersionSeq,
      sha256Hash,
      payload: encryptedManifestPayload,
      recordCounts: countsJson,
      updatedByEnv: envLabel,
      updatedAt: nowIso,
    });

    // Keep seed mirror in sync only in development mode (never let prod/test overwrite workspace seed)
    if (config.envScope === 'development') {
      syncRuntimeToSeedDatabase();
    }

    lastVersionSeq = nextVersionSeq;
    lastSha256 = sha256Hash;
    lastSyncAt = nowIso;
    lastError = null;
    cloudRecordCounts = finalInspection.counts as unknown as Record<string, number>;

    console.log(
      `[AMS Cloud Persistence] Synced production DB to Firestore (${reason}) -> v${nextVersionSeq} (${targetSlot}, ${totalChunks} chunk(s), ${compressedBuffer.length}B gz):`,
      finalInspection.counts
    );

    return true;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[AMS Cloud Persistence] Upload failed (${reason}):`, lastError);
    return false;
  } finally {
    try {
      if (fs.existsSync(tempSnapPath)) {
        fs.unlinkSync(tempSnapPath);
      }
    } catch {
      // ignore
    }
    isSyncInFlight = false;

    if (pendingUploadAfterInFlight) {
      pendingUploadAfterInFlight = false;
      const nextReason = pendingUploadReason;
      setTimeout(() => {
        void uploadLocalDbToCloud(nextReason);
      }, 50);
    }
  }
}

/**
 * Initializes permanent external cloud persistence on server boot.
 * Safe to call multiple times; returns the same initialization promise.
 */
export async function initCloudPersistence(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      isInitialized = true;
      const manifest = await fetchCloudManifest();

      if (manifest) {
        cloudRecordCounts = manifest.counts as unknown as Record<string, number>;
        const cloudScore = getBusinessRecordScore(manifest.counts);
        const localInspect = inspectSqliteSnapshot(config.databasePath);
        const localScore = getBusinessRecordScore(localInspect.counts);

        console.log(
          `[AMS Cloud Persistence] Startup check — External Firestore v${manifest.versionSeq} (score=${cloudScore}) vs Local container DB (score=${localScore})`
        );

        // Always restore or merge from cloud on startup when cloud has records
        if (cloudScore > 0 || manifest.versionSeq > lastVersionSeq) {
          await restoreOrMergeFromCloud('startup_hydration');
        }

        // After merging, if local has additional records not yet in cloud, push the merged superset back
        const afterInspect = inspectSqliteSnapshot(config.databasePath);
        const afterScore = getBusinessRecordScore(afterInspect.counts);
        if (afterScore > cloudScore) {
          await uploadLocalDbToCloud('startup_superset_sync');
        } else {
          lastVersionSeq = manifest.versionSeq;
          lastSha256 = manifest.sha256Hash;
        }
        lastError = null;
      } else {
        console.log(
          `[AMS Cloud Persistence] No existing Firestore manifest (${MANIFEST_DOC_ID}) found. Initializing permanent Firestore vault with current ${config.envScope} database...`
        );
        await uploadLocalDbToCloud('initial_vault_bootstrap');
      }
    } catch (err: unknown) {
      isConnected = false;
      lastError = err instanceof Error ? err.message : String(err);
      console.error('[AMS Cloud Persistence] Initialization error:', lastError);
    } finally {
      isHydrationComplete = true;
    }
  })();

  return initPromise;
}

/**
 * Middleware / route helper ensuring startup cloud hydration has finished before serving API requests.
 */
export async function ensureCloudPersistenceReady(): Promise<void> {
  if (isHydrationComplete) return;
  await initCloudPersistence();
}

/**
 * Runs pre-deployment and runtime database safety verification checks.
 */
export async function runPreDeploymentSafetyChecks(): Promise<DeploymentSafetyReport> {
  await ensureCloudPersistenceReady();

  const localInspection = inspectSqliteSnapshot(config.databasePath);
  let manifest: ManifestMetadata | null = null;
  let externalDbConnected = false;

  try {
    manifest = await fetchCloudManifest();
    externalDbConnected = isConnected;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    externalDbConnected = false;
  }

  const localScore = getBusinessRecordScore(localInspection.counts);
  const cloudScore = manifest ? getBusinessRecordScore(manifest.counts) : 0;

  // If cloud has data and local is empty or freshly created on boot, hydrate immediately before reporting
  if (externalDbConnected && cloudScore > 0 && (localScore === 0 || getWasDatabaseCreatedOnBoot())) {
    await restoreOrMergeFromCloud('deployment_safety_hydration');
  }

  const verifiedLocal = inspectSqliteSnapshot(config.databasePath);
  let migrationsCount = 0;
  try {
    const db = getDatabase();
    const migRow = db.prepare('SELECT COUNT(*) as c FROM database_migrations').get() as { c: number } | undefined;
    migrationsCount = Number(migRow?.c || 0);
  } catch {
    migrationsCount = 0;
  }
  const schemaCompatible = verifiedLocal.valid && migrationsCount >= 28;
  const safeToDeploy = externalDbConnected && schemaCompatible;

  return {
    safeToDeploy,
    checkedAt: new Date().toISOString(),
    externalDbConnected,
    externalDbLocation: EXTERNAL_DB_LOCATION,
    schemaCompatible,
    localIntegrityOk: verifiedLocal.valid,
    protectionLockActive: true,
    localCounts: verifiedLocal.counts,
    cloudCounts: manifest ? manifest.counts : null,
    cloudVersionSeq: manifest ? manifest.versionSeq : lastVersionSeq,
    message: safeToDeploy
      ? `Verified external Firestore database (${EXTERNAL_DB_LOCATION}) at version #${manifest ? manifest.versionSeq : lastVersionSeq} with ${migrationsCount} applied migrations. Existing business records are protected.`
      : `Database safety check failed: externalDbConnected=${externalDbConnected}, schemaCompatible=${schemaCompatible} (migrations=${migrationsCount}).${lastError ? ` Error: ${lastError}` : ''}`,
  };
}

/**
 * Pulls newer changes from Firestore if another instance or deployment updated the vault.
 */
export async function pullFromCloudPersistenceIfNewer(reason = 'periodic_check'): Promise<boolean> {
  try {
    const manifest = await fetchCloudManifest();
    if (!manifest) return false;

    if (manifest.versionSeq > lastVersionSeq && manifest.sha256Hash !== lastSha256) {
      return await restoreOrMergeFromCloud(reason);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Schedules a fast debounced upload (15ms) after any database mutation.
 */
export function scheduleCloudUpload(reason = 'mutation'): void {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
  }
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    void uploadLocalDbToCloud(reason);
  }, 15);
}

/**
 * Immediately synchronizes the active SQLite database to external Firestore storage.
 */
export async function syncDatabaseToCloudSQL(
  reason = 'manual_sync',
  options?: { forceOverwrite?: boolean }
): Promise<boolean> {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  return await uploadLocalDbToCloud(reason, options);
}

/**
 * Uploads a named backup file to external Firestore storage for off-container recovery.
 */
export async function uploadBackupToCloudSQL(params: {
  filename: string;
  filePath: string;
  backupType: string;
  notes: string;
  counts: Record<string, number>;
}): Promise<boolean> {
  try {
    if (!fs.existsSync(params.filePath)) return false;
    const rawBuffer = fs.readFileSync(params.filePath);
    const sha256Hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const compressed = zlib.gzipSync(rawBuffer, { level: 9 });
    const encrypted = encryptBuffer(compressed);

    // If backup fits in a single chunk, also store as named backup doc scoped to env
    if (encrypted.length <= MAX_CHUNK_CHARS) {
      const safeDocId = `${ENV_SCOPE_PREFIX}_bkp_${params.filename.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90)}`;
      await writeVaultDocument({
        vaultKey: VAULT_SERVER_KEY,
        docId: safeDocId,
        chunkIndex: 0,
        totalChunks: 1,
        versionSeq: Math.max(1, lastVersionSeq),
        sha256Hash,
        payload: encrypted,
        recordCounts: JSON.stringify(params.counts || {}),
        updatedByEnv: `backup:${params.backupType}`.slice(0, 110),
        updatedAt: new Date().toISOString(),
      });
    }
    return true;
  } catch (err) {
    console.warn('[AMS Cloud Persistence] Backup cloud mirror warning:', err);
    return false;
  }
}

/**
 * Restores a missing local backup file from Firestore if it was created in an earlier container.
 */
export async function ensureLocalBackupFileFromCloudSQL(
  filename: string,
  targetPath: string
): Promise<boolean> {
  try {
    if (fs.existsSync(targetPath)) return true;
    const safeDocId = `${ENV_SCOPE_PREFIX}_bkp_${filename.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90)}`;
    const doc = await readVaultDocument(safeDocId);
    if (!doc || !doc.payload) return false;

    const compressed = decryptToBuffer(doc.payload);
    const rawBuffer = zlib.gunzipSync(compressed);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, rawBuffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicitly updates cloud persistence state ONLY when Super Admin performs a confirmed Master Reset.
 */
export async function resetCloudPersistenceState(reason = 'master_reset'): Promise<void> {
  const db = getDatabase();
  bumpDbResetEpoch(db, reason);
  await uploadLocalDbToCloud(`authorized_${reason}`, { forceOverwrite: true });
}

/**
 * Express middleware that:
 * 1. Guarantees startup cloud hydration from Firestore has finished before any API route executes.
 * 2. Automatically schedules an immediate cloud snapshot upload after any successful write request.
 */
export async function cloudPersistenceMiddleware(
  req: { method?: string; path?: string; originalUrl?: string },
  res: { statusCode: number; on: (event: string, listener: () => void) => void },
  next: () => void
): Promise<void> {
  try {
    await ensureCloudPersistenceReady();
  } catch {
    // Proceed even if cloud check had a transient network warning
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const routeLabel = String(req.originalUrl || req.path || '').split('?')[0];
        // Skip login/logout session-only writes from triggering heavy snapshot if no data changed,
        // or still sync user updates safely
        if (routeLabel !== '/api/auth/logout') {
          scheduleCloudUpload(`http:${method}:${routeLabel}`);
        }
      }
    });
  }

  next();
}

/**
 * Non-destructively hydrates missing records from client IndexedDB / cloud record payloads into SQLite
 * using INSERT OR IGNORE and respecting sync_tombstones so deleted records are never resurrected.
 */
export function hydrateSqliteFromCloudRecords(
  rawItems: any[],
  rawInvoices: any[],
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

  try {
    const tombRows = db
      .prepare('SELECT table_name, record_id FROM sync_tombstones')
      .all() as Array<{ table_name: string; record_id: string }>;
    const tombSet = new Set(tombRows.map((t) => `${t.table_name}:${t.record_id}`));

    const tx = db.transaction(() => {
      // 1. Accounts / Parties
      const accounts = Array.isArray(extra?.accounts) ? extra!.accounts : [];
      for (const acc of accounts) {
        const id = Number(acc?.id || 0);
        if (id > 0 && tombSet.has(`accounts:${id}`)) continue;
        const code = String(acc?.account_code || '').trim();
        const name = String(acc?.account_name || '').trim();
        if (!code || !name) continue;

        const existing = db
          .prepare('SELECT id FROM accounts WHERE id = ? OR account_code = ? OR LOWER(account_name) = LOWER(?)')
          .get(id > 0 ? id : -1, code, name);
        if (existing) continue;

        const accGroup = String(acc.account_group || acc.account_type || 'Customer');
        const mainGroup =
          acc.main_group ||
          (['Cash in Hand', 'Bank', 'Assets', 'Liabilities', 'Loans', 'Capital', 'Drawings'].includes(accGroup)
            ? 'FINANCIAL ACCOUNTS'
            : ['Customer', 'Supplier', 'Customer & Supplier'].includes(accGroup)
            ? 'PARTY ACCOUNTS'
            : 'INCOME & EXPENSE ACCOUNTS');

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO accounts (
              id, account_code, account_name, main_group, account_group, parent_account_id,
              opening_balance, opening_balance_type, total_debit, total_credit,
              current_balance, current_balance_type, contact_person, phone, email,
              ntn_cnic, ntn, strn, filer_status, address, city, credit_limit,
              is_system_account, status, notes, account_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id > 0 && id < 1_000_000_000 ? id : null,
            code,
            name,
            mainGroup,
            accGroup,
            acc.parent_account_id || null,
            Number(acc.opening_balance || 0),
            String(acc.opening_balance_type || acc.balance_type || 'Debit'),
            Number(acc.total_debit || 0),
            Number(acc.total_credit || 0),
            Number(acc.current_balance ?? acc.opening_balance ?? 0),
            String(acc.current_balance_type || acc.balance_type || 'Debit'),
            acc.contact_person || null,
            acc.phone || acc.mobile || null,
            acc.email || null,
            acc.ntn_cnic || null,
            acc.ntn || null,
            acc.strn || null,
            acc.filer_status || 'Filer',
            acc.address || null,
            acc.city || null,
            Number(acc.credit_limit || 0),
            Number(acc.is_system_account || 0),
            String(acc.status || 'Active'),
            acc.notes || null,
            acc.account_type || accGroup
          );
        restoredAccounts += Number(res.changes || 0);
      }

      // 2. Items
      const items = Array.isArray(rawItems) ? rawItems : [];
      for (const item of items) {
        const id = Number(item?.id || 0);
        if (id > 0 && tombSet.has(`items:${id}`)) continue;
        const code = String(item?.item_code || '').trim();
        const name = String(item?.item_name || '').trim();
        if (!code || !name) continue;

        const existing = db
          .prepare('SELECT id FROM items WHERE id = ? OR item_code = ?')
          .get(id > 0 ? id : -1, code);
        if (existing) continue;

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO items (
              id, item_code, company_name, item_name, generic_name, category,
              packing, barcode, purchase_price, trade_price, wholesale_price,
              retail_price, discount_percent, tax_percent, opening_stock,
              minimum_stock, rack_number, status, loose_rate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id > 0 && id < 1_000_000_000 ? id : null,
            code,
            String(item.company_name || 'Standard Pharma'),
            name,
            item.generic_name || null,
            String(item.category || 'Tablet'),
            String(item.packing || '1x10'),
            item.barcode || null,
            Number(item.purchase_price || 0),
            Number(item.trade_price || 0),
            Number(item.wholesale_price || item.trade_price || 0),
            Number(item.retail_price || item.mrp || 0),
            Number(item.discount_percent || 0),
            Number(item.tax_percent || item.gst_percent || 0),
            Number(item.opening_stock || 0),
            Number(item.minimum_stock || item.minimum_stock_alert || 10),
            item.rack_number || item.rack_location || null,
            String(item.status || 'Active'),
            Number(item.loose_rate || item.loose_unit_price || 0)
          );
        restoredItems += Number(res.changes || 0);
      }

      // 3. Inventory Batches
      const batches = Array.isArray(extra?.inventory) ? extra!.inventory : [];
      for (const b of batches) {
        const id = Number(b?.id || 0);
        if (id > 0 && tombSet.has(`inventory:${id}`)) continue;
        const itemId = Number(b?.item_id || 0);
        if (itemId <= 0) continue;

        const existing = id > 0 ? db.prepare('SELECT id FROM inventory WHERE id = ?').get(id) : null;
        if (existing) continue;

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO inventory (
              id, item_id, batch_number, expiry_date, packing, units_per_pack,
              cost_price, trade_price, wholesale_price, retail_price,
              current_pack_qty, current_loose_qty, total_stock_units, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id > 0 && id < 1_000_000_000 ? id : null,
            itemId,
            String(b.batch_number || 'DEFAULT'),
            String(b.expiry_date || '2027-12-31'),
            String(b.packing || '1x10'),
            Math.max(1, Number(b.units_per_pack || 1)),
            Number(b.cost_price ?? b.purchase_price ?? 0),
            Number(b.trade_price || 0),
            Number(b.wholesale_price || b.trade_price || 0),
            Number(b.retail_price ?? b.mrp ?? 0),
            Number(b.current_pack_qty ?? b.pack_quantity ?? 0),
            Number(b.current_loose_qty ?? b.loose_units ?? 0),
            Number(b.total_stock_units ?? b.quantity_in_stock ?? 0),
            String(b.status || 'Active')
          );
        restoredInventory += Number(res.changes || 0);
      }

      // 4. Sales Invoices (non-destructive if missing)
      const salesList = Array.isArray(rawInvoices) ? rawInvoices : [];
      for (const s of salesList) {
        const id = Number(s?.server_id || s?.id || 0);
        if (id > 0 && tombSet.has(`sales:${id}`)) continue;
        const invNo = String(s?.invoice_number || '').trim();
        if (!invNo) continue;

        const existing = db
          .prepare('SELECT id FROM sales WHERE invoice_number = ? OR (client_request_id IS NOT NULL AND client_request_id = ?)')
          .get(invNo, String(s?.client_tx_id || s?.client_request_id || ''));
        if (existing) continue;

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO sales (
              invoice_number, invoice_date, customer_account_id, customer_name,
              invoice_type, payment_mode, gross_total, discount_amount,
              taxable_amount, gst_amount, tax_amount, net_total,
              paid_amount, balance_amount, status, remarks, client_request_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            invNo,
            String(s.invoice_date || new Date().toISOString().slice(0, 10)),
            s.customer_account_id || null,
            String(s.customer_name || 'Walk-in Cash Customer'),
            String(s.invoice_type || 'Cash'),
            String(s.payment_mode || 'Cash'),
            Number(s.gross_total || s.net_total || 0),
            Number(s.discount_amount || 0),
            Number(s.taxable_amount || s.net_total || 0),
            Number(s.gst_amount || 0),
            Number(s.tax_amount || 0),
            Number(s.net_total || 0),
            Number(s.paid_amount || 0),
            Number(s.balance_amount || 0),
            String(s.status || 'Completed'),
            s.remarks || null,
            s.client_tx_id || s.client_request_id || null
          );
        restoredInvoices += Number(res.changes || 0);
      }

      // 5. Purchases (non-destructive if missing)
      const purchaseList = Array.isArray(extra?.purchases) ? extra!.purchases : [];
      for (const p of purchaseList) {
        const id = Number(p?.server_id || p?.id || 0);
        if (id > 0 && tombSet.has(`purchases:${id}`)) continue;
        const billNo = String(p?.bill_number || p?.invoice_number || '').trim();
        if (!billNo) continue;

        const existing = db
          .prepare('SELECT id FROM purchases WHERE bill_number = ? OR (client_request_id IS NOT NULL AND client_request_id = ?)')
          .get(billNo, String(p?.client_tx_id || p?.client_request_id || ''));
        if (existing) continue;

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO purchases (
              bill_number, supplier_invoice_number, bill_date, supplier_account_id,
              gross_total, discount_amount, taxable_amount, gst_amount, tax_amount,
              net_total, paid_amount, remaining_balance, payment_mode, status, remarks, client_request_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            billNo,
            p.supplier_invoice_number || null,
            String(p.bill_date || new Date().toISOString().slice(0, 10)),
            p.supplier_account_id || 1,
            Number(p.gross_total || p.net_total || 0),
            Number(p.discount_amount || 0),
            Number(p.taxable_amount || p.net_total || 0),
            Number(p.gst_amount || 0),
            Number(p.tax_amount || 0),
            Number(p.net_total || 0),
            Number(p.paid_amount || 0),
            Number(p.remaining_balance || 0),
            String(p.payment_mode || 'Cash'),
            String(p.status || 'Completed'),
            p.remarks || null,
            p.client_tx_id || p.client_request_id || null
          );
        restoredPurchases += Number(res.changes || 0);
      }

      // 6. Cash Book Vouchers (non-destructive if missing)
      const voucherList = Array.isArray(extra?.cashBookVouchers) ? extra!.cashBookVouchers : [];
      for (const v of voucherList) {
        const id = Number(v?.server_id || v?.id || 0);
        if (id > 0 && tombSet.has(`cash_book_vouchers:${id}`)) continue;
        const vNo = String(v?.voucher_number || '').trim();
        if (!vNo) continue;

        const existing = db
          .prepare('SELECT id FROM cash_book_vouchers WHERE voucher_number = ?')
          .get(vNo);
        if (existing) continue;

        const res = db
          .prepare(
            `INSERT OR IGNORE INTO cash_book_vouchers (
              voucher_number, sequence_number, voucher_date, transaction_type,
              category, head_account_id, head_account_code, head_account_name,
              cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
              receipt_amount, payment_amount, net_amount, narration, status, client_tx_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            vNo,
            Number(v.sequence_number || 0),
            String(v.voucher_date || new Date().toISOString().slice(0, 10)),
            String(v.transaction_type || 'Receipt'),
            String(v.category || 'General'),
            v.head_account_id || null,
            v.head_account_code || null,
            v.head_account_name || null,
            v.cash_bank_account_id || null,
            v.cash_bank_account_code || null,
            v.cash_bank_account_name || null,
            Number(v.receipt_amount || 0),
            Number(v.payment_amount || 0),
            Number(v.net_amount || 0),
            v.narration || '',
            String(v.status || 'Posted'),
            v.client_tx_id || null
          );
        restoredVouchers += Number(res.changes || 0);
      }
    });

    tx();
  } catch (err) {
    console.warn('[AMS Cloud Persistence] hydrateSqliteFromCloudRecords warning:', err);
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

/**
 * Starts a background safety check loop that ensures any local changes are synced to Firestore.
 */
export function startCloudPersistenceBackgroundLoop(): void {
  if (backgroundInterval) return;
  backgroundInterval = setInterval(() => {
    void (async () => {
      if (!isHydrationComplete || isSyncInFlight) return;
      await pullFromCloudPersistenceIfNewer('background_poll');
    })();
  }, 30000);
}
