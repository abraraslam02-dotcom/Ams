import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Search, X } from 'lucide-react';
import { ItemVariant } from '../../types/item';
import { formatPKR } from '../../utils/formatters';
import { ProductThumb } from './ProductThumb';

interface VariantPickerModalProps {
  isOpen: boolean;
  parentItem: {
    id: number;
    item_code: string;
    item_name: string;
    company_name?: string;
    packing?: string;
    thumbnail_url?: string | null;
    image_url?: string | null;
  } | null;
  variants: ItemVariant[];
  mode?: 'sales' | 'purchase';
  onSelectVariant: (variant: ItemVariant) => void;
  onClose: () => void;
}

export const VariantPickerModal: React.FC<VariantPickerModalProps> = ({
  isOpen,
  parentItem,
  variants,
  mode = 'sales',
  onSelectVariant,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeVariants = useMemo(
    () => (variants || []).filter((v) => String(v.status || 'Active') !== 'Inactive'),
    [variants]
  );

  const filteredVariants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeVariants;
    return activeVariants.filter((v) => {
      const hay = [
        v.variant_code,
        v.variant_name,
        v.colour,
        v.flavour,
        v.variant_type,
        v.other_attributes,
        v.barcode,
        ...(Array.isArray(v.barcodes) ? v.barcodes.map((b) => b.barcode) : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [activeVariants, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlightIdx(0);
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen, parentItem?.id]);

  useEffect(() => {
    if (highlightIdx >= filteredVariants.length && filteredVariants.length > 0) {
      setHighlightIdx(0);
    }
  }, [filteredVariants.length, highlightIdx]);

  if (!isOpen || !parentItem) return null;

  const scrollIntoView = (idx: number) => {
    window.setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-variant-idx="${idx}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIdx((prev) => {
        const next = Math.min(Math.max(0, filteredVariants.length - 1), prev + 1);
        scrollIntoView(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIdx((prev) => {
        const next = Math.max(0, prev - 1);
        scrollIntoView(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const chosen = filteredVariants[highlightIdx] || filteredVariants[0];
      if (chosen) onSelectVariant(chosen);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[82vh]">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <ProductThumb
              src={parentItem.thumbnail_url || parentItem.image_url}
              fullSrc={parentItem.image_url}
              alt={parentItem.item_name}
              size="sm"
              className="border-slate-700 bg-slate-800"
            />
            <div className="min-w-0">
              <div className="text-sm font-bold flex items-center gap-2 truncate">
                <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">{parentItem.item_name}</span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                Main Code: {parentItem.item_code}
                {parentItem.company_name ? ` • ${parentItem.company_name}` : ''}
                {parentItem.packing ? ` • ${parentItem.packing}` : ''}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="relative">
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
              placeholder="Select Colour / Flavour / Type / Variant Code or Barcode... (↑/↓ Enter, Esc)"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
            />
          </div>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
          {filteredVariants.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 font-medium">
              No active variants match your search.
            </div>
          ) : (
            filteredVariants.map((v, idx) => {
              const isHighlighted = idx === highlightIdx;
              const stockPacks = Number(v.current_stock_packs ?? 0);
              const price =
                mode === 'purchase'
                  ? Number(v.effective_purchase_price ?? v.purchase_price ?? 0)
                  : Number(v.effective_retail_price ?? v.retail_price ?? 0);
              const thumb =
                v.effective_thumbnail_url ||
                v.effective_image_url ||
                v.thumbnail_url ||
                v.image_url ||
                parentItem.thumbnail_url ||
                parentItem.image_url;
              const fullImg =
                v.effective_image_url ||
                v.image_url ||
                parentItem.image_url ||
                thumb;

              const attrTags = [
                v.colour ? `Colour: ${v.colour}` : '',
                v.flavour ? `Flavour: ${v.flavour}` : '',
                v.variant_type ? `Type: ${v.variant_type}` : '',
                v.other_attributes || '',
              ].filter(Boolean);

              return (
                <div
                  key={v.id}
                  data-variant-idx={idx}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => onSelectVariant(v)}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isHighlighted ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ProductThumb
                      src={thumb}
                      fullSrc={fullImg}
                      alt={`${parentItem.item_name} - ${v.variant_name}`}
                      size="md"
                      enableZoom
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {v.variant_code}
                        </span>
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {v.variant_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                        {attrTags.length > 0 && <span>{attrTags.join(' • ')}</span>}
                        {v.barcode && (
                          <span className="font-mono text-slate-600">BC: {v.barcode}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-right">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Stock</div>
                      <div
                        className={`text-xs font-mono font-bold ${
                          stockPacks <= 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {stockPacks}P
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400">
                        {mode === 'purchase' ? 'Pur. Rate' : 'MRP'}
                      </div>
                      <div className="text-xs font-mono font-extrabold text-slate-900">
                        {formatPKR(price)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectVariant(v);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                        isHighlighted
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-900 text-white hover:bg-emerald-600'
                      }`}
                    >
                      Select
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
