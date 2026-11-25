import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { config, isTemporaryStoragePath, validatePermanentStorageLocation } from '../config.ts';
import { getPakistanDateISO, getPakistanFilenameStamp } from '../utils/pakistanTime.ts';
import {
  getDatabase,
  closeDatabaseConnection,
  reopenDatabaseConnection,
} from '../db/connection.ts';
import { runMigrations } from '../db/migrations.ts';
import { bumpDbResetEpoch } from '../db/resetState.ts';
import {
  isOfflineOperatingMode,
  getPersistedOperatingModeState,
  updatePersistedOperatingModeState,
} from './operatingModeStore.ts';
import {
  syncDatabaseToCloudSQL,
} from './cloudPersistenceService.ts';

export type BackupType = 'manual' | 'daily_auto' | 'pre_change' | 'pre_restore_safety';

export interface BackupRecord {
  id: number;
  filename: string;
  file_path: string;
  backup_type: BackupType;
  file_size_bytes: number;
  integrity_status: string;
  tables_count: number;
  records_summary: string;
  status: string;
  created_by: string;
  notes: string;
  created_at: string;
  file_exists?: boolean;
}

export interface BackupVerificationResult {
  valid: boolean;
  filename: string;
  filePath: string;
  fileSizeBytes: number;
  modifiedAt: string;
  integrityCheck: string;
  tablesCount: number;
  sha256?: string;
  coreCounts: {
    items: number;
    accounts: number;
    purchases: number;
    sales: number;
    inventoryBatches: number;
    journalEntries: number;
    cashBookVouchers?: number;
    users: number;
  };
  latestTimestamps?: {
    latestSaleAt?: string | null;
    latestPurchaseAt?: string | null;
    latestVoucherAt?: string | null;
    latestItemAt?: string | null;
  };
  repairedFromCorruption?: boolean;
  repairMethod?: string;
  salvageWarnings?: string[];
  error?: string;
}

export interface DDriveFolderCheckResult {
  configuredFolder: string;
  resolvedLocalPath: string | null;
  isWindowsHost: boolean;
  driveExists: boolean;
  folderExists: boolean;
  writable: boolean;
  requiresBrowserDDriveHelper: boolean;
  error: string | null;
}

/**
 * Returns the configured Windows D-Drive backup folder (defaults to D:\AbrarMedicalStore\Backups).
 */
export function getConfiguredDDriveBackupFolder(): string {
  try {
    const db = getDatabase();
    const row = db
      .prepare('SELECT local_backup_folder, backup_directory FROM company_settings LIMIT 1')
      .get() as { local_backup_folder?: string; backup_directory?: string } | undefined;
    const candidates = [
      row?.local_backup_folder,
      row?.backup_directory,
      getPersistedOperatingModeState().dDriveConfiguredFolder,
    ];
    for (const raw of candidates) {
      const clean = String(raw || '').trim();
      if (
        clean &&
        clean !== 'data/backups' &&
        clean !== './data/backups' &&
        clean !== 'D:\\Abrar Medical Store Backups'
      ) {
        return clean;
      }
    }
  } catch {
    // ignore
  }
  return config.windowsPrimaryBackupDir || 'D:\\AbrarMedicalStore\\Backups';
}

/**
 * Verifies whether a target directory exists and is writable by the server process.
 * Never pretends a Windows D:\ drive exists on a Linux/Cloud Run host unless mounted (e.g. /mnt/d).
 */
