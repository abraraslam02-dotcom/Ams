import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, AlertCircle, CheckCircle2, Calculator, Info, Layers, RotateCcw } from 'lucide-react';
import { Item, ItemFormData, ItemTaxType } from '../../types/item';
import { api } from '../../services/api';
import { NumericInput } from '../common/NumericInput';
import { ItemCompanySelect } from './ItemCompanySelect';
import { ItemNameSelect } from './ItemNameSelect';
import { ProductImageUploader } from '../common/ProductImageUploader';
import {
  calculateItemPricingFromPurchase,
  calculateLooseRateFromRetail,
  calculatePricesFromTradePrice,
  parsePackingUnits,
} from '../../utils/itemPricing';
import { resolveItemTaxConfig } from '../../utils/taxCalculation';
import { ITEM_CATEGORIES, classifyItemCategory } from '../../utils/itemCategory';

interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
  onManageVariants?: (item: Item) => void;
  onCompanyCreated?: (companies: string[]) => void;
  editingItem?: Item | null;
}

const DEFAULT_CATEGORIES = [...ITEM_CATEGORIES];

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  onManageVariants,
  onCompanyCreated,
  editingItem,
}) => {
  const [activeEditingItem, setActiveEditingItem] = useState<Item | null>(editingItem || null);
  const isEditing = Boolean(activeEditingItem);

  const initialForm: ItemFormData = {
    item_code: '',
    company_name: '',
    item_name: '',
    generic_name: '',
    category: 'Other',
    packing: '10x10',
    carton: null,
    boxes_per_carton: null,
    strips_per_box: 10,
    tablets_per_strip: 10,
    units_per_strip: 10,
    units_per_pack: 100,
    purchase_unit: 'Box',
    barcode: '',
    purchase_price: 0,
    trade_price: 0,
    wholesale_price: 0,
    retail_price: 0,
    loose_rate: 0,
    discount_percent: 0,
    tax_type: 'percentage',
    tax_value: 0,
    tax_percent: 0,
    opening_stock: 0,
    minimum_stock: 0,
    rack_number: '',
    has_variants: 0,
    image_id: null,
    image_url: '',
    thumbnail_url: '',
    status: 'Active',
  };

  const [formData, setFormData] = useState<ItemFormData>(initialForm);
  const [tradeTouched, setTradeTouched] = useState<boolean>(false);
  const [wholesaleTouched, setWholesaleTouched] = useState<boolean>(false);
  const [retailTouched, setRetailTouched] = useState<boolean>(false);
  const [looseRateTouched, setLooseRateTouched] = useState<boolean>(false);
  const [codeChecking, setCodeChecking] = useState<boolean>(false);
  const [loadingAutoCode, setLoadingAutoCode] = useState<boolean>(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadedNotice, setLoadedNotice] = useState<string | null>(null);

  const hydrateFormFromItem = useCallback((source: Item) => {
    const savedLoose =
      source.loose_rate !== undefined && Number(source.loose_rate) > 0
        ? Number(source.loose_rate)
        : calculateLooseRateFromRetail(source.retail_price || 0, source.packing);
    const matrixMatch = String(source.packing || '').match(/(\d+)\s*[xX*×]\s*(\d+)/);
    const resolvedStripsPerBox =
      source.strips_per_box && Number(source.strips_per_box) > 0
        ? Number(source.strips_per_box)
        : matrixMatch
        ? parseInt(matrixMatch[1], 10)
        : null;
    const resolvedTabletsPerStrip =
      source.tablets_per_strip && Number(source.tablets_per_strip) > 0
        ? Number(source.tablets_per_strip)
        : source.units_per_strip && Number(source.units_per_strip) > 0
        ? Number(source.units_per_strip)
        : matrixMatch
        ? parseInt(matrixMatch[2], 10)
        : null;
    const taxCfg = resolveItemTaxConfig({
      tax_type: source.tax_type,
      tax_value: source.tax_value,
      tax_percent: source.tax_percent,
    });
    setFormData({
      item_code: source.item_code,
      company_name: source.company_name,
      item_name: source.item_name,
      generic_name: source.generic_name || '',
      category: classifyItemCategory(source.item_name),
      packing: source.packing,
      carton:
        source.carton !== undefined && source.carton !== null && Number(source.carton) > 0
          ? Number(source.carton)
          : null,
      boxes_per_carton:
        source.boxes_per_carton !== undefined &&
        source.boxes_per_carton !== null &&
        Number(source.boxes_per_carton) > 0
          ? Number(source.boxes_per_carton)
          : null,
      strips_per_box: resolvedStripsPerBox,
      tablets_per_strip: resolvedTabletsPerStrip,
      units_per_strip: resolvedTabletsPerStrip || 1,
      units_per_pack:
        source.units_per_pack && Number(source.units_per_pack) > 0
          ? Number(source.units_per_pack)
          : parsePackingUnits(source.packing),
      purchase_unit: source.purchase_unit || 'Box',
      barcode: source.barcode || '',
      purchase_price: source.purchase_price,
      trade_price: source.trade_price,
      wholesale_price: source.wholesale_price,
      retail_price: source.retail_price,
      loose_rate: savedLoose,
      discount_percent: source.discount_percent,
      tax_type: taxCfg.tax_type,
      tax_value: taxCfg.tax_value,
      tax_percent: taxCfg.tax_percent,
      opening_stock: source.opening_stock,
      minimum_stock: source.minimum_stock,
      rack_number: source.rack_number || '',
      has_variants: Number(source.has_variants) === 1 ? 1 : 0,
      image_id: source.image_id ?? null,
      image_url: source.image_url || '',
      thumbnail_url: source.thumbnail_url || '',
      status: source.status,
    });
    setTradeTouched(true);
    setWholesaleTouched(true);
    setRetailTouched(true);
    setLooseRateTouched(true);
    setCodeError(null);
    setLoadingAutoCode(false);
    setFormError(null);
  }, []);

  const resetToNewItemMode = useCallback(() => {
    setActiveEditingItem(null);
    setLoadedNotice(null);
    setFormData(initialForm);
    setTradeTouched(false);
    setWholesaleTouched(false);
    setRetailTouched(false);
    setLooseRateTouched(false);
    setCodeError(null);
    setFormError(null);
    setLoadingAutoCode(true);
    api
      .getNextItemCode()
      .then((res) => {
        if (res?.next_code) {
          setFormData((prev) => ({
            ...prev,
            item_code: prev.item_code.trim() ? prev.item_code : res.next_code,
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoadingAutoCode(false);
      });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setActiveEditingItem(editingItem || null);
    setLoadedNotice(null);
    if (editingItem) {
      hydrateFormFromItem(editingItem);
    } else {
      setFormData(initialForm);
      setTradeTouched(false);
      setWholesaleTouched(false);
      setRetailTouched(false);
      setLooseRateTouched(false);
      setCodeError(null);
      setLoadingAutoCode(true);
      api
        .getNextItemCode()
        .then((res) => {
          if (!cancelled && res?.next_code) {
            setFormData((prev) => ({
              ...prev,
              item_code: prev.item_code.trim() ? prev.item_code : res.next_code,
            }));
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoadingAutoCode(false);
        });
    }
    setFormError(null);
    return () => {
      cancelled = true;
    };
  }, [editingItem, isOpen, hydrateFormFromItem]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectExistingItemFromDropdown = (item: Item) => {
    setActiveEditingItem(item);
    hydrateFormFromItem(item);
    setLoadedNotice(
      `Loaded existing item "${item.item_name}" (${item.item_code}) for viewing/editing. Saving will update this item instead of creating a duplicate.`
    );
  };

  // Real-time check for duplicate Item Code on blur or change
  const handleCheckCode = async (codeToTest: string) => {
    const clean = codeToTest.trim();
    if (!clean) {
      setCodeError('Item Code is required');
      return;
    }

    try {
      setCodeChecking(true);
      const res = await api.checkItemCode(clean, activeEditingItem?.id);
      if (res.exists) {
        setCodeError(`Item Code "${clean}" already exists. Duplicate Item Codes are strictly prevented.`);
      } else {
        setCodeError(null);
      }
    } catch {
      // ignore
    } finally {
      setCodeChecking(false);
    }
  };

  const configuredStrips =
    formData.strips_per_box && Number(formData.strips_per_box) > 0
      ? Math.round(Number(formData.strips_per_box))
      : null;
  const configuredTablets =
    formData.tablets_per_strip && Number(formData.tablets_per_strip) > 0
      ? Math.round(Number(formData.tablets_per_strip))
      : null;
  const packingUnits =
    configuredStrips && configuredTablets
      ? configuredStrips * configuredTablets
      : configuredTablets
      ? configuredTablets
      : parsePackingUnits(formData.packing);
  const calculatedLooseRetailPrice =
    packingUnits > 0 && formData.retail_price > 0
      ? Math.round(((formData.retail_price / packingUnits) + Number.EPSILON) * 100) / 100
      : formData.retail_price;
  const looseRetailPrice = looseRateTouched
    ? Number(formData.loose_rate || 0)
    : formData.loose_rate !== undefined && Number(formData.loose_rate) > 0
    ? Number(formData.loose_rate)
    : calculatedLooseRetailPrice;

  const updateMultiLevelPacking = (
    changes: Partial<
      Pick<
        ItemFormData,
        'carton' | 'boxes_per_carton' | 'strips_per_box' | 'tablets_per_strip' | 'purchase_unit'
      >
    >
  ) => {
    setFormData((prev) => {
      const next = { ...prev, ...changes };
      const nextStrips =
        next.strips_per_box !== undefined && next.strips_per_box !== null && Number(next.strips_per_box) > 0
          ? Math.round(Number(next.strips_per_box))
          : null;
      const nextTablets =
        next.tablets_per_strip !== undefined && next.tablets_per_strip !== null && Number(next.tablets_per_strip) > 0
          ? Math.round(Number(next.tablets_per_strip))
          : null;

      let nextPacking = prev.packing;
      const isMatrixOrDefault =
        !nextPacking.trim() ||
        nextPacking.trim() === '1x1' ||
        /^\d+\s*[xX*×]\s*\d+$/.test(nextPacking.trim());

      if (nextStrips && nextTablets && isMatrixOrDefault) {
        nextPacking = `${nextStrips}x${nextTablets}`;
      } else if (nextTablets && !nextStrips && isMatrixOrDefault) {
        nextPacking = `1x${nextTablets}`;
      } else if (nextStrips && !nextTablets && isMatrixOrDefault) {
        nextPacking = `${nextStrips}x1`;
      }

      const nextUnitsPerStrip = nextTablets || 1;
      const nextUnitsPerPack =
        nextStrips && nextTablets
          ? nextStrips * nextTablets
          : nextTablets
          ? nextTablets
          : parsePackingUnits(nextPacking);

      const nextLooseRate = !looseRateTouched
        ? prev.retail_price > 0
          ? Math.round(((prev.retail_price / Math.max(1, nextUnitsPerPack)) + Number.EPSILON) * 100) / 100
          : 0
        : prev.loose_rate;

      return {
        ...next,
        packing: nextPacking,
        units_per_strip: nextUnitsPerStrip,
        units_per_pack: nextUnitsPerPack,
        loose_rate: nextLooseRate,
      };
    });
  };

  const submitItem = async (openVariantsAfterSave = false) => {
    setFormError(null);

    if (!formData.item_code.trim()) {
      setFormError('Item Code is required.');
      return;
    }
    if (!formData.company_name.trim()) {
      setFormError('Company Name is required.');
      return;
    }
    if (!formData.item_name.trim()) {
      setFormError('Item Name is required.');
      return;
    }
    if (!formData.packing.trim()) {
      setFormError('Packing specification is required.');
      return;
    }

    if (codeError) {
      setFormError('Please resolve the Item Code error before saving.');
      return;
    }

    try {
      setSaving(true);
      const resolvedTax = resolveItemTaxConfig({
        tax_type: formData.tax_type,
        tax_value: formData.tax_value,
        tax_percent: formData.tax_percent,
      });
      const payload = {
        ...formData,
        category: classifyItemCategory(formData.item_name),
        tax_type: resolvedTax.tax_type,
        tax_value: resolvedTax.tax_value,
        tax_percent: resolvedTax.tax_percent,
        carton:
          formData.carton !== undefined && formData.carton !== null && Number(formData.carton) > 0
            ? Number(formData.carton)
            : null,
        boxes_per_carton:
          formData.boxes_per_carton !== undefined &&
          formData.boxes_per_carton !== null &&
          Number(formData.boxes_per_carton) > 0
            ? Math.round(Number(formData.boxes_per_carton))
            : null,
        strips_per_box: configuredStrips,
        tablets_per_strip: configuredTablets,
        units_per_strip: configuredTablets || 1,
        units_per_pack: packingUnits,
        purchase_unit: formData.purchase_unit || 'Box',
        has_variants: Number(formData.has_variants) === 1 ? 1 : 0,
      };
      const res =
        isEditing && activeEditingItem
          ? await api.updateItem(activeEditingItem.id, payload)
          : await api.createItem(payload);
      onSaved(res.item);
      onClose();
      if (openVariantsAfterSave && onManageVariants && res.item) {
        onManageVariants(res.item);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setFormError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitItem(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-6">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 to-emerald-950 text-white px-6 py-4 flex items-center justify-between border-b border-emerald-800/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>
                {isEditing
                  ? 'Item Registration — Edit Item in Items Master'
                  : 'Item Registration — Add New Item to Items Master'}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Multi-Level Packing Enabled
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Includes Multi-Level Packing Configuration (Carton, Boxes/Carton, Strips/Box, Tablets/Strip &amp; Purchase Unit)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[84vh] overflow-y-auto">
          {formError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium">{formError}</span>
            </div>
          )}

          {loadedNotice && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-medium">{loadedNotice}</span>
              </div>
              <button
                type="button"
                onClick={resetToNewItemMode}
                className="px-2.5 py-1 rounded-lg bg-white border border-blue-300 text-blue-800 text-[11px] font-bold hover:bg-blue-100 flex items-center gap-1 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Add New Item Instead</span>
              </button>
            </div>
          )}

          {/* Section 1: Basic Identifiers */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
              <span>1. Item Identification</span>
              <span className="text-[10px] text-slate-400 font-normal">(Required)</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Item Code */}
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>
                    Item Code <span className="text-rose-500">*</span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {isEditing ? 'Saved Code' : loadingAutoCode ? 'Generating...' : 'Auto Code'}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    readOnly
                    value={formData.item_code}
                    placeholder={loadingAutoCode ? 'Generating next code...' : 'Auto-generated'}
                    title={
                      isEditing
                        ? 'Existing item code is preserved and cannot be auto-replaced'
                        : 'Item code is automatically generated sequentially from the database'
                    }
                    className={`w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border bg-slate-100 text-slate-900 cursor-not-allowed focus:outline-none ${
                      codeError
                        ? 'border-rose-400 text-rose-800'
                        : 'border-slate-300 text-emerald-900'
                    }`}
                  />
                  {codeChecking && (
                    <span className="absolute right-2 top-2 text-[10px] text-slate-400">checking...</span>
                  )}
                </div>
                {codeError && (
                  <p className="text-[10px] text-rose-600 font-medium leading-tight">{codeError}</p>
                )}
              </div>

              {/* Company Name (Searchable Dropdown with Add New Company Popup) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <ItemCompanySelect
                  value={formData.company_name}
                  required
                  onChange={(company) => setFormData((prev) => ({ ...prev, company_name: company }))}
                  onCompanyCreated={onCompanyCreated}
                  placeholder="Search or select company..."
                />
              </div>

              {/* Item Name (Searchable Dropdown — loads existing item to edit/update and prevents duplicates) */}
              <div className="space-y-1 sm:col-span-2">
                <label className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>
                    Item Name (Brand) <span className="text-rose-500">*</span>
                  </span>
                  {isEditing && (
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                      Editing Existing Record
                    </span>
                  )}
                </label>
                <ItemNameSelect
                  value={formData.item_name}
                  required
                  selectedExistingItemId={activeEditingItem?.id ?? null}
                  onChange={(name) =>
                    setFormData((prev) => ({
                      ...prev,
                      item_name: name,
                      category: classifyItemCategory(name),
                    }))
                  }
                  onSelectExistingItem={handleSelectExistingItemFromDropdown}
                  placeholder="Click to search existing items or type new item name..."
                />
              </div>

              {/* Generic Name */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Generic Name (Formula)
                </label>
                <input
                  type="text"
                  value={formData.generic_name || ''}
                  onChange={(e) => setFormData({ ...formData, generic_name: e.target.value })}
                  placeholder="e.g. Paracetamol, Amoxicillin + Clavulanic Acid"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {DEFAULT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Barcode */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Barcode
                </label>
                <input
                  type="text"
                  value={formData.barcode || ''}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="Scan or enter barcode"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Multi-Level Packing Configuration & Purchase Units */}
          <div className="p-3.5 rounded-xl bg-emerald-50/70 border-2 border-emerald-300/90 space-y-3 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
                <Calculator className="w-4 h-4 text-emerald-700" />
                <span>2. Multi-Level Packing Configuration &amp; Purchase Units</span>
              </h4>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {formData.boxes_per_carton && Number(formData.boxes_per_carton) > 0 && (
                  <span className="font-semibold text-teal-800 bg-teal-100/80 border border-teal-200 px-2 py-0.5 rounded">
                    {Number(formData.carton || 1)} Carton = {Number(formData.boxes_per_carton)} Boxes
                  </span>
                )}
                {configuredStrips && (
                  <span className="font-semibold text-emerald-800 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 rounded">
                    1 Box = {configuredStrips} Strips
                  </span>
                )}
                {configuredTablets && (
                  <span className="font-semibold text-sky-800 bg-sky-100/80 border border-sky-200 px-2 py-0.5 rounded">
                    1 Strip = {configuredTablets} Tablets
                  </span>
                )}
                <span className="font-bold text-emerald-900 bg-emerald-200/70 px-2 py-0.5 rounded">
                  Units/Pack: {packingUnits}
                </span>
              </div>
            </div>

            {/* Row 1: Optional Multi-Level Packing Hierarchy + Purchase Unit */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Carton <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={formData.carton ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateMultiLevelPacking({
                      carton: raw === '' ? null : Math.max(0, Number(raw)),
                    });
                  }}
                  placeholder="e.g. 1"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Boxes per Carton <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={formData.boxes_per_carton ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateMultiLevelPacking({
                      boxes_per_carton: raw === '' ? null : Math.max(0, Math.round(Number(raw))),
                    });
                  }}
                  placeholder="e.g. 100"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Strips per Box <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={formData.strips_per_box ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateMultiLevelPacking({
                      strips_per_box: raw === '' ? null : Math.max(0, Math.round(Number(raw))),
                    });
                  }}
                  placeholder="e.g. 10"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Tablets per Strip <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={formData.tablets_per_strip ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateMultiLevelPacking({
                      tablets_per_strip: raw === '' ? null : Math.max(0, Math.round(Number(raw))),
                    });
                  }}
                  placeholder="e.g. 10"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-800">
                  Purchase Unit
                </label>
                <select
                  value={formData.purchase_unit || 'Box'}
                  onChange={(e) =>
                    updateMultiLevelPacking({
                      purchase_unit: e.target.value as 'Carton' | 'Box' | 'Strip' | 'Tablet',
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="Box">Box</option>
                  <option value="Carton">Carton</option>
                  <option value="Strip">Strip</option>
                  <option value="Tablet">Tablet</option>
                </select>
              </div>
            </div>

            {/* Row 2: Packing Specification & Live Price Preview */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Packing Specification <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.packing}
                  onChange={(e) => {
                    const nextPacking = e.target.value;
                    const matrix = nextPacking.trim().match(/^(\d+)\s*[xX*×]\s*(\d+)$/);
                    const parsedStrips = matrix ? Math.max(1, parseInt(matrix[1], 10)) : formData.strips_per_box;
                    const parsedTablets = matrix ? Math.max(1, parseInt(matrix[2], 10)) : formData.tablets_per_strip;
                    setFormData((prev) => ({
                      ...prev,
                      packing: nextPacking,
                      strips_per_box: parsedStrips,
                      tablets_per_strip: parsedTablets,
                      units_per_strip: parsedTablets && Number(parsedTablets) > 0 ? Number(parsedTablets) : 1,
                      units_per_pack: parsePackingUnits(nextPacking),
                      loose_rate: !looseRateTouched
                        ? calculateLooseRateFromRetail(prev.retail_price, nextPacking)
                        : prev.loose_rate,
                    }));
                  }}
                  placeholder="e.g. 10x10, 20x10, 1x1, 100"
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <p className="text-[10px] text-slate-500">
                  Synced with Strips/Box &times; Tablets/Strip (e.g. 10x10 = 100 tablets)
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex flex-col justify-center">
                <span className="text-[10px] text-slate-500 font-medium">Full Pack Retail Price</span>
                <span className="text-sm font-bold text-slate-900 font-mono">
                  Rs. {formData.retail_price.toFixed(2)}
                </span>
                <span className="text-[10px] text-emerald-700">
                  Per {formData.purchase_unit || 'Box'} / Pack
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex flex-col justify-center">
                <span className="text-[10px] text-slate-500 font-medium">Loose Single Unit Retail</span>
                <span className="text-sm font-bold text-emerald-700 font-mono">
                  Rs. {looseRetailPrice.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">
                  Per Tablet / Unit {configuredTablets ? `(1 Strip = ${configuredTablets})` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Product Picture & Optional Variant Mode */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            <div className="lg:col-span-7">
              <ProductImageUploader
                label="Main Product Picture"
                imageUrl={formData.image_url || null}
                thumbnailUrl={formData.thumbnail_url || null}
                onImageUploaded={(img) =>
                  setFormData((prev) => ({
                    ...prev,
                    image_id: img.image_id,
                    image_url: img.image_url,
                    thumbnail_url: img.thumbnail_url,
                  }))
                }
                onRemoveImage={() =>
                  setFormData((prev) => ({
                    ...prev,
                    image_id: null,
                    image_url: '',
                    thumbnail_url: '',
                  }))
                }
              />
            </div>

            <div className="lg:col-span-5 p-3 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-sky-600" />
                    <span>Has Variants?</span>
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, has_variants: 0 }))}
                      className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                        Number(formData.has_variants) !== 1
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      No (Standard)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, has_variants: 1 }))}
                      className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                        Number(formData.has_variants) === 1
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Yes (Variants)
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  {Number(formData.has_variants) === 1
                    ? 'Enabled: Add colours, flavours, or types (e.g. Black, Blue, Green) in Variant Management while keeping each size as a separate Main Product.'
                    : 'Standard mode: Item works directly in Purchases & Sales without extra variant selection.'}
                </p>
              </div>
              {Number(formData.has_variants) === 1 && isEditing && editingItem && onManageVariants && (
                <button
                  type="button"
                  onClick={() => submitItem(true)}
                  disabled={saving || Boolean(codeError)}
                  className="w-full py-1.5 px-3 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Save & Open Variant Management</span>
                </button>
              )}
            </div>
          </div>

          {/* Section 3: Decimal Pricing & Rates */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <span>3. Decimal Pricing (PKR / Rs.)</span>
              <span className="text-[10px] text-slate-400 font-normal">(2 Decimal Precision)</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {/* Purchase Price */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Purchase Price
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400 font-mono">Rs.</span>
                  <NumericInput
                    value={formData.purchase_price}
                    onChange={(e) => {
                      const nextPurchase = Math.max(0, parseFloat(e.target.value) || 0);
                      const calculated = calculateItemPricingFromPurchase(nextPurchase, formData.packing);
                      setTradeTouched(false);
                      setWholesaleTouched(false);
                      setRetailTouched(false);
                      setLooseRateTouched(false);
                      setFormData((prev) => ({
                        ...prev,
                        purchase_price: nextPurchase,
                        trade_price: calculated.tradePrice,
                        wholesale_price: calculated.wholesalePrice,
                        retail_price: calculated.retailPrice,
                        loose_rate: calculated.looseRate,
                      }));
                    }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Trade Price (TP) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Trade Price (TP)
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400 font-mono">Rs.</span>
                  <NumericInput
                    value={formData.trade_price}
                    onChange={(e) => {
                      const nextTrade = Math.max(0, parseFloat(e.target.value) || 0);
                      const fromTrade = calculatePricesFromTradePrice(nextTrade, formData.packing);
                      setTradeTouched(true);
                      setFormData((prev) => {
                        const nextRetail = !retailTouched ? fromTrade.retailPrice : prev.retail_price;
                        return {
                          ...prev,
                          trade_price: nextTrade,
                          wholesale_price: !wholesaleTouched ? fromTrade.wholesalePrice : prev.wholesale_price,
                          retail_price: nextRetail,
                          loose_rate: !looseRateTouched
                            ? calculateLooseRateFromRetail(nextRetail, prev.packing)
                            : prev.loose_rate,
                        };
                      });
                    }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    title="Auto-calculated as Purchase Price / 0.85 (editable)"
                  />
                </div>
              </div>

              {/* Wholesale Price */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Wholesale Price
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400 font-mono">Rs.</span>
                  <NumericInput
                    value={formData.wholesale_price}
                    onChange={(e) => {
                      setWholesaleTouched(true);
                      setFormData((prev) => ({
                        ...prev,
                        wholesale_price: Math.max(0, parseFloat(e.target.value) || 0),
                      }));
                    }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Retail Price (MRP) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-emerald-800">
                  Retail Box (MRP) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-[11px] text-emerald-600 font-mono">Rs.</span>
                  <NumericInput
                    value={formData.retail_price}
                    onChange={(e) => {
                      const nextRetail = Math.max(0, parseFloat(e.target.value) || 0);
                      setRetailTouched(true);
                      setFormData((prev) => ({
                        ...prev,
                        retail_price: nextRetail,
                        loose_rate: !looseRateTouched
                          ? calculateLooseRateFromRetail(nextRetail, prev.packing)
                          : prev.loose_rate,
                      }));
                    }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-black rounded-lg border border-emerald-400 bg-emerald-50/30 focus:bg-white text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Loose Rate (Per Unit / Tablet) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-blue-800">
                  Loose Rate (Unit)
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-[11px] text-blue-600 font-mono">Rs.</span>
                  <NumericInput
                    value={looseRateTouched ? formData.loose_rate : (formData.loose_rate ?? looseRetailPrice)}
                    onChange={(e) => {
                      setLooseRateTouched(true);
                      setFormData((prev) => ({
                        ...prev,
                        loose_rate: Math.max(0, parseFloat(e.target.value) || 0),
                      }));
                    }}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-black rounded-lg border border-blue-400 bg-blue-50/40 focus:bg-white text-blue-950 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    title="Loose Rate per single unit/tablet (independent of Box MRP)"
                  />
                </div>
              </div>

              {/* Discount % */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Discount %
                </label>
                <div className="relative">
                  <NumericInput
                    value={formData.discount_percent}
                    onChange={(e) => setFormData({ ...formData, discount_percent: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400">%</span>
                </div>
              </div>

              {/* Tax Configuration (Percentage % or Fixed Amount) */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Tax Configuration (Applied on Gross Before Discount)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={formData.tax_type || 'percentage'}
                    onChange={(e) => {
                      const nextType = e.target.value as ItemTaxType;
                      setFormData((prev) => {
                        const val = Math.max(0, Number(prev.tax_value ?? prev.tax_percent ?? 0));
                        return {
                          ...prev,
                          tax_type: nextType,
                          tax_value: val,
                          tax_percent: nextType === 'percentage' ? val : 0,
                        };
                      });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="amount">Amount (Fixed Tax)</option>
                  </select>
                  <div className="relative">
                    {formData.tax_type === 'amount' && (
                      <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400 font-mono">Rs.</span>
                    )}
                    <NumericInput
                      value={formData.tax_value ?? formData.tax_percent ?? 0}
                      onChange={(e) => {
                        const nextVal = Math.max(0, parseFloat(e.target.value) || 0);
                        setFormData((prev) => ({
                          ...prev,
                          tax_value: nextVal,
                          tax_percent: (prev.tax_type || 'percentage') === 'percentage' ? nextVal : 0,
                        }));
                      }}
                      className={`w-full py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                        formData.tax_type === 'amount' ? 'pl-8 pr-2.5' : 'px-2.5 pr-7'
                      }`}
                      title={
                        formData.tax_type === 'amount'
                          ? 'Fixed tax amount per pack/base unit (prorated for loose units)'
                          : 'Tax percentage calculated on original gross amount before discounts'
                      }
                    />
                    {formData.tax_type !== 'amount' && (
                      <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400">%</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Stock Levels, Rack & Status */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <span>4. Stock & Store Location</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              {/* Opening Stock */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Opening Stock (Packs)
                </label>
                <NumericInput
                  value={formData.opening_stock}
                  onChange={(e) => setFormData({ ...formData, opening_stock: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Minimum Stock Alert */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Minimum Stock Alert
                </label>
                <NumericInput
                  value={formData.minimum_stock}
                  onChange={(e) => setFormData({ ...formData, minimum_stock: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Rack Number */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Rack Number / Shelf
                </label>
                <input
                  type="text"
                  value={formData.rack_number || ''}
                  onChange={(e) => setFormData({ ...formData, rack_number: e.target.value })}
                  placeholder="e.g. Shelf A-03, Box 12"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })}
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="Active">Active (Available)</option>
                  <option value="Inactive">Inactive (Suspended)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[11px] text-slate-500 italic">
              Note: Batch numbers and expiry dates will be managed in Purchase bills as requested.
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {Number(formData.has_variants) === 1 && !isEditing && onManageVariants && (
                <button
                  type="button"
                  disabled={saving || Boolean(codeError)}
                  onClick={() => submitItem(true)}
                  className="px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save & Add Variants'}</span>
                </button>
              )}
              <button
                type="submit"
                disabled={saving || Boolean(codeError)}
                className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : isEditing ? 'Update Item' : 'Save Item to Database'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
