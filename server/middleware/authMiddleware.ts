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
 * Direct Access Middleware: No login or authentication required
 */
export function authenticateToken(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  req.user = {
    id: 1,
    username: 'admin',
    full_name: 'Store Operator',
    role: 'Super Admin',
  } as any;
  req.permissions = {};
  return next();
}

/**
 * Optional auth pass-through
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  req.user = { id: 1, username: 'admin', full_name: 'Store Operator', role: 'Super Admin' } as any;
  return next();
}

/**
 * Middleware requiring specific role(s) - direct pass-through
 */
export function requireRole(_allowedRoles: string[]) {
  return (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next();
}

/**
 * Middleware requiring specific module action permission - direct pass-through
 */
export function requirePermission(
  _moduleKey: string,
  _action: 'view' | 'create' | 'edit' | 'delete' | 'export'
) {
  return (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next();
}

/**
 * Route-aware RBAC enforcement middleware - direct pass-through
 */
export function enforceModulePermissions(
  _domain: 'items' | 'accounts' | 'purchases' | 'sales' | 'inventory' | 'accounting'
) {
  return (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next();
}


