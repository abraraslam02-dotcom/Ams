import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Boxes,
  Search,
  Download,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Printer,
  FileSpreadsheet,
  Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { CurrentStockSummary, ItemStockReportRow } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { CompanyItemSelector } from '../common/CompanyItemSelector';
import { printReportDocument } from '../../utils/printEngine';

type ViewMode = 'item-stock-report' | 'consolidated-summary';

export const CurrentStockView: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('item-stock-report');

  // Common / Report filters
  const todayIso = new Date().toISOString().slice(0, 10);
  const firstOfMonthIso = `${todayIso.slice(0, 8)}01`;
  const [fromDate, setFromDate] = useState<string>(firstOfMonthIso);
  const [toDate, setToDate] = useState<string>(todayIso);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Item Stock Report data (17 required columns)
  const [reportRows, setReportRows] = useState<ItemStockReportRow[]>([]);
  const [reportTotals, setReportTotals] = useState<Record<string, number>>({});

  // Consolidated summary data
  const [consolidatedData, setConsolidatedData] = useState<CurrentStockSummary[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const stockPrintRef = useRef<HTMLDivElement>(null);

  // Sorting & pagination
  const [sortField, setSortField] = useState<keyof CurrentStockSummary>('item_name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const limit = 25;

  const fetchItemStockReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getItemStockReport({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        companies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        itemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
        itemGroup: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
        search: search.trim() || undefined,
      });
      setReportRows(res.data || []);
      setReportTotals(res.totals || {});
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch item stock report');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, selectedCompanies, selectedItemIds, selectedItemGroup, search]);

  const fetchConsolidated = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCurrentStock({
        search: search.trim() || undefined,
        company: selectedCompanies.length === 1 ? selectedCompanies[0] : undefined,
        category: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      let list = res.data || [];
      if (selectedCompanies.length > 1) {
        list = list.filter((i) => selectedCompanies.includes(i.company_name));
      }
      if (selectedItemIds.length > 0) {
        list = list.filter((i) => selectedItemIds.includes(i.item_id));
      }
      setConsolidatedData(list);
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch current stock summary');
    } finally {
      setLoading(false);
    }
  }, [search, selectedCompanies, selectedItemGroup, statusFilter, selectedItemIds]);

  useEffect(() => {
    if (viewMode === 'item-stock-report') {
      fetchItemStockReport();
    } else {
      fetchConsolidated();
    }
  }, [viewMode, fetchItemStockReport, fetchConsolidated]);

  const sortedConsolidated = useMemo(() => {
    const list = [...consolidatedData];
    list.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal! < bVal!) return sortAsc ? -1 : 1;
      if (aVal! > bVal!) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [consolidatedData, sortField, sortAsc]);

  const activeTotalCount =
    viewMode === 'item-stock-report' ? reportRows.length : sortedConsolidated.length;
  const totalPages = Math.ceil(activeTotalCount / limit) || 1;
  const paginatedReportRows = useMemo(() => {
    const start = (page - 1) * limit;
    return reportRows.slice(start, start + limit);
  }, [reportRows, page]);

  const paginatedConsolidated = useMemo(() => {
    const start = (page - 1) * limit;
    return sortedConsolidated.slice(start, start + limit);
  }, [sortedConsolidated, page]);

  const handleSort = (field: keyof CurrentStockSummary) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleShowAllItems = () => {
    setSelectedCompanies([]);
    setSelectedItemIds([]);
    setSelectedItemGroup('ALL');
    setSearch('');
    setStatusFilter('ALL');
  };

  const exportToExcel = () => {
    if (viewMode === 'item-stock-report') {
      const rows: Array<Record<string, string | number>> = reportRows.map((r) => ({
        'S.No': r.s_no,
        'Item Code': r.item_code,
        'Item Name': r.item_name,
        Company: r.company_name,
        'Item Group': r.item_group,
        'Opening Stock': r.opening_stock,
        Purchase: r.purchase_qty,
        'Purchase Bonus': r.purchase_bonus,
        'Purchase Return': r.purchase_return,
        Sale: r.sale_qty,
        'Sale Return': r.sale_return,
        'Transfer In': r.transfer_in,
        'Transfer Out': r.transfer_out,
        'Physical Stock Adjustment': r.physical_adjustment,
        'Closing Stock': r.closing_stock,
        'Trade Price': r.trade_price,
        'Stock Value': r.stock_value,
      }));
      rows.push({
        'S.No': '',
        'Item Code': 'GRAND TOTAL',
        'Item Name': `${reportRows.length} Items`,
        Company: '',
        'Item Group': '',
        'Opening Stock': reportTotals.opening_stock || 0,
        Purchase: reportTotals.purchase_qty || 0,
        'Purchase Bonus': reportTotals.purchase_bonus || 0,
        'Purchase Return': reportTotals.purchase_return || 0,
        Sale: reportTotals.sale_qty || 0,
        'Sale Return': reportTotals.sale_return || 0,
        'Transfer In': reportTotals.transfer_in || 0,
        'Transfer Out': reportTotals.transfer_out || 0,
        'Physical Stock Adjustment': reportTotals.physical_adjustment || 0,
        'Closing Stock': reportTotals.closing_stock || 0,
        'Trade Price': '',
        'Stock Value': reportTotals.stock_value || 0,
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Item Stock Report');
      XLSX.writeFile(workbook, `AMS_Item_Stock_Report_${toDate || todayIso}.xlsx`);
    } else {
      const rows = sortedConsolidated.map((item, idx) => {
        const upp = Math.max(1, item.units_per_pack || 1);
        const fullPacks = Number(((item.total_units || 0) / upp).toFixed(2));
        return {
          'Sr #': idx + 1,
          'Item Code': item.item_code,
          'Item Name': item.item_name,
          'Generic Name': item.generic_name || '',
          Company: item.company_name,
          'Item Group': item.category,
          Packing: item.packing,
          'Active Batches': item.batch_count,
          'Closing Stock (Full Packs)': fullPacks,
          'Avg Purchase Rate (Rs)': item.weighted_avg_purchase_rate,
          'Retail Price (Rs)': item.latest_retail_price,
          'Cost Valuation (Rs)': item.total_cost_value,
          'Retail Valuation (Rs)': item.total_retail_value,
          'Nearest Expiry': item.nearest_expiry || '—',
          Status: item.stock_status,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Current Consolidated Stock');
      XLSX.writeFile(workbook, `AMS_Current_Stock_${todayIso}.xlsx`);
    }
  };

  // Summary metrics
  const totalCostValuation = useMemo(
    () => consolidatedData.reduce((sum, i) => sum + i.total_cost_value, 0),
    [consolidatedData]
  );
  const totalRetailValuation = useMemo(
    () => consolidatedData.reduce((sum, i) => sum + i.total_retail_value, 0),
    [consolidatedData]
  );
  const totalFullPacksSummary = useMemo(
    () =>
      Number(
        consolidatedData
          .reduce((sum, i) => sum + (i.total_units || 0) / Math.max(1, i.units_per_pack || 1), 0)
          .toFixed(2)
      ),
    [consolidatedData]
  );

  return (
    <div className="space-y-3 font-sans">
      {/* KPI Ribbon */}
      {viewMode === 'item-stock-report' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs shadow-xs">
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Filtered Items</div>
            <div className="text-sm font-bold text-white mt-0.5">{reportRows.length} Items</div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Opening Stock (Pk)</div>
            <div className="text-sm font-bold text-slate-200 mt-0.5">
              {(reportTotals.opening_stock || 0).toLocaleString()} pk
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Purchased (+Bonus)</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              {(reportTotals.purchase_qty || 0).toLocaleString()} (+{reportTotals.purchase_bonus || 0}) pk
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Total Sale (Full Pk)</div>
            <div className="text-sm font-bold text-rose-400 mt-0.5">
              {(reportTotals.sale_qty || 0).toLocaleString()} pk
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Closing Stock (Pk)</div>
            <div className="text-sm font-black text-emerald-300 mt-0.5">
              {(reportTotals.closing_stock || 0).toLocaleString()} pk
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Closing Stock Value</div>
            <div className="text-sm font-black text-amber-300 mt-0.5">
              {formatPKR(reportTotals.stock_value || 0)}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs shadow-xs">
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Total Items</div>
            <div className="text-sm font-bold text-white mt-0.5">{consolidatedData.length} Items</div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Total Stock (Full Packs)</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              {totalFullPacksSummary.toLocaleString()} pk
            </div>
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
            <div className="text-sm font-bold text-indigo-300 mt-0.5">
              {formatPKR(totalRetailValuation - totalCostValuation)}
            </div>
          </div>
        </div>
      )}

      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Item Stock Report &amp; Consolidated Valuation (Full Pack Eq.)
              </h2>
              <p className="text-[11px] text-slate-400">
                Opening + Purchase + Bonus &minus; Pur. Return &minus; Sale + Sale Return + Transfer In &minus; Transfer Out &plusmn; Physical Adj = Closing Stock
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Switcher */}
            <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('item-stock-report')}
                className={`px-2.5 py-1 rounded-md font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'item-stock-report'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileSpreadsheet className="w-3 h-3" />
                <span>Item Stock Movement</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('consolidated-summary')}
                className={`px-2.5 py-1 rounded-md font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'consolidated-summary'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Consolidated Valuation</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (stockPrintRef.current) {
                  printReportDocument(
                    stockPrintRef.current,
                    `Abrar Medical Store - ${
                      viewMode === 'item-stock-report' ? 'Item Stock Report' : 'Current Stock Valuation'
                    }`,
                    { orientation: 'landscape', paperSize: 'a4', margin: 'minimum', fontSizeScale: 'small' }
                  );
                } else {
                  window.print();
                }
              }}
              disabled={activeTotalCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4 Landscape</span>
            </button>
            <button
              type="button"
              onClick={exportToExcel}
              disabled={activeTotalCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel Export</span>
            </button>
            <button
              type="button"
              onClick={() =>
                viewMode === 'item-stock-report' ? fetchItemStockReport() : fetchConsolidated()
              }
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Date, Search & Group Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          {viewMode === 'item-stock-report' && (
            <>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Date From
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Date To
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>
            </>
          )}

          <div className={viewMode === 'item-stock-report' ? 'md:col-span-2' : 'md:col-span-2'}>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Item Search (Code, Name, Company, Group)
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item code, medicine name, company..."
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-500 text-xs focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          {viewMode === 'consolidated-summary' && (
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Stock Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500 font-medium"
              >
                <option value="ALL">All Stock Statuses</option>
                <option value="OPTIMAL">Optimal Stock</option>
                <option value="LOW_STOCK">Low Stock (Below Reorder)</option>
                <option value="OUT_OF_STOCK">Out of Stock (Zero Balance)</option>
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleShowAllItems}
              className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded text-xs font-bold cursor-pointer transition-colors"
            >
              All Items (Reset Filters)
            </button>
          </div>
        </div>

        {/* Reusable Multi-Company & Individual Item Selector */}
        <CompanyItemSelector
          theme="dark"
          selectedCompanies={selectedCompanies}
          onChangeCompanies={setSelectedCompanies}
          selectedItemIds={selectedItemIds}
          onChangeItemIds={setSelectedItemIds}
          selectedItemGroup={selectedItemGroup}
          onChangeItemGroup={setSelectedItemGroup}
          defaultExpanded={false}
        />
      </div>

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Report Area */}
      <div ref={stockPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={
            viewMode === 'item-stock-report'
              ? 'ITEM STOCK MOVEMENT & CLOSING VALUATION REPORT (FULL PACK EQUIVALENT)'
              : 'CONSOLIDATED CURRENT STOCK VALUATION REPORT (FULL PACK EQUIVALENT)'
          }
          subtitle="All quantities converted to Full Pack equivalents; Bonus quantities tracked separately"
          dateRange={
            viewMode === 'item-stock-report'
              ? { fromDate: fromDate || 'Start', toDate: toDate || 'Current' }
              : undefined
          }
          metaFields={[
            {
              label: 'Companies',
              value: selectedCompanies.length > 0 ? selectedCompanies.join(', ') : 'All Companies',
            },
            { label: 'Item Group', value: selectedItemGroup },
            {
              label: 'Selected Items',
              value: selectedItemIds.length > 0 ? `${selectedItemIds.length} Specific Items` : 'All Matching Items',
            },
            { label: 'Total Items', value: `${activeTotalCount}` },
            {
              label: 'Closing Stock Value',
              value: formatPKR(
                viewMode === 'item-stock-report' ? reportTotals.stock_value || 0 : totalCostValuation
              ),
            },
          ]}
        />

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            {viewMode === 'item-stock-report' ? (
              <table className="w-full text-[11px] text-left border-collapse">
                <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
                  <tr>
                    <th className="px-2 py-2 border-r border-slate-850 text-center">S.No</th>
                    <th className="px-2.5 py-2 border-r border-slate-850">Item Code</th>
                    <th className="px-3 py-2 border-r border-slate-850 min-w-[165px]">Item Name</th>
                    <th className="px-2.5 py-2 border-r border-slate-850">Company</th>
                    <th className="px-2 py-2 border-r border-slate-850">Item Group</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-slate-300">Opening Stock</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-emerald-400">Purchase</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-teal-300">Pur. Bonus</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-amber-300">Pur. Return</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-rose-400">Sale</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-cyan-300">Sale Return</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-sky-300">Transfer In</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-sky-400">Transfer Out</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-right text-purple-300">Phys. Adj</th>
                    <th className="px-2.5 py-2 border-r border-slate-850 text-right font-black text-emerald-300">
                      Closing Stock
                    </th>
                    <th className="px-2.5 py-2 border-r border-slate-850 text-right">Trade Price</th>
                    <th className="px-3 py-2 text-right font-black text-amber-300">Stock Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {loading && reportRows.length === 0 ? (
                    <tr>
                      <td colSpan={17} className="py-10 text-center text-slate-400 font-sans">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                        <span>Calculating item stock balances (Full Pack Equivalent)...</span>
                      </td>
                    </tr>
                  ) : paginatedReportRows.length === 0 ? (
                    <tr>
                      <td colSpan={17} className="py-8 text-center text-slate-400 font-sans">
                        No items match the selected date range or filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedReportRows.map((row) => (
                      <tr
                        key={row.item_id}
                        className={`hover:bg-slate-800/60 transition-colors ${
                          row.closing_stock <= 0 ? 'bg-rose-950/15' : ''
                        }`}
                      >
                        <td className="px-2 py-1.5 border-r border-slate-800/80 text-center text-slate-400">
                          {row.s_no}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-emerald-400 font-bold">
                          {row.item_code}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-800/80 font-sans">
                          <div className="font-semibold text-white">{row.item_name}</div>
                          <div className="text-[10px] text-slate-400">{row.packing}</div>
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300 truncate max-w-[130px]">
                          {row.company_name}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-400">
                          {row.item_group}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-slate-300">
                          {row.opening_stock}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-emerald-400">
                          {row.purchase_qty}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-teal-300">
                          {row.purchase_bonus}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-amber-300">
                          {row.purchase_return}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-rose-400 font-semibold">
                          {row.sale_qty}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-cyan-300">
                          {row.sale_return}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-sky-300">
                          {row.transfer_in}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-sky-400">
                          {row.transfer_out}
                        </td>
                        <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-purple-300">
                          {row.physical_adjustment > 0
                            ? `+${row.physical_adjustment}`
                            : row.physical_adjustment}
                        </td>
                        <td className="px-2.5 py-1.5 text-right border-r border-slate-800/80 font-black text-emerald-300">
                          {row.closing_stock}
                        </td>
                        <td className="px-2.5 py-1.5 text-right border-r border-slate-800/80 text-slate-300">
                          {formatPKR(row.trade_price, false)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-black text-amber-300">
                          {formatPKR(row.stock_value)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {reportRows.length > 0 && (
                  <tfoot className="bg-slate-950 font-mono text-white border-t-2 border-slate-700 font-black text-[11px]">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-left font-sans uppercase text-emerald-300">
                        Grand Totals ({reportRows.length} Items — Full Packs)
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800">
                        {reportTotals.opening_stock || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-emerald-400">
                        {reportTotals.purchase_qty || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-teal-300">
                        {reportTotals.purchase_bonus || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-amber-300">
                        {reportTotals.purchase_return || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-rose-400">
                        {reportTotals.sale_qty || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-cyan-300">
                        {reportTotals.sale_return || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-sky-300">
                        {reportTotals.transfer_in || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-sky-400">
                        {reportTotals.transfer_out || 0}
                      </td>
                      <td className="px-2 py-2 text-right border-r border-slate-800 text-purple-300">
                        {reportTotals.physical_adjustment || 0}
                      </td>
                      <td className="px-2.5 py-2 text-right border-r border-slate-800 text-emerald-300">
                        {reportTotals.closing_stock || 0}
                      </td>
                      <td className="px-2.5 py-2 border-r border-slate-800"></td>
                      <td className="px-3 py-2 text-right text-amber-300">
                        {formatPKR(reportTotals.stock_value || 0)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
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
                    <th className="px-2 py-2 border-r border-slate-850 text-center">Packing</th>
                    <th className="px-2 py-2 border-r border-slate-850 text-center">Batches</th>
                    <th onClick={() => handleSort('total_packs')} className="px-3 py-2 cursor-pointer hover:bg-slate-900 border-r border-slate-850 text-right font-black text-emerald-300">
                      Stock (Full Packs)
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
                    <th className="px-2.5 py-2 border-r border-slate-850 text-center">Nearest Expiry</th>
                    <th className="px-2.5 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {loading && consolidatedData.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-slate-400 font-sans">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                        <span>Loading current stock summary...</span>
                      </td>
                    </tr>
                  ) : paginatedConsolidated.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-400 font-sans">
                        No items match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedConsolidated.map((item) => {
                      const isOutOfStock = item.stock_status === 'OUT_OF_STOCK';
                      const isLowStock = item.stock_status === 'LOW_STOCK';
                      const upp = Math.max(1, item.units_per_pack || 1);
                      const fullPackQty = Number(((item.total_units || 0) / upp).toFixed(2));

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
                            {fullPackQty} pk
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
            )}
          </div>

          {/* Pagination */}
          <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-sans print:hidden">
            <span>
              Showing {(page - 1) * limit + (activeTotalCount > 0 ? 1 : 0)} to{' '}
              {Math.min(page * limit, activeTotalCount)} of {activeTotalCount} items
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-slate-300 flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <span className="px-2 text-slate-300 font-mono">
                {page} / {totalPages}
              </span>
              <button
                type="button"
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
