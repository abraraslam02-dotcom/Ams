import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  X,
  Mail,
  ShieldCheck,
  Clock,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { api } from '../../services/api';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialUsername?: string;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialUsername = '',
}) => {
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [maskedAdminEmail, setMaskedAdminEmail] = useState<string>('');
  const [devCode, setDevCode] = useState<string | null>(null);

  // 10-minute countdown timer for code expiration
  const [secondsRemaining, setSecondsRemaining] = useState<number>(600);

  useEffect(() => {
    if (isOpen) {
      setUsername(initialUsername);
      setStep('request');
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccessMessage(null);
      setDevCode(null);
      setSecondsRemaining(600);
    }
  }, [isOpen, initialUsername]);

  useEffect(() => {
    if (step !== 'verify') return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  if (!isOpen) return null;

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter your username or email address.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await api.forgotPassword(username.trim());

      setMaskedAdminEmail(res.maskedEmail || 'Super Admin Email');
      if (res.code) {
        setDevCode(res.code);
      }
      setSecondsRemaining(600);
      setStep('verify');
    } catch (err: any) {
      setError(err?.message || 'Failed to request password reset code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!code.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }

    try {
      setLoading(true);
      await api.resetPassword({
        username: username.trim(),
        code: code.trim(),
        new_password: newPassword,
      });

      setSuccessMessage('Password reset successfully! You can now log in with your new password.');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Please check the code with your Super Admin.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">Password Recovery</h3>
              <p className="text-[11px] text-slate-400">Super Admin Email Verification System</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice Bar */}
        <div className="bg-emerald-50 border-b border-emerald-100 px-5 py-2.5 flex items-start gap-2.5 text-xs text-emerald-900">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed text-[11.5px]">
            For medical store security, verification codes are dispatched automatically to the registered Super Admin.
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>{successMessage}</div>
            </div>
          )}

          {step === 'request' ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Enter Username or Registered Email <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin or accountant"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-medium"
                    autoFocus
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  A 6-digit one-time code will be dispatched to the Super Admin's email address.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20 disabled:opacity-50"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Generate Verification Code</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-1">
                <div className="flex items-center justify-between font-semibold text-[11px] text-slate-500">
                  <span>DISPATCHED TO SUPER ADMIN</span>
                  <div className="flex items-center gap-1 text-emerald-700 font-mono font-bold">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    <span>{formatTime(secondsRemaining)}</span>
                  </div>
                </div>
                <div className="font-bold text-slate-900">{maskedAdminEmail}</div>
                <p className="text-[11px] text-slate-500">
                  Please contact your Super Admin to obtain the 6-digit code.
                </p>
              </div>

              {devCode && (
                <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-[11px] text-amber-800 flex items-center justify-between">
                  <span>Development Verification Code:</span>
                  <span className="font-mono font-bold text-xs bg-amber-200/60 px-2 py-0.5 rounded text-amber-900">
                    {devCode}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  6-Digit Verification Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 123456"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-center tracking-[0.3em] font-mono text-base font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 pr-10 font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-medium"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('request')}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                >
                  ← Resend or change username
                </button>
                <button
                  type="submit"
                  disabled={loading || secondsRemaining === 0}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20 disabled:opacity-50"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save New Password</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
