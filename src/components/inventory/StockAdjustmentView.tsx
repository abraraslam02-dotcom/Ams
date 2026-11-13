import React, { useState, useEffect, useMemo } from 'react';
import {
  Sliders,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  X,
  BookOpen,
  Search,
} from 'lucide-react';
import { api } from '../../services/api';
import { StockAdjustment, StockDatasheetItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';

interface AdjustmentFormItem {
  inventory_id: number;
  item_name: string;
  item_code: string;
  company_name: string;
  units_per_pack: number;
  batch_number: string;
  expiry_date: string;
  current_stock: number;
  direction: 'INCREASE' | 'DECREASE';
  quantity_packs: number;
  unit_cost: number;
  reason_note: string;
}

export const StockAdjustmentView: React.FC = () => {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // New adjustment modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [confirmPostOpen, setConfirmPostOpen] = useState<boolean>(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Available batches for picker
  const [availableBatches, setAvailableBatches] = useState<StockDatasheetItem[]>([]);
  const [batchSearch, setBatchSearch] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  // Form fields
  const [adjustmentDate, setAdjustmentDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [reasonCategory, setReasonCategory] = useState<
    'INCREASE' | 'DECREASE' | 'DAMAGE' | 'EXPIRED' | 'PHYSICAL_DIFFERENCE' | 'CORRECTION'
  >('DAMAGE');
  const [description, setDescription] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [formItems, setFormItems] = useState<AdjustmentFormItem[]>([]);

  // Selected adjustment detail drilldown
  const [selectedAdjustment, setSelectedAdjustment] = useState<StockAdjustment | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  const fetchAdjustments = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStockAdjustments();
      setAdjustments(res.adjustments || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch adjustments');
    } finally {
      setLoading(false);
    }
  };

  const loadBatchesForPicker = async () => {
    try {
      const res = await api.getStockDatasheet({ limit: 1000 });
      setAvailableBatches(res.data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchAdjustments();
  }, []);

  const companies = useMemo(
    () => Array.from(new Set(availableBatches.map((b) => b.company_name).filter(Boolean))).sort(),
    [availableBatches]
  );

  const filteredBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return availableBatches.filter((b) => {
      if (companyFilter !== 'ALL' && b.company_name !== companyFilter) return false;
      if (!q) return true;
      return (
        b.item_name.toLowerCase().includes(q) ||
        b.item_code.toLowerCase().includes(q) ||
        b.batch_number.toLowerCase().includes(q)
      );
    });
  }, [availableBatches, companyFilter, batchSearch]);

  const openNewModal = () => {
    loadBatchesForPicker();
    setAdjustmentDate(new Date().toISOString().split('T')[0]);
    setReasonCategory('DAMAGE');
    setDescription('');
    setReferenceNo('');
    setFormItems([]);
    setSelectedBatchId('');
    setBatchSearch('');
    setCompanyFilter('ALL');
    setModalError(null);
    setConfirmPostOpen(false);
    setIdempotencyKey(`ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsModalOpen(true);
  };

  const handleAddBatchToForm = () => {
    setModalError(null);
    if (!selectedBatchId) return;
    const batch = availableBatches.find((b) => b.id === Number(selectedBatchId));
    if (!batch) return;

    if (formItems.some((i) => i.inventory_id === batch.id)) {
      setModalError('This batch is already added to the adjustment form.');
      return;
    }

    const upp = Math.max(1, Number(batch.units_per_pack || 1));
    const fullPacks = Number(((batch.total_stock_units || 0) / upp).toFixed(2));
    const defaultDirection = reasonCategory === 'INCREASE' ? 'INCREASE' : 'DECREASE';

    setFormItems((prev) => [
      ...prev,
      {
        inventory_id: batch.id,
        item_name: batch.item_name,
        item_code: batch.item_code,
        company_name: batch.company_name || 'General',
        units_per_pack: upp,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        current_stock: fullPacks,
        direction: defaultDirection,
        quantity_packs: 1,
        unit_cost: batch.purchase_rate,
        reason_note: '',
      },
    ]);
    setSelectedBatchId('');
  };

  const handleRemoveFormItem = (idx: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateItem = (idx: number, patch: Partial<AdjustmentFormItem>) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleValidateAndAskConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (formItems.length === 0) {
      setModalError('Please add at least one medicine batch to adjust.');
      return;
    }
    if (!description.trim()) {
      setModalError('Please enter an adjustment justification / reason description.');
      return;
    }
    setConfirmPostOpen(true);
  };

  const handleExecuteSubmit = async () => {
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await api.createStockAdjustment({
        adjustment_date: adjustmentDate,
        reason_category: reasonCategory,
        description: description.trim(),
        reference_no: referenceNo.trim() || undefined,
        idempotency_key: idempotencyKey,
        items: formItems.map((item) => ({
          inventory_id: item.inventory_id,
          direction: item.direction,
          quantity_packs: Number(item.quantity_packs || 0),
          quantity_loose: 0,
          unit_cost: item.unit_cost,
          reason_note: item.reason_note.trim() || undefined,
        })),
      });

      setConfirmPostOpen(false);
      setIsModalOpen(false);
      setStatusNotice(`Stock Adjustment ${res.adjustment_no} posted and inventory updated.`);
      await fetchAdjustments();
    } catch (err: unknown) {
      setConfirmPostOpen(false);
      setModalError(`Adjustment Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetail = async (id: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await api.getStockAdjustmentById(id);
      setSelectedAdjustment(res.adjustment);
    } catch (err: unknown) {
      setError(`Failed to load details: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const totalModalCostImpact = formItems.reduce((sum, item) => {
    const cost = item.quantity_packs * item.unit_cost;
    return item.direction === 'INCREASE' ? sum + cost : sum - cost;
  }, 0);

  return (
    <div className="space-y-3 font-sans">
      {/* Control Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              Stock Adjustments &amp; Damage Expense Register (Full Pack Equivalent)
            </h2>
            <p className="text-[11px] text-slate-400">
              Audit-logged inventory corrections with automated double-entry GL journal posting (Confirmation required before update)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Adjustment</span>
          </button>
          <button
            type="button"
            onClick={fetchAdjustments}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="p-3 bg-emerald-950/50 border border-emerald-700 text-emerald-200 rounded text-xs flex items-center justify-between">
          <span className="font-semibold">{statusNotice}</span>
          <button type="button" onClick={() => setStatusNotice(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Adjustments History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 border-r border-slate-850">Adjustment #</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Date</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Reason Category</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[200px]">Description / Note</th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">Items</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black">Cost Impact</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Posted By</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">GL Voucher</th>
                <th className="px-2.5 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && adjustments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-purple-400 mb-1" />
                    <span>Loading adjustment audit history...</span>
                  </td>
                </tr>
              ) : adjustments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                    <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto mb-1" />
                    <span className="font-semibold text-slate-300">No stock adjustments recorded yet</span>
                  </td>
                </tr>
              ) : (
                adjustments.map((adj) => (
                  <tr key={adj.id} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 font-bold text-purple-400">
                      {adj.adjustment_no}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                      {adj.adjustment_date}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700">
                        {adj.reason_category}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-800/80 font-sans text-slate-300">
                      <div className="truncate max-w-[280px]">{adj.description}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-200 font-bold">
                      {adj.total_items}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 text-right font-black">
                      <span
                        className={
                          adj.total_cost_impact > 0
                            ? 'text-emerald-400'
                            : adj.total_cost_impact < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }
                      >
                        {formatPKR(adj.total_cost_impact)}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300">
                      {adj.created_by_name || 'System Admin'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center">
                      {adj.journal_voucher_id ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          JV-{adj.journal_voucher_id}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-center">
                      <button
                        type="button"
                        onClick={() => handleViewDetail(adj.id)}
                        disabled={loadingDetail}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold cursor-pointer border border-slate-700"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drilldown Modal */}
      {selectedAdjustment && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-3xl w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Stock Adjustment Audit — {selectedAdjustment.adjustment_no}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Date: {selectedAdjustment.adjustment_date} | Reason: {selectedAdjustment.reason_category}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAdjustment(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-slate-300">
                <div className="text-[10px] uppercase font-bold text-slate-500">Justification / Audit Note</div>
                <div className="mt-0.5 text-xs text-white">{selectedAdjustment.description}</div>
              </div>

              {selectedAdjustment.items && (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-2.5 py-1.5">Medicine</th>
                        <th className="px-2 py-1.5">Batch</th>
                        <th className="px-2 py-1.5 text-center">Direction</th>
                        <th className="px-2 py-1.5 text-right">Adjustment Qty (Full Pack)</th>
                        <th className="px-2.5 py-1.5 text-right">Cost Rate</th>
                        <th className="px-2.5 py-1.5 text-right font-black">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {selectedAdjustment.items.map((it) => (
                        <tr key={it.id}>
                          <td className="px-2.5 py-1.5 font-sans text-white">{it.item_name}</td>
                          <td className="px-2 py-1.5 text-slate-300 font-bold">{it.batch_number}</td>
                          <td className="px-2 py-1.5 text-center font-bold">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] ${
                                it.direction === 'INCREASE'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {it.direction}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-white font-bold">
                            {it.quantity_packs} pk
                          </td>
                          <td className="px-2.5 py-1.5 text-right text-slate-300">
                            {formatPKR(it.unit_cost, false)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-black text-amber-300">
                            {formatPKR(it.total_cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedAdjustment(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs cursor-pointer"
              >
                Close Audit Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Adjustment Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-4xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Create Verified Stock Adjustment</h3>
                  <p className="text-[11px] text-slate-400">
                    Record inventory write-offs, damages, or surplus stock in Full Pack equivalents
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-2.5 bg-rose-950/50 border border-rose-700 text-rose-200 rounded text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleValidateAndAskConfirm} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Adjustment Date:</label>
                  <input
                    type="date"
                    required
                    value={adjustmentDate}
                    onChange={(e) => setAdjustmentDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Reason Category:</label>
                  <select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-semibold"
                  >
                    <option value="DAMAGE">Damage / Breakage (Decrease)</option>
                    <option value="EXPIRED">Expired Medicine Write-off (Decrease)</option>
                    <option value="PHYSICAL_DIFFERENCE">Physical Stock Count Difference</option>
                    <option value="DECREASE">General Decrease / Loss</option>
                    <option value="INCREASE">Surplus Stock Discovery (Increase)</option>
                    <option value="CORRECTION">Ledger Quantity Correction</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Reference Document #:</label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="e.g. AUDIT-2026-04..."
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Audit Justification &amp; Reason (Required):</label>
                <textarea
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain why this adjustment is being made..."
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs"
                />
              </div>

              {/* Searchable Batch Picker with Company Filter */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                    <input
                      type="text"
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="Search medicine name, code, batch #..."
                      className="w-full pl-8 pr-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                    />
                  </div>
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                  >
                    <option value="ALL">All Companies ({availableBatches.length} batches)</option>
                    {companies.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <select
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                  >
                    <option value="">-- Choose Medicine &amp; Batch ({filteredBatches.length} matches) --</option>
                    {filteredBatches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.item_code} | {b.item_name} ({b.company_name}) | Batch: {b.batch_number} | Stock:{' '}
                        {Number(((b.total_stock_units || 0) / Math.max(1, b.units_per_pack || 1)).toFixed(2))} pk
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddBatchToForm}
                    disabled={!selectedBatchId}
                    className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-bold rounded cursor-pointer transition-colors"
                  >
                    Add Batch
                  </button>
                </div>
              </div>

              {/* Items Table */}
              {formItems.length > 0 && (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-2.5 py-2">Medicine / Batch</th>
                        <th className="px-2 py-2 text-center">Available</th>
                        <th className="px-2 py-2 text-center">Direction</th>
                        <th className="px-2 py-2 text-right">Adjustment Qty (Full Pack)</th>
                        <th className="px-2.5 py-2 text-right">Unit Cost</th>
                        <th className="px-2.5 py-2 text-right font-black">Impact</th>
                        <th className="px-2 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {formItems.map((item, idx) => (
                        <tr key={item.inventory_id}>
                          <td className="px-2.5 py-2 font-sans">
                            <div className="font-semibold text-white">{item.item_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {item.item_code} | {item.company_name} | Batch: {item.batch_number}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center text-slate-300">{item.current_stock} pk</td>
                          <td className="px-2 py-2 text-center">
                            <select
                              value={item.direction}
                              onChange={(e) => handleUpdateItem(idx, { direction: e.target.value as any })}
                              className="px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 text-[10px] font-bold"
                            >
                              <option value="DECREASE">Decrease (-)</option>
                              <option value="INCREASE">Increase (+)</option>
                            </select>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.quantity_packs}
                              onChange={(e) =>
                                handleUpdateItem(idx, { quantity_packs: Math.max(0, Number(e.target.value) || 0) })
                              }
                              className="w-20 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-bold"
                            />
                          </td>
                          <td className="px-2.5 py-2 text-right text-slate-300">
                            {formatPKR(item.unit_cost, false)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-black">
                            <span
                              className={
                                item.direction === 'INCREASE' ? 'text-emerald-400' : 'text-rose-400'
                              }
                            >
                              {item.direction === 'INCREASE' ? '+' : '-'}
                              {formatPKR(item.quantity_packs * item.unit_cost)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveFormItem(idx)}
                              className="text-rose-400 hover:text-rose-300 cursor-pointer font-bold"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Accounting Entry Preview */}
              <div className="p-3 bg-purple-950/20 border border-purple-900/60 rounded-lg space-y-1.5">
                <div className="font-bold text-purple-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Automated Accounting Double-Entry Journal Preview:</span>
                  </span>
                  <span className="font-mono text-sm">Net Impact: {formatPKR(totalModalCostImpact)}</span>
                </div>
              </div>

              {/* Confirmation Prompt */}
              {confirmPostOpen && (
                <div className="p-3 bg-amber-950/50 border border-amber-600 rounded-lg flex flex-wrap items-center justify-between gap-2">
                  <span className="text-amber-200 font-semibold">
                    Confirm posting this Stock Adjustment to live inventory and general ledger?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPostOpen(false)}
                      className="px-3 py-1 bg-slate-800 text-slate-200 rounded text-xs cursor-pointer"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteSubmit}
                      disabled={submitting}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      <span>Confirm &amp; Update Stock</span>
                    </button>
                  </div>
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
                {!confirmPostOpen && (
                  <button
                    type="submit"
                    disabled={submitting || formItems.length === 0}
                    className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Review &amp; Confirm Adjustment</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
