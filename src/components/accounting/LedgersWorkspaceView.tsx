import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BookOpen,
  Search,
  RefreshCw,
  Printer,
  Download,
  Users,
  Truck,
  Wallet,
  Landmark,
  FileText,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { DetailedAccountLedger } from '../../types/accounting';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import { ReportZoomWrapper } from '../common/PreviewZoomControls';
import { formatAppDate, formatDateRange } from '../../utils/formatters';

export type LedgerWorkspaceTab =
  | 'customer'
  | 'supplier'
  | 'general'
  | 'cash-book'
  | 'bank-book';

interface LedgersWorkspaceViewProps {
  initialTab?: LedgerWorkspaceTab;
  initialAccountId?: number | null;
}

export const LedgersWorkspaceView: React.FC<LedgersWorkspaceViewProps> = ({
  initialTab = 'customer',
  initialAccountId = null,
}) => {
  const [activeTab, setActiveTab] = useState<LedgerWorkspaceTab>(initialTab);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    initialAccountId ? String(initialAccountId) : ''
  );
  const [accountOptions, setAccountOptions] = useState<any[]>([]);
  const [accountFilterSearch, setAccountFilterSearch] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [highlightedAccountIdx, setHighlightedAccountIdx] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<DetailedAccountLedger | null>(null);
  const [dailyCashSummary, setDailyCashSummary] = useState<any[]>([]);
  const printableAreaRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const ledgerRequestIdRef = useRef<number>(0);
  const accountOptionsLoadedTabRef = useRef<string>('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialAccountId) {
      setSelectedAccountId(String(initialAccountId));
      setAccountFilterSearch('');
    }
  }, [initialAccountId]);

  useEffect(() => {
    const onOutsideClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const filterAccountsList = useCallback((list: any[], rawTerm: string) => {
    const term = rawTerm.trim().toLowerCase();
    if (!term) return list;
    const tokens = term.split(/\s+/).filter(Boolean);
    const matched = list.filter((a) => {
      const hay = `${a.account_code || ''} ${a.account_name || ''} ${a.phone || ''} ${a.city || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    // Rank exact code/name match first, then prefix match, then contains
    return matched.sort((a, b) => {
      const aCode = String(a.account_code || '').toLowerCase();
      const bCode = String(b.account_code || '').toLowerCase();
      const aName = String(a.account_name || '').toLowerCase();
      const bName = String(b.account_name || '').toLowerCase();
      const aExact = aCode === term || aName === term ? 0 : aName.startsWith(term) || aCode.startsWith(term) ? 1 : 2;
      const bExact = bCode === term || bName === term ? 0 : bName.startsWith(term) || bCode.startsWith(term) ? 1 : 2;
      if (aExact !== bExact) return aExact - bExact;
      return aName.localeCompare(bName);
    });
  }, []);

  const filteredAccountOptions = useMemo(
    () => filterAccountsList(accountOptions, accountFilterSearch),
    [accountOptions, accountFilterSearch, filterAccountsList]
  );

  const hasSearchNoMatch =
    accountFilterSearch.trim().length > 0 &&
    accountOptions.length > 0 &&
    filteredAccountOptions.length === 0;

  const loadLedgerData = useCallback(async () => {
    const requestId = ++ledgerRequestIdRef.current;

    // If user typed a search query that matches zero accounts, never fall back to a stale or default account
    if (hasSearchNoMatch) {
      setLedger(null);
      setDailyCashSummary([]);
      setLoading(false);
      return;
    }

    // Immediately clear stale ledger if switching to a different account ID
    setLedger((prev) => {
      if (!prev) return null;
      if (selectedAccountId && String(prev.account?.id) !== String(selectedAccountId)) {
        return null;
      }
      if (!selectedAccountId && accountOptionsLoadedTabRef.current !== activeTab) {
        return null;
      }
      return prev;
    });
    setLoading(true);

    try {
      const params = {
        accountId: selectedAccountId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        q: txSearch || undefined,
      };

      let res: any = null;
      let optionsList: any[] = [];

      if (activeTab === 'customer') {
        res = await api.getCustomerLedger(params);
        optionsList = res?.customers || [];
      } else if (activeTab === 'supplier') {
        res = await api.getSupplierLedger(params);
        optionsList = res?.suppliers || [];
      } else if (activeTab === 'general') {
        res = await api.getGeneralLedger(params);
        optionsList = res?.accounts || [];
      } else if (activeTab === 'cash-book') {
        res = await api.getCashBook(params);
        optionsList = res?.cashAccounts || [];
      } else if (activeTab === 'bank-book') {
        res = await api.getBankBook(params);
        optionsList = res?.bankAccounts || [];
      }

      // Discard stale out-of-order async responses
      if (requestId !== ledgerRequestIdRef.current) return;

      accountOptionsLoadedTabRef.current = activeTab;
      setAccountOptions(optionsList);
      setLedger(res?.ledger || null);
      if (activeTab === 'cash-book') {
        setDailyCashSummary(res?.dailySummary || []);
      } else {
        setDailyCashSummary([]);
      }
      if (!selectedAccountId && res?.ledger?.account?.id) {
        setSelectedAccountId(String(res.ledger.account.id));
      }
    } catch (err) {
      if (requestId !== ledgerRequestIdRef.current) return;
      console.error('Error loading ledger:', err);
      setLedger(null);
    } finally {
      if (requestId === ledgerRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [activeTab, selectedAccountId, startDate, endDate, txSearch, hasSearchNoMatch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLedgerData();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loadLedgerData]);

  const handleTabSwitch = (tab: LedgerWorkspaceTab) => {
    ledgerRequestIdRef.current += 1;
    setActiveTab(tab);
    setSelectedAccountId('');
    setAccountFilterSearch('');
    setSearchDropdownOpen(false);
    setHighlightedAccountIdx(0);
    setLedger(null);
    setDailyCashSummary([]);
  };

  const handleSelectAccountById = (accountIdStr: string) => {
    if (accountIdStr !== selectedAccountId) {
      setLedger(null);
      setDailyCashSummary([]);
      setSelectedAccountId(accountIdStr);
    }
  };

  const handleAccountSearchChange = (value: string) => {
    setAccountFilterSearch(value);
    setSearchDropdownOpen(true);
    setHighlightedAccountIdx(0);

    const matches = filterAccountsList(accountOptions, value);
    if (matches.length > 0) {
      const nextId = String(matches[0].id);
      if (nextId !== selectedAccountId) {
        setLedger(null);
        setDailyCashSummary([]);
        setSelectedAccountId(nextId);
      }
    } else if (value.trim().length > 0) {
      // Clear previous account ledger immediately when no account matches
      setLedger(null);
      setDailyCashSummary([]);
      setSelectedAccountId('');
    }
  };

  const handleExportCSV = () => {
    if (!ledger) return;
    const headers = [
      'Date',
      'Invoice / Voucher No',
      'Type',
      'Description / Narration',
      'Debit (PKR)',
      'Credit (PKR)',
      'Running Balance (PKR)',
      'Dr/Cr',
    ];
    const rows = [
      headers.join(','),
      [
        `"${startDate ? formatAppDate(startDate) : 'OPENING'}"`,
        '"OPEN-BAL"',
        '"OPENING"',
        '"Opening Balance Brought Forward (B/F)"',
        ledger.openingBalanceType === 'Debit' ? ledger.openingBalance.toFixed(2) : '0.00',
        ledger.openingBalanceType === 'Credit' ? ledger.openingBalance.toFixed(2) : '0.00',
        ledger.openingBalance.toFixed(2),
        ledger.openingBalanceType === 'Debit' ? 'Dr' : 'Cr',
      ].join(','),
      ...ledger.entries.map((e) =>
        [
          `"${formatAppDate(e.entry_date)}"`,
          `"${e.document_number}"`,
          `"${e.reference_type}"`,
          `"${String(e.description || '').replace(/"/g, '""')}"`,
          Number(e.debit_amount || 0).toFixed(2),
          Number(e.credit_amount || 0).toFixed(2),
          Number(e.running_balance || 0).toFixed(2),
          e.running_balance_type === 'Debit' ? 'Dr' : 'Cr',
        ].join(',')
      ),
    ];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abrar_Medical_${activeTab.toUpperCase()}_Ledger_${
      ledger.account.account_code
    }_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Top Navigation & Ledger Mode Selector */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleTabSwitch('customer')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'customer'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Customer Ledger
          </button>

          <button
            type="button"
            onClick={() => handleTabSwitch('supplier')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'supplier'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Supplier Ledger
          </button>

          <button
            type="button"
            onClick={() => handleTabSwitch('general')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'general'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            General Ledger (GL)
          </button>

          <button
            type="button"
            onClick={() => handleTabSwitch('cash-book')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'cash-book'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            Cash Book
          </button>

          <button
            type="button"
            onClick={() => handleTabSwitch('bank-book')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors ${
              activeTab === 'bank-book'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            Bank Book
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'customer' && ledger?.account && (
            <WhatsAppSendButton
              label="Send Ledger via WhatsApp"
              payload={{
                documentType: 'ledger',
                documentNumber: `LEDGER-${ledger.account.account_code || ledger.account.id}`,
                documentDate: endDate || new Date().toISOString().slice(0, 10),
                customerAccountId: Number(ledger.account.id),
                customerName: String(ledger.account.account_name || 'Customer'),
                customerPhone: String(ledger.account.phone || ''),
                totalAmount: Number(ledger.totalDebit || 0),
                paidAmount: Number(ledger.totalCredit || 0),
                remainingBalance: Number(ledger.closingBalance || 0),
                balanceType: String(ledger.closingBalanceType || 'Debit'),
              }}
              onPhoneSaved={(newPhone) => {
                setLedger((prev) =>
                  prev ? { ...prev, account: { ...prev.account, phone: newPhone } } : prev
                );
              }}
            />
          )}
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel/CSV
          </button>
          <button
            type="button"
            onClick={() => {
              if (printableAreaRef.current) {
                printReportDocument(
                  printableAreaRef.current,
                  `Abrar Medical Store - ${activeTab.toUpperCase()} Ledger - ${ledger?.account.account_name || 'Statement'}`
                );
              } else {
                window.print();
              }
            }}
            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Statement
          </button>
        </div>
      </div>

      {/* Account Selection & Date Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-6 gap-2.5 text-xs shadow-xs print:hidden">
        <div ref={searchBoxRef} className="relative">
          <label className="block font-semibold text-slate-600 mb-0.5">
            Fast Search Account / Code
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={accountFilterSearch}
              onFocus={() => setSearchDropdownOpen(true)}
              onChange={(e) => handleAccountSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSearchDropdownOpen(true);
                  const nextIdx = Math.min(
                    Math.max(filteredAccountOptions.length - 1, 0),
                    highlightedAccountIdx + 1
                  );
                  setHighlightedAccountIdx(nextIdx);
                  const opt = filteredAccountOptions[nextIdx];
                  if (opt) handleSelectAccountById(String(opt.id));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSearchDropdownOpen(true);
                  const prevIdx = Math.max(0, highlightedAccountIdx - 1);
                  setHighlightedAccountIdx(prevIdx);
                  const opt = filteredAccountOptions[prevIdx];
                  if (opt) handleSelectAccountById(String(opt.id));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt =
                    filteredAccountOptions[highlightedAccountIdx] || filteredAccountOptions[0];
                  if (opt) {
                    handleSelectAccountById(String(opt.id));
                  }
                  setSearchDropdownOpen(false);
                } else if (e.key === 'Escape') {
                  setSearchDropdownOpen(false);
                }
              }}
              placeholder="Type name or code to load..."
              className="w-full pl-8 pr-7 py-1.5 border border-slate-300 rounded focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none"
            />
            {accountFilterSearch && (
              <button
                type="button"
                onClick={() => {
                  handleAccountSearchChange('');
                  setSearchDropdownOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchDropdownOpen && accountFilterSearch.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-slate-300 rounded-lg shadow-xl max-h-60 overflow-y-auto">
              {filteredAccountOptions.length === 0 ? (
                <div className="px-3 py-2 text-slate-500 text-[11px]">
                  No matching account found.
                </div>
              ) : (
                filteredAccountOptions.slice(0, 40).map((a, idx) => {
                  const isSelected = String(a.id) === String(selectedAccountId);
                  const isHighlighted = idx === highlightedAccountIdx;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectAccountById(String(a.id));
                        setAccountFilterSearch(a.account_name || '');
                        setSearchDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-50 text-emerald-900 font-bold'
                          : isHighlighted
                          ? 'bg-slate-100 text-slate-900'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-mono text-[10px] text-slate-500 mr-1">
                          [{a.account_code}]
                        </span>
                        {a.account_name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-600 shrink-0">
                        Rs. {Number(a.current_balance || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 })}{' '}
                        {a.current_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block font-semibold text-slate-600 mb-0.5">
            Select {activeTab === 'customer' ? 'Customer' : activeTab === 'supplier' ? 'Supplier' : 'Account'} ({filteredAccountOptions.length})
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => handleSelectAccountById(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-semibold text-slate-900 bg-white"
          >
            {filteredAccountOptions.length === 0 ? (
              <option value="">No matching accounts</option>
            ) : (
              filteredAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} — {a.account_name} (Bal: Rs.{' '}
                  {Number(a.current_balance || 0).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  {a.current_balance_type === 'Debit' ? 'Dr' : 'Cr'})
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="block font-semibold text-slate-600 mb-0.5">From Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-600 mb-0.5">To Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-600 mb-0.5">
            Search Invoice / Narration
          </label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Invoice / Voucher..."
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
            />
            <button
              type="button"
              onClick={loadLedgerData}
              className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
              title="Refresh Ledger"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Printable Ledger Area */}
      <ReportZoomWrapper label="Ledger Statement Preview Zoom">
      <div ref={printableAreaRef} className="space-y-3">
        <PrintDocumentHeader
          title={
            activeTab === 'customer'
              ? 'CUSTOMER RECEIVABLE LEDGER STATEMENT'
              : activeTab === 'supplier'
              ? 'SUPPLIER PAYABLE LEDGER STATEMENT'
              : activeTab === 'cash-book'
              ? 'CASH BOOK STATEMENT (DAILY CASH REGISTER)'
              : activeTab === 'bank-book'
              ? 'BANK BOOK STATEMENT (ACCOUNT MOVEMENT)'
              : 'GENERAL ACCOUNT LEDGER STATEMENT'
          }
          subtitle={`Account: ${ledger?.account.account_code || ''} — ${ledger?.account.account_name || 'Selected Account'}`}
          metaItems={[
            { label: 'Account Code', value: ledger?.account.account_code || '-' },
            { label: 'Account Group', value: ledger?.account.account_group || '-' },
            { label: 'Statement Period', value: formatDateRange(startDate, endDate, 'Opening', 'Current') },
            {
              label: 'Closing Balance',
              value: ledger
                ? `Rs. ${ledger.closingBalance.toLocaleString('en-PK', { minimumFractionDigits: 2 })} (${ledger.closingBalanceType === 'Debit' ? 'Dr' : 'Cr'})`
                : '-',
            },
          ]}
        />

        {/* Summary Strip */}
      {ledger && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="bg-white border border-slate-200 rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-slate-500">Opening Balance</div>
            <div className="text-xs font-extrabold font-mono text-slate-900 mt-0.5">
              Rs. {ledger.openingBalance.toLocaleString('en-PK', { minimumFractionDigits: 2 })}{' '}
              <span className="text-[10px]">{ledger.openingBalanceType === 'Debit' ? 'Dr' : 'Cr'}</span>
            </div>
          </div>

          {activeTab === 'customer' && (
            <>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-emerald-700">Total Sales (+)</div>
                <div className="text-xs font-extrabold font-mono text-emerald-800 mt-0.5">
                  Rs. {ledger.breakdown.salesAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-amber-700">Sales Returns (-)</div>
                <div className="text-xs font-extrabold font-mono text-amber-800 mt-0.5">
                  Rs. {ledger.breakdown.salesReturnsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-sky-700">Customer Receipts (-)</div>
                <div className="text-xs font-extrabold font-mono text-sky-800 mt-0.5">
                  Rs. {ledger.breakdown.customerReceiptsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-600">Adjustments</div>
                <div className="text-xs font-extrabold font-mono text-slate-800 mt-0.5">
                  Rs. {ledger.breakdown.adjustmentsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'supplier' && (
            <>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-indigo-700">Total Purchases (+)</div>
                <div className="text-xs font-extrabold font-mono text-indigo-800 mt-0.5">
                  Rs. {ledger.breakdown.purchasesAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-amber-700">Purchase Returns (-)</div>
                <div className="text-xs font-extrabold font-mono text-amber-800 mt-0.5">
                  Rs. {ledger.breakdown.purchaseReturnsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-emerald-700">Supplier Payments (-)</div>
                <div className="text-xs font-extrabold font-mono text-emerald-800 mt-0.5">
                  Rs. {ledger.breakdown.supplierPaymentsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-600">Adjustments</div>
                <div className="text-xs font-extrabold font-mono text-slate-800 mt-0.5">
                  Rs. {ledger.breakdown.adjustmentsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </>
          )}

          {(activeTab === 'general' || activeTab === 'cash-book' || activeTab === 'bank-book') && (
            <>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-emerald-700">
                  {activeTab === 'cash-book'
                    ? 'Total Cash Receipts (Dr)'
                    : activeTab === 'bank-book'
                    ? 'Total Bank Deposits / Receipts (Dr)'
                    : 'Period Total Debit (Dr)'}
                </div>
                <div className="text-xs font-extrabold font-mono text-emerald-800 mt-0.5">
                  Rs. {ledger.totalDebit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-rose-700">
                  {activeTab === 'cash-book'
                    ? 'Total Cash Payments (Cr)'
                    : activeTab === 'bank-book'
                    ? 'Total Bank Withdrawals / Payments (Cr)'
                    : 'Period Total Credit (Cr)'}
                </div>
                <div className="text-xs font-extrabold font-mono text-rose-800 mt-0.5">
                  Rs. {ledger.totalCredit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-600">Transactions</div>
                <div className="text-xs font-extrabold font-mono text-slate-800 mt-0.5">
                  {ledger.entries.length} Entries
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-600">Account Group</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5 truncate">
                  {ledger.account.account_group}
                </div>
              </div>
            </>
          )}

          <div className="bg-slate-900 text-white rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-emerald-300">Closing Balance</div>
            <div className="text-xs font-extrabold font-mono mt-0.5">
              Rs. {ledger.closingBalance.toLocaleString('en-PK', { minimumFractionDigits: 2 })}{' '}
              <span className="text-emerald-300">
                {ledger.closingBalanceType === 'Debit' ? 'Dr' : 'Cr'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Datasheet Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {ledger && (
          <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-700" />
              <span className="font-mono font-bold text-slate-900">
                {ledger.account.account_code}
              </span>
              <span className="font-bold text-slate-900">— {ledger.account.account_name}</span>
              {ledger.account.filer_status && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-slate-300">
                  {ledger.account.filer_status}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-600 font-mono">
              Showing {ledger.entries.length} chronological entries
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] uppercase">
                <th className="px-3 py-2 w-28">Date</th>
                <th className="px-3 py-2 w-40">
                  {activeTab === 'customer'
                    ? 'Invoice / Voucher No'
                    : activeTab === 'supplier'
                    ? 'Purchase Bill / Voucher'
                    : 'Voucher / Entry No'}
                </th>
                <th className="px-3 py-2 w-28">Ref Type</th>
                <th className="px-3 py-2">Description / Narration</th>
                <th className="px-3 py-2 w-36 text-right">Debit (PKR)</th>
                <th className="px-3 py-2 w-36 text-right">Credit (PKR)</th>
                <th className="px-3 py-2 w-44 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {!ledger ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {loading
                      ? 'Loading Ledger Statement...'
                      : hasSearchNoMatch
                      ? `No matching account found for "${accountFilterSearch.trim()}".`
                      : 'Select an account to view its ledger.'}
                  </td>
                </tr>
              ) : (
                <>
                  {/* Opening Balance Row */}
                  <tr className="bg-amber-50/60 border-b border-slate-200 font-semibold">
                    <td className="px-3 py-2 font-mono text-slate-700">
                      {startDate ? formatAppDate(startDate) : 'OPENING'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">OPEN-BAL</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-mono">
                        B/F
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      Opening Balance Brought Forward
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">
                      {ledger.openingBalanceType === 'Debit'
                        ? ledger.openingBalance.toLocaleString('en-PK', {
                            minimumFractionDigits: 2,
                          })
                        : '0.00'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-rose-700">
                      {ledger.openingBalanceType === 'Credit'
                        ? ledger.openingBalance.toLocaleString('en-PK', {
                            minimumFractionDigits: 2,
                          })
                        : '0.00'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                      Rs.{' '}
                      {ledger.openingBalance.toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      {ledger.openingBalanceType === 'Debit' ? 'Dr' : 'Cr'}
                    </td>
                  </tr>

                  {ledger.entries.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-200/80 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-1.5 font-mono text-slate-700 whitespace-nowrap">
                        {formatAppDate(row.entry_date)}
                      </td>
                      <td className="px-3 py-1.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {row.document_number}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 font-mono">
                          {row.reference_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-800">{row.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium text-emerald-700">
                        {row.debit_amount > 0
                          ? row.debit_amount.toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium text-rose-700">
                        {row.credit_amount > 0
                          ? row.credit_amount.toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-900">
                        Rs.{' '}
                        {row.running_balance.toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        <span
                          className={
                            row.running_balance_type === 'Debit'
                              ? 'text-emerald-700'
                              : 'text-indigo-700'
                          }
                        >
                          {row.running_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {ledger && (
              <tfoot>
                <tr className="bg-slate-900 text-white font-bold text-xs">
                  <td colSpan={4} className="px-3 py-2 text-right uppercase">
                    Closing Balance Carried Forward (C/F):
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">
                    Rs. {ledger.totalDebit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rose-300">
                    Rs. {ledger.totalCredit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">
                    Rs.{' '}
                    {ledger.closingBalance.toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    {ledger.closingBalanceType === 'Debit' ? 'Dr' : 'Cr'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Daily Cash Balance Table (Cash Book Exclusive) */}
      {activeTab === 'cash-book' && dailyCashSummary.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
            <span>Daily Cash Balance Summary (Day-by-Day Cash Drawer Reconciliation)</span>
            <span className="font-mono text-[11px] text-emerald-300">
              {dailyCashSummary.length} Active Cash Days
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase text-slate-700">
                  <th className="px-3 py-1.5">Date</th>
                  <th className="px-3 py-1.5 text-center">Transactions</th>
                  <th className="px-3 py-1.5 text-right">Opening Cash</th>
                  <th className="px-3 py-1.5 text-right">Cash Receipts (+)</th>
                  <th className="px-3 py-1.5 text-right">Cash Payments (-)</th>
                  <th className="px-3 py-1.5 text-right">Daily Closing Cash</th>
                </tr>
              </thead>
              <tbody>
                {dailyCashSummary.map((d) => (
                  <tr key={d.date} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-900">
                      {formatAppDate(d.date)}
                    </td>
                    <td className="px-3 py-1.5 text-center font-mono">{d.txCount}</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      Rs. {Number(d.openingCash).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-700 font-semibold">
                      Rs. {Number(d.cashReceipts).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-rose-700 font-semibold">
                      Rs. {Number(d.cashPayments).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-900">
                      Rs. {Number(d.closingCash).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
      </ReportZoomWrapper>
    </div>
  );
};
