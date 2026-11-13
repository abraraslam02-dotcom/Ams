import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  FileJson,
  FileSpreadsheet,
  Truck,
  ShieldCheck,
  RefreshCw,
  Smartphone,
  Check,
  History,
  Copy,
  ExternalLink,
  Inbox,
} from 'lucide-react';

interface ImportSalesmanBookingsPanelProps {
  onImportSuccess?: () => void;
  onImportCompleted?: () => void | Promise<void>;
  onOpenMobileApp?: () => void;
}

interface SubmittedMobileBatch {
  id: number;
  batch_hash: string;
  file_name: string;
  excel_file_name: string;
  salesman_id: number;
  salesman_code: string;
  salesman_name: string;
  recipient_email: string;
  total_bookings: number;
  total_amount: number;
  import_status: string;
  imported_count: number;
  submitted_at: string;
  payload: Record<string, unknown> | null;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('ams_auth_token') || sessionStorage.getItem('ams_auth_token') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const ImportSalesmanBookingsPanel: React.FC<ImportSalesmanBookingsPanelProps> = ({
  onImportSuccess,
  onImportCompleted,
  onOpenMobileApp,
}) => {
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [selectedSubmittedBatchId, setSelectedSubmittedBatchId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [submittedBatches, setSubmittedBatches] = useState<SubmittedMobileBatch[]>([]);
  const [pendingSupplies, setPendingSupplies] = useState<any[]>([]);
  const [copiedPwaLink, setCopiedPwaLink] = useState(false);

  const salesmanPwaUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/salesman';
    return `${window.location.origin}/salesman`;
  }, []);

