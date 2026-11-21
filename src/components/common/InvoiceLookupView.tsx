import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  RotateCcw,
  RefreshCw,
  ArrowUpDown,
  Printer,
  Edit3,
  FileSearch,
  AlertCircle,
  Calendar,
  Package,
  User,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { formatPKR, formatAppDate } from '../../utils/formatters';
import { SalesPrintModal } from '../sales/SalesPrintModal';
import { PurchasePrintModal } from '../purchases/PurchasePrintModal';

export interface LookupResultRow {
  uid: string;
  invoice_id: number;
  invoice_type: 'Sales' | 'Purchase';
  invoice_number: string;
  invoice_date: string;
  party_name: string;
  buyer_name: string;
  supplier_invoice_number?: string;
  item_code: string;
  item_name: string;
  company_name: string;
  quantity: number;
  invoice_total: number;
  paid_amount: number;
  payment_mode: string;
  status: string;
  matched_item_count: number;
  total_item_count: number;
}

interface InvoiceLookupViewProps {
  defaultScope: 'sales' | 'purchase';
  onOpenSalesInvoice: (saleId: number) => void;
  onOpenPurchaseInvoice: (purchaseId: number) => void;
}

export const InvoiceLookupView: React.FC<InvoiceLookupViewProps> = ({
  defaultScope,
  onOpenSalesInvoice,
  onOpenPurchaseInvoice,
}) => {
  const { isSuperAdmin, hasPermission, user } = useAuth();

  const canViewSales = isSuperAdmin || hasPermission('sales', 'view');
  const canViewPurchases = isSuperAdmin || hasPermission('purchases', 'view');
  const canEditSales = isSuperAdmin || hasPermission('sales', 'edit') || hasPermission('sales', 'create');
  const canEditPurchases =
    isSuperAdmin || hasPermission('purchases', 'edit') || hasPermission('purchases', 'create');

  const resolvedDefaultScope = useMemo<'sales' | 'purchase' | 'all'>(() => {
    if (defaultScope === 'sales') {
      return canViewSales ? 'sales' : canViewPurchases ? 'purchase' : 'sales';
    }
    return canViewPurchases ? 'purchase' : canViewSales ? 'sales' : 'purchase';
  }, [defaultScope, canViewSales, canViewPurchases]);

  const [scope, setScope] = useState<'sales' | 'purchase' | 'all'>(resolvedDefaultScope);

  // Sync scope when navigating between Sales -> Lookup and Purchase -> Lookup
  useEffect(() => {
    setScope(resolvedDefaultScope);
  }, [resolvedDefaultScope]);

  // Invoice-level Filters
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [buyerName, setBuyerName] = useState('');

  // Item Master Filters
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [category, setCategory] = useState('');
  const [packing, setPacking] = useState('');
  const [rackNumber, setRackNumber] = useState('');

  // Sorting & Results
  const [sortBy, setSortBy] = useState<'invoice_date' | 'invoice_number'>('invoice_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [rows, setRows] = useState<LookupResultRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  // View / Print Modals
  const [printSalesInvoice, setPrintSalesInvoice] = useState<Record<string, any> | null>(null);
  const [printPurchaseData, setPrintPurchaseData] = useState<{
    purchase: any;
    items: any[];
    journalLines: any[];
  } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => {
      firstInputRef.current?.focus();
    }, 30);
  }, [defaultScope]);

  const executeSearch = useCallback(
    async (overrides?: {
      scopeOverride?: 'sales' | 'purchase' | 'all';
      sortByOverride?: 'invoice_date' | 'invoice_number';
      sortOrderOverride?: 'asc' | 'desc';
      cleared?: boolean;
    }) => {
      const effectiveScope = overrides?.scopeOverride ?? scope;
      const effectiveSortBy = overrides?.sortByOverride ?? sortBy;
      const effectiveSortOrder = overrides?.sortOrderOverride ?? sortOrder;

      try {
        setLoading(true);
        setError(null);

        const res = await api.lookupInvoices(
          overrides?.cleared
            ? {
                scope: effectiveScope,
                sortBy: effectiveSortBy,
                sortOrder: effectiveSortOrder,
                limit: 300,
              }
            : {
                scope: effectiveScope,
                invoiceNumber,
                invoiceDate,
                startDate,
                endDate,
                customerName: effectiveScope === 'purchase' ? '' : customerName,
                supplierName: effectiveScope === 'sales' ? '' : supplierName,
                buyerName: effectiveScope === 'purchase' ? '' : buyerName,
                itemCode,
                itemName,
                barcode,
                companyName,
                genericName,
                category,
                packing,
                rackNumber,
                sortBy: effectiveSortBy,
                sortOrder: effectiveSortOrder,
                limit: 300,
              }
        );

        const data: LookupResultRow[] = Array.isArray(res?.data) ? res.data : [];
        setRows(data);
        setTotalCount(Number(res?.totalCount ?? data.length));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to execute invoice lookup');
        setRows([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    },
    [
      scope,
      sortBy,
      sortOrder,
      invoiceNumber,
      invoiceDate,
      startDate,
      endDate,
      customerName,
      supplierName,
      buyerName,
      itemCode,
      itemName,
      barcode,
      companyName,
      genericName,
      category,
      packing,
      rackNumber,
    ]
  );

  // Initial load & re-run when scope switches from sidebar
  useEffect(() => {
    executeSearch({ scopeOverride: resolvedDefaultScope });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDefaultScope, user?.id]);

  const handleClearSearch = () => {
    setInvoiceNumber('');
    setInvoiceDate('');
    setStartDate('');
    setEndDate('');
    setCustomerName('');
    setSupplierName('');
    setBuyerName('');
    setItemCode('');
    setItemName('');
    setBarcode('');
    setCompanyName('');
    setGenericName('');
    setCategory('');
    setPacking('');
    setRackNumber('');
    setSelectedUid(null);
    executeSearch({ cleared: true });
    setTimeout(() => {
      firstInputRef.current?.focus();
    }, 20);
  };

  const handleToggleSort = (field: 'invoice_date' | 'invoice_number') => {
    const nextOrder: 'asc' | 'desc' =
      sortBy === field ? (sortOrder === 'desc' ? 'asc' : 'desc') : 'desc';
    setSortBy(field);
    setSortOrder(nextOrder);
    executeSearch({ sortByOverride: field, sortOrderOverride: nextOrder });
  };

  const handleScopeChange = (nextScope: 'sales' | 'purchase' | 'all') => {
    setScope(nextScope);
    if (nextScope === 'purchase') {
      setCustomerName('');
      setBuyerName('');
    } else if (nextScope === 'sales') {
      setSupplierName('');
    }
    executeSearch({ scopeOverride: nextScope });
  };

  const handleOpenOriginalInvoice = (row: LookupResultRow) => {
    if (row.invoice_type === 'Sales') {
      if (!canEditSales) {
        handleViewPrintInvoice(row);
        return;
      }
      onOpenSalesInvoice(row.invoice_id);
      return;
    }
    if (!canEditPurchases) {
      handleViewPrintInvoice(row);
      return;
    }
    onOpenPurchaseInvoice(row.invoice_id);
  };

  const handleViewPrintInvoice = async (row: LookupResultRow) => {
    try {
      setOpeningId(row.uid);
      setError(null);
      if (row.invoice_type === 'Sales') {
        const res: any = await api.getSaleDetails(row.invoice_id);
        const inv = res?.data || res?.invoice || res?.sale;
        if (inv) {
          setPrintSalesInvoice({
            ...inv,
            items: (Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : res?.items) || [],
          });
        } else {
          setError('Sales invoice details could not be loaded.');
        }
      } else {
        const res = await api.getPurchaseDetails(row.invoice_id);
        if (res?.purchase) {
          setPrintPurchaseData({
            purchase: res.purchase,
            items: res.items || [],
            journalLines: res.journalLines || [],
          });
        } else {
          setError('Purchase invoice details could not be loaded.');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to open invoice preview');
    } finally {
      setOpeningId(null);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch();
  };

  const showSalesFields = scope === 'sales' || scope === 'all';
  const showPurchaseFields = scope === 'purchase' || scope === 'all';

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Header & Search Form */}
      <form
        onSubmit={handleFormSubmit}
        className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 space-y-3 shrink-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-emerald-400 flex items-center justify-center">
              <FileSearch className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 tracking-tight">
                {scope === 'sales'
                  ? 'Sales Invoice Lookup'
                  : scope === 'purchase'
                  ? 'Purchase Invoice Lookup'
                  : 'Sales & Purchase Invoice Lookup'}
              </h2>
              <p className="text-[11px] text-slate-500">
                Search by Invoice, Party, Buyer, or Item Master fields — each matching invoice is listed once. Double-click any row to open.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {canViewSales && (
              <button
                type="button"
                onClick={() => handleScopeChange('sales')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                  scope === 'sales'
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Sales Invoices
              </button>
            )}
            {canViewPurchases && (
              <button
                type="button"
                onClick={() => handleScopeChange('purchase')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                  scope === 'purchase'
                    ? 'bg-sky-600 text-white border-sky-700'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Purchase Invoices
              </button>
            )}
            {canViewSales && canViewPurchases && (
              <button
                type="button"
                onClick={() => handleScopeChange('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                  scope === 'all'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Both (Sales + Purchase)
              </button>
            )}
          </div>
        </div>

        {/* Invoice & Party Filters */}
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
            <User className="w-3 h-3 text-emerald-600" />
            <span>Invoice &amp; Party Criteria</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div>
              <label
                htmlFor="lookup_invoice_number"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Invoice Number
              </label>
              <input
                ref={firstInputRef}
                id="lookup_invoice_number"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-001 / PUR-..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_invoice_date"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Invoice Date (Exact)
              </label>
              <div className="relative">
                <input
                  id="lookup_invoice_date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="lookup_start_date"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                From Date
              </label>
              <input
                id="lookup_start_date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_end_date"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                To Date
              </label>
              <input
                id="lookup_end_date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>

            {showSalesFields && (
              <div>
                <label
                  htmlFor="lookup_customer_name"
                  className="block text-[10px] font-bold text-slate-600 mb-0.5"
                >
                  Customer Name
                </label>
                <input
                  id="lookup_customer_name"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name / code..."
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            )}

            {showSalesFields && (
              <div>
                <label
                  htmlFor="lookup_buyer_name"
                  className="block text-[10px] font-bold text-slate-600 mb-0.5"
                >
                  Buyer Name
                </label>
                <input
                  id="lookup_buyer_name"
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Receiver / Buyer..."
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            )}

            {showPurchaseFields && (
              <div>
                <label
                  htmlFor="lookup_supplier_name"
                  className="block text-[10px] font-bold text-slate-600 mb-0.5"
                >
                  Supplier Name
                </label>
                <input
                  id="lookup_supplier_name"
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Supplier / Vendor..."
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            )}
          </div>
        </div>

        {/* Item Master Filters */}
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
            <Package className="w-3 h-3 text-sky-600" />
            <span>Item Master Criteria (Matches invoices containing matching items)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <div>
              <label
                htmlFor="lookup_item_code"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Item Code
              </label>
              <input
                id="lookup_item_code"
                type="text"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                placeholder="Code..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_item_name"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Item Name
              </label>
              <input
                id="lookup_item_name"
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Medicine name..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_barcode"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Barcode
              </label>
              <input
                id="lookup_barcode"
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Barcode..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_company_name"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Company Name
              </label>
              <input
                id="lookup_company_name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_generic_name"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Generic Name
              </label>
              <input
                id="lookup_generic_name"
                type="text"
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="Generic / Formula..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_category"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Category
              </label>
              <input
                id="lookup_category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_packing"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Packing
              </label>
              <input
                id="lookup_packing"
                type="text"
                value={packing}
                onChange={(e) => setPacking(e.target.value)}
                placeholder="e.g. 1x10..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="lookup_rack_number"
                className="block text-[10px] font-bold text-slate-600 mb-0.5"
              >
                Rack #
              </label>
              <input
                id="lookup_rack_number"
                type="text"
                value={rackNumber}
                onChange={(e) => setRackNumber(e.target.value)}
                placeholder="Rack / Shelf..."
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>
        </div>

        {/* Action Bar & Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{loading ? 'Searching...' : 'Search'}</span>
            </button>

            <button
              type="button"
              onClick={handleClearSearch}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Search</span>
            </button>

            <button
              type="button"
              onClick={() => executeSearch()}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-bold text-slate-600">Sort By:</span>
              <select
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value as 'invoice_date' | 'invoice_number';
                  setSortBy(next);
                  executeSearch({ sortByOverride: next });
                }}
                className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-900 font-semibold text-xs"
              >
                <option value="invoice_date">Invoice Date</option>
                <option value="invoice_number">Invoice Number</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const next = sortOrder === 'desc' ? 'asc' : 'desc';
                  setSortOrder(next);
                  executeSearch({ sortOrderOverride: next });
                }}
                className="px-2 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold flex items-center gap-1 cursor-pointer"
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>{sortOrder === 'desc' ? 'Descending' : 'Ascending'}</span>
              </button>
            </div>

            <div className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 font-bold text-slate-700 tabular-nums">
              {rows.length} {rows.length === 1 ? 'Invoice' : 'Invoices'}
              {totalCount > rows.length ? ` (of ${totalCount})` : ''}
            </div>
          </div>
        </div>
      </form>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                <th className="px-3 py-2.5 whitespace-nowrap">Invoice Type</th>
                <th
                  className="px-3 py-2.5 whitespace-nowrap cursor-pointer hover:text-emerald-300 select-none"
                  onClick={() => handleToggleSort('invoice_number')}
                  title="Sort by Invoice Number"
                >
                  <span className="inline-flex items-center gap-1">
                    Invoice Number
                    {sortBy === 'invoice_number' && (
                      <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </span>
                </th>
                <th
                  className="px-3 py-2.5 whitespace-nowrap cursor-pointer hover:text-emerald-300 select-none"
                  onClick={() => handleToggleSort('invoice_date')}
                  title="Sort by Invoice Date"
                >
                  <span className="inline-flex items-center gap-1">
                    Invoice Date
                    {sortBy === 'invoice_date' && (
                      <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </span>
                </th>
                <th className="px-3 py-2.5 whitespace-nowrap">Customer / Supplier Name</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Buyer Name</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Item Code</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Item Name</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Company Name</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Quantity</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Invoice Total</th>
                <th className="px-3 py-2.5 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500 font-semibold">
                    Searching invoices...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500 font-semibold">
                    No matching invoices found. Adjust filters or click Clear Search to view recent invoices.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelected = selectedUid === row.uid;
                  const canEditRow =
                    row.invoice_type === 'Sales' ? canEditSales : canEditPurchases;
                  return (
                    <tr
                      key={row.uid}
                      onClick={() => setSelectedUid(row.uid)}
                      onDoubleClick={() => handleOpenOriginalInvoice(row)}
                      title="Double-click to open complete invoice"
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/90'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap font-bold">
                        <span
                          className={
                            row.invoice_type === 'Sales'
                              ? 'text-emerald-700'
                              : 'text-sky-700'
                          }
                        >
                          {row.invoice_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono font-bold text-slate-900">
                        {row.invoice_number}
                        {row.status && row.status !== 'completed' && (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-700">
                            ({row.status})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700">
                        {formatAppDate(row.invoice_date)}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-900">
                        {row.party_name || '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.invoice_type === 'Sales' ? row.buyer_name || '-' : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700">
                        {row.item_code || '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-900">
                        <span>{row.item_name || '-'}</span>
                        {row.total_item_count > 1 && (
                          <span className="ml-1.5 text-[10px] font-semibold text-slate-500">
                            (+{row.total_item_count - 1} more)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.company_name || '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {row.quantity}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {formatPKR(row.invoice_total)}
                      </td>
                      <td
                        className="px-3 py-2 whitespace-nowrap text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={openingId === row.uid}
                            onClick={() => handleViewPrintInvoice(row)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="View & Print Complete Invoice"
                          >
                            <Printer className="w-3 h-3 text-emerald-400" />
                            <span>View / Print</span>
                          </button>
                          {canEditRow && (
                            <button
                              type="button"
                              onClick={() => handleOpenOriginalInvoice(row)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Open Original Invoice for Editing"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          )}
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

      {/* View / Print Sales Invoice Modal */}
      {printSalesInvoice && (
        <SalesPrintModal
          invoice={printSalesInvoice}
          initialFormat="a4"
          onClose={() => setPrintSalesInvoice(null)}
        />
      )}

      {/* View / Print Purchase Invoice Modal */}
      {printPurchaseData && (
        <PurchasePrintModal
          isOpen={true}
          mode="invoice"
          invoice={printPurchaseData.purchase}
          invoiceItems={printPurchaseData.items}
          journalLines={printPurchaseData.journalLines}
          onClose={() => setPrintPurchaseData(null)}
        />
      )}
    </div>
  );
};
