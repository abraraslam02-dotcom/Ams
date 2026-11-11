import React, { useState, useEffect } from 'react';
import {
  Network,
  Laptop,
  Server,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Database,
  ShieldCheck,
  Edit2,
  Save,
  Wifi,
  WifiOff,
  Activity,
  History,
  Layers,
  FileText,
} from 'lucide-react';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';
import { offlineStorage, OfflineSyncItem } from '../../services/offlineStorage';

interface RegisteredTerminal {
  device_id: string;
  device_name: string;
  counter_name: string;
  terminal_type: string;
  notes: string | null;
  last_sync_at: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  connection_status: 'online' | 'offline';
}

interface SyncLogEntry {
  id: number;
  client_tx_id: string;
  device_id: string;
  device_name?: string;
  counter_name?: string;
  action: string;
  entity: string;
  entity_id: number;
  invoice_number: string;
  status: string;
  payload_json?: string;
  created_at: string;
  synced_at: string;
}

export const LanMultiTerminalView: React.FC = () => {
  const [syncState, setSyncState] = useState<SyncState>(offlineSyncManager.getState());
  const [terminals, setTerminals] = useState<RegisteredTerminal[]>([]);
  const [auditLogs, setAuditLogs] = useState<SyncLogEntry[]>([]);
  const [pendingItems, setPendingItems] = useState<OfflineSyncItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Terminal self-registration state
  const [myCounterName, setMyCounterName] = useState('Counter 1: Main Counter');
  const [myTerminalType, setMyTerminalType] = useState('Counter');
  const [editingSelf, setEditingSelf] = useState(false);

  useEffect(() => {
    const unsubscribe = offlineSyncManager.subscribe((state) => {
      setSyncState(state);
    });

    // Load initial counter name from localStorage or default
    const savedName = localStorage.getItem('ams_lan_counter_name');
    if (savedName) setMyCounterName(savedName);

    fetchTerminalsAndLogs();
    refreshPendingQueue();

    const interval = setInterval(() => {
      fetchTerminalsAndLogs();
      refreshPendingQueue();
    }, 15000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const refreshPendingQueue = async () => {
    try {
      const items = await offlineStorage.getPendingSyncItems();
      setPendingItems(items);
    } catch (e) {
      console.error('Error fetching pending items:', e);
    }
  };

  const fetchTerminalsAndLogs = async () => {
    try {
      const [termRes, logRes] = await Promise.all([
        fetch('/api/sync/terminals'),
        fetch('/api/sync/audit-logs?limit=30'),
      ]);

      if (termRes.ok) {
        const termData = await termRes.json();
        if (termData.success && Array.isArray(termData.terminals)) {
          setTerminals(termData.terminals);
        }
      }

      if (logRes.ok) {
        const logData = await logRes.json();
        if (logData.success && Array.isArray(logData.logs)) {
          setAuditLogs(logData.logs);
        }
      }
    } catch (err) {
      console.error('Error fetching LAN diagnostics:', err);
    }
  };

  const handleSaveTerminalName = async () => {
    try {
      localStorage.setItem('ams_lan_counter_name', myCounterName);
      const res = await fetch('/api/sync/register-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: syncState.deviceId,
          device_name: window.navigator.userAgent.slice(0, 30),
          counter_name: myCounterName,
          terminal_type: myTerminalType,
          notes: `Configured on ${new Date().toLocaleDateString()}`,
        }),
      });

      if (res.ok) {
        setSuccessMessage(`This workstation registered as "${myCounterName}"`);
        setEditingSelf(false);
        fetchTerminalsAndLogs();
      }
    } catch (err: unknown) {
      setError('Failed to update terminal name');
    }
  };

  const handleTriggerSync = async () => {
    setManualSyncing(true);
    setError(null);
    try {
      const ok = await offlineSyncManager.syncNow();
      if (ok) {
        setSuccessMessage('Local transactions pushed to server & database synced successfully.');
        refreshPendingQueue();
        fetchTerminalsAndLogs();
      } else {
        setError(offlineSyncManager.getState().lastError || 'Sync failed. Check LAN/server connection.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync request failed');
    } finally {
      setManualSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner / LAN Header */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              LAN Multi-Terminal & Offline Synchronization
              <span className="text-[11px] font-semibold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full border border-teal-300">
                Multi-Counter Architecture
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              Operate multiple computers simultaneously across your store LAN (Counter 1, Counter 2, Office) with central invoice sequencing and offline recovery.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={manualSyncing}
            className="flex-1 md:flex-initial px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${manualSyncing ? 'animate-spin' : ''}`} />
            {manualSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <button
            type="button"
            onClick={fetchTerminalsAndLogs}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
            title="Refresh Terminals List"
          >
            <Activity className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="font-bold text-rose-700 hover:text-rose-900 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 3 Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Workstation Identity */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
              <Laptop className="w-4 h-4 text-slate-500" />
              This Terminal Identity
            </span>
            <button
              onClick={() => setEditingSelf(!editingSelf)}
              className="text-xs text-teal-600 hover:text-teal-800 font-medium cursor-pointer"
            >
              {editingSelf ? 'Cancel' : 'Edit Name'}
            </button>
          </div>

          {editingSelf ? (
            <div className="space-y-2 pt-1">
              <div>
                <label className="text-[10px] text-slate-500 font-semibold block mb-0.5">Counter / Terminal Name</label>
                <input
                  type="text"
                  value={myCounterName}
                  onChange={(e) => setMyCounterName(e.target.value)}
                  placeholder="e.g. Counter 1: Main Counter"
                  className="w-full text-xs px-2.5 py-1 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={myTerminalType}
                  onChange={(e) => setMyTerminalType(e.target.value)}
                  className="text-xs px-2 py-1 rounded border border-slate-300 bg-white"
                >
                  <option value="Counter">POS Counter</option>
                  <option value="Office">Office / Accounts</option>
                  <option value="Inventory">Warehouse / Stock</option>
                </select>
                <button
                  type="button"
                  onClick={handleSaveTerminalName}
                  className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900">{myCounterName}</div>
              <div className="text-[11px] text-slate-500 font-mono">
                Device ID: <span className="text-slate-700">{syncState.deviceId}</span>
              </div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                Role: {myTerminalType}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: LAN Database & Network State */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
              <Server className="w-4 h-4 text-emerald-600" />
              Shared LAN Database
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                syncState.isOnline
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-rose-100 text-rose-800 border border-rose-300'
              }`}
            >
              {syncState.isOnline ? <Wifi className="w-3 h-3 text-emerald-600" /> : <WifiOff className="w-3 h-3 text-rose-600" />}
              {syncState.isOnline ? 'LAN Online' : 'Offline / Standalone'}
            </span>
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Database Engine:</span>
              <strong className="text-slate-800">Authoritative SQLite (WAL)</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Invoice Sequences:</span>
              <span className="text-emerald-700 font-semibold">Central Transaction Lock</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Cloud SQL Replication:</span>
              <span className="text-slate-700">Automatic Background</span>
            </div>
          </div>
        </div>

        {/* Card 3: Local Offline Queue */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
              <Layers className="w-4 h-4 text-amber-500" />
              Offline Queue Status
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                syncState.pendingCount === 0
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
              }`}
            >
              {syncState.pendingCount === 0 ? 'Queue Empty' : `${syncState.pendingCount} Pending Sync`}
            </span>
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Status:</span>
              <strong className="capitalize text-slate-900">{syncState.syncStatus}</strong>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Last Synced:</span>
              <span className="text-slate-700">
                {syncState.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleTimeString() : 'Never'}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Conflict Guard:</span>
              <span className="text-emerald-700 font-medium">Idempotent UUIDs</span>
            </div>
          </div>
        </div>
      </div>

      {/* LAN Connected Terminals Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Laptop className="w-4 h-4 text-teal-600" />
              Connected Store Counters & Workstations ({terminals.length})
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              All computers connected to the same LAN server access the exact same live inventory stock, sales invoices, and customer balances.
            </p>
          </div>
          <span className="text-[11px] bg-teal-50 text-teal-800 px-2.5 py-1 rounded border border-teal-200 font-semibold">
            Server Port: 3000
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/60 text-slate-600 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4">Counter / Computer Name</th>
                <th className="py-2.5 px-3">Terminal Type</th>
                <th className="py-2.5 px-3">Network IP</th>
                <th className="py-2.5 px-3">Connection Status</th>
                <th className="py-2.5 px-3">Last Heartbeat / Sync</th>
                <th className="py-2.5 px-4 text-right">Device ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {terminals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No terminals registered yet. This machine will register on first sync.
                  </td>
                </tr>
              ) : (
                terminals.map((t) => {
                  const isThisMachine = t.device_id === syncState.deviceId;
                  return (
                    <tr key={t.device_id} className={`hover:bg-slate-50/80 ${isThisMachine ? 'bg-teal-50/30' : ''}`}>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-teal-500" />
                        {t.counter_name || 'Counter Terminal'}
                        {isThisMachine && (
                          <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-bold border border-teal-200">
                            This PC
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold border border-slate-200">
                          {t.terminal_type || 'Counter'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{t.ip_address}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            t.connection_status === 'online'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              t.connection_status === 'online' ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {t.connection_status === 'online' ? 'Connected' : 'Idle / Offline'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                        {new Date(t.last_sync_at).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-[10px] text-slate-400">
                        {t.device_id.slice(0, 16)}...
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* LAN Instructions & Best Practices */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Multi-Computer Setup Guidelines (Zero-Conflict Operation)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <strong className="text-slate-800 block">1. Central LAN Server:</strong>
            <p className="text-[11px]">
              Computer 1 (Main Counter) acts as the local LAN host listening on port 3000.
              Other computers connect via its local IP (e.g. <code>http://192.168.1.100:3000</code>).
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <strong className="text-slate-800 block">2. Central Invoice Sequences:</strong>
            <p className="text-[11px]">
              Invoice numbers (<code>Inv-YYYY-MM-XX</code>) are generated and locked centrally by the server sequence engine. No two counters can ever create the same invoice number.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <strong className="text-slate-800 block">3. Offline Reconnection Safety:</strong>
            <p className="text-[11px]">
              If a counter temporarily disconnects from the LAN, invoices are stored in the local IndexedDB queue and automatically synced without duplicate postings upon reconnection.
            </p>
          </div>
        </div>
      </div>

      {/* Recent Sync Audit Log */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <History className="w-4 h-4 text-slate-600" />
            Central Synchronization Audit Trail (Last 30 Transactions)
          </h2>
          <span className="text-[11px] text-slate-500">Live multi-terminal transaction log</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/60 text-slate-600 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-3">Counter / Device</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Invoice / Ref #</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-4 text-right">Client Transaction ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No transactions synchronized in this session yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 text-slate-600 text-[11px]">
                      {new Date(log.created_at || log.synced_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">
                      {log.counter_name || log.device_name || log.device_id.slice(0, 10)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-mono text-[10px] bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-bold border border-slate-200">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-emerald-700">{log.invoice_number || '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-[10px] text-slate-400">
                      {log.client_tx_id.slice(0, 16)}...
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
