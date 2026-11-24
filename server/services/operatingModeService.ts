import fs from 'fs';
import crypto from 'crypto';
import { config, validatePermanentStorageLocation } from '../config.ts';
import {
  getDatabase,
  checkDatabaseConnection,
  checkpointDatabaseWal,
} from '../db/connection.ts';
import {
  getPersistedOperatingModeState,
  updatePersistedOperatingModeState,
  type SystemOperatingMode,
  type LocalBackupStatus,
  type CloudSyncStatus,
} from './operatingModeStore.ts';
import {
  createDatabaseBackup,
  verifyBackupFile,
  getBackupDirectory,
  logSystemError,
} from './backupService.ts';
import {
  ALLOWED_CONFLICT_TABLES,
  checkCloudDatabaseReachability,
  getCloudPersistenceStatus,
  runConflictAwareBidirectionalCloudSync,
} from './cloudPersistenceService.ts';
import { reconcileHeldAndDuplicateLedgerEntries } from './ledgerIntegrityService.ts';

export interface SyncConflictItem {
  id: number;
  table_name: string;
  record_id: string;
  record_label: string | null;
  local_updated_at: string | null;
  cloud_updated_at: string | null;
  local_snapshot: Record<string, unknown>;
  cloud_snapshot: Record<string, unknown>;
  changed_fields: string[];
  status: 'unresolved' | 'resolved';
  resolution_choice: 'keep_local' | 'keep_cloud' | null;
  resolved_by: string | null;
  resolved_at: string | null;
  detected_at: string;
}

export interface OperatingModeFullStatus {
  mode: SystemOperatingMode;
  activeDatabaseLabel: string;
  switchedAt: string | null;
  switchedBy: string | null;
  manualControlOnly: boolean;
  localBackupStatus: LocalBackupStatus;
  lastSuccessfulBackupAt: string | null;
  lastBackupFilename: string | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number;
  lastBackupSha256: string | null;
  lastBackupError: string | null;
  cloudSyncStatus: CloudSyncStatus;
  lastSuccessfulCloudSyncAt: string | null;
  lastCloudSyncError: string | null;
  pendingLocalChangesCount: number;
  unresolvedConflictsCount: number;
  storage: {
    platform: string;
    isWindows: boolean;
    available: boolean;
    activeDatabasePath: string;
    activeDatabaseDir: string;
    activeBackupDir: string;
    windowsPermanentDatabaseDir: string;
    windowsPermanentBackupDir: string;
    localIntegrityOk: boolean;
    localDbConnected: boolean;
    localFileSizeBytes: number;
    warning: string | null;
  };
  cloud: {
    enabled: boolean;
    connected: boolean;
    databaseIdentity: string;
    lastVersionSeq: number;
    lastError: string | null;
  };
}

export interface SwitchOperatingModeResult {
  success: boolean;
  switched: boolean;
  requiresConfirmation?: boolean;
  mode: SystemOperatingMode;
  previousMode: SystemOperatingMode;
  message: string;
  warning?: string | null;
  pendingLocalChangesCount: number;
  unresolvedConflictsCount: number;
  status: OperatingModeFullStatus;
}

export interface BackupAndSyncResult {
  success: boolean;
  step1LocalBackup: {
    status: 'Successful' | 'Failed';
    filename: string | null;
    filePath: string | null;
    fileSizeBytes: number;
    integrityStatus: string;
    sha256: string | null;
    completedAt: string | null;
    error: string | null;
  };
  step2CloudSync: {
    status: 'Successful' | 'Pending' | 'Failed';
    reachable: boolean;
    mergedFromCloud: number;
    updatedFromCloud: number;
    conflictsDetected: number;
    unresolvedConflictsCount: number;
    cloudVersionSeq: number;
    completedAt: string | null;
    message: string;
    error: string | null;
  };
  lastSuccessfulBackupAt: string | null;
  lastSuccessfulCloudSyncAt: string | null;
  conflicts: SyncConflictItem[];
  status: OperatingModeFullStatus;
}

