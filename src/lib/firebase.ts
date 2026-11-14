// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface FirestoreConnectionState {
  connected: boolean;
  checking: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  projectId: string;
  databaseId: string;
}

const connectionState: FirestoreConnectionState = {
  connected: typeof navigator === 'undefined' || navigator.onLine !== false,
  checking: false,
  lastCheckedAt: null,
  lastError: null,
  latencyMs: null,
  projectId: FIREBASE_PROJECT_ID,
  databaseId: FIRESTORE_DATABASE_ID,
};

const connectionListeners = new Set<(state: FirestoreConnectionState) => void>();

function notifyConnectionListeners() {
  const snapshot = { ...connectionState };
  connectionListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener error
    }
  });
}

export function getFirestoreConnectionState(): FirestoreConnectionState {
  return { ...connectionState };
}

export function subscribeFirestoreConnection(
  listener: (state: FirestoreConnectionState) => void
): () => void {
  connectionListeners.add(listener);
  listener({ ...connectionState });
  return () => {
    connectionListeners.delete(listener);
  };
}

export async function testFirestoreConnection(): Promise<FirestoreConnectionState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    connectionState.connected = false;
    connectionState.checking = false;
    connectionState.lastCheckedAt = new Date().toISOString();
    connectionState.lastError = 'Browser network is offline';
    connectionState.latencyMs = null;
    notifyConnectionListeners();
    return { ...connectionState };
  }

  connectionState.checking = true;
  notifyConnectionListeners();

  const startedAt = Date.now();
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    connectionState.connected = true;
    connectionState.lastError = null;
    connectionState.latencyMs = Date.now() - startedAt;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    connectionState.connected = false;
    connectionState.lastError = msg;
    connectionState.latencyMs = null;
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration or network connection.', msg);
    }
    if (msg.toLowerCase().includes('permission') || msg.includes('PERMISSION_DENIED')) {
      try {
        handleFirestoreError(error, OperationType.GET, 'test/connection');
      } catch {
        // Recorded cleanly in connectionState & console
      }
    }
  } finally {
    connectionState.checking = false;
    connectionState.lastCheckedAt = new Date().toISOString();
    notifyConnectionListeners();
  }

  return { ...connectionState };
}

if (typeof window !== 'undefined') {
  testFirestoreConnection().catch(() => {});
}
