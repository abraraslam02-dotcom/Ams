import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  HardDrive,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FolderCheck,
  Lock,
  GitCompare,
  ArrowRightLeft,
  WifiOff,
  FolderOpen,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, getStoredAuthToken } from '../../services/api';
import {
  OperatingModeStatus,
  BackupAndSyncNowResponse,
  SyncConflictRecord,
  SystemOperatingMode,
} from '../../types/system';
import { formatAppDateTime } from '../../utils/formatters';
import {
  saveVerifiedBackupToClientDDrive,
  selectDDriveBackupDirectory,
  getSavedDDriveDirectoryHandle,
} from '../../utils/dDriveBackupHelper';

interface SuperAdminOperatingModePanelProps {
  hasUnsavedInvoiceItems?: boolean;
  onModeChanged?: (status: OperatingModeStatus) => void;
  onDataChanged?: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SuperAdminOperatingModePanel: React.FC<SuperAdminOperatingModePanelProps> = ({
  hasUnsavedInvoiceItems = false,
  onModeChanged,
  onDataChanged,
}) => {
  const { isSuperAdmin } = useAuth();
  const [status, setStatus] = useState<OperatingModeStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [switchingTo, setSwitchingTo] = useState<SystemOperatingMode | null>(null);
  const [runningDDriveBackup, setRunningDDriveBackup] = useState<boolean>(false);
  const [runningCloudSync, setRunningCloudSync] = useState<boolean>(false);
  const [runningBackupSync, setRunningBackupSync] = useState<boolean>(false);
  const [dDriveFolderInput, setDDriveFolderInput] = useState<string>('D:\\AbrarMedicalStore\\Backups');
  const [linkedBrowserFolderName, setLinkedBrowserFolderName] = useState<string | null>(null);
  const [backupNotes, setBackupNotes] = useState<string>('');
  const [lastOperationResult, setLastOperationResult] = useState<BackupAndSyncNowResponse | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<number | null>(null);
  const [resolvingAll, setResolvingAll] = useState<boolean>(false);
  const [pendingSwitchConfirm, setPendingSwitchConfirm] = useState<{
    targetMode: SystemOperatingMode;
    message: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getOperatingModeStatus();
      if (res?.data) {
        setStatus(res.data);
        if (res.data.dDriveConfiguredFolder) {
          setDDriveFolderInput(res.data.dDriveConfiguredFolder);
        }
        onModeChanged?.(res.data);
      }
      const handle = await getSavedDDriveDirectoryHandle().catch(() => null);
      if (handle?.name) {
        setLinkedBrowserFolderName(handle.name);
      }
      if (isSuperAdmin) {
        const confRes = await api.getSyncConflicts('unresolved').catch(() => null);
        if (confRes?.conflicts) {
          setConflicts(confRes.conflicts);
        }
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to load system status right now.',
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, onModeChanged]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSelectDDriveFolder = async () => {
    const picked = await selectDDriveBackupDirectory();
    if (picked.success && picked.folderName) {
      setLinkedBrowserFolderName(picked.folderName);
      setFeedback({
        type: 'success',
        message: `D Drive backup folder "${picked.folderName}" connected (${dDriveFolderInput}). Click "Backup to D Drive Now" to create and verify a backup file.`,
      });
    } else if (picked.error) {
      setFeedback({
        type: 'warning',
        message: picked.error,
      });
    }
  };

  const handleSwitchMode = async (
    targetMode: SystemOperatingMode,
    allowWithPendingOfflineChanges = false
  ) => {
    if (!isSuperAdmin || !status || status.mode === targetMode) return;

    if (hasUnsavedInvoiceItems && !allowWithPendingOfflineChanges) {
      setPendingSwitchConfirm({
        targetMode,
        message:
          'You have unsaved invoice items open in Sales or Purchase. Save your open invoice first, or confirm below to switch modes now.',
      });
      return;
    }

    try {
      setSwitchingTo(targetMode);
      setFeedback(null);
      setPendingSwitchConfirm(null);

      const res = await api.switchOperatingMode({
        mode: targetMode,
        allowWithPendingOfflineChanges,
      });

      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }

      if (res.requiresConfirmation) {
        setPendingSwitchConfirm({
          targetMode,
          message: res.message,
        });
        setFeedback({ type: 'warning', message: res.message });
        return;
      }

      if (res.success && res.switched) {
        setFeedback({ type: 'success', message: res.message });
        onDataChanged?.();
      } else {
        setFeedback({
          type: 'error',
          message: res.message || res.error || `Could not switch to ${targetMode} MODE.`,
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : `Could not switch to ${targetMode} MODE.`,
      });
    } finally {
      setSwitchingTo(null);
    }
  };

  /**
   * Independent Manual Backup to D Drive (does NOT trigger Cloud Sync).
   */
  const handleRunDDriveBackupOnly = async () => {
    if (runningDDriveBackup || runningBackupSync) return;
    try {
      setRunningDDriveBackup(true);
      setFeedback(null);

      const cleanFolder = dDriveFolderInput.trim() || 'D:\\AbrarMedicalStore\\Backups';
      const res = await api.runDDriveBackupNow({
        customDDriveFolder: cleanFolder,
        notes: backupNotes.trim() || `Manual D Drive Backup to ${cleanFolder}`,
      });

      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }

      if (!res.backup) {
        setFeedback({
          type: 'error',
          message: res.error || res.message || 'D Drive backup failed.',
        });
        return;
      }

      // Case 1: Backend runs directly on Windows and wrote + verified the file on D:\ directly
      if (res.backup.writtenDirectlyToDDrive) {
        setFeedback({
          type: 'success',
          message: `D Drive Backup Successful! Verified SQLite backup saved at: ${res.backup.dDriveExactFilePath} (${formatBytes(res.backup.file_size_bytes)}, Integrity: OK).`,
        });
        setBackupNotes('');
        onDataChanged?.();
        return;
      }

      // Case 2: Backend runs in Cloud Run / Linux container -> use browser File System Access helper to save directly to user's Windows D:\ folder
      if (res.backup.requiresBrowserDDriveSave) {
        const saveRes = await saveVerifiedBackupToClientDDrive({
          backupId: res.backup.id,
          filename: res.backup.filename,
          expectedSizeBytes: res.backup.file_size_bytes,
          configuredFolder: cleanFolder,
          authToken: getStoredAuthToken(),
        });

        const confirmRes = await api.confirmDDriveBackupSave({
          success: saveRes.success,
          savedFilePath: saveRes.savedExactPath,
          configuredFolder: cleanFolder,
          error: saveRes.error,
        });

        if (confirmRes?.status) {
          setStatus(confirmRes.status);
          onModeChanged?.(confirmRes.status);
        }

        if (saveRes.success && saveRes.savedExactPath) {
          setFeedback({
            type: 'success',
            message: `D Drive Backup Successful! Verified backup saved to ${saveRes.savedExactPath} (${formatBytes(saveRes.verifiedSizeBytes)}, Integrity: OK).`,
          });
          setBackupNotes('');
        } else {
          setFeedback({
            type: 'warning',
            message:
              saveRes.error ||
              `D Drive (${cleanFolder}) was unavailable or permission was not granted. Server backup "${res.backup.filename}" is safe, but D Drive status is marked Failed.`,
          });
        }
        onDataChanged?.();
        return;
      }

      // Case 3: Backend is on Windows, but Drive D:\ does not exist or is not writable on that machine
      setFeedback({
        type: 'error',
        message:
          res.backup.dDriveError ||
          `D Drive (${cleanFolder}) is unavailable or not writable on this computer.`,
      });
      onDataChanged?.();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'D Drive backup failed.',
      });
    } finally {
      setRunningDDriveBackup(false);
    }
  };

  /**
   * Independent Manual Cloud Synchronization (does NOT depend on Local Backup).
   */
  const handleRunCloudSyncOnly = async () => {
    if (!isSuperAdmin || runningCloudSync || runningBackupSync) return;
    try {
      setRunningCloudSync(true);
      setFeedback(null);

      const res = await api.runIndependentCloudSyncNow();
      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }
      if (Array.isArray(res?.conflicts)) {
        setConflicts(res.conflicts);
      }

      if (res.cloudSync?.status === 'Successful') {
        setFeedback({
          type: 'success',
          message: res.cloudSync.message,
        });
        onDataChanged?.();
      } else {
        setFeedback({
          type: 'warning',
          message: res.cloudSync?.message || 'Cloud synchronization is pending.',
        });
        onDataChanged?.();
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Cloud synchronization could not run right now.',
      });
    } finally {
      setRunningCloudSync(false);
    }
  };

  /**
   * Combined Backup & Sync Now (Step 1 and Step 2 are decoupled so quota exhaustion never breaks D-Drive Backup).
   */
  const handleBackupAndSyncNow = async () => {
    if (!isSuperAdmin || runningBackupSync || runningDDriveBackup || runningCloudSync) return;
    try {
      setRunningBackupSync(true);
      setFeedback(null);
      setPendingSwitchConfirm(null);

      const cleanFolder = dDriveFolderInput.trim() || 'D:\\AbrarMedicalStore\\Backups';
      const res = await api.runBackupAndSyncNow(backupNotes.trim() || undefined, cleanFolder);
      setLastOperationResult(res);
      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }
      if (Array.isArray(res?.conflicts)) {
        setConflicts(res.conflicts);
      }
      setBackupNotes('');

      // If running in Cloud Run / Linux, also save the verified Step 1 backup to the user's Windows D:\ folder
      if (
        res.step1LocalBackup?.status === 'Successful' &&
        res.step1LocalBackup.requiresBrowserDDriveSave &&
        res.step1LocalBackup.backupId &&
        res.step1LocalBackup.filename
      ) {
        const saveRes = await saveVerifiedBackupToClientDDrive({
          backupId: res.step1LocalBackup.backupId,
          filename: res.step1LocalBackup.filename,
          expectedSizeBytes: res.step1LocalBackup.fileSizeBytes,
          configuredFolder: cleanFolder,
          authToken: getStoredAuthToken(),
        });
        const confirmRes = await api.confirmDDriveBackupSave({
          success: saveRes.success,
          savedFilePath: saveRes.savedExactPath,
          configuredFolder: cleanFolder,
          error: saveRes.error,
        });
        if (confirmRes?.status) {
          setStatus(confirmRes.status);
          onModeChanged?.(confirmRes.status);
        }
      }

      if (res.step1LocalBackup.status === 'Failed') {
        setFeedback({
          type: 'error',
          message: `Local Backup failed: ${res.step1LocalBackup.error || 'Unknown error'}. Cloud Sync status: ${res.step2CloudSync.status}.`,
        });
      } else if (res.step2CloudSync.status === 'Successful') {
        setFeedback({
          type: 'success',
          message: `Backup Successful (${res.step1LocalBackup.filename}) & Cloud Sync Successful (Version #${res.step2CloudSync.cloudVersionSeq}).`,
        });
        onDataChanged?.();
      } else {
        setFeedback({
          type: 'warning',
          message: `Local Backup Successful (${res.step1LocalBackup.filename}). Cloud Sync is ${res.step2CloudSync.status}: ${res.step2CloudSync.message}`,
        });
        onDataChanged?.();
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Backup & Sync encountered an error.',
      });
    } finally {
      setRunningBackupSync(false);
    }
  };

  const handleResolveConflict = async (
    conflictId: number,
    resolution: 'keep_local' | 'keep_cloud'
  ) => {
    if (!isSuperAdmin || resolvingConflictId !== null || resolvingAll) return;
    try {
      setResolvingConflictId(conflictId);
      setFeedback(null);
      const res = await api.resolveSyncConflict(conflictId, resolution);
      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      setFeedback({ type: 'success', message: res.message });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to resolve conflict.',
      });
    } finally {
      setResolvingConflictId(null);
    }
  };

  const handleResolveAllConflicts = async (resolution: 'keep_local' | 'keep_cloud') => {
    if (!isSuperAdmin || resolvingAll || resolvingConflictId !== null) return;
    try {
      setResolvingAll(true);
      setFeedback(null);
      const res = await api.resolveAllSyncConflicts(resolution);
      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }
      setConflicts([]);
      setFeedback({ type: 'success', message: res.message });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to resolve conflicts.',
      });
    } finally {
      setResolvingAll(false);
    }
  };

  const activeMode: SystemOperatingMode = status?.mode || 'ONLINE';
  const isOffline = activeMode === 'OFFLINE';
  const dDriveStatus = status?.dDriveBackupStatus || 'Not Run';
  const localDbHealthy = Boolean(status?.storage?.localDbConnected && status?.storage?.localIntegrityOk);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden text-xs">
      {/* Header */}
      <div
        className={`px-5 py-4 text-white flex flex-wrap items-center justify-between gap-3 ${
          isOffline
            ? 'bg-gradient-to-r from-amber-900 via-amber-800 to-slate-900'
            : 'bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl ${
              isOffline ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {isOffline ? <WifiOff className="w-5 h-5" /> : <Cloud className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-extrabold tracking-tight">
                Database Synchronization &amp; D Drive Backup Control Center
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold uppercase tracking-wider ${
                  isOffline
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-emerald-400 text-slate-950'
                }`}
              >
                {activeMode}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Local-First Architecture — All modules save locally immediately and synchronize incrementally when Online.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadStatus()}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Status</span>
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* REQUIRED 6-ITEM STATUS DISPLAY */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. ONLINE / OFFLINE */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              1. System Mode (ONLINE / OFFLINE)
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded font-extrabold text-xs ${
                  isOffline
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                }`}
              >
                {activeMode}
              </span>
              <span className="text-[11px] text-slate-600 font-medium">
                {isOffline ? 'Local-Only (Zero Cloud Calls)' : 'Local-First + Cloud Sync Enabled'}
              </span>
            </div>
          </div>

          {/* 2. Local Database Status */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              2. Local Database Status
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded font-extrabold text-xs ${
                  localDbHealthy
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-rose-100 text-rose-900 border border-rose-300'
                }`}
              >
                {localDbHealthy ? 'Connected & Verified OK' : 'Check Required'}
              </span>
              <span className="text-[11px] font-mono text-slate-600">
                ({formatBytes(status?.storage?.localFileSizeBytes || 0)})
              </span>
            </div>
          </div>

          {/* 3. Pending Sync Records */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              3. Pending Sync Records
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded font-mono font-extrabold text-xs ${
                  (status?.pendingLocalChangesCount || 0) > 0
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                }`}
              >
                {status?.pendingLocalChangesCount ?? 0} Record(s)
              </span>
              <span className="text-[11px] text-slate-600">
                {(status?.pendingLocalChangesCount || 0) > 0
                  ? 'Safely queued in local database'
                  : 'All local changes synchronized'}
              </span>
            </div>
          </div>

          {/* 4. Last Successful Cloud Sync */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>4. Last Successful Cloud Sync</span>
            </div>
            <div className="font-mono font-bold text-slate-900 text-xs">
              {status?.lastSuccessfulCloudSyncAt
                ? formatAppDateTime(status.lastSuccessfulCloudSyncAt)
                : 'Not synced yet'}
            </div>
            <div className="text-[11px] text-slate-600">
              {status?.quotaExhausted
                ? 'Cloud Sync Pending (Daily Read Quota Exhausted — Local Data Safe)'
                : `Status: ${status?.cloudSyncStatus || 'Ready'} • Cloud Version #${status?.cloud?.lastVersionSeq ?? 0}`}
            </div>
          </div>

          {/* 5. D Drive Backup Status */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              5. D Drive Backup Status
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded font-extrabold text-xs ${
                  dDriveStatus === 'Successful'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : dDriveStatus === 'Failed'
                    ? 'bg-rose-100 text-rose-900 border border-rose-300'
                    : dDriveStatus === 'Pending Save'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {dDriveStatus}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-600 break-all">
              {status?.dDriveBackupPath
                ? `Path: ${status.dDriveBackupPath}`
                : status?.dDriveBackupError
                ? status.dDriveBackupError
                : `Target: ${status?.dDriveConfiguredFolder || 'D:\\AbrarMedicalStore\\Backups'}`}
            </div>
          </div>

          {/* 6. Last Successful Backup */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>6. Last Successful Backup</span>
            </div>
            <div className="font-mono font-bold text-slate-900 text-xs">
              {status?.lastSuccessfulBackupAt
                ? formatAppDateTime(status.lastSuccessfulBackupAt)
                : 'Not run yet'}
            </div>
            <div className="text-[10px] font-mono text-slate-600 truncate">
              {status?.lastBackupFilename
                ? `${status.lastBackupFilename} (${formatBytes(status.lastBackupSizeBytes || 0)})`
                : 'No backup file created yet'}
            </div>
          </div>
        </div>

        {/* Quota Exhaustion Clear Banner */}
        {status?.quotaExhausted && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Cloud Sync is Pending Because Firestore Daily Read Quota Is Exhausted
              </div>
              <div className="text-[11px] mt-0.5 leading-relaxed">
                All sales, purchases, stock, ledgers, cashbook entries, and pending changes are safely saved in your local database. You can continue working all day and create D Drive backups normally. Cloud Synchronization will resume automatically after the daily quota resets without re-downloading the entire database.
              </div>
            </div>
          </div>
        )}

        {!isSuperAdmin && (
          <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-slate-500 shrink-0" />
            <div>
              <strong>Super Admin Access Required:</strong> Only Super Admin can switch ONLINE / OFFLINE mode or trigger manual synchronization.
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : feedback.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  feedback.type === 'warning' ? 'text-amber-600' : 'text-rose-600'
                }`}
              />
            )}
            <div className="font-medium leading-relaxed">{feedback.message}</div>
          </div>
        )}

        {/* Pending Confirmation Dialog */}
        {pendingSwitchConfirm && isSuperAdmin && (
          <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 space-y-3">
            <div className="flex items-start gap-2.5 text-amber-950">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-extrabold">Confirm Operating Mode Switch</div>
                <p className="text-[11px] leading-relaxed">{pendingSwitchConfirm.message}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={switchingTo !== null}
                onClick={() => void handleSwitchMode(pendingSwitchConfirm.targetMode, true)}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
              >
                Confirm &amp; Switch to {pendingSwitchConfirm.targetMode} MODE
              </button>
              <button
                type="button"
                onClick={() => setPendingSwitchConfirm(null)}
                className="px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* SECTION 1: ONLINE / OFFLINE MODE SELECTOR */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-slate-600" />
              <span>Operating Mode Control (Super Admin)</span>
            </h4>
            {status?.switchedAt && (
              <span className="text-[11px] text-slate-500">
                Last switched: <strong>{formatAppDateTime(status.switchedAt)}</strong>
                {status.switchedBy ? ` by ${status.switchedBy}` : ''}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ONLINE MODE CARD */}
            <div
              className={`rounded-xl border-2 p-4 transition-all ${
                !isOffline
                  ? 'border-emerald-500 bg-emerald-50/50 shadow-xs'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-lg ${
                      !isOffline ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Cloud className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-900 text-sm">ONLINE MODE</div>
                    <div className="text-[11px] text-slate-600">
                      Local-First Saving + Automatic Incremental Cloud Sync
                    </div>
                  </div>
                </div>
                {!isOffline && (
                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold uppercase">
                    Active
                  </span>
                )}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  disabled={!isSuperAdmin || !isOffline || switchingTo !== null}
                  onClick={() => void handleSwitchMode('ONLINE')}
                  className={`w-full py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                    !isOffline
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 cursor-default'
                      : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white cursor-pointer'
                  }`}
                >
                  {switchingTo === 'ONLINE' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Switching to ONLINE MODE...</span>
                    </>
                  ) : !isOffline ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ONLINE MODE Active</span>
                    </>
                  ) : (
                    <span>Select ONLINE MODE</span>
                  )}
                </button>
              </div>
            </div>

            {/* OFFLINE MODE CARD */}
            <div
              className={`rounded-xl border-2 p-4 transition-all ${
                isOffline
                  ? 'border-amber-500 bg-amber-50/50 shadow-xs'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-lg ${
                      isOffline ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-900 text-sm">OFFLINE MODE</div>
                    <div className="text-[11px] text-slate-600">
                      100% Local Operation Without Internet • Zero Cloud Requests
                    </div>
                  </div>
                </div>
                {isOffline && (
                  <span className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold uppercase">
                    Active
                  </span>
                )}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  disabled={!isSuperAdmin || isOffline || switchingTo !== null}
                  onClick={() => void handleSwitchMode('OFFLINE')}
                  className={`w-full py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                    isOffline
                      ? 'bg-amber-100 text-amber-900 border border-amber-300 cursor-default'
                      : 'bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white cursor-pointer'
                  }`}
                >
                  {switchingTo === 'OFFLINE' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Switching to OFFLINE MODE...</span>
                    </>
                  ) : isOffline ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>OFFLINE MODE Active</span>
                    </>
                  ) : (
                    <span>Select OFFLINE MODE</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: D DRIVE BACKUP & INCREMENTAL CLOUD SYNCHRONIZATION */}
        <div className="rounded-xl border-2 border-slate-900 overflow-hidden">
          <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-extrabold text-xs uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>D Drive Backup &amp; Incremental Cloud Synchronization</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Independent D Drive Local Backup (with SQLite PRAGMA integrity verification) and Incremental Cloud Sync
              </div>
            </div>
            {linkedBrowserFolderName && (
              <span className="px-2.5 py-1 rounded bg-emerald-900/70 border border-emerald-600 font-mono text-[11px] text-emerald-200 font-bold">
                Connected Folder: {linkedBrowserFolderName}
              </span>
            )}
          </div>

          <div className="p-4 space-y-4 bg-white">
            {/* Configurable D Drive Backup Folder */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-5 space-y-1">
                <label className="block text-[11px] font-bold text-slate-700">
                  Configurable D Drive Backup Folder Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={dDriveFolderInput}
                    onChange={(e) => setDDriveFolderInput(e.target.value)}
                    placeholder="D:\AbrarMedicalStore\Backups"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSelectDDriveFolder()}
                    title="Grant browser permission to write directly to your D:\AbrarMedicalStore\Backups folder"
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                    <span>Select Folder</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={runningDDriveBackup || runningBackupSync}
                  onClick={() => void handleRunDDriveBackupOnly()}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-extrabold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <HardDrive className={`w-4 h-4 ${runningDDriveBackup ? 'animate-spin' : ''}`} />
                  <span>{runningDDriveBackup ? 'Backing Up to D Drive...' : 'Backup to D Drive Now'}</span>
                </button>

                <button
                  type="button"
                  disabled={!isSuperAdmin || runningCloudSync || runningBackupSync}
                  onClick={() => void handleRunCloudSyncOnly()}
                  className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-extrabold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Cloud className={`w-4 h-4 ${runningCloudSync ? 'animate-spin' : ''}`} />
                  <span>{runningCloudSync ? 'Synchronizing Cloud...' : 'Sync Cloud Now'}</span>
                </button>

                <button
                  type="button"
                  disabled={!isSuperAdmin || runningBackupSync || runningDDriveBackup || runningCloudSync}
                  onClick={() => void handleBackupAndSyncNow()}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${runningBackupSync ? 'animate-spin' : ''}`} />
                  <span>{runningBackupSync ? 'Running Backup & Sync...' : 'Backup & Sync Now'}</span>
                </button>
              </div>
            </div>

            {/* Exact File Paths & Writability Verification Info */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Live Local SQLite Database (Never Overwritten During Backup)</span>
                </div>
                <div className="font-mono text-slate-900 break-all">
                  {status?.storage?.activeDatabasePath || 'data/ams_medical.db'}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-700 flex items-center gap-1.5">
                  <FolderCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>Exact D Drive Backup File Path &amp; Verification</span>
                </div>
                <div className="font-mono text-slate-900 break-all">
                  {status?.dDriveBackupPath ||
                    lastOperationResult?.step1LocalBackup?.dDriveExactFilePath ||
                    `${dDriveFolderInput}\\(Click "Backup to D Drive Now" to create & verify)`}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: CONFLICT DETECTION & SAFE RESOLUTION */}
        {(conflicts.length > 0 || (status?.unresolvedConflictsCount ?? 0) > 0) && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50/40 overflow-hidden">
            <div className="px-4 py-3 bg-amber-100 border-b border-amber-300 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-950">
                <GitCompare className="w-4 h-4 text-amber-700" />
                <div>
                  <div className="font-extrabold text-xs">
                    Sync Conflicts Detected ({conflicts.length}) — Safe Resolution Required
                  </div>
                  <div className="text-[11px] text-amber-900">
                    The same record was modified on multiple computers. Neither version was overwritten.
                    Choose which version to keep, then click Sync Cloud Now.
                  </div>
                </div>
              </div>
              {isSuperAdmin && conflicts.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={resolvingAll || resolvingConflictId !== null}
                    onClick={() => void handleResolveAllConflicts('keep_local')}
                    className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-bold text-[11px] cursor-pointer"
                  >
                    Keep Local for All ({conflicts.length})
                  </button>
                  <button
                    type="button"
                    disabled={resolvingAll || resolvingConflictId !== null}
                    onClick={() => void handleResolveAllConflicts('keep_cloud')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-[11px] cursor-pointer"
                  >
                    Keep Cloud for All ({conflicts.length})
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 space-y-3">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  className="p-3.5 rounded-xl bg-white border border-amber-300 shadow-2xs space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] font-bold uppercase mr-2">
                        {conflict.table_name}
                      </span>
                      <span className="font-extrabold text-slate-900">
                        {conflict.record_label || `Record #${conflict.record_id}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!isSuperAdmin || resolvingConflictId === conflict.id || resolvingAll}
                        onClick={() => void handleResolveConflict(conflict.id, 'keep_local')}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-[11px] cursor-pointer"
                      >
                        Keep Local Version
                      </button>
                      <button
                        type="button"
                        disabled={!isSuperAdmin || resolvingConflictId === conflict.id || resolvingAll}
                        onClick={() => void handleResolveConflict(conflict.id, 'keep_cloud')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[11px] cursor-pointer"
                      >
                        Keep Cloud Version
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200">
                      <div className="font-bold text-amber-950 mb-1">
                        Local Database Version ({conflict.local_updated_at || 'N/A'})
                      </div>
                      <div className="space-y-0.5 font-mono text-[10px] text-slate-800">
                        {conflict.changed_fields.map((field) => (
                          <div key={`local-${conflict.id}-${field}`}>
                            <span className="text-slate-500">{field}:</span>{' '}
                            <strong>{String(conflict.local_snapshot?.[field] ?? 'null')}</strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
                      <div className="font-bold text-emerald-950 mb-1">
                        Cloud Database Version ({conflict.cloud_updated_at || 'N/A'})
                      </div>
                      <div className="space-y-0.5 font-mono text-[10px] text-slate-800">
                        {conflict.changed_fields.map((field) => (
                          <div key={`cloud-${conflict.id}-${field}`}>
                            <span className="text-slate-500">{field}:</span>{' '}
                            <strong>{String(conflict.cloud_snapshot?.[field] ?? 'null')}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
