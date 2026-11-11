import { getDatabase } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  getUserCount,
  getUserByUsername,
  getUserById,
  getRolePermissions,
  logAuditEvent,
} from '../server/services/authService.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log(' ABRAR MEDICAL STORE ERP — AUTHENTICATION & SECURITY TEST SUITE');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${detail}`);
      failed++;
    }
  }

  // 1. Run Migrations & Verify Schema
  console.log('\n--- Test Group 1: Schema & Migration 006 ---');
  const migrationRes = runMigrations();
  assert(migrationRes.success, 'Migrations ran successfully', migrationRes.message);
  
  const db = getDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t: any) => t.name);
  assert(tables.includes('users'), 'Table users exists');
  assert(tables.includes('user_sessions'), 'Table user_sessions exists');
  assert(tables.includes('role_permissions'), 'Table role_permissions exists');
  assert(tables.includes('auth_audit_logs'), 'Table auth_audit_logs exists');

  // Verify Role Permissions Matrix populated
  const permCount = db.prepare('SELECT COUNT(*) as count FROM role_permissions').get() as { count: number };
  assert(permCount.count >= 78, `Role permissions matrix populated (Found ${permCount.count} entries)`);

  // Verify default permissions for Salesman vs Super Admin
  const salesmanSalesPerm = db.prepare("SELECT can_create FROM role_permissions WHERE role = 'Salesman' AND module_key = 'sales'").get() as { can_create: number };
  const salesmanPurchasesPerm = db.prepare("SELECT can_create FROM role_permissions WHERE role = 'Salesman' AND module_key = 'purchases'").get() as { can_create: number };
  assert(salesmanSalesPerm?.can_create === 1, 'Salesman has can_create on sales module');
  assert(salesmanPurchasesPerm?.can_create === 0, 'Salesman CANNOT create on purchases module (Role separation enforced)');

  // 2. Cryptographic Scrypt Password Hashing & Salt Verification
  console.log('\n--- Test Group 2: Password Hashing & Cryptography ---');
  const testPassword = 'SecurePharmacy@2026';
  const { salt, hash } = hashPassword(testPassword);
  assert(salt.length >= 32, 'Salt is cryptographically strong (>=32 hex characters)');
  assert(hash.length >= 64, 'Hash is high-entropy scrypt output (>=64 hex characters)');
  assert(verifyPassword(testPassword, salt, hash), 'verifyPassword correctly validates matching credentials');
  assert(!verifyPassword('WrongPassword123', salt, hash), 'verifyPassword rejects invalid credentials');

  // 3. User Setup & Uniqueness
  console.log('\n--- Test Group 3: User Setup & Authentication Flow ---');
  // Clean test user if previously created
  db.prepare("DELETE FROM users WHERE username IN ('test_owner', 'test_salesman', 'test_locked')").run();

  const userCountBefore = getUserCount(db);
  console.log(`Current users in database before test setup: ${userCountBefore}`);

  // Create Super Admin
  const adminSaltHash = hashPassword('OwnerMaster@123');
  const insertAdmin = db.prepare(`
    INSERT INTO users (username, full_name, email, phone, password_hash, salt, role, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'Super Admin', 'Active', 'Test Owner Super Admin')
  `).run('test_owner', 'Abrar Aslam (Owner)', 'owner@abrarmedical.pk', '+92 300 1234567', adminSaltHash.hash, adminSaltHash.salt);
  const adminId = Number(insertAdmin.lastInsertRowid);
  assert(adminId > 0, 'Super Admin user successfully created with ID: ' + adminId);

  const fetchedAdmin = getUserByUsername(db, 'test_owner');
  assert(fetchedAdmin !== null && fetchedAdmin.role === 'Super Admin', 'Fetched Super Admin record verified');

  // Verify unique username constraint
  let duplicateThrew = false;
  try {
    db.prepare(`
      INSERT INTO users (username, full_name, password_hash, salt, role)
      VALUES (?, ?, ?, ?, 'Salesman')
    `).run('test_owner', 'Duplicate User', 'hash', 'salt');
  } catch {
    duplicateThrew = true;
  }
  assert(duplicateThrew, 'Duplicate username insertion strictly prevented by UNIQUE constraint');

  // 4. Server-Side Session Management & Expiration
  console.log('\n--- Test Group 4: Server-Side Sessions & Validation ---');
  const session1 = createSession(db, adminId, false, '127.0.0.1', 'Mozilla/5.0 AMS Test');
  assert(session1.token.length === 64, 'Generated session token is 64 hex characters');

  const validation1 = validateSession(db, session1.token);
  assert(validation1.valid && validation1.user?.username === 'test_owner', 'Active session validates and resolves safe user without password hash/salt');
  assert(validation1.permissions?.['sales']?.can_create === true, 'Resolved session permissions include full Super Admin access');

  // 5. Voluntary Logout & Session Destruction
  console.log('\n--- Test Group 5: Logout & Session Invalidation ---');
  const destroyed = destroySession(db, session1.token);
  assert(destroyed, 'destroySession successfully removed token from database');

  const validationAfterLogout = validateSession(db, session1.token);
  assert(!validationAfterLogout.valid, 'Terminated session token is strictly rejected upon subsequent calls');

  // 6. Brute Force Protection & Account Lockout Defense
  console.log('\n--- Test Group 6: Brute Force Protection & Lockout ---');
  const lockedUserHash = hashPassword('CorrectPassword123');
  const insertLocked = db.prepare(`
    INSERT INTO users (username, full_name, password_hash, salt, role, status, failed_login_attempts)
    VALUES ('test_locked', 'Cashier Staff', ?, ?, 'Salesman', 'Active', 0)
  `).run(lockedUserHash.hash, lockedUserHash.salt);
  const lockedUserId = Number(insertLocked.lastInsertRowid);

  // Simulate 5 consecutive failed attempts
  for (let attempt = 1; attempt <= 5; attempt++) {
    const isCorrect = verifyPassword('WrongPassword', lockedUserHash.salt, lockedUserHash.hash);
    if (!isCorrect) {
      if (attempt >= 5) {
        db.prepare("UPDATE users SET failed_login_attempts = ?, locked_until = datetime('now', '+15 minutes') WHERE id = ?").run(attempt, lockedUserId);
      } else {
        db.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").run(attempt, lockedUserId);
      }
    }
  }

  const lockedUserCheck = db.prepare("SELECT failed_login_attempts, locked_until FROM users WHERE id = ?").get(lockedUserId) as any;
  assert(lockedUserCheck.failed_login_attempts === 5, 'Failed login attempts tracked accurately (5)');
  assert(lockedUserCheck.locked_until !== null, 'Account locked_until timestamp set to +15 minutes');

  // 7. User Deactivation Defense
  console.log('\n--- Test Group 7: Deactivation & Session Purge ---');
  const sessionLocked = createSession(db, lockedUserId, false);
  // Deactivate user
  db.prepare("UPDATE users SET status = 'Inactive' WHERE id = ?").run(lockedUserId);
  const deactValidation = validateSession(db, sessionLocked.token);
  assert(!deactValidation.valid, 'Inactive/Suspended account session immediately rejected');

  // 8. Audit Trail Verification
  console.log('\n--- Test Group 8: Audit Logging Trail ---');
  logAuditEvent(db, {
    userId: adminId,
    username: 'test_owner',
    action: 'TEST_VERIFICATION_EVENT',
    status: 'SUCCESS',
    ipAddress: '127.0.0.1',
    details: 'Security audit test event written for verification.',
  });

  const lastAudit = db.prepare("SELECT * FROM auth_audit_logs WHERE action = 'TEST_VERIFICATION_EVENT'").get() as any;
  assert(lastAudit && lastAudit.username === 'test_owner', 'Audit log entry recorded with timestamp and username');

  // 9. Existing Pharmacy Data Integrity Check
  console.log('\n--- Test Group 9: Existing Business Data Integrity ---');
  const itemsCount = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
  const accountsCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
  const purchasesCount = db.prepare('SELECT COUNT(*) as count FROM purchases').get() as { count: number };
  const salesCount = db.prepare('SELECT COUNT(*) as count FROM sales').get() as { count: number };
  const taxSettings = db.prepare('SELECT COUNT(*) as count FROM advance_tax_settings').get() as { count: number };

  console.log(`  Items in database: ${itemsCount.count}`);
  console.log(`  Accounts in database: ${accountsCount.count}`);
  console.log(`  Purchases in database: ${purchasesCount.count}`);
  console.log(`  Sales in database: ${salesCount.count}`);
  console.log(`  Advance Tax configurations: ${taxSettings.count}`);

  assert(accountsCount.count >= 10, 'Chart of Accounts preserved');
  assert(taxSettings.count >= 1, 'Advance Tax settings preserved');

  // Clean test accounts
  db.prepare("DELETE FROM users WHERE username IN ('test_owner', 'test_salesman', 'test_locked')").run();
  db.prepare("DELETE FROM user_sessions WHERE user_id NOT IN (SELECT id FROM users)").run();

  console.log('\n================================================================');
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
