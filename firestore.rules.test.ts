/**
 * Phase 0: Payload-First Security TDD Test Suite for firestore.rules
 * Verifies all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: {
    uid: string;
    email: string;
    email_verified: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_SECURITY_TESTS: readonly DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoof Attack on Admin Account',
    operation: 'create',
    path: '/stores/store_u1',
    auth: { uid: 'u1', email: 'abrar.aslam02@gmail.com', email_verified: false },
    payload: {
      storeId: 'store_u1',
      storeName: 'Abrar Medical Store',
      ownerUid: 'u1',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Identity Spoofing on Store Creation (ownerUid != auth.uid)',
    operation: 'create',
    path: '/stores/store_u1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      storeId: 'store_u1',
      storeName: 'Abrar Medical Store',
      ownerUid: 'u2_victim',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow / Ghost Field Injection (isAdmin: true)',
    operation: 'create',
    path: '/users/u1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Operator',
      storeName: 'Abrar Medical Store',
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Path Variable ID Poisoning (Non-Alphanumeric Characters)',
    operation: 'create',
    path: '/stores/bad$id!spaces',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      storeId: 'bad$id!spaces',
      storeName: 'Abrar Medical Store',
      ownerUid: 'u1',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Subcollection Write Without Existing Parent Store',
    operation: 'create',
    path: '/stores/missing_parent/syncNotes/note_1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      storeId: 'missing_parent',
      ownerUid: 'u1',
      title: 'Orphan Note',
      note: 'Should fail Master Gate',
      recordCount: 100,
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Tenant Subcollection Write Into Another Owner Store',
    operation: 'create',
    path: '/stores/store_u1/syncNotes/note_2',
    auth: { uid: 'u2_attacker', email: 'attacker@example.com', email_verified: true },
    payload: {
      storeId: 'store_u1',
      ownerUid: 'u2_attacker',
      title: 'Cross Tenant',
      note: 'Blocked by Master Gate parent check',
      recordCount: 100,
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'PII Leak Attempt on Split Private User Profile',
    operation: 'get',
    path: '/users/u1/private/info',
    auth: { uid: 'u2_attacker', email: 'attacker@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Unauthorized List Scraping Across Tenants',
    operation: 'list',
    path: '/stores/store_u1/syncNotes',
    auth: { uid: 'u2_attacker', email: 'attacker@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal State Bypass on Archived Sync Note',
    operation: 'update',
    path: '/stores/store_u1/syncNotes/archived_note_1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      note: 'Attempting to mutate after status == archived',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal Field Mutation (Changing ownerUid on Update)',
    operation: 'update',
    path: '/stores/store_u1/syncNotes/note_1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      ownerUid: 'u2_other',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Poisoning on Whitelisted Update Key (note > 600 chars)',
    operation: 'update',
    path: '/stores/store_u1/syncNotes/note_1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      note: 'X'.repeat(650),
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Forged Client Timestamp on Create (createdAt != request.time)',
    operation: 'create',
    path: '/stores/store_u1/syncNotes/note_1',
    auth: { uid: 'u1', email: 'staff@example.com', email_verified: true },
    payload: {
      storeId: 'store_u1',
      ownerUid: 'u1',
      title: 'Backdated Note',
      note: 'Forged timestamp',
      recordCount: 50,
      status: 'active',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
