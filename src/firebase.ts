import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  setLogLevel,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);

// Silence noisy @firebase/firestore internal OnlineStateTracker console.error banners during offline periods;
// all real rule/write errors are explicitly caught & surfaced via handleFirestoreError and testConnection().
setLogLevel('silent');

function createFirestoreClient(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreClient();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_CONFIG_SUMMARY = {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'abrar.aslam02@gmail.com';

// Constraints synchronized verbatim with firebase-blueprint.json
export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_\-]+$/,
  idMaxLength: 128,
  storeIdMaxLength: 64,
  displayNameMaxLength: 120,
  emailMaxLength: 254,
  photoUrlMaxLength: 500,
  storeNameMaxLength: 120,
  noteTitleMaxLength: 120,
  noteBodyMaxLength: 1000,
} as const;

export function sanitizeBoundedText(value: string, maxLength: number, fallback = ''): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback.slice(0, maxLength);
  return trimmed.slice(0, maxLength);
}

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
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
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

export type ConnectionCheckResult = {
  status: 'connected' | 'offline' | 'error';
  message: string;
};

let pendingConnectionCheck: Promise<ConnectionCheckResult> | null = null;
let lastConnectionResult: ConnectionCheckResult | null = null;

export async function testConnection(force = false): Promise<ConnectionCheckResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineRes: ConnectionCheckResult = {
      status: 'offline',
      message: 'Device is offline. Firestore will reconnect when network returns.',
    };
    lastConnectionResult = offlineRes;
    return offlineRes;
  }

  if (!force && lastConnectionResult) {
    return lastConnectionResult;
  }

  if (pendingConnectionCheck) {
    return pendingConnectionCheck;
  }

  pendingConnectionCheck = (async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      const okRes: ConnectionCheckResult = {
        status: 'connected',
        message: `Connected to Firestore (${firebaseConfig.projectId})`,
      };
      lastConnectionResult = okRes;
      return okRes;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code || '')
          : '';
      const msg = error instanceof Error ? error.message : String(error || '');
      const isOfflineOrUnavailable =
        code === 'unavailable' ||
        msg.includes('the client is offline') ||
        msg.includes('unavailable') ||
        msg.includes('Failed to get document because the client is offline');

      if (isOfflineOrUnavailable) {
        const offlineRes: ConnectionCheckResult = {
          status: 'offline',
          message: 'Firestore backend unreachable (operating in offline mode).',
        };
        lastConnectionResult = offlineRes;
        return offlineRes;
      }

      const errRes: ConnectionCheckResult = {
        status: 'error',
        message: msg || 'Unable to verify Firestore connection.',
      };
      lastConnectionResult = errRes;
      return errRes;
    } finally {
      pendingConnectionCheck = null;
    }
  })();

  return pendingConnectionCheck;
}

if (typeof window !== 'undefined') {
  void testConnection();
}
