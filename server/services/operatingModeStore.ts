import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';

export type SystemOperatingMode = 'ONLINE' | 'OFFLINE';
export type LocalBackupStatus = 'Successful' | 'Failed' | 'Not Run';
export type CloudSyncStatus = 'Successful' | 'Pending' | 'Failed' | 'Not Run';
export type DDriveBackupStatus = 'Successful' | 'Failed' | 'Pending Save' | 'Not Run';

export interface PersistedOperatingModeState {
  mode: SystemOperatingMode;
  switchedAt: string | null;
  switchedBy: string | null;
  localBackupStatus: LocalBackupStatus;
  lastSuccessfulBackupAt: string | null;
  lastBackupFilename: string | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number;
  lastBackupSha256: string | null;
  lastBackupError: string | null;
  dDriveBackupStatus: DDriveBackupStatus;
  dDriveBackupPath: string | null;
  dDriveBackupError: string | null;
  dDriveConfiguredFolder: string;
  cloudSyncStatus: CloudSyncStatus;
  lastSuccessfulCloudSyncAt: string | null;
  lastCloudSyncError: string | null;
  pendingLocalChangesCount: number;
  manualControlOnly: boolean;
  quotaExhausted: boolean;
  quotaCooldownUntilMs: number;
  lastSyncedCloudSha256: string | null;
  lastSyncedCloudVersionSeq: number;
}

const DEFAULT_STATE: PersistedOperatingModeState = {
  mode: 'OFFLINE',
  switchedAt: null,
  switchedBy: null,
  localBackupStatus: 'Not Run',
  lastSuccessfulBackupAt: null,
  lastBackupFilename: null,
  lastBackupPath: null,
  lastBackupSizeBytes: 0,
  lastBackupSha256: null,
  lastBackupError: null,
  dDriveBackupStatus: 'Not Run',
  dDriveBackupPath: null,
  dDriveBackupError: null,
  dDriveConfiguredFolder: 'D:\\AbrarMedicalStore\\Backups',
  cloudSyncStatus: 'Not Run',
  lastSuccessfulCloudSyncAt: null,
  lastCloudSyncError: null,
  pendingLocalChangesCount: 0,
  manualControlOnly: false,
  quotaExhausted: false,
  quotaCooldownUntilMs: 0,
  lastSyncedCloudSha256: null,
  lastSyncedCloudVersionSeq: 0,
};

let cachedState: PersistedOperatingModeState | null = null;

function readStateFromDisk(): PersistedOperatingModeState {
  try {
    const cfgPath = config.operatingModeConfigPath;
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedOperatingModeState>;
      const mode: SystemOperatingMode =
        parsed.mode === 'ONLINE' && parsed.switchedBy ? 'ONLINE' : 'OFFLINE';
      const quotaCooldownUntilMs = Math.max(0, Number(parsed.quotaCooldownUntilMs || 0));
      const quotaExhausted = Boolean(parsed.quotaExhausted) && quotaCooldownUntilMs > Date.now();
      return {
        ...DEFAULT_STATE,
        ...parsed,
        mode,
        dDriveConfiguredFolder:
          String(parsed.dDriveConfiguredFolder || '').trim() || 'D:\\AbrarMedicalStore\\Backups',
        pendingLocalChangesCount: Math.max(0, Number(parsed.pendingLocalChangesCount || 0)),
        quotaExhausted,
        quotaCooldownUntilMs: quotaExhausted ? quotaCooldownUntilMs : 0,
        lastSyncedCloudVersionSeq: Math.max(0, Number(parsed.lastSyncedCloudVersionSeq || 0)),
      };
    }
  } catch {
    // Fall back to safe default without overwriting disk
  }
  return { ...DEFAULT_STATE };
}

function writeStateToDisk(nextState: PersistedOperatingModeState): void {
  const cfgPath = config.operatingModeConfigPath;
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${cfgPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(nextState, null, 2), 'utf8');
  fs.renameSync(tmpPath, cfgPath);
}

/**
 * Returns the persisted operating mode state synchronously (safe to call before DB or Cloud init).
 */
export function getPersistedOperatingModeState(): PersistedOperatingModeState {
  if (!cachedState) {
    cachedState = readStateFromDisk();
  }
  return { ...cachedState };
}

/**
 * Synchronous helper for guards across middleware, cloud service, and startup boot.
 */
export function getSystemOperatingMode(): SystemOperatingMode {
  return getPersistedOperatingModeState().mode;
}

export function isOfflineOperatingMode(): boolean {
  return getSystemOperatingMode() === 'OFFLINE';
}

/**
 * Updates persisted operating mode metadata atomically on disk.
 */
export function updatePersistedOperatingModeState(
  patch: Partial<PersistedOperatingModeState>
): PersistedOperatingModeState {
  const current = getPersistedOperatingModeState();
  const next: PersistedOperatingModeState = {
    ...current,
    ...patch,
    mode: patch.mode === 'OFFLINE' ? 'OFFLINE' : patch.mode === 'ONLINE' ? 'ONLINE' : current.mode,
    pendingLocalChangesCount: Math.max(
      0,
      Number(
        patch.pendingLocalChangesCount !== undefined
          ? patch.pendingLocalChangesCount
          : current.pendingLocalChangesCount
      )
    ),
    manualControlOnly: true,
  };
  cachedState = next;
  try {
    writeStateToDisk(next);
  } catch (err) {
    console.warn('[AMS Operating Mode] Failed to persist mode config file:', err);
  }
  return { ...next };
}

/**
 * Records a local business mutation while in OFFLINE mode (or when cloud sync is deferred).
 * Purely local — never performs any cloud network request.
 */
export function recordLocalPendingMutation(): PersistedOperatingModeState {
  const current = getPersistedOperatingModeState();
  return updatePersistedOperatingModeState({
    pendingLocalChangesCount: current.pendingLocalChangesCount + 1,
    cloudSyncStatus: 'Pending',
  });
}

/**
 * Reloads state from disk (useful for tests or process restart verification).
 */
export function reloadOperatingModeStateFromDisk(): PersistedOperatingModeState {
  cachedState = readStateFromDisk();
  return { ...cachedState };
}
