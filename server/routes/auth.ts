import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import {
  ensureAuthTables,
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  getUserByUsername,
  getUserById,
  getUserPermissions,
  saveUserPermissions,
  initializeUserPermissions,
  logAuditEvent,
  initiateForgotPassword,
  verifyAndResetPassword,
  getSuperAdminRecoveryEmail,
  PERMISSION_MODULES,
} from '../services/authService.ts';
import type { UserRecord } from '../services/authService.ts';
import {
  authenticateToken,
  requireRole,
  extractToken,
  SESSION_COOKIE_NAME,
} from '../middleware/authMiddleware.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';

export const authRouter = Router();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function getUserAgent(req: Request): string {
  return (req.headers['user-agent'] as string) || 'Unknown Client';
}

function isSecureRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  return Boolean(req.secure || proto.includes('https') || origin.startsWith('https://'));
}

function setSessionCookie(req: Request, res: Response, token: string, rememberMe: boolean): void {
  const secure = isSecureRequest(req);
  const options: Record<string, any> = {
    httpOnly: true,
    path: '/',
    sameSite: secure ? 'none' : 'lax',
    secure,
  };
  if (rememberMe) {
    // Persistent cookie for 30 days across browser restarts
    options.maxAge = 30 * 24 * 60 * 60 * 1000;
  }
  // When rememberMe is false, omit maxAge and expires so it stays a true browser session cookie
  res.cookie(SESSION_COOKIE_NAME, token, options);
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: secure ? 'none' : 'lax',
    secure,
  });
}

/**
 * GET /api/auth/status
 * Public endpoint to check system initialization and current session validity
 */
