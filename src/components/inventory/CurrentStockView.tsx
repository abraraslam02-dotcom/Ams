import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Boxes,
  Search,
  Download,
  RefreshCw,
  Filter,
  AlertTriangle,
  ArrowUpDown,
  Tag,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  Package,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { CurrentStockSummary } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export const CurrentStockView: React.FC = () => {
  const [data, setData] = useState<CurrentStockSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const stockPrintRef = useRef<HTMLDivElement>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Sorting
  const [sortField, setSortField] = useState<keyof CurrentStockSummary>('item_name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const limit = 25;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCurrentStock({
        search: search.trim() || undefined,
        company: companyFilter !== 'ALL' ? companyFilter : undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      setData(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch current stock');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [search, companyFilter, categoryFilter, statusFilter]);

  // Unique companies & categories
  const companies = useMemo(() => {
    return Array.from(new Set(data.map((i) => i.company_name).filter(Boolean)));
  }, [data]);

  const categories = useMemo(() => {
    return Array.from(new Set(data.map((i) => i.category).filter(Boolean)));
  }, [data]);

  // Sorted and Paginated Data
  const sortedData = useMemo(() => {
    const list = [...data];
    list.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }
      if (aVal! < bVal!) return sortAsc ? -1 : 1;
      if (aVal! > bVal!) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [data, sortField, sortAsc]);

  const totalPages = Math.ceil(sortedData.length / limit) || 1;
  const paginatedData = useMemo(() => {
    const start = (page - 1) * limit;
    return sortedData.slice(start, start + limit);
  }, [sortedData, page, limit]);

  const handleSort = (field: keyof CurrentStockSummary) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const exportToExcel = () => {
    const rows = sortedData.map((item, idx) => ({
      'Sr #': idx + 1,
      'Item Code': item.item_code,
      'Item Name': item.item_name,
      'Generic Name': item.generic_name || '',
      'Company': item.company_name,
      'Category': item.category,
      'Packing': item.packing,
      'Units/Pack': item.units_per_pack,
      'Active Batches': item.batch_count,
      'Total Packs': item.total_packs,
      'Total Loose': item.total_loose,
      'Total Units': item.total_units,
      'Avg Purchase Rate (Rs)': item.weighted_avg_purchase_rate,
      'Retail Price (Rs)': item.latest_retail_price,
      'Cost Valuation (Rs)': item.total_cost_value,
      'Retail Valuation (Rs)': item.total_retail_value,
      'Nearest Expiry': item.nearest_expiry || '—',
      'Min Stock Level': item.min_stock_level,
      'Status': item.stock_status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Current Consolidated Stock');
    XLSX.writeFile(workbook, `AMS_Current_Stock_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Summary Metrics
  const totalCostValuation = useMemo(() => data.reduce((sum, i) => sum + i.total_cost_value, 0), [data]);
  const totalRetailValuation = useMemo(() => data.reduce((sum, i) => sum + i.total_retail_value, 0), [data]);
  const totalPacksOnHand = useMemo(() => data.reduce((sum, i) => sum + i.total_packs, 0), [data]);

  return (
    <div className="space-y-3 font-sans">
      {/* KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs shadow-xs">
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Total Items in Master</div>
          <div className="text-sm font-bold text-white mt-0.5">{data.length} Items</div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Total Stock (Packs)</div>
          <div className="text-sm font-bold text-emerald-400 mt-0.5">{totalPacksOnHand.toLocaleString()} pk</div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Consolidated Cost Value</div>
          <div className="text-sm font-bold text-emerald-300 mt-0.5">{formatPKR(totalCostValuation)}</div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Retail Value</div>
          <div className="text-sm font-bold text-teal-300 mt-0.5">{formatPKR(totalRetailValuation)}</div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Potential Gross Profit</div>
          <div className="text-sm font-bold text-indigo-300 mt-0.5">{formatPKR(totalRetailValuation - totalCostValuation)}</div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Current Stock — Consolidated Item Level</h2>
              <p className="text-[11px] text-slate-400">Consolidated physical stock and weighted average valuation across all batches</p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => {
                if (stockPrintRef.current) {
                  printReportDocument(
                    stockPrintRef.current,
                    'Abrar Medical Store - Current Stock Valuation Report'
                  );
                } else {
                  window.print();
                }
              }}
              disabled={data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Report</span>
            </button>
            <button
              onClick={exportToExcel}
              disabled={data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel Export</span>
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

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs print:hidden">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search code, item, generic..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 text-xs focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <div>
            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500"
            >
              <option value="ALL">All Companies</option>
              {companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500"
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500 font-medium"
            >
              <option value="ALL">All Stock Statuses</option>
              <option value="OPTIMAL">Optimal Stock</option>
              <option value="LOW_STOCK">Low Stock (Below Reorder)</option>
              <option value="OUT_OF_STOCK">Out of Stock (Zero Balance)</option>
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

      {/* Printable Stock Valuation Area */}
      <div ref={stockPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="CONSOLIDATED CURRENT STOCK VALUATION REPORT"
          subtitle="Physical inventory balance, packaging, and weighted cost valuation"
          metaFields={[
            { label: 'Category Filter', value: categoryFilter },
            { label: 'Company Filter', value: companyFilter },
            { label: 'Status Filter', value: statusFilter },
            { label: 'Total Items', value: `${data.length}` },
            { label: 'Consolidated Cost', value: formatPKR(totalCostValuation) },
            { label: 'Retail Value', value: formatPKR(totalRetailValuation) },
          ]}
        />

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th onClick={() => handleSort('item_code')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850">
                  Item Code
                </th>
                <th onClick={() => handleSort('item_name')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 min-w-[170px]">
                  Item / Medicine Name
                </th>
                <th onClick={() => handleSort('company_name')} className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850">
                  Company
                </th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">
                  Packing
                </th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">
                  Batches
                </th>
                <th onClick={() => handleSort('total_packs')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right font-black text-emerald-300">
                  Packs on Hand
                </th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-sky-400">
                  Loose Units
                </th>
                <th onClick={() => handleSort('weighted_avg_purchase_rate')} className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right">
                  Avg Cost Rate
                </th>
                <th onClick={() => handleSort('latest_retail_price')} className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right">
                  Retail Price
                </th>
                <th onClick={() => handleSort('total_cost_value')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right font-black text-amber-300">
                  Cost Valuation
                </th>
                <th onClick={() => handleSort('total_retail_value')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right font-semibold text-teal-300">
                  Retail Value
                </th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">
                  Nearest Expiry
                </th>
                <th className="px-2.5 py-2 text-center">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && data.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Loading current stock summary...</span>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-slate-400 font-sans">
                    No items match the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedData.map((item) => {
                  const isOutOfStock = item.stock_status === 'OUT_OF_STOCK';
                  const isLowStock = item.stock_status === 'LOW_STOCK';

                  return (
                    <tr
                      key={item.item_id}
                      className={`hover:bg-slate-800/60 transition-colors ${
                        isOutOfStock ? 'bg-rose-950/20 text-rose-200' : isLowStock ? 'bg-amber-950/15' : ''
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
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-200 font-bold border border-slate-700">
                          {item.batch_count}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-300">
                        {item.total_packs}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-sky-400">
                        {item.total_loose}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                        {formatPKR(item.weighted_avg_purchase_rate, false)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                        {formatPKR(item.latest_retail_price, false)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-amber-300">
                        {formatPKR(item.total_cost_value)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-semibold text-teal-300">
                        {formatPKR(item.total_retail_value)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                        {item.nearest_expiry || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-center font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isOutOfStock
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isLowStock
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          }`}
                        >
                          {item.stock_status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-sans print:hidden">
          <span>
            Showing {(page - 1) * limit + (data.length > 0 ? 1 : 0)} to {Math.min(page * limit, data.length)} of {data.length} items
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-2 text-slate-300 font-mono">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);
};
