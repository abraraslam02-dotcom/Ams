import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowDownLeft,
  Save,
  Printer,
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  RefreshCw,
  Search,
  ChevronDown,
  X,
} from 'lucide-react';
import { Account } from '../../types/account';
import {
  PurchaseInvoice,
  PurchaseLineItem,
  PurchaseReturn,
  PurchaseReturnLineItem,
} from '../../types/purchase';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';

interface PurchaseReturnPanelProps {
  suppliers: Account[];
  financialAccounts: Account[];
  purchases: PurchaseInvoice[];
  returns: PurchaseReturn[];
  nextReturnNumber: string;
  onReturnCreated: (newReturnId: number) => void;
  onPrintReturn: (returnId: number) => void;
}

const round2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export const PurchaseReturnPanel: React.FC<PurchaseReturnPanelProps> = ({
  suppliers,
  financialAccounts,
  purchases,
  returns,
  nextReturnNumber,
  onReturnCreated,
  onPrintReturn,
}) => {
  const [debitNoteNumber, setDebitNoteNumber] = useState(nextReturnNumber);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>('');
  const [settlementMode, setSettlementMode] = useState<
    'Account Adjustment' | 'Cash Refund' | 'Bank Refund'
  >('Account Adjustment');
  const [settlementAccountId, setSettlementAccountId] = useState<string>('');
  const [returnReason, setReturnReason] = useState('Near-Expiry / Damaged Batch Return');

  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<PurchaseInvoice | null>(
    null
  );
  const [returnLines, setReturnLines] = useState<PurchaseReturnLineItem[]>([]);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [supplierSearchQuery, setSupplierSearchQuery] = useState<string>('');
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState<boolean>(false);
  const [supplierHighlightIdx, setSupplierHighlightIdx] = useState<number>(0);
  const supplierBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDebitNoteNumber(nextReturnNumber);
  }, [nextReturnNumber]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (supplierBoxRef.current && !supplierBoxRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const selectedSupplierObj = useMemo(
    () => suppliers.find((s) => String(s.id) === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  useEffect(() => {
    if (selectedSupplierObj && !supplierDropdownOpen) {
      setSupplierSearchQuery(
        `[${selectedSupplierObj.account_code}] ${selectedSupplierObj.account_name}`
      );
    } else if (!selectedSupplierObj && !supplierDropdownOpen) {
      setSupplierSearchQuery('');
    }
  }, [selectedSupplierObj, supplierDropdownOpen]);

  const filteredSuppliers = useMemo(() => {
    const formatted = selectedSupplierObj
      ? `[${selectedSupplierObj.account_code}] ${selectedSupplierObj.account_name}`
      : '';
    const q =
      supplierSearchQuery.trim() === formatted ? '' : supplierSearchQuery.trim().toLowerCase();
    if (!q) return suppliers;
    const tokens = q.split(/\s+/).filter(Boolean);
    return suppliers.filter((s) => {
      const hay = `${s.account_name || ''} ${s.account_code || ''} ${s.phone || ''} ${
        s.contact_person || ''
      }`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [suppliers, supplierSearchQuery, selectedSupplierObj]);

  const activeSupplierPurchases = purchases.filter(
    (p) =>
      p.status === 'completed' &&
      (!selectedSupplierId || p.supplier_account_id === parseInt(selectedSupplierId, 10))
  );

  const handleSelectPurchaseInvoice = async (purIdStr: string) => {
    setSelectedPurchaseId(purIdStr);
    setError(null);
    setSuccessMsg(null);

    if (!purIdStr) {
      setSelectedInvoiceDetails(null);
      setReturnLines([]);
      return;
    }

    try {
      setLoadingInvoice(true);
      const purId = parseInt(purIdStr, 10);
      const res = await api.getPurchaseDetails(purId);
      const inv: PurchaseInvoice = res.purchase;
      const items: PurchaseLineItem[] = res.items || [];

      setSelectedInvoiceDetails(inv);
      setSelectedSupplierId(String(inv.supplier_account_id));

      const mapped: PurchaseReturnLineItem[] = items.map((it) => {
        const purchasedQty = round2(it.quantity);
        const alreadyRet = round2(it.returned_quantity || 0);
        const eligible = Math.max(0, round2(purchasedQty - alreadyRet));
        return {
          original_purchase_item_id: it.id!,
          item_id: it.item_id,
          inventory_id: it.inventory_id,
          item_code: it.item_code,
          company_name: it.company_name,
          item_name: it.item_name,
          packing: it.packing,
          units_per_pack: it.units_per_pack || 1,
          batch_number: it.batch_number,
          manufacturing_date: it.manufacturing_date || '',
          expiry_date: it.expiry_date,
          purchased_quantity: purchasedQty,
          already_returned_quantity: alreadyRet,
          eligible_quantity: eligible,
          return_quantity: 0,
          debit_unit_rate: round2(it.purchase_rate),
          discount_percent: round2(it.discount_percent),
          discount_amount: 0,
          taxable_amount: 0,
          tax_percent: round2(it.tax_percent),
          gst_amount: 0,
          advance_tax_rate: round2(inv.advance_tax_rate || 0),
          advance_tax_amount: 0,
          line_total: 0,
          return_reason: returnReason,
        };
      });

      setReturnLines(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInvoice(false);
    }
  };

  const recalculateLine = (
    line: PurchaseReturnLineItem,
    invDetails: PurchaseInvoice | null
  ): PurchaseReturnLineItem => {
    const qty = Math.max(0, round2(line.return_quantity));
    const rate = Math.max(0, round2(line.debit_unit_rate));
    const discPct = Math.max(0, round2(line.discount_percent));
    const gstPct = Math.max(0, round2(line.tax_percent));
    const advPct = Math.max(0, round2(line.advance_tax_rate));

    const gross = round2(qty * rate);
    const itemDisc = round2(gross * (discPct / 100));

    // Also include prorated invoice discount if original invoice had invoice_discount_amount > 0
    let invDiscShare = 0;
    if (invDetails && Number(invDetails.invoice_discount_amount || 0) > 0) {
      const origSubtotalAfterItemDisc = round2(
        Number(invDetails.gross_total || 0) - Number(invDetails.item_discount_amount || 0)
      );
      if (origSubtotalAfterItemDisc > 0) {
        const ratio = Number(invDetails.invoice_discount_amount) / origSubtotalAfterItemDisc;
        invDiscShare = round2((gross - itemDisc) * ratio);
      }
    }

    const totalDisc = round2(itemDisc + invDiscShare);
    const taxable = round2(gross - totalDisc);
    const gstAmt = round2(taxable * (gstPct / 100));

    let advBase = round2(taxable + gstAmt);
    if (invDetails?.advance_tax_basis === 'taxable_amount') {
      advBase = taxable;
    } else if (invDetails?.advance_tax_basis === 'gross_amount') {
      advBase = gross;
    }
    const advAmt = round2(advBase * (advPct / 100));
    const netLine = round2(taxable + gstAmt + advAmt);

    return {
      ...line,
      return_quantity: qty,
      debit_unit_rate: rate,
      discount_percent: discPct,
      discount_amount: totalDisc,
      taxable_amount: taxable,
      tax_percent: gstPct,
      gst_amount: gstAmt,
      advance_tax_rate: advPct,
      advance_tax_amount: advAmt,
      line_total: netLine,
    };
  };

  const updateLineField = (
    idx: number,
    field: keyof PurchaseReturnLineItem,
    value: string | number
  ) => {
    setReturnLines((prev) => {
      const copy = [...prev];
      const updated = { ...copy[idx], [field]: value };
      copy[idx] = recalculateLine(updated, selectedInvoiceDetails);
      return copy;
    });
  };

  // Totals across active return lines
  const grossReturnTotal = round2(
    returnLines.reduce((s, l) => s + round2(l.return_quantity * l.debit_unit_rate), 0)
  );
  const discountReturnTotal = round2(returnLines.reduce((s, l) => s + l.discount_amount, 0));
  const taxableReturnTotal = round2(returnLines.reduce((s, l) => s + l.taxable_amount, 0));
  const gstAdjustmentTotal = round2(returnLines.reduce((s, l) => s + l.gst_amount, 0));
  const advTaxAdjustmentTotal = round2(returnLines.reduce((s, l) => s + l.advance_tax_amount, 0));
  const automaticReturnAmount = round2(
    taxableReturnTotal + gstAdjustmentTotal + advTaxAdjustmentTotal
  );

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!selectedPurchaseId) {
      setError('Please select the Original Purchase Invoice first.');
      return;
    }

    const activeLines = returnLines.filter((l) => l.return_quantity > 0);
    if (activeLines.length === 0) {
      setError('Please enter a Return Quantity greater than 0 for at least one item.');
      return;
    }

    for (const line of activeLines) {
      if (line.return_quantity > (line.eligible_quantity ?? line.purchased_quantity)) {
        setError(
          `Return quantity (${line.return_quantity}) for "${line.item_name}" (Batch: ${line.batch_number}) exceeds maximum eligible quantity (${line.eligible_quantity}).`
        );
        return;
      }
    }

    try {
      setSaving(true);
      const res = await api.createPurchaseReturn({
        debit_note_number: debitNoteNumber,
        return_date: returnDate,
        original_purchase_id: parseInt(selectedPurchaseId, 10),
        supplier_account_id: parseInt(selectedSupplierId, 10),
        settlement_mode: settlementMode,
        settlement_account_id: settlementAccountId ? parseInt(settlementAccountId, 10) : null,
        return_reason: returnReason,
        items: activeLines,
      });

      setSuccessMsg(res.message);
      setSelectedPurchaseId('');
      setSelectedInvoiceDetails(null);
      setReturnLines([]);
      onReturnCreated(res.purchaseReturn.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-semibold">{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Purchase Return Form Card */}
      <form
        onSubmit={handleSubmitReturn}
        className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
      >
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-rose-950 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowDownLeft className="w-4 h-4 text-rose-400" />
            <div>
              <h3 className="text-sm font-bold">
                Purchase Return (Debit Note to Supplier)
              </h3>
              <p className="text-[11px] text-slate-300">
                Reduces batch stock, adjusts GST & Advance Tax, and updates Supplier Payable ledger
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-200 border border-rose-500/30 font-mono text-xs font-bold">
            {debitNoteNumber}
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Header Selection Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Debit Note Number
              </label>
              <input
                type="text"
                required
                readOnly
                value={debitNoteNumber}
                title="Auto-generated Purchase Return Number"
                className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-100 text-slate-900 cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Return Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
              />
            </div>

            <div ref={supplierBoxRef} className="space-y-1 relative">
              <label className="block text-xs font-semibold text-slate-700">
                1. Search &amp; Select Supplier <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={supplierSearchQuery}
                  onFocus={() => {
                    setSupplierDropdownOpen(true);
                    setSupplierHighlightIdx(0);
                  }}
                  onChange={(e) => {
                    setSupplierSearchQuery(e.target.value);
                    setSupplierDropdownOpen(true);
                    setSupplierHighlightIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSupplierDropdownOpen(true);
                      setSupplierHighlightIdx((prev) =>
                        Math.min(prev + 1, Math.max(0, filteredSuppliers.length - 1))
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSupplierHighlightIdx((prev) => Math.max(0, prev - 1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const chosen =
                        filteredSuppliers[supplierHighlightIdx] || filteredSuppliers[0];
                      if (chosen) {
                        setSelectedSupplierId(String(chosen.id));
                        setSelectedPurchaseId('');
                        setSelectedInvoiceDetails(null);
                        setReturnLines([]);
                        setSupplierDropdownOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setSupplierDropdownOpen(false);
                    }
                  }}
                  placeholder="Search Supplier Name / Code / Mobile..."
                  className="w-full pl-8 pr-12 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  {selectedSupplierId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplierId('');
                        setSupplierSearchQuery('');
                        setSelectedPurchaseId('');
                        setSelectedInvoiceDetails(null);
                        setReturnLines([]);
                      }}
                      className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                      title="Show All Suppliers"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSupplierDropdownOpen((prev) => !prev)}
                    className="p-0.5 text-slate-500 cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {supplierDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white rounded-lg border border-slate-300 shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelectedSupplierId('');
                      setSupplierSearchQuery('');
                      setSelectedPurchaseId('');
                      setSelectedInvoiceDetails(null);
                      setReturnLines([]);
                      setSupplierDropdownOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    — All Suppliers —
                  </button>
                  {filteredSuppliers.map((s, idx) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseEnter={() => setSupplierHighlightIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedSupplierId(String(s.id));
                        setSelectedPurchaseId('');
                        setSelectedInvoiceDetails(null);
                        setReturnLines([]);
                        setSupplierDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left flex items-center justify-between cursor-pointer ${
                        idx === supplierHighlightIdx
                          ? 'bg-rose-50 text-slate-950 font-semibold'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900">
                          <span className="font-mono text-rose-700">[{s.account_code}]</span>{' '}
                          {s.account_name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          Mobile: {s.phone || 'N/A'}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {s.filer_status || 'Filer'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                2. Select Original Purchase Invoice <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={selectedPurchaseId}
                onChange={(e) => handleSelectPurchaseInvoice(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-400 bg-rose-50/30 text-slate-900"
              >
                <option value="">— Select Purchase Invoice —</option>
                {activeSupplierPurchases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.bill_number} | {p.supplier_name} | {p.bill_date} | Net: {formatPKR(p.net_total)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                Return Reason <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. Damaged packaging, Near-expiry batch recall, Excess quantity..."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Settlement Mode</label>
              <select
                value={settlementMode}
                onChange={(e) =>
                  setSettlementMode(
                    e.target.value as 'Account Adjustment' | 'Cash Refund' | 'Bank Refund'
                  )
                }
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
              >
                <option value="Account Adjustment">Supplier Payable Adjustment (Standard)</option>
                <option value="Cash Refund">Immediate Cash Refund</option>
                <option value="Bank Refund">Immediate Bank Refund</option>
              </select>
            </div>

            {settlementMode !== 'Account Adjustment' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Refund Receiving Account
                </label>
                <select
                  value={settlementAccountId}
                  onChange={(e) => setSettlementAccountId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
                >
                  <option value="">— Default Cash / Bank —</option>
                  {financialAccounts.map((fa) => (
                    <option key={fa.id} value={fa.id}>
                      [{fa.account_code}] {fa.account_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Selected Invoice Items & Batch Return Table */}
          {loadingInvoice ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading original purchase invoice items and batch availability...
            </div>
          ) : selectedInvoiceDetails ? (
            <div className="space-y-4">
              <div className="border border-slate-300 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3">Item & Packing</th>
                      <th className="py-2.5 px-2.5">Batch # & Expiry</th>
                      <th className="py-2.5 px-2.5 text-right">Purchased</th>
                      <th className="py-2.5 px-2.5 text-right">Prev. Returned</th>
                      <th className="py-2.5 px-2.5 text-right">Max Eligible</th>
                      <th className="py-2.5 px-2.5 text-right w-28">Return Qty</th>
                      <th className="py-2.5 px-2.5 text-right w-28">Return Rate</th>
                      <th className="py-2.5 px-2.5 text-right w-20">Disc %</th>
                      <th className="py-2.5 px-2.5 text-right">GST Adj.</th>
                      <th className="py-2.5 px-2.5 text-right">Adv Tax Adj.</th>
                      <th className="py-2.5 px-3 text-right">Auto Return Amt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {returnLines.map((line, idx) => {
                      const overLimit =
                        line.return_quantity > (line.eligible_quantity ?? line.purchased_quantity);
                      return (
                        <tr
                          key={line.original_purchase_item_id}
                          className={line.return_quantity > 0 ? 'bg-rose-50/40' : 'hover:bg-slate-50'}
                        >
                          <td className="py-2 px-3">
                            <div className="font-bold text-slate-900">{line.item_name}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {line.item_code} &bull; {line.company_name} &bull; {line.packing}
                            </div>
                          </td>
                          <td className="py-2 px-2.5 font-mono">
                            <div className="font-bold text-slate-900">{line.batch_number}</div>
                            <div className="text-[10px] text-slate-500">Exp: {line.expiry_date}</div>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono font-semibold">
                            {line.purchased_quantity}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono text-slate-500">
                            {line.already_returned_quantity || 0}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">
                            {line.eligible_quantity}
                          </td>
                          <td className="py-2 px-2.5">
                            <NumericInput
                              step="0.01"
                              min="0"
                              max={line.eligible_quantity}
                              value={line.return_quantity}
                              onChange={(e) =>
                                updateLineField(
                                  idx,
                                  'return_quantity',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className={`w-full px-2 py-1 text-right font-mono font-black rounded border ${
                                overLimit
                                  ? 'border-rose-500 bg-rose-100 text-rose-900'
                                  : line.return_quantity > 0
                                  ? 'border-rose-400 bg-white text-rose-800'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <NumericInput
                              step="0.01"
                              min="0"
                              value={line.debit_unit_rate}
                              onChange={(e) =>
                                updateLineField(
                                  idx,
                                  'debit_unit_rate',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-full px-2 py-1 text-right font-mono rounded border border-slate-300 bg-white text-slate-900"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <NumericInput
                              step="0.01"
                              min="0"
                              max="100"
                              value={line.discount_percent}
                              onChange={(e) =>
                                updateLineField(
                                  idx,
                                  'discount_percent',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-full px-2 py-1 text-right font-mono rounded border border-slate-300 bg-white text-slate-900"
                            />
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono text-[11px]">
                            <div>{line.gst_amount.toFixed(2)}</div>
                            <div className="text-[9px] text-slate-400">({line.tax_percent}%)</div>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono text-[11px]">
                            <div>{line.advance_tax_amount.toFixed(2)}</div>
                            <div className="text-[9px] text-amber-700">
                              ({line.advance_tax_rate}%)
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-black text-slate-900">
                            {line.line_total.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Automatic Return Summary Bar */}
              <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-6 text-xs">
                  <div>
                    <span className="text-slate-500">Gross Return:</span>{' '}
                    <span className="font-mono font-bold text-slate-900">
                      {formatPKR(grossReturnTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Return Discount:</span>{' '}
                    <span className="font-mono font-bold text-rose-700">
                      - {formatPKR(discountReturnTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Taxable Return:</span>{' '}
                    <span className="font-mono font-bold text-slate-900">
                      {formatPKR(taxableReturnTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">GST Adjustment:</span>{' '}
                    <span className="font-mono font-bold text-slate-900">
                      + {formatPKR(gstAdjustmentTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Advance Tax Adjustment:</span>{' '}
                    <span className="font-mono font-bold text-amber-900">
                      + {formatPKR(advTaxAdjustmentTotal)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-rose-800">
                      Automatic Return Amount (Debit Note)
                    </div>
                    <div className="text-lg font-black font-mono text-rose-950">
                      {formatPKR(automaticReturnAmount)}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving || automaticReturnAmount <= 0}
                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Posting Return...' : 'Confirm Purchase Return'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
              Select a <strong>Supplier</strong> and an{' '}
              <strong>Original Purchase Invoice</strong> above to load eligible items & batches for
              return.
            </div>
          )}
        </div>
      </form>

      {/* Purchase Return History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-rose-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Purchase Return Register / History ({returns.length} Debit Notes)
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Double-entry posted • Click Print A4 for Supplier Debit Note
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-4">Debit Note #</th>
                <th className="py-2.5 px-3">Return Date</th>
                <th className="py-2.5 px-3">Original Bill #</th>
                <th className="py-2.5 px-3">Supplier</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3 text-right">Taxable</th>
                <th className="py-2.5 px-3 text-right">GST + Adv. Tax</th>
                <th className="py-2.5 px-3 text-right">Total Debit Amt</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No purchase returns recorded yet.
                  </td>
                </tr>
              ) : (
                returns.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-bold text-rose-700">
                      {r.debit_note_number}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{r.return_date}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                      {r.original_bill_number}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{r.supplier_name}</div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {r.supplier_code} &bull; {r.supplier_filer_status}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{r.return_reason}</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatPKR(r.taxable_return_amount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-800">
                      {formatPKR(
                        round2(
                          Number(r.gst_adjustment_amount || 0) +
                            Number(r.advance_tax_adjustment_amount || 0)
                        )
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.total_debit_amount)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onPrintReturn(r.id)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>View / Print A4</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
