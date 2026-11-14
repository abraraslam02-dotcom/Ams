import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageSearch, Search, X } from 'lucide-react';
import {
  BaseSearchableItem,
  IndexedItem,
  prepareItemIndex,
  searchItems,
} from '../../utils/itemSearch';
import { formatPKR } from '../../utils/formatters';

export interface ItemListSelectionModalProps<T extends BaseSearchableItem> {
  isOpen: boolean;
  items: T[];
  indexedItems?: IndexedItem<T>[];
  targetRowIndex: number | null;
  targetRowItem?: {
    item_id?: number | null;
    item_code?: string;
    item_name?: string;
  } | null;
  invoiceLabel?: string;
  rateColumnLabel?: string;
  getItemRate: (item: T) => number;
  getItemStock?: (item: T) => number;
  onSelectItem: (item: T) => void;
  onSwitchToAddNewLine?: () => void;
  onClose: () => void;
}

export function ItemListSelectionModal<T extends BaseSearchableItem>({
  isOpen,
  items,
  indexedItems,
  targetRowIndex,
  targetRowItem,
  invoiceLabel = 'Sales Invoice',
  rateColumnLabel = 'Rate',
  getItemRate,
  getItemStock,
  onSelectItem,
  onSwitchToAddNewLine,
  onClose,
}: ItemListSelectionModalProps<T>) {
  const [query, setQuery] = useState<string>('');
  const [highlightIdx, setHighlightIdx] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlightIdx(0);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const effectiveIndexed = useMemo(
    () => indexedItems ?? prepareItemIndex(items),
    [indexedItems, items]
  );

  const results = useMemo(() => {
    const trimmed = query.trim();
    return trimmed ? searchItems(effectiveIndexed, trimmed, 100) : items.slice(0, 100);
  }, [effectiveIndexed, items, query]);

  useEffect(() => {
    if (highlightIdx >= results.length && results.length > 0) {
      setHighlightIdx(0);
    }
  }, [highlightIdx, results.length]);

  if (!isOpen) return null;

  const hasTargetItem = Boolean(targetRowIndex !== null && targetRowItem?.item_id);

  const scrollRowIntoView = (nextIdx: number) => {
    window.setTimeout(() => {
      tableContainerRef.current
        ?.querySelector(`[data-item-list-modal-idx="${nextIdx}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl p-5 text-xs space-y-3 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <PackageSearch className="w-4 h-4 text-emerald-600" />
              <span>Item List</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {targetRowIndex !== null && hasTargetItem
                ? `Select an item to update Row #${targetRowIndex + 1} ([${targetRowItem?.item_code || ''}] ${targetRowItem?.item_name || ''}).`
                : targetRowIndex !== null
                ? `Select an item to place into Row #${targetRowIndex + 1}.`
                : `Select an item to add to the ${invoiceLabel}.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasTargetItem && onSwitchToAddNewLine && (
              <button
                type="button"
                onClick={onSwitchToAddNewLine}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] cursor-pointer"
              >
                Switch to Add New Line
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              aria-label="Close Item List"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((prev) => {
                  const next = Math.min(Math.max(0, results.length - 1), prev + 1);
                  scrollRowIntoView(next);
                  return next;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((prev) => {
                  const next = Math.max(0, prev - 1);
                  scrollRowIntoView(next);
                  return next;
                });
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const chosen = results[highlightIdx] || results[0];
                if (chosen) onSelectItem(chosen);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Filter Item List by Item Code, Item Name, Company, or Barcode... (↑/↓ Navigate, Enter Select, Esc Close)"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
          />
        </div>

        <div
          ref={tableContainerRef}
          className="flex-1 min-h-0 overflow-y-auto border border-slate-200 rounded-xl"
        >
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="bg-slate-900 text-white sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Item Name</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Packing</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">{rateColumnLabel}</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-semibold">
                    No matching items found.
                  </td>
                </tr>
              ) : (
                results.map((it, idx) => {
                  const rate = getItemRate(it);
                  const stockPacks = getItemStock
                    ? getItemStock(it)
                    : Number(it.total_available_packs ?? it.default_batch?.available_packs ?? 0);
                  const isHighlighted = idx === highlightIdx;
                  return (
                    <tr
                      key={it.id}
                      data-item-list-modal-idx={idx}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => onSelectItem(it)}
                      className={`cursor-pointer transition-colors ${
                        isHighlighted ? 'bg-emerald-100 font-semibold' : 'hover:bg-emerald-50/60'
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-bold text-emerald-700">
                        {it.item_code}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{it.item_name}</td>
                      <td className="px-3 py-2 text-slate-600">{it.company_name || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{it.packing || '1x1'}</td>
                      <td className="px-3 py-2 text-right font-mono">{stockPacks}P</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {formatPKR(rate)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectItem(it);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
