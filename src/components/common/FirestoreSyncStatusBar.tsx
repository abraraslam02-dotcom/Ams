import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';
import { FIRESTORE_DATABASE_ID, FIREBASE_PROJECT_ID } from '../../lib/firebase';

export const RecordSyncBadge: React.FC<{
  syncStatus?: string | null;
  cloudSyncedAt?: string | null;
  syncError?: string | null;
  cloudDocId?: string | null;
}> = ({ syncStatus, cloudSyncedAt, syncError, cloudDocId }) => {
  const s = String(syncStatus || '').toLowerCase();

  if (s === 'syncing') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold whitespace-nowrap"
        title="Uploading & verifying in Firestore..."
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Syncing</span>
      </span>
    );
  }

  if (s === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-300 text-[10px] font-bold whitespace-nowrap cursor-help"
        title={syncError || 'Firestore sync failed. Click Retry Failed or Sync Now.'}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Sync Failed</span>
      </span>
    );
  }

  if (s === 'synced' && cloudSyncedAt) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold whitespace-nowrap"
        title={`Verified in Firestore${cloudDocId ? ` (${cloudDocId})` : ''} at ${new Date(
          cloudSyncedAt
        ).toLocaleString()}`}
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        <span>Synced</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold whitespace-nowrap"
      title={syncError || 'Saved locally in IndexedDB. Waiting for Firestore verification.'}
    >
      <Clock className="w-3 h-3 shrink-0" />
      <span>Pending Sync</span>
    </span>
  );
};

interface FirestoreSyncStatusBarProps {
  entity: 'items' | 'invoices';
  compact?: boolean;
  dark?: boolean;
  onSyncCompleted?: () => void;
}

