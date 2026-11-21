import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Package, ChevronDown, Check, Edit3, PlusCircle, X } from 'lucide-react';
import { api } from '../../services/api';
import { Item } from '../../types/item';
import { formatTaxDisplay } from '../../utils/taxCalculation';

interface ItemNameSelectProps {
  value: string;
  onChange: (name: string) => void;
  onSelectExistingItem: (item: Item) => void;
  selectedExistingItemId?: number | null;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

export const ItemNameSelect: React.FC<ItemNameSelectProps> = ({
  value,
  onChange,
  onSelectExistingItem,
  selectedExistingItemId = null,
  placeholder = 'Search existing item or type new item name...',
  className = '',
  required = false,
}) => {
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState(value || '');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);

  // Sync external value into input when editing or switching selected item
  useEffect(() => {
    setSearchText(value || '');
  }, [value]);

  // Fetch registered items once when component mounts
  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      try {
        setLoadingItems(true);
        const res = await api.getItems();
        if (active && Array.isArray(res.items)) {
          setItems(res.items);
        }
      } catch {
        // Non-fatal: user can still type a new item name
      } finally {
        if (active) setLoadingItems(false);
      }
    };
    loadItems();
    return () => {
      active = false;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const trimmedQuery = searchText.trim();

  const filteredItems = useMemo(() => {
    if (!trimmedQuery) {
      return items.slice(0, 80);
    }
    const tokens = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const qLower = trimmedQuery.toLowerCase();

    const matched = items.filter((it) => {
      const hay = `${it.item_name || ''} ${it.item_code || ''} ${it.company_name || ''} ${it.generic_name || ''} ${it.barcode || ''} ${it.packing || ''}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });

    matched.sort((a, b) => {
      const aName = (a.item_name || '').toLowerCase();
      const bName = (b.item_name || '').toLowerCase();
      const aExact = aName === qLower || (a.item_code || '').toLowerCase() === qLower ? 0 : 1;
      const bExact = bName === qLower || (b.item_code || '').toLowerCase() === qLower ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStarts = aName.startsWith(qLower) ? 0 : 1;
      const bStarts = bName.startsWith(qLower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aName.localeCompare(bName);
    });

    return matched.slice(0, 80);
  }, [items, trimmedQuery]);

  const exactMatchItem = useMemo(() => {
    if (!trimmedQuery) return null;
    const qLower = trimmedQuery.toLowerCase();
    return items.find((it) => (it.item_name || '').trim().toLowerCase() === qLower) || null;
  }, [items, trimmedQuery]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [trimmedQuery, filteredItems.length]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-item-idx="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectItem = (item: Item) => {
    setSearchText(item.item_name);
    setIsOpen(false);
    onSelectExistingItem(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else if (filteredItems.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else if (filteredItems.length > 0) {
        setHighlightedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      }
    } else if (e.key === 'Enter') {
      if (isOpen && filteredItems.length > 0 && highlightedIndex >= 0 && highlightedIndex < filteredItems.length) {
        e.preventDefault();
        handleSelectItem(filteredItems[highlightedIndex]);
      } else if (isOpen) {
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    } else if (e.key === 'Tab') {
      if (isOpen) {
        setIsOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          required={required}
          autoComplete="off"
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={(e) => {
            const val = e.target.value;
            setSearchText(val);
            onChange(val);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-3 pr-14 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {searchText && (
            <button
              type="button"
              tabIndex={-1}
              title="Clear item name"
              onClick={() => {
                setSearchText('');
                onChange('');
                setIsOpen(true);
                inputRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            title="Toggle registered items dropdown"
            onClick={() => {
              setIsOpen((prev) => !prev);
              inputRef.current?.focus();
            }}
            className="p-1 text-slate-400 hover:text-emerald-600 rounded cursor-pointer"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180 text-emerald-600' : ''}`}
            />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Package className="w-3 h-3 text-emerald-600" />
              <span>
                Registered Items ({filteredItems.length}
                {items.length > filteredItems.length ? ` of ${items.length}` : ''})
              </span>
            </span>
            <span className="normal-case font-normal text-slate-400">
              Select to edit • Type new to register
            </span>
          </div>

          <div ref={listRef} className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {loadingItems ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">
                Loading registered items...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-3 py-4 text-center space-y-1">
                <div className="text-xs font-semibold text-slate-600">
                  No existing item matches "{trimmedQuery}"
                </div>
                <div className="text-[11px] text-emerald-700 flex items-center justify-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Press Save to register as a new item</span>
                </div>
              </div>
            ) : (
              filteredItems.map((it, idx) => {
                const isHighlighted = idx === highlightedIndex;
                const isSelected = selectedExistingItemId !== null && it.id === selectedExistingItemId;
                const taxLabel = formatTaxDisplay(it.tax_type, it.tax_value, it.tax_percent);
                return (
                  <button
                    key={it.id}
                    type="button"
                    data-item-idx={idx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectItem(it);
                    }}
                    onMouseMove={(e) => {
                      const prev = lastPointerPosRef.current;
                      if (!prev || prev.x !== e.clientX || prev.y !== e.clientY) {
                        lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
                        if (highlightedIndex !== idx) setHighlightedIndex(idx);
                      }
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-emerald-50 text-emerald-950'
                        : isSelected
                          ? 'bg-blue-50/70 text-slate-900'
                          : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                          {it.item_code}
                        </span>
                        <span className="text-xs font-bold truncate">{it.item_name}</span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded shrink-0">
                            <Check className="w-2.5 h-2.5" />
                            Loaded
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">
                        {it.company_name}
                        {it.generic_name ? ` • ${it.generic_name}` : ''}
                        {it.packing ? ` • Pack: ${it.packing}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="text-[11px] font-mono font-bold text-emerald-700">
                        Rs. {Number(it.retail_price || 0).toFixed(2)}
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500">
                        <span>Tax: {taxLabel}</span>
                        <Edit3 className="w-2.5 h-2.5 text-emerald-600" />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {exactMatchItem && selectedExistingItemId !== exactMatchItem.id && (
            <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 flex items-center justify-between gap-2 text-[11px] text-amber-900">
              <span>
                <strong>"{exactMatchItem.item_name}"</strong> already exists ({exactMatchItem.item_code}).
              </span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectItem(exactMatchItem);
                }}
                className="px-2 py-0.5 rounded bg-amber-600 text-white font-bold text-[10px] hover:bg-amber-700 cursor-pointer shrink-0"
              >
                Load Existing Item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
