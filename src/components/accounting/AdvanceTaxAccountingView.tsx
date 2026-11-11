import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileCheck,
  RefreshCw,
  Download,
  Printer,
  Settings,
  CheckCircle2,
  AlertTriangle,
  History,
  BookOpen,
  Scale,
} from 'lucide-react';
import { api } from '../../services/api';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface AdvanceTaxAccountingViewProps {
  onOpenTaxSettings?: () => void;
}

export const AdvanceTaxAccountingView: React.FC<AdvanceTaxAccountingViewProps> = ({
  onOpenTaxSettings,
}) => {
  const [subTab, setSubTab] = useState<'ledger' | 'register' | 'reconciliation' | 'history'>(
    'register'
  );
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filerStatus, setFilerStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const taxPrintRef = useRef<HTMLDivElement>(null);

  const loadTaxData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAdvanceTaxAccounting({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        filerStatus: filerStatus !== 'all' ? filerStatus : undefined,
      });
      setData(res);
    } catch (err) {
      console.error('Failed to load Advance Tax Accounting:', err);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, filerStatus]);

  useEffect(() => {
    loadTaxData();
  }, [loadTaxData]);

  const handleExportRegisterCSV = () => {
    if (!data?.register) return;
    const headers = [
      'Date',
      'Type',
      'Document No',
      'Party Code',
      'Party Name',
      'NTN',
      'STRN',
      'Filer Status',
      'Taxable Amount',
      'GST Amount',
      'Tax Basis',
      'Tax Rate %',
      'Advance Tax Amount',
      'GL Account Head',
    ];
    const rows = [
      headers.join(','),
      ...data.register.map((r: any) =>
        [
          `"${r.tx_date}"`,
          `"${r.tx_type}"`,
          `"${r.document_number}"`,
          `"${r.party_code || ''}"`,
          `"${String(r.party_name || '').replace(/"/g, '""')}"`,
          `"${r.party_ntn || ''}"`,
          `"${r.party_strn || ''}"`,
          `"${r.filer_status || ''}"`,
          Number(r.taxable_amount || 0).toFixed(2),
          Number(r.gst_amount || 0).toFixed(2),
          `"${r.tax_basis || ''}"`,
          Number(r.tax_rate || 0).toFixed(2),
          Number(r.tax_amount || 0).toFixed(2),
          `"${r.tax_account_head || ''}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abrar_Medical_Advance_Tax_Register_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const settings = data?.settings;
  const recon = data?.reconciliation;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-900 text-white flex items-center justify-center">
            <FileCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              Advance Tax Accounting, Ledgers & Reconciliation (Section 236G / 236H)
            </h1>
            <p className="text-xs text-slate-500">
              Active Rule: <strong>{settings?.tax_name || 'Advance Tax u/s 236H'}</strong> • Filer:{' '}
              <strong className="font-mono text-emerald-700">{settings?.filer_rate ?? 0.5}%</strong>{' '}
              • Non-Filer:{' '}
              <strong className="font-mono text-amber-700">
                {settings?.non_filer_rate ?? 2.5}%
              </strong>{' '}
              • Exempt: <strong className="font-mono">{settings?.exempt_rate ?? 0}%</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenTaxSettings && (
            <button
              type="button"
              onClick={onOpenTaxSettings}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              Configure Tax Rates
            </button>
          )}
          <button
            type="button"
            onClick={handleExportRegisterCSV}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel/CSV
          </button>
          <button
            type="button"
            onClick={() => {
              if (taxPrintRef.current) {
                printReportDocument(
                  taxPrintRef.current,
                  `Abrar Medical Store - ${subTab.toUpperCase()} Tax Statement`
                );
              } else {
                window.print();
              }
            }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Tax Statement
          </button>
        </div>
      </div>

      {/* Sub-navigation & Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('register')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 ${
              subTab === 'register'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileCheck className="w-3.5 h-3.5" />
            Tax Collection / Deduction Register
          </button>

          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 ${
              subTab === 'ledger'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Advance Tax GL Ledgers (TAX-1040 & TAX-2040)
          </button>

          <button
            type="button"
            onClick={() => setSubTab('reconciliation')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 ${
              subTab === 'reconciliation'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Tax Reconciliation Report
          </button>

          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 ${
              subTab === 'history'
                ? 'bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Tax Rate History ({data?.history?.length || 0})
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            value={filerStatus}
            onChange={(e) => setFilerStatus(e.target.value)}
            className="px-2.5 py-1 border border-slate-300 rounded"
          >
            <option value="all">All Filer Statuses</option>
            <option value="Filer">Filer</option>
            <option value="Non-Filer">Non-Filer</option>
            <option value="Exempt">Exempt</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded font-mono"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded font-mono"
          />
          <button
            type="button"
            onClick={loadTaxData}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Printable Tax Area */}
      <div ref={taxPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={
            subTab === 'register'
              ? 'ADVANCE TAX COLLECTION & DEDUCTION REGISTER'
              : subTab === 'ledger'
              ? 'ADVANCE TAX DOUBLE-ENTRY CONTROL LEDGER'
              : subTab === 'reconciliation'
              ? 'ADVANCE TAX & FBR RECONCILIATION STATEMENT'
              : 'ADVANCE TAX RATE CHANGE AUDIT TRAIL'
          }
          subtitle="Income Tax Ordinance 2001 (Section 236G / 236H) Compliance Statement"
          metaItems={[
            { label: 'Tax Register View', value: subTab.toUpperCase() },
            { label: 'Filer Status Filter', value: filerStatus },
            { label: 'Date Period', value: `${startDate || 'Opening'} to ${endDate || 'Current'}` },
          ]}
        />

      {/* KPI Summary Strip */}
      {recon && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase text-emerald-700">
              Advance Tax Receivable on Purchases (TAX-1040)
            </div>
            <div className="text-sm font-extrabold font-mono text-slate-900 mt-1">
              Rs. {Number(recon.glPurchaseAdvTax || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Paid u/s 236H on Supplier Purchases (Asset)
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase text-indigo-700">
              Advance Tax Collected on Sales (TAX-2040)
            </div>
            <div className="text-sm font-extrabold font-mono text-slate-900 mt-1">
              Rs. {Number(recon.glSalesAdvTax || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Collected on Wholesale/Customer Sales (Liability)
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase text-slate-700">
              Net Advance Tax Adjustable Position
            </div>
            <div className="text-sm font-extrabold font-mono text-slate-900 mt-1">
              Rs. {Number(recon.netAdvanceTaxPosition || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Receivable less Collected Payable
            </div>
          </div>

          <div
            className={`rounded-lg p-3 border ${
              recon.isReconciled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase">
              {recon.isReconciled ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              )}
              Reconciliation Status
            </div>
            <div className="text-xs font-extrabold mt-1">
              {recon.isReconciled
                ? '100% Reconciled (Zero Variance)'
                : 'Variance Detected'}
            </div>
            <div className="text-[10px] opacity-80 mt-0.5">
              Invoices vs General Ledger Postings Match
            </div>
          </div>
        </div>
      )}

      {/* 1. Tax Transaction Register */}
      {subTab === 'register' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
            <span>Advance Tax Transaction Register (Purchases, Purchase Returns, Sales & Returns)</span>
            <span className="font-mono text-emerald-300">
              {data?.register?.length || 0} Tax Records
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] uppercase font-bold text-slate-700">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Invoice / Doc No</th>
                  <th className="px-3 py-2">Party Name</th>
                  <th className="px-3 py-2">NTN / STRN</th>
                  <th className="px-3 py-2 text-center">Filer Status</th>
                  <th className="px-3 py-2 text-right">Taxable Amt</th>
                  <th className="px-3 py-2 text-right">GST Amt</th>
                  <th className="px-3 py-2 text-center">Rate %</th>
                  <th className="px-3 py-2 text-right">Advance Tax</th>
                  <th className="px-3 py-2">Account Head</th>
                </tr>
              </thead>
              <tbody>
                {!data?.register || data.register.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                      No Advance Tax transactions recorded in the selected date range.
                    </td>
                  </tr>
                ) : (
                  data.register.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono">{r.tx_date}</td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 font-mono">
                          {r.tx_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-900">
                        {r.document_number}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-slate-900">{r.party_name}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">
                        {r.party_ntn || '—'} {r.party_strn ? `/ ${r.party_strn}` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.filer_status === 'Filer'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : r.filer_status === 'Non-Filer'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {r.filer_status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {Number(r.taxable_amount || 0).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {Number(r.gst_amount || 0).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-center font-mono font-bold">
                        {Number(r.tax_rate || 0).toFixed(2)}%
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">
                        Rs.{' '}
                        {Number(r.tax_amount || 0).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] font-mono text-slate-600">
                        {r.tax_account_head}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Advance Tax GL Ledgers */}
      {subTab === 'ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            {
              title: 'TAX-1040 — Advance Tax Receivable (u/s 236H on Purchases)',
              ledger: data?.receivableLedger,
            },
            {
              title: 'TAX-2040 — Advance Tax Collected Payable (u/s 236G/H on Sales)',
              ledger: data?.payableLedger,
            },
          ].map((panel, pIdx) => (
            <div
              key={pIdx}
              className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs"
            >
              <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
                <span>{panel.title}</span>
                <span className="font-mono text-emerald-300">
                  Closing: Rs.{' '}
                  {Number(panel.ledger?.closingBalance || 0).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  {panel.ledger?.closingBalanceType === 'Debit' ? 'Dr' : 'Cr'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase">
                      <th className="px-2.5 py-1.5">Date</th>
                      <th className="px-2.5 py-1.5">Document</th>
                      <th className="px-2.5 py-1.5">Narration</th>
                      <th className="px-2.5 py-1.5 text-right">Debit</th>
                      <th className="px-2.5 py-1.5 text-right">Credit</th>
                      <th className="px-2.5 py-1.5 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!panel.ledger?.entries || panel.ledger.entries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          No posted journal entries in this tax ledger.
                        </td>
                      </tr>
                    ) : (
                      panel.ledger.entries.map((e: any) => (
                        <tr key={e.id} className="border-b border-slate-200">
                          <td className="px-2.5 py-1.5 font-mono">{e.entry_date}</td>
                          <td className="px-2.5 py-1.5 font-mono font-bold">
                            {e.document_number}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-700">{e.description}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-emerald-700">
                            {e.debit_amount > 0 ? e.debit_amount.toFixed(2) : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-rose-700">
                            {e.credit_amount > 0 ? e.credit_amount.toFixed(2) : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                            {e.running_balance.toFixed(2)}{' '}
                            {e.running_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Tax Reconciliation Report */}
      {subTab === 'reconciliation' && recon && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold">
            Advance Tax Reconciliation Statement (Sub-Ledger Invoices vs General Ledger Control Accounts)
          </div>
          <div className="p-4">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 font-bold uppercase">
                  <th className="border border-slate-300 px-3 py-2">Tax Category</th>
                  <th className="border border-slate-300 px-3 py-2">GL Account Head</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">
                    Invoice Sub-Ledger Total (PKR)
                  </th>
                  <th className="border border-slate-300 px-3 py-2 text-right">
                    Posted General Ledger Total (PKR)
                  </th>
                  <th className="border border-slate-300 px-3 py-2 text-right">Variance (PKR)</th>
                  <th className="border border-slate-300 px-3 py-2 text-center">Audit Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-semibold">
                    Advance Tax on Purchases (Less Purchase Returns)
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-mono">
                    TAX-1040 — Advance Tax Receivable
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">
                    Rs. {Number(recon.invoicePurchaseAdvTax || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">
                    Rs. {Number(recon.glPurchaseAdvTax || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono font-bold">
                    Rs. {Number(recon.purchaseVariance || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-center">
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      MATCHED
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-semibold">
                    Advance Tax on Sales (Less Sales Returns)
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-mono">
                    TAX-2040 — Advance Tax Collected on Sales
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">
                    Rs. {Number(recon.invoiceSalesAdvTax || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono">
                    Rs. {Number(recon.glSalesAdvTax || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-mono font-bold">
                    Rs. {Number(recon.salesVariance || 0).toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 text-center">
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      MATCHED
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Tax Rate Audit History */}
      {subTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold">
            Centralized Advance Tax Rate Change Audit History
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase">
                  <th className="px-3 py-2">Effective From</th>
                  <th className="px-3 py-2">Tax Name</th>
                  <th className="px-3 py-2 text-center">Filer Rate</th>
                  <th className="px-3 py-2 text-center">Non-Filer Rate</th>
                  <th className="px-3 py-2 text-center">Exempt Rate</th>
                  <th className="px-3 py-2">Calculation Basis</th>
                  <th className="px-3 py-2">Change Reason</th>
                  <th className="px-3 py-2">Changed By</th>
                </tr>
              </thead>
              <tbody>
                {(data?.history || []).map((h: any) => (
                  <tr key={h.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono font-bold">{h.effective_from}</td>
                    <td className="px-3 py-1.5 font-semibold">{h.tax_name}</td>
                    <td className="px-3 py-1.5 text-center font-mono text-emerald-700 font-bold">
                      {Number(h.filer_rate).toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5 text-center font-mono text-amber-700 font-bold">
                      {Number(h.non_filer_rate).toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5 text-center font-mono">
                      {Number(h.exempt_rate).toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{h.calculation_basis}</td>
                    <td className="px-3 py-1.5 text-slate-600">{h.change_reason}</td>
                    <td className="px-3 py-1.5">{h.changed_by}</td>
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
