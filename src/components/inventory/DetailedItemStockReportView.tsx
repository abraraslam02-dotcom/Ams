import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Search,
  Printer,
  Download,
  RefreshCw,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { api } from '../../services/api';
import { DetailedItemStockRow } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { CompanyItemSelector } from '../common/CompanyItemSelector';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export const DetailedItemStockReportView: React.FC = () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const firstOfMonthIso = `${todayIso.slice(0, 8)}01`;

  const [fromDate, setFromDate] = useState<string>(firstOfMonthIso);
  const [toDate, setToDate] = useState<string>(todayIso);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [showExtendedDetails, setShowExtendedDetails] = useState<boolean>(true);

  const [rows, setRows] = useState<DetailedItemStockRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDetailedItemStockReport({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        companies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        itemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
        itemGroup: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
        search: search.trim() || undefined,
      });
      setRows(res.data || []);
      setTotals(res.totals || {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load detailed item stock report');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, selectedCompanies, selectedItemIds, selectedItemGroup, search]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Company-wise grouping for subtotals
  const groupedByCompany = useMemo(() => {
    const map = new Map<string, DetailedItemStockRow[]>();
    for (const r of rows) {
      if (!map.has(r.company_name)) map.set(r.company_name, []);
      map.get(r.company_name)!.push(r);
    }
    return Array.from(map.entries()).map(([company_name, items]) => ({
      company_name,
      items,
      subtotal: items.reduce(
        (acc, it) => ({
          last_month_sale: Number((acc.last_month_sale + it.last_month_sale).toFixed(2)),
          opening_stock: Number((acc.opening_stock + it.opening_stock).toFixed(2)),
          opening_bonus: Number((acc.opening_bonus + it.opening_bonus).toFixed(2)),
          purchase_qty: Number((acc.purchase_qty + it.purchase_qty).toFixed(2)),
          purchase_bonus: Number((acc.purchase_bonus + it.purchase_bonus).toFixed(2)),
          purchase_return: Number((acc.purchase_return + it.purchase_return).toFixed(2)),
          sale_qty: Number((acc.sale_qty + it.sale_qty).toFixed(2)),
          sale_return: Number((acc.sale_return + it.sale_return).toFixed(2)),
          transfer_in: Number((acc.transfer_in + it.transfer_in).toFixed(2)),
          transfer_out: Number((acc.transfer_out + it.transfer_out).toFixed(2)),
          closing_stock: Number((acc.closing_stock + it.closing_stock).toFixed(2)),
          total_purchase_value: Number((acc.total_purchase_value + it.total_purchase_value).toFixed(2)),
          total_sales_value: Number((acc.total_sales_value + it.total_sales_value).toFixed(2)),
          discount_amount: Number((acc.discount_amount + it.discount_amount).toFixed(2)),
          stock_value: Number((acc.stock_value + it.stock_value).toFixed(2)),
        }),
        {
          last_month_sale: 0,
          opening_stock: 0,
          opening_bonus: 0,
          purchase_qty: 0,
          purchase_bonus: 0,
          purchase_return: 0,
          sale_qty: 0,
          sale_return: 0,
          transfer_in: 0,
          transfer_out: 0,
          closing_stock: 0,
          total_purchase_value: 0,
          total_sales_value: 0,
          discount_amount: 0,
          stock_value: 0,
        }
      ),
    }));
  }, [rows]);

  const handlePrint = () => {
    if (printRef.current) {
      printReportDocument(
        printRef.current,
        `Abrar Medical Store - Detailed Item Stock & Transaction Report (${fromDate || 'Start'} to ${toDate})`,
        { paperSize: 'a4', orientation: 'landscape', margin: 'minimum', fontSizeScale: 'small' }
      );
    }
  };

  const handleExportExcel = () => {
    const excelRows = rows.map((r) => ({
      'S.No': r.s_no,
      'Item Code': r.item_code,
      'Item Name': r.item_name,
      Company: r.company_name,
      'Item Group': r.item_group,
      'Trade Price': r.trade_price,
      'Last Month Sale (Pk)': r.last_month_sale,
      'Opening Stock (Pk)': r.opening_stock,
      'Opening Bonus (Pk)': r.opening_bonus,
      'Purchase Qty (Pk)': r.purchase_qty,
      'Purchase Bonus (Pk)': r.purchase_bonus,
      'Purchase Return (Pk)': r.purchase_return,
      'Sale Qty (Pk)': r.sale_qty,
      'Sale Return (Pk)': r.sale_return,
      'Transfer In (Pk)': r.transfer_in,
      'Transfer Out (Pk)': r.transfer_out,
      'Closing Stock (Pk)': r.closing_stock,
      'Purchase Rate': r.purchase_rate,
      'Sale Rate': r.sale_rate,
      'Total Purchase Value': r.total_purchase_value,
      'Total Sales Value': r.total_sales_value,
      Discount: r.discount_amount,
      'Batch Number': r.batch_number,
      'Expiry Date': r.expiry_date,
      'Unit / Pack': r.packing,
      'Stock Value': r.stock_value,
    }));
    const ws = XLSX.utils.json_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Detailed Stock Report');
    XLSX.writeFile(wb, `AMS_Detailed_Item_Stock_Report_${toDate}.xlsx`);
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Control Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2.5 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded border border-indigo-500/20">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Detailed Item Stock &amp; Transaction Report (Full Pack Rule)
              </h2>
              <p className="text-[11px] text-slate-400">
                Complete opening, bonus, purchases, returns, sales, transfers, closing stock &amp; batch/rate details in Full Pack equivalents
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setShowExtendedDetails((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold cursor-pointer border ${
                showExtendedDetails
                  ? 'bg-indigo-700 text-white border-indigo-600'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showExtendedDetails ? 'Extended Columns: ON' : 'Extended Columns: OFF'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 text-white rounded text-xs font-semibold border border-slate-700 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print (A4 Landscape)</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={fetchReport}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, item, company, group..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 shrink-0">From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 shrink-0">To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Multi-Company & Item Selection */}
      <CompanyItemSelector
        selectedCompanies={selectedCompanies}
        onChangeCompanies={setSelectedCompanies}
        selectedItemIds={selectedItemIds}
        onChangeItemIds={setSelectedItemIds}
        selectedItemGroup={selectedItemGroup}
        onChangeItemGroup={setSelectedItemGroup}
        theme="dark"
        defaultExpanded={false}
      />

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Report Body */}
      <div ref={printRef} className="space-y-3">
        <PrintDocumentHeader
          title="DETAILED ITEM STOCK & TRANSACTION REPORT"
          subtitle="Comprehensive Stock Movement, Bonus, Values & Batch Details (Full Pack Equivalent)"
          dateRange={{ fromDate: fromDate || 'Start', toDate: toDate || todayIso }}
          metaFields={[
            { label: 'Companies', value: selectedCompanies.length > 0 ? selectedCompanies.join(', ') : 'All Companies' },
            { label: 'Item Group', value: selectedItemGroup },
            { label: 'Items Count', value: `${rows.length}` },
            { label: 'Closing Stock Value', value: formatPKR(totals.stock_value || 0) },
          ]}
        />

        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-left border-collapse">
              <thead className="bg-slate-950 text-slate-200 uppercase font-bold border-b border-slate-700" style={{ display: 'table-header-group' }}>
                <tr>
                  <th className="px-2 py-2 border-r border-slate-800 text-center">S.No</th>
                  <th className="px-2 py-2 border-r border-slate-800">Item Code</th>
                  <th className="px-2 py-2 border-r border-slate-800 min-w-[150px]">Item Name</th>
                  <th className="px-2 py-2 border-r border-slate-800">Company</th>
                  <th className="px-2 py-2 border-r border-slate-800">Item Group</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Trade Price</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Last Mo Sale</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Opening</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Open Bns</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right text-emerald-400">Pur Qty</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right text-teal-400">Pur Bns</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right text-amber-300">Pur Ret</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right text-rose-400">Sale Qty</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right text-cyan-300">Sale Ret</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Trf In</th>
                  <th className="px-1.5 py-2 border-r border-slate-800 text-right">Trf Out</th>
                  <th className="px-2 py-2 border-r border-slate-800 text-right text-emerald-300 font-black">Closing Stock</th>
                  {showExtendedDetails && (
                    <>
                      <th className="px-1.5 py-2 border-r border-slate-800 text-right">Pur Rate</th>
                      <th className="px-1.5 py-2 border-r border-slate-800 text-right">Sale Rate</th>
                      <th className="px-2 py-2 border-r border-slate-800 text-right">Pur Value</th>
                      <th className="px-2 py-2 border-r border-slate-800 text-right">Sales Value</th>
                      <th className="px-1.5 py-2 border-r border-slate-800 text-right">Discount</th>
                      <th className="px-2 py-2 border-r border-slate-800">Batch #</th>
                      <th className="px-2 py-2 border-r border-slate-800 text-center">Expiry</th>
                      <th className="px-2 py-2 border-r border-slate-800 text-center">Unit / Pack</th>
                      <th className="px-2 py-2 text-right font-black text-amber-300">Stock Value</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={showExtendedDetails ? 26 : 17} className="py-10 text-center font-sans text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-400 mb-1" />
                      <span>Compiling detailed item stock report...</span>
                    </td>
                  </tr>
                ) : groupedByCompany.length === 0 ? (
                  <tr>
                    <td colSpan={showExtendedDetails ? 26 : 17} className="py-8 text-center font-sans text-slate-400">
                      No matching items found.
                    </td>
                  </tr>
                ) : (
                  groupedByCompany.map((grp) => (
                    <React.Fragment key={grp.company_name}>
                      {grp.items.map((r) => (
                        <tr key={r.item_id} className="hover:bg-slate-800/50">
                          <td className="px-2 py-1.5 border-r border-slate-800/80 text-center text-slate-400">{r.s_no}</td>
                          <td className="px-2 py-1.5 border-r border-slate-800/80 text-emerald-400 font-bold">{r.item_code}</td>
                          <td className="px-2 py-1.5 border-r border-slate-800/80 font-sans font-semibold text-white">{r.item_name}</td>
                          <td className="px-2 py-1.5 border-r border-slate-800/80 font-sans text-slate-300">{r.company_name}</td>
                          <td className="px-2 py-1.5 border-r border-slate-800/80 font-sans text-slate-300">{r.item_group}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.trade_price.toFixed(2)}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.last_month_sale}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.opening_stock}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.opening_bonus}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right text-emerald-400">{r.purchase_qty}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right text-teal-400">{r.purchase_bonus}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right text-amber-300">{r.purchase_return}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right text-rose-400">{r.sale_qty}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right text-cyan-300">{r.sale_return}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.transfer_in}</td>
                          <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.transfer_out}</td>
                          <td className="px-2 py-1.5 border-r border-slate-800/80 text-right font-black text-emerald-300">{r.closing_stock}</td>
                          {showExtendedDetails && (
                            <>
                              <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.purchase_rate.toFixed(2)}</td>
                              <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{r.sale_rate.toFixed(2)}</td>
                              <td className="px-2 py-1.5 border-r border-slate-800/80 text-right">{formatPKR(r.total_purchase_value, false)}</td>
                              <td className="px-2 py-1.5 border-r border-slate-800/80 text-right">{formatPKR(r.total_sales_value, false)}</td>
                              <td className="px-1.5 py-1.5 border-r border-slate-800/80 text-right">{formatPKR(r.discount_amount, false)}</td>
                              <td className="px-2 py-1.5 border-r border-slate-800/80 truncate max-w-[110px]">{r.batch_number}</td>
                              <td className="px-2 py-1.5 border-r border-slate-800/80 text-center">{r.expiry_date}</td>
                              <td className="px-2 py-1.5 border-r border-slate-800/80 text-center">{r.packing}</td>
                              <td className="px-2 py-1.5 text-right font-black text-amber-300">{formatPKR(r.stock_value, false)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                      {/* Company Subtotal */}
                      <tr className="bg-slate-950/90 text-amber-300 font-bold border-b border-slate-700">
                        <td colSpan={6} className="px-2 py-1.5 border-r border-slate-800 font-sans uppercase text-[10px]">
                          Subtotal — {grp.company_name} ({grp.items.length} items)
                        </td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.last_month_sale}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.opening_stock}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.opening_bonus}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.purchase_qty}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.purchase_bonus}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.purchase_return}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.sale_qty}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.sale_return}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.transfer_in}</td>
                        <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.transfer_out}</td>
                        <td className="px-2 py-1.5 border-r border-slate-800 text-right">{grp.subtotal.closing_stock}</td>
                        {showExtendedDetails && (
                          <>
                            <td colSpan={2} className="border-r border-slate-800" />
                            <td className="px-2 py-1.5 border-r border-slate-800 text-right">{formatPKR(grp.subtotal.total_purchase_value, false)}</td>
                            <td className="px-2 py-1.5 border-r border-slate-800 text-right">{formatPKR(grp.subtotal.total_sales_value, false)}</td>
                            <td className="px-1.5 py-1.5 border-r border-slate-800 text-right">{formatPKR(grp.subtotal.discount_amount, false)}</td>
                            <td colSpan={3} className="border-r border-slate-800" />
                            <td className="px-2 py-1.5 text-right">{formatPKR(grp.subtotal.stock_value, false)}</td>
                          </>
                        )}
                      </tr>
                    </React.Fragment>
                  ))
                )}
              </tbody>

              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-emerald-950/50 text-emerald-200 font-black border-t-2 border-emerald-500/40 font-mono">
                    <td colSpan={6} className="px-2 py-2 border-r border-slate-800 font-sans uppercase text-[10px]">
                      GRAND TOTAL ({rows.length} Items)
                    </td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.last_month_sale || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.opening_stock || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.opening_bonus || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.purchase_qty || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.purchase_bonus || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.purchase_return || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.sale_qty || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.sale_return || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.transfer_in || 0}</td>
                    <td className="px-1.5 py-2 border-r border-slate-800 text-right">{totals.transfer_out || 0}</td>
                    <td className="px-2 py-2 border-r border-slate-800 text-right">{totals.closing_stock || 0}</td>
                    {showExtendedDetails && (
                      <>
                        <td colSpan={2} className="border-r border-slate-800" />
                        <td className="px-2 py-2 border-r border-slate-800 text-right">{formatPKR(totals.total_purchase_value || 0, false)}</td>
                        <td className="px-2 py-2 border-r border-slate-800 text-right">{formatPKR(totals.total_sales_value || 0, false)}</td>
                        <td className="px-1.5 py-2 border-r border-slate-800 text-right">{formatPKR(totals.discount_amount || 0, false)}</td>
                        <td colSpan={3} className="border-r border-slate-800" />
                        <td className="px-2 py-2 text-right">{formatPKR(totals.stock_value || 0, false)}</td>
                      </>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
