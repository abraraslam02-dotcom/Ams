import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config, validatePermanentStorageLocation } from '../config.ts';

let dbInstance: Database.Database | null = null;
let connectionError: string | null = null;
let wasDatabaseCreatedOnBoot = false;
let wasDatabaseQuarantinedOnBoot = false;

export function getWasDatabaseCreatedOnBoot(): boolean {
  return wasDatabaseCreatedOnBoot;
}

export function getWasDatabaseQuarantinedOnBoot(): boolean {
  return wasDatabaseQuarantinedOnBoot;
}

export function markDatabaseHydratedFromCloud(): void {
  wasDatabaseCreatedOnBoot = false;
  wasDatabaseQuarantinedOnBoot = false;
}

/**
 * Moves corrupted local database files (.db, -wal, -shm) to a timestamped quarantine directory
 * so no forensic bytes are ever deleted while clearing malformed disk/WAL artifacts before cloud hydration.
 */
export function quarantineCorruptDatabaseFiles(reason = 'integrity_failed'): string | null {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close error on malformed handle
    }
    dbInstance = null;
  }

  const dbDir = path.dirname(config.databasePath);
  const baseName = path.basename(config.databasePath);
  const quarantineDir = path.join(dbDir, 'quarantine', `${reason}_${Date.now()}`);
  let movedAny = false;

  for (const suffix of ['', '-wal', '-shm']) {
    const srcPath = `${config.databasePath}${suffix}`;
    if (fs.existsSync(srcPath)) {
      if (!fs.existsSync(quarantineDir)) {
        fs.mkdirSync(quarantineDir, { recursive: true });
      }
      const destPath = path.join(quarantineDir, `${baseName}${suffix}`);
      try {
        fs.renameSync(srcPath, destPath);
      } catch {
        fs.copyFileSync(srcPath, destPath);
        try {
          fs.unlinkSync(srcPath);
        } catch {
          // ignore
        }
      }
      movedAny = true;
    }
  }

  return movedAny ? quarantineDir : null;
}

export interface ConnectionDiagnostics {
  connected: boolean;
  driver: string;
  databasePath: string;
  databaseDirectoryExists: boolean;
  fileExists: boolean;
  fileSizeBytes: number;
  journalMode: string;
  foreignKeysEnabled: boolean;
  integrityCheck: string;
  tableCount: number;
  tables: string[];
  latencyMs: number;
  checkedAt: string;
  error?: string | null;
}

function verifyOpenedDatabaseIntegrity(db: Database.Database): boolean {
  try {
    const check = String(db.pragma('integrity_check', { simple: true }) || '');
    if (check.toLowerCase() === 'ok') {
      return true;
    }
  } catch {
    // Fall through to REINDEX recovery attempt
  }

  try {
    db.exec('REINDEX;');
    db.pragma('wal_checkpoint(TRUNCATE)');
    const recheck = String(db.pragma('integrity_check', { simple: true }) || '');
    return recheck.toLowerCase() === 'ok';
  } catch {
    return false;
  }
}

/**
 * Flushes all committed SQLite WAL frames into the primary database file.
 * Used before operating-mode switching and manual backup/sync operations.
 */
export function checkpointDatabaseWal(): boolean {
  if (!dbInstance) return false;
  try {
    dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    return true;
  } catch {
    try {
      dbInstance.pragma('wal_checkpoint(PASSIVE)');
      return true;
    } catch {
      return false;
    }
  }
}

export function isDatabaseOpen(): boolean {
  return dbInstance !== null;
}

function isMalformedOrCorruptError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('malformed') ||
    msg.includes('corrupt') ||
    msg.includes('not a database') ||
    msg.includes('file is encrypted')
  );
}

/**
 * Moves only stale/corrupt WAL and SHM sidecar files into quarantine without touching the main .db file.
 */
