import React, { useEffect, useState } from 'react';
import {
  X,
  Edit2,
  GitBranch,
  ShieldCheck,
  Lock,
  Phone,
  MapPin,
  Mail,
  Scale,
  Plus,
  Building2,
} from 'lucide-react';
import { Account, AccountProtectionInfo } from '../../types/account';
import { api } from '../../services/api';
import { formatPKR, formatPKTDate } from '../../utils/formatters';

interface AccountViewModalProps {
  account: Account | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (account: Account) => void;
  onAddSubAccount: (parentAccount: Account) => void;
}

export const AccountViewModal: React.FC<AccountViewModalProps> = ({
  account,
  isOpen,
  onClose,
  onEdit,
  onAddSubAccount,
}) => {
  const [subAccounts, setSubAccounts] = useState<
    Array<{
      id: number;
      account_code: string;
      account_name: string;
      account_group: string;
      current_balance: number;
      current_balance_type: 'Debit' | 'Credit';
      status: string;
    }>
  >([]);
  const [protection, setProtection] = useState<AccountProtectionInfo | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);

  useEffect(() => {
    if (account && isOpen) {
      setLoadingDetails(true);
      api
        .getAccountDetails(account.id)
        .then((res) => {
          setSubAccounts(res.subAccounts || []);
          setProtection(res.protection || null);
        })
        .catch(() => {
          // ignore
        })
        .finally(() => setLoadingDetails(false));
    }
  }, [account, isOpen]);

  if (!isOpen || !account) return null;

  const isParty = account.main_group === 'PARTY ACCOUNTS';
  const isDualParty = account.account_group === 'Customer & Supplier';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-6">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs">
              {account.account_code}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{account.account_name}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    account.status === 'Active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {account.status}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {account.main_group} &bull; {account.account_group}
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

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Top Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Opening Balance
              </span>
              <div className="text-sm font-black font-mono text-slate-900 mt-1">
                {formatPKR(account.opening_balance)}
              </div>
              <span
                className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  account.opening_balance_type === 'Debit'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {account.opening_balance_type} (Opening)
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Total Debit (Dr)
              </span>
              <div className="text-sm font-black font-mono text-emerald-950 mt-1">
                {formatPKR(account.total_debit)}
              </div>
              <span className="text-[10px] text-emerald-700">Cumulative Dr</span>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                Total Credit (Cr)
              </span>
              <div className="text-sm font-black font-mono text-blue-950 mt-1">
                {formatPKR(account.total_credit)}
              </div>
              <span className="text-[10px] text-blue-700">Cumulative Cr</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 text-white border border-slate-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Current Net Balance
              </span>
              <div className="text-sm font-black font-mono text-white mt-1">
                {formatPKR(account.current_balance)}
              </div>
              <span className="text-[10px] text-slate-300 font-semibold">
                {account.current_balance > 0
                  ? `${account.current_balance_type} Balance`
                  : 'Settled (0.00)'}
              </span>
            </div>
          </div>

          {/* Separate Customer & Supplier Ledger Breakdown (for Party Accounts) */}
          {isParty && (
            <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-950 flex items-center gap-1.5">
                  <Scale className="w-4 h-4 text-purple-700" />
                  <span>
                    {isDualParty
                      ? 'Dual Party Ledger Separation (Customer Receivable vs. Supplier Payable)'
                      : `${account.account_group} Sub-Ledger Summary`}
                  </span>
                </span>
                {account.credit_limit > 0 && (
                  <span className="text-xs font-mono font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded">
                    Credit Limit: {formatPKR(account.credit_limit)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-white border border-purple-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">Customer Receivable Ledger</div>
                    <div className="text-[11px] text-slate-500">
                      Dr: {formatPKR(account.customer_debit)} | Cr: {formatPKR(account.customer_credit)}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                    {formatPKR(Math.abs(account.customer_debit - account.customer_credit))}{' '}
                    {account.customer_debit >= account.customer_credit ? 'Dr' : 'Cr'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-white border border-purple-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800">Supplier Payable Ledger</div>
                    <div className="text-[11px] text-slate-500">
                      Dr: {formatPKR(account.supplier_debit)} | Cr: {formatPKR(account.supplier_credit)}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                    {formatPKR(Math.abs(account.supplier_credit - account.supplier_debit))}{' '}
                    {account.supplier_credit >= account.supplier_debit ? 'Cr' : 'Dr'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Hierarchy & Sub-Accounts */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                <GitBranch className="w-4 h-4 text-emerald-600" />
                <span>Chart of Accounts Hierarchy</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddSubAccount(account);
                }}
                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Sub-Account</span>
              </button>
            </div>

            <div className="text-xs text-slate-700 flex items-center gap-2">
              <span className="text-slate-500">Parent Account:</span>
              {account.parent_account_name ? (
                <span className="font-semibold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 font-mono">
                  [{account.parent_account_code}] {account.parent_account_name}
                </span>
              ) : (
                <span className="text-slate-500 italic">Top-Level Root Account</span>
              )}
            </div>

            {subAccounts.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase">
                  Child Sub-Accounts ({subAccounts.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {subAccounts.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-2 rounded-lg bg-white border border-slate-200 text-xs flex items-center justify-between"
                    >
                      <div className="truncate pr-2">
                        <span className="font-mono font-bold text-slate-800">{sub.account_code}</span>{' '}
                        <span className="text-slate-700">{sub.account_name}</span>
                      </div>
                      <span className="font-mono text-[11px] font-semibold text-slate-900 shrink-0">
                        {formatPKR(sub.current_balance)} {sub.current_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Contact & Address Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-slate-400 font-medium">Contact Person & Phone</span>
              <div className="font-semibold text-slate-900">
                {account.contact_person || '—'}
              </div>
              <div className="font-mono text-slate-600">{account.phone || 'No phone recorded'}</div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-slate-400 font-medium">NTN / STRN & Tax Status</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-slate-900">
                  NTN: {account.ntn || account.ntn_cnic || '—'}
                </span>
                {account.strn && (
                  <span className="font-mono text-slate-700">| STRN: {account.strn}</span>
                )}
                {isParty && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      account.filer_status === 'Filer'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : account.filer_status === 'Non-Filer'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-blue-100 text-blue-800 border border-blue-200'
                    }`}
                  >
                    {account.filer_status || 'Filer'}
                  </span>
                )}
              </div>
              <div className="text-slate-600">
                {account.tax_registration_details || account.email || 'No tax registration notes'}
              </div>
            </div>

            <div className="sm:col-span-2 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-slate-400 font-medium">Address & City</span>
              <div className="font-medium text-slate-800">
                {account.address ? `${account.address}${account.city ? `, ${account.city}` : ''}` : account.city || '—'}
              </div>
              {account.notes && (
                <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 mt-1">
                  Notes: {account.notes}
                </div>
              )}
            </div>
          </div>

          {/* Deletion Protection Status */}
          <div className="p-3.5 rounded-xl bg-slate-900 text-slate-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              {protection?.canDelete === false || account.is_system_account === 1 ? (
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>
                {account.is_system_account === 1
                  ? 'Protected Core Chart of Accounts Control Head (Deletion Blocked)'
                  : protection && protection.subAccounts > 0
                  ? `Protected Parent Account (${protection.subAccounts} child sub-accounts attached)`
                  : protection && protection.total > 0
                  ? `Protected Account (Linked to ${protection.total} financial transactions)`
                  : 'No linked transactions yet • Eligible for modification or removal'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              Updated {formatPKTDate(account.updated_at)}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEdit(account);
            }}
            className="px-4 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Edit Account</span>
          </button>
        </div>
      </div>
    </div>
  );
};
