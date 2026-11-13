import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Search,
  Download,
  RefreshCw,
  ShoppingBag,
  Package,
  Layers,
  ArrowUpDown,
  CheckCircle2,
  DollarSign,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { LowStockItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export const LowStockView: React.FC = () => {
  const [data, setData] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const lowStockPrintRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [summary, setSummary] = useState({
    out_of_stock_count: 0,
    low_stock_count: 0,
    total_reorder_cost_estimate: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLowStock({
        search: search.trim() || undefined,
        company: companyFilter !== 'ALL' ? companyFilter : undefined,
      });
      setData(res.data);
      setSummary(res.summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch low stock list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [search, companyFilter]);

  const companies = useMemo(() => {
    return Array.from(new Set(data.map((i) => i.company_name).filter(Boolean)));
  }, [data]);

  const exportToExcel = () => {
    const rows = data.map((item, idx) => ({
      'Sr #': idx + 1,
      'Item Code': item.item_code,
      'Item Name': item.item_name,
      'Generic': item.generic_name || '',
      'Company': item.company_name,
      'Category': item.category,
      'Packing': item.packing,
      'Min Stock Level': item.min_stock_level,
      'Reorder Level': item.reorder_level,
      'Current Packs (Full Pack Eq.)': Number(((item.total_current_units || 0) / Math.max(1, item.units_per_pack || 1)).toFixed(2)),
      'Stock Deficit (Packs)': item.deficit_packs,
      'Suggested Order Qty (Packs)': item.suggested_order_packs,
      'Last Purchase Rate (Rs)': item.last_purchase_rate,
      'Estimated Reorder Cost (Rs)': item.estimated_reorder_cost,
      'Status': item.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reorder & Low Stock');
    XLSX.writeFile(workbook, `AMS_Low_Stock_Reorder_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Reorder Metric Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs shadow-xs">
        <div className="bg-slate-800/80 p-2.5 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-rose-400">Completely Out of Stock</div>
          <div className="text-xl font-black text-rose-400 font-mono mt-0.5">
            {summary.out_of_stock_count} Items
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Zero pack balance in warehouse</div>
        </div>
        <div className="bg-slate-800/80 p-2.5 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-amber-400">Below Reorder Level</div>
          <div className="text-xl font-black text-amber-300 font-mono mt-0.5">
            {summary.low_stock_count} Items
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Available stock &le; safety threshold</div>
        </div>
        <div className="bg-slate-800/80 p-2.5 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-emerald-400">Estimated Reorder Cost</div>
          <div className="text-xl font-black text-emerald-300 font-mono mt-0.5">
            {formatPKR(summary.total_reorder_cost_estimate)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Capital required to replenish safety stock</div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orange-500/10 text-orange-400 rounded border border-orange-500/20">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Low Stock &amp; Reorder Planning Sheet</h2>
              <p className="text-[11px] text-slate-400">Automated stock deficit calculation based on minimum stock and reorder parameters</p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => {
                if (lowStockPrintRef.current) {
                  printReportDocument(
                    lowStockPrintRef.current,
                    'Abrar Medical Store - Low Stock & Purchase Requisition Sheet',
                    { orientation: 'landscape', paperSize: 'a4' }
                  );
                } else {
                  window.print();
                }
              }}
              disabled={data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Requisition Sheet</span>
            </button>
            <button
              onClick={exportToExcel}
              disabled={data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Purchase Requisition</span>
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 print:hidden">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, medicine name..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 text-xs focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <div>
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500"
            >
              <option value="ALL">All Pharmaceutical Companies</option>
              {companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Area */}
      <div ref={lowStockPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="LOW STOCK & REORDER REQUISITION SHEET"
          subtitle="Automated inventory replenishment report based on minimum safety stock thresholds"
          metaFields={[
            { label: 'Company Filter', value: companyFilter },
            { label: 'Out of Stock Count', value: `${summary.out_of_stock_count} items` },
            { label: 'Below Reorder Count', value: `${summary.low_stock_count} items` },
            { label: 'Est. Replenishment Cost', value: formatPKR(summary.total_reorder_cost_estimate) },
          ]}
        />

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 border-r border-slate-850">Item Code</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[170px]">Item Name</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Company</th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">Packing</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-slate-400">Min Level</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-slate-400">Reorder Level</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-rose-300">Current Stock</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-bold text-amber-400">Deficit</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-emerald-300">Suggested Order</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right">Last Cost</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-emerald-400">Est. PO Cost</th>
                <th className="px-2.5 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && data.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Analyzing stock levels against safety reorder limits...</span>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400 font-sans">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                    <span className="font-semibold text-slate-200">Excellent! All items meet or exceed minimum stock levels</span>
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const isOut = item.status === 'OUT_OF_STOCK';

                  return (
                    <tr
                      key={item.item_id}
                      className={`hover:bg-slate-800/60 transition-colors ${
                        isOut ? 'bg-rose-950/20 text-rose-200' : 'bg-amber-950/15'
                      }`}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-emerald-400 font-bold">
                        {item.item_code}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans">
                        <div className="font-semibold text-white">{item.item_name}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                          {item.generic_name || item.category}
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300 truncate max-w-[130px]">
                        {item.company_name}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center font-sans text-slate-300">
                        {item.packing}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-400">
                        {item.min_stock_level} pk
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-400">
                        {item.reorder_level} pk
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-rose-400">
                        {item.current_packs} pk
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-bold text-amber-400">
                        -{item.deficit_packs} pk
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-300">
                        {item.suggested_order_packs} pk
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                        {formatPKR(item.last_purchase_rate, false)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-400">
                        {formatPKR(item.estimated_reorder_cost)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-center font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isOut
                              ? 'bg-rose-600 text-white'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {isOut ? 'OUT OF STOCK' : 'LOW STOCK'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);
};
