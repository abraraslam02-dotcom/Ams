import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ShoppingBag,
  Plus,
  Trash2,
  Save,
  Printer,
  Edit2,
  XCircle,
  ArrowDownLeft,
  Boxes,
  Sliders,
  FileSpreadsheet,
  ListChecks,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Scale,
  Search,
  Barcode,
  Zap,
  Banknote,
  UserPlus,
  Phone,
  ChevronDown,
  X,
  PauseCircle,
  Clock,
  Download,
  ArrowLeft,
  MessageSquare,
  PackageSearch,
  Calculator,
} from 'lucide-react';
import { Item, ItemVariant } from '../../types/item';
import { Account, FilerStatus } from '../../types/account';
import { PartyCitySelect } from '../accounts/PartyCitySelect';
import {
  AdvanceTaxSettings,
  AdvanceTaxHistoryEntry,
  PurchaseInvoice,
  PurchaseLineItem,
  PurchaseReturn,
  PurchaseReturnLineItem,
  BatchInventoryItem,
  PurchasePaymentMode,
  JournalEntryLineView,
} from '../../types/purchase';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { findExactBarcodeOrCodeMatch, prepareItemIndex } from '../../utils/itemSearch';
import { PurchasePrintModal } from './PurchasePrintModal';
import { AdvanceTaxSettingsPanel } from './AdvanceTaxSettingsPanel';
import { BatchInventoryPanel } from './BatchInventoryPanel';
import { PurchaseReturnPanel } from './PurchaseReturnPanel';
import { PurchaseReportsPanel } from './PurchaseReportsPanel';
import { NumericInput } from '../common/NumericInput';
import { exportPurchaseInvoicesToExcel } from '../../utils/invoiceExcelExport';
import { CustomExcelExportModal } from '../common/CustomExcelExportModal';
import { InvoiceSmsModal } from '../common/InvoiceSmsModal';
import { ItemListSelectionModal } from '../common/ItemListSelectionModal';
import { DuplicateItemConfirmModal } from '../common/DuplicateItemConfirmModal';
import { VariantPickerModal } from '../common/VariantPickerModal';
import { ProductThumb } from '../common/ProductThumb';
import { ItemLogModal } from '../common/ItemLogModal';
import { ItemFormModal } from '../items/ItemFormModal';
import { CompactItemHistoryPopup } from '../common/CompactItemHistoryPopup';
import { CustomerItemHistoryResponse } from '../../types/sales';
import {
  InvoiceRecordSearchInput,
  InvoiceSearchableItem,
} from '../common/InvoiceRecordSearchInput';
import { generatePurchaseOrderSmsText } from '../../utils/invoiceSms';
import {
  calculateItemPricingFromPurchase,
  calculateLooseRateFromRetail,
  parsePackingUnits as parseUnitsPerPack,
  round2,
} from '../../utils/itemPricing';

export type PurchaseSubTab =
  | 'new-invoice'
  | 'register'
  | 'purchase-return'
  | 'batch-stock'
  | 'advance-tax'
  | 'reports';

interface PurchasesWorkspaceViewProps {
  initialSubTab?: PurchaseSubTab;
  resumePurchaseId?: number | null;
  onClearResume?: () => void;
  onBackToDashboard?: () => void;
}

export const INITIAL_PURCHASE_ROWS = 15;
const ACTIVE_PURCHASE_DRAFT_KEY = 'ams_active_purchase_draft_v2';

const isHeldPurchaseStatus = (status: unknown): boolean => {
  const s = String(status || '').trim().toLowerCase();
  return s === 'held' || s === 'draft' || s === 'on_hold' || s === 'on hold' || s === 'hold';
};

function calculateRetailFromPurchasePrice(newPurchasePrice: number): {
  retailBase: number;
  roundedRetailPrice: number;
} {
  const pricing = calculateItemPricingFromPurchase(newPurchasePrice, '1x1');
  return { retailBase: pricing.retailPrice, roundedRetailPrice: pricing.retailPrice };
}

export const createBlankPurchaseLine = (): PurchaseLineItem => ({
  item_id: 0,
  variant_id: null,
  variant_code: '',
  variant_name: '',
  thumbnail_url: null,
  item_code: '',
  company_name: '',
  item_name: '',
  packing: '',
  units_per_pack: 0,
  batch_number: '',
  manufacturing_date: '',
  expiry_date: '',
  quantity: 0,
  loose_quantity: 0,
  bonus_quantity: 0,
  purchase_rate: 0,
  loose_rate: 0,
  is_loose_rate_manual: false,
  mrp_rate: 0,
  gross_amount: 0,
  discount_percent: 0,
  discount_amount: 0,
  taxable_amount: 0,
  tax_percent: 0,
  tax_amount: 0,
  line_total: 0,
  remarks: '',
  master_purchase_price: 0,
  master_retail_price: 0,
  last_prompted_purchase_rate: undefined,
  update_master_purchase_price: false,
  update_master_retail_price: false,
});

function isPurchaseLinePopulated(line?: PurchaseLineItem): boolean {
  if (!line) return false;
  return Number(line.item_id || 0) > 0;
}

export function ensureMinimumPurchaseRows(
  inputLines: PurchaseLineItem[],
  minCount: number = INITIAL_PURCHASE_ROWS,
  _activeRowIdx: number = 0
): PurchaseLineItem[] {
  const result = [...inputLines];
  let lastPopulatedIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (isPurchaseLinePopulated(result[i])) {
      lastPopulatedIdx = i;
      break;
    }
  }
  // Keep at least 15 visible rows plus 1 ready-to-use blank entry row
  const minFloor = Math.max(INITIAL_PURCHASE_ROWS, minCount || INITIAL_PURCHASE_ROWS);
  const desiredCount = Math.max(minFloor, lastPopulatedIdx >= 0 ? lastPopulatedIdx + 2 : minFloor);

  while (result.length < desiredCount) {
    result.push(createBlankPurchaseLine());
  }
  while (result.length > desiredCount && !isPurchaseLinePopulated(result[result.length - 1])) {
    result.pop();
  }
  return result;
}

// Enable inline item suggestions while typing in the Item Code / Item Name cells.
const ROW_SUGGESTIONS_ENABLED = true;

export function findNextBlankPurchaseRowIndex(
  inputLines: PurchaseLineItem[],
  fromRowIdx: number
): number {
  const start = Math.max(0, fromRowIdx) + 1;
  for (let i = start; i < inputLines.length; i++) {
    if (!isPurchaseLinePopulated(inputLines[i])) {
      return i;
    }
  }
  return inputLines.length;
}

