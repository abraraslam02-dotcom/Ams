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
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  buildFirestoreErrorInfo,
  db,
  firebaseConfig,
  OperationType,
  testFirebaseConnection,
  type FirestoreErrorInfo,
} from '../firebase';
import { authFetch } from '../services/api';

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

function trimTrailingDot(msg: string): string {
  return msg.trim().replace(/\.+$/, '');
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
      const res = await authFetch('/api/system/firebase-sync/status');
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
    } else if (result.error?.includes('client is offline')) {
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
   * Ensures the store workspace (and optional user profile) exists in Firestore ONLY when a manual sync operation is invoked.
   */
  const ensureWorkspaceForManualSync = useCallback(async (user: FirebaseUser): Promise<string> => {
    const storeId = sanitizeStoreId(user.uid);
    const displayName = (user.displayName || 'Abrar Medical Operator').trim().slice(0, 100) || 'Abrar Medical Operator';
    const storeName = 'Abrar Medical Store';
    const rawEmail = (user.email || 'operator@example.com').trim().slice(0, 254);
    const email = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(rawEmail)
      ? rawEmail
      : 'operator@example.com';
    const roleLabel = email === 'abrar.aslam02@gmail.com' ? 'super_admin' : 'operator';

    // 1. Always upsert the parent StoreWorkspace first (Master Gate parent document)
    const storePath = `stores/${storeId}`;
    try {
      const storeRef = doc(db, 'stores', storeId);
      await setDoc(storeRef, {
        storeId,
        storeName,
        ownerUid: user.uid,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (storeErr) {
      const info = buildFirestoreErrorInfo(storeErr, OperationType.WRITE, storePath);
      setLastFirestoreError(info);
      throw new Error(
        `Firestore permission error on ${storePath}: ${trimTrailingDot(info.error)}`
      );
    }

    // 2. Best-effort upsert of public & private operator profile metadata (non-blocking)
    try {
      const publicRef = doc(db, 'users', user.uid);
      await setDoc(publicRef, {
        uid: user.uid,
        displayName,
        storeName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const privateRef = doc(db, 'users', user.uid, 'private', 'info');
      await setDoc(privateRef, {
        uid: user.uid,
        email,
        roleLabel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal profile metadata sync
    }

    setActiveStoreId(storeId);
    return storeId;
  }, []);

  /**
   * Explicitly fetches sync checkpoint notes from Firestore ONLY when requested during manual operations.
   * Queries with where('ownerUid', '==', ownerUid) and sorts in memory so zero composite indexes are required.
   */
  const fetchManualSyncNotes = useCallback(async (storeId: string, ownerUid?: string) => {
    const uid = ownerUid || auth.currentUser?.uid;
    if (!uid) return;
    try {
      const notesQuery = query(
        collection(db, 'stores', storeId, 'syncNotes'),
        where('ownerUid', '==', uid)
      );
      const snap = await getDocs(notesQuery);
      const list: CloudSyncCheckpointNote[] = snap.docs
        .map((docSnap): CloudSyncCheckpointNote => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            storeId: String(d.storeId || storeId),
            ownerUid: String(d.ownerUid || uid),
            title: String(d.title || ''),
            note: String(d.note || ''),
            recordCount: Number(d.recordCount || 0),
            status: d.status === 'archived' ? 'archived' : 'active',
            createdAtIso: formatTimestampIso(d.createdAt),
            updatedAtIso: formatTimestampIso(d.updatedAt),
          };
        })
        .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
        .slice(0, 25);
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
      // 1. Export all business transactions from Local SQLite using authenticated session fetch
      const exportRes = await authFetch('/api/system/firebase-sync/export');
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
      const totalRecords = Math.max(0, Math.floor(Number(exportData.totalRecords || 0)));
      const syncSessionId = String(exportData.syncSessionId || `sync_${Date.now()}`).slice(0, 128);
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
      const totalBatchCount = Math.max(1, batches.length);

      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        const safeBatchId = String(b.batchId || `batch_${i + 1}`)
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 128);
        uploadedBatchIds.add(safeBatchId);

        const pct = Math.min(90, 15 + Math.round(((i + 1) / totalBatchCount) * 75));
        setSyncProgress({
          active: true,
          operation: 'upload',
          percent: pct,
          currentStep: i + 1,
          totalSteps: batches.length,
          currentTable: b.tableName,
          message: `Uploading batch ${i + 1} of ${batches.length} (${b.tableName} — ${b.recordCount} records)...`,
        });

        const batchPath = `stores/${storeId}/syncBatches/${safeBatchId}`;
        try {
          const batchRef = doc(db, 'stores', storeId, 'syncBatches', safeBatchId);
          await setDoc(batchRef, {
            storeId,
            ownerUid: firebaseUser.uid,
            syncSessionId,
            tableName: String(b.tableName || 'accounts').slice(0, 80),
            batchIndex: Math.max(0, Math.floor(Number(b.batchIndex ?? i))),
            totalBatches: Math.max(1, Math.floor(Number(b.totalBatches || totalBatchCount))),
            recordCount: Math.max(0, Math.floor(Number(b.recordCount || 0))),
            recordsPayload: String(b.recordsPayload || '[]'),
            checksum: String(b.checksum || '00000000').slice(0, 128),
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (batchErr) {
          const info = buildFirestoreErrorInfo(batchErr, OperationType.WRITE, batchPath);
          setLastFirestoreError(info);
          throw new Error(
            `Firestore permission error on ${batchPath} (${b.tableName}): ${trimTrailingDot(info.error)}`
          );
        }
      }

      // 4. Remove any obsolete batch documents from older sync sessions that are no longer part of the current snapshot
      try {
        const existingBatchesQuery = query(
          collection(db, 'stores', storeId, 'syncBatches'),
          where('ownerUid', '==', firebaseUser.uid)
        );
        const existingBatchesSnap = await getDocs(existingBatchesQuery);
        for (const existingDoc of existingBatchesSnap.docs) {
          if (!uploadedBatchIds.has(existingDoc.id)) {
            await deleteDoc(doc(db, 'stores', storeId, 'syncBatches', existingDoc.id));
          }
        }
      } catch {
        // non-fatal cleanup warning
      }

      // 5. Record a checkpoint summary note in /stores/{storeId}/syncNotes
      const noteText = `Uploaded ${totalRecords} business records (${summary.salesCount} sales, ${summary.purchasesCount} purchases, ${summary.accountsCount} accounts, ${summary.itemsCount} items, ${summary.inventoryBatchesCount} stock batches, ${summary.journalEntriesCount} journal entries) in ${batches.length} verified batch(es).`;
      try {
        const noteId = sanitizeNoteId(`checkpoint_${Date.now()}`);
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
      } catch {
        // Non-fatal checkpoint note write
      }

      await fetchManualSyncNotes(storeId, firebaseUser.uid);

      // 6. Record successful manual upload in local SQLite state
      await authFetch('/api/system/firebase-sync/record-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const rawErrMsg = error instanceof Error ? error.message : String(error);
      const errMsg = trimTrailingDot(rawErrMsg);
      try {
        await authFetch('/api/system/firebase-sync/record-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

      const batchesPath = `stores/${storeId}/syncBatches`;
      let snap;
      try {
        const batchesQuery = query(
          collection(db, 'stores', storeId, 'syncBatches'),
          where('ownerUid', '==', firebaseUser.uid)
        );
        snap = await getDocs(batchesQuery);
      } catch (listErr) {
        const info = buildFirestoreErrorInfo(listErr, OperationType.LIST, batchesPath);
        setLastFirestoreError(info);
        throw new Error(
          `Firestore permission error listing ${batchesPath}: ${trimTrailingDot(info.error)}`
        );
      }

      if (snap.empty) {
        throw new Error(
          'No business transaction batches found in Firebase for this store account. Please upload local data to Firebase first.'
        );
      }

      const downloadedBatches = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            batchId: docSnap.id,
            tableName: String(d.tableName || ''),
            batchIndex: Number(d.batchIndex || 0),
            recordCount: Number(d.recordCount || 0),
            recordsPayload: String(d.recordsPayload || '[]'),
            checksum: String(d.checksum || ''),
          };
        })
        .sort((a, b) => a.batchIndex - b.batchIndex);

      setSyncProgress({
        active: true,
        operation: 'restore',
        percent: 55,
        currentStep: 2,
        totalSteps: 3,
        currentTable: 'Creating Local Safety Backup & Restoring SQLite...',
        message: `Downloaded ${downloadedBatches.length} batch(es). Creating pre-restore Local SQLite backup and merging transactions atomically...`,
      });

      const restoreRes = await authFetch('/api/system/firebase-sync/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batches: downloadedBatches,
        }),
      });
      const restoreData = await restoreRes.json();

      if (!restoreRes.ok || !restoreData.success) {
        throw new Error(restoreData.error || 'Failed to restore business transactions into Local SQLite.');
      }

      await fetchManualSyncNotes(storeId, firebaseUser.uid);
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
      const rawErrMsg = error instanceof Error ? error.message : String(error);
      const errMsg = trimTrailingDot(rawErrMsg);
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
      await authFetch('/api/system/firebase-sync/clear-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        await fetchManualSyncNotes(storeId, firebaseUser.uid);
      } catch (error) {
        const info = buildFirestoreErrorInfo(error, OperationType.CREATE, path);
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
        await fetchManualSyncNotes(activeStoreId, firebaseUser.uid);
      } catch (error) {
        const info = buildFirestoreErrorInfo(error, OperationType.UPDATE, path);
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
        await fetchManualSyncNotes(activeStoreId, firebaseUser.uid);
      } catch (error) {
        const info = buildFirestoreErrorInfo(error, OperationType.DELETE, path);
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