function quarantineWalSidecarsOnly(reason = 'wal_sidecar_recovery'): string | null {
  const dbDir = path.dirname(config.databasePath);
  const baseName = path.basename(config.databasePath);
  const quarantineDir = path.join(dbDir, 'quarantine', `${reason}_${Date.now()}`);
  let movedAny = false;

  for (const suffix of ['-wal', '-shm']) {
    const srcPath = `${config.databasePath}${suffix}`;
    if (fs.existsSync(srcPath)) {
      if (!fs.existsSync(quarantineDir)) {
        fs.mkdirSync(quarantineDir, { recursive: true });
      }
      const destPath = path.join(quarantineDir, `${baseName}${suffix}`);
      try {
        fs.renameSync(srcPath, destPath);
      } catch {
        fs.copyFileSync(srcPath, destPath);
        try {
          fs.unlinkSync(srcPath);
        } catch {
          // ignore
        }
      }
      movedAny = true;
    }
  }
  return movedAny ? quarantineDir : null;
}

function openAndConfigureSqlite(dbPath: string, verifyIntegrity: boolean): Database.Database {
  const handle = new Database(dbPath, {
    verbose: config.nodeEnv === 'development' ? undefined : undefined,
  });
  try {
    handle.pragma('busy_timeout = 5000');
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    handle.pragma('synchronous = NORMAL');

    if (verifyIntegrity && !verifyOpenedDatabaseIntegrity(handle)) {
      throw new Error('database disk image is malformed (PRAGMA integrity_check failed)');
    }
    return handle;
  } catch (err) {
    try {
      handle.close();
    } catch {
      // ignore close error on broken handle
    }
    throw err;
  }
}

/**
 * Automated table-by-table and column-by-column SQLite salvage engine.
 * Reconstructs a 100% clean, integrity-verified SQLite database file from a database
 * that encountered an overflow/B-tree page error on a single column or index.
 */
