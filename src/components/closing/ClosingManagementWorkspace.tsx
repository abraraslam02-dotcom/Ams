import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  FileText,
  Printer,
  Download,
  RefreshCw,
  Search,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Package,
  Users,
  Building2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Eye,
  X,
  Settings,
  Calculator,
  BookOpen,
  History,
  CheckSquare,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { printReportDocument } from '../../utils/printEngine';
import { NavTabId } from '../layout/Sidebar';

export type ClosingTabId =
  | 'closing-daily'
  | 'closing-monthly'
  | 'closing-yearly'
  | 'closing-stock'
  | 'closing-history'
  | 'closing-reopen';

interface ClosingManagementWorkspaceProps {
  initialTab?: ClosingTabId;
  onNavigateTab?: (tab: NavTabId) => void;
}

const fmtCurrency = (val: any): string => {
  const num = Number(val) || 0;
  return `Rs. ${num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtNum = (val: any): string => {
  const num = Number(val) || 0;
  return num.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const ClosingManagementWorkspace: React.FC<ClosingManagementWorkspaceProps> = ({
  initialTab = 'closing-daily',
  onNavigateTab,
}) => {
  const { user, isSuperAdmin, hasPermission } = useAuth();
  const canPerformClosing = isSuperAdmin || hasPermission('closing', 'can_create') || hasPermission('accounts', 'can_create');
  const canExportClosing = isSuperAdmin || hasPermission('closing', 'can_export') || hasPermission('reports', 'can_export') || true;

  const [activeSubTab, setActiveSubTab] = useState<ClosingTabId>(initialTab);
  const [loading, setLoading] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Overview state
  const [overview, setOverview] = useState<any>(null);

  // 1. Daily Closing state
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dailyDate, setDailyDate] = useState<string>(todayStr);
  const [dailyData, setDailyData] = useState<any>(null);
  const [actualPhysicalCash, setActualPhysicalCash] = useState<string>('');
  const [discrepancyReason, setDiscrepancyReason] = useState<string>('');
  const [dailyNotes, setDailyNotes] = useState<string>('');
  const [postDiscrepancyEntry, setPostDiscrepancyEntry] = useState<boolean>(false);

  // 2. Monthly Closing state
  const currentMonthStr = todayStr.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [monthlyStart, setMonthlyStart] = useState<string>(`${currentMonthStr}-01`);
  const [monthlyEnd, setMonthlyEnd] = useState<string>(() => {
    const [y, m] = currentMonthStr.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${currentMonthStr}-${String(lastDay).padStart(2, '0')}`;
  });
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [monthlyReportTab, setMonthlyReportTab] = useState<
    'summary' | 'customers' | 'suppliers' | 'accounts' | 'stock' | 'reconciliation'
  >('summary');
  const [lockMonthlyPeriod, setLockMonthlyPeriod] = useState<boolean>(true);
  const [monthlyNotes, setMonthlyNotes] = useState<string>('');
  const [partySearch, setPartySearch] = useState<string>('');

  // 3. Yearly Closing state
  const [fyStartDate, setFyStartDate] = useState<string>('');
  const [fyEndDate, setFyEndDate] = useState<string>('');
  const [fyCostingMethod, setFyCostingMethod] = useState<'AVERAGE' | 'FIFO'>('AVERAGE');
  const [yearlyData, setYearlyData] = useState<any>(null);
  const [yearlyReportTab, setYearlyReportTab] = useState<'summary' | 'customers' | 'suppliers' | 'accounts' | 'stock'>('summary');
  const [lockYearlyPeriod, setLockYearlyPeriod] = useState<boolean>(true);
  const [advanceToNextYear, setAdvanceToNextYear] = useState<boolean>(true);
  const [yearlyNotes, setYearlyNotes] = useState<string>('');
  const [savingFyConfig, setSavingFyConfig] = useState<boolean>(false);

  // 4. Stock Closing state
  const [stockStart, setStockStart] = useState<string>(`${currentMonthStr}-01`);
  const [stockEnd, setStockEnd] = useState<string>(todayStr);
  const [stockCostingMethod, setStockCostingMethod] = useState<'AVERAGE' | 'FIFO'>('AVERAGE');
  const [stockData, setStockData] = useState<any>(null);
  const [stockSearch, setStockSearch] = useState<string>('');
  const [stockNotes, setStockNotes] = useState<string>('');

  // 5. Closing History & Detailed Report Viewer state
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyPeriods, setHistoryPeriods] = useState<any[]>([]);
  const [historyAuditLogs, setHistoryAuditLogs] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>('ALL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');
  const [selectedClosingDetail, setSelectedClosingDetail] = useState<any>(null);
  const [detailReportTab, setDetailReportTab] = useState<
    'summary' | 'pnl' | 'cash_bank' | 'customers' | 'suppliers' | 'stock' | 'audit'
  >('summary');

  // 6. Reopen Closed Period state
  const [reopenTargetId, setReopenTargetId] = useState<number | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');

  const printContainerRef = useRef<HTMLDivElement | null>(null);
  const modalPrintRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialTab && initialTab !== activeSubTab) {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  const switchSubTab = (tab: ClosingTabId) => {
    setActiveSubTab(tab);
    setMessage(null);
    if (onNavigateTab) {
      onNavigateTab(tab);
    }
  };

  const loadOverview = async () => {
    try {
      const res = await api.getClosingOverview();
      setOverview(res);
      if (res?.company_settings) {
        if (!fyStartDate && res.company_settings.current_financial_year_start) {
          setFyStartDate(res.company_settings.current_financial_year_start);
        }
        if (!fyEndDate && res.company_settings.current_financial_year_end) {
          setFyEndDate(res.company_settings.current_financial_year_end);
        }
        if (res.company_settings.costing_method) {
          setFyCostingMethod(res.company_settings.costing_method);
          setStockCostingMethod(res.company_settings.costing_method);
        }
      }
    } catch (err: any) {
      console.error('Failed to load closing overview:', err);
    }
  };

  const loadDailyPreview = async (dateToLoad = dailyDate) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.previewDailyClosing(dateToLoad);
      setDailyData(res);
      if (res?.existing_closing) {
        setActualPhysicalCash(String(res.existing_closing.actual_physical_cash ?? res.expected_cash ?? 0));
        setDiscrepancyReason(res.existing_closing.cash_discrepancy_reason || '');
        setDailyNotes(res.existing_closing.notes || '');
      } else {
        setActualPhysicalCash(String(res?.expected_cash ?? 0));
        setDiscrepancyReason('');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to calculate daily closing preview.' });
    } finally {
      setLoading(false);
    }
  };

  const loadMonthlyPreview = async (m = selectedMonth, s = monthlyStart, e = monthlyEnd) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.previewMonthlyClosing({ month: m, start_date: s, end_date: e });
      setMonthlyData(res);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to calculate monthly closing preview.' });
    } finally {
      setLoading(false);
    }
  };

  const loadYearlyPreview = async (s?: string, e?: string, method?: 'AVERAGE' | 'FIFO') => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.previewYearlyClosing({
        start_date: s || fyStartDate || undefined,
        end_date: e || fyEndDate || undefined,
        costing_method: method || fyCostingMethod,
      });
      setYearlyData(res);
      if (res?.period_start && !s) setFyStartDate(res.period_start);
      if (res?.period_end && !e) setFyEndDate(res.period_end);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to calculate yearly closing preview.' });
    } finally {
      setLoading(false);
    }
  };

  const loadStockPreview = async (s = stockStart, e = stockEnd, method = stockCostingMethod) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.previewStockClosing({ start_date: s, end_date: e, costing_method: method });
      setStockData(res);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to calculate stock closing preview.' });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.getClosingHistory({
        closing_type: historyTypeFilter !== 'ALL' ? historyTypeFilter : undefined,
        status: historyStatusFilter !== 'ALL' ? historyStatusFilter : undefined,
        start_date: historyStartDate || undefined,
        end_date: historyEndDate || undefined,
        search: historySearch || undefined,
      });
      setHistoryItems(res.items || []);
      setHistoryPeriods(res.periods || []);
      setHistoryAuditLogs(res.audit_logs || []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load closing history.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    if (activeSubTab === 'closing-daily') {
      loadDailyPreview(dailyDate);
    } else if (activeSubTab === 'closing-monthly') {
      loadMonthlyPreview(selectedMonth, monthlyStart, monthlyEnd);
    } else if (activeSubTab === 'closing-yearly') {
      loadYearlyPreview();
    } else if (activeSubTab === 'closing-stock') {
      loadStockPreview(stockStart, stockEnd, stockCostingMethod);
    } else if (activeSubTab === 'closing-history' || activeSubTab === 'closing-reopen') {
      loadHistory();
    }
  }, [activeSubTab]);

  const handleMonthPickerChange = (newMonth: string) => {
    setSelectedMonth(newMonth);
    if (/^\d{4}-\d{2}$/.test(newMonth)) {
      const [y, m] = newMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const s = `${newMonth}-01`;
      const e = `${newMonth}-${String(lastDay).padStart(2, '0')}`;
      setMonthlyStart(s);
      setMonthlyEnd(e);
      loadMonthlyPreview(newMonth, s, e);
    }
  };

  // Calculated cash difference for Daily Closing
  const expectedCashVal = Number(dailyData?.expected_cash || 0);
  const actualCashVal = actualPhysicalCash === '' ? expectedCashVal : Number(actualPhysicalCash);
  const cashDifference = Math.round((actualCashVal - expectedCashVal) * 100) / 100;

  const handleExecuteDailyClosing = async () => {
    if (!canPerformClosing) {
      setMessage({ type: 'error', text: 'You do not have permission to perform closing.' });
      return;
    }
    if (Math.abs(cashDifference) >= 0.01 && !discrepancyReason.trim()) {
      setMessage({
        type: 'error',
        text: `Physical cash differs from expected cash by ${fmtCurrency(cashDifference)}. Please enter a mandatory discrepancy explanation.`,
      });
      return;
    }
    setExecuting(true);
    setMessage(null);
    try {
      const res = await api.executeDailyClosing({
        date: dailyDate,
        actual_physical_cash: actualCashVal,
        cash_discrepancy_reason: discrepancyReason.trim(),
        notes: dailyNotes.trim(),
        post_discrepancy_adjustment: postDiscrepancyEntry,
      });
      setMessage({ type: 'success', text: res.message || `Daily Closing (${res.closing_code}) completed successfully.` });
      await loadDailyPreview(dailyDate);
      await loadOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to execute daily closing.' });
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteMonthlyClosing = async () => {
    if (!canPerformClosing) {
      setMessage({ type: 'error', text: 'You do not have permission to perform monthly closing.' });
      return;
    }
    setExecuting(true);
    setMessage(null);
    try {
      const res = await api.executeMonthlyClosing({
        month: selectedMonth,
        start_date: monthlyStart,
        end_date: monthlyEnd,
        costing_method: fyCostingMethod,
        lock_period: lockMonthlyPeriod,
        notes: monthlyNotes.trim(),
      });
      setMessage({
        type: 'success',
        text:
          res.message ||
          `Monthly Closing (${res.closing_code}) completed. All customer, supplier, cash, bank, financial account, and inventory balances carried forward to the next period.`,
      });
      await loadMonthlyPreview(selectedMonth, monthlyStart, monthlyEnd);
      await loadOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to execute monthly closing.' });
    } finally {
      setExecuting(false);
    }
  };

  const handleSaveFinancialYearConfig = async () => {
    if (!fyStartDate || !fyEndDate) {
      setMessage({ type: 'error', text: 'Please select both Financial Year Start Date and End Date.' });
      return;
    }
    setSavingFyConfig(true);
    setMessage(null);
    try {
      const res = await api.updateFinancialYearConfig({
        start_date: fyStartDate,
        end_date: fyEndDate,
        costing_method: fyCostingMethod,
      });
      setMessage({ type: 'success', text: res.message || 'Financial year configuration updated.' });
      await loadYearlyPreview(fyStartDate, fyEndDate, fyCostingMethod);
      await loadOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update financial year dates.' });
    } finally {
      setSavingFyConfig(false);
    }
  };

  const handleExecuteYearlyClosing = async () => {
    if (!canPerformClosing) {
      setMessage({ type: 'error', text: 'You do not have permission to perform yearly closing.' });
      return;
    }
    setExecuting(true);
    setMessage(null);
    try {
      const res = await api.executeYearlyClosing({
        start_date: fyStartDate,
        end_date: fyEndDate,
        costing_method: fyCostingMethod,
        lock_period: lockYearlyPeriod,
        advance_financial_year: advanceToNextYear,
        notes: yearlyNotes.trim(),
      });
      setMessage({
        type: 'success',
        text:
          res.message ||
          `Yearly Closing (${res.closing_code}) completed. Annual profit/loss transferred and opening balances generated for ${res.next_financial_year?.start_date} to ${res.next_financial_year?.end_date}.`,
      });
      await loadOverview();
      await loadYearlyPreview(fyStartDate, fyEndDate, fyCostingMethod);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to execute yearly closing.' });
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteStockClosing = async () => {
    if (!canPerformClosing) {
      setMessage({ type: 'error', text: 'You do not have permission to perform stock closing.' });
      return;
    }
    setExecuting(true);
    setMessage(null);
    try {
      const res = await api.executeStockClosing({
        start_date: stockStart,
        end_date: stockEnd,
        costing_method: stockCostingMethod,
        notes: stockNotes.trim(),
      });
      setMessage({
        type: 'success',
        text: res.message || `Stock Closing (${res.closing_code}) saved successfully.`,
      });
      await loadStockPreview(stockStart, stockEnd, stockCostingMethod);
      await loadOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to execute stock closing.' });
    } finally {
      setExecuting(false);
    }
  };

  const handleOpenClosingDetail = async (id: number) => {
    setLoading(true);
    try {
      const detail = await api.getClosingDetailById(id);
      setSelectedClosingDetail(detail);
      setDetailReportTab('summary');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load closing report details.' });
    } finally {
      setLoading(false);
    }
  };

  const handleReopenPeriod = async (closingId: number) => {
    if (!isSuperAdmin) {
      setMessage({ type: 'error', text: 'Only Super Admin is authorized to reopen a closed financial period.' });
      return;
    }
    if (!reopenReason || reopenReason.trim().length < 5) {
      setMessage({
        type: 'error',
        text: 'A mandatory reason (minimum 5 characters) is required to reopen a closed period.',
      });
      return;
    }
    setExecuting(true);
    setMessage(null);
    try {
      const res = await api.reopenClosedPeriod(closingId, reopenReason.trim());
      setMessage({ type: 'success', text: res.message || 'Closed period reopened and logged in audit trail.' });
      setReopenTargetId(null);
      setReopenReason('');
      await loadHistory();
      await loadOverview();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to reopen period.' });
    } finally {
      setExecuting(false);
    }
  };

  // Multi-sheet Excel export for any closing dataset (Live Preview or Historical Closing)
  const exportClosingWorkbook = (dataset: any, labelPrefix: string) => {
    if (!dataset) return;
    const wb = XLSX.utils.book_new();

    // 1. Financial Summary & Profit/Loss Sheet
    const summaryRows = [
      ['ABRAR MEDICAL STORE - FINANCIAL CLOSING REPORT'],
      ['Report Type', labelPrefix],
      ['Period Start Date', dataset.period_start || dataset.date || ''],
      ['Period End Date', dataset.period_end || dataset.date || ''],
      ['Generated At', new Date().toLocaleString()],
      [],
      ['METRIC', 'AMOUNT (PKR)'],
      ['Opening Cash Balance', Number(dataset.opening_cash || 0)],
      ['Opening Bank Balance', Number(dataset.opening_bank || 0)],
      ['Total Sales (Gross)', Number(dataset.total_sales ?? dataset.cash_sales ?? 0)],
      ['Sales Returns', Number(dataset.sales_returns || 0)],
      ['Net Sales Revenue', Number(dataset.net_sales ?? dataset.total_sales ?? dataset.cash_sales ?? 0)],
      ['Total Purchases', Number(dataset.total_purchases ?? dataset.cash_purchases ?? 0)],
      ['Purchase Returns', Number(dataset.purchase_returns || 0)],
      ['Net Purchases', Number(dataset.net_purchases ?? dataset.total_purchases ?? 0)],
      ['Cost of Goods Sold (COGS)', Number(dataset.cogs || 0)],
      ['Gross Profit', Number(dataset.gross_profit || 0)],
      ['Total Operating Expenses', Number(dataset.total_expenses ?? dataset.expenses ?? 0)],
      ['Other Income', Number(dataset.other_income ?? dataset.income ?? 0)],
      ['Net Profit / (Loss)', Number(dataset.net_profit_loss || 0)],
      ['Closing Cash Balance', Number(dataset.closing_cash || 0)],
      ['Actual Physical Cash', Number(dataset.actual_physical_cash ?? dataset.closing_cash ?? 0)],
      ['Cash Discrepancy', Number(dataset.cash_difference || 0)],
      ['Closing Bank Balance', Number(dataset.closing_bank || 0)],
      ['Total Customer Receivables', Number(dataset.total_receivables || 0)],
      ['Total Supplier Payables', Number(dataset.total_payables || 0)],
      ['Closing Inventory Quantity', Number(dataset.closing_inventory_qty ?? dataset.totals?.closing_quantity ?? 0)],
      ['Closing Inventory Valuation', Number(dataset.closing_inventory_value ?? dataset.totals?.closing_valuation ?? 0)],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Financial_Summary');

    // 2. Customer Carry Forward Sheet
    const customerList =
      dataset.customer_carry_forward ||
      (dataset.account_snapshots || []).filter((a: any) => a.snapshot_group === 'CUSTOMER');
    if (customerList && customerList.length > 0) {
      const custRows = customerList.map((c: any, idx: number) => ({
        'S.No': idx + 1,
        'Account Code': c.account_code,
        'Customer Name': c.account_name,
        Town: c.town_name || '-',
        Area: c.area_name || '-',
        'Opening Balance': Number(c.opening_balance || 0),
        'Period Debit': Number(c.period_debit || 0),
        'Period Credit': Number(c.period_credit || 0),
        'Closing Balance': Number(c.closing_balance || 0),
        'Carried Forward Next Period': Number(c.carried_forward_balance ?? c.closing_balance ?? 0),
      }));
      const wsCust = XLSX.utils.json_to_sheet(custRows);
      XLSX.utils.book_append_sheet(wb, wsCust, 'Customer_Carry_Forward');
    }

    // 3. Supplier Carry Forward Sheet
    const supplierList =
      dataset.supplier_carry_forward ||
      (dataset.account_snapshots || []).filter((a: any) => a.snapshot_group === 'SUPPLIER');
    if (supplierList && supplierList.length > 0) {
      const suppRows = supplierList.map((s: any, idx: number) => ({
        'S.No': idx + 1,
        'Account Code': s.account_code,
        'Supplier Name': s.account_name,
        Town: s.town_name || '-',
        Area: s.area_name || '-',
        'Opening Balance': Number(s.opening_balance || 0),
        'Period Debit': Number(s.period_debit || 0),
        'Period Credit': Number(s.period_credit || 0),
        'Closing Balance (Net)': Number(s.closing_balance || 0),
        'Payable Balance': Number(s.payable_balance ?? Math.max(0, -Number(s.closing_balance || 0))),
        'Carried Forward Next Period': Number(s.carried_forward_balance ?? s.closing_balance ?? 0),
      }));
      const wsSupp = XLSX.utils.json_to_sheet(suppRows);
      XLSX.utils.book_append_sheet(wb, wsSupp, 'Supplier_Carry_Forward');
    }

    // 4. Cash & Bank Reconciliation Sheet
    const cashBankList =
      dataset.cash_and_bank_carry_forward ||
      (dataset.account_snapshots || []).filter((a: any) => a.snapshot_group === 'CASH' || a.snapshot_group === 'BANK');
    if (cashBankList && cashBankList.length > 0) {
      const cbRows = cashBankList.map((a: any, idx: number) => ({
        'S.No': idx + 1,
        'Account Code': a.account_code,
        'Account Name': a.account_name,
        Category: a.snapshot_group || a.account_category || 'CASH/BANK',
        'Opening Balance': Number(a.opening_balance || 0),
        'Total Inflows (Debit)': Number(a.period_debit || 0),
        'Total Outflows (Credit)': Number(a.period_credit || 0),
        'Closing Balance': Number(a.closing_balance || 0),
        'Carried Forward Balance': Number(a.carried_forward_balance ?? a.closing_balance ?? 0),
      }));
      const wsCb = XLSX.utils.json_to_sheet(cbRows);
      XLSX.utils.book_append_sheet(wb, wsCb, 'Cash_Bank_Reconciliation');
    }

    // 5. Stock Valuation Sheet
    const stockList = dataset.stock_valuation?.items || dataset.items || dataset.stock_snapshots || [];
    if (stockList && stockList.length > 0) {
      const stRows = stockList.map((item: any, idx: number) => ({
        'S.No': idx + 1,
        'Item Code': item.item_code,
        'Item Name': item.item_name,
        Company: item.company_name || '-',
        'Opening Qty': Number(item.opening_quantity || 0),
        'Purchased Qty': Number(item.purchased_quantity || 0),
        'Sold Qty': Number(item.sold_quantity || 0),
        'Purchase Returns': Number(item.purchase_return_quantity || 0),
        'Sales Returns': Number(item.sales_return_quantity || 0),
        Adjustments: Number(item.adjustment_quantity || 0),
        'Closing Qty': Number(item.closing_quantity || 0),
        'Costing Method': item.costing_method || 'AVERAGE',
        'Unit Cost': Number(item.unit_cost || 0),
        'Closing Valuation (PKR)': Number(item.closing_valuation || 0),
      }));
      const wsStock = XLSX.utils.json_to_sheet(stRows);
      XLSX.utils.book_append_sheet(wb, wsStock, 'Stock_Valuation');
    }

    const safeFileName = `${labelPrefix.replace(/[^a-zA-Z0-9_-]/g, '_')}_${
      dataset.period_end || dataset.date || todayStr
    }.xlsx`;
    XLSX.writeFile(wb, safeFileName);
  };

  const handlePrintActiveSection = (title: string, orientation: 'portrait' | 'landscape' = 'portrait') => {
    printReportDocument(printContainerRef.current, title, {
      orientation,
      subtitle: `Abrar Medical Store • Financial Period & Closing Report • Generated by ${user?.full_name || user?.username || 'System'}`,
    });
  };

  const handlePrintModalReport = (title: string, orientation: 'portrait' | 'landscape' = 'portrait') => {
    printReportDocument(modalPrintRef.current, title, {
      orientation,
      subtitle: `Abrar Medical Store • Official Historical Closing Snapshot • Generated by ${user?.full_name || user?.username || 'System'}`,
    });
  };

  // Filtered stock items for Stock Closing tab
  const filteredStockItems = useMemo(() => {
    const items = stockData?.items || [];
    if (!stockSearch.trim()) return items;
    const q = stockSearch.toLowerCase();
    return items.filter(
      (it: any) =>
        String(it.item_code || '').toLowerCase().includes(q) ||
        String(it.item_name || '').toLowerCase().includes(q) ||
        String(it.company_name || '').toLowerCase().includes(q)
    );
  }, [stockData, stockSearch]);

  // Filtered party list helper for Monthly / Yearly tabs
  const filterPartyRows = (rows: any[]) => {
    if (!rows) return [];
    if (!partySearch.trim()) return rows;
    const q = partySearch.toLowerCase();
    return rows.filter(
      (r: any) =>
        String(r.account_code || '').toLowerCase().includes(q) ||
        String(r.account_name || '').toLowerCase().includes(q) ||
        String(r.town_name || '').toLowerCase().includes(q) ||
        String(r.area_name || '').toLowerCase().includes(q)
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Sub-Navigation Banner */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Closing & Financial Period Management
                </h2>
                <p className="text-xs text-slate-500">
                  Daily Cash Reconciliation, Monthly & Yearly Financial Closing, Stock Valuation Snapshots, Carry-Forward Engine & Period Locking
                </p>
              </div>
            </div>
          </div>

          {/* Quick Status Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Active FY:{' '}
                <strong>
                  {overview?.company_settings?.current_financial_year_start || '2025-07-01'} →{' '}
                  {overview?.company_settings?.current_financial_year_end || '2026-06-30'}
                </strong>
              </span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Locked Periods:{' '}
                <strong>
                  {(overview?.locked_periods || []).filter((p: any) => Number(p.is_closed) === 1).length}
                </strong>
              </span>
            </div>
            <div
              className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 font-medium ${
                isSuperAdmin
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isSuperAdmin ? 'Super Admin (Full Closing & Reopen Access)' : user?.role_name || 'Authorized User'}</span>
            </div>
          </div>
        </div>

        {/* 6 Module Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          {[
            { id: 'closing-daily', label: '1. Daily Closing', icon: Calculator },
            { id: 'closing-monthly', label: '2. Monthly Closing', icon: Calendar },
            { id: 'closing-yearly', label: '3. Yearly Closing', icon: BookOpen },
            { id: 'closing-stock', label: '4. Stock Closing', icon: Package },
            { id: 'closing-history', label: '5. Closing History & Reports', icon: History },
            { id: 'closing-reopen', label: '6. Reopen Closed Period', icon: Unlock },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchSubTab(tab.id as ClosingTabId)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback Banner */}
      {message && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
            message.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : message.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          <div className="flex items-start gap-2.5 text-sm">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span className="font-medium">{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =====================================================================
          MODULE 1: DAILY CLOSING
         ===================================================================== */}
      {activeSubTab === 'closing-daily' && (
        <div className="space-y-6" ref={printContainerRef}>
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end justify-between gap-4 no-print">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Select Closing Date
                </label>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(e) => {
                    setDailyDate(e.target.value);
                    loadDailyPreview(e.target.value);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <button
                onClick={() => loadDailyPreview(dailyDate)}
                disabled={loading}
                className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Recalculate</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canExportClosing && (
                <>
                  <button
                    onClick={() => handlePrintActiveSection(`Daily Closing Report - ${dailyDate}`, 'portrait')}
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-600" />
                    <span>Print A4 / PDF</span>
                  </button>
                  <button
                    onClick={() => exportClosingWorkbook(dailyData, 'Daily_Closing')}
                    className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Existing Daily Closing Status Notice */}
          {dailyData?.existing_closing && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900">
                    Daily Closing Already Recorded ({dailyData.existing_closing.closing_code})
                  </h4>
                  <p className="text-xs text-amber-700">
                    Closed on {dailyData.existing_closing.closed_at} by{' '}
                    <strong>{dailyData.existing_closing.closed_by_username}</strong> • Actual Physical Cash:{' '}
                    <strong>{fmtCurrency(dailyData.existing_closing.actual_physical_cash)}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleOpenClosingDetail(dailyData.existing_closing.id)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 no-print"
              >
                View Snapshot Report
              </button>
            </div>
          )}

          {/* Daily Calculation KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Opening Cash Balance</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{fmtCurrency(dailyData?.opening_cash)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Prior to {dailyDate}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Cash Sales (Direct)</p>
              <p className="text-lg font-bold text-emerald-700 mt-1">{fmtCurrency(dailyData?.cash_sales)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Total Sales: {fmtCurrency(dailyData?.total_sales)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Cash Purchases (Direct)</p>
              <p className="text-lg font-bold text-rose-700 mt-1">{fmtCurrency(dailyData?.cash_purchases)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Total Purchases: {fmtCurrency(dailyData?.total_purchases)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Total Cash Receipts (In)</p>
              <p className="text-lg font-bold text-emerald-600 mt-1">{fmtCurrency(dailyData?.cash_receipts)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Includes recoveries & cash sales</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Total Cash Payments (Out)</p>
              <p className="text-lg font-bold text-rose-600 mt-1">{fmtCurrency(dailyData?.cash_payments)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Includes supplier & expense payouts</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Daily Operating Expenses</p>
              <p className="text-lg font-bold text-amber-700 mt-1">{fmtCurrency(dailyData?.expenses)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Posted to Expense heads</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Other Income</p>
              <p className="text-lg font-bold text-blue-700 mt-1">{fmtCurrency(dailyData?.income)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Non-invoice revenue</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Bank Net Movement</p>
              <p className="text-lg font-bold text-indigo-700 mt-1">
                {fmtCurrency(dailyData?.bank_transactions?.net_movement)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                In: {fmtCurrency(dailyData?.bank_transactions?.deposits)} | Out:{' '}
                {fmtCurrency(dailyData?.bank_transactions?.withdrawals)}
              </p>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-emerald-800">Expected Closing Cash</p>
              <p className="text-lg font-extrabold text-emerald-900 mt-1">
                {fmtCurrency(dailyData?.closing_cash)}
              </p>
              <p className="text-[11px] text-emerald-700 mt-1">System book cash balance</p>
            </div>
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-blue-800">Closing Bank Balance</p>
              <p className="text-lg font-extrabold text-blue-900 mt-1">
                {fmtCurrency(dailyData?.closing_bank)}
              </p>
              <p className="text-[11px] text-blue-700 mt-1">
                Opening Bank: {fmtCurrency(dailyData?.opening_bank)}
              </p>
            </div>
          </div>

          {/* Physical Cash Verification & Discrepancy Form */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Physical Cash Verification & Sign-Off</h3>
                  <p className="text-xs text-slate-500">
                    Compare system expected cash against physical drawer count
                  </p>
                </div>
                <DollarSign className="w-5 h-5 text-emerald-600" />
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 block">System Expected Cash</span>
                  <span className="text-base font-bold text-slate-900">{fmtCurrency(expectedCashVal)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Cash Difference</span>
                  <span
                    className={`text-base font-bold ${
                      Math.abs(cashDifference) < 0.01
                        ? 'text-emerald-600'
                        : cashDifference > 0
                        ? 'text-blue-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {cashDifference > 0 ? '+' : ''}
                    {fmtCurrency(cashDifference)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Actual Physical Cash Count (PKR) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={actualPhysicalCash}
                  disabled={Boolean(dailyData?.existing_closing)}
                  onChange={(e) => setActualPhysicalCash(e.target.value)}
                  placeholder="Enter physical cash counted in drawer"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100"
                />
              </div>

              {Math.abs(cashDifference) >= 0.01 && (
                <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      Cash Discrepancy Detected ({cashDifference > 0 ? 'Excess' : 'Shortage'}:{' '}
                      {fmtCurrency(Math.abs(cashDifference))})
                    </span>
                  </div>
                  <label className="block text-xs font-semibold text-rose-900">
                    Mandatory Explanation for Cash Discrepancy *
                  </label>
                  <textarea
                    rows={2}
                    value={discrepancyReason}
                    disabled={Boolean(dailyData?.existing_closing)}
                    onChange={(e) => setDiscrepancyReason(e.target.value)}
                    placeholder="Explain the reason for the cash difference (required to close day)..."
                    className="w-full px-3 py-2 rounded-lg border border-rose-300 text-xs focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                  />
                  {!dailyData?.existing_closing && (
                    <label className="flex items-center gap-2 text-xs text-rose-900 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={postDiscrepancyEntry}
                        onChange={(e) => setPostDiscrepancyEntry(e.target.checked)}
                        className="rounded border-rose-400 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Also post automatic Cash Over/Short adjustment entry to General Ledger</span>
                    </label>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Closing Remarks / Notes</label>
                <input
                  type="text"
                  value={dailyNotes}
                  disabled={Boolean(dailyData?.existing_closing)}
                  onChange={(e) => setDailyNotes(e.target.value)}
                  placeholder="Optional daily closing handover notes..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100"
                />
              </div>

              {!dailyData?.existing_closing && (
                <button
                  onClick={handleExecuteDailyClosing}
                  disabled={executing || !canPerformClosing}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all no-print"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{executing ? 'Processing Daily Closing...' : `Confirm & Execute Daily Closing (${dailyDate})`}</span>
                </button>
              )}
            </div>

            {/* Cash & Bank Account Breakdown Table */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Cash & Bank Account Reconciliation ({dailyDate})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Account-wise opening, daily inflows, daily outflows, and closing balances
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2.5 px-3 text-left font-semibold">Code</th>
                      <th className="py-2.5 px-3 text-left font-semibold">Account Name</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Opening</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Receipts (Dr)</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Payments (Cr)</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Closing Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...(dailyData?.cash_accounts || []), ...(dailyData?.bank_accounts || [])].map((acc: any) => (
                      <tr key={acc.account_id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono text-slate-600">{acc.account_code}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{acc.account_name}</td>
                        <td className="py-2.5 px-3 text-right">{fmtCurrency(acc.opening_balance)}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 font-medium">
                          {fmtCurrency(acc.period_debit)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-700 font-medium">
                          {fmtCurrency(acc.period_credit)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          {fmtCurrency(acc.closing_balance)}
                        </td>
                      </tr>
                    ))}
                    {(!dailyData?.cash_accounts?.length && !dailyData?.bank_accounts?.length) && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          No cash or bank ledger accounts found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 2: MONTHLY CLOSING & CARRY FORWARD
         ===================================================================== */}
      {activeSubTab === 'closing-monthly' && (
        <div className="space-y-6" ref={printContainerRef}>
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end justify-between gap-4 no-print">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Closing Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => handleMonthPickerChange(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Period Start</label>
                <input
                  type="date"
                  value={monthlyStart}
                  onChange={(e) => setMonthlyStart(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Period End</label>
                <input
                  type="date"
                  value={monthlyEnd}
                  onChange={(e) => setMonthlyEnd(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <button
                onClick={() => loadMonthlyPreview(selectedMonth, monthlyStart, monthlyEnd)}
                disabled={loading}
                className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Calculate Monthly Closing</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canExportClosing && (
                <>
                  <button
                    onClick={() =>
                      handlePrintActiveSection(
                        `Monthly Financial Closing Report (${monthlyStart} to ${monthlyEnd})`,
                        'landscape'
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print A4 / PDF</span>
                  </button>
                  <button
                    onClick={() => exportClosingWorkbook(monthlyData, `Monthly_Closing_${selectedMonth}`)}
                    className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Multi-Sheet Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Existing Monthly Closing Banner */}
          {monthlyData?.existing_closing && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900">
                    Period {monthlyStart} to {monthlyEnd} is Already Closed ({monthlyData.existing_closing.closing_code})
                  </h4>
                  <p className="text-xs text-amber-700">
                    Closed by <strong>{monthlyData.existing_closing.closed_by_username}</strong> on{' '}
                    {monthlyData.existing_closing.closed_at}. Transactions in this period are locked. Super Admin can reopen from the Reopen tab if required.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleOpenClosingDetail(monthlyData.existing_closing.id)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 no-print"
              >
                View Official Closing Report
              </button>
            </div>
          )}

          {/* 14-Metric Complete Monthly Financial Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Total Sales</p>
              <p className="text-sm font-bold text-slate-900 mt-1">{fmtCurrency(monthlyData?.total_sales)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Total Purchases</p>
              <p className="text-sm font-bold text-slate-900 mt-1">{fmtCurrency(monthlyData?.total_purchases)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Sales Returns</p>
              <p className="text-sm font-bold text-amber-700 mt-1">{fmtCurrency(monthlyData?.sales_returns)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Purchase Returns</p>
              <p className="text-sm font-bold text-indigo-700 mt-1">{fmtCurrency(monthlyData?.purchase_returns)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Gross Profit</p>
              <p className="text-sm font-bold text-emerald-700 mt-1">{fmtCurrency(monthlyData?.gross_profit)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Total Expenses</p>
              <p className="text-sm font-bold text-rose-700 mt-1">{fmtCurrency(monthlyData?.total_expenses)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Other Income</p>
              <p className="text-sm font-bold text-blue-700 mt-1">{fmtCurrency(monthlyData?.other_income)}</p>
            </div>

            <div
              className={`rounded-xl border p-3.5 shadow-sm ${
                Number(monthlyData?.net_profit_loss || 0) >= 0
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-rose-50 border-rose-200'
              }`}
            >
              <p className="text-[11px] font-semibold text-slate-700">Net Profit / Loss</p>
              <p
                className={`text-sm font-extrabold mt-1 ${
                  Number(monthlyData?.net_profit_loss || 0) >= 0 ? 'text-emerald-800' : 'text-rose-800'
                }`}
              >
                {fmtCurrency(monthlyData?.net_profit_loss)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Cash Balance (CF)</p>
              <p className="text-sm font-bold text-slate-900 mt-1">{fmtCurrency(monthlyData?.cash_balance)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Bank Balance (CF)</p>
              <p className="text-sm font-bold text-slate-900 mt-1">{fmtCurrency(monthlyData?.bank_balance)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Total Receivables (CF)</p>
              <p className="text-sm font-bold text-emerald-700 mt-1">{fmtCurrency(monthlyData?.total_receivables)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Total Payables (CF)</p>
              <p className="text-sm font-bold text-rose-700 mt-1">{fmtCurrency(monthlyData?.total_payables)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-medium text-slate-500">Closing Inventory Qty</p>
              <p className="text-sm font-bold text-slate-900 mt-1">
                {fmtNum(monthlyData?.closing_inventory_qty)} Units
              </p>
            </div>
            <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-3.5 shadow-sm">
              <p className="text-[11px] font-semibold text-indigo-800">Inventory Valuation (CF)</p>
              <p className="text-sm font-extrabold text-indigo-900 mt-1">
                {fmtCurrency(monthlyData?.closing_inventory_value)}
              </p>
            </div>
          </div>

          {/* Carry Forward Execution Box */}
          {!monthlyData?.existing_closing && (
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 no-print">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Opening Balance Carry-Forward & Period Lock Guarantee
                  </h3>
                </div>
                <p className="text-xs text-slate-600">
                  Executing Monthly Closing will snapshot and carry forward{' '}
                  <strong>{(monthlyData?.customer_carry_forward || []).length} customer balances</strong>,{' '}
                  <strong>{(monthlyData?.supplier_carry_forward || []).length} supplier balances</strong>, cash & bank balances, financial accounts, and{' '}
                  <strong>{fmtNum(monthlyData?.closing_inventory_qty)} inventory units</strong> as exact opening balances for the next month starting{' '}
                  <strong>{monthlyData?.carry_forward_Verification?.next_period_opening_date || 'next period'}</strong>. Customer and supplier balances are never reset to zero.
                </p>
                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lockMonthlyPeriod}
                      onChange={(e) => setLockMonthlyPeriod(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Lock period ({monthlyStart} to {monthlyEnd}) against new/edited transactions</span>
                  </label>
                  <input
                    type="text"
                    value={monthlyNotes}
                    onChange={(e) => setMonthlyNotes(e.target.value)}
                    placeholder="Optional monthly closing remarks..."
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-72"
                  />
                </div>
              </div>
              <button
                onClick={handleExecuteMonthlyClosing}
                disabled={executing || !canPerformClosing}
                className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-xs shadow-sm flex items-center gap-2 shrink-0"
              >
                <Lock className="w-4 h-4" />
                <span>{executing ? 'Closing Month...' : `Execute Monthly Closing (${selectedMonth})`}</span>
              </button>
            </div>
          )}

          {/* Detailed Monthly Closing Reports Sub-Tabs */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-4 pt-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50 no-print">
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { id: 'summary', label: 'Detailed Financial & Profit/Loss Report' },
                  {
                    id: 'customers',
                    label: `Customer Balance Carry-Forward (${(monthlyData?.customer_carry_forward || []).length})`,
                  },
                  {
                    id: 'suppliers',
                    label: `Supplier Balance Carry-Forward (${(monthlyData?.supplier_carry_forward || []).length})`,
                  },
                  { id: 'reconciliation', label: 'Cash & Bank Reconciliation' },
                  { id: 'accounts', label: 'Financial Accounts Carry-Forward' },
                  { id: 'stock', label: 'Stock Valuation Report' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setMonthlyReportTab(t.id as any)}
                    className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${
                      monthlyReportTab === t.id
                        ? 'border-emerald-600 text-emerald-700 bg-white'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {(monthlyReportTab === 'customers' || monthlyReportTab === 'suppliers') && (
                <div className="pb-2">
                  <input
                    type="text"
                    value={partySearch}
                    onChange={(e) => setPartySearch(e.target.value)}
                    placeholder="Filter by Code, Party Name, Town..."
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-60 bg-white"
                  />
                </div>
              )}
            </div>

            <div className="p-5">
              {monthlyReportTab === 'summary' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Profit & Loss Statement */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                      Monthly Profit & Loss Statement ({monthlyStart} to {monthlyEnd})
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Gross Sales Revenue</span>
                        <span className="font-semibold">{fmtCurrency(monthlyData?.total_sales)}</span>
                      </div>
                      <div className="flex justify-between py-1 text-rose-700">
                        <span>Less: Sales Returns</span>
                        <span>({fmtCurrency(monthlyData?.sales_returns)})</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-t border-slate-100 font-bold text-slate-900">
                        <span>Net Sales Revenue</span>
                        <span>{fmtCurrency(monthlyData?.net_sales)}</span>
                      </div>
                      <div className="flex justify-between py-1 text-slate-600">
                        <span>Less: Cost of Goods Sold (COGS)</span>
                        <span>({fmtCurrency(monthlyData?.cogs)})</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-t border-slate-100 font-bold text-emerald-800 bg-emerald-50/60 px-2 rounded">
                        <span>Gross Profit</span>
                        <span>{fmtCurrency(monthlyData?.gross_profit)}</span>
                      </div>
                      <div className="flex justify-between py-1 text-blue-700">
                        <span>Add: Other Operating Income</span>
                        <span>+{fmtCurrency(monthlyData?.other_income)}</span>
                      </div>
                      <div className="flex justify-between py-1 text-rose-700">
                        <span>Less: Total Operating Expenses</span>
                        <span>({fmtCurrency(monthlyData?.total_expenses)})</span>
                      </div>
                      <div className="flex justify-between py-2 border-t-2 border-slate-300 font-extrabold text-sm text-slate-900">
                        <span>Net Profit / (Loss) for Period</span>
                        <span
                          className={
                            Number(monthlyData?.net_profit_loss || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }
                        >
                          {fmtCurrency(monthlyData?.net_profit_loss)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Balance Carry-Forward Summary */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                      Next Period Opening Balance Carry-Forward Summary
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Next Period Opening Date</span>
                        <span className="font-bold text-emerald-700">
                          {monthlyData?.carry_forward_Verification?.next_period_opening_date || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Cash Balance Carried Forward</span>
                        <span className="font-semibold">{fmtCurrency(monthlyData?.cash_balance)}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Bank Balance Carried Forward</span>
                        <span className="font-semibold">{fmtCurrency(monthlyData?.bank_balance)}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Customer Receivables Carried Forward</span>
                        <span className="font-semibold text-emerald-700">
                          {fmtCurrency(monthlyData?.total_receivables)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Supplier Payables Carried Forward</span>
                        <span className="font-semibold text-rose-700">
                          {fmtCurrency(monthlyData?.total_payables)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Inventory Quantity Carried Forward</span>
                        <span className="font-semibold">{fmtNum(monthlyData?.closing_inventory_qty)} Units</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-t border-slate-100 font-bold text-indigo-900 bg-indigo-50/60 px-2 rounded">
                        <span>Inventory Valuation Carried Forward</span>
                        <span>{fmtCurrency(monthlyData?.closing_inventory_value)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {monthlyReportTab === 'customers' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left">#</th>
                        <th className="py-2.5 px-3 text-left">Account Code</th>
                        <th className="py-2.5 px-3 text-left">Customer Name</th>
                        <th className="py-2.5 px-3 text-left">Town / Area</th>
                        <th className="py-2.5 px-3 text-right">Opening Balance</th>
                        <th className="py-2.5 px-3 text-right">Period Debit</th>
                        <th className="py-2.5 px-3 text-right">Period Credit</th>
                        <th className="py-2.5 px-3 text-right">Closing Balance</th>
                        <th className="py-2.5 px-3 text-right bg-emerald-50 text-emerald-900">
                          Next Month Opening (CF)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filterPartyRows(monthlyData?.customer_carry_forward || []).map((c: any, i: number) => (
                        <tr key={c.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{c.account_code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{c.account_name}</td>
                          <td className="py-2 px-3 text-slate-500">
                            {c.town_name || '-'} {c.area_name ? `/ ${c.area_name}` : ''}
                          </td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(c.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(c.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(c.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtCurrency(c.closing_balance)}</td>
                          <td className="py-2 px-3 text-right font-extrabold text-emerald-800 bg-emerald-50/50">
                            {fmtCurrency(c.carried_forward_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {monthlyReportTab === 'suppliers' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left">#</th>
                        <th className="py-2.5 px-3 text-left">Account Code</th>
                        <th className="py-2.5 px-3 text-left">Supplier Name</th>
                        <th className="py-2.5 px-3 text-left">Town / Area</th>
                        <th className="py-2.5 px-3 text-right">Opening Balance</th>
                        <th className="py-2.5 px-3 text-right">Period Debit</th>
                        <th className="py-2.5 px-3 text-right">Period Credit</th>
                        <th className="py-2.5 px-3 text-right">Net Payable</th>
                        <th className="py-2.5 px-3 text-right bg-indigo-50 text-indigo-900">
                          Next Month Opening (CF)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filterPartyRows(monthlyData?.supplier_carry_forward || []).map((s: any, i: number) => (
                        <tr key={s.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{s.account_code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{s.account_name}</td>
                          <td className="py-2 px-3 text-slate-500">
                            {s.town_name || '-'} {s.area_name ? `/ ${s.area_name}` : ''}
                          </td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(s.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(s.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(s.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold text-rose-700">
                            {fmtCurrency(s.payable_balance)}
                          </td>
                          <td className="py-2 px-3 text-right font-extrabold text-indigo-800 bg-indigo-50/50">
                            {fmtCurrency(s.carried_forward_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {monthlyReportTab === 'reconciliation' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left">Account Code</th>
                        <th className="py-2.5 px-3 text-left">Cash / Bank Account</th>
                        <th className="py-2.5 px-3 text-right">Opening Balance</th>
                        <th className="py-2.5 px-3 text-right">Total Receipts (Dr)</th>
                        <th className="py-2.5 px-3 text-right">Total Payments (Cr)</th>
                        <th className="py-2.5 px-3 text-right">Closing & Carried Forward</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(monthlyData?.cash_and_bank_carry_forward || []).map((acc: any) => (
                        <tr key={acc.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{acc.account_code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{acc.account_name}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(acc.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(acc.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(acc.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {fmtCurrency(acc.carried_forward_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {monthlyReportTab === 'accounts' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left">Code</th>
                        <th className="py-2.5 px-3 text-left">Account Name</th>
                        <th className="py-2.5 px-3 text-left">Category</th>
                        <th className="py-2.5 px-3 text-right">Opening Balance</th>
                        <th className="py-2.5 px-3 text-right">Period Debit</th>
                        <th className="py-2.5 px-3 text-right">Period Credit</th>
                        <th className="py-2.5 px-3 text-right">Carried Forward Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(monthlyData?.financial_account_carry_forward || []).map((acc: any) => (
                        <tr key={acc.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{acc.account_code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{acc.account_name}</td>
                          <td className="py-2 px-3 uppercase text-slate-500">{acc.account_category}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(acc.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(acc.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(acc.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {fmtCurrency(acc.carried_forward_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {monthlyReportTab === 'stock' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left">Item Code</th>
                        <th className="py-2.5 px-3 text-left">Item Name</th>
                        <th className="py-2.5 px-3 text-left">Company</th>
                        <th className="py-2.5 px-3 text-right">Opening Qty</th>
                        <th className="py-2.5 px-3 text-right">Purchased</th>
                        <th className="py-2.5 px-3 text-right">Sold</th>
                        <th className="py-2.5 px-3 text-right">Pur. Ret</th>
                        <th className="py-2.5 px-3 text-right">Sales Ret</th>
                        <th className="py-2.5 px-3 text-right">Adj.</th>
                        <th className="py-2.5 px-3 text-right">Closing Qty (CF)</th>
                        <th className="py-2.5 px-3 text-right">Valuation (PKR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(monthlyData?.stock_valuation?.items || []).map((it: any) => (
                        <tr key={it.item_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{it.item_code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{it.item_name}</td>
                          <td className="py-2 px-3 text-slate-500">{it.company_name}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(it.opening_quantity)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtNum(it.purchased_quantity)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtNum(it.sold_quantity)}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(it.purchase_return_quantity)}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(it.sales_return_quantity)}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(it.adjustment_quantity)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtNum(it.closing_quantity)}</td>
                          <td className="py-2 px-3 text-right font-bold text-indigo-800">
                            {fmtCurrency(it.closing_valuation)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 3: YEARLY CLOSING & CONFIGURABLE FINANCIAL YEAR
         ===================================================================== */}
      {activeSubTab === 'closing-yearly' && (
        <div className="space-y-6" ref={printContainerRef}>
          {/* Financial Year Configuration Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end justify-between gap-4 no-print">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Financial Year Start Date
                </label>
                <input
                  type="date"
                  value={fyStartDate}
                  onChange={(e) => setFyStartDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Financial Year End Date
                </label>
                <input
                  type="date"
                  value={fyEndDate}
                  onChange={(e) => setFyEndDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Valuation Costing Method
                </label>
                <select
                  value={fyCostingMethod}
                  onChange={(e) => setFyCostingMethod(e.target.value as 'AVERAGE' | 'FIFO')}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  <option value="AVERAGE">Weighted Average Cost</option>
                  <option value="FIFO">FIFO (First-In, First-Out)</option>
                </select>
              </div>
              <button
                onClick={() => loadYearlyPreview(fyStartDate, fyEndDate, fyCostingMethod)}
                disabled={loading}
                className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Calculate FY Preview</span>
              </button>
              <button
                onClick={handleSaveFinancialYearConfig}
                disabled={savingFyConfig || !canPerformClosing}
                className="px-3.5 py-2 rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{savingFyConfig ? 'Saving...' : 'Save FY Dates Config'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {canExportClosing && (
                <>
                  <button
                    onClick={() =>
                      handlePrintActiveSection(
                        `Annual Financial Year Closing (${fyStartDate} to ${fyEndDate})`,
                        'landscape'
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print A4 / PDF</span>
                  </button>
                  <button
                    onClick={() => exportClosingWorkbook(yearlyData, `Yearly_Closing_${fyStartDate}_${fyEndDate}`)}
                    className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Yearly KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Annual Net Sales</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{fmtCurrency(yearlyData?.net_sales)}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Gross: {fmtCurrency(yearlyData?.total_sales)} | Returns: {fmtCurrency(yearlyData?.sales_returns)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Annual Net Purchases</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{fmtCurrency(yearlyData?.net_purchases)}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Gross: {fmtCurrency(yearlyData?.total_purchases)} | Returns: {fmtCurrency(yearlyData?.purchase_returns)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Annual Income & Expenses</p>
              <p className="text-lg font-bold text-rose-700 mt-1">Exp: {fmtCurrency(yearlyData?.total_expenses)}</p>
              <p className="text-[11px] text-blue-600 mt-1">
                Other Income: {fmtCurrency(yearlyData?.other_income)}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 shadow-sm ${
                Number(yearlyData?.net_profit_loss || 0) >= 0
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-rose-50 border-rose-200'
              }`}
            >
              <p className="text-xs font-semibold text-slate-700">Annual Net Profit / (Loss)</p>
              <p
                className={`text-lg font-extrabold mt-1 ${
                  Number(yearlyData?.net_profit_loss || 0) >= 0 ? 'text-emerald-800' : 'text-rose-800'
                }`}
              >
                {fmtCurrency(yearlyData?.net_profit_loss)}
              </p>
              <p className="text-[11px] text-slate-600 mt-1">
                Transfers to EQT-3030 Retained Earnings
              </p>
            </div>
          </div>

          {/* Yearly Execution & Profit Transfer Panel */}
          {!yearlyData?.existing_closing ? (
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 space-y-4 no-print">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Year-End Profit/Loss Transfer & Next Financial Year Roll-Forward
                  </h3>
                  <p className="text-xs text-slate-600">
                    Executing Yearly Closing transfers temporary Revenue and Expense balances into{' '}
                    <strong>EQT-3030 (Retained Earnings & Period Profit/Loss Summary)</strong>, locks the closed financial year, and carries forward all Assets, Liabilities, Customer Receivables ({fmtCurrency(yearlyData?.total_receivables)}), Supplier Payables ({fmtCurrency(yearlyData?.total_payables)}), Cash ({fmtCurrency(yearlyData?.cash_balance)}), Bank ({fmtCurrency(yearlyData?.bank_balance)}), and Stock Valuation ({fmtCurrency(yearlyData?.closing_inventory_value)}) into the next financial year.
                  </p>
                  <div className="flex flex-wrap items-center gap-5 pt-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lockYearlyPeriod}
                        onChange={(e) => setLockYearlyPeriod(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>Lock Closed Financial Year ({fyStartDate} → {fyEndDate})</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={advanceToNextYear}
                        onChange={(e) => setAdvanceToNextYear(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>Automatically Advance Active Financial Year to Next Year</span>
                    </label>
                    <input
                      type="text"
                      value={yearlyNotes}
                      onChange={(e) => setYearlyNotes(e.target.value)}
                      placeholder="Optional year-end closing notes..."
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-64"
                    />
                  </div>
                </div>

                <button
                  onClick={handleExecuteYearlyClosing}
                  disabled={executing || !canPerformClosing}
                  className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-xs shadow-sm flex items-center gap-2 shrink-0"
                >
                  <Lock className="w-4 h-4" />
                  <span>{executing ? 'Processing Yearly Closing...' : 'Execute Yearly Financial Closing'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-amber-600" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900">
                    Financial Year {fyStartDate} to {fyEndDate} is Closed ({yearlyData.existing_closing.closing_code})
                  </h4>
                  <p className="text-xs text-amber-700">
                    Closed by {yearlyData.existing_closing.closed_by_username} on {yearlyData.existing_closing.closed_at}.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleOpenClosingDetail(yearlyData.existing_closing.id)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 no-print"
              >
                View Year-End Report
              </button>
            </div>
          )}

          {/* Yearly Balance Carry Forward Tables */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-4 pt-3 flex flex-wrap items-center gap-1 bg-slate-50 no-print">
              {[
                { id: 'summary', label: 'Annual Financial Summary' },
                { id: 'customers', label: `Customer Balances Carry-Forward (${(yearlyData?.customer_carry_forward || []).length})` },
                { id: 'suppliers', label: `Supplier Balances Carry-Forward (${(yearlyData?.supplier_carry_forward || []).length})` },
                { id: 'accounts', label: 'Assets, Liabilities & Equity Carry-Forward' },
                { id: 'stock', label: 'Year-End Stock Valuation' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setYearlyReportTab(t.id as any)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 ${
                    yearlyReportTab === t.id
                      ? 'border-emerald-600 text-emerald-700 bg-white'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {yearlyReportTab === 'summary' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="font-bold text-slate-900 border-b pb-1.5">Revenue & Profit Summary</h4>
                    <div className="flex justify-between"><span>Total Sales:</span><span className="font-semibold">{fmtCurrency(yearlyData?.total_sales)}</span></div>
                    <div className="flex justify-between"><span>Sales Returns:</span><span className="font-semibold">{fmtCurrency(yearlyData?.sales_returns)}</span></div>
                    <div className="flex justify-between"><span>Net Sales:</span><span className="font-bold">{fmtCurrency(yearlyData?.net_sales)}</span></div>
                    <div className="flex justify-between"><span>Gross Profit:</span><span className="font-bold text-emerald-700">{fmtCurrency(yearlyData?.gross_profit)}</span></div>
                    <div className="flex justify-between"><span>Total Expenses:</span><span className="font-bold text-rose-700">{fmtCurrency(yearlyData?.total_expenses)}</span></div>
                    <div className="flex justify-between border-t pt-1.5 font-extrabold"><span>Annual Net Profit/Loss:</span><span>{fmtCurrency(yearlyData?.net_profit_loss)}</span></div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="font-bold text-slate-900 border-b pb-1.5">Assets Carried Forward</h4>
                    <div className="flex justify-between"><span>Closing Cash:</span><span className="font-semibold">{fmtCurrency(yearlyData?.cash_balance)}</span></div>
                    <div className="flex justify-between"><span>Closing Bank:</span><span className="font-semibold">{fmtCurrency(yearlyData?.bank_balance)}</span></div>
                    <div className="flex justify-between"><span>Customer Receivables:</span><span className="font-semibold text-emerald-700">{fmtCurrency(yearlyData?.total_receivables)}</span></div>
                    <div className="flex justify-between"><span>Closing Inventory Qty:</span><span className="font-semibold">{fmtNum(yearlyData?.closing_inventory_qty)}</span></div>
                    <div className="flex justify-between border-t pt-1.5 font-extrabold"><span>Inventory Valuation:</span><span>{fmtCurrency(yearlyData?.closing_inventory_value)}</span></div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                    <h4 className="font-bold text-slate-900 border-b pb-1.5">Liabilities & Equity Roll-Forward</h4>
                    <div className="flex justify-between"><span>Supplier Payables:</span><span className="font-semibold text-rose-700">{fmtCurrency(yearlyData?.total_payables)}</span></div>
                    <div className="flex justify-between"><span>Active Customers CF:</span><span className="font-semibold">{(yearlyData?.customer_carry_forward || []).length} Parties</span></div>
                    <div className="flex justify-between"><span>Active Suppliers CF:</span><span className="font-semibold">{(yearlyData?.supplier_carry_forward || []).length} Parties</span></div>
                    <div className="flex justify-between border-t pt-1.5 font-bold text-indigo-800"><span>Retained Earnings Transfer:</span><span>{fmtCurrency(yearlyData?.net_profit_loss)}</span></div>
                  </div>
                </div>
              )}

              {yearlyReportTab === 'customers' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 text-left">Code</th>
                        <th className="py-2 px-3 text-left">Customer Name</th>
                        <th className="py-2 px-3 text-right">Opening Balance</th>
                        <th className="py-2 px-3 text-right">Yearly Debit</th>
                        <th className="py-2 px-3 text-right">Yearly Credit</th>
                        <th className="py-2 px-3 text-right bg-emerald-50 text-emerald-900">Next FY Opening Balance (CF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(yearlyData?.customer_carry_forward || []).map((c: any) => (
                        <tr key={c.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{c.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{c.account_name}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(c.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(c.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(c.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold bg-emerald-50/40">{fmtCurrency(c.carried_forward_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {yearlyReportTab === 'suppliers' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 text-left">Code</th>
                        <th className="py-2 px-3 text-left">Supplier Name</th>
                        <th className="py-2 px-3 text-right">Opening Balance</th>
                        <th className="py-2 px-3 text-right">Yearly Debit</th>
                        <th className="py-2 px-3 text-right">Yearly Credit</th>
                        <th className="py-2 px-3 text-right bg-indigo-50 text-indigo-900">Next FY Opening Balance (CF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(yearlyData?.supplier_carry_forward || []).map((s: any) => (
                        <tr key={s.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{s.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{s.account_name}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(s.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(s.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(s.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold bg-indigo-50/40">{fmtCurrency(s.carried_forward_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {yearlyReportTab === 'accounts' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 text-left">Code</th>
                        <th className="py-2 px-3 text-left">Account Name</th>
                        <th className="py-2 px-3 text-left">Category</th>
                        <th className="py-2 px-3 text-right">Opening</th>
                        <th className="py-2 px-3 text-right">Yearly Debit</th>
                        <th className="py-2 px-3 text-right">Yearly Credit</th>
                        <th className="py-2 px-3 text-right">Next FY Opening (CF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...(yearlyData?.cash_and_bank_carry_forward || []), ...(yearlyData?.financial_account_carry_forward || [])].map((a: any) => (
                        <tr key={a.account_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{a.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{a.account_name}</td>
                          <td className="py-2 px-3 uppercase text-slate-500">{a.account_category}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(a.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(a.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(a.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtCurrency(a.carried_forward_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {yearlyReportTab === 'stock' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 text-left">Item Code</th>
                        <th className="py-2 px-3 text-left">Item Name</th>
                        <th className="py-2 px-3 text-left">Company</th>
                        <th className="py-2 px-3 text-right">Opening Qty</th>
                        <th className="py-2 px-3 text-right">Purchased</th>
                        <th className="py-2 px-3 text-right">Sold</th>
                        <th className="py-2 px-3 text-right">Closing Qty (CF)</th>
                        <th className="py-2 px-3 text-right">Valuation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(yearlyData?.stock_valuation?.items || []).map((it: any) => (
                        <tr key={it.item_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{it.item_code}</td>
                          <td className="py-2 px-3 font-semibold">{it.item_name}</td>
                          <td className="py-2 px-3 text-slate-500">{it.company_name}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(it.opening_quantity)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtNum(it.purchased_quantity)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtNum(it.sold_quantity)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtNum(it.closing_quantity)}</td>
                          <td className="py-2 px-3 text-right font-bold text-indigo-800">{fmtCurrency(it.closing_valuation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 4: STOCK CLOSING
         ===================================================================== */}
      {activeSubTab === 'closing-stock' && (
        <div className="space-y-6" ref={printContainerRef}>
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end justify-between gap-4 no-print">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Period Start Date</label>
                <input
                  type="date"
                  value={stockStart}
                  onChange={(e) => setStockStart(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Period End Date</label>
                <input
                  type="date"
                  value={stockEnd}
                  onChange={(e) => setStockEnd(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Valuation Method</label>
                <select
                  value={stockCostingMethod}
                  onChange={(e) => {
                    const m = e.target.value as 'AVERAGE' | 'FIFO';
                    setStockCostingMethod(m);
                    loadStockPreview(stockStart, stockEnd, m);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="AVERAGE">Average Cost Valuation</option>
                  <option value="FIFO">FIFO Cost Valuation</option>
                </select>
              </div>
              <button
                onClick={() => loadStockPreview(stockStart, stockEnd, stockCostingMethod)}
                disabled={loading}
                className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Calculate Stock Valuation</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="Search Item Code, Name, Company..."
                className="px-3 py-2 rounded-lg border border-slate-300 text-xs w-56"
              />
              {canExportClosing && (
                <>
                  <button
                    onClick={() =>
                      handlePrintActiveSection(
                        `Stock Closing & Valuation Report (${stockStart} to ${stockEnd})`,
                        'landscape'
                      )
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print A4 / PDF</span>
                  </button>
                  <button
                    onClick={() => exportClosingWorkbook(stockData, `Stock_Closing_${stockEnd}`)}
                    className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Excel</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Stock Totals Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Opening Qty</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {fmtNum(stockData?.totals?.opening_quantity)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Purchased Qty</p>
              <p className="text-sm font-bold text-emerald-700 mt-0.5">
                +{fmtNum(stockData?.totals?.purchased_quantity)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Sold Qty</p>
              <p className="text-sm font-bold text-rose-700 mt-0.5">
                -{fmtNum(stockData?.totals?.sold_quantity)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Purchase Returns</p>
              <p className="text-sm font-bold text-indigo-700 mt-0.5">
                -{fmtNum(stockData?.totals?.purchase_return_quantity)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Sales Returns</p>
              <p className="text-sm font-bold text-amber-700 mt-0.5">
                +{fmtNum(stockData?.totals?.sales_return_quantity)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[11px] text-slate-500">Adjustments</p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">
                {fmtNum(stockData?.totals?.adjustment_quantity)}
              </p>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3 shadow-sm">
              <p className="text-[11px] font-semibold text-emerald-800">Closing Stock Qty</p>
              <p className="text-sm font-extrabold text-emerald-900 mt-0.5">
                {fmtNum(stockData?.totals?.closing_quantity)}
              </p>
            </div>
            <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-3 shadow-sm">
              <p className="text-[11px] font-semibold text-indigo-800">
                Total Valuation ({stockCostingMethod})
              </p>
              <p className="text-sm font-extrabold text-indigo-900 mt-0.5">
                {fmtCurrency(stockData?.totals?.closing_valuation)}
              </p>
            </div>
          </div>

          {/* Save Official Stock Closing Snapshot Bar */}
          {!stockData?.existing_closing ? (
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 no-print">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-emerald-600" />
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Record Official Stock Closing Snapshot ({stockStart} to {stockEnd})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Prevents duplicate stock closing entries for the same period and preserves an immutable item-by-item valuation audit record.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={stockNotes}
                  onChange={(e) => setStockNotes(e.target.value)}
                  placeholder="Optional stock closing notes..."
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-60"
                />
                <button
                  onClick={handleExecuteStockClosing}
                  disabled={executing || !canPerformClosing}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{executing ? 'Saving Snapshot...' : 'Execute Stock Closing'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
              <div className="text-xs text-amber-900">
                <strong>Stock Closing Already Recorded ({stockData.existing_closing.closing_code})</strong> on{' '}
                {stockData.existing_closing.closed_at} by {stockData.existing_closing.closed_by_username}. Duplicate stock closing for the same period is prevented.
              </div>
              <button
                onClick={() => handleOpenClosingDetail(stockData.existing_closing.id)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold no-print"
              >
                View Snapshot
              </button>
            </div>
          )}

          {/* Stock Valuation Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-3 text-left">#</th>
                    <th className="py-2.5 px-3 text-left">Item Code</th>
                    <th className="py-2.5 px-3 text-left">Item Name</th>
                    <th className="py-2.5 px-3 text-left">Company</th>
                    <th className="py-2.5 px-3 text-right">Opening Quantity</th>
                    <th className="py-2.5 px-3 text-right">Purchased Quantity</th>
                    <th className="py-2.5 px-3 text-right">Sold Quantity</th>
                    <th className="py-2.5 px-3 text-right">Purchase Returns</th>
                    <th className="py-2.5 px-3 text-right">Sales Returns</th>
                    <th className="py-2.5 px-3 text-right">Adjustments</th>
                    <th className="py-2.5 px-3 text-right">Closing Quantity</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost ({stockCostingMethod})</th>
                    <th className="py-2.5 px-3 text-right">Average/FIFO Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStockItems.map((it: any, idx: number) => (
                    <tr key={it.item_id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{it.item_code}</td>
                      <td className="py-2 px-3 font-semibold text-slate-900">{it.item_name}</td>
                      <td className="py-2 px-3 text-slate-500">{it.company_name}</td>
                      <td className="py-2 px-3 text-right">{fmtNum(it.opening_quantity)}</td>
                      <td className="py-2 px-3 text-right text-emerald-700 font-medium">
                        {fmtNum(it.purchased_quantity)}
                      </td>
                      <td className="py-2 px-3 text-right text-rose-700 font-medium">
                        {fmtNum(it.sold_quantity)}
                      </td>
                      <td className="py-2 px-3 text-right">{fmtNum(it.purchase_return_quantity)}</td>
                      <td className="py-2 px-3 text-right">{fmtNum(it.sales_return_quantity)}</td>
                      <td className="py-2 px-3 text-right">{fmtNum(it.adjustment_quantity)}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">
                        {fmtNum(it.closing_quantity)}
                      </td>
                      <td className="py-2 px-3 text-right">{fmtCurrency(it.unit_cost)}</td>
                      <td className="py-2 px-3 text-right font-bold text-indigo-900 bg-indigo-50/40">
                        {fmtCurrency(it.closing_valuation)}
                      </td>
                    </tr>
                  ))}
                  {filteredStockItems.length === 0 && (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-slate-400">
                        No inventory items match your filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 5: CLOSING HISTORY & ARCHIVE REPORTS
         ===================================================================== */}
      {activeSubTab === 'closing-history' && (
        <div className="space-y-6" ref={printContainerRef}>
          {/* Search & Filters Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end justify-between gap-3 no-print">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Search Closing</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Closing ID, User, Period..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs w-52"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Closing Type</label>
                <select
                  value={historyTypeFilter}
                  onChange={(e) => setHistoryTypeFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="ALL">All Types</option>
                  <option value="DAILY">Daily Closing</option>
                  <option value="MONTHLY">Monthly Closing</option>
                  <option value="YEARLY">Yearly Closing</option>
                  <option value="STOCK">Stock Closing</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                <select
                  value={historyStatusFilter}
                  onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="CLOSED">Closed & Locked</option>
                  <option value="REOPENED">Reopened</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">From Date</label>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">To Date</label>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <button
                onClick={loadHistory}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Filter History</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePrintActiveSection('Financial Closing History Register', 'landscape')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Register</span>
              </button>
            </div>
          </div>

          {/* Searchable Closing History Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-3 text-left">Closing ID</th>
                    <th className="py-2.5 px-3 text-left">Closing Type</th>
                    <th className="py-2.5 px-3 text-left">Period Start Date</th>
                    <th className="py-2.5 px-3 text-left">Period End Date</th>
                    <th className="py-2.5 px-3 text-left">Closing Date & Time</th>
                    <th className="py-2.5 px-3 text-left">Performed By</th>
                    <th className="py-2.5 px-3 text-right">Total Sales</th>
                    <th className="py-2.5 px-3 text-right">Total Purchases</th>
                    <th className="py-2.5 px-3 text-right">Closing Cash</th>
                    <th className="py-2.5 px-3 text-right">Closing Bank</th>
                    <th className="py-2.5 px-3 text-right">Closing Stock Value</th>
                    <th className="py-2.5 px-3 text-right">Net Profit/Loss</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-center no-print">Reports</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">{item.closing_code}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold text-[11px]">
                          {item.closing_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{item.period_start}</td>
                      <td className="py-2.5 px-3">{item.period_end}</td>
                      <td className="py-2.5 px-3 text-slate-500">{item.closed_at}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{item.closed_by_username || 'Admin'}</td>
                      <td className="py-2.5 px-3 text-right">{fmtCurrency(item.total_sales)}</td>
                      <td className="py-2.5 px-3 text-right">{fmtCurrency(item.total_purchases)}</td>
                      <td className="py-2.5 px-3 text-right font-medium">{fmtCurrency(item.closing_cash)}</td>
                      <td className="py-2.5 px-3 text-right font-medium">{fmtCurrency(item.closing_bank)}</td>
                      <td className="py-2.5 px-3 text-right font-medium text-indigo-800">
                        {fmtCurrency(item.closing_stock_value)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          Number(item.net_profit_loss || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {fmtCurrency(item.net_profit_loss)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === 'CLOSED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center no-print">
                        <button
                          onClick={() => handleOpenClosingDetail(item.id)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View / Print</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {historyItems.length === 0 && (
                    <tr>
                      <td colSpan={14} className="py-10 text-center text-slate-400">
                        No closing history records found matching your criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 6: REOPEN CLOSED PERIOD (SUPER ADMIN ONLY + AUDIT TRAIL)
         ===================================================================== */}
      {activeSubTab === 'closing-reopen' && (
        <div className="space-y-6">
          {/* Security Notice */}
          <div
            className={`rounded-xl border p-4 flex items-start gap-3 ${
              isSuperAdmin
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {isSuperAdmin ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <h3 className="font-bold text-sm">
                {isSuperAdmin
                  ? 'Super Admin Period Lock & Reopen Control Center'
                  : 'Restricted Module: Super Admin Authorization Required to Reopen Locked Periods'}
              </h3>
              <p>
                Closed financial periods lock all sales, purchases, returns, cash book vouchers, inventory adjustments, and supply transactions within the closed date range. Reopening a closed period requires Super Admin authorization, a mandatory explanation, and records a permanent entry in the Closing Audit Log.
              </p>
            </div>
          </div>

          {/* Closed Records Table with Reopen Action */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Closed Financial Periods & Snapshots</h3>
              <button
                onClick={loadHistory}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-3 text-left">Closing ID</th>
                    <th className="py-2.5 px-3 text-left">Type</th>
                    <th className="py-2.5 px-3 text-left">Period Range</th>
                    <th className="py-2.5 px-3 text-left">Closed By / At</th>
                    <th className="py-2.5 px-3 text-center">Current Status</th>
                    <th className="py-2.5 px-3 text-left">Reopen History</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyItems.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{c.closing_code}</td>
                      <td className="py-2.5 px-3 font-semibold">{c.closing_type}</td>
                      <td className="py-2.5 px-3">
                        {c.period_start} → {c.period_end}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {c.closed_by_username} ({c.closed_at})
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            c.status === 'CLOSED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {c.status === 'CLOSED' ? 'LOCKED / CLOSED' : 'REOPENED'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {c.reopened_at
                          ? `Reopened by ${c.reopened_by_username} on ${c.reopened_at}: "${c.reopen_reason}"`
                          : 'Never reopened'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {c.status === 'CLOSED' ? (
                          <button
                            disabled={!isSuperAdmin}
                            onClick={() => {
                              setReopenTargetId(c.id);
                              setReopenReason('');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Reopen Period</span>
                          </button>
                        ) : (
                          <span className="text-emerald-700 font-semibold">Period Open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {historyItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No closed financial periods found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Reopen Confirmation Form */}
            {reopenTargetId && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-amber-900">
                    Confirm Reopening Closed Period (Record ID #{reopenTargetId})
                  </h4>
                  <button onClick={() => setReopenTargetId(null)} className="text-amber-700 hover:text-amber-900">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-amber-800">
                  Please provide a mandatory audit explanation for reopening this closed financial period. If a system year-end profit transfer voucher was generated, it will also be safely reversed so you can make adjustments and re-close.
                </p>
                <textarea
                  rows={2}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Enter mandatory reason for reopening this closed period (minimum 5 characters)..."
                  className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-white text-xs outline-none focus:ring-2 focus:ring-amber-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setReopenTargetId(null)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleReopenPeriod(reopenTargetId)}
                    disabled={executing}
                    className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>{executing ? 'Reopening...' : 'Authorize & Reopen Period'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Complete Closing & Reopen Audit Trail */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Immutable Closing & Period Lock Audit Trail
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2 px-3 text-left">Timestamp</th>
                    <th className="py-2 px-3 text-left">Action</th>
                    <th className="py-2 px-3 text-left">ClosingType</th>
                    <th className="py-2 px-3 text-left">Period</th>
                    <th className="py-2 px-3 text-left">Performed By</th>
                    <th className="py-2 px-3 text-left">Role</th>
                    <th className="py-2 px-3 text-left">Reason / Audit Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyAuditLogs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 text-slate-500">{log.created_at}</td>
                      <td className="py-2 px-3 font-bold text-slate-800">{log.action}</td>
                      <td className="py-2 px-3">{log.closing_type || '-'}</td>
                      <td className="py-2 px-3">
                        {log.period_start || '-'} → {log.period_end || '-'}
                      </td>
                      <td className="py-2 px-3 font-medium">{log.performed_by_username}</td>
                      <td className="py-2 px-3 text-slate-500">{log.performed_by_role}</td>
                      <td className="py-2 px-3 text-slate-700">{log.reason || '-'}</td>
                    </tr>
                  ))}
                  {historyAuditLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        No closing audit trail entries recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          DETAILED CLOSING REPORT MODAL (PRINT A4 / PDF / EXCEL / 6 REPORTS)
         ===================================================================== */}
      {selectedClosingDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded bg-emerald-600 text-white text-xs font-bold">
                    {selectedClosingDetail.closing_code}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">
                    {selectedClosingDetail.closing_type} CLOSING REPORT ({selectedClosingDetail.period_start} to{' '}
                    {selectedClosingDetail.period_end})
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Performed by <strong>{selectedClosingDetail.closed_by_username || 'Admin'}</strong> on{' '}
                  {selectedClosingDetail.closed_at} • Status: <strong>{selectedClosingDetail.status}</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    handlePrintModalReport(
                      `${selectedClosingDetail.closing_code} - ${selectedClosingDetail.closing_type} Closing Report`,
                      detailReportTab === 'stock' || detailReportTab === 'customers' || detailReportTab === 'suppliers'
                        ? 'landscape'
                        : 'portrait'
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print A4 / Save PDF</span>
                </button>
                <button
                  onClick={() =>
                    exportClosingWorkbook(selectedClosingDetail, selectedClosingDetail.closing_code || 'Closing_Report')
                  }
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Full Excel Workbook</span>
                </button>
                <button
                  onClick={() => setSelectedClosingDetail(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Report Sub-Navigation inside Modal */}
            <div className="px-6 pt-2 border-b border-slate-200 flex flex-wrap items-center gap-1 bg-slate-100/70">
              {[
                { id: 'summary', label: '1. Detailed Financial Summary' },
                { id: 'pnl', label: '2. Profit & Loss Report' },
                { id: 'cash_bank', label: '3. Cash & Bank Reconciliation' },
                {
                  id: 'customers',
                  label: `4. Customer Carry-Forward (${
                    (selectedClosingDetail.account_snapshots || []).filter((a: any) => a.snapshot_group === 'CUSTOMER')
                      .length
                  })`,
                },
                {
                  id: 'suppliers',
                  label: `5. Supplier Carry-Forward (${
                    (selectedClosingDetail.account_snapshots || []).filter((a: any) => a.snapshot_group === 'SUPPLIER')
                      .length
                  })`,
                },
                {
                  id: 'stock',
                  label: `6. Stock Valuation Report (${(selectedClosingDetail.stock_snapshots || []).length})`,
                },
                { id: 'audit', label: '7. Audit Trail' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDetailReportTab(t.id as any)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 ${
                    detailReportTab === t.id
                      ? 'border-emerald-600 text-emerald-800 bg-white'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Printable Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1" ref={modalPrintRef}>
              {detailReportTab === 'summary' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Opening Cash</span>
                    <span className="text-sm font-bold">{fmtCurrency(selectedClosingDetail.opening_cash)}</span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Closing Cash (Book)</span>
                    <span className="text-sm font-bold">{fmtCurrency(selectedClosingDetail.closing_cash)}</span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Actual Physical Cash</span>
                    <span className="text-sm font-bold text-emerald-700">
                      {fmtCurrency(selectedClosingDetail.actual_physical_cash)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Cash Discrepancy</span>
                    <span className="text-sm font-bold text-rose-700">
                      {fmtCurrency(selectedClosingDetail.cash_difference)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Total Sales</span>
                    <span className="text-sm font-bold">{fmtCurrency(selectedClosingDetail.total_sales)}</span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Total Purchases</span>
                    <span className="text-sm font-bold">{fmtCurrency(selectedClosingDetail.total_purchases)}</span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Gross Profit</span>
                    <span className="text-sm font-bold text-emerald-700">
                      {fmtCurrency(selectedClosingDetail.gross_profit)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Net Profit / Loss</span>
                    <span className="text-sm font-bold text-indigo-800">
                      {fmtCurrency(selectedClosingDetail.net_profit_loss)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Closing Bank Balance</span>
                    <span className="text-sm font-bold">{fmtCurrency(selectedClosingDetail.closing_bank)}</span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Total Receivables (CF)</span>
                    <span className="text-sm font-bold text-emerald-700">
                      {fmtCurrency(selectedClosingDetail.total_receivables)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Total Payables (CF)</span>
                    <span className="text-sm font-bold text-rose-700">
                      {fmtCurrency(selectedClosingDetail.total_payables)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">Closing Stock Value (CF)</span>
                    <span className="text-sm font-bold text-indigo-800">
                      {fmtCurrency(selectedClosingDetail.closing_stock_value)}
                    </span>
                  </div>
                </div>
              )}

              {detailReportTab === 'pnl' && (
                <div className="max-w-2xl mx-auto border border-slate-200 rounded-xl p-5 space-y-2.5 text-xs">
                  <h4 className="text-sm font-bold text-slate-900 border-b pb-2">
                    Official Profit & Loss Statement ({selectedClosingDetail.period_start} to{' '}
                    {selectedClosingDetail.period_end})
                  </h4>
                  <div className="flex justify-between py-1">
                    <span>Total Sales</span>
                    <span className="font-semibold">{fmtCurrency(selectedClosingDetail.total_sales)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-rose-700">
                    <span>Less: Sales Returns</span>
                    <span>({fmtCurrency(selectedClosingDetail.sales_returns)})</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-t font-bold">
                    <span>Net Sales Revenue</span>
                    <span>
                      {fmtCurrency(
                        Number(selectedClosingDetail.total_sales || 0) -
                          Number(selectedClosingDetail.sales_returns || 0)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Total Purchases</span>
                    <span>{fmtCurrency(selectedClosingDetail.total_purchases)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Less: Purchase Returns</span>
                    <span>({fmtCurrency(selectedClosingDetail.purchase_returns)})</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-t font-bold text-emerald-800 bg-emerald-50 px-2 rounded">
                    <span>Gross Profit</span>
                    <span>{fmtCurrency(selectedClosingDetail.gross_profit)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-blue-700">
                    <span>Add: Other Income</span>
                    <span>+{fmtCurrency(selectedClosingDetail.other_income)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-rose-700">
                    <span>Less: Total Operating Expenses</span>
                    <span>({fmtCurrency(selectedClosingDetail.total_expenses)})</span>
                  </div>
                  <div className="flex justify-between py-2 border-t-2 border-slate-300 font-extrabold text-sm">
                    <span>Net Profit / (Loss)</span>
                    <span>{fmtCurrency(selectedClosingDetail.net_profit_loss)}</span>
                  </div>
                </div>
              )}

              {detailReportTab === 'cash_bank' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left">Code</th>
                      <th className="py-2 px-3 text-left">Account Name</th>
                      <th className="py-2 px-3 text-left">Group</th>
                      <th className="py-2 px-3 text-right">Opening</th>
                      <th className="py-2 px-3 text-right">Debit (In)</th>
                      <th className="py-2 px-3 text-right">Credit (Out)</th>
                      <th className="py-2 px-3 text-right">Closing & Carried Forward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedClosingDetail.account_snapshots || [])
                      .filter((a: any) => a.snapshot_group === 'CASH' || a.snapshot_group === 'BANK')
                      .map((acc: any) => (
                        <tr key={acc.id}>
                          <td className="py-2 px-3 font-mono">{acc.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{acc.account_name}</td>
                          <td className="py-2 px-3">{acc.snapshot_group}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(acc.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(acc.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(acc.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtCurrency(acc.carried_forward_balance)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {detailReportTab === 'customers' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left">Code</th>
                      <th className="py-2 px-3 text-left">Customer Name</th>
                      <th className="py-2 px-3 text-left">Town / Area</th>
                      <th className="py-2 px-3 text-right">Opening Balance</th>
                      <th className="py-2 px-3 text-right">Period Debit</th>
                      <th className="py-2 px-3 text-right">Period Credit</th>
                      <th className="py-2 px-3 text-right">Closing & Carried Forward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedClosingDetail.account_snapshots || [])
                      .filter((a: any) => a.snapshot_group === 'CUSTOMER')
                      .map((c: any) => (
                        <tr key={c.id}>
                          <td className="py-2 px-3 font-mono">{c.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{c.account_name}</td>
                          <td className="py-2 px-3 text-slate-500">
                            {c.town_name || '-'} {c.area_name ? `/ ${c.area_name}` : ''}
                          </td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(c.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(c.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(c.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtCurrency(c.carried_forward_balance)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {detailReportTab === 'suppliers' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left">Code</th>
                      <th className="py-2 px-3 text-left">Supplier Name</th>
                      <th className="py-2 px-3 text-left">Town / Area</th>
                      <th className="py-2 px-3 text-right">Opening Balance</th>
                      <th className="py-2 px-3 text-right">Period Debit</th>
                      <th className="py-2 px-3 text-right">Period Credit</th>
                      <th className="py-2 px-3 text-right">Closing & Carried Forward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedClosingDetail.account_snapshots || [])
                      .filter((a: any) => a.snapshot_group === 'SUPPLIER')
                      .map((s: any) => (
                        <tr key={s.id}>
                          <td className="py-2 px-3 font-mono">{s.account_code}</td>
                          <td className="py-2 px-3 font-semibold">{s.account_name}</td>
                          <td className="py-2 px-3 text-slate-500">
                            {s.town_name || '-'} {s.area_name ? `/ ${s.area_name}` : ''}
                          </td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(s.opening_balance)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700">{fmtCurrency(s.period_debit)}</td>
                          <td className="py-2 px-3 text-right text-rose-700">{fmtCurrency(s.period_credit)}</td>
                          <td className="py-2 px-3 text-right font-bold">{fmtCurrency(s.carried_forward_balance)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {detailReportTab === 'stock' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left">Item Code</th>
                      <th className="py-2 px-3 text-left">Item Name</th>
                      <th className="py-2 px-3 text-left">Company</th>
                      <th className="py-2 px-3 text-right">Opening</th>
                      <th className="py-2 px-3 text-right">Purchased</th>
                      <th className="py-2 px-3 text-right">Sold</th>
                      <th className="py-2 px-3 text-right">Pur. Ret</th>
                      <th className="py-2 px-3 text-right">Sales Ret</th>
                      <th className="py-2 px-3 text-right">Adj</th>
                      <th className="py-2 px-3 text-right">Closing Qty</th>
                      <th className="py-2 px-3 text-right">Valuation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedClosingDetail.stock_snapshots || []).map((st: any) => (
                      <tr key={st.id}>
                        <td className="py-2 px-3 font-mono">{st.item_code}</td>
                        <td className="py-2 px-3 font-semibold">{st.item_name}</td>
                        <td className="py-2 px-3 text-slate-500">{st.company_name}</td>
                        <td className="py-2 px-3 text-right">{fmtNum(st.opening_quantity)}</td>
                        <td className="py-2 px-3 text-right text-emerald-700">{fmtNum(st.purchased_quantity)}</td>
                        <td className="py-2 px-3 text-right text-rose-700">{fmtNum(st.sold_quantity)}</td>
                        <td className="py-2 px-3 text-right">{fmtNum(st.purchase_return_quantity)}</td>
                        <td className="py-2 px-3 text-right">{fmtNum(st.sales_return_quantity)}</td>
                        <td className="py-2 px-3 text-right">{fmtNum(st.adjustment_quantity)}</td>
                        <td className="py-2 px-3 text-right font-bold">{fmtNum(st.closing_quantity)}</td>
                        <td className="py-2 px-3 text-right font-bold text-indigo-800">
                          {fmtCurrency(st.closing_valuation)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {detailReportTab === 'audit' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left">Timestamp</th>
                      <th className="py-2 px-3 text-left">Action</th>
                      <th className="py-2 px-3 text-left">User</th>
                      <th className="py-2 px-3 text-left">Role</th>
                      <th className="py-2 px-3 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedClosingDetail.audit_logs || []).map((l: any) => (
                      <tr key={l.id}>
                        <td className="py-2 px-3">{l.created_at}</td>
                        <td className="py-2 px-3 font-bold">{l.action}</td>
                        <td className="py-2 px-3">{l.performed_by_username}</td>
                        <td className="py-2 px-3">{l.performed_by_role}</td>
                        <td className="py-2 px-3">{l.reason || '-'}</td>
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
