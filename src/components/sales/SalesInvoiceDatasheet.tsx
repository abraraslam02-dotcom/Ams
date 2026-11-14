import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../../services/api';
import { prepareItemIndex, searchItems } from '../../utils/itemSearch';
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
import { formatPKR } from '../../utils/formatters';
import { SalesPrintModal } from './SalesPrintModal';
import { SalesDsrReportModal } from './SalesDsrReportModal';
import { NumericInput } from '../common/NumericInput';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import { SimpleSyncStatusBar } from '../common/SimpleSyncStatusBar';
import { ItemListSelectionModal } from '../common/ItemListSelectionModal';
import {
  InvoiceRecordSearchInput,
  InvoiceSearchableItem,
} from '../common/InvoiceRecordSearchInput';
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
  Download,
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
    inventory_id: null,
    item_code: '',
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
    discount_percent: 0,
    discount_amount: 0,
    loose_quantity: 0,
    loose_rate: 0,
    total_units: 0,
    gross_amount: 0,
    taxable_amount: 0,
    tax_percent: 0,
    tax_amount: 0,
    line_total: 0,
    retail_price_ref: 0,
    wholesale_price_ref: 0,
    batches: [],
    isRateManuallyEdited: false,
    isLooseRateManuallyEdited: false,
    rateSuggestionSource: 'standard_retail',
    lastCustomerSaleRate: null,
    lastCustomerDiscountPercent: null,
    lastCustomerSaleDate: null,
    lastCustomerInvoiceNo: null,
    lastCustomerSoldQty: null,
    previousCustomerSaleRateBeforeLast: null,
    lastPurchaseCostRate: null,
    lastPurchaseDate: null,
    lastSupplierName: null,
  };
}

export const MIN_DATASHEET_ROWS = 10;

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

