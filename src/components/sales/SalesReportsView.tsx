import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { formatPKR, formatPKTDateTime } from '../../utils/formatters';
import { BarChart3, Download, Printer } from 'lucide-react';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';

export type SalesReportKey =
  | 'daily-sales'
  | 'monthly-sales'
  | 'item-wise-sales'
  | 'customer-wise-sales'
  | 'profit-report'
  | 'discount-report'
  | 'sales-return-report'
  | 'tax-summary'
  | 'tax-history';

interface SalesReportsViewProps {
  initialReport: SalesReportKey;
}

export const SalesReportsView: React.FC<SalesReportsViewProps> = ({ initialReport }) => {
  const [reportKey, setReportKey] = useState<SalesReportKey>(initialReport);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const salesReportPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReportKey(initialReport);
  }, [initialReport]);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const apiReportKey = reportKey === 'tax-history' ? 'tax-summary' : reportKey;
      const res = await api.getSalesReport(apiReportKey, { startDate, endDate });
      setData(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [reportKey, startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportExcel = () => {
    const rows = Array.isArray(data)
      ? data
      : reportKey === 'tax-history'
      ? data?.history || []
      : [data?.salesTax || {}, data?.purchaseTax || {}];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `AMS_${reportKey}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const reportTabs: Array<{ id: SalesReportKey; label: string }> = [
    { id: 'daily-sales', label: 'Daily Sales' },
    { id: 'monthly-sales', label: 'Monthly Sales' },
    { id: 'item-wise-sales', label: 'Item-wise Sales' },
    { id: 'customer-wise-sales', label: 'Customer-wise Sales' },
    { id: 'profit-report', label: 'Profit Report' },
    { id: 'discount-report', label: 'Discount Report' },
    { id: 'sales-return-report', label: 'Sales Return Report' },
    { id: 'tax-summary', label: 'Tax Summary' },
    { id: 'tax-history', label: 'Tax History' },
  ];

  const rowsArray = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4">
      {/* Top Report Selector & Date Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Sales, Profit, Discount & Tax Analytics Suite
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
            <button
              type="button"
              onClick={() => {
                if (salesReportPrintRef.current) {
                  const currentTab = reportTabs.find((t) => t.id === reportKey);
                  printReportDocument(
                    salesReportPrintRef.current,
                    `Abrar Medical Store - ${currentTab?.label || 'Sales Report'}`
                  );
                } else {
                  window.print();
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Excel
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
          {reportTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReportKey(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                reportKey === t.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Printable Report Content */}
      <div ref={salesReportPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={reportTabs.find((t) => t.id === reportKey)?.label?.toUpperCase() || 'SALES REPORT'}
          subtitle="Official Commercial & Dispensing Analytics Statement"
          metaItems={[
            { label: 'Report Type', value: reportTabs.find((t) => t.id === reportKey)?.label || reportKey },
            { label: 'Date Range', value: `${startDate || 'Start of Records'} to ${endDate || 'Current'}` },
            { label: 'Generated At', value: formatPKTDateTime(new Date().toISOString()) },
          ]}
        />

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading report data...</div>
        ) : reportKey === 'tax-summary' && data && !Array.isArray(data) ? (
          <div className="p-5 grid grid-cols-2 gap-6">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-black text-slate-900 uppercase">
                Sales Tax & Advance Tax Collected (Output)
              </h4>
              <div className="flex justify-between">
                <span>Completed Sales Invoices:</span>
                <span className="font-mono font-bold">{data.salesTax?.invoiceCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxable Sales Volume:</span>
                <span className="font-mono font-bold">
                  {formatPKR(data.salesTax?.taxableAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>GST Collected:</span>
                <span className="font-mono font-bold">
                  {formatPKR(data.salesTax?.gstCollected || 0)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-black text-emerald-700">
                <span>Advance Tax Collected on Sales:</span>
                <span className="font-mono">
                  {formatPKR(data.salesTax?.advanceTaxCollected || 0)}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-black text-slate-900 uppercase">
                Purchase Input GST & Advance Tax Paid (u/s 236H)
              </h4>
              <div className="flex justify-between">
                <span>Completed Purchase Bills:</span>
                <span className="font-mono font-bold">{data.purchaseTax?.invoiceCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxable Purchase Volume:</span>
                <span className="font-mono font-bold">
                  {formatPKR(data.purchaseTax?.taxableAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Input GST Paid:</span>
                <span className="font-mono font-bold">
                  {formatPKR(data.purchaseTax?.gstPaid || 0)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-black text-teal-700">
                <span>Advance Tax Paid on Purchases:</span>
                <span className="font-mono">
                  {formatPKR(data.purchaseTax?.advanceTaxPaid || 0)}
                </span>
              </div>
            </div>
          </div>
        ) : reportKey === 'tax-history' && data && !Array.isArray(data) ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-900 text-white uppercase text-[10px]">
              <tr>
                <th className="p-3">Changed At</th>
                <th className="p-3">Tax Name</th>
                <th className="p-3 text-right">Filer Rate</th>
                <th className="p-3 text-right">Non-Filer Rate</th>
                <th className="p-3">Basis</th>
                <th className="p-3">Effective From</th>
                <th className="p-3">Reason / Changed By</th>
              </tr>
            </thead>
            <tbody>
              {(data.history || []).map((h: any) => (
                <tr key={h.id} className="border-b border-slate-200">
                  <td className="p-3 font-mono">{formatPKTDateTime(h.changed_at)}</td>
                  <td className="p-3 font-bold">{h.tax_name}</td>
                  <td className="p-3 text-right font-mono font-bold">{h.filer_rate}%</td>
                  <td className="p-3 text-right font-mono font-bold">{h.non_filer_rate}%</td>
                  <td className="p-3 font-mono">{h.calculation_basis}</td>
                  <td className="p-3 font-mono">{h.effective_from}</td>
                  <td className="p-3 text-slate-600">
                    {h.change_reason} ({h.changed_by})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900 text-white uppercase text-[10px]">
                {(reportKey === 'daily-sales' || reportKey === 'monthly-sales') && (
                  <tr>
                    <th className="p-3">{reportKey === 'daily-sales' ? 'Date' : 'Month'}</th>
                    <th className="p-3 text-right">Invoices</th>
                    <th className="p-3 text-right">Gross Sales</th>
                    <th className="p-3 text-right">Total Discount</th>
                    <th className="p-3 text-right">Tax</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Collected</th>
                    <th className="p-3 text-right">Credit Balance</th>
                  </tr>
                )}
                {reportKey === 'item-wise-sales' && (
                  <tr>
                    <th className="p-3">Item Code</th>
                    <th className="p-3">Medicine Name & Company</th>
                    <th className="p-3 text-center">Packing</th>
                    <th className="p-3 text-right">Packs Sold</th>
                    <th className="p-3 text-right text-emerald-300">Bonus Qty</th>
                    <th className="p-3 text-right">Loose Sold</th>
                    <th className="p-3 text-right">Total Units</th>
                    <th className="p-3 text-right">Discount</th>
                    <th className="p-3 text-right">Net Sales Amount</th>
                  </tr>
                )}
                {reportKey === 'customer-wise-sales' && (
                  <tr>
                    <th className="p-3">Account Code</th>
                    <th className="p-3">Customer Name</th>
                    <th className="p-3">Filer Status</th>
                    <th className="p-3 text-right">Invoices</th>
                    <th className="p-3 text-right">Gross Sales</th>
                    <th className="p-3 text-right">Discount</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Paid</th>
                    <th className="p-3 text-right">Current Ledger Balance</th>
                    <th className="p-3 text-right print:hidden">WhatsApp</th>
                  </tr>
                )}
                {reportKey === 'profit-report' && (
                  <tr>
                    <th className="p-3">Item Code</th>
                    <th className="p-3">Medicine Name</th>
                    <th className="p-3 text-center">Packing</th>
                    <th className="p-3 text-right">Net Units Sold</th>
                    <th className="p-3 text-right">Cost Amount</th>
                    <th className="p-3 text-right">Net Revenue</th>
                    <th className="p-3 text-right">Gross Profit</th>
                    <th className="p-3 text-right">Margin %</th>
                  </tr>
                )}
                {reportKey === 'discount-report' && (
                  <tr>
                    <th className="p-3">Invoice #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-right">Gross Total</th>
                    <th className="p-3 text-right">Item Discount</th>
                    <th className="p-3 text-right">Invoice Discount</th>
                    <th className="p-3 text-right">Total Discount</th>
                    <th className="p-3">Override By</th>
                  </tr>
                )}
                {reportKey === 'sales-return-report' && (
                  <tr>
                    <th className="p-3">Return #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Orig. Invoice #</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Medicine & Batch</th>
                    <th className="p-3 text-right">Returned Units</th>
                    <th className="p-3 text-right">Refund Total</th>
                    <th className="p-3">Reason</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rowsArray.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-slate-400">
                      No records found for this report.
                    </td>
                  </tr>
                ) : (
                  rowsArray.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                      {(reportKey === 'daily-sales' || reportKey === 'monthly-sales') && (
                        <>
                          <td className="p-3 font-mono font-bold">
                            {r.sale_date || r.sale_month}
                          </td>
                          <td className="p-3 text-right font-mono">{r.invoice_count}</td>
                          <td className="p-3 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                          <td className="p-3 text-right font-mono text-rose-700">
                            {formatPKR(r.total_discount)}
                          </td>
                          <td className="p-3 text-right font-mono">{formatPKR(r.total_tax)}</td>
                          <td className="p-3 text-right font-mono font-black text-emerald-700">
                            {formatPKR(r.net_sales)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {formatPKR(r.cash_collected)}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-amber-800">
                            {formatPKR(r.credit_extended)}
                          </td>
                        </>
                      )}

                      {reportKey === 'item-wise-sales' && (
                        <>
                          <td className="p-3 font-mono font-bold">{r.item_code}</td>
                          <td className="p-3 font-bold">
                            {r.item_name} <span className="text-slate-500">({r.company_name})</span>
                          </td>
                          <td className="p-3 text-center font-mono">{r.packing}</td>
                          <td className="p-3 text-right font-mono">{r.total_pack_qty}</td>
                          <td className="p-3 text-right font-mono font-semibold text-emerald-700">
                            {r.total_bonus_qty || 0}
                          </td>
                          <td className="p-3 text-right font-mono">{r.total_loose_qty}</td>
                          <td className="p-3 text-right font-mono font-bold">
                            {r.total_units_sold}
                          </td>
                          <td className="p-3 text-right font-mono text-rose-700">
                            {formatPKR(r.discount_amount)}
                          </td>
                          <td className="p-3 text-right font-mono font-black text-emerald-700">
                            {formatPKR(r.net_sales_amount)}
                          </td>
                        </>
                      )}

                      {reportKey === 'customer-wise-sales' && (
                        <>
                          <td className="p-3 font-mono font-bold">{r.customer_code}</td>
                          <td className="p-3 font-bold">{r.customer_name}</td>
                          <td className="p-3">{r.customer_filer_status}</td>
                          <td className="p-3 text-right font-mono">{r.invoice_count}</td>
                          <td className="p-3 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                          <td className="p-3 text-right font-mono text-rose-700">
                            {formatPKR(r.discount_amount)}
                          </td>
                          <td className="p-3 text-right font-mono font-black text-emerald-700">
                            {formatPKR(r.net_sales)}
                          </td>
                          <td className="p-3 text-right font-mono">{formatPKR(r.paid_amount)}</td>
                          <td className="p-3 text-right font-mono font-bold">
                            {formatPKR(r.current_ledger_balance)} {r.current_balance_type}
                          </td>
                          <td className="p-3 text-right print:hidden">
                            <WhatsAppSendButton
                              compact
                              label="WhatsApp"
                              payload={{
                                documentType: 'report',
                                documentNumber: `CUST-RPT-${r.customer_code || idx + 1}`,
                                documentDate: endDate || new Date().toISOString().slice(0, 10),
                                customerAccountId: r.customer_account_id
                                  ? Number(r.customer_account_id)
                                  : null,
                                customerName: String(r.customer_name || 'Walk-in Customer'),
                                customerPhone: String(r.customer_phone || ''),
                                totalAmount: Number(r.net_sales || 0),
                                paidAmount: Number(r.paid_amount || 0),
                                remainingBalance: Number(r.current_ledger_balance || 0),
                                balanceType: String(r.current_balance_type || 'Debit'),
                              }}
                              onPhoneSaved={(newPhone) => {
                                setData((prev: any) =>
                                  Array.isArray(prev)
                                    ? prev.map((item) =>
                                        item.customer_account_id === r.customer_account_id
                                          ? { ...item, customer_phone: newPhone }
                                          : item
                                      )
                                    : prev
                                );
                              }}
                            />
                          </td>
                        </>
                      )}

                      {reportKey === 'profit-report' && (
                        <>
                          <td className="p-3 font-mono font-bold">{r.item_code}</td>
                          <td className="p-3 font-bold">{r.item_name}</td>
                          <td className="p-3 text-center font-mono">{r.packing}</td>
                          <td className="p-3 text-right font-mono">{r.net_units_sold}</td>
                          <td className="p-3 text-right font-mono">
                            {formatPKR(r.total_cost_amount)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {formatPKR(r.net_revenue_amount)}
                          </td>
                          <td className="p-3 text-right font-mono font-black text-emerald-700">
                            {formatPKR(r.gross_profit)}
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            {r.profit_margin_percent}%
                          </td>
                        </>
                      )}

                      {reportKey === 'discount-report' && (
                        <>
                          <td className="p-3 font-mono font-bold">{r.invoice_number}</td>
                          <td className="p-3 font-mono">{r.invoice_date}</td>
                          <td className="p-3 font-bold">{r.customer_name}</td>
                          <td className="p-3 text-right font-mono">{formatPKR(r.gross_total)}</td>
                          <td className="p-3 text-right font-mono">
                            {formatPKR(r.item_discount_amount)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {formatPKR(r.invoice_discount_amount)}
                          </td>
                          <td className="p-3 text-right font-mono font-black text-rose-700">
                            {formatPKR(r.total_discount)}
                          </td>
                          <td className="p-3 text-slate-600">{r.discount_override_by || 'Standard'}</td>
                        </>
                      )}

                      {reportKey === 'sales-return-report' && (
                        <>
                          <td className="p-3 font-mono font-bold">{r.return_number}</td>
                          <td className="p-3 font-mono">{r.return_date}</td>
                          <td className="p-3 font-mono">{r.original_invoice_number}</td>
                          <td className="p-3 font-bold">{r.customer_name}</td>
                          <td className="p-3">
                            {r.item_name} ({r.batch_number})
                          </td>
                          <td className="p-3 text-right font-mono font-bold">
                            {r.returned_units}U
                          </td>
                          <td className="p-3 text-right font-mono font-black text-rose-700">
                            {formatPKR(r.line_total)}
                          </td>
                          <td className="p-3 text-slate-600">{r.return_reason}</td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};