function getUnresolvedConflictsCountSafe(): number {
  try {
    const db = getDatabase();
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM sync_conflicts WHERE status = 'unresolved'")
      .get() as { cnt: number } | undefined;
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  try {
    if (typeof raw === 'string' && raw.trim()) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore malformed json
  }
  return fallback;
}

/**
 * Mirrors persisted operating mode & backup/sync metadata into company_settings without touching any business records.
 */
export function syncModeMetadataToDb(): void {
  try {
    const db = getDatabase();
    const state = getPersistedOperatingModeState();
    const cols = new Set(
      (db.prepare('PRAGMA table_info(company_settings)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!cols.has('system_operating_mode')) return;

    db.prepare(
      `UPDATE company_settings
       SET system_operating_mode = ?,
           last_successful_backup_at = ?,
           last_successful_cloud_sync_at = ?,
           last_backup_status = ?,
           last_cloud_sync_status = ?,
           pending_local_changes_count = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = (SELECT id FROM company_settings ORDER BY id ASC LIMIT 1)`
    ).run(
      state.mode,
      state.lastSuccessfulBackupAt,
      state.lastSuccessfulCloudSyncAt,
      state.localBackupStatus,
      state.cloudSyncStatus,
      state.pendingLocalChangesCount
    );
  } catch {
    // non-fatal if table not yet migrated
  }
}

function writeOperatingModeAuditLog(params: {
  action: string;
  username: string;
  userId?: number | null;
  ipAddress?: string;
  details: string;
  status?: string;
}): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      params.userId ?? null,
      params.username || 'Super Admin',
      params.action,
      params.status || 'SUCCESS',
      params.ipAddress || '',
      params.details
    );
  } catch {
    // ignore audit error
  }

  try {
    const db = getDatabase();
    const hasProtectedLogs = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='protected_audit_logs'")
      .get();
    if (hasProtectedLogs) {
      db.prepare(
        `INSERT INTO protected_audit_logs (event_type, actor_username, actor_role, details, ip_address)
         VALUES (?, ?, 'Super Admin', ?, ?)`
      ).run(params.action, params.username || 'Super Admin', params.details, params.ipAddress || '');
    }
  } catch {
    // ignore optional protected log table errors
  }
}

/**
 * Returns complete Operating Mode, Storage, Local Backup, Cloud Sync & Conflict status.
 * Makes ZERO Cloud network requests (safe in OFFLINE MODE).
 */
export function getOperatingModeFullStatus(): OperatingModeFullStatus {
  const state = getPersistedOperatingModeState();
  const storageCheck = validatePermanentStorageLocation();
  const dbHealth = checkDatabaseConnection();
  const cloudStatus = getCloudPersistenceStatus();
  const unresolvedConflictsCount = getUnresolvedConflictsCountSafe();

  let activeBackupDir = config.primaryBackupDir;
  try {
    activeBackupDir = getBackupDirectory();
  } catch {
    activeBackupDir = config.primaryBackupDir;
  }

  return {
    mode: state.mode,
    activeDatabaseLabel:
      state.mode === 'OFFLINE'
        ? 'Permanent Local Database (SQLite)'
        : 'Cloud Database (Primary Online)',
    switchedAt: state.switchedAt,
    switchedBy: state.switchedBy,
    manualControlOnly: true,
    localBackupStatus: state.localBackupStatus,
    lastSuccessfulBackupAt: state.lastSuccessfulBackupAt,
    lastBackupFilename: state.lastBackupFilename,
    lastBackupPath: state.lastBackupPath,
    lastBackupSizeBytes: state.lastBackupSizeBytes,
    lastBackupSha256: state.lastBackupSha256,
    lastBackupError: state.lastBackupError,
    cloudSyncStatus: state.cloudSyncStatus,
    lastSuccessfulCloudSyncAt: state.lastSuccessfulCloudSyncAt,
    lastCloudSyncError: state.lastCloudSyncError,
    pendingLocalChangesCount: state.pendingLocalChangesCount,
    unresolvedConflictsCount,
    storage: {
      platform: process.platform,
      isWindows: config.isWindows,
      available: storageCheck.available,
      activeDatabasePath: config.databasePath,
      activeDatabaseDir: config.primaryDatabaseDir,
      activeBackupDir,
      windowsPermanentDatabaseDir: config.windowsPrimaryDatabaseDir,
      windowsPermanentBackupDir: config.windowsPrimaryBackupDir,
      localIntegrityOk: dbHealth.integrityCheck.toLowerCase() === 'ok',
      localDbConnected: dbHealth.connected,
      localFileSizeBytes: dbHealth.fileSizeBytes,
      warning: storageCheck.warning,
    },
    cloud: {
      enabled: cloudStatus.enabled,
      connected: state.mode === 'OFFLINE' ? false : cloudStatus.connected,
      databaseIdentity: cloudStatus.databaseIdentity || cloudStatus.externalLocation,
      lastVersionSeq: cloudStatus.lastVersionSeq,
      lastError: state.mode === 'OFFLINE' ? null : cloudStatus.lastError,
    },
  };
}

/**
 * Safely switches between ONLINE MODE and OFFLINE MODE (Super Admin ONLY).
 * 1. Flushes/checkpoints pending WAL writes to disk.
 * 2. Verifies target database accessibility BEFORE activating the selected mode.
 * 3. Protects pending offline records when switching back to ONLINE MODE.
 */
export async function switchOperatingMode(params: {
  targetMode: SystemOperatingMode;
  username: string;
  userId?: number | null;
  ipAddress?: string;
  allowWithPendingOfflineChanges?: boolean;
}): Promise<SwitchOperatingModeResult> {
  const currentState = getPersistedOperatingModeState();
  const previousMode = currentState.mode;
  const targetMode: SystemOperatingMode = params.targetMode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
  const unresolvedConflictsCount = getUnresolvedConflictsCountSafe();

  // Always flush pending SQLite WAL frames cleanly before switching
  checkpointDatabaseWal();

  if (previousMode === targetMode) {
    return {
      success: true,
      switched: false,
      mode: targetMode,
      previousMode,
      message: `System is already operating in ${targetMode} MODE.`,
      pendingLocalChangesCount: currentState.pendingLocalChangesCount,
      unresolvedConflictsCount,
      status: getOperatingModeFullStatus(),
    };
  }

  if (targetMode === 'OFFLINE') {
    // Verify permanent local storage & SQLite integrity BEFORE switching to OFFLINE MODE
    const storageCheck = validatePermanentStorageLocation();
    if (!storageCheck.available) {
      return {
        success: false,
        switched: false,
        mode: previousMode,
        previousMode,
        message:
          storageCheck.warning ||
          `Cannot switch to OFFLINE MODE because the permanent local database directory (${config.primaryDatabaseDir}) is not accessible.`,
        warning: storageCheck.warning,
        pendingLocalChangesCount: currentState.pendingLocalChangesCount,
        unresolvedConflictsCount,
        status: getOperatingModeFullStatus(),
      };
    }

    const dbHealth = checkDatabaseConnection();
    if (!dbHealth.connected || dbHealth.integrityCheck.toLowerCase() !== 'ok') {
      return {
        success: false,
        switched: false,
        mode: previousMode,
        previousMode,
        message: `Cannot switch to OFFLINE MODE: Local database verification failed (${dbHealth.error || dbHealth.integrityCheck}). Current ONLINE MODE preserved.`,
        pendingLocalChangesCount: currentState.pendingLocalChangesCount,
        unresolvedConflictsCount,
        status: getOperatingModeFullStatus(),
      };
    }

    const nowIso = new Date().toISOString();
    const cloudSnapStatus = getCloudPersistenceStatus();
    const baselineSyncAt =
      currentState.lastSuccessfulCloudSyncAt ||
      cloudSnapStatus.lastSyncAt ||
      (cloudSnapStatus.connected ? nowIso : null);
    updatePersistedOperatingModeState({
      mode: 'OFFLINE',
      switchedAt: nowIso,
      switchedBy: params.username,
      ...(baselineSyncAt && !currentState.lastSuccessfulCloudSyncAt
        ? { lastSuccessfulCloudSyncAt: baselineSyncAt }
        : {}),
    });
    syncModeMetadataToDb();
    checkpointDatabaseWal();

    writeOperatingModeAuditLog({
      action: 'OPERATING_MODE_SWITCHED_OFFLINE',
      username: params.username,
      userId: params.userId,
      ipAddress: params.ipAddress,
      details: `Super Admin switched System Operating Mode from ONLINE MODE to OFFLINE MODE (Local DB: ${config.databasePath})`,
    });

    return {
      success: true,
      switched: true,
      mode: 'OFFLINE',
      previousMode,
      message:
        'Switched to OFFLINE MODE successfully. The application now runs exclusively on the permanent local database with zero Cloud Database requests.',
      pendingLocalChangesCount: getPersistedOperatingModeState().pendingLocalChangesCount,
      unresolvedConflictsCount,
      status: getOperatingModeFullStatus(),
    };
  }

  // Target mode is ONLINE:
  // 1. Verify Cloud Database reachability BEFORE switching
  const cloudCheck = await checkCloudDatabaseReachability();
  if (!cloudCheck.reachable) {
    return {
      success: false,
      switched: false,
      mode: previousMode,
      previousMode,
      message: `Cannot switch to ONLINE MODE because the Cloud Database is unreachable (${cloudCheck.error || 'no internet connection'}). System remains safely in OFFLINE MODE with all local records preserved.`,
      warning: cloudCheck.error,
      pendingLocalChangesCount: currentState.pendingLocalChangesCount,
      unresolvedConflictsCount,
      status: getOperatingModeFullStatus(),
    };
  }

  // 2. Warn if there are unsynced offline changes or unresolved conflicts unless explicitly confirmed
  if (
    (currentState.pendingLocalChangesCount > 0 || unresolvedConflictsCount > 0) &&
    !params.allowWithPendingOfflineChanges
  ) {
    const parts: string[] = [];
    if (currentState.pendingLocalChangesCount > 0) {
      parts.push(`${currentState.pendingLocalChangesCount} offline change(s) pending Cloud Sync`);
    }
    if (unresolvedConflictsCount > 0) {
      parts.push(`${unresolvedConflictsCount} unresolved sync conflict(s)`);
    }
    return {
      success: false,
      switched: false,
      requiresConfirmation: true,
      mode: previousMode,
      previousMode,
      message: `You have ${parts.join(' and ')}. Recommended: click "BACKUP & SYNC NOW" first so offline records are backed up and synchronized with Cloud Database before switching to ONLINE MODE. Or confirm to switch now while preserving all local records.`,
      pendingLocalChangesCount: currentState.pendingLocalChangesCount,
      unresolvedConflictsCount,
      status: getOperatingModeFullStatus(),
    };
  }

  const nowIso = new Date().toISOString();
  updatePersistedOperatingModeState({
    mode: 'ONLINE',
    switchedAt: nowIso,
    switchedBy: params.username,
  });
  syncModeMetadataToDb();
  checkpointDatabaseWal();

  writeOperatingModeAuditLog({
    action: 'OPERATING_MODE_SWITCHED_ONLINE',
    username: params.username,
    userId: params.userId,
    ipAddress: params.ipAddress,
    details: `Super Admin switched System Operating Mode from OFFLINE MODE to ONLINE MODE (Cloud DB verified at v${cloudCheck.versionSeq})`,
  });

  return {
    success: true,
    switched: true,
    mode: 'ONLINE',
    previousMode,
    message: `Switched to ONLINE MODE successfully. Cloud Database (${cloudCheck.location}) verified and active.`,
    pendingLocalChangesCount: getPersistedOperatingModeState().pendingLocalChangesCount,
    unresolvedConflictsCount,
    status: getOperatingModeFullStatus(),
  };
}

/**
 * Lists sync conflicts stored in `sync_conflicts` table.
 */
export function listSyncConflicts(statusFilter: 'unresolved' | 'resolved' | 'all' = 'unresolved'): SyncConflictItem[] {
  try {
    const db = getDatabase();
    const sql =
      statusFilter === 'all'
        ? 'SELECT * FROM sync_conflicts ORDER BY CASE WHEN status = \'unresolved\' THEN 0 ELSE 1 END, id DESC LIMIT 200'
        : 'SELECT * FROM sync_conflicts WHERE status = ? ORDER BY id DESC LIMIT 200';
    const rows = (
      statusFilter === 'all' ? db.prepare(sql).all() : db.prepare(sql).all(statusFilter)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      table_name: String(r.table_name),
      record_id: String(r.record_id),
      record_label: r.record_label ? String(r.record_label) : null,
      local_updated_at: r.local_updated_at ? String(r.local_updated_at) : null,
      cloud_updated_at: r.cloud_updated_at ? String(r.cloud_updated_at) : null,
      local_snapshot: safeJsonParse<Record<string, unknown>>(r.local_snapshot_json, {}),
      cloud_snapshot: safeJsonParse<Record<string, unknown>>(r.cloud_snapshot_json, {}),
      changed_fields: safeJsonParse<string[]>(r.changed_fields_json, []),
      status: r.status === 'resolved' ? 'resolved' : 'unresolved',
      resolution_choice:
        r.resolution_choice === 'keep_local' || r.resolution_choice === 'keep_cloud'
          ? r.resolution_choice
          : null,
      resolved_by: r.resolved_by ? String(r.resolved_by) : null,
      resolved_at: r.resolved_at ? String(r.resolved_at) : null,
      detected_at: String(r.detected_at || ''),
    }));
  } catch {
    return [];
  }
}

