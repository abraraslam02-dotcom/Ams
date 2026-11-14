import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import {
  getDatabase,
  closeDatabaseConnection,
  reopenDatabaseConnection,
} from '../db/connection.ts';
import { runMigrations } from '../db/migrations.ts';
import { bumpDbResetEpoch } from '../db/resetState.ts';
import {
  uploadBackupToCloudSQL,
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
  coreCounts: {
    items: number;
    accounts: number;
    purchases: number;
    sales: number;
    inventoryBatches: number;
    journalEntries: number;
    users: number;
  };
  error?: string;
}

/**
 * Resolves the configured backup directory from company_settings or defaults to data/backups
 */
export function getBackupDirectory(): string {
  const runtimeBaseDir = path.dirname(config.databasePath);
  const defaultDir = path.resolve(runtimeBaseDir, 'backups');

  try {
    const db = getDatabase();
    const row = db
      .prepare('SELECT backup_directory FROM company_settings LIMIT 1')
      .get() as { backup_directory?: string } | undefined;
    const customDir = row?.backup_directory ? String(row.backup_directory).trim() : '';
    if (customDir && customDir !== 'data/backups' && customDir !== './data/backups') {
      const candidate = path.isAbsolute(customDir)
        ? customDir
        : path.resolve(runtimeBaseDir, customDir);
      // Never write runtime backups inside the source workspace directory
      const workspaceRoot = path.resolve(process.cwd());
      if (!candidate.startsWith(workspaceRoot)) {
        if (!fs.existsSync(candidate)) {
          fs.mkdirSync(candidate, { recursive: true });
        }
        return candidate;
      }
    }
  } catch {
    // Fallback to default runtime backup directory
  }

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

/**
 * Formats current timestamp for backup filenames: YYYY-MM-DD_HH-mm-ss
 */
function formatBackupTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}-${ms}`;
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
      users: safeCount('users'),
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

  // Asynchronously mirror backup to permanent Cloud SQL storage
  uploadBackupToCloudSQL({
    filename,
    filePath: targetPath,
    backupType: options.backupType,
    notes,
    counts: verification.coreCounts,
  }).catch(() => {});

  return {
    ...createdRow,
    file_exists: fs.existsSync(targetPath),
  };
}

/**
 * Triggers an automatic backup before major database changes if enabled in company_settings.
 */
export function triggerPreChangeBackupIfEnabled(operationReason: string, username = 'System'): BackupRecord | null {
  try {
    const db = getDatabase();
    const settings = db
      .prepare('SELECT auto_backup_before_changes FROM company_settings LIMIT 1')
      .get() as { auto_backup_before_changes?: number } | undefined;

    if (settings && Number(settings.auto_backup_before_changes) === 0) {
      return null;
    }

    return createDatabaseBackup({
      backupType: 'pre_change',
      createdBy: username,
      notes: `Pre-change safety backup before: ${operationReason}`,
    });
  } catch (err) {
    console.warn('[AMS Backup] Pre-change backup warning:', err);
    return null;
  }
}

/**
 * Checks and runs automatic daily backup if enabled and not yet created today.
 */
export function ensureDailyAutomaticBackup(): BackupRecord | null {
  try {
    const db = getDatabase();
    const settings = db
      .prepare('SELECT auto_daily_backup FROM company_settings LIMIT 1')
      .get() as { auto_daily_backup?: number } | undefined;

    if (settings && Number(settings.auto_daily_backup) === 0) {
      return null;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const existingToday = db
      .prepare(
        `
        SELECT id FROM backup_history
        WHERE backup_type = 'daily_auto'
          AND status = 'completed'
          AND DATE(created_at) = DATE(?)
        LIMIT 1
      `
      )
      .get(todayStr);

    if (existingToday) {
      return null;
    }

    return createDatabaseBackup({
      backupType: 'daily_auto',
      createdBy: 'System Scheduler',
      notes: `Automatic Daily Backup for ${todayStr}`,
    });
  } catch (err) {
    console.warn('[AMS Backup] Daily automatic backup check failed:', err);
    return null;
  }
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

  // Immediately sync restored database to Cloud SQL permanent storage
  syncDatabaseToCloudSQL(`restore:${targetFilename}`).catch(() => {});

  return {
    success: true,
    dbResetEpoch: restoredEpoch,
    safetyBackup,
    restoredVerification: verification,
    message: `Database successfully restored from "${targetFilename}". A pre-restoration safety backup ("${safetyBackup.filename}") was automatically saved.`,
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
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const datePart = `${yyyy}-${mm}-${dd}`;
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

/**
 * Creates a verified SQLite .db backup using the required Abrar_Backup_YYYY-MM-DD_NNN.db naming convention
 * and applies the retention policy (keep last 7 daily backups, last 4 weekly backups, never delete latest verified backup).
 */
export function createNumberedAbrarBackup(options: {
  backupType?: BackupType;
  createdBy?: string;
  notes?: string;
  localTargetFolder?: string;
}): BackupRecord & { localFolderPath: string; verification: BackupVerificationResult } {
  const db = getDatabase();
  const backupDir = getBackupDirectory();
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

  const settingsRow = db
    .prepare('SELECT local_backup_folder FROM company_settings LIMIT 1')
    .get() as { local_backup_folder?: string } | undefined;
  const localFolderPath =
    options.localTargetFolder ||
    settingsRow?.local_backup_folder ||
    'D:\\Abrar Medical Store Backups';

  const summaryText = `Items: ${verification.coreCounts.items}, Accounts: ${verification.coreCounts.accounts}, Sales: ${verification.coreCounts.sales}, Purchases: ${verification.coreCounts.purchases}, Batches: ${verification.coreCounts.inventoryBatches}, JEs: ${verification.coreCounts.journalEntries}`;
  const createdBy = options.createdBy || 'Super Admin';
  const notes =
    options.notes ||
    `Verified Local Hard Drive Backup (${localFolderPath}\\${filename})`;

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

  // Apply retention policy automatically
  applyBackupRetentionPolicy();

  // Mirror to Cloud SQL storage
  uploadBackupToCloudSQL({
    filename,
    filePath: targetPath,
    backupType,
    notes,
    counts: verification.coreCounts,
  }).catch(() => {});

  return {
    ...createdRow,
    file_exists: fs.existsSync(targetPath),
    localFolderPath,
    verification,
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
 * Stages an uploaded .db file from the user's hard drive into the backup directory and verifies its SQLite integrity.
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
  verification: BackupVerificationResult;
} {
  const backupDir = getBackupDirectory();
  const safeBase = path.basename(params.originalFilename || 'Uploaded_Backup.db').replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = safeBase.endsWith('.db') ? safeBase : `${safeBase}.db`;
  const stagedPath = path.join(backupDir, finalName);

  fs.writeFileSync(stagedPath, params.fileBuffer);
  const verification = verifyBackupFile(stagedPath);

  if (!verification.valid) {
    try {
      if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    } catch {
      // ignore
    }
    return {
      valid: false,
      stagedFilename: finalName,
      stagedPath,
      verification,
    };
  }

  const db = getDatabase();
  const summaryText = `Items: ${verification.coreCounts.items}, Accounts: ${verification.coreCounts.accounts}, Sales: ${verification.coreCounts.sales}, Purchases: ${verification.coreCounts.purchases}, Batches: ${verification.coreCounts.inventoryBatches}, JEs: ${verification.coreCounts.journalEntries}`;

  const existing = db
    .prepare('SELECT id FROM backup_history WHERE filename = ?')
    .get(finalName) as { id: number } | undefined;

  let backupId: number;
  if (existing) {
    db.prepare(
      `UPDATE backup_history
       SET file_path = ?, file_size_bytes = ?, integrity_status = ?, tables_count = ?, records_summary = ?, status = 'completed'
       WHERE id = ?`
    ).run(
      stagedPath,
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
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, 'completed', ?, 'Uploaded from local hard drive for restoration')`
      )
      .run(
        finalName,
        stagedPath,
        verification.fileSizeBytes,
        verification.integrityCheck,
        verification.tablesCount,
        summaryText,
        params.uploadedBy
      );
    backupId = Number(ins.lastInsertRowid);
  }

  return {
    valid: true,
    stagedFilename: finalName,
    stagedPath,
    backupId,
    verification,
  };
}

