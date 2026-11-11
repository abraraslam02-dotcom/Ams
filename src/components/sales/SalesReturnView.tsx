import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { SalesInvoiceRecord, SaleReturnRecord } from '../../types/sales';
import { formatPKR } from '../../utils/formatters';
import { RotateCcw, CheckCircle2, AlertCircle, Eye, X, Printer } from 'lucide-react';
import { SalesPrintModal } from './SalesPrintModal';
import { NumericInput } from '../common/NumericInput';

interface SalesReturnViewProps {
  initialMode?: 'entry' | 'register';
}

export const SalesReturnView: React.FC<SalesReturnViewProps> = ({ initialMode = 'entry' }) => {
  const [mode, setMode] = useState<'entry' | 'register'>(initialMode);
  const [completedSales, setCompletedSales] = useState<SalesInvoiceRecord[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number>(0);
  const [selectedSaleDetails, setSelectedSaleDetails] = useState<SalesInvoiceRecord | null>(null);

  const [returnNumber, setReturnNumber] = useState<string>('SRN-2026-0001');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [refundMode, setRefundMode] = useState<'Account Adjustment' | 'Cash Refund' | 'Bank Refund'>(
    'Account Adjustment'
  );
  const [returnReason, setReturnReason] = useState<string>('Customer medicine return');
  const [returnInputs, setReturnInputs] = useState<
    Record<number, { returnPackQty: number; returnLooseQty: number; returnRate: number }>
  >({});

  const [returnsList, setReturnsList] = useState<SaleReturnRecord[]>([]);
  const [viewReturnDetail, setViewReturnDetail] = useState<SaleReturnRecord | null>(null);
  const [printReturnRecord, setPrintReturnRecord] = useState<SaleReturnRecord | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const loadData = useCallback(async () => {
    try {
      const [salesRes, nextNums, retRes] = await Promise.all([
        api.getSales({ status: 'completed', pageSize: 100 }),
        api.getNextSalesNumbers(),
        api.getSaleReturns(),
      ]);
      setCompletedSales(salesRes.data || []);
      setReturnNumber(nextNums.nextReturnNumber);
      setReturnsList(retRes.data || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectOriginalInvoice = async (saleId: number) => {
    setSelectedSaleId(saleId);
    setErrorMsg(null);
    if (!saleId) {
      setSelectedSaleDetails(null);
      setReturnInputs({});
      return;
    }
    try {
      const res = await api.getSaleDetails(saleId);
      const inv = res.data as SalesInvoiceRecord;
      setSelectedSaleDetails(inv);
      const initMap: Record<
        number,
        { returnPackQty: number; returnLooseQty: number; returnRate: number }
      > = {};
      for (const item of inv.items || []) {
        initMap[item.id] = {
          returnPackQty: 0,
          returnLooseQty: 0,
          returnRate: Number(item.unit_price || 0),
        };
      }
      setReturnInputs(initMap);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent, shouldPrintAfter = false) => {
    e.preventDefault();
    if (!selectedSaleDetails) {
      setErrorMsg('Please select an Original Sales Invoice first.');
      return;
    }

    const itemsPayload = (selectedSaleDetails.items || [])
      .map((line: any) => {
        const inp = returnInputs[line.id] || {
          returnPackQty: 0,
          returnLooseQty: 0,
          returnRate: Number(line.unit_price || 0),
        };
        return {
          original_sale_item_id: line.id,
          return_pack_qty: Number(inp.returnPackQty || 0),
          return_loose_qty: Number(inp.returnLooseQty || 0),
          return_rate: Number(inp.returnRate || line.unit_price || 0),
          return_reason: returnReason,
        };
      })
      .filter((i) => i.return_pack_qty > 0 || i.return_loose_qty > 0);

    if (itemsPayload.length === 0) {
      setErrorMsg('Please enter a return quantity (Box or Loose) for at least one item.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg(null);
      const res = await api.createSaleReturn({
        return_number: returnNumber,
        return_date: returnDate,
        original_sale_id: selectedSaleDetails.id,
        refund_mode: refundMode,
        return_reason: returnReason,
        items: itemsPayload,
      });

      setSuccessMsg(
        `Sales Return ${res.data.return_number} saved! Batch stock restored & Customer Ledger updated.`
      );
      if (shouldPrintAfter && res.data?.id) {
        const detailRes = await api.getSaleReturnDetails(res.data.id);
        setPrintReturnRecord(detailRes.data);
      }
      setSelectedSaleId(0);
      setSelectedSaleDetails(null);
      setReturnInputs({});
      await loadData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewReturn = async (id: number) => {
    const res = await api.getSaleReturnDetails(id);
    setViewReturnDetail(res.data);
  };

  const handleOpenPrintReturn = async (id: number) => {
    try {
      const res = await api.getSaleReturnDetails(id);
      setPrintReturnRecord(res.data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Automatic calculation preview
  const previewRefundTotal = (selectedSaleDetails?.items || []).reduce((sum: number, line: any) => {
    const inp = returnInputs[line.id];
    if (!inp) return sum;
    const unitsPerPack = Math.max(1, Number(line.units_per_pack || 1));
    const looseRate = Number(line.loose_rate || inp.returnRate / unitsPerPack);
    const gross = inp.returnPackQty * inp.returnRate + inp.returnLooseQty * looseRate;
    const disc = (gross * Number(line.discount_percent || 0)) / 100;
    const taxable = Math.max(0, gross - disc);
    const tax = (taxable * Number(line.tax_percent || 0)) / 100;
    return sum + taxable + tax;
  }, 0);

  return (
    <div className="space-y-4">
      {/* Sub-navigation Toggle */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">
            Sales Return & Stock Restoration Module (Credit Note & Thermal/A4 Printing)
          </h3>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => setMode('entry')}
            className={`px-3 py-1 rounded-md cursor-pointer ${
              mode === 'entry' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            New Sales Return
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`px-3 py-1 rounded-md cursor-pointer ${
              mode === 'register'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sales Return Register ({returnsList.length})
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {mode === 'entry' ? (
        <form
          onSubmit={(e) => handleSubmitReturn(e, false)}
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4 text-xs"
        >
          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Return Number
              </label>
              <input
                type="text"
                readOnly
                value={returnNumber}
                title="Auto-generated Sale Return Number"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold bg-slate-100 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Return Date
              </label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Select Original Sales Invoice
              </label>
              <select
                value={selectedSaleId}
                onChange={(e) => handleSelectOriginalInvoice(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value={0}>-- Select Completed Sales Invoice --</option>
                {completedSales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.invoice_number} • {s.customer_name} • {s.invoice_date} (
                    {formatPKR(s.net_total)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Settlement / Refund Mode
              </label>
              <select
                value={refundMode}
                onChange={(e) =>
                  setRefundMode(
                    e.target.value as 'Account Adjustment' | 'Cash Refund' | 'Bank Refund'
                  )
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value="Account Adjustment">Customer Account Credit</option>
                <option value="Cash Refund">Cash Refund</option>
                <option value="Bank Refund">Bank Refund</option>
              </select>
            </div>
          </div>

          {selectedSaleDetails && (
            <>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500">Customer: </span>
                  <strong className="text-slate-900">{selectedSaleDetails.customer_name}</strong>
                  <span className="ml-4 text-slate-500">Original Invoice #: </span>
                  <strong className="font-mono text-slate-900">
                    {selectedSaleDetails.invoice_number}
                  </strong>
                </div>
                <div className="font-mono font-bold text-emerald-700">
                  Original Net Bill: {formatPKR(selectedSaleDetails.net_total)}
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-slate-900 text-white">
                    <tr>
                      <th className="p-2">Item Code & Name</th>
                      <th className="p-2 text-center">Packing</th>
                      <th className="p-2 text-center">Original Batch</th>
                      <th className="p-2 text-right">Sold (Packs / Loose)</th>
                      <th className="p-2 text-right">Eligible Units</th>
                      <th className="p-2 text-right bg-emerald-950">Return Pack Qty</th>
                      <th className="p-2 text-right bg-teal-950">Return Loose Qty</th>
                      <th className="p-2 text-right">Return Rate (Pack)</th>
                      <th className="p-2 text-right">Return Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSaleDetails.items || []).map((line: any) => {
                      const inp = returnInputs[line.id] || {
                        returnPackQty: 0,
                        returnLooseQty: 0,
                        returnRate: Number(line.unit_price || 0),
                      };
                      const eligibleUnits = Number(
                        line.eligible_return_units ??
                          Number(line.total_units || 0) - Number(line.returned_total_units || 0)
                      );
                      const unitsPerPack = Math.max(1, Number(line.units_per_pack || 1));
                      const looseRate = Number(line.loose_rate || inp.returnRate / unitsPerPack);
                      const lineGross =
                        inp.returnPackQty * inp.returnRate + inp.returnLooseQty * looseRate;
                      const lineDisc = (lineGross * Number(line.discount_percent || 0)) / 100;
                      const lineTotal = Math.max(0, lineGross - lineDisc);

                      return (
                        <tr key={line.id} className="border-b border-slate-200">
                          <td className="p-2 font-bold">
                            {line.item_name} ({line.item_code})
                          </td>
                          <td className="p-2 text-center font-mono">
                            {line.packing} ({unitsPerPack}u)
                          </td>
                          <td className="p-2 text-center font-mono">
                            {line.batch_number} • {line.expiry_date}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {line.quantity}P{Number(line.bonus_quantity || 0) > 0 ? ` + ${line.bonus_quantity}B` : ''} + {line.loose_quantity}L ({line.total_units}U)
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-700">
                            {eligibleUnits} Units
                          </td>
                          <td className="p-2 bg-emerald-50/40">
                            <NumericInput
                              min="0"
                              step="1"
                              disabled={eligibleUnits <= 0}
                              value={inp.returnPackQty}
                              onChange={(e) =>
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...inp,
                                    returnPackQty: Math.max(0, Number(e.target.value || 0)),
                                  },
                                }))
                              }
                              className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono font-bold bg-white ml-auto block"
                            />
                          </td>
                          <td className="p-2 bg-teal-50/40">
                            <NumericInput
                              min="0"
                              step="1"
                              disabled={eligibleUnits <= 0}
                              value={inp.returnLooseQty}
                              onChange={(e) =>
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...inp,
                                    returnLooseQty: Math.max(0, Number(e.target.value || 0)),
                                  },
                                }))
                              }
                              className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono font-bold bg-white ml-auto block"
                            />
                          </td>
                          <td className="p-2 text-right font-mono">{formatPKR(inp.returnRate)}</td>
                          <td className="p-2 text-right font-mono font-bold">
                            {formatPKR(lineTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex-1 max-w-md">
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Return Reason
                  </label>
                  <input
                    type="text"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold text-slate-500">
                      Automatic Return Amount
                    </div>
                    <div className="text-lg font-black font-mono text-rose-700">
                      {formatPKR(previewRefundTotal)}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs"
                  >
                    Confirm Sales Return
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={(e) => handleSubmitReturn(e as unknown as React.FormEvent, true)}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Printer className="w-3.5 h-3.5 text-emerald-400" />
                    Save & Print Return
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      ) : (
        /* Sales Return Register */
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-900 text-white uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2.5">Return Number</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Original Invoice #</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Settlement Mode</th>
                <th className="px-3 py-2.5 text-right">Return Amount</th>
                <th className="px-3 py-2.5">Reason</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {returnsList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    No Sales Returns recorded yet.
                  </td>
                </tr>
              ) : (
                returnsList.map((sr) => (
                  <tr key={sr.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">
                      {sr.return_number}
                    </td>
                    <td className="px-3 py-2 font-mono">{sr.return_date}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-emerald-700">
                      {sr.original_invoice_number}
                    </td>
                    <td className="px-3 py-2 font-semibold">{sr.customer_name}</td>
                    <td className="px-3 py-2">{sr.refund_mode}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-rose-700">
                      {formatPKR(sr.total_refund_amount)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{sr.return_reason}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenPrintReturn(sr.id)}
                          className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          title="Print / Reprint Sales Return (A4 / 80mm / 58mm)"
                        >
                          <Printer className="w-3 h-3 text-emerald-400" />
                          Print
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewReturn(sr.id)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewReturnDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-3xl p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold">
                Sales Return Details — {viewReturnDetail.return_number} (Against{' '}
                {viewReturnDetail.original_invoice_number})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPrintReturnRecord(viewReturnDetail);
                    setViewReturnDetail(null);
                  }}
                  className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Credit Note
                </button>
                <button
                  type="button"
                  onClick={() => setViewReturnDetail(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <table className="w-full border-collapse border border-slate-200 text-[11px]">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-center">Batch Restored</th>
                  <th className="p-2 text-right">Returned Packs</th>
                  <th className="p-2 text-right">Returned Loose</th>
                  <th className="p-2 text-right">Total Units Restocked</th>
                  <th className="p-2 text-right">Refund Total</th>
                </tr>
              </thead>
              <tbody>
                {(viewReturnDetail.items || []).map((it: any) => (
                  <tr key={it.id} className="border-b border-slate-200">
                    <td className="p-2 font-bold">
                      {it.item_name} ({it.item_code})
                    </td>
                    <td className="p-2 text-center font-mono">{it.batch_number}</td>
                    <td className="p-2 text-right font-mono">{it.return_pack_qty}</td>
                    <td className="p-2 text-right font-mono">{it.return_loose_qty}</td>
                    <td className="p-2 text-right font-mono font-bold text-emerald-700">
                      +{it.returned_units} Units
                    </td>
                    <td className="p-2 text-right font-mono font-bold">
                      {formatPKR(it.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales Return Print Modal (A4, 80mm, 58mm) */}
      <SalesPrintModal
        isOpen={printReturnRecord !== null}
        mode="return"
        saleReturn={printReturnRecord}
        onClose={() => setPrintReturnRecord(null)}
      />
    </div>
  );
};
