import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, ModulePermission, AuthStatusResponse } from '../types/auth';
import { api, getAuthToken, setAuthToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  permissions: Record<string, ModulePermission>;
  isAuthenticated: boolean;
  isInitialized: boolean;
  loading: boolean;
  isSuperAdmin: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  setupAdmin: (data: {
    username: string;
    password: string;
    full_name: string;
    email?: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  hasPermission: (moduleKey: string, action?: 'view' | 'create' | 'edit' | 'delete' | 'export') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, ModulePermission>>({});
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const status: AuthStatusResponse & { token?: string } = await api.getAuthStatus();

      setIsInitialized(status.initialized);

      if (status.authenticated && status.user) {
        if (status.token) {
          setAuthToken(status.token);
        }
        setUser(status.user);
        setPermissions(status.permissions || {});
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setPermissions({});
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('[AMS Auth Error] Failed to verify auth status:', err);
      // If error occurs, keep unauthenticated
      setUser(null);
      setPermissions({});
      setIsAuthenticated(false);
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
      setUser(res.user);
      setPermissions(res.permissions || {});
      setIsAuthenticated(true);
    }
  };

  const setupAdmin = async (data: {
    username: string;
    password: string;
    full_name: string;
    email?: string;
    phone?: string;
  }) => {
    const res = await api.setupAdmin(data);
    if (res.success && res.user) {
      setUser(res.user);
      setPermissions(res.permissions || {});
      setIsAuthenticated(true);
      setIsInitialized(true);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors during logout
    } finally {
      setAuthToken(null);
      setUser(null);
      setPermissions({});
      setIsAuthenticated(false);
    }
  };

  const hasPermission = useCallback(
    (moduleKey: string, action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view'): boolean => {
      if (!user) return false;
      if (user.role === 'Super Admin') return true;

      const perm = permissions[moduleKey];
      if (!perm) return false;

      const flagKey = `can_${action}` as keyof ModulePermission;
      return Boolean(perm[flagKey]);
    },
    [user, permissions]
  );

  const isSuperAdmin = user?.role === 'Super Admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        isAuthenticated,
        isInitialized,
        loading,
        isSuperAdmin,
        login,
        setupAdmin,
        logout,
        refreshAuth: checkStatus,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
