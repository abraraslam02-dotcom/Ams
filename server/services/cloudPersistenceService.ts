import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import { getPakistanDateISO, parseUtcTimestamp } from '../utils/pakistanTime.ts';
import {
  getDatabase,
  isDatabaseOpen,
  closeDatabaseConnection,
  reopenDatabaseConnection,
  syncRuntimeToSeedDatabase,
  getWasDatabaseCreatedOnBoot,
  getWasDatabaseQuarantinedOnBoot,
  markDatabaseHydratedFromCloud,
} from '../db/connection.ts';
import { runMigrations } from '../db/migrations.ts';
import { bumpDbResetEpoch } from '../db/resetState.ts';
import { reconcileHeldAndDuplicateLedgerEntries } from './ledgerIntegrityService.ts';
import { ensureAuthTables } from './authService.ts';
import {
  isOfflineOperatingMode,
  recordLocalPendingMutation,
  updatePersistedOperatingModeState,
} from './operatingModeStore.ts';

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
  connectionBlocked?: boolean;
  connectionError?: string | null;
  offlineWarning?: string | null;
  databaseIdentity?: string;
}

const VAULT_COLLECTION = 'ams_vault_e5f2831c';
const VAULT_SERVER_KEY = 'ams_srv_vault_e5f2831c_4daf_499d_a38b_45adc902ab45';
const MAX_CHUNK_CHARS = 650000; // Safely below Firestore 1 MiB document limit

const ENV_SCOPE_PREFIX = config.envScope === 'test' ? 'test' : 'prod';
const MANIFEST_DOC_ID = `${ENV_SCOPE_PREFIX}_manifest`;

const FIRESTORE_PROJECT_ID = String(firebaseConfig.projectId || 'chromatic-concord-0pz3c');
const FIRESTORE_DATABASE_ID = String(
  firebaseConfig.firestoreDatabaseId ||
    'ai-studio-abrarmedicalstor-e5f2831c-4daf-499d-a38b-45adc902ab45'
);
const FIRESTORE_API_KEY = String(firebaseConfig.apiKey || '');

const EXTERNAL_DB_LOCATION = `projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${VAULT_COLLECTION} [${ENV_SCOPE_PREFIX.toUpperCase()}: ${MANIFEST_DOC_ID}]`;

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
let readCooldownUntil = 0;
let writeCooldownUntil = 0;
let lastManifestFetchAt = 0;
let cachedManifest: ManifestMetadata | null = null;
let dbConnectionBlocked = false;
let dbConnectionErrorMessage: string | null = null;
let lastReconnectAttemptAt = 0;
let hasHydratedFromCloudThisProcess = false;
let hasLocalMutationsSinceBoot = false;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeLocalSqliteSha256(): string | null {
  if (getWasDatabaseQuarantinedOnBoot()) {
    return null;
  }
  const dataDir = path.dirname(config.databasePath);
  const tempPath = path.join(dataDir, `ams_hash_chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`);
  try {
    const db = getDatabase();
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }
    try {
      const escaped = tempPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}';`);
    } catch {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // ignore
      }
      if (!fs.existsSync(config.databasePath)) return null;
      fs.copyFileSync(config.databasePath, tempPath);
    }
    const buf = fs.readFileSync(tempPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

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

type VaultReadResult =
  | { status: 'found'; doc: VaultDocFields }
  | { status: 'not_found' }
  | { status: 'unreachable'; error: string };

async function readVaultDocumentDetailed(docId: string): Promise<VaultReadResult> {
  if (!FIRESTORE_API_KEY || !FIRESTORE_PROJECT_ID || !FIRESTORE_DATABASE_ID) {
    isConnected = false;
    return { status: 'unreachable', error: 'Cloud database configuration is missing.' };
  }
  if (Date.now() < readCooldownUntil) {
    isConnected = false;
    return {
      status: 'unreachable',
      error:
        lastError ||
        'Active database read temporarily rate-limited (HTTP 429). Retrying automatically to the same database.',
    };
  }
  const url = buildFirestoreDocUrl(docId);
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });

      if (response.status === 404) {
        isConnected = true;
        readCooldownUntil = 0;
        return { status: 'not_found' };
      }

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const isDailyQuota = /quota exceeded/i.test(errText);
        if (!isDailyQuota && attempt < maxAttempts) {
          await sleepMs(750 * attempt);
          continue;
        }
        readCooldownUntil = Date.now() + (isDailyQuota ? 5 * 60 * 1000 : 15 * 1000);
        isConnected = false;
        const msg = isDailyQuota
          ? `Firestore daily read quota exceeded. Quota resets tomorrow (upgrade console: https://console.firebase.google.com/project/${FIRESTORE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true).`
          : 'Active database connection temporarily rate-limited (HTTP 429). Retrying automatically.';
        lastError = msg;
        return { status: 'unreachable', error: msg };
      }

      if (response.status >= 500 && attempt < maxAttempts) {
        await sleepMs(600 * attempt);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        isConnected = false;
        const msg = `Firestore GET ${docId} failed (${response.status}): ${errText.slice(0, 240)}`;
        lastError = msg;
        return { status: 'unreachable', error: msg };
      }

      isConnected = true;
      readCooldownUntil = 0;
      const json = (await response.json()) as {
        fields?: Record<string, { stringValue?: string; integerValue?: string }>;
      };
      const f = json.fields || {};
      return {
        status: 'found',
        doc: {
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
        },
      };
    } catch (err: unknown) {
      if (attempt < maxAttempts) {
        await sleepMs(500 * attempt);
        continue;
      }
      isConnected = false;
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      return { status: 'unreachable', error: msg };
    }
  }
  return { status: 'unreachable', error: lastError || 'Unable to read Firestore document.' };
}

async function readVaultDocument(docId: string): Promise<VaultDocFields | null> {
  const result = await readVaultDocumentDetailed(docId);
  if (result.status === 'found') return result.doc;
  if (result.status === 'not_found') return null;
  throw new Error(result.error);
}

async function writeVaultDocument(doc: VaultDocFields): Promise<boolean> {
  if (Date.now() < writeCooldownUntil) {
    lastError = 'Cloud database write temporarily cooling down after rate limit (HTTP 429). Please retry shortly.';
    return false;
  }
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
  const serializedBody = JSON.stringify(body);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serializedBody,
        signal: AbortSignal.timeout(25000),
      });

      if (response.status === 429) {
        const errText = await response.text().catch(() => '');
        const isDailyQuota = /quota exceeded/i.test(errText);
        if (!isDailyQuota && attempt < maxAttempts) {
          await sleepMs(1200 * attempt);
          continue;
        }
        writeCooldownUntil = Date.now() + (isDailyQuota ? 10 * 60 * 1000 : 60 * 1000);
        lastError = isDailyQuota
          ? 'Firestore daily write quota exceeded. Local database remains active and protected.'
          : 'Cloud database temporarily rate-limited (HTTP 429). Please retry in a moment.';
        if (isDailyQuota) {
          console.warn(
            `[AMS Cloud Persistence] Firestore write quota exceeded; local database remains active & protected.`
          );
        }
        return false;
      }

      if (response.status >= 500 && attempt < maxAttempts) {
        await sleepMs(800 * attempt);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          `Firestore PATCH ${doc.docId} failed (${response.status}): ${errText.slice(0, 240)}`
        );
      }
      isConnected = true;
      writeCooldownUntil = 0;
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isHttpClientError = /failed \(4\d\d\)/.test(msg);
      if (!isHttpClientError && attempt < maxAttempts) {
        await sleepMs(800 * attempt);
        continue;
      }
      throw err;
    }
  }
  return false;
}

/**
 * Inspects a SQLite file on disk and returns detailed record counts and validity.
 */
