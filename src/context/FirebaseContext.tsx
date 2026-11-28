import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  firebaseConfig,
  handleFirestoreError,
  OperationType,
  testFirebaseConnection,
  type FirestoreErrorInfo,
} from '../firebase';

export interface CloudSyncCheckpointNote {
  id: string;
  storeId: string;
  ownerUid: string;
  title: string;
  note: string;
  recordCount: number;
  status: 'active' | 'archived';
  createdAtIso: string;
  updatedAtIso: string;
}

export interface BusinessDataSummary {
  salesCount: number;
  saleItemsCount: number;
  saleReturnsCount: number;
  purchasesCount: number;
  purchaseItemsCount: number;
  purchaseReturnsCount: number;
  accountsCount: number;
  customersCount: number;
  suppliersCount: number;
  cashBankAccountsCount: number;
  itemsCount: number;
  inventoryBatchesCount: number;
  totalStockQuantity: number;
  journalEntriesCount: number;
  journalLinesCount: number;
  totalJournalDebit: number;
  totalJournalCredit: number;
  ledgerBalanced: boolean;
  cashBookVouchersCount: number;
  accountingVouchersCount: number;
  paymentVouchersCount: number;
  expensesCount: number;
  stockMovementsCount: number;
  totalBusinessRecords: number;
  tableCounts: Record<string, number>;
}

export interface FirebaseSyncErrorEntry {
  id: string;
  timestamp: string;
  operation: 'upload' | 'restore' | 'connection';
  message: string;
  details?: string;
}

export interface FirebaseSyncHistoryEntry {
  id: string;
  timestamp: string;
  operation: 'upload' | 'restore';
  status: 'Successful' | 'Failed';
  recordCount: number;
  batchCount: number;
  operator: string;
  message: string;
}

export interface LocalFirebaseSyncStatus {
  primaryDatabase: string;
  databasePath: string;
  dDriveDatabasePath: string;
  localDatabaseConnected: boolean;
  cloudDestination: string;
  autoSyncEnabled: boolean;
  backgroundListenersEnabled: boolean;
  syncStatus: 'Successful' | 'Pending' | 'Failed' | 'Not Run';
  lastSuccessfulSyncAt: string | null;
  lastSyncDirection: 'upload' | 'restore' | null;
  lastSyncRecordCount: number;
  lastSyncBatchCount: number;
  lastSyncSessionId: string | null;
  lastSyncSha256: string | null;
  lastSyncOperator: string | null;
  lastSyncError: string | null;
  pendingLocalChangesCount: number;
  syncErrors: FirebaseSyncErrorEntry[];
  syncHistory: FirebaseSyncHistoryEntry[];
  businessDataSummary: BusinessDataSummary;
}

export interface ManualSyncProgress {
  active: boolean;
  operation: 'upload' | 'restore' | null;
  percent: number;
  currentStep: number;
  totalSteps: number;
  currentTable: string;
  message: string;
}

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  isAuthReady: boolean;
  isSigningIn: boolean;
  connectionStatus: 'checking' | 'connected' | 'offline' | 'error';
  connectionMessage: string | null;
  lastFirestoreError: FirestoreErrorInfo | null;
  projectId: string;
  firestoreDatabaseId: string;
  activeStoreId: string | null;
  syncNotes: CloudSyncCheckpointNote[];
  localSyncStatus: LocalFirebaseSyncStatus | null;
  syncProgress: ManualSyncProgress;
  lastActionNotice: { type: 'success' | 'error' | 'info'; message: string } | null;
  clearLastFirestoreError: () => void;
  clearActionNotice: () => void;
  signInWithGoogle: () => Promise<void>;
  signOutFirebase: () => Promise<void>;
  recheckConnection: () => Promise<void>;
  refreshLocalSyncStatus: () => Promise<void>;
  uploadLocalBusinessDataToFirebase: () => Promise<boolean>;
  restoreBusinessDataFromFirebase: () => Promise<boolean>;
  clearSyncErrors: () => Promise<void>;
  createSyncCheckpointNote: (input: {
    title: string;
    note: string;
    recordCount: number;
  }) => Promise<void>;
  archiveSyncCheckpointNote: (noteId: string) => Promise<void>;
  deleteSyncCheckpointNote: (noteId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | undefined>(undefined);

function sanitizeStoreId(uid: string): string {
  const cleaned = uid.replace(/[^a-zA-Z0-9_-]/g, '');
  return `store_${cleaned}`.slice(0, 64);
}

function sanitizeNoteId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.length >= 3 ? cleaned.slice(0, 64) : `note_${Date.now()}`;
}

function formatTimestampIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

function getLocalAuthHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('ams_auth_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'checking' | 'connected' | 'offline' | 'error'
  >('offline');
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    '100% Offline-First Mode — Firebase connects only when you click Manual Sync.'
  );
  const [lastFirestoreError, setLastFirestoreError] = useState<FirestoreErrorInfo | null>(null);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [syncNotes, setSyncNotes] = useState<CloudSyncCheckpointNote[]>([]);
  const [localSyncStatus, setLocalSyncStatus] = useState<LocalFirebaseSyncStatus | null>(null);
  const [syncProgress, setSyncProgress] = useState<ManualSyncProgress>({
    active: false,
    operation: null,
    percent: 0,
    currentStep: 0,
    totalSteps: 0,
    currentTable: '',
    message: '',
  });
  const [lastActionNotice, setLastActionNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const clearLastFirestoreError = useCallback(() => {
    setLastFirestoreError(null);
  }, []);

  const clearActionNotice = useCallback(() => {
    setLastActionNotice(null);
  }, []);

  /**
   * Purely local SQLite status fetch (zero internet or Firebase calls).
   */
  const refreshLocalSyncStatus = useCallback(async () => {
    try {
      const token =
        typeof window !== 'undefined' ? window.localStorage.getItem('ams_auth_token') : null;
      if (!token) return;
      const res = await fetch('/api/system/firebase-sync/status', {
        headers: getLocalAuthHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as LocalFirebaseSyncStatus;
        setLocalSyncStatus(data);
      }
    } catch {
      // Local status refresh is non-fatal
    }
  }, []);

  // Load purely local SQLite sync status on mount (NO Firebase network call)
  useEffect(() => {
    void refreshLocalSyncStatus();
  }, [refreshLocalSyncStatus]);

  /**
   * Manual-only connection check (invoked only when user explicitly clicks Test Connection or Manual Sync).
   */
  const recheckConnection = useCallback(async () => {
    setConnectionStatus('checking');
    const result = await testFirebaseConnection();
    if (result.reachable) {
      setConnectionStatus('connected');
      setConnectionMessage(null);
    } else if (result.error?.includes(' client is offline')) {
      setConnectionStatus('offline');
      setConnectionMessage(result.error);
    } else {
      setConnectionStatus('error');
      setConnectionMessage(result.error);
    }
  }, []);

  /**
   * Observe Firebase Auth state locally without triggering any automatic Firestore reads or writes.
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);
      if (user) {
        setActiveStoreId(sanitizeStoreId(user.uid));
      } else {
        setActiveStoreId(null);
        setSyncNotes([]);
      }
    });

    return () => unsubscribe();
  }, []);

  /**
   * Ensures the user profile & store workspace exist in Firestore ONLY when a manual sync operation is invoked.
   */
  const ensureWorkspaceForManualSync = useCallback(async (user: FirebaseUser): Promise<string> => {
    const storeId = sanitizeStoreId(user.uid);
    const displayName = (user.displayName || 'Abrar Medical Operator').slice(0, 100);
    const storeName = 'Abrar Medical Store';
    const email = (user.email || 'operator@example.com').slice(0, 254);
    const roleLabel = email === 'abrar.aslam02@gmail.com' ? 'super_admin' : 'operator';

    const publicRef = doc(db, 'users', user.uid);
    const publicSnap = await getDoc(publicRef);
    if (!publicSnap.exists()) {
      await setDoc(publicRef, {
        uid: user.uid,
        displayName,
        storeName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const privateRef = doc(db, 'users', user.uid, 'private', 'info');
    const privateSnap = await getDoc(privateRef);
    if (!privateSnap.exists()) {
      await setDoc(privateRef, {
        uid: user.uid,
        email,
        roleLabel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const storeRef = doc(db, 'stores', storeId);
    const storeSnap = await getDoc(storeRef);
    if (!storeSnap.exists()) {
      await setDoc(storeRef, {
        storeId,
        storeName,
        ownerUid: user.uid,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    setActiveStoreId(storeId);
    return storeId;
  }, []);

  /**
   * Explicitly fetches sync checkpoint notes from Firestore ONLY when requested during manual operations.
   */
  const fetchManualSyncNotes = useCallback(async (storeId: string) => {
    try {
      const notesQuery = query(
        collection(db, 'stores', storeId, 'syncNotes'),
        orderBy('createdAt', 'desc'),
        limit(25)
      );
      const snap = await getDocs(notesQuery);
      const list: CloudSyncCheckpointNote[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          storeId: String(d.storeId || storeId),
          ownerUid: String(d.ownerUid || ''),
          title: String(d.title || ''),
          note: String(d.note || ''),
          recordCount: Number(d.recordCount || 0),
          status: d.status === 'archived' ? 'archived' : 'active',
          createdAtIso: formatTimestampIso(d.createdAt),
          updatedAtIso: formatTimestampIso(d.updatedAt),
        };
      });
      setSyncNotes(list);
    } catch {
      // non-fatal during manual checkpoint list refresh
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setIsSigningIn(true);
    setLastFirestoreError(null);
    setLastActionNotice(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      if (cred.user) {
        setConnectionStatus('connected');
        setConnectionMessage(null);
        setLastActionNotice({
          type: 'info',
          message: `Signed in as ${cred.user.email}. Click "Upload Local Data to Firebase" or "Restore Data from Firebase" when you want to synchronize.`,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setConnectionMessage(`Google Sign-In failed: ${msg}`);
      setLastActionNotice({
        type: 'error',
        message: `Google Sign-In failed: ${msg}`,
      });
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutFirebase = useCallback(async () => {
    await signOut(auth);
    setSyncNotes([]);
    setActiveStoreId(null);
    setConnectionStatus('offline');
    setConnectionMessage('Signed out of Firebase. Local SQLite remains 100% active offline.');
  }, []);

  /**
   * OPTION 1: Upload Local Business Data to Firebase (Strictly Manual)
   * Exports all business transactions (Sales, Purchases, Accounts, Ledgers, Inventory, Vouchers)
   * from Local SQLite and uploads them in checksum-verified batches to Firebase Firestore.
   */
  const uploadLocalBusinessDataToFirebase = useCallback(async (): Promise<boolean> => {
    setLastFirestoreError(null);
    setLastActionNotice(null);

    if (!firebaseUser) {
      setLastActionNotice({
        type: 'error',
        message: 'Please sign in with your Google Account first to upload local business transactions to Firebase.',
      });
      return false;
    }

    setSyncProgress({
      active: true,
      operation: 'upload',
      percent: 5,
      currentStep: 0,
      totalSteps: 1,
      currentTable: 'Preparing Local SQLite Business Transactions...',
      message: 'Reading Sales, Purchases, Accounts, Ledgers, and Inventory from Local SQLite...',
    });

    try {
      // 1. Export all business transactions from Local SQLite
      const exportRes = await fetch('/api/system/firebase-sync/export', {
        headers: getLocalAuthHeaders(),
      });
      const exportData = await exportRes.json();
      if (!exportRes.ok || !exportData.success) {
        throw new Error(exportData.error || 'Failed to export business transactions from Local SQLite.');
      }

      const batches: Array<{
        batchId: string;
        syncSessionId: string;
        tableName: string;
        batchIndex: number;
        totalBatches: number;
        recordCount: number;
        recordsPayload: string;
        checksum: string;
      }> = Array.isArray(exportData.batches) ? exportData.batches : [];
      const totalRecords = Number(exportData.totalRecords || 0);
      const syncSessionId = String(exportData.syncSessionId || `sync_${Date.now()}`);
      const overallSha256 = String(exportData.overallSha256 || '');
      const summary = exportData.summary as BusinessDataSummary;

      // 2. Ensure parent StoreWorkspace exists in Firestore
      setSyncProgress({
        active: true,
        operation: 'upload',
        percent: 12,
        currentStep: 0,
        totalSteps: batches.length,
        currentTable: 'Verifying Firebase Workspace...',
        message: 'Connecting to Firebase Firestore workspace...',
      });

      const storeId = await ensureWorkspaceForManualSync(firebaseUser);
      setConnectionStatus('connected');
      setConnectionMessage(null);

      // 3. Upload each batch document sequentially (resumable, bounded size, verified checksum)
      const uploadedBatchIds = new Set<string>();
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        uploadedBatchIds.add(b.batchId);
        const pct = Math.min(90, 15 + Math.round(((i + 1) / Math.max(1, batches.length)) * 75));
        setSyncProgress({
          active: true,
          operation: 'upload',
          percent: pct,
          currentStep: i + 1,
          totalSteps: batches.length,
          currentTable: b.tableName,
          message: `Uploading batch ${i + 1} of ${batches.length} (${b.tableName} — ${b.recordCount} records)...`,
        });

        const batchRef = doc(db, 'stores', storeId, 'syncBatches', b.batchId);
        await setDoc(batchRef, {
          storeId,
          ownerUid: firebaseUser.uid,
          syncSessionId,
          tableName: b.tableName,
          batchIndex: b.batchIndex,
          totalBatches: b.totalBatches,
          recordCount: b.recordCount,
          recordsPayload: b.recordsPayload,
          checksum: b.checksum,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // 4. Remove any obsolete batch documents from older sync sessions that are no longer part of the current snapshot
      try {
        const existingBatchesSnap = await getDocs(
          collection(db, 'stores', storeId, 'syncBatches')
        );
        for (const existingDoc of existingBatchesSnap.docs) {
          if (!uploadedBatchIds.has(existingDoc.id)) {
            await deleteDoc(doc(db, 'stores', storeId, 'syncBatches', existingDoc.id));
          }
        }
      } catch {
        // non-fatal cleanup warning
      }

      // 5. Record a checkpoint summary note in /stores/{storeId}/syncNotes
      const noteId = sanitizeNoteId(`checkpoint_${Date.now()}`);
      const noteText = `Uploaded ${totalRecords} business records (${summary.salesCount} sales, ${summary.purchasesCount} purchases, ${summary.accountsCount} accounts, ${summary.itemsCount} items, ${summary.inventoryBatchesCount} stock batches, ${summary.journalEntriesCount} journal entries) in ${batches.length} verified batch(es).`;
      await setDoc(doc(db, 'stores', storeId, 'syncNotes', noteId), {
        storeId,
        ownerUid: firebaseUser.uid,
        title: `Manual Business Sync (${new Date().toLocaleString()})`.slice(0, 120),
        note: noteText.slice(0, 600),
        recordCount: totalRecords,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await fetchManualSyncNotes(storeId);

      // 6. Record successful manual upload in local SQLite state
      await fetch('/api/system/firebase-sync/record-result', {
        method: 'POST',
        headers: getLocalAuthHeaders(),
        body: JSON.stringify({
          operation: 'upload',
          status: 'Successful',
          recordCount: totalRecords,
          batchCount: batches.length,
          syncSessionId,
          sha256: overallSha256,
          message: noteText,
        }),
      });

      await refreshLocalSyncStatus();

      setSyncProgress({
        active: false,
        operation: null,
        percent: 100,
        currentStep: batches.length,
        totalSteps: batches.length,
        currentTable: 'Completed',
        message: noteText,
      });

      setLastActionNotice({
        type: 'success',
        message: noteText,
      });
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      try {
        await fetch('/api/system/firebase-sync/record-result', {
          method: 'POST',
          headers: getLocalAuthHeaders(),
          body: JSON.stringify({
            operation: 'upload',
            status: 'Failed',
            message: `Manual upload to Firebase failed: ${errMsg}`,
            errorDetails: errMsg,
          }),
        });
        await refreshLocalSyncStatus();
      } catch {
        // ignore secondary logging error
      }

      setSyncProgress({
        active: false,
        operation: null,
        percent: 0,
        currentStep: 0,
        totalSteps: 0,
        currentTable: '',
        message: '',
      });

      setLastActionNotice({
        type: 'error',
        message: `Manual upload to Firebase failed: ${errMsg}. All local transactions remain 100% safe in your Local SQLite database.`,
      });
      return false;
    }
  }, [ensureWorkspaceForManualSync, fetchManualSyncNotes, firebaseUser, refreshLocalSyncStatus]);

  /**
   * OPTION 2: Restore Business Data from Firebase (Strictly Manual)
   * Downloads all business transaction batches from Firebase Firestore, creates an automatic
   * local SQLite pre-restore safety backup, and atomically merges records without duplicating
   * invoices or overwriting newer local transactions.
   */
  const restoreBusinessDataFromFirebase = useCallback(async (): Promise<boolean> => {
    setLastFirestoreError(null);
    setLastActionNotice(null);

    if (!firebaseUser) {
      setLastActionNotice({
        type: 'error',
        message: 'Please sign in with your Google Account first to restore business data from Firebase.',
      });
      return false;
    }

    setSyncProgress({
      active: true,
      operation: 'restore',
      percent: 10,
      currentStep: 0,
      totalSteps: 3,
      currentTable: 'Connecting to Firebase Firestore...',
      message: 'Fetching business transaction batches from Firebase...',
    });

    try {
      const storeId = await ensureWorkspaceForManualSync(firebaseUser);
      setConnectionStatus('connected');
      setConnectionMessage(null);

      const batchesQuery = query(
        collection(db, 'stores', storeId, 'syncBatches'),
        orderBy('batchIndex', 'asc')
      );
      const snap = await getDocs(batchesQuery);

      if (snap.empty) {
        throw new Error(
          'No business transaction batches found in Firebase for this store account. Please upload local data to Firebase first.'
        );
      }

      const downloadedBatches = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          batchId: docSnap.id,
          tableName: String(d.tableName || ''),
          batchIndex: Number(d.batchIndex || 0),
          recordCount: Number(d.recordCount || 0),
          recordsPayload: String(d.recordsPayload || '[]'),
          checksum: String(d.checksum || ''),
        };
      });

      setSyncProgress({
        active: true,
        operation: 'restore',
        percent: 55,
        currentStep: 2,
        totalSteps: 3,
        currentTable: 'Creating Local Safety Backup & Restoring SQLite...',
        message: `Downloaded ${downloadedBatches.length} batch(es). Creating pre-restore Local SQLite backup and merging transactions atomically...`,
      });

      const restoreRes = await fetch('/api/system/firebase-sync/restore', {
        method: 'POST',
        headers: getLocalAuthHeaders(),
        body: JSON.stringify({
          batches: downloadedBatches,
        }),
      });
      const restoreData = await restoreRes.json();

      if (!restoreRes.ok || !restoreData.success) {
        throw new Error(restoreData.error || 'Failed to restore business transactions into Local SQLite.');
      }

      await fetchManualSyncNotes(storeId);
      await refreshLocalSyncStatus();

      setSyncProgress({
        active: false,
        operation: null,
        percent: 100,
        currentStep: 3,
        totalSteps: 3,
        currentTable: 'Completed',
        message: String(restoreData.message || 'Restore from Firebase completed successfully.'),
      });

      setLastActionNotice({
        type: 'success',
        message: String(restoreData.message || 'Restore from Firebase completed successfully.'),
      });
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await refreshLocalSyncStatus();
      setSyncProgress({
        active: false,
        operation: null,
        percent: 0,
        currentStep: 0,
        totalSteps: 0,
        currentTable: '',
        message: '',
      });
      setLastActionNotice({
        type: 'error',
        message: `Restore from Firebase failed: ${errMsg}. Your Local SQLite database was not modified.`,
      });
      return false;
    }
  }, [ensureWorkspaceForManualSync, fetchManualSyncNotes, firebaseUser, refreshLocalSyncStatus]);

  const clearSyncErrors = useCallback(async () => {
    try {
      await fetch('/api/system/firebase-sync/clear-errors', {
        method: 'POST',
        headers: getLocalAuthHeaders(),
      });
      await refreshLocalSyncStatus();
      setLastActionNotice({
        type: 'info',
        message: 'Cleared synchronization error history.',
      });
    } catch {
      // ignore
    }
  }, [refreshLocalSyncStatus]);

  const createSyncCheckpointNote = useCallback(
    async (input: { title: string; note: string; recordCount: number }) => {
      if (!firebaseUser) {
        throw new Error('You must be signed in to create a cloud sync checkpoint.');
      }
      const storeId = await ensureWorkspaceForManualSync(firebaseUser);
      const cleanTitle = input.title.trim().slice(0, 120);
      const cleanNote = input.note.trim().slice(0, 600);
      const cleanCount = Math.max(0, Math.min(10000000, Math.floor(Number(input.recordCount) || 0)));
      const noteId = sanitizeNoteId(
        `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      );
      const path = `stores/${storeId}/syncNotes/${noteId}`;

      try {
        await setDoc(doc(db, 'stores', storeId, 'syncNotes', noteId), {
          storeId,
          ownerUid: firebaseUser.uid,
          title: cleanTitle,
          note: cleanNote,
          recordCount: cleanCount,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await fetchManualSyncNotes(storeId);
      } catch (error) {
        const info = handleFirestoreError(error, OperationType.CREATE, path);
        setLastFirestoreError(info);
      }
    },
    [ensureWorkspaceForManualSync, fetchManualSyncNotes, firebaseUser]
  );

  const archiveSyncCheckpointNote = useCallback(
    async (noteId: string) => {
      if (!firebaseUser || !activeStoreId) return;
      const existing = syncNotes.find((n) => n.id === noteId);
      if (!existing) return;
      const path = `stores/${activeStoreId}/syncNotes/${noteId}`;

      try {
        await updateDoc(doc(db, 'stores', activeStoreId, 'syncNotes', noteId), {
          status: 'archived',
          updatedAt: serverTimestamp(),
        });
        await fetchManualSyncNotes(activeStoreId);
      } catch (error) {
        const info = handleFirestoreError(error, OperationType.UPDATE, path);
        setLastFirestoreError(info);
      }
    },
    [activeStoreId, fetchManualSyncNotes, firebaseUser, syncNotes]
  );

  const deleteSyncCheckpointNote = useCallback(
    async (noteId: string) => {
      if (!firebaseUser || !activeStoreId) return;
      const path = `stores/${activeStoreId}/syncNotes/${noteId}`;
      try {
        await deleteDoc(doc(db, 'stores', activeStoreId, 'syncNotes', noteId));
        await fetchManualSyncNotes(activeStoreId);
      } catch (error) {
        const info = handleFirestoreError(error, OperationType.DELETE, path);
        setLastFirestoreError(info);
      }
    },
    [activeStoreId, fetchManualSyncNotes, firebaseUser]
  );

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        isAuthReady,
        isSigningIn,
        connectionStatus,
        connectionMessage,
        lastFirestoreError,
        projectId: firebaseConfig.projectId,
        firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
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
        createSyncCheckpointNote,
        archiveSyncCheckpointNote,
        deleteSyncCheckpointNote,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return ctx;
}
