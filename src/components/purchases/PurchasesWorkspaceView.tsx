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
} from 'lucide-react';
import { Item } from '../../types/item';
import { Account, FilerStatus } from '../../types/account';
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
import { prepareItemIndex, searchItems } from '../../utils/itemSearch';
import { PurchasePrintModal } from './PurchasePrintModal';
import { AdvanceTaxSettingsPanel } from './AdvanceTaxSettingsPanel';
import { BatchInventoryPanel } from './BatchInventoryPanel';
import { PurchaseReturnPanel } from './PurchaseReturnPanel';
import { PurchaseReportsPanel } from './PurchaseReportsPanel';
import { NumericInput } from '../common/NumericInput';
import { exportPurchaseInvoicesToExcel } from '../../utils/invoiceExcelExport';
import { InvoiceSmsModal } from '../common/InvoiceSmsModal';
import { ItemListSelectionModal } from '../common/ItemListSelectionModal';
import { generatePurchaseOrderSmsText } from '../../utils/invoiceSms';

export type PurchaseSubTab =
  | 'new-invoice'
  | 'register'
  | 'purchase-return'
  | 'batch-stock'
  | 'advance-tax'
  | 'reports';

interface PurchasesWorkspaceViewProps {
  initialSubTab?: PurchaseSubTab;
  onBackToDashboard?: () => void;
}

const INITIAL_PURCHASE_ROWS = 1;
const PURCHASE_HEADER_HEIGHT_PX = 18;
const PURCHASE_ROW_HEIGHT_PX = 24;
const ACTIVE_PURCHASE_DRAFT_KEY = 'ams_active_purchase_draft_v2';

