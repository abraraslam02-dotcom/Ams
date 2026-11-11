import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Wallet,
  Building2,
  Save,
  RotateCcw,
  Printer,
  Search,
  Eye,
  Pencil,
  Trash2,
  Download,
  Calendar,
  Share2,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  DollarSign,
  Receipt,
  History,
  ShieldAlert,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  CashBookTransactionType,
  CashBookCategory,
  CashBookVoucher,
  CashBookSummaryResponse,
  CashBookBreakdownResponse,
  CashBookAccountsResponse,
} from '../../types/cashBook';
import { formatPKR, formatPKTDate } from '../../utils/formatters';
import { executePrintElement } from '../../utils/printEngine';

interface CashBookModuleViewProps {
  onNavigateToCustomerLedger?: (customerId: number) => void;
  onNavigateToSupplierLedger?: (supplierId: number) => void;
}

interface CashBookAuditLog {
  id: number;
  voucher_id: number | null;
  voucher_number: string;
  action: string;
  details: string;
  previous_values: string | null;
  new_values: string | null;
  performed_by: string;
  performed_by_role: string;
  created_at: string;
}

// Format input amount into readable string or parse back cleanly
function sanitizeAmountInput(val: string): string {
  // Allow digits, single decimal point, and commas
  return val.replace(/[^0-9.,]/g, '');
}

function parseAmountNumber(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/,/g, '').trim();
  const num = parseFloat(clean);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : 0;
}

