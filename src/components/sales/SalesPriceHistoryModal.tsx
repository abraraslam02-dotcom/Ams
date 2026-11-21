import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { api } from '../../services/api';
import { SalesPriceHistoryEntry } from '../../types/sales';
import { formatPKR, formatAppDate } from '../../utils/formatters';

export interface SalesPriceHistoryModalProps {
  isOpen: boolean;
  itemId: number | null;
  itemCode?: string;
  itemName?: string;
  customerId: number;
  customerName?: string;
  onSelectPrice: (price: number, entry: SalesPriceHistoryEntry) => void;
  onClose: () => void;
}

export const SalesPriceHistoryModal: React.FC<SalesPriceHistoryModalProps> = ({
  isOpen,
  itemId,
  itemCode,
  itemName,
  customerId,
  customerName,
  onSelectPrice,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<SalesPriceHistoryEntry[]>([]);
  const [resolvedCustomerName, setResolvedCustomerName] = useState<string>(
    customerName || 'Walk-in Cash Customer'
  );
  const [resolvedItemName, setResolvedItemName] = useState<string>(itemName || '');
  const [resolvedItemCode, setResolvedItemCode] = useState<string>(itemCode || '');
  const [highlightIdx, setHighlightIdx] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);

  const loadPriceHistory = async () => {
    if (!isOpen || !itemId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSalesPriceHistory(itemId, customerId);
      const list = Array.isArray(res.records) ? [...res.records] : [];
      list.sort((a, b) => {
        const dCmp = String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''));
        if (dCmp !== 0) return dCmp;
        const invCmp = String(b.invoice_number || '').localeCompare(
          String(a.invoice_number || ''),
          undefined,
          { numeric: true }
        );
        if (invCmp !== 0) return invCmp;
        return Number(b.sale_id || 0) - Number(a.sale_id || 0);
      });
      setRecords(list);
      setResolvedCustomerName(res.customerName || customerName || 'Walk-in Cash Customer');
      setResolvedItemCode(res.itemCode || itemCode || '');
      setResolvedItemName(res.itemName || itemName || '');
      setHighlightIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales price history.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setResolvedCustomerName(customerName || 'Walk-in Cash Customer');
    setResolvedItemCode(itemCode || '');
    setResolvedItemName(itemName || '');
    setHighlightIdx(0);
    loadPriceHistory();

    const timer = window.setTimeout(() => {
      containerRef.current?.focus();
    }, 15);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, itemId, customerId]);

  useEffect(() => {
    if (!isOpen || records.length === 0) return;
    const rowEl = tableWrapperRef.current?.querySelector(
      `[data-price-hist-idx="${highlightIdx}"]`
    ) as HTMLElement | null;
    rowEl?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, isOpen, records.length]);

  const sortedRecords = useMemo(() => records, [records]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (sortedRecords.length > 0) {
        setHighlightIdx((prev) => Math.min(sortedRecords.length - 1, prev + 1));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (sortedRecords.length > 0) {
        setHighlightIdx((prev) => Math.max(0, prev - 1));
      }
      return;
    }

    if (e.key === 'Home' && sortedRecords.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIdx(0);
      return;
    }

    if (e.key === 'End' && sortedRecords.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIdx(sortedRecords.length - 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const chosen = sortedRecords[highlightIdx];
      if (chosen) {
        onSelectPrice(Number(chosen.unit_price || 0), chosen);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-950/60 flex items-center justify-center p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Sales Price History"
        className="w-full max-w-4xl bg-white border-2 border-slate-700 shadow-2xl rounded-lg overflow-hidden flex flex-col max-h-[82vh] outline-none text-xs"
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-3 py-2 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-bold text-xs tracking-wide uppercase flex items-center gap-2">
                <span>Customer Sales Price History</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-800/80 text-emerald-200 font-mono text-[10px]">
                  {sortedRecords.length} {sortedRecords.length === 1 ? 'Record' : 'Records'}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                Customer:{' '}
                <strong className="text-amber-300">{resolvedCustomerName}</strong>
                {' • '}Item:{' '}
                <strong className="text-white">
                  {resolvedItemCode ? `[${resolvedItemCode}] ` : ''}
                  {resolvedItemName}
                </strong>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={loadPriceHistory}
              disabled={loading}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-semibold text-slate-100 flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Refresh Price History"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close (Esc)</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={tableWrapperRef} className="flex-1 overflow-auto bg-white">
          {loading ? (
            <div className="py-10 text-center text-slate-500 font-medium">
              Loading customer sales price history...
            </div>
          ) : error ? (
            <div className="py-8 px-4 text-center text-rose-700 font-semibold">{error}</div>
          ) : sortedRecords.length === 0 ? (
            <div className="py-12 px-4 text-center text-slate-600 font-semibold text-xs">
              No previous sales history found for this customer and item.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-slate-200 text-slate-800 sticky top-0 z-10 border-b border-slate-400">
                <tr>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Invoice Date
                  </th>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 whitespace-nowrap font-bold">
                    Invoice Number
                  </th>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 font-bold">
                    Item Name
                  </th>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Quantity
                  </th>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold bg-emerald-100/70 text-emerald-950">
                    Sale Price
                  </th>
                  <th className="px-2.5 py-1.5 border-r border-slate-300 text-right whitespace-nowrap font-bold">
                    Discount
                  </th>
                  <th className="px-2.5 py-1.5 text-right whitespace-nowrap font-bold">
                    Net Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((entry, idx) => {
                  const isHighlighted = idx === highlightIdx;
                  return (
                    <tr
                      key={`${entry.sale_id}_${entry.sale_item_id}_${idx}`}
                      data-price-hist-idx={idx}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => setHighlightIdx(idx)}
                      onDoubleClick={() => onSelectPrice(Number(entry.unit_price || 0), entry)}
                      className={`border-b border-slate-200 cursor-pointer transition-colors ${
                        isHighlighted
                          ? 'bg-sky-700 text-white font-semibold'
                          : idx % 2 === 0
                          ? 'bg-white hover:bg-sky-100 text-slate-900'
                          : 'bg-slate-50/70 hover:bg-sky-100 text-slate-900'
                      }`}
                    >
                      <td className="px-2.5 py-1.5 border-r border-slate-200 font-mono whitespace-nowrap">
                        {formatAppDate(entry.invoice_date)}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 border-r border-slate-200 font-mono font-bold whitespace-nowrap ${
                          isHighlighted ? 'text-amber-200' : 'text-slate-900'
                        }`}
                      >
                        {entry.invoice_number}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 border-r border-slate-200 ${
                          isHighlighted ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {entry.item_name}
                      </td>
                      <td className="px-2.5 py-1.5 border-r border-slate-200 text-right font-mono whitespace-nowrap">
                        {entry.quantity}
                        {Number(entry.loose_quantity || 0) > 0 ? ` (+${entry.loose_quantity}L)` : ''}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 border-r border-slate-200 text-right font-mono font-black whitespace-nowrap ${
                          isHighlighted
                            ? 'text-amber-200 bg-sky-800/70'
                            : 'text-emerald-800 bg-emerald-50/50'
                        }`}
                      >
                        {formatPKR(entry.unit_price)}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 border-r border-slate-200 text-right font-mono whitespace-nowrap ${
                          isHighlighted ? 'text-rose-200' : 'text-rose-700'
                        }`}
                      >
                        {Number(entry.discount_percent || 0)}%
                        {Number(entry.discount_amount || 0) > 0
                          ? ` (${formatPKR(entry.discount_amount)})`
                          : ''}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 text-right font-mono font-bold whitespace-nowrap ${
                          isHighlighted ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {formatPKR(entry.line_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 border-t border-slate-300 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-700 shrink-0">
          <div className="flex items-center gap-3 font-medium">
            <span>
              <strong className="font-mono text-slate-900">↑ / ↓</strong> Navigate
            </span>
            <span>
              <strong className="font-mono text-slate-900">Enter</strong> Select Sale Price (updates Price only)
            </span>
            <span>
              <strong className="font-mono text-slate-900">Esc</strong> Return to Price field
            </span>
          </div>
          {sortedRecords.length > 0 && sortedRecords[highlightIdx] && (
            <button
              type="button"
              onClick={() =>
                onSelectPrice(
                  Number(sortedRecords[highlightIdx].unit_price || 0),
                  sortedRecords[highlightIdx]
                )
              }
              className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] cursor-pointer"
            >
              Use Selected Price ({formatPKR(sortedRecords[highlightIdx].unit_price)})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