export const FirestoreSyncStatusBar: React.FC<FirestoreSyncStatusBarProps> = ({
  entity,
  compact = false,
  dark = false,
  onSyncCompleted,
}) => {
  const [syncState, setSyncState] = useState<SyncState>(() => offlineSyncManager.getState());
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    const unsub = offlineSyncManager.subscribe((state) => {
      setSyncState(state);
    });
    const onSyncedEvent = () => {
      onSyncCompleted?.();
    };
    window.addEventListener('ams-data-synchronized', onSyncedEvent);
    return () => {
      unsub();
      window.removeEventListener('ams-data-synchronized', onSyncedEvent);
    };
  }, [onSyncCompleted]);

  const stats = entity === 'items' ? syncState.itemsStats : syncState.invoicesStats;
  const isSyncing = syncState.syncStatus === 'syncing' || stats.syncing > 0;
  const isOnline = syncState.firestoreConnected || syncState.isOnline;
  const entityLogs = syncState.diagnosticLogs.filter(
    (l) => l.entity === entity || l.entity === 'sync' || l.entity === 'connection'
  );

  const handleSyncNow = async () => {
    await offlineSyncManager.syncNow();
    onSyncCompleted?.();
  };

  const handleRetryFailed = async () => {
    await offlineSyncManager.retryFailed();
    onSyncCompleted?.();
  };

  if (compact) {
    return (
      <div className="relative flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-bold border ${
            isOnline
              ? dark
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                : 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : dark
              ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
              : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}
          title={`Firestore: ${syncState.firestoreConnected ? 'ONLINE' : 'OFFLINE'} | DB: ${FIRESTORE_DATABASE_ID}`}
        >
          {isOnline ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
          <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </span>

        <span
          className={`px-1.5 py-0.5 rounded font-mono font-bold ${
            stats.pending > 0
              ? 'bg-amber-500 text-white'
              : dark
              ? 'bg-slate-800 text-amber-300 border border-slate-700'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}
          title="Pending Sync"
        >
          Pending Sync: {stats.pending}
        </span>

        <span
          className={`px-1.5 py-0.5 rounded font-mono font-bold ${
            dark
              ? 'bg-slate-800 text-sky-300 border border-slate-700'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}
          title="Syncing"
        >
          Syncing: {isSyncing ? Math.max(stats.syncing, 1) : stats.syncing}
        </span>

        <span
          className={`px-1.5 py-0.5 rounded font-mono font-bold ${
            dark
              ? 'bg-slate-800 text-emerald-300 border border-slate-700'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
          title="Synced & Verified"
        >
          Synced: {stats.synced}
        </span>

        <span
          className={`px-1.5 py-0.5 rounded font-mono font-bold ${
            stats.failed > 0
              ? 'bg-rose-600 text-white'
              : dark
              ? 'bg-slate-800 text-slate-300 border border-slate-700'
              : 'bg-slate-100 text-slate-600 border border-slate-200'
          }`}
          title="Sync Failed"
        >
          Sync Failed: {stats.failed}
        </span>

        <button
          type="button"
          disabled={isSyncing}
          onClick={handleSyncNow}
          className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
          title="Sync Pending Invoices with Firestore Now"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>Sync Now</span>
        </button>

        {stats.failed > 0 && (
          <button
            type="button"
            disabled={isSyncing}
            onClick={handleRetryFailed}
            className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}

        {(entityLogs.length > 0 || syncState.lastError) && (
          <button
            type="button"
            onClick={() => setShowDiagnostics((v) => !v)}
            className={`px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5 cursor-pointer ${
              dark
                ? 'bg-slate-800 text-rose-300 border border-rose-500/40'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
            title="View Sync Error Diagnostics"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Logs ({entityLogs.length})</span>
          </button>
        )}

        {showDiagnostics && (
          <div className="absolute right-0 top-full mt-1.5 w-[28rem] max-w-[90vw] bg-white text-slate-800 rounded-xl border border-slate-300 shadow-2xl p-3 z-50 text-xs">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 font-bold text-slate-900">
              <span>Firestore Sync Diagnostics ({FIREBASE_PROJECT_ID})</span>
              <button
                type="button"
                onClick={() => setShowDiagnostics(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>
            {syncState.lastError && (
              <div className="mb-2 p-2 rounded bg-rose-50 border border-rose-200 text-rose-800 font-mono text-[11px]">
                {syncState.lastError}
              </div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {entityLogs.length === 0 ? (
                <div className="text-slate-500 italic">No sync errors logged.</div>
              ) : (
                entityLogs.slice(0, 15).map((log, idx) => (
                  <div
                    key={log.id ?? idx}
                    className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-[10px] space-y-0.5"
                  >
                    <div className="flex justify-between font-bold text-rose-700">
                      <span>
                        [{log.entity.toUpperCase()}] {log.code}
                      </span>
                      <span className="text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-800 break-all">{log.message}</div>
                    {log.details && <div className="text-slate-500">{log.details}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3 print:hidden space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Connection Status */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
              isOnline
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-amber-50 text-amber-800 border-amber-300'
            }`}
          >
            {isOnline ? (
              <Cloud className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <CloudOff className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>
              Database Status:{' '}
              <strong>{isOnline ? 'ONLINE (Firestore Connected)' : 'OFFLINE (Local Mode)'}</strong>
            </span>
          </div>

          {syncState.lastFirestoreCheckedAt && (
            <span className="text-[11px] text-slate-500 font-mono">
              {syncState.firestoreLatencyMs !== null ? `${syncState.firestoreLatencyMs}ms • ` : ''}
              DB: {FIRESTORE_DATABASE_ID.slice(0, 28)}...
            </span>
          )}
        </div>

        {/* Separate Sync Status Counters + Sync Now */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Pending Sync:</span>
            <strong className="font-mono">{stats.pending}</strong>
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
            <Loader2
              className={`w-3.5 h-3.5 text-blue-600 ${
                isSyncing ? 'animate-spin' : ''
              }`}
            />
            <span>Syncing:</span>
            <strong className="font-mono">
              {isSyncing ? Math.max(stats.syncing, 1) : stats.syncing}
            </strong>
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Synced:</span>
            <strong className="font-mono">{stats.synced}</strong>
          </span>

          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-semibold ${
              stats.failed > 0
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            <AlertTriangle
              className={`w-3.5 h-3.5 ${stats.failed > 0 ? 'text-rose-600' : 'text-slate-400'}`}
            />
            <span>Sync Failed:</span>
            <strong className="font-mono">{stats.failed}</strong>
          </span>

          {stats.failed > 0 && (
            <button
              type="button"
              disabled={isSyncing}
              onClick={handleRetryFailed}
              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Failed</span>
            </button>
          )}

          <button
            type="button"
            disabled={isSyncing}
            onClick={handleSyncNow}
            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>

          {(entityLogs.length > 0 || syncState.lastError) && (
            <button
              type="button"
              onClick={() => setShowDiagnostics((v) => !v)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Diagnostics ({entityLogs.length})</span>
              {showDiagnostics ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {showDiagnostics && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
          <div className="flex items-center justify-between font-bold text-slate-800">
            <span>
              Firestore Synchronization Diagnostic Logs (Project: {FIREBASE_PROJECT_ID} • DB:{' '}
              {FIRESTORE_DATABASE_ID})
            </span>
            <span className="text-[11px] font-normal text-slate-500">
              Last Sync:{' '}
              {syncState.lastSyncedAt
                ? new Date(syncState.lastSyncedAt).toLocaleString()
                : 'Never'}
            </span>
          </div>
          {syncState.lastError && (
            <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-800 font-mono text-[11px]">
              Last Error: {syncState.lastError}
            </div>
          )}
          {entityLogs.length === 0 ? (
            <div className="text-slate-500 italic">No diagnostic errors recorded.</div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1.5">
              {entityLogs.slice(0, 12).map((log, idx) => (
                <div
                  key={log.id ?? idx}
                  className="p-2 rounded bg-white border border-slate-200 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between text-rose-700 font-bold">
                    <span>
                      [{log.entity}] {log.operation} ({log.code})
                    </span>
                    <span className="text-slate-400 font-normal">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-800 mt-0.5 break-all">{log.message}</div>
                  {log.details && <div className="text-slate-500 text-[10px]">{log.details}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
