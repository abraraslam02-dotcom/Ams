import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Lock,
  Layers,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  X,
  ClipboardPaste,
} from 'lucide-react';
import { Item, ItemPurchaseUnit, ItemTaxType } from '../../types/item';
import { api } from '../../services/api';
import { useResizableColumns } from '../../hooks/useResizableColumns';
import {
  calculateLooseRateFromRetail,
  parsePackingUnits,
  round2,
} from '../../utils/itemPricing';
import { resolveItemTaxConfig } from '../../utils/taxCalculation';
import { ITEM_CATEGORIES, classifyItemCategory } from '../../utils/itemCategory';

interface ItemMasterDatasheetViewProps {
  allCompanies: string[];
  allCategories: string[];
  onSwitchToRegistration: () => void;
  onMasterMutated: (notice?: string) => void;
  onDirtyCountChange?: (count: number) => void;
  onOpenVariants?: (item: Item) => void;
}

interface RowErrorInfo {
  id: number;
  item_code: string;
  item_name: string;
  error: string;
}

const DEFAULT_CATEGORIES = [...ITEM_CATEGORIES];

const PURCHASE_UNITS: ItemPurchaseUnit[] = ['Box', 'Carton', 'Strip', 'Tablet'];

const ROW_HEIGHT = 34;
const OVERSCAN = 12;

type ColKey =
  | 'row_num'
  | 'item_code'
  | 'item_name'
  | 'company_name'
  | 'generic_name'
  | 'category'
  | 'carton'
  | 'boxes_per_carton'
  | 'strips_per_box'
  | 'tablets_per_strip'
  | 'packing'
  | 'units_per_pack'
  | 'purchase_unit'
  | 'barcode'
  | 'purchase_price'
  | 'trade_price'
  | 'wholesale_price'
  | 'retail_price'
  | 'loose_rate'
  | 'discount_percent'
  | 'tax_type'
  | 'tax_value'
  | 'current_stock'
  | 'opening_stock'
  | 'minimum_stock'
  | 'rack_number'
  | 'variants_info'
  | 'status';

const EDITABLE_COLS: ColKey[] = [
  'item_name',
  'company_name',
  'generic_name',
  'category',
  'carton',
  'boxes_per_carton',
  'strips_per_box',
  'tablets_per_strip',
  'packing',
  'purchase_unit',
  'barcode',
  'purchase_price',
  'trade_price',
  'wholesale_price',
  'retail_price',
  'loose_rate',
  'discount_percent',
  'tax_type',
  'tax_value',
  'minimum_stock',
  'rack_number',
  'status',
];

const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  row_num: 48,
  item_code: 102,
  item_name: 225,
  company_name: 155,
  generic_name: 165,
  category: 130,
  carton: 66,
  boxes_per_carton: 76,
  strips_per_box: 76,
  tablets_per_strip: 76,
  packing: 92,
  units_per_pack: 74,
  purchase_unit: 90,
  barcode: 122,
  purchase_price: 92,
  trade_price: 90,
  wholesale_price: 92,
  retail_price: 94,
  loose_rate: 88,
  discount_percent: 68,
  tax_type: 90,
  tax_value: 76,
  current_stock: 82,
  opening_stock: 82,
  minimum_stock: 76,
  rack_number: 94,
  variants_info: 72,
  status: 86,
};

const MIN_COL_WIDTHS: Partial<Record<ColKey, number>> = {
  row_num: 42,
  item_code: 82,
  item_name: 140,
  company_name: 100,
  generic_name: 100,
  category: 95,
  carton: 52,
  boxes_per_carton: 58,
  strips_per_box: 58,
  tablets_per_strip: 58,
  packing: 72,
  units_per_pack: 58,
  purchase_unit: 76,
  barcode: 90,
  purchase_price: 72,
  trade_price: 72,
  wholesale_price: 72,
  retail_price: 74,
  loose_rate: 70,
  discount_percent: 56,
  tax_type: 74,
  tax_value: 60,
  current_stock: 64,
  opening_stock: 64,
  minimum_stock: 60,
  rack_number: 70,
  variants_info: 60,
  status: 74,
};

const TRACKED_DIFF_FIELDS: Array<keyof Item> = [
  'company_name',
  'item_name',
  'generic_name',
  'category',
  'carton',
  'boxes_per_carton',
  'strips_per_box',
  'tablets_per_strip',
  'units_per_strip',
  'units_per_pack',
  'packing',
  'purchase_unit',
  'barcode',
  'purchase_price',
  'trade_price',
  'wholesale_price',
  'retail_price',
  'loose_rate',
  'discount_percent',
  'tax_type',
  'tax_value',
  'tax_percent',
  'minimum_stock',
  'rack_number',
  'status',
];

function normalizeFieldForCompare(key: keyof Item, val: unknown): string | number | null {
  if (val === undefined || val === null || String(val).trim() === '') {
    if (
      key === 'carton' ||
      key === 'boxes_per_carton' ||
      key === 'strips_per_box' ||
      key === 'tablets_per_strip' ||
      key === 'generic_name' ||
      key === 'barcode' ||
      key === 'rack_number'
    ) {
      return null;
    }
    if (
      key === 'purchase_price' ||
      key === 'trade_price' ||
      key === 'wholesale_price' ||
      key === 'retail_price' ||
      key === 'loose_rate' ||
      key === 'discount_percent' ||
      key === 'tax_value' ||
      key === 'tax_percent' ||
      key === 'minimum_stock'
    ) {
      return 0;
    }
    return '';
  }

  if (
    key === 'carton' ||
    key === 'boxes_per_carton' ||
    key === 'strips_per_box' ||
    key === 'tablets_per_strip' ||
    key === 'units_per_strip' ||
    key === 'units_per_pack' ||
    key === 'purchase_price' ||
    key === 'trade_price' ||
    key === 'wholesale_price' ||
    key === 'retail_price' ||
    key === 'loose_rate' ||
    key === 'discount_percent' ||
    key === 'tax_value' ||
    key === 'tax_percent' ||
    key === 'minimum_stock'
  ) {
    const n = Number(val);
    return Number.isFinite(n) ? round2(n) : 0;
  }

  return String(val).trim();
}

function getRowDiff(original: Item, draft: Item): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of TRACKED_DIFF_FIELDS) {
    const origNorm = normalizeFieldForCompare(field, original[field]);
    const draftNorm = normalizeFieldForCompare(field, draft[field]);
    if (origNorm !== draftNorm) {
      changes[field] = draft[field] ?? null;
    }
  }
  return changes;
}

