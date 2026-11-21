import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileSpreadsheet,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  CompleteItemLogResponse,
  ItemLogPurchaseRow,
  ItemLogSaleRow,
} from '../../types/sales';
import { formatPKR, formatAppDate } from '../../utils/formatters';
import { SalesPrintModal } from '../sales/SalesPrintModal';
import { PurchasePrintModal } from '../purchases/PurchasePrintModal';

export interface ItemLogModalProps {
  isOpen: boolean;
  itemId: number | null;
  initialItemCode?: string;
  initialItemName?: string;
  defaultTab?: 'sales' | 'purchases';
  onClose: () => void;
}

type SortField = 'date' | 'quantity' | 'price';
type SortDirection = 'desc' | 'asc';

export const ItemLogModal: React.FC<ItemLogModalProps> = ({
  isOpen,
  itemId,
  initialItemCode,
  initialItemName,
  defaultTab = 'sales',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logData, setLogData] = useState<CompleteItemLogResponse | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [invoiceSearch, setInvoiceSearch] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [supplierSearch, setSupplierSearch] = useState<string>('');

  // Sorting (Default: Transaction Date DESC, newest first)
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Original Invoice Viewer State
  const [openingInvoice, setOpeningInvoice] = useState(false);
  const [viewSaleInvoice, setViewSaleInvoice] = useState<Record<string, any> | null>(null);
  const [viewPurchaseData, setViewPurchaseData] = useState<{
    invoice: any;
    items: any[];
    journalLines: any[];
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadItemLog = useCallback(async () => {
    if (!isOpen || !itemId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCompleteItemLog(itemId);
      setLogData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load complete item log.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, itemId]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(defaultTab);
    setFromDate('');
    setToDate('');
    setInvoiceSearch('');
    setCustomerSearch('');
    setSupplierSearch('');
    setSortField('date');
    setSortDir('desc');
    setViewSaleInvoice(null);
    setViewPurchaseData(null);
    loadItemLog();

    const timer = window.setTimeout(() => {
      containerRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isOpen, itemId, defaultTab, loadItemLog]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewSaleInvoice) {
          e.preventDefault();
          e.stopPropagation();
          setViewSaleInvoice(null);
          return;
        }
        if (viewPurchaseData) {
          e.preventDefault();
          e.stopPropagation();
          setViewPurchaseData(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [isOpen, onClose, viewSaleInvoice, viewPurchaseData]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filteredSales = useMemo<ItemLogSaleRow[]>(() => {
    const raw = logData?.salesHistory || [];
    const invQ = invoiceSearch.trim().toLowerCase();
    const custQ = customerSearch.trim().toLowerCase();

    const filtered = raw.filter((row) => {
      if (fromDate && row.invoice_date < fromDate) return false;
      if (toDate && row.invoice_date > toDate) return false;
      if (invQ && !String(row.invoice_number || '').toLowerCase().includes(invQ)) return false;
      if (
        custQ &&
        !String(row.customer_name || '').toLowerCase().includes(custQ) &&
        !String(row.buyer_name || '').toLowerCase().includes(custQ)
      ) {
        return false;
      }
      return true;
    });

    const dirMult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === 'quantity') {
        const qCmp = (Number(a.quantity || 0) - Number(b.quantity || 0)) * dirMult;
        if (qCmp !== 0) return qCmp;
      } else if (sortField === 'price') {
        const pCmp = (Number(a.unit_price || 0) - Number(b.unit_price || 0)) * dirMult;
        if (pCmp !== 0) return pCmp;
      }
      const dCmp = String(a.invoice_date || '').localeCompare(String(b.invoice_date || '')) * dirMult;
      if (dCmp !== 0) return dCmp;
      const invCmp =
        String(a.invoice_number || '').localeCompare(String(b.invoice_number || ''), undefined, {
          numeric: true,
        }) * dirMult;
      if (invCmp !== 0) return invCmp;
      return (Number(a.sale_id || 0) - Number(b.sale_id || 0)) * dirMult;
    });
  }, [logData?.salesHistory, fromDate, toDate, invoiceSearch, customerSearch, sortField, sortDir]);

  const filteredPurchases = useMemo<ItemLogPurchaseRow[]>(() => {
    const raw = logData?.purchaseHistory || [];
    const invQ = invoiceSearch.trim().toLowerCase();
    const supQ = supplierSearch.trim().toLowerCase();

    const filtered = raw.filter((row) => {
      if (fromDate && row.purchase_date < fromDate) return false;
      if (toDate && row.purchase_date > toDate) return false;
      if (
        invQ &&
        !String(row.invoice_number || '').toLowerCase().includes(invQ) &&
        !String(row.supplier_invoice_number || '').toLowerCase().includes(invQ)
      ) {
        return false;
      }
      if (supQ && !String(row.supplier_name || '').toLowerCase().includes(supQ)) return false;
      return true;
    });

    const dirMult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === 'quantity') {
        const qCmp = (Number(a.quantity || 0) - Number(b.quantity || 0)) * dirMult;
        if (qCmp !== 0) return qCmp;
      } else if (sortField === 'price') {
        const pCmp = (Number(a.purchase_price || 0) - Number(b.purchase_price || 0)) * dirMult;
        if (pCmp !== 0) return pCmp;
      }
      const dCmp =
        String(a.purchase_date || '').localeCompare(String(b.purchase_date || '')) * dirMult;
      if (dCmp !== 0) return dCmp;
      const invCmp =
        String(a.invoice_number || '').localeCompare(String(b.invoice_number || ''), undefined, {
          numeric: true,
        }) * dirMult;
      if (invCmp !== 0) return invCmp;
      return (Number(a.purchase_id || 0) - Number(b.purchase_id || 0)) * dirMult;
    });
  }, [logData?.purchaseHistory, fromDate, toDate, invoiceSearch, supplierSearch, sortField, sortDir]);

  const showProfitColumn = useMemo(
    () => filteredSales.some((r) => r.has_reliable_cost && r.profit !== null),
    [filteredSales]
  );

  const handleOpenSaleInvoice = async (saleId: number) => {
    if (!saleId || openingInvoice) return;
    setOpeningInvoice(true);
    try {
      const res = await api.getSaleDetails(saleId);
      const inv = res.data || res.invoice || res.sale;
      if (inv) {
        setViewSaleInvoice({
          ...inv,
          items: (Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : res.items) || [],
        });
      } else {
        setError('Unable to load original sales invoice details.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open sales invoice.');
    } finally {
      setOpeningInvoice(false);
    }
  };

  const handleOpenPurchaseInvoice = async (purchaseId: number) => {
    if (!purchaseId || openingInvoice) return;
    setOpeningInvoice(true);
    try {
      const res = await api.getPurchaseDetails(purchaseId);
      if (res.purchase) {
        setViewPurchaseData({
          invoice: res.purchase,
          items: res.items || [],
          journalLines: res.journalLines || [],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open purchase invoice.');
    } finally {
      setOpeningInvoice(false);
    }
  };

  if (!isOpen) return null;

  const header = logData?.header;
  const totalSoldPacksFiltered = filteredSales.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const totalSoldLooseFiltered = filteredSales.reduce(
    (s, r) => s + Number(r.loose_quantity || 0),
    0
  );
  const totalSoldBonusFiltered = filteredSales.reduce(
    (s, r) => s + Number(r.bonus_quantity || 0),
    0
  );
  const totalPurchasedPacksFiltered = filteredPurchases.reduce(
    (s, r) => s + Number(r.quantity || 0),
    0
  );
  const totalPurchasedBonusFiltered = filteredPurchases.reduce(
    (s, r) => s + Number(r.bonus_quantity || 0),
    0
  );
  const totalTransactionCount = filteredSales.length + filteredPurchases.length;

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-50 inline ml-1" />;
    return sortDir === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-emerald-700 inline ml-1" />
    ) : (
      <ArrowUp className="w-3 h-3 text-emerald-700 inline ml-1" />
    );
  };

  return (
    <div
      className="fixed inset-0 z-[75] bg-slate-950/70 flex items-center justify-center p-2.5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="ITEM LOG"
        className="w-full max-w-[96vw] h-[92vh] bg-white border-2 border-slate-700 shadow-2xl rounded-lg overflow-hidden flex flex-col outline-none text-xs"
      >
        {/* Top Title Bar */}
        <div className="bg-slate-900 text-white px-3.5 py-2 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-black text-sm tracking-wider uppercase">ITEM LOG</h2>
            <span className="text-slate-400">|</span>
            <span className="font-mono text-amber-300 font-bold truncate">
              [{header?.item_code || initialItemCode || ''}]
            </span>
            <span className="font-bold text-white truncate">
              {header?.item_name || initialItemName || ''}
            </span>
            {logData?.offline && (
              <span className="px-1.5 py-0.5 rounded bg-amber-900/70 border border-amber-500/40 text-amber-200 text-[10px] font-semibold">
                Offline Cache
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadItemLog}
              disabled={loading}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close (Esc)</span>
            </button>
          </div>
        </div>

        {/* Item Information Header */}
        <div className="bg-slate-50 border-b border-slate-300 px-3.5 py-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-1.5 text-[11px] shrink-0">
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Item Code</span>
            <span className="font-mono font-bold text-slate-900">
              {header?.item_code || initialItemCode || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Item Name</span>
            <span className="font-bold text-slate-950 truncate block" title={header?.item_name || initialItemName}>
              {header?.item_name || initialItemName || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Company Name</span>
            <span className="font-semibold text-slate-800 truncate block">
              {header?.company_name || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Generic Name</span>
            <span className="font-semibold text-slate-800 truncate block">
              {header?.generic_name || '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Barcode</span>
            <span className="font-mono font-semibold text-slate-800">
              {header?.barcode || '—'}
            </span>
          </div>

          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">
              Current Stock (Packs / Units)
            </span>
            <span className="font-mono font-black text-emerald-800">
              {header ? `${header.current_stock_packs} Packs / ${header.current_stock_units} Units` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">
              Current Purchase Price
            </span>
            <span className="font-mono font-bold text-sky-900">
              {header ? formatPKR(header.purchase_price) : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">
              Current Trade Price
            </span>
            <span className="font-mono font-bold text-slate-900">
              {header ? formatPKR(header.trade_price) : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">
              Current Wholesale Price
            </span>
            <span className="font-mono font-bold text-indigo-900">
              {header ? formatPKR(header.wholesale_price) : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">
              Current Retail Price / MRP
            </span>
            <span className="font-mono font-black text-emerald-900">
              {header ? formatPKR(header.retail_price) : '—'}
            </span>
          </div>
        </div>

        {/* Independent Tabs + Filters Bar */}
        <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={`px-3 py-1 rounded font-bold text-[11px] flex items-center gap-1.5 cursor-pointer border ${
                activeTab === 'sales'
                  ? 'bg-emerald-700 text-white border-emerald-800 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-400 hover:bg-slate-50'
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>SALES HISTORY ({filteredSales.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('purchases')}
              className={`px-3 py-1 rounded font-bold text-[11px] flex items-center gap-1.5 cursor-pointer border ${
                activeTab === 'purchases'
                  ? 'bg-sky-700 text-white border-sky-800 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-400 hover:bg-slate-50'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>PURCHASE HISTORY ({filteredPurchases.length})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <label className="flex items-center gap-1 text-slate-700 font-semibold">
              <span>From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-1.5 py-0.5 rounded border border-slate-400 bg-white font-mono text-[11px]"
              />
            </label>
            <label className="flex items-center gap-1 text-slate-700 font-semibold">
              <span>To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-1.5 py-0.5 rounded border border-slate-400 bg-white font-mono text-[11px]"
              />
            </label>
            <div className="relative">
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1.5" />
              <input
                type="text"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                placeholder="Search Invoice #..."
                className="pl-6 pr-2 py-0.5 w-36 rounded border border-slate-400 bg-white text-[11px] focus:border-emerald-600 outline-none"
              />
            </div>
            {activeTab === 'sales' ? (
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1.5" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search Customer..."
                  className="pl-6 pr-2 py-0.5 w-40 rounded border border-slate-400 bg-white text-[11px] focus:border-emerald-600 outline-none"
                />
              </div>
            ) : (
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1.5" />
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="Search Supplier..."
                  className="pl-6 pr-2 py-0.5 w-40 rounded border border-slate-400 bg-white text-[11px] focus:border-sky-600 outline-none"
                />
              </div>
            )}
            {(fromDate || toDate || invoiceSearch || customerSearch || supplierSearch) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setInvoiceSearch('');
                  setCustomerSearch('');
                  setSupplierSearch('');
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 border border-slate-400 text-slate-700 font-semibold cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Main Table Viewport */}
        <div className="flex-1 overflow-auto bg-white relative">
          {loading ? (
            <div className="py-12 text-center text-slate-500 font-semibold">
              Loading complete item transaction history...
            </div>
          ) : error ? (
            <div className="py-8 px-4 text-center text-rose-700 font-bold">{error}</div>
          ) : activeTab === 'sales' ? (
            filteredSales.length === 0 ? (
              <div className="py-12 text-center text-slate-500 font-semibold">
                No sales transactions found for this item matching the selected filters.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-400">
                  <tr>
                    <th
                      onClick={() => toggleSort('date')}
                      className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                    >
                      Invoice Date{renderSortIcon('date')}
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                      Invoice Number
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                      Customer Name
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                      Buyer Name
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                      Item Code
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 font-bold min-w-[180px]">
                      Item Name
                    </th>
                    <th
                      onClick={() => toggleSort('quantity')}
                      className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                    >
                      Quantity{renderSortIcon('quantity')}
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                      Loose Qty
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                      Bonus
                    </th>
                    <th
                      onClick={() => toggleSort('price')}
                      className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                    >
                      Sale Price{renderSortIcon('price')}
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                      Discount
                    </th>
                    <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                      Net Amount
                    </th>
                    {showProfitColumn && (
                      <th className="px-2 py-1.5 text-right whitespace-nowrap font-bold">Profit</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map((row, idx) => (
                    <tr
                      key={`${row.sale_id}_${row.sale_item_id}_${idx}`}
                      onDoubleClick={() => handleOpenSaleInvoice(row.sale_id)}
                      title="Double-click row to view original Sales Invoice"
                      className={`border-b border-slate-200 cursor-pointer ${
                        idx % 2 === 0 ? 'bg-white hover:bg-emerald-50/70' : 'bg-slate-50/60 hover:bg-emerald-50/70'
                      }`}
                    >
                      <td className="px-2 py-1 border-r border-slate-200 font-mono whitespace-nowrap">
                        {formatAppDate(row.invoice_date)}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 font-mono font-bold text-emerald-800 whitespace-nowrap">
                        {row.invoice_number}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 font-semibold text-slate-900">
                        {row.customer_name}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-slate-700">
                        {row.buyer_name || '—'}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 font-mono text-slate-700 whitespace-nowrap">
                        {row.variant_code || row.item_code}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-slate-900">
                        <span>{row.item_name}</span>
                        {row.variant_name ? (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[9px] font-bold">
                            {row.variant_name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono font-bold">
                        {row.quantity}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-teal-800">
                        {row.loose_quantity}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-emerald-700">
                        {row.bonus_quantity}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono font-bold text-slate-900">
                        {formatPKR(row.unit_price)}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-rose-700 whitespace-nowrap">
                        {Number(row.discount_percent || 0)}%
                        {Number(row.discount_amount || 0) > 0
                          ? ` (${formatPKR(row.discount_amount)})`
                          : ''}
                      </td>
                      <td className="px-2 py-1 border-r border-slate-200 text-right font-mono font-black text-slate-900">
                        {formatPKR(row.line_total)}
                      </td>
                      {showProfitColumn && (
                        <td
                          className={`px-2 py-1 text-right font-mono font-bold whitespace-nowrap ${
                            row.profit === null
                              ? 'text-slate-400'
                              : row.profit >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {row.profit !== null ? formatPKR(row.profit) : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : filteredPurchases.length === 0 ? (
            <div className="py-12 text-center text-slate-500 font-semibold">
              No purchase transactions found for this item matching the selected filters.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-400">
                <tr>
                  <th
                    onClick={() => toggleSort('date')}
                    className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                  >
                    Purchase Date{renderSortIcon('date')}
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Invoice Number
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Supplier Name
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Item Code
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 font-bold min-w-[170px]">
                    Item Name
                  </th>
                  <th
                    onClick={() => toggleSort('quantity')}
                    className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                  >
                    Quantity{renderSortIcon('quantity')}
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Bonus
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Batch Number
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Expiry Date
                  </th>
                  <th
                    onClick={() => toggleSort('price')}
                    className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold cursor-pointer hover:bg-slate-200 select-none"
                  >
                    Purchase Price{renderSortIcon('price')}
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Trade Price
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Discount
                  </th>
                  <th className="px-2 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Tax
                  </th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap font-bold">Net Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((row, idx) => (
                  <tr
                    key={`${row.purchase_id}_${row.purchase_item_id}_${idx}`}
                    onDoubleClick={() => handleOpenPurchaseInvoice(row.purchase_id)}
                    title="Double-click row to view original Purchase Invoice"
                    className={`border-b border-slate-200 cursor-pointer ${
                      idx % 2 === 0 ? 'bg-white hover:bg-sky-50/70' : 'bg-slate-50/60 hover:bg-sky-50/70'
                    }`}
                  >
                    <td className="px-2 py-1 border-r border-slate-200 font-mono whitespace-nowrap">
                      {formatAppDate(row.purchase_date)}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 font-mono font-bold text-sky-800 whitespace-nowrap">
                      {row.invoice_number}
                      {row.supplier_invoice_number ? (
                        <span className="text-[10px] text-slate-500 ml-1">
                          ({row.supplier_invoice_number})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 font-semibold text-slate-900">
                      {row.supplier_name}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 font-mono text-slate-700 whitespace-nowrap">
                      {row.variant_code || row.item_code}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-slate-900">
                      <span>{row.item_name}</span>
                      {row.variant_name ? (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[9px] font-bold">
                          {row.variant_name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono font-bold">
                      {row.quantity}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-emerald-700">
                      {row.bonus_quantity}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 font-mono whitespace-nowrap">
                      {row.batch_number || '—'}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 font-mono whitespace-nowrap">
                      {formatAppDate(row.expiry_date)}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono font-bold text-sky-900">
                      {formatPKR(row.purchase_price)}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-slate-800">
                      {formatPKR(row.trade_price)}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-rose-700 whitespace-nowrap">
                      {Number(row.discount_percent || 0)}%
                      {Number(row.discount_amount || 0) > 0
                        ? ` (${formatPKR(row.discount_amount)})`
                        : ''}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right font-mono text-slate-700 whitespace-nowrap">
                      {Number(row.tax_amount || 0) > 0
                        ? formatPKR(row.tax_amount)
                        : `${Number(row.tax_percent || 0)}%`}
                    </td>
                    <td className="px-2 py-1 text-right font-mono font-black text-slate-900">
                      {formatPKR(row.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Summary Footer */}
        <div className="bg-slate-900 text-slate-100 px-3.5 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] shrink-0">
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <span>
              Total Transactions:{' '}
              <strong className="text-amber-300">{totalTransactionCount}</strong>
              {logData?.summary && logData.summary.totalTransactionsCount !== totalTransactionCount
                ? ` (of ${logData.summary.totalTransactionsCount})`
                : ''}
            </span>
            <span>
              Total Purchased Qty:{' '}
              <strong className="text-sky-300">
                {totalPurchasedPacksFiltered} Packs
                {totalPurchasedBonusFiltered > 0 ? ` + ${totalPurchasedBonusFiltered} Bonus` : ''}
              </strong>
            </span>
            <span>
              Total Sold Qty:{' '}
              <strong className="text-emerald-300">
                {totalSoldPacksFiltered} Packs
                {totalSoldLooseFiltered > 0 ? ` + ${totalSoldLooseFiltered} Loose` : ''}
                {totalSoldBonusFiltered > 0 ? ` (+${totalSoldBonusFiltered} Bonus)` : ''}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10.5px] text-slate-300">
            <span>Double-click any row to view original invoice</span>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold cursor-pointer"
            >
              Close (Esc)
            </button>
          </div>
        </div>
      </div>

      {/* Original Invoice View Modals */}
      {viewSaleInvoice && (
        <div className="relative z-[95]">
          <SalesPrintModal
            isOpen={true}
            invoice={viewSaleInvoice}
            onClose={() => setViewSaleInvoice(null)}
          />
        </div>
      )}
      {viewPurchaseData && (
        <div className="relative z-[95]">
          <PurchasePrintModal
            isOpen={true}
            mode="invoice"
            invoice={viewPurchaseData.invoice}
            invoiceItems={viewPurchaseData.items}
            journalLines={viewPurchaseData.journalLines}
            onClose={() => setViewPurchaseData(null)}
          />
        </div>
      )}
    </div>
  );
};
