import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Award,
  BarChart3,
  Calendar,
  Download,
  Eye,
  MapPin,
  Package,
  Printer,
  RotateCcw,
  ShoppingBag,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  AlertCircle,
  X,
  Layers,
} from 'lucide-react';
import { api } from '../../services/api';
import { formatPKR, formatPKTDateTime } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { CompanyItemSelector } from '../common/CompanyItemSelector';

export type PerformanceAnalysisMode = 'overall' | 'sales' | 'purchase';
export type PerformanceRankingOption = '1' | '2' | '3' | '5' | '10' | 'all';
export type PerformancePeriodPreset =
  | 'today'
  | 'last_day'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export type PerformanceSectionFilter =
  | 'all'
  | 'items'
  | 'customers'
  | 'suppliers'
  | 'towns'
  | 'areas';

interface TopPerformanceReportsViewProps {
  initialAnalysisMode?: PerformanceAnalysisMode;
  initialRanking?: PerformanceRankingOption;
  embedded?: boolean;
}

interface FilterOption {
  id: string;
  label: string;
}

interface TownMeta {
  id: number;
  town_name: string;
  areas: Array<{ id: number; town_id: number; area_name: string }>;
}

const fmtQty = (n: unknown) => {
  const num = Number(n || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
};

const fmtPct = (n: unknown) => {
  const num = Number(n || 0);
  return `${num.toFixed(2)}%`;
};

const RANKING_OPTIONS: Array<{ value: PerformanceRankingOption; label: string }> = [
  { value: '1', label: 'Top 1' },
  { value: '2', label: 'Top 2' },
  { value: '3', label: 'Top 3' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: 'all', label: 'Overall (All Records)' },
];

const PERIOD_OPTIONS: Array<{ value: PerformancePeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_day', label: 'Last Day' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'custom', label: 'Custom Date Range' },
];

export const TopPerformanceReportsView: React.FC<TopPerformanceReportsViewProps> = ({
  initialAnalysisMode = 'overall',
  initialRanking = '10',
  embedded = false,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const firstOfMonthIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);

  const [analysisMode, setAnalysisMode] = useState<PerformanceAnalysisMode>(initialAnalysisMode);
  const [ranking, setRanking] = useState<PerformanceRankingOption>(initialRanking);
  const [periodPreset, setPeriodPreset] = useState<PerformancePeriodPreset>('this_month');
  const [customStartDate, setCustomStartDate] = useState<string>(firstOfMonthIso);
  const [customEndDate, setCustomEndDate] = useState<string>(todayIso);
  const [activeSection, setActiveSection] = useState<PerformanceSectionFilter>('all');

  // Dimension filters
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('ALL');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [supplierId, setSupplierId] = useState<string>('ALL');
  const [townName, setTownName] = useState<string>('ALL');
  const [areaName, setAreaName] = useState<string>('ALL');

  // Filter lookup metadata
  const [customers, setCustomers] = useState<FilterOption[]>([]);
  const [suppliers, setSuppliers] = useState<FilterOption[]>([]);
  const [townsMeta, setTownsMeta] = useState<TownMeta[]>([]);

  // Report payload & UI state
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);

  const printContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnalysisMode(initialAnalysisMode);
  }, [initialAnalysisMode]);

  // Load Party (Customer & Supplier) and Town/Area filter options
  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      api.getAccounts({ mainGroup: 'PARTY ACCOUNTS', status: 'Active' }),
      api.getSupplyTowns(),
    ]).then(([accRes, townRes]) => {
      if (!mounted) return;
      if (accRes.status === 'fulfilled') {
        const list = Array.isArray(accRes.value?.accounts) ? accRes.value.accounts : [];
        const custOpts: FilterOption[] = [];
        const supOpts: FilterOption[] = [];
        for (const a of list) {
          const t = String(a.account_type || a.account_group || '').toLowerCase();
          const label = `${a.account_code ? `${a.account_code} — ` : ''}${a.account_name}`;
          if (t === 'customer' || t === 'customer & supplier') {
            custOpts.push({ id: String(a.id), label });
          }
          if (t === 'supplier' || t === 'customer & supplier') {
            supOpts.push({ id: String(a.id), label });
          }
        }
        setCustomers(custOpts);
        setSuppliers(supOpts);
      }
      if (townRes.status === 'fulfilled') {
        const list = Array.isArray(townRes.value?.towns) ? townRes.value.towns : [];
        setTownsMeta(
          list.map((t: any) => ({
            id: Number(t.id),
            town_name: String(t.town_name || ''),
            areas: Array.isArray(t.areas) ? t.areas : [],
          }))
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const availableAreas = useMemo(() => {
    if (townName === 'ALL') {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of townsMeta) {
        for (const a of t.areas) {
          const n = String(a.area_name || '').trim();
          if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
          }
        }
      }
      return out.sort();
    }
    const matched = townsMeta.find((t) => t.town_name === townName);
    return (matched?.areas || [])
      .map((a) => String(a.area_name || '').trim())
      .filter(Boolean)
      .sort();
  }, [townsMeta, townName]);

  const handleResetFilters = () => {
    setPeriodPreset('this_month');
    setCustomStartDate(firstOfMonthIso);
    setCustomEndDate(todayIso);
    setRanking('10');
    setActiveSection('all');
    setSelectedCompanies([]);
    setSelectedItemIds([]);
    setSelectedItemGroup('ALL');
    setCustomerId('ALL');
    setSupplierId('ALL');
    setTownName('ALL');
    setAreaName('ALL');
  };

  const fetchPerformanceReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getSalesReport('top-performance', {
        periodPreset,
        ranking,
        startDate: periodPreset === 'custom' ? customStartDate : undefined,
        endDate: periodPreset === 'custom' ? customEndDate : undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        supplierId: supplierId !== 'ALL' ? supplierId : undefined,
        companies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        itemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
        itemGroup: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
        townName: townName !== 'ALL' ? townName : undefined,
        areaName: areaName !== 'ALL' ? areaName : undefined,
      });
      setReportData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Top Performance Report');
    } finally {
      setLoading(false);
    }
  }, [
    periodPreset,
    ranking,
    customStartDate,
    customEndDate,
    customerId,
    supplierId,
    selectedCompanies,
    selectedItemIds,
    selectedItemGroup,
    townName,
    areaName,
  ]);

  useEffect(() => {
    fetchPerformanceReport();
  }, [fetchPerformanceReport]);

  const periodInfo = reportData?.period || {
    periodPreset,
    periodLabel: 'Selected Period',
    comparisonLabel: 'Current vs Previous Period',
    currentStart: customStartDate,
    currentEnd: customEndDate,
    prevStart: '—',
    prevEnd: '—',
  };

  const summary = reportData?.summary || {
    totalSales: 0,
    prevTotalSales: 0,
    totalPurchases: 0,
    prevTotalPurchases: 0,
    totalSalesQty: 0,
    prevTotalSalesQty: 0,
    totalPurchaseQty: 0,
    prevTotalPurchaseQty: 0,
    totalSalesInvoices: 0,
    prevTotalSalesInvoices: 0,
    totalPurchaseInvoices: 0,
    prevTotalPurchaseInvoices: 0,
    activeCustomers: 0,
    prevActiveCustomers: 0,
    activeSuppliers: 0,
    prevActiveSuppliers: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    salesComparison: {
      previous_amount: 0,
      current_amount: 0,
      amount_difference: 0,
      amount_pct_change: 0,
      increment_percent: 0,
      decrement_percent: 0,
      amount_trend: 'No Change',
      previous_qty: 0,
      current_qty: 0,
      qty_difference: 0,
      qty_pct_change: 0,
      qty_increment_percent: 0,
      qty_decrement_percent: 0,
      qty_trend: 'No Change',
    },
    purchaseComparison: {
      previous_amount: 0,
      current_amount: 0,
      amount_difference: 0,
      amount_pct_change: 0,
      increment_percent: 0,
      decrement_percent: 0,
      amount_trend: 'No Change',
      previous_qty: 0,
      current_qty: 0,
      qty_difference: 0,
      qty_pct_change: 0,
      qty_increment_percent: 0,
      qty_decrement_percent: 0,
      qty_trend: 'No Change',
    },
  };

  // When ranking === 'all' or user selects Overall (All Records), show complete dataset; otherwise show top N
  const sourceBucket = useMemo(() => {
    const allBucket = reportData?.overall || {
      itemsSales: [],
      itemsPurchase: [],
      itemsCombined: [],
      customers: [],
      suppliers: [],
      towns: [],
      areas: [],
    };
    if (ranking === 'all') {
      return allBucket;
    }
    const n = Math.max(1, parseInt(ranking, 10) || 10);
    return {
      itemsSales: (allBucket.itemsSales || []).slice(0, n),
      itemsPurchase: (allBucket.itemsPurchase || []).slice(0, n),
      itemsCombined: (allBucket.itemsCombined || []).slice(0, n),
      customers: (allBucket.customers || []).slice(0, n),
      suppliers: (allBucket.suppliers || []).slice(0, n),
      towns: (allBucket.towns || []).slice(0, n),
      areas: (allBucket.areas || []).slice(0, n),
    };
  }, [reportData, ranking]);

  const rankingTitleBadge =
    ranking === 'all' ? 'Overall (All Records)' : `Top ${ranking}`;

  const activeItemsRows = useMemo(() => {
    if (analysisMode === 'purchase') return sourceBucket.itemsPurchase || [];
    return sourceBucket.itemsSales || [];
  }, [analysisMode, sourceBucket]);

  const handlePrint = () => {
    if (printContainerRef.current) {
      printReportDocument(
        printContainerRef.current,
        `Abrar Medical Store - Top Performance & Overall ${
          analysisMode === 'sales'
            ? 'Sales'
            : analysisMode === 'purchase'
            ? 'Purchase'
            : 'Sales & Purchase'
        } Report (${rankingTitleBadge})`,
        {
          paperSize: 'a4',
          orientation: 'landscape',
          margin: 'compact',
          fontSizeScale: 'small',
        }
      );
    } else {
      window.print();
    }
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Overall Summary & Increment/Decrement Comparison
    const summarySheetRows = [
      {
        Metric: 'Total Sales',
        'Previous Period Amount': summary.salesComparison?.previous_amount || 0,
        'Current Period Amount': summary.salesComparison?.current_amount || 0,
        'Amount Difference': summary.salesComparison?.amount_difference || 0,
        'Increment %': summary.salesComparison?.increment_percent || 0,
        'Decrement %': summary.salesComparison?.decrement_percent || 0,
        'Previous Quantity': summary.salesComparison?.previous_qty || 0,
        'Current Quantity': summary.salesComparison?.current_qty || 0,
        'Quantity Difference': summary.salesComparison?.qty_difference || 0,
        'Quantity Growth/Decline %': summary.salesComparison?.qty_pct_change || 0,
        'Previous Invoices': summary.prevTotalSalesInvoices || 0,
        'Current Invoices': summary.totalSalesInvoices || 0,
        'Active Parties in Period': summary.activeCustomers || 0,
        'Total Registered Parties': summary.totalCustomers || 0,
      },
      {
        Metric: 'Total Purchases',
        'Previous Period Amount': summary.purchaseComparison?.previous_amount || 0,
        'Current Period Amount': summary.purchaseComparison?.current_amount || 0,
        'Amount Difference': summary.purchaseComparison?.amount_difference || 0,
        'Increment %': summary.purchaseComparison?.increment_percent || 0,
        'Decrement %': summary.purchaseComparison?.decrement_percent || 0,
        'Previous Quantity': summary.purchaseComparison?.previous_qty || 0,
        'Current Quantity': summary.purchaseComparison?.current_qty || 0,
        'Quantity Difference': summary.purchaseComparison?.qty_difference || 0,
        'Quantity Growth/Decline %': summary.purchaseComparison?.qty_pct_change || 0,
        'Previous Invoices': summary.prevTotalPurchaseInvoices || 0,
        'Current Invoices': summary.totalPurchaseInvoices || 0,
        'Active Parties in Period': summary.activeSuppliers || 0,
        'Total Registered Parties': summary.totalSuppliers || 0,
      },
    ];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summarySheetRows),
      'Overall_Summary'
    );

    // Sheet 2: Top / Overall Items
    const itemsExport = activeItemsRows.map((r: any) => ({
      Rank: r.rank,
      'Item Code': r.item_code,
      'Item Name': r.item_name,
      Company: r.company_name,
      'Item Group': r.item_group,
      Packing: r.packing,
      Invoices: r.current_invoices,
      'Previous Quantity': r.previous_qty,
      'Current Quantity': r.current_qty,
      'Quantity Difference': r.qty_difference,
      'Quantity Growth/Decline %': r.qty_pct_change,
      'Previous Period Amount': r.previous_amount,
      'Current Period Amount': r.current_amount,
      'Amount Difference': r.amount_difference,
      'Increment %': r.increment_percent,
      'Decrement %': r.decrement_percent,
      Trend: r.amount_trend,
    }));
    if (itemsExport.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(itemsExport),
        'Items_Performance'
      );
    }

    // Sheet 3: Top / Overall Customers
    const custExport = (sourceBucket.customers || []).map((r: any) => ({
      Rank: r.rank,
      'Account Code': r.account_code,
      'Customer Name': r.party_name,
      Town: r.town_name,
      Area: r.area_name,
      Invoices: r.current_invoices,
      'Previous Quantity': r.previous_qty,
      'Current Quantity': r.current_qty,
      'Quantity Difference': r.qty_difference,
      'Quantity Growth/Decline %': r.qty_pct_change,
      'Previous Period Amount': r.previous_amount,
      'Current Period Amount': r.current_amount,
      'Amount Difference': r.amount_difference,
      'Increment %': r.increment_percent,
      'Decrement %': r.decrement_percent,
      Trend: r.amount_trend,
    }));
    if (custExport.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(custExport),
        'Customers_Performance'
      );
    }

    // Sheet 4: Top / Overall Suppliers
    const supExport = (sourceBucket.suppliers || []).map((r: any) => ({
      Rank: r.rank,
      'Account Code': r.account_code,
      'Supplier Name': r.party_name,
      Town: r.town_name,
      Area: r.area_name,
      Bills: r.current_invoices,
      'Previous Quantity': r.previous_qty,
      'Current Quantity': r.current_qty,
      'Quantity Difference': r.qty_difference,
      'Quantity Growth/Decline %': r.qty_pct_change,
      'Previous Period Amount': r.previous_amount,
      'Current Period Amount': r.current_amount,
      'Amount Difference': r.amount_difference,
      'Increment %': r.increment_percent,
      'Decrement %': r.decrement_percent,
      Trend: r.amount_trend,
    }));
    if (supExport.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(supExport),
        'Suppliers_Performance'
      );
    }

    // Sheet 5: Town-wise Performance
    const townExport = (sourceBucket.towns || []).map((r: any) => ({
      Rank: r.rank,
      Town: r.town_name,
      Customers: r.customer_count,
      Suppliers: r.supplier_count,
      'Sales Invoices': r.sales_invoices,
      'Previous Sales Qty': r.prev_sales_qty,
      'Current Sales Qty': r.sales_qty,
      'Previous Sales Amount': r.prev_net_sales,
      'Current Sales Amount': r.net_sales,
      'Sales Difference': r.sales_comparison?.amount_difference || 0,
      'Sales Increment %': r.sales_comparison?.increment_percent || 0,
      'Sales Decrement %': r.sales_comparison?.decrement_percent || 0,
      'Purchase Bills': r.purchase_invoices,
      'Current Purchase Qty': r.purchase_qty,
      'Current Purchase Amount': r.net_purchases,
    }));
    if (townExport.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(townExport),
        'Town_Performance'
      );
    }

    // Sheet 6: Area-wise Performance
    const areaExport = (sourceBucket.areas || []).map((r: any) => ({
      Rank: r.rank,
      Area: r.area_name,
      Town: r.town_name,
      Customers: r.customer_count,
      Suppliers: r.supplier_count,
      'Sales Invoices': r.sales_invoices,
      'Previous Sales Qty': r.prev_sales_qty,
      'Current Sales Qty': r.sales_qty,
      'Previous Sales Amount': r.prev_net_sales,
      'Current Sales Amount': r.net_sales,
      'Sales Difference': r.sales_comparison?.amount_difference || 0,
      'Sales Increment %': r.sales_comparison?.increment_percent || 0,
      'Sales Decrement %': r.sales_comparison?.decrement_percent || 0,
      'Purchase Bills': r.purchase_invoices,
      'Current Purchase Qty': r.purchase_qty,
      'Current Purchase Amount': r.net_purchases,
    }));
    if (areaExport.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(areaExport),
        'Area_Performance'
      );
    }

    XLSX.writeFile(
      wb,
      `AMS_Top_Performance_${analysisMode}_${ranking}_${periodInfo.currentStart}_to_${periodInfo.currentEnd}.xlsx`
    );
  };

  const renderTrendBadge = (trend: string, pct: number) => {
    if (trend === 'Increment' || pct > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold">
          <TrendingUp className="w-3 h-3" />+{Math.abs(pct).toFixed(2)}% Increment
        </span>
      );
    }
    if (trend === 'Decrement' || pct < 0) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-mono text-[10px] font-bold">
          <TrendingDown className="w-3 h-3" />-{Math.abs(pct).toFixed(2)}% Decrement
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-semibold">
        0.00% No Change
      </span>
    );
  };

  const renderPerformanceTableRows = (
    rows: any[],
    type: 'item-sales' | 'item-purchase' | 'customer' | 'supplier'
  ) => {
    const isItem = type === 'item-sales' || type === 'item-purchase';
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={isItem ? 14 : 13} className="p-6 text-center text-slate-400">
            No records found for the selected period and filters.
          </td>
        </tr>
      );
    }

    const totals = rows.reduce(
      (acc, r) => ({
        invoices: acc.invoices + Number(r.current_invoices || 0),
        prev_qty: acc.prev_qty + Number(r.previous_qty || 0),
        curr_qty: acc.curr_qty + Number(r.current_qty || 0),
        qty_diff: acc.qty_diff + Number(r.qty_difference || 0),
        prev_amt: acc.prev_amt + Number(r.previous_amount || 0),
        curr_amt: acc.curr_amt + Number(r.current_amount || 0),
        amt_diff: acc.amt_diff + Number(r.amount_difference || 0),
      }),
      {
        invoices: 0,
        prev_qty: 0,
        curr_qty: 0,
        qty_diff: 0,
        prev_amt: 0,
        curr_amt: 0,
        amt_diff: 0,
      }
    );

    const totalAmtPct =
      totals.prev_amt !== 0
        ? ((totals.curr_amt - totals.prev_amt) / Math.abs(totals.prev_amt)) * 100
        : totals.curr_amt > 0
        ? 100
        : 0;
    const totalQtyPct =
      totals.prev_qty !== 0
        ? ((totals.curr_qty - totals.prev_qty) / Math.abs(totals.prev_qty)) * 100
        : totals.curr_qty > 0
        ? 100
        : 0;

    return (
      <>
        {rows.map((r: any) => (
          <tr key={`${type}-${r.rank}-${r.item_id || r.account_id}-${r.item_code || r.account_code}`} className="hover:bg-slate-50">
            <td className="p-2 text-center font-mono font-bold text-slate-700">#{r.rank}</td>
            <td className="p-2 font-mono font-bold text-indigo-700">
              {isItem ? r.item_code : r.account_code}
            </td>
            <td className="p-2 font-bold text-slate-900">
              {isItem ? r.item_name : r.party_name}
            </td>
            <td className="p-2 text-slate-700">
              {isItem ? r.company_name : r.town_name}
            </td>
            <td className="p-2 text-slate-600">
              {isItem ? `${r.item_group} (${r.packing})` : r.area_name}
            </td>
            <td className="p-2 text-right font-mono">{r.current_invoices}</td>
            <td className="p-2 text-right font-mono text-slate-600">{fmtQty(r.previous_qty)}</td>
            <td className="p-2 text-right font-mono font-bold text-slate-900">
              {fmtQty(r.current_qty)}
            </td>
            <td
              className={`p-2 text-right font-mono font-bold ${
                Number(r.qty_difference) > 0
                  ? 'text-emerald-700'
                  : Number(r.qty_difference) < 0
                  ? 'text-rose-700'
                  : 'text-slate-600'
              }`}
            >
              {Number(r.qty_difference) > 0 ? '+' : ''}
              {fmtQty(r.qty_difference)} ({Number(r.qty_pct_change) > 0 ? '+' : ''}
              {fmtPct(r.qty_pct_change)})
            </td>
            <td className="p-2 text-right font-mono text-slate-600">
              {formatPKR(r.previous_amount)}
            </td>
            <td className="p-2 text-right font-mono font-black text-slate-900">
              {formatPKR(r.current_amount)}
            </td>
            <td
              className={`p-2 text-right font-mono font-bold ${
                Number(r.amount_difference) > 0
                  ? 'text-emerald-700'
                  : Number(r.amount_difference) < 0
                  ? 'text-rose-700'
                  : 'text-slate-600'
              }`}
            >
              {Number(r.amount_difference) > 0 ? '+' : ''}
              {formatPKR(r.amount_difference)}
            </td>
            <td className="p-2 text-right font-mono font-bold text-emerald-700">
              {Number(r.increment_percent) > 0 ? `+${fmtPct(r.increment_percent)}` : '0.00%'}
            </td>
            <td className="p-2 text-right font-mono font-bold text-rose-700">
              {Number(r.decrement_percent) > 0 ? `-${fmtPct(r.decrement_percent)}` : '0.00%'}
            </td>
          </tr>
        ))}
        <tr className="bg-slate-900 text-white font-bold text-xs">
          <td colSpan={5} className="p-2.5 uppercase">
            Total ({rows.length} {rankingTitleBadge} Records)
          </td>
          <td className="p-2.5 text-right font-mono">{totals.invoices}</td>
          <td className="p-2.5 text-right font-mono">{fmtQty(totals.prev_qty)}</td>
          <td className="p-2.5 text-right font-mono">{fmtQty(totals.curr_qty)}</td>
          <td className="p-2.5 text-right font-mono">
            {totals.qty_diff > 0 ? '+' : ''}
            {fmtQty(totals.qty_diff)} ({totalQtyPct > 0 ? '+' : ''}
            {totalQtyPct.toFixed(2)}%)
          </td>
          <td className="p-2.5 text-right font-mono">{formatPKR(totals.prev_amt)}</td>
          <td className="p-2.5 text-right font-mono text-emerald-300">
            {formatPKR(totals.curr_amt)}
          </td>
          <td className="p-2.5 text-right font-mono">
            {totals.amt_diff > 0 ? '+' : ''}
            {formatPKR(totals.amt_diff)}
          </td>
          <td className="p-2.5 text-right font-mono text-emerald-300">
            {totalAmtPct > 0 ? `+${totalAmtPct.toFixed(2)}%` : '0.00%'}
          </td>
          <td className="p-2.5 text-right font-mono text-rose-300">
            {totalAmtPct < 0 ? `-${Math.abs(totalAmtPct).toFixed(2)}%` : '0.00%'}
          </td>
        </tr>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Control Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Top Performance & Overall Sales / Purchase Analytics
              </h3>
              <p className="text-[11px] text-slate-500">
                Dynamic Top 1 / 2 / 3 / 5 / 10 & Overall Rankings with Period-over-Period Increment / Decrement Analysis
              </p>
            </div>
          </div>

          {/* Action Buttons: Reset, Print Preview, A4 Print, Excel Export */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => setShowPrintPreview(true)}
              className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              Print Preview
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Excel Export
            </button>
          </div>
        </div>

        {/* Row 1: Analysis Mode (Overall Report / Sales Analysis / Purchase Analysis) + Ranking Options */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
          {/* Analysis Mode Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">
              Report Mode:
            </span>
            <button
              type="button"
              onClick={() => setAnalysisMode('overall')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                analysisMode === 'overall'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Overall Report (Sales & Purchase)</span>
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode('sales')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                analysisMode === 'sales'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Sales Performance Analysis</span>
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode('purchase')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                analysisMode === 'purchase'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Purchase Performance Analysis</span>
            </button>
          </div>

          {/* 1. Dynamic Ranking Selection */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">
              Ranking:
            </span>
            {RANKING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRanking(opt.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  ranking === opt.value
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Date Period Options (Today, Last Day, This Month, Last Month, This Year, Last Year, Custom Date Range) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase text-slate-500 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              Date Period:
            </span>
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriodPreset(p.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  periodPreset === p.value
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {periodPreset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="font-semibold text-slate-600">From:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 font-mono"
              />
              <label className="font-semibold text-slate-600">To:</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 font-mono"
              />
            </div>
          )}
        </div>

        {/* Active Comparison Rule Banner */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">
              {periodInfo.periodLabel}
            </span>
            <span className="font-semibold text-slate-700">
              Current Period:{' '}
              <span className="font-mono font-bold text-slate-900">
                {periodInfo.currentStart} to {periodInfo.currentEnd}
              </span>
            </span>
            <span className="text-slate-400">|</span>
            <span className="font-semibold text-slate-600">
              Previous Period:{' '}
              <span className="font-mono font-bold text-slate-800">
                {periodInfo.prevStart} to {periodInfo.prevEnd}
              </span>
            </span>
          </div>
          <span className="text-[11px] font-medium text-indigo-700">
            Comparison Rule: {periodInfo.comparisonLabel}
          </span>
        </div>

        {/* Row 3: Party, Supplier, Town & Dependent Area Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Customer Filter
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
            >
              <option value="ALL">All Customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Supplier Filter
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
            >
              <option value="ALL">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Town Filter
            </label>
            <select
              value={townName}
              onChange={(e) => {
                setTownName(e.target.value);
                setAreaName('ALL');
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
            >
              <option value="ALL">All Towns</option>
              {townsMeta.map((t) => (
                <option key={t.id} value={t.town_name}>
                  {t.town_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Area Filter (Dependent on Town)
            </label>
            <select
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
            >
              <option value="ALL">All Areas</option>
              {availableAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Company & Item Multi-Selection Filter */}
        <CompanyItemSelector
          theme="light"
          defaultExpanded={false}
          selectedCompanies={selectedCompanies}
          onChangeCompanies={setSelectedCompanies}
          selectedItemIds={selectedItemIds}
          onChangeItemIds={setSelectedItemIds}
          selectedItemGroup={selectedItemGroup}
          onChangeItemGroup={setSelectedItemGroup}
          title="Filter by Company, Item Group, or Specific Items"
        />

        {/* Section Focus Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">
            View Sections:
          </span>
          {(
            [
              { id: 'all', label: 'All Sections (Complete Report)' },
              { id: 'items', label: `Top Performing Items (${rankingTitleBadge})` },
              { id: 'customers', label: `Top Performing Customers (${rankingTitleBadge})` },
              { id: 'suppliers', label: `Top Performing Suppliers (${rankingTitleBadge})` },
              { id: 'towns', label: `Town-wise Performance (${rankingTitleBadge})` },
              { id: 'areas', label: `Area-wise Performance (${rankingTitleBadge})` },
            ] as Array<{ id: PerformanceSectionFilter; label: string }>
          ).map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                activeSection === sec.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {sec.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 print:hidden">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Report Body */}
      <div ref={printContainerRef} className="space-y-4">
        <PrintDocumentHeader
          title={`TOP PERFORMANCE & OVERALL ${
            analysisMode === 'sales'
              ? 'SALES'
              : analysisMode === 'purchase'
              ? 'PURCHASE'
              : 'SALES & PURCHASE'
          } REPORT (${rankingTitleBadge.toUpperCase()})`}
          subtitle={`${periodInfo.comparisonLabel} • Current: ${periodInfo.currentStart} to ${periodInfo.currentEnd} vs Previous: ${periodInfo.prevStart} to ${periodInfo.prevEnd}`}
          metaItems={[
            { label: 'Ranking', value: rankingTitleBadge },
            { label: 'Current Period', value: `${periodInfo.currentStart} to ${periodInfo.currentEnd}` },
            { label: 'Previous Period', value: `${periodInfo.prevStart} to ${periodInfo.prevEnd}` },
            { label: 'Generated', value: formatPKTDateTime(new Date().toISOString()) },
          ]}
        />

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-400">
            Calculating Top Performance & Period Comparison Analytics...
          </div>
        ) : (
          <>
            {/* 3. OVERALL REPORT SUMMARY CARDS (All 8 Required Metrics) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">Total Sales</div>
                <div className="text-sm font-black font-mono text-emerald-700 mt-1">
                  {formatPKR(summary.totalSales)}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {formatPKR(summary.prevTotalSales)}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Purchases
                </div>
                <div className="text-sm font-black font-mono text-blue-700 mt-1">
                  {formatPKR(summary.totalPurchases)}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {formatPKR(summary.prevTotalPurchases)}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Sales Qty
                </div>
                <div className="text-sm font-black font-mono text-slate-900 mt-1">
                  {fmtQty(summary.totalSalesQty)} Packs
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {fmtQty(summary.prevTotalSalesQty)} Packs
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Purchase Qty
                </div>
                <div className="text-sm font-black font-mono text-slate-900 mt-1">
                  {fmtQty(summary.totalPurchaseQty)} Packs
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {fmtQty(summary.prevTotalPurchaseQty)} Packs
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Sales Invoices
                </div>
                <div className="text-sm font-black font-mono text-slate-900 mt-1">
                  {summary.totalSalesInvoices}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {summary.prevTotalSalesInvoices} Invoices
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Purchase Invoices
                </div>
                <div className="text-sm font-black font-mono text-slate-900 mt-1">
                  {summary.totalPurchaseInvoices}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev: {summary.prevTotalPurchaseInvoices} Bills
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Customers
                </div>
                <div className="text-sm font-black font-mono text-indigo-700 mt-1">
                  {summary.activeCustomers}{' '}
                  <span className="text-[10px] font-normal text-slate-500">
                    / {summary.totalCustomers} Reg.
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev Active: {summary.prevActiveCustomers}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Total Suppliers
                </div>
                <div className="text-sm font-black font-mono text-amber-700 mt-1">
                  {summary.activeSuppliers}{' '}
                  <span className="text-[10px] font-normal text-slate-500">
                    / {summary.totalSuppliers} Reg.
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Prev Active: {summary.prevActiveSuppliers}
                </div>
              </div>
            </div>

            {/* 4. INCREMENT / DECREMENT ANALYSIS SUMMARY TABLE */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
              <div className="p-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                  <span>
                    Increment / Decrement Period Comparison Analysis ({periodInfo.currentStart} to{' '}
                    {periodInfo.currentEnd} vs {periodInfo.prevStart} to {periodInfo.prevEnd})
                  </span>
                </div>
                <span className="text-[10px] font-mono text-emerald-300">
                  Formula: ((Current Period - Previous Period) / Previous Period) × 100
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5 text-right">Previous Period Amount</th>
                      <th className="p-2.5 text-right">Current Period Amount</th>
                      <th className="p-2.5 text-right">Amount Difference</th>
                      <th className="p-2.5 text-right">Increment %</th>
                      <th className="p-2.5 text-right">Decrement %</th>
                      <th className="p-2.5 text-right">Previous Quantity</th>
                      <th className="p-2.5 text-right">Current Quantity</th>
                      <th className="p-2.5 text-right">Quantity Difference</th>
                      <th className="p-2.5 text-right">Qty Growth / Decline %</th>
                      <th className="p-2.5 text-center">Performance Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(analysisMode === 'overall' || analysisMode === 'sales') && (
                      <tr className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-emerald-800">
                          Sales Performance (Net Sales)
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {formatPKR(summary.salesComparison?.previous_amount)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-black text-slate-900">
                          {formatPKR(summary.salesComparison?.current_amount)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.salesComparison?.amount_difference) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.salesComparison?.amount_difference) > 0 ? '+' : ''}
                          {formatPKR(summary.salesComparison?.amount_difference)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                          {Number(summary.salesComparison?.increment_percent) > 0
                            ? `+${fmtPct(summary.salesComparison?.increment_percent)}`
                            : '0.00%'}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-rose-700">
                          {Number(summary.salesComparison?.decrement_percent) > 0
                            ? `-${fmtPct(summary.salesComparison?.decrement_percent)}`
                            : '0.00%'}
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {fmtQty(summary.salesComparison?.previous_qty)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {fmtQty(summary.salesComparison?.current_qty)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.salesComparison?.qty_difference) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.salesComparison?.qty_difference) > 0 ? '+' : ''}
                          {fmtQty(summary.salesComparison?.qty_difference)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.salesComparison?.qty_pct_change) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.salesComparison?.qty_pct_change) > 0 ? '+' : ''}
                          {fmtPct(summary.salesComparison?.qty_pct_change)}
                        </td>
                        <td className="p-2.5 text-center">
                          {renderTrendBadge(
                            summary.salesComparison?.amount_trend,
                            Number(summary.salesComparison?.amount_pct_change || 0)
                          )}
                        </td>
                      </tr>
                    )}

                    {(analysisMode === 'overall' || analysisMode === 'purchase') && (
                      <tr className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-blue-800">
                          Purchase Performance (Net Purchases)
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {formatPKR(summary.purchaseComparison?.previous_amount)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-black text-slate-900">
                          {formatPKR(summary.purchaseComparison?.current_amount)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.purchaseComparison?.amount_difference) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.purchaseComparison?.amount_difference) > 0 ? '+' : ''}
                          {formatPKR(summary.purchaseComparison?.amount_difference)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                          {Number(summary.purchaseComparison?.increment_percent) > 0
                            ? `+${fmtPct(summary.purchaseComparison?.increment_percent)}`
                            : '0.00%'}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-rose-700">
                          {Number(summary.purchaseComparison?.decrement_percent) > 0
                            ? `-${fmtPct(summary.purchaseComparison?.decrement_percent)}`
                            : '0.00%'}
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {fmtQty(summary.purchaseComparison?.previous_qty)}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {fmtQty(summary.purchaseComparison?.current_qty)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.purchaseComparison?.qty_difference) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.purchaseComparison?.qty_difference) > 0 ? '+' : ''}
                          {fmtQty(summary.purchaseComparison?.qty_difference)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-bold ${
                            Number(summary.purchaseComparison?.qty_pct_change) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {Number(summary.purchaseComparison?.qty_pct_change) > 0 ? '+' : ''}
                          {fmtPct(summary.purchaseComparison?.qty_pct_change)}
                        </td>
                        <td className="p-2.5 text-center">
                          {renderTrendBadge(
                            summary.purchaseComparison?.amount_trend,
                            Number(summary.purchaseComparison?.amount_pct_change || 0)
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SECTION A: TOP PERFORMING ITEMS */}
            {(activeSection === 'all' || activeSection === 'items') && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Package className="w-4 h-4 text-emerald-600" />
                    <span>
                      Top Performing Items —{' '}
                      {analysisMode === 'purchase' ? 'Purchase Volume' : 'Sales Volume'} (
                      {rankingTitleBadge})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    Showing {activeItemsRows.length} item(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                        <th className="p-2 text-center">Rank</th>
                        <th className="p-2">Item Code</th>
                        <th className="p-2">Item Name</th>
                        <th className="p-2">Company</th>
                        <th className="p-2">Group / Pack</th>
                        <th className="p-2 text-right">Invoices</th>
                        <th className="p-2 text-right">Prev Qty</th>
                        <th className="p-2 text-right">Curr Qty</th>
                        <th className="p-2 text-right">Qty Diff (%)</th>
                        <th className="p-2 text-right">Prev Amount</th>
                        <th className="p-2 text-right">Curr Amount</th>
                        <th className="p-2 text-right">Amount Diff</th>
                        <th className="p-2 text-right">Increment %</th>
                        <th className="p-2 text-right">Decrement %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {renderPerformanceTableRows(
                        activeItemsRows,
                        analysisMode === 'purchase' ? 'item-purchase' : 'item-sales'
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SECTION B: TOP PERFORMING CUSTOMERS */}
            {(activeSection === 'all' || activeSection === 'customers') &&
              (analysisMode === 'overall' || analysisMode === 'sales') && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Users className="w-4 h-4 text-indigo-600" />
                      <span>Top Performing Customers ({rankingTitleBadge})</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      Showing {(sourceBucket.customers || []).length} customer(s)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                          <th className="p-2 text-center">Rank</th>
                          <th className="p-2">Account Code</th>
                          <th className="p-2">Customer Name</th>
                          <th className="p-2">Town</th>
                          <th className="p-2">Area</th>
                          <th className="p-2 text-right">Invoices</th>
                          <th className="p-2 text-right">Prev Qty</th>
                          <th className="p-2 text-right">Curr Qty</th>
                          <th className="p-2 text-right">Qty Diff (%)</th>
                          <th className="p-2 text-right">Prev Sales</th>
                          <th className="p-2 text-right">Curr Sales</th>
                          <th className="p-2 text-right">Amount Diff</th>
                          <th className="p-2 text-right">Increment %</th>
                          <th className="p-2 text-right">Decrement %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {renderPerformanceTableRows(sourceBucket.customers || [], 'customer')}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* SECTION C: TOP PERFORMING SUPPLIERS */}
            {(activeSection === 'all' || activeSection === 'suppliers') &&
              (analysisMode === 'overall' || analysisMode === 'purchase') && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <ShoppingBag className="w-4 h-4 text-blue-600" />
                      <span>Top Performing Suppliers ({rankingTitleBadge})</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      Showing {(sourceBucket.suppliers || []).length} supplier(s)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                          <th className="p-2 text-center">Rank</th>
                          <th className="p-2">Account Code</th>
                          <th className="p-2">Supplier Name</th>
                          <th className="p-2">Town</th>
                          <th className="p-2">Area</th>
                          <th className="p-2 text-right">Bills</th>
                          <th className="p-2 text-right">Prev Qty</th>
                          <th className="p-2 text-right">Curr Qty</th>
                          <th className="p-2 text-right">Qty Diff (%)</th>
                          <th className="p-2 text-right">Prev Purchases</th>
                          <th className="p-2 text-right">Curr Purchases</th>
                          <th className="p-2 text-right">Amount Diff</th>
                          <th className="p-2 text-right">Increment %</th>
                          <th className="p-2 text-right">Decrement %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {renderPerformanceTableRows(sourceBucket.suppliers || [], 'supplier')}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* SECTION D: TOWN-WISE PERFORMANCE */}
            {(activeSection === 'all' || activeSection === 'towns') && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span>Town-wise Performance ({rankingTitleBadge})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    Showing {(sourceBucket.towns || []).length} town(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                        <th className="p-2 text-center">Rank</th>
                        <th className="p-2">Town Name</th>
                        <th className="p-2 text-right">Customers / Suppliers</th>
                        <th className="p-2 text-right">Invoices</th>
                        <th className="p-2 text-right">Prev Qty</th>
                        <th className="p-2 text-right">Curr Qty</th>
                        <th className="p-2 text-right">Qty Diff (%)</th>
                        <th className="p-2 text-right">Prev Amount</th>
                        <th className="p-2 text-right">Curr Sales</th>
                        <th className="p-2 text-right">Curr Purchases</th>
                        <th className="p-2 text-right">Amount Diff</th>
                        <th className="p-2 text-right">Increment %</th>
                        <th className="p-2 text-right">Decrement %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(sourceBucket.towns || []).length === 0 ? (
                        <tr>
                          <td colSpan={13} className="p-6 text-center text-slate-400">
                            No town performance records found for the selected period.
                          </td>
                        </tr>
                      ) : (
                        (sourceBucket.towns || []).map((t: any) => {
                          const cmp =
                            analysisMode === 'purchase'
                              ? t.purchase_comparison || t
                              : t.sales_comparison || t;
                          return (
                            <tr key={`town-${t.rank}-${t.town_name}`} className="hover:bg-slate-50">
                              <td className="p-2 text-center font-mono font-bold">#{t.rank}</td>
                              <td className="p-2 font-bold text-slate-900">{t.town_name}</td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {t.customer_count} C / {t.supplier_count} S
                              </td>
                              <td className="p-2 text-right font-mono">{cmp.current_invoices}</td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {fmtQty(cmp.previous_qty)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold">
                                {fmtQty(cmp.current_qty)}
                              </td>
                              <td
                                className={`p-2 text-right font-mono font-bold ${
                                  Number(cmp.qty_difference) >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {Number(cmp.qty_difference) > 0 ? '+' : ''}
                                {fmtQty(cmp.qty_difference)} ({Number(cmp.qty_pct_change) > 0 ? '+' : ''}
                                {fmtPct(cmp.qty_pct_change)})
                              </td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {formatPKR(cmp.previous_amount)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                {formatPKR(t.net_sales)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-blue-700">
                                {formatPKR(t.net_purchases)}
                              </td>
                              <td
                                className={`p-2 text-right font-mono font-bold ${
                                  Number(cmp.amount_difference) >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {Number(cmp.amount_difference) > 0 ? '+' : ''}
                                {formatPKR(cmp.amount_difference)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                {Number(cmp.increment_percent) > 0
                                  ? `+${fmtPct(cmp.increment_percent)}`
                                  : '0.00%'}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-rose-700">
                                {Number(cmp.decrement_percent) > 0
                                  ? `-${fmtPct(cmp.decrement_percent)}`
                                  : '0.00%'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SECTION E: AREA-WISE PERFORMANCE */}
            {(activeSection === 'all' || activeSection === 'areas') && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <MapPin className="w-4 h-4 text-indigo-600" />
                    <span>Area-wise Performance ({rankingTitleBadge})</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    Showing {(sourceBucket.areas || []).length} area(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                        <th className="p-2 text-center">Rank</th>
                        <th className="p-2">Area Name</th>
                        <th className="p-2">Town</th>
                        <th className="p-2 text-right">Customers / Suppliers</th>
                        <th className="p-2 text-right">Invoices</th>
                        <th className="p-2 text-right">Prev Qty</th>
                        <th className="p-2 text-right">Curr Qty</th>
                        <th className="p-2 text-right">Qty Diff (%)</th>
                        <th className="p-2 text-right">Prev Amount</th>
                        <th className="p-2 text-right">Curr Sales</th>
                        <th className="p-2 text-right">Curr Purchases</th>
                        <th className="p-2 text-right">Amount Diff</th>
                        <th className="p-2 text-right">Increment %</th>
                        <th className="p-2 text-right">Decrement %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(sourceBucket.areas || []).length === 0 ? (
                        <tr>
                          <td colSpan={14} className="p-6 text-center text-slate-400">
                            No area performance records found for the selected period.
                          </td>
                        </tr>
                      ) : (
                        (sourceBucket.areas || []).map((a: any) => {
                          const cmp =
                            analysisMode === 'purchase'
                              ? a.purchase_comparison || a
                              : a.sales_comparison || a;
                          return (
                            <tr
                              key={`area-${a.rank}-${a.town_name}-${a.area_name}`}
                              className="hover:bg-slate-50"
                            >
                              <td className="p-2 text-center font-mono font-bold">#{a.rank}</td>
                              <td className="p-2 font-bold text-slate-900">{a.area_name}</td>
                              <td className="p-2 text-slate-700">{a.town_name}</td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {a.customer_count} C / {a.supplier_count} S
                              </td>
                              <td className="p-2 text-right font-mono">{cmp.current_invoices}</td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {fmtQty(cmp.previous_qty)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold">
                                {fmtQty(cmp.current_qty)}
                              </td>
                              <td
                                className={`p-2 text-right font-mono font-bold ${
                                  Number(cmp.qty_difference) >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {Number(cmp.qty_difference) > 0 ? '+' : ''}
                                {fmtQty(cmp.qty_difference)} ({Number(cmp.qty_pct_change) > 0 ? '+' : ''}
                                {fmtPct(cmp.qty_pct_change)})
                              </td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                {formatPKR(cmp.previous_amount)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                {formatPKR(a.net_sales)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-blue-700">
                                {formatPKR(a.net_purchases)}
                              </td>
                              <td
                                className={`p-2 text-right font-mono font-bold ${
                                  Number(cmp.amount_difference) >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {Number(cmp.amount_difference) > 0 ? '+' : ''}
                                {formatPKR(cmp.amount_difference)}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                {Number(cmp.increment_percent) > 0
                                  ? `+${fmtPct(cmp.increment_percent)}`
                                  : '0.00%'}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-rose-700">
                                {Number(cmp.decrement_percent) > 0
                                  ? `-${fmtPct(cmp.decrement_percent)}`
                                  : '0.00%'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* A4 Print Preview Modal */}
      {showPrintPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">
                  A4 Print Preview — Top Performance & Overall Report ({rankingTitleBadge})
                </h4>
                <p className="text-[11px] text-slate-300">
                  {periodInfo.comparisonLabel} ({periodInfo.currentStart} to {periodInfo.currentEnd})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Now (A4)
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintPreview(false)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto bg-slate-100 flex-1">
              <div
                className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-5xl mx-auto space-y-4"
                dangerouslySetInnerHTML={{
                  __html: printContainerRef.current?.innerHTML || '',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