function syncPackingOnDraft(
  base: Item,
  patch: Partial<Item>,
  autoCalcLoose: boolean,
  looseTouched: boolean
): Item {
  const next: Item = { ...base, ...patch };
  if (patch.item_name !== undefined) {
    next.category = classifyItemCategory(next.item_name);
  }
  const changedPackingField =
    patch.strips_per_box !== undefined ||
    patch.tablets_per_strip !== undefined ||
    patch.packing !== undefined ||
    patch.carton !== undefined ||
    patch.boxes_per_carton !== undefined ||
    patch.purchase_unit !== undefined;

  if (patch.packing !== undefined && patch.strips_per_box === undefined && patch.tablets_per_strip === undefined) {
    const matrix = String(patch.packing || '').trim().match(/^(\d+)\s*[xX*×]\s*(\d+)$/);
    if (matrix) {
      next.strips_per_box = Math.max(1, parseInt(matrix[1], 10));
      next.tablets_per_strip = Math.max(1, parseInt(matrix[2], 10));
    }
  } else if (patch.strips_per_box !== undefined || patch.tablets_per_strip !== undefined) {
    const s = next.strips_per_box && Number(next.strips_per_box) > 0 ? Math.round(Number(next.strips_per_box)) : null;
    const t =
      next.tablets_per_strip && Number(next.tablets_per_strip) > 0 ? Math.round(Number(next.tablets_per_strip)) : null;
    const curPacking = String(next.packing || '').trim();
    const isMatrixOrDefault = !curPacking || curPacking === '1x1' || /^\d+\s*[xX*×]\s*\d+$/.test(curPacking);
    if (isMatrixOrDefault) {
      if (s && t) next.packing = `${s}x${t}`;
      else if (t && !s) next.packing = `1x${t}`;
      else if (s && !t) next.packing = `${s}x1`;
    }
  }

  const effStrips = next.strips_per_box && Number(next.strips_per_box) > 0 ? Math.round(Number(next.strips_per_box)) : null;
  const effTablets =
    next.tablets_per_strip && Number(next.tablets_per_strip) > 0 ? Math.round(Number(next.tablets_per_strip)) : null;

  next.units_per_strip = effTablets || 1;
  next.units_per_pack =
    effStrips && effTablets
      ? effStrips * effTablets
      : effTablets
      ? effTablets
      : parsePackingUnits(next.packing);

  if (
    autoCalcLoose &&
    !looseTouched &&
    patch.loose_rate === undefined &&
    (changedPackingField || patch.retail_price !== undefined)
  ) {
    const units = Math.max(1, Number(next.units_per_pack || 1));
    next.loose_rate = round2(Number(next.retail_price || 0) / units);
  }

  if (patch.tax_type !== undefined || patch.tax_value !== undefined) {
    const tType: ItemTaxType = next.tax_type === 'amount' ? 'amount' : 'percentage';
    const tVal = Math.max(0, round2(Number(next.tax_value ?? next.tax_percent ?? 0)));
    next.tax_type = tType;
    next.tax_value = tVal;
    next.tax_percent = tType === 'percentage' ? tVal : 0;
  }

  return next;
}

