import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const workspaceRoot = path.resolve(process.cwd());
const isWindows = process.platform === 'win32';
const kService = String(process.env.K_SERVICE || '').toLowerCase();
const isPublishedCloudRun = kService.startsWith('ais-pre-');
const isStartScript = process.env.npm_lifecycle_event === 'start';
const explicitDbEnv = process.env.AMS_DB_ENV;
const inferredProduction =
  String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
  isPublishedCloudRun ||
  isStartScript;

const rawNodeEnv = String(
  process.env.NODE_ENV || (inferredProduction ? 'production' : 'development')
).toLowerCase();

const envScope: 'production' | 'development' | 'test' =
  explicitDbEnv === 'production' ||
  explicitDbEnv === 'development' ||
  explicitDbEnv === 'test'
    ? explicitDbEnv
    : rawNodeEnv === 'test'
    ? 'test'
    : inferredProduction
    ? 'production'
    : 'development';

const defaultDbFilename =
  envScope === 'test' ? 'ams_medical.test.db' : 'ams_medical.db';

export const WINDOWS_PERMANENT_DB_DIR = 'D:\\AbrarMedicalStore\\Database';
export const WINDOWS_PERMANENT_BACKUP_DIR = 'D:\\AbrarMedicalStore\\Backups';

/**
 * Rejects temporary OS folders or temporary build directories so the primary database
 * is never silently stored in volatile locations.
 */
export function isTemporaryStoragePath(candidatePath: string): boolean {
  const rawForward = String(candidatePath || '').replace(/\\/g, '/').toLowerCase();
  const normalized = path.resolve(candidatePath).replace(/\\/g, '/').toLowerCase();
  const sysTmp = path.resolve(os.tmpdir()).replace(/\\/g, '/').toLowerCase();
  if (
    normalized === sysTmp ||
    normalized.startsWith(sysTmp + '/') ||
    rawForward === sysTmp ||
    rawForward.startsWith(sysTmp + '/')
  ) {
    return true;
  }
  const blockedFragments = [
    '/appdata/local/temp/',
    '/appdata/local/temp',
    '/windows/temp/',
    '/tmp/',
    '/temp/',
    '/.vite/',
    '/dist/',
    '/build/',
  ];
  return blockedFragments.some((frag) => normalized.includes(frag) || rawForward.includes(frag));
}

const rawEnvDbPath = process.env.DATABASE_PATH
  ? path.resolve(workspaceRoot, process.env.DATABASE_PATH)
  : '';

// On Windows, permanently store primary database in D:\AbrarMedicalStore\Database\ams_medical.db
// (never inside temp folders or build directories). On non-Windows (Linux/Cloud Run), preserve
// the existing workspace permanent data directory.
const defaultPermanentDbDir = isWindows
  ? WINDOWS_PERMANENT_DB_DIR
  : path.resolve(workspaceRoot, 'data');

const defaultPermanentBackupDir = isWindows
  ? WINDOWS_PERMANENT_BACKUP_DIR
  : path.resolve(workspaceRoot, 'data', 'backups');

const permanentDatabasePath =
  rawEnvDbPath && !isTemporaryStoragePath(rawEnvDbPath)
    ? rawEnvDbPath
    : path.join(defaultPermanentDbDir, defaultDbFilename);

const permanentBackupDirectory =
  process.env.BACKUP_DIRECTORY && !isTemporaryStoragePath(process.env.BACKUP_DIRECTORY)
    ? path.resolve(workspaceRoot, process.env.BACKUP_DIRECTORY)
    : defaultPermanentBackupDir;

export interface PermanentStorageValidation {
  available: boolean;
  isWindows: boolean;
  databasePath: string;
  databaseDir: string;
  backupDir: string;
  windowsDatabaseDir: string;
  windowsBackupDir: string;
  driveRootAvailable: boolean;
  warning: string | null;
}

/**
 * Verifies that the permanent storage drive/location is available before opening or writing.
 * On Windows, strictly checks D:\ drive availability and NEVER silently creates a fallback
 * empty replacement database on another drive or temp folder.
 */
export function validatePermanentStorageLocation(): PermanentStorageValidation {
  const dbPath = permanentDatabasePath;
  const dbDir = path.dirname(dbPath);
  const backupDir = permanentBackupDirectory;

  if (isTemporaryStoragePath(dbPath)) {
    return {
      available: false,
      isWindows,
      databasePath: dbPath,
      databaseDir: dbDir,
      backupDir,
      windowsDatabaseDir: WINDOWS_PERMANENT_DB_DIR,
      windowsBackupDir: WINDOWS_PERMANENT_BACKUP_DIR,
      driveRootAvailable: false,
      warning: `Refused to store primary database in a temporary directory (${dbPath}). Configure a permanent storage path.`,
    };
  }

  if (isWindows) {
    const driveRoot = path.parse(dbPath).root || 'D:\\';
    const driveRootAvailable = fs.existsSync(driveRoot);
    if (!driveRootAvailable) {
      return {
        available: false,
        isWindows,
        databasePath: dbPath,
        databaseDir: dbDir,
        backupDir,
        windowsDatabaseDir: WINDOWS_PERMANENT_DB_DIR,
        windowsBackupDir: WINDOWS_PERMANENT_BACKUP_DIR,
        driveRootAvailable: false,
        warning: `Permanent local storage drive (${driveRoot}) is unavailable. Cannot access ${dbPath}. Existing database protection prevented creating an empty replacement database. Please reconnect or mount Drive ${driveRoot} and try again.`,
      };
    }
  }

  return {
    available: true,
    isWindows,
    databasePath: dbPath,
    databaseDir: dbDir,
    backupDir,
    windowsDatabaseDir: WINDOWS_PERMANENT_DB_DIR,
    windowsBackupDir: WINDOWS_PERMANENT_BACKUP_DIR,
    driveRootAvailable: true,
    warning: null,
  };
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: envScope === 'production' ? 'production' : rawNodeEnv,
  envScope,
  isWindows,
  isPublishedCloudRun,
  seedDatabasePath: path.resolve(workspaceRoot, 'data', 'ams_medical.db'),
  databasePath: permanentDatabasePath,
  primaryDatabaseDir: path.dirname(permanentDatabasePath),
  primaryBackupDir: permanentBackupDirectory,
  windowsPrimaryDatabaseDir: WINDOWS_PERMANENT_DB_DIR,
  windowsPrimaryBackupDir: WINDOWS_PERMANENT_BACKUP_DIR,
  operatingModeConfigPath: path.join(path.dirname(permanentDatabasePath), 'ams_operating_mode.json'),
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  appTimezoneOffset: '+05:00',
  appCurrency: process.env.APP_CURRENCY || 'PKR',
  appCurrencySymbol: 'Rs.',
  appLocale: process.env.APP_LOCALE || 'en-PK',
  companyName: process.env.COMPANY_NAME || 'Abrar Medical Store',
  country: 'Pakistan',
};