export const CashBookModuleView: React.FC<CashBookModuleViewProps> = ({
  onNavigateToCustomerLedger: _onNavigateToCustomerLedger,
  onNavigateToSupplierLedger: _onNavigateToSupplierLedger,
}) => {
  const { user, isSuperAdmin } = useAuth();
  const isAdmin = isSuperAdmin || user?.role === 'Super Admin' || user?.role === 'Administrator';

  // Date Range state (defaults to today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [activeDatePreset, setActiveDatePreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today');

  // Active Tab
  const [activeTab, setActiveTab] = useState<
    | 'register'
    | 'daily_summary'
    | 'who_paid'
    | 'whom_paid'
    | 'inflows_outflows'
    | 'bank_contra'
    | 'account_balances'
    | 'audit_trail'
  >('register');

  // Reference Accounts data
  const [accountsData, setAccountsData] = useState<CashBookAccountsResponse | null>(null);
  const [summaryData, setSummaryData] = useState<CashBookSummaryResponse | null>(null);
  const [breakdownData, setBreakdownData] = useState<CashBookBreakdownResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<CashBookAuditLog[]>([]);

  // Vouchers Register list
  const [vouchers, setVouchers] = useState<CashBookVoucher[]>([]);
  const [totalVouchers, setTotalVouchers] = useState<number>(0);
  const [registerPage, setRegisterPage] = useState<number>(1);
  const pageSize = 25;

  // Filter state for register
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<string>('all');

  // Entry Form State
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null);
  const [voucherNumber, setVoucherNumber] = useState<string>('001');
  const [_sequenceNumber, setSequenceNumber] = useState<number>(1);
  const [voucherDate, setVoucherDate] = useState<string>(todayStr);
  const [transactionType, setTransactionType] = useState<CashBookTransactionType>('Receipt');
  const [category, setCategory] = useState<CashBookCategory>('customer_receipt');

  // Account Search Picker State
  const [headAccountId, setHeadAccountId] = useState<number>(0);
  const [headAccountSearch, setHeadAccountSearch] = useState<string>('');
  const [isHeadSearchOpen, setIsHeadSearchOpen] = useState<boolean>(false);
  const [accountCategoryFilter, setAccountCategoryFilter] = useState<'ALL' | 'Customer' | 'Supplier' | 'Expense' | 'Bank' | 'Other'>('ALL');
  const headSearchRef = useRef<HTMLDivElement | null>(null);

  const [cashBankAccountId, setCashBankAccountId] = useState<number>(0);

  // Amount Inputs: Distinct and Mutually Exclusive
  const [receiptAmountStr, setReceiptAmountStr] = useState<string>('');
  const [paymentAmountStr, setPaymentAmountStr] = useState<string>('');
  const [narration, setNarration] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [viewVoucher, setViewVoucher] = useState<{ voucher: any; journalLines: any[] } | null>(null);
  const [deleteModalVoucher, setDeleteModalVoucher] = useState<CashBookVoucher | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [printVoucher, setPrintVoucher] = useState<any | null>(null);
  const [_printFormat, setPrintFormat] = useState<'a4' | '80mm' | '58mm'>('a4');
  const [whatsAppModalVoucher, setWhatsAppModalVoucher] = useState<any | null>(null);
  const [whatsAppPhone, setWhatsAppPhone] = useState<string>('');
  const [selectedAuditLogSnapshot, setSelectedAuditLogSnapshot] = useState<CashBookAuditLog | null>(null);

  const printableElementRef = useRef<HTMLDivElement | null>(null);

  // Close head account search dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (headSearchRef.current && !headSearchRef.current.contains(e.target as Node)) {
        setIsHeadSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Apply Quick Date Preset
  const handleApplyDatePreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'custom') => {
    setActiveDatePreset(preset);
    const now = new Date();
    if (preset === 'today') {
      const d = now.toISOString().slice(0, 10);
      setStartDate(d);
      setEndDate(d);
    } else if (preset === 'yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(y);
      setEndDate(y);
    } else if (preset === 'week') {
      const w = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(w);
      setEndDate(now.toISOString().slice(0, 10));
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      setStartDate(firstDay);
      setEndDate(now.toISOString().slice(0, 10));
    }
  };

  // Fetch Accounts & Reference Data
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.getCashBookAccounts();
      setAccountsData(res);
      if (res.defaultCashAccount && !cashBankAccountId) {
        setCashBankAccountId(res.defaultCashAccount.id);
      }
    } catch (err: unknown) {
      console.error(err);
    }
  }, [cashBankAccountId]);

  // Fetch Next Voucher Number
  const fetchNextNumber = useCallback(async () => {
    if (editingVoucherId) return;
    try {
      const res = await api.getCashBookNextNumber();
      setVoucherNumber(res.nextVoucherNumber);
      setSequenceNumber(res.nextSequence);
    } catch {
      setVoucherNumber('001');
      setSequenceNumber(1);
    }
  }, [editingVoucherId]);

  // Fetch Summary & Breakdown
  const fetchSummaryAndBreakdown = useCallback(async () => {
    try {
      setLoading(true);
      const [sumRes, bdownRes] = await Promise.all([
        api.getCashBookSummary({ startDate, endDate }),
        api.getCashBookBreakdown({ startDate, endDate }),
      ]);
      setSummaryData(sumRes);
      setBreakdownData(bdownRes);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Fetch Vouchers List
  const fetchVouchers = useCallback(async () => {
    try {
      const res = await api.getCashBookVouchers({
        q: filterSearch,
        startDate,
        endDate,
        transactionType: filterType,
        category: filterCategory,
        accountId: filterAccount,
        page: registerPage,
        pageSize,
      });
      setVouchers(res.data || []);
      setTotalVouchers(res.totalCount || 0);
    } catch (err: unknown) {
      console.error(err);
    }
  }, [filterSearch, startDate, endDate, filterType, filterCategory, filterAccount, registerPage]);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await api.getCashBookAuditHistory({ limit: 100 });
      setAuditLogs(res.data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Initial Load & On Date Change
  useEffect(() => {
    fetchAccounts();
    fetchNextNumber();
  }, [fetchAccounts, fetchNextNumber]);

  useEffect(() => {
    fetchSummaryAndBreakdown();
    fetchVouchers();
    fetchAuditLogs();
  }, [fetchSummaryAndBreakdown, fetchVouchers, fetchAuditLogs]);

  // Keyboard shortcut: F2 to Save/Post, Ctrl+N for New
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleSaveVoucher();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleResetForm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Automatically adjust category and head accounts when transaction type changes
  const handleTransactionTypeChange = (newType: CashBookTransactionType) => {
    setTransactionType(newType);

    if (newType === 'Receipt') {
      setCategory('customer_receipt');
      if (paymentAmountStr && !receiptAmountStr) {
        setReceiptAmountStr(paymentAmountStr);
        setPaymentAmountStr('');
      }
    } else if (newType === 'Payment') {
      setCategory('supplier_payment');
      if (receiptAmountStr && !paymentAmountStr) {
        setPaymentAmountStr(receiptAmountStr);
        setReceiptAmountStr('');
      }
    } else if (newType === 'Expense') {
      setCategory('shop_expense');
      if (receiptAmountStr && !paymentAmountStr) {
        setPaymentAmountStr(receiptAmountStr);
        setReceiptAmountStr('');
      }
    } else if (newType === 'Capital') {
      setCategory('capital_introduced');
    } else if (newType === 'Contra') {
      setCategory('cash_deposit_bank');
    }
  };

  // Amount Handlers ensuring mutual exclusivity
  const handleReceiptAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = sanitizeAmountInput(e.target.value);
    setReceiptAmountStr(raw);
    if (raw) {
      setPaymentAmountStr('');
      if (transactionType === 'Payment' || transactionType === 'Expense') {
        setTransactionType('Receipt');
        setCategory('customer_receipt');
      }
    }
  };

  const handlePaymentAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = sanitizeAmountInput(e.target.value);
    setPaymentAmountStr(raw);
    if (raw) {
      setReceiptAmountStr('');
      if (transactionType === 'Receipt') {
        setTransactionType('Payment');
        setCategory('supplier_payment');
      }
    }
  };

  // Filter accounts list for Head Account dropdown
  const filteredHeadAccounts = useMemo(() => {
    const all = accountsData?.allAccounts || [];
    const q = headAccountSearch.toLowerCase().trim();

    return all.filter((acc) => {
      // If user typed search query, search across name, code, group, phone
      if (q) {
        const matchName = acc.account_name.toLowerCase().includes(q);
        const matchCode = acc.account_code.toLowerCase().includes(q);
        const matchGroup = acc.account_group.toLowerCase().includes(q);
        const matchPhone = acc.phone ? acc.phone.includes(q) : false;
        if (!matchName && !matchCode && !matchGroup && !matchPhone) {
          return false;
        }
      }

      // Category tab filter inside dropdown
      if (accountCategoryFilter === 'Customer') {
        return ['Customer', 'Customer & Supplier'].includes(acc.account_group);
      }
      if (accountCategoryFilter === 'Supplier') {
        return ['Supplier', 'Customer & Supplier'].includes(acc.account_group);
      }
      if (accountCategoryFilter === 'Expense') {
        return ['Electricity', 'Rent', 'Salaries', 'Shop Expenses', 'Other Expenses', 'Expenses'].includes(acc.account_group);
      }
      if (accountCategoryFilter === 'Bank') {
        return ['Bank', 'Cash in Hand'].includes(acc.account_group);
      }
      if (accountCategoryFilter === 'Other') {
        return ['Capital', 'Drawings', 'Other Income', 'Income', 'Liabilities', 'Assets'].includes(acc.account_group);
      }

      return true;
    });
  }, [accountsData?.allAccounts, headAccountSearch, accountCategoryFilter]);

  // Selected Account Objects
  const selectedHeadAccount =
    (accountsData?.allAccounts || []).find((a) => a.id === headAccountId) || null;
  const selectedCashBankAccount =
    (accountsData?.allAccounts || []).find((a) => a.id === cashBankAccountId) ||
    accountsData?.defaultCashAccount ||
    null;

  // Active amounts
  const activeReceiptNum = parseAmountNumber(receiptAmountStr);
  const activePaymentNum = parseAmountNumber(paymentAmountStr);
  const effectiveNetAmt = activeReceiptNum > 0 ? activeReceiptNum : activePaymentNum;

  // Live Balance Calculations Preview
  const headPrevBal = Number(selectedHeadAccount?.current_balance || 0);
  const headPrevType = selectedHeadAccount?.current_balance_type || 'Debit';
  const headPrevSigned = headPrevType === 'Debit' ? headPrevBal : -headPrevBal;

  let headDelta = 0;
  if (effectiveNetAmt > 0) {
    if (activeReceiptNum > 0) {
      headDelta = -activeReceiptNum;
    } else {
      headDelta = activePaymentNum;
    }
  }
  const headNextSigned = headPrevSigned + headDelta;
  const headNextBal = Math.abs(headNextSigned);
  const headNextType = headNextSigned >= 0 ? 'Debit' : 'Credit';

  // Cash / Bank Account Balance Preview
  const cbPrevBal = Number(selectedCashBankAccount?.current_balance || 0);
  const cbPrevType = selectedCashBankAccount?.current_balance_type || 'Debit';
  const cbPrevSigned = cbPrevType === 'Debit' ? cbPrevBal : -cbPrevBal;

  let cbDelta = 0;
  if (effectiveNetAmt > 0) {
    if (activeReceiptNum > 0) {
      cbDelta = activeReceiptNum;
    } else {
      cbDelta = -activePaymentNum;
    }
  }
  const cbNextSigned = cbPrevSigned + cbDelta;
  const cbNextBal = Math.abs(cbNextSigned);
  const cbNextType = cbNextSigned >= 0 ? 'Debit' : 'Credit';

  // Reset Form
  const handleResetForm = () => {
    setEditingVoucherId(null);
    setReceiptAmountStr('');
    setPaymentAmountStr('');
    setNarration('');
    setReferenceNumber('');
    setHeadAccountId(0);
    setHeadAccountSearch('');
    setIsHeadSearchOpen(false);
    fetchNextNumber();
    setErrorMsg(null);
  };

  // Submit / Save Voucher
  const handleSaveVoucher = async () => {
    if (saving) return; // Prevent duplicate rapid clicks

    try {
      setErrorMsg(null);
      setSuccessMsg(null);

      if (!headAccountId) {
        setErrorMsg('Please select an Account Name using the search dropdown.');
        return;
      }
      if (!cashBankAccountId) {
        setErrorMsg('Please select a Cash / Bank Account.');
        return;
      }
      if (headAccountId === cashBankAccountId) {
        setErrorMsg('Head Account and Cash/Bank Account cannot be the same account.');
        return;
      }

      const recAmt = parseAmountNumber(receiptAmountStr);
      const payAmt = parseAmountNumber(paymentAmountStr);

      if (recAmt <= 0 && payAmt <= 0) {
        setErrorMsg('Please enter either a Receipt Amount or a Payment Amount greater than Rs. 0.00.');
        return;
      }

      if (recAmt > 0 && payAmt > 0) {
        setErrorMsg('A single voucher cannot have both Receipt and Payment amounts simultaneously.');
        return;
      }

      setSaving(true);

      const netAmount = recAmt > 0 ? recAmt : payAmt;
      const derivedType: CashBookTransactionType =
        transactionType === 'Contra'
          ? 'Contra'
          : transactionType === 'Capital'
          ? 'Capital'
          : recAmt > 0
          ? 'Receipt'
          : transactionType === 'Expense'
          ? 'Expense'
          : 'Payment';

      const payload = {
        voucher_date: voucherDate,
        transaction_type: derivedType,
        category,
        head_account_id: headAccountId,
        cash_bank_account_id: cashBankAccountId,
        receipt_amount: recAmt,
        payment_amount: payAmt,
        net_amount: netAmount,
        narration: narration.trim(),
        reference_number: referenceNumber.trim(),
      };

      if (editingVoucherId) {
        await api.updateCashBookVoucher(editingVoucherId, payload);
        setSuccessMsg(`Voucher #${voucherNumber} updated and double-entry ledger reconciled successfully.`);
      } else {
        const res = await api.createCashBookVoucher(payload);
        const postedNo = res.voucher?.voucher_number || voucherNumber;
        setSuccessMsg(`Voucher #${postedNo} saved successfully. Transaction recorded in Cash Book register.`);
      }

      handleResetForm();
      await Promise.all([fetchAccounts(), fetchSummaryAndBreakdown(), fetchVouchers(), fetchAuditLogs()]);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Edit Voucher Handler
  const handleLoadVoucherToEdit = (v: CashBookVoucher) => {
    setEditingVoucherId(v.id);
    setVoucherNumber(v.voucher_number);
    setSequenceNumber(v.sequence_number);
    setVoucherDate(v.voucher_date);
    setTransactionType(v.transaction_type);
    setCategory(v.category);
    setHeadAccountId(v.head_account_id);
    setHeadAccountSearch(v.head_account_name);
    setCashBankAccountId(v.cash_bank_account_id);

    if (v.receipt_amount > 0) {
      setReceiptAmountStr(String(v.receipt_amount));
      setPaymentAmountStr('');
    } else {
      setPaymentAmountStr(String(v.payment_amount));
      setReceiptAmountStr('');
    }

    setNarration(v.narration || '');
    setReferenceNumber(v.reference_number || '');
    setViewVoucher(null); // Close modal if editing from view
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSuccessMsg(`Loaded Voucher #${v.voucher_number} for editing. Make modifications and click Update Voucher.`);
  };

  // Delete Voucher Handler (Admin Only)
  const handleConfirmDeleteVoucher = async () => {
    if (!deleteModalVoucher) return;
    if (!isAdmin) {
      setErrorMsg('Access Denied: Only Administrator or Super Admin can delete vouchers.');
      setDeleteModalVoucher(null);
      return;
    }

    try {
      setIsDeleting(true);
      await api.deleteCashBookVoucher(deleteModalVoucher.id);
      setSuccessMsg(`Voucher #${deleteModalVoucher.voucher_number} deleted and double-entry accounting reversed.`);
      setDeleteModalVoucher(null);
      await Promise.all([fetchAccounts(), fetchSummaryAndBreakdown(), fetchVouchers(), fetchAuditLogs()]);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  // View Voucher Details
  const handleOpenViewVoucher = async (id: number) => {
    try {
      const res = await api.getCashBookVoucher(id);
      setViewVoucher(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Print Voucher
  const handleOpenPrint = (v: any, format: 'a4' | '80mm' | '58mm') => {
    setPrintVoucher(v);
    setPrintFormat(format);
    setTimeout(() => {
      executePrintElement(printableElementRef.current, {
        title: `Cash_Voucher_${v.voucher_number}`,
        paperSize: format,
        copies: 1,
      });
    }, 100);
  };

  // WhatsApp Share Modal
  const handleOpenWhatsApp = (v: any) => {
    setWhatsAppModalVoucher(v);
    const head = (accountsData?.allAccounts || []).find((a) => a.id === v.head_account_id);
    setWhatsAppPhone(head?.phone || '');
  };

  const handleSendWhatsApp = () => {
    if (!whatsAppModalVoucher) return;
    const v = whatsAppModalVoucher;
    const cleanPhone = whatsAppPhone.replace(/[^0-9]/g, '');
    const phoneParam = cleanPhone ? (cleanPhone.startsWith('92') ? cleanPhone : `92${cleanPhone.replace(/^0/, '')}`) : '';

    const text = encodeURIComponent(
      `*ABRAR MEDICAL STORE*\n` +
      `*Cash Book Voucher #${v.voucher_number}*\n` +
      `--------------------------------\n` +
      `Date: ${formatPKTDate(v.voucher_date)}\n` +
      `Type: ${v.transaction_type} (${v.category.replace(/_/g, ' ').toUpperCase()})\n` +
      `Account: ${v.head_account_name}\n` +
      `Cash/Bank: ${v.cash_bank_account_name}\n` +
      `Amount: ${formatPKR(v.net_amount)}\n` +
      (v.narration ? `Details: ${v.narration}\n` : '') +
      `--------------------------------\n` +
      `Thank you for your business!\n` +
      `Abrar Medical Store, Main Bazar`
    );

    const url = phoneParam ? `https://wa.me/${phoneParam}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
    setWhatsAppModalVoucher(null);
  };

  // Export Register to Excel
  const handleExportExcel = () => {
    const rows = vouchers.map((v) => ({
      'Voucher #': v.voucher_number,
      Date: v.voucher_date,
      Type: v.transaction_type,
      Category: v.category.replace(/_/g, ' '),
      'Head Account': v.head_account_name,
      'Cash / Bank Account': v.cash_bank_account_name,
      'Receipt (PKR)': v.receipt_amount || 0,
      'Payment (PKR)': v.payment_amount || 0,
      Narration: v.narration,
      'Reference #': v.reference_number,
      Status: v.status,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cash Book Register');
    XLSX.writeFile(wb, `AMS_Cash_Book_${startDate}_to_${endDate}.xlsx`);
  };

  const totalPages = Math.max(1, Math.ceil(totalVouchers / pageSize));

  return (
    <div className="space-y-4">
      {/* ================= 1. TOP HEADER & SUMMARY KPI STRIP ================= */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                Cash Book & Accounting Module
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 uppercase">
                  Continuous Double-Entry
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                Abrar Medical Store • Receipts, Payments, Bank Transfers & Continuous Sequence Day Book
              </p>
            </div>
          </div>

          {/* Quick Date Presets & Filter */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(['today', 'yesterday', 'week', 'month', 'custom'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleApplyDatePreset(preset)}
                  className={`px-2.5 py-1 rounded-md font-bold capitalize cursor-pointer transition-colors ${
                    activeDatePreset === preset
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 font-mono text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setActiveDatePreset('custom');
                  setStartDate(e.target.value);
                }}
                className="outline-none text-slate-800 font-semibold cursor-pointer"
              />
              <span className="text-slate-400 font-sans">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setActiveDatePreset('custom');
                  setEndDate(e.target.value);
                }}
                className="outline-none text-slate-800 font-semibold cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">Opening Cash (B/F)</div>
            <div className="text-sm font-black font-mono text-slate-800 mt-0.5">
              {formatPKR(summaryData?.openingCashBalance || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-[10px] font-bold uppercase text-emerald-700">Cash Received (+)</div>
            <div className="text-sm font-black font-mono text-emerald-800 mt-0.5">
              {formatPKR(summaryData?.totalCashReceived || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200">
            <div className="text-[10px] font-bold uppercase text-rose-700">Cash Paid (-)</div>
            <div className="text-sm font-black font-mono text-rose-800 mt-0.5">
              {formatPKR(summaryData?.totalCashPaid || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200">
            <div className="text-[10px] font-bold uppercase text-teal-800">Closing Cash (C/F)</div>
            <div className="text-sm font-black font-mono text-teal-900 mt-0.5">
              {formatPKR(summaryData?.closingCashBalance || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">Opening Bank (B/F)</div>
            <div className="text-sm font-black font-mono text-slate-800 mt-0.5">
              {formatPKR(summaryData?.openingBankBalance || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200">
            <div className="text-[10px] font-bold uppercase text-sky-700">Bank Deposits / In</div>
            <div className="text-sm font-black font-mono text-sky-800 mt-0.5">
              {formatPKR((summaryData?.totalBankDeposits || 0) + (summaryData?.totalBankReceipts || 0))}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
            <div className="text-[10px] font-bold uppercase text-amber-700">Bank Outflows</div>
            <div className="text-sm font-black font-mono text-amber-800 mt-0.5">
              {formatPKR((summaryData?.totalBankWithdrawals || 0) + (summaryData?.totalBankPayments || 0))}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
            <div className="text-[10px] font-bold uppercase text-blue-800">Closing Bank (C/F)</div>
            <div className="text-sm font-black font-mono text-blue-900 mt-0.5">
              {formatPKR(summaryData?.closingBankBalance || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================= 2. UNIFIED RECEIPT / PAYMENT ENTRY SCREEN ================= */}
      <div className={`bg-white rounded-2xl border ${editingVoucherId ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'} shadow-sm p-4 text-xs space-y-4`}>
        {/* Top Header of Form */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono font-black text-xs flex items-center gap-1.5 shadow-xs">
              <Receipt className="w-3.5 h-3.5 text-amber-400" />
              VOUCHER #{voucherNumber}
            </span>
            {editingVoucherId ? (
              <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-white font-bold text-xs flex items-center gap-1 animate-pulse">
                <Pencil className="w-3.5 h-3.5" />
                EDITING SAVED VOUCHER #{voucherNumber}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
                Continuous Sequence (Never resets daily)
              </span>
            )}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Date:</span>
              <input
                type="date"
                value={voucherDate}
                onChange={(e) => setVoucherDate(e.target.value)}
                className="font-mono text-xs font-bold text-slate-900 outline-none bg-transparent cursor-pointer"
              />
            </div>
          </div>

          {/* Transaction Type Buttons */}
          <div className="flex flex-wrap items-center gap-1">
            {(['Receipt', 'Payment', 'Contra', 'Expense', 'Capital'] as const).map((type) => {
              const isActive = transactionType === type;
              let activeClass = 'bg-slate-900 text-white';
              if (type === 'Receipt') activeClass = 'bg-emerald-600 text-white shadow-xs';
              if (type === 'Payment') activeClass = 'bg-rose-600 text-white shadow-xs';
              if (type === 'Contra') activeClass = 'bg-purple-600 text-white shadow-xs';
              if (type === 'Expense') activeClass = 'bg-amber-600 text-white shadow-xs';
              if (type === 'Capital') activeClass = 'bg-blue-600 text-white shadow-xs';

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTransactionTypeChange(type)}
                  className={`px-3 py-1.5 rounded-xl font-black text-xs cursor-pointer transition-all ${
                    isActive ? activeClass : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Entry Inputs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
          {/* 1. Category */}
          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Transaction Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CashBookCategory)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              {transactionType === 'Receipt' && (
                <>
                  <option value="customer_receipt">Customer Receipt (Payment Received)</option>
                  <option value="other_receipt">Other Income / Direct Inflow</option>
                </>
              )}
              {transactionType === 'Payment' && (
                <>
                  <option value="supplier_payment">Supplier Payment (Vendor Disbursement)</option>
                  <option value="other_payment">Other Payment / General Outflow</option>
                  <option value="drawings">Owner Drawings (-)</option>
                </>
              )}
              {transactionType === 'Expense' && (
                <>
                  <option value="shop_expense">Shop Expense (Electricity, Rent, Salaries, Misc)</option>
                </>
              )}
              {transactionType === 'Capital' && (
                <>
                  <option value="capital_introduced">Owner Capital Introduced (+)</option>
                  <option value="drawings">Owner Drawings (-)</option>
                </>
              )}
              {transactionType === 'Contra' && (
                <>
                  <option value="cash_deposit_bank">Cash Deposit into Bank (Cash → Bank)</option>
                  <option value="cash_withdrawal_bank">Cash Withdrawal from Bank (Bank → Cash)</option>
                  <option value="bank_transfer">Bank-to-Bank Transfer</option>
                </>
              )}
            </select>
          </div>

          {/* 2. Fast Searchable Account Name Dropdown */}
          <div className="md:col-span-5 relative" ref={headSearchRef}>
            <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1 flex items-center justify-between">
              <span>Account Name (Search Customer / Supplier / Expense / Bank) *</span>
              {selectedHeadAccount && (
                <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                  {selectedHeadAccount.account_code}
                </span>
              )}
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={headAccountSearch || selectedHeadAccount?.account_name || ''}
                onFocus={() => {
                  setIsHeadSearchOpen(true);
                  if (selectedHeadAccount && !headAccountSearch) {
                    setHeadAccountSearch(selectedHeadAccount.account_name);
                  }
                }}
                onChange={(e) => {
                  setHeadAccountSearch(e.target.value);
                  setIsHeadSearchOpen(true);
                  if (headAccountId && e.target.value !== selectedHeadAccount?.account_name) {
                    setHeadAccountId(0);
                  }
                }}
                placeholder="Type name (e.g. walk-in, rafiq), code (e.g. Cus-001) or group..."
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              {selectedHeadAccount ? (
                <button
                  type="button"
                  onClick={() => {
                    setHeadAccountId(0);
                    setHeadAccountSearch('');
                    setIsHeadSearchOpen(true);
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title="Clear account"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>

            {/* Fast Dropdown Options */}
            {isHeadSearchOpen && (
              <div className="absolute z-40 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white rounded-xl border border-slate-300 shadow-2xl p-2 text-xs space-y-1.5 animate-in fade-in zoom-in-95">
                {/* Category quick filter chips inside dropdown */}
                <div className="flex items-center gap-1 pb-1.5 border-b border-slate-100 overflow-x-auto text-[10px]">
                  {(['ALL', 'Customer', 'Supplier', 'Expense', 'Bank', 'Other'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setAccountCategoryFilter(cat)}
                      className={`px-2 py-0.5 rounded-md font-bold whitespace-nowrap cursor-pointer ${
                        accountCategoryFilter === cat ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="text-[10px] text-slate-400 px-1 font-semibold flex justify-between">
                  <span>Found {filteredHeadAccounts.length} matching accounts</span>
                  <span>Click to select</span>
                </div>

                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {filteredHeadAccounts.length === 0 ? (
                    <div className="p-4 text-center text-slate-400">
                      No accounts found matching "{headAccountSearch}". Try typing a different keyword or code.
                    </div>
                  ) : (
                    filteredHeadAccounts.map((acc) => {
                      let badgeBg = 'bg-slate-100 text-slate-700';
                      if (acc.account_group.includes('Customer')) badgeBg = 'bg-emerald-100 text-emerald-800';
                      if (acc.account_group.includes('Supplier')) badgeBg = 'bg-rose-100 text-rose-800';
                      if (acc.account_group.includes('Expense') || acc.account_group === 'Electricity' || acc.account_group === 'Rent') badgeBg = 'bg-amber-100 text-amber-800';
                      if (acc.account_group === 'Bank') badgeBg = 'bg-sky-100 text-sky-800';

                      return (
                        <div
                          key={acc.id}
                          onClick={() => {
                            setHeadAccountId(acc.id);
                            setHeadAccountSearch(acc.account_name);
                            setIsHeadSearchOpen(false);
                          }}
                          className={`p-2 rounded-lg hover:bg-emerald-50/70 flex items-center justify-between cursor-pointer border border-transparent hover:border-emerald-200 transition-colors ${
                            acc.id === headAccountId ? 'bg-emerald-50 border-emerald-300' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black font-mono uppercase ${badgeBg}`}>
                              {acc.account_code}
                            </span>
                            <div>
                              <div className="font-black text-slate-900">{acc.account_name}</div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {acc.account_group} {acc.phone ? `• 📞 ${acc.phone}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-black text-slate-900">{formatPKR(acc.current_balance)}</div>
                            <div className="text-[9px] text-slate-400 uppercase font-bold">
                              {acc.current_balance_type || 'Debit'}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Cash / Bank Account */}
          <div className="md:col-span-4">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Cash / Bank Account (Default: Cash in Hand) *
            </label>
            <select
              value={cashBankAccountId}
              onChange={(e) => setCashBankAccountId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              {(accountsData?.cashAccounts || []).map((c) => (
                <option key={c.id} value={c.id}>
                  💵 {c.account_name} ({formatPKR(c.current_balance)})
                </option>
              ))}
              {(accountsData?.bankAccounts || []).map((b) => (
                <option key={b.id} value={b.id}>
                  🏦 {b.account_name} ({formatPKR(b.current_balance)})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Receipt Amount & Payment Amount - Distinct & Mutually Exclusive */}
          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase text-emerald-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5" />
                Receipt Amount (Dr Inflow)
              </span>
              <span className="text-[9px] text-slate-400">Rs.</span>
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={receiptAmountStr}
              onChange={handleReceiptAmountChange}
              placeholder="0.00"
              className="w-full px-3 py-2 rounded-xl border border-emerald-400 font-mono font-black text-sm text-emerald-800 bg-emerald-50/20 text-right focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase text-rose-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                Payment Amount (Cr Outflow)
              </span>
              <span className="text-[9px] text-slate-400">Rs.</span>
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={paymentAmountStr}
              onChange={handlePaymentAmountChange}
              placeholder="0.00"
              className="w-full px-3 py-2 rounded-xl border border-rose-400 font-mono font-black text-sm text-rose-800 bg-rose-50/20 text-right focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>

          {/* 5. Narration */}
          <div className="md:col-span-4">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Details / Narration
            </label>
            <input
              type="text"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. Cash collection against invoice, Electricity bill, Vendor payment..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* 6. Reference Number */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Reference / Cheque #
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Optional Ref / Slip #"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Live Balance Preview Strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
          {/* Head Account Balance */}
          <div className="flex items-center justify-between text-xs">
            <div>
              <span className="font-bold text-slate-700">Account: </span>
              <span className="font-black text-slate-900">
                {selectedHeadAccount?.account_name || 'No account selected'}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Previous</span>
                <span className="font-bold text-slate-700">{formatPKR(headPrevBal)} ({headPrevType})</span>
              </div>
              <span className="text-slate-400 font-sans">→</span>
              <div>
                <span className="text-[10px] text-emerald-600 block uppercase font-bold">New Balance</span>
                <span className="font-black text-emerald-800">{formatPKR(headNextBal)} ({headNextType})</span>
              </div>
            </div>
          </div>

          {/* Cash / Bank Account Balance */}
          <div className="flex items-center justify-between text-xs border-t md:border-t-0 md:border-l border-slate-200 md:pl-4 pt-2 md:pt-0">
            <div>
              <span className="font-bold text-slate-700">Cash/Bank: </span>
              <span className="font-black text-slate-900">
                {selectedCashBankAccount?.account_name || 'Cash in Hand'}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Previous</span>
                <span className="font-bold text-slate-700">{formatPKR(cbPrevBal)} ({cbPrevType})</span>
              </div>
              <span className="text-slate-400 font-sans">→</span>
              <div>
                <span className="text-[10px] text-teal-600 block uppercase font-bold">New Balance</span>
                <span className="font-black text-teal-800">{formatPKR(cbNextBal)} ({cbNextType})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Form Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-[11px] text-slate-500 font-medium">
            {editingVoucherId ? (
              <span className="text-amber-700 font-bold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Original Voucher #{voucherNumber} will be retained. All affected ledgers will be recalculated.
              </span>
            ) : (
              <span>Shortcuts: Press <strong>F2</strong> to Post, <strong>Ctrl+N</strong> for new voucher.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetForm}
              className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {editingVoucherId ? 'Cancel Edit' : 'Clear Form (Ctrl+N)'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveVoucher}
              className={`px-6 py-2 rounded-xl text-white font-black flex items-center gap-2 cursor-pointer shadow-md transition-all active:scale-[0.98] ${
                saving
                  ? 'bg-slate-400 cursor-not-allowed'
                  : editingVoucherId
                  ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20'
              }`}
            >
              <Save className="w-4 h-4" />
              {saving
                ? 'Saving Voucher...'
                : editingVoucherId
                ? `Update Voucher #${voucherNumber} (F2)`
                : `Post Voucher #${voucherNumber} (F2)`}
            </button>
          </div>
        </div>
      </div>

      {/* ================= 3. MULTI-TAB REGISTER & REPORTS ================= */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs">
        {/* Navigation Tabs Header */}
        <div className="flex items-center gap-1 p-2 bg-slate-50 border-b border-slate-200 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'register' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            Cash Book Day Book ({totalVouchers})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('daily_summary')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'daily_summary' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            Daily Balances & Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('who_paid')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'who_paid' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            Who Paid Us? ({breakdownData?.whoPaidUs?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('whom_paid')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'whom_paid' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
            Whom Did We Pay? ({breakdownData?.whomDidWePay?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inflows_outflows')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'inflows_outflows' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5 text-blue-500" />
            Inflows & Outflows
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bank_contra')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'bank_contra' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-purple-600" />
            Bank Deposits & Withdrawals ({breakdownData?.bankContra?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('account_balances')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'account_balances' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-teal-600" />
            Cash & Bank Balances
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit_trail')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'audit_trail' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5 text-amber-500" />
            Audit Trail ({auditLogs.length})
          </button>
        </div>

        {/* Tab 1: Cash Book Day Book / Register */}
        {activeTab === 'register' && (
          <div className="p-4 space-y-3">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={(e) => {
                      setRegisterPage(1);
                      setFilterSearch(e.target.value);
                    }}
                    placeholder="Search Voucher #, Account, Narration..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 font-medium"
                  />
                </div>

                <select
                  value={filterType}
                  onChange={(e) => {
                    setRegisterPage(1);
                    setFilterType(e.target.value);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="all">All Types</option>
                  <option value="Receipt">Receipts</option>
                  <option value="Payment">Payments</option>
                  <option value="Expense">Expenses</option>
                  <option value="Contra">Contra Transfers</option>
                  <option value="Capital">Capital</option>
                </select>

                <select
                  value={filterAccount}
                  onChange={(e) => {
                    setRegisterPage(1);
                    setFilterAccount(e.target.value);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold max-w-[200px]"
                >
                  <option value="all">All Accounts</option>
                  {(accountsData?.allAccounts || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_name} ({a.account_code})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Export Excel
              </button>
            </div>

            {/* Vouchers Table */}
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5">Voucher #</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Account Name</th>
                    <th className="px-3 py-2.5">Cash / Bank Account</th>
                    <th className="px-3 py-2.5">Narration / Details</th>
                    <th className="px-3 py-2.5 text-right text-emerald-300">Receipt (Dr)</th>
                    <th className="px-3 py-2.5 text-right text-rose-300">Payment (Cr)</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400">
                        Loading Cash Book vouchers...
                      </td>
                    </tr>
                  ) : vouchers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400">
                        No cash book vouchers found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    vouchers.map((v) => {
                      let badgeColor = 'bg-slate-100 text-slate-800 border-slate-200';
                      if (v.transaction_type === 'Receipt') badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                      if (v.transaction_type === 'Payment') badgeColor = 'bg-rose-100 text-rose-800 border-rose-200';
                      if (v.transaction_type === 'Expense') badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';
                      if (v.transaction_type === 'Contra') badgeColor = 'bg-purple-100 text-purple-800 border-purple-200';
                      if (v.transaction_type === 'Capital') badgeColor = 'bg-blue-100 text-blue-800 border-blue-200';

                      return (
                        <tr
                          key={v.id}
                          className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                            v.id === editingVoucherId ? 'bg-amber-50/70 font-semibold' : ''
                          }`}
                        >
                          <td className="px-3 py-2 font-mono font-black text-slate-900">
                            #{v.voucher_number}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-700">{v.voucher_date}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${badgeColor}`}>
                              {v.transaction_type}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-900">{v.head_account_name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {v.head_account_code}
                              {v.head_group && ` • ${v.head_group}`}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-800">
                            {v.cash_bank_account_name}
                          </td>
                          <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={v.narration}>
                            {v.narration || '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                            {v.receipt_amount > 0 ? formatPKR(v.receipt_amount) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-rose-700">
                            {v.payment_amount > 0 ? formatPKR(v.payment_amount) : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                v.status === 'posted'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {v.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              {/* View / Reopen Voucher Button */}
                              <button
                                type="button"
                                onClick={() => handleOpenViewVoucher(v.id)}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                                title="View details and journal entries"
                              >
                                <Eye className="w-3 h-3 text-slate-600" />
                                View
                              </button>

                              {v.status === 'posted' && (
                                <>
                                  {/* Edit Voucher Button */}
                                  <button
                                    type="button"
                                    onClick={() => handleLoadVoucherToEdit(v)}
                                    className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                                    title="Edit this voucher"
                                  >
                                    <Pencil className="w-3 h-3 text-amber-600" />
                                    Edit
                                  </button>

                                  {/* Print A4 */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPrint(v, 'a4')}
                                    className="px-1.5 py-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px] cursor-pointer"
                                    title="Print A4 Voucher"
                                  >
                                    <Printer className="w-3 h-3" />
                                  </button>

                                  {/* WhatsApp Share */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenWhatsApp(v)}
                                    className="px-1.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer"
                                    title="Share on WhatsApp"
                                  >
                                    <Share2 className="w-3 h-3" />
                                  </button>

                                  {/* Admin-Only Delete Button */}
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => setDeleteModalVoucher(v)}
                                      className="p-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 cursor-pointer"
                                      title="Admin: Delete voucher and reverse accounting"
                                    >
                                      <Trash2 className="w-3 h-3 text-rose-600" />
                                    </button>
                                  )}
                                </>
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

            {/* Pagination Footer */}
            <div className="px-2 py-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing Page <strong>{registerPage}</strong> of <strong>{totalPages}</strong> ({totalVouchers} records)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={registerPage <= 1}
                  onClick={() => setRegisterPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  disabled={registerPage >= totalPages}
                  onClick={() => setRegisterPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Daily Balances & Reconciliation */}
        {activeTab === 'daily_summary' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Daily Chronological Cash & Bank Balances
                </h3>
                <p className="text-slate-500 text-[11px]">
                  Continuous running balance formula: Next day Opening Balance = Previous day Closing Balance
                </p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5 text-right">Opening Cash (B/F)</th>
                    <th className="px-3 py-2.5 text-right text-emerald-300">Cash Receipts</th>
                    <th className="px-3 py-2.5 text-right text-rose-300">Cash Payments</th>
                    <th className="px-3 py-2.5 text-right text-teal-300 font-black">Closing Cash (C/F)</th>
                    <th className="px-3 py-2.5 text-right">Opening Bank (B/F)</th>
                    <th className="px-3 py-2.5 text-right text-sky-300">Bank In</th>
                    <th className="px-3 py-2.5 text-right text-amber-300">Bank Out</th>
                    <th className="px-3 py-2.5 text-right text-blue-300 font-black">Closing Bank (C/F)</th>
                    <th className="px-3 py-2.5 text-center">Vouchers</th>
                  </tr>
                </thead>
                <tbody>
                  {(summaryData?.dailyRegister || []).map((row, idx) => (
                    <tr
                      key={row.date}
                      className={`border-b border-slate-100 ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-bold text-slate-900">{row.date}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPKR(row.openingCash)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                        {formatPKR(row.cashIn)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-rose-700">
                        {formatPKR(row.cashOut)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-teal-800 bg-teal-50/30">
                        {formatPKR(row.closingCash)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatPKR(row.openingBank)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-sky-700">
                        {formatPKR(row.bankIn)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-amber-700">
                        {formatPKR(row.bankOut)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-blue-900 bg-blue-50/30">
                        {formatPKR(row.closingBank)}
                      </td>
                      <td className="px-3 py-2 text-center font-mono font-bold">{row.voucherCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Who Paid Us? */}
        {activeTab === 'who_paid' && (
          <div className="p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Customer Receipts & Revenue Inflows</h3>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2">Voucher #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Payer / Customer</th>
                    <th className="px-3 py-2">Contact / Phone</th>
                    <th className="px-3 py-2">Payment Account</th>
                    <th className="px-3 py-2 text-right">Amount (PKR)</th>
                    <th className="px-3 py-2">Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {(breakdownData?.whoPaidUs || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        No customer receipts in this date range.
                      </td>
                    </tr>
                  ) : (
                    breakdownData?.whoPaidUs.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">#{r.voucher_number}</td>
                        <td className="px-3 py-2 font-mono">{r.voucher_date}</td>
                        <td className="px-3 py-2 font-bold text-slate-900">
                          {r.payer_name}
                          <span className="ml-1 text-[10px] text-slate-500 font-normal">({r.payer_code})</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.phone || '—'}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{r.payment_account}</td>
                        <td className="px-3 py-2 text-right font-mono font-black text-emerald-700">
                          {formatPKR(r.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.narration}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Whom Did We Pay? */}
        {activeTab === 'whom_paid' && (
          <div className="p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Supplier Payments & Expense Disbursements</h3>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2">Voucher #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Payee / Account</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Paid From</th>
                    <th className="px-3 py-2 text-right">Amount (PKR)</th>
                    <th className="px-3 py-2">Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {(breakdownData?.whomDidWePay || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        No payments recorded in this date range.
                      </td>
                    </tr>
                  ) : (
                    breakdownData?.whomDidWePay.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">#{r.voucher_number}</td>
                        <td className="px-3 py-2 font-mono">{r.voucher_date}</td>
                        <td className="px-3 py-2 font-bold text-slate-900">
                          {r.payee_name}
                          <span className="ml-1 text-[10px] text-slate-500 font-normal">({r.payee_code})</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-bold uppercase text-[9px]">
                            {r.category.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{r.payment_account}</td>
                        <td className="px-3 py-2 text-right font-mono font-black text-rose-700">
                          {formatPKR(r.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.narration}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 5: Inflows & Outflows */}
        {activeTab === 'inflows_outflows' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-bold text-emerald-800 text-xs uppercase flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  Where Did Money Come From? (Inflows)
                </h4>
                <div className="border border-emerald-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-emerald-900 text-white">
                      <tr>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5 text-center">Vouchers</th>
                        <th className="p-2.5 text-right">Total Amount (PKR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(breakdownData?.moneyFromCategories || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-400">
                            No inflow records in period.
                          </td>
                        </tr>
                      ) : (
                        breakdownData?.moneyFromCategories.map((c) => (
                          <tr key={c.category_label} className="border-b border-emerald-100">
                            <td className="p-2.5 font-bold text-slate-900">{c.category_label}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-600">
                              {c.voucher_count}
                            </td>
                            <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                              {formatPKR(c.total_amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-rose-800 text-xs uppercase flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-rose-600" />
                  Where Was Money Spent? (Outflows)
                </h4>
                <div className="border border-rose-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-rose-900 text-white">
                      <tr>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5 text-center">Vouchers</th>
                        <th className="p-2.5 text-right">Total Amount (PKR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(breakdownData?.moneySpentCategories || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-400">
                            No outflow records in period.
                          </td>
                        </tr>
                      ) : (
                        breakdownData?.moneySpentCategories.map((c) => (
                          <tr key={c.category_label} className="border-b border-rose-100">
                            <td className="p-2.5 font-bold text-slate-900">{c.category_label}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-600">
                              {c.voucher_count}
                            </td>
                            <td className="p-2.5 text-right font-mono font-black text-rose-700">
                              {formatPKR(c.total_amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Bank Contra Transfers */}
        {activeTab === 'bank_contra' && (
          <div className="p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">
              Bank Deposits & Withdrawals (Internal Transfers)
            </h3>
            <p className="text-[11px] text-slate-500">
              Contra transactions move funds between Cash in Hand and Banks or between Bank accounts without affecting store income or expenses.
            </p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-purple-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2">Voucher #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Contra Type</th>
                    <th className="px-3 py-2">From Account</th>
                    <th className="px-3 py-2">To Account</th>
                    <th className="px-3 py-2 text-right">Transfer Amount (PKR)</th>
                    <th className="px-3 py-2">Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {(breakdownData?.bankContra || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        No contra transfers in this period.
                      </td>
                    </tr>
                  ) : (
                    breakdownData?.bankContra.map((b) => (
                      <tr key={b.id} className="border-b border-purple-100 hover:bg-purple-50/50">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">#{b.voucher_number}</td>
                        <td className="px-3 py-2 font-mono">{b.voucher_date}</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold text-[9px] uppercase">
                            {b.category.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold text-slate-800">{(b as any).source_account_name || b.cash_bank_account_name}</td>
                        <td className="px-3 py-2 font-bold text-slate-800">{(b as any).bank_or_dest_name || b.head_account_name}</td>
                        <td className="px-3 py-2 text-right font-mono font-black text-purple-900">
                          {formatPKR(b.net_amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{b.narration}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 7: Cash & Bank Balances */}
        {activeTab === 'account_balances' && (
          <div className="p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Real-time Cash Drawer & Bank Balances</h3>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2.5">Account Code</th>
                    <th className="px-3 py-2.5">Account Name</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5 text-right">Opening Balance</th>
                    <th className="px-3 py-2.5 text-right text-emerald-300">Total Debit (Dr)</th>
                    <th className="px-3 py-2.5 text-right text-rose-300">Total Credit (Cr)</th>
                    <th className="px-3 py-2.5 text-right text-teal-300 font-black">Current Balance (PKR)</th>
                    <th className="px-3 py-2.5 text-center">Balance Type</th>
                  </tr>
                </thead>
                <tbody>
                  {(breakdownData?.cashAndBankAccounts || []).map((acc) => (
                    <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-bold text-slate-700">{acc.account_code}</td>
                      <td className="px-3 py-2 font-bold text-slate-900 flex items-center gap-1.5">
                        {acc.account_group === 'Cash in Hand' ? '💵' : '🏦'} {acc.account_name}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-600">{acc.account_group}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPKR(acc.opening_balance)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                        {formatPKR(acc.total_debit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-rose-700">
                        {formatPKR(acc.total_credit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-teal-900 bg-teal-50/20">
                        {formatPKR(acc.current_balance)}
                      </td>
                      <td className="px-3 py-2 text-center uppercase font-bold text-[10px] text-slate-600">
                        {acc.current_balance_type}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 8: Audit Trail */}
        {activeTab === 'audit_trail' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Cash Book Transaction Audit Trail & History
                </h3>
                <p className="text-[11px] text-slate-500">
                  Immutable record of every Cash Book Voucher creation, modification, and Admin deletion with timestamps and user attribution.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchAuditLogs}
                className="px-3 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 text-[11px] cursor-pointer"
              >
                Refresh Log
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Date & Time</th>
                    <th className="px-3 py-2">Voucher #</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Performed By</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2 text-center">Snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-slate-400">
                        No audit records found yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => {
                      let actionColor = 'bg-slate-100 text-slate-800';
                      if (log.action === 'CREATED') actionColor = 'bg-emerald-100 text-emerald-800';
                      if (log.action === 'UPDATED') actionColor = 'bg-amber-100 text-amber-800';
                      if (log.action === 'DELETED') actionColor = 'bg-rose-100 text-rose-800 font-black';

                      return (
                        <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-500">#{log.id}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">
                            {formatPKTDate(log.created_at)}
                          </td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">
                            #{log.voucher_number}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${actionColor}`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-bold text-slate-900">{log.performed_by}</td>
                          <td className="px-3 py-2 text-slate-600">{log.performed_by_role || 'Staff'}</td>
                          <td className="px-3 py-2 text-slate-700 max-w-sm truncate" title={log.details}>
                            {log.details}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {(log.previous_values || log.new_values) && (
                              <button
                                type="button"
                                onClick={() => setSelectedAuditLogSnapshot(log)}
                                className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] cursor-pointer"
                              >
                                View Diff
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: VIEW / REOPEN SAVED VOUCHER ================= */}
      {viewVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono font-black text-sm">
                  VOUCHER #{viewVoucher.voucher.voucher_number}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold uppercase text-[10px]">
                  {viewVoucher.voucher.transaction_type}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewVoucher(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Date</span>
                <strong className="text-slate-900">{viewVoucher.voucher.voucher_date}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Category</span>
                <strong className="text-slate-900">{viewVoucher.voucher.category?.replace(/_/g, ' ')}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Amount</span>
                <strong className="text-emerald-700 text-sm font-black">
                  {formatPKR(viewVoucher.voucher.net_amount)}
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase">Status</span>
                <strong className="text-slate-900 uppercase">{viewVoucher.voucher.status}</strong>
              </div>
            </div>

            <div className="space-y-2 border border-slate-200 p-3 rounded-xl">
              <div>
                <span className="font-bold text-slate-600">Account Name:</span>{' '}
                <span className="font-black text-slate-900">
                  {viewVoucher.voucher.head_account_name} ({viewVoucher.voucher.head_account_code})
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-600">Cash / Bank Account:</span>{' '}
                <span className="font-black text-slate-900">
                  {viewVoucher.voucher.cash_bank_account_name} ({viewVoucher.voucher.cash_bank_account_code})
                </span>
              </div>
              {viewVoucher.voucher.narration && (
                <div>
                  <span className="font-bold text-slate-600">Narration:</span>{' '}
                  <span className="text-slate-800">{viewVoucher.voucher.narration}</span>
                </div>
              )}
              {viewVoucher.voucher.reference_number && (
                <div>
                  <span className="font-bold text-slate-600">Reference #:</span>{' '}
                  <span className="font-mono text-slate-800">{viewVoucher.voucher.reference_number}</span>
                </div>
              )}
            </div>

            {/* Double-Entry Journal Lines Breakdown */}
            {viewVoucher.journalLines && viewVoucher.journalLines.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase flex items-center justify-between">
                  <span>Balanced Double-Entry Journal Postings</span>
                  <span className="text-[10px] text-emerald-700 font-mono font-bold">Total Balanced</span>
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-900 text-white">
                      <tr>
                        <th className="p-2">Account</th>
                        <th className="p-2 text-right">Debit (PKR)</th>
                        <th className="p-2 text-right">Credit (PKR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewVoucher.journalLines.map((jl: any) => (
                        <tr key={jl.id} className="border-b border-slate-100">
                          <td className="p-2 font-bold text-slate-800">
                            {jl.account_name} ({jl.account_code})
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-700">
                            {jl.debit_amount > 0 ? formatPKR(jl.debit_amount) : '—'}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-rose-700">
                            {jl.credit_amount > 0 ? formatPKR(jl.credit_amount) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleLoadVoucherToEdit(viewVoucher.voucher)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit This Voucher
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenPrint(viewVoucher.voucher, 'a4')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print A4
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenWhatsApp(viewVoucher.voucher)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  WhatsApp
                </button>
              </div>

              <button
                type="button"
                onClick={() => setViewVoucher(null)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADMIN CONFIRM DELETE VOUCHER ================= */}
      {deleteModalVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-rose-300 shadow-2xl w-full max-w-md p-5 text-xs space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2 text-rose-700 font-black text-sm">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
                Confirm Admin Deletion
              </div>
              <button
                type="button"
                onClick={() => setDeleteModalVoucher(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
              <p className="font-bold text-xs">
                Are you sure you want to delete Voucher #{deleteModalVoucher.voucher_number}?
              </p>
              <div className="font-mono text-[11px] space-y-1 text-rose-800">
                <div>• Date: <strong>{deleteModalVoucher.voucher_date}</strong></div>
                <div>• Type: <strong>{deleteModalVoucher.transaction_type}</strong></div>
                <div>• Account: <strong>{deleteModalVoucher.head_account_name}</strong></div>
                <div>• Amount: <strong>{formatPKR(deleteModalVoucher.net_amount)}</strong></div>
              </div>
              <p className="text-[11px] text-rose-700 font-medium">
                This will reverse all double-entry ledger postings in the General Ledger and log this deletion in the audit trail. Voucher #{deleteModalVoucher.voucher_number} will never be reused in sequence.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDeleteModalVoucher(null)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteVoucher}
                className="px-5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? 'Deleting...' : 'Yes, Delete & Reverse'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: AUDIT LOG DIFF SNAPSHOT ================= */}
      {selectedAuditLogSnapshot && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl p-5 text-xs space-y-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <History className="w-4 h-4 text-amber-500" />
                Audit Snapshot — Voucher #{selectedAuditLogSnapshot.voucher_number} ({selectedAuditLogSnapshot.action})
              </h3>
              <button
                type="button"
                onClick={() => setSelectedAuditLogSnapshot(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[11px] text-slate-500">
              Performed by <strong>{selectedAuditLogSnapshot.performed_by}</strong> ({selectedAuditLogSnapshot.performed_by_role}) on {formatPKTDate(selectedAuditLogSnapshot.created_at)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selectedAuditLogSnapshot.previous_values && (
                <div>
                  <div className="font-bold text-rose-700 mb-1">Previous Values:</div>
                  <pre className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                    {JSON.stringify(JSON.parse(selectedAuditLogSnapshot.previous_values), null, 2)}
                  </pre>
                </div>
              )}
              {selectedAuditLogSnapshot.new_values && (
                <div>
                  <div className="font-bold text-emerald-700 mb-1">New Values:</div>
                  <pre className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                    {JSON.stringify(JSON.parse(selectedAuditLogSnapshot.new_values), null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedAuditLogSnapshot(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: WHATSAPP SHARE ================= */}
      {whatsAppModalVoucher && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Share2 className="w-4 h-4 text-emerald-600" />
                Share Voucher via WhatsApp
              </h3>
              <button
                type="button"
                onClick={() => setWhatsAppModalVoucher(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Recipient WhatsApp Phone Number
              </label>
              <input
                type="text"
                value={whatsAppPhone}
                onChange={(e) => setWhatsAppPhone(e.target.value)}
                placeholder="03001234567"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-sm"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Format: 03001234567 or 923001234567
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 space-y-1">
              <div className="font-bold text-slate-900">Voucher #{whatsAppModalVoucher.voucher_number}</div>
              <div>Date: {whatsAppModalVoucher.voucher_date}</div>
              <div>Account: {whatsAppModalVoucher.head_account_name}</div>
              <div>Amount: {formatPKR(whatsAppModalVoucher.net_amount)}</div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setWhatsAppModalVoucher(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendWhatsApp}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Share2 className="w-3.5 h-3.5" />
                Send on WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden element for print rendering */}
      {printVoucher && (
        <div style={{ display: 'none' }}>
          <div ref={printableElementRef} className="p-6 font-sans text-slate-900">
            {/* Header */}
            <div className="text-center border-b pb-3 mb-4">
              <h2 className="text-xl font-black uppercase tracking-wider">ABRAR MEDICAL STORE</h2>
              <p className="text-xs text-slate-500">Professional Pharmacy, Wholesale & Retail Medicine Center</p>
              <h3 className="text-sm font-bold mt-2 uppercase underline">
                CASH BOOK VOUCHER — #{printVoucher.voucher_number}
              </h3>
            </div>

            {/* Voucher Details Table */}
            <div className="grid grid-cols-2 gap-4 text-xs mb-4">
              <div>
                <strong>Date:</strong> {formatPKTDate(printVoucher.voucher_date)}
              </div>
              <div className="text-right">
                <strong>Type:</strong> {printVoucher.transaction_type} ({printVoucher.category?.replace(/_/g, ' ')})
              </div>
              <div>
                <strong>Account:</strong> {printVoucher.head_account_name} ({printVoucher.head_account_code})
              </div>
              <div className="text-right">
                <strong>Cash/Bank Account:</strong> {printVoucher.cash_bank_account_name}
              </div>
            </div>

            <div className="border border-slate-400 p-3 mb-4 rounded text-xs space-y-2">
              <div className="flex justify-between items-center text-sm font-bold">
                <span>Amount:</span>
                <span className="font-mono text-base">{formatPKR(printVoucher.net_amount)}</span>
              </div>
              {printVoucher.narration && (
                <div>
                  <strong>Narration:</strong> {printVoucher.narration}
                </div>
              )}
              {printVoucher.reference_number && (
                <div>
                  <strong>Reference #:</strong> {printVoucher.reference_number}
                </div>
              )}
            </div>

            {/* Signatures */}
            <div className="flex justify-between text-xs pt-12 mt-8 border-t border-slate-300">
              <div className="text-center">
                <div className="border-t border-slate-500 w-32 mx-auto pt-1">Prepared By</div>
              </div>
              <div className="text-center">
                <div className="border-t border-slate-500 w-32 mx-auto pt-1">Receiver Signature</div>
              </div>
              <div className="text-center">
                <div className="border-t border-slate-500 w-32 mx-auto pt-1">Authorized Signature</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
