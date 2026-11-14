import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ChevronRight, Home, Wifi, WifiOff, Clock, ChevronDown,
  Users2, ShieldCheck, Trash2, LogOut, CheckCircle2, AlertTriangle, CloudUpload, Download, Database, SlidersHorizontal, Cloud,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFirebase } from '../../context/FirebaseContext';
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
  const { firebaseUser, firestoreStatus, signInWithGoogle, signOutFirebase } = useFirebase();
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(() => offlineSyncManager.getState());
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

  const getSyncBadgeInfo = () => {
    if (!syncState.isOnline || syncState.syncStatus === 'offline') {
      return {
        label: syncState.statusMessage,
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-300',
        icon: <WifiOff className="w-3.5 h-3.5 text-amber-600" />,
      };
    }
    if (syncState.syncStatus === 'syncing') {
      return {
        label: syncState.statusMessage,
        badgeClass: 'bg-blue-50 text-blue-800 border border-blue-200',
        icon: <CloudUpload className="w-3.5 h-3.5 text-blue-600" />,
      };
    }
    if (syncState.syncStatus === 'failed' || syncState.failedCount > 0) {
      return {
        label: syncState.statusMessage,
        badgeClass: 'bg-rose-50 text-rose-800 border border-rose-300',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,
      };
    }
    if (syncState.justCompletedSync) {
      return {
        label: syncState.statusMessage,
        badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
      };
    }
    return {
      label: syncState.statusMessage,
      badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
      icon: <Wifi className="w-3.5 h-3.5 text-emerald-600" />,
    };
  };

  const badgeInfo = getSyncBadgeInfo();
  const formattedLastSync = syncState.lastSyncedAt
    ? `${new Date(syncState.lastSyncedAt).toLocaleDateString('en-GB')} ${new Date(
        syncState.lastSyncedAt
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not synced yet';

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

      {/* Right: Synchronization Status Indicator & Clock */}
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

        {/* Simple Sync Status Indicator & Popover */}
        <div className="relative" ref={syncRef}>
          <button
            type="button"
            onClick={() => setSyncPopoverOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${badgeInfo.badgeClass}`}
          >
            {badgeInfo.icon}
            <span className="whitespace-nowrap">{badgeInfo.label}</span>
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold ${
                syncState.pendingCount > 0
                  ? 'bg-amber-600 text-white'
                  : 'bg-white/80 text-slate-700 border border-slate-200'
              }`}
            >
              Pending: {syncState.pendingCount}
            </span>
            {syncState.failedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white">
                Failed: {syncState.failedCount}
              </span>
            )}
          </button>

          {syncPopoverOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-2xl p-4 z-50 text-xs text-slate-700">
              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Connection Status:</span>
                  <span className={`font-bold ${syncState.isOnline ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {syncState.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Status:</span>
                  <span className="font-semibold text-slate-800">{syncState.statusMessage}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Last Successful Sync:</span>
                  <span className="font-semibold text-slate-800">{formattedLastSync}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Pending Records:</span>
                  <span className="font-mono font-bold text-slate-900">{syncState.pendingCount}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Failed Records:</span>
                  <span className={`font-mono font-bold ${syncState.failedCount > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                    {syncState.failedCount}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={syncState.syncStatus === 'syncing' || !syncState.isOnline}
                onClick={() => offlineSyncManager.syncNow()}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>SYNC NOW</span>
              </button>
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
            {item(
              <Cloud className={`w-4 h-4 ${firestoreStatus === 'connected' ? 'text-indigo-600' : 'text-slate-400'}`} />,
              firebaseUser ? `Google: ${firebaseUser.email?.split('@')[0]} (Sign Out)` : 'Connect Google Cloud',
              () => {
                if (firebaseUser) {
                  void signOutFirebase();
                } else {
                  void signInWithGoogle().catch(() => {});
                }
              }
            )}

            <div className="my-1 border-t border-slate-100" />
            {item(<LogOut className="w-4 h-4 text-rose-600" />, 'Log Out', () => { logout(); }, true)}
          </div>
        )}
      </div>
    </header>
  );
};

