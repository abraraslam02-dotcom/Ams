import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_RUNTIME_INFO = {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'abrar.aslam02@gmail.com';

// Constraints synchronized verbatim with firebase-blueprint.json
export const BLUEPRINT_LIMITS = {
  idMaxLength: 128,
  idPattern: /^[a-zA-Z0-9_-]+$/,
  displayNameMaxLength: 80,
  storeNameMaxLength: 120,
  emailMaxLength: 160,
  noteTitleMaxLength: 120,
  noteBodyMaxLength: 600,
  maxRecordCount: 10000000,
} as const;

export function sanitizeBlueprintId(raw: string, fallback = 'ams_default'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, BLUEPRINT_LIMITS.idMaxLength);
  return cleaned.length > 0 && BLUEPRINT_LIMITS.idPattern.test(cleaned) ? cleaned : fallback;
}

export function sanitizeBlueprintString(raw: string, maxLength: number, fallback: string): string {
  const cleaned = String(raw || '').trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : fallback.slice(0, maxLength);
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

export { firebaseConfig };

export async function testConnection(): Promise<{
  status: 'connected' | 'offline' | 'error';
  message: string;
}> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return {
      status: 'connected',
      message: `Firestore Connected (${firebaseConfig.projectId})`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return {
        status: 'offline',
        message: 'Firestore client is offline. Local SQLite database remains active.',
      };
    }
    if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
      return {
        status: 'connected',
        message: `Firestore Connected & Hardened Rules Enforced (${firebaseConfig.projectId})`,
      };
    }
    return {
      status: 'error',
      message: msg,
    };
  }
}

export async function testFirebaseConnection(): Promise<{
  reachable: boolean;
  error: string | null;
}> {
  const res = await testConnection();
  return {
    reachable: res.status === 'connected',
    error: res.status === 'connected' ? null : res.message,
  };
}

