import React, { useEffect, useState } from 'react';
import { History, X, Star, ShoppingCart, ShoppingBag, RefreshCw } from 'lucide-react';
import {
  CustomerItemHistoryResponse,
  CustomerSaleHistoryEntry,
  ItemPurchaseHistoryEntry,
} from '../../types/sales';

import { ProductThumb } from './ProductThumb';
import { formatAppDate } from '../../utils/formatters';

export interface CompactItemHistoryPopupProps {
  isOpen: boolean;
  mode: 'sales' | 'purchase';
  itemCode: string;
  itemName: string;
  variantName?: string | null;
  thumbnailUrl?: string | null;
  packing?: string;
  selectedCustomerId?: number | null;
  selectedCustomerName?: string;
  selectedSupplierName?: string;
  historyData: CustomerItemHistoryResponse | null | undefined;
  loading?: boolean;
  onClose: () => void;
  onApplySaleRate?: (rate: number, discountPercent: number) => void;
}

const formatNumber = (val: unknown, decimals = 2): string => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-PK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatDisc = (pctVal: unknown, amtVal: unknown): string => {
  const pct = Number(pctVal || 0);
  const amt = Number(amtVal || 0);
  if (pct > 0 && amt > 0) {
    return `${Number(pct.toFixed(2))}% (Rs. ${formatNumber(amt)})`;
  }
  if (pct > 0) {
    return `${Number(pct.toFixed(2))}%`;
  }
  if (amt > 0) {
    return `Rs. ${formatNumber(amt)}`;
  }
  return '0%';
};

const sortSalesLatest10 = (
  rows: CustomerSaleHistoryEntry[] | undefined | null
): CustomerSaleHistoryEntry[] => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return [...rows]
    .sort((a, b) => {
      const dCmp = String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''));
      if (dCmp !== 0) return dCmp;
      const idCmp = Number(b.sale_id || 0) - Number(a.sale_id || 0);
      if (idCmp !== 0) return idCmp;
      return String(b.invoice_number || '').localeCompare(String(a.invoice_number || ''), undefined, {
        numeric: true,
      });
    })
    .slice(0, 10);
};

const sortPurchasesLatest10 = (
  rows: ItemPurchaseHistoryEntry[] | undefined | null
): ItemPurchaseHistoryEntry[] => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return [...rows]
    .sort((a, b) => {
      const dA = String(a.bill_date || a.invoice_date || '');
      const dB = String(b.bill_date || b.invoice_date || '');
      const dCmp = dB.localeCompare(dA);
      if (dCmp !== 0) return dCmp;
      const idCmp = Number(b.purchase_id || 0) - Number(a.purchase_id || 0);
      if (idCmp !== 0) return idCmp;
      const nA = String(a.bill_number || a.invoice_number || '');
      const nB = String(b.bill_number || b.invoice_number || '');
      return nB.localeCompare(nA, undefined, { numeric: true });
    })
    .slice(0, 10);
};

