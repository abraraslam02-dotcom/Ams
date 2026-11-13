import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Package,
  Users,
  MapPin,
  Search,
  Plus,
  X,
  RotateCcw,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';
import { ReportMetaCompany, ReportMetaItem } from '../../types/inventory';

export interface ReportMetaParty {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  town_name: string;
  area_name: string;
}

interface TownWithAreas {
  id: number;
  town_name: string;
  areas: Array<{ id: number; town_id: number; area_name: string }>;
}

export interface CompanyItemSelectorProps {
  selectedCompanies: string[];
  onChangeCompanies: (companies: string[]) => void;
  selectedItemIds: number[];
  onChangeItemIds: (itemIds: number[]) => void;
  selectedItemGroup?: string;
  onChangeItemGroup?: (group: string) => void;
  enablePartySelection?: boolean;
  selectedPartyIds?: number[];
  onChangePartyIds?: (partyIds: number[]) => void;
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
  enablePartySelection = false,
  selectedPartyIds = [],
  onChangePartyIds,
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

  // Party Selection state (used exclusively when enablePartySelection is true)
  const [partyExpanded, setPartyExpanded] = useState<boolean>(false);
  const [parties, setParties] = useState<ReportMetaParty[]>([]);
  const [townsMeta, setTownsMeta] = useState<TownWithAreas[]>([]);
  const [loadingParties, setLoadingParties] = useState<boolean>(false);
  const [partySearch, setPartySearch] = useState<string>('');
  const [partyTypeFilter, setPartyTypeFilter] = useState<string>('ALL');
  const [partyTownFilter, setPartyTownFilter] = useState<string>('ALL');
  const [partyAreaFilter, setPartyAreaFilter] = useState<string>('ALL');
  const [checkedRemovalPartyIds, setCheckedRemovalPartyIds] = useState<number[]>([]);

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

  useEffect(() => {
    if (!enablePartySelection) {
      setPartyExpanded(false);
      return;
    }
    let mounted = true;
    setLoadingParties(true);
    Promise.allSettled([
      api.getAccounts({ mainGroup: 'PARTY ACCOUNTS', status: 'Active' }),
      api.getSupplyTowns(),
    ])
      .then(([accRes, townRes]) => {
        if (!mounted) return;
        if (accRes.status === 'fulfilled') {
          const rawList = Array.isArray(accRes.value?.accounts) ? accRes.value.accounts : [];
          const normalized: ReportMetaParty[] = rawList.map((a: any) => {
            const rawType = String(a.account_type || a.account_group || 'Customer').trim();
            const town = String(a.town_name || a.city || '').trim() || '—';
            const area = String(a.area_name || '').trim() || '—';
            return {
              id: Number(a.id),
              account_code: String(a.account_code || `ID-${a.id}`).trim(),
              account_name: String(a.account_name || '').trim(),
              account_type: rawType,
              town_name: town,
              area_name: area,
            };
          });
          setParties(normalized);
        }
        if (townRes.status === 'fulfilled') {
          const tList = Array.isArray(townRes.value?.towns) ? townRes.value.towns : [];
          setTownsMeta(
            tList.map((t: any) => ({
              id: Number(t.id),
              town_name: String(t.town_name || '').trim(),
              areas: Array.isArray(t.areas) ? t.areas : [],
            }))
          );
        }
      })
      .finally(() => {
        if (mounted) setLoadingParties(false);
      });

    return () => {
      mounted = false;
    };
  }, [enablePartySelection]);

