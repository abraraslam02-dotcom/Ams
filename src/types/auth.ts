export type UserRole =
  | 'Super Admin'
  | 'Administrator'
  | 'Accountant'
  | 'Salesman'
  | 'Purchase Operator'
  | 'Viewer';

export type UserStatus = 'Active' | 'Inactive' | 'Suspended';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until?: string | null;
  last_login?: string | null;
  last_login_ip?: string | null;
  notes?: string | null;
  force_password_change?: number | null;
  password_changed_at?: string | null;
  registered_device_id?: string | null;
  registered_device_name?: string | null;
  registered_device_at?: string | null;
  pending_device_id?: string | null;
  pending_device_name?: string | null;
  pending_device_ip?: string | null;
  pending_device_requested_at?: string | null;
  created_at: string;
  updated_at: string;
  permissions?: Record<string, ModulePermission>;
}

export interface ModulePermission {
  module_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_print: boolean;
  can_export: boolean;
}

export interface AuthStatusResponse {
  success?: boolean;
  initialized: boolean;
  needsSetup?: boolean;
  userCount: number;
  authenticated: boolean;
  user?: User | null;
  permissions?: Record<string, ModulePermission> | null;
  message?: string;
  error?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  expiresAt?: string;
  user?: User;
  permissions?: Record<string, ModulePermission>;
  error?: string;
  code?: string;
  locked?: boolean;
  remainingMinutes?: number;
  attemptsRemaining?: number;
  deviceApprovalRequired?: boolean;
  registeredDeviceId?: string;
  registeredDeviceName?: string;
  requestedDeviceId?: string;
  requestedDeviceName?: string;
}

export interface AuditLog {
  id: number;
  user_id?: number | null;
  username: string;
  action: string;
  status: 'SUCCESS' | 'FAILED' | 'WARNING' | 'INFO';
  ip_address?: string | null;
  user_agent?: string | null;
  details?: string | null;
  created_at: string;
}