export const CompactItemHistoryPopup: React.FC<CompactItemHistoryPopupProps> = ({
  isOpen,
  mode,
  itemCode,
  itemName,
  variantName,
  thumbnailUrl,
  packing,
  selectedCustomerId,
  selectedCustomerName,
  historyData,
  loading = false,
  onClose,
  onApplySaleRate,
}) => {
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>(
    mode === 'purchase' ? 'purchases' : 'sales'
  );

  // Sync default tab whenever popup opens, mode changes, or selected item/customer changes
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(mode === 'purchase' ? 'purchases' : 'sales');
  }, [isOpen, mode, itemCode, selectedCustomerId]);

  if (!isOpen || !itemCode) return null;

  const hasSelectedCustomer = Boolean(selectedCustomerId && Number(selectedCustomerId) > 0);

  // In Sales mode, NEVER display another customer's sales or any purchase records.
  const rawSales: CustomerSaleHistoryEntry[] =
    mode === 'sales'
      ? hasSelectedCustomer
        ? (historyData?.customerSalesHistory || []).filter(
            (s) => Number(s.customer_account_id) === Number(selectedCustomerId)
          )
        : []
      : historyData?.salesHistory && historyData.salesHistory.length > 0
      ? historyData.salesHistory
      : historyData?.customerSalesHistory || [];

  const latestSales = sortSalesLatest10(rawSales);
  const latestPurchases = mode === 'sales' ? [] : sortPurchasesLatest10(historyData?.purchaseHistory);

  // Identify the last sale to the currently selected customer
  const lastCustomerSale: CustomerSaleHistoryEntry | null =
    hasSelectedCustomer
      ? (historyData?.lastCustomerSale &&
        Number(historyData.lastCustomerSale.customer_account_id) === Number(selectedCustomerId)
          ? historyData.lastCustomerSale
          : null) ||
        latestSales.find((s) => Number(s.customer_account_id) === Number(selectedCustomerId)) ||
        null
      : null;

  return (
    <div
      data-testid="compact-item-history-popup"
      data-item-code={itemCode}
      onMouseDown={(e) => {
        // Prevent popup clicks from stealing focus from Item Name input
        e.preventDefault();
      }}
      className="bg-white border-2 border-slate-700 rounded-md shadow-xl text-slate-900 overflow-hidden shrink-0 z-40 select-none"
    >
      {/* Compact Header Bar */}
      <div className="bg-slate-900 text-white px-2.5 py-1 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {thumbnailUrl ? (
            <ProductThumb src={thumbnailUrl} alt={itemName} size="xs" className="border-slate-700 bg-slate-800" />
          ) : (
            <History className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="font-bold uppercase tracking-wider text-emerald-300 text-[10px]">
            {mode === 'sales' ? 'Customer Sales Item History' : 'Item History'}
          </span>
          <span
            data-testid="compact-history-item-code"
            className="px-1.5 py-0 rounded bg-emerald-700 text-white font-mono font-bold text-[10px]"
          >
            Code: {itemCode}
          </span>
          <span className="font-bold text-white truncate max-w-[260px]" title={itemName}>
            {itemName}
          </span>
          {variantName && (
            <span className="px-1.5 py-0 rounded bg-amber-600/90 text-white font-bold text-[9.5px] shrink-0">
              {variantName}
            </span>
          )}
          {packing && (
            <span className="text-slate-300 font-mono text-[10px]">({packing})</span>
          )}
          {mode === 'sales' && hasSelectedCustomer && selectedCustomerName && (
            <span className="px-1.5 py-0 rounded bg-slate-800 text-amber-300 font-semibold text-[10px] truncate max-w-[200px]">
              Customer: {selectedCustomerName}
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1 text-amber-300 font-mono text-[10px]">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Loading...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="compact-history-tab-sales"
            onClick={() => setActiveTab('sales')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
              activeTab === 'sales'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <ShoppingCart className="w-3 h-3" />
            <span>Sales History ({latestSales.length})</span>
          </button>
          {mode !== 'sales' && (
            <button
              type="button"
              data-testid="compact-history-tab-purchases"
              onClick={() => setActiveTab('purchases')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                activeTab === 'purchases'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3 h-3" />
              <span>Purchase History ({latestPurchases.length})</span>
            </button>
          )}
          <button
            type="button"
            data-testid="compact-history-close-btn"
            onClick={onClose}
            className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white text-[10px] font-bold cursor-pointer flex items-center gap-0.5"
            title="Close Item History Popup (Esc)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Customer-specific Last Sale highlight bar in Sales mode */}
      {mode === 'sales' && (
        <div
          data-testid="compact-history-last-customer-sale"
          className={`px-2.5 py-1 border-b flex flex-wrap items-center justify-between gap-2 text-[10.5px] ${
            lastCustomerSale
              ? 'bg-amber-50 border-amber-300 text-slate-900'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {lastCustomerSale ? (
            <>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded bg-amber-600 text-white font-sans font-bold text-[9.5px] uppercase">
                  <Star className="w-2.5 h-2.5 fill-white" />
                  Last Sale to Selected Customer
                </span>
                <span className="font-sans font-bold text-slate-900">
                  {lastCustomerSale.customer_name || selectedCustomerName || 'Selected Customer'}
                </span>
                <span className="text-slate-600">
                  Date: <strong className="text-slate-900">{formatAppDate(lastCustomerSale.invoice_date)}</strong>
                </span>
                <span className="text-slate-600">
                  Inv #: <strong className="text-emerald-800">{lastCustomerSale.invoice_number}</strong>
                </span>
                <span className="text-slate-600">
                  Qty: <strong className="text-slate-900">{Number(lastCustomerSale.quantity || 0)}</strong>
                </span>
                <span className="text-slate-600">
                  Loose: <strong className="text-slate-900">{Number(lastCustomerSale.loose_quantity || 0)}</strong>
                </span>
                <span className="text-slate-600">
                  Sale Price:{' '}
                  <strong className="text-emerald-800">
                    Rs. {formatNumber(lastCustomerSale.unit_price)}
                  </strong>
                </span>
                <span className="text-slate-600">
                  Discount:{' '}
                  <strong className="text-rose-700">
                    {formatDisc(lastCustomerSale.discount_percent, lastCustomerSale.discount_amount)}
                  </strong>
                </span>
                <span className="text-slate-600">
                  Net Amount:{' '}
                  <strong className="text-slate-900">
                    Rs. {formatNumber(lastCustomerSale.line_total)}
                  </strong>
                </span>
              </div>
              {onApplySaleRate && (
                <button
                  type="button"
                  onClick={() =>
                    onApplySaleRate(
                      Number(lastCustomerSale.unit_price || 0),
                      Number(lastCustomerSale.discount_percent || 0)
                    )
                  }
                  className="px-2 py-0 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[9.5px] cursor-pointer"
                >
                  Apply Customer Rate
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0 rounded bg-slate-200 text-slate-700 font-bold text-[9.5px] uppercase">
                Customer Sales History
              </span>
              <span className="font-semibold text-slate-700">
                {!hasSelectedCustomer
                  ? 'Please select a customer first.'
                  : loading
                  ? 'Loading customer sales history...'
                  : 'No previous sales history for this customer.'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Compact Table Body (Latest Transactions in Descending Date Order) */}
      <div className="max-h-36 overflow-y-auto overflow-x-auto bg-white">
        {mode === 'sales' || activeTab === 'sales' ? (
          <table
            data-testid="compact-history-sales-table"
            className="w-full text-left border-collapse text-[10.5px]"
          >
            <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-300 font-bold">
              <tr>
                <th className="px-2 py-0.5 border-r border-slate-200">Transaction Date</th>
                <th className="px-2 py-0.5 border-r border-slate-200">Invoice Number</th>
                <th className="px-2 py-0.5 border-r border-slate-200">Customer</th>
                <th className="px-2 py-0.5 border-r border-slate-200">Item Name</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Quantity</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Loose Qty</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Rate</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Discount</th>
                <th className="px-2 py-0.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {mode === 'sales' && !hasSelectedCustomer ? (
                <tr>
                  <td colSpan={9} className="px-3 py-2 text-center font-sans text-amber-700 font-semibold">
                    Please select a customer first.
                  </td>
                </tr>
              ) : latestSales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-2 text-center font-sans text-slate-500 italic">
                    {loading
                      ? `Loading sales history for Item Code [${itemCode}]...`
                      : mode === 'sales'
                      ? 'No previous sales history for this customer.'
                      : `No previous sales transactions found for Item Code [${itemCode}].`}
                  </td>
                </tr>
              ) : (
                latestSales.map((s, idx) => {
                  const isSelectedCustRow =
                    hasSelectedCustomer &&
                    Number(s.customer_account_id) === Number(selectedCustomerId);
                  const isLastSaleForSelectedCust =
                    isSelectedCustRow &&
                    lastCustomerSale &&
                    Number(s.sale_item_id) === Number(lastCustomerSale.sale_item_id) &&
                    String(s.invoice_number) === String(lastCustomerSale.invoice_number);

                  return (
                    <tr
                      key={`${s.sale_id}-${s.sale_item_id || idx}`}
                      data-testid={`compact-sales-history-row-${idx}`}
                      data-highlighted-customer={isLastSaleForSelectedCust ? 'true' : 'false'}
                      className={
                        isLastSaleForSelectedCust
                          ? 'bg-amber-100/90 font-bold text-slate-950'
                          : isSelectedCustRow
                          ? 'bg-emerald-50/70 text-slate-900'
                          : 'hover:bg-slate-50 text-slate-800'
                      }
                    >
                      <td className="px-2 py-0.5 border-r border-slate-200 whitespace-nowrap">
                        {formatAppDate(s.invoice_date)}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 font-bold text-emerald-800 whitespace-nowrap">
                        {s.invoice_number}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 font-sans font-semibold text-slate-800 truncate max-w-[180px]">
                        {s.customer_name || (mode === 'sales' && selectedCustomerName) || 'Walk-in Cash Customer'}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 font-sans truncate max-w-[200px]">
                        {s.item_name || itemName}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 text-right font-bold">
                        {Number(s.quantity || 0)}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 text-right">
                        {Number(s.loose_quantity || 0)}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 text-right font-bold text-emerald-800">
                        Rs. {formatNumber(s.unit_price)}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-200 text-right text-rose-700 whitespace-nowrap">
                        {formatDisc(s.discount_percent, s.discount_amount)}
                      </td>
                      <td className="px-2 py-0.5 text-right font-bold text-slate-900 whitespace-nowrap">
                        Rs. {formatNumber(s.line_total)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <table
            data-testid="compact-history-purchases-table"
            className="w-full text-left border-collapse text-[10.5px]"
          >
            <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-300 font-bold">
              <tr>
                <th className="px-2 py-0.5 border-r border-slate-200">Transaction Date</th>
                <th className="px-2 py-0.5 border-r border-slate-200">Invoice Number</th>
                <th className="px-2 py-0.5 border-r border-slate-200">Supplier</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Quantity</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Bonus</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Rate</th>
                <th className="px-2 py-0.5 border-r border-slate-200 text-right">Discount</th>
                <th className="px-2 py-0.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {latestPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-2 text-center font-sans text-slate-500 italic">
                    {loading
                      ? `Loading purchase history for Item Code [${itemCode}]...`
                      : `No previous purchase transactions found for Item Code [${itemCode}].`}
                  </td>
                </tr>
              ) : (
                latestPurchases.map((p, idx) => (
                  <tr
                    key={`${p.purchase_id}-${p.purchase_item_id || idx}`}
                    data-testid={`compact-purchase-history-row-${idx}`}
                    className="hover:bg-slate-50 text-slate-800"
                  >
                    <td className="px-2 py-0.5 border-r border-slate-200 whitespace-nowrap">
                      {formatAppDate(p.bill_date || p.invoice_date)}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 font-bold text-sky-800 whitespace-nowrap">
                      {p.bill_number || p.invoice_number}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 font-sans truncate max-w-[220px]">
                      {p.supplier_name || 'Supplier'}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 text-right font-bold">
                      {Number(p.quantity || 0)}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 text-right">
                      {Number(p.bonus_quantity || 0)}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 text-right font-bold text-sky-900">
                      Rs. {formatNumber(p.purchase_price)}
                    </td>
                    <td className="px-2 py-0.5 border-r border-slate-200 text-right text-rose-700 whitespace-nowrap">
                      {formatDisc(p.discount_percent, p.discount_amount)}
                    </td>
                    <td className="px-2 py-0.5 text-right font-bold text-slate-900 whitespace-nowrap">
                      Rs. {formatNumber(p.line_total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