/**
 * Resolves a detected record conflict by explicitly applying either the Local version or the Cloud version.
 * Uses a static table allowlist and PRAGMA column validation to prevent SQL injection.
 */
export function resolveSyncConflict(params: {
  conflictId: number;
  resolution: 'keep_local' | 'keep_cloud';
  username: string;
  userId?: number | null;
  ipAddress?: string;
}): {
  success: boolean;
  message: string;
  unresolvedConflictsCount: number;
  status: OperatingModeFullStatus;
} {
  const db = getDatabase();
  const conflict = db
    .prepare('SELECT * FROM sync_conflicts WHERE id = ?')
    .get(params.conflictId) as Record<string, unknown> | undefined;

  if (!conflict) {
    throw new Error('Sync conflict record not found.');
  }

  const tableName = String(conflict.table_name || '');
  const allowedRule = ALLOWED_CONFLICT_TABLES.find((r) => r.table === tableName);
  if (!allowedRule) {
    throw new Error(`Unsupported table "${tableName}" for conflict resolution.`);
  }

  const recordId = String(conflict.record_id);
  const resolution: 'keep_local' | 'keep_cloud' =
    params.resolution === 'keep_cloud' ? 'keep_cloud' : 'keep_local';

  const tableCols = (
    db.prepare(`PRAGMA table_info("${allowedRule.table}")`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  const tableColSet = new Set(tableCols);

  const nowIso = new Date().toISOString();

  const resolveTx = db.transaction(() => {
    if (resolution === 'keep_cloud') {
      const cloudSnapshot = safeJsonParse<Record<string, unknown>>(conflict.cloud_snapshot_json, {});
      const updatableCols = allowedRule.compareCols.filter(
        (c) => tableColSet.has(c) && Object.prototype.hasOwnProperty.call(cloudSnapshot, c)
      );
      if (updatableCols.length > 0) {
        const setParts = updatableCols.map((c) => `"${c}" = ?`);
        const values: unknown[] = updatableCols.map((c) => cloudSnapshot[c]);
        if (tableColSet.has('updated_at')) {
          setParts.push('"updated_at" = ?');
          values.push(
            conflict.cloud_updated_at ? String(conflict.cloud_updated_at) : nowIso
          );
        }
        values.push(recordId);
        db.prepare(`UPDATE "${allowedRule.table}" SET ${setParts.join(', ')} WHERE id = ?`).run(
          ...values
        );
      }

      db.prepare(
        `UPDATE sync_conflicts
         SET status = 'resolved',
             resolution_choice = ?,
             resolved_by = ?,
             resolved_at = ?,
             local_updated_at = COALESCE(cloud_updated_at, ?)
         WHERE id = ?`
      ).run(resolution, params.username, nowIso, nowIso, params.conflictId);
    } else {
      if (tableColSet.has('updated_at')) {
        // Keep local values intact and bump updated_at so local cleanly supersedes the older cloud version on next sync
        db.prepare(`UPDATE "${allowedRule.table}" SET "updated_at" = ? WHERE id = ?`).run(
          nowIso,
          recordId
        );
      }

      db.prepare(
        `UPDATE sync_conflicts
         SET status = 'resolved',
             resolution_choice = ?,
             resolved_by = ?,
             resolved_at = ?,
             local_updated_at = ?
         WHERE id = ?`
      ).run(resolution, params.username, nowIso, nowIso, params.conflictId);
    }
  });

  resolveTx();
  if (resolution === 'keep_cloud' && allowedRule.table === 'accounts') {
    try {
      reconcileHeldAndDuplicateLedgerEntries();
    } catch {
      // non-fatal ledger reconciliation warning
    }
  }
  checkpointDatabaseWal();

  writeOperatingModeAuditLog({
    action: 'SYNC_CONFLICT_RESOLVED',
    username: params.username,
    userId: params.userId,
    ipAddress: params.ipAddress,
    details: `Resolved sync conflict #${params.conflictId} (${allowedRule.table} #${recordId}) by choosing "${resolution}"`,
  });

  const unresolvedConflictsCount = getUnresolvedConflictsCountSafe();

  return {
    success: true,
    message: `Conflict on ${allowedRule.table} (${conflict.record_label || `#${recordId}`}) resolved using "${resolution === 'keep_cloud' ? 'Cloud Version' : 'Local Version'}". ${
      unresolvedConflictsCount === 0
        ? 'All conflicts resolved — click BACKUP & SYNC NOW to complete Cloud Synchronization.'
        : `${unresolvedConflictsCount} conflict(s) remaining.`
    }`,
    unresolvedConflictsCount,
    status: getOperatingModeFullStatus(),
  };
}

/**
 * Resolves all currently unresolved sync conflicts in one explicit Super Admin action.
 */
export function resolveAllSyncConflicts(params: {
  resolution: 'keep_local' | 'keep_cloud';
  username: string;
  userId?: number | null;
  ipAddress?: string;
}): {
  success: boolean;
  resolvedCount: number;
  message: string;
  unresolvedConflictsCount: number;
  status: OperatingModeFullStatus;
} {
  const unresolved = listSyncConflicts('unresolved');
  let resolvedCount = 0;
  for (const conflict of unresolved) {
    resolveSyncConflict({
      conflictId: conflict.id,
      resolution: params.resolution,
      username: params.username,
      userId: params.userId,
      ipAddress: params.ipAddress,
    });
    resolvedCount += 1;
  }

  const remaining = getUnresolvedConflictsCountSafe();
  return {
    success: true,
    resolvedCount,
    message:
      resolvedCount > 0
        ? `Resolved ${resolvedCount} conflict(s) using "${
            params.resolution === 'keep_cloud' ? 'Cloud Version' : 'Local Version'
          }". Click BACKUP & SYNC NOW to complete Cloud Synchronization.`
        : 'No unresolved conflicts remaining.',
    unresolvedConflictsCount: remaining,
    status: getOperatingModeFullStatus(),
  };
}