export function checkDDriveBackupFolderStatus(customFolder?: string): DDriveFolderCheckResult {
  const configuredFolder = String(customFolder || getConfiguredDDriveBackupFolder()).trim() || 'D:\\AbrarMedicalStore\\Backups';
  const isWin = process.platform === 'win32';
  const winDriveMatch = configuredFolder.match(/^([a-zA-Z]):[\\/]/);

  if (winDriveMatch) {
    const driveLetter = winDriveMatch[1].toUpperCase();
    const driveRootWin = `${driveLetter}:\\`;
    const relativeSubPath = configuredFolder
      .slice(3)
      .replace(/\\/g, '/');

    if (isWin) {
      const driveExists = fs.existsSync(driveRootWin);
      if (!driveExists) {
        return {
          configuredFolder,
          resolvedLocalPath: null,
          isWindowsHost: true,
          driveExists: false,
          folderExists: false,
          writable: false,
          requiresBrowserDDriveHelper: false,
          error: `Drive ${driveLetter}: is not available on this computer (${configuredFolder}). Please check that Drive ${driveLetter}: is connected and accessible.`,
        };
      }
      try {
        if (!fs.existsSync(configuredFolder)) {
          fs.mkdirSync(configuredFolder, { recursive: true });
        }
        fs.accessSync(configuredFolder, fs.constants.R_OK | fs.constants.W_OK);
        const probeFile = path.join(configuredFolder, `.ams_write_test_${Date.now()}.tmp`);
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.unlinkSync(probeFile);
        return {
          configuredFolder,
          resolvedLocalPath: configuredFolder,
          isWindowsHost: true,
          driveExists: true,
          folderExists: true,
          writable: true,
          requiresBrowserDDriveHelper: false,
          error: null,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          configuredFolder,
          resolvedLocalPath: configuredFolder,
          isWindowsHost: true,
          driveExists: true,
          folderExists: fs.existsSync(configuredFolder),
          writable: false,
          requiresBrowserDDriveHelper: false,
          error: `Backup folder "${configuredFolder}" is not writable: ${msg}`,
        };
      }
    } else {
      // Server is running on Linux / Cloud Run / WSL. Check if /mnt/<drive> is mounted locally.
      const wslMountRoot = `/mnt/${driveLetter.toLowerCase()}`;
      if (fs.existsSync(wslMountRoot)) {
        const mountedCandidate = path.join(wslMountRoot, relativeSubPath);
        try {
          if (!fs.existsSync(mountedCandidate)) {
            fs.mkdirSync(mountedCandidate, { recursive: true });
          }
          fs.accessSync(mountedCandidate, fs.constants.R_OK | fs.constants.W_OK);
          const probeFile = path.join(mountedCandidate, `.ams_write_test_${Date.now()}.tmp`);
          fs.writeFileSync(probeFile, 'ok', 'utf8');
          fs.unlinkSync(probeFile);
          return {
            configuredFolder,
            resolvedLocalPath: mountedCandidate,
            isWindowsHost: false,
            driveExists: true,
            folderExists: true,
            writable: true,
            requiresBrowserDDriveHelper: false,
            error: null,
          };
        } catch {
          // Fall through to browser D-Drive helper mode
        }
      }

      return {
        configuredFolder,
        resolvedLocalPath: null,
        isWindowsHost: false,
        driveExists: false,
        folderExists: false,
        writable: false,
        requiresBrowserDDriveHelper: true,
        error: `Server is running in a Linux/Cloud environment and cannot directly access Windows "${configuredFolder}" without browser folder permission.`,
      };
    }
  }

  // Non-Windows custom path (e.g. local absolute path configured for server or testing)
  const candidatePath = path.isAbsolute(configuredFolder)
    ? configuredFolder
    : path.resolve(path.dirname(config.databasePath), configuredFolder);

  if (isTemporaryStoragePath(candidatePath)) {
    return {
      configuredFolder,
      resolvedLocalPath: null,
      isWindowsHost: isWin,
      driveExists: false,
      folderExists: false,
      writable: false,
      requiresBrowserDDriveHelper: false,
      error: `Temporary directory "${candidatePath}" is not allowed for permanent backups.`,
    };
  }

  try {
    if (!fs.existsSync(candidatePath)) {
      fs.mkdirSync(candidatePath, { recursive: true });
    }
    fs.accessSync(candidatePath, fs.constants.R_OK | fs.constants.W_OK);
    const probeFile = path.join(candidatePath, `.ams_write_test_${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    return {
      configuredFolder,
      resolvedLocalPath: candidatePath,
      isWindowsHost: isWin,
      driveExists: true,
      folderExists: true,
      writable: true,
      requiresBrowserDDriveHelper: false,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      configuredFolder,
      resolvedLocalPath: candidatePath,
      isWindowsHost: isWin,
      driveExists: false,
      folderExists: fs.existsSync(candidatePath),
      writable: false,
      requiresBrowserDDriveHelper: false,
      error: `Backup folder "${configuredFolder}" is unavailable or not writable: ${msg}`,
    };
  }
}

/**
 * Resolves the permanent server-side backup directory:
 * - If the configured D-Drive / custom folder is directly writable on this host, uses it.
 * - Otherwise uses config.primaryBackupDir on the server disk so a verified server copy is always created.
 */
export function getBackupDirectory(): string {
  const dCheck = checkDDriveBackupFolderStatus();
  if (dCheck.writable && dCheck.resolvedLocalPath) {
    return dCheck.resolvedLocalPath;
  }

  const storageCheck = validatePermanentStorageLocation();
  if (!storageCheck.available && process.platform === 'win32') {
    throw new Error(
      storageCheck.warning ||
        `Permanent backup drive is unavailable (${config.primaryBackupDir}).`
    );
  }

  const defaultDir = config.primaryBackupDir;
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

/**
 * Formats current timestamp for backup filenames: YYYY-MM-DD_HH-mm-ss
 */
function formatBackupTimestamp(date = new Date()): string {
  return getPakistanFilenameStamp(date);
}

/**
 * Inspects and verifies any SQLite backup file on disk without modifying it.
 */
export function verifyBackupFile(filePath: string): BackupVerificationResult {
  const filename = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      filename,
      filePath,
      fileSizeBytes: 0,
      modifiedAt: '',
      integrityCheck: 'missing_file',
      tablesCount: 0,
      coreCounts: {
        items: 0,
        accounts: 0,
        purchases: 0,
        sales: 0,
        inventoryBatches: 0,
        journalEntries: 0,
        users: 0,
      },
      error: 'Backup file does not exist on disk.',
    };
  }

  const stats = fs.statSync(filePath);
  if (stats.size < 4096) {
    return {
      valid: false,
      filename,
      filePath,
      fileSizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      integrityCheck: 'invalid_size',
      tablesCount: 0,
      coreCounts: {
        items: 0,
        accounts: 0,
        purchases: 0,
        sales: 0,
        inventoryBatches: 0,
        journalEntries: 0,
        users: 0,
      },
      error: 'Backup file is too small to be a valid SQLite database.',
    };
  }

  const walSidecarPath = `${filePath}-wal`;
  const shmSidecarPath = `${filePath}-shm`;
  const hadWalBefore = fs.existsSync(walSidecarPath);
  const hadShmBefore = fs.existsSync(shmSidecarPath);

  let tempDb: Database.Database | null = null;
  try {
    tempDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = String(tempDb.pragma('integrity_check', { simple: true }) || '');
    const tables = tempDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ name: string }>;

    const tableSet = new Set(tables.map((t) => t.name));
    const requiredTables = ['items', 'accounts', 'sales', 'purchases', 'inventory', 'users'];
    const missingRequired = requiredTables.filter((t) => !tableSet.has(t));

    const safeCount = (tableName: string): number => {
      if (!tableSet.has(tableName)) return 0;
      const r = tempDb!.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get() as {
        cnt: number;
      };
      return Number(r?.cnt || 0);
    };

    const coreCounts = {
      items: safeCount('items'),
      accounts: safeCount('accounts'),
      purchases: safeCount('purchases'),
      sales: safeCount('sales'),
      inventoryBatches: safeCount('inventory'),
      journalEntries: safeCount('journal_entries'),
      cashBookVouchers: safeCount('cash_book_vouchers'),
      users: safeCount('users'),
    };

    const safeLatestTs = (sql: string, tableName: string): string | null => {
      if (!tableSet.has(tableName)) return null;
      try {
        const r = tempDb!.prepare(sql).get() as { ts?: string | null } | undefined;
        return r?.ts ? String(r.ts) : null;
      } catch {
        return null;
      }
    };

    const latestTimestamps = {
      latestSaleAt: safeLatestTs(
        'SELECT MAX(COALESCE(updated_at, created_at, invoice_date)) as ts FROM sales',
        'sales'
      ),
      latestPurchaseAt: safeLatestTs(
        'SELECT MAX(COALESCE(updated_at, created_at, bill_date)) as ts FROM purchases',
        'purchases'
      ),
      latestVoucherAt: safeLatestTs(
        'SELECT MAX(COALESCE(updated_at, created_at, voucher_date)) as ts FROM cash_book_vouchers',
        'cash_book_vouchers'
      ),
      latestItemAt: safeLatestTs(
        'SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM items',
        'items'
      ),
    };

    const isValid = integrity.toLowerCase() === 'ok' && missingRequired.length === 0;

    return {
      valid: isValid,
      filename,
      filePath,
      fileSizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      integrityCheck: integrity,
      tablesCount: tables.length,
      coreCounts,
      latestTimestamps,
      error: isValid
        ? undefined
        : missingRequired.length > 0
        ? `Backup is missing core tables: ${missingRequired.join(', ')}`
        : `SQLite integrity check failed: ${integrity}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      filename,
      filePath,
      fileSizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      integrityCheck: 'corrupted',
      tablesCount: 0,
      coreCounts: {
        items: 0,
        accounts: 0,
        purchases: 0,
        sales: 0,
        inventoryBatches: 0,
        journalEntries: 0,
        users: 0,
      },
      error: `Failed to open or verify SQLite backup file: ${msg}`,
    };
  } finally {
    if (tempDb) {
      try {
        tempDb.close();
      } catch {
        // ignore close error
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
 * Creates an immediate, consistent snapshot backup of the active SQLite database.
 */
export function createDatabaseBackup(options: {
  backupType: BackupType;
  createdBy?: string;
  notes?: string;
}): BackupRecord {
  const db = getDatabase();
  const backupDir = getBackupDirectory();
  const timestamp = formatBackupTimestamp(new Date());
  const filename = `AMS_Backup_${timestamp}_${options.backupType}.db`;
  const targetPath = path.join(backupDir, filename);

  // 1. Flush WAL to main database file so copy is 100% consistent
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // fallback to PASSIVE checkpoint if busy
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }
  }

  // 2. Use SQLite VACUUM INTO for an atomic, transactionally consistent backup copy
  try {
    const escapedPath = targetPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}';`);
  } catch {
    // Fallback to direct file copy if VACUUM INTO fails
    fs.copyFileSync(config.databasePath, targetPath);
  }

  // 3. Verify the created backup file immediately
  const verification = verifyBackupFile(targetPath);
  const summaryText = `Items: ${verification.coreCounts.items}, Accounts: ${verification.coreCounts.accounts}, Sales: ${verification.coreCounts.sales}, Purchases: ${verification.coreCounts.purchases}, Batches: ${verification.coreCounts.inventoryBatches}, JEs: ${verification.coreCounts.journalEntries}`;

  const status = verification.valid ? 'completed' : 'failed';
  const createdBy = options.createdBy || 'System';
  const notes =
    options.notes ||
    (options.backupType === 'daily_auto'
      ? 'Automatic scheduled daily database backup'
      : options.backupType === 'pre_change'
      ? 'Automatic safety backup prior to major database operation'
      : options.backupType === 'pre_restore_safety'
      ? 'Automatic safety backup created immediately before database restoration'
      : 'Manual on-demand database backup');

  const insertRes = db
    .prepare(
      `
      INSERT INTO backup_history (
        filename, file_path, backup_type, file_size_bytes,
        integrity_status, tables_count, records_summary,
        status, created_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      filename,
      targetPath,
      options.backupType,
      verification.fileSizeBytes,
      verification.integrityCheck,
      verification.tablesCount,
      summaryText,
      status,
      createdBy,
      notes
    );

  const createdRow = db
    .prepare('SELECT * FROM backup_history WHERE id = ?')
    .get(insertRes.lastInsertRowid) as BackupRecord;

  // Manual Control Only: Never automatically upload local backups to the cloud in the background.
  return {
    ...createdRow,
    file_exists: fs.existsSync(targetPath),
  };
}

/**
 * Manual Control Only: Automatic pre-change background backups are disabled so backups
 * occur strictly via explicit Super Admin action (or explicit pre-restore safety snapshot).
 */
export function triggerPreChangeBackupIfEnabled(_operationReason: string, _username = 'System'): BackupRecord | null {
  return null;
}

/**
 * Manual Control Only: Automatic daily scheduled backups are disabled.
 * Super Admin initiates backups explicitly via BACKUP & SYNC NOW.
 */
export function ensureDailyAutomaticBackup(): BackupRecord | null {
  return null;
}

/**
 * Lists all backups (syncing any physical .db files in the backup folder with backup_history).
 */
export function listBackups(): BackupRecord[] {
  const db = getDatabase();
  const backupDir = getBackupDirectory();

  // Discover any .db files in backupDir that might not be in backup_history (e.g., after a restore)
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    for (const file of files) {
      const existing = db
        .prepare('SELECT id FROM backup_history WHERE filename = ?')
        .get(file);
      if (!existing) {
        const fullPath = path.join(backupDir, file);
        const ver = verifyBackupFile(fullPath);
        let inferredType: BackupType = 'manual';
        if (file.includes('daily_auto')) inferredType = 'daily_auto';
        else if (file.includes('pre_change')) inferredType = 'pre_change';
        else if (file.includes('pre_restore_safety')) inferredType = 'pre_restore_safety';

        const summaryText = `Items: ${ver.coreCounts.items}, Accounts: ${ver.coreCounts.accounts}, Sales: ${ver.coreCounts.sales}, Purchases: ${ver.coreCounts.purchases}, Batches: ${ver.coreCounts.inventoryBatches}`;
        db.prepare(
          `
          INSERT OR IGNORE INTO backup_history (
            filename, file_path, backup_type, file_size_bytes,
            integrity_status, tables_count, records_summary,
            status, created_by, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'System', 'Discovered in backup directory', ?)
        `
        ).run(
          file,
          fullPath,
          inferredType,
          ver.fileSizeBytes,
          ver.integrityCheck,
          ver.tablesCount,
          summaryText,
          ver.valid ? 'completed' : 'failed',
          ver.modifiedAt || new Date().toISOString()
        );
      }
    }
  }

  const rows = db
    .prepare('SELECT * FROM backup_history ORDER BY id DESC LIMIT 100')
    .all() as BackupRecord[];

  return rows.map((r) => ({
    ...r,
    file_exists: fs.existsSync(r.file_path),
  }));
}

/**
 * Restores the database from a verified backup file:
 * 1. Verifies backup integrity before touching current database.
 * 2. Creates an automatic safety backup of the current database before restoration.
 * 3. Safely closes the current DB connection, replaces the DB file, reopens, and runs migrations.
 */
export function restoreDatabaseFromBackup(options: {
  backupId?: number;
  filename?: string;
  restoredBy: string;
}): {
  success: boolean;
  dbResetEpoch: string;
  safetyBackup: BackupRecord;
  restoredVerification: BackupVerificationResult;
  message: string;
} {
  const db = getDatabase();
  const backupDir = getBackupDirectory();

  let targetFilePath = '';
  let targetFilename = '';

  if (options.backupId) {
    const row = db
      .prepare('SELECT * FROM backup_history WHERE id = ?')
      .get(options.backupId) as BackupRecord | undefined;
    if (!row) {
      throw new Error(`Backup record #${options.backupId} not found.`);
    }
    targetFilePath = row.file_path;
    targetFilename = row.filename;
  } else if (options.filename) {
    const safeName = path.basename(options.filename);
    targetFilePath = path.join(backupDir, safeName);
    targetFilename = safeName;
  } else {
    throw new Error('Backup ID or filename is required for restoration.');
  }

  // Step 1: Verify candidate backup integrity BEFORE making any changes
  const verification = verifyBackupFile(targetFilePath);
  if (!verification.valid) {
    throw new Error(
      verification.error ||
        `Backup file "${targetFilename}" failed SQLite integrity verification (${verification.integrityCheck}). Restoration aborted to protect existing data.`
    );
  }

  // Step 2: Automatically create a safety backup of the current live database before restoration
  const safetyBackup = createDatabaseBackup({
    backupType: 'pre_restore_safety',
    createdBy: options.restoredBy,
    notes: `Safety snapshot taken automatically prior to restoring ${targetFilename}`,
  });

  // Step 3: Close current connection, clean WAL/SHM sidecars, copy verified backup over live DB, and reopen
  closeDatabaseConnection();

  try {
    const walPath = `${config.databasePath}-wal`;
    const shmPath = `${config.databasePath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    fs.copyFileSync(targetFilePath, config.databasePath);
  } catch (copyErr: unknown) {
    // Reopen and rethrow if copy failed
    reopenDatabaseConnection();
    const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
    throw new Error(`Failed to replace database file during restoration: ${msg}`);
  }

  // Step 4: Reopen connection and run idempotent migrations so all tables (including backup_history) are up to date
  const newDb = reopenDatabaseConnection();
  runMigrations();
  const { epoch: restoredEpoch } = bumpDbResetEpoch(newDb, `restore:${targetFilename}`);

  // Re-sync backup directory files into backup_history of the restored DB
  listBackups();

  // Mark the restored backup record and log audit trail
  newDb
    .prepare(
      `
      UPDATE backup_history
      SET status = 'restored',
          notes = COALESCE(notes, '') || ' [Restored on ' || CURRENT_TIMESTAMP || ' by ' || ? || ']'
      WHERE filename = ?
    `
    )
    .run(options.restoredBy, targetFilename);

  newDb
    .prepare(
      `
      INSERT INTO auth_audit_logs (username, action, status, details)
      VALUES (?, 'DATABASE_RESTORE', 'WARNING', ?)
    `
    )
    .run(
      options.restoredBy,
      `Restored database from ${targetFilename} (Safety backup created: ${safetyBackup.filename})`
    );

  // Only sync restored database to Cloud when actively in ONLINE mode; never initiate cloud calls in OFFLINE mode
  if (!isOfflineOperatingMode()) {
    syncDatabaseToCloudSQL(`restore:${targetFilename}`).catch(() => {});
  }

  return {
    success: true,
    dbResetEpoch: restoredEpoch,
    safetyBackup,
    restoredVerification: verification,
    message: `Database successfully restored from "${targetFilename}". A pre-restoration safety backup ("${safetyBackup.filename}") was saved.`,
  };
}

/**
 * Logs an application or database error safely without exposing sensitive internals to ordinary users.
 */
export function logSystemError(params: {
  severity?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  module: string;
  operation: string;
  userMessage: string;
  technicalDetails?: string;
  username?: string;
}): void {
  try {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO system_error_logs (
        severity, module, operation, user_message, technical_details, username
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      params.severity || 'ERROR',
      params.module,
      params.operation,
      params.userMessage,
      params.technicalDetails || '',
      params.username || 'System'
    );
  } catch (err) {
    console.error('[AMS Error Logger] Failed to write error log:', err);
  }
}

/**
 * Returns local network IPv4 addresses for Multi-Computer LAN access readiness.
 */
export function getLocalNetworkAddresses(): Array<{ interfaceName: string; address: string; url: string }> {
  const results: Array<{ interfaceName: string; address: string; url: string }> = [];
  try {
    const nets = os.networkInterfaces();
    for (const [name, netList] of Object.entries(nets)) {
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          results.push({
            interfaceName: name,
            address: net.address,
            url: `http://${net.address}:${config.port}`,
          });
        }
      }
    }
  } catch {
    // ignore os interface errors
  }
  return results;
}

