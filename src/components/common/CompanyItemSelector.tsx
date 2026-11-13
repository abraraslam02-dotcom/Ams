import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Package,
  Search,
  Plus,
  X,
  RotateCcw,
  CheckSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../../services/api';
import { ReportMetaCompany, ReportMetaItem } from '../../types/inventory';

export interface CompanyItemSelectorProps {
  selectedCompanies: string[];
  onChangeCompanies: (companies: string[]) => void;
  selectedItemIds: number[];
  onChangeItemIds: (itemIds: number[]) => void;
  selectedItemGroup?: string;
  onChangeItemGroup?: (group: string) => void;
  onMetaLoaded?: (meta: {
    companies: ReportMetaCompany[];
    itemGroups: string[];
    items: ReportMetaItem[];
  }) => void;
  theme?: 'dark' | 'light';
  defaultExpanded?: boolean;
  title?: string;
}

export const CompanyItemSelector: React.FC<CompanyItemSelectorProps> = ({
  selectedCompanies,
  onChangeCompanies,
  selectedItemIds,
  onChangeItemIds,
  selectedItemGroup,
  onChangeItemGroup,
  onMetaLoaded,
  theme = 'dark',
  defaultExpanded = true,
  title = 'Company & Item Multi-Selection Filter',
}) => {
  const [companies, setCompanies] = useState<ReportMetaCompany[]>([]);
  const [itemGroups, setItemGroups] = useState<string[]>([]);
  const [items, setItems] = useState<ReportMetaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  const [companySearch, setCompanySearch] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .getInventoryCompaniesItemsMeta()
      .then((res) => {
        if (!mounted) return;
        setCompanies(res.companies || []);
        setItemGroups(res.itemGroups || []);
        setItems(res.items || []);
        onMetaLoaded?.({
          companies: res.companies || [],
          itemGroups: res.itemGroups || [],
          items: res.items || [],
        });
      })
      .catch(() => {
        // fail gracefully
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedCompanySet = useMemo(() => new Set(selectedCompanies), [selectedCompanies]);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  const itemMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const filteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    return companies.filter((c) => !q || c.company_name.toLowerCase().includes(q));
  }, [companies, companySearch]);

  // Available items: scoped to selectedCompanies when companies are selected (or all active items if no company selected),
  // AND filtered by itemGroup and itemSearch. Selecting a company does NOT force its items into selectedItemIds!
  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return items.filter((it) => {
      if (selectedCompanySet.size > 0 && !selectedCompanySet.has(it.company_name)) {
        return false;
      }
      if (
        selectedItemGroup &&
        selectedItemGroup !== 'ALL' &&
        it.item_group !== selectedItemGroup
      ) {
        return false;
      }
      if (!q) return true;
      return (
        it.item_name.toLowerCase().includes(q) ||
        it.item_code.toLowerCase().includes(q) ||
        it.company_name.toLowerCase().includes(q) ||
        it.item_group.toLowerCase().includes(q)
      );
    });
  }, [items, selectedCompanySet, selectedItemGroup, itemSearch]);

  const selectedItemsList = useMemo(
    () =>
      selectedItemIds
        .map((id) => itemMap.get(id))
        .filter((it): it is ReportMetaItem => Boolean(it)),
    [selectedItemIds, itemMap]
  );

  // Rule 1 & 4 & 9: Add single company without forcing all its items, prevent duplicates
  const handleAddCompany = (companyName: string) => {
    if (selectedCompanySet.has(companyName)) return;
    onChangeCompanies([...selectedCompanies, companyName]);
  };

  // Rule 6: Removing a company must remove its associated selected items
  const handleRemoveCompany = (companyName: string) => {
    onChangeCompanies(selectedCompanies.filter((c) => c !== companyName));
    const remainingIds = selectedItemIds.filter((id) => {
      const it = itemMap.get(id);
      return it ? it.company_name !== companyName : true;
    });
    if (remainingIds.length !== selectedItemIds.length) {
      onChangeItemIds(remainingIds);
    }
  };

  const handleAddAllCompanies = () => {
    const all = Array.from(new Set(companies.map((c) => c.company_name)));
    onChangeCompanies(all);
  };

  const handleRemoveAllCompanies = () => {
    onChangeCompanies([]);
    onChangeItemIds([]);
  };

  // Rule 2 & 3 & 9: Add individual item (auto-tracks its company in selectedCompanies if not present? Only if user wants, or keep explicit)
  // Actually keep selectedCompanies explicit or ensure item's company is represented safely only if companies already selected
  const handleAddItem = (item: ReportMetaItem) => {
    if (selectedItemIdSet.has(item.id)) return;
    if (selectedCompanies.length > 0 && !selectedCompanySet.has(item.company_name)) {
      onChangeCompanies([...selectedCompanies, item.company_name]);
    }
    onChangeItemIds([...selectedItemIds, item.id]);
  };

  const handleRemoveItem = (itemId: number) => {
    onChangeItemIds(selectedItemIds.filter((id) => id !== itemId));
  };

  // Rule 5: Add All Items for an individual company
  const handleAddAllItemsForCompany = (companyName: string) => {
    if (!selectedCompanySet.has(companyName)) {
      onChangeCompanies([...selectedCompanies, companyName]);
    }
    const companyItemIds = items
      .filter((it) => {
        if (it.company_name !== companyName) return false;
        if (
          selectedItemGroup &&
          selectedItemGroup !== 'ALL' &&
          it.item_group !== selectedItemGroup
        ) {
          return false;
        }
        return true;
      })
      .map((it) => it.id);
    const merged = Array.from(new Set([...selectedItemIds, ...companyItemIds]));
    onChangeItemIds(merged);
  };

  // Add All visible/filtered items
  const handleAddAllItems = () => {
    const ids = filteredItems.map((it) => it.id);
    const merged = Array.from(new Set([...selectedItemIds, ...ids]));
    onChangeItemIds(merged);
  };

  // Rule 7: Removing all items must NOT remove selected companies
  const handleRemoveAllItems = () => {
    onChangeItemIds([]);
  };

  // Rule 8: Reset Selection clears both companies & items (& itemGroup if provided)
  const handleResetSelection = () => {
    onChangeCompanies([]);
    onChangeItemIds([]);
    if (onChangeItemGroup) onChangeItemGroup('ALL');
    setCompanySearch('');
    setItemSearch('');
  };

  const isDark = theme === 'dark';
  const boxCls = isDark
    ? 'bg-slate-900 border border-slate-800 text-slate-200'
    : 'bg-slate-50 border border-slate-200 text-slate-800';
  const subBoxCls = isDark
    ? 'bg-slate-950 border border-slate-800'
    : 'bg-white border border-slate-200';
  const inputCls = isDark
    ? 'bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500'
    : 'bg-white border border-slate-300 text-slate-800 placeholder-slate-400';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`${boxCls} rounded-lg p-3 space-y-2.5 text-xs print:hidden`}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 font-bold text-left cursor-pointer"
        >
          <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{title}</span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono ${
              isDark ? 'bg-slate-800 text-emerald-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {selectedCompanies.length === 0 ? 'All Companies' : `${selectedCompanies.length} Co.`}
            {' | '}
            {selectedItemIds.length === 0 ? 'All Items' : `${selectedItemIds.length} Items`}
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 opacity-70" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {onChangeItemGroup && (
            <select
              value={selectedItemGroup || 'ALL'}
              onChange={(e) => onChangeItemGroup(e.target.value)}
              className={`px-2 py-1 rounded text-[11px] font-semibold ${inputCls}`}
            >
              <option value="ALL">All Item Groups</option>
              {itemGroups.map((grp) => (
                <option key={grp} value={grp}>
                  Group: {grp}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleResetSelection}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Selection</span>
          </button>
        </div>
      </div>

      {/* Selected Summary Strip (Always visible before generating report) */}
      {(selectedCompanies.length > 0 || selectedItemsList.length > 0) && (
        <div className={`${subBoxCls} rounded p-2 space-y-1.5`}>
          {selectedCompanies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className={`text-[10px] font-bold uppercase mr-1 ${mutedText}`}>
                Selected Companies ({selectedCompanies.length}):
              </span>
              {selectedCompanies.map((comp) => (
                <span
                  key={comp}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    isDark
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      : 'bg-sky-50 text-sky-800 border border-sky-200'
                  }`}
                >
                  <span>{comp}</span>
                  <button
                    type="button"
                    title={`Add all items of ${comp}`}
                    onClick={() => handleAddAllItemsForCompany(comp)}
                    className="px-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-[9px] font-bold cursor-pointer"
                  >
                    +All Items
                  </button>
                  <button
                    type="button"
                    title={`Remove company ${comp}`}
                    onClick={() => handleRemoveCompany(comp)}
                    className="hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {selectedItemsList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className={`text-[10px] font-bold uppercase mr-1 ${mutedText}`}>
                Selected Items ({selectedItemsList.length}):
              </span>
              {selectedItemsList.slice(0, 24).map((it) => (
                <span
                  key={it.id}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    isDark
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  <span className="font-mono text-[9px] opacity-75">{it.item_code}</span>
                  <span>{it.item_name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(it.id)}
                    className="hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {selectedItemsList.length > 24 && (
                <span className={`text-[10px] font-mono px-1.5 ${mutedText}`}>
                  +{selectedItemsList.length - 24} more selected
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dual Selection Panels */}
      {expanded && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Panel 1: Companies */}
          <div className={`${subBoxCls} rounded-lg p-2.5 space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide">
                <Building2 className="w-3.5 h-3.5 text-sky-400" />
                <span>1. Select Companies ({companies.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddAllCompanies}
                  disabled={loading || companies.length === 0}
                  className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
                >
                  Add All
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAllCompanies}
                  disabled={selectedCompanies.length === 0}
                  className="px-2 py-0.5 rounded bg-rose-700/80 hover:bg-rose-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
                >
                  Remove All
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2 ${mutedText}`} />
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Search company name..."
                className={`w-full pl-8 pr-2.5 py-1 rounded text-[11px] focus:outline-hidden focus:border-sky-500 ${inputCls}`}
              />
            </div>

            <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/40 pr-1">
              {loading ? (
                <div className={`py-4 text-center text-[11px] ${mutedText}`}>Loading companies...</div>
              ) : filteredCompanies.length === 0 ? (
                <div className={`py-4 text-center text-[11px] ${mutedText}`}>No companies match search</div>
              ) : (
                filteredCompanies.map((c) => {
                  const isSelected = selectedCompanySet.has(c.company_name);
                  return (
                    <div
                      key={c.company_name}
                      className="py-1 px-1.5 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold truncate block">{c.company_name}</span>
                        <span className={`text-[10px] font-mono ${mutedText}`}>
                          {c.item_count} active items
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAddAllItemsForCompany(c.company_name)}
                          className="px-1.5 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white text-[10px] font-semibold cursor-pointer"
                          title="Add all items belonging to this company"
                        >
                          + All Items
                        </button>
                        {isSelected ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveCompany(c.company_name)}
                            className="px-2 py-0.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddCompany(c.company_name)}
                            className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold cursor-pointer inline-flex items-center gap-0.5"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Panel 2: Individual Items */}
          <div className={`${subBoxCls} rounded-lg p-2.5 space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide">
                <Package className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  2. Select Individual Items ({filteredItems.length})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddAllItems}
                  disabled={loading || filteredItems.length === 0}
                  className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
                >
                  Add All
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAllItems}
                  disabled={selectedItemIds.length === 0}
                  className="px-2 py-0.5 rounded bg-rose-700/80 hover:bg-rose-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
                >
                  Remove All
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2 ${mutedText}`} />
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search item code, name, company or group..."
                className={`w-full pl-8 pr-2.5 py-1 rounded text-[11px] focus:outline-hidden focus:border-emerald-500 ${inputCls}`}
              />
            </div>

            <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/40 pr-1">
              {loading ? (
                <div className={`py-4 text-center text-[11px] ${mutedText}`}>Loading items...</div>
              ) : filteredItems.length === 0 ? (
                <div className={`py-4 text-center text-[11px] ${mutedText}`}>
                  No items match current company/group/search filter
                </div>
              ) : (
                filteredItems.map((it) => {
                  const isAdded = selectedItemIdSet.has(it.id);
                  return (
                    <div
                      key={it.id}
                      className="py-1 px-1.5 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          <span className="font-mono text-emerald-500 mr-1">{it.item_code}</span>
                          {it.item_name}
                        </div>
                        <div className={`text-[10px] truncate ${mutedText}`}>
                          {it.company_name} • {it.item_group} • {it.packing}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isAdded ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(it.id)}
                            className="px-2 py-0.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddItem(it)}
                            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer inline-flex items-center gap-0.5"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
