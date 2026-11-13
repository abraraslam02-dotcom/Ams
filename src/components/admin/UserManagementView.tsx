import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  Key,
  CheckCircle2,
  XCircle,
  Edit,
  Trash2,
  Power,
  RefreshCw,
  Search,
  Lock,
  Mail,
  Phone,
  AlertCircle,
  Eye,
  EyeOff,
  Sliders,
  CheckSquare,
  Square,
  Save,
  HelpCircle,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { User, ModulePermission } from '../../types/auth';
import { useAuth } from '../../context/AuthContext';

const MODULES_LIST = [
  { key: 'dashboard', label: 'Dashboard', desc: 'Store executive dashboard and KPIs' },
  { key: 'items', label: 'Items / Inventory', desc: 'Item master catalog, batches, and stock management' },
  { key: 'accounts', label: 'Accounts', desc: 'Customer & supplier chart of accounts and ledgers' },
  { key: 'sales', label: 'Sales', desc: 'Sales invoices and sales register' },
  { key: 'purchases', label: 'Purchases', desc: 'Purchase bills and supplier invoices' },
  { key: 'sale_returns', label: 'Sales Return', desc: 'Customer sales returns and credit notes' },
  { key: 'purchase_returns', label: 'Purchase Return', desc: 'Supplier purchase returns and debit notes' },
  { key: 'cashbook', label: 'Cashbook', desc: 'Daily cash book receipts and payments' },
  { key: 'expenses', label: 'Expenses', desc: 'Operational expense vouchers' },
  { key: 'reports', label: 'Reports', desc: 'Financial statements, sales, and inventory analytics' },
  { key: 'closing', label: 'Closing Management', desc: 'Daily, Monthly, Yearly & Stock Closing, Carry-Forward, and Period Reports' },
  { key: 'backup', label: 'Backup & Restore', desc: 'Database backup creation and recovery' },
  { key: 'settings', label: 'Application Settings', desc: 'Store settings, printer setup, and more options' },
  { key: 'users', label: 'User Management', desc: 'Super Admin user accounts and individual permissions' },
];

const ACTION_KEYS = [
  { key: 'can_view', label: 'View' },
  { key: 'can_create', label: 'Add' },
  { key: 'can_edit', label: 'Edit' },
  { key: 'can_delete', label: 'Delete' },
  { key: 'can_print', label: 'Print' },
  { key: 'can_export', label: 'Export' },
] as const;

