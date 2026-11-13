import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShoppingCart,
  ShoppingBag,
  TrendingUp,
  Calendar,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Package,
  AlertTriangle,
  Clock,
  RefreshCw,
  BarChart3,
  PieChart,
  Users,
  FileText,
  ArrowRight,
  Filter,
  Building2,
  Layers,
  Award,
  Activity,
} from 'lucide-react';
import { NavTabId } from '../layout/Sidebar';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';

interface DashboardViewProps {
  onSelectTab: (tab: NavTabId) => void;
}

type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

type SalesChartMode = 'daily' | 'weekly' | 'monthly' | 'yearly';
type ProfitChartMode = 'daily' | 'monthly' | 'byAccount' | 'byItem';

function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computePresetRange(preset: DatePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const today = toIsoDate(now);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const yIso = toIsoDate(y);
      return { startDate: yIso, endDate: yIso };
    }
    case 'this_week': {
      const start = new Date(now);
      const dayOfWeek = start.getDay(); // 0 = Sun
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
      start.setDate(now.getDate() - diff);
      return { startDate: toIsoDate(start), endDate: today };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toIsoDate(start), endDate: today };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
    }
    case 'this_year': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: toIsoDate(start), endDate: today };
    }
    default:
      return {
        startDate: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
        endDate: today,
      };
  }
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onSelectTab }) => {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const initialRange = useMemo(() => computePresetRange('this_month'), []);
  const [startDate, setStartDate] = useState<string>(initialRange.startDate);
  const [endDate, setEndDate] = useState<string>(initialRange.endDate);

  const [salesMode, setSalesMode] = useState<SalesChartMode>('daily');
  const [profitMode, setProfitMode] = useState<ProfitChartMode>('daily');

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (start: string, end: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getDashboardAnalytics({ startDate: start, endDate: end });
      setData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(startDate, endDate);
  }, [fetchAnalytics, startDate, endDate]);

  const handleSelectPreset = (nextPreset: DatePreset) => {
    setPreset(nextPreset);
    if (nextPreset !== 'custom') {
      const range = computePresetRange(nextPreset);
      setStartDate(range.startDate);
      setEndDate(range.endDate);
    }
  };

  const cards = data?.summaryCards || {
    todaySales: 0,
    todaySalesCount: 0,
    periodSales: 0,
    periodSalesCount: 0,
    todayPurchases: 0,
    todayPurchasesCount: 0,
    periodPurchases: 0,
    periodPurchasesCount: 0,
    todayGrossProfit: 0,
    periodGrossProfit: 0,
    periodNetRevenue: 0,
    periodCostOfGoods: 0,
    monthlySales: 0,
    monthlySalesCount: 0,
    monthlyPurchases: 0,
    monthlyPurchasesCount: 0,
    totalReceivables: 0,
    receivablesCustomerCount: 0,
    totalPayables: 0,
    payablesSupplierCount: 0,
    cashInHand: 0,
    bankBalance: 0,
    totalItems: 0,
    lowStockItemsCount: 0,
    nearExpiryItemsCount: 0,
  };

  const salesSeries: Array<{ label: string; sales: number; count: number }> =
    data?.salesGraph?.[salesMode] || [];

  const purchaseVsSalesSeries: Array<{
    label: string;
    sales: number;
    purchases: number;
    netDifference: number;
  }> = data?.purchaseVsSales || [];

  const profitSeries: Array<{
    label: string;
    revenue: number;
    cost: number;
    grossProfit: number;
    marginPercent: number;
    accountCode?: string;
    itemCode?: string;
    netUnitsSold?: number;
    invoiceCount?: number;
  }> = data?.profitAnalysis?.[profitMode] || [];

  const tables = data?.tables || {
    topSellingItems: [],
    slowMovingItems: [],
    recentSales: [],
    recentPurchases: [],
    lowStockItems: [],
    nearExpiryItems: [],
    topCustomers: [],
    outstandingCustomers: [],
  };

  // Summary Cards configuration (11 Required Cards)
  const summaryCardsList = [
    {
      id: 'today-sales',
      title: "Today's Sales",
      value: formatPKR(cards.todaySales),
      subLabel: `Period Sales: ${formatPKR(cards.periodSales)} (${cards.periodSalesCount} inv)`,
      badge: `${cards.todaySalesCount} Today`,
      icon: ShoppingCart,
      accent: 'border-l-emerald-600',
      iconBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      targetTab: 'sales-register' as NavTabId,
    },
    {
      id: 'today-purchases',
      title: "Today's Purchases",
      value: formatPKR(cards.todayPurchases),
      subLabel: `Period Purchases: ${formatPKR(cards.periodPurchases)} (${cards.periodPurchasesCount} bills)`,
      badge: `${cards.todayPurchasesCount} Today`,
      icon: ShoppingBag,
      accent: 'border-l-blue-600',
      iconBg: 'bg-blue-50 text-blue-700 border-blue-200',
      targetTab: 'purchase-history' as NavTabId,
    },
    {
      id: 'today-profit',
      title: "Today's Gross Profit",
      value: formatPKR(cards.todayGrossProfit),
      subLabel: `Period Profit: ${formatPKR(cards.periodGrossProfit)}`,
      badge: 'Actual COGS',
      icon: TrendingUp,
      accent: cards.todayGrossProfit >= 0 ? 'border-l-teal-600' : 'border-l-rose-600',
      iconBg:
        cards.todayGrossProfit >= 0
          ? 'bg-teal-50 text-teal-700 border-teal-200'
          : 'bg-rose-50 text-rose-700 border-rose-200',
      targetTab: 'sales-profit-report' as NavTabId,
    },
    {
      id: 'monthly-sales',
      title: 'Monthly Sales',
      value: formatPKR(cards.monthlySales),
      subLabel: `${cards.monthlySalesCount} Confirmed Invoices This Month`,
      badge: 'This Month',
      icon: Calendar,
      accent: 'border-l-indigo-600',
      iconBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      targetTab: 'sales-reports' as NavTabId,
    },
    {
      id: 'monthly-purchases',
      title: 'Monthly Purchases',
      value: formatPKR(cards.monthlyPurchases),
      subLabel: `${cards.monthlyPurchasesCount} Supplier Bills This Month`,
      badge: 'This Month',
      icon: Building2,
      accent: 'border-l-cyan-600',
      iconBg: 'bg-cyan-50 text-cyan-700 border-cyan-200',
      targetTab: 'purchase-reports' as NavTabId,
    },
    {
      id: 'total-receivables',
      title: 'Total Receivables',
      value: formatPKR(cards.totalReceivables),
      subLabel: `${cards.receivablesCustomerCount} Customer Accounts (Dr)`,
      badge: 'Receivable',
      icon: ArrowDownLeft,
      accent: 'border-l-amber-500',
      iconBg: 'bg-amber-50 text-amber-700 border-amber-200',
      targetTab: 'aging-receivables' as NavTabId,
    },
    {
      id: 'total-payables',
      title: 'Total Payables',
      value: formatPKR(cards.totalPayables),
      subLabel: `${cards.payablesSupplierCount} Supplier Accounts (Cr)`,
      badge: 'Payable',
      icon: ArrowUpRight,
      accent: 'border-l-rose-500',
      iconBg: 'bg-rose-50 text-rose-700 border-rose-200',
      targetTab: 'aging-payables' as NavTabId,
    },
    {
      id: 'cash-in-hand',
      title: 'Cash in Hand',
      value: formatPKR(cards.cashInHand),
      subLabel: `Bank Balance: ${formatPKR(cards.bankBalance)}`,
      badge: 'Live Ledger',
      icon: Wallet,
      accent: 'border-l-emerald-500',
      iconBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      targetTab: 'cash-book-unified' as NavTabId,
    },
    {
      id: 'total-items',
      title: 'Total Items',
      value: cards.totalItems.toLocaleString(),
      subLabel: 'Active Medicines in Catalog',
      badge: 'Catalog',
      icon: Package,
      accent: 'border-l-slate-700',
      iconBg: 'bg-slate-100 text-slate-700 border-slate-300',
      targetTab: 'items-master' as NavTabId,
    },
    {
      id: 'low-stock',
      title: 'Low Stock Items',
      value: cards.lowStockItemsCount.toLocaleString(),
      subLabel: 'At or Below Reorder Threshold',
      badge: cards.lowStockItemsCount > 0 ? 'Reorder Due' : 'Healthy',
      icon: AlertTriangle,
      accent: cards.lowStockItemsCount > 0 ? 'border-l-orange-500' : 'border-l-emerald-500',
      iconBg:
        cards.lowStockItemsCount > 0
          ? 'bg-orange-50 text-orange-700 border-orange-200'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      targetTab: 'low-stock' as NavTabId,
    },
    {
      id: 'near-expiry',
      title: 'Near Expiry Items',
      value: cards.nearExpiryItemsCount.toLocaleString(),
      subLabel: 'Batches Expiring Within 90 Days',
      badge: cards.nearExpiryItemsCount > 0 ? '90d Alert' : 'Clear',
      icon: Clock,
      accent: cards.nearExpiryItemsCount > 0 ? 'border-l-red-600' : 'border-l-emerald-500',
      iconBg:
        cards.nearExpiryItemsCount > 0
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200',
      targetTab: 'near-expiry' as NavTabId,
    },
  ];

  // Max value calculations for responsive SVG/Bar charts
  const maxSalesVal = useMemo(
    () => Math.max(1, ...salesSeries.map((s) => Number(s.sales || 0))),
    [salesSeries]
  );

  const maxPvSVal = useMemo(
    () =>
      Math.max(
        1,
        ...purchaseVsSalesSeries.map((r) => Math.max(Number(r.sales || 0), Number(r.purchases || 0)))
      ),
    [purchaseVsSalesSeries]
  );

  const maxProfitVal = useMemo(
    () =>
      Math.max(
        1,
        ...profitSeries.map((r) =>
          Math.max(Math.abs(Number(r.revenue || 0)), Math.abs(Number(r.grossProfit || 0)))
        )
      ),
    [profitSeries]
  );

  return (
    <div className="space-y-5 pb-10">
      {/* Top Executive Command & Date Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-xs flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                ABRAR MEDICAL STORE — EXECUTIVE ANALYTICS & FINANCIAL DASHBOARD
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
                Live Production Data
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing verified double-entry accounting, actual COGS profit, and batch inventory metrics from{' '}
              <span className="font-mono font-semibold text-slate-700">{startDate}</span> to{' '}
              <span className="font-mono font-semibold text-slate-700">{endDate}</span>
            </p>
          </div>
        </div>

        {/* Date Range Presets & Custom Pickers */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200/80 gap-0.5">
            {(
              [
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'this_week', label: 'This Week' },
                { id: 'this_month', label: 'This Month' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'this_year', label: 'This Year' },
                { id: 'custom', label: 'Custom' },
              ] as Array<{ id: DatePreset; label: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleSelectPreset(btn.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  preset === btn.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setPreset('custom');
                setStartDate(e.target.value);
              }}
              className="text-xs font-mono text-slate-700 bg-transparent focus:outline-none"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setPreset('custom');
                setEndDate(e.target.value);
              }}
              className="text-xs font-mono text-slate-700 bg-transparent focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => fetchAnalytics(startDate, endDate)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Quick Action Bar for Common Operations */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => onSelectTab('sales-pos')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            New Sales Invoice
          </span>
          <ArrowRight className="w-3.5 h-3.5 opacity-80" />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('purchases-bill')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-sky-400" />
            New Purchase Bill
          </span>
          <ArrowRight className="w-3.5 h-3.5 opacity-80" />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('cash-book-unified')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            Cash Book Entry
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('items-master')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            Item Master
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('party-ledger')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-600" />
            Party Ledgers
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('sales-profit-report')}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-600" />
            Profit Reports
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center justify-between">
          <span>Error loading dashboard analytics: {error}</span>
          <button
            type="button"
            onClick={() => fetchAnalytics(startDate, endDate)}
            className="px-2.5 py-1 rounded bg-rose-600 text-white font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* A. 11 SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {summaryCardsList.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelectTab(card.targetTab)}
              className={`bg-white rounded-xl border border-slate-200/90 border-l-4 ${card.accent} p-3.5 text-left shadow-xs hover:shadow-md hover:border-slate-300 transition-all group cursor-pointer flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    {card.title}
                  </span>
                  <div className="text-lg font-extrabold text-slate-900 font-mono mt-1 tracking-tight">
                    {card.value}
                  </div>
                </div>
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${card.iconBg}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-slate-500 truncate pr-2">{card.subLabel}</span>
                <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded group-hover:bg-slate-900 group-hover:text-white transition-colors shrink-0">
                  {card.badge} →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* B & C: INTERACTIVE SALES GRAPH + PURCHASE VS SALES COMPARISON GRAPH */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* B. Interactive Sales Graph */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Interactive Sales Performance</h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Confirmed sales revenue breakdown ({salesMode.toUpperCase()})
              </p>
            </div>
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {(
                [
                  { id: 'daily', label: 'Daily' },
                  { id: 'weekly', label: 'Weekly' },
                  { id: 'monthly', label: 'Monthly' },
                  { id: 'yearly', label: 'Yearly' },
                ] as Array<{ id: SalesChartMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSalesMode(m.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                    salesMode === m.id
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 flex-1 flex flex-col justify-between min-h-[260px]">
            {salesSeries.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs py-12">
                <BarChart3 className="w-8 h-8 mb-2 stroke-1" />
                <span>No confirmed sales recorded in this period.</span>
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {salesSeries.map((item) => {
                    const pct = Math.max(3, Math.round((Number(item.sales || 0) / maxSalesVal) * 100));
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-semibold text-slate-700">{item.label}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-slate-400">{item.count} inv</span>
                            <span className="font-mono font-bold text-slate-900">
                              {formatPKR(item.sales)}
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">
                    Series Total ({salesSeries.length} periods)
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {formatPKR(salesSeries.reduce((acc, r) => acc + Number(r.sales || 0), 0))}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* C. Purchase vs Sales Comparison Graph */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Purchase vs Sales Comparison</h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Total Sales vs Total Purchases across selected date range ({startDate} to {endDate})
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1.5 text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                Sales: {formatPKR(cards.periodSales)}
              </span>
              <span className="flex items-center gap-1.5 text-blue-700">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Purchases: {formatPKR(cards.periodPurchases)}
              </span>
            </div>
          </div>

          <div className="p-4 flex-1 flex flex-col justify-between min-h-[260px]">
            {purchaseVsSalesSeries.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs py-12">
                <Layers className="w-8 h-8 mb-2 stroke-1" />
                <span>No sales or purchase activity found in the selected date range.</span>
              </div>
            ) : (
              <>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {purchaseVsSalesSeries.map((row) => {
                    const salesPct =
                      row.sales > 0 ? Math.max(3, Math.round((row.sales / maxPvSVal) * 100)) : 0;
                    const purchPct =
                      row.purchases > 0
                        ? Math.max(3, Math.round((row.purchases / maxPvSVal) * 100))
                        : 0;
                    return (
                      <div
                        key={row.label}
                        className="p-2 rounded-lg bg-slate-50/70 border border-slate-100 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-slate-700">{row.label}</span>
                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            <span className="text-emerald-700 font-semibold">
                              S: {formatPKR(row.sales)}
                            </span>
                            <span className="text-blue-700 font-semibold">
                              P: {formatPKR(row.purchases)}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-600 rounded-full"
                              style={{ width: `${salesPct}%` }}
                            />
                          </div>
                          <div className="w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full"
                              style={{ width: `${purchPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Net Sales vs Purchase Spread</span>
                  <span
                    className={`font-mono font-bold ${
                      cards.periodSales - cards.periodPurchases >= 0
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {formatPKR(cards.periodSales - cards.periodPurchases)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* D. ACTUAL PROFIT ANALYSIS GRAPH & BREAKDOWN */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-teal-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Verified Gross Profit Analysis (Actual Purchase Cost vs Net Sales Revenue)
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Calculated strictly from actual item batch cost price, net taxable sales, discounts, and returns — zero estimated figures
            </p>
          </div>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            {(
              [
                { id: 'daily', label: 'Daily Gross Profit' },
                { id: 'monthly', label: 'Monthly Gross Profit' },
                { id: 'byAccount', label: 'Account-wise Profit' },
                { id: 'byItem', label: 'Item-wise Profit' },
              ] as Array<{ id: ProfitChartMode; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setProfitMode(m.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  profitMode === m.id
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          {/* Period Profit KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase text-slate-500">
                Period Net Sales Revenue
              </span>
              <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                {formatPKR(cards.periodNetRevenue)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase text-slate-500">
                Actual Cost of Goods Sold (COGS)
              </span>
              <div className="text-sm font-bold font-mono text-slate-700 mt-0.5">
                {formatPKR(cards.periodCostOfGoods)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-200">
              <span className="text-[10px] font-bold uppercase text-teal-700">
                Verified Period Gross Profit
              </span>
              <div className="text-sm font-extrabold font-mono text-teal-800 mt-0.5">
                {formatPKR(cards.periodGrossProfit)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase text-slate-500">
                Actual Gross Margin %
              </span>
              <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                {cards.periodNetRevenue > 0
                  ? `${((cards.periodGrossProfit / cards.periodNetRevenue) * 100).toFixed(2)}%`
                  : '0.00%'}
              </div>
            </div>
          </div>

          {profitSeries.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No profit records found for the selected filter period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-2 px-3">
                      {profitMode === 'byAccount'
                        ? 'Customer / Account'
                        : profitMode === 'byItem'
                        ? 'Medicine / Item'
                        : 'Period'}
                    </th>
                    <th className="py-2 px-3 text-right">Net Revenue</th>
                    <th className="py-2 px-3 text-right">Actual Purchase Cost</th>
                    <th className="py-2 px-3 text-right">Gross Profit</th>
                    <th className="py-2 px-3 text-right">Margin %</th>
                    <th className="py-2 px-3 w-48">Profit Bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profitSeries.map((row, idx) => {
                    const barPct = Math.max(
                      3,
                      Math.min(100, Math.round((Math.abs(row.grossProfit) / maxProfitVal) * 100))
                    );
                    return (
                      <tr key={`${row.label}-${idx}`} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-800">
                          <div className="flex items-center gap-2">
                            {(row.accountCode || row.itemCode) && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {row.accountCode || row.itemCode}
                              </span>
                            )}
                            <span>{row.label}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700">
                          {formatPKR(row.revenue)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatPKR(row.cost)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-bold ${
                            row.grossProfit >= 0 ? 'text-teal-700' : 'text-rose-600'
                          }`}
                        >
                          {formatPKR(row.grossProfit)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {row.marginPercent}%
                        </td>
                        <td className="py-2 px-3">
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                row.grossProfit >= 0 ? 'bg-teal-600' : 'bg-rose-500'
                              }`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* E. 8 ADDITIONAL OPERATIONAL DASHBOARD SECTIONS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* 1. Top 10 Selling Items */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                1. Top 10 Selling Items ({startDate} to {endDate})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectTab('top-performance-reports')}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer"
              >
                Top Performance →
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => onSelectTab('sales-item-wise')}
                className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
              >
                Item Sales →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Item</th>
                  <th className="py-2 px-3 text-right">Units Sold</th>
                  <th className="py-2 px-3 text-right">Net Sales</th>
                  <th className="py-2 px-3 text-right">Gross Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.topSellingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No item sales in selected period.
                    </td>
                  </tr>
                ) : (
                  tables.topSellingItems.map((item: any) => (
                    <tr key={item.itemId} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-800">{item.itemName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.itemCode} {item.companyName ? `• ${item.companyName}` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-slate-700">
                        {item.unitsSold}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPKR(item.netRevenue)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-teal-700">
                        {formatPKR(item.grossProfit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 2. Slow Moving Items */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                2. Slow Moving Items (In-Stock with Lowest Movement)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('stock-datasheet')}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
            >
              Item Stock →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Item</th>
                  <th className="py-2 px-3 text-right">Current Stock</th>
                  <th className="py-2 px-3 text-right">Sold in Period</th>
                  <th className="py-2 px-3 text-right">Last Sold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.slowMovingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No stocked items found.
                    </td>
                  </tr>
                ) : (
                  tables.slowMovingItems.map((item: any) => (
                    <tr key={item.itemId} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-800">{item.itemName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.itemCode} {item.companyName ? `• ${item.companyName}` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                        {item.stockUnits} units
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-amber-700 font-semibold">
                        {item.unitsSoldInPeriod} units
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">
                        {item.lastSoldDate || 'No sales'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Recent Sales Invoices */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                3. Recent Sales Invoices
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('sales-register')}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
            >
              Sales History →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Invoice #</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3 text-right">Net Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No sales invoices recorded yet.
                    </td>
                  </tr>
                ) : (
                  tables.recentSales.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{inv.invoiceDate}</td>
                      <td className="py-2 px-3 font-medium text-slate-800">{inv.customerName}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPKR(inv.netTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Recent Purchase Invoices */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                4. Recent Purchase Invoices
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('purchase-history')}
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              Purchase History →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Bill #</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Supplier</th>
                  <th className="py-2 px-3 text-right">Net Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.recentPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No purchase bills recorded yet.
                    </td>
                  </tr>
                ) : (
                  tables.recentPurchases.map((bill: any) => (
                    <tr key={bill.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-bold text-blue-700">
                        {bill.billNumber}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{bill.billDate}</td>
                      <td className="py-2 px-3 font-medium text-slate-800">{bill.supplierName}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPKR(bill.netTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Low Stock Items */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                5. Low Stock Items (Reorder Alert)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('low-stock')}
              className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 cursor-pointer"
            >
              Low Stock Report →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Medicine</th>
                  <th className="py-2 px-3 text-right">Current Stock</th>
                  <th className="py-2 px-3 text-right">Reorder Level</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.lowStockItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      All active items are above reorder levels.
                    </td>
                  </tr>
                ) : (
                  tables.lowStockItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-800">{item.item_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.item_code} {item.company_name ? `• ${item.company_name}` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-rose-600">
                        {item.current_stock_units}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600">
                        {item.reorder_level}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.current_stock_units <= 0
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.current_stock_units <= 0 ? 'Out of Stock' : 'Low Stock'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 6. Near Expiry Items */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-rose-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                6. Near Expiry Items (Within 90 Days)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('near-expiry')}
              className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
            >
              Expiry Report →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Medicine / Batch</th>
                  <th className="py-2 px-3">Expiry Date</th>
                  <th className="py-2 px-3 text-right">Stock Units</th>
                  <th className="py-2 px-3 text-right">Days Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.nearExpiryItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No batches expiring within the next 90 days.
                    </td>
                  </tr>
                ) : (
                  tables.nearExpiryItems.map((batch: any) => (
                    <tr key={batch.batch_id} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-800">{batch.item_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Batch: {batch.batch_number}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700">{batch.expiry_date}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800">
                        {batch.total_stock_units}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                            batch.days_remaining < 0
                              ? 'bg-rose-100 text-rose-800'
                              : batch.days_remaining <= 30
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {batch.days_remaining < 0
                            ? `Expired (${Math.abs(batch.days_remaining)}d)`
                            : `${batch.days_remaining}d`}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 7. Top Customers */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                7. Top Customers ({startDate} to {endDate})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectTab('top-performance-reports')}
                className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 cursor-pointer"
              >
                Top Performance →
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => onSelectTab('sales-customer-wise')}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
              >
                Customer Sales →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3 text-right">Invoices</th>
                  <th className="py-2 px-3 text-right">Total Sales</th>
                  <th className="py-2 px-3 text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.topCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No customer sales in selected period.
                    </td>
                  </tr>
                ) : (
                  tables.topCustomers.map((cust: any, i: number) => (
                    <tr key={`${cust.accountId}-${i}`} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-800">{cust.customerName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {cust.accountCode}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600">
                        {cust.invoiceCount}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPKR(cust.totalSales)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-700">
                        {formatPKR(cust.totalPaid)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 8. Outstanding Customer Balances */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                8. Outstanding Customer Balances (Receivables)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('aging-receivables')}
              className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer"
            >
              Customer Outstanding →
            </button>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-3">Account Code</th>
                  <th className="py-2 px-3">Customer Name</th>
                  <th className="py-2 px-3">City / Contact</th>
                  <th className="py-2 px-3 text-right">Receivable Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.outstandingCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      No outstanding customer receivables.
                    </td>
                  </tr>
                ) : (
                  tables.outstandingCustomers.map((c: any) => (
                    <tr key={c.accountId} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-slate-600">{c.accountCode}</td>
                      <td className="py-2 px-3 font-semibold text-slate-800">{c.customerName}</td>
                      <td className="py-2 px-3 text-slate-500">
                        {c.city || c.mobile || c.phone || '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-amber-700">
                        {formatPKR(c.outstandingBalance)} Dr
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
