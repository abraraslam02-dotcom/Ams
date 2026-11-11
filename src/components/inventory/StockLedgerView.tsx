import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Search,
  Calendar,
  Filter,
  RefreshCw,
  Download,
  AlertTriangle,
  Package,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  ShoppingCart,
  Boxes,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { StockLedgerEntry, StockDatasheetItem } from '../../types/inventory';
import { formatPKR } from '../../utils/formatters';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export const StockLedgerView: React.FC = () => {
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const ledgerPrintRef = useRef<HTMLDivElement>(null);

  // Filter items master list for selector
  const [itemsList, setItemsList] = useState<StockDatasheetItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [batchNumberFilter, setBatchNumberFilter] = useState<string>('');

  // Date filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Summary
  const [summary, setSummary] = useState({
    total_in_packs: 0,
    total_out_packs: 0,
    net_change_packs: 0,
    closing_pack_balance: 0,
  });

  const loadItems = async () => {
    try {
      const res = await api.getStockDatasheet({ limit: 500 });
      setItemsList(res.data);
      if (res.data.length > 0 && !selectedItemId) {
        setSelectedItemId(String(res.data[0].item_id));
      }
    } catch (err) {
      console.error('Failed to load items:', err);
    }
  };

  const fetchLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStockLedger({
        item_id: selectedItemId ? Number(selectedItemId) : undefined,
        batch_number: batchNumberFilter.trim() || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      });
      setLedger(res.ledger);
      setSummary(res.summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stock ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    fetchLedger();
  }, [selectedItemId, batchNumberFilter, fromDate, toDate]);

  // Unique item options
  const uniqueItemOptions = useMemo(() => {
    const map = new Map<number, { id: number; code: string; name: string }>();
    itemsList.forEach((it) => {
      if (!map.has(it.item_id)) {
        map.set(it.item_id, {
          id: it.item_id,
          code: it.item_code,
          name: it.item_name,
        });
      }
    });
    return Array.from(map.values());
  }, [itemsList]);

  const selectedItemObj = useMemo(() => {
    return uniqueItemOptions.find((i) => i.id === Number(selectedItemId));
  }, [uniqueItemOptions, selectedItemId]);

  const exportToExcel = () => {
    const rows = ledger.map((entry, idx) => ({
      'Sr #': idx + 1,
      'Date': entry.date,
      'Transaction Type': entry.type_label,
      'Ref / Invoice #': entry.ref_no,
      'Batch Number': entry.batch_number,
      'Expiry Date': entry.expiry_date,
      'In (Packs)': entry.in_packs,
      'In (Loose)': entry.in_loose,
      'Out (Packs)': entry.out_packs,
      'Out (Loose)': entry.out_loose,
      'Net Pack Change': entry.net_pack_change,
      'Running Balance (Packs)': entry.running_pack_balance,
      'Running Loose': entry.running_loose_balance,
      'Unit Cost (Rs)': entry.unit_cost,
      'Remarks': entry.remarks,
      'User': entry.user_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Ledger');
    XLSX.writeFile(
      workbook,
      `AMS_Stock_Ledger_${selectedItemObj?.code || 'All'}_${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  const getTransTypeBadge = (type: StockLedgerEntry['type']) => {
    switch (type) {
      case 'OPENING':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-300 border border-slate-700">OPENING</span>;
      case 'PURCHASE':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">+PURCHASE</span>;
      case 'PURCHASE_BONUS':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">+BONUS</span>;
      case 'SALE':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">-SALE</span>;
      case 'PURCHASE_RETURN':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">-PUR. RETURN</span>;
      case 'SALES_RETURN':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">+SALE RETURN</span>;
      case 'ADJUSTMENT_IN':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">+ADJUSTMENT</span>;
      case 'ADJUSTMENT_OUT':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40">-ADJUSTMENT</span>;
      case 'TRANSFER_IN':
      case 'TRANSFER_OUT':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">TRANSFER</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">OTHER</span>;
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Control Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Stock Movement Ledger &amp; Running Audit Card
              </h2>
              <p className="text-[11px] text-slate-400">
                Complete chronological transaction history: Purchases (+), Sales (-), Returns, Bonus, and Adjustments
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => {
                if (ledgerPrintRef.current) {
                  printReportDocument(
                    ledgerPrintRef.current,
                    `Abrar Medical Store - Stock Ledger (${selectedItemObj ? selectedItemObj.name : 'Consolidated'})`,
                    { orientation: 'landscape', paperSize: 'a4' }
                  );
                } else {
                  window.print();
                }
              }}
              disabled={ledger.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Ledger</span>
            </button>
            <button
              onClick={exportToExcel}
              disabled={ledger.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel Export</span>
            </button>
            <button
              onClick={fetchLedger}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs pt-1 print:hidden">
          {/* Select Item */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Select Medicine Item:</label>
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs focus:outline-hidden focus:border-emerald-500 font-semibold"
            >
              <option value="">-- All Inventory Items --</option>
              {uniqueItemOptions.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} — {it.name}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Number Filter */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Batch # Filter (Optional):</label>
            <input
              type="text"
              value={batchNumberFilter}
              onChange={(e) => setBatchNumberFilter(e.target.value)}
              placeholder="Filter specific batch..."
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* From Date */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">From Date:</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* To Date */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">To Date:</label>
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
          title="STOCK MOVEMENT LEDGER & AUDIT TRAIL"
          subtitle={selectedItemObj ? `${selectedItemObj.code} — ${selectedItemObj.name}` : 'All Stock Movement Transactions'}
          dateRange={{ fromDate: fromDate || 'Start', toDate: toDate || 'Present' }}
          metaFields={[
            { label: 'Item Code', value: selectedItemObj?.code || 'All Items' },
            { label: 'Batch Filter', value: batchNumberFilter || 'All Batches' },
            { label: 'Total IN', value: `${summary.total_in_packs} pk` },
            { label: 'Total OUT', value: `${summary.total_out_packs} pk` },
            { label: 'Closing Balance', value: `${summary.closing_pack_balance} pk` },
          ]}
        />

        {/* Summary KPI Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs shadow-xs">
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-slate-400">Period Total IN</div>
          <div className="text-sm font-bold text-emerald-400 mt-0.5">
            +{summary.total_in_packs} <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-slate-400">Period Total OUT</div>
          <div className="text-sm font-bold text-rose-400 mt-0.5">
            -{summary.total_out_packs} <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-slate-400">Net Flow Change</div>
          <div className="text-sm font-bold text-amber-300 mt-0.5">
            {summary.net_change_packs > 0 ? `+${summary.net_change_packs}` : summary.net_change_packs} pk
          </div>
        </div>
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700/60">
          <div className="text-[10px] uppercase font-bold text-slate-400">Closing Stock Balance</div>
          <div className="text-sm font-black text-emerald-300 mt-0.5">
            {summary.closing_pack_balance} <span className="text-[10px] font-normal text-slate-400 font-sans">packs</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Ledger Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="bg-slate-950 text-slate-300 uppercase tracking-wider text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-2.5 py-2 border-r border-slate-850 text-center">Date</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Type</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Ref / Doc #</th>
                <th className="px-2.5 py-2 border-r border-slate-850">Batch #</th>
                <th className="px-2 py-2 border-r border-slate-850 text-center">Expiry</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-emerald-400 font-bold">In (Packs)</th>
                <th className="px-2 py-2 border-r border-slate-850 text-right text-teal-400">In (Loose)</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-rose-400 font-bold">Out (Packs)</th>
                <th className="px-2 py-2 border-r border-slate-850 text-right text-rose-300">Out (Loose)</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right font-bold">Net Change</th>
                <th className="px-3 py-2 border-r border-slate-850 text-right font-black text-emerald-300">Running Bal (Packs)</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right text-sky-300 font-bold">Running Loose</th>
                <th className="px-2.5 py-2 border-r border-slate-850 text-right">Cost Rate</th>
                <th className="px-3 py-2 border-r border-slate-850 min-w-[150px]">Remarks</th>
                <th className="px-2.5 py-2">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {loading && ledger.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-10 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-1" />
                    <span>Compiling complete stock transaction ledger...</span>
                  </td>
                </tr>
              ) : ledger.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-slate-400 font-sans">
                    No transactions recorded for this item in the selected date range.
                  </td>
                </tr>
              ) : (
                ledger.map((entry) => (
                  <tr key={entry.transaction_id} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-300">
                      {entry.date}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-sans">
                      {getTransTypeBadge(entry.type)}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 font-bold text-white">
                      {entry.ref_no}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-slate-300 font-bold">
                      {entry.batch_number}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-center text-slate-400">
                      {entry.expiry_date}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-emerald-400 font-bold">
                      {entry.in_packs > 0 ? `+${entry.in_packs}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-teal-400">
                      {entry.in_loose > 0 ? `+${entry.in_loose}` : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-rose-400 font-bold">
                      {entry.out_packs > 0 ? `-${entry.out_packs}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-rose-300">
                      {entry.out_loose > 0 ? `-${entry.out_loose}` : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-bold">
                      <span
                        className={
                          entry.net_pack_change > 0
                            ? 'text-emerald-400'
                            : entry.net_pack_change < 0
                            ? 'text-rose-400'
                            : 'text-slate-500'
                        }
                      >
                        {entry.net_pack_change > 0 ? `+${entry.net_pack_change}` : entry.net_pack_change}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right font-black text-emerald-300">
                      {entry.running_pack_balance} pk
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-sky-400 font-bold">
                      {entry.running_loose_balance} u
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap border-r border-slate-800/80 text-right text-slate-300">
                      {formatPKR(entry.unit_cost, false)}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-800/80 font-sans text-slate-400">
                      <div className="truncate max-w-[200px]">{entry.remarks || '—'}</div>
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap font-sans text-slate-300">
                      {entry.user_name}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);
};
