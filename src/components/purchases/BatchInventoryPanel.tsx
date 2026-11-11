import React, { useState } from 'react';
import { Boxes, Search, RefreshCw, Download, Layers, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { BatchInventoryItem } from '../../types/purchase';
import { formatPKR } from '../../utils/formatters';

interface BatchInventoryPanelProps {
  batches: BatchInventoryItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const BatchInventoryPanel: React.FC<BatchInventoryPanelProps> = ({
  batches,
  loading,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = batches.filter((b) => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        b.item_code.toLowerCase().includes(q) ||
        b.item_name.toLowerCase().includes(q) ||
        b.company_name.toLowerCase().includes(q) ||
        b.batch_number.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleExportExcel = () => {
    const rows = filtered.map((b) => ({
      'Item Code': b.item_code,
      'Item Name': b.item_name,
      Company: b.company_name,
      Packing: b.packing,
      'Batch Number': b.batch_number,
      'Mfg Date': b.manufacturing_date || '',
      'Expiry Date': b.expiry_date,
      'Purchased Qty (Packs)': b.purchased_qty,
      'Bonus Qty (Packs)': b.bonus_qty,
      'Returned Qty (Packs)': b.returned_qty,
      'Current Stock (Boxes/Packs)': b.current_pack_qty,
      'Current Strips': b.current_strip_qty,
      'Total Loose Units': b.total_stock_units,
      'Purchase Cost (PKR)': b.cost_price,
      'Retail Price (PKR)': b.retail_price,
      'Stock Value (PKR)': Math.round(b.current_pack_qty * b.cost_price * 100) / 100,
      'Rack / Shelf': b.rack_shelf || '',
      Status: b.status,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Batch_Inventory');
    XLSX.writeFile(wb, `AMS_Batch_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const totalValuation = filtered.reduce(
    (sum, b) => sum + Number(b.current_pack_qty || 0) * Number(b.cost_price || 0),
    0
  );
  const totalPacks = filtered.reduce((sum, b) => sum + Number(b.current_pack_qty || 0), 0);
  const totalLoose = filtered.reduce((sum, b) => sum + Number(b.total_stock_units || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Active Stock Batches
          </span>
          <div className="text-xl font-black font-mono text-slate-900 mt-1">{filtered.length}</div>
          <span className="text-[11px] text-slate-500">Batch-wise FEFO tracking</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Total Packs / Boxes in Stock
          </span>
          <div className="text-xl font-black font-mono text-emerald-900 mt-1">{totalPacks}</div>
          <span className="text-[11px] text-emerald-700">Includes Purchased + Bonus - Returned</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
            Total Converted Loose Units
          </span>
          <div className="text-xl font-black font-mono text-blue-900 mt-1">{totalLoose}</div>
          <span className="text-[11px] text-blue-700">Box &rarr; Strip &rarr; Loose conversion</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 text-white border border-slate-800 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
            Batch Stock Valuation (Cost)
          </span>
          <div className="text-xl font-black font-mono text-white mt-1">
            {formatPKR(totalValuation)}
          </div>
          <span className="text-[11px] text-slate-400">Valued at Batch Purchase Rate</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Batch #, Item Code, Medicine Name, Company..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-800"
          >
            <option value="all">All Batch Statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Batch Stock (Excel)</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Item Code & Medicine</th>
                <th className="py-3 px-2.5">Batch #</th>
                <th className="py-3 px-2.5">Mfg / Expiry</th>
                <th className="py-3 px-2.5">Packing Breakdown</th>
                <th className="py-3 px-2.5 text-right">Pur + Bonus</th>
                <th className="py-3 px-2.5 text-right">Returned</th>
                <th className="py-3 px-2.5 text-right">Current Packs</th>
                <th className="py-3 px-2.5 text-right">Strips / Loose</th>
                <th className="py-3 px-2.5 text-right">Cost / Retail</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    No batch stock records found. Confirm a Purchase Invoice to populate batch-wise
                    stock.
                  </td>
                </tr>
              ) : (
                filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{b.item_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {b.item_code} &bull; {b.company_name}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 font-mono font-bold text-slate-900">
                      {b.batch_number}
                    </td>
                    <td className="py-2.5 px-2.5 font-mono text-[11px]">
                      <div className="text-slate-500">Mfg: {b.manufacturing_date || '—'}</div>
                      <div className="font-bold text-slate-900">Exp: {b.expiry_date}</div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {b.packing}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {b.strips_per_box} strip(s) &times; {b.units_per_strip} = {b.units_per_pack}{' '}
                        units/pack
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono">
                      <span className="font-bold text-slate-900">{b.purchased_qty}</span>
                      {b.bonus_qty > 0 && (
                        <span className="ml-1 text-emerald-700 font-bold">+{b.bonus_qty}B</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono text-rose-700 font-semibold">
                      {b.returned_qty > 0 ? `-${b.returned_qty}` : '0'}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-black text-emerald-800 text-sm">
                      {b.current_pack_qty}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono text-[11px]">
                      <div className="font-semibold text-slate-800">
                        {b.current_strip_qty} strips
                      </div>
                      <div className="text-blue-700 font-bold">
                        {b.total_stock_units} loose units
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono text-[11px]">
                      <div className="font-bold text-slate-900">
                        Cost: {formatPKR(b.cost_price)}
                      </div>
                      <div className="text-slate-500">MRP: {formatPKR(b.retail_price)}</div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          b.status === 'in_stock'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.status === 'low_stock'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
