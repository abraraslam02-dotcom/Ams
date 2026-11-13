import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  Search,
  RefreshCw,
  Download,
  AlertTriangle,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { StockLedgerEntry, ReportMetaItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export const StockLedgerView: React.FC = () => {
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const ledgerPrintRef = useRef<HTMLDivElement>(null);

  // Item catalog for selector
  const [itemsList, setItemsList] = useState<ReportMetaItem[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [batchNumberFilter, setBatchNumberFilter] = useState<string>('');

  // Date filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Summary
  const [summary, setSummary] = useState({
    opening_pack_balance: 0,
    total_in_packs: 0,
    total_out_packs: 0,
    net_change_packs: 0,
    closing_pack_balance: 0,
  });

  const loadItems = useCallback(async () => {
    try {
      const res = await api.getInventoryCompaniesItemsMeta();
      const items = res.items || [];
      setItemsList(items);
      if (items.length > 0 && !selectedItemId) {
        setSelectedItemId(String(items[0].id));
      }
    } catch {
      // ignore fallback
    }
  }, [selectedItemId]);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.getStockLedger({
        item_id: selectedItemId ? Number(selectedItemId) : undefined,
        batch_number: batchNumberFilter.trim() || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      })) as any;
      setLedger(res.ledger || []);
      setSummary({
        opening_pack_balance: Number(res.summary?.opening_pack_balance || 0),
        total_in_packs: Number(res.summary?.total_in_packs || 0),
        total_out_packs: Number(res.summary?.total_out_packs || 0),
        net_change_packs: Number(res.summary?.net_change_packs || 0),
        closing_pack_balance: Number(res.summary?.closing_pack_balance || 0),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch item log / stock ledger');
    } finally {
      setLoading(false);
    }
  }, [selectedItemId, batchNumberFilter, fromDate, toDate]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const filteredItems = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    if (!q) return itemsList;
    return itemsList.filter(
      (it) =>
        it.item_name.toLowerCase().includes(q) ||
        it.item_code.toLowerCase().includes(q) ||
        it.company_name.toLowerCase().includes(q)
    );
  }, [itemsList, itemSearchQuery]);

  const selectedItemObj = useMemo(() => {
    return itemsList.find((i) => i.id === Number(selectedItemId));
  }, [itemsList, selectedItemId]);

  const exportToExcel = () => {
    const rows: Array<Record<string, string | number>> = [];

    if (fromDate) {
      rows.push({
        Date: fromDate,
        'Transaction Type': 'OPENING BALANCE (PRIOR TO PERIOD)',
        'Invoice / Voucher #': 'B/F',
        'Party Name': '—',
        Company: selectedItemObj?.company_name || '—',
        'Item Group': selectedItemObj?.item_group || '—',
        'Opening Stock': summary.opening_pack_balance,
        Purchase: 0,
        'Purchase Bonus': 0,
        'Purchase Return': 0,
        Sale: 0,
        'Sale Return': 0,
        'Transfer In': 0,
        'Transfer Out': 0,
        Rate: 0,
        Discount: 0,
        Debit: 0,
        Credit: 0,
        'Running Stock Balance': summary.opening_pack_balance,
        'Batch Number': '—',
      });
    }

    for (const entry of ledger) {
      rows.push({
        Date: entry.date,
        'Transaction Type': entry.type_label,
        'Invoice / Voucher #': entry.ref_no,
        'Party Name': entry.party_name || '—',
        Company: entry.company_name || selectedItemObj?.company_name || '—',
        'Item Group': entry.item_group || selectedItemObj?.item_group || '—',
        'Opening Stock': entry.opening_packs || 0,
        Purchase: entry.purchase_packs || 0,
        'Purchase Bonus': entry.purchase_bonus_packs || 0,
        'Purchase Return': entry.purchase_return_packs || 0,
        Sale: entry.sale_packs || 0,
        'Sale Return': entry.sale_return_packs || 0,
        'Transfer In': entry.transfer_in_packs || 0,
        'Transfer Out': entry.transfer_out_packs || 0,
        Rate: entry.unit_cost || 0,
        Discount: entry.discount_amount || 0,
        Debit: entry.debit_amount || 0,
        Credit: entry.credit_amount || 0,
        'Running Stock Balance': entry.running_pack_balance,
        'Batch Number': entry.batch_number || '—',
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Item Log Ledger');
    XLSX.writeFile(
      workbook,
      `AMS_Item_Log_${selectedItemObj?.item_code || 'All'}_${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  const getTransTypeBadge = (type: StockLedgerEntry['type']) => {
    switch (type) {
      case 'OPENING':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            OPENING
          </span>
        );
      case 'PURCHASE':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            PURCHASE
          </span>
        );
      case 'PURCHASE_BONUS':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">
            PUR. BONUS
          </span>
        );
      case 'SALE':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            SALE
          </span>
        );
      case 'PURCHASE_RETURN':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            PUR. RETURN
          </span>
        );
      case 'SALES_RETURN':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            SALE RETURN
          </span>
        );
      case 'ADJUSTMENT_IN':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
            ADJ (+)
          </span>
        );
      case 'ADJUSTMENT_OUT':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40">
            ADJ (-)
          </span>
        );
      case 'TRANSFER_IN':
      case 'TRANSFER_OUT':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
            {type === 'TRANSFER_IN' ? 'TRF IN' : 'TRF OUT'}
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">
            OTHER
          </span>
        );
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2.5 shadow-xs print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Item Log &amp; Chronological Transaction History (Full Pack Equivalent)
              </h2>
              <p className="text-[11px] text-slate-400">
                Complete chronological audit trail with Opening Balance, Purchases, Bonus, Returns, Sales, Transfers &amp; Running Stock Balance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (ledgerPrintRef.current) {
                  printReportDocument(
                    ledgerPrintRef.current,
                    `Abrar Medical Store - Item Log (${selectedItemObj ? selectedItemObj.item_name : 'All Items'})`,
                    { orientation: 'landscape', paperSize: 'a4', margin: 'minimum', fontSizeScale: 'small' }
                  );
                } else {
                  window.print();
                }
              }}
              disabled={ledger.length === 0 && !fromDate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Item Log</span>
            </button>
            <button
              type="button"
              onClick={exportToExcel}
              disabled={ledger.length === 0 && !fromDate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel Export</span>
            </button>
            <button
              type="button"
              onClick={fetchLedger}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 text-xs pt-1">
          {/* Quick search item */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Search Item
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                placeholder="Filter item dropdown..."
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Select Item */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Select Medicine Item
            </label>
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500 font-semibold"
            >
              <option value="">-- All Inventory Items --</option>
              {filteredItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.item_code} — {it.item_name} ({it.company_name})
                </option>
              ))}
            </select>
          </div>

          {/* Batch Number Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Batch # Filter
            </label>
            <input
              type="text"
              value={batchNumberFilter}
              onChange={(e) => setBatchNumberFilter(e.target.value)}
              placeholder="Specific batch..."
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* From Date */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Date From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* To Date */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Date To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Printable Area */}
      <div ref={ledgerPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title="ITEM LOG / ITEM TRANSACTION HISTORY (FULL PACK EQUIVALENT)"
          subtitle={
            selectedItemObj
              ? `${selectedItemObj.item_code} — ${selectedItemObj.item_name} | ${selectedItemObj.company_name} (${selectedItemObj.item_group})`
              : 'Consolidated Chronological Stock Movement Ledger'
          }
          dateRange={{ fromDate: fromDate || 'Start', toDate: toDate || 'Present' }}
          metaFields={[
            { label: 'Item Code', value: selectedItemObj?.item_code || 'All Items' },
            { label: 'Company', value: selectedItemObj?.company_name || 'All Companies' },
            { label: 'Opening Balance', value: `${summary.opening_pack_balance} pk` },
            { label: 'Total IN', value: `+${summary.total_in_packs} pk` },
            { label: 'Total OUT', value: `-${summary.total_out_packs} pk` },
            { label: 'Closing Balance', value: `${summary.closing_pack_balance} pk` },
          ]}
        />

        {/* Summary KPI Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs shadow-xs">
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-bold text-slate-400">Opening Balance</div>
            <div className="text-sm font-bold text-slate-200 mt-0.5">
              {summary.opening_pack_balance}{' '}
              <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-bold text-slate-400">Period Total IN</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              +{summary.total_in_packs}{' '}
              <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-bold text-slate-400">Period Total OUT</div>
            <div className="text-sm font-bold text-rose-400 mt-0.5">
              -{summary.total_out_packs}{' '}
              <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-bold text-slate-400">Net Flow Change</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">
              {summary.net_change_packs > 0
                ? `+${summary.net_change_packs}`
                : summary.net_change_packs}{' '}
              pk
            </div>
          </div>
          <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
            <div className="text-[10px] uppercase font-bold text-slate-400">Closing Balance</div>
            <div className="text-sm font-black text-emerald-300 mt-0.5">
              {summary.closing_pack_balance}{' '}
              <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Ledger Table (Zero Loose Columns) */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="px-2 py-2 border-r border-slate-850 text-center">Date</th>
                  <th className="px-2 py-2 border-r border-slate-850">Type</th>
                  <th className="px-2 py-2 border-r border-slate-850">Inv / Voucher #</th>
                  <th className="px-2.5 py-2 border-r border-slate-850 min-w-[130px]">Party Name</th>
                  <th className="px-2 py-2 border-r border-slate-850">Company</th>
                  <th className="px-2 py-2 border-r border-slate-850">Item Group</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right">Opening</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-emerald-400">Purchase</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-teal-300">Pur. Bonus</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-amber-300">Pur. Ret</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-rose-400">Sale</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-cyan-300">Sale Ret</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-sky-300">Trf In</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right text-sky-400">Trf Out</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right">Rate</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right">Discount</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right">Debit</th>
                  <th className="px-2 py-2 border-r border-slate-850 text-right">Credit</th>
                  <th className="px-2.5 py-2 border-r border-slate-850 text-right font-black text-emerald-300">
                    Running Bal (Pk)
                  </th>
                  <th className="px-2 py-2">Batch #</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {fromDate && (
                  <tr className="bg-slate-950/60 text-slate-300 font-semibold">
                    <td className="px-2 py-1.5 border-r border-slate-800 text-center">{fromDate}</td>
                    <td className="px-2 py-1.5 border-r border-slate-800 font-sans">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-300">
                        OPENING B/F
                      </span>
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-800">B/F</td>
                    <td colSpan={3} className="px-2.5 py-1.5 border-r border-slate-800 font-sans text-slate-400">
                      Opening Balance prior to {fromDate}
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-800 text-right font-bold">
                      {summary.opening_pack_balance}
                    </td>
                    <td colSpan={11} className="border-r border-slate-800"></td>
                    <td className="px-2.5 py-1.5 border-r border-slate-800 text-right font-black text-emerald-300">
                      {summary.opening_pack_balance} pk
                    </td>
                    <td className="px-2 py-1.5">—</td>
                  </tr>
                )}

                {loading && ledger.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="py-10 text-center text-slate-400 font-sans">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                      <span>Compiling complete chronological item log...</span>
                    </td>
                  </tr>
                ) : ledger.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="py-8 text-center text-slate-400 font-sans">
                      No transactions recorded for this item in the selected date range.
                    </td>
                  </tr>
                ) : (
                  ledger.map((entry) => (
                    <tr key={entry.transaction_id} className="hover:bg-slate-800/60 transition-colors">
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                        {entry.date}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans">
                        {getTransTypeBadge(entry.type)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-bold text-white">
                        {entry.ref_no}
                      </td>
                      <td className="px-2.5 py-1.5 border-r border-slate-800/80 font-sans text-slate-200">
                        <div className="truncate max-w-[160px]" title={entry.party_name || ''}>
                          {entry.party_name || '—'}
                        </div>
                        {!selectedItemId && entry.item_name && (
                          <div className="text-[10px] text-emerald-400 truncate max-w-[160px]">
                            {entry.item_code} — {entry.item_name}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-300 truncate max-w-[110px]">
                        {entry.company_name || selectedItemObj?.company_name || '—'}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans text-slate-400">
                        {entry.item_group || selectedItemObj?.item_group || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-slate-300">
                        {entry.opening_packs ? entry.opening_packs : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-emerald-400 font-bold">
                        {entry.purchase_packs ? `+${entry.purchase_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-teal-300">
                        {entry.purchase_bonus_packs ? `+${entry.purchase_bonus_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-amber-300">
                        {entry.purchase_return_packs ? `-${entry.purchase_return_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-rose-400 font-bold">
                        {entry.sale_packs
                          ? `-${entry.sale_packs}${
                              entry.sale_bonus_packs ? ` (+${entry.sale_bonus_packs}B)` : ''
                            }`
                          : entry.sale_bonus_packs
                          ? `-${entry.sale_bonus_packs}B`
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-cyan-300">
                        {entry.sale_return_packs ? `+${entry.sale_return_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-sky-300">
                        {entry.transfer_in_packs ? `+${entry.transfer_in_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-sky-400">
                        {entry.transfer_out_packs ? `-${entry.transfer_out_packs}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-slate-300">
                        {entry.unit_cost ? formatPKR(entry.unit_cost, false) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-slate-400">
                        {entry.discount_amount ? formatPKR(entry.discount_amount, false) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-emerald-300">
                        {entry.debit_amount ? formatPKR(entry.debit_amount, false) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-slate-800/80 text-rose-300">
                        {entry.credit_amount ? formatPKR(entry.credit_amount, false) : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-300">
                        {entry.running_pack_balance} pk
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-slate-300 font-bold">
                        {entry.batch_number || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {(ledger.length > 0 || fromDate) && (
                <tfoot className="bg-slate-950 font-mono text-white border-t-2 border-slate-700 font-black text-[11px]">
                  <tr>
                    <td colSpan={6} className="px-3 py-2 font-sans uppercase text-emerald-300 border-r border-slate-800">
                      Closing Balance Summary ({ledger.length} Transactions)
                    </td>
                    <td className="px-2 py-2 text-right border-r border-slate-800">
                      {summary.opening_pack_balance}
                    </td>
                    <td colSpan={11} className="px-2 py-2 text-right border-r border-slate-800 text-slate-300 font-sans text-[10px]">
                      Period Total In: +{summary.total_in_packs} pk | Total Out: -{summary.total_out_packs} pk
                    </td>
                    <td className="px-2.5 py-2 text-right border-r border-slate-800 text-emerald-300">
                      {summary.closing_pack_balance} pk
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
