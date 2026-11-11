import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Printer,
  RotateCcw,
  Search,
  RefreshCw,
  AlertCircle,
  Scale,
  Download,
  Edit3,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  AccountingVoucher,
  AccountingVoucherLine,
  VoucherTypeCode,
} from '../../types/accounting';
import { NumericInput } from '../common/NumericInput';
import { printReportDocument } from '../../utils/printEngine';

interface VoucherManagementViewProps {
  initialVoucherType?: VoucherTypeCode;
}

const VOUCHER_TYPES: Array<{
  code: VoucherTypeCode;
  label: string;
  shortDesc: string;
  badgeColor: string;
}> = [
  {
    code: 'CRV',
    label: 'Cash Receipt Voucher (CRV)',
    shortDesc: 'Debit Cash in Hand / Credit Customer or Income',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  {
    code: 'CPV',
    label: 'Cash Payment Voucher (CPV)',
    shortDesc: 'Debit Supplier or Expense / Credit Cash in Hand',
    badgeColor: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  {
    code: 'BRV',
    label: 'Bank Receipt Voucher (BRV)',
    shortDesc: 'Debit Bank Account / Credit Customer or Income',
    badgeColor: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  {
    code: 'BPV',
    label: 'Bank Payment Voucher (BPV)',
    shortDesc: 'Debit Supplier or Expense / Credit Bank Account',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    code: 'JV',
    label: 'Journal Voucher (JV)',
    shortDesc: 'General Double-Entry Adjustment & Non-Cash Posting',
    badgeColor: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  {
    code: 'CV',
    label: 'Contra Voucher (CV)',
    shortDesc: 'Cash-to-Bank Deposit or Bank-to-Cash Withdrawal',
    badgeColor: 'bg-purple-50 text-purple-800 border-purple-200',
  },
];

export const VoucherManagementView: React.FC<VoucherManagementViewProps> = ({
  initialVoucherType = 'JV',
}) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<AccountingVoucher[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Active Voucher Form State
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null);
  const [voucherType, setVoucherType] = useState<VoucherTypeCode>(initialVoucherType);
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [narration, setNarration] = useState('');
  const [createdBy, setCreatedBy] = useState('Super Admin');
  const [lines, setLines] = useState<AccountingVoucherLine[]>([
    { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
    { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
  ]);

  // Register Filters
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');

  // Print Modal State
  const [printVoucher, setPrintVoucher] = useState<AccountingVoucher | null>(null);
  const voucherSheetRef = useRef<HTMLDivElement>(null);
  // Reverse Modal State
  const [reversingVoucher, setReversingVoucher] = useState<AccountingVoucher | null>(null);
  const [reverseReason, setReverseReason] = useState('Authorized Accounting Correction');

  useEffect(() => {
    if (initialVoucherType) {
      setVoucherType(initialVoucherType);
    }
  }, [initialVoucherType]);

  const fetchNextNumber = useCallback(async (type: VoucherTypeCode) => {
    try {
      const res = await api.getNextAccountingVoucherNumber(type);
      setVoucherNumber(res.nextVoucherNumber || `${type}-2026-0001`);
    } catch {
      setVoucherNumber(`${type}-2026-0001`);
    }
  }, []);

  const applyDefaultAccountsForType = useCallback(
    (type: VoucherTypeCode, accList: any[]) => {
      if (editingVoucherId) return;
      const cashAcc = accList.find((a) => a.account_code === 'FIN-1010');
      const bankAcc = accList.find((a) => a.account_code === 'FIN-1021');

      if (type === 'CRV' && cashAcc) {
        setLines([
          {
            account_id: cashAcc.id,
            account_code: cashAcc.account_code,
            account_name: cashAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Cash received in main drawer',
          },
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
        ]);
      } else if (type === 'CPV' && cashAcc) {
        setLines([
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
          {
            account_id: cashAcc.id,
            account_code: cashAcc.account_code,
            account_name: cashAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Cash paid from main drawer',
          },
        ]);
      } else if (type === 'BRV' && bankAcc) {
        setLines([
          {
            account_id: bankAcc.id,
            account_code: bankAcc.account_code,
            account_name: bankAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Received in bank account',
          },
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
        ]);
      } else if (type === 'BPV' && bankAcc) {
        setLines([
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
          {
            account_id: bankAcc.id,
            account_code: bankAcc.account_code,
            account_name: bankAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Paid from bank account',
          },
        ]);
      } else if (type === 'CV' && bankAcc && cashAcc) {
        setLines([
          {
            account_id: bankAcc.id,
            account_code: bankAcc.account_code,
            account_name: bankAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Cash deposited into Bank',
          },
          {
            account_id: cashAcc.id,
            account_code: cashAcc.account_code,
            account_name: cashAcc.account_name,
            debit_amount: 0,
            credit_amount: 0,
            description: 'Cash transferred from Counter Drawer to Bank',
          },
        ]);
      } else {
        setLines([
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
          { account_id: 0, account_code: '', account_name: '', debit_amount: 0, credit_amount: 0, description: '' },
        ]);
      }
    },
    [editingVoucherId]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [coaRes, vRes] = await Promise.all([
        api.getHierarchicalCOA({ status: 'Active' }),
        api.getAccountingVouchers({
          voucherType: filterType,
          status: filterStatus,
          startDate: filterStartDate,
          endDate: filterEndDate,
          q: filterSearch,
        }),
      ]);
      const accList = coaRes.accounts || [];
      setAccounts(accList);
      setVouchers(vRes.vouchers || []);
      setStats(vRes.stats || null);
      if (!voucherNumber) {
        fetchNextNumber(voucherType);
        applyDefaultAccountsForType(voucherType, accList);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load vouchers' });
    } finally {
      setLoading(false);
    }
  }, [
    filterType,
    filterStatus,
    filterStartDate,
    filterEndDate,
    filterSearch,
    voucherNumber,
    voucherType,
    fetchNextNumber,
    applyDefaultAccountsForType,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectVoucherType = (type: VoucherTypeCode) => {
    setEditingVoucherId(null);
    setVoucherType(type);
    fetchNextNumber(type);
    applyDefaultAccountsForType(type, accounts);
  };

  const handleLineAccountChange = (index: number, accountId: number) => {
    const found = accounts.find((a) => Number(a.id) === Number(accountId));
    setLines((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              account_id: found ? Number(found.id) : 0,
              account_code: found ? String(found.account_code) : '',
              account_name: found ? String(found.account_name) : '',
            }
          : row
      )
    );
  };

  const handleLineAmountChange = (
    index: number,
    field: 'debit_amount' | 'credit_amount',
    val: string
  ) => {
    const num = Math.max(0, parseFloat(val || '0') || 0);
    setLines((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        if (field === 'debit_amount') {
          return { ...row, debit_amount: num, credit_amount: num > 0 ? 0 : row.credit_amount };
        }
        return { ...row, credit_amount: num, debit_amount: num > 0 ? 0 : row.debit_amount };
      })
    );
  };

  const handleLineDescriptionChange = (index: number, val: string) => {
    setLines((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, description: val } : row))
    );
  };

  const handleAddRow = () => {
    setLines((prev) => [
      ...prev,
      {
        account_id: 0,
        account_code: '',
        account_name: '',
        debit_amount: 0,
        credit_amount: 0,
        description: narration,
      },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  };

  const totalDebit = Math.round(lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0) * 100) / 100;
  const totalCredit = Math.round(lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0) * 100) / 100;
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
  const isBalanced = totalDebit > 0 && difference === 0;

  const handleAutoBalanceLastRow = () => {
    if (lines.length < 2) return;
    const lastIdx = lines.length - 1;
    const priorDr = lines
      .slice(0, lastIdx)
      .reduce((s, l) => s + Number(l.debit_amount || 0), 0);
    const priorCr = lines
      .slice(0, lastIdx)
      .reduce((s, l) => s + Number(l.credit_amount || 0), 0);
    const diff = Math.round((priorDr - priorCr) * 100) / 100;

    setLines((prev) =>
      prev.map((r, i) => {
        if (i !== lastIdx) return r;
        if (diff > 0) {
          return { ...r, debit_amount: 0, credit_amount: diff };
        } else if (diff < 0) {
          return { ...r, debit_amount: Math.abs(diff), credit_amount: 0 };
        }
        return r;
      })
    );
  };

  const resetForm = (type: VoucherTypeCode = voucherType) => {
    setEditingVoucherId(null);
    setReferenceNumber('');
    setNarration('');
    fetchNextNumber(type);
    applyDefaultAccountsForType(type, accounts);
  };

  const handleSaveVoucher = async (targetStatus: 'draft' | 'posted') => {
    setFeedback(null);
    if (targetStatus === 'posted' && !isBalanced) {
      setFeedback({
        type: 'error',
        message: `Cannot post unbalanced voucher. Total Debit (Rs. ${totalDebit.toFixed(
          2
        )}) must equal Total Credit (Rs. ${totalCredit.toFixed(2)}).`,
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        voucher_number: voucherNumber,
        voucher_type: voucherType,
        voucher_date: voucherDate,
        reference_number: referenceNumber,
        narration,
        created_by: createdBy,
        status: targetStatus,
        lines,
      };

      let res;
      if (editingVoucherId) {
        res = await api.updateAccountingVoucher(editingVoucherId, payload);
      } else {
        res = await api.createAccountingVoucher(payload);
      }

      setFeedback({
        type: 'success',
        message: res.message || `Voucher ${voucherNumber} saved.`,
      });
      resetForm(voucherType);
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save voucher' });
    } finally {
      setSaving(false);
    }
  };

  const handleEditDraft = (v: AccountingVoucher) => {
    if (v.status !== 'draft') return;
    setEditingVoucherId(v.id);
    setVoucherType(v.voucher_type);
    setVoucherNumber(v.voucher_number);
    setVoucherDate(v.voucher_date);
    setReferenceNumber(v.reference_number || '');
    setNarration(v.narration || '');
    setLines(
      v.lines && v.lines.length >= 2
        ? v.lines
        : [
            ...(v.lines || []),
            {
              account_id: 0,
              account_code: '',
              account_name: '',
              debit_amount: 0,
              credit_amount: 0,
              description: '',
            },
          ]
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePostDraft = async (v: AccountingVoucher) => {
    try {
      const res = await api.postAccountingVoucher(v.id);
      setFeedback({ type: 'success', message: res.message });
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  const handleConfirmReverse = async () => {
    if (!reversingVoucher) return;
    try {
      const res = await api.reverseAccountingVoucher(reversingVoucher.id, reverseReason);
      setFeedback({ type: 'success', message: res.message });
      setReversingVoucher(null);
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  const handleExportVouchersCSV = () => {
    const headers = [
      'Voucher No',
      'Type',
      'Date',
      'Reference',
      'Accounts Involved',
      'Narration',
      'Total Debit',
      'Total Credit',
      'Status',
      'Created By',
    ];
    const rows = [
      headers.join(','),
      ...vouchers.map((v) =>
        [
          `"${v.voucher_number}"`,
          v.voucher_type,
          v.voucher_date,
          `"${v.reference_number || ''}"`,
          `"${(v.lines || []).map((l) => `${l.account_code} ${l.account_name}`).join(' | ')}"`,
          `"${String(v.narration || '').replace(/"/g, '""')}"`,
          Number(v.total_debit || 0).toFixed(2),
          Number(v.total_credit || 0).toFixed(2),
          v.status,
          `"${v.created_by}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abrar_Medical_Voucher_Register_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Voucher Type Selector Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-emerald-900 text-white flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900">
                Multi-Line Voucher Datasheet & Double-Entry Posting Engine
              </h1>
              <p className="text-[11px] text-slate-500">
                CRV • CPV • BRV • BPV • Journal Voucher (JV) • Contra Voucher (CV) — Strict Debit = Credit Enforcement
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-mono">
              Posted: <strong>{stats?.posted_count || 0}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 font-mono">
              Drafts: <strong>{stats?.draft_count || 0}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800 font-mono">
              Total Posted Volume: <strong>Rs. {Number(stats?.total_posted_amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
          {VOUCHER_TYPES.map((vt) => {
            const active = voucherType === vt.code;
            return (
              <button
                key={vt.code}
                type="button"
                onClick={() => handleSelectVoucherType(vt.code)}
                className={`text-left p-2 rounded border transition-all ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-slate-50/70 hover:bg-slate-100 text-slate-800 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-mono">{vt.code}</span>
                  {active && (
                    <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500 text-white rounded font-semibold">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-semibold truncate mt-0.5">{vt.label}</div>
                <div className="text-[10px] opacity-75 truncate">{vt.shortDesc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`px-3 py-2 rounded-md border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold underline"
          >
            Close
          </button>
        </div>
      )}

      {/* Voucher Entry Datasheet Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="bg-slate-900 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-bold font-mono bg-emerald-600 rounded">
              {voucherType}
            </span>
            <span className="text-xs font-semibold">
              {editingVoucherId
                ? `Editing Draft Voucher: ${voucherNumber}`
                : `New ${VOUCHER_TYPES.find((t) => t.code === voucherType)?.label}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAutoBalanceLastRow}
              className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded flex items-center gap-1"
              title="Automatically fill the last row's Debit or Credit to balance the voucher"
            >
              <Scale className="w-3.5 h-3.5" />
              Auto-Balance Last Line
            </button>
            <button
              type="button"
              onClick={handleAddRow}
              className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Account Line
            </button>
          </div>
        </div>

        {/* Voucher Header Fields */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 md:grid-cols-5 gap-2.5 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-0.5">
              Auto Voucher Number
            </label>
            <input
              type="text"
              value={voucherNumber}
              onChange={(e) => setVoucherNumber(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-0.5">Voucher Date *</label>
            <input
              type="date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-0.5">
              Reference / Cheque / Slip No.
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. CHQ-90812 / INV-01"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-0.5">Created By</label>
            <input
              type="text"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-0.5">
              Master Narration / Remarks
            </label>
            <input
              type="text"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Enter voucher narration..."
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
            />
          </div>
        </div>

        {/* Datasheet Grid */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold text-slate-700 uppercase">
                <th className="px-2.5 py-2 w-10 text-center">#</th>
                <th className="px-2.5 py-2 w-[36%]">Account Head (Code — Title — Group)</th>
                <th className="px-2.5 py-2">Line Description / Particulars</th>
                <th className="px-2.5 py-2 w-40 text-right">Debit (PKR)</th>
                <th className="px-2.5 py-2 w-40 text-right">Credit (PKR)</th>
                <th className="px-2.5 py-2 w-14 text-center">Del</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={index}
                  className="border-b border-slate-200 hover:bg-slate-50/70 transition-colors"
                >
                  <td className="px-2.5 py-1.5 text-center font-mono text-xs text-slate-500">
                    {index + 1}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <select
                      value={line.account_id || ''}
                      onChange={(e) => handleLineAccountChange(index, Number(e.target.value))}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:border-emerald-600 font-medium"
                    >
                      <option value="">-- Select Account Head --</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} — {acc.account_name} ({acc.account_group} | Bal: Rs.{' '}
                          {Number(acc.current_balance || 0).toFixed(0)}{' '}
                          {acc.current_balance_type === 'Debit' ? 'Dr' : 'Cr'})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => handleLineDescriptionChange(index, e.target.value)}
                      placeholder="Line narration / particulars..."
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-emerald-600"
                    />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <NumericInput
                      step="0.01"
                      min="0"
                      value={line.debit_amount || ''}
                      onChange={(e) =>
                        handleLineAmountChange(index, 'debit_amount', e.target.value)
                      }
                      className="w-full px-2 py-1.5 text-xs text-right font-mono font-semibold text-emerald-800 bg-emerald-50/30 border border-slate-300 rounded focus:outline-none focus:border-emerald-600"
                    />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <NumericInput
                      step="0.01"
                      min="0"
                      value={line.credit_amount || ''}
                      onChange={(e) =>
                        handleLineAmountChange(index, 'credit_amount', e.target.value)
                      }
                      className="w-full px-2 py-1.5 text-xs text-right font-mono font-semibold text-indigo-800 bg-indigo-50/30 border border-slate-300 rounded focus:outline-none focus:border-indigo-600"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 text-center">
                    <button
                      type="button"
                      disabled={lines.length <= 2}
                      onClick={() => handleRemoveRow(index)}
                      className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 text-xs font-bold">
                <td colSpan={3} className="px-3 py-2 text-right uppercase text-slate-700">
                  Voucher Totals & Double-Entry Check:
                </td>
                <td className="px-2.5 py-2 text-right font-mono text-sm text-emerald-800">
                  Rs. {totalDebit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-2.5 py-2 text-right font-mono text-sm text-indigo-800">
                  Rs. {totalCredit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer Actions Bar */}
        <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isBalanced ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                DOUBLE-ENTRY BALANCED (Dr = Cr = Rs. {totalDebit.toFixed(2)})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                <AlertCircle className="w-3.5 h-3.5" />
                {totalDebit === 0 && totalCredit === 0
                  ? 'Enter Debit & Credit amounts to post'
                  : `UNBALANCED DIFFERENCE: Rs. ${difference.toFixed(2)}`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resetForm(voucherType)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded"
            >
              Clear / Reset
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveVoucher('draft')}
              className="px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              Save as Draft (No Ledger Impact)
            </button>

            <button
              type="button"
              disabled={saving || !isBalanced}
              onClick={() => handleSaveVoucher('posted')}
              className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {editingVoucherId ? 'Approve & Post Voucher' : 'Post Voucher to Ledger'}
            </button>
          </div>
        </div>
      </div>

      {/* Voucher Register Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Complete Voucher Register & Audit Trail
            </h2>
            <p className="text-[11px] text-slate-500">
              Posted vouchers are protected against silent deletion; corrections use formal Reversal JVs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search voucher no, account, ref..."
                className="pl-8 pr-2.5 py-1 border border-slate-300 rounded text-xs"
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-xs"
            >
              <option value="all">All Types</option>
              <option value="CRV">CRV (Cash Receipt)</option>
              <option value="CPV">CPV (Cash Payment)</option>
              <option value="BRV">BRV (Bank Receipt)</option>
              <option value="BPV">BPV (Bank Payment)</option>
              <option value="JV">JV (Journal)</option>
              <option value="CV">CV (Contra)</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="posted">Posted</option>
              <option value="draft">Draft</option>
              <option value="reversed">Reversed</option>
            </select>

            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-xs font-mono"
            />
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-xs font-mono"
            />

            <button
              type="button"
              onClick={handleExportVouchersCSV}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              Excel/CSV
            </button>

            <button
              type="button"
              onClick={loadData}
              className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] uppercase">
                <th className="px-3 py-2">Voucher No</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Ref No</th>
                <th className="px-3 py-2">Debit / Credit Lines</th>
                <th className="px-3 py-2">Narration</th>
                <th className="px-3 py-2 text-right">Total Debit</th>
                <th className="px-3 py-2 text-right">Total Credit</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    No vouchers found matching current filters.
                  </td>
                </tr>
              ) : (
                vouchers.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {v.voucher_number}
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-100 text-slate-800 border border-slate-300">
                        {v.voucher_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                      {v.voucher_date}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">
                      {v.reference_number || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-0.5">
                        {(v.lines || []).map((l, idx) => (
                          <div key={idx} className="text-[11px] flex items-center gap-1.5">
                            <span
                              className={`font-mono font-bold px-1 rounded ${
                                l.debit_amount > 0
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-indigo-50 text-indigo-700'
                              }`}
                            >
                              {l.debit_amount > 0 ? 'Dr' : 'Cr'}
                            </span>
                            <span className="font-mono text-slate-600">{l.account_code}</span>
                            <span className="font-medium text-slate-800">{l.account_name}</span>
                            <span className="font-mono text-slate-500">
                              ({Number(l.debit_amount || l.credit_amount).toLocaleString('en-PK')})
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                      {v.narration || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">
                      Rs. {Number(v.total_debit || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-indigo-700">
                      Rs. {Number(v.total_credit || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          v.status === 'posted'
                            ? 'bg-emerald-100 text-emerald-800'
                            : v.status === 'draft'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPrintVoucher(v)}
                          className="p-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded"
                          title="Print A4 Voucher"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>

                        {v.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditDraft(v)}
                              className="p-1 text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 rounded"
                              title="Edit Draft Voucher"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePostDraft(v)}
                              className="px-2 py-0.5 text-[10px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded"
                              title="Post Draft to General Ledger"
                            >
                              Post
                            </button>
                          </>
                        )}

                        {v.status === 'posted' && !v.reversed_from_voucher_id && (
                          <button
                            type="button"
                            onClick={() => setReversingVoucher(v)}
                            className="p-1 text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 rounded"
                            title="Reverse Posted Voucher (Formal Reversal Entry)"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print Voucher Modal */}
      {printVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl w-full max-w-3xl overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between print:hidden">
              <span className="text-xs font-bold">
                Print Preview — {printVoucher.voucher_number}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (voucherSheetRef.current) {
                      printReportDocument(
                        voucherSheetRef.current,
                        `Abrar Medical Store - ${printVoucher.voucher_number}`
                      );
                    } else {
                      window.print();
                    }
                  }}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print A4 Voucher
                </button>
                <button
                  type="button"
                  onClick={() => setPrintVoucher(null)}
                  className="px-2.5 py-1 bg-slate-800 text-slate-300 hover:text-white text-xs rounded cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            <div ref={voucherSheetRef} className="p-6 space-y-4 text-xs text-slate-900 bg-white">
              <div className="border-b-2 border-slate-900 pb-3 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">ABRAR MEDICAL STORE</h2>
                  <p className="text-[11px] text-slate-600">
                    Main Commercial Market, Lahore • Drug License: DL-PK-LHR-2026-0891
                  </p>
                </div>
                <div className="text-right">
                  <div className="inline-block px-3 py-1 bg-slate-900 text-white font-bold text-xs uppercase rounded">
                    {VOUCHER_TYPES.find((t) => t.code === printVoucher.voucher_type)?.label ||
                      printVoucher.voucher_type}
                  </div>
                  <div className="font-mono font-bold text-sm mt-1">
                    {printVoucher.voucher_number}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 bg-slate-50 p-3 rounded border border-slate-200">
                <div>
                  <span className="text-slate-500 block">Voucher Date:</span>
                  <strong className="font-mono">{printVoucher.voucher_date}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Reference No:</span>
                  <strong className="font-mono">{printVoucher.reference_number || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Approval Status:</span>
                  <strong className="uppercase">{printVoucher.approval_status}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Prepared By:</span>
                  <strong>{printVoucher.created_by}</strong>
                </div>
              </div>

              <table className="w-full border-collapse border border-slate-300 text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="border border-slate-300 px-2.5 py-1.5 text-left">Code</th>
                    <th className="border border-slate-300 px-2.5 py-1.5 text-left">
                      Account Head
                    </th>
                    <th className="border border-slate-300 px-2.5 py-1.5 text-left">
                      Description / Narration
                    </th>
                    <th className="border border-slate-300 px-2.5 py-1.5 text-right">
                      Debit (PKR)
                    </th>
                    <th className="border border-slate-300 px-2.5 py-1.5 text-right">
                      Credit (PKR)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(printVoucher.lines || []).map((l, idx) => (
                    <tr key={idx}>
                      <td className="border border-slate-300 px-2.5 py-1.5 font-mono">
                        {l.account_code}
                      </td>
                      <td className="border border-slate-300 px-2.5 py-1.5 font-semibold">
                        {l.account_name}
                      </td>
                      <td className="border border-slate-300 px-2.5 py-1.5">
                        {l.description || printVoucher.narration}
                      </td>
                      <td className="border border-slate-300 px-2.5 py-1.5 text-right font-mono">
                        {Number(l.debit_amount || 0).toFixed(2)}
                      </td>
                      <td className="border border-slate-300 px-2.5 py-1.5 text-right font-mono">
                        {Number(l.credit_amount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={3} className="border border-slate-300 px-2.5 py-1.5 text-right">
                      TOTAL BALANCED AMOUNT:
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right font-mono">
                      Rs. {Number(printVoucher.total_debit || 0).toFixed(2)}
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right font-mono">
                      Rs. {Number(printVoucher.total_credit || 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="font-semibold text-slate-600">Master Narration: </span>
                <span>{printVoucher.narration || '—'}</span>
              </div>

              <div className="grid grid-cols-3 gap-8 pt-8 text-center text-[11px] text-slate-600">
                <div className="border-t border-slate-400 pt-1">Prepared By</div>
                <div className="border-t border-slate-400 pt-1">Checked By (Accountant)</div>
                <div className="border-t border-slate-400 pt-1">Authorized Signatory</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safe Reversal Modal */}
      {reversingVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-md p-4 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Reverse Posted Voucher: {reversingVoucher.voucher_number}
            </h3>
            <p className="text-slate-600">
              Posted accounting vouchers are never silently deleted. Confirming this action will generate a formal contra Journal Voucher swapping all Debits and Credits while preserving the full audit history.
            </p>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Reversal Reason *</label>
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReversingVoucher(null)}
                className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReverse}
                className="px-3 py-1.5 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded"
              >
                Confirm Formal Reversal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
