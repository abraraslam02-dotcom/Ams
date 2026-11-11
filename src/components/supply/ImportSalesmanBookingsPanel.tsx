import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Sparkles,
  Check,
  RefreshCw,
  FileCheck,
  ShieldCheck,
  Boxes,
  History,
} from 'lucide-react';

export const ImportSalesmanBookingsPanel: React.FC<{
  onImportCompleted?: () => void;
}> = ({ onImportCompleted }) => {
  const [selectedFileName, setSelectedFileName] = useState('');
  const [rawBookings, setRawBookings] = useState<Array<Record<string, any>>>([]);
  const [salesmanMeta, setSalesmanMeta] = useState<{
    id?: number;
    salesman_code?: string;
    name?: string;
  }>({});
  const [previewData, setPreviewData] = useState<Record<string, any> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );
  const [importHistory, setImportHistory] = useState<Array<Record<string, any>>>([]);
  const [pendingSupplies, setPendingSupplies] = useState<Array<Record<string, any>>>([]);

  const loadImportHistory = useCallback(async () => {
    try {
      const [hRes, sRes] = await Promise.all([
        fetch('/api/enhancements/booking-imports/history').then((r) => r.json()),
        fetch('/api/supply/supplies').then((r) => r.json()),
      ]);
      if (hRes.success) {
        setImportHistory(hRes.imports || []);
      }
      if (sRes.supplies) {
        setPendingSupplies(
          (sRes.supplies as Array<Record<string, any>>).filter(
            (s) => Number(s.super_admin_reviewed || 0) === 0 && s.supply_status !== 'Dispatched'
          )
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadImportHistory();
  }, [loadImportHistory]);

  const handleFileChange = async (file: File) => {
    setSelectedFileName(file.name);
    setBanner(null);
    setPreviewData(null);
    setLoadingPreview(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const bookingsList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.bookings)
        ? parsed.bookings
        : [];

      if (bookingsList.length === 0) {
        throw new Error('No bookings found in the selected JSON file.');
      }

      const sm = parsed.salesman || {
        id: bookingsList[0]?.salesman_id,
        salesman_code: bookingsList[0]?.salesman_code,
        name: bookingsList[0]?.salesman_name,
      };
      setRawBookings(bookingsList);
      setSalesmanMeta(sm);

      const res = await fetch('/api/enhancements/booking-imports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          salesman_id: sm.id,
          salesman_code: sm.salesman_code,
          salesman_name: sm.name,
          bookings: bookingsList,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to validate booking file');
      }
      setPreviewData(data);
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid booking JSON file',
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCommitImport = async (generateSupply: boolean) => {
    if (!previewData) return;
    setCommitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/enhancements/booking-imports/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: selectedFileName,
          salesman_id: salesmanMeta.id,
          salesman_code: salesmanMeta.salesman_code,
          salesman_name: salesmanMeta.name,
          bookings: rawBookings,
          generate_supply: generateSupply,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Booking import failed');
      }

      setBanner({
        type: 'success',
        message: generateSupply
          ? `Imported ${data.imported_booking_ids?.length || 0} booking(s) under Batch ${
              data.import_batch_number
            } AND generated ${
              data.created_supplies?.length || 0
            } Town Supply record(s) with FIFO Batch Allocation! (Super Admin review required before dispatch)`
          : `Imported ${data.imported_booking_ids?.length || 0} booking(s) under Batch ${
              data.import_batch_number
            }.`,
      });
      setPreviewData(null);
      setRawBookings([]);
      await loadImportHistory();
      onImportCompleted?.();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to commit booking import',
      });
    } finally {
      setCommitting(false);
    }
  };

  const handleApproveSupplyReview = async (supplyId: number, supplyNumber: string) => {
    try {
      const res = await fetch(`/api/enhancements/booking-imports/supplies/${supplyId}/approve-review`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setBanner({
          type: 'success',
          message: `Supply ${supplyNumber} approved by Super Admin and unlocked for Dispatch!`,
        });
        await loadImportHistory();
        onImportCompleted?.();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800">
              Part 7 — Supply Management Integration
            </span>
            <h3 className="text-base font-extrabold text-slate-900 mt-1">
              Import Salesman Bookings & Generate Town-Wise / Party-Wise Supply
            </h3>
            <p className="text-xs text-slate-500">
              Upload structured JSON booking files sent from the Salesman Mobile App. Validates Salesman, Town, Area, Party, Item Codes, Duplicate Bookings, Trade Offers, Party Discounts, and FIFO Batches.
            </p>
          </div>
        </div>

        {banner && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
              banner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <span className="font-semibold">{banner.message}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs font-bold px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Upload Dropzone */}
        <div className="border-2 border-dashed border-teal-300 bg-teal-50/40 rounded-2xl p-5 text-center space-y-2">
          <input
            type="file"
            accept=".json,application/json"
            id="salesman-booking-json-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileChange(f);
            }}
          />
          <label
            htmlFor="salesman-booking-json-input"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs shadow-md cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            {loadingPreview
              ? 'Validating Salesman Booking File...'
              : 'Select Salesman Mobile Booking File (.json)'}
          </label>
          <div className="text-xs text-slate-600">
            {selectedFileName
              ? `Loaded File: ${selectedFileName}`
              : 'Supports multiple party bookings in a single file with automatic duplicate detection'}
          </div>
        </div>

        {/* Validation Preview */}
        {previewData && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Validation Summary — {previewData.total_bookings} Booking(s) ({previewData.valid_bookings} Valid,{' '}
                  {previewData.duplicate_bookings} Duplicate)
                </h4>
                {previewData.already_imported_file && (
                  <p className="text-xs text-rose-600 font-bold mt-0.5">
                    Warning: A file with this exact name ({selectedFileName}) was previously imported under batch{' '}
                    {previewData.already_imported_file.import_batch_number}.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={committing || previewData.valid_bookings === 0}
                  onClick={() => handleCommitImport(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold text-xs cursor-pointer"
                >
                  Import Bookings Only
                </button>

                <button
                  type="button"
                  disabled={committing || previewData.valid_bookings === 0}
                  onClick={() => handleCommitImport(true)}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  <Truck className="w-4 h-4" />
                  {committing ? 'Importing & Generating Supply...' : 'IMPORT & GENERATE SUPPLY'}
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {(previewData.bookings || []).map((bk: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-3.5 rounded-xl border text-xs ${
                    bk.is_valid
                      ? 'bg-white border-slate-200'
                      : 'bg-rose-50/70 border-rose-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-teal-700">
                        {bk.booking_number}
                      </span>
                      <span className="font-bold text-slate-900">{bk.party_name}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                        Town: {bk.town_name} {bk.area_name ? `/ ${bk.area_name}` : ''}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Salesman: {bk.salesman_name}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        bk.is_valid
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {bk.is_duplicate ? 'Duplicate Prevented' : bk.is_valid ? 'Valid & Ready' : 'Validation Error'}
                    </span>
                  </div>

                  {bk.errors?.length > 0 && (
                    <div className="mt-1.5 text-rose-600 font-semibold text-[11px]">
                      Errors: {bk.errors.join(' | ')}
                    </div>
                  )}

                  {bk.lines?.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <th className="py-1 px-2">Item</th>
                            <th className="py-1 px-2 text-center">Qty</th>
                            <th className="py-1 px-2 text-center">Bonus</th>
                            <th className="py-1 px-2 text-center">Offer %</th>
                            <th className="py-1 px-2 text-center">Party %</th>
                            <th className="py-1 px-2">FIFO Batch Allocation</th>
                            <th className="py-1 px-2 text-right">Net Amt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bk.lines.map((ln: any, lIdx: number) => (
                            <tr key={lIdx} className="border-b border-slate-100">
                              <td className="py-1 px-2 font-semibold">
                                {ln.item_name} ({ln.item_code})
                              </td>
                              <td className="py-1 px-2 text-center font-mono">{ln.quantity}</td>
                              <td className="py-1 px-2 text-center font-mono text-amber-700">
                                {ln.bonus_quantity}
                              </td>
                              <td className="py-1 px-2 text-center font-mono">
                                {ln.offer_discount_percent}%
                              </td>
                              <td className="py-1 px-2 text-center font-mono">
                                {ln.party_discount_percent}%
                              </td>
                              <td className="py-1 px-2 font-mono text-indigo-700">
                                {ln.fifo_batches_summary || 'Auto FIFO'}
                              </td>
                              <td className="py-1 px-2 text-right font-mono font-bold text-emerald-700">
                                Rs. {Number(ln.net_amount || 0).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Super Admin Supply Review Queue & Import Batch History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Supplies Pending Super Admin Review Before Dispatch ({pendingSupplies.length})
          </h4>
          {pendingSupplies.length === 0 ? (
            <p className="text-xs text-slate-400">
              All generated supplies have been reviewed by Super Admin.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingSupplies.map((sp) => (
                <div
                  key={sp.id}
                  className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-mono font-bold text-slate-900">
                      {sp.supply_number} — {sp.town_name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Salesman: {sp.salesman_name} • Parties: {sp.total_parties} • Total: Rs.{' '}
                      {Number(sp.total_supply_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApproveSupplyReview(sp.id, sp.supply_number)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve for Dispatch
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <History className="w-4 h-4 text-teal-600" />
            Salesman Booking Import Batch History ({importHistory.length})
          </h4>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
            {importHistory.length === 0 ? (
              <p className="text-xs text-slate-400">No mobile booking imports recorded yet.</p>
            ) : (
              importHistory.map((imp) => (
                <div key={imp.id} className="py-2 text-xs flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold text-teal-700">
                      {imp.import_batch_number} — {imp.file_name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Salesman: {imp.salesman_name} • Bookings: {imp.imported_bookings}/
                      {imp.total_bookings} • Net: Rs. {Number(imp.total_net_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {imp.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
