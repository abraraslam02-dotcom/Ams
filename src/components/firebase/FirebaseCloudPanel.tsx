import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  FileText,
  HardDrive,
  History,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useFirebase } from '../../context/FirebaseContext';

type ManualSyncOptionTab =
  | 'upload_restore'
  | 'last_sync'
  | 'sync_status'
  | 'sync_errors';

export interface FirebaseCloudPanelProps {
  totalLiveRecords?: number;
}

export const FirebaseCloudPanel: React.FC<FirebaseCloudPanelProps> = () => {
  const {
    firebaseUser,
    isAuthReady,
    isSigningIn,
    connectionStatus,
    connectionMessage,
    lastFirestoreError,
    projectId,
    firestoreDatabaseId,
    activeStoreId,
    syncNotes,
    localSyncStatus,
    syncProgress,
    lastActionNotice,
    clearLastFirestoreError,
    clearActionNotice,
    signInWithGoogle,
    signOutFirebase,
    recheckConnection,
    refreshLocalSyncStatus,
    uploadLocalBusinessDataToFirebase,
    restoreBusinessDataFromFirebase,
    clearSyncErrors,
  } = useFirebase();

  const [activeTab, setActiveTab] = useState<ManualSyncOptionTab>('upload_restore');
  const [showRestoreConfirmModal, setShowRestoreConfirmModal] = useState(false);

  useEffect(() => {
    void refreshLocalSyncStatus();
  }, [refreshLocalSyncStatus]);

  const summary = localSyncStatus?.businessDataSummary;
  const syncErrors = localSyncStatus?.syncErrors || [];
  const syncHistory = localSyncStatus?.syncHistory || [];

  const handleConfirmRestore = async () => {
    setShowRestoreConfirmModal(false);
    await restoreBusinessDataFromFirebase();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Top Architecture Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold tracking-wide uppercase">
                100% Offline-First Primary SQLite + Manual Firebase Sync
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                <CheckCircle2 className="w-3 h-3" /> Local SQLite Primary Active
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-400/30">
                Manual Sync Only — Zero Auto Background Sync
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              All Sales, Purchases, Inventory, Accounts &amp; Ledgers save directly to Local SQLite (
              <span className="font-mono text-emerald-300">
                {localSyncStatus?.dDriveDatabasePath || 'D:\\AbrarMedicalStore\\Database\\ams_medical.db'}
              </span>
              ). Firebase is used strictly when you click a Manual Sync button below.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refreshLocalSyncStatus();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Local Status
          </button>

          {isAuthReady && firebaseUser ? (
            <button
              type="button"
              onClick={() => void signOutFirebase()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border border-rose-400/30 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out ({firebaseUser.email})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={isSigningIn}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-400 text-white shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              {isSigningIn ? 'Signing in...' : 'Sign In to Firebase for Manual Sync'}
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Live Manual Sync Progress Bar */}
        {syncProgress.active && (
          <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50/90 p-4 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between text-xs font-bold text-indigo-950">
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin" />
                {syncProgress.operation === 'upload'
                  ? 'Uploading Local Business Data to Firebase...'
                  : 'Restoring Business Data from Firebase into Local SQLite...'}
              </span>
              <span className="font-mono text-indigo-700">{syncProgress.percent}%</span>
            </div>
            <div className="w-full h-2.5 bg-indigo-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-200"
                style={{ width: `${Math.max(5, Math.min(100, syncProgress.percent))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-indigo-800">
              <span>{syncProgress.message}</span>
              {syncProgress.totalSteps > 0 && (
                <span className="font-mono font-semibold">
                  Step {syncProgress.currentStep} / {syncProgress.totalSteps}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Action Notice Banner */}
        {lastActionNotice && (
          <div
            className={`rounded-xl border p-3.5 flex items-start justify-between gap-3 ${
              lastActionNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : lastActionNotice.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <div className="flex items-start gap-2.5 text-xs">
              {lastActionNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : lastActionNotice.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <Cloud className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-bold">
                  {lastActionNotice.type === 'success'
                    ? 'Manual Firebase Synchronization Complete'
                    : lastActionNotice.type === 'error'
                    ? 'Manual Synchronization Notice'
                    : 'Firebase Manual Sync Info'}
                </p>
                <p className="mt-0.5 leading-relaxed">{lastActionNotice.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearActionNotice}
              className="text-xs font-semibold underline opacity-75 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 5-Option Manual Sync Navigation Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('upload_restore')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeTab === 'upload_restore'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <CloudUpload className="w-4 h-4" />
            <span>1 &amp; 2. Upload / Restore Data</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('last_sync')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeTab === 'last_sync'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>3. View Last Successful Sync</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sync_status')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeTab === 'sync_status'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>4. View Sync Status &amp; Ledgers</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sync_errors')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              activeTab === 'sync_errors'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>
              5. View Sync Errors ({syncErrors.length + (lastFirestoreError ? 1 : 0)})
            </span>
          </button>
        </div>

        {/* TAB 1 & 2: UPLOAD LOCAL DATA TO FIREBASE / RESTORE DATA FROM FIREBASE */}
        {activeTab === 'upload_restore' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OPTION 1: UPLOAD LOCAL DATA TO FIREBASE */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-100 text-indigo-800">
                      <CloudUpload className="w-3.5 h-3.5" />
                      Option 1: Manual Upload
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Pending Local Changes:{' '}
                      <strong className="text-slate-900">
                        {localSyncStatus?.pendingLocalChangesCount ?? 0}
                      </strong>
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Upload Local Data to Firebase
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Manually uploads your Local SQLite business transactions (Sales, Purchases,
                    Returns, Chart of Accounts, Customer &amp; Supplier Ledgers, Cash/Bank Vouchers,
                    and Items/Inventory Batches) to Firebase Firestore. Never runs automatically in
                    the background.
                  </p>
                </div>

                <div className="space-y-2">
                  {!firebaseUser ? (
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      disabled={isSigningIn}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      Sign In with Google to Upload Local Data
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void uploadLocalBusinessDataToFirebase()}
                      disabled={syncProgress.active}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <CloudUpload className="w-4 h-4" />
                      {syncProgress.active && syncProgress.operation === 'upload'
                        ? 'Uploading Business Data...'
                        : `Upload Local Data to Firebase (${summary?.totalBusinessRecords ?? 0} Business Records)`}
                    </button>
                  )}
                </div>
              </div>

              {/* OPTION 2: RESTORE DATA FROM FIREBASE */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800">
                      <CloudDownload className="w-3.5 h-3.5" />
                      Option 2: Manual Restore
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">
                      Auto Pre-Restore Local Backup Included
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Restore Data from Firebase
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Downloads your synchronized business transactions from Firebase and merges them
                    into Local SQLite inside an atomic transaction. Automatically creates a local
                    SQLite safety backup first, prevents duplicate invoices, and never overwrites
                    newer local records.
                  </p>
                </div>

                <div>
                  {!firebaseUser ? (
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      disabled={isSigningIn}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white shadow-sm transition-colors cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      Sign In with Google to Restore Data
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRestoreConfirmModal(true)}
                      disabled={syncProgress.active}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <CloudDownload className="w-4 h-4" />
                      {syncProgress.active && syncProgress.operation === 'restore'
                        ? 'Restoring Business Data...'
                        : 'Restore Data from Firebase'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Summary of Business Transactions Ready in Local SQLite */}
            {summary && (
              <div className="rounded-xl border border-slate-200 p-4 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Local SQLite Business Transactions Included in Manual Sync
                  </h5>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                      summary.ledgerBalanced
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    General Ledger Dr/Cr:{' '}
                    {summary.ledgerBalanced ? '100% Balanced' : 'Reconciliation Needed'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Sales &amp; Items</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.salesCount} Invoices ({summary.saleItemsCount} lines)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Purchases &amp; Items</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.purchasesCount} Bills ({summary.purchaseItemsCount} lines)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Chart of Accounts</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.accountsCount} Accounts ({summary.customersCount} Cust /{' '}
                      {summary.suppliersCount} Supp)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Journal &amp; Ledgers</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.journalEntriesCount} Entries ({summary.journalLinesCount} lines)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Vouchers &amp; Cashbook</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.cashBookVouchersCount +
                        summary.accountingVouchersCount +
                        summary.paymentVouchersCount}{' '}
                      Vouchers
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 text-[11px]">Items &amp; Inventory</div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {summary.itemsCount} Items / {summary.inventoryBatchesCount} Batches
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: VIEW LAST SUCCESSFUL SYNC */}
        {activeTab === 'last_sync' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  Last Successful Manual Firebase Sync
                </h4>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    localSyncStatus?.lastSuccessfulSyncAt
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {localSyncStatus?.lastSuccessfulSyncAt
                    ? new Date(localSyncStatus.lastSuccessfulSyncAt).toLocaleString()
                    : 'No Manual Sync Run Yet'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-white border border-slate-200">
                  <div className="text-slate-500">Last Sync Date &amp; Time</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {localSyncStatus?.lastSuccessfulSyncAt
                      ? new Date(localSyncStatus.lastSuccessfulSyncAt).toLocaleString()
                      : 'Never (Offline-First Active)'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white border border-slate-200">
                  <div className="text-slate-500">Last Operation Direction</div>
                  <div className="font-bold text-slate-900 mt-1 uppercase">
                    {localSyncStatus?.lastSyncDirection === 'upload'
                      ? 'Uploaded Local -> Firebase'
                      : localSyncStatus?.lastSyncDirection === 'restore'
                      ? 'Restored Firebase -> Local'
                      : 'N/A'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white border border-slate-200">
                  <div className="text-slate-500">Synchronized Business Records</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {localSyncStatus?.lastSyncRecordCount ?? 0} records (
                    {localSyncStatus?.lastSyncBatchCount ?? 0} batches)
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white border border-slate-200">
                  <div className="text-slate-500">Executed By Operator</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {localSyncStatus?.lastSyncOperator || 'Super Admin'}
                  </div>
                </div>
              </div>
            </div>

            {/* Manual Sync History Log */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Manual Synchronization Audit History ({syncHistory.length})
              </h5>
              {syncHistory.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  No manual Firebase sync operations have been triggered yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {syncHistory.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.status === 'Successful'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {item.operation} — {item.status}
                          </span>
                          <span className="font-semibold text-slate-700">
                            {new Date(item.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-slate-600 mt-1">{item.message}</p>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {item.recordCount} recs
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: VIEW SYNC STATUS & LEDGER RECONCILIATION */}
        {activeTab === 'sync_status' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60">
                <div className="text-emerald-700 font-semibold">Primary Local Database</div>
                <div className="text-sm font-bold text-emerald-950 mt-0.5">
                  Local SQLite (better-sqlite3)
                </div>
                <div className="text-[11px] font-mono text-emerald-800 mt-1 break-all">
                  {localSyncStatus?.databasePath || '/app/applet/data/ams_medical.db'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                <div className="text-slate-500 font-semibold">Manual Sync Status</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-2">
                  <span>{localSyncStatus?.syncStatus || 'Not Run'}</span>
                  <span className="text-xs font-normal text-slate-500">
                    ({localSyncStatus?.pendingLocalChangesCount ?? 0} pending local changes)
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 mt-1">
                  Auto-Sync: Disabled | Background Listeners: Disabled
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between">
                <div>
                  <div className="text-slate-500 font-semibold">Firebase Cloud Destination</div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    Project: {projectId}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 truncate">
                    Store Workspace: {activeStoreId || 'Sign in to connect'} (Status:{' '}
                    {connectionStatus})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void recheckConnection()}
                  className="mt-2 self-start inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Test Firebase Reachability
                </button>
              </div>
            </div>

            {summary && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Business Transaction &amp; Double-Entry Ledger Integrity Verification
                </h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Total Posted Journal Debits</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">
                      Rs. {summary.totalJournalDebit.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Total Posted Journal Credits</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">
                      Rs. {summary.totalJournalCredit.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Sales &amp; Sales Returns</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">
                      {summary.salesCount} Sales / {summary.saleReturnsCount} Returns
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Purchases &amp; Purchase Returns</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">
                      {summary.purchasesCount} Purchases / {summary.purchaseReturnsCount} Returns
                    </div>
                  </div>
                </div>
              </div>
            )}

            {syncNotes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Cloud Sync Checkpoints in Firebase ({syncNotes.length})
                </h5>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {syncNotes.map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{n.title}</div>
                        <div className="text-slate-600">{n.note}</div>
                      </div>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {new Date(n.createdAtIso).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: VIEW SYNC ERRORS */}
        {activeTab === 'sync_errors' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Synchronization Error Log
              </h4>
              {syncErrors.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clearSyncErrors()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Error History
                </button>
              )}
            </div>

            {connectionMessage && connectionStatus === 'error' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Connection Notice:</strong> {connectionMessage}
              </div>
            )}

            {lastFirestoreError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">
                    Firestore Permission / Rule Rejection ({lastFirestoreError.operationType} on{' '}
                    {lastFirestoreError.path})
                  </p>
                  <p className="mt-1 font-mono text-[11px]">{lastFirestoreError.error}</p>
                </div>
                <button
                  type="button"
                  onClick={clearLastFirestoreError}
                  className="text-xs font-semibold underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {syncErrors.length === 0 && !lastFirestoreError ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 text-center space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-emerald-950">
                  Zero Synchronization Errors Recorded
                </p>
                <p className="text-xs text-emerald-800">
                  Your Local SQLite database is operating normally with 100% data integrity.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {syncErrors.map((err) => (
                  <div
                    key={err.id}
                    className="p-3 rounded-lg border border-rose-200 bg-rose-50/70 text-xs text-rose-950 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase text-rose-700">
                        {err.operation} Error
                      </span>
                      <span className="text-[11px] text-rose-700">
                        {new Date(err.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="font-medium">{err.message}</p>
                    {err.details && (
                      <p className="font-mono text-[11px] text-rose-800 break-all">
                        {err.details}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Explicit Confirmation Modal for Option 2: Restore Data from Firebase */}
      {showRestoreConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Confirm Manual Restore from Firebase
                  </h4>
                  <p className="text-xs text-slate-500">
                    Safe Atomic Restoration into Local SQLite
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRestoreConfirmModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-2 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-800">
                Before modifying any local data, the system will automatically:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  Create a full verified <strong>Local SQLite Safety Backup</strong> on disk.
                </li>
                <li>
                  Verify SHA-256 checksums of all downloaded Firebase business transaction batches.
                </li>
                <li>
                  Preserve all existing newer local transactions and prevent duplicate invoices.
                </li>
                <li>
                  Recalculate all customer, supplier, cash, bank, and general ledger balances.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowRestoreConfirmModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRestore()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm cursor-pointer"
              >
                <CloudDownload className="w-4 h-4" />
                Create Safety Backup &amp; Restore Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
