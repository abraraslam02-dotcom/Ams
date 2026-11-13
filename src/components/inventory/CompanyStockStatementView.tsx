import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Printer,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../services/api';
import { StockStatementResponse } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { CompanyItemSelector } from '../common/CompanyItemSelector';
import { printReportDocument } from '../../utils/printEngine';

export const CompanyStockStatementView: React.FC = () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const firstOfMonthIso = `${todayIso.slice(0, 8)}01`;

  const [fromDate, setFromDate] = useState<string>(firstOfMonthIso);
  const [toDate, setToDate] = useState<string>(todayIso);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('ALL');

  const [statement, setStatement] = useState<StockStatementResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [printPreviewMode, setPrintPreviewMode] = useState<boolean>(false);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchStatement = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCompanyStockStatement({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        companies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        itemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
        itemGroup: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
      });
      setStatement(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate stock statement');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, selectedCompanies, selectedItemIds, selectedItemGroup]);

  useEffect(() => {
    fetchStatement();
  }, [fetchStatement]);

  const selectedCompaniesHeader =
    selectedCompanies.length > 0
      ? selectedCompanies.join(', ')
      : statement?.companies.map((c) => c.company_name).join(', ') || 'ALL COMPANIES';

  const handlePrint = () => {
    if (printRef.current) {
      printReportDocument(
        printRef.current,
        `Abrar Medical Store - Stock Statement (${fromDate || 'Start'} to ${toDate})`,
        {
          paperSize: 'a4',
          orientation: 'landscape',
          margin: 'minimum',
          fontSizeScale: 'small',
        }
      );
    }
  };

  const handleExportExcel = () => {
    if (!statement) return;
    const rows: Array<Record<string, string | number>> = [];
    for (const grp of statement.companies) {
      rows.push({ 'Item Name': `=== ${grp.company_name} ===` });
      for (const r of grp.items) {
        rows.push({
          Company: grp.company_name,
          'Item Code': r.item_code,
          'Item Name': r.item_name,
          'T.Price': r.trade_price,
          Opening: r.opening,
          Rcvd: r.rcvd,
          Total: r.total,
          Today: r.today,
          'Last Month Qty': r.last_month_qty,
          'Last Month Bonus': r.last_month_bonus,
          'Sales Qty': r.sales_qty,
          'Sales Bonus': r.sales_bonus,
          'Return Qty': r.return_qty,
          'Return Bonus': r.return_bonus,
          'Net Sales Qty': r.net_sales_qty,
          'Net Sales Bonus': r.net_sales_bonus,
          'Net Sales Amount': r.net_sales_amount,
          'Closing Qty': r.closing_qty,
          'Closing Amount': r.closing_amount,
        });
      }
      rows.push({
        Company: grp.company_name,
        'Item Name': `SUBTOTAL — ${grp.company_name}`,
        Opening: grp.subtotal.opening,
        Rcvd: grp.subtotal.rcvd,
        Total: grp.subtotal.total,
        Today: grp.subtotal.today,
        'Last Month Qty': grp.subtotal.last_month_qty,
        'Last Month Bonus': grp.subtotal.last_month_bonus,
        'Sales Qty': grp.subtotal.sales_qty,
        'Sales Bonus': grp.subtotal.sales_bonus,
        'Return Qty': grp.subtotal.return_qty,
        'Return Bonus': grp.subtotal.return_bonus,
        'Net Sales Qty': grp.subtotal.net_sales_qty,
        'Net Sales Bonus': grp.subtotal.net_sales_bonus,
        'Net Sales Amount': grp.subtotal.net_sales_amount,
        'Closing Qty': grp.subtotal.closing_qty,
        'Closing Amount': grp.subtotal.closing_amount,
      });
    }
    rows.push({
      Company: 'ALL',
      'Item Name': 'GRAND TOTAL',
      Opening: statement.grandTotal.opening,
      Rcvd: statement.grandTotal.rcvd,
      Total: statement.grandTotal.total,
      Today: statement.grandTotal.today,
      'Last Month Qty': statement.grandTotal.last_month_qty,
      'Last Month Bonus': statement.grandTotal.last_month_bonus,
      'Sales Qty': statement.grandTotal.sales_qty,
      'Sales Bonus': statement.grandTotal.sales_bonus,
      'Return Qty': statement.grandTotal.return_qty,
      'Return Bonus': statement.grandTotal.return_bonus,
      'Net Sales Qty': statement.grandTotal.net_sales_qty,
      'Net Sales Bonus': statement.grandTotal.net_sales_bonus,
      'Net Sales Amount': statement.grandTotal.net_sales_amount,
      'Closing Qty': statement.grandTotal.closing_qty,
      'Closing Amount': statement.grandTotal.closing_amount,
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Statement');
    XLSX.writeFile(wb, `AMS_Company_Stock_Statement_${toDate}.xlsx`);
  };

  const fmtQty = (n: number) => (Number(n) === 0 ? '0' : Number(n).toFixed(2).replace(/\.00$/, ''));

  return (
    <div className="space-y-3 font-sans">
      {/* Control Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Company-wise Stock Statement (Full Pack Equivalent)
              </h2>
              <p className="text-[11px] text-slate-400">
                Multi-company &amp; selective item stock statement with opening, receipt, last month, net sales, bonus &amp; closing valuation
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-semibold">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono text-xs"
              />
              <span className="text-[11px] text-slate-400 font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono text-xs"
              />
            </div>

            <button
              type="button"
              onClick={fetchStatement}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Generate</span>
            </button>

            <button
              type="button"
              onClick={() => setPrintPreviewMode((v) => !v)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold cursor-pointer border ${
                printPreviewMode
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              {printPreviewMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{printPreviewMode ? 'Exit Preview' : 'Print Preview'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={!statement || statement.companies.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 text-white rounded text-xs font-semibold border border-slate-700 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF (A4 Landscape)</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!statement || statement.companies.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Advanced Company & Item Multi-Selection System */}
      <CompanyItemSelector
        selectedCompanies={selectedCompanies}
        onChangeCompanies={setSelectedCompanies}
        selectedItemIds={selectedItemIds}
        onChangeItemIds={setSelectedItemIds}
        selectedItemGroup={selectedItemGroup}
        onChangeItemGroup={setSelectedItemGroup}
        theme="dark"
        defaultExpanded={!printPreviewMode}
        title="Advanced Company & Item Selection (Pick specific companies or individual items across companies)"
      />

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable / Preview Sheet (A4 Landscape Layout with repeating column headers per printed page) */}
      <div
        ref={printRef}
        className={`rounded-lg border overflow-hidden shadow-xs ${
          printPreviewMode
            ? 'bg-white text-slate-900 border-slate-300 p-4'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Official Stock Statement Header */}
        <div
          className={`px-4 py-3 border-b ${
            printPreviewMode
              ? 'border-slate-800 bg-white text-slate-900'
              : 'border-slate-800 bg-slate-950 text-slate-100 print:bg-white print:text-slate-900 print:border-slate-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-base font-black uppercase tracking-wide">
                {statement?.store?.store_name || 'ABRAR MEDICAL STORE'}
              </div>
              <div className="text-[11px] opacity-80">
                {statement?.store?.address || ''} {statement?.store?.phone ? `• Tel: ${statement.store.phone}` : ''}
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wider text-emerald-400 print:text-slate-900">
                STOCK STATEMENT — {selectedCompaniesHeader}
              </div>
            </div>
            <div className="text-right text-[11px] font-mono space-y-0.5">
              <div className="font-bold">
                Period: {fromDate || 'Start'} to {toDate || todayIso}
              </div>
              <div>Print Date: {new Date().toLocaleDateString('en-PK')}</div>
              <div className="text-[10px] opacity-75">
                Page: <span className="ams-page-number">1</span> (A4 Landscape • All Qty in Full Packs)
              </div>
            </div>
          </div>
        </div>

        {/* Statement Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] text-left border-collapse">
            <thead
              className={`uppercase font-bold border-b ${
                printPreviewMode
                  ? 'bg-slate-100 text-slate-900 border-slate-400'
                  : 'bg-slate-950 text-slate-200 border-slate-700 print:bg-slate-100 print:text-slate-900'
              }`}
              style={{ display: 'table-header-group' }}
            >
              <tr>
                <th className="px-2 py-2 border-r border-slate-700/40 min-w-[160px]">Item Name</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">T.Price</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Opening</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Rcvd</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Total</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Today</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Last Mo Qty</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Last Mo Bns</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Sales Qty</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Sales Bns</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Ret Qty</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Ret Bns</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Net Sale Qty</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Net Sale Bns</th>
                <th className="px-2 py-2 border-r border-slate-700/40 text-right">Net Sale Amt</th>
                <th className="px-1.5 py-2 border-r border-slate-700/40 text-right">Closing Qty</th>
                <th className="px-2 py-2 text-right">Closing Amt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 font-mono">
              {loading && !statement ? (
                <tr>
                  <td colSpan={17} className="py-10 text-center font-sans text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Computing company-wise stock statement...</span>
                  </td>
                </tr>
              ) : !statement || statement.companies.length === 0 ? (
                <tr>
                  <td colSpan={17} className="py-8 text-center font-sans text-slate-400">
                    No matching stock statement items found for the current filters.
                  </td>
                </tr>
              ) : (
                statement.companies.map((grp) => (
                  <React.Fragment key={grp.company_name}>
                    {/* Company Group Header Row */}
                    <tr
                      className={
                        printPreviewMode
                          ? 'bg-slate-200 font-bold text-slate-900'
                          : 'bg-slate-800/90 font-bold text-emerald-300 print:bg-slate-200 print:text-slate-900'
                      }
                    >
                      <td colSpan={17} className="px-2 py-1.5 font-sans text-[11px] uppercase tracking-wide">
                        COMPANY: {grp.company_name} ({grp.items.length} Items)
                      </td>
                    </tr>

                    {/* Company Items */}
                    {grp.items.map((r) => (
                      <tr
                        key={r.item_id}
                        className={
                          printPreviewMode
                            ? 'hover:bg-slate-50 border-b border-slate-200'
                            : 'hover:bg-slate-800/50 border-b border-slate-800/60 print:border-slate-300'
                        }
                      >
                        <td className="px-2 py-1 border-r border-slate-700/30 font-sans font-semibold">
                          {r.item_name}
                        </td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">
                          {r.trade_price.toFixed(2)}
                        </td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.opening)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.rcvd)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right font-bold">{fmtQty(r.total)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.today)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.last_month_qty)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.last_month_bonus)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.sales_qty)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.sales_bonus)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.return_qty)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.return_bonus)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right font-bold">{fmtQty(r.net_sales_qty)}</td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right">{fmtQty(r.net_sales_bonus)}</td>
                        <td className="px-2 py-1 border-r border-slate-700/30 text-right font-semibold">
                          {formatPKR(r.net_sales_amount, false)}
                        </td>
                        <td className="px-1.5 py-1 border-r border-slate-700/30 text-right font-bold">
                          {fmtQty(r.closing_qty)}
                        </td>
                        <td className="px-2 py-1 text-right font-bold">
                          {formatPKR(r.closing_amount, false)}
                        </td>
                      </tr>
                    ))}

                    {/* Company Subtotal Row */}
                    <tr
                      className={
                        printPreviewMode
                          ? 'bg-slate-100 font-bold text-slate-900 border-b-2 border-slate-400'
                          : 'bg-slate-950/80 font-bold text-amber-300 border-b border-slate-700 print:bg-slate-100 print:text-slate-900'
                      }
                    >
                      <td colSpan={2} className="px-2 py-1.5 border-r border-slate-700/30 font-sans uppercase text-[10px]">
                        Subtotal — {grp.company_name}
                      </td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.opening)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.rcvd)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.total)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.today)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.last_month_qty)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.last_month_bonus)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.sales_qty)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.sales_bonus)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.return_qty)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.return_bonus)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.net_sales_qty)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.net_sales_bonus)}</td>
                      <td className="px-2 py-1.5 border-r border-slate-700/30 text-right">{formatPKR(grp.subtotal.net_sales_amount, false)}</td>
                      <td className="px-1.5 py-1.5 border-r border-slate-700/30 text-right">{fmtQty(grp.subtotal.closing_qty)}</td>
                      <td className="px-2 py-1.5 text-right">{formatPKR(grp.subtotal.closing_amount, false)}</td>
                    </tr>
                  </React.Fragment>
                ))
              )}
            </tbody>

            {/* Grand Total Footer */}
            {statement && statement.companies.length > 0 && (
              <tfoot>
                <tr
                  className={
                    printPreviewMode
                      ? 'bg-slate-900 text-white font-black'
                      : 'bg-emerald-950/60 text-emerald-200 font-black border-t-2 border-emerald-500/40 print:bg-slate-900 print:text-white'
                  }
                >
                  <td colSpan={2} className="px-2 py-2 border-r border-slate-700/40 uppercase text-[10px]">
                    GRAND TOTAL ({statement.companies.length} Companies)
                  </td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.opening)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.rcvd)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.total)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.today)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.last_month_qty)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.last_month_bonus)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.sales_qty)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.sales_bonus)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.return_qty)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.return_bonus)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.net_sales_qty)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.net_sales_bonus)}</td>
                  <td className="px-2 py-2 border-r border-slate-700/40 text-right font-mono">{formatPKR(statement.grandTotal.net_sales_amount, false)}</td>
                  <td className="px-1.5 py-2 border-r border-slate-700/40 text-right font-mono">{fmtQty(statement.grandTotal.closing_qty)}</td>
                  <td className="px-2 py-2 text-right font-mono">{formatPKR(statement.grandTotal.closing_amount, false)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