export const ItemMasterDatasheetView: React.FC<ItemMasterDatasheetViewProps> = ({
  allCompanies,
  allCategories,
  onSwitchToRegistration,
  onMasterMutated,
  onDirtyCountChange,
  onOpenVariants,
}) => {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft edits keyed by item.id (never loses edits on search/filter/scroll)
  const [drafts, setDrafts] = useState<Record<number, Item>>({});
  const [looseTouchedIds, setLooseTouchedIds] = useState<Set<number>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, RowErrorInfo>>({});
  const [autoCalcLoose, setAutoCalcLoose] = useState<boolean>(true);

  // Filters & sorting (purely client-side so editing & scrolling stay zero-latency)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showModifiedOnly, setShowModifiedOnly] = useState<boolean>(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<ColKey>('item_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Save & cancel UX state
  const [saving, setSaving] = useState<boolean>(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(
    null
  );

  // Active cell & virtualization state
  const [activeCell, setActiveCell] = useState<{ rowId: number; colKey: ColKey } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cellInputRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(540);

  const { colWidths, totalWidth, handleResizeStart, resetColumnWidth } = useResizableColumns({
    storageKey: 'ams_item_master_datasheet_col_widths_v1',
    defaultWidths: DEFAULT_COL_WIDTHS,
    minWidth: 42,
    columnMinWidths: MIN_COL_WIDTHS,
  });

  // Load ALL registered items continuously
  const loadAllItems = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await api.getItems({ sortBy: 'item_name', sortOrder: 'asc' });
      setAllItems(res.items || []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllItems();
  }, [loadAllItems]);

  // Observe scroll container viewport height for smooth virtualization
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportHeight(el.clientHeight || 540);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const originalById = useMemo(() => {
    const map = new Map<number, Item>();
    for (const it of allItems) {
      map.set(it.id, it);
    }
    return map;
  }, [allItems]);

  // Compute exact dirty map (only rows with at least 1 changed field)
  const dirtyEntries = useMemo(() => {
    const list: Array<{ id: number; original: Item; draft: Item; changes: Record<string, unknown> }> = [];
    for (const [idStr, draft] of Object.entries(drafts)) {
      const id = Number(idStr);
      const original = originalById.get(id);
      if (!original) continue;
      const changes = getRowDiff(original, draft);
      if (Object.keys(changes).length > 0) {
        list.push({ id, original, draft, changes });
      }
    }
    return list;
  }, [drafts, originalById]);

  const dirtyIdSet = useMemo(() => new Set(dirtyEntries.map((d) => d.id)), [dirtyEntries]);
  const dirtyFieldCount = useMemo(
    () => dirtyEntries.reduce((sum, entry) => sum + Object.keys(entry.changes).length, 0),
    [dirtyEntries]
  );

  useEffect(() => {
    onDirtyCountChange?.(dirtyEntries.length);
  }, [dirtyEntries.length, onDirtyCountChange]);

  const mergedCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    allCategories.forEach((c) => {
      if (c && c.trim()) set.add(c.trim());
    });
    allItems.forEach((it) => {
      if (it.category && it.category.trim()) set.add(it.category.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allCategories, allItems]);

  const mergedCompanies = useMemo(() => {
    const set = new Set<string>();
    allCompanies.forEach((c) => {
      if (c && c.trim()) set.add(c.trim());
    });
    allItems.forEach((it) => {
      if (it.company_name && it.company_name.trim()) set.add(it.company_name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allCompanies, allItems]);

  // Effective rows (merging drafts onto originals)
  const effectiveItems = useMemo(() => {
    return allItems.map((orig) => drafts[orig.id] || orig);
  }, [allItems, drafts]);

  // Client-side filter + sort across ALL items
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = effectiveItems.filter((item) => {
      if (showModifiedOnly && !dirtyIdSet.has(item.id)) return false;
      if (showErrorsOnly && !rowErrors[item.id]) return false;
      if (companyFilter !== 'all' && item.company_name !== companyFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (q) {
        const hay = `${item.item_name || ''} ${item.item_code || ''} ${item.company_name || ''} ${
          item.generic_name || ''
        } ${item.barcode || ''} ${item.rack_number || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const getVal = (it: Item): string | number => {
        switch (sortBy) {
          case 'item_code':
            return it.item_code || '';
          case 'item_name':
            return it.item_name || '';
          case 'company_name':
            return it.company_name || '';
          case 'generic_name':
            return it.generic_name || '';
          case 'category':
            return it.category || '';
          case 'carton':
            return Number(it.carton || 0);
          case 'boxes_per_carton':
            return Number(it.boxes_per_carton || 0);
          case 'strips_per_box':
            return Number(it.strips_per_box || 0);
          case 'tablets_per_strip':
            return Number(it.tablets_per_strip || 0);
          case 'packing':
            return it.packing || '';
          case 'units_per_pack':
            return Number(it.units_per_pack || 1);
          case 'purchase_unit':
            return it.purchase_unit || 'Box';
          case 'barcode':
            return it.barcode || '';
          case 'purchase_price':
            return Number(it.purchase_price || 0);
          case 'trade_price':
            return Number(it.trade_price || 0);
          case 'wholesale_price':
            return Number(it.wholesale_price || 0);
          case 'retail_price':
            return Number(it.retail_price || 0);
          case 'loose_rate':
            return Number(it.loose_rate || 0);
          case 'discount_percent':
            return Number(it.discount_percent || 0);
          case 'tax_type':
            return it.tax_type || 'percentage';
          case 'tax_value':
            return Number(it.tax_value ?? it.tax_percent ?? 0);
          case 'current_stock':
            return Number(it.consolidated_stock_packs ?? it.opening_stock ?? 0);
          case 'opening_stock':
            return Number(it.opening_stock || 0);
          case 'minimum_stock':
            return Number(it.minimum_stock || 0);
          case 'rack_number':
            return it.rack_number || '';
          case 'status':
            return it.status || 'Active';
          default:
            return it.item_name || '';
        }
      };

      const va = getVal(a);
      const vb = getVal(b);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [
    effectiveItems,
    searchQuery,
    companyFilter,
    categoryFilter,
    statusFilter,
    showModifiedOnly,
    showErrorsOnly,
    dirtyIdSet,
    rowErrors,
    sortBy,
    sortOrder,
  ]);

  // Virtual window calculations
  const totalRows = filteredRows.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(totalRows, startIndex + visibleRowCount);
  const visibleRows = filteredRows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

  const stickyLeftItemCode = colWidths.row_num;
  const stickyLeftItemName = colWidths.row_num + colWidths.item_code;
  const stickyFrozenTotalWidth = stickyLeftItemName + colWidths.item_name;

  const handleSortClick = (colKey: ColKey) => {
    if (colKey === 'row_num' || colKey === 'variants_info') return;
    if (sortBy === colKey) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(colKey);
      setSortOrder('asc');
    }
  };

  // Update a row's draft state cleanly and clear stale error for that row
  const applyRowPatch = useCallback(
    (itemId: number, patch: Partial<Item>, explicitLooseEdit: boolean = false) => {
      const original = originalById.get(itemId);
      if (!original) return;

      if (explicitLooseEdit) {
        setLooseTouchedIds((prev) => {
          const next = new Set(prev);
          next.add(itemId);
          return next;
        });
      }

      const wasLooseTouched = explicitLooseEdit || looseTouchedIds.has(itemId);

      setDrafts((prev) => {
        const current = prev[itemId] || original;
        const updated = syncPackingOnDraft(current, patch, autoCalcLoose, wasLooseTouched);
        const diff = getRowDiff(original, updated);
        if (Object.keys(diff).length === 0) {
          if (!prev[itemId]) return prev;
          const copy = { ...prev };
          delete copy[itemId];
          return copy;
        }
        return { ...prev, [itemId]: updated };
      });

      setRowErrors((prev) => {
        if (!prev[itemId]) return prev;
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    },
    [originalById, looseTouchedIds, autoCalcLoose]
  );

  // Revert a single cell back to original DB value
  const revertSingleCell = useCallback(
    (itemId: number, colKey: ColKey) => {
      const original = originalById.get(itemId);
      if (!original) return;
      const patch: Partial<Item> = {};
      if (colKey === 'tax_value') {
        const cfg = resolveItemTaxConfig(original);
        patch.tax_value = cfg.tax_value;
        patch.tax_percent = cfg.tax_percent;
      } else if (colKey === 'tax_type') {
        const cfg = resolveItemTaxConfig(original);
        patch.tax_type = cfg.tax_type;
        patch.tax_percent = cfg.tax_percent;
      } else {
        (patch as any)[colKey] = (original as any)[colKey];
      }
      applyRowPatch(itemId, patch, colKey === 'loose_rate');
    },
    [originalById, applyRowPatch]
  );

  const registerCellRef = useCallback((rowId: number, colKey: ColKey, el: HTMLElement | null) => {
    const key = `${rowId}::${colKey}`;
    if (el) {
      cellInputRefs.current.set(key, el);
    } else {
      cellInputRefs.current.delete(key);
    }
  }, []);

  // Scroll virtualized row + horizontal column into view and focus element
  const focusCellAt = useCallback(
    (targetRowIndex: number, targetColKey: ColKey) => {
      if (targetRowIndex < 0 || targetRowIndex >= filteredRows.length) return;
      const targetItem = filteredRows[targetRowIndex];
      if (!targetItem) return;

      const container = scrollContainerRef.current;
      if (container) {
        const headerOffset = 58; // sticky thead height
        const rowTop = targetRowIndex * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        const visibleTop = container.scrollTop;
        const visibleBottom = visibleTop + container.clientHeight - headerOffset;

        if (rowTop < visibleTop) {
          container.scrollTop = rowTop;
        } else if (rowBottom > visibleBottom) {
          container.scrollTop = Math.max(0, rowBottom - (container.clientHeight - headerOffset));
        }
      }

      setActiveCell({ rowId: targetItem.id, colKey: targetColKey });

      const attemptFocus = (triesLeft: number) => {
        const el = cellInputRefs.current.get(`${targetItem.id}::${targetColKey}`);
        if (el) {
          el.focus({ preventScroll: false });
          if (el instanceof HTMLInputElement && el.type === 'text') {
            el.select();
          }
          // Ensure non-frozen column isn't tucked behind sticky left columns
          if (
            container &&
            targetColKey !== 'item_name' &&
            el.getBoundingClientRect &&
            container.getBoundingClientRect
          ) {
            const cRect = container.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();
            const leftBoundary = cRect.left + stickyFrozenTotalWidth;
            if (eRect.left < leftBoundary) {
              container.scrollLeft = Math.max(0, container.scrollLeft - (leftBoundary - eRect.left) - 12);
            } else if (eRect.right > cRect.right - 16) {
              container.scrollLeft += eRect.right - (cRect.right - 16);
            }
          }
        } else if (triesLeft > 0) {
          requestAnimationFrame(() => attemptFocus(triesLeft - 1));
        }
      };

      requestAnimationFrame(() => attemptFocus(3));
    },
    [filteredRows, stickyFrozenTotalWidth]
  );

  const moveHorizontal = useCallback(
    (rowIndex: number, colKey: ColKey, dir: 1 | -1, wrapRow: boolean) => {
      const colIdx = EDITABLE_COLS.indexOf(colKey);
      if (colIdx === -1) return;
      const nextColIdx = colIdx + dir;
      if (nextColIdx >= 0 && nextColIdx < EDITABLE_COLS.length) {
        focusCellAt(rowIndex, EDITABLE_COLS[nextColIdx]);
      } else if (wrapRow) {
        const nextRowIdx = rowIndex + dir;
        if (nextRowIdx >= 0 && nextRowIdx < filteredRows.length) {
          const wrappedCol = dir === 1 ? EDITABLE_COLS[0] : EDITABLE_COLS[EDITABLE_COLS.length - 1];
          focusCellAt(nextRowIdx, wrappedCol);
        }
      }
    },
    [filteredRows.length, focusCellAt]
  );

  // Keyboard navigation handler for spreadsheet cells
  const handleCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
      rowIndex: number,
      rowId: number,
      colKey: ColKey,
      isSelect: boolean = false
    ) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        moveHorizontal(rowIndex, colKey, e.shiftKey ? -1 : 1, true);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        focusCellAt(rowIndex + (e.shiftKey ? -1 : 1), colKey);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        revertSingleCell(rowId, colKey);
        (e.currentTarget as HTMLElement).blur();
        return;
      }
      if (!isSelect) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusCellAt(rowIndex + 1, colKey);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusCellAt(rowIndex - 1, colKey);
          return;
        }
        const input = e.currentTarget as HTMLInputElement;
        if (e.key === 'ArrowRight') {
          if (
            input.selectionStart === null ||
            (input.selectionStart === input.value.length && input.selectionEnd === input.value.length)
          ) {
            e.preventDefault();
            moveHorizontal(rowIndex, colKey, 1, false);
          }
        } else if (e.key === 'ArrowLeft') {
          if (
            input.selectionStart === null ||
            (input.selectionStart === 0 && input.selectionEnd === 0)
          ) {
            e.preventDefault();
            moveHorizontal(rowIndex, colKey, -1, false);
          }
        }
      } else {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          moveHorizontal(rowIndex, colKey, 1, false);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          moveHorizontal(rowIndex, colKey, -1, false);
        }
      }
    },
    [focusCellAt, moveHorizontal, revertSingleCell]
  );

  // Multi-cell / multi-row Excel clipboard paste handler
  const handleCellPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, startRowIndex: number, startColKey: ColKey) => {
      const rawText = e.clipboardData?.getData('text/plain');
      if (!rawText) return;
      const hasTabular = rawText.includes('\t') || rawText.includes('\n') || rawText.includes('\r');
      if (!hasTabular) return; // Single-cell text paste uses default browser behavior

      e.preventDefault();
      const startColIdx = EDITABLE_COLS.indexOf(startColKey);
      if (startColIdx === -1) return;

      const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop(); // Excel trailing newline
      }
      if (lines.length === 0) return;

      let pastedCellsCount = 0;
      let pastedRowsCount = 0;
      const touchedLooseIds = new Set<number>();

      setDrafts((prevDrafts) => {
        const nextDrafts = { ...prevDrafts };

        for (let r = 0; r < lines.length; r++) {
          const targetRowIdx = startRowIndex + r;
          if (targetRowIdx >= filteredRows.length) break;
          const targetRow = filteredRows[targetRowIdx];
          const original = originalById.get(targetRow.id);
          if (!original) continue;

          const cells = lines[r].split('\t');
          let current = nextDrafts[original.id] || original;
          const rowPatch: Partial<Item> = {};
          let rowHasLoosePaste = false;

          for (let c = 0; c < cells.length; c++) {
            const targetColIdx = startColIdx + c;
            if (targetColIdx >= EDITABLE_COLS.length) break;
            const colKey = EDITABLE_COLS[targetColIdx];
            const rawVal = String(cells[c] ?? '').trim();

            if (colKey === 'item_name' || colKey === 'company_name' || colKey === 'category' || colKey === 'packing') {
              (rowPatch as any)[colKey] = rawVal;
            } else if (colKey === 'generic_name' || colKey === 'barcode' || colKey === 'rack_number') {
              (rowPatch as any)[colKey] = rawVal;
            } else if (colKey === 'carton') {
              if (rawVal === '') rowPatch.carton = null;
              else {
                const n = Number(rawVal.replace(/,/g, ''));
                if (Number.isFinite(n) && n >= 0) rowPatch.carton = n > 0 ? round2(n) : null;
              }
            } else if (colKey === 'boxes_per_carton' || colKey === 'strips_per_box' || colKey === 'tablets_per_strip') {
              if (rawVal === '') (rowPatch as any)[colKey] = null;
              else {
                const n = Math.round(Number(rawVal.replace(/,/g, '')));
                if (Number.isFinite(n) && n >= 0) (rowPatch as any)[colKey] = n > 0 ? n : null;
              }
            } else if (colKey === 'purchase_unit') {
              const lower = rawVal.toLowerCase();
              if (lower.includes('carton')) rowPatch.purchase_unit = 'Carton';
              else if (lower.includes('strip')) rowPatch.purchase_unit = 'Strip';
              else if (lower.includes('tab')) rowPatch.purchase_unit = 'Tablet';
              else if (lower.includes('box')) rowPatch.purchase_unit = 'Box';
            } else if (
              colKey === 'purchase_price' ||
              colKey === 'trade_price' ||
              colKey === 'wholesale_price' ||
              colKey === 'retail_price' ||
              colKey === 'loose_rate' ||
              colKey === 'discount_percent' ||
              colKey === 'tax_value' ||
              colKey === 'minimum_stock'
            ) {
              const cleaned = rawVal.replace(/rs\.?|pkr|%|,/gi, '').trim();
              const n = cleaned === '' ? 0 : Number(cleaned);
              if (Number.isFinite(n) && n >= 0) {
                (rowPatch as any)[colKey] = round2(n);
                if (colKey === 'loose_rate') rowHasLoosePaste = true;
              }
            } else if (colKey === 'tax_type') {
              const lower = rawVal.toLowerCase();
              rowPatch.tax_type =
                lower.includes('amount') || lower.includes('fixed') || lower.includes('rs')
                  ? 'amount'
                  : 'percentage';
            } else if (colKey === 'status') {
              const lower = rawVal.toLowerCase();
              rowPatch.status = lower === 'inactive' || lower === '0' || lower === 'no' ? 'Inactive' : 'Active';
            }

            pastedCellsCount++;
          }

          if (rowHasLoosePaste) {
            touchedLooseIds.add(original.id);
          }
          const wasLooseTouched = rowHasLoosePaste || looseTouchedIds.has(original.id);
          current = syncPackingOnDraft(current, rowPatch, autoCalcLoose, wasLooseTouched);
          const diff = getRowDiff(original, current);
          if (Object.keys(diff).length > 0) {
            nextDrafts[original.id] = current;
          } else {
            delete nextDrafts[original.id];
          }
          pastedRowsCount++;
        }

        return nextDrafts;
      });

      if (touchedLooseIds.size > 0) {
        setLooseTouchedIds((prev) => {
          const next = new Set(prev);
          touchedLooseIds.forEach((id) => next.add(id));
          return next;
        });
      }

      setBannerNotice({
        type: 'success',
        text: `Pasted ${pastedCellsCount} cell(s) across ${pastedRowsCount} row(s) from clipboard. Review highlighted changes and click "Save All Changes".`,
      });
    },
    [filteredRows, originalById, looseTouchedIds, autoCalcLoose]
  );

  // Client-side pre-save validation (returns valid rows and per-row errors)
  const validateBeforeSave = useCallback(() => {
    const validUpdates: Array<{
      id: number;
      changes: Record<string, unknown>;
      expected_updated_at?: string;
    }> = [];
    const clientErrors: RowErrorInfo[] = [];

    // Build effective barcode ownership map to catch duplicates across dirty rows & existing DB rows
    const barcodeOwners = new Map<string, number[]>();
    for (const it of effectiveItems) {
      const bc = String(it.barcode || '').trim().toLowerCase();
      if (!bc) continue;
      if (!barcodeOwners.has(bc)) barcodeOwners.set(bc, []);
      barcodeOwners.get(bc)!.push(it.id);
    }

    for (const entry of dirtyEntries) {
      const { id, original, draft, changes } = entry;
      const problems: string[] = [];

      if (!String(draft.item_name || '').trim()) {
        problems.push('Item Name is required');
      }
      if (!String(draft.company_name || '').trim()) {
        problems.push('Company Name is required');
      }
      if (!String(draft.category || '').trim()) {
        problems.push('Category is required');
      }
      if (!String(draft.packing || '').trim()) {
        problems.push('Packing Specification is required');
      }

      const numChecks: Array<[string, number | undefined]> = [
        ['Purchase Rate', draft.purchase_price],
        ['Trade Price', draft.trade_price],
        ['Wholesale Price', draft.wholesale_price],
        ['Retail Price', draft.retail_price],
        ['Loose Rate', draft.loose_rate],
        ['Discount %', draft.discount_percent],
        ['Tax Value', draft.tax_value],
        ['Minimum Stock', draft.minimum_stock],
      ];
      for (const [label, val] of numChecks) {
        const n = Number(val ?? 0);
        if (!Number.isFinite(n) || n < 0) {
          problems.push(`${label} must be 0 or greater`);
        }
      }
      if (Number(draft.discount_percent || 0) > 100) {
        problems.push('Discount % cannot exceed 100%');
      }

      const bc = String(draft.barcode || '').trim().toLowerCase();
      if (bc) {
        const owners = barcodeOwners.get(bc) || [];
        if (owners.some((oid) => oid !== id)) {
          problems.push(`Barcode "${draft.barcode}" duplicates another item in catalog`);
        }
      }

      if (problems.length > 0) {
        clientErrors.push({
          id,
          item_code: original.item_code,
          item_name: draft.item_name || original.item_name,
          error: problems.join('; '),
        });
      } else {
        validUpdates.push({
          id,
          changes,
          expected_updated_at: original.updated_at,
        });
      }
    }

    return { validUpdates, clientErrors };
  }, [dirtyEntries, effectiveItems]);

  // Controlled Bulk Save operation
  const handleSaveAllChanges = async () => {
    if (dirtyEntries.length === 0 || saving) return;

    const { validUpdates, clientErrors } = validateBeforeSave();

    if (validUpdates.length === 0 && clientErrors.length > 0) {
      const errMap: Record<number, RowErrorInfo> = {};
      clientErrors.forEach((e) => {
        errMap[e.id] = e;
      });
      setRowErrors(errMap);
      setBannerNotice({
        type: 'error',
        text: `${clientErrors.length} modified row(s) have validation errors. Fix highlighted rows below — no changes were discarded.`,
      });
      return;
    }

    try {
      setSaving(true);
      setBannerNotice(null);

      const res = await api.bulkUpdateItems(validUpdates);

      const savedById = new Map<number, Item>();
      for (const savedItem of res.updatedItems || []) {
        savedById.set(Number(savedItem.id), savedItem);
      }

      // Merge saved items cleanly into master state without wiping remaining invalid drafts
      if (savedById.size > 0) {
        setAllItems((prev) => prev.map((it) => savedById.get(it.id) || it));
        setDrafts((prev) => {
          const next = { ...prev };
          savedById.forEach((_val, savedId) => {
            delete next[savedId];
          });
          return next;
        });
        setLooseTouchedIds((prev) => {
          const next = new Set(prev);
          savedById.forEach((_val, savedId) => next.delete(savedId));
          return next;
        });
      }

      const combinedErrors = [...clientErrors, ...(res.errors || [])];
      const errMap: Record<number, RowErrorInfo> = {};
      combinedErrors.forEach((e) => {
        errMap[e.id] = e;
      });
      setRowErrors(errMap);

      if (combinedErrors.length === 0) {
        const msg = `Bulk Save complete: ${savedById.size} item(s) updated safely without touching stock batches or historical invoices.`;
        setBannerNotice({ type: 'success', text: msg });
        onMasterMutated(msg);
      } else if (savedById.size > 0) {
        setBannerNotice({
          type: 'warning',
          text: `Saved ${savedById.size} valid item(s); ${combinedErrors.length} item(s) failed validation and remain unsaved for review.`,
        });
        onMasterMutated();
      } else {
        setBannerNotice({
          type: 'error',
          text: `Save blocked on ${combinedErrors.length} item(s) due to validation errors. Please review highlighted rows.`,
        });
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelAllChanges = () => {
    setDrafts({});
    setLooseTouchedIds(new Set());
    setRowErrors({});
    setConfirmDiscardOpen(false);
    setShowModifiedOnly(false);
    setShowErrorsOnly(false);
    setBannerNotice({ type: 'warning', text: 'All unsaved datasheet changes were discarded.' });
  };

  const jumpToRowId = (rowId: number) => {
    setShowModifiedOnly(false);
    setShowErrorsOnly(false);
    setSearchQuery('');
    setCompanyFilter('all');
    setCategoryFilter('all');
    setStatusFilter('all');
    setTimeout(() => {
      const idx = filteredRows.findIndex((r) => r.id === rowId);
      if (idx >= 0) {
        focusCellAt(idx, 'item_name');
      }
    }, 60);
  };

  const errorList = Object.values(rowErrors);

  const renderSortIcon = (key: ColKey) => {
    if (sortBy !== key) return <ArrowUpDown className="w-3 h-3 text-slate-400 shrink-0 opacity-60" />;
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-emerald-700 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-emerald-700 shrink-0" />
    );
  };

  const isCellDirty = (rowId: number, colKey: ColKey): boolean => {
    const orig = originalById.get(rowId);
    const draft = drafts[rowId];
    if (!orig || !draft) return false;
    if (colKey === 'row_num' || colKey === 'item_code' || colKey === 'current_stock' || colKey === 'opening_stock' || colKey === 'variants_info') {
      return false;
    }
    const key = colKey as keyof Item;
    return normalizeFieldForCompare(key, orig[key]) !== normalizeFieldForCompare(key, draft[key]);
  };

  return (
    <div className="space-y-3">
      {/* Compact Datasheet Command & Bulk Save Bar */}
      <div className="bg-white border border-slate-300 rounded-xl shadow-xs p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  Item Master Datasheet — Bulk Editing View
                </h3>
                <p className="text-[11px] text-slate-500">
                  All {allItems.length} registered items &bull; Tab / Enter / Arrow keys &bull; Multi-cell Excel paste supported
                </p>
              </div>
            </div>

            {dirtyEntries.length > 0 ? (
              <span className="px-2.5 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-950 text-xs font-bold tabular-nums">
                {dirtyEntries.length} row{dirtyEntries.length === 1 ? '' : 's'} ({dirtyFieldCount} field
                {dirtyFieldCount === 1 ? '' : 's'}) unsaved
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600 text-xs font-medium">
                All changes saved
              </span>
            )}

            {errorList.length > 0 && (
              <button
                type="button"
                onClick={() => setShowErrorsOnly((v) => !v)}
                className={`px-2.5 py-1 rounded-md border text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  showErrorsOnly
                    ? 'bg-rose-600 border-rose-700 text-white'
                    : 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{errorList.length} Row Error{errorList.length === 1 ? '' : 's'}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-700 cursor-pointer select-none"
              title="Automatically recalculate Loose Rate when Retail Price or Packing changes (unless Loose Rate is manually edited on that row)"
            >
              <input
                type="checkbox"
                checked={autoCalcLoose}
                onChange={(e) => setAutoCalcLoose(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Auto Loose Rate</span>
            </label>

            <button
              type="button"
              onClick={loadAllItems}
              disabled={loading || saving}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Reload catalog from database"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (dirtyEntries.length > 0) setConfirmDiscardOpen(true);
              }}
              disabled={dirtyEntries.length === 0 || saving}
              className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Cancel Changes</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAllChanges}
              disabled={dirtyEntries.length === 0 || saving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {saving
                  ? 'Saving All...'
                  : dirtyEntries.length > 0
                  ? `Save All Changes (${dirtyEntries.length})`
                  : 'Save All Changes'}
              </span>
            </button>
          </div>
        </div>

        {/* Inline Discard Confirmation Bar */}
        {confirmDiscardOpen && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-rose-900 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                Discard all unsaved edits across {dirtyEntries.length} modified item(s) ({dirtyFieldCount} fields)?
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscardOpen(false)}
                className="px-3 py-1 rounded bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleCancelAllChanges}
                className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
              >
                Yes, Discard All Changes
              </button>
            </div>
          </div>
        )}

        {/* Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-center">
          <div className="lg:col-span-4 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Item Name, Code, Company, Generic, Barcode..."
              className="w-full pl-8 pr-7 py-1 text-xs rounded-md border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="lg:col-span-2">
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-md border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Companies ({mergedCompanies.length})</option>
              {mergedCompanies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-md border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Categories</option>
              {mergedCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-md border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Status</option>
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>

          <div className="lg:col-span-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowModifiedOnly((v) => !v)}
              className={`flex-1 px-2.5 py-1 rounded-md border text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                showModifiedOnly
                  ? 'bg-amber-500 border-amber-600 text-white'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Filter className="w-3 h-3" />
              <span>Modified ({dirtyEntries.length})</span>
            </button>
          </div>
        </div>

        {/* Status / Paste / Validation Notice */}
        {bannerNotice && (
          <div
            className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              bannerNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : bannerNotice.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {bannerNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : bannerNotice.type === 'warning' ? (
                <ClipboardPaste className="w-4 h-4 text-amber-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{bannerNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-xs font-bold opacity-70 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {loadError && (
          <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center justify-between">
            <span>Failed to load items: {loadError}</span>
            <button type="button" onClick={loadAllItems} className="font-bold underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {/* Per-row Validation Error Report Panel */}
        {errorList.length > 0 && (
          <div className="rounded-lg border border-rose-300 bg-rose-50/70 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-rose-900">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                Individual Row Errors ({errorList.length}) — Valid rows were preserved/saved; fix below to save remaining:
              </span>
              <button
                type="button"
                onClick={() => setRowErrors({})}
                className="text-[11px] font-semibold text-rose-700 hover:underline cursor-pointer"
              >
                Clear Error List
              </button>
            </div>
            <div className="max-h-28 overflow-y-auto divide-y divide-rose-200/70 bg-white rounded border border-rose-200">
              {errorList.map((err) => (
                <div key={err.id} className="px-2.5 py-1 text-[11px] flex items-center justify-between gap-2">
                  <div className="truncate">
                    <span className="font-mono font-bold text-slate-800 mr-1.5">{err.item_code || `#${err.id}`}</span>
                    <span className="font-semibold text-slate-900 mr-2">{err.item_name}</span>
                    <span className="text-rose-700 font-medium">{err.error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => jumpToRowId(err.id)}
                    className="shrink-0 px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-900 font-bold cursor-pointer"
                  >
                    Locate
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shared Datalist for Fast Company Autocomplete */}
      <datalist id="ams-datasheet-companies">
        {mergedCompanies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* MS Access / Excel Continuous Datasheet Grid */}
      <div className="bg-white border border-slate-400/80 rounded-lg shadow-xs overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="overflow-auto relative bg-[#f3f5f8]"
          style={{ height: 'calc(100vh - 290px)', minHeight: '420px' }}
        >
          <table
            className="border-collapse table-fixed text-xs select-none bg-white"
            style={{ width: `${totalWidth}px` }}
          >
            <colgroup>
              {(Object.keys(DEFAULT_COL_WIDTHS) as ColKey[]).map((key) => (
                <col key={key} style={{ width: `${colWidths[key]}px` }} />
              ))}
            </colgroup>

            <thead className="sticky top-0 z-30">
              {/* Group Header Row */}
              <tr className="bg-slate-800 text-white text-[10px] font-bold tracking-wide">
                <th
                  colSpan={6}
                  className="py-1 px-2 text-left border-r border-slate-600 sticky left-0 z-40 bg-slate-800"
                >
                  Item Identity &amp; Classification
                </th>
                <th
                  colSpan={7}
                  className="py-1 px-2 text-center border-r border-slate-600 bg-emerald-900"
                >
                  Multi-Level Packing Configuration (Carton &rarr; Box &rarr; Strip &rarr; Tablet)
                </th>
                <th colSpan={9} className="py-1 px-2 text-center border-r border-slate-600 bg-sky-900">
                  Barcode, Pricing &amp; Tax Configuration
                </th>
                <th colSpan={6} className="py-1 px-2 text-center bg-slate-800">
                  Stock (Protected), Rack &amp; Status
                </th>
              </tr>

              {/* Column Header Row with Sort + Resize Handles */}
              <tr className="bg-[#e8edf3] text-slate-800 border-b-2 border-slate-400 text-[11px] font-bold">
                {(
                  [
                    { key: 'row_num', label: '#', align: 'center', stickyLeft: 0 },
                    { key: 'item_code', label: 'Code (Locked)', align: 'left', stickyLeft: stickyLeftItemCode },
                    {
                      key: 'item_name',
                      label: 'Item Name *',
                      align: 'left',
                      stickyLeft: stickyLeftItemName,
                      shadowRight: true,
                    },
                    { key: 'company_name', label: 'Company *', align: 'left' },
                    { key: 'generic_name', label: 'Generic Name', align: 'left' },
                    { key: 'category', label: 'Category *', align: 'left' },
                    { key: 'carton', label: 'Carton', align: 'right', groupTint: 'bg-emerald-50/90' },
                    { key: 'boxes_per_carton', label: 'Box/Ctn', align: 'right', groupTint: 'bg-emerald-50/90' },
                    { key: 'strips_per_box', label: 'Strip/Box', align: 'right', groupTint: 'bg-emerald-50/90' },
                    { key: 'tablets_per_strip', label: 'Tab/Strip', align: 'right', groupTint: 'bg-emerald-50/90' },
                    { key: 'packing', label: 'Packing *', align: 'left', groupTint: 'bg-emerald-50/90' },
                    { key: 'units_per_pack', label: 'Units/Pk', align: 'right', groupTint: 'bg-emerald-50/90' },
                    { key: 'purchase_unit', label: 'Pur. Unit', align: 'left', groupTint: 'bg-emerald-50/90' },
                    { key: 'barcode', label: 'Barcode', align: 'left', groupTint: 'bg-sky-50/90' },
                    { key: 'purchase_price', label: 'Pur. Rate', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'trade_price', label: 'Trade (TP)', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'wholesale_price', label: 'Wholesale', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'retail_price', label: 'Retail (MRP)', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'loose_rate', label: 'Loose Rate', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'discount_percent', label: 'Disc %', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'tax_type', label: 'Tax Type', align: 'left', groupTint: 'bg-sky-50/90' },
                    { key: 'tax_value', label: 'Tax Val', align: 'right', groupTint: 'bg-sky-50/90' },
                    { key: 'current_stock', label: 'Curr Stk', align: 'right' },
                    { key: 'opening_stock', label: 'Open Stk', align: 'right' },
                    { key: 'minimum_stock', label: 'Min Stk', align: 'right' },
                    { key: 'rack_number', label: 'Rack #', align: 'left' },
                    { key: 'variants_info', label: 'Variants', align: 'center' },
                    { key: 'status', label: 'Status', align: 'center' },
                  ] as Array<{
                    key: ColKey;
                    label: string;
                    align: 'left' | 'right' | 'center';
                    stickyLeft?: number;
                    shadowRight?: boolean;
                    groupTint?: string;
                  }>
                ).map((col) => {
                  const isSortable = col.key !== 'row_num' && col.key !== 'variants_info';
                  return (
                    <th
                      key={col.key}
                      style={
                        col.stickyLeft !== undefined
                          ? { left: `${col.stickyLeft}px` }
                          : undefined
                      }
                      className={`relative border-r border-slate-300 h-8 px-1.5 select-none whitespace-nowrap ${
                        col.stickyLeft !== undefined
                          ? `sticky z-40 ${col.groupTint || 'bg-[#e8edf3]'}`
                          : col.groupTint || 'bg-[#e8edf3]'
                      } ${col.shadowRight ? 'shadow-[3px_0_6px_-2px_rgba(15,23,42,0.18)]' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => isSortable && handleSortClick(col.key)}
                        className={`w-full h-full flex items-center gap-1 text-[11px] font-bold text-slate-800 ${
                          col.align === 'right'
                            ? 'justify-end'
                            : col.align === 'center'
                            ? 'justify-center'
                            : 'justify-between'
                        } ${isSortable ? 'cursor-pointer hover:text-emerald-800' : 'cursor-default'}`}
                      >
                        <span className="truncate">{col.label}</span>
                        {isSortable && renderSortIcon(col.key)}
                      </button>

                      {/* Drag Resize Handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(col.key, e)}
                        onDoubleClick={(e) => resetColumnWidth(col.key, e)}
                        title="Drag to resize column (double-click to reset width)"
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-500/60 z-50"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {loading && allItems.length === 0 ? (
                <tr>
                  <td colSpan={28} className="py-12 text-center text-slate-500 text-xs">
                    Loading all registered items into Datasheet View...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={28} className="py-12 text-center text-slate-500 text-xs">
                    <div className="space-y-2">
                      <p className="font-semibold text-slate-700">No items match the current datasheet filters.</p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setCompanyFilter('all');
                            setCategoryFilter('all');
                            setStatusFilter('all');
                            setShowModifiedOnly(false);
                            setShowErrorsOnly(false);
                          }}
                          className="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold cursor-pointer"
                        >
                          Clear Filters
                        </button>
                        <button
                          type="button"
                          onClick={onSwitchToRegistration}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                        >
                          Go to Registration View
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {topSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={28} style={{ height: `${topSpacerHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}

                  {visibleRows.map((item, localIdx) => {
                    const rowIndex = startIndex + localIdx;
                    const rowDirty = dirtyIdSet.has(item.id);
                    const rowErr = rowErrors[item.id];
                    const isEven = rowIndex % 2 === 0;
                    const rowBg = rowErr
                      ? 'bg-rose-50/90'
                      : rowDirty
                      ? 'bg-amber-50/80'
                      : isEven
                      ? 'bg-white'
                      : 'bg-slate-50/70';
                    const taxCfg = resolveItemTaxConfig({
                      tax_type: item.tax_type,
                      tax_value: item.tax_value,
                      tax_percent: item.tax_percent,
                    });
                    const variantCount = Number(item.active_variant_count ?? item.variant_count ?? 0);
                    const hasVariants = Number(item.has_variants) === 1 || variantCount > 0;
                    const currStock = Number(item.consolidated_stock_packs ?? item.opening_stock ?? 0);

                    const cellBg = (colKey: ColKey, fallback: string) => {
                      if (rowErr) return 'bg-rose-50/95';
                      if (isCellDirty(item.id, colKey)) return 'bg-amber-100/90';
                      return fallback;
                    };

                    const inputClass = (colKey: ColKey, align: 'left' | 'right' = 'left', extra: string = '') =>
                      `w-full h-[32px] px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-600 focus:bg-white ${
                        align === 'right' ? 'text-right font-mono tabular-nums' : 'text-left'
                      } ${
                        activeCell?.rowId === item.id && activeCell?.colKey === colKey
                          ? 'bg-white ring-2 ring-inset ring-emerald-600'
                          : 'bg-transparent'
                      } ${extra}`;

                    return (
                      <tr
                        key={item.id}
                        style={{ height: `${ROW_HEIGHT}px` }}
                        className={`border-b border-slate-200 hover:bg-emerald-50/40 ${rowBg}`}
                      >
                        {/* # Row Selector (Frozen Left) */}
                        <td
                          style={{ left: '0px' }}
                          title={rowErr ? rowErr.error : rowDirty ? 'Unsaved changes on this row' : `Row ${rowIndex + 1}`}
                          className={`sticky z-20 border-r border-slate-300 text-center font-mono tabular-nums text-[11px] font-semibold px-1 ${
                            rowErr
                              ? 'bg-rose-200 text-rose-950'
                              : rowDirty
                              ? 'bg-amber-200 text-amber-950'
                              : 'bg-[#e8edf3] text-slate-600'
                          }`}
                        >
                          {rowIndex + 1}
                        </td>

                        {/* Item Code (Read-Only Locked, Frozen Left) */}
                        <td
                          style={{ left: `${stickyLeftItemCode}px` }}
                          title="Item Code is locked in Bulk Datasheet View to protect historical integrity"
                          className={`sticky z-20 border-r border-slate-300 px-1.5 font-mono text-[11px] font-bold text-slate-700 truncate ${
                            rowErr ? 'bg-rose-50' : rowDirty ? 'bg-amber-50' : isEven ? 'bg-slate-50' : 'bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-1 truncate">
                            <Lock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                            <span className="truncate">{item.item_code}</span>
                          </div>
                        </td>

                        {/* Item Name (Frozen Left) */}
                        <td
                          style={{ left: `${stickyLeftItemName}px` }}
                          className={`sticky z-20 border-r border-slate-300 p-0 shadow-[3px_0_6px_-2px_rgba(15,23,42,0.14)] ${cellBg(
                            'item_name',
                            isEven ? 'bg-white' : 'bg-slate-50'
                          )}`}
                        >
                          <input
                            ref={(el) => registerCellRef(item.id, 'item_name', el)}
                            type="text"
                            value={item.item_name || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'item_name' })}
                            onChange={(e) => applyRowPatch(item.id, { item_name: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'item_name')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'item_name')}
                            className={inputClass('item_name', 'left', 'font-semibold text-slate-900')}
                          />
                        </td>

                        {/* Company Name */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('company_name', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'company_name', el)}
                            type="text"
                            list="ams-datasheet-companies"
                            value={item.company_name || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'company_name' })}
                            onChange={(e) => applyRowPatch(item.id, { company_name: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'company_name')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'company_name')}
                            className={inputClass('company_name', 'left', 'text-slate-800')}
                          />
                        </td>

                        {/* Generic Name */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('generic_name', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'generic_name', el)}
                            type="text"
                            value={item.generic_name || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'generic_name' })}
                            onChange={(e) => applyRowPatch(item.id, { generic_name: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'generic_name')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'generic_name')}
                            className={inputClass('generic_name', 'left', 'text-slate-700')}
                          />
                        </td>

                        {/* Category */}
                        <td className={`border-r border-slate-300 p-0 ${cellBg('category', '')}`}>
                          <select
                            ref={(el) => registerCellRef(item.id, 'category', el)}
                            value={item.category || 'Tablet'}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'category' })}
                            onChange={(e) => applyRowPatch(item.id, { category: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'category', true)}
                            className={inputClass('category', 'left', 'text-slate-800 cursor-pointer')}
                          >
                            {mergedCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Carton */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('carton', 'bg-emerald-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'carton', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.carton ?? ''}
                            placeholder="—"
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'carton' })}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, {
                                carton: raw === '' ? null : Number(raw),
                              });
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'carton')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'carton')}
                            className={inputClass('carton', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Boxes / Carton */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('boxes_per_carton', 'bg-emerald-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'boxes_per_carton', el)}
                            type="text"
                            inputMode="numeric"
                            value={item.boxes_per_carton ?? ''}
                            placeholder="—"
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'boxes_per_carton' })}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw !== '' && !/^\d+$/.test(raw)) return;
                              applyRowPatch(item.id, {
                                boxes_per_carton: raw === '' ? null : parseInt(raw, 10),
                              });
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'boxes_per_carton')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'boxes_per_carton')}
                            className={inputClass('boxes_per_carton', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Strips / Box */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('strips_per_box', 'bg-emerald-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'strips_per_box', el)}
                            type="text"
                            inputMode="numeric"
                            value={item.strips_per_box ?? ''}
                            placeholder="—"
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'strips_per_box' })}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw !== '' && !/^\d+$/.test(raw)) return;
                              applyRowPatch(item.id, {
                                strips_per_box: raw === '' ? null : parseInt(raw, 10),
                              });
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'strips_per_box')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'strips_per_box')}
                            className={inputClass('strips_per_box', 'right', 'font-bold text-emerald-950')}
                          />
                        </td>

                        {/* Tablets / Strip */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('tablets_per_strip', 'bg-emerald-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'tablets_per_strip', el)}
                            type="text"
                            inputMode="numeric"
                            value={item.tablets_per_strip ?? ''}
                            placeholder="—"
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'tablets_per_strip' })}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw !== '' && !/^\d+$/.test(raw)) return;
                              applyRowPatch(item.id, {
                                tablets_per_strip: raw === '' ? null : parseInt(raw, 10),
                              });
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'tablets_per_strip')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'tablets_per_strip')}
                            className={inputClass('tablets_per_strip', 'right', 'font-bold text-emerald-950')}
                          />
                        </td>

                        {/* Packing */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('packing', 'bg-emerald-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'packing', el)}
                            type="text"
                            value={item.packing || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'packing' })}
                            onChange={(e) => applyRowPatch(item.id, { packing: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'packing')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'packing')}
                            className={inputClass('packing', 'left', 'font-mono font-bold text-slate-900')}
                          />
                        </td>

                        {/* Units / Pack (Calculated Read-Only) */}
                        <td
                          title={`Auto-calculated: ${item.units_per_pack ?? 1} base units/pack (${item.units_per_strip ?? 1} units/strip)`}
                          className="border-r border-slate-200 px-1.5 text-right font-mono tabular-nums font-bold text-emerald-800 bg-emerald-50/40"
                        >
                          {item.units_per_pack ?? parsePackingUnits(item.packing)}
                        </td>

                        {/* Purchase Unit */}
                        <td className={`border-r border-slate-300 p-0 ${cellBg('purchase_unit', 'bg-emerald-50/20')}`}>
                          <select
                            ref={(el) => registerCellRef(item.id, 'purchase_unit', el)}
                            value={item.purchase_unit || 'Box'}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'purchase_unit' })}
                            onChange={(e) =>
                              applyRowPatch(item.id, {
                                purchase_unit: e.target.value as ItemPurchaseUnit,
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'purchase_unit', true)}
                            className={inputClass('purchase_unit', 'left', 'font-semibold text-emerald-950 cursor-pointer')}
                          >
                            {PURCHASE_UNITS.map((pu) => (
                              <option key={pu} value={pu}>
                                {pu}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Barcode */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('barcode', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'barcode', el)}
                            type="text"
                            value={item.barcode || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'barcode' })}
                            onChange={(e) => applyRowPatch(item.id, { barcode: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'barcode')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'barcode')}
                            className={inputClass('barcode', 'left', 'font-mono text-slate-700')}
                          />
                        </td>

                        {/* Purchase Rate */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('purchase_price', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'purchase_price', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.purchase_price ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'purchase_price' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { purchase_price: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                purchase_price: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'purchase_price')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'purchase_price')}
                            className={inputClass('purchase_price', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Trade Price */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('trade_price', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'trade_price', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.trade_price ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'trade_price' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { trade_price: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                trade_price: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'trade_price')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'trade_price')}
                            className={inputClass('trade_price', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Wholesale Price */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('wholesale_price', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'wholesale_price', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.wholesale_price ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'wholesale_price' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { wholesale_price: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                wholesale_price: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'wholesale_price')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'wholesale_price')}
                            className={inputClass('wholesale_price', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Retail Price (MRP) */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('retail_price', 'bg-sky-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'retail_price', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.retail_price ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'retail_price' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { retail_price: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                retail_price: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'retail_price')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'retail_price')}
                            className={inputClass('retail_price', 'right', 'font-bold text-emerald-900')}
                          />
                        </td>

                        {/* Loose Rate */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('loose_rate', 'bg-sky-50/20')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'loose_rate', el)}
                            type="text"
                            inputMode="decimal"
                            value={
                              item.loose_rate !== undefined
                                ? item.loose_rate
                                : calculateLooseRateFromRetail(item.retail_price || 0, item.packing)
                            }
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'loose_rate' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { loose_rate: raw === '' ? 0 : (raw as any) }, true);
                            }}
                            onBlur={(e) =>
                              applyRowPatch(
                                item.id,
                                { loose_rate: round2(Math.max(0, parseFloat(e.target.value) || 0)) },
                                true
                              )
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'loose_rate')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'loose_rate')}
                            className={inputClass('loose_rate', 'right', 'font-bold text-blue-900')}
                          />
                        </td>

                        {/* Discount % */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('discount_percent', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'discount_percent', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.discount_percent ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'discount_percent' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { discount_percent: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                discount_percent: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'discount_percent')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'discount_percent')}
                            className={inputClass('discount_percent', 'right', 'text-slate-800')}
                          />
                        </td>

                        {/* Tax Type */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('tax_type', '')}`}>
                          <select
                            ref={(el) => registerCellRef(item.id, 'tax_type', el)}
                            value={taxCfg.tax_type}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'tax_type' })}
                            onChange={(e) =>
                              applyRowPatch(item.id, {
                                tax_type: e.target.value as ItemTaxType,
                                tax_value: taxCfg.tax_value,
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'tax_type', true)}
                            className={inputClass('tax_type', 'left', 'text-slate-800 cursor-pointer')}
                          >
                            <option value="percentage">% (Pct)</option>
                            <option value="amount">Rs (Fixed)</option>
                          </select>
                        </td>

                        {/* Tax Value */}
                        <td className={`border-r border-slate-300 p-0 ${cellBg('tax_value', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'tax_value', el)}
                            type="text"
                            inputMode="decimal"
                            value={taxCfg.tax_value}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'tax_value' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, {
                                tax_type: taxCfg.tax_type,
                                tax_value: raw === '' ? 0 : (raw as any),
                              });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                tax_type: taxCfg.tax_type,
                                tax_value: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'tax_value')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'tax_value')}
                            className={inputClass('tax_value', 'right', 'font-semibold text-amber-900')}
                          />
                        </td>

                        {/* Current Stock (Read-Only Protected) */}
                        <td
                          title="Live Stock (Protected: managed only by Purchase, Sales & Stock Adjustment modules)"
                          className="border-r border-slate-200 px-1.5 text-right font-mono tabular-nums font-bold text-slate-700 bg-slate-100/80"
                        >
                          {currStock}
                        </td>

                        {/* Opening Stock (Read-Only Protected) */}
                        <td
                          title="Opening Stock (Protected in Bulk Datasheet View)"
                          className="border-r border-slate-200 px-1.5 text-right font-mono tabular-nums text-slate-500 bg-slate-100/80"
                        >
                          {Number(item.opening_stock || 0)}
                        </td>

                        {/* Minimum Stock */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('minimum_stock', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'minimum_stock', el)}
                            type="text"
                            inputMode="decimal"
                            value={item.minimum_stock ?? 0}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'minimum_stock' })}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                              applyRowPatch(item.id, { minimum_stock: raw === '' ? 0 : (raw as any) });
                            }}
                            onBlur={(e) =>
                              applyRowPatch(item.id, {
                                minimum_stock: round2(Math.max(0, parseFloat(e.target.value) || 0)),
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'minimum_stock')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'minimum_stock')}
                            className={inputClass('minimum_stock', 'right', 'text-slate-700')}
                          />
                        </td>

                        {/* Rack # */}
                        <td className={`border-r border-slate-200 p-0 ${cellBg('rack_number', '')}`}>
                          <input
                            ref={(el) => registerCellRef(item.id, 'rack_number', el)}
                            type="text"
                            value={item.rack_number || ''}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'rack_number' })}
                            onChange={(e) => applyRowPatch(item.id, { rack_number: e.target.value })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'rack_number')}
                            onPaste={(e) => handleCellPaste(e, rowIndex, 'rack_number')}
                            className={inputClass('rack_number', 'left', 'text-slate-700')}
                          />
                        </td>

                        {/* Variants (Read-Only Summary Link) */}
                        <td className="border-r border-slate-200 px-1 text-center bg-slate-50/70">
                          {hasVariants && onOpenVariants ? (
                            <button
                              type="button"
                              onClick={() => onOpenVariants(item)}
                              className="px-1.5 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-900 text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer"
                              title="Open Variant Management"
                            >
                              <Layers className="w-2.5 h-2.5" />
                              <span>{variantCount}V</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">Std</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className={`p-0 ${cellBg('status', '')}`}>
                          <select
                            ref={(el) => registerCellRef(item.id, 'status', el)}
                            value={item.status || 'Active'}
                            onFocus={() => setActiveCell({ rowId: item.id, colKey: 'status' })}
                            onChange={(e) =>
                              applyRowPatch(item.id, {
                                status: e.target.value === 'Inactive' ? 'Inactive' : 'Active',
                              })
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, item.id, 'status', true)}
                            className={inputClass(
                              'status',
                              'left',
                              `font-bold cursor-pointer ${
                                item.status === 'Active' ? 'text-emerald-800' : 'text-slate-500'
                              }`
                            )}
                          >
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}

                  {bottomSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={28} style={{ height: `${bottomSpacerHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Datasheet Footer */}
        <div className="px-3.5 py-2 bg-[#e8edf3] border-t border-slate-300 text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Displaying <strong>{filteredRows.length}</strong> of <strong>{allItems.length}</strong> registered items
            </span>
            <span className="text-slate-400">&bull;</span>
            <span>
              Shortcuts: <strong>Enter</strong> Next Row &bull; <strong>Tab</strong> Next Cell &bull;{' '}
              <strong>Esc</strong> Revert Cell &bull; <strong>Ctrl+V</strong> Excel Multi-Cell Paste
            </span>
          </div>
          <span className="text-slate-500 font-medium">
            Code &amp; Stock columns are locked to safeguard batches, sales, purchases &amp; accounting ledgers
          </span>
        </div>
      </div>
    </div>
  );
};
