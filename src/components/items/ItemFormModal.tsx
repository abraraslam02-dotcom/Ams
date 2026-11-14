import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, CheckCircle2, Calculator, Info } from 'lucide-react';
import { Item, ItemFormData } from '../../types/item';
import { api } from '../../services/api';
import { NumericInput } from '../common/NumericInput';
import { ItemCompanySelect } from './ItemCompanySelect';

interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
  onCompanyCreated?: (companies: string[]) => void;
  editingItem?: Item | null;
}

const DEFAULT_CATEGORIES = [
  'Tablet',
  'Syrup / Suspension',
  'Capsule',
  'Injection',
  'Ointment / Cream',
  'Eye / Ear Drops',
  'Inhaler / Resp',
  'Surgical / Disposable',
  'Infusion / Drip',
  'Powder / Sachet',
  'Other',
];

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  onCompanyCreated,
  editingItem,
}) => {
  const isEditing = Boolean(editingItem);

  const initialForm: ItemFormData = {
    item_code: '',
    company_name: '',
    item_name: '',
    generic_name: '',
    category: 'Tablet',
    packing: '10x10',
    barcode: '',
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
    status: 'Active',
  };

  const [formData, setFormData] = useState<ItemFormData>(initialForm);
  const [looseRateTouched, setLooseRateTouched] = useState<boolean>(false);
  const [codeChecking, setCodeChecking] = useState<boolean>(false);
  const [loadingAutoCode, setLoadingAutoCode] = useState<boolean>(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Helper to parse units from packing string (e.g. "10x10" -> 100, "20x5" -> 100, "1x1" -> 1, "30" -> 30)
  const parsePackingUnits = (packStr: string): number => {
    if (!packStr) return 1;
    const parts = packStr
      .toLowerCase()
      .split('x')
      .map((p) => parseFloat(p.trim()))
      .filter((n) => !isNaN(n) && n > 0);
    if (parts.length === 2) {
      return parts[0] * parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return 1;
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    if (editingItem) {
      const units = parsePackingUnits(editingItem.packing);
      const savedLoose =
        editingItem.loose_rate !== undefined && Number(editingItem.loose_rate) > 0
          ? Number(editingItem.loose_rate)
          : Math.round(((editingItem.retail_price || 0) / Math.max(1, units) + Number.EPSILON) * 100) / 100;
      setFormData({
        item_code: editingItem.item_code,
        company_name: editingItem.company_name,
        item_name: editingItem.item_name,
        generic_name: editingItem.generic_name || '',
        category: editingItem.category,
        packing: editingItem.packing,
        barcode: editingItem.barcode || '',
        purchase_price: editingItem.purchase_price,
        trade_price: editingItem.trade_price,
        wholesale_price: editingItem.wholesale_price,
        retail_price: editingItem.retail_price,
        loose_rate: savedLoose,
        discount_percent: editingItem.discount_percent,
        tax_percent: editingItem.tax_percent,
        opening_stock: editingItem.opening_stock,
        minimum_stock: editingItem.minimum_stock,
        rack_number: editingItem.rack_number || '',
        status: editingItem.status,
      });
      setLooseRateTouched(true);
      setCodeError(null);
      setLoadingAutoCode(false);
    } else {
      setFormData(initialForm);
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
  }, [editingItem, isOpen]);

  if (!isOpen) return null;

  // Real-time check for duplicate Item Code on blur or change
  const handleCheckCode = async (codeToTest: string) => {
    const clean = codeToTest.trim();
    if (!clean) {
      setCodeError('Item Code is required');
      return;
    }

    try {
      setCodeChecking(true);
      const res = await api.checkItemCode(clean, editingItem?.id);
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

  const packingUnits = parsePackingUnits(formData.packing);
  const calculatedLooseRetailPrice =
    packingUnits > 0 && formData.retail_price > 0
      ? Math.round((formData.retail_price / packingUnits + Number.EPSILON) * 100) / 100
      : formData.retail_price;
  const looseRetailPrice = looseRateTouched
    ? Number(formData.loose_rate || 0)
    : formData.loose_rate !== undefined && Number(formData.loose_rate) > 0
    ? Number(formData.loose_rate)
    : calculatedLooseRetailPrice;
  const looseTradePrice = packingUnits > 0 && formData.trade_price > 0 ? formData.trade_price / packingUnits : formData.trade_price;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      if (isEditing && editingItem) {
        const res = await api.updateItem(editingItem.id, formData);
        onSaved(res.item);
      } else {
        const res = await api.createItem(formData);
        onSaved(res.item);
      }
      onClose();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setFormError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-6">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 to-emerald-950 text-white px-6 py-4 flex items-center justify-between border-b border-emerald-800/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>{isEditing ? 'Edit Item in Items Master' : 'Add New Item to Items Master'}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Abrar Medical Store
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              All 17 standard fields saved permanently in SQLite database.
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
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {formError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium">{formError}</span>
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

              {/* Item Name */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Item Name (Brand) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.item_name}
                  onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                  placeholder="e.g. Panadol 500mg, Augmentin 625mg, Brufen 400mg"
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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

          {/* Section 2: Packing (Loose & Full Pack Support) */}
          <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                <Calculator className="w-4 h-4 text-emerald-700" />
                <span>2. Packing & Loose/Full Pack Conversion</span>
              </h4>
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                Units/Pack: {packingUnits}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Packing Specification <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.packing}
                  onChange={(e) => setFormData({ ...formData, packing: e.target.value })}
                  placeholder="e.g. 10x10, 20x10, 1x1, 100"
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-emerald-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <p className="text-[10px] text-slate-500">
                  Formats: 10x10 (10 strips of 10 = 100), 1x1 (Syrup), 10 (Ampoules)
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex flex-col justify-center">
                <span className="text-[10px] text-slate-500 font-medium">Full Pack Retail Price</span>
                <span className="text-sm font-bold text-slate-900 font-mono">
                  Rs. {formData.retail_price.toFixed(2)}
                </span>
                <span className="text-[10px] text-emerald-700">Per Box / Pack</span>
              </div>

              <div className="p-2.5 rounded-lg bg-white border border-emerald-200 flex flex-col justify-center">
                <span className="text-[10px] text-slate-500 font-medium">Loose Single Unit Retail</span>
                <span className="text-sm font-bold text-emerald-700 font-mono">
                  Rs. {looseRetailPrice.toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500">Per Tablet / Unit</span>
              </div>
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
                    onChange={(e) => setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })}
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
                    onChange={(e) => setFormData({ ...formData, trade_price: parseFloat(e.target.value) || 0 })}
                    className="w-full pl-8 pr-2 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    onChange={(e) => setFormData({ ...formData, wholesale_price: parseFloat(e.target.value) || 0 })}
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
                      const nextRetail = parseFloat(e.target.value) || 0;
                      const nextLoose = !looseRateTouched
                        ? Math.round((nextRetail / Math.max(1, packingUnits) + Number.EPSILON) * 100) / 100
                        : formData.loose_rate;
                      setFormData({ ...formData, retail_price: nextRetail, loose_rate: nextLoose });
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
                      setFormData({ ...formData, loose_rate: parseFloat(e.target.value) || 0 });
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

              {/* Tax % */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Tax % (GST)
                </label>
                <div className="relative">
                  <NumericInput
                    value={formData.tax_percent}
                    onChange={(e) => setFormData({ ...formData, tax_percent: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400">%</span>
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
