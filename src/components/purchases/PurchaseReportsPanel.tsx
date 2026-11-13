import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Filter,
  RefreshCw,
  Calendar,
  Building2,
  Package,
  Layers,
  ArrowDownLeft,
  Scale,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Account } from '../../types/account';
import { Item } from '../../types/item';
import { PurchaseReportType } from '../../types/purchase';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { TopPerformanceReportsView } from '../reports/TopPerformanceReportsView';

interface PurchaseReportsPanelProps {
  suppliers: Account[];
  items: Item[];
}

const REPORT_TABS: Array<{
  id: PurchaseReportType;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'purchase-register',
    label: '1. Purchase Register',
    subtitle: 'Complete chronological register of confirmed purchase bills',
  },
  {
    id: 'supplier-wise',
    label: '2. Supplier-wise Purchase',
    subtitle: 'Aggregated purchase totals, GST, and Advance Tax by supplier',
  },
  {
    id: 'item-wise',
    label: '3. Item-wise Purchase',
    subtitle: 'Medicine-wise purchased quantities, bonus, and cost analysis',
  },
  {
    id: 'batch-wise',
    label: '4. Batch-wise Purchase',
    subtitle: 'Detailed batch receipts with Mfg/Expiry dates and remaining batch stock',
  },
  {
    id: 'return-register',
    label: '5. Purchase Return Register',
    subtitle: 'Complete register of supplier debit notes and tax adjustments',
  },
  {
    id: 'supplier-outstanding',
    label: '6. Supplier Outstanding',
    subtitle: 'Supplier payable ledger balances (Dr / Cr / Net Payable)',
  },
  {
    id: 'advance-tax-summary',
    label: '7. Advance Tax Summary',
    subtitle: 'FBR Advance Tax (Filer / Non-Filer / Exempt) invoice register',
  },
  {
    id: 'expiry-wise',
    label: '8. Expiry-wise Purchase',
    subtitle: 'Batches sorted by nearest expiry date with days-to-expiry alert',
  },
  {
    id: 'top-performance',
    label: '9. Top Performance & Overall',
    subtitle: 'Top 1/2/3/5/10 & Overall Suppliers, Items, Towns, Areas + Increment/Decrement',
  },
];

