import React, { useState, useEffect } from 'react';
import {
  ArrowRightLeft,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  MapPin,
  X,
  Package,
} from 'lucide-react';
import { api } from '../../services/api';
import { StockTransfer, StockDatasheetItem } from '../../types/inventory';
import { NumericInput } from '../common/NumericInput';

interface TransferFormItem {
  inventory_id: number;
  item_name: string;
  item_code: string;
  batch_number: string;
  available_packs: number;
  quantity_packs: number;
  quantity_loose: number;
  from_rack: string;
  to_rack: string;
}

export const StockTransferView: React.FC = () => {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New transfer modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [availableBatches, setAvailableBatches] = useState<StockDatasheetItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  // Form fields
  const [transferDate, setTransferDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [fromLocation, setFromLocation] = useState<string>('Main Warehouse');
  const [toLocation, setToLocation] = useState<string>('Front Dispensing Counter');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [formItems, setFormItems] = useState<TransferFormItem[]>([]);

  const fetchTransfers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStockTransfers();
      setTransfers(res.transfers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stock transfers');
    } finally {
      setLoading(false);
    }
  };

  const loadBatchesForPicker = async () => {
    try {
      const res = await api.getStockDatasheet({ limit: 500 });
      setAvailableBatches(res.data);
    } catch (err) {
      console.error('Failed to load batches:', err);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const openNewModal = () => {
    loadBatchesForPicker();
    setTransferDate(new Date().toISOString().split('T')[0]);
    setFromLocation('Main Warehouse');
    setToLocation('Front Dispensing Counter');
    setReferenceNo('');
    setRemarks('');
    setFormItems([]);
    setSelectedBatchId('');
    setIsModalOpen(true);
  };

  const handleAddBatch = () => {
    if (!selectedBatchId) return;
    const batch = availableBatches.find((b) => b.id === Number(selectedBatchId));
    if (!batch) return;

    if (formItems.some((i) => i.inventory_id === batch.id)) {
      alert('Batch already added to transfer.');
      return;
    }

    setFormItems((prev) => [
      ...prev,
      {
        inventory_id: batch.id,
        item_name: batch.item_name,
        item_code: batch.item_code,
        batch_number: batch.batch_number,
        available_packs: batch.current_stock,
        quantity_packs: Math.min(1, batch.current_stock),
        quantity_loose: 0,
        from_rack: batch.rack_location || 'Warehouse Rack',
        to_rack: 'Front Counter Rack',
      },
    ]);
    setSelectedBatchId('');
  };

  const handleRemoveItem = (idx: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateItem = (idx: number, patch: Partial<TransferFormItem>) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formItems.length === 0) {
      alert('Please add at least one batch to transfer.');
      return;
    }

    setSubmitting(true);
    try {
      await api.createStockTransfer({
        transfer_date: transferDate,
        from_location: fromLocation,
        to_location: toLocation,
        reference_no: referenceNo.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: formItems.map((i) => ({
          inventory_id: i.inventory_id,
          quantity_packs: i.quantity_packs,
          quantity_loose: i.quantity_loose,
          from_rack: i.from_rack,
          to_rack: i.to_rack,
        })),
      });

      setIsModalOpen(false);
      await fetchTransfers();
    } catch (err: unknown) {
      alert(`Transfer failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Control Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            <ArrowRightLeft className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              Stock Transfer &amp; Location Movement
            </h2>
            <p className="text-[11px] text-slate-400">
              Track physical movements between main warehouse racks, cold storage, and retail dispensing counters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Stock Transfer</span>
          </button>
          <button
            onClick={fetchTransfers}
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

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 border-r border-slate-850">Transfer #</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Date</th>
                <th className="px-3 py-2 border-r border-slate-850">From Location</th>
                <th className="px-3 py-2 border-r border-slate-850">To Location</th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">Batches Transferred</th>
                <th className="px-3 py-2 border-r border-slate-850">Remarks</th>
                <th className="px-2.5 py-2">Transfer Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-400 mb-1" />
                    <span>Loading internal transfer records...</span>
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                    <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto mb-1" />
                    <span className="font-semibold text-slate-300">No stock transfers recorded yet</span>
                  </td>
                </tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 font-bold text-blue-400">
                      {t.transfer_no}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                      {t.transfer_date}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">
                        {t.from_location}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans text-emerald-300">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 text-[10px]">
                        &rarr; {t.to_location}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-white font-bold">
                      {t.total_items}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-800/80 font-sans text-slate-400">
                      <div className="truncate max-w-[260px]">{t.remarks || '—'}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap font-sans text-slate-300">
                      {t.created_by_name || 'System Admin'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Transfer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-3xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Record Internal Stock Transfer</h3>
                  <p className="text-[11px] text-slate-400">
                    Shift batches between warehouse shelves, rooms, or POS dispensing stations
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

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Transfer Date:</label>
                  <input
                    type="date"
                    required
                    value={transferDate}
                    onChange={(e) => setTransferDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">From Location / Shelf:</label>
                  <input
                    type="text"
                    required
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">To Location / Shelf:</label>
                  <input
                    type="text"
                    required
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Remarks / Transfer Purpose:</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Restocking front dispensary counter for weekend shift..."
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                />
              </div>

              {/* Add Batch Picker */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="font-bold text-slate-300">Select Batch to Transfer:</div>
                <div className="flex gap-2">
                  <select
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                  >
                    <option value="">-- Choose Medicine Batch --</option>
                    {availableBatches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.item_code} | {b.item_name} | Batch: {b.batch_number} | Available: {b.current_stock} pk (Rack: {b.rack_location || 'None'})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddBatch}
                    disabled={!selectedBatchId}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-bold rounded cursor-pointer transition-colors"
                  >
                    Add Batch
                  </button>
                </div>
              </div>

              {/* Items List */}
              {formItems.length > 0 && (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                      <tr>
                        <th className="px-2.5 py-2">Medicine / Batch</th>
                        <th className="px-2 py-2 text-center">Available</th>
                        <th className="px-2 py-2 text-right">Transfer Packs</th>
                        <th className="px-2 py-2 text-right">Transfer Loose</th>
                        <th className="px-2.5 py-2">Target Rack</th>
                        <th className="px-2 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {formItems.map((item, idx) => (
                        <tr key={item.inventory_id}>
                          <td className="px-2.5 py-2 font-sans">
                            <div className="font-semibold text-white">{item.item_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {item.item_code} | Batch: {item.batch_number}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center text-slate-300">
                            {item.available_packs} pk
                          </td>
                          <td className="px-2 py-2 text-right">
                            <NumericInput
                              min={0}
                              max={item.available_packs}
                              value={item.quantity_packs}
                              onChange={(e) => handleUpdateItem(idx, { quantity_packs: Number(e.target.value) })}
                              className="w-16 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-bold"
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <NumericInput
                              min={0}
                              value={item.quantity_loose}
                              onChange={(e) => handleUpdateItem(idx, { quantity_loose: Number(e.target.value) })}
                              className="w-14 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-sky-400"
                            />
                          </td>
                          <td className="px-2.5 py-2 font-sans">
                            <input
                              type="text"
                              value={item.to_rack}
                              onChange={(e) => handleUpdateItem(idx, { to_rack: e.target.value })}
                              placeholder="e.g. Shelf B-2"
                              className="w-28 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs"
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
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
                  disabled={submitting || formItems.length === 0}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Execute Transfer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
