import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NavTabId } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { DashboardView } from './components/views/DashboardView';
import { ItemsMasterView } from './components/items/ItemsMasterView';
import { AccountsMasterView } from './components/accounts/AccountsMasterView';
import { PurchasesWorkspaceView } from './components/purchases/PurchasesWorkspaceView';
import { AdvanceTaxSettingsPanel } from './components/purchases/AdvanceTaxSettingsPanel';
import { SalesInvoiceDatasheet } from './components/sales/SalesInvoiceDatasheet';
import { SalesRegisterView } from './components/sales/SalesRegisterView';
import { SalesReturnView } from './components/sales/SalesReturnView';
import { AccountLedgersView } from './components/sales/AccountLedgersView';
import { PaymentsWorkspaceView } from './components/sales/PaymentsWorkspaceView';
import { SalesReportsView } from './components/sales/SalesReportsView';
import { SystemSettingsView } from './components/views/SystemSettingsView';
import { SecurityAuditView } from './components/admin/SecurityAuditView';
import { InventoryWorkspaceView } from './components/inventory/InventoryWorkspaceView';
import { ChartOfAccountsView } from './components/accounting/ChartOfAccountsView';
import { VoucherManagementView } from './components/accounting/VoucherManagementView';
import { LedgersWorkspaceView } from './components/accounting/LedgersWorkspaceView';
import { AdvanceTaxAccountingView } from './components/accounting/AdvanceTaxAccountingView';
import { FinancialReportsView } from './components/accounting/FinancialReportsView';
import {
  QuickAccountShortcutsModal,
  QuickShortcutAction,
} from './components/accounting/QuickAccountShortcutsModal';
import { StaffAndDeliveryWorkspaceView } from './components/staff/StaffAndDeliveryWorkspaceView';
import { CashBookModuleView } from './components/accounting/CashBookModuleView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/auth/LoginScreen';
import { UserManagementView } from './components/admin/UserManagementView';
import { MoreOptionsView } from './components/views/MoreOptionsView';
import {
  SupplyDistributionWorkspace,
  type SupplySubView,
} from './components/supply/SupplyDistributionWorkspace';
import { SalesmanMobileBookingApp } from './components/mobile/SalesmanMobileBookingApp';
import { TradeDealsAndPartyDiscountsWorkspace } from './components/offers/TradeDealsAndPartyDiscountsWorkspace';
import { MasterResetAndLocalBackupPanel } from './components/admin/MasterResetAndLocalBackupPanel';
import { TopPerformanceReportsView } from './components/reports/TopPerformanceReportsView';
import {
  ClosingManagementWorkspace,
  ClosingTabId,
} from './components/closing/ClosingManagementWorkspace';
import { api } from './services/api';
import { DatabaseDiagnostics, TableDetail } from './types/database';
import { HealthResponse, CompanySettings } from './types/system';
import {
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  Users2,
  Building2,
  Wallet,
  CreditCard,
  Banknote,
  FileSpreadsheet,
  Percent,
  LayoutDashboard,
  KeyRound,
  Lock,
} from 'lucide-react';

