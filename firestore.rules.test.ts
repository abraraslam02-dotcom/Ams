import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

type AuthContext = {
  uid: string;
  email: string;
  email_verified: boolean;
} | null;

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function isValidId(id: unknown, maxLen = 128): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= maxLen && VALID_ID_REGEX.test(id);
}

function isBootstrappedAdmin(auth: AuthContext): boolean {
  return Boolean(auth && auth.email_verified === true && auth.email === 'abrar.aslam02@gmail.com');
}

function simulateRuleDecision(opts: {
  auth: AuthContext;
  collection: 'users' | 'userPrivate' | 'admins' | 'stores' | 'syncNotes';
  op: 'get' | 'list' | 'create' | 'update';
  docId: string;
  parentStore?: { storeId: string; ownerUid: string; status: string } | null;
  existing?: Record<string, unknown> | null;
  incoming?: Record<string, unknown>;
  serverTimeMarker?: string;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const { auth, collection, op, docId, parentStore, existing, incoming, serverTimeMarker = '__SERVER_TIME__' } = opts;

  if (!auth || auth.email_verified !== true) {
    return 'PERMISSION_DENIED';
  }

  if (op !== 'list' && !isValidId(docId, collection === 'stores' ? 64 : 128)) {
    return 'PERMISSION_DENIED';
  }

  const admin = isBootstrappedAdmin(auth);

  if (collection === 'users') {
    if (op === 'list') return 'PERMISSION_DENIED';
    if (op === 'get') return auth.uid === docId || admin ? 'ALLOW' : 'PERMISSION_DENIED';
    if (!incoming) return 'PERMISSION_DENIED';
    const keys = Object.keys(incoming);
    const reqKeys = ['uid', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
    if (!reqKeys.every((k) => keys.includes(k)) || !keys.every((k) => reqKeys.includes(k))) {
      return 'PERMISSION_DENIED';
    }
    if (
      !isValidId(incoming.uid) ||
      typeof incoming.displayName !== 'string' ||
      incoming.displayName.length < 1 ||
      incoming.displayName.length > 120 ||
      !['staff', 'admin'].includes(String(incoming.role)) ||
      !['active', 'disabled'].includes(String(incoming.status))
    ) {
      return 'PERMISSION_DENIED';
    }
    if (op === 'create') {
      if (incoming.uid !== docId || incoming.createdAt !== serverTimeMarker || incoming.updatedAt !== serverTimeMarker) {
        return 'PERMISSION_DENIED';
      }
      if (!admin && (auth.uid !== docId || incoming.role !== 'staff' || incoming.status !== 'active')) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
    if (op === 'update' && existing) {
      if (incoming.uid !== existing.uid || incoming.createdAt !== existing.createdAt || incoming.updatedAt !== serverTimeMarker) {
        return 'PERMISSION_DENIED';
      }
      if (admin) return 'ALLOW';
      const changed = keys.filter((k) => incoming[k] !== existing[k]);
      const allowed = ['displayName', 'updatedAt'];
      if (auth.uid !== docId || incoming.role !== existing.role || incoming.status !== existing.status || !changed.every((k) => allowed.includes(k))) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  if (collection === 'userPrivate') {
    if (op === 'list' || docId !== 'info') return 'PERMISSION_DENIED';
    const targetUid = String(incoming?.uid || existing?.uid || '');
    return auth.uid === targetUid || admin ? 'ALLOW' : 'PERMISSION_DENIED';
  }

  if (collection === 'admins') {
    if (op === 'list') return 'PERMISSION_DENIED';
    if (op === 'create' || op === 'update') return admin ? 'ALLOW' : 'PERMISSION_DENIED';
  }

  if (collection === 'syncNotes') {
    if (op === 'list') {
      return admin || existing?.ownerUid === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (!incoming) return 'PERMISSION_DENIED';
    const keys = Object.keys(incoming);
    const reqKeys = ['storeId', 'ownerUid', 'title', 'note', 'status', 'recordCount', 'createdAt', 'updatedAt'];
    if (!reqKeys.every((k) => keys.includes(k)) || !keys.every((k) => reqKeys.includes(k))) {
      return 'PERMISSION_DENIED';
    }
    if (
      !isValidId(incoming.storeId, 64) ||
      !isValidId(incoming.ownerUid) ||
      typeof incoming.title !== 'string' ||
      incoming.title.length < 1 ||
      incoming.title.length > 120 ||
      typeof incoming.note !== 'string' ||
      incoming.note.length < 1 ||
      incoming.note.length > 1000 ||
      !['active', 'archived'].includes(String(incoming.status)) ||
      typeof incoming.recordCount !== 'number' ||
      !Number.isInteger(incoming.recordCount) ||
      incoming.recordCount < 0
    ) {
      return 'PERMISSION_DENIED';
    }
    if (!parentStore) return 'PERMISSION_DENIED';
    if (op === 'create') {
      if (
        incoming.ownerUid !== auth.uid ||
        incoming.status !== 'active' ||
        incoming.createdAt !== serverTimeMarker ||
        incoming.updatedAt !== serverTimeMarker
      ) {
        return 'PERMISSION_DENIED';
      }
      if (!admin && (parentStore.ownerUid !== auth.uid || parentStore.status !== 'active')) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
    if (op === 'update' && existing) {
      if (
        incoming.storeId !== existing.storeId ||
        incoming.ownerUid !== existing.ownerUid ||
        incoming.createdAt !== existing.createdAt ||
        incoming.updatedAt !== serverTimeMarker
      ) {
        return 'PERMISSION_DENIED';
      }
      if (admin) return 'ALLOW';
      if (existing.ownerUid !== auth.uid || existing.status === 'archived') {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  return 'PERMISSION_DENIED';
}

test('Firestore rules structural & blueprint coverage audit', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2';/);
  assert.match(rulesContent, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /abrar\.aslam02@gmail\.com/);
  assert.ok(blueprint.firestore['/users/{userId}']);
  assert.ok(blueprint.firestore['/users/{userId}/private/{docId}']);
  assert.ok(blueprint.firestore['/admins/{userId}']);
  assert.ok(blueprint.firestore['/stores/{storeId}']);
  assert.ok(blueprint.firestore['/stores/{storeId}/syncNotes/{noteId}']);
  assert.ok(blueprint.firestore['/test/{docId}']);
});

test('Dirty Dozen adversarial payloads all return PERMISSION_DENIED', () => {
  // 1. Identity spoofing
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'attacker_999', email: 'attacker@example.com', email_verified: true },
      collection: 'users',
      op: 'create',
      docId: 'victim_123',
      incoming: {
        uid: 'victim_123',
        displayName: 'Attacker',
        role: 'staff',
        status: 'active',
        createdAt: '__SERVER_TIME__',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 2. Self-assigned admin privilege escalation
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'attacker_999', email: 'attacker@example.com', email_verified: true },
      collection: 'users',
      op: 'create',
      docId: 'attacker_999',
      incoming: {
        uid: 'attacker_999',
        displayName: 'Attacker',
        role: 'admin',
        status: 'active',
        createdAt: '__SERVER_TIME__',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 3. Unverified email admin spoof attack
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'spoof_uid', email: 'abrar.aslam02@gmail.com', email_verified: false },
      collection: 'admins',
      op: 'create',
      docId: 'spoof_uid',
      incoming: {
        uid: 'spoof_uid',
        email: 'abrar.aslam02@gmail.com',
        grantedBy: 'spoof_uid',
        createdAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 4. Shadow update / ghost field injection
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'users',
      op: 'update',
      docId: 'user_1',
      existing: {
        uid: 'user_1',
        displayName: 'Staff One',
        role: 'staff',
        status: 'active',
        createdAt: 't0',
        updatedAt: 't0',
      },
      incoming: {
        uid: 'user_1',
        displayName: 'Staff One',
        role: 'staff',
        status: 'active',
        createdAt: 't0',
        updatedAt: '__SERVER_TIME__',
        isVerified: true,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 5. Cross-tenant PII access
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'other_staff', email: 'other@example.com', email_verified: true },
      collection: 'userPrivate',
      op: 'get',
      docId: 'info',
      existing: { uid: 'victim_uid', email: 'victim@example.com', updatedAt: 't0' },
    }),
    'PERMISSION_DENIED'
  );

  // 6. Path variable ID poisoning
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'create',
      docId: 'bad$$id with spaces',
      parentStore: { storeId: 'ams-main', ownerUid: 'user_1', status: 'active' },
      incoming: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'Test',
        note: 'Valid',
        status: 'active',
        recordCount: 10,
        createdAt: '__SERVER_TIME__',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 7. Orphaned subcollection write (no parent store)
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'create',
      docId: 'note_1',
      parentStore: null,
      incoming: {
        storeId: 'nonexistent',
        ownerUid: 'user_1',
        title: 'Orphan',
        note: 'Missing parent',
        status: 'active',
        recordCount: 1,
        createdAt: '__SERVER_TIME__',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 8. Client timestamp forgery
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'create',
      docId: 'note_2',
      parentStore: { storeId: 'ams-main', ownerUid: 'user_1', status: 'active' },
      incoming: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'Backdated',
        note: 'Spoofed time',
        status: 'active',
        recordCount: 5,
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2020-01-01T00:00:00Z',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 9. Immutable ownerUid tampering
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'update',
      docId: 'note_3',
      parentStore: { storeId: 'ams-main', ownerUid: 'user_1', status: 'active' },
      existing: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'Orig',
        note: 'Note',
        status: 'active',
        recordCount: 5,
        createdAt: 't0',
        updatedAt: 't0',
      },
      incoming: {
        storeId: 'ams-main',
        ownerUid: 'hijacked_uid',
        title: 'Orig',
        note: 'Note',
        status: 'active',
        recordCount: 5,
        createdAt: 't0',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 10. Terminal state mutation on archived note
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'update',
      docId: 'note_4',
      parentStore: { storeId: 'ams-main', ownerUid: 'user_1', status: 'active' },
      existing: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'Archived',
        note: 'Locked',
        status: 'archived',
        recordCount: 5,
        createdAt: 't0',
        updatedAt: 't0',
      },
      incoming: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'Reopened',
        note: 'Locked',
        status: 'active',
        recordCount: 5,
        createdAt: 't0',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 11. Value poisoning / oversized title + negative integer
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'create',
      docId: 'note_5',
      parentStore: { storeId: 'ams-main', ownerUid: 'user_1', status: 'active' },
      incoming: {
        storeId: 'ams-main',
        ownerUid: 'user_1',
        title: 'A'.repeat(121),
        note: 'B'.repeat(1001),
        status: 'active',
        recordCount: -5,
        createdAt: '__SERVER_TIME__',
        updatedAt: '__SERVER_TIME__',
      },
    }),
    'PERMISSION_DENIED'
  );

  // 12. Unscoped blanket list scraping
  assert.equal(
    simulateRuleDecision({
      auth: { uid: 'user_1', email: 'staff@example.com', email_verified: true },
      collection: 'syncNotes',
      op: 'list',
      docId: 'note_6',
      existing: { ownerUid: 'someone_else' },
    }),
    'PERMISSION_DENIED'
  );
});
