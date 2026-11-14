import React, { useState, useEffect, useRef } from 'react';
import {
  Printer,
  X,
  FileText,
  Receipt,
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
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import {
  executePrintElement,
  detectPrintCapabilities,
  PaperSizeOption,
  PageOrientationOption,
  PageMarginOption,
  FontSizeScaleOption,
} from '../../utils/printEngine';

interface SalesPrintModalProps {
  isOpen?: boolean;
  invoice?: Record<string, any> | null;
  saleReturn?: Record<string, any> | null;
  mode?: 'invoice' | 'return';
  initialFormat?: PaperSizeOption;
  autoDirectPrint?: boolean;
  onClose: () => void;
}

export const SalesPrintModal: React.FC<SalesPrintModalProps> = ({
  isOpen = true,
  invoice,
  saleReturn,
  mode = 'invoice',
  initialFormat,
  autoDirectPrint = false,
  onClose,
}) => {
  const docRecord = mode === 'return' ? saleReturn || invoice : invoice;
  const isReturn = mode === 'return' || Boolean(saleReturn && !invoice);

  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const hasAutoPrintedRef = useRef<boolean>(false);

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [format, setFormat] = useState<PaperSizeOption>(initialFormat || 'a4');
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
  const [moreOptions, setMoreOptions] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getCompanySettings()
      .then((res) => {
        if (!mounted || !res?.data) return;
        const s = res.data;
        setSettings(s);
        if (!initialFormat && s.default_paper_size) {
          setFormat(s.default_paper_size);
        }
        if (s.page_orientation) setOrientation(s.page_orientation);
        if (s.page_margin) setMargin(s.page_margin);
        if (s.font_size_scale) setFontSizeScale(s.font_size_scale);
        if (s.print_copies) setCopies(Math.max(1, Number(s.print_copies) || 1));
        if (s.default_printer) setSelectedPrinter(s.default_printer);
        setFields(parseFieldVisibility(s.field_visibility_json));
      })
      .catch(() => {
        // Fallback to local defaults if offline
      });

    api
      .getSalesInvoiceMoreOptions()
      .then((res) => {
        if (!mounted || !res?.data) return;
        setMoreOptions(res.data);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [initialFormat]);

  const capabilities = detectPrintCapabilities(settings?.default_printer);

  const handlePrintNow = () => {
    if (!docRecord) return;
    const docNum = isReturn
      ? docRecord.return_number || `SRN-${docRecord.id}`
      : docRecord.invoice_number || `SAL-${docRecord.id}`;

    executePrintElement(printAreaRef.current, {
      title: `${storeName} - ${docNum}`,
      paperSize: format,
      orientation,
      margin,
      fontSizeScale,
      copies,
      selectedPrinter,
    });
  };

  useEffect(() => {
    if (autoDirectPrint && docRecord && settings && !hasAutoPrintedRef.current) {
      hasAutoPrintedRef.current = true;
      const timer = setTimeout(() => {
        handlePrintNow();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [autoDirectPrint, docRecord, settings]);

  if (!docRecord) return null;

  const items: Array<Record<string, any>> = Array.isArray(docRecord.items)
    ? docRecord.items
    : [];

  const isCancelled = String(docRecord.status || '').toLowerCase() === 'cancelled';

  const isThermal = format === '80mm' || format === '58mm';
  const isA4 = format === 'a4';

  // Active visibility configuration based on current print / preview scope:
  const activeVisibility = isThermal
    ? moreOptions?.visibility?.thermal
    : isA4
    ? moreOptions?.visibility?.a4
    : moreOptions?.visibility?.preview;

  // 17 Optional Field Visibility switches
  const showCustAddress = activeVisibility ? activeVisibility.customer_address !== false : true;
  const showCustPhone = activeVisibility ? activeVisibility.customer_phone !== false : true;
  const showItemCompany = activeVisibility ? activeVisibility.item_company !== false : fields.showCompany;
  const showItemCode = activeVisibility ? activeVisibility.item_code !== false : fields.showItemCode;
  const showBarcode = activeVisibility ? activeVisibility.barcode !== false : true;
  const showBatch = activeVisibility ? activeVisibility.batch_number !== false : fields.showBatchExpiry;
  const showExpiry = activeVisibility ? activeVisibility.expiry_date !== false : fields.showBatchExpiry;
  const showDiscount = activeVisibility ? activeVisibility.discount !== false : fields.showDiscount;
  const showTax = activeVisibility ? activeVisibility.tax !== false : fields.showTax;
  const showBonus = activeVisibility ? activeVisibility.bonus_quantity !== false : true;
  const showLoose = activeVisibility ? activeVisibility.loose_quantity !== false : true;
  const showPacking = activeVisibility ? activeVisibility.packing_details !== false : fields.showPacking;
  const showPrevBalance = activeVisibility ? activeVisibility.previous_balance !== false : fields.showPreviousBalance;
  const showPaid = activeVisibility ? activeVisibility.paid_amount !== false : true;
  const showRemaining = activeVisibility ? activeVisibility.remaining_balance !== false : true;
  const showRemarks = activeVisibility ? activeVisibility.remarks !== false : true;
  const showFooterNote = activeVisibility ? activeVisibility.footer_note !== false : fields.showFooter;

  const storeName = moreOptions?.store_name || settings?.store_name || 'ABRAR MEDICAL STORE';
  const storeAddress = moreOptions?.address || settings?.address || 'Main Commercial Market, Lahore, Punjab, Pakistan';
  const storePhone = moreOptions?.phone || settings?.phone || '+92 42 35789000';
  const storeMobile = settings?.mobile || '';
  const drugLicense = settings?.drug_license_number || 'DL-PK-LHR-2026-0891';
  const ntnNumber = moreOptions?.ntn_strn || settings?.ntn_tax_number || 'NTN-PK-9812450-7';
  const logoDataUrl = settings?.logo_data_url || '';
  const invoiceHeading = isReturn
    ? 'SALES RETURN / CREDIT NOTE'
    : moreOptions?.custom_heading || moreOptions?.invoice_title || settings?.invoice_heading || 'TAX / COMMERCIAL INVOICE';
  const invoiceSubtitle = moreOptions?.invoice_subtitle || '';
  const footerMessage =
    moreOptions?.footer_note ||
    settings?.invoice_footer_note ||
    'Medicines once sold will only be replaced or returned within 3 days with original bill. Loose & cold-chain items are non-returnable.';
  const customTerms = moreOptions?.custom_terms || '';
  const thankYouMessage = moreOptions?.thank_you_message || 'Thank You — Get Well Soon!';

  const fmtMoney = (val: unknown) =>
    Number(val || 0).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const handleSaveAsDefaultSettings = async () => {
    try {
      setSavingDefaults(true);
      setSaveFeedback(null);
      await api.updateCompanySettings({
        default_printer: selectedPrinter,
        default_paper_size: format,
        thermal_printer_width: format === '58mm' ? '58mm' : '80mm',
        print_copies: copies,
        page_orientation: orientation,
        page_margin: margin,
        font_size_scale: fontSizeScale,
        field_visibility_json: JSON.stringify(fields),
      });
      setSaveFeedback('Saved as Store Default');
      setTimeout(() => setSaveFeedback(null), 3000);
    } catch (err: any) {
      setSaveFeedback(err?.message || 'Could not save defaults');
    } finally {
      setSavingDefaults(false);
    }
  };

  const toggleField = (key: keyof InvoiceFieldVisibility) => {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fontScaleClass =
    fontSizeScale === 'small'
      ? 'text-[12.5px]'
      : fontSizeScale === 'large'
      ? 'text-[16px]'
      : 'text-[14px]';

  // Saved Database Totals (Never recalculated differently during printing)
  const savedGross = isReturn
    ? Number(docRecord.gross_return_amount ?? docRecord.gross_total ?? 0)
    : Number(docRecord.gross_total ?? 0);
  const savedItemDisc = Number(docRecord.item_discount_amount ?? 0);
  const savedInvoiceDisc = Number(docRecord.invoice_discount_amount ?? 0);
  const savedTotalDisc = isReturn
    ? Number(docRecord.return_discount_amount ?? docRecord.discount_amount ?? 0)
    : Number(docRecord.discount_amount ?? 0);
  const savedTaxable = isReturn
    ? Number(docRecord.taxable_return_amount ?? docRecord.taxable_amount ?? 0)
    : Number(docRecord.taxable_amount ?? 0);
  const savedGst = isReturn
    ? Number(docRecord.gst_adjustment_amount ?? docRecord.gst_amount ?? 0)
    : Number(docRecord.gst_amount ?? 0);
  const savedAdvTax = isReturn
    ? Number(docRecord.advance_tax_adjustment_amount ?? docRecord.advance_tax_amount ?? 0)
    : Number(docRecord.advance_tax_amount ?? 0);
  const savedAdvTaxRate = Number(docRecord.advance_tax_rate ?? 0);
  const savedTotalTax = Number(docRecord.tax_amount ?? savedGst + savedAdvTax);
  const savedNetTotal = isReturn
    ? Number(docRecord.total_refund_amount ?? docRecord.net_total ?? 0)
    : Number(docRecord.net_total ?? 0);
  const savedPrevBalance = Number(docRecord.previous_customer_balance ?? 0);
  const savedPrevBalanceType = String(docRecord.previous_balance_type || 'Debit');
  const savedTotalReceivable = Number(docRecord.total_receivable ?? savedNetTotal);
  const savedPaidAmount = isReturn
    ? docRecord.refund_mode === 'Cash Refund' || docRecord.refund_mode === 'Bank Refund'
      ? savedNetTotal
      : 0
    : Number(docRecord.paid_amount ?? 0);
  const savedRemainingBalance = isReturn
    ? 0
    : Number(docRecord.balance_amount ?? savedTotalReceivable - savedPaidAmount);
  const paymentMethodLabel = isReturn
    ? String(docRecord.refund_mode || 'Account Adjustment')
    : String(docRecord.payment_mode || 'Cash');

  return (
    <div className="print-modal-container fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 lg:p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden print:shadow-none print:border-0 print:max-w-none print:max-h-none">
        {/* Top Interactive Print Control Bar (Hidden when printing) */}
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  {isReturn ? 'Sales Return Print & Preview' : 'Sales Invoice Print & Preview'} —{' '}
                  {isReturn ? docRecord.return_number : docRecord.invoice_number}
                </h3>
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider">
                    CANCELLED INVOICE
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Exact Database Record · Zero Recalculation · Multi-Page & Thermal Ready
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Paper Format Selector */}
            <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700">
              <button
                type="button"
                onClick={() => setFormat('a4')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  format === 'a4'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>A4 Paper</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('80mm')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  format === '80mm'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>80mm Thermal</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('58mm')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  format === '58mm'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>58mm Thermal</span>
              </button>
            </div>

            {/* Field Visibility & Page Setup Toggle */}
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

            {/* Printer Setup Info */}
            <button
              type="button"
              onClick={() => setShowPrinterGuide((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                showPrinterGuide
                  ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Printer Selection & OS Spooler Guide"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Printer Info</span>
            </button>

            {/* Send via WhatsApp Button */}
            {!isReturn && (
              <WhatsAppSendButton
                payload={{
                  storeName,
                  documentType: 'invoice',
                  invoiceId: docRecord.id ? Number(docRecord.id) : null,
                  documentNumber: String(docRecord.invoice_number || `SAL-${docRecord.id}`),
                  documentDate: String(docRecord.invoice_date || ''),
                  customerAccountId: docRecord.customer_account_id
                    ? Number(docRecord.customer_account_id)
                    : null,
                  customerName: String(docRecord.customer_name || 'Walk-in Cash Customer'),
                  customerPhone: String(docRecord.customer_phone || ''),
                  totalAmount: savedNetTotal,
                  paidAmount: savedPaidAmount,
                  remainingBalance: savedRemainingBalance,
                  items,
                }}
                label="Send via WhatsApp"
              />
            )}

            {/* Direct Print Button */}
            <button
              type="button"
              onClick={handlePrintNow}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Now ({copies} {copies === 1 ? 'Copy' : 'Copies'})</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Close Preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Secondary Printing Controls Strip: Printer Target, Orientation, Margins, Font Size, Copies */}
        <div className="bg-slate-800 text-slate-200 px-4 py-2 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            {/* Printer Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Printer:
              </span>
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {capabilities.availablePrinterProfiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* Orientation (A4 only) */}
            {format === 'a4' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Orientation:
                </span>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as PageOrientationOption)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
            )}

            {/* Margins */}
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
                <option value="minimum">Minimum</option>
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
              </select>
            </div>

            {/* Font Size */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Font Size:
              </span>
              <select
                value={fontSizeScale}
                onChange={(e) => setFontSizeScale(e.target.value as FontSizeScaleOption)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
              >
                <option value="small">Small (Compact)</option>
                <option value="normal">Normal (100%)</option>
                <option value="large">Large (High Legibility)</option>
              </select>
            </div>

            {/* Copies */}
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
              onClick={handleSaveAsDefaultSettings}
              disabled={savingDefaults}
              className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Save current paper size, margins, font size, and field visibility as permanent Store Default"
            >
              <Save className="w-3 h-3 text-emerald-400" />
              <span>{savingDefaults ? 'Saving...' : 'Save as Store Default'}</span>
            </button>
          </div>
        </div>

        {/* Expandable Show/Hide Invoice Fields Drawer */}
        {showFieldControls && (
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 text-xs print:hidden">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-600" />
                Show / Hide Individual Invoice Fields:
              </span>
              <span className="text-[11px] text-slate-500">
                Click "Save as Store Default" to persist these toggles permanently
              </span>
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
                { key: 'showDiscount', label: 'Discount Column' },
                { key: 'showTax', label: 'Tax / Advance Tax' },
                { key: 'showPreviousBalance', label: 'Previous Balance' },
                { key: 'showSalesman', label: 'Salesman Name' },
                { key: 'showDeliveryman', label: 'Deliveryman Name' },
                { key: 'showSignature', label: 'Authorized Signature' },
                { key: 'showFooter', label: 'Footer Note' },
                { key: 'showAccountingVerification', label: 'GL Journal Proof' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none hover:border-emerald-400"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(fields[item.key as keyof InvoiceFieldVisibility])}
                    onChange={() => toggleField(item.key as keyof InvoiceFieldVisibility)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-[11px] font-medium text-slate-700 truncate">
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Expandable Printer Capability & OS Spooler Setup Guide */}
        {showPrinterGuide && (
          <div className="bg-sky-50 border-b border-sky-200 px-4 py-2.5 text-xs text-sky-950 print:hidden">
            <div className="font-bold text-sky-900 mb-1 flex items-center gap-2">
              <Printer className="w-3.5 h-3.5 text-sky-700" />
              <span>
                Hardware & Browser Print Spooler Status:{' '}
                {capabilities.browserPrintSupported
                  ? 'Ready (OS Print Spooler Connected)'
                  : 'Unavailable'}
              </span>
              <span className="text-sky-700 font-normal">
                · Target Profile: <strong>{selectedPrinter}</strong>
              </span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-sky-800">
              {capabilities.setupNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Scrollable Print Preview Viewport */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-100 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          {format === 'a4' ? (
            /* =========================================================
               1. PROFESSIONAL A4 SALES INVOICE / SALES RETURN LAYOUT
               ========================================================= */
            <div
              ref={printAreaRef}
              className={`ams-sales-print-a4 bg-white border border-slate-300 shadow-sm w-full ${
                orientation === 'landscape' ? 'max-w-[285mm]' : 'max-w-[210mm]'
              } p-6 lg:p-7 text-slate-900 ${fontScaleClass} leading-snug relative print:border-0 print:shadow-none print:p-2 print:max-w-none`}
            >
              {/* CANCELLED WATERMARK OVERLAY */}
              {isCancelled && (
                <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center z-10 overflow-hidden">
                  <div className="border-4 border-rose-600/40 text-rose-600/30 font-black text-5xl lg:text-6xl uppercase tracking-[0.25em] px-8 py-3 rounded-2xl -rotate-12">
                    CANCELLED
                  </div>
                </div>
              )}

              {/* Cancelled Alert Banner */}
              {isCancelled && (
                <div className="mb-4 p-2.5 rounded-lg bg-rose-50 border-2 border-rose-600 text-rose-900 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider">
                    <Ban className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>CANCELLED DOCUMENT — NOT VALID FOR FINANCIAL CLAIM OR STOCK DELIVERY</span>
                  </div>
                  {docRecord.cancelled_at && (
                    <span className="text-xs font-mono">
                      Cancelled: {String(docRecord.cancelled_at).slice(0, 19)}
                    </span>
                  )}
                </div>
              )}

              {/* Store Header */}
              <div className="border-b-2 border-slate-900 pb-4 mb-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  {fields.showLogo && logoDataUrl && (
                    <img
                      src={logoDataUrl}
                      alt={storeName}
                      className="w-16 h-16 object-contain rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                    />
                  )}
                  <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-950 uppercase leading-tight">
                      {storeName}
                    </h1>
                    {invoiceSubtitle && (
                      <p className="text-sm font-semibold text-slate-700 tracking-wide mt-0.5">{invoiceSubtitle}</p>
                    )}
                    <p className="text-sm font-semibold text-slate-700 mt-0.5">{storeAddress}</p>
                    <p className="text-xs text-slate-700 mt-1">
                      Phone: <span className="font-semibold text-slate-900">{storePhone}</span>
                      {storeMobile ? ` · Mobile: ${storeMobile}` : ''}
                      {fields.showDrugLicense && drugLicense
                        ? ` · Drug License: ${drugLicense}`
                        : ''}
                      {fields.showNtn && ntnNumber ? ` · NTN: ${ntnNumber}` : ''}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-block px-3.5 py-1.5 rounded bg-slate-900 text-white text-sm font-black tracking-wider uppercase">
                    {isReturn
                      ? 'SALES RETURN / CREDIT NOTE'
                      : `${docRecord.invoice_type || 'RETAIL'} — ${invoiceHeading}`}
                  </div>
                  <div className="mt-2 text-lg font-black font-mono text-slate-950">
                    {isReturn
                      ? `Return #: ${docRecord.return_number}`
                      : `Invoice #: ${docRecord.invoice_number}`}
                  </div>
                  <div className="text-sm text-slate-700 mt-0.5">
                    Date:{' '}
                    <span className="font-bold text-slate-950">
                      {isReturn ? docRecord.return_date : docRecord.invoice_date}
                    </span>
                  </div>
                  {isReturn && docRecord.original_invoice_number && (
                    <div className="text-xs text-slate-700 mt-0.5 font-mono">
                      Orig. Invoice: <strong>{docRecord.original_invoice_number}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer & Billing Details Grid */}
              <div className="grid grid-cols-2 gap-4 mb-4 p-3.5 rounded-lg bg-slate-50 border border-slate-300">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Customer Details
                  </div>
                  <div className="text-lg font-black text-slate-950 mt-0.5 leading-snug">
                    {docRecord.customer_name || 'Walk-in Cash Customer'}
                  </div>
                  <div className="text-[13px] text-slate-700 mt-1">
                    {docRecord.customer_code ? `Account Code: ${docRecord.customer_code} · ` : ''}
                    Tax Status:{' '}
                    <span className="font-semibold text-slate-900">
                      {docRecord.customer_filer_status || 'Filer'}
                    </span>
                  </div>
                  {((showCustPhone && docRecord.customer_phone) || (showCustAddress && docRecord.customer_address)) && (
                    <div className="text-[13px] text-slate-700 mt-0.5">
                      {showCustPhone && docRecord.customer_phone ? `Contact: ${docRecord.customer_phone}` : ''}
                      {showCustPhone && docRecord.customer_phone && showCustAddress && docRecord.customer_address ? ' · ' : ''}
                      {showCustAddress && docRecord.customer_address ? `Address: ${docRecord.customer_address}` : ''}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Payment & Billing Info
                  </div>
                  <div className="text-sm font-bold text-slate-950 mt-0.5">
                    {isReturn ? 'Settlement Mode' : 'Payment Method'}:{' '}
                    <span className="uppercase">{paymentMethodLabel}</span>
                  </div>
                  {isReturn ? (
                    <div className="text-[13px] text-slate-700 mt-1">
                      Reason: {docRecord.return_reason || 'Customer Return'}
                    </div>
                  ) : (
                    <>
                      {fields.showSalesman && (
                        <div className="text-[13px] text-slate-700 mt-1">
                          Salesman: <span className="font-semibold text-slate-900">{docRecord.salesman || 'Counter Pharmacist'}</span>
                        </div>
                      )}
                      {fields.showDeliveryman && docRecord.deliveryman_name && (
                        <div className="text-[13px] text-slate-700 mt-0.5">
                          Deliveryman: <span className="font-semibold text-slate-900">{docRecord.deliveryman_name}</span>
                          {docRecord.delivery_status ? ` (${docRecord.delivery_status})` : ''}
                        </div>
                      )}
                    </>
                  )}
                  <div className="text-[13px] text-slate-700 mt-0.5">
                    Document Status:{' '}
                    <span
                      className={`font-bold uppercase ${
                        isCancelled ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {docRecord.status || 'completed'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Line Items Table (Supports Multi-Page Automatic Header Repetition) */}
              <table className="w-full border-collapse border border-slate-300 mb-4 tabular-nums">
                <thead>
                  <tr className="bg-slate-900 text-white text-xs font-bold uppercase tracking-wide">
                    <th className="py-2.5 px-1.5 text-left border border-slate-700 w-7">#</th>
                    {fields.showItemCode && (
                      <th className="py-2.5 px-1.5 text-left border border-slate-700">Code</th>
                    )}
                    <th className="py-2.5 px-1.5 text-left border border-slate-700">
                      Item Description
                    </th>
                    {fields.showPacking && (
                      <th className="py-2.5 px-1.5 text-center border border-slate-700">Packing</th>
                    )}
                    {fields.showBatchExpiry && (
                      <th className="py-2.5 px-1.5 text-left border border-slate-700">
                        Batch / Expiry
                      </th>
                    )}
                    <th className="py-2.5 px-1.5 text-right border border-slate-700">
                      {isReturn ? 'Ret. Qty' : 'Pack Qty'}
                    </th>
                    {!isReturn && (
                      <th className="py-2.5 px-1.5 text-right border border-slate-700">Bonus</th>
                    )}
                    <th className="py-2.5 px-1.5 text-right border border-slate-700">Loose</th>
                    <th className="py-2.5 px-1.5 text-right border border-slate-700">Rate</th>
                    {fields.showDiscount && (
                      <th className="py-2.5 px-1.5 text-right border border-slate-700">Disc</th>
                    )}
                    {fields.showTax && (
                      <th className="py-2.5 px-1.5 text-right border border-slate-700">Tax</th>
                    )}
                    <th className="py-2.5 px-1.5 text-right border border-slate-700">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((line, idx) => {
                    const packQty = isReturn
                      ? Number(line.return_quantity ?? line.quantity ?? 0)
                      : Number(line.quantity ?? 0);
                    const looseQty = isReturn
                      ? Number(line.return_loose_quantity ?? line.loose_quantity ?? 0)
                      : Number(line.loose_quantity ?? 0);
                    const discAmt = Number(line.discount_amount ?? 0);
                    const discPct = Number(line.discount_percent ?? 0);
                    const taxAmt = isReturn
                      ? Number(line.gst_amount ?? line.tax_amount ?? 0)
                      : Number(line.tax_amount ?? 0);

                    return (
                      <tr key={line.id || idx} className="text-[13px] leading-snug">
                        <td className="py-2 px-1.5 border border-slate-200 font-mono text-slate-600 font-semibold">
                          {idx + 1}
                        </td>
                        {fields.showItemCode && (
                          <td className="py-2 px-1.5 border border-slate-200 font-mono font-semibold text-slate-800">
                            {line.item_code}
                          </td>
                        )}
                        <td className="py-2 px-1.5 border border-slate-200">
                          <div className="font-bold text-[13.5px] text-slate-950">{line.item_name}</div>
                          {fields.showCompany && line.company_name && (
                            <div className="text-[11.5px] text-slate-600 mt-0.5">{line.company_name}</div>
                          )}
                        </td>
                        {fields.showPacking && (
                          <td className="py-2 px-1.5 border border-slate-200 text-center font-mono">
                            {line.packing}
                          </td>
                        )}
                        {fields.showBatchExpiry && (
                          <td className="py-2 px-1.5 border border-slate-200 font-mono text-[11.5px]">
                            <div className="font-semibold text-slate-800">{line.batch_number || '-'}</div>
                            {line.expiry_date && (
                              <div className="text-slate-600">Exp: {line.expiry_date}</div>
                            )}
                          </td>
                        )}
                        <td className="py-2 px-1.5 border border-slate-200 text-right font-mono font-bold text-slate-950">
                          {packQty}
                        </td>
                        {!isReturn && (
                          <td className="py-2 px-1.5 border border-slate-200 text-right font-mono font-bold text-emerald-800">
                            {Number(line.bonus_quantity || 0) > 0 ? Number(line.bonus_quantity) : '-'}
                          </td>
                        )}
                        <td className="py-2 px-1.5 border border-slate-200 text-right font-mono">
                          {looseQty > 0 ? looseQty : '-'}
                        </td>
                        <td className="py-2 px-1.5 border border-slate-200 text-right font-mono font-semibold">
                          {fmtMoney(line.unit_price)}
                        </td>
                        {fields.showDiscount && (
                          <td className="py-2 px-1.5 border border-slate-200 text-right font-mono">
                            {discAmt > 0 ? `${fmtMoney(discAmt)} (${discPct}%)` : '-'}
                          </td>
                        )}
                        {fields.showTax && (
                          <td className="py-2 px-1.5 border border-slate-200 text-right font-mono">
                            {taxAmt > 0 ? fmtMoney(taxAmt) : '-'}
                          </td>
                        )}
                        <td className="py-2 px-1.5 border border-slate-200 text-right font-mono font-bold text-[13.5px] text-slate-950">
                          {fmtMoney(line.line_total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Totals, Previous Balance, Paid & Remaining Summary */}
              <div className="grid grid-cols-12 gap-6 items-start ams-avoid-break">
                <div className="col-span-7 space-y-2.5">
                  {showRemarks && docRecord.remarks && (
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-[13px]">
                      <span className="font-bold text-slate-800">Remarks: </span>
                      <span className="text-slate-700">{docRecord.remarks}</span>
                    </div>
                  )}

                  {showFooterNote && (footerMessage || customTerms || thankYouMessage) && (
                    <div className="p-3 rounded border border-slate-200 text-xs text-slate-700 space-y-1.5">
                      {footerMessage && (
                        <div>
                          <div className="font-bold text-slate-900 uppercase text-[11px]">
                            Terms & Store Policy:
                          </div>
                          <p className="whitespace-pre-line text-slate-700 leading-snug">{footerMessage}</p>
                        </div>
                      )}
                      {customTerms && (
                        <div className="pt-1 border-t border-slate-200">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">
                            Custom Terms & Conditions:
                          </div>
                          <p className="whitespace-pre-line text-slate-700 leading-snug">{customTerms}</p>
                        </div>
                      )}
                      {thankYouMessage && (
                        <div className="pt-1 text-emerald-800 font-bold text-[13px]">
                          {thankYouMessage}
                        </div>
                      )}
                    </div>
                  )}

                  {fields.showSignature && (
                    <div className="pt-8 grid grid-cols-2 gap-8 text-center">
                      <div className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-700">
                        Customer Signature
                      </div>
                      <div className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-700">
                        Authorized Pharmacist / Signature
                      </div>
                    </div>
                  )}
                </div>

                <div className="col-span-5 bg-slate-50 rounded-lg border border-slate-300 p-3.5 space-y-2 text-sm tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-700 font-medium">
                      {isReturn ? 'Gross Return Amount:' : 'Gross Amount:'}
                    </span>
                    <span className="font-mono font-bold text-slate-900">Rs. {fmtMoney(savedGross)}</span>
                  </div>

                  {fields.showDiscount && (savedItemDisc > 0 || savedTotalDisc > 0) && (
                    <>
                      {savedItemDisc > 0 && (
                        <div className="flex justify-between text-slate-700">
                          <span>Item Discounts:</span>
                          <span className="font-mono font-semibold">- Rs. {fmtMoney(savedItemDisc)}</span>
                        </div>
                      )}
                      {savedInvoiceDisc > 0 && (
                        <div className="flex justify-between text-slate-700">
                          <span>
                            Invoice Discount ({Number(docRecord.invoice_discount_percent || 0)}%):
                          </span>
                          <span className="font-mono font-semibold">- Rs. {fmtMoney(savedInvoiceDisc)}</span>
                        </div>
                      )}
                      {savedItemDisc === 0 && savedInvoiceDisc === 0 && savedTotalDisc > 0 && (
                        <div className="flex justify-between text-slate-700">
                          <span>Discount Adjustment:</span>
                          <span className="font-mono font-semibold">- Rs. {fmtMoney(savedTotalDisc)}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between border-t border-slate-200 pt-1.5">
                    <span className="text-slate-800 font-semibold">Taxable Amount:</span>
                    <span className="font-mono font-bold text-slate-900">Rs. {fmtMoney(savedTaxable)}</span>
                  </div>

                  {fields.showTax && (
                    <>
                      {savedGst > 0 && (
                        <div className="flex justify-between text-slate-700">
                          <span>GST / Sales Tax:</span>
                          <span className="font-mono font-semibold">+ Rs. {fmtMoney(savedGst)}</span>
                        </div>
                      )}
                      {(Number(docRecord.advance_tax_applicable) === 1 || savedAdvTax > 0) && (
                        <div className="flex justify-between text-slate-700">
                          <span>Advance Tax ({savedAdvTaxRate}%):</span>
                          <span className="font-mono font-semibold">+ Rs. {fmtMoney(savedAdvTax)}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between items-baseline border-t-2 border-slate-900 pt-2 text-lg font-black text-slate-950">
                    <span>{isReturn ? 'Net Return Amount:' : 'Net Invoice Amount:'}</span>
                    <span className="font-mono">Rs. {fmtMoney(savedNetTotal)}</span>
                  </div>

                  {!isReturn && showPrevBalance && (
                    <>
                      <div className="flex justify-between text-slate-700 pt-1.5 border-t border-slate-200">
                        <span>Previous Customer Balance:</span>
                        <span className="font-mono font-semibold">
                          Rs. {fmtMoney(savedPrevBalance)} ({savedPrevBalanceType})
                        </span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>Total Receivable:</span>
                        <span className="font-mono">Rs. {fmtMoney(savedTotalReceivable)}</span>
                      </div>
                    </>
                  )}

                  {showPaid && (
                    <div className="flex justify-between text-emerald-800 font-bold pt-1.5 border-t border-slate-200">
                      <span>
                        {isReturn
                          ? `Refunded (${paymentMethodLabel}):`
                          : `Paid Amount (${paymentMethodLabel}):`}
                      </span>
                      <span className="font-mono">Rs. {fmtMoney(savedPaidAmount)}</span>
                    </div>
                  )}

                  {!isReturn && showRemaining && (
                    <div className="flex justify-between border-t border-slate-300 pt-1.5 text-[15px] font-black text-slate-950">
                      <span>Remaining Balance:</span>
                      <span className="font-mono">Rs. {fmtMoney(savedRemainingBalance)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Optional Double-Entry Accounting Verification Block */}
              {fields.showAccountingVerification &&
                Array.isArray(docRecord.journalLines) &&
                docRecord.journalLines.length > 0 && (
                  <div className="mt-5 pt-3 border-t border-dashed border-slate-300 print:hidden">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Double-Entry Accounting Verification</span>
                    </div>
                    <table className="w-full text-[10px] border border-slate-200">
                      <thead className="bg-slate-100 text-slate-600">
                        <tr>
                          <th className="py-1 px-2 text-left">Voucher #</th>
                          <th className="py-1 px-2 text-left">Account Head</th>
                          <th className="py-1 px-2 text-left">Narration</th>
                          <th className="py-1 px-2 text-right">Debit (Rs.)</th>
                          <th className="py-1 px-2 text-right">Credit (Rs.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {docRecord.journalLines.map((jl: any, idx: number) => (
                          <tr key={idx}>
                            <td className="py-1 px-2 font-mono">{jl.entry_number}</td>
                            <td className="py-1 px-2 font-semibold">
                              {jl.account_code} — {jl.account_name}
                            </td>
                            <td className="py-1 px-2 text-slate-500">{jl.narration}</td>
                            <td className="py-1 px-2 text-right font-mono">
                              {Number(jl.debit_amount) > 0 ? fmtMoney(jl.debit_amount) : '-'}
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {Number(jl.credit_amount) > 0 ? fmtMoney(jl.credit_amount) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          ) : (
            /* =========================================================
               2. 80mm / 58mm THERMAL RECEIPT PRINTER LAYOUT
               (Designed to match the POS Thermal Reference PDF)
               ========================================================= */
            <div
              ref={printAreaRef}
              className={`thermal-receipt bg-white border border-slate-300 shadow-sm text-black font-sans tabular-nums leading-tight ${
                format === '80mm'
                  ? 'thermal-80mm w-[312px] p-2.5 text-[12px]'
                  : 'thermal-58mm w-[224px] p-1.5 text-[10.5px]'
              } relative print:border-0 print:shadow-none print:p-1`}
            >
              {isCancelled && (
                <div className="mb-1.5 py-1 px-2 border-2 border-black text-center font-black uppercase tracking-widest text-black">
                  *** CANCELLED ***
                </div>
              )}

              {/* 1. Centered Store Header */}
              <div className="text-center pb-2">
                {fields.showLogo && logoDataUrl && (
                  <img
                    src={logoDataUrl}
                    alt={storeName}
                    className={`object-contain mx-auto mb-1 ${
                      format === '80mm' ? 'w-14 h-12' : 'w-10 h-9'
                    }`}
                  />
                )}
                <div
                  className={`font-black text-black tracking-tight leading-tight ${
                    format === '80mm' ? 'text-[18px]' : 'text-[14.5px]'
                  }`}
                >
                  {storeName}
                </div>
                {storeAddress && (
                  <div
                    className={`font-semibold text-black leading-snug mt-0.5 ${
                      format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    {storeAddress}
                  </div>
                )}
                {storePhone && (
                  <div
                    className={`font-semibold text-black leading-snug mt-0.5 ${
                      format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    {storePhone}
                  </div>
                )}
                {(fields.showDrugLicense || fields.showNtn) && (
                  <div
                    className={`font-medium text-black mt-0.5 ${
                      format === '80mm' ? 'text-[10.5px]' : 'text-[9.5px]'
                    }`}
                  >
                    {fields.showDrugLicense && drugLicense ? `DL: ${drugLicense}` : ''}
                    {fields.showDrugLicense && fields.showNtn ? ' | ' : ''}
                    {fields.showNtn && ntnNumber ? `NTN: ${ntnNumber}` : ''}
                  </div>
                )}
                {isReturn && (
                  <div
                    className={`mt-1 inline-block px-2 py-0.5 border border-black font-black uppercase tracking-wider ${
                      format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    SALES RETURN SLIP
                  </div>
                )}
              </div>

              {/* 2. Boxed Metadata Table (Bill No, Date, Account, Contact No) */}
              {(() => {
                const rawDate = isReturn ? docRecord.return_date : docRecord.invoice_date;
                const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const formatDateDMY = (raw: unknown): string => {
                  const str = String(raw || '').trim();
                  if (!str) return '';
                  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
                  if (m) return `${m[3]}-${MONTHS[Number(m[2]) - 1] || m[2]}-${m[1]}`;
                  const d = new Date(str);
                  if (!Number.isNaN(d.getTime())) {
                    return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
                  }
                  return str;
                };
                const timeStr = docRecord.created_at
                  ? (() => {
                      const d = new Date(docRecord.created_at);
                      return !Number.isNaN(d.getTime())
                        ? d.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false,
                          })
                        : '';
                    })()
                  : '';
                const dateTimeDisplay = [formatDateDMY(rawDate), timeStr].filter(Boolean).join(' ');

                return (
                  <table
                    className={`w-full border-collapse border border-black text-black ${
                      format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    <tbody>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-semibold whitespace-nowrap w-[26%]">
                          {isReturn ? 'Return No' : 'Bill No'}
                        </td>
                        <td
                          className={`border border-black px-1.5 py-0.5 font-black font-mono ${
                            format === '80mm' ? 'text-[12.5px]' : 'text-[11px]'
                          }`}
                        >
                          {isReturn ? docRecord.return_number : docRecord.invoice_number}
                          {isReturn && docRecord.original_invoice_number
                            ? ` (Ref: ${docRecord.original_invoice_number})`
                            : ''}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-semibold whitespace-nowrap">
                          Date
                        </td>
                        <td className="border border-black px-1.5 py-0.5 font-semibold text-left">
                          {dateTimeDisplay}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-semibold whitespace-nowrap">
                          Account
                        </td>
                        <td
                          className={`border border-black px-1.5 py-0.5 font-black break-words ${
                            format === '80mm' ? 'text-[13px]' : 'text-[11px]'
                          }`}
                        >
                          {docRecord.customer_name || 'Walk-in Cash'}
                          {docRecord.customer_city ? ` ${docRecord.customer_city}` : ''}
                        </td>
                      </tr>
                      {showCustPhone && docRecord.customer_phone ? (
                        <tr>
                          <td className="border border-black px-1.5 py-0.5 font-semibold whitespace-nowrap">
                            Mobile No
                          </td>
                          <td className="border border-black px-1.5 py-0.5 font-bold font-mono">
                            {docRecord.customer_phone}
                          </td>
                        </tr>
                      ) : null}
                      {showCustAddress && docRecord.customer_address ? (
                        <tr>
                          <td className="border border-black px-1.5 py-0.5 font-semibold whitespace-nowrap align-top">
                            Address
                          </td>
                          <td className="border border-black px-1.5 py-0.5 font-semibold break-words">
                            {docRecord.customer_address}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                );
              })()}

              {/* 3. Boxed Line Items Table: Item | Qty | Bonus | Rate | Disc | Amount */}
              {(() => {
                const showBonusCol = !isReturn && showBonus;
                const showDiscCol = showDiscount;
                const numCell = `border border-black px-0.5 py-1 text-center font-mono font-bold whitespace-nowrap ${
                  format === '80mm' ? 'text-[11px]' : 'text-[9.5px]'
                }`;
                const headCell = `border border-black px-0.5 py-1 text-center font-black whitespace-nowrap ${
                  format === '80mm' ? 'text-[10.5px]' : 'text-[9px]'
                }`;

                return (
                  <table
                    className={`w-full border-collapse border border-black border-t-0 text-black ${
                      format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    <thead>
                      <tr className="font-black text-black bg-white">
                        <th colSpan={2} className="border border-black px-1.5 py-1 text-center font-black">
                          Item Details
                        </th>
                        <th className={headCell}>Qty</th>
                        {showBonusCol && <th className={headCell}>Bonus</th>}
                        <th className={headCell}>Rate</th>
                        {showDiscCol && <th className={headCell}>Disc</th>}
                        <th className="border border-black px-1 py-1 text-right font-black whitespace-nowrap">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((line, idx) => {
                        const packQty = isReturn
                          ? Number(line.return_quantity ?? line.quantity ?? 0)
                          : Number(line.quantity ?? 0);
                        const looseQty = isReturn
                          ? Number(line.return_loose_quantity ?? line.loose_quantity ?? 0)
                          : Number(line.loose_quantity ?? 0);
                        const bonusQty = !isReturn ? Number(line.bonus_quantity ?? 0) : 0;
                        const discAmt = Number(line.discount_amount ?? 0);
                        const taxAmt = isReturn
                          ? Number(line.gst_amount ?? line.tax_amount ?? 0)
                          : Number(line.tax_amount ?? 0);

                        const displayQtyNum =
                          packQty > 0 && looseQty > 0
                            ? `${packQty}+${looseQty}L`
                            : packQty > 0
                            ? String(packQty)
                            : looseQty > 0
                            ? String(looseQty)
                            : '0';

                        const rawPacking = String(line.packing || '').trim();

                        const rateVal =
                          packQty === 0 && looseQty > 0 && Number(line.loose_rate || 0) > 0
                            ? Number(line.loose_rate)
                            : Number(line.unit_price || 0);

                        const rateFormatted =
                          rateVal % 1 === 0 ? rateVal.toFixed(0) : rateVal.toFixed(1);
                        const lineTotalVal = Number(line.line_total || 0);
                        const lineTotalFormatted = lineTotalVal.toFixed(1);

                        return (
                          <tr key={line.id || idx} className="align-middle">
                            <td className="border border-black px-1 py-1 text-center font-bold w-[20px]">
                              {idx + 1}
                            </td>
                            <td className="border border-black px-1.5 py-1 break-words">
                              <div
                                className={`font-bold text-black leading-snug ${
                                  format === '80mm' ? 'text-[12px]' : 'text-[10.5px]'
                                }`}
                              >
                                {showItemCode && line.item_code ? `[${line.item_code}] ` : ''}
                                {line.item_name}
                              </div>
                              {((showItemCompany && line.company_name) ||
                                (showPacking && rawPacking) ||
                                (showBatch && line.batch_number) ||
                                (showExpiry && line.expiry_date) ||
                                (showTax && taxAmt > 0)) && (
                                <div
                                  className={`text-black font-medium leading-tight mt-0.5 ${
                                    format === '80mm' ? 'text-[10px]' : 'text-[9px]'
                                  }`}
                                >
                                  {showItemCompany && line.company_name ? `${line.company_name} ` : ''}
                                  {showPacking && rawPacking ? `${rawPacking} ` : ''}
                                  {showBatch && line.batch_number ? `B:${line.batch_number} ` : ''}
                                  {showExpiry && line.expiry_date ? `Exp:${line.expiry_date} ` : ''}
                                  {showTax && taxAmt > 0 ? `Tax:+${taxAmt.toFixed(0)}` : ''}
                                </div>
                              )}
                            </td>
                            <td
                              className={`border border-black px-0.5 py-1 text-center font-black whitespace-nowrap ${
                                format === '80mm' ? 'text-[12px]' : 'text-[10.5px]'
                              }`}
                            >
                              {displayQtyNum}
                            </td>
                            {showBonusCol && (
                              <td className={numCell}>{bonusQty > 0 ? bonusQty : '-'}</td>
                            )}
                            <td className={numCell}>{rateFormatted}</td>
                            {showDiscCol && (
                              <td className={numCell}>{discAmt > 0 ? discAmt.toFixed(0) : '-'}</td>
                            )}
                            <td
                              className={`border border-black px-1 py-1 text-right font-mono font-black whitespace-nowrap ${
                                format === '80mm' ? 'text-[12px]' : 'text-[10.5px]'
                              }`}
                            >
                              {lineTotalFormatted}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}

              {/* 4. Financial Summary (full width, clean label/value rows) */}
              {(() => {
                const totalQtyCount = items.reduce((sum, line) => {
                  const p = isReturn
                    ? Number(line.return_quantity ?? line.quantity ?? 0)
                    : Number(line.quantity ?? 0);
                  const l = isReturn
                    ? Number(line.return_loose_quantity ?? line.loose_quantity ?? 0)
                    : Number(line.loose_quantity ?? 0);
                  const b = !isReturn ? Number(line.bonus_quantity ?? 0) : 0;
                  return sum + p + l + b;
                }, 0);

                const addExpenseVal = Number(docRecord.delivery_charges || 0);
                const is80 = format === '80mm';
                const lbl = 'border border-black px-2 py-0.5 text-left font-semibold';
                const val = 'border border-black px-2 py-0.5 text-right font-mono font-bold w-[42%]';

                return (
                  <table
                    className={`w-full border-collapse border border-black border-t-0 text-black ${
                      is80 ? 'text-[11.5px]' : 'text-[10px]'
                    }`}
                  >
                    <tbody>
                      <tr className="bg-white">
                        <td className="border border-black px-2 py-0.5 text-left font-bold">
                          Items: <span className="font-mono font-black">{items.length}</span>
                        </td>
                        <td className="border border-black px-2 py-0.5 text-right font-bold">
                          Total Qty:{' '}
                          <span className="font-mono font-black">
                            {Math.round(totalQtyCount * 100) / 100}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className={lbl}>Gross Total</td>
                        <td className={val}>{fmtMoney(savedGross)}</td>
                      </tr>
                      {showDiscount && Number(savedTotalDisc || 0) > 0 && (
                        <tr>
                          <td className={lbl}>Discount</td>
                          <td className={val}>- {fmtMoney(savedTotalDisc)}</td>
                        </tr>
                      )}
                      {Number(savedTotalTax || 0) > 0 && (
                        <tr>
                          <td className={lbl}>Tax (GST/Adv)</td>
                          <td className={val}>{fmtMoney(savedTotalTax)}</td>
                        </tr>
                      )}
                      {addExpenseVal > 0 && (
                        <tr>
                          <td className={lbl}>Add Expense</td>
                          <td className={val}>{fmtMoney(addExpenseVal)}</td>
                        </tr>
                      )}
                      <tr className={`font-black ${is80 ? 'text-[15px]' : 'text-[12px]'}`}>
                        <td className="border-2 border-black px-2 py-1 text-left font-black uppercase tracking-wide">
                          {isReturn ? 'Return Total' : 'Total Bill'}
                        </td>
                        <td className="border-2 border-black px-2 py-1 text-right font-mono font-black">
                          {fmtMoney(savedNetTotal)}
                        </td>
                      </tr>
                      {!isReturn && showPrevBalance && (
                        <>
                          <tr>
                            <td className={lbl}>Previous Balance</td>
                            <td className={val}>{fmtMoney(savedPrevBalance)}</td>
                          </tr>
                          <tr className={`font-black ${is80 ? 'text-[13px]' : 'text-[11px]'}`}>
                            <td className="border border-black px-2 py-0.5 text-left font-black">
                              Net Payable
                            </td>
                            <td className="border border-black px-2 py-0.5 text-right font-mono font-black">
                              {fmtMoney(savedTotalReceivable)}
                            </td>
                          </tr>
                        </>
                      )}
                      {showPaid && (
                        <tr>
                          <td className={lbl}>{isReturn ? 'Refunded' : 'Cash Received'}</td>
                          <td className={val}>{fmtMoney(savedPaidAmount)}</td>
                        </tr>
                      )}
                      {!isReturn && showRemaining && (
                        <tr className={`font-black ${is80 ? 'text-[14px]' : 'text-[11.5px]'}`}>
                          <td className="border-2 border-black px-2 py-1 text-left font-black uppercase tracking-wide">
                            Balance
                          </td>
                          <td className="border-2 border-black px-2 py-1 text-right font-mono font-black">
                            {fmtMoney(savedRemainingBalance)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                );
              })()}

              {/* 5. Thermal Footer & Policy Box */}
              <div
                className={`mt-2 text-center text-black space-y-1 ${
                  format === '80mm' ? 'text-[11.5px]' : 'text-[10px]'
                }`}
              >
                {fields.showSignature && (
                  <div className="pt-3 pb-1 text-center text-black">
                    <div className="border-t border-black w-3/4 mx-auto pt-1 font-semibold">
                      Authorized Signature
                    </div>
                  </div>
                )}

                <div
                  className={`font-black text-black ${
                    format === '80mm' ? 'text-[13px]' : 'text-[11px]'
                  }`}
                >
                  {thankYouMessage || 'Thanks for Shopping'}
                </div>

                {showFooterNote && (footerMessage || customTerms) && (
                  <div
                    className={`border border-black p-1.5 mt-1 text-center font-semibold leading-snug text-black space-y-0.5 ${
                      format === '80mm' ? 'text-[11px]' : 'text-[9.5px]'
                    }`}
                  >
                    {footerMessage && <p className="whitespace-pre-line">{footerMessage}</p>}
                    {customTerms && <p className="whitespace-pre-line">{customTerms}</p>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
