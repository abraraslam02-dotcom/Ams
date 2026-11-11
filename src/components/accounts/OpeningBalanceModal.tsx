import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Scale, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { Account, MAIN_ACCOUNT_GROUPS } from '../../types/account';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';

interface OpeningBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSaved: () => void;
}

export const OpeningBalanceModal: React.FC<OpeningBalanceModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onSaved,
}) => {
  const [drafts, setDrafts] = useState<
    Record<number, { opening_balance: number; opening_balance_type: 'Debit' | 'Credit' }>
  >({});
  const [search, setSearch] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const initial: Record<
        number,
        { opening_balance: number; opening_balance_type: 'Debit' | 'Credit' }
      > = {};
      accounts.forEach((acc) => {
        initial[acc.id] = {
          opening_balance: acc.opening_balance,
          opening_balance_type: acc.opening_balance_type,
        };
      });
      setDrafts(initial);
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen, accounts]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (groupFilter !== 'all' && acc.main_group !== groupFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          acc.account_code.toLowerCase().includes(q) ||
          acc.account_name.toLowerCase().includes(q) ||
          acc.account_group.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [accounts, groupFilter, search]);

  const totals = useMemo(() => {
    let totalDr = 0;
    let totalCr = 0;
    Object.values(drafts).forEach((d) => {
      const val = Number(d.opening_balance) || 0;
      if (d.opening_balance_type === 'Debit') {
        totalDr += val;
      } else {
        totalCr += val;
      }
    });
    const diff = Math.round((totalDr - totalCr) * 100) / 100;
    return {
      totalDr: Math.round(totalDr * 100) / 100,
      totalCr: Math.round(totalCr * 100) / 100,
      diff,
    };
  }, [drafts]);

  if (!isOpen) return null;

  const handleSaveAll = async () => {
    try {
      setSaving(true);
      setError(null);

      const entries = Object.entries(drafts).map(([idStr, val]) => ({
        id: Number(idStr),
        opening_balance: val.opening_balance,
        opening_balance_type: val.opening_balance_type,
      }));

      const res = await api.bulkUpdateOpeningBalances(entries);
      setSuccessMsg(res.message);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 900);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Opening Balance Management (Debit & Credit Ledger Sheet)
              </h3>
              <p className="text-xs text-slate-300">
                Manage Debit (Dr) and Credit (Cr) opening balances across all Chart of Accounts heads in PKR
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Totals & Filter Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 shrink-0">
          {/* Summary Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <span className="font-bold text-emerald-800 uppercase">Total Opening Debit (Dr)</span>
              <span className="text-sm font-black font-mono text-emerald-950">
                {formatPKR(totals.totalDr)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
              <span className="font-bold text-blue-800 uppercase">Total Opening Credit (Cr)</span>
              <span className="text-sm font-black font-mono text-blue-950">
                {formatPKR(totals.totalCr)}
              </span>
            </div>

            <div
              className={`p-3 rounded-xl border flex items-center justify-between ${
                totals.diff === 0
                  ? 'bg-emerald-900 text-white border-emerald-800'
                  : 'bg-amber-50 text-amber-900 border-amber-200'
              }`}
            >
              <span className="font-bold uppercase">
                {totals.diff === 0 ? 'Balanced (Dr = Cr)' : 'Opening Difference'}
              </span>
              <span className="text-sm font-black font-mono">
                {totals.diff === 0
                  ? 'Rs. 0.00'
                  : `${formatPKR(Math.abs(totals.diff))} (${totals.diff > 0 ? 'Dr > Cr' : 'Cr > Dr'})`}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Search & Group Filter */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter accounts by code, name, or category..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800"
            >
              <option value="all">All 3 Account Groups</option>
              {MAIN_ACCOUNT_GROUPS.map((mg) => (
                <option key={mg} value={mg}>
                  {mg}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable Sheet */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-4">Code</th>
                <th className="py-2.5 px-4">Account Name</th>
                <th className="py-2.5 px-4">Main Group</th>
                <th className="py-2.5 px-4">Sub-Group</th>
                <th className="py-2.5 px-4 text-right w-48">Opening Balance (PKR)</th>
                <th className="py-2.5 px-4 text-center w-40">Debit / Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAccounts.map((acc) => {
                const draft = drafts[acc.id] || {
                  opening_balance: acc.opening_balance,
                  opening_balance_type: acc.opening_balance_type,
                };
                return (
                  <tr key={acc.id} className="hover:bg-slate-50/80">
                    <td className="py-2 px-4 font-mono font-bold text-slate-800">
                      {acc.account_code}
                    </td>
                    <td className="py-2 px-4 font-semibold text-slate-900">{acc.account_name}</td>
                    <td className="py-2 px-4 text-[11px] text-slate-500">{acc.main_group}</td>
                    <td className="py-2 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        {acc.account_group}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <NumericInput
                        step="0.01"
                        min="0"
                        value={draft.opening_balance}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [acc.id]: {
                              ...draft,
                              opening_balance: Math.max(0, parseFloat(e.target.value) || 0),
                            },
                          })
                        }
                        className="w-36 px-2.5 py-1 text-right font-mono font-bold text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="py-2 px-4 text-center">
                      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts({
                              ...drafts,
                              [acc.id]: { ...draft, opening_balance_type: 'Debit' },
                            })
                          }
                          className={`px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                            draft.opening_balance_type === 'Debit'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Dr
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts({
                              ...drafts,
                              [acc.id]: { ...draft, opening_balance_type: 'Credit' },
                            })
                          }
                          className={`px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                            draft.opening_balance_type === 'Credit'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Cr
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            Showing {filteredAccounts.length} of {accounts.length} accounts
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving Balances...' : 'Save All Opening Balances'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
