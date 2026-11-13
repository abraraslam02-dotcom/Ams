import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileCheck2,
  X,
  Search,
  Printer,
  Download,
  Building2,
  CheckSquare,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { PhysicalVerification, StockDatasheetItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface CountRow {
  inventory_id: number;
  item_id: number;
  item_name: string;
  item_code: string;
  company_name: string;
  item_group: string;
  packing: string;
  units_per_pack: number;
  batch_number: string;
  expiry_date: string;
  system_pack_qty: number;
  physical_pack_qty: number;
  unit_cost: number;
  reason_note: string;
}

export const PhysicalVerificationView: React.FC = () => {
  const [verifications, setVerifications] = useState<PhysicalVerification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New count sheet modal & batch selector
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [verificationDate, setVerificationDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [remarks, setRemarks] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [requestIdempotencyKey, setRequestIdempotencyKey] = useState<string>('');

  // Available batches pool + Company & Item Multi-Selection inside New Sheet
  const [allBatches, setAllBatches] = useState<StockDatasheetItem[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState<string>('');
  const [batchSearch, setBatchSearch] = useState<string>('');

  const [countRows, setCountRows] = useState<CountRow[]>([]);
  // Optional inline helper map for entering packs + units and converting into Full Packs
  const [unitHelperByBatch, setUnitHelperByBatch] = useState<Record<number, number>>({});

  // Detail / Reconciliation modal + Custom React Confirmation Dialog
  const [activeVerification, setActiveVerification] = useState<PhysicalVerification | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [confirmReconcileOpen, setConfirmReconcileOpen] = useState<boolean>(false);
  const [reconciling, setReconciling] = useState<boolean>(false);
  const printDetailRef = useRef<HTMLDivElement>(null);

  const fetchVerifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhysicalVerifications();
      setVerifications(res.verifications || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch verification audits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVerifications();
  }, []);

  const toCountRow = (b: StockDatasheetItem): CountRow => {
    const upp = Math.max(1, Number(b.units_per_pack || 1));
    const systemFullPack = Number(((b.total_stock_units || 0) / upp).toFixed(2));
    return {
      inventory_id: b.id,
      item_id: b.item_id,
      item_name: b.item_name,
      item_code: b.item_code,
      company_name: b.company_name || 'General',
      item_group: b.category || 'General',
      packing: b.packing || '1x1',
      units_per_pack: upp,
      batch_number: b.batch_number,
      expiry_date: b.expiry_date,
      system_pack_qty: systemFullPack,
      physical_pack_qty: systemFullPack,
      unit_cost: Number(b.purchase_rate || 0),
      reason_note: '',
    };
  };

  const openNewCountSheet = async () => {
    setVerificationDate(new Date().toISOString().split('T')[0]);
    setRemarks('');
    setModalError(null);
    setSelectedCompanies([]);
    setCompanySearch('');
    setBatchSearch('');
    setCountRows([]);
    setUnitHelperByBatch({});
    setRequestIdempotencyKey(`PV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setIsModalOpen(true);
    setLoadingBatches(true);
    try {
      const res = await api.getStockDatasheet({ limit: 2000 });
      setAllBatches(res.data || []);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Failed to preload batches');
    } finally {
      setLoadingBatches(false);
    }
  };

  // Distinct companies available in warehouse
  const availableCompanies = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of allBatches) {
      const c = b.company_name || 'General';
      map.set(c, (map.get(c) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([company_name, count]) => ({ company_name, count }))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [allBatches]);

  const filteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    return q
      ? availableCompanies.filter((c) => c.company_name.toLowerCase().includes(q))
      : availableCompanies;
  }, [availableCompanies, companySearch]);

  // Filtered candidate batches respecting selectedCompanies + batchSearch (selecting company does NOT force items automatically!)
  const candidateBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return allBatches.filter((b) => {
      if (selectedCompanies.length > 0 && !selectedCompanies.includes(b.company_name || 'General')) {
        return false;
      }
      if (!q) return true;
      return (
        b.item_name.toLowerCase().includes(q) ||
        b.item_code.toLowerCase().includes(q) ||
        (b.batch_number || '').toLowerCase().includes(q) ||
        (b.company_name || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q)
      );
    });
  }, [allBatches, selectedCompanies, batchSearch]);

  const selectedBatchIds = useMemo(() => new Set(countRows.map((r) => r.inventory_id)), [countRows]);

  const toggleCompany = (compName: string) => {
    setSelectedCompanies((prev) => {
      if (prev.includes(compName)) {
        // Removing company removes its items from sheet
        setCountRows((rows) => rows.filter((r) => r.company_name !== compName));
        return prev.filter((c) => c !== compName);
      }
      return [...prev, compName];
    });
  };

  const addBatchToSheet = (b: StockDatasheetItem) => {
    if (selectedBatchIds.has(b.id)) return;
    setCountRows((prev) => [...prev, toCountRow(b)]);
  };

  const removeBatchFromSheet = (inventoryId: number) => {
    setCountRows((prev) => prev.filter((r) => r.inventory_id !== inventoryId));
  };

  const addAllCandidateBatches = () => {
    setCountRows((prev) => {
      const existing = new Set(prev.map((r) => r.inventory_id));
      const additions = candidateBatches.filter((b) => !existing.has(b.id)).map(toCountRow);
      return [...prev, ...additions];
    });
  };

  const removeAllCountRows = () => {
    setCountRows([]);
  };

  const handleUpdateCountRow = (idx: number, patch: Partial<CountRow>) => {
    setCountRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleUnitConversionChange = (idx: number, inventoryId: number, extraUnits: number, wholePacks: number, upp: number) => {
    setUnitHelperByBatch((prev) => ({ ...prev, [inventoryId]: extraUnits }));
    const convertedFullPack = Number((Math.max(0, wholePacks) + Math.max(0, extraUnits) / Math.max(1, upp)).toFixed(2));
    handleUpdateCountRow(idx, { physical_pack_qty: convertedFullPack });
  };

  const handleSaveAuditSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (countRows.length === 0) {
      setModalError('Please add at least one item / batch to the count sheet.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createPhysicalVerification({
        verification_date: verificationDate,
        remarks: remarks.trim() || undefined,
        idempotency_key: requestIdempotencyKey,
        items: countRows.map((r) => ({
          inventory_id: r.inventory_id,
          physical_pack_qty: Number(r.physical_pack_qty || 0),
          physical_loose_qty: 0,
          reason_note: r.reason_note.trim() || undefined,
        })),
      });

      setIsModalOpen(false);
      setStatusNotice({
        type: 'success',
        text: `Draft count sheet ${res.verification_no} saved. Inventory will only update after you confirm reconciliation.`,
      });
      await fetchVerifications();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewAudit = async (id: number) => {
    setLoadingDetail(true);
    setError(null);
    setConfirmReconcileOpen(false);
    try {
      const res = await api.getPhysicalVerificationById(id);
      setActiveVerification(res.verification);
    } catch (err: unknown) {
      setError(`Failed to load audit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const executeReconcile = async () => {
    if (!activeVerification) return;
    setReconciling(true);
    try {
      const res = await api.reconcilePhysicalVerification(activeVerification.id, {
        remarks: 'Confirmed Physical Stock Adjustment & Reconciliation',
      });
      setConfirmReconcileOpen(false);
      setActiveVerification(null);
      setStatusNotice({
        type: 'success',
        text: `Inventory updated! Audit ${activeVerification.verification_no} reconciled under voucher ${res.adjustment_no}.`,
      });
      await fetchVerifications();
    } catch (err: unknown) {
      setStatusNotice({
        type: 'error',
        text: `Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      setConfirmReconcileOpen(false);
    } finally {
      setReconciling(false);
    }
  };

  const exportAuditToExcel = () => {
    if (!activeVerification?.items) return;
    const rows = activeVerification.items.map((it, idx) => ({
      'S.No': idx + 1,
      'Item Code': it.item_code || '',
      'Item Name': it.item_name || '',
      Company: it.company_name || 'General',
      'Item Group': it.item_group || 'General',
      'Batch Number': it.batch_number,
      'System Stock (Full Pack)': it.system_pack_qty,
      'Physical Count (Full Pack)': it.physical_pack_qty,
      'Difference (+/-)': it.diff_pack_qty,
      'Adjustment Quantity': Math.abs(it.diff_pack_qty),
      'Adjustment Type': it.diff_pack_qty > 0 ? 'EXCESS' : it.diff_pack_qty < 0 ? 'SHORTAGE' : 'MATCH',
      Remarks: it.reason_note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Physical Adjustment');
    XLSX.writeFile(wb, `AMS_Physical_Adjustment_${activeVerification.verification_no}.xlsx`);
  };

  // Variance statistics for new modal
  const totalVariancePacks = Number(
    countRows.reduce((sum, r) => sum + (r.physical_pack_qty - r.system_pack_qty), 0).toFixed(2)
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
              Physical Stock Adjustment &amp; Verification (Full Pack Rule)
            </h2>
            <p className="text-[11px] text-slate-400">
              Select companies or individual items, enter physical counts (with Full Pack conversion), review Shortage/Excess, and update inventory only after confirmation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openNewCountSheet}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Physical Stock Count</span>
          </button>
          <button
            type="button"
            onClick={fetchVerifications}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {statusNotice && (
        <div
          className={`p-3 rounded text-xs flex items-center justify-between border ${
            statusNotice.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-700 text-emerald-200'
              : 'bg-rose-950/50 border-rose-700 text-rose-200'
          }`}
        >
          <span className="font-semibold">{statusNotice.text}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
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

      {/* Verifications History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">S.No</th>
                <th className="px-3 py-2 border-r border-slate-850">Voucher / Audit #</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Date</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Status</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[200px]">Remarks / Scope</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Adjustment Voucher</th>
                <th className="px-2.5 py-2 border-r border-slate-850">User / Auditor</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Confirmed At</th>
                <th className="px-2.5 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && verifications.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Loading physical stock adjustment history...</span>
                  </td>
                </tr>
              ) : verifications.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                    No physical count audits recorded yet. Click &quot;New Physical Stock Count&quot; to begin.
                  </td>
                </tr>
              ) : (
                verifications.map((v: any, idx) => (
                  <tr key={v.id} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-2.5 py-2 border-r border-slate-800/80 text-center text-slate-400">
                      {idx + 1}
                    </td>
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
                        {v.status === 'RECONCILED' ? 'CONFIRMED' : 'DRAFT (PENDING)'}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-800/80 font-sans text-slate-300">
                      <div className="truncate max-w-[260px]">{v.remarks || 'Physical Stock Adjustment'}</div>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-purple-300 font-bold">
                      {v.adjustment_no || 'Pending'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300">
                      {v.conducted_by_name || 'Super Admin'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                      {v.reconciled_at || 'Pending Confirmation'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-center">
                      <button
                        type="button"
                        onClick={() => handleViewAudit(v.id)}
                        disabled={loadingDetail}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold cursor-pointer border border-slate-700"
                      >
                        {v.status === 'RECONCILED' ? 'View Report' : 'Review & Confirm'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Detail & Confirmation Modal */}
      {activeVerification && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-6xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Physical Stock Adjustment Sheet: {activeVerification.verification_no} ({activeVerification.status})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Date: {activeVerification.verification_date} | User: {activeVerification.conducted_by_name}
                    {(activeVerification as any).adjustment_no ? ` | Adjustment Voucher: ${(activeVerification as any).adjustment_no}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (printDetailRef.current) {
                      printReportDocument(
                        printDetailRef.current,
                        `Physical Stock Adjustment - ${activeVerification.verification_no}`,
                        { orientation: 'landscape', paperSize: 'a4', margin: 'minimum', fontSizeScale: 'small' }
                      );
                    }
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-slate-700"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={exportAuditToExcel}
                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReconcileOpen(false);
                    setActiveVerification(null);
                  }}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div ref={printDetailRef} className="space-y-3">
              <PrintDocumentHeader
                title="PHYSICAL STOCK ADJUSTMENT REPORT (FULL PACK EQUIVALENT)"
                subtitle={`Audit Voucher: ${activeVerification.verification_no} | Status: ${activeVerification.status}`}
                metaFields={[
                  { label: 'Date', value: activeVerification.verification_date },
                  { label: 'Conducted By', value: activeVerification.conducted_by_name },
                  { label: 'Adjustment Ref', value: (activeVerification as any).adjustment_no || 'Draft' },
                ]}
              />

              {activeVerification.items && (
                <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[450px] overflow-y-auto">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-slate-950 text-slate-300 uppercase text-[10px] font-bold border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-center border-r border-slate-850">S.No</th>
                        <th className="px-2.5 py-2 border-r border-slate-850">Item Code</th>
                        <th className="px-2.5 py-2 border-r border-slate-850">Item Name</th>
                        <th className="px-2.5 py-2 border-r border-slate-850">Company</th>
                        <th className="px-2 py-2 border-r border-slate-850">Item Group</th>
                        <th className="px-2 py-2 text-right border-r border-slate-850">System Stock</th>
                        <th className="px-2 py-2 text-right border-r border-slate-850 text-emerald-400">Physical Count</th>
                        <th className="px-2.5 py-2 text-right border-r border-slate-850 font-black">Difference (+/-)</th>
                        <th className="px-2.5 py-2 text-right border-r border-slate-850 font-black">Adjustment Qty</th>
                        <th className="px-3 py-2">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {activeVerification.items.map((it, idx) => {
                        const diff = Number(it.diff_pack_qty || 0);
                        const hasDiff = Math.abs(diff) > 0.0001;
                        const adjType = diff > 0 ? 'EXCESS' : diff < 0 ? 'SHORTAGE' : 'MATCH';
                        return (
                          <tr
                            key={it.id}
                            className={`hover:bg-slate-800/60 transition-colors ${
                              hasDiff
                                ? diff < 0
                                  ? 'bg-rose-950/20'
                                  : 'bg-emerald-950/20'
                                : ''
                            }`}
                          >
                            <td className="px-2 py-1.5 text-center border-r border-slate-800/80 text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="px-2.5 py-1.5 border-r border-slate-800/80 text-emerald-400 font-bold">
                              {it.item_code}
                            </td>
                            <td className="px-2.5 py-1.5 border-r border-slate-800/80 font-sans">
                              <div className="font-semibold text-white">{it.item_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Batch: {it.batch_number} (Exp: {it.expiry_date})
                              </div>
                            </td>
                            <td className="px-2.5 py-1.5 border-r border-slate-800/80 font-sans text-slate-300">
                              {it.company_name || 'General'}
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-800/80 font-sans text-slate-400">
                              {it.item_group || 'General'}
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-800/80 text-right text-slate-300">
                              {it.system_pack_qty} pk
                            </td>
                            <td className="px-2 py-1.5 border-r border-slate-800/80 text-right text-emerald-300 font-bold">
                              {it.physical_pack_qty} pk
                            </td>
                            <td className="px-2.5 py-1.5 border-r border-slate-800/80 text-right font-black">
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
                            <td className="px-2.5 py-1.5 border-r border-slate-800/80 text-right font-bold">
                              <span>{Math.abs(diff)} pk</span>
                              <span
                                className={`ml-1.5 px-1 py-0.5 rounded text-[9px] font-sans ${
                                  adjType === 'EXCESS'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : adjType === 'SHORTAGE'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {adjType}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 font-sans text-slate-300">
                              {it.reason_note || (hasDiff ? `${adjType} detected` : 'Verified match')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Confirmation Sub-Dialog (Replaces window.confirm) */}
            {confirmReconcileOpen && (
              <div className="p-3.5 bg-amber-950/50 border border-amber-600 rounded-lg space-y-2.5">
                <div className="flex items-start gap-2 text-amber-200 text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">
                      Confirm Inventory Update for {activeVerification.verification_no}
                    </div>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Confirming will update system inventory quantities to match your physical count and post the adjustment voucher. Duplicate confirmations are blocked automatically.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmReconcileOpen(false)}
                    disabled={reconciling}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs cursor-pointer"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={executeReconcile}
                    disabled={reconciling}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer flex items-center gap-1.5"
                  >
                    {reconciling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>Yes, Update Inventory Now</span>
                  </button>
                </div>
              </div>
            )}

            {/* Reconciliation Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                {activeVerification.status === 'RECONCILED' ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Inventory updated and adjustment audit finalized. Duplicate reconciliation locked.</span>
                  </span>
                ) : (
                  <span>Inventory remains unchanged until you confirm reconciliation.</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReconcileOpen(false);
                    setActiveVerification(null);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs cursor-pointer"
                >
                  Close
                </button>
                {activeVerification.status === 'DRAFT' && !confirmReconcileOpen && (
                  <button
                    type="button"
                    onClick={() => setConfirmReconcileOpen(true)}
                    disabled={reconciling}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Update Inventory</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Count Audit Sheet Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-6xl w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    New Physical Stock Adjustment Sheet (Draft Until Confirmed)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Select multiple companies or individual items, input Physical Count in Full Packs (decimal supported), and save draft before confirming
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

            <form onSubmit={handleSaveAuditSheet} className="space-y-3 text-xs">
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
                  <label className="block text-slate-400 mb-1 font-semibold">Voucher Remarks / Audit Scope:</label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="e.g. Cycle count for selected companies / shelves..."
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200"
                  />
                </div>
              </div>

              {/* Company Multi-Selection & Batch Picker */}
              {loadingBatches ? (
                <div className="py-10 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-500 mb-2" />
                  <span>Loading inventory batches...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 bg-slate-950 border border-slate-800 rounded-lg">
                  {/* Left: Multi-Company Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>1. Companies ({selectedCompanies.length} selected)</span>
                      </span>
                      <div className="flex gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setSelectedCompanies(availableCompanies.map((c) => c.company_name))}
                          className="px-2 py-0.5 bg-emerald-900/50 text-emerald-300 border border-emerald-700/60 rounded cursor-pointer"
                        >
                          Add All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCompanies([])}
                          className="px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded cursor-pointer"
                        >
                          Clear Companies
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      placeholder="Search company..."
                      className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                    />
                    <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5 p-1 bg-slate-900/60 rounded border border-slate-800">
                      {filteredCompanies.map((c) => {
                        const active = selectedCompanies.includes(c.company_name);
                        return (
                          <button
                            key={c.company_name}
                            type="button"
                            onClick={() => toggleCompany(c.company_name)}
                            className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer border transition-colors ${
                              active
                                ? 'bg-emerald-600 text-white border-emerald-500'
                                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                            }`}
                          >
                            {active ? '✓ ' : '+ '}
                            {c.company_name} ({c.count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: Individual Item / Batch Picker */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-emerald-400" />
                        <span>2. Select Individual Items / Batches ({candidateBatches.length} shown)</span>
                      </span>
                      <div className="flex gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={addAllCandidateBatches}
                          className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded cursor-pointer font-bold flex items-center gap-1"
                        >
                          <CheckSquare className="w-3 h-3" />
                          <span>Add All</span>
                        </button>
                        <button
                          type="button"
                          onClick={removeAllCountRows}
                          className="px-2 py-0.5 bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded cursor-pointer flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove All</span>
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="Search item code, name, company, group or batch #..."
                      className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs"
                    />
                    <div className="max-h-32 overflow-y-auto divide-y divide-slate-800 bg-slate-900/60 rounded border border-slate-800">
                      {candidateBatches.slice(0, 120).map((b) => {
                        const added = selectedBatchIds.has(b.id);
                        return (
                          <div
                            key={b.id}
                            className="px-2.5 py-1 flex items-center justify-between gap-2 text-[11px] hover:bg-slate-800/60"
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-emerald-400 font-bold mr-1.5">{b.item_code}</span>
                              <span className="text-white font-semibold">{b.item_name}</span>
                              <span className="text-slate-400 ml-1.5">
                                ({b.company_name} | Batch: {b.batch_number})
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => (added ? removeBatchFromSheet(b.id) : addBatchToSheet(b))}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 cursor-pointer ${
                                added
                                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                  : 'bg-emerald-700 text-white hover:bg-emerald-600'
                              }`}
                            >
                              {added ? 'Remove' : '+ Add'}
                            </button>
                          </div>
                        );
                      })}
                      {candidateBatches.length === 0 && (
                        <div className="p-3 text-center text-slate-500 text-[11px]">
                          No items match filter criteria.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Variance Summary Callout */}
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">
                  Selected Items on Sheet: <strong className="text-white">{countRows.length}</strong>
                </span>
                <span className="text-slate-400">
                  Net Difference (Full Packs):{' '}
                  <strong className={totalVariancePacks < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {totalVariancePacks > 0 ? `+${totalVariancePacks}` : totalVariancePacks} pk
                  </strong>
                </span>
                <span className="text-slate-400">
                  Est. Cost Impact:{' '}
                  <strong className={totalVarianceCost < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {formatPKR(totalVarianceCost)}
                  </strong>
                </span>
              </div>

              {/* Count Entry Table (All 10 Required Columns) */}
              <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[340px] overflow-y-auto">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center">S.No</th>
                      <th className="px-2 py-2">Item Code</th>
                      <th className="px-2.5 py-2">Item Name</th>
                      <th className="px-2 py-2">Company</th>
                      <th className="px-2 py-2">Item Group</th>
                      <th className="px-2 py-2 text-right">System Stock</th>
                      <th className="px-2.5 py-2 text-right font-bold text-emerald-400">
                        Physical Count (Full Pack + Helper)
                      </th>
                      <th className="px-2 py-2 text-right">Diff (+/-)</th>
                      <th className="px-2 py-2 text-right">Adjustment Qty</th>
                      <th className="px-2.5 py-2">Remarks</th>
                      <th className="px-1.5 py-2 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {countRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-slate-400 font-sans">
                          Select companies or individual items above and click &quot;+ Add&quot; or &quot;Add All&quot; to begin counting.
                        </td>
                      </tr>
                    ) : (
                      countRows.map((row, idx) => {
                        const diff = Number((row.physical_pack_qty - row.system_pack_qty).toFixed(2));
                        const extraUnits = unitHelperByBatch[row.inventory_id] || 0;
                        const statusLabel = diff > 0 ? 'EXCESS' : diff < 0 ? 'SHORTAGE' : 'MATCH';

                        return (
                          <tr key={row.inventory_id} className="hover:bg-slate-850/50">
                            <td className="px-2 py-1.5 text-center text-slate-400">{idx + 1}</td>
                            <td className="px-2 py-1.5 text-emerald-400 font-bold whitespace-nowrap">
                              {row.item_code}
                            </td>
                            <td className="px-2.5 py-1.5 font-sans">
                              <div className="font-semibold text-white">{row.item_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Batch: {row.batch_number} | {row.packing} ({row.units_per_pack}u/pk)
                              </div>
                            </td>
                            <td className="px-2 py-1.5 font-sans text-slate-300 truncate max-w-[110px]">
                              {row.company_name}
                            </td>
                            <td className="px-2 py-1.5 font-sans text-slate-400 truncate max-w-[100px]">
                              {row.item_group}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-300">
                              {row.system_pack_qty}
                            </td>
                            <td className="px-2.5 py-1.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={row.physical_pack_qty}
                                  onChange={(e) =>
                                    handleUpdateCountRow(idx, {
                                      physical_pack_qty: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  className="w-20 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-right text-emerald-300 font-bold"
                                  title="Enter count in Full Packs (decimal allowed e.g. 2.5)"
                                />
                                {row.units_per_pack > 1 && (
                                  <input
                                    type="number"
                                    min={0}
                                    step="1"
                                    value={extraUnits || ''}
                                    onChange={(e) =>
                                      handleUnitConversionChange(
                                        idx,
                                        row.inventory_id,
                                        Number(e.target.value) || 0,
                                        Math.floor(row.physical_pack_qty),
                                        row.units_per_pack
                                      )
                                    }
                                    placeholder="+u"
                                    title={`Convert extra units (/${row.units_per_pack}) into Full Packs`}
                                    className="w-12 px-1 py-1 bg-slate-950 border border-slate-800 rounded text-right text-sky-300 text-[10px]"
                                  />
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold">
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
                            <td className="px-2 py-1.5 text-right">
                              <span className="font-bold text-slate-200">{Math.abs(diff)}</span>{' '}
                              <span
                                className={`text-[9px] font-sans px-1 py-0.5 rounded ${
                                  statusLabel === 'EXCESS'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : statusLabel === 'SHORTAGE'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-slate-800 text-slate-500'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 font-sans">
                              <input
                                type="text"
                                value={row.reason_note}
                                onChange={(e) =>
                                  handleUpdateCountRow(idx, { reason_note: e.target.value })
                                }
                                placeholder="Remarks..."
                                className="w-full px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 text-[10px]"
                              />
                            </td>
                            <td className="px-1.5 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeBatchFromSheet(row.inventory_id)}
                                className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                                title="Remove item from count sheet"
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

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
                  <span>Save Draft Audit Sheet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
