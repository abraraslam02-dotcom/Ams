import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  AlertTriangle,
  Filter,
  Trash2,
  FileWarning,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../services/api';
import { AuditLog } from '../../types/auth';
import { SystemErrorLog } from '../../types/system';
import { formatPKTDate, formatPKTTime } from '../../utils/formatters';

interface SecurityAuditViewProps {
  onNavigateToClearDemoData?: () => void;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  onNavigateToClearDemoData,
}) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [errorLogs, setErrorLogs] = useState<SystemErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showClearLogsConfirm, setShowClearLogsConfirm] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Filters
  const [searchUsername, setSearchUsername] = useState('');
  const [selectedAction, setSelectedAction] = useState('all');

  const safeFormatDate = (val: string) => {
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val || '—';
      return formatPKTDate(d);
    } catch {
      return val || '—';
    }
  };

  const safeFormatTime = (val: string) => {
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return formatPKTTime(d);
    } catch {
      return '';
    }
  };

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [auditRes, errRes] = await Promise.all([
        api
          .getAuditLogs({
            username: searchUsername || undefined,
            action: selectedAction !== 'all' ? selectedAction : undefined,
            limit: 100,
          })
          .catch(() => ({ logs: [] })),
        api.getSystemErrorLogs().catch(() => ({ logs: [] })),
      ]);
      setLogs(auditRes.logs || []);
      setErrorLogs(errRes.logs || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch system and security logs');
    } finally {
      setLoading(false);
    }
  }, [searchUsername, selectedAction]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleResolveErrorLog = async (id: number) => {
    try {
      await api.resolveSystemErrorLog(id);
      await fetchLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve error log');
    }
  };

  const handleClearDemoLogs = async () => {
    try {
      setClearingLogs(true);
      setError(null);
      setSuccessMsg(null);
      const res = await api.clearDemoLogs();
      setSuccessMsg(
        res.message ||
          `Demo & temporary logs cleared. (Error Logs: ${res.result?.deletedErrorLogs ?? 0}, Demo Audit Logs: ${res.result?.deletedDemoAuditLogs ?? 0})`
      );
      setShowClearLogsConfirm(false);
      await fetchLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to clear demo logs');
    } finally {
      setClearingLogs(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'FAILED':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'WARNING':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              System, Security &amp; Audit Logs
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 text-white">
              WAL Permanent Record
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time immutable security &amp; system logs recording user logins, credential changes, demo data purges, and system exceptions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setShowClearLogsConfirm(true)}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Demo Logs</span>
          </button>
          {onNavigateToClearDemoData && (
            <button
              type="button"
              onClick={onNavigateToClearDemoData}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Temporary / Demo Data</span>
            </button>
          )}
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Logs</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {showClearLogsConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-amber-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <h4 className="text-sm font-bold">Confirm Clear Demo &amp; Temporary Logs</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowClearLogsConfirm(false)}
                className="text-amber-100 hover:text-white text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-700 leading-relaxed">
                Are you sure you want to clear temporary system error logs, demo/test audit entries, and expired session records?
              </p>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
                <strong>Genuine Business Data Safe:</strong> Genuine sales, purchases, stock batches, items, accounts, and real business records will NOT be modified or deleted.
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClearLogsConfirm(false)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={clearingLogs}
                  onClick={handleClearDemoLogs}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{clearingLogs ? 'Clearing Logs...' : 'Confirm & Clear Demo Logs'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. Authentication & Security Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              placeholder="Search by username..."
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Action:</span>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
            >
              <option value="all">All Actions</option>
              <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
              <option value="LOGIN_FAILURE">LOGIN_FAILURE</option>
              <option value="CLEAR_DEMO_DATA">CLEAR_DEMO_DATA</option>
              <option value="DATABASE_BACKUP_CREATED">DATABASE_BACKUP_CREATED</option>
              <option value="SETTINGS_UPDATED">SETTINGS_UPDATED</option>
              <option value="ACCOUNT_LOCKED">ACCOUNT_LOCKED</option>
              <option value="LOGOUT">LOGOUT</option>
              <option value="USER_CREATED">USER_CREATED</option>
              <option value="USER_UPDATED">USER_UPDATED</option>
              <option value="USER_STATUS_CHANGED">USER_STATUS_CHANGED</option>
              <option value="PASSWORD_RESET">PASSWORD_RESET</option>
              <option value="ADMIN_INITIALIZED">ADMIN_INITIALIZED</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100 font-bold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4">Timestamp (PKT)</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Details</th>
                <th className="py-2.5 px-4">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    No security audit records found matching criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{safeFormatDate(log.created_at)}</div>
                      <div className="text-[10px] text-slate-400">{safeFormatTime(log.created_at)}</div>
                    </td>

                    <td className="py-2.5 px-4 font-mono font-bold text-slate-800">
                      {log.action}
                    </td>

                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      @{log.username}
                    </td>

                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(log.status)}`}>
                        {log.status}
                      </span>
                    </td>

                    <td className="py-2.5 px-4 text-slate-600 max-w-md truncate" title={log.details || ''}>
                      {log.details || '—'}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {log.ip_address || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Application Error & Exception Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold">System Error &amp; Exception Log</h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Total Entries: {errorLogs.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100 font-bold border-b border-slate-200 uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Severity</th>
                <th className="py-2.5 px-4">Module / Operation</th>
                <th className="py-2.5 px-4">Message</th>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {errorLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-emerald-700 font-semibold flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Zero unresolved application or database errors recorded.</span>
                  </td>
                </tr>
              ) : (
                errorLogs.map((errLog) => (
                  <tr key={errLog.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono">{errLog.created_at}</td>
                    <td className="py-2.5 px-4 font-bold uppercase text-rose-700">{errLog.severity}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {errLog.module} {errLog.operation ? `(${errLog.operation})` : ''}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">{errLog.user_message}</td>
                    <td className="py-2.5 px-4 font-mono">{errLog.username || 'system'}</td>
                    <td className="py-2.5 px-4 text-right">
                      {errLog.resolved ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Resolved
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleResolveErrorLog(errLog.id)}
                          className="px-2.5 py-1 rounded bg-slate-900 text-white text-[10px] font-bold cursor-pointer"
                        >
                          Mark Resolved
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

