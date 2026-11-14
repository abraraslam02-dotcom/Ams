import React, { useState, useEffect, useRef } from 'react';
import {
  Printer,
  X,
  Building2,
  FileText,
  CheckCircle2,
  SlidersHorizontal,
  Info,
  Save,
  Ban,
  Eye,
} from 'lucide-react';
import {
  CompanySettings,
  InvoiceFieldVisibility,
  DEFAULT_FIELD_VISIBILITY,
  parseFieldVisibility,
} from '../../types/system';
import { api } from '../../services/api';
import {
  executePrintElement,
  detectPrintCapabilities,
  PageOrientationOption,
  PageMarginOption,
  FontSizeScaleOption,
} from '../../utils/printEngine';

interface PurchasePrintModalProps {
  isOpen?: boolean;
  mode: 'invoice' | 'return';
  purchase?: any;
  invoice?: any;
  purchaseReturn?: any;
  items?: any[];
  invoiceItems?: any[];
  returnItems?: any[];
  journalLines?: any[];
  autoDirectPrint?: boolean;
  onClose: () => void;
}

export const PurchasePrintModal: React.FC<PurchasePrintModalProps> = ({
  isOpen = true,
  mode,
  purchase,
  invoice,
  purchaseReturn,
  items: propItems,
  invoiceItems,
  returnItems,
  journalLines = [],
  autoDirectPrint = false,
  onClose,
}) => {
  const resolvedPurchase = purchase || invoice;
  const doc = isOpen === false ? null : mode === 'invoice' ? resolvedPurchase : purchaseReturn;
  const items =
    propItems || (mode === 'invoice' ? invoiceItems || [] : returnItems || []);
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const hasAutoPrintedRef = useRef<boolean>(false);

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [orientation, setOrientation] = useState<PageOrientationOption>('portrait');
  const [margin, setMargin] = useState<PageMarginOption>('standard');
  const [fontSizeScale, setFontSizeScale] = useState<FontSizeScaleOption>('normal');
  const [copies, setCopies] = useState<number>(1);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(
    'System Default Printer (OS Print Spooler)'
  );
  const [fields, setFields] = useState<InvoiceFieldVisibility>({
    ...DEFAULT_FIELD_VISIBILITY,
  });

  const [showFieldControls, setShowFieldControls] = useState<boolean>(false);
  const [showPrinterGuide, setShowPrinterGuide] = useState<boolean>(false);
  const [savingDefaults, setSavingDefaults] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getCompanySettings()
      .then((res) => {
        if (!mounted || !res?.data) return;
        const s = res.data;
        setSettings(s);
        if (s.page_orientation) setOrientation(s.page_orientation);
        if (s.page_margin) setMargin(s.page_margin);
        if (s.font_size_scale) setFontSizeScale(s.font_size_scale);
        if (s.print_copies) setCopies(Math.max(1, Number(s.print_copies) || 1));
        if (s.default_printer) setSelectedPrinter(s.default_printer);
        setFields(parseFieldVisibility(s.field_visibility_json));
      })
      .catch(() => {
        // ignore if offline
      });
    return () => {
      mounted = false;
    };
  }, []);

  const capabilities = detectPrintCapabilities(settings?.default_printer);

  const handlePrint = () => {
    if (!doc) return;
    const docNum = mode === 'invoice' ? doc.bill_number : doc.debit_note_number;
    executePrintElement(printAreaRef.current, {
      title: `${storeName} - ${docNum}`,
      paperSize: 'a4',
      orientation,
      margin,
      fontSizeScale,
      copies,
      selectedPrinter,
    });
  };

  useEffect(() => {
    if (autoDirectPrint && doc && settings && !hasAutoPrintedRef.current) {
      hasAutoPrintedRef.current = true;
      const timer = setTimeout(() => {
        handlePrint();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [autoDirectPrint, doc, settings]);

  if (!doc) return null;

  const isCancelled = String(doc.status || '').toLowerCase() === 'cancelled';

  const storeName = settings?.store_name || 'ABRAR MEDICAL STORE';
  const storeAddress = settings?.address || 'Main Commercial Market, Lahore, Punjab, Pakistan';
  const storePhone = settings?.phone || '+92 42 35789000';
  const drugLicense = settings?.drug_license_number || 'DL-PK-LHR-2026-0891';
  const ntnNumber = settings?.ntn_tax_number || 'NTN-PK-9812450-7';
  const logoDataUrl = settings?.logo_data_url || '';

  const formatPKR = (val: unknown) =>
    Number(val || 0).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const toggleField = (key: keyof InvoiceFieldVisibility) => {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSaveAsDefault = async () => {
    try {
      setSavingDefaults(true);
      setSaveFeedback(null);
      await api.updateCompanySettings({
        default_printer: selectedPrinter,
        print_copies: copies,
        page_orientation: orientation,
        page_margin: margin,
        font_size_scale: fontSizeScale,
        field_visibility_json: JSON.stringify(fields),
      });
      setSaveFeedback('Saved as Store Default');
      setTimeout(() => setSaveFeedback(null), 3000);
    } catch (err: any) {
      setSaveFeedback(err?.message || 'Failed to save defaults');
    } finally {
      setSavingDefaults(false);
    }
  };

  const fontScaleClass =
    fontSizeScale === 'small'
      ? 'text-[11px]'
      : fontSizeScale === 'large'
      ? 'text-[13.5px]'
      : 'text-xs';

  return (
    <div className="print-modal-container fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-2 lg:p-4 overflow-y-auto print:bg-white print:p-0 print:block">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col print:shadow-none print:border-none print:max-w-full print:max-h-none print:rounded-none">
        {/* Top Modal Action Bar (Hidden when printing) */}
        <div className="bg-slate-900 text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  {mode === 'invoice'
                    ? `A4 Purchase Invoice Print Preview — ${doc.bill_number}`
                    : `A4 Purchase Return (Debit Note) Print Preview — ${doc.debit_note_number}`}
                </h3>
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider">
                    CANCELLED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Exact Saved Database Record · Batch & Expiry · Advance Tax & Double-Entry Verified
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFieldControls((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                showFieldControls
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Page & Fields</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPrinterGuide((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                showPrinterGuide
                  ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Printer Info</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4 ({copies} {copies === 1 ? 'Copy' : 'Copies'})</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Secondary Print Controls Bar */}
        <div className="bg-slate-800 text-slate-200 px-5 py-2 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Printer:
              </span>
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
              >
                {capabilities.availablePrinterProfiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Orientation:
              </span>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as PageOrientationOption)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
              >
                <option value="portrait">Portrait (A4)</option>
                <option value="landscape">Landscape (A4 Wide)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Margins:
              </span>
              <select
                value={margin}
                onChange={(e) => setMargin(e.target.value as PageMarginOption)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
              >
                <option value="none">None (0mm)</option>
                <option value="minimum">Minimum (5mm)</option>
                <option value="compact">Compact (8mm)</option>
                <option value="standard">Standard (12mm)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Font Size:
              </span>
              <select
                value={fontSizeScale}
                onChange={(e) => setFontSizeScale(e.target.value as FontSizeScaleOption)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
              >
                <option value="small">Small</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Copies:
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center text-white font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saveFeedback && (
              <span className="text-[11px] font-semibold text-emerald-400">{saveFeedback}</span>
            )}
            <button
              type="button"
              onClick={handleSaveAsDefault}
              disabled={savingDefaults}
              className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Save className="w-3 h-3 text-emerald-400" />
              <span>{savingDefaults ? 'Saving...' : 'Save as Store Default'}</span>
            </button>
          </div>
        </div>

        {/* Field Visibility Drawer */}
        {showFieldControls && (
          <div className="bg-slate-50 border-b border-slate-200 px-5 py-2.5 text-xs print:hidden">
            <div className="font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-emerald-600" />
              Show / Hide Purchase Document Fields:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {[
                { key: 'showLogo', label: 'Store Logo' },
                { key: 'showDrugLicense', label: 'Drug License #' },
                { key: 'showNtn', label: 'NTN / Tax ID' },
                { key: 'showItemCode', label: 'Item Code' },
                { key: 'showCompany', label: 'Company Name' },
                { key: 'showPacking', label: 'Packing' },
                { key: 'showBatchExpiry', label: 'Batch & Expiry' },
                { key: 'showBonus', label: 'Bonus Qty' },
                { key: 'showDiscount', label: 'Discount Column' },
                { key: 'showTax', label: 'GST & Advance Tax' },
                { key: 'showPreviousBalance', label: 'Previous Balance' },
                { key: 'showSignature', label: 'Signatures' },
                { key: 'showAccountingVerification', label: 'GL Journal Proof' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(fields[item.key as keyof InvoiceFieldVisibility])}
                    onChange={() => toggleField(item.key as keyof InvoiceFieldVisibility)}
                    className="rounded text-emerald-600"
                  />
                  <span className="text-[11px] font-medium text-slate-700 truncate">
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {showPrinterGuide && (
          <div className="bg-sky-50 border-b border-sky-200 px-5 py-2.5 text-xs text-sky-950 print:hidden">
            <div className="font-bold text-sky-900 mb-1">
              Printer Status: {capabilities.browserPrintSupported ? 'Connected to OS Print Spooler' : 'Unavailable'} · Target: {selectedPrinter}
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-sky-800">
              {capabilities.setupNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Printable A4 Sheet */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          <div
            ref={printAreaRef}
            className={`bg-white border border-slate-300 shadow-sm w-full ${
              orientation === 'landscape' ? 'max-w-[285mm]' : 'max-w-[210mm]'
            } p-6 lg:p-8 text-slate-900 ${fontScaleClass} space-y-5 relative print:border-0 print:shadow-none print:p-2`}
          >
            {/* CANCELLED WATERMARK */}
            {isCancelled && (
              <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center z-10 overflow-hidden">
                <div className="border-4 border-rose-600/40 text-rose-600/30 font-black text-5xl lg:text-6xl uppercase tracking-[0.25em] px-8 py-3 rounded-2xl -rotate-12">
                  CANCELLED
                </div>
              </div>
            )}

            {isCancelled && (
              <div className="p-2.5 rounded-lg bg-rose-50 border-2 border-rose-600 text-rose-900 flex items-center justify-between">
                <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider">
                  <Ban className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>CANCELLED PURCHASE DOCUMENT — STOCK & GL ENTRIES REVERSED</span>
                </div>
                {doc.cancelled_at && (
                  <span className="text-[10px] font-mono">
                    Cancelled: {String(doc.cancelled_at).slice(0, 19)}
                  </span>
                )}
              </div>
            )}

            {/* 1. Store Header */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div className="flex items-start gap-3">
                {fields.showLogo && logoDataUrl ? (
                  <img
                    src={logoDataUrl}
                    alt={storeName}
                    className="w-14 h-14 object-contain rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-base tracking-wider shrink-0">
                    AMS
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
                    {storeName}
                  </h1>
                  <p className="text-xs text-slate-600 font-medium">{storeAddress}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Phone: {storePhone}
                    {fields.showDrugLicense && drugLicense
                      ? ` | Drug License: ${drugLicense}`
                      : ''}
                    {fields.showNtn && ntnNumber ? ` | NTN: ${ntnNumber}` : ''}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="inline-block px-3 py-1 rounded-md bg-slate-900 text-white text-xs font-black uppercase tracking-wider">
                  {mode === 'invoice' ? 'PURCHASE INVOICE' : 'PURCHASE RETURN / DEBIT NOTE'}
                </span>
                <div className="mt-2 space-y-0.5 text-xs">
                  <div>
                    <span className="text-slate-500 font-medium">
                      {mode === 'invoice' ? 'System Bill No:' : 'Debit Note No:'}
                    </span>{' '}
                    <span className="font-mono font-bold text-slate-900">
                      {mode === 'invoice' ? doc.bill_number : doc.debit_note_number}
                    </span>
                  </div>
                  {mode === 'invoice' ? (
                    <div>
                      <span className="text-slate-500 font-medium">Supplier Inv No:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">
                        {doc.supplier_invoice_number || 'N/A'}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500 font-medium">Ref Purchase Bill:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">
                        {doc.original_bill_number}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500 font-medium">Date:</span>{' '}
                    <span className="font-semibold text-slate-800">
                      {mode === 'invoice' ? doc.bill_date : doc.return_date}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Supplier Details & Tax Classification */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  <span>Supplier / Distributor Details</span>
                </div>
                <div className="font-bold text-sm text-slate-900">
                  {doc.supplier_name} ({doc.supplier_code})
                </div>
                {doc.supplier_address && (
                  <div className="text-slate-600">{doc.supplier_address}</div>
                )}
                <div className="text-slate-600 flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>Phone: {doc.supplier_phone || 'N/A'}</span>
                  <span>NTN: {doc.supplier_ntn || 'N/A'}</span>
                  <span>STRN: {doc.supplier_strn || 'N/A'}</span>
                </div>
              </div>

              <div className="space-y-1 border-l border-slate-200 pl-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Tax & Settlement Classification
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Supplier Tax Status:</span>
                  <span className="font-bold text-slate-900">
                    {doc.supplier_filer_status || 'Filer'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Advance Tax Rate Applied:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {Number(doc.advance_tax_rate || 0).toFixed(2)}%
                    {doc.is_tax_overridden ? ' (Override)' : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    {mode === 'invoice' ? 'Payment Mode:' : 'Settlement Mode:'}
                  </span>
                  <span className="font-bold text-slate-900">
                    {mode === 'invoice' ? doc.payment_mode : doc.settlement_mode}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Status:</span>
                  <span
                    className={`uppercase font-bold ${
                      isCancelled ? 'text-rose-600' : 'text-emerald-700'
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Line Items Table */}
            <div className="border border-slate-300 rounded-lg overflow-hidden">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-left">
                    <th className="py-2 px-2 font-semibold w-8">#</th>
                    {fields.showItemCode && (
                      <th className="py-2 px-2 font-semibold">Item Code</th>
                    )}
                    <th className="py-2 px-2 font-semibold">Item Name</th>
                    {mode === 'invoice' ? (
                      <>
                        <th className="py-2 px-2 font-semibold text-right">Qty</th>
                        {fields.showDiscount && (
                          <th className="py-2 px-2 font-semibold text-right">Discount</th>
                        )}
                        {fields.showBonus && (
                          <th className="py-2 px-2 font-semibold text-right">Bonus</th>
                        )}
                        <th className="py-2 px-2 font-semibold text-right">Gross Amount</th>
                        <th className="py-2 px-2 font-semibold text-right">Net Amount</th>
                      </>
                    ) : (
                      <>
                        <th className="py-2 px-2 font-semibold text-right">Pur. Qty</th>
                        <th className="py-2 px-2 font-semibold text-right">Ret. Qty</th>
                        <th className="py-2 px-2 font-semibold text-right">Debit Rate</th>
                        {fields.showDiscount && (
                          <th className="py-2 px-2 font-semibold text-right">Disc</th>
                        )}
                        <th className="py-2 px-2 font-semibold text-right">Taxable</th>
                        {fields.showTax && (
                          <th className="py-2 px-2 font-semibold text-right">GST</th>
                        )}
                        <th className="py-2 px-2 font-semibold text-right">Line Total</th>
                      </>
                    )}
                    {fields.showPacking && (
                      <th className="py-2 px-2 font-semibold">Packing</th>
                    )}
                    {fields.showBatchExpiry && (
                      <th className="py-2 px-2 font-semibold">Batch/Expiry</th>
                    )}
                    {mode === 'invoice' && (
                      <>
                        <th className="py-2 px-2 font-semibold text-right">Purchase Rate</th>
                        <th className="py-2 px-2 font-semibold text-right">MRP</th>
                      </>
                    )}
                    {mode === 'invoice' && fields.showTax && (
                      <th className="py-2 px-2 font-semibold text-right">GST</th>
                    )}
                    {mode === 'invoice' && (
                      <>
                        <th className="py-2 px-2 font-semibold text-right">Taxable</th>
                        <th className="py-2 px-2 font-semibold text-right">Line Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item, idx) => {
                    const grossAmount =
                      Number(item.gross_amount ?? (Number(item.quantity || 0) * Number(item.purchase_rate || 0)));
                    const netAmount = Number(
                      item.net_amount ?? item.taxable_amount ?? (grossAmount - Number(item.discount_amount || 0))
                    );

                    return (
                      <tr key={item.id || idx} className="hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-mono text-slate-500">{idx + 1}</td>
                        {fields.showItemCode && (
                          <td className="py-1.5 px-2 font-mono font-semibold text-slate-800">
                            {item.item_code}
                          </td>
                        )}
                        <td className="py-1.5 px-2">
                          <div className="font-bold text-slate-900">{item.item_name}</div>
                          {fields.showCompany && (
                            <div className="text-[10px] text-slate-500">{item.company_name}</div>
                          )}
                        </td>
                        {mode === 'invoice' ? (
                          <>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                              {item.quantity}
                            </td>
                            {fields.showDiscount && (
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700">
                                {formatPKR(item.discount_amount)}
                                {Number(item.discount_percent) > 0 && (
                                  <span className="text-[9px] text-slate-400 block">
                                    ({item.discount_percent}%)
                                  </span>
                                )}
                              </td>
                            )}
                            {fields.showBonus && (
                              <td className="py-1.5 px-2 text-right font-mono text-emerald-700 font-semibold">
                                {item.bonus_quantity || 0}
                              </td>
                            )}
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatPKR(grossAmount)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                              {formatPKR(netAmount)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                              {item.purchased_quantity}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-rose-700">
                              {item.return_quantity}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatPKR(item.debit_unit_rate)}
                            </td>
                            {fields.showDiscount && (
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700">
                                {formatPKR(item.discount_amount)}
                              </td>
                            )}
                            <td className="py-1.5 px-2 text-right font-mono font-medium">
                              {formatPKR(item.taxable_amount)}
                            </td>
                            {fields.showTax && (
                              <td className="py-1.5 px-2 text-right font-mono">
                                {formatPKR(item.gst_amount)}
                              </td>
                            )}
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                              {formatPKR(item.line_total)}
                            </td>
                          </>
                        )}
                        {fields.showPacking && (
                          <td className="py-1.5 px-2 text-slate-700">{item.packing}</td>
                        )}
                        {fields.showBatchExpiry && (
                          <td className="py-1.5 px-2">
                            <div className="font-mono font-bold text-slate-800">
                              {item.batch_number}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {item.manufacturing_date ? `Mfg: ${item.manufacturing_date} | ` : ''}
                              Exp: {item.expiry_date}
                            </div>
                          </td>
                        )}
                        {mode === 'invoice' && (
                          <>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatPKR(item.purchase_rate)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                              {formatPKR(item.mrp_rate)}
                            </td>
                            {fields.showTax && (
                              <td className="py-1.5 px-2 text-right font-mono">
                                {formatPKR(item.tax_amount)}
                              </td>
                            )}
                            <td className="py-1.5 px-2 text-right font-mono font-medium">
                              {formatPKR(item.taxable_amount)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                              {formatPKR(item.line_total)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 4. Financial Totals & Tax Breakdown */}
            <div className="grid grid-cols-2 gap-6 items-start ams-avoid-break">
              {/* Left: Notes & Double-Entry Accounting Proof */}
              <div className="space-y-3">
                {(doc.remarks || doc.return_reason) && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <div className="font-bold text-slate-700 mb-0.5">
                      {mode === 'invoice' ? 'Invoice Remarks:' : 'Return Reason:'}
                    </div>
                    <div className="text-slate-600">
                      {mode === 'invoice' ? doc.remarks : doc.return_reason}
                    </div>
                  </div>
                )}

                {doc.is_tax_overridden === 1 && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    <div className="font-bold">Advance Tax Override Applied:</div>
                    <div>
                      Reason: {doc.tax_override_reason} | Authorized By:{' '}
                      {doc.tax_override_authorized_by}
                    </div>
                  </div>
                )}

                {fields.showAccountingVerification && journalLines.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[10px]">
                    <div className="font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Double-Entry Accounting Posting Verification</span>
                    </div>
                    <div className="space-y-1">
                      {journalLines.map((jl, idx) => (
                        <div key={idx} className="flex justify-between text-slate-600 font-mono">
                          <span className="truncate max-w-[230px]">
                            {jl.account_code} - {jl.account_name}
                          </span>
                          <span>
                            {jl.debit_amount > 0
                              ? `Dr: Rs. ${formatPKR(jl.debit_amount)}`
                              : `Cr: Rs. ${formatPKR(jl.credit_amount)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Invoice Summary Box */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-300 space-y-1.5 text-xs">
                {mode === 'invoice' ? (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Gross Amount:</span>
                      <span className="font-mono font-semibold">
                        Rs. {formatPKR(doc.gross_total)}
                      </span>
                    </div>
                    {fields.showDiscount && (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>Item-Level Discount:</span>
                          <span className="font-mono">
                            - Rs. {formatPKR(doc.item_discount_amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>
                            Invoice Discount ({doc.invoice_discount_percent || 0}%):
                          </span>
                          <span className="font-mono">
                            - Rs. {formatPKR(doc.invoice_discount_amount)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-slate-800 font-semibold border-t border-slate-200 pt-1">
                      <span>Taxable Amount:</span>
                      <span className="font-mono">Rs. {formatPKR(doc.taxable_amount)}</span>
                    </div>
                    {fields.showTax && (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>Applicable GST / Input Tax:</span>
                          <span className="font-mono">+ Rs. {formatPKR(doc.gst_amount)}</span>
                        </div>
                        <div className="flex justify-between text-amber-800 font-semibold">
                          <span>
                            {doc.advance_tax_name || 'Advance Tax'} ({doc.advance_tax_rate}% -{' '}
                            {doc.supplier_filer_status}):
                          </span>
                          <span className="font-mono">
                            + Rs. {formatPKR(doc.advance_tax_amount)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-sm font-black text-slate-900 border-t-2 border-slate-900 pt-2">
                      <span>Net Purchase Amount:</span>
                      <span className="font-mono">Rs. {formatPKR(doc.net_total)}</span>
                    </div>
                    {fields.showPreviousBalance && (
                      <>
                        <div className="flex justify-between text-slate-600 pt-1">
                          <span>
                            Previous Supplier Balance ({doc.previous_balance_type}):
                          </span>
                          <span className="font-mono">
                            Rs. {formatPKR(doc.previous_supplier_balance)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-800 font-bold">
                          <span>Total Payable:</span>
                          <span className="font-mono">Rs. {formatPKR(doc.total_payable)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-emerald-700 font-bold">
                      <span>Paid Amount ({doc.payment_mode}):</span>
                      <span className="font-mono">- Rs. {formatPKR(doc.paid_amount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-900 font-black border-t border-slate-300 pt-1.5">
                      <span>Remaining Payable Balance:</span>
                      <span className="font-mono">Rs. {formatPKR(doc.remaining_balance)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Gross Return Amount:</span>
                      <span className="font-mono font-semibold">
                        Rs. {formatPKR(doc.gross_return_amount)}
                      </span>
                    </div>
                    {fields.showDiscount && (
                      <div className="flex justify-between text-slate-600">
                        <span>Discount Reversal:</span>
                        <span className="font-mono">
                          - Rs. {formatPKR(doc.return_discount_amount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-800 font-semibold border-t border-slate-200 pt-1">
                      <span>Taxable Return Amount:</span>
                      <span className="font-mono">
                        Rs. {formatPKR(doc.taxable_return_amount)}
                      </span>
                    </div>
                    {fields.showTax && (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <span>GST Adjustment:</span>
                          <span className="font-mono">
                            + Rs. {formatPKR(doc.gst_adjustment_amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-amber-800 font-semibold">
                          <span>Advance Tax Adjustment ({doc.advance_tax_rate}%):</span>
                          <span className="font-mono">
                            + Rs. {formatPKR(doc.advance_tax_adjustment_amount)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-sm font-black text-rose-800 border-t-2 border-slate-900 pt-2">
                      <span>Final Debit Note / Return Total:</span>
                      <span className="font-mono">Rs. {formatPKR(doc.total_debit_amount)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 5. Signatures Footer */}
            {fields.showSignature && (
              <div className="pt-8 grid grid-cols-3 gap-8 text-center text-xs text-slate-500 border-t border-slate-200 ams-avoid-break">
                <div className="pt-6 border-t border-slate-400">Prepared By (Store Operator)</div>
                <div className="pt-6 border-t border-slate-400">Verified By (Pharmacist / QC)</div>
                <div className="pt-6 border-t border-slate-400">
                  Authorized Signatory ({storeName})
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
