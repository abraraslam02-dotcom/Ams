import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  Shield,
  KeyRound,
  Edit2,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Clock,
  Eye,
  EyeOff,
  X,
  History,
  FileCheck2,
  Phone,
  Mail,
  UserCheck,
  UserX,
  Sparkles,
  Laptop,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../services/api';
import { User, UserRole, UserStatus, AuditLog, ModulePermission } from '../../types/auth';
import { useAuth } from '../../context/AuthContext';
import { formatPKTDate, formatPKTTime } from '../../utils/formatters';

const ROLE_COLORS: Record<UserRole, { bg: string; text: string; border: string }> = {
  'Super Admin': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  Administrator: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  Accountant: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  Salesman: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  'Purchase Operator': { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  Viewer: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
};

const ALL_ROLES: UserRole[] = [
  'Super Admin',
  'Administrator',
  'Accountant',
  'Salesman',
  'Purchase Operator',
  'Viewer',
];

const MODULE_LABELS: Record<string, string> = {
  sales: 'Sales & Billing (POS)',
  sale_returns: 'Sales Return & Credit Notes',
  items: 'Items Master Catalog',
  purchases: 'Purchase Invoices & Bills',
  purchase_returns: 'Purchase Returns (Debit Notes)',
  inventory: 'Batch Stock & Expiry Ledgers',
  accounts: 'Chart of Accounts Master',
  ledgers: 'Customer & Supplier Ledgers',
  payments: 'Payment & Receipt Vouchers',
  tax: 'Advance Tax Settings & Rates',
  reports: 'Financial & Sales Reports',
  user_management: 'Staff User Management',
  system_settings: 'Store Profile & Database',
};

export const UserManagementView: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'permissions' | 'audit'>('users');

  const [users, setUsers] = useState<User[]>([]);
  const [permissionsMatrix, setPermissionsMatrix] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Create User Form State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Salesman');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Edit User Form State
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('Salesman');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Reset Password State
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getUsers();
      setUsers(res.users);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load users: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await api.getRolesPermissions();
      setPermissionsMatrix(res.permissions);
    } catch {
      // ignore
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await api.getAuditLogs({
        limit: 150,
        action: auditActionFilter === 'all' ? undefined : auditActionFilter,
      });
      setAuditLogs(res.logs);
    } catch {
      // ignore
    }
  }, [auditActionFilter]);

  useEffect(() => {
    fetchUsers();
    fetchPermissions();
  }, [fetchUsers, fetchPermissions]);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAuditLogs]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword || !newFullName.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      const res = await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        full_name: newFullName.trim(),
        role: newRole,
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
        notes: newNotes.trim() || undefined,
      });

      setSuccessMessage(res.message);
      setShowCreateModal(false);
      // Reset form
      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('Salesman');
      setNewEmail('');
      setNewPhone('');
      setNewNotes('');
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenEdit = (user: User) => {
    setSelectedUser(user);
    setEditFullName(user.full_name);
    setEditRole(user.role);
    setEditEmail(user.email || '');
    setEditPhone(user.phone || '');
    setEditNotes(user.notes || '');
    setShowEditModal(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setActionLoading(true);
      setError(null);
      const res = await api.updateUser(selectedUser.id, {
        full_name: editFullName.trim(),
        role: editRole,
        email: editEmail.trim() || null,
        phone: editPhone.trim() || null,
        notes: editNotes.trim() || null,
      });

      setSuccessMessage(res.message);
      setShowEditModal(false);
      setSelectedUser(null);
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus: UserStatus = user.status === 'Active' ? 'Inactive' : 'Active';

    try {
      setActionLoading(true);
      setError(null);
      const res = await api.updateUserStatus(user.id, nextStatus as 'Active' | 'Inactive');
      setSuccessMessage(res.message);
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveDevice = async (user: User) => {
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.approveUserDevice(user.id);
      setSuccessMessage(res.message);
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectDevice = async (user: User) => {
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.rejectUserDevice(user.id);
      setSuccessMessage(res.message);
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnregisterDevice = async (user: User) => {
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.unregisterUserDevice(user.id);
      setSuccessMessage(res.message);
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePermission = async (
    role: UserRole,
    moduleKey: string,
    field: 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_export'
  ) => {
    if (role === 'Super Admin' || currentUser?.role !== 'Super Admin') return;

    const existing = permissionsMatrix.find(
      (p) => p.role === role && p.module_key === moduleKey
    ) || {
      role,
      module_key: moduleKey,
      can_view: 0,
      can_create: 0,
      can_edit: 0,
      can_delete: 0,
      can_export: 0,
    };

    const nextVal = existing[field] === 1 ? false : true;
    const nextView = field === 'can_view' ? nextVal : nextVal ? true : Boolean(existing.can_view);

    const payload = {
      role,
      module_key: moduleKey,
      can_view: nextView,
      can_create: !nextView
        ? false
        : field === 'can_create'
        ? nextVal
        : Boolean(existing.can_create),
      can_edit: !nextView
        ? false
        : field === 'can_edit'
        ? nextVal
        : Boolean(existing.can_edit),
      can_delete: !nextView
        ? false
        : field === 'can_delete'
        ? nextVal
        : Boolean(existing.can_delete),
      can_export: !nextView
        ? false
        : field === 'can_export'
        ? nextVal
        : Boolean(existing.can_export),
    };

    try {
      setActionLoading(true);
      setError(null);
      const res = await api.updateRolePermission(payload);
      setPermissionsMatrix(res.permissions);
      setSuccessMessage(res.message);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenResetPassword = (user: User) => {
    setSelectedUser(user);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (resetNewPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      const res = await api.resetUserPassword(selectedUser.id, resetNewPassword);
      setSuccessMessage(res.message);
      setShowResetPasswordModal(false);
      setSelectedUser(null);
      setResetNewPassword('');
      setResetConfirmPassword('');
      await fetchUsers();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered Users List
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.phone && u.phone.includes(searchQuery)) ||
      (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner / Notification */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-rose-600 hover:text-rose-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Tabs Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'users'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Staff Users ({users.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('permissions')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'permissions'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Role Permissions Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Security & Audit Logs</span>
          </button>
        </div>

        {activeTab === 'users' && currentUser?.role === 'Super Admin' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4 text-emerald-400" />
            <span>Add New Staff User</span>
          </button>
        )}
      </div>

      {/* TAB 1: USERS DIRECTORY */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          {/* Pending Device Approval Banner for Super Admin */}
          {currentUser?.role === 'Super Admin' &&
            users.some((u) => Boolean(u.pending_device_id)) && (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-950 font-bold text-xs">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Pending New Device Login Approvals (
                      {users.filter((u) => Boolean(u.pending_device_id)).length})
                    </span>
                  </div>
                  <span className="text-[11px] text-amber-800">
                    Approving a new device automatically unregisters the user&apos;s previous device.
                  </span>
                </div>

                <div className="divide-y divide-amber-200/80 bg-white rounded-lg border border-amber-200 overflow-hidden">
                  {users
                    .filter((u) => Boolean(u.pending_device_id))
                    .map((u) => (
                      <div
                        key={u.id}
                        className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-900">
                            {u.full_name}{' '}
                            <span className="font-mono text-emerald-700">@{u.username}</span>{' '}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {u.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-3">
                            <span>
                              Current Registered:{' '}
                              <strong className="font-mono text-slate-800">
                                {u.registered_device_name || 'Workstation'} ({u.registered_device_id})
                              </strong>
                            </span>
                            <span>→</span>
                            <span className="text-amber-800">
                              Requested New Device:{' '}
                              <strong className="font-mono text-amber-950">
                                {u.pending_device_name || 'New Device'} ({u.pending_device_id})
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleApproveDevice(u)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs transition"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve New Device</span>
                          </button>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleRejectDevice(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs cursor-pointer transition"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

          {/* Filters Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search staff by username, full name, phone..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Role:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Roles</option>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
              title="Refresh staff list"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold tracking-tight uppercase text-[11px]">
                    <th className="py-3 px-4">User Details</th>
                    <th className="py-3 px-4">Role &amp; Privilege</th>
                    <th className="py-3 px-4">Registered Device Security</th>
                    <th className="py-3 px-4">Account Status</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-slate-400">
                        {loading ? 'Loading users...' : 'No staff users match the specified criteria.'}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const roleStyle = ROLE_COLORS[user.role] || ROLE_COLORS.Viewer;
                      const isSelf = currentUser?.id === user.id;

                      return (
                        <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                          {/* User Details */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs uppercase shadow-2xs">
                                {user.full_name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{user.full_name}</span>
                                  {isSelf && (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                      You
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-slate-500">
                                  @{user.username}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Role Badge */}
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
                            >
                              <Shield className="w-3 h-3" />
                              {user.role}
                            </span>
                            {user.notes && (
                              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                                {user.notes}
                              </div>
                            )}
                          </td>

                          {/* Registered Device Security */}
                          <td className="py-3 px-4">
                            {user.role === 'Super Admin' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold">
                                <ShieldCheck className="w-3 h-3" />
                                All Devices Allowed
                              </span>
                            ) : (
                              <div className="space-y-1">
                                {user.registered_device_id ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                                      <Laptop className="w-3 h-3 text-emerald-600" />
                                      {user.registered_device_name || 'Registered Device'}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">
                                      ({user.registered_device_id})
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-400 italic">
                                    Unbound (registers on 1st login)
                                  </span>
                                )}

                                {user.pending_device_id && (
                                  <div className="p-1.5 rounded-lg bg-amber-50 border border-amber-300 text-[10px] text-amber-950 space-y-1">
                                    <div className="font-bold flex items-center gap-1 text-amber-900">
                                      <ShieldAlert className="w-3 h-3 text-amber-600" />
                                      <span>
                                        New Device Request: {user.pending_device_name} ({user.pending_device_id})
                                      </span>
                                    </div>
                                    {currentUser?.role === 'Super Admin' && (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          disabled={actionLoading}
                                          onClick={() => handleApproveDevice(user)}
                                          className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                                        >
                                          Approve New Device
                                        </button>
                                        <button
                                          type="button"
                                          disabled={actionLoading}
                                          onClick={() => handleRejectDevice(user)}
                                          className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold cursor-pointer"
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                user.status === 'Active'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {user.status === 'Active' ? (
                                <UserCheck className="w-3 h-3" />
                              ) : (
                                <UserX className="w-3 h-3" />
                              )}
                              {user.status}
                            </span>
                            {user.locked_until && (
                              <div className="text-[10px] text-rose-600 font-bold flex items-center gap-1 mt-0.5">
                                <Clock className="w-3 h-3" />
                                Locked (Brute Force)
                              </div>
                            )}
                          </td>

                          {/* Security & Login */}
                          <td className="py-3 px-4 text-slate-600">
                            <div className="text-xs">
                              {user.last_login ? (
                                <span className="font-medium text-slate-800">
                                  {user.last_login.split('T')[0] || user.last_login.split(' ')[0]}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Never logged in</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Created: {user.created_at?.split('T')[0] || user.created_at?.split(' ')[0]}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            {currentUser?.role === 'Super Admin' ? (
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {user.role !== 'Super Admin' && user.registered_device_id && (
                                  <button
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => handleUnregisterDevice(user)}
                                    className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                    title="Unregister current device so next login registers a new device"
                                  >
                                    <Laptop className="w-3 h-3" />
                                    <span>Reset Device</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => handleOpenEdit(user)}
                                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Edit user details and role"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>

                                <button
                                  onClick={() => handleOpenResetPassword(user)}
                                  className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Reset user password"
                                >
                                  <KeyRound className="w-3 h-3" />
                                  <span>Reset PW</span>
                                </button>

                                {!isSelf && (
                                  <button
                                    onClick={() => handleToggleStatus(user)}
                                    className={`px-2 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                      user.status === 'Active'
                                        ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                    }`}
                                    title={user.status === 'Active' ? 'Deactivate account' : 'Activate account'}
                                  >
                                    {user.status === 'Active' ? (
                                      <Lock className="w-3 h-3" />
                                    ) : (
                                      <Unlock className="w-3 h-3" />
                                    )}
                                    <span>{user.status === 'Active' ? 'Deactivate' : 'Activate'}</span>
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">View Only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ROLE PERMISSIONS MATRIX */}
      {activeTab === 'permissions' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Medical Store Role-Based Access Control (RBAC) — Interactive Permission Manager
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Super Admin can click any badge (V = View, C = Create, E = Edit, D = Delete, X = Export) to grant or revoke module permissions per role in real time. All changes are enforced on the backend API.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
              <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold">V</span> View
              <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold">C</span> Create
              <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white font-bold">E</span> Edit
              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold">D</span> Delete
              <span className="px-1.5 py-0.5 rounded bg-teal-600 text-white font-bold">X</span> Export
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <th className="py-3 px-4">ERP Module</th>
                  {ALL_ROLES.map((role) => (
                    <th key={role} className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ROLE_COLORS[role].bg} ${ROLE_COLORS[role].text}`}>
                        {role}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.keys(MODULE_LABELS).map((modKey) => (
                  <tr key={modKey} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 font-semibold text-slate-800">
                      {MODULE_LABELS[modKey]}
                      <span className="block font-mono text-[10px] text-slate-400">{modKey}</span>
                    </td>
                    {ALL_ROLES.map((role) => {
                      const perm = permissionsMatrix.find(
                        (p) => p.role === role && p.module_key === modKey
                      );
                      const canView = perm ? perm.can_view === 1 : role === 'Super Admin';
                      const canCreate = perm ? perm.can_create === 1 : role === 'Super Admin';
                      const canEdit = perm ? perm.can_edit === 1 : role === 'Super Admin';
                      const canDelete = perm ? perm.can_delete === 1 : role === 'Super Admin';
                      const canExport = perm ? perm.can_export === 1 : role === 'Super Admin';
                      const isLockedRole = role === 'Super Admin' || currentUser?.role !== 'Super Admin';

                      if (role === 'Super Admin') {
                        return (
                          <td key={role} className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold border border-purple-200">
                              Full Control (Locked)
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td key={role} className="py-2.5 px-2 text-center">
                          <div className="inline-flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={isLockedRole || actionLoading}
                              onClick={() => handleTogglePermission(role, modKey, 'can_view')}
                              title={`${role} — View ${MODULE_LABELS[modKey]}`}
                              className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                canView
                                  ? 'bg-emerald-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              V
                            </button>
                            <button
                              type="button"
                              disabled={isLockedRole || actionLoading}
                              onClick={() => handleTogglePermission(role, modKey, 'can_create')}
                              title={`${role} — Create in ${MODULE_LABELS[modKey]}`}
                              className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                canCreate
                                  ? 'bg-blue-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              C
                            </button>
                            <button
                              type="button"
                              disabled={isLockedRole || actionLoading}
                              onClick={() => handleTogglePermission(role, modKey, 'can_edit')}
                              title={`${role} — Edit in ${MODULE_LABELS[modKey]}`}
                              className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                canEdit
                                  ? 'bg-amber-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              E
                            </button>
                            <button
                              type="button"
                              disabled={isLockedRole || actionLoading}
                              onClick={() => handleTogglePermission(role, modKey, 'can_delete')}
                              title={`${role} — Delete in ${MODULE_LABELS[modKey]}`}
                              className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                canDelete
                                  ? 'bg-rose-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              D
                            </button>
                            <button
                              type="button"
                              disabled={isLockedRole || actionLoading}
                              onClick={() => handleTogglePermission(role, modKey, 'can_export')}
                              title={`${role} — Export ${MODULE_LABELS[modKey]}`}
                              className={`w-6 h-6 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                canExport
                                  ? 'bg-teal-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              X
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT & LOGIN HISTORY */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Filter Event:</span>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Events</option>
                <option value="LOGIN_SUCCESS">Successful Logins</option>
                <option value="LOGIN_FAILURE">Failed Login Attempts</option>
                <option value="ACCOUNT_LOCKED">Account Lockouts</option>
                <option value="LOGOUT">Voluntary Logouts</option>
                <option value="PASSWORD_RESET">Password Resets</option>
                <option value="USER_CREATED">User Creation</option>
                <option value="STATUS_CHANGED">Status Changes</option>
              </select>
            </div>

            <button
              onClick={fetchAuditLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Trail</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Security Action</th>
                  <th className="py-2.5 px-4">Client IP</th>
                  <th className="py-2.5 px-4">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-slate-400">
                      No security audit events recorded.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => {
                    let actionBadge = 'bg-slate-100 text-slate-700';
                    if (log.action === 'LOGIN_SUCCESS') actionBadge = 'bg-emerald-100 text-emerald-800';
                    if (log.action === 'LOGIN_FAILURE' || log.action === 'ACCOUNT_LOCKED')
                      actionBadge = 'bg-rose-100 text-rose-800';
                    if (log.action === 'PASSWORD_RESET') actionBadge = 'bg-amber-100 text-amber-800';

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {log.created_at}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-900">
                          @{log.username}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${actionBadge}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500">
                          {log.ip_address || '127.0.0.1'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 leading-snug">
                          {log.details || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: ADD NEW STAFF USER */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm">Add New Staff Member</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="e.g. Muhammad Asif"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. asif_cashier"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Initial Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full pl-3 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assigned Role <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-semibold text-slate-800 cursor-pointer"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+92 300 0000000"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="staff@abrarmedical.pk"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Designation / Operational Notes
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Night shift billing pharmacist"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Edit User: @{selectedUser.username}</h3>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-6 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Role Assignment
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold text-slate-800 cursor-pointer"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD */}
      {showResetPasswordModal && selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm">Reset Password: @{selectedUser.username}</h3>
              </div>
              <button
                onClick={() => setShowResetPasswordModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-6 space-y-3.5">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                <span className="font-bold">Security Notice:</span> Resetting this password will immediately invalidate all active sessions for{' '}
                <span className="font-mono font-bold">@{selectedUser.username}</span>. They must log in with the new password.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full pl-3 pr-8 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showResetPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowResetPasswordModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-amber-700 text-white hover:bg-amber-800 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Updating...' : 'Set New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