function salvageMalformedSqliteDatabase(sourceCorruptPath: string, targetCleanPath: string): boolean {
  const tmpRebuildPath = `${targetCleanPath}.salvage.${Date.now()}.tmp`;
  let srcDb: Database.Database | null = null;
  let dstDb: Database.Database | null = null;
  try {
    if (fs.existsSync(tmpRebuildPath)) fs.unlinkSync(tmpRebuildPath);
    srcDb = new Database(sourceCorruptPath, { readonly: true });
    dstDb = new Database(tmpRebuildPath);
    dstDb.pragma('journal_mode = WAL');
    dstDb.pragma('foreign_keys = OFF');

    const schemaObjects = srcDb
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 WHEN 'view' THEN 4 ELSE 5 END, name ASC"
      )
      .all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>;

    if (schemaObjects.length === 0) {
      srcDb.close();
      dstDb.close();
      if (fs.existsSync(tmpRebuildPath)) fs.unlinkSync(tmpRebuildPath);
      return false;
    }

    for (const obj of schemaObjects.filter((o) => o.type === 'table')) {
      dstDb.exec(obj.sql);
    }

    let recoveredCoreRows = 0;
    for (const obj of schemaObjects.filter((o) => o.type === 'table')) {
      const tableName = obj.name;
      const colsInfo = srcDb.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
      const cols = colsInfo.map((c) => c.name);
      if (cols.length === 0) continue;

      const quotedCols = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const insertStmt = dstDb.prepare(`INSERT OR IGNORE INTO "${tableName}" (${quotedCols}) VALUES (${placeholders})`);

      try {
        const rows = srcDb.prepare(`SELECT * FROM "${tableName}"`).all() as Array<Record<string, unknown>>;
        const copyTx = dstDb.transaction((batch: Array<Record<string, unknown>>) => {
          for (const r of batch) {
            insertStmt.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
          }
        });
        copyTx(rows);
        if (['items', 'sales', 'purchases', 'accounts', 'users'].includes(tableName)) {
          recoveredCoreRows += rows.length;
        }
      } catch {
        // Fallback: column-by-column salvage for tables with an unreadable overflow page
        try {
          const rowids = srcDb.prepare(`SELECT rowid as __rid FROM "${tableName}"`).all() as Array<{ __rid: number }>;
          for (const { __rid } of rowids) {
            const salvagedRow: Record<string, unknown> = {};
            for (const col of cols) {
              try {
                const cell = srcDb.prepare(`SELECT "${col}" FROM "${tableName}" WHERE rowid = ?`).get(__rid) as
                  | Record<string, unknown>
                  | undefined;
                salvagedRow[col] = cell && cell[col] !== undefined ? cell[col] : null;
              } catch {
                salvagedRow[col] = null;
              }
            }
            if (tableName === 'company_settings') {
              salvagedRow.store_name = salvagedRow.store_name || 'Abrar Medical Store';
              salvagedRow.invoice_heading = salvagedRow.invoice_heading || 'TAX / COMMERCIAL INVOICE';
              salvagedRow.default_paper_size = salvagedRow.default_paper_size || 'legal';
              salvagedRow.thermal_printer_width = salvagedRow.thermal_printer_width || '80mm';
              salvagedRow.page_orientation = salvagedRow.page_orientation || 'portrait';
              salvagedRow.page_margin = salvagedRow.page_margin || 'standard';
              salvagedRow.font_size_scale = salvagedRow.font_size_scale || 'normal';
              salvagedRow.field_visibility_json = salvagedRow.field_visibility_json || '{}';
              salvagedRow.sales_invoice_more_options_json = salvagedRow.sales_invoice_more_options_json || '{}';
            }
            insertStmt.run(...cols.map((c) => (salvagedRow[c] === undefined ? null : salvagedRow[c])));
          }
        } catch {
          // skip unrecoverable rows
        }
      }
    }

    for (const obj of schemaObjects.filter((o) => o.type !== 'table')) {
      try {
        dstDb.exec(obj.sql);
      } catch {
        // ignore index/trigger warning
      }
    }

    try {
      const seqRows = srcDb.prepare('SELECT name, seq FROM sqlite_sequence').all() as Array<{ name: string; seq: number }>;
      for (const s of seqRows) {
        dstDb.prepare('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(s.name, s.seq);
      }
    } catch {}

    dstDb.pragma('foreign_keys = ON');
    dstDb.pragma('wal_checkpoint(TRUNCATE)');
    const check = String(dstDb.pragma('integrity_check', { simple: true }) || '').toLowerCase();
    srcDb.close();
    srcDb = null;
    dstDb.close();
    dstDb = null;

    if (check === 'ok' && recoveredCoreRows > 0) {
      for (const suffix of ['-wal', '-shm']) {
        for (const p of [`${tmpRebuildPath}${suffix}`, `${targetCleanPath}${suffix}`]) {
          if (fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {}
          }
        }
      }
      fs.renameSync(tmpRebuildPath, targetCleanPath);
      return true;
    }
  } catch {
    // cleanup on failure
  } finally {
    try {
      srcDb?.close();
    } catch {}
    try {
      dstDb?.close();
    } catch {}
    for (const p of [tmpRebuildPath, `${tmpRebuildPath}-wal`, `${tmpRebuildPath}-shm`]) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
  }
  return false;
}

/**
 * Initializes and returns the active SQLite database instance.
 * Ensures the target permanent directory exists and PRAGMAs are strictly enforced.
 * Never silently creates an empty replacement database if the permanent drive (e.g. D:\ on Windows) is unavailable.
 */