authRouter.get('/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    ensureAuthTables(db);

    const token = extractToken(req);

    if (token) {
      const validation = validateSession(db, token);
      if (validation.valid && validation.user) {
        return res.json({
          initialized: true,
          authenticated: true,
          rememberMe: Boolean(validation.rememberMe),
          user: validation.user,
          permissions: validation.permissions,
        });
      }
      // Clear expired or invalid cookie so stale cookies do not linger
      clearSessionCookie(req, res);
    }

    return res.json({
      initialized: true,
      authenticated: false,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Auth status check failed: ${errorMsg}` });
  }
});

/**
 * GET /api/auth/me
 * Authenticated user profile and permissions check
 */
authRouter.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    success: true,
    user: req.user,
    permissions: req.permissions,
  });
});

/**
 * POST /api/auth/login
 * User login with credentials, lockout protection, and secure session creation
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const db = getDatabase();
  ensureAuthTables(db);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { username, password, remember_me } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please enter both username/email and password',
      });
    }

    const cleanUsername = String(username).trim();
    const user = getUserByUsername(db, cleanUsername);

    if (!user) {
      logAuditEvent(db, {
        username: cleanUsername,
        action: 'LOGIN_FAILURE',
        status: 'FAILED',
        ipAddress: ip,
        userAgent,
        details: 'Login attempt for non-existent username/email',
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid username/email or password',
      });
    }

    // Check account status
    if (user.status !== 'Active') {
      logAuditEvent(db, {
        userId: user.id,
        username: user.username,
        action: 'LOGIN_BLOCKED',
        status: 'WARNING',
        ipAddress: ip,
        userAgent,
        details: `Login blocked because account is ${user.status}`,
      });

      return res.status(403).json({
        success: false,
        error: `Your account is currently ${user.status.toLowerCase()}. Please contact the Super Administrator.`,
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Check temporary lockout
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until.replace(' ', 'T') + 'Z');
      const now = new Date();
      if (lockExpiry > now) {
        const remainingMinutes = Math.ceil((lockExpiry.getTime() - now.getTime()) / 60000);
        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'LOGIN_LOCKED',
          status: 'WARNING',
          ipAddress: ip,
          userAgent,
          details: `Login attempted on locked account (${remainingMinutes}m remaining)`,
        });

        return res.status(423).json({
          success: false,
          error: `Account temporarily locked due to repeated failed attempts. Try again in ${remainingMinutes} minute(s).`,
          locked: true,
          remainingMinutes,
        });
      } else {
        // Lockout expired, reset attempts
        db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
        user.failed_login_attempts = 0;
        user.locked_until = null;
      }
    }

    // Verify password
    const passwordValid = verifyPassword(String(password), user.salt, user.password_hash);

    if (!passwordValid) {
      const newAttempts = user.failed_login_attempts + 1;

      if (newAttempts >= 5) {
        db.prepare(
          "UPDATE users SET failed_login_attempts = ?, locked_until = datetime('now', '+15 minutes') WHERE id = ?"
        ).run(newAttempts, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'ACCOUNT_LOCKED',
          status: 'WARNING',
          ipAddress: ip,
          userAgent,
          details: 'Account locked for 15 minutes after 5 consecutive failed attempts',
        });

        return res.status(423).json({
          success: false,
          error: 'Account locked for 15 minutes due to 5 consecutive failed login attempts.',
          locked: true,
          remainingMinutes: 15,
        });
      } else {
        db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(newAttempts, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'LOGIN_FAILURE',
          status: 'FAILED',
          ipAddress: ip,
          userAgent,
          details: `Incorrect password attempt ${newAttempts}/5`,
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid username/email or password',
          attemptsRemaining: 5 - newAttempts,
        });
      }
    }

    // Reset failed attempts & record successful login
    db.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login = datetime('now'),
          last_login_ip = ?
      WHERE id = ?
    `).run(ip, user.id);

    const rememberMe = Boolean(remember_me);
    const session = createSession(db, user.id, rememberMe, ip, userAgent);
    setSessionCookie(req, res, session.token, rememberMe);

    logAuditEvent(db, {
      userId: user.id,
      username: user.username,
      action: 'LOGIN_SUCCESS',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      details: `Successful login as ${user.role} (remember_me=${rememberMe ? '1' : '0'})`,
    });

    const safeUser = getUserById(db, user.id);
    const permissions = getUserPermissions(db, user.id, user.role);

    return res.json({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      expiresAt: session.expiresAt,
      rememberMe,
      user: safeUser,
      permissions,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Login error: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/logout
 * Destroys server-side session token
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const token = extractToken(req) || '';

    if (token) {
      const session = db
        .prepare('SELECT s.user_id, u.username FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ?')
        .get(token) as { user_id: number; username: string } | undefined;

      destroySession(db, token);

      if (session) {
        logAuditEvent(db, {
          userId: session.user_id,
          username: session.username,
          action: 'LOGOUT',
          status: 'SUCCESS',
          ipAddress: ip,
          userAgent,
          details: 'Session terminated voluntarily by user',
        });
      }
    }

    clearSessionCookie(req, res);

    return res.json({
      success: true,
      message: 'You have been logged out successfully.',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Logout error: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/forgot-password
 * Step 1: Generates 6-digit verification code and emails to Super Admin
 */
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const targetUser = req.body.username || req.body.identifier || req.body.email || req.body.usernameOrEmail;

  try {
    const result = await initiateForgotPassword(db, String(targetUser || ''), ip, userAgent);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Password recovery request failed: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/reset-password
 * Step 2: Validates Super Admin verification code and sets new user password
 */
authRouter.post('/reset-password', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const username = req.body.username || req.body.identifier || req.body.email;
  const code = req.body.code || req.body.verification_code || req.body.verificationCode;
  const new_password = req.body.new_password || req.body.newPassword || req.body.password;

  try {
    const result = verifyAndResetPassword(
      db,
      String(username || ''),
      String(code || ''),
      String(new_password || ''),
      ip,
      userAgent
    );

    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Password reset failed: ${errorMsg}` });
  }
});

/**
 * GET /api/auth/permissions/modules
 * Super Admin & Staff: Get permission modules metadata
 */
authRouter.get('/permissions/modules', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    modules: PERMISSION_MODULES,
  });
});

/**
 * GET /api/auth/recovery-email
 * Super Admin only: Get configured recovery email
 */
authRouter.get('/recovery-email', authenticateToken, requireRole(['Super Admin']), (_req: AuthenticatedRequest, res: Response) => {
  const db = getDatabase();
  const email = getSuperAdminRecoveryEmail(db);
  return res.json({ success: true, email });
});

/**
 * PUT /api/auth/recovery-email
 * Super Admin only: Configure recovery email
 */
authRouter.put('/recovery-email', authenticateToken, requireRole(['Super Admin']), (req: AuthenticatedRequest, res: Response) => {
  const db = getDatabase();
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
  }

  const clean = email.trim();
  db.prepare(`
    UPDATE company_settings
    SET super_admin_recovery_email = ?
    WHERE id = (SELECT id FROM company_settings LIMIT 1)
  `).run(clean);

  logAuditEvent(db, {
    userId: req.user?.id,
    username: req.user?.username || 'Super Admin',
    action: 'RECOVERY_EMAIL_CONFIGURED',
    status: 'SUCCESS',
    details: `Super Admin password recovery email updated to: ${clean}`,
  });

  return res.json({
    success: true,
    message: 'Super Admin password recovery email address updated successfully',
    email: clean,
  });
});

/**
 * GET /api/auth/users
 * Super Admin only: List all staff users with individual permissions
 */
authRouter.get(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      ensureAuthTables(db);
      const users = db
        .prepare(`
          SELECT id, username, full_name, email, phone, role, status,
                 failed_login_attempts, locked_until, last_login, last_login_ip, notes,
                 created_at, updated_at
          FROM users
          ORDER BY CASE WHEN role = 'Super Admin' THEN 0 ELSE 1 END, id ASC
        `)
        .all() as UserRecord[];

      const userList = users.map((u) => ({
        ...u,
        permissions: getUserPermissions(db, u.id, u.role),
      }));

      return res.json({
        success: true,
        users: userList,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch users: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users
 * Super Admin only: Create a new user with individual permissions
 */
authRouter.post(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const { full_name, username, email, phone, password, status, permissions } = req.body;

      if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Full Name is required (min 2 characters)' });
      }

      if (!username || typeof username !== 'string' || username.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
      }

      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      }

      const cleanUsername = username.trim();
      const existingUser = getUserByUsername(db, cleanUsername);
      if (existingUser) {
        return res.status(409).json({ success: false, error: `Username "${cleanUsername}" is already taken.` });
      }

      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
      if (cleanEmail) {
        const emailExists = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
        if (emailExists) {
          return res.status(409).json({ success: false, error: `Email "${cleanEmail}" is already registered.` });
        }
      }

      const cleanPhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null;
      const userStatus = status === 'Inactive' ? 'Inactive' : 'Active';
      const ALLOWED_NON_ADMIN_ROLES = ['Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      const role = req.body.role && ALLOWED_NON_ADMIN_ROLES.includes(req.body.role) ? req.body.role : 'Viewer';

      const { hash, salt } = hashPassword(password);

      const result = db
        .prepare(`
          INSERT INTO users (
            username, full_name, email, phone, password_hash, salt,
            role, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          cleanUsername,
          full_name.trim(),
          cleanEmail,
          cleanPhone,
          hash,
          salt,
          role,
          userStatus,
          req.body.notes ? String(req.body.notes).trim() : null
        );

      const newId = Number(result.lastInsertRowid);

      // Save individual permissions
      initializeUserPermissions(db, newId, permissions);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_CREATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Created user @${cleanUsername} (${full_name.trim()})`,
      });

      const created = getUserById(db, newId);
      const savedPerms = getUserPermissions(db, newId, role);

      return res.status(201).json({
        success: true,
        message: `User @${cleanUsername} created successfully`,
        user: {
          ...created,
          permissions: savedPerms,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to create user: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id
 * Super Admin only: Update user details & individual permissions
 */
authRouter.put(
  '/users/:id',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { full_name, email, phone, status, notes, permissions } = req.body;

      // Check unique email if changed
      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
      if (cleanEmail && cleanEmail !== targetUser.email) {
        const emailExists = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(cleanEmail, id);
        if (emailExists) {
          return res.status(409).json({ success: false, error: `Email "${cleanEmail}" is already in use by another user.` });
        }
      }

      const cleanPhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null;
      let newStatus = targetUser.status;
      if (status && ['Active', 'Inactive'].includes(status)) {
        // Prevent deactivating self if Super Admin
        if (status === 'Inactive' && targetUser.role === 'Super Admin') {
          return res.status(400).json({ success: false, error: 'Cannot deactivate the primary Super Admin account.' });
        }
        newStatus = status;
      }

      db.prepare(`
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            email = ?,
            phone = ?,
            status = ?,
            notes = COALESCE(?, notes),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        full_name ? full_name.trim() : targetUser.full_name,
        cleanEmail,
        cleanPhone,
        newStatus,
        notes !== undefined ? (notes ? notes.trim() : null) : targetUser.notes,
        id
      );

      // Update individual permissions if provided (Super Admin permissions cannot be modified)
      if (permissions && targetUser.role !== 'Super Admin') {
        saveUserPermissions(db, id, permissions);
      }

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_UPDATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Updated details and permissions for user @${targetUser.username}`,
      });

      const updated = getUserById(db, id);
      const updatedPerms = getUserPermissions(db, id, targetUser.role);

      return res.json({
        success: true,
        message: 'User details updated successfully',
        user: {
          ...updated,
          permissions: updatedPerms,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update user: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/users/:id/permissions
 * Super Admin: Get user permissions
 */
authRouter.get(
  '/users/:id/permissions',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);
    const targetUser = getUserById(db, id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const perms = getUserPermissions(db, id, targetUser.role);
    return res.json({ success: true, permissions: perms });
  }
);

/**
 * PUT /api/auth/users/:id/permissions
 * Super Admin: Save individual permissions
 */
authRouter.put(
  '/users/:id/permissions',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);
    const targetUser = getUserById(db, id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (targetUser.role === 'Super Admin') {
      return res.status(400).json({ success: false, error: 'Super Admin permissions cannot be modified.' });
    }
    const perms = req.body.permissions || {};
    saveUserPermissions(db, id, perms);
    const updatedPerms = getUserPermissions(db, id, targetUser.role);
    return res.json({ success: true, message: 'Permissions saved successfully', permissions: updatedPerms });
  }
);

/**
 * PUT /api/auth/users/:id/status
 * Super Admin only: Activate or deactivate user
 */
authRouter.put(
  '/users/:id/status',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (targetUser.role === 'Super Admin' && status === 'Inactive') {
        return res.status(400).json({ success: false, error: 'Cannot deactivate Super Admin account.' });
      }

      if (!['Active', 'Inactive'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be Active or Inactive' });
      }

      db.prepare(`
        UPDATE users
        SET status = ?,
            failed_login_attempts = CASE WHEN ? = 'Active' THEN 0 ELSE failed_login_attempts END,
            locked_until = CASE WHEN ? = 'Active' THEN NULL ELSE locked_until END,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, status, status, id);

      // If deactivated, revoke active sessions
      if (status === 'Inactive') {
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_STATUS_TOGGLED',
        status: 'SUCCESS',
        details: `Changed user @${targetUser.username} status to ${status}`,
      });

      return res.json({
        success: true,
        message: `User status changed to ${status}`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update user status: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/reset-password
 * Super Admin only: Directly reset user password
 */
authRouter.put(
  '/users/:id/reset-password',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
        return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
      }

      const { hash, salt } = hashPassword(new_password);

      db.prepare(`
        UPDATE users
        SET password_hash = ?,
            salt = ?,
            failed_login_attempts = 0,
            locked_until = NULL,
            password_changed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, salt, id);

      // Invalidate active sessions
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'SUPER_ADMIN_PASSWORD_RESET',
        status: 'SUCCESS',
        details: `Super Admin reset password for user @${targetUser.username}`,
      });

      return res.json({
        success: true,
        message: `Password for @${targetUser.username} has been reset successfully.`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to reset password: ${errorMsg}` });
    }
  }
);

/**
 * DELETE /api/auth/users/:id
 * Super Admin only: Delete user account
 */
authRouter.delete(
  '/users/:id',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureAuthTables(db);
    const id = parseInt(req.params.id, 10);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (targetUser.role === 'Super Admin') {
        return res.status(400).json({ success: false, error: 'Cannot delete the Super Admin account.' });
      }

      const deleteTx = db.transaction(() => {
        db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM password_recovery_codes WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      });

      deleteTx();

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_DELETED',
        status: 'SUCCESS',
        details: `Deleted user @${targetUser.username} (${targetUser.full_name})`,
      });

      return res.json({
        success: true,
        message: `User @${targetUser.username} was deleted successfully.`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to delete user: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/audit-logs
 * Super Admin only: View authentication and security audit trail
 */
authRouter.get(
  '/audit-logs',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      ensureAuthTables(db);
      const limit = Math.min(200, parseInt(req.query.limit as string, 10) || 50);

      const logs = db
        .prepare('SELECT * FROM auth_audit_logs ORDER BY id DESC LIMIT ?')
        .all(limit);

      return res.json({
        success: true,
        logs,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch audit logs: ${errorMsg}` });
    }
  }
);
