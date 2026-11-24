import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ChevronRight, Home, Wifi, WifiOff, Clock, ChevronDown,
  Users2, ShieldCheck, LogOut, CheckCircle2, AlertTriangle, Download, Database, SlidersHorizontal, Cloud, HardDrive,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFirebase } from '../../context/FirebaseContext';
import { DatabaseDiagnostics } from '../../types/database';
import { OperatingModeStatus } from '../../types/system';
import { offlineSyncManager, SyncState } from '../../services/offlineSyncManager';
import { APP_VERSION, CLIENT_BUILD_ID } from '../../utils/appVersion';
import { formatAppDate, formatAppDateTime, formatPKTShortTime } from '../../utils/formatters';

interface TopHeaderProps {
  currentViewTitle: string;
  breadcrumbs: string[];
  diagnostics: DatabaseDiagnostics | null;
  operatingModeStatus?: OperatingModeStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigateToUsers?: () => void;
  onNavigateToMoreOptions?: () => void;
  onNavigateToOperatingMode?: () => void;
  onNavigateToAudit: () => void;
  onNavigateToClearDemoData: () => void;
  compact?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentViewTitle, breadcrumbs, operatingModeStatus, loading, onRefresh,
  onNavigateToUsers, onNavigateToMoreOptions, onNavigateToOperatingMode, onNavigateToAudit, onNavigateToClearDemoData, compact = false,
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

  const date = formatAppDate(now);
  const time = formatPKTShortTime(now);

  const activeMode = operatingModeStatus?.mode || syncState.operatingMode || 'ONLINE';
  const isOfflineMode = activeMode === 'OFFLINE';
  const pendingChanges = operatingModeStatus?.pendingLocalChangesCount ?? syncState.pendingCount;
  const unresolvedConflicts = operatingModeStatus?.unresolvedConflictsCount ?? 0;

  const getSyncBadgeInfo = () => {
    if (isOfflineMode) {
      return {
        label: 'OFFLINE MODE • Local DB',
        badgeClass: 'bg-amber-100 text-amber-950 border border-amber-400',
        icon: <HardDrive className="w-3.5 h-3.5 text-amber-700" />,
      };
    }
    if (!syncState.isOnline) {
      return {
        label: 'ONLINE MODE • Network Disconnected',
        badgeClass: 'bg-rose-50 text-rose-800 border border-rose-300',
        icon: <WifiOff className="w-3.5 h-3.5 text-rose-600" />,
      };
    }
    if (unresolvedConflicts > 0) {
      return {
        label: 'ONLINE MODE • Conflicts Pending',
        badgeClass: 'bg-amber-50 text-amber-900 border border-amber-300',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
      };
    }
    return {
      label: 'ONLINE MODE • Cloud DB',
      badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
      icon: <Wifi className="w-3.5 h-3.5 text-emerald-600" />,
    };
  };

  const badgeInfo = getSyncBadgeInfo();
  const formattedLastBackup = operatingModeStatus?.lastSuccessfulBackupAt
    ? formatAppDateTime(operatingModeStatus.lastSuccessfulBackupAt)
    : 'Not run yet';
  const formattedLastSync = operatingModeStatus?.lastSuccessfulCloudSyncAt
    ? formatAppDateTime(operatingModeStatus.lastSuccessfulCloudSyncAt)
    : syncState.lastSyncedAt
    ? formatAppDateTime(syncState.lastSyncedAt)
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

        {/* Operating Mode & Manual Backup/Sync Indicator Popover */}
        <div className="relative" ref={syncRef}>
          <button
            type="button"
            onClick={() => setSyncPopoverOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${badgeInfo.badgeClass}`}
          >
            {badgeInfo.icon}
            <span className="whitespace-nowrap">{badgeInfo.label}</span>
            {pendingChanges > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-600 text-white">
                Pending: {pendingChanges}
              </span>
            )}
            {unresolvedConflicts > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white">
                Conflicts: {unresolvedConflicts}
              </span>
            )}
          </button>

          {syncPopoverOpen && (
            <div className="absolute right-0 top-full mt-2 w-84 bg-white rounded-xl border border-slate-200 shadow-2xl p-4 z-50 text-xs text-slate-700">
              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Operating Mode:</span>
                  <span className={`font-extrabold ${isOfflineMode ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {activeMode} MODE
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Active Database:</span>
                  <span className="font-semibold text-slate-800">
                    {isOfflineMode ? 'Permanent Local SQLite' : 'Cloud Database'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Last Local Backup:</span>
                  <span className="font-semibold text-slate-800">{formattedLastBackup}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Last Cloud Sync:</span>
                  <span className="font-semibold text-slate-800">{formattedLastSync}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-slate-50">
                  <span className="text-slate-500 font-medium">Pending Local Changes:</span>
                  <span className="font-mono font-bold text-slate-900">{pendingChanges}</span>
                </div>
                {unresolvedConflicts > 0 && (
                  <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-rose-50 border border-rose-200">
                    <span className="text-rose-700 font-semibold">Unresolved Conflicts:</span>
                    <span className="font-mono font-bold text-rose-800">{unresolvedConflicts}</span>
                  </div>
                )}
              </div>

              {isSuperAdmin && onNavigateToOperatingMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setSyncPopoverOpen(false);
                    onNavigateToOperatingMode();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Open Super Admin Mode &amp; Backup Panel</span>
                </button>
              ) : (
                <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2 text-center">
                  Manual Control Only — Mode switching &amp; Backup/Sync are controlled by Super Admin.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          onRefresh();
        }}
        title="Refresh View"
        className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer transition-colors"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                v{APP_VERSION} • Build {CLIENT_BUILD_ID}
              </div>
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