export const PurchaseReportsPanel: React.FC<PurchaseReportsPanelProps> = ({
  suppliers,
  items,
}) => {
  const [activeReport, setActiveReport] = useState<PurchaseReportType>('purchase-register');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [supplierId, setSupplierId] = useState('all');
  const [itemId, setItemId] = useState('all');
  const [filerStatus, setFilerStatus] = useState('all');

  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getPurchaseReport(activeReport, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        supplierId: supplierId !== 'all' ? supplierId : undefined,
        itemId: itemId !== 'all' ? itemId : undefined,
        filerStatus: filerStatus !== 'all' ? filerStatus : undefined,
      });
      setRows(res.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeReport, startDate, endDate, supplierId, itemId, filerStatus]);

  useEffect(() => {
    if (activeReport === 'top-performance') return;
    loadReport();
  }, [loadReport, activeReport]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeReport.slice(0, 30));
    XLSX.writeFile(
      wb,
      `AMS_Report_${activeReport}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  return (
    <div className="space-y-4">
      {/* 8 Report Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {REPORT_TABS.map((tab) => {
          const isActive = activeReport === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveReport(tab.id)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-bold leading-tight">{tab.label}</div>
              <div
                className={`text-[10px] mt-0.5 truncate ${
                  isActive ? 'text-emerald-300' : 'text-slate-400'
                }`}
              >
                {tab.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      {activeReport === 'top-performance' ? (
        <TopPerformanceReportsView initialAnalysisMode="purchase" embedded />
      ) : (
        <>
          {/* Filters & Excel Export Bar */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
            >
              <option value="all">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  [{s.account_code}] {s.account_name}
                </option>
              ))}
            </select>
          </div>

          {['item-wise', 'batch-wise', 'expiry-wise'].includes(activeReport) && (
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-slate-600">Medicine Item</label>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
              >
                <option value="all">All Items</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    [{i.item_code}] {i.item_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {['purchase-register', 'advance-tax-summary'].includes(activeReport) && (
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-slate-600">Filer Status</label>
              <select
                value={filerStatus}
                onChange={(e) => setFilerStatus(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-900"
              >
                <option value="all">All Statuses</option>
                <option value="Filer">Filer</option>
                <option value="Non-Filer">Non-Filer</option>
                <option value="Exempt">Exempt</option>
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
              setSupplierId('all');
              setItemId('all');
              setFilerStatus('all');
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadReport}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export to Excel</span>
          </button>
        </div>
      </div>

      {/* Report Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {activeReport === 'purchase-register' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Bill #</th>
                  <th className="py-2.5 px-2.5">Date</th>
                  <th className="py-2.5 px-2.5">Supplier</th>
                  <th className="py-2.5 px-2.5">Sup. Inv #</th>
                  <th className="py-2.5 px-2.5">Filer Status</th>
                  <th className="py-2.5 px-2.5 text-right">Gross</th>
                  <th className="py-2.5 px-2.5 text-right">Discount</th>
                  <th className="py-2.5 px-2.5 text-right">Taxable</th>
                  <th className="py-2.5 px-2.5 text-right">GST</th>
                  <th className="py-2.5 px-2.5 text-right">Adv. Tax</th>
                  <th className="py-2.5 px-2.5 text-right">Net Total</th>
                  <th className="py-2.5 px-3 text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono font-bold text-slate-900">{r.bill_number}</td>
                    <td className="py-2 px-2.5 font-mono">{r.bill_date}</td>
                    <td className="py-2 px-2.5 font-semibold text-slate-900">{r.supplier_name}</td>
                    <td className="py-2 px-2.5 font-mono text-slate-600">
                      {r.supplier_invoice_number || '—'}
                    </td>
                    <td className="py-2 px-2.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-[10px]">
                        {r.supplier_filer_status} ({r.advance_tax_rate}%)
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gross_total)}</td>
                    <td className="py-2 px-2.5 text-right font-mono text-rose-700">
                      {formatPKR(r.discount_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.taxable_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gst_amount)}</td>
                    <td className="py-2 px-2.5 text-right font-mono text-amber-800 font-semibold">
                      {formatPKR(r.advance_tax_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.net_total)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-700 font-semibold">
                      {formatPKR(r.paid_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'supplier-wise' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Supplier Code & Name</th>
                  <th className="py-2.5 px-2.5">Filer / NTN</th>
                  <th className="py-2.5 px-2.5 text-right">Bills</th>
                  <th className="py-2.5 px-2.5 text-right">Gross Total</th>
                  <th className="py-2.5 px-2.5 text-right">Discounts</th>
                  <th className="py-2.5 px-2.5 text-right">Taxable</th>
                  <th className="py-2.5 px-2.5 text-right">GST</th>
                  <th className="py-2.5 px-2.5 text-right">Advance Tax</th>
                  <th className="py-2.5 px-2.5 text-right">Net Purchases</th>
                  <th className="py-2.5 px-3 text-right">Current Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.supplier_account_id} className="hover:bg-slate-50">
                    <td className="py-2 px-3">
                      <div className="font-bold text-slate-900">{r.supplier_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.supplier_code}</div>
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[11px]">
                      <span className="font-bold">{r.filer_status}</span> &bull; {r.ntn || '—'}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-bold">{r.invoice_count}</td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gross_total)}</td>
                    <td className="py-2 px-2.5 text-right font-mono text-rose-700">
                      {formatPKR(r.discount_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.taxable_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gst_amount)}</td>
                    <td className="py-2 px-2.5 text-right font-mono text-amber-800 font-semibold">
                      {formatPKR(r.advance_tax_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.net_total)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-blue-800">
                      {formatPKR(r.net_payable)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'item-wise' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Item Code & Medicine</th>
                  <th className="py-2.5 px-2.5">Company & Packing</th>
                  <th className="py-2.5 px-2.5 text-right">Invoices / Batches</th>
                  <th className="py-2.5 px-2.5 text-right">Purchased Qty</th>
                  <th className="py-2.5 px-2.5 text-right">Bonus Qty</th>
                  <th className="py-2.5 px-2.5 text-right">Returned Qty</th>
                  <th className="py-2.5 px-2.5 text-right">Avg Rate</th>
                  <th className="py-2.5 px-2.5 text-right">Taxable</th>
                  <th className="py-2.5 px-2.5 text-right">GST</th>
                  <th className="py-2.5 px-3 text-right">Net Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.item_id} className="hover:bg-slate-50">
                    <td className="py-2 px-3">
                      <div className="font-bold text-slate-900">{r.item_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.item_code}</div>
                    </td>
                    <td className="py-2 px-2.5">
                      <div>{r.company_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.packing}</div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {r.invoice_count} bills / {r.batch_count} batches
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-bold">
                      {r.total_purchased_qty}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                      {r.total_bonus_qty}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-rose-700">
                      {r.total_returned_qty}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.avg_purchase_rate)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.taxable_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gst_amount)}</td>
                    <td className="py-2 px-3 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.net_line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'batch-wise' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Bill # & Date</th>
                  <th className="py-2.5 px-2.5">Item & Packing</th>
                  <th className="py-2.5 px-2.5">Batch #</th>
                  <th className="py-2.5 px-2.5">Mfg / Expiry</th>
                  <th className="py-2.5 px-2.5">Supplier</th>
                  <th className="py-2.5 px-2.5 text-right">Qty + Bonus</th>
                  <th className="py-2.5 px-2.5 text-right">Returned</th>
                  <th className="py-2.5 px-2.5 text-right">Rate</th>
                  <th className="py-2.5 px-2.5 text-right">Net Line</th>
                  <th className="py-2.5 px-3 text-right">In Stock Now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono">
                      <div className="font-bold text-slate-900">{r.bill_number}</div>
                      <div className="text-[10px] text-slate-500">{r.bill_date}</div>
                    </td>
                    <td className="py-2 px-2.5">
                      <div className="font-bold text-slate-900">{r.item_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {r.item_code} &bull; {r.packing}
                      </div>
                    </td>
                    <td className="py-2 px-2.5 font-mono font-bold text-slate-900">
                      {r.batch_number}
                    </td>
                    <td className="py-2 px-2.5 font-mono text-[10px]">
                      <div>M: {r.manufacturing_date || '—'}</div>
                      <div className="font-bold">E: {r.expiry_date}</div>
                    </td>
                    <td className="py-2 px-2.5 text-slate-700">{r.supplier_name}</td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {r.quantity} {r.bonus_quantity > 0 ? `+${r.bonus_quantity}B` : ''}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-rose-700">
                      {r.returned_quantity || 0}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.purchase_rate)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-bold">
                      {formatPKR(r.line_total)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-black text-emerald-800">
                      {r.current_batch_stock ?? 0} packs
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'return-register' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Debit Note #</th>
                  <th className="py-2.5 px-2.5">Return Date</th>
                  <th className="py-2.5 px-2.5">Original Bill #</th>
                  <th className="py-2.5 px-2.5">Supplier</th>
                  <th className="py-2.5 px-2.5">Reason</th>
                  <th className="py-2.5 px-2.5 text-right">Taxable Return</th>
                  <th className="py-2.5 px-2.5 text-right">GST Adj.</th>
                  <th className="py-2.5 px-2.5 text-right">Adv. Tax Adj.</th>
                  <th className="py-2.5 px-3 text-right">Total Debit Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono font-bold text-rose-700">
                      {r.debit_note_number}
                    </td>
                    <td className="py-2 px-2.5 font-mono">{r.return_date}</td>
                    <td className="py-2 px-2.5 font-mono font-semibold">
                      {r.original_bill_number}
                    </td>
                    <td className="py-2 px-2.5 font-semibold text-slate-900">{r.supplier_name}</td>
                    <td className="py-2 px-2.5 text-slate-600">{r.return_reason}</td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.taxable_return_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.gst_adjustment_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-amber-800">
                      {formatPKR(r.advance_tax_adjustment_amount)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.total_debit_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'supplier-outstanding' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Account Code & Supplier</th>
                  <th className="py-2.5 px-2.5">Group</th>
                  <th className="py-2.5 px-2.5">Filer / NTN</th>
                  <th className="py-2.5 px-2.5">Contact & City</th>
                  <th className="py-2.5 px-2.5 text-right">Total Debit (Paid/Ret)</th>
                  <th className="py-2.5 px-2.5 text-right">Total Credit (Bills)</th>
                  <th className="py-2.5 px-3 text-right">Net Payable Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3">
                      <div className="font-bold text-slate-900">{r.account_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.account_code}</div>
                    </td>
                    <td className="py-2 px-2.5">{r.account_group}</td>
                    <td className="py-2 px-2.5 font-mono text-[11px]">
                      <span className="font-bold">{r.filer_status}</span> &bull; {r.ntn || '—'}
                    </td>
                    <td className="py-2 px-2.5 text-[11px]">
                      {r.contact_person || '—'} ({r.city || 'Pakistan'})
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                      {formatPKR(r.supplier_debit)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono text-blue-700 font-semibold">
                      {formatPKR(r.supplier_credit)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-black text-slate-900">
                      {formatPKR(Math.abs(r.net_payable_balance))}{' '}
                      <span className="text-[10px] text-slate-500">
                        {r.net_payable_balance >= 0 ? 'Cr (Payable)' : 'Dr (Advance)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'advance-tax-summary' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Bill # & Date</th>
                  <th className="py-2.5 px-2.5">Supplier & NTN</th>
                  <th className="py-2.5 px-2.5">Filer Category</th>
                  <th className="py-2.5 px-2.5">Tax Section / Basis</th>
                  <th className="py-2.5 px-2.5 text-right">Taxable Amt</th>
                  <th className="py-2.5 px-2.5 text-right">GST Amt</th>
                  <th className="py-2.5 px-2.5 text-right">Applied Rate</th>
                  <th className="py-2.5 px-2.5 text-right">Advance Tax (PKR)</th>
                  <th className="py-2.5 px-3">Override Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono">
                      <div className="font-bold text-slate-900">{r.bill_number}</div>
                      <div className="text-[10px] text-slate-500">{r.bill_date}</div>
                    </td>
                    <td className="py-2 px-2.5">
                      <div className="font-bold text-slate-900">{r.supplier_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        NTN: {r.supplier_ntn || '—'} | STRN: {r.supplier_strn || '—'}
                      </div>
                    </td>
                    <td className="py-2 px-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.supplier_filer_status === 'Filer'
                            ? 'bg-emerald-100 text-emerald-800'
                            : r.supplier_filer_status === 'Non-Filer'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {r.supplier_filer_status}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-[11px]">
                      <div className="font-semibold">{r.advance_tax_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        Basis: {r.advance_tax_basis}
                      </div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {formatPKR(r.taxable_amount)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">{formatPKR(r.gst_amount)}</td>
                    <td className="py-2 px-2.5 text-right font-mono font-bold text-amber-800">
                      {Number(r.advance_tax_rate).toFixed(2)}%
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-black text-slate-900">
                      {formatPKR(r.advance_tax_amount)}
                    </td>
                    <td className="py-2 px-3 text-[11px]">
                      {r.is_tax_overridden === 1 ? (
                        <span className="text-rose-700 font-semibold">
                          Overridden ({r.tax_override_authorized_by}: {r.tax_override_reason})
                        </span>
                      ) : (
                        <span className="text-slate-400">Standard Statutory Rate</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeReport === 'expiry-wise' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white uppercase text-[10px]">
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-2.5">Days to Expiry</th>
                  <th className="py-2.5 px-2.5">Medicine & Packing</th>
                  <th className="py-2.5 px-2.5">Batch #</th>
                  <th className="py-2.5 px-2.5">Supplier & Bill #</th>
                  <th className="py-2.5 px-2.5 text-right">Pur + Bonus</th>
                  <th className="py-2.5 px-2.5 text-right">Remaining Stock</th>
                  <th className="py-2.5 px-3 text-right">Purchase Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono font-bold text-slate-900">
                      {r.expiry_date}
                    </td>
                    <td className="py-2 px-2.5 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.days_to_expiry < 0
                            ? 'bg-rose-100 text-rose-800'
                            : r.days_to_expiry <= 90
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {r.days_to_expiry < 0
                          ? `Expired (${Math.abs(r.days_to_expiry)}d ago)`
                          : `${r.days_to_expiry} days`}
                      </span>
                    </td>
                    <td className="py-2 px-2.5">
                      <div className="font-bold text-slate-900">{r.item_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {r.item_code} &bull; {r.packing}
                      </div>
                    </td>
                    <td className="py-2 px-2.5 font-mono font-bold">{r.batch_number}</td>
                    <td className="py-2 px-2.5 text-[11px]">
                      <div className="font-semibold">{r.supplier_name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.bill_number}</div>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono">
                      {r.purchased_qty} {r.bonus_qty > 0 ? `+${r.bonus_qty}B` : ''}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-800">
                      {r.remaining_batch_qty ?? 0} packs
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold">
                      {formatPKR(r.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rows.length === 0 && !loading && (
            <div className="py-10 text-center text-xs text-slate-500">
              No records match the selected report filters.
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
};

