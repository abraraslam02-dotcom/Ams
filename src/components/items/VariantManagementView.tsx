import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  Edit2,
  Layers,
  Package,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { Item, ItemVariant } from '../../types/item';
import { formatPKR } from '../../utils/formatters';
import {
  calculateItemPricingFromPurchase,
  calculateLooseRateFromRetail,
} from '../../utils/itemPricing';
import { ProductThumb } from '../common/ProductThumb';
import { ProductImageUploader } from '../common/ProductImageUploader';
import { BarcodeLabelPrintModal } from '../common/BarcodeLabelPrintModal';
import { NumericInput } from '../common/NumericInput';

interface VariantManagementViewProps {
  initialParentItemId?: number | null;
  onNavigateToItemsMaster?: () => void;
}

export const VariantManagementView: React.FC<VariantManagementViewProps> = ({
  initialParentItemId = null,
  onNavigateToItemsMaster,
}) => {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<number>(initialParentItemId || 0);
  const [parentItem, setParentItem] = useState<Item | null>(null);
  const [variants, setVariants] = useState<ItemVariant[]>([]);
  const [nextVariantCode, setNextVariantCode] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [showAllProductsInDropdown, setShowAllProductsInDropdown] = useState(false);

  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Variant Form Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ItemVariant | null>(null);
  const [savingVariant, setSavingVariant] = useState(false);
  const [variantForm, setVariantForm] = useState({
    variant_code: '',
    variant_name: '',
    colour: '',
    flavour: '',
    variant_type: '',
    other_attributes: '',
    barcode: '',
    packing: '',
    use_parent_pricing: true,
    purchase_price: 0,
    trade_price: 0,
    wholesale_price: 0,
    retail_price: 0,
    loose_rate: 0,
    discount_percent: 0,
    tax_percent: 0,
    opening_stock: 0,
    minimum_stock: 0,
    rack_number: '',
    status: 'Active' as 'Active' | 'Inactive',
    image_id: null as number | null,
    image_url: '',
    thumbnail_url: '',
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [newExtraBarcode, setNewExtraBarcode] = useState('');
  const [addingBarcode, setAddingBarcode] = useState(false);

  // Print Barcode Label Modal
  const [printTarget, setPrintTarget] = useState<ItemVariant | null>(null);

  useEffect(() => {
    if (initialParentItemId) {
      setSelectedParentId(initialParentItemId);
    }
  }, [initialParentItemId]);

  useEffect(() => {
    if (!banner || banner.type !== 'success') return;
    const t = window.setTimeout(() => setBanner(null), 4000);
    return () => window.clearTimeout(t);
  }, [banner]);

  const loadItemsCatalog = useCallback(async () => {
    try {
      setLoadingItems(true);
      const res = await api.getItems({ status: 'all', sortBy: 'item_name', sortOrder: 'asc' });
      const fetched: Item[] = res.items || [];
      setAllItems(fetched);

      setSelectedParentId((prev) => {
        if (prev && fetched.some((i) => Number(i.id) === Number(prev))) return prev;
        if (initialParentItemId && fetched.some((i) => Number(i.id) === Number(initialParentItemId))) {
          return initialParentItemId;
        }
        const firstWithVariants = fetched.find((i) => Number(i.has_variants) === 1);
        return firstWithVariants ? firstWithVariants.id : 0;
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load items catalog.',
      });
    } finally {
      setLoadingItems(false);
    }
  }, [initialParentItemId]);

  useEffect(() => {
    loadItemsCatalog();
  }, [loadItemsCatalog]);

  const loadParentVariants = useCallback(async (itemId: number) => {
    if (!itemId) {
      setParentItem(null);
      setVariants([]);
      setNextVariantCode('');
      return;
    }
    try {
      setLoadingVariants(true);
      const res = await api.getItemVariants(itemId, true);
      setParentItem(res.parent || null);
      setVariants(res.variants || []);
      setNextVariantCode(res.nextVariantCode || '');
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load variants.',
      });
    } finally {
      setLoadingVariants(false);
    }
  }, []);

  useEffect(() => {
    loadParentVariants(selectedParentId);
  }, [selectedParentId, loadParentVariants]);

  const variantEnabledProducts = useMemo(() => {
    const withVar = allItems.filter((i) => Number(i.has_variants) === 1);
    if (showAllProductsInDropdown) return allItems;
    // Also include currently selected item even if user just toggled or clicked from outside
    if (selectedParentId && !withVar.some((i) => Number(i.id) === Number(selectedParentId))) {
      const sel = allItems.find((i) => Number(i.id) === Number(selectedParentId));
      if (sel) return [sel, ...withVar];
    }
    return withVar;
  }, [allItems, showAllProductsInDropdown, selectedParentId]);

  const filteredVariants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return variants.filter((v) => {
      if (statusFilter !== 'all' && v.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
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
        .toLowerCase();
      return hay.includes(q);
    });
  }, [variants, searchQuery, statusFilter]);

  const consolidatedVariantStock = useMemo(
    () => variants.reduce((sum, v) => sum + Number(v.current_stock_packs || 0), 0),
    [variants]
  );

  const openAddVariantModal = async () => {
    if (!parentItem) return;
    setEditingVariant(null);
    setNameTouched(false);
    let suggestedCode = nextVariantCode;
    try {
      const nextRes = await api.getNextVariantCode(parentItem.id);
      if (nextRes?.next_variant_code) suggestedCode = nextRes.next_variant_code;
    } catch {
      // keep existing suggestion
    }
    setVariantForm({
      variant_code: suggestedCode,
      variant_name: '',
      colour: '',
      flavour: '',
      variant_type: '',
      other_attributes: '',
      barcode: '',
      packing: '',
      use_parent_pricing: true,
      purchase_price: Number(parentItem.purchase_price || 0),
      trade_price: Number(parentItem.trade_price || 0),
      wholesale_price: Number(parentItem.wholesale_price || 0),
      retail_price: Number(parentItem.retail_price || 0),
      loose_rate: Number(parentItem.loose_rate || 0),
      discount_percent: Number(parentItem.discount_percent || 0),
      tax_percent: Number(parentItem.tax_percent || 0),
      opening_stock: 0,
      minimum_stock: Number(parentItem.minimum_stock || 0),
      rack_number: parentItem.rack_number || '',
      status: 'Active',
      image_id: null,
      image_url: '',
      thumbnail_url: '',
    });
    setNewExtraBarcode('');
    setFormOpen(true);
  };

  const openEditVariantModal = (v: ItemVariant) => {
    setEditingVariant(v);
    setNameTouched(true);
    setVariantForm({
      variant_code: v.variant_code || '',
      variant_name: v.variant_name || '',
      colour: v.colour || '',
      flavour: v.flavour || '',
      variant_type: v.variant_type || '',
      other_attributes: v.other_attributes || '',
      barcode: v.barcode || '',
      packing: v.packing || '',
      use_parent_pricing: Number(v.use_parent_pricing) === 1,
      purchase_price: Number(v.use_parent_pricing ? parentItem?.purchase_price : v.purchase_price) || 0,
      trade_price: Number(v.use_parent_pricing ? parentItem?.trade_price : v.trade_price) || 0,
      wholesale_price: Number(v.use_parent_pricing ? parentItem?.wholesale_price : v.wholesale_price) || 0,
      retail_price: Number(v.use_parent_pricing ? parentItem?.retail_price : v.retail_price) || 0,
      loose_rate: Number(v.use_parent_pricing ? parentItem?.loose_rate : v.loose_rate) || 0,
      discount_percent: Number(v.use_parent_pricing ? parentItem?.discount_percent : v.discount_percent) || 0,
      tax_percent: Number(v.use_parent_pricing ? parentItem?.tax_percent : v.tax_percent) || 0,
      opening_stock: Number(v.opening_stock || 0),
      minimum_stock: Number(v.minimum_stock || 0),
      rack_number: v.rack_number || '',
      status: v.status || 'Active',
      image_id: v.image_id ?? null,
      image_url: v.own_image_url || '',
      thumbnail_url: v.own_thumbnail_url || '',
    });
    setNewExtraBarcode('');
    setFormOpen(true);
  };

  const updateAttributeAndAutoName = (
    field: 'colour' | 'flavour' | 'variant_type' | 'other_attributes',
    value: string
  ) => {
    setVariantForm((prev) => {
      const updated = { ...prev, [field]: value };
      if (!nameTouched) {
        const auto = [updated.colour, updated.flavour, updated.variant_type, updated.other_attributes]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(' / ');
        updated.variant_name = auto;
      }
      return updated;
    });
  };

  const handleGeneratePrimaryBarcode = async () => {
    try {
      const res = await api.generateUniqueBarcode(variantForm.variant_code);
      if (res?.barcode) {
        setVariantForm((p) => ({ ...p, barcode: res.barcode }));
      }
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate barcode.',
      });
    }
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentItem) return;
    if (!variantForm.variant_name.trim() && !variantForm.colour.trim() && !variantForm.flavour.trim() && !variantForm.variant_type.trim()) {
      setBanner({ type: 'error', message: 'Please enter Variant Name or at least one attribute (Colour / Flavour / Type).' });
      return;
    }

    try {
      setSavingVariant(true);
      const payload = {
        ...variantForm,
        use_parent_pricing: variantForm.use_parent_pricing ? 1 : 0,
      };
      if (editingVariant) {
        const res = await api.updateItemVariant(editingVariant.id, payload);
        setBanner({ type: 'success', message: res.message || 'Variant updated successfully.' });
      } else {
        const res = await api.createItemVariant(parentItem.id, payload);
        setBanner({ type: 'success', message: res.message || 'Variant created successfully.' });
      }
      setFormOpen(false);
      await loadParentVariants(parentItem.id);
      await loadItemsCatalog();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save variant.',
      });
    } finally {
      setSavingVariant(false);
    }
  };

  const handleToggleVariantStatus = async (v: ItemVariant) => {
    const nextStatus = v.status === 'Active' ? 'Inactive' : 'Active';
    try {
      const res = await api.toggleVariantStatus(v.id, nextStatus);
      setBanner({
        type: 'success',
        message:
          res.message ||
          `Variant "${v.variant_name}" marked ${nextStatus}. Historical invoices remain preserved.`,
      });
      await loadParentVariants(selectedParentId);
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update variant status.',
      });
    }
  };

  const handleAddExtraBarcode = async (autoGenerate = false) => {
    if (!editingVariant) return;
    if (!autoGenerate && !newExtraBarcode.trim()) return;
    try {
      setAddingBarcode(true);
      const res = await api.addVariantBarcode(editingVariant.id, {
        barcode: autoGenerate ? undefined : newExtraBarcode.trim(),
        barcode_type: autoGenerate ? 'generated' : 'manufacturer',
        auto_generate: autoGenerate,
      });
      if (res.variant) {
        setEditingVariant(res.variant);
        setVariantForm((p) => ({ ...p, barcode: res.variant.barcode || p.barcode }));
      }
      setNewExtraBarcode('');
      await loadParentVariants(selectedParentId);
      setBanner({ type: 'success', message: `Barcode ${res.addedBarcode} attached to variant.` });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to attach barcode.',
      });
    } finally {
      setAddingBarcode(false);
    }
  };

  const handleDeleteExtraBarcode = async (barcodeId: number) => {
    if (!editingVariant) return;
    try {
      const res = await api.deleteVariantBarcode(editingVariant.id, barcodeId);
      if (res.variant) {
        setEditingVariant(res.variant);
        setVariantForm((p) => ({ ...p, barcode: res.variant.barcode || '' }));
      }
      await loadParentVariants(selectedParentId);
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete barcode.',
      });
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Item Variant Management
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
              Parent-Child Catalog
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage colours, flavours, types, custom barcodes, pictures & separate variant stock under each Main Product.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onNavigateToItemsMaster && (
            <button
              type="button"
              onClick={onNavigateToItemsMaster}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Back to Item Master
            </button>
          )}
          <button
            type="button"
            disabled={!parentItem}
            onClick={openAddVariantModal}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Variant</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="font-bold hover:opacity-75 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Product Picker Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800">
                Select Main Product (Size stays as Main Product; colours/flavours/types are its Variants)
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllProductsInDropdown}
                  onChange={(e) => setShowAllProductsInDropdown(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Include items without variants enabled yet</span>
              </label>
            </div>
            <select
              value={selectedParentId}
              disabled={loadingItems}
              onChange={(e) => setSelectedParentId(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value={0}>
                {loadingItems
                  ? 'Loading products...'
                  : variantEnabledProducts.length === 0
                  ? '-- No products with Has Variants = Yes yet (enable in Item Master or check box above) --'
                  : '-- Choose a Main Product --'}
              </option>
              {variantEnabledProducts.map((it) => (
                <option key={it.id} value={it.id}>
                  [{it.item_code}] {it.item_name} — {it.company_name || 'General'} ({it.packing})
                  {Number(it.variant_count || 0) > 0 ? ` • ${it.variant_count} variants` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={!selectedParentId || loadingVariants}
            onClick={() => loadParentVariants(selectedParentId)}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingVariants ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Selected Parent Summary */}
        {parentItem && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <ProductThumb
                src={parentItem.thumbnail_url || parentItem.image_url}
                fullSrc={parentItem.image_url}
                alt={parentItem.item_name}
                size="md"
                enableZoom
                className="bg-white"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                    {parentItem.item_code}
                  </span>
                  <h3 className="text-sm font-extrabold text-slate-900 truncate">
                    {parentItem.item_name}
                  </h3>
                  {Number(parentItem.has_variants) !== 1 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                      Adding a variant will auto-enable Has Variants = Yes
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Company: <strong>{parentItem.company_name || '—'}</strong></span>
                  <span>Packing: <strong className="font-mono">{parentItem.packing}</strong></span>
                  <span>Default Purchase: <strong className="font-mono">{formatPKR(parentItem.purchase_price)}</strong></span>
                  <span>Default Retail: <strong className="font-mono text-emerald-800">{formatPKR(parentItem.retail_price)}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase text-slate-400">Variants</div>
                <div className="text-lg font-extrabold font-mono text-slate-900">{variants.length}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase text-emerald-600">Consolidated Stock</div>
                <div className="text-lg font-extrabold font-mono text-emerald-700">
                  {consolidatedVariantStock} <span className="text-xs font-normal">Packs</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Variant List Table */}
      {parentItem ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search variants by code, colour, flavour, type, or barcode..."
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50"
              >
                <option value="all">All Statuses ({variants.length})</option>
                <option value="Active">Active Only</option>
                <option value="Inactive">Deactivated Only</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-3">Picture</th>
                  <th className="py-2.5 px-3">Variant Code</th>
                  <th className="py-2.5 px-3">Variant Name & Attributes</th>
                  <th className="py-2.5 px-3">Barcodes</th>
                  <th className="py-2.5 px-3">Pricing Mode</th>
                  <th className="py-2.5 px-3 text-right">Pur. Price</th>
                  <th className="py-2.5 px-3 text-right">Retail (MRP)</th>
                  <th className="py-2.5 px-3 text-center">Stock</th>
                  <th className="py-2.5 px-3 text-center">Min</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingVariants ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                      <span>Loading variants...</span>
                    </td>
                  </tr>
                ) : filteredVariants.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-500 space-y-2">
                      <Package className="w-8 h-8 text-slate-300 mx-auto" />
                      <div className="font-bold text-slate-700">No variants found</div>
                      <p className="text-[11px] text-slate-500">
                        Click "Add New Variant" to add colours, flavours, or types (e.g. {nextVariantCode || `${parentItem.item_code}01`}).
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredVariants.map((v) => {
                    const stockPacks = Number(v.current_stock_packs ?? 0);
                    const minStock = Number(v.effective_minimum_stock ?? v.minimum_stock ?? 0);
                    const isLow = minStock > 0 && stockPacks <= minStock;
                    const thumbSrc = v.effective_thumbnail_url || v.effective_image_url || parentItem.thumbnail_url || parentItem.image_url;
                    const fullSrc = v.effective_image_url || parentItem.image_url || thumbSrc;
                    const allBarcodes = Array.isArray(v.barcodes) ? v.barcodes.map((b) => b.barcode) : [];
                    const attrList = [
                      v.colour ? `Colour: ${v.colour}` : '',
                      v.flavour ? `Flavour: ${v.flavour}` : '',
                      v.variant_type ? `Type: ${v.variant_type}` : '',
                      v.other_attributes || '',
                    ].filter(Boolean);

                    return (
                      <tr
                        key={v.id}
                        className={`hover:bg-slate-50/80 ${v.status === 'Inactive' ? 'opacity-65 bg-slate-50/60' : ''}`}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <ProductThumb
                              src={thumbSrc}
                              fullSrc={fullSrc}
                              alt={`${parentItem.item_name} - ${v.variant_name}`}
                              size="sm"
                              enableZoom
                            />
                            {thumbSrc && (
                              <span
                                className="text-[9px] text-slate-400"
                                title={v.image_inherited ? 'Inherited from Main Product' : 'Custom Variant Picture'}
                              >
                                {v.image_inherited ? 'Main' : 'Own'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                            {v.variant_code}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-900">{v.variant_name}</div>
                          {attrList.length > 0 && (
                            <div className="text-[11px] text-slate-500">{attrList.join(' • ')}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{v.barcode || <span className="text-slate-300">—</span>}</span>
                            {allBarcodes.length > 1 && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 font-sans font-bold">
                                +{allBarcodes.length - 1}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {Number(v.use_parent_pricing) === 1 ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              Inherits Main
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              Custom Price
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                          {formatPKR(Number(v.effective_purchase_price ?? v.purchase_price ?? 0))}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-900 whitespace-nowrap">
                          {formatPKR(Number(v.effective_retail_price ?? v.retail_price ?? 0))}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          <span
                            className={`font-mono font-bold px-2 py-0.5 rounded ${
                              isLow
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'text-slate-900'
                            }`}
                          >
                            {stockPacks}P
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-500 whitespace-nowrap">
                          {minStock}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              v.status === 'Active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setPrintTarget(v)}
                              className="p-1.5 rounded-md text-slate-500 hover:text-sky-700 hover:bg-sky-50 cursor-pointer"
                              title="Print Variant Barcode Label"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditVariantModal(v)}
                              className="p-1.5 rounded-md text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                              title="Edit Variant & Barcodes"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleVariantStatus(v)}
                              className={`p-1.5 rounded-md cursor-pointer ${
                                v.status === 'Active'
                                  ? 'text-slate-400 hover:text-amber-700 hover:bg-amber-50'
                                  : 'text-emerald-600 hover:bg-emerald-50'
                              }`}
                              title={
                                v.status === 'Active'
                                  ? 'Deactivate Variant (preserves historical invoices)'
                                  : 'Reactivate Variant'
                              }
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
          <Layers className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="text-sm font-bold text-slate-800">Select a Main Product above to manage variants</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Enable "Has Variants = Yes" on any product in Item Master (or check "Include items without variants enabled yet" above) to add colour, flavour, or type variants.
          </p>
        </div>
      )}

      {/* Add / Edit Variant Modal */}
      {formOpen && parentItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl overflow-hidden my-6">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>{editingVariant ? 'Edit Product Variant' : 'Add New Variant'}</span>
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Main Product: [{parentItem.item_code}] {parentItem.item_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVariant} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto text-xs">
              {/* Variant Picture (Own or Inherited) */}
              <ProductImageUploader
                label="Variant Picture"
                imageUrl={variantForm.image_url || null}
                thumbnailUrl={variantForm.thumbnail_url || null}
                inheritedUrl={parentItem.image_url || null}
                inheritedThumbnailUrl={parentItem.thumbnail_url || null}
                onImageUploaded={(img) =>
                  setVariantForm((p) => ({
                    ...p,
                    image_id: img.image_id,
                    image_url: img.image_url,
                    thumbnail_url: img.thumbnail_url,
                  }))
                }
                onRemoveImage={() =>
                  setVariantForm((p) => ({
                    ...p,
                    image_id: null,
                    image_url: '',
                    thumbnail_url: '',
                  }))
                }
              />

              {/* Code & Attributes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Variant Code *</label>
                  <input
                    type="text"
                    required
                    value={variantForm.variant_code}
                    onChange={(e) => setVariantForm((p) => ({ ...p, variant_code: e.target.value }))}
                    className="w-full px-3 py-1.5 font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="block font-semibold text-slate-700">
                    Variant Name * <span className="text-[10px] font-normal text-slate-400">(e.g. Black, Mint Flavour, Regular)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={variantForm.variant_name}
                    onChange={(e) => {
                      setNameTouched(true);
                      setVariantForm((p) => ({ ...p, variant_name: e.target.value }));
                    }}
                    placeholder="e.g. Black, Strawberry Flavour, Soft Bristle"
                    className="w-full px-3 py-1.5 font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Colour</label>
                  <input
                    type="text"
                    value={variantForm.colour}
                    onChange={(e) => updateAttributeAndAutoName('colour', e.target.value)}
                    placeholder="e.g. Black, Blue, Green"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Flavour / Scent</label>
                  <input
                    type="text"
                    value={variantForm.flavour}
                    onChange={(e) => updateAttributeAndAutoName('flavour', e.target.value)}
                    placeholder="e.g. Mint, Strawberry, Herbal"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Type / Variant</label>
                  <input
                    type="text"
                    value={variantForm.variant_type}
                    onChange={(e) => updateAttributeAndAutoName('variant_type', e.target.value)}
                    placeholder="e.g. Dry Hair, Anti-Dandruff"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="block font-semibold text-slate-700">Other Attribute Notes</label>
                  <input
                    type="text"
                    value={variantForm.other_attributes}
                    onChange={(e) => updateAttributeAndAutoName('other_attributes', e.target.value)}
                    placeholder="Optional extra attribute detail"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">
                    Packing Override <span className="text-[10px] font-normal text-slate-400">({parentItem.packing})</span>
                  </label>
                  <input
                    type="text"
                    value={variantForm.packing}
                    onChange={(e) => setVariantForm((p) => ({ ...p, packing: e.target.value }))}
                    placeholder={`Inherit (${parentItem.packing})`}
                    className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              {/* Primary & Multi-Barcode Management */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-emerald-600" />
                    <span>Variant Barcodes</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Duplicates across any item or variant are prevented
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={variantForm.barcode}
                    onChange={(e) => setVariantForm((p) => ({ ...p, barcode: e.target.value }))}
                    placeholder="Primary barcode (leave blank to auto-generate or enter manufacturer barcode)"
                    className="flex-1 min-w-[200px] px-3 py-1.5 font-mono rounded-lg border border-slate-300 bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleGeneratePrimaryBarcode}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>Auto-Generate EAN-13</span>
                  </button>
                </div>

                {editingVariant && (
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Attached Barcodes ({editingVariant.barcodes?.length || 0}):
                    </div>
                    {editingVariant.barcodes && editingVariant.barcodes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {editingVariant.barcodes.map((b) => (
                          <div
                            key={b.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-300 font-mono text-[11px]"
                          >
                            <span className="font-bold text-slate-900">{b.barcode}</span>
                            <span className="text-[9px] uppercase font-sans px-1 rounded bg-slate-100 text-slate-600">
                              {b.barcode_type}
                            </span>
                            {Number(b.is_primary) === 1 && (
                              <span className="text-[9px] uppercase font-sans px-1 rounded bg-emerald-100 text-emerald-800 font-bold">
                                Primary
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteExtraBarcode(b.id)}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Remove barcode"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newExtraBarcode}
                        onChange={(e) => setNewExtraBarcode(e.target.value)}
                        placeholder="Scan or enter additional manufacturer barcode..."
                        className="flex-1 px-2.5 py-1.5 font-mono text-[11px] rounded-lg border border-slate-300 bg-white"
                      />
                      <button
                        type="button"
                        disabled={addingBarcode || !newExtraBarcode.trim()}
                        onClick={() => handleAddExtraBarcode(false)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        + Add Barcode
                      </button>
                      <button
                        type="button"
                        disabled={addingBarcode}
                        onClick={() => handleAddExtraBarcode(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                      >
                        + Generate Extra
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pricing Inheritance or Override */}
              <div className="p-3.5 rounded-xl border border-slate-200 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={variantForm.use_parent_pricing}
                      onChange={(e) =>
                        setVariantForm((p) => ({ ...p, use_parent_pricing: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span className="font-bold text-slate-900">
                      Inherit Purchase, Trade, Wholesale & Retail Pricing from Main Product
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    Main Retail: {formatPKR(parentItem.retail_price)}
                  </span>
                </label>

                {!variantForm.use_parent_pricing && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Purchase
                      </label>
                      <NumericInput
                        value={variantForm.purchase_price}
                        onChange={(e) => {
                          const nextPur = Math.max(0, parseFloat(e.target.value) || 0);
                          const calc = calculateItemPricingFromPurchase(
                            nextPur,
                            variantForm.packing || parentItem.packing
                          );
                          setVariantForm((p) => ({
                            ...p,
                            purchase_price: nextPur,
                            trade_price: calc.tradePrice,
                            wholesale_price: calc.wholesalePrice,
                            retail_price: calc.retailPrice,
                            loose_rate: calc.looseRate,
                          }));
                        }}
                        className="w-full px-2 py-1.5 font-mono font-bold rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Trade (TP)
                      </label>
                      <NumericInput
                        value={variantForm.trade_price}
                        onChange={(e) =>
                          setVariantForm((p) => ({
                            ...p,
                            trade_price: Math.max(0, parseFloat(e.target.value) || 0),
                          }))
                        }
                        className="w-full px-2 py-1.5 font-mono rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Wholesale
                      </label>
                      <NumericInput
                        value={variantForm.wholesale_price}
                        onChange={(e) =>
                          setVariantForm((p) => ({
                            ...p,
                            wholesale_price: Math.max(0, parseFloat(e.target.value) || 0),
                          }))
                        }
                        className="w-full px-2 py-1.5 font-mono rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-emerald-800 mb-1">
                        Retail (MRP)
                      </label>
                      <NumericInput
                        value={variantForm.retail_price}
                        onChange={(e) => {
                          const nextRet = Math.max(0, parseFloat(e.target.value) || 0);
                          setVariantForm((p) => ({
                            ...p,
                            retail_price: nextRet,
                            loose_rate: calculateLooseRateFromRetail(
                              nextRet,
                              p.packing || parentItem.packing
                            ),
                          }));
                        }}
                        className="w-full px-2 py-1.5 font-mono font-bold rounded-lg border border-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-blue-800 mb-1">
                        Loose Rate
                      </label>
                      <NumericInput
                        value={variantForm.loose_rate}
                        onChange={(e) =>
                          setVariantForm((p) => ({
                            ...p,
                            loose_rate: Math.max(0, parseFloat(e.target.value) || 0),
                          }))
                        }
                        className="w-full px-2 py-1.5 font-mono rounded-lg border border-blue-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Disc %
                      </label>
                      <NumericInput
                        value={variantForm.discount_percent}
                        onChange={(e) =>
                          setVariantForm((p) => ({
                            ...p,
                            discount_percent: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2 py-1.5 font-mono rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Tax %
                      </label>
                      <NumericInput
                        value={variantForm.tax_percent}
                        onChange={(e) =>
                          setVariantForm((p) => ({
                            ...p,
                            tax_percent: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2 py-1.5 font-mono rounded-lg border border-slate-300"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Stock & Location */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                {!editingVariant && (
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700">Opening Stock (Packs)</label>
                    <NumericInput
                      value={variantForm.opening_stock}
                      onChange={(e) =>
                        setVariantForm((p) => ({
                          ...p,
                          opening_stock: Math.max(0, parseFloat(e.target.value) || 0),
                        }))
                      }
                      className="w-full px-3 py-1.5 font-mono font-bold rounded-lg border border-slate-300"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Min Stock / Reorder</label>
                  <NumericInput
                    value={variantForm.minimum_stock}
                    onChange={(e) =>
                      setVariantForm((p) => ({
                        ...p,
                        minimum_stock: Math.max(0, parseFloat(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-1.5 font-mono rounded-lg border border-slate-300"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Rack / Shelf</label>
                  <input
                    type="text"
                    value={variantForm.rack_number}
                    onChange={(e) => setVariantForm((p) => ({ ...p, rack_number: e.target.value }))}
                    placeholder={parentItem.rack_number || 'Shelf location'}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Status</label>
                  <select
                    value={variantForm.status}
                    onChange={(e) =>
                      setVariantForm((p) => ({
                        ...p,
                        status: e.target.value as 'Active' | 'Inactive',
                      }))
                    }
                    className="w-full px-3 py-1.5 font-semibold rounded-lg border border-slate-300"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingVariant}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingVariant ? 'Saving...' : editingVariant ? 'Update Variant' : 'Save Variant'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barcode Label Print Modal */}
      {printTarget && parentItem && (
        <BarcodeLabelPrintModal
          isOpen={Boolean(printTarget)}
          onClose={() => setPrintTarget(null)}
          title={parentItem.item_name}
          subtitle={printTarget.variant_name}
          itemCode={printTarget.variant_code}
          barcode={printTarget.barcode || printTarget.variant_code}
          price={Number(printTarget.effective_retail_price ?? printTarget.retail_price ?? 0)}
          packing={printTarget.effective_packing || parentItem.packing}
          availableBarcodes={
            Array.isArray(printTarget.barcodes)
              ? printTarget.barcodes.map((b) => b.barcode)
              : []
          }
        />
      )}
    </div>
  );
};
