import { Router } from 'express';
import type { Request, Response } from 'express';

export const authRouter = Router();

const DEFAULT_OPERATOR = {
  id: 1,
  username: 'admin',
  full_name: 'Store Operator',
  role: 'Super Admin',
  status: 'Active',
  force_password_change: 0,
  failed_login_attempts: 0,
};

/**
 * GET /api/auth/status
 * Public endpoint returning active direct-access status without login
 */
authRouter.get('/status', (_req: Request, res: Response) => {
  return res.json({
    initialized: true,
    authenticated: true,
    user: DEFAULT_OPERATOR,
    permissions: {},
    token: 'direct-access-token',
  });
});

/**
 * GET /api/auth/me
 * Returns the current active operator
 */
authRouter.get('/me', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    user: DEFAULT_OPERATOR,
    permissions: {},
  });
});

/**
 * POST /api/auth/login
 * Immediate success for direct access
 */
authRouter.post('/login', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    message: 'Direct access enabled.',
    user: DEFAULT_OPERATOR,
    token: 'direct-access-token',
    permissions: {},
  });
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (_req: Request, res: Response) => {
  return res.json({ success: true, message: 'Logged out.' });
});

/**
 * POST /api/auth/setup-admin
 */
authRouter.post('/setup-admin', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    message: 'System ready.',
    user: DEFAULT_OPERATOR,
    token: 'direct-access-token',
  });
});

/**
 * GET /api/auth/users
 * User management module removed
 */
authRouter.get('/users', (_req: Request, res: Response) => {
  return res.json({ success: true, users: [] });
});

/**
 * POST /api/auth/users
 */
authRouter.post('/users', (_req: Request, res: Response) => {
  return res.status(400).json({ success: false, error: 'User management has been removed.' });
});

/**
 * GET /api/auth/audit-logs
 */
authRouter.get('/audit-logs', (_req: Request, res: Response) => {
  return res.json({ success: true, logs: [], total: 0 });
});

/**
 * POST /api/auth/change-password
 */
authRouter.post('/change-password', (_req: Request, res: Response) => {
  return res.json({ success: true, message: 'Password updated.' });
});
