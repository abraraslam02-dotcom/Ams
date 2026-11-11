import React, { useState } from 'react';
import {
  ShieldCheck,
  User,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Clock,
  CheckCircle2,
  Building2,
  X,
  Phone,
  Mail,
  KeyRound,
  ArrowRight,
  Laptop,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, getClientDeviceId, getClientDeviceName } from '../../services/api';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface LoginScreenProps {
  onSwitchToSetup?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lockoutMinutes, setLockoutMinutes] = useState<number | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [deviceApprovalBlock, setDeviceApprovalBlock] = useState<{
    registeredDeviceId?: string;
    registeredDeviceName?: string;
    requestedDeviceId?: string;
    requestedDeviceName?: string;
    message: string;
  } | null>(null);

  // Forgot Password Modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResponse, setForgotResponse] = useState<any | null>(null);

  const currentDeviceId = getClientDeviceId();
  const currentDeviceName = getClientDeviceName();

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('Please enter both your username and password.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      setLockoutMinutes(null);
      setAttemptsRemaining(null);
      setDeviceApprovalBlock(null);

      await login(username.trim(), password, rememberMe);
    } catch (err: any) {
      if (err.deviceApprovalRequired || err.code === 'DEVICE_APPROVAL_REQUIRED') {
        setDeviceApprovalBlock({
          registeredDeviceId: err.registeredDeviceId,
          registeredDeviceName: err.registeredDeviceName || 'Registered Workstation',
          requestedDeviceId: err.requestedDeviceId || currentDeviceId,
          requestedDeviceName: err.requestedDeviceName || currentDeviceName,
          message:
            err.message ||
            'Your account is registered to another device. Super Admin approval is required before logging in from this new device.',
        });
      } else if (err.locked) {
        setLockoutMinutes(err.remainingMinutes || 15);
        setErrorMessage(
          `Security Notice: This account is temporarily locked due to consecutive failed attempts. Please wait ${err.remainingMinutes || 15} minute(s) or contact the Super Administrator.`
        );
      } else {
        setErrorMessage(err.message || 'Invalid username or password.');
        if (typeof err.attemptsRemaining === 'number') {
          setAttemptsRemaining(err.attemptsRemaining);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setForgotLoading(true);
      const res = await api.forgotPassword(forgotUsername || username);
      setForgotResponse(res);
    } catch {
      setForgotResponse({
        success: true,
        message:
          'Please contact your Store Super Administrator directly. Medical ERP policy prohibits remote password resets via public links.',
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-slate-100 font-sans antialiased selection:bg-emerald-600 selection:text-white">
      {/* Top Bar Brand Info */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-700/60 bg-slate-900/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-black text-xl">
            A
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              ABRAR MEDICAL STORE
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                ERP v2.4
              </span>
            </div>
            <div className="text-xs text-slate-400">
              Licensed Pharmacy &amp; Medical Store Management System
            </div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Lahore, Pakistan</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>PKT (UTC+5)</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Single-Device Security Active</span>
          </div>
          <PWAInstallButton variant="login" />
        </div>
      </header>

      {/* Main Login Card Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* Card Header Banner */}
          <div className="bg-gradient-to-r from-emerald-800 to-teal-800 p-6 text-white text-center relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
            <div className="w-14 h-14 mx-auto rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-emerald-300 shadow-inner mb-3">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ABRAR MEDICAL STORE</h1>
            <p className="text-xs text-emerald-100/90 mt-1 max-w-xs mx-auto">
              Please enter your authorized username and password to access store inventory, billing &amp; accounts.
            </p>
          </div>

          {/* Form Area */}
          <div className="p-6 sm:p-8">
            {/* Device Approval Required Security Block */}
            {deviceApprovalBlock && (
              <div className="mb-5 p-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-950 text-xs space-y-3 shadow-xs">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-bold text-amber-950 text-sm">
                      Super Admin Device Approval Required
                    </div>
                    <p className="text-amber-900 mt-1 leading-relaxed">
                      Regular user accounts are restricted to <strong>1 registered device</strong>. An approval request for this new device has been sent to the Super Admin.
                    </p>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white/90 border border-amber-200 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 font-semibold">Registered Device:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {deviceApprovalBlock.registeredDeviceName} ({deviceApprovalBlock.registeredDeviceId})
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-amber-700 font-semibold">This Device (Pending):</span>
                    <span className="font-mono font-bold text-amber-900">
                      {deviceApprovalBlock.requestedDeviceName} ({deviceApprovalBlock.requestedDeviceId})
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-amber-800">
                    Once Super Admin approves, the previous device is automatically unregistered.
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleSubmit()}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    <span>Retry Login</span>
                  </button>
                </div>
              </div>
            )}

            {/* Lockout Warning Banner */}
            {lockoutMinutes && (
              <div className="mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Security Lockout Active</span>
                  <p className="text-amber-800 mt-0.5">
                    Account protected against brute force. Try again in{' '}
                    <span className="font-bold underline">{lockoutMinutes} minute(s)</span>.
                  </p>
                </div>
              </div>
            )}

            {/* General Error Banner */}
            {errorMessage && !lockoutMinutes && !deviceApprovalBlock && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-bold">Authentication Failed</span>
                  <p className="text-rose-800 mt-0.5">{errorMessage}</p>
                  {attemptsRemaining !== null && attemptsRemaining > 0 && (
                    <p className="text-rose-700 font-semibold mt-1">
                      {attemptsRemaining} attempt{attemptsRemaining > 1 ? 's' : ''} remaining before temporary 15-minute lockout.
                    </p>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin or pharmacist"
                    autoComplete="username"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all shadow-2xs"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotUsername(username);
                      setShowForgotModal(true);
                    }}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your secret password"
                    autoComplete="current-password"
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me Checkbox */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-600 font-medium">
                    Remember me on this registered device (30 days)
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || Boolean(lockoutMinutes)}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white font-semibold text-sm shadow-md shadow-emerald-700/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Verifying Credentials &amp; Device...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In to AMS ERP</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Security Notice & Workstation Device ID Footer */}
            <div className="mt-6 pt-4 border-t border-slate-100 space-y-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Super Admin: Any Device • Staff Users: 1 Registered Device</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-500 font-mono">
                <Laptop className="w-3 h-3 text-slate-400" />
                <span>
                  Device: {currentDeviceName} • {currentDeviceId}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Account Recovery &amp; Reset</h3>
              </div>
              <button
                onClick={() => {
                  setShowForgotModal(false);
                  setForgotResponse(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6">
              {!forgotResponse ? (
                <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                    Under pharmacy compliance policy, passwords cannot be reset via public email links. Please submit your username for verification assistance from the Store Super Administrator.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Your Registered Username
                    </label>
                    <input
                      type="text"
                      required
                      value={forgotUsername}
                      onChange={(e) => setForgotUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowForgotModal(false)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={forgotLoading}
                      className="px-4 py-2 text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                    >
                      {forgotLoading ? 'Checking...' : 'Submit Request'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Security Procedure Notice</div>
                      <div className="text-emerald-800 mt-1 leading-relaxed">
                        {forgotResponse.message}
                      </div>
                    </div>
                  </div>

                  {forgotResponse.supportContact && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                      <div className="font-bold text-slate-900">Administrator Contact Details:</div>
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{forgotResponse.supportContact.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{forgotResponse.supportContact.email}</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowForgotModal(false);
                      setForgotResponse(null);
                    }}
                    className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
                  >
                    Return to Login
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer Credentials Info */}
      <footer className="px-6 py-4 text-center text-xs text-slate-400 border-t border-slate-800/80 bg-slate-950/60">
        <div>
          © {new Date().getFullYear()} Abrar Medical Store, Pakistan. All rights reserved.
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          Strict Audit Trail Active • Single-Device Staff Login Protection Enabled
        </div>
      </footer>
    </div>
  );
};
