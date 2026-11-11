import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Search,
  Download,
  Filter,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Calendar,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Barcode,
  Package,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { StockDatasheetItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface StockDatasheetViewProps {
  initialExpiryFilter?: string;
}

export const StockDatasheetView: React.FC<StockDatasheetViewProps> = ({
  initialExpiryFilter = 'ALL',
}) => {
  const [data, setData] = useState<StockDatasheetItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const datasheetPrintRef = useRef<HTMLDivElement>(null);

  // Filters state
  const [search, setSearch] = useState<string>('');
  const [itemCodeQuery, setItemCodeQuery] = useState<string>('');
  const [barcodeQuery, setBarcodeQuery] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [batchFilter, setBatchFilter] = useState<string>('');
  const [expiryStatusFilter, setExpiryStatusFilter] = useState<string>(initialExpiryFilter);
  const [sortBy, setSortBy] = useState<string>('item_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1,
  });

  // Summary figures
  const [summary, setSummary] = useState({
    total_items: 0,
    total_packs: 0,
    total_units: 0,
    total_cost_valuation: 0,
    total_retail_valuation: 0,
  });

  // Unique companies and categories for filter dropdowns
  const [companies, setCompanies] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStockDatasheet({
        search: search.trim() || undefined,
        code: itemCodeQuery.trim() || undefined,
        barcode: barcodeQuery.trim() || undefined,
        company: companyFilter !== 'ALL' ? companyFilter : undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        batch: batchFilter.trim() || undefined,
        expiry_status: expiryStatusFilter !== 'ALL' ? expiryStatusFilter : undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        page,
        limit,
      });

      setData(res.data);
      setPagination(res.pagination);
      setSummary(res.summary);

      // Collect unique companies & categories from full dataset if needed
      if (companies.length === 0) {
        const uniqueCompanies = Array.from(new Set(res.data.map((i) => i.company_name).filter(Boolean)));
        setCompanies(uniqueCompanies);
      }
      if (categories.length === 0) {
        const uniqueCategories = Array.from(new Set(res.data.map((i) => i.category).filter(Boolean)));
        setCategories(uniqueCategories);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stock datasheet');
    } finally {
      setLoading(false);
    }
  }, [search, itemCodeQuery, barcodeQuery, companyFilter, categoryFilter, batchFilter, expiryStatusFilter, sortBy, sortOrder, page, limit, companies.length, categories.length]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnKey);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setItemCodeQuery('');
    setBarcodeQuery('');
    setCompanyFilter('ALL');
    setCategoryFilter('ALL');
    setBatchFilter('');
    setExpiryStatusFilter('ALL');
    setSortBy('item_name');
    setSortOrder('asc');
    setPage(1);
  };

  const exportToExcel = async () => {
    try {
      // Fetch all records for export (limit: 5000)
      const res = await api.getStockDatasheet({
        search: search.trim() || undefined,
        code: itemCodeQuery.trim() || undefined,
        barcode: barcodeQuery.trim() || undefined,
        company: companyFilter !== 'ALL' ? companyFilter : undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        batch: batchFilter.trim() || undefined,
        expiry_status: expiryStatusFilter !== 'ALL' ? expiryStatusFilter : undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        page: 1,
        limit: 5000,
      });

      const exportRows = res.data.map((item, idx) => ({
        'Sr #': idx + 1,
        'Item Code': item.item_code,
        'Company': item.company_name,
        'Item Name': item.item_name,
        'Packing': item.packing,
        'Batch Number': item.batch_number,
        'Mfg Date': item.mfg_date || '—',
        'Expiry Date': item.expiry_date,
        'Purchase Rate (Rs)': item.purchase_rate,
        'Retail Price (Rs)': item.retail_price,
        'Opening Stock': item.opening_stock,
        'Purchased Qty': item.purchased_qty,
        'Bonus Qty': item.bonus_qty,
        'Sold Qty': item.sold_qty,
        'Purchase Return Qty': item.purchase_return_qty,
        'Sales Return Qty': item.sales_return_qty,
        'Adjusted Qty': item.adjusted_qty,
        'Current Stock (Packs)': item.current_stock,
        'Current Loose': item.current_loose_qty,
        'Total Units': item.total_stock_units,
        'Stock Value (Cost Rs)': item.stock_value,
        'Retail Value (Rs)': item.retail_value,
        'Rack Location': item.rack_location || '—',
        'Expiry Status': item.expiry_status,
      }));

      // Add summary total row
      exportRows.push({
        'Sr #': '' as any,
        'Item Code': 'TOTALS',
        'Company': '',
        'Item Name': `${res.summary.total_items} items`,
        'Packing': '',
        'Batch Number': '',
        'Mfg Date': '',
        'Expiry Date': '',
        'Purchase Rate (Rs)': 0,
        'Retail Price (Rs)': 0,
        'Opening Stock': 0,
        'Purchased Qty': 0,
        'Bonus Qty': 0,
        'Sold Qty': 0,
        'Purchase Return Qty': 0,
        'Sales Return Qty': 0,
        'Adjusted Qty': 0,
        'Current Stock (Packs)': res.summary.total_packs,
        'Current Loose': 0,
        'Total Units': res.summary.total_units,
        'Stock Value (Cost Rs)': res.summary.total_cost_valuation,
        'Retail Value (Rs)': res.summary.total_retail_valuation,
        'Rack Location': '',
        'Expiry Status': '' as any,
      });

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Datasheet');

      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(workbook, `AMS_Stock_Datasheet_${dateStr}.xlsx`);
    } catch (err: unknown) {
      alert(`Excel Export Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const getSortIcon = (columnKey: string) => {
    if (sortBy !== columnKey) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover:text-slate-200" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-emerald-400" />
    ) : (
      <ArrowDown className="w-3 h-3 text-emerald-400" />
    );
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Banner / Summary KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2.5 shadow-xs text-xs">
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Total Batches</div>
          <div className="text-sm font-bold text-white mt-0.5">{pagination.total}</div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Total Stock (Packs)</div>
          <div className="text-sm font-bold text-emerald-400 mt-0.5">
            {summary.total_packs.toLocaleString()}
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Total Loose Units</div>
          <div className="text-sm font-bold text-sky-400 mt-0.5">
            {summary.total_units.toLocaleString()}
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Stock Valuation (Cost)</div>
          <div className="text-sm font-bold text-emerald-300 mt-0.5">
            {formatPKR(summary.total_cost_valuation)}
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Retail Potential Value</div>
          <div className="text-sm font-bold text-teal-300 mt-0.5">
            {formatPKR(summary.total_retail_valuation)}
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Gross Margin Buffer</div>
          <div className="text-sm font-bold text-indigo-300 mt-0.5">
            {formatPKR(summary.total_retail_valuation - summary.total_cost_valuation)}
          </div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Stock Datasheet — 18-Column Inventory Master</h2>
              <p className="text-[11px] text-slate-400">Real-time batch stock tracking with automatic transaction integration</p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => {
                if (datasheetPrintRef.current) {
                  printReportDocument(
                    datasheetPrintRef.current,
                    'Abrar Medical Store - Batch-Wise Stock Datasheet',
                    { orientation: 'landscape', paperSize: 'a4' }
                  );
                } else {
                  window.print();
                }
              }}
              disabled={loading || data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer border border-slate-700"
              title="Print formatted A4 landscape inventory datasheet"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Datasheet</span>
            </button>
            <button
              onClick={exportToExcel}
              disabled={loading || data.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              title="Export all filtered inventory records to Microsoft Excel"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel Export</span>
            </button>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-medium transition-colors cursor-pointer"
              title="Refresh stock data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-xs pt-1 print:hidden">
          {/* General Fast Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search Name / Generic..."
              className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 text-xs"
            />
          </div>

          {/* Item Code Search */}
          <div>
            <input
              type="text"
              value={itemCodeQuery}
              onChange={(e) => {
                setItemCodeQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Item Code (e.g. ITM-001)..."
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 text-xs"
            />
          </div>

          {/* Barcode Search */}
          <div className="relative">
            <Barcode className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={barcodeQuery}
              onChange={(e) => {
                setBarcodeQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Barcode Search..."
              className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 text-xs font-mono"
            />
          </div>

          {/* Company Filter */}
          <div>
            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-hidden focus:border-emerald-500 text-xs"
            >
              <option value="ALL">All Companies</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Filter */}
          <div>
            <input
              type="text"
              value={batchFilter}
              onChange={(e) => {
                setBatchFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Batch # filter..."
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 text-xs font-mono"
            />
          </div>

          {/* Expiry Filter */}
          <div className="flex items-center gap-1.5">
            <select
              value={expiryStatusFilter}
              onChange={(e) => {
                setExpiryStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-hidden focus:border-emerald-500 text-xs font-medium"
            >
              <option value="ALL">All Expiry Status</option>
              <option value="GOOD">Good Stock</option>
              <option value="NEAR_EXPIRY">Near Expiry (&le; Alert Days)</option>
              <option value="EXPIRED">Already Expired</option>
            </select>
            {(search || itemCodeQuery || barcodeQuery || companyFilter !== 'ALL' || categoryFilter !== 'ALL' || batchFilter || expiryStatusFilter !== 'ALL') && (
              <button
                onClick={handleResetFilters}
                className="px-2 py-1.5 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded cursor-pointer whitespace-nowrap"
                title="Reset all filters"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Datasheet Area */}
      <div ref={datasheetPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="BATCH-WISE STOCK DATASHEET — 18-COLUMN INVENTORY MASTER"
          subtitle="Real-time batch stock tracking, purchase rates, retail valuation, and expiry monitoring"
          metaFields={[
            { label: 'Company Filter', value: companyFilter },
            { label: 'Category Filter', value: categoryFilter },
            { label: 'Expiry Filter', value: expiryStatusFilter },
            { label: 'Total Batches', value: `${pagination.total}` },
            { label: 'Total Packs', value: `${summary.total_packs.toLocaleString()} pk` },
            { label: 'Cost Valuation', value: formatPKR(summary.total_cost_valuation) },
            { label: 'Retail Valuation', value: formatPKR(summary.total_retail_valuation) },
          ]}
        />

        {/* Spreadsheet-Style 18-Column Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-[11px] text-left border-collapse select-text">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold sticky top-0 z-10 border-b border-slate-800">
              <tr>
                <th
                  onClick={() => handleSort('item_code')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850"
                >
                  <div className="flex items-center gap-1">
                    <span>1. Item Code</span>
                    {getSortIcon('item_code')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('company_name')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850"
                >
                  <div className="flex items-center gap-1">
                    <span>2. Company</span>
                    {getSortIcon('company_name')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('item_name')}
                  className="px-3 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850 min-w-[160px]"
                >
                  <div className="flex items-center gap-1">
                    <span>3. Item Name</span>
                    {getSortIcon('item_name')}
                  </div>
                </th>
                <th className="px-2.5 py-2 whitespace-nowrap border-r border-slate-850 text-center">
                  4. Packing
                </th>
                <th
                  onClick={() => handleSort('batch_number')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850"
                >
                  <div className="flex items-center gap-1">
                    <span>5. Batch #</span>
                    {getSortIcon('batch_number')}
                  </div>
                </th>
                <th className="px-2.5 py-2 whitespace-nowrap border-r border-slate-850 text-center">
                  6. Mfg Date
                </th>
                <th
                  onClick={() => handleSort('expiry_date')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850 text-center"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>7. Expiry Date</span>
                    {getSortIcon('expiry_date')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('purchase_rate')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850 text-right"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>8. Pur. Rate</span>
                    {getSortIcon('purchase_rate')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('retail_price')}
                  className="px-2.5 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850 text-right"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>9. Retail Price</span>
                    {getSortIcon('retail_price')}
                  </div>
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-slate-400">
                  10. Opening
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-emerald-400">
                  11. +Purchased
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-teal-400">
                  12. +Bonus
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-rose-400">
                  13. -Sold
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-amber-400">
                  14. -Pur. Ret
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-cyan-400">
                  15. +Sale Ret
                </th>
                <th className="px-2 py-2 whitespace-nowrap border-r border-slate-850 text-right text-purple-400">
                  16. &plusmn;Adjusted
                </th>
                <th
                  onClick={() => handleSort('current_stock')}
                  className="px-3 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap border-r border-slate-850 text-right font-black text-emerald-300"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>17. Current Stock</span>
                    {getSortIcon('current_stock')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('stock_value')}
                  className="px-3 py-2 cursor-pointer hover:bg-slate-900 transition-colors whitespace-nowrap text-right font-black text-amber-300"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>18. Stock Value</span>
                    {getSortIcon('stock_value')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && data.length === 0 ? (
                <tr>
                  <td colSpan={18} className="py-12 text-center text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                      <span>Loading real-time inventory ledger and batch records...</span>
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={18} className="py-12 text-center text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Package className="w-7 h-7 text-slate-600" />
                      <span className="font-medium text-slate-300">No stock records found matching filters</span>
                      <span className="text-[11px] text-slate-500">Try adjusting your search criteria or resetting filters</span>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const isExpired = item.expiry_status === 'EXPIRED';
                  const isNearExpiry = item.expiry_status === 'NEAR_EXPIRY';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-800/60 transition-colors ${
                        isExpired
                          ? 'bg-rose-950/20 text-rose-200'
                          : isNearExpiry
                          ? 'bg-amber-950/15'
                          : ''
                      }`}
                    >
                      {/* 1. Item Code */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-emerald-400 font-bold">
                        {item.item_code}
                      </td>

                      {/* 2. Company */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-slate-300 font-sans truncate max-w-[130px]">
                        {item.company_name}
                      </td>

                      {/* 3. Item Name */}
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans">
                        <div className="font-semibold text-white truncate max-w-[200px]">
                          {item.item_name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                          {item.generic_name || item.category}
                        </div>
                      </td>

                      {/* 4. Packing */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300 font-sans">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-medium border border-slate-700">
                          {item.packing} ({item.units_per_pack}s)
                        </span>
                      </td>

                      {/* 5. Batch Number */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-slate-200 font-bold">
                        {item.batch_number}
                      </td>

                      {/* 6. Manufacturing Date */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                        {item.mfg_date || '—'}
                      </td>

                      {/* 7. Expiry Date */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isExpired
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isNearExpiry
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {item.expiry_date}
                          {isExpired && ' (EXP)'}
                          {isNearExpiry && ` (${item.days_to_expiry}d)`}
                        </span>
                      </td>

                      {/* 8. Purchase Rate */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-200">
                        {formatPKR(item.purchase_rate, false)}
                      </td>

                      {/* 9. Retail Price */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                        {formatPKR(item.retail_price, false)}
                      </td>

                      {/* 10. Opening Stock */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-400">
                        {item.opening_stock}
                      </td>

                      {/* 11. Purchased Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-emerald-400 font-medium">
                        +{item.purchased_qty}
                      </td>

                      {/* 12. Bonus Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-teal-400 font-medium">
                        +{item.bonus_qty}
                      </td>

                      {/* 13. Sold Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-rose-400 font-medium">
                        -{item.sold_qty}
                      </td>

                      {/* 14. Purchase Return Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-amber-400">
                        -{item.purchase_return_qty}
                      </td>

                      {/* 15. Sales Return Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-cyan-400">
                        +{item.sales_return_qty}
                      </td>

                      {/* 16. Adjusted Qty */}
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-medium">
                        <span
                          className={
                            item.adjusted_qty > 0
                              ? 'text-purple-400'
                              : item.adjusted_qty < 0
                              ? 'text-rose-400'
                              : 'text-slate-500'
                          }
                        >
                          {item.adjusted_qty > 0 ? `+${item.adjusted_qty}` : item.adjusted_qty}
                        </span>
                      </td>

                      {/* 17. Current Stock */}
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right">
                        <div className="font-black text-emerald-300">
                          {item.current_stock} <span className="text-[10px] font-normal text-slate-400 font-sans">pk</span>
                        </div>
                        {item.current_loose_qty > 0 && (
                          <div className="text-[9px] text-sky-400 font-mono">
                            +{item.current_loose_qty} loose
                          </div>
                        )}
                      </td>

                      {/* 18. Stock Value */}
                      <td className="px-3 py-1.5 whitespace-nowrap text-right font-black text-amber-300">
                        {formatPKR(item.stock_value)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Sticky Footer Total Row */}
            {data.length > 0 && (
              <tfoot className="bg-slate-950 font-mono text-slate-200 border-t-2 border-slate-700 font-bold sticky bottom-0 z-10 text-[11px]">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-left font-sans text-xs uppercase text-slate-300">
                    Datasheet Totals (Page {pagination.page} of {pagination.totalPages})
                  </td>
                  <td colSpan={13} className="px-2 py-2 text-right text-slate-400 font-sans text-xs">
                    Consolidated Stock Value &amp; Quantities:
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-400 font-black border-r border-slate-800">
                    {summary.total_packs.toLocaleString()} pk
                  </td>
                  <td className="px-3 py-2 text-right text-amber-300 font-black">
                    {formatPKR(summary.total_cost_valuation)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Dense Pagination Bar */}
        <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 print:hidden">
          <div className="flex items-center gap-2">
            <span>Show</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>rows per page</span>
            <span className="mx-2 text-slate-600">|</span>
            <span>
              Showing {(pagination.page - 1) * pagination.limit + (data.length > 0 ? 1 : 0)} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} batches
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1 || loading}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-2 py-1 text-slate-300 font-semibold font-mono">
              {pagination.page} / {pagination.totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
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
