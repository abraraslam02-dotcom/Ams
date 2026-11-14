# Firestore Security Specification — Abrar Medical Store System

## Phase 0: Data Invariants
1. **Default-Deny Catch-All**: All unmatched paths (`/{document=**}`) are explicitly denied for read and write at the top of `match /databases/{database}/documents`.
2. **Verified Email Identity**: Standard read/write rules require `request.auth != null && request.auth.token.email_verified == true`. Unverified email tokens cannot escalate to admin or mutate data.
3. **Privilege Isolation & Anti-Self-Promotion**:
   - Users creating `/users/{userId}` can only set `uid == request.auth.uid`, `role == 'staff'`, and `status == 'active'` unless already verified as admin (`isAdmin()`).
   - Non-admin users cannot update `role` or `status` on `/users/{userId}`, nor write to `/admins/{userId}`.
   - Bootstrapped admin is restricted to `request.auth.token.email == 'abrar.aslam02@gmail.com' && request.auth.token.email_verified == true` alongside trusted `/admins/{uid}` documents.
4. **PII Split Isolation**: `email` and `photoUrl` are stored exclusively in `/users/{userId}/private/{docId}` (`docId == 'info'`), readable and writable only by the owner (`request.auth.uid == userId`) or an admin (`isAdmin()`).
5. **Master Gate Relational Integrity**: A `StoreSyncNote` at `/stores/{storeId}/syncNotes/{noteId}` cannot be created or updated unless its parent `/stores/{storeId}` document exists, `storeId` matches the path parameter, `ownerUid == request.auth.uid` (or `isAdmin()`), and the parent store is `active`.
6. **Temporal Integrity & Immutable Fields**: `createdAt`, `uid`, `storeId`, and `ownerUid` cannot be forged or altered after creation; `createdAt == request.time` on create and `updatedAt == request.time` on create/update.
7. **Terminal State Locking**: Once a `StoreMeta` or `StoreSyncNote` transitions to `status == 'archived'`, non-admin updates are blocked permanently.
8. **Strict Key & Size Bounds & Safe List Queries**:
   - All document IDs match `^[a-zA-Z0-9_\-]+$` and are `<= 128` chars (`<= 64` for `storeId`).
   - All string fields enforce explicit `.size()` min/max bounds matching `firebase-blueprint.json`.
   - Every `create` uses `hasAll(...) && hasOnly(...)` and every `update` invokes `isValid[Entity](incoming())` + action-based `affectedKeys().hasOnly(...)`.
   - `allow list` never invokes `get()`/`exists()` and enforces `resource.data.ownerUid == request.auth.uid || isAdmin()`.

---

## The "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)

