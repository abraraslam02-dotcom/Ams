import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  ShieldAlert,
  AlertTriangle,
  Download,
  RefreshCw,
  Sliders,
  CheckCircle2,
  Package,
  Layers,
  Calendar,
  X,
  Filter,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { ExpiryAlertItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface ExpiryManagementViewProps {
  initialFilter?: 'ALL' | 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS';
}

export const ExpiryManagementView: React.FC<ExpiryManagementViewProps> = ({
  initialFilter = 'ALL',
}) => {
  const [data, setData] = useState<ExpiryAlertItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const expiryPrintRef = useRef<HTMLDivElement>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS'>(initialFilter);
  const [nearExpiryDays, setNearExpiryDays] = useState<number>(90);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [tempDays, setTempDays] = useState<number>(90);
  const [updatingSettings, setUpdatingSettings] = useState<boolean>(false);

  // Expiry tier summary
  const [summary, setSummary] = useState({
    expired: 0,
    days_30: 0,
    days_60: 0,
    days_90: 0,
    total_cost_at_risk: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch near expiry setting
      const settingsRes = await api.getInventorySettings();
      setNearExpiryDays(settingsRes.near_expiry_days);
      setTempDays(settingsRes.near_expiry_days);

      const res = await api.getExpiryAlerts({
        filter: filterMode,
        days: settingsRes.near_expiry_days,
      });
      setData(res.data);
      setSummary(res.summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load expiry alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterMode]);

  const handleSaveSettings = async () => {
    setUpdatingSettings(true);
    try {
      await api.updateInventorySettings(tempDays);
      setNearExpiryDays(tempDays);
      setIsSettingsOpen(false);
      await fetchData();
    } catch (err: unknown) {
      alert(`Failed to save settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdatingSettings(false);
    }
  };

  const exportToExcel = () => {
    const rows = data.map((item, idx) => ({
      'Sr #': idx + 1,
      'Item Code': item.item_code,
      'Item Name': item.item_name,
      'Company': item.company_name,
      'Batch Number': item.batch_number,
      'Mfg Date': item.mfg_date || '—',
      'Expiry Date': item.expiry_date,
      'Days to Expiry': item.days_to_expiry,
      'Expiry Tier': item.expiry_tier,
      'Available Packs': item.current_pack_qty,
      'Available Loose': item.current_loose_qty,
      'Total Units': item.total_units,
      'Purchase Rate (Rs)': item.purchase_rate,
      'Retail Price (Rs)': item.retail_price,
      'Cost Value at Risk (Rs)': item.total_cost_at_risk,
      'Rack Location': item.rack_location || '—',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Expiry Alerts');
    XLSX.writeFile(workbook, `AMS_Expiry_Alerts_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Banner Warning for Expired Batches */}
      {summary.expired > 0 && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-200 flex items-center justify-between text-xs shadow-xs">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-rose-200 uppercase tracking-wide">
                Regulatory Alert: {summary.expired} Expired Batches in Warehouse Quarantine
              </div>
              <div className="text-[11px] text-rose-300/80">
                POS billing automatically blocks dispensing of expired medicines. Quarantine and adjust out of stock immediately.
              </div>
            </div>
          </div>
          <button
            onClick={() => setFilterMode('EXPIRED')}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold cursor-pointer transition-colors"
          >
            View {summary.expired} Expired
          </button>
        </div>
      )}

      {/* Summary KPI Cards & Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
        {/* All Near Expiry & Expired */}
        <button
          onClick={() => setFilterMode('ALL')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
            filterMode === 'ALL'
              ? 'bg-slate-800 border-emerald-500 text-white shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-slate-400">All Flagged Batches</div>
          <div className="text-lg font-black text-white font-mono mt-0.5">
            {summary.expired + summary.days_30 + summary.days_60 + summary.days_90}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Total Risk Batches</div>
        </button>

        {/* Expired Batches */}
        <button
          onClick={() => setFilterMode('EXPIRED')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
            filterMode === 'EXPIRED'
              ? 'bg-rose-950/50 border-rose-500 text-rose-200 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-rose-400">Expired Batches</div>
          <div className="text-lg font-black text-rose-400 font-mono mt-0.5">{summary.expired}</div>
          <div className="text-[10px] text-rose-300/80 mt-1">Do Not Sell (Quarantine)</div>
        </button>

        {/* Expiring in 30 Days */}
        <button
          onClick={() => setFilterMode('30_DAYS')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
            filterMode === '30_DAYS'
              ? 'bg-amber-950/50 border-amber-500 text-amber-200 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-amber-400">&le; 30 Days Expiry</div>
          <div className="text-lg font-black text-amber-400 font-mono mt-0.5">{summary.days_30}</div>
          <div className="text-[10px] text-amber-300/80 mt-1">High Urgency / Return</div>
        </button>

        {/* Expiring in 60 Days */}
        <button
          onClick={() => setFilterMode('60_DAYS')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
            filterMode === '60_DAYS'
              ? 'bg-amber-950/30 border-amber-600 text-amber-200 shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-amber-400/90">&le; 60 Days Expiry</div>
          <div className="text-lg font-black text-amber-300 font-mono mt-0.5">{summary.days_60}</div>
          <div className="text-[10px] text-slate-400 mt-1">Prioritize FEFO Sale</div>
        </button>

        {/* Expiring in 90 Days */}
        <button
          onClick={() => setFilterMode('90_DAYS')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
            filterMode === '90_DAYS'
              ? 'bg-slate-800 border-indigo-500 text-white shadow-xs'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] uppercase font-bold text-indigo-400">&le; 90 Days Expiry</div>
          <div className="text-lg font-black text-indigo-300 font-mono mt-0.5">{summary.days_90}</div>
          <div className="text-[10px] text-slate-400 mt-1">Early Warning Window</div>
        </button>
      </div>

      {/* Control Header & Actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              Pharmaceutical Expiry Alert &amp; Quarantine Control
            </h2>
            <p className="text-[11px] text-slate-400">
              Configurable threshold: <span className="text-emerald-400 font-semibold">{nearExpiryDays} Days</span> | Capital at risk: <span className="text-amber-300 font-mono font-bold">{formatPKR(summary.total_cost_at_risk)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-semibold cursor-pointer transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Configure Alert Window</span>
          </button>
          <button
            onClick={() => {
              if (expiryPrintRef.current) {
                printReportDocument(
                  expiryPrintRef.current,
                  'Abrar Medical Store - Expiry & Quarantine Report'
                );
              } else {
                window.print();
              }
            }}
            disabled={data.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </button>
          <button
            onClick={exportToExcel}
            disabled={data.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Expiry List</span>
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

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Expiry Section */}
      <div ref={expiryPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="PHARMACEUTICAL EXPIRY & QUARANTINE REGISTER"
          subtitle="Early Warning Batch Expiry & Stock Risk Management Statement"
          metaItems={[
            { label: 'Expiry Filter', value: filterMode },
            { label: 'Threshold Days', value: `${nearExpiryDays} Days` },
            { label: 'Total Batches at Risk', value: data.length },
            { label: 'Total Cost at Risk', value: formatPKR(summary.total_cost_at_risk) },
          ]}
        />

        {/* Expiry Data Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 border-r border-slate-850">Item Code</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[170px]">Item Name</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Company</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Batch #</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Mfg Date</th>
                <th className="px-3 py-2 border-r border-slate-850 text-center">Expiry Date</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Days Left</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-emerald-300">Available Stock</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right">Purchase Rate</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-amber-300">Cost at Risk</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Rack Location</th>
                <th className="px-2.5 py-2 text-center">Status / Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && data.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Analyzing batch expiry dates...</span>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400 font-sans">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                    <span className="font-semibold text-slate-200">No batches found matching the selected expiry criteria</span>
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const isExpired = item.expiry_tier === 'EXPIRED';
                  const is30 = item.expiry_tier === '30_DAYS';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-800/60 transition-colors ${
                        isExpired
                          ? 'bg-rose-950/20 text-rose-200'
                          : is30
                          ? 'bg-amber-950/20 text-amber-200'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-emerald-400 font-bold">
                        {item.item_code}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans">
                        <div className="font-semibold text-white">{item.item_name}</div>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300 truncate max-w-[130px]">
                        {item.company_name}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-bold text-slate-200">
                        {item.batch_number}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                        {item.mfg_date || '—'}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center font-bold">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            isExpired
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : is30
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {item.expiry_date}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center font-bold">
                        <span
                          className={
                            isExpired
                              ? 'text-rose-400'
                              : is30
                              ? 'text-amber-400'
                              : 'text-slate-300'
                          }
                        >
                          {isExpired ? `Expired (${Math.abs(item.days_to_expiry)}d ago)` : `${item.days_to_expiry} days`}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-300">
                        {item.current_pack_qty} <span className="text-[10px] text-slate-400 font-sans font-normal">pk</span>
                        {item.current_loose_qty > 0 && (
                          <span className="text-sky-400 font-mono text-[9px] ml-1">+{item.current_loose_qty}u</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                        {formatPKR(item.purchase_rate, false)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-amber-300">
                        {formatPKR(item.total_cost_at_risk)}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                        {item.rack_location || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-center font-sans">
                        {isExpired ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white">
                            BLOCKED (QUARANTINE)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            SELL FIRST (FEFO)
                          </span>
                        )}
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

      {/* Configuration Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>Configure Expiry Alert Threshold</span>
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p>
                Specify the maximum number of days before medicine expiry to flag batches as <strong>Near Expiry</strong> in AMS inventory dashboards and registers:
              </p>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Near Expiry Alert Threshold (Days):</label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[30, 60, 90, 120].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTempDays(d)}
                      className={`py-1.5 rounded font-mono text-xs font-bold border cursor-pointer transition-all ${
                        tempDays === d
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {d} Days
                    </button>
                  ))}
                </div>
                <NumericInput
                  min={1}
                  max={365}
                  value={tempDays}
                  onChange={(e) => setTempDays(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono text-sm focus:outline-hidden focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={updatingSettings || tempDays < 1}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
              >
                {updatingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>Save Setting</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