function inspectOpenSqliteHandle(dbHandle: Database.Database, emptyCounts: CloudRecordCounts): {
  valid: boolean;
  counts: CloudRecordCounts;
} {
  const integrity = String(dbHandle.pragma('integrity_check', { simple: true }) || '');
  if (integrity.toLowerCase() !== 'ok') {
    return { valid: false, counts: emptyCounts };
  }

  const tables = dbHandle
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableSet = new Set(tables.map((t) => t.name));
  const required = ['items', 'accounts', 'sales', 'purchases', 'inventory'];
  if (required.some((r) => !tableSet.has(r))) {
    return { valid: false, counts: emptyCounts };
  }

  const countTable = (name: string): number => {
    if (!tableSet.has(name)) return 0;
    const row = dbHandle.prepare(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt: number };
    return Number(row?.cnt || 0);
  };

  let customAccounts = 0;
  try {
    const caRow = dbHandle
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
}

function inspectSqliteSnapshot(
  filePath: string,
  options?: { immutable?: boolean }
): {
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

  // If inspecting the currently active live database file while our primary connection is open,
  // inspect through the open WAL-safe handle directly instead of opening a competing readonly handle.
  const isActiveLiveDb = path.resolve(filePath) === path.resolve(config.databasePath);
  if (isActiveLiveDb && isDatabaseOpen()) {
    try {
      const liveDb = getDatabase();
      return inspectOpenSqliteHandle(liveDb, emptyCounts);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[AMS Cloud Persistence] inspectSqliteSnapshot (live handle) failed for ${path.basename(filePath)}: ${errMsg}`);
      return { valid: false, counts: emptyCounts };
    }
  }

  const walSidecarPath = `${filePath}-wal`;
  const shmSidecarPath = `${filePath}-shm`;
  const hadWalBefore = fs.existsSync(walSidecarPath);
  const hadShmBefore = fs.existsSync(shmSidecarPath);

  let tempDb: Database.Database | null = null;
  try {
    // If uncheckpointed WAL exists on a closed DB file, SQLite readonly mode cannot run WAL recovery.
    // Open read-write only when not marked immutable and a WAL sidecar is present; otherwise readonly.
    const shouldOpenReadOnly = Boolean(options?.immutable) || !hadWalBefore;
    tempDb = new Database(filePath, { readonly: shouldOpenReadOnly, fileMustExist: true });
    tempDb.pragma('busy_timeout = 5000');
    return inspectOpenSqliteHandle(tempDb, emptyCounts);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[AMS Cloud Persistence] inspectSqliteSnapshot failed for ${path.basename(filePath)}: ${errMsg}`);
    return { valid: false, counts: emptyCounts };
  } finally {
    if (tempDb) {
      try {
        tempDb.close();
      } catch {
        // ignore
      }
    }
    if (!hadWalBefore && !hadShmBefore) {
      try {
        if (fs.existsSync(walSidecarPath) && fs.statSync(walSidecarPath).size === 0) {
          fs.unlinkSync(walSidecarPath);
        }
        if (fs.existsSync(shmSidecarPath) && (!fs.existsSync(walSidecarPath) || fs.statSync(walSidecarPath).size === 0)) {
          fs.unlinkSync(shmSidecarPath);
        }
      } catch {
        // ignore sidecar cleanup warning
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
  const offlineMode = isOfflineOperatingMode();
  return {
    enabled: Boolean(FIRESTORE_PROJECT_ID && FIRESTORE_DATABASE_ID && FIRESTORE_API_KEY),
    connected: offlineMode ? false : isConnected,
    provider: 'firestore-enterprise-vault',
    externalLocation: EXTERNAL_DB_LOCATION,
    projectId: FIRESTORE_PROJECT_ID,
    databaseId: FIRESTORE_DATABASE_ID,
    collectionPath: `/${VAULT_COLLECTION}`,
    initialized: isInitialized,
    hydrationComplete: offlineMode ? true : isHydrationComplete,
    lastSyncAt,
    lastRestoreAt,
    lastVersionSeq,
    lastSha256,
    lastError: offlineMode ? null : lastError,
    cloudRecordCounts,
    localRecordCounts: localInspect.counts as unknown as Record<string, number>,
    protectionLockActive: true,
    connectionBlocked: offlineMode ? false : dbConnectionBlocked,
    connectionError: offlineMode ? null : dbConnectionErrorMessage,
    offlineWarning: offlineMode
      ? null
      : !isConnected
      ? lastError ||
        'Cloud database server is unreachable. Existing local data remains safe and unchanged without switching or resetting.'
      : null,
    databaseIdentity: EXTERNAL_DB_LOCATION,
  };
}

type ManifestFetchResult =
  | { status: 'found'; manifest: ManifestMetadata }
  | { status: 'not_found' }
  | { status: 'unreachable'; error: string };

/**
 * Fetches and parses the current environment's cloud manifest from Firestore with strict reachability tracking.
 * Never returns stale cachedManifest as a live result when network is unreachable.
 */
async function fetchCloudManifestDetailed(): Promise<ManifestFetchResult> {
  const docResult = await readVaultDocumentDetailed(MANIFEST_DOC_ID);
  if (docResult.status === 'unreachable') {
    return { status: 'unreachable', error: docResult.error };
  }
  if (docResult.status === 'not_found') {
    return { status: 'not_found' };
  }
  const doc = docResult.doc;
  if (!doc.payload) {
    return { status: 'not_found' };
  }
  try {
    const decrypted = decryptToBuffer(doc.payload);
    const meta = JSON.parse(decrypted.toString('utf8')) as ManifestMetadata;
    const parsed: ManifestMetadata = {
      ...meta,
      versionSeq: Number(doc.versionSeq || meta.versionSeq || 1),
      sha256Hash: String(doc.sha256Hash || meta.sha256Hash || ''),
    };
    cachedManifest = parsed;
    lastManifestFetchAt = Date.now();
    return { status: 'found', manifest: parsed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'unreachable', error: `Manifest decrypt/parse failed: ${msg}` };
  }
}

async function fetchCloudManifest(): Promise<ManifestMetadata | null> {
  const result = await fetchCloudManifestDetailed();
  if (result.status === 'found') return result.manifest;
  if (result.status === 'not_found') return null;
  throw new Error(result.error);
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
        'item_companies',
        'towns',
        'town_areas',
        'accounts',
        'items',
        'product_images',
        'item_variants',
        'item_variant_barcodes',
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

        // Reconcile custom account balances and city where cloud has newer normalized UTC updated_at
        const normCloudTs = "REPLACE(REPLACE(SUBSTR(COALESCE(c.updated_at, ''), 1, 19), 'T', ' '), 'Z', '')";
        if (localTables.has('accounts') && cloudTables.has('accounts')) {
          const normMainAccTs = "REPLACE(REPLACE(SUBSTR(COALESCE(main.accounts.updated_at, ''), 1, 19), 'T', ' '), 'Z', '')";
          db.prepare(
            `UPDATE main.accounts
             SET current_balance = COALESCE(
                   (SELECT c.current_balance FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND ${normCloudTs} > ${normMainAccTs}),
                   main.accounts.current_balance
                 ),
                 total_debit = COALESCE(
                   (SELECT c.total_debit FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND ${normCloudTs} > ${normMainAccTs}),
                   main.accounts.total_debit
                 ),
                 total_credit = COALESCE(
                   (SELECT c.total_credit FROM cloud_snap.accounts c WHERE c.id = main.accounts.id AND ${normCloudTs} > ${normMainAccTs}),
                   main.accounts.total_credit
                 ),
                 city = COALESCE(
                   NULLIF(main.accounts.city, ''),
                   (SELECT c.city FROM cloud_snap.accounts c WHERE c.id = main.accounts.id)
                 )`
          ).run();
        }

        // Reconcile inventory stock where cloud has newer normalized UTC updated_at
        if (localTables.has('inventory') && cloudTables.has('inventory')) {
          const normMainInvTs = "REPLACE(REPLACE(SUBSTR(COALESCE(main.inventory.updated_at, ''), 1, 19), 'T', ' '), 'Z', '')";
          db.prepare(
            `UPDATE main.inventory
             SET current_pack_qty = COALESCE(
                   (SELECT c.current_pack_qty FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND ${normCloudTs} > ${normMainInvTs}),
                   main.inventory.current_pack_qty
                 ),
                 current_loose_qty = COALESCE(
                   (SELECT c.current_loose_qty FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND ${normCloudTs} > ${normMainInvTs}),
                   main.inventory.current_loose_qty
                 ),
                 total_stock_units = COALESCE(
                   (SELECT c.total_stock_units FROM cloud_snap.inventory c WHERE c.id = main.inventory.id AND ${normCloudTs} > ${normMainInvTs}),
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
      reconcileHeldAndDuplicateLedgerEntries();
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

    const stagedInspect = inspectSqliteSnapshot(stagedCloudPath, { immutable: true });
    if (!stagedInspect.valid) {
      try {
        fs.unlinkSync(stagedCloudPath);
      } catch {
        // ignore
      }
      throw new Error('Downloaded cloud SQLite database failed PRAGMA integrity_check.');
    }

    try {
      const freshlyBootedContainerDb = getWasDatabaseCreatedOnBoot() || getWasDatabaseQuarantinedOnBoot();
      const shouldAuthoritativelyRestoreFromVault =
        config.envScope !== 'test' &&
        !hasHydratedFromCloudThisProcess &&
        !hasLocalMutationsSinceBoot &&
        cloudScore > 0;

      if ((localScore === 0 || freshlyBootedContainerDb || shouldAuthoritativelyRestoreFromVault) && cloudScore > 0) {
        // Checkpoint and close active connection FIRST so any WAL frames are flushed cleanly before safety snapshot
        closeDatabaseConnection();

        const backupDir = path.join(dataDir, 'backups');
        const quarantineDir = path.join(dataDir, 'quarantine');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        if (fs.existsSync(config.databasePath)) {
          const postCloseInspect = inspectSqliteSnapshot(config.databasePath);
          const postCloseScore = getBusinessRecordScore(postCloseInspect.counts);
          if (postCloseInspect.valid && postCloseScore > 0) {
            const preHydrateSafetyPath = path.join(
              backupDir,
              `Pre_CloudHydrate_${Date.now()}.db`
            );
            try {
              fs.copyFileSync(config.databasePath, preHydrateSafetyPath);
            } catch {
              // ignore non-critical safety copy warning
            }
          } else if (!postCloseInspect.valid && fs.statSync(config.databasePath).size >= 4096) {
            try {
              if (!fs.existsSync(quarantineDir)) {
                fs.mkdirSync(quarantineDir, { recursive: true });
              }
              fs.copyFileSync(
                config.databasePath,
                path.join(quarantineDir, `Pre_CloudHydrate_Corrupt_${Date.now()}.db`)
              );
            } catch {
              // ignore non-critical quarantine copy warning
            }
          }
        }

        const walPath = `${config.databasePath}-wal`;
        const shmPath = `${config.databasePath}-shm`;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

        const atomicRestoreTmp = `${config.databasePath}.hydrate_${Date.now()}.tmp`;
        fs.copyFileSync(stagedCloudPath, atomicRestoreTmp);
        fs.renameSync(atomicRestoreTmp, config.databasePath);

        const restoredDb = reopenDatabaseConnection();
        runMigrations();
        ensureAuthTables(restoredDb);
        reconcileHeldAndDuplicateLedgerEntries();
        if (config.envScope === 'development') {
          syncRuntimeToSeedDatabase();
        }
        markDatabaseHydratedFromCloud();
        hasHydratedFromCloudThisProcess = true;

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
      hasHydratedFromCloudThisProcess = true;
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
  options?: {
    forceOverwrite?: boolean;
    bypassOfflineGuard?: boolean;
    allowVerifiedPostMergeSync?: boolean;
  }
): Promise<boolean> {
  const isManualExplicitTrigger = Boolean(options?.bypassOfflineGuard || options?.allowVerifiedPostMergeSync);

  // Strict Offline Mode guard: never make Cloud DB requests in OFFLINE mode unless explicitly triggered by manual Backup & Sync
  if (isOfflineOperatingMode() && !options?.bypassOfflineGuard) {
    return false;
  }

  // Safety guard: never allow an un-hydrated server process to overwrite the live Firestore vault
  // before verifying/hydrating against Firestore first.
  if (
    config.envScope !== 'test' &&
    !hasHydratedFromCloudThisProcess &&
    !options?.forceOverwrite &&
    !options?.bypassOfflineGuard &&
    reason !== 'initial_vault_bootstrap'
  ) {
    console.warn(
      `[AMS Cloud Persistence] Blocked pre-hydration upload (${reason}); hydrating from live Firestore vault first.`
    );
    await syncOrBlockAgainstCurrentDatabase(`pre_upload_hydrate:${reason}`);
    if (!hasHydratedFromCloudThisProcess) {
      return false;
    }
  }

  if (isSyncInFlight) {
    if (isManualExplicitTrigger) {
      // Wait cleanly up to 15s for any background/online upload to finish rather than immediately failing manual sync
      const waitDeadline = Date.now() + 15000;
      while (isSyncInFlight && Date.now() < waitDeadline) {
        await sleepMs(250);
      }
    }
    if (isSyncInFlight) {
      pendingUploadAfterInFlight = true;
      pendingUploadReason = reason;
      if (isManualExplicitTrigger) {
        lastError = 'Another Cloud Database upload is currently in progress. Please retry in a few seconds.';
      }
      return false;
    }
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
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // ignore
      }
      fs.copyFileSync(config.databasePath, tempSnapPath);
    }

    const localInspection = inspectSqliteSnapshot(tempSnapPath, { immutable: true });
    if (!localInspection.valid) {
      throw new Error('Local SQLite snapshot failed integrity verification before cloud upload.');
    }

    // Always keep the local persistent seed mirror up to date in development mode immediately
    if (config.envScope === 'development') {
      syncRuntimeToSeedDatabase();
    }

    const initialRawBuffer = fs.readFileSync(tempSnapPath);
    const initialSha256 = crypto.createHash('sha256').update(initialRawBuffer).digest('hex');

    // Fast path for background ONLINE uploads only: skip network if binary hash already matches
    if (
      !isManualExplicitTrigger &&
      lastSha256 &&
      lastSha256 === initialSha256 &&
      !options?.forceOverwrite
    ) {
      return true;
    }

    // If Firestore write quota cooldown is active
    if (Date.now() < writeCooldownUntil) {
      if (isManualExplicitTrigger) {
        lastError =
          lastError ||
          'Cloud database write is temporarily rate-limited (HTTP 429). Please retry in a minute.';
        return false;
      }
      lastSha256 = initialSha256;
      lastSyncAt = new Date().toISOString();
      cloudRecordCounts = localInspection.counts as unknown as Record<string, number>;
      return true;
    }

    // 2. Check existing cloud manifest BEFORE uploading (always fetch fresh on manual trigger / forceOverwrite)
    let existingManifest =
      cachedManifest &&
      Date.now() - lastManifestFetchAt < 25000 &&
      !options?.forceOverwrite &&
      !isManualExplicitTrigger
        ? cachedManifest
        : await fetchCloudManifest();
    const localScore = getBusinessRecordScore(localInspection.counts);
    const cloudScore = existingManifest ? getBusinessRecordScore(existingManifest.counts) : 0;

    if (existingManifest && !options?.forceOverwrite) {
      // CRITICAL PROTECTION #1: Never let an empty container database overwrite a non-empty cloud database!
      if (cloudScore > 0 && localScore === 0) {
        lastError = `Safety lock blocked upload: local database has 0 business records while Cloud Database has ${cloudScore} record(s).`;
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

      // CRITICAL PROTECTION #2: If cloud has more business records than local across ANY core table
      // without new local tombstones, merge cloud records into local FIRST so no records from cloud are ever lost!
      const localTombstones = Number(localInspection.counts.tombstonesTotal || 0);
      const cloudTombstones = Number(existingManifest.counts?.tombstonesTotal || 0);
      const coreCountKeys: Array<keyof CloudRecordCounts> = [
        'items',
        'accounts',
        'customAccounts',
        'purchases',
        'sales',
        'inventoryBatches',
        'journalEntries',
        'cashBookEntries',
        'users',
        'saleReturns',
        'purchaseReturns',
        'supplySheets',
      ];
      const hasMissingCloudItems = coreCountKeys.some(
        (k) => Number(existingManifest?.counts?.[k] || 0) > Number(localInspection.counts[k] || 0)
      );

      if (
        hasMissingCloudItems &&
        !options?.allowVerifiedPostMergeSync &&
        localTombstones <= cloudTombstones &&
        Date.now() >= readCooldownUntil
      ) {
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

    const finalInspection = inspectSqliteSnapshot(tempSnapPath, { immutable: true });
    if (!finalInspection.valid) {
      throw new Error('Final SQLite snapshot failed integrity verification before cloud upload.');
    }

    // CRITICAL PROTECTION #3: Even after pre-upload reconcile, NEVER overwrite a larger cloud vault
    // with fewer core records unless explicit forceOverwrite, verified post-merge sync (with non-empty local), or matching tombstones exist.
    if (existingManifest && !options?.forceOverwrite && !options?.allowVerifiedPostMergeSync) {
      const finalTombstones = Number(finalInspection.counts.tombstonesTotal || 0);
      const cloudTombstones = Number(existingManifest.counts?.tombstonesTotal || 0);
      const guardedKeys: Array<keyof CloudRecordCounts> = [
        'items',
        'accounts',
        'customAccounts',
        'purchases',
        'sales',
        'inventoryBatches',
        'journalEntries',
        'cashBookEntries',
        'users',
      ];
      const shrunkTables = guardedKeys.filter(
        (k) => Number(finalInspection.counts[k] || 0) < Number(existingManifest?.counts?.[k] || 0)
      );
      if (shrunkTables.length > 0 && finalTombstones <= cloudTombstones) {
        const details = shrunkTables
          .map(
            (k) =>
              `${k} (local=${Number(finalInspection.counts[k] || 0)} < cloud=${Number(
                existingManifest?.counts?.[k] || 0
              )})`
          )
          .join(', ');
        lastError = `Safety lock blocked upload because local table(s) have fewer records than Cloud Database without deletion tombstones: ${details}.`;
        console.warn(
          `[AMS Cloud Persistence] SAFETY LOCK ENGAGED: Blocked upload (${reason}) because local table(s) [${details}] have fewer records than cloud vault without tombstones.`
        );
        return false;
      }
    }

    const rawBuffer = fs.readFileSync(tempSnapPath);
    const sha256Hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    if (
      existingManifest &&
      existingManifest.sha256Hash === sha256Hash &&
      !options?.forceOverwrite
    ) {
      lastSha256 = sha256Hash;
      lastVersionSeq = Math.max(lastVersionSeq, existingManifest.versionSeq || 0);
      lastSyncAt = new Date().toISOString();
      lastError = null;
      cloudRecordCounts = finalInspection.counts as unknown as Record<string, number>;
      return true;
    }

    // 3. Compress & AES-256-GCM encrypt the SQLite binary
    const compressedBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
    const encryptedString = encryptBuffer(compressedBuffer);

    const totalChunks = Math.max(1, Math.ceil(encryptedString.length / MAX_CHUNK_CHARS));
    const countsJson = JSON.stringify(finalInspection.counts);
    const envLabel = `${config.nodeEnv}:${reason}`.slice(0, 110);

    // 4 & 5. Write chunks + commit atomic manifest, retrying once on HTTP 403 versionSeq race
    let committedVersionSeq = 0;
    let committedTargetSlot: 'slot0' | 'slot1' = 'slot0';
    let committedNowIso = new Date().toISOString();
    let manifestOk = false;

    for (let versionAttempt = 1; versionAttempt <= 2; versionAttempt++) {
      const nextVersionSeq = Math.max(
        1,
        lastVersionSeq + 1,
        (existingManifest?.versionSeq || 0) + 1
      );
      const targetSlot: 'slot0' | 'slot1' = nextVersionSeq % 2 === 0 ? 'slot0' : 'slot1';
      const nowIso = new Date().toISOString();
      committedVersionSeq = nextVersionSeq;
      committedTargetSlot = targetSlot;
      committedNowIso = nowIso;

      try {
        // Write all chunks to targetSlot FIRST (leaving previous slot untouched until manifest commits)
        for (let i = 0; i < totalChunks; i++) {
          const slice = encryptedString.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS);
          const chunkOk = await writeVaultDocument({
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
          if (!chunkOk) {
            if (isManualExplicitTrigger) {
              lastError =
                lastError ||
                `Cloud upload could not write chunk ${i + 1}/${totalChunks} due to Firestore write rate limit.`;
              return false;
            }
            // Background online mode: quota cooldown activated gracefully; local SQLite is saved
            lastSha256 = sha256Hash;
            lastSyncAt = nowIso;
            cloudRecordCounts = finalInspection.counts as unknown as Record<string, number>;
            return true;
          }
        }

        // Commit the atomic manifest pointing to targetSlot
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

        manifestOk = await writeVaultDocument({
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

        if (!manifestOk) {
          if (isManualExplicitTrigger) {
            lastError =
              lastError || 'Cloud upload could not commit manifest due to Firestore write rate limit.';
            return false;
          }
        } else {
          cachedManifest = manifestMeta;
          lastManifestFetchAt = Date.now();
          lastVersionSeq = nextVersionSeq;
        }
        break;
      } catch (writeErr: unknown) {
        const writeMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        // If another terminal bumped versionSeq concurrently, Firestore returns HTTP 403 -> refresh manifest & retry once
        if (versionAttempt === 1 && /failed \(403\)/.test(writeMsg)) {
          const fresh = await fetchCloudManifest().catch(() => null);
          if (fresh && fresh.versionSeq >= nextVersionSeq) {
            existingManifest = fresh;
            lastVersionSeq = Math.max(lastVersionSeq, fresh.versionSeq);
            continue;
          }
        }
        throw writeErr;
      }
    }

    if (manifestOk) {
      console.log(
        `[AMS Cloud Persistence] Synced production DB to Firestore (${reason}) -> v${committedVersionSeq} (${committedTargetSlot}, ${totalChunks} chunk(s), ${compressedBuffer.length}B gz):`,
        finalInspection.counts
      );
      if (!isOfflineOperatingMode()) {
        updatePersistedOperatingModeState({
          cloudSyncStatus: 'Successful',
          lastSuccessfulCloudSyncAt: committedNowIso,
          lastCloudSyncError: null,
        });
      }
    }

    lastSha256 = sha256Hash;
    lastSyncAt = committedNowIso;
    lastError = null;
    cloudRecordCounts = finalInspection.counts as unknown as Record<string, number>;

    return true;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[AMS Cloud Persistence] Upload deferred (${reason}): ${lastError}`);
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

    if (pendingUploadAfterInFlight && Date.now() >= writeCooldownUntil) {
      pendingUploadAfterInFlight = false;
      const nextReason = pendingUploadReason;
      setTimeout(() => {
        void uploadLocalDbToCloud(nextReason);
      }, 3000);
    } else {
      pendingUploadAfterInFlight = false;
    }
  }
}

async function syncOrBlockAgainstCurrentDatabase(reason: string): Promise<void> {
  isInitialized = true;
  const manifestRes = await fetchCloudManifestDetailed();
  const localInspect = inspectSqliteSnapshot(config.databasePath);
  const localScore = getBusinessRecordScore(localInspect.counts);

  if (manifestRes.status === 'unreachable') {
    isConnected = false;
    lastError = manifestRes.error;
    // Never fall back to an empty, backup, seed, or stale container-bundled database when active remote vault is unreachable on boot!
    const unhydratedProdContainer =
      config.envScope === 'production' && !hasHydratedFromCloudThisProcess;
    if (localScore === 0 || getWasDatabaseCreatedOnBoot() || getWasDatabaseQuarantinedOnBoot() || unhydratedProdContainer) {
      dbConnectionBlocked = true;
      dbConnectionErrorMessage = `Cannot reach the current active database (${EXTERNAL_DB_LOCATION}): ${manifestRes.error}. Database switching is disabled to protect your data. Restore network and reconnect to resume using the same database.`;
    } else {
      // Existing verified local active database already hydrated for this container — keep using THIS database without switching
      dbConnectionBlocked = false;
      dbConnectionErrorMessage = null;
      lastError = `Offline protection active: cloud server unreachable (${manifestRes.error}). Keeping existing local data intact without initializing an empty or old database.`;
    }
    console.warn(`[AMS Offline Protection] Active database check (${reason}) unreachable: ${manifestRes.error}`);
    return;
  }

  dbConnectionBlocked = false;
  dbConnectionErrorMessage = null;

  if (manifestRes.status === 'found') {
    const manifest = manifestRes.manifest;
    cloudRecordCounts = manifest.counts as unknown as Record<string, number>;
    const cloudScore = getBusinessRecordScore(manifest.counts);

    console.log(
      `[AMS Cloud Persistence] Startup check (${reason}) — External Firestore v${manifest.versionSeq} (score=${cloudScore}) vs Local DB (score=${localScore})`
    );

    // Fast SHA-256 verification: if local active DB already matches cloud hash byte-for-byte, skip downloading chunks
    const localHash =
      !getWasDatabaseCreatedOnBoot() && !getWasDatabaseQuarantinedOnBoot() && localScore > 0
        ? computeLocalSqliteSha256()
        : null;
    if (localHash && manifest.sha256Hash && localHash === manifest.sha256Hash) {
      hasHydratedFromCloudThisProcess = true;
      lastVersionSeq = manifest.versionSeq;
      lastSha256 = manifest.sha256Hash;
      lastError = null;
      return;
    }

    if (cloudScore > 0 || manifest.versionSeq > lastVersionSeq) {
      const restored = await restoreOrMergeFromCloud(reason);
      if (
        !restored &&
        !hasHydratedFromCloudThisProcess &&
        cloudScore > 0 &&
        (config.envScope === 'production' ||
          localScore === 0 ||
          getWasDatabaseCreatedOnBoot() ||
          getWasDatabaseQuarantinedOnBoot())
      ) {
        // Downloading/verifying authoritative production chunks failed — block serving stale/empty file & auto-retry
        dbConnectionBlocked = true;
        dbConnectionErrorMessage = `Failed to load latest production database v${manifest.versionSeq} from ${EXTERNAL_DB_LOCATION}${lastError ? `: ${lastError}` : ''}. Retrying automatically so stale data is never shown.`;
        return;
      }
    } else {
      hasHydratedFromCloudThisProcess = true;
    }

    const afterInspect = inspectSqliteSnapshot(config.databasePath);
    const afterScore = getBusinessRecordScore(afterInspect.counts);
    if (
      afterScore > cloudScore &&
      (config.envScope !== 'production' || hasLocalMutationsSinceBoot)
    ) {
      await uploadLocalDbToCloud(`${reason}_superset_sync`);
    } else if (hasHydratedFromCloudThisProcess) {
      lastVersionSeq = manifest.versionSeq;
      lastSha256 = manifest.sha256Hash;
    }
    lastError = null;
  } else {
    // Confirmed HTTP 404 — brand-new vault for this environment. Never overwrite any existing cloud DB.
    console.log(
      `[AMS Cloud Persistence] Confirmed new Firestore vault (${MANIFEST_DOC_ID}). Initializing with current ${config.envScope} database...`
    );
    hasHydratedFromCloudThisProcess = true;
    await uploadLocalDbToCloud('initial_vault_bootstrap');
    lastError = null;
  }
}

/**
 * Initializes permanent external cloud persistence on server boot.
 * Safe to call multiple times; returns the same initialization promise.
 */
export async function initCloudPersistence(): Promise<void> {
  if (isOfflineOperatingMode()) {
    isInitialized = true;
    isHydrationComplete = true;
    dbConnectionBlocked = false;
    dbConnectionErrorMessage = null;
    console.log(
      '[AMS Cloud Persistence] OFFLINE MODE active — using permanent local SQLite database with zero Cloud DB requests.'
    );
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await syncOrBlockAgainstCurrentDatabase('startup_hydration');
    } catch (err: unknown) {
      isConnected = false;
      lastError = err instanceof Error ? err.message : String(err);
      const localInspect = inspectSqliteSnapshot(config.databasePath);
      if (
        getBusinessRecordScore(localInspect.counts) === 0 ||
        getWasDatabaseCreatedOnBoot() ||
        getWasDatabaseQuarantinedOnBoot()
      ) {
        dbConnectionBlocked = true;
        dbConnectionErrorMessage = `Cannot reach the current active database (${EXTERNAL_DB_LOCATION}): ${lastError}. Reconnect to resume using the same database.`;
      }
      console.error('[AMS Cloud Persistence] Initialization error:', lastError);
    } finally {
      isHydrationComplete = true;
    }
  })();

  return initPromise;
}

/**
 * Reconnects explicitly to the SAME current active database once network returns.
 */
export async function reconnectToCurrentDatabase(force = true): Promise<{
  connected: boolean;
  blocked: boolean;
  error: string | null;
  status: CloudPersistenceStatus;
}> {
  if (isOfflineOperatingMode()) {
    dbConnectionBlocked = false;
    dbConnectionErrorMessage = null;
    return {
      connected: true,
      blocked: false,
      error: null,
      status: getCloudPersistenceStatus(),
    };
  }
  if (force) {
    readCooldownUntil = 0;
    writeCooldownUntil = 0;
  }
  lastReconnectAttemptAt = Date.now();
  await syncOrBlockAgainstCurrentDatabase(force ? 'manual_reconnect' : 'auto_reconnect');
  return {
    connected: isConnected,
    blocked: dbConnectionBlocked,
    error: dbConnectionErrorMessage || lastError,
    status: getCloudPersistenceStatus(),
  };
}

/**
 * Middleware / route helper ensuring startup cloud hydration has finished before serving API requests.
 */
export async function ensureCloudPersistenceReady(): Promise<void> {
  if (isOfflineOperatingMode()) {
    isHydrationComplete = true;
    dbConnectionBlocked = false;
    dbConnectionErrorMessage = null;
    return;
  }
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

  // Reuse just-verified startup manifest if checked within the last 15s to prevent redundant Firestore burst reads
  if (isConnected && !dbConnectionBlocked && cachedManifest && Date.now() - lastManifestFetchAt < 15000) {
    manifest = cachedManifest;
    externalDbConnected = true;
  } else {
    try {
      manifest = await fetchCloudManifest();
      externalDbConnected = isConnected;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      externalDbConnected = false;
    }
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
  if (isOfflineOperatingMode()) return false;
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
 * Schedules a debounced upload (8s) after any database mutation ONLY when in ONLINE MODE.
 * In OFFLINE MODE, zero cloud requests are scheduled.
 */
export function scheduleCloudUpload(reason = 'mutation'): void {
  if (isOfflineOperatingMode()) {
    return;
  }
  if (uploadTimer) {
    clearTimeout(uploadTimer);
  }
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    if (isOfflineOperatingMode()) return;
    void uploadLocalDbToCloud(reason);
  }, 8000);
}

/**
 * Immediately synchronizes the active SQLite database to external Firestore storage.
 */
export async function syncDatabaseToCloudSQL(
  reason = 'manual_sync',
  options?: { forceOverwrite?: boolean; bypassOfflineGuard?: boolean }
): Promise<boolean> {
  if (isOfflineOperatingMode() && !options?.bypassOfflineGuard) {
    return false;
  }
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
  if (isOfflineOperatingMode()) {
    return fs.existsSync(targetPath);
  }
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
  if (!isOfflineOperatingMode()) {
    await uploadLocalDbToCloud(`authorized_${reason}`, { forceOverwrite: true });
  }
}

const NON_MUTATING_SYNC_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/verify',
  '/api/auth/refresh',
  '/api/sync/register-terminal',
  '/api/sync/rehydrate',
  '/api/sync/pull',
  '/api/enhancements/calculate-line',
  '/api/enhancements/fifo/allocate',
  '/api/enhancements/booking-imports/preview',
  '/api/enhancements/local-backup/upload-verify',
  '/api/enhancements/mobile/login',
  '/api/system/backups/verify',
  '/api/system/integrity-check',
  '/api/system/reconnect-db',
  '/api/system/cloud-sync-now',
  '/api/system/operating-mode/switch',
  '/api/system/backup-and-sync-now',
]);