1. **Identity Spoofing (UID Mismatch on Profile Create)**
   - Path: `/users/victim_uid_123` (authed as `attacker_uid_999`)
   - Payload: `{ "uid": "victim_uid_123", "displayName": "Attacker", "role": "staff", "status": "active", "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`userId != request.auth.uid`).

2. **Privilege Escalation (Self-Assigned Admin Role)**
   - Path: `/users/attacker_uid_999` (authed as `attacker_uid_999`)
   - Payload: `{ "uid": "attacker_uid_999", "displayName": "Attacker", "role": "admin", "status": "active", "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`role == 'admin'` blocked for non-admin creation).

3. **Unverified Admin Email Spoof Attack**
   - Path: `/admins/spoof_uid` (authed with `email: "abrar.aslam02@gmail.com"`, `email_verified: false`)
   - Payload: `{ "uid": "spoof_uid", "email": "abrar.aslam02@gmail.com", "grantedBy": "spoof_uid", "createdAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`isVerifiedUser()` enforces `email_verified == true`).

4. **Shadow Update / Ghost Field Injection**
   - Path: `/users/user_1` (update authed as `user_1`)
   - Payload: `{ "uid": "user_1", "displayName": "Valid Name", "role": "staff", "status": "active", "createdAt": "<existing>", "updatedAt": "<request.time>", "isVerified": true }`
   - Expected: `PERMISSION_DENIED` (`keys().hasOnly(...)` & `affectedKeys().hasOnly(['displayName', 'updatedAt'])` reject `isVerified`).

5. **PII Cross-Tenant Read / Write**
   - Path: `/users/victim_uid/private/info` (`get` or `set` authed as `other_staff_uid`)
   - Payload: `{ "uid": "victim_uid", "email": "leak@example.com", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (only `request.auth.uid == userId || isAdmin()` permitted).

6. **Path Variable ID Poisoning**
   - Path: `/stores/ams-main/syncNotes/invalid$$id with spaces` (or 200-char ID)
   - Payload: `{ "storeId": "ams-main", "ownerUid": "user_1", "title": "Test", "note": "Valid", "status": "active", "recordCount": 10, "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`isValidId(noteId)` rejects invalid pattern/length).

7. **Orphaned Subcollection Write (Missing Parent Store)**
   - Path: `/stores/nonexistent-store/syncNotes/note_1` (when `/stores/nonexistent-store` does not exist)
   - Payload: `{ "storeId": "nonexistent-store", "ownerUid": "user_1", "title": "Orphan", "note": "No parent", "status": "active", "recordCount": 0, "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`exists(/databases/.../stores/$(storeId))` fails).

8. **Client Timestamp Forgery**
   - Path: `/stores/ams-main/syncNotes/note_2`
   - Payload: `{ "storeId": "ams-main", "ownerUid": "user_1", "title": "Backdated", "note": "Spoofed time", "status": "active", "recordCount": 5, "createdAt": "2020-01-01T00:00:00Z", "updatedAt": "2020-01-01T00:00:00Z" }`
   - Expected: `PERMISSION_DENIED` (`createdAt == request.time && updatedAt == request.time`).

9. **Immutable Owner Tampering on Update**
   - Path: `/stores/ams-main/syncNotes/note_3` (update changing `ownerUid`)
   - Payload: `{ "storeId": "ams-main", "ownerUid": "another_uid", "title": "Hijacked", "note": "Changed owner", "status": "active", "recordCount": 5, "createdAt": "<existing>", "updatedAt": "<request.time>" }`
   - Expected: `PERMISSION_DENIED` (`incoming().ownerUid == existing().ownerUid` & `affectedKeys().hasOnly(...)`).

10. **Terminal State Mutation (Editing Archived Sync Note as Non-Admin)**
    - Path: `/stores/ams-main/syncNotes/archived_note_4` (existing `status == 'archived'`)
    - Payload: `{ "storeId": "ams-main", "ownerUid": "user_1", "title": "Edited After Archive", "note": "Reopen", "status": "active", "recordCount": 5, "createdAt": "<existing>", "updatedAt": "<request.time>" }`
    - Expected: `PERMISSION_DENIED` (`existing().status != 'archived'` blocks non-admin mutation).

11. **Value Poisoning / Oversized Payload DoW Attack**
    - Path: `/stores/ams-main/syncNotes/note_5`
    - Payload: `{ "storeId": "ams-main", "ownerUid": "user_1", "title": "<121+ chars>", "note": "<1001+ chars>", "status": "active", "recordCount": -5, "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
    - Expected: `PERMISSION_DENIED` (`isValidSyncNote` enforces string `.size()` bounds and `recordCount >= 0`).

12. **Blanket Query Scraping (`allow list` Without Owner Scope)**
    - Operation: Unscoped `collectionGroup('syncNotes')` or `collection(db, 'stores/ams-main/syncNotes')` list query without `where('ownerUid', '==', uid)` by non-admin user.
    - Expected: `PERMISSION_DENIED` (`allow list: if isAdmin() || (isVerifiedUser() && resource.data.ownerUid == request.auth.uid)` rejects cross-owner scraping).
