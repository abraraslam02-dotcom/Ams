import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/connection.ts';
import { validateSession, logAuditEvent } from '../services/authService.ts';
import type { SafeUser, ModulePermission } from '../services/authService.ts';

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
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

export const SESSION_COOKIE_NAME = 'ams_sid';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

/**
 * Extracts session token from HttpOnly session cookie, Authorization header, or custom header
 */
export function extractToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME] && cookies[SESSION_COOKIE_NAME].trim()) {
    return cookies[SESSION_COOKIE_NAME].trim();
  }
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

/**
 * Express middleware requiring active, non-expired session
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in to continue.',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const db = getDatabase();
    const result = validateSession(db, token);

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
 * Optional authentication: attaches user if token valid, but does not block
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  try {
    const db = getDatabase();
    const result = validateSession(db, token);
    if (result.valid && result.user) {
      req.user = result.user;
      req.permissions = result.permissions;
      req.sessionToken = token;
    }
  } catch {
    // Ignore in optional auth
  }
  return next();
}

/**
 * Middleware requiring specific role(s) (e.g. ['Super Admin'])
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

    // Super Admin has unrestricted authority across the entire ERP
    if (req.user.role === 'Super Admin') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      try {
        const db = getDatabase();
        logAuditEvent(db, {
          userId: req.user.id,
          username: req.user.username,
          action: 'UNAUTHORIZED_ROLE_ACCESS_BLOCKED',
          status: 'WARNING',
          ipAddress: req.socket.remoteAddress || '127.0.0.1',
          userAgent: (req.headers['user-agent'] as string) || 'Unknown',
          details: `Role '${req.user.role}' blocked from ${req.method} ${req.originalUrl} (requires ${allowedRoles.join(', ')})`,
        });
      } catch {
        // Ignore audit log failure
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
 * Middleware requiring specific individual module permission
 */
export function requirePermission(
  moduleKey: string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export'
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
        // Ignore
      }

      return res.status(403).json({
        success: false,
        error: `Permission denied: You do not have '${action}' permission on module '${moduleKey}'.`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    return next();
  };
}

/**
 * Helper to check permissions
 */
