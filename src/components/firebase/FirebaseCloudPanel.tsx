import React, { useState } from 'react';
import {
  Cloud,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  PlusCircle,
  Archive,
  Trash2,
} from 'lucide-react';
import { useFirebase } from '../../context/FirebaseContext';
import { BLUEPRINT_LIMITS } from '../../firebase';

interface FirebaseCloudPanelProps {
  totalLiveRecords?: number;
}

export const FirebaseCloudPanel: React.FC<FirebaseCloudPanelProps> = ({
  totalLiveRecords = 0,
}) => {
  const {
    firebaseUser,
    isAuthReady,
    isFirebaseAdmin,
    firestoreStatus,
    firestoreStatusMessage,
    authBusy,
    authError,
    activeStoreId,
    syncNotes,
    notesLoading,
    notesError,
    projectId,
    databaseId,
    recheckConnection,
    signInWithGoogle,
    signOutFirebase,
    saveSyncNote,
    archiveSyncNote,
    removeSyncNote,
  } = useFirebase();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleGoogleSignIn = async () => {
    setActionMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Google sign-in could not complete.',
      });
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionMsg(null);
    setSubmitting(true);
    try {
      await saveSyncNote({
        title: title.trim() || `Checkpoint (${new Date().toLocaleDateString('en-GB')})`,
        note:
          note.trim() ||
          `Verified SQLite snapshot active with ${totalLiveRecords} live store records.`,
        recordCount: totalLiveRecords,
      });
      setTitle('');
      setNote('');
      setActionMsg({ type: 'ok', text: 'Cloud checkpoint note saved to Firestore.' });
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save cloud checkpoint note.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCaptureLiveCountsNote = async () => {
    setActionMsg(null);
    setSubmitting(true);
    try {
      await saveSyncNote({
        title: `Live DB Snapshot — ${new Date().toLocaleString('en-GB')}`,
        note: `Primary SQLite store database intact (${totalLiveRecords} live records across catalog, accounts, invoices & batches).`,
        recordCount: totalLiveRecords,
      });
      setActionMsg({ type: 'ok', text: 'Live SQLite diagnostic note synced to Firestore.' });
    } catch (err) {
      setActionMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to log snapshot to Firestore.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isQuotaError =
    (notesError || authError || actionMsg?.text || '').includes('Quota exceeded');

  return (
    <div className="bg-white rounded-2xl border border-indigo-200 shadow-xs overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-600/80 text-white">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Firebase Cloud &amp; Google Authentication</h3>
            <p className="text-[11px] text-indigo-200">
              Project <span className="font-mono font-semibold">{projectId}</span> • Firestore
              Enterprise Cloud Companion
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
              firestoreStatus === 'connected'
                ? 'bg-emerald-900/70 text-emerald-300 border border-emerald-500/40'
                : firestoreStatus === 'offline'
                  ? 'bg-amber-900/70 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-300 border border-slate-600'
            }`}
          >
            {firestoreStatus === 'connected' ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <CloudOff className="w-3.5 h-3.5" />
            )}
            <span>
              {firestoreStatus === 'connected'
                ? 'Firestore Connected'
                : firestoreStatus === 'offline'
                  ? 'Firestore Offline'
                  : firestoreStatus === 'checking'
                    ? 'Checking...'
                    : 'Connection Issue'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void recheckConnection()}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 cursor-pointer flex items-center gap-1"
            title={firestoreStatusMessage}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Test</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Non-Destructive Guarantee Banner */}
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Local Store Data Protected:</span> Firebase cloud sync &amp;
            Google Sign-In operate alongside your existing store login and local SQLite WAL
            database without ever resetting, replacing, or overwriting local inventory, sales,
            purchases, or ledger records.
          </div>
        </div>

        {/* Auth & Connection Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="font-bold text-slate-800">Google Cloud Operator Session</div>
            {!isAuthReady ? (
              <div className="text-slate-500">Initializing Firebase Authentication...</div>
            ) : firebaseUser ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate">
                      {firebaseUser.displayName || 'Google User'}
                    </div>
                    <div className="text-[11px] text-slate-600 font-mono truncate">
                      {firebaseUser.email}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      isFirebaseAdmin
                        ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isFirebaseAdmin ? 'Firebase Admin' : 'Staff'}
                  </span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void signOutFirebase()}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out Google</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !firebaseUser.emailVerified}
                    onClick={() => void handleCaptureLiveCountsNote()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Log Live DB Checkpoint</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-600">
                  Connect your Google account to save real-time cloud checkpoint notes and verify
                  authenticated Firestore rules access.
                </p>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleGoogleSignIn()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{authBusy ? 'Signing In...' : 'Sign In with Google'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 font-mono text-[11px]">
            <div className="font-sans font-bold text-slate-800 text-xs">
              Active Firestore Configuration
            </div>
            <div className="text-slate-600 truncate">
              Project ID: <strong className="text-slate-900">{projectId}</strong>
            </div>
            <div className="text-slate-600 truncate">
              Database ID: <strong className="text-slate-900">{databaseId}</strong>
            </div>
            <div className="text-slate-600 truncate">
              Workspace Path:{' '}
              <strong className="text-slate-900">
                {activeStoreId ? `stores/${activeStoreId}/syncNotes` : 'Sign in to scope workspace'}
              </strong>
            </div>
            <div className="text-slate-600">
              Connection Check: <strong className="text-slate-900">{firestoreStatusMessage}</strong>
            </div>
          </div>
        </div>

        {(authError || notesError || actionMsg) && (
          <div
            className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
              actionMsg?.type === 'ok' && !authError && !notesError
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>{authError || notesError || actionMsg?.text}</div>
              {isQuotaError && (
                <div className="text-[11px]">
                  Daily free-tier quota resets the next day (see Spark plan in Enterprise edition).{' '}
                  <a
                    href={`https://console.firebase.google.com/project/${projectId}/firestore/databases/${databaseId}/data?openUpgradeDialog=true`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold"
                  >
                    Open Firebase Database Quota Settings
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cloud Checkpoint Notes (Active only when signed in with verified email) */}
        {isAuthReady && firebaseUser && firebaseUser.emailVerified && (
          <div className="space-y-3 pt-1">
            <form
              onSubmit={handleSaveNote}
              className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end text-xs"
            >
              <div className="md:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1">
                  Cloud Checkpoint Title
                </label>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.noteTitleMaxLength}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Pre-Closing Inventory Check"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <div className="md:col-span-6">
                <label className="block font-semibold text-slate-700 mb-1">
                  Summary Note (Synced to Firestore)
                </label>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.noteBodyMaxLength}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note or shift handover summary..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>Real-Time Cloud Checkpoint Notes ({syncNotes.length})</span>
                {notesLoading && <span className="text-indigo-600">Listening...</span>}
              </div>
              {syncNotes.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No cloud checkpoint notes recorded yet for workspace{' '}
                  <span className="font-mono">{activeStoreId}</span>.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-60 overflow-y-auto">
                  {syncNotes.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 text-xs flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{item.title}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.status === 'archived'
                                ? 'bg-slate-200 text-slate-600'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {item.status}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            Records: {item.recordCount}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">{item.note}</p>
                        {item.updatedAt && (
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            Updated: {item.updatedAt.toLocaleString('en-GB')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.status !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => void archiveSyncNote(item.id)}
                            className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer flex items-center gap-1"
                            title="Archive note (locks non-admin edits)"
                          >
                            <Archive className="w-3 h-3" />
                            <span>Archive</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeSyncNote(item.id)}
                          className="p-1.5 rounded border border-rose-200 hover:bg-rose-50 text-rose-600 cursor-pointer"
                          title="Delete note"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
