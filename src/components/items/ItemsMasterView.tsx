import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package,
  Search,
  Plus,
  FileSpreadsheet,
  Download,
  Upload,
  RefreshCw,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Filter,
  ArrowUpDown,
  Tag,
  Coins,
  Barcode as BarcodeIcon,
  Layers,
  MapPin,
  Printer,
} from 'lucide-react';
import { Item, ItemStats } from '../../types/item';
import { api } from '../../services/api';
import { ItemFormModal } from './ItemFormModal';
import { ExcelImportModal } from './ExcelImportModal';
import { exportItemsToExcel } from '../../utils/excel';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { SimpleSyncStatusBar, RecordSyncBadge } from '../common/SimpleSyncStatusBar';

interface ItemsMasterViewProps {
  initialOpenImport?: boolean;
}

export const ItemsMasterView: React.FC<ItemsMasterViewProps> = ({
  initialOpenImport = false,
}) => {
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<ItemStats>({
    totalItems: 0,
    activeItems: 0,
    lowStockItems: 0,
    totalTradeValue: 0,
    totalRetailValue: 0,
    totalStockUnits: 0,
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>('item_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Loading & Error states
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const itemsPrintRef = useRef<HTMLDivElement>(null);

  // Modals state
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(initialOpenImport);
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    setIsImportModalOpen(initialOpenImport);
  }, [initialOpenImport]);

  // Fetch Items from Database
  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getItems({
        q: searchQuery,
        category: selectedCategory,
        company: selectedCompany,
        status: selectedStatus,
        lowStock: lowStockOnly,
        sortBy,
        sortOrder,
      });

      setItems(res.items || []);
      if (res.stats) setStats(res.stats);
      if (res.filters) {
        setCategories(res.filters.categories || []);
        setCompanies(res.filters.companies || []);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory, selectedCompany, selectedStatus, lowStockOnly, sortBy, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems();
    }, 250); // Fast 250ms debounce
    return () => clearTimeout(timer);
  }, [fetchItems]);

  const handleSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnKey);
      setSortOrder('asc');
    }
  };

  const handleOpenAdd = () => {
    setEditingItem(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (item: Item) => {
    setEditingItem(item);
    setIsFormModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    try {
      setIsDeleting(true);
      await api.deleteItem(deletingItem.id);
      setSuccessNotice(`Item "${deletingItem.item_name}" (${deletingItem.item_code}) has been permanently deleted.`);
      setDeletingItem(null);
      fetchItems();
      setTimeout(() => setSuccessNotice(null), 3500);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = () => {
    if (items.length === 0) {
      alert('No items to export.');
      return;
    }
    exportItemsToExcel(items, `Abrar_Medical_Store_Items_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Inline Loose Rate editing state
  const [inlineLooseRates, setInlineLooseRates] = useState<Record<number, string>>({});
  const [savingLooseId, setSavingLooseId] = useState<number | null>(null);

  // Helper to parse packing units for loose price calculation
  const getLoosePrice = (retailPrice: number, packingStr: string, savedLooseRate?: number) => {
    if (savedLooseRate !== undefined && Number(savedLooseRate) > 0) {
      return Number(savedLooseRate);
    }
    if (!packingStr) return retailPrice;
    const parts = packingStr.toLowerCase().split('x').map((p) => parseFloat(p.trim())).filter((n) => !isNaN(n) && n > 0);
    const units = parts.length === 2 ? parts[0] * parts[1] : parts.length === 1 ? parts[0] : 1;
    return units > 0 ? retailPrice / units : retailPrice;
  };

  const handleSaveInlineLooseRate = async (item: Item, rawValue: string) => {
    const trimmed = rawValue.trim();
    const parsed = trimmed === '' ? 0 : parseFloat(trimmed);
    if (isNaN(parsed) || parsed < 0) return;
    const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
    const currentLoose = getLoosePrice(item.retail_price, item.packing, item.loose_rate);
    if (Math.abs(rounded - currentLoose) < 0.001 && item.loose_rate !== undefined && Number(item.loose_rate) === rounded) {
      return;
    }
    try {
      setSavingLooseId(item.id);
      const res = await api.updateItem(item.id, {
        ...item,
        loose_rate: rounded,
      });
      setItems((prev) => prev.map((it) => (it.id === item.id ? res.item : it)));
      setSuccessNotice(`Loose Rate for "${item.item_name}" updated to Rs. ${rounded.toFixed(2)} (Box Rate preserved).`);
      setTimeout(() => setSuccessNotice(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setSavingLooseId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* Top Title & Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <Package className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Items Master (Abrar Medical Store)
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              Active Module
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict 17-field catalog • Decimal PKR pricing • Loose & full packing conversion • Excel Import/Export
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => {
              if (itemsPrintRef.current) {
                printReportDocument(
                  itemsPrintRef.current,
                  'Abrar Medical Store - Medicine Catalog Directory',
                  { orientation: 'landscape', paperSize: 'a4' }
                );
              } else {
                window.print();
              }
            }}
            disabled={items.length === 0}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-700 text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Print formatted medicine catalog"
          >
            <Printer className="w-3.5 h-3.5 text-slate-300" />
            <span>Print Catalog</span>
          </button>

          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Export items to Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Import items from Excel (.xlsx or .csv)"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-600" />
            <span>Import Excel</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Item</span>
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {successNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-rose-700 hover:text-rose-950 font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live Database Sync Status */}
      <SimpleSyncStatusBar onSyncCompleted={fetchItems} />

      {/* Summary KPI Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Items</span>
          <div className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{stats.totalItems}</div>
          <span className="text-[10px] text-slate-500">In database</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Active Items</span>
          <div className="text-xl font-extrabold text-emerald-700 font-mono mt-0.5">{stats.activeItems}</div>
          <span className="text-[10px] text-slate-500">Available for sale</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Low Stock Alert</span>
          <div className="text-xl font-extrabold text-amber-700 font-mono mt-0.5">{stats.lowStockItems}</div>
          <span className="text-[10px] text-slate-500">&le; Min Stock level</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Stock</span>
          <div className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{stats.totalStockUnits}</div>
          <span className="text-[10px] text-slate-500">Packs on shelf</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Trade Value (TP)</span>
          <div className="text-sm font-extrabold text-blue-900 font-mono truncate mt-1">
            {formatPKR(stats.totalTradeValue)}
          </div>
          <span className="text-[10px] text-slate-500">At trade price</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Retail Value (MRP)</span>
          <div className="text-sm font-extrabold text-purple-900 font-mono truncate mt-1">
            {formatPKR(stats.totalRetailValue)}
          </div>
          <span className="text-[10px] text-slate-500">At retail price</span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Fast Search input */}
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Code, Barcode, Name, Company..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>

          {/* Category Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Company Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Companies</option>
              {companies.map((comp) => (
                <option key={comp} value={comp}>
                  {comp}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>

          {/* Low Stock Toggle & Refresh */}
          <div className="md:col-span-2 flex items-center justify-between md:justify-end gap-2">
            <button
              onClick={() => setLowStockOnly(!lowStockOnly)}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
                lowStockOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Low Stock</span>
            </button>

            <button
              onClick={fetchItems}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Items Table"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Printable Catalog Area */}
      <div ref={itemsPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="MEDICINE CATALOG & ITEM MASTER DIRECTORY"
          subtitle="Official pharmaceutical master directory with loose rates, full packing, barcode, and valuations"
          metaFields={[
            { label: 'Category Filter', value: selectedCategory === 'all' ? 'All' : selectedCategory },
            { label: 'Company Filter', value: selectedCompany === 'all' ? 'All' : selectedCompany },
            { label: 'Status Filter', value: selectedStatus === 'all' ? 'All' : selectedStatus },
            { label: 'Total Items', value: `${stats.totalItems}` },
            { label: 'Trade Value', value: formatPKR(stats.totalTradeValue) },
            { label: 'Retail Value', value: formatPKR(stats.totalRetailValue) },
          ]}
        />

        {/* Main Desktop Items Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider select-none">
                <th
                  onClick={() => handleSort('item_code')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center gap-1">
                    <span>Item Code</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('item_name')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center gap-1">
                    <span>Item Name & Generic</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('company_name')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center gap-1">
                    <span>Company</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Packing</th>
                <th className="py-2.5 px-3">Barcode</th>
                <th
                  onClick={() => handleSort('purchase_price')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Purchase</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('trade_price')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Trade (TP)</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3 text-right">Wholesale</th>
                <th
                  onClick={() => handleSort('retail_price')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Retail (MRP)</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3 text-right text-blue-800 bg-blue-50/40">Loose Rate</th>
                <th className="py-2.5 px-2 text-center">Disc/Tax</th>
                <th
                  onClick={() => handleSort('opening_stock')}
                  className="py-2.5 px-3 text-center cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Stock</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-2 text-center">Min</th>
                <th className="py-2.5 px-2.5">Rack</th>
                <th className="py-2.5 px-2.5 text-center">Status</th>
                <th className="py-2.5 px-2.5 text-center">Sync Status</th>
                <th className="py-2.5 px-3 text-right sticky right-0 bg-slate-50 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)] print:hidden">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={17} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                    <span>Loading items from database...</span>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={17} className="py-12 text-center text-slate-500">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
                        <Package className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">No items found</h4>
                        <p className="text-xs text-slate-500 mt-1">
                          No items match your search or filter. You can add a new item or import from Excel.
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2.5 pt-2">
                        <button
                          onClick={handleOpenAdd}
                          className="px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add New Item</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isLow = item.opening_stock <= item.minimum_stock;
                  const loosePrice = getLoosePrice(item.retail_price, item.packing, item.loose_rate);
                  const inlineVal =
                    inlineLooseRates[item.id] !== undefined
                      ? inlineLooseRates[item.id]
                      : loosePrice > 0
                      ? String(Math.round((loosePrice + Number.EPSILON) * 100) / 100)
                      : '';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !isLow ? '' : 'bg-amber-50/20'
                      }`}
                    >
                      {/* Item Code */}
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800">
                          {item.item_code}
                        </span>
                      </td>

                      {/* Item Name & Generic */}
                      <td className="py-2 px-3 max-w-xs">
                        <div className="font-bold text-slate-900 truncate" title={item.item_name}>
                          {item.item_name}
                        </div>
                        {item.generic_name && (
                          <div className="text-[11px] text-slate-500 truncate" title={item.generic_name}>
                            {item.generic_name}
                          </div>
                        )}
                      </td>

                      {/* Company Name */}
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">
                        {item.company_name}
                      </td>

                      {/* Category */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {item.category}
                        </span>
                      </td>

                      {/* Packing (Loose & Full Pack support) */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-slate-800">{item.packing}</span>
                          <span className="text-[10px] text-emerald-700" title="Loose unit rate">
                            Rs. {loosePrice.toFixed(2)} /unit
                          </span>
                        </div>
                      </td>

                      {/* Barcode */}
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {item.barcode || <span className="text-slate-300">—</span>}
                      </td>

                      {/* Purchase Price */}
                      <td className="py-2 px-3 text-right font-mono font-medium text-slate-700 whitespace-nowrap">
                        {item.purchase_price > 0 ? `Rs. ${item.purchase_price.toFixed(2)}` : '0.00'}
                      </td>

                      {/* Trade Price (TP) */}
                      <td className="py-2 px-3 text-right font-mono font-medium text-slate-800 whitespace-nowrap">
                        {item.trade_price > 0 ? `Rs. ${item.trade_price.toFixed(2)}` : '0.00'}
                      </td>

                      {/* Wholesale Price */}
                      <td className="py-2 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                        {item.wholesale_price > 0 ? `Rs. ${item.wholesale_price.toFixed(2)}` : '0.00'}
                      </td>

                      {/* Retail Price (MRP) */}
                      <td className="py-2 px-3 text-right font-mono font-black text-emerald-900 whitespace-nowrap">
                        Rs. {item.retail_price.toFixed(2)}
                      </td>

                      {/* Editable Loose Rate */}
                      <td className="py-1.5 px-2 text-right whitespace-nowrap bg-blue-50/20">
                        <div className="inline-flex items-center justify-end gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={inlineVal}
                            disabled={savingLooseId === item.id}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;
                              setInlineLooseRates((prev) => ({
                                ...prev,
                                [item.id]: raw,
                              }));
                            }}
                            onBlur={(e) => handleSaveInlineLooseRate(item, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-20 px-1.5 py-1 text-right font-mono font-bold text-xs text-blue-950 bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
                            title="Edit Loose Rate directly and press Enter or click outside to save"
                          />
                        </div>
                      </td>

                      {/* Disc / Tax */}
                      <td className="py-2 px-2 text-center text-[11px] font-mono whitespace-nowrap text-slate-500">
                        {item.discount_percent > 0 && <span className="text-emerald-700 font-bold">{item.discount_percent}%</span>}
                        {item.discount_percent > 0 && item.tax_percent > 0 && <span> / </span>}
                        {item.tax_percent > 0 && <span className="text-amber-700 font-bold">{item.tax_percent}%T</span>}
                        {item.discount_percent === 0 && item.tax_percent === 0 && <span className="text-slate-300">0%</span>}
                      </td>

                      {/* Opening Stock */}
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded ${
                            isLow
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'text-slate-900'
                          }`}
                          title={isLow ? `Low Stock Alert (<= ${item.minimum_stock})` : 'Normal Stock'}
                        >
                          {item.opening_stock}
                        </span>
                      </td>

                      {/* Min Stock */}
                      <td className="py-2 px-2 text-center font-mono text-slate-500 whitespace-nowrap">
                        {item.minimum_stock}
                      </td>

                      {/* Rack Number */}
                      <td className="py-2 px-2.5 font-medium text-slate-700 whitespace-nowrap">
                        {item.rack_number ? (
                          <span className="flex items-center gap-1 text-[11px]">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {item.rack_number}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2 px-2.5 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>

                      {/* Sync Status */}
                      <td className="py-2 px-2.5 text-center whitespace-nowrap">
                        <RecordSyncBadge syncStatus={(item as any).sync_status} />
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-3 text-right whitespace-nowrap sticky right-0 bg-white/95 group-hover:bg-slate-50/95 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)] print:hidden">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                            title="Edit Item"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingItem(item)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete Item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* Table Footer */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between print:hidden">
          <span>
            Showing <strong>{items.length}</strong> items in catalog
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            Database: Central SQLite + Local IndexedDB &bull; Table: items
          </span>
        </div>
      </div>
    </div>

      {/* Item Form Modal (Add / Edit) */}
      <ItemFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        editingItem={editingItem}
        onSaved={(savedItem) => {
          setSuccessNotice(
            `Item "${savedItem.item_name}" (${savedItem.item_code}) saved permanently to database.`
          );
          fetchItems();
          setTimeout(() => setSuccessNotice(null), 3500);
        }}
      />

      {/* Excel Import Modal */}
      <ExcelImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={() => {
          fetchItems();
        }}
      />

      {/* Delete Confirmation Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Item Permanently</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900">{deletingItem.item_name}</div>
              <div className="font-mono text-slate-600 text-[11px]">
                Code: {deletingItem.item_code} &bull; Company: {deletingItem.company_name}
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to permanently delete this item from the Items Master database?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
