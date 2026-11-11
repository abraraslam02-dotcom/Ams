import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Gift,
  Percent,
  Layers,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Printer,
  FileSpreadsheet,
  Search,
  ShieldAlert,
  Lock,
  Unlock,
  Sliders,
  History,
  Boxes,
  ArrowUpDown,
  Calendar,
  Sparkles,
  Check,
  X,
} from 'lucide-react';

export type OfferWorkspaceSubTab =
  | 'trade-offers'
  | 'party-discounts'
  | 'fifo-batches'
  | 'fifo-movements'
  | 'offer-reports';

interface SlabDefinition {
  min_qty: number;
  max_qty: number;
  discount_percent: number;
  bonus_qty: number;
  fixed_discount: number;
}

const OFFER_REPORTS_LIST = [
  { key: 'active-offers', label: '1. Active Offers Report' },
  { key: 'expired-offers', label: '2. Expired Offers Report' },
  { key: 'item-wise-offer-sales', label: '3. Item-Wise Offer Sales Report' },
  { key: 'company-wise-offer', label: '4. Company-Wise Offer Report' },
  { key: 'bonus-quantity-issued', label: '5. Bonus Quantity Issued Report' },
  { key: 'offer-discount-summary', label: '6. Offer Discount Summary Report' },
  { key: 'party-wise-special-discount', label: '7. Party-Wise Special Discount Report' },
  { key: 'party-item-discount-matrix', label: '8. Party + Item Discount Matrix Report' },
  { key: 'salesman-wise-discount-given', label: '9. Salesman-Wise Discount Given Report' },
  { key: 'town-wise-offer-performance', label: '10. Town-Wise Offer Performance Report' },
  { key: 'net-realization-after-discounts', label: '11. Net Realization After Offers & Discounts' },
] as const;

