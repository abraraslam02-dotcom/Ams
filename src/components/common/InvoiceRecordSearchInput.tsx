import React, { useState, useMemo, useEffect } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

export interface InvoiceSearchableItem {
  rowIndex?: number;
  itemId?: number | null;
  item_id?: number | null;
  itemCode?: string;
  item_code?: string;
  itemName?: string;
  item_name?: string;
  barcode?: string;
}

/**
 * Pure helper: finds row indices of populated items currently in the invoice
 * matching by Item Name, Item Code, or Barcode (case-insensitive).
 * Never mutates or modifies any invoice rows.
 */
export function findMatchingInvoiceRowIndices(
  items: InvoiceSearchableItem[],
  query: string
): number[] {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return [];

  const matches: number[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const row = items[idx];
    const resolvedItemId = row.itemId ?? row.item_id ?? null;
    if (!resolvedItemId || Number(resolvedItemId) <= 0) continue;
    const resolvedName = String(row.itemName ?? row.item_name ?? '').toLowerCase();
    const resolvedCode = String(row.itemCode ?? row.item_code ?? '').toLowerCase();
    const resolvedBarcode = String(row.barcode || '').toLowerCase();
    if (
      resolvedName.includes(clean) ||
      resolvedCode.includes(clean) ||
      resolvedBarcode.includes(clean)
    ) {
      matches.push(typeof row.rowIndex === 'number' ? row.rowIndex : idx);
    }
  }
  return matches;
}

interface InvoiceRecordSearchInputProps {
  items: InvoiceSearchableItem[];
  onPreviewMatch?: (rowIndex: number | null) => void;
  onNavigateToMatch: (rowIndex: number) => void;
  onMatchesChange?: (matchedIndices: number[], activeMatchRowIndex: number | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * MS Access-style Record Navigator Search Box.
 * Positioned alongside the bottom Record Navigation controls (|◀ ◀ [1 of N] ▶ ▶| * New).
 * Strictly read-only navigation across existing items on the current invoice:
 * never modifies, deletes, replaces, or overwrites any invoice item.
 */
export const InvoiceRecordSearchInput: React.FC<InvoiceRecordSearchInputProps> = ({
  items,
  onPreviewMatch,
  onNavigateToMatch,
  onMatchesChange,
  placeholder = 'Search invoice item (Name / Code / Barcode)...',
  className = '',
}) => {
  const [query, setQuery] = useState<string>('');
  const [activeMatchPos, setActiveMatchPos] = useState<number>(0);

  const matchedRowIndices = useMemo(
    () => findMatchingInvoiceRowIndices(items, query),
    [items, query]
  );

  const hasQuery = query.trim().length > 0;
  const clampedPos =
    matchedRowIndices.length > 0
      ? Math.max(0, Math.min(activeMatchPos, matchedRowIndices.length - 1))
      : 0;
  const activeMatchRowIndex =
    hasQuery && matchedRowIndices.length > 0 ? matchedRowIndices[clampedPos] : null;

  useEffect(() => {
    setActiveMatchPos(0);
  }, [query]);

  useEffect(() => {
    onMatchesChange?.(hasQuery ? matchedRowIndices : [], activeMatchRowIndex);
    if (hasQuery && activeMatchRowIndex !== null) {
      onPreviewMatch?.(activeMatchRowIndex);
    } else if (!hasQuery) {
      onPreviewMatch?.(null);
    }
  }, [hasQuery, matchedRowIndices, activeMatchRowIndex]);

  const stepMatch = (delta: number) => {
    if (matchedRowIndices.length === 0) return;
    const nextPos =
      (clampedPos + delta + matchedRowIndices.length) % matchedRowIndices.length;
    setActiveMatchPos(nextPos);
    const targetRow = matchedRowIndices[nextPos];
    if (targetRow !== undefined) {
      onPreviewMatch?.(targetRow);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      stepMatch(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      stepMatch(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (activeMatchRowIndex !== null) {
        onNavigateToMatch(activeMatchRowIndex);
      }
    } else if (e.key === 'Escape') {
      if (hasQuery) {
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
      }
    }
  };

  return (
    <div
      className={`ams-access-record-search flex items-center gap-1 bg-white border border-slate-400 rounded-md px-1.5 py-0 shadow-2xs shrink-0 whitespace-nowrap ${
        hasQuery && matchedRowIndices.length === 0
          ? 'border-rose-400 bg-rose-50/60'
          : hasQuery && matchedRowIndices.length > 0
          ? 'border-emerald-600 ring-1 ring-emerald-500/30'
          : 'focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-500/30'
      } ${className}`}
    >
      <Search className="w-3 h-3 text-slate-500 shrink-0" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Search item in current invoice"
        title="Search existing items in this invoice by Item Name, Code, or Barcode (Up/Down to cycle, Enter to select row)"
        className="w-44 sm:w-56 bg-transparent text-[11px] font-medium text-slate-900 placeholder-slate-400 outline-none leading-none"
      />
      {hasQuery && (
        <div className="flex items-center gap-0.5 shrink-0">
          <span
            className={`px-1 text-[10px] font-mono font-bold tabular-nums ${
              matchedRowIndices.length > 0 ? 'text-emerald-800' : 'text-rose-700'
            }`}
          >
            {matchedRowIndices.length > 0
              ? `${clampedPos + 1}/${matchedRowIndices.length}`
              : '0 match'}
          </span>
          {matchedRowIndices.length > 1 && (
            <>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => stepMatch(-1)}
                title="Previous match (Arrow Up)"
                className="p-0.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => stepMatch(1)}
                title="Next match (Arrow Down)"
                className="p-0.5 rounded hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setQuery('')}
            title="Clear invoice search"
            className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