  const fetchHistoryAndPendingSupplies = useCallback(async () => {
    try {
      const [histRes, supRes, batchRes] = await Promise.all([
        fetch('/api/enhancements/booking-imports/history', { headers: getAuthHeaders() }),
        fetch('/api/supply/supplies', { headers: getAuthHeaders() }),
        fetch('/api/enhancements/booking-imports/submitted-batches', { headers: getAuthHeaders() }),
      ]);
      const histData = await histRes.json();
      if (histData.success) {
        setImportHistory(histData.imports || []);
      }
      const supData = await supRes.json();
      if (supData.success && Array.isArray(supData.supplies)) {
        setPendingSupplies(
          supData.supplies.filter((s: any) => Number(s.super_admin_reviewed || 0) === 0)
        );
      }
      const batchData = await batchRes.json();
      if (batchData.success && Array.isArray(batchData.batches)) {
        setSubmittedBatches(batchData.batches);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchHistoryAndPendingSupplies();
  }, [fetchHistoryAndPendingSupplies]);

  const runPreviewValidation = async (
    fileName: string,
    payloadObj: Record<string, unknown>,
    submittedBatchId: number | null = null
  ) => {
    setSelectedFileName(fileName);
    setSelectedSubmittedBatchId(submittedBatchId);
    setBanner(null);
    setLoadingPreview(true);
    try {
      const res = await fetch('/api/enhancements/booking-imports/preview', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          file_name: fileName,
          payload: payloadObj,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to validate booking file');
      }
      setPreviewData(data);
    } catch (err: unknown) {
      setPreviewData(null);
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid booking file.',
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  // Parse either .json or .xlsx Salesman Booking export file
  const handleFileChange = async (file: File) => {
    setBanner(null);
    const lowerName = file.name.toLowerCase();
    try {
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const arrayBuf = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuf, { type: 'array' });
        const itemsSheetName =
          workbook.SheetNames.find((n) => n.toLowerCase().includes('item')) || workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[itemsSheetName]);

        if (!rows || rows.length === 0) {
          throw new Error('The uploaded Excel file contains no booking item rows.');
        }

        const bookingMap = new Map<string, any>();
        for (const row of rows) {
          const bNo = String(row.Booking_Number || row.booking_number || row.booking_no || 'MBK-EXCEL-1').trim();
          const bUuid = String(row.Booking_UUID || row.booking_uuid || bNo).trim();
          let bk = bookingMap.get(bNo);
          if (!bk) {
            bk = {
              booking_uuid: bUuid,
              booking_no: bNo,
              booking_number: bNo,
              booking_date: String(row.Booking_Date || row.booking_date || new Date().toISOString().slice(0, 10)),
              salesman_id: Number(row.Salesman_ID || row.salesman_id || 0),
              salesman_code: String(row.Salesman_Code || row.salesman_code || ''),
              salesman_name: String(row.Salesman_Name || row.salesman_name || ''),
              town_id: Number(row.Town_ID || row.town_id || 0),
              town_name: String(row.Town_Name || row.town_name || ''),
              area_id: Number(row.Area_ID || row.area_id || 0),
              area_name: String(row.Area_Name || row.area_name || ''),
              party_id: Number(row.Party_ID || row.party_id || row.party_account_id || 0),
              party_code: String(row.Party_Code || row.party_code || ''),
              party_name: String(row.Party_Name || row.party_name || ''),
              remarks: String(row.Remarks || row.remarks || ''),
              items: [],
            };
            bookingMap.set(bNo, bk);
          }

          bk.items.push({
            item_id: Number(row.Item_ID || row.item_id || 0),
            item_code: String(row.Item_Code || row.item_code || ''),
            item_name: String(row.Item_Name || row.item_name || ''),
            company_name: String(row.Company_Name || row.company_name || ''),
            pack_size: String(row.Packing || row.pack_size || '1x1'),
            trade_price: Number(row.Trade_Price || row.trade_price || 0),
            quantity: Number(row.Quantity || row.quantity || 0),
            bonus_qty: Number(row.Bonus_Qty || row.bonus_qty || 0),
            remarks: String(row.Remarks || row.remarks || ''),
          });
        }

        await runPreviewValidation(file.name, {
          schema_version: 'AMS_MOBILE_BOOKING_EXCEL_V1',
          bookings: Array.from(bookingMap.values()),
        });
      } else {
        const text = await file.text();
        const parsed = JSON.parse(text);
        await runPreviewValidation(file.name, parsed);
      }
    } catch (err: unknown) {
      setPreviewData(null);
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not parse uploaded booking file.',
      });
    }
  };

  const handleCommitImport = async (generateSupply: boolean) => {
    if (!previewData) return;
    const validBookings = (previewData.bookings || []).filter((b: any) => b.is_valid && !b.is_duplicate);
    if (validBookings.length === 0) {
      setBanner({
        type: 'error',
        message: 'No valid non-duplicate bookings available to import.',
      });
      return;
    }

    setCommitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/enhancements/booking-imports/commit', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          file_name: selectedFileName || 'Mobile_Booking.json',
          submitted_batch_id: selectedSubmittedBatchId,
          bookings: validBookings,
          generate_supply: generateSupply,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to commit booking import');
      }

      setBanner({
        type: 'success',
        message: data.message || `Imported ${validBookings.length} booking(s) successfully.`,
      });
      setPreviewData(null);
      setSelectedFileName('');
      setSelectedSubmittedBatchId(null);
      await fetchHistoryAndPendingSupplies();
      if (onImportSuccess) onImportSuccess();
      if (onImportCompleted) await onImportCompleted();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Import failed',
      });
    } finally {
      setCommitting(false);
    }
  };

  const handleApproveSupplyReview = async (supplyId: number, supplyNo: string) => {
    try {
      const res = await fetch(`/api/enhancements/booking-imports/supplies/${supplyId}/approve-review`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to approve supply review');
      }
      setBanner({
        type: 'success',
        message: `Supply ${supplyNo} reviewed and approved by Super Admin for Dispatch & Final Invoice Conversion.`,
      });
      await fetchHistoryAndPendingSupplies();
      if (onImportSuccess) onImportSuccess();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Approval failed',
      });
    }
  };

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(salesmanPwaUrl).then(() => {
        setCopiedPwaLink(true);
        setTimeout(() => setCopiedPwaLink(false), 2500);
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Dedicated Salesman Booking PWA Live URL & Installation Banner */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 text-white rounded-2xl p-4 shadow-md flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold uppercase tracking-wider">
              Separate Installable Android PWA
            </span>
            <span className="text-xs text-emerald-200 font-semibold">
              Super Admin Recipient: abrar.aslam02@gmail.com
            </span>
          </div>
          <h3 className="text-sm font-extrabold">
            Salesman Field Booking PWA URL:{' '}
            <code className="px-2 py-0.5 rounded bg-black/40 text-emerald-300 font-mono text-xs">
              {salesmanPwaUrl}
            </code>
          </h3>
          <p className="text-xs text-slate-300">
            Share this link with salesmen to open in Google Chrome on Android and tap <strong>"Install App"</strong>. Bookings sync here automatically and via JSON/Excel email.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-1.5 border border-white/15 cursor-pointer"
          >
            {copiedPwaLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copiedPwaLink ? 'Copied PWA URL!' : 'Copy Salesman PWA URL'}
          </button>

          <a
            href="/salesman"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open /salesman PWA
          </a>
        </div>
      </div>

      {/* Main Import Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white flex items-center justify-center shadow-sm">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Import Salesman Bookings (JSON / Excel .xlsx & Direct Mobile Sync)
              </h3>
              <p className="text-xs text-slate-500">
                Upload finalized Salesman Booking files (.json or .xlsx) or one-click load batches transmitted from the Salesman Booking PWA.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenMobileApp && (
              <button
                type="button"
                onClick={onOpenMobileApp}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-4 h-4 text-emerald-400" />
                Preview Salesman App
              </button>
            )}
            <button
              type="button"
              onClick={fetchHistoryAndPendingSupplies}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
              title="Refresh Submissions & History"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {banner && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              banner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-semibold">{banner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs font-bold px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Direct Mobile PWA Submitted Batches Queue */}
        {submittedBatches.length > 0 && (
          <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                <Inbox className="w-4 h-4 text-emerald-600" />
                Finalized Bookings Received from Salesman PWA ({submittedBatches.length})
              </span>
              <span className="text-[11px] text-emerald-700">
                Click "Validate & Preview" to import directly without manual file download
              </span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {submittedBatches.map((batch) => (
                <div
                  key={batch.id}
                  className="bg-white border border-emerald-200/80 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-teal-800">{batch.file_name}</span>
                      <span className="font-bold text-slate-900">
                        {batch.salesman_name} ({batch.salesman_code})
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          batch.import_status === 'Imported'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {batch.import_status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Submitted: {batch.submitted_at} • Bookings: {batch.total_bookings} • Est. Total: Rs.{' '}
                      {Number(batch.total_amount || 0).toLocaleString()} • Emailed to: {batch.recipient_email}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!batch.payload || loadingPreview}
                    onClick={() => {
                      if (batch.payload) {
                        runPreviewValidation(batch.file_name, batch.payload, batch.id);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white font-bold text-xs cursor-pointer"
                  >
                    {batch.import_status === 'Imported' ? 'Re-Check / View' : 'Validate & Preview'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Dropzone (.json & .xlsx) */}
        <div className="border-2 border-dashed border-teal-300 bg-teal-50/40 rounded-2xl p-5 text-center space-y-2">
          <input
            type="file"
            accept=".json,application/json,.xlsx,.xls"
            id="salesman-booking-file-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileChange(f);
            }}
          />
          <label
            htmlFor="salesman-booking-file-input"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs shadow-md cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            {loadingPreview
              ? 'Validating Salesman Booking File...'
              : 'Select Salesman Booking Export File (.json or .xlsx)'}
          </label>
          <div className="text-xs text-slate-600 flex items-center justify-center gap-3">
            <span className="inline-flex items-center gap-1">
              <FileJson className="w-3.5 h-3.5 text-teal-600" /> JSON (.json)
            </span>
            <span className="inline-flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
            </span>
            <span>
              {selectedFileName
                ? `• Loaded: ${selectedFileName}`
                : '• Automatic duplicate & FIFO batch validation'}
            </span>
          </div>
        </div>

        {/* Validation Preview */}
        {previewData && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Validation Summary — {previewData.total_bookings} Booking(s) ({previewData.valid_bookings} Valid,{' '}
                  {previewData.duplicate_bookings} Duplicate Prevented)
                </h4>
                {previewData.already_imported_file && (
                  <p className="text-xs text-rose-600 font-bold mt-0.5">
                    Duplicate Warning: This exact file hash was previously imported under batch{' '}
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
                      Salesman: {imp.salesman_name} • Bookings: {imp.valid_bookings_count ?? imp.imported_bookings ?? 0}/
                      {imp.total_bookings_in_file ?? imp.total_bookings ?? 0}
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
