import React, { useState } from 'react';
import {
  ShieldAlert,
  User,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Building2,
  Mail,
  Phone,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const FirstTimeSetupScreen: React.FC = () => {
  const { setupAdmin } = useAuth();
  const [fullName, setFullName] = useState('Abrar Aslam');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('abrar.aslam02@gmail.com');
  const [phone, setPhone] = useState('+92 300 1234567');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !username.trim() || !password) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      await setupAdmin({
        username: username.trim(),
        password,
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initialize Super Admin account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100 font-sans antialiased selection:bg-emerald-600 selection:text-white">
      {/* Top Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-black text-xl">
            A
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              ABRAR MEDICAL STORE
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                First-Time Setup
              </span>
            </div>
            <div className="text-xs text-slate-400">
              System Initialization & Security Provisioning
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Building2 className="w-4 h-4 text-emerald-400" />
          <span>Lahore, Pakistan (UTC+5)</span>
        </div>
      </header>

      {/* Main Setup Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-xl bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-slate-900 p-6 sm:p-7 text-white relative overflow-hidden">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-emerald-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">First-Time Super Admin Setup</h1>
                <p className="text-xs text-emerald-200/90">
                  Abrar Medical Store ERP — Initial Owner & Administrator Credential Setup
                </p>
              </div>
            </div>

            <div className="mt-3 p-3 rounded-xl bg-white/10 border border-white/10 text-xs text-emerald-100 flex items-start gap-2.5 leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Security Standard:</span> No public default passwords exist. Please create your own unique Super Admin credentials now. Once submitted, this setup wizard will lock permanently.
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4">
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{errorMessage}</div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Abrar Aslam"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Username */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Super Admin Username <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Master Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-9 pr-9 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Admin Email (Optional)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@abrarmedical.pk"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Emergency Phone (Optional)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+92 300 1234567"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Role Privilege Explanation */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Super Admin Permissions Assigned:
              </div>
              <ul className="list-disc list-inside text-slate-600 pl-1 space-y-0.5">
                <li>Full access to Sales, Billing, Returns & Draft Invoices</li>
                <li>Chart of Accounts, Customer/Supplier Ledgers & Double-Entry Journals</li>
                <li>Purchases, Goods Receipts & Advance Tax configuration</li>
                <li>Items Catalog, Batch Inventory & Loose Unit Conversions</li>
                <li>Staff User Management, Role Assignments & Password Resets</li>
              </ul>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white font-semibold text-sm shadow-md shadow-emerald-700/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Creating Super Admin Account...</span>
                  </>
                ) : (
                  <>
                    <span>Initialize Super Admin & Launch AMS ERP</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 text-center text-xs text-slate-400 border-t border-slate-800/80 bg-slate-950/60">
        <div>© {new Date().getFullYear()} Abrar Medical Store, Pakistan. All rights reserved.</div>
      </footer>
    </div>
  );
};
