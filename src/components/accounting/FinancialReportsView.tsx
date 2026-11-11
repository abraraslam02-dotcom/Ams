import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart3,
  Printer,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Scale,
  TrendingUp,
  Landmark,
  BookOpen,
} from 'lucide-react';
import { api } from '../../services/api';
import { FinancialReportKey } from '../../types/accounting';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface FinancialReportsViewProps {
  initialReport?: FinancialReportKey;
}

const REPORT_TABS: Array<{ key: FinancialReportKey; label: string }> = [
  { key: 'trial-balance', label: '1. Trial Balance' },
  { key: 'profit-loss', label: '2. Profit & Loss Statement' },
  { key: 'balance-sheet', label: '3. Balance Sheet' },
  { key: 'cash-flow', label: '4. Cash Flow Statement' },
  { key: 'day-book', label: '5. Day Book' },
  { key: 'account-summary', label: '6. Account Summary' },
  { key: 'customer-outstanding', label: '7. Customer Outstanding' },
  { key: 'supplier-outstanding', label: '8. Supplier Outstanding' },
  { key: 'expense-summary', label: '9. Expense Summary' },
  { key: 'income-summary', label: '10. Income Summary' },
  { key: 'advance-tax-report', label: '11. Advance Tax Report' },
];

export const FinancialReportsView: React.FC<FinancialReportsViewProps> = ({
  initialReport = 'trial-balance',
}) => {
  const [activeReport, setActiveReport] = useState<FinancialReportKey>(initialReport);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accountId, setAccountId] = useState('all');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const reportPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveReport(initialReport);
  }, [initialReport]);

  useEffect(() => {
    api
      .getHierarchicalCOA({ status: 'Active' })
      .then((res) => setAccounts(res.accounts || []))
      .catch(() => {});
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getFinancialReport(activeReport, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        accountId: accountId !== 'all' ? accountId : undefined,
      });
      setReportData(res);
    } catch (err) {
      console.error('Error loading financial report:', err);
    } finally {
      setLoading(false);
    }
  }, [activeReport, startDate, endDate, accountId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCSV = () => {
    if (!reportData) return;
    let csvLines: string[] = [];

    if (activeReport === 'trial-balance' || activeReport === 'account-summary') {
      csvLines.push(
        'Account Code,Account Name,Pillar,Sub Group,Opening Debit,Opening Credit,Period Debit,Period Credit,Closing Debit,Closing Credit'
      );
      for (const r of reportData.rows || []) {
        csvLines.push(
          [
            `"${r.account_code}"`,
            `"${String(r.account_name).replace(/"/g, '""')}"`,
            `"${r.financial_category}"`,
            `"${r.account_group}"`,
            Number(r.opening_debit || 0).toFixed(2),
            Number(r.opening_credit || 0).toFixed(2),
            Number(r.period_debit || 0).toFixed(2),
            Number(r.period_credit || 0).toFixed(2),
            Number(r.closing_debit || 0).toFixed(2),
            Number(r.closing_credit || 0).toFixed(2),
          ].join(',')
        );
      }
    } else if (activeReport === 'profit-loss' && reportData.statement) {
      const st = reportData.statement;
      csvLines = [
        'Line Item,Amount (PKR)',
        `"Gross Medicine Sales",${Number(st.grossSales).toFixed(2)}`,
        `"Less: Sales Returns",-${Number(st.salesReturns).toFixed(2)}`,
        `"Less: Sales Discounts",-${Number(st.salesDiscounts).toFixed(2)}`,
        `"Net Sales Revenue",${Number(st.netSalesRevenue).toFixed(2)}`,
        `"Less: Cost of Goods Sold (COGS)",-${Number(st.costOfGoodsSold).toFixed(2)}`,
        `"Gross Profit",${Number(st.grossProfit).toFixed(2)}`,
        `"Add: Other Income & Purchase Discounts",${Number(st.totalOtherIncome).toFixed(2)}`,
        `"Less: Operating Expenses",-${Number(st.totalOperatingExpenses).toFixed(2)}`,
        `"NET PROFIT / (LOSS)",${Number(st.netProfit).toFixed(2)}`,
      ];
    } else if (activeReport === 'balance-sheet' && reportData.balanceSheet) {
      const bs = reportData.balanceSheet;
      csvLines.push('Section,Account Code,Account Name,Amount (PKR)');
      for (const a of bs.assetRows || []) {
        csvLines.push(`"ASSETS","${a.account_code}","${a.account_name}",${Number(a.amount).toFixed(2)}`);
      }
      csvLines.push(`"TOTAL ASSETS","","",${Number(bs.totalAssets).toFixed(2)}`);
      for (const l of bs.liabilityRows || []) {
        csvLines.push(`"LIABILITIES","${l.account_code}","${l.account_name}",${Number(l.amount).toFixed(2)}`);
      }
      for (const e of bs.equityRows || []) {
        csvLines.push(`"EQUITY","${e.account_code}","${e.account_name}",${Number(e.amount).toFixed(2)}`);
      }
      csvLines.push(`"EQUITY","RET-PROFIT","Current Period Retained Net Profit",${Number(bs.retainedNetProfit).toFixed(2)}`);
      csvLines.push(`"TOTAL LIABILITIES & EQUITY","","",${Number(bs.totalLiabilitiesAndEquity).toFixed(2)}`);
    } else {
      csvLines.push('Account Code,Account Name,Group,Closing Debit,Closing Credit');
      for (const r of reportData.rows || []) {
        csvLines.push(
          [
            `"${r.account_code || r.entry_number || ''}"`,
            `"${String(r.account_name || r.description || '').replace(/"/g, '""')}"`,
            `"${r.account_group || r.reference_type || ''}"`,
            Number(r.closing_debit || r.total_debit || 0).toFixed(2),
            Number(r.closing_credit || r.total_credit || 0).toFixed(2),
          ].join(',')
        );
      }
    }

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abrar_Medical_${activeReport}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Header & Report Tabs */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-900 text-white flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">
                Financial Statements & Accounting Reports (Generated from Posted GL Entries)
              </h1>
              <p className="text-xs text-slate-500">
                Trial Balance • Profit & Loss • Balance Sheet • Cash Flow • Day Book • Party & Tax Summaries
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Excel/CSV
            </button>
            <button
              type="button"
              onClick={() => {
                if (reportPrintRef.current) {
                  const currentTab = REPORT_TABS.find((t) => t.key === activeReport);
                  printReportDocument(
                    reportPrintRef.current,
                    `Abrar Medical Store - ${currentTab?.label || 'Financial Statement'}`
                  );
                } else {
                  window.print();
                }
              }}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Statement
            </button>
          </div>
        </div>

        {/* 11 Report Selector Pills */}
        <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100 print:hidden">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveReport(tab.key)}
              className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${
                activeReport === tab.key
                  ? 'bg-emerald-800 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <span className="font-semibold text-slate-600 mr-1.5">From Date:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded font-mono"
            />
          </div>
          <div>
            <span className="font-semibold text-slate-600 mr-1.5">To Date:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded font-mono"
            />
          </div>
          {activeReport === 'account-summary' && (
            <div>
              <span className="font-semibold text-slate-600 mr-1.5">Account Filter:</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded"
              >
                <option value="all">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="px-2 py-1 text-slate-600 hover:text-slate-900 underline"
            >
              Clear Dates
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={loadReport}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Statement
        </button>
      </div>

      {/* Printable Report Section */}
      <div ref={reportPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={REPORT_TABS.find((t) => t.key === activeReport)?.label?.replace(/^\d+\.\s*/, '') || 'FINANCIAL REPORT'}
          subtitle="Double-Entry ERP Verified Financial Statement"
          metaItems={[
            { label: 'Statement Period', value: `${startDate || 'Opening'} to ${endDate || 'Current'}` },
            { label: 'Report Mode', value: 'Double-Entry Complete' },
            ...(activeReport === 'account-summary' && accountId !== 'all'
              ? [{ label: 'Selected Account', value: accounts.find((a) => String(a.id) === accountId)?.account_name || accountId }]
              : []),
          ]}
        />

        {/* 1. TRIAL BALANCE */}
      {activeReport === 'trial-balance' && reportData && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-bold">
              <Scale className="w-4 h-4 text-emerald-400" />
              <span>TRIAL BALANCE STATEMENT — ABRAR MEDICAL STORE</span>
            </div>
            {reportData.totals?.isBalanced ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                DOUBLE-ENTRY VERIFIED (TOTAL DEBIT = TOTAL CREDIT)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-white text-[11px] font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                CHECK OPENING BALANCES
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase text-slate-700">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Account Head</th>
                  <th className="px-3 py-2">Pillar / Group</th>
                  <th className="px-3 py-2 text-right">Opening Dr</th>
                  <th className="px-3 py-2 text-right">Opening Cr</th>
                  <th className="px-3 py-2 text-right bg-emerald-50/50">Period Debit</th>
                  <th className="px-3 py-2 text-right bg-indigo-50/50">Period Credit</th>
                  <th className="px-3 py-2 text-right font-extrabold">Closing Debit</th>
                  <th className="px-3 py-2 text-right font-extrabold">Closing Credit</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.rows || []).map((r: any) => (
                  <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-900">
                      {r.account_code}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-slate-900">{r.account_name}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      <span className="font-semibold text-slate-800">{r.financial_category}</span>{' '}
                      / {r.account_group}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {r.opening_debit > 0
                        ? r.opening_debit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {r.opening_credit > 0
                        ? r.opening_credit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-700 bg-emerald-50/20">
                      {r.period_debit > 0
                        ? r.period_debit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-indigo-700 bg-indigo-50/20">
                      {r.period_credit > 0
                        ? r.period_credit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">
                      {r.closing_debit > 0
                        ? r.closing_debit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold text-indigo-800">
                      {r.closing_credit > 0
                        ? r.closing_credit.toLocaleString('en-PK', { minimumFractionDigits: 2 })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {reportData.totals && (
                <tfoot>
                  <tr className="bg-slate-900 text-white font-bold text-xs">
                    <td colSpan={3} className="px-3 py-2 text-right uppercase">
                      GRAND TOTAL (PKR):
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(reportData.totals.openingDebit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(reportData.totals.openingCredit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300">
                      {Number(reportData.totals.periodDebit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-indigo-300">
                      {Number(reportData.totals.periodCredit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300">
                      Rs.{' '}
                      {Number(reportData.totals.closingDebit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-300">
                      Rs.{' '}
                      {Number(reportData.totals.closingCredit).toLocaleString('en-PK', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* 2. PROFIT & LOSS STATEMENT */}
      {activeReport === 'profit-loss' && reportData?.statement && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between text-xs font-bold">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>PROFIT & LOSS STATEMENT (INCOME STATEMENT) — ABRAR MEDICAL STORE</span>
            </div>
            <span className="font-mono text-emerald-300">
              {startDate || 'Inception'} to {endDate || 'Current'}
            </span>
          </div>

          <div className="p-4 space-y-4 text-xs">
            <table className="w-full border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 font-bold uppercase">
                  <th className="px-3 py-2 text-left">Particulars / Account Head</th>
                  <th className="px-3 py-2 text-right w-48">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-emerald-50/40 font-bold">
                  <td colSpan={2} className="px-3 py-1.5 text-emerald-900 uppercase">
                    1. Revenue from Medicine Sales
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="px-6 py-1.5">Gross Medicine Sales (INC-4010)</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {Number(reportData.statement.grossSales).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
                <tr className="border-b border-slate-200 text-rose-700">
                  <td className="px-6 py-1.5">Less: Medicine Sales Returns (SAL-4015)</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    ({Number(reportData.statement.salesReturns).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })})
                  </td>
                </tr>
                <tr className="border-b border-slate-200 text-rose-700">
                  <td className="px-6 py-1.5">Less: Sales Discounts Allowed (DIS-5015)</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    ({Number(reportData.statement.salesDiscounts).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })})
                  </td>
                </tr>
                <tr className="bg-slate-100 font-bold border-b border-slate-300">
                  <td className="px-3 py-2">NET SALES REVENUE</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">
                    Rs.{' '}
                    {Number(reportData.statement.netSalesRevenue).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>

                <tr className="bg-amber-50/40 font-bold">
                  <td colSpan={2} className="px-3 py-1.5 text-amber-900 uppercase">
                    2. Cost of Goods Sold (Weighted-Average Batch Costing)
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="px-6 py-1.5">
                    Cost of Goods Sold — Direct Medicine Cost (EXP-5005)
                    <span className="block text-[10px] text-slate-500 font-normal">
                      Memo: Gross Purchases Rs.{' '}
                      {Number(reportData.statement.grossPurchasesMemo || 0).toLocaleString('en-PK')} •
                      Purchase Returns Rs.{' '}
                      {Number(reportData.statement.purchaseReturnsMemo || 0).toLocaleString('en-PK')} •
                      Closing Inventory Asset Rs.{' '}
                      {Number(reportData.statement.closingInventoryMemo || 0).toLocaleString('en-PK')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-rose-700">
                    ({Number(reportData.statement.costOfGoodsSold).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })})
                  </td>
                </tr>
                <tr className="bg-emerald-50 font-extrabold border-b border-slate-300">
                  <td className="px-3 py-2 text-emerald-950">GROSS PROFIT</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-900">
                    Rs.{' '}
                    {Number(reportData.statement.grossProfit).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>

                <tr className="bg-sky-50/40 font-bold">
                  <td colSpan={2} className="px-3 py-1.5 text-sky-900 uppercase">
                    3. Other Operating Income & Purchase Discounts Earned
                  </td>
                </tr>
                {(reportData.statement.otherIncomeRows || []).map((inc: any) => (
                  <tr key={inc.id} className="border-b border-slate-200">
                    <td className="px-6 py-1.5">
                      {inc.account_name} ({inc.account_code})
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                      {Number(inc.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold border-b border-slate-300">
                  <td className="px-3 py-1.5">Total Other Income</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    Rs.{' '}
                    {Number(reportData.statement.totalOtherIncome).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>

                <tr className="bg-rose-50/40 font-bold">
                  <td colSpan={2} className="px-3 py-1.5 text-rose-900 uppercase">
                    4. Operating & Administrative Expenses
                  </td>
                </tr>
                {(reportData.statement.operatingExpenseRows || []).map((exp: any) => (
                  <tr key={exp.id} className="border-b border-slate-200">
                    <td className="px-6 py-1.5">
                      {exp.account_name} ({exp.account_code})
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-rose-700">
                      ({Number(exp.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })})
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold border-b border-slate-300">
                  <td className="px-3 py-1.5">Total Operating Expenses</td>
                  <td className="px-3 py-1.5 text-right font-mono text-rose-700">
                    (Rs.{' '}
                    {Number(reportData.statement.totalOperatingExpenses).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })})
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white font-extrabold text-sm">
                  <td className="px-3 py-2.5 uppercase">NET PROFIT / (LOSS) FOR THE PERIOD</td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-300">
                    Rs.{' '}
                    {Number(reportData.statement.netProfit).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 3. BALANCE SHEET */}
      {activeReport === 'balance-sheet' && reportData?.balanceSheet && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between text-xs font-bold">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-400" />
              <span>BALANCE SHEET (STATEMENT OF FINANCIAL POSITION) — ABRAR MEDICAL STORE</span>
            </div>
            {reportData.balanceSheet.isBalanced ? (
              <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold">
                ASSETS = LIABILITIES + EQUITY VERIFIED
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-amber-600 text-white text-[11px] font-bold">
                UNBALANCED OPENING DIFFERENCE
              </span>
            )}
          </div>

          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            {/* Left Side: ASSETS */}
            <div className="border border-slate-300 rounded overflow-hidden flex flex-col justify-between">
              <div>
                <div className="bg-emerald-900 text-white px-3 py-2 font-bold uppercase">
                  ASSETS (Current & Fixed Assets)
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {(reportData.balanceSheet.assetRows || []).map((a: any) => (
                      <tr key={a.id} className="border-b border-slate-200">
                        <td className="px-3 py-1.5 font-mono text-slate-600">{a.account_code}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900">{a.account_name}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-800">
                          Rs. {Number(a.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-900 text-white px-3 py-2.5 flex items-center justify-between font-extrabold">
                <span>TOTAL ASSETS</span>
                <span className="font-mono text-emerald-300">
                  Rs.{' '}
                  {Number(reportData.balanceSheet.totalAssets).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {/* Right Side: LIABILITIES & EQUITY */}
            <div className="border border-slate-300 rounded overflow-hidden flex flex-col justify-between">
              <div>
                <div className="bg-amber-900 text-white px-3 py-2 font-bold uppercase">
                  LIABILITIES (Payables & Tax Obligations)
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {(reportData.balanceSheet.liabilityRows || []).map((l: any) => (
                      <tr key={l.id} className="border-b border-slate-200">
                        <td className="px-3 py-1.5 font-mono text-slate-600">{l.account_code}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900">{l.account_name}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-amber-900">
                          Rs. {Number(l.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-100 font-bold border-b border-slate-300">
                      <td colSpan={2} className="px-3 py-1.5">
                        Total Liabilities
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        Rs.{' '}
                        {Number(reportData.balanceSheet.totalLiabilities).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="bg-indigo-900 text-white px-3 py-2 font-bold uppercase">
                  CAPITAL & OWNER EQUITY
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {(reportData.balanceSheet.equityRows || []).map((e: any) => (
                      <tr key={e.id} className="border-b border-slate-200">
                        <td className="px-3 py-1.5 font-mono text-slate-600">{e.account_code}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-900">{e.account_name}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-indigo-900">
                          Rs. {Number(e.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-slate-200 bg-emerald-50/50 font-semibold">
                      <td className="px-3 py-1.5 font-mono text-emerald-800">P&L-NET</td>
                      <td className="px-3 py-1.5 text-emerald-950">
                        Current Period Retained Net Profit / (Loss)
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-800">
                        Rs.{' '}
                        {Number(reportData.balanceSheet.retainedNetProfit).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                    <tr className="bg-slate-100 font-bold border-b border-slate-300">
                      <td colSpan={2} className="px-3 py-1.5">
                        Total Capital & Equity
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        Rs.{' '}
                        {Number(reportData.balanceSheet.totalEquity).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900 text-white px-3 py-2.5 flex items-center justify-between font-extrabold">
                <span>TOTAL LIABILITIES & EQUITY</span>
                <span className="font-mono text-amber-300">
                  Rs.{' '}
                  {Number(reportData.balanceSheet.totalLiabilitiesAndEquity).toLocaleString(
                    'en-PK',
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. CASH FLOW STATEMENT */}
      {activeReport === 'cash-flow' && reportData?.cashFlow && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs p-4">
          <h2 className="text-sm font-bold text-slate-900 mb-3">
            Cash Flow Statement (Cash in Hand & Bank Accounts Combined)
          </h2>
          <table className="w-full border-collapse border border-slate-300 text-xs">
            <tbody>
              <tr className="bg-slate-100 font-bold border-b border-slate-300">
                <td className="px-3 py-2">Opening Cash & Bank Balance</td>
                <td className="px-3 py-2 text-right font-mono">
                  Rs.{' '}
                  {Number(reportData.cashFlow.openingCashAndBank).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-6 py-2">Cash Inflows from Customers & Sales</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700 font-semibold">
                  Rs.{' '}
                  {Number(reportData.cashFlow.inflowsFromCustomers).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-6 py-2">Cash Outflows to Pharmaceutical Suppliers</td>
                <td className="px-3 py-2 text-right font-mono text-rose-700 font-semibold">
                  Rs.{' '}
                  {Number(reportData.cashFlow.outflowsToSuppliers).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-6 py-2">Cash Paid for Operating Expenses & Taxes</td>
                <td className="px-3 py-2 text-right font-mono text-rose-700 font-semibold">
                  Rs.{' '}
                  {Number(reportData.cashFlow.outflowsForExpensesAndTax).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="bg-emerald-50 font-bold border-b border-slate-300">
                <td className="px-3 py-2">Net Operating Cash Flow</td>
                <td className="px-3 py-2 text-right font-mono">
                  Rs.{' '}
                  {Number(reportData.cashFlow.operatingCashFlow).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="px-6 py-2">Financing Activities (Capital / Drawings / Loans)</td>
                <td className="px-3 py-2 text-right font-mono">
                  Rs.{' '}
                  {Number(reportData.cashFlow.financingFlows).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
              <tr className="bg-slate-900 text-white font-extrabold text-sm">
                <td className="px-3 py-2.5">CLOSING CASH & BANK LIQUIDITY</td>
                <td className="px-3 py-2.5 text-right font-mono text-emerald-300">
                  Rs.{' '}
                  {Number(reportData.cashFlow.closingCashAndBank).toLocaleString('en-PK', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 5. DAY BOOK */}
      {activeReport === 'day-book' && reportData && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              Chronological Day Book (All Posted Double-Entry Journal Entries)
            </span>
            <span className="font-mono text-emerald-300">
              {reportData.rows?.length || 0} Journal Entries
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase">
                  <th className="px-3 py-2">Entry No</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Ref Type</th>
                  <th className="px-3 py-2">Description & Double-Entry Lines</th>
                  <th className="px-3 py-2 text-right">Total Debit</th>
                  <th className="px-3 py-2 text-right">Total Credit</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.rows || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No journal entries posted in the selected period.
                    </td>
                  </tr>
                ) : (
                  (reportData.rows || []).map((je: any) => (
                    <tr key={je.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-bold text-slate-900 align-top">
                        {je.entry_number}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 align-top">
                        {String(je.entry_date).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px] font-bold">
                          {je.reference_type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900 mb-1">{je.description}</div>
                        <div className="space-y-0.5 pl-2 border-l-2 border-slate-300">
                          {(je.lines || []).map((l: any) => (
                            <div key={l.id} className="text-[11px] flex items-center justify-between">
                              <span>
                                <strong className="font-mono">{l.account_code}</strong> —{' '}
                                {l.account_name}
                              </span>
                              <span className="font-mono">
                                {l.debit_amount > 0
                                  ? `Dr Rs. ${Number(l.debit_amount).toFixed(2)}`
                                  : `Cr Rs. ${Number(l.credit_amount).toFixed(2)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 align-top">
                        Rs. {Number(je.total_debit).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700 align-top">
                        Rs. {Number(je.total_credit).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6 - 11. TABULAR SUMMARY REPORTS (Account Summary, Customer Outstanding, Supplier Outstanding, Expense, Income, Advance Tax) */}
      {[
        'account-summary',
        'customer-outstanding',
        'supplier-outstanding',
        'expense-summary',
        'income-summary',
        'advance-tax-report',
      ].includes(activeReport) &&
        reportData && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between uppercase">
              <span>{REPORT_TABS.find((t) => t.key === activeReport)?.label}</span>
              <span className="font-mono text-emerald-300">
                {(reportData.rows || []).length} Accounts
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase">
                    <th className="px-3 py-2">Account Code</th>
                    <th className="px-3 py-2">Account Name</th>
                    <th className="px-3 py-2">Pillar / Group</th>
                    <th className="px-3 py-2 text-right">Opening Dr/Cr</th>
                    <th className="px-3 py-2 text-right">Period Debit</th>
                    <th className="px-3 py-2 text-right">Period Credit</th>
                    <th className="px-3 py-2 text-right">Closing Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.rows || []).map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono font-bold">{r.account_code}</td>
                      <td className="px-3 py-1.5 font-medium text-slate-900">{r.account_name}</td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {r.financial_category} / {r.account_group}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {r.opening_debit > 0
                          ? `${r.opening_debit.toLocaleString('en-PK', { minimumFractionDigits: 2 })} Dr`
                          : r.opening_credit > 0
                          ? `${r.opening_credit.toLocaleString('en-PK', { minimumFractionDigits: 2 })} Cr`
                          : '0.00'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                        {Number(r.period_debit || 0).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-indigo-700">
                        {Number(r.period_credit || 0).toLocaleString('en-PK', {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-900">
                        Rs.{' '}
                        {Math.max(r.closing_debit || 0, r.closing_credit || 0).toLocaleString(
                          'en-PK',
                          { minimumFractionDigits: 2 }
                        )}{' '}
                        {r.closing_debit >= r.closing_credit ? 'Dr' : 'Cr'}
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
