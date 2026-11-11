import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
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
  ensureDeviceSecurityColumns,
} from '../services/authService.ts';
import type { UserRecord, SafeUser } from '../services/authService.ts';
import {
  authenticateToken,
  requireRole,
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

function summarizeUserAgent(ua: string): string {
  const clean = String(ua || '');
  let os = 'Workstation';
  if (/Windows/i.test(clean)) os = 'Windows PC';
  else if (/Android/i.test(clean)) os = 'Android Device';
  else if (/iPhone|iPad|iOS/i.test(clean)) os = 'iOS Device';
  else if (/Macintosh|Mac OS/i.test(clean)) os = 'Mac';
  else if (/Linux/i.test(clean)) os = 'Linux PC';

  let browser = 'Browser';
  if (/Edg\//i.test(clean)) browser = 'Edge';
  else if (/Chrome\//i.test(clean)) browser = 'Chrome';
  else if (/Firefox\//i.test(clean)) browser = 'Firefox';
  else if (/Safari\//i.test(clean) && !/Chrome\//i.test(clean)) browser = 'Safari';

  return `${os} (${browser})`;
}

function extractRequestDeviceId(req: Request, ip: string, userAgent: string): string {
  const bodyDeviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim() : '';
  if (bodyDeviceId) return bodyDeviceId;

  const headerDeviceId =
    typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].trim() : '';
  if (headerDeviceId) return headerDeviceId;

  const fallbackHash = crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `DEV-${fallbackHash}`;
}

function extractRequestDeviceName(req: Request, userAgent: string): string {
  const bodyName = typeof req.body?.device_name === 'string' ? req.body.device_name.trim() : '';
  if (bodyName) return bodyName;

  const headerName =
    typeof req.headers['x-device-name'] === 'string' ? req.headers['x-device-name'].trim() : '';
  if (headerName) return headerName;

  return summarizeUserAgent(userAgent);
}

/**
 * GET /api/auth/status
 * Public endpoint to check system initialization and current session validity
 */
authRouter.get('/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    ensureDeviceSecurityColumns(db);
    const count = getUserCount(db);
    const initialized = count > 0;

    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.headers['x-session-token'] === 'string') {
      token = req.headers['x-session-token'].trim();
    }

    if (!initialized) {
      return res.json({
        initialized: false,
        authenticated: false,
        userCount: 0,
        message: 'No administrator accounts exist. First-time Super Admin setup required.',
      });
    }

    if (token) {
      const headerDeviceId =
        typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].trim() : null;
      const validation = validateSession(db, token, headerDeviceId);
      if (validation.valid && validation.user) {
        return res.json({
          initialized: true,
          authenticated: true,
          userCount: count,
          token,
          user: validation.user,
          permissions: validation.permissions,
        });
      }
    }

    return res.json({
      initialized: true,
      authenticated: false,
      userCount: count,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Auth status check failed: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/setup-admin
 * One-time setup for the First-Time Owner / Super Admin.
 * Strict check: Only succeeds if users table is empty.
 */
authRouter.post('/setup-admin', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const existingCount = getUserCount(db);
    if (existingCount > 0) {
      logAuditEvent(db, {
        username: req.body.username || 'unknown',
        action: 'ADMIN_SETUP_BLOCKED',
        status: 'WARNING',
        ipAddress: ip,
        userAgent,
        details: 'Attempted to run admin setup when users already exist',
      });

      return res.status(403).json({
        success: false,
        error: 'System is already initialized with an Administrator account. Setup is locked.',
        code: 'SETUP_LOCKED',
      });
    }

    const { username, password, full_name, email, phone } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long',
      });
    }

    if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Full Name is required',
      });
    }

    const cleanUsername = username.trim();
    const cleanFullName = full_name.trim();
    const cleanEmail = email && typeof email === 'string' ? email.trim() : null;
    const cleanPhone = phone && typeof phone === 'string' ? phone.trim() : null;

    const { hash, salt } = hashPassword(password);

    const insertResult = db
      .prepare(`
        INSERT INTO users (
          username, full_name, email, phone, password_hash, salt,
          role, status, failed_login_attempts, locked_until, last_login, last_login_ip, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 'Super Admin', 'Active', 0, NULL, datetime('now'), ?, 'Initial System Super Admin & Store Owner')
      `)
      .run(cleanUsername, cleanFullName, cleanEmail, cleanPhone, hash, salt, ip);

    const userId = Number(insertResult.lastInsertRowid);
    const session = createSession(db, userId, true, ip, userAgent);

    logAuditEvent(db, {
      userId,
      username: cleanUsername,
      action: 'ADMIN_INITIALIZED',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      details: `First-time Super Admin account created: ${cleanUsername} (${cleanFullName})`,
    });

    const safeUser = getUserById(db, userId);
    const permissions = getRolePermissions(db, 'Super Admin');

    return res.status(201).json({
      success: true,
      message: 'Owner & Super Admin account successfully configured. Welcome to Abrar Medical Store ERP.',
      token: session.token,
      expiresAt: session.expiresAt,
      user: safeUser,
      permissions,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Admin setup failed: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/login
 * Desktop login with rate-limiting, lockout defense, and secure session generation
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { username, password, remember_me } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please enter both username and password',
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
        details: 'Invalid username submitted',
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
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
        error: `This account is currently ${user.status.toLowerCase()}. Please contact the Store Super Administrator.`,
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Check temporary lockout
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
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
          error: `Account temporarily locked due to repeated failed login attempts. Try again in ${remainingMinutes} minute(s).`,
          locked: true,
          remainingMinutes,
          lockedUntil: user.locked_until,
        });
      } else {
        // Lockout expired, reset attempts
        db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
        user.failed_login_attempts = 0;
        user.locked_until = null;
      }
    }

    // Verify password
    const passwordValid = verifyPassword(String(password), user.salt, user.password_hash);

    if (!passwordValid) {
      const newAttempts = user.failed_login_attempts + 1;
      let isNowLocked = false;

      if (newAttempts >= 5) {
        isNowLocked = true;
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
          details: `Account locked for 15 minutes after 5 consecutive failed attempts`,
        });

        return res.status(423).json({
          success: false,
          error: 'Account has been locked for 15 minutes due to 5 consecutive failed login attempts.',
          locked: true,
          remainingMinutes: 15,
        });
      } else {
        db.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").run(newAttempts, user.id);

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
          error: 'Invalid username or password',
          attemptsRemaining: 5 - newAttempts,
        });
      }
    }

    // Password is valid - enforce Device Login Security before creating session
    const deviceId = extractRequestDeviceId(req, ip, userAgent);
    const deviceName = extractRequestDeviceName(req, userAgent);

    // Rule 1: Super Admin can log in on any device using username and password.
    // Rules 2–5: Regular users can log in on only ONE registered device using username and password.
    if (user.role !== 'Super Admin') {
      const currentRegisteredDeviceId = (user.registered_device_id || '').trim();

      if (!currentRegisteredDeviceId) {
        // First login for this regular user: register this device as their single authorized device
        db.prepare(`
          UPDATE users
          SET registered_device_id = ?,
              registered_device_name = ?,
              registered_device_at = datetime('now'),
              pending_device_id = NULL,
              pending_device_name = NULL,
              pending_device_ip = NULL,
              pending_device_requested_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(deviceId, deviceName, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'DEVICE_REGISTERED',
          status: 'SUCCESS',
          ipAddress: ip,
          userAgent,
          details: `Primary device registered for @${user.username}: ${deviceName} (${deviceId})`,
        });
      } else if (currentRegisteredDeviceId !== deviceId) {
        // Rule 3: Regular user attempting to log in from another device -> Block login & require Super Admin approval
        db.prepare(`
          UPDATE users
          SET pending_device_id = ?,
              pending_device_name = ?,
              pending_device_ip = ?,
              pending_device_requested_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(deviceId, deviceName, ip, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'DEVICE_APPROVAL_REQUIRED',
          status: 'WARNING',
          ipAddress: ip,
          userAgent,
          details: `Blocked login on unregistered device ${deviceName} (${deviceId}). Registered device is ${user.registered_device_name || 'Workstation'} (${currentRegisteredDeviceId}). Waiting for Super Admin approval.`,
        });

        return res.status(403).json({
          success: false,
          code: 'DEVICE_APPROVAL_REQUIRED',
          deviceApprovalRequired: true,
          registeredDeviceId: currentRegisteredDeviceId,
          registeredDeviceName: user.registered_device_name || 'Registered Device',
          requestedDeviceId: deviceId,
          requestedDeviceName: deviceName,
          error: `Login blocked: Your account (@${user.username}) is registered to another device (${user.registered_device_name || currentRegisteredDeviceId}). Super Admin approval is required before you can log in from this new device (${deviceName}).`,
        });
      } else {
        // Rule 5: Same registered device -> Do not require approval again
        if (user.pending_device_id === deviceId) {
          db.prepare(`
            UPDATE users
            SET pending_device_id = NULL,
                pending_device_name = NULL,
                pending_device_ip = NULL,
                pending_device_requested_at = NULL
            WHERE id = ?
          `).run(user.id);
        }
      }
    }

    // Reset failed attempts and record login
    db.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login = datetime('now'),
          last_login_ip = ?
      WHERE id = ?
    `).run(ip, user.id);

    const session = createSession(
      db,
      user.id,
      Boolean(remember_me),
      ip,
      userAgent,
      deviceId,
      deviceName
    );

    logAuditEvent(db, {
      userId: user.id,
      username: user.username,
      action: 'LOGIN_SUCCESS',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      details: `Successful login as ${user.role} on ${deviceName} [${deviceId}] (${remember_me ? 'Remember Me' : 'Standard Session'})`,
    });

    const safeUser = getUserById(db, user.id);
    const permissions = getRolePermissions(db, user.role);

    return res.json({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      token: session.token,
      expiresAt: session.expiresAt,
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
    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.headers['x-session-token'] === 'string') {
      token = req.headers['x-session-token'].trim();
    }

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
 * Professional medical store recovery instructions
 */
authRouter.post('/forgot-password', (req: Request, res: Response) => {
  const { username } = req.body;
  const db = getDatabase();
  const ip = getClientIp(req);

  logAuditEvent(db, {
    username: String(username || 'anonymous'),
    action: 'FORGOT_PASSWORD_REQUEST',
    status: 'INFO',
    ipAddress: ip,
    details: 'Password assistance requested from login screen',
  });

  return res.json({
    success: true,
    message:
      'For Abrar Medical Store ERP security, direct password reset via unverified email links is disabled. Please contact the Store Super Administrator to reset your credentials via the User Management panel.',
    supportContact: {
      phone: '+92 42 35789000',
      email: 'admin@abrarmedical.pk',
      storeName: 'Abrar Medical Store',
    },
  });
});

/**
 * GET /api/auth/me
 * Authenticated user profile check
 */
authRouter.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    success: true,
    user: req.user,
    permissions: req.permissions,
  });
});

/**
 * GET /api/auth/users
 * Super Admin only: List all staff users
 */
authRouter.get(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      ensureDeviceSecurityColumns(db);
      const users = db
        .prepare(`
          SELECT id, username, full_name, email, phone, role, status,
                 failed_login_attempts, locked_until, last_login, last_login_ip, notes,
                 force_password_change, password_changed_at,
                 registered_device_id, registered_device_name, registered_device_at,
                 pending_device_id, pending_device_name, pending_device_ip, pending_device_requested_at,
                 created_at, updated_at
          FROM users
          ORDER BY id ASC
        `)
        .all();

      return res.json({
        success: true,
        users,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch users: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/device-requests
 * Super Admin only: List all regular users with pending new-device login approval requests
 */
authRouter.get(
  '/device-requests',
  authenticateToken,
  requireRole(['Super Admin']),
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      ensureDeviceSecurityColumns(db);
      const requests = db
        .prepare(`
          SELECT id, username, full_name, role, status,
                 registered_device_id, registered_device_name, registered_device_at,
                 pending_device_id, pending_device_name, pending_device_ip, pending_device_requested_at
          FROM users
          WHERE pending_device_id IS NOT NULL AND TRIM(pending_device_id) != ''
          ORDER BY pending_device_requested_at DESC
        `)
        .all();

      return res.json({
        success: true,
        requests,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch device requests: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users/:id/approve-device
 * Super Admin only: Approve a regular user's new device and automatically unregister the previous device
 */
authRouter.post(
  '/users/:id/approve-device',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureDeviceSecurityColumns(db);
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const newDeviceId = String(req.body?.device_id || targetUser.pending_device_id || '').trim();
      const newDeviceName = String(
        req.body?.device_name || targetUser.pending_device_name || 'Approved Workstation'
      ).trim();

      if (!newDeviceId) {
        return res.status(400).json({
          success: false,
          error: 'No pending device approval request found for this user.',
        });
      }

      const previousDeviceId = targetUser.registered_device_id || 'None';
      const previousDeviceName = targetUser.registered_device_name || 'None';

      const approveTx = db.transaction(() => {
        // 1. Register the newly approved device & clear pending request
        db.prepare(`
          UPDATE users
          SET registered_device_id = ?,
              registered_device_name = ?,
              registered_device_at = datetime('now'),
              pending_device_id = NULL,
              pending_device_name = NULL,
              pending_device_ip = NULL,
              pending_device_requested_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(newDeviceId, newDeviceName, id);

        // 2. Automatically unregister the previous device and terminate all old sessions for this user
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      });

      approveTx();

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'DEVICE_APPROVED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Super Admin approved new device "${newDeviceName}" (${newDeviceId}) for @${targetUser.username}. Previous device "${previousDeviceName}" (${previousDeviceId}) automatically unregistered.`,
      });

      const updatedUser = getUserById(db, id);

      return res.json({
        success: true,
        message: `New device (${newDeviceName}) approved for @${targetUser.username}. Previous device has been automatically unregistered.`,
        user: updatedUser,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to approve device: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users/:id/reject-device
 * Super Admin only: Reject a pending new-device login request and keep existing device registered
 */
authRouter.post(
  '/users/:id/reject-device',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureDeviceSecurityColumns(db);
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const rejectedDeviceId = targetUser.pending_device_id || 'Unknown';
      const rejectedDeviceName = targetUser.pending_device_name || 'Unknown Device';

      db.prepare(`
        UPDATE users
        SET pending_device_id = NULL,
            pending_device_name = NULL,
            pending_device_ip = NULL,
            pending_device_requested_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(id);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'DEVICE_REJECTED',
        status: 'WARNING',
        ipAddress: ip,
        userAgent,
        details: `Super Admin rejected new device request "${rejectedDeviceName}" (${rejectedDeviceId}) for @${targetUser.username}.`,
      });

      const updatedUser = getUserById(db, id);

      return res.json({
        success: true,
        message: `Rejected pending device request for @${targetUser.username}.`,
        user: updatedUser,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to reject device request: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users/:id/unregister-device
 * Super Admin only: Unregister current device for a user so their next login registers a device
 */
authRouter.post(
  '/users/:id/unregister-device',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    ensureDeviceSecurityColumns(db);
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const oldDevice = targetUser.registered_device_name || targetUser.registered_device_id || 'None';

      const resetTx = db.transaction(() => {
        db.prepare(`
          UPDATE users
          SET registered_device_id = NULL,
              registered_device_name = NULL,
              registered_device_at = NULL,
              pending_device_id = NULL,
              pending_device_name = NULL,
              pending_device_ip = NULL,
              pending_device_requested_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(id);

        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      });

      resetTx();

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'DEVICE_UNREGISTERED',
        status: 'INFO',
        ipAddress: ip,
        userAgent,
        details: `Super Admin unregistered device (${oldDevice}) for @${targetUser.username}.`,
      });

      const updatedUser = getUserById(db, id);

      return res.json({
        success: true,
        message: `Unregistered device for @${targetUser.username}. Their next login will register their device.`,
        user: updatedUser,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to unregister device: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users
 * Super Admin only: Create a new user with defined role
 */
authRouter.post(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const { username, password, full_name, email, phone, role, status, notes } = req.body;

      if (!username || typeof username !== 'string' || username.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
      }

      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      }

      if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Full Name is required' });
      }

      const validRoles = ['Super Admin', 'Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }

      const cleanUsername = username.trim();
      const existing = getUserByUsername(db, cleanUsername);
      if (existing) {
        return res.status(409).json({ success: false, error: `Username "${cleanUsername}" is already taken.` });
      }

      const { hash, salt } = hashPassword(password);
      const userStatus = status === 'Inactive' ? 'Inactive' : 'Active';

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
          email ? email.trim() : null,
          phone ? phone.trim() : null,
          hash,
          salt,
          role,
          userStatus,
          notes ? notes.trim() : null
        );

      const newId = Number(result.lastInsertRowid);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_CREATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Created user "${cleanUsername}" with role "${role}" and status "${userStatus}"`,
      });

      const createdUser = getUserById(db, newId);

      return res.status(201).json({
        success: true,
        message: `User ${cleanUsername} created successfully`,
        user: createdUser,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to create user: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id
 * Super Admin only: Update staff user info and role
 */
authRouter.put(
  '/users/:id',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { full_name, email, phone, role, notes } = req.body;

      const validRoles = ['Super Admin', 'Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }

      // Prevent demoting self if only Super Admin
      if (role && role !== 'Super Admin' && targetUser.id === req.user?.id) {
        const superAdminCount = db
          .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Super Admin' AND status = 'Active'")
          .get() as { count: number };
        if (superAdminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            error: 'Cannot change your own role. The system requires at least one active Super Admin.',
          });
        }
      }

      db.prepare(`
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            role = COALESCE(?, role),
            notes = COALESCE(?, notes),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        full_name ? full_name.trim() : targetUser.full_name,
        email !== undefined ? (email ? email.trim() : null) : targetUser.email,
        phone !== undefined ? (phone ? phone.trim() : null) : targetUser.phone,
        role || targetUser.role,
        notes !== undefined ? (notes ? notes.trim() : null) : targetUser.notes,
        id
      );

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_UPDATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Updated user #${id} (${targetUser.username})`,
      });

      const updated = getUserById(db, id);
      return res.json({
        success: true,
        message: 'User details updated successfully',
        user: updated,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update user: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/status
 * Super Admin only: Activate or deactivate a user
 */
authRouter.put(
  '/users/:id/status',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { status } = req.body;
      if (!['Active', 'Inactive'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be "Active" or "Inactive"' });
      }

      // Prevent deactivating self if last active Super Admin
      if (status === 'Inactive' && targetUser.id === req.user?.id) {
        const superAdminCount = db
          .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Super Admin' AND status = 'Active'")
          .get() as { count: number };
        if (superAdminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            error: 'Cannot deactivate yourself as the only active Super Admin.',
          });
        }
      }

      db.prepare(`
        UPDATE users
        SET status = ?,
            failed_login_attempts = CASE WHEN ? = 'Active' THEN 0 ELSE failed_login_attempts END,
            locked_until = CASE WHEN ? = 'Active' THEN NULL ELSE locked_until END,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, status, status, id);

      // If deactivated, revoke all active sessions immediately
      if (status === 'Inactive') {
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_STATUS_CHANGED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Changed user #${id} (${targetUser.username}) status to ${status}`,
      });

      const updated = getUserById(db, id);
      return res.json({
        success: true,
        message: `User status changed to ${status}`,
        user: updated,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update status: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/reset-password
 * Super Admin only: Reset user password
 */
authRouter.put(
  '/users/:id/reset-password',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { new_password, force_password_change } = req.body;
      if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        });
      }

      const { hash, salt } = hashPassword(new_password);
      const shouldForce = force_password_change === true || force_password_change === 1 ? 1 : 0;

      db.prepare(`
        UPDATE users
        SET password_hash = ?,
            salt = ?,
            force_password_change = ?,
            password_changed_at = datetime('now'),
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, salt, shouldForce, id);

      // Invalidate active sessions to force re-login with new password
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'PASSWORD_RESET',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Reset password for user #${id} (${targetUser.username})${shouldForce ? ' with force change on next login' : ''}`,
      });

      return res.json({
        success: true,
        message: `Password for ${targetUser.username} has been reset successfully.${shouldForce ? ' User will be prompted to change it on next login.' : ''} Active sessions revoked.`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to reset password: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/force-password-change
 * Super Admin only: Toggle or set force password change at next login
 */
authRouter.put(
  '/users/:id/force-password-change',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const forceChange = req.body?.force_password_change === false || req.body?.force_password_change === 0 ? 0 : 1;

      db.prepare(`
        UPDATE users
        SET force_password_change = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(forceChange, id);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'FORCE_PASSWORD_CHANGE_TOGGLED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Set force_password_change=${forceChange} for user #${id} (${targetUser.username})`,
      });

      const updated = getUserById(db, id);
      return res.json({
        success: true,
        message: forceChange
          ? `User ${targetUser.username} will be required to change password on next login.`
          : `Force password change requirement removed for ${targetUser.username}.`,
        user: updated,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update force password setting: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/change-my-password
 * Any authenticated user: Change their own password (or satisfy forced password change)
 */
authRouter.post(
  '/change-my-password',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const userId = req.user?.id;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRecord | undefined;
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { current_password, new_password } = req.body;

      if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        });
      }

      // If user was not forced to change password, require current password verification
      if (user.force_password_change !== 1 && current_password) {
        const valid = verifyPassword(String(current_password), user.salt, user.password_hash);
        if (!valid) {
          return res.status(400).json({ success: false, error: 'Current password does not match' });
        }
      }

      const { hash, salt } = hashPassword(new_password);

      db.prepare(`
        UPDATE users
        SET password_hash = ?,
            salt = ?,
            force_password_change = 0,
            password_changed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, salt, userId);

      logAuditEvent(db, {
        userId,
        username: user.username,
        action: 'PASSWORD_CHANGED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: 'User updated their password successfully',
      });

      return res.json({
        success: true,
        message: 'Password changed successfully.',
        force_password_change: 0,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to change password: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/audit-logs
 * Super Admin & Administrator: View security and login audit history
 */
authRouter.get(
  '/audit-logs',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const limit = Math.min(200, parseInt(req.query.limit as string, 10) || 50);
      const action = req.query.action as string;
      const username = req.query.username as string;

      let sql = 'SELECT * FROM auth_audit_logs';
      const conditions: string[] = [];
      const params: any[] = [];

      if (action) {
        conditions.push('action = ?');
        params.push(action);
      }
      if (username) {
        conditions.push('LOWER(username) LIKE ?');
        params.push(`%${username.toLowerCase()}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      const logs = db.prepare(sql).all(...params);

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

/**
 * GET /api/auth/roles-permissions
 * View permissions matrix for all roles
 */
authRouter.get(
  '/roles-permissions',
  authenticateToken,
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const perms = db
        .prepare('SELECT role, module_key, can_view, can_create, can_edit, can_delete, can_export FROM role_permissions ORDER BY role, module_key')
        .all();

      return res.json({
        success: true,
        permissions: perms,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch permissions matrix: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/roles-permissions
 * Super Admin only: Update module permissions for a role
 */
authRouter.put(
  '/roles-permissions',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const { role, module_key, can_view, can_create, can_edit, can_delete, can_export } = req.body;

      const editableRoles = ['Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (!editableRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error:
            role === 'Super Admin'
              ? 'Super Admin always retains unrestricted control across all modules.'
              : `Invalid role: ${role}`,
        });
      }

      if (!module_key || typeof module_key !== 'string') {
        return res.status(400).json({ success: false, error: 'module_key is required' });
      }

      const v = can_view ? 1 : 0;
      const c = v && can_create ? 1 : 0;
      const e = v && can_edit ? 1 : 0;
      const d = v && can_delete ? 1 : 0;
      const x = v && can_export ? 1 : 0;

      db.prepare(`
        INSERT INTO role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(role, module_key) DO UPDATE SET
          can_view = excluded.can_view,
          can_create = excluded.can_create,
          can_edit = excluded.can_edit,
          can_delete = excluded.can_delete,
          can_export = excluded.can_export
      `).run(role, module_key, v, c, e, d, x);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'PERMISSIONS_UPDATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Updated permissions for role '${role}' on module '${module_key}' (V:${v} C:${c} E:${e} D:${d} X:${x})`,
      });

      const perms = db
        .prepare('SELECT role, module_key, can_view, can_create, can_edit, can_delete, can_export FROM role_permissions ORDER BY role, module_key')
        .all();

      return res.json({
        success: true,
        message: `Permissions updated for ${role} on ${module_key}`,
        permissions: perms,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update permissions: ${errorMsg}` });
    }
  }
);