export const TradeDealsAndPartyDiscountsWorkspace: React.FC<{
  initialTab?: OfferWorkspaceSubTab;
}> = ({ initialTab = 'trade-offers' }) => {
  const [subTab, setSubTab] = useState<OfferWorkspaceSubTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Catalog lists for dropdowns
  const [itemsList, setItemsList] = useState<Array<Record<string, any>>>([]);
  const [partiesList, setPartiesList] = useState<Array<Record<string, any>>>([]);
  const [townsList, setTownsList] = useState<Array<Record<string, any>>>([]);
  const [salesmenList, setSalesmenList] = useState<Array<Record<string, any>>>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  // Trade Offers state
  const [offers, setOffers] = useState<Array<Record<string, any>>>([]);
  const [stackingRule, setStackingRule] = useState<'higher_only' | 'combine_both'>('higher_only');
  const [editingOfferId, setEditingOfferId] = useState<number | null>(null);
  const [offerForm, setOfferForm] = useState({
    offer_name: '',
    offer_type: 'percentage_discount' as
      | 'percentage_discount'
      | 'bonus_quantity'
      | 'fixed_discount'
      | 'slab_offer',
    scope_type: 'selected_items' as 'all_items' | 'selected_items' | 'company',
    company_name: '',
    item_id: 0,
    town_name: '',
    party_account_id: 0,
    salesman_id: 0,
    min_quantity: 10,
    max_quantity: 0,
    discount_percent: 5,
    fixed_discount_amount: 0,
    bonus_quantity: 1,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '2027-12-31',
    status: 'Active',
    remarks: '',
  });
  const [slabs, setSlabs] = useState<SlabDefinition[]>([
    { min_qty: 10, max_qty: 19, discount_percent: 3, bonus_qty: 1, fixed_discount: 0 },
    { min_qty: 20, max_qty: 49, discount_percent: 5, bonus_qty: 3, fixed_discount: 0 },
    { min_qty: 50, max_qty: 9999, discount_percent: 8, bonus_qty: 10, fixed_discount: 0 },
  ]);

  // Party Discounts state
  const [partyDiscounts, setPartyDiscounts] = useState<Array<Record<string, any>>>([]);
  const [partyDiscountHistory, setPartyDiscountHistory] = useState<Array<Record<string, any>>>([]);
  const [editingPartyDiscId, setEditingPartyDiscId] = useState<number | null>(null);
  const [partyDiscForm, setPartyDiscForm] = useState({
    party_account_id: 0,
    scope_type: 'item' as 'item' | 'company' | 'all_items',
    item_id: 0,
    company_name: '',
    discount_percent: 2,
    fixed_discount_amount: 0,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '2027-12-31',
    status: 'Active',
    remarks: '',
  });

  // FIFO Batches & Movements state
  const [fifoBatches, setFifoBatches] = useState<Array<Record<string, any>>>([]);
  const [fifoMovements, setFifoMovements] = useState<Array<Record<string, any>>>([]);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchStatusFilter, setBatchStatusFilter] = useState('ALL');
  const [adjustModalBatch, setAdjustModalBatch] = useState<Record<string, any> | null>(null);
  const [adjustNewPacks, setAdjustNewPacks] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  // Offer Reports state
  const [activeReportKey, setActiveReportKey] = useState<string>('active-offers');
  const [reportRows, setReportRows] = useState<Array<Record<string, any>>>([]);
  const [reportSummary, setReportSummary] = useState<Record<string, any>>({});
  const [reportFilters, setReportFilters] = useState({
    from_date: '',
    to_date: '',
    company_name: '',
    party_account_id: '',
    salesman_id: '',
    town_name: '',
  });
  const [printMode, setPrintMode] = useState<'A4' | 'THERMAL_80' | 'THERMAL_58'>('A4');

  useEffect(() => {
    setSubTab(initialTab);
  }, [initialTab]);

  const loadMasterDropdowns = useCallback(async () => {
    try {
      const [itemsRes, accRes, supMetaRes] = await Promise.all([
        fetch('/api/items?limit=1000').then((r) => r.json()),
        fetch('/api/accounts?limit=1000').then((r) => r.json()),
        fetch('/api/supply/dashboard').then((r) => r.json()),
      ]);
      const rawItems = itemsRes.data || itemsRes.items || [];
      setItemsList(rawItems);
      const compSet = new Set<string>();
      rawItems.forEach((it: any) => {
        if (it.company_name) compSet.add(String(it.company_name).trim());
      });
      setCompaniesList(Array.from(compSet).sort());

      const rawAcc = accRes.data || accRes.accounts || [];
      setPartiesList(
        rawAcc.filter(
          (a: any) =>
            String(a.account_type || '').toLowerCase() === 'customer' ||
            String(a.account_type || '').toLowerCase() === 'party'
        )
      );

      if (supMetaRes) {
        const [tRes, sRes] = await Promise.all([
          fetch('/api/supply/towns').then((r) => r.json()),
          fetch('/api/supply/salesmen').then((r) => r.json()),
        ]);
        setTownsList(tRes.towns || []);
        setSalesmenList(sRes.salesmen || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadOffersAndDiscounts = useCallback(async () => {
    setLoading(true);
    try {
      const [offRes, pdRes, fifoRes, movRes] = await Promise.all([
        fetch('/api/enhancements/offers').then((r) => r.json()),
        fetch('/api/enhancements/party-discounts').then((r) => r.json()),
        fetch('/api/enhancements/fifo/batches').then((r) => r.json()),
        fetch('/api/enhancements/fifo/movements?limit=300').then((r) => r.json()),
      ]);
      if (offRes.success) {
        setOffers(offRes.offers || []);
        if (offRes.discount_stacking_rule) setStackingRule(offRes.discount_stacking_rule);
      }
      if (pdRes.success) {
        setPartyDiscounts(pdRes.discounts || []);
        setPartyDiscountHistory(pdRes.history || []);
      }
      if (fifoRes.success) {
        setFifoBatches(fifoRes.batches || []);
      }
      if (movRes.success) {
        setFifoMovements(movRes.movements || []);
      }
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load data',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOfferReport = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (reportFilters.from_date) qs.set('from_date', reportFilters.from_date);
      if (reportFilters.to_date) qs.set('to_date', reportFilters.to_date);
      if (reportFilters.company_name) qs.set('company_name', reportFilters.company_name);
      if (reportFilters.party_account_id) qs.set('party_account_id', reportFilters.party_account_id);
      if (reportFilters.salesman_id) qs.set('salesman_id', reportFilters.salesman_id);
      if (reportFilters.town_name) qs.set('town_name', reportFilters.town_name);

      const res = await fetch(`/api/enhancements/offer-reports/${activeReportKey}?${qs.toString()}`);
      const data = await res.json();
      if (data.success) {
        setReportRows(data.rows || []);
        setReportSummary(data.summary || {});
      }
    } catch {
      // ignore
    }
  }, [activeReportKey, reportFilters]);

  useEffect(() => {
    loadMasterDropdowns();
    loadOffersAndDiscounts();
  }, [loadMasterDropdowns, loadOffersAndDiscounts]);

  useEffect(() => {
    if (subTab === 'offer-reports') {
      loadOfferReport();
    }
  }, [subTab, loadOfferReport]);

  const handleUpdateStackingRule = async (nextRule: 'higher_only' | 'combine_both') => {
    try {
      const res = await fetch('/api/enhancements/discount-stacking-rule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: nextRule }),
      });
      const data = await res.json();
      if (data.success) {
        setStackingRule(nextRule);
        setBanner({
          type: 'success',
          message: `Discount Stacking Rule updated to: ${
            nextRule === 'combine_both'
              ? 'Combine Both (Offer Discount + Party Discount)'
              : 'Apply Higher Discount Only (Never Stack Silently)'
          }`,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerForm.offer_name.trim()) {
      setBanner({ type: 'error', message: 'Offer Name is required.' });
      return;
    }
    const chosenItem = itemsList.find((i) => Number(i.id) === Number(offerForm.item_id));
    const chosenParty = partiesList.find((p) => Number(p.id) === Number(offerForm.party_account_id));
    const chosenSalesman = salesmenList.find((s) => Number(s.id) === Number(offerForm.salesman_id));

    const payload = {
      ...offerForm,
      item_id: offerForm.scope_type === 'selected_items' && offerForm.item_id ? Number(offerForm.item_id) : null,
      item_code: chosenItem?.item_code || '',
      item_name: chosenItem?.item_name || '',
      company_name:
        offerForm.scope_type === 'company'
          ? offerForm.company_name
          : chosenItem?.company_name || offerForm.company_name,
      party_account_id: offerForm.party_account_id ? Number(offerForm.party_account_id) : null,
      party_name: chosenParty?.account_name || '',
      salesman_id: offerForm.salesman_id ? Number(offerForm.salesman_id) : null,
      salesman_name: chosenSalesman?.name || '',
      slabs_json: offerForm.offer_type === 'slab_offer' ? JSON.stringify(slabs) : '[]',
    };

    try {
      const url = editingOfferId
        ? `/api/enhancements/offers/${editingOfferId}`
        : '/api/enhancements/offers';
      const method = editingOfferId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save offer');
      setBanner({
        type: 'success',
        message: editingOfferId ? 'Trade Offer updated.' : 'New Trade Offer created.',
      });
      setEditingOfferId(null);
      setOfferForm((prev) => ({ ...prev, offer_name: '', remarks: '' }));
      await loadOffersAndDiscounts();
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Error saving offer' });
    }
  };

  const handleDeleteOffer = async (id: number) => {
    try {
      const res = await fetch(`/api/enhancements/offers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setBanner({ type: 'success', message: 'Trade Offer deleted.' });
        await loadOffersAndDiscounts();
      }
    } catch {
      // ignore
    }
  };

  const handleSavePartyDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyDiscForm.party_account_id) {
      setBanner({ type: 'error', message: 'Please select a Party / Customer.' });
      return;
    }
    const chosenParty = partiesList.find((p) => Number(p.id) === Number(partyDiscForm.party_account_id));
    const chosenItem = itemsList.find((i) => Number(i.id) === Number(partyDiscForm.item_id));

    const payload = {
      ...partyDiscForm,
      party_account_id: Number(partyDiscForm.party_account_id),
      party_name: chosenParty?.account_name || '',
      item_id: partyDiscForm.scope_type === 'item' && partyDiscForm.item_id ? Number(partyDiscForm.item_id) : null,
      item_code: chosenItem?.item_code || '',
      item_name: chosenItem?.item_name || '',
      company_name:
        partyDiscForm.scope_type === 'company'
          ? partyDiscForm.company_name
          : chosenItem?.company_name || '',
    };

    try {
      const url = editingPartyDiscId
        ? `/api/enhancements/party-discounts/${editingPartyDiscId}`
        : '/api/enhancements/party-discounts';
      const method = editingPartyDiscId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save party discount');
      setBanner({
        type: 'success',
        message: editingPartyDiscId
          ? 'Party Special Discount updated & logged.'
          : 'Party Special Discount created.',
      });
      setEditingPartyDiscId(null);
      await loadOffersAndDiscounts();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error saving party discount',
      });
    }
  };

  const handleDeletePartyDiscount = async (id: number) => {
    try {
      const res = await fetch(`/api/enhancements/party-discounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setBanner({ type: 'success', message: 'Party Discount rule removed.' });
        await loadOffersAndDiscounts();
      }
    } catch {
      // ignore
    }
  };

  const handleToggleBlockBatch = async (batch: Record<string, any>) => {
    const currentlyBlocked = Number(batch.is_blocked || 0) === 1 || batch.batch_status === 'Blocked';
    try {
      const res = await fetch(`/api/enhancements/fifo/batches/${batch.id}/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_blocked: !currentlyBlocked,
          reason: !currentlyBlocked ? 'Quarantined / Blocked by Admin' : 'Unblocked for FIFO allocation',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBanner({
          type: 'success',
          message: `Batch ${batch.batch_number} (${batch.item_name}) ${
            !currentlyBlocked ? 'Blocked from FIFO dispatch' : 'Unblocked & restored to FIFO queue'
          }.`,
        });
        await loadOffersAndDiscounts();
      }
    } catch {
      // ignore
    }
  };

  const handleSubmitBatchAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalBatch) return;
    try {
      const res = await fetch(`/api/enhancements/fifo/batches/${adjustModalBatch.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_pack_qty: Number(adjustNewPacks),
          reason: adjustReason.trim() || 'Authorized FIFO Batch Stock Adjustment',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to adjust batch');
      setBanner({
        type: 'success',
        message: `Batch ${adjustModalBatch.batch_number} adjusted to ${adjustNewPacks} packs & logged in FIFO Movement Ledger.`,
      });
      setAdjustModalBatch(null);
      await loadOffersAndDiscounts();
    } catch (err: unknown) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Adjustment failed' });
    }
  };

  const handleExportReportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(reportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Offer_Discount_Report');
    XLSX.writeFile(wb, `Abrar_${activeReportKey}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filteredFifoBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return fifoBatches.filter((b) => {
      if (batchStatusFilter !== 'ALL' && String(b.fifo_status || b.batch_status) !== batchStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(b.item_name || '').toLowerCase().includes(q) ||
        String(b.item_code || '').toLowerCase().includes(q) ||
        String(b.batch_number || '').toLowerCase().includes(q) ||
        String(b.company_name || '').toLowerCase().includes(q) ||
        String(b.purchase_invoice_number || '').toLowerCase().includes(q)
      );
    });
  }, [fifoBatches, batchSearch, batchStatusFilter]);

  return (
    <div className="space-y-4">
      {/* Top Sub-Navigation & Stacking Rule Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('trade-offers')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'trade-offers'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Gift className="w-4 h-4 text-amber-500" />
            Trade Deals & Offers ({offers.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('party-discounts')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'party-discounts'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Percent className="w-4 h-4 text-sky-500" />
            Party Special Discounts ({partyDiscounts.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('fifo-batches')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'fifo-batches'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4 text-emerald-500" />
            Batch-Wise FIFO & Expiry ({fifoBatches.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('fifo-movements')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'fifo-movements'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-4 h-4 text-purple-500" />
            FIFO Batch Stock Movements
          </button>

          <button
            type="button"
            onClick={() => setSubTab('offer-reports')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'offer-reports'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-500" />
            Offer, Discount & Bonus Reports (11)
          </button>
        </div>

        {/* Discount Stacking Rule Toggle (Part 6) */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
          <span className="text-[11px] font-bold text-slate-600">Discount Stacking Policy:</span>
          <select
            value={stackingRule}
            onChange={(e) =>
              handleUpdateStackingRule(e.target.value as 'higher_only' | 'combine_both')
            }
            className="text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-lg px-2 py-1"
          >
            <option value="higher_only">Option 2: Apply Higher Discount Only (Default Safe)</option>
            <option value="combine_both">Option 1: Combine Both (Offer % + Party %)</option>
          </select>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between print:hidden ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span className="font-semibold">{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-bold px-2 hover:opacity-75"
          >
            ✕
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 1: TRADE DEALS & OFFERS MANAGEMENT (PART 4)                  */}
      {/* =================================================================== */}
      {subTab === 'trade-offers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form
            onSubmit={handleSaveOffer}
            className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-amber-500" />
                  {editingOfferId ? 'Edit Trade Deal / Offer' : 'Create Trade Deal / Offer'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Supports Percentage Discount, Bonus Schemes (Buy 10 Get 1), Fixed Discount & Multi-Slab Offers
                </p>
              </div>
              {editingOfferId && (
                <button
                  type="button"
                  onClick={() => setEditingOfferId(null)}
                  className="text-xs text-slate-500 hover:text-slate-800 font-bold"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Offer / Scheme Title *
                </label>
                <input
                  type="text"
                  required
                  value={offerForm.offer_name}
                  onChange={(e) => setOfferForm((p) => ({ ...p, offer_name: e.target.value }))}
                  placeholder="e.g. Panadol Winter Trade Scheme 10+1 or GSK 5% Trade Deal"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Offer Type *
                </label>
                <select
                  value={offerForm.offer_type}
                  onChange={(e) =>
                    setOfferForm((p) => ({ ...p, offer_type: e.target.value as any }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  <option value="percentage_discount">1. Percentage Discount (%)</option>
                  <option value="bonus_quantity">2. Bonus Quantity (Buy X Get Y Free)</option>
                  <option value="fixed_discount">3. Fixed Amount Discount (Rs.)</option>
                  <option value="slab_offer">4. Multi-Slab Offer (Quantity Slabs)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Scope *
                </label>
                <select
                  value={offerForm.scope_type}
                  onChange={(e) =>
                    setOfferForm((p) => ({ ...p, scope_type: e.target.value as any }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  <option value="selected_items">Selected Item</option>
                  <option value="company">Entire Company / Manufacturer</option>
                  <option value="all_items">All Items in Store</option>
                </select>
              </div>

              {offerForm.scope_type === 'selected_items' && (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Select Medicine / Item *
                  </label>
                  <select
                    value={offerForm.item_id}
                    onChange={(e) =>
                      setOfferForm((p) => ({ ...p, item_id: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  >
                    <option value={0}>-- Choose Item --</option>
                    {itemsList.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.item_code} — {it.item_name} ({it.company_name || 'General'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {offerForm.scope_type === 'company' && (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Select Pharmaceutical Company *
                  </label>
                  <select
                    value={offerForm.company_name}
                    onChange={(e) =>
                      setOfferForm((p) => ({ ...p, company_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  >
                    <option value="">-- Choose Company --</option>
                    {companiesList.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {offerForm.offer_type !== 'slab_offer' ? (
                <>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Minimum Qualifying Qty
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={offerForm.min_quantity}
                      onChange={(e) =>
                        setOfferForm((p) => ({ ...p, min_quantity: Number(e.target.value) }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>

                  {offerForm.offer_type === 'percentage_discount' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                        Offer Discount %
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={offerForm.discount_percent}
                        onChange={(e) =>
                          setOfferForm((p) => ({
                            ...p,
                            discount_percent: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-emerald-700"
                      />
                    </div>
                  )}

                  {offerForm.offer_type === 'bonus_quantity' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                        Free Bonus Qty (Per Min Qty)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={offerForm.bonus_quantity}
                        onChange={(e) =>
                          setOfferForm((p) => ({ ...p, bonus_quantity: Number(e.target.value) }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-amber-700"
                      />
                    </div>
                  )}

                  {offerForm.offer_type === 'fixed_discount' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                        Fixed Discount Amount (Rs.)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={offerForm.fixed_discount_amount}
                        onChange={(e) =>
                          setOfferForm((p) => ({
                            ...p,
                            fixed_discount_amount: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-sky-700"
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase text-slate-700">
                      Configurable Quantity Slabs
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSlabs((prev) => [
                          ...prev,
                          { min_qty: 100, max_qty: 999, discount_percent: 10, bonus_qty: 0, fixed_discount: 0 },
                        ])
                      }
                      className="text-[11px] font-bold text-emerald-600 hover:underline"
                    >
                      + Add Slab
                    </button>
                  </div>
                  {slabs.map((sl, sIdx) => (
                    <div key={sIdx} className="grid grid-cols-5 gap-1.5 items-center text-[11px]">
                      <input
                        type="number"
                        value={sl.min_qty}
                        onChange={(e) =>
                          setSlabs((prev) =>
                            prev.map((x, i) => (i === sIdx ? { ...x, min_qty: Number(e.target.value) } : x))
                          )
                        }
                        placeholder="Min Qty"
                        className="px-2 py-1 rounded border border-slate-300 bg-white"
                      />
                      <input
                        type="number"
                        value={sl.max_qty}
                        onChange={(e) =>
                          setSlabs((prev) =>
                            prev.map((x, i) => (i === sIdx ? { ...x, max_qty: Number(e.target.value) } : x))
                          )
                        }
                        placeholder="Max Qty"
                        className="px-2 py-1 rounded border border-slate-300 bg-white"
                      />
                      <input
                        type="number"
                        step="0.1"
                        value={sl.discount_percent}
                        onChange={(e) =>
                          setSlabs((prev) =>
                            prev.map((x, i) =>
                              i === sIdx ? { ...x, discount_percent: Number(e.target.value) } : x
                            )
                          )
                        }
                        placeholder="Disc %"
                        className="px-2 py-1 rounded border border-slate-300 bg-white"
                      />
                      <input
                        type="number"
                        value={sl.bonus_qty}
                        onChange={(e) =>
                          setSlabs((prev) =>
                            prev.map((x, i) => (i === sIdx ? { ...x, bonus_qty: Number(e.target.value) } : x))
                          )
                        }
                        placeholder="Bonus"
                        className="px-2 py-1 rounded border border-slate-300 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setSlabs((prev) => prev.filter((_, i) => i !== sIdx))}
                        className="text-rose-500 font-bold text-center"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={offerForm.start_date}
                  onChange={(e) => setOfferForm((p) => ({ ...p, start_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  value={offerForm.end_date}
                  onChange={(e) => setOfferForm((p) => ({ ...p, end_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Optional Town Filter
                </label>
                <select
                  value={offerForm.town_name}
                  onChange={(e) => setOfferForm((p) => ({ ...p, town_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                >
                  <option value="">All Towns</option>
                  {townsList.map((t) => (
                    <option key={t.id} value={t.town_name}>
                      {t.town_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Status
                </label>
                <select
                  value={offerForm.status}
                  onChange={(e) => setOfferForm((p) => ({ ...p, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {editingOfferId ? 'Update Trade Offer' : 'Save Trade Deal / Offer'}
            </button>
          </form>

          {/* Offers Table */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900">
                Configured Trade Deals & Schemes ({offers.length})
              </h3>
              <button
                type="button"
                onClick={loadOffersAndDiscounts}
                className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                    <th className="py-2.5 px-3">Code / Name</th>
                    <th className="py-2.5 px-3">Type & Scope</th>
                    <th className="py-2.5 px-3">Benefit</th>
                    <th className="py-2.5 px-3">Validity</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {offers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No trade deals configured yet. Use the form on the left to create an offer.
                      </td>
                    </tr>
                  ) : (
                    offers.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3">
                          <div className="font-mono text-[10px] text-slate-400">{o.offer_code}</div>
                          <div className="font-bold text-slate-900">{o.offer_name}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-700">{o.offer_type}</div>
                          <div className="text-[11px] text-slate-500">
                            {o.scope_type === 'selected_items'
                              ? `Item: ${o.item_name || o.item_code}`
                              : o.scope_type === 'company'
                              ? `Company: ${o.company_name}`
                              : 'All Items'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                          {o.offer_type === 'percentage_discount' && `Min ${o.min_quantity} → ${o.discount_percent}% Off`}
                          {o.offer_type === 'bonus_quantity' && `Buy ${o.min_quantity} Get +${o.bonus_quantity} Bonus`}
                          {o.offer_type === 'fixed_discount' && `Min ${o.min_quantity} → Rs.${o.fixed_discount_amount} Off`}
                          {o.offer_type === 'slab_offer' && `Multi-Slab Scheme`}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600">
                          {o.start_date} → {o.end_date}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              o.computed_status === 'Active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : o.computed_status === 'Upcoming'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {o.computed_status || o.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingOfferId(o.id);
                              setOfferForm({
                                offer_name: o.offer_name || '',
                                offer_type: o.offer_type || 'percentage_discount',
                                scope_type: o.scope_type || 'selected_items',
                                company_name: o.company_name || '',
                                item_id: Number(o.item_id || 0),
                                town_name: o.town_name || '',
                                party_account_id: Number(o.party_account_id || 0),
                                salesman_id: Number(o.salesman_id || 0),
                                min_quantity: Number(o.min_quantity || 1),
                                max_quantity: Number(o.max_quantity || 0),
                                discount_percent: Number(o.discount_percent || 0),
                                fixed_discount_amount: Number(o.fixed_discount_amount || 0),
                                bonus_quantity: Number(o.bonus_quantity || 0),
                                start_date: o.start_date || '',
                                end_date: o.end_date || '',
                                status: o.status || 'Active',
                                remarks: o.remarks || '',
                              });
                            }}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOffer(o.id)}
                            className="p-1.5 rounded hover:bg-rose-100 text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 2: PARTY-WISE SPECIAL DISCOUNTS (PART 5)                    */}
      {/* =================================================================== */}
      {subTab === 'party-discounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form
            onSubmit={handleSavePartyDiscount}
            className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5"
          >
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
              <Percent className="w-4 h-4 text-sky-500" />
              {editingPartyDiscId
                ? 'Update Party Special Discount'
                : 'Assign Party-Wise Special Discount'}
            </h3>
            <p className="text-[11px] text-slate-500">
              Automatically applies when creating Counter Sales, Supply Invoices, or Salesman Bookings for this Party.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Select Party / Customer *
                </label>
                <select
                  value={partyDiscForm.party_account_id}
                  onChange={(e) =>
                    setPartyDiscForm((p) => ({
                      ...p,
                      party_account_id: Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                >
                  <option value={0}>-- Choose Party Account --</option>
                  {partiesList.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.account_name} ({pt.town || pt.city || 'General'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Discount Scope *
                </label>
                <select
                  value={partyDiscForm.scope_type}
                  onChange={(e) =>
                    setPartyDiscForm((p) => ({ ...p, scope_type: e.target.value as any }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                >
                  <option value="item">Specific Item (e.g. ABC Traders + Panadol = 2%)</option>
                  <option value="company">Specific Company (All Items of Company)</option>
                  <option value="all_items">All Items Purchased by This Party</option>
                </select>
              </div>

              {partyDiscForm.scope_type === 'item' && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Select Item *
                  </label>
                  <select
                    value={partyDiscForm.item_id}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({ ...p, item_id: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  >
                    <option value={0}>-- Choose Medicine / Item --</option>
                    {itemsList.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.item_code} — {it.item_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {partyDiscForm.scope_type === 'company' && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Select Company *
                  </label>
                  <select
                    value={partyDiscForm.company_name}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({ ...p, company_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  >
                    <option value="">-- Choose Company --</option>
                    {companiesList.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Special Discount %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={partyDiscForm.discount_percent}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({
                        ...p,
                        discount_percent: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-sky-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Status
                  </label>
                  <select
                    value={partyDiscForm.status}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({ ...p, status: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={partyDiscForm.start_date}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({ ...p, start_date: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={partyDiscForm.end_date}
                    onChange={(e) =>
                      setPartyDiscForm((p) => ({ ...p, end_date: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {editingPartyDiscId ? 'Update Party Discount' : 'Save Party Special Discount'}
              </button>
            </div>
          </form>

          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Active Party-Wise Special Discounts ({partyDiscounts.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                      <th className="py-2.5 px-3">Party Name</th>
                      <th className="py-2.5 px-3">Scope</th>
                      <th className="py-2.5 px-3">Target Item / Company</th>
                      <th className="py-2.5 px-3 text-center">Special Disc %</th>
                      <th className="py-2.5 px-3">Validity</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {partyDiscounts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          No party special discounts configured yet.
                        </td>
                      </tr>
                    ) : (
                      partyDiscounts.map((pd) => (
                        <tr key={pd.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-bold text-slate-900">{pd.party_name}</td>
                          <td className="py-2.5 px-3 uppercase text-[10px] font-bold text-slate-600">
                            {pd.scope_type}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {pd.scope_type === 'item'
                              ? `${pd.item_name || ''} (${pd.item_code || ''})`
                              : pd.scope_type === 'company'
                              ? pd.company_name
                              : 'All Store Items'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-extrabold text-sky-700">
                            {Number(pd.discount_percent || 0).toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-slate-500">
                            {pd.start_date || '-'} → {pd.end_date || '-'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              {pd.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPartyDiscId(pd.id);
                                setPartyDiscForm({
                                  party_account_id: Number(pd.party_account_id),
                                  scope_type: pd.scope_type || 'item',
                                  item_id: Number(pd.item_id || 0),
                                  company_name: pd.company_name || '',
                                  discount_percent: Number(pd.discount_percent || 0),
                                  fixed_discount_amount: Number(pd.fixed_discount_amount || 0),
                                  start_date: pd.start_date || '',
                                  end_date: pd.end_date || '',
                                  status: pd.status || 'Active',
                                  remarks: pd.remarks || '',
                                });
                              }}
                              className="p-1.5 rounded hover:bg-slate-200 text-slate-600 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePartyDiscount(pd.id)}
                              className="p-1.5 rounded hover:bg-rose-100 text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Party Discount Change History */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Party Discount Audit & Change History ({partyDiscountHistory.length})
                </h4>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                      <th className="py-2 px-3">Timestamp</th>
                      <th className="py-2 px-3">Action</th>
                      <th className="py-2 px-3">Party</th>
                      <th className="py-2 px-3">Target</th>
                      <th className="py-2 px-3">Old % → New %</th>
                      <th className="py-2 px-3">Changed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {partyDiscountHistory.map((h) => (
                      <tr key={h.id}>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                          {h.changed_at}
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-700">{h.action_type}</td>
                        <td className="py-2 px-3">{h.party_name}</td>
                        <td className="py-2 px-3">{h.target_label}</td>
                        <td className="py-2 px-3 font-mono">
                          {Number(h.old_discount_percent || 0)}% →{' '}
                          <strong className="text-emerald-700">
                            {Number(h.new_discount_percent || 0)}%
                          </strong>
                        </td>
                        <td className="py-2 px-3 text-slate-500">{h.changed_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 3: BATCH-WISE FIFO & EXPIRY MANAGEMENT (PART 3)             */}
      {/* =================================================================== */}
      {subTab === 'fifo-batches' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Strict FIFO Batch Queue & Expiry Control Center
              </h3>
              <p className="text-xs text-slate-500">
                Batches are ordered by Oldest Purchase/Receipt Date first (Strict FIFO). Expired and Blocked batches are automatically skipped during Counter Sales and Supply Generation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="Search item, batch #, company, invoice #..."
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs w-64"
              />
              <select
                value={batchStatusFilter}
                onChange={(e) => setBatchStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
              >
                <option value="ALL">All Batch Statuses</option>
                <option value="Active">Active (Eligible FIFO)</option>
                <option value="Near Expiry">Near Expiry (≤90 Days)</option>
                <option value="Expired">Expired (Blocked)</option>
                <option value="Blocked">Manually Blocked</option>
                <option value="Exhausted">Exhausted (0 Stock)</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 uppercase">
                  <th className="py-2.5 px-3">FIFO Queue</th>
                  <th className="py-2.5 px-3">Item Code & Name</th>
                  <th className="py-2.5 px-3">Company</th>
                  <th className="py-2.5 px-3">Batch #</th>
                  <th className="py-2.5 px-3">Purchase Date / Inv #</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3 text-right">Purchase Rate</th>
                  <th className="py-2.5 px-3 text-right">Trade Price</th>
                  <th className="py-2.5 px-3 text-center">Available</th>
                  <th className="py-2.5 px-3 text-center">Reserved</th>
                  <th className="py-2.5 px-3 text-center">Dispatched</th>
                  <th className="py-2.5 px-3">Batch Status</th>
                  <th className="py-2.5 px-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFifoBatches.map((b, idx) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-500">
                      #{b.fifo_rank || idx + 1}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{b.item_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{b.item_code}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{b.company_name || '-'}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                      {b.batch_number}
                    </td>
                    <td className="py-2.5 px-3 text-[11px]">
                      <div className="font-mono text-slate-800">{b.purchase_date || '-'}</div>
                      <div className="text-slate-400">
                        {b.purchase_invoice_number || 'Opening'} • {b.supplier_name || '-'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span
                        className={
                          b.is_expired
                            ? 'text-rose-600 font-extrabold'
                            : b.is_near_expiry
                            ? 'text-amber-600 font-bold'
                            : 'text-slate-700'
                        }
                      >
                        {b.expiry_date || 'N/A'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {Number(b.cost_price || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {Number(b.trade_price || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-extrabold text-emerald-700">
                      {Number(b.current_pack_qty || 0)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-amber-600">
                      {Number(b.reserved_pack_qty || 0)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-sky-700">
                      {Number(b.dispatched_pack_qty || b.sold_qty || 0)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          b.fifo_status === 'Active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.fifo_status === 'Near Expiry'
                            ? 'bg-amber-100 text-amber-800'
                            : b.fifo_status === 'Expired' || b.fifo_status === 'Blocked'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {b.fifo_status || b.batch_status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAdjustModalBatch(b);
                          setAdjustNewPacks(String(b.current_pack_qty || 0));
                          setAdjustReason('');
                        }}
                        className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
                      >
                        Adjust
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleBlockBatch(b)}
                        className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer ${
                          Number(b.is_blocked || 0) === 1
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                        }`}
                      >
                        {Number(b.is_blocked || 0) === 1 ? 'Unblock' : 'Block'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {adjustModalBatch && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <form
                onSubmit={handleSubmitBatchAdjustment}
                className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-5 shadow-2xl space-y-4"
              >
                <h4 className="text-sm font-extrabold text-slate-900">
                  Authorized FIFO Batch Stock Adjustment
                </h4>
                <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-xl">
                  <div>
                    Item: <strong>{adjustModalBatch.item_name}</strong> ({adjustModalBatch.item_code})
                  </div>
                  <div>
                    Batch #: <strong className="font-mono">{adjustModalBatch.batch_number}</strong> •
                    Current Packs: <strong>{adjustModalBatch.current_pack_qty}</strong>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    New Physical Available Pack Quantity *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={adjustNewPacks}
                    onChange={(e) => setAdjustNewPacks(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Adjustment Reason (Recorded in Audit Log) *
                  </label>
                  <input
                    type="text"
                    required
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="e.g. Pre-dispatch physical count verification"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustModalBatch(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                  >
                    Save Adjustment
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 4: FIFO BATCH STOCK MOVEMENTS LEDGER                        */}
      {/* =================================================================== */}
      {subTab === 'fifo-movements' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Chronological Batch-Wise FIFO Stock Movement Ledger ({fifoMovements.length})
              </h3>
              <p className="text-xs text-slate-500">
                Tracks every Purchase Inward, Counter Sale FIFO Outward, Supply Reservation, Dispatch, Salesman Return, and Adjustment.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 uppercase">
                  <th className="py-2.5 px-3">Date / Time</th>
                  <th className="py-2.5 px-3">Movement Type</th>
                  <th className="py-2.5 px-3">Ref #</th>
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-3">Batch # / Expiry</th>
                  <th className="py-2.5 px-3">Party / Salesman</th>
                  <th className="py-2.5 px-3 text-center">Qty Packs</th>
                  <th className="py-2.5 px-3 text-center">Bonus Packs</th>
                  <th className="py-2.5 px-3 text-center">Balance After</th>
                  <th className="py-2.5 px-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fifoMovements.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      No batch movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  fifoMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                        {m.movement_date}
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-800">{m.movement_type}</td>
                      <td className="py-2 px-3 font-mono text-indigo-600">{m.reference_number}</td>
                      <td className="py-2 px-3 font-semibold">{m.item_name}</td>
                      <td className="py-2 px-3 font-mono">
                        {m.batch_number}{' '}
                        <span className="text-[10px] text-slate-400">({m.expiry_date || '-'})</span>
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-600">
                        {m.party_name || '-'}{' '}
                        {m.salesman_name ? `• ${m.salesman_name}` : ''}
                      </td>
                      <td className="py-2 px-3 text-center font-mono font-bold">
                        {Number(m.quantity_packs || 0)}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-amber-600">
                        {Number(m.bonus_packs || 0)}
                      </td>
                      <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">
                        {Number(m.balance_after_packs || 0)}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">{m.remarks || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 5: 11 OFFER, DISCOUNT & BONUS REPORTS (PART 8 & PART 10)    */}
      {/* =================================================================== */}
      {subTab === 'offer-reports' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {OFFER_REPORTS_LIST.map((rep) => (
                  <button
                    key={rep.key}
                    type="button"
                    onClick={() => setActiveReportKey(rep.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                      activeReportKey === rep.key
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {rep.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100">
              <input
                type="date"
                value={reportFilters.from_date}
                onChange={(e) => setReportFilters((p) => ({ ...p, from_date: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="date"
                value={reportFilters.to_date}
                onChange={(e) => setReportFilters((p) => ({ ...p, to_date: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
              <select
                value={reportFilters.company_name}
                onChange={(e) => setReportFilters((p) => ({ ...p, company_name: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              >
                <option value="">All Companies</option>
                {companiesList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={reportFilters.town_name}
                onChange={(e) => setReportFilters((p) => ({ ...p, town_name: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              >
                <option value="">All Towns</option>
                {townsList.map((t) => (
                  <option key={t.id} value={t.town_name}>
                    {t.town_name}
                  </option>
                ))}
              </select>
              <select
                value={ printMode }
                onChange={(e) => setPrintMode(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold"
              >
                <option value="A4">Print Format: A4 Full Page</option>
                <option value="THERMAL_80">Print Format: 80mm Thermal</option>
                <option value="THERMAL_58">Print Format: 58mm Thermal</option>
              </select>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportReportToExcel}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
              </div>
            </div>
          </div>

          {/* Printable Report Canvas */}
          <div
            className={`bg-white rounded-2xl border border-slate-200 p-5 shadow-xs mx-auto ${
              printMode === 'THERMAL_80'
                ? 'max-w-[310px] text-[10px]'
                : printMode === 'THERMAL_58'
                ? 'max-w-[220px] text-[9px]'
                : 'w-full text-xs'
            }`}
          >
            <div className="text-center border-b border-slate-300 pb-3 mb-3">
              <div className="font-extrabold text-sm uppercase tracking-tight">
                ABRAR MEDICAL STORE
              </div>
              <div className="font-bold text-xs text-slate-700">
                {OFFER_REPORTS_LIST.find((r) => r.key === activeReportKey)?.label}
              </div>
              <div className="text-[10px] text-slate-500">
                Generated: {new Date().toLocaleString()}
              </div>
            </div>

            <div className="overflow-x-auto">
              {reportRows.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  No records found for the selected report criteria.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-50 font-bold uppercase text-[10px]">
                      {Object.keys(reportRows[0]).map((col) => (
                        <th key={col} className="py-1.5 px-2">
                          {col.replace(/_/g, ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {reportRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {Object.keys(reportRows[0]).map((col) => (
                          <td key={col} className="py-1.5 px-2">
                            {String(row[col] ?? '-')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