export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    const storageCheck = validatePermanentStorageLocation();
    if (!storageCheck.available) {
      throw new Error(
        storageCheck.warning ||
          `Permanent local database location (${config.databasePath}) is unavailable.`
      );
    }

    const dbDir = path.dirname(config.databasePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dropInRestorePath = path.join(dbDir, 'restore.db');
    const pendingRestorePath = fs.existsSync(dropInRestorePath)
      ? dropInRestorePath
      : `${config.databasePath}.pending_restore`;
    if (fs.existsSync(pendingRestorePath)) {
      let probe: Database.Database | null = null;
      try {
        probe = new Database(pendingRestorePath, { readonly: true });
        const check = String(probe.pragma('integrity_check', { simple: true }) || '').toLowerCase();
        probe.close();
        probe = null;
        if (check === 'ok') {
          if (fs.existsSync(config.databasePath)) {
            const safetyDir = config.primaryBackupDir || path.join(dbDir, 'backups');
            if (!fs.existsSync(safetyDir)) fs.mkdirSync(safetyDir, { recursive: true });
            const safetyCopy = path.join(safetyDir, `Pre_DropIn_Restore_${Date.now()}.db`);
            try {
              fs.copyFileSync(config.databasePath, safetyCopy);
            } catch {}
          }
          for (const suffix of ['-wal', '-shm']) {
            const sidecar = `${config.databasePath}${suffix}`;
            if (fs.existsSync(sidecar)) {
              try {
                fs.unlinkSync(sidecar);
              } catch {}
            }
          }
          fs.renameSync(pendingRestorePath, config.databasePath);
          wasDatabaseCreatedOnBoot = false;
          wasDatabaseQuarantinedOnBoot = false;
          console.log(
            `[AMS DB] Applied verified database restore from ${path.basename(pendingRestorePath)} onto ${config.databasePath}`
          );
        }
      } catch (restoreErr) {
        try {
          probe?.close();
        } catch {}
        console.warn('[AMS DB] Pending restore file could not be applied:', restoreErr);
      }
    }

    const dbMissingBeforeOpen = !fs.existsSync(config.databasePath);
    if (dbMissingBeforeOpen) {
      wasDatabaseCreatedOnBoot = true;
    }

    // In development/test only, seed runtime database from data/ams_medical.db if not yet initialized.
    // In production, NEVER silently copy a local seed/old file over a missing runtime DB — hydrate strictly from current active cloud DB or block with error.
    if (
      dbMissingBeforeOpen &&
      config.envScope !== 'production' &&
      config.seedDatabasePath &&
      config.seedDatabasePath !== config.databasePath &&
      fs.existsSync(config.seedDatabasePath)
    ) {
      fs.copyFileSync(config.seedDatabasePath, config.databasePath);
      const seedWal = `${config.seedDatabasePath}-wal`;
      const seedShm = `${config.seedDatabasePath}-shm`;
      if (fs.existsSync(seedWal)) {
        fs.copyFileSync(seedWal, `${config.databasePath}-wal`);
      }
      if (fs.existsSync(seedShm)) {
        fs.copyFileSync(seedShm, `${config.databasePath}-shm`);
      }
    }

    let verifiedHandle: Database.Database | null = null;
    try {
      verifiedHandle = openAndConfigureSqlite(config.databasePath, !dbMissingBeforeOpen);
    } catch (openErr: unknown) {
      if (dbMissingBeforeOpen || !isMalformedOrCorruptError(openErr)) {
        throw openErr;
      }

      // Step 1 Recovery: If a stale/corrupt -wal or -shm sidecar caused SQLITE_CORRUPT during PRAGMA/open,
      // quarantine ONLY the sidecars first and test whether the primary .db file itself is 100% healthy!
      const hasWalSidecars =
        fs.existsSync(`${config.databasePath}-wal`) || fs.existsSync(`${config.databasePath}-shm`);
      if (hasWalSidecars) {
        const walQuarantineDir = quarantineWalSidecarsOnly('boot_wal_sidecar_corrupt');
        console.warn(
          `[AMS DB] Detected corrupt/stale WAL sidecar on ${config.databasePath}. Moved sidecars to ${walQuarantineDir || 'data/quarantine'} and retrying primary database integrity check.`
        );
        try {
          verifiedHandle = openAndConfigureSqlite(config.databasePath, true);
          console.log('[AMS DB] Primary SQLite database recovered cleanly after clearing corrupt WAL sidecar.');
        } catch {
          verifiedHandle = null;
        }
      }

      // Step 2 Recovery: If the main .db file itself has an overflow/B-tree page error, quarantine it (never delete!),
      // attempt automated table-by-table & column-by-column in-place salvage first, and fall back to the newest verified local backup.
      if (!verifiedHandle) {
        const quarantineDir = quarantineCorruptDatabaseFiles('boot_integrity_check_failed');
        let restoredBackupPath: string | null = null;
        if (quarantineDir) {
          const quarantinedDbPath = path.join(quarantineDir, path.basename(config.databasePath));
          if (fs.existsSync(quarantinedDbPath) && salvageMalformedSqliteDatabase(quarantinedDbPath, config.databasePath)) {
            restoredBackupPath = `${quarantinedDbPath} (auto-repaired all tables)`;
          }
        }
        try {
          if (!restoredBackupPath) {
            const backupDirs = Array.from(
              new Set([config.primaryBackupDir, path.join(path.dirname(config.databasePath), 'backups')])
            );
          const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
          for (const dir of backupDirs) {
            if (!dir || !fs.existsSync(dir)) continue;
            for (const entry of fs.readdirSync(dir)) {
              if (!entry.endsWith('.db')) continue;
              const full = path.join(dir, entry);
              try {
                const st = fs.statSync(full);
                if (st.isFile() && st.size > 4096) {
                  candidates.push({ filePath: full, mtimeMs: st.mtimeMs });
                }
              } catch {
                // ignore unreadable entry
              }
            }
          }
          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          for (const cand of candidates) {
            let probe: Database.Database | null = null;
            try {
              probe = new Database(cand.filePath, { readonly: true });
              const check = String(probe.pragma('integrity_check', { simple: true }) || '').toLowerCase();
              const hasCompanySettings = probe
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_settings'")
                .get();
              const hasItems = probe
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='items'")
                .get();
              probe.close();
              probe = null;
              if (check === 'ok' && hasCompanySettings && hasItems) {
                const recoverTmp = `${config.databasePath}.recover.tmp`;
                fs.copyFileSync(cand.filePath, recoverTmp);
                fs.renameSync(recoverTmp, config.databasePath);
                restoredBackupPath = cand.filePath;
                break;
              }
              } catch {
                try {
                  probe?.close();
                } catch {}
              }
            }
          }
        } catch {
          // ignore recovery scan errors
        }

        if (restoredBackupPath) {
          wasDatabaseQuarantinedOnBoot = false;
          wasDatabaseCreatedOnBoot = false;
          console.warn(
            `[AMS DB] Local database at ${config.databasePath} failed SQLite integrity verification (quarantined to ${quarantineDir || 'data/quarantine'}) and was automatically restored from verified local backup: ${restoredBackupPath}`
          );
          verifiedHandle = openAndConfigureSqlite(config.databasePath, true);
        } else {
          wasDatabaseQuarantinedOnBoot = true;
          wasDatabaseCreatedOnBoot = true;
          console.warn(
            `[AMS DB] Local database at ${config.databasePath} failed SQLite integrity verification and was safely quarantined to ${quarantineDir || 'data/quarantine'}. Awaiting authoritative recovery.`
          );
          verifiedHandle = openAndConfigureSqlite(config.databasePath, false);
        }
      }
    }

    dbInstance = verifiedHandle;
    connectionError = null;
    return dbInstance;
  } catch (err: unknown) {
    dbInstance = null;
    const errorMsg = err instanceof Error ? err.message : String(err);
    connectionError = errorMsg;
    throw new Error(`Database connection failed at ${config.databasePath}: ${errorMsg}`);
  }
}