export const PurchasesWorkspaceView: React.FC<PurchasesWorkspaceViewProps> = ({
  initialSubTab = 'new-invoice',
  resumePurchaseId,
  onClearResume,
  onBackToDashboard,
}) => {
  const [subTab, setSubTab] = useState<PurchaseSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // Master Data & Tax Settings
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Account[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Account[]>([]);
  const [taxSettings, setTaxSettings] = useState<AdvanceTaxSettings | null>(null);
  const [taxHistory, setTaxHistory] = useState<AdvanceTaxHistoryEntry[]>([]);

  // Transactions & Stock Lists
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [heldPurchases, setHeldPurchases] = useState<PurchaseInvoice[]>([]);
  const [showHeldModal, setShowHeldModal] = useState<boolean>(false);
  const [loadingHeld, setLoadingHeld] = useState<boolean>(false);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [batches, setBatches] = useState<BatchInventoryItem[]>([]);
  const [nextPurchaseNo, setNextPurchaseNo] = useState(() => {
    const d = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `PI-001-${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  });
  const [nextReturnNo, setNextReturnNo] = useState('PRN-2026-0001');
  const [loading, setLoading] = useState(false);

  // Purchase Invoice Form State
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [editingPurchaseStatus, setEditingPurchaseStatus] = useState<string | null>(null);
  const editingPurchaseIdRef = useRef<number | null>(null);
  const isResumingPurchaseRef = useRef<boolean>(false);
  useEffect(() => {
    editingPurchaseIdRef.current = editingPurchaseId;
  }, [editingPurchaseId]);
  const [billNumber, setBillNumber] = useState(() => {
    const d = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `PI-001-${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  });
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierFilerStatus, setSupplierFilerStatus] = useState<FilerStatus>('Filer');
  const [notes, setNotes] = useState('');

  // Discounts, Tax Override & Payment
  const [invoiceDiscountPercent, setInvoiceDiscountPercent] = useState<number>(0);
  const [invoiceDiscountAmount, setInvoiceDiscountAmount] = useState<number>(0);
  const [isTaxOverridden, setIsTaxOverridden] = useState<boolean>(false);
  const [customAdvanceTaxRate, setCustomAdvanceTaxRate] = useState<number>(0.5);
  const [taxOverrideReason, setTaxOverrideReason] = useState<string>('');
  const [taxOverrideAuthorizedBy, setTaxOverrideAuthorizedBy] = useState<string>(
    'Chief Pharmacist / Admin'
  );
  const [paymentMode, setPaymentMode] = useState<PurchasePaymentMode>('Cash');
  const [paymentAccountId, setPaymentAccountId] = useState<string>('');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidAmountManuallyEdited, setPaidAmountManuallyEdited] = useState<boolean>(false);

  // Dynamic Responsive Datasheet Row Capacity (Automatically adapts to screen height on mount & window resize)
  const [visibleRowCapacity, setVisibleRowCapacity] = useState<number>(INITIAL_PURCHASE_ROWS);
  const visibleRowCapacityRef = useRef<number>(INITIAL_PURCHASE_ROWS);
  const posGridViewportRef = useRef<HTMLDivElement | null>(null);
  const accessGridViewportRef = useRef<HTMLDivElement | null>(null);
  // Keyboard navigation is active immediately across both Purchase POS and MS Access grids
  const posDatasheetMouseActivatedRef = useRef(true);

  // Datasheet Lines (15 visible rows, with an extra blank row when needed)
  const [lines, setLines] = useState<PurchaseLineItem[]>(() =>
    ensureMinimumPurchaseRows([], INITIAL_PURCHASE_ROWS)
  );
  const [draftRestored, setDraftRestored] = useState(false);
  const [purchaseSearchMatchedRows, setPurchaseSearchMatchedRows] = useState<number[]>([]);
  const [purchaseSearchActiveRow, setPurchaseSearchActiveRow] = useState<number | null>(null);

  // TWO INDEPENDENT INVOICE INTERFACES: Option 1 (POS View) vs Option 2 (MS Access View)
  const [purchaseViewMode, setPurchaseViewMode] = useState<'pos' | 'access'>(() => {
    try {
      const saved = localStorage.getItem('ams_purchase_invoice_view_mode');
      return saved === 'access' ? 'access' : 'pos';
    } catch {
      return 'pos';
    }
  });

  useEffect(() => {
    posDatasheetMouseActivatedRef.current = true;
  }, [purchaseViewMode]);

  const togglePurchaseViewMode = (mode: 'pos' | 'access') => {
    setPurchaseViewMode(mode);
    try {
      localStorage.setItem('ams_purchase_invoice_view_mode', mode);
    } catch {
      // ignore
    }
  };

  // Focus & Search Refs
  const supplierSearchInputRef = useRef<HTMLInputElement | null>(null);
  const itemSearchInputRef = useRef<HTMLInputElement | null>(null);
  const supplierDropdownContainerRef = useRef<HTMLDivElement | null>(null);
  const itemDropdownContainerRef = useRef<HTMLDivElement | null>(null);
  const supplierListRef = useRef<HTMLDivElement | null>(null);
  const itemListRef = useRef<HTMLDivElement | null>(null);
  const priceDialogRef = useRef<HTMLDivElement | null>(null);
  const priceDialogPurchaseInputRef = useRef<HTMLInputElement | null>(null);
  const priceDialogRetailInputRef = useRef<HTMLInputElement | null>(null);
  const priceDialogLooseInputRef = useRef<HTMLInputElement | null>(null);
  const lastPromptedRateByRowRef = useRef<Record<number, number>>({});
  const isPricePromptOpenRef = useRef<boolean>(false);

  // Supplier Search Dropdown State
  const [supplierSearchQuery, setSupplierSearchQuery] = useState<string>('');
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState<boolean>(false);
  const [supplierHighlightIndex, setSupplierHighlightIndex] = useState<number>(0);

  // Add New Supplier Modal State
  const [showAddSupplierModal, setShowAddSupplierModal] = useState<boolean>(false);

  // Purchase Order SMS Modal State
  const [showPurchaseSmsModal, setShowPurchaseSmsModal] = useState<boolean>(false);
  const [purchaseSmsText, setPurchaseSmsText] = useState<string>('');
  const [storeDisplayName, setStoreDisplayName] = useState<string>('ABRAR MEDICAL STORE');
  const [newSupplierCode, setNewSupplierCode] = useState<string>('SUP-0001');
  const [newSupplierName, setNewSupplierName] = useState<string>('');
  const [newSupplierMobile, setNewSupplierMobile] = useState<string>('');
  const [newSupplierContactPerson, setNewSupplierContactPerson] = useState<string>('');
  const [newSupplierFilerStatus, setNewSupplierFilerStatus] = useState<FilerStatus>('Filer');
  const [newSupplierCity, setNewSupplierCity] = useState<string>('');
  const [newSupplierAddress, setNewSupplierAddress] = useState<string>('');
  const [newSupplierOpeningBalance, setNewSupplierOpeningBalance] = useState<number>(0);
  const [newSupplierOpeningType, setNewSupplierOpeningType] = useState<'Credit' | 'Debit'>('Credit');
  const [creatingSupplier, setCreatingSupplier] = useState<boolean>(false);
  const [addSupplierError, setAddSupplierError] = useState<string | null>(null);

  // Item Search Dropdown State
  const [selectedPurchaseLineIndex, setSelectedPurchaseLineIndex] = useState<number>(0);
  const [purchaseRecordJumpInput, setPurchaseRecordJumpInput] = useState<string>('1');
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState<string>('');
  const [showPurchaseSearchDropdown, setShowPurchaseSearchDropdown] = useState<boolean>(false);
  const [itemHighlightIndex, setItemHighlightIndex] = useState<number>(0);

  // Inline Row Cell Item Search State (for Datasheet cells in both POS & MS Access View)
  const [activeRowItemSearchIdx, setActiveRowItemSearchIdx] = useState<number | null>(null);
  const [activeRowItemSearchField, setActiveRowItemSearchField] = useState<'item_code' | 'item_name' | null>(null);
  const [rowItemSearchQuery, setRowItemSearchQuery] = useState<string>('');
  const [rowItemHighlightIndex, setRowItemHighlightIndex] = useState<number>(0);
  const purchaseSearchReqIdRef = useRef<number>(0);

  // Shared Item Selection List Modal State (Reuses Sales ItemListSelectionModal)
  const [showPurchaseItemListModal, setShowPurchaseItemListModal] = useState<boolean>(false);
  const [purchaseItemListTargetRowIdx, setPurchaseItemListTargetRowIdx] = useState<number | null>(null);
  const suppressItemListReopenRef = useRef<boolean>(false);
  const purchaseItemListOriginRef = useRef<'pos_row' | 'access_row' | 'top'>('top');
  const lastPurchaseItemListTriggerElIdRef = useRef<string | null>(null);
  const [pendingDuplicatePrompt, setPendingDuplicatePrompt] = useState<{
    item: Item;
    variant?: ItemVariant | null;
    clearRowIdx: number | null;
  } | null>(null);
  const [pendingVariantPicker, setPendingVariantPicker] = useState<{
    item: Item;
    targetRowIdx: number | null;
    focusQty: boolean;
    fromTopSearch: boolean;
  } | null>(null);
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

  // Manual Net Amount Entry Modal State (Triggered by pressing Ctrl in Item Name field)
  const [netAmountModalState, setNetAmountModalState] = useState<{
    isOpen: boolean;
    rowIndex: number;
    inputValue: string;
    error: string | null;
    returnFocusId: string;
  }>({
    isOpen: false,
    rowIndex: 0,
    inputValue: '',
    error: null,
    returnFocusId: '',
  });
  const netAmountInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!netAmountModalState.isOpen) return;
    netAmountInputRef.current?.focus();
    const rafId = window.requestAnimationFrame(() => {
      if (netAmountInputRef.current && document.activeElement !== netAmountInputRef.current) {
        netAmountInputRef.current.focus();
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [netAmountModalState.isOpen]);

  useEffect(() => {
    setPurchaseRecordJumpInput(String(selectedPurchaseLineIndex + 1));
  }, [selectedPurchaseLineIndex]);

  const [savingInvoice, setSavingInvoice] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!formSuccess) return;
    const timer = window.setTimeout(() => {
      setFormSuccess(null);
      setShowPurchaseSmsModal(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [formSuccess]);

  // Print Modal State
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'invoice' | 'return'>('invoice');
  const [printInvoice, setPrintInvoice] = useState<PurchaseInvoice | null>(null);
  const [printInvoiceItems, setPrintInvoiceItems] = useState<PurchaseLineItem[]>([]);
  const [printReturn, setPrintReturn] = useState<PurchaseReturn | null>(null);
  const [printReturnItems, setPrintReturnItems] = useState<PurchaseReturnLineItem[]>([]);
  const [printJournalLines, setPrintJournalLines] = useState<JournalEntryLineView[]>([]);

  // F9 Shortcut: Open selected row's item in Item Master (Edit Mode)
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

  const selectedPurchaseLineIndexRef = useRef<number>(0);
  useEffect(() => {
    selectedPurchaseLineIndexRef.current = selectedPurchaseLineIndex;
  }, [selectedPurchaseLineIndex]);

  // Keep the Purchase Item Datasheet at 15 visible rows on every screen size
  const recalculateDatasheetRowCapacity = useCallback(() => {
    if (subTab !== 'new-invoice') return;
    const viewportEl =
      purchaseViewMode === 'pos' ? posGridViewportRef.current : accessGridViewportRef.current;
    if (!viewportEl) return;

    const availableHeight = viewportEl.clientHeight;
    if (availableHeight <= 0) return;

    // User-requested fixed row count: do not expand/collapse rows based on screen height.
    const fittingRows = INITIAL_PURCHASE_ROWS;

    visibleRowCapacityRef.current = fittingRows;
    setVisibleRowCapacity((prev) => (prev === fittingRows ? prev : fittingRows));
    setLines((prevLines) =>
      ensureMinimumPurchaseRows(prevLines, fittingRows, selectedPurchaseLineIndexRef.current)
    );
  }, [subTab, purchaseViewMode]);

  useEffect(() => {
    if (subTab !== 'new-invoice') return;
    const viewportEl =
      purchaseViewMode === 'pos' ? posGridViewportRef.current : accessGridViewportRef.current;

    const rafId = window.requestAnimationFrame(() => {
      recalculateDatasheetRowCapacity();
    });

    let observer: ResizeObserver | null = null;
    if (viewportEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        recalculateDatasheetRowCapacity();
      });
      observer.observe(viewportEl);
    }

    window.addEventListener('resize', recalculateDatasheetRowCapacity);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', recalculateDatasheetRowCapacity);
      if (observer) observer.disconnect();
    };
  }, [subTab, purchaseViewMode, recalculateDatasheetRowCapacity, formError, formSuccess, isTaxOverridden]);

  // Restore Active Draft from localStorage on initial mount (just like SalesInvoiceDatasheet)
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(ACTIVE_PURCHASE_DRAFT_KEY);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.some((l: any) => l.item_id > 0)) {
          setLines(
            ensureMinimumPurchaseRows(
              parsed.lines,
              visibleRowCapacityRef.current,
              selectedPurchaseLineIndexRef.current
            )
          );
          if (parsed.supplierId) setSupplierId(String(parsed.supplierId));
          if (parsed.supplierInvoiceNumber) setSupplierInvoiceNumber(String(parsed.supplierInvoiceNumber));
          if (parsed.supplierFilerStatus) setSupplierFilerStatus(parsed.supplierFilerStatus);
          if (parsed.billDate) setBillDate(String(parsed.billDate));
          if (parsed.paymentMode) setPaymentMode(parsed.paymentMode);
          if (parsed.notes) setNotes(String(parsed.notes));
          if (parsed.invoiceDiscountPercent) setInvoiceDiscountPercent(Number(parsed.invoiceDiscountPercent));
          if (parsed.paidAmount !== undefined && parsed.paidAmount !== null) {
            setPaidAmount(Math.max(0, Number(parsed.paidAmount) || 0));
            setPaidAmountManuallyEdited(
              parsed.paidAmountManuallyEdited !== undefined
                ? Boolean(parsed.paidAmountManuallyEdited)
                : true
            );
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setDraftRestored(true);
    }
  }, []);

  // Persist Active Draft to localStorage whenever lines or header fields change
  useEffect(() => {
    if (!draftRestored || editingPurchaseId) return;
    try {
      const hasItems = lines.some((l) => l.item_id > 0);
      if (hasItems || supplierInvoiceNumber || notes || paidAmountManuallyEdited) {
        localStorage.setItem(
          ACTIVE_PURCHASE_DRAFT_KEY,
          JSON.stringify({
            lines,
            supplierId,
            supplierInvoiceNumber,
            supplierFilerStatus,
            billDate,
            paymentMode,
            paidAmount,
            paidAmountManuallyEdited,
            notes,
            invoiceDiscountPercent,
          })
        );
      }
    } catch {
      // ignore
    }
  }, [
    draftRestored,
    editingPurchaseId,
    lines,
    supplierId,
    supplierInvoiceNumber,
    supplierFilerStatus,
    billDate,
    paymentMode,
    paidAmount,
    paidAmountManuallyEdited,
    notes,
    invoiceDiscountPercent,
  ]);

  // Item History Cache & Compact Popup State (Keyed by unique ItemCode)
  const [purchaseItemHistoryMap, setPurchaseItemHistoryMap] = useState<
    Record<string, CustomerItemHistoryResponse>
  >({});
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState<boolean>(false);
  const [showPurchaseCompactHistoryPopup, setShowPurchaseCompactHistoryPopup] =
    useState<boolean>(false);
  const ctrlPriceHistoryArmedRef = useRef<boolean>(false);

  const fetchPurchaseItemHistoryByCode = useCallback(
    async (itemCode: string, itemId?: number, variantId?: number | null) => {
      const cleanCode = String(itemCode || '').trim();
      if (!cleanCode && !itemId) return;
      try {
        setPurchaseHistoryLoading(true);
        const res: CustomerItemHistoryResponse = await api.getItemCustomerHistory(
          itemId || cleanCode,
          null,
          cleanCode,
          variantId ? { variantId } : undefined
        );
        const resolvedCode = String(res.itemCode || res.item?.item_code || cleanCode || '')
          .trim()
          .toLowerCase();
        const vSuffix = variantId ? `::v${variantId}` : '';
        setPurchaseItemHistoryMap((prev) => {
          const next = { ...prev };
          if (cleanCode) next[`${cleanCode.toLowerCase()}${vSuffix}`] = res;
          if (resolvedCode) next[`${resolvedCode}${vSuffix}`] = res;
          if (itemId) next[`${itemId}${vSuffix}`] = res;
          if (!vSuffix) {
            if (cleanCode) next[cleanCode.toLowerCase()] = res;
            if (resolvedCode) next[resolvedCode] = res;
            if (itemId) next[String(itemId)] = res;
          }
          return next;
        });
      } catch {
        // ignore
      } finally {
        setPurchaseHistoryLoading(false);
      }
    },
    []
  );

  // Refresh the currently selected purchase row's Item History whenever row, item, or variant changes
  const activePurRowItemId = Number(lines[selectedPurchaseLineIndex]?.item_id || 0);
  const activePurRowItemCode = String(lines[selectedPurchaseLineIndex]?.item_code || '');
  const activePurRowVariantId = Number(lines[selectedPurchaseLineIndex]?.variant_id || 0);
  useEffect(() => {
    const activeLine = lines[selectedPurchaseLineIndex];
    if (activeLine && (activeLine.item_code || activeLine.item_id)) {
      fetchPurchaseItemHistoryByCode(
        activeLine.item_code,
        Number(activeLine.item_id || 0),
        activeLine.variant_id || null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPurchaseLineIndex, activePurRowItemId, activePurRowItemCode, activePurRowVariantId]);

  // Resilient Master Data & Transactions Loader (Each promise catches individually like Sales!)
  const fetchWorkspaceData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch next auto purchase invoice & return numbers
      const nextNumsRes = await api.getNextPurchaseNumbers(billDate).catch(() => ({
        success: true,
        nextPurchaseNumber: nextPurchaseNo,
        nextReturnNumber: 'PRN-2026-0001',
      }));

      const [
        itemsRes,
        fastItemsRes,
        accountsRes,
        fastSupRes,
        taxRes,
        purchasesRes,
        heldRes,
        returnsRes,
        batchesRes,
      ] = await Promise.all([
        api.getItems({ status: 'Active' }).catch(() => ({ items: [] })),
        api.fastSearchPurchaseItems('', 20000).catch(() => ({ items: [] })),
        api.getAccounts({ status: 'Active' }).catch(() => ({ accounts: [] })),
        api.fastSearchPurchaseSuppliers('', 60).catch(() => ({ suppliers: [] })),
        api.getAdvanceTaxSettings().catch(() => ({ settings: null, history: [] })),
        api.getPurchases().catch(() => ({ purchases: [], data: [] })),
        api.getPurchases({ status: 'held_or_draft', exportAll: true }).catch(() => ({ purchases: [], data: [] })),
        api.getPurchaseReturns().catch(() => ({ returns: [] })),
        api.getInventoryBatches().catch(() => ({ batches: [] })),
      ]);

      // Merge items from both endpoints so catalog includes up to 20,000+ active items
      const primaryItems: Item[] = itemsRes.items || [];
      const fastItems: Item[] = fastItemsRes.items || fastItemsRes.data || [];
      const itemMap = new Map<number, Item>();
      for (const it of fastItems) {
        if (it?.id) itemMap.set(Number(it.id), it);
      }
      for (const it of primaryItems) {
        if (it?.id) itemMap.set(Number(it.id), it);
      }
      setItems(Array.from(itemMap.values()));

      const allAccounts: Account[] = accountsRes.accounts || accountsRes.data || [];
      const filteredSups = allAccounts.filter(
        (a) =>
          ['Supplier', 'Customer & Supplier'].includes(a.account_group) &&
          Number(a.is_system_account || 0) === 0
      );
      const supList: Account[] =
        filteredSups.length > 0
          ? filteredSups
          : fastSupRes.suppliers || fastSupRes.data || [];
      setSuppliers(supList);

      // Never auto-select a supplier on a new invoice, and never clobber supplierId while editing/resuming a held invoice.
      setSupplierId((prevSupId) => {
        if (editingPurchaseIdRef.current || isResumingPurchaseRef.current) {
          return prevSupId;
        }
        return prevSupId && supList.some((s) => String(s.id) === String(prevSupId)) ? prevSupId : '';
      });

      const finList = allAccounts.filter((a) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );
      setFinancialAccounts(finList);

      if (taxRes.settings) setTaxSettings(taxRes.settings);
      setTaxHistory(taxRes.history || []);

      if (nextNumsRes.nextPurchaseNumber) {
        setNextPurchaseNo(nextNumsRes.nextPurchaseNumber);
        if (!editingPurchaseIdRef.current && !isResumingPurchaseRef.current) {
          setBillNumber(nextNumsRes.nextPurchaseNumber);
          setSupplierInvoiceNumber((prev) => prev || nextNumsRes.nextPurchaseNumber);
        }
      }
      if (nextNumsRes.nextReturnNumber) {
        setNextReturnNo(nextNumsRes.nextReturnNumber);
      }

      const rawRegister: PurchaseInvoice[] = Array.isArray((purchasesRes as any)?.purchases)
        ? (purchasesRes as any).purchases
        : Array.isArray((purchasesRes as any)?.data)
        ? (purchasesRes as any).data
        : [];
      const rawHeld: PurchaseInvoice[] = Array.isArray((heldRes as any)?.purchases)
        ? (heldRes as any).purchases
        : Array.isArray((heldRes as any)?.data)
        ? (heldRes as any).data
        : [];
      setPurchases(rawRegister);
      setHeldPurchases(rawHeld.filter((h) => isHeldPurchaseStatus(h.status)));
      setReturns(returnsRes.returns || []);
      setBatches(batchesRes.batches || []);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [editingPurchaseId]);

  const fetchHeldPurchases = useCallback(async () => {
    try {
      setLoadingHeld(true);
      const res: any = await api.getPurchases({ status: 'held_or_draft', exportAll: true });
      const rawHeld: PurchaseInvoice[] = Array.isArray(res?.purchases)
        ? res.purchases
        : Array.isArray(res?.data)
        ? res.data
        : [];
      setHeldPurchases(rawHeld.filter((h) => isHeldPurchaseStatus(h.status)));
    } catch (err) {
      console.error('Failed to fetch held purchases:', err);
    } finally {
      setLoadingHeld(false);
    }
  }, []);

  const openHeldPurchasesModal = useCallback(async () => {
    setShowHeldModal(true);
    await fetchHeldPurchases();
  }, [fetchHeldPurchases]);

  useEffect(() => {
    fetchWorkspaceData();
  }, [fetchWorkspaceData]);

  useEffect(() => {
    const handleSyncDone = () => {
      fetchHeldPurchases();
    };
    window.addEventListener('ams-sync-completed', handleSyncDone);
    return () => window.removeEventListener('ams-sync-completed', handleSyncDone);
  }, [fetchHeldPurchases]);

  // Automatically update next read-only Purchase Invoice Number when billDate changes on a new or held/draft invoice
  useEffect(() => {
    const isCompletedEdit =
      Boolean(editingPurchaseId) &&
      String(editingPurchaseStatus || '').trim().toLowerCase() === 'completed';
    if (isCompletedEdit) return;
    let active = true;
    api
      .getNextPurchaseNumbers(billDate)
      .then((res) => {
        if (active && res.nextPurchaseNumber) {
          setBillNumber(res.nextPurchaseNumber);
          setNextPurchaseNo(res.nextPurchaseNumber);
          setSupplierInvoiceNumber((prev) =>
            !prev ||
            prev.startsWith('PI-') ||
            prev.startsWith('Inv-') ||
            prev.startsWith('PUR-') ||
            prev.startsWith('HLD-') ||
            prev.startsWith('DRF-')
              ? res.nextPurchaseNumber
              : prev
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [billDate, editingPurchaseId, editingPurchaseStatus]);

  // Live Backend Item Search Fallback while typing (supports both top bar and inline row search)
  useEffect(() => {
    const activeQuery = (
      activeRowItemSearchIdx !== null ? rowItemSearchQuery : purchaseSearchQuery
    ).trim();
    if (!activeQuery) return;
    const reqId = ++purchaseSearchReqIdRef.current;
    const timer = setTimeout(() => {
      api
        .fastSearchPurchaseItems(activeQuery, 50)
        .then((res) => {
          if (reqId !== purchaseSearchReqIdRef.current) return;
          const fetched: Item[] = res.items || res.data || [];
          if (fetched.length > 0) {
            setItems((prev) => {
              const existingIds = new Set(prev.map((i) => Number(i.id)));
              const merged = [...prev];
              for (const f of fetched) {
                if (f?.id && !existingIds.has(Number(f.id))) {
                  merged.push(f);
                  existingIds.add(Number(f.id));
                }
              }
              return merged.length === prev.length ? prev : merged;
            });
          }
        })
        .catch(() => {
          // ignore
        });
    }, 80);
    return () => {
      clearTimeout(timer);
    };
  }, [purchaseSearchQuery, rowItemSearchQuery, activeRowItemSearchIdx]);

  // Selected Supplier Object
  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === parseInt(supplierId, 10)) || null,
    [suppliers, supplierId]
  );

  // Sync supplierSearchQuery display when selectedSupplier changes and dropdown is closed
  useEffect(() => {
    if (selectedSupplier && !isSupplierDropdownOpen) {
      const mobilePart = selectedSupplier.phone ? ` (${selectedSupplier.phone})` : '';
      setSupplierSearchQuery(
        `[${selectedSupplier.account_code}] ${selectedSupplier.account_name}${mobilePart}`
      );
    } else if (!selectedSupplier && !isSupplierDropdownOpen) {
      setSupplierSearchQuery('');
    }
  }, [selectedSupplier, isSupplierDropdownOpen]);

  // Auto-focus Supplier Search when opening a new Purchase Invoice
  useEffect(() => {
    if (subTab === 'new-invoice' && !editingPurchaseId) {
      const timer = setTimeout(() => {
        supplierSearchInputRef.current?.focus();
        supplierSearchInputRef.current?.select?.();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [subTab, editingPurchaseId]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        supplierDropdownContainerRef.current &&
        !supplierDropdownContainerRef.current.contains(target)
      ) {
        setIsSupplierDropdownOpen(false);
      }
      if (
        itemDropdownContainerRef.current &&
        !itemDropdownContainerRef.current.contains(target)
      ) {
        setShowPurchaseSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Fast Instant Supplier Search (by Supplier Name, Account Code, Mobile Number)
  const filteredSuppliers = useMemo(() => {
    const raw = supplierSearchQuery.trim();
    const formattedSelected = selectedSupplier
      ? `[${selectedSupplier.account_code}] ${selectedSupplier.account_name}${
          selectedSupplier.phone ? ` (${selectedSupplier.phone})` : ''
        }`
      : '';
    const effectiveQuery = raw === formattedSelected ? '' : raw.toLowerCase();

    if (!effectiveQuery) {
      return suppliers.slice(0, 60);
    }

    const tokens = effectiveQuery.split(/\s+/).filter(Boolean);
    const matches: Array<{ supplier: Account; score: number }> = [];

    for (let i = 0; i < suppliers.length; i++) {
      const s = suppliers[i];
      const nameLower = (s.account_name || '').toLowerCase();
      const codeLower = (s.account_code || '').toLowerCase();
      const phoneLower = (s.phone || (s as any).mobile || '').toLowerCase();
      const contactLower = (s.contact_person || '').toLowerCase();
      const cityLower = (s.city || '').toLowerCase();
      const combined = `${nameLower} ${codeLower} ${phoneLower} ${contactLower} ${cityLower}`;

      let allMatch = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!combined.includes(tokens[t])) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;

      let score = 0;
      if (codeLower === effectiveQuery || phoneLower === effectiveQuery) score += 100;
      else if (codeLower.startsWith(effectiveQuery)) score += 60;
      if (nameLower.startsWith(effectiveQuery)) score += 50;
      else if (nameLower.includes(effectiveQuery)) score += 25;
      if (phoneLower.includes(effectiveQuery)) score += 35;

      matches.push({ supplier: s, score });
    }

    matches.sort(
      (a, b) => b.score - a.score || a.supplier.account_name.localeCompare(b.supplier.account_name)
    );
    return matches.slice(0, 50).map((m) => m.supplier);
  }, [suppliers, supplierSearchQuery, selectedSupplier]);

  // Unified High-Performance Instant Item Search Engine (Pre-indexed, <1ms query response)
  const indexedPurchaseItems = useMemo(() => prepareItemIndex(items), [items]);

  const stockPacksByItemId = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of batches) {
      const itemId = Number(b.item_id);
      if (!itemId) continue;
      map.set(itemId, round2((map.get(itemId) || 0) + Number(b.current_pack_qty || 0)));
    }
    return map;
  }, [batches]);

  const computeFilteredItems = useCallback(
    (queryStr: string, showDefaultWhenEmpty: boolean = true): Item[] => {
      const q = (queryStr || '').trim();
      if (!q) return showDefaultWhenEmpty ? items.slice(0, 40) : [];

      // Token/partial matching across item code, name, company, packing and barcode.
      // Examples: "pan 200 mg", "pan 200", "mg tab" and "panadol200mg tab"
      // can all find the same item even when the words are stored together.
      const normalize = (value: unknown) =>
        String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
      const tokens = q.split(/\s+/).map(normalize).filter(Boolean);
      if (!tokens.length) return [];

      const ranked = items
        .map((item) => {
          const variantText = Array.isArray(item.variants)
            ? item.variants
                .filter((v) => String(v.status || 'Active') !== 'Inactive')
                .map((v) =>
                  [
                    v.variant_code,
                    v.variant_name,
                    v.colour,
                    v.flavour,
                    v.variant_type,
                    v.other_attributes,
                    v.barcode,
                    ...(Array.isArray(v.barcodes) ? v.barcodes.map((b) => b.barcode) : []),
                  ]
                    .filter(Boolean)
                    .join(' ')
                )
                .join(' ')
            : '';

          const searchable = normalize([
            item.item_code,
            item.item_name,
            item.company_name,
            item.packing,
            (item as any).barcode,
            (item as any).bar_code,
            variantText,
          ].filter(Boolean).join(' '));
          if (!tokens.every((token) => searchable.includes(token))) return null;

          const code = normalize(item.item_code);
          const name = normalize(item.item_name);
          const normQ = normalize(q);
          const exactVariant = Array.isArray(item.variants) && item.variants.some((v) =>
            normalize(v.variant_code) === normQ ||
            normalize(v.barcode) === normQ ||
            (Array.isArray(v.barcodes) && v.barcodes.some((b) => normalize(b.barcode) === normQ))
          );
          const score =
            (exactVariant ? 1500 : 0) +
            (code === normQ ? 1000 : 0) +
            (code.startsWith(tokens[0]) ? 300 : 0) +
            (name.startsWith(tokens[0]) ? 200 : 0) +
            (tokens.every((token) => code.includes(token)) ? 100 : 0);
          return { item, score };
        })
        .filter((entry): entry is { item: Item; score: number } => entry !== null)
        .sort((a, b) => b.score - a.score || a.item.item_name.localeCompare(b.item.item_name));

      return ranked.slice(0, 50).map((entry) => entry.item);
    },
    [items]
  );

  const purchaseSearchResults = useMemo(
    () => computeFilteredItems(purchaseSearchQuery, true),
    [computeFilteredItems, purchaseSearchQuery]
  );

  const rowItemSearchResults = useMemo(
    () => (ROW_SUGGESTIONS_ENABLED ? computeFilteredItems(rowItemSearchQuery, true) : []),
    [computeFilteredItems, rowItemSearchQuery]
  );

  // Live Supplier Ledger Balance Summary & Last Payment + Supplier Ledger Modal
  const [supplierBalanceSummary, setSupplierBalanceSummary] = useState<{
    previousBalance: number;
    previousBalanceAbs: number;
    previousBalanceType: 'Credit' | 'Debit';
    lastPayment: {
      payment_date: string;
      amount: number;
      reference_no: string;
      payment_mode: string;
      source: string;
    } | null;
  } | null>(null);
  const [supplierLedgerModalOpen, setSupplierLedgerModalOpen] = useState(false);
  const [supplierLedgerEntries, setSupplierLedgerEntries] = useState<any[]>([]);
  const [loadingSupplierLedger, setLoadingSupplierLedger] = useState(false);
  const [clientRequestId, setClientRequestId] = useState<string>(
    () => `pur-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );

  // Fetch accurate Supplier Balance from actual ledger (excluding current invoice if editing)
  useEffect(() => {
    const supIdNum = parseInt(supplierId, 10);
    if (!supIdNum || isNaN(supIdNum)) {
      setSupplierBalanceSummary(null);
      return;
    }
    let active = true;
    api
      .getAccountBalanceSummary(supIdNum, {
        role: 'supplier',
        excludePurchaseId: editingPurchaseId,
      })
      .then((res) => {
        if (active && res?.data) {
          setSupplierBalanceSummary({
            previousBalance: Number(res.data.previousBalance || 0),
            previousBalanceAbs: Number(res.data.previousBalanceAbs || 0),
            previousBalanceType:
              res.data.previousBalanceType === 'Debit' ? 'Debit' : 'Credit',
            lastPayment: res.data.lastPayment || null,
          });
        }
      })
      .catch(() => {
        // Fallback to account master cached totals if offline
      });
    return () => {
      active = false;
    };
  }, [supplierId, editingPurchaseId, purchases.length]);

  const handleOpenSupplierLedger = async () => {
    const supIdNum = parseInt(supplierId, 10);
    if (!supIdNum) return;
    try {
      setSupplierLedgerModalOpen(true);
      setLoadingSupplierLedger(true);
      const res = await api.getSupplierLedger({ accountId: supIdNum });
      setSupplierLedgerEntries(res.data || []);
    } catch {
      setSupplierLedgerEntries([]);
    } finally {
      setLoadingSupplierLedger(false);
    }
  };

  // Focus Item Search field inside a NEW empty invoice row (used after selecting Supplier + pressing Enter)
  const focusNewEmptyPurchaseRowItemSearch = () => {
    const firstEmptyIdx = lines.findIndex((l) => !isPurchaseLinePopulated(l));
    const targetRowIdx = firstEmptyIdx >= 0 ? firstEmptyIdx : lines.length;
    if (targetRowIdx >= lines.length) {
      setLines((prev) =>
        ensureMinimumPurchaseRows(
          [...prev, createBlankPurchaseLine()],
          visibleRowCapacityRef.current,
          targetRowIdx
        )
      );
    }
    setSelectedPurchaseLineIndex(targetRowIdx);
    setPurchaseRecordJumpInput(String(targetRowIdx + 1));
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setRowItemSearchQuery('');
    setShowPurchaseSearchDropdown(false);

    const prefix: 'pur_cell' | 'pos_row' =
      purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(
          `${prefix}_${targetRowIdx}_item_name`
        ) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
          el.closest('tr')?.scrollIntoView({ block: 'nearest' });
        } else {
          itemSearchInputRef.current?.focus();
          itemSearchInputRef.current?.select?.();
        }
      }, 25);
    });
  };

  // Select Supplier & automatically focus Item Search in a new empty invoice row
  const handleSelectSupplierFromDropdown = (sup: Account) => {
    setSupplierId(String(sup.id));
    setSupplierFilerStatus(sup.filer_status || 'Filer');
    const mobilePart = sup.phone ? ` (${sup.phone})` : '';
    setSupplierSearchQuery(`[${sup.account_code}] ${sup.account_name}${mobilePart}`);
    setIsSupplierDropdownOpen(false);
    setSupplierHighlightIndex(0);
    focusNewEmptyPurchaseRowItemSearch();
  };

  const handleSupplierSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isSupplierDropdownOpen) {
        setIsSupplierDropdownOpen(true);
        setSupplierHighlightIndex(0);
        return;
      }
      setSupplierHighlightIndex((prev) => {
        const next = Math.min(prev + 1, Math.max(0, filteredSuppliers.length - 1));
        setTimeout(() => {
          const el = supplierListRef.current?.querySelector(`[data-sup-idx="${next}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }, 0);
        return next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isSupplierDropdownOpen) {
        setIsSupplierDropdownOpen(true);
        return;
      }
      setSupplierHighlightIndex((prev) => {
        const next = Math.max(0, prev - 1);
        setTimeout(() => {
          const el = supplierListRef.current?.querySelector(`[data-sup-idx="${next}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }, 0);
        return next;
      });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (isSupplierDropdownOpen && filteredSuppliers.length > 0) {
        const chosen = filteredSuppliers[supplierHighlightIndex] || filteredSuppliers[0];
        if (chosen) {
          handleSelectSupplierFromDropdown(chosen);
          return;
        }
      }
      if (selectedSupplier) {
        setIsSupplierDropdownOpen(false);
        focusNewEmptyPurchaseRowItemSearch();
        return;
      }
      if (filteredSuppliers.length > 0) {
        handleSelectSupplierFromDropdown(filteredSuppliers[0]);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsSupplierDropdownOpen(false);
      if (selectedSupplier) {
        const mobilePart = selectedSupplier.phone ? ` (${selectedSupplier.phone})` : '';
        setSupplierSearchQuery(
          `[${selectedSupplier.account_code}] ${selectedSupplier.account_name}${mobilePart}`
        );
      }
    }
  };

  // Open Quick Add New Supplier Modal with Universal Auto Account Code
  const handleOpenAddSupplierModal = async (prefillName?: string) => {
    setAddSupplierError(null);
    setNewSupplierCode('Loading...');

    const formattedSelected = selectedSupplier
      ? `[${selectedSupplier.account_code}] ${selectedSupplier.account_name}${
          selectedSupplier.phone ? ` (${selectedSupplier.phone})` : ''
        }`
      : '';
    const candidateName =
      prefillName !== undefined
        ? prefillName
        : supplierSearchQuery !== formattedSelected
        ? supplierSearchQuery.trim()
        : '';

    setNewSupplierName(candidateName);
    setNewSupplierMobile('');
    setNewSupplierContactPerson('');
    setNewSupplierFilerStatus('Filer');
    setNewSupplierCity('');
    setNewSupplierAddress('');
    setNewSupplierOpeningBalance(0);
    setNewSupplierOpeningType('Credit');
    setIsSupplierDropdownOpen(false);
    setShowAddSupplierModal(true);

    try {
      const next = await api.getNextAccountCode('Supplier', 'PARTY ACCOUNTS');
      setNewSupplierCode(next.next_code);
    } catch {
      setNewSupplierCode('Sup-038');
    }
  };

  const handleCreateNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSupplierError(null);

    if (!newSupplierName.trim()) {
      setAddSupplierError('Supplier Name is required.');
      return;
    }

    try {
      setCreatingSupplier(true);
      const res = await api.createAccount({
        account_code: newSupplierCode.trim().toUpperCase(),
        account_name: newSupplierName.trim(),
        main_group: 'PARTY ACCOUNTS',
        account_group: 'Supplier',
        parent_account_id: null,
        opening_balance: Math.max(0, round2(newSupplierOpeningBalance)),
        opening_balance_type: newSupplierOpeningType,
        contact_person: newSupplierContactPerson.trim(),
        phone: newSupplierMobile.trim(),
        email: '',
        ntn_cnic: '',
        ntn: '',
        strn: '',
        filer_status: newSupplierFilerStatus,
        tax_registration_details: '',
        address: newSupplierAddress.trim(),
        city: newSupplierCity.trim(),
        credit_limit: 0,
        status: 'Active',
        notes: 'Created from Purchase Invoice Supplier Search',
      });

      const createdAccount: Account | undefined = res.account || res.data;
      const accountsRes = await api.getAccounts({ status: 'Active' });
      const allAccounts: Account[] = accountsRes.accounts || accountsRes.data || [];
      const supList = allAccounts.filter(
        (a) =>
          ['Supplier', 'Customer & Supplier'].includes(a.account_group) &&
          Number(a.is_system_account || 0) === 0
      );
      setSuppliers(supList);

      const newlyAdded =
        (createdAccount && supList.find((s) => s.id === createdAccount.id)) ||
        supList.find(
          (s) => s.account_code.toLowerCase() === newSupplierCode.trim().toLowerCase()
        ) ||
        createdAccount;

      setShowAddSupplierModal(false);

      if (newlyAdded) {
        handleSelectSupplierFromDropdown(newlyAdded);
        setFormSuccess(
          `Supplier "[${newlyAdded.account_code}] ${newlyAdded.account_name}" created and selected.`
        );
      }
    } catch (err: unknown) {
      setAddSupplierError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingSupplier(false);
    }
  };

  // Determine Applicable Advance Tax Rate (never hard-coded; comes from taxSettings or override)
  const getStatutoryAdvanceTaxRate = (): number => {
    if (!taxSettings || taxSettings.status === 'Inactive') return 0;
    if (supplierFilerStatus === 'Filer') return round2(taxSettings.filer_rate);
    if (supplierFilerStatus === 'Non-Filer') return round2(taxSettings.non_filer_rate);
    return round2(taxSettings.exempt_rate || 0);
  };

  const appliedAdvanceTaxRate = isTaxOverridden
    ? Math.max(0, round2(customAdvanceTaxRate))
    : getStatutoryAdvanceTaxRate();

  const getActiveVariants = (it?: Item | null): ItemVariant[] =>
    Array.isArray(it?.variants)
      ? it!.variants.filter((v) => String(v.status || 'Active') !== 'Inactive')
      : [];

  // Build a populated PurchaseLineItem from an Item record (and optional Variant) (Default Quantity = 0)
  const buildPopulatedLineFromItem = (
    found: Item,
    existingRow?: Partial<PurchaseLineItem>,
    preserveQtyAndDiscountOnly: boolean = false,
    chosenVariant?: ItemVariant | null
  ): PurchaseLineItem => {
    const rate = round2(
      Number(
        chosenVariant
          ? chosenVariant.effective_purchase_price ?? chosenVariant.purchase_price ?? found.purchase_price
          : found.purchase_price
      ) ||
        Number(found.trade_price) ||
        Number(found.retail_price) ||
        0
    );
    const retailPrice = round2(
      Number(
        chosenVariant
          ? chosenVariant.effective_retail_price ?? chosenVariant.retail_price ?? found.retail_price
          : found.retail_price
      ) || 0
    );
    const packingStr =
      (chosenVariant?.effective_packing || chosenVariant?.packing || found.packing || '1x1').trim() || '1x1';
    const unitsPerPack = Math.max(1, parseUnitsPerPack(packingStr));
    const hasExistingQty =
      existingRow?.quantity !== undefined && existingRow?.quantity !== null;
    const qty = hasExistingQty ? Math.max(0, Number(existingRow.quantity) || 0) : 0;
    const hasExistingDiscount =
      existingRow?.discount_percent !== undefined && existingRow?.discount_percent !== null;
    const defaultDisc = chosenVariant
      ? Number(chosenVariant.effective_discount_percent ?? found.discount_percent ?? 0)
      : Number(found.discount_percent || 0);
    const discPct = hasExistingDiscount
      ? Math.max(0, round2(Number(existingRow.discount_percent) || 0))
      : round2(defaultDisc);

    const looseQty =
      !preserveQtyAndDiscountOnly && existingRow?.loose_quantity && existingRow.loose_quantity > 0
        ? round2(existingRow.loose_quantity)
        : 0;
    const bonusQty =
      !preserveQtyAndDiscountOnly && existingRow?.bonus_quantity && existingRow.bonus_quantity > 0
        ? existingRow.bonus_quantity
        : 0;
    const defaultLooseRate = round2(rate / unitsPerPack);
    const looseRate =
      !preserveQtyAndDiscountOnly &&
      existingRow?.loose_rate !== undefined &&
      existingRow.loose_rate > 0
        ? round2(existingRow.loose_rate)
        : defaultLooseRate;
    const taxPct = round2(
      chosenVariant ? chosenVariant.effective_tax_percent ?? found.tax_percent ?? 0 : found.tax_percent || 0
    );
    const gross = round2(qty * rate + looseQty * looseRate);
    const discAmt = round2(gross * (discPct / 100));
    const taxable = round2(gross - discAmt);
    const taxAmt = round2(taxable * (taxPct / 100));
    const net = round2(taxable + taxAmt);
    const thumb = chosenVariant
      ? chosenVariant.effective_thumbnail_url ||
        chosenVariant.effective_image_url ||
        chosenVariant.thumbnail_url ||
        chosenVariant.image_url ||
        found.thumbnail_url ||
        found.image_url ||
        null
      : found.thumbnail_url || found.image_url || null;

    return {
      item_id: found.id,
      variant_id: chosenVariant ? chosenVariant.id : null,
      variant_code: chosenVariant ? chosenVariant.variant_code : '',
      variant_name: chosenVariant ? chosenVariant.variant_name : '',
      thumbnail_url: thumb,
      item_code: found.item_code,
      barcode: (chosenVariant?.barcode || found.barcode || ''),
      company_name: found.company_name,
      item_name: found.item_name,
      packing: packingStr,
      units_per_pack: unitsPerPack,
      batch_number:
        !preserveQtyAndDiscountOnly && existingRow?.batch_number
          ? existingRow.batch_number
          : `B-${chosenVariant?.variant_code || found.item_code}-01`,
      manufacturing_date:
        !preserveQtyAndDiscountOnly && existingRow?.manufacturing_date
          ? existingRow.manufacturing_date
          : '2026-01-01',
      expiry_date:
        !preserveQtyAndDiscountOnly && existingRow?.expiry_date
          ? existingRow.expiry_date
          : '2028-12-31',
      quantity: qty,
      loose_quantity: looseQty,
      bonus_quantity: bonusQty,
      purchase_rate: rate,
      loose_rate: looseRate,
      is_loose_rate_manual:
        !preserveQtyAndDiscountOnly && Boolean(existingRow?.is_loose_rate_manual),
      mrp_rate: retailPrice,
      gross_amount: gross,
      discount_percent: discPct,
      discount_amount: discAmt,
      taxable_amount: taxable,
      tax_percent: taxPct,
      tax_amount: taxAmt,
      line_total: net,
      remarks: !preserveQtyAndDiscountOnly ? String(existingRow?.remarks || '') : String(existingRow?.remarks || ''),
      master_purchase_price: rate,
      master_retail_price: retailPrice,
      last_prompted_purchase_rate: rate,
      update_master_purchase_price: false,
      update_master_retail_price: false,
    };
  };

  // Two-Step Purchase Price & Retail Price Update Confirmation State
  const [priceChangePrompt, setPriceChangePrompt] = useState<{
    step: 'confirm_purchase' | 'confirm_retail';
    rowIndex: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    companyName: string;
    packing: string;
    unitsPerPack: number;
    oldPurchasePrice: number;
    newPurchasePrice: number;
    retailBase: number;
    oldRetailPrice: number;
    newRetailPrice: number;
    oldLooseRate: number;
    newLooseRate: number;
    looseRateManuallyEdited?: boolean;
    nextFocusTargetId?: string;
  } | null>(null);
  const [updatingItemMasterPrice] = useState(false);

  useEffect(() => {
    isPricePromptOpenRef.current = Boolean(priceChangePrompt);
    if (!priceChangePrompt) return;
    const rafId = window.requestAnimationFrame(() => {
      setTimeout(() => {
        if (priceChangePrompt.step === 'confirm_purchase') {
          const input = priceDialogPurchaseInputRef.current;
          if (input) {
            input.focus();
            input.select?.();
          }
        } else {
          const input = priceDialogRetailInputRef.current;
          if (input) {
            input.focus();
            input.select?.();
          }
        }
      }, 20);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [priceChangePrompt?.step, Boolean(priceChangePrompt)]);

  const focusTargetElementById = (targetId?: string) => {
    if (!targetId) return;
    setTimeout(() => {
      const el = document.getElementById(targetId) as HTMLInputElement | null;
      if (el) {
        el.focus();
        if (typeof el.select === 'function') el.select();
        el.closest('tr')?.scrollIntoView({ block: 'nearest' });
      }
    }, 30);
  };

  // Detect if entered purchase_rate differs from Item Master purchase_price and trigger Step 1 Confirmation
  const checkAndTriggerPurchasePriceChange = (
    rowIdx: number,
    nextFocusTargetId?: string
  ): boolean => {
    if (isPricePromptOpenRef.current || priceChangePrompt) return false;
    const row = lines[rowIdx];
    if (!row || !row.item_id || row.item_id <= 0) return false;

    const masterItem = items.find((it) => it.id === row.item_id);
    const masterVariant =
      row.variant_id && masterItem?.variants
        ? masterItem.variants.find((v) => Number(v.id) === Number(row.variant_id))
        : null;
    const isCustomVariantPrice = Boolean(masterVariant && Number(masterVariant.use_parent_pricing) === 0);

    const oldPurchasePrice = round2(
      isCustomVariantPrice && masterVariant
        ? Number(masterVariant.effective_purchase_price ?? masterVariant.purchase_price ?? 0)
        : masterItem
        ? Number(masterItem.purchase_price || 0)
        : Number(row.master_purchase_price || 0)
    );
    const newPurchasePrice = round2(Number(row.purchase_rate || 0));

    if (newPurchasePrice <= 0 || Math.abs(newPurchasePrice - oldPurchasePrice) < 0.01) {
      return false;
    }

    const syncLastPrompted = lastPromptedRateByRowRef.current[rowIdx];
    if (
      (syncLastPrompted !== undefined && Math.abs(syncLastPrompted - newPurchasePrice) < 0.01) ||
      (row.last_prompted_purchase_rate !== undefined &&
        Math.abs(row.last_prompted_purchase_rate - newPurchasePrice) < 0.01)
    ) {
      return false;
    }

    lastPromptedRateByRowRef.current[rowIdx] = newPurchasePrice;
    isPricePromptOpenRef.current = true;

    setLines((prev) => {
      const next = [...prev];
      if (next[rowIdx]) {
        next[rowIdx] = {
          ...next[rowIdx],
          last_prompted_purchase_rate: newPurchasePrice,
        };
      }
      return next;
    });

    const packingStr =
      (isCustomVariantPrice && masterVariant?.effective_packing) ||
      masterItem?.packing ||
      row.packing ||
      '1x1';
    const unitsPerPack = Math.max(1, parseUnitsPerPack(packingStr));
    const pricing = calculateItemPricingFromPurchase(newPurchasePrice, packingStr);
    const oldRetailPrice = round2(
      isCustomVariantPrice && masterVariant
        ? Number(masterVariant.effective_retail_price ?? masterVariant.retail_price ?? 0)
        : masterItem
        ? Number(masterItem.retail_price || 0)
        : Number(row.master_retail_price || row.mrp_rate || 0)
    );
    const oldLooseRate = round2(
      isCustomVariantPrice && masterVariant && Number(masterVariant.effective_loose_rate || 0) > 0
        ? Number(masterVariant.effective_loose_rate)
        : masterItem && Number(masterItem.loose_rate || 0) > 0
        ? Number(masterItem.loose_rate)
        : oldRetailPrice / unitsPerPack
    );

    setPriceChangePrompt({
      step: 'confirm_purchase',
      rowIndex: rowIdx,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.variant_name ? `${row.item_name} (${row.variant_name})` : row.item_name,
      companyName: row.company_name || masterItem?.company_name || '',
      packing: packingStr,
      unitsPerPack,
      oldPurchasePrice,
      newPurchasePrice,
      retailBase: pricing.retailPrice,
      oldRetailPrice,
      newRetailPrice: pricing.retailPrice,
      oldLooseRate,
      newLooseRate: pricing.looseRate,
      looseRateManuallyEdited: false,
      nextFocusTargetId,
    });

    return true;
  };

  // Step 1 NO – Keep Old Item Master Purchase Price (save new price in current purchase invoice only)
  const handleKeepOldPurchasePrice = () => {
    if (!priceChangePrompt) return;
    const prompt = priceChangePrompt;
    const finalPurchaseRate = round2(prompt.newPurchasePrice);
    lastPromptedRateByRowRef.current[prompt.rowIndex] = finalPurchaseRate;
    isPricePromptOpenRef.current = false;
    handleLineChange(prompt.rowIndex, 'purchase_rate', finalPurchaseRate);
    setLines((prev) => {
      const next = [...prev];
      if (next[prompt.rowIndex]) {
        next[prompt.rowIndex] = {
          ...next[prompt.rowIndex],
          last_prompted_purchase_rate: finalPurchaseRate,
          update_master_purchase_price: false,
          update_master_retail_price: false,
        };
      }
      return next;
    });
    setFormSuccess(
      `Kept old Item Master Purchase Price (Rs. ${prompt.oldPurchasePrice.toFixed(
        2
      )}) for "${prompt.itemName}". New rate Rs. ${finalPurchaseRate.toFixed(
        2
      )} saved in this purchase invoice only.`
    );
    setPriceChangePrompt(null);
    const fallbackTargetId = `${purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell'}_${prompt.rowIndex}_purchase_rate`;
    focusTargetElementById(prompt.nextFocusTargetId || fallbackTargetId);
  };

  const handleCancelPriceChangePrompt = () => {
    if (!priceChangePrompt) return;
    const prompt = priceChangePrompt;
    const finalPurchaseRate = round2(prompt.newPurchasePrice);
    lastPromptedRateByRowRef.current[prompt.rowIndex] = finalPurchaseRate;
    isPricePromptOpenRef.current = false;
    setLines((prev) => {
      const next = [...prev];
      if (next[prompt.rowIndex]) {
        next[prompt.rowIndex] = {
          ...next[prompt.rowIndex],
          last_prompted_purchase_rate: finalPurchaseRate,
          update_master_purchase_price: false,
          update_master_retail_price: false,
        };
      }
      return next;
    });
    setPriceChangePrompt(null);
    const fallbackTargetId = `${purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell'}_${prompt.rowIndex}_purchase_rate`;
    focusTargetElementById(prompt.nextFocusTargetId || fallbackTargetId);
  };

  // Step 1 YES – Update Purchase Price -> Proceed to Step 2 ("Do you also want to update Retail Price?")
  const handleApprovePurchasePriceStep1 = () => {
    if (!priceChangePrompt) return;
    const finalPurchase = round2(priceChangePrompt.newPurchasePrice);
    const recalculated = calculateItemPricingFromPurchase(finalPurchase, priceChangePrompt.packing);
    setPriceChangePrompt({
      ...priceChangePrompt,
      step: 'confirm_retail',
      newPurchasePrice: finalPurchase,
      retailBase: recalculated.retailPrice,
      newRetailPrice: recalculated.retailPrice,
      newLooseRate: recalculated.looseRate,
      looseRateManuallyEdited: false,
    });
  };

  // Step 2 Decision: the Item Master is NOT touched here. The decision is remembered on the
  // invoice line and applied only after the invoice is saved (see applyDeferredMasterPriceUpdates).
  const handleFinalPriceCascadeDecision = (updateRetail: boolean) => {
    if (!priceChangePrompt) return;
    const prompt = priceChangePrompt;
    const finalPurchase = round2(prompt.newPurchasePrice);
    const finalRetail = round2(prompt.newRetailPrice);
    const finalLoose = round2(prompt.newLooseRate);
    lastPromptedRateByRowRef.current[prompt.rowIndex] = finalPurchase;
    isPricePromptOpenRef.current = false;
    handleLineChange(prompt.rowIndex, 'purchase_rate', finalPurchase);
    setLines((prev) => {
      const next = [...prev];
      if (next[prompt.rowIndex]) {
        next[prompt.rowIndex] = {
          ...next[prompt.rowIndex],
          purchase_rate: finalPurchase,
          mrp_rate: updateRetail ? finalRetail : next[prompt.rowIndex].mrp_rate,
          master_purchase_price: finalPurchase,
          master_retail_price: updateRetail ? finalRetail : prompt.oldRetailPrice,
          master_loose_rate: updateRetail ? finalLoose : prompt.oldLooseRate,
          last_prompted_purchase_rate: finalPurchase,
          update_master_purchase_price: true,
          update_master_retail_price: updateRetail,
        };
      }
      return next;
    });
    setFormSuccess(
      updateRetail
        ? `"${prompt.itemName}": Item Master will be updated when this invoice is saved — Purchase Rs. ${finalPurchase.toFixed(
            2
          )}, Retail Rs. ${finalRetail.toFixed(2)}, Loose Rs. ${finalLoose.toFixed(2)}.`
        : `"${prompt.itemName}": Item Master Purchase Price will be updated to Rs. ${finalPurchase.toFixed(
            2
          )} when this invoice is saved. Retail Price (Rs. ${prompt.oldRetailPrice.toFixed(2)}) stays unchanged.`
    );
    setPriceChangePrompt(null);
    const fallbackTargetId = `${purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell'}_${prompt.rowIndex}_purchase_rate`;
    focusTargetElementById(prompt.nextFocusTargetId || fallbackTargetId);
  };

  const handlePriceDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!priceChangePrompt) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancelPriceChangePrompt();
      return;
    }

    if (e.key === 'Tab') {
      const container = priceDialogRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const activeIdx = focusable.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      e.stopPropagation();
      const nextIdx = e.shiftKey
        ? activeIdx <= 0
          ? focusable.length - 1
          : activeIdx - 1
        : activeIdx === -1 || activeIdx >= focusable.length - 1
        ? 0
        : activeIdx + 1;
      const nextEl = focusable[nextIdx];
      nextEl.focus();
      if (nextEl instanceof HTMLInputElement && typeof nextEl.select === 'function') {
        nextEl.select();
      }
      return;
    }

    if (e.key === 'Enter') {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && activeEl.tagName === 'BUTTON') {
        e.preventDefault();
        e.stopPropagation();
        activeEl.click();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (priceChangePrompt.step === 'confirm_purchase') {
        handleApprovePurchasePriceStep1();
      } else {
        handleFinalPriceCascadeDecision(true);
      }
    }
  };

  const applyItemToPurchaseRow = (
    idx: number,
    found: Item,
    focusQty: boolean = true,
    chosenVariant?: ItemVariant | null
  ) => {
    delete lastPromptedRateByRowRef.current[idx];
    setLines((prev) => {
      const copy = [...prev];
      const prevRow = copy[idx];
      const hasExistingItem = Boolean(prevRow && prevRow.item_id && prevRow.item_id > 0);
      const isSameItem = Boolean(
        prevRow &&
          prevRow.item_id === found.id &&
          Number(prevRow.variant_id || 0) === Number(chosenVariant?.id || 0)
      );
      const hasPreEnteredQtyOrDisc = Boolean(
        prevRow && (Number(prevRow.quantity || 0) > 0 || Number(prevRow.discount_percent || 0) > 0)
      );
      while (copy.length <= idx) {
        copy.push(createBlankPurchaseLine());
      }
      copy[idx] = buildPopulatedLineFromItem(
        found,
        hasExistingItem || hasPreEnteredQtyOrDisc ? prevRow : undefined,
        hasExistingItem ? !isSameItem : hasPreEnteredQtyOrDisc,
        chosenVariant
      );
      return ensureMinimumPurchaseRows(copy, visibleRowCapacityRef.current, idx);
    });
    setSelectedPurchaseLineIndex(idx);
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setRowItemSearchQuery('');
    setPurchaseSearchQuery('');
    setShowPurchaseSearchDropdown(false);
    setItemHighlightIndex(0);
    fetchPurchaseItemHistoryByCode(found.item_code, found.id, chosenVariant?.id || null);
    if (focusQty) {
      const prefix: 'pur_cell' | 'pos_row' =
        purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
      requestAnimationFrame(() => {
        setTimeout(() => {
          focusPurchaseCell(idx, 'quantity', prefix);
        }, 30);
      });
    }
  };

  // Populate a specific row with an Item (and optional Variant)
  const populatePurchaseRowWithItem = (
    idx: number,
    found: Item,
    focusQty: boolean = true,
    preMatchedVariant?: ItemVariant | null
  ) => {
    const activeVars = getActiveVariants(found);
    if (!preMatchedVariant && Number(found.has_variants || 0) === 1 && activeVars.length > 0) {
      setActiveRowItemSearchIdx(null);
      setActiveRowItemSearchField(null);
      setRowItemSearchQuery('');
      setPurchaseSearchQuery('');
      setShowPurchaseSearchDropdown(false);
      setPendingVariantPicker({
        item: found,
        targetRowIdx: idx,
        focusQty,
        fromTopSearch: false,
      });
      return;
    }

    const variantId = preMatchedVariant ? Number(preMatchedVariant.id) : 0;
    const hasDuplicate = lines.some(
      (l, i) =>
        i !== idx &&
        l.item_id === found.id &&
        Number(l.variant_id || 0) === variantId
    );
    if (hasDuplicate) {
      const isRowEmpty = !lines[idx]?.item_id || lines[idx].item_id === 0;
      if (isRowEmpty) {
        setLines((prev) => {
          const copy = [...prev];
          if (!copy[idx]?.item_id || copy[idx].item_id === 0) {
            copy[idx] = createBlankPurchaseLine();
          }
          return copy;
        });
      }
      setActiveRowItemSearchIdx(null);
      setActiveRowItemSearchField(null);
      setRowItemSearchQuery('');
      setPurchaseSearchQuery('');
      setShowPurchaseSearchDropdown(false);
      setItemHighlightIndex(0);
      setPendingDuplicatePrompt({
        item: found,
        variant: preMatchedVariant || null,
        clearRowIdx: isRowEmpty ? idx : null,
      });
      return;
    }

    applyItemToPurchaseRow(idx, found, focusQty, preMatchedVariant || null);
  };

  const handleConfirmAddDuplicatePurchaseRow = () => {
    if (!pendingDuplicatePrompt) return;
    const { item, variant, clearRowIdx } = pendingDuplicatePrompt;
    setPendingDuplicatePrompt(null);

    let targetIdx = lines.length;
    if (
      clearRowIdx !== null &&
      (!lines[clearRowIdx]?.item_id || lines[clearRowIdx].item_id === 0)
    ) {
      targetIdx = clearRowIdx;
    } else {
      const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
      targetIdx = emptyIdx >= 0 ? emptyIdx : lines.length;
    }

    setLines((prev) => {
      const next = [...prev];
      while (next.length <= targetIdx) {
        next.push(createBlankPurchaseLine());
      }
      next[targetIdx] = buildPopulatedLineFromItem(item, undefined, false, variant || null);
      return ensureMinimumPurchaseRows(next, visibleRowCapacityRef.current, targetIdx);
    });
    setSelectedPurchaseLineIndex(targetIdx);
    setPurchaseSearchQuery('');
    setRowItemSearchQuery('');
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setShowPurchaseSearchDropdown(false);
    setItemHighlightIndex(0);
    fetchPurchaseItemHistoryByCode(item.item_code, item.id, variant?.id || null);

    requestAnimationFrame(() => {
      setTimeout(() => {
        const prefix = purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
        focusPurchaseCell(targetIdx, 'quantity', prefix);
      }, 30);
    });
  };

  const handleCancelDuplicatePurchasePrompt = () => {
    const clearRowIdx = pendingDuplicatePrompt?.clearRowIdx ?? null;
    setPendingDuplicatePrompt(null);
    if (clearRowIdx !== null) {
      setLines((prev) => {
        const copy = [...prev];
        if (!copy[clearRowIdx]?.item_id || copy[clearRowIdx].item_id === 0) {
          copy[clearRowIdx] = createBlankPurchaseLine();
        }
        return copy;
      });
    }
    setPurchaseSearchQuery('');
    setRowItemSearchQuery('');
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setShowPurchaseSearchDropdown(false);
    setItemHighlightIndex(0);
    requestAnimationFrame(() => {
      setTimeout(() => {
        itemSearchInputRef.current?.focus();
        itemSearchInputRef.current?.select?.();
      }, 25);
    });
  };

  const openPurchaseItemListForRow = (
    rowIdx: number | null,
    origin: 'pos_row' | 'access_row' | 'top' = 'top',
    triggerElId?: string
  ) => {
    if (suppressItemListReopenRef.current || showPurchaseItemListModal) return;
    setShowPurchaseSearchDropdown(false);
    setActiveRowItemSearchIdx(null);
    setRowItemSearchQuery('');
    if (rowIdx !== null) {
      setSelectedPurchaseLineIndex(rowIdx);
    }
    if (origin === 'pos_row') {
      posDatasheetMouseActivatedRef.current = true;
    }
    purchaseItemListOriginRef.current = origin;
    lastPurchaseItemListTriggerElIdRef.current = triggerElId || null;
    setPurchaseItemListTargetRowIdx(rowIdx);
    setShowPurchaseItemListModal(true);
  };

  const closePurchaseItemListModal = () => {
    const triggerElId = lastPurchaseItemListTriggerElIdRef.current;
    suppressItemListReopenRef.current = true;
    setShowPurchaseItemListModal(false);
    setPurchaseItemListTargetRowIdx(null);
    if (triggerElId) {
      setTimeout(() => {
        const el = document.getElementById(triggerElId) as HTMLInputElement | null;
        el?.focus();
      }, 10);
    } else {
      setTimeout(() => {
        itemSearchInputRef.current?.focus();
      }, 10);
    }
    setTimeout(() => {
      suppressItemListReopenRef.current = false;
    }, 260);
  };

  const handleSelectItemFromPurchaseListModal = (chosen: Item) => {
    suppressItemListReopenRef.current = true;
    setTimeout(() => {
      suppressItemListReopenRef.current = false;
    }, 260);

    const targetRowIdx = purchaseItemListTargetRowIdx;
    setShowPurchaseItemListModal(false);
    setPurchaseItemListTargetRowIdx(null);

    const activeVars = getActiveVariants(chosen);
    if (Number(chosen.has_variants || 0) === 1 && activeVars.length > 0) {
      setPendingVariantPicker({
        item: chosen,
        targetRowIdx,
        focusQty: true,
        fromTopSearch: false,
      });
      return;
    }

    const hasDuplicate = lines.some(
      (l, i) =>
        (targetRowIdx !== null ? i !== targetRowIdx : true) &&
        l.item_id === chosen.id &&
        Number(l.variant_id || 0) === 0
    );
    if (hasDuplicate) {
      const isTargetEmpty =
        targetRowIdx !== null && (!lines[targetRowIdx]?.item_id || lines[targetRowIdx].item_id === 0);
      if (isTargetEmpty && targetRowIdx !== null) {
        setLines((prev) => {
          const copy = [...prev];
          copy[targetRowIdx] = createBlankPurchaseLine();
          return copy;
        });
      }
      setPendingDuplicatePrompt({
        item: chosen,
        variant: null,
        clearRowIdx: isTargetEmpty ? targetRowIdx : null,
      });
      return;
    }

    if (targetRowIdx !== null) {
      populatePurchaseRowWithItem(targetRowIdx, chosen, true);
      return;
    }

    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const rowIdxToFill = emptyIdx >= 0 ? emptyIdx : lines.length;
    applyItemToPurchaseRow(rowIdxToFill, chosen, true);
  };

  const handleLineChange = (
    idx: number,
    field: keyof PurchaseLineItem,
    value: string | number
  ) => {
    setLines((prev) => {
      const copy = [...prev];
      const row = { ...copy[idx], [field]: value };
      const upp = Math.max(1, parseUnitsPerPack(row.packing));

      const qty = Math.max(0, round2(Number(row.quantity) || 0));
      const looseQty = Math.max(0, round2(Number(row.loose_quantity) || 0));
      const rate = Math.max(0, round2(Number(row.purchase_rate) || 0));

      if (field === 'loose_rate') {
        row.is_loose_rate_manual = true;
      } else if (field === 'purchase_rate' && !row.is_loose_rate_manual) {
        row.loose_rate = round2(rate / upp);
      }

      const looseRate = Math.max(0, round2(Number(row.loose_rate) || 0));
      const gross = round2(qty * rate + looseQty * looseRate);

      let discPct = Math.max(0, round2(Number(row.discount_percent) || 0));
      let discAmt = Math.max(0, round2(Number(row.discount_amount) || 0));

      if (field === 'discount_amount') {
        discAmt = Math.min(gross, discAmt);
        discPct = gross > 0 ? round2((discAmt / gross) * 100) : 0;
      } else {
        discAmt = round2(gross * (discPct / 100));
      }

      const taxable = round2(gross - discAmt);
      const taxPct = Math.max(0, round2(Number(row.tax_percent) || 0));
      const taxAmt = round2(taxable * (taxPct / 100));
      const net = round2(taxable + taxAmt);

      copy[idx] = {
        ...row,
        quantity: qty,
        units_per_pack: upp,
        loose_quantity: looseQty,
        loose_rate: looseRate,
        gross_amount: gross,
        discount_percent: discPct,
        discount_amount: discAmt,
        taxable_amount: taxable,
        tax_percent: taxPct,
        tax_amount: taxAmt,
        line_total: net,
      };
      return ensureMinimumPurchaseRows(copy, visibleRowCapacityRef.current, idx);
    });
  };

  const openNetAmountModalForRow = (rowIdx: number, returnFocusId: string) => {
    const row = lines[rowIdx];
    const hasItem = Boolean(row && row.item_id && row.item_id > 0);
    const qty = round2(Number(row?.quantity || 0));
    let initialError: string | null = null;
    if (!Number.isFinite(qty) || qty <= 0) {
      initialError = 'Quantity is zero or empty. Please enter a valid quantity first.';
    } else if (!hasItem) {
      initialError = 'Please select an item in this row first before entering Net Amount.';
    }
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setRowItemSearchQuery('');
    setNetAmountModalState({
      isOpen: true,
      rowIndex: rowIdx,
      inputValue: '',
      error: initialError,
      returnFocusId,
    });
  };

  const handleCloseNetAmountModal = () => {
    const focusId = netAmountModalState.returnFocusId;
    setNetAmountModalState((prev) => ({
      ...prev,
      isOpen: false,
      error: null,
    }));
    if (focusId) {
      focusTargetElementById(focusId);
    }
  };

  const handleConfirmNetAmount = () => {
    const rowIdx = netAmountModalState.rowIndex;
    const row = lines[rowIdx];
    const qty = round2(Number(row?.quantity || 0));
    if (!Number.isFinite(qty) || qty <= 0) {
      setNetAmountModalState((prev) => ({
        ...prev,
        error: 'Quantity is zero or empty. Please enter a valid quantity first.',
      }));
      return;
    }

    if (!row || !row.item_id || row.item_id <= 0) {
      setNetAmountModalState((prev) => ({
        ...prev,
        error: 'Please select an item in this row first before entering Net Amount.',
      }));
      return;
    }

    const rawVal = String(netAmountModalState.inputValue ?? '').trim();
    const enteredNet = Number(rawVal);
    if (!rawVal || !Number.isFinite(enteredNet) || enteredNet <= 0) {
      setNetAmountModalState((prev) => ({
        ...prev,
        error: 'Please enter a valid Net Amount greater than zero.',
      }));
      return;
    }

    const finalNet = round2(enteredNet);
    const calculatedPrice = round2(finalNet / qty);
    const upp = Math.max(1, parseUnitsPerPack(row.packing));
    const looseRate = row.is_loose_rate_manual
      ? Math.max(0, round2(Number(row.loose_rate) || 0))
      : round2(calculatedPrice / upp);

    // Record calculated price as already prompted so Item Master price-change dialog does NOT trigger
    // and Item Master prices (purchase, trade, wholesale, retail) remain untouched.
    lastPromptedRateByRowRef.current[rowIdx] = calculatedPrice;

    setLines((prev) => {
      const copy = [...prev];
      const currentRow = copy[rowIdx];
      if (!currentRow) return prev;
      copy[rowIdx] = {
        ...currentRow,
        quantity: qty,
        loose_quantity: 0,
        purchase_rate: calculatedPrice,
        loose_rate: looseRate,
        discount_percent: 0,
        discount_amount: 0,
        gross_amount: finalNet,
        taxable_amount: finalNet,
        tax_percent: 0,
        tax_amount: 0,
        line_total: finalNet,
        last_prompted_purchase_rate: calculatedPrice,
        update_master_purchase_price: false,
        update_master_retail_price: false,
      };
      return ensureMinimumPurchaseRows(copy, visibleRowCapacityRef.current, rowIdx);
    });

    const focusId = netAmountModalState.returnFocusId;
    setNetAmountModalState({
      isOpen: false,
      rowIndex: rowIdx,
      inputValue: '',
      error: null,
      returnFocusId: '',
    });
    if (focusId) {
      focusTargetElementById(focusId);
    }
  };

  const addLineRow = () => {
    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const targetIdx = emptyIdx >= 0 ? emptyIdx : lines.length;
    if (emptyIdx >= 0) {
      setSelectedPurchaseLineIndex(emptyIdx);
    } else {
      setLines((prev) => [...prev, createBlankPurchaseLine()]);
      setSelectedPurchaseLineIndex(targetIdx);
    }
    const prefix = purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
    setTimeout(() => {
      focusPurchaseCell(targetIdx, 'item_name', prefix);
    }, 25);
  };

  const removeLineRow = (idx: number) => {
    const nextSelected = Math.max(0, Math.min(selectedPurchaseLineIndex, lines.length - 2));
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return ensureMinimumPurchaseRows(next, visibleRowCapacityRef.current, nextSelected);
    });
    setSelectedPurchaseLineIndex(nextSelected);
  };

  // Automatic Invoice-Level Calculations (Decimal Precision)
  const validLines = lines.filter((l) => l.item_id > 0);
  const grossTotal = round2(validLines.reduce((s, l) => s + l.gross_amount, 0));
  const itemDiscountTotal = round2(validLines.reduce((s, l) => s + l.discount_amount, 0));
  const subtotalAfterItemDisc = round2(grossTotal - itemDiscountTotal);

  const computedInvoiceDiscAmt =
    invoiceDiscountPercent > 0
      ? round2(subtotalAfterItemDisc * (invoiceDiscountPercent / 100))
      : Math.min(subtotalAfterItemDisc, round2(invoiceDiscountAmount));

  const totalDiscount = round2(itemDiscountTotal + computedInvoiceDiscAmt);
  const taxableAmount = round2(grossTotal - totalDiscount);

  // Prorate invoice discount for GST
  const gstTotal = round2(
    validLines.reduce((sum, l) => {
      const share =
        subtotalAfterItemDisc > 0 ? l.taxable_amount / subtotalAfterItemDisc : 0;
      const lineTaxableAfterInvDisc = round2(l.taxable_amount - computedInvoiceDiscAmt * share);
      return sum + round2(lineTaxableAfterInvDisc * (l.tax_percent / 100));
    }, 0)
  );

  const basis = taxSettings?.calculation_basis || 'taxable_plus_gst';
  const advanceTaxBase =
    basis === 'taxable_amount'
      ? taxableAmount
      : basis === 'gross_amount'
      ? grossTotal
      : round2(taxableAmount + gstTotal);

  const advanceTaxAmount = round2(advanceTaxBase * (appliedAdvanceTaxRate / 100));
  const netInvoiceAmount = round2(taxableAmount + gstTotal + advanceTaxAmount);

  // Supplier Balance & Payable Calculations (From actual supplier ledger)
  const fallbackPrevSupplierNetPayable = selectedSupplier
    ? round2(
        Number(selectedSupplier.supplier_credit || 0) -
          Number(selectedSupplier.supplier_debit || 0)
      )
    : 0;
  const prevSupplierNetPayable =
    supplierBalanceSummary !== null
      ? round2(supplierBalanceSummary.previousBalance)
      : fallbackPrevSupplierNetPayable;
  const previousSupplierBalance = Math.abs(prevSupplierNetPayable);
  const previousBalanceType =
    supplierBalanceSummary !== null
      ? supplierBalanceSummary.previousBalanceType
      : prevSupplierNetPayable >= 0
      ? 'Credit'
      : 'Debit';
  const totalPayable = round2(prevSupplierNetPayable + netInvoiceAmount);

  // Payment behavior: Credit starts at zero, Bank keeps the existing auto-fill,
  // while Cash is always entered manually by the user.
  useEffect(() => {
    if (!paidAmountManuallyEdited) {
      if (paymentMode === 'Credit') {
        setPaidAmount(0);
      } else if (paymentMode === 'Bank') {
        setPaidAmount(netInvoiceAmount);
      } else if (paymentMode === 'Cash') {
        // Cash: never auto-fill. Amount stays 0 until the user types it
        // (typing / quick buttons set paidAmountManuallyEdited, so they are never overwritten).
        setPaidAmount(0);
      }
    }
  }, [paymentMode, netInvoiceAmount, paidAmountManuallyEdited]);

  const remainingBalance = round2(totalPayable - round2(paidAmount));

  // Atomic Item Selection from Top Item Search Dropdown (Identical to Sales handleSelectFromTopSearch):
  // Finds the first empty row in the datasheet (or appends a new row if items are already added),
  // NEVER replaces any existing item row, selects the newly added row, and focuses back on Item Search!
  const handleSelectPurchaseSearchItem = (it: Item, preMatchedVariant?: ItemVariant | null) => {
    const activeVars = getActiveVariants(it);
    if (!preMatchedVariant && Number(it.has_variants || 0) === 1 && activeVars.length > 0) {
      setPurchaseSearchQuery('');
      setRowItemSearchQuery('');
      setActiveRowItemSearchIdx(null);
      setItemHighlightIndex(0);
      setShowPurchaseSearchDropdown(false);
      setPendingVariantPicker({
        item: it,
        targetRowIdx: null,
        focusQty: false,
        fromTopSearch: true,
      });
      return;
    }

    const variantId = preMatchedVariant ? Number(preMatchedVariant.id) : 0;
    const hasDuplicate = lines.some(
      (l) => l.item_id === it.id && Number(l.variant_id || 0) === variantId
    );
    if (hasDuplicate) {
      setPurchaseSearchQuery('');
      setRowItemSearchQuery('');
      setActiveRowItemSearchIdx(null);
      setItemHighlightIndex(0);
      setShowPurchaseSearchDropdown(false);
      setPendingDuplicatePrompt({ item: it, variant: preMatchedVariant || null, clearRowIdx: null });
      return;
    }

    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const targetRowIdx = emptyIdx >= 0 ? emptyIdx : lines.length;

    setLines((prev) => {
      const next = [...prev];
      const existingEmpty = next.findIndex((l) => !l.item_id || l.item_id === 0);
      const idxToFill = existingEmpty >= 0 ? existingEmpty : next.length;
      if (idxToFill >= next.length) {
        next.push(buildPopulatedLineFromItem(it, undefined, false, preMatchedVariant || null));
      } else {
        next[idxToFill] = buildPopulatedLineFromItem(it, undefined, false, preMatchedVariant || null);
      }
      return ensureMinimumPurchaseRows(next, visibleRowCapacityRef.current, idxToFill);
    });

    setSelectedPurchaseLineIndex(targetRowIdx);
    setPurchaseSearchQuery('');
    setRowItemSearchQuery('');
    setActiveRowItemSearchIdx(null);
    setItemHighlightIndex(0);
    setShowPurchaseSearchDropdown(false);
    fetchPurchaseItemHistoryByCode(it.item_code, it.id, preMatchedVariant?.id || null);

    // Requirement 9: After selecting an item:
    // Add it to the invoice, clear search field, automatically focus search field for next item
    setTimeout(() => {
      itemSearchInputRef.current?.focus();
      itemSearchInputRef.current?.select?.();
    }, 25);
  };

  const handleItemSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showPurchaseSearchDropdown) {
        setShowPurchaseSearchDropdown(true);
        setItemHighlightIndex(0);
        return;
      }
      setItemHighlightIndex((prev) => {
        const next = Math.min(prev + 1, Math.max(0, purchaseSearchResults.length - 1));
        setTimeout(() => {
          const el = itemListRef.current?.querySelector(`[data-item-idx="${next}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }, 0);
        return next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showPurchaseSearchDropdown) {
        setShowPurchaseSearchDropdown(true);
        return;
      }
      setItemHighlightIndex((prev) => {
        const next = Math.max(0, prev - 1);
        setTimeout(() => {
          const el = itemListRef.current?.querySelector(`[data-item-idx="${next}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }, 0);
        return next;
      });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const qTrim = purchaseSearchQuery.trim();
      if (qTrim) {
        // Check exact barcode / variant code / item code scan first
        const exactScan = findExactBarcodeOrCodeMatch(items, qTrim);
        if (exactScan) {
          handleSelectPurchaseSearchItem(exactScan.item, exactScan.variant || null);
          return;
        }
        if (showPurchaseSearchDropdown && purchaseSearchResults.length > 0) {
          const chosen =
            purchaseSearchResults[itemHighlightIndex] || purchaseSearchResults[0];
          if (chosen) {
            handleSelectPurchaseSearchItem(chosen);
            return;
          }
        }
        // Fallback live barcode lookup (covers extra barcodes not yet in local cache)
        api
          .lookupBarcodeExact(qTrim)
          .then((lookup) => {
            if (lookup?.matched && lookup.item) {
              handleSelectPurchaseSearchItem(lookup.item, lookup.variant || null);
            }
          })
          .catch(() => null);
        return;
      }
      // If Item Search is empty and dropdown is closed, pressing Enter moves into Active Row's Quantity field!
      const activeLine = lines[selectedPurchaseLineIndex];
      const prefix = purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
      if (activeLine && activeLine.item_id > 0) {
        focusPurchaseCell(selectedPurchaseLineIndex, 'quantity', prefix);
      } else {
        focusPurchaseCell(selectedPurchaseLineIndex, 'item_name', prefix);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setShowPurchaseSearchDropdown(false);
    }
  };

  const handleIncrementPurchaseQty = (idx: number) => {
    const cur = Number(lines[idx]?.quantity || 0);
    handleLineChange(idx, 'quantity', cur + 1);
  };

  const handleDecrementPurchaseQty = (idx: number) => {
    const cur = Number(lines[idx]?.quantity || 0);
    if (cur > 0) {
      handleLineChange(idx, 'quantity', Math.max(0, cur - 1));
    }
  };

  const handleIncrementBonusQty = (idx: number) => {
    const cur = Number(lines[idx]?.bonus_quantity || 0);
    handleLineChange(idx, 'bonus_quantity', cur + 1);
  };

  const handleDecrementBonusQty = (idx: number) => {
    const cur = Number(lines[idx]?.bonus_quantity || 0);
    if (cur > 0) {
      handleLineChange(idx, 'bonus_quantity', cur - 1);
    }
  };

  const handleExactPurchasePayment = () => {
    setPaidAmountManuallyEdited(true);
    setPaidAmount(totalPayable > 0 ? totalPayable : netInvoiceAmount);
  };

  const handleQuickPurchaseCash = (amt: number) => {
    setPaidAmountManuallyEdited(true);
    setPaidAmount(amt);
  };



  // Datasheet Cell Keyboard Navigation Sequence (Both POS Table & MS Access Datasheet)
  // Column Sequence: Item Code -> Item Name -> Qty -> Discount -> Purchase Rate -> Bonus -> Net Amount -> remaining read-only/details columns
  const purchaseAccessColOrder = [
    'item_code',
    'item_name',
    'quantity',
    'discount_percent',
    'purchase_rate',
    'bonus_quantity',
    'batch_number',
    'expiry_date',
    'mrp_rate',
    'tax_percent',
    'remarks',
  ];

  const purchasePosColOrder = [
    'item_code',
    'item_name',
    'quantity',
    'discount_percent',
    'bonus_quantity',
    'batch_number',
    'expiry_date',
    'purchase_rate',
    'mrp_rate',
    'tax_percent',
    'remarks',
  ];

  const getPurchaseColsForPrefix = (prefix: 'pur_cell' | 'pos_row') =>
    prefix === 'pos_row' ? purchasePosColOrder : purchaseAccessColOrder;

  const focusPurchaseCell = (
    rIdx: number,
    col: string,
    prefix: 'pur_cell' | 'pos_row' = 'pur_cell'
  ) => {
    const cols = getPurchaseColsForPrefix(prefix);
    const resolvedCol = cols.includes(col) ? col : cols[0];
    const el = document.getElementById(`${prefix}_${rIdx}_${resolvedCol}`) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (el) {
      el.focus();
      el.closest('tr')?.scrollIntoView({ block: 'nearest' });
      if ('select' in el && typeof el.select === 'function') {
        el.select();
      }
    }
  };

  // MS Access-style: only ONE blank "new record" row is active at a time.
  // Blank rows below it are greyed placeholders and cannot be edited.
  const entryRowIdx = (() => {
    const i = lines.findIndex((l) => !isPurchaseLinePopulated(l));
    return i >= 0 ? i : lines.length;
  })();
  const isGhostRow = (idx: number) => idx > entryRowIdx && !isPurchaseLinePopulated(lines[idx]);

  const navigateToPurchaseRecord = (targetIdx: number, preferredCol?: string) => {
    if (lines.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(lines.length - 1, entryRowIdx, targetIdx));
    setSelectedPurchaseLineIndex(clampedIdx);
    setPurchaseRecordJumpInput(String(clampedIdx + 1));
    setActiveRowItemSearchIdx(null);

    const prefix: 'pur_cell' | 'pos_row' =
      purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
    const targetRow = lines[clampedIdx];
    const defaultCol =
      preferredCol || (targetRow && targetRow.item_id > 0 ? 'quantity' : 'item_code');

    setTimeout(() => {
      focusPurchaseCell(clampedIdx, defaultCol, prefix);
    }, 15);
  };

  // Read-only projection of existing purchase lines (includes catalog barcode lookup)
  const purchaseSearchableItems = useMemo<InvoiceSearchableItem[]>(() => {
    const barcodeByItemId = new Map<number, string>();
    for (const it of items) {
      if (it?.id && it?.barcode) {
        barcodeByItemId.set(Number(it.id), String(it.barcode));
      }
    }
    return lines.map((line, idx) => ({
      rowIndex: idx,
      itemId: line.item_id > 0 ? line.item_id : null,
      itemCode: line.item_code || '',
      itemName: line.item_name || '',
      barcode: line.item_id > 0 ? barcodeByItemId.get(Number(line.item_id)) || '' : '',
    }));
  }, [lines, items]);

  const handlePreviewSearchedPurchaseRow = useCallback((rowIdx: number | null) => {
    if (rowIdx === null || rowIdx < 0) return;
    setSelectedPurchaseLineIndex(rowIdx);
    const rowEl = document.querySelector(`[data-purchase-row-idx="${rowIdx}"]`) as HTMLElement | null;
    if (rowEl) {
      rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, []);

  const handleNavigateToSearchedPurchaseRow = useCallback(
    (rowIdx: number) => {
      if (rowIdx < 0 || rowIdx >= lines.length) return;
      // Safely suppress opening Item List modal so existing invoice item is never modified
      suppressItemListReopenRef.current = true;
      posDatasheetMouseActivatedRef.current = true;
      setSelectedPurchaseLineIndex(rowIdx);
      setPurchaseRecordJumpInput(String(rowIdx + 1));
      setActiveRowItemSearchIdx(null);
      const prefix: 'pur_cell' | 'pos_row' =
        purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
      setTimeout(() => {
        const rowEl = document.querySelector(`[data-purchase-row-idx="${rowIdx}"]`) as HTMLElement | null;
        rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        focusPurchaseCell(rowIdx, 'quantity', prefix);
      }, 15);
    },
    [lines.length, purchaseViewMode]
  );

  const handlePurchaseRecordJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const parsed = parseInt(purchaseRecordJumpInput, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        navigateToPurchaseRecord(parsed - 1);
      } else {
        setPurchaseRecordJumpInput(String(selectedPurchaseLineIndex + 1));
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      navigateToPurchaseRecord(
        selectedPurchaseLineIndex - (e.key === 'PageUp' ? 5 : 1)
      );
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      navigateToPurchaseRecord(
        selectedPurchaseLineIndex + (e.key === 'PageDown' ? 5 : 1)
      );
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      navigateToPurchaseRecord(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      navigateToPurchaseRecord(lines.length - 1);
      return;
    }
  };

  // Microsoft Access-style continuous entry:
  // Move to next blank row without mutating existing rows and focus Item Name in the new row
  const advanceToNextBlankPurchaseRow = (
    _fromRowIdx: number,
    prefix: 'pur_cell' | 'pos_row'
  ) => {
    const nextRow = entryRowIdx;
    if (nextRow >= lines.length) {
      setLines((prev) => [...prev, createBlankPurchaseLine()]);
    }
    setSelectedPurchaseLineIndex(nextRow);
    setPurchaseRecordJumpInput(String(nextRow + 1));
    setActiveRowItemSearchIdx(null);
    setActiveRowItemSearchField(null);
    setRowItemSearchQuery('');
    setTimeout(() => {
      focusPurchaseCell(nextRow, 'item_name', prefix);
    }, 25);
  };

  const handlePurchaseCellKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIdx: number,
    field: string,
    prefix: 'pur_cell' | 'pos_row' = 'pur_cell'
  ) => {
    const colOrder = getPurchaseColsForPrefix(prefix);
    const curColIdx = colOrder.indexOf(field);

    const isInlineSearchOpen =
      (field === 'item_code' || field === 'item_name') &&
      activeRowItemSearchIdx === rowIdx &&
      rowItemSearchQuery.trim().length > 0 &&
      rowItemSearchResults.length > 0;

    if (
      field === 'item_name' &&
      e.key === 'Control' &&
      !e.repeat &&
      !e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      openNetAmountModalForRow(rowIdx, `${prefix}_${rowIdx}_item_name`);
      return;
    }

    if (ctrlPriceHistoryArmedRef.current && e.ctrlKey && e.key !== 'Control') {
      ctrlPriceHistoryArmedRef.current = false;
      setShowPurchaseCompactHistoryPopup(false);
    }

    const activeRowForHistory = lines[rowIdx];
    if (
      field === 'purchase_rate' &&
      activeRowForHistory &&
      (activeRowForHistory.item_id > 0 || activeRowForHistory.item_code?.trim()) &&
      e.key === 'Control' &&
      !e.repeat &&
      !e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      ctrlPriceHistoryArmedRef.current = true;
      setSelectedPurchaseLineIndex(rowIdx);
      fetchPurchaseItemHistoryByCode(
        activeRowForHistory.item_code,
        Number(activeRowForHistory.item_id || 0),
        activeRowForHistory.variant_id || null
      );
      setShowPurchaseCompactHistoryPopup(true);
      return;
    }

    if (e.key === 'Escape') {
      if (activeRowItemSearchIdx !== null) {
        e.preventDefault();
        setActiveRowItemSearchIdx(null);
        setActiveRowItemSearchField(null);
        setRowItemSearchQuery('');
      }
      if (showPurchaseCompactHistoryPopup) {
        e.preventDefault();
        e.stopPropagation();
        ctrlPriceHistoryArmedRef.current = false;
        setShowPurchaseCompactHistoryPopup(false);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
      e.preventDefault();
      navigateToPurchaseRecord(0, colOrder[0]);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
      e.preventDefault();
      navigateToPurchaseRecord(entryRowIdx, field);
      return;
    }

    if (e.key === 'PageUp') {
      e.preventDefault();
      const prevRow = Math.max(0, rowIdx - 5);
      setSelectedPurchaseLineIndex(prevRow);
      focusPurchaseCell(prevRow, field, prefix);
      return;
    }

    if (e.key === 'PageDown') {
      e.preventDefault();
      const nextRow = Math.min(entryRowIdx, lines.length - 1, rowIdx + 5);
      setSelectedPurchaseLineIndex(nextRow);
      focusPurchaseCell(nextRow, field, prefix);
      return;
    }

    if (e.key === 'Enter' && field === 'bonus_quantity') {
      // Complete current item entry, move to the NEXT NEW empty invoice row,
      // preserve all existing rows, open Item List popup for the NEW row, and auto-focus Search.
      e.preventDefault();
      suppressItemListReopenRef.current = false;
      const nextNewRowIdx = findNextBlankPurchaseRowIndex(lines, rowIdx);
      if (nextNewRowIdx >= lines.length) {
        setLines((prev) =>
          ensureMinimumPurchaseRows(
            [...prev, createBlankPurchaseLine()],
            visibleRowCapacityRef.current,
            nextNewRowIdx
          )
        );
      }
      setSelectedPurchaseLineIndex(nextNewRowIdx);
      setPurchaseRecordJumpInput(String(nextNewRowIdx + 1));
      setActiveRowItemSearchIdx(null);
      setActiveRowItemSearchField(null);
      setRowItemSearchQuery('');
      const itemNameId = `${prefix}_${nextNewRowIdx}_item_name`;
      const originMode = prefix === 'pos_row' ? 'pos_row' : 'access_row';
      requestAnimationFrame(() => {
        setTimeout(() => {
          focusPurchaseCell(nextNewRowIdx, 'item_name', prefix);
          openPurchaseItemListForRow(nextNewRowIdx, originMode, itemNameId);
        }, 25);
      });
      return;
    }

    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (
        e.key === 'Enter' &&
        (field === 'item_code' || field === 'item_name') &&
        (!lines[rowIdx]?.item_id || lines[rowIdx]?.item_id === 0)
      ) {
        e.preventDefault();
        // Exact Item Code / Variant Code / Barcode typed -> fill row directly (no popup)
        const typedRaw = rowItemSearchQuery.trim();
        if (field === 'item_code' && typedRaw) {
          const exactScan = findExactBarcodeOrCodeMatch(items, typedRaw);
          if (exactScan) {
            populatePurchaseRowWithItem(rowIdx, exactScan.item, true, exactScan.variant || null);
            return;
          }
        }
        suppressItemListReopenRef.current = false;
        openPurchaseItemListForRow(
          rowIdx,
          prefix === 'pos_row' ? 'pos_row' : 'access_row',
          `${prefix}_${rowIdx}_${field}`
        );
        return;
      }
      if (field === 'purchase_rate') {
        const nextCol = colOrder[curColIdx + 1] || 'mrp_rate';
        if (
          checkAndTriggerPurchasePriceChange(rowIdx, `${prefix}_${rowIdx}_${nextCol}`)
        ) {
          e.preventDefault();
          return;
        }
      }
      if (curColIdx >= 0 && curColIdx < colOrder.length - 1) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, colOrder[curColIdx + 1], prefix);
      } else if (curColIdx === colOrder.length - 1) {
        e.preventDefault();
        advanceToNextBlankPurchaseRow(rowIdx, prefix);
      }
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      if (curColIdx > 0) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, colOrder[curColIdx - 1], prefix);
      } else if (curColIdx === 0 && rowIdx > 0) {
        e.preventDefault();
        setSelectedPurchaseLineIndex(rowIdx - 1);
        focusPurchaseCell(rowIdx - 1, colOrder[colOrder.length - 1], prefix);
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      const inputEl = e.currentTarget as HTMLInputElement;
      const isAtEnd =
        !('selectionStart' in inputEl) ||
        inputEl.type === 'number' ||
        inputEl.type === 'date' ||
        inputEl.selectionStart === null ||
        (inputEl.selectionStart === inputEl.value.length &&
          inputEl.selectionEnd === inputEl.value.length);
      if (isAtEnd && curColIdx >= 0 && curColIdx < colOrder.length - 1) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, colOrder[curColIdx + 1], prefix);
        return;
      }
    }

    if (e.key === 'ArrowLeft') {
      const inputEl = e.currentTarget as HTMLInputElement;
      const isAtStart =
        !('selectionStart' in inputEl) ||
        inputEl.type === 'number' ||
        inputEl.type === 'date' ||
        inputEl.selectionStart === null ||
        (inputEl.selectionStart === 0 && inputEl.selectionEnd === 0);
      if (isAtStart && curColIdx > 0) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, colOrder[curColIdx - 1], prefix);
        return;
      }
    }

    if (e.key === 'ArrowUp' && !isInlineSearchOpen) {
      e.preventDefault();
      if (rowIdx > 0) {
        setSelectedPurchaseLineIndex(rowIdx - 1);
        focusPurchaseCell(rowIdx - 1, field, prefix);
      }
      return;
    }

    if (e.key === 'ArrowDown' && !isInlineSearchOpen) {
      e.preventDefault();
      if (rowIdx >= entryRowIdx) return;
      if (rowIdx < lines.length - 1) {
        setSelectedPurchaseLineIndex(rowIdx + 1);
        focusPurchaseCell(rowIdx + 1, field, prefix);
      } else {
        setLines((prev) => [...prev, createBlankPurchaseLine()]);
        setSelectedPurchaseLineIndex(rowIdx + 1);
        setTimeout(() => {
          focusPurchaseCell(rowIdx + 1, field, prefix);
        }, 25);
      }
      return;
    }
  };

  const resetInvoiceForm = async () => {
    try {
      localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
    } catch {
      // ignore
    }
    editingPurchaseIdRef.current = null;
    setEditingPurchaseId(null);
    setEditingPurchaseStatus(null);
    setSupplierId('');
    setSupplierSearchQuery('');
    setSupplierFilerStatus('Filer');
    setSupplierInvoiceNumber('');
    setNotes('');
    setInvoiceDiscountPercent(0);
    setInvoiceDiscountAmount(0);
    setIsTaxOverridden(false);
    setTaxOverrideReason('');
    setPaymentMode('Cash');
    setPaymentAccountId('');
    setPaidAmount(0);
    setPaidAmountManuallyEdited(false);
    setLines(ensureMinimumPurchaseRows([], visibleRowCapacityRef.current, 0));
    lastPromptedRateByRowRef.current = {};
    isPricePromptOpenRef.current = false;
    setPriceChangePrompt(null);
    setSelectedPurchaseLineIndex(0);
    setPurchaseSearchQuery('');
    setShowPurchaseSearchDropdown(false);
    setIsSupplierDropdownOpen(false);
    setShowPurchaseCompactHistoryPopup(false);
    setClientRequestId(`pur-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    setTimeout(() => {
      supplierSearchInputRef.current?.focus();
      supplierSearchInputRef.current?.select?.();
    }, 40);
    try {
      const nums = await api.getNextPurchaseNumbers(billDate);
      setBillNumber(nums.nextPurchaseNumber);
      setSupplierInvoiceNumber(nums.nextPurchaseNumber);
      setNextPurchaseNo(nums.nextPurchaseNumber);
      setNextReturnNo(nums.nextReturnNumber);
    } catch {
      // ignore
    }
  };

  // Resume specific Held / Draft purchase invoice into the datasheet
  const handleResumeHeldPurchase = async (purId: number) => {
    isResumingPurchaseRef.current = true;
    try {
      setFormError(null);
      const res: any = await api.getPurchaseDetails(purId);
      const p = res?.purchase || res?.data || res;
      if (!p || !p.id) {
        throw new Error('Held purchase invoice could not be found in the active database.');
      }
      const rawItems = Array.isArray(res?.items) ? res.items : Array.isArray(p?.items) ? p.items : [];

      try {
        localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
      } catch {
        // ignore
      }

      const resumedDate = p.bill_date || new Date().toISOString().slice(0, 10);
      const nextPreviewRes = await api
        .getNextPurchaseNumbers(resumedDate)
        .catch(() => ({ nextPurchaseNumber: p.bill_number || '' }));
      const livePreviewNo = nextPreviewRes.nextPurchaseNumber || p.bill_number || '';

      editingPurchaseIdRef.current = p.id;
      setEditingPurchaseId(p.id);
      setEditingPurchaseStatus('held');
      setBillNumber(livePreviewNo);
      setSupplierInvoiceNumber(
        !p.supplier_invoice_number ||
          /^(PI-|Inv-|PUR-|HLD-|HOLD-|DRF-|DRAFT-)/i.test(String(p.supplier_invoice_number).trim())
          ? livePreviewNo
          : p.supplier_invoice_number
      );
      setBillDate(resumedDate);
      setSupplierId(p.supplier_account_id ? String(p.supplier_account_id) : '');
      setSupplierFilerStatus(p.supplier_filer_status || 'Filer');
      setNotes(p.remarks || '');
      setInvoiceDiscountPercent(Number(p.invoice_discount_percent || 0));
      setInvoiceDiscountAmount(Number(p.invoice_discount_amount || 0));
      setIsTaxOverridden(Boolean(p.is_tax_overridden));
      setCustomAdvanceTaxRate(Number(p.advance_tax_rate ?? 0.5));
      setTaxOverrideReason(p.tax_override_reason || '');
      setTaxOverrideAuthorizedBy(p.tax_override_authorized_by || 'Chief Pharmacist / Admin');
      setPaymentMode(p.payment_mode || 'Credit');
      setPaymentAccountId(p.payment_account_id ? String(p.payment_account_id) : '');
      setPaidAmount(Math.max(0, Number(p.paid_amount ?? 0)));
      setPaidAmountManuallyEdited(true);

      const loadedItems: PurchaseLineItem[] = rawItems.map((it: any) => {
        const upp = Math.max(1, Number(it.units_per_pack || parseUnitsPerPack(it.packing)));
        const pRate = Number(it.purchase_rate || 0);
        const lRate =
          it.loose_rate !== undefined && Number(it.loose_rate) > 0
            ? Number(it.loose_rate)
            : round2(pRate / upp);
        return {
          id: it.id,
          purchase_id: it.purchase_id,
          item_id: Number(it.item_id || 0),
          variant_id: it.variant_id ? Number(it.variant_id) : null,
          variant_code: it.variant_code || '',
          variant_name: it.variant_name || '',
          thumbnail_url: it.effective_thumbnail_url || it.thumbnail_url || null,
          inventory_id: it.inventory_id,
          item_code: it.item_code || '',
          company_name: it.company_name || '',
          item_name: it.item_name || '',
          packing: it.packing || '1x1',
          units_per_pack: upp,
          batch_number: it.batch_number || '',
          manufacturing_date: it.manufacturing_date || '',
          expiry_date: it.expiry_date || '',
          quantity: Number(it.quantity || 0),
          loose_quantity: Number(it.loose_quantity || 0),
          bonus_quantity: Number(it.bonus_quantity || 0),
          purchase_rate: pRate,
          loose_rate: lRate,
          mrp_rate: Number(it.mrp_rate || 0),
          gross_amount: Number(it.gross_amount || 0),
          discount_percent: Number(it.discount_percent || 0),
          discount_amount: Number(it.discount_amount || 0),
          taxable_amount: Number(it.taxable_amount || 0),
          tax_percent: Number(it.tax_percent || 0),
          tax_amount: Number(it.tax_amount || 0),
          line_total: Number(it.line_total || 0),
          remarks: String(it.remarks || ''),
        };
      });

      setLines(ensureMinimumPurchaseRows(loadedItems, visibleRowCapacityRef.current, 0));
      setSelectedPurchaseLineIndex(0);
      setShowHeldModal(false);
      setSubTab('new-invoice');
      setFormSuccess(
        `Held purchase draft ${p.bill_number} resumed into datasheet. You can now edit lines or click Save to confirm.`
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      isResumingPurchaseRef.current = false;
    }
  };

  // Discard a specific Held / Draft purchase invoice
  const handleDiscardHeldPurchase = async (purId: number, billNo: string) => {
    if (!window.confirm(`Are you sure you want to discard held purchase draft "${billNo}" permanently?`)) {
      return;
    }
    try {
      setFormError(null);
      await api.deletePurchase(purId, 'Discarded from Held Purchases');
      if (editingPurchaseId === purId) {
        await resetInvoiceForm();
      }
      await fetchHeldPurchases();
      setFormSuccess(`Held purchase draft ${billNo} discarded successfully.`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Applies the Item Master price updates approved in the price-change prompt.
  // Called only after a completed invoice is saved; never on hold / preview / reset.
  const applyDeferredMasterPriceUpdates = async (savedLines: PurchaseLineItem[]): Promise<string[]> => {
    const problems: string[] = [];
    for (const l of savedLines) {
      if (!l.update_master_purchase_price || !l.item_id) continue;
      const newPurchase = round2(Number(l.purchase_rate || 0));
      // Skip if the rate was changed again after the approval (the prompt re-asks in that case).
      if (
        newPurchase <= 0 ||
        l.last_prompted_purchase_rate === undefined ||
        Math.abs(l.last_prompted_purchase_rate - newPurchase) >= 0.01
      ) {
        continue;
      }
      const updateRetail = Boolean(l.update_master_retail_price);
      const masterItem = items.find((it) => it.id === l.item_id);
      const masterVariant =
        l.variant_id && masterItem?.variants
          ? masterItem.variants.find((v) => Number(v.id) === Number(l.variant_id))
          : null;
      const isCustomVariantPrice = Boolean(masterVariant && Number(masterVariant.use_parent_pricing) === 0);
      const packingStr =
        (isCustomVariantPrice && masterVariant?.effective_packing) ||
        masterItem?.packing ||
        l.packing ||
        '1x1';
      const { roundedRetailPrice } = calculateRetailFromPurchasePrice(newPurchase);
      const finalRetail =
        l.master_retail_price && l.master_retail_price > 0
          ? round2(l.master_retail_price)
          : roundedRetailPrice;
      const finalLoose =
        l.master_loose_rate && l.master_loose_rate > 0
          ? round2(l.master_loose_rate)
          : calculateLooseRateFromRetail(finalRetail, packingStr);
      const body = {
        new_purchase_price: newPurchase,
        update_purchase_price: true,
        update_retail_price: updateRetail,
        ...(updateRetail
          ? {
              new_retail_price: finalRetail,
              new_loose_rate: finalLoose,
            }
          : {}),
      };
      try {
        if (isCustomVariantPrice && l.variant_id) {
          await api.updateItemVariant(Number(l.variant_id), {
            purchase_price: newPurchase,
            ...(updateRetail
              ? {
                  trade_price: finalRetail,
                  wholesale_price: finalRetail,
                  retail_price: finalRetail,
                  loose_rate: finalLoose,
                }
              : {}),
          });
        } else {
          await api.updateItemPriceCascade(l.item_id, body);
        }
      } catch (err: unknown) {
        problems.push(`${l.item_name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return problems;
  };

  // Submit Purchase Invoice (Save / Confirm or Hold)
  const handleSavePurchaseInvoice = async (
    e?: React.FormEvent,
    autoPrintAfterSave: boolean = false,
    targetStatus: 'completed' | 'held' = 'completed'
  ) => {
    if (e) e.preventDefault();
    if (savingInvoice) return;
    setFormError(null);
    setFormSuccess(null);

    const resolvedSupplierId = supplierId;
    if (!resolvedSupplierId) {
      setFormError('Please select or add a Supplier Account before saving or holding.');
      supplierSearchInputRef.current?.focus();
      return;
    }
    if (validLines.length === 0) {
      setFormError('Please add at least one Medicine Item to the Purchase Invoice before saving or holding.');
      itemSearchInputRef.current?.focus();
      return;
    }

    if (targetStatus === 'completed') {
      if (isTaxOverridden && !taxOverrideReason.trim()) {
        setFormError('Please enter a valid Override Reason for the Advance Tax override.');
        return;
      }

      for (let i = 0; i < validLines.length; i++) {
        const l = validLines[i];
        if (
          (Number(l.quantity) || 0) <= 0 &&
          (Number(l.bonus_quantity) || 0) <= 0 &&
          (Number(l.loose_quantity) || 0) <= 0
        ) {
          const gridIdx = lines.findIndex((row) => row.item_id === l.item_id && row.batch_number === l.batch_number);
          const focusIdx = gridIdx >= 0 ? gridIdx : i;
          setSelectedPurchaseLineIndex(focusIdx);
          setFormError(`Please enter a Quantity (or Loose Qty / Bonus Qty) for Row #${focusIdx + 1} (${l.item_name}).`);
          setTimeout(() => {
            const qtyEl =
              purchaseViewMode === 'pos'
                ? (document.getElementById(`pos_row_${focusIdx}_quantity`) as HTMLInputElement | null)
                : (document.getElementById(`pur_cell_${focusIdx}_quantity`) as HTMLInputElement | null);
            qtyEl?.focus();
          }, 25);
          return;
        }
      }
    }

    const sanitizedItems = validLines.map((l) => ({
      ...l,
      variant_id: l.variant_id || null,
      variant_code: l.variant_id ? (l.variant_code || null) : null,
      variant_name: l.variant_id ? (l.variant_name || null) : null,
      batch_number: l.batch_number?.trim() || `B-${l.variant_code || l.item_code || l.item_id}-01`,
      expiry_date: l.expiry_date || '2028-12-31',
      quantity: Number(l.quantity) || 0,
      loose_quantity: Number(l.loose_quantity) || 0,
      bonus_quantity: Number(l.bonus_quantity) || 0,
      loose_rate: Number(l.loose_rate) || 0,
      remarks: String(l.remarks || '').trim(),
      ...(targetStatus === 'held'
        ? { update_master_purchase_price: false, update_master_retail_price: false }
        : {}),
    }));

    const payload = {
      bill_number: billNumber,
      supplier_invoice_number: supplierInvoiceNumber.trim() || billNumber,
      bill_date: billDate,
      supplier_account_id: parseInt(resolvedSupplierId, 10),
      supplier_filer_status: supplierFilerStatus,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      is_tax_overridden: isTaxOverridden,
      advance_tax_rate: appliedAdvanceTaxRate,
      tax_override_reason: taxOverrideReason,
      tax_override_authorized_by: taxOverrideAuthorizedBy,
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId ? parseInt(paymentAccountId, 10) : null,
      paid_amount: round2(paidAmount),
      remarks: notes,
      status: targetStatus,
      from_hold_conversion: Boolean(
        editingPurchaseId &&
          String(editingPurchaseStatus || '').trim().toLowerCase() !== 'completed' &&
          targetStatus === 'completed'
      ),
      client_request_id: clientRequestId,
      items: sanitizedItems,
    };

    try {
      setSavingInvoice(true);
      if (editingPurchaseId) {
        const postedPurId = editingPurchaseId;
        const res = await api.updatePurchase(postedPurId, payload);
        const savedId = res.purchase?.id || postedPurId;
        const savedBillNo = res.purchase?.bill_number || billNumber;
        if (targetStatus === 'completed') {
          setHeldPurchases((prev) => prev.filter((h) => Number(h.id) !== Number(postedPurId)));
        }
        setFormSuccess(
          targetStatus === 'held'
            ? `Purchase Invoice held successfully (Draft #${savedBillNo}). No stock or ledger was affected.`
            : res.message || `Purchase Invoice ${savedBillNo} confirmed! Stock & Supplier Ledger updated.`
        );
        try {
          localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
        } catch {
          // ignore
        }
        const priceUpdateProblems =
          targetStatus === 'completed' ? await applyDeferredMasterPriceUpdates(sanitizedItems) : [];
        if (targetStatus === 'completed') {
          setPurchaseItemHistoryMap({});
        }
        await resetInvoiceForm();
        await fetchWorkspaceData();
        await fetchHeldPurchases();
        if (priceUpdateProblems.length > 0) {
          setFormError(
            `Invoice saved, but Item Master price could not be updated for: ${priceUpdateProblems.join(' | ')}`
          );
        }
        if (targetStatus === 'completed' && autoPrintAfterSave && savedId) {
          handleOpenPrintInvoice(savedId);
        }
      } else {
        const res = await api.createPurchase(payload);
        const savedId = res.purchase?.id;
        const savedBillNo = res.purchase?.bill_number || billNumber;
        setFormSuccess(
          targetStatus === 'held'
            ? `Purchase Invoice held successfully (Draft #${savedBillNo}). No stock or ledger was affected.`
            : res.message || `Purchase Invoice ${savedBillNo} confirmed! Stock & Supplier Ledger updated.`
        );
        try {
          localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
        } catch {
          // ignore
        }
        const priceUpdateProblems =
          targetStatus === 'completed' ? await applyDeferredMasterPriceUpdates(sanitizedItems) : [];
        if (targetStatus === 'completed') {
          setPurchaseItemHistoryMap({});
        }
        await resetInvoiceForm();
        await fetchWorkspaceData();
        await fetchHeldPurchases();
        if (priceUpdateProblems.length > 0) {
          setFormError(
            `Invoice saved, but Item Master price could not be updated for: ${priceUpdateProblems.join(' | ')}`
          );
        }
        if (targetStatus === 'completed' && autoPrintAfterSave && savedId) {
          handleOpenPrintInvoice(savedId);
        }
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingInvoice(false);
    }
  };

  const [autoExportPdfOnOpen, setAutoExportPdfOnOpen] = useState<boolean>(false);

  const handleExportCurrentPurchasePdf = () => {
    setFormError(null);
    if (validLines.length === 0) {
      setFormError('Please add at least one Medicine Item before exporting the invoice to PDF.');
      itemSearchInputRef.current?.focus();
      return;
    }
    setAutoExportPdfOnOpen(true);
    handlePreviewInvoice();
  };

  // Preview the A4 invoice from the current (unsaved) form. Nothing is posted or saved.
  const handlePreviewInvoice = () => {
    setFormError(null);
    if (validLines.length === 0) {
      setFormError('Please add at least one Medicine Item before previewing the invoice.');
      itemSearchInputRef.current?.focus();
      return;
    }
    const previewItems = validLines.map((l) => ({
      ...l,
      batch_number: l.batch_number?.trim() || `B-${l.item_code || l.item_id}-01`,
      expiry_date: l.expiry_date || '2028-12-31',
      quantity: Number(l.quantity) || 0,
      loose_quantity: Number(l.loose_quantity) || 0,
      bonus_quantity: Number(l.bonus_quantity) || 0,
      loose_rate: Number(l.loose_rate) || 0,
      remarks: String(l.remarks || ''),
    }));
    const paid = round2(paidAmount);
    const previewInvoice = {
      id: editingPurchaseId || 0,
      bill_number: billNumber,
      bill_date: billDate,
      supplier_account_id: supplierId ? parseInt(supplierId, 10) : 0,
      supplier_name: selectedSupplier?.account_name || '',
      supplier_code: selectedSupplier?.account_code || '',
      supplier_invoice_number: supplierInvoiceNumber.trim() || billNumber,
      supplier_filer_status: supplierFilerStatus,
      gross_amount: grossTotal,
      gross_total: grossTotal,
      item_discount_amount: itemDiscountTotal,
      discount_amount: totalDiscount,
      total_discount: totalDiscount,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      taxable_amount: taxableAmount,
      gst_amount: gstTotal,
      is_tax_overridden: isTaxOverridden ? 1 : 0,
      advance_tax_rate: appliedAdvanceTaxRate,
      advance_tax_basis: basis,
      advance_tax_amount: advanceTaxAmount,
      net_total: netInvoiceAmount,
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId ? parseInt(paymentAccountId, 10) : null,
      paid_amount: paid,
      balance_amount: round2(netInvoiceAmount - paid),
      remarks: notes,
      status: 'preview',
    } as unknown as PurchaseInvoice;
    setPrintMode('invoice');
    setPrintInvoice(previewInvoice);
    setPrintInvoiceItems(previewItems as PurchaseLineItem[]);
    setPrintJournalLines([]);
    setPrintModalOpen(true);
  };

  // Open A4 Print Modal for Purchase Invoice
  const handleOpenPrintInvoice = async (purId: number) => {
    try {
      const res = await api.getPurchaseDetails(purId);
      setPrintMode('invoice');
      setPrintInvoice(res.purchase);
      setPrintInvoiceItems(res.items || []);
      setPrintJournalLines(res.journalLines || []);
      setPrintModalOpen(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Export Purchase Invoices to Formatted Multi-Sheet Excel (.xlsx)
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);

  const handleOpenPurchaseOrderSms = async () => {
    setFormError(null);
    const syncedLines = lines.map((l, idx) => {
      const qtyInput =
        (document.getElementById(`pos_row_${idx}_quantity`) as HTMLInputElement | null) ||
        (document.getElementById(`pur_cell_${idx}_quantity`) as HTMLInputElement | null);
      const discInput =
        (document.getElementById(`pos_row_${idx}_discount_percent`) as HTMLInputElement | null) ||
        (document.getElementById(`pur_cell_${idx}_discount_percent`) as HTMLInputElement | null);

      const domQtyRaw = qtyInput?.value?.trim();
      const domDiscRaw = discInput?.value?.trim();
      const resolvedQty =
        domQtyRaw !== undefined && domQtyRaw !== '' && Number.isFinite(Number(domQtyRaw))
          ? Number(domQtyRaw)
          : Number(l.quantity || 0);
      const resolvedDisc =
        domDiscRaw !== undefined && domDiscRaw !== '' && Number.isFinite(Number(domDiscRaw))
          ? Number(domDiscRaw)
          : Number(l.discount_percent || 0);

      return {
        ...l,
        quantity: resolvedQty,
        discount_percent: resolvedDisc,
      };
    });

    const activePurchaseLines = syncedLines.filter(
      (l) =>
        Number(l.item_id || 0) > 0 ||
        Boolean(l.item_code?.trim()) ||
        Boolean(l.item_name?.trim())
    );
    if (activePurchaseLines.length === 0) {
      setFormError('Please add at least one item in the Purchase Invoice before clicking Send Order SMS.');
      itemSearchInputRef.current?.focus();
      return;
    }

    let resolvedStore = storeDisplayName || 'ABRAR MEDICAL STORE';
    try {
      const settingsRes = await api.getCompanySettings();
      if (settingsRes?.data?.store_name) {
        resolvedStore = String(settingsRes.data.store_name).trim() || 'ABRAR MEDICAL STORE';
        setStoreDisplayName(resolvedStore);
      }
    } catch {
      // Keep default ABRAR MEDICAL STORE
    }

    const preparedSms = generatePurchaseOrderSmsText(activePurchaseLines, resolvedStore);
    setPurchaseSmsText(preparedSms);
    setShowPurchaseSmsModal(true);
  };

  const [customExportOpen, setCustomExportOpen] = useState<boolean>(false);
  const [customExportRecords, setCustomExportRecords] = useState<Array<Record<string, any>>>([]);

  const buildCurrentPurchaseExportRecord = () => {
    if (validLines.length === 0) return null;
    const paid = round2(paidAmount);
    return {
      id: editingPurchaseId || 0,
      bill_number: billNumber,
      bill_date: billDate,
      supplier_account_id: supplierId ? parseInt(supplierId, 10) : 0,
      supplier_name: selectedSupplier?.account_name || 'Supplier Account',
      supplier_code: selectedSupplier?.account_code || '',
      supplier_invoice_number: supplierInvoiceNumber.trim() || billNumber,
      supplier_filer_status: supplierFilerStatus,
      gross_amount: grossTotal,
      gross_total: grossTotal,
      discount_amount: totalDiscount,
      total_discount: totalDiscount,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      taxable_amount: taxableAmount,
      gst_amount: gstTotal,
      is_tax_overridden: isTaxOverridden ? 1 : 0,
      advance_tax_rate: appliedAdvanceTaxRate,
      advance_tax_amount: advanceTaxAmount,
      net_total: netInvoiceAmount,
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId ? parseInt(paymentAccountId, 10) : null,
      paid_amount: paid,
      balance_amount: round2(netInvoiceAmount - paid),
      remarks: notes,
      status: editingPurchaseId ? 'completed' : 'draft',
      items: validLines.map((l, idx) => ({
        id: idx + 1,
        item_id: l.item_id,
        variant_id: l.variant_id || null,
        variant_code: l.variant_id ? (l.variant_code || null) : null,
        variant_name: l.variant_id ? (l.variant_name || null) : null,
        item_code: l.item_code,
        company_name: l.company_name,
        item_name: l.variant_name ? `${l.item_name} — ${l.variant_name}` : l.item_name,
        packing: l.packing,
        batch_number: l.batch_number?.trim() || `B-${l.item_code || l.item_id}-01`,
        expiry_date: l.expiry_date || '2028-12-31',
        quantity: Number(l.quantity) || 0,
        loose_quantity: Number(l.loose_quantity) || 0,
        bonus_quantity: Number(l.bonus_quantity) || 0,
        purchase_rate: Number(l.purchase_rate) || 0,
        loose_rate: Number(l.loose_rate) || 0,
        mrp_rate: Number(l.mrp_rate) || 0,
        discount_percent: Number(l.discount_percent) || 0,
        discount_amount: Number(l.discount_amount) || 0,
        taxable_amount: Number(l.taxable_amount) || 0,
        tax_percent: Number(l.tax_percent) || 0,
        tax_amount: Number(l.tax_amount) || 0,
        gross_amount: Number(l.gross_amount) || 0,
        line_total: Number(l.line_total) || 0,
        remarks: String(l.remarks || ''),
      })),
    };
  };

  const handleOpenCustomPurchaseExcelExport = async (forceAll?: boolean) => {
    try {
      setExportingExcel(true);
      setFormError(null);
      if (!forceAll) {
        const currentRecord = buildCurrentPurchaseExportRecord();
        if (currentRecord) {
          setCustomExportRecords([currentRecord]);
          setCustomExportOpen(true);
          return;
        }
      }
      const res = await api.getPurchases();
      const savedPurchases = res.purchases || purchases || [];
      setCustomExportRecords(savedPurchases);
      setCustomExportOpen(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportCurrentPurchaseToExcel = async () => {
    try {
      setExportingExcel(true);
      setFormError(null);
      const currentRecord = buildCurrentPurchaseExportRecord();
      if (currentRecord) {
        exportPurchaseInvoicesToExcel(
          [currentRecord],
          `Purchase_Invoice_${billNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        );
        setFormSuccess(`Exported Purchase Invoice ${billNumber} (${validLines.length} items) to Excel (.xlsx).`);
        return;
      }

      // If current form has no items yet, export all saved purchase invoices from the database
      const res = await api.getPurchases();
      const savedPurchases = res.purchases || purchases || [];
      if (savedPurchases.length === 0) {
        setFormError('No items in the current purchase invoice and no saved purchase invoices found to export.');
        return;
      }
      exportPurchaseInvoicesToExcel(savedPurchases, `Purchase_Invoices_${billDate}.xlsx`);
      setFormSuccess(`Exported ${savedPurchases.length} saved Purchase Invoice(s) with all line items to Excel (.xlsx).`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportAllPurchasesToExcel = async () => {
    try {
      setExportingExcel(true);
      setFormError(null);
      const res = await api.getPurchases();
      const savedPurchases = res.purchases || purchases || [];
      if (savedPurchases.length === 0) {
        setFormError('No saved purchase invoices found in the database to export.');
        return;
      }
      exportPurchaseInvoicesToExcel(savedPurchases, `Purchase_Invoices_All_${billDate}.xlsx`);
      setFormSuccess(`Exported ${savedPurchases.length} saved Purchase Invoice(s) with all line items to Excel (.xlsx).`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportSinglePurchaseToExcel = async (p: PurchaseInvoice) => {
    try {
      setExportingExcel(true);
      setFormError(null);
      const pWithItems = p as any;
      if (Array.isArray(pWithItems.items) && pWithItems.items.length > 0) {
        exportPurchaseInvoicesToExcel(
          [pWithItems],
          `Purchase_Invoice_${String(p.bill_number || p.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        );
      } else {
        const res = await api.getPurchaseDetails(p.id);
        const fullPurchase = {
          ...(res.purchase || p),
          items: res.items || [],
        };
        exportPurchaseInvoicesToExcel(
          [fullPurchase],
          `Purchase_Invoice_${String(p.bill_number || p.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`
        );
      }
      setFormSuccess(`Exported Purchase Invoice ${p.bill_number} to Excel (.xlsx).`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingExcel(false);
    }
  };

  // Open currently selected Purchase row item in Item Master (Edit Mode) via F9
  const handleOpenPurchaseItemMasterF9 = async () => {
    const rIdx = selectedPurchaseLineIndex;
    const row = lines[rIdx];
    if (!row || !row.item_id || Number(row.item_id) <= 0) {
      setFormError('Please select an item on the current row before pressing F9 to open Item Master.');
      return;
    }
    const activeEl = document.activeElement as HTMLElement | null;
    const fallbackFocusId =
      purchaseViewMode === 'pos'
        ? `pos_row_${rIdx}_quantity`
        : `pur_cell_${rIdx}_quantity`;
    const returnFocusId = activeEl?.id || fallbackFocusId;

    try {
      setFormError(null);
      let targetItem: Item | null = null;
      try {
        const res = await api.getItems({ q: row.item_code || row.item_name });
        const itemsArr: Item[] = Array.isArray((res as any)?.items)
          ? (res as any).items
          : Array.isArray((res as any)?.data)
          ? (res as any).data
          : [];
        const matched = itemsArr.find((it) => Number(it.id) === Number(row.item_id));
        if (matched && matched.id) {
          targetItem = matched;
        }
      } catch {
        // Fallback to local cached items list
      }
      if (!targetItem) {
        targetItem = items.find((it) => Number(it.id) === Number(row.item_id)) || null;
      }
      if (!targetItem) {
        setFormError('Selected item could not be found in Item Master.');
        return;
      }
      setF9ItemMasterState({
        isOpen: true,
        editingItem: targetItem,
        rowIndex: rIdx,
        returnFocusId,
      });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to load item into Item Master.');
    }
  };

  // Global Keyboard Shortcuts (F2 / Ctrl+S: Save, F3: Hold, F9: Item Master Edit, Ctrl+P: Save & Print, Ctrl+N: New)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (subTab !== 'new-invoice') return;
      if (
        priceChangePrompt ||
        showPurchaseItemListModal ||
        pendingDuplicatePrompt ||
        pendingVariantPicker ||
        itemLogModalState.isOpen ||
        f9ItemMasterState.isOpen ||
        netAmountModalState.isOpen ||
        showAddSupplierModal ||
        showPurchaseSmsModal ||
        printModalOpen
      ) {
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        setShowPurchaseCompactHistoryPopup(false);
        setActiveRowItemSearchIdx(null);
        handleOpenPurchaseItemMasterF9();
      } else if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        setShowPurchaseCompactHistoryPopup(false);
        handleSavePurchaseInvoice();
      } else if (e.key === 'F4') {
        e.preventDefault();
        handlePreviewInvoice();
      } else if (e.key === 'F3') {
        e.preventDefault();
        setShowPurchaseCompactHistoryPopup(false);
        handleSavePurchaseInvoice(undefined, false, 'held');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPurchaseCompactHistoryPopup(false);
        handleSavePurchaseInvoice(undefined, true, 'completed');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowPurchaseCompactHistoryPopup(false);
        resetInvoiceForm();
      } else if (e.key === 'Escape' && showPurchaseCompactHistoryPopup) {
        e.preventDefault();
        setShowPurchaseCompactHistoryPopup(false);
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
    subTab,
    billNumber,
    supplierId,
    validLines,
    lines,
    selectedPurchaseLineIndex,
    purchaseViewMode,
    items,
    isTaxOverridden,
    taxOverrideReason,
    supplierInvoiceNumber,
    billDate,
    priceChangePrompt,
    showPurchaseItemListModal,
    showPurchaseCompactHistoryPopup,
    pendingDuplicatePrompt,
    pendingVariantPicker,
    itemLogModalState.isOpen,
    f9ItemMasterState.isOpen,
    netAmountModalState.isOpen,
    showAddSupplierModal,
    showPurchaseSmsModal,
    printModalOpen,
  ]);

  // Open A4 Print Modal for Purchase Return
  const handleOpenPrintReturn = async (retId: number) => {
    try {
      const res = await api.getPurchaseReturnDetails(retId);
      setPrintMode('return');
      setPrintReturn(res.purchaseReturn);
      setPrintReturnItems(res.items || []);
      setPrintJournalLines(res.journalLines || []);
      setPrintModalOpen(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Load Purchase Invoice into Edit Form
  const handleEditPurchase = async (purId: number) => {
    isResumingPurchaseRef.current = true;
    try {
      const res: any = await api.getPurchaseDetails(purId);
      const p: PurchaseInvoice = res?.purchase || res?.data || res;
      if (!p || !p.id) {
        throw new Error('Purchase invoice could not be found in the active database.');
      }
      const pItems: PurchaseLineItem[] = Array.isArray(res?.items)
        ? res.items
        : Array.isArray((p as any)?.items)
        ? (p as any).items
        : [];

      try {
        localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
      } catch {
        // ignore
      }

      editingPurchaseIdRef.current = p.id;
      setEditingPurchaseId(p.id);
      setEditingPurchaseStatus(String(p.status || 'completed').trim().toLowerCase());
      setBillNumber(p.bill_number || '');
      setBillDate(p.bill_date || new Date().toISOString().slice(0, 10));
      setSupplierId(p.supplier_account_id ? String(p.supplier_account_id) : '');
      setSupplierInvoiceNumber(p.supplier_invoice_number || '');
      setSupplierFilerStatus(p.supplier_filer_status || 'Filer');
      setNotes(p.remarks || '');
      setInvoiceDiscountPercent(Number(p.invoice_discount_percent || 0));
      setInvoiceDiscountAmount(Number(p.invoice_discount_amount || 0));
      setIsTaxOverridden(Number(p.is_tax_overridden) === 1 || Boolean(p.is_tax_overridden));
      setCustomAdvanceTaxRate(Number(p.advance_tax_rate ?? 0.5));
      setTaxOverrideReason(p.tax_override_reason || '');
      setTaxOverrideAuthorizedBy(p.tax_override_authorized_by || 'Chief Pharmacist / Admin');
      setPaymentMode(p.payment_mode || 'Credit');
      setPaymentAccountId(p.payment_account_id ? String(p.payment_account_id) : '');
      setPaidAmount(Math.max(0, Number(p.paid_amount ?? 0)));
      setPaidAmountManuallyEdited(true);
      const normalizedItems: PurchaseLineItem[] = pItems.map((it: any) => {
        const upp = Math.max(1, Number(it.units_per_pack || parseUnitsPerPack(it.packing)));
        const pRate = Number(it.purchase_rate || 0);
        const lRate =
          it.loose_rate !== undefined && Number(it.loose_rate) > 0
            ? Number(it.loose_rate)
            : round2(pRate / upp);
        return {
          ...it,
          item_id: Number(it.item_id || 0),
          variant_id: it.variant_id ? Number(it.variant_id) : null,
          variant_code: it.variant_id ? (it.variant_code || '') : '',
          variant_name: it.variant_id ? (it.variant_name || '') : '',
          thumbnail_url: it.effective_thumbnail_url || it.thumbnail_url || null,
          units_per_pack: upp,
          quantity: Number(it.quantity || 0),
          loose_quantity: Number(it.loose_quantity || 0),
          bonus_quantity: Number(it.bonus_quantity || 0),
          purchase_rate: pRate,
          loose_rate: lRate,
          mrp_rate: Number(it.mrp_rate || 0),
          gross_amount: Number(it.gross_amount || 0),
          discount_percent: Number(it.discount_percent || 0),
          discount_amount: Number(it.discount_amount || 0),
          taxable_amount: Number(it.taxable_amount || 0),
          tax_percent: Number(it.tax_percent || 0),
          tax_amount: Number(it.tax_amount || 0),
          line_total: Number(it.line_total || 0),
          remarks: String(it.remarks || ''),
        };
      });
      setLines(ensureMinimumPurchaseRows(normalizedItems, visibleRowCapacityRef.current, 0));
      setSelectedPurchaseLineIndex(0);
      setSubTab('new-invoice');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      isResumingPurchaseRef.current = false;
    }
  };

  useEffect(() => {
    if (resumePurchaseId && resumePurchaseId > 0) {
      handleEditPurchase(resumePurchaseId);
      onClearResume?.();
    }
  }, [resumePurchaseId]);

  // Cancel Purchase Invoice with Reversal Entries
  const handleCancelPurchase = async (pur: PurchaseInvoice) => {
    try {
      setFormError(null);
      const res = await api.cancelPurchase(
        pur.id,
        `Cancelled Invoice ${pur.bill_number} with full stock & double-entry reversal`
      );
      setFormSuccess(res.message);
      await fetchWorkspaceData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const navItems: Array<{ id: PurchaseSubTab; label: string; icon: React.ElementType }> = [
    {
      id: 'new-invoice',
      label: editingPurchaseId ? `Editing ${billNumber}` : '1. Purchase Invoice',
      icon: ShoppingBag,
    },
    {
      id: 'register',
      label: `2. Purchase Register (${purchases.length})`,
      icon: ListChecks,
    },
    {
      id: 'purchase-return',
      label: `3. Purchase Return (${returns.length})`,
      icon: ArrowDownLeft,
    },
    {
      id: 'batch-stock',
      label: `4. Batch Stock (${batches.length})`,
      icon: Boxes,
    },
    {
      id: 'advance-tax',
      label: '5. Advance Tax Settings',
      icon: Sliders,
    },
    {
      id: 'reports',
      label: '6. Purchase Reports (8)',
      icon: FileSpreadsheet,
    },
  ];

  // Active Row in 20-Row Grid
  const activePurchaseRow = lines[selectedPurchaseLineIndex] || lines[0];

  // Shared Searchable Supplier Dropdown Popover Renderer (Used in Both POS & MS Access View)
  const renderSupplierDropdownMenu = () => {
    if (!isSupplierDropdownOpen) return null;
    return (
      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white text-slate-900 rounded-lg border border-slate-300 shadow-2xl overflow-hidden min-w-[340px]">
        <div className="px-2.5 py-1 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
          <span>Matching Suppliers ({filteredSuppliers.length})</span>
          <span className="text-emerald-300 font-mono">↑/↓ Navigate • Enter or Click to Select</span>
        </div>
        <div ref={supplierListRef} className="max-h-60 overflow-y-auto divide-y divide-slate-100">
          {filteredSuppliers.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500 space-y-2">
              <div>No supplier found matching "{supplierSearchQuery}".</div>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleOpenAddSupplierModal(supplierSearchQuery);
                }}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Add New Supplier "{supplierSearchQuery.trim()}"</span>
              </button>
            </div>
          ) : (
            filteredSuppliers.map((s, sIdx) => {
              const isHighlighted = sIdx === supplierHighlightIndex;
              const isCurrent = String(s.id) === String(supplierId);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-sup-idx={sIdx}
                  onMouseEnter={() => setSupplierHighlightIndex(sIdx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSupplierFromDropdown(s);
                  }}
                  className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-xs cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
                    isHighlighted
                      ? 'bg-sky-700 text-white font-semibold'
                      : isCurrent
                      ? 'bg-emerald-100 text-emerald-950 font-semibold border-l-4 border-emerald-600'
                      : 'hover:bg-sky-100 text-slate-900'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div
                      className={`font-bold flex items-center gap-1.5 flex-wrap ${
                        isHighlighted ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      <span
                        className={`font-mono px-1.5 py-0 rounded-lg border text-[11px] ${
                          isHighlighted
                            ? 'bg-sky-900 text-amber-200 border-sky-400'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {s.account_code}
                      </span>
                      <span className="truncate">{s.account_name}</span>
                    </div>
                    <div
                      className={`text-[10px] flex items-center gap-2 mt-0.5 font-mono ${
                        isHighlighted ? 'text-sky-100' : 'text-slate-600'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Phone
                          className={`w-2.5 h-2.5 ${isHighlighted ? 'text-sky-200' : 'text-slate-400'}`}
                        />
                        {s.phone || (s as any).mobile || 'No Mobile #'}
                      </span>
                      {s.city && <span>• {s.city}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded-lg text-[9px] font-bold uppercase ${
                        isHighlighted
                          ? 'bg-sky-900 text-sky-100 border border-sky-400'
                          : s.filer_status === 'Filer'
                          ? 'bg-emerald-100 text-emerald-800'
                          : s.filer_status === 'Non-Filer'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {s.filer_status || 'Filer'}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="p-1.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Need a new supplier account?</span>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleOpenAddSupplierModal();
            }}
            className="px-2.5 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
          >
            <UserPlus className="w-3 h-3 text-emerald-400" />
            <span>+ Add New Supplier</span>
          </button>
        </div>
      </div>
    );
  };

  // Excel-Style Item Search Results Dropdown Table (Top Search Bar)
  // Columns: Item Name | Company Name | Purchase Price | Sale Price
  const renderTopItemSearchDropdown = () => {
    if (!showPurchaseSearchDropdown) return null;
    return (
      <div className="absolute right-0 top-full mt-1 z-[100] w-[640px] max-w-[92vw] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl overflow-hidden">
        <div className="px-3 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center">
          <span>
            Matching Items ({purchaseSearchResults.length}) • Search by Item Name, Company, Code or Barcode
          </span>
          <span className="font-mono text-sky-700">
            ↑/↓ Navigate • Enter Select • Esc Close
          </span>
        </div>
        <div ref={itemListRef} className="max-h-[340px] overflow-y-auto">
          {purchaseSearchResults.length === 0 ? (
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
                {purchaseSearchResults.map((it, idx) => {
                  const isHighlighted = idx === itemHighlightIndex;
                  const activeLine = lines[selectedPurchaseLineIndex];
                  const isCurrentItem = Boolean(activeLine?.item_id && Number(activeLine.item_id) === Number(it.id));
                  const purRate =
                    Number(it.purchase_price) ||
                    Number(it.trade_price) ||
                    Number(it.retail_price) ||
                    0;
                  const saleRate = Number(it.retail_price || 0);
                  return (
                    <tr
                      key={it.id}
                      data-item-idx={idx}
                      tabIndex={-1}
                      onMouseEnter={() => setItemHighlightIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectPurchaseSearchItem(it);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
                        isHighlighted
                          ? 'bg-sky-700 text-white font-semibold'
                          : isCurrentItem
                          ? 'bg-emerald-100 text-emerald-950 font-semibold border-l-4 border-emerald-600'
                          : 'hover:bg-sky-100 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1 border-r border-slate-200">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ProductThumb
                            src={it.thumbnail_url || it.image_url}
                            alt={it.item_name}
                            size="xs"
                          />
                          <div className="truncate">
                            <span
                              className={`font-mono text-[10px] font-bold mr-1 ${
                                isHighlighted ? 'text-amber-200' : 'text-emerald-700'
                              }`}
                            >
                              [{it.item_code}]
                            </span>
                            <span
                              className={`font-bold ${
                                isHighlighted ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {it.item_name}
                            </span>
                            <span
                              className={`text-[10px] ml-1 ${
                                isHighlighted ? 'text-sky-100' : 'text-slate-500'
                              }`}
                            >
                              ({it.packing})
                            </span>
                            {Number(it.has_variants || 0) === 1 && (
                              <span
                                className={`ml-1.5 px-1 py-0 rounded border text-[9px] font-bold ${
                                  isHighlighted
                                    ? 'bg-sky-900 text-amber-200 border-sky-400'
                                    : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                }`}
                              >
                                {Number(it.active_variant_count || it.variants?.length || 0)} Variants
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td
                        className={`px-2.5 py-1 border-r border-slate-200 ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        {it.company_name || '—'}
                      </td>
                      <td
                        className={`px-2.5 py-1 border-r border-slate-200 text-right font-mono font-black ${
                          isHighlighted ? 'text-amber-200' : 'text-emerald-800'
                        }`}
                      >
                        Rs. {purRate.toFixed(2)}
                      </td>
                      <td
                        className={`px-2.5 py-1 text-right font-mono font-semibold ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        Rs. {saleRate.toFixed(2)}
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

  // Excel-Style Item Search Combobox for Datasheet Row Cells (Item Code & Item Name)
  const renderRowItemSearchCombobox = (rowIdx: number, fromPosRow: boolean) => {
    if (!ROW_SUGGESTIONS_ENABLED || activeRowItemSearchIdx !== rowIdx) return null;
    return (
      <div className="absolute left-0 top-full mt-0.5 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl min-w-[580px] max-w-[720px] overflow-hidden">
        <div className="px-2.5 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center">
          <span>
            Matching Items ({rowItemSearchResults.length}) • Search by Name, Company, Code or Barcode
          </span>
          <span className="font-mono text-sky-700">↑/↓ Navigate • Enter Select • Esc Close</span>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {rowItemSearchResults.length === 0 ? (
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
                {rowItemSearchResults.map((it, iIdx) => {
                  const isHighlighted = iIdx === rowItemHighlightIndex;
                  const rowLine = lines[rowIdx];
                  const isCurrentItem = Boolean(rowLine?.item_id && Number(rowLine.item_id) === Number(it.id));
                  const purRate =
                    Number(it.purchase_price) ||
                    Number(it.trade_price) ||
                    Number(it.retail_price) ||
                    0;
                  const saleRate = Number(it.retail_price || 0);
                  return (
                    <tr
                      key={it.id}
                      data-row-item-idx={`${rowIdx}-${iIdx}`}
                      tabIndex={-1}
                      onMouseEnter={() => setRowItemHighlightIndex(iIdx)}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        populatePurchaseRowWithItem(rowIdx, it, true);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
                        isHighlighted
                          ? 'bg-sky-700 font-semibold text-white'
                          : isCurrentItem
                          ? 'bg-emerald-100 text-emerald-950 font-semibold border-l-4 border-emerald-600'
                          : 'hover:bg-sky-100 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1 border-r border-slate-200">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ProductThumb
                            src={it.thumbnail_url || it.image_url}
                            alt={it.item_name}
                            size="xs"
                          />
                          <div className="truncate">
                            <span
                              className={`font-mono text-[10px] font-bold mr-1 ${
                                isHighlighted ? 'text-amber-200' : 'text-emerald-700'
                              }`}
                            >
                              [{it.item_code}]
                            </span>
                            <span
                              className={`font-bold ${
                                isHighlighted ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {it.item_name}
                            </span>
                            <span
                              className={`text-[10px] ml-1 ${
                                isHighlighted ? 'text-sky-100' : 'text-slate-500'
                              }`}
                            >
                              ({it.packing})
                            </span>
                            {Number(it.has_variants || 0) === 1 && (
                              <span
                                className={`ml-1.5 px-1 py-0 rounded border text-[9px] font-bold ${
                                  isHighlighted
                                    ? 'bg-sky-900 text-amber-200 border-sky-400'
                                    : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                }`}
                              >
                                {Number(it.active_variant_count || it.variants?.length || 0)} Variants
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td
                        className={`px-2.5 py-1 border-r border-slate-200 truncate max-w-[160px] ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        {it.company_name || '—'}
                      </td>
                      <td
                        className={`px-2.5 py-1 border-r border-slate-200 text-right font-mono font-black ${
                          isHighlighted ? 'text-amber-200' : 'text-emerald-800'
                        }`}
                      >
                        Rs. {purRate.toFixed(2)}
                      </td>
                      <td
                        className={`px-2.5 py-1 text-right font-mono font-semibold ${
                          isHighlighted ? 'text-sky-100' : 'text-slate-700'
                        }`}
                      >
                        Rs. {saleRate.toFixed(2)}
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

  return (
    <div
      className={`ams-readable-invoice-scope w-full h-full ${
        subTab === 'new-invoice'
          ? 'flex-1 flex flex-col min-h-0 overflow-hidden px-1.5 py-1 bg-slate-100'
          : 'flex-1 min-h-0 overflow-y-auto p-2 space-y-3 bg-slate-100'
      }`}
    >
      {/* Top Full-Screen Header & Sub-Navigation Bar */}
      <div
        className={`bg-slate-900 text-white border border-slate-700 shadow-xs flex flex-wrap items-center justify-between gap-1.5 shrink-0 print:hidden ${
          subTab === 'new-invoice'
            ? 'ams-pos-compact-chrome px-2 py-0.5 rounded-md mb-1'
            : 'px-3 py-2 rounded-xl'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1 cursor-pointer"
              title="Return to Previous Dashboard / Menu"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          )}
          {navItems.map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`rounded font-bold flex items-center gap-1 transition-all cursor-pointer px-2 py-0.5 ${
                  active
                    ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Inline Two Independent Invoice Interfaces Selector & Excel Export Actions */}
        <div className="flex flex-wrap items-center gap-1">
          {subTab === 'new-invoice' && (
            <div className="inline-flex items-center gap-1 bg-slate-800 text-white p-0.5 rounded border border-slate-700">
              <button
                type="button"
                onClick={() => togglePurchaseViewMode('pos')}
                className={`px-2 py-0 rounded font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  purchaseViewMode === 'pos'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
                title="Switch to POS Purchase Interface"
              >
                <ShoppingBag className="w-3 h-3" />
                <span>1. POS View</span>
              </button>
              <button
                type="button"
                onClick={() => togglePurchaseViewMode('access')}
                className={`px-2 py-0 rounded font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  purchaseViewMode === 'access'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
                title="Switch to Microsoft Access Datasheet Form"
              >
                <FileSpreadsheet className="w-3 h-3" />
                <span>2. MS Access View</span>
              </button>
              <span className="bg-slate-900 px-1.5 py-0 rounded text-emerald-400 font-mono font-bold">
                {validLines.length} Items
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportCurrentPurchaseToExcel}
            className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Export Current Purchase Invoice to Excel (.xlsx)"
          >
            <Download className="w-3 h-3" />
            <span>{exportingExcel ? 'Exporting...' : 'Excel'}</span>
          </button>

          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportAllPurchasesToExcel}
            className="px-2 py-0.5 rounded bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Export All Saved Purchase Invoices to Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3 h-3" />
            <span>All Excel</span>
          </button>

          <button
            type="button"
            disabled={exportingExcel}
            onClick={() => handleOpenCustomPurchaseExcelExport(false)}
            className="px-2 py-0.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Purchase Invoice → Custom Excel Export (Choose Fields & Saved Templates)"
          >
            <FileSpreadsheet className="w-3 h-3" />
            <span>Custom Excel Export</span>
          </button>

          {subTab === 'new-invoice' && (
            <button
              type="button"
              onClick={handleOpenPurchaseOrderSms}
              className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              title="Send Order SMS for Current Purchase Invoice"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Order SMS</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchWorkspaceData}
            className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 cursor-pointer"
            title="Refresh Purchase & Inventory Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white border border-slate-600 font-bold flex items-center gap-1 cursor-pointer"
              title="Close Purchase Invoice and Return to Dashboard"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Banners */}
      {formError && (
        <div className="px-2.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between shrink-0 mb-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span>{formError}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormError(null)}
            className="text-rose-600 hover:text-rose-900 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {formSuccess && (
        <div className="px-2.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between shrink-0 mb-0.5">
          <div className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{formSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: NEW / EDIT PURCHASE INVOICE SCREEN */}
      {subTab === 'new-invoice' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* ================= OPTION 1: POS INTERFACE (THREE-SECTION MS ACCESS LAYOUT) ================= */}
          {purchaseViewMode === 'pos' && (
            <form
              onSubmit={(e) => handleSavePurchaseInvoice(e, false)}
              className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden"
            >
              {/* SECTION A (TOP): COMPACT PURCHASE HEADER */}
              <div className="ams-pos-compact-chrome bg-white rounded-md border border-slate-300 shadow-xs px-2.5 py-1 space-y-1 shrink-0">
                {/* Header Row 1: Bill #, Date, Supplier Inv, Filer, Mode & Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                  <div className="md:col-span-5 flex flex-wrap items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-black uppercase">
                      PURCHASE POS
                    </span>
                    <span className="font-mono font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300">
                      {billNumber}
                    </span>
                    {editingPurchaseId && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                        EDIT #{editingPurchaseId}
                      </span>
                    )}
                    <input
                      type="date"
                      required
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      className="px-1.5 py-0 font-mono font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded outline-none cursor-pointer"
                      title="Purchase Bill Date"
                    />
                    <input
                      type="text"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="Sup. Inv #"
                      className="w-24 px-1.5 py-0 font-mono font-semibold rounded border border-slate-300 bg-white"
                      title="Supplier Invoice / Bill Number"
                    />
                  </div>

                  <div className="md:col-span-7 flex flex-wrap items-center justify-end gap-1">
                    <select
                      value={supplierFilerStatus}
                      onChange={(e) => setSupplierFilerStatus(e.target.value as FilerStatus)}
                      className="px-1.5 py-0 font-bold rounded border border-slate-300 bg-slate-50 text-slate-900"
                      title="Supplier FBR Filer Status"
                    >
                      <option value="Filer">Filer ({taxSettings?.filer_rate ?? 0.5}%)</option>
                      <option value="Non-Filer">Non-Filer ({taxSettings?.non_filer_rate ?? 2.5}%)</option>
                      <option value="Exempt">Exempt (0%)</option>
                    </select>
                    <select
                      value={paymentMode}
                      onChange={(e) => {
                        const nextMode = e.target.value as PurchasePaymentMode;
                        setPaymentMode(nextMode);
                        if (nextMode === 'Cash') {
                          setPaidAmount(0);
                          setPaidAmountManuallyEdited(true);
                        } else {
                          setPaidAmountManuallyEdited(false);
                        }
                      }}
                      className="px-1.5 py-0 font-bold rounded border border-slate-300 bg-white text-slate-900"
                      title="Payment Mode"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Credit">Credit</option>
                      <option value="Bank">Bank</option>
                      <option value="Partial">Partial</option>
                    </select>
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-1.5 py-0 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-bold flex items-center gap-0.5 cursor-pointer"
                      title="New Purchase Invoice (Ctrl+N)"
                    >
                      <Plus className="w-3 h-3 text-emerald-600" />
                      <span>New</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="px-1.5 py-0 rounded bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Preview A4 Invoice (F4)"
                    >
                      <Printer className="w-3 h-3 text-blue-700" />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="px-1.5 py-0 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                      title="Hold Invoice (F3)"
                    >
                      <PauseCircle className="w-3 h-3 text-amber-700" />
                      <span>Hold</span>
                    </button>
                    <button
                      type="button"
                      onClick={openHeldPurchasesModal}
                      className="px-1.5 py-0 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Held Drafts"
                    >
                      <Clock className="w-3 h-3 text-indigo-700" />
                      <span>Held ({heldPurchases.length})</span>
                    </button>
                    {purchases.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenPrintInvoice(purchases[0].id)}
                        className="px-1.5 py-0 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-bold flex items-center gap-0.5 cursor-pointer"
                        title="Reprint Last Purchase Invoice"
                      >
                        <Printer className="w-3 h-3 text-blue-700" />
                        <span>Reprint</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Header Row 2: Supplier Search, Live Previous Balance & Compact F3 Item Search */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-1.5 pt-1 border-t border-slate-200 items-center">
                  {/* Searchable Supplier Input + Add New Supplier */}
                  <div
                    ref={purchaseViewMode === 'pos' ? supplierDropdownContainerRef : undefined}
                    className="md:col-span-5 flex items-center gap-1 relative"
                  >
                    <label className="font-bold text-slate-600 shrink-0">Supplier:</label>
                    <div className="relative flex-1">
                      <Search className="w-3 h-3 text-slate-400 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={purchaseViewMode === 'pos' ? supplierSearchInputRef : undefined}
                        type="text"
                        value={supplierSearchQuery}
                        onFocus={() => {
                          setIsSupplierDropdownOpen(false);
                        }}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSupplierSearchQuery(value);
                          setIsSupplierDropdownOpen(value.trim().length > 0);
                          setSupplierHighlightIndex(0);
                        }}
                        onKeyDown={handleSupplierSearchKeyDown}
                        placeholder="Search Supplier Name, Code or Mobile #..."
                        className="w-full pl-6 pr-10 py-0 font-bold rounded border border-emerald-500 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                      />
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        {supplierSearchQuery && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSupplierSearchQuery('');
                              setIsSupplierDropdownOpen(true);
                              setSupplierHighlightIndex(0);
                              supplierSearchInputRef.current?.focus();
                            }}
                            className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                            title="Clear search text"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setIsSupplierDropdownOpen((prev) => !prev);
                            setSupplierHighlightIndex(0);
                            supplierSearchInputRef.current?.focus();
                          }}
                          className="p-0.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                          title="Open Supplier List"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAddSupplierModal()}
                      className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                      title="Add New Supplier"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>+New</span>
                    </button>

                    {renderSupplierDropdownMenu()}
                  </div>

                  {/* Live Supplier Previous Balance Pill */}
                  <div className="md:col-span-3 bg-slate-900 text-white rounded px-2 py-0.5 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 truncate">
                      <span className="text-slate-400 shrink-0">Prev:</span>
                      <span
                        className={`font-mono font-bold truncate ${
                          previousSupplierBalance > 0
                            ? 'text-amber-300'
                            : previousSupplierBalance < 0
                            ? 'text-emerald-300'
                            : 'text-slate-300'
                        }`}
                      >
                        {formatPKR(Math.abs(previousSupplierBalance))} ({previousBalanceType})
                      </span>
                    </div>
                    {selectedSupplier && (
                      <button
                        type="button"
                        onClick={handleOpenSupplierLedger}
                        className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                        title="Open Detailed Supplier Ledger"
                      >
                        <Scale className="w-2.5 h-2.5" />
                        <span>Ledger</span>
                      </button>
                    )}
                  </div>

                  {/* Compact F3 Quick Barcode / Item Add inside Header */}
                  <div
                    ref={purchaseViewMode === 'pos' ? itemDropdownContainerRef : undefined}
                    className="md:col-span-4 relative flex items-center gap-1"
                  >
                    <div className="relative flex-1">
                      <Barcode className="w-3.5 h-3.5 text-emerald-600 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="pos_purchase_item_search_input"
                        ref={purchaseViewMode === 'pos' ? itemSearchInputRef : undefined}
                        type="text"
                        value={purchaseSearchQuery}
                        onFocus={() => {
                          if (purchaseSearchQuery.trim().length > 0) {
                            setShowPurchaseSearchDropdown(true);
                          }
                          setItemHighlightIndex(0);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowPurchaseSearchDropdown(false);
                          }, 160);
                        }}
                        onChange={(e) => {
                          const q = e.target.value;
                          setPurchaseSearchQuery(q);
                          setItemHighlightIndex(0);
                          setShowPurchaseSearchDropdown(q.trim().length > 0);
                        }}
                        onKeyDown={handleItemSearchKeyDown}
                        placeholder="Barcode / Quick Search..."
                        className="w-full pl-6 pr-6 py-0 rounded border border-slate-300 bg-slate-50 focus:bg-white focus:border-emerald-600 outline-none"
                      />
                      {purchaseSearchQuery && (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPurchaseSearchQuery('');
                            setItemHighlightIndex(0);
                            setShowPurchaseSearchDropdown(false);
                            itemSearchInputRef.current?.focus();
                          }}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {renderTopItemSearchDropdown()}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openPurchaseItemListForRow(
                          lines[selectedPurchaseLineIndex]?.item_id
                            ? null
                            : selectedPurchaseLineIndex,
                          'pos_row'
                        )
                      }
                      className="px-2 py-0 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold flex items-center gap-1 cursor-pointer shrink-0"
                      title="Open Item List (F2)"
                    >
                      <PackageSearch className="w-3 h-3 text-emerald-400" />
                      <span>Items</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION B (CENTER): PURCHASE INVOICE ITEM GRID ONLY (MIN 10 VISIBLE ROWS, STICKY HEADERS) */}
              <div className="ams-pos-item-grid-card bg-white rounded-md border border-slate-300 shadow-xs overflow-hidden flex flex-col flex-1 min-h-[356px] relative z-10">
                <div
                  ref={posGridViewportRef}
                  className="ams-pos-item-grid-scroll flex-1 min-h-[322px] overflow-y-auto overflow-x-auto relative bg-white"
                >
                  <table className="ams-compact-10-grid w-full min-w-[1680px] text-left text-[11px] border-collapse leading-none">
                    <thead className="sticky top-0 z-20 bg-slate-200 border-b-2 border-slate-300 text-slate-800 text-[10px] font-bold uppercase tracking-wider leading-none shadow-sm">
                      <tr className="h-7">
                        <th className="py-1 px-2 w-8 text-center border-r border-slate-300 h-7">#</th>
                        <th className="py-1 px-2 w-28 border-r border-slate-300 h-7">Item Code</th>
                        <th className="py-1 px-2 min-w-[240px] border-r border-slate-300 h-7">Item Name</th>
                        <th className="py-1 px-2 w-20 text-right border-r border-slate-300 h-7">Qty</th>
                        <th className="py-1 px-2 w-20 text-right border-r border-slate-300 h-7">Discount</th>
                        <th className="py-1 px-2 w-20 text-right border-r border-slate-300 h-7">Bonus</th>
                        <th className="py-1 px-2 w-24 text-right border-r border-slate-300 h-7">Gross Amount</th>
                        <th className="py-1 px-2 w-24 text-right border-r border-slate-300 h-7">Net Amount</th>
                        <th className="py-1 px-2 w-20 text-center border-r border-slate-300 h-7">Packing</th>
                        <th className="py-1 px-2 w-56 border-r border-slate-300 h-7">Batch/Expiry</th>
                        <th className="py-1 px-2 w-28 text-right border-r border-slate-300 h-7">Purchase Rate</th>
                        <th className="py-1 px-2 w-24 text-right border-r border-slate-300 h-7">MRP</th>
                        <th className="py-1 px-2 w-20 text-right border-r border-slate-300 h-7">GST</th>
                        <th className="py-1 px-2 w-24 text-right border-r border-slate-300 h-7">Taxable</th>
                        <th className="py-1 px-2 w-28 text-right border-r border-slate-300 h-7">Line Total</th>
                        <th className="py-1 px-2 w-32 text-left border-r border-slate-300 h-7">Remarks</th>
                        <th className="py-1 px-2 w-10 text-center h-7"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {lines.map((line, rIdx) => {
                        if (isGhostRow(rIdx)) {
                          return (
                            <tr key={rIdx} className="h-[16px] border-b border-slate-200 bg-slate-50/40 select-none">
                              <td className="py-0 px-1 text-center font-mono text-slate-300 text-[10px] h-[16px] align-middle">
                                {rIdx + 1}
                              </td>
                              <td colSpan={16} />
                            </tr>
                          );
                        }
                        const isSelected = rIdx === selectedPurchaseLineIndex;
                        const isActiveSearchMatch = purchaseSearchActiveRow === rIdx;
                        const isSearchMatch = purchaseSearchMatchedRows.includes(rIdx);
                        const hasItem = Boolean(line.item_id && Number(line.item_id) > 0);
                        const isZeroQty = hasItem && Number(line.quantity || 0) === 0;
                        const isZeroNet = hasItem && round2(Number(line.taxable_amount || 0)) === 0;
                        const isZeroRow = isZeroQty || isZeroNet;

                        return (
                          <tr
                            key={rIdx}
                            data-purchase-row-idx={rIdx}
                            data-zero-qty={isZeroQty ? 'true' : 'false'}
                            data-zero-net={isZeroNet ? 'true' : 'false'}
                            onClick={() => setSelectedPurchaseLineIndex(rIdx)}
                            className={`cursor-pointer transition-colors h-[16px] leading-none ${
                              isActiveSearchMatch
                                ? 'bg-amber-200/80 ring-2 ring-inset ring-amber-500 font-semibold'
                                : isSearchMatch
                                ? 'bg-sky-100/80 font-medium'
                                : isZeroRow
                                ? 'bg-orange-50/90 hover:bg-orange-100/75'
                                : isSelected
                                ? 'bg-emerald-50/90 font-medium'
                                : rIdx % 2 === 0
                                ? 'bg-white hover:bg-slate-50'
                                : 'bg-slate-50/50 hover:bg-slate-100/60'
                            }`}
                          >
                            <td className="py-0 px-1 text-center font-mono text-slate-500 text-[10px] h-[16px] align-middle">
                              {rIdx + 1}
                            </td>
                            <td className="p-0 h-[16px] align-middle relative">
                              <input
                                id={`pos_row_${rIdx}_item_code`}
                                type="text"
                                value={
                                  activeRowItemSearchIdx === rIdx &&
                                  activeRowItemSearchField === 'item_code'
                                    ? rowItemSearchQuery
                                    : line.item_code
                                }
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(rIdx);
                                  if (
                                    activeRowItemSearchIdx !== rIdx ||
                                    activeRowItemSearchField !== 'item_code'
                                  ) {
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === rIdx ? null : prev
                                    );
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(rIdx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchField(v.trim().length > 0 ? 'item_code' : null);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? rIdx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && (activeRowItemSearchIdx === rIdx || showPurchaseCompactHistoryPopup)) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                    setShowPurchaseCompactHistoryPopup(false);
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === rIdx &&
                                    activeRowItemSearchField === 'item_code' &&
                                    rowItemSearchResults.length > 0
                                  ) {
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setRowItemHighlightIndex((prev) => {
                                        const next = Math.min(
                                          prev + 1,
                                          rowItemSearchResults.length - 1
                                        );
                                        setTimeout(() => {
                                          document
                                            .querySelector(`[data-row-item-idx="${rIdx}-${next}"]`)
                                            ?.scrollIntoView({ block: 'nearest' });
                                        }, 0);
                                        return next;
                                      });
                                      return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setRowItemHighlightIndex((prev) => {
                                        const next = Math.max(0, prev - 1);
                                        setTimeout(() => {
                                          document
                                            .querySelector(`[data-row-item-idx="${rIdx}-${next}"]`)
                                            ?.scrollIntoView({ block: 'nearest' });
                                        }, 0);
                                        return next;
                                      });
                                      return;
                                    }
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const chosen =
                                        rowItemSearchResults[rowItemHighlightIndex] ||
                                        rowItemSearchResults[0];
                                      if (chosen) {
                                        populatePurchaseRowWithItem(rIdx, chosen, true);
                                      }
                                      return;
                                    }
                                  }
                                  handlePurchaseCellKeyDown(e, rIdx, 'item_code', 'pos_row');
                                }}
                                placeholder="Code..."
                                className="w-full px-1 py-0 font-mono font-bold text-[11px] text-emerald-800 bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-[15px] leading-none outline-none"
                              />
                            </td>
                            <td className="p-0 h-[16px] align-middle relative min-w-[200px]">
                              <div className="flex items-center gap-1 h-[15px] px-0.5">
                                {line.item_id > 0 && line.thumbnail_url && (
                                  <ProductThumb
                                    src={line.thumbnail_url}
                                    alt={line.item_name}
                                    size="xs"
                                    className="!w-3.5 !h-3.5 !rounded-xs border-0 shrink-0"
                                  />
                                )}
                                <input
                                  id={`pos_row_${rIdx}_item_name`}
                                  type="text"
                                  value={
                                    activeRowItemSearchIdx === rIdx &&
                                    activeRowItemSearchField === 'item_name'
                                      ? rowItemSearchQuery
                                      : line.item_name
                                      ? `${line.item_name}${line.company_name ? ` (${line.company_name})` : ''}`
                                      : ''
                                  }
                                  onFocus={() => {
                                    setSelectedPurchaseLineIndex(rIdx);
                                    if (
                                      activeRowItemSearchIdx !== rIdx ||
                                      activeRowItemSearchField !== 'item_name'
                                    ) {
                                      setActiveRowItemSearchIdx(null);
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                    }
                                    if (line.item_code || line.item_id) {
                                      fetchPurchaseItemHistoryByCode(
                                        line.item_code,
                                        Number(line.item_id || 0),
                                        line.variant_id || null
                                      );
                                    }
                                  }}
                                  onDoubleClick={(e) => {
                                    if (!line.item_id) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                    setItemLogModalState({
                                      isOpen: true,
                                      itemId: Number(line.item_id),
                                      itemCode: line.item_code,
                                      itemName: line.item_name,
                                      returnFocusId: `pos_row_${rIdx}_item_name`,
                                    });
                                  }}
                                  title={line.item_id ? `${line.item_name}${line.variant_name ? ` — ${line.variant_name}` : ''} — Double-click to open Complete ITEM LOG` : 'Type Item Name or Code'}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setActiveRowItemSearchIdx((prev) =>
                                        prev === rIdx ? null : prev
                                      );
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                    }, 180);
                                  }}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSelectedPurchaseLineIndex(rIdx);
                                    setRowItemSearchQuery(v);
                                    setRowItemHighlightIndex(0);
                                    setActiveRowItemSearchField(v.trim().length > 0 ? 'item_name' : null);
                                    setActiveRowItemSearchIdx(v.trim().length > 0 ? rIdx : null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape' && activeRowItemSearchIdx === rIdx) {
                                      e.preventDefault();
                                      setActiveRowItemSearchIdx(null);
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                      return;
                                    }
                                    if (
                                      activeRowItemSearchIdx === rIdx &&
                                      activeRowItemSearchField === 'item_name' &&
                                      rowItemSearchResults.length > 0
                                    ) {
                                      if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setRowItemHighlightIndex((prev) => {
                                          const next = Math.min(
                                            prev + 1,
                                            rowItemSearchResults.length - 1
                                          );
                                          setTimeout(() => {
                                            document
                                              .querySelector(`[data-row-item-idx="${rIdx}-${next}"]`)
                                              ?.scrollIntoView({ block: 'nearest' });
                                          }, 0);
                                          return next;
                                        });
                                        return;
                                      }
                                      if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setRowItemHighlightIndex((prev) => {
                                          const next = Math.max(0, prev - 1);
                                          setTimeout(() => {
                                            document
                                              .querySelector(`[data-row-item-idx="${rIdx}-${next}"]`)
                                              ?.scrollIntoView({ block: 'nearest' });
                                          }, 0);
                                          return next;
                                        });
                                        return;
                                      }
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const chosen =
                                          rowItemSearchResults[rowItemHighlightIndex] ||
                                          rowItemSearchResults[0];
                                        if (chosen) {
                                          populatePurchaseRowWithItem(rIdx, chosen, true);
                                        }
                                        return;
                                      }
                                    }
                                    handlePurchaseCellKeyDown(e, rIdx, 'item_name', 'pos_row');
                                  }}
                                  placeholder="Type Item Name / Code (or F2)..."
                                  className="flex-1 min-w-0 px-1 py-0 font-bold text-slate-900 text-[11px] bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-[15px] leading-none outline-none"
                                />
                                {line.variant_name && !(activeRowItemSearchIdx === rIdx && activeRowItemSearchField === 'item_name') && (
                                  <span className="shrink-0 px-1 py-0 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[9px] leading-tight">
                                    {line.variant_name}
                                  </span>
                                )}
                              </div>
                              {renderRowItemSearchCombobox(rIdx, true)}
                            </td>
                            {/* 3. Qty */}
                            <td
                              className={`p-0 h-[16px] align-middle ${
                                isZeroQty
                                  ? 'bg-rose-100 text-rose-950 ring-1 ring-inset ring-rose-300'
                                  : ''
                              }`}
                            >
                              <NumericInput
                                id={`pos_row_${rIdx}_quantity`}
                                displayZero={hasItem}
                                value={
                                  line.item_id || line.item_code?.trim() || line.item_name?.trim()
                                    ? line.quantity
                                    : 0
                                }
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'quantity', 'pos_row')
                                }
                                className={`w-full px-1 py-0 text-right font-mono font-bold text-[11px] border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none ${
                                  isZeroQty ? 'text-rose-950 placeholder:text-rose-700' : 'text-slate-900'
                                }`}
                              />
                            </td>

                            {/* 4. Discount */}
                            <td className="p-0 text-right h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_discount_percent`}
                                value={
                                  line.item_id || line.item_code?.trim() || line.item_name?.trim()
                                    ? line.discount_percent
                                    : 0
                                }
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'discount_percent',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'discount_percent', 'pos_row')
                                }
                                className="w-full px-1 py-0 text-right font-mono text-[11px] text-slate-800 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 5. Bonus */}
                            <td className="p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_bonus_quantity`}
                                value={line.item_id ? line.bonus_quantity : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'bonus_quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'bonus_quantity', 'pos_row')
                                }
                                className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-teal-900 border border-transparent focus:border-teal-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 6. Gross Amount */}
                            <td className="py-0 px-1.5 text-right font-mono text-slate-800 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.gross_amount > 0
                                ? formatPKR(line.gross_amount)
                                : ''}
                            </td>

                            {/* 7. Net Amount */}
                            <td
                              className={`py-0 px-1.5 text-right font-mono font-semibold text-[11px] h-[16px] align-middle ${
                                isZeroNet
                                  ? 'bg-orange-100 text-rose-950 ring-1 ring-inset ring-orange-300'
                                  : 'text-slate-900'
                              }`}
                            >
                              {hasItem ? formatPKR(Number(line.taxable_amount || 0)) : ''}
                            </td>

                            {/* 8. Packing */}
                            <td className="py-0 px-1 text-center font-mono text-[10px] text-slate-700 h-[16px] align-middle">
                              {line.item_id ? line.packing : ''}
                            </td>

                            {/* 9. Batch/Expiry */}
                            <td className="p-0 h-[16px] align-middle">
                              <div className="flex items-center gap-0.5 h-[15px]">
                                <input
                                  id={`pos_row_${rIdx}_batch_number`}
                                  type="text"
                                  placeholder="Batch #"
                                  value={line.batch_number}
                                  onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                  onChange={(e) =>
                                    handleLineChange(rIdx, 'batch_number', e.target.value)
                                  }
                                  onKeyDown={(e) =>
                                    handlePurchaseCellKeyDown(e, rIdx, 'batch_number', 'pos_row')
                                  }
                                  className="w-24 px-1 py-0 font-mono text-[10px] text-slate-800 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                                />
                                <input
                                  id={`pos_row_${rIdx}_expiry_date`}
                                  type="date"
                                  value={line.item_id ? line.expiry_date : ''}
                                  onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                  onChange={(e) =>
                                    handleLineChange(rIdx, 'expiry_date', e.target.value)
                                  }
                                  onKeyDown={(e) =>
                                    handlePurchaseCellKeyDown(e, rIdx, 'expiry_date', 'pos_row')
                                  }
                                  className="w-28 px-1 py-0 font-mono text-[10px] text-slate-700 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                                />
                              </div>
                            </td>

                            {/* 10. Purchase Rate */}
                            <td className="p-0 text-right h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_purchase_rate`}
                                value={line.item_id ? line.purchase_rate : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'purchase_rate',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onBlur={() => {
                                  checkAndTriggerPurchasePriceChange(rIdx);
                                }}
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'purchase_rate', 'pos_row')
                                }
                                title={
                                  line.item_id
                                    ? 'Purchase Price — Press Ctrl to view Item Purchase History'
                                    : 'Purchase Price'
                                }
                                className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 11. MRP */}
                            <td className="p-0 text-right h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_mrp_rate`}
                                value={line.item_id ? line.mrp_rate : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'mrp_rate',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'mrp_rate', 'pos_row')
                                }
                                className="w-full px-1 py-0 text-right font-mono text-[11px] text-slate-700 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 12. GST */}
                            <td className="p-0 text-right h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_tax_percent`}
                                value={line.item_id ? line.tax_percent : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    rIdx,
                                    'tax_percent',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'tax_percent', 'pos_row')
                                }
                                className="w-full px-1 py-0 text-right font-mono text-[11px] text-slate-800 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 13. Taxable */}
                            <td className="py-0 px-1.5 text-right font-mono text-slate-800 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.taxable_amount > 0
                                ? formatPKR(line.taxable_amount)
                                : ''}
                            </td>

                            {/* 14. Line Total */}
                            <td
                              className={`py-0 px-1.5 text-right font-mono font-black text-[11px] h-[16px] align-middle ${
                                isZeroNet
                                  ? 'bg-orange-100 text-rose-950 ring-1 ring-inset ring-orange-300'
                                  : 'text-slate-900'
                              }`}
                            >
                              {hasItem ? formatPKR(Number(line.line_total || 0)) : ''}
                            </td>

                            {/* 15. Remarks */}
                            <td className="p-0 h-[16px] align-middle">
                              <input
                                id={`pos_row_${rIdx}_remarks`}
                                type="text"
                                value={line.remarks || ''}
                                onFocus={() => setSelectedPurchaseLineIndex(rIdx)}
                                onChange={(e) => handleLineChange(rIdx, 'remarks', e.target.value)}
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, rIdx, 'remarks', 'pos_row')
                                }
                                placeholder="Remarks..."
                                className="w-full px-1 py-0 text-[11px] text-slate-800 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>
                            <td className="py-0 px-1 text-center h-[16px] align-middle whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    suppressItemListReopenRef.current = false;
                                    openPurchaseItemListForRow(
                                      rIdx,
                                      'pos_row',
                                      `pos_row_${rIdx}_item_code`
                                    );
                                  }}
                                  className="p-0 text-slate-400 hover:text-emerald-700 cursor-pointer leading-none"
                                  title="Select or change item from Item List"
                                >
                                  <PackageSearch className="w-3 h-3 inline" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeLineRow(rIdx);
                                  }}
                                  className="p-0 text-slate-400 hover:text-rose-600 cursor-pointer leading-none"
                                  title="Delete item row"
                                >
                                  <Trash2 className="w-3 h-3 inline" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* POS Datasheet Record Navigator Bar + MS Access-Style Invoice Item Search */}
                <div className="ams-pos-compact-chrome ams-access-record-bar bg-slate-200 border-t border-slate-300 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-[10px] text-slate-700 mr-0.5">Record:</span>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(0)}
                        disabled={selectedPurchaseLineIndex === 0}
                        title="First Record (Home)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        |◀
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(selectedPurchaseLineIndex - 1)}
                        disabled={selectedPurchaseLineIndex === 0}
                        title="Previous Record (Up)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ◀
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={purchaseRecordJumpInput}
                        onChange={(e) =>
                          setPurchaseRecordJumpInput(e.target.value.replace(/[^0-9]/g, ''))
                        }
                        onKeyDown={handlePurchaseRecordJumpKeyDown}
                        onBlur={() => {
                          const parsed = parseInt(purchaseRecordJumpInput, 10);
                          if (!isNaN(parsed) && parsed >= 1) {
                            navigateToPurchaseRecord(parsed - 1);
                          } else {
                            setPurchaseRecordJumpInput(String(selectedPurchaseLineIndex + 1));
                          }
                        }}
                        title="Type record number and press Enter to jump"
                        className="w-9 px-1 py-0 text-center bg-white border border-slate-400 focus:border-emerald-600 font-mono font-bold text-[10px] text-slate-900 outline-none"
                      />
                      <span className="text-[10px] font-mono">of {lines.length}</span>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(selectedPurchaseLineIndex + 1)}
                        disabled={selectedPurchaseLineIndex >= lines.length - 1}
                        title="Next Record (Down)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(lines.length - 1)}
                        disabled={selectedPurchaseLineIndex >= lines.length - 1}
                        title="Last Record (End)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ▶|
                      </button>
                      <button
                        type="button"
                        onClick={addLineRow}
                        title="Jump to first blank row or append new record"
                        className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-100 border border-slate-400 text-[10px] font-bold text-emerald-800 cursor-pointer ml-0.5"
                      >
                        * New
                      </button>
                    </div>
                    <InvoiceRecordSearchInput
                      items={purchaseSearchableItems}
                      onPreviewMatch={handlePreviewSearchedPurchaseRow}
                      onNavigateToMatch={handleNavigateToSearchedPurchaseRow}
                      onMatchesChange={(matches, activeRow) => {
                        setPurchaseSearchMatchedRows(matches);
                        setPurchaseSearchActiveRow(activeRow);
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600 hidden xl:flex">
                    <span>Keys: Enter/Tab • Arrows • PgUp/PgDn • Ctrl+Home/End</span>
                  </div>
                </div>
              </div>

              {/* Compact Item History Popup (Purchase POS View) */}
              {(() => {
                const activePurchaseLine = lines[selectedPurchaseLineIndex] || lines[0];
                const vSuffix = activePurchaseLine?.variant_id ? `::v${activePurchaseLine.variant_id}` : '';
                const codeKey = activePurchaseLine?.item_code
                  ? `${activePurchaseLine.item_code.trim().toLowerCase()}${vSuffix}`
                  : '';
                const idKey = activePurchaseLine?.item_id
                  ? `${activePurchaseLine.item_id}${vSuffix}`
                  : '';
                const activePurHistory =
                  (codeKey && purchaseItemHistoryMap[codeKey]) ||
                  (idKey && purchaseItemHistoryMap[idKey]) ||
                  null;
                return showPurchaseCompactHistoryPopup &&
                  activePurchaseLine &&
                  (activePurchaseLine.item_code || activePurchaseLine.item_id) ? (
                  <CompactItemHistoryPopup
                    isOpen={showPurchaseCompactHistoryPopup}
                    mode="purchase"
                    itemCode={activePurchaseLine.item_code}
                    itemName={activePurchaseLine.item_name}
                    variantName={activePurchaseLine.variant_name}
                    thumbnailUrl={activePurchaseLine.thumbnail_url}
                    packing={activePurchaseLine.packing}
                    selectedSupplierName={selectedSupplier?.account_name || 'Supplier'}
                    historyData={activePurHistory}
                    loading={purchaseHistoryLoading}
                    onClose={() => setShowPurchaseCompactHistoryPopup(false)}
                  />
                ) : null;
              })()}

              {/* SECTION C (BOTTOM): COMPACT PURCHASE POS FOOTER */}
              <div className="ams-pos-compact-chrome w-full bg-slate-900 text-white rounded-md border border-slate-700 px-2.5 py-1.5 shrink-0 space-y-1">
                {/* Row 1: Essential Totals & Payment Settlement */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-1 tabular-nums">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Grand Total:</span>
                      <span className="font-mono font-bold text-white">{formatPKR(grossTotal)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-rose-400">Discount:</span>
                      <span className="font-mono font-bold text-rose-300">-{formatPKR(totalDiscount)}</span>
                      <NumericInput
                        value={invoiceDiscountPercent}
                        onChange={(e) => {
                          const pct = Math.max(0, parseFloat(e.target.value) || 0);
                          setInvoiceDiscountPercent(pct);
                          setInvoiceDiscountAmount(round2(subtotalAfterItemDisc * (pct / 100)));
                        }}
                        placeholder="%"
                        title="Bill Discount %"
                        className="w-12 px-1 py-0 rounded bg-slate-800 border border-slate-600 font-mono text-white text-right"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Tax ({appliedAdvanceTaxRate}%):</span>
                      <span className="font-mono font-bold text-amber-300">
                        +{formatPKR(gstTotal + advanceTaxAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Prev Bal ({previousBalanceType}):</span>
                      <span className="font-mono font-bold text-amber-300">{formatPKR(previousSupplierBalance)}</span>
                    </div>
                  </div>

                  {/* Highlighted Net Amount, Payable, Cash Paid & Remaining Balance */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-1.5">
                      <span className="font-bold uppercase text-emerald-300">Net Amount:</span>
                      <span className="font-mono font-black text-emerald-300 ams-total-highlight">
                        {formatPKR(netInvoiceAmount)}
                      </span>
                    </div>
                    <div className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 flex items-center gap-1.5">
                      <span className="font-bold uppercase text-sky-300">Payable:</span>
                      <span className="font-mono font-black text-sky-300 ams-total-highlight">
                        {formatPKR(totalPayable)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded border border-emerald-500">
                      <span className="font-bold text-emerald-300 whitespace-nowrap">Cash Paid:</span>
                      <NumericInput
                        value={paidAmount}
                        displayZero={Boolean(editingPurchaseId) || paidAmountManuallyEdited}
                        onChange={(e) => {
                          setPaidAmountManuallyEdited(true);
                          setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0));
                        }}
                        className="w-24 px-1.5 py-0 rounded bg-slate-900 border border-slate-700 font-mono font-black text-white text-right outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleExactPurchasePayment}
                        className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold cursor-pointer"
                      >
                        Exact
                      </button>
                    </div>
                    <div
                      className={`px-2 py-0.5 rounded border flex items-center gap-1.5 ${
                        remainingBalance <= 0
                          ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                          : 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                      }`}
                    >
                      <span className="font-bold uppercase">Remaining:</span>
                      <span className="font-mono font-black ams-total-highlight">
                        {formatPKR(Math.abs(remainingBalance))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Compact Professional Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="submit"
                      disabled={savingInvoice}
                      className="px-3 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Confirm & Save Purchase Invoice (F2)"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {savingInvoice
                          ? 'Posting...'
                          : editingPurchaseId
                          ? 'Update (F2)'
                          : 'Save Purchase (F2)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, true)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center gap-1 cursor-pointer border border-slate-600"
                      title="Save & Print A4 Purchase Invoice (Ctrl+P)"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-400" />
                      <span>A4 Print</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportCurrentPurchasePdf}
                      className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Save Purchase Invoice to PDF (supplier_invno:123_date)"
                    >
                      <Download className="w-3 h-3 text-sky-200" />
                      <span>Export PDF</span>
                    </button>

                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={handleExportCurrentPurchaseToExcel}
                      className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Export Purchase Invoice to Excel (.xlsx)"
                    >
                      <Download className="w-3 h-3 text-emerald-200" />
                      <span>Excel</span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Preview A4 Invoice (F4)"
                    >
                      <Printer className="w-3 h-3 text-sky-200" />
                      <span>Preview (F4)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenPurchaseOrderSms}
                      className="px-2 py-0.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Send Order SMS for Current Purchase Invoice"
                    >
                      <MessageSquare className="w-3 h-3 text-indigo-200" />
                      <span>Order SMS</span>
                    </button>

                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold flex items-center gap-1 cursor-pointer border border-slate-600 disabled:opacity-50"
                      title="Hold this Purchase Invoice (F3)"
                    >
                      <PauseCircle className="w-3 h-3 text-amber-400" />
                      <span>Hold (F3)</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center gap-1 cursor-pointer border border-slate-600"
                      title="Reset Form (Ctrl+N)"
                    >
                      <span>Reset</span>
                    </button>
                    {onBackToDashboard && (
                      <button
                        type="button"
                        onClick={onBackToDashboard}
                        className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Close</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (THREE-SECTION COMPACT FORM) ================= */}
          {purchaseViewMode === 'access' && (
            <form
              onSubmit={(e) => handleSavePurchaseInvoice(e, false)}
              className="ams-pos-compact-chrome flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-200 border border-slate-400 rounded-md shadow-xs select-none"
            >
              {/* SECTION A (TOP): COMPACT MS ACCESS FORM HEADER */}
              <div className="bg-slate-800 text-white px-2 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-1.5 font-mono">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-bold text-slate-200">frm_PurchaseInvoice</span>
                  <span className="bg-emerald-700 px-1.5 py-0 rounded text-white font-bold uppercase">
                    Goods Receipt
                  </span>
                  <span className="font-bold text-amber-300">{billNumber}</span>
                  {editingPurchaseId && (
                    <span className="bg-amber-600 text-white px-1.5 py-0 rounded font-bold">
                      EDIT #{editingPurchaseId}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                    title="New Purchase Bill (Ctrl+N)"
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                    <span>New</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePreviewInvoice}
                    className="px-1.5 py-0 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                    title="Preview A4 Invoice (F4)"
                  >
                    <Printer className="w-3 h-3 text-sky-200" />
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={openHeldPurchasesModal}
                    className="px-1.5 py-0 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                    title="View Held Purchase Drafts"
                  >
                    <Clock className="w-3 h-3 text-indigo-300" />
                    <span>Held ({heldPurchases.length})</span>
                  </button>
                  {selectedSupplier && (
                    <button
                      type="button"
                      onClick={handleOpenSupplierLedger}
                      className="px-1.5 py-0 rounded bg-teal-700 hover:bg-teal-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Open Detailed Supplier Ledger"
                    >
                      <Scale className="w-3 h-3 text-teal-200" />
                      <span>Ledger</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubTab('advance-tax')}
                    className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 font-bold flex items-center gap-0.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    <span>Adv Tax ({appliedAdvanceTaxRate}%)</span>
                  </button>
                </div>
              </div>

              {/* Dense MS Access Form Header Controls (Supplier, Date, F3 Search & Row Actions) */}
              <div className="bg-slate-100 border-b border-slate-300 px-2 py-1 shrink-0 space-y-1">
                <div className="grid grid-cols-12 gap-1.5 items-center">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">Bill #:</label>
                    <input
                      type="text"
                      readOnly
                      value={billNumber}
                      title="Auto-generated Purchase Invoice Number"
                      className="w-full px-1 py-0 font-mono font-bold rounded border border-slate-300 bg-slate-200 cursor-not-allowed text-slate-900"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">Date:</label>
                    <input
                      type="date"
                      required
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      className="w-full px-1 py-0 font-mono rounded border border-slate-300 bg-white text-slate-900"
                    />
                  </div>

                  {/* Searchable Supplier Selector */}
                  <div
                    ref={purchaseViewMode === 'access' ? supplierDropdownContainerRef : undefined}
                    className="col-span-4 flex items-center gap-1 relative"
                  >
                    <label className="font-bold text-slate-600 whitespace-nowrap">Supplier:</label>
                    <div className="relative flex-1 flex items-center gap-0.5">
                      <div className="relative flex-1">
                        <input
                          ref={purchaseViewMode === 'access' ? supplierSearchInputRef : undefined}
                          type="text"
                          value={supplierSearchQuery}
                          onFocus={() => {
                            setIsSupplierDropdownOpen(false);
                          }}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSupplierSearchQuery(value);
                            setIsSupplierDropdownOpen(value.trim().length > 0);
                            setSupplierHighlightIndex(0);
                          }}
                          onKeyDown={handleSupplierSearchKeyDown}
                          placeholder="Search Supplier Name / Code / Mobile..."
                          className="w-full pl-1.5 pr-9 py-0 font-bold rounded border border-emerald-500 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center">
                          {supplierSearchQuery && (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSupplierSearchQuery('');
                                setIsSupplierDropdownOpen(true);
                                setSupplierHighlightIndex(0);
                                supplierSearchInputRef.current?.focus();
                              }}
                              className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setIsSupplierDropdownOpen((prev) => !prev);
                              setSupplierHighlightIndex(0);
                              supplierSearchInputRef.current?.focus();
                            }}
                            className="p-0.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAddSupplierModal()}
                        className="px-1.5 py-0 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-0.5 shrink-0 cursor-pointer"
                        title="Add New Supplier"
                      >
                        <UserPlus className="w-2.5 h-2.5" />
                        <span>+New</span>
                      </button>
                    </div>

                    {renderSupplierDropdownMenu()}
                  </div>

                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">Sup Inv:</label>
                    <input
                      type="text"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="Inv #"
                      className="w-full px-1 py-0 font-mono rounded border border-slate-300 bg-white text-slate-900"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">Mode:</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => {
                        const nextMode = e.target.value as PurchasePaymentMode;
                        setPaymentMode(nextMode);
                        if (nextMode === 'Cash') {
                          setPaidAmount(0);
                          setPaidAmountManuallyEdited(true);
                        } else {
                          setPaidAmountManuallyEdited(false);
                        }
                      }}
                      className="w-full px-1 py-0 font-bold rounded border border-slate-300 bg-white text-slate-900"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Credit">Credit</option>
                      <option value="Bank">Bank</option>
                      <option value="Partial">Partial</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: FBR Filer, Remarks, Quick Item Search (F3) & Row Actions */}
                <div className="grid grid-cols-12 gap-1.5 items-center pt-1 border-t border-slate-200">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">FBR:</label>
                    <select
                      value={supplierFilerStatus}
                      onChange={(e) => setSupplierFilerStatus(e.target.value as FilerStatus)}
                      className="w-full px-1 py-0 font-bold rounded border border-slate-300 bg-white text-slate-900"
                    >
                      <option value="Filer">Filer ({taxSettings?.filer_rate ?? 0.5}%)</option>
                      <option value="Non-Filer">Non-Filer ({taxSettings?.non_filer_rate ?? 2.5}%)</option>
                      <option value="Exempt">Exempt (0%)</option>
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">A/C:</label>
                    <select
                      value={paymentAccountId}
                      onChange={(e) => setPaymentAccountId(e.target.value)}
                      className="w-full px-1 py-0 font-semibold rounded border border-slate-300 bg-white text-slate-900"
                    >
                      <option value="">
                        Auto ({paymentMode === 'Bank' ? 'Bank' : 'Cash'})
                      </option>
                      {financialAccounts.map((fa) => (
                        <option key={fa.id} value={fa.id}>
                          [{fa.account_code}] {fa.account_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="font-bold text-slate-600 whitespace-nowrap">Note:</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Challan / remarks..."
                      className="w-full px-1 py-0 rounded border border-slate-300 bg-white text-slate-900"
                    />
                  </div>
                  <div
                    ref={purchaseViewMode === 'access' ? itemDropdownContainerRef : undefined}
                    className="col-span-3 relative"
                  >
                    <div className="flex items-center bg-white border border-slate-300 rounded px-1.5 focus-within:border-emerald-600">
                      <Search className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                      <input
                        id="access_purchase_item_search_input"
                        ref={purchaseViewMode === 'access' ? itemSearchInputRef : undefined}
                        type="text"
                        value={purchaseSearchQuery}
                        onFocus={() => {
                          if (purchaseSearchQuery.trim().length > 0) {
                            setShowPurchaseSearchDropdown(true);
                          }
                          setItemHighlightIndex(0);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowPurchaseSearchDropdown(false);
                          }, 160);
                        }}
                        onChange={(e) => {
                          const q = e.target.value;
                          setPurchaseSearchQuery(q);
                          setItemHighlightIndex(0);
                          setShowPurchaseSearchDropdown(q.trim().length > 0);
                        }}
                        onKeyDown={handleItemSearchKeyDown}
                        placeholder="Barcode / Item Search (F3)..."
                        className="w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none"
                      />
                      {purchaseSearchQuery && (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPurchaseSearchQuery('');
                            setItemHighlightIndex(0);
                            setShowPurchaseSearchDropdown(false);
                            itemSearchInputRef.current?.focus();
                          }}
                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {renderTopItemSearchDropdown()}
                  </div>
                  <div className="col-span-3 flex flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        openPurchaseItemListForRow(
                          lines[selectedPurchaseLineIndex]?.item_id
                            ? null
                            : selectedPurchaseLineIndex,
                          'access_row'
                        )
                      }
                      className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Open Item List (F2)"
                    >
                      <PackageSearch className="w-3 h-3 text-emerald-400" />
                      Items
                    </button>
                    <button
                      type="button"
                      onClick={addLineRow}
                      className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Add New Blank Line"
                    >
                      <Plus className="w-3 h-3" />
                      Row
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLineRow(selectedPurchaseLineIndex)}
                      className="px-1.5 py-0 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold flex items-center gap-0.5 cursor-pointer"
                      title="Delete Selected Row"
                    >
                      <Trash2 className="w-3 h-3" />
                      Del
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION B (CENTER): MS ACCESS DATASHEET ITEM GRID ONLY (MIN 10 VISIBLE ROWS, STICKY HEADERS) */}
              <div className="ams-pos-item-grid-card flex flex-col flex-1 min-h-[356px] bg-white overflow-hidden select-none border-b border-slate-400 relative z-10">
                <div
                  ref={accessGridViewportRef}
                  className="ams-pos-item-grid-scroll flex-1 min-h-[322px] overflow-y-auto overflow-x-auto relative bg-white"
                >
                  <table className="ams-compact-10-grid w-full min-w-[1680px] border-collapse text-[11px] font-sans leading-none">
                    <thead className="sticky top-0 z-20 bg-slate-200 border-b border-slate-400 text-slate-800 text-[10px] font-bold select-none shadow-sm leading-none">
                      <tr className="h-6">
                        <th className="bg-slate-300/80 border-r border-slate-400 px-1 py-0 w-7 text-center font-mono h-6">
                          #
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-28 text-left h-6">
                          Item Code
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 min-w-[240px] text-left h-6">
                          Item Name
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-right bg-emerald-100/60 text-emerald-950 h-6">
                          Qty
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-right h-6">
                          Discount
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Purchase Rate
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-right bg-emerald-100/70 text-emerald-950 h-6">
                          Bonus
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Net Amount
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Gross Amount
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-center h-6">
                          Packing
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-56 text-left h-6">
                          Batch/Expiry
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          MRP
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-right h-6">
                          GST
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Taxable
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-28 text-right bg-slate-300/60 font-black h-6">
                          Line Total
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-32 text-left h-6">
                          Remarks
                        </th>
                        <th className="px-1 py-0 w-8 text-center h-6">Del</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => {
                        if (isGhostRow(idx)) {
                          return (
                            <tr key={idx} className="h-[16px] border-b border-slate-300 bg-slate-50/50 select-none">
                              <td className="border-r border-slate-300 px-0.5 py-0 text-center bg-slate-100 font-mono text-[9.5px] text-slate-300 h-[16px] align-middle">
                                {idx + 1}
                              </td>
                              <td colSpan={16} />
                            </tr>
                          );
                        }
                        const isSelected = idx === selectedPurchaseLineIndex;
                        const isActiveSearchMatch = purchaseSearchActiveRow === idx;
                        const isSearchMatch = purchaseSearchMatchedRows.includes(idx);
                        const hasItem = Boolean(line.item_id && Number(line.item_id) > 0);
                        const isZeroQty = hasItem && Number(line.quantity || 0) === 0;
                        const isZeroNet = hasItem && round2(Number(line.taxable_amount || 0)) === 0;
                        const isZeroRow = isZeroQty || isZeroNet;
                        return (
                          <tr
                            key={idx}
                            data-purchase-row-idx={idx}
                            data-zero-qty={isZeroQty ? 'true' : 'false'}
                            data-zero-net={isZeroNet ? 'true' : 'false'}
                            onClick={() => setSelectedPurchaseLineIndex(idx)}
                            className={`border-b border-slate-300 font-sans transition-colors h-[16px] leading-none ${
                              isActiveSearchMatch
                                ? 'bg-amber-200/90 ring-2 ring-inset ring-amber-500 font-semibold'
                                : isSearchMatch
                                ? 'bg-sky-100/90 font-medium'
                                : isZeroRow
                                ? 'bg-orange-50/90 hover:bg-orange-100/75'
                                : isSelected
                                ? 'bg-amber-50/90 font-medium'
                                : idx % 2 === 0
                                ? 'bg-white hover:bg-slate-50'
                                : 'bg-slate-50/60 hover:bg-slate-100/60'
                            }`}
                          >
                            {/* Row Selector Indicator */}
                            <td className="border-r border-slate-300 px-0.5 py-0 text-center bg-slate-100 font-mono text-[9.5px] text-slate-700 h-[16px] align-middle">
                              {isSelected ? (
                                <span className="text-black font-black text-[8.5px]">▶</span>
                              ) : (
                                <span>{idx + 1}</span>
                              )}
                            </td>

                            {/* 1. Item Code (Direct typing + inline search; Enter on blank opens Item List) */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
                              <input
                                id={`pur_cell_${idx}_item_code`}
                                type="text"
                                value={
                                  activeRowItemSearchIdx === idx &&
                                  activeRowItemSearchField === 'item_code'
                                    ? rowItemSearchQuery
                                    : line.item_code
                                }
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(idx);
                                  if (
                                    activeRowItemSearchIdx !== idx ||
                                    activeRowItemSearchField !== 'item_code'
                                  ) {
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === idx ? null : prev
                                    );
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(idx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchField(v.trim().length > 0 ? 'item_code' : null);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? idx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && (activeRowItemSearchIdx === idx || showPurchaseCompactHistoryPopup)) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                    setShowPurchaseCompactHistoryPopup(false);
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === idx &&
                                    activeRowItemSearchField === 'item_code' &&
                                    rowItemSearchResults.length > 0
                                  ) {
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setRowItemHighlightIndex((prev) => {
                                        const next = Math.min(
                                          prev + 1,
                                          rowItemSearchResults.length - 1
                                        );
                                        setTimeout(() => {
                                          document
                                            .querySelector(`[data-row-item-idx="${idx}-${next}"]`)
                                            ?.scrollIntoView({ block: 'nearest' });
                                        }, 0);
                                        return next;
                                      });
                                      return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setRowItemHighlightIndex((prev) => {
                                        const next = Math.max(0, prev - 1);
                                        setTimeout(() => {
                                          document
                                            .querySelector(`[data-row-item-idx="${idx}-${next}"]`)
                                            ?.scrollIntoView({ block: 'nearest' });
                                        }, 0);
                                        return next;
                                      });
                                      return;
                                    }
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const chosen =
                                        rowItemSearchResults[rowItemHighlightIndex] ||
                                        rowItemSearchResults[0];
                                      if (chosen) {
                                        populatePurchaseRowWithItem(idx, chosen, true);
                                      }
                                      return;
                                    }
                                  }
                                  handlePurchaseCellKeyDown(e, idx, 'item_code', 'pur_cell');
                                }}
                                placeholder="Code..."
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 2. Item Name (Direct typing + inline search; Enter on blank opens Item List) */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
                              <div className="flex items-center gap-1 h-[15px] px-0.5">
                                {line.item_id > 0 && line.thumbnail_url && (
                                  <ProductThumb
                                    src={line.thumbnail_url}
                                    alt={line.item_name}
                                    size="xs"
                                    className="!w-3.5 !h-3.5 !rounded-xs border-0 shrink-0"
                                  />
                                )}
                                <input
                                  id={`pur_cell_${idx}_item_name`}
                                  type="text"
                                  value={
                                    activeRowItemSearchIdx === idx &&
                                    activeRowItemSearchField === 'item_name'
                                      ? rowItemSearchQuery
                                      : line.item_name
                                  }
                                  onFocus={() => {
                                    setSelectedPurchaseLineIndex(idx);
                                    if (
                                      activeRowItemSearchIdx !== idx ||
                                      activeRowItemSearchField !== 'item_name'
                                    ) {
                                      setActiveRowItemSearchIdx(null);
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                    }
                                    if (line.item_code || line.item_id) {
                                      fetchPurchaseItemHistoryByCode(
                                        line.item_code,
                                        Number(line.item_id || 0),
                                        line.variant_id || null
                                      );
                                    }
                                  }}
                                  onDoubleClick={(e) => {
                                    if (!line.item_id) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setActiveRowItemSearchIdx(null);
                                    setActiveRowItemSearchField(null);
                                    setRowItemSearchQuery('');
                                    setItemLogModalState({
                                      isOpen: true,
                                      itemId: Number(line.item_id),
                                      itemCode: line.item_code,
                                      itemName: line.item_name,
                                      returnFocusId: `pur_cell_${idx}_item_name`,
                                    });
                                  }}
                                  title={line.item_id ? `${line.item_name}${line.variant_name ? ` — ${line.variant_name}` : ''} — Double-click to open Complete ITEM LOG` : 'Type Item Name or Code'}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setActiveRowItemSearchIdx((prev) =>
                                        prev === idx ? null : prev
                                      );
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                    }, 180);
                                  }}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSelectedPurchaseLineIndex(idx);
                                    setRowItemSearchQuery(v);
                                    setRowItemHighlightIndex(0);
                                    setActiveRowItemSearchField(v.trim().length > 0 ? 'item_name' : null);
                                    setActiveRowItemSearchIdx(v.trim().length > 0 ? idx : null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape' && activeRowItemSearchIdx === idx) {
                                      e.preventDefault();
                                      setActiveRowItemSearchIdx(null);
                                      setActiveRowItemSearchField(null);
                                      setRowItemSearchQuery('');
                                      return;
                                    }
                                    if (
                                      activeRowItemSearchIdx === idx &&
                                      activeRowItemSearchField === 'item_name' &&
                                      rowItemSearchResults.length > 0
                                    ) {
                                      if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setRowItemHighlightIndex((prev) => {
                                          const next = Math.min(
                                            prev + 1,
                                            rowItemSearchResults.length - 1
                                          );
                                          setTimeout(() => {
                                            document
                                              .querySelector(`[data-row-item-idx="${idx}-${next}"]`)
                                              ?.scrollIntoView({ block: 'nearest' });
                                          }, 0);
                                          return next;
                                        });
                                        return;
                                      }
                                      if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setRowItemHighlightIndex((prev) => {
                                          const next = Math.max(0, prev - 1);
                                          setTimeout(() => {
                                            document
                                              .querySelector(`[data-row-item-idx="${idx}-${next}"]`)
                                              ?.scrollIntoView({ block: 'nearest' });
                                          }, 0);
                                          return next;
                                        });
                                        return;
                                      }
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const chosen =
                                          rowItemSearchResults[rowItemHighlightIndex] ||
                                          rowItemSearchResults[0];
                                        if (chosen) {
                                          populatePurchaseRowWithItem(idx, chosen, true);
                                        }
                                        return;
                                      }
                                    }
                                    handlePurchaseCellKeyDown(e, idx, 'item_name', 'pur_cell');
                                  }}
                                  placeholder="Type Item Name / Code (or F2)..."
                                  className="flex-1 min-w-0 px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-semibold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                                />
                                {line.variant_name && !(activeRowItemSearchIdx === idx && activeRowItemSearchField === 'item_name') && (
                                  <span className="shrink-0 px-1 py-0 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[9px] leading-tight">
                                    {line.variant_name}
                                  </span>
                                )}
                              </div>
                              {renderRowItemSearchCombobox(idx, false)}
                            </td>

                            {/* 3. Qty */}
                            <td
                              className={`border-r border-slate-300 p-0 h-[16px] align-middle ${
                                isZeroQty
                                  ? 'bg-rose-100 text-rose-950 ring-1 ring-inset ring-rose-300'
                                  : 'bg-emerald-50/20'
                              }`}
                            >
                              <NumericInput
                                id={`pur_cell_${idx}_quantity`}
                                displayZero={hasItem}
                                value={
                                  line.item_id || line.item_code?.trim() || line.item_name?.trim()
                                    ? line.quantity
                                    : 0
                                }
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'quantity')}
                                className={`w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold bg-transparent text-[11px] h-[15px] leading-none outline-none ${
                                  isZeroQty ? 'text-rose-950 placeholder:text-rose-700' : 'text-slate-900'
                                }`}
                              />
                            </td>

                            {/* 4. Discount */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_discount_percent`}
                                value={
                                  line.item_id || line.item_code?.trim() || line.item_name?.trim()
                                    ? line.discount_percent
                                    : 0
                                }
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'discount_percent',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, idx, 'discount_percent')
                                }
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 10. Purchase Rate */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_purchase_rate`}
                                value={line.item_id ? line.purchase_rate : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'purchase_rate',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onBlur={() => {
                                  checkAndTriggerPurchasePriceChange(idx);
                                }}
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, idx, 'purchase_rate')
                                }
                                title={
                                  line.item_id
                                    ? 'Purchase Price — Press Ctrl to view Item Purchase History'
                                    : 'Purchase Price'
                                }
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 5. Bonus */}
                            <td className="border-r border-slate-300 p-0 bg-emerald-50/40 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_bonus_quantity`}
                                value={line.item_id ? line.bonus_quantity : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'bonus_quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, idx, 'bonus_quantity')
                                }
                                className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-emerald-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 7. Net Amount */}
                            <td
                              className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-semibold text-[11px] h-[16px] align-middle ${
                                isZeroNet
                                  ? 'bg-orange-100 text-rose-950 ring-1 ring-inset ring-orange-300'
                                  : 'text-slate-900'
                              }`}
                            >
                              {hasItem ? Number(line.taxable_amount || 0).toFixed(2) : ''}
                            </td>

                            {/* 6. Gross Amount */}
                            <td className="border-r border-slate-300 px-1 py-0 text-right font-mono text-slate-800 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.gross_amount > 0
                                ? line.gross_amount.toFixed(2)
                                : ''}
                            </td>

                            {/* 8. Packing */}
                            <td className="border-r border-slate-300 px-1 py-0 text-center font-mono text-[9.5px] text-slate-800 h-[16px] align-middle">
                              {line.item_id ? line.packing : ''}
                            </td>

                            {/* 9. Batch/Expiry */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <div className="flex items-center gap-0.5 h-[15px]">
                                <input
                                  id={`pur_cell_${idx}_batch_number`}
                                  type="text"
                                  placeholder="Batch #"
                                  value={line.batch_number}
                                  onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                  onChange={(e) =>
                                    handleLineChange(idx, 'batch_number', e.target.value)
                                  }
                                  onKeyDown={(e) =>
                                    handlePurchaseCellKeyDown(e, idx, 'batch_number')
                                  }
                                  className="w-24 px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono text-slate-900 bg-transparent text-[10px] h-[15px] leading-none outline-none"
                                />
                                <input
                                  id={`pur_cell_${idx}_expiry_date`}
                                  type="date"
                                  value={line.item_id ? line.expiry_date : ''}
                                  onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                  onChange={(e) =>
                                    handleLineChange(idx, 'expiry_date', e.target.value)
                                  }
                                  onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'expiry_date')}
                                  className="w-28 px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono text-slate-900 bg-transparent text-[10px] h-[15px] leading-none outline-none"
                                />
                              </div>
                            </td>

                            {/* 11. MRP */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_mrp_rate`}
                                value={line.item_id ? line.mrp_rate : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'mrp_rate',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) =>
                                  handlePurchaseCellKeyDown(e, idx, 'mrp_rate')
                                }
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-800 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 12. GST */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_tax_percent`}
                                value={line.item_id ? line.tax_percent : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'tax_percent',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'tax_percent')}
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 13. Taxable */}
                            <td className="border-r border-slate-300 px-1 py-0 text-right font-mono text-slate-800 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.taxable_amount > 0
                                ? line.taxable_amount.toFixed(2)
                                : ''}
                            </td>

                            {/* 14. Line Total */}
                            <td
                              className={`border-r border-slate-300 px-1 py-0 text-right font-mono font-black text-[11px] h-[16px] align-middle ${
                                isZeroNet
                                  ? 'bg-orange-100 text-rose-950 ring-1 ring-inset ring-orange-300'
                                  : 'text-slate-900 bg-slate-50/50'
                              }`}
                            >
                              {hasItem ? Number(line.line_total || 0).toFixed(2) : ''}
                            </td>

                            {/* 15. Remarks */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <input
                                id={`pur_cell_${idx}_remarks`}
                                type="text"
                                value={line.remarks || ''}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) => handleLineChange(idx, 'remarks', e.target.value)}
                                onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'remarks')}
                                placeholder="Remarks..."
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* Select Item List / Delete Row */}
                            <td className="px-1 py-0 text-center h-[16px] align-middle whitespace-nowrap">
                              <div className="inline-flex items-center justify-center gap-0.5 h-[15px]">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    suppressItemListReopenRef.current = false;
                                    openPurchaseItemListForRow(
                                      idx,
                                      'access_row',
                                      `pur_cell_${idx}_item_code`
                                    );
                                  }}
                                  className="text-emerald-700 hover:text-emerald-950 font-bold text-[9.5px] cursor-pointer px-0.5 leading-none"
                                  title="Select or change item from Item List"
                                >
                                  <PackageSearch className="w-3 h-3 inline" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeLineRow(idx)}
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

                {/* Microsoft Access Record Navigator Bar + Invoice Item Search */}
                <div className="ams-access-record-bar bg-slate-200 border-t border-slate-400 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-[10px] text-slate-700 mr-0.5">Record:</span>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(0)}
                        disabled={selectedPurchaseLineIndex === 0}
                        title="First Record (Home)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        |◀
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(selectedPurchaseLineIndex - 1)}
                        disabled={selectedPurchaseLineIndex === 0}
                        title="Previous Record (Up)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ◀
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={purchaseRecordJumpInput}
                        onChange={(e) =>
                          setPurchaseRecordJumpInput(e.target.value.replace(/[^0-9]/g, ''))
                        }
                        onKeyDown={handlePurchaseRecordJumpKeyDown}
                        onBlur={() => {
                          const parsed = parseInt(purchaseRecordJumpInput, 10);
                          if (!isNaN(parsed) && parsed >= 1) {
                            navigateToPurchaseRecord(parsed - 1);
                          } else {
                            setPurchaseRecordJumpInput(String(selectedPurchaseLineIndex + 1));
                          }
                        }}
                        title="Type record number and press Enter to jump"
                        className="w-9 px-1 py-0 text-center bg-white border border-slate-400 focus:border-blue-600 font-mono font-bold text-[10px] text-slate-900 outline-none"
                      />
                      <span className="text-[10px] font-mono">of {lines.length}</span>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(selectedPurchaseLineIndex + 1)}
                        disabled={selectedPurchaseLineIndex >= lines.length - 1}
                        title="Next Record (Down)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToPurchaseRecord(lines.length - 1)}
                        disabled={selectedPurchaseLineIndex >= lines.length - 1}
                        title="Last Record (End)"
                        className="px-1 py-0 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                      >
                        ▶|
                      </button>
                      <button
                        type="button"
                        onClick={addLineRow}
                        title="Jump to first blank row or append new record"
                        className="px-1.5 py-0 rounded-lg bg-white hover:bg-slate-100 border border-slate-400 text-[10px] font-bold text-emerald-800 cursor-pointer ml-0.5"
                      >
                        * New
                      </button>
                    </div>
                    <InvoiceRecordSearchInput
                      items={purchaseSearchableItems}
                      onPreviewMatch={handlePreviewSearchedPurchaseRow}
                      onNavigateToMatch={handleNavigateToSearchedPurchaseRow}
                      onMatchesChange={(matches, activeRow) => {
                        setPurchaseSearchMatchedRows(matches);
                        setPurchaseSearchActiveRow(activeRow);
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2.5 text-[10px] font-mono">
                    <span>
                      Items: <strong className="text-slate-900">{validLines.length}</strong>
                    </span>
                    <span>
                      Packs:{' '}
                      <strong className="text-slate-900">
                        {validLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)}
                      </strong>
                    </span>
                    <span>
                      Gross: <strong className="text-emerald-800">{formatPKR(grossTotal)}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Compact Item History Popup (Purchase MS Access View) */}
              {(() => {
                const activePurchaseLine = lines[selectedPurchaseLineIndex] || lines[0];
                const vSuffix = activePurchaseLine?.variant_id ? `::v${activePurchaseLine.variant_id}` : '';
                const codeKey = activePurchaseLine?.item_code
                  ? `${activePurchaseLine.item_code.trim().toLowerCase()}${vSuffix}`
                  : '';
                const idKey = activePurchaseLine?.item_id
                  ? `${activePurchaseLine.item_id}${vSuffix}`
                  : '';
                const activePurHistory =
                  (codeKey && purchaseItemHistoryMap[codeKey]) ||
                  (idKey && purchaseItemHistoryMap[idKey]) ||
                  null;
                return showPurchaseCompactHistoryPopup &&
                  activePurchaseLine &&
                  (activePurchaseLine.item_code || activePurchaseLine.item_id) ? (
                  <CompactItemHistoryPopup
                    isOpen={showPurchaseCompactHistoryPopup}
                    mode="purchase"
                    itemCode={activePurchaseLine.item_code}
                    itemName={activePurchaseLine.item_name}
                    variantName={activePurchaseLine.variant_name}
                    thumbnailUrl={activePurchaseLine.thumbnail_url}
                    packing={activePurchaseLine.packing}
                    selectedSupplierName={selectedSupplier?.account_name || 'Supplier'}
                    historyData={activePurHistory}
                    loading={purchaseHistoryLoading}
                    onClose={() => setShowPurchaseCompactHistoryPopup(false)}
                  />
                ) : null;
              })()}

              {/* SECTION C (BOTTOM): COMPACT MS ACCESS CALCULATION & ACTION FOOTER */}
              <div className="ams-pos-compact-chrome px-2.5 py-1.5 bg-slate-900 text-white border-t border-slate-700 flex flex-col gap-1 shrink-0">
                {/* Row 1: Essential Totals & Payment Settlement */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-1 tabular-nums">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Grand Total ({validLines.length}):</span>
                      <span className="font-mono font-bold text-white">{formatPKR(grossTotal)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-rose-400">Discount:</span>
                      <span className="font-mono font-bold text-rose-300">-{formatPKR(totalDiscount)}</span>
                      <NumericInput
                        step="0.01"
                        min="0"
                        max="100"
                        value={invoiceDiscountPercent}
                        onChange={(e) => {
                          const pct = Math.max(0, parseFloat(e.target.value) || 0);
                          setInvoiceDiscountPercent(pct);
                          setInvoiceDiscountAmount(round2(subtotalAfterItemDisc * (pct / 100)));
                        }}
                        placeholder="%"
                        title="Invoice Discount %"
                        className="w-12 px-1 py-0 text-right rounded bg-slate-800 border border-slate-700 text-white font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Tax ({appliedAdvanceTaxRate}%):</span>
                      <span className="font-mono font-bold text-amber-300">
                        +{formatPKR(gstTotal + advanceTaxAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Prev Bal ({previousBalanceType}):</span>
                      <span className="font-mono font-semibold text-amber-300">
                        {formatPKR(previousSupplierBalance)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-1">
                      <span className="uppercase font-bold text-emerald-300">Net Amount:</span>
                      <span className="font-mono font-black text-emerald-300 ams-total-highlight">
                        {formatPKR(netInvoiceAmount)}
                      </span>
                    </div>
                    <div className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 flex items-center gap-1">
                      <span className="uppercase font-bold text-sky-300">Payable:</span>
                      <span className="font-mono font-black text-sky-300 ams-total-highlight">
                        {formatPKR(totalPayable)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-800 px-1.5 py-0.5 rounded border border-emerald-500">
                      <span className="uppercase font-bold text-emerald-300">Cash Paid:</span>
                      <NumericInput
                        step="0.01"
                        min="0"
                        value={paidAmount}
                        displayZero={Boolean(editingPurchaseId) || paidAmountManuallyEdited}
                        onChange={(e) => {
                          setPaidAmountManuallyEdited(true);
                          setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0));
                        }}
                        className="w-24 px-1 py-0 rounded bg-slate-900 border border-slate-700 text-right font-mono font-bold text-emerald-300 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleExactPurchasePayment}
                        className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold cursor-pointer"
                      >
                        Exact
                      </button>
                    </div>
                    <div className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 flex items-center gap-1">
                      <span className="uppercase font-bold text-amber-300">Remaining:</span>
                      <span className="font-mono font-black text-amber-300 ams-total-highlight">
                        {formatPKR(remainingBalance)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Compact Action Buttons Bar */}
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="submit"
                      disabled={savingInvoice}
                      className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3 h-3" />
                      <span>
                        {savingInvoice
                          ? 'Posting...'
                          : editingPurchaseId
                          ? 'Update (F2)'
                          : 'Save (F2)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, true)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3 h-3 text-emerald-400" />
                      <span>A4 Print</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCurrentPurchasePdf}
                      className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Save Purchase Invoice to PDF (supplier_invno:123_date)"
                    >
                      <Download className="w-3 h-3 text-sky-200" />
                      <span>Export PDF</span>
                    </button>
                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={handleExportCurrentPurchaseToExcel}
                      className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Export Purchase Invoice to Excel (.xlsx)"
                    >
                      <Download className="w-3 h-3" />
                      <span>Excel</span>
                    </button>
                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={() => handleOpenCustomPurchaseExcelExport(false)}
                      className="px-2 py-0.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Purchase Invoice → Custom Excel Export (Field Selection & Templates)"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      <span>Custom Excel Export</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3 h-3 text-sky-200" />
                      <span>Preview (F4)</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-600 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <PauseCircle className="w-3 h-3 text-amber-400" />
                      <span>Hold (F3)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPurchaseOrderSms}
                      className="px-2 py-0.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      title="Send Order SMS for Current Purchase Invoice"
                    >
                      <MessageSquare className="w-3 h-3 text-indigo-200" />
                      <span>Order SMS</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold cursor-pointer"
                    >
                      Reset
                    </button>
                    {onBackToDashboard && (
                      <button
                        type="button"
                        onClick={onBackToDashboard}
                        className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Close</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 2: PURCHASE REGISTER & HISTORY */}
      {subTab === 'register' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">Confirmed Purchase Invoices Register</h3>
              <p className="text-[11px] text-slate-400">
                Historical Advance Tax rates are permanently preserved on every invoice • Supports
                A4 Print, Excel Export (.xlsx), Safe Edit &amp; Reversal Cancellation
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={exportingExcel || purchases.length === 0}
                onClick={handleExportAllPurchasesToExcel}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Export All Purchase Invoices with Line Items to Excel (.xlsx)"
              >
                <Download className="w-4 h-4" />
                <span>Export All to Excel ({purchases.length})</span>
              </button>
              <button
                type="button"
                disabled={exportingExcel || purchases.length === 0}
                onClick={() => handleOpenCustomPurchaseExcelExport(true)}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Purchase Invoice → Custom Excel Export (Choose Fields & Saved Templates)"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Custom Excel Export</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  resetInvoiceForm();
                  setSubTab('new-invoice');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Purchase Invoice</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 uppercase text-[10px] border-b border-slate-200">
                  <th className="py-3 px-3">Bill #</th>
                  <th className="py-3 px-2.5">Date</th>
                  <th className="py-3 px-2.5">Supplier</th>
                  <th className="py-3 px-2.5">Sup. Inv #</th>
                  <th className="py-3 px-2.5">Tax Status &amp; Rate</th>
                  <th className="py-3 px-2.5 text-right">Taxable</th>
                  <th className="py-3 px-2.5 text-right">GST</th>
                  <th className="py-3 px-2.5 text-right">Advance Tax</th>
                  <th className="py-3 px-2.5 text-right">Net Total</th>
                  <th className="py-3 px-2.5 text-right">Paid</th>
                  <th className="py-3 px-2.5 text-center">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-10 text-center text-slate-500">
                      No purchase invoices recorded yet.
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr
                      key={p.id}
                      className={
                        p.status === 'cancelled'
                          ? 'bg-rose-50/40 text-slate-400'
                          : 'hover:bg-slate-50'
                      }
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {p.bill_number}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono">{p.bill_date}</td>
                      <td className="py-2.5 px-2.5">
                        <div className="font-bold text-slate-900">{p.supplier_name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {p.supplier_code}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono">
                        {p.supplier_invoice_number || '—'}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.supplier_filer_status === 'Filer'
                              ? 'bg-emerald-100 text-emerald-800'
                              : p.supplier_filer_status === 'Non-Filer'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {p.supplier_filer_status} ({Number(p.advance_tax_rate).toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatPKR(p.taxable_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatPKR(p.gst_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-semibold text-amber-800">
                        {formatPKR(p.advance_tax_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-black text-slate-900">
                        {formatPKR(p.net_total)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                        {formatPKR(p.paid_amount)}
                        <div className="text-[9px] text-slate-400 uppercase">{p.payment_mode}</div>
                      </td>
                      <td className="py-2.5 px-2.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            p.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleExportSinglePurchaseToExcel(p)}
                            className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Export this Purchase Invoice (Summary + Line Items) to Excel (.xlsx)"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Excel</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenPrintInvoice(p.id)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                            title="View / Print A4 Invoice & Journal Entry"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {p.status === 'completed' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditPurchase(p.id)}
                                className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                                title="Edit Invoice (with Reversal Entry)"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelPurchase(p)}
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer"
                                title="Cancel Invoice (with Stock & Accounting Reversal)"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PURCHASE RETURN (DEBIT NOTE) */}
      {subTab === 'purchase-return' && (
        <PurchaseReturnPanel
          suppliers={suppliers}
          financialAccounts={financialAccounts}
          purchases={purchases}
          returns={returns}
          nextReturnNumber={nextReturnNo}
          onReturnCreated={async (newRetId) => {
            await fetchWorkspaceData();
            handleOpenPrintReturn(newRetId);
          }}
          onPrintReturn={handleOpenPrintReturn}
        />
      )}

      {/* TAB 4: BATCH-WISE INVENTORY & STOCK LEDGER */}
      {subTab === 'batch-stock' && (
        <BatchInventoryPanel
          batches={batches}
          loading={loading}
          onRefresh={fetchWorkspaceData}
        />
      )}

      {/* TAB 5: CONFIGURABLE ADVANCE TAX SETTINGS */}
      {subTab === 'advance-tax' && (
        <AdvanceTaxSettingsPanel
          settings={taxSettings}
          history={taxHistory}
          onUpdated={(newSet, newHist) => {
            setTaxSettings(newSet);
            setTaxHistory(newHist);
          }}
        />
      )}

      {/* TAB 6: 8 PURCHASE & TAX REPORTS */}
      {subTab === 'reports' && (
        <PurchaseReportsPanel suppliers={suppliers} items={items} />
      )}

      {/* A4 Print Modal (Purchase Invoice & Purchase Return) */}
      <PurchasePrintModal
        isOpen={printModalOpen}
        autoDirectPrint={autoExportPdfOnOpen}
        onClose={() => {
          setPrintModalOpen(false);
          setAutoExportPdfOnOpen(false);
        }}
        mode={printMode}
        invoice={printInvoice}
        invoiceItems={printInvoiceItems}
        purchaseReturn={printReturn}
        returnItems={printReturnItems}
        journalLines={printJournalLines}
      />

      {/* Custom Excel Export Modal (Purchase Module) */}
      <CustomExcelExportModal
        isOpen={customExportOpen}
        onClose={() => setCustomExportOpen(false)}
        moduleType="PURCHASE"
        records={customExportRecords}
        defaultFilename={`Purchase_Custom_Export_${billDate}.xlsx`}
      />

      {/* Supplier Detailed Account Ledger Modal */}
      {supplierLedgerModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Supplier Account Ledger — [{selectedSupplier.account_code}]{' '}
                  {selectedSupplier.account_name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Previous Balance: {formatPKR(previousSupplierBalance)} ({previousBalanceType}) •
                  Current Purchase Net: {formatPKR(netInvoiceAmount)} • Total Payable:{' '}
                  {formatPKR(totalPayable)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSupplierLedgerModalOpen(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {loadingSupplierLedger ? (
                <div className="py-10 text-center text-slate-500">
                  Loading supplier ledger entries...
                </div>
              ) : supplierLedgerEntries.length === 0 ? (
                <div className="py-10 text-center text-slate-500">
                  No posted ledger entries found for this supplier yet.
                </div>
              ) : (
                <table className="w-full text-left border-collapse border border-slate-200 text-[11px]">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px]">
                    <tr>
                      <th className="p-2 border-b border-slate-200">Date</th>
                      <th className="p-2 border-b border-slate-200">Voucher / Ref #</th>
                      <th className="p-2 border-b border-slate-200">Type</th>
                      <th className="p-2 border-b border-slate-200">Description / Narration</th>
                      <th className="p-2 border-b border-slate-200 text-right">Debit (Paid/Ret)</th>
                      <th className="p-2 border-b border-slate-200 text-right">Credit (Billed)</th>
                      <th className="p-2 border-b border-slate-200 text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {supplierLedgerEntries.map((row: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-2 font-mono">{row.entry_date || row.date || '—'}</td>
                        <td className="p-2 font-mono font-bold text-slate-900">
                          {row.voucher_no || row.reference_no || '—'}
                        </td>
                        <td className="p-2">{row.voucher_type || row.transaction_type || '—'}</td>
                        <td className="p-2 text-slate-600">{row.narration || row.description || '—'}</td>
                        <td className="p-2 text-right font-mono text-emerald-700">
                          {Number(row.debit_amount || row.debit || 0) > 0
                            ? formatPKR(Number(row.debit_amount || row.debit || 0))
                            : '—'}
                        </td>
                        <td className="p-2 text-right font-mono text-rose-700 font-semibold">
                          {Number(row.credit_amount || row.credit || 0) > 0
                            ? formatPKR(Number(row.credit_amount || row.credit || 0))
                            : '—'}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(
                            Math.abs(
                              Number(
                                row.running_balance ?? row.balance ?? prevSupplierNetPayable
                              )
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add New Supplier Modal */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden text-xs">
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">Add New Pharmaceutical Supplier</h3>
                  <p className="text-[11px] text-slate-400">
                    Creates supplier in Chart of Accounts &amp; selects for current Purchase Invoice
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSupplierModal(false)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewSupplier} className="p-5 space-y-4">
              {addSupplierError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="font-semibold">{addSupplierError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-700 text-xs">
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
                    value={newSupplierCode}
                    className="w-full px-3 py-1.5 font-mono font-bold rounded-lg border border-slate-300 bg-slate-100 text-slate-800 cursor-not-allowed select-all"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="block font-bold text-slate-700">
                    Supplier Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="e.g. Premier Distributors / Muller & Phipps"
                    className="w-full px-3 py-1.5 font-bold rounded-lg border border-emerald-500 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">Mobile / Phone Number</label>
                  <input
                    type="text"
                    value={newSupplierMobile}
                    onChange={(e) => setNewSupplierMobile(e.target.value)}
                    placeholder="e.g. 0300-1234567"
                    className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300 bg-white text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">Contact Person</label>
                  <input
                    type="text"
                    value={newSupplierContactPerson}
                    onChange={(e) => setNewSupplierContactPerson(e.target.value)}
                    placeholder="Order Booker / Manager"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">FBR Filer Status</label>
                  <select
                    value={newSupplierFilerStatus}
                    onChange={(e) => setNewSupplierFilerStatus(e.target.value as FilerStatus)}
                    className="w-full px-3 py-1.5 font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  >
                    <option value="Filer">Filer</option>
                    <option value="Non-Filer">Non-Filer</option>
                    <option value="Exempt">Exempt</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">Opening Balance</label>
                  <NumericInput
                    step="0.01"
                    min="0"
                    value={newSupplierOpeningBalance}
                    onChange={(e) => setNewSupplierOpeningBalance(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 font-mono font-bold text-right rounded-lg border border-slate-300 bg-white text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">Balance Type</label>
                  <select
                    value={newSupplierOpeningType}
                    onChange={(e) => setNewSupplierOpeningType(e.target.value as 'Credit' | 'Debit')}
                    className="w-full px-3 py-1.5 font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  >
                    <option value="Credit">Credit (Payable)</option>
                    <option value="Debit">Debit (Advance)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block font-bold text-slate-700">City</label>
                  <PartyCitySelect
                    value={newSupplierCity}
                    onChange={(cityVal) => setNewSupplierCity(cityVal)}
                    placeholder="Search or select city..."
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="block font-bold text-slate-700">Address</label>
                  <input
                    type="text"
                    value={newSupplierAddress}
                    onChange={(e) => setNewSupplierAddress(e.target.value)}
                    placeholder="Office / Warehouse Address"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingSupplier}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{creatingSupplier ? 'Saving...' : 'Save & Select Supplier'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: HELD & DRAFT PURCHASE INVOICES ================= */}
      {showHeldModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-3xl p-5 text-xs space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                  <PauseCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Held &amp; Draft Purchase Invoices ({heldPurchases.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Saved pending purchase drafts. Stock and supplier ledger are NOT affected until confirmed.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHeldModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg min-h-0">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2">Draft Bill #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2 text-center">Items / Packs</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Net Amount</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingHeld && heldPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-500">
                        <p className="font-semibold">Loading held purchase invoices from active database...</p>
                      </td>
                    </tr>
                  ) : heldPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        <PauseCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-semibold text-slate-600">No held purchase invoices</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Click "Hold (F3)" while entering a purchase to temporarily hold it without updating stock or accounts.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    heldPurchases.map((h) => (
                      <tr
                        key={h.id}
                        onClick={() => handleResumeHeldPurchase(h.id)}
                        onDoubleClick={() => handleResumeHeldPurchase(h.id)}
                        className="hover:bg-amber-50/70 transition-colors cursor-pointer"
                        title="Click or double-click to open this held purchase invoice in the datasheet"
                      >
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{h.bill_number}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{h.bill_date}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">
                          {h.supplier_name || 'Unspecified Supplier'}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-slate-600">
                          {h.item_count ?? '—'} Items ({h.total_packs ?? '—'} Pk)
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">
                            {h.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(h.net_total ?? (h as any).total_amount ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResumeHeldPurchase(h.id);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer text-[10px]"
                            title="Resume this draft in datasheet"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDiscardHeldPurchase(h.id, h.bill_number);
                            }}
                            className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold cursor-pointer text-[10px]"
                            title="Discard draft permanently"
                          >
                            Discard
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
              <span>Total Drafts: {heldPurchases.length}</span>
              <button
                type="button"
                onClick={() => setShowHeldModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: PURCHASE PRICE CHANGE & RETAIL PRICE UPDATE CONFIRMATION ================= */}
      {priceChangePrompt && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelPriceChangePrompt();
            }
          }}
        >
          <div
            ref={priceDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Purchase Price Update Confirmation"
            tabIndex={-1}
            onKeyDown={handlePriceDialogKeyDown}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden text-xs focus:outline-none"
          >
            {priceChangePrompt.step === 'confirm_purchase' ? (
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">
                      Purchase price has changed. Do you want to update Item Master?
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Compare entered purchase rate against Item Master record. Item Master is updated only when this invoice is saved. Historical invoices are never modified.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500 font-semibold">Item:</span>
                    <span className="font-bold text-slate-900 text-right">
                      {priceChangePrompt.itemName}{' '}
                      <span className="font-mono text-[10px] text-emerald-700">
                        [{priceChangePrompt.itemCode}]
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-semibold">Old Purchase Price:</span>
                    <span className="font-mono font-bold text-slate-700 text-sm">
                      Rs. {priceChangePrompt.oldPurchasePrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="price_dialog_new_purchase_price"
                      className="text-slate-900 font-bold"
                    >
                      New Purchase Price:
                    </label>
                    <div className="relative w-32">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-emerald-600">
                        Rs.
                      </span>
                      <NumericInput
                        id="price_dialog_new_purchase_price"
                        ref={priceDialogPurchaseInputRef}
                        value={priceChangePrompt.newPurchasePrice}
                        onChange={(e) => {
                          const nextPurchase = Math.max(0, parseFloat(e.target.value) || 0);
                          const nextPricing = calculateItemPricingFromPurchase(
                            nextPurchase,
                            priceChangePrompt.packing
                          );
                          setPriceChangePrompt((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  newPurchasePrice: nextPurchase,
                                  retailBase: nextPricing.retailPrice,
                                  newRetailPrice: nextPricing.retailPrice,
                                  newLooseRate: nextPricing.looseRate,
                                }
                              : null
                          );
                        }}
                        className="w-full pl-8 pr-2 py-1 text-right font-mono font-black text-emerald-800 text-sm rounded-lg border border-emerald-400 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400">
                    Tab: Navigate • Enter: Confirm • Esc: Cancel
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={updatingItemMasterPrice}
                      onClick={handleKeepOldPurchasePrice}
                      className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 text-slate-800 font-bold cursor-pointer outline-none"
                    >
                      NO – Keep Old
                    </button>
                    <button
                      type="button"
                      disabled={updatingItemMasterPrice}
                      onClick={handleApprovePurchasePriceStep1}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 focus:ring-2 focus:ring-emerald-400 text-white font-bold shadow-sm cursor-pointer outline-none"
                    >
                      YES – Update
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">
                      Do you also want to update Retail Price?
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Formula: Retail = New Purchase Price ÷ 0.85 (2 decimals) &amp; Loose Rate = Retail ÷ Units Per Pack.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <span className="text-slate-500 font-semibold">Item &amp; Packing:</span>
                    <span className="font-bold text-slate-900">
                      {priceChangePrompt.itemName} ({priceChangePrompt.packing} •{' '}
                      {priceChangePrompt.unitsPerPack} units/pack)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">New Purchase Price:</span>
                    <span className="font-mono font-bold text-slate-800">
                      Rs. {priceChangePrompt.newPurchasePrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                    <div>
                      <label
                        htmlFor="price_dialog_new_retail_price"
                        className="font-bold text-emerald-950 block"
                      >
                        New Retail Price (Purchase ÷ 0.85):
                      </label>
                      <div className="text-[10px] text-slate-500">
                        Current Retail: Rs. {priceChangePrompt.oldRetailPrice.toFixed(2)}
                      </div>
                    </div>
                    <div className="relative w-32 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-mono text-emerald-600">
                        Rs.
                      </span>
                      <NumericInput
                        id="price_dialog_new_retail_price"
                        ref={priceDialogRetailInputRef}
                        value={priceChangePrompt.newRetailPrice}
                        onChange={(e) => {
                          const nextRetail = Math.max(0, parseFloat(e.target.value) || 0);
                          setPriceChangePrompt((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  newRetailPrice: nextRetail,
                                  newLooseRate: prev.looseRateManuallyEdited
                                    ? prev.newLooseRate
                                    : calculateLooseRateFromRetail(nextRetail, prev.packing),
                                }
                              : null
                          );
                        }}
                        className="w-full pl-7 pr-2 py-1 text-right font-mono font-black text-emerald-800 text-sm rounded-lg border border-emerald-400 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                    <div>
                      <label
                        htmlFor="price_dialog_new_loose_rate"
                        className="font-bold text-blue-950 block"
                      >
                        New Loose Rate (÷ {priceChangePrompt.unitsPerPack} units):
                      </label>
                      <div className="text-[10px] text-slate-500">
                        Current Loose Rate: Rs. {priceChangePrompt.oldLooseRate.toFixed(2)}
                      </div>
                    </div>
                    <div className="relative w-32 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-mono text-blue-600">
                        Rs.
                      </span>
                      <NumericInput
                        id="price_dialog_new_loose_rate"
                        ref={priceDialogLooseInputRef}
                        value={priceChangePrompt.newLooseRate}
                        onChange={(e) => {
                          const nextLoose = Math.max(0, parseFloat(e.target.value) || 0);
                          setPriceChangePrompt((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  newLooseRate: nextLoose,
                                  looseRateManuallyEdited: true,
                                }
                              : null
                          );
                        }}
                        className="w-full pl-7 pr-2 py-1 text-right font-mono font-black text-blue-800 text-sm rounded-lg border border-blue-400 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={updatingItemMasterPrice}
                    onClick={() => handleFinalPriceCascadeDecision(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 text-slate-800 font-bold cursor-pointer disabled:opacity-50 outline-none"
                  >
                    NO – Keep Existing Retail
                  </button>
                  <button
                    type="button"
                    disabled={updatingItemMasterPrice}
                    onClick={() => handleFinalPriceCascadeDecision(true)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 focus:ring-2 focus:ring-emerald-400 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50 outline-none"
                  >
                    {updatingItemMasterPrice ? 'Updating...' : 'YES – Update Retail & Loose Rate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Purchase Order SMS Modal (Always asks user for recipient number manually) */}
      {showPurchaseSmsModal && (
        <InvoiceSmsModal
          isOpen={showPurchaseSmsModal}
          mode="purchase"
          title="Send Order SMS — Purchase Invoice"
          initialPhone=""
          isPhoneFromAccounts={false}
          initialMessage={purchaseSmsText}
          onClose={() => setShowPurchaseSmsModal(false)}
        />
      )}

      {/* Shared Item Selection List Modal (Reused from Sales Module) */}
      <ItemListSelectionModal
        isOpen={showPurchaseItemListModal}
        items={items}
        indexedItems={indexedPurchaseItems}
        targetRowIndex={purchaseItemListTargetRowIdx}
        targetRowItem={
          purchaseItemListTargetRowIdx !== null
            ? lines[purchaseItemListTargetRowIdx]
            : null
        }
        invoiceLabel="Purchase Invoice"
        getItemRate={(it) =>
          round2(
            Number(it.purchase_price) ||
              Number(it.trade_price) ||
              Number(it.retail_price) ||
              0
          )
        }
        getItemStock={(it) =>
          it.consolidated_stock_packs !== undefined && Number(it.has_variants || 0) === 1
            ? Number(it.consolidated_stock_packs || 0)
            : stockPacksByItemId.has(Number(it.id))
            ? stockPacksByItemId.get(Number(it.id)) || 0
            : Number(it.opening_stock || 0)
        }
        onSelectItem={handleSelectItemFromPurchaseListModal}
        onSwitchToAddNewLine={() => setPurchaseItemListTargetRowIdx(null)}
        onClose={closePurchaseItemListModal}
      />

      <DuplicateItemConfirmModal
        isOpen={Boolean(pendingDuplicatePrompt)}
        itemName={
          pendingDuplicatePrompt
            ? pendingDuplicatePrompt.variant
              ? `${pendingDuplicatePrompt.item.item_name} — ${pendingDuplicatePrompt.variant.variant_name}`
              : pendingDuplicatePrompt.item.item_name
            : undefined
        }
        itemCode={
          pendingDuplicatePrompt?.variant?.variant_code || pendingDuplicatePrompt?.item.item_code
        }
        onConfirmNewRow={handleConfirmAddDuplicatePurchaseRow}
        onCancel={handleCancelDuplicatePurchasePrompt}
      />

      <VariantPickerModal
        isOpen={Boolean(pendingVariantPicker)}
        parentItem={pendingVariantPicker?.item || null}
        variants={getActiveVariants(pendingVariantPicker?.item)}
        mode="purchase"
        onSelectVariant={(variant) => {
          const pending = pendingVariantPicker;
          setPendingVariantPicker(null);
          if (!pending) return;
          if (pending.fromTopSearch) {
            handleSelectPurchaseSearchItem(pending.item, variant);
          } else {
            const targetIdx =
              pending.targetRowIdx !== null
                ? pending.targetRowIdx
                : (() => {
                    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
                    return emptyIdx >= 0 ? emptyIdx : lines.length;
                  })();
            populatePurchaseRowWithItem(targetIdx, pending.item, pending.focusQty, variant);
          }
        }}
        onClose={() => setPendingVariantPicker(null)}
      />

      <ItemLogModal
        isOpen={itemLogModalState.isOpen}
        itemId={itemLogModalState.itemId}
        initialItemCode={itemLogModalState.itemCode}
        initialItemName={itemLogModalState.itemName}
        defaultTab="purchases"
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

      {f9ItemMasterState.isOpen && f9ItemMasterState.editingItem && (
        <ItemFormModal
          isOpen={f9ItemMasterState.isOpen}
          editingItem={f9ItemMasterState.editingItem}
          onClose={() => {
            const focusId = f9ItemMasterState.returnFocusId;
            setF9ItemMasterState((prev) => ({ ...prev, isOpen: false, editingItem: null }));
            if (focusId) {
              window.setTimeout(() => {
                const el = document.getElementById(focusId) as HTMLInputElement | null;
                el?.focus();
                if (el && typeof el.select === 'function') el.select();
              }, 25);
            }
          }}
          onSaved={(updatedItem: Item) => {
            const focusId = f9ItemMasterState.returnFocusId;
            setItems((prev) =>
              prev.map((it) => (Number(it.id) === Number(updatedItem.id) ? updatedItem : it))
            );
            setLines((prevLines) =>
              prevLines.map((l) => {
                if (Number(l.item_id) !== Number(updatedItem.id)) return l;
                const isVariantRow = Boolean(l.variant_id && Number(l.variant_id) > 0);
                const updatedVariants = Array.isArray(updatedItem.variants)
                  ? updatedItem.variants
                  : [];
                const matchedVar = isVariantRow
                  ? updatedVariants.find((v) => Number(v.id) === Number(l.variant_id))
                  : null;
                const useParentPricing =
                  !matchedVar || Number(matchedVar.use_parent_pricing ?? 1) === 1;
                const resolvedPacking =
                  (!useParentPricing && matchedVar?.effective_packing) ||
                  matchedVar?.packing ||
                  updatedItem.packing ||
                  l.packing ||
                  '1x1';
                const upp = Math.max(
                  1,
                  Number((updatedItem as any).units_per_pack || parseUnitsPerPack(resolvedPacking))
                );
                const masterPurchasePrice = round2(
                  !useParentPricing && matchedVar
                    ? Number(matchedVar.effective_purchase_price ?? matchedVar.purchase_price ?? l.purchase_rate)
                    : Number(updatedItem.purchase_price ?? l.purchase_rate)
                );
                const masterRetailPrice = round2(
                  !useParentPricing && matchedVar
                    ? Number(matchedVar.effective_retail_price ?? matchedVar.retail_price ?? l.mrp_rate)
                    : Number(updatedItem.retail_price ?? l.mrp_rate)
                );
                const shouldSyncRate =
                  Math.abs(Number(l.purchase_rate || 0) - Number(l.master_purchase_price || 0)) < 0.01;
                const nextRate = shouldSyncRate ? masterPurchasePrice : Number(l.purchase_rate || 0);
                const nextLooseRate = l.is_loose_rate_manual
                  ? Number(l.loose_rate || 0)
                  : round2(nextRate / upp);
                const qty = Math.max(0, round2(Number(l.quantity) || 0));
                const looseQty = Math.max(0, round2(Number(l.loose_quantity) || 0));
                const gross = round2(qty * nextRate + looseQty * nextLooseRate);
                const discPct = Math.max(0, round2(Number(l.discount_percent) || 0));
                const discAmt = round2(gross * (discPct / 100));
                const taxable = round2(gross - discAmt);
                const taxPct = Math.max(
                  0,
                  round2(
                    Number(updatedItem.tax_percent ?? l.tax_percent ?? 0)
                  )
                );
                const taxAmt = round2(taxable * (taxPct / 100));
                const net = round2(taxable + taxAmt);

                return {
                  ...l,
                  item_code: matchedVar?.variant_code || updatedItem.item_code || l.item_code,
                  company_name: updatedItem.company_name || l.company_name,
                  item_name: updatedItem.item_name || l.item_name,
                  barcode: matchedVar?.barcode || updatedItem.barcode || l.barcode,
                  packing: resolvedPacking,
                  units_per_pack: upp,
                  purchase_rate: nextRate,
                  loose_rate: nextLooseRate,
                  mrp_rate: masterRetailPrice,
                  master_purchase_price: masterPurchasePrice,
                  master_retail_price: masterRetailPrice,
                  last_prompted_purchase_rate: nextRate,
                  gross_amount: gross,
                  discount_amount: discAmt,
                  taxable_amount: taxable,
                  tax_percent: taxPct,
                  tax_amount: taxAmt,
                  line_total: net,
                };
              })
            );
            setF9ItemMasterState((prev) => ({ ...prev, isOpen: false, editingItem: null }));
            setFormSuccess(`Item "${updatedItem.item_name}" updated in Item Master.`);
            if (focusId) {
              window.setTimeout(() => {
                const el = document.getElementById(focusId) as HTMLInputElement | null;
                el?.focus();
                if (el && typeof el.select === 'function') el.select();
              }, 35);
            }
          }}
        />
      )}

      {/* Manual Net Amount Entry Dialog (Triggered by pressing Ctrl in Purchase Item Name field) */}
      {netAmountModalState.isOpen && (
        <div
          className="fixed inset-0 z-[75] bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              handleCloseNetAmountModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-manual-net-amount-title"
            className="bg-white rounded-xl border border-slate-300 shadow-2xl w-full max-w-sm overflow-hidden text-xs"
          >
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 id="purchase-manual-net-amount-title" className="text-xs font-bold">
                  Manual Net Amount Entry
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseNetAmountModal}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm font-bold text-slate-900">
                Kindly input net amount.
              </p>

              {lines[netAmountModalState.rowIndex] && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-[11px]">
                  <div className="truncate">
                    <span className="text-slate-500">Item: </span>
                    <span className="font-bold text-slate-900">
                      {lines[netAmountModalState.rowIndex]?.item_name || 'Not selected'}
                    </span>
                  </div>
                  <div className="shrink-0 font-mono">
                    <span className="text-slate-500">Qty: </span>
                    <span className="font-bold text-emerald-700">
                      {Number(lines[netAmountModalState.rowIndex]?.quantity || 0)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="purchase_manual_net_amount_input"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Total Net Amount (Rs.)
                </label>
                <input
                  id="purchase_manual_net_amount_input"
                  ref={netAmountInputRef}
                  type="number"
                  step="any"
                  min="0"
                  autoFocus
                  value={netAmountModalState.inputValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNetAmountModalState((prev) => ({
                      ...prev,
                      inputValue: val,
                      error: null,
                    }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleConfirmNetAmount();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCloseNetAmountModal();
                    }
                  }}
                  placeholder="e.g. 6000"
                  className="w-full px-3 py-2 text-right font-mono font-bold text-sm text-slate-900 rounded-lg border border-emerald-500 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {netAmountModalState.error && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2 text-[11px] font-semibold"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{netAmountModalState.error}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseNetAmountModal}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel (Esc)
                </button>
                <button
                  type="button"
                  onClick={handleConfirmNetAmount}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  Confirm (Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