function hasAnyPerm(
  permissions: Record<string, ModulePermission> | undefined,
  checks: Array<{ mod: string; action: 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export' }>
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
 * Route-aware RBAC enforcement for domain routers
 */
export function enforceModulePermissions(
  domain: 'items' | 'accounts' | 'purchases' | 'sales' | 'inventory' | 'accounting' | 'settings' | 'users' | 'supply' | 'closing'
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    // Super Admin always has full access
    if (req.user.role === 'Super Admin') {
      return next();
    }

    const method = req.method.toUpperCase();
    const perms = req.permissions;

    let allowed = false;
    let requiredDesc = `${domain}`;

    if (domain === 'users') {
      // User management is strictly Super Admin only
      allowed = req.user.role === 'Super Admin';
      requiredDesc = 'users:manage';
    } else if (domain === 'settings') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [{ mod: 'settings', action: 'view' }]);
        requiredDesc = 'settings:view';
      } else {
        // Modifying settings requires Super Admin or settings:edit
        allowed = req.user.role === 'Super Admin' || hasAnyPerm(perms, [{ mod: 'settings', action: 'edit' }]);
        requiredDesc = 'settings:edit';
      }
    } else if (domain === 'items') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'items', action: 'view' },
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
          { mod: 'sales', action: 'view' },
          { mod: 'purchases', action: 'view' },
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
    } else if (domain === 'sales') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'view' },
          { mod: 'sale_returns', action: 'view' },
          { mod: 'reports', action: 'view' },
        ]);
        requiredDesc = 'sales:view';
      } else if (method === 'POST') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'create' },
          { mod: 'sale_returns', action: 'create' },
        ]);
        requiredDesc = 'sales:create';
      } else if (method === 'PUT' || method === 'PATCH') {
        allowed = hasAnyPerm(perms, [{ mod: 'sales', action: 'edit' }]);
        requiredDesc = 'sales:edit';
      } else if (method === 'DELETE') {
        allowed = hasAnyPerm(perms, [{ mod: 'sales', action: 'delete' }]);
        requiredDesc = 'sales:delete';
      }
    } else if (domain === 'purchases') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'purchases', action: 'view' },
          { mod: 'purchase_returns', action: 'view' },
          { mod: 'reports', action: 'view' },
        ]);
        requiredDesc = 'purchases:view';
      } else if (method === 'POST') {
        allowed = hasAnyPerm(perms, [
          { mod: 'purchases', action: 'create' },
          { mod: 'purchase_returns', action: 'create' },
        ]);
        requiredDesc = 'purchases:create';
      } else if (method === 'PUT' || method === 'PATCH') {
        allowed = hasAnyPerm(perms, [{ mod: 'purchases', action: 'edit' }]);
        requiredDesc = 'purchases:edit';
      } else if (method === 'DELETE') {
        allowed = hasAnyPerm(perms, [{ mod: 'purchases', action: 'delete' }]);
        requiredDesc = 'purchases:delete';
      }
    } else if (domain === 'inventory') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [{ mod: 'items', action: 'view' }]);
        requiredDesc = 'inventory:view';
      } else {
        allowed = hasAnyPerm(perms, [{ mod: 'items', action: 'create' }, { mod: 'items', action: 'edit' }]);
        requiredDesc = 'inventory:edit';
      }
    } else if (domain === 'accounting') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'accounts', action: 'view' },
          { mod: 'cashbook', action: 'view' },
          { mod: 'expenses', action: 'view' },
          { mod: 'reports', action: 'view' },
        ]);
        requiredDesc = 'accounting:view';
      } else {
        allowed = hasAnyPerm(perms, [
          { mod: 'accounts', action: 'create' },
          { mod: 'cashbook', action: 'create' },
          { mod: 'expenses', action: 'create' },
        ]);
        requiredDesc = 'accounting:create';
      }
    } else if (domain === 'closing') {
      if (method === 'GET') {
        allowed =
          req.user.role === 'Administrator' ||
          req.user.role === 'Accountant' ||
          hasAnyPerm(perms, [
            { mod: 'closing', action: 'view' },
            { mod: 'reports', action: 'view' },
            { mod: 'accounts', action: 'view' },
          ]);
        requiredDesc = 'closing:view';
      } else {
        allowed =
          req.user.role === 'Administrator' ||
          req.user.role === 'Accountant' ||
          hasAnyPerm(perms, [
            { mod: 'closing', action: 'create' },
            { mod: 'closing', action: 'edit' },
            { mod: 'accounts', action: 'create' },
          ]);
        requiredDesc = 'closing:create';
      }
    } else if (domain === 'supply') {
      if (method === 'GET') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'view' },
          { mod: 'supply_booking', action: 'view' },
          { mod: 'supply_packing', action: 'view' },
          { mod: 'supply_dispatch', action: 'view' },
          { mod: 'supply_returns', action: 'view' },
          { mod: 'supply_billing', action: 'view' },
          { mod: 'supply_recovery', action: 'view' },
          { mod: 'supply_reports', action: 'view' },
        ]);
        requiredDesc = 'supply:view';
      } else if (method === 'POST') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'create' },
          { mod: 'supply_booking', action: 'create' },
          { mod: 'supply_packing', action: 'create' },
          { mod: 'supply_dispatch', action: 'create' },
          { mod: 'supply_returns', action: 'create' },
          { mod: 'supply_billing', action: 'create' },
          { mod: 'supply_recovery', action: 'create' },
        ]);
        requiredDesc = 'supply:create';
      } else if (method === 'PUT' || method === 'PATCH') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'edit' },
          { mod: 'supply_booking', action: 'edit' },
          { mod: 'supply_packing', action: 'edit' },
          { mod: 'supply_dispatch', action: 'edit' },
          { mod: 'supply_returns', action: 'edit' },
          { mod: 'supply_billing', action: 'edit' },
          { mod: 'supply_recovery', action: 'edit' },
        ]);
        requiredDesc = 'supply:edit';
      } else if (method === 'DELETE') {
        allowed = hasAnyPerm(perms, [
          { mod: 'sales', action: 'delete' },
          { mod: 'supply_booking', action: 'delete' },
          { mod: 'supply_packing', action: 'delete' },
          { mod: 'supply_dispatch', action: 'delete' },
        ]);
        requiredDesc = 'supply:delete';
      }
    }

    if (!allowed) {
      try {
        const db = getDatabase();
        logAuditEvent(db, {
          userId: req.user.id,
          username: req.user.username,
          action: 'MODULE_PERMISSION_DENIED',
          status: 'WARNING',
          ipAddress: req.socket.remoteAddress || '127.0.0.1',
          userAgent: (req.headers['user-agent'] as string) || 'Unknown',
          details: `User @${req.user.username} (${req.user.role}) denied on ${domain} (${method} ${req.originalUrl})`,
        });
      } catch {
        // Ignore
      }

      return res.status(403).json({
        success: false,
        error: `Permission denied: Your account is not authorized to access this section (${requiredDesc}).`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    return next();
  };
}
