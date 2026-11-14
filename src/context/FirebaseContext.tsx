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
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isFirebaseAdmin, setIsFirebaseAdmin] = useState<boolean>(false);
  const [firestoreStatus, setFirestoreStatus] = useState<'checking' | 'connected' | 'offline' | 'error'>('checking');
  const [firestoreStatusMessage, setFirestoreStatusMessage] = useState<string>('Checking Firestore connection...');
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [syncNotes, setSyncNotes] = useState<StoreSyncNoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState<boolean>(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const recheckConnection = useCallback(async () => {
    setFirestoreStatus('checking');
    const result = await testConnection();
    setFirestoreStatus(result.status);
    setFirestoreStatusMessage(result.message);
  }, []);

  useEffect(() => {
    void recheckConnection();
  }, [recheckConnection]);

  const syncUserDocuments = useCallback(async (user: FirebaseUser) => {
    if (!user.emailVerified || !user.email) return;
    if (!BLUEPRINT_LIMITS.idPattern.test(user.uid) || user.uid.length > BLUEPRINT_LIMITS.idMaxLength) {
      return;
    }

    const isBootAdmin = user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    const displayName = sanitizeBoundedText(
      user.displayName || user.email.split('@')[0] || 'AMS Operator',
      BLUEPRINT_LIMITS.displayNameMaxLength,
      'AMS Operator'
    );
    const email = sanitizeBoundedText(user.email, BLUEPRINT_LIMITS.emailMaxLength);
    const photoUrl = user.photoURL
      ? sanitizeBoundedText(user.photoURL, BLUEPRINT_LIMITS.photoUrlMaxLength)
      : undefined;

    const userDocPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);
    try {
      const existingSnap = await getDoc(userRef);
      if (!existingSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName,
          role: isBootAdmin ? 'admin' : 'staff',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          displayName,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userDocPath);
    }

    const privatePath = `users/${user.uid}/private/info`;
    const privateRef = doc(db, 'users', user.uid, 'private', 'info');
    try {
      const existingPriv = await getDoc(privateRef);
      const privPayload: Record<string, unknown> = {
        uid: user.uid,
        email,
        updatedAt: serverTimestamp(),
      };
      if (photoUrl) {
        privPayload.photoUrl = photoUrl;
      }

      if (!existingPriv.exists()) {
        await setDoc(privateRef, privPayload);
      } else {
        const updatePayload: Record<string, unknown> = {
          email,
          updatedAt: serverTimestamp(),
        };
        if (photoUrl) {
          updatePayload.photoUrl = photoUrl;
        }
        await updateDoc(privateRef, updatePayload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, privatePath);
    }

    if (isBootAdmin) {
      setIsFirebaseAdmin(true);
    } else {
      const adminPath = `admins/${user.uid}`;
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        setIsFirebaseAdmin(adminSnap.exists());
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, adminPath);
      }
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);

      if (user && user.emailVerified) {
        const isBootAdmin =
          (user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
        setIsFirebaseAdmin(isBootAdmin);
        void syncUserDocuments(user).catch((err) => {
          setAuthError(err instanceof Error ? err.message : String(err));
        });
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

  // Attach real-time onSnapshot listener ONLY when auth is ready & user is signed in + verified
  useEffect(() => {
    if (!isAuthReady || !firebaseUser || !firebaseUser.emailVerified || !activeStoreId) {
      setSyncNotes([]);
      setNotesLoading(false);
      return;
    }

    const notesPath = `stores/${activeStoreId}/syncNotes`;
    setNotesLoading(true);
    setNotesError(null);

    const q = query(
      collection(db, 'stores', activeStoreId, 'syncNotes'),
      where('ownerUid', '==', firebaseUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const rows: StoreSyncNoteItem[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              storeId: String(data.storeId || activeStoreId),
              ownerUid: String(data.ownerUid || ''),
              title: String(data.title || ''),
              note: String(data.note || ''),
              status: (data.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
              recordCount: Number.isInteger(data.recordCount) ? Number(data.recordCount) : 0,
              createdAt: parseFirestoreTimestamp(data.createdAt),
              updatedAt: parseFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
        setSyncNotes(rows);
        setNotesLoading(false);
      },
      (error) => {
        setNotesLoading(false);
        setNotesError(error instanceof Error ? error.message : String(error));
        handleFirestoreError(error, OperationType.LIST, notesPath);
      }
    );

    return () => unsub();
  }, [isAuthReady, firebaseUser, activeStoreId]);

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