/**
 * Generates sequential backup filename in the exact format:
 * Abrar_Backup_YYYY-MM-DD_NNN.db (e.g., Abrar_Backup_2026-04-06_001.db)
 */
export function getNextNumberedBackupFilename(date = new Date()): string {
  const datePart = getPakistanDateISO(date);
  const prefix = `Abrar_Backup_${datePart}_`;

  const backupDir = getBackupDirectory();
  let maxSeq = 0;

  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const f of files) {
      if (f.startsWith(prefix) && f.endsWith('.db')) {
        const seqPart = f.slice(prefix.length, f.length - 3);
        const parsed = parseInt(seqPart, 10);
        if (!Number.isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
  }

  try {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT filename FROM backup_history WHERE filename LIKE ?')
      .all(`${prefix}%.db`) as Array<{ filename: string }>;
    for (const r of rows) {
      const f = String(r.filename || '');
      if (f.startsWith(prefix) && f.endsWith('.db')) {
        const seqPart = f.slice(prefix.length, f.length - 3);
        const parsed = parseInt(seqPart, 10);
        if (!Number.isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
  } catch {
    // ignore
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}${nextSeq}.db`;
}

export interface CreatedNumberedBackupResult extends BackupRecord {
  localFolderPath: string;
  verification: BackupVerificationResult;
  sha256: string;
  writtenDirectlyToDDrive: boolean;
  requiresBrowserDDriveSave: boolean;
  dDriveTargetFolder: string;
  dDriveExactFilePath: string | null;
  dDriveError: string | null;
}

/**
 * Creates a verified SQLite .db backup using the required Abrar_Backup_YYYY-MM-DD_NNN.db naming convention,
 * verifies D-Drive folder availability/writability, verifies SQLite integrity + SHA-256 hash after creation,
 * and applies the retention policy.
 */
export function createNumberedAbrarBackup(options: {
  backupType?: BackupType;
  createdBy?: string;
  notes?: string;
  localTargetFolder?: string;
  requireDirectDDriveWrite?: boolean;
}): CreatedNumberedBackupResult {
  const db = getDatabase();
  const dCheck = checkDDriveBackupFolderStatus(options.localTargetFolder);

  if (options.requireDirectDDriveWrite && !dCheck.writable && !dCheck.requiresBrowserDDriveHelper) {
    updatePersistedOperatingModeState({
      dDriveBackupStatus: 'Failed',
      dDriveBackupError: dCheck.error || `D Drive (${dCheck.configuredFolder}) is unavailable or not writable.`,
    });
    throw new Error(
      dCheck.error || `D Drive (${dCheck.configuredFolder}) is unavailable or not writable.`
    );
  }

  const backupDir = dCheck.writable && dCheck.resolvedLocalPath
    ? dCheck.resolvedLocalPath
    : config.primaryBackupDir;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const filename = getNextNumberedBackupFilename(new Date());
  const targetPath = path.join(backupDir, filename);
  const backupType: BackupType = options.backupType || 'manual';

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore
    }
  }

  try {
    const escapedPath = targetPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}';`);
  } catch {
    fs.copyFileSync(config.databasePath, targetPath);
  }

  const verification = verifyBackupFile(targetPath);
  if (!verification.valid) {
    throw new Error(verification.error || 'Backup file failed integrity verification.');
  }

  const fileBuf = fs.readFileSync(targetPath);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  verification.sha256 = sha256;

  // Also ensure a copy exists in config.primaryBackupDir if backupDir is a different folder
  try {
    if (path.resolve(backupDir) !== path.resolve(config.primaryBackupDir)) {
      if (!fs.existsSync(config.primaryBackupDir)) {
        fs.mkdirSync(config.primaryBackupDir, { recursive: true });
      }
      const primaryCopyPath = path.join(config.primaryBackupDir, filename);
      if (!fs.existsSync(primaryCopyPath)) {
        fs.copyFileSync(targetPath, primaryCopyPath);
      }
    }
  } catch {
    // ignore secondary mirror warning
  }

  const writtenDirectlyToDDrive = Boolean(dCheck.writable && dCheck.resolvedLocalPath);
  const dDriveTargetFolder = dCheck.configuredFolder;
  const dDriveExactFilePath = writtenDirectlyToDDrive
    ? dCheck.configuredFolder.includes('\\')
      ? `${dCheck.configuredFolder.replace(/\\+$/, '')}\\${filename}`
      : path.join(dCheck.resolvedLocalPath!, filename)
    : null;
  const completedIso = new Date().toISOString();

  const summaryText = `Items: ${verification.coreCounts.items}, Accounts: ${verification.coreCounts.accounts}, Sales: ${verification.coreCounts.sales}, Purchases: ${verification.coreCounts.purchases}, Batches: ${verification.coreCounts.inventoryBatches}, JEs: ${verification.coreCounts.journalEntries}`;
  const createdBy = options.createdBy || 'Super Admin';
  const notes =
    options.notes ||
    (writtenDirectlyToDDrive
      ? `Verified D-Drive Backup (${dDriveExactFilePath})`
      : `Verified Server SQLite Backup (${targetPath})`);

  const insertRes = db
    .prepare(
      `
      INSERT INTO backup_history (
        filename, file_path, backup_type, file_size_bytes,
        integrity_status, tables_count, records_summary,
        status, created_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `
    )
    .run(
      filename,
      targetPath,
      backupType,
      verification.fileSizeBytes,
      verification.integrityCheck,
      verification.tablesCount,
      summaryText,
      createdBy,
      notes
    );

  const createdRow = db
    .prepare('SELECT * FROM backup_history WHERE id = ?')
    .get(insertRes.lastInsertRowid) as BackupRecord;

  try {
    db.prepare(
      `UPDATE company_settings
       SET last_successful_backup_at = ?,
           last_backup_filename = ?,
           last_backup_path = ?`
    ).run(completedIso, filename, dDriveExactFilePath || targetPath);
  } catch {
    // ignore if columns not yet migrated
  }

  updatePersistedOperatingModeState({
    localBackupStatus: 'Successful',
    lastSuccessfulBackupAt: completedIso,
    lastBackupFilename: filename,
    lastBackupPath: dDriveExactFilePath || targetPath,
    lastBackupSizeBytes: verification.fileSizeBytes,
    lastBackupSha256: sha256,
    lastBackupError: null,
    dDriveConfiguredFolder: dDriveTargetFolder,
    dDriveBackupStatus: writtenDirectlyToDDrive
      ? 'Successful'
      : dCheck.requiresBrowserDDriveHelper
      ? 'Pending Save'
      : 'Failed',
    dDriveBackupPath: dDriveExactFilePath,
    dDriveBackupError: writtenDirectlyToDDrive ? null : dCheck.error,
  });

  // Apply retention policy
  applyBackupRetentionPolicy();

  return {
    ...createdRow,
    file_exists: fs.existsSync(targetPath),
    localFolderPath: writtenDirectlyToDDrive ? dDriveTargetFolder : backupDir,
    verification,
    sha256,
    writtenDirectlyToDDrive,
    requiresBrowserDDriveSave: dCheck.requiresBrowserDDriveHelper,
    dDriveTargetFolder,
    dDriveExactFilePath,
    dDriveError: writtenDirectlyToDDrive ? null : dCheck.error,
  };
}

/**
 * Enforces retention policy:
 * - Keep last 7 daily backups (configurable via daily_retention_count)
 * - Keep last 4 weekly backups (configurable via weekly_retention_count)
 * - Never delete the latest verified backup
 */
export function applyBackupRetentionPolicy(): { prunedCount: number } {
  let prunedCount = 0;
  try {
    const db = getDatabase();
    const settings = db
      .prepare('SELECT daily_retention_count, weekly_retention_count FROM company_settings LIMIT 1')
      .get() as { daily_retention_count?: number; weekly_retention_count?: number } | undefined;

    const keepDaily = Math.max(1, Number(settings?.daily_retention_count || 7));
    const keepWeekly = Math.max(1, Number(settings?.weekly_retention_count || 4));

    const latestVerified = db
      .prepare("SELECT id FROM backup_history WHERE status = 'completed' ORDER BY id DESC LIMIT 1")
      .get() as { id: number } | undefined;
    const protectedId = latestVerified?.id || -1;

    const dailyAutoBackups = db
      .prepare("SELECT id, file_path FROM backup_history WHERE backup_type = 'daily_auto' AND status = 'completed' ORDER BY id DESC")
      .all() as Array<{ id: number; file_path: string }>;

    if (dailyAutoBackups.length > keepDaily + keepWeekly) {
      const toPrune = dailyAutoBackups.slice(keepDaily + keepWeekly);
      for (const b of toPrune) {
        if (b.id === protectedId) continue;
        if (b.file_path && fs.existsSync(b.file_path)) {
          try {
            fs.unlinkSync(b.file_path);
            prunedCount++;
          } catch {
            // ignore unlink error
          }
        }
        db.prepare("UPDATE backup_history SET status = 'archived_pruned' WHERE id = ?").run(b.id);
      }
    }
  } catch {
    // ignore retention errors
  }
  return { prunedCount };
}

/**
 * Attempts multi-stage non-destructive repair & salvage of a corrupted uploaded SQLite backup:
 * - Stage 1: REINDEX + VACUUM INTO on a disposable copy (fixes B-tree index / freelist page errors with 0% row loss).
 * - Stage 2: Table-by-table & rowid-chunk binary fallback extraction into a clean verified SQLite database.
 */
function salvageCorruptedSqliteBackup(
  rawFilePath: string,
  repairedTargetPath: string
): {
  recovered: boolean;
  method: string;
  warnings: string[];
  verification: BackupVerificationResult;
} {
  const warnings: string[] = [];
  const tempWorkCopy = `${rawFilePath}.repair_work.db`;

  const cleanupTempWork = () => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(`${tempWorkCopy}${suffix}`)) {
          fs.unlinkSync(`${tempWorkCopy}${suffix}`);
        }
      } catch {}
    }
  };

  // Stage 1: REINDEX + VACUUM INTO on a disposable working copy
  try {
    cleanupTempWork();
    if (fs.existsSync(repairedTargetPath)) fs.unlinkSync(repairedTargetPath);
    fs.copyFileSync(rawFilePath, tempWorkCopy);
    const workDb = new Database(tempWorkCopy);
    try {
      try {
        workDb.pragma('journal_mode = DELETE');
      } catch {}
      try {
        workDb.exec('REINDEX;');
      } catch (reindexErr) {
        warnings.push(
          `REINDEX warning: ${reindexErr instanceof Error ? reindexErr.message : String(reindexErr)}`
        );
      }
      const escapedTarget = repairedTargetPath.replace(/'/g, "''");
      workDb.exec(`VACUUM INTO '${escapedTarget}';`);
    } finally {
      try {
        workDb.close();
      } catch {}
    }

    const stage1Ver = verifyBackupFile(repairedTargetPath);
    if (stage1Ver.valid) {
      cleanupTempWork();
      return {
        recovered: true,
        method: 'REINDEX + VACUUM INTO (Full Index & Page Repair)',
        warnings,
        verification: stage1Ver,
      };
    }
  } catch (stage1Err) {
    warnings.push(
      `Stage 1 (REINDEX/VACUUM) could not complete: ${
        stage1Err instanceof Error ? stage1Err.message : String(stage1Err)
      }`
    );
  } finally {
    cleanupTempWork();
  }

  // Stage 2: Table-by-table & rowid-chunk salvage into fresh clean SQLite file
  try {
    if (fs.existsSync(repairedTargetPath)) fs.unlinkSync(repairedTargetPath);
  } catch {}

  let sourceDb: Database.Database | null = null;
  let destDb: Database.Database | null = null;

  try {
    try {
      sourceDb = new Database(rawFilePath, { readonly: true, fileMustExist: true });
    } catch {
      // Fallback: copy to tempWorkCopy and open normal readwrite/recovery
      fs.copyFileSync(rawFilePath, tempWorkCopy);
      sourceDb = new Database(tempWorkCopy, { fileMustExist: true });
    }

    destDb = new Database(repairedTargetPath);
    destDb.pragma('journal_mode = DELETE');
    destDb.pragma('synchronous = OFF');
    destDb.pragma('foreign_keys = OFF');

    let tableDefs: Array<{ name: string; sql: string }> = [];
    let indexDefs: Array<{ name: string; sql: string }> = [];

    try {
      tableDefs = sourceDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
        )
        .all() as Array<{ name: string; sql: string }>;
      indexDefs = sourceDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
        )
        .all() as Array<{ name: string; sql: string }>;
    } catch (masterErr) {
      warnings.push(
        `Uploaded sqlite_master was partially unreadable (${
          masterErr instanceof Error ? masterErr.message : String(masterErr)
        }); using active application schema template.`
      );
      const liveDb = getDatabase();
      tableDefs = liveDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
        )
        .all() as Array<{ name: string; sql: string }>;
      indexDefs = liveDb
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
        )
        .all() as Array<{ name: string; sql: string }>;
    }

    // Create tables inside fresh clean destination DB
    for (const td of tableDefs) {
      try {
        destDb.exec(td.sql);
      } catch {
        // ignore duplicate/constraint DDL edge cases
      }
    }

    let totalRowsSalvaged = 0;
    for (const td of tableDefs) {
      const tbl = td.name;
      const destCols = (destDb.prepare(`PRAGMA table_info("${tbl}")`).all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      if (destCols.length === 0) continue;

      let sourceCols: string[] = destCols;
      try {
        const sCols = (sourceDb.prepare(`PRAGMA table_info("${tbl}")`).all() as Array<{ name: string }>).map(
          (c) => c.name
        );
        if (sCols.length > 0) sourceCols = sCols;
      } catch {}

      const destSet = new Set(destCols);
      const sharedCols = sourceCols.filter((c) => destSet.has(c));
      if (sharedCols.length === 0) continue;

      const selectExpr = sharedCols.map((c) => `"${c}"`).join(', ');
      const placeholders = sharedCols.map(() => '?').join(', ');
      const insertStmt = destDb.prepare(
        `INSERT OR IGNORE INTO "${tbl}" (${selectExpr}) VALUES (${placeholders})`
      );

      const insertBatch = destDb.transaction((rows: Array<Record<string, unknown>>) => {
        for (const row of rows) {
          insertStmt.run(...sharedCols.map((c) => row[c]));
        }
      });

      try {
        const allRows = sourceDb
          .prepare(`SELECT ${selectExpr} FROM "${tbl}"`)
          .all() as Array<Record<string, unknown>>;
        insertBatch(allRows);
        totalRowsSalvaged += allRows.length;
      } catch {
        // Table has corrupt internal page(s): salvage intact rowid chunks around damaged pages!
        let minRowId = 1;
        let maxRowId = 0;
        let hasRowId = true;
        try {
          const bounds = sourceDb
            .prepare(`SELECT MIN(rowid) as minId, MAX(rowid) as maxId FROM "${tbl}"`)
            .get() as { minId?: number; maxId?: number } | undefined;
          minRowId = Number(bounds?.minId || 1);
          maxRowId = Number(bounds?.maxId || 0);
        } catch {
          hasRowId = false;
        }

        if (!hasRowId || maxRowId <= 0) {
          warnings.push(`Table "${tbl}" had unreadable pages and could not be scanned.`);
          continue;
        }

        let rescuedForTable = 0;
        let skippedRowIds = 0;
        const CHUNK = 50;
        const chunkStmt = sourceDb.prepare(
          `SELECT ${selectExpr} FROM "${tbl}" WHERE rowid >= ? AND rowid <= ?`
        );
        const singleStmt = sourceDb.prepare(`SELECT ${selectExpr} FROM "${tbl}" WHERE rowid = ?`);

        for (let start = minRowId; start <= maxRowId; start += CHUNK) {
          const end = Math.min(maxRowId, start + CHUNK - 1);
          try {
            const chunkRows = chunkStmt.all(start, end) as Array<Record<string, unknown>>;
            if (chunkRows.length > 0) {
              insertBatch(chunkRows);
              rescuedForTable += chunkRows.length;
              totalRowsSalvaged += chunkRows.length;
            }
          } catch {
            // Scan single rowids in damaged chunk so only corrupted individual records are skipped
            for (let rid = start; rid <= end; rid++) {
              try {
                const row = singleStmt.get(rid) as Record<string, unknown> | undefined;
                if (row) {
                  insertBatch([row]);
                  rescuedForTable++;
                  totalRowsSalvaged++;
                }
              } catch {
                skippedRowIds++;
              }
            }
          }
        }

        warnings.push(
          `Table "${tbl}": salvaged ${rescuedForTable} intact row(s)${
            skippedRowIds > 0 ? ` (${skippedRowIds} rowid slot(s) on physically damaged page unreadable)` : ''
          }.`
        );
      }
    }

    // Salvage sqlite_sequence if available
    try {
      const seqRows = sourceDb.prepare('SELECT name, seq FROM sqlite_sequence').all() as Array<{
        name: string;
        seq: number;
      }>;
      const destSeqExists = destDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
        .get();
      if (destSeqExists && seqRows.length > 0) {
        const upSeq = destDb.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)');
        for (const s of seqRows) {
          upSeq.run(s.name, s.seq);
        }
      }
    } catch {}

    // Rebuild clean indexes
    for (const idx of indexDefs) {
      try {
        destDb.exec(idx.sql);
      } catch {}
    }

    destDb.pragma('foreign_keys = ON');
    destDb.exec('REINDEX;');
    destDb.close();
    destDb = null;
    sourceDb.close();
    sourceDb = null;
    cleanupTempWork();

    const stage2Ver = verifyBackupFile(repairedTargetPath);
    if (stage2Ver.valid && totalRowsSalvaged > 0) {
      return {
        recovered: true,
        method: 'Row-by-Row SQLite Salvage Recovery',
        warnings,
        verification: stage2Ver,
      };
    }

    return {
      recovered: false,
      method: 'failed',
      warnings,
      verification: stage2Ver,
    };
  } catch (err) {
    try {
      destDb?.close();
    } catch {}
    try {
      sourceDb?.close();
    } catch {}
    cleanupTempWork();
    const errMsg = err instanceof Error ? err.message : String(err);
    warnings.push(errMsg);
    return {
      recovered: false,
      method: 'failed',
      warnings,
      verification: verifyBackupFile(repairedTargetPath),
    };
  }
}

