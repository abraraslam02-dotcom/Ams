# Phase 0: Payload-First Security TDD (`security_spec.md`)

## 1. Data Invariants & Relationship Mapping
1. **Default-Deny Safety Net**: Every path outside explicitly matched collections (`/users/{userId}`, `/users/{userId}/private/{docId}`, `/stores/{storeId}`, `/stores/{storeId}/syncNotes/{noteId}`, `/stores/{storeId}/syncBatches/{batchId}`) is denied by `match /{document=**} { allow read, write: if false; }`.
2. **Verified Authentication Invariant**: All read and write operations require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **PII Split-Collection Invariant**: Email PII is strictly isolated in `/users/{userId}/private/info` and readable/writable only by the verified owner (`request.auth.uid == userId`) or verified admin (`abrar.aslam02@gmail.com`).
4. **Master Gate Relational Invariant**: A `SyncCheckpointNote` at `/stores/{storeId}/syncNotes/{noteId}` or a `BusinessSyncBatch` at `/stores/{storeId}/syncBatches/{batchId}` can only be read, listed, created, updated, or deleted if the parent `/stores/{storeId}` document exists and its `ownerUid == request.auth.uid` (or user is verified admin).
5. **Terminal State Locking**: Once a `StoreWorkspace`, `SyncCheckpointNote`, or `BusinessSyncBatch` reaches `status == 'archived'`, non-admin updates are permanently blocked.
6. **Temporal Integrity & Immortal Fields**: `createdAt == request.time` on create; `createdAt`, `uid`, `ownerUid`, and `storeId` are immutable on update; `updatedAt == request.time` on every write.
7. **Strict Business Batch Payload Bounds**: `BusinessSyncBatch` enforces strict schema keys (`hasAll`, `hasOnly`), `batchIndex in [0, 10000]`, `totalBatches in [1, 10000]`, `recordCount in [0, 100000]`, `recordsPayload.size() in [2, 800000]`, and `checksum.size() in [8, 128]`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)
1. **Payload 1 (Unverified Email Spoof)**: `auth: { uid: 'u1', token: { email: 'abrar.aslam02@gmail.com', email_verified: false } }` attempting write to `/stores/store_1`.
2. **Payload 2 (Identity Spoofing on Create)**: Authenticated `uid: 'u1'` writing `/stores/store_1` with `{ ownerUid: 'u2', ... }`.
3. **Payload 3 (Shadow/Ghost Field Injection)**: Creating `/users/u1` with `{ uid: 'u1', displayName: 'Abrar', storeName: 'AMS', isAdmin: true, createdAt: request.time, updatedAt: request.time }`.
4. **Payload 4 (Path Variable ID Poisoning)**: Creating `/stores/invalid$id!with spaces` (fails `isValidId`).
5. **Payload 5 (Orphaned Subcollection Write)**: Creating `/stores/non_existent_store/syncBatches/batch_1` when parent `/stores/non_existent_store` does not exist.
6. **Payload 6 (Cross-Tenant Subcollection Write)**: User `u2` creating `/stores/store_owned_by_u1/syncBatches/batch_1`.
7. **Payload 7 (PII Leak Across Users)**: Authenticated user `u2` attempting `get` on `/users/u1/private/info`.
8. **Payload 8 (Blanket List Scraping)**: Authenticated user `u2` attempting `list` on `/stores/store_1/syncBatches` where `resource.data.ownerUid != 'u2'`.
9. **Payload 9 (Terminal State Bypass)**: Non-admin owner attempting `update` on `/stores/store_1/syncBatches/batch_1` after `existing().status == 'archived'`.
10. **Payload 10 (Immortal Field Mutation)**: Owner attempting `update` on `/stores/store_1/syncBatches/batch_1` that changes `ownerUid` or `createdAt`.
11. **Payload 11 (Value Poisoning on Whitelisted Update Key)**: Owner updating `/stores/store_1/syncNotes/note_1` with `note` exceeding 600 chars or non-string type.
12. **Payload 12 (Forged Client Timestamp)**: Creating `/stores/store_1/syncBatches/batch_1` with `createdAt` not equal to `request.time`.