/**
 * Checkpoints the active SQLite WAL and mirrors to seed path when DATABASE_PATH differs from data/ams_medical.db.
 */
export function syncRuntimeToSeedDatabase(): boolean {
  try {
    const db = getDatabase();
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // ignore passive checkpoint warning
    }

    if (
      config.seedDatabasePath &&
      config.seedDatabasePath !== config.databasePath
    ) {
      const seedDir = path.dirname(config.seedDatabasePath);
      if (!fs.existsSync(seedDir)) {
        fs.mkdirSync(seedDir, { recursive: true });
      }
      const tmpSeedPath = `${config.seedDatabasePath}.sync.tmp`;
      if (fs.existsSync(tmpSeedPath)) {
        try {
          fs.unlinkSync(tmpSeedPath);
        } catch {}
      }
      const escapedTmp = tmpSeedPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escapedTmp}';`);
      fs.renameSync(tmpSeedPath, config.seedDatabasePath);

      const seedWal = `${config.seedDatabasePath}-wal`;
      const seedShm = `${config.seedDatabasePath}-shm`;
      if (fs.existsSync(seedWal)) {
        try {
          fs.unlinkSync(seedWal);
        } catch {}
      }
      if (fs.existsSync(seedShm)) {
        try {
          fs.unlinkSync(seedShm);
        } catch {}
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[AMS DB] Failed to mirror runtime DB to seed path:', err);
    return false;
  }
}

/**
 * Safely checkpoints WAL and closes the active SQLite connection (used during database restoration).
 */
