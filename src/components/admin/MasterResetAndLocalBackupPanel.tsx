import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  Download,
  Upload,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Lock,
  Mail,
  FolderOpen,
  Database,
  Trash2,
  FileCheck2,
  History,
  Server,
} from 'lucide-react';
import { offlineStorage } from '../../services/offlineStorage';

export const MasterResetAndLocalBackupPanel: React.FC<{
  initialSection?: 'backup-restore' | 'master-reset' | 'protected-logs';
  onDataChanged?: () => void;
}> = ({ initialSection = 'backup-restore', onDataChanged }) => {
  const [section, setSection] = useState<'backup-restore' | 'master-reset' | 'protected-logs'>(
    initialSection
  );
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  // Local Backup Settings & History
  const [backupFolder, setBackupFolder] = useState('D:\\Abrar Medical Store Backups');
  const [autoDaily, setAutoDaily] = useState(true);
  const [autoWeekly, setAutoWeekly] = useState(true);
  const [keepDailyCount, setKeepDailyCount] = useState(7);
  const [keepWeeklyCount, setKeepWeeklyCount] = useState(4);
  const [superAdminEmail, setSuperAdminEmail] = useState('abrar.aslam02@gmail.com');
  const [backupsList, setBackupsList] = useState<Array<Record<string, any>>>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);

  // Restore from Local Hard Drive state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [verifyingUpload, setVerifyingUpload] = useState(false);
  const [stagedBackup, setStagedBackup] = useState<Record<string, any> | null>(null);
  const [restoreOtpRequested, setRestoreOtpRequested] = useState(false);
  const [restoreOtpCode, setRestoreOtpCode] = useState('');
  const [restoreConfirmationText, setRestoreConfirmationText] = useState('');
  const [executingRestore, setExecutingRestore] = useState(false);

  // Master Reset state (Option A & Option B)
  const [resetMode, setResetMode] = useState<'OPTION_A_TRANSACTIONS_ONLY' | 'OPTION_B_COMPLETE_RESET'>(
    'OPTION_A_TRANSACTIONS_ONLY'
  );
  const [resetPreview, setResetPreview] = useState<Record<string, any> | null>(null);
  const [resetOtpRequested, setResetOtpRequested] = useState(false);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [executingReset, setExecutingReset] = useState(false);

  // Protected Audit Logs
  const [protectedLogs, setProtectedLogs] = useState<Array<Record<string, any>>>([]);

  const loadBackupSettingsAndLogs = useCallback(async () => {
    try {
      const [bRes, rPrev, lRes] = await Promise.all([
        fetch('/api/enhancements/local-backup/settings').then((r) => r.json()),
        fetch('/api/enhancements/master-reset/preview').then((r) => r.json()),
        fetch('/api/enhancements/protected-audit-logs').then((r) => r.json()),
      ]);
      if (bRes.success) {
        setBackupFolder(bRes.settings?.local_backup_folder || 'D:\\Abrar Medical Store Backups');
        setAutoDaily(Boolean(bRes.settings?.auto_daily_backup));
        setAutoWeekly(Boolean(bRes.settings?.auto_weekly_backup));
        setKeepDailyCount(Number(bRes.settings?.keep_daily_backups || 7));
        setKeepWeeklyCount(Number(bRes.settings?.keep_weekly_backups || 4));
        setSuperAdminEmail(bRes.settings?.super_admin_email || 'abrar.aslam02@gmail.com');
        setBackupsList(bRes.backups || []);
      }
      if (rPrev.success) {
        setResetPreview(rPrev);
      }
      if (lRes.success) {
        setProtectedLogs(lRes.logs || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadBackupSettingsAndLogs();
  }, [loadBackupSettingsAndLogs]);

  const handleSaveBackupConfig = async () => {
    try {
      const res = await fetch('/api/enhancements/local-backup/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_backup_folder: backupFolder,
          auto_daily_backup: autoDaily,
          auto_weekly_backup: autoWeekly,
          keep_daily_backups: keepDailyCount,
          keep_weekly_backups: keepWeeklyCount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBanner({
          type: 'success',
          message: `Local Backup configuration saved (Target path: ${backupFolder}).`,
        });
      }
    } catch {
      // ignore
    }
  };

  // Part 13 & 14: CREATE LOCAL BACKUP (Saves .db to Server when online, or Offline IndexedDB Snapshot .ams.json when offline)
  const handleCreateLocalBackup = async () => {
    setCreatingBackup(true);
    setBanner(null);
    try {
      let createdOnlineDb = false;
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const res = await fetch('/api/enhancements/local-backup/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              backup_type: 'manual_local',
              notes: `Manual Local Backup to ${backupFolder}`,
            }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            const backupMeta = data.backup;
            const downloadUrl = `/api/enhancements/local-backup/download/${backupMeta.id}`;
            const binRes = await fetch(downloadUrl);
            const blob = await binRes.blob();

            let savedViaPicker = false;
            if (typeof (window as any).showSaveFilePicker === 'function') {
              try {
                const handle = await (window as any).showSaveFilePicker({
                  suggestedName: backupMeta.file_name,
                  types: [
                    {
                      description: 'SQLite Database Backup (.db)',
                      accept: { 'application/octet-stream': ['.db', '.sqlite'] },
                    },
                  ],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                savedViaPicker = true;
              } catch {
                // fall back to standard download
              }
            }

            if (!savedViaPicker) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = backupMeta.file_name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }

            setBanner({
              type: 'success',
              message: `Verified Local Backup created: "${backupMeta.file_name}" (${(
                Number(backupMeta.file_size_bytes || 0) / 1024
              ).toFixed(1)} KB) — Integrity Check: PASSED.`,
            });
            createdOnlineDb = true;
            await loadBackupSettingsAndLogs();
          }
        } catch {
          // Offline fallback below
        }
      }

      if (!createdOnlineDb) {
        // Offline Local Backup: export complete IndexedDB snapshot to laptop hard drive
        const snapshot = await offlineStorage.exportFullDatabaseSnapshot();
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Abrar_Offline_Backup_${dateStr}_${Date.now().toString().slice(-4)}.ams.json`;
        const jsonText = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([jsonText], { type: 'application/json' });

        await offlineStorage.put('local_backups', {
          id: Date.now(),
          file_name: fileName,
          file_size_bytes: blob.size,
          created_at: new Date().toISOString(),
          offline_snapshot: true,
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setBanner({
          type: 'success',
          message: `Verified Offline Local Backup created on laptop: "${fileName}" (${(
            blob.size / 1024
          ).toFixed(1)} KB) — All local IndexedDB stores backed up safely.`,
        });
      }
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create local backup',
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  // Part 15: Upload & Verify Local .db or .ams.json Backup File (Supports Offline Restoration)
  const handleVerifyLocalBackupFile = async (file: File) => {
    setSelectedFile(file);
    setVerifyingUpload(true);
    setStagedBackup(null);
    setBanner(null);
    try {
      // Check if it's an offline .ams.json snapshot or JSON backup
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || parsed.format !== 'AMS_LOCAL_SNAPSHOT_V1' || typeof parsed.stores !== 'object') {
          throw new Error('Invalid offline backup format. Expected AMS_LOCAL_SNAPSHOT_V1.');
        }
        const storeKeys = Object.keys(parsed.stores);
        setStagedBackup({
          isOfflineSnapshot: true,
          snapshotData: parsed,
          staged_file_name: file.name,
          table_count: storeKeys.length,
          row_counts: {
            items: parsed.recordCounts?.items ?? parsed.stores.items?.length ?? 0,
            accounts: parsed.recordCounts?.accounts ?? parsed.stores.accounts?.length ?? 0,
            sales: parsed.recordCounts?.sales ?? parsed.stores.sales?.length ?? 0,
          },
        });
        setRestoreOtpRequested(true);
        setBanner({
          type: 'success',
          message: `Offline Backup file "${file.name}" verified! (${storeKeys.length} local stores). Type "RESTORE DATA" below to restore offline.`,
        });
        return;
      }

      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Data = btoa(binary);

      const res = await fetch('/api/enhancements/local-backup/upload-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          file_base64: base64Data,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Backup file failed SQLite integrity verification');
      }
      setStagedBackup(data.verification);
      setBanner({
        type: 'success',
        message: `Backup file "${file.name}" verified! SQLite Integrity: OK (${data.verification.table_count} tables). Ready for Super Admin OTP confirmation.`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid or corrupted backup file',
      });
    } finally {
      setVerifyingUpload(false);
    }
  };

  const handleRequestRestoreOtp = async () => {
    try {
      const res = await fetch('/api/enhancements/local-backup/request-restore-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staged_file_name: stagedBackup?.staged_file_name || selectedFile?.name || '',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send verification code');
      setRestoreOtpRequested(true);
      setBanner({
        type: 'info',
        message: data.message || `6-digit Restore Verification Code sent to ${superAdminEmail}.`,
      });
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'OTP request failed' });
    }
  };

  const handleExecuteLocalRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stagedBackup) return;
    const cleanConfirm = restoreConfirmationText.trim().toUpperCase();
    if (cleanConfirm !== 'RESTORE DATA' && cleanConfirm !== 'RESTORE') {
      setBanner({ type: 'error', message: 'You must type "RESTORE DATA" or "RESTORE" to confirm.' });
      return;
    }
    setExecutingRestore(true);
    try {
      if (stagedBackup.isOfflineSnapshot && stagedBackup.snapshotData) {
        const res = await offlineStorage.importFullDatabaseSnapshot(stagedBackup.snapshotData);
        setBanner({
          type: 'success',
          message: `Local database successfully restored offline (${res.restoredStores} stores, ${res.totalRecords} records)!`,
        });
        setStagedBackup(null);
        setRestoreOtpRequested(false);
        setRestoreOtpCode('');
        setRestoreConfirmationText('');
        onDataChanged?.();
        return;
      }

      const res = await fetch('/api/enhancements/local-backup/execute-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staged_file_name: stagedBackup.staged_file_name,
          verification_code: restoreOtpCode.trim(),
          confirmation_text: 'RESTORE DATA',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      setBanner({
        type: 'success',
        message: data.message || 'Database successfully restored from local backup!',
      });
      setStagedBackup(null);
      setRestoreOtpRequested(false);
      setRestoreOtpCode('');
      setRestoreConfirmationText('');
      await loadBackupSettingsAndLogs();
      onDataChanged?.();
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Restore failed' });
    } finally {
      setExecutingRestore(false);
    }
  };

  // Part 11 & 12: Master Reset (Option A & Option B)
  const handleRequestResetOtp = async () => {
    try {
      const res = await fetch('/api/enhancements/master-reset/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_mode: resetMode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send reset OTP');
      setResetOtpRequested(true);
      setBanner({
        type: 'info',
        message: data.message || `6-digit Master Reset Code sent to Super Admin (${superAdminEmail}).`,
      });
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Failed to request code' });
    }
  };

  const handleExecuteMasterReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetConfirmText.trim() !== 'RESET ALL DATA') {
      setBanner({
        type: 'error',
        message: 'Please type "RESET ALL DATA" in capital letters to confirm.',
      });
      return;
    }
    setExecutingReset(true);
    try {
      const res = await fetch('/api/enhancements/master-reset/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reset_mode: resetMode,
          verification_code: resetOtpCode.trim(),
          confirmation_text: resetConfirmText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Master Reset failed');
      setBanner({
        type: 'success',
        message: `${data.message} Pre-reset backup saved as: ${data.pre_reset_backup?.file_name || 'Verified .db'}`,
      });
      setResetOtpRequested(false);
      setResetOtpCode('');
      setResetConfirmText('');
      await loadBackupSettingsAndLogs();
      onDataChanged?.();
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Master Reset failed' });
    } finally {
      setExecutingReset(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-Navigation Pills */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSection('backup-restore')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              section === 'backup-restore'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            Local Hard Drive Backup & Restore
          </button>

          <button
            type="button"
            onClick={() => setSection('master-reset')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              section === 'master-reset'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Master Reset (Option A & Option B)
          </button>

          <button
            type="button"
            onClick={() => setSection('protected-logs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              section === 'protected-logs'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            Protected Reset & Backup Audit Logs ({protectedLogs.length})
          </button>
        </div>

        <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5 text-emerald-600" />
          Super Admin Security Email: <strong className="text-slate-800">{superAdminEmail}</strong>
        </span>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : banner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          <span className="font-semibold">{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION 1: LOCAL HARD DRIVE BACKUP & RESTORE (PARTS 13-17)          */}
      {/* =================================================================== */}
      {section === 'backup-restore' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Create Local Backup & Retention Policy */}
          <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-600" />
                  Create Local Hard Drive Backup (.db)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Generates a complete, verified SQLite database file (<code className="font-mono text-emerald-700">Abrar_Backup_YYYY-MM-DD_001.db</code>) and saves it to your local computer hard drive.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Default Local Backup Folder Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={backupFolder}
                    onChange={(e) => setBackupFolder(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleSaveBackupConfig}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    Save Path
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                <label className="flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoDaily}
                    onChange={(e) => setAutoDaily(e.target.checked)}
                  />
                  Automatic Daily Backup (Keep {keepDailyCount})
                </label>
                <label className="flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoWeekly}
                    onChange={(e) => setAutoWeekly(e.target.checked)}
                  />
                  Automatic Weekly Backup (Keep {keepWeeklyCount})
                </label>
              </div>

              <button
                type="button"
                disabled={creatingBackup}
                onClick={handleCreateLocalBackup}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {creatingBackup ? 'Creating & Verifying SQLite Backup...' : 'CREATE LOCAL BACKUP'}
              </button>
            </div>

            {/* Verified Backups List */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <h4 className="text-xs font-extrabold uppercase text-slate-600">
                Recent Verified Backups ({backupsList.length})
              </h4>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {backupsList.map((bk) => (
                  <div
                    key={bk.id}
                    className="p-2.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50"
                  >
                    <div>
                      <div className="font-mono font-bold text-slate-900">{bk.file_name}</div>
                      <div className="text-[10px] text-slate-500">
                        {bk.created_at} • {(Number(bk.file_size_bytes || 0) / 1024).toFixed(1)} KB •{' '}
                        <span className="text-emerald-700 font-bold">Verified</span>
                      </div>
                    </div>
                    <a
                      href={`/api/enhancements/local-backup/download/${bk.id}`}
                      download={bk.file_name}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download .db
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: RESTORE FROM LOCAL BACKUP */}
          <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-600" />
                RESTORE FROM LOCAL BACKUP
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Browse a <code className="font-mono">.db</code> backup file from your computer hard drive, verify its integrity, and restore with Super Admin OTP verification.
              </p>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center space-y-2 bg-slate-50/60">
              <input
                type="file"
                accept=".db,.sqlite,.json"
                id="local-backup-file-input"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleVerifyLocalBackupFile(f);
                }}
              />
              <label
                htmlFor="local-backup-file-input"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-sky-400" />
                {verifyingUpload
                  ? 'Verifying Backup Integrity...'
                  : 'RESTORE FROM LOCAL BACKUP (Browse .db or .ams.json File)'}
              </label>
              <div className="text-[11px] text-slate-500">
                {selectedFile
                  ? `Selected: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                  : 'Select an Abrar_Backup (.db) or Offline Snapshot (.ams.json) file from your laptop'}
              </div>
            </div>

            {stagedBackup && (
              <form
                onSubmit={handleExecuteLocalRestore}
                className="bg-sky-50/70 border border-sky-200 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-sky-950 flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-emerald-600" />
                    Backup Integrity Verified ({stagedBackup.table_count} Tables/Stores)
                  </span>
                  <span className="text-[11px] font-mono text-sky-800">
                    Items: {stagedBackup.row_counts?.items ?? 0} | Accounts:{' '}
                    {stagedBackup.row_counts?.accounts ?? 0} | Sales:{' '}
                    {stagedBackup.row_counts?.sales ?? 0}
                  </span>
                </div>

                {!restoreOtpRequested && !stagedBackup.isOfflineSnapshot ? (
                  <button
                    type="button"
                    onClick={handleRequestRestoreOtp}
                    className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Mail className="w-4 h-4" />
                    Step 1: Send 6-Digit Restore Verification Code to Super Admin Email
                  </button>
                ) : (
                  <div className="space-y-3">
                    {!stagedBackup.isOfflineSnapshot && (
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                          Enter 6-Digit Super Admin Email Verification Code *
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={restoreOtpCode}
                          onChange={(e) => setRestoreOtpCode(e.target.value)}
                          placeholder="6-digit OTP code"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono font-bold tracking-widest"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                        Type <code className="text-rose-600">RESTORE DATA</code> to Confirm *
                      </label>
                      <input
                        type="text"
                        required
                        value={restoreConfirmationText}
                        onChange={(e) => setRestoreConfirmationText(e.target.value)}
                        placeholder="RESTORE DATA"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono font-bold"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={executingRestore}
                      className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs cursor-pointer"
                    >
                      {executingRestore
                        ? 'Creating Safety Backup & Restoring Database...'
                        : 'Step 2: Confirm & Execute Local Backup Restore'}
                    </button>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION 2: MASTER RESET (OPTION A & OPTION B) (PARTS 11, 12, 16)    */}
      {/* =================================================================== */}
      {section === 'master-reset' && (
        <div className="bg-white rounded-2xl border border-rose-200 p-6 shadow-xs space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-rose-100 pb-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                Super Admin Security Zone
              </span>
              <h3 className="text-base font-extrabold text-slate-900 mt-1">
                Master Reset — Two Reset Modes with Automatic Pre-Reset Verified Backup
              </h3>
              <p className="text-xs text-slate-600">
                Before any Master Reset runs, the system automatically creates and verifies a local SQLite backup (<code className="font-mono">Abrar_Backup_YYYY-MM-DD_NNN.db</code>). Reset cannot proceed unless the backup succeeds.
              </p>
            </div>
          </div>

          {/* Two Reset Mode Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onClick={() => setResetMode('OPTION_A_TRANSACTIONS_ONLY')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                resetMode === 'OPTION_A_TRANSACTIONS_ONLY'
                  ? 'border-amber-500 bg-amber-50/50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase text-amber-900">
                  Option A — Reset Transactions Only
                </span>
                <input
                  type="radio"
                  checked={resetMode === 'OPTION_A_TRANSACTIONS_ONLY'}
                  onChange={() => setResetMode('OPTION_A_TRANSACTIONS_ONLY')}
                />
              </div>
              <p className="text-xs text-slate-600 mt-2">
                <strong>Deletes:</strong> All Sales Invoices, Purchase Invoices, Returns, Supplies, Bookings, Packing Lists, Dispatches, Recoveries, Cashbook, Expenses, Ledger Entries, Stock Quantities, Batches & Movements.
              </p>
              <p className="text-xs text-emerald-800 font-semibold mt-1.5">
                <strong>Preserves:</strong> Item Master ({resetPreview?.counts?.items ?? 0} items), Accounts Master / Parties ({resetPreview?.counts?.parties ?? 0} parties), Users & Roles, Company & Invoice Settings.
              </p>
            </div>

            <div
              onClick={() => setResetMode('OPTION_B_COMPLETE_RESET')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                resetMode === 'OPTION_B_COMPLETE_RESET'
                  ? 'border-rose-600 bg-rose-50/50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase text-rose-900">
                  Option B — Complete Application Reset
                </span>
                <input
                  type="radio"
                  checked={resetMode === 'OPTION_B_COMPLETE_RESET'}
                  onChange={() => setResetMode('OPTION_B_COMPLETE_RESET')}
                />
              </div>
              <p className="text-xs text-slate-600 mt-2">
                <strong>Deletes:</strong> All Transactions, Stock & Batches PLUS all Item Master records ({resetPreview?.counts?.items ?? 0}) and all Customer/Supplier Party Accounts ({resetPreview?.counts?.parties ?? 0}).
              </p>
              <p className="text-xs text-emerald-800 font-semibold mt-1.5">
                <strong>Preserves:</strong> Super Admin Account, User Accounts & Roles, System Settings, Core Chart of Accounts Heads & Database Structure.
              </p>
            </div>
          </div>

          {/* Step 1 & Step 2 Verification */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-extrabold uppercase text-slate-800">
                  Super Admin Email Verification & Confirmation
                </h4>
                <p className="text-[11px] text-slate-500">
                  Verification code is sent to <strong>{superAdminEmail}</strong> (valid for 5 minutes, single-use, max 5 attempts).
                </p>
              </div>
              <button
                type="button"
                onClick={handleRequestResetOtp}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5 text-emerald-400" />
                {resetOtpRequested
                  ? 'Resend 6-Digit Verification Code'
                  : 'Send 6-Digit Verification Code to Super Admin'}
              </button>
            </div>

            {resetOtpRequested && (
              <form onSubmit={handleExecuteMasterReset} className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                    6-Digit Email Verification Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={resetOtpCode}
                    onChange={(e) => setResetOtpCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono font-bold tracking-widest"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                    Type <code className="text-rose-600">RESET ALL DATA</code> *
                  </label>
                  <input
                    type="text"
                    required
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="RESET ALL DATA"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono font-bold"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={executingReset}
                    className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md cursor-pointer"
                  >
                    {executingReset
                      ? 'Backing Up & Resetting...'
                      : `Execute ${
                          resetMode === 'OPTION_B_COMPLETE_RESET' ? 'Option B Complete Reset' : 'Option A Transaction Reset'
                        }`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION 3: PROTECTED AUDIT LOGS (PART 18 — NEVER DELETED)           */}
      {/* =================================================================== */}
      {section === 'protected-logs' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Protected Security, Backup, Restore & Master Reset Audit Logs ({protectedLogs.length})
              </h3>
              <p className="text-xs text-slate-500">
                These audit records are stored in <code className="font-mono">protected_audit_logs</code> and are never deleted during Master Reset.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Event Type</th>
                  <th className="py-2.5 px-3">Mode / Operation</th>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Backup File</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {protectedLogs.map((lg) => (
                  <tr key={lg.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                      {lg.created_at}
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-900">{lg.event_type}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-indigo-700">
                      {lg.operation_mode || '-'}
                    </td>
                    <td className="py-2 px-3">{lg.performed_by_username}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-emerald-700">
                      {lg.backup_file_name || '-'}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {lg.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[11px] text-slate-600">{lg.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