/**
 * Executes the Super Admin single-button manual operation: BACKUP & SYNC NOW.
 * Step 1: Creates and verifies complete local backup in D:\AbrarMedicalStore\Backups\ (Windows) / permanent backup dir.
 * Step 2: Only after Step 1 succeeds, runs conflict-aware synchronization with the Cloud Database.
 * Step 3: Returns clear separate statuses for Local Backup & Cloud Sync + Last Successful timestamps.
 */
export async function executeManualBackupAndSync(params: {
  username: string;
  userId?: number | null;
  ipAddress?: string;
  notes?: string;
}): Promise<BackupAndSyncResult> {
  const beforeState = getPersistedOperatingModeState();
  checkpointDatabaseWal();

  // ================= STEP 1: LOCAL BACKUP =================
  let step1LocalBackup: BackupAndSyncResult['step1LocalBackup'] = {
    status: 'Failed',
    filename: null,
    filePath: null,
    fileSizeBytes: 0,
    integrityStatus: 'failed',
    sha256: null,
    completedAt: null,
    error: null,
  };

  try {
    const backup = createDatabaseBackup({
      backupType: 'manual',
      createdBy: params.username || 'Super Admin',
      notes: params.notes || 'Super Admin Manual BACKUP & SYNC NOW',
    });

    const verify = verifyBackupFile(backup.file_path);
    if (!verify.valid) {
      throw new Error(
        `Created backup "${backup.filename}" failed post-backup integrity verification (${verify.error || verify.integrityCheck}).`
      );
    }

    const fileBuf = fs.readFileSync(backup.file_path);
    const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
    const backupDoneAt = new Date().toISOString();

    step1LocalBackup = {
      status: 'Successful',
      filename: backup.filename,
      filePath: backup.file_path,
      fileSizeBytes: backup.file_size_bytes,
      integrityStatus: verify.integrityCheck,
      sha256,
      completedAt: backupDoneAt,
      error: null,
    };

    updatePersistedOperatingModeState({
      localBackupStatus: 'Successful',
      lastSuccessfulBackupAt: backupDoneAt,
      lastBackupFilename: backup.filename,
      lastBackupPath: backup.file_path,
      lastBackupSizeBytes: backup.file_size_bytes,
      lastBackupSha256: sha256,
      lastBackupError: null,
    });
    syncModeMetadataToDb();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    step1LocalBackup.error = errMsg;

    updatePersistedOperatingModeState({
      localBackupStatus: 'Failed',
      lastBackupError: errMsg,
    });
    syncModeMetadataToDb();

    logSystemError({
      severity: 'CRITICAL',
      module: 'operating_mode_backup_sync',
      operation: 'BACKUP & SYNC NOW — Step 1 Local Backup',
      userMessage: 'Manual Local Backup failed; Cloud Sync was not started.',
      technicalDetails: errMsg,
      username: params.username,
    });

    const finalStatus = getOperatingModeFullStatus();
    return {
      success: false,
      step1LocalBackup,
      step2CloudSync: {
        status: 'Pending',
        reachable: false,
        mergedFromCloud: 0,
        updatedFromCloud: 0,
        conflictsDetected: 0,
        unresolvedConflictsCount: finalStatus.unresolvedConflictsCount,
        cloudVersionSeq: finalStatus.cloud.lastVersionSeq,
        completedAt: null,
        message: 'Cloud Sync did not run because Step 1 (Local Backup) failed.',
        error: errMsg,
      },
      lastSuccessfulBackupAt: finalStatus.lastSuccessfulBackupAt,
      lastSuccessfulCloudSyncAt: finalStatus.lastSuccessfulCloudSyncAt,
      conflicts: listSyncConflicts('unresolved'),
      status: finalStatus,
    };
  }

  // ================= STEP 2: CLOUD SYNCHRONIZATION =================
  const syncRes = await runConflictAwareBidirectionalCloudSync({
    lastSyncedAt: beforeState.lastSuccessfulCloudSyncAt,
    switchedAt: beforeState.switchedAt,
    hasLocalPendingChanges: beforeState.pendingLocalChangesCount > 0,
    initiatedBy: params.username || 'Super Admin',
  });

  const syncDoneAt = syncRes.status === 'Successful' ? new Date().toISOString() : null;

  if (syncRes.status === 'Successful') {
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Successful',
      lastSuccessfulCloudSyncAt: syncDoneAt,
      lastCloudSyncError: null,
      pendingLocalChangesCount: 0,
    });
  } else if (syncRes.status === 'Pending') {
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Pending',
      lastCloudSyncError: syncRes.error || syncRes.message,
    });
  } else {
    updatePersistedOperatingModeState({
      cloudSyncStatus: 'Failed',
      lastCloudSyncError: syncRes.error || syncRes.message,
    });
  }

  syncModeMetadataToDb();
  checkpointDatabaseWal();

  writeOperatingModeAuditLog({
    action: 'MANUAL_BACKUP_AND_SYNC',
    username: params.username,
    userId: params.userId,
    ipAddress: params.ipAddress,
    status: syncRes.status === 'Successful' ? 'SUCCESS' : 'WARNING',
    details: `Local Backup: Successful (${step1LocalBackup.filename}, ${step1LocalBackup.fileSizeBytes} bytes); Cloud Sync: ${syncRes.status} (${syncRes.message})`,
  });

  const finalStatus = getOperatingModeFullStatus();
  const unresolvedConflicts = listSyncConflicts('unresolved');

  return {
    success: step1LocalBackup.status === 'Successful' && syncRes.status === 'Successful',
    step1LocalBackup,
    step2CloudSync: {
      status: syncRes.status,
      reachable: syncRes.reachable,
      mergedFromCloud: syncRes.mergedFromCloud,
      updatedFromCloud: syncRes.updatedFromCloud,
      conflictsDetected: syncRes.conflictsDetected,
      unresolvedConflictsCount: syncRes.unresolvedConflictsCount,
      cloudVersionSeq: syncRes.cloudVersionSeq,
      completedAt: syncDoneAt,
      message: syncRes.message,
      error: syncRes.error,
    },
    lastSuccessfulBackupAt: finalStatus.lastSuccessfulBackupAt,
    lastSuccessfulCloudSyncAt: finalStatus.lastSuccessfulCloudSyncAt,
    conflicts: unresolvedConflicts,
    status: finalStatus,
  };
}
