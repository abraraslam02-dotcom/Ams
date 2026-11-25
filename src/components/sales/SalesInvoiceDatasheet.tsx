import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../../services/api';
import {
  findExactBarcodeOrCodeMatch,
  prepareItemIndex,
  resolveItemSelectionFields,
  searchItems,
} from '../../utils/itemSearch';
import { Item, ItemVariant } from '../../types/item';
import {
  CustomerItemHistoryResponse,
  DatasheetRow,
  DeliverymanRecord,
  FastSearchItem,
  SalesInvoiceRecord,
  SalesInvoiceType,
  SalesmanRecord,
  SalesPaymentMode,
} from '../../types/sales';
import { formatPKR, formatAppDate, getPakistanDateISO } from '../../utils/formatters';
import {
  calculateLineTax,
  calculateSequentialLineDiscount,
  clampDiscountPercent,
  formatSequentialDiscountLabel,
  resolveItemTaxConfig,
  resolveLineSequentialDiscounts,
} from '../../utils/taxCalculation';
import {
  formatItemNameWithRemarks,
  matchesSelectedCompany,
  mergeCompanyMasterOptions,
} from '../../utils/itemDisplay';
import { useAuth } from '../../context/AuthContext';
import { useResizableColumns } from '../../hooks/useResizableColumns';
import { useColumnOrder } from '../../hooks/useColumnOrder';
import { SalesPrintModal } from './SalesPrintModal';
import { SalesDsrReportModal } from './SalesDsrReportModal';
import { NumericInput } from '../common/NumericInput';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import { SimpleSyncStatusBar } from '../common/SimpleSyncStatusBar';
import { ItemListSelectionModal } from '../common/ItemListSelectionModal';
import { DuplicateItemConfirmModal } from '../common/DuplicateItemConfirmModal';
import { VariantPickerModal } from '../common/VariantPickerModal';
import { ProductThumb } from '../common/ProductThumb';
import { SalesPriceHistoryModal } from './SalesPriceHistoryModal';
import { ItemLogModal } from '../common/ItemLogModal';
import { ItemFormModal } from '../items/ItemFormModal';
import { CompactItemHistoryPopup } from '../common/CompactItemHistoryPopup';
import {
  InvoiceRecordSearchInput,
  InvoiceSearchableItem,
} from '../common/InvoiceRecordSearchInput';
import { CustomExcelExportModal } from '../common/CustomExcelExportModal';
import { SalesInvoiceExcelImportModal } from './SalesInvoiceExcelImportModal';
import { WhatsAppDocumentPayload } from '../../utils/whatsapp';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Copy,
  ClipboardPaste,
  Save,
  PauseCircle,
  PlayCircle,
  Printer,
  Download,
  Upload,
  Percent,
  Users2,
  BookOpen,
  Banknote,
  UserPlus,
  Info,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Barcode,
  X,
  History,
  Truck,
  UserCheck,
  Sparkles,
  PackageSearch,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ShoppingCart,
  FileSpreadsheet,
  Calculator,
  Zap,
  Minus,
  ClipboardList,
  Eye,
  ArrowLeft,
  MessageSquare,
} from 'lucide-react';
import { exportSalesInvoicesToExcel } from '../../utils/invoiceExcelExport';
import { InvoiceSmsModal } from '../common/InvoiceSmsModal';
import { generateSalesInvoiceSmsText } from '../../utils/invoiceSms';

const ACTIVE_DRAFT_STORAGE_KEY = 'ams_active_sales_invoice_draft_v2';

function round2(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function createEmptyRow(): DatasheetRow {
  return {
    row_id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    item_id: null,
    variant_id: null,
    variant_code: '',
    variant_name: '',
    variant_thumbnail_url: null,
    inventory_id: null,
    item_code: '',
    barcode: '',
    company_name: '',
    item_name: '',
    packing: '',
    strips_per_box: 1,
    units_per_strip: 1,
    units_per_pack: 0,
    batch_number: '',
    expiry_date: '',
    available_stock_packs: 0,
    available_stock_units: 0,
    quantity: 0,
    bonus_quantity: 0,
    unit_price: 0,
    discount_1_percent: 0,
    discount_2_percent: 0,
    net_rate: 0,
    net_loose_rate: 0,
    discount_percent: 0,
    discount_amount: 0,
    loose_quantity: 0,
    loose_rate: 0,
    total_units: 0,
    gross_amount: 0,
    taxable_amount: 0,
    tax_type: 'percentage',
    tax_value: 0,
    tax_percent: 0,
    tax_amount: 0,
    line_total: 0,
    remarks: '',
    retail_price_ref: 0,
    wholesale_price_ref: 0,
    batches: [],
    isRateManuallyEdited: false,
    isLooseRateManuallyEdited: false,
    rateSuggestionSource: 'standard_retail',
    lastCustomerSaleRate: null,
    lastCustomerDiscountPercent: null,
    lastCustomerDiscount1Percent: null,
    lastCustomerDiscount2Percent: null,
    lastCustomerSaleDate: null,
    lastCustomerInvoiceNo: null,
    lastCustomerSoldQty: null,
    previousCustomerSaleRateBeforeLast: null,
    lastPurchaseCostRate: null,
    lastPurchaseDate: null,
    lastSupplierName: null,
    weighted_avg_pack_cost: null,
    item_pprice: null,
    saved_cost_price_per_unit: null,
    saved_fifo_batches_json: null,
  };
}



export const MIN_DATASHEET_ROWS = 15;

function isSalesRowPopulated(row?: DatasheetRow): boolean {
  if (!row) return false;
  return row.item_id !== null && Number(row.item_id) > 0;
}

export function ensureMinimumRows(list: DatasheetRow[], minCount: number = MIN_DATASHEET_ROWS): DatasheetRow[] {
  const result = [...list];
  let lastPopulatedIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (isSalesRowPopulated(result[i])) {
      lastPopulatedIdx = i;
      break;
    }
  }

  // Always keep at least 10 visible rows by default, plus 1 blank entry row after the last item
  const minFloor = Math.max(MIN_DATASHEET_ROWS, minCount || MIN_DATASHEET_ROWS);
  const desiredCount = Math.max(minFloor, lastPopulatedIdx + 2);
  while (result.length < desiredCount) result.push(createEmptyRow());
  while (result.length > desiredCount && !isSalesRowPopulated(result[result.length - 1])) {
    result.pop();
  }
  return result;
}

/**
 * Pure helper for MS Access-style continuous data entry:
 * finds the next blank row after `fromRowIdx` (never overwriting existing populated rows),
 * or returns `list.length` if a new blank row needs to be appended.
 */
export function findNextBlankSalesRowIndex(list: DatasheetRow[], fromRowIdx: number): number {
  const existingEmptyIdx = list.findIndex((r, idx) => idx > fromRowIdx && !isSalesRowPopulated(r));
  return existingEmptyIdx >= 0 ? existingEmptyIdx : list.length;
}

export function isSyrupItem(
  itemOrRow:
    | {
        item_name?: string;
        category?: string;
        category_name?: string;
        packing?: string;
        units_per_pack?: number;
      }
    | null
    | undefined
): boolean {
  if (!itemOrRow) return false;
  const name = String(itemOrRow.item_name || '').toLowerCase();
  const cat = String((itemOrRow as any).category || (itemOrRow as any).category_name || '').toLowerCase();
  const pack = String(itemOrRow.packing || '').toLowerCase();

  return (
    name.includes('syrup') ||
    name.includes('syp') ||
    name.includes('susp') ||
    name.includes('suspension') ||
    name.includes('drops') ||
    name.includes('liquid') ||
    name.includes('solution') ||
    name.includes('elixir') ||
    name.includes('emulsion') ||
    name.includes('lotion') ||
    cat.includes('syrup') ||
    cat.includes('susp') ||
    cat.includes('liquid') ||
    cat.includes('drops') ||
    pack.includes('bot') ||
    pack.includes('syrup') ||
    pack.includes('ml') ||
    pack.includes('fl oz')
  );
}

function parseSignedNumeric(val: unknown): number {
  if (val === '' || val === '-' || val === '.' || val === '-.' || val === null || val === undefined) {
    return 0;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function recalcRow(row: DatasheetRow): DatasheetRow {
  const isSyrup = isSyrupItem(row);
  const unitsPerPack = Math.max(1, Number(row.units_per_pack || 1));
  const quantity = parseSignedNumeric(row.quantity);
  const bonusQuantity = Math.max(0, Number(row.bonus_quantity || 0));
  // Syrups are strictly sold/returned as complete bottles; loose units are forced to 0
  const looseQty = isSyrup ? 0 : parseSignedNumeric(row.loose_quantity);
  const unitPrice = Math.max(0, Number(row.unit_price || 0));
  const looseRate = isSyrup
    ? 0
    : !row.item_id
    ? Math.max(0, round2(Number(row.loose_rate || 0)))
    : row.isLooseRateManuallyEdited
    ? Math.max(0, round2(Number(row.loose_rate || 0)))
    : round2(unitPrice / unitsPerPack);

  // Stock units include Normal Qty + Bonus Qty (negative quantity/looseQty yields negative totalUnits for returns)
  const totalUnits = isSyrup
    ? round2((quantity + bonusQuantity) * unitsPerPack)
    : round2((quantity + bonusQuantity) * unitsPerPack + looseQty);
  // Financial calculation: Item gross amount, sequential discounts, tax, net total use signed Normal Qty & Loose Qty
  const gross = round2(quantity * unitPrice + (isSyrup ? 0 : looseQty * looseRate));
  const rawD1 =
    row.discount_1_percent === undefined &&
    row.discount_2_percent === undefined &&
    Number(row.discount_percent || 0) > 0
      ? clampDiscountPercent(row.discount_percent)
      : clampDiscountPercent(row.discount_1_percent ?? 0);
  const rawD2 =
    row.discount_1_percent === undefined && row.discount_2_percent === undefined
      ? 0
      : clampDiscountPercent(row.discount_2_percent ?? 0);
  const seq = calculateSequentialLineDiscount({
    originalRate: unitPrice,
    looseRate: isSyrup ? 0 : looseRate,
    grossAmount: gross,
    discount1Percent: rawD1,
    discount2Percent: rawD2,
  });
  const resolvedTax = resolveItemTaxConfig({
    tax_type: row.tax_type,
    tax_value: row.tax_value,
    tax_percent: row.tax_percent,
  });
  // CRITICAL TAX RULE: Tax is ALWAYS calculated on ORIGINAL gross BEFORE discounts (normal, loose, and mixed quantities)
  const taxAmt = calculateLineTax({
    grossAmount: gross,
    quantity,
    looseQuantity: isSyrup ? 0 : looseQty,
    unitsPerPack,
    taxType: resolvedTax.tax_type,
    taxValue: resolvedTax.tax_value,
    taxPercent: resolvedTax.tax_percent,
  });
  const lineTotal = round2(gross + taxAmt - seq.discount_amount);

  return {
    ...row,
    quantity,
    bonus_quantity: bonusQuantity,
    loose_quantity: looseQty,
    unit_price: unitPrice,
    loose_rate: looseRate,
    total_units: totalUnits,
    gross_amount: gross,
    discount_1_percent: seq.discount_1_percent,
    discount_2_percent: seq.discount_2_percent,
    net_rate: seq.net_rate,
    net_loose_rate: seq.net_loose_rate,
    discount_percent: seq.effective_discount_percent,
    discount_amount: seq.discount_amount,
    taxable_amount: seq.taxable_amount,
    tax_type: resolvedTax.tax_type,
    tax_value: resolvedTax.tax_value,
    tax_percent: resolvedTax.tax_percent,
    tax_amount: taxAmt,
    line_total: lineTotal,
  };
}

interface SalesInvoiceDatasheetProps {
  resumeInvoiceId?: number | null;
  onClearResume?: () => void;
  onDraftItemsStateChange?: (hasItems: boolean) => void;
  onNavigateToSalesReturn?: () => void;
  onNavigateToSalesHistory?: () => void;
  onBackToDashboard?: () => void;
}

export const SalesInvoiceDatasheet: React.FC<SalesInvoiceDatasheetProps> = ({
  resumeInvoiceId,
  onClearResume,
  onDraftItemsStateChange,
  onNavigateToSalesHistory,
  onBackToDashboard,
}) => {
  const { user } = useAuth();
  // Header State
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [editingSaleStatus, setEditingSaleStatus] = useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = useState<string>(getPakistanDateISO());
  const [invoiceNumber, setInvoiceNumber] = useState<string>(() => {
    const d = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `SI-001-${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  });
  const [customerAccountId, setCustomerAccountId] = useState<number>(0);
  const [customerSearchText, setCustomerSearchText] = useState<string>('');
  const [buyerName, setBuyerName] = useState<string>('');

  // Salesman & Deliveryman State (Strictly Separate)
  const [salesmenList, setSalesmenList] = useState<SalesmanRecord[]>([]);
  const [salesmanId, setSalesmanId] = useState<number | null>(null);
  const [salesman, setSalesman] = useState<string>('Counter Pharmacist');
  const [salesmanFilterText, setSalesmanFilterText] = useState<string>('');

  const [deliverymenList, setDeliverymenList] = useState<DeliverymanRecord[]>([]);
  const [deliverymanId, setDeliverymanId] = useState<number | null>(null);
  const [deliverymanName, setDeliverymanName] = useState<string>('');
  const [deliverymanFilterText, setDeliverymanFilterText] = useState<string>('');
  const [deliveryStatus, setDeliveryStatus] = useState<
    'Pending' | 'Assigned' | 'Out for Delivery' | 'Delivered' | 'Failed' | 'Returned'
  >('Pending');
  const [deliveryCharges, setDeliveryCharges] = useState<number>(0);
  const [deliveryNotes, setDeliveryNotes] = useState<string>('');

  const [invoiceType, setInvoiceType] = useState<SalesInvoiceType>('Retail');
  const [paymentMode, setPaymentMode] = useState<SalesPaymentMode>('Cash');
  const [paymentAccountId, setPaymentAccountId] = useState<number | null>(null);
  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ams_allow_negative_stock_sales');
      if (saved === 'false') return false;
      return true;
    } catch {
      return true;
    }
  });
  const [remarks, setRemarks] = useState<string>('');

  const handleToggleNegativeStock = useCallback((checked: boolean) => {
    setAllowNegativeStock(checked);
    try {
      localStorage.setItem('ams_allow_negative_stock_sales', checked ? 'true' : 'false');
    } catch {}
    if (checked) {
      setErrorMsg((prev) => (prev && prev.includes('Stock Shortage') ? null : prev));
    }
  }, []);

  // Datasheet Rows (Minimum 10 visible rows by default, unbounded item capacity)
  const [rows, setRows] = useState<DatasheetRow[]>(() => ensureMinimumRows([]));
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [recordJumpInput, setRecordJumpInput] = useState<string>('1');
  const [copiedRowData, setCopiedRowData] = useState<Partial<DatasheetRow> | null>(null);
  const [invoiceSearchMatchedRows, setInvoiceSearchMatchedRows] = useState<number[]>([]);
  const [invoiceSearchActiveRow, setInvoiceSearchActiveRow] = useState<number | null>(null);

  // Multi-row & multi-column selection (Excel / MS Access style)
  const [selectedRowRange, setSelectedRowRange] = useState<{ start: number; end: number } | null>(null);
  const rowSelectionAnchorRef = useRef<number | null>(null);
  const isDraggingRowsRef = useRef<boolean>(false);
  const [selectedColKeys, setSelectedColKeys] = useState<string[]>([]);
  const colSelectionAnchorRef = useRef<string | null>(null);
  const isDraggingColsRef = useRef<boolean>(false);
  const [pendingDatasheetDeleteConfirm, setPendingDatasheetDeleteConfirm] = useState<{
    kind: 'rows' | 'columns';
    rowIndices: number[];
    colKeys: string[];
    label: string;
  } | null>(null);

  useEffect(() => {
    setRecordJumpInput(String(selectedRowIndex + 1));
  }, [selectedRowIndex]);

  useEffect(() => {
    const handleMouseUpStopDrag = () => {
      isDraggingRowsRef.current = false;
      isDraggingColsRef.current = false;
    };
    window.addEventListener('mouseup', handleMouseUpStopDrag);
    return () => window.removeEventListener('mouseup', handleMouseUpStopDrag);
  }, []);

  // Customer-Wise Item History & Purchase Cost Cache (Keyed by ItemCode + CustomerId)
  const [itemHistoryMap, setItemHistoryMap] = useState<Record<string, CustomerItemHistoryResponse>>({});
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [showCompactHistoryPopup, setShowCompactHistoryPopup] = useState<boolean>(false);
  const ctrlPriceHistoryArmedRef = useRef<boolean>(false);

  // Live Customer Balance Summary (from actual ledger + Last Payment Date/Amount)
  const [liveBalanceSummary, setLiveBalanceSummary] = useState<{
    previousBalance: number;
    previousBalanceAbs: number;
    previousBalanceType: 'Debit' | 'Credit';
    lastPayment: {
      payment_date: string;
      amount: number;
      reference_no: string;
      payment_mode: string;
      source: string;
    } | null;
  } | null>(null);

  // TWO INDEPENDENT INVOICE INTERFACES: Option 1 (POS View) vs Option 2 (MS Access View)
  const [invoiceViewMode, setInvoiceViewMode] = useState<'pos' | 'access'>(() => {
    try {
      const saved = localStorage.getItem('ams_sales_invoice_view_mode');
      return saved === 'access' ? 'access' : 'pos';
    } catch {
      return 'pos';
    }
  });

  const toggleInvoiceViewMode = (mode: 'pos' | 'access') => {
    setInvoiceViewMode(mode);
    try {
      localStorage.setItem('ams_sales_invoice_view_mode', mode);
    } catch {}
  };

  // Compact grouped controls state for MS Access Sales Form (Printer Group & Excel Group)
  const [selectedPrintFormat, setSelectedPrintFormat] = useState<'a4' | '80mm' | '58mm'>('a4');
  const [selectedExcelAction, setSelectedExcelAction] = useState<
    'current' | 'custom' | 'import' | 'all'
  >('current');

  const handleRunGroupedExcelAction = () => {
    if (selectedExcelAction === 'current') {
      handleExportCurrentSaleToExcel();
    } else if (selectedExcelAction === 'custom') {
      handleOpenCustomExcelExport();
    } else if (selectedExcelAction === 'import') {
      setExcelImportOpen(true);
    } else if (selectedExcelAction === 'all') {
      handleExportAllSalesToExcel();
    }
  };

  // Bill Level Discounts & Advance Tax
  const [invoiceDiscountPercent, setInvoiceDiscountPercent] = useState<number>(0);
  const [invoiceDiscountAmount, setInvoiceDiscountAmount] = useState<number>(0);
  const [discountOverrideBy, setDiscountOverrideBy] = useState<string>('');
  const [discountOverrideReason, setDiscountOverrideReason] = useState<string>('');

  const [advanceTaxApplicable, setAdvanceTaxApplicable] = useState<boolean>(false);
  const [advanceTaxRate, setAdvanceTaxRate] = useState<number>(0);
  const [isTaxOverridden, setIsTaxOverridden] = useState<boolean>(false);
  const [taxOverrideReason, setTaxOverrideReason] = useState<string>('');
  const [taxOverrideAuthorizedBy, setTaxOverrideAuthorizedBy] = useState<string>('Store Administrator');

  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [paidAmountManuallyEdited, setPaidAmountManuallyEdited] = useState<boolean>(false);

  // Reference Data
  const [customers, setCustomers] = useState<Array<Record<string, any>>>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Array<Record<string, any>>>([]);
  const [taxSettings, setTaxSettings] = useState<Record<string, any> | null>(null);
  const [catalogItems, setCatalogItems] = useState<FastSearchItem[]>([]);
  const [companyMasterList, setCompanyMasterList] = useState<string[]>([]);
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string>('');
  const [heldInvoices, setHeldInvoices] = useState<SalesInvoiceRecord[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<SalesInvoiceRecord[]>([]);

  useEffect(() => {
    let active = true;
    api
      .getItemCompanies()
      .then((res) => {
        if (!active) return;
        if (Array.isArray(res?.companies)) {
          setCompanyMasterList(res.companies);
        }
      })
      .catch(() => {
        // Fallback derives companies from catalogItems
      });
    return () => {
      active = false;
    };
  }, []);

  const companyOptions = useMemo(
    () => mergeCompanyMasterOptions(companyMasterList, catalogItems),
    [companyMasterList, catalogItems]
  );

  const companyFilteredCatalogItems = useMemo(
    () =>
      selectedCompanyFilter
        ? catalogItems.filter((it) =>
            matchesSelectedCompany(it.company_name, selectedCompanyFilter)
          )
        : catalogItems,
    [catalogItems, selectedCompanyFilter]
  );

  // Fast Item Search Bar & Explicit Item List Picker
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<FastSearchItem[]>([]);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState<number>(0);
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [activeSearchRowIdx, setActiveSearchRowIdx] = useState<number | null>(null);
  const [editingItemCode, setEditingItemCode] = useState<{ rowIdx: number; value: string } | null>(null);
  const [editingItemName, setEditingItemName] = useState<{ rowIdx: number; value: string } | null>(null);
  const [showItemListModal, setShowItemListModal] = useState<boolean>(false);
  const [itemListTargetRowIdx, setItemListTargetRowIdx] = useState<number | null>(null);
  const [pendingDuplicatePrompt, setPendingDuplicatePrompt] = useState<{
    item: FastSearchItem;
    variant?: ItemVariant | null;
    clearRowIdx: number | null;
  } | null>(null);
  const [pendingVariantPicker, setPendingVariantPicker] = useState<{
    item: FastSearchItem;
    targetRowIdx: number | null;
    fromTopSearch?: boolean;
    focusQty?: boolean;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const posSearchInputRef = useRef<HTMLInputElement | null>(null);
  const salesSearchListRef = useRef<HTMLDivElement | null>(null);
  const salesSearchPointerRef = useRef<{ x: number; y: number } | null>(null);
  const searchHighlightIdxRef = useRef<number>(0);
  const searchResultsRef = useRef<FastSearchItem[]>([]);
  const searchRequestIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusTargetRef = useRef<string | null>(null);
  const draftRestoredRef = useRef<boolean>(false);
  const cancelledCodeEditRef = useRef<boolean>(false);
  const committedCodeEditRef = useRef<boolean>(false);
  const [priceHistoryModalState, setPriceHistoryModalState] = useState<{
    isOpen: boolean;
    rowIndex: number;
    returnFocusId: string;
  }>({
    isOpen: false,
    rowIndex: 0,
    returnFocusId: '',
  });
  const [itemLogModalState, setItemLogModalState] = useState<{
    isOpen: boolean;
    itemId: number | null;
    itemCode: string;
    itemName: string;
    returnFocusId: string;
  }>({
    isOpen: false,
    itemId: null,
    itemCode: '',
    itemName: '',
    returnFocusId: '',
  });
  const [f9ItemMasterState, setF9ItemMasterState] = useState<{
    isOpen: boolean;
    editingItem: Item | null;
    rowIndex: number;
    returnFocusId: string;
  }>({
    isOpen: false,
    editingItem: null,
    rowIndex: 0,
    returnFocusId: '',
  });

  // Shortcut Modals
  const [showAdvanceTaxModal, setShowAdvanceTaxModal] = useState<boolean>(false);
  const [activeCustomerShortcut, setActiveCustomerShortcut] = useState<
    null | 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  >(null);
  const [customerLedgerData, setCustomerLedgerData] = useState<Record<string, any> | null>(null);
  const [customerLedgerLoading, setCustomerLedgerLoading] = useState<boolean>(false);
  const [customerLedgerPeriod, setCustomerLedgerPeriod] = useState<'all' | 'last30'>('all');
  const [showCustomerLedgerChoicePopup, setShowCustomerLedgerChoicePopup] = useState<boolean>(false);
  const customerLedgerReqIdRef = useRef<number>(0);
  const [showHeldDrawer, setShowHeldDrawer] = useState<boolean>(false);
  const [showPendingDrawer, setShowPendingDrawer] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);

  // Find & Edit Existing Invoice Modal State
  const [showEditSearchModal, setShowEditSearchModal] = useState<boolean>(false);
  const [editSearchQuery, setEditSearchQuery] = useState<string>('');
  const [editSearchResults, setEditSearchResults] = useState<SalesInvoiceRecord[]>([]);
  const [editSearchLoading, setEditSearchLoading] = useState<boolean>(false);

  // Quick Receive Payment Form inside Customer Shortcut
  const [quickReceiptAmount, setQuickReceiptAmount] = useState<string>('');
  const [quickReceiptMethod, setQuickReceiptMethod] = useState<'Cash' | 'Bank Transfer'>('Cash');
  const [quickReceiptNotes, setQuickReceiptNotes] = useState<string>('');

  // Quick Add Customer Form inside Customer Shortcut
  const [newCustCode, setNewCustCode] = useState<string>('');
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustAddress, setNewCustAddress] = useState<string>('');
  const [newCustFilerStatus, setNewCustFilerStatus] = useState<'Filer' | 'Non-Filer' | 'Exempt'>('Non-Filer');

  // Printing, DSR Report & SMS State
  const [printInvoice, setPrintInvoice] = useState<SalesInvoiceRecord | null>(null);
  const [printFormat, setPrintFormat] = useState<'a4' | '80mm' | '58mm'>('a4');
  const [preferredThermalWidth, setPreferredThermalWidth] = useState<'80mm' | '58mm'>('80mm');
  const [autoExportPdfOnOpen, setAutoExportPdfOnOpen] = useState<boolean>(false);
  const [showDsrModal, setShowDsrModal] = useState<boolean>(false);
  const [showSalesSmsModal, setShowSalesSmsModal] = useState<boolean>(false);
  const [salesSmsPhone, setSalesSmsPhone] = useState<string>('');
  const [salesSmsText, setSalesSmsText] = useState<string>('');

  // Feedback Banner
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lastSavedWhatsappPayload, setLastSavedWhatsappPayload] =
    useState<WhatsAppDocumentPayload | null>(null);
  const [storeDisplayName, setStoreDisplayName] = useState<string>('ABRAR MEDICAL STORE');
  const customerEnterFocusTimestampRef = useRef<number>(0);

  const editingSaleIdRef = useRef<number | null>(null);
  const isResumingRef = useRef<boolean>(false);
  const submittingRef = useRef<boolean>(false);

  useEffect(() => {
    editingSaleIdRef.current = editingSaleId;
  }, [editingSaleId]);

  const isOnlyHeldStatus = (statusVal: unknown): boolean => {
    const norm = String(statusVal || '').trim().toLowerCase();
    return ['held', 'on_hold', 'on hold', 'hold'].includes(norm);
  };

  const isPendingStatus = (statusVal: unknown): boolean => {
    const norm = String(statusVal || '').trim().toLowerCase();
    return ['draft', 'pending'].includes(norm);
  };

  const isHeldStatus = (statusVal: unknown): boolean => {
    return isOnlyHeldStatus(statusVal) || isPendingStatus(statusVal);
  };

  // Fetch held and pending invoices directly from active database into strictly separate lists.
  const refreshHeldInvoices = useCallback(async () => {
    try {
      const res: any = await api.getSales({ status: 'held_or_draft', exportAll: true });
      const candidates = [
        res?.data,
        res?.sales,
        res?.invoices,
        res?.records,
        res?.data?.data,
        res?.data?.sales,
        res?.data?.invoices,
      ];
      const allUnposted = candidates.find(Array.isArray) || [];
      const list = allUnposted.filter((inv: any) => isOnlyHeldStatus(inv?.status));
      const pendingList = allUnposted.filter((inv: any) => isPendingStatus(inv?.status));
      setHeldInvoices((prev) => {
        if (
          prev.length === list.length &&
          prev.every(
            (item: any, idx: number) =>
              Number(item?.id) === Number(list[idx]?.id) &&
              String(item?.updated_at || '') === String(list[idx]?.updated_at || '') &&
              Number(item?.net_amount || 0) === Number(list[idx]?.net_amount || 0)
          )
        ) {
          return prev;
        }
        return list;
      });
      setPendingInvoices((prev) => {
        if (
          prev.length === pendingList.length &&
          prev.every(
            (item: any, idx: number) =>
              Number(item?.id) === Number(pendingList[idx]?.id) &&
              String(item?.updated_at || '') === String(pendingList[idx]?.updated_at || '') &&
              Number(item?.net_amount || 0) === Number(pendingList[idx]?.net_amount || 0)
          )
        ) {
          return prev;
        }
        return pendingList;
      });
    } catch (err) {
      console.error('Unable to load held/pending sales invoices:', err);
    }
  }, []);

  const openHeldDrawer = useCallback(async () => {
    setShowHeldDrawer(true);
    await refreshHeldInvoices();
  }, [refreshHeldInvoices]);

  const openPendingDrawer = useCallback(async () => {
    setShowPendingDrawer(true);
    await refreshHeldInvoices();
  }, [refreshHeldInvoices]);

  useEffect(() => {
    const onSyncDone = () => {
      refreshHeldInvoices();
    };
    window.addEventListener('ams-sync-completed', onSyncDone);
    return () => window.removeEventListener('ams-sync-completed', onSyncDone);
  }, [refreshHeldInvoices]);

  // Load initial reference data + restore draft from localStorage
  const loadReferenceData = useCallback(async () => {
    try {
      const [accountsRes, taxRes, nextNumRes, fastItemsRes, heldRes, smRes, dmRes, settingsRes] =
        await Promise.all([
          api.getAccounts({ status: 'Active' }).catch(() => ({ accounts: [], data: [] })),
          api.getAdvanceTaxSettings().catch(() => ({ settings: null })),
          api.getNextSalesNumbers(invoiceDate).catch(() => ({ nextInvoiceNumber: '' })),
          api.fastSearchSalesItems('', 20000).catch(() => ({ data: [], items: [] })),
          api.getSales({ status: 'held_or_draft', exportAll: true }).catch((err) => {
            console.error('Held invoice list request failed:', err);
            return { data: [] };
          }),
          api.getSalesmen({ status: 'Active' }).catch(() => ({ data: [] })),
          api.getDeliverymen({ status: 'Active' }).catch(() => ({ data: [] })),
          api.getCompanySettings().catch(() => null),
        ]);

      if (settingsRes?.data) {
        if (settingsRes.data.store_name) {
          setStoreDisplayName(String(settingsRes.data.store_name));
        }
        const thermalSetting =
          settingsRes.data.thermal_printer_width === '58mm' ||
          settingsRes.data.default_paper_size === '58mm'
            ? '58mm'
            : '80mm';
        setPreferredThermalWidth(thermalSetting);
        const storedNegPref = localStorage.getItem('ams_allow_negative_stock_sales');
        if (storedNegPref === null && settingsRes.data.allow_negative_stock !== undefined) {
          const dbAllowNeg = Number(settingsRes.data.allow_negative_stock) === 1;
          setAllowNegativeStock(dbAllowNeg);
        }
      }

      const allAccounts = accountsRes.accounts || accountsRes.data || [];
      const partyCusts = allAccounts.filter((a: any) =>
        ['Customer', 'Customer & Supplier'].includes(a.account_group)
      );
      const finAccs = allAccounts.filter((a: any) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );

      setCustomers(partyCusts);
      setFinancialAccounts(finAccs);
      setTaxSettings(taxRes.settings || null);
      const loadedCatalog = Array.isArray(fastItemsRes?.data)
        ? fastItemsRes.data
        : Array.isArray(fastItemsRes?.items)
        ? fastItemsRes.items
        : [];
      setCatalogItems(loadedCatalog);

      const heldCandidates = [heldRes?.data, heldRes?.sales, heldRes?.invoices, heldRes?.records, heldRes?.data?.data, heldRes?.data?.sales, heldRes?.data?.invoices];
      const heldList = heldCandidates.find(Array.isArray) || [];
      setHeldInvoices(heldList.filter((inv: any) => isOnlyHeldStatus(inv?.status)));
      setPendingInvoices(heldList.filter((inv: any) => isPendingStatus(inv?.status)));

      const activeSalesmen: SalesmanRecord[] = (smRes.data || []).map((sm: SalesmanRecord) => ({
        ...sm,
        name: sm.name || sm.full_name || '',
      }));
      const activeDeliverymen: DeliverymanRecord[] = dmRes.data || [];
      setSalesmenList(activeSalesmen);
      setDeliverymenList(activeDeliverymen);

      const defaultCash = finAccs.find((f: any) => f.account_code === 'FIN-1010') || finAccs[0];

      // Never overwrite an active/already-restored invoice or resumed invoice on background refresh
      if (
        draftRestoredRef.current ||
        isResumingRef.current ||
        editingSaleIdRef.current ||
        resumeInvoiceId
      ) {
        draftRestoredRef.current = true;
        return;
      }

      // Restore draft from localStorage if present with at least one active item and not resuming a specific DB invoice
      const savedDraftRaw = localStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
      if (savedDraftRaw) {
        try {
          const parsed = JSON.parse(savedDraftRaw);
          if (
            parsed &&
            Array.isArray(parsed.rows) &&
            parsed.rows.some((r: any) => r && r.item_id !== null && Number(r.item_id) > 0)
          ) {
            setEditingSaleId(parsed.editingSaleId || null);
            setEditingSaleStatus(parsed.editingSaleStatus || null);
            const isCompletedEdit =
              Boolean(parsed.editingSaleId) &&
              String(parsed.editingSaleStatus || '').trim().toLowerCase() === 'completed';
            setInvoiceNumber(
              isCompletedEdit
                ? parsed.invoiceNumber || nextNumRes.nextInvoiceNumber
                : nextNumRes.nextInvoiceNumber
            );
            setInvoiceDate(parsed.invoiceDate || getPakistanDateISO());
            setCustomerAccountId(Number(parsed.customerAccountId || 0));
            setBuyerName(String(parsed.buyerName || ''));
            setSalesmanId(parsed.salesmanId || (activeSalesmen[0]?.id ?? null));
            setSalesman(parsed.salesman || activeSalesmen[0]?.name || 'Counter Pharmacist');
            setDeliverymanId(parsed.deliverymanId || null);
            setDeliverymanName(parsed.deliverymanName || '');
            setDeliveryStatus(parsed.deliveryStatus || 'Pending');
            setDeliveryCharges(Number(parsed.deliveryCharges || 0));
            setDeliveryNotes(parsed.deliveryNotes || '');
            setInvoiceType(parsed.invoiceType || 'Retail');
            setPaymentMode(parsed.paymentMode || 'Cash');
            if (defaultCash && !paymentAccountId) {
              setPaymentAccountId(Number(defaultCash.id));
            }
            setInvoiceDiscountPercent(Number(parsed.invoiceDiscountPercent || 0));
            setInvoiceDiscountAmount(Number(parsed.invoiceDiscountAmount || 0));
            setAdvanceTaxApplicable(Boolean(parsed.advanceTaxApplicable));
            setAdvanceTaxRate(Number(parsed.advanceTaxRate || 0));
            setIsTaxOverridden(Boolean(parsed.isTaxOverridden));
            setTaxOverrideReason(parsed.taxOverrideReason || '');
            if (parsed.paidAmountInput !== undefined && parsed.paidAmountInput !== null) {
              setPaidAmountInput(String(parsed.paidAmountInput));
            }
            if (parsed.paidAmountManuallyEdited !== undefined) {
              setPaidAmountManuallyEdited(Boolean(parsed.paidAmountManuallyEdited));
            }
            setAllowNegativeStock(
              parsed.allowNegativeStock !== undefined ? Boolean(parsed.allowNegativeStock) : true
            );
            setRemarks(parsed.remarks || '');
            setRows(ensureMinimumRows(parsed.rows.map((r: DatasheetRow) => recalcRow(r))));
            draftRestoredRef.current = true;
            return;
          }
        } catch {
          // ignore malformed localStorage draft
        }
      }

      if (nextNumRes.nextInvoiceNumber) {
        setInvoiceNumber(nextNumRes.nextInvoiceNumber);
      }
      // Requirement 7: New Sales Invoice must start with an empty Customer field (never auto-select previous/default customer)
      if (activeSalesmen.length > 0 && !salesmanId) {
        setSalesmanId(activeSalesmen[0].id);
        setSalesman(activeSalesmen[0].name);
      }
      if (defaultCash && !paymentAccountId) {
        setPaymentAccountId(Number(defaultCash.id));
      }
      draftRestoredRef.current = true;
    } catch (err: unknown) {
      draftRestoredRef.current = true;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [resumeInvoiceId]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // Fetch live Customer Previous Balance & Last Payment whenever customerAccountId or editingSaleId changes
  const refreshCustomerBalanceSummary = useCallback(
    async (custId: number, saleIdToExclude: number | null) => {
      if (!custId || custId <= 0) {
        setLiveBalanceSummary(null);
        return;
      }
      try {
        const res = await api.getAccountBalanceSummary(custId, {
          role: 'customer',
          excludeSaleId: saleIdToExclude,
        });
        setLiveBalanceSummary({
          previousBalance: round2(res.previousBalance),
          previousBalanceAbs: round2(res.previousBalanceAbs),
          previousBalanceType: res.previousBalanceType || 'Debit',
          lastPayment: res.lastPayment || null,
        });
      } catch {
        // Fallback to account object if endpoint fails
      }
    },
    []
  );

  useEffect(() => {
    if (customerAccountId > 0) {
      refreshCustomerBalanceSummary(customerAccountId, editingSaleId);
    }
  }, [customerAccountId, editingSaleId, refreshCustomerBalanceSummary]);

  const activeCustomerIdRef = useRef<number>(customerAccountId);
  useEffect(() => {
    activeCustomerIdRef.current = customerAccountId;
  }, [customerAccountId]);

  // Fetch Customer + Item Sales History by unique ItemCode (strictly scoped to selected customer AccountID + optional variantId)
  const fetchAndApplyItemHistory = useCallback(
    async (
      rowIndex: number,
      itemId: number,
      custId: number,
      _currentInvType: SalesInvoiceType,
      applySuggestedOffers: boolean = true,
      itemCodeOverride?: string,
      variantId?: number | null
    ) => {
      const cleanItemCode = String(itemCodeOverride || '').trim();
      if (!cleanItemCode && !itemId) return;
      const vKey = Number(variantId || 0);
      const codeKey = cleanItemCode ? `${cleanItemCode.toLowerCase()}_${custId || 0}_${vKey}` : '';
      const idKey = itemId ? `${itemId}_${custId || 0}_${vKey}` : '';

      // If no customer is selected, clear any stale customer sale metadata and do not fetch other customers' history
      if (!custId || custId <= 0) {
        setRows((prev) => {
          const next = [...prev];
          const target = next[rowIndex];
          if (!target) return prev;
          if (
            target.lastCustomerSaleRate === null &&
            target.lastCustomerSaleDate === null &&
            target.lastCustomerInvoiceNo === null
          ) {
            return prev;
          }
          next[rowIndex] = {
            ...target,
            lastCustomerSaleRate: null,
            lastCustomerDiscountPercent: null,
            lastCustomerDiscount1Percent: null,
            lastCustomerDiscount2Percent: null,
            lastCustomerSaleDate: null,
            lastCustomerInvoiceNo: null,
            lastCustomerSoldQty: null,
            previousCustomerSaleRateBeforeLast: null,
          };
          return next;
        });
        if (applySuggestedOffers && itemId > 0) {
          const resCalc = await fetch('/api/enhancements/calculate-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_id: itemId,
              variant_id: variantId || null,
              quantity: invoiceViewMode === 'pos' ? 1 : 0,
              party_account_id: null,
            }),
          }).then((r) => r.json()).catch(() => null);

          if (resCalc?.success && resCalc.calculation) {
            const calc = resCalc.calculation;
            if (calc.effective_discount_percent > 0 || calc.bonus_quantity > 0) {
              setRows((prev) => {
                const next = [...prev];
                const target = next[rowIndex];
                if (
                  !target ||
                  target.item_id !== itemId ||
                  Number(target.variant_id || 0) !== vKey ||
                  target.isRateManuallyEdited
                ) {
                  return prev;
                }
                const updated = { ...target };
                if (calc.effective_discount_percent > 0) {
                  updated.discount_1_percent = clampDiscountPercent(calc.effective_discount_percent);
                }
                if (calc.bonus_quantity > 0) {
                  updated.bonus_quantity = round2(calc.bonus_quantity);
                }
                next[rowIndex] = recalcRow(updated);
                return next;
              });
            }
          }
        }
        return;
      }

      try {
        setHistoryLoading(true);
        const res: CustomerItemHistoryResponse = await api.getItemCustomerHistory(
          itemId || cleanItemCode,
          custId,
          cleanItemCode,
          { salesOnly: true, variantId: variantId || null }
        );
        // Ignore stale async response if user switched to a different customer while request was in flight
        if (activeCustomerIdRef.current !== custId) {
          return;
        }
        const resolvedCode = String(res.itemCode || res.item?.item_code || cleanItemCode || '').trim().toLowerCase();
        setItemHistoryMap((prev) => {
          const next = { ...prev };
          if (codeKey) next[codeKey] = res;
          if (resolvedCode) next[`${resolvedCode}_${custId}_${vKey}`] = res;
          if (idKey) next[idKey] = res;
          return next;
        });

        const lastSale =
          res.lastCustomerSale && Number(res.lastCustomerSale.customer_account_id) === Number(custId)
            ? res.lastCustomerSale
            : null;
        const prevBeforeLast =
          res.previousCustomerSaleBeforeLast &&
          Number(res.previousCustomerSaleBeforeLast.customer_account_id) === Number(custId)
            ? res.previousCustomerSaleBeforeLast
            : null;

        setRows((prev) => {
          const next = [...prev];
          const target = next[rowIndex];
          if (
            !target ||
            Number(target.variant_id || 0) !== vKey ||
            (cleanItemCode
              ? String(target.item_code || '').trim().toLowerCase() !== cleanItemCode.toLowerCase() &&
                target.item_id !== itemId
              : target.item_id !== itemId)
          ) {
            return prev;
          }

          const resolvedLastDisc = lastSale
            ? resolveLineSequentialDiscounts(lastSale, Number(lastSale.unit_price || 0))
            : null;
          const updatedRow: DatasheetRow = {
            ...target,
            lastCustomerSaleRate: lastSale ? round2(lastSale.unit_price) : null,
            lastCustomerDiscountPercent: lastSale ? round2(lastSale.discount_percent || 0) : null,
            lastCustomerDiscount1Percent: resolvedLastDisc ? resolvedLastDisc.discount_1_percent : null,
            lastCustomerDiscount2Percent: resolvedLastDisc ? resolvedLastDisc.discount_2_percent : null,
            lastCustomerSaleDate: lastSale ? String(lastSale.invoice_date) : null,
            lastCustomerInvoiceNo: lastSale ? String(lastSale.invoice_number) : null,
            lastCustomerSoldQty: lastSale ? Number(lastSale.quantity || 0) : null,
            previousCustomerSaleRateBeforeLast: prevBeforeLast ? round2(prevBeforeLast.unit_price) : null,
          };

          // Default Sale Price always follows Invoice Type (MRP for Retail, Wholesale Price for Wholesale)
          // and is never overwritten automatically by past customer sale rates.
          next[rowIndex] = updatedRow;
          return next;
        });

        if (applySuggestedOffers && itemId > 0) {
          // Evaluate active Trade Deals & Party Special Discounts only for newly added items (not when replacing Item Name to preserve Discount)
          const resCalc = await fetch('/api/enhancements/calculate-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_id: itemId,
              variant_id: variantId || null,
              quantity: invoiceViewMode === 'pos' ? 1 : 0,
              party_account_id: custId || null,
            }),
          }).then((r) => r.json()).catch(() => null);

          if (resCalc?.success && resCalc.calculation) {
            const calc = resCalc.calculation;
            if (calc.effective_discount_percent > 0 || calc.bonus_quantity > 0) {
              setRows((prev) => {
                const next = [...prev];
                const target = next[rowIndex];
                if (
                  !target ||
                  target.item_id !== itemId ||
                  Number(target.variant_id || 0) !== vKey ||
                  target.isRateManuallyEdited
                ) {
                  return prev;
                }
                const updated = { ...target };
                if (calc.effective_discount_percent > 0) {
                  updated.discount_1_percent = clampDiscountPercent(calc.effective_discount_percent);
                }
                if (calc.bonus_quantity > 0) {
                  updated.bonus_quantity = round2(calc.bonus_quantity);
                }
                next[rowIndex] = recalcRow(updated);
                return next;
              });
            }
          }
        }
      } catch {
        // ignore network hiccup
      } finally {
        if (activeCustomerIdRef.current === custId) {
          setHistoryLoading(false);
        }
      }
    },
    []
  );

  const evaluateOfferAndPartyDiscountForRow = useCallback(
    async (
      rowIndex: number,
      itemId: number,
      qty: number,
      custId: number,
      unitPrice?: number,
      variantId?: number | null
    ) => {
      if (!itemId || qty <= 0) return;
      const vKey = Number(variantId || 0);
      try {
        const resCalc = await fetch('/api/enhancements/calculate-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: itemId,
            variant_id: variantId || null,
            quantity: qty,
            trade_price: unitPrice,
            party_account_id: custId || null,
          }),
        }).then((r) => r.json());
        if (resCalc?.success && resCalc.calculation) {
          const calc = resCalc.calculation;
          if (calc.effective_discount_percent > 0 || calc.bonus_quantity > 0) {
            setRows((prev) => {
              const next = [...prev];
              const target = next[rowIndex];
              if (!target || target.item_id !== itemId || Number(target.variant_id || 0) !== vKey) {
                return prev;
              }
              const updated = { ...target };
              if (calc.effective_discount_percent > 0) {
                updated.discount_1_percent = clampDiscountPercent(calc.effective_discount_percent);
              }
              if (calc.bonus_quantity > 0) {
                updated.bonus_quantity = round2(calc.bonus_quantity);
              }
              next[rowIndex] = recalcRow(updated);
              return next;
            });
          }
        }
      } catch {
        // ignore
      }
    },
    []
  );

  // When Customer changes, clear stale history and refresh Customer-Wise Sales History for populated rows
  const prevCustomerIdRef = useRef<number>(customerAccountId);
  useEffect(() => {
    if (prevCustomerIdRef.current !== customerAccountId) {
      prevCustomerIdRef.current = customerAccountId;
      if (!customerAccountId || customerAccountId <= 0) {
        setHistoryLoading(false);
      }
      rows.forEach((r, idx) => {
        if (r.item_id || r.item_code) {
          fetchAndApplyItemHistory(
            idx,
            Number(r.item_id || 0),
            customerAccountId,
            invoiceType,
            false,
            r.item_code,
            r.variant_id || null
          );
        }
      });
    }
  }, [customerAccountId, rows, invoiceType, fetchAndApplyItemHistory]);

  // Refresh the currently selected row's Customer Sales History whenever selected row, item, variant, or customer changes
  const selectedRowItemId = rows[selectedRowIndex]?.item_id || 0;
  const selectedRowVariantId = rows[selectedRowIndex]?.variant_id || 0;
  const selectedRowItemCode = rows[selectedRowIndex]?.item_code || '';
  useEffect(() => {
    const active = rows[selectedRowIndex];
    if (active && (active.item_code || active.item_id)) {
      fetchAndApplyItemHistory(
        selectedRowIndex,
        Number(active.item_id || 0),
        customerAccountId,
        invoiceType,
        false,
        active.item_code,
        active.variant_id || null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowIndex, selectedRowItemId, selectedRowVariantId, selectedRowItemCode, customerAccountId]);

  // Automatically update next read-only invoice number when invoiceDate or invoiceType changes on a new or held/draft invoice
  useEffect(() => {
    const isCompletedEdit =
      Boolean(editingSaleId) &&
      String(editingSaleStatus || '').trim().toLowerCase() === 'completed';
    if (isCompletedEdit) return;
    let active = true;
    api
      .getNextSalesNumbers(invoiceDate)
      .then((res) => {
        if (active && res.nextInvoiceNumber) {
          setInvoiceNumber(res.nextInvoiceNumber);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [invoiceDate, invoiceType, editingSaleId, editingSaleStatus]);

  // Persist active invoice state to localStorage so changing menus never loses entered items
  useEffect(() => {
    const validItemCount = rows.filter((r) => r.item_id !== null).length;
    if (onDraftItemsStateChange) {
      onDraftItemsStateChange(validItemCount > 0);
    }
    if (!draftRestoredRef.current) return;
    if (validItemCount === 0 && !editingSaleId) {
      localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
      return;
    }
    const payload = {
      editingSaleId,
      editingSaleStatus,
      invoiceNumber,
      invoiceDate,
      customerAccountId,
      buyerName,
      salesmanId,
      salesman,
      deliverymanId,
      deliverymanName,
      deliveryStatus,
      deliveryCharges,
      deliveryNotes,
      invoiceType,
      paymentMode,
      invoiceDiscountPercent,
      invoiceDiscountAmount,
      advanceTaxApplicable,
      advanceTaxRate,
      isTaxOverridden,
      taxOverrideReason,
      paidAmountInput,
      paidAmountManuallyEdited,
      allowNegativeStock,
      remarks,
      rows,
    };
    localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [
    editingSaleId,
    editingSaleStatus,
    invoiceNumber,
    invoiceDate,
    customerAccountId,
    buyerName,
    salesmanId,
    salesman,
    deliverymanId,
    deliverymanName,
    deliveryStatus,
    deliveryCharges,
    deliveryNotes,
    invoiceType,
    paymentMode,
    invoiceDiscountPercent,
    invoiceDiscountAmount,
    advanceTaxApplicable,
    advanceTaxRate,
    isTaxOverridden,
    taxOverrideReason,
    paidAmountInput,
    paidAmountManuallyEdited,
    allowNegativeStock,
    remarks,
    rows,
    onDraftItemsStateChange,
  ]);

  // Load specific Held/Draft or Completed invoice when resumeInvoiceId is passed
  const handleResumeInvoice = useCallback(
    async (idToResume: number) => {
      try {
        isResumingRef.current = true;
        setErrorMsg(null);
        const res: any = await api.getSaleDetails(idToResume);
        const inv = res?.data || res?.invoice || res?.sale || res || {};
        const invId = Number(inv.id || idToResume);
        const loadedStatus = String(inv.status || 'completed').trim().toLowerCase();
        const loadedDate = String(inv.invoice_date || getPakistanDateISO());
        editingSaleIdRef.current = invId;
        localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
        setEditingSaleId(invId);
        setEditingSaleStatus(loadedStatus);
        setInvoiceDate(loadedDate);
        if (
          isHeldStatus(loadedStatus) ||
          /^(HLD|HOLD|DRF|DRAFT)-/i.test(String(inv.invoice_number || '').trim())
        ) {
          const nextNum = await api
            .getNextSalesNumbers(loadedDate)
            .catch(() => ({ nextInvoiceNumber: String(inv.invoice_number || '') }));
          setInvoiceNumber(nextNum.nextInvoiceNumber || String(inv.invoice_number || ''));
        } else {
          setInvoiceNumber(String(inv.invoice_number || ''));
        }
        setCustomerAccountId(Number(inv.customer_account_id || 0));
        setCustomerSearchText('');
        setBuyerName(String(inv.buyer_name || ''));
        setSalesmanId(inv.salesman_id ? Number(inv.salesman_id) : null);
        setSalesman(String(inv.salesman || 'Counter Pharmacist'));
        setDeliverymanId(inv.deliveryman_id ? Number(inv.deliveryman_id) : null);
        setDeliverymanName(String(inv.deliveryman_name || ''));
        setDeliveryStatus((inv.delivery_status as any) || 'Pending');
        setDeliveryCharges(Number(inv.delivery_charges || 0));
        setDeliveryNotes(String(inv.delivery_notes || ''));
        setInvoiceType(inv.invoice_type || 'Retail');
        setPaymentMode(inv.payment_mode || 'Cash');
        setPaymentAccountId(inv.payment_account_id ? Number(inv.payment_account_id) : null);
        setInvoiceDiscountPercent(Number(inv.invoice_discount_percent || 0));
        setInvoiceDiscountAmount(Number(inv.invoice_discount_amount || 0));
        setAdvanceTaxApplicable(Boolean(inv.advance_tax_applicable));
        setAdvanceTaxRate(Number(inv.advance_tax_rate || 0));
        setIsTaxOverridden(Boolean(inv.is_tax_overridden));
        setTaxOverrideReason(String(inv.tax_override_reason || ''));
        const rawPaidAmt = Number(inv.paid_amount ?? 0);
        const safePaidAmt = Number.isFinite(rawPaidAmt) ? Math.max(0, rawPaidAmt) : 0;
        setPaidAmountManuallyEdited(true);
        setPaidAmountInput(String(safePaidAmt));
        setAllowNegativeStock(Boolean(inv.allow_negative_stock));
        setRemarks(String(inv.remarks || ''));

        const rawItems = Array.isArray(inv.items) && inv.items.length > 0
          ? inv.items
          : Array.isArray(res?.items) && res.items.length > 0
          ? res.items
          : Array.isArray(res?.lines)
          ? res.lines
          : [];

        if (rawItems.length > 0) {
          const loadedRows: DatasheetRow[] = rawItems.map((line: any) => {
            const catMatch = catalogItems.find((c) => Number(c.id) === Number(line.item_id || line.itemId));
            const lineVariantId = line.variant_id ? Number(line.variant_id) : null;
            const catVariant =
              lineVariantId && catMatch?.variants
                ? catMatch.variants.find((v) => Number(v.id) === lineVariantId)
                : null;
            const variantBatches = lineVariantId
              ? catVariant?.batches || []
              : catMatch?.batches || [];
            const resolvedThumb =
              catVariant?.effective_thumbnail_url ||
              catVariant?.effective_image_url ||
              line.effective_thumbnail_url ||
              line.thumbnail_url ||
              catMatch?.thumbnail_url ||
              catMatch?.image_url ||
              null;
            return recalcRow({
              row_id: `row_${line.id || Math.random().toString(36).slice(2, 6)}`,
              item_id: Number(line.item_id || line.itemId || 0),
              variant_id: lineVariantId,
              variant_code: String(line.variant_code || catVariant?.variant_code || ''),
              variant_name: String(line.variant_name || catVariant?.variant_name || ''),
              variant_thumbnail_url: resolvedThumb,
              inventory_id: line.inventory_id ? Number(line.inventory_id) : null,
              item_code: String(line.item_code || catMatch?.item_code || ''),
              barcode: String(line.barcode || catVariant?.barcode || catMatch?.barcode || ''),
              company_name: String(line.company_name || catMatch?.company_name || ''),
              item_name: String(line.item_name || catMatch?.item_name || 'Medicine Item'),
              packing: String(line.packing || catVariant?.effective_packing || catMatch?.packing || '1x1'),
              strips_per_box: catMatch?.strips_per_box || 1,
              units_per_strip:
                Number(catMatch?.tablets_per_strip || catMatch?.units_per_strip) ||
                Number(line.units_per_pack || 1),
              units_per_pack: Number(line.units_per_pack || catVariant?.units_per_pack || catMatch?.units_per_pack || 1),
              batch_number: String(
                line.batch_number ||
                  catVariant?.default_batch?.batch_number ||
                  catMatch?.default_batch?.batch_number ||
                  'B-01'
              ),
              expiry_date: String(
                line.expiry_date ||
                  catVariant?.default_batch?.expiry_date ||
                  catMatch?.default_batch?.expiry_date ||
                  '2028-12-31'
              ),
              available_stock_packs: Number(
                line.available_stock_packs ||
                  catVariant?.default_batch?.available_packs ||
                  catMatch?.total_available_packs ||
                  0
              ),
              available_stock_units: Number(
                line.available_stock_units ||
                  catVariant?.default_batch?.available_units ||
                  catMatch?.total_available_units ||
                  0
              ),
              quantity: Number(line.quantity || 0),
              bonus_quantity: Number(line.bonus_quantity || 0),
              unit_price: Number(
                line.unit_price ||
                  line.trade_price ||
                  catVariant?.effective_retail_price ||
                  catMatch?.retail_price ||
                  0
              ),
              ...resolveLineSequentialDiscounts(
                line,
                Number(
                  line.unit_price ||
                    line.trade_price ||
                    catVariant?.effective_retail_price ||
                    catMatch?.retail_price ||
                    0
                )
              ),
              discount_percent: Number(line.discount_percent || 0),
              discount_amount: Number(line.discount_amount || 0),
              loose_quantity: Number(line.loose_quantity || 0),
              loose_rate: Number(line.loose_rate || line.loose_price || 0),
              total_units: Number(line.total_units || 0),
              gross_amount: Number(line.gross_amount || 0),
              taxable_amount: Number(line.taxable_amount || 0),
              ...resolveItemTaxConfig({
                tax_type: line.tax_type ?? catVariant?.effective_tax_type ?? catMatch?.tax_type,
                tax_value: line.tax_value ?? line.tax_percent ?? catVariant?.effective_tax_value ?? catMatch?.tax_value ?? 0,
                tax_percent: line.tax_percent ?? catVariant?.effective_tax_percent ?? catMatch?.tax_percent ?? 0,
              }),
              tax_amount: Number(line.tax_amount || 0),
              line_total: Number(line.line_total || 0),
              remarks: String(line.remarks || ''),
              retail_price_ref: Number(catVariant?.effective_retail_price ?? catMatch?.retail_price ?? line.unit_price ?? 0),
              wholesale_price_ref: Number(
                catVariant?.effective_wholesale_price ?? catMatch?.wholesale_price ?? line.unit_price ?? 0
              ),
              lastPurchaseCostRate:
                (catVariant?.weighted_avg_pack_cost ??
                  catMatch?.weighted_avg_pack_cost ??
                  catVariant?.effective_purchase_price ??
                  catMatch?.purchase_price)
                  ? round2(
                      catVariant?.weighted_avg_pack_cost ??
                        catMatch?.weighted_avg_pack_cost ??
                        catVariant?.effective_purchase_price ??
                        catMatch?.purchase_price
                    )
                  : null,
              weighted_avg_pack_cost:
                (catVariant?.weighted_avg_pack_cost ?? catMatch?.weighted_avg_pack_cost ?? null) !== null &&
                Number(catVariant?.weighted_avg_pack_cost ?? catMatch?.weighted_avg_pack_cost ?? 0) > 0
                  ? Number(catVariant?.weighted_avg_pack_cost ?? catMatch?.weighted_avg_pack_cost)
                  : null,
              item_pprice:
                Number(catVariant?.effective_purchase_price ?? catMatch?.purchase_price ?? 0) > 0
                  ? Number(catVariant?.effective_purchase_price ?? catMatch?.purchase_price)
                  : null,
              saved_cost_price_per_unit:
                line.cost_price_per_unit !== undefined &&
                line.cost_price_per_unit !== null &&
                Number(line.cost_price_per_unit) > 0
                  ? Number(line.cost_price_per_unit)
                  : null,
              saved_fifo_batches_json: line.fifo_batches_json
                ? String(line.fifo_batches_json)
                : null,
              batches: variantBatches,
              isRateManuallyEdited: true,
              isLooseRateManuallyEdited: true,
              rateSuggestionSource: 'manual',
            });
          });
          setRows(ensureMinimumRows(loadedRows));
        } else {
          setRows(ensureMinimumRows([]));
        }
        setShowHeldDrawer(false);
        setShowPendingDrawer(false);
        setSuccessMsg(`Loaded Invoice ${inv.invoice_number || invId} into datasheet.`);
        if (onClearResume) onClearResume();
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        isResumingRef.current = false;
      }
    },
    [catalogItems, onClearResume]
  );

  useEffect(() => {
    if (resumeInvoiceId) {
      handleResumeInvoice(resumeInvoiceId);
    }
  }, [resumeInvoiceId, handleResumeInvoice]);

  // Enrich resumed rows with catalog metadata once catalogItems finishes loading (without altering saved rates/qty)
  useEffect(() => {
    if (!editingSaleId || catalogItems.length === 0) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (!r.item_id || (r.batches && r.batches.length > 0)) return r;
        const catMatch = catalogItems.find((c) => Number(c.id) === Number(r.item_id));
        if (!catMatch) return r;
        const catVariant =
          r.variant_id && catMatch.variants
            ? catMatch.variants.find((v) => Number(v.id) === Number(r.variant_id))
            : null;
        const variantBatches = r.variant_id ? catVariant?.batches || [] : catMatch.batches || [];
        changed = true;
        return {
          ...r,
          barcode: r.barcode || catVariant?.barcode || catMatch.barcode || '',
          variant_code: r.variant_code || catVariant?.variant_code || '',
          variant_name: r.variant_name || catVariant?.variant_name || '',
          variant_thumbnail_url:
            r.variant_thumbnail_url ||
            catVariant?.effective_thumbnail_url ||
            catVariant?.effective_image_url ||
            catMatch.thumbnail_url ||
            catMatch.image_url ||
            null,
          strips_per_box: catMatch.strips_per_box || r.strips_per_box,
          units_per_strip:
            Number(catMatch.tablets_per_strip || catMatch.units_per_strip) || r.units_per_strip,
          available_stock_packs:
            r.available_stock_packs ||
            Number(catVariant?.default_batch?.available_packs ?? catMatch.total_available_packs ?? 0),
          available_stock_units:
            r.available_stock_units ||
            Number(catVariant?.default_batch?.available_units ?? catMatch.total_available_units ?? 0),
          retail_price_ref: Number(
            catVariant?.effective_retail_price ?? catMatch.retail_price ?? r.retail_price_ref ?? r.unit_price ?? 0
          ),
          wholesale_price_ref: Number(
            catVariant?.effective_wholesale_price ??
              catMatch.wholesale_price ??
              r.wholesale_price_ref ??
              r.unit_price ??
              0
          ),
          lastPurchaseCostRate:
            (catVariant?.weighted_avg_pack_cost ??
              catMatch.weighted_avg_pack_cost ??
              catVariant?.effective_purchase_price ??
              catMatch.purchase_price)
              ? round2(
                  catVariant?.weighted_avg_pack_cost ??
                    catMatch.weighted_avg_pack_cost ??
                    catVariant?.effective_purchase_price ??
                    catMatch.purchase_price
                )
              : r.lastPurchaseCostRate,
          weighted_avg_pack_cost:
            (catVariant?.weighted_avg_pack_cost ?? catMatch.weighted_avg_pack_cost ?? null) !== null &&
            Number(catVariant?.weighted_avg_pack_cost ?? catMatch.weighted_avg_pack_cost ?? 0) > 0
              ? Number(catVariant?.weighted_avg_pack_cost ?? catMatch.weighted_avg_pack_cost)
              : r.weighted_avg_pack_cost ?? null,
          item_pprice:
            Number(catVariant?.effective_purchase_price ?? catMatch.purchase_price ?? 0) > 0
              ? Number(catVariant?.effective_purchase_price ?? catMatch.purchase_price)
              : r.item_pprice ?? null,
          batches: variantBatches,
        };
      });
      return changed ? next : prev;
    });
  }, [catalogItems, editingSaleId]);

  // Search existing sales invoices to edit
  const handleSearchInvoicesToEdit = useCallback(async (queryStr: string) => {
    try {
      setEditSearchLoading(true);
      const res = await api.getSales({
        q: queryStr.trim(),
        pageSize: 20,
      });
      setEditSearchResults(res.data || []);
    } catch {
      setEditSearchResults([]);
    } finally {
      setEditSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showEditSearchModal) {
      handleSearchInvoicesToEdit(editSearchQuery);
    }
  }, [showEditSearchModal, handleSearchInvoicesToEdit, editSearchQuery]);

  // Selected Customer Object
  const selectedCustomer =
    customers.find((c) => Number(c.id) === Number(customerAccountId)) || customers[0] || null;
  const customerFilerStatus: 'Filer' | 'Non-Filer' | 'Exempt' =
    (selectedCustomer?.filer_status as 'Filer' | 'Non-Filer' | 'Exempt') || 'Non-Filer';

  // Configured Advance Tax Rate based on Customer Filer Status
  const configuredTaxRate =
    customerFilerStatus === 'Filer'
      ? round2(taxSettings?.filer_rate ?? 0.5)
      : customerFilerStatus === 'Non-Filer'
      ? round2(taxSettings?.non_filer_rate ?? 2.5)
      : round2(taxSettings?.exempt_rate ?? 0);

  useEffect(() => {
    if (!isTaxOverridden) {
      setAdvanceTaxRate(configuredTaxRate);
    }
  }, [configuredTaxRate, isTaxOverridden]);

  // Switch Retail / Wholesale Invoice Type for newly added items ONLY (existing rows strictly retain their prices)
  const handleInvoiceTypeChange = (newType: SalesInvoiceType) => {
    setInvoiceType(newType);
  };

  // Pre-indexed catalog (respecting selected Company Master filter) for sub-millisecond local search
  const indexedCatalog = useMemo(
    () => prepareItemIndex(companyFilteredCatalogItems),
    [companyFilteredCatalogItems]
  );

  useEffect(() => {
    searchHighlightIdxRef.current = searchHighlightIdx;
  }, [searchHighlightIdx]);

  useEffect(() => {
    searchResultsRef.current = searchResults;
  }, [searchResults]);

  const scrollSalesSearchRowIntoView = useCallback((nextIdx: number) => {
    window.requestAnimationFrame(() => {
      const container = salesSearchListRef.current;
      if (!container) return;
      const rowEl = container.querySelector(
        `[data-sales-search-idx="${nextIdx}"]`
      ) as HTMLElement | null;
      if (!rowEl) return;
      const theadEl = container.querySelector('thead') as HTMLElement | null;
      const stickyHeaderHeight = theadEl ? theadEl.offsetHeight : 0;
      const rowTop = rowEl.offsetTop;
      const rowBottom = rowTop + rowEl.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (rowTop - stickyHeaderHeight < viewTop) {
        container.scrollTop = Math.max(0, rowTop - stickyHeaderHeight);
      } else if (rowBottom > viewBottom) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
    });
  }, []);

  // Fast Item Search Handler - Instant in-memory search + race-guarded live DB query (company-filtered when active)
  const runFastSearch = useCallback(
    (query: string) => {
      const cleanQuery = String(query || '').trim();
      const results = cleanQuery
        ? searchItems(indexedCatalog, cleanQuery, 50)
        : selectedCompanyFilter
        ? companyFilteredCatalogItems.slice(0, 50)
        : [];
      setSearchResults(results);
      setSearchHighlightIdx(0);

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      if (!cleanQuery) return;

      const activeCompany = selectedCompanyFilter;
      const reqId = ++searchRequestIdRef.current;
      searchDebounceRef.current = setTimeout(() => {
        api
          .fastSearchSalesItems(cleanQuery, 50)
          .then((res) => {
            if (searchRequestIdRef.current !== reqId) return;
            const fetched: FastSearchItem[] = res?.data || res?.items || [];
            if (!Array.isArray(fetched) || fetched.length === 0) return;

            setCatalogItems((prev) => {
              const existingIds = new Set(prev.map((c) => Number(c.id)));
              const merged = [...prev];
              let changed = false;
              for (const f of fetched) {
                const fid = Number(f.id);
                if (!existingIds.has(fid)) {
                  merged.push(f);
                  existingIds.add(fid);
                  changed = true;
                }
              }
              return changed ? merged : prev;
            });

            const companyFetched = activeCompany
              ? fetched.filter((f) => matchesSelectedCompany(f.company_name, activeCompany))
              : fetched;
            const combinedMap = new Map<number, FastSearchItem>();
            for (const f of companyFetched) combinedMap.set(Number(f.id), f);
            for (const r of results) {
              if (!combinedMap.has(Number(r.id))) combinedMap.set(Number(r.id), r);
            }
            const ranked = searchItems(prepareItemIndex(Array.from(combinedMap.values())), cleanQuery, 50);
            if (searchRequestIdRef.current === reqId) {
              const prevHighlightIdx = searchHighlightIdxRef.current;
              const prevHighlightedItemId =
                prevHighlightIdx > 0 ? searchResultsRef.current[prevHighlightIdx]?.id : null;
              setSearchResults(ranked);
              if (prevHighlightedItemId) {
                const preservedIdx = ranked.findIndex(
                  (it) => Number(it.id) === Number(prevHighlightedItemId)
                );
                if (preservedIdx >= 0) {
                  setSearchHighlightIdx(preservedIdx);
                } else {
                  setSearchHighlightIdx(Math.max(0, Math.min(prevHighlightIdx, ranked.length - 1)));
                }
              } else if (prevHighlightIdx > 0 && ranked.length > 0) {
                setSearchHighlightIdx(Math.min(prevHighlightIdx, ranked.length - 1));
              } else {
                setSearchHighlightIdx(0);
              }
            }
          })
          .catch(() => {
            // Keep instant local results on offline/network hiccup
          });
      }, 90);
    },
    [indexedCatalog, selectedCompanyFilter, companyFilteredCatalogItems]
  );

  // Immediately refresh item search results ONLY when the user actually changes selectedCompanyFilter
  const runFastSearchRef = useRef(runFastSearch);
  runFastSearchRef.current = runFastSearch;
  const prevCompanyFilterRef = useRef<string>(selectedCompanyFilter);
  useEffect(() => {
    if (prevCompanyFilterRef.current === selectedCompanyFilter) return;
    prevCompanyFilterRef.current = selectedCompanyFilter;
    const activeQuery =
      activeSearchRowIdx !== null
        ? editingItemName?.rowIdx === activeSearchRowIdx
          ? editingItemName.value
          : editingItemCode?.rowIdx === activeSearchRowIdx
          ? editingItemCode.value
          : ''
        : quickSearchQuery;

    if (showSearchDropdown || activeQuery.trim().length > 0) {
      runFastSearchRef.current(activeQuery);
    } else if (selectedCompanyFilter) {
      setSearchResults(companyFilteredCatalogItems.slice(0, 50));
      setSearchHighlightIdx(0);
    } else {
      setSearchResults([]);
    }
  }, [selectedCompanyFilter]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  // Execute pending focus after React commits newly appended rows
  useEffect(() => {
    if (pendingFocusTargetRef.current) {
      const targetId = pendingFocusTargetRef.current;
      pendingFocusTargetRef.current = null;
      requestAnimationFrame(() => {
        const el = document.getElementById(targetId) as HTMLInputElement | HTMLSelectElement | null;
        if (el) {
          el.focus();
          if ('select' in el && typeof el.select === 'function') {
            el.select();
          }
          el.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  }, [rows.length, selectedRowIndex]);

  const getActiveVariants = (item?: FastSearchItem | null): ItemVariant[] => {
    if (!item || !Array.isArray(item.variants)) return [];
    return item.variants.filter((v) => String(v.status || 'Active') !== 'Inactive');
  };

  // Populate a datasheet row with a selected FastSearchItem (+ optional ItemVariant) + trigger Customer-Wise Item History lookup
  const populateRowWithItem = (
    rowIdx: number,
    item: FastSearchItem,
    focusQuantityAfter: boolean = true,
    chosenVariant?: ItemVariant | null
  ) => {
    const activeVariants = getActiveVariants(item);
    if (!chosenVariant && Number(item.has_variants || 0) === 1 && activeVariants.length > 0) {
      committedCodeEditRef.current = true;
      setShowSearchDropdown(false);
      setActiveSearchRowIdx(null);
      setEditingItemCode(null);
      setEditingItemName(null);
      setPendingVariantPicker({
        item,
        targetRowIdx: rowIdx,
        fromTopSearch: false,
        focusQty: focusQuantityAfter,
      });
      return;
    }

    const effWholesale = chosenVariant
      ? Number(chosenVariant.effective_wholesale_price || 0) ||
        Number(chosenVariant.effective_trade_price || 0) ||
        Number(chosenVariant.effective_retail_price || 0)
      : Number(item.wholesale_price || 0) || Number(item.trade_price || 0) || Number(item.retail_price || 0);
    const wholesaleRate =
      effWholesale > 0
        ? round2(effWholesale)
        : Number(item.trade_price || 0) > 0
        ? round2(item.trade_price)
        : round2(item.retail_price);
    const effRetail = round2(
      chosenVariant
        ? chosenVariant.effective_retail_price ?? chosenVariant.retail_price ?? item.retail_price
        : item.retail_price
    );
    const defaultPrice = invoiceType === 'Wholesale' ? wholesaleRate : effRetail;
    const effPacking =
      (chosenVariant?.effective_packing || chosenVariant?.packing || item.packing || '1x1').trim() || '1x1';
    const effUnitsPerPack = Math.max(
      1,
      Number(chosenVariant?.units_per_pack || item.units_per_pack || 1)
    );
    const calculatedLooseRate = round2(defaultPrice / effUnitsPerPack);
    const defaultLooseRate = calculatedLooseRate;
    const batch = chosenVariant?.default_batch || item.default_batch || {
      inventory_id: null,
      batch_number: 'B-01',
      expiry_date: '2028-12-31',
      available_packs: 0,
      available_units: 0,
    };
    const batchList = chosenVariant ? chosenVariant.batches || [] : item.batches || [];
    const effVariantId = chosenVariant ? Number(chosenVariant.id) : null;
    const effThumb = chosenVariant
      ? chosenVariant.effective_thumbnail_url ||
        chosenVariant.effective_image_url ||
        chosenVariant.thumbnail_url ||
        chosenVariant.image_url ||
        item.thumbnail_url ||
        item.image_url ||
        null
      : item.thumbnail_url || item.image_url || null;
    const effPurchasePrice = chosenVariant
      ? Number(chosenVariant.effective_purchase_price ?? item.purchase_price ?? 0)
      : Number(item.purchase_price || 0);
    const effTaxCfg = chosenVariant
      ? resolveItemTaxConfig({
          tax_type: chosenVariant.effective_tax_type ?? chosenVariant.tax_type ?? item.tax_type,
          tax_value:
            chosenVariant.effective_tax_value ??
            chosenVariant.effective_tax_percent ??
            item.tax_value ??
            item.tax_percent ??
            0,
          tax_percent: chosenVariant.effective_tax_percent ?? item.tax_percent ?? 0,
        })
      : resolveItemTaxConfig({
          tax_type: item.tax_type,
          tax_value: item.tax_value ?? item.tax_percent ?? 0,
          tax_percent: item.tax_percent ?? 0,
        });
    const effDefaultDisc = chosenVariant
      ? Number(chosenVariant.effective_discount_percent ?? item.discount_percent ?? 0)
      : Number(item.discount_percent || 0);

    const isReplacingItem = Boolean(
      rows[rowIdx]?.item_id !== null &&
        Number(rows[rowIdx]?.item_id) > 0 &&
        (rows[rowIdx]?.item_id !== item.id ||
          Number(rows[rowIdx]?.variant_id || 0) !== Number(effVariantId || 0))
    );

    setRows((prev) => {
      const updated = [...prev];
      while (updated.length <= rowIdx) {
        updated.push(createEmptyRow());
      }
      const targetRow = updated[rowIdx] || createEmptyRow();
      const hasExistingItem = targetRow.item_id !== null && Number(targetRow.item_id) > 0;
      const isSameItem =
        targetRow.item_id === item.id &&
        Number(targetRow.variant_id || 0) === Number(effVariantId || 0);
      const preserveManual = isSameItem && Boolean(targetRow.isRateManuallyEdited);
      const preserveManualLoose = isSameItem && Boolean(targetRow.isLooseRateManuallyEdited);
      const effectivePrice = preserveManual ? targetRow.unit_price : defaultPrice;
      const effectiveLoose = preserveManualLoose
        ? targetRow.loose_rate
        : round2(effectivePrice / effUnitsPerPack);

      const defaultNewQty = invoiceViewMode === 'pos' ? 1 : 0;
      const preservedQty = hasExistingItem
        ? parseSignedNumeric(targetRow.quantity)
        : parseSignedNumeric(targetRow.quantity) !== 0
        ? parseSignedNumeric(targetRow.quantity)
        : defaultNewQty;

      const preservedDiscount1 = hasExistingItem
        ? clampDiscountPercent(targetRow.discount_1_percent ?? targetRow.discount_percent ?? 0)
        : Number(targetRow.discount_1_percent ?? targetRow.discount_percent ?? 0) > 0
        ? clampDiscountPercent(targetRow.discount_1_percent ?? targetRow.discount_percent ?? 0)
        : clampDiscountPercent(effDefaultDisc);
      const preservedDiscount2 = hasExistingItem
        ? clampDiscountPercent(targetRow.discount_2_percent ?? 0)
        : clampDiscountPercent(targetRow.discount_2_percent ?? 0);

      updated[rowIdx] = recalcRow({
        ...targetRow,
        item_id: item.id,
        variant_id: effVariantId,
        variant_code: chosenVariant ? chosenVariant.variant_code : '',
        variant_name: chosenVariant ? chosenVariant.variant_name : '',
        variant_thumbnail_url: effThumb,
        inventory_id: batch.inventory_id,
        item_code: item.item_code,
        barcode: chosenVariant?.barcode || item.barcode || '',
        company_name: item.company_name || '',
        item_name: item.item_name,
        packing: effPacking,
        strips_per_box: item.strips_per_box || 1,
        units_per_strip: Number(item.tablets_per_strip || item.units_per_strip || 1),
        units_per_pack: effUnitsPerPack,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        available_stock_packs: batch.available_packs,
        available_stock_units: batch.available_units,
        quantity: preservedQty,
        bonus_quantity: isSameItem && Number(targetRow.bonus_quantity || 0) > 0 ? targetRow.bonus_quantity : 0,
        unit_price: effectivePrice,
        discount_1_percent: preservedDiscount1,
        discount_2_percent: preservedDiscount2,
        loose_quantity: isSameItem ? targetRow.loose_quantity || 0 : 0,
        loose_rate: effectiveLoose,
        tax_type: effTaxCfg.tax_type,
        tax_value: effTaxCfg.tax_value,
        tax_percent: effTaxCfg.tax_percent,
        remarks: String(targetRow.remarks || ''),
        retail_price_ref: effRetail,
        wholesale_price_ref: wholesaleRate,
        item_loose_rate_ref: defaultLooseRate,
        batches: batchList,
        isRateManuallyEdited: preserveManual,
        isLooseRateManuallyEdited: preserveManualLoose,
        rateSuggestionSource: preserveManual
          ? 'manual'
          : invoiceType === 'Wholesale'
          ? 'standard_wholesale'
          : 'standard_retail',
        lastPurchaseCostRate:
          Number(
            chosenVariant?.weighted_avg_pack_cost ??
              item.weighted_avg_pack_cost ??
              effPurchasePrice ??
              0
          ) > 0
            ? round2(
                Number(
                  chosenVariant?.weighted_avg_pack_cost ??
                    item.weighted_avg_pack_cost ??
                    effPurchasePrice ??
                    0
                )
              )
            : null,
        weighted_avg_pack_cost:
          Number(chosenVariant?.weighted_avg_pack_cost ?? item.weighted_avg_pack_cost ?? 0) > 0
            ? Number(chosenVariant?.weighted_avg_pack_cost ?? item.weighted_avg_pack_cost)
            : null,
        item_pprice: effPurchasePrice > 0 ? effPurchasePrice : null,
        saved_cost_price_per_unit: isSameItem ? targetRow.saved_cost_price_per_unit ?? null : null,
        saved_fifo_batches_json: isSameItem ? targetRow.saved_fifo_batches_json ?? null : null,
        lastCustomerSaleRate: isSameItem ? targetRow.lastCustomerSaleRate : null,
        lastCustomerDiscountPercent: isSameItem ? targetRow.lastCustomerDiscountPercent : null,
        lastCustomerDiscount1Percent: isSameItem ? targetRow.lastCustomerDiscount1Percent ?? null : null,
        lastCustomerDiscount2Percent: isSameItem ? targetRow.lastCustomerDiscount2Percent ?? null : null,
        lastCustomerSaleDate: isSameItem ? targetRow.lastCustomerSaleDate : null,
        lastCustomerInvoiceNo: isSameItem ? targetRow.lastCustomerInvoiceNo : null,
        lastCustomerSoldQty: isSameItem ? targetRow.lastCustomerSoldQty : null,
        previousCustomerSaleRateBeforeLast: isSameItem ? targetRow.previousCustomerSaleRateBeforeLast : null,
      });
      return ensureMinimumRows(updated);
    });

    committedCodeEditRef.current = true;
    setSelectedRowIndex(rowIdx);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setSearchResults([]);
    setActiveSearchRowIdx(null);
    setEditingItemCode(null);
    setEditingItemName(null);

    // Pre-fetch Customer-wise Item History silently without auto-opening the popup
    fetchAndApplyItemHistory(
      rowIdx,
      item.id,
      customerAccountId,
      invoiceType,
      !isReplacingItem,
      item.item_code,
      effVariantId
    );

    if (invoiceViewMode === 'pos') {
      // In POS mode, always keep cursor on the Barcode / Search input after adding an item for rapid scanning
      pendingFocusTargetRef.current = 'pos_item_search_input';
      window.requestAnimationFrame(() => {
        setTimeout(() => {
          const rowQtyEl = document.getElementById(`pos_row_${rowIdx}_quantity`) as HTMLInputElement | null;
          rowQtyEl?.closest('tr')?.scrollIntoView({ block: 'nearest' });
          const barcodeEl =
            posSearchInputRef.current ||
            (document.getElementById('pos_item_search_input') as HTMLInputElement | null);
          if (barcodeEl) {
            barcodeEl.focus();
            barcodeEl.select?.();
          }
        }, 35);
      });
    } else if (focusQuantityAfter) {
      const targetId = `cell_${rowIdx}_quantity`;
      pendingFocusTargetRef.current = targetId;
      window.requestAnimationFrame(() => {
        setTimeout(() => {
          const qtyEl = document.getElementById(targetId) as HTMLInputElement | null;
          if (qtyEl) {
            qtyEl.focus();
            qtyEl.select?.();
            qtyEl.closest('tr')?.scrollIntoView({ block: 'nearest' });
          }
        }, 35);
      });
    }
  };

  // Return focus to active Item Search input after cancelling Duplicate Item prompt
  const focusSalesItemSearch = () => {
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        const target =
          invoiceViewMode === 'pos'
            ? posSearchInputRef.current || searchInputRef.current
            : searchInputRef.current || posSearchInputRef.current;
        if (target) {
          target.focus();
          target.select?.();
        }
      }, 30);
    });
  };

  const handleConfirmAddDuplicateRow = () => {
    if (!pendingDuplicatePrompt) return;
    const { item, variant, clearRowIdx } = pendingDuplicatePrompt;
    setPendingDuplicatePrompt(null);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setSearchResults([]);
    setActiveSearchRowIdx(null);
    setEditingItemCode(null);
    setEditingItemName(null);

    let newIdx = -1;
    if (clearRowIdx !== null && rows[clearRowIdx] && rows[clearRowIdx].item_id === null) {
      newIdx = clearRowIdx;
    } else {
      const firstBlankIdx = rows.findIndex((r) => r.item_id === null);
      newIdx = firstBlankIdx >= 0 ? firstBlankIdx : rows.length;
    }

    populateRowWithItem(newIdx, item, true, variant || null);
  };

  const handleCancelDuplicatePrompt = () => {
    const clearIdx = pendingDuplicatePrompt?.clearRowIdx ?? null;
    setPendingDuplicatePrompt(null);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setSearchResults([]);
    setActiveSearchRowIdx(null);
    setEditingItemCode(null);
    setEditingItemName(null);

    if (clearIdx !== null && rows[clearIdx] && rows[clearIdx].item_id === null) {
      setRows((prev) => {
        const next = [...prev];
        if (next[clearIdx] && next[clearIdx].item_id === null) {
          next[clearIdx] = createEmptyRow();
        }
        return next;
      });
    }
    focusSalesItemSearch();
  };

  // Explicit Item Code validation & update: checks variant barcode/code first, then parent code/barcode
  const commitItemCodeChange = (
    rowIdx: number,
    rawDraft: string,
    moveFocusToQty: boolean = false
  ): boolean => {
    const trimmed = rawDraft.trim();
    const currentRow = rows[rowIdx];
    const existingCode = String(currentRow?.item_code || '').trim();

    setEditingItemCode((prev) => (prev?.rowIdx === rowIdx ? null : prev));

    if (trimmed === existingCode && !currentRow?.variant_id) {
      if (moveFocusToQty && currentRow?.item_id) {
        if (invoiceViewMode === 'pos') {
          focusSalesItemSearch();
        } else {
          focusCell(rowIdx, 'quantity', 'cell');
        }
      }
      return false;
    }

    if (!trimmed) {
      if (currentRow?.item_id) {
        setErrorMsg('To remove an item from the invoice, please click its Delete button.');
      }
      return false;
    }

    const exact = findExactBarcodeOrCodeMatch(companyFilteredCatalogItems, trimmed);
    const matched = exact?.item || null;
    const matchedVariant = exact?.variant || null;

    if (!matched) {
      // Async API fallback for barcodes/variant codes not yet in local catalogItems cache
      api
        .lookupBarcodeExact(trimmed)
        .then(async (res) => {
          if (res?.matched && res.item) {
            const freshSearch = await api
              .fastSearchSalesItems(res.item.item_code || trimmed, 10)
              .catch(() => null);
            const hydrated: FastSearchItem | undefined = (
              freshSearch?.data ||
              freshSearch?.items ||
              []
            ).find((it: FastSearchItem) => Number(it.id) === Number(res.item!.id));
            if (hydrated) {
              setCatalogItems((prev) =>
                prev.some((c) => Number(c.id) === Number(hydrated.id)) ? prev : [...prev, hydrated]
              );
              if (selectedCompanyFilter && !matchesSelectedCompany(hydrated.company_name, selectedCompanyFilter)) {
                setErrorMsg(
                  `Item "${hydrated.item_name}" belongs to "${hydrated.company_name || 'another company'}", not selected company "${selectedCompanyFilter}".`
                );
                return;
              }
              const resolvedVar = res.variant
                ? hydrated.variants?.find((v) => Number(v.id) === Number(res.variant!.id)) ||
                  res.variant
                : null;
              setErrorMsg(null);
              handleSelectFromTopSearch(hydrated, rowIdx, resolvedVar);
              return;
            }
          }
          setErrorMsg(
            currentRow?.item_id
              ? `Item Code "${trimmed}" not found. Existing item [${existingCode}] was preserved.`
              : selectedCompanyFilter
              ? `Item Code "${trimmed}" not found in company "${selectedCompanyFilter}".`
              : `Item Code "${trimmed}" not found in catalog.`
          );
        })
        .catch(() => {
          setErrorMsg(
            currentRow?.item_id
              ? `Item Code "${trimmed}" not found. Existing item [${existingCode}] was preserved.`
              : `Item Code "${trimmed}" not found in catalog.`
          );
        });
      return false;
    }

    setErrorMsg(null);
    if (
      currentRow?.item_id === matched.id &&
      Number(currentRow?.variant_id || 0) === Number(matchedVariant?.id || 0)
    ) {
      if (moveFocusToQty) {
        if (invoiceViewMode === 'pos') {
          focusSalesItemSearch();
        } else {
          focusCell(rowIdx, 'quantity', 'cell');
        }
      }
      return true;
    }

    if (!matchedVariant && Number(matched.has_variants || 0) === 1 && getActiveVariants(matched).length > 0) {
      committedCodeEditRef.current = true;
      setShowSearchDropdown(false);
      setPendingVariantPicker({
        item: matched,
        targetRowIdx: rowIdx,
        fromTopSearch: false,
        focusQty: moveFocusToQty,
      });
      return true;
    }

    // Prompt confirmation if selected item+variant already exists on another row in this invoice
    const existsElsewhere = rows.some(
      (r, idx) =>
        idx !== rowIdx &&
        r.item_id === matched.id &&
        Number(r.variant_id || 0) === Number(matchedVariant?.id || 0)
    );
    if (existsElsewhere) {
      committedCodeEditRef.current = true;
      setShowSearchDropdown(false);
      setPendingDuplicatePrompt({
        item: matched,
        variant: matchedVariant || null,
        clearRowIdx: currentRow?.item_id === null ? rowIdx : null,
      });
      return true;
    }

    populateRowWithItem(rowIdx, matched, moveFocusToQty, matchedVariant || null);
    return true;
  };

  const openItemListForRow = (rowIdx: number | null) => {
    setShowSearchDropdown(false);
    if (rowIdx === null) {
      setActiveSearchRowIdx(null);
    }
    setItemListTargetRowIdx(rowIdx);
    setShowItemListModal(true);
  };

  // Add item from top Quick Search / Barcode Scanner Bar or Inline Cell Search -> focus Qty immediately
  const handleSelectFromTopSearch = (
    item: FastSearchItem,
    targetRowOverride?: number,
    chosenVariant?: ItemVariant | null
  ) => {
    const activeVariants = getActiveVariants(item);
    if (!chosenVariant && Number(item.has_variants || 0) === 1 && activeVariants.length > 0) {
      committedCodeEditRef.current = true;
      setShowSearchDropdown(false);
      setQuickSearchQuery('');
      setSearchResults([]);
      setEditingItemCode(null);
      setEditingItemName(null);
      setPendingVariantPicker({
        item,
        targetRowIdx: targetRowOverride !== undefined ? targetRowOverride : activeSearchRowIdx,
        fromTopSearch: true,
        focusQty: true,
      });
      setActiveSearchRowIdx(null);
      return;
    }

    const vKey = Number(chosenVariant?.id || 0);
    const existingDuplicateIdx = rows.findIndex(
      (r) => r.item_id === item.id && Number(r.variant_id || 0) === vKey
    );
    const activeIdx =
      targetRowOverride !== undefined
        ? targetRowOverride
        : activeSearchRowIdx !== null && rows[activeSearchRowIdx]?.item_id === null
        ? activeSearchRowIdx
        : null;

    if (existingDuplicateIdx >= 0 && existingDuplicateIdx !== targetRowOverride) {
      committedCodeEditRef.current = true;
      setShowSearchDropdown(false);
      setQuickSearchQuery('');
      setSearchResults([]);
      setActiveSearchRowIdx(null);
      setEditingItemCode(null);
      setEditingItemName(null);
      setPendingDuplicatePrompt({
        item,
        variant: chosenVariant || null,
        clearRowIdx: activeIdx !== null && rows[activeIdx]?.item_id === null ? activeIdx : null,
      });
      return;
    }

    let targetIdx = -1;
    if (activeIdx !== null && rows[activeIdx]) {
      targetIdx = activeIdx;
    } else if (existingDuplicateIdx >= 0) {
      targetIdx = existingDuplicateIdx;
    } else {
      targetIdx = rows.findIndex((r) => r.item_id === null);
    }

    const rowIdxToFill = targetIdx >= 0 ? targetIdx : rows.length;
    // Always populate row and automatically focus Qty
    populateRowWithItem(rowIdxToFill, item, true, chosenVariant || null);
  };

  // Reusable Excel-Style Item Search Combobox Table (11 Required Fields in Exact Order)
  const renderSalesExcelItemCombobox = (context: 'top' | 'row', rowIdx?: number) => {
    if (!showSearchDropdown) return null;
    if (context === 'top' && activeSearchRowIdx !== null) return null;
    if (context === 'row' && activeSearchRowIdx !== rowIdx) return null;

    return (
      <div
        className={
          context === 'top'
            ? 'absolute right-0 top-full mt-1 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl w-[980px] max-w-[95vw] overflow-hidden'
            : 'absolute left-0 top-full mt-0.5 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl w-[960px] max-w-[94vw] overflow-hidden'
        }
      >
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="px-2.5 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center gap-2"
        >
          <span className="truncate">
            Matching Items ({searchResults.length})
            {selectedCompanyFilter ? ` • Company: ${selectedCompanyFilter}` : ' • Search by Name, Company, Code, Variant or Barcode'}
          </span>
          <span className="font-mono text-emerald-700 shrink-0">↑/↓ Navigate • Enter Select • Esc Close</span>
        </div>
        <div ref={salesSearchListRef} className="max-h-[340px] overflow-auto">
          {searchResults.length === 0 ? (
            <div className="p-4 text-center text-base font-bold text-slate-600">
              No Item Found
            </div>
          ) : (
            <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
              <thead className="bg-slate-200 text-slate-800 sticky top-0 z-10 border-b border-slate-300 text-[10px] font-bold uppercase">
                <tr>
                  <th className="px-2 py-1 border-r border-slate-300">Item Code</th>
                  <th className="px-2 py-1 border-r border-slate-300">Item Name</th>
                  <th className="px-2 py-1 border-r border-slate-300 text-right">SPrice</th>
                  <th className="px-2 py-1 border-r border-slate-300 text-right">Purchase Price</th>
                  <th className="px-2 py-1 border-r border-slate-300 text-right">Loose Price</th>
                  <th className="px-2 py-1 border-r border-slate-300 text-right">Stock</th>
                  <th className="px-2 py-1 border-r border-slate-300">Company</th>
                  <th className="px-2 py-1 border-r border-slate-300">Packing</th>
                  <th className="px-2 py-1 border-r border-slate-300">Batch Number</th>
                  <th className="px-2 py-1 border-r border-slate-300">Expiry Date</th>
                  <th className="px-2 py-1">Generic / Rack</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {searchResults.map((it, idx) => {
                  const isHighlighted = idx === searchHighlightIdx;
                  const salePrice =
                    invoiceType === 'Wholesale'
                      ? round2(it.wholesale_price || it.trade_price || it.retail_price)
                      : round2(it.retail_price);
                  const resolved = resolveItemSelectionFields(it, { salePrice });
                  const formattedExpiry =
                    resolved.expiryDate !== '—'
                      ? formatAppDate(resolved.expiryDate) || resolved.expiryDate
                      : '—';
                  const variantCount = Number(it.has_variants || 0) === 1 ? getActiveVariants(it).length : 0;
                  const activeRowForMatch =
                    context === 'row' && typeof rowIdx === 'number'
                      ? rows[rowIdx]
                      : rows[selectedRowIndex];
                  const isCurrentItem = Boolean(
                    activeRowForMatch?.item_id && Number(activeRowForMatch.item_id) === Number(it.id)
                  );
                  return (
                    <tr
                      key={it.id}
                      data-sales-search-idx={idx}
                      tabIndex={-1}
                      onMouseMove={(e) => {
                        const last = salesSearchPointerRef.current;
                        if (last && last.x === e.clientX && last.y === e.clientY) return;
                        salesSearchPointerRef.current = { x: e.clientX, y: e.clientY };
                        if (searchHighlightIdx !== idx) {
                          setSearchHighlightIdx(idx);
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const exact = findExactBarcodeOrCodeMatch([it], quickSearchQuery);
                        handleSelectFromTopSearch(it, rowIdx, exact?.variant || null);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
                        isHighlighted
                          ? 'bg-sky-700 text-white font-semibold'
                          : isCurrentItem
                          ? 'bg-emerald-100 text-emerald-950 font-semibold border-l-4 border-emerald-600'
                          : 'hover:bg-sky-100 text-slate-900'
                      }`}
                    >
                      <td
                        className={`px-2 py-1 border-r border-slate-200 font-mono text-[10px] font-bold ${
                          isHighlighted ? 'text-amber-200' : 'text-emerald-700'
                        }`}
                      >
                        {resolved.itemCode}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200">
                        <div className="flex items-center gap-1.5 min-w-0 max-w-[230px]">
                          <ProductThumb
                            src={it.thumbnail_url || it.image_url}
                            alt={it.item_name}
                            size="xs"
                            className="!w-5 !h-5 shrink-0"
                          />
                          <span
                            className={`font-bold truncate ${
                              isHighlighted ? 'text-white' : 'text-slate-900'
                            }`}
                          >
                            {resolved.itemName}
                          </span>
                          {variantCount > 0 && (
                            <span
                              className={`text-[9px] font-bold px-1 rounded border shrink-0 ${
                                isHighlighted
                                  ? 'bg-sky-900 text-amber-200 border-sky-400'
                                  : 'bg-amber-100 text-amber-800 border-amber-200'
                              }`}
                            >
                              {variantCount} Var
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 text-right font-mono font-black ${
                          isHighlighted ? 'text-amber-200' : 'text-emerald-800'
                        }`}
                      >
                        Rs. {resolved.sPrice.toFixed(2)}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 text-right font-mono font-semibold ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        Rs. {resolved.purchasePrice.toFixed(2)}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 text-right font-mono ${
                          isHighlighted ? 'text-sky-100' : 'text-teal-700'
                        }`}
                      >
                        Rs. {resolved.loosePrice.toFixed(2)}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 text-right font-mono font-bold ${
                          isHighlighted
                            ? resolved.stockPacks > 0
                              ? 'text-emerald-200'
                              : 'text-rose-200'
                            : resolved.stockPacks > 0
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                        }`}
                      >
                        {resolved.stockPacks}P
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 truncate max-w-[140px] ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        {resolved.company}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-600'
                        }`}
                      >
                        {resolved.packing}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 font-mono ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        {resolved.batchNumber}
                      </td>
                      <td
                        className={`px-2 py-1 border-r border-slate-200 font-mono ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-600'
                        }`}
                      >
                        {formattedExpiry}
                      </td>
                      <td
                        className={`px-2 py-1 truncate max-w-[160px] ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-500'
                        }`}
                        title={resolved.otherInfo !== '—' ? resolved.otherInfo : undefined}
                      >
                        {resolved.otherInfo}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  // Apply Customer's Last Sale Rate on demand
  const applyCustomerLastRateToRow = (rowIdx: number) => {
    setRows((prev) => {
      const next = [...prev];
      const r = next[rowIdx];
      if (!r || !r.lastCustomerSaleRate) return prev;
      const newPrice = round2(r.lastCustomerSaleRate);
      const newLoose = r.isLooseRateManuallyEdited
        ? r.loose_rate
        : round2(newPrice / Math.max(1, r.units_per_pack));
      next[rowIdx] = recalcRow({
        ...r,
        unit_price: newPrice,
        loose_rate: newLoose,
        discount_1_percent: clampDiscountPercent(
          r.lastCustomerDiscount1Percent ?? r.lastCustomerDiscountPercent ?? r.discount_1_percent
        ),
        discount_2_percent: clampDiscountPercent(r.lastCustomerDiscount2Percent ?? 0),
        isRateManuallyEdited: false,
        rateSuggestionSource: 'customer_last_sale',
      });
      return next;
    });
  };

  // Row Field Update
  const updateRowField = (rowIndex: number, field: keyof DatasheetRow, value: any) => {
    setRows((prev) => {
      const next = [...prev];
      const current = { ...next[rowIndex] };

      if (field === 'batch_number') {
        const matchedBatch = current.batches.find((b) => b.batch_number === value);
        current.saved_cost_price_per_unit = null;
        current.saved_fifo_batches_json = null;
        if (matchedBatch) {
          current.inventory_id = matchedBatch.id;
          current.batch_number = matchedBatch.batch_number;
          current.expiry_date = matchedBatch.expiry_date;
          current.available_stock_packs = matchedBatch.current_pack_qty;
          current.available_stock_units = matchedBatch.total_stock_units;
        } else {
          current.batch_number = String(value);
        }
      } else if (field === 'unit_price') {
        const newPrice = Math.max(0, Number(value || 0));
        current.unit_price = newPrice;
        // Recalculate Loose Rate accurately from selling price and packing quantity unless manually edited
        if (!current.isLooseRateManuallyEdited) {
          current.loose_rate = round2(newPrice / Math.max(1, current.units_per_pack));
        }
        current.isRateManuallyEdited = true;
        current.rateSuggestionSource = 'manual';
      } else if (field === 'loose_rate') {
        current.loose_rate = Math.max(0, Number(value || 0));
        current.isLooseRateManuallyEdited = true;
        current.isRateManuallyEdited = true;
        current.rateSuggestionSource = 'manual';
      } else if (field === 'loose_quantity') {
        current.loose_quantity = isSyrupItem(current) ? 0 : parseSignedNumeric(value);
      } else if (field === 'quantity') {
        const nextQty = parseSignedNumeric(value);
        current.quantity = nextQty;
        if (nextQty < 0) {
          current.bonus_quantity = 0;
        }
        if (current.item_id && nextQty > 0) {
          const curItemId = Number(current.item_id);
          const curVariantId = current.variant_id || null;
          const curUnitPrice = current.unit_price;
          setTimeout(() => {
            evaluateOfferAndPartyDiscountForRow(
              rowIndex,
              curItemId,
              nextQty,
              customerAccountId,
              curUnitPrice,
              curVariantId
            );
          }, 10);
        }
      } else if (field === 'bonus_quantity') {
        current.bonus_quantity = Math.max(0, Number(value || 0));
      } else if (field === 'discount_1_percent') {
        current.discount_1_percent = clampDiscountPercent(value);
      } else if (field === 'discount_2_percent') {
        current.discount_2_percent = clampDiscountPercent(value);
      } else if (field === 'discount_percent') {
        current.discount_1_percent = clampDiscountPercent(value);
      } else {
        (current as any)[field] = value;
      }

      next[rowIndex] = recalcRow(current);
      return next;
    });
  };

  // Row Actions: Insert, Delete, Copy, Paste & Record Navigation
  const handleInsertRow = () => {
    const firstEmptyIdx = rows.findIndex((r) => r.item_id === null);
    const targetIdx = firstEmptyIdx >= 0 ? firstEmptyIdx : rows.length;
    if (firstEmptyIdx < 0) {
      setRows((prev) => [...prev, createEmptyRow()]);
    }
    setSelectedRowIndex(targetIdx);
    setShowSearchDropdown(false);
    const targetCellId =
      invoiceViewMode === 'pos' ? `pos_row_${targetIdx}_quantity` : `cell_${targetIdx}_item_code`;
    pendingFocusTargetRef.current = targetCellId;
    setTimeout(() => {
      if (invoiceViewMode === 'pos') {
        const searchEl =
          posSearchInputRef.current ||
          (document.getElementById('pos_item_search_input') as HTMLInputElement | null);
        const rowEl = document.getElementById(targetCellId);
        rowEl?.closest('tr')?.scrollIntoView({ block: 'nearest' });
        if (searchEl) {
          searchEl.focus();
          searchEl.select?.();
        }
      } else {
        const el = document.getElementById(targetCellId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
          el.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      }
    }, 25);
  };

  const handleDeleteRow = (index: number) => {
    setEditingItemCode(null);
    setEditingItemName(null);
    setRows((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index);
      const next = ensureMinimumRows(filtered);
      const nextIdx = Math.max(0, Math.min(index, next.length - 1));
      setSelectedRowIndex(nextIdx);
      return next;
    });
  };

  // Clear ONLY Item Name field (keep Item Code untouched, never trigger item search)
  const clearItemNameOnly = useCallback((rowIndex: number) => {
    setEditingItemName((prev) => (prev?.rowIdx === rowIndex ? null : prev));
    setShowSearchDropdown(false);
    setActiveSearchRowIdx((prev) => (prev === rowIndex ? null : prev));
    setSearchResults([]);
    setQuickSearchQuery('');
    setRows((prev) => {
      if (!prev[rowIndex]) return prev;
      const next = [...prev];
      next[rowIndex] = {
        ...next[rowIndex],
        item_name: '',
      };
      return next;
    });
  }, []);

  const SALES_POS_COL_KEYS = [
    'item_code',
    'company',
    'item_name',
    'quantity',
    'loose_quantity',
    'unit_price',
    'loose_rate',
    'discount_1',
    'discount_2',
    'net_rate',
    'bonus_quantity',
    'gross_amount',
    'tax',
    'amount',
    'roi',
    'remarks',
  ];

  const SALES_ACCESS_COL_KEYS = [
    'item_code',
    'item_name',
    'quantity',
    'discount_1',
    'discount_2',
    'unit_price',
    'net_rate',
    'loose_quantity',
    'loose_rate',
    'bonus_quantity',
    'amount',
    'roi',
    'last_purchase_price',
    'company',
    'gross_amount',
    'remarks',
  ];

  const SALES_COL_LABELS: Record<string, string> = {
    item_code: 'Item Code',
    company: 'Company',
    item_name: 'Item Name',
    quantity: 'Full Qty',
    discount_1: 'Disc 1 (%)',
    discount_2: 'Disc 2 (%)',
    net_rate: 'Net Rate',
    loose_quantity: 'Loose Qty',
    unit_price: 'Rate',
    bonus_quantity: 'Bonus',
    loose_rate: 'Loose Rate',
    gross_amount: 'Gross Amount',
    tax: 'Tax',
    amount: 'Net Amount',
    roi: 'ROI',
    last_purchase_price: 'Last Purchase Price',
    remarks: 'Remarks',
  };

  const SALES_ACCESS_COL_META: Record<string, { label: string; cls: string }> = {
    item_code: { label: 'Item Code', cls: 'border-r border-slate-300 text-left' },
    item_name: { label: 'Item Name', cls: 'border-r border-slate-300 text-left' },
    quantity: { label: 'Qty', cls: 'border-r border-slate-300 text-right bg-emerald-100/60 text-emerald-950' },
    discount_1: { label: 'Disc 1 %', cls: 'border-r border-slate-300 text-right' },
    discount_2: { label: 'Disc 2 %', cls: 'border-r border-slate-300 text-right' },
    unit_price: { label: 'Price', cls: 'border-r border-slate-300 text-right' },
    net_rate: { label: 'Net Rate', cls: 'border-r border-slate-300 text-right bg-indigo-50/70 text-indigo-950 font-bold' },
    loose_quantity: { label: 'Loose Qty', cls: 'border-r border-slate-300 text-right bg-teal-100/60 text-teal-950' },
    loose_rate: { label: 'Loose Rate', cls: 'border-r border-slate-300 text-right bg-blue-100/60 text-blue-950' },
    bonus_quantity: { label: 'Bonus', cls: 'border-r border-slate-300 text-right bg-emerald-100/70 text-emerald-950' },
    amount: { label: 'Net Amount', cls: 'border-r border-slate-300 text-right bg-slate-300/60 font-black' },
    roi: { label: 'ROI', cls: 'border-r border-slate-300 text-right bg-emerald-100/80 text-emerald-950 font-black' },
    last_purchase_price: { label: 'Last Purchase Price', cls: 'border-r border-slate-300 text-right bg-amber-50/70 text-amber-950' },
    company: { label: 'Company', cls: 'border-r border-slate-300 text-left' },
    gross_amount: { label: 'Gross Amount', cls: 'border-r border-slate-300 text-right bg-slate-200/70' },
    remarks: { label: 'Remarks', cls: 'border-r border-slate-300 text-left' },
  };

  const {
    columnOrder: orderedSalesAccessColKeys,
    isCustomized: isSalesAccessColsCustomized,
    moveColumnsLeft: moveSalesAccessColsLeft,
    moveColumnsRight: moveSalesAccessColsRight,
    canMoveLeft: canMoveSalesAccessLeft,
    canMoveRight: canMoveSalesAccessRight,
    resetColumnOrder: resetSalesAccessColOrder,
    draggedColKey: draggedSalesAccessCol,
    dragOverColKey: dragOverSalesAccessCol,
    dragDropSide: salesAccessDropSide,
    handleColDragStart: handleSalesAccessColDragStart,
    handleColDragOver: handleSalesAccessColDragOver,
    handleColDrop: handleSalesAccessColDrop,
    handleColDragEnd: handleSalesAccessColDragEnd,
  } = useColumnOrder({
    storageKey: 'ams_sales_access_col_order_v1',
    defaultOrder: SALES_ACCESS_COL_KEYS,
    userKey: user?.id ?? user?.username ?? null,
    legacyExpand: { discount: ['discount_1', 'discount_2', 'net_rate'] },
  });

  const isRowInSelectionRange = (rIdx: number): boolean => {
    if (!selectedRowRange) return false;
    const min = Math.min(selectedRowRange.start, selectedRowRange.end);
    const max = Math.max(selectedRowRange.start, selectedRowRange.end);
    return rIdx >= min && rIdx <= max;
  };

  const getSelectedRowIndices = (fallbackRowIdx: number): number[] => {
    if (selectedRowRange) {
      const min = Math.max(0, Math.min(selectedRowRange.start, selectedRowRange.end));
      const max = Math.min(rows.length - 1, Math.max(selectedRowRange.start, selectedRowRange.end));
      const list: number[] = [];
      for (let i = min; i <= max; i++) list.push(i);
      if (list.length > 0) return list;
    }
    return [Math.max(0, Math.min(rows.length - 1, fallbackRowIdx))];
  };

  const handleRowSelectorMouseDown = (rIdx: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setSelectedColKeys([]);
    colSelectionAnchorRef.current = null;
    if (e.shiftKey) {
      const anchor = rowSelectionAnchorRef.current ?? selectedRowIndex;
      rowSelectionAnchorRef.current = anchor;
      setSelectedRowRange({ start: anchor, end: rIdx });
      setSelectedRowIndex(rIdx);
      return;
    }
    rowSelectionAnchorRef.current = rIdx;
    isDraggingRowsRef.current = true;
    setSelectedRowRange({ start: rIdx, end: rIdx });
    setSelectedRowIndex(rIdx);
  };

  const handleRowSelectorMouseEnter = (rIdx: number) => {
    if (!isDraggingRowsRef.current) return;
    const anchor = rowSelectionAnchorRef.current ?? rIdx;
    setSelectedRowRange({ start: anchor, end: rIdx });
    setSelectedRowIndex(rIdx);
  };

  const handleColHeaderMouseDown = (colKey: string, viewColKeys: string[], e: React.MouseEvent) => {
    if (e.button !== 0 || colKey === 'selector' || colKey === 'actions') return;
    setSelectedRowRange(null);
    rowSelectionAnchorRef.current = null;
    if (e.shiftKey && colSelectionAnchorRef.current) {
      const a = viewColKeys.indexOf(colSelectionAnchorRef.current);
      const b = viewColKeys.indexOf(colKey);
      if (a >= 0 && b >= 0) {
        setSelectedColKeys(viewColKeys.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    colSelectionAnchorRef.current = colKey;
    isDraggingColsRef.current = true;
    setSelectedColKeys([colKey]);
  };

  const handleColHeaderMouseEnter = (colKey: string, viewColKeys: string[]) => {
    if (!isDraggingColsRef.current || colKey === 'selector' || colKey === 'actions') return;
    const anchor = colSelectionAnchorRef.current;
    if (!anchor) return;
    const a = viewColKeys.indexOf(anchor);
    const b = viewColKeys.indexOf(colKey);
    if (a >= 0 && b >= 0) {
      setSelectedColKeys(viewColKeys.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
  };

  const requestDatasheetDeleteConfirm = (fallbackRowIdx: number = selectedRowIndex) => {
    if (selectedColKeys.length > 0) {
      const editableSet = new Set([
        'item_code',
        'item_name',
        'quantity',
        'discount_1',
        'discount_2',
        'unit_price',
        'loose_quantity',
        'loose_rate',
        'bonus_quantity',
        'remarks',
      ]);
      const clearableCols = selectedColKeys.filter((k) => editableSet.has(k));
      if (clearableCols.length === 0) {
        setErrorMsg(
          'Calculated/read-only columns cannot be deleted directly. Select editable columns or rows instead.'
        );
        return;
      }
      const names = clearableCols.map((k) => SALES_COL_LABELS[k] || k).join(', ');
      setPendingDatasheetDeleteConfirm({
        kind: 'columns',
        rowIndices: [],
        colKeys: clearableCols,
        label: `${clearableCols.length} selected column${clearableCols.length > 1 ? 's' : ''} (${names})`,
      });
      return;
    }

    const indices = getSelectedRowIndices(fallbackRowIdx);
    const label =
      indices.length > 1
        ? `${indices.length} consecutive rows (#${indices[0] + 1} – #${indices[indices.length - 1] + 1})`
        : `Row #${indices[0] + 1}`;
    setPendingDatasheetDeleteConfirm({
      kind: 'rows',
      rowIndices: indices,
      colKeys: [],
      label,
    });
  };

  const executeConfirmedDatasheetDelete = () => {
    const pending = pendingDatasheetDeleteConfirm;
    if (!pending) return;
    setPendingDatasheetDeleteConfirm(null);

    if (pending.kind === 'rows') {
      const idxSet = new Set(pending.rowIndices);
      const firstRemoved = Math.min(...pending.rowIndices);
      setEditingItemCode(null);
      setEditingItemName(null);
      setShowSearchDropdown(false);
      setSelectedRowRange(null);
      rowSelectionAnchorRef.current = null;
      setRows((prev) => {
        const filtered = prev.filter((_, idx) => !idxSet.has(idx));
        const next = ensureMinimumRows(filtered);
        const nextIdx = Math.max(0, Math.min(firstRemoved, next.length - 1));
        setSelectedRowIndex(nextIdx);
        return next;
      });
      setSuccessMsg(`Deleted ${pending.label}.`);
      return;
    }

    const colSet = new Set(pending.colKeys);
    if (colSet.has('item_code')) setEditingItemCode(null);
    if (colSet.has('item_name')) setEditingItemName(null);
    setShowSearchDropdown(false);
    setRows((prev) =>
      prev.map((r) => {
        const updated: DatasheetRow = { ...r };
        if (colSet.has('item_code')) updated.item_code = '';
        if (colSet.has('item_name')) updated.item_name = '';
        if (colSet.has('quantity')) updated.quantity = 0;
        if (colSet.has('discount_1')) {
          updated.discount_1_percent = 0;
        }
        if (colSet.has('discount_2')) {
          updated.discount_2_percent = 0;
        }
        if (colSet.has('unit_price')) updated.unit_price = 0;
        if (colSet.has('loose_quantity')) updated.loose_quantity = 0;
        if (colSet.has('loose_rate')) updated.loose_rate = 0;
        if (colSet.has('bonus_quantity')) updated.bonus_quantity = 0;
        if (colSet.has('remarks')) updated.remarks = '';
        return recalcRow(updated);
      })
    );
    setSelectedColKeys([]);
    colSelectionAnchorRef.current = null;
    setSuccessMsg(`Cleared values in ${pending.label}.`);
  };

  const handleCopyRow = (index: number) => {
    const r = rows[index];
    if (!r) return;
    setCopiedRowData({
      quantity: r.quantity,
      bonus_quantity: r.bonus_quantity || 0,
      unit_price: r.unit_price,
      discount_1_percent: r.discount_1_percent,
      discount_2_percent: r.discount_2_percent,
      discount_percent: r.discount_percent,
      loose_quantity: r.loose_quantity,
      loose_rate: r.loose_rate,
      remarks: r.remarks || '',
    });
    setSuccessMsg(`Copied values (Qty, Bonus Qty, Price, Disc 1 %, Disc 2 %, Loose Qty) from Row #${index + 1}.`);
  };

  const handlePasteRow = (index: number) => {
    if (!copiedRowData) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = recalcRow({
        ...next[index],
        ...copiedRowData,
      });
      return next;
    });
    setSuccessMsg(`Pasted values into Row #${index + 1}.`);
  };

  // Automatic Bill Calculations (supports positive sales, negative returns, and mixed invoices)
  const validRows = rows.filter((r) => r.item_id !== null);
  const grossAmount = round2(validRows.reduce((s, r) => s + r.gross_amount, 0));
  const itemDiscountTotal = round2(validRows.reduce((s, r) => s + r.discount_amount, 0));
  const subtotalAfterItemDisc = round2(grossAmount - itemDiscountTotal);

  const computedInvoiceDiscAmt =
    invoiceDiscountPercent > 0
      ? round2((subtotalAfterItemDisc * invoiceDiscountPercent) / 100)
      : subtotalAfterItemDisc >= 0
      ? round2(Math.min(subtotalAfterItemDisc, Math.max(0, invoiceDiscountAmount)))
      : round2(
          -Math.min(Math.abs(subtotalAfterItemDisc), Math.abs(invoiceDiscountAmount))
        );

  const totalDiscount = round2(itemDiscountTotal + computedInvoiceDiscAmt);
  const taxableAmount = round2(grossAmount - totalDiscount);
  const gstAmount = round2(validRows.reduce((s, r) => s + r.tax_amount, 0));

  const effectiveAdvTaxRate = advanceTaxApplicable ? round2(advanceTaxRate) : 0;
  const advanceTaxAmount = advanceTaxApplicable
    ? round2(((taxableAmount + gstAmount) * effectiveAdvTaxRate) / 100)
    : 0;

  const totalTax = round2(gstAmount + advanceTaxAmount);
  const netInvoiceAmount = round2(taxableAmount + totalTax);

  // Fast O(1) catalog lookup for live ROI & applicable cost calculation
  const catalogByIdMap = useMemo(() => {
    const map = new Map<number, FastSearchItem>();
    for (const c of catalogItems) {
      map.set(Number(c.id), c);
    }
    return map;
  }, [catalogItems]);

  // Unified Item-wise ROI (profit AMOUNT) calculation:
  // - Purchased items: Weighted Average Net Purchase Cost = Total Net Purchase Amount / Total Received Qty (incl. purchase bonus & discounts)
  // - Never-purchased items: Provisional Item Registration Pprice (purchase_price)
  // - No valid cost (both WAC and Pprice <= 0): ROI is blank (null), excluded from Invoice Total Profit
  // - Saved historical invoice lines: preserves cost_price_per_unit recorded at time of sale
  // - Sales Bonus Quantity: does NOT deduct additional purchase cost (stock deduction remains unchanged)
  const rowRoiMap = useMemo(() => {
    const map = new Map<
      string,
      {
        hasValidCost: boolean;
        packCost: number;
        unitCost: number;
        lineCost: number;
        netSellingAmount: number;
        roiAmount: number | null;
        costSource: 'saved' | 'weighted_avg_purchase' | 'item_pprice' | 'none';
      }
    >();

    const invDiscRatio =
      subtotalAfterItemDisc !== 0 && computedInvoiceDiscAmt !== 0
        ? computedInvoiceDiscAmt / subtotalAfterItemDisc
        : 0;

    for (const r of validRows) {
      const unitsPerPack = Math.max(1, Number(r.units_per_pack || 1));
      const packQty = Number(r.quantity || 0);
      const looseQty = Number(r.loose_quantity || 0);
      const bonusQty = Number(r.bonus_quantity || 0);

      let hasValidCost = false;
      let packCost = 0;
      let unitCost = 0;
      let costSource: 'saved' | 'weighted_avg_purchase' | 'item_pprice' | 'none' = 'none';

      const savedUnitCost = Number(r.saved_cost_price_per_unit || 0);
      if (Number.isFinite(savedUnitCost) && savedUnitCost > 0) {
        unitCost = savedUnitCost;
        packCost = savedUnitCost * unitsPerPack;
        hasValidCost = true;
        costSource = 'saved';
      } else {
        const catMatch = r.item_id ? catalogByIdMap.get(Number(r.item_id)) : undefined;
        const catVariant =
          r.variant_id && catMatch?.variants
            ? catMatch.variants.find((v) => Number(v.id) === Number(r.variant_id))
            : null;

        const wacPack = Number(
          catVariant?.weighted_avg_pack_cost ??
            catMatch?.weighted_avg_pack_cost ??
            r.weighted_avg_pack_cost ??
            0
        );
        const regPprice = Number(
          catVariant?.effective_purchase_price ??
            catMatch?.purchase_price ??
            r.item_pprice ??
            0
        );

        if (Number.isFinite(wacPack) && wacPack > 0) {
          packCost = wacPack;
          unitCost = wacPack / unitsPerPack;
          hasValidCost = true;
          costSource = 'weighted_avg_purchase';
        } else if (Number.isFinite(regPprice) && regPprice > 0) {
          packCost = regPprice;
          unitCost = regPprice / unitsPerPack;
          hasValidCost = true;
          costSource = 'item_pprice';
        }
      }

      const rawTaxable = Number(r.taxable_amount || 0);
      const netSellingAmount = rawTaxable - rawTaxable * invDiscRatio;

      if (!hasValidCost || (packQty === 0 && looseQty === 0 && bonusQty === 0)) {
        map.set(r.row_id, {
          hasValidCost,
          packCost,
          unitCost,
          lineCost: 0,
          netSellingAmount: round2(netSellingAmount),
          roiAmount: null,
          costSource,
        });
        continue;
      }

      // Cost is computed strictly on billed full & loose quantities (sales bonus quantity adds 0 extra cost)
      const lineCost = packQty * packCost + looseQty * unitCost;
      const roiAmount = round2(netSellingAmount - lineCost);

      map.set(r.row_id, {
        hasValidCost: true,
        packCost,
        unitCost,
        lineCost,
        netSellingAmount: round2(netSellingAmount),
        roiAmount,
        costSource,
      });
    }

    return map;
  }, [validRows, catalogByIdMap, subtotalAfterItemDisc, computedInvoiceDiscAmt]);

  // Invoice Total Profit = exact sum of all valid item-wise ROI amounts (100% reconciled with ROI column)
  const invoiceTotalProfit = useMemo(() => {
    let total = 0;
    for (const r of validRows) {
      const info = rowRoiMap.get(r.row_id);
      if (info && info.roiAmount !== null) {
        total += info.roiAmount;
      }
    }
    return round2(total);
  }, [validRows, rowRoiMap]);

  const formattedInvoiceProfit = invoiceTotalProfit.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Previous Customer Balance from actual account ledger (before posting current invoice)
  const prevCustomerBalance =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalanceAbs
      : round2(selectedCustomer?.current_balance || 0);
  const prevBalanceType: 'Debit' | 'Credit' =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalanceType
      : selectedCustomer?.current_balance_type || 'Debit';
  const signedPrevBalance =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalance
      : prevBalanceType === 'Debit'
      ? prevCustomerBalance
      : -prevCustomerBalance;

  // Calculation: Total Receivable = Previous Customer Balance + Current Invoice Net Amount
  const totalReceivable = round2(signedPrevBalance + netInvoiceAmount);

  // Received amount is entered manually by the user (no auto-fill).

  const paidAmount = round2(Math.max(0, Number(paidAmountInput || 0)));
  // Calculation: Remaining Balance = Total Receivable - Amount Received
  const remainingBalance = round2(totalReceivable - paidAmount);

  // Reset Invoice to Blank
  const resetToNewInvoice = async () => {
    localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    editingSaleIdRef.current = null;
    setEditingSaleId(null);
    setEditingSaleStatus(null);
    setCustomerAccountId(0);
    setCustomerSearchText('');
    setBuyerName('');
    setLiveBalanceSummary(null);
    setRows(ensureMinimumRows([]));
    setSelectedRowIndex(0);
    setQuickSearchQuery('');
    setShowSearchDropdown(false);
    setActiveSearchRowIdx(null);
    setEditingItemCode(null);
    setShowItemListModal(false);
    setItemListTargetRowIdx(null);
    setInvoiceDiscountPercent(0);
    setInvoiceDiscountAmount(0);
    setAdvanceTaxApplicable(false);
    setIsTaxOverridden(false);
    setTaxOverrideReason('');
    setPaidAmountManuallyEdited(false);
    setPaidAmountInput('');
    setDeliverymanId(null);
    setDeliverymanName('');
    setDeliveryStatus('Pending');
    setDeliveryCharges(0);
    setDeliveryNotes('');
    setRemarks('');
    setShowDiscardConfirm(false);
    setLastSavedWhatsappPayload(null);
    setShowSalesSmsModal(false);
    setSalesSmsText('');
    try {
      const nextNums = await api.getNextSalesNumbers(invoiceDate);
      setInvoiceNumber(nextNums.nextInvoiceNumber);
      await loadReferenceData();
    } catch {
      // ignore
    }
    if (invoiceViewMode === 'pos') {
      focusSalesItemSearch();
    }
  };

  // Automatically dismiss completed activity / WhatsApp notifications without requiring manual user action
  useEffect(() => {
    if (!successMsg) return;
    const timer = window.setTimeout(() => {
      setSuccessMsg(null);
      setLastSavedWhatsappPayload(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [successMsg]);

  useEffect(() => {
    const handleWhatsAppCompleted = () => {
      setLastSavedWhatsappPayload(null);
      setSuccessMsg(null);
    };
    window.addEventListener('ams-whatsapp-activity-completed', handleWhatsAppCompleted);
    return () => {
      window.removeEventListener('ams-whatsapp-activity-completed', handleWhatsAppCompleted);
    };
  }, []);

  // Save / Complete / Hold Invoice
  const handleSaveInvoice = async (
    targetStatus: 'completed' | 'held' | 'draft',
    autoPrintFormat?: 'a4' | '80mm' | '58mm'
  ) => {
    if (submitting || submittingRef.current) return;
    submittingRef.current = true;
    try {
      setErrorMsg(null);
      setSuccessMsg(null);

      const activeLines = rows.filter((r) => r.item_id !== null);
      if (activeLines.length === 0) {
        setErrorMsg('Please add at least one medicine item to the datasheet before saving.');
        return;
      }

      if (targetStatus === 'completed') {
        for (let i = 0; i < activeLines.length; i++) {
          const r = activeLines[i];
          if (
            Number(r.quantity || 0) === 0 &&
            Number(r.loose_quantity || 0) === 0 &&
            Number(r.bonus_quantity || 0) === 0
          ) {
            const rowIndexInGrid = rows.findIndex((row) => row.row_id === r.row_id);
            const focusIdx = rowIndexInGrid >= 0 ? rowIndexInGrid : i;
            setSelectedRowIndex(focusIdx);
            setErrorMsg(
              `Please enter a Quantity (or Loose Qty) for Row #${focusIdx + 1} (${r.item_name}).`
            );
            setTimeout(() => {
              const targetId =
                invoiceViewMode === 'pos' ? `pos_row_${focusIdx}_quantity` : `cell_${focusIdx}_quantity`;
              const qtyEl = document.getElementById(targetId) as HTMLInputElement | null;
              qtyEl?.focus();
            }, 25);
            return;
          }
        }
      }

      if (targetStatus === 'completed' && !allowNegativeStock && !editingSaleId) {
        for (let i = 0; i < activeLines.length; i++) {
          const r = activeLines[i];
          if (r.total_units > 0 && r.total_units > r.available_stock_units) {
            setErrorMsg(
              `Stock Shortage on Row #${i + 1} (${r.item_name} - Batch ${r.batch_number}): Available ${r.available_stock_packs} Packs (${r.available_stock_units} Units), Requested ${r.total_units} Units.`
            );
            return;
          }
        }
      }

      setSubmitting(true);

      const clientRequestId = `SAL-${invoiceNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        client_request_id: clientRequestId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        customer_account_id: customerAccountId,
        customer_name: selectedCustomer?.account_name || 'Walk-in Cash Customer',
        buyer_name: buyerName.trim(),
        customer_filer_status: customerFilerStatus,
        salesman_id: salesmanId,
        salesman,
        deliveryman_id: deliverymanId,
        deliveryman_name: deliverymanName || null,
        delivery_status: deliveryStatus,
        delivery_charges: deliveryCharges,
        delivery_notes: deliveryNotes || null,
        invoice_type: invoiceType,
        payment_mode: paymentMode,
        payment_account_id: paymentAccountId,
        invoice_discount_percent: invoiceDiscountPercent,
        invoice_discount_amount: computedInvoiceDiscAmt,
        discount_override_by: discountOverrideBy || null,
        discount_override_reason: discountOverrideReason || null,
        advance_tax_applicable: advanceTaxApplicable ? 1 : 0,
        advance_tax_rate: effectiveAdvTaxRate,
        is_tax_overridden: isTaxOverridden ? 1 : 0,
        tax_override_reason: taxOverrideReason || null,
        tax_override_authorized_by: taxOverrideAuthorizedBy || null,
        paid_amount: paidAmount,
        allow_negative_stock: allowNegativeStock ? 1 : 0,
        status: targetStatus,
        ...(editingSaleId &&
        String(editingSaleStatus || '').trim().toLowerCase() !== 'completed' &&
        targetStatus === 'completed'
          ? { from_hold_conversion: true }
          : {}),
        remarks,
        items: activeLines.map((r) => ({
          item_id: r.item_id,
          variant_id: r.variant_id || null,
          variant_code: r.variant_id ? (r.variant_code || null) : null,
          variant_name: r.variant_id ? (r.variant_name || null) : null,
          inventory_id: r.inventory_id,
          item_code: r.item_code,
          company_name: r.company_name,
          item_name: r.item_name,
          packing: r.packing,
          batch_number: r.batch_number,
          expiry_date: r.expiry_date,
          quantity: r.quantity,
          bonus_quantity: Number(r.bonus_quantity || 0),
          unit_price: r.unit_price,
          discount_1_percent: r.discount_1_percent,
          discount_2_percent: r.discount_2_percent,
          net_rate: r.net_rate,
          discount_percent: r.discount_percent,
          discount_amount: r.discount_amount,
          loose_quantity: r.loose_quantity,
          loose_rate: r.loose_rate,
          tax_type: r.tax_type || 'percentage',
          tax_value: Number(r.tax_value ?? r.tax_percent ?? 0),
          tax_percent: r.tax_percent,
          saved_cost_price_per_unit: r.saved_cost_price_per_unit ?? null,
          remarks: String(r.remarks || '').trim(),
        })),
      };

      const prevEditingId = editingSaleId;
      const res: any = prevEditingId
        ? await api.updateSale(prevEditingId, payload)
        : await api.createSale(payload);

      const savedInvoice = (res?.data || res?.invoice || res?.sale || res) as SalesInvoiceRecord;
      if (prevEditingId && targetStatus === 'completed') {
        localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
        setHeldInvoices((prev) => prev.filter((h) => Number(h.id) !== Number(prevEditingId)));
        setPendingInvoices((prev) => prev.filter((p) => Number(p.id) !== Number(prevEditingId)));
      }

      // Automatically dismiss any related WhatsApp/activity notification when invoice is saved or posted
      setLastSavedWhatsappPayload(null);
      setShowSalesSmsModal(false);
      window.dispatchEvent(
        new CustomEvent('ams-whatsapp-activity-completed', {
          detail: { invoiceId: savedInvoice.id, documentNumber: savedInvoice.invoice_number },
        })
      );

      // Refresh store display name (never auto-trigger WhatsApp after save/update)
      api
        .getCompanySettings()
        .then((sRes) => {
          if (sRes?.data?.store_name) {
            setStoreDisplayName(sRes.data.store_name);
          }
        })
        .catch(() => null);

      const wasEditing = Boolean(editingSaleId);
      setSuccessMsg(
        targetStatus === 'completed'
          ? (wasEditing
              ? `Sales Invoice ${savedInvoice.invoice_number} successfully updated! Stock & Accounts reconciled.`
              : `Sales Invoice ${savedInvoice.invoice_number} confirmed! Stock & Customer Ledger Balance updated.`)
          : targetStatus === 'draft'
          ? `Invoice ${savedInvoice.invoice_number} saved as PENDING.`
          : `Invoice ${savedInvoice.invoice_number} saved as ${targetStatus.toUpperCase()}.`
      );

      if (targetStatus === 'completed') {
        setItemHistoryMap({});
      }

      if (autoPrintFormat) {
        const fullDetails: any = await api.getSaleDetails(savedInvoice.id);
        const fullInv = fullDetails?.data || fullDetails?.invoice || fullDetails?.sale || savedInvoice;
        setPrintFormat(autoPrintFormat);
        setPrintInvoice({
          ...fullInv,
          items:
            (Array.isArray(fullInv?.items) && fullInv.items.length > 0
              ? fullInv.items
              : fullDetails?.items) || [],
        });
      }

      await resetToNewInvoice();
      void refreshHeldInvoices();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Reprint Previous Invoice
  const handleReprintLastInvoice = async () => {
    try {
      setErrorMsg(null);
      const listRes = await api.getSales({ status: 'completed', pageSize: 1 });
      const last = listRes.data?.[0];
      if (!last) {
        setErrorMsg('No previous completed Sales Invoice found to reprint.');
        return;
      }
      const details: any = await api.getSaleDetails(last.id);
      const inv = details?.data || details?.invoice || details?.sale || last;
      setPrintFormat('a4');
      setPrintInvoice({
        ...inv,
        items:
          (Array.isArray(inv?.items) && inv.items.length > 0 ? inv.items : details?.items) || [],
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Open DSR (Daily Stock Requisition) Report for currently open Sales Invoice
  const handleOpenDsrReport = () => {
    const activeInvoiceItems = rows.filter((r) => isSalesRowPopulated(r));
    if (activeInvoiceItems.length === 0) {
      setErrorMsg(
        'No items in the current Sales Invoice. Please add at least one item to generate the DSR (Daily Stock Requisition) Report.'
      );
      setShowDsrModal(true);
      return;
    }
    setErrorMsg(null);
    setShowDsrModal(true);
  };

  // Open Send SMS modal for currently open Sales Invoice (auto-fetches customer mobile from Accounts)
  const handleOpenSalesSms = async () => {
    const activeInvoiceItems = rows.filter((r) => isSalesRowPopulated(r));
    if (activeInvoiceItems.length === 0) {
      setErrorMsg(
        'No items in the current Sales Invoice. Please add at least one item before clicking Send SMS.'
      );
      return;
    }
    setErrorMsg(null);

    let registeredPhone = String(
      selectedCustomer?.phone || (selectedCustomer as any)?.mobile || ''
    ).trim();

    if (!registeredPhone && customerAccountId > 0) {
      try {
        const accRes = await api.getAccounts({ status: 'Active' });
        const allAccs = Array.isArray(accRes?.data) ? accRes.data : [];
        const matched = allAccs.find((a: any) => Number(a.id) === Number(customerAccountId));
        if (matched) {
          registeredPhone = String(matched.phone || matched.mobile || '').trim();
        }
      } catch {
        // Use local selectedCustomer fallback
      }
    }

    const preparedText = generateSalesInvoiceSmsText(rows);
    setSalesSmsPhone(registeredPhone);
    setSalesSmsText(preparedText);
    setShowSalesSmsModal(true);
  };

  // One-click export from the active invoice: open the existing thermal layout and print it as PDF.
  const handleExportCurrentInvoicePdf = () => {
    if (!rows.some((r) => isSalesRowPopulated(r))) {
      setErrorMsg('Please add at least one item before exporting this invoice to PDF.');
      return;
    }
    setAutoExportPdfOnOpen(true);
    handleOpenCurrentInvoicePreview(preferredThermalWidth);
  };

  // Open Print Preview for currently open Sales Invoice without saving or changing values
  const handleOpenCurrentInvoicePreview = (format: 'a4' | '80mm' | '58mm' = 'a4') => {
    const activeLines = rows.filter((r) => isSalesRowPopulated(r));
    if (activeLines.length === 0) {
      setErrorMsg(
        'No items in the current Sales Invoice. Please add at least one item to open Print Preview.'
      );
      return;
    }
    setErrorMsg(null);
    const previewRecord: SalesInvoiceRecord = {
      id: editingSaleId || 0,
      invoice_number: invoiceNumber || 'DRAFT',
      invoice_date: invoiceDate,
      customer_account_id: customerAccountId || 0,
      customer_name:
        customerAccountId > 0
          ? selectedCustomer?.account_name || 'Walk-in Cash Customer'
          : 'Walk-in Cash Customer',
      buyer_name: buyerName.trim(),
      customer_code: selectedCustomer?.account_code || '',
      customer_phone: selectedCustomer?.phone || '',
      customer_address: selectedCustomer?.address || '',
      customer_filer_status: customerFilerStatus,
      salesman_id: salesmanId,
      salesman: salesman || 'Counter Pharmacist',
      deliveryman_id: deliverymanId,
      deliveryman_name: deliverymanName || null,
      delivery_status: deliveryStatus,
      delivery_charges: deliveryCharges,
      delivery_notes: deliveryNotes || null,
      invoice_type: invoiceType,
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId,
      gross_total: grossAmount,
      item_discount_amount: itemDiscountTotal,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      discount_amount: totalDiscount,
      taxable_amount: taxableAmount,
      gst_amount: gstAmount,
      advance_tax_applicable: advanceTaxApplicable ? 1 : 0,
      advance_tax_rate: effectiveAdvTaxRate,
      advance_tax_amount: advanceTaxAmount,
      is_tax_overridden: isTaxOverridden ? 1 : 0,
      tax_override_reason: taxOverrideReason || null,
      tax_amount: totalTax,
      net_total: netInvoiceAmount,
      previous_customer_balance: prevCustomerBalance,
      previous_balance_type: prevBalanceType,
      total_receivable: totalReceivable,
      paid_amount: paidAmount,
      balance_amount: remainingBalance,
      allow_negative_stock: allowNegativeStock ? 1 : 0,
      journal_entry_id: null,
      payment_journal_entry_id: null,
      status: editingSaleId ? 'completed' : 'draft',
      remarks: remarks || '',
      items: activeLines.map((r, idx) => ({
        id: idx + 1,
        sale_id: editingSaleId || 0,
        item_id: Number(r.item_id || 0),
        variant_id: r.variant_id || null,
        variant_code: r.variant_code || '',
        variant_name: r.variant_name || '',
        inventory_id: r.inventory_id,
        item_code: r.item_code,
        company_name: r.company_name,
        item_name: r.item_name,
        packing: r.packing,
        units_per_pack: r.units_per_pack,
        batch_number: r.batch_number,
        expiry_date: r.expiry_date,
        available_stock_packs: r.available_stock_packs,
        available_stock_units: r.available_stock_units,
        quantity: r.quantity,
        bonus_quantity: Number(r.bonus_quantity || 0),
        unit_price: r.unit_price,
        discount_1_percent: r.discount_1_percent,
        discount_2_percent: r.discount_2_percent,
        net_rate: r.net_rate,
        discount_percent: r.discount_percent,
        discount_amount: r.discount_amount,
        loose_quantity: r.loose_quantity,
        loose_rate: r.loose_rate,
        total_units: r.total_units,
        gross_amount: r.gross_amount,
        taxable_amount: r.taxable_amount,
        tax_type: r.tax_type || 'percentage',
        tax_value: Number(r.tax_value ?? r.tax_percent ?? 0),
        tax_percent: r.tax_percent,
        tax_amount: r.tax_amount,
        line_total: r.line_total,
        remarks: String(r.remarks || ''),
      })),
    };
    setPrintFormat(format);
    setPrintInvoice(previewRecord);
  };

  // Export Active Sales Invoice (or Saved Sales Invoices) to Formatted Multi-Sheet Excel (.xlsx)
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [customExportOpen, setCustomExportOpen] = useState<boolean>(false);
  const [customExportRecords, setCustomExportRecords] = useState<Array<Record<string, any>>>([]);
  const [excelImportOpen, setExcelImportOpen] = useState<boolean>(false);

  const buildCurrentSaleExportRecord = () => {
    const activeLines = rows.filter((r) => r.item_id !== null);
    if (activeLines.length === 0) return null;
    return {
      id: editingSaleId || 0,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      customer_account_id: customerAccountId,
      customer_code: selectedCustomer?.account_code || 'CUS-1001',
      customer_name: selectedCustomer?.account_name || 'Walk-in Cash Customer',
      buyer_name: buyerName.trim(),
      customer_filer_status: customerFilerStatus,
      salesman: salesman || 'Counter Pharmacist',
      deliveryman_name: deliverymanName || '',
      invoice_type: invoiceType,
      payment_mode: paymentMode,
      gross_amount: grossAmount,
      item_discount_total: itemDiscountTotal,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      discount_amount: round2(itemDiscountTotal + computedInvoiceDiscAmt),
      taxable_amount: taxableAmount,
      advance_tax_rate: effectiveAdvTaxRate,
      advance_tax_amount: advanceTaxAmount,
      tax_amount: totalTax,
      net_total: netInvoiceAmount,
      paid_amount: paidAmount,
      balance_amount: remainingBalance,
      status: editingSaleId ? 'completed' : 'draft',
      remarks: remarks || '',
      items: activeLines.map((r, idx) => ({
        id: idx + 1,
        item_id: Number(r.item_id || 0),
        variant_id: r.variant_id || null,
        variant_code: r.variant_code || '',
        variant_name: r.variant_name || '',
        item_code: r.item_code,
        company_name: r.company_name,
        item_name: r.item_name,
        packing: r.packing,
        batch_number: r.batch_number,
        expiry_date: r.expiry_date,
        quantity: r.quantity,
        loose_quantity: r.loose_quantity,
        bonus_quantity: Number(r.bonus_quantity || 0),
        total_units: r.total_units,
        unit_price: r.unit_price,
        loose_rate: r.loose_rate,
        discount_1_percent: r.discount_1_percent,
        discount_2_percent: r.discount_2_percent,
        net_rate: r.net_rate,
        discount_percent: r.discount_percent,
        discount_amount: r.discount_amount,
        taxable_amount: r.taxable_amount,
        tax_type: r.tax_type || 'percentage',
        tax_value: Number(r.tax_value ?? r.tax_percent ?? 0),
        tax_percent: r.tax_percent,
        tax_amount: r.tax_amount,
        gross_amount: r.gross_amount,
        line_total: r.line_total,
        remarks: String(r.remarks || ''),
      })),
    };
  };

  const handleOpenCustomExcelExport = async () => {
    try {
      setExportingExcel(true);
      setErrorMsg(null);
      const currentRecord = buildCurrentSaleExportRecord();
      if (currentRecord) {
        setCustomExportRecords([currentRecord]);
        setCustomExportOpen(true);
        return;
      }
      const res = await api.getSales({ status: 'completed', exportAll: true });
      const savedSales = res.data || [];
      setCustomExportRecords(savedSales);
      setCustomExportOpen(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportCurrentSaleToExcel = async () => {
    try {
      setExportingExcel(true);
      setErrorMsg(null);
      const currentRecord = buildCurrentSaleExportRecord();
      if (currentRecord) {
        exportSalesInvoicesToExcel(
          [currentRecord],
          `Sales_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        );
        setSuccessMsg(`Exported Sales Invoice ${invoiceNumber} (${currentRecord.items.length} items) to Excel (.xlsx).`);
        return;
      }

      // If current form has no items yet, export all saved completed sales invoices from the database
      const res = await api.getSales({ status: 'completed', exportAll: true });
      const savedSales = res.data || [];
      if (savedSales.length === 0) {
        setErrorMsg('No items in the current invoice and no saved sales invoices found to export.');
        return;
      }
      exportSalesInvoicesToExcel(savedSales, `Sales_Invoices_${invoiceDate}.xlsx`);
      setSuccessMsg(`Exported ${savedSales.length} saved Sales Invoice(s) with all line items to Excel (.xlsx).`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportAllSalesToExcel = async () => {
    try {
      setExportingExcel(true);
      setErrorMsg(null);
      const res = await api.getSales({ status: 'completed', exportAll: true });
      const savedSales = res.data || [];
      if (savedSales.length === 0) {
        setErrorMsg('No saved sales invoices found in the database to export.');
        return;
      }
      exportSalesInvoicesToExcel(savedSales, `Sales_Invoices_All_${invoiceDate}.xlsx`);
      setSuccessMsg(`Exported ${savedSales.length} saved Sales Invoice(s) with all line items to Excel (.xlsx).`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const fetchCustomerLedgerByRange = async (range: 'all' | 'last30') => {
    if (!customerAccountId || customerAccountId <= 0 || !selectedCustomer) {
      setErrorMsg('Please select a Customer first before opening the Customer Ledger.');
      return;
    }
    const reqId = ++customerLedgerReqIdRef.current;
    setShowCustomerLedgerChoicePopup(false);
    setCustomerLedgerPeriod(range);
    setCustomerLedgerData(null);
    setCustomerLedgerLoading(true);
    setActiveCustomerShortcut('ledger');

    let startDate: string | undefined;
    let endDate: string | undefined;
    if (range === 'last30') {
      const today = new Date();
      const past = new Date();
      past.setDate(today.getDate() - 30);
      startDate = past.toISOString().slice(0, 10);
      endDate = today.toISOString().slice(0, 10);
    }

    try {
      const res = await api.getAccountLedger({
        ledgerType: 'customer',
        accountId: customerAccountId,
        startDate,
        endDate,
      });
      if (customerLedgerReqIdRef.current !== reqId) return;
      setCustomerLedgerData(res);
    } catch (err: unknown) {
      if (customerLedgerReqIdRef.current !== reqId) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (customerLedgerReqIdRef.current === reqId) {
        setCustomerLedgerLoading(false);
      }
    }
  };

  // Open Customer Shortcut Drawer
  const openCustomerShortcut = async (
    mode: 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  ) => {
    if (mode === 'ledger') {
      if (!customerAccountId || customerAccountId <= 0 || !selectedCustomer) {
        setErrorMsg('Please select a Customer first before opening the Customer Ledger.');
        return;
      }
      setErrorMsg(null);
      setShowCustomerLedgerChoicePopup(true);
      return;
    }
    setActiveCustomerShortcut(mode);
    if (mode === 'add_customer') {
      try {
        const next = await api.getNextAccountCode('Customer', 'PARTY ACCOUNTS');
        setNewCustCode(next.next_code);
      } catch {
        setNewCustCode('Cus-024');
      }
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    }
  };

  // Submit Quick Receive Payment inside Customer Shortcut
  const handleQuickReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amt = round2(quickReceiptAmount);
      if (amt <= 0) {
        setErrorMsg('Please enter a valid payment amount greater than 0.');
        return;
      }
      await api.createPaymentVoucher({
        voucher_type: 'receive_payment',
        party_account_id: customerAccountId,
        amount: amt,
        payment_method: quickReceiptMethod,
        description: quickReceiptNotes || `Quick receipt from POS Billing Screen`,
      });
      setQuickReceiptAmount('');
      setQuickReceiptNotes('');
      setActiveCustomerShortcut(null);
      await loadReferenceData();
      await refreshCustomerBalanceSummary(customerAccountId, editingSaleId);
      setSuccessMsg(`Received ${formatPKR(amt)} from ${selectedCustomer?.account_name}. Balance updated.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Submit Quick Add Customer inside Customer Shortcut
  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!newCustName.trim()) {
        setErrorMsg('Customer Name is required.');
        return;
      }
      const res = await api.createAccount({
        account_code: newCustCode.trim(),
        account_name: newCustName.trim(),
        main_group: 'PARTY ACCOUNTS',
        account_group: 'Customer',
        opening_balance: 0,
        opening_balance_type: 'Debit',
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
        filer_status: newCustFilerStatus,
        status: 'Active',
      });
      await loadReferenceData();
      const createdId = res.account?.id || res.data?.id;
      if (createdId) {
        setCustomerAccountId(Number(createdId));
      }
      setActiveCustomerShortcut(null);
      setSuccessMsg(`Customer "${newCustName}" created and selected for this invoice.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Smooth Drag-and-Drop Adjustable Column Widths for Classic & Modern POS Sales Datasheets (no fixed width locks)
  const {
    colWidths,
    totalWidth: accessTotalWidth,
    resizingCol: accessResizingCol,
    handleResizeStart: handleColResizeMouseDown,
    resetColumnWidth: handleResetAccessColWidth,
  } = useResizableColumns({
    storageKey: 'ams_sales_access_col_widths_v1',
    defaultWidths: {
      selector: 34,
      item_code: 86,
      item_name: 330,
      quantity: 58,
      discount_1: 66,
      discount_2: 66,
      unit_price: 76,
      net_rate: 76,
      loose_quantity: 84,
      loose_rate: 90,
      bonus_quantity: 64,
      amount: 96,
      roi: 84,
      last_purchase_price: 154,
      company: 125,
      gross_amount: 106,
      remarks: 120,
      actions: 112,
    },
    minWidth: 36,
  });

  const {
    colWidths: posColWidths,
    totalWidth: posTotalWidth,
    resizingCol: posResizingCol,
    handleResizeStart: handlePosColResizeMouseDown,
    resetColumnWidth: handleResetPosColWidth,
  } = useResizableColumns({
    storageKey: 'ams_sales_pos_col_widths_v1',
    defaultWidths: {
      selector: 38,
      item_code: 92,
      company: 126,
      item_name: 250,
      quantity: 80,
      loose_quantity: 96,
      unit_price: 84,
      loose_rate: 84,
      discount_1: 64,
      discount_2: 64,
      net_rate: 76,
      bonus_quantity: 68,
      gross_amount: 96,
      tax: 86,
      amount: 108,
      roi: 88,
      remarks: 126,
      actions: 62,
    },
    minWidth: 36,
  });

  // Keyboard Navigation in Access Datasheet Grid (dynamically follows customized column order)
  const accessEditableColOrder = useMemo(() => {
    const colToFocusKey: Record<string, string> = {
      item_code: 'item_code',
      item_name: 'item_name',
      quantity: 'quantity',
      discount_1: 'discount_1_percent',
      discount_2: 'discount_2_percent',
      unit_price: 'unit_price',
      loose_quantity: 'loose_quantity',
      loose_rate: 'loose_rate',
      bonus_quantity: 'bonus_quantity',
      remarks: 'remarks',
    };
    return orderedSalesAccessColKeys
      .map((k) => colToFocusKey[k])
      .filter((k): k is string => Boolean(k));
  }, [orderedSalesAccessColKeys]);

  // MS Access-style: only ONE blank "new record" row is active at a time.
  // Blank rows below it are shown as greyed placeholders and cannot be edited.
  const entryRowIdx = (() => {
    const i = rows.findIndex((r) => !isSalesRowPopulated(r));
    return i >= 0 ? i : rows.length;
  })();
  const isGhostRow = (idx: number) => idx > entryRowIdx && !isSalesRowPopulated(rows[idx]);

  const getEditableColsForRow = (row?: DatasheetRow, mode: 'pos' | 'access' = 'access') => {
    if (mode === 'pos') {
      if (isSyrupItem(row)) {
        return ['quantity', 'unit_price', 'discount_1_percent', 'discount_2_percent', 'bonus_quantity', 'remarks'] as Array<
          'quantity' | 'bonus_quantity' | 'discount_1_percent' | 'discount_2_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate' | 'remarks'
        >;
      }
      return [
        'quantity',
        'loose_quantity',
        'unit_price',
        'loose_rate',
        'discount_1_percent',
        'discount_2_percent',
        'bonus_quantity',
        'remarks',
      ] as Array<
        'quantity' | 'bonus_quantity' | 'discount_1_percent' | 'discount_2_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate' | 'remarks'
      >;
    }
    if (isSyrupItem(row)) {
      return accessEditableColOrder.filter(
        (c) => c !== 'loose_quantity' && c !== 'loose_rate'
      );
    }
    return accessEditableColOrder;
  };

  const focusCell = (rIdx: number, cName: string, prefix: 'cell' | 'pos_row' = 'cell') => {
    const targetRow = rows[rIdx];
    let resolvedCol = cName;
    if (
      (cName === 'loose_quantity' || cName === 'loose_rate') &&
      targetRow &&
      isSyrupItem(targetRow)
    ) {
      resolvedCol = 'unit_price';
    }
    const targetId = `${prefix}_${rIdx}_${resolvedCol}`;
    pendingFocusTargetRef.current = targetId;
    const el = document.getElementById(targetId) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.focus();
      if ('select' in el && typeof el.select === 'function') {
        el.select();
      }
      el.closest('tr')?.scrollIntoView({ block: 'nearest' });
    }
  };

  // Focus the Item Search field inside a NEW empty invoice row (used after selecting Customer + pressing Enter)
  const focusNewRowItemSearch = () => {
    const now = Date.now();
    if (now - customerEnterFocusTimestampRef.current < 120) return;
    customerEnterFocusTimestampRef.current = now;

    const firstBlankIdx = rows.findIndex((r) => !r.item_id);
    const targetRowIdx = firstBlankIdx >= 0 ? firstBlankIdx : rows.length;
    if (targetRowIdx >= rows.length) {
      setRows((prev) => ensureMinimumRows([...prev, createEmptyRow()]));
    }
    setSelectedRowIndex(targetRowIdx);
    setRecordJumpInput(String(targetRowIdx + 1));
    setShowSearchDropdown(false);
    setActiveSearchRowIdx(null);

    if (invoiceViewMode === 'pos') {
      focusSalesItemSearch();
    } else {
      window.requestAnimationFrame(() => {
        setTimeout(() => {
          focusCell(targetRowIdx, 'item_name', 'cell');
        }, 25);
      });
    }
  };

  const handleSelectCustomerAccount = (id: number) => {
    setCustomerAccountId(id);
    if (id > 0) {
      refreshCustomerBalanceSummary(id, editingSaleId);
      const chosenCust = customers.find((c) => Number(c.id) === id);
      if (chosenCust?.assigned_salesman_id && (!salesmanId || salesman === 'Counter Pharmacist')) {
        setSalesmanId(Number(chosenCust.assigned_salesman_id));
        setSalesman(chosenCust.assigned_salesman_name || 'Counter Pharmacist');
      }
    } else {
      setLiveBalanceSummary(null);
    }
  };

  const navigateToRecord = (targetIdx: number, preferredCol?: string) => {
    const clamped = Math.max(0, Math.min(entryRowIdx, targetIdx));
    setSelectedRowIndex(clamped);
    setRecordJumpInput(String(clamped + 1));
    setShowSearchDropdown(false);

    const targetRow = rows[clamped];
    const prefix = invoiceViewMode === 'pos' ? 'pos_row' : 'cell';
    const fallbackCol =
      invoiceViewMode === 'pos'
        ? 'quantity'
        : targetRow && targetRow.item_id
        ? 'quantity'
        : 'item_code';
    const colToFocus = preferredCol || fallbackCol;

    setTimeout(() => {
      focusCell(clamped, colToFocus, prefix);
    }, 15);
  };

  // Searchable projection of existing invoice rows (read-only lookup including catalog barcode)
  const salesSearchableItems = useMemo<InvoiceSearchableItem[]>(() => {
    const barcodeByItemId = new Map<number, string>();
    for (const c of catalogItems) {
      if (c?.id && c?.barcode) {
        barcodeByItemId.set(Number(c.id), String(c.barcode));
      }
    }
    return rows.map((r, idx) => ({
      rowIndex: idx,
      itemId: r.item_id,
      itemCode: r.variant_code || r.item_code || '',
      itemName: r.variant_name ? `${r.item_name} — ${r.variant_name}` : r.item_name || '',
      barcode: r.barcode || (r.item_id ? barcodeByItemId.get(Number(r.item_id)) || '' : ''),
    }));
  }, [rows, catalogItems]);

  const handlePreviewSearchedSalesRow = useCallback((rowIdx: number | null) => {
    if (rowIdx === null || rowIdx < 0) return;
    setSelectedRowIndex(rowIdx);
    const rowEl = document.querySelector(`[data-sales-row-idx="${rowIdx}"]`) as HTMLElement | null;
    if (rowEl) {
      rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, []);

  const handleNavigateToSearchedSalesRow = useCallback(
    (rowIdx: number) => {
      if (rowIdx < 0 || rowIdx >= rows.length) return;
      setSelectedRowIndex(rowIdx);
      setRecordJumpInput(String(rowIdx + 1));
      setShowSearchDropdown(false);
      const prefix = invoiceViewMode === 'pos' ? 'pos_row' : 'cell';
      setTimeout(() => {
        const rowEl = document.querySelector(`[data-sales-row-idx="${rowIdx}"]`) as HTMLElement | null;
        rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        focusCell(rowIdx, 'quantity', prefix);
      }, 15);
    },
    [rows.length, invoiceViewMode]
  );

  const handleRecordJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const parsed = parseInt(recordJumpInput, 10);
      if (!Number.isNaN(parsed) && parsed >= 1) {
        navigateToRecord(parsed - 1);
      } else {
        setRecordJumpInput(String(selectedRowIndex + 1));
      }
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      navigateToRecord(selectedRowIndex - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      navigateToRecord(selectedRowIndex + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      navigateToRecord(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      navigateToRecord(rows.length - 1);
    }
  };

  // Microsoft Access-style continuous entry:
  // Move to the next blank row below without modifying existing rows and focus its Item Name field
  const advanceToNewRowItemSearch = (_fromRowIdx: number, mode: 'pos' | 'access') => {
    const targetRowIdx = entryRowIdx;

    if (targetRowIdx >= rows.length) {
      setRows((prev) => [...prev, createEmptyRow()]);
    }

    setSelectedRowIndex(targetRowIdx);
    setRecordJumpInput(String(targetRowIdx + 1));
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setActiveSearchRowIdx(targetRowIdx);

    const prefix = mode === 'pos' ? 'pos_row' : 'cell';
    const itemNameId = `${prefix}_${targetRowIdx}_item_name`;
    pendingFocusTargetRef.current = itemNameId;
    setTimeout(() => {
      const el = document.getElementById(itemNameId) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select?.();
        el.closest('tr')?.scrollIntoView({ block: 'nearest' });
      }
    }, 25);
  };

  const advanceToNextRowItemCode = (fromRowIdx: number, mode: 'pos' | 'access') => {
    const nextRowIdx = fromRowIdx + 1;
    if (nextRowIdx >= rows.length) {
      setRows((prev) => ensureMinimumRows([...prev, createEmptyRow()]));
    }

    setSelectedRowIndex(nextRowIdx);
    setRecordJumpInput(String(nextRowIdx + 1));
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setActiveSearchRowIdx(nextRowIdx);

    const prefix = mode === 'pos' ? 'pos_row' : 'cell';
    const itemCodeId = `${prefix}_${nextRowIdx}_item_code`;
    pendingFocusTargetRef.current = itemCodeId;
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(itemCodeId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
          el.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      }, 20);
    });
  };

  // POS View Keyboard Navigation: Quantity -> Loose Qty -> Rate -> Loose Rate -> Disc 1 % -> Disc 2 % -> Bonus -> Remarks -> New Row
  const handlePosFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    fieldName:
      | 'quantity'
      | 'bonus_quantity'
      | 'discount_1_percent'
      | 'discount_2_percent'
      | 'unit_price'
      | 'loose_quantity'
      | 'loose_rate'
      | 'line_total'
      | 'remarks',
    isTableInput: boolean = false
  ) => {
    const row = rows[rowIdx];
    const prefix = isTableInput ? `pos_row_${rowIdx}` : 'pos_active';
    const posOrder = getEditableColsForRow(row, 'pos') as Array<
      | 'quantity'
      | 'bonus_quantity'
      | 'discount_1_percent'
      | 'discount_2_percent'
      | 'unit_price'
      | 'loose_quantity'
      | 'loose_rate'
      | 'remarks'
    >;

    if (e.key === 'Escape') {
      if (showCompactHistoryPopup) {
        e.preventDefault();
        e.stopPropagation();
        ctrlPriceHistoryArmedRef.current = false;
        setShowCompactHistoryPopup(false);
        return;
      }
    }

    if (fieldName === 'line_total') {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        advanceToNextRowItemCode(rowIdx, 'pos');
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        focusCell(rowIdx, 'remarks', 'pos_row');
        return;
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const prevCol = isSyrupItem(row) ? 'bonus_quantity' : 'loose_rate';
        focusCell(rowIdx, prevCol, 'pos_row');
        return;
      }
      if (isTableInput && e.key === 'ArrowUp' && rowIdx > 0) {
        e.preventDefault();
        setSelectedRowIndex(rowIdx - 1);
        focusCell(rowIdx - 1, 'line_total', 'pos_row');
        return;
      }
      if (isTableInput && e.key === 'ArrowDown' && rowIdx < entryRowIdx) {
        e.preventDefault();
        setSelectedRowIndex(rowIdx + 1);
        focusCell(rowIdx + 1, 'line_total', 'pos_row');
        return;
      }
      return;
    }

    const curIdx = posOrder.indexOf(fieldName);

    if (ctrlPriceHistoryArmedRef.current && e.ctrlKey && e.key !== 'Control') {
      ctrlPriceHistoryArmedRef.current = false;
      setShowCompactHistoryPopup(false);
    }

    // Ctrl while Sale Price field is focused -> Open Customer+Item History once per key press
    if (
      fieldName === 'unit_price' &&
      row?.item_id &&
      e.key === 'Control' &&
      !e.repeat &&
      !e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      ctrlPriceHistoryArmedRef.current = true;
      setSelectedRowIndex(rowIdx);
      fetchAndApplyItemHistory(
        rowIdx,
        Number(row.item_id || 0),
        customerAccountId,
        invoiceType,
        false,
        row.item_code,
        row.variant_id || null
      );
      setShowCompactHistoryPopup(true);
      return;
    }

    // Price column keyboard trigger -> Open Customer+Item Sales Price History
    if (fieldName === 'unit_price' && row?.item_id) {
      const ignoredKeys = new Set([
        'Enter', 'Tab', 'Escape',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown',
        'Backspace', 'Delete', 'Insert',
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
        'F1', 'F2', 'F3', 'F9',
      ]);
      const isTriggerKey =
        !e.ctrlKey &&
        !e.metaKey &&
        !ignoredKeys.has(e.key) &&
        !/^[0-9.\-]$/.test(e.key);
      if (isTriggerKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedRowIndex(rowIdx);
        setPriceHistoryModalState({
          isOpen: true,
          rowIndex: rowIdx,
          returnFocusId: `${prefix}_unit_price`,
        });
        return;
      }
    }

    // Forward Enter or Tab
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      if (curIdx >= 0 && curIdx < posOrder.length - 1) {
        const nextField = posOrder[curIdx + 1];
        const nextId = `${prefix}_${nextField}`;
        const nextEl = document.getElementById(nextId) as HTMLInputElement | null;
        if (nextEl) {
          nextEl.focus();
          nextEl.select?.();
          nextEl.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      } else {
        advanceToNewRowItemSearch(rowIdx, 'pos');
      }
      return;
    }

    // Backward Shift+Tab
    if (e.key === 'Tab' && e.shiftKey) {
      if (curIdx > 0) {
        e.preventDefault();
        const prevField = posOrder[curIdx - 1];
        const prevId = `${prefix}_${prevField}`;
        const prevEl = document.getElementById(prevId) as HTMLInputElement | null;
        if (prevEl) {
          prevEl.focus();
          prevEl.select?.();
          prevEl.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      } else if (isTableInput && rowIdx > 0) {
        e.preventDefault();
        const prevRowCols = getEditableColsForRow(rows[rowIdx - 1], 'pos');
        setSelectedRowIndex(rowIdx - 1);
        focusCell(rowIdx - 1, prevRowCols[prevRowCols.length - 1], 'pos_row');
      }
      return;
    }

    // Vertical Row Navigation in POS Table (ArrowUp / ArrowDown / PageUp / PageDown)
    if (isTableInput) {
      if (e.key === 'ArrowUp' && rowIdx > 0) {
        e.preventDefault();
        setSelectedRowIndex(rowIdx - 1);
        focusCell(rowIdx - 1, fieldName, 'pos_row');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (rowIdx >= entryRowIdx) return;
        if (rowIdx < rows.length - 1) {
          setSelectedRowIndex(rowIdx + 1);
          focusCell(rowIdx + 1, fieldName, 'pos_row');
        } else {
          setRows((prev) => [...prev, createEmptyRow()]);
          setSelectedRowIndex(rowIdx + 1);
          setTimeout(() => {
            focusCell(rowIdx + 1, fieldName, 'pos_row');
          }, 25);
        }
        return;
      }
      if (e.key === 'PageUp') {
        e.preventDefault();
        const target = Math.max(0, rowIdx - 5);
        setSelectedRowIndex(target);
        focusCell(target, fieldName, 'pos_row');
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        const target = Math.min(entryRowIdx, rowIdx + 5);
        setSelectedRowIndex(target);
        focusCell(target, fieldName, 'pos_row');
        return;
      }
    }

    // Horizontal ArrowLeft / ArrowRight across columns
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const target = e.currentTarget as HTMLInputElement;
      const atRightEdge =
        target.selectionStart === null || target.selectionStart >= (target.value?.length || 0);
      const atLeftEdge = target.selectionStart === null || target.selectionStart <= 0;

      if (e.key === 'ArrowRight' && atRightEdge && curIdx >= 0 && curIdx < posOrder.length - 1) {
        e.preventDefault();
        const nextEl = document.getElementById(`${prefix}_${posOrder[curIdx + 1]}`) as HTMLInputElement | null;
        if (nextEl) {
          nextEl.focus();
          nextEl.select?.();
        }
      } else if (e.key === 'ArrowLeft' && atLeftEdge && curIdx > 0) {
        e.preventDefault();
        const prevEl = document.getElementById(`${prefix}_${posOrder[curIdx - 1]}`) as HTMLInputElement | null;
        if (prevEl) {
          prevEl.focus();
          prevEl.select?.();
        }
      }
    }
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIndex: number,
    colName: string
  ) => {
    const row = rows[rowIndex];
    const rowEditableCols = getEditableColsForRow(row, 'access');

    // Clear entire Item Name field using '0' (keeps Item Code intact, never triggers search)
    // Backspace uses normal/default text-input behavior.
    if (
      colName === 'item_name' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.shiftKey &&
      (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')
    ) {
      e.preventDefault();
      e.stopPropagation();
      clearItemNameOnly(rowIndex);
      return;
    }

    // Inline dropdown keyboard handling for item_code & item_name in MS Access Datasheet
    if (colName === 'item_code' || colName === 'item_name') {
      const isDropdownActive =
        showSearchDropdown && activeSearchRowIdx === rowIndex;

      if (e.key === 'Escape') {
        e.preventDefault();
        cancelledCodeEditRef.current = true;
        setShowSearchDropdown(false);
        setActiveSearchRowIdx(null);
        setEditingItemCode((prev) => (prev?.rowIdx === rowIndex ? null : prev));
        setEditingItemName((prev) => (prev?.rowIdx === rowIndex ? null : prev));
        setShowCompactHistoryPopup(false);
        return;
      }

      if (e.key === 'ArrowDown' && isDropdownActive && searchResults.length > 0) {
        e.preventDefault();
        setSearchHighlightIdx((prev) => {
          const next = Math.min(searchResults.length - 1, prev + 1);
          scrollSalesSearchRowIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp' && isDropdownActive && searchResults.length > 0) {
        e.preventDefault();
        setSearchHighlightIdx((prev) => {
          const next = Math.max(0, prev - 1);
          scrollSalesSearchRowIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (isDropdownActive && searchResults.length > 0) {
          const chosen = searchResults[searchHighlightIdx] || searchResults[0];
          if (chosen) {
            committedCodeEditRef.current = true;
            const rawDraft =
              colName === 'item_code' && editingItemCode?.rowIdx === rowIndex
                ? editingItemCode.value
                : editingItemName?.rowIdx === rowIndex
                ? editingItemName.value
                : '';
            const exact = findExactBarcodeOrCodeMatch([chosen], rawDraft);
            handleSelectFromTopSearch(chosen, rowIndex, exact?.variant || null);
            return;
          }
        }
        if (colName === 'item_code' && editingItemCode && editingItemCode.rowIdx === rowIndex) {
          committedCodeEditRef.current = true;
          const committed = commitItemCodeChange(rowIndex, editingItemCode.value, true);
          if (!committed && row?.item_id) {
            focusCell(rowIndex, 'quantity', 'cell');
          }
          return;
        }
        if (colName === 'item_name' && !row?.item_name?.trim()) {
          openItemListForRow(rowIndex);
          return;
        }
        if (row?.item_id) {
          focusCell(rowIndex, 'quantity', 'cell');
        } else {
          openItemListForRow(rowIndex);
        }
        return;
      }

      if (colName === 'item_code' && e.key === 'Tab' && editingItemCode && editingItemCode.rowIdx === rowIndex) {
        committedCodeEditRef.current = true;
        commitItemCodeChange(rowIndex, editingItemCode.value, false);
      }
    }

    if (e.key === 'Escape' && showCompactHistoryPopup) {
      e.preventDefault();
      e.stopPropagation();
      ctrlPriceHistoryArmedRef.current = false;
      setShowCompactHistoryPopup(false);
      return;
    }

    if (ctrlPriceHistoryArmedRef.current && e.ctrlKey && e.key !== 'Control') {
      ctrlPriceHistoryArmedRef.current = false;
      setShowCompactHistoryPopup(false);
    }

    // Ctrl while Sale Price field is focused -> Open Customer+Item History once per key press
    if (
      colName === 'unit_price' &&
      row?.item_id &&
      e.key === 'Control' &&
      !e.repeat &&
      !e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      ctrlPriceHistoryArmedRef.current = true;
      setSelectedRowIndex(rowIndex);
      fetchAndApplyItemHistory(
        rowIndex,
        Number(row.item_id || 0),
        customerAccountId,
        invoiceType,
        false,
        row.item_code,
        row.variant_id || null
      );
      setShowCompactHistoryPopup(true);
      return;
    }

    // Price column keyboard trigger in MS Access Datasheet -> Open Customer+Item Sales Price History
    if (colName === 'unit_price' && row?.item_id) {
      const ignoredKeys = new Set([
        'Enter', 'Tab', 'Escape',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown',
        'Backspace', 'Delete', 'Insert',
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
        'F1', 'F2', 'F3', 'F9',
      ]);
      const isTriggerKey =
        !e.ctrlKey &&
        !e.metaKey &&
        !ignoredKeys.has(e.key) &&
        !/^[0-9.\-]$/.test(e.key);
      if (isTriggerKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedRowIndex(rowIndex);
        setPriceHistoryModalState({
          isOpen: true,
          rowIndex,
          returnFocusId: `cell_${rowIndex}_unit_price`,
        });
        return;
      }
    }

    if (colName === 'line_total') {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        advanceToNextRowItemCode(rowIndex, 'access');
        return;
      }
      const amountVisualIdx = orderedSalesAccessColKeys.indexOf('amount');
      const colToFocusKey: Record<string, string> = {
        item_code: 'item_code',
        item_name: 'item_name',
        quantity: 'quantity',
        discount_1: 'discount_1_percent',
        discount_2: 'discount_2_percent',
        unit_price: 'unit_price',
        loose_quantity: 'loose_quantity',
        loose_rate: 'loose_rate',
        bonus_quantity: 'bonus_quantity',
        remarks: 'remarks',
      };
      const editableSet = new Set(rowEditableCols);
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        let nextEditable: string | null = null;
        for (let i = amountVisualIdx + 1; i < orderedSalesAccessColKeys.length; i++) {
          const fk = colToFocusKey[orderedSalesAccessColKeys[i]];
          if (fk && editableSet.has(fk)) {
            nextEditable = fk;
            break;
          }
        }
        if (nextEditable) {
          focusCell(rowIndex, nextEditable, 'cell');
        } else {
          advanceToNewRowItemSearch(rowIndex, 'access');
        }
        return;
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        let prevEditable: string | null = null;
        for (let i = amountVisualIdx - 1; i >= 0; i--) {
          const fk = colToFocusKey[orderedSalesAccessColKeys[i]];
          if (fk && editableSet.has(fk)) {
            prevEditable = fk;
            break;
          }
        }
        if (prevEditable) {
          focusCell(rowIndex, prevEditable, 'cell');
        } else if (rowEditableCols.length > 0) {
          focusCell(rowIndex, rowEditableCols[0], 'cell');
        }
        return;
      }
    }

    // Enter key -> Move in exact sequence: Item Selection -> Qty -> Discount -> Loose Qty -> Price -> Bonus Qty -> Loose Rate -> Next Row Item Search
    if (e.key === 'Enter') {
      e.preventDefault();
      setShowSearchDropdown(false);
      const currentEnterIdx = rowEditableCols.indexOf(colName);

      if (currentEnterIdx >= 0 && currentEnterIdx < rowEditableCols.length - 1) {
        const nextCol = rowEditableCols[currentEnterIdx + 1];
        focusCell(rowIndex, nextCol, 'cell');
      } else {
        // Completed the final field -> move to next empty row and focus Item Search
        advanceToNewRowItemSearch(rowIndex, 'access');
      }
      return;
    }

    // Tab / Shift+Tab navigation
    if (e.key === 'Tab') {
      setShowSearchDropdown(false);
      const curColIdx = rowEditableCols.indexOf(colName);
      if (!e.shiftKey) {
        if (curColIdx >= 0 && curColIdx < rowEditableCols.length - 1) {
          e.preventDefault();
          focusCell(rowIndex, rowEditableCols[curColIdx + 1], 'cell');
        } else {
          e.preventDefault();
          advanceToNewRowItemSearch(rowIndex, 'access');
        }
      } else {
        if (curColIdx > 0) {
          e.preventDefault();
          focusCell(rowIndex, rowEditableCols[curColIdx - 1], 'cell');
        } else if (curColIdx <= 0 && rowIndex > 0) {
          e.preventDefault();
          const prevCols = getEditableColsForRow(rows[rowIndex - 1], 'access');
          setSelectedRowIndex(rowIndex - 1);
          focusCell(rowIndex - 1, prevCols[prevCols.length - 1], 'cell');
        }
      }
      return;
    }

    // ArrowUp / ArrowDown / PageUp / PageDown across rows (Excel/Access vertical navigation)
    if (e.key === 'ArrowUp' && rowIndex > 0 && colName !== 'batch_number') {
      e.preventDefault();
      setShowSearchDropdown(false);
      setSelectedRowIndex(rowIndex - 1);
      focusCell(rowIndex - 1, colName, 'cell');
      return;
    }

    if (e.key === 'ArrowDown' && colName !== 'batch_number') {
      e.preventDefault();
      setShowSearchDropdown(false);
      if (rowIndex >= entryRowIdx) return;
      if (rowIndex < rows.length - 1) {
        setSelectedRowIndex(rowIndex + 1);
        focusCell(rowIndex + 1, colName, 'cell');
      } else {
        setRows((prev) => [...prev, createEmptyRow()]);
        setSelectedRowIndex(rowIndex + 1);
        setTimeout(() => {
          focusCell(rowIndex + 1, colName, 'cell');
        }, 25);
      }
      return;
    }

    if (e.key === 'PageUp') {
      e.preventDefault();
      setShowSearchDropdown(false);
      const target = Math.max(0, rowIndex - 5);
      setSelectedRowIndex(target);
      focusCell(target, colName, 'cell');
      return;
    }

    if (e.key === 'PageDown') {
      e.preventDefault();
      setShowSearchDropdown(false);
      const target = Math.min(entryRowIdx, rowIndex + 5);
      setSelectedRowIndex(target);
      focusCell(target, colName, 'cell');
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
      e.preventDefault();
      setShowSearchDropdown(false);
      setSelectedRowIndex(0);
      focusCell(0, 'item_code', 'cell');
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
      e.preventDefault();
      setShowSearchDropdown(false);
      const lastIdx = Math.max(0, entryRowIdx);
      setSelectedRowIndex(lastIdx);
      focusCell(lastIdx, colName, 'cell');
      return;
    }

    // ArrowLeft / ArrowRight across columns
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const target = e.currentTarget as HTMLInputElement;
      const isText = target.tagName === 'INPUT' && target.type === 'text';
      const atRightEdge =
        !isText || target.selectionStart === null || target.selectionStart >= (target.value?.length || 0);
      const atLeftEdge = !isText || target.selectionStart === null || target.selectionStart <= 0;

      const curColIdx = rowEditableCols.indexOf(colName);
      if (
        e.key === 'ArrowRight' &&
        atRightEdge &&
        curColIdx >= 0 &&
        curColIdx < rowEditableCols.length - 1
      ) {
        e.preventDefault();
        focusCell(rowIndex, rowEditableCols[curColIdx + 1], 'cell');
      } else if (e.key === 'ArrowLeft' && atLeftEdge && curColIdx > 0) {
        e.preventDefault();
        focusCell(rowIndex, rowEditableCols[curColIdx - 1], 'cell');
      }
    }
  };

  const handleOpenSalesItemMasterF9 = useCallback(async () => {
    const rowIdx = selectedRowIndex;
    const row = rows[rowIdx];
    const returnFocusId =
      document.activeElement?.id ||
      (invoiceViewMode === 'pos' ? `pos_row_${rowIdx}_quantity` : `cell_${rowIdx}_quantity`);

    if (!row || !row.item_id || Number(row.item_id) <= 0) {
      setErrorMsg('Please select an item on the current row before pressing F9 to open Item Master.');
      return;
    }

    setErrorMsg(null);
    setShowSearchDropdown(false);
    setShowCompactHistoryPopup(false);

    try {
      const res = await api.getItems({ q: row.item_code || row.item_name });
      const itemsArr: Item[] = Array.isArray((res as any)?.items)
        ? (res as any).items
        : Array.isArray((res as any)?.data)
        ? (res as any).data
        : [];
      const fullItem = itemsArr.find((it) => Number(it.id) === Number(row.item_id));
      if (fullItem && fullItem.id) {
        setF9ItemMasterState({
          isOpen: true,
          editingItem: fullItem,
          rowIndex: rowIdx,
          returnFocusId,
        });
        return;
      }
    } catch {
      // Fallback to catalog item below
    }

    const catItem = catalogItems.find((c) => Number(c.id) === Number(row.item_id));
    if (catItem) {
      setF9ItemMasterState({
        isOpen: true,
        editingItem: {
          id: Number(catItem.id),
          item_code: catItem.item_code || row.item_code,
          company_name: catItem.company_name || row.company_name,
          item_name: catItem.item_name || row.item_name,
          generic_name: catItem.generic_name || '',
          category: catItem.category || 'Tablet',
          packing: catItem.packing || row.packing || '1x1',
          barcode: catItem.barcode || row.barcode || '',
          purchase_price: Number(catItem.purchase_price || 0),
          trade_price: Number(catItem.trade_price || 0),
          wholesale_price: Number(catItem.wholesale_price || 0),
          retail_price: Number(catItem.retail_price || row.unit_price || 0),
          loose_rate: Number(catItem.loose_rate || row.loose_rate || 0),
          discount_percent: Number(catItem.discount_percent || 0),
          tax_type: catItem.tax_type || row.tax_type || 'percentage',
          tax_value: Number(catItem.tax_value ?? catItem.tax_percent ?? row.tax_value ?? row.tax_percent ?? 0),
          tax_percent: Number(catItem.tax_percent || row.tax_percent || 0),
          opening_stock: Number(catItem.opening_stock || 0),
          minimum_stock: Number(catItem.minimum_stock || 0),
          rack_number: catItem.rack_number || '',
          status: (catItem.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
          has_variants: Number(catItem.has_variants || 0),
          image_url: catItem.image_url || null,
          thumbnail_url: catItem.thumbnail_url || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        rowIndex: rowIdx,
        returnFocusId,
      });
    } else {
      setErrorMsg('Unable to load the selected item into Item Master.');
    }
  }, [selectedRowIndex, rows, invoiceViewMode, catalogItems]);

  // Global Keyboard Shortcuts (F2: Item Search, F3: Focus Search Bar, Ctrl+S: Save, Ctrl+P: Print, Ctrl+N: New, F9: Edit Selected Item in Item Master, Esc: Close Modals/Dropdown)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (
        pendingDuplicatePrompt ||
        pendingVariantPicker ||
        priceHistoryModalState.isOpen ||
        itemLogModalState.isOpen ||
        f9ItemMasterState.isOpen ||
        showEditSearchModal ||
        showDsrModal ||
        showSalesSmsModal ||
        printInvoice
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setShowCompactHistoryPopup(false);
        handleSaveInvoice('completed');
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (invoiceViewMode === 'pos' && rows[selectedRowIndex]?.item_id !== null) {
          openItemListForRow(null);
        } else {
          openItemListForRow(selectedRowIndex);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCompactHistoryPopup(false);
        handleSaveInvoice('completed', 'a4');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowCompactHistoryPopup(false);
        resetToNewInvoice();
      } else if (e.key === 'F3') {
        e.preventDefault();
        const targetSearch = posSearchInputRef.current || searchInputRef.current;
        targetSearch?.focus();
        targetSearch?.select?.();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowCompactHistoryPopup(false);
        setShowEditSearchModal(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        handleOpenSalesItemMasterF9();
      } else if (e.key === 'Escape') {
        if (showCompactHistoryPopup) {
          e.preventDefault();
          setShowCompactHistoryPopup(false);
        } else if (showItemListModal) {
          e.preventDefault();
          setShowItemListModal(false);
          setItemListTargetRowIdx(null);
        } else if (showSearchDropdown) {
          e.preventDefault();
          setShowSearchDropdown(false);
          setActiveSearchRowIdx(null);
        }
      }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        ctrlPriceHistoryArmedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    window.addEventListener('keyup', handleGlobalKeyUp);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
      window.removeEventListener('keyup', handleGlobalKeyUp);
    };
  }, [
    handleSaveInvoice,
    resetToNewInvoice,
    selectedRowIndex,
    showCompactHistoryPopup,
    showItemListModal,
    showSearchDropdown,
    pendingDuplicatePrompt,
    pendingVariantPicker,
    priceHistoryModalState.isOpen,
    itemLogModalState.isOpen,
    f9ItemMasterState.isOpen,
    handleOpenSalesItemMasterF9,
    showEditSearchModal,
    showDsrModal,
    showSalesSmsModal,
    printInvoice,
  ]);

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearchText.trim()) return true;
    const t = customerSearchText.toLowerCase();
    return (
      String(c.account_name || '').toLowerCase().includes(t) ||
      String(c.account_code || '').toLowerCase().includes(t) ||
      String(c.phone || '').toLowerCase().includes(t)
    );
  });

  const filteredSalesmen = salesmenList.filter((sm) => {
    if (!salesmanFilterText.trim()) return true;
    const t = salesmanFilterText.toLowerCase();
    const smDisplay = (sm.name || sm.full_name || '').toLowerCase();
    return smDisplay.includes(t) || sm.salesman_code.toLowerCase().includes(t);
  });

  const filteredDeliverymen = deliverymenList.filter((dm) => {
    if (!deliverymanFilterText.trim()) return true;
    const t = deliverymanFilterText.toLowerCase();
    return dm.name.toLowerCase().includes(t) || dm.deliveryman_code.toLowerCase().includes(t);
  });

  // Active row & its Customer-Specific Item History (never return cached entry for another customer)
  const activeRow = rows[selectedRowIndex] || rows[0];
  const activeVariantKey = Number(activeRow?.variant_id || 0);
  const activeCodeHistoryKey =
    customerAccountId > 0 && activeRow?.item_code
      ? `${activeRow.item_code.trim().toLowerCase()}_${customerAccountId}_${activeVariantKey}`
      : '';
  const activeIdHistoryKey =
    customerAccountId > 0 && activeRow?.item_id
      ? `${activeRow.item_id}_${customerAccountId}_${activeVariantKey}`
      : '';
  const activeItemHistory =
    customerAccountId > 0
      ? (activeCodeHistoryKey && itemHistoryMap[activeCodeHistoryKey]) ||
        (activeIdHistoryKey && itemHistoryMap[activeIdHistoryKey]) ||
        null
      : null;

  // POS Mode Helpers
  const handleQuickCash = (amt: number) => {
    setPaidAmountManuallyEdited(true);
    setPaidAmountInput(amt.toString());
  };

  const handleExactCash = () => {
    setPaidAmountManuallyEdited(true);
    const exact = totalReceivable > 0 ? totalReceivable : netInvoiceAmount;
    setPaidAmountInput(exact.toString());
  };

  const handleIncrementQty = (idx: number) => {
    const current = Number(rows[idx]?.quantity || 0);
    updateRowField(idx, 'quantity', current + 1);
  };

  const handleDecrementQty = (idx: number) => {
    const current = Number(rows[idx]?.quantity || 0);
    updateRowField(idx, 'quantity', current - 1);
  };

  const handleAddStripToRow = (idx: number, stripsCount: number = 1) => {
    const r = rows[idx];
    if (!r || isSyrupItem(r)) return;
    const catMatch = r.item_id
      ? catalogItems.find((c) => Number(c.id) === Number(r.item_id))
      : null;
    const configuredTabletsPerStrip = Number(
      catMatch?.tablets_per_strip || catMatch?.units_per_strip || r.units_per_strip || 1
    );
    const strip = configuredTabletsPerStrip > 1 ? configuredTabletsPerStrip : 1;
    updateRowField(idx, 'loose_quantity', Number(r.loose_quantity || 0) + strip * stripsCount);
  };

  const activeHasItem = Boolean(activeRow?.item_id && Number(activeRow.item_id) > 0);
  const posFullQtySum = round2(validRows.reduce((s, r) => s + Number(r.quantity || 0), 0));
  const posLooseQtySum = round2(validRows.reduce((s, r) => s + Number(r.loose_quantity || 0), 0));
  const isSalesNetReturn = netInvoiceAmount < 0;

  return (
    <div
      className={`${
        invoiceViewMode === 'pos'
          ? 'bg-[#F4F7F6] px-3 py-2 gap-2.5'
          : 'ams-readable-invoice-scope bg-slate-100 px-1.5 py-1 gap-1'
      } w-full h-full flex-1 min-h-0 flex flex-col overflow-hidden`}
      style={{ zoom: 1 }}
    >
      {/* Status Banners */}
      {errorMsg && (
        <div className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex flex-wrap items-center justify-between gap-2 text-xs shadow-sm shrink-0">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            {!allowNegativeStock && errorMsg.includes('Stock Shortage') && (
              <button
                type="button"
                onClick={() => handleToggleNegativeStock(true)}
                className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-sm"
              >
                <ShieldAlert className="w-3 h-3" />
                <span>Allow Negative Stock</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-600 hover:text-rose-900 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex flex-wrap items-center justify-between gap-2 text-xs shadow-sm shrink-0">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSuccessMsg(null);
                setLastSavedWhatsappPayload(null);
              }}
              className="text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ================= COMPACT TOP BAR & INTERFACE SWITCHER ================= */}
      <div
        className={`${
          invoiceViewMode === 'pos'
            ? 'rounded-xl px-3 py-1.5'
            : 'ams-pos-compact-chrome rounded-md px-2 py-0.5'
        } flex flex-wrap items-center justify-between gap-1.5 bg-slate-900 text-white border border-slate-700/80 shadow-xs shrink-0`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          )}
          <span className="font-black uppercase tracking-wider text-xs text-emerald-400">
            SALES INVOICE
          </span>
          <div className="inline-flex rounded-lg p-0.5 bg-slate-800 border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('pos')}
              className={`px-2.5 py-0.5 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'pos'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to POS View"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>1. POS View</span>
            </button>
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('access')}
              className={`px-2.5 py-0.5 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'access'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to MS Access Datasheet View"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>2. MS Access View</span>
            </button>
          </div>
          {onNavigateToSalesHistory && (
            <button
              type="button"
              onClick={onNavigateToSalesHistory}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Open Sales History"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span>History</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
          {/* Compact Excel Group (Excel Export, Custom Excel Export, Excel Import, All Excel) */}
          <div className="inline-flex items-center rounded-lg bg-slate-800 border border-slate-700 p-0.5 gap-1 shrink-0">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 ml-1.5 shrink-0" />
            <select
              value={selectedExcelAction}
              onChange={(e) =>
                setSelectedExcelAction(
                  e.target.value as 'current' | 'custom' | 'import' | 'all'
                )
              }
              aria-label="Excel Action Group"
              className="bg-slate-900 text-white font-bold text-xs px-2 py-0.5 rounded border border-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="current">Excel Export</option>
              <option value="custom">Custom Excel Export</option>
              <option value="import">Excel Import</option>
              <option value="all">All Sales Excel</option>
            </select>
            <button
              type="button"
              disabled={exportingExcel && selectedExcelAction !== 'import'}
              onClick={handleRunGroupedExcelAction}
              className="px-2.5 py-0.5 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title="Execute selected Excel action"
            >
              {selectedExcelAction === 'import' ? (
                <Upload className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{exportingExcel && selectedExcelAction !== 'import' ? 'Working...' : 'Go'}</span>
            </button>
          </div>
          <label
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border font-bold cursor-pointer transition-colors ${
              allowNegativeStock
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Allow selling items even when batch stock is 0 or negative"
          >
            <input
              type="checkbox"
              checked={allowNegativeStock}
              onChange={(e) => handleToggleNegativeStock(e.target.checked)}
              className="rounded text-amber-500 focus:ring-0 cursor-pointer"
            />
            <span>Neg Stock</span>
          </label>
          <button
            type="button"
            onClick={() => handleOpenCurrentInvoicePreview('a4')}
            className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Print Preview (A4 & Thermal)"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={handleOpenDsrReport}
            className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Open DSR Report"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>DSR</span>
          </button>
          <button
            type="button"
            onClick={handleOpenSalesSms}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Send Customer SMS"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>SMS</span>
          </button>
          <SimpleSyncStatusBar
            compact
            dark
            onSyncCompleted={refreshHeldInvoices}
            onManualSyncCompleted={loadReferenceData}
          />
          <span className="bg-slate-800 px-2 py-1 rounded-lg text-emerald-400 font-mono font-bold tabular-nums">
            {validRows.length} Items
          </span>
        </div>
      </div>

      {/* ================= OPTION 1: MODERN RETAIL / SUPERMARKET SALES POS WORKSTATION ================= */}
      {invoiceViewMode === 'pos' && (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 overflow-hidden">
          {/* LEFT WORKSPACE: SECTION A (HEADER) + SECTION B (ITEM ENTRY) + SECTION C (ITEMS TABLE) */}
          <div className="flex-1 min-w-0 flex flex-col gap-2.5 overflow-hidden">
            {/* SECTION A: INVOICE HEADER CARD */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-3.5 py-2.5 shrink-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Retail / Wholesale Mode */}
                  <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => handleInvoiceTypeChange('Retail')}
                      className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-colors ${
                        invoiceType === 'Retail'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Retail
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInvoiceTypeChange('Wholesale')}
                      className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-colors ${
                        invoiceType === 'Wholesale'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Wholesale
                    </button>
                  </div>

                  {/* Invoice Number */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                      Bill #
                    </span>
                    <span className="font-mono text-xs font-black text-slate-900 tabular-nums">
                      {invoiceNumber}
                    </span>
                  </div>

                  {editingSaleId ? (
                    <button
                      type="button"
                      onClick={resetToNewInvoice}
                      className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer"
                      title="Editing Saved Invoice — Click to Cancel / New Bill"
                    >
                      Edit #{editingSaleId} ✕
                    </button>
                  ) : null}

                  {/* Invoice Date */}
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="px-2.5 py-1 font-mono text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-emerald-500 cursor-pointer"
                    title="Invoice Date"
                  />
                </div>

                {/* Quick Utility Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as SalesPaymentMode)}
                    className="px-2.5 py-1 font-bold rounded-lg border border-slate-200 bg-slate-50 text-slate-900 outline-none focus:border-emerald-500 cursor-pointer"
                    title="Payment Mode"
                  >
                    <option value="Cash">Cash Sale</option>
                    <option value="Bank">Bank / Card</option>
                    <option value="Credit">Credit Bill</option>
                  </select>
                  <button
                    type="button"
                    onClick={resetToNewInvoice}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold flex items-center gap-1 cursor-pointer"
                    title="New Invoice (Ctrl+N)"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>New</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditSearchModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold flex items-center gap-1 cursor-pointer"
                    title="Find / Edit (Ctrl+E)"
                  >
                    <Pencil className="w-3.5 h-3.5 text-amber-700" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={openHeldDrawer}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold cursor-pointer"
                    title="Held Invoices"
                  >
                    Held ({heldInvoices.length})
                  </button>
                </div>
              </div>

              {/* Customer, Salesman, Delivery, Buyer Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-2 pt-2 border-t border-slate-100 items-end">
                <div className="xl:col-span-5 flex items-center gap-1.5 min-w-0">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                      Customer Account
                    </label>
                    <select
                      value={customerAccountId}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        handleSelectCustomerAccount(id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setTimeout(() => {
                            focusNewRowItemSearch();
                          }, 25);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.key === 'Enter') {
                          focusNewRowItemSearch();
                        }
                      }}
                      className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
                    >
                      <option value={0}>Walk-in Cash Customer</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          [{c.account_code}] {c.account_name} {c.town_name ? `• ${c.town_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customerAccountId > 0 && (
                    <button
                      type="button"
                      onClick={() => openCustomerShortcut('ledger')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 font-mono text-xs font-bold cursor-pointer shrink-0 tabular-nums"
                      title="Open Customer Ledger"
                    >
                      Bal: {formatPKR(Math.abs(prevCustomerBalance))}
                    </button>
                  )}
                </div>

                <div className="xl:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Salesman
                  </label>
                  <select
                    value={salesmanId || ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      setSalesmanId(id);
                      const sm = salesmenList.find((s) => s.id === id);
                      if (sm) setSalesman(sm.name);
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 outline-none"
                  >
                    <option value="">Counter Pharmacist</option>
                    {salesmenList.map((sm) => (
                      <option key={sm.id} value={sm.id}>
                        {sm.name || sm.full_name} ({sm.salesman_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="xl:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Delivery
                  </label>
                  <select
                    value={deliverymanId || ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      setDeliverymanId(id);
                      const dm = deliverymenList.find((d) => d.id === id);
                      if (dm) setDeliverymanName(dm.name);
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 outline-none"
                  >
                    <option value="">Counter Pickup</option>
                    {deliverymenList.map((dm) => (
                      <option key={dm.id} value={dm.id}>
                        {dm.name} ({dm.deliveryman_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="xl:col-span-2">
                  <label
                    htmlFor="pos_buyer_name_input"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5"
                  >
                    Buyer / Patient
                  </label>
                  <input
                    id="pos_buyer_name_input"
                    type="text"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="Walk-in buyer name..."
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white text-slate-900 font-semibold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* SECTION B: ITEM SEARCH & QUICK ENTRY STRIP */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-3.5 py-2.5 shrink-0 space-y-2.5">
              {/* Top Barcode Search & Company Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[240px]">
                  <Barcode className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="pos_item_search_input"
                    ref={posSearchInputRef}
                    type="text"
                    value={quickSearchQuery}
                    onFocus={() => {
                      setActiveSearchRowIdx(null);
                      if (quickSearchQuery.trim().length > 0 || selectedCompanyFilter) {
                        setShowSearchDropdown(true);
                        runFastSearch(quickSearchQuery);
                      } else {
                        setShowSearchDropdown(false);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowSearchDropdown(false);
                      }, 160);
                    }}
                    onChange={(e) => {
                      const q = e.target.value;
                      setActiveSearchRowIdx(null);
                      setQuickSearchQuery(q);
                      if (q.trim().length > 0 || selectedCompanyFilter) {
                        setShowSearchDropdown(true);
                        runFastSearch(q);
                      } else {
                        setShowSearchDropdown(false);
                        setSearchResults([]);
                        setActiveSearchRowIdx(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        if (quickSearchQuery.trim().length === 0 && !selectedCompanyFilter) return;
                        e.preventDefault();
                        if (!showSearchDropdown) {
                          setShowSearchDropdown(true);
                          runFastSearch(quickSearchQuery);
                          return;
                        }
                        setSearchHighlightIdx((prev) => {
                          const next = Math.min(Math.max(0, searchResults.length - 1), prev + 1);
                          scrollSalesSearchRowIntoView(next);
                          return next;
                        });
                      } else if (e.key === 'ArrowUp') {
                        if (quickSearchQuery.trim().length === 0 && !selectedCompanyFilter) return;
                        e.preventDefault();
                        setSearchHighlightIdx((prev) => {
                          const next = Math.max(0, prev - 1);
                          scrollSalesSearchRowIntoView(next);
                          return next;
                        });
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const qTrim = quickSearchQuery.trim();
                        if (qTrim.length > 0) {
                          const exactLocal = findExactBarcodeOrCodeMatch(companyFilteredCatalogItems, qTrim);
                          if (
                            exactLocal &&
                            (exactLocal.matchType === 'variant' ||
                              exactLocal.item.barcode?.toLowerCase() === qTrim.toLowerCase())
                          ) {
                            handleSelectFromTopSearch(exactLocal.item, undefined, exactLocal.variant || null);
                            return;
                          }
                          if (showSearchDropdown && searchResults.length > 0) {
                            const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                            if (chosen) {
                              const exactChosen = findExactBarcodeOrCodeMatch([chosen], qTrim);
                              handleSelectFromTopSearch(chosen, undefined, exactChosen?.variant || null);
                              return;
                            }
                          }
                          api
                            .lookupBarcodeExact(qTrim)
                            .then(async (res) => {
                              if (res?.matched && res.item) {
                                const freshSearch = await api
                                  .fastSearchSalesItems(res.item.item_code || qTrim, 10)
                                  .catch(() => null);
                                const hydrated: FastSearchItem | undefined = (
                                  freshSearch?.data ||
                                  freshSearch?.items ||
                                  []
                                ).find((it: FastSearchItem) => Number(it.id) === Number(res.item!.id));
                                if (hydrated) {
                                  setCatalogItems((prev) =>
                                    prev.some((c) => Number(c.id) === Number(hydrated.id))
                                      ? prev
                                      : [...prev, hydrated]
                                  );
                                  if (
                                    selectedCompanyFilter &&
                                    !matchesSelectedCompany(hydrated.company_name, selectedCompanyFilter)
                                  ) {
                                    setErrorMsg(
                                      `Item "${hydrated.item_name}" belongs to "${hydrated.company_name || 'another company'}", not selected company "${selectedCompanyFilter}".`
                                    );
                                    return;
                                  }
                                  const resolvedVar = res.variant
                                    ? hydrated.variants?.find((v) => Number(v.id) === Number(res.variant!.id)) ||
                                      res.variant
                                    : null;
                                  handleSelectFromTopSearch(hydrated, undefined, resolvedVar);
                                }
                              }
                            })
                            .catch(() => null);
                          return;
                        }
                        focusCell(selectedRowIndex, 'item_name', 'pos_row');
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setShowSearchDropdown(false);
                      }
                    }}
                    placeholder={
                      selectedCompanyFilter
                        ? `Scan barcode or search items in ${selectedCompanyFilter} (F3)...`
                        : 'Scan barcode, item code, medicine name, or generic (F3)...'
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                  />
                  {renderSalesExcelItemCombobox('top')}
                </div>

                <div className="flex items-center gap-1 min-w-[165px]">
                  <select
                    id="pos_sales_company_filter"
                    aria-label="Filter items by Company"
                    value={selectedCompanyFilter}
                    onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                    className={`w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border outline-none cursor-pointer ${
                      selectedCompanyFilter
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    <option value="">All Companies</option>
                    {companyOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {selectedCompanyFilter && (
                    <button
                      type="button"
                      onClick={() => setSelectedCompanyFilter('')}
                      title="Clear Company Filter"
                      aria-label="Clear Company Filter"
                      className="px-2 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-100 text-emerald-800 font-bold text-xs cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => openItemListForRow(rows[selectedRowIndex]?.item_id ? null : selectedRowIndex)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                  title="Open Item Catalog (F2)"
                >
                  <PackageSearch className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Item Catalog (F2)</span>
                </button>
              </div>

              {/* Synchronized Active Line Quick-Entry Inspector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-12 gap-2 pt-2 border-t border-slate-100 items-end">
                <div className="col-span-2 sm:col-span-2 xl:col-span-2 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                    Active Item #{selectedRowIndex + 1}
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 truncate">
                    {activeHasItem ? (
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {activeRow.item_name}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500 shrink-0 truncate max-w-[70px]">
                          {activeRow.company_name || '—'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">
                        Scan or pick an item above...
                      </span>
                    )}
                  </div>
                </div>

                <div className="xl:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Full Qty
                  </label>
                  <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:border-emerald-600">
                    <button
                      type="button"
                      disabled={!activeHasItem}
                      onClick={() => handleDecrementQty(selectedRowIndex)}
                      className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs border-r border-slate-200 cursor-pointer disabled:opacity-40"
                      title="Decrease Full Qty (allows negative returns)"
                    >
                      −
                    </button>
                    <NumericInput
                      id="pos_active_quantity"
                      allowNegative={true}
                      disabled={!activeHasItem}
                      displayZero={activeHasItem}
                      value={activeHasItem ? activeRow.quantity : 0}
                      onChange={(e) => updateRowField(selectedRowIndex, 'quantity', e.target.value)}
                      onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'quantity', false)}
                      className="w-full px-1.5 py-1 text-center font-mono font-bold text-xs text-slate-900 bg-transparent outline-none disabled:opacity-40"
                    />
                    <button
                      type="button"
                      disabled={!activeHasItem}
                      onClick={() => handleIncrementQty(selectedRowIndex)}
                      className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs border-l border-slate-200 cursor-pointer disabled:opacity-40"
                      title="Increase Full Qty"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-teal-700 mb-0.5">
                    Loose Qty
                  </label>
                  <NumericInput
                    id="pos_active_loose_quantity"
                    allowNegative={true}
                    disabled={!activeHasItem || isSyrupItem(activeRow)}
                    displayZero={activeHasItem && !isSyrupItem(activeRow)}
                    value={activeHasItem && !isSyrupItem(activeRow) ? activeRow.loose_quantity : 0}
                    onChange={(e) => updateRowField(selectedRowIndex, 'loose_quantity', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'loose_quantity', false)}
                    className="w-full px-2 py-1 text-right font-mono font-bold text-xs text-teal-950 rounded-lg border border-teal-300 bg-teal-50/40 focus:bg-white focus:border-teal-600 outline-none disabled:opacity-40"
                  />
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Sale Rate
                  </label>
                  <NumericInput
                    id="pos_active_unit_price"
                    disabled={!activeHasItem}
                    value={activeHasItem ? activeRow.unit_price : 0}
                    onChange={(e) => updateRowField(selectedRowIndex, 'unit_price', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'unit_price', false)}
                    className="w-full px-2 py-1 text-right font-mono font-bold text-xs text-slate-900 rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none disabled:opacity-40"
                  />
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Disc 1 %
                  </label>
                  <NumericInput
                    id="pos_active_discount_1_percent"
                    disabled={!activeHasItem}
                    value={activeHasItem ? activeRow.discount_1_percent : 0}
                    onChange={(e) => updateRowField(selectedRowIndex, 'discount_1_percent', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'discount_1_percent', false)}
                    className="w-full px-2 py-1 text-right font-mono font-semibold text-xs text-slate-800 rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none disabled:opacity-40"
                  />
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Disc 2 %
                  </label>
                  <NumericInput
                    id="pos_active_discount_2_percent"
                    disabled={!activeHasItem}
                    value={activeHasItem ? activeRow.discount_2_percent : 0}
                    onChange={(e) => updateRowField(selectedRowIndex, 'discount_2_percent', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'discount_2_percent', false)}
                    className="w-full px-2 py-1 text-right font-mono font-semibold text-xs text-slate-800 rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none disabled:opacity-40"
                  />
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-0.5">
                    Net Rate
                  </label>
                  <div
                    className="px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50/70 text-right font-mono font-bold text-xs text-indigo-950 tabular-nums truncate"
                    title={
                      activeHasItem
                        ? `Net Rate after sequential discounts: Rs. ${Number(activeRow.net_rate || 0).toFixed(2)}`
                        : 'Net Rate (read-only)'
                    }
                  >
                    {activeHasItem ? Number(activeRow.net_rate || 0).toFixed(2) : '0.00'}
                  </div>
                </div>

                <div className="xl:col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Tax
                  </label>
                  <div
                    className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-right font-mono font-semibold text-xs text-amber-800 tabular-nums truncate"
                    title={
                      activeHasItem
                        ? activeRow.tax_type === 'amount'
                          ? `Fixed Tax: Rs. ${Number(activeRow.tax_value || 0).toFixed(2)}/unit`
                          : `Tax: ${Number(activeRow.tax_value ?? activeRow.tax_percent ?? 0).toFixed(2)}% on Gross`
                        : 'Item Tax'
                    }
                  >
                    {activeHasItem
                      ? `${Number(activeRow.tax_amount || 0) >= 0 ? '' : '-'}${Math.abs(Number(activeRow.tax_amount || 0)).toFixed(0)}`
                      : '0'}
                  </div>
                </div>

                <div className="col-span-2 xl:col-span-2 flex items-end justify-between gap-2">
                  <div className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-right">
                    <div className="text-[9.5px] uppercase tracking-wider text-slate-400">
                      Amount
                    </div>
                    <div
                      className={`font-mono font-black text-xs tabular-nums ${
                        Number(activeRow?.line_total || 0) < 0
                          ? 'text-rose-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      {activeHasItem ? formatPKR(Number(activeRow.line_total || 0)) : 'Rs. 0'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleInsertRow}
                    className="px-2.5 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold cursor-pointer shrink-0 transition-colors"
                    title="Jump to New Blank Row"
                  >
                    + Row
                  </button>
                </div>
              </div>
            </div>

            {/* SECTION C: MODERN INVOICE ITEMS TABLE */}
            <div
              onKeyDownCapture={(e) => {
                if (
                  e.shiftKey &&
                  e.key === 'Delete' &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.metaKey
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  requestDatasheetDeleteConfirm(selectedRowIndex);
                  return;
                }
                if (
                  e.shiftKey &&
                  (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.metaKey
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const activeElId = (document.activeElement as HTMLElement | null)?.id || '';
                  const m = activeElId.match(/^pos_row_(\d+)_(.+)$/);
                  const curRow = m ? Number(m[1]) : selectedRowIndex;
                  const curCol = m ? m[2] : 'item_name';
                  const anchor = rowSelectionAnchorRef.current ?? curRow;
                  if (rowSelectionAnchorRef.current === null) rowSelectionAnchorRef.current = anchor;
                  const delta = e.key === 'ArrowDown' ? 1 : -1;
                  const nextRow = Math.max(0, Math.min(entryRowIdx, rows.length - 1, curRow + delta));
                  setSelectedColKeys([]);
                  colSelectionAnchorRef.current = null;
                  setSelectedRowRange({ start: anchor, end: nextRow });
                  setSelectedRowIndex(nextRow);
                  focusCell(nextRow, curCol, 'pos_row');
                  return;
                }
                if (
                  e.key === 'Escape' &&
                  !showSearchDropdown &&
                  !showCompactHistoryPopup &&
                  (selectedRowRange !== null || selectedColKeys.length > 0)
                ) {
                  setSelectedRowRange(null);
                  rowSelectionAnchorRef.current = null;
                  setSelectedColKeys([]);
                  colSelectionAnchorRef.current = null;
                }
              }}
              className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col flex-1 min-h-[260px] relative z-10"
            >
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-white">
                <table
                  style={{ width: `${posTotalWidth}px` }}
                  className="table-fixed text-left text-xs border-collapse"
                >
                  <colgroup>
                    <col style={{ width: `${posColWidths.selector}px` }} />
                    <col style={{ width: `${posColWidths.item_code}px` }} />
                    <col style={{ width: `${posColWidths.company}px` }} />
                    <col style={{ width: `${posColWidths.item_name}px` }} />
                    <col style={{ width: `${posColWidths.quantity}px` }} />
                    <col style={{ width: `${posColWidths.loose_quantity}px` }} />
                    <col style={{ width: `${posColWidths.unit_price}px` }} />
                    <col style={{ width: `${posColWidths.loose_rate}px` }} />
                    <col style={{ width: `${posColWidths.discount_1}px` }} />
                    <col style={{ width: `${posColWidths.discount_2}px` }} />
                    <col style={{ width: `${posColWidths.net_rate}px` }} />
                    <col style={{ width: `${posColWidths.bonus_quantity}px` }} />
                    <col style={{ width: `${posColWidths.gross_amount}px` }} />
                    <col style={{ width: `${posColWidths.tax}px` }} />
                    <col style={{ width: `${posColWidths.amount}px` }} />
                    <col style={{ width: `${posColWidths.roi}px` }} />
                    <col style={{ width: `${posColWidths.remarks}px` }} />
                    <col style={{ width: `${posColWidths.actions}px` }} />
                  </colgroup>
                  <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 text-slate-600 text-[10.5px] font-bold uppercase tracking-wider select-none">
                    <tr className="h-9">
                      {(
                        [
                          { key: 'selector', label: '#', cls: 'py-2 px-2 text-center border-r border-slate-200' },
                          { key: 'item_code', label: 'Code', cls: 'py-2 px-2 border-r border-slate-200' },
                          { key: 'company', label: 'Company', cls: 'py-2 px-2 border-r border-slate-200' },
                          { key: 'item_name', label: 'Item Name', cls: 'py-2 px-2.5 border-r border-slate-200' },
                          { key: 'quantity', label: 'Full Qty', cls: 'py-2 px-2 text-right bg-emerald-50/70 text-emerald-900 border-r border-slate-200' },
                          { key: 'loose_quantity', label: 'Loose Qty', cls: 'py-2 px-2 text-right bg-teal-50/70 text-teal-900 border-r border-slate-200' },
                          { key: 'unit_price', label: 'Rate', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'loose_rate', label: 'Loose Rate', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'discount_1', label: 'Disc 1 %', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'discount_2', label: 'Disc 2 %', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'net_rate', label: 'Net Rate', cls: 'py-2 px-2 text-right bg-indigo-50/70 text-indigo-900 border-r border-slate-200' },
                          { key: 'bonus_quantity', label: 'Bonus', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'gross_amount', label: 'Gross', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'tax', label: 'Tax', cls: 'py-2 px-2 text-right border-r border-slate-200' },
                          { key: 'amount', label: 'Amount', cls: 'py-2 px-2 text-right bg-slate-100 text-slate-900 font-extrabold border-r border-slate-200' },
                          { key: 'roi', label: 'ROI', cls: 'py-2 px-2 text-right bg-emerald-50/80 text-emerald-900 font-extrabold border-r border-slate-200' },
                          { key: 'remarks', label: 'Remarks', cls: 'py-2 px-2 border-r border-slate-200' },
                          { key: 'actions', label: '', cls: 'py-2 px-1.5 text-center' },
                        ] as const
                      ).map((col) => {
                        const isColSelected = selectedColKeys.includes(col.key);
                        const isSelectableCol = col.key !== 'selector' && col.key !== 'actions';
                        return (
                          <th
                            key={col.key}
                            onMouseDown={(e) => handleColHeaderMouseDown(col.key, SALES_POS_COL_KEYS, e)}
                            onMouseEnter={() => handleColHeaderMouseEnter(col.key, SALES_POS_COL_KEYS)}
                            style={{ width: `${posColWidths[col.key]}px` }}
                            title={
                              isSelectableCol
                                ? 'Click or drag to select column(s) · Press Shift+Delete to clear column values'
                                : undefined
                            }
                            className={`${col.cls} ${
                              isSelectableCol ? 'cursor-pointer hover:bg-sky-50' : ''
                            } ${
                              isColSelected
                                ? '!bg-sky-100 !text-sky-900 ring-1 ring-inset ring-sky-400'
                                : ''
                            } relative whitespace-nowrap overflow-hidden text-ellipsis`}
                          >
                            <span className="truncate block">{col.label}</span>
                            <div
                              onMouseDown={(e) => handlePosColResizeMouseDown(col.key, e)}
                              onDoubleClick={(e) => handleResetPosColWidth(col.key, e)}
                              title="Drag border to resize column (double-click to reset)"
                              className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors ${
                                posResizingCol === col.key ? 'bg-emerald-600' : 'hover:bg-emerald-400/70'
                              }`}
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, rIdx) => {
                      if (isGhostRow(rIdx)) {
                        return (
                          <tr key={row.row_id} className="h-9 border-b border-slate-100 bg-slate-50/30 select-none">
                            <td className="py-1 px-1.5 text-center font-mono text-[11px] text-slate-300 border-r border-slate-100">
                              {rIdx + 1}
                            </td>
                            <td colSpan={17} />
                          </tr>
                        );
                      }
                      const isSelected = rIdx === selectedRowIndex;
                      const isMultiRowSelected = isRowInSelectionRange(rIdx);
                      const isActiveSearchMatch = invoiceSearchActiveRow === rIdx;
                      const isSearchMatch = invoiceSearchMatchedRows.includes(rIdx);
                      const hasItem = row.item_id !== null && Number(row.item_id) > 0;
                      const isZeroQty =
                        hasItem &&
                        Number(row.quantity || 0) === 0 &&
                        Number(row.loose_quantity || 0) === 0;
                      const isZeroNet = hasItem && round2(Number(row.line_total || 0)) === 0;
                      const isNegativeLine =
                        hasItem &&
                        (Number(row.quantity || 0) < 0 || Number(row.loose_quantity || 0) < 0);
                      const colHighlight = (colKey: string) =>
                        selectedColKeys.includes(colKey)
                          ? '!bg-sky-100/70 ring-1 ring-inset ring-sky-300'
                          : '';

                      return (
                        <tr
                          key={row.row_id}
                          data-sales-row-idx={rIdx}
                          data-zero-qty={isZeroQty ? 'true' : 'false'}
                          data-zero-net={isZeroNet ? 'true' : 'false'}
                          onMouseEnter={() => handleRowSelectorMouseEnter(rIdx)}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              const anchor = rowSelectionAnchorRef.current ?? selectedRowIndex;
                              rowSelectionAnchorRef.current = anchor;
                              setSelectedColKeys([]);
                              colSelectionAnchorRef.current = null;
                              setSelectedRowRange({ start: anchor, end: rIdx });
                            } else {
                              setSelectedRowRange(null);
                              rowSelectionAnchorRef.current = null;
                            }
                            setSelectedRowIndex(rIdx);
                          }}
                          className={`cursor-pointer transition-colors h-10 ${
                            isMultiRowSelected
                              ? 'bg-sky-50 ring-1 ring-inset ring-sky-400'
                              : isActiveSearchMatch
                              ? 'bg-amber-100 ring-2 ring-inset ring-amber-400'
                              : isSearchMatch
                              ? 'bg-sky-50/70'
                              : isNegativeLine
                              ? 'bg-rose-50/70 hover:bg-rose-100/60'
                              : isZeroQty && hasItem
                              ? 'bg-amber-50/60 hover:bg-amber-100/50'
                              : isSelected
                              ? 'bg-emerald-50/80'
                              : 'bg-white hover:bg-slate-50/80'
                          }`}
                        >
                          <td
                            onMouseDown={(e) => handleRowSelectorMouseDown(rIdx, e)}
                            title="Click or drag down to select multiple rows · Press Shift+Delete to delete"
                            className={`py-1 px-1.5 text-center font-mono text-[11px] border-r border-slate-100 align-middle select-none cursor-pointer ${
                              isMultiRowSelected
                                ? 'bg-sky-600 text-white font-bold'
                                : isSelected
                                ? 'text-emerald-700 font-black'
                                : 'text-slate-400 hover:bg-slate-100'
                            }`}
                          >
                            {isMultiRowSelected ? `✓ ${rIdx + 1}` : isSelected ? `▶ ${rIdx + 1}` : rIdx + 1}
                          </td>

                          {/* Code */}
                          <td className={`p-1 border-r border-slate-100 align-middle whitespace-nowrap relative ${colHighlight('item_code')}`}>
                            <input
                              id={`pos_row_${rIdx}_item_code`}
                              type="text"
                              value={
                                editingItemCode?.rowIdx === rIdx
                                  ? editingItemCode.value
                                  : row.item_code || ''
                              }
                              onFocus={() => {
                                setSelectedRowIndex(rIdx);
                                setShowSearchDropdown(false);
                                cancelledCodeEditRef.current = false;
                                committedCodeEditRef.current = false;
                              }}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedRowIndex(rIdx);
                                committedCodeEditRef.current = false;
                                setEditingItemCode({ rowIdx: rIdx, value: val });
                                if (val.trim().length > 0) {
                                  setActiveSearchRowIdx(rIdx);
                                  setShowSearchDropdown(true);
                                  runFastSearch(val);
                                } else {
                                  setShowSearchDropdown(false);
                                  setSearchResults([]);
                                  setActiveSearchRowIdx(null);
                                }
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  setShowSearchDropdown(false);
                                  setActiveSearchRowIdx((prev) => (prev === rIdx ? null : prev));
                                  if (cancelledCodeEditRef.current || committedCodeEditRef.current) {
                                    cancelledCodeEditRef.current = false;
                                    committedCodeEditRef.current = false;
                                    setEditingItemCode((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                    return;
                                  }
                                  if (editingItemCode && editingItemCode.rowIdx === rIdx) {
                                    commitItemCodeChange(rIdx, editingItemCode.value, false);
                                  }
                                }, 160);
                              }}
                              onKeyDown={(e) => {
                                const isDropdownActive =
                                  showSearchDropdown && activeSearchRowIdx === rIdx;
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelledCodeEditRef.current = true;
                                  setShowSearchDropdown(false);
                                  setActiveSearchRowIdx(null);
                                  setEditingItemCode((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                  setShowCompactHistoryPopup(false);
                                  return;
                                }
                                if (e.key === 'ArrowDown' && isDropdownActive && searchResults.length > 0) {
                                  e.preventDefault();
                                  setSearchHighlightIdx((prev) => {
                                    const next = Math.min(searchResults.length - 1, prev + 1);
                                    scrollSalesSearchRowIntoView(next);
                                    return next;
                                  });
                                  return;
                                }
                                if (e.key === 'ArrowUp' && isDropdownActive && searchResults.length > 0) {
                                  e.preventDefault();
                                  setSearchHighlightIdx((prev) => {
                                    const next = Math.max(0, prev - 1);
                                    scrollSalesSearchRowIntoView(next);
                                    return next;
                                  });
                                  return;
                                }
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (isDropdownActive && searchResults.length > 0) {
                                    const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                                    if (chosen) {
                                      committedCodeEditRef.current = true;
                                      const exact =
                                        editingItemCode?.rowIdx === rIdx
                                          ? findExactBarcodeOrCodeMatch([chosen], editingItemCode.value)
                                          : null;
                                      handleSelectFromTopSearch(chosen, rIdx, exact?.variant || null);
                                      return;
                                    }
                                  }
                                  if (editingItemCode && editingItemCode.rowIdx === rIdx) {
                                    committedCodeEditRef.current = true;
                                    const ok = commitItemCodeChange(rIdx, editingItemCode.value, true);
                                    if (!ok && row.item_id) {
                                      focusCell(rIdx, 'quantity', 'pos_row');
                                    }
                                  } else if (row.item_id) {
                                    focusCell(rIdx, 'quantity', 'pos_row');
                                  } else {
                                    focusCell(rIdx, 'item_name', 'pos_row');
                                  }
                                }
                              }}
                              placeholder="Code..."
                              className="w-full px-1.5 py-1 font-mono font-bold text-emerald-800 text-xs bg-transparent focus:bg-white rounded border border-transparent focus:border-emerald-500 outline-none"
                            />
                          </td>

                          {/* Company */}
                          <td
                            className={`p-1 text-slate-600 border-r border-slate-100 align-middle overflow-hidden ${colHighlight('company')}`}
                            title={hasItem ? row.company_name : selectedCompanyFilter || 'All Companies'}
                          >
                            {hasItem ? (
                              <div className="px-1.5 truncate text-xs font-medium">{row.company_name || '—'}</div>
                            ) : (
                              <select
                                aria-label={`Row ${rIdx + 1} Company Filter`}
                                value={selectedCompanyFilter}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                                className={`w-full px-1 py-1 text-xs font-semibold bg-transparent focus:bg-white rounded border border-transparent focus:border-emerald-500 outline-none truncate ${
                                  selectedCompanyFilter ? 'text-emerald-800' : 'text-slate-500'
                                }`}
                              >
                                <option value="">All Companies</option>
                                {companyOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Item Name */}
                          <td className={`p-1 border-r border-slate-100 align-middle relative ${colHighlight('item_name')}`}>
                            <div className="flex items-center gap-1.5">
                              {row.item_id !== null && row.variant_thumbnail_url && (
                                <ProductThumb
                                  src={row.variant_thumbnail_url}
                                  alt={row.item_name}
                                  size="xs"
                                  className="!w-5 !h-5 !rounded border-0 shrink-0"
                                />
                              )}
                              <input
                                id={`pos_row_${rIdx}_item_name`}
                                type="text"
                                value={
                                  editingItemName?.rowIdx === rIdx
                                    ? editingItemName.value
                                    : formatItemNameWithRemarks(row.item_name, row.remarks)
                                }
                                onFocus={() => {
                                  setSelectedRowIndex(rIdx);
                                  if (!row.item_id && selectedCompanyFilter) {
                                    setActiveSearchRowIdx(rIdx);
                                    setShowSearchDropdown(true);
                                    runFastSearch('');
                                  } else {
                                    setShowSearchDropdown(false);
                                  }
                                  if (row.item_code || row.item_id) {
                                    fetchAndApplyItemHistory(
                                      rIdx,
                                      Number(row.item_id || 0),
                                      customerAccountId,
                                      invoiceType,
                                      false,
                                      row.item_code,
                                      row.variant_id || null
                                    );
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  if (!row.item_id) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowSearchDropdown(false);
                                  setEditingItemName(null);
                                  setItemLogModalState({
                                    isOpen: true,
                                    itemId: row.item_id,
                                    itemCode: row.item_code,
                                    itemName: row.item_name,
                                    returnFocusId: `pos_row_${rIdx}_item_name`,
                                  });
                                }}
                                title={
                                  row.item_id
                                    ? `${formatItemNameWithRemarks(row.item_name, row.remarks)}${row.variant_name ? ` — ${row.variant_name}` : ''}${row.packing ? ` [${row.packing}]` : ''} — Double-click to open Complete ITEM LOG`
                                    : selectedCompanyFilter
                                    ? `Type Item Name / Code in ${selectedCompanyFilter} (or F2)`
                                    : 'Type Item Name / Code (or F2)'
                                }
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSelectedRowIndex(rIdx);
                                  setEditingItemName({ rowIdx: rIdx, value: val });
                                  if (val.trim().length > 0 || selectedCompanyFilter) {
                                    setActiveSearchRowIdx(rIdx);
                                    setShowSearchDropdown(true);
                                    runFastSearch(val);
                                  } else {
                                    setShowSearchDropdown(false);
                                    setSearchResults([]);
                                    setActiveSearchRowIdx(null);
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setEditingItemName((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                    setShowSearchDropdown(false);
                                    setActiveSearchRowIdx((prev) => (prev === rIdx ? null : prev));
                                  }, 160);
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    !e.ctrlKey &&
                                    !e.altKey &&
                                    !e.metaKey &&
                                    !e.shiftKey &&
                                    (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')
                                  ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    clearItemNameOnly(rIdx);
                                    return;
                                  }
                                  const isDropdownActive =
                                    showSearchDropdown && activeSearchRowIdx === rIdx;
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingItemName((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                    setShowSearchDropdown(false);
                                    setActiveSearchRowIdx(null);
                                    setShowCompactHistoryPopup(false);
                                    return;
                                  }
                                  if (e.key === 'ArrowDown' && isDropdownActive) {
                                    e.preventDefault();
                                    if (searchResults.length > 0) {
                                      setSearchHighlightIdx((prev) => {
                                        const next = Math.min(searchResults.length - 1, prev + 1);
                                        scrollSalesSearchRowIntoView(next);
                                        return next;
                                      });
                                    }
                                    return;
                                  }
                                  if (e.key === 'ArrowUp' && isDropdownActive) {
                                    e.preventDefault();
                                    if (searchResults.length > 0) {
                                      setSearchHighlightIdx((prev) => {
                                        const next = Math.max(0, prev - 1);
                                        scrollSalesSearchRowIntoView(next);
                                        return next;
                                      });
                                    }
                                    return;
                                  }
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (isDropdownActive && searchResults.length > 0) {
                                      const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                                      if (chosen) {
                                        const exact =
                                          editingItemName?.rowIdx === rIdx
                                            ? findExactBarcodeOrCodeMatch([chosen], editingItemName.value)
                                            : null;
                                        handleSelectFromTopSearch(chosen, rIdx, exact?.variant || null);
                                        return;
                                      }
                                    }
                                    if (!row.item_name?.trim()) {
                                      openItemListForRow(rIdx);
                                      return;
                                    }
                                    if (row.item_id) {
                                      focusCell(rIdx, 'quantity', 'pos_row');
                                    } else {
                                      openItemListForRow(rIdx);
                                    }
                                  } else if (e.key === 'Tab' && !e.shiftKey && row.item_id) {
                                    e.preventDefault();
                                    focusCell(rIdx, 'quantity', 'pos_row');
                                  } else if (e.key === 'ArrowUp' && rIdx > 0) {
                                    e.preventDefault();
                                    setSelectedRowIndex(rIdx - 1);
                                    focusCell(rIdx - 1, 'item_name', 'pos_row');
                                  } else if (e.key === 'ArrowDown' && rIdx < entryRowIdx) {
                                    e.preventDefault();
                                    setSelectedRowIndex(rIdx + 1);
                                    focusCell(rIdx + 1, 'item_name', 'pos_row');
                                  }
                                }}
                                placeholder="Type Item Name / Code (or F2)..."
                                className="flex-1 min-w-0 px-1.5 py-1 font-bold text-slate-900 text-xs bg-transparent focus:bg-white rounded border border-transparent focus:border-emerald-500 outline-none truncate"
                              />
                              {isNegativeLine && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 font-mono font-bold text-[10px] leading-none">
                                  RET
                                </span>
                              )}
                              {row.variant_name && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-semibold shrink-0 max-w-[90px] truncate leading-none"
                                  title={row.variant_name}
                                >
                                  {row.variant_name}
                                </span>
                              )}
                            </div>
                            {renderSalesExcelItemCombobox('row', rIdx)}
                          </td>

                          {/* Full Qty */}
                          <td
                            className={`p-1 border-r border-slate-100 align-middle ${
                              Number(row.quantity || 0) < 0
                                ? 'bg-rose-100/70'
                                : isZeroQty
                                ? 'bg-amber-50'
                                : 'bg-emerald-50/30'
                            } ${colHighlight('quantity')}`}
                          >
                            <NumericInput
                              id={`pos_row_${rIdx}_quantity`}
                              value={row.quantity}
                              allowNegative={true}
                              displayZero={hasItem}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'quantity', true)}
                              className={`w-full px-1.5 py-1 text-right font-mono font-bold text-xs rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none tabular-nums ${
                                Number(row.quantity || 0) < 0
                                  ? 'text-rose-800'
                                  : isZeroQty
                                  ? 'text-amber-900'
                                  : 'text-slate-900'
                              }`}
                            />
                          </td>

                          {/* Loose Qty */}
                          <td
                            className={`p-1 border-r border-slate-100 align-middle ${
                              Number(row.loose_quantity || 0) < 0
                                ? 'bg-rose-100/70'
                                : 'bg-teal-50/30'
                            } ${colHighlight('loose_quantity')}`}
                          >
                            {isSyrupItem(row) ? (
                              <span className="block text-center text-[10.5px] font-semibold text-amber-800">
                                Bottle
                              </span>
                            ) : (
                              <div className="flex items-center gap-0.5">
                                <NumericInput
                                  id={`pos_row_${rIdx}_loose_quantity`}
                                  value={row.loose_quantity}
                                  allowNegative={true}
                                  displayZero={hasItem}
                                  onFocus={() => setSelectedRowIndex(rIdx)}
                                  onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                                  onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_quantity', true)}
                                  className={`w-full px-1 py-1 text-right font-mono font-bold text-xs rounded border border-transparent focus:border-teal-500 bg-transparent focus:bg-white outline-none tabular-nums ${
                                    Number(row.loose_quantity || 0) < 0
                                      ? 'text-rose-800'
                                      : 'text-teal-950'
                                  }`}
                                />
                                {row.item_id && row.units_per_strip > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleAddStripToRow(rIdx, 1)}
                                    title={`Add 1 Strip (+${row.units_per_strip} Loose Units)`}
                                    className="px-1 py-0.5 rounded bg-teal-100 hover:bg-teal-200 text-teal-800 font-mono text-[9.5px] font-bold shrink-0 cursor-pointer leading-tight"
                                  >
                                    +1S
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Rate */}
                          <td className={`p-1 border-r border-slate-100 align-middle ${colHighlight('unit_price')}`}>
                            <NumericInput
                              id={`pos_row_${rIdx}_unit_price`}
                              value={row.unit_price}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'unit_price', true)}
                              title={
                                row.item_id
                                  ? 'Sale Rate — Press Ctrl to view Customer Item History, or Space / H / F4 for Sales Price History'
                                  : 'Sale Rate'
                              }
                              className="w-full px-1.5 py-1 text-right font-mono font-bold text-xs text-slate-900 rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none tabular-nums"
                            />
                          </td>

                          {/* Loose Rate */}
                          <td className={`p-1 border-r border-slate-100 align-middle bg-blue-50/20 ${colHighlight('loose_rate')}`}>
                            <NumericInput
                              id={`pos_row_${rIdx}_loose_rate`}
                              disabled={isSyrupItem(row)}
                              value={row.loose_rate}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_rate', true)}
                              className="w-full px-1.5 py-1 text-right font-mono font-semibold text-xs text-blue-950 rounded border border-transparent focus:border-blue-500 bg-transparent focus:bg-white outline-none disabled:opacity-40 tabular-nums"
                            />
                          </td>

                          {/* Discount 1 % */}
                          <td className={`p-1 border-r border-slate-100 align-middle ${colHighlight('discount_1')}`}>
                            <NumericInput
                              id={`pos_row_${rIdx}_discount_1_percent`}
                              value={row.discount_1_percent}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'discount_1_percent', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'discount_1_percent', true)}
                              className="w-full px-1.5 py-1 text-right font-mono text-xs text-slate-800 rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none tabular-nums"
                              title="Discount 1 (%) applied first to Original Rate"
                            />
                          </td>

                          {/* Discount 2 % */}
                          <td className={`p-1 border-r border-slate-100 align-middle ${colHighlight('discount_2')}`}>
                            <NumericInput
                              id={`pos_row_${rIdx}_discount_2_percent`}
                              value={row.discount_2_percent}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'discount_2_percent', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'discount_2_percent', true)}
                              className="w-full px-1.5 py-1 text-right font-mono text-xs text-slate-800 rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none tabular-nums"
                              title="Discount 2 (%) applied sequentially after Discount 1"
                            />
                          </td>

                          {/* Net Rate (Read-only) */}
                          <td
                            className={`px-2 py-1 text-right font-mono font-bold text-xs text-indigo-900 bg-indigo-50/40 border-r border-slate-100 align-middle tabular-nums whitespace-nowrap ${colHighlight('net_rate')}`}
                            title={
                              hasItem
                                ? `Original Rate ${Number(row.unit_price || 0).toFixed(2)} → Disc 1 (${row.discount_1_percent}%) → Disc 2 (${row.discount_2_percent}%) = Net Rate ${Number(row.net_rate || 0).toFixed(2)}`
                                : ''
                            }
                          >
                            {hasItem ? Number(row.net_rate || 0).toFixed(2) : ''}
                          </td>

                          {/* Bonus */}
                          <td className={`p-1 border-r border-slate-100 align-middle ${colHighlight('bonus_quantity')}`}>
                            <NumericInput
                              id={`pos_row_${rIdx}_bonus_quantity`}
                              value={row.bonus_quantity ?? 0}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'bonus_quantity', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'bonus_quantity', true)}
                              className="w-full px-1.5 py-1 text-right font-mono font-bold text-xs text-teal-900 rounded border border-transparent focus:border-teal-500 bg-transparent focus:bg-white outline-none tabular-nums"
                              title="Bonus Quantity"
                            />
                          </td>

                          {/* Gross */}
                          <td
                            className={`px-2 py-1 text-right font-mono text-xs border-r border-slate-100 align-middle tabular-nums whitespace-nowrap ${
                              Number(row.gross_amount || 0) < 0 ? 'text-rose-700' : 'text-slate-600'
                            } ${colHighlight('gross_amount')}`}
                          >
                            {hasItem ? formatPKR(Number(row.gross_amount || 0)) : ''}
                          </td>

                          {/* Tax */}
                          <td
                            className={`px-2 py-1 text-right font-mono text-xs border-r border-slate-100 align-middle tabular-nums whitespace-nowrap ${
                              Number(row.tax_amount || 0) < 0 ? 'text-rose-700' : 'text-amber-800'
                            } ${colHighlight('tax')}`}
                            title={
                              hasItem
                                ? row.tax_type === 'amount'
                                  ? `Fixed Tax: Rs. ${Number(row.tax_value || 0).toFixed(2)} / unit`
                                  : `Tax Rate: ${Number(row.tax_value ?? row.tax_percent ?? 0).toFixed(2)}% on Gross`
                                : ''
                            }
                          >
                            {hasItem ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="font-semibold">
                                  {formatPKR(Number(row.tax_amount || 0))}
                                </span>
                                {(Number(row.tax_value || 0) > 0 || Number(row.tax_percent || 0) > 0) && (
                                  <span className="text-[9.5px] text-slate-400">
                                    {row.tax_type === 'amount'
                                      ? `Rs.${Number(row.tax_value || 0)}/u`
                                      : `${Number(row.tax_value ?? row.tax_percent ?? 0)}%`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              ''
                            )}
                          </td>

                          {/* Amount */}
                          <td
                            className={`p-1 border-r border-slate-100 align-middle whitespace-nowrap ${
                              Number(row.line_total || 0) < 0 ? 'bg-rose-50/60' : 'bg-slate-50/70'
                            } ${colHighlight('amount')}`}
                          >
                            <input
                              id={`pos_row_${rIdx}_line_total`}
                              type="text"
                              readOnly
                              tabIndex={0}
                              value={hasItem ? Number(row.line_total || 0).toFixed(2) : ''}
                              onFocus={(e) => {
                                setSelectedRowIndex(rIdx);
                                e.currentTarget.select();
                              }}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'line_total', true)}
                              title="Line Amount (Press Enter to move to next row Item Code)"
                              className={`w-full px-1.5 py-1 text-right font-mono font-extrabold text-xs rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none tabular-nums ${
                                Number(row.line_total || 0) < 0
                                  ? 'text-rose-800'
                                  : isZeroNet
                                  ? 'text-amber-800'
                                  : 'text-slate-900'
                              }`}
                            />
                          </td>

                          {/* ROI (Profit Amount) */}
                          {(() => {
                            const posRoi = hasItem ? rowRoiMap.get(row.row_id) : undefined;
                            const roiVal = posRoi && posRoi.roiAmount !== null ? posRoi.roiAmount : null;
                            return (
                              <td
                                className={`px-2 py-1 text-right font-mono font-bold text-xs border-r border-slate-100 align-middle tabular-nums whitespace-nowrap bg-emerald-50/30 ${
                                  roiVal === null
                                    ? 'text-slate-400'
                                    : roiVal < 0
                                    ? 'text-rose-700'
                                    : 'text-emerald-800'
                                } ${colHighlight('roi')}`}
                                title={
                                  hasItem && posRoi?.hasValidCost
                                    ? `ROI = Net Selling (${posRoi.netSellingAmount.toFixed(2)}) − Cost (${posRoi.lineCost.toFixed(2)}) [Pack Cost: ${posRoi.packCost.toFixed(4)}]`
                                    : hasItem
                                    ? 'No valid purchase cost or Pprice available'
                                    : ''
                                }
                              >
                                {roiVal !== null ? roiVal.toFixed(2) : ''}
                              </td>
                            );
                          })()}

                          {/* Remarks */}
                          <td className={`p-1 border-r border-slate-100 align-middle ${colHighlight('remarks')}`}>
                            <input
                              id={`pos_row_${rIdx}_remarks`}
                              type="text"
                              value={row.remarks || ''}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'remarks', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'remarks', true)}
                              placeholder={hasItem ? 'Remarks...' : ''}
                              className="w-full px-1.5 py-1 text-left text-xs text-slate-700 rounded border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white outline-none"
                            />
                          </td>

                          {/* Actions */}
                          <td className="py-1 px-1 text-center align-middle whitespace-nowrap">
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRowIndex(rIdx);
                                  openItemListForRow(rIdx);
                                }}
                                className="p-1 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-700 cursor-pointer"
                                title="Select or change item from Catalog"
                              >
                                <PackageSearch className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRowRange(null);
                                  setSelectedColKeys([]);
                                  setSelectedRowIndex(rIdx);
                                  requestDatasheetDeleteConfirm(rIdx);
                                }}
                                className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Delete row (Shift+Delete)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Table Bottom Bar: Record Navigation & Search Inside Invoice */}
              <div className="bg-slate-50 border-t border-slate-200 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
                {(selectedRowRange || selectedColKeys.length > 0) && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 font-semibold text-xs">
                    <span>
                      {selectedColKeys.length > 0
                        ? `Selected ${selectedColKeys.length} col(s): ${selectedColKeys
                            .map((k) => SALES_COL_LABELS[k] || k)
                            .join(', ')}`
                        : `Selected ${
                            Math.abs((selectedRowRange?.end ?? 0) - (selectedRowRange?.start ?? 0)) + 1
                          } row(s)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => requestDatasheetDeleteConfirm(selectedRowIndex)}
                      className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer"
                    >
                      Shift+Del
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRowRange(null);
                        rowSelectionAnchorRef.current = null;
                        setSelectedColKeys([]);
                        colSelectionAnchorRef.current = null;
                      }}
                      className="px-2 py-0.5 rounded bg-white border border-sky-200 text-sky-800 text-[11px] font-semibold cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-[11px] text-slate-500 mr-1">Row:</span>
                    <button
                      type="button"
                      onClick={() => navigateToRecord(0)}
                      disabled={selectedRowIndex === 0}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-[11px] font-mono font-bold cursor-pointer"
                      title="First Record (Home)"
                    >
                      |◀
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateToRecord(selectedRowIndex - 1)}
                      disabled={selectedRowIndex === 0}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-[11px] font-mono font-bold cursor-pointer"
                      title="Previous Record (Up)"
                    >
                      ◀
                    </button>
                    <input
                      type="text"
                      value={recordJumpInput}
                      onChange={(e) => setRecordJumpInput(e.target.value.replace(/[^\d]/g, ''))}
                      onKeyDown={handleRecordJumpKeyDown}
                      onBlur={() => {
                        const parsed = parseInt(recordJumpInput, 10);
                        if (!Number.isNaN(parsed) && parsed >= 1) {
                          navigateToRecord(parsed - 1);
                        } else {
                          setRecordJumpInput(String(selectedRowIndex + 1));
                        }
                      }}
                      className="w-10 px-1.5 py-0.5 text-center rounded bg-white border border-slate-300 focus:border-emerald-500 font-mono font-bold text-[11px] text-slate-900 outline-none"
                      title="Type Record # and press Enter"
                    />
                    <span className="text-[11px] font-mono text-slate-500">/ {rows.length}</span>
                    <button
                      type="button"
                      onClick={() => navigateToRecord(selectedRowIndex + 1)}
                      disabled={selectedRowIndex >= rows.length - 1}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-[11px] font-mono font-bold cursor-pointer"
                      title="Next Record (Down)"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateToRecord(rows.length - 1)}
                      disabled={selectedRowIndex >= rows.length - 1}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 text-[11px] font-mono font-bold cursor-pointer"
                      title="Last Record (End)"
                    >
                      ▶|
                    </button>
                  </div>
                  <InvoiceRecordSearchInput
                    items={salesSearchableItems}
                    onPreviewMatch={handlePreviewSearchedSalesRow}
                    onNavigateToMatch={handleNavigateToSearchedSalesRow}
                    onMatchesChange={(matches, activeRow) => {
                      setInvoiceSearchMatchedRows(matches);
                      setInvoiceSearchActiveRow(activeRow);
                    }}
                  />
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                  <span>
                    Items <strong className="text-slate-900">{validRows.length}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Full <strong className="text-slate-900">{posFullQtySum}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Loose <strong className="text-teal-700">{posLooseQtySum}</strong>
                  </span>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={formattedInvoiceProfit}
                    className="w-24 px-2 py-0.5 rounded bg-white border border-slate-300 font-mono font-bold text-[11px] text-right text-slate-900 tabular-nums outline-none select-all"
                  />
                </div>
              </div>
            </div>

            {/* Compact Item History Popup (POS View) */}
            {showCompactHistoryPopup && activeRow && (activeRow.item_code || activeRow.item_id) && (
              <CompactItemHistoryPopup
                isOpen={showCompactHistoryPopup}
                mode="sales"
                itemCode={activeRow.variant_code || activeRow.item_code}
                itemName={activeRow.item_name}
                variantName={activeRow.variant_name || null}
                thumbnailUrl={activeRow.variant_thumbnail_url || null}
                packing={activeRow.packing}
                selectedCustomerId={customerAccountId > 0 ? customerAccountId : null}
                selectedCustomerName={customerAccountId > 0 ? selectedCustomer?.account_name || '' : ''}
                historyData={activeItemHistory}
                loading={historyLoading}
                onClose={() => setShowCompactHistoryPopup(false)}
                onApplySaleRate={(rate, disc1Pct, disc2Pct = 0) => {
                  updateRowField(selectedRowIndex, 'unit_price', round2(rate));
                  updateRowField(selectedRowIndex, 'discount_1_percent', clampDiscountPercent(disc1Pct));
                  updateRowField(selectedRowIndex, 'discount_2_percent', clampDiscountPercent(disc2Pct));
                }}
              />
            )}
          </div>

          {/* RIGHT SETTLEMENT RAIL: SECTION D (BILLING SUMMARY) + SECTION E (ACTION BUTTONS) */}
          <div className="w-full lg:w-[320px] xl:w-[350px] shrink-0 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-lg flex flex-col justify-between p-4 gap-3 overflow-y-auto">
            {/* SECTION D: BILLING SUMMARY */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Billing Summary
                </span>
                <span className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                  {validRows.length} Item{validRows.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="space-y-2 text-xs tabular-nums">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Subtotal (Gross)</span>
                  <span className="font-mono font-bold text-white">{formatPKR(grossAmount)}</span>
                </div>

                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="text-rose-300">Total Discount</span>
                    <NumericInput
                      value={invoiceDiscountPercent}
                      onChange={(e) => {
                        const pct = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                        setInvoiceDiscountPercent(pct);
                        setInvoiceDiscountAmount(round2((subtotalAfterItemDisc * pct) / 100));
                      }}
                      placeholder="%"
                      title="Extra Bill Discount %"
                      className="w-12 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-white text-right outline-none focus:border-emerald-500"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                  <span className="font-mono font-bold text-rose-300">
                    {totalDiscount >= 0 ? `-${formatPKR(totalDiscount)}` : `+${formatPKR(Math.abs(totalDiscount))}`}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <span>Cash Load / Delivery</span>
                  <NumericInput
                    value={deliveryCharges}
                    onChange={(e) => setDeliveryCharges(Math.max(0, Number(e.target.value || 0)))}
                    title="Delivery / Cash Load Charges"
                    className="w-20 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 text-right outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <span>Tax</span>
                  <span className="font-mono font-bold text-amber-300">
                    {totalTax >= 0 ? '+' : ''}
                    {formatPKR(totalTax)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/80">
                  <span>Prev Bal ({prevBalanceType})</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {formatPKR(prevCustomerBalance)}
                  </span>
                </div>
              </div>

              {/* Prominent Grand Total Card */}
              <div
                className={`rounded-xl p-3.5 border ${
                  isSalesNetReturn
                    ? 'bg-rose-950/70 border-rose-500/40'
                    : 'bg-emerald-950/60 border-emerald-500/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider ${
                      isSalesNetReturn ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    {isSalesNetReturn ? 'Grand Total (Return)' : 'Grand Total'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    Receivable: {formatPKR(totalReceivable)}
                  </span>
                </div>
                <div
                  className={`text-2xl font-mono font-black tracking-tight tabular-nums ${
                    isSalesNetReturn ? 'text-rose-200' : 'text-emerald-300'
                  }`}
                >
                  {formatPKR(netInvoiceAmount)}
                </div>
              </div>

              {/* Cash Received & Quick Tender */}
              <div className="bg-slate-800/70 rounded-xl border border-slate-700/80 p-3 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Cash Received
                    </label>
                    <button
                      type="button"
                      onClick={handleExactCash}
                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10.5px] font-bold cursor-pointer transition-colors"
                    >
                      Exact
                    </button>
                  </div>
                  <NumericInput
                    value={paidAmountInput}
                    displayZero={Boolean(editingSaleId) || paidAmountInput.trim() === '0'}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500 font-mono font-black text-base text-white text-right outline-none tabular-nums"
                  />
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {[500, 1000, 2000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => handleQuickCash(amt)}
                      className="py-1 rounded-md bg-slate-900 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-mono text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      {amt >= 1000 ? `${amt / 1000}k` : amt}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-slate-700/70 text-xs tabular-nums">
                  <span className="font-semibold text-slate-300">
                    {paidAmount >= totalReceivable ? 'Change Return' : 'Remaining Balance'}
                  </span>
                  <span
                    className={`font-mono font-black text-sm ${
                      paidAmount >= totalReceivable ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {formatPKR(Math.abs(paidAmount - totalReceivable))}
                  </span>
                </div>
              </div>
            </div>

            {/* SECTION E: ACTION BUTTONS */}
            <div className="space-y-2 pt-2 border-t border-slate-800 shrink-0">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed')}
                className={`w-full py-2.5 px-4 rounded-xl ${
                  editingSaleId
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/40'
                } text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-md transition-colors`}
                title={editingSaleId ? 'Update Invoice (Ctrl+S)' : 'Save Invoice (Ctrl+S)'}
              >
                <Save className="w-4 h-4" />
                <span>{editingSaleId ? 'Update Invoice (Ctrl+S)' : 'Save Invoice (Ctrl+S)'}</span>
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', 'a4')}
                  className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Save & Print A4 Invoice (Ctrl+P)"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Save &amp; Print</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Hold Invoice</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '80mm')}
                  className="py-1.5 px-2 rounded-lg bg-teal-900/70 hover:bg-teal-800 text-teal-100 border border-teal-700/70 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5 text-teal-300" />
                  <span>80mm Thermal</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '58mm')}
                  className="py-1.5 px-2 rounded-lg bg-amber-900/60 hover:bg-amber-800 text-amber-100 border border-amber-700/70 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-300" />
                  <span>58mm Thermal</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenCurrentInvoicePreview('a4')}
                  className="py-1.5 px-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCurrentInvoicePdf}
                  className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  title="Export 80mm thermal PDF"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleReprintLastInvoice}
                  className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Reprint</span>
                </button>
              </div>

              {rows.some((r) => r.item_id) && (
                <div className="w-full flex">
                  <WhatsAppSendButton
                    label="Send to WhatsApp"
                    payload={{
                      storeName: storeDisplayName,
                      documentType: 'invoice',
                      invoiceId: editingSaleId || null,
                      documentNumber: invoiceNumber,
                      documentDate: invoiceDate,
                      customerAccountId: customerAccountId || null,
                      customerName:
                        selectedCustomer?.account_name || 'Walk-in Cash Customer',
                      customerPhone: selectedCustomer?.phone || '',
                      totalAmount: netInvoiceAmount,
                      paidAmount: paidAmount,
                      remainingBalance: remainingBalance,
                      items: rows
                        .filter((r) => r.item_id)
                        .map((r) => ({
                          item_name: r.item_name,
                          packing: r.packing,
                          quantity: r.quantity,
                          loose_quantity: r.loose_quantity,
                          unit_price: r.unit_price,
                          line_total: r.line_total,
                        })),
                    }}
                    onPhoneSaved={() => {
                      loadReferenceData();
                    }}
                    onSendSuccess={() => {
                      setLastSavedWhatsappPayload(null);
                      setSuccessMsg(null);
                    }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(true)}
                  className="py-1.5 px-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Discard</span>
                </button>
                {onBackToDashboard && (
                  <button
                    type="button"
                    onClick={onBackToDashboard}
                    className="py-1.5 px-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Close</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (THREE-SECTION COMPACT FORM) ================= */}
      {invoiceViewMode === 'access' && (
        <div className="ams-pos-compact-chrome flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-200 border border-slate-400 rounded-md shadow-xs select-none">
          {/* SECTION A (TOP): COMPACT MS ACCESS FORM HEADER */}
          <div className="bg-slate-800 text-white px-2 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 shrink-0">
            <div className="flex items-center gap-1.5 font-mono">
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-slate-200">frm_SalesInvoice</span>
              <span className="bg-emerald-700 px-1.5 py-0 rounded text-white font-bold uppercase">
                {invoiceType}
              </span>
              <span className="font-bold text-amber-300">{invoiceNumber}</span>
              {editingSaleId && (
                <button
                  type="button"
                  onClick={resetToNewInvoice}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-1.5 py-0 rounded font-bold cursor-pointer"
                  title="Cancel edit and start new invoice"
                >
                  EDIT #{editingSaleId} ✕
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={resetToNewInvoice}
                className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 font-bold flex items-center gap-0.5 cursor-pointer"
                title="New Sales Invoice (Ctrl+N)"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                New
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeEl = document.activeElement as HTMLElement | null;
                  setF9ItemMasterState({
                    isOpen: true,
                    editingItem: null,
                    rowIndex: selectedRowIndex,
                    returnFocusId: activeEl?.id || '',
                  });
                }}
                className="px-1.5 py-0 rounded bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-500/60 font-bold flex items-center gap-0.5 cursor-pointer"
                title="Open Item Registration to add a new item"
              >
                <Plus className="w-3 h-3 text-emerald-200" />
                Item Registration
              </button>
              <button
                type="button"
                onClick={() => setShowEditSearchModal(true)}
                className="px-1.5 py-0 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                title="Find & Edit Existing Invoice (Ctrl+E)"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
              <button
                type="button"
                onClick={openHeldDrawer}
                className="px-1.5 py-0 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <PlayCircle className="w-3 h-3" />
                Held ({heldInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => openCustomerShortcut('ledger')}
                className="px-1.5 py-0 rounded bg-teal-700 hover:bg-teal-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                title="Open selected customer ledger"
              >
                <BookOpen className="w-3 h-3" />
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(true)}
                className={`px-1.5 py-0 rounded border font-bold flex items-center gap-0.5 cursor-pointer ${
                  advanceTaxApplicable
                    ? 'bg-amber-500 border-amber-300 text-slate-950'
                    : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-200'
                }`}
              >
                <Percent className="w-3 h-3 text-amber-300" />
                Adv Tax {advanceTaxApplicable ? `(${effectiveAdvTaxRate}%)` : ''}
              </button>
            </div>
          </div>

          {/* Dense MS Access Form Header Controls (Customer, Date, Salesman & F3 Search) */}
          <div className="px-2 py-1 bg-slate-100 border-b border-slate-300 shrink-0 space-y-1">
            <div className="grid grid-cols-12 gap-1.5 items-center">
              <div className="col-span-2 flex items-center gap-1">
                <label className="font-bold text-slate-600 whitespace-nowrap">Inv #:</label>
                <input
                  type="text"
                  readOnly
                  value={invoiceNumber}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-mono font-bold text-slate-900 bg-slate-200 cursor-not-allowed"
                />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <label className="font-bold text-slate-600 whitespace-nowrap">Date:</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-mono text-slate-900 bg-white"
                />
              </div>
              <div className="col-span-3 flex items-center gap-1">
                <label className="font-bold text-slate-600 whitespace-nowrap">Customer:</label>
                <input
                  type="text"
                  placeholder="Find..."
                  value={customerSearchText}
                  onChange={(e) => setCustomerSearchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (customerSearchText.trim() && filteredCustomers.length > 0) {
                        const alreadyMatches = filteredCustomers.some(
                          (c) => Number(c.id) === Number(customerAccountId)
                        );
                        if (!alreadyMatches) {
                          handleSelectCustomerAccount(Number(filteredCustomers[0].id));
                        }
                      }
                      focusNewRowItemSearch();
                    }
                  }}
                  className="w-14 px-1 py-0 rounded border border-slate-300 bg-white"
                />
                <select
                  value={customerAccountId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    handleSelectCustomerAccount(id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setTimeout(() => {
                        focusNewRowItemSearch();
                      }, 25);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === 'Enter') {
                      focusNewRowItemSearch();
                    }
                  }}
                  className="flex-1 min-w-0 px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white"
                >
                  <option value={0}>Walk-in Cash Customer</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.account_name} ({c.account_code}){c.town_name ? ` • ${c.town_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <label htmlFor="access_buyer_name_input" className="font-bold text-slate-600 whitespace-nowrap">
                  Buyer:
                </label>
                <input
                  id="access_buyer_name_input"
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Buyer / Patient name..."
                  className="w-full min-w-0 px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white focus:border-emerald-600 outline-none"
                />
              </div>
              <div className="col-span-3 flex items-center gap-1.5">
                <div className="flex-1 flex items-center gap-1 min-w-0">
                  <label className="font-bold text-slate-600 whitespace-nowrap">Type:</label>
                  <select
                    value={invoiceType}
                    onChange={(e) => handleInvoiceTypeChange(e.target.value as SalesInvoiceType)}
                    className="w-full px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white"
                  >
                    <option value="Retail">Retail</option>
                    <option value="Wholesale">Wholesale</option>
                  </select>
                </div>
                <div className="flex-1 flex items-center gap-1 min-w-0">
                  <label className="font-bold text-slate-600 whitespace-nowrap">Mode:</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(false);
                      setPaymentMode(e.target.value as SalesPaymentMode);
                    }}
                    className="w-full px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Credit">Credit</option>
                    <option value="Partial">Partial</option>
                    <option value="Bank">Bank</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Row 2: Salesman, Deliveryman, Buyer, Quick Search (F3) & Row Actions */}
            <div className="grid grid-cols-12 gap-1.5 items-center pt-1 border-t border-slate-200">
              <div className="col-span-2 flex items-center gap-1">
                <label className="font-bold text-slate-600 whitespace-nowrap">Salesman:</label>
                <select
                  value={salesmanId || ''}
                  onChange={(e) => {
                    const idVal = e.target.value ? Number(e.target.value) : null;
                    setSalesmanId(idVal);
                    const found = salesmenList.find((s) => s.id === idVal);
                    if (found) setSalesman(found.name);
                  }}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white"
                >
                  <option value="">Counter</option>
                  {filteredSalesmen.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name || sm.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <label className="font-bold text-slate-600 whitespace-nowrap">Delivery:</label>
                <select
                  value={deliverymanId || ''}
                  onChange={(e) => {
                    const idVal = e.target.value ? Number(e.target.value) : null;
                    setDeliverymanId(idVal);
                    const found = deliverymenList.find((d) => d.id === idVal);
                    setDeliverymanName(found ? found.name : '');
                    if (idVal && deliveryStatus === 'Pending') {
                      setDeliveryStatus('Assigned');
                    } else if (!idVal) {
                      setDeliveryStatus('Pending');
                    }
                  }}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white"
                >
                  <option value="">Pickup</option>
                  {filteredDeliverymen.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      {dm.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <label htmlFor="access_sales_company_filter" className="font-bold text-slate-600 whitespace-nowrap">
                  Company:
                </label>
                <div className="relative flex-1 flex items-center gap-0.5 min-w-0">
                  <select
                    id="access_sales_company_filter"
                    aria-label="Filter items by Company"
                    value={selectedCompanyFilter}
                    onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                    className={`w-full px-1 py-0 rounded border font-semibold focus:outline-none ${
                      selectedCompanyFilter
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                        : 'border-slate-300 bg-white text-slate-900'
                    }`}
                  >
                    <option value="">All Companies</option>
                    {companyOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {selectedCompanyFilter && (
                    <button
                      type="button"
                      onClick={() => setSelectedCompanyFilter('')}
                      title="Clear Company Filter"
                      aria-label="Clear Company Filter"
                      className="px-1 py-0 rounded border border-emerald-300 bg-white hover:bg-emerald-100 text-emerald-800 font-bold text-[10px] cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="col-span-3 relative">
                <div className="flex items-center bg-white border border-slate-300 rounded px-1.5 focus-within:border-emerald-600">
                  <Search className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={quickSearchQuery}
                    onFocus={() => {
                      setActiveSearchRowIdx(null);
                      if (quickSearchQuery.trim().length > 0 || selectedCompanyFilter) {
                        setShowSearchDropdown(true);
                        runFastSearch(quickSearchQuery);
                      } else {
                        setShowSearchDropdown(false);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowSearchDropdown(false);
                      }, 160);
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setActiveSearchRowIdx(null);
                      setQuickSearchQuery(val);
                      if (val.trim().length > 0 || selectedCompanyFilter) {
                        setShowSearchDropdown(true);
                        runFastSearch(val);
                      } else {
                        setShowSearchDropdown(false);
                        setSearchResults([]);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        if (quickSearchQuery.trim().length === 0 && !selectedCompanyFilter) return;
                        e.preventDefault();
                        if (!showSearchDropdown) {
                          setShowSearchDropdown(true);
                          runFastSearch(quickSearchQuery);
                          return;
                        }
                        setSearchHighlightIdx((prev) => {
                          const next = Math.min(Math.max(0, searchResults.length - 1), prev + 1);
                          scrollSalesSearchRowIntoView(next);
                          return next;
                        });
                      } else if (e.key === 'ArrowUp') {
                        if (quickSearchQuery.trim().length === 0 && !selectedCompanyFilter) return;
                        e.preventDefault();
                        setSearchHighlightIdx((prev) => {
                          const next = Math.max(0, prev - 1);
                          scrollSalesSearchRowIntoView(next);
                          return next;
                        });
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const qTrim = quickSearchQuery.trim();
                        if (qTrim.length > 0) {
                          const exactLocal = findExactBarcodeOrCodeMatch(companyFilteredCatalogItems, qTrim);
                          if (exactLocal && (exactLocal.matchType === 'variant' || exactLocal.item.barcode?.toLowerCase() === qTrim.toLowerCase())) {
                            handleSelectFromTopSearch(exactLocal.item, undefined, exactLocal.variant || null);
                            return;
                          }
                          if (showSearchDropdown && searchResults.length > 0) {
                            const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                            if (chosen) {
                              const exactChosen = findExactBarcodeOrCodeMatch([chosen], qTrim);
                              handleSelectFromTopSearch(chosen, undefined, exactChosen?.variant || null);
                              return;
                            }
                          }
                          api
                            .lookupBarcodeExact(qTrim)
                            .then(async (res) => {
                              if (res?.matched && res.item) {
                                const freshSearch = await api
                                  .fastSearchSalesItems(res.item.item_code || qTrim, 10)
                                  .catch(() => null);
                                const hydrated: FastSearchItem | undefined = (
                                  freshSearch?.data ||
                                  freshSearch?.items ||
                                  []
                                ).find((it: FastSearchItem) => Number(it.id) === Number(res.item!.id));
                                if (hydrated) {
                                  setCatalogItems((prev) =>
                                    prev.some((c) => Number(c.id) === Number(hydrated.id))
                                      ? prev
                                      : [...prev, hydrated]
                                  );
                                  if (
                                    selectedCompanyFilter &&
                                    !matchesSelectedCompany(hydrated.company_name, selectedCompanyFilter)
                                  ) {
                                    setErrorMsg(
                                      `Item "${hydrated.item_name}" belongs to "${hydrated.company_name || 'another company'}", not selected company "${selectedCompanyFilter}".`
                                    );
                                    return;
                                  }
                                  const resolvedVar = res.variant
                                    ? hydrated.variants?.find((v) => Number(v.id) === Number(res.variant!.id)) ||
                                      res.variant
                                    : null;
                                  handleSelectFromTopSearch(hydrated, undefined, resolvedVar);
                                }
                              }
                            })
                            .catch(() => null);
                          return;
                        }
                        focusCell(selectedRowIndex, 'item_name', 'cell');
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setShowSearchDropdown(false);
                      }
                    }}
                    placeholder={
                      selectedCompanyFilter
                        ? `Search in ${selectedCompanyFilter} (F3)...`
                        : 'Barcode / Item Search (F3)...'
                    }
                    className="w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none"
                  />
                </div>
                {renderSalesExcelItemCombobox('top')}
              </div>
              <div className="col-span-3 flex flex-wrap items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => openItemListForRow(rows[selectedRowIndex]?.item_id ? null : selectedRowIndex)}
                  className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                  title="Open Item List (F2)"
                >
                  <PackageSearch className="w-3 h-3 text-emerald-400" />
                  Items
                </button>
                <button
                  type="button"
                  onClick={handleInsertRow}
                  className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                  title="Add New Blank Line"
                >
                  <Plus className="w-3 h-3" />
                  Row
                </button>
                <button
                  type="button"
                  onClick={() => requestDatasheetDeleteConfirm(selectedRowIndex)}
                  className="px-1.5 py-0 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                  title="Delete selected rows or columns (Shift+Delete)"
                >
                  <Trash2 className="w-3 h-3" />
                  Del
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyRow(selectedRowIndex)}
                  className="px-1.5 py-0 rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold cursor-pointer"
                  title="Copy active row"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => handlePasteRow(selectedRowIndex)}
                  disabled={!copiedRowData}
                  className="px-1.5 py-0 rounded bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 border border-slate-300 font-semibold cursor-pointer"
                  title="Paste row"
                >
                  Paste
                </button>
              </div>
            </div>
          </div>

          {/* ================= SECTION B (CENTER): MICROSOFT ACCESS-STYLE DATASHEET GRID ONLY (MIN 10 VISIBLE ROWS) ================= */}
          <div
            onKeyDownCapture={(e) => {
              if (
                e.shiftKey &&
                e.key === 'Delete' &&
                !e.ctrlKey &&
                !e.altKey &&
                !e.metaKey
              ) {
                e.preventDefault();
                e.stopPropagation();
                requestDatasheetDeleteConfirm(selectedRowIndex);
                return;
              }
              if (
                e.shiftKey &&
                (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
                !e.ctrlKey &&
                !e.altKey &&
                !e.metaKey
              ) {
                e.preventDefault();
                e.stopPropagation();
                const activeElId = (document.activeElement as HTMLElement | null)?.id || '';
                const m = activeElId.match(/^cell_(\d+)_(.+)$/);
                const curRow = m ? Number(m[1]) : selectedRowIndex;
                const curCol = m ? m[2] : 'item_code';
                const anchor = rowSelectionAnchorRef.current ?? curRow;
                if (rowSelectionAnchorRef.current === null) rowSelectionAnchorRef.current = anchor;
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                const nextRow = Math.max(0, Math.min(entryRowIdx, rows.length - 1, curRow + delta));
                setSelectedColKeys([]);
                colSelectionAnchorRef.current = null;
                setSelectedRowRange({ start: anchor, end: nextRow });
                setSelectedRowIndex(nextRow);
                focusCell(nextRow, curCol, 'cell');
                return;
              }
              if (
                e.key === 'Escape' &&
                !showSearchDropdown &&
                !showCompactHistoryPopup &&
                (selectedRowRange !== null || selectedColKeys.length > 0)
              ) {
                setSelectedRowRange(null);
                rowSelectionAnchorRef.current = null;
                setSelectedColKeys([]);
                colSelectionAnchorRef.current = null;
              }
            }}
            className="ams-pos-item-grid-card flex flex-col flex-1 min-h-[356px] bg-white overflow-hidden select-none border-b border-slate-400"
          >
            {/* Vertical & horizontal scrolling inside the item grid, sticky column headers */}
            <div className="ams-pos-item-grid-scroll flex-1 min-h-[322px] overflow-y-auto overflow-x-auto relative">
              <table
                style={{ width: `${accessTotalWidth}px` }}
                className="ams-compact-10-grid table-fixed border-collapse text-[11px] font-sans leading-none"
              >
                <colgroup>
                  <col style={{ width: `${colWidths.selector}px` }} />
                  {orderedSalesAccessColKeys.map((colKey) => (
                    <col key={colKey} style={{ width: `${colWidths[colKey]}px` }} />
                  ))}
                  <col style={{ width: `${colWidths.actions}px` }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400 text-slate-800 text-[10px] font-bold select-none shadow-sm leading-none">
                  <tr className="h-6">
                    <th
                      key="selector"
                      style={{ width: `${colWidths.selector}px` }}
                      className="bg-slate-300/80 border-r border-slate-400 text-center font-mono px-1 py-0 relative h-6 whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                      <span className="truncate block">#</span>
                      <div
                        data-col-resize-handle="true"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleColResizeMouseDown('selector', e);
                        }}
                        onDoubleClick={(e) => handleResetAccessColWidth('selector', e)}
                        title="Drag border to resize column (double-click to reset)"
                        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors ${
                          accessResizingCol === 'selector' ? 'bg-emerald-600' : 'hover:bg-emerald-500/80'
                        }`}
                      />
                    </th>

                    {orderedSalesAccessColKeys.map((colKey) => {
                      const meta = SALES_ACCESS_COL_META[colKey] || {
                        label: SALES_COL_LABELS[colKey] || colKey,
                        cls: 'border-r border-slate-300 text-left',
                      };
                      const isColSelected = selectedColKeys.includes(colKey);
                      const isDraggingThis = draggedSalesAccessCol === colKey;
                      const isDragOverThis = dragOverSalesAccessCol === colKey;
                      const dropIndicatorCls = isDragOverThis
                        ? salesAccessDropSide === 'left'
                          ? '!border-l-[3px] !border-l-indigo-600 !bg-indigo-100/80'
                          : '!border-r-[3px] !border-r-indigo-600 !bg-indigo-100/80'
                        : '';
                      return (
                        <th
                          key={colKey}
                          draggable={accessResizingCol === null}
                          onDragStart={(e) => {
                            isDraggingColsRef.current = false;
                            handleSalesAccessColDragStart(colKey, e, accessResizingCol !== null);
                          }}
                          onDragOver={(e) => handleSalesAccessColDragOver(colKey, e)}
                          onDrop={(e) =>
                            handleSalesAccessColDrop(colKey, e, (movedKey) => {
                              setSelectedColKeys([movedKey]);
                              colSelectionAnchorRef.current = movedKey;
                            })
                          }
                          onDragEnd={handleSalesAccessColDragEnd}
                          onMouseDown={(e) =>
                            handleColHeaderMouseDown(colKey, orderedSalesAccessColKeys, e)
                          }
                          onMouseEnter={() =>
                            handleColHeaderMouseEnter(colKey, orderedSalesAccessColKeys)
                          }
                          style={{ width: `${colWidths[colKey]}px` }}
                          title="Click to select column (Move Left/Right or Shift+Del) · Drag header to reorder"
                          className={`${meta.cls} cursor-grab active:cursor-grabbing hover:bg-sky-100/70 ${
                            isColSelected
                              ? '!bg-sky-200 !text-sky-950 ring-1 ring-inset ring-sky-500'
                              : ''
                          } ${isDraggingThis ? 'opacity-50' : ''} ${dropIndicatorCls} px-1 py-0 relative h-6 whitespace-nowrap overflow-hidden text-ellipsis`}
                        >
                          <span className="truncate block pr-1">{meta.label}</span>
                          <div
                            data-col-resize-handle="true"
                            draggable={false}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleColResizeMouseDown(colKey, e);
                            }}
                            onDoubleClick={(e) => handleResetAccessColWidth(colKey, e)}
                            title="Drag border to resize column (double-click to reset)"
                            className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors ${
                              accessResizingCol === colKey ? 'bg-emerald-600' : 'hover:bg-emerald-500/80'
                            }`}
                          />
                        </th>
                      );
                    })}

                    <th
                      key="actions"
                      style={{ width: `${colWidths.actions}px` }}
                      className="text-center px-1 py-0 relative h-6 whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                      <span className="truncate block">Batch / Del</span>
                      <div
                        data-col-resize-handle="true"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleColResizeMouseDown('actions', e);
                        }}
                        onDoubleClick={(e) => handleResetAccessColWidth('actions', e)}
                        title="Drag border to resize column (double-click to reset)"
                        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors ${
                          accessResizingCol === 'actions' ? 'bg-emerald-600' : 'hover:bg-emerald-500/80'
                        }`}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => {
                    if (isGhostRow(rIdx)) {
                      return (
                        <tr key={row.row_id} className="h-[16px] border-b border-slate-300 bg-slate-50/50 select-none">
                          <td className="border-r border-slate-300 px-0.5 py-0 text-center bg-slate-100 font-mono text-[9.5px] text-slate-300 h-[16px] align-middle">
                            {rIdx + 1}
                          </td>
                          <td colSpan={orderedSalesAccessColKeys.length + 1} />
                        </tr>
                      );
                    }
                    const isSelected = rIdx === selectedRowIndex;
                    const isMultiRowSelected = isRowInSelectionRange(rIdx);
                    const isActiveSearchMatch = invoiceSearchActiveRow === rIdx;
                    const isSearchMatch = invoiceSearchMatchedRows.includes(rIdx);
                    const remainingUnits = round2(row.available_stock_units - row.total_units);
                    const isOverStock =
                      row.item_id !== null && !allowNegativeStock && remainingUnits < 0;
                    const catPurchaseFallback =
                      row.item_id && (row.lastPurchaseCostRate === null || row.lastPurchaseCostRate === undefined)
                        ? Number(catalogItems.find((c) => c.id === row.item_id)?.purchase_price || 0)
                        : Number(row.lastPurchaseCostRate || 0);

                    const hasItem = row.item_id !== null && Number(row.item_id) > 0;
                    const isZeroQty =
                      hasItem &&
                      Number(row.quantity || 0) === 0 &&
                      Number(row.loose_quantity || 0) === 0;
                    const isZeroNet = hasItem && round2(Number(row.line_total || 0)) === 0;
                    const isZeroRow = isZeroQty || isZeroNet;
                    const colHighlight = (colKey: string) =>
                      selectedColKeys.includes(colKey)
                        ? '!bg-sky-100/80 ring-1 ring-inset ring-sky-400'
                        : '';

                    const renderSalesAccessCell = (colKey: string): React.ReactNode => {
                      switch (colKey) {
                        case 'item_code':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle relative ${colHighlight('item_code')}`}>
                              <input
                                id={`cell_${rIdx}_item_code`}
                                type="text"
                                value={
                                  editingItemCode?.rowIdx === rIdx
                                    ? editingItemCode.value
                                    : row.item_code
                                }
                                onFocus={() => {
                                  setSelectedRowIndex(rIdx);
                                  setShowSearchDropdown(false);
                                  cancelledCodeEditRef.current = false;
                                  committedCodeEditRef.current = false;
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setShowSearchDropdown(false);
                                    setActiveSearchRowIdx((prev) => (prev === rIdx ? null : prev));
                                    if (cancelledCodeEditRef.current || committedCodeEditRef.current) {
                                      cancelledCodeEditRef.current = false;
                                      committedCodeEditRef.current = false;
                                      setEditingItemCode((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                      return;
                                    }
                                    if (editingItemCode && editingItemCode.rowIdx === rIdx) {
                                      commitItemCodeChange(rIdx, editingItemCode.value, false);
                                    }
                                  }, 160);
                                }}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSelectedRowIndex(rIdx);
                                  committedCodeEditRef.current = false;
                                  setEditingItemCode({ rowIdx: rIdx, value: val });
                                  if (val.trim().length > 0) {
                                    setActiveSearchRowIdx(rIdx);
                                    setShowSearchDropdown(true);
                                    runFastSearch(val);
                                  } else {
                                    setShowSearchDropdown(false);
                                    setSearchResults([]);
                                    setActiveSearchRowIdx(null);
                                  }
                                }}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'item_code')}
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>
                          );
                        case 'item_name':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle relative ${colHighlight('item_name')}`}>
                              <div className="flex items-center gap-1 h-[15px] px-0.5">
                                {row.item_id !== null && row.variant_thumbnail_url && (
                                  <ProductThumb
                                    src={row.variant_thumbnail_url}
                                    alt={row.item_name}
                                    size="xs"
                                    className="!w-3.5 !h-3.5 !rounded-xs border-0 shrink-0"
                                  />
                                )}
                                <input
                                  id={`cell_${rIdx}_item_name`}
                                  type="text"
                                  value={
                                    editingItemName?.rowIdx === rIdx
                                      ? editingItemName.value
                                      : formatItemNameWithRemarks(row.item_name, row.remarks)
                                  }
                                  onFocus={() => {
                                    setSelectedRowIndex(rIdx);
                                    if (!row.item_id && selectedCompanyFilter) {
                                      setActiveSearchRowIdx(rIdx);
                                      setShowSearchDropdown(true);
                                      runFastSearch('');
                                    } else {
                                      setShowSearchDropdown(false);
                                    }
                                    if (row.item_code || row.item_id) {
                                      fetchAndApplyItemHistory(
                                        rIdx,
                                        Number(row.item_id || 0),
                                        customerAccountId,
                                        invoiceType,
                                        false,
                                        row.item_code,
                                        row.variant_id || null
                                      );
                                    }
                                  }}
                                  onDoubleClick={(e) => {
                                    if (!row.item_id) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setShowSearchDropdown(false);
                                    setEditingItemName(null);
                                    setItemLogModalState({
                                      isOpen: true,
                                      itemId: row.item_id,
                                      itemCode: row.item_code,
                                      itemName: row.item_name,
                                      returnFocusId: `cell_${rIdx}_item_name`,
                                    });
                                  }}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setEditingItemName((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                      setShowSearchDropdown(false);
                                      setActiveSearchRowIdx((prev) => (prev === rIdx ? null : prev));
                                    }, 160);
                                  }}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedRowIndex(rIdx);
                                    setEditingItemName({ rowIdx: rIdx, value: val });
                                    if (val.trim().length > 0 || selectedCompanyFilter) {
                                      setActiveSearchRowIdx(rIdx);
                                      setShowSearchDropdown(true);
                                      runFastSearch(val);
                                    } else {
                                      setShowSearchDropdown(false);
                                      setSearchResults([]);
                                      setActiveSearchRowIdx(null);
                                    }
                                  }}
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'item_name')}
                                  placeholder={
                                    selectedCompanyFilter
                                      ? `Type Item Name in ${selectedCompanyFilter} (or F2)...`
                                      : 'Type Item Name / Code (or F2)...'
                                  }
                                  title={
                                    row.item_id
                                      ? `${formatItemNameWithRemarks(row.item_name, row.remarks)}${row.variant_name ? ` — ${row.variant_name}` : ''} — Double-click to open Complete ITEM LOG`
                                      : selectedCompanyFilter
                                      ? `Type Item Name / Code in ${selectedCompanyFilter} (or F2)`
                                      : 'Type Item Name / Code (or F2)'
                                  }
                                  className="w-full min-w-0 flex-1 px-0.5 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-semibold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none truncate"
                                />
                                {row.variant_name && (
                                  <span
                                    className="px-1 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[8.5px] font-bold shrink-0 max-w-[85px] truncate leading-tight"
                                    title={row.variant_name}
                                  >
                                    {row.variant_name}
                                  </span>
                                )}
                              </div>
                              {renderSalesExcelItemCombobox('row', rIdx)}
                            </td>
                          );
                        case 'quantity':
                          return (
                            <td
                              key={colKey}
                              className={`border-r border-slate-300 p-0 h-[16px] align-middle ${
                                isZeroQty
                                  ? 'bg-rose-100 text-rose-950 ring-1 ring-inset ring-rose-300'
                                  : 'bg-emerald-50/20'
                              } ${colHighlight('quantity')}`}
                            >
                              <NumericInput
                                id={`cell_${rIdx}_quantity`}
                                value={row.quantity}
                                allowNegative={true}
                                displayZero={hasItem}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'quantity')}
                                className={`w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold bg-transparent text-[11px] h-[15px] leading-none outline-none ${
                                  isZeroQty ? 'text-rose-950 placeholder:text-rose-700' : 'text-slate-900'
                                }`}
                              />
                            </td>
                          );
                        case 'discount_1':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle ${colHighlight('discount_1')}`}>
                              <NumericInput
                                id={`cell_${rIdx}_discount_1_percent`}
                                value={row.discount_1_percent}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'discount_1_percent', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'discount_1_percent')}
                                title="Discount 1 (%) applied first to Original Rate"
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>
                          );
                        case 'discount_2':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle ${colHighlight('discount_2')}`}>
                              <NumericInput
                                id={`cell_${rIdx}_discount_2_percent`}
                                value={row.discount_2_percent}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'discount_2_percent', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'discount_2_percent')}
                                title="Discount 2 (%) applied sequentially after Discount 1"
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>
                          );
                        case 'unit_price':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle ${colHighlight('unit_price')}`}>
                              <NumericInput
                                id={`cell_${rIdx}_unit_price`}
                                value={row.unit_price}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'unit_price')}
                                title={
                                  row.item_id
                                    ? 'Sale Price — Press Ctrl to view Customer Item History, or Space / H / F4 for Sales Price History'
                                    : 'Sale Price'
                                }
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>
                          );
                        case 'net_rate':
                          return (
                            <td
                              key={colKey}
                              className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-bold text-indigo-900 bg-indigo-50/40 text-[11px] h-[16px] align-middle select-none ${colHighlight('net_rate')}`}
                              title={
                                hasItem
                                  ? `Net Rate: ${Number(row.unit_price || 0).toFixed(2)} × (1 − ${row.discount_1_percent}%) × (1 − ${row.discount_2_percent}%) = ${Number(row.net_rate || 0).toFixed(2)}`
                                  : 'Calculated Net Rate (read-only)'
                              }
                            >
                              {hasItem ? Number(row.net_rate || 0).toFixed(2) : ''}
                            </td>
                          );
                        case 'loose_quantity':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 bg-teal-50/20 h-[16px] align-middle ${colHighlight('loose_quantity')}`}>
                              {isSyrupItem(row) ? (
                                <div className="flex items-center justify-center h-[15px] select-none">
                                  <span className="text-[8.5px] text-amber-800 bg-amber-100 border border-amber-300 px-1 py-0 rounded-lg font-bold whitespace-nowrap">
                                    Bottle
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center h-[15px]">
                                  <NumericInput
                                    id={`cell_${rIdx}_loose_quantity`}
                                    value={row.loose_quantity}
                                    allowNegative={true}
                                    onFocus={() => setSelectedRowIndex(rIdx)}
                                    onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                                    onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_quantity')}
                                    className="w-full px-1 py-0 border border-transparent focus:border-teal-600 focus:bg-white text-right font-mono font-bold text-teal-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                                  />
                                  {row.item_id && row.units_per_strip > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleAddStripToRow(rIdx, 1)}
                                      title={`Add 1 Strip (+${row.units_per_strip} Loose Units)`}
                                      className="px-0.5 py-0 rounded-lg bg-teal-100 hover:bg-teal-200 text-teal-800 font-mono text-[8px] font-bold shrink-0 cursor-pointer mr-0.5 leading-tight"
                                    >
                                      +1S
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        case 'loose_rate':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 bg-blue-50/20 h-[16px] align-middle ${colHighlight('loose_rate')}`}>
                              <NumericInput
                                id={`cell_${rIdx}_loose_rate`}
                                disabled={isSyrupItem(row)}
                                value={row.loose_rate}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_rate')}
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-blue-950 bg-transparent text-[11px] h-[15px] leading-none outline-none disabled:opacity-40"
                                title="Loose Rate per unit"
                              />
                            </td>
                          );
                        case 'bonus_quantity':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 bg-emerald-50/40 h-[16px] align-middle ${colHighlight('bonus_quantity')}`}>
                              <NumericInput
                                id={`cell_${rIdx}_bonus_quantity`}
                                value={row.bonus_quantity ?? 0}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'bonus_quantity', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'bonus_quantity')}
                                className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-emerald-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                                title="Bonus Quantity (Press Enter to add next item row)"
                              />
                            </td>
                          );
                        case 'amount':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle ${colHighlight('amount')}`}>
                              <input
                                id={`cell_${rIdx}_line_total`}
                                type="text"
                                readOnly
                                tabIndex={0}
                                value={hasItem ? Number(row.line_total || 0).toFixed(2) : ''}
                                onFocus={(e) => {
                                  setSelectedRowIndex(rIdx);
                                  e.currentTarget.select();
                                }}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'line_total')}
                                title="Net Amount (Press Enter to move to next row Item Code)"
                                className={`w-full px-1 py-0 border border-transparent focus:border-blue-600 text-right font-mono font-black text-[11px] h-[15px] leading-none outline-none ${
                                  isZeroNet
                                    ? 'bg-orange-100 text-rose-950 ring-1 ring-inset ring-orange-300 focus:bg-orange-50'
                                    : 'text-slate-900 bg-slate-50/60 focus:bg-white'
                                }`}
                              />
                            </td>
                          );
                        case 'roi': {
                          const accessRoi = hasItem ? rowRoiMap.get(row.row_id) : undefined;
                          const roiVal = accessRoi && accessRoi.roiAmount !== null ? accessRoi.roiAmount : null;
                          return (
                            <td
                              key={colKey}
                              className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-bold bg-emerald-50/40 text-[11px] h-[16px] align-middle tabular-nums ${
                                roiVal === null
                                  ? 'text-slate-400'
                                  : roiVal < 0
                                  ? 'text-rose-700'
                                  : 'text-emerald-900'
                              } ${colHighlight('roi')}`}
                              title={
                                hasItem && accessRoi?.hasValidCost
                                  ? `ROI = Net Selling (${accessRoi.netSellingAmount.toFixed(2)}) − Cost (${accessRoi.lineCost.toFixed(2)}) [Pack Cost: ${accessRoi.packCost.toFixed(4)}]`
                                  : hasItem
                                  ? 'No valid purchase cost or Pprice available'
                                  : ''
                              }
                            >
                              {roiVal !== null ? roiVal.toFixed(2) : ''}
                            </td>
                          );
                        }
                        case 'last_purchase_price':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-semibold text-amber-900 bg-amber-50/30 text-[11px] h-[16px] align-middle ${colHighlight('last_purchase_price')}`}>
                              {catPurchaseFallback > 0 ? catPurchaseFallback.toFixed(2) : ''}
                            </td>
                          );
                        case 'company':
                          return (
                            <td
                              key={colKey}
                              className={`border-r border-slate-300 p-0 text-slate-700 text-[10px] h-[16px] align-middle overflow-hidden ${colHighlight('company')}`}
                              title={hasItem ? row.company_name : selectedCompanyFilter || 'All Companies'}
                            >
                              {hasItem ? (
                                <div className="px-1 truncate">{row.company_name || ''}</div>
                              ) : (
                                <select
                                  aria-label={`Row ${rIdx + 1} Company Filter`}
                                  value={selectedCompanyFilter}
                                  onFocus={() => setSelectedRowIndex(rIdx)}
                                  onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                                  className={`w-full h-[15px] px-0.5 py-0 text-[10px] font-semibold bg-transparent focus:bg-white border border-transparent focus:border-blue-600 outline-none truncate ${
                                    selectedCompanyFilter ? 'text-emerald-900 bg-emerald-50/60' : 'text-slate-600'
                                  }`}
                                >
                                  <option value="">All Companies</option>
                                  {companyOptions.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          );
                        case 'gross_amount':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-semibold text-slate-700 bg-slate-50/30 text-[11px] h-[16px] align-middle ${colHighlight('gross_amount')}`}>
                              {hasItem && row.gross_amount !== 0 ? row.gross_amount.toFixed(2) : ''}
                            </td>
                          );
                        case 'remarks':
                          return (
                            <td key={colKey} className={`border-r border-slate-300 p-0 h-[16px] align-middle ${colHighlight('remarks')}`}>
                              <input
                                id={`cell_${rIdx}_remarks`}
                                type="text"
                                value={row.remarks || ''}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'remarks', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'remarks')}
                                placeholder={hasItem ? 'Remarks...' : ''}
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-left text-slate-800 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>
                          );
                        default:
                          return null;
                      }
                    };

                    return (
                      <tr
                        key={row.row_id}
                        data-sales-row-idx={rIdx}
                        data-zero-qty={isZeroQty ? 'true' : 'false'}
                        data-zero-net={isZeroNet ? 'true' : 'false'}
                        onMouseEnter={() => handleRowSelectorMouseEnter(rIdx)}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            const anchor = rowSelectionAnchorRef.current ?? selectedRowIndex;
                            rowSelectionAnchorRef.current = anchor;
                            setSelectedColKeys([]);
                            colSelectionAnchorRef.current = null;
                            setSelectedRowRange({ start: anchor, end: rIdx });
                          } else {
                            setSelectedRowRange(null);
                            rowSelectionAnchorRef.current = null;
                          }
                          setSelectedRowIndex(rIdx);
                        }}
                        className={`border-b border-slate-300 font-sans transition-colors h-[16px] leading-none ${
                          isMultiRowSelected
                            ? 'bg-sky-100/90 ring-1 ring-inset ring-sky-500 font-medium'
                            : isActiveSearchMatch
                            ? 'bg-amber-200/90 ring-2 ring-inset ring-amber-500 font-semibold'
                            : isSearchMatch
                            ? 'bg-sky-100/90 font-medium'
                            : isOverStock
                            ? 'bg-rose-100/90'
                            : isZeroRow
                            ? 'bg-orange-50/90 hover:bg-orange-100/75'
                            : isSelected
                            ? 'bg-amber-50/90 font-medium'
                            : rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/60 hover:bg-slate-100/60'
                        }`}
                      >
                        {/* Access Row Selector column showing ▶ on active row */}
                        <td
                          onMouseDown={(e) => handleRowSelectorMouseDown(rIdx, e)}
                          title="Click or drag down to select multiple rows · Press Shift+Delete to delete"
                          className={`border-r border-slate-300 px-0.5 py-0 text-center font-mono text-[9.5px] h-[16px] align-middle cursor-pointer select-none ${
                            isMultiRowSelected
                              ? 'bg-sky-600 text-white font-black'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {isMultiRowSelected ? (
                            <span className="text-[8.5px] font-black">✓</span>
                          ) : isSelected ? (
                            <span className="text-black font-black text-[8.5px]">▶</span>
                          ) : !row.item_id && rIdx === rows.length - 1 ? (
                            <span className="text-slate-400 font-bold">*</span>
                          ) : (
                            <span>{rIdx + 1}</span>
                          )}
                        </td>

                        {orderedSalesAccessColKeys.map((colKey) => renderSalesAccessCell(colKey))}

                        {/* Batch / Del */}
                        <td className="px-1 py-0 text-center h-[16px] align-middle">
                          <div className="flex items-center justify-center gap-0.5 h-[15px]">
                            {row.batches && row.batches.length > 0 ? (
                              <select
                                id={`cell_${rIdx}_batch_number`}
                                value={row.batch_number}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'batch_number', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'batch_number')}
                                className="w-14 px-0.5 py-0 border border-slate-300 rounded-lg font-mono text-[8.5px] bg-white h-[14px]"
                                title={`Packing: ${row.packing || '1x1'} | Select Batch`}
                              >
                                {row.batches.map((b) => (
                                  <option key={b.id} value={b.batch_number}>
                                    {b.batch_number} ({b.current_pack_qty}P)
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span
                                className="text-[9px] font-mono text-slate-500 w-14 truncate"
                                title={row.packing ? `Packing: ${row.packing}` : ''}
                              >
                                {row.batch_number || row.packing || ''}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rIdx);
                                openItemListForRow(rIdx);
                              }}
                              className="text-emerald-700 hover:text-emerald-950 font-bold text-[9.5px] cursor-pointer px-0.5 leading-none"
                              title="Select or change item from Item List"
                            >
                              <PackageSearch className="w-3 h-3 inline" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowRange(null);
                                setSelectedColKeys([]);
                                setSelectedRowIndex(rIdx);
                                requestDatasheetDeleteConfirm(rIdx);
                              }}
                              className="text-rose-600 hover:text-rose-900 font-bold text-[9.5px] cursor-pointer px-0.5 leading-none"
                              title="Delete row (Shift+Delete)"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Combined Microsoft Access Record Navigator, Invoice Search & Column Arrangement Strip */}
            <div className="ams-access-record-bar bg-slate-200 border-t border-slate-400 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {(selectedRowRange || selectedColKeys.length > 0) && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-100 border border-sky-300 text-sky-900 font-bold">
                    <span>
                      {selectedColKeys.length > 0
                        ? `Selected ${selectedColKeys.length} col(s): ${selectedColKeys
                            .map((k) => SALES_COL_LABELS[k] || k)
                            .join(', ')}`
                        : `Selected ${
                            Math.abs((selectedRowRange?.end ?? 0) - (selectedRowRange?.start ?? 0)) + 1
                          } row(s)`}
                    </span>
                    {selectedColKeys.length > 0 && (
                      <>
                        <button
                          type="button"
                          disabled={!canMoveSalesAccessLeft(selectedColKeys)}
                          onClick={() => moveSalesAccessColsLeft(selectedColKeys)}
                          title="Move selected column(s) left"
                          className="px-1.5 py-0 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer inline-flex items-center gap-0.5"
                        >
                          <ChevronLeft className="w-3 h-3" />
                          <span>Move Left</span>
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveSalesAccessRight(selectedColKeys)}
                          onClick={() => moveSalesAccessColsRight(selectedColKeys)}
                          title="Move selected column(s) right"
                          className="px-1.5 py-0 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer inline-flex items-center gap-0.5"
                        >
                          <span>Move Right</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => requestDatasheetDeleteConfirm(selectedRowIndex)}
                      className="px-1.5 py-0 rounded bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                    >
                      Shift+Del
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRowRange(null);
                        rowSelectionAnchorRef.current = null;
                        setSelectedColKeys([]);
                        colSelectionAnchorRef.current = null;
                      }}
                      className="px-1 py-0 rounded bg-white border border-sky-300 text-sky-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1 px-1.5 py-0 rounded bg-slate-100 border border-slate-300">
                  <span className="font-bold text-slate-600">Cols:</span>
                  <button
                    type="button"
                    disabled={!canMoveSalesAccessLeft(selectedColKeys)}
                    onClick={() => moveSalesAccessColsLeft(selectedColKeys)}
                    title={
                      selectedColKeys.length > 0
                        ? 'Move selected column left'
                        : 'Click a column header first, or drag any column header'
                    }
                    className="px-1 py-0 rounded bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-400 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-0.5"
                  >
                    <ChevronLeft className="w-2.5 h-2.5" />
                    <span>Left</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canMoveSalesAccessRight(selectedColKeys)}
                    onClick={() => moveSalesAccessColsRight(selectedColKeys)}
                    title={
                      selectedColKeys.length > 0
                        ? 'Move selected column right'
                        : 'Click a column header first, or drag any column header'
                    }
                    className="px-1 py-0 rounded bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-400 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-0.5"
                  >
                    <span>Right</span>
                    <ChevronRight className="w-2.5 h-2.5" />
                  </button>
                  {isSalesAccessColsCustomized && (
                    <button
                      type="button"
                      onClick={resetSalesAccessColOrder}
                      title="Restore default Sales column arrangement"
                      className="px-1 py-0 rounded bg-white hover:bg-amber-50 border border-slate-400 text-amber-800 font-bold cursor-pointer inline-flex items-center gap-0.5"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[10px] text-slate-700 mr-0.5">Record:</span>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(0)}
                    disabled={selectedRowIndex === 0}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="First Record (Home)"
                  >
                    |◀
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(selectedRowIndex - 1)}
                    disabled={selectedRowIndex === 0}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Previous Record (Up)"
                  >
                    ◀
                  </button>
                  <input
                    type="text"
                    value={recordJumpInput}
                    onChange={(e) => setRecordJumpInput(e.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={handleRecordJumpKeyDown}
                    onBlur={() => {
                      const parsed = parseInt(recordJumpInput, 10);
                      if (!Number.isNaN(parsed) && parsed >= 1) {
                        navigateToRecord(parsed - 1);
                      } else {
                        setRecordJumpInput(String(selectedRowIndex + 1));
                      }
                    }}
                    className="w-9 px-1 py-0 bg-white border border-slate-400 font-mono font-bold text-[10px] text-center text-slate-900 focus:border-blue-600 outline-none"
                    title="Type Record # and press Enter (or use Up/Down arrows)"
                  />
                  <span className="text-[10px] font-mono">of {rows.length}</span>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(selectedRowIndex + 1)}
                    disabled={selectedRowIndex >= rows.length - 1}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Next Record (Down)"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(rows.length - 1)}
                    disabled={selectedRowIndex >= rows.length - 1}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Last Record (End)"
                  >
                    ▶|
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertRow}
                    className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-100 border border-slate-400 text-[10px] font-bold text-emerald-800 cursor-pointer ml-0.5"
                    title="New (Blank) Record"
                  >
                    * New
                  </button>
                </div>
                <InvoiceRecordSearchInput
                  items={salesSearchableItems}
                  onPreviewMatch={handlePreviewSearchedSalesRow}
                  onNavigateToMatch={handleNavigateToSearchedSalesRow}
                  onMatchesChange={(matches, activeRow) => {
                    setInvoiceSearchMatchedRows(matches);
                    setInvoiceSearchActiveRow(activeRow);
                  }}
                />
              </div>

              {/* Inline Customer Last Sale History Info */}
              <div className="flex items-center gap-1.5 truncate">
                {activeRow?.item_id && activeItemHistory?.lastCustomerSale ? (
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="px-1 py-0 rounded-lg bg-slate-800 text-white text-[9px] font-bold">LAST SALE</span>
                    <span className="font-bold text-emerald-800">
                      {formatPKR(activeItemHistory.lastCustomerSale.unit_price)}
                    </span>
                    <span className="text-rose-700">
                      ({formatSequentialDiscountLabel(
                        activeItemHistory.lastCustomerSale.discount_1_percent,
                        activeItemHistory.lastCustomerSale.discount_2_percent,
                        activeItemHistory.lastCustomerSale.discount_percent
                      )} Disc)
                    </span>
                    <span className="text-slate-600">{formatAppDate(activeItemHistory.lastCustomerSale.invoice_date)}</span>
                    <button
                      type="button"
                      onClick={() => applyCustomerLastRateToRow(selectedRowIndex)}
                      className="px-1.5 py-0 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[9px] cursor-pointer"
                    >
                      Apply Rate
                    </button>
                  </div>
                ) : activeRow?.item_id ? (
                  <span className="text-[10px] text-slate-600 italic">
                    [{activeRow.item_code}] Standard {invoiceType} rate applied
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 hidden lg:inline">
                    Select item row for customer rate history
                  </span>
                )}
                {activeItemHistory?.lastPurchase && (
                  <span className="text-[10px] text-slate-600 font-mono hidden xl:inline">
                    | Cost: <strong>{formatPKR(activeItemHistory.lastPurchase.purchase_price)}</strong>
                  </span>
                )}
                {activeRow?.item_id && (
                  <button
                    type="button"
                    onClick={() => setShowCompactHistoryPopup((v) => !v)}
                    className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-50 border border-slate-400 text-slate-700 font-bold text-[9px] cursor-pointer"
                  >
                    {showCompactHistoryPopup ? 'Hide History ▲' : 'History ▼'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5 text-[10px] font-mono">
                <span>
                  Items: <strong className="text-slate-900">{validRows.length}</strong>
                </span>
                <span>
                  Units:{' '}
                  <strong className="text-slate-900">
                    {rows.reduce((sum, r) => sum + (r.total_units || 0), 0)}
                  </strong>
                </span>
                <span>
                  Gross: <strong className="text-emerald-800">{formatPKR(grossAmount)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Compact Item History Popup (MS Access View) */}
          {showCompactHistoryPopup && activeRow && (activeRow.item_code || activeRow.item_id) && (
            <CompactItemHistoryPopup
              isOpen={showCompactHistoryPopup}
              mode="sales"
              itemCode={activeRow.variant_code || activeRow.item_code}
              itemName={activeRow.item_name}
              variantName={activeRow.variant_name || null}
              thumbnailUrl={activeRow.variant_thumbnail_url || null}
              packing={activeRow.packing}
              selectedCustomerId={customerAccountId > 0 ? customerAccountId : null}
              selectedCustomerName={customerAccountId > 0 ? selectedCustomer?.account_name || '' : ''}
              historyData={activeItemHistory}
              loading={historyLoading}
              onClose={() => setShowCompactHistoryPopup(false)}
              onApplySaleRate={(rate, disc1Pct, disc2Pct = 0) => {
                updateRowField(selectedRowIndex, 'unit_price', round2(rate));
                updateRowField(selectedRowIndex, 'discount_1_percent', clampDiscountPercent(disc1Pct));
                updateRowField(selectedRowIndex, 'discount_2_percent', clampDiscountPercent(disc2Pct));
              }}
            />
          )}

          {/* ================= SECTION C (BOTTOM): COMPACT MS ACCESS CALCULATION & ACTION FOOTER ================= */}
          <div className="ams-pos-compact-chrome px-3 py-2 bg-slate-900 text-white border-t border-slate-700 flex flex-col gap-1.5 shrink-0">
            {/* Row 1: Slightly Larger & Clearer Payment & Total Settlement Section */}
            <div className="ams-access-payment-totals flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-1.5 tabular-nums">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1">
                  <span className="text-slate-300 font-semibold">A/C:</span>
                  <select
                    value={paymentAccountId || ''}
                    onChange={(e) => setPaymentAccountId(Number(e.target.value))}
                    className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-white font-semibold"
                  >
                    {financialAccounts.map((fa) => (
                      <option key={fa.id} value={fa.id}>
                        {fa.account_name} ({fa.account_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 border border-slate-700">
                  <span className="text-slate-300 font-bold">Grand Total ({validRows.length}):</span>
                  <span className="font-mono font-black text-white ams-payment-amount-lg">
                    {formatPKR(grossAmount)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/35 border border-rose-500/40">
                  <span className="text-rose-300 font-bold">Discount:</span>
                  <span className="font-mono font-black text-rose-300 ams-payment-amount-lg">
                    -{formatPKR(totalDiscount)}
                  </span>
                  <NumericInput
                    value={invoiceDiscountPercent}
                    onChange={(e) => {
                      const pct = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                      setInvoiceDiscountPercent(pct);
                      setInvoiceDiscountAmount(round2((subtotalAfterItemDisc * pct) / 100));
                    }}
                    className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-600 font-mono font-bold text-right text-white"
                    placeholder="%"
                    title="Invoice Discount %"
                  />
                  <NumericInput
                    value={invoiceDiscountAmount}
                    onChange={(e) => {
                      setInvoiceDiscountPercent(0);
                      setInvoiceDiscountAmount(Math.max(0, Number(e.target.value || 0)));
                    }}
                    className="w-20 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-600 font-mono font-bold text-right text-white"
                    placeholder="PKR"
                    title="Invoice Discount Amount"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-300 font-semibold">Cash Load:</span>
                  <NumericInput
                    value={deliveryCharges}
                    onChange={(e) => setDeliveryCharges(Math.max(0, Number(e.target.value || 0)))}
                    className="w-18 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono font-bold text-amber-300 text-right"
                    title="Delivery / Cash Load Charges"
                  />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 border border-amber-500/40">
                  <span className="text-slate-300 font-bold">Prev Bal:</span>
                  <span className="font-mono font-black text-amber-300 ams-payment-amount-lg">
                    {formatPKR(prevCustomerBalance)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="px-3 py-1 rounded-md bg-emerald-500/20 border-2 border-emerald-400/60 flex items-center gap-1.5 shadow-xs">
                  <span className="uppercase font-extrabold text-emerald-200">Net Amount:</span>
                  <span className="font-mono font-black text-emerald-300 ams-total-highlight">
                    {formatPKR(netInvoiceAmount)}
                  </span>
                </div>
                <div className="px-3 py-1 rounded-md bg-sky-500/20 border-2 border-sky-400/60 flex items-center gap-1.5 shadow-xs">
                  <span className="uppercase font-extrabold text-sky-200">Receivable:</span>
                  <span className="font-mono font-black text-sky-300 ams-total-highlight">
                    {formatPKR(totalReceivable)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-md border-2 border-emerald-500 shadow-xs">
                  <span className="uppercase font-extrabold text-emerald-300">Cash Rec:</span>
                  <NumericInput
                    value={paidAmountInput}
                    displayZero={Boolean(editingSaleId) || paidAmountInput.trim() === '0'}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="ams-cash-received-input w-32 px-2 py-0.5 rounded bg-slate-950 border border-emerald-500/60 text-right font-mono font-black text-emerald-300 outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={handleExactCash}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold cursor-pointer"
                  >
                    Exact
                  </button>
                </div>
                <div className="px-3 py-1 rounded-md bg-amber-500/20 border-2 border-amber-400/60 flex items-center gap-1.5 shadow-xs">
                  <span className="uppercase font-extrabold text-amber-200">
                    {paidAmount >= totalReceivable ? 'Change:' : 'Remaining:'}
                  </span>
                  <span className="font-mono font-black text-amber-300 ams-total-highlight">
                    {formatPKR(paidAmount >= totalReceivable ? round2(paidAmount - totalReceivable) : remainingBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Compact Action Buttons Bar (Primary Save/Hold on Left, Grouped Printer & Document Controls on Right) */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed')}
                  className={`px-3 py-0.5 rounded ${
                    editingSaleId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  } text-white font-black flex items-center gap-1 cursor-pointer`}
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingSaleId ? 'Update (Ctrl+S)' : 'Save (Ctrl+S)'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="px-2.5 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  Hold (F9)
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    const hasActiveItems = rows.some((r) => r.item_id !== null);
                    if (hasActiveItems) {
                      handleSaveInvoice('draft');
                    } else {
                      openPendingDrawer();
                    }
                  }}
                  title="Save current invoice to Pending, or click when empty (or click count) to open Pending Invoices list"
                  className="px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  <span>Pending</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      openPendingDrawer();
                    }}
                    title="Open Pending Invoices List"
                    className="ml-0.5 px-1 py-0 rounded bg-indigo-800/90 hover:bg-indigo-950 text-indigo-100 text-[10px] font-mono"
                  >
                    ({pendingInvoices.length})
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {/* Printer Group: Format Combo Box (A4 / Thermal 80mm / Thermal 58mm) + Print / Preview / PDF / Reprint */}
                <div className="inline-flex items-center gap-1 bg-slate-800/90 border border-slate-700 rounded px-1.5 py-0.5">
                  <Printer className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <select
                    value={selectedPrintFormat}
                    onChange={(e) => setSelectedPrintFormat(e.target.value as 'a4' | '80mm' | '58mm')}
                    aria-label="Printer Format"
                    className="px-1.5 py-0 rounded bg-slate-900 border border-slate-600 text-white font-bold cursor-pointer"
                  >
                    <option value="a4">A4</option>
                    <option value="80mm">Thermal 80mm</option>
                    <option value="58mm">Thermal 58mm</option>
                  </select>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSaveInvoice('completed', selectedPrintFormat)}
                    className="px-2.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                    title="Save and Print in selected format"
                  >
                    <Printer className="w-3 h-3" />
                    Print
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCurrentInvoicePreview(selectedPrintFormat)}
                    className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                    title="Print Preview in selected format"
                  >
                    <Eye className="w-3 h-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCurrentInvoicePdf}
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-sky-200 border border-slate-600 font-bold flex items-center gap-1 cursor-pointer"
                    title="Export this invoice in 80mm thermal PDF format"
                  >
                    <Download className="w-3 h-3" />
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleReprintLastInvoice}
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-blue-300 border border-slate-600 font-bold flex items-center gap-1 cursor-pointer"
                    title="Reprint last saved invoice"
                  >
                    <Printer className="w-3 h-3" />
                    Reprint
                  </button>
                </div>

                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={formattedInvoiceProfit}
                  className="w-24 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono font-bold text-[11px] text-right text-white tabular-nums outline-none select-all"
                />
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(true)}
                  className="px-2 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Discard
                </button>
                {onBackToDashboard && (
                  <button
                    type="button"
                    onClick={onBackToDashboard}
                    className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 1: ADVANCE TAX SHORTCUT ================= */}
      {showAdvanceTaxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Advance Tax Shortcut (Sales Billing)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer Name:</span>
                <span className="font-bold text-slate-900">{selectedCustomer?.account_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Applicable Tax Category:</span>
                <span className="font-bold text-emerald-700">{customerFilerStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Configured Rate:</span>
                <span className="font-mono font-bold">{configuredTaxRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Taxable Amount:</span>
                <span className="font-mono font-bold">{formatPKR(taxableAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <span className="font-bold text-slate-800">Calculated Advance Tax:</span>
                <span className="font-mono font-black text-amber-700">
                  {formatPKR(advanceTaxAmount)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-300 bg-white cursor-pointer">
                <span className="font-bold text-slate-800">
                  Apply Advance Tax on this Sales Invoice
                </span>
                <input
                  type="checkbox"
                  checked={advanceTaxApplicable}
                  onChange={(e) => setAdvanceTaxApplicable(e.target.checked)}
                  className="w-4 h-4"
                />
              </label>

              {advanceTaxApplicable && (
                <>
                  <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                    <span className="font-semibold text-slate-700">
                      Authorized Tax Rate Override / Exemption
                    </span>
                    <input
                      type="checkbox"
                      checked={isTaxOverridden}
                      onChange={(e) => {
                        setIsTaxOverridden(e.target.checked);
                        if (!e.target.checked) setAdvanceTaxRate(configuredTaxRate);
                      }}
                      className="w-4 h-4"
                    />
                  </label>

                  {isTaxOverridden && (
                    <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                          Overridden Advance Tax Rate (%) — Set 0 for Exemption
                        </label>
                        <NumericInput
                          value={advanceTaxRate}
                          onChange={(e) => setAdvanceTaxRate(Math.max(0, Number(e.target.value || 0)))}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                          Override Reason / Exemption Certificate #
                        </label>
                        <input
                          type="text"
                          value={taxOverrideReason}
                          onChange={(e) => setTaxOverrideReason(e.target.value)}
                          placeholder="e.g. Wholesale FBR Exemption Certificate..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(false)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 2A: CUSTOMER LEDGER PERIOD CHOICE POPUP ================= */}
      {showCustomerLedgerChoicePopup && selectedCustomer && (
        <div className="fixed inset-0 z-[60] bg-slate-900/55 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2">
                <Users2 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Select Customer Ledger Range</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerLedgerChoicePopup(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Selected Customer</div>
              <div className="text-xs font-bold text-slate-900 mt-0.5">
                [{selectedCustomer.account_code}] {selectedCustomer.account_name}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => fetchCustomerLedgerByRange('all')}
                className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
              >
                All Ledger
              </button>
              <button
                type="button"
                onClick={() => fetchCustomerLedgerByRange('last30')}
                className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
              >
                Last 30 Days Ledger
              </button>
              <button
                type="button"
                onClick={() => setShowCustomerLedgerChoicePopup(false)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: CUSTOMER ACCOUNT SHORTCUTS ================= */}
      {activeCustomerShortcut && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Users2 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 uppercase">
                  {activeCustomerShortcut === 'ledger' && 'Customer Detailed Ledger Statement'}
                  {activeCustomerShortcut === 'receive_payment' && 'Quick Receive Payment from Customer'}
                  {activeCustomerShortcut === 'add_customer' && 'Add New Customer Account'}
                  {activeCustomerShortcut === 'account_details' && 'Customer Account Details & Balance'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveCustomerShortcut(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeCustomerShortcut === 'account_details' && selectedCustomer && (
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-500">Account Code:</span>
                  <div className="font-mono font-bold text-slate-900">
                    {selectedCustomer.account_code}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Account Name:</span>
                  <div className="font-bold text-slate-900">{selectedCustomer.account_name}</div>
                </div>
                <div>
                  <span className="text-slate-500">Account Group:</span>
                  <div className="font-semibold">{selectedCustomer.account_group}</div>
                </div>
                <div>
                  <span className="text-slate-500">Filer Status:</span>
                  <div className="font-bold text-emerald-700">{selectedCustomer.filer_status}</div>
                </div>
                <div>
                  <span className="text-slate-500">Opening Balance:</span>
                  <div className="font-mono">
                    {formatPKR(selectedCustomer.opening_balance)} (
                    {selectedCustomer.opening_balance_type})
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Current Ledger Balance:</span>
                  <div className="font-mono font-black text-emerald-800">
                    {formatPKR(prevCustomerBalance)} ({prevBalanceType})
                  </div>
                </div>
                {liveBalanceSummary?.lastPayment && (
                  <div className="col-span-2 bg-white p-2.5 rounded-lg border border-emerald-200">
                    <span className="text-slate-500">Last Payment Received:</span>
                    <div className="font-mono font-bold text-emerald-700">
                      {formatPKR(liveBalanceSummary.lastPayment.amount)} on{' '}
                      {liveBalanceSummary.lastPayment.payment_date} (Ref:{' '}
                      {liveBalanceSummary.lastPayment.reference_no})
                    </div>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-slate-500">Phone & Address:</span>
                  <div className="text-slate-800">
                    {selectedCustomer.phone || 'N/A'} • {selectedCustomer.address || 'N/A'}
                  </div>
                </div>
              </div>
            )}

            {activeCustomerShortcut === 'ledger' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 p-3 rounded-lg">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <span>
                        {customerLedgerData?.selectedAccount?.account_name ||
                          selectedCustomer?.account_name}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                        {customerLedgerPeriod === 'last30' ? 'Last 30 Days Ledger' : 'All Ledger'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      Opening: {formatPKR(customerLedgerData?.summary?.openingBalance || 0)} (
                      {customerLedgerData?.summary?.openingBalanceType || 'Debit'})
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="inline-flex rounded-lg bg-white p-0.5 border border-slate-300 text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => fetchCustomerLedgerByRange('all')}
                        className={`px-2 py-1 rounded cursor-pointer ${
                          customerLedgerPeriod === 'all'
                            ? 'bg-emerald-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        All Ledger
                      </button>
                      <button
                        type="button"
                        onClick={() => fetchCustomerLedgerByRange('last30')}
                        className={`px-2 py-1 rounded cursor-pointer ${
                          customerLedgerPeriod === 'last30'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Last 30 Days
                      </button>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase text-slate-500 font-bold">
                        Closing Ledger Balance
                      </div>
                      <div className="font-mono font-black text-sm text-emerald-700">
                        {formatPKR(customerLedgerData?.summary?.closingBalance || 0)} (
                        {customerLedgerData?.summary?.closingBalanceType || 'Debit'})
                      </div>
                    </div>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-900 text-white sticky top-0">
                      <tr>
                        <th className="px-2.5 py-1.5">Date</th>
                        <th className="px-2.5 py-1.5">Ref #</th>
                        <th className="px-2.5 py-1.5">Narration</th>
                        <th className="px-2.5 py-1.5 text-right">Debit</th>
                        <th className="px-2.5 py-1.5 text-right">Credit</th>
                        <th className="px-2.5 py-1.5 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerLedgerLoading ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-500 font-medium">
                            Loading customer ledger statement...
                          </td>
                        </tr>
                      ) : (customerLedgerData?.entries || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400">
                            No posted ledger transactions found for this customer in the selected period.
                          </td>
                        </tr>
                      ) : (
                        (customerLedgerData?.entries || []).map((e: any) => (
                          <tr key={e.id} className="border-b border-slate-100">
                            <td className="px-2.5 py-1.5 font-mono">{formatAppDate(e.entry_date)}</td>
                            <td className="px-2.5 py-1.5 font-mono font-semibold">
                              {e.entry_number}
                            </td>
                            <td className="px-2.5 py-1.5">{e.narration || e.entry_description}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {e.debit_amount > 0 ? formatPKR(e.debit_amount) : '—'}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {e.credit_amount > 0 ? formatPKR(e.credit_amount) : '—'}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                              {formatPKR(e.running_balance)} {e.running_balance_type}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeCustomerShortcut === 'receive_payment' && (
              <form onSubmit={handleQuickReceivePayment} className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex justify-between">
                  <span>
                    Customer: <strong>{selectedCustomer?.account_name}</strong>
                  </span>
                  <span className="font-mono font-bold">
                    Current Balance: {formatPKR(prevCustomerBalance)} ({prevBalanceType})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Amount Received (PKR)
                    </label>
                    <NumericInput
                      min="1"
                      step="0.01"
                      required
                      value={quickReceiptAmount}
                      onChange={(e) => setQuickReceiptAmount(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={quickReceiptMethod}
                      onChange={(e) =>
                        setQuickReceiptMethod(e.target.value as 'Cash' | 'Bank Transfer')
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="Cash">Cash Counter Drawer</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Narration / Receipt Note
                  </label>
                  <input
                    type="text"
                    value={quickReceiptNotes}
                    onChange={(e) => setQuickReceiptNotes(e.target.value)}
                    placeholder="Receipt against previous balance..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                  >
                    Post Customer Receipt
                  </button>
                </div>
              </form>
            )}

            {activeCustomerShortcut === 'add_customer' && (
              <form onSubmit={handleQuickAddCustomer} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-500">
                        Account Code
                      </label>
                      <span className="text-[9px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                        Auto (Read-only)
                      </span>
                    </div>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={newCustCode}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold bg-slate-100 text-slate-800 cursor-not-allowed select-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Customer Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      placeholder="Clinic / Patient / Pharmacy Name"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Filer Status
                    </label>
                    <select
                      value={newCustFilerStatus}
                      onChange={(e) =>
                        setNewCustFilerStatus(e.target.value as 'Filer' | 'Non-Filer' | 'Exempt')
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="Filer">Filer</option>
                      <option value="Non-Filer">Non-Filer</option>
                      <option value="Exempt">Exempt</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={newCustAddress}
                    onChange={(e) => setNewCustAddress(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                  >
                    Create & Select Customer
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL 3: HELD INVOICES DRAWER ================= */}
      {showHeldDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Held Sales Invoices ({heldInvoices.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowHeldDrawer(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Net Amount</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {heldInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-5 text-center text-slate-400">
                        No held invoices currently saved.
                      </td>
                    </tr>
                  ) : (
                    heldInvoices.map((h) => (
                      <tr
                        key={h.id}
                        onClick={() => handleResumeInvoice(h.id)}
                        onDoubleClick={() => handleResumeInvoice(h.id)}
                        title="Click or double-click to open this held invoice in datasheet"
                        className="border-b border-slate-100 cursor-pointer hover:bg-emerald-50/70 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{h.invoice_number}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{formatAppDate(h.invoice_date)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {h.customer_name || 'Walk-in Cash Customer'}
                        </td>
                        <td className="px-3 py-2 uppercase font-bold text-amber-700">
                          {h.status}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(h.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResumeInvoice(h.id);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                          >
                            Resume
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
      )}

      {/* ================= MODAL 3B: PENDING INVOICES DRAWER (SEPARATE FROM HOLD LIST) ================= */}
      {showPendingDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Pending Sales Invoices ({pendingInvoices.length})
              </h3>
              <div className="flex items-center gap-2">
                {rows.some((r) => r.item_id !== null) && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={async () => {
                      setShowPendingDrawer(false);
                      await handleSaveInvoice('draft');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                  >
                    + Save Current Invoice to Pending
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPendingDrawer(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Net Amount</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-5 text-center text-slate-400">
                        No pending invoices currently saved.
                      </td>
                    </tr>
                  ) : (
                    pendingInvoices.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => handleResumeInvoice(p.id)}
                        onDoubleClick={() => handleResumeInvoice(p.id)}
                        title="Click or double-click to reopen this pending invoice in datasheet"
                        className="border-b border-slate-100 cursor-pointer hover:bg-indigo-50/70 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{p.invoice_number}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{formatAppDate(p.invoice_date)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {p.customer_name || 'Walk-in Cash Customer'}
                        </td>
                        <td className="px-3 py-2 uppercase font-bold text-indigo-700">
                          PENDING
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(p.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResumeInvoice(p.id);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                          >
                            Resume
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
      )}

      {/* ================= MODAL: FIND & EDIT EXISTING INVOICE ================= */}
      {showEditSearchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl p-5 text-xs space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Find & Edit Sales Invoice
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Load any completed or held invoice into the datasheet to make corrections, adjust quantities, or update items.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditSearchModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input Bar */}
            <div className="relative shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                autoFocus
                value={editSearchQuery}
                onChange={(e) => setEditSearchQuery(e.target.value)}
                placeholder="Search by Invoice # (e.g. INV-...), Customer Name, or Salesman..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
              />
            </div>

            {/* Results Table */}
            <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2.5">Invoice #</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5 text-right">Net Total</th>
                    <th className="px-3 py-2.5 text-right">Balance</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {editSearchLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Searching invoices...
                      </td>
                    </tr>
                  ) : editSearchResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No sales invoices matching &quot;{editSearchQuery}&quot; found.
                      </td>
                    </tr>
                  ) : (
                    editSearchResults.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b border-slate-100 hover:bg-amber-50/50 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">
                          {inv.invoice_number}
                          <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-600">
                            {inv.invoice_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700">{formatAppDate(inv.invoice_date)}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{inv.customer_name}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(inv.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-amber-800">
                          {formatPKR(inv.balance_amount)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              inv.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              handleResumeInvoice(inv.id);
                              setShowEditSearchModal(false);
                            }}
                            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold inline-flex items-center gap-1 shadow-xs cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            Load & Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 shrink-0">
              <span>Tip: Press <strong>Ctrl+E</strong> anytime on the sales screen to find and edit an invoice.</span>
              <button
                type="button"
                onClick={() => setShowEditSearchModal(false)}
                className="px-3 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: CONFIRM DISCARD INVOICE ================= */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm p-5 text-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Confirm Discard Invoice</h3>
            <p className="text-slate-600">
              Are you sure you want to clear all entered items on this invoice and start a fresh
              Sales Invoice?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetToNewInvoice}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
              >
                Yes, Discard Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4B: CONFIRM DATASHEET ROW / COLUMN DELETION ================= */}
      {pendingDatasheetDeleteConfirm && (
        <div
          className="fixed inset-0 z-[75] bg-slate-900/60 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setPendingDatasheetDeleteConfirm(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              executeConfirmedDatasheetDelete();
            }
          }}
        >
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl w-full max-w-sm p-5 text-xs space-y-4">
            <div className="flex items-center gap-2 text-rose-700">
              <Trash2 className="w-4 h-4 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900">
                {pendingDatasheetDeleteConfirm.kind === 'columns'
                  ? 'Confirm Clear Selected Column(s)'
                  : 'Confirm Delete Row(s)'}
              </h3>
            </div>
            <p className="text-slate-700 leading-relaxed">
              {pendingDatasheetDeleteConfirm.kind === 'columns'
                ? `Are you sure you want to clear all values in ${pendingDatasheetDeleteConfirm.label}?`
                : `Are you sure you want to permanently delete ${pendingDatasheetDeleteConfirm.label} from this Sales Invoice?`}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDatasheetDeleteConfirm(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              >
                Cancel (Esc)
              </button>
              <button
                type="button"
                autoFocus
                onClick={executeConfirmedDatasheetDelete}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
              >
                {pendingDatasheetDeleteConfirm.kind === 'columns'
                  ? 'Yes, Clear Column(s)'
                  : 'Yes, Delete Row(s)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 5: PRINT PREVIEW (A4 / 80mm / 58mm) ================= */}
      {printInvoice && (
        <SalesPrintModal
          invoice={printInvoice}
          initialFormat={printFormat}
          autoDirectPrint={autoExportPdfOnOpen}
          onClose={() => {
            setPrintInvoice(null);
            setAutoExportPdfOnOpen(false);
          }}
        />
      )}

      {/* ================= CUSTOM EXCEL EXPORT MODAL ================= */}
      <CustomExcelExportModal
        isOpen={customExportOpen}
        onClose={() => setCustomExportOpen(false)}
        moduleType="SALES"
        records={customExportRecords}
        defaultFilename={`Sales_Custom_Export_${invoiceDate}.xlsx`}
      />

      {/* ================= SALES INVOICE EXCEL IMPORT MODAL ================= */}
      <SalesInvoiceExcelImportModal
        isOpen={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        sampleCustomer={
          selectedCustomer
            ? { account_code: selectedCustomer.account_code, account_name: selectedCustomer.account_name }
            : undefined
        }
        sampleItems={catalogItems.slice(0, 2).map((it) => ({
          item_code: it.item_code,
          item_name: it.item_name,
          company_name: it.company_name,
          packing: it.packing,
          retail_price: it.retail_price,
        }))}
        onImportSuccess={async () => {
          await loadReferenceData();
          if (!editingSaleId) {
            try {
              const nextNumRes = await api.getNextSalesNumbers(invoiceDate);
              if (nextNumRes?.nextInvoiceNumber) {
                setInvoiceNumber(nextNumRes.nextInvoiceNumber);
              }
            } catch {
              // ignore
            }
          }
          setSuccessMsg('Sales Invoice(s) imported from Excel and stock/accounts updated.');
        }}
      />

      {/* ================= MODAL 6: DSR (DAILY STOCK REQUISITION) REPORT ================= */}
      {showDsrModal && (
        <SalesDsrReportModal
          isOpen={showDsrModal}
          onClose={() => setShowDsrModal(false)}
          storeName={storeDisplayName}
          invoiceNumber={invoiceNumber}
          invoiceDate={invoiceDate}
          customerName={
            customerAccountId > 0
              ? selectedCustomer?.account_name || 'Walk-in Cash Customer'
              : 'Walk-in Cash Customer'
          }
          isSavedInvoice={Boolean(editingSaleId)}
          rows={rows}
          catalogItems={catalogItems}
        />
      )}

      {/* ================= MODAL 7: SEND CUSTOMER SMS ================= */}
      {showSalesSmsModal && (
        <InvoiceSmsModal
          isOpen={showSalesSmsModal}
          mode="sales"
          title="Send SMS — Sales Invoice"
          initialPhone={salesSmsPhone}
          isPhoneFromAccounts={Boolean(salesSmsPhone)}
          customerLabel={
            customerAccountId > 0
              ? selectedCustomer?.account_name || 'Walk-in Cash Customer'
              : 'Walk-in Cash Customer'
          }
          initialMessage={salesSmsText}
          onClose={() => setShowSalesSmsModal(false)}
        />
      )}

      {/* ================= MODAL 8: EXPLICIT ITEM LIST SELECTOR ================= */}
      <ItemListSelectionModal
        isOpen={showItemListModal}
        items={companyFilteredCatalogItems}
        indexedItems={indexedCatalog}
        activeCompanyFilter={selectedCompanyFilter}
        onClearCompanyFilter={() => setSelectedCompanyFilter('')}
        targetRowIndex={itemListTargetRowIdx}
        targetRowItem={itemListTargetRowIdx !== null ? rows[itemListTargetRowIdx] : null}
        invoiceLabel="Sales Invoice"
        getItemRate={(it) =>
          invoiceType === 'Wholesale'
            ? round2(it.wholesale_price || it.trade_price || it.retail_price)
            : round2(it.retail_price)
        }
        getItemSalePrice={(it) =>
          invoiceType === 'Wholesale'
            ? round2(it.wholesale_price || it.trade_price || it.retail_price)
            : round2(it.retail_price)
        }
        getItemStock={(it) =>
          it.total_available_packs ??
          it.consolidated_stock_packs ??
          it.default_batch?.available_packs ??
          0
        }
        onSelectItem={(chosen) => {
          const targetIdx = itemListTargetRowIdx;
          setShowItemListModal(false);
          setItemListTargetRowIdx(null);

          if (Number(chosen.has_variants || 0) === 1 && getActiveVariants(chosen).length > 0) {
            setPendingVariantPicker({
              item: chosen,
              targetRowIdx: targetIdx,
              fromTopSearch: false,
              focusQty: true,
            });
            return;
          }

          const alreadyExists = rows.some(
            (r, idx) =>
              (targetIdx !== null ? idx !== targetIdx : true) &&
              r.item_id === chosen.id &&
              Number(r.variant_id || 0) === 0
          );
          if (alreadyExists) {
            setPendingDuplicatePrompt({
              item: chosen,
              variant: null,
              clearRowIdx: targetIdx !== null && rows[targetIdx]?.item_id === null ? targetIdx : null,
            });
            return;
          }

          if (targetIdx !== null) {
            populateRowWithItem(targetIdx, chosen, true, null);
          } else {
            const firstEmptyIdx = rows.findIndex((r) => r.item_id === null);
            const rowIdxToFill = firstEmptyIdx >= 0 ? firstEmptyIdx : rows.length;
            populateRowWithItem(rowIdxToFill, chosen, true, null);
          }
        }}
        onSwitchToAddNewLine={() => setItemListTargetRowIdx(null)}
        onClose={() => {
          setShowItemListModal(false);
          setItemListTargetRowIdx(null);
        }}
      />

      {/* ================= MODAL 9: DUPLICATE ITEM CONFIRMATION ================= */}
      <DuplicateItemConfirmModal
        isOpen={Boolean(pendingDuplicatePrompt)}
        itemCode={
          pendingDuplicatePrompt?.variant?.variant_code ||
          pendingDuplicatePrompt?.item.item_code
        }
        itemName={
          pendingDuplicatePrompt?.variant
            ? `${pendingDuplicatePrompt.item.item_name} — ${pendingDuplicatePrompt.variant.variant_name}`
            : pendingDuplicatePrompt?.item.item_name
        }
        onConfirmNewRow={handleConfirmAddDuplicateRow}
        onCancel={handleCancelDuplicatePrompt}
      />

      {/* ================= MODAL 9B: VARIANT PICKER FOR MULTI-VARIANT PRODUCTS ================= */}
      <VariantPickerModal
        isOpen={Boolean(pendingVariantPicker)}
        parentItem={pendingVariantPicker?.item || null}
        variants={getActiveVariants(pendingVariantPicker?.item)}
        mode="sales"
        onSelectVariant={(variant) => {
          const pending = pendingVariantPicker;
          setPendingVariantPicker(null);
          if (!pending) return;
          if (pending.fromTopSearch) {
            handleSelectFromTopSearch(
              pending.item,
              pending.targetRowIdx !== null ? pending.targetRowIdx : undefined,
              variant
            );
          } else {
            const targetIdx = pending.targetRowIdx;
            const alreadyExists = rows.some(
              (r, idx) =>
                (targetIdx !== null ? idx !== targetIdx : true) &&
                r.item_id === pending.item.id &&
                Number(r.variant_id || 0) === Number(variant.id)
            );
            if (alreadyExists) {
              setPendingDuplicatePrompt({
                item: pending.item,
                variant,
                clearRowIdx:
                  targetIdx !== null && rows[targetIdx]?.item_id === null ? targetIdx : null,
              });
              return;
            }
            const rowIdxToFill =
              targetIdx !== null
                ? targetIdx
                : (() => {
                    const firstEmptyIdx = rows.findIndex((r) => r.item_id === null);
                    return firstEmptyIdx >= 0 ? firstEmptyIdx : rows.length;
                  })();
            populateRowWithItem(rowIdxToFill, pending.item, pending.focusQty ?? true, variant);
          }
        }}
        onClose={() => setPendingVariantPicker(null)}
      />

      {/* ================= MODAL 10: CUSTOMER SALES PRICE HISTORY ================= */}
      <SalesPriceHistoryModal
        isOpen={priceHistoryModalState.isOpen}
        itemId={rows[priceHistoryModalState.rowIndex]?.item_id ?? null}
        itemCode={rows[priceHistoryModalState.rowIndex]?.item_code}
        itemName={rows[priceHistoryModalState.rowIndex]?.item_name}
        customerId={customerAccountId}
        customerName={
          customerAccountId > 0
            ? selectedCustomer?.account_name || customerSearchText || 'Selected Customer'
            : 'Walk-in Cash Customer'
        }
        onSelectPrice={(selectedPrice) => {
          const targetIdx = priceHistoryModalState.rowIndex;
          const focusId = priceHistoryModalState.returnFocusId;
          setRows((prev) => {
            const next = [...prev];
            const target = next[targetIdx];
            if (!target) return prev;
            const newPrice = round2(selectedPrice);
            const newLoose = target.isLooseRateManuallyEdited
              ? target.loose_rate
              : round2(newPrice / Math.max(1, target.units_per_pack));
            next[targetIdx] = recalcRow({
              ...target,
              unit_price: newPrice,
              loose_rate: newLoose,
              isRateManuallyEdited: true,
              rateSuggestionSource: 'customer_last_sale',
            });
            return next;
          });
          setPriceHistoryModalState((prev) => ({ ...prev, isOpen: false }));
          if (focusId) {
            window.setTimeout(() => {
              const el = document.getElementById(focusId) as HTMLInputElement | null;
              el?.focus();
              el?.select?.();
            }, 25);
          }
        }}
        onClose={() => {
          const focusId = priceHistoryModalState.returnFocusId;
          setPriceHistoryModalState((prev) => ({ ...prev, isOpen: false }));
          if (focusId) {
            window.setTimeout(() => {
              const el = document.getElementById(focusId) as HTMLInputElement | null;
              el?.focus();
              el?.select?.();
            }, 25);
          }
        }}
      />

      {/* ================= MODAL 11: COMPLETE ITEM LOG (DOUBLE-CLICK ITEM NAME) ================= */}
      <ItemLogModal
        isOpen={itemLogModalState.isOpen}
        itemId={itemLogModalState.itemId}
        initialItemCode={itemLogModalState.itemCode}
        initialItemName={itemLogModalState.itemName}
        defaultTab="sales"
        onClose={() => {
          const focusId = itemLogModalState.returnFocusId;
          setItemLogModalState((prev) => ({ ...prev, isOpen: false }));
          if (focusId) {
            window.setTimeout(() => {
              const el = document.getElementById(focusId) as HTMLInputElement | null;
              el?.focus();
            }, 25);
          }
        }}
      />

      {/* ================= MODAL 12: F9 EDIT SELECTED ITEM OR ADD NEW ITEM IN ITEM MASTER ================= */}
      <ItemFormModal
        isOpen={f9ItemMasterState.isOpen}
        editingItem={f9ItemMasterState.editingItem}
        onCompanyCreated={(companies) => {
          if (Array.isArray(companies)) {
            setCompanyMasterList(companies);
          }
        }}
        onClose={() => {
          const focusId = f9ItemMasterState.returnFocusId;
          setF9ItemMasterState((prev) => ({ ...prev, isOpen: false, editingItem: null }));
          if (focusId) {
            window.setTimeout(() => {
              const el = document.getElementById(focusId) as HTMLInputElement | null;
              el?.focus();
              el?.select?.();
            }, 25);
          }
        }}
        onSaved={(updatedItem) => {
          if (!updatedItem || !updatedItem.id) return;
          const wasEditing = Boolean(f9ItemMasterState.editingItem);
          const uAny = updatedItem as any;

          if (updatedItem.company_name && String(updatedItem.company_name).trim()) {
            const trimmedCompany = String(updatedItem.company_name).trim();
            setCompanyMasterList((prev) =>
              prev.some((c) => c.toLowerCase() === trimmedCompany.toLowerCase())
                ? prev
                : [...prev, trimmedCompany].sort((a, b) => a.localeCompare(b))
            );
          }

          setCatalogItems((prev) => {
            const exists = prev.some((c) => Number(c.id) === Number(updatedItem.id));
            if (exists) {
              return prev.map((c) =>
                Number(c.id) === Number(updatedItem.id)
                  ? {
                      ...c,
                      item_code: String(updatedItem.item_code || c.item_code),
                      company_name: String(updatedItem.company_name || c.company_name),
                      item_name: String(updatedItem.item_name || c.item_name),
                      generic_name: String(updatedItem.generic_name || c.generic_name || ''),
                      category: String(updatedItem.category || c.category || 'Tablet'),
                      packing: String(updatedItem.packing || c.packing || '1x1'),
                      barcode: String(updatedItem.barcode || c.barcode || ''),
                      purchase_price: Number(updatedItem.purchase_price || 0),
                      trade_price: Number(updatedItem.trade_price || 0),
                      wholesale_price: Number(updatedItem.wholesale_price || 0),
                      retail_price: Number(updatedItem.retail_price || 0),
                      loose_rate: Number(updatedItem.loose_rate || 0),
                      discount_percent: Number(updatedItem.discount_percent || 0),
                      tax_type: updatedItem.tax_type || 'percentage',
                      tax_value: Number(updatedItem.tax_value ?? updatedItem.tax_percent ?? 0),
                      tax_percent: Number(updatedItem.tax_percent || 0),
                      minimum_stock: Number(updatedItem.minimum_stock || 0),
                      rack_number: String(updatedItem.rack_number || ''),
                      strips_per_box: Number(uAny.strips_per_box || c.strips_per_box || 1),
                      tablets_per_strip: Number(
                        uAny.tablets_per_strip || uAny.units_per_strip || c.tablets_per_strip || c.units_per_strip || 1
                      ),
                      units_per_strip: Number(
                        uAny.tablets_per_strip || uAny.units_per_strip || c.units_per_strip || 1
                      ),
                      units_per_pack: Number(uAny.units_per_pack || c.units_per_pack || 1),
                      purchase_unit: uAny.purchase_unit || c.purchase_unit || 'Box',
                      has_variants: Number(updatedItem.has_variants || 0),
                      image_url: updatedItem.image_url ?? c.image_url,
                      thumbnail_url: updatedItem.thumbnail_url ?? c.thumbnail_url,
                    }
                  : c
              );
            }

            const unitsPerPack = Math.max(1, Number(uAny.units_per_pack || 1));
            const retailPrice = Number(updatedItem.retail_price || 0);
            const wholesalePrice = Number(
              updatedItem.wholesale_price || updatedItem.trade_price || retailPrice || 0
            );
            const purchasePrice = Number(updatedItem.purchase_price || 0);
            const looseRate =
              Number(updatedItem.loose_rate || 0) > 0
                ? Number(updatedItem.loose_rate)
                : round2(retailPrice / unitsPerPack);
            const openingStockPacks = Number(updatedItem.opening_stock || 0);
            const openingStockUnits = openingStockPacks * unitsPerPack;

            const newCatalogEntry: FastSearchItem = {
              id: Number(updatedItem.id),
              item_code: String(updatedItem.item_code || ''),
              company_name: String(updatedItem.company_name || ''),
              item_name: String(updatedItem.item_name || ''),
              generic_name: String(updatedItem.generic_name || ''),
              category: String(updatedItem.category || 'Tablet'),
              packing: String(updatedItem.packing || '1x1'),
              barcode: String(updatedItem.barcode || ''),
              purchase_price: purchasePrice,
              trade_price: Number(updatedItem.trade_price || 0),
              wholesale_price: wholesalePrice,
              retail_price: retailPrice,
              discount_percent: Number(updatedItem.discount_percent || 0),
              tax_type: updatedItem.tax_type || 'percentage',
              tax_value: Number(updatedItem.tax_value ?? updatedItem.tax_percent ?? 0),
              tax_percent: Number(updatedItem.tax_percent || 0),
              opening_stock: openingStockPacks,
              minimum_stock: Number(updatedItem.minimum_stock || 0),
              rack_number: String(updatedItem.rack_number || ''),
              status: String(updatedItem.status || 'Active'),
              carton: uAny.carton ?? null,
              boxes_per_carton: uAny.boxes_per_carton ?? null,
              strips_per_box: Number(uAny.strips_per_box || 1),
              tablets_per_strip: Number(uAny.tablets_per_strip || uAny.units_per_strip || 1),
              units_per_strip: Number(uAny.tablets_per_strip || uAny.units_per_strip || 1),
              units_per_pack: unitsPerPack,
              purchase_unit: uAny.purchase_unit || 'Box',
              loose_rate: looseRate,
              retail_loose_rate: looseRate,
              wholesale_loose_rate: round2(wholesalePrice / unitsPerPack),
              weighted_avg_pack_cost: purchasePrice > 0 ? purchasePrice : null,
              applicable_pack_cost: purchasePrice > 0 ? purchasePrice : null,
              has_valid_cost: purchasePrice > 0,
              cost_source: purchasePrice > 0 ? 'item_pprice' : 'none',
              cost_price_per_unit: purchasePrice > 0 ? purchasePrice / unitsPerPack : 0,
              total_available_units: openingStockUnits,
              total_available_packs: openingStockPacks,
              batch_number: 'OPENING',
              expiry_date: '2028-12-31',
              default_batch: {
                inventory_id: null,
                batch_number: 'OPENING',
                expiry_date: '2028-12-31',
                available_packs: openingStockPacks,
                available_units: openingStockUnits,
              },
              batches: [],
              has_variants: Number(updatedItem.has_variants || 0),
              active_variant_count: Array.isArray(updatedItem.variants)
                ? updatedItem.variants.length
                : 0,
              consolidated_stock_packs: openingStockPacks,
              variants: Array.isArray(updatedItem.variants) ? updatedItem.variants : [],
              image_url: updatedItem.image_url ?? null,
              thumbnail_url: updatedItem.thumbnail_url ?? null,
            };

            return [newCatalogEntry, ...prev];
          });

          // Hydrate server-side batch/stock fields for the newly registered or updated item
          api
            .fastSearchSalesItems(String(updatedItem.item_code || updatedItem.item_name || ''), 20)
            .then((res) => {
              const fetched: FastSearchItem[] = res?.data || res?.items || [];
              const hydrated = fetched.find((f) => Number(f.id) === Number(updatedItem.id));
              if (hydrated) {
                setCatalogItems((prev) =>
                  prev.map((c) => (Number(c.id) === Number(hydrated.id) ? { ...c, ...hydrated } : c))
                );
              }
            })
            .catch(() => {});

          setRows((prev) =>
            prev.map((r) => {
              if (Number(r.item_id) !== Number(updatedItem.id)) return r;
              const newUnitsPerPack = Math.max(
                1,
                Number(uAny.units_per_pack || r.units_per_pack || 1)
              );
              const newRetail = round2(Number(updatedItem.retail_price || r.retail_price_ref || 0));
              const newWholesale = round2(
                Number(
                  updatedItem.wholesale_price ||
                    updatedItem.trade_price ||
                    updatedItem.retail_price ||
                    r.wholesale_price_ref ||
                    0
                )
              );
              const updatedPrice = r.isRateManuallyEdited
                ? r.unit_price
                : invoiceType === 'Wholesale'
                ? newWholesale
                : newRetail;
              const updatedLoose = r.isLooseRateManuallyEdited
                ? r.loose_rate
                : round2(updatedPrice / newUnitsPerPack);

              return recalcRow({
                ...r,
                item_code: updatedItem.item_code || r.item_code,
                company_name: updatedItem.company_name || r.company_name,
                item_name: updatedItem.item_name || r.item_name,
                packing: r.variant_id ? r.packing : updatedItem.packing || r.packing,
                barcode: r.variant_id ? r.barcode : updatedItem.barcode || r.barcode,
                strips_per_box: Number(uAny.strips_per_box || r.strips_per_box || 1),
                units_per_strip: Number(
                  uAny.tablets_per_strip || uAny.units_per_strip || r.units_per_strip || 1
                ),
                units_per_pack: r.variant_id ? r.units_per_pack : newUnitsPerPack,
                unit_price: updatedPrice,
                loose_rate: updatedLoose,
                tax_type: r.variant_id
                  ? r.tax_type || 'percentage'
                  : updatedItem.tax_type || r.tax_type || 'percentage',
                tax_value: r.variant_id
                  ? Number(r.tax_value ?? r.tax_percent ?? 0)
                  : Number(updatedItem.tax_value ?? updatedItem.tax_percent ?? r.tax_value ?? r.tax_percent ?? 0),
                tax_percent: r.variant_id
                  ? r.tax_percent
                  : Number(updatedItem.tax_percent ?? r.tax_percent ?? 0),
                retail_price_ref: newRetail,
                wholesale_price_ref: newWholesale,
                lastPurchaseCostRate:
                  Number(updatedItem.purchase_price || 0) > 0
                    ? round2(updatedItem.purchase_price)
                    : r.lastPurchaseCostRate,
                saved_cost_price_per_unit: null,
                saved_fifo_batches_json: null,
              });
            })
          );

          setSuccessMsg(
            wasEditing
              ? `Item "${updatedItem.item_name}" [${updatedItem.item_code}] updated in Item Master.`
              : `Item "${updatedItem.item_name}" [${updatedItem.item_code}] registered and ready for selection.`
          );
        }}
      />
    </div>
  );
};
