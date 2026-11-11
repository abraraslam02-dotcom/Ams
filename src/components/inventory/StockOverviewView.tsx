import React, { useState, useEffect } from 'react';
import {
  Boxes,
  TrendingUp,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldAlert,
  Layers,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  PlusCircle,
  Sliders,
  DollarSign,
  Package,
} from 'lucide-react';
import { api } from '../../services/api';
import { InventoryOverview } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';

interface StockOverviewViewProps {
  onNavigateSubTab: (subTabId: string) => void;
}

export const StockOverviewView: React.FC<StockOverviewViewProps> = ({
  onNavigateSubTab,
}) => {
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getInventoryOverview();
      setOverview(res.overview);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inventory overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  return (
    <div className="space-y-4 font-sans">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-lg p-3.5 shadow-xs">
        <div>
          <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Boxes className="w-5 h-5 text-emerald-400" />
            <span>Inventory Management &amp; Stock Control Center</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated stock accounting, weighted average costing, batch tracking, and pharmaceutical expiry controls
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateSubTab('inv-adjustment')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Stock Adjustment</span>
          </button>
          <button
            onClick={() => onNavigateSubTab('inv-verification')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Audit Count</span>
          </button>
          <button
            onClick={fetchOverview}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            title="Refresh metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Valuation (Cost) */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 relative overflow-hidden shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Inventory Cost Value
            </span>
            <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-xl font-black text-white font-mono tracking-tight">
            {formatPKR(overview?.total_cost_valuation || 0)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Weighted Average Valuation</span>
            <span className="text-emerald-400 font-semibold">Active Asset</span>
          </div>
        </div>

        {/* Total Retail Valuation & Margin */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 relative overflow-hidden shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Retail Potential Value
            </span>
            <span className="p-1.5 bg-teal-500/10 text-teal-400 rounded">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-xl font-black text-teal-300 font-mono tracking-tight">
            {formatPKR(overview?.total_retail_valuation || 0)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Gross Profit Buffer:</span>
            <span className="text-indigo-300 font-mono font-bold">
              {formatPKR(overview?.potential_margin_value || 0)}
            </span>
          </div>
        </div>

        {/* Physical Stock Volume */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 relative overflow-hidden shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Stock Volume on Hand
            </span>
            <span className="p-1.5 bg-sky-500/10 text-sky-400 rounded">
              <Boxes className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-xl font-black text-white font-mono tracking-tight">
            {(overview?.total_packs_in_stock || 0).toLocaleString()}{' '}
            <span className="text-xs text-slate-400 font-normal">Packs</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Loose Units:</span>
            <span className="text-sky-300 font-mono font-bold">
              {(overview?.total_units_in_stock || 0).toLocaleString()} Units
            </span>
          </div>
        </div>

        {/* Active Batches & SKUs */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 relative overflow-hidden shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Batches &amp; SKUs
            </span>
            <span className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-xl font-black text-white font-mono tracking-tight">
            {overview?.active_batches || 0}{' '}
            <span className="text-xs text-slate-400 font-normal">Batches</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Catalog Items Tracked:</span>
            <span className="text-indigo-300 font-mono font-bold">
              {overview?.total_items || 0} Items
            </span>
          </div>
        </div>
      </div>

      {/* Critical Stock Alert Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Expired Items Alert */}
        <div
          onClick={() => onNavigateSubTab('inv-expired')}
          className="bg-slate-900 border border-rose-900/60 hover:border-rose-700 rounded-lg p-3.5 cursor-pointer transition-all shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-rose-500/20 text-rose-400 rounded">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-rose-300 uppercase tracking-wide">
                Already Expired Stock
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-rose-400 transition-colors" />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-400 font-mono">
            {overview?.expired_count || 0}{' '}
            <span className="text-xs text-slate-400 font-normal">Batches</span>
          </div>
          <p className="mt-1 text-[11px] text-rose-300/80">
            Strict Policy: POS prevents selling expired batches. Click to view quarantine list.
          </p>
        </div>

        {/* Near Expiry Alert */}
        <div
          onClick={() => onNavigateSubTab('inv-near-expiry')}
          className="bg-slate-900 border border-amber-900/60 hover:border-amber-700 rounded-lg p-3.5 cursor-pointer transition-all shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-amber-500/20 text-amber-400 rounded">
                <Clock className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                Near Expiry (&le; {overview?.near_expiry_days_setting || 90} Days)
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-400 font-mono">
            {overview?.near_expiry_count || 0}{' '}
            <span className="text-xs text-slate-400 font-normal">Batches</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-300/80">
            Prioritize dispensing via FEFO (First-Expired-First-Out) or return to supplier.
          </p>
        </div>

        {/* Low Stock & Out of Stock Alert */}
        <div
          onClick={() => onNavigateSubTab('inv-low-stock')}
          className="bg-slate-900 border border-orange-900/60 hover:border-orange-700 rounded-lg p-3.5 cursor-pointer transition-all shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-orange-500/20 text-orange-400 rounded">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-orange-300 uppercase tracking-wide">
                Reorder Deficit &amp; Low Stock
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-orange-400 transition-colors" />
          </div>
          <div className="mt-2 text-2xl font-black text-orange-400 font-mono">
            {(overview?.low_stock_count || 0) + (overview?.out_of_stock_count || 0)}{' '}
            <span className="text-xs text-slate-400 font-normal">Items Deficit</span>
          </div>
          <p className="mt-1 text-[11px] text-orange-300/80">
            {overview?.out_of_stock_count || 0} completely out of stock. Click to plan PO replenishment.
          </p>
        </div>
      </div>

      {/* Quick Navigation Quick Links Hub */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
          Inventory Modules &amp; Analytical Control
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
          <button
            onClick={() => onNavigateSubTab('inv-datasheet')}
            className="p-3 bg-slate-800/80 hover:bg-slate-800 text-left rounded border border-slate-700 hover:border-emerald-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white group-hover:text-emerald-400">Stock Datasheet</span>
              <FileSpreadsheet className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              18-column Excel-style master ledger with full transaction math breakdown.
            </p>
          </button>

          <button
            onClick={() => onNavigateSubTab('inv-current')}
            className="p-3 bg-slate-800/80 hover:bg-slate-800 text-left rounded border border-slate-700 hover:border-emerald-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white group-hover:text-emerald-400">Current Stock</span>
              <Boxes className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Consolidated item-level inventory summaries with batch counts and pack breakdowns.
            </p>
          </button>

          <button
            onClick={() => onNavigateSubTab('inv-ledger')}
            className="p-3 bg-slate-800/80 hover:bg-slate-800 text-left rounded border border-slate-700 hover:border-emerald-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white group-hover:text-emerald-400">Stock Ledger</span>
              <Clock className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Item-wise chronological audit card with running balance and transaction links.
            </p>
          </button>

          <button
            onClick={() => onNavigateSubTab('inv-verification')}
            className="p-3 bg-slate-800/80 hover:bg-slate-800 text-left rounded border border-slate-700 hover:border-emerald-600 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white group-hover:text-emerald-400">Physical Stock Count</span>
              <CheckCircle2 className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Blind count sheets, variance audit comparison, and authorized GL reconciliation.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
