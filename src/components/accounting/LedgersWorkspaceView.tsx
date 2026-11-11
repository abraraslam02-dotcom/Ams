import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { api } from '../../services/api';
import { DetailedAccountLedger } from '../../types/accounting';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';

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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<DetailedAccountLedger | null>(null);
  const [dailyCashSummary, setDailyCashSummary] = useState<any[]>([]);
  const printableAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialAccountId) {
      setSelectedAccountId(String(initialAccountId));
    }
  }, [initialAccountId]);

  const loadLedgerData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        accountId: selectedAccountId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        q: txSearch || undefined,
      };

      if (activeTab === 'customer') {
        const res = await api.getCustomerLedger(params);
        setAccountOptions(res.customers || []);
        setLedger(res.ledger || null);
        if (!selectedAccountId && res.ledger?.account?.id) {
          setSelectedAccountId(String(res.ledger.account.id));
        }
      } else if (activeTab === 'supplier') {
        const res = await api.getSupplierLedger(params);
        setAccountOptions(res.suppliers || []);
        setLedger(res.ledger || null);
        if (!selectedAccountId && res.ledger?.account?.id) {
          setSelectedAccountId(String(res.ledger.account.id));
        }
      } else if (activeTab === 'general') {
        const res = await api.getGeneralLedger(params);
        setAccountOptions(res.accounts || []);
        setLedger(res.ledger || null);
        if (!selectedAccountId && res.ledger?.account?.id) {
          setSelectedAccountId(String(res.ledger.account.id));
        }
      } else if (activeTab === 'cash-book') {
        const res = await api.getCashBook(params);
        setAccountOptions(res.cashAccounts || []);
        setLedger(res.ledger || null);
        setDailyCashSummary(res.dailySummary || []);
        if (!selectedAccountId && res.ledger?.account?.id) {
          setSelectedAccountId(String(res.ledger.account.id));
        }
      } else if (activeTab === 'bank-book') {
        const res = await api.getBankBook(params);
        setAccountOptions(res.bankAccounts || []);
        setLedger(res.ledger || null);
        if (!selectedAccountId && res.ledger?.account?.id) {
          setSelectedAccountId(String(res.ledger.account.id));
        }
      }
    } catch (err) {
      console.error('Error loading ledger:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedAccountId, startDate, endDate, txSearch]);

  useEffect(() => {
    loadLedgerData();
  }, [loadLedgerData]);

  const handleTabSwitch = (tab: LedgerWorkspaceTab) => {
    setActiveTab(tab);
    setSelectedAccountId('');
    setAccountFilterSearch('');
  };

  const filteredAccountOptions = accountOptions.filter((a) => {
    if (!accountFilterSearch.trim()) return true;
    const term = accountFilterSearch.toLowerCase();
    return (
      String(a.account_code || '').toLowerCase().includes(term) ||
      String(a.account_name || '').toLowerCase().includes(term)
    );
  });

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
        `"${startDate || 'OPENING'}"`,
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
          `"${e.entry_date}"`,
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
        <div>
          <label className="block font-semibold text-slate-600 mb-0.5">
            Fast Search Account / Code
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={accountFilterSearch}
              onChange={(e) => setAccountFilterSearch(e.target.value)}
              placeholder="Filter name or code..."
              className="w-full pl-8 pr-2 py-1.5 border border-slate-300 rounded"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block font-semibold text-slate-600 mb-0.5">
            Select {activeTab === 'customer' ? 'Customer' : activeTab === 'supplier' ? 'Supplier' : 'Account'} ({filteredAccountOptions.length})
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-semibold text-slate-900 bg-white"
          >
            {filteredAccountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_code} — {a.account_name} (Bal: Rs.{' '}
                {Number(a.current_balance || 0).toLocaleString('en-PK', {
                  minimumFractionDigits: 2,
                })}{' '}
                {a.current_balance_type === 'Debit' ? 'Dr' : 'Cr'})
              </option>
            ))}
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
            { label: 'Statement Period', value: `${startDate || 'Opening'} to ${endDate || 'Current'}` },
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
                    {loading ? 'Loading Ledger Statement...' : 'Select an account to view its ledger.'}
                  </td>
                </tr>
              ) : (
                <>
                  {/* Opening Balance Row */}
                  <tr className="bg-amber-50/60 border-b border-slate-200 font-semibold">
                    <td className="px-3 py-2 font-mono text-slate-700">
                      {startDate || 'OPENING'}
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
                        {row.entry_date}
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
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-900">{d.date}</td>
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
    </div>
  );
};