  // Keep checkedRemovalPartyIds pruned to currently selectedPartyIds
  useEffect(() => {
    const selectedSet = new Set(selectedPartyIds);
    setCheckedRemovalPartyIds((prev) => {
      const next = prev.filter((id) => selectedSet.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedPartyIds]);

  const selectedCompanySet = useMemo(() => new Set(selectedCompanies), [selectedCompanies]);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedPartyIdSet = useMemo(() => new Set(selectedPartyIds), [selectedPartyIds]);
  const checkedRemovalSet = useMemo(
    () => new Set(checkedRemovalPartyIds),
    [checkedRemovalPartyIds]
  );

  const itemMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const partyMap = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);

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

  const selectedPartiesList = useMemo(
    () =>
      selectedPartyIds
        .map((id) => partyMap.get(id))
        .filter((p): p is ReportMetaParty => Boolean(p)),
    [selectedPartyIds, partyMap]
  );

  // Available Towns for Party Selection (combines Town Master + distinct towns on parties)
  const partyTownOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of townsMeta) {
      if (t.town_name && !seen.has(t.town_name)) {
        seen.add(t.town_name);
        out.push(t.town_name);
      }
    }
    for (const p of parties) {
      if (p.town_name && p.town_name !== '—' && !seen.has(p.town_name)) {
        seen.add(p.town_name);
        out.push(p.town_name);
      }
    }
    return out.sort();
  }, [townsMeta, parties]);

  // Dependent Area options for Party Selection
  const partyAreaOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    if (partyTownFilter === 'ALL') {
      for (const t of townsMeta) {
        for (const a of t.areas) {
          const n = String(a.area_name || '').trim();
          if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
          }
        }
      }
      for (const p of parties) {
        if (p.area_name && p.area_name !== '—' && !seen.has(p.area_name)) {
          seen.add(p.area_name);
          out.push(p.area_name);
        }
      }
    } else {
      const matchedTown = townsMeta.find(
        (t) => t.town_name.toLowerCase() === partyTownFilter.toLowerCase()
      );
      if (matchedTown) {
        for (const a of matchedTown.areas) {
          const n = String(a.area_name || '').trim();
          if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
          }
        }
      }
      for (const p of parties) {
        if (
          p.town_name.toLowerCase() === partyTownFilter.toLowerCase() &&
          p.area_name &&
          p.area_name !== '—' &&
          !seen.has(p.area_name)
        ) {
          seen.add(p.area_name);
          out.push(p.area_name);
        }
      }
    }
    return out.sort();
  }, [townsMeta, parties, partyTownFilter]);

  // Filtered parties combining Search (Party Name or Account Code), Customer/Supplier, Town, and Area
  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    return parties.filter((p) => {
      if (partyTypeFilter !== 'ALL') {
        const pType = p.account_type.toLowerCase();
        if (partyTypeFilter === 'Customer') {
          if (pType !== 'customer' && pType !== 'customer & supplier') return false;
        } else if (partyTypeFilter === 'Supplier') {
          if (pType !== 'supplier' && pType !== 'customer & supplier') return false;
        } else if (partyTypeFilter === 'Customer & Supplier') {
          if (pType !== 'customer & supplier') return false;
        }
      }
      if (
        partyTownFilter !== 'ALL' &&
        p.town_name.toLowerCase() !== partyTownFilter.toLowerCase()
      ) {
        return false;
      }
      if (
        partyAreaFilter !== 'ALL' &&
        p.area_name.toLowerCase() !== partyAreaFilter.toLowerCase()
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.account_name.toLowerCase().includes(q) ||
        p.account_code.toLowerCase().includes(q)
      );
    });
  }, [parties, partySearch, partyTypeFilter, partyTownFilter, partyAreaFilter]);

  const filteredSelectedPartyIds = useMemo(
    () => filteredParties.filter((p) => selectedPartyIdSet.has(p.id)).map((p) => p.id),
    [filteredParties, selectedPartyIdSet]
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

  // Party Selection Handlers
  const handleToggleParty = (partyId: number) => {
    if (!onChangePartyIds) return;
    if (selectedPartyIdSet.has(partyId)) {
      onChangePartyIds(selectedPartyIds.filter((id) => id !== partyId));
    } else {
      onChangePartyIds([...selectedPartyIds, partyId]);
    }
  };

  const handleSelectAllParties = () => {
    if (!onChangePartyIds) return;
    const idsToAdd = filteredParties.map((p) => p.id);
    const merged = Array.from(new Set([...selectedPartyIds, ...idsToAdd]));
    onChangePartyIds(merged);
  };

  const handleSelectByTown = () => {
    if (!onChangePartyIds || partyTownFilter === 'ALL') return;
    const idsToAdd = parties
      .filter((p) => {
        if (p.town_name.toLowerCase() !== partyTownFilter.toLowerCase()) return false;
        if (partyTypeFilter !== 'ALL') {
          const pType = p.account_type.toLowerCase();
          if (partyTypeFilter === 'Customer' && pType !== 'customer' && pType !== 'customer & supplier') {
            return false;
          }
          if (partyTypeFilter === 'Supplier' && pType !== 'supplier' && pType !== 'customer & supplier') {
            return false;
          }
          if (partyTypeFilter === 'Customer & Supplier' && pType !== 'customer & supplier') {
            return false;
          }
        }
        return true;
      })
      .map((p) => p.id);
    const merged = Array.from(new Set([...selectedPartyIds, ...idsToAdd]));
    onChangePartyIds(merged);
  };

  const handleSelectByArea = () => {
    if (!onChangePartyIds || partyAreaFilter === 'ALL') return;
    const idsToAdd = parties
      .filter((p) => {
        if (
          partyTownFilter !== 'ALL' &&
          p.town_name.toLowerCase() !== partyTownFilter.toLowerCase()
        ) {
          return false;
        }
        if (p.area_name.toLowerCase() !== partyAreaFilter.toLowerCase()) return false;
        if (partyTypeFilter !== 'ALL') {
          const pType = p.account_type.toLowerCase();
          if (partyTypeFilter === 'Customer' && pType !== 'customer' && pType !== 'customer & supplier') {
            return false;
          }
          if (partyTypeFilter === 'Supplier' && pType !== 'supplier' && pType !== 'customer & supplier') {
            return false;
          }
          if (partyTypeFilter === 'Customer & Supplier' && pType !== 'customer & supplier') {
            return false;
          }
        }
        return true;
      })
      .map((p) => p.id);
    const merged = Array.from(new Set([...selectedPartyIds, ...idsToAdd]));
    onChangePartyIds(merged);
  };

  const handleToggleRemovalMark = (partyId: number) => {
    setCheckedRemovalPartyIds((prev) =>
      prev.includes(partyId) ? prev.filter((id) => id !== partyId) : [...prev, partyId]
    );
  };

  const handleRemoveSelectedParties = () => {
    if (!onChangePartyIds) return;
    if (checkedRemovalPartyIds.length > 0) {
      const toRemove = new Set(checkedRemovalPartyIds);
      onChangePartyIds(selectedPartyIds.filter((id) => !toRemove.has(id)));
      setCheckedRemovalPartyIds([]);
      return;
    }
    if (filteredSelectedPartyIds.length > 0) {
      const toRemove = new Set(filteredSelectedPartyIds);
      onChangePartyIds(selectedPartyIds.filter((id) => !toRemove.has(id)));
    }
  };

  const handleRemoveAllParties = () => {
    if (!onChangePartyIds) return;
    onChangePartyIds([]);
    setCheckedRemovalPartyIds([]);
  };

  // Rule 8: Reset Selection clears companies, items, itemGroup, and parties (if enabled)
  const handleResetSelection = () => {
    onChangeCompanies([]);
    onChangeItemIds([]);
    if (onChangeItemGroup) onChangeItemGroup('ALL');
    setCompanySearch('');
    setItemSearch('');
    if (enablePartySelection && onChangePartyIds) {
      onChangePartyIds([]);
      setPartySearch('');
      setPartyTypeFilter('ALL');
      setPartyTownFilter('ALL');
      setPartyAreaFilter('ALL');
      setCheckedRemovalPartyIds([]);
    }
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

  const removeSelectedCount =
    checkedRemovalPartyIds.length > 0
      ? checkedRemovalPartyIds.length
      : filteredSelectedPartyIds.length;

  return (
    <div className={`${boxCls} rounded-lg p-3 space-y-2.5 text-xs print:hidden`}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {enablePartySelection ? (
            <>
              {/* Item Selection Button */}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-left cursor-pointer transition-colors border ${
                  expanded
                    ? isDark
                      ? 'bg-emerald-950/70 border-emerald-600 text-emerald-200'
                      : 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                    : isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
                }`}
              >
                <Package className="w-4 h-4 shrink-0" />
                <span>Item Selection</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    expanded
                      ? 'bg-white/20 text-white'
                      : isDark
                      ? 'bg-slate-900 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {selectedCompanies.length === 0 ? 'All Companies' : `${selectedCompanies.length} Co.`}
                  {' | '}
                  {selectedItemIds.length === 0 ? 'All Items' : `${selectedItemIds.length} Items`}
                </span>
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5 opacity-80" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                )}
              </button>

              {/* Party Selection Button alongside Item Selection */}
              <button
                type="button"
                onClick={() => setPartyExpanded((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-left cursor-pointer transition-colors border ${
                  partyExpanded
                    ? isDark
                      ? 'bg-indigo-950/70 border-indigo-500 text-indigo-200'
                      : 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                    : isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Party Selection</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    partyExpanded
                      ? 'bg-white/20 text-white'
                      : isDark
                      ? 'bg-slate-900 text-indigo-300'
                      : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  }`}
                >
                  {selectedPartyIds.length === 0
                    ? 'All Eligible Parties'
                    : `${selectedPartyIds.length} Selected`}
                </span>
                {partyExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 opacity-80" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-2 font-bold text-left cursor-pointer"
            >
              <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{title}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  isDark
                    ? 'bg-slate-800 text-emerald-300'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
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
          )}
        </div>

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
      {(selectedCompanies.length > 0 ||
        selectedItemsList.length > 0 ||
        (enablePartySelection && selectedPartiesList.length > 0)) && (
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

          {enablePartySelection && selectedPartiesList.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
              <div className="flex flex-wrap items-center gap-1">
                <span className={`text-[10px] font-bold uppercase mr-1 ${mutedText}`}>
                  Selected Parties ({selectedPartiesList.length}):
                </span>
                {selectedPartiesList.slice(0, 24).map((p) => {
                  const isMarkedForRemoval = checkedRemovalSet.has(p.id);
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isMarkedForRemoval
                          ? 'bg-rose-50 text-rose-800 border border-rose-300'
                          : isDark
                          ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                          : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isMarkedForRemoval}
                        onChange={() => handleToggleRemovalMark(p.id)}
                        title="Check to remove with 'Remove Selected'"
                        className="w-3 h-3 accent-rose-600 cursor-pointer"
                      />
                      <span className="font-mono text-[9px] font-bold opacity-80">
                        {p.account_code}
                      </span>
                      <span className="font-semibold">{p.account_name}</span>
                      <span className="text-[9px] opacity-70">
                        ({p.account_type}
                        {p.town_name !== '—' ? ` • ${p.town_name}` : ''})
                      </span>
                      <button
                        type="button"
                        title={`Remove ${p.account_name}`}
                        onClick={() => handleToggleParty(p.id)}
                        className="hover:text-rose-500 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
                {selectedPartiesList.length > 24 && (
                  <span className={`text-[10px] font-mono px-1.5 ${mutedText}`}>
                    +{selectedPartiesList.length - 24} more selected
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleRemoveSelectedParties}
                  disabled={removeSelectedCount === 0}
                  className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40 inline-flex items-center gap-1"
                  title="Remove checked or currently filtered selected parties"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  <span>Remove Selected ({removeSelectedCount})</span>
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAllParties}
                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer"
                >
                  Remove All
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dual Selection Panels: Company & Item Selection */}
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

      {/* Party Selection Panel (Exclusively enabled for Item Sales Report) */}
      {enablePartySelection && partyExpanded && (
        <div className={`${subBoxCls} rounded-lg p-3 space-y-2.5`}>
          {/* Party Panel Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide">
              <Users className="w-3.5 h-3.5 text-indigo-500" />
              <span>
                Select Parties — Showing {filteredParties.length} of {parties.length} Parties (
                {selectedPartyIds.length} Selected)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleSelectAllParties}
                disabled={loadingParties || filteredParties.length === 0}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
              >
                Select All ({filteredParties.length})
              </button>
              <button
                type="button"
                onClick={handleRemoveSelectedParties}
                disabled={selectedPartyIds.length === 0 || removeSelectedCount === 0}
                className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
                title="Remove checked parties in Selected Parties bar or currently filtered selected parties"
              >
                Remove Selected ({removeSelectedCount})
              </button>
              <button
                type="button"
                onClick={handleRemoveAllParties}
                disabled={selectedPartyIds.length === 0}
                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40"
              >
                Remove All
              </button>
            </div>
          </div>

          {/* Multi-Criteria Filter Controls: Search, Customer/Supplier, Town, Area */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {/* 1. Search by Party Name or Account Code */}
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2 ${mutedText}`} />
              <input
                type="text"
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                placeholder="Search by Party Name or Account Code..."
                className={`w-full pl-8 pr-2.5 py-1.5 rounded text-[11px] focus:outline-hidden focus:border-indigo-500 ${inputCls}`}
              />
            </div>

            {/* 2. Filter by Customer / Supplier */}
            <div>
              <select
                value={partyTypeFilter}
                onChange={(e) => setPartyTypeFilter(e.target.value)}
                className={`w-full px-2.5 py-1.5 rounded text-[11px] font-semibold ${inputCls}`}
              >
                <option value="ALL">All Account Types (Customer / Supplier)</option>
                <option value="Customer">Customer</option>
                <option value="Supplier">Supplier</option>
                <option value="Customer & Supplier">Customer & Supplier</option>
              </select>
            </div>

            {/* 3. Select by Town */}
            <div className="flex items-center gap-1">
              <select
                value={partyTownFilter}
                onChange={(e) => {
                  setPartyTownFilter(e.target.value);
                  setPartyAreaFilter('ALL');
                }}
                className={`w-full px-2.5 py-1.5 rounded text-[11px] font-semibold ${inputCls}`}
              >
                <option value="ALL">Select / Filter by Town (All Towns)</option>
                {partyTownOptions.map((t) => (
                  <option key={t} value={t}>
                    Town: {t}
                  </option>
                ))}
              </select>
              {partyTownFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={handleSelectByTown}
                  className="px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold shrink-0 cursor-pointer inline-flex items-center gap-0.5"
                  title={`Add all parties in ${partyTownFilter} to selection`}
                >
                  <MapPin className="w-3 h-3" />
                  <span>+Select Town</span>
                </button>
              )}
            </div>

            {/* 4. Select by Area */}
            <div className="flex items-center gap-1">
              <select
                value={partyAreaFilter}
                onChange={(e) => setPartyAreaFilter(e.target.value)}
                className={`w-full px-2.5 py-1.5 rounded text-[11px] font-semibold ${inputCls}`}
              >
                <option value="ALL">Select / Filter by Area (All Areas)</option>
                {partyAreaOptions.map((a) => (
                  <option key={a} value={a}>
                    Area: {a}
                  </option>
                ))}
              </select>
              {partyAreaFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={handleSelectByArea}
                  className="px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold shrink-0 cursor-pointer inline-flex items-center gap-0.5"
                  title={`Add all parties in ${partyAreaFilter} to selection`}
                >
                  <MapPin className="w-3 h-3" />
                  <span>+Select Area</span>
                </button>
              )}
            </div>
          </div>

          {/* Parties Table: Account Code, Party Name, Account Type, Town, Area */}
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200 uppercase text-[10px] font-bold">
                <tr>
                  <th className="p-2 w-8 text-center">Sel</th>
                  <th className="p-2">Account Code</th>
                  <th className="p-2">Party Name</th>
                  <th className="p-2">Account Type</th>
                  <th className="p-2">Town</th>
                  <th className="p-2">Area</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {loadingParties ? (
                  <tr>
                    <td colSpan={7} className={`p-4 text-center ${mutedText}`}>
                      Loading parties...
                    </td>
                  </tr>
                ) : filteredParties.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`p-4 text-center ${mutedText}`}>
                      No parties match current search, account type, town, or area filter
                    </td>
                  </tr>
                ) : (
                  filteredParties.map((p) => {
                    const isSelected = selectedPartyIdSet.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => handleToggleParty(p.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-50/80 hover:bg-indigo-100/70'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td
                          className="p-2 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleParty(p.id)}
                            className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="p-2 font-mono font-bold text-indigo-700">
                          {p.account_code}
                        </td>
                        <td className="p-2 font-semibold text-slate-900">{p.account_name}</td>
                        <td className="p-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              p.account_type === 'Customer'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : p.account_type === 'Supplier'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-sky-50 text-sky-700 border border-sky-200'
                            }`}
                          >
                            {p.account_type}
                          </span>
                        </td>
                        <td className="p-2 text-slate-700">{p.town_name}</td>
                        <td className="p-2 text-slate-600">{p.area_name}</td>
                        <td
                          className="p-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isSelected ? (
                            <button
                              type="button"
                              onClick={() => handleToggleParty(p.id)}
                              className="px-2 py-0.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleParty(p.id)}
                              className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer inline-flex items-center gap-0.5"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