export const UserManagementView: React.FC = () => {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  // Super Admin Recovery Email state
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');
  const [savingEmail, setSavingEmail] = useState<boolean>(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<User | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<User | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);

  // Form states for Add/Edit
  const [formData, setFormData] = useState({
    full_name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    status: 'Active' as 'Active' | 'Inactive',
    notes: '',
  });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset Password Modal state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  // Permissions Matrix state for selected user
  const [permissionsMap, setPermissionsMap] = useState<Record<string, ModulePermission>>({});
  const [permsSaving, setPermsSaving] = useState(false);
  const [permsError, setPermsError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getUsers();
      setUsers(res.users || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load staff users');
    } finally {
      setLoading(false);
    }
  };

  const fetchRecoveryEmail = async () => {
    try {
      const res = await api.getSuperAdminRecoveryEmail();
      if (res?.email) {
        setRecoveryEmail(res.email);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRecoveryEmail();
  }, []);

  const handleSaveRecoveryEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryEmail || !recoveryEmail.includes('@')) {
      setError('Please enter a valid recovery email address');
      return;
    }
    try {
      setSavingEmail(true);
      setError(null);
      await api.updateSuperAdminRecoveryEmail(recoveryEmail.trim());
      setEmailSuccess('Super Admin recovery email updated successfully.');
      setTimeout(() => setEmailSuccess(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Failed to update recovery email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleOpenAddModal = () => {
    setFormData({
      full_name: '',
      username: '',
      email: '',
      phone: '',
      password: '',
      confirm_password: '',
      status: 'Active',
      notes: '',
    });
    setFormError(null);
    setShowFormPassword(false);
    setShowAddModal(true);
  };

  const handleOpenEditModal = (u: User) => {
    setEditingUser(u);
    setFormData({
      full_name: u.full_name || '',
      username: u.username || '',
      email: u.email || '',
      phone: u.phone || '',
      password: '',
      confirm_password: '',
      status: u.status as 'Active' | 'Inactive',
      notes: u.notes || '',
    });
    setFormError(null);
  };

  const handleOpenPermissionsModal = (u: User) => {
    setPermissionsUser(u);
    setPermsError(null);

    // Deep clone user's permissions or populate default matrix
    const current = u.permissions || {};
    const populated: Record<string, ModulePermission> = {};

    MODULES_LIST.forEach((m) => {
      const existing = current[m.key];
      populated[m.key] = {
        module_key: m.key,
        can_view: existing?.can_view !== undefined ? existing.can_view : (m.key === 'users' ? false : true),
        can_create: existing?.can_create !== undefined ? existing.can_create : (m.key === 'users' ? false : true),
        can_edit: existing?.can_edit !== undefined ? existing.can_edit : (m.key === 'users' ? false : true),
        can_delete: existing?.can_delete !== undefined ? existing.can_delete : false,
        can_print: existing?.can_print !== undefined ? existing.can_print : true,
        can_export: existing?.can_export !== undefined ? existing.can_export : (m.key === 'users' ? false : true),
      };
    });

    setPermissionsMap(populated);
  };

  const handleTogglePerm = (moduleKey: string, actionKey: keyof ModulePermission) => {
    if (permissionsUser?.role === 'Super Admin') return; // Super admin always full
    setPermissionsMap((prev) => {
      const current = prev[moduleKey] || {
        module_key: moduleKey,
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false,
        can_print: false,
        can_export: false,
      };

      const nextVal = !current[actionKey];
      return {
        ...prev,
        [moduleKey]: {
          ...current,
          [actionKey]: nextVal,
          // If enabling create/edit/delete/print/export, automatically enable view
          ...(actionKey !== 'can_view' && nextVal ? { can_view: true } : {}),
          // If disabling view, automatically disable all other actions
          ...(actionKey === 'can_view' && !nextVal
            ? {
                can_create: false,
                can_edit: false,
                can_delete: false,
                can_print: false,
                can_export: false,
              }
            : {}),
        },
      };
    });
  };

  const handleSelectAllPerms = (enableAll: boolean) => {
    if (permissionsUser?.role === 'Super Admin') return;
    setPermissionsMap((prev) => {
      const updated: Record<string, ModulePermission> = {};
      MODULES_LIST.forEach((m) => {
        updated[m.key] = {
          module_key: m.key,
          can_view: enableAll,
          can_create: enableAll,
          can_edit: enableAll,
          can_delete: enableAll,
          can_print: enableAll,
          can_export: enableAll,
        };
      });
      return updated;
    });
  };

  const handleSavePermissions = async () => {
    if (!permissionsUser) return;
    try {
      setPermsSaving(true);
      setPermsError(null);
      await api.updateUser(permissionsUser.id, {
        permissions: permissionsMap,
      });

      setSuccess(`Permissions updated for @${permissionsUser.username} and applied immediately.`);
      setTimeout(() => setSuccess(null), 3500);
      setPermissionsUser(null);
      fetchUsers();
    } catch (err: any) {
      setPermsError(err?.message || 'Failed to save individual permissions.');
    } finally {
      setPermsSaving(false);
    }
  };

  const handleToggleStatus = async (u: User) => {
    if (u.role === 'Super Admin') {
      setError('Cannot deactivate the primary Super Admin account.');
      return;
    }
    const newStatus = u.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await api.updateUserStatus(u.id, newStatus);
      setSuccess(`User @${u.username} status set to ${newStatus}.`);
      setTimeout(() => setSuccess(null), 3000);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to update user status.');
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteConfirmUser) return;
    try {
      await api.deleteUser(deleteConfirmUser.id);
      setSuccess(`User @${deleteConfirmUser.username} deleted successfully.`);
      setTimeout(() => setSuccess(null), 3000);
      setDeleteConfirmUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete user.');
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (formData.password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (formData.password !== formData.confirm_password) {
      setFormError('Password and confirmation password do not match.');
      return;
    }

    try {
      setFormSubmitting(true);
      await api.createUser({
        full_name: formData.full_name.trim(),
        username: formData.username.trim(),
        email: formData.email.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        password: formData.password,
        status: formData.status,
        notes: formData.notes.trim() || undefined,
      });

      setSuccess(`User @${formData.username} created successfully!`);
      setTimeout(() => setSuccess(null), 3000);
      setShowAddModal(false);
      fetchUsers();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create user.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setFormError(null);

    try {
      setFormSubmitting(true);
      await api.updateUser(editingUser.id, {
        full_name: formData.full_name.trim(),
        email: formData.email.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        status: formData.status,
        notes: formData.notes.trim() || undefined,
      });

      setSuccess(`User @${editingUser.username} updated successfully.`);
      setTimeout(() => setSuccess(null), 3000);
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update user.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdUser) return;
    setPwdError(null);

    if (newPassword.length < 6) {
      setPwdError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPwdError('Passwords do not match.');
      return;
    }

    try {
      setPwdSubmitting(true);
      await api.resetUserPassword(resetPwdUser.id, newPassword);
      setSuccess(`Password for @${resetPwdUser.username} has been reset.`);
      setTimeout(() => setSuccess(null), 3000);
      setResetPwdUser(null);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setPwdError(err?.message || 'Failed to reset password.');
    } finally {
      setPwdSubmitting(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q))
    );
  }, [users, search]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-emerald-600/20">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Staff & User Management</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                Super Admin Only
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Create staff accounts, assign granular module permissions, and manage password security.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={fetchUsers}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Refresh user list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20 shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create New User</span>
          </button>
        </div>
      </div>

      {/* Super Admin Password Recovery Email Configuration Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white tracking-wide uppercase">
              Super Admin Password Recovery Email Address
            </span>
          </div>
          <p className="text-[11.5px] text-slate-400 max-w-xl">
            When any staff user clicks &quot;Forgot Password&quot;, the 10-minute security verification code is dispatched automatically to this email address.
          </p>
        </div>

        <form onSubmit={handleSaveRecoveryEmail} className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <input
              type="email"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              placeholder="admin@abrarmedical.pk"
              required
              className="w-full px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={savingEmail}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {savingEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Update Email</span>
          </button>
        </form>
      </div>

      {emailSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{emailSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2 font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Users Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, or email..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Showing <strong className="text-slate-800">{filteredUsers.length}</strong> of{' '}
            <strong className="text-slate-800">{users.length}</strong> users
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                <th className="py-3 px-4">User Details</th>
                <th className="py-3 px-4">Role & Access</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Last Login</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No staff users found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSuper = u.role === 'Super Admin';
                  const isSelf = u.id === currentUser?.id;
                  const isActive = u.status === 'Active';

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Name & Username */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                              isSuper
                                ? 'bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {u.full_name?.charAt(0) || u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{u.full_name}</span>
                              {isSelf && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">@{u.username}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role & Permissions Badge */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                              isSuper
                                ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                : 'bg-slate-100 text-slate-800 border border-slate-200'
                            }`}
                          >
                            <Shield className="w-3 h-3" />
                            <span>{u.role}</span>
                          </span>
                          {!isSuper && (
                            <button
                              onClick={() => handleOpenPermissionsModal(u)}
                              className="block text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline cursor-pointer"
                            >
                              Configure Permissions →
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          disabled={isSuper}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-[11px] transition-colors ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer'
                              : 'bg-rose-100 text-rose-800 hover:bg-rose-200 cursor-pointer'
                          } ${isSuper ? 'cursor-default opacity-90' : ''}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-600' : 'bg-rose-600'}`} />
                          <span>{u.status}</span>
                        </button>
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 text-[11.5px] text-slate-500">
                        <div>{u.email || '—'}</div>
                        <div className="text-[11px] text-slate-400">{u.phone || '—'}</div>
                      </td>

                      {/* Last Login */}
                      <td className="py-3.5 px-4 text-[11.5px] text-slate-500">
                        {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never logged in'}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Permissions */}
                          {!isSuper && (
                            <button
                              onClick={() => handleOpenPermissionsModal(u)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                              title="Assign Individual Permissions"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>
                          )}

                          {/* Reset Password */}
                          <button
                            onClick={() => {
                              setResetPwdUser(u);
                              setNewPassword('');
                              setConfirmNewPassword('');
                              setPwdError(null);
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                            title="Reset User Password"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          {/* Edit Details */}
                          <button
                            onClick={() => handleOpenEditModal(u)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Edit User Profile"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {/* Delete */}
                          {!isSuper && (
                            <button
                              onClick={() => setDeleteConfirmUser(u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: ADD USER */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm">Add New Staff User</h3>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="e.g. Muhammad Ali"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().trim() })}
                    placeholder="e.g. mali2026"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Email (Optional)</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="ali@abrarmedical.pk"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Mobile Number (Optional)</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="0300-1234567"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showFormPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Minimum 6 characters"
                      required
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFormPassword(!showFormPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showFormPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type={showFormPassword ? 'text' : 'password'}
                    value={formData.confirm_password}
                    onChange={(e) => setFormData({ ...formData, confirm_password: e.target.value })}
                    placeholder="Re-enter password"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                >
                  <option value="Active">Active (Can log in immediately)</option>
                  <option value="Inactive">Inactive (Access temporarily disabled)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20 disabled:opacity-50"
                >
                  {formSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save New User</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT USER */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Edit className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm">Edit User: @{editingUser.username}</h3>
              </div>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  disabled={editingUser.role === 'Super Admin'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
                {editingUser.role === 'Super Admin' && (
                  <p className="text-[11px] text-slate-400 mt-1">Super Admin account status cannot be changed.</p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {formSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: INDIVIDUAL USER PERMISSIONS MATRIX */}
      {permissionsUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    Individual User Permissions — @{permissionsUser.username} ({permissionsUser.full_name})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Assign exact module rights (View, Add, Edit, Delete, Print, Export) enforced at database level.
                  </p>
                </div>
              </div>
              <button onClick={() => setPermissionsUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border-b border-slate-200 px-6 py-2.5 flex items-center justify-between">
              <div className="text-xs text-slate-600 font-medium">
                Changes apply immediately after saving. Unauthorized actions are hidden or disabled in UI.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectAllPerms(true)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllPerms(false)}
                  className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            {permsError && (
              <div className="m-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{permsError}</span>
              </div>
            )}

            <div className="p-6 overflow-y-auto space-y-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                    <th className="py-2.5 px-4 w-1/3">Module Name</th>
                    {ACTION_KEYS.map((act) => (
                      <th key={act.key} className="py-2.5 px-3 text-center">
                        {act.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MODULES_LIST.map((mod) => {
                    const rowPerm = permissionsMap[mod.key] || {
                      module_key: mod.key,
                      can_view: false,
                      can_create: false,
                      can_edit: false,
                      can_delete: false,
                      can_print: false,
                      can_export: false,
                    };

                    return (
                      <tr key={mod.key} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-800">{mod.label}</div>
                          <div className="text-[11px] text-slate-400">{mod.desc}</div>
                        </td>

                        {ACTION_KEYS.map((act) => {
                          const checked = Boolean(rowPerm[act.key]);
                          return (
                            <td key={act.key} className="py-3 px-3 text-center">
                              <label className="inline-flex items-center justify-center p-1 rounded hover:bg-slate-200/50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleTogglePerm(mod.key, act.key)}
                                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPermissionsUser(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePermissions}
                disabled={permsSaving}
                className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20 disabled:opacity-50"
              >
                {permsSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Save & Apply Permissions</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: RESET USER PASSWORD */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Key className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm">Reset Password for @{resetPwdUser.username}</h3>
              </div>
              <button onClick={() => setResetPwdUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-6 space-y-4">
              {pwdError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{pwdError}</span>
                </div>
              )}

              <p className="text-xs text-slate-600">
                Enter a new password for staff account <strong>@{resetPwdUser.username}</strong> ({resetPwdUser.full_name}).
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setResetPwdUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pwdSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {pwdSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Set Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: DELETE CONFIRMATION */}
      {deleteConfirmUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Delete User Account?</h4>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to permanently delete user <strong>@{deleteConfirmUser.username}</strong> ({deleteConfirmUser.full_name})? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmUser(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Yes, Delete User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
