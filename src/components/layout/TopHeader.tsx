import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ChevronRight, Home, Wifi, WifiOff, Clock, ChevronDown,
  Users2, ShieldCheck, Trash2, LogOut, CheckCircle2, AlertTriangle, CloudUpload, Download, Database,
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
  onNavigateToAudit: () => void;
  onNavigateToClearDemoData: () => void;
  compact?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentViewTitle, breadcrumbs, diagnostics, loading, onRefresh,
  onNavigateToAudit, onNavigateToClearDemoData, compact = false,
}) => {
  const { user, isSuperAdmin, logout } = useAuth();
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncStatus: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced',
    pendingCount: 0,
    lastSyncedAt: null,
    deviceId: 'POS-LOCAL',
    counterName: 'Computer 1: Main Counter',
    terminalType: 'Main Counter',
    lastError: null,
    justCompletedSync: false,
  });
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);

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

  const [mainTitle, ...restTitle] = currentViewTitle.split(' — ');
  const subTitle = restTitle.join(' — ');
  const u: any = user;
  const name: string = u?.full_name ?? u?.fullName ?? u?.name ?? u?.username ?? 'User';

  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Determine exact status label & styling per specification
  const getSyncBadgeInfo = () => {
    if (!syncState.isOnline || syncState.syncStatus === 'offline') {
      return {
        label: 'OFFLINE – Working Locally',
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-300',
        dotClass: 'bg-amber-500',
        icon: <WifiOff className="w-3.5 h-3.5 text-amber-600" />,
      };
    }
    if (syncState.syncStatus === 'syncing') {
      return {
        label: 'SYNCING – Uploading Pending Data',
        badgeClass: 'bg-blue-50 text-blue-800 border border-blue-200',
        dotClass: 'bg-blue-500 animate-ping',
        icon: <CloudUpload className="w-3.5 h-3.5 text-blue-600 animate-bounce" />,
      };
    }
    if (syncState.syncStatus === 'failed') {
      return {
        label: 'SYNC ERROR – Details Available',
        badgeClass: 'bg-rose-50 text-rose-800 border border-rose-300',
        dotClass: 'bg-rose-500',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,
      };
    }
    if (syncState.justCompletedSync) {
      return {
        label: 'SYNC COMPLETE – All Data Synchronized',
        badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
        dotClass: 'bg-emerald-500',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
      };
    }
    return {
      label: 'ONLINE – Connected',
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
              title="Number of pending transactions waiting to synchronize"
            >
              Pending: {syncState.pendingCount}
            </span>
          </button>

          {syncPopoverOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-2xl p-4 z-50 text-xs text-slate-700">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <span>Offline-First Sync Engine</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  syncState.isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {syncState.isOnline ? 'Online' : 'Offline Mode'}
                </span>
              </div>

              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Current Status:</span>
                  <span className="font-semibold text-slate-900">{badgeInfo.label}</span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Pending Transactions:</span>
                  <span className={`font-bold ${syncState.pendingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {syncState.pendingCount} queued
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500">Local SQLite + IndexedDB:</span>
                  <span className="font-semibold text-emerald-700">Active & Protected</span>
                </div>
                {syncState.lastSyncedAt && (
                  <div className="flex justify-between items-center py-1 px-2.5 rounded-lg bg-slate-50">
                    <span className="text-slate-500">Last Synchronized:</span>
                    <span className="font-medium text-slate-800">
                      {new Date(syncState.lastSyncedAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>

              {syncState.lastError && (
                <div className="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  <div className="font-bold mb-0.5">Sync Issue Details:</div>
                  <div>{syncState.lastError}</div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={!syncState.isOnline || syncState.syncStatus === 'syncing'}
                  onClick={() => offlineSyncManager.syncNow()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  <span>{syncState.syncStatus === 'syncing' ? 'Synchronizing...' : 'Sync Now'}</span>
                </button>
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

      {/* System menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>System</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-xl p-1.5 z-50">
            {item(<ShieldCheck className="w-4 h-4" />, 'System logs', onNavigateToAudit)}
            {item(<Trash2 className="w-4 h-4" />, 'System diagnostics', onNavigateToClearDemoData)}
          </div>
        )}
      </div>
    </header>
  );
};