const round2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function parseUnitsPerPack(packing?: string): number {
  const clean = (packing || '1x1').trim().toLowerCase();
  const m = clean.match(/(\d+)\s*[xX*×]\s*(\d+)/);
  if (m) {
    return Math.max(1, (parseInt(m[1], 10) || 1) * (parseInt(m[2], 10) || 1));
  }
  const singleMatch = clean.match(
    /(\d+)\s*(tab|cap|sachet|amp|vial|strip|pack|unit|pc|pill|softgel|lozenge|'s|s\b)/i
  );
  if (singleMatch) {
    return Math.max(1, parseInt(singleMatch[1], 10) || 1);
  }
  if (!/ml|mg|gm|g\b|kg|l\b|oz|drop|syr|susp|cream|oint|gel|lotion|inj|inf/i.test(clean)) {
    const s = clean.match(/^(\d+)$/);
    if (s) return Math.max(1, parseInt(s[1], 10) || 1);
  }
  return 1;
}

// Retail = Purchase Price ÷ 0.85 (e.g. 102 -> 120.00, 89.3775 -> 105.15), kept to 2 decimals.
// No rounding to 50/100: only normal rounding to 2 decimal places.
const RETAIL_PRICE_DIVISOR = 0.85;

function calculateRetailFromPurchasePrice(newPurchasePrice: number): {
  retailBase: number;
  roundedRetailPrice: number;
} {
  const p = Math.max(0, Number(newPurchasePrice) || 0);
  const retailBase = p > 0 ? round2(p / RETAIL_PRICE_DIVISOR) : 0;
  return { retailBase, roundedRetailPrice: retailBase };
}

export const createBlankPurchaseLine = (): PurchaseLineItem => ({
  item_id: 0,
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

function ensureMinimumPurchaseRows(
  inputLines: PurchaseLineItem[],
  _minCount: number = INITIAL_PURCHASE_ROWS,
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
  // Keep only populated rows plus one ready-to-use blank row so searching never spawns empty rows
  const desiredCount = Math.max(1, lastPopulatedIdx >= 0 ? lastPopulatedIdx + 2 : 1);

  while (result.length < desiredCount) {
    result.push(createBlankPurchaseLine());
  }
  while (result.length > desiredCount && !isPurchaseLinePopulated(result[result.length - 1])) {
    result.pop();
  }
  return result;
}

export const PurchasesWorkspaceView: React.FC<PurchasesWorkspaceViewProps> = ({
  initialSubTab = 'new-invoice',
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
  const [nextPurchaseNo, setNextPurchaseNo] = useState('Inv-2026-11-01');
  const [nextReturnNo, setNextReturnNo] = useState('PRN-2026-0001');
  const [loading, setLoading] = useState(false);

  // Purchase Invoice Form State
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [billNumber, setBillNumber] = useState('Inv-2026-11-01');
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
  // In POS mode, lower datasheet keyboard navigation is enabled only after
  // the user deliberately clicks inside that datasheet with the mouse.
  const posDatasheetMouseActivatedRef = useRef(false);

  // Responsive Datasheet Lines (Automatically sized to fit screen height)
  const [lines, setLines] = useState<PurchaseLineItem[]>(() =>
    ensureMinimumPurchaseRows([], INITIAL_PURCHASE_ROWS)
  );
  const [draftRestored, setDraftRestored] = useState(false);

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
    posDatasheetMouseActivatedRef.current = false;
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
  const [rowItemSearchQuery, setRowItemSearchQuery] = useState<string>('');
  const [rowItemHighlightIndex, setRowItemHighlightIndex] = useState<number>(0);
  const purchaseSearchReqIdRef = useRef<number>(0);

  // Shared Item Selection List Modal State (Reuses Sales ItemListSelectionModal)
  const [showPurchaseItemListModal, setShowPurchaseItemListModal] = useState<boolean>(false);
  const [purchaseItemListTargetRowIdx, setPurchaseItemListTargetRowIdx] = useState<number | null>(null);
  const suppressItemListReopenRef = useRef<boolean>(false);
  const purchaseItemListOriginRef = useRef<'pos_row' | 'access_row' | 'top'>('top');
  const lastPurchaseItemListTriggerElIdRef = useRef<string | null>(null);

  useEffect(() => {
    setPurchaseRecordJumpInput(String(selectedPurchaseLineIndex + 1));
  }, [selectedPurchaseLineIndex]);

  const [savingInvoice, setSavingInvoice] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Print Modal State
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'invoice' | 'return'>('invoice');
  const [printInvoice, setPrintInvoice] = useState<PurchaseInvoice | null>(null);
  const [printInvoiceItems, setPrintInvoiceItems] = useState<PurchaseLineItem[]>([]);
  const [printReturn, setPrintReturn] = useState<PurchaseReturn | null>(null);
  const [printReturnItems, setPrintReturnItems] = useState<PurchaseReturnLineItem[]>([]);
  const [printJournalLines, setPrintJournalLines] = useState<JournalEntryLineView[]>([]);

  const selectedPurchaseLineIndexRef = useRef<number>(0);
  useEffect(() => {
    selectedPurchaseLineIndexRef.current = selectedPurchaseLineIndex;
  }, [selectedPurchaseLineIndex]);

  // Automatically measure available Purchase Item Datasheet height and recalculate visible rows on mount & browser resize
  const recalculateDatasheetRowCapacity = useCallback(() => {
    if (subTab !== 'new-invoice') return;
    const viewportEl =
      purchaseViewMode === 'pos' ? posGridViewportRef.current : accessGridViewportRef.current;
    if (!viewportEl) return;

    const availableHeight = viewportEl.clientHeight;
    if (availableHeight <= 0) return;

    const bodyHeight = Math.max(0, availableHeight - PURCHASE_HEADER_HEIGHT_PX);
    const fittingRows = Math.max(3, Math.floor(bodyHeight / PURCHASE_ROW_HEIGHT_PX));

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
          if (parsed.notes) setNotes(String(parsed.notes));
          if (parsed.invoiceDiscountPercent) setInvoiceDiscountPercent(Number(parsed.invoiceDiscountPercent));
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
      if (hasItems || supplierInvoiceNumber || notes) {
        localStorage.setItem(
          ACTIVE_PURCHASE_DRAFT_KEY,
          JSON.stringify({
            lines,
            supplierId,
            supplierInvoiceNumber,
            supplierFilerStatus,
            billDate,
            paymentMode,
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
    notes,
    invoiceDiscountPercent,
  ]);

  // Resilient Master Data & Transactions Loader (Each promise catches individually like Sales!)
  const fetchWorkspaceData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch next auto purchase invoice & return numbers
      const nextNumsRes = await api.getNextPurchaseNumbers(billDate).catch(() => ({
        success: true,
        nextPurchaseNumber: 'Inv-2026-11-01',
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
        api.getPurchases().catch(() => ({ purchases: [] })),
        api.getPurchases({ status: 'held_or_draft' }).catch(() => ({ purchases: [] })),
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

      // Auto-select first supplier if none selected yet (just like Sales auto-selects default Customer!)
      // Never auto-select a supplier: a new invoice must start with an empty supplier field.
      setSupplierId((prevSupId) =>
        prevSupId && supList.some((s) => String(s.id) === String(prevSupId)) ? prevSupId : ''
      );

      const finList = allAccounts.filter((a) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );
      setFinancialAccounts(finList);

      if (taxRes.settings) setTaxSettings(taxRes.settings);
      setTaxHistory(taxRes.history || []);

      if (nextNumsRes.nextPurchaseNumber) {
        setNextPurchaseNo(nextNumsRes.nextPurchaseNumber);
        if (!editingPurchaseId) {
          setBillNumber(nextNumsRes.nextPurchaseNumber);
          setSupplierInvoiceNumber((prev) => prev || nextNumsRes.nextPurchaseNumber);
        }
      }
      if (nextNumsRes.nextReturnNumber) {
        setNextReturnNo(nextNumsRes.nextReturnNumber);
      }

      setPurchases(purchasesRes.purchases || []);
      setHeldPurchases(heldRes.purchases || []);
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
      const res = await api.getPurchases({ status: 'held_or_draft' });
      setHeldPurchases(res.purchases || []);
    } catch {
      // ignore
    } finally {
      setLoadingHeld(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaceData();
  }, [fetchWorkspaceData]);

  // Automatically update next read-only Purchase Invoice Number when billDate month/year changes on a new invoice
  useEffect(() => {
    if (editingPurchaseId) return;
    let active = true;
    api
      .getNextPurchaseNumbers(billDate)
      .then((res) => {
        if (active && res.nextPurchaseNumber) {
          setBillNumber(res.nextPurchaseNumber);
          setNextPurchaseNo(res.nextPurchaseNumber);
          setSupplierInvoiceNumber((prev) =>
            !prev || prev.startsWith('Inv-') || prev.startsWith('PUR-') ? res.nextPurchaseNumber : prev
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [billDate, editingPurchaseId]);

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
      if (!q) {
        return showDefaultWhenEmpty ? items.slice(0, 40) : [];
      }
      return searchItems(indexedPurchaseItems, q, 50);
    },
    [items, indexedPurchaseItems]
  );

  const purchaseSearchResults = useMemo(
    () => computeFilteredItems(purchaseSearchQuery, true),
    [computeFilteredItems, purchaseSearchQuery]
  );

  const rowItemSearchResults = useMemo(
    () => computeFilteredItems(rowItemSearchQuery, true),
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

  // Select Supplier & automatically focus Item Search
  const handleSelectSupplierFromDropdown = (sup: Account) => {
    setSupplierId(String(sup.id));
    setSupplierFilerStatus(sup.filer_status || 'Filer');
    const mobilePart = sup.phone ? ` (${sup.phone})` : '';
    setSupplierSearchQuery(`[${sup.account_code}] ${sup.account_name}${mobilePart}`);
    setIsSupplierDropdownOpen(false);
    setSupplierHighlightIndex(0);
    setTimeout(() => {
      itemSearchInputRef.current?.focus();
      itemSearchInputRef.current?.select?.();
    }, 25);
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
        itemSearchInputRef.current?.focus();
        itemSearchInputRef.current?.select?.();
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

  // Build a populated PurchaseLineItem from an Item record (Default Quantity = 0)
  const buildPopulatedLineFromItem = (
    found: Item,
    existingRow?: Partial<PurchaseLineItem>
  ): PurchaseLineItem => {
    const rate = round2(
      Number(found.purchase_price) || Number(found.trade_price) || Number(found.retail_price) || 0
    );
    const unitsPerPack = Math.max(1, parseUnitsPerPack(found.packing));
    const qty = existingRow?.quantity && existingRow.quantity > 0 ? existingRow.quantity : 0;
    const looseQty =
      existingRow?.loose_quantity && existingRow.loose_quantity > 0
        ? round2(existingRow.loose_quantity)
        : 0;
    const bonusQty =
      existingRow?.bonus_quantity && existingRow.bonus_quantity > 0 ? existingRow.bonus_quantity : 0;
    const defaultLooseRate = round2(rate / unitsPerPack);
    const looseRate =
      existingRow?.loose_rate !== undefined && existingRow.loose_rate > 0
        ? round2(existingRow.loose_rate)
        : defaultLooseRate;
    const discPct = round2(found.discount_percent || 0);
    const taxPct = round2(found.tax_percent || 0);
    const gross = round2(qty * rate + looseQty * looseRate);
    const discAmt = round2(gross * (discPct / 100));
    const taxable = round2(gross - discAmt);
    const taxAmt = round2(taxable * (taxPct / 100));
    const net = round2(taxable + taxAmt);

    return {
      item_id: found.id,
      item_code: found.item_code,
      company_name: found.company_name,
      item_name: found.item_name,
      packing: found.packing || '1x1',
      units_per_pack: unitsPerPack,
      batch_number: existingRow?.batch_number || `B-${found.item_code}-01`,
      manufacturing_date: existingRow?.manufacturing_date || '2026-01-01',
      expiry_date: existingRow?.expiry_date || '2028-12-31',
      quantity: qty,
      loose_quantity: looseQty,
      bonus_quantity: bonusQty,
      purchase_rate: rate,
      loose_rate: looseRate,
      is_loose_rate_manual: Boolean(existingRow?.is_loose_rate_manual),
      mrp_rate: round2(found.retail_price || 0),
      gross_amount: gross,
      discount_percent: discPct,
      discount_amount: discAmt,
      taxable_amount: taxable,
      tax_percent: taxPct,
      tax_amount: taxAmt,
      line_total: net,
      master_purchase_price: rate,
      master_retail_price: round2(found.retail_price || 0),
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
    nextFocusTargetId?: string;
  } | null>(null);
  const [updatingItemMasterPrice] = useState(false);

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
    const row = lines[rowIdx];
    if (!row || !row.item_id || row.item_id <= 0) return false;

    const masterItem = items.find((it) => it.id === row.item_id);
    const oldPurchasePrice = round2(
      masterItem
        ? Number(masterItem.purchase_price || 0)
        : Number(row.master_purchase_price || 0)
    );
    const newPurchasePrice = round2(Number(row.purchase_rate || 0));

    if (newPurchasePrice <= 0 || Math.abs(newPurchasePrice - oldPurchasePrice) < 0.01) {
      return false;
    }

    if (
      row.last_prompted_purchase_rate !== undefined &&
      Math.abs(row.last_prompted_purchase_rate - newPurchasePrice) < 0.01
    ) {
      return false;
    }

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

    const packingStr = masterItem?.packing || row.packing || '1x1';
    const unitsPerPack = Math.max(1, parseUnitsPerPack(packingStr));
    const { retailBase, roundedRetailPrice } = calculateRetailFromPurchasePrice(newPurchasePrice);
    const oldRetailPrice = round2(
      masterItem
        ? Number(masterItem.retail_price || 0)
        : Number(row.master_retail_price || row.mrp_rate || 0)
    );
    const oldLooseRate = round2(
      masterItem && Number(masterItem.loose_rate || 0) > 0
        ? Number(masterItem.loose_rate)
        : oldRetailPrice / unitsPerPack
    );
    const newLooseRate = round2(roundedRetailPrice / unitsPerPack);

    setPriceChangePrompt({
      step: 'confirm_purchase',
      rowIndex: rowIdx,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      companyName: row.company_name || masterItem?.company_name || '',
      packing: packingStr,
      unitsPerPack,
      oldPurchasePrice,
      newPurchasePrice,
      retailBase,
      oldRetailPrice,
      newRetailPrice: roundedRetailPrice,
      oldLooseRate,
      newLooseRate,
      nextFocusTargetId,
    });

    return true;
  };

  // Step 1 NO – Keep Old Item Master Purchase Price (save new price in current purchase invoice only)
  const handleKeepOldPurchasePrice = () => {
    if (!priceChangePrompt) return;
    const prompt = priceChangePrompt;
    setLines((prev) => {
      const next = [...prev];
      if (next[prompt.rowIndex]) {
        next[prompt.rowIndex] = {
          ...next[prompt.rowIndex],
          last_prompted_purchase_rate: prompt.newPurchasePrice,
          update_master_purchase_price: false,
          update_master_retail_price: false,
        };
      }
      return next;
    });
    setFormSuccess(
      `Kept old Item Master Purchase Price (Rs. ${prompt.oldPurchasePrice.toFixed(
        2
      )}) for "${prompt.itemName}". New rate Rs. ${prompt.newPurchasePrice.toFixed(
        2
      )} saved in this purchase invoice only.`
    );
    setPriceChangePrompt(null);
    focusTargetElementById(prompt.nextFocusTargetId);
  };

  // Step 1 YES – Update Purchase Price -> Proceed to Step 2 ("Do you also want to update Retail Price?")
  const handleApprovePurchasePriceStep1 = () => {
    if (!priceChangePrompt) return;
    setPriceChangePrompt({
      ...priceChangePrompt,
      step: 'confirm_retail',
    });
  };

  // Step 2 Decision: the Item Master is NOT touched here. The decision is remembered on the
  // invoice line and applied only after the invoice is saved (see applyDeferredMasterPriceUpdates).
  const handleFinalPriceCascadeDecision = (updateRetail: boolean) => {
    if (!priceChangePrompt) return;
    const prompt = priceChangePrompt;
    setLines((prev) => {
      const next = [...prev];
      if (next[prompt.rowIndex]) {
        next[prompt.rowIndex] = {
          ...next[prompt.rowIndex],
          mrp_rate: updateRetail ? prompt.newRetailPrice : next[prompt.rowIndex].mrp_rate,
          master_purchase_price: prompt.newPurchasePrice,
          master_retail_price: updateRetail ? prompt.newRetailPrice : prompt.oldRetailPrice,
          last_prompted_purchase_rate: prompt.newPurchasePrice,
          update_master_purchase_price: true,
          update_master_retail_price: updateRetail,
        };
      }
      return next;
    });
    setFormSuccess(
      updateRetail
        ? `"${prompt.itemName}": Item Master will be updated when this invoice is saved — Purchase Rs. ${prompt.newPurchasePrice.toFixed(
            2
          )}, Retail Rs. ${prompt.newRetailPrice.toFixed(2)}, Loose Rs. ${prompt.newLooseRate.toFixed(2)}.`
        : `"${prompt.itemName}": Item Master Purchase Price will be updated to Rs. ${prompt.newPurchasePrice.toFixed(
            2
          )} when this invoice is saved. Retail Price (Rs. ${prompt.oldRetailPrice.toFixed(2)}) stays unchanged.`
    );
    setPriceChangePrompt(null);
    focusTargetElementById(prompt.nextFocusTargetId);
  };

  // Populate a specific row with an Item (used by Item Selection List modal & inline cells, preventing unnecessary duplicates)
  const populatePurchaseRowWithItem = (idx: number, found: Item, fromPosRow: boolean = true) => {
    const existingDuplicateIdx = lines.findIndex((l, i) => i !== idx && l.item_id === found.id);
    if (existingDuplicateIdx >= 0) {
      // Clear current row if it was empty and jump to the already-added item's Quantity field
      setLines((prev) => {
        const copy = [...prev];
        if (!copy[idx]?.item_id || copy[idx].item_id === 0) {
          copy[idx] = createBlankPurchaseLine();
        }
        return copy;
      });
      setSelectedPurchaseLineIndex(existingDuplicateIdx);
      setActiveRowItemSearchIdx(null);
      setRowItemSearchQuery('');
      setPurchaseSearchQuery('');
      setShowPurchaseSearchDropdown(false);
      if (purchaseViewMode === 'pos' && fromPosRow) {
        posDatasheetMouseActivatedRef.current = true;
      }
      setTimeout(() => {
        if (purchaseViewMode === 'pos') {
          if (fromPosRow) {
            focusPurchaseCell(existingDuplicateIdx, 'quantity', 'pos_row');
          } else {
            const qtyEl =
              (document.getElementById('pos_active_quantity') as HTMLInputElement | null) ||
              (document.getElementById(
                `pos_row_${existingDuplicateIdx}_quantity`
              ) as HTMLInputElement | null);
            qtyEl?.focus();
            qtyEl?.select?.();
          }
        } else {
          focusPurchaseCell(existingDuplicateIdx, 'quantity', 'pur_cell');
        }
      }, 35);
      return;
    }

    setLines((prev) => {
      const copy = [...prev];
      const existingSameItem = copy[idx]?.item_id === found.id ? copy[idx] : undefined;
      while (copy.length <= idx) {
        copy.push(createBlankPurchaseLine());
      }
      copy[idx] = buildPopulatedLineFromItem(found, existingSameItem);
      return ensureMinimumPurchaseRows(copy, visibleRowCapacityRef.current, idx);
    });
    setSelectedPurchaseLineIndex(idx);
    setActiveRowItemSearchIdx(null);
    setRowItemSearchQuery('');
    setPurchaseSearchQuery('');
    setShowPurchaseSearchDropdown(false);
    if (purchaseViewMode === 'pos' && fromPosRow) {
      posDatasheetMouseActivatedRef.current = true;
    }
    setTimeout(() => {
      if (purchaseViewMode === 'pos') {
        if (fromPosRow) {
          focusPurchaseCell(idx, 'quantity', 'pos_row');
        } else {
          const qtyEl =
            (document.getElementById('pos_active_quantity') as HTMLInputElement | null) ||
            (document.getElementById(`pos_row_${idx}_quantity`) as HTMLInputElement | null);
          qtyEl?.focus();
          qtyEl?.select?.();
        }
      } else {
        focusPurchaseCell(idx, 'quantity', 'pur_cell');
      }
    }, 35);
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

    const origin = purchaseItemListOriginRef.current;
    const targetRowIdx = purchaseItemListTargetRowIdx;
    setShowPurchaseItemListModal(false);
    setPurchaseItemListTargetRowIdx(null);

    if (targetRowIdx !== null) {
      const fromPosRow = purchaseViewMode === 'pos' && origin === 'pos_row';
      populatePurchaseRowWithItem(targetRowIdx, chosen, fromPosRow);
      return;
    }

    const existingDuplicateIdx = lines.findIndex((l) => l.item_id === chosen.id);
    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const rowIdxToFill =
      existingDuplicateIdx >= 0
        ? existingDuplicateIdx
        : emptyIdx >= 0
        ? emptyIdx
        : lines.length;
    populatePurchaseRowWithItem(rowIdxToFill, chosen, false);
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

  const addLineRow = () => {
    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const targetIdx = emptyIdx >= 0 ? emptyIdx : lines.length;
    if (emptyIdx >= 0) {
      setSelectedPurchaseLineIndex(emptyIdx);
    } else {
      setLines((prev) => [...prev, createBlankPurchaseLine()]);
      setSelectedPurchaseLineIndex(targetIdx);
    }
    if (purchaseViewMode === 'pos') {
      posDatasheetMouseActivatedRef.current = true;
    }
    const prefix = purchaseViewMode === 'pos' ? 'pos_row' : 'pur_cell';
    setTimeout(() => {
      focusPurchaseCell(targetIdx, 'item_code', prefix);
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
  const handleSelectPurchaseSearchItem = (it: Item) => {
    const existingDuplicateIdx = lines.findIndex((l) => l.item_id === it.id);
    if (existingDuplicateIdx >= 0) {
      setSelectedPurchaseLineIndex(existingDuplicateIdx);
      setPurchaseSearchQuery('');
      setRowItemSearchQuery('');
      setActiveRowItemSearchIdx(null);
      setItemHighlightIndex(0);
      setShowPurchaseSearchDropdown(false);
      // Requirement 9: Automatically focus the search field for the next item
      setTimeout(() => {
        itemSearchInputRef.current?.focus();
        itemSearchInputRef.current?.select?.();
      }, 25);
      return;
    }

    const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
    const targetRowIdx = emptyIdx >= 0 ? emptyIdx : lines.length;

    setLines((prev) => {
      const next = [...prev];
      const existingEmpty = next.findIndex((l) => !l.item_id || l.item_id === 0);
      const idxToFill = existingEmpty >= 0 ? existingEmpty : next.length;
      if (idxToFill >= next.length) {
        next.push(buildPopulatedLineFromItem(it));
      } else {
        next[idxToFill] = buildPopulatedLineFromItem(it);
      }
      return ensureMinimumPurchaseRows(next, visibleRowCapacityRef.current, idxToFill);
    });

    setSelectedPurchaseLineIndex(targetRowIdx);
    setPurchaseSearchQuery('');
    setRowItemSearchQuery('');
    setActiveRowItemSearchIdx(null);
    setItemHighlightIndex(0);
    setShowPurchaseSearchDropdown(false);

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
      // If user typed a search query or dropdown is open with highlighted item, select that item
      if (
        (purchaseSearchQuery.trim().length > 0 || showPurchaseSearchDropdown) &&
        purchaseSearchResults.length > 0
      ) {
        const chosen =
          purchaseSearchResults[itemHighlightIndex] || purchaseSearchResults[0];
        if (chosen) {
          handleSelectPurchaseSearchItem(chosen);
          return;
        }
      }
      // If Item Search is empty and dropdown is closed, pressing Enter moves into Active Row's Quantity field!
      const activeLine = lines[selectedPurchaseLineIndex];
      if (activeLine && activeLine.item_id > 0) {
        const qtyInput =
          (document.getElementById('pos_active_quantity') as HTMLInputElement | null) ||
          (document.getElementById(
            `pur_cell_${selectedPurchaseLineIndex}_quantity`
          ) as HTMLInputElement | null);
        if (qtyInput) {
          qtyInput.focus();
          qtyInput.select?.();
        }
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

  // POS Active Strip Enter Key Sequence:
  // 1.Qty -> 2.Discount -> 3.Bonus -> 4.Batch # -> 5.Expiry -> 6.Purchase Rate -> 7.MRP -> 8.GST -> Enter -> returns focus to Item Search!
  const posActiveFieldOrder = [
    'pos_active_quantity',
    'pos_active_discount_percent',
    'pos_active_bonus_quantity',
    'pos_active_batch_number',
    'pos_active_expiry_date',
    'pos_active_purchase_rate',
    'pos_active_mrp_rate',
    'pos_active_tax_percent',
  ];

  const handlePosActiveFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    fieldId: string
  ) => {
    const idx = posActiveFieldOrder.indexOf(fieldId);
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      if (fieldId === 'pos_active_purchase_rate') {
        const nextTarget = posActiveFieldOrder[idx + 1] || 'pos_active_mrp_rate';
        if (checkAndTriggerPurchasePriceChange(selectedPurchaseLineIndex, nextTarget)) {
          return;
        }
      }
      if (idx >= 0 && idx < posActiveFieldOrder.length - 1) {
        const nextEl = document.getElementById(
          posActiveFieldOrder[idx + 1]
        ) as HTMLInputElement | null;
        if (nextEl) {
          nextEl.focus();
          if (typeof nextEl.select === 'function') nextEl.select();
        }
      } else {
        // Completed the active row fields -> return focus to Item Search
        setShowPurchaseSearchDropdown(false);
        itemSearchInputRef.current?.focus();
        itemSearchInputRef.current?.select?.();
      }
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (idx > 0) {
        const prevEl = document.getElementById(
          posActiveFieldOrder[idx - 1]
        ) as HTMLInputElement | null;
        if (prevEl) {
          prevEl.focus();
          if (typeof prevEl.select === 'function') prevEl.select();
        }
      } else {
        itemSearchInputRef.current?.focus();
        itemSearchInputRef.current?.select?.();
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      const inputEl = e.currentTarget;
      const isAtEnd =
        inputEl.type === 'number' ||
        inputEl.selectionStart === null ||
        inputEl.selectionStart === inputEl.value.length;
      if (isAtEnd && idx >= 0 && idx < posActiveFieldOrder.length - 1) {
        e.preventDefault();
        const nextEl = document.getElementById(
          posActiveFieldOrder[idx + 1]
        ) as HTMLInputElement | null;
        nextEl?.focus();
        nextEl?.select?.();
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      const inputEl = e.currentTarget;
      const isAtStart =
        inputEl.type === 'number' ||
        inputEl.selectionStart === null ||
        inputEl.selectionStart === 0;
      if (isAtStart && idx > 0) {
        e.preventDefault();
        const prevEl = document.getElementById(
          posActiveFieldOrder[idx - 1]
        ) as HTMLInputElement | null;
        prevEl?.focus();
        prevEl?.select?.();
      }
      return;
    }
  };

  // Datasheet Cell Keyboard Navigation Sequence (Both POS Table & MS Access Datasheet)
  // Column Sequence: Item Code -> Item Name -> Qty -> Discount -> Bonus -> Gross Amount -> Net Amount -> Packing -> Batch/Expiry -> Purchase Rate -> MRP -> GST -> Taxable -> Line Total
  const purchaseAccessColOrder = [
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
  ];

  const getPurchaseColsForPrefix = (prefix: 'pur_cell' | 'pos_row') =>
    prefix === 'pos_row' ? purchasePosColOrder : purchaseAccessColOrder;

  const focusPurchaseCell = (
    rIdx: number,
    col: string,
    prefix: 'pur_cell' | 'pos_row' = 'pur_cell'
  ) => {
    if (purchaseViewMode === 'pos' && prefix === 'pos_row' && !posDatasheetMouseActivatedRef.current) {
      return;
    }
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

  const navigateToPurchaseRecord = (targetIdx: number, preferredCol?: string) => {
    if (lines.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(lines.length - 1, targetIdx));
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

  const handlePurchaseCellKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIdx: number,
    field: string,
    prefix: 'pur_cell' | 'pos_row' = 'pur_cell'
  ) => {
    if (
      purchaseViewMode === 'pos' &&
      prefix === 'pos_row' &&
      !posDatasheetMouseActivatedRef.current &&
      ['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)
    ) {
      e.preventDefault();
      return;
    }
    const colOrder = getPurchaseColsForPrefix(prefix);
    const curColIdx = colOrder.indexOf(field);

    const isInlineSearchOpen =
      (field === 'item_code' || field === 'item_name') &&
      activeRowItemSearchIdx === rowIdx &&
      rowItemSearchQuery.trim().length > 0 &&
      rowItemSearchResults.length > 0;

    if (e.key === 'Escape') {
      if (activeRowItemSearchIdx !== null) {
        e.preventDefault();
        setActiveRowItemSearchIdx(null);
        setRowItemSearchQuery('');
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
      const lastValidIdx = lines.reduce(
        (acc, r, i) => (r.item_id && r.item_id > 0 ? i : acc),
        0
      );
      navigateToPurchaseRecord(lastValidIdx, field);
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
      const nextRow = Math.min(lines.length - 1, rowIdx + 5);
      setSelectedPurchaseLineIndex(nextRow);
      focusPurchaseCell(nextRow, field, prefix);
      return;
    }

    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (
        e.key === 'Enter' &&
        (field === 'item_code' || field === 'item_name') &&
        (!lines[rowIdx]?.item_id || lines[rowIdx]?.item_id === 0)
      ) {
        e.preventDefault();
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
        const nextRow = rowIdx + 1;
        if (nextRow >= lines.length) {
          setLines((prev) => [...prev, createBlankPurchaseLine()]);
        }
        setSelectedPurchaseLineIndex(nextRow);
        setTimeout(() => {
          focusPurchaseCell(nextRow, colOrder[0], prefix);
        }, 25);
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
    setEditingPurchaseId(null);
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
    setSelectedPurchaseLineIndex(0);
    setPurchaseSearchQuery('');
    setShowPurchaseSearchDropdown(false);
    setIsSupplierDropdownOpen(false);
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
    try {
      setFormError(null);
      const res = await api.getPurchaseDetails(purId);
      const p = res.purchase;
      setEditingPurchaseId(p.id);
      setBillNumber(p.bill_number);
      setSupplierInvoiceNumber(p.supplier_invoice_number || '');
      setBillDate(p.bill_date || new Date().toISOString().slice(0, 10));
      setSupplierId(String(p.supplier_account_id));
      setSupplierFilerStatus(p.supplier_filer_status || 'Filer');
      setNotes(p.remarks || '');
      setInvoiceDiscountPercent(Number(p.invoice_discount_percent || 0));
      setInvoiceDiscountAmount(Number(p.invoice_discount_amount || 0));
      setIsTaxOverridden(Boolean(p.is_tax_overridden));
      setCustomAdvanceTaxRate(Number(p.advance_tax_rate || 0.5));
      setTaxOverrideReason(p.tax_override_reason || '');
      setTaxOverrideAuthorizedBy(p.tax_override_authorized_by || 'Chief Pharmacist / Admin');
      setPaymentMode(p.payment_mode || 'Credit');
      setPaymentAccountId(p.payment_account_id ? String(p.payment_account_id) : '');
      setPaidAmount(Number(p.paid_amount || 0));

      const loadedItems: PurchaseLineItem[] = (res.items || []).map((it: any) => {
        const upp = Math.max(1, it.units_per_pack || parseUnitsPerPack(it.packing));
        const pRate = Number(it.purchase_rate || 0);
        const lRate =
          it.loose_rate !== undefined && Number(it.loose_rate) > 0
            ? Number(it.loose_rate)
            : round2(pRate / upp);
        return {
          id: it.id,
          purchase_id: it.purchase_id,
          item_id: it.item_id,
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
        };
      });

      setLines(ensureMinimumPurchaseRows(loadedItems, visibleRowCapacityRef.current, 0));
      setShowHeldModal(false);
      setSubTab('new-invoice');
      try {
        localStorage.removeItem(ACTIVE_PURCHASE_DRAFT_KEY);
      } catch {
        // ignore
      }
      setFormSuccess(
        `Held purchase draft ${p.bill_number} resumed into datasheet. You can now edit lines or click Save to confirm.`
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
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
      const units = Math.max(1, parseUnitsPerPack(masterItem?.packing || l.packing || '1x1'));
      const { roundedRetailPrice } = calculateRetailFromPurchasePrice(newPurchase);
      const body = {
        new_purchase_price: newPurchase,
        update_purchase_price: true,
        update_retail_price: updateRetail,
        ...(updateRetail
          ? {
              new_retail_price: roundedRetailPrice,
              new_loose_rate: round2(roundedRetailPrice / units),
            }
          : {}),
      };
      try {
        await api.updateItemPriceCascade(l.item_id, body);
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
                ? (document.getElementById('pos_active_quantity') as HTMLInputElement | null)
                : (document.getElementById(`pur_cell_${focusIdx}_quantity`) as HTMLInputElement | null);
            qtyEl?.focus();
          }, 25);
          return;
        }
      }
    }

    const sanitizedItems = validLines.map((l) => ({
      ...l,
      batch_number: l.batch_number?.trim() || `B-${l.item_code || l.item_id}-01`,
      expiry_date: l.expiry_date || '2028-12-31',
      quantity: Number(l.quantity) || 0,
      loose_quantity: Number(l.loose_quantity) || 0,
      bonus_quantity: Number(l.bonus_quantity) || 0,
      loose_rate: Number(l.loose_rate) || 0,
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
      client_request_id: clientRequestId,
      items: sanitizedItems,
    };

    try {
      setSavingInvoice(true);
      if (editingPurchaseId) {
        const res = await api.updatePurchase(editingPurchaseId, payload);
        const savedId = res.purchase?.id || editingPurchaseId;
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
    const activePurchaseLines = lines.filter(
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

    const preparedSms = generatePurchaseOrderSmsText(lines, resolvedStore);
    setPurchaseSmsText(preparedSms);
    setShowPurchaseSmsModal(true);
  };

  const handleExportCurrentPurchaseToExcel = async () => {
    try {
      setExportingExcel(true);
      setFormError(null);
      if (validLines.length > 0) {
        const paid = round2(paidAmount);
        const currentRecord = {
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
            item_code: l.item_code,
            company_name: l.company_name,
            item_name: l.item_name,
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
            tax_percent: Number(l.tax_percent) || 0,
            tax_amount: Number(l.tax_amount) || 0,
            gross_amount: Number(l.gross_amount) || 0,
            line_total: Number(l.line_total) || 0,
          })),
        };
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

  // Global Keyboard Shortcuts (F2 / Ctrl+S: Save, F3: Hold, Ctrl+P: Save & Print, Ctrl+N: New)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (subTab !== 'new-invoice') return;
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        handleSavePurchaseInvoice();
      } else if (e.key === 'F4') {
        e.preventDefault();
        handlePreviewInvoice();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleSavePurchaseInvoice(undefined, false, 'held');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleSavePurchaseInvoice(undefined, true, 'completed');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        resetInvoiceForm();
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [
    subTab,
    billNumber,
    supplierId,
    validLines,
    isTaxOverridden,
    taxOverrideReason,
    supplierInvoiceNumber,
    billDate,
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
    try {
      const res = await api.getPurchaseDetails(purId);
      const p: PurchaseInvoice = res.purchase;
      const pItems: PurchaseLineItem[] = res.items || [];

      setEditingPurchaseId(p.id);
      setBillNumber(p.bill_number);
      setBillDate(p.bill_date);
      setSupplierId(String(p.supplier_account_id));
      setSupplierInvoiceNumber(p.supplier_invoice_number || '');
      setSupplierFilerStatus(p.supplier_filer_status || 'Filer');
      setNotes(p.remarks || '');
      setInvoiceDiscountPercent(p.invoice_discount_percent || 0);
      setInvoiceDiscountAmount(p.invoice_discount_amount || 0);
      setIsTaxOverridden(p.is_tax_overridden === 1);
      setCustomAdvanceTaxRate(p.advance_tax_rate);
      setTaxOverrideReason(p.tax_override_reason || '');
      setTaxOverrideAuthorizedBy(p.tax_override_authorized_by || 'Chief Pharmacist / Admin');
      setPaymentMode(p.payment_mode || 'Credit');
      setPaymentAccountId(p.payment_account_id ? String(p.payment_account_id) : '');
      setPaidAmount(p.paid_amount || 0);
      setPaidAmountManuallyEdited(true);
      const normalizedItems: PurchaseLineItem[] = pItems.map((it: any) => {
        const upp = Math.max(1, it.units_per_pack || parseUnitsPerPack(it.packing));
        const pRate = Number(it.purchase_rate || 0);
        const lRate =
          it.loose_rate !== undefined && Number(it.loose_rate) > 0
            ? Number(it.loose_rate)
            : round2(pRate / upp);
        return {
          ...it,
          units_per_pack: upp,
          loose_quantity: Number(it.loose_quantity || 0),
          loose_rate: lRate,
        };
      });
      setLines(ensureMinimumPurchaseRows(normalizedItems, visibleRowCapacityRef.current, 0));
      setSelectedPurchaseLineIndex(0);
      setSubTab('new-invoice');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

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
                  className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-xs cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-emerald-100/90 text-slate-950 font-semibold'
                      : isCurrent
                      ? 'bg-emerald-50/70 text-slate-900'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0 rounded-lg border border-emerald-200 text-[11px]">
                        {s.account_code}
                      </span>
                      <span className="truncate">{s.account_name}</span>
                    </div>
                    <div className="text-[10px] text-slate-600 flex items-center gap-2 mt-0.5 font-mono">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-2.5 h-2.5 text-slate-400" />
                        {s.phone || (s as any).mobile || 'No Mobile #'}
                      </span>
                      {s.city && <span>• {s.city}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded-lg text-[9px] font-bold uppercase ${
                        s.filer_status === 'Filer'
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
      <div className="absolute left-0 right-0 top-full mt-1 z-[100] min-w-[580px] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl overflow-hidden">
        <div className="px-3 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center">
          <span>
            Matching Items ({purchaseSearchResults.length}) • Search by Item Name, Company, Code or Barcode
          </span>
          <span className="font-mono text-emerald-700">
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
                      onMouseEnter={() => setItemHighlightIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectPurchaseSearchItem(it);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] ${
                        isHighlighted
                          ? 'bg-emerald-100 text-slate-950 font-bold'
                          : 'hover:bg-emerald-50/70 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1 border-r border-slate-200">
                        <span className="font-mono text-[10px] font-bold text-emerald-700 mr-1">
                          [{it.item_code}]
                        </span>
                        <span className="font-bold text-slate-900">{it.item_name}</span>
                        <span className="text-[10px] text-slate-500 ml-1">({it.packing})</span>
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-slate-700">
                        {it.company_name || '—'}
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-right font-mono font-black text-emerald-800">
                        Rs. {purRate.toFixed(2)}
                      </td>
                      <td className="px-2.5 py-1 text-right font-mono font-semibold text-slate-700">
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
    if (activeRowItemSearchIdx !== rowIdx) return null;
    return (
      <div className="absolute left-0 top-full mt-0.5 z-[100] bg-white text-slate-900 rounded-lg border border-slate-400 shadow-2xl min-w-[580px] max-w-[720px] overflow-hidden">
        <div className="px-2.5 py-1 bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase tracking-wider text-slate-700 flex justify-between items-center">
          <span>
            Matching Items ({rowItemSearchResults.length}) • Search by Name, Company, Code or Barcode
          </span>
          <span className="font-mono text-emerald-700">↑/↓ Navigate • Enter Select • Esc Close</span>
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
                      onMouseEnter={() => setRowItemHighlightIndex(iIdx)}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        populatePurchaseRowWithItem(rowIdx, it, fromPosRow);
                      }}
                      className={`cursor-pointer transition-colors h-[26px] ${
                        isHighlighted
                          ? 'bg-emerald-100 font-bold text-slate-950'
                          : 'hover:bg-emerald-50/70 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1 border-r border-slate-200">
                        <span className="font-mono text-[10px] font-bold text-emerald-700 mr-1">
                          [{it.item_code}]
                        </span>
                        <span className="font-bold text-slate-900">{it.item_name}</span>
                        <span className="text-[10px] text-slate-500 ml-1">({it.packing})</span>
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-slate-700 truncate max-w-[160px]">
                        {it.company_name || '—'}
                      </td>
                      <td className="px-2.5 py-1 border-r border-slate-200 text-right font-mono font-black text-emerald-800">
                        Rs. {purRate.toFixed(2)}
                      </td>
                      <td className="px-2.5 py-1 text-right font-mono font-semibold text-slate-700">
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
          ? 'flex-1 max-h-full flex flex-col min-h-0 overflow-y-auto px-1.5 py-1 bg-slate-100'
          : 'flex-1 min-h-0 overflow-y-auto p-2 space-y-3 bg-slate-100'
      }`}
    >
      {/* Top Full-Screen Header & Sub-Navigation Bar */}
      <div
        className={`bg-slate-900 text-white border border-slate-700 shadow-md flex flex-wrap items-center justify-between gap-2 shrink-0 print:hidden ${
          subTab === 'new-invoice' ? 'px-3 py-1.5 rounded-lg mb-1' : 'px-3 py-2 rounded-xl'
        }`}
      >
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
          {navItems.map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer px-2.5 py-1 text-xs ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Inline Two Independent Invoice Interfaces Selector & Excel Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {subTab === 'new-invoice' && (
            <div className="flex items-center gap-1.5 bg-slate-800 text-white px-2 py-0.5 rounded-lg border border-slate-700">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 hidden md:inline">
                Interface:
              </span>
              <button
                type="button"
                onClick={() => togglePurchaseViewMode('pos')}
                className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  purchaseViewMode === 'pos'
                    ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Switch to Traditional Desktop POS Goods Receipt Interface"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>1. POS View</span>
              </button>
              <button
                type="button"
                onClick={() => togglePurchaseViewMode('access')}
                className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  purchaseViewMode === 'access'
                    ? 'bg-blue-600 text-white ring-1 ring-blue-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Switch to Microsoft Access-Style Desktop Datasheet Form"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>2. MS Access View</span>
              </button>
              <span className="bg-slate-900 px-2 py-0.5 rounded-lg text-emerald-400 font-mono font-bold text-xs">
                {validLines.length} Items
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportCurrentPurchaseToExcel}
            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title="Export Current Purchase Invoice (or Saved Purchase Invoices) to Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exportingExcel ? 'Exporting...' : 'Export to Excel (.xlsx)'}</span>
          </button>

          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportAllPurchasesToExcel}
            className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            title="Export All Saved Purchase Invoices with Line Items to Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export All (.xlsx)</span>
          </button>

          {subTab === 'new-invoice' && (
            <button
              type="button"
              onClick={handleOpenPurchaseOrderSms}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
              title="Send Order SMS for Current Purchase Invoice"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Send Order SMS</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchWorkspaceData}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 cursor-pointer"
            title="Refresh Purchase & Inventory Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white border border-slate-600 text-xs font-black flex items-center gap-1 cursor-pointer"
              title="Close Full-Screen Purchase Invoice and Return to Dashboard"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Banners */}
      {formError && (
        <div className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between shrink-0 mb-0.5">
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
        <div className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between shrink-0 mb-0.5">
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

      {/* TAB 1: NEW / EDIT PURCHASE INVOICE SCREEN (BUILT JUST LIKE SALES INVOICE!) */}
      {subTab === 'new-invoice' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* ================= OPTION 1: TRADITIONAL POS INTERFACE (LIKE SALES POS VIEW) ================= */}
          {purchaseViewMode === 'pos' && (
            <form
              onSubmit={(e) => handleSavePurchaseInvoice(e, false)}
              className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden"
            >
              {/* POS Header: Supplier Search, Live Previous Balance, Bill #, Date & Payment Mode */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-3.5 py-2 space-y-1.5 shrink-0">
                {/* Top row: Badges, Bill #, Date & Quick Header Actions */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-300" />
                      PURCHASE POS COUNTER
                    </span>
                    <span className="font-mono text-[11px] font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded-lg border border-slate-300">
                      {billNumber}
                    </span>
                    {editingPurchaseId && (
                      <span className="px-1.5 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                        EDIT #{editingPurchaseId}
                      </span>
                    )}
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Date:</span>
                      <input
                        type="date"
                        required
                        value={billDate}
                        onChange={(e) => setBillDate(e.target.value)}
                        className="text-[11px] font-mono font-semibold text-slate-800 bg-transparent outline-none cursor-pointer h-5"
                      />
                    </div>
                  </div>

                  {/* Quick Header Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      title="New Purchase Invoice (Ctrl+N)"
                    >
                      <Plus className="w-3 h-3 text-emerald-600" />
                      New (Ctrl+N)
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      title="Preview A4 Invoice before saving (F4)"
                    >
                      <Printer className="w-3 h-3 text-blue-700" />
                      <span>Preview (F4)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPurchaseOrderSms}
                      className="px-2.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                      title="Send Order SMS for Current Purchase Invoice"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Send Order SMS</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Hold this Purchase Invoice (F3)"
                    >
                      <PauseCircle className="w-3 h-3 text-amber-700" />
                      Hold (F3)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHeldModal(true)}
                      className="px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      title="View Pending Held & Draft Purchase Invoices"
                    >
                      <Clock className="w-3 h-3 text-indigo-700" />
                      Held Drafts ({heldPurchases.length})
                    </button>
                    {purchases.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenPrintInvoice(purchases[0].id)}
                        className="px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        title="Reprint Last Purchase Invoice"
                      >
                        <Printer className="w-3 h-3 text-blue-700" />
                        Reprint Last
                      </button>
                    )}
                  </div>
                </div>

                {/* Middle row: Searchable Supplier Selection + Live Previous Ledger Balance + Mode */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  {/* Searchable Supplier Input + Add New Supplier */}
                  <div
                    ref={purchaseViewMode === 'pos' ? supplierDropdownContainerRef : undefined}
                    className="md:col-span-5 flex items-center gap-1 relative"
                  >
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 shrink-0">
                      Supplier:
                    </label>
                    <div className="relative flex-1">
                      <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={purchaseViewMode === 'pos' ? supplierSearchInputRef : undefined}
                        type="text"
                        value={supplierSearchQuery}
                        onFocus={() => {
                          // Do not open the supplier list just because the field receives focus.
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
                        className="w-full pl-6 pr-12 py-0.5 text-xs font-bold rounded-lg border border-emerald-500 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600 h-6"
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
                            title="Clear search text to see all suppliers"
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
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAddSupplierModal()}
                      className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0 h-6"
                      title="Add New Supplier"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>+New</span>
                    </button>

                    {renderSupplierDropdownMenu()}
                  </div>

                  {/* Live Supplier Previous Balance Badge */}
                  <div className="md:col-span-4 bg-slate-900 text-white rounded-lg px-2 py-0.5 flex items-center justify-between shadow-sm h-6">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 shrink-0">
                        Prev Bal:
                      </span>
                      <span
                        className={`font-mono text-[11px] font-black ${
                          previousSupplierBalance > 0
                            ? 'text-amber-400'
                            : previousSupplierBalance < 0
                            ? 'text-emerald-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {formatPKR(Math.abs(previousSupplierBalance))} ({previousBalanceType})
                      </span>
                      {supplierBalanceSummary?.lastPayment && (
                        <span className="text-[9px] text-slate-400 hidden sm:inline truncate">
                          • Last: {formatPKR(supplierBalanceSummary.lastPayment.amount)}
                        </span>
                      )}
                    </div>
                    {selectedSupplier && (
                      <button
                        type="button"
                        onClick={handleOpenSupplierLedger}
                        className="px-1.5 py-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                        title="Open Detailed Supplier Ledger"
                      >
                        <Scale className="w-2.5 h-2.5" />
                        <span>Ledger</span>
                      </button>
                    )}
                  </div>

                  {/* Supplier Invoice #, Filer Status & Payment Mode */}
                  <div className="md:col-span-3 flex items-center justify-end gap-1.5">
                    <input
                      type="text"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="Sup. Inv #"
                      className="w-24 px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded-lg border border-slate-300 bg-white h-6"
                      title="Supplier Invoice / Bill Number"
                    />
                    <select
                      value={supplierFilerStatus}
                      onChange={(e) => setSupplierFilerStatus(e.target.value as FilerStatus)}
                      className="px-1.5 py-0.5 text-[10px] font-bold rounded-lg border border-slate-300 bg-slate-50 text-slate-900 h-6"
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
                      className="px-2 py-0.5 text-[11px] font-bold rounded-lg border border-slate-300 bg-white text-slate-900 h-6"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Credit">Credit</option>
                      <option value="Bank">Bank</option>
                      <option value="Partial">Partial</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Fast Item Search & Barcode Scan Bar (Identical to Sales!) */}
              <div
                ref={purchaseViewMode === 'pos' ? itemDropdownContainerRef : undefined}
                className="relative bg-slate-900 rounded-lg px-2 py-1 shadow-sm text-white shrink-0"
              >
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Barcode className="w-4 h-4 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="pos_purchase_item_search_input"
                      ref={purchaseViewMode === 'pos' ? itemSearchInputRef : undefined}
                      type="text"
                      value={purchaseSearchQuery}
                      onFocus={() => {
                        setShowPurchaseSearchDropdown(true);
                        setItemHighlightIndex(0);
                      }}
                      onChange={(e) => {
                        const q = e.target.value;
                        setPurchaseSearchQuery(q);
                        setItemHighlightIndex(0);
                        setShowPurchaseSearchDropdown(true);
                      }}
                      onKeyDown={handleItemSearchKeyDown}
                      placeholder="Scan Barcode or Search Medicine Name / Generic / Brand / Company / Item Code (Press Enter)..."
                      className="w-full pl-8 pr-7 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 h-6"
                    />
                    {purchaseSearchQuery && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPurchaseSearchQuery('');
                          setItemHighlightIndex(0);
                          itemSearchInputRef.current?.focus();
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openPurchaseItemListForRow(null, 'top')}
                    className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 shadow-sm h-6"
                    title="Open Full Item List to select or replace an item"
                  >
                    <PackageSearch className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Item List</span>
                  </button>
                  <button
                    type="button"
                    onClick={addLineRow}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 shadow-sm h-6"
                    title="Add New Empty Row to Purchase Bill"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Blank Line</span>
                  </button>
                </div>

                {renderTopItemSearchDropdown()}
              </div>

              {/* Active Item Goods Receipt Entry Strip (Identical to Sales Active Item Strip!) */}
              {activePurchaseRow && activePurchaseRow.item_id > 0 ? (
                <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-500/80 rounded-lg px-2.5 py-1 shadow-sm space-y-1 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0 rounded-lg bg-emerald-700 text-white font-mono text-[10px] font-bold">
                        Active Line #{selectedPurchaseLineIndex + 1}
                      </span>
                      <span className="font-bold text-slate-900 text-xs">
                        [{activePurchaseRow.item_code}] {activePurchaseRow.item_name}
                      </span>
                      <span className="text-[11px] text-slate-600 font-medium">
                        ({activePurchaseRow.packing}) • {activePurchaseRow.company_name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-800 font-semibold">
                      Line Net: <strong>{formatPKR(activePurchaseRow.line_total)}</strong>
                    </span>
                  </div>

                  {/* Fast Stepper Controls for Active Row: Qty -> Discount -> Bonus -> Batch/Expiry -> Purchase Rate -> MRP -> GST -> Next Item */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-9 gap-1.5 items-end">
                    {/* 1. Qty */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        1. Qty
                      </label>
                      <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden h-5">
                        <button
                          type="button"
                          onClick={() => handleDecrementPurchaseQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-r border-slate-300 h-full"
                        >
                          -
                        </button>
                        <NumericInput
                          id="pos_active_quantity"
                          value={activePurchaseRow.quantity}
                          onChange={(e) =>
                            handleLineChange(selectedPurchaseLineIndex, 'quantity', e.target.value)
                          }
                          onKeyDown={(e) => handlePosActiveFieldKeyDown(e, 'pos_active_quantity')}
                          className="w-full text-center font-mono font-bold text-[11px] text-slate-900 outline-none py-0 h-full"
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrementPurchaseQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-l border-slate-300 h-full"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* 2. Discount */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        2. Discount %
                      </label>
                      <NumericInput
                        id="pos_active_discount_percent"
                        value={activePurchaseRow.discount_percent}
                        onChange={(e) =>
                          handleLineChange(
                            selectedPurchaseLineIndex,
                            'discount_percent',
                            e.target.value
                          )
                        }
                        onKeyDown={(e) =>
                          handlePosActiveFieldKeyDown(e, 'pos_active_discount_percent')
                        }
                        className="w-full px-1.5 py-0 font-mono font-semibold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* 3. Bonus */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-teal-800 leading-none mb-0.5">
                        3. Bonus
                      </label>
                      <div className="flex items-center border border-teal-300 rounded-lg bg-white overflow-hidden h-5">
                        <button
                          type="button"
                          onClick={() => handleDecrementBonusQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-0 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs cursor-pointer border-r border-teal-300 h-full"
                        >
                          -
                        </button>
                        <NumericInput
                          id="pos_active_bonus_quantity"
                          value={activePurchaseRow.bonus_quantity}
                          onChange={(e) =>
                            handleLineChange(
                              selectedPurchaseLineIndex,
                              'bonus_quantity',
                              e.target.value
                            )
                          }
                          onKeyDown={(e) =>
                            handlePosActiveFieldKeyDown(e, 'pos_active_bonus_quantity')
                          }
                          className="w-full text-center font-mono font-bold text-[11px] text-teal-950 outline-none py-0 h-full"
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrementBonusQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-0 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs cursor-pointer border-l border-teal-300 h-full"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* 4. Batch # */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        4. Batch #
                      </label>
                      <input
                        id="pos_active_batch_number"
                        type="text"
                        value={activePurchaseRow.batch_number}
                        onChange={(e) =>
                          handleLineChange(
                            selectedPurchaseLineIndex,
                            'batch_number',
                            e.target.value
                          )
                        }
                        onKeyDown={(e) => handlePosActiveFieldKeyDown(e, 'pos_active_batch_number')}
                        className="w-full px-1.5 py-0 font-mono font-bold text-[11px] rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* 5. Expiry Date */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        5. Expiry
                      </label>
                      <input
                        id="pos_active_expiry_date"
                        type="date"
                        value={activePurchaseRow.expiry_date}
                        onChange={(e) =>
                          handleLineChange(selectedPurchaseLineIndex, 'expiry_date', e.target.value)
                        }
                        onKeyDown={(e) => handlePosActiveFieldKeyDown(e, 'pos_active_expiry_date')}
                        className="w-full px-1 py-0 font-mono text-[10px] rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* 6. Purchase Rate */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        6. Purchase Rate
                      </label>
                      <NumericInput
                        id="pos_active_purchase_rate"
                        value={activePurchaseRow.purchase_rate}
                        onChange={(e) =>
                          handleLineChange(
                            selectedPurchaseLineIndex,
                            'purchase_rate',
                            e.target.value
                          )
                        }
                        onBlur={() => {
                          checkAndTriggerPurchasePriceChange(selectedPurchaseLineIndex);
                        }}
                        onKeyDown={(e) =>
                          handlePosActiveFieldKeyDown(e, 'pos_active_purchase_rate')
                        }
                        className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* 7. MRP */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        7. MRP
                      </label>
                      <NumericInput
                        id="pos_active_mrp_rate"
                        value={activePurchaseRow.mrp_rate}
                        onChange={(e) =>
                          handleLineChange(
                            selectedPurchaseLineIndex,
                            'mrp_rate',
                            e.target.value
                          )
                        }
                        onKeyDown={(e) => handlePosActiveFieldKeyDown(e, 'pos_active_mrp_rate')}
                        className="w-full px-1.5 py-0 font-mono font-semibold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* 8. GST % */}
                    <div>
                      <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                        8. GST %
                      </label>
                      <NumericInput
                        id="pos_active_tax_percent"
                        value={activePurchaseRow.tax_percent}
                        onChange={(e) =>
                          handleLineChange(selectedPurchaseLineIndex, 'tax_percent', e.target.value)
                        }
                        onKeyDown={(e) => handlePosActiveFieldKeyDown(e, 'pos_active_tax_percent')}
                        className="w-full px-1.5 py-0 font-mono font-semibold text-[11px] text-right rounded-lg border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                      />
                    </div>

                    {/* Next Item Button */}
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setPurchaseSearchQuery('');
                          setShowPurchaseSearchDropdown(false);
                          itemSearchInputRef.current?.focus();
                        }}
                        className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-sm h-5"
                        title="Return focus to Item Search to add next item"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Next Item ↵</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg px-2.5 py-0.5 text-center text-[11px] text-slate-500 shrink-0">
                  Click or type in the Item Search bar above (or directly in any row below) to add medicines to this Purchase Invoice.
                </div>
              )}

              {/* Responsive Purchase Items Grid (Automatically adjusts height to screen, Internal Scroll, Fixed Headers) */}
              <div className="bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
                <div className="px-2.5 py-0.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] shrink-0">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                    Purchase Invoice Items ({validLines.length} Active / {lines.length} Rows • Fits {visibleRowCapacity})
                  </span>
                  <span className="font-mono text-slate-600 text-[10px]">
                    Total Packs: {validLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)} •
                    Bonus: {validLines.reduce((s, l) => s + (Number(l.bonus_quantity) || 0), 0)}
                  </span>
                </div>

                <div
                  ref={posGridViewportRef}
                  onMouseDown={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('input, select, button')) {
                      posDatasheetMouseActivatedRef.current = true;
                    }
                  }}
                  className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative"
                >
                  <table className="w-full min-w-[1680px] text-left text-[11px] border-collapse leading-none">
                    <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider leading-none shadow-sm">
                      <tr className="h-6">
                        <th className="py-0 px-2 w-8 text-center h-6">#</th>
                        <th className="py-0 px-2 w-28 h-6">Item Code</th>
                        <th className="py-0 px-2 min-w-[240px] h-6">Item Name</th>
                        <th className="py-0 px-2 w-20 text-right h-6">Qty</th>
                        <th className="py-0 px-2 w-20 text-right h-6">Discount</th>
                        <th className="py-0 px-2 w-20 text-right h-6">Bonus</th>
                        <th className="py-0 px-2 w-24 text-right h-6">Gross Amount</th>
                        <th className="py-0 px-2 w-24 text-right h-6">Net Amount</th>
                        <th className="py-0 px-2 w-20 text-center h-6">Packing</th>
                        <th className="py-0 px-2 w-56 h-6">Batch/Expiry</th>
                        <th className="py-0 px-2 w-28 text-right h-6">Purchase Rate</th>
                        <th className="py-0 px-2 w-24 text-right h-6">MRP</th>
                        <th className="py-0 px-2 w-20 text-right h-6">GST</th>
                        <th className="py-0 px-2 w-24 text-right h-6">Taxable</th>
                        <th className="py-0 px-2 w-28 text-right h-6">Line Total</th>
                        <th className="py-0 px-2 w-10 text-center h-6"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {lines.map((line, rIdx) => {
                        const isSelected = rIdx === selectedPurchaseLineIndex;

                        return (
                          <tr
                            key={rIdx}
                            onClick={() => setSelectedPurchaseLineIndex(rIdx)}
                            className={`cursor-pointer transition-colors h-[16px] leading-none ${
                              isSelected
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
                                  activeRowItemSearchIdx === rIdx
                                    ? rowItemSearchQuery
                                    : line.item_code
                                }
                                onMouseDown={() => {
                                  suppressItemListReopenRef.current = false;
                                  posDatasheetMouseActivatedRef.current = true;
                                }}
                                onClick={() => {
                                  setSelectedPurchaseLineIndex(rIdx);
                                  openPurchaseItemListForRow(
                                    rIdx,
                                    'pos_row',
                                    `pos_row_${rIdx}_item_code`
                                  );
                                }}
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(rIdx);
                                  posDatasheetMouseActivatedRef.current = true;
                                  openPurchaseItemListForRow(
                                    rIdx,
                                    'pos_row',
                                    `pos_row_${rIdx}_item_code`
                                  );
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === rIdx ? null : prev
                                    );
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(rIdx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? rIdx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && activeRowItemSearchIdx === rIdx) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setRowItemSearchQuery('');
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === rIdx &&
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
                                className="w-full px-1 py-0 font-mono font-bold text-[11px] text-emerald-800 bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-[15px] leading-none outline-none cursor-pointer"
                              />
                            </td>
                            <td className="p-0 h-[16px] align-middle relative min-w-[200px]">
                              <input
                                id={`pos_row_${rIdx}_item_name`}
                                type="text"
                                value={
                                  activeRowItemSearchIdx === rIdx
                                    ? rowItemSearchQuery
                                    : line.item_name
                                    ? `${line.item_name}${line.company_name ? ` (${line.company_name})` : ''}`
                                    : ''
                                }
                                onMouseDown={() => {
                                  suppressItemListReopenRef.current = false;
                                  posDatasheetMouseActivatedRef.current = true;
                                }}
                                onClick={() => {
                                  setSelectedPurchaseLineIndex(rIdx);
                                  openPurchaseItemListForRow(
                                    rIdx,
                                    'pos_row',
                                    `pos_row_${rIdx}_item_name`
                                  );
                                }}
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(rIdx);
                                  posDatasheetMouseActivatedRef.current = true;
                                  openPurchaseItemListForRow(
                                    rIdx,
                                    'pos_row',
                                    `pos_row_${rIdx}_item_name`
                                  );
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === rIdx ? null : prev
                                    );
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(rIdx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? rIdx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && activeRowItemSearchIdx === rIdx) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setRowItemSearchQuery('');
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === rIdx &&
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
                                placeholder="Click or Focus for Item List..."
                                className="w-full px-1.5 py-0 font-bold text-slate-900 text-[11px] bg-transparent focus:bg-white border border-transparent focus:border-emerald-500 h-[15px] leading-none outline-none cursor-pointer"
                              />
                              {renderRowItemSearchCombobox(rIdx, true)}
                            </td>
                            {/* 3. Qty */}
                            <td className="p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_quantity`}
                                value={line.item_id ? line.quantity : 0}
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
                                className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 4. Discount */}
                            <td className="p-0 text-right h-[16px] align-middle">
                              <NumericInput
                                id={`pos_row_${rIdx}_discount_percent`}
                                value={line.item_id ? line.discount_percent : 0}
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
                            <td className="py-0 px-1.5 text-right font-mono font-semibold text-slate-900 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.taxable_amount > 0
                                ? formatPKR(line.taxable_amount)
                                : ''}
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
                            <td className="py-0 px-1.5 text-right font-mono font-black text-slate-900 text-[11px] h-[16px] align-middle">
                              {line.line_total > 0 ? formatPKR(line.line_total) : ''}
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

                {/* POS Datasheet Record Navigator Bar */}
                <div className="bg-slate-200 border-t border-slate-300 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
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
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
                    <span>Keys: Enter/Tab • Arrows • PgUp/PgDn • Ctrl+Home/End</span>
                  </div>
                </div>
              </div>

              {/* Full-Width POS Bottom Totals & Payment Action Bar (No Side-by-Side Split) */}
              <div className="w-full bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white rounded-xl border border-slate-700 px-3.5 py-2 shadow-lg shrink-0 space-y-2">
                {/* Row 1: Full-Width Financial Totals & Payment Settlement */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 pb-2">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-semibold">Gross:</span>
                      <span className="font-mono font-bold text-white">{formatPKR(grossTotal)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-rose-400 font-semibold">Discounts:</span>
                      <span className="font-mono font-bold text-rose-300">-{formatPKR(totalDiscount)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-semibold">Bill Disc %:</span>
                      <NumericInput
                        value={invoiceDiscountPercent}
                        onChange={(e) => {
                          const pct = Math.max(0, parseFloat(e.target.value) || 0);
                          setInvoiceDiscountPercent(pct);
                          setInvoiceDiscountAmount(round2(subtotalAfterItemDisc * (pct / 100)));
                        }}
                        className="w-16 px-1.5 py-0.5 rounded-lg bg-slate-800 border border-slate-600 font-mono text-xs text-white text-right"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-semibold">Prev Ledger ({previousBalanceType}):</span>
                      <span className="font-mono font-bold text-amber-300">{formatPKR(previousSupplierBalance)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-semibold">GST + Adv Tax ({appliedAdvanceTaxRate}%):</span>
                      <span className="font-mono font-bold text-amber-300">
                        +{formatPKR(gstTotal + advanceTaxAmount)}
                      </span>
                    </div>
                  </div>

                  {/* Highlighted Net Purchase, Paid & Balance */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-2">
                      <span className="text-xs font-black uppercase text-emerald-300">Net Total:</span>
                      <span className="font-mono text-lg font-black text-emerald-300 ams-total-highlight">
                        {formatPKR(netInvoiceAmount)}
                      </span>
                    </div>
                    <div className="px-3 py-1 rounded-lg bg-sky-500/15 border border-sky-400/40 flex items-center gap-2">
                      <span className="text-xs font-black uppercase text-sky-300">Payable:</span>
                      <span className="font-mono text-lg font-black text-sky-300 ams-total-highlight">
                        {formatPKR(totalPayable)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg border border-emerald-500">
                      <span className="text-xs font-bold text-emerald-300 whitespace-nowrap">Paid:</span>
                      <NumericInput
                        value={paidAmount}
                        onChange={(e) => {
                          setPaidAmountManuallyEdited(true);
                          setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0));
                        }}
                        className="w-28 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono font-black text-white text-right outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleExactPurchasePayment}
                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold cursor-pointer"
                      >
                        Exact
                      </button>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-lg border flex items-center gap-2 ${
                        remainingBalance <= 0
                          ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                          : 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                      }`}
                    >
                      <span className="text-xs font-bold uppercase">Balance:</span>
                      <span className="font-mono text-lg font-black ams-total-highlight">
                        {formatPKR(Math.abs(remainingBalance))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Full-Width Primary Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="submit"
                      disabled={savingInvoice}
                      className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-sm shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Confirm & Save Purchase Invoice (F2)"
                    >
                      <Save className="w-4 h-4" />
                      <span>
                        {savingInvoice
                          ? 'Posting...'
                          : editingPurchaseId
                          ? 'Update Purchase (F2)'
                          : 'Save Purchase (F2)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, true)}
                      className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-slate-600"
                      title="Save & Print A4 Purchase Invoice (Ctrl+P)"
                    >
                      <Printer className="w-4 h-4 text-emerald-400" />
                      <span>Save &amp; Print A4</span>
                    </button>

                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={handleExportCurrentPurchaseToExcel}
                      className="py-1.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-emerald-500/60"
                      title="Export Purchase Invoice to Excel (.xlsx)"
                    >
                      <Download className="w-4 h-4 text-emerald-200" />
                      <span>Export to Excel</span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="py-1.5 px-2.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-sky-500/50"
                      title="Preview A4 Invoice before saving (F4)"
                    >
                      <Printer className="w-3.5 h-3.5 text-sky-200" />
                      <span>Preview (F4)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenPurchaseOrderSms}
                      className="py-1.5 px-3 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer border border-indigo-500/60"
                      title="Send Order SMS for Current Purchase Invoice"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-200" />
                      <span>Send Order SMS</span>
                    </button>

                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1 cursor-pointer border border-slate-600 disabled:opacity-50"
                      title="Hold this Purchase Invoice (F3)"
                    >
                      <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Hold (F3)</span>
                    </button>

                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1 cursor-pointer border border-slate-600"
                      title="Reset Form (Ctrl+N)"
                    >
                      <span>Reset</span>
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
            </form>
          )}

          {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (LIKE SALES MS ACCESS VIEW) ================= */}
          {purchaseViewMode === 'access' && (
            <form
              onSubmit={(e) => handleSavePurchaseInvoice(e, false)}
              className="flex-1 min-h-0 flex flex-col bg-slate-200 border-2 border-slate-400 rounded-sm shadow-xs overflow-hidden select-none"
            >
              {/* Combined Access Window Title Bar & Ribbon Toolbar */}
              <div className="bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 text-white px-2.5 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 text-[11px] shrink-0 select-none">
                <div className="flex items-center gap-2 font-mono">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-bold text-slate-200 tracking-tight">
                    frm_PurchaseInvoice : Form
                  </span>
                  <span className="text-[10px] bg-emerald-700 px-1.5 py-0.2 rounded-lg text-white font-bold uppercase">
                    Goods Receipt
                  </span>
                  <span className="font-bold text-amber-300">{billNumber}</span>
                  {editingPurchaseId && (
                    <span className="bg-amber-600 text-white text-[9px] px-1.5 py-0.2 rounded-lg font-bold">
                      EDIT #{editingPurchaseId}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 hidden xl:inline ml-1">
                    (F2: Save · F3: Hold · Ctrl+P: Save &amp; Print · Tab/Enter: Next Cell · Arrows: Navigate)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="New Purchase Bill (Ctrl+N)"
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                    <span>New</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingInvoice}
                    className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Save & Post Purchase Invoice (F2)"
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
                    onClick={handlePreviewInvoice}
                    className="px-2 py-0.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="Preview A4 Invoice before saving (F4)"
                  >
                    <Printer className="w-3 h-3 text-sky-200" />
                    <span>Preview (F4)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenPurchaseOrderSms}
                    className="px-2 py-0.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="Send Order SMS for Current Purchase Invoice"
                  >
                    <MessageSquare className="w-3 h-3 text-indigo-200" />
                    <span>Send Order SMS</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingInvoice}
                    onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                    className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Hold Purchase Invoice (F3)"
                  >
                    <PauseCircle className="w-3 h-3 text-amber-200" />
                    <span>Hold (F3)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHeldModal(true)}
                    className="px-2 py-0.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="View Pending Held & Draft Purchase Invoices"
                  >
                    <Clock className="w-3 h-3 text-indigo-300" />
                    <span>Held ({heldPurchases.length})</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingInvoice}
                    onClick={() => handleSavePurchaseInvoice(undefined, true)}
                    className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="Save & Print A4 Invoice (Ctrl+P)"
                  >
                    <Printer className="w-3 h-3 text-emerald-400" />
                    <span>A4 Print</span>
                  </button>
                  {selectedSupplier && (
                    <button
                      type="button"
                      onClick={handleOpenSupplierLedger}
                      className="px-2 py-0.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                      title="Open Detailed Supplier Ledger"
                    >
                      <Scale className="w-3 h-3 text-teal-200" />
                      <span>Ledger</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubTab('advance-tax')}
                    className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-[10px] flex items-center gap-1 cursor-pointer"
                  >
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    <span>Adv Tax ({appliedAdvanceTaxRate}%)</span>
                  </button>
                </div>
              </div>

              {/* Dense MS Access Form Header Controls (Identical in height & layout to Sales!) */}
              <div className="bg-slate-100 border-b border-slate-300 px-2 py-0.5 shrink-0 select-none">
                <div className="grid grid-cols-12 gap-1 items-center text-[11px]">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-9 shrink-0">
                      Bill #:
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={billNumber}
                      title="Auto-generated Purchase Invoice Number"
                      className="w-full px-1 py-0 text-[11px] font-mono font-bold rounded-lg border border-slate-300 bg-slate-100 cursor-not-allowed text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-8 shrink-0">
                      Date:
                    </label>
                    <input
                      type="date"
                      required
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      className="w-full px-1 py-0 text-[11px] font-mono rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>

                  {/* Searchable Supplier Selector */}
                  <div
                    ref={purchaseViewMode === 'access' ? supplierDropdownContainerRef : undefined}
                    className="col-span-4 flex items-center gap-1 relative"
                  >
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-12 shrink-0">
                      Supplier:
                    </label>
                    <div className="relative flex-1 flex items-center gap-0.5">
                      <div className="relative flex-1">
                        <input
                          ref={purchaseViewMode === 'access' ? supplierSearchInputRef : undefined}
                          type="text"
                          value={supplierSearchQuery}
                          onFocus={() => {
                            // Keep the supplier picker closed until the user types or presses ArrowDown.
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
                          className="w-full pl-1.5 pr-10 py-0 text-[11px] font-bold rounded-lg border border-emerald-500 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 h-5"
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
                        className="px-1.5 h-5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[9px] font-bold flex items-center gap-0.5 shrink-0 cursor-pointer"
                        title="Add New Supplier"
                      >
                        <UserPlus className="w-2.5 h-2.5" />
                        <span>+New</span>
                      </button>
                    </div>

                    {renderSupplierDropdownMenu()}
                  </div>

                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-12 shrink-0">
                      Sup Inv:
                    </label>
                    <input
                      type="text"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="Inv #"
                      className="w-full px-1 py-0 text-[11px] font-mono rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-9 shrink-0">
                      Mode:
                    </label>
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
                      className="w-full px-1 py-0 text-[11px] font-bold rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Credit">Credit</option>
                      <option value="Bank">Bank</option>
                      <option value="Partial">Partial</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: FBR Filer Status, Disbursing Account, Remarks & Live Supplier Ledger Strip */}
                <div className="grid grid-cols-12 gap-1 items-center text-[11px] mt-0.5 pt-0.5 border-t border-slate-200">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-9 shrink-0">
                      FBR:
                    </label>
                    <select
                      value={supplierFilerStatus}
                      onChange={(e) => setSupplierFilerStatus(e.target.value as FilerStatus)}
                      className="w-full px-1 py-0 text-[10px] font-bold rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    >
                      <option value="Filer">Filer ({taxSettings?.filer_rate ?? 0.5}%)</option>
                      <option value="Non-Filer">Non-Filer ({taxSettings?.non_filer_rate ?? 2.5}%)</option>
                      <option value="Exempt">Exempt (0%)</option>
                    </select>
                  </div>
                  <div className="col-span-3 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-8 shrink-0">
                      A/C:
                    </label>
                    <select
                      value={paymentAccountId}
                      onChange={(e) => setPaymentAccountId(e.target.value)}
                      className="w-full px-1 py-0 text-[10px] font-semibold rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    >
                      <option value="">
                        Auto ({paymentMode === 'Bank' ? 'Bank Account' : 'Cash in Hand'})
                      </option>
                      {financialAccounts.map((fa) => (
                        <option key={fa.id} value={fa.id}>
                          [{fa.account_code}] {fa.account_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 flex items-center gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-600 w-12 shrink-0">
                      Remarks:
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Challan # / delivery note..."
                      className="w-full px-1 py-0 text-[10px] rounded-lg border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-4 bg-slate-900 text-white rounded-lg px-2 py-0 flex items-center justify-between text-[10px] h-5">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Prev Bal:</span>
                      <span className="font-mono font-bold text-amber-300">
                        {formatPKR(previousSupplierBalance)} ({previousBalanceType})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 border-l border-slate-700 pl-1.5">
                      <span className="text-slate-400">Total Pay:</span>
                      <span className="font-mono font-black text-emerald-300">
                        {formatPKR(totalPayable)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compact Barcode Scanner & Fast Medicine Search Bar (Identical to Sales MS Access View!) */}
              <div
                ref={purchaseViewMode === 'access' ? itemDropdownContainerRef : undefined}
                className="bg-slate-800 px-2 py-0.5 text-white border-b border-slate-700 relative shrink-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex-1 min-w-[260px] relative">
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg px-2 py-0 focus-within:border-emerald-400 h-5">
                      <Search className="w-3 h-3 text-emerald-400 mr-1.5 shrink-0" />
                      <input
                        id="access_purchase_item_search_input"
                        ref={purchaseViewMode === 'access' ? itemSearchInputRef : undefined}
                        type="text"
                        value={purchaseSearchQuery}
                        onFocus={() => {
                          setShowPurchaseSearchDropdown(true);
                          setItemHighlightIndex(0);
                        }}
                        onChange={(e) => {
                          const q = e.target.value;
                          setPurchaseSearchQuery(q);
                          setItemHighlightIndex(0);
                          setShowPurchaseSearchDropdown(true);
                        }}
                        onKeyDown={handleItemSearchKeyDown}
                        placeholder="Barcode Scanner / Fast Medicine Search (Type Code, Barcode, Name, Generic, or Company)..."
                        className="w-full bg-transparent text-[11px] text-white placeholder-slate-400 focus:outline-none"
                      />
                      {purchaseSearchQuery && (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPurchaseSearchQuery('');
                            setItemHighlightIndex(0);
                            itemSearchInputRef.current?.focus();
                          }}
                          className="text-slate-400 hover:text-white mr-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      <Barcode className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
                    </div>

                    {renderTopItemSearchDropdown()}
                  </div>

                  {/* Row Actions Toolbar */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        openPurchaseItemListForRow(selectedPurchaseLineIndex, 'access_row')
                      }
                      className="px-2 py-0 rounded-lg bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                      title="Open Item List to select or change item for the selected row"
                    >
                      <PackageSearch className="w-3 h-3 text-emerald-400" />
                      Item List
                    </button>
                    <button
                      type="button"
                      onClick={addLineRow}
                      className="px-2 py-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                    >
                      <Plus className="w-3 h-3" />
                      Add Row
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLineRow(selectedPurchaseLineIndex)}
                      className="px-2 py-0 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Responsive MS Access Datasheet Grid (Automatically adjusts height to screen, Internal Scroll, Fixed Headers) */}
              <div className="flex flex-col flex-1 min-h-0 bg-white overflow-hidden select-none border-b border-slate-400">
                <div
                  ref={accessGridViewportRef}
                  className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative"
                >
                  <table className="w-full min-w-[1680px] border-collapse text-[11px] font-sans leading-none">
                    <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400 text-slate-800 text-[10px] font-bold select-none shadow-sm leading-none">
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
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-right bg-emerald-100/70 text-emerald-950 h-6">
                          Bonus
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Gross Amount
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Net Amount
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-20 text-center h-6">
                          Packing
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-56 text-left h-6">
                          Batch/Expiry
                        </th>
                        <th className="border-r border-slate-300 px-1 py-0 w-24 text-right h-6">
                          Purchase Rate
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
                        <th className="px-1 py-0 w-8 text-center h-6">Del</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => {
                        const isSelected = idx === selectedPurchaseLineIndex;
                        return (
                          <tr
                            key={idx}
                            onClick={() => setSelectedPurchaseLineIndex(idx)}
                            className={`border-b border-slate-300 font-sans transition-colors h-[16px] leading-none ${
                              isSelected
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

                            {/* 1. Item Code (Opens Shared Item Selection List on click or focus) */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
                              <input
                                id={`pur_cell_${idx}_item_code`}
                                type="text"
                                value={
                                  activeRowItemSearchIdx === idx
                                    ? rowItemSearchQuery
                                    : line.item_code
                                }
                                onMouseDown={() => {
                                  suppressItemListReopenRef.current = false;
                                }}
                                onClick={() => {
                                  setSelectedPurchaseLineIndex(idx);
                                  openPurchaseItemListForRow(
                                    idx,
                                    'access_row',
                                    `pur_cell_${idx}_item_code`
                                  );
                                }}
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(idx);
                                  openPurchaseItemListForRow(
                                    idx,
                                    'access_row',
                                    `pur_cell_${idx}_item_code`
                                  );
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === idx ? null : prev
                                    );
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(idx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? idx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && activeRowItemSearchIdx === idx) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setRowItemSearchQuery('');
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === idx &&
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
                                        populatePurchaseRowWithItem(idx, chosen, false);
                                      }
                                      return;
                                    }
                                  }
                                  handlePurchaseCellKeyDown(e, idx, 'item_code', 'pur_cell');
                                }}
                                placeholder="Code..."
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none cursor-pointer"
                              />
                            </td>

                            {/* 2. Item Name (Opens Shared Item Selection List on click or focus) */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle relative">
                              <input
                                id={`pur_cell_${idx}_item_name`}
                                type="text"
                                value={
                                  activeRowItemSearchIdx === idx
                                    ? rowItemSearchQuery
                                    : line.item_name
                                }
                                onMouseDown={() => {
                                  suppressItemListReopenRef.current = false;
                                }}
                                onClick={() => {
                                  setSelectedPurchaseLineIndex(idx);
                                  openPurchaseItemListForRow(
                                    idx,
                                    'access_row',
                                    `pur_cell_${idx}_item_name`
                                  );
                                }}
                                onFocus={() => {
                                  setSelectedPurchaseLineIndex(idx);
                                  openPurchaseItemListForRow(
                                    idx,
                                    'access_row',
                                    `pur_cell_${idx}_item_name`
                                  );
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowItemSearchIdx((prev) =>
                                      prev === idx ? null : prev
                                    );
                                    setRowItemSearchQuery('');
                                  }, 180);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSelectedPurchaseLineIndex(idx);
                                  setRowItemSearchQuery(v);
                                  setRowItemHighlightIndex(0);
                                  setActiveRowItemSearchIdx(v.trim().length > 0 ? idx : null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' && activeRowItemSearchIdx === idx) {
                                    e.preventDefault();
                                    setActiveRowItemSearchIdx(null);
                                    setRowItemSearchQuery('');
                                    return;
                                  }
                                  if (
                                    activeRowItemSearchIdx === idx &&
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
                                        populatePurchaseRowWithItem(idx, chosen, false);
                                      }
                                      return;
                                    }
                                  }
                                  handlePurchaseCellKeyDown(e, idx, 'item_name', 'pur_cell');
                                }}
                                placeholder="Click or Focus for Item List..."
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-semibold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none cursor-pointer"
                              />
                              {renderRowItemSearchCombobox(idx, false)}
                            </td>

                            {/* 3. Qty */}
                            <td className="border-r border-slate-300 p-0 bg-emerald-50/20 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_quantity`}
                                value={line.item_id ? line.quantity : 0}
                                onFocus={() => setSelectedPurchaseLineIndex(idx)}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'quantity')}
                                className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                            </td>

                            {/* 4. Discount */}
                            <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                              <NumericInput
                                id={`pur_cell_${idx}_discount_percent`}
                                value={line.item_id ? line.discount_percent : 0}
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

                            {/* 6. Gross Amount */}
                            <td className="border-r border-slate-300 px-1 py-0 text-right font-mono text-slate-800 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.gross_amount > 0
                                ? line.gross_amount.toFixed(2)
                                : ''}
                            </td>

                            {/* 7. Net Amount */}
                            <td className="border-r border-slate-300 px-1 py-0 text-right font-mono font-semibold text-slate-900 text-[11px] h-[16px] align-middle">
                              {line.item_id && line.taxable_amount > 0
                                ? line.taxable_amount.toFixed(2)
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
                                className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
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
                            <td className="border-r border-slate-300 px-1 py-0 text-right font-mono font-black text-slate-900 bg-slate-50/50 text-[11px] h-[16px] align-middle">
                              {line.line_total > 0 ? line.line_total.toFixed(2) : ''}
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

                {/* Microsoft Access Record Navigator Bar */}
                <div className="bg-slate-200 border-t border-slate-400 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
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

              {/* Full-Width MS Access Calculation & Action Footer (No Side-by-Side Split) */}
              <div className="p-1.5 bg-slate-900 text-white border-t border-slate-700 flex flex-col gap-1.5 shrink-0">
                {/* Row 1: Full-Width Totals, Discounts, Paid Amount & Balance */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Gross ({validLines.length}):</span>
                      <strong className="font-mono text-white">{formatPKR(grossTotal)}</strong>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Item Disc:</span>
                      <strong className="font-mono text-rose-300">-{formatPKR(itemDiscountTotal)}</strong>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Inv Disc %:</span>
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
                        className="w-14 px-1 py-0.5 text-right text-xs rounded bg-slate-800 border border-slate-600 text-white font-mono"
                      />
                      <strong className="font-mono text-rose-300">-{formatPKR(computedInvoiceDiscAmt)}</strong>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">GST + Adv Tax ({appliedAdvanceTaxRate}%):</span>
                      <strong className="font-mono text-amber-300">+{formatPKR(gstTotal + advanceTaxAmount)}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="px-2.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-1.5">
                      <span className="text-xs uppercase font-bold text-emerald-300">Net Total:</span>
                      <strong className="font-mono text-base font-black text-emerald-300 ams-total-highlight">
                        {formatPKR(netInvoiceAmount)}
                      </strong>
                    </div>
                    <div className="px-2.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 flex items-center gap-1.5">
                      <span className="text-xs uppercase font-bold text-sky-300">Total Payable:</span>
                      <strong className="font-mono text-base font-black text-sky-300 ams-total-highlight">
                        {formatPKR(totalPayable)}
                      </strong>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs uppercase font-bold text-slate-300">Paid:</span>
                      <NumericInput
                        step="0.01"
                        min="0"
                        value={paidAmount}
                        onChange={(e) => {
                          setPaidAmountManuallyEdited(true);
                          setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0));
                        }}
                        className="w-24 px-1.5 py-0.5 rounded bg-slate-800 border border-emerald-500 text-right font-mono font-bold text-emerald-300 text-xs"
                      />
                    </div>
                    <div className="px-2.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 flex items-center gap-1.5">
                      <span className="text-xs uppercase font-bold text-amber-300">Balance:</span>
                      <strong className="font-mono text-base font-black text-amber-300 ams-total-highlight">
                        {formatPKR(remainingBalance)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Row 2: Full-Width Action Buttons Bar */}
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="submit"
                      disabled={savingInvoice}
                      className="px-3.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {savingInvoice
                          ? 'Posting...'
                          : editingPurchaseId
                          ? 'Update & Re-Post (F2)'
                          : 'Confirm & Post Purchase (F2)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, true)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Save &amp; Print A4</span>
                    </button>
                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={handleExportCurrentPurchaseToExcel}
                      className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                      title="Export Purchase Invoice to Excel (.xlsx)"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewInvoice}
                      className="px-2.5 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-sky-200" />
                      <span>Preview (F4)</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingInvoice}
                      onClick={() => handleSavePurchaseInvoice(undefined, false, 'held')}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span>Hold (F3)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPurchaseOrderSms}
                      className="px-2.5 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                      title="Send Order SMS for Current Purchase Invoice"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-200" />
                      <span>Send Order SMS</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2.5 py-1 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer"
                    >
                      Reset Form
                    </button>
                    {onBackToDashboard && (
                      <button
                        type="button"
                        onClick={onBackToDashboard}
                        className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back / Close</span>
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
        onClose={() => setPrintModalOpen(false)}
        mode={printMode}
        invoice={printInvoice}
        invoiceItems={printInvoiceItems}
        purchaseReturn={printReturn}
        returnItems={printReturnItems}
        journalLines={printJournalLines}
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
                  <input
                    type="text"
                    value={newSupplierCity}
                    onChange={(e) => setNewSupplierCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900"
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
                  {heldPurchases.length === 0 ? (
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
                      <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{h.bill_number}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{h.bill_date}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{h.supplier_name || 'N/A'}</td>
                        <td className="px-3 py-2 text-center font-mono text-slate-600">
                          {h.item_count ?? '—'} Items ({h.total_packs ?? '—'} Pk)
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">
                            {h.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(h.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleResumeHeldPurchase(h.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer text-[10px]"
                            title="Resume this draft in datasheet"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDiscardHeldPurchase(h.id, h.bill_number)}
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
        <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden text-xs">
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

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
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
                  <div className="flex items-center justify-between">
                    <span className="text-slate-900 font-bold">New Purchase Price:</span>
                    <span className="font-mono font-black text-emerald-700 text-sm">
                      Rs. {priceChangePrompt.newPurchasePrice.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={updatingItemMasterPrice}
                    onClick={handleKeepOldPurchasePrice}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    NO – Keep Old
                  </button>
                  <button
                    type="button"
                    autoFocus
                    disabled={updatingItemMasterPrice}
                    onClick={handleApprovePurchasePriceStep1}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm cursor-pointer"
                  >
                    YES – Update
                  </button>
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
                      Formula: Retail = New Purchase Price ÷ 0.85 (2 decimals, no rounding to 50) &amp; Loose Rate = Retail ÷ Units Per Pack.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
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
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                    <div>
                      <div className="font-bold text-emerald-950">New Retail Price (Purchase ÷ 0.85):</div>
                      <div className="text-[10px] text-slate-500">
                        Current Retail: Rs. {priceChangePrompt.oldRetailPrice.toFixed(2)}
                      </div>
                    </div>
                    <span className="font-mono font-black text-emerald-700 text-base">
                      Rs. {priceChangePrompt.newRetailPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                    <div>
                      <div className="font-bold text-blue-950">
                        New Loose Rate (÷ {priceChangePrompt.unitsPerPack} units):
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Current Loose Rate: Rs. {priceChangePrompt.oldLooseRate.toFixed(2)}
                      </div>
                    </div>
                    <span className="font-mono font-black text-blue-700 text-sm">
                      Rs. {priceChangePrompt.newLooseRate.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={updatingItemMasterPrice}
                    onClick={() => handleFinalPriceCascadeDecision(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                  >
                    NO – Keep Existing Retail
                  </button>
                  <button
                    type="button"
                    autoFocus
                    disabled={updatingItemMasterPrice}
                    onClick={() => handleFinalPriceCascadeDecision(true)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50"
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
          stockPacksByItemId.has(Number(it.id))
            ? stockPacksByItemId.get(Number(it.id)) || 0
            : Number(it.opening_stock || 0)
        }
        onSelectItem={handleSelectItemFromPurchaseListModal}
        onSwitchToAddNewLine={() => setPurchaseItemListTargetRowIdx(null)}
        onClose={closePurchaseItemListModal}
      />
    </div>
  );
};
