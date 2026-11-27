import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  FIREBASE_CONFIG_SUMMARY,
  BOOTSTRAPPED_ADMIN_EMAIL,
  BLUEPRINT_LIMITS,
  OperationType,
  handleFirestoreError,
  sanitizeBoundedText,
  testConnection,
} from '../firebase';

export interface StoreSyncNoteItem {
  id: string;
  storeId: string;
  ownerUid: string;
  title: string;
  note: string;
  status: 'active' | 'archived';
  recordCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  isAuthReady: boolean;
  isFirebaseAdmin: boolean;
  firestoreStatus: 'checking' | 'connected' | 'offline' | 'error';
  firestoreStatusMessage: string;
  authBusy: boolean;
  authError: string | null;
  activeStoreId: string | null;
  syncNotes: StoreSyncNoteItem[];
  notesLoading: boolean;
  notesError: string | null;
  projectId: string;
  databaseId: string;
  recheckConnection: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutFirebase: () => Promise<void>;
  saveSyncNote: (input: { title: string; note: string; recordCount: number }) => Promise<void>;
  archiveSyncNote: (noteId: string) => Promise<void>;
  removeSyncNote: (noteId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | undefined>(undefined);

function parseFirestoreTimestamp(val: unknown): Date | null {
  if (val instanceof Timestamp) {
    return val.toDate();
  }
  return null;
}

function buildSafeStoreId(uid: string, isAdminEmail: boolean): string {
  if (isAdminEmail) return 'ams-main';
  const cleaned = uid.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 32);
  return `store-${cleaned || 'operator'}`;
}

function generateNoteId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `note_${ts}_${rand}`;
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [systemOperatingMode, setSystemOperatingMode] = useState<'ONLINE' | 'OFFLINE'>(() => {
    try {
      if (typeof window !== 'undefined') {
        return window.localStorage.getItem('ams_system_operating_mode') === 'ONLINE'
          ? 'ONLINE'
          : 'OFFLINE';
      }
    } catch {
      // ignore storage error
    }
    return 'OFFLINE';
  });
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isFirebaseAdmin, setIsFirebaseAdmin] = useState<boolean>(false);
  const [firestoreStatus, setFirestoreStatus] = useState<'checking' | 'connected' | 'offline' | 'error'>(
    systemOperatingMode === 'OFFLINE' ? 'offline' : 'connected'
  );
  const [firestoreStatusMessage, setFirestoreStatusMessage] = useState<string>(
    systemOperatingMode === 'OFFLINE'
      ? 'System is in OFFLINE MODE — All-day Local SQLite mode active.'
      : 'Cloud SQL PostgreSQL Ready (Online Mode).'
  );
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [syncNotes, setSyncNotes] = useState<StoreSyncNoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState<boolean>(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  useEffect(() => {
    const onModeChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: string }>).detail;
      const nextMode: 'ONLINE' | 'OFFLINE' = detail?.mode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
      setSystemOperatingMode(nextMode);
      if (nextMode === 'OFFLINE') {
        setFirestoreStatus('offline');
        setFirestoreStatusMessage('System is in OFFLINE MODE — Cloud Database requests are disabled.');
      }
    };
    window.addEventListener('ams-operating-mode-changed', onModeChanged);
    return () => window.removeEventListener('ams-operating-mode-changed', onModeChanged);
  }, []);

  const recheckConnection = useCallback(async (force = true) => {
    if (systemOperatingMode === 'OFFLINE') {
      setFirestoreStatus('offline');
      setFirestoreStatusMessage('System is in OFFLINE MODE — Cloud Database requests are disabled.');
      return;
    }
    setFirestoreStatus('checking');
    const result = await testConnection(force);
    setFirestoreStatus(result.status);
    setFirestoreStatusMessage(result.message);
  }, [systemOperatingMode]);

  useEffect(() => {
    if (systemOperatingMode === 'OFFLINE') {
      setFirestoreStatus('offline');
      setFirestoreStatusMessage('System is in OFFLINE MODE — Cloud Database requests are disabled.');
      return;
    }
    void recheckConnection(false);

    const handleOffline = () => {
      setFirestoreStatus('offline');
      setFirestoreStatusMessage('Device is offline. Use Super Admin Control Panel to check or sync manually.');
    };

    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('offline', handleOffline);
    };
  }, [recheckConnection, systemOperatingMode]);

  const syncUserDocuments = useCallback(async (_user: FirebaseUser) => {
    // Cloud SQL PostgreSQL is now the central cloud database; client-side Firestore user doc writes are disabled to avoid Firestore quota usage.
    return;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);

      if (user && user.emailVerified) {
        const isBootAdmin =
          (user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
        setIsFirebaseAdmin(isBootAdmin);
        void syncUserDocuments(user);
      } else {
        setIsFirebaseAdmin(false);
        setSyncNotes([]);
      }
    });
    return () => unsub();
  }, [syncUserDocuments]);

  const activeStoreId = useMemo(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) return null;
    const isBootAdmin =
      (firebaseUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    return buildSafeStoreId(firebaseUser.uid, isBootAdmin);
  }, [firebaseUser]);

  // Firestore onSnapshot listener disabled — central synchronization now uses Cloud SQL PostgreSQL via backend API
  useEffect(() => {
    setSyncNotes([]);
    setNotesLoading(false);
  }, [isAuthReady, firebaseUser, activeStoreId, systemOperatingMode]);

  const signInWithGoogle = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user && !cred.user.emailVerified) {
        setAuthError('Google account email is not verified. Cloud operations require a verified email.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
      throw err;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutFirebase = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut(auth);
      setSyncNotes([]);
      setIsFirebaseAdmin(false);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const ensureStoreWorkspace = useCallback(
    async (storeId: string, ownerUid: string): Promise<void> => {
      if (!BLUEPRINT_LIMITS.idPattern.test(storeId) || storeId.length > BLUEPRINT_LIMITS.storeIdMaxLength) {
        throw new Error('Invalid store workspace identifier.');
      }
      const storePath = `stores/${storeId}`;
      const storeRef = doc(db, 'stores', storeId);
      try {
        const snap = await getDoc(storeRef);
        if (!snap.exists()) {
          await setDoc(storeRef, {
            storeId,
            name: sanitizeBoundedText(
              storeId === 'ams-main' ? 'Abrar Medical Store — Main Branch' : `Abrar Medical Store (${storeId})`,
              BLUEPRINT_LIMITS.storeNameMaxLength
            ),
            ownerUid,
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, storePath);
      }
    },
    []
  );

  const saveSyncNote = useCallback(
    async (input: { title: string; note: string; recordCount: number }) => {
      if (!firebaseUser || !firebaseUser.emailVerified || !activeStoreId) {
        throw new Error('Please sign in with a verified Google account first.');
      }

      const cleanTitle = sanitizeBoundedText(input.title, BLUEPRINT_LIMITS.noteTitleMaxLength);
      const cleanNote = sanitizeBoundedText(input.note, BLUEPRINT_LIMITS.noteBodyMaxLength);
      if (!cleanTitle || !cleanNote) {
        throw new Error('Title and note body are required.');
      }

      const safeCount = Math.max(0, Math.floor(Number(input.recordCount) || 0));
      await ensureStoreWorkspace(activeStoreId, firebaseUser.uid);

      const noteId = generateNoteId();
      const notePath = `stores/${activeStoreId}/syncNotes/${noteId}`;
      try {
        await setDoc(doc(db, 'stores', activeStoreId, 'syncNotes', noteId), {
          storeId: activeStoreId,
          ownerUid: firebaseUser.uid,
          title: cleanTitle,
          note: cleanNote,
          status: 'active',
          recordCount: safeCount,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, notePath);
      }
    },
    [firebaseUser, activeStoreId, ensureStoreWorkspace]
  );

  const archiveSyncNote = useCallback(
    async (noteId: string) => {
      if (!firebaseUser || !firebaseUser.emailVerified || !activeStoreId) {
        throw new Error('Please sign in with a verified Google account first.');
      }
      if (!BLUEPRINT_LIMITS.idPattern.test(noteId) || noteId.length > BLUEPRINT_LIMITS.idMaxLength) {
        throw new Error('Invalid note ID.');
      }
      const notePath = `stores/${activeStoreId}/syncNotes/${noteId}`;
      try {
        await updateDoc(doc(db, 'stores', activeStoreId, 'syncNotes', noteId), {
          status: 'archived',
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, notePath);
      }
    },
    [firebaseUser, activeStoreId]
  );

  const removeSyncNote = useCallback(
    async (noteId: string) => {
      if (!firebaseUser || !firebaseUser.emailVerified || !activeStoreId) {
        throw new Error('Please sign in with a verified Google account first.');
      }
      if (!BLUEPRINT_LIMITS.idPattern.test(noteId) || noteId.length > BLUEPRINT_LIMITS.idMaxLength) {
        throw new Error('Invalid note ID.');
      }
      const notePath = `stores/${activeStoreId}/syncNotes/${noteId}`;
      try {
        await deleteDoc(doc(db, 'stores', activeStoreId, 'syncNotes', noteId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, notePath);
      }
    },
    [firebaseUser, activeStoreId]
  );

  const value = useMemo<FirebaseContextValue>(
    () => ({
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
      projectId: FIREBASE_CONFIG_SUMMARY.projectId,
      databaseId: FIREBASE_CONFIG_SUMMARY.databaseId,
      recheckConnection,
      signInWithGoogle,
      signOutFirebase,
      saveSyncNote,
      archiveSyncNote,
      removeSyncNote,
    }),
    [
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
      recheckConnection,
      signInWithGoogle,
      signOutFirebase,
      saveSyncNote,
      archiveSyncNote,
      removeSyncNote,
    ]
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return ctx;
}
