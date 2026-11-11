import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/connection.ts';
import { validateSession, logAuditEvent } from '../services/authService.ts';
import type { SafeUser, ModulePermission } from '../services/authService.ts';

declare global {
  namespace Express {
    interface Request {
      user?: any;
      firebaseUser?: any;
      permissions?: Record<string, ModulePermission>;
      sessionToken?: string;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user?: SafeUser;
  permissions?: Record<string, ModulePermission>;
  sessionToken?: string;
}

/**
 * Extracts session token from Authorization header or custom header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const customHeader = req.headers['x-session-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  return null;
}

function extractDeviceId(req: Request): string | null {
  const headerVal = req.headers['x-device-id'];
  if (typeof headerVal === 'string' && headerVal.trim()) {
    return headerVal.trim();
  }
  return null;
}

/**
 * Express middleware to strictly require an active, non-expired session
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in to access this resource.',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const db = getDatabase();
    const deviceId = extractDeviceId(req);
    const result = validateSession(db, token, deviceId);

    if (!result.valid || !result.user) {
      return res.status(401).json({
        success: false,
        error: result.reason || 'Session expired or invalid. Please log in again.',
        code: result.code || 'SESSION_EXPIRED',
      });
    }

    req.user = result.user;
    req.permissions = result.permissions;
    req.sessionToken = token;
    return next();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      error: `Authentication verification error: ${errorMsg}`,
      code: 'AUTH_ERROR',
    });
  }
}

/**
 * Optional authentication middleware: attaches user if token is valid, but does not block
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  try {
    const db = getDatabase();
    const deviceId = extractDeviceId(req);
    const result = validateSession(db, token, deviceId);
    if (result.valid && result.user) {
      req.user = result.user;
      req.permissions = result.permissions;
      req.sessionToken = token;
    }
  } catch {
    // ignore in optional auth
  }
  return next();
}

/**
 * Middleware requiring specific role(s)
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      try {
        const db = getDatabase();
        logAuditEvent(db, {
          userId: req.user.id,
          username: req.user.username,
          action: 'UNAUTHORIZED_ACCESS_BLOCKED',
          status: 'WARNING',
          ipAddress: req.socket.remoteAddress || '127.0.0.1',
          userAgent: (req.headers['user-agent'] as string) || 'Unknown',
          details: `Role '${req.user.role}' blocked from ${req.method} ${req.originalUrl} (requires ${allowedRoles.join(', ')})`,
        });
      } catch {
        // ignore audit log failure
      }

      return res.status(403).json({
        success: false,
        error: `Access denied. Requires one of: ${allowedRoles.join(', ')}`,
        code: 'FORBIDDEN',
      });
    }

    return next();
  };
}

/**
 * Middleware requiring specific module action permission
 */
export function requirePermission(
  moduleKey: string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    // Super Admin has unrestricted permissions
    if (req.user.role === 'Super Admin') {
      return next();
    }

    const perm = req.permissions?.[moduleKey];
    const flagKey = `can_${action}` as keyof ModulePermission;

    if (!perm || !perm[flagKey]) {
      try {
        const db = getDatabase();
        logAuditEvent(db, {
          userId: req.user.id,
          username: req.user.username,
          action: 'PERMISSION_DENIED',
          status: 'WARNING',
          ipAddress: req.socket.remoteAddress || '127.0.0.1',
          userAgent: (req.headers['user-agent'] as string) || 'Unknown',
          details: `User @${req.user.username} (${req.user.role}) denied '${action}' on '${moduleKey}' (${req.method} ${req.originalUrl})`,
        });
      } catch {
        // ignore
      }

      return res.status(403).json({
        success: false,
        error: `Permission denied: Your role (${req.user.role}) does not have '${action}' permission on module '${moduleKey}'.`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    return next();
  };
}

/**
 * Helper to check if authenticated user has at least one of the specified module+action permissions
 */
function hasAnyPerm(
  permissions: Record<string, ModulePermission> | undefined,
  checks: Array<{ mod: string; action: 'view' | 'create' | 'edit' | 'delete' | 'export' }>
): boolean {
  if (!permissions) return false;
  return checks.some(({ mod, action }) => {
    const p = permissions[mod];
    if (!p) return false;
    const key = `can_${action}` as keyof ModulePermission;
    return Boolean(p[key]);
  });
}

/**
 * Route-aware RBAC enforcement middleware for each ERP domain
 */
export function enforceModulePermissions(
  domain: 'items' | 'accounts' | 'purchases' | 'sales' | 'inventory' | 'accounting'
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    // Super Admin always has full control
    if (req.user.role === 'Super Admin') {
      return next();
    }

    const method = req.method.toUpperCase();
    const subPath = (req.path || '/').toLowerCase();
    const perms = req.permissions;

    let allowed = false;
    let requiredDesc = `${domain}`;

    if (domain === 'items') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'items', action: 'view' },
          { mod: 'inventory', action: 'view' },
          { mod: 'sales', action: 'view' },
          { mod: 'purchases', action: 'view' },
        ]);
        requiredDesc = 'items:view';
      } else if (method === 'POST') {
        allowed = hasAnyPerm(perms, [{ mod: 'items', action: 'create' }]);
        requiredDesc = 'items:create';
      } else if (method === 'PUT' || method === 'PATCH') {
        allowed = hasAnyPerm(perms, [{ mod: 'items', action: 'edit' }]);
        requiredDesc = 'items:edit';
      } else if (method === 'DELETE') {
        allowed = hasAnyPerm(perms, [{ mod: 'items', action: 'delete' }]);
        requiredDesc = 'items:delete';
      }
    } else if (domain === 'accounts') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'accounts', action: 'view' },
          { mod: 'ledgers', action: 'view' },
          { mod: 'sales', action: 'view' },
          { mod: 'purchases', action: 'view' },
          { mod: 'payments', action: 'view' },
        ]);
        requiredDesc = 'accounts:view';
      } else if (method === 'POST') {
        allowed = hasAnyPerm(perms, [{ mod: 'accounts', action: 'create' }]);
        requiredDesc = 'accounts:create';
      } else if (method === 'PUT' || method === 'PATCH') {
        allowed = hasAnyPerm(perms, [{ mod: 'accounts', action: 'edit' }]);
        requiredDesc = 'accounts:edit';
      } else if (method === 'DELETE') {
        allowed = hasAnyPerm(perms, [{ mod: 'accounts', action: 'delete' }]);
        requiredDesc = 'accounts:delete';
      }
    } else if (domain === 'purchases') {
      if (subPath.startsWith('/tax-settings') || subPath.startsWith('/tax-history')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'tax', action: 'view' },
            { mod: 'purchases', action: 'view' },
            { mod: 'sales', action: 'view' },
            { mod: 'accounts', action: 'view' },
          ]);
          requiredDesc = 'tax:view';
        } else {
          allowed = hasAnyPerm(perms, [
            { mod: 'tax', action: 'edit' },
            { mod: 'tax', action: 'create' },
          ]);
          requiredDesc = 'tax:edit';
        }
      } else if (subPath.startsWith('/returns')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'purchase_returns', action: 'view' },
            { mod: 'purchases', action: 'view' },
          ]);
          requiredDesc = 'purchase_returns:view';
        } else {
          allowed = hasAnyPerm(perms, [{ mod: 'purchase_returns', action: 'create' }]);
          requiredDesc = 'purchase_returns:create';
        }
      } else if (subPath.startsWith('/inventory') || subPath.startsWith('/batches')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'inventory', action: 'view' },
            { mod: 'purchases', action: 'view' },
            { mod: 'sales', action: 'view' },
            { mod: 'items', action: 'view' },
          ]);
          requiredDesc = 'inventory:view';
        } else {
          allowed = hasAnyPerm(perms, [
            { mod: 'inventory', action: 'edit' },
            { mod: 'purchases', action: 'create' },
          ]);
          requiredDesc = 'inventory:edit';
        }
      } else {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'purchases', action: 'view' },
            { mod: 'purchase_returns', action: 'view' },
          ]);
          requiredDesc = 'purchases:view';
        } else if (method === 'POST') {
          allowed = hasAnyPerm(perms, [{ mod: 'purchases', action: 'create' }]);
          requiredDesc = 'purchases:create';
        } else if (method === 'PUT' || method === 'PATCH') {
          allowed = hasAnyPerm(perms, [{ mod: 'purchases', action: 'edit' }]);
          requiredDesc = 'purchases:edit';
        } else if (method === 'DELETE') {
          allowed = hasAnyPerm(perms, [{ mod: 'purchases', action: 'delete' }]);
          requiredDesc = 'purchases:delete';
        }
      }
    } else if (domain === 'sales') {
      if (subPath.startsWith('/returns')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'sale_returns', action: 'view' },
            { mod: 'sales', action: 'view' },
          ]);
          requiredDesc = 'sale_returns:view';
        } else {
          allowed = hasAnyPerm(perms, [{ mod: 'sale_returns', action: 'create' }]);
          requiredDesc = 'sale_returns:create';
        }
      } else if (subPath.startsWith('/payments')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'payments', action: 'view' },
            { mod: 'sales', action: 'view' },
            { mod: 'ledgers', action: 'view' },
          ]);
          requiredDesc = 'payments:view';
        } else {
          allowed = hasAnyPerm(perms, [{ mod: 'payments', action: 'create' }]);
          requiredDesc = 'payments:create';
        }
      } else if (subPath.startsWith('/ledgers')) {
        allowed = hasAnyPerm(perms, [
          { mod: 'ledgers', action: 'view' },
          { mod: 'accounts', action: 'view' },
        ]);
        requiredDesc = 'ledgers:view';
      } else if (subPath.startsWith('/reports')) {
        allowed = hasAnyPerm(perms, [
          { mod: 'reports', action: 'view' },
          { mod: 'tax', action: 'view' },
        ]);
        requiredDesc = 'reports:view';
      } else {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'sales', action: 'view' },
            { mod: 'sale_returns', action: 'view' },
          ]);
          requiredDesc = 'sales:view';
        } else if (method === 'POST') {
          allowed = hasAnyPerm(perms, [{ mod: 'sales', action: 'create' }]);
          requiredDesc = 'sales:create';
        } else if (method === 'PUT' || method === 'PATCH') {
          allowed = hasAnyPerm(perms, [
            { mod: 'sales', action: 'edit' },
            { mod: 'sales', action: 'create' },
          ]);
          requiredDesc = 'sales:edit';
        } else if (method === 'DELETE') {
          allowed = hasAnyPerm(perms, [{ mod: 'sales', action: 'delete' }]);
          requiredDesc = 'sales:delete';
        }
      }
    } else if (domain === 'inventory') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'inventory', action: 'view' },
          { mod: 'items', action: 'view' },
          { mod: 'sales', action: 'view' },
          { mod: 'purchases', action: 'view' },
        ]);
        requiredDesc = 'inventory:view';
      } else {
        allowed = hasAnyPerm(perms, [
          { mod: 'inventory', action: 'create' },
          { mod: 'inventory', action: 'edit' },
        ]);
        requiredDesc = 'inventory:create/edit';
      }
    } else if (domain === 'accounting') {
      if (subPath.startsWith('/coa')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'accounts', action: 'view' },
            { mod: 'ledgers', action: 'view' },
            { mod: 'payments', action: 'view' },
          ]);
          requiredDesc = 'accounts:view';
        } else {
          allowed = hasAnyPerm(perms, [{ mod: 'accounts', action: 'create' }]);
          requiredDesc = 'accounts:create';
        }
      } else if (subPath.startsWith('/vouchers')) {
        if (method === 'GET') {
          allowed = hasAnyPerm(perms, [
            { mod: 'payments', action: 'view' },
            { mod: 'accounts', action: 'view' },
            { mod: 'ledgers', action: 'view' },
          ]);
          requiredDesc = 'payments:view';
        } else {
          allowed = hasAnyPerm(perms, [
            { mod: 'payments', action: 'create' },
            { mod: 'accounts', action: 'create' },
          ]);
          requiredDesc = 'payments:create';
        }
      } else if (subPath.startsWith('/ledgers')) {
        allowed = hasAnyPerm(perms, [
          { mod: 'ledgers', action: 'view' },
          { mod: 'accounts', action: 'view' },
        ]);
        requiredDesc = 'ledgers:view';
      } else if (subPath.startsWith('/advance-tax')) {
        allowed = hasAnyPerm(perms, [
          { mod: 'tax', action: 'view' },
          { mod: 'accounts', action: 'view' },
          { mod: 'reports', action: 'view' },
        ]);
        requiredDesc = 'tax:view';
      } else if (subPath.startsWith('/reports')) {
        allowed = hasAnyPerm(perms, [
          { mod: 'reports', action: 'view' },
          { mod: 'accounts', action: 'view' },
        ]);
        requiredDesc = 'reports:view';
      } else {
        allowed = hasAnyPerm(perms, [{ mod: 'accounts', action: 'view' }]);
        requiredDesc = 'accounts:view';
      }
    }

    if (!allowed) {
      try {
        const db = getDatabase();
        logAuditEvent(db, {
          userId: req.user.id,
          username: req.user.username,
          action: 'PERMISSION_DENIED',
          status: 'WARNING',
          ipAddress: req.socket.remoteAddress || '127.0.0.1',
          userAgent: (req.headers['user-agent'] as string) || 'Unknown',
          details: `User @${req.user.username} (${req.user.role}) blocked from ${method} ${req.originalUrl} (requires ${requiredDesc})`,
        });
      } catch {
        // ignore
      }

      return res.status(403).json({
        success: false,
        error: `Permission denied: Your role (${req.user.role}) is not authorized to perform this operation (${requiredDesc}).`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    return next();
  };
}

