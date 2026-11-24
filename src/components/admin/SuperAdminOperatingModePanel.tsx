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
  Server,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  OperatingModeStatus,
  BackupAndSyncNowResponse,
  SyncConflictRecord,
  SystemOperatingMode,
} from '../../types/system';
import { formatAppDateTime } from '../../utils/formatters';

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
  const [runningBackupSync, setRunningBackupSync] = useState<boolean>(false);
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
        onModeChanged?.(res.data);
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
        message: err instanceof Error ? err.message : 'Failed to load operating mode status.',
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, onModeChanged]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSwitchMode = async (
    targetMode: SystemOperatingMode,
    allowWithPendingOfflineChanges = false
  ) => {
    if (!isSuperAdmin || !status || status.mode === targetMode) return;

    if (hasUnsavedInvoiceItems && !allowWithPendingOfflineChanges) {
      setPendingSwitchConfirm({
        targetMode,
        message:
          'You currently have unsaved invoice items open in Sales or Purchase. Save or finalize your open invoice first, or confirm below if you still want to switch modes.',
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
          message: res.message || res.error || `Failed to switch to ${targetMode} MODE.`,
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : `Failed to switch to ${targetMode} MODE.`,
      });
    } finally {
      setSwitchingTo(null);
    }
  };

  const handleBackupAndSyncNow = async () => {
    if (!isSuperAdmin || runningBackupSync) return;
    try {
      setRunningBackupSync(true);
      setFeedback(null);
      setPendingSwitchConfirm(null);

      const res = await api.runBackupAndSyncNow(backupNotes.trim() || undefined);
      setLastOperationResult(res);
      if (res?.status) {
        setStatus(res.status);
        onModeChanged?.(res.status);
      }
      if (Array.isArray(res?.conflicts)) {
        setConflicts(res.conflicts);
      }
      setBackupNotes('');

      if (res.step1LocalBackup.status === 'Failed') {
        setFeedback({
          type: 'error',
          message: `Local Backup failed: ${res.step1LocalBackup.error || 'Unknown error'}. Cloud Sync was not started.`,
        });
      } else if (res.step2CloudSync.status === 'Successful') {
        setFeedback({
          type: 'success',
          message: `Local Backup Successful (${res.step1LocalBackup.filename}) & Cloud Sync Successful (v${res.step2CloudSync.cloudVersionSeq}).`,
        });
        onDataChanged?.();
      } else {
        setFeedback({
          type: 'warning',
          message: `Local Backup Successful (${res.step1LocalBackup.filename}). Cloud Sync: ${res.step2CloudSync.status} — ${res.step2CloudSync.message}`,
        });
        onDataChanged?.();
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Manual Backup & Sync failed.',
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
                Super Admin Control Panel — System Operating Mode &amp; Manual Backup / Cloud Sync
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold uppercase tracking-wider ${
                  isOffline
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-emerald-400 text-slate-950'
                }`}
              >
                {activeMode} MODE ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Strict Manual Control Only — Zero automatic background cloud sync or automatic backup timers.
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
        {!isSuperAdmin && (
          <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-slate-500 shrink-0" />
            <div>
              <strong>Super Admin Access Required:</strong> Only Super Admin can switch System Operating Mode
              or initiate manual Backup &amp; Cloud Synchronization. Current status is shown in read-only mode.
            </div>
          </div>
        )}

        {status?.storage?.warning && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Permanent Storage Drive Warning</div>
              <div className="mt-0.5">{status.storage.warning}</div>
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

        {/* Pending Confirmation Dialog for Switching Mode with Unsaved or Pending Offline Changes */}
        {pendingSwitchConfirm && isSuperAdmin && (
          <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 space-y-3">
            <div className="flex items-start gap-2.5 text-amber-950">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-extrabold">Safe Mode Switch Confirmation Required</div>
                <p className="text-[11px] leading-relaxed">{pendingSwitchConfirm.message}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {pendingSwitchConfirm.targetMode === 'ONLINE' && (
                <button
                  type="button"
                  disabled={runningBackupSync}
                  onClick={() => void handleBackupAndSyncNow()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  Run BACKUP &amp; SYNC NOW First (Recommended)
                </button>
              )}
              <button
                type="button"
                disabled={switchingTo !== null}
                onClick={() => void handleSwitchMode(pendingSwitchConfirm.targetMode, true)}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
              >
                Switch to {pendingSwitchConfirm.targetMode} MODE Anyway
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

        {/* SECTION 1: SYSTEM OPERATING MODE CONTROL */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-slate-600" />
              <span>1. System Operating Mode</span>
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
                      Primary Cloud Database • Multi-Computer &amp; Android Access
                    </div>
                  </div>
                </div>
                {!isOffline && (
                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold uppercase">
                    Active
                  </span>
                )}
              </div>

              <ul className="mt-3 space-y-1 text-[11px] text-slate-600 list-disc pl-4">
                <li>Uses existing Cloud Database as the primary working database.</li>
                <li>All modules, multi-computer terminals, and Android devices stay active.</li>
                <li>Verifies live Cloud Database reachability before activating.</li>
              </ul>

              <div className="mt-4">
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
                      <span>Verifying Cloud DB &amp; Switching...</span>
                    </>
                  ) : !isOffline ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Currently Running in ONLINE MODE</span>
                    </>
                  ) : (
                    <span>Switch to ONLINE MODE</span>
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
                      Permanent Local Database • Zero Cloud Requests
                    </div>
                  </div>
                </div>
                {isOffline && (
                  <span className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold uppercase">
                    Active
                  </span>
                )}
              </div>

              <ul className="mt-3 space-y-1 text-[11px] text-slate-600 list-disc pl-4">
                <li>Switches all modules to the permanent local SQLite database.</li>
                <li>Works completely without internet and persists across restarts.</li>
                <li>Makes zero Cloud Database requests until manual BACKUP &amp; SYNC NOW.</li>
              </ul>

              <div className="mt-4">
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
                      <span>Verifying Local DB &amp; Switching...</span>
                    </>
                  ) : isOffline ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Currently Running in OFFLINE MODE</span>
                    </>
                  ) : (
                    <span>Switch to OFFLINE MODE</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: PERMANENT LOCAL STORAGE & DATABASE DIAGNOSTICS */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <FolderCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. Permanent Local Database &amp; Backup Storage Paths</span>
            </h4>
            <span
              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                status?.storage?.localIntegrityOk
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              Local DB Integrity: {status?.storage?.localIntegrityOk ? 'VERIFIED OK' : 'CHECK REQUIRED'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1">
              <div className="text-slate-500 font-semibold flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-600" />
                <span>Windows Permanent Local Database Path</span>
              </div>
              <div className="font-mono font-bold text-slate-900 break-all">
                {status?.storage?.windowsPermanentDatabaseDir || 'D:\\AbrarMedicalStore\\Database'}
              </div>
              <div className="text-[10px] text-slate-500 break-all">
                Active Runtime File: <span className="font-mono">{status?.storage?.activeDatabasePath || 'Loading...'}</span>{' '}
                ({formatBytes(status?.storage?.localFileSizeBytes || 0)})
              </div>
            </div>

            <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1">
              <div className="text-slate-500 font-semibold flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-slate-600" />
                <span>Windows Permanent Backup Path</span>
              </div>
              <div className="font-mono font-bold text-slate-900 break-all">
                {status?.storage?.windowsPermanentBackupDir || 'D:\\AbrarMedicalStore\\Backups'}
              </div>
              <div className="text-[10px] text-slate-500 break-all">
                Active Backup Folder: <span className="font-mono">{status?.storage?.activeBackupDir || 'Loading...'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: MANUAL BACKUP + CLOUD SYNCHRONIZATION (SINGLE BUTTON) */}
        <div className="rounded-xl border-2 border-slate-900 overflow-hidden">
          <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-extrabold text-xs uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>3. Manual Local Backup &amp; Cloud Database Synchronization</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Step 1: Verified Local Backup → Step 2: Conflict-Aware Cloud Sync → Step 3: Separate Status Report
              </div>
            </div>
            <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
              Pending Offline Changes: {status?.pendingLocalChangesCount ?? 0}
            </span>
          </div>

          <div className="p-4 space-y-4 bg-white">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                disabled={!isSuperAdmin || runningBackupSync}
                value={backupNotes}
                onChange={(e) => setBackupNotes(e.target.value)}
                placeholder="Optional backup label (e.g., End of Day Backup & Sync)..."
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-300 text-xs disabled:bg-slate-100"
              />
              <button
                type="button"
                disabled={!isSuperAdmin || runningBackupSync}
                onClick={() => void handleBackupAndSyncNow()}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold text-xs tracking-wide flex items-center justify-center gap-2 shadow-sm cursor-pointer shrink-0 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${runningBackupSync ? 'animate-spin' : ''}`} />
                <span>{runningBackupSync ? 'RUNNING BACKUP & SYNC...' : 'BACKUP & SYNC NOW'}</span>
              </button>
            </div>

            {/* Separate Step Results & Last Successful Timestamps */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Local Backup Status */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Step 1 • Local Backup
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                      (lastOperationResult?.step1LocalBackup.status || status?.localBackupStatus) ===
                      'Successful'
                        ? 'bg-emerald-100 text-emerald-800'
                        : (lastOperationResult?.step1LocalBackup.status || status?.localBackupStatus) ===
                          'Failed'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {lastOperationResult?.step1LocalBackup.status || status?.localBackupStatus || 'Not Run'}
                  </span>
                </div>
                {(lastOperationResult?.step1LocalBackup.filename || status?.lastBackupFilename) && (
                  <div className="text-[10px] font-mono text-slate-600 truncate" title={status?.lastBackupPath || ''}>
                    {lastOperationResult?.step1LocalBackup.filename || status?.lastBackupFilename}
                  </div>
                )}
              </div>

              {/* Cloud Sync Status */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Step 2 • Cloud Sync
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                      (lastOperationResult?.step2CloudSync.status || status?.cloudSyncStatus) ===
                      'Successful'
                        ? 'bg-emerald-100 text-emerald-800'
                        : (lastOperationResult?.step2CloudSync.status || status?.cloudSyncStatus) ===
                          'Pending'
                        ? 'bg-amber-100 text-amber-900'
                        : (lastOperationResult?.step2CloudSync.status || status?.cloudSyncStatus) ===
                          'Failed'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {lastOperationResult?.step2CloudSync.status || status?.cloudSyncStatus || 'Not Run'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600 line-clamp-2">
                  {lastOperationResult?.step2CloudSync.message ||
                    status?.lastCloudSyncError ||
                    'Cloud sync runs only on manual BACKUP & SYNC NOW.'}
                </div>
              </div>

              {/* Last Successful Backup Date & Time */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Last Successful Backup</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-xs">
                  {status?.lastSuccessfulBackupAt
                    ? formatAppDateTime(status.lastSuccessfulBackupAt)
                    : 'Not run yet'}
                </div>
                {status?.lastBackupSizeBytes ? (
                  <div className="text-[10px] text-slate-500 font-mono">
                    Size: {formatBytes(status.lastBackupSizeBytes)}
                  </div>
                ) : null}
              </div>

              {/* Last Successful Cloud Sync Date & Time */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Last Successful Cloud Sync</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-xs">
                  {status?.lastSuccessfulCloudSyncAt
                    ? formatAppDateTime(status.lastSuccessfulCloudSyncAt)
                    : 'Not synced yet'}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  Cloud Version: #{status?.cloud?.lastVersionSeq ?? 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4: CONFLICT DETECTION & SAFE RESOLUTION */}
        {(conflicts.length > 0 || (status?.unresolvedConflictsCount ?? 0) > 0) && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50/40 overflow-hidden">
            <div className="px-4 py-3 bg-amber-100 border-b border-amber-300 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-950">
                <GitCompare className="w-4 h-4 text-amber-700" />
                <div>
                  <div className="font-extrabold text-xs">
                    Sync Conflicts Detected ({conflicts.length}) — Manual Resolution Required
                  </div>
                  <div className="text-[11px] text-amber-900">
                    The same record was modified in both Local and Cloud databases. Neither version was overwritten.
                    Choose which version to keep, then click BACKUP &amp; SYNC NOW again.
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
                  className="bg-white rounded-xl border border-amber-200 p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] uppercase mr-2">
                        {conflict.table_name}
                      </span>
                      <strong className="text-slate-900">
                        {conflict.record_label || `Record #${conflict.record_id}`}
                      </strong>
                      <span className="text-slate-500 ml-2 font-mono text-[10px]">
                        ID: {conflict.record_id}
                      </span>
                    </div>
                    <div className="text-[10px] text-amber-800 font-semibold">
                      Changed fields: {conflict.changed_fields.join(', ')}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-1">
                      <div className="font-bold text-amber-950 flex items-center justify-between">
                        <span>Local Database Version</span>
                        <span className="font-mono text-[10px] text-amber-800">
                          {conflict.local_updated_at ? formatAppDateTime(conflict.local_updated_at) : 'N/A'}
                        </span>
                      </div>
                      <div className="space-y-0.5 font-mono text-[10px] text-slate-800">
                        {conflict.changed_fields.map((field) => (
                          <div key={field} className="flex justify-between gap-2">
                            <span className="text-slate-500">{field}:</span>
                            <strong className="text-right">
                              {String(conflict.local_snapshot?.[field] ?? '')}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-1">
                      <div className="font-bold text-emerald-950 flex items-center justify-between">
                        <span>Cloud Database Version</span>
                        <span className="font-mono text-[10px] text-emerald-800">
                          {conflict.cloud_updated_at ? formatAppDateTime(conflict.cloud_updated_at) : 'N/A'}
                        </span>
                      </div>
                      <div className="space-y-0.5 font-mono text-[10px] text-slate-800">
                        {conflict.changed_fields.map((field) => (
                          <div key={field} className="flex justify-between gap-2">
                            <span className="text-slate-500">{field}:</span>
                            <strong className="text-right">
                              {String(conflict.cloud_snapshot?.[field] ?? '')}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {isSuperAdmin && (
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={resolvingConflictId === conflict.id}
                        onClick={() => void handleResolveConflict(conflict.id, 'keep_local')}
                        className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                      >
                        Keep Local Version
                      </button>
                      <button
                        type="button"
                        disabled={resolvingConflictId === conflict.id}
                        onClick={() => void handleResolveConflict(conflict.id, 'keep_cloud')}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                      >
                        Keep Cloud Version
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
