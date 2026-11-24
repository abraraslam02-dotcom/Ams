import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Layers,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import { api } from '../../services/api';
import { formatPKR, getPakistanDateISO } from '../../utils/formatters';
import { ProductThumb } from '../common/ProductThumb';

type ReportTab = 'overview' | 'history' | 'ledger' | 'demand';

export const VariantReportsView: React.FC = () => {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<number>(0);
  const [selectedVariantId, setSelectedVariantId] = useState<number>(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [demandDays, setDemandDays] = useState<30 | 90>(30);

  // Data
  const [overviewProducts, setOverviewProducts] = useState<any[]>([]);
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [demandRows, setDemandRows] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'overview') {
        const res = await api.getVariantReportOverview({
          q: searchQuery.trim() || undefined,
          itemId: selectedItemId || undefined,
        });
        const prods = res.products || [];
        setOverviewProducts(prods);
        // Auto-expand first 10 products by default for quick scanning
        const nextExp: Record<number, boolean> = {};
        prods.slice(0, 10).forEach((p: any) => {
          nextExp[Number(p.id)] = true;
        });
        setExpandedItems((prev) => ({ ...nextExp, ...prev }));
      } else if (tab === 'history') {
        const res = await api.getVariantReportHistory({
          itemId: selectedItemId || undefined,
          variantId: selectedVariantId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setHistoryRows(res.rows || []);
      } else if (tab === 'ledger') {
        const res = await api.getVariantReportLedger({
          itemId: selectedItemId || undefined,
          variantId: selectedVariantId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setLedgerRows(res.rows || []);
      } else if (tab === 'demand') {
        const res = await api.getVariantDemandAlerts(demandDays);
        setDemandRows(res.rows || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load variant report.');
    } finally {
      setLoading(false);
    }
  }, [tab, searchQuery, selectedItemId, selectedVariantId, startDate, endDate, demandDays]);

  useEffect(() => {
    const t = window.setTimeout(loadData, 200);
    return () => window.clearTimeout(t);
  }, [loadData]);

  // Also ensure overview products exist for filter dropdowns when switching tabs
  useEffect(() => {
    if (overviewProducts.length === 0 && tab !== 'overview') {
      api
        .getVariantReportOverview()
        .then((res) => setOverviewProducts(res.products || []))
        .catch(() => {});
    }
  }, [tab, overviewProducts.length]);

  const totalVariantsCount = overviewProducts.reduce(
    (sum, p) => sum + (Array.isArray(p.variants) ? p.variants.length : 0),
    0
  );
  const consolidatedTotalPacks = overviewProducts.reduce(
    (sum, p) => sum + Number(p.consolidated_stock_packs || 0),
    0
  );
  const consolidatedTotalCost = overviewProducts.reduce(
    (sum, p) => sum + Number(p.consolidated_cost_value || 0),
    0
  );
  const consolidatedTotalRetail = overviewProducts.reduce(
    (sum, p) => sum + Number(p.consolidated_retail_value || 0),
    0
  );

  const selectedProductObj = overviewProducts.find((p) => Number(p.id) === Number(selectedItemId));
  const selectedProductVariants: any[] = Array.isArray(selectedProductObj?.variants)
    ? selectedProductObj.variants
    : [];

  const handleExportExcel = () => {
    let rowsToExport: any[] = [];
    let sheetName = 'Variant_Report';

    if (tab === 'overview') {
      sheetName = 'Variant_Stock_Breakdown';
      for (const p of overviewProducts) {
        const vars = Array.isArray(p.variants) ? p.variants : [];
        for (const v of vars) {
          rowsToExport.push({
            'Main Code': p.item_code,
            'Main Product': p.item_name,
            Company: p.company_name,
            'Variant Code': v.variant_code,
            'Variant Name': v.variant_name,
            Colour: v.colour || '',
            Flavour: v.flavour || '',
            Type: v.variant_type || '',
            Barcode: v.barcode || '',
            'Current Stock (Packs)': Number(v.current_stock_packs || 0),
            'Min Stock': Number(v.effective_minimum_stock || v.minimum_stock || 0),
            'Purchase Rate': Number(v.effective_purchase_price || 0),
            'Retail (MRP)': Number(v.effective_retail_price || 0),
            'Stock Cost Value': Number(
              (Number(v.current_stock_packs || 0) * Number(v.effective_purchase_price || 0)).toFixed(2)
            ),
            Status: v.status,
          });
        }
      }
    } else if (tab === 'history') {
      sheetName = 'Variant_Tx_History';
      rowsToExport = historyRows;
    } else if (tab === 'ledger') {
      sheetName = 'Variant_Stock_Ledger';
      rowsToExport = ledgerRows;
    } else if (tab === 'demand') {
      sheetName = 'Variant_Demand_Alerts';
      rowsToExport = demandRows;
    }

    if (rowsToExport.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rowsToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `Abrar_${sheetName}_${getPakistanDateISO()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header & KPI Strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-600" />
              <span>Variant Stock, Ledger & Demand Reports</span>
            </h3>
            <p className="text-xs text-slate-500">
              Main Product consolidated totals equal the exact sum of variants (zero double counting).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-400">Variant Products</div>
            <div className="text-lg font-extrabold font-mono text-slate-900">
              {overviewProducts.length}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-sky-600">Total Variants</div>
            <div className="text-lg font-extrabold font-mono text-sky-800">{totalVariantsCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-emerald-600">
              Consolidated Stock
            </div>
            <div className="text-lg font-extrabold font-mono text-emerald-700">
              {consolidatedTotalPacks.toLocaleString()} Packs
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-amber-600">
              Stock Valuation (Cost / MRP)
            </div>
            <div className="text-xs font-extrabold font-mono text-slate-900 mt-1">
              {formatPKR(consolidatedTotalCost)} / {formatPKR(consolidatedTotalRetail)}
            </div>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              tab === 'overview'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>1. Consolidated Stock & Breakdown</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              tab === 'history'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>2. Purchase & Sales History</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              tab === 'ledger'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>3. Variant Stock Ledger</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('demand')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              tab === 'demand'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>4. Demand & Reorder Alerts</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center gap-2.5 text-xs">
        {tab === 'overview' && (
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Main Product or Variant..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
            />
          </div>
        )}

        {(tab === 'history' || tab === 'ledger') && (
          <>
            <select
              value={selectedItemId}
              onChange={(e) => {
                setSelectedItemId(Number(e.target.value));
                setSelectedVariantId(0);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 max-w-xs"
            >
              <option value={0}>All Variant Products</option>
              {overviewProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.item_code}] {p.item_name}
                </option>
              ))}
            </select>

            <select
              value={selectedVariantId}
              disabled={!selectedItemId}
              onChange={(e) => setSelectedVariantId(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 max-w-xs disabled:opacity-50"
            >
              <option value={0}>All Variants</option>
              {selectedProductVariants.map((v: any) => (
                <option key={v.id} value={v.id}>
                  [{v.variant_code}] {v.variant_name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300"
            />
          </>
        )}

        {tab === 'demand' && (
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-600">Demand Window:</span>
            <button
              type="button"
              onClick={() => setDemandDays(30)}
              className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${
                demandDays === 30
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => setDemandDays(90)}
              className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${
                demandDays === 90
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Last 90 Days
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
          {error}
        </div>
      )}

      {/* TAB 1: CONSOLIDATED OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-3">
          {overviewProducts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500">
              No variant-enabled products found.
            </div>
          ) : (
            overviewProducts.map((p) => {
              const isExpanded = Boolean(expandedItems[Number(p.id)]);
              const vars: any[] = Array.isArray(p.variants) ? p.variants : [];
              return (
                <div
                  key={p.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden"
                >
                  <div
                    onClick={() =>
                      setExpandedItems((prev) => ({
                        ...prev,
                        [Number(p.id)]: !isExpanded,
                      }))
                    }
                    className="px-4 py-3 bg-slate-50 hover:bg-slate-100/80 cursor-pointer flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <ProductThumb
                        src={p.thumbnail_url || p.image_url}
                        fullSrc={p.image_url}
                        alt={p.item_name}
                        size="sm"
                        enableZoom
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white">
                            {p.item_code}
                          </span>
                          <span className="text-xs font-extrabold text-slate-900 truncate">
                            {p.item_name}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-100 text-sky-800">
                            {vars.length} Variants
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {p.company_name || '—'} • Packing: {p.packing}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 text-right text-xs">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">
                          Consolidated Stock
                        </div>
                        <div className="font-mono font-extrabold text-emerald-700">
                          {Number(p.consolidated_stock_packs || 0)} Packs
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">
                          Cost Value
                        </div>
                        <div className="font-mono font-bold text-slate-800">
                          {formatPKR(Number(p.consolidated_cost_value || 0))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="overflow-x-auto border-t border-slate-200">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-white border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold">
                            <th className="py-2 px-3">Pic</th>
                            <th className="py-2 px-3">Variant Code</th>
                            <th className="py-2 px-3">Variant & Attributes</th>
                            <th className="py-2 px-3">Barcode</th>
                            <th className="py-2 px-3 text-right">Purchase Rate</th>
                            <th className="py-2 px-3 text-right">Retail (MRP)</th>
                            <th className="py-2 px-3 text-center">Stock</th>
                            <th className="py-2 px-3 text-center">Min</th>
                            <th className="py-2 px-3 text-right">Stock Value</th>
                            <th className="py-2 px-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {vars.map((v) => {
                            const stk = Number(v.current_stock_packs || 0);
                            const min = Number(v.effective_minimum_stock ?? v.minimum_stock ?? 0);
                            const low = min > 0 && stk <= min;
                            const costVal = stk * Number(v.effective_purchase_price || 0);
                            return (
                              <tr key={v.id} className="hover:bg-slate-50/70">
                                <td className="py-1.5 px-3">
                                  <ProductThumb
                                    src={v.effective_thumbnail_url || v.effective_image_url}
                                    fullSrc={v.effective_image_url}
                                    alt={v.variant_name}
                                    size="xs"
                                    enableZoom
                                  />
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-slate-800">
                                  {v.variant_code}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="font-bold text-slate-900">{v.variant_name}</span>
                                  {(v.colour || v.flavour || v.variant_type) && (
                                    <span className="text-[11px] text-slate-500 ml-2">
                                      {[v.colour, v.flavour, v.variant_type].filter(Boolean).join(' • ')}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                                  {v.barcode || '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono">
                                  {formatPKR(Number(v.effective_purchase_price || 0))}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-800">
                                  {formatPKR(Number(v.effective_retail_price || 0))}
                                </td>
                                <td className="py-2 px-3 text-center font-mono font-bold">
                                  <span
                                    className={`px-2 py-0.5 rounded ${
                                      low
                                        ? 'bg-amber-100 text-amber-900'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {stk}P
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-center font-mono text-slate-500">
                                  {min}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                  {formatPKR(costVal)}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      v.status === 'Active'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {v.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: VARIANT HISTORY */}
      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Party</th>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3">Variant</th>
                  <th className="py-2.5 px-3">Batch #</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Bonus</th>
                  <th className="py-2.5 px-3 text-right">Rate</th>
                  <th className="py-2.5 px-3 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-500">
                      No variant purchase or sales history found for these filters.
                    </td>
                  </tr>
                ) : (
                  historyRows.map((r, i) => (
                    <tr key={`${r.tx_type}_${r.invoice_number}_${i}`} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px]">{r.tx_date}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.tx_type === 'SALE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {r.tx_type}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-800">
                        {r.invoice_number}
                      </td>
                      <td className="py-2 px-3">{r.party_name || '—'}</td>
                      <td className="py-2 px-3 font-semibold">{r.item_name}</td>
                      <td className="py-2 px-3">
                        <span className="font-mono text-[10px] text-slate-500 mr-1">
                          {r.variant_code}
                        </span>
                        <span className="font-bold text-slate-900">{r.variant_name}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px]">{r.batch_number || '—'}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold">{r.qty}</td>
                      <td className="py-2 px-3 text-right font-mono text-amber-700">
                        {r.bonus_qty || 0}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {formatPKR(Number(r.rate || 0))}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">
                        {formatPKR(Number(r.net_amount || 0))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: VARIANT STOCK LEDGER */}
      {tab === 'ledger' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Movement</th>
                  <th className="py-2.5 px-3">Ref #</th>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3">Variant</th>
                  <th className="py-2.5 px-3">Batch #</th>
                  <th className="py-2.5 px-3 text-right">Qty Packs</th>
                  <th className="py-2.5 px-3 text-right">Bonus</th>
                  <th className="py-2.5 px-3 text-right">Balance After</th>
                  <th className="py-2.5 px-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-500">
                      No variant stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px]">{m.movement_date}</td>
                      <td className="py-2 px-3 font-bold text-slate-800">{m.movement_type}</td>
                      <td className="py-2 px-3 font-mono text-indigo-700">
                        {m.reference_number}
                      </td>
                      <td className="py-2 px-3 font-semibold">{m.item_name}</td>
                      <td className="py-2 px-3">
                        <span className="font-mono text-[10px] text-slate-500 mr-1">
                          {m.variant_code}
                        </span>
                        <span className="font-bold text-slate-900">{m.variant_name}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px]">{m.batch_number}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold">
                        {m.quantity_packs}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{m.bonus_packs || 0}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                        {m.balance_after_packs}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">{m.remarks || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: DEMAND & REORDER ALERTS */}
      {tab === 'demand' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold">
                  <th className="py-2.5 px-3">Alert</th>
                  <th className="py-2.5 px-3">Variant Code</th>
                  <th className="py-2.5 px-3">Product & Variant</th>
                  <th className="py-2.5 px-3 text-right">Stock</th>
                  <th className="py-2.5 px-3 text-right">Min Level</th>
                  <th className="py-2.5 px-3 text-right">{demandDays}d Sold</th>
                  <th className="py-2.5 px-3 text-right">Avg / Day</th>
                  <th className="py-2.5 px-3 text-right">Est. Days Left</th>
                  <th className="py-2.5 px-3 text-right">Suggested Reorder</th>
                  <th className="py-2.5 px-3 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {demandRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-500">
                      No active variants found for demand analysis.
                    </td>
                  </tr>
                ) : (
                  demandRows.map((d) => (
                    <tr key={d.variant_id} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                            d.alert_status === 'OUT OF STOCK'
                              ? 'bg-rose-100 text-rose-800'
                              : d.alert_status === 'CRITICAL'
                              ? 'bg-amber-100 text-amber-900'
                              : d.alert_status === 'REORDER'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {d.alert_status !== 'OK' && <AlertTriangle className="w-3 h-3" />}
                          <span>{d.alert_status}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold">{d.variant_code}</td>
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900">
                          {d.item_name} — {d.variant_name}
                        </div>
                        <div className="text-[11px] text-slate-500">{d.company_name}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">
                        {d.current_stock_packs}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">
                        {d.minimum_stock}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{d.sold_packs}</td>
                      <td className="py-2 px-3 text-right font-mono">{d.avg_daily_demand}</td>
                      <td className="py-2 px-3 text-right font-mono">
                        {d.estimated_days_left !== null ? `${d.estimated_days_left}d` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-extrabold text-sky-700">
                        {d.suggested_reorder_packs > 0 ? `+${d.suggested_reorder_packs}` : '0'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">
                        {formatPKR(Number(d.estimated_reorder_cost || 0))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
