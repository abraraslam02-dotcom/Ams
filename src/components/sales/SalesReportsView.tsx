import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { formatPKR, formatPKTDateTime } from '../../utils/formatters';
import { BarChart3, Download, Printer, RotateCcw, AlertCircle } from 'lucide-react';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';
import { WhatsAppSendButton } from '../common/WhatsAppSendButton';
import { CompanyItemSelector } from '../common/CompanyItemSelector';

export type SalesReportKey =
  | 'company-group-sales'
  | 'yearly-sales'
  | 'monthly-sales'
  | 'customer-wise-sales'
  | 'party-monthly-sales'
  | 'yearly-party-comparison'
  | 'item-wise-sales'
  | 'salesman-wise-sales'
  | 'daily-sales'
  | 'profit-report'
  | 'discount-report'
  | 'sales-return-report'
  | 'tax-summary'
  | 'tax-history';

interface SalesReportsViewProps {
  initialReport: SalesReportKey;
}

interface FilterOption {
  id: string;
  label: string;
}

interface TownMeta {
  id: number;
  town_name: string;
  areas: Array<{ id: number; town_id: number; area_name: string }>;
}

const fmtQty = (n: unknown) => {
  const num = Number(n || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
};

export const SalesReportsView: React.FC<SalesReportsViewProps> = ({ initialReport }) => {
  const currentYear = new Date().getFullYear();

  const [reportKey, setReportKey] = useState<SalesReportKey>(initialReport);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [year1, setYear1] = useState<string>(String(currentYear - 1));
  const [year2, setYear2] = useState<string>(String(currentYear));

  // Multi-selection & dimension filters
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('ALL');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [salesmanId, setSalesmanId] = useState<string>('ALL');
  const [townName, setTownName] = useState<string>('ALL');
  const [areaName, setAreaName] = useState<string>('ALL');

  // Filter lookup metadata
  const [customers, setCustomers] = useState<FilterOption[]>([]);
  const [salesmen, setSalesmen] = useState<FilterOption[]>([]);
  const [townsMeta, setTownsMeta] = useState<TownMeta[]>([]);

  // Report payload
  const [data, setData] = useState<any>(null);
  const [companySubtotals, setCompanySubtotals] = useState<any[]>([]);
  const [partySubtotals, setPartySubtotals] = useState<any[]>([]);
  const [totals, setTotals] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const salesReportPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReportKey(initialReport);
  }, [initialReport]);

  // Load Customers, Salesmen, Towns & Areas once
  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      api.getAccounts({ ledgerView: 'customer', status: 'Active' }),
      api.getSalesmen({ status: 'Active' }),
      api.getSupplyTowns(),
    ]).then(([custRes, salRes, townRes]) => {
      if (!mounted) return;
      if (custRes.status === 'fulfilled') {
        const list = custRes.value?.accounts || [];
        setCustomers(
          list.map((c: any) => ({
            id: String(c.id),
            label: `${c.account_code ? `${c.account_code} — ` : ''}${c.account_name}`,
          }))
        );
      }
      if (salRes.status === 'fulfilled') {
        const list = salRes.value?.salesmen || salRes.value?.data || [];
        setSalesmen(
          list.map((s: any) => ({
            id: String(s.id),
            label: `${s.salesman_code ? `${s.salesman_code} — ` : ''}${s.name || s.full_name}`,
          }))
        );
      }
      if (townRes.status === 'fulfilled') {
        const list = townRes.value?.towns || [];
        setTownsMeta(
          list.map((t: any) => ({
            id: Number(t.id),
            town_name: String(t.town_name || ''),
            areas: Array.isArray(t.areas) ? t.areas : [],
          }))
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Dependent areas when town changes
  const availableAreas = useMemo(() => {
    if (townName === 'ALL') {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of townsMeta) {
        for (const a of t.areas) {
          const n = String(a.area_name || '').trim();
          if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
          }
        }
      }
      return out.sort();
    }
    const matched = townsMeta.find((t) => t.town_name === townName);
    return (matched?.areas || []).map((a) => String(a.area_name || '').trim()).filter(Boolean).sort();
  }, [townsMeta, townName]);

  const handleTownChange = (nextTown: string) => {
    setTownName(nextTown);
    setAreaName('ALL');
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setYear1(String(currentYear - 1));
    setYear2(String(currentYear));
    setSelectedCompanies([]);
    setSelectedItemIds([]);
    setSelectedItemGroup('ALL');
    setCustomerId('ALL');
    setSalesmanId('ALL');
    setTownName('ALL');
    setAreaName('ALL');
  };

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const apiReportKey = reportKey === 'tax-history' ? 'tax-summary' : reportKey;
      const res = await api.getSalesReport(apiReportKey, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        companies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        itemIds: selectedItemIds.length > 0 ? selectedItemIds : undefined,
        itemGroup: selectedItemGroup !== 'ALL' ? selectedItemGroup : undefined,
        salesmanId: salesmanId !== 'ALL' ? salesmanId : undefined,
        townName: townName !== 'ALL' ? townName : undefined,
        areaName: areaName !== 'ALL' ? areaName : undefined,
        year1: reportKey === 'yearly-party-comparison' ? year1 : undefined,
        year2: reportKey === 'yearly-party-comparison' ? year2 : undefined,
      });
      setData(res.data ?? null);
      setCompanySubtotals(Array.isArray(res.companySubtotals) ? res.companySubtotals : []);
      setPartySubtotals(Array.isArray(res.partySubtotals) ? res.partySubtotals : []);
      setTotals(res.totals ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [
    reportKey,
    startDate,
    endDate,
    customerId,
    selectedCompanies,
    selectedItemIds,
    selectedItemGroup,
    salesmanId,
    townName,
    areaName,
    year1,
    year2,
  ]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const reportTabs: Array<{ id: SalesReportKey; label: string }> = [
    { id: 'company-group-sales', label: 'Company-wise Item Group Sales' },
    { id: 'yearly-sales', label: 'Yearly Sales' },
    { id: 'monthly-sales', label: 'Month-wise Sales' },
    { id: 'customer-wise-sales', label: 'Party-wise Sales' },
    { id: 'party-monthly-sales', label: 'Party-wise Monthly Sales' },
    { id: 'yearly-party-comparison', label: 'Yearly Party Comparison' },
    { id: 'item-wise-sales', label: 'Item-wise Sales' },
    { id: 'salesman-wise-sales', label: 'Salesman-wise Sales' },
    { id: 'daily-sales', label: 'Daily Sales' },
    { id: 'profit-report', label: 'Profit Report' },
    { id: 'discount-report', label: 'Discount Report' },
    { id: 'sales-return-report', label: 'Sales Return Report' },
    { id: 'tax-summary', label: 'Tax Summary' },
    { id: 'tax-history', label: 'Tax History' },
  ];

  const activeTabLabel = reportTabs.find((t) => t.id === reportKey)?.label || 'Sales Report';
  const rowsArray: any[] = Array.isArray(data) ? data : [];

  // Map subtotals by key for inline grouped rendering
  const companySubtotalMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of companySubtotals) {
      m.set(String(s.company_name), s);
    }
    return m;
  }, [companySubtotals]);

  const partySubtotalMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of partySubtotals) {
      m.set(String(s.party_name), s);
    }
    return m;
  }, [partySubtotals]);

  // Fallback computed totals for preserved reports that return array without `totals`
  const computedTotals = useMemo(() => {
    if (totals) return totals;
    if (rowsArray.length === 0) return null;
    if (reportKey === 'daily-sales') {
      return rowsArray.reduce(
        (acc, r) => ({
          invoice_count: acc.invoice_count + Number(r.invoice_count || 0),
          gross_sales: acc.gross_sales + Number(r.gross_sales || 0),
          total_discount: acc.total_discount + Number(r.total_discount || 0),
          total_tax: acc.total_tax + Number(r.total_tax || 0),
          net_sales: acc.net_sales + Number(r.net_sales || 0),
          cash_collected: acc.cash_collected + Number(r.cash_collected || 0),
          credit_extended: acc.credit_extended + Number(r.credit_extended || 0),
        }),
        {
          invoice_count: 0,
          gross_sales: 0,
          total_discount: 0,
          total_tax: 0,
          net_sales: 0,
          cash_collected: 0,
          credit_extended: 0,
        }
      );
    }
    if (reportKey === 'profit-report') {
      const sum = rowsArray.reduce(
        (acc, r) => ({
          net_units_sold: acc.net_units_sold + Number(r.net_units_sold || 0),
          total_cost_amount: acc.total_cost_amount + Number(r.total_cost_amount || 0),
          net_revenue_amount: acc.net_revenue_amount + Number(r.net_revenue_amount || 0),
          gross_profit: acc.gross_profit + Number(r.gross_profit || 0),
        }),
        { net_units_sold: 0, total_cost_amount: 0, net_revenue_amount: 0, gross_profit: 0 }
      );
      return {
        ...sum,
        profit_margin_percent:
          sum.net_revenue_amount > 0
            ? ((sum.gross_profit / sum.net_revenue_amount) * 100).toFixed(2)
            : '0.00',
      };
    }
    if (reportKey === 'discount-report') {
      return rowsArray.reduce(
        (acc, r) => ({
          gross_total: acc.gross_total + Number(r.gross_total || 0),
          item_discount_amount: acc.item_discount_amount + Number(r.item_discount_amount || 0),
          invoice_discount_amount: acc.invoice_discount_amount + Number(r.invoice_discount_amount || 0),
          total_discount: acc.total_discount + Number(r.total_discount || 0),
        }),
        { gross_total: 0, item_discount_amount: 0, invoice_discount_amount: 0, total_discount: 0 }
      );
    }
    if (reportKey === 'sales-return-report') {
      return rowsArray.reduce(
        (acc, r) => ({
          return_pack_qty: acc.return_pack_qty + Number(r.return_pack_qty || 0),
          return_bonus_qty: acc.return_bonus_qty + Number(r.return_bonus_qty || 0),
          line_total: acc.line_total + Number(r.line_total || 0),
        }),
        { return_pack_qty: 0, return_bonus_qty: 0, line_total: 0 }
      );
    }
    return null;
  }, [totals, rowsArray, reportKey]);

  const handleExportExcel = () => {
    let exportRows: any[] = [];
    if (Array.isArray(data)) {
      exportRows = rowsArray.map((r) => {
        if (reportKey === 'item-wise-sales') {
          const { total_loose_qty: _ignored1, total_units_sold: _ignored2, ...rest } = r;
          return {
            'Item Code': rest.item_code,
            'Item Name': rest.item_name,
            Company: rest.company_name,
            'Item Group': rest.item_group,
            Packing: rest.packing,
            Invoices: rest.invoice_count,
            'Sale Qty (Full Packs)': rest.total_pack_qty,
            'Bonus Qty': rest.total_bonus_qty || 0,
            'Return Qty (Full Packs)': rest.return_qty || 0,
            'Gross Amount': rest.gross_amount,
            Discount: rest.discount_amount,
            'Sales Return': rest.sales_return || 0,
            'Net Sales': rest.net_sales_amount,
          };
        }
        if (reportKey === 'sales-return-report') {
          return {
            'Return #': r.return_number,
            Date: r.return_date,
            'Orig. Invoice #': r.original_invoice_number,
            Party: r.customer_name,
            Company: r.company_name,
            'Item Name': r.item_name,
            'Batch #': r.batch_number,
            'Return Qty (Full Packs)': r.return_pack_qty,
            'Bonus Qty': r.return_bonus_qty || 0,
            'Refund Total': r.line_total,
            Reason: r.return_reason,
          };
        }
        return r;
      });
      if (computedTotals) {
        exportRows.push({
          ...computedTotals,
          _summary_row: 'GRAND TOTAL',
        });
      }
    } else if (reportKey === 'tax-history') {
      exportRows = data?.history || [];
    } else {
      exportRows = [data?.salesTax || {}, data?.purchaseTax || {}];
    }

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Report');
    if (companySubtotals.length > 0) {
      const wsSub = XLSX.utils.json_to_sheet(companySubtotals);
      XLSX.utils.book_append_sheet(wb, wsSub, 'Company Subtotals');
    }
    if (partySubtotals.length > 0) {
      const wsParty = XLSX.utils.json_to_sheet(partySubtotals);
      XLSX.utils.book_append_sheet(wb, wsParty, 'Party Subtotals');
    }
    XLSX.writeFile(wb, `AMS_${reportKey}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handlePrint = () => {
    if (salesReportPrintRef.current) {
      printReportDocument(salesReportPrintRef.current, `Abrar Medical Store - ${activeTabLabel}`, {
        paperSize: 'a4',
        orientation: 'landscape',
        margin: 'compact',
        fontSizeScale: 'small',
      });
    } else {
      window.print();
    }
  };

  const showCompanyItemFilter =
    reportKey !== 'tax-summary' &&
    reportKey !== 'tax-history' &&
    reportKey !== 'daily-sales' &&
    reportKey !== 'discount-report' &&
    reportKey !== 'sales-return-report';

  return (
    <div className="space-y-4">
      {/* Top Report Selector & Date Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Sales, Profit, Party & Company Analytics Suite (Full Pack Standard)
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {reportKey === 'yearly-party-comparison' ? (
              <>
                <label className="font-semibold text-slate-600">Base Year:</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={year1}
                  onChange={(e) => setYear1(e.target.value)}
                  className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
                <label className="font-semibold text-slate-600">Compare Year:</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={year2}
                  onChange={(e) => setYear2(e.target.value)}
                  className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </>
            ) : (
              <>
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
              </>
            )}

            <button
              type="button"
              onClick={handleResetFilters}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4
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

        {/* Report Type Tabs */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
          {reportTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReportKey(t.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                reportKey === t.id
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Dimension Filters (Party, Salesman, Town, Dependent Area) */}
        {reportKey !== 'tax-summary' && reportKey !== 'tax-history' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Party / Customer
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
              >
                <option value="ALL">All Parties / Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Salesman
              </label>
              <select
                value={salesmanId}
                onChange={(e) => setSalesmanId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
              >
                <option value="ALL">All Salesmen</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Town
              </label>
              <select
                value={townName}
                onChange={(e) => handleTownChange(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
              >
                <option value="ALL">All Towns</option>
                {townsMeta.map((t) => (
                  <option key={t.id} value={t.town_name}>
                    {t.town_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Area (Dependent on Town)
              </label>
              <select
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800"
              >
                <option value="ALL">All Areas</option>
                {availableAreas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Reusable Advanced Multi-Company & Multi-Item Selection */}
        {showCompanyItemFilter && (
          <CompanyItemSelector
            theme="light"
            defaultExpanded={false}
            selectedCompanies={selectedCompanies}
            onChangeCompanies={setSelectedCompanies}
            selectedItemIds={selectedItemIds}
            onChangeItemIds={setSelectedItemIds}
            selectedItemGroup={selectedItemGroup}
            onChangeItemGroup={setSelectedItemGroup}
            title="Filter by Multiple Companies, Item Group, or Specific Items"
          />
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 print:hidden">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Printable Report Content */}
      <div ref={salesReportPrintRef} className="space-y-4">
        <PrintDocumentHeader
          title={activeTabLabel.toUpperCase()}
          subtitle="Official Sales & Commercial Analytics Statement (Quantities in Full Packs)"
          metaItems={[
            { label: 'Report', value: activeTabLabel },
            reportKey === 'yearly-party-comparison'
              ? { label: 'Comparison Years', value: `${year1} vs ${year2}` }
              : { label: 'Date Range', value: `${startDate || 'Start'} to ${endDate || 'Current'}` },
            {
              label: 'Scope',
              value:
                selectedCompanies.length > 0
                  ? `${selectedCompanies.length} Company(s)`
                  : townName !== 'ALL'
                  ? `Town: ${townName}`
                  : 'All Store Records',
            },
            { label: 'Generated', value: formatPKTDateTime(new Date().toISOString()) },
          ]}
        />

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs">
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading report data...</div>
          ) : reportKey === 'tax-summary' && data && !Array.isArray(data) ? (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  {reportKey === 'company-group-sales' && (
                    <tr>
                      <th className="p-2.5">Company</th>
                      <th className="p-2.5">Item Group</th>
                      <th className="p-2.5 text-right">Invoices</th>
                      <th className="p-2.5 text-right">Sale Qty (Packs)</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus Qty</th>
                      <th className="p-2.5 text-right">Return Qty</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Sales Return</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                    </tr>
                  )}

                  {(reportKey === 'yearly-sales' || reportKey === 'monthly-sales') && (
                    <tr>
                      <th className="p-2.5">{reportKey === 'yearly-sales' ? 'Year' : 'Month'}</th>
                      <th className="p-2.5 text-right">Invoices</th>
                      <th className="p-2.5 text-right">Sale Qty (Packs)</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus Qty</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Sales Return</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Tax</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                      <th className="p-2.5 text-right">Received</th>
                      <th className="p-2.5 text-right">Outstanding</th>
                    </tr>
                  )}

                  {reportKey === 'customer-wise-sales' && (
                    <tr>
                      <th className="p-2.5">Party Code</th>
                      <th className="p-2.5">Party Name</th>
                      <th className="p-2.5">Town / Area</th>
                      <th className="p-2.5">Salesman</th>
                      <th className="p-2.5 text-right">Inv</th>
                      <th className="p-2.5 text-right">Sale Qty</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Return</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                      <th className="p-2.5 text-right">Received</th>
                      <th className="p-2.5 text-right">Ledger Balance</th>
                      <th className="p-2.5 text-right print:hidden">Action</th>
                    </tr>
                  )}

                  {reportKey === 'party-monthly-sales' && (
                    <tr>
                      <th className="p-2.5">Party Code</th>
                      <th className="p-2.5">Party Name</th>
                      <th className="p-2.5">Town / Area</th>
                      <th className="p-2.5">Month</th>
                      <th className="p-2.5 text-right">Invoices</th>
                      <th className="p-2.5 text-right">Sale Qty</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Return</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                      <th className="p-2.5 text-right">Received</th>
                    </tr>
                  )}

                  {reportKey === 'yearly-party-comparison' && (
                    <tr>
                      <th className="p-2.5">Party Code</th>
                      <th className="p-2.5">Party Name</th>
                      <th className="p-2.5">Town / Area</th>
                      <th className="p-2.5 text-right">{year1} Qty</th>
                      <th className="p-2.5 text-right">{year1} Net Sales</th>
                      <th className="p-2.5 text-right">{year2} Qty</th>
                      <th className="p-2.5 text-right">{year2} Net Sales</th>
                      <th className="p-2.5 text-right">Qty Diff</th>
                      <th className="p-2.5 text-right">Amount Diff</th>
                      <th className="p-2.5 text-right">Growth %</th>
                    </tr>
                  )}

                  {reportKey === 'item-wise-sales' && (
                    <tr>
                      <th className="p-2.5">Item Code</th>
                      <th className="p-2.5">Item Name</th>
                      <th className="p-2.5">Company</th>
                      <th className="p-2.5">Item Group</th>
                      <th className="p-2.5 text-center">Packing</th>
                      <th className="p-2.5 text-right">Inv</th>
                      <th className="p-2.5 text-right">Sale Qty (Packs)</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus Qty</th>
                      <th className="p-2.5 text-right">Return Qty</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Sales Return</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                    </tr>
                  )}

                  {reportKey === 'salesman-wise-sales' && (
                    <tr>
                      <th className="p-2.5">Code</th>
                      <th className="p-2.5">Salesman</th>
                      <th className="p-2.5 text-right">Parties</th>
                      <th className="p-2.5 text-right">Invoices</th>
                      <th className="p-2.5 text-right">Sale Qty</th>
                      <th className="p-2.5 text-right text-emerald-300">Bonus</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Return</th>
                      <th className="p-2.5 text-right">Discount</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                      <th className="p-2.5 text-right">Received</th>
                      <th className="p-2.5 text-right">Outstanding</th>
                    </tr>
                  )}

                  {reportKey === 'daily-sales' && (
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5 text-right">Invoices</th>
                      <th className="p-2.5 text-right">Gross Sales</th>
                      <th className="p-2.5 text-right">Total Discount</th>
                      <th className="p-2.5 text-right">Tax</th>
                      <th className="p-2.5 text-right">Net Sales</th>
                      <th className="p-2.5 text-right">Collected</th>
                      <th className="p-2.5 text-right">Credit Balance</th>
                    </tr>
                  )}

                  {reportKey === 'profit-report' && (
                    <tr>
                      <th className="p-2.5">Item Code</th>
                      <th className="p-2.5">Medicine Name & Company</th>
                      <th className="p-2.5 text-center">Packing</th>
                      <th className="p-2.5 text-right">Net Packs Sold</th>
                      <th className="p-2.5 text-right">Cost Amount</th>
                      <th className="p-2.5 text-right">Net Revenue</th>
                      <th className="p-2.5 text-right">Gross Profit</th>
                      <th className="p-2.5 text-right">Margin %</th>
                    </tr>
                  )}

                  {reportKey === 'discount-report' && (
                    <tr>
                      <th className="p-2.5">Invoice #</th>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5">Customer</th>
                      <th className="p-2.5 text-right">Gross Total</th>
                      <th className="p-2.5 text-right">Item Discount</th>
                      <th className="p-2.5 text-right">Invoice Discount</th>
                      <th className="p-2.5 text-right">Total Discount</th>
                      <th className="p-2.5">Override By</th>
                    </tr>
                  )}

                  {reportKey === 'sales-return-report' && (
                    <tr>
                      <th className="p-2.5">Return #</th>
                      <th className="p-2.5">Date</th>
                      <th className="p-2.5">Orig. Invoice #</th>
                      <th className="p-2.5">Party</th>
                      <th className="p-2.5">Company</th>
                      <th className="p-2.5">Medicine & Batch</th>
                      <th className="p-2.5 text-right">Return Qty (Packs)</th>
                      <th className="p-2.5 text-right">Bonus Qty</th>
                      <th className="p-2.5 text-right">Refund Total</th>
                      <th className="p-2.5">Reason</th>
                    </tr>
                  )}
                </thead>

                <tbody>
                  {rowsArray.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-6 text-center text-slate-400">
                        No records found for this report and filter selection.
                      </td>
                    </tr>
                  ) : (
                    rowsArray.map((r: any, idx: number) => {
                      const nextRow = rowsArray[idx + 1];
                      const showCompanySubtotal =
                        (reportKey === 'company-group-sales' || reportKey === 'item-wise-sales') &&
                        (!nextRow || nextRow.company_name !== r.company_name) &&
                        companySubtotalMap.has(String(r.company_name));
                      const cSub = showCompanySubtotal
                        ? companySubtotalMap.get(String(r.company_name))
                        : null;

                      const showPartySubtotal =
                        reportKey === 'party-monthly-sales' &&
                        (!nextRow || nextRow.party_name !== r.party_name) &&
                        partySubtotalMap.has(String(r.party_name));
                      const pSub = showPartySubtotal ? partySubtotalMap.get(String(r.party_name)) : null;

                      return (
                        <React.Fragment key={idx}>
                          <tr className="border-b border-slate-200 hover:bg-slate-50">
                            {reportKey === 'company-group-sales' && (
                              <>
                                <td className="p-2.5 font-bold text-slate-900">{r.company_name}</td>
                                <td className="p-2.5 font-semibold text-slate-700">{r.item_group}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.sale_qty)}</td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 font-semibold">
                                  {fmtQty(r.bonus_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-600">{fmtQty(r.return_qty)}</td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                              </>
                            )}

                            {(reportKey === 'yearly-sales' || reportKey === 'monthly-sales') && (
                              <>
                                <td className="p-2.5 font-mono font-bold">
                                  {r.sale_year || r.sale_month}
                                </td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.sale_qty)}</td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 font-semibold">
                                  {fmtQty(r.bonus_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount ?? r.total_discount)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.total_tax)}</td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.received_amount ?? r.cash_collected)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold text-amber-800">
                                  {formatPKR(r.outstanding_balance ?? r.credit_extended)}
                                </td>
                              </>
                            )}

                            {reportKey === 'customer-wise-sales' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.party_code || r.customer_code}</td>
                                <td className="p-2.5 font-bold text-slate-900">
                                  {r.party_name || r.customer_name}
                                  <div className="text-[10px] font-normal text-slate-500">
                                    {r.customer_filer_status}
                                  </div>
                                </td>
                                <td className="p-2.5 text-slate-700">
                                  {r.town_name || '—'}
                                  {r.area_name && r.area_name !== '—' ? ` / ${r.area_name}` : ''}
                                </td>
                                <td className="p-2.5 text-slate-700">{r.salesman_name || 'Counter'}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.sale_qty)}</td>
                                <td className="p-2.5 text-right font-mono text-emerald-700">
                                  {fmtQty(r.bonus_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.received_amount ?? r.paid_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {formatPKR(r.current_ledger_balance)} {r.current_balance_type}
                                </td>
                                <td className="p-2.5 text-right print:hidden">
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

                            {reportKey === 'party-monthly-sales' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.party_code}</td>
                                <td className="p-2.5 font-bold text-slate-900">{r.party_name}</td>
                                <td className="p-2.5 text-slate-600">
                                  {r.town_name}
                                  {r.area_name && r.area_name !== '—' ? ` / ${r.area_name}` : ''}
                                </td>
                                <td className="p-2.5 font-mono font-semibold">{r.sale_month}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.sale_qty)}</td>
                                <td className="p-2.5 text-right font-mono text-emerald-700">
                                  {fmtQty(r.bonus_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.received_amount)}</td>
                              </>
                            )}

                            {reportKey === 'yearly-party-comparison' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.party_code}</td>
                                <td className="p-2.5 font-bold text-slate-900">{r.party_name}</td>
                                <td className="p-2.5 text-slate-600">
                                  {r.town_name}
                                  {r.area_name && r.area_name !== '—' ? ` / ${r.area_name}` : ''}
                                </td>
                                <td className="p-2.5 text-right font-mono">{fmtQty(r.year1_qty)}</td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.year1_net_sales)}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.year2_qty)}</td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {formatPKR(r.year2_net_sales)}
                                </td>
                                <td
                                  className={`p-2.5 text-right font-mono font-bold ${
                                    Number(r.variance_qty) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {Number(r.variance_qty) >= 0 ? '+' : ''}
                                  {fmtQty(r.variance_qty)}
                                </td>
                                <td
                                  className={`p-2.5 text-right font-mono font-black ${
                                    Number(r.variance_amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {Number(r.variance_amount) >= 0 ? '+' : ''}
                                  {formatPKR(r.variance_amount)}
                                </td>
                                <td
                                  className={`p-2.5 text-right font-mono font-bold ${
                                    Number(r.growth_percent) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {Number(r.growth_percent) >= 0 ? '+' : ''}
                                  {r.growth_percent}%
                                </td>
                              </>
                            )}

                            {reportKey === 'item-wise-sales' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.item_code}</td>
                                <td className="p-2.5 font-bold text-slate-900">{r.item_name}</td>
                                <td className="p-2.5 text-slate-700">{r.company_name}</td>
                                <td className="p-2.5 text-slate-600">{r.item_group}</td>
                                <td className="p-2.5 text-center font-mono">{r.packing}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {fmtQty(r.total_pack_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-semibold text-emerald-700">
                                  {fmtQty(r.total_bonus_qty || 0)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-600">
                                  {fmtQty(r.return_qty || 0)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_amount)}</td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return || 0)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales_amount)}
                                </td>
                              </>
                            )}

                            {reportKey === 'salesman-wise-sales' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.salesman_code}</td>
                                <td className="p-2.5 font-bold text-slate-900">{r.salesman_name}</td>
                                <td className="p-2.5 text-right font-mono">{r.party_count}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono font-bold">{fmtQty(r.sale_qty)}</td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 font-semibold">
                                  {fmtQty(r.bonus_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-amber-700">
                                  {formatPKR(r.sales_return)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.received_amount)}</td>
                                <td className="p-2.5 text-right font-mono font-bold text-amber-800">
                                  {formatPKR(r.outstanding_balance)}
                                </td>
                              </>
                            )}

                            {reportKey === 'daily-sales' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.sale_date}</td>
                                <td className="p-2.5 text-right font-mono">{r.invoice_count}</td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_sales)}</td>
                                <td className="p-2.5 text-right font-mono text-rose-700">
                                  {formatPKR(r.total_discount)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.total_tax)}</td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.net_sales)}
                                </td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.cash_collected)}</td>
                                <td className="p-2.5 text-right font-mono font-bold text-amber-800">
                                  {formatPKR(r.credit_extended)}
                                </td>
                              </>
                            )}

                            {reportKey === 'profit-report' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.item_code}</td>
                                <td className="p-2.5 font-bold">
                                  {r.item_name}{' '}
                                  {r.company_name && (
                                    <span className="text-slate-500 font-normal">({r.company_name})</span>
                                  )}
                                </td>
                                <td className="p-2.5 text-center font-mono">{r.packing}</td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {fmtQty(r.net_packs_sold ?? r.net_units_sold)}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.total_cost_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.net_revenue_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-emerald-700">
                                  {formatPKR(r.gross_profit)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {r.profit_margin_percent}%
                                </td>
                              </>
                            )}

                            {reportKey === 'discount-report' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.invoice_number}</td>
                                <td className="p-2.5 font-mono">{r.invoice_date}</td>
                                <td className="p-2.5 font-bold">{r.customer_name}</td>
                                <td className="p-2.5 text-right font-mono">{formatPKR(r.gross_total)}</td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.item_discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatPKR(r.invoice_discount_amount)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-rose-700">
                                  {formatPKR(r.total_discount)}
                                </td>
                                <td className="p-2.5 text-slate-600">{r.discount_override_by || 'Standard'}</td>
                              </>
                            )}

                            {reportKey === 'sales-return-report' && (
                              <>
                                <td className="p-2.5 font-mono font-bold">{r.return_number}</td>
                                <td className="p-2.5 font-mono">{r.return_date}</td>
                                <td className="p-2.5 font-mono">{r.original_invoice_number}</td>
                                <td className="p-2.5 font-bold">{r.customer_name}</td>
                                <td className="p-2.5 text-slate-700">{r.company_name || 'General'}</td>
                                <td className="p-2.5">
                                  {r.item_name} <span className="text-slate-500">({r.batch_number})</span>
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold">
                                  {fmtQty(r.return_pack_qty)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-emerald-700 font-semibold">
                                  {fmtQty(r.return_bonus_qty || 0)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-black text-rose-700">
                                  {formatPKR(r.line_total)}
                                </td>
                                <td className="p-2.5 text-slate-600">{r.return_reason}</td>
                              </>
                            )}
                          </tr>

                          {/* Inline Company Subtotal Row for company-group-sales */}
                          {reportKey === 'company-group-sales' && cSub && (
                            <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-900">
                              <td colSpan={2} className="p-2 text-right uppercase text-[11px]">
                                Subtotal — {r.company_name}
                              </td>
                              <td className="p-2 text-right font-mono">{cSub.invoice_count}</td>
                              <td className="p-2 text-right font-mono">{fmtQty(cSub.sale_qty)}</td>
                              <td className="p-2 text-right font-mono text-emerald-800">{fmtQty(cSub.bonus_qty)}</td>
                              <td className="p-2 text-right font-mono text-rose-700">{fmtQty(cSub.return_qty)}</td>
                              <td className="p-2 text-right font-mono">{formatPKR(cSub.gross_sales)}</td>
                              <td className="p-2 text-right font-mono text-rose-700">
                                {formatPKR(cSub.discount_amount)}
                              </td>
                              <td className="p-2 text-right font-mono text-amber-800">
                                {formatPKR(cSub.sales_return)}
                              </td>
                              <td className="p-2 text-right font-mono font-black text-emerald-800">
                                {formatPKR(cSub.net_sales)}
                              </td>
                            </tr>
                          )}

                          {/* Inline Company Subtotal Row for item-wise-sales */}
                          {reportKey === 'item-wise-sales' && cSub && (
                            <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-900">
                              <td colSpan={5} className="p-2 text-right uppercase text-[11px]">
                                Company Subtotal — {r.company_name}
                              </td>
                              <td className="p-2 text-right font-mono">{cSub.invoice_count}</td>
                              <td className="p-2 text-right font-mono">{fmtQty(cSub.total_pack_qty)}</td>
                              <td className="p-2 text-right font-mono text-emerald-800">
                                {fmtQty(cSub.total_bonus_qty)}
                              </td>
                              <td className="p-2 text-right font-mono text-rose-700">{fmtQty(cSub.return_qty)}</td>
                              <td className="p-2 text-right font-mono">{formatPKR(cSub.gross_amount)}</td>
                              <td className="p-2 text-right font-mono text-rose-700">
                                {formatPKR(cSub.discount_amount)}
                              </td>
                              <td className="p-2 text-right font-mono text-amber-800">
                                {formatPKR(cSub.sales_return)}
                              </td>
                              <td className="p-2 text-right font-mono font-black text-emerald-800">
                                {formatPKR(cSub.net_sales_amount)}
                              </td>
                            </tr>
                          )}

                          {/* Inline Party Subtotal Row for party-monthly-sales */}
                          {reportKey === 'party-monthly-sales' && pSub && (
                            <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-900">
                              <td colSpan={4} className="p-2 text-right uppercase text-[11px]">
                                Party Subtotal — {r.party_name}
                              </td>
                              <td className="p-2 text-right font-mono">{pSub.invoice_count}</td>
                              <td className="p-2 text-right font-mono">{fmtQty(pSub.sale_qty)}</td>
                              <td className="p-2 text-right font-mono text-emerald-800">{fmtQty(pSub.bonus_qty)}</td>
                              <td className="p-2 text-right font-mono">{formatPKR(pSub.gross_sales)}</td>
                              <td className="p-2 text-right font-mono text-amber-800">
                                {formatPKR(pSub.sales_return)}
                              </td>
                              <td className="p-2 text-right font-mono text-rose-700">
                                {formatPKR(pSub.discount_amount)}
                              </td>
                              <td className="p-2 text-right font-mono font-black text-emerald-800">
                                {formatPKR(pSub.net_sales)}
                              </td>
                              <td className="p-2 text-right font-mono">{formatPKR(pSub.received_amount)}</td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>

                {/* Grand Totals Footer */}
                {rowsArray.length > 0 && computedTotals && (
                  <tfoot className="bg-slate-900 text-white font-bold text-xs">
                    {reportKey === 'company-group-sales' && (
                      <tr>
                        <td colSpan={2} className="p-3 uppercase">
                          Grand Total ({rowsArray.length} Groups)
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.sale_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.return_qty)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                      </tr>
                    )}

                    {(reportKey === 'yearly-sales' || reportKey === 'monthly-sales') && (
                      <tr>
                        <td className="p-3 uppercase">Grand Total</td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.sale_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.total_tax)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.received_amount)}</td>
                        <td className="p-3 text-right font-mono text-amber-300">
                          {formatPKR(computedTotals.outstanding_balance)}
                        </td>
                      </tr>
                    )}

                    {reportKey === 'customer-wise-sales' && (
                      <tr>
                        <td colSpan={4} className="p-3 uppercase">
                          Grand Total ({rowsArray.length} Parties)
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.sale_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.received_amount)}</td>
                        <td className="p-3 text-right font-mono text-amber-300">
                          {formatPKR(computedTotals.outstanding_balance)}
                        </td>
                        <td className="p-3 print:hidden" />
                      </tr>
                    )}

                    {reportKey === 'party-monthly-sales' && (
                      <tr>
                        <td colSpan={4} className="p-3 uppercase">
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.sale_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.received_amount)}</td>
                      </tr>
                    )}

                    {reportKey === 'yearly-party-comparison' && (
                      <tr>
                        <td colSpan={3} className="p-3 uppercase">
                          Grand Total ({rowsArray.length} Parties)
                        </td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.year1_qty)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.year1_net_sales)}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.year2_qty)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.year2_net_sales)}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.variance_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.variance_amount)}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {Number(computedTotals.year1_net_sales) > 0
                            ? `${(
                                (Number(computedTotals.variance_amount) /
                                  Number(computedTotals.year1_net_sales)) *
                                100
                              ).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    )}

                    {reportKey === 'item-wise-sales' && (
                      <tr>
                        <td colSpan={5} className="p-3 uppercase">
                          Grand Total ({rowsArray.length} Items)
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.total_pack_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.total_bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.return_qty)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales_amount)}
                        </td>
                      </tr>
                    )}

                    {reportKey === 'salesman-wise-sales' && (
                      <tr>
                        <td colSpan={2} className="p-3 uppercase">
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.party_count}</td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.sale_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.sales_return)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.discount_amount)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.received_amount)}</td>
                        <td className="p-3 text-right font-mono text-amber-300">
                          {formatPKR(computedTotals.outstanding_balance)}
                        </td>
                      </tr>
                    )}

                    {reportKey === 'daily-sales' && (
                      <tr>
                        <td className="p-3 uppercase">Grand Total</td>
                        <td className="p-3 text-right font-mono">{computedTotals.invoice_count}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_sales)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.total_discount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.total_tax)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.net_sales)}
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.cash_collected)}</td>
                        <td className="p-3 text-right font-mono text-amber-300">
                          {formatPKR(computedTotals.credit_extended)}
                        </td>
                      </tr>
                    )}

                    {reportKey === 'profit-report' && (
                      <tr>
                        <td colSpan={3} className="p-3 uppercase">
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.net_units_sold)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.total_cost_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.net_revenue_amount)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {formatPKR(computedTotals.gross_profit)}
                        </td>
                        <td className="p-3 text-right font-mono">{computedTotals.profit_margin_percent}%</td>
                      </tr>
                    )}

                    {reportKey === 'discount-report' && (
                      <tr>
                        <td colSpan={3} className="p-3 uppercase">
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.gross_total)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.item_discount_amount)}</td>
                        <td className="p-3 text-right font-mono">{formatPKR(computedTotals.invoice_discount_amount)}</td>
                        <td className="p-3 text-right font-mono text-rose-300">
                          {formatPKR(computedTotals.total_discount)}
                        </td>
                        <td className="p-3" />
                      </tr>
                    )}

                    {reportKey === 'sales-return-report' && (
                      <tr>
                        <td colSpan={6} className="p-3 uppercase">
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-mono">{fmtQty(computedTotals.return_pack_qty)}</td>
                        <td className="p-3 text-right font-mono text-emerald-300">
                          {fmtQty(computedTotals.return_bonus_qty)}
                        </td>
                        <td className="p-3 text-right font-mono text-rose-300">
                          {formatPKR(computedTotals.line_total)}
                        </td>
                        <td className="p-3" />
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
