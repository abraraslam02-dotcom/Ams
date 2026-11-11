import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Users,
  ShieldCheck,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Search,
  RefreshCw,
  Eye,
  EyeOff,
  X,
  History,
  UserCheck,
  UserX,
  Clock,
  ShieldAlert,
  Sparkles,
  Laptop,
} from 'lucide-react';
import { api } from '../../services/api';
import { User, UserRole, AuditLog } from '../../types/auth';
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

export const UserPasswordManagementView: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Reset Password Modal
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forceChangeOnNextLogin, setForceChangeOnNextLogin] = useState(true);
  const [showPasswordText, setShowPasswordText] = useState(false);

  const isSuperAdmin = currentUser?.role === 'Super Admin';

  const loadData = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [usersRes, logsRes] = await Promise.all([
        api.getUsers(),
        api.getAuditLogs({ limit: 100 }),
      ]);
      if (usersRes.success) {
        setUsers(usersRes.users || []);
      }
      if (logsRes.success) {
        // Filter audit logs related to password resets and user status/account changes
        const relevantActions = new Set([
          'PASSWORD_RESET',
          'PASSWORD_CHANGED_SELF',
          'FORCE_PASSWORD_CHANGE_TOGGLED',
          'USER_STATUS_CHANGED',
          'USER_CREATED',
          'USER_UPDATED',
          'ACCOUNT_LOCKED',
        ]);
        const filtered = (logsRes.logs || []).filter((log) => relevantActions.has(log.action));
        setAuditLogs(filtered);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load user password management data');
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!isSuperAdmin) {
    return (
      <div className="p-8 max-w-xl mx-auto mt-10 bg-white rounded-2xl border border-rose-200 shadow-sm text-center">
        <ShieldAlert className="w-12 h-12 text-rose-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Super Admin Access Required</h2>
        <p className="text-xs text-slate-600 mt-1">
          Only a registered Super Admin can view users, reset passwords, or manage account security status.
        </p>
      </div>
    );
  }

  const openResetModal = (u: User) => {
    setSelectedUser(u);
    setNewPassword('');
    setConfirmPassword('');
    setForceChangeOnNextLogin(u.id !== currentUser?.id);
    setShowPasswordText(false);
    setError(null);
    setShowResetModal(true);
  };

  const generateStrongPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(pass);
    setConfirmPassword(pass);
    setShowPasswordText(true);
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError(null);
    setSuccessMessage(null);

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation password do not match.');
      return;
    }

    setActionLoading(true);
    try {
      const res = await api.resetUserPassword(
        selectedUser.id,
        newPassword,
        forceChangeOnNextLogin
      );
      setSuccessMessage(res.message || `Password reset for @${selectedUser.username}`);
      setShowResetModal(false);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (u: User) => {
    const nextStatus = u.status === 'Active' ? 'Inactive' : 'Active';
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.updateUserStatus(u.id, nextStatus);
      setSuccessMessage(res.message || `Updated @${u.username} status to ${nextStatus}`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change account status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleForceChange = async (u: User) => {
    const currentForced = Boolean(u.force_password_change);
    const nextForced = !currentForced;
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.toggleForcePasswordChange(u.id, nextForced);
      setSuccessMessage(res.message);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update force password change flag');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveDevice = async (u: User) => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.approveUserDevice(u.id);
      setSuccessMessage(res.message);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve user device');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectDevice = async (u: User) => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.rejectUserDevice(u.id);
      setSuccessMessage(res.message);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject device request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnregisterDevice = async (u: User) => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.unregisterUserDevice(u.id);
      setSuccessMessage(res.message);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unregister device');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      !searchQuery.trim() ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const activeCount = users.filter((u) => u.status === 'Active').length;
  const inactiveCount = users.filter((u) => u.status !== 'Active').length;
  const forcedCount = users.filter((u) => Boolean(u.force_password_change)).length;

  return (
    <div className="space-y-5">
      {/* Top Banner & Metrics */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-5 text-white shadow-md border border-slate-700/80 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">
                User Password & Credential Management
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-400/30 rounded-md">
                Super Admin Exclusive
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Reset or change any user&apos;s password, enforce password change on next login, activate/deactivate accounts, and audit credential changes.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3.5 py-2 rounded-xl bg-slate-800/90 border border-slate-700 text-xs">
            <span className="text-slate-400 block text-[10px]">Total Users</span>
            <span className="font-bold text-white text-sm">{users.length}</span>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-700/50 text-xs">
            <span className="text-emerald-300 block text-[10px]">Active Accounts</span>
            <span className="font-bold text-emerald-400 text-sm">{activeCount}</span>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-rose-950/60 border border-rose-700/50 text-xs">
            <span className="text-rose-300 block text-[10px]">Inactive / Locked</span>
            <span className="font-bold text-rose-400 text-sm">{inactiveCount}</span>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-amber-950/60 border border-amber-700/50 text-xs">
            <span className="text-amber-300 block text-[10px]">Force Change Pending</span>
            <span className="font-bold text-amber-400 text-sm">{forcedCount}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username, full name, or role..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 cursor-pointer"
          >
            <option value="all">All Roles</option>
            <option value="Super Admin">Super Admin</option>
            <option value="Administrator">Administrator</option>
            <option value="Accountant">Accountant</option>
            <option value="Salesman">Salesman</option>
            <option value="Purchase Operator">Purchase Operator</option>
            <option value="Viewer">Viewer</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Pending Device Approval Requests Alert */}
      {users.some((u) => Boolean(u.pending_device_id)) && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-950 font-bold text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Pending New Device Login Approvals (
                {users.filter((u) => Boolean(u.pending_device_id)).length})
              </span>
            </div>
            <span className="text-[11px] text-amber-800">
              Approving a new device automatically unregisters the previous device.
            </span>
          </div>
          <div className="divide-y divide-amber-200 bg-white rounded-xl border border-amber-200 overflow-hidden">
            {users
              .filter((u) => Boolean(u.pending_device_id))
              .map((u) => (
                <div
                  key={u.id}
                  className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">
                      {u.full_name} <span className="font-mono text-emerald-700">@{u.username}</span>{' '}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {u.role}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Registered:{' '}
                      <strong className="font-mono">
                        {u.registered_device_name || 'Workstation'} ({u.registered_device_id})
                      </strong>{' '}
                      → New Device Request:{' '}
                      <strong className="font-mono text-amber-900">
                        {u.pending_device_name || 'New Device'} ({u.pending_device_id})
                      </strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleApproveDevice(u)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve New Device
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleRejectDevice(u)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Users Credential Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-700" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Registered Users, Device Security &amp; Password Controls ({filteredUsers.length})
            </h2>
          </div>
          <span className="text-[11px] text-slate-500">
            Super Admin: Any Device • Regular Users: 1 Registered Device
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-600 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                <th className="py-2.5 px-4">ID</th>
                <th className="py-2.5 px-4">Username &amp; Full Name</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Registered Device</th>
                <th className="py-2.5 px-4">Account Status</th>
                <th className="py-2.5 px-4">Next Login Policy</th>
                <th className="py-2.5 px-4 text-right">Super Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 text-xs">
              {filteredUsers.map((u) => {
                const roleStyle = ROLE_COLORS[u.role] || ROLE_COLORS.Viewer;
                const isForced = Boolean(u.force_password_change);
                return (
                  <tr key={u.id} className="hover:bg-slate-50/90 transition">
                    <td className="py-3 px-4 font-mono text-slate-500 font-semibold">
                      #{u.id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="font-mono text-emerald-700">@{u.username}</span>
                        {u.id === currentUser?.id && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded font-bold">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-slate-600 text-[11px]">{u.full_name}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {u.role === 'Super Admin' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold">
                          <ShieldCheck className="w-3 h-3" />
                          Any Device Allowed
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {u.registered_device_id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                                <Laptop className="w-3 h-3 text-emerald-600" />
                                {u.registered_device_name || 'Registered Device'}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                ({u.registered_device_id})
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Registers on 1st login
                            </span>
                          )}
                          {u.pending_device_id && (
                            <div className="p-1.5 rounded-lg bg-amber-50 border border-amber-300 text-[10px] text-amber-950 space-y-1">
                              <div className="font-bold text-amber-900">
                                Pending: {u.pending_device_name} ({u.pending_device_id})
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleApproveDevice(u)}
                                  className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                                >
                                  Approve New Device
                                </button>
                                <button
                                  type="button"
                                  disabled={actionLoading}
                                  onClick={() => handleRejectDevice(u)}
                                  className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {u.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          {u.status}
                        </span>
                      )}
                      {u.failed_login_attempts > 0 && (
                        <div className="text-[10px] text-amber-600 font-medium mt-0.5">
                          Failed attempts: {u.failed_login_attempts}/5
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleForceChange(u)}
                        disabled={actionLoading}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1.5 cursor-pointer transition ${
                          isForced
                            ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                        title="Click to toggle requirement to change password on next login"
                      >
                        {isForced ? (
                          <>
                            <Lock className="w-3 h-3 text-amber-600" />
                            Must Change at Login
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3 h-3 text-slate-400" />
                            Standard Login
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {u.role !== 'Super Admin' && u.registered_device_id && (
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleUnregisterDevice(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1 cursor-pointer transition"
                            title="Unregister current device"
                          >
                            <Laptop className="w-3.5 h-3.5" />
                            Reset Device
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openResetModal(u)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer transition"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset Password
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          disabled={actionLoading}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1 border cursor-pointer transition ${
                            u.status === 'Active'
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                          }`}
                        >
                          {u.status === 'Active' ? (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Activate
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    No matching users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Password Reset & Account Changes Audit Log */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-amber-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Password Reset & Account Security Audit Trail ({auditLogs.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Immutable chronological log of password changes and account activations
          </span>
        </div>

        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-600 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200 sticky top-0">
                <th className="py-2 px-4">Timestamp</th>
                <th className="py-2 px-4">Performed By</th>
                <th className="py-2 px-4">Action</th>
                <th className="py-2 px-4">Status</th>
                <th className="py-2 px-4">IP Address</th>
                <th className="py-2 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 text-xs">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatPKTDate(log.created_at)} {formatPKTTime(log.created_at)}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-bold text-slate-800">
                    @{log.username}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] font-bold text-slate-700">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.status === 'SUCCESS'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                    {log.ip_address || '127.0.0.1'}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {log.details}
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400 text-xs">
                    No password reset or account change events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm">
                  Reset Password — @{selectedUser.username}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                <div>
                  <span className="font-bold">Target User:</span> {selectedUser.full_name} ({selectedUser.role})
                </div>
                <div className="mt-1 text-[11px]">
                  Resetting this password immediately revokes any active login sessions for{' '}
                  <span className="font-mono font-bold">@{selectedUser.username}</span> and records an entry in the Super Admin Security Audit Log.
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    New Password <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateStrongPassword}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    Auto-Generate Strong Password
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceChangeOnNextLogin}
                  onChange={(e) => setForceChangeOnNextLogin(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 block">
                    Force password change at next login
                  </span>
                  <span className="text-slate-500 text-[11px]">
                    Requires @{selectedUser.username} to choose a new personal password immediately upon signing in.
                  </span>
                </div>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Resetting Password...' : 'Confirm Password Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
