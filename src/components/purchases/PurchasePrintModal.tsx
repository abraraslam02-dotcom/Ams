import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Printer,
  X,
  Building2,
  FileText,
  Receipt,
  CheckCircle2,
  SlidersHorizontal,
  Info,
  Save,
  Ban,
  Eye,
  Download,
  Lock,
  RotateCcw,
  ArrowUpDown,
  Layers,
  LayoutGrid,
} from 'lucide-react';
import {
  CompanySettings,
  InvoiceFieldVisibility,
  DEFAULT_FIELD_VISIBILITY,
  parseFieldVisibility,
} from '../../types/system';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  executePrintElement,
  detectPrintCapabilities,
  buildInvoicePdfTitle,
  PaperSizeOption,
  PageOrientationOption,
  PageMarginOption,
  FontSizeScaleOption,
  PrintConfigurationProfileId,
} from '../../utils/printEngine';
import {
  GroupedPurchaseLine,
  PurchaseItemSortMode,
  PurchasePrintLayoutMode,
  PurchasePrintFieldsConfig,
  PurchasePrintOptions,
  DEFAULT_PURCHASE_PRINT_FIELDS,
  DEFAULT_PURCHASE_PRINT_OPTIONS,
  parsePurchasePrintOptions,
  mergePurchasePrintOptionsIntoJson,
  buildPurchasePrintViewData,
} from '../../utils/purchaseCompanyGrouping';
import { formatItemNameWithRemarks } from '../../utils/itemDisplay';
import { formatAppDate } from '../../utils/formatters';
import { usePreviewZoom, PreviewZoomToolbar } from '../common/PreviewZoomControls';

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
  const { isSuperAdmin } = useAuth();
  const resolvedPurchase = purchase || invoice;
  const doc = isOpen === false ? null : mode === 'invoice' ? resolvedPurchase : purchaseReturn;
  const items =
    propItems || (mode === 'invoice' ? invoiceItems || [] : returnItems || []);
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const hasAutoPrintedRef = useRef<boolean>(false);

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  // Purchase Return (legacy) states
  const [returnOrientation, setReturnOrientation] = useState<PageOrientationOption>('portrait');
  const [returnMargin, setReturnMargin] = useState<PageMarginOption>('standard');
  const [returnFontSizeScale, setReturnFontSizeScale] = useState<FontSizeScaleOption>('normal');
  const [returnCopies, setReturnCopies] = useState<number>(1);
  const [returnFields, setReturnFields] = useState<InvoiceFieldVisibility>({
    ...DEFAULT_FIELD_VISIBILITY,
  });

  // Purchase Invoice Advanced Print Options (defaults preserve exact existing invoice design)
  const [purchaseOptions, setPurchaseOptions] = useState<PurchasePrintOptions>(() => ({
    ...DEFAULT_PURCHASE_PRINT_OPTIONS,
    fields: { ...DEFAULT_PURCHASE_PRINT_FIELDS },
  }));

  const [selectedPrinter, setSelectedPrinter] = useState<string>(
    'System Default Printer (OS Print Spooler)'
  );

  // Derived active layout parameters
  const activeLayout: PurchasePrintLayoutMode =
    mode === 'invoice'
      ? purchaseOptions.layout
      : returnOrientation === 'landscape'
      ? 'a4-landscape'
      : 'a4-portrait';
  const isThermalLayout =
    mode === 'invoice' &&
    (activeLayout === 'thermal-80mm' || activeLayout === 'thermal-58mm');
  const isThermal58 = mode === 'invoice' && activeLayout === 'thermal-58mm';
  const activePaperSize: PaperSizeOption =
    activeLayout === 'thermal-80mm'
      ? '80mm'
      : activeLayout === 'thermal-58mm'
      ? '58mm'
      : 'a4';
  const activeOrientation: PageOrientationOption =
    activeLayout === 'a4-landscape' ? 'landscape' : 'portrait';
  const activeMargin: PageMarginOption =
    mode === 'invoice' ? purchaseOptions.margin : returnMargin;
  const activeFontScale: FontSizeScaleOption =
    mode === 'invoice' ? purchaseOptions.fontSizeScale : returnFontSizeScale;
  const activeCopies: number =
    mode === 'invoice' ? purchaseOptions.copies : returnCopies;

  const zoomState = usePreviewZoom({
    initialZoom: 100,
    naturalWidthPx: isThermal58
      ? 219
      : isThermalLayout
      ? 302
      : activeOrientation === 'landscape'
      ? 1123
      : 794,
    naturalHeightPx: activeOrientation === 'landscape' ? 794 : 1123,
    isThermal: isThermalLayout,
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
        if (s.page_orientation) setReturnOrientation(s.page_orientation);
        if (s.page_margin) setReturnMargin(s.page_margin);
        if (s.font_size_scale) setReturnFontSizeScale(s.font_size_scale);
        if (s.print_copies) setReturnCopies(Math.max(1, Number(s.print_copies) || 1));
        if (s.default_printer) setSelectedPrinter(s.default_printer);
        setReturnFields(parseFieldVisibility(s.field_visibility_json));
        setPurchaseOptions(parsePurchasePrintOptions(s.field_visibility_json));
      })
      .catch(() => {
        // ignore if offline
      });
    return () => {
      mounted = false;
    };
  }, []);

  const capabilities = detectPrintCapabilities(settings?.default_printer);

  const resolvedPartyName = doc
    ? String(doc.supplier_name || doc.account_name || 'Supplier').trim()
    : 'Supplier';
  const resolvedDocNumber = doc
    ? mode === 'invoice'
      ? doc.bill_number || doc.supplier_invoice_number || `PUR-${doc.id}`
      : doc.debit_note_number || `PRN-${doc.id}`
    : '0';
  const resolvedDocDate = doc
    ? mode === 'invoice'
      ? doc.bill_date || doc.invoice_date
      : doc.return_date || doc.bill_date
    : '';
  const pdfDocumentTitle = buildInvoicePdfTitle(
    resolvedPartyName,
    resolvedDocNumber,
    resolvedDocDate
  );

  useEffect(() => {
    if (!isOpen || !doc) return;
    const prevTitle = document.title;
    document.title = pdfDocumentTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [isOpen, doc, pdfDocumentTitle]);

  const executePurchasePrintJob = (overrideCopies?: number) => {
    if (!doc) return;
    const profileId: PrintConfigurationProfileId =
      activePaperSize === '80mm'
        ? 'thermal-80mm'
        : activePaperSize === '58mm'
        ? 'thermal-58mm'
        : 'a4-purchase-invoice';

    executePrintElement(printAreaRef.current, {
      title: pdfDocumentTitle,
      paperSize: activePaperSize,
      profileId,
      orientation: isThermalLayout ? 'portrait' : activeOrientation,
      margin: isThermalLayout ? 'none' : activeMargin,
      fontSizeScale: activeFontScale,
      copies: overrideCopies ?? activeCopies,
      selectedPrinter,
      showPageNumbers: mode === 'invoice' && !isThermalLayout,
    });
  };

  const handlePrint = () => {
    executePurchasePrintJob();
  };

  const handleSavePdf = () => {
    executePurchasePrintJob(1);
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

  // Compute sorted/grouped Purchase Invoice dataset without mutating saved numbers
  const purchasePrintData = useMemo(() => {
    if (mode !== 'invoice' || !doc) return null;
    return buildPurchasePrintViewData(doc, items, {
      sortMode: purchaseOptions.sortMode,
      groupByCompany: purchaseOptions.groupByCompany,
      showCompanyName: purchaseOptions.fields.showCompanyName,
    });
  }, [
    mode,
    doc,
    items,
    purchaseOptions.sortMode,
    purchaseOptions.groupByCompany,
    purchaseOptions.fields.showCompanyName,
  ]);

  if (!doc) return null;

  const isCancelled = String(doc.status || '').toLowerCase() === 'cancelled';

  const storeName = settings?.store_name || 'ABRAR MEDICAL STORE';
  const storeAddress = settings?.address || 'DAULATPUR';
  const storePhone = settings?.phone || '03003234323';
  const drugLicense = settings?.drug_license_number || 'DHO/SBA/230';
  const ntnNumber = settings?.ntn_tax_number || 'NTN-PK-73943087';
  const logoDataUrl = settings?.logo_data_url || '';

  const formatPKR = (val: unknown) =>
    Number(val || 0).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const pFields = purchaseOptions.fields;
  const fields = returnFields;

  const toggleReturnField = (key: keyof InvoiceFieldVisibility) => {
    setReturnFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const togglePurchaseField = (key: keyof PurchasePrintFieldsConfig) => {
    if (!isSuperAdmin && key !== 'showCompanyName') return;
    setPurchaseOptions((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [key]: !prev.fields[key],
      },
    }));
  };

  const handleSortModeChange = (nextSort: PurchaseItemSortMode) => {
    setPurchaseOptions((prev) => ({
      ...prev,
      sortMode: nextSort,
      groupByCompany: nextSort === 'company' ? true : false,
    }));
  };

  const handleCompanyGroupingChange = (shouldGroup: boolean) => {
    setPurchaseOptions((prev) => ({
      ...prev,
      groupByCompany: shouldGroup,
      sortMode: shouldGroup && prev.sortMode === 'direct' ? 'company' : prev.sortMode,
      fields: shouldGroup
        ? { ...prev.fields, showCompanyName: true }
        : prev.fields,
    }));
  };

  const handleCompanyVisibilityChange = (show: boolean) => {
    setPurchaseOptions((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        showCompanyName: show,
      },
    }));
  };

  const handleLayoutChange = (nextLayout: PurchasePrintLayoutMode) => {
    setPurchaseOptions((prev) => ({
      ...prev,
      layout: nextLayout,
    }));
  };

  const handleResetPurchaseDefaults = () => {
    if (!isSuperAdmin) return;
    setPurchaseOptions({
      ...DEFAULT_PURCHASE_PRINT_OPTIONS,
      fields: { ...DEFAULT_PURCHASE_PRINT_FIELDS },
    });
  };

  const handleShowAllPurchaseFields = () => {
    if (!isSuperAdmin) return;
    const allTrue: PurchasePrintFieldsConfig = { ...DEFAULT_PURCHASE_PRINT_FIELDS };
    (Object.keys(allTrue) as Array<keyof PurchasePrintFieldsConfig>).forEach((k) => {
      allTrue[k] = true;
    });
    setPurchaseOptions((prev) => ({ ...prev, fields: allTrue }));
  };

  const handleSaveAsDefault = async () => {
    try {
      setSavingDefaults(true);
      setSaveFeedback(null);
      if (mode === 'invoice') {
        if (!isSuperAdmin) {
          setSaveFeedback('Only Super Admin can save store defaults');
          setTimeout(() => setSaveFeedback(null), 3000);
          return;
        }
        // Preserve all existing Sales Invoice settings in field_visibility_json untouched!
        const mergedFieldJson = mergePurchasePrintOptionsIntoJson(
          settings?.field_visibility_json,
          purchaseOptions
        );
        await api.updateCompanySettings({
          field_visibility_json: mergedFieldJson,
        });
        setSettings((prev) =>
          prev ? { ...prev, field_visibility_json: mergedFieldJson } : prev
        );
        setSaveFeedback('Purchase Print Defaults Saved');
      } else {
        await api.updateCompanySettings({
          default_printer: selectedPrinter,
          print_copies: returnCopies,
          page_orientation: returnOrientation,
          page_margin: returnMargin,
          font_size_scale: returnFontSizeScale,
          field_visibility_json: JSON.stringify(returnFields),
        });
        setSaveFeedback('Saved as Store Default');
      }
      setTimeout(() => setSaveFeedback(null), 3000);
    } catch (err: any) {
      setSaveFeedback(err?.message || 'Failed to save defaults');
    } finally {
      setSavingDefaults(false);
    }
  };

  const fontScaleClass =
    activeFontScale === 'small'
      ? 'text-[11px]'
      : activeFontScale === 'large'
      ? 'text-[13.5px]'
      : 'text-xs';

  const invoiceTableFontClass =
    activeOrientation === 'landscape'
      ? activeFontScale === 'small'
        ? 'text-[9.25px]'
        : activeFontScale === 'large'
        ? 'text-[11px]'
        : 'text-[10px]'
      : activeFontScale === 'small'
      ? 'text-[8.75px]'
      : activeFontScale === 'large'
      ? 'text-[10.5px]'
      : 'text-[9.5px]';

  const supplierInvoiceNo = String(doc.supplier_invoice_number || '').trim();

  // Dynamic A4 table column builder (auto-adjusts column widths for A4 Portrait & A4 Landscape)
  type A4ColumnKey =
    | 'sno'
    | 'code'
    | 'company'
    | 'item'
    | 'packing'
    | 'qty'
    | 'loose'
    | 'bonus'
    | 'batch'
    | 'expiry'
    | 'rate'
    | 'discPct'
    | 'discAmt'
    | 'salesTax'
    | 'advTax'
    | 'net';

  interface A4ColumnDef {
    key: A4ColumnKey;
    label: string;
    align: 'left' | 'right' | 'center';
    weight: number;
  }

  const isLandscape = activeOrientation === 'landscape';
  const showSeparatePackingCol = isLandscape && pFields.showPacking && pFields.showItemName;
  const showSeparateLooseCol = !pFields.showQuantity && pFields.showLooseQuantity;

  const rawA4Columns: A4ColumnDef[] = [];
  rawA4Columns.push({ key: 'sno', label: 'S.No', align: 'center', weight: isLandscape ? 3.5 : 4 });
  if (pFields.showItemCode) {
    rawA4Columns.push({ key: 'code', label: 'Code', align: 'left', weight: isLandscape ? 7.5 : 7.5 });
  }
  if (purchasePrintData && !purchasePrintData.isGrouped && pFields.showCompanyName) {
    rawA4Columns.push({
      key: 'company',
      label: 'Company',
      align: 'left',
      weight: isLandscape ? 11 : 10.5,
    });
  }
  if (pFields.showItemName || (pFields.showPacking && !showSeparatePackingCol)) {
    rawA4Columns.push({
      key: 'item',
      label: pFields.showItemName ? 'Item Name' : 'Packing',
      align: 'left',
      weight: isLandscape ? 23 : 25.5,
    });
  }
  if (showSeparatePackingCol) {
    rawA4Columns.push({ key: 'packing', label: 'Packing', align: 'left', weight: 8 });
  }
  if (pFields.showQuantity) {
    rawA4Columns.push({ key: 'qty', label: 'Qty', align: 'right', weight: 5 });
  }
  if (showSeparateLooseCol) {
    rawA4Columns.push({ key: 'loose', label: 'Loose', align: 'right', weight: 5 });
  }
  if (pFields.showBonusQuantity) {
    rawA4Columns.push({ key: 'bonus', label: 'Bonus', align: 'right', weight: 5 });
  }
  if (pFields.showBatchNumber) {
    rawA4Columns.push({ key: 'batch', label: 'Batch', align: 'left', weight: isLandscape ? 8.5 : 8.5 });
  }
  if (pFields.showExpiryDate) {
    rawA4Columns.push({ key: 'expiry', label: 'Expiry', align: 'left', weight: isLandscape ? 8 : 8.5 });
  }
  if (pFields.showPurchaseRate) {
    rawA4Columns.push({ key: 'rate', label: 'Trade Price', align: 'right', weight: 8 });
  }
  if (pFields.showDiscount) {
    rawA4Columns.push({ key: 'discPct', label: 'Discount %', align: 'right', weight: 5.5 });
    rawA4Columns.push({ key: 'discAmt', label: 'Discount Amount', align: 'right', weight: 7.5 });
  }
  if (pFields.showTax) {
    rawA4Columns.push({ key: 'salesTax', label: 'Sales Tax Amount', align: 'right', weight: 7.5 });
    rawA4Columns.push({ key: 'advTax', label: 'Advance Tax', align: 'right', weight: 7 });
  }
  if (pFields.showNetAmount) {
    rawA4Columns.push({ key: 'net', label: 'Value With All Taxes', align: 'right', weight: 8 });
  }

  const totalColWeight = rawA4Columns.reduce((s, c) => s + c.weight, 0) || 100;
  const a4Columns = rawA4Columns.map((col) => ({
    ...col,
    widthPercent: `${((col.weight / totalColWeight) * 100).toFixed(2)}%`,
  }));

  const formatLineDisplayName = (line: GroupedPurchaseLine) => {
    const baseName =
      line.variantName && !String(line.itemName || '').includes(line.variantName)
        ? `${line.itemName} — ${line.variantName}`
        : line.itemName;
    return pFields.showRemarks ? formatItemNameWithRemarks(baseName, line.remarks) : baseName;
  };

  const activeLayoutLabel =
    activeLayout === 'a4-landscape'
      ? 'A4 Landscape (297 × 210 mm)'
      : activeLayout === 'thermal-80mm'
      ? 'Thermal 80mm Receipt'
      : activeLayout === 'thermal-58mm'
      ? 'Thermal 58mm Receipt'
      : 'A4 Portrait (210 × 297 mm)';

  const corePurchaseFieldCount = [
    pFields.showCompanyName,
    pFields.showItemName,
    pFields.showItemCode,
    pFields.showPacking,
    pFields.showBatchNumber,
    pFields.showExpiryDate,
    pFields.showQuantity,
    pFields.showBonusQuantity,
    pFields.showLooseQuantity,
    pFields.showPurchaseRate,
    pFields.showDiscount,
    pFields.showTax,
    pFields.showNetAmount,
    pFields.showTotalQuantity,
    pFields.showTotalItems,
    pFields.showInvoiceNumber,
    pFields.showInvoiceDate,
    pFields.showSupplierName,
    pFields.showPreviousBalance,
    pFields.showPaidAmount,
    pFields.showRemainingBalance,
    pFields.showRemarks,
  ].filter(Boolean).length;

  const renderA4LineRow = (
    line: GroupedPurchaseLine,
    keyStr: string,
    isLastInCompany = false
  ) => (
    <tr
      key={keyStr}
      className={`border-b border-slate-200 odd:bg-white even:bg-slate-50/40 ${
        isLastInCompany ? 'ams-keep-with-next' : ''
      }`}
    >
      {a4Columns.map((col, colIdx) => {
        const isLastCol = colIdx === a4Columns.length - 1;
        const borderClass = isLastCol ? '' : 'border-r border-slate-200';
        switch (col.key) {
          case 'sno':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-center font-mono tabular-nums text-slate-600 ${borderClass} align-top`}
              >
                {line.sNo}
              </td>
            );
          case 'code':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-left font-mono text-slate-700 ${borderClass} align-top break-words`}
              >
                {line.variantCode || line.itemCode || '—'}
              </td>
            );
          case 'company':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1.5 text-left font-semibold text-slate-800 ${borderClass} align-top break-words`}
              >
                {line.companyName}
              </td>
            );
          case 'item':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1.5 text-left ${borderClass} align-top break-words`}
              >
                {pFields.showItemName && (
                  <div className="font-bold text-slate-900 break-words">
                    {formatLineDisplayName(line)}
                  </div>
                )}
                {pFields.showPacking && !showSeparatePackingCol && line.packing ? (
                  <div
                    className={
                      pFields.showItemName
                        ? 'text-[8.5px] text-slate-500'
                        : 'font-semibold text-slate-800'
                    }
                  >
                    {line.packing}
                  </div>
                ) : null}
              </td>
            );
          case 'packing':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-left text-slate-700 ${borderClass} align-top break-words`}
              >
                {line.packing || '—'}
              </td>
            );
          case 'qty':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums font-bold text-slate-900 ${borderClass} align-top whitespace-nowrap`}
              >
                {line.quantity}
                {pFields.showLooseQuantity && line.looseQuantity > 0 && (
                  <div className="text-[8px] font-normal text-slate-500">
                    +{line.looseQuantity} L
                  </div>
                )}
              </td>
            );
          case 'loose':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-800 ${borderClass} align-top whitespace-nowrap`}
              >
                {line.looseQuantity}
              </td>
            );
          case 'bonus':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-800 ${borderClass} align-top whitespace-nowrap`}
              >
                {line.bonusQuantity}
              </td>
            );
          case 'batch':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-left font-mono text-slate-800 ${borderClass} align-top break-words`}
              >
                {line.batchNumber}
              </td>
            );
          case 'expiry':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-left font-mono tabular-nums text-slate-700 ${borderClass} align-top whitespace-nowrap`}
              >
                {line.expiryDate}
              </td>
            );
          case 'rate':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-900 ${borderClass} align-top whitespace-nowrap`}
              >
                {formatPKR(line.tradePrice)}
              </td>
            );
          case 'discPct':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-700 ${borderClass} align-top whitespace-nowrap`}
              >
                {line.discountPercent > 0 ? `${line.discountPercent.toFixed(1)}%` : '0.0%'}
              </td>
            );
          case 'discAmt':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-800 ${borderClass} align-top whitespace-nowrap`}
              >
                {formatPKR(line.discountAmount)}
              </td>
            );
          case 'salesTax':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-800 ${borderClass} align-top whitespace-nowrap`}
              >
                {formatPKR(line.salesTaxAmount)}
              </td>
            );
          case 'advTax':
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-800 ${borderClass} align-top whitespace-nowrap`}
              >
                {formatPKR(line.advanceTaxAmount)}
              </td>
            );
          case 'net':
          default:
            return (
              <td
                key={col.key}
                className={`py-1.5 px-1 text-right font-mono tabular-nums font-bold text-slate-950 ${borderClass} align-top whitespace-nowrap`}
              >
                {formatPKR(line.valueWithAllTaxes)}
              </td>
            );
        }
      })}
    </tr>
  );

  const renderA4CompanyFooterRow = (group: {
    companyName: string;
    totalQuantity: number;
    totalLooseQuantity: number;
    totalBonus: number;
    grossAmount: number;
    totalDiscountAmount: number;
    totalSalesTax: number;
    totalAdvanceTax: number;
    totalValueWithAllTaxes: number;
  }) => {
    const leadingKeys: A4ColumnKey[] = ['sno', 'code', 'company', 'item', 'packing'];
    const grossSpanKeys: A4ColumnKey[] = ['batch', 'expiry', 'rate', 'discPct'];

    const cells: React.ReactNode[] = [];
    let i = 0;
    let grossRendered = false;

    while (i < a4Columns.length) {
      const col = a4Columns[i];

      if (leadingKeys.includes(col.key)) {
        let span = 0;
        while (i + span < a4Columns.length && leadingKeys.includes(a4Columns[i + span].key)) {
          span++;
        }
        const isLast = i + span >= a4Columns.length;
        const hasAnyGrossCol = a4Columns.some((c) => grossSpanKeys.includes(c.key));
        cells.push(
          <td
            key={`lead-${i}`}
            colSpan={span}
            className={`py-1.5 px-1.5 text-left ${isLast ? '' : 'border-r border-slate-300'}`}
          >
            <span className="uppercase tracking-tight">
              {group.companyName} — Company Total
            </span>
            {!hasAnyGrossCol && (
              <span className="ml-2 font-mono text-[8.5px] font-semibold text-slate-600">
                (Gross: {formatPKR(group.grossAmount)})
              </span>
            )}
          </td>
        );
        if (!hasAnyGrossCol) grossRendered = true;
        i += span;
        continue;
      }

      if (grossSpanKeys.includes(col.key)) {
        let span = 0;
        while (i + span < a4Columns.length && grossSpanKeys.includes(a4Columns[i + span].key)) {
          span++;
        }
        const isLast = i + span >= a4Columns.length;
        cells.push(
          <td
            key={`gross-${i}`}
            colSpan={span}
            className={`py-1.5 px-1.5 text-right font-mono tabular-nums ${
              isLast ? '' : 'border-r border-slate-300'
            } whitespace-nowrap`}
          >
            {!grossRendered ? (
              <>
                <span className="font-sans font-semibold text-slate-600 mr-1">
                  Gross Amount:
                </span>
                {formatPKR(group.grossAmount)}
              </>
            ) : (
              ''
            )}
          </td>
        );
        grossRendered = true;
        i += span;
        continue;
      }

      const isLast = i === a4Columns.length - 1;
      const borderClass = isLast ? '' : 'border-r border-slate-300';
      switch (col.key) {
        case 'qty':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {group.totalQuantity}
              {pFields.showLooseQuantity && group.totalLooseQuantity > 0 && (
                <div className="text-[8px] font-normal text-slate-600">
                  +{group.totalLooseQuantity} L
                </div>
              )}
            </td>
          );
          break;
        case 'loose':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {group.totalLooseQuantity}
            </td>
          );
          break;
        case 'bonus':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {group.totalBonus}
            </td>
          );
          break;
        case 'discAmt':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {formatPKR(group.totalDiscountAmount)}
            </td>
          );
          break;
        case 'salesTax':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {formatPKR(group.totalSalesTax)}
            </td>
          );
          break;
        case 'advTax':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums ${borderClass} whitespace-nowrap`}
            >
              {formatPKR(group.totalAdvanceTax)}
            </td>
          );
          break;
        case 'net':
          cells.push(
            <td
              key={col.key}
              className={`py-1.5 px-1 text-right font-mono tabular-nums text-slate-950 ${borderClass} whitespace-nowrap`}
            >
              {formatPKR(group.totalValueWithAllTaxes)}
            </td>
          );
          break;
        default:
          cells.push(<td key={col.key} className={`py-1.5 px-1 ${borderClass}`} />);
          break;
      }
      i += 1;
    }

    return (
      <tr className="ams-avoid-break bg-slate-100 border-t border-b-2 border-slate-400 font-bold text-slate-900">
        {cells}
      </tr>
    );
  };

  return (
    <div
      className={`print-modal-container fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center ${
        zoomState.isFullScreen ? 'p-0' : 'p-1.5 lg:p-3'
      } overflow-hidden print:bg-white print:p-0 print:block`}
    >
      <div
        className={`bg-white shadow-2xl border border-slate-300 w-full overflow-hidden flex flex-col print:shadow-none print:border-none print:max-w-full print:max-h-none print:rounded-none ${
          zoomState.isFullScreen
            ? 'h-screen max-w-none max-h-none rounded-none border-0'
            : 'max-w-[96vw] xl:max-w-7xl h-[95vh] max-h-[95vh] rounded-xl'
        }`}
      >
        {/* Top Modal Action Bar (Hidden when printing) */}
        <div className="bg-slate-900 text-white px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            {isThermalLayout ? (
              <Receipt className="w-5 h-5 text-emerald-400" />
            ) : (
              <FileText className="w-5 h-5 text-emerald-400" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  {mode === 'invoice'
                    ? `Purchase Invoice Print Preview (${activeLayoutLabel}) — ${doc.bill_number}`
                    : `Purchase Return (Debit Note) Print Preview (A4 210 × 297 mm) — ${doc.debit_note_number}`}
                </h3>
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider">
                    CANCELLED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {mode === 'invoice'
                  ? `${activeLayoutLabel} · ${
                      purchaseOptions.sortMode === 'company'
                        ? 'Sorted by Company'
                        : purchaseOptions.sortMode === 'item_name'
                        ? 'Sorted by Item Name (A-Z)'
                        : 'All Items Directly'
                    } · ${
                      purchasePrintData?.isGrouped
                        ? 'Company-Wise Grouped'
                        : pFields.showCompanyName
                        ? 'Continuous List (With Company)'
                        : 'Continuous List (Company Hidden)'
                    }`
                  : 'A4 Standard (210 × 297 mm) · Multi-Page Desktop Preview · Batch & Expiry · Advance Tax Verified'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              <span>
                {mode === 'invoice'
                  ? `Print Fields (${corePurchaseFieldCount}/22)`
                  : 'Page & Fields'}
              </span>
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
              onClick={handleSavePdf}
              title={`Save as PDF: ${pdfDocumentTitle}.pdf`}
              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save as PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              title={`Print (${pdfDocumentTitle})`}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>
                {isThermalLayout
                  ? `Print Thermal ${isThermal58 ? '58mm' : '80mm'}`
                  : `Print A4 ${activeOrientation === 'landscape' ? 'Landscape' : 'Portrait'}`}{' '}
                ({activeCopies} {activeCopies === 1 ? 'Copy' : 'Copies'})
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close Preview</span>
            </button>
          </div>
        </div>

        {/* Purchase Print Options Bar — Sorting, Company Display & Print Layout (Purchase Invoice Mode) */}
        {mode === 'invoice' && (
          <div className="bg-slate-800/95 text-slate-200 px-5 py-2 border-b border-slate-700 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs shrink-0 print:hidden">
            {/* 1. Sorting Options */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mr-0.5">
                <ArrowUpDown className="w-3 h-3 text-emerald-400" />
                Sort:
              </span>
              {(
                [
                  { id: 'company', label: 'Sort by Company' },
                  { id: 'item_name', label: 'Sort by Item Name' },
                  { id: 'direct', label: 'All Items Directly' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSortModeChange(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                    purchaseOptions.sortMode === opt.id
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-xs'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* 2. Company Display Options */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-sky-400" />
                Company:
              </span>
              <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden bg-slate-900">
                <button
                  type="button"
                  onClick={() => handleCompanyGroupingChange(true)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    purchaseOptions.groupByCompany && purchaseOptions.sortMode !== 'direct'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Group by Company
                </button>
                <button
                  type="button"
                  onClick={() => handleCompanyGroupingChange(false)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer border-l border-slate-700 ${
                    !purchaseOptions.groupByCompany || purchaseOptions.sortMode === 'direct'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  All Together
                </button>
              </div>

              <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden bg-slate-900">
                <button
                  type="button"
                  onClick={() => handleCompanyVisibilityChange(true)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    pFields.showCompanyName
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Show Company
                </button>
                <button
                  type="button"
                  onClick={() => handleCompanyVisibilityChange(false)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer border-l border-slate-700 ${
                    !pFields.showCompanyName
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Hide Company
                </button>
              </div>
            </div>

            {/* 3. Print Layout Options */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mr-0.5">
                <LayoutGrid className="w-3 h-3 text-amber-400" />
                Layout:
              </span>
              {(
                [
                  { id: 'a4-portrait', label: 'A4 Portrait' },
                  { id: 'a4-landscape', label: 'A4 Landscape' },
                  { id: 'thermal-80mm', label: 'Thermal 80mm' },
                  { id: 'thermal-58mm', label: 'Thermal 58mm' },
                ] as const
              ).map((lay) => (
                <button
                  key={lay.id}
                  type="button"
                  onClick={() => handleLayoutChange(lay.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                    purchaseOptions.layout === lay.id
                      ? 'bg-amber-500 border-amber-400 text-slate-950 font-bold shadow-xs'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {lay.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Secondary Print Controls Bar */}
        <div className="bg-slate-800 text-slate-200 px-5 py-1.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 print:hidden">
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

            {mode === 'return' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Orientation:
                </span>
                <select
                  value={returnOrientation}
                  onChange={(e) => setReturnOrientation(e.target.value as PageOrientationOption)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                >
                  <option value="portrait">Portrait (A4 210 × 297 mm)</option>
                  <option value="landscape">Landscape (A4 297 × 210 mm)</option>
                </select>
              </div>
            )}

            {!isThermalLayout && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Margins:
                </span>
                <select
                  value={activeMargin}
                  onChange={(e) => {
                    const val = e.target.value as PageMarginOption;
                    if (mode === 'invoice') {
                      setPurchaseOptions((prev) => ({ ...prev, margin: val }));
                    } else {
                      setReturnMargin(val);
                    }
                  }}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                >
                  <option value="none">None (0mm)</option>
                  <option value="minimum">Minimum (4mm)</option>
                  <option value="compact">Compact (6mm)</option>
                  <option value="standard">Standard (8mm)</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Font Size:
              </span>
              <select
                value={activeFontScale}
                onChange={(e) => {
                  const val = e.target.value as FontSizeScaleOption;
                  if (mode === 'invoice') {
                    setPurchaseOptions((prev) => ({ ...prev, fontSizeScale: val }));
                  } else {
                    setReturnFontSizeScale(val);
                  }
                }}
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
                value={activeCopies}
                onChange={(e) => {
                  const c = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                  if (mode === 'invoice') {
                    setPurchaseOptions((prev) => ({ ...prev, copies: c }));
                  } else {
                    setReturnCopies(c);
                  }
                }}
                className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center text-white font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PreviewZoomToolbar
              zoomState={zoomState}
              dark
              compact
              showPageNav={!isThermalLayout}
              showFullScreenButton
            />
            {saveFeedback && (
              <span className="text-[11px] font-semibold text-emerald-400">{saveFeedback}</span>
            )}
            {(mode !== 'invoice' || isSuperAdmin) && (
              <button
                type="button"
                onClick={handleSaveAsDefault}
                disabled={savingDefaults}
                className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Save className="w-3 h-3 text-emerald-400" />
                <span>
                  {savingDefaults
                    ? 'Saving...'
                    : mode === 'invoice'
                    ? 'Save Purchase Defaults'
                    : 'Save as Store Default'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Field Visibility Drawer */}
        {showFieldControls && (
          <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 text-xs shrink-0 max-h-[38vh] overflow-y-auto print:hidden">
            {mode === 'invoice' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-800 flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Purchase Print Fields Configuration</span>
                    {isSuperAdmin ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                        Super Admin Enabled
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase inline-flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" />
                        Super Admin Only (Read-Only)
                      </span>
                    )}
                  </div>

                  {isSuperAdmin && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleShowAllPurchaseFields}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold cursor-pointer"
                      >
                        Show All Fields
                      </button>
                      <button
                        type="button"
                        onClick={handleResetPurchaseDefaults}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset Default Design</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Group 1: Line Item Columns */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Line Item Fields
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
                    {(
                      [
                        { key: 'showCompanyName', label: 'Company Name' },
                        { key: 'showItemName', label: 'Item Name' },
                        { key: 'showItemCode', label: 'Item Code' },
                        { key: 'showPacking', label: 'Packing' },
                        { key: 'showBatchNumber', label: 'Batch Number' },
                        { key: 'showExpiryDate', label: 'Expiry Date' },
                        { key: 'showQuantity', label: 'Quantity' },
                        { key: 'showBonusQuantity', label: 'Bonus Quantity' },
                        { key: 'showLooseQuantity', label: 'Loose Quantity' },
                        { key: 'showPurchaseRate', label: 'Purchase Rate' },
                        { key: 'showDiscount', label: 'Discount' },
                        { key: 'showTax', label: 'Tax' },
                        { key: 'showNetAmount', label: 'Net Amount' },
                      ] as Array<{ key: keyof PurchasePrintFieldsConfig; label: string }>
                    ).map((item) => {
                      const canToggle = isSuperAdmin || item.key === 'showCompanyName';
                      return (
                        <label
                          key={item.key}
                          className={`flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1 select-none ${
                            canToggle
                              ? 'cursor-pointer hover:border-emerald-400'
                              : 'opacity-65 cursor-not-allowed'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!canToggle}
                            checked={Boolean(pFields[item.key])}
                            onChange={() => togglePurchaseField(item.key)}
                            className="rounded text-emerald-600"
                          />
                          <span className="text-[11px] font-medium text-slate-700 truncate">
                            {item.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Group 2: Header, Totals, Balances & Footer */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Invoice Header, Totals, Balances & Footer
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
                    {(
                      [
                        { key: 'showInvoiceNumber', label: 'Invoice Number' },
                        { key: 'showInvoiceDate', label: 'Invoice Date' },
                        { key: 'showSupplierName', label: 'Supplier Name' },
                        { key: 'showTotalQuantity', label: 'Total Quantity' },
                        { key: 'showTotalItems', label: 'Total Items' },
                        { key: 'showPreviousBalance', label: 'Previous Balance' },
                        { key: 'showPaidAmount', label: 'Paid Amount' },
                        { key: 'showRemainingBalance', label: 'Remaining Balance' },
                        { key: 'showRemarks', label: 'Remarks' },
                        { key: 'showLogo', label: 'Store Logo' },
                        { key: 'showDrugLicense', label: 'Drug License #' },
                        { key: 'showNtn', label: 'NTN / Tax ID' },
                        { key: 'showSignature', label: 'Signatures' },
                        { key: 'showAccountingVerification', label: 'GL Journal Proof' },
                      ] as Array<{ key: keyof PurchasePrintFieldsConfig; label: string }>
                    ).map((item) => (
                      <label
                        key={item.key}
                        className={`flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1 select-none ${
                          isSuperAdmin
                            ? 'cursor-pointer hover:border-emerald-400'
                            : 'opacity-65 cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isSuperAdmin}
                          checked={Boolean(pFields[item.key])}
                          onChange={() => togglePurchaseField(item.key)}
                          className="rounded text-emerald-600"
                        />
                        <span className="text-[11px] font-medium text-slate-700 truncate">
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
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
                        onChange={() =>
                          toggleReturnField(item.key as keyof InvoiceFieldVisibility)
                        }
                        className="rounded text-emerald-600"
                      />
                      <span className="text-[11px] font-medium text-slate-700 truncate">
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {showPrinterGuide && (
          <div className="bg-sky-50 border-b border-sky-200 px-5 py-2.5 text-xs text-sky-950 shrink-0 print:hidden">
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

        {/* MS Access / Windows Desktop-Style Grey Print Preview Workspace */}
        <div
          ref={zoomState.viewportRef}
          onWheel={zoomState.handleWheelZoom}
          className="flex-1 overflow-auto p-6 lg:p-8 bg-[#525659] flex justify-center items-start print:p-0 print:bg-white print:overflow-visible"
        >
          <div
            ref={zoomState.contentRef}
            style={{ zoom: `${zoomState.zoom}%` } as React.CSSProperties}
            className="ams-screen-zoom-wrapper inline-flex justify-center items-start h-auto min-h-0 transition-all duration-75"
          >
            {mode === 'invoice' && isThermalLayout && purchasePrintData ? (
              /* ================================================================
                 THERMAL RECEIPT LAYOUT (80mm / 58mm) FOR PURCHASE INVOICE
                 ================================================================ */
              <div
                ref={printAreaRef}
                className={`thermal-receipt ${
                  isThermal58 ? 'thermal-58mm w-[58mm] max-w-[58mm]' : 'thermal-80mm w-[80mm] max-w-[80mm]'
                } bg-white border border-slate-400 shadow-[0_12px_32px_rgba(0,0,0,0.45)] text-black ${
                  isThermal58 ? 'px-1.5 py-2 text-[9px]' : 'px-2.5 py-3 text-[10px]'
                } leading-tight space-y-2 relative print:border-0 print:shadow-none`}
              >
                {isCancelled && (
                  <div className="border-2 border-black text-center font-black uppercase py-1 text-[11px] tracking-wider">
                    *** CANCELLED PURCHASE ***
                  </div>
                )}

                {/* Store Header */}
                <div className="text-center border-b border-dashed border-black pb-1.5 space-y-0.5">
                  {pFields.showLogo && logoDataUrl && (
                    <img
                      src={logoDataUrl}
                      alt={storeName}
                      className="w-10 h-10 object-contain mx-auto mb-1"
                    />
                  )}
                  <div className="font-black text-[12px] uppercase tracking-tight">{storeName}</div>
                  <div className="text-[9px]">{storeAddress}</div>
                  <div className="text-[9px]">Ph: {storePhone}</div>
                  {(pFields.showDrugLicense || pFields.showNtn) && (
                    <div className="text-[8.5px]">
                      {pFields.showDrugLicense && drugLicense ? `DL: ${drugLicense}` : ''}
                      {pFields.showDrugLicense && drugLicense && pFields.showNtn && ntnNumber
                        ? ' | '
                        : ''}
                      {pFields.showNtn && ntnNumber ? `NTN: ${ntnNumber}` : ''}
                    </div>
                  )}
                  <div className="inline-block mt-1 px-2 py-0.5 border border-black font-black uppercase text-[9.5px]">
                    PURCHASE INVOICE
                  </div>
                </div>

                {/* Invoice & Supplier Meta */}
                {(pFields.showInvoiceNumber ||
                  pFields.showInvoiceDate ||
                  pFields.showSupplierName ||
                  pFields.showTotalItems) && (
                  <div className="border-b border-dashed border-black pb-1.5 space-y-0.5 text-[9.5px]">
                    {pFields.showInvoiceNumber && (
                      <div className="flex justify-between gap-1">
                        <span className="font-semibold">Inv #:</span>
                        <span className="font-mono font-bold">{doc.bill_number}</span>
                      </div>
                    )}
                    {pFields.showInvoiceNumber && supplierInvoiceNo && (
                      <div className="flex justify-between gap-1">
                        <span className="font-semibold">Sup Inv #:</span>
                        <span className="font-mono font-bold">{supplierInvoiceNo}</span>
                      </div>
                    )}
                    {pFields.showInvoiceDate && (
                      <div className="flex justify-between gap-1">
                        <span className="font-semibold">Date:</span>
                        <span className="font-mono font-bold">
                          {formatAppDate(doc.bill_date)}
                        </span>
                      </div>
                    )}
                    {pFields.showSupplierName && (
                      <div className="flex justify-between gap-1">
                        <span className="font-semibold shrink-0">Supplier:</span>
                        <span className="font-bold text-right break-words">
                          {doc.supplier_name}
                        </span>
                      </div>
                    )}
                    {pFields.showTotalItems && (
                      <div className="flex justify-between gap-1">
                        <span className="font-semibold">Items:</span>
                        <span className="font-mono font-bold">
                          {purchasePrintData.totalItemsCount}
                          {pFields.showCompanyName
                            ? ` (${purchasePrintData.companyCount} Co.)`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Thermal Items List */}
                <div className="space-y-1.5">
                  {purchasePrintData.flatItems.length === 0 ? (
                    <div className="text-center py-3 text-[9px]">No purchase items.</div>
                  ) : purchasePrintData.isGrouped ? (
                    purchasePrintData.groups.map((group) => (
                      <div key={group.companyKey} className="space-y-1 border-b border-black pb-1.5">
                        <div className="font-black uppercase text-[9.5px] border-b border-black pb-0.5 flex justify-between">
                          <span>{group.companyName}</span>
                          <span className="font-mono">{group.items.length}</span>
                        </div>
                        {group.items.map((line) => (
                          <div
                            key={line.raw.id || `${group.companyKey}-${line.sNo}`}
                            className="border-b border-dotted border-black/60 pb-1 last:border-b-0"
                          >
                            {(pFields.showItemName || pFields.showItemCode || pFields.showPacking) && (
                              <div className="font-bold break-words">
                                {line.sNo}.{' '}
                                {pFields.showItemCode && (line.variantCode || line.itemCode)
                                  ? `[${line.variantCode || line.itemCode}] `
                                  : ''}
                                {pFields.showItemName ? formatLineDisplayName(line) : ''}
                                {pFields.showPacking && line.packing
                                  ? ` (${line.packing})`
                                  : ''}
                              </div>
                            )}
                            {(pFields.showBatchNumber || pFields.showExpiryDate) && (
                              <div className="text-[8.5px] font-mono">
                                {pFields.showBatchNumber ? `B:${line.batchNumber}` : ''}
                                {pFields.showBatchNumber && pFields.showExpiryDate ? ' | ' : ''}
                                {pFields.showExpiryDate ? `Exp:${line.expiryDate}` : ''}
                              </div>
                            )}
                            <div className="flex justify-between font-mono text-[9px]">
                              <span>
                                {pFields.showQuantity ? `Q:${line.quantity}` : ''}
                                {pFields.showLooseQuantity && line.looseQuantity > 0
                                  ? `+${line.looseQuantity}L`
                                  : ''}
                                {pFields.showBonusQuantity && line.bonusQuantity > 0
                                  ? ` +${line.bonusQuantity}B`
                                  : ''}
                                {pFields.showPurchaseRate
                                  ? ` × ${formatPKR(line.tradePrice)}`
                                  : ''}
                              </span>
                              {pFields.showNetAmount && (
                                <span className="font-bold">
                                  {formatPKR(line.valueWithAllTaxes)}
                                </span>
                              )}
                            </div>
                            {(pFields.showDiscount || pFields.showTax) &&
                              (line.discountAmount > 0 ||
                                line.salesTaxAmount > 0 ||
                                line.advanceTaxAmount > 0) && (
                                <div className="text-[8px] font-mono flex justify-between">
                                  <span>
                                    {pFields.showDiscount && line.discountAmount > 0
                                      ? `Disc:${formatPKR(line.discountAmount)}`
                                      : ''}
                                  </span>
                                  <span>
                                    {pFields.showTax &&
                                    (line.salesTaxAmount > 0 || line.advanceTaxAmount > 0)
                                      ? `Tax:${formatPKR(
                                          line.salesTaxAmount + line.advanceTaxAmount
                                        )}`
                                      : ''}
                                  </span>
                                </div>
                              )}
                          </div>
                        ))}
                        <div className="flex justify-between font-mono font-bold text-[9px] pt-0.5">
                          <span>Co. Total{pFields.showQuantity ? ` (Q:${group.totalQuantity})` : ''}</span>
                          {pFields.showNetAmount && (
                            <span>Rs. {formatPKR(group.totalValueWithAllTaxes)}</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="space-y-1 border-b border-black pb-1.5">
                      {purchasePrintData.flatItems.map((line) => (
                        <div
                          key={line.raw.id || `flat-${line.sNo}`}
                          className="border-b border-dotted border-black/60 pb-1 last:border-b-0"
                        >
                          {(pFields.showItemName ||
                            pFields.showItemCode ||
                            pFields.showPacking ||
                            pFields.showCompanyName) && (
                            <div className="font-bold break-words">
                              {line.sNo}.{' '}
                              {pFields.showItemCode && (line.variantCode || line.itemCode)
                                ? `[${line.variantCode || line.itemCode}] `
                                : ''}
                              {pFields.showItemName ? formatLineDisplayName(line) : ''}
                              {pFields.showPacking && line.packing ? ` (${line.packing})` : ''}
                            </div>
                          )}
                          {pFields.showCompanyName && (
                            <div className="text-[8.5px] font-semibold">{line.companyName}</div>
                          )}
                          {(pFields.showBatchNumber || pFields.showExpiryDate) && (
                            <div className="text-[8.5px] font-mono">
                              {pFields.showBatchNumber ? `B:${line.batchNumber}` : ''}
                              {pFields.showBatchNumber && pFields.showExpiryDate ? ' | ' : ''}
                              {pFields.showExpiryDate ? `Exp:${line.expiryDate}` : ''}
                            </div>
                          )}
                          <div className="flex justify-between font-mono text-[9px]">
                            <span>
                              {pFields.showQuantity ? `Q:${line.quantity}` : ''}
                              {pFields.showLooseQuantity && line.looseQuantity > 0
                                ? `+${line.looseQuantity}L`
                                : ''}
                              {pFields.showBonusQuantity && line.bonusQuantity > 0
                                ? ` +${line.bonusQuantity}B`
                                : ''}
                              {pFields.showPurchaseRate
                                ? ` × ${formatPKR(line.tradePrice)}`
                                : ''}
                            </span>
                            {pFields.showNetAmount && (
                              <span className="font-bold">
                                {formatPKR(line.valueWithAllTaxes)}
                              </span>
                            )}
                          </div>
                          {(pFields.showDiscount || pFields.showTax) &&
                            (line.discountAmount > 0 ||
                              line.salesTaxAmount > 0 ||
                              line.advanceTaxAmount > 0) && (
                              <div className="text-[8px] font-mono flex justify-between">
                                <span>
                                  {pFields.showDiscount && line.discountAmount > 0
                                    ? `Disc:${formatPKR(line.discountAmount)}`
                                    : ''}
                                </span>
                                <span>
                                  {pFields.showTax &&
                                  (line.salesTaxAmount > 0 || line.advanceTaxAmount > 0)
                                    ? `Tax:${formatPKR(
                                        line.salesTaxAmount + line.advanceTaxAmount
                                      )}`
                                    : ''}
                                </span>
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Thermal Totals & Balances */}
                <div className="space-y-0.5 font-mono text-[9.5px]">
                  {(pFields.showTotalQuantity || pFields.showBonusQuantity) && (
                    <div className="flex justify-between">
                      <span>
                        {pFields.showTotalQuantity
                          ? `Total Qty: ${purchasePrintData.summary.totalQuantity}${
                              pFields.showLooseQuantity &&
                              purchasePrintData.summary.totalLooseQuantity > 0
                                ? ` (+${purchasePrintData.summary.totalLooseQuantity}L)`
                                : ''
                            }`
                          : ''}
                      </span>
                      <span>
                        {pFields.showBonusQuantity
                          ? `Bonus: ${purchasePrintData.summary.totalBonus}`
                          : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Gross:</span>
                    <span>{formatPKR(purchasePrintData.summary.grossAmount)}</span>
                  </div>
                  {pFields.showDiscount && (
                    <div className="flex justify-between">
                      <span>Discount:</span>
                      <span>-{formatPKR(purchasePrintData.summary.totalDiscount)}</span>
                    </div>
                  )}
                  {pFields.showTax && (
                    <>
                      <div className="flex justify-between">
                        <span>Sales Tax:</span>
                        <span>+{formatPKR(purchasePrintData.summary.totalSalesTax)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Adv Tax ({Number(doc.advance_tax_rate || 0).toFixed(1)}%):</span>
                        <span>+{formatPKR(purchasePrintData.summary.totalAdvanceTax)}</span>
                      </div>
                    </>
                  )}
                  {pFields.showNetAmount && (
                    <div className="flex justify-between font-black text-[11px] border-t border-b border-black py-1 my-0.5">
                      <span>NET TOTAL:</span>
                      <span>Rs. {formatPKR(purchasePrintData.summary.grandTotal)}</span>
                    </div>
                  )}
                  {pFields.showPreviousBalance && (
                    <>
                      <div className="flex justify-between">
                        <span>Prev Bal ({doc.previous_balance_type}):</span>
                        <span>{formatPKR(doc.previous_supplier_balance)}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Total Payable:</span>
                        <span>{formatPKR(doc.total_payable)}</span>
                      </div>
                    </>
                  )}
                  {pFields.showPaidAmount && (
                    <div className="flex justify-between">
                      <span>Paid ({doc.payment_mode}):</span>
                      <span>-{formatPKR(doc.paid_amount)}</span>
                    </div>
                  )}
                  {pFields.showRemainingBalance && (
                    <div className="flex justify-between font-black border-t border-dashed border-black pt-0.5">
                      <span>Remaining Bal:</span>
                      <span>Rs. {formatPKR(doc.remaining_balance)}</span>
                    </div>
                  )}
                </div>

                {pFields.showRemarks && doc.remarks && (
                  <div className="border-t border-dashed border-black pt-1 text-[8.5px]">
                    <strong>Remarks:</strong> {doc.remarks}
                  </div>
                )}

                {pFields.showSignature && (
                  <div className="border-t border-dashed border-black pt-3 flex justify-between text-[8.5px] font-semibold">
                    <span>Prepared By</span>
                    <span>Authorized Sign</span>
                  </div>
                )}
              </div>
            ) : (
            <div
              ref={printAreaRef}
              className={`bg-white border border-slate-400 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${
                activeOrientation === 'landscape'
                  ? 'w-[297mm] max-w-[297mm] min-h-[210mm]'
                  : 'w-[210mm] max-w-[210mm] min-h-[297mm]'
              } p-6 lg:p-7 text-slate-900 ${fontScaleClass} space-y-5 relative print:border-0 print:shadow-none print:p-2 print:w-full print:max-w-none print:min-h-0`}
            >
              {/* Multi-Page Visual Page Break Markers (Screen Preview Only) */}
              {zoomState.totalPages > 1 &&
                Array.from({ length: zoomState.totalPages - 1 }).map((_, pIdx) => (
                  <div
                    key={pIdx}
                    style={{
                      top: `${(pIdx + 1) * (activeOrientation === 'landscape' ? 210 : 297)}mm`,
                    }}
                    className="pointer-events-none select-none absolute left-0 right-0 border-t-2 border-dashed border-sky-500/70 z-20 flex justify-end pr-2 print:hidden"
                  >
                    <span className="bg-sky-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded-b shadow-xs">
                      Page {pIdx + 1} Break → Page {pIdx + 2}
                    </span>
                  </div>
                ))}
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
            <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3.5">
              <div className="flex items-start gap-3">
                {(mode === 'invoice' ? pFields.showLogo : fields.showLogo) && logoDataUrl ? (
                  <img
                    src={logoDataUrl}
                    alt={storeName}
                    className="w-14 h-14 object-contain rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                  />
                ) : (mode === 'invoice' ? pFields.showLogo : fields.showLogo) ? (
                  <div className="w-11 h-11 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-base tracking-wider shrink-0">
                    AMS
                  </div>
                ) : null}
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase leading-tight">
                    {storeName}
                  </h1>
                  <p className="text-xs text-slate-600 font-medium">{storeAddress}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Phone: {storePhone}
                    {(mode === 'invoice' ? pFields.showDrugLicense : fields.showDrugLicense) &&
                    drugLicense
                      ? ` | Drug License: ${drugLicense}`
                      : ''}
                    {(mode === 'invoice' ? pFields.showNtn : fields.showNtn) && ntnNumber
                      ? ` | NTN: ${ntnNumber}`
                      : ''}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="inline-block px-3 py-1 rounded bg-slate-900 text-white text-xs font-black uppercase tracking-wider">
                  {mode === 'invoice' ? 'PURCHASE INVOICE' : 'PURCHASE RETURN / DEBIT NOTE'}
                </div>
                <div className="mt-2 space-y-0.5 text-xs">
                  {(mode !== 'invoice' || pFields.showInvoiceNumber) && (
                    <div>
                      <span className="text-slate-500 font-medium">
                        {mode === 'invoice' ? 'Invoice Number:' : 'Debit Note No:'}
                      </span>{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {mode === 'invoice' ? doc.bill_number : doc.debit_note_number}
                      </span>
                    </div>
                  )}
                  {(mode !== 'invoice' || pFields.showInvoiceDate) && (
                    <div>
                      <span className="text-slate-500 font-medium">Invoice Date:</span>{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {formatAppDate(mode === 'invoice' ? doc.bill_date : doc.return_date)}
                      </span>
                    </div>
                  )}
                  {mode === 'invoice' ? (
                    pFields.showInvoiceNumber && supplierInvoiceNo ? (
                      <div>
                        <span className="text-slate-500 font-medium">Supplier Invoice No:</span>{' '}
                        <span className="font-mono font-bold text-slate-900">
                          {supplierInvoiceNo}
                        </span>
                      </div>
                    ) : null
                  ) : (
                    <div>
                      <span className="text-slate-500 font-medium">Ref Purchase Bill:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">
                        {doc.original_bill_number}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Supplier Details & Tax Classification */}
            <div
              className={`grid ${
                mode === 'invoice' && !pFields.showSupplierName ? 'grid-cols-1' : 'grid-cols-2'
              } gap-4 bg-slate-50 p-3 rounded-lg border border-slate-300 text-xs`}
            >
              {(mode !== 'invoice' || pFields.showSupplierName) && (
                <div className="space-y-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    <span>Supplier Name & Details</span>
                  </div>
                  <div className="font-bold text-sm text-slate-900">
                    {doc.supplier_name}
                    {doc.supplier_code ? (
                      <span className="font-mono text-xs font-semibold text-slate-600 ml-1.5">
                        ({doc.supplier_code})
                      </span>
                    ) : null}
                  </div>
                  {doc.supplier_address && (
                    <div className="text-slate-600">{doc.supplier_address}</div>
                  )}
                  <div className="text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    <span>Phone: {doc.supplier_phone || 'N/A'}</span>
                    <span>NTN: {doc.supplier_ntn || 'N/A'}</span>
                    <span>STRN: {doc.supplier_strn || 'N/A'}</span>
                  </div>
                </div>
              )}

              <div
                className={`space-y-1 ${
                  mode === 'invoice' && !pFields.showSupplierName
                    ? ''
                    : 'border-l border-slate-300 pl-4'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {mode === 'invoice' ? 'Invoice & Tax Summary' : 'Tax & Settlement Classification'}
                </div>
                {mode === 'invoice' &&
                  purchasePrintData &&
                  (pFields.showTotalItems || pFields.showCompanyName) && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">
                        {pFields.showCompanyName && pFields.showTotalItems
                          ? 'Companies / Line Items:'
                          : pFields.showCompanyName
                          ? 'Companies:'
                          : 'Total Items:'}
                      </span>
                      <span className="font-mono font-bold text-slate-900">
                        {pFields.showCompanyName
                          ? `${purchasePrintData.companyCount} ${
                              purchasePrintData.companyCount === 1 ? 'Company' : 'Companies'
                            }`
                          : ''}
                        {pFields.showCompanyName && pFields.showTotalItems ? ' · ' : ''}
                        {pFields.showTotalItems
                          ? `${purchasePrintData.totalItemsCount} ${
                              purchasePrintData.totalItemsCount === 1 ? 'Item' : 'Items'
                            }`
                          : ''}
                      </span>
                    </div>
                  )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Supplier Tax Status:</span>
                  <span className="font-bold text-slate-900">
                    {doc.supplier_filer_status || 'Filer'}
                  </span>
                </div>
                {(mode !== 'invoice' || pFields.showTax) && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance Tax Rate Applied:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {Number(doc.advance_tax_rate || 0).toFixed(2)}%
                      {doc.is_tax_overridden ? ' (Override)' : ''}
                    </span>
                  </div>
                )}
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
            {mode === 'invoice' && purchasePrintData ? (
              <div className="border border-slate-400 rounded-md overflow-hidden">
                <table
                  className={`w-full table-fixed border-collapse ${invoiceTableFontClass} leading-tight`}
                >
                  <colgroup>
                    {a4Columns.map((col) => (
                      <col key={col.key} style={{ width: col.widthPercent }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-900 text-white border-b border-slate-900">
                      {a4Columns.map((col, idx) => (
                        <th
                          key={col.key}
                          className={`py-1.5 ${
                            col.key === 'item' || col.key === 'company' ? 'px-1.5' : 'px-1'
                          } font-bold ${
                            col.align === 'center'
                              ? 'text-center'
                              : col.align === 'right'
                              ? 'text-right'
                              : 'text-left'
                          } ${idx < a4Columns.length - 1 ? 'border-r border-slate-700' : ''}`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {purchasePrintData.flatItems.length === 0 ? (
                    <tbody>
                      <tr>
                        <td
                          colSpan={a4Columns.length}
                          className="py-6 text-center text-slate-500 font-medium"
                        >
                          No purchase line items found on this invoice.
                        </td>
                      </tr>
                    </tbody>
                  ) : purchasePrintData.isGrouped ? (
                    purchasePrintData.groups.map((group) => (
                      <tbody key={group.companyKey} className="ams-company-group">
                        {/* Company Group Heading */}
                        <tr className="ams-keep-with-next bg-slate-200/90 border-t-2 border-b border-slate-400">
                          <td colSpan={a4Columns.length} className="py-1.5 px-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-black text-slate-900 uppercase tracking-wide text-[10.5px]">
                                COMPANY: {group.companyName}
                              </div>
                              {pFields.showTotalItems && (
                                <div className="font-mono text-[9.5px] font-semibold text-slate-700">
                                  {group.items.length}{' '}
                                  {group.items.length === 1 ? 'Item' : 'Items'}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Company Items */}
                        {group.items.map((line, itemIdx) =>
                          renderA4LineRow(
                            line,
                            String(line.raw.id || `${group.companyKey}-${line.sNo}`),
                            itemIdx === group.items.length - 1
                          )
                        )}

                        {/* Individual Company Footer (Printed Strictly After This Company's Final Item) */}
                        {renderA4CompanyFooterRow(group)}
                      </tbody>
                    ))
                  ) : (
                    <tbody>
                      {purchasePrintData.flatItems.map((line) =>
                        renderA4LineRow(line, String(line.raw.id || `flat-${line.sNo}`), false)
                      )}
                    </tbody>
                  )}
                </table>
              </div>
            ) : (
              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-left">
                      <th className="py-2 px-2 font-semibold w-8">#</th>
                      {fields.showItemCode && (
                        <th className="py-2 px-2 font-semibold">Item Code</th>
                      )}
                      <th className="py-2 px-2 font-semibold">Item Name</th>
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
                      {fields.showPacking && (
                        <th className="py-2 px-2 font-semibold">Packing</th>
                      )}
                      {fields.showBatchExpiry && (
                        <th className="py-2 px-2 font-semibold">Batch/Expiry</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {items.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-mono text-slate-500">{idx + 1}</td>
                        {fields.showItemCode && (
                          <td className="py-1.5 px-2 font-mono font-semibold text-slate-800">
                            {item.item_code}
                          </td>
                        )}
                        <td className="py-1.5 px-2 break-words">
                          <div className="font-bold text-slate-900 break-words">
                            {formatItemNameWithRemarks(
                              item.variant_name && !String(item.item_name || '').includes(item.variant_name)
                                ? `${item.item_name} — ${item.variant_name}`
                                : item.item_name,
                              item.remarks
                            )}
                          </div>
                          {fields.showCompany && (
                            <div className="text-[10px] text-slate-500">{item.company_name}</div>
                          )}
                        </td>
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
                        {fields.showPacking && (
                          <td className="py-1.5 px-2 text-slate-700">{item.packing}</td>
                        )}
                        {fields.showBatchExpiry && (
                          <td className="py-1.5 px-2">
                            <div className="font-mono font-bold text-slate-800">
                              {item.batch_number}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {item.manufacturing_date ? `Mfg: ${formatAppDate(item.manufacturing_date)} | ` : ''}
                              Exp: {formatAppDate(item.expiry_date)}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. Final Invoice Summary & Financial Breakdown */}
            <div className="grid grid-cols-12 gap-5 items-start ams-avoid-break">
              {/* Left: Notes & Double-Entry Accounting Proof */}
              <div className="col-span-5 space-y-3">
                {(mode !== 'invoice' || pFields.showRemarks) && (doc.remarks || doc.return_reason) && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-300 text-xs">
                    <div className="font-bold text-slate-700 mb-0.5">
                      {mode === 'invoice' ? 'Invoice Remarks:' : 'Return Reason:'}
                    </div>
                    <div className="text-slate-600">
                      {mode === 'invoice' ? doc.remarks : doc.return_reason}
                    </div>
                  </div>
                )}

                {doc.is_tax_overridden === 1 && (mode !== 'invoice' || pFields.showTax) && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-900">
                    <div className="font-bold">Advance Tax Override Applied:</div>
                    <div>
                      Reason: {doc.tax_override_reason} | Authorized By:{' '}
                      {doc.tax_override_authorized_by}
                    </div>
                  </div>
                )}

                {(mode === 'invoice'
                  ? pFields.showAccountingVerification
                  : fields.showAccountingVerification) &&
                  journalLines.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-300 text-[10px]">
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

              {/* Right: Final Invoice Summary Box */}
              <div className="col-span-7 bg-slate-50 p-4 rounded-lg border-2 border-slate-800 space-y-1.5 text-xs">
                {mode === 'invoice' && purchasePrintData ? (
                  <>
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-1">
                      {pFields.showCompanyName
                        ? 'Final Invoice Summary (All Companies Combined)'
                        : 'Final Invoice Summary'}
                    </div>
                    {(pFields.showTotalQuantity ||
                      pFields.showBonusQuantity ||
                      pFields.showTotalItems) && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pb-1.5 border-b border-slate-300">
                        {pFields.showTotalQuantity && (
                          <div className="flex justify-between text-slate-700">
                            <span className="font-medium">Total Quantity:</span>
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {purchasePrintData.summary.totalQuantity}
                              {pFields.showLooseQuantity &&
                              purchasePrintData.summary.totalLooseQuantity > 0
                                ? ` (+${purchasePrintData.summary.totalLooseQuantity} L)`
                                : ''}
                            </span>
                          </div>
                        )}
                        {pFields.showBonusQuantity && (
                          <div className="flex justify-between text-slate-700">
                            <span className="font-medium">Total Bonus:</span>
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {purchasePrintData.summary.totalBonus}
                            </span>
                          </div>
                        )}
                        {pFields.showTotalItems && (
                          <div className="flex justify-between text-slate-700">
                            <span className="font-medium">Total Items:</span>
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {purchasePrintData.totalItemsCount}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex justify-between text-slate-700">
                      <span>Gross Amount:</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        Rs. {formatPKR(purchasePrintData.summary.grossAmount)}
                      </span>
                    </div>
                    {pFields.showDiscount && (
                      <div className="flex justify-between text-slate-700">
                        <span>
                          Total Discount
                          {purchasePrintData.summary.invoiceDiscountAmount > 0
                            ? ` (Item ${formatPKR(
                                purchasePrintData.summary.itemDiscountAmount
                              )} + Inv ${formatPKR(
                                purchasePrintData.summary.invoiceDiscountAmount
                              )})`
                            : ''}
                          :
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          - Rs. {formatPKR(purchasePrintData.summary.totalDiscount)}
                        </span>
                      </div>
                    )}
                    {pFields.showTax && (
                      <>
                        <div className="flex justify-between text-slate-700">
                          <span>Total Sales Tax:</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            + Rs. {formatPKR(purchasePrintData.summary.totalSalesTax)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-700">
                          <span>
                            Total Advance Tax ({Number(doc.advance_tax_rate || 0).toFixed(2)}%):
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            + Rs. {formatPKR(purchasePrintData.summary.totalAdvanceTax)}
                          </span>
                        </div>
                      </>
                    )}
                    {pFields.showNetAmount && (
                      <div className="flex justify-between text-sm font-black text-slate-950 border-t-2 border-slate-900 pt-2 mt-1">
                        <span>Grand Total (Incl. All Taxes):</span>
                        <span className="font-mono tabular-nums">
                          Rs. {formatPKR(purchasePrintData.summary.grandTotal)}
                        </span>
                      </div>
                    )}
                    {pFields.showPreviousBalance && (
                      <>
                        <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-200">
                          <span>
                            Previous Supplier Balance ({doc.previous_balance_type}):
                          </span>
                          <span className="font-mono tabular-nums">
                            Rs. {formatPKR(doc.previous_supplier_balance)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-800 font-bold">
                          <span>Total Payable:</span>
                          <span className="font-mono tabular-nums">
                            Rs. {formatPKR(doc.total_payable)}
                          </span>
                        </div>
                      </>
                    )}
                    {pFields.showPaidAmount && (
                      <div className="flex justify-between text-emerald-700 font-bold pt-1 border-t border-slate-200">
                        <span>Paid Amount ({doc.payment_mode}):</span>
                        <span className="font-mono tabular-nums">
                          - Rs. {formatPKR(doc.paid_amount)}
                        </span>
                      </div>
                    )}
                    {pFields.showRemainingBalance && (
                      <div className="flex justify-between text-slate-900 font-black border-t border-slate-300 pt-1">
                        <span>Remaining Payable Balance:</span>
                        <span className="font-mono tabular-nums">
                          Rs. {formatPKR(doc.remaining_balance)}
                        </span>
                      </div>
                    )}
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
            {(mode === 'invoice' ? pFields.showSignature : fields.showSignature) && (
              <div className="pt-8 grid grid-cols-3 gap-8 text-center text-xs font-semibold text-slate-700 border-t border-slate-200 ams-avoid-break">
                <div className="pt-7 border-t border-slate-500">Prepared By</div>
                <div className="pt-7 border-t border-slate-500">Received By</div>
                <div className="pt-7 border-t border-slate-500">
                  Authorized Signature ({storeName})
                </div>
              </div>
            )}

            {mode === 'invoice' && (
              <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-200 pt-2 print:hidden">
                <span>
                  {storeName} · Purchase Invoice {doc.bill_number}
                </span>
                <span className="font-mono">
                  {activeLayoutLabel} · Automatic Page Numbers (Page X of Y) in Print / PDF
                </span>
              </div>
            )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
