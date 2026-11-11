import React, { createContext, useContext, useMemo } from 'react';
import { User, ModulePermission } from '../types/auth';

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

const DEFAULT_OPERATOR: User = {
  id: 1,
  username: 'admin',
  full_name: 'Store Operator',
  email: 'admin@abrarmedical.store',
  role: 'Super Admin',
  status: 'Active',
  failed_login_attempts: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useMemo<AuthContextType>(() => ({
    user: DEFAULT_OPERATOR,
    permissions: {},
    isAuthenticated: true,
    isInitialized: true,
    loading: false,
    isSuperAdmin: true,
    login: async () => {},
    setupAdmin: async () => {},
    logout: async () => {},
    refreshAuth: async () => {},
    hasPermission: () => true,
  }), []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
