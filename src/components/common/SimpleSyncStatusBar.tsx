import React, { useEffect, useState } from 'react';
import { RefreshCw, Wifi, WifiOff, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';

interface SimpleSyncStatusBarProps {
  compact?: boolean;
  dark?: boolean;
  onSyncCompleted?: () => void;
}

export const SimpleSyncStatusBar: React.FC<SimpleSyncStatusBarProps> = ({
  compact = false,
  dark = false,
  onSyncCompleted,
}) => {
  const [syncState, setSyncState] = useState<SyncState>(() => offlineSyncManager.getState());

  useEffect(() => {
    const unsub = offlineSyncManager.subscribe(setSyncState);
    const onSynced = () => {
      onSyncCompleted?.();
    };
    window.addEventListener('ams-data-synchronized', onSynced);
    return () => {
      unsub();
      window.removeEventListener('ams-data-synchronized', onSynced);
    };
  }, [onSyncCompleted]);

  const handleSyncNow = async () => {
    const ok = await offlineSyncManager.syncNow();
    if (ok) {
      onSyncCompleted?.();
    }
  };

  const formattedLastSync = syncState.lastSyncedAt
    ? `${new Date(syncState.lastSyncedAt).toLocaleDateString('en-GB')} ${new Date(
        syncState.lastSyncedAt
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not synced yet';

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs ${
          dark
            ? 'bg-slate-800 border-slate-700 text-slate-200'
            : 'bg-white border-slate-200 text-slate-700'
        }`}
      >
        <span
          className={`flex items-center gap-1 font-semibold ${
            syncState.isOnline
              ? dark
                ? 'text-emerald-400'
                : 'text-emerald-700'
              : dark
              ? 'text-amber-400'
              : 'text-amber-700'
          }`}
        >
          {syncState.isOnline ? (
            <Wifi className="w-3.5 h-3.5" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          <span>{syncState.isOnline ? 'Online' : 'Offline'}</span>
        </span>

        <span className={dark ? 'text-slate-400' : 'text-slate-500'}>
          Pending: <strong className={dark ? 'text-white' : 'text-slate-900'}>{syncState.pendingCount}</strong>
        </span>

        {syncState.failedCount > 0 && (
          <span className={dark ? 'text-rose-400' : 'text-rose-700'}>
            Failed: <strong>{syncState.failedCount}</strong>
          </span>
        )}

        <button
          type="button"
          disabled={syncState.syncStatus === 'syncing' || !syncState.isOnline}
          onClick={handleSyncNow}
          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw
            className={`w-3 h-3 ${syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`}
          />
          <span>SYNC NOW</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          {syncState.isOnline ? (
            <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
              <Wifi className="w-4 h-4 text-emerald-600" />
              <span>Online</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-bold text-amber-700">
              <WifiOff className="w-4 h-4 text-amber-600" />
              <span>Offline</span>
            </span>
          )}
          <span className="text-slate-300">|</span>
          <span
            className={`font-semibold ${
              syncState.syncStatus === 'failed'
                ? 'text-rose-700'
                : syncState.syncStatus === 'offline'
                ? 'text-amber-700'
                : 'text-slate-700'
            }`}
          >
            {syncState.statusMessage}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-slate-600">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>Last Sync:</span>
          <strong className="text-slate-800">{formattedLastSync}</strong>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-600">
            Pending: <strong className="font-mono text-slate-900">{syncState.pendingCount}</strong>
          </span>
          <span className={syncState.failedCount > 0 ? 'text-rose-700' : 'text-slate-600'}>
            Failed: <strong className="font-mono">{syncState.failedCount}</strong>
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={syncState.syncStatus === 'syncing' || !syncState.isOnline}
        onClick={handleSyncNow}
        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`}
        />
        <span>SYNC NOW</span>
      </button>
    </div>
  );
};

interface RecordSyncBadgeProps {
  syncStatus?: string;
}

export const RecordSyncBadge: React.FC<RecordSyncBadgeProps> = ({ syncStatus }) => {
  const status = String(syncStatus || 'synced').toLowerCase();
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
        <AlertTriangle className="w-3 h-3" />
        <span>Failed</span>
      </span>
    );
  }
  if (status === 'pending' || status === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
        <Clock className="w-3 h-3" />
        <span>Pending</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
      <CheckCircle2 className="w-3 h-3" />
      <span>Synced</span>
    </span>
  );
};
