import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ChevronRight, Home, Wifi, WifiOff, Clock, ChevronDown,
  Users2, ShieldCheck, Trash2, LogOut, CheckCircle2, AlertTriangle, CloudUpload, Download, Database, SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { DatabaseDiagnostics } from '../../types/database';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';

interface TopHeaderProps {
  currentViewTitle: string;
  breadcrumbs: string[];
  diagnostics: DatabaseDiagnostics | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigateToUsers?: () => void;
  onNavigateToMoreOptions?: () => void;
  onNavigateToAudit: () => void;
  onNavigateToClearDemoData: () => void;
  compact?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentViewTitle, breadcrumbs, diagnostics, loading, onRefresh,
  onNavigateToUsers, onNavigateToMoreOptions, onNavigateToAudit, onNavigateToClearDemoData, compact = false,
}) => {
  const { user, isSuperAdmin, logout } = useAuth();
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(() => offlineSyncManager.getState());
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [restoringUpdate, setRestoringUpdate] = useState(false);
  const [restoreStatusMsg, setRestoreStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    const unsub = offlineSyncManager.subscribe((state) => {
      setSyncState(state);
    });
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      clearInterval(t);
      unsub();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (syncRef.current && !syncRef.current.contains(e.target as Node)) setSyncPopoverOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    setDeferredInstallPrompt(null);
  };

  const handleRestoreLastUpdate = async () => {
    setRestoringUpdate(true);
    setRestoreStatusMsg(null);
    try {
      const res = await offlineSyncManager.restoreLastUpdate();
      setRestoreStatusMsg({ ok: res.success, text: res.message });
      onRefresh();
    } finally {
      setRestoringUpdate(false);
    }
  };

  const [mainTitle, ...restTitle] = currentViewTitle.split(' — ');
  const subTitle = restTitle.join(' — ');
  const u: any = user;
  const name: string = u?.full_name ?? u?.fullName ?? u?.name ?? u?.username ?? 'User';

  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const effectiveOnline = syncState.firestoreConnected || syncState.isOnline;

  // Determine exact status label & styling per specification
  const getSyncBadgeInfo = () => {
    if (!effectiveOnline || syncState.syncStatus === 'offline') {
      return {
        label: 'OFFLINE – Working Locally',
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-300',
        dotClass: 'bg-amber-500',
        icon: <WifiOff className="w-3.5 h-3.5 text-amber-600" />,
      };
    }
    if (syncState.syncStatus === 'syncing' || syncState.syncingCount > 0) {
      return {
        label: 'SYNCING – Uploading Pending Data',
        badgeClass: 'bg-blue-50 text-blue-800 border border-blue-200',
        dotClass: 'bg-blue-500 animate-ping',
        icon: <CloudUpload className="w-3.5 h-3.5 text-blue-600 animate-bounce" />,
      };
    }
    if (syncState.syncStatus === 'failed' || syncState.failedCount > 0) {
      return {
        label: 'SYNC FAILED – Details Available',
        badgeClass: 'bg-rose-50 text-rose-800 border border-rose-300',
        dotClass: 'bg-rose-500',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,
      };
    }
    if (syncState.justCompletedSync) {
      return {
        label: 'SYNCED – Firestore Verified',
        badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
        dotClass: 'bg-emerald-500',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
      };
    }
    return {
      label: syncState.firestoreConnected ? 'ONLINE – Firestore Connected' : 'ONLINE – Connected',
      badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
      dotClass: 'bg-emerald-500',
      icon: <Wifi className="w-3.5 h-3.5 text-emerald-600" />,
    };
  };

  const badgeInfo = getSyncBadgeInfo();

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={() => { setMenuOpen(false); onClick(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg cursor-pointer transition-colors ${
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <header className={`shrink-0 bg-white border-b border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] print:hidden ${compact ? 'h-12' : 'h-16'} flex items-center gap-3 px-5`}>
      {/* Left: breadcrumbs + title */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
          <Home className="w-3 h-3" />
          {breadcrumbs.map((c, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="w-3 h-3" />
              <span className={i === breadcrumbs.length - 1 ? 'text-emerald-600 font-semibold' : ''}>{c}</span>
            </React.Fragment>
          ))}
        </div>
        {!compact && (
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-[17px] font-bold text-slate-900 truncate">{mainTitle}</h1>
            {subTitle && <span className="hidden xl:block text-xs text-slate-400 truncate">{subTitle}</span>}
          </div>
        )}
      </div>

      {/* Right: Synchronization Status Indicator + Pending Counter + Clock */}
      <div className="flex items-center gap-2">
        {deferredInstallPrompt && (
          <button
            type="button"
            onClick={handleInstallPwa}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer transition-colors"
            title="Install Abrar Medical Store Desktop App for Offline Operation"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
        )}

        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-xs text-slate-600 font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{date}</span>
          <span className="text-slate-300">|</span>
          <span className="font-semibold text-slate-800">{time}</span>
        </div>

        {/* Synchronization Status Indicator & Pending Transactions Popover */}
        <div className="relative" ref={syncRef}>
          <button
            type="button"
            onClick={() => setSyncPopoverOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${badgeInfo.badgeClass}`}
            title="Click to view Offline Storage & Cloud Synchronization details"
          >
            {badgeInfo.icon}
            <span className="whitespace-nowrap">{badgeInfo.label}</span>
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                syncState.pendingCount > 0
                  ? 'bg-amber-600 text-white'
                  : 'bg-white/80 text-slate-700 border border-slate-200'
              }`}
              title="Pending Sync records waiting for Firestore verification"
            >
              Pending: {syncState.pendingCount}
            </span>
            {(syncState.syncStatus === 'syncing' || syncState.syncingCount > 0) && (
              <span
                className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-blue-600 text-white"
                title="Currently syncing to Firestore"
              >
                Syncing: {Math.max(syncState.syncingCount, 1)}
              </span>
            )}
            <span
              className="hidden xl:inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-white/80 text-emerald-700 border border-emerald-200"
              title="Verified Synced records in Firestore"
            >
              Synced: {syncState.syncedCount}
            </span>
            {syncState.failedCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white"
                title="Sync Failed records requiring retry"
              >
                Failed: {syncState.failedCount}
              </span>
            )}
          </button>

          {syncPopoverOpen && (
            <div className="absolute right-0 top-full mt-2 w-[26rem] bg-white rounded-xl border border-slate-200 shadow-2xl p-4 z-50 text-xs text-slate-700">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <span>Firestore & Offline Sync Dashboard</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  effectiveOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {effectiveOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>

              {/* Separate 4-state Sync Counters */}
              <div className="grid grid-cols-4 gap-1.5 mb-3 text-center">
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="text-[10px] font-semibold text-amber-700">Pending Sync</div>
                  <div className="text-sm font-bold font-mono text-amber-900">{syncState.pendingCount}</div>
                </div>
                <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="text-[10px] font-semibold text-blue-700">Syncing</div>
                  <div className="text-sm font-bold font-mono text-blue-900">
                    {syncState.syncStatus === 'syncing' ? Math.max(syncState.syncingCount, 1) : syncState.syncingCount}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="text-[10px] font-semibold text-emerald-700">Synced</div>
                  <div className="text-sm font-bold font-mono text-emerald-900">{syncState.syncedCount}</div>
                </div>
                <div className={`p-2 rounded-lg border ${
                  syncState.failedCount > 0 ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className={`text-[10px] font-semibold ${syncState.failedCount > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
                    Sync Failed
                  </div>
                  <div className={`text-sm font-bold font-mono ${syncState.failedCount > 0 ? 'text-rose-900' : 'text-slate-700'}`}>
                    {syncState.failedCount}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 mb-3">
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Firestore Cloud Status:</span>
                  <span className={`font-semibold ${syncState.firestoreConnected ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {syncState.firestoreConnected
                      ? `ONLINE${syncState.firestoreLatencyMs !== null ? ` (${syncState.firestoreLatencyMs}ms)` : ''}`
                      : 'OFFLINE / Checking'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Items (Synced / Pending / Failed):</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {syncState.itemsStats.synced} / {syncState.itemsStats.pending} / {syncState.itemsStats.failed}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Invoices (Synced / Pending / Failed):</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {syncState.invoicesStats.synced} / {syncState.invoicesStats.pending} / {syncState.invoicesStats.failed}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Counter / Device ID:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {syncState.counterName} ({syncState.deviceId})
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Last Verified Sync:</span>
                  <span className="font-medium text-slate-800">
                    {syncState.lastSyncedAt
                      ? `${new Date(syncState.lastSyncedAt).toLocaleDateString('en-GB')} ${new Date(syncState.lastSyncedAt).toLocaleTimeString()}`
                      : 'Not synced yet'}
                  </span>
                </div>
              </div>

              {syncState.syncProgress && (
                <div className="mb-3 p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="flex justify-between text-[11px] font-bold text-blue-800 mb-1">
                    <span>Synchronizing Pending Records...</span>
                    <span>
                      {syncState.syncProgress.current} / {syncState.syncProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (syncState.syncProgress.current /
                              Math.max(1, syncState.syncProgress.total)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {(syncState.lastError || syncState.diagnosticLogs.length > 0) && (
                <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  <div className="font-bold mb-0.5">
                    Diagnostic Logs ({syncState.diagnosticLogs.length}):
                  </div>
                  {syncState.lastError && <div className="mb-1 break-all">{syncState.lastError}</div>}
                  {syncState.diagnosticLogs.length > 0 && (
                    <div className="mt-1 max-h-28 overflow-y-auto space-y-1 border-t border-rose-200 pt-1">
                      {syncState.diagnosticLogs.slice(0, 6).map((log, idx) => (
                        <div key={log.id ?? idx} className="text-[10px] font-mono break-all">
                          • [{log.entity}/{log.operation}] {log.code}: {log.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {restoreStatusMsg && (
                <div
                  className={`mb-2.5 p-2 rounded-lg border text-[11px] font-medium ${
                    restoreStatusMsg.ok
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {restoreStatusMsg.text}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={syncState.syncStatus === 'syncing' || restoringUpdate}
                  onClick={() => offlineSyncManager.syncNow()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  <span>{syncState.syncStatus === 'syncing' ? 'Synchronizing...' : 'Sync Now'}</span>
                </button>
                <button
                  type="button"
                  disabled={syncState.syncStatus === 'syncing' || restoringUpdate}
                  onClick={handleRestoreLastUpdate}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold cursor-pointer transition-colors"
                  title="Restore latest cloud items & invoices from Firestore"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{restoringUpdate ? 'Restoring...' : 'Restore Last Update'}</span>
                </button>
                {syncState.failedCount > 0 && (
                  <button
                    type="button"
                    disabled={syncState.syncStatus === 'syncing' || restoringUpdate}
                    onClick={() => offlineSyncManager.retryFailed()}
                    className="py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold cursor-pointer transition-colors"
                  >
                    Retry Failed
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          offlineSyncManager.syncNow();
          onRefresh();
        }}
        title="Refresh & Sync"
        className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer transition-colors"
      >
        <RefreshCw className={`w-4 h-4 ${loading || syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
      </button>

      {/* User & System menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer transition-colors"
        >
          <span className="w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-xs uppercase shadow-xs">
            {name.charAt(0)}
          </span>
          <div className="hidden sm:block text-left leading-tight">
            <span className="block text-xs font-bold text-slate-800">{name}</span>
            <span className="block text-[10px] text-slate-400 font-medium">{user?.role || 'Staff'}</span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl border border-slate-200 shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-3 py-2 border-b border-slate-100 mb-1">
              <div className="text-xs font-bold text-slate-900">{name}</div>
              <div className="text-[11px] text-slate-500 font-mono">@{user?.username} • {user?.role}</div>
            </div>

            {isSuperAdmin && onNavigateToUsers && item(<Users2 className="w-4 h-4 text-purple-600" />, 'User Management', onNavigateToUsers)}
            {isSuperAdmin && onNavigateToMoreOptions && item(<SlidersHorizontal className="w-4 h-4 text-emerald-600" />, 'Sales Invoice More Options', onNavigateToMoreOptions)}
            {item(<ShieldCheck className="w-4 h-4 text-slate-600" />, 'System Logs', onNavigateToAudit)}
            {item(<Database className="w-4 h-4 text-slate-600" />, 'Database Status', onNavigateToClearDemoData)}
            
            <div className="my-1 border-t border-slate-100" />
            {item(<LogOut className="w-4 h-4 text-rose-600" />, 'Log Out', () => { logout(); }, true)}
          </div>
        )}
      </div>
    </header>
  );
};

