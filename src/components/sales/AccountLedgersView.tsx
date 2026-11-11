import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { BookOpen, Download, Printer } from 'lucide-react';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';

interface AccountLedgersViewProps {
  ledgerType: 'customer' | 'supplier' | 'cash' | 'bank' | 'general' | 'statement';
}

export const AccountLedgersView: React.FC<AccountLedgersViewProps> = ({ ledgerType }) => {
  const [accounts, setAccounts] = useState<Array<Record<string, any>>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedAccount, setSelectedAccount] = useState<Record<string, any> | null>(null);
  const [summary, setSummary] = useState<Record<string, any>>({});
  const [entries, setEntries] = useState<Array<Record<string, any>>>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const statementPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedAccountId('');
  }, [ledgerType]);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getAccountLedger({
        ledgerType,
        accountId: selectedAccountId || undefined,
        startDate,
        endDate,
      });
      setAccounts(res.accounts || []);
      setSelectedAccount(res.selectedAccount || null);
      if (res.selectedAccount && !selectedAccountId) {
        setSelectedAccountId(String(res.selectedAccount.id));
      }
      setSummary(res.summary || {});
      setEntries(res.entries || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [ledgerType, selectedAccountId, startDate, endDate]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const handleExportExcel = () => {
    const rows = entries.map((e) => ({
      Date: e.entry_date,
      'Journal Entry #': e.entry_number,
      Source: e.source_type,
      Account: e.account_name || selectedAccount?.account_name || '',
      Narration: e.narration || e.entry_description,
      'Debit (PKR)': Number(e.debit_amount || 0),
      'Credit (PKR)': Number(e.credit_amount || 0),
      'Running Balance (PKR)': Number(e.running_balance || 0),
      'Dr/Cr': e.running_balance_type || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Account Ledger');
    XLSX.writeFile(wb, `AMS_${ledgerType}_ledger_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Filter Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-end justify-between gap-3 text-xs print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Select Account ({ledgerType.toUpperCase()})
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="min-w-[260px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-900"
            >
              {ledgerType === 'general' && (
                <option value="">-- All Accounts (General Ledger) --</option>
              )}
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.account_name} ({acc.account_code}) — {formatPKR(acc.current_balance)}{' '}
                  {acc.current_balance_type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedAccount && (ledgerType === 'customer' || ledgerType === 'statement') && (
            <WhatsAppSendButton
              label={ledgerType === 'statement' ? 'WhatsApp Statement' : 'WhatsApp Ledger'}
              payload={{
                documentType: ledgerType === 'statement' ? 'statement' : 'ledger',
                documentNumber: `${ledgerType.toUpperCase()}-${selectedAccount.account_code || selectedAccount.id}`,
                documentDate: endDate || new Date().toISOString().slice(0, 10),
                customerAccountId: Number(selectedAccount.id),
                customerName: String(selectedAccount.account_name || 'Customer'),
                customerPhone: String(selectedAccount.phone || ''),
                totalAmount: Number(summary.totalDebit || 0),
                paidAmount: Number(summary.totalCredit || 0),
                remainingBalance: Number(summary.closingBalance || 0),
                balanceType: String(summary.closingBalanceType || 'Debit'),
              }}
              onPhoneSaved={(newPhone) => {
                setSelectedAccount((prev) => (prev ? { ...prev, phone: newPhone } : prev));
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (statementPrintRef.current) {
                printReportDocument(
                  statementPrintRef.current,
                  `Abrar Medical Store - ${ledgerType.toUpperCase()} Statement - ${selectedAccount?.account_name || 'Account'}`
                );
              } else {
                window.print();
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Statement
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Printable Statement Area */}
      <div ref={statementPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={`${ledgerType.toUpperCase()} STATEMENT OF ACCOUNT`}
          subtitle={`Account: ${selectedAccount ? `${selectedAccount.account_name} (${selectedAccount.account_code})` : 'All Accounts'}`}
          metaItems={[
            { label: 'Account Name', value: selectedAccount?.account_name || 'Consolidated Statement' },
            { label: 'Account Group', value: selectedAccount?.account_group || ledgerType },
            { label: 'Date Range', value: `${startDate || 'Start'} to ${endDate || 'Current'}` },
            {
              label: 'Closing Balance',
              value: `${formatPKR(summary.closingBalance || 0)} (${summary.closingBalanceType || 'Debit'})`,
            },
          ]}
        />

        {/* Balance KPI Summary */}
        <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Opening Balance</div>
          <div className="text-base font-black font-mono text-slate-900 mt-0.5">
            {formatPKR(summary.openingBalance || 0)} ({summary.openingBalanceType || 'Debit'})
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Debit (PKR)</div>
          <div className="text-base font-black font-mono text-emerald-700 mt-0.5">
            {formatPKR(summary.totalDebit || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Credit (PKR)</div>
          <div className="text-base font-black font-mono text-teal-700 mt-0.5">
            {formatPKR(summary.totalCredit || 0)}
          </div>
        </div>
        <div className="bg-slate-900 text-white rounded-xl p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-emerald-400">Closing Balance</div>
          <div className="text-base font-black font-mono mt-0.5">
            {formatPKR(summary.closingBalance || 0)} ({summary.closingBalanceType || 'Debit'})
          </div>
        </div>
      </div>

      {/* Ledger Entries Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            <span>
              {selectedAccount
                ? `${selectedAccount.account_name} (${selectedAccount.account_code}) — ${selectedAccount.account_group}`
                : 'General Double-Entry Ledger'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">{entries.length} Entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-900 text-white uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Voucher / Entry #</th>
                <th className="px-3 py-2.5">Source</th>
                {!selectedAccount && <th className="px-3 py-2.5">Account</th>}
                <th className="px-3 py-2.5">Particulars / Narration</th>
                <th className="px-3 py-2.5 text-right">Debit (PKR)</th>
                <th className="px-3 py-2.5 text-right">Credit (PKR)</th>
                {selectedAccount && <th className="px-3 py-2.5 text-right">Running Balance</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    Loading Ledger Statement...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    No posted ledger entries found for the selected period.
                  </td>
                </tr>
              ) : (
                entries.map((row) => (
                  <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">{row.entry_date}</td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">
                      {row.entry_number}
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                        {row.source_type}
                      </span>
                    </td>
                    {!selectedAccount && (
                      <td className="px-3 py-2 font-bold">
                        {row.account_name} ({row.account_code})
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-700">
                      {row.narration || row.entry_description}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">
                      {Number(row.debit_amount || 0) > 0 ? formatPKR(row.debit_amount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-teal-700">
                      {Number(row.credit_amount || 0) > 0 ? formatPKR(row.credit_amount) : '—'}
                    </td>
                    {selectedAccount && (
                      <td className="px-3 py-2 text-right font-mono font-black text-slate-900">
                        {formatPKR(row.running_balance)} {row.running_balance_type}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
};