function AppContent() {
  const {
    isAuthenticated,
    loading: authLoading,
    user,
    hasPermission,
    isSuperAdmin,
    refreshAuth,
    logout,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [previousTab, setPreviousTab] = useState<NavTabId>('dashboard');
  const [hasVisitedSales, setHasVisitedSales] = useState<boolean>(false);
  const [hasVisitedPurchases, setHasVisitedPurchases] = useState<boolean>(false);
  const [resumeInvoiceId, setResumeInvoiceId] = useState<number | null>(null);
  const [hasUnsavedInvoiceItems, setHasUnsavedInvoiceItems] = useState<boolean>(false);
  const [quickShortcut, setQuickShortcut] = useState<QuickShortcutAction | null>(null);

  const isSalesInvoiceTab =
    activeTab === 'sales-new' || activeTab === 'sales-pos' || activeTab === 'sales';
  const isPurchaseInvoiceTab = activeTab === 'purchases' || activeTab === 'purchases-bill';
  const isFullScreenInvoice = isSalesInvoiceTab || isPurchaseInvoiceTab;

  const handleSelectTab = useCallback(
    (nextTab: NavTabId) => {
      if (
        !['sales-new', 'sales-pos', 'sales', 'purchases', 'purchases-bill'].includes(activeTab)
      ) {
        setPreviousTab(activeTab);
      }
      setActiveTab(nextTab);
    },
    [activeTab]
  );

  const handleCloseFullScreenInvoice = useCallback(() => {
    const target =
      previousTab &&
      !['sales-new', 'sales-pos', 'sales', 'purchases', 'purchases-bill'].includes(previousTab)
        ? previousTab
        : 'dashboard';
    setActiveTab(target);
  }, [previousTab]);

  useEffect(() => {
    if (isSalesInvoiceTab) {
      setHasVisitedSales(true);
    }
    if (isPurchaseInvoiceTab) {
      setHasVisitedPurchases(true);
    }
  }, [isSalesInvoiceTab, isPurchaseInvoiceTab]);

  const [, setHealth] = useState<HealthResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DatabaseDiagnostics | null>(null);
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Enforce Super Admin and Individual User RBAC Permissions
  const canAccessTab = useCallback(
    (tab: NavTabId): boolean => {
      if (isSuperAdmin) return true;
      if (tab === 'users' || tab === 'users-manage' || tab === 'more-options') {
        return false; // Only Super Admin has access to User Management and More Options
      }
      if (tab === 'dashboard') return hasPermission('dashboard');
      if (
        tab === 'items' ||
        tab === 'items-master' ||
        tab === 'item-categories' ||
        tab === 'item-groups' ||
        tab === 'item-search' ||
        tab === 'item-offers' ||
        tab === 'item-import-export' ||
        tab === 'item-claims' ||
        tab.startsWith('inv-') ||
        tab.startsWith('stock-') ||
        tab === 'detailed-stock-report' ||
        tab === 'inventory' ||
        tab === 'batch-expiry'
      ) {
        return hasPermission('items');
      }
      if (
        tab.startsWith('party-') ||
        tab.startsWith('accounts') ||
        tab.startsWith('voucher-') ||
        tab.startsWith('payment-') ||
        tab.startsWith('fin-') ||
        tab.startsWith('ledger-') ||
        tab.startsWith('aging-') ||
        tab === 'recovery-sheet' ||
        tab === 'supplier-payments' ||
        tab === 'staff-salesmen'
      ) {
        return hasPermission('accounts') || (tab === 'staff-salesmen' && hasPermission('sales'));
      }
      if (tab === 'sales' || tab === 'sales-new' || tab === 'sales-pos' || tab === 'sales-register') {
        return hasPermission('sales');
      }
      if (tab === 'sales-return' || tab === 'sale-returns') {
        return hasPermission('sale_returns');
      }
      if (tab === 'purchases' || tab === 'purchases-bill' || tab === 'purchase-history') {
        return hasPermission('purchases');
      }
      if (tab === 'purchase-returns' || tab === 'purchases-return') {
        return hasPermission('purchase_returns');
      }
      if (tab === 'cash-book' || tab === 'ledger-cash') {
        return hasPermission('cashbook');
      }
      if (tab.includes('expense')) {
        return hasPermission('expenses');
      }
      if (tab.includes('report') || tab.startsWith('report-') || tab.startsWith('sales-')) {
        return hasPermission('reports') || hasPermission('sales');
      }
      if (tab === 'backup-restore') {
        return hasPermission('backup');
      }
      if (tab === 'system-settings' || tab === 'company-settings' || tab === 'printer-setup') {
        return hasPermission('settings');
      }
      if (tab.startsWith('closing-')) {
        if (tab === 'closing-reopen') {
          return isSuperAdmin || hasPermission('closing') || hasPermission('accounts');
        }
        return (
          hasPermission('closing') ||
          hasPermission('accounts') ||
          hasPermission('reports')
        );
      }
      return true;
    },
    [isSuperAdmin, hasPermission]
  );

  // Clear stale cached draft references on fresh start (preserving session token)
  useEffect(() => {
    try {
      localStorage.removeItem('ams_sales_invoice_active_draft');
      localStorage.removeItem('ams_active_purchase_draft');
    } catch {
      // ignore
    }
  }, []);

  const fetchSystemData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      setError(null);

      const [healthData, dbData, settingsData] = await Promise.all([
        api.getHealth(),
        api.getDatabaseStatus(),
        api.getCompanySettings(),
      ]);

      setHealth(healthData);
      setDiagnostics(dbData.diagnostics);
      setTables(dbData.tables || []);
      setSettings(settingsData.data);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSystemData();
    }
  }, [isAuthenticated, fetchSystemData]);

  // Default to Dashboard on fresh login
  useEffect(() => {
    if (user) {
      setActiveTab('dashboard');
    }
  }, [user?.id]);

  // Standalone Salesman Mobile Booking PWA mode (?mode=mobile-booking or /mobile-booking)
  const isStandaloneMobileBooking =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=mobile-booking') ||
      window.location.pathname === '/mobile-booking');

  if (isStandaloneMobileBooking) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 p-2 sm:p-4">
        <SalesmanMobileBookingApp
          onExitMobileMode={() => {
            window.history.replaceState({}, '', '/');
            window.location.reload();
          }}
        />
      </div>
    );
  }

  // 1. Loading Splash while checking server-side authentication session
  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-2xl shadow-xl shadow-emerald-500/20 mb-4 animate-pulse">
          A
        </div>
        <div className="text-base font-bold tracking-tight">ABRAR MEDICAL STORE</div>
        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
          <span>Verifying security session...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated: Render Clean & Professional Login Screen
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // 3. Authenticated: Render Full Medical Store ERP Workspace
  const handleResumeFromRegister = (id: number) => {
    setResumeInvoiceId(id);
    setActiveTab('sales-pos');
  };

  // Determine view title & breadcrumbs
  const getHeaderInfo = (): { title: string; crumbs: string[] } => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Executive Store Dashboard — Real-Time ERP Overview',
          crumbs: ['Dashboard', 'Store Overview'],
        };
      // A. ITEM MANAGEMENT
      case 'items':
      case 'items-master':
        return { title: 'Item Master — Medicine Catalog & Valuation', crumbs: ['Item Management', 'Item Master'] };
      case 'item-categories':
        return { title: 'Item Categories — Therapeutic & Product Classification', crumbs: ['Item Management', 'Item Categories'] };
      case 'item-groups':
        return { title: 'Item Groups — Manufacturer & Formula Grouping', crumbs: ['Item Management', 'Item Groups'] };
      case 'item-search':
        return { title: 'Item Search — Fast Multi-Field Medicine Lookup', crumbs: ['Item Management', 'Item Search'] };
      case 'stock-datasheet':
      case 'inv-current':
        return { title: 'Item Stock Report — Consolidated Stock Movement & Valuation', crumbs: ['Item Management', 'Item Stock Report'] };
      case 'stock-statement':
      case 'inv-stock-statement':
        return { title: 'Company-Wise Stock Statement — Multi-Company Print & Export', crumbs: ['Item Management', 'Company Stock Statement'] };
      case 'batch-expiry':
      case 'inventory':
      case 'inv-datasheet':
        return { title: 'Batch & Expiry — Batch-Wise Stock & Expiry Datasheet', crumbs: ['Item Management', 'Batch & Expiry'] };
      case 'item-offers':
        return { title: 'Item Offers — Bonus Schemes & Trade Discounts', crumbs: ['Item Management', 'Item Offers'] };
      case 'item-claims':
        return { title: 'Item Claims — Expired / Damaged Supplier Claims & Adjustments', crumbs: ['Item Management', 'Item Claims'] };
      case 'stock-adjustment':
      case 'inv-adjustment':
        return { title: 'Stock Adjustment — Quantity Corrections & Damage Write-Offs', crumbs: ['Item Management', 'Stock Adjustment'] };
      case 'item-ledger':
      case 'inv-ledger':
        return { title: 'Item Ledger — Chronological Item Movement & Running Balances', crumbs: ['Item Management', 'Item Ledger'] };
      case 'item-log':
        return { title: 'Item Log — Item Audit & Movement History', crumbs: ['Item Management', 'Item Log'] };
      case 'item-import-export':
        return { title: 'Item Import / Export — Bulk Excel Catalog Sync', crumbs: ['Item Management', 'Item Import / Export'] };

      // B. PARTY & ACCOUNTS
      case 'party-customers':
        return { title: 'Customer Management — Customer Accounts & Credit Profiles', crumbs: ['Party & Accounts', 'Customer Management'] };
      case 'party-suppliers':
        return { title: 'Supplier Management — Pharmaceutical Distributors & Vendors', crumbs: ['Party & Accounts', 'Supplier Management'] };
      case 'party-master':
        return { title: 'Party Master — Unified Customer & Supplier Directory', crumbs: ['Party & Accounts', 'Party Master'] };
      case 'accounts':
      case 'accounts-master':
        return { title: 'Account Management — Chart of Accounts & Opening Balances', crumbs: ['Party & Accounts', 'Account Management'] };
      case 'account-groups':
      case 'coa-hierarchy':
        return { title: 'Account Groups — 5-Pillar Hierarchical Double-Entry COA', crumbs: ['Party & Accounts', 'Account Groups'] };
      case 'party-ledger':
      case 'ledger-customer':
        return { title: 'Party Ledger — Double-Entry Customer & Supplier Statement', crumbs: ['Party & Accounts', 'Party Ledger'] };
      case 'ledger-supplier':
        return { title: 'Supplier Ledger — Double-Entry Payables Statement', crumbs: ['Party & Accounts', 'Supplier Ledger'] };
      case 'aging-receivables':
      case 'fin-customer-outstanding':
        return { title: 'Customer Outstanding — Receivables Aging & Credit Control', crumbs: ['Party & Accounts', 'Customer Outstanding'] };
      case 'aging-payables':
      case 'fin-supplier-outstanding':
        return { title: 'Supplier Outstanding — Payables Aging & Due Bills', crumbs: ['Party & Accounts', 'Supplier Outstanding'] };
      case 'recovery-sheet':
      case 'payment-customer-receipt':
        return { title: 'Customer Recovery — Counter & Credit Settlement', crumbs: ['Party & Accounts', 'Customer Recovery'] };
      case 'supplier-payments':
        return { title: 'Supplier Payments — Vendor Bill Settlement & Vouchers', crumbs: ['Party & Accounts', 'Supplier Payments'] };

      // C. SALES MANAGEMENT
      case 'sales-new':
      case 'sales-pos':
      case 'sales':
        return { title: 'Sales Invoice — 14-Column POS & Wholesale Datasheet', crumbs: ['Sales Management', 'Sales Invoice'] };
      case 'sales-return':
      case 'sale-returns':
        return { title: 'Sales Return — Invoice-Linked Medicine Return & Stock Restoration', crumbs: ['Sales Management', 'Sales Return'] };
      case 'sales-register':
        return { title: 'Sales History — Confirmed Invoices & Reprint Center', crumbs: ['Sales Management', 'Sales History'] };
      case 'sales-reports':
      case 'report-monthly-sales':
        return { title: 'Sales Reports — Comprehensive Sales & Revenue Analytics', crumbs: ['Sales Management', 'Sales Reports'] };
      case 'sales-customer-wise':
      case 'report-customer-sales':
        return { title: 'Customer Sales Report — Party-Wise Sales & Recovery', crumbs: ['Sales Management', 'Customer Sales Report'] };
      case 'sales-salesman-wise':
        return { title: 'Salesman Sales Report — Full Pack Performance & Outstanding', crumbs: ['Sales Management', 'Salesman Sales Report'] };
      case 'staff-salesmen':
        return { title: 'Salesman Management — Directory, Commissions & Linked Profiles', crumbs: ['Party & Accounts', 'Salesman Management'] };
      case 'sales-held':
        return { title: 'Held & Draft Invoices — Resume or Discard Pending Bills', crumbs: ['Sales Management', 'Held / Draft Invoices'] };
      case 'sales-return-register':
        return { title: 'Sales Return Register — Customer Credit Notes & Refunds', crumbs: ['Sales Management', 'Sales Return Register'] };
      case 'deliveryman-master':
      case 'staff-deliverymen':
        return { title: 'Deliveryman Directory & Rider Performance', crumbs: ['Sales Management', 'Deliveryman Directory'] };
      case 'delivery-tracking':
      case 'staff-deliveries':
        return { title: 'Delivery Dispatch & Tracking', crumbs: ['Sales Management', 'Delivery Dispatch'] };

      // D. PURCHASE MANAGEMENT
      case 'purchases':
      case 'purchases-bill':
        return { title: 'Purchase Invoice — Goods Receiving & Configurable Advance Tax', crumbs: ['Purchase Management', 'Purchase Invoice'] };
      case 'purchase-returns':
      case 'purchases-return':
        return { title: 'Purchase Return — Supplier Debit Notes & Tax Adjustments', crumbs: ['Purchase Management', 'Purchase Return'] };
      case 'purchase-history':
        return { title: 'Purchase History — Confirmed Supplier Bills & Register', crumbs: ['Purchase Management', 'Purchase History'] };
      case 'purchase-reports':
        return { title: 'Purchase Reports — Supplier, Item & Tax Analytics', crumbs: ['Purchase Management', 'Purchase Reports'] };
      case 'purchase-supplier-report':
        return { title: 'Supplier Purchase Report — Vendor-Wise Procurement Summary', crumbs: ['Purchase Management', 'Supplier Purchase Report'] };

      // E. FINANCIAL MANAGEMENT
      case 'cash-book-unified':
      case 'cash-book-Daily':
        return { title: 'Cash Book — Unified Receipt / Payment & Running Balances', crumbs: ['Financial Management', 'Cash Book'] };
      case 'bank-ledger':
      case 'ledger-bank':
        return { title: 'Bank Book — Bank Deposits, Withdrawals & Running Balance', crumbs: ['Financial Management', 'Bank Book'] };
      case 'financial-income':
      case 'fin-income-summary':
        return { title: 'Income Summary — Revenue & Other Income Statement', crumbs: ['Financial Management', 'Income'] };
      case 'expense-entry':
      case 'fin-expense-summary':
        return { title: 'Expenses — Shop & Operating Expense Register', crumbs: ['Financial Management', 'Expenses'] };
      case 'receipt-voucher':
      case 'voucher-crv':
      case 'payment-receive':
        return { title: 'Receipts (CRV) — Cash & Party Receipt Vouchers', crumbs: ['Financial Management', 'Receipts'] };
      case 'payment-voucher':
      case 'voucher-cpv':
      case 'payment-cash':
        return { title: 'Payments (CPV) — Cash & Supplier Payment Vouchers', crumbs: ['Financial Management', 'Payments'] };
      case 'profit-loss':
      case 'fin-profit-loss':
        return { title: 'Profit & Loss Statement (Income Statement)', crumbs: ['Financial Management', 'Profit & Loss'] };
      case 'financial-reports':
      case 'fin-account-summary':
        return { title: 'Financial Reports — Complete Double-Entry Accounting Suite', crumbs: ['Financial Management', 'Financial Reports'] };
      case 'trial-balance':
      case 'fin-trial-balance':
        return { title: 'Account Balances — Trial Balance & Double-Entry Verification', crumbs: ['Financial Management', 'Account Balances'] };
      case 'advance-management':
      case 'tax-advance-accounting':
        return { title: 'Advance Management — Advance Tax & Prepayment Ledger', crumbs: ['Financial Management', 'Advance Management'] };
      case 'bank-receipt':
      case 'voucher-brv':
        return { title: 'Bank Receipt Voucher (BRV) — Double-Entry Datasheet', crumbs: ['Financial Management', 'Bank Receipt'] };
      case 'bank-payment':
      case 'voucher-bpv':
      case 'payment-bank':
        return { title: 'Bank Payment Voucher (BPV) — Double-Entry Datasheet', crumbs: ['Financial Management', 'Bank Payment'] };
      case 'journal-voucher':
      case 'voucher-jv':
        return { title: 'Journal Voucher (JV) — Multi-Line General Journal', crumbs: ['Financial Management', 'Journal Voucher'] };
      case 'contra-voucher':
      case 'voucher-cv':
        return { title: 'Contra Transfer (CV) — Cash & Bank Internal Transfer', crumbs: ['Financial Management', 'Contra Transfer'] };
      case 'general-ledger':
      case 'ledger-general':
        return { title: 'General Ledger — Complete Double-Entry Account Ledger', crumbs: ['Financial Management', 'General Ledger'] };
      case 'cash-book':
      case 'ledger-cash':
        return { title: 'Cash Drawer Ledger — Counter Cash Drawer Running Balance', crumbs: ['Financial Management', 'Cash Drawer Ledger'] };
      case 'account-statement':
      case 'ledger-statement':
        return { title: 'Account Statement — Running Balance Statement', crumbs: ['Financial Management', 'Account Statement'] };
      case 'balance-sheet':
      case 'fin-balance-sheet':
        return { title: 'Balance Sheet — Assets, Liabilities & Equity', crumbs: ['Financial Management', 'Balance Sheet'] };
      case 'tax-settings':
        return { title: 'Tax Settings — Configurable Filer / Non-Filer Rates', crumbs: ['Financial Management', 'Tax Settings'] };
      case 'tax-summary':
        return { title: 'Tax Summary — Sales & Purchase Advance Tax + GST Statement', crumbs: ['Financial Management', 'Tax Summary'] };
      case 'tax-invoice-history':
      case 'tax-history':
        return { title: 'Invoice Tax History — Advance Tax Audit Trail', crumbs: ['Financial Management', 'Invoice Tax History'] };

      // F. INVENTORY & WAREHOUSE
      case 'inventory-overview':
      case 'inv-overview':
        return { title: 'Stock Overview — Inventory Valuation, Health & KPI Dashboard', crumbs: ['Inventory & Warehouse', 'Stock Overview'] };
      case 'stock-movement':
        return { title: 'Stock Movement — Chronological Inward & Outward Stock Register', crumbs: ['Inventory & Warehouse', 'Stock Movement'] };
      case 'stock-transfer':
      case 'inv-transfer':
        return { title: 'Stock Transfer — Shelf & Warehouse Location Movements', crumbs: ['Inventory & Warehouse', 'Stock Transfer'] };
      case 'warehouses-master':
        return { title: 'Warehouse Management — Store & Godown Locations', crumbs: ['Inventory & Warehouse', 'Warehouse Management'] };
      case 'stock-valuation':
        return { title: 'Stock Valuation — Trade Cost vs Retail Stock Valuation', crumbs: ['Inventory & Warehouse', 'Stock Valuation'] };
      case 'expiry-alerts':
      case 'inv-expiry':
        return { title: 'Expiry Reports — Pharmaceutical Batch Expiry Controls', crumbs: ['Inventory & Warehouse', 'Expiry Reports'] };
      case 'low-stock':
      case 'inv-low-stock':
        return { title: 'Low Stock Reports — Reorder Deficit Planning', crumbs: ['Inventory & Warehouse', 'Low Stock Reports'] };
      case 'near-expiry':
      case 'inv-near-expiry':
        return { title: 'Near Expiry Items — 30/60/90 Day Early Warning Batches', crumbs: ['Inventory & Warehouse', 'Near Expiry'] };
      case 'expired-items':
      case 'inv-expired':
        return { title: 'Expired Items — Quarantine Register (Sale Blocked)', crumbs: ['Inventory & Warehouse', 'Expired Items'] };
      case 'physical-verification':
      case 'inv-verification':
        return { title: 'Physical Stock Verification — Count Sheets & Reconciliation', crumbs: ['Inventory & Warehouse', 'Physical Verification'] };

      // G. REPORTS & ANALYTICS
      case 'report-item-reports':
      case 'detailed-stock-report':
      case 'inv-detailed-stock':
        return { title: 'Detailed Item Stock & Transaction Report — Opening, Movement & Closing', crumbs: ['Reports & Analytics', 'Detailed Item Stock Report'] };
      case 'sales-item-wise':
      case 'report-item-sales':
        return { title: 'Item Sales Reports — Item-Wise Quantity & Revenue Breakdown', crumbs: ['Reports & Analytics', 'Item Sales Reports'] };
      case 'report-item-purchases':
        return { title: 'Item Purchase Reports — Item-Wise Procurement & Cost History', crumbs: ['Reports & Analytics', 'Item Purchase Reports'] };
      case 'sales-profit-report':
      case 'report-profit':
        return { title: 'Item Profit Reports — Actual Purchase Cost vs Net Sales Profit', crumbs: ['Reports & Analytics', 'Item Profit Reports'] };
      case 'report-quarterly':
        return { title: 'Item Full Quarterly Report — Multi-Month Sales & Profit Performance', crumbs: ['Reports & Analytics', 'Item Full Quarterly Report'] };
      case 'report-account-profit':
        return { title: 'Account Profit Reports — Customer & Party Profitability Analysis', crumbs: ['Reports & Analytics', 'Account Profit Reports'] };
      case 'top-performance-reports':
        return {
          title: 'Top Performance & Overall Sales / Purchase Reports — Increment / Decrement Analysis',
          crumbs: ['Reports & Analytics', 'Top Performance & Overall Reports'],
        };
      case 'sales-daily-summary':
        return {
          title: 'Sales Performance Analysis — Top Ranking, Overall Summary & Increment/Decrement',
          crumbs: ['Reports & Analytics', 'Sales Analysis'],
        };
      case 'report-daily-sales':
        return { title: 'Daily Sales — Period Sales Breakdown', crumbs: ['Reports & Analytics', 'Daily Sales'] };
      case 'report-purchase-analysis':
        return {
          title: 'Purchase Performance Analysis — Top Suppliers, Items, Towns & Increment/Decrement',
          crumbs: ['Reports & Analytics', 'Purchase Analysis'],
        };
      case 'sales-discount-report':
      case 'report-discount':
        return { title: 'Discount Report — Invoice & Line Discount Audit', crumbs: ['Reports & Analytics', 'Discount Report'] };
      case 'sales-return-report':
      case 'report-sales-return':
        return { title: 'Sales Return Report — Returned Items & Credit Analysis', crumbs: ['Reports & Analytics', 'Sales Return Report'] };

      case 'more-options':
        return {
          title: 'Sales Invoice More Options — Headings, Footers & Field Visibility',
          crumbs: ['System & Settings', 'More Options'],
        };
      case 'users':
      case 'users-manage':
        return {
          title: 'User Management & Individual Role Permissions — Super Admin Portal',
          crumbs: ['System & Settings', 'User Management'],
        };
      case 'company-settings':
      case 'system-settings':
        return { title: 'Company Settings — Store Profile & Localization', crumbs: ['System & Settings', 'Company Settings'] };
      case 'printer-setup':
        return { title: 'Printer Settings — A4 & Thermal Receipt Configuration', crumbs: ['System & Settings', 'Printer Settings'] };
      case 'backup-restore':
        return { title: 'Backup & Restore — Automated Database Backups & Recovery', crumbs: ['System & Settings', 'Backup & Restore'] };
      case 'data-import-export':
        return { title: 'Data Import / Export — Bulk Catalog & Account Excel Tools', crumbs: ['System & Settings', 'Data Import / Export'] };
      case 'database':
      case 'system-admin':
      case 'system-info':
        return { title: 'Database Status & System Diagnostics', crumbs: ['System & Settings', 'Database Status'] };
      case 'audit-logs':
        return { title: 'System Logs — Activity & Audit Trail', crumbs: ['System & Settings', 'System Logs'] };

      // I. CLOSING MANAGEMENT
      case 'closing-daily':
        return {
          title: 'Daily Closing — Cash Drawer Reconciliation, Bank Balance & Discrepancy Audit',
          crumbs: ['Closing Management', 'Daily Closing'],
        };
      case 'closing-monthly':
        return {
          title: 'Monthly Closing — Complete Financial Closing & Opening Balance Carry-Forward',
          crumbs: ['Closing Management', 'Monthly Closing'],
        };
      case 'closing-yearly':
        return {
          title: 'Yearly Closing — Annual Profit/Loss Transfer & Next Financial Year Roll-Forward',
          crumbs: ['Closing Management', 'Yearly Closing'],
        };
      case 'closing-stock':
        return {
          title: 'Stock Closing — Item-Wise Movement, Closing Quantity & Valuation Snapshot',
          crumbs: ['Closing Management', 'Stock Closing'],
        };
      case 'closing-history':
        return {
          title: 'Closing History — Searchable Register & Printable Historical Closing Reports',
          crumbs: ['Closing Management', 'Closing History'],
        };
      case 'closing-reopen':
        return {
          title: 'Reopen Closed Period — Super Admin Period Lock Control & Audit Trail',
          crumbs: ['Closing Management', 'Reopen Closed Period'],
        };

      default:
        return { title: 'Abrar Medical Store ERP', crumbs: ['Workspace'] };
    }
  };

  const headerInfo = getHeaderInfo();
  const isTabPermitted = canAccessTab(activeTab);

  // Map inventory-related tabs to InventoryWorkspaceView sub-tabs
  const inventorySubTabMap: Partial<Record<NavTabId, string>> = {
    'inventory-overview': 'inv-overview',
    'inv-overview': 'inv-overview',
    'stock-valuation': 'inv-overview',
    'stock-datasheet': 'inv-current',
    'inv-current': 'inv-current',
    'stock-statement': 'inv-stock-statement',
    'inv-stock-statement': 'inv-stock-statement',
    'detailed-stock-report': 'inv-detailed-stock',
    'inv-detailed-stock': 'inv-detailed-stock',
    'report-item-reports': 'inv-detailed-stock',
    'batch-expiry': 'inv-datasheet',
    'inv-datasheet': 'inv-datasheet',
    'expiry-alerts': 'inv-expiry',
    'inv-expiry': 'inv-expiry',
    'near-expiry': 'inv-near-expiry',
    'inv-near-expiry': 'inv-near-expiry',
    'expired-items': 'inv-expired',
    'inv-expired': 'inv-expired',
    'low-stock': 'inv-low-stock',
    'inv-low-stock': 'inv-low-stock',
    'stock-adjustment': 'inv-adjustment',
    'inv-adjustment': 'inv-adjustment',
    'item-claims': 'inv-adjustment',
    'stock-transfer': 'inv-transfer',
    'inv-transfer': 'inv-transfer',
    'warehouses-master': 'inv-transfer',
    'item-ledger': 'inv-ledger',
    'inv-ledger': 'inv-ledger',
    'item-log': 'inv-ledger',
    'stock-movement': 'inv-ledger',
    'physical-verification': 'inv-verification',
    'inv-verification': 'inv-verification',
  };
  const mappedInventorySubTab = inventorySubTabMap[activeTab];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-800 font-sans antialiased print:h-auto print:w-auto print:overflow-visible print:bg-white">
      {/* Expandable / Collapsible Left Sidebar (Hidden when Sales or Purchase Invoice is in Full-Screen Mode) */}
      {!isFullScreenInvoice && (
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          roleName={user?.role}
          databaseConnected={diagnostics?.connected ?? false}
          totalTables={tables.length}
          hasUnsavedInvoiceItems={hasUnsavedInvoiceItems}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen w-full overflow-hidden min-w-0 print:h-auto print:overflow-visible print:block">
        {!isFullScreenInvoice && (
          <TopHeader
            currentViewTitle={headerInfo.title}
            breadcrumbs={headerInfo.crumbs}
            diagnostics={diagnostics}
            loading={loading}
            onRefresh={fetchSystemData}
            onNavigateToUsers={() => handleSelectTab('users')}
            onNavigateToMoreOptions={() => handleSelectTab('more-options')}
            onNavigateToAudit={() => handleSelectTab('audit-logs')}
            onNavigateToClearDemoData={() => handleSelectTab('database')}
            compact={false}
          />
        )}

        {/* Non-Destructive Quick Account & Voucher Shortcuts Bar */}
        {!isSalesInvoiceTab &&
          !isPurchaseInvoiceTab &&
          (hasPermission('accounts') || hasPermission('ledgers') || hasPermission('payments')) && (
          <div className="bg-slate-900 border-b border-slate-800 px-3 py-1 flex items-center gap-1.5 overflow-x-auto shrink-0 print:hidden">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mr-1 shrink-0">
              Quick Shortcuts:
            </span>
            <button
              type="button"
              onClick={() => setQuickShortcut('customer-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Users2 className="w-3 h-3 text-emerald-400" />
              Customer Ledger
            </button>
            <button
              type="button"
              onClick={() => setQuickShortcut('supplier-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Building2 className="w-3 h-3 text-teal-400" />
              Supplier Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cash-book-unified')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Wallet className="w-3 h-3 text-amber-400" />
              Cash Book
            </button>
            <button
              type="button"
              onClick={() => setQuickShortcut('bank-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <CreditCard className="w-3 h-3 text-sky-400" />
              Bank Book
            </button>
            {hasPermission('payments', 'create') && (
              <>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('receive-payment')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Banknote className="w-3 h-3 text-emerald-400" />
                  Receive Payment
                </button>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('make-payment')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Banknote className="w-3 h-3 text-rose-400" />
                  Make Payment
                </button>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('journal-voucher')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3 text-purple-400" />
                  Journal Voucher
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setQuickShortcut('advance-tax-details')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Percent className="w-3 h-3 text-amber-300" />
              Advance Tax Details
            </button>
          </div>
        )}

        <main
          className={`flex-1 min-h-0 ${
            isFullScreenInvoice
              ? 'p-0 m-0 w-full h-full overflow-hidden flex flex-col bg-slate-100'
              : 'overflow-y-auto p-4 lg:p-5'
          }`}
        >
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <div className="font-bold text-xs">Database / Backend Communication Notice</div>
                  <div className="text-xs text-rose-700 font-mono mt-0.5">{error}</div>
                </div>
              </div>
              <button
                onClick={fetchSystemData}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          )}

          {/* RBAC Guard: If user lacks permission for activeTab, block rendering */}
          {!isTabPermitted ? (
            <div className="max-w-lg mx-auto my-12 bg-white rounded-2xl border border-rose-200 p-6 text-center shadow-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900">Access Restricted</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your assigned role (<span className="font-bold text-slate-900">{user?.role}</span>) does not have permission to view this module. Please contact the Store Super Administrator if you require access.
              </p>
              <button
                type="button"
                onClick={() => handleSelectTab('dashboard')}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Return to Executive Dashboard</span>
              </button>
            </div>
          ) : (
            <>
              {/* EXECUTIVE DASHBOARD */}
              {activeTab === 'dashboard' && <DashboardView onSelectTab={handleSelectTab} />}

              {/* H. SYSTEM & SETTINGS — LOGS */}
              {activeTab === 'audit-logs' && (
                <SecurityAuditView onNavigateToClearDemoData={() => handleSelectTab('database')} />
              )}

              {/* C. SALES MANAGEMENT (Kept mounted once visited to preserve active draft lines) */}
              {hasPermission('sales') && hasVisitedSales && (
                <div className={isSalesInvoiceTab ? 'flex-1 w-full h-full flex flex-col min-h-0 overflow-hidden' : 'hidden'}>
                  <SalesInvoiceDatasheet
                    resumeInvoiceId={resumeInvoiceId}
                    onClearResume={() => setResumeInvoiceId(null)}
                    onDraftItemsStateChange={setHasUnsavedInvoiceItems}
                    onNavigateToSalesReturn={() => handleSelectTab('sales-return')}
                    onNavigateToSalesHistory={() => handleSelectTab('sales-register')}
                    onBackToDashboard={handleCloseFullScreenInvoice}
                  />
                </div>
              )}

              {activeTab === 'sales-register' && (
                <SalesRegisterView
                  mode="register"
                  onEditInvoice={handleResumeFromRegister}
                  onResumeInvoice={handleResumeFromRegister}
                />
              )}

              {activeTab === 'sales-held' && (
                <SalesRegisterView mode="held_or_draft" onResumeInvoice={handleResumeFromRegister} />
              )}

              {(activeTab === 'sales-return' || activeTab === 'sale-returns') && (
                <SalesReturnView initialMode="entry" />
              )}

              {activeTab === 'sales-return-register' && <SalesReturnView initialMode="register" />}

              {/* SALESMAN & DELIVERYMAN */}
              {activeTab === 'staff-salesmen' && (
                <StaffAndDeliveryWorkspaceView initialTab="salesmen" />
              )}
              {activeTab === 'sales-salesman-wise' && (
                <SalesReportsView initialReport="salesman-wise-sales" />
              )}
              {(activeTab === 'staff-deliverymen' || activeTab === 'deliveryman-master') && (
                <StaffAndDeliveryWorkspaceView initialTab="deliverymen" />
              )}
              {(activeTab === 'staff-deliveries' || activeTab === 'delivery-tracking') && (
                <StaffAndDeliveryWorkspaceView initialTab="deliveries" />
              )}

              {/* B. PARTY & ACCOUNTS + E. FINANCIAL MANAGEMENT */}
              {(activeTab === 'cash-book-unified' || activeTab === 'cash-book-Daily') && (
                <CashBookModuleView
                  onNavigateToCustomerLedger={() => setActiveTab('party-ledger')}
                  onNavigateToSupplierLedger={() => setActiveTab('ledger-supplier')}
                />
              )}
              {(activeTab === 'coa-hierarchy' || activeTab === 'account-groups') && (
                <ChartOfAccountsView />
              )}
              {(activeTab === 'ledger-customer' || activeTab === 'party-ledger') && (
                <LedgersWorkspaceView initialTab="customer" />
              )}
              {activeTab === 'ledger-supplier' && <LedgersWorkspaceView initialTab="supplier" />}
              {(activeTab === 'ledger-general' || activeTab === 'general-ledger') && (
                <LedgersWorkspaceView initialTab="general" />
              )}
              {(activeTab === 'ledger-cash' || activeTab === 'cash-book') && (
                <LedgersWorkspaceView initialTab="cash-book" />
              )}
              {(activeTab === 'ledger-bank' || activeTab === 'bank-ledger') && (
                <LedgersWorkspaceView initialTab="bank-book" />
              )}
              {(activeTab === 'ledger-statement' || activeTab === 'account-statement') && (
                <AccountLedgersView ledgerType="statement" />
              )}
              {(activeTab === 'accounts' ||
                activeTab === 'accounts-master' ||
                activeTab === 'party-master') && (
                <AccountsMasterView initialLedgerView="all" />
              )}
              {activeTab === 'party-customers' && (
                <AccountsMasterView initialLedgerView="customer" initialHierarchyMode={false} />
              )}
              {activeTab === 'party-suppliers' && (
                <AccountsMasterView initialLedgerView="supplier" initialHierarchyMode={false} />
              )}

              {/* VOUCHERS & PAYMENTS */}
              {(activeTab === 'voucher-crv' || activeTab === 'receipt-voucher') && (
                <VoucherManagementView initialVoucherType="CRV" />
              )}
              {(activeTab === 'voucher-cpv' || activeTab === 'payment-voucher') && (
                <VoucherManagementView initialVoucherType="CPV" />
              )}
              {(activeTab === 'voucher-brv' || activeTab === 'bank-receipt') && (
                <VoucherManagementView initialVoucherType="BRV" />
              )}
              {(activeTab === 'voucher-bpv' || activeTab === 'bank-payment') && (
                <VoucherManagementView initialVoucherType="BPV" />
              )}
              {(activeTab === 'voucher-jv' || activeTab === 'journal-voucher') && (
                <VoucherManagementView initialVoucherType="JV" />
              )}
              {(activeTab === 'voucher-cv' || activeTab === 'contra-voucher') && (
                <VoucherManagementView initialVoucherType="CV" />
              )}

              {activeTab === 'payment-receive' && (
                <PaymentsWorkspaceView initialVoucherType="receive_payment" />
              )}
              {(activeTab === 'payment-customer-receipt' || activeTab === 'recovery-sheet') && (
                <PaymentsWorkspaceView initialVoucherType="customer_receipt" />
              )}
              {(activeTab === 'payment-cash' || activeTab === 'supplier-payments') && (
                <PaymentsWorkspaceView initialVoucherType="cash_payment" />
              )}
              {activeTab === 'payment-bank' && (
                <PaymentsWorkspaceView initialVoucherType="bank_payment" />
              )}

              {/* TAX & ADVANCE MANAGEMENT */}
              {(activeTab === 'tax-advance-accounting' || activeTab === 'advance-management') && (
                <AdvanceTaxAccountingView />
              )}
              {activeTab === 'tax-settings' && <AdvanceTaxSettingsPanel />}
              {activeTab === 'tax-summary' && <SalesReportsView initialReport="tax-summary" />}
              {(activeTab === 'tax-history' || activeTab === 'tax-invoice-history') && (
                <SalesReportsView initialReport="tax-history" />
              )}

              {/* FINANCIAL REPORTS */}
              {(activeTab === 'fin-trial-balance' || activeTab === 'trial-balance') && (
                <FinancialReportsView initialReport="trial-balance" />
              )}
              {(activeTab === 'fin-profit-loss' || activeTab === 'profit-loss') && (
                <FinancialReportsView initialReport="profit-loss" />
              )}
              {(activeTab === 'fin-balance-sheet' || activeTab === 'balance-sheet') && (
                <FinancialReportsView initialReport="balance-sheet" />
              )}
              {activeTab === 'fin-cash-flow' && <FinancialReportsView initialReport="cash-flow" />}
              {activeTab === 'fin-day-book' && <FinancialReportsView initialReport="day-book" />}
              {(activeTab === 'fin-account-summary' || activeTab === 'financial-reports') && (
                <FinancialReportsView initialReport="account-summary" />
              )}
              {(activeTab === 'fin-customer-outstanding' || activeTab === 'aging-receivables') && (
                <FinancialReportsView initialReport="customer-outstanding" />
              )}
              {(activeTab === 'fin-supplier-outstanding' || activeTab === 'aging-payables') && (
                <FinancialReportsView initialReport="supplier-outstanding" />
              )}
              {(activeTab === 'fin-expense-summary' || activeTab === 'expense-entry') && (
                <FinancialReportsView initialReport="expense-summary" />
              )}
              {(activeTab === 'fin-income-summary' || activeTab === 'financial-income') && (
                <FinancialReportsView initialReport="income-summary" />
              )}
              {activeTab === 'fin-advance-tax-report' && (
                <FinancialReportsView initialReport="advance-tax-report" />
              )}

              {/* C. SALES REPORTS & G. REPORTS & ANALYTICS */}
              {activeTab === 'top-performance-reports' && (
                <TopPerformanceReportsView initialAnalysisMode="overall" />
              )}
              {activeTab === 'sales-daily-summary' && (
                <TopPerformanceReportsView initialAnalysisMode="sales" />
              )}
              {activeTab === 'report-purchase-analysis' && (
                <TopPerformanceReportsView initialAnalysisMode="purchase" />
              )}
              {activeTab === 'report-daily-sales' && (
                <SalesReportsView initialReport="daily-sales" />
              )}
              {(activeTab === 'report-monthly-sales' ||
                activeTab === 'sales-reports' ||
                activeTab === 'report-quarterly') && (
                <SalesReportsView initialReport="monthly-sales" />
              )}
              {(activeTab === 'report-item-sales' ||
                activeTab === 'sales-item-wise') && (
                <SalesReportsView initialReport="item-wise-sales" />
              )}
              {(activeTab === 'report-customer-sales' ||
                activeTab === 'sales-customer-wise' ||
                activeTab === 'report-account-profit') && (
                <SalesReportsView initialReport="customer-wise-sales" />
              )}
              {(activeTab === 'report-profit' || activeTab === 'sales-profit-report') && (
                <SalesReportsView initialReport="profit-report" />
              )}
              {(activeTab === 'report-discount' || activeTab === 'sales-discount-report') && (
                <SalesReportsView initialReport="discount-report" />
              )}
              {(activeTab === 'report-sales-return' || activeTab === 'sales-return-report') && (
                <SalesReportsView initialReport="sales-return-report" />
              )}

              {/* A. ITEM MANAGEMENT & D. PURCHASE MANAGEMENT */}
              {(activeTab === 'items' ||
                activeTab === 'items-master' ||
                activeTab === 'item-categories' ||
                activeTab === 'item-groups' ||
                activeTab === 'item-search') && <ItemsMasterView initialOpenImport={false} />}

              {(activeTab === 'item-import-export' || activeTab === 'data-import-export') && (
                <ItemsMasterView initialOpenImport={true} />
              )}

              {/* TRADE DEALS, PARTY DISCOUNTS, FIFO BATCHES & OFFER REPORTS */}
              {(activeTab === 'item-offers' || activeTab === 'trade-deals-offers') && (
                <TradeDealsAndPartyDiscountsWorkspace initialTab="trade-offers" />
              )}
              {activeTab === 'party-special-discounts' && (
                <TradeDealsAndPartyDiscountsWorkspace initialTab="party-discounts" />
              )}
              {activeTab === 'fifo-batch-control' && (
                <TradeDealsAndPartyDiscountsWorkspace initialTab="fifo-batches" />
              )}
              {activeTab === 'offer-discount-reports' && (
                <TradeDealsAndPartyDiscountsWorkspace initialTab="offer-reports" />
              )}

              {/* SUPPLY & DISTRIBUTION MANAGEMENT SYSTEM */}
              {activeTab.startsWith('supply-') && (
                <SupplyDistributionWorkspace
                  initialView={activeTab as SupplySubView}
                  onNavigate={(view) => setActiveTab(view as NavTabId)}
                />
              )}

              {/* SALESMAN MOBILE BOOKING PWA */}
              {activeTab === 'mobile-booking-app' && (
                <SalesmanMobileBookingApp
                  onExitMobileMode={() => setActiveTab('supply-dashboard')}
                />
              )}

              {hasPermission('purchases') && hasVisitedPurchases && (
                <div className={isPurchaseInvoiceTab ? 'flex-1 w-full h-full flex flex-col min-h-0 overflow-hidden' : 'hidden'}>
                  <PurchasesWorkspaceView
                    initialSubTab="new-invoice"
                    onBackToDashboard={handleCloseFullScreenInvoice}
                  />
                </div>
              )}
              {(activeTab === 'purchase-returns' || activeTab === 'purchases-return') && (
                <PurchasesWorkspaceView
                  initialSubTab="purchase-return"
                  onBackToDashboard={handleCloseFullScreenInvoice}
                />
              )}
              {activeTab === 'purchase-history' && (
                <PurchasesWorkspaceView
                  initialSubTab="register"
                  onBackToDashboard={handleCloseFullScreenInvoice}
                />
              )}
              {(activeTab === 'purchase-reports' ||
                activeTab === 'purchase-supplier-report' ||
                activeTab === 'report-item-purchases') && (
                <PurchasesWorkspaceView
                  initialSubTab="reports"
                  onBackToDashboard={handleCloseFullScreenInvoice}
                />
              )}
              {activeTab === 'inventory' && (
                <PurchasesWorkspaceView
                  initialSubTab="batch-stock"
                  onBackToDashboard={handleCloseFullScreenInvoice}
                />
              )}

              {/* F. INVENTORY & WAREHOUSE */}
              {mappedInventorySubTab && (
                <InventoryWorkspaceView
                  initialSubTab={mappedInventorySubTab as any}
                  onSubTabChange={(tab) => setActiveTab(tab as any)}
                />
              )}

              {/* H. SYSTEM & SETTINGS */}
              {(activeTab === 'system-settings' ||
                activeTab === 'company-settings' ||
                activeTab === 'printer-setup') && (
                <SystemSettingsView
                  key="system-settings"
                  settings={settings}
                  initialSubTab="store-printing"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}
              {activeTab === 'backup-restore' && (
                <SystemSettingsView
                  key="backup-restore"
                  settings={settings}
                  initialSubTab="backup-restore"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}
              {activeTab === 'master-reset' && isSuperAdmin && (
                <MasterResetAndLocalBackupPanel
                  initialSection="master-reset"
                  onDataChanged={fetchSystemData}
                />
              )}
              {(activeTab === 'system-admin' ||
                activeTab === 'database' ||
                activeTab === 'system-info') && (
                <SystemSettingsView
                  key="system-admin"
                  settings={settings}
                  initialSubTab="system-admin"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}

              {/* SUPER ADMIN: MORE OPTIONS */}
              {activeTab === 'more-options' && isSuperAdmin && <MoreOptionsView />}

              {/* SUPER ADMIN: USER MANAGEMENT */}
              {(activeTab === 'users' || activeTab === 'users-manage') && isSuperAdmin && (
                <UserManagementView />
              )}

              {/* CLOSING & FINANCIAL PERIOD MANAGEMENT */}
              {activeTab.startsWith('closing-') && (
                <ClosingManagementWorkspace
                  initialTab={activeTab as ClosingTabId}
                  onNavigateTab={handleSelectTab}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Non-Destructive Quick Account & Voucher Modal Overlay */}
      <QuickAccountShortcutsModal
        isOpen={quickShortcut !== null}
        initialAction={quickShortcut || 'customer-ledger'}
        onClose={() => setQuickShortcut(null)}
      />

    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
