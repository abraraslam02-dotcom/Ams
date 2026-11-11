import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Layers,
  FileCheck2,
  X,
  ArrowRight,
  ShieldAlert,
  Download,
  Package,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { PhysicalVerification, PhysicalVerificationItem, StockDatasheetItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';

export const PhysicalVerificationView: React.FC = () => {
  const [verifications, setVerifications] = useState<PhysicalVerification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New count sheet modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [verificationDate, setVerificationDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [remarks, setRemarks] = useState<string>('');

  // Count items
  interface CountRow {
    inventory_id: number;
    item_name: string;
    item_code: string;
    batch_number: string;
    expiry_date: string;
    system_pack_qty: number;
    system_loose_qty: number;
    physical_pack_qty: number;
    physical_loose_qty: number;
    unit_cost: number;
    reason_note: string;
  }
  const [countRows, setCountRows] = useState<CountRow[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);

  // Detail / Reconciliation modal
  const [activeVerification, setActiveVerification] = useState<PhysicalVerification | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [reconciling, setReconciling] = useState<boolean>(false);

  const fetchVerifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhysicalVerifications();
      setVerifications(res.verifications);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch verification audits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVerifications();
  }, []);

  const openNewCountSheet = async () => {
    setVerificationDate(new Date().toISOString().split('T')[0]);
    setRemarks('');
    setIsModalOpen(true);
    setLoadingBatches(true);
    try {
      const res = await api.getStockDatasheet({ limit: 1000 });
      const rows: CountRow[] = res.data.map((b) => ({
        inventory_id: b.id,
        item_name: b.item_name,
        item_code: b.item_code,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        system_pack_qty: b.current_stock,
        system_loose_qty: b.current_loose_qty,
        physical_pack_qty: b.current_stock, // default to match
        physical_loose_qty: b.current_loose_qty,
        unit_cost: b.purchase_rate,
        reason_note: '',
      }));
      setCountRows(rows);
    } catch (err) {
      console.error('Failed to preload batches:', err);
    } finally {
      setLoadingBatches(false);
    }
  };

  const handleUpdateCountRow = (idx: number, patch: Partial<CountRow>) => {
    setCountRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  };

  const handleSaveAuditSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countRows.length === 0) {
      alert('No batches to audit.');
      return;
    }

    setSubmitting(true);
    try {
      await api.createPhysicalVerification({
        verification_date: verificationDate,
        remarks: remarks.trim() || undefined,
        items: countRows.map((r) => ({
          inventory_id: r.inventory_id,
          physical_pack_qty: r.physical_pack_qty,
          physical_loose_qty: r.physical_loose_qty,
          reason_note: r.reason_note.trim() || undefined,
        })),
      });

      setIsModalOpen(false);
      await fetchVerifications();
    } catch (err: unknown) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewAudit = async (id: number) => {
    setLoadingDetail(true);
    try {
      const res = await api.getPhysicalVerificationById(id);
      setActiveVerification(res.verification);
    } catch (err: unknown) {
      alert(`Failed to load audit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleReconcile = async () => {
    if (!activeVerification) return;
    if (
      !confirm(
        `Are you sure you want to RECONCILE and POST all differences for audit ${activeVerification.verification_no}?\n\nThis will update system stock to match the counted physical stock and generate automated accounting journal entries!`
      )
    ) {
      return;
    }

    setReconciling(true);
    try {
      const res = await api.reconcilePhysicalVerification(activeVerification.id, {
        remarks: 'Physical count difference reconciliation',
      });
      alert(`Reconciliation Successful!\nAdjustment Ref: ${res.adjustment_no}`);
      setActiveVerification(null);
      await fetchVerifications();
    } catch (err: unknown) {
      alert(`Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReconciling(false);
    }
  };

  // Variance statistics for new modal
  const totalVariancePacks = countRows.reduce(
    (sum, r) => sum + (r.physical_pack_qty - r.system_pack_qty),
    0
  );
  const totalVarianceCost = countRows.reduce(
    (sum, r) => sum + (r.physical_pack_qty - r.system_pack_qty) * r.unit_cost,
    0
  );

  return (
    <div className="space-y-3 font-sans">
      {/* Control Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              Physical Stock Verification &amp; Variance Audit
            </h2>
            <p className="text-[11px] text-slate-400">
              Conduct wall-to-wall or cyclical shelf counts, calculate variances against system stock, and post authorized reconciliations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openNewCountSheet}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Count Audit Sheet</span>
          </button>
          <button
            onClick={fetchVerifications}
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

      {/* Verifications Audit List */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 border-r border-slate-850">Audit #</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Date</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Status</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[200px]">Remarks / Scope</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Auditor</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Reconciled At</th>
                <th className="px-2.5 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && verifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Loading physical count audit records...</span>
                  </td>
                </tr>
              ) : verifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                    No physical count audits recorded yet. Click &quot;New Count Audit Sheet&quot; to begin.
                  </td>
                </tr>
              ) : (
                verifications.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 font-bold text-emerald-400">
                      {v.verification_no}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                      {v.verification_date}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center font-sans">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          v.status === 'RECONCILED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-800/80 font-sans text-slate-300">
                      <div className="truncate max-w-[260px]">{v.remarks || 'Standard Warehouse Audit'}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300">
                      {v.conducted_by_name || 'System Admin'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                      {v.reconciled_at || 'Pending'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-center">
                      <button
                        onClick={() => handleViewAudit(v.id)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold cursor-pointer border border-slate-700"
                      >
                        Inspect &amp; Reconcile
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Detail & Reconcile Modal */}
      {activeVerification && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fadeIn overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-4xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Audit Count Sheet: {activeVerification.verification_no} ({activeVerification.status})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Conducted by {activeVerification.conducted_by_name} on {activeVerification.verification_date}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveVerification(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Variance Breakdown Table */}
            {activeVerification.items && (
              <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[460px] overflow-y-auto">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-300 uppercase text-[10px] font-bold border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="px-2.5 py-2">Medicine / Batch</th>
                      <th className="px-2 py-2 text-right">System Packs</th>
                      <th className="px-2 py-2 text-right text-emerald-400">Counted Packs</th>
                      <th className="px-2.5 py-2 text-right font-black">Variance (Diff)</th>
                      <th className="px-2.5 py-2 text-right">Unit Cost</th>
                      <th className="px-2.5 py-2 text-right font-black">Cost Impact</th>
                      <th className="px-3 py-2">Variance Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {activeVerification.items.map((it) => {
                      const hasDiff = it.diff_pack_qty !== 0 || it.diff_loose_qty !== 0;

                      return (
                        <tr
                          key={it.id}
                          className={`hover:bg-slate-800/60 transition-colors ${
                            hasDiff
                              ? it.diff_pack_qty < 0
                                ? 'bg-rose-950/20'
                                : 'bg-emerald-950/20'
                              : ''
                          }`}
                        >
                          <td className="px-2.5 py-1.5 font-sans">
                            <div className="font-semibold text-white">{it.item_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {it.item_code} | Batch: {it.batch_number} (Exp: {it.expiry_date})
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-300">
                            {it.system_pack_qty} pk
                          </td>
                          <td className="px-2 py-1.5 text-right text-emerald-300 font-bold">
                            {it.physical_pack_qty} pk
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-black">
                            <span
                              className={
                                it.diff_pack_qty > 0
                                  ? 'text-emerald-400'
                                  : it.diff_pack_qty < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-500'
                              }
                            >
                              {it.diff_pack_qty > 0 ? `+${it.diff_pack_qty}` : it.diff_pack_qty} pk
                            </span>
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-slate-300">
                            {formatPKR(it.unit_cost, false)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-black">
                            <span
                              className={
                                it.diff_cost_impact > 0
                                  ? 'text-emerald-400'
                                  : it.diff_cost_impact < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-500'
                              }
                            >
                              {it.diff_cost_impact > 0 ? '+' : ''}
                              {formatPKR(it.diff_cost_impact)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-sans text-slate-400">
                            {it.reason_note || (hasDiff ? 'Variance detected during audit' : 'Count verified')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Reconciliation Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                {activeVerification.status === 'RECONCILED' ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Audit reconciled. Confirmed adjustments posted to inventory and general ledger.</span>
                  </span>
                ) : (
                  <span>Click &quot;Confirm Reconciliation&quot; to post variance adjustments into stock.</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveVerification(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs cursor-pointer"
                >
                  Close
                </button>
                {activeVerification.status === 'DRAFT' && (
                  <button
                    onClick={handleReconcile}
                    disabled={reconciling}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    {reconciling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>Confirm &amp; Post Reconciliation</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Count Audit Sheet Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fadeIn overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-4xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Create Physical Stock Verification Count Sheet</h3>
                  <p className="text-[11px] text-slate-400">
                    Input actual counted packs on shelves to verify system accuracy
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAuditSheet} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Audit Date:</label>
                  <input
                    type="date"
                    required
                    value={verificationDate}
                    onChange={(e) => setVerificationDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Audit Scope / Remarks:</label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="e.g. Monthly Physical Verification - Pharmacy Dispensary..."
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                  />
                </div>
              </div>

              {/* Variance Summary Callout */}
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">
                  Total Items Audited: <strong>{countRows.length}</strong>
                </span>
                <span className="text-slate-400">
                  Net Pack Variance: <strong className={totalVariancePacks < 0 ? 'text-rose-400' : 'text-emerald-400'}>{totalVariancePacks > 0 ? `+${totalVariancePacks}` : totalVariancePacks} pk</strong>
                </span>
                <span className="text-slate-400">
                  Est. Cost Difference: <strong className={totalVarianceCost < 0 ? 'text-rose-400' : 'text-emerald-400'}>{formatPKR(totalVarianceCost)}</strong>
                </span>
              </div>

              {/* Table of Batches for Count Entry */}
              {loadingBatches ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-500 mb-2" />
                  <span>Preloading active warehouse batches for count sheet...</span>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="px-2.5 py-2">Medicine / Batch</th>
                        <th className="px-2 py-2 text-right">System Packs</th>
                        <th className="px-2.5 py-2 text-right font-bold text-emerald-400">Actual Count (Packs)</th>
                        <th className="px-2 py-2 text-right">Count (Loose)</th>
                        <th className="px-2.5 py-2 text-right">Diff (Packs)</th>
                        <th className="px-3 py-2">Discrepancy Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {countRows.map((row, idx) => {
                        const diff = row.physical_pack_qty - row.system_pack_qty;

                        return (
                          <tr key={row.inventory_id} className="hover:bg-slate-850/50">
                            <td className="px-2.5 py-1.5 font-sans">
                              <div className="font-semibold text-white">{row.item_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {row.item_code} | Batch: {row.batch_number} (Exp: {row.expiry_date})
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-300">
                              {row.system_pack_qty}
                            </td>
                            <td className="px-2.5 py-1.5 text-right">
                              <NumericInput
                                min={0}
                                value={row.physical_pack_qty}
                                onChange={(e) =>
                                  handleUpdateCountRow(idx, {
                                    physical_pack_qty: Number(e.target.value),
                                  })
                                }
                                className="w-16 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-emerald-300 font-bold"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <NumericInput
                                min={0}
                                value={row.physical_loose_qty}
                                onChange={(e) =>
                                  handleUpdateCountRow(idx, {
                                    physical_loose_qty: Number(e.target.value),
                                  })
                                }
                                className="w-14 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-sky-400"
                              />
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-bold">
                              <span
                                className={
                                  diff > 0
                                    ? 'text-emerald-400'
                                    : diff < 0
                                    ? 'text-rose-400'
                                    : 'text-slate-500'
                                }
                              >
                                {diff > 0 ? `+${diff}` : diff}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 font-sans">
                              <input
                                type="text"
                                value={row.reason_note}
                                onChange={(e) =>
                                  handleUpdateCountRow(idx, { reason_note: e.target.value })
                                }
                                placeholder="Variance reason if any..."
                                className="w-full px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 text-[10px]"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || countRows.length === 0}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Save Physical Count Sheet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