function recalcRow(row: DatasheetRow): DatasheetRow {
  const isSyrup = isSyrupItem(row);
  const unitsPerPack = Math.max(1, Number(row.units_per_pack || 1));
  const quantity = Math.max(0, Number(row.quantity || 0));
  const bonusQuantity = Math.max(0, Number(row.bonus_quantity || 0));
  // Syrups are strictly sold as complete bottles; loose units are forced to 0
  const looseQty = isSyrup ? 0 : Math.max(0, Number(row.loose_quantity || 0));
  const unitPrice = Math.max(0, Number(row.unit_price || 0));
  const looseRate = isSyrup
    ? 0
    : !row.item_id
    ? Math.max(0, round2(Number(row.loose_rate || 0)))
    : row.isLooseRateManuallyEdited
    ? Math.max(0, round2(Number(row.loose_rate || 0)))
    : round2(unitPrice / unitsPerPack);

  // Stock units include Normal Qty + Bonus Qty
  const totalUnits = isSyrup
    ? round2((quantity + bonusQuantity) * unitsPerPack)
    : round2((quantity + bonusQuantity) * unitsPerPack + looseQty);
  // Financial calculation: Item gross amount, discount, tax, net total use Normal Qty only (bonus items are free)
  const gross = round2(quantity * unitPrice + (isSyrup ? 0 : looseQty * looseRate));
  const discPct = Math.max(0, Math.min(100, Number(row.discount_percent || 0)));
  const discAmt = round2((gross * discPct) / 100);
  const taxable = round2(Math.max(0, gross - discAmt));
  const taxPct = Math.max(0, Number(row.tax_percent || 0));
  const taxAmt = round2((taxable * taxPct) / 100);
  const lineTotal = round2(taxable + taxAmt);

  return {
    ...row,
    quantity,
    bonus_quantity: bonusQuantity,
    loose_quantity: looseQty,
    unit_price: unitPrice,
    loose_rate: looseRate,
    total_units: totalUnits,
    gross_amount: gross,
    discount_percent: discPct,
    discount_amount: discAmt,
    taxable_amount: taxable,
    tax_percent: taxPct,
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
  // Header State
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('Inv-2026-11-01');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [customerAccountId, setCustomerAccountId] = useState<number>(0);
  const [customerSearchText, setCustomerSearchText] = useState<string>('');

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

  useEffect(() => {
    setRecordJumpInput(String(selectedRowIndex + 1));
  }, [selectedRowIndex]);

  // Customer-Wise Item History & Purchase Cost Cache
  const [itemHistoryMap, setItemHistoryMap] = useState<Record<string, CustomerItemHistoryResponse>>({});
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyTab, setHistoryTab] = useState<'customer_sales' | 'item_purchases'>('customer_sales');
  const [showHistoryTable, setShowHistoryTable] = useState<boolean>(false);

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
  const [heldInvoices, setHeldInvoices] = useState<SalesInvoiceRecord[]>([]);

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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const posSearchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusTargetRef = useRef<string | null>(null);
  const draftRestoredRef = useRef<boolean>(false);
  const cancelledCodeEditRef = useRef<boolean>(false);
  const committedCodeEditRef = useRef<boolean>(false);

  // Shortcut Modals
  const [showAdvanceTaxModal, setShowAdvanceTaxModal] = useState<boolean>(false);
  const [activeCustomerShortcut, setActiveCustomerShortcut] = useState<
    null | 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  >(null);
  const [customerLedgerData, setCustomerLedgerData] = useState<Record<string, any> | null>(null);
  const [showHeldDrawer, setShowHeldDrawer] = useState<boolean>(false);
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
  const [autoWhatsappOnSave, setAutoWhatsappOnSave] = useState<boolean>(false);
  const [storeDisplayName, setStoreDisplayName] = useState<string>('ABRAR MEDICAL STORE');

  // Load initial reference data + restore draft from localStorage
  const loadReferenceData = useCallback(async () => {
    try {
      const [accountsRes, taxRes, nextNumRes, fastItemsRes, heldRes, smRes, dmRes, settingsRes] =
        await Promise.all([
          api.getAccounts({ status: 'Active' }),
          api.getAdvanceTaxSettings(),
          api.getNextSalesNumbers(invoiceDate),
          api.fastSearchSalesItems('', 20000),
          api.getSales({ status: 'held_or_draft', pageSize: 30 }),
          api.getSalesmen({ status: 'Active' }).catch(() => ({ data: [] })),
          api.getDeliverymen({ status: 'Active' }).catch(() => ({ data: [] })),
          api.getCompanySettings().catch(() => null),
        ]);

      if (settingsRes?.data) {
        if (settingsRes.data.store_name) {
          setStoreDisplayName(String(settingsRes.data.store_name));
        }
        setAutoWhatsappOnSave(Boolean(settingsRes.data.auto_whatsapp_on_save));
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
      setCatalogItems(fastItemsRes.data || []);
      setHeldInvoices(heldRes.data || []);

      const activeSalesmen: SalesmanRecord[] = (smRes.data || []).map((sm: SalesmanRecord) => ({
        ...sm,
        name: sm.name || sm.full_name || '',
      }));
      const activeDeliverymen: DeliverymanRecord[] = dmRes.data || [];
      setSalesmenList(activeSalesmen);
      setDeliverymenList(activeDeliverymen);

      const defaultWalkIn =
        partyCusts.find((c: any) => c.account_code === 'CUS-1001') || partyCusts[0];
      const defaultCash = finAccs.find((f: any) => f.account_code === 'FIN-1010') || finAccs[0];

      // Restore draft from localStorage if present with at least one active item and not resuming a specific DB invoice
      const savedDraftRaw = localStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
      if (savedDraftRaw && !resumeInvoiceId) {
        try {
          const parsed = JSON.parse(savedDraftRaw);
          if (
            parsed &&
            Array.isArray(parsed.rows) &&
            parsed.rows.some((r: any) => r && r.item_id !== null && Number(r.item_id) > 0)
          ) {
            setEditingSaleId(parsed.editingSaleId || null);
            setInvoiceNumber(
              parsed.editingSaleId
                ? parsed.invoiceNumber || nextNumRes.nextInvoiceNumber
                : nextNumRes.nextInvoiceNumber
            );
            setInvoiceDate(parsed.invoiceDate || new Date().toISOString().slice(0, 10));
            setCustomerAccountId(Number(parsed.customerAccountId || 0));
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

      setInvoiceNumber(nextNumRes.nextInvoiceNumber);
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

  // Fetch Customer-Specific Item Sale History & Last Purchase Cost
  const fetchAndApplyItemHistory = useCallback(
    async (
      rowIndex: number,
      itemId: number,
      custId: number,
      currentInvType: SalesInvoiceType,
      applySuggestedPricing: boolean = true
    ) => {
      if (!itemId) return;
      const cacheKey = `${itemId}_${custId || 0}`;
      try {
        setHistoryLoading(true);
        const res: CustomerItemHistoryResponse = await api.getItemCustomerHistory(itemId, custId);
        setItemHistoryMap((prev) => ({ ...prev, [cacheKey]: res }));

        const lastSale = res.lastCustomerSale;
        const prevBeforeLast = res.previousCustomerSaleBeforeLast;
        const lastPur = res.lastPurchase;

        setRows((prev) => {
          const next = [...prev];
          const target = next[rowIndex];
          if (!target || target.item_id !== itemId) return prev;

          const updatedRow: DatasheetRow = {
            ...target,
            lastCustomerSaleRate: lastSale ? round2(lastSale.unit_price) : null,
            lastCustomerDiscountPercent: lastSale ? round2(lastSale.discount_percent || 0) : null,
            lastCustomerSaleDate: lastSale ? String(lastSale.invoice_date) : null,
            lastCustomerInvoiceNo: lastSale ? String(lastSale.invoice_number) : null,
            lastCustomerSoldQty: lastSale ? Number(lastSale.quantity || 0) : null,
            previousCustomerSaleRateBeforeLast: prevBeforeLast ? round2(prevBeforeLast.unit_price) : null,
            lastPurchaseCostRate: lastPur ? round2(lastPur.purchase_price) : null,
            lastPurchaseDate: lastPur ? String(lastPur.bill_date) : null,
            lastSupplierName: lastPur ? String(lastPur.supplier_name || '') : null,
          };

          // Only apply auto-pricing when item is added/changed or customer explicitly changed, never on passive row click/navigation
          if (applySuggestedPricing && !target.isRateManuallyEdited && !target.isLooseRateManuallyEdited) {
            if (lastSale && Number(lastSale.unit_price) > 0) {
              const suggestedPrice = round2(lastSale.unit_price);
              const suggestedLoose =
                Number(lastSale.loose_rate) > 0
                  ? round2(lastSale.loose_rate)
                  : round2(suggestedPrice / Math.max(1, target.units_per_pack));
              updatedRow.unit_price = suggestedPrice;
              updatedRow.loose_rate = suggestedLoose;
              updatedRow.discount_percent = round2(lastSale.discount_percent || 0);
              updatedRow.rateSuggestionSource = 'customer_last_sale';
            } else {
              const fallbackPrice =
                currentInvType === 'Wholesale'
                  ? round2(target.wholesale_price_ref || target.unit_price)
                  : round2(target.retail_price_ref || target.unit_price);
              updatedRow.unit_price = fallbackPrice;
              updatedRow.loose_rate = round2(fallbackPrice / Math.max(1, target.units_per_pack));
              updatedRow.rateSuggestionSource =
                currentInvType === 'Wholesale' ? 'standard_wholesale' : 'standard_retail';
            }
          }

          next[rowIndex] = applySuggestedPricing ? recalcRow(updatedRow) : updatedRow;
          return next;
        });

        if (applySuggestedPricing) {
          // Also evaluate active Trade Deals & Party Special Discounts from the centralized engine
          const resCalc = await fetch('/api/enhancements/calculate-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_id: itemId,
              quantity: 0,
              party_account_id: custId || null,
            }),
          }).then((r) => r.json()).catch(() => null);

          if (resCalc?.success && resCalc.calculation) {
            const calc = resCalc.calculation;
            if (calc.effective_discount_percent > 0 || calc.bonus_quantity > 0) {
              setRows((prev) => {
                const next = [...prev];
                const target = next[rowIndex];
                if (!target || target.item_id !== itemId || target.isRateManuallyEdited) return prev;
                const updated = { ...target };
                if (calc.effective_discount_percent > 0) {
                  updated.discount_percent = round2(calc.effective_discount_percent);
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
        setHistoryLoading(false);
      }
    },
    []
  );

  const evaluateOfferAndPartyDiscountForRow = useCallback(
    async (rowIndex: number, itemId: number, qty: number, custId: number, unitPrice?: number) => {
      if (!itemId || qty <= 0) return;
      try {
        const resCalc = await fetch('/api/enhancements/calculate-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: itemId,
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
              if (!target || target.item_id !== itemId) return prev;
              const updated = { ...target };
              if (calc.effective_discount_percent > 0) {
                updated.discount_percent = round2(calc.effective_discount_percent);
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

  // When Customer changes, refresh Customer-Wise Last Sale History for all existing item rows
  const prevCustomerIdRef = useRef<number>(customerAccountId);
  useEffect(() => {
    if (customerAccountId > 0 && prevCustomerIdRef.current !== customerAccountId) {
      prevCustomerIdRef.current = customerAccountId;
      rows.forEach((r, idx) => {
        if (r.item_id) {
          fetchAndApplyItemHistory(idx, r.item_id, customerAccountId, invoiceType);
          evaluateOfferAndPartyDiscountForRow(idx, r.item_id, r.quantity, customerAccountId, r.unit_price);
        }
      });
    }
  }, [customerAccountId, rows, invoiceType, fetchAndApplyItemHistory, evaluateOfferAndPartyDiscountForRow]);

  // Also ensure the currently selected row has its history metadata loaded (never altering row rates/discounts on click)
  useEffect(() => {
    const activeRow = rows[selectedRowIndex];
    if (activeRow?.item_id && customerAccountId > 0) {
      const cacheKey = `${activeRow.item_id}_${customerAccountId}`;
      if (!itemHistoryMap[cacheKey]) {
        fetchAndApplyItemHistory(selectedRowIndex, activeRow.item_id, customerAccountId, invoiceType, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowIndex, customerAccountId]);

  // Automatically update next read-only invoice number when invoiceDate month/year changes on a new invoice
  useEffect(() => {
    if (editingSaleId) return;
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
  }, [invoiceDate, editingSaleId]);

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
      invoiceNumber,
      invoiceDate,
      customerAccountId,
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
      allowNegativeStock,
      remarks,
      rows,
    };
    localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [
    editingSaleId,
    invoiceNumber,
    invoiceDate,
    customerAccountId,
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
    allowNegativeStock,
    remarks,
    rows,
    onDraftItemsStateChange,
  ]);

  // Load specific Held/Draft invoice when resumeInvoiceId is passed
  const handleResumeInvoice = useCallback(
    async (idToResume: number) => {
      try {
        setErrorMsg(null);
        const res = await api.getSaleDetails(idToResume);
        const inv = res.data as SalesInvoiceRecord;
        setEditingSaleId(inv.id);
        setInvoiceNumber(inv.invoice_number);
        setInvoiceDate(inv.invoice_date);
        setCustomerAccountId(Number(inv.customer_account_id));
        setSalesmanId(inv.salesman_id ? Number(inv.salesman_id) : null);
        setSalesman(inv.salesman || 'Counter Pharmacist');
        setDeliverymanId(inv.deliveryman_id ? Number(inv.deliveryman_id) : null);
        setDeliverymanName(inv.deliveryman_name || '');
        setDeliveryStatus((inv.delivery_status as any) || 'Pending');
        setDeliveryCharges(Number(inv.delivery_charges || 0));
        setDeliveryNotes(inv.delivery_notes || '');
        setInvoiceType(inv.invoice_type || 'Retail');
        setPaymentMode(inv.payment_mode || 'Cash');
        setPaymentAccountId(inv.payment_account_id || null);
        setInvoiceDiscountPercent(Number(inv.invoice_discount_percent || 0));
        setInvoiceDiscountAmount(Number(inv.invoice_discount_amount || 0));
        setAdvanceTaxApplicable(Boolean(inv.advance_tax_applicable));
        setAdvanceTaxRate(Number(inv.advance_tax_rate || 0));
        setIsTaxOverridden(Boolean(inv.is_tax_overridden));
        setTaxOverrideReason(inv.tax_override_reason || '');
        setAllowNegativeStock(Boolean(inv.allow_negative_stock));
        setRemarks(inv.remarks || '');

        if (Array.isArray(inv.items) && inv.items.length > 0) {
          const loadedRows: DatasheetRow[] = inv.items.map((line: any) => {
            const catMatch = catalogItems.find((c) => c.id === Number(line.item_id));
            return recalcRow({
              row_id: `row_${line.id}_${Math.random().toString(36).slice(2, 6)}`,
              item_id: Number(line.item_id),
              inventory_id: line.inventory_id ? Number(line.inventory_id) : null,
              item_code: String(line.item_code),
              company_name: String(line.company_name || catMatch?.company_name || ''),
              item_name: String(line.item_name),
              packing: String(line.packing || '1x1'),
              strips_per_box: catMatch?.strips_per_box || 1,
              units_per_strip: catMatch?.units_per_strip || Number(line.units_per_pack || 1),
              units_per_pack: Number(line.units_per_pack || 1),
              batch_number: String(line.batch_number),
              expiry_date: String(line.expiry_date),
              available_stock_packs: Number(line.available_stock_packs || catMatch?.total_available_packs || 0),
              available_stock_units: Number(line.available_stock_units || catMatch?.total_available_units || 0),
              quantity: Number(line.quantity || 0),
              bonus_quantity: Number(line.bonus_quantity || 0),
              unit_price: Number(line.unit_price || 0),
              discount_percent: Number(line.discount_percent || 0),
              discount_amount: Number(line.discount_amount || 0),
              loose_quantity: Number(line.loose_quantity || 0),
              loose_rate: Number(line.loose_rate || 0),
              total_units: Number(line.total_units || 0),
              gross_amount: Number(line.gross_amount || 0),
              taxable_amount: Number(line.taxable_amount || 0),
              tax_percent: Number(line.tax_percent || 0),
              tax_amount: Number(line.tax_amount || 0),
              line_total: Number(line.line_total || 0),
              retail_price_ref: Number(catMatch?.retail_price || line.unit_price || 0),
              wholesale_price_ref: Number(catMatch?.wholesale_price || line.unit_price || 0),
              batches: catMatch?.batches || [],
              isRateManuallyEdited: true,
              isLooseRateManuallyEdited: true,
              rateSuggestionSource: 'manual',
            });
          });
          setRows(ensureMinimumRows(loadedRows));
        }
        setShowHeldDrawer(false);
        setSuccessMsg(`Loaded Invoice ${inv.invoice_number} (${inv.status.toUpperCase()}) into datasheet.`);
        if (onClearResume) onClearResume();
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [catalogItems, onClearResume]
  );

  useEffect(() => {
    if (resumeInvoiceId) {
      handleResumeInvoice(resumeInvoiceId);
    }
  }, [resumeInvoiceId, handleResumeInvoice]);

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

  // Switch Retail / Wholesale Pricing automatically on existing rows (without overwriting manual or customer-history rates!)
  const handleInvoiceTypeChange = (newType: SalesInvoiceType) => {
    setInvoiceType(newType);
    setRows((prev) =>
      prev.map((row) => {
        if (!row.item_id) return row;
        if (row.isRateManuallyEdited || row.rateSuggestionSource === 'customer_last_sale') {
          return row;
        }
        const targetPrice =
          newType === 'Wholesale'
            ? row.wholesale_price_ref || row.unit_price
            : row.retail_price_ref || row.unit_price;
        const targetLoose = round2(targetPrice / Math.max(1, row.units_per_pack));
        return recalcRow({
          ...row,
          unit_price: targetPrice,
          loose_rate: targetLoose,
          rateSuggestionSource: newType === 'Wholesale' ? 'standard_wholesale' : 'standard_retail',
        });
      })
    );
  };

  // Pre-indexed catalog for sub-millisecond local search across 10,000+ items
  const indexedCatalog = useMemo(() => prepareItemIndex(catalogItems), [catalogItems]);

  // Fast Item Search Handler - Instant in-memory search + race-guarded live DB query for 10,000+ items
  const runFastSearch = useCallback(
    (query: string) => {
      const cleanQuery = String(query || '').trim();
      const results = searchItems(indexedCatalog, cleanQuery, 50);
      setSearchResults(results);
      setSearchHighlightIdx(0);

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      if (!cleanQuery) return;

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

            const combinedMap = new Map<number, FastSearchItem>();
            for (const f of fetched) combinedMap.set(Number(f.id), f);
            for (const r of results) {
              if (!combinedMap.has(Number(r.id))) combinedMap.set(Number(r.id), r);
            }
            const ranked = searchItems(prepareItemIndex(Array.from(combinedMap.values())), cleanQuery, 50);
            if (searchRequestIdRef.current === reqId) {
              setSearchResults(ranked);
              setSearchHighlightIdx(0);
            }
          })
          .catch(() => {
            // Keep instant local results on offline/network hiccup
          });
      }, 90);
    },
    [indexedCatalog]
  );

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

  // Populate a datasheet row with a selected FastSearchItem + trigger Customer-Wise Item History lookup
  const populateRowWithItem = (rowIdx: number, item: FastSearchItem, focusQuantityAfter: boolean = true) => {
    const defaultPrice =
      invoiceType === 'Wholesale'
        ? round2(item.wholesale_price || item.trade_price || item.retail_price)
        : round2(item.retail_price);
    const calculatedLooseRate = round2(defaultPrice / Math.max(1, Number(item.units_per_pack || 1)));
    const defaultLooseRate = calculatedLooseRate;
    const batch = item.default_batch;

    setRows((prev) => {
      const updated = [...prev];
      while (updated.length <= rowIdx) {
        updated.push(createEmptyRow());
      }
      const targetRow = updated[rowIdx] || createEmptyRow();
      const preserveManual = targetRow.item_id === item.id && targetRow.isRateManuallyEdited;
      const preserveManualLoose = targetRow.item_id === item.id && targetRow.isLooseRateManuallyEdited;
      const effectivePrice = preserveManual ? targetRow.unit_price : defaultPrice;
      const effectiveLoose = preserveManualLoose
        ? targetRow.loose_rate
        : round2(effectivePrice / Math.max(1, Number(item.units_per_pack || 1)));

      updated[rowIdx] = recalcRow({
        ...targetRow,
        item_id: item.id,
        inventory_id: batch.inventory_id,
        item_code: item.item_code,
        company_name: item.company_name || '',
        item_name: item.item_name,
        packing: item.packing || '1x1',
        strips_per_box: item.strips_per_box || 1,
        units_per_strip: item.units_per_strip || 1,
        units_per_pack: item.units_per_pack || 1,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        available_stock_packs: batch.available_packs,
        available_stock_units: batch.available_units,
        quantity: targetRow.item_id === item.id && targetRow.quantity > 0 ? targetRow.quantity : 0,
        bonus_quantity: targetRow.item_id === item.id && Number(targetRow.bonus_quantity || 0) > 0 ? targetRow.bonus_quantity : 0,
        unit_price: effectivePrice,
        discount_percent: preserveManual ? targetRow.discount_percent : Number(item.discount_percent || 0),
        loose_quantity: targetRow.item_id === item.id ? targetRow.loose_quantity || 0 : 0,
        loose_rate: effectiveLoose,
        tax_percent: Number(item.tax_percent || 0),
        retail_price_ref: round2(item.retail_price),
        wholesale_price_ref: round2(item.wholesale_price || item.trade_price || item.retail_price),
        item_loose_rate_ref: defaultLooseRate,
        batches: item.batches || [],
        isRateManuallyEdited: Boolean(preserveManual),
        isLooseRateManuallyEdited: Boolean(preserveManualLoose),
        rateSuggestionSource: preserveManual
          ? 'manual'
          : invoiceType === 'Wholesale'
          ? 'standard_wholesale'
          : 'standard_retail',
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

    // Fetch Customer-Specific Last Sale Rate, Discount, Date, Invoice#, and Last Purchase Cost
    fetchAndApplyItemHistory(rowIdx, item.id, customerAccountId, invoiceType, true);

    if (focusQuantityAfter) {
      const targetId =
        invoiceViewMode === 'pos'
          ? `pos_row_${rowIdx}_quantity`
          : `cell_${rowIdx}_quantity`;
      pendingFocusTargetRef.current = targetId;
      setTimeout(() => {
        const rowQtyEl = document.getElementById(`pos_row_${rowIdx}_quantity`) as HTMLInputElement | null;
        rowQtyEl?.closest('tr')?.scrollIntoView({ block: 'nearest' });
        const qtyEl =
          (document.getElementById(targetId) as HTMLInputElement | null) ||
          (invoiceViewMode === 'pos'
            ? (document.getElementById('pos_active_quantity') as HTMLInputElement | null)
            : null);
        if (qtyEl) {
          qtyEl.focus();
          qtyEl.select?.();
          qtyEl.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      }, 30);
    }
  };

  // Explicit Item Code validation & update: only modifies existing row if new code resolves to a valid catalog item
  const commitItemCodeChange = (
    rowIdx: number,
    rawDraft: string,
    moveFocusToQty: boolean = false
  ): boolean => {
    const trimmed = rawDraft.trim();
    const currentRow = rows[rowIdx];
    const existingCode = String(currentRow?.item_code || '').trim();

    setEditingItemCode((prev) => (prev?.rowIdx === rowIdx ? null : prev));

    if (trimmed === existingCode) {
      if (moveFocusToQty && currentRow?.item_id) {
        const prefix = invoiceViewMode === 'pos' ? 'pos_row' : 'cell';
        focusCell(rowIdx, 'quantity', prefix);
      }
      return false;
    }

    if (!trimmed) {
      if (currentRow?.item_id) {
        setErrorMsg('To remove an item from the invoice, please click its Delete button.');
      }
      return false;
    }

    const lower = trimmed.toLowerCase();
    const matched = catalogItems.find(
      (it) =>
        it.item_code.toLowerCase() === lower ||
        (it.barcode && it.barcode.toLowerCase() === lower)
    );

    if (!matched) {
      setErrorMsg(
        currentRow?.item_id
          ? `Item Code "${trimmed}" not found. Existing item [${existingCode}] was preserved.`
          : `Item Code "${trimmed}" not found in catalog.`
      );
      return false;
    }

    setErrorMsg(null);
    if (currentRow?.item_id === matched.id) {
      if (moveFocusToQty) {
        const prefix = invoiceViewMode === 'pos' ? 'pos_row' : 'cell';
        focusCell(rowIdx, 'quantity', prefix);
      }
      return true;
    }

    populateRowWithItem(rowIdx, matched, moveFocusToQty);
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
  const handleSelectFromTopSearch = (item: FastSearchItem, targetRowOverride?: number) => {
    const existingDuplicateIdx = rows.findIndex((r) => r.item_id === item.id);
    const activeIdx =
      targetRowOverride !== undefined
        ? targetRowOverride
        : activeSearchRowIdx !== null && rows[activeSearchRowIdx]?.item_id === null
        ? activeSearchRowIdx
        : null;

    if (existingDuplicateIdx >= 0 && existingDuplicateIdx !== activeIdx) {
      // If user was typing in an empty row and picked an item already on the invoice, clear temporary typing and focus existing row's Qty
      if (activeIdx !== null && rows[activeIdx] && rows[activeIdx].item_id === null) {
        setRows((prev) => {
          const next = [...prev];
          next[activeIdx] = createEmptyRow();
          return next;
        });
      }
      committedCodeEditRef.current = true;
      setSelectedRowIndex(existingDuplicateIdx);
      setShowSearchDropdown(false);
      setQuickSearchQuery('');
      setSearchResults([]);
      setActiveSearchRowIdx(null);
      setEditingItemCode(null);
      setEditingItemName(null);

      const qtyId =
        invoiceViewMode === 'pos'
          ? `pos_row_${existingDuplicateIdx}_quantity`
          : `cell_${existingDuplicateIdx}_quantity`;
      pendingFocusTargetRef.current = qtyId;
      setTimeout(() => {
        const qtyEl =
          (document.getElementById(qtyId) as HTMLInputElement | null) ||
          (invoiceViewMode === 'pos'
            ? (document.getElementById('pos_active_quantity') as HTMLInputElement | null)
            : null);
        if (qtyEl) {
          qtyEl.focus();
          qtyEl.select?.();
          qtyEl.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      }, 30);
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
    populateRowWithItem(rowIdxToFill, item, true);
  };

  // Reusable Excel-Style Item Search Combobox Table (Item Name | Company Name | Purchase Price | Sale Price)
  const renderSalesExcelItemCombobox = (context: 'top' | 'row', rowIdx?: number) => {
    if (!showSearchDropdown) return null;
    if (context === 'top' && activeSearchRowIdx !== null) return null;
    if (context === 'row' && activeSearchRowIdx !== rowIdx) return null;

    return (
      <div
        className={
          context === 'top'
            ? 'absolute left-0 right-0 top-full mt-1 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl min-w-[580px] max-w-[850px] overflow-hidden'
            : 'absolute left-0 top-full mt-0.5 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl min-w-[540px] max-w-[700px] overflow-hidden'
        }
      >
        <div className="px-2.5 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center">
          <span>
            Matching Items ({searchResults.length}) • Search by Name, Company, Code or Barcode
          </span>
          <span className="font-mono text-emerald-700">↑/↓ Navigate • Enter Select • Esc Close</span>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {searchResults.length === 0 ? (
            <div className="p-4 text-center text-base font-bold text-slate-600">
              No Item Found
            </div>
          ) : (
            <table className="w-full text-left text-[11px] border-collapse">
              <thead className="bg-slate-200 text-slate-800 sticky top-0 z-10 border-b border-slate-300 text-[10px] font-bold uppercase">
                <tr>
                  <th className="px-2.5 py-1 border-r border-slate-300">Item Name</th>
                  <th className="px-2.5 py-1 border-r border-slate-300">Company Name</th>
                  <th className="px-2.5 py-1 border-r border-slate-300 text-right">Purchase Price</th>
                  <th className="px-2.5 py-1 text-right">Sale Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {searchResults.map((it, idx) => {
                  const isHighlighted = idx === searchHighlightIdx;
                  const purchasePrice = round2(
                    Number((it as any).purchase_price || it.default_batch?.available_packs ? (it as any).purchase_price : 0) ||
                      Number((it as any).purchase_price || 0)
                  );
                  const salePrice =
                    invoiceType === 'Wholesale'
                      ? round2(it.wholesale_price || it.trade_price || it.retail_price)
                      : round2(it.retail_price);
                  return (
                    <tr
                      key={it.id}
                      data-sales-search-idx={idx}
                      onMouseEnter={() => setSearchHighlightIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectFromTopSearch(it, rowIdx);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] ${
                        isHighlighted
                          ? 'bg-emerald-100 text-slate-950 font-bold'
                          : 'hover:bg-emerald-50/70 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1 border-r border-slate-200">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="truncate">
                            <span className="font-mono text-[10px] text-emerald-700 font-bold mr-1">
                              [{it.item_code}]
                            </span>
                            <span className="font-bold text-slate-900">{it.item_name}</span>
                            <span className="text-[10px] text-slate-500 ml-1">({it.packing})</span>
                          </div>
                          <span
                            className={`text-[9.5px] font-mono px-1 rounded shrink-0 ${
                              (it.total_available_packs || 0) > 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-600'
                            }`}
                          >
                            Stk: {it.total_available_packs ?? it.default_batch?.available_packs ?? 0}P
                          </span>
                        </div>
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-slate-700 truncate max-w-[160px]">
                        {it.company_name || '—'}
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-right font-mono font-semibold text-slate-700">
                        Rs. {purchasePrice.toFixed(2)}
                      </td>
                      <td className="px-2.5 py-1 text-right font-mono font-black text-emerald-800">
                        Rs. {salePrice.toFixed(2)}
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
        discount_percent: round2(r.lastCustomerDiscountPercent ?? r.discount_percent),
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
        current.loose_quantity = isSyrupItem(current) ? 0 : Math.max(0, Number(value || 0));
      } else if (field === 'discount_amount') {
        const discAmt = Math.max(0, Number(value || 0));
        const gross = round2(
          current.quantity * current.unit_price + current.loose_quantity * current.loose_rate
        );
        current.discount_amount = discAmt;
        current.discount_percent = gross > 0 ? round2((discAmt / gross) * 100) : 0;
      } else if (field === 'quantity') {
        const nextQty = Math.max(0, Number(value || 0));
        current.quantity = nextQty;
        if (current.item_id && nextQty > 0) {
          setTimeout(() => {
            evaluateOfferAndPartyDiscountForRow(
              rowIndex,
              Number(current.item_id),
              nextQty,
              customerAccountId,
              current.unit_price
            );
          }, 10);
        }
      } else if (field === 'bonus_quantity') {
        current.bonus_quantity = Math.max(0, Number(value || 0));
      } else if (field === 'discount_percent') {
        current.discount_percent = Math.max(0, Math.min(100, Number(value || 0)));
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
    setRows((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index);
      const next = ensureMinimumRows(filtered);
      const nextIdx = Math.max(0, Math.min(index, next.length - 1));
      setSelectedRowIndex(nextIdx);
      return next;
    });
  };

  const handleCopyRow = (index: number) => {
    const r = rows[index];
    if (!r) return;
    setCopiedRowData({
      quantity: r.quantity,
      bonus_quantity: r.bonus_quantity || 0,
      unit_price: r.unit_price,
      discount_percent: r.discount_percent,
      loose_quantity: r.loose_quantity,
      loose_rate: r.loose_rate,
    });
    setSuccessMsg(`Copied values (Qty, Bonus Qty, Price, Discount %, Loose Qty) from Row #${index + 1}.`);
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

  // Automatic Bill Calculations
  const validRows = rows.filter((r) => r.item_id !== null);
  const grossAmount = round2(validRows.reduce((s, r) => s + r.gross_amount, 0));
  const itemDiscountTotal = round2(validRows.reduce((s, r) => s + r.discount_amount, 0));
  const subtotalAfterItemDisc = round2(Math.max(0, grossAmount - itemDiscountTotal));

  const computedInvoiceDiscAmt =
    invoiceDiscountPercent > 0
      ? round2((subtotalAfterItemDisc * invoiceDiscountPercent) / 100)
      : round2(Math.min(subtotalAfterItemDisc, invoiceDiscountAmount));

  const totalDiscount = round2(itemDiscountTotal + computedInvoiceDiscAmt);
  const taxableAmount = round2(Math.max(0, grossAmount - totalDiscount));
  const gstAmount = round2(validRows.reduce((s, r) => s + r.tax_amount, 0));

  const effectiveAdvTaxRate = advanceTaxApplicable ? round2(advanceTaxRate) : 0;
  const advanceTaxAmount = advanceTaxApplicable
    ? round2(((taxableAmount + gstAmount) * effectiveAdvTaxRate) / 100)
    : 0;

  const totalTax = round2(gstAmount + advanceTaxAmount);
  const netInvoiceAmount = round2(taxableAmount + totalTax);

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
    setEditingSaleId(null);
    setCustomerAccountId(0);
    setCustomerSearchText('');
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
    try {
      const nextNums = await api.getNextSalesNumbers(invoiceDate);
      setInvoiceNumber(nextNums.nextInvoiceNumber);
      await loadReferenceData();
    } catch {
      // ignore
    }
  };

  // Save / Complete / Hold Invoice
  const handleSaveInvoice = async (
    targetStatus: 'completed' | 'held' | 'draft',
    autoPrintFormat?: 'a4' | '80mm' | '58mm'
  ) => {
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
          if (r.total_units <= 0) {
            const rowIndexInGrid = rows.findIndex((row) => row.row_id === r.row_id);
            const focusIdx = rowIndexInGrid >= 0 ? rowIndexInGrid : i;
            setSelectedRowIndex(focusIdx);
            setErrorMsg(
              `Please enter a Quantity (or Loose Qty) for Row #${focusIdx + 1} (${r.item_name}).`
            );
            setTimeout(() => {
              const targetId =
                invoiceViewMode === 'pos' ? 'pos_active_quantity' : `cell_${focusIdx}_quantity`;
              const qtyEl = document.getElementById(targetId) as HTMLInputElement | null;
              qtyEl?.focus();
            }, 25);
            return;
          }
        }
      }

      if (targetStatus === 'completed' && !allowNegativeStock) {
        for (let i = 0; i < activeLines.length; i++) {
          const r = activeLines[i];
          if (r.total_units > r.available_stock_units) {
            setErrorMsg(
              `Stock Shortage on Row #${i + 1} (${r.item_name} - Batch ${r.batch_number}): Available ${r.available_stock_packs} Packs (${r.available_stock_units} Units), Requested ${r.total_units} Units.`
            );
            return;
          }
        }
      }

      setSubmitting(true);

      const clientRequestId = `SAL-${invoiceNumber}-${Date.now()}`;
      const payload = {
        client_request_id: clientRequestId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        customer_account_id: customerAccountId,
        customer_name: selectedCustomer?.account_name || 'Walk-in Cash Customer',
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
        remarks,
        items: activeLines.map((r) => ({
          item_id: r.item_id,
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
          discount_percent: r.discount_percent,
          discount_amount: r.discount_amount,
          loose_quantity: r.loose_quantity,
          loose_rate: r.loose_rate,
          tax_percent: r.tax_percent,
        })),
      };

      const res = editingSaleId
        ? await api.updateSale(editingSaleId, payload)
        : await api.createSale(payload);

      const savedInvoice = res.data as SalesInvoiceRecord;

      const waPayload: WhatsAppDocumentPayload = {
        storeName: storeDisplayName,
        documentType: 'invoice',
        invoiceId: savedInvoice.id,
        documentNumber: savedInvoice.invoice_number,
        documentDate: savedInvoice.invoice_date || invoiceDate,
        customerAccountId: customerAccountId || null,
        customerName: selectedCustomer?.account_name || 'Walk-in Cash Customer',
        customerPhone: selectedCustomer?.phone || '',
        totalAmount: Number(savedInvoice.net_total ?? netInvoiceAmount),
        paidAmount: Number(savedInvoice.paid_amount ?? paidAmount),
        remainingBalance: Number(savedInvoice.balance_amount ?? remainingBalance),
        items: activeLines.map((r) => ({
          item_name: r.item_name,
          packing: r.packing,
          quantity: r.quantity,
          loose_quantity: r.loose_quantity,
          unit_price: r.unit_price,
          line_total: r.line_total,
        })),
      };
      setLastSavedWhatsappPayload(waPayload);

      // Check latest company settings for Auto-send on save
      api
        .getCompanySettings()
        .then((sRes) => {
          if (sRes?.data) {
            if (sRes.data.store_name) setStoreDisplayName(sRes.data.store_name);
            setAutoWhatsappOnSave(Number(sRes.data.auto_whatsapp_on_save || 0) === 1);
          }
        })
        .catch(() => null);

      const wasEditing = Boolean(editingSaleId);
      setSuccessMsg(
        targetStatus === 'completed'
          ? (wasEditing
              ? `Sales Invoice ${savedInvoice.invoice_number} successfully updated! Stock & Accounts reconciled.`
              : `Sales Invoice ${savedInvoice.invoice_number} confirmed! Stock & Customer Ledger Balance updated.`)
          : `Invoice ${savedInvoice.invoice_number} saved as ${targetStatus.toUpperCase()}.`
      );

      if (autoPrintFormat) {
        const fullDetails = await api.getSaleDetails(savedInvoice.id);
        setPrintFormat(autoPrintFormat);
        setPrintInvoice(fullDetails.data);
      }

      await resetToNewInvoice();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
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
      const details = await api.getSaleDetails(last.id);
      setPrintFormat('a4');
      setPrintInvoice(details.data);
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
        discount_percent: r.discount_percent,
        discount_amount: r.discount_amount,
        loose_quantity: r.loose_quantity,
        loose_rate: r.loose_rate,
        total_units: r.total_units,
        gross_amount: r.gross_amount,
        taxable_amount: r.taxable_amount,
        tax_percent: r.tax_percent,
        tax_amount: r.tax_amount,
        line_total: r.line_total,
      })),
    };
    setPrintFormat(format);
    setPrintInvoice(previewRecord);
  };

  // Export Active Sales Invoice (or Saved Sales Invoices) to Formatted Multi-Sheet Excel (.xlsx)
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);

  const handleExportCurrentSaleToExcel = async () => {
    try {
      setExportingExcel(true);
      setErrorMsg(null);
      const activeLines = rows.filter((r) => r.item_id !== null);
      if (activeLines.length > 0) {
        const currentRecord = {
          id: editingSaleId || 0,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          customer_account_id: customerAccountId,
          customer_code: selectedCustomer?.account_code || 'CUS-1001',
          customer_name: selectedCustomer?.account_name || 'Walk-in Cash Customer',
          customer_filer_status: customerFilerStatus,
          salesman: salesman || 'Counter Pharmacist',
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
            item_code: r.item_code,
            company_name: r.company_name,
            item_name: r.item_name,
            packing: r.packing,
            batch_number: r.batch_number,
            expiry_date: r.expiry_date,
            quantity: r.quantity,
            loose_quantity: r.loose_quantity,
            bonus_quantity: Number(r.bonus_quantity || 0),
            unit_price: r.unit_price,
            loose_rate: r.loose_rate,
            discount_percent: r.discount_percent,
            discount_amount: r.discount_amount,
            tax_percent: r.tax_percent,
            tax_amount: r.tax_amount,
            gross_amount: r.gross_amount,
            line_total: r.line_total,
          })),
        };
        exportSalesInvoicesToExcel(
          [currentRecord],
          `Sales_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        );
        setSuccessMsg(`Exported Sales Invoice ${invoiceNumber} (${activeLines.length} items) to Excel (.xlsx).`);
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

  // Open Customer Shortcut Drawer
  const openCustomerShortcut = async (
    mode: 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  ) => {
    setActiveCustomerShortcut(mode);
    if (mode === 'ledger' && customerAccountId) {
      try {
        const res = await api.getAccountLedger({
          ledgerType: 'customer',
          accountId: customerAccountId,
        });
        setCustomerLedgerData(res);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } else if (mode === 'add_customer') {
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

  // Column Widths for Microsoft Access-Style Resizable Datasheet Grid (Wider Full-Screen Defaults)
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    selector: 42,
    item_code: 120,
    company: 160,
    item_name: 330,
    quantity: 95,
    discount: 98,
    loose_quantity: 112,
    unit_price: 112,
    bonus_quantity: 95,
    loose_rate: 112,
    gross_amount: 130,
    amount: 140,
    actions: 115,
  });

  const handleColResizeMouseDown = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || 100;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      setColWidths((prev) => ({
        ...prev,
        [colKey]: Math.max(40, startWidth + diff),
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Keyboard Navigation in Access Datasheet Grid & POS View
  // Required column sequence: 1. Item Code -> 2. Company -> 3. Item Name -> 4. Qty -> 5. Discount -> 6. Loose Qty -> 7. Price -> 8. Bonus -> 9. Loose Rate -> 10. Gross Amount -> 11. Net Amount
  const colOrder = [
    'item_code',
    'item_name',
    'quantity',
    'discount_percent',
    'loose_quantity',
    'unit_price',
    'bonus_quantity',
    'loose_rate',
  ];

  const getEditableColsForRow = (row?: DatasheetRow, mode: 'pos' | 'access' = 'access') => {
    if (mode === 'pos') {
      if (isSyrupItem(row)) {
        return ['quantity', 'discount_percent', 'unit_price', 'bonus_quantity'] as Array<
          'quantity' | 'bonus_quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate'
        >;
      }
      return [
        'quantity',
        'discount_percent',
        'loose_quantity',
        'unit_price',
        'bonus_quantity',
        'loose_rate',
      ] as Array<
        'quantity' | 'bonus_quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate'
      >;
    }
    if (isSyrupItem(row)) {
      return ['item_code', 'item_name', 'quantity', 'discount_percent', 'unit_price', 'bonus_quantity'];
    }
    return [
      'item_code',
      'item_name',
      'quantity',
      'discount_percent',
      'loose_quantity',
      'unit_price',
      'bonus_quantity',
      'loose_rate',
    ];
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

  const navigateToRecord = (targetIdx: number, preferredCol?: string) => {
    const total = Math.max(1, rows.length);
    const clamped = Math.max(0, Math.min(total - 1, targetIdx));
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
      itemCode: r.item_code || '',
      itemName: r.item_name || '',
      barcode: r.item_id ? barcodeByItemId.get(Number(r.item_id)) || '' : '',
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

  // Create/move to a new empty item row and focus Item Search without replacing any existing items
  const advanceToNewRowItemSearch = (fromRowIdx: number, mode: 'pos' | 'access') => {
    const existingEmptyIdx = rows.findIndex((r, idx) => idx > fromRowIdx && r.item_id === null);
    const targetRowIdx = existingEmptyIdx >= 0 ? existingEmptyIdx : rows.length;

    if (existingEmptyIdx < 0) {
      setRows((prev) => [...prev, createEmptyRow()]);
    }

    setSelectedRowIndex(targetRowIdx);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');

    if (mode === 'pos') {
      setActiveSearchRowIdx(null);
      pendingFocusTargetRef.current = 'pos_item_search_input';
      setTimeout(() => {
        const rowEl = document.getElementById(`pos_row_${targetRowIdx}_quantity`);
        rowEl?.closest('tr')?.scrollIntoView({ block: 'nearest' });
        const searchEl =
          posSearchInputRef.current ||
          (document.getElementById('pos_item_search_input') as HTMLInputElement | null);
        if (searchEl) {
          searchEl.focus();
          searchEl.select?.();
        }
      }, 25);
    } else {
      setActiveSearchRowIdx(targetRowIdx);
      const cellId = `cell_${targetRowIdx}_item_code`;
      pendingFocusTargetRef.current = cellId;
      setTimeout(() => {
        const el = document.getElementById(cellId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
          el.closest('tr')?.scrollIntoView({ block: 'nearest' });
        }
      }, 25);
    }
  };

  // POS View Keyboard Navigation: 1. Quantity -> 2. Discount -> 3. Price -> 4. Loose Quantity -> 5. Loose Rate -> Enter -> New Row & Item Search
  const handlePosFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    fieldName: 'quantity' | 'bonus_quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate',
    isTableInput: boolean = false
  ) => {
    const row = rows[rowIdx];
    const prefix = isTableInput ? `pos_row_${rowIdx}` : 'pos_active';
    const posOrder = getEditableColsForRow(row, 'pos') as Array<
      'quantity' | 'bonus_quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate'
    >;
    const curIdx = posOrder.indexOf(fieldName);

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
        const target = Math.min(rows.length - 1, rowIdx + 5);
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
        return;
      }

      if (e.key === 'ArrowDown' && isDropdownActive && searchResults.length > 0) {
        e.preventDefault();
        setSearchHighlightIdx((prev) => {
          const next = Math.min(searchResults.length - 1, prev + 1);
          setTimeout(() => {
            document
              .querySelector(`[data-sales-search-idx="${next}"]`)
              ?.scrollIntoView({ block: 'nearest' });
          }, 0);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp' && isDropdownActive && searchResults.length > 0) {
        e.preventDefault();
        setSearchHighlightIdx((prev) => {
          const next = Math.max(0, prev - 1);
          setTimeout(() => {
            document
              .querySelector(`[data-sales-search-idx="${next}"]`)
              ?.scrollIntoView({ block: 'nearest' });
          }, 0);
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
            handleSelectFromTopSearch(chosen, rowIndex);
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
      const target = Math.min(rows.length - 1, rowIndex + 5);
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
      const lastIdx = Math.max(0, rows.length - 1);
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

  // Global Keyboard Shortcuts (F2: Item Search, F3: Focus Search Bar, Ctrl+S: Save, Ctrl+P: Print, Ctrl+N: New, F9: Hold, Esc: Close Modals/Dropdown)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
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
        handleSaveInvoice('completed', 'a4');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        resetToNewInvoice();
      } else if (e.key === 'F3') {
        e.preventDefault();
        const targetSearch = posSearchInputRef.current || searchInputRef.current;
        targetSearch?.focus();
        targetSearch?.select?.();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowEditSearchModal(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        handleSaveInvoice('held');
      } else if (e.key === 'Escape') {
        if (showItemListModal) {
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

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [handleSaveInvoice, resetToNewInvoice, selectedRowIndex, showItemListModal, showSearchDropdown]);

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

  // Active row & its Customer-Wise Item History
  const activeRow = rows[selectedRowIndex] || rows[0];
  const activeHistoryKey = activeRow?.item_id ? `${activeRow.item_id}_${customerAccountId || 0}` : '';
  const activeItemHistory = activeHistoryKey ? itemHistoryMap[activeHistoryKey] : null;

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
    if (current > 0) {
      updateRowField(idx, 'quantity', Math.max(0, current - 1));
    }
  };

  const handleAddStripToRow = (idx: number, stripsCount: number = 1) => {
    const r = rows[idx];
    if (!r || isSyrupItem(r)) return;
    const strip = r.units_per_strip > 1 ? r.units_per_strip : 1;
    updateRowField(idx, 'loose_quantity', Number(r.loose_quantity || 0) + strip * stripsCount);
  };

  return (
    <div className="ams-readable-invoice-scope w-full h-full flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto overflow-x-hidden px-1.5 py-1 bg-slate-100" style={{ zoom: 1 }}>
      {/* Status Banners */}
      {errorMsg && (
        <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex flex-wrap items-center justify-between gap-2 text-xs shadow-sm shrink-0 mb-1">
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
        <div className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex flex-wrap items-center justify-between gap-2 text-xs shadow-sm shrink-0 mb-1">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastSavedWhatsappPayload && (
              <WhatsAppSendButton
                compact
                label={`Send ${lastSavedWhatsappPayload.documentNumber} via WhatsApp`}
                payload={lastSavedWhatsappPayload}
                autoTriggerKey={
                  autoWhatsappOnSave ? lastSavedWhatsappPayload.documentNumber : null
                }
                onPhoneSaved={(newPhone) => {
                  setLastSavedWhatsappPayload((prev) =>
                    prev ? { ...prev, customerPhone: newPhone } : prev
                  );
                  loadReferenceData();
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ================= TOP FULL-SCREEN HEADER & INTERFACE SELECTOR BAR ================= */}
      <div className="ams-pos-compact-chrome flex flex-wrap items-center justify-between gap-1.5 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white rounded-lg border border-slate-700/80 shadow-md shrink-0 px-2.5 py-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Return to Previous Dashboard / Menu"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </button>
          )}
          <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
            FULL-SCREEN SALES INVOICE
          </span>
          <div className="inline-flex rounded-lg p-0.5 bg-slate-800 border border-slate-700">
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('pos')}
              className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'pos'
                  ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to Traditional Desktop POS Billing Interface"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>1. POS View</span>
            </button>
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('access')}
              className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'access'
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to Microsoft Access-Style Desktop Datasheet Form"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>2. MS Access View</span>
            </button>
          </div>
          {onNavigateToSalesHistory && (
            <button
              type="button"
              onClick={onNavigateToSalesHistory}
              className="px-2.5 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Open Sales Invoice Register & History"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span>Sales History</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportCurrentSaleToExcel}
            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title="Export Current Sales Invoice (or Saved Invoices) to Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exportingExcel ? 'Exporting...' : 'Export to Excel (.xlsx)'}</span>
          </button>
          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportAllSalesToExcel}
            className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title="Export All Saved Sales Invoices with Line Items to Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export All Sales (.xlsx)</span>
          </button>
          <label
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
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
              className="rounded-lg text-amber-500 focus:ring-0 cursor-pointer"
            />
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Allow Neg Stock</span>
          </label>
          <button
            type="button"
            onClick={() => handleOpenCurrentInvoicePreview('a4')}
            className="px-2.5 py-0.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            title="Print Preview for Currently Open Sales Invoice (A4 & Thermal)"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Print Preview</span>
          </button>
          <button
            type="button"
            onClick={handleOpenDsrReport}
            className="px-2.5 py-0.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            title="Open DSR – Daily Stock Requisition Report for Current Invoice"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>DSR</span>
          </button>
          <button
            type="button"
            onClick={handleOpenSalesSms}
            className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            title="Send Customer SMS for Current Sales Invoice"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Send SMS</span>
          </button>
          <SimpleSyncStatusBar compact dark onSyncCompleted={loadReferenceData} />
          <span className="bg-slate-800 px-2 py-0.5 rounded-lg text-emerald-400 font-mono font-bold">
            {rows.filter((r) => r.item_id).length} Items
          </span>
          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white border border-slate-600 text-xs font-black flex items-center gap-1 cursor-pointer"
              title="Close Full-Screen Invoice and Return to Dashboard"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>

      {/* ================= OPTION 1: TRADITIONAL POS INTERFACE ================= */}
      {invoiceViewMode === 'pos' && (
        <div className="flex-1 min-h-0 flex flex-col gap-1">
          {/* POS Header: Customer, Salesman, Deliveryman, Type & Mode */}
          <div className="ams-pos-compact-chrome bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-1.5 space-y-1 shrink-0">
            {/* Top row: Badges, Bill #, Date & Action Shortcuts */}
            <div className="flex flex-wrap items-center justify-between gap-1 pb-1 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-lg bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-300" />
                  {invoiceType} POS COUNTER
                </span>
                <span className="font-mono text-[11px] font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded-lg border border-slate-300">
                  {invoiceNumber}
                </span>
                {editingSaleId ? (
                  <div className="flex items-center gap-1.5 bg-amber-500 text-white px-2 py-0.5 rounded-lg border border-amber-600 shadow-xs">
                    <Pencil className="w-3 h-3 text-amber-100" />
                    <span className="text-[10px] font-black uppercase tracking-wider">
                      EDITING #{editingSaleId} ({invoiceNumber})
                    </span>
                    <button
                      type="button"
                      onClick={resetToNewInvoice}
                      className="ml-1 px-1.5 py-0.2 rounded bg-amber-700 hover:bg-amber-800 text-[10px] font-bold text-white cursor-pointer"
                      title="Cancel editing and create new bill"
                    >
                      Cancel / New Bill
                    </button>
                  </div>
                ) : null}
                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Date:</span>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="text-[11px] font-mono font-semibold text-slate-800 bg-transparent outline-none cursor-pointer h-5"
                  />
                </div>
              </div>

              {/* Quick Header Actions */}
              <div className="flex items-center gap-1">
                <label
                  className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                    allowNegativeStock
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Allow Negative Stock for Sales"
                >
                  <input
                    type="checkbox"
                    checked={allowNegativeStock}
                    onChange={(e) => handleToggleNegativeStock(e.target.checked)}
                    className="rounded-lg text-amber-600 focus:ring-0 cursor-pointer"
                  />
                  <ShieldAlert className="w-3 h-3 text-amber-600" />
                  <span>Allow Neg Stock</span>
                </label>
                <button
                  type="button"
                  onClick={resetToNewInvoice}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="New Blank Invoice (Ctrl+N)"
                >
                  <Plus className="w-3 h-3 text-emerald-600" />
                  New (Ctrl+N)
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditSearchModal(true)}
                  className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Find & Edit Completed or Held Sales Invoice (Ctrl+E)"
                >
                  <Pencil className="w-3 h-3 text-amber-700" />
                  Find / Edit (Ctrl+E)
                </button>
                <button
                  type="button"
                  onClick={() => setShowHeldDrawer(true)}
                  className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="View Held Invoices"
                >
                  <History className="w-3 h-3 text-amber-700" />
                  Held ({heldInvoices.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenCurrentInvoicePreview('a4')}
                  className="px-2.5 py-0.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                  title="Print Preview for Current Sales Invoice (A4 & Thermal)"
                >
                  <Eye className="w-3 h-3" />
                  <span>Print Preview</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenDsrReport}
                  className="px-2.5 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                  title="Open DSR – Daily Stock Requisition Picking Report for Current Invoice"
                >
                  <ClipboardList className="w-3 h-3" />
                  <span>DSR</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenSalesSms}
                  className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                  title="Send Customer SMS for Current Sales Invoice"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Send SMS</span>
                </button>
                <button
                  type="button"
                  onClick={handleReprintLastInvoice}
                  className="px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Reprint Last Invoice"
                >
                  <Printer className="w-3 h-3 text-blue-700" />
                  Reprint
                </button>
                {(lastSavedWhatsappPayload || rows.some((r) => r.item_id)) && (
                  <WhatsAppSendButton
                    compact
                    label="WhatsApp"
                    payload={
                      rows.some((r) => r.item_id)
                        ? {
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
                          }
                        : lastSavedWhatsappPayload!
                    }
                    onPhoneSaved={(newPhone) => {
                      if (lastSavedWhatsappPayload) {
                        setLastSavedWhatsappPayload((prev) =>
                          prev ? { ...prev, customerPhone: newPhone } : prev
                        );
                      }
                      loadReferenceData();
                    }}
                  />
                )}
              </div>
            </div>

            {/* Middle row: Customer Selection with Live Previous Ledger Balance */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              {/* Customer Selector */}
              <div className="md:col-span-5 flex items-center gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1 shrink-0">
                  <Users2 className="w-3 h-3 text-emerald-600" />
                  <span>Customer:</span>
                </label>
                <select
                  value={customerAccountId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
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
                  }}
                  className="w-full px-2 py-0.5 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 h-6"
                >
                  <option value={0}>— Select Customer (Walk-in Cash) —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.account_code}] {c.account_name} {c.town_name ? `• ${c.town_name}` : ''} {c.area_name ? `(${c.area_name})` : ''} {c.phone ? `• ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
                {customerAccountId > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerAccountId(0);
                      setLiveBalanceSummary(null);
                    }}
                    className="text-[10px] text-slate-500 hover:text-slate-800 cursor-pointer shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Live Customer Previous Balance & Last Payment Badge */}
              <div className="md:col-span-4 bg-slate-900 text-white rounded-lg px-2 py-0.5 flex items-center justify-between shadow-sm h-6">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 shrink-0">
                    Prev Bal:
                  </span>
                  <span
                    className={`font-mono text-[11px] font-black ${
                      prevCustomerBalance > 0
                        ? 'text-amber-400'
                        : prevCustomerBalance < 0
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {formatPKR(Math.abs(prevCustomerBalance))} ({prevBalanceType})
                  </span>
                  {liveBalanceSummary?.lastPayment && (
                    <span className="text-[9px] text-slate-400 hidden sm:inline truncate">
                      • Last: {formatPKR(liveBalanceSummary.lastPayment.amount)}
                    </span>
                  )}
                </div>
                {customerAccountId > 0 && (
                  <button
                    type="button"
                    onClick={() => openCustomerShortcut('ledger')}
                    className="px-1.5 py-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                    title="Open Detailed Ledger for this Customer"
                  >
                    <BookOpen className="w-2.5 h-2.5" />
                    <span>Ledger</span>
                  </button>
                )}
              </div>

              {/* Type Toggle & Payment Mode */}
              <div className="md:col-span-3 flex items-center justify-end gap-1.5">
                {/* Retail / Wholesale */}
                <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-300">
                  <button
                    type="button"
                    onClick={() => setInvoiceType('Retail')}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                      invoiceType === 'Retail'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Retail
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvoiceType('Wholesale')}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                      invoiceType === 'Wholesale'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Wholesale
                  </button>
                </div>

                {/* Payment Mode */}
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as SalesPaymentMode)}
                  className="px-2 py-0.5 text-[11px] font-bold rounded-lg border border-slate-300 bg-white text-slate-900 h-6"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank">Bank / Online</option>
                  <option value="Credit">Credit (Udhar)</option>
                </select>
              </div>
            </div>

            {/* Bottom Header row: Salesman & Deliveryman (Strictly Separate) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1.5 pt-0.5 border-t border-slate-100 text-[11px]">
              <div className="flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Salesman:</span>
                <select
                  value={salesmanId || ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setSalesmanId(id);
                    const sm = salesmenList.find((s) => s.id === id);
                    if (sm) setSalesman(sm.name);
                  }}
                  className="w-full px-1.5 py-0 text-[11px] font-semibold rounded-lg border border-slate-200 bg-slate-50 h-5"
                >
                  <option value="">— Counter Pharmacist —</option>
                  {salesmenList.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name || sm.full_name} ({sm.salesman_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Truck className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Delivery:</span>
                <select
                  value={deliverymanId || ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setDeliverymanId(id);
                    const dm = deliverymenList.find((d) => d.id === id);
                    if (dm) setDeliverymanName(dm.name);
                  }}
                  className="w-full px-1.5 py-0 text-[11px] font-semibold rounded-lg border border-slate-200 bg-slate-50 h-5"
                >
                  <option value="">— No Delivery / Counter Pickup —</option>
                  {deliverymenList.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      {dm.name} ({dm.deliveryman_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Delivery Fee:</span>
                <NumericInput
                  value={deliveryCharges}
                  onChange={(e) => setDeliveryCharges(Math.max(0, Number(e.target.value || 0)))}
                  className="w-full px-1.5 py-0 text-[11px] font-mono font-bold rounded-lg border border-slate-200 bg-slate-50 text-right h-5"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Prescription:</span>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Dr. note / Patient ref..."
                  className="w-full px-1.5 py-0 text-[11px] rounded-lg border border-slate-200 bg-slate-50 h-5"
                />
              </div>
            </div>
          </div>

          {/* Fast Item Search & Barcode Scan Bar */}
          <div className="relative bg-slate-900 rounded-lg px-2 py-1 shadow-sm text-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  id="pos_item_search_input"
                  ref={posSearchInputRef}
                  type="text"
                  value={quickSearchQuery}
                  onFocus={() => {
                    setActiveSearchRowIdx(null);
                    if (quickSearchQuery.trim().length > 0) {
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
                    if (q.trim().length > 0) {
                      setShowSearchDropdown(true);
                      runFastSearch(q);
                    } else {
                      setShowSearchDropdown(false);
                      setSearchResults([]);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      if (quickSearchQuery.trim().length === 0) return;
                      e.preventDefault();
                      if (!showSearchDropdown) {
                        setShowSearchDropdown(true);
                        runFastSearch(quickSearchQuery);
                        return;
                      }
                      setSearchHighlightIdx((prev) => {
                        const next = Math.min(searchResults.length - 1, prev + 1);
                        setTimeout(() => {
                          document
                            .querySelector(`[data-sales-search-idx="${next}"]`)
                            ?.scrollIntoView({ block: 'nearest' });
                        }, 0);
                        return next;
                      });
                    } else if (e.key === 'ArrowUp') {
                      if (quickSearchQuery.trim().length === 0) return;
                      e.preventDefault();
                      if (!showSearchDropdown) {
                        setShowSearchDropdown(true);
                        return;
                      }
                      setSearchHighlightIdx((prev) => {
                        const next = Math.max(0, prev - 1);
                        setTimeout(() => {
                          document
                            .querySelector(`[data-sales-search-idx="${next}"]`)
                            ?.scrollIntoView({ block: 'nearest' });
                        }, 0);
                        return next;
                      });
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (quickSearchQuery.trim().length > 0 && showSearchDropdown && searchResults.length > 0) {
                        const chosen =
                          searchResults[searchHighlightIdx] || searchResults[0];
                        if (chosen) {
                          handleSelectFromTopSearch(chosen);
                          return;
                        }
                      }
                      focusCell(selectedRowIndex, 'quantity', 'pos_row');
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowSearchDropdown(false);
                    }
                  }}
                  placeholder="Scan Barcode or Type Item Name / Code to Search..."
                  className="w-full pl-8 pr-7 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-slate-750 h-6"
                />
                {quickSearchQuery && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setQuickSearchQuery('');
                      setSearchHighlightIdx(0);
                      setShowSearchDropdown(false);
                      setSearchResults([]);
                      posSearchInputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => openItemListForRow(null)}
                className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 shadow-sm h-6"
                title="Open Full Item List to select or replace an item"
              >
                <PackageSearch className="w-3.5 h-3.5 text-emerald-400" />
                <span>Item List</span>
              </button>
              <button
                type="button"
                onClick={() => advanceToNewRowItemSearch(rows.length - 1, 'pos')}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 shadow-sm h-6"
                title="Add New Empty Row to Bill"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Blank Line</span>
              </button>
            </div>

            {/* Fast Excel-Style Search Combobox Results */}
            {renderSalesExcelItemCombobox('top')}
          </div>

          {/* Active Item Counter Entry Strip */}
          {activeRow && activeRow.item_id ? (
            <div className="ams-pos-compact-chrome bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-500/80 rounded-lg px-2.5 py-1 shadow-sm space-y-1 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0 rounded-lg bg-emerald-700 text-white font-mono text-[10px] font-bold">
                    Active Line #{selectedRowIndex + 1}
                  </span>
                  <span className="font-bold text-slate-900 text-xs">
                    [{activeRow.item_code}] {activeRow.item_name}
                  </span>
                  <span className="text-[11px] text-slate-600 font-medium">
                    ({activeRow.packing}) • {activeRow.company_name}
                  </span>
                  <span className="px-1.5 py-0 rounded-lg bg-emerald-200 text-emerald-950 font-mono text-[10px] font-bold">
                    Stock: {activeRow.available_stock_packs} Packs ({activeRow.available_stock_units} Units)
                  </span>
                </div>

                {/* Customer-Wise Last Sale History Badge right in the Entry Strip */}
                {activeItemHistory?.hasCustomerHistory && activeItemHistory.lastCustomerSale && (
                  <div className="flex items-center gap-1 bg-amber-100 border border-amber-300 rounded-lg px-1.5 py-0 text-[10px] text-amber-950">
                    <span className="font-bold uppercase">Customer Last Sale:</span>
                    <span className="font-mono font-bold">
                      Rs. {activeItemHistory.lastCustomerSale.unit_price} (Disc {activeItemHistory.lastCustomerSale.discount_percent}%) on {activeItemHistory.lastCustomerSale.invoice_date}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyCustomerLastRateToRow(selectedRowIndex)}
                      className="ml-1 px-1.5 py-0 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold cursor-pointer"
                      title="Apply this customer's previous purchase rate"
                    >
                      Apply Rate
                    </button>
                  </div>
                )}
              </div>

              {/* Fast Stepper Controls for Active Row — Ordered: 1. Qty -> 2. Discount -> 3. Loose Qty -> 4. Price -> 5. Bonus Qty -> 6. Loose Rate -> Enter (Next Item) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5 items-end">
                {/* 1. Quantity */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    1. Qty (Packs)
                  </label>
                  <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden min-h-[28px]">
                    <button
                      type="button"
                      onClick={() => handleDecrementQty(selectedRowIndex)}
                      className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-r border-slate-300"
                    >
                      -
                    </button>
                    <NumericInput
                      id="pos_active_quantity"
                      value={activeRow.quantity}
                      onChange={(e) => updateRowField(selectedRowIndex, 'quantity', e.target.value)}
                      onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'quantity', false)}
                      className="w-full text-center font-mono font-bold text-[11px] text-slate-900 outline-none py-0"
                    />
                    <button
                      type="button"
                      onClick={() => handleIncrementQty(selectedRowIndex)}
                      className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-l border-slate-300"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* 2. Discount % */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    2. Discount %
                  </label>
                  <NumericInput
                    id="pos_active_discount_percent"
                    value={activeRow.discount_percent}
                    onChange={(e) => updateRowField(selectedRowIndex, 'discount_percent', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'discount_percent', false)}
                    className="w-full px-1.5 py-0 font-mono font-semibold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none"
                  />
                </div>

                {/* 3. Loose Quantity */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-teal-800 leading-none mb-0.5">
                    {isSyrupItem(activeRow) ? '3. Loose Mode' : '3. Loose Qty'}
                  </label>
                  {isSyrupItem(activeRow) ? (
                    <div className="px-1.5 py-0 rounded-lg bg-amber-50/80 border border-amber-300 text-amber-900 text-[10px] font-bold text-center select-none min-h-[28px] flex items-center justify-center">
                      Bottle Only
                    </div>
                  ) : (
                    <div className="flex items-center border border-teal-300 rounded-lg bg-white overflow-hidden min-h-[28px]">
                      <NumericInput
                        id="pos_active_loose_quantity"
                        value={activeRow.loose_quantity}
                        onChange={(e) => updateRowField(selectedRowIndex, 'loose_quantity', e.target.value)}
                        onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'loose_quantity', false)}
                        className="w-full text-center font-mono font-bold text-[11px] text-teal-950 outline-none py-0"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddStripToRow(selectedRowIndex, 1)}
                        className="px-1 py-0 bg-teal-600 hover:bg-teal-700 text-white font-mono text-[9px] font-bold cursor-pointer shrink-0"
                        title={`Add 1 Strip (+${activeRow.units_per_strip || 1} Tabs)`}
                      >
                        +1S
                      </button>
                    </div>
                  )}
                </div>

                {/* 4. Price (PKR) */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    4. Price (PKR)
                  </label>
                  <NumericInput
                    id="pos_active_unit_price"
                    value={activeRow.unit_price}
                    onChange={(e) => updateRowField(selectedRowIndex, 'unit_price', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'unit_price', false)}
                    className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none"
                  />
                </div>

                {/* 5. Bonus Qty */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-emerald-800 leading-none mb-0.5">
                    5. Bonus Qty
                  </label>
                  <NumericInput
                    id="pos_active_bonus_quantity"
                    value={activeRow.bonus_quantity ?? 0}
                    onChange={(e) => updateRowField(selectedRowIndex, 'bonus_quantity', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'bonus_quantity', false)}
                    className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-center rounded-lg border border-emerald-300 bg-emerald-50/50 focus:bg-white text-emerald-950 focus:border-emerald-600 outline-none"
                    title="Bonus Quantity (Free items deducted from stock)"
                  />
                </div>

                {/* 6. Loose Rate */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-blue-800 leading-none mb-0.5">
                    6. Loose Rate
                  </label>
                  <NumericInput
                    id="pos_active_loose_rate"
                    disabled={isSyrupItem(activeRow)}
                    value={activeRow.loose_rate}
                    onChange={(e) => updateRowField(selectedRowIndex, 'loose_rate', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'loose_rate', false)}
                    className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-right rounded-lg border border-blue-400 bg-blue-50/30 focus:bg-white text-blue-950 focus:border-blue-600 outline-none disabled:opacity-50"
                    title="Edit Loose Rate for this line item and press Enter to add next item"
                  />
                </div>

                {/* Line Total Preview */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-500 leading-none mb-0.5">
                    Line Total
                  </label>
                  <div className="px-1.5 py-0 bg-emerald-100/70 border border-emerald-300 rounded-lg font-mono font-black text-[11px] text-emerald-950 text-right min-h-[28px] flex items-center justify-end">
                    {formatPKR(activeRow.line_total)}
                  </div>
                </div>

                {/* Add Next Item Button */}
                <div>
                  <button
                    type="button"
                    onClick={() => advanceToNewRowItemSearch(selectedRowIndex, 'pos')}
                    className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-sm min-h-[28px]"
                    title="Add a new empty row and focus Item Search (or press Enter in Loose Rate)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Next Item ↵</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="ams-pos-compact-chrome bg-slate-50 border border-dashed border-slate-300 rounded-lg px-2.5 py-1 text-center text-[11px] text-slate-600 shrink-0">
              Scan a barcode, type in the search bar above, or click <strong>Item Code / Item Name</strong> in the grid below to select items.
            </div>
          )}

          {/* Sales POS Item Grid (Minimum 10 Visible Rows, Internal Scroll, Fixed Headers) */}
          <div className="ams-pos-item-grid-card bg-white rounded-xl border-2 border-slate-300 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[375px] relative z-10">
            <div className="ams-pos-compact-chrome px-3 py-1 bg-slate-100 border-b border-slate-300 flex items-center justify-between text-[11px] shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-800 uppercase tracking-wider text-[11px]">
                  Sales POS Item Grid ({rows.filter((r) => r.item_id).length} Active / {rows.length} Rows)
                </span>
                <span className="text-slate-500 text-[11px] hidden sm:inline">
                  • Click Item Code / Item Name or press F2 to open Item List
                </span>
              </div>
              <span className="font-mono font-bold text-slate-700 text-[11px]">
                Total Units: {rows.reduce((s, r) => s + (r.total_units || 0), 0)}
              </span>
            </div>

            <div className="ams-pos-item-grid-scroll flex-1 min-h-[342px] overflow-y-auto overflow-x-auto relative bg-white">
              <table className="ams-compact-10-grid w-full text-left text-xs border-collapse leading-normal min-w-[1150px]">
                <thead className="sticky top-0 z-20 bg-slate-200 border-b-2 border-slate-300 text-slate-800 text-[11px] font-bold uppercase tracking-wider leading-normal shadow-sm">
                  <tr className="h-8">
                    <th className="py-1 px-1.5 w-9 text-center border-r border-slate-300 h-8">#</th>
                    <th className="py-1 px-1.5 w-28 border-r border-slate-300 h-8">Item Code</th>
                    <th className="py-1 px-1.5 w-32 border-r border-slate-300 h-8">Company</th>
                    <th className="py-1 px-1.5 min-w-[220px] border-r border-slate-300 h-8">Item Name</th>
                    <th className="py-1 px-1.5 w-20 text-center bg-emerald-100/70 text-emerald-950 border-r border-slate-300 h-8">Quantity</th>
                    <th className="py-1 px-1.5 w-20 text-right border-r border-slate-300 h-8">Discount</th>
                    <th className="py-1 px-1.5 w-24 text-center bg-teal-100/70 text-teal-950 border-r border-slate-300 h-8">Loose Qty</th>
                    <th className="py-1 px-1.5 w-24 text-right border-r border-slate-300 h-8">Price</th>
                    <th className="py-1 px-1.5 w-20 text-center bg-emerald-100/80 text-emerald-950 border-r border-slate-300 h-8">Bonus</th>
                    <th className="py-1 px-1.5 w-24 text-right bg-blue-100/70 text-blue-950 border-r border-slate-300 h-8">Loose Rate</th>
                    <th className="py-1 px-1.5 w-26 text-right border-r border-slate-300 h-8">Gross Amount</th>
                    <th className="py-1 px-1.5 w-28 text-right bg-slate-300/70 font-black border-r border-slate-300 h-8">Amount</th>
                    <th className="py-1 px-1 w-14 text-center h-8">Act</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((row, rIdx) => {
                    const isSelected = rIdx === selectedRowIndex;
                    const isActiveSearchMatch = invoiceSearchActiveRow === rIdx;
                    const isSearchMatch = invoiceSearchMatchedRows.includes(rIdx);

                    return (
                      <tr
                        key={row.row_id}
                        data-sales-row-idx={rIdx}
                        onClick={() => setSelectedRowIndex(rIdx)}
                        className={`cursor-pointer transition-colors border-b border-slate-200 h-8 leading-none ${
                          isActiveSearchMatch
                            ? 'bg-amber-200/80 ring-2 ring-inset ring-amber-500 font-semibold'
                            : isSearchMatch
                            ? 'bg-sky-100/80 font-medium'
                            : isSelected
                            ? 'bg-emerald-50/90 font-medium'
                            : rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/50 hover:bg-slate-100/60'
                        }`}
                      >
                        <td className="py-0 px-1 text-center font-mono text-slate-600 text-[11px] border-r border-slate-200 h-9 align-middle bg-slate-50/80">
                          {isSelected ? (
                            <span className="text-emerald-700 font-black">▶ {rIdx + 1}</span>
                          ) : (
                            <span>{rIdx + 1}</span>
                          )}
                        </td>

                        {/* 1. Item Code */}
                        <td className="p-0 border-r border-slate-200 h-9 align-middle whitespace-nowrap relative">
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
                            onClick={() => {
                              setSelectedRowIndex(rIdx);
                              if (!row.item_id && (!editingItemCode || editingItemCode.rowIdx !== rIdx)) {
                                openItemListForRow(rIdx);
                              }
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
                                return;
                              }
                              if (e.key === 'ArrowDown' && isDropdownActive && searchResults.length > 0) {
                                e.preventDefault();
                                setSearchHighlightIdx((prev) => Math.min(searchResults.length - 1, prev + 1));
                                return;
                              }
                              if (e.key === 'ArrowUp' && isDropdownActive && searchResults.length > 0) {
                                e.preventDefault();
                                setSearchHighlightIdx((prev) => Math.max(0, prev - 1));
                                return;
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (isDropdownActive && searchResults.length > 0) {
                                  const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                                  if (chosen) {
                                    committedCodeEditRef.current = true;
                                    handleSelectFromTopSearch(chosen, rIdx);
                                    return;
                                  }
                                }
                                if (editingItemCode && editingItemCode.rowIdx === rIdx) {
                                  committedCodeEditRef.current = true;
                                  const ok = commitItemCodeChange(rIdx, editingItemCode.value, true);
                                  if (!ok && row.item_id) {
                                    focusCell(rIdx, 'quantity', 'pos_row');
                                  } else if (!ok && !row.item_id) {
                                    openItemListForRow(rIdx);
                                  }
                                } else if (row.item_id) {
                                  focusCell(rIdx, 'quantity', 'pos_row');
                                } else {
                                  openItemListForRow(rIdx);
                                }
                              }
                            }}
                            placeholder="Code / Click..."
                            className="w-full px-1.5 py-0 font-mono font-bold text-slate-800 text-[11px] bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-full leading-none outline-none"
                          />
                        </td>

                        {/* 2. Company */}
                        <td className="py-0 px-1.5 text-slate-700 border-r border-slate-200 h-9 align-middle truncate max-w-[140px]" title={row.company_name}>
                          {row.company_name || ''}
                        </td>

                        {/* 3. Item Name (Supports clicking to open Item Selection List or typing to search) */}
                        <td className="p-0 border-r border-slate-200 h-9 align-middle relative min-w-[220px]">
                          <input
                            id={`pos_row_${rIdx}_item_name`}
                            type="text"
                            value={
                              editingItemName?.rowIdx === rIdx
                                ? editingItemName.value
                                : row.item_name
                                ? `${row.item_name}${row.packing ? ` (${row.packing})` : ''}`
                                : ''
                            }
                            onFocus={() => {
                              setSelectedRowIndex(rIdx);
                              setShowSearchDropdown(false);
                            }}
                            onClick={() => {
                              setSelectedRowIndex(rIdx);
                              if (!row.item_id && (!editingItemName || editingItemName.rowIdx !== rIdx)) {
                                openItemListForRow(rIdx);
                              }
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSelectedRowIndex(rIdx);
                              setEditingItemName({ rowIdx: rIdx, value: val });
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
                                setEditingItemName((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                setShowSearchDropdown(false);
                                setActiveSearchRowIdx((prev) => (prev === rIdx ? null : prev));
                              }, 160);
                            }}
                            onKeyDown={(e) => {
                              const isDropdownActive =
                                showSearchDropdown && activeSearchRowIdx === rIdx;
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingItemName((prev) => (prev?.rowIdx === rIdx ? null : prev));
                                setShowSearchDropdown(false);
                                setActiveSearchRowIdx(null);
                                return;
                              }
                              if (e.key === 'ArrowDown' && isDropdownActive && searchResults.length > 0) {
                                e.preventDefault();
                                setSearchHighlightIdx((prev) => Math.min(searchResults.length - 1, prev + 1));
                                return;
                              }
                              if (e.key === 'ArrowUp' && isDropdownActive && searchResults.length > 0) {
                                e.preventDefault();
                                setSearchHighlightIdx((prev) => Math.max(0, prev - 1));
                                return;
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (isDropdownActive && searchResults.length > 0) {
                                  const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                                  if (chosen) {
                                    handleSelectFromTopSearch(chosen, rIdx);
                                    return;
                                  }
                                }
                                if (row.item_id) {
                                  focusCell(rIdx, 'quantity', 'pos_row');
                                } else {
                                  openItemListForRow(rIdx);
                                }
                              } else if (e.key === 'ArrowUp' && rIdx > 0) {
                                e.preventDefault();
                                setSelectedRowIndex(rIdx - 1);
                                focusCell(rIdx - 1, 'item_name', 'pos_row');
                              } else if (e.key === 'ArrowDown' && rIdx < rows.length - 1) {
                                e.preventDefault();
                                setSelectedRowIndex(rIdx + 1);
                                focusCell(rIdx + 1, 'item_name', 'pos_row');
                              }
                            }}
                            placeholder="Click to open Item List or type to search..."
                            className="w-full px-1.5 py-0 font-bold text-slate-900 text-[11px] bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-full leading-none outline-none cursor-pointer"
                          />
                          {renderSalesExcelItemCombobox('row', rIdx)}
                        </td>

                        {/* 4. Qty */}
                        <td className="p-0 border-r border-slate-200 h-9 align-middle bg-emerald-50/20">
                          <NumericInput
                            id={`pos_row_${rIdx}_quantity`}
                            value={row.quantity}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'quantity', true)}
                            className="w-full px-1 py-0 text-center font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-full leading-none outline-none"
                          />
                        </td>

                        {/* 5. Discount */}
                        <td className="p-0 text-right border-r border-slate-200 h-9 align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_discount_percent`}
                            value={row.discount_percent}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'discount_percent', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'discount_percent', true)}
                            className="w-full px-1 py-0 text-right font-mono text-[11px] text-slate-800 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-full leading-none outline-none"
                          />
                        </td>

                        {/* 6. Loose Qty */}
                        <td className="p-0 text-center border-r border-slate-200 h-9 align-middle bg-teal-50/20">
                          {isSyrupItem(row) ? (
                            <span className="text-[10px] font-bold text-amber-800">Bottle</span>
                          ) : (
                            <NumericInput
                              id={`pos_row_${rIdx}_loose_quantity`}
                              value={row.loose_quantity}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_quantity', true)}
                              className="w-full px-1 py-0 text-center font-mono font-bold text-[11px] text-teal-950 border border-transparent focus:border-teal-500 bg-transparent focus:bg-white h-full leading-none outline-none"
                            />
                          )}
                        </td>

                        {/* 7. Price */}
                        <td className="p-0 text-right border-r border-slate-200 h-9 align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_unit_price`}
                            value={row.unit_price}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'unit_price', true)}
                            className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-full leading-none outline-none"
                          />
                        </td>

                        {/* 8. Bonus */}
                        <td className="p-0 border-r border-slate-200 h-9 align-middle bg-emerald-50/40">
                          <NumericInput
                            id={`pos_row_${rIdx}_bonus_quantity`}
                            value={row.bonus_quantity ?? 0}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'bonus_quantity', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'bonus_quantity', true)}
                            className="w-full px-1 py-0 text-center font-mono font-bold text-[11px] text-emerald-900 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-full leading-none outline-none"
                            title="Bonus Quantity"
                          />
                        </td>

                        {/* 9. Loose Rate */}
                        <td className="p-0 text-right border-r border-slate-200 h-9 align-middle bg-blue-50/20">
                          <NumericInput
                            id={`pos_row_${rIdx}_loose_rate`}
                            disabled={isSyrupItem(row)}
                            value={row.loose_rate}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_rate', true)}
                            className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-blue-950 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-full leading-none outline-none disabled:opacity-40"
                          />
                        </td>

                        {/* 10. Gross Amount */}
                        <td className="py-0 px-1.5 text-right font-mono font-semibold text-slate-700 text-[11px] border-r border-slate-200 h-9 align-middle whitespace-nowrap">
                          {row.gross_amount > 0 ? row.gross_amount.toFixed(2) : '0.00'}
                        </td>

                        {/* 11. Net Amount */}
                        <td className="py-0 px-1.5 text-right font-mono font-black text-slate-900 bg-slate-50/80 text-[11px] border-r border-slate-200 h-9 align-middle whitespace-nowrap">
                          {row.line_total > 0 ? row.line_total.toFixed(2) : '0.00'}
                        </td>

                        <td className="py-0 px-1 text-center h-9 align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rIdx);
                                openItemListForRow(rIdx);
                              }}
                              className="p-0.5 text-slate-500 hover:text-emerald-700 cursor-pointer leading-none"
                              title="Select or change item from Item List"
                            >
                              <PackageSearch className="w-3.5 h-3.5 inline" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRow(rIdx);
                              }}
                              className="p-0.5 text-slate-500 hover:text-rose-600 cursor-pointer leading-none"
                              title="Delete item"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* POS Record Navigator Bar + MS Access-Style Invoice Item Search */}
            <div className="ams-pos-compact-chrome ams-access-record-bar bg-slate-100 border-t border-slate-300 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[10px] text-slate-700 mr-0.5">Record:</span>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(0)}
                    disabled={selectedRowIndex === 0}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 border border-slate-300 text-[10px] font-mono font-bold cursor-pointer"
                    title="First Record (Home)"
                  >
                    |◀
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(selectedRowIndex - 1)}
                    disabled={selectedRowIndex === 0}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 border border-slate-300 text-[10px] font-mono font-bold cursor-pointer"
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
                    className="w-9 px-1 py-0 bg-white border border-slate-400 font-mono font-bold text-[10px] text-center text-slate-900 focus:border-emerald-600 outline-none"
                    title="Type Record # and press Enter (or use Up/Down arrows)"
                  />
                  <span className="text-[10px] font-mono">of {rows.length}</span>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(selectedRowIndex + 1)}
                    disabled={selectedRowIndex >= rows.length - 1}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 border border-slate-300 text-[10px] font-mono font-bold cursor-pointer"
                    title="Next Record (Down)"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToRecord(rows.length - 1)}
                    disabled={selectedRowIndex >= rows.length - 1}
                    className="px-1 py-0 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 border border-slate-300 text-[10px] font-mono font-bold cursor-pointer"
                    title="Last Record (End)"
                  >
                    ▶|
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertRow}
                    className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-[10px] font-bold text-emerald-800 cursor-pointer ml-0.5"
                    title="Jump to New (Blank) Record"
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
              <div className="text-[10px] text-slate-500 font-mono hidden xl:block">
                Arrow Keys / Tab / Enter to navigate cells &amp; records
              </div>
            </div>
          </div>

          {/* Full-Width POS Bottom Totals & Payment Action Bar (No Cramped Side-by-Side Split) */}
          <div className="ams-pos-compact-chrome w-full bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white rounded-xl border border-slate-700 px-3 py-1.5 shadow-lg shrink-0 space-y-1.5">
            {/* Row 1: Full-Width Financial Totals & Quick Cash Tender */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-1.5">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Gross:</span>
                  <span className="font-mono font-bold text-white">{formatPKR(grossAmount)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-rose-400 font-semibold">Discounts:</span>
                  <span className="font-mono font-bold text-rose-300">
                    -{formatPKR(itemDiscountTotal + computedInvoiceDiscAmt)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Bill Disc %:</span>
                  <NumericInput
                    value={invoiceDiscountPercent}
                    onChange={(e) => setInvoiceDiscountPercent(Math.max(0, Number(e.target.value || 0)))}
                    className="w-16 px-1.5 py-0.5 rounded-lg bg-slate-800 border border-slate-600 font-mono text-xs text-white text-right"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Prev Ledger ({prevBalanceType}):</span>
                  <span className="font-mono font-bold text-amber-300">{formatPKR(prevCustomerBalance)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Tax / Deliv:</span>
                  <span className="font-mono font-bold text-amber-300">
                    +{formatPKR(advanceTaxAmount + deliveryCharges)}
                  </span>
                </div>
              </div>

              {/* Highlighted Net Total, Received & Balance */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-2">
                  <span className="text-xs font-black uppercase text-emerald-300">Net Total:</span>
                  <span className="font-mono text-lg font-black text-emerald-300 ams-total-highlight">
                    {formatPKR(netInvoiceAmount)}
                  </span>
                </div>
                <div className="px-3 py-1 rounded-lg bg-sky-500/15 border border-sky-400/40 flex items-center gap-2">
                  <span className="text-xs font-black uppercase text-sky-300">Receivable:</span>
                  <span className="font-mono text-lg font-black text-sky-300 ams-total-highlight">
                    {formatPKR(totalReceivable)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg border border-emerald-500">
                  <span className="text-xs font-bold text-emerald-300 whitespace-nowrap">Paid:</span>
                  <NumericInput
                    value={paidAmountInput}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="w-28 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono font-black text-white text-right outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleExactCash}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold cursor-pointer"
                  >
                    Exact
                  </button>
                </div>
                <div
                  className={`px-3 py-1 rounded-lg border flex items-center gap-2 ${
                    paidAmount >= totalReceivable
                      ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                      : 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                  }`}
                >
                  <span className="text-xs font-bold uppercase">
                    {paidAmount >= totalReceivable ? 'Change:' : 'Balance:'}
                  </span>
                  <span className="font-mono text-lg font-black ams-total-highlight">
                    {formatPKR(Math.abs(paidAmount - totalReceivable))}
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Full-Width Primary Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed')}
                  className={`py-1.5 px-4 rounded-xl ${
                    editingSaleId
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500'
                  } text-white font-black text-sm shadow-md flex items-center gap-1.5 cursor-pointer`}
                  title={editingSaleId ? 'Update & Save Invoice (Ctrl+S)' : 'Complete & Save Invoice (Ctrl+S)'}
                >
                  <Save className="w-4 h-4" />
                  <span>{editingSaleId ? 'Update Invoice (Ctrl+S)' : 'Save Invoice (Ctrl+S)'}</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', 'a4')}
                  className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-slate-600"
                  title="Save & Print A4 Invoice (Ctrl+P)"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  <span>Save &amp; Print A4</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '80mm')}
                  className="py-1.5 px-2.5 rounded-lg bg-teal-800 hover:bg-teal-700 text-teal-100 font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-teal-300" />
                  <span>80mm</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '58mm')}
                  className="py-1.5 px-2.5 rounded-lg bg-amber-800 hover:bg-amber-700 text-amber-100 font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-300" />
                  <span>58mm</span>
                </button>

                <button
                  type="button"
                  disabled={exportingExcel}
                  onClick={handleExportCurrentSaleToExcel}
                  className="py-1.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-emerald-500/60"
                  title="Export Sales Invoice to Excel (.xlsx)"
                >
                  <Download className="w-4 h-4 text-emerald-200" />
                  <span>Export to Excel</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1 cursor-pointer border border-slate-600"
                >
                  <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Hold</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenCurrentInvoicePreview('a4')}
                  className="py-1.5 px-2.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-sky-500/50"
                >
                  <Eye className="w-3.5 h-3.5 text-sky-200" />
                  <span>Print Preview</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenDsrReport}
                  className="py-1.5 px-2.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-emerald-500/50"
                >
                  <ClipboardList className="w-3.5 h-3.5 text-emerald-200" />
                  <span>DSR</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenSalesSms}
                  className="py-1.5 px-3 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-indigo-500/60"
                  title="Send Customer SMS for Current Sales Invoice"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-200" />
                  <span>Send SMS</span>
                </button>
              </div>

              {onBackToDashboard && (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="py-1.5 px-3 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back / Close</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (FULL-SCREEN DESKTOP FORM) ================= */}
      {invoiceViewMode === 'access' && (
        <div className="flex-1 flex flex-col min-h-0 bg-slate-200 border-2 border-slate-400 rounded-sm shadow-xs select-none">
          {/* Access Window Title Bar & Ribbon Toolbar Combined Compact Strip */}
          <div className="bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 text-white px-2.5 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 text-[11px] shrink-0 select-none">
            <div className="flex items-center gap-2 font-mono">
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-slate-200 tracking-tight">frm_SalesInvoice : Form</span>
              <span className="text-[10px] bg-emerald-700 px-1.5 py-0.2 rounded-lg text-white font-bold uppercase">
                {invoiceType}
              </span>
              <span className="font-bold text-amber-300">{invoiceNumber}</span>
              {editingSaleId && (
                <div className="flex items-center gap-1 bg-amber-600 text-white text-[9px] px-1.5 py-0.2 rounded-lg font-bold">
                  <Pencil className="w-2.5 h-2.5" />
                  <span>EDIT #{editingSaleId}</span>
                  <button
                    type="button"
                    onClick={resetToNewInvoice}
                    className="ml-1 px-1 py-0 bg-amber-800 hover:bg-amber-900 rounded text-[9px] text-white cursor-pointer"
                    title="Cancel edit and start new invoice"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <span className="text-[10px] text-slate-400 hidden xl:inline ml-1">
                (F2: Item Search · F3: Search Bar · Ctrl+S: Save · F9: Hold · Ctrl+P: Print · Esc: Close)
              </span>
            </div>

            {/* Action & Navigation Buttons */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={resetToNewInvoice}
                className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="New Sales Invoice (Ctrl+N)"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                New
              </button>
              <button
                type="button"
                onClick={() => setShowEditSearchModal(true)}
                className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white border border-amber-500 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Find & Edit Existing Invoice (Ctrl+E)"
              >
                <Pencil className="w-3 h-3 text-amber-200" />
                Find / Edit
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed')}
                className={`px-2 py-0.5 rounded-lg ${
                  editingSaleId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                } text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer`}
                title={editingSaleId ? 'Update & Save Changes (F2)' : 'Complete & Save Invoice (F2)'}
              >
                <Save className="w-3 h-3" />
                {editingSaleId ? 'Update (F2)' : 'Save (F2)'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', 'a4')}
                className="px-1.5 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Save & Print A4 Invoice (Ctrl+P)"
              >
                <Printer className="w-3 h-3 text-emerald-400" />
                A4
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', '80mm')}
                className="px-1.5 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Print 80mm Thermal Receipt"
              >
                <Printer className="w-3 h-3 text-teal-400" />
                80mm
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', '58mm')}
                className="px-1.5 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Print 58mm Thermal Receipt"
              >
                <Printer className="w-3 h-3 text-amber-400" />
                58mm
              </button>
              <button
                type="button"
                onClick={() => handleOpenCurrentInvoicePreview('a4')}
                className="px-2 py-0.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white border border-sky-500 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Print Preview for Current Sales Invoice (A4 & Thermal)"
              >
                <Eye className="w-3 h-3 text-sky-200" />
                Print Preview
              </button>
              <button
                type="button"
                onClick={handleOpenDsrReport}
                className="px-2 py-0.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-500 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Open DSR – Daily Stock Requisition Report for Current Invoice"
              >
                <ClipboardList className="w-3 h-3 text-emerald-200" />
                DSR
              </button>
              <button
                type="button"
                onClick={handleOpenSalesSms}
                className="px-2 py-0.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white border border-indigo-500 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Send Customer SMS for Current Sales Invoice"
              >
                <MessageSquare className="w-3 h-3 text-indigo-200" />
                Send SMS
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('held')}
                className="px-1.5 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Hold this invoice (F3)"
              >
                <PauseCircle className="w-3 h-3" />
                Hold
              </button>
              <button
                type="button"
                onClick={() => setShowHeldDrawer(true)}
                className="px-1.5 py-0.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <PlayCircle className="w-3 h-3 text-indigo-200" />
                Drafts ({heldInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => openCustomerShortcut('ledger')}
                className="px-1.5 py-0.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Open selected customer ledger"
              >
                <BookOpen className="w-3 h-3 text-teal-200" />
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(true)}
                className={`px-1.5 py-0.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
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

          {/* Dense MS Access Form Header Controls */}
          <div className="px-2 py-0.5 bg-slate-100 border-b border-slate-300 shrink-0">
            <div className="grid grid-cols-12 gap-1 items-center text-[11px]">
              {/* Inv # (Auto-generated) */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Inv #:
                </label>
                <input
                  type="text"
                  readOnly
                  value={invoiceNumber}
                  title="Auto-generated Sales Invoice Number"
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-mono font-bold text-slate-900 bg-slate-100 cursor-not-allowed text-[11px] h-5"
                />
              </div>

              {/* Date */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-8">
                  Date:
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-mono text-slate-900 bg-white text-[11px] h-5"
                />
              </div>

              {/* Customer Selection */}
              <div className="col-span-4 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-13">
                  Customer:
                </label>
                <div className="flex-1 flex gap-1">
                  <input
                    type="text"
                    placeholder="Find..."
                    value={customerSearchText}
                    onChange={(e) => setCustomerSearchText(e.target.value)}
                    className="w-14 px-1 py-0 rounded-lg border border-slate-300 text-[10px] bg-white h-5"
                  />
                  <select
                    value={customerAccountId}
                    onChange={(e) => {
                      const id = Number(e.target.value);
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
                    }}
                    className="flex-1 px-1 py-0 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                  >
                    <option value={0}>— Select Customer (Walk-in Cash) —</option>
                    {filteredCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.account_name} ({c.account_code}){c.town_name ? ` • ${c.town_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Invoice Type */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-8">
                  Type:
                </label>
                <select
                  value={invoiceType}
                  onChange={(e) => handleInvoiceTypeChange(e.target.value as SalesInvoiceType)}
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Retail">Retail</option>
                  <option value="Wholesale">Wholesale</option>
                </select>
              </div>

              {/* Payment Mode */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Mode:
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => {
                    setPaidAmountManuallyEdited(false);
                    setPaymentMode(e.target.value as SalesPaymentMode);
                  }}
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Cash">Cash</option>
                  <option value="Credit">Credit</option>
                  <option value="Partial">Partial</option>
                  <option value="Bank">Bank</option>
                </select>
              </div>
            </div>

            {/* Row 2: Salesman, Deliveryman, Charges & Customer Live Ledger Strip */}
            <div className="grid grid-cols-12 gap-1 items-center text-[11px] pt-0.5 mt-0.5 border-t border-slate-200">
              {/* Salesman */}
              <div className="col-span-3 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-14 flex items-center gap-0.5">
                  <UserCheck className="w-3 h-3 text-emerald-600" />
                  Salesman:
                </label>
                <select
                  value={salesmanId || ''}
                  onChange={(e) => {
                    const idVal = e.target.value ? Number(e.target.value) : null;
                    setSalesmanId(idVal);
                    const found = salesmenList.find((s) => s.id === idVal);
                    if (found) setSalesman(found.name);
                  }}
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="">-- No Salesman --</option>
                  {filteredSalesmen.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name || sm.full_name} ({sm.salesman_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Deliveryman */}
              <div className="col-span-3 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-16 flex items-center gap-0.5">
                  <Truck className="w-3 h-3 text-sky-600" />
                  Delivery:
                </label>
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
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="">Counter Pickup</option>
                  {filteredDeliverymen.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      {dm.name} ({dm.deliveryman_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Delivery Status */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Status:
                </label>
                <select
                  value={deliveryStatus}
                  onChange={(e) => setDeliveryStatus(e.target.value as any)}
                  className="w-full px-1 py-0 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Pending">Pending</option>
                  <option value="Assigned">Assigned</option>
                  <option value="Out for Delivery">Out</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Failed">Failed</option>
                  <option value="Returned">Returned</option>
                </select>
              </div>

              {/* Customer Previous Balance & Live Ledger Strip */}
              <div className="col-span-4 bg-slate-900 text-white rounded-lg px-2 py-0 flex items-center justify-between text-[10px] h-5">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Prev Bal:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {formatPKR(prevCustomerBalance)}
                  </span>
                </div>
                <div className="flex items-center gap-1 border-l border-slate-700 pl-1.5">
                  <span className="text-slate-400">Total Rec:</span>
                  <span className="font-mono font-black text-emerald-300">
                    {formatPKR(totalReceivable)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openCustomerShortcut('ledger')}
                  className="px-1 py-0 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[9px] font-mono border border-slate-700 cursor-pointer"
                  title="Open full ledger in new view"
                >
                  Ledger ↗
                </button>
              </div>
            </div>
          </div>

          {/* ================= 2. COMPACT BARCODE SCANNER & ROW CONTROLS ================= */}
          <div className="bg-slate-800 px-2 py-0.5 text-white border-b border-slate-700 relative shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              {/* Quick Search & Barcode Scan Input */}
              <div className="flex-1 min-w-[260px] relative">
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg px-2 py-0 focus-within:border-emerald-400 h-5">
                  <Search className="w-3 h-3 text-emerald-400 mr-1.5 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={quickSearchQuery}
                    onFocus={() => {
                      setActiveSearchRowIdx(null);
                      if (quickSearchQuery.trim().length > 0) {
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
                      if (val.trim().length > 0) {
                        setShowSearchDropdown(true);
                        runFastSearch(val);
                      } else {
                        setShowSearchDropdown(false);
                        setSearchResults([]);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        if (quickSearchQuery.trim().length === 0) return;
                        e.preventDefault();
                        if (!showSearchDropdown) {
                          setShowSearchDropdown(true);
                          runFastSearch(quickSearchQuery);
                          return;
                        }
                        setSearchHighlightIdx((prev) => {
                          const next = Math.min(searchResults.length - 1, prev + 1);
                          setTimeout(() => {
                            document
                              .querySelector(`[data-sales-search-idx="${next}"]`)
                              ?.scrollIntoView({ block: 'nearest' });
                          }, 0);
                          return next;
                        });
                      } else if (e.key === 'ArrowUp') {
                        if (quickSearchQuery.trim().length === 0) return;
                        e.preventDefault();
                        if (!showSearchDropdown) {
                          setShowSearchDropdown(true);
                          return;
                        }
                        setSearchHighlightIdx((prev) => {
                          const next = Math.max(0, prev - 1);
                          setTimeout(() => {
                            document
                              .querySelector(`[data-sales-search-idx="${next}"]`)
                              ?.scrollIntoView({ block: 'nearest' });
                          }, 0);
                          return next;
                        });
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (quickSearchQuery.trim().length > 0 && showSearchDropdown && searchResults.length > 0) {
                          const chosen = searchResults[searchHighlightIdx] || searchResults[0];
                          if (chosen) {
                            handleSelectFromTopSearch(chosen);
                            return;
                          }
                        }
                        focusCell(selectedRowIndex, 'item_code', 'cell');
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setShowSearchDropdown(false);
                      }
                    }}
                    placeholder="Barcode Scanner / Manual Item Search (Type Code, Barcode, or Name)..."
                    className="w-full bg-transparent text-[11px] text-white placeholder-slate-400 focus:outline-none"
                  />
                  {quickSearchQuery && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQuickSearchQuery('');
                        setSearchHighlightIdx(0);
                        setShowSearchDropdown(false);
                        setSearchResults([]);
                        searchInputRef.current?.focus();
                      }}
                      className="text-slate-400 hover:text-white mr-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <Barcode className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
                </div>

                {/* Instant Excel-Style Search Combobox (manual search bar only) */}
                {renderSalesExcelItemCombobox('top')}
              </div>

              {/* Row Actions Toolbar */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openItemListForRow(selectedRowIndex)}
                  className="px-2 py-0 rounded-lg bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                  title="Open Item List to select or change item for the selected row"
                >
                  <PackageSearch className="w-3 h-3 text-emerald-400" />
                  Item List
                </button>
                <button
                  type="button"
                  onClick={handleInsertRow}
                  className="px-2 py-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                  title="Add a new line item"
                >
                  <Plus className="w-3 h-3" />
                  Add Row
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteRow(selectedRowIndex)}
                  className="px-2 py-0 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                  title="Delete active row"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyRow(selectedRowIndex)}
                  className="px-1.5 py-0 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 text-[10px] font-semibold flex items-center gap-1 cursor-pointer h-5"
                  title="Copy active row"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => handlePasteRow(selectedRowIndex)}
                  disabled={!copiedRowData}
                  className="px-1.5 py-0 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 border border-slate-600 text-[10px] font-semibold flex items-center gap-1 cursor-pointer h-5"
                  title="Paste into active row"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  Paste
                </button>
                <label
                  className="ml-1 flex items-center gap-1 text-[10px] text-amber-300 bg-slate-900 px-1.5 py-0 rounded-lg border border-slate-700 cursor-pointer h-5"
                  title="Allow Negative Stock for Sales"
                >
                  <input
                    type="checkbox"
                    checked={allowNegativeStock}
                    onChange={(e) => handleToggleNegativeStock(e.target.checked)}
                    className="rounded-lg text-amber-500"
                  />
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  <span>Allow Neg Stock</span>
                </label>
              </div>
            </div>
          </div>

          {/* ================= 3. MICROSOFT ACCESS-STYLE DATASHEET GRID (MIN 10 VISIBLE ROWS) ================= */}
          <div className="flex flex-col flex-1 min-h-[375px] bg-white overflow-hidden select-none border-b border-slate-400">
            {/* Vertical scrolling inside the item grid, sticky column headers */}
            <div className="flex-1 min-h-[342px] overflow-y-auto overflow-x-auto relative">
              <table className="ams-compact-10-grid w-full border-collapse text-[11px] font-sans leading-none min-w-[1180px]">
                <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400 text-slate-800 text-[10px] font-bold select-none shadow-sm leading-none">
                  <tr className="h-6">
                    {/* Access Row Selector column */}
                    <th
                      style={{ width: `${colWidths.selector}px`, minWidth: `${colWidths.selector}px` }}
                      className="bg-slate-300/80 border-r border-slate-400 px-1 py-0 text-center font-mono relative h-6"
                    >
                      #
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('selector', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 1. Item Code */}
                    <th
                      style={{ width: `${colWidths.item_code}px`, minWidth: `${colWidths.item_code}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-6"
                    >
                      Item Code
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('item_code', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 2. Company */}
                    <th
                      style={{ width: `${colWidths.company}px`, minWidth: `${colWidths.company}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-6"
                    >
                      Company
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('company', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 3. Item Name */}
                    <th
                      style={{ width: `${colWidths.item_name}px`, minWidth: `${colWidths.item_name}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-6"
                    >
                      Item Name
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('item_name', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 4. Qty */}
                    <th
                      style={{ width: `${colWidths.quantity}px`, minWidth: `${colWidths.quantity}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-emerald-100/60 text-emerald-950 relative h-6"
                    >
                      Qty
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('quantity', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 5. Discount */}
                    <th
                      style={{ width: `${colWidths.discount}px`, minWidth: `${colWidths.discount}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right relative h-6"
                    >
                      Discount
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('discount', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 6. Loose Qty */}
                    <th
                      style={{ width: `${colWidths.loose_quantity}px`, minWidth: `${colWidths.loose_quantity}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-teal-100/60 text-teal-950 relative h-6"
                    >
                      Loose Qty
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('loose_quantity', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 7. Price */}
                    <th
                      style={{ width: `${colWidths.unit_price}px`, minWidth: `${colWidths.unit_price}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right relative h-6"
                    >
                      Price
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('unit_price', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 8. Bonus */}
                    <th
                      style={{ width: `${colWidths.bonus_quantity}px`, minWidth: `${colWidths.bonus_quantity}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-emerald-100/70 text-emerald-950 relative h-6"
                    >
                      Bonus
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('bonus_quantity', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 9. Loose Rate */}
                    <th
                      style={{ width: `${colWidths.loose_rate}px`, minWidth: `${colWidths.loose_rate}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-blue-100/60 text-blue-950 relative h-6"
                    >
                      Loose Rate
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('loose_rate', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 10. Gross Amount */}
                    <th
                      style={{ width: `${colWidths.gross_amount}px`, minWidth: `${colWidths.gross_amount}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-slate-200/70 relative h-6"
                    >
                      Gross Amount
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('gross_amount', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 11. Net Amount */}
                    <th
                      style={{ width: `${colWidths.amount}px`, minWidth: `${colWidths.amount}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-slate-300/60 font-black relative h-6"
                    >
                      Net Amount
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('amount', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* Actions / Batch */}
                    <th
                      style={{ width: `${colWidths.actions}px`, minWidth: `${colWidths.actions}px` }}
                      className="px-1 py-0 text-center relative h-6"
                    >
                      Batch / Del
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('actions', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => {
                    const isSelected = rIdx === selectedRowIndex;
                    const isActiveSearchMatch = invoiceSearchActiveRow === rIdx;
                    const isSearchMatch = invoiceSearchMatchedRows.includes(rIdx);
                    const remainingUnits = round2(row.available_stock_units - row.total_units);
                    const isOverStock =
                      row.item_id !== null && !allowNegativeStock && remainingUnits < 0;

                    return (
                      <tr
                        key={row.row_id}
                        data-sales-row-idx={rIdx}
                        onClick={() => setSelectedRowIndex(rIdx)}
                        className={`border-b border-slate-300 font-sans transition-colors h-[16px] leading-none ${
                          isActiveSearchMatch
                            ? 'bg-amber-200/90 ring-2 ring-inset ring-amber-500 font-semibold'
                            : isSearchMatch
                            ? 'bg-sky-100/90 font-medium'
                            : isOverStock
                            ? 'bg-rose-100/90'
                            : isSelected
                            ? 'bg-amber-50/90 font-medium'
                            : rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/60 hover:bg-slate-100/60'
                        }`}
                      >
                        {/* Access Row Selector column showing ▶ on active row */}
                        <td className="border-r border-slate-300 px-0.5 py-0 text-center bg-slate-100 font-mono text-[9.5px] text-slate-700 h-[16px] align-middle">
                          {isSelected ? (
                            <span className="text-black font-black text-[8.5px]">▶</span>
                          ) : !row.item_id && rIdx === rows.length - 1 ? (
                            <span className="text-slate-400 font-bold">*</span>
                          ) : (
                            <span>{rIdx + 1}</span>
                          )}
                        </td>

                        {/* 1. Item Code (Searchable with live dropdown + explicit validation; never deletes item on click) */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
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

                        {/* 2. Company */}
                        <td
                          className="border-r border-slate-300 px-1 py-0 text-slate-700 truncate text-[10px] h-[16px] align-middle max-w-[130px]"
                          title={row.company_name}
                        >
                          {row.company_name || ''}
                        </td>

                        {/* 3. Item Name (Live searchable while typing; clicking/focusing never opens popup or modifies/deletes item) */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
                          <input
                            id={`cell_${rIdx}_item_name`}
                            type="text"
                            value={
                              editingItemName?.rowIdx === rIdx
                                ? editingItemName.value
                                : row.item_name
                            }
                            onFocus={() => {
                              setSelectedRowIndex(rIdx);
                              setShowSearchDropdown(false);
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
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'item_name')}
                            placeholder="Type Item Name / Code (or F2)..."
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-semibold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                          {renderSalesExcelItemCombobox('row', rIdx)}
                        </td>

                        {/* 4. Qty */}
                        <td className="border-r border-slate-300 p-0 bg-emerald-50/20 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_quantity`}
                            value={row.quantity}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'quantity')}
                            className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 5. Discount */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_discount_percent`}
                            value={row.discount_percent}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'discount_percent', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'discount_percent')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 6. Loose Qty */}
                        <td className="border-r border-slate-300 p-0 bg-teal-50/20 h-[16px] align-middle">
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
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_quantity')}
                                className="w-full px-1 py-0 border border-transparent focus:border-teal-600 focus:bg-white text-right font-mono font-bold text-teal-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                              {row.item_id && row.units_per_strip > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRowField(
                                      rIdx,
                                      'loose_quantity',
                                      Number(row.loose_quantity || 0) + row.units_per_strip
                                    )
                                  }
                                  title={`Add 1 Strip (+${row.units_per_strip} Loose Units)`}
                                  className="px-0.5 py-0 rounded-lg bg-teal-100 hover:bg-teal-200 text-teal-800 font-mono text-[8px] font-bold shrink-0 cursor-pointer mr-0.5 leading-tight"
                                >
                                  +1S
                                </button>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 7. Price */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_unit_price`}
                            value={row.unit_price}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'unit_price')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 8. Bonus */}
                        <td className="border-r border-slate-300 p-0 bg-emerald-50/40 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_bonus_quantity`}
                            value={row.bonus_quantity ?? 0}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'bonus_quantity', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'bonus_quantity')}
                            className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-emerald-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                            title="Bonus Quantity (Free items deducted from stock)"
                          />
                        </td>

                        {/* 9. Loose Rate */}
                        <td className="border-r border-slate-300 p-0 bg-blue-50/20 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_loose_rate`}
                            disabled={isSyrupItem(row)}
                            value={row.loose_rate}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_rate')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-blue-950 bg-transparent text-[11px] h-[15px] leading-none outline-none disabled:opacity-40"
                            title="Loose Rate per unit (Press Enter to add next item row)"
                          />
                        </td>

                        {/* 10. Gross Amount */}
                        <td className="border-r border-slate-300 px-1 py-0 text-right font-mono font-semibold text-slate-700 bg-slate-50/30 text-[11px] h-[16px] align-middle">
                          {row.gross_amount > 0 ? row.gross_amount.toFixed(2) : ''}
                        </td>

                        {/* 11. Net Amount */}
                        <td className="border-r border-slate-300 px-1 py-0 text-right font-mono font-black text-slate-900 bg-slate-50/60 text-[11px] h-[16px] align-middle">
                          {row.line_total > 0 ? row.line_total.toFixed(2) : ''}
                        </td>

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
                                className="w-15 px-0.5 py-0 border border-slate-300 rounded-lg font-mono text-[8.5px] bg-white h-[14px]"
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
                                className="text-[9px] font-mono text-slate-500 w-15 truncate"
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
                                handleDeleteRow(rIdx);
                              }}
                              className="text-rose-600 hover:text-rose-900 font-bold text-[9.5px] cursor-pointer px-0.5 leading-none"
                              title="Delete line"
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

            {/* Combined Microsoft Access Record Navigator, Invoice Search & Customer History Strip */}
            <div className="ams-access-record-bar bg-slate-200 border-t border-slate-400 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
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
                      ({Number(activeItemHistory.lastCustomerSale.discount_percent || 0)}% Disc)
                    </span>
                    <span className="text-slate-600">{activeItemHistory.lastCustomerSale.invoice_date}</span>
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
                    onClick={() => setShowHistoryTable((v) => !v)}
                    className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-50 border border-slate-400 text-slate-700 font-bold text-[9px] cursor-pointer"
                  >
                    {showHistoryTable ? 'Hide History ▲' : 'History ▼'}
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

          {/* Expandable History Table if toggled */}
          {showHistoryTable && activeRow?.item_id && (
            <div className="bg-slate-100 border-b border-slate-300 px-2 py-1 text-[10px] shrink-0">
              <div className="flex items-center gap-1.5 mb-1">
                <button
                  type="button"
                  onClick={() => setHistoryTab('customer_sales')}
                  className={`px-2 py-0 rounded-lg text-[10px] font-bold cursor-pointer ${
                    historyTab === 'customer_sales'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  Customer Sales ({activeItemHistory?.customerSalesHistory?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('item_purchases')}
                  className={`px-2 py-0 rounded-lg text-[10px] font-bold cursor-pointer ${
                    historyTab === 'item_purchases'
                      ? 'bg-sky-700 text-white'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  Store Purchases ({activeItemHistory?.purchaseHistory?.length || 0})
                </button>
              </div>
              <div className="max-h-20 overflow-y-auto border border-slate-300 rounded-lg bg-white">
                {historyTab === 'customer_sales' ? (
                  <table className="w-full text-left border-collapse text-[10px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-0.5">Inv #</th>
                        <th className="px-2 py-0.5">Date</th>
                        <th className="px-2 py-0.5">Customer</th>
                        <th className="px-2 py-0.5">Batch</th>
                        <th className="px-2 py-0.5 text-right">Qty</th>
                        <th className="px-2 py-0.5 text-right">Rate</th>
                        <th className="px-2 py-0.5 text-right">Disc</th>
                        <th className="px-2 py-0.5 text-right">Total</th>
                        <th className="px-2 py-0.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeItemHistory?.customerSalesHistory || []).map((h, i) => (
                        <tr key={h.sale_item_id || i} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="px-2 py-0.5 font-bold text-emerald-800">{h.invoice_number}</td>
                          <td className="px-2 py-0.5">{h.invoice_date}</td>
                          <td className="px-2 py-0.5 font-sans">{h.customer_name}</td>
                          <td className="px-2 py-0.5">{h.batch_number}</td>
                          <td className="px-2 py-0.5 text-right font-bold">{h.quantity}P</td>
                          <td className="px-2 py-0.5 text-right font-bold">{formatPKR(h.unit_price)}</td>
                          <td className="px-2 py-0.5 text-right text-rose-700">{Number(h.discount_percent || 0)}%</td>
                          <td className="px-2 py-0.5 text-right font-bold">{formatPKR(h.line_total)}</td>
                          <td className="px-2 py-0.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                updateRowField(selectedRowIndex, 'unit_price', round2(h.unit_price));
                                updateRowField(selectedRowIndex, 'discount_percent', round2(h.discount_percent || 0));
                              }}
                              className="px-1.5 py-0 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[9px] cursor-pointer"
                            >
                              Use
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse text-[10px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-0.5">Bill #</th>
                        <th className="px-2 py-0.5">Date</th>
                        <th className="px-2 py-0.5">Supplier</th>
                        <th className="px-2 py-0.5">Batch</th>
                        <th className="px-2 py-0.5 text-right">Qty</th>
                        <th className="px-2 py-0.5 text-right">Pur. Cost</th>
                        <th className="px-2 py-0.5 text-right">Retail MRP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeItemHistory?.purchaseHistory || []).map((p, i) => (
                        <tr key={p.purchase_item_id || i} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="px-2 py-0.5 font-bold text-sky-800">{p.bill_number}</td>
                          <td className="px-2 py-0.5">{p.bill_date}</td>
                          <td className="px-2 py-0.5 font-sans">{p.supplier_name}</td>
                          <td className="px-2 py-0.5">{p.batch_number}</td>
                          <td className="px-2 py-0.5 text-right font-bold">{p.quantity}P</td>
                          <td className="px-2 py-0.5 text-right font-bold text-sky-900">{formatPKR(p.purchase_price)}</td>
                          <td className="px-2 py-0.5 text-right">{formatPKR(p.retail_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ================= 4. FULL-WIDTH DESKTOP CALCULATION & ACTION FOOTER (NO SIDE-BY-SIDE SPLIT) ================= */}
          <div className="p-1.5 bg-slate-900 text-white border-t border-slate-700 flex flex-col gap-1.5 shrink-0">
            {/* Row 1: Full-Width Totals, Discounts, Paid Amount & Balance */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">A/C:</span>
                  <select
                    value={paymentAccountId || ''}
                    onChange={(e) => setPaymentAccountId(Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-white font-semibold text-xs"
                  >
                    {financialAccounts.map((fa) => (
                      <option key={fa.id} value={fa.id}>
                        {fa.account_name} ({fa.account_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Gross ({validRows.length}):</span>
                  <span className="font-mono font-bold text-white">{formatPKR(grossAmount)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Inv Disc:</span>
                  <NumericInput
                    value={invoiceDiscountPercent}
                    onChange={(e) => {
                      const pct = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                      setInvoiceDiscountPercent(pct);
                      setInvoiceDiscountAmount(round2((subtotalAfterItemDisc * pct) / 100));
                    }}
                    className="w-14 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-right text-white"
                    placeholder="%"
                  />
                  <NumericInput
                    value={invoiceDiscountAmount}
                    onChange={(e) => {
                      setInvoiceDiscountPercent(0);
                      setInvoiceDiscountAmount(Math.max(0, Number(e.target.value || 0)));
                    }}
                    className="w-20 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs text-right text-white"
                    placeholder="PKR"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Prev Ledger:</span>
                  <span className="font-mono font-semibold text-amber-300">{formatPKR(prevCustomerBalance)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="px-2.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-1.5">
                  <span className="text-xs uppercase font-bold text-emerald-300">Net Invoice:</span>
                  <span className="font-mono text-base font-black text-emerald-300 ams-total-highlight">
                    {formatPKR(netInvoiceAmount)}
                  </span>
                </div>
                <div className="px-2.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 flex items-center gap-1.5">
                  <span className="text-xs uppercase font-bold text-sky-300">Total Rec:</span>
                  <span className="font-mono text-base font-black text-sky-300 ams-total-highlight">
                    {formatPKR(totalReceivable)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs uppercase font-bold text-slate-300">Paid:</span>
                  <NumericInput
                    value={paidAmountInput}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="w-24 px-1.5 py-0.5 rounded bg-slate-800 border border-emerald-500 text-right font-mono font-bold text-emerald-300 text-xs"
                  />
                </div>
                <div className="px-2.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 flex items-center gap-1.5">
                  <span className="text-xs uppercase font-bold text-amber-300">Balance:</span>
                  <span className="font-mono text-base font-black text-amber-300 ams-total-highlight">
                    {formatPKR(remainingBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Full-Width Action Buttons Bar */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed')}
                  className={`px-3.5 py-1 rounded-lg ${
                    editingSaleId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  } text-white text-xs font-black flex items-center gap-1 cursor-pointer shadow-sm`}
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingSaleId ? 'Update (Ctrl+S)' : 'Save Invoice (Ctrl+S)'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', 'a4')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  A4 Print
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '80mm')}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-teal-400" />
                  80mm
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '58mm')}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  58mm
                </button>
                <button
                  type="button"
                  disabled={exportingExcel}
                  onClick={handleExportCurrentSaleToExcel}
                  className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  title="Export Sales Invoice to Excel (.xlsx)"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Excel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  Hold (F9)
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenCurrentInvoicePreview('a4')}
                  className="px-2.5 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-sky-200" />
                  Print Preview
                </button>
                <button
                  type="button"
                  onClick={handleOpenDsrReport}
                  className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <ClipboardList className="w-3.5 h-3.5 text-emerald-200" />
                  DSR
                </button>
                <button
                  type="button"
                  onClick={handleOpenSalesSms}
                  className="px-2.5 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  title="Send Customer SMS for Current Sales Invoice"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-200" />
                  Send SMS
                </button>
                <button
                  type="button"
                  onClick={handleReprintLastInvoice}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Reprint
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(true)}
                  className="px-2.5 py-1 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Discard
                </button>
                {onBackToDashboard && (
                  <button
                    type="button"
                    onClick={onBackToDashboard}
                    className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back / Close
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
                <div className="flex items-center justify-between bg-slate-100 p-3 rounded-lg">
                  <div>
                    <div className="font-bold text-slate-900">
                      {customerLedgerData?.selectedAccount?.account_name ||
                        selectedCustomer?.account_name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Opening: {formatPKR(customerLedgerData?.summary?.openingBalance || 0)} (
                      {customerLedgerData?.summary?.openingBalanceType || 'Debit'})
                    </div>
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

                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-900 text-white">
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
                      {(customerLedgerData?.entries || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400">
                            No posted ledger transactions yet for this customer.
                          </td>
                        </tr>
                      ) : (
                        (customerLedgerData?.entries || []).map((e: any) => (
                          <tr key={e.id} className="border-b border-slate-100">
                            <td className="px-2.5 py-1.5 font-mono">{e.entry_date}</td>
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

      {/* ================= MODAL 3: HELD / DRAFT INVOICES DRAWER ================= */}
      {showHeldDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Held & Draft Sales Invoices ({heldInvoices.length})
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
                        No held or draft invoices currently saved.
                      </td>
                    </tr>
                  ) : (
                    heldInvoices.map((h) => (
                      <tr key={h.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono font-bold">{h.invoice_number}</td>
                        <td className="px-3 py-2 font-mono">{h.invoice_date}</td>
                        <td className="px-3 py-2 font-semibold">{h.customer_name}</td>
                        <td className="px-3 py-2 uppercase font-bold text-amber-700">
                          {h.status}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatPKR(h.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleResumeInvoice(h.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
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
                        <td className="px-3 py-2 font-mono text-slate-700">{inv.invoice_date}</td>
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

      {/* ================= MODAL 5: PRINT PREVIEW (A4 / 80mm / 58mm) ================= */}
      {printInvoice && (
        <SalesPrintModal
          invoice={printInvoice}
          initialFormat={printFormat}
          onClose={() => setPrintInvoice(null)}
        />
      )}

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
        items={catalogItems}
        indexedItems={indexedCatalog}
        targetRowIndex={itemListTargetRowIdx}
        targetRowItem={itemListTargetRowIdx !== null ? rows[itemListTargetRowIdx] : null}
        invoiceLabel="Sales Invoice"
        getItemRate={(it) =>
          invoiceType === 'Wholesale'
            ? round2(it.wholesale_price || it.trade_price || it.retail_price)
            : round2(it.retail_price)
        }
        getItemStock={(it) =>
          it.total_available_packs ?? it.default_batch?.available_packs ?? 0
        }
        onSelectItem={(chosen) => {
          if (itemListTargetRowIdx !== null) {
            populateRowWithItem(itemListTargetRowIdx, chosen, true);
          } else {
            handleSelectFromTopSearch(chosen);
          }
          setShowItemListModal(false);
          setItemListTargetRowIdx(null);
        }}
        onSwitchToAddNewLine={() => setItemListTargetRowIdx(null)}
        onClose={() => {
          setShowItemListModal(false);
          setItemListTargetRowIdx(null);
        }}
      />
    </div>
  );
};