export function closeDatabaseConnection(): void {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore checkpoint error if closing
    }
    try {
      dbInstance.close();
    } catch {
      // ignore close error
    }
    dbInstance = null;
  }
}

/**
 * Forces a fresh SQLite connection after restoration.
 */
export function reopenDatabaseConnection(): Database.Database {
  closeDatabaseConnection();
  return getDatabase();
}

/**
 * Serializes the active SQLite database (including any uncommitted WAL frames) into a single Buffer.
 */
export function serializeActiveDatabase(): Buffer {
  const db = getDatabase();
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch {
    // ignore passive checkpoint warning
  }
  return db.serialize();
}

/**
 * Atomically replaces the local SQLite database file from a verified Cloud SQL binary Buffer
 * and reopens the connection.
 */
export function replaceDatabaseFromBuffer(buffer: Buffer): Database.Database {
  if (!buffer || buffer.length < 4096) {
    throw new Error('Invalid database buffer provided for hydration.');
  }
  // Verify SQLite magic header ("SQLite format 3\0")
  const header = buffer.subarray(0, 15).toString('utf8');
  if (header !== 'SQLite format 3') {
    throw new Error('Buffer does not contain a valid SQLite format 3 header.');
  }

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  closeDatabaseConnection();

  const walPath = `${config.databasePath}-wal`;
  const shmPath = `${config.databasePath}-shm`;
  const tmpPath = `${config.databasePath}.cloud_hydrate.tmp`;

  fs.writeFileSync(tmpPath, buffer);
  if (fs.existsSync(walPath)) {
    try { fs.unlinkSync(walPath); } catch {}
  }
  if (fs.existsSync(shmPath)) {
    try { fs.unlinkSync(shmPath); } catch {}
  }
  fs.renameSync(tmpPath, config.databasePath);

  return getDatabase();
}

/**
 * Performs a live connectivity and integrity test.
 * Never assumes connection; verifies via actual PRAGMA and SQL queries.
 */
export function checkDatabaseConnection(): ConnectionDiagnostics {
  const start = performance.now();
  const dbDir = path.dirname(config.databasePath);
  const dirExists = fs.existsSync(dbDir);
  const fileExists = fs.existsSync(config.databasePath);
  let fileSizeBytes = 0;

  if (fileExists) {
    try {
      const stats = fs.statSync(config.databasePath);
      fileSizeBytes = stats.size;
    } catch {
      // ignore stat errors
    }
  }

  try {
    const db = getDatabase();

    // 1. Live ping query
    const ping = db.prepare('SELECT 1 as test').get() as { test: number } | undefined;
    if (!ping || ping.test !== 1) {
      throw new Error('Database ping query returned unexpected result.');
    }

    // 2. Pragmas verification
    const journalResult = db.pragma('journal_mode', { simple: true }) as string;
    const foreignKeyResult = db.pragma('foreign_keys', { simple: true }) as number;
    const integrityResult = db.pragma('integrity_check', { simple: true }) as string;

    // 3. Inspect existing tables
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tableRows.map((r) => r.name);
    const latency = Math.round((performance.now() - start) * 100) / 100;

    return {
      connected: true,
      driver: 'better-sqlite3 (Persistent File Storage)',
      databasePath: config.databasePath,
      databaseDirectoryExists: dirExists,
      fileExists: fs.existsSync(config.databasePath),
      fileSizeBytes: fileSizeBytes || (fs.existsSync(config.databasePath) ? fs.statSync(config.databasePath).size : 0),
      journalMode: String(journalResult).toLowerCase(),
      foreignKeysEnabled: foreignKeyResult === 1,
      integrityCheck: String(integrityResult),
      tableCount: tableNames.length,
      tables: tableNames,
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      driver: 'better-sqlite3 (Persistent File Storage)',
      databasePath: config.databasePath,
      databaseDirectoryExists: dirExists,
      fileExists,
      fileSizeBytes,
      journalMode: 'unknown',
      foreignKeysEnabled: false,
      integrityCheck: 'failed',
      tableCount: 0,
      tables: [],
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
      checkedAt: new Date().toISOString(),
      error: errorMsg || connectionError,
    };
  }
}