/**
 * Stages an uploaded .db file from the user's hard drive into the backup directory and verifies its SQLite integrity.
 * If the uploaded .db file has index, freelist, WAL-sidecar, or page corruption, automatically runs multi-stage
 * SQLite salvage recovery so real business data is preserved and verified cleanly before restoration.
 */
export function stageAndVerifyUploadedBackup(params: {
  originalFilename: string;
  fileBuffer: Buffer;
  uploadedBy: string;
}): {
  valid: boolean;
  stagedFilename: string;
  stagedPath: string;
  backupId?: number;
  repairedFromCorruption?: boolean;
  repairMethod?: string;
  salvageWarnings?: string[];
  verification: BackupVerificationResult;
} {
  const backupDir = getBackupDirectory();
  const safeBase = path
    .basename(params.originalFilename || 'Uploaded_Backup.db')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = safeBase.endsWith('.db') ? safeBase : `${safeBase}.db`;
  const stagedPath = path.join(backupDir, finalName);

  // Support gzip-compressed SQLite backups transparently if compressed on disk/download
  let decodedBuffer = params.fileBuffer;
  if (
    decodedBuffer.length >= 2 &&
    decodedBuffer[0] === 0x1f &&
    decodedBuffer[1] === 0x8b
  ) {
    try {
      decodedBuffer = zlib.gunzipSync(decodedBuffer);
    } catch {
      // Keep original buffer if not valid gzip
    }
  }

  fs.writeFileSync(stagedPath, decodedBuffer);
  let verification = verifyBackupFile(stagedPath);
  let activeStagedName = finalName;
  let activeStagedPath = stagedPath;
  let repairedFromCorruption = false;
  let repairMethod: string | undefined;
  let salvageWarnings: string[] = [];

  if (!verification.valid) {
    const headerStr = decodedBuffer.subarray(0, 15).toString('utf8');
    if (headerStr !== 'SQLite format 3') {
      try {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      } catch {}
      const hexPreview = decodedBuffer.subarray(0, 16).toString('hex');
      verification.error = `The selected file (${decodedBuffer.length} bytes) does not contain a valid SQLite database header (found bytes: ${hexPreview || 'empty'}). Please verify it is a real .db backup file and not an HTML error page or empty file.`;
      return {
        valid: false,
        stagedFilename: finalName,
        stagedPath,
        verification,
      };
    }

    const repairedName = `Salvaged_${finalName}`;
    const repairedPath = path.join(backupDir, repairedName);
    const salvage = salvageCorruptedSqliteBackup(stagedPath, repairedPath);

    try {
      if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    } catch {}

    if (!salvage.recovered || !salvage.verification.valid) {
      try {
        if (fs.existsSync(repairedPath)) fs.unlinkSync(repairedPath);
      } catch {}
      return {
        valid: false,
        stagedFilename: finalName,
        stagedPath,
        repairedFromCorruption: false,
        salvageWarnings: salvage.warnings,
        verification: {
          ...salvage.verification,
          error:
            salvage.verification.error ||
            `Automatic SQLite salvage could not recover intact business tables (${salvage.warnings.join('; ') || 'unreadable file'}).`,
        },
      };
    }

    activeStagedName = repairedName;
    activeStagedPath = repairedPath;
    repairedFromCorruption = true;
    repairMethod = salvage.method;
    salvageWarnings = salvage.warnings;
    verification = {
      ...salvage.verification,
      repairedFromCorruption: true,
      repairMethod: salvage.method,
      salvageWarnings: salvage.warnings,
    };
  }

  const db = getDatabase();
  const summaryText = `Items: ${verification.coreCounts.items}, Accounts: ${verification.coreCounts.accounts}, Sales: ${verification.coreCounts.sales}, Purchases: ${verification.coreCounts.purchases}, Batches: ${verification.coreCounts.inventoryBatches}, Cashbook: ${verification.coreCounts.cashBookVouchers ?? 0}, JEs: ${verification.coreCounts.journalEntries}`;

  const existing = db
    .prepare('SELECT id FROM backup_history WHERE filename = ?')
    .get(activeStagedName) as { id: number } | undefined;

  let backupId: number;
  if (existing) {
    db.prepare(
      `UPDATE backup_history
       SET file_path = ?, file_size_bytes = ?, integrity_status = ?, tables_count = ?, records_summary = ?, status = 'completed'
       WHERE id = ?`
    ).run(
      activeStagedPath,
      verification.fileSizeBytes,
      verification.integrityCheck,
      verification.tablesCount,
      summaryText,
      existing.id
    );
    backupId = existing.id;
  } else {
    const ins = db
      .prepare(
        `INSERT INTO backup_history (
          filename, file_path, backup_type, file_size_bytes,
          integrity_status, tables_count, records_summary,
          status, created_by, notes
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, 'completed', ?, ?)`
      )
      .run(
        activeStagedName,
        activeStagedPath,
        verification.fileSizeBytes,
        verification.integrityCheck,
        verification.tablesCount,
        summaryText,
        params.uploadedBy,
        repairedFromCorruption
          ? `Uploaded & automatically salvaged from corrupted backup (${repairMethod})`
          : 'Uploaded from local hard drive for restoration'
      );
    backupId = Number(ins.lastInsertRowid);
  }

  return {
    valid: true,
    stagedFilename: activeStagedName,
    stagedPath: activeStagedPath,
    backupId,
    repairedFromCorruption,
    repairMethod,
    salvageWarnings,
    verification,
  };
}

