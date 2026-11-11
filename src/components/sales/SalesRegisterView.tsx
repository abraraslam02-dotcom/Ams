import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { SalesInvoiceRecord } from '../../types/sales';
import { formatPKR } from '../../utils/formatters';
import { exportSalesInvoicesToExcel } from '../../utils/invoiceExcelExport';
import { SalesPrintModal } from './SalesPrintModal';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import {
  Search,
  Download,
  FileSpreadsheet,
  Printer,
  Eye,
  Pencil,
  PlayCircle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';

interface SalesRegisterViewProps {
  mode?: 'register' | 'held_or_draft';
  onResumeInvoice?: (id: number) => void;
  onEditInvoice?: (id: number) => void;
}

export const SalesRegisterView: React.FC<SalesRegisterViewProps> = ({
  mode = 'register',
  onResumeInvoice,
  onEditInvoice,
}) => {
  const [invoices, setInvoices] = useState<SalesInvoiceRecord[]>([]);
  const [customers, setCustomers] = useState<Array<Record<string, any>>>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters & Pagination
  const [q, setQ] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('All');
  const [paymentMode, setPaymentMode] = useState<string>('All');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;

  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [viewInvoice, setViewInvoice] = useState<SalesInvoiceRecord | null>(null);
  const [printInvoice, setPrintInvoice] = useState<SalesInvoiceRecord | null>(null);
  const [printFormat, setPrintFormat] = useState<'a4' | '80mm' | '58mm'>('a4');

  const fetchRegister = useCallback(async () => {
    try {
      setLoading(true);
      const statusParam = mode === 'held_or_draft' ? 'held_or_draft' : 'completed';
      const [salesRes, accRes] = await Promise.all([
        api.getSales({
          q,
          customerId,
          paymentMode,
          status: statusParam,
          startDate,
          endDate,
          page,
          pageSize,
        }),
        api.getAccounts({ status: 'Active' }),
      ]);

      setInvoices(salesRes.data || []);
      setSummary(salesRes.summary || {});
      setTotalCount(Number(salesRes.totalCount || 0));

      const custs = (accRes.accounts || accRes.data || []).filter((a: any) =>
        ['Customer', 'Customer & Supplier'].includes(a.account_group)
      );
      setCustomers(custs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [mode, q, customerId, paymentMode, startDate, endDate, page]);

  useEffect(() => {
    fetchRegister();
  }, [fetchRegister]);

  const handleOpenView = async (id: number) => {
    const res = await api.getSaleDetails(id);
    setViewInvoice(res.data);
  };

  const handleOpenPrint = async (id: number, fmt: 'a4' | '80mm' | '58mm') => {
    const res = await api.getSaleDetails(id);
    setPrintFormat(fmt);
    setPrintInvoice(res.data);
  };

  const handleDeleteHeld = async (id: number) => {
    await api.deleteOrCancelSale(id);
    fetchRegister();
  };

  const handleExportSingleInvoice = async (inv: SalesInvoiceRecord) => {
    try {
      if (Array.isArray(inv.items) && inv.items.length > 0) {
        exportSalesInvoicesToExcel([inv]);
        return;
      }
      const res = await api.getSaleDetails(inv.id);
      if (res?.data) {
        exportSalesInvoicesToExcel([res.data]);
      } else {
        exportSalesInvoicesToExcel([inv]);
      }
    } catch {
      exportSalesInvoicesToExcel([inv]);
    }
  };

  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const statusParam = mode === 'held_or_draft' ? 'held_or_draft' : 'completed';
      const res = await api.getSales({
        q,
        customerId,
        paymentMode,
        status: statusParam,
        startDate,
        endDate,
        exportAll: true,
      });
      const records: SalesInvoiceRecord[] = res?.data && res.data.length > 0 ? res.data : invoices;
      if (records.length === 0) return;
      exportSalesInvoicesToExcel(
        records,
        `AMS_Sales_Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch {
      if (invoices.length > 0) {
        exportSalesInvoicesToExcel(
          invoices,
          `AMS_Sales_Invoices_${new Date().toISOString().slice(0, 10)}.xlsx`
        );
      }
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="space-y-4">
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Invoices</div>
          <div className="text-lg font-black font-mono text-slate-900 mt-0.5">{totalCount}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Sales Amount</div>
          <div className="text-lg font-black font-mono text-emerald-700 mt-0.5">
            {formatPKR(summary.totalNet || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Discount</div>
          <div className="text-lg font-black font-mono text-rose-600 mt-0.5">
            {formatPKR(summary.totalDiscount || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Paid Received</div>
          <div className="text-lg font-black font-mono text-teal-700 mt-0.5">
            {formatPKR(summary.totalPaid || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Balance Due</div>
          <div className="text-lg font-black font-mono text-amber-700 mt-0.5">
            {formatPKR(summary.totalBalance || 0)}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-wrap items-end gap-3 text-xs">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
            Fast Search (Invoice #, Customer, Salesman)
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Search invoice number, customer..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
            Customer Filter
          </label>
          <select
            value={customerId}
            onChange={(e) => {
              setPage(1);
              setCustomerId(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
          >
            <option value="All">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.account_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
            Payment Type
          </label>
          <select
            value={paymentMode}
            onChange={(e) => {
              setPage(1);
              setPaymentMode(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
          >
            <option value="All">All Types</option>
            <option value="Cash">Cash</option>
            <option value="Credit">Credit</option>
            <option value="Partial">Partial</option>
            <option value="Bank">Bank</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
            From Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setPage(1);
              setStartDate(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
            To Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setPage(1);
              setEndDate(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
          />
        </div>

        <button
          type="button"
          disabled={exporting || invoices.length === 0}
          onClick={handleExportExcel}
          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
          title="Export all matching filtered Sales Invoices (Summary + Line Item Details) to Excel (.xlsx)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{exporting ? 'Exporting...' : 'Export to Excel (.xlsx)'}</span>
        </button>
      </div>

      {/* Datasheet Register Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
                <th className="px-3 py-2.5">Invoice Number</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5 text-right">Total Amount</th>
                <th className="px-3 py-2.5 text-right">Discount</th>
                <th className="px-3 py-2.5 text-right">Paid</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
                <th className="px-3 py-2.5 text-center">Payment Type</th>
                <th className="px-3 py-2.5">Salesman</th>
                <th className="px-3 py-2.5 text-right">Actions / Reprint</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">
                    Loading Sales Register...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">
                    No matching sales invoices found.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">
                      {inv.invoice_number}
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {inv.invoice_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{inv.invoice_date}</td>
                    <td className="px-3 py-2 font-semibold text-slate-900">{inv.customer_name}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                      {formatPKR(inv.net_total)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-rose-700">
                      {formatPKR(inv.discount_amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">
                      {formatPKR(inv.paid_amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-800">
                      {formatPKR(inv.balance_amount)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-bold text-[10px]">
                        {inv.payment_mode}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{inv.salesman}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {mode === 'held_or_draft' && onResumeInvoice ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onResumeInvoice(inv.id)}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <PlayCircle className="w-3 h-3" />
                              Resume
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportSingleInvoice(inv)}
                              className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              title="Export this invoice to Excel (.xlsx)"
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              Excel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteHeld(inv.id)}
                              className="p-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                              title="Discard Held/Draft Invoice"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {(onEditInvoice || onResumeInvoice) && (
                              <button
                                type="button"
                                onClick={() => (onEditInvoice || onResumeInvoice)?.(inv.id)}
                                className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                                title="Edit this invoice (items, quantities, prices, customer)"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenView(inv.id)}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportSingleInvoice(inv)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow-2xs"
                              title="Export this Sales Invoice (Summary + Line Items) to Excel (.xlsx)"
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              Excel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPrint(inv.id, 'a4')}
                              className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Printer className="w-3 h-3" />
                              A4
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPrint(inv.id, '80mm')}
                              className="px-2 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-[10px] font-bold cursor-pointer"
                            >
                              80mm
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPrint(inv.id, '58mm')}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-bold cursor-pointer"
                            >
                              58mm
                            </button>
                            <WhatsAppSendButton
                              compact
                              label="WA"
                              payload={{
                                documentType: 'invoice',
                                invoiceId: inv.id,
                                documentNumber: inv.invoice_number,
                                documentDate: inv.invoice_date,
                                customerAccountId: inv.customer_account_id,
                                customerName: inv.customer_name || 'Walk-in Cash Customer',
                                customerPhone: (inv as any).customer_phone || '',
                                totalAmount: Number(inv.net_total || 0),
                                paidAmount: Number(inv.paid_amount || 0),
                                remainingBalance: Number(inv.balance_amount || 0),
                              }}
                              onPhoneSaved={(newPhone) => {
                                setInvoices((prev) =>
                                  prev.map((row) =>
                                    row.customer_account_id === inv.customer_account_id
                                      ? ({ ...row, customer_phone: newPhone } as any)
                                      : row
                                  )
                                );
                              }}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-600">
            Showing Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount}{' '}
            records)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Invoice Details & Double-Entry Modal */}
      {viewInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-4xl p-5 text-xs space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Sales Invoice Details — {viewInvoice.invoice_number}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Customer: {viewInvoice.customer_name} • Date: {viewInvoice.invoice_date} •{' '}
                  {viewInvoice.invoice_type} / {viewInvoice.payment_mode}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportSalesInvoicesToExcel([viewInvoice])}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Export this Sales Invoice to Excel (.xlsx)"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export to Excel
                </button>
                {(onEditInvoice || onResumeInvoice) && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = viewInvoice.id;
                      setViewInvoice(null);
                      (onEditInvoice || onResumeInvoice)?.(id);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    title="Edit this invoice"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit This Invoice
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewInvoice(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-200 text-[11px]">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-center">Packing</th>
                  <th className="p-2 text-center">Batch / Exp</th>
                  <th className="p-2 text-right">Pack Qty</th>
                  <th className="p-2 text-right text-emerald-300">Bonus Qty</th>
                  <th className="p-2 text-right">Pack Price</th>
                  <th className="p-2 text-right">Loose Qty</th>
                  <th className="p-2 text-right">Loose Rate</th>
                  <th className="p-2 text-right">Disc</th>
                  <th className="p-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {(viewInvoice.items || []).map((item: any) => (
                  <tr key={item.id} className="border-b border-slate-200">
                    <td className="p-2 font-bold">
                      {item.item_name} ({item.item_code})
                    </td>
                    <td className="p-2 text-center font-mono">{item.packing}</td>
                    <td className="p-2 text-center font-mono">
                      {item.batch_number} • {item.expiry_date}
                    </td>
                    <td className="p-2 text-right font-mono">{item.quantity}</td>
                    <td className="p-2 text-right font-mono font-semibold text-emerald-700">
                      {item.bonus_quantity || 0}
                    </td>
                    <td className="p-2 text-right font-mono">{formatPKR(item.unit_price)}</td>
                    <td className="p-2 text-right font-mono">{item.loose_quantity}</td>
                    <td className="p-2 text-right font-mono">{formatPKR(item.loose_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatPKR(item.discount_amount)}</td>
                    <td className="p-2 text-right font-mono font-bold">
                      {formatPKR(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Double-Entry Accounting Lines */}
            {(viewInvoice.journalLines || []).length > 0 && (
              <div>
                <h4 className="font-bold text-slate-800 mb-1.5">
                  Posted Double-Entry Accounting Voucher Lines
                </h4>
                <table className="w-full border-collapse border border-slate-200 text-[11px]">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="p-2 text-left">Entry #</th>
                      <th className="p-2 text-left">Account</th>
                      <th className="p-2 text-left">Narration</th>
                      <th className="p-2 text-right">Debit (PKR)</th>
                      <th className="p-2 text-right">Credit (PKR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(viewInvoice.journalLines || []).map((jl: any) => (
                      <tr key={jl.id} className="border-b border-slate-100">
                        <td className="p-2 font-mono font-semibold">{jl.entry_number}</td>
                        <td className="p-2 font-bold">
                          {jl.account_name} ({jl.account_code})
                        </td>
                        <td className="p-2 text-slate-600">{jl.narration}</td>
                        <td className="p-2 text-right font-mono">
                          {jl.debit_amount > 0 ? formatPKR(jl.debit_amount) : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {jl.credit_amount > 0 ? formatPKR(jl.credit_amount) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {printInvoice && (
        <SalesPrintModal
          invoice={printInvoice}
          initialFormat={printFormat}
          onClose={() => setPrintInvoice(null)}
        />
      )}
    </div>
  );
};
