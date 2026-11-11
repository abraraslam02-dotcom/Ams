import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, ModulePermission } from '../types/auth';
import { api, getAuthToken, setAuthToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  permissions: Record<string, ModulePermission>;
  isAuthenticated: boolean;
  loading: boolean;
  isSuperAdmin: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  hasPermission: (
    moduleKey: string,
    action?: 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export'
  ) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, ModulePermission>>({});
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getAuthStatus();

      if (res && res.authenticated && res.user) {
        if ((res as any).token) {
          setAuthToken((res as any).token, true);
        }
        setUser(res.user);
        setPermissions(res.permissions || {});
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setPermissions({});
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.warn('[AMS Auth Context] Verification note:', err);
      // Fallback
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        setPermissions({});
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    const handleSessionExpired = () => {
      setUser(null);
      setPermissions({});
      setIsAuthenticated(false);
    };

    window.addEventListener('ams-session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('ams-session-expired', handleSessionExpired);
    };
  }, [checkStatus]);

  const login = async (username: string, password: string, rememberMe?: boolean) => {
    const res = await api.login({ username, password, remember_me: rememberMe });
    if (res.success && res.user) {
      if (res.token) {
        setAuthToken(res.token, Boolean(rememberMe));
      }
      setUser(res.user);
      setPermissions(res.permissions || {});
      setIsAuthenticated(true);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors on logout
    } finally {
      setAuthToken(null);
      setUser(null);
      setPermissions({});
      setIsAuthenticated(false);
    }
  };

  const isSuperAdmin = user?.role === 'Super Admin';

  const hasPermission = useCallback(
    (
      moduleKey: string,
      action: 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export' = 'view'
    ): boolean => {
      if (!user) return false;
      if (user.role === 'Super Admin') return true;

      // Module-specific permission mappings
      let resolvedKey = moduleKey;
      if (moduleKey.startsWith('sales-') || moduleKey === 'sales') resolvedKey = 'sales';
      else if (moduleKey.startsWith('purchases-') || moduleKey === 'purchases') resolvedKey = 'purchases';
      else if (moduleKey === 'sales-return' || moduleKey === 'sale-returns' || moduleKey === 'sales-return-register') resolvedKey = 'sale_returns';
      else if (moduleKey === 'purchase-returns' || moduleKey === 'purchases-return') resolvedKey = 'purchase_returns';
      else if (moduleKey.startsWith('inv-') || moduleKey === 'inventory' || moduleKey === 'items' || moduleKey === 'items-master') resolvedKey = 'items';
      else if (moduleKey.startsWith('ledger-') || moduleKey.startsWith('party-') || moduleKey === 'accounts' || moduleKey === 'coa-hierarchy') resolvedKey = 'accounts';
      else if (moduleKey.startsWith('cash-book') || moduleKey === 'cashbook') resolvedKey = 'cashbook';
      else if (moduleKey === 'expense-entry' || moduleKey === 'expenses') resolvedKey = 'expenses';
      else if (moduleKey.startsWith('report-') || moduleKey.startsWith('fin-') || moduleKey === 'reports') resolvedKey = 'reports';
      else if (moduleKey === 'backup-restore' || moduleKey === 'backup') resolvedKey = 'backup';
      else if (moduleKey === 'company-settings' || moduleKey === 'system-settings' || moduleKey === 'more-options' || moduleKey === 'printer-setup') resolvedKey = 'settings';
      else if (moduleKey === 'users' || moduleKey === 'users-manage') resolvedKey = 'users';

      const perm = permissions[resolvedKey];
      if (!perm) return false;

      const flagKey = `can_${action}` as keyof ModulePermission;
      return Boolean(perm[flagKey]);
    },
    [user, permissions]
  );

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      permissions,
      isAuthenticated,
      loading,
      isSuperAdmin,
      login,
      logout,
      refreshAuth: checkStatus,
      hasPermission,
    }),
    [user, permissions, isAuthenticated, loading, isSuperAdmin, checkStatus, hasPermission]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
