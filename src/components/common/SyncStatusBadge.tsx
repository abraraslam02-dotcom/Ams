import React, { useState, useEffect } from 'react';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Layers,
  X,
  Smartphone,
  Laptop,
} from 'lucide-react';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';
import { offlineStorage, OfflineSyncItem } from '../../services/offlineStorage';

export const SyncStatusBadge: React.FC = () => {
  const [syncState, setSyncState] = useState<SyncState>(offlineSyncManager.getState());
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [pendingItems, setPendingItems] = useState<OfflineSyncItem[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = offlineSyncManager.subscribe((state) => {
      setSyncState(state);
    });
    return () => unsubscribe();
  }, []);

  const fetchTerminals = async () => {
    try {
      const res = await fetch('/api/sync/terminals');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.terminals)) {
          setTerminals(data.terminals);
        }
      }
    } catch {
      // ignore offline
    }
  };

  const handleOpenModal = async () => {
    try {
      const items = await offlineStorage.getPendingSyncItems();
      setPendingItems(items);
    } catch {
      setPendingItems([]);
    }
    fetchTerminals();
    setModalOpen(true);
  };

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    await offlineSyncManager.syncNow();
    try {
      const items = await offlineStorage.getPendingSyncItems();
      setPendingItems(items);
    } catch {}
    fetchTerminals();
    setIsManualSyncing(false);
  };

  const handleTerminalSelect = async (
    counterName: string,
    terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts'
  ) => {
    await offlineSyncManager.setTerminalDesignation(counterName, terminalType);
    fetchTerminals();
  };

  const renderBadgeContent = () => {
    if (!syncState.isOnline || syncState.syncStatus === 'offline') {
      return (
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors cursor-pointer shadow-2xs"
          title="Working Offline. Local data is safely saved in IndexedDB."
        >
          <CloudOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
          <span>Offline Mode</span>
          {syncState.pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
              {syncState.pendingCount} Pending
            </span>
          )}
        </button>
      );
    }

    if (syncState.syncStatus === 'syncing' || isManualSyncing) {
      return (
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300 hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs"
          title="Synchronizing local transactions with central database..."
        >
          <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          <span>Syncing...</span>
        </button>
      );
    }

    if (syncState.syncStatus === 'failed') {
      return (
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100 transition-colors cursor-pointer shadow-2xs"
          title="Sync encountered an error. Click to view and retry."
        >
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>Sync Failed</span>
          {syncState.pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-600 text-white">
              {syncState.pendingCount}
            </span>
          )}
        </button>
      );
    }

    if (syncState.pendingCount > 0) {
      return (
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-300 hover:bg-sky-100 transition-colors cursor-pointer shadow-2xs"
          title={`${syncState.pendingCount} pending local transactions queued for sync.`}
        >
          <Cloud className="w-3.5 h-3.5 text-sky-600" />
          <span>Pending Sync ({syncState.pendingCount})</span>
        </button>
      );
    }

    return (
      <button
        onClick={handleOpenModal}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer shadow-2xs"
        title={`100% Synced • ${syncState.counterName}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span className="hidden sm:inline">Synced</span>
      </button>
    );
  };

  return (
    <>
      {renderBadgeContent()}

      {/* Sync Status & Multi-Computer LAN Queue Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <Server className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Multi-Computer LAN & Offline Synchronization
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Station: {syncState.counterName} ({syncState.deviceId})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-200/60 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Multi-Computer Counter Selector */}
              <div className="p-3.5 rounded-xl bg-slate-900 text-white space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                    Assign This Computer's LAN Counter Role
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Shared LAN SQLite WAL Server
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label: 'Computer 1: Main Counter',
                      type: 'Main Counter' as const,
                    },
                    {
                      label: 'Computer 2: Second Counter',
                      type: 'Second Counter' as const,
                    },
                    {
                      label: 'Computer 3: Office / Accounts',
                      type: 'Office / Accounts' as const,
                    },
                  ].map((station) => {
                    const active = syncState.counterName === station.label;
                    return (
                      <button
                        key={station.label}
                        type="button"
                        onClick={() => handleTerminalSelect(station.label, station.type)}
                        className={`px-2.5 py-2 rounded-lg text-left text-[11px] font-bold border transition-all cursor-pointer ${
                          active
                            ? 'bg-emerald-600 border-emerald-400 text-white shadow-sm'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <div className="truncate">{station.type}</div>
                        <div className="text-[9px] font-normal opacity-80 truncate">
                          {station.label.split(':')[0]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Device & Connection Overview */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    LAN / Cloud Status
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        syncState.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-800">
                      {syncState.isOnline ? 'Synced / Connected' : 'Offline Queue Active'}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Local Offline Engine
                  </span>
                  <div className="flex items-center gap-1.5 mt-1 text-slate-800 text-xs font-bold">
                    <Laptop className="w-3.5 h-3.5 text-emerald-600" />
                    <span>IndexedDB + SQLite WAL</span>
                  </div>
                </div>
              </div>

              {/* Status Banner */}
              <div
                className={`p-3 rounded-xl text-xs font-medium border flex items-start gap-2.5 ${
                  !syncState.isOnline
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : syncState.pendingCount > 0
                    ? 'bg-blue-50 border-blue-200 text-blue-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                {!syncState.isOnline ? (
                  <CloudOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                ) : syncState.pendingCount > 0 ? (
                  <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {!syncState.isOnline
                      ? 'Offline Mode Active — Zero Data Loss Guaranteed'
                      : syncState.pendingCount > 0
                      ? `Pending Sync (${syncState.pendingCount} Offline Transactions)`
                      : 'Synced — All Local & Multi-Computer Transactions Up to Date'}
                  </div>
                  <div className="text-[11px] opacity-90 mt-0.5">
                    {!syncState.isOnline
                      ? 'Sales, Purchases, Held Invoices, Inventory, and Ledgers continue working offline. Pending transactions automatically synchronize on reconnection.'
                      : syncState.pendingCount > 0
                      ? 'Automatic background sync is uploading pending local invoices to the central database.'
                      : `Last synchronized: ${
                          syncState.lastSyncedAt
                            ? new Date(syncState.lastSyncedAt).toLocaleTimeString()
                            : 'Just now'
                        }`}
                  </div>
                </div>
              </div>

              {/* Connected LAN Computers / Counters */}
              {terminals.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5">
                    Registered LAN Computers ({terminals.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {terminals.map((t: any) => (
                      <div
                        key={t.device_id}
                        className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="font-bold text-slate-800">{t.counter_name}</span>
                          <span className="text-[10px] font-mono text-slate-500">
                            ({t.device_id})
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {t.ip_address || 'LAN'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending Queue List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Local Pending Sync Queue ({pendingItems.length})
                  </h4>
                </div>

                {pendingItems.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    No pending offline transactions. Everything is synchronized!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {pendingItems.map((item) => (
                      <div
                        key={item.client_tx_id}
                        className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-800">{item.action}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            UUID: {item.client_tx_id.substring(0, 18)}... |{' '}
                            {new Date(item.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === 'failed'
                              ? 'bg-rose-100 text-rose-800'
                              : item.status === 'syncing'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-mono">
                {syncState.counterName}
              </span>
              <button
                onClick={handleManualSync}
                disabled={!syncState.isOnline || isManualSyncing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
                <span>{isManualSyncing ? 'Syncing...' : 'Retry / Sync Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
