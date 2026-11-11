import React, { useState } from 'react';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ForgotPasswordModal } from './ForgotPasswordModal';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter both your username/email and password.');
      return;
    }

    try {
      setLoading(true);
      await login(username.trim(), password, rememberMe);
      // Automatically opens the Dashboard upon state update in AuthContext
    } catch (err: any) {
      console.error('[Login Failed]', err);
      const msg =
        err?.message ||
        (err?.code === 'ACCOUNT_DEACTIVATED'
          ? 'Your account is deactivated. Please contact the Super Administrator.'
          : 'Invalid username/email or password. Please try again.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Decorative background gradients */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Brand Banner */}
        <div className="bg-slate-900 px-8 pt-8 pb-7 text-white text-center relative border-b border-slate-800">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 items-center justify-center font-black text-2xl shadow-xl shadow-emerald-600/30 mb-3.5 tracking-tight">
            A
          </div>
          <h1 className="text-xl font-black tracking-tight text-white uppercase">
            Abrar Medical Store
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Pharmacy ERP & Medical Retail Management System
          </p>

          <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-semibold text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Secure System Access</span>
          </div>
        </div>

        {/* Login Form Body */}
        <div className="p-8">
          {passwordResetSuccess && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Password successfully reset! Please log in with your new credentials.</span>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username or Email */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Username or Email <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin or user@abrarmedical.pk"
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all font-medium"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Password <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotModal(true)}
                  className="text-[11.5px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all font-medium"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me Toggle */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
                <span className="text-xs text-slate-600 font-medium">Keep me signed in</span>
              </label>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs tracking-wide transition-all shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{loading ? 'Authenticating...' : 'Sign In to Workspace'}</span>
              </button>
            </div>
          </form>

          {/* Super Admin Initial Access Helper */}
          <div className="mt-6 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-left">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Super Admin Default Access
              </span>
              <button
                type="button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('MasterAdmin@2026');
                  setError(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-700 text-[11px] font-bold transition-colors cursor-pointer"
              >
                Auto-Fill Admin
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 font-mono bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/60">
              <div>
                <span className="text-slate-400 font-sans">User:</span>{' '}
                <strong className="text-slate-800">admin</strong>
              </div>
              <div>
                <span className="text-slate-400 font-sans">Pass:</span>{' '}
                <strong className="text-slate-800">MasterAdmin@2026</strong>
              </div>
            </div>
          </div>

          {/* Salesman Mobile Booking App Launcher */}
          <div className="mt-4">
            <a
              href="/?mode=mobile-booking"
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <span>Open Salesman Mobile Booking App (Android / Offline PWA)</span>
            </a>
          </div>

          {/* Footer note */}
          <div className="mt-5 pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400">
              Authorized personnel only. Password recovery verification codes are forwarded to the registered Super Administrator.
            </p>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        isOpen={showForgotModal}
        onClose={() => setShowForgotModal(false)}
        initialUsername={username}
        onSuccess={() => {
          setPasswordResetSuccess(true);
          setPassword('');
        }}
      />
    </div>
  );
};