/**
 * Express middleware that:
 * 1. In OFFLINE MODE: makes ZERO Cloud Database requests and tracks local mutations for manual BACKUP & SYNC NOW.
 * 2. In ONLINE MODE: guarantees startup cloud hydration has finished and persists writes to the active Cloud DB.
 */
export async function cloudPersistenceMiddleware(
  req: { method?: string; path?: string; originalUrl?: string },
  res: {
    statusCode: number;
    status: (code: number) => { json: (body: unknown) => void };
    on: (event: string, listener: () => void) => void;
  },
  next: () => void
): Promise<void> {
  const routeLabel = String(req.originalUrl || req.path || '').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();

  // STRICT OFFLINE MODE: zero Cloud DB calls; all reads/writes hit permanent local SQLite only
  if (isOfflineOperatingMode()) {
    dbConnectionBlocked = false;
    dbConnectionErrorMessage = null;
    isHydrationComplete = true;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          if (
            !NON_MUTATING_SYNC_ROUTES.has(routeLabel) &&
            !routeLabel.startsWith('/api/system/sync-conflicts/')
          ) {
            hasLocalMutationsSinceBoot = true;
            recordLocalPendingMutation();
          }
        }
      });
    }

    next();
    return;
  }

  try {
    await ensureCloudPersistenceReady();
  } catch {
    // Proceed cleanly to check connectionBlocked status
  }

  const bypassBlockRoutes = new Set([
    '/api/system/health',
    '/api/system/reconnect-db',
    '/api/system/deployment-safety',
    '/api/system/operating-mode',
    '/api/system/operating-mode/switch',
    '/api/system/backup-and-sync-now',
    '/api/system/sync-conflicts',
    '/api/auth/status',
    '/api/auth/login',
    '/api/auth/logout',
  ]);

  if (dbConnectionBlocked) {
    if (
      dbConnectionBlocked &&
      !bypassBlockRoutes.has(routeLabel) &&
      !routeLabel.startsWith('/api/system/sync-conflicts/')
    ) {
      res.status(503).json({
        success: false,
        dbConnectionError: true,
        databaseIdentity: EXTERNAL_DB_LOCATION,
        error:
          dbConnectionErrorMessage ||
          `Active database (${EXTERNAL_DB_LOCATION}) cannot be reached. Operations stopped to prevent database switching.`,
      });
      return;
    }
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        if (
          !NON_MUTATING_SYNC_ROUTES.has(routeLabel) &&
          !routeLabel.startsWith('/api/system/sync-conflicts/')
        ) {
          hasLocalMutationsSinceBoot = true;
          if (!isOfflineOperatingMode()) {
            scheduleCloudUpload(`http:${method}:${routeLabel}`);
          } else {
            recordLocalPendingMutation();
          }
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

      // 4. Sales Invoices & Line Items (non-destructive if missing)
      const salesList = Array.isArray(rawInvoices) ? rawInvoices : [];
      for (const s of salesList) {
        const id = Number(s?.server_id || s?.id || 0);
        if (id > 0 && tombSet.has(`sales:${id}`)) continue;
        const invNo = String(s?.invoice_number || '').trim();
        if (!invNo) continue;

        const sLines = Array.isArray(s?.items) ? s.items : Array.isArray(s?.lines) ? s.lines : [];
        const existing = db
          .prepare(
            'SELECT id FROM sales WHERE (? > 0 AND id = ?) OR invoice_number = ? OR (client_request_id IS NOT NULL AND client_request_id = ?)'
          )
          .get(id, id, invNo, String(s?.client_tx_id || s?.client_request_id || '')) as { id: number } | undefined;

        if (!existing && sLines.length === 0) {
          // Never create header-only ghost sales invoices without any line items
          continue;
        }

        let targetSaleId = existing ? Number(existing.id) : 0;

        if (!existing) {
          const rawSaleSt = String(s.status || 'completed').trim().toLowerCase() || 'completed';
          const normalizedSaleStatus = ['held', 'on_hold', 'on hold', 'hold'].includes(rawSaleSt)
            ? 'held'
            : ['confirmed', 'posted'].includes(rawSaleSt)
            ? 'completed'
            : rawSaleSt;
          const res = db
            .prepare(
              `INSERT OR IGNORE INTO sales (
                invoice_number, invoice_date, customer_account_id, customer_name, buyer_name,
                invoice_type, payment_mode, gross_total, discount_amount,
                taxable_amount, gst_amount, tax_amount, net_total,
                paid_amount, balance_amount, status, remarks, client_request_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              invNo,
              String(s.invoice_date || getPakistanDateISO()),
              s.customer_account_id || null,
              String(s.customer_name || 'Walk-in Cash Customer'),
              String(s.buyer_name || ''),
              String(s.invoice_type || 'Retail'),
              String(s.payment_mode || 'Cash'),
              Number(s.gross_total || s.net_total || 0),
              Number(s.discount_amount || 0),
              Number(s.taxable_amount || s.net_total || 0),
              Number(s.gst_amount || 0),
              Number(s.tax_amount || 0),
              Number(s.net_total || 0),
              Number(s.paid_amount || 0),
              Number(s.balance_amount || 0),
              normalizedSaleStatus,
              s.remarks || null,
              s.client_tx_id || s.client_request_id || null
            );
          restoredInvoices += Number(res.changes || 0);
          targetSaleId = Number(res.lastInsertRowid || 0);
        }

        if (targetSaleId > 0) {
          const existingLineCount = Number(
            (db.prepare('SELECT COUNT(*) as c FROM sale_items WHERE sale_id = ?').get(targetSaleId) as { c: number } | undefined)?.c || 0
          );
          if (existingLineCount === 0 && sLines.length > 0) {
            for (const ln of sLines) {
              const rawCode = String(ln?.item_code || '').trim();
              let resolvedItem: Record<string, any> | undefined;
              if (rawCode) {
                resolvedItem = db
                  .prepare('SELECT id, item_code, item_name, company_name, packing FROM items WHERE LOWER(TRIM(item_code)) = LOWER(TRIM(?)) LIMIT 1')
                  .get(rawCode) as Record<string, any> | undefined;
              }
              if (!resolvedItem && Number(ln?.item_id || 0) > 0) {
                resolvedItem = db
                  .prepare('SELECT id, item_code, item_name, company_name, packing FROM items WHERE id = ? LIMIT 1')
                  .get(Number(ln.item_id)) as Record<string, any> | undefined;
              }
              const itemId = Number(resolvedItem?.id || ln?.item_id || 0);
              if (itemId <= 0) continue;

              const itemCode = String(resolvedItem?.item_code || rawCode || '').trim();
              const itemName = String(ln?.item_name || resolvedItem?.item_name || 'Medicine Item').trim();
              const companyName = String(ln?.company_name || resolvedItem?.company_name || '').trim();
              const packing = String(ln?.packing || resolvedItem?.packing || '1x1').trim();
              const qty = Number(ln?.quantity || 0);
              const looseQty = Number(ln?.loose_quantity || 0);
              const bonusQty = Number(ln?.bonus_quantity || 0);
              const unitPrice = Number(ln?.unit_price || 0);
              const looseRate = Number(ln?.loose_rate || 0);
              const discPct = Number(ln?.discount_percent || 0);
              const discAmt = Number(ln?.discount_amount || 0);
              const grossAmt = Number(ln?.gross_amount || qty * unitPrice + looseQty * looseRate || 0);
              const taxableAmt = Number(ln?.taxable_amount || Math.max(0, grossAmt - discAmt) || 0);
              const taxPct = Number(ln?.tax_percent || 0);
              const taxAmt = Number(ln?.tax_amount || 0);
              const lineTotal = Number(ln?.line_total || taxableAmt + taxAmt || 0);

              const lnVariantId = ln?.variant_id ? Number(ln.variant_id) : null;
              const lnVariantCode = lnVariantId ? (String(ln?.variant_code || '').trim() || null) : null;
              const lnVariantName = lnVariantId ? (String(ln?.variant_name || '').trim() || null) : null;

              db.prepare(
                `INSERT INTO sale_items (
                  sale_id, item_id, inventory_id, variant_id, variant_code, variant_name,
                  item_code, company_name, item_name,
                  packing, units_per_pack, batch_number, expiry_date,
                  quantity, loose_quantity, bonus_quantity, total_units,
                  unit_price, loose_rate, discount_percent, discount_amount,
                  gross_amount, taxable_amount, tax_percent, tax_amount, line_total, remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                targetSaleId,
                itemId,
                ln?.inventory_id ? Number(ln.inventory_id) : null,
                lnVariantId,
                lnVariantCode,
                lnVariantName,
                itemCode,
                companyName,
                itemName,
                packing,
                Math.max(1, Number(ln?.units_per_pack || 1)),
                String(ln?.batch_number || `B-${itemCode}-01`),
                String(ln?.expiry_date || '2028-12-31'),
                qty,
                looseQty,
                bonusQty,
                Number(ln?.total_units || qty + looseQty + bonusQty),
                unitPrice,
                looseRate,
                discPct,
                discAmt,
                grossAmt,
                taxableAmt,
                taxPct,
                taxAmt,
                lineTotal,
                String(ln?.remarks || '')
              );
            }
          }
        }
      }

      // 5. Purchases & Line Items (non-destructive if missing)
      const purchaseList = Array.isArray(extra?.purchases) ? extra!.purchases : [];
      for (const p of purchaseList) {
        const id = Number(p?.server_id || p?.id || 0);
        if (id > 0 && tombSet.has(`purchases:${id}`)) continue;
        const billNo = String(p?.bill_number || p?.invoice_number || '').trim();
        if (!billNo) continue;

        const pLines = Array.isArray(p?.items) ? p.items : Array.isArray(p?.lines) ? p.lines : [];
        const existing = db
          .prepare('SELECT id FROM purchases WHERE bill_number = ? OR (client_request_id IS NOT NULL AND client_request_id = ?)')
          .get(billNo, String(p?.client_tx_id || p?.client_request_id || '')) as { id: number } | undefined;

        if (!existing && pLines.length === 0) {
          // Never create header-only ghost purchase invoices without any line items
          continue;
        }

        let targetPurchaseId = existing ? Number(existing.id) : 0;

        if (!existing) {
          const rawPurSt = String(p.status || 'completed').trim().toLowerCase() || 'completed';
          const normalizedPurStatus = ['held', 'on_hold', 'on hold', 'hold'].includes(rawPurSt)
            ? 'held'
            : ['confirmed', 'posted'].includes(rawPurSt)
            ? 'completed'
            : rawPurSt;
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
              String(p.bill_date || getPakistanDateISO()),
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
              normalizedPurStatus,
              p.remarks || null,
              p.client_tx_id || p.client_request_id || null
            );
          restoredPurchases += Number(res.changes || 0);
          targetPurchaseId = Number(res.lastInsertRowid || 0);
        }

        if (targetPurchaseId > 0) {
          const existingLineCount = Number(
            (db.prepare('SELECT COUNT(*) as c FROM purchase_items WHERE purchase_id = ?').get(targetPurchaseId) as { c: number } | undefined)?.c || 0
          );
          if (existingLineCount === 0 && pLines.length > 0) {
            for (const ln of pLines) {
              const rawCode = String(ln?.item_code || '').trim();
              let resolvedItem: Record<string, any> | undefined;
              if (rawCode) {
                resolvedItem = db
                  .prepare('SELECT id, item_code, item_name, company_name, packing, retail_price FROM items WHERE LOWER(TRIM(item_code)) = LOWER(TRIM(?)) LIMIT 1')
                  .get(rawCode) as Record<string, any> | undefined;
              }
              if (!resolvedItem && Number(ln?.item_id || 0) > 0) {
                resolvedItem = db
                  .prepare('SELECT id, item_code, item_name, company_name, packing, retail_price FROM items WHERE id = ? LIMIT 1')
                  .get(Number(ln.item_id)) as Record<string, any> | undefined;
              }
              const itemId = Number(resolvedItem?.id || ln?.item_id || 0);
              if (itemId <= 0) continue;

              const itemCode = String(resolvedItem?.item_code || rawCode || '').trim();
              const itemName = String(ln?.item_name || resolvedItem?.item_name || 'Medicine Item').trim();
              const companyName = String(ln?.company_name || resolvedItem?.company_name || '').trim();
              const packing = String(ln?.packing || resolvedItem?.packing || '1x1').trim();
              const qty = Number(ln?.quantity || 0);
              const bonusQty = Number(ln?.bonus_quantity || 0);
              const looseQty = Number(ln?.loose_quantity || 0);
              const purchaseRate = Number(ln?.purchase_rate ?? ln?.purchase_price ?? 0);
              const mrpRate = Number(ln?.mrp_rate ?? ln?.retail_price ?? resolvedItem?.retail_price ?? 0);
              const discPct = Number(ln?.discount_percent || 0);
              const discAmt = Number(ln?.discount_amount || 0);
              const grossAmt = Number(ln?.gross_amount || qty * purchaseRate || 0);
              const taxableAmt = Number(ln?.taxable_amount || Math.max(0, grossAmt - discAmt) || 0);
              const taxPct = Number(ln?.tax_percent || 0);
              const taxAmt = Number(ln?.tax_amount || 0);
              const lineTotal = Number(ln?.line_total || taxableAmt + taxAmt || 0);

              const lnVariantId = ln?.variant_id ? Number(ln.variant_id) : null;
              const lnVariantCode = lnVariantId ? (String(ln?.variant_code || '').trim() || null) : null;
              const lnVariantName = lnVariantId ? (String(ln?.variant_name || '').trim() || null) : null;

              db.prepare(
                `INSERT INTO purchase_items (
                  purchase_id, item_id, inventory_id, variant_id, variant_code, variant_name,
                  item_code, company_name, item_name,
                  packing, units_per_pack, batch_number, manufacturing_date, expiry_date,
                  quantity, bonus_quantity, pack_quantity, loose_quantity, total_units,
                  purchase_rate, mrp_rate, gross_amount, discount_percent, discount_amount,
                  taxable_amount, tax_percent, tax_amount, line_total, remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                targetPurchaseId,
                itemId,
                ln?.inventory_id ? Number(ln.inventory_id) : null,
                lnVariantId,
                lnVariantCode,
                lnVariantName,
                itemCode,
                companyName,
                itemName,
                packing,
                Math.max(1, Number(ln?.units_per_pack || 1)),
                String(ln?.batch_number || `B-${itemCode}-01`),
                ln?.manufacturing_date ? String(ln.manufacturing_date) : null,
                String(ln?.expiry_date || '2028-12-31'),
                qty,
                bonusQty,
                qty + bonusQty,
                looseQty,
                Number(ln?.total_units || qty + bonusQty + looseQty),
                purchaseRate,
                mrpRate,
                grossAmt,
                discPct,
                discAmt,
                taxableAmt,
                taxPct,
                taxAmt,
                lineTotal,
                String(ln?.remarks || '')
              );
            }
          }
        }
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
            String(v.voucher_date || getPakistanDateISO()),
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
    if (restoredAccounts > 0 || restoredInvoices > 0 || restoredPurchases > 0 || restoredVouchers > 0) {
      reconcileHeldAndDuplicateLedgerEntries();
    }
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
 * Manual Control Policy: Automatic background cloud synchronization loop is intentionally disabled.
 * Cloud synchronization occurs ONLY when Super Admin explicitly initiates BACKUP & SYNC NOW
 * or during normal ONLINE MODE operations.
 */
export function startCloudPersistenceBackgroundLoop(): void {
  // Intentionally disabled — Manual Control Only (no automatic background polling/sync)
}

export function stopCloudPersistenceBackgroundLoop(): void {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
    backgroundInterval = null;
  }
}

export interface ConflictTableRule {
  table: string;
  labelCol: string;
  naturalKeyCol: string | null;
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

export interface CloudReachabilityResult {
  reachable: boolean;
  exists: boolean;
  versionSeq: number;
  counts: CloudRecordCounts | null;
  error: string | null;
  location: string;
}

/**
 * Performs a live Cloud Database (Firestore) reachability verification.
 * Used before switching from OFFLINE -> ONLINE and during manual BACKUP & SYNC NOW.
 */
export async function checkCloudDatabaseReachability(): Promise<CloudReachabilityResult> {
  readCooldownUntil = 0;
  const res = await fetchCloudManifestDetailed();
  if (res.status === 'unreachable') {
    return {
      reachable: false,
      exists: false,
      versionSeq: lastVersionSeq,
      counts: null,
      error: res.error,
      location: EXTERNAL_DB_LOCATION,
    };
  }
  if (res.status === 'not_found') {
    return {
      reachable: true,
      exists: false,
      versionSeq: 0,
      counts: null,
      error: null,
      location: EXTERNAL_DB_LOCATION,
    };
  }
  cloudRecordCounts = res.manifest.counts as unknown as Record<string, number>;
  if (res.manifest.versionSeq > lastVersionSeq) {
    lastVersionSeq = res.manifest.versionSeq;
  }
  return {
    reachable: true,
    exists: true,
    versionSeq: res.manifest.versionSeq,
    counts: res.manifest.counts,
    error: null,
    location: EXTERNAL_DB_LOCATION,
  };
}

export interface ConflictAwareMergeReport {
  mergedFromCloud: number;
  updatedFromCloud: number;
  conflictsDetected: number;
  unresolvedConflictsCount: number;
}

/**
 * Compares the active local SQLite database against a verified Cloud SQLite snapshot:
 * - Detects genuine conflicting modifications on the same record without silently overwriting either side.
 * - Never overwrites newer local records with older cloud data.
 * - Auto-reconciles stale unresolved conflicts when both sides already match and honors Super Admin resolutions
 *   without infinite re-conflict loops.
 * - Non-destructively merges missing non-duplicate records, advances sequences, and recalculates ledger balances.
 */
export function detectAndMergeCloudSnapshotWithConflicts(
  cloudDbFilePath: string,
  options: {
    lastSyncedAt: string | null;
    switchedAt?: string | null;
    hasLocalPendingChanges?: boolean;
  }
): ConflictAwareMergeReport {
  const db = getDatabase();
  const escapedPath = cloudDbFilePath.replace(/'/g, "''");
  const CLOCK_TOLERANCE_MS = 1000;

  let dbBaselineSyncMs = 0;
  try {
    const csRow = db
      .prepare('SELECT last_successful_cloud_sync_at FROM company_settings ORDER BY id ASC LIMIT 1')
      .get() as { last_successful_cloud_sync_at?: string | null } | undefined;
    dbBaselineSyncMs = parseComparableTimestamp(csRow?.last_successful_cloud_sync_at);
  } catch {
    dbBaselineSyncMs = 0;
  }

  const effectiveLastSyncMs = Math.max(
    parseComparableTimestamp(options.lastSyncedAt),
    dbBaselineSyncMs,
    parseComparableTimestamp(options.switchedAt)
  );
  const nowAutoResolveIso = new Date().toISOString();

  let mergedFromCloud = 0;
  let updatedFromCloud = 0;
  let conflictsDetected = 0;

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

    const conflictedIdsByTable = new Map<string, Set<string>>();
    const activeConflictKeys = new Set<string>();

    // 1. Conflict Detection & Non-Conflicting Newer Cloud Update Pass on Core Business Tables
    for (const rule of ALLOWED_CONFLICT_TABLES) {
      const tableName = rule.table;
      if (!localTables.has(tableName) || !cloudTables.has(tableName)) continue;

      const localCols = (
        db.prepare(`PRAGMA main.table_info("${tableName}")`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      const cloudColsSet = new Set(
        (
          db.prepare(`PRAGMA cloud_snap.table_info("${tableName}")`).all() as Array<{ name: string }>
        ).map((c) => c.name)
      );
      const sharedCols = localCols.filter((c) => cloudColsSet.has(c));
      if (!sharedCols.includes('id')) continue;

      const activeCompareCols = rule.compareCols.filter((c) => sharedCols.includes(c));
      if (activeCompareCols.length === 0) continue;

      const hasUpdatedAt = sharedCols.includes('updated_at');
      const hasCreatedAt = sharedCols.includes('created_at');
      const selectCols = Array.from(
        new Set([
          'id',
          ...(sharedCols.includes(rule.labelCol) ? [rule.labelCol] : []),
          ...(hasUpdatedAt ? ['updated_at'] : []),
          ...(hasCreatedAt ? ['created_at'] : []),
          ...activeCompareCols,
        ])
      );
      const quotedSelect = selectCols.map((c) => `"${c}"`).join(', ');

      const localRows = db
        .prepare(`SELECT ${quotedSelect} FROM main."${tableName}"`)
        .all() as Array<Record<string, unknown>>;
      const cloudRows = db
        .prepare(`SELECT ${quotedSelect} FROM cloud_snap."${tableName}"`)
        .all() as Array<Record<string, unknown>>;

      const localById = new Map<string, Record<string, unknown>>();
      for (const r of localRows) {
        localById.set(String(r.id), r);
      }

      const conflictIdSet = new Set<string>();
      conflictedIdsByTable.set(tableName, conflictIdSet);

      const safeCloudUpdateIds: string[] = [];

      for (const cloudRow of cloudRows) {
        const recId = String(cloudRow.id);
        const localRow = localById.get(recId);
        if (!localRow) continue;

        const changedFields = activeCompareCols.filter(
          (col) => normalizeCompareValue(localRow[col]) !== normalizeCompareValue(cloudRow[col])
        );
        if (changedFields.length === 0) {
          // Values already match cleanly — auto-clear any stale unresolved conflict row for this record
          db.prepare(
            `UPDATE main.sync_conflicts
             SET status = 'resolved',
                 resolution_choice = COALESCE(resolution_choice, 'keep_local'),
                 resolved_by = COALESCE(resolved_by, 'System (Auto-Reconciled)'),
                 resolved_at = COALESCE(resolved_at, ?)
             WHERE table_name = ? AND record_id = ? AND status = 'unresolved'`
          ).run(nowAutoResolveIso, tableName, recId);
          continue;
        }

        const localTsStr = String(localRow.updated_at || localRow.created_at || '');
        const cloudTsStr = String(cloudRow.updated_at || cloudRow.created_at || '');
        const localMs = parseComparableTimestamp(localTsStr);
        const cloudMs = parseComparableTimestamp(cloudTsStr);

        // Honor Super Admin's explicit resolution for this exact Cloud version so resolving a conflict
        // and clicking BACKUP & SYNC NOW again NEVER triggers an infinite re-conflict loop!
        const alreadyResolved = db
          .prepare(
            `SELECT id, resolution_choice, local_updated_at, cloud_updated_at, resolved_at
             FROM main.sync_conflicts
             WHERE table_name = ? AND record_id = ? AND status = 'resolved'
               AND COALESCE(cloud_updated_at, '') = ?
             ORDER BY id DESC LIMIT 1`
          )
          .get(tableName, recId, cloudTsStr) as
          | {
              id: number;
              resolution_choice: string;
              local_updated_at: string | null;
              cloud_updated_at: string | null;
              resolved_at: string | null;
            }
          | undefined;

        if (alreadyResolved) {
          if (alreadyResolved.resolution_choice === 'keep_local') {
            // Super Admin explicitly chose Local over this exact Cloud version -> keep local intact
            continue;
          }
          if (alreadyResolved.resolution_choice === 'keep_cloud') {
            // Re-apply cloud safely if local wasn't newly edited after resolution
            const resolvedMs = parseComparableTimestamp(alreadyResolved.resolved_at);
            if (localMs <= resolvedMs + 2000) {
              safeCloudUpdateIds.push(recId);
              continue;
            }
          }
        }

        let isConflict = false;
        let cloudIsStrictlyNewerSafe = false;

        if (effectiveLastSyncMs > 0) {
          const localModifiedSinceSync = localMs > effectiveLastSyncMs + CLOCK_TOLERANCE_MS;
          const cloudModifiedSinceSync = cloudMs > effectiveLastSyncMs + CLOCK_TOLERANCE_MS;

          if (localModifiedSinceSync && cloudModifiedSinceSync) {
            // Genuine 2-way concurrent edit after last sync -> require Super Admin choice
            isConflict = true;
          } else if (cloudModifiedSinceSync && !localModifiedSinceSync) {
            cloudIsStrictlyNewerSafe = true;
          } else if (localModifiedSinceSync && !cloudModifiedSinceSync) {
            // Local is strictly newer since last sync -> keep local intact
            isConflict = false;
          } else if (localMs > cloudMs + CLOCK_TOLERANCE_MS) {
            // Both timestamps pre-date baseline, but Local is strictly newer -> keep local
            isConflict = false;
          } else if (cloudMs > localMs + CLOCK_TOLERANCE_MS) {
            // Both timestamps pre-date baseline, but Cloud is strictly newer -> pull cloud safely
            cloudIsStrictlyNewerSafe = true;
          } else {
            // Equal or missing timestamps yet business fields genuinely differ -> safe conflict
            isConflict = true;
          }
        } else {
          // First manual sync baseline: rely strictly on normalized UTC timestamps (never blindly flag newer local edits!)
          if (localMs > cloudMs + CLOCK_TOLERANCE_MS) {
            // Local is strictly newer -> keep local
            isConflict = false;
          } else if (cloudMs > localMs + CLOCK_TOLERANCE_MS) {
            // Cloud is strictly newer -> safe pull from cloud
            cloudIsStrictlyNewerSafe = true;
          } else {
            // Equal or missing timestamps yet values differ -> safe conflict
            isConflict = true;
          }
        }

        if (isConflict) {
          conflictIdSet.add(recId);
          activeConflictKeys.add(`${tableName}:${recId}`);
          const existingUnresolved = db
            .prepare(
              `SELECT id FROM main.sync_conflicts
               WHERE table_name = ? AND record_id = ? AND status = 'unresolved' LIMIT 1`
            )
            .get(tableName, recId) as { id: number } | undefined;

          const label = String(localRow[rule.labelCol] || cloudRow[rule.labelCol] || `#${recId}`);
          if (existingUnresolved) {
            db.prepare(
              `UPDATE main.sync_conflicts
               SET record_label = ?, local_updated_at = ?, cloud_updated_at = ?,
                   local_snapshot_json = ?, cloud_snapshot_json = ?, changed_fields_json = ?
               WHERE id = ?`
            ).run(
              label,
              localTsStr || null,
              cloudTsStr || null,
              JSON.stringify(localRow),
              JSON.stringify(cloudRow),
              JSON.stringify(changedFields),
              existingUnresolved.id
            );
          } else {
            db.prepare(
              `INSERT INTO main.sync_conflicts (
                 table_name, record_id, record_label,
                 local_updated_at, cloud_updated_at,
                 local_snapshot_json, cloud_snapshot_json,
                 changed_fields_json, status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unresolved')`
            ).run(
              tableName,
              recId,
              label,
              localTsStr || null,
              cloudTsStr || null,
              JSON.stringify(localRow),
              JSON.stringify(cloudRow),
              JSON.stringify(changedFields)
            );
          }
          conflictsDetected += 1;
        } else if (cloudIsStrictlyNewerSafe) {
          safeCloudUpdateIds.push(recId);
        }
      }

      // Apply strictly newer non-conflicting cloud updates only
      if (safeCloudUpdateIds.length > 0) {
        const updateCols = sharedCols.filter((c) => c !== 'id');
        if (updateCols.length > 0) {
          const setClause = updateCols.map((c) => `"${c}" = ?`).join(', ');
          const updateStmt = db.prepare(`UPDATE main."${tableName}" SET ${setClause} WHERE id = ?`);
          const fetchCloudFullStmt = db.prepare(
            `SELECT ${sharedCols.map((c) => `"${c}"`).join(', ')} FROM cloud_snap."${tableName}" WHERE id = ?`
          );
          db.pragma('foreign_keys = OFF');
          try {
            const applyTx = db.transaction(() => {
              for (const recId of safeCloudUpdateIds) {
                const fullCloud = fetchCloudFullStmt.get(recId) as Record<string, unknown> | undefined;
                if (!fullCloud) continue;
                const values = updateCols.map((c) => fullCloud[c]);
                updateStmt.run(...values, recId);
                updatedFromCloud += 1;
              }
            });
            applyTx();
          } finally {
            db.pragma('foreign_keys = ON');
          }
        }
      }
    }

    // 2. Merge tombstones & missing non-duplicate records across all shared tables
    if (cloudTables.has('sync_tombstones') && localTables.has('sync_tombstones')) {
      db.prepare(
        `INSERT OR IGNORE INTO main.sync_tombstones (table_name, record_id, client_tx_id, deleted_at)
         SELECT table_name, record_id, client_tx_id, deleted_at FROM cloud_snap.sync_tombstones`
      ).run();
    }

    const skipTables = new Set([
      'user_sessions',
      'database_migrations',
      'device_registry',
      'sync_tombstones',
      'sync_conflicts',
      'backup_history',
    ]);

    const allSharedTables = Array.from(localTables).filter(
      (t) => !skipTables.has(t) && cloudTables.has(t)
    );

    db.pragma('foreign_keys = OFF');
    try {
      const mergeTx = db.transaction(() => {
        for (const tableName of allSharedTables) {
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
          const rule = ALLOWED_CONFLICT_TABLES.find((r) => r.table === tableName);
          const natKey = rule?.naturalKeyCol && sharedCols.includes(rule.naturalKeyCol) ? rule.naturalKeyCol : null;

          const whereParts: string[] = [];
          const params: unknown[] = [];

          if (hasId && localTables.has('sync_tombstones')) {
            whereParts.push(
              `CAST(c.id AS TEXT) NOT IN (SELECT CAST(record_id AS TEXT) FROM main.sync_tombstones WHERE table_name = ?)`
            );
            params.push(tableName);
          }
          if (hasId) {
            whereParts.push(`c.id NOT IN (SELECT id FROM main."${tableName}")`);
          }
          if (natKey) {
            whereParts.push(
              `(c."${natKey}" IS NULL OR c."${natKey}" = '' OR c."${natKey}" NOT IN (SELECT "${natKey}" FROM main."${tableName}" WHERE "${natKey}" IS NOT NULL))`
            );
          }

          const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
          const selectExpr = sharedCols.map((c) => `c."${c}"`).join(', ');
          const stmt = db.prepare(
            `INSERT OR IGNORE INTO main."${tableName}" (${quotedCols})
             SELECT ${selectExpr} FROM cloud_snap."${tableName}" c ${whereSql}`
          );
          const res = stmt.run(...params);
          mergedFromCloud += Number(res.changes || 0);
        }

        // Advance sequence counters to MAX(local, cloud) so invoice/item/voucher codes never duplicate
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
      });
      mergeTx();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    if (mergedFromCloud > 0 || updatedFromCloud > 0) {
      reconcileHeldAndDuplicateLedgerEntries();
    }

    // Auto-clear any stale unresolved sync_conflicts that are no longer conflicting against the live cloud snapshot
    // (for example, legacy false-positive conflicts on derived accounts.current_balance or deleted records)
    const remainingUnresolved = db
      .prepare("SELECT id, table_name, record_id FROM main.sync_conflicts WHERE status = 'unresolved'")
      .all() as Array<{ id: number; table_name: string; record_id: string }>;
    for (const stale of remainingUnresolved) {
      const key = `${stale.table_name}:${stale.record_id}`;
      if (!activeConflictKeys.has(key)) {
        db.prepare(
          `UPDATE main.sync_conflicts
           SET status = 'resolved',
               resolution_choice = COALESCE(resolution_choice, 'keep_local'),
               resolved_by = COALESCE(resolved_by, 'System (Auto-Reconciled)'),
               resolved_at = COALESCE(resolved_at, ?)
           WHERE id = ?`
        ).run(nowAutoResolveIso, stale.id);
      }
    }
  } finally {
    try {
      db.exec('DETACH DATABASE cloud_snap;');
    } catch {
      // ignore
    }
  }

  const unresolvedRow = db
    .prepare("SELECT COUNT(*) as cnt FROM sync_conflicts WHERE status = 'unresolved'")
    .get() as { cnt: number } | undefined;

  return {
    mergedFromCloud,
    updatedFromCloud,
    conflictsDetected,
    unresolvedConflictsCount: Number(unresolvedRow?.cnt || 0),
  };
}

export interface ManualCloudSyncResult {
  status: 'Successful' | 'Pending' | 'Failed';
  reachable: boolean;
  mergedFromCloud: number;
  updatedFromCloud: number;
  conflictsDetected: number;
  unresolvedConflictsCount: number;
  uploaded: boolean;
  cloudVersionSeq: number;
  message: string;
  error: string | null;
}

/**
 * Explicit Super Admin Manual Cloud Synchronization (Step 2 of BACKUP & SYNC NOW).
 * Works safely from BOTH ONLINE MODE and OFFLINE MODE without enabling background sync.
 */
export async function runConflictAwareBidirectionalCloudSync(options: {
  lastSyncedAt: string | null;
  switchedAt?: string | null;
  hasLocalPendingChanges?: boolean;
  initiatedBy: string;
}): Promise<ManualCloudSyncResult> {
  // Clear cooldowns for explicit Super Admin manual trigger
  readCooldownUntil = 0;
  writeCooldownUntil = 0;

  const reachability = await checkCloudDatabaseReachability();
  if (!reachability.reachable) {
    return {
      status: 'Pending',
      reachable: false,
      mergedFromCloud: 0,
      updatedFromCloud: 0,
      conflictsDetected: 0,
      unresolvedConflictsCount: 0,
      uploaded: false,
      cloudVersionSeq: lastVersionSeq,
      message:
        'Cloud Database is currently unreachable (offline or no internet). Local backup succeeded; Cloud Sync remains Pending until you run BACKUP & SYNC NOW again when internet is available.',
      error: reachability.error,
    };
  }

  let mergedFromCloud = 0;
  let updatedFromCloud = 0;
  let conflictsDetected = 0;
  let unresolvedConflictsCount = 0;
  let verifiedLiveMerge = false;

  if (reachability.exists && cachedManifest) {
    const dataDir = path.dirname(config.databasePath);
    const stagedPath = path.join(dataDir, `ams_manual_sync_staged_${Date.now()}.db`);
    try {
      const cloudBuffer = await downloadVerifiedCloudSqliteBuffer(cachedManifest);
      fs.writeFileSync(stagedPath, cloudBuffer);
      const stagedInspect = inspectSqliteSnapshot(stagedPath, { immutable: true });
      if (!stagedInspect.valid) {
        throw new Error('Downloaded Cloud Database snapshot failed integrity check.');
      }

      const mergeReport = detectAndMergeCloudSnapshotWithConflicts(stagedPath, {
        lastSyncedAt: options.lastSyncedAt,
        switchedAt: options.switchedAt,
        hasLocalPendingChanges: options.hasLocalPendingChanges,
      });
      mergedFromCloud = mergeReport.mergedFromCloud;
      updatedFromCloud = mergeReport.updatedFromCloud;
      conflictsDetected = mergeReport.conflictsDetected;
      unresolvedConflictsCount = mergeReport.unresolvedConflictsCount;
      verifiedLiveMerge = true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        status: 'Failed',
        reachable: true,
        mergedFromCloud,
        updatedFromCloud,
        conflictsDetected,
        unresolvedConflictsCount,
        uploaded: false,
        cloudVersionSeq: lastVersionSeq,
        message: `Cloud synchronization failed while verifying cloud records: ${errMsg}`,
        error: errMsg,
      };
    } finally {
      try {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      } catch {
        // ignore cleanup warning
      }
    }
  } else {
    const db = getDatabase();
    const unresolvedRow = db
      .prepare("SELECT COUNT(*) as cnt FROM sync_conflicts WHERE status = 'unresolved'")
      .get() as { cnt: number } | undefined;
    unresolvedConflictsCount = Number(unresolvedRow?.cnt || 0);
  }

  if (unresolvedConflictsCount > 0) {
    return {
      status: 'Pending',
      reachable: true,
      mergedFromCloud,
      updatedFromCloud,
      conflictsDetected,
      unresolvedConflictsCount,
      uploaded: false,
      cloudVersionSeq: Math.max(lastVersionSeq, reachability.versionSeq),
      message: `${unresolvedConflictsCount} record conflict(s) detected between Local and Cloud databases. Neither version was overwritten. Please resolve the conflict(s) below and click BACKUP & SYNC NOW again.`,
      error: null,
    };
  }

  // Verified and reconciled with live Cloud DB — mark hydrated and commit reconciled DB safely
  hasHydratedFromCloudThisProcess = true;
  const uploaded = await uploadLocalDbToCloud(`manual_backup_sync_by_${options.initiatedBy}`, {
    forceOverwrite: false,
    bypassOfflineGuard: true,
    allowVerifiedPostMergeSync: verifiedLiveMerge,
  });

  if (!uploaded) {
    return {
      status: 'Pending',
      reachable: true,
      mergedFromCloud,
      updatedFromCloud,
      conflictsDetected: 0,
      unresolvedConflictsCount: 0,
      uploaded: false,
      cloudVersionSeq: Math.max(lastVersionSeq, reachability.versionSeq),
      message: `Cloud upload could not complete right now${lastError ? `: ${lastError}` : ''}. Local backup is safe and Cloud Sync remains Pending.`,
      error: lastError,
    };
  }

  return {
    status: 'Successful',
    reachable: true,
    mergedFromCloud,
    updatedFromCloud,
    conflictsDetected: 0,
    unresolvedConflictsCount: 0,
    uploaded: true,
    cloudVersionSeq: Math.max(lastVersionSeq, reachability.versionSeq),
    message: `Cloud Database synchronized successfully (Version #${Math.max(lastVersionSeq, reachability.versionSeq)}${
      mergedFromCloud > 0 || updatedFromCloud > 0
        ? `; merged ${mergedFromCloud} new and ${updatedFromCloud} updated cloud record(s)`
        : ''
    }).`,
    error: null,
  };
}
