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
import { LoginScreen } from './components/auth/LoginScreen';
import { FirstTimeSetupScreen } from './components/auth/FirstTimeSetupScreen';
import { UserManagementView } from './components/admin/UserManagementView';
import { UserPasswordManagementView } from './components/admin/UserPasswordManagementView';
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
    isInitialized,
    loading: authLoading,
    user,
    hasPermission,
    isSuperAdmin,
    refreshAuth,
    logout,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [hasVisitedSales, setHasVisitedSales] = useState<boolean>(false);
  const [hasVisitedPurchases, setHasVisitedPurchases] = useState<boolean>(false);
  const [resumeInvoiceId, setResumeInvoiceId] = useState<number | null>(null);
  const [hasUnsavedInvoiceItems, setHasUnsavedInvoiceItems] = useState<boolean>(false);
  const [quickShortcut, setQuickShortcut] = useState<QuickShortcutAction | null>(null);

  // Forced password change state
  const [currentPwd, setCurrentPwd] = useState<string>('');
  const [newPwd, setNewPwd] = useState<string>('');
  const [confirmPwd, setConfirmPwd] = useState<string>('');
  const [pwdChangeError, setPwdChangeError] = useState<string | null>(null);
  const [pwdChangeBusy, setPwdChangeBusy] = useState<boolean>(false);

  const isSalesInvoiceTab = activeTab === 'sales-new' || activeTab === 'sales-pos';
  const isPurchaseInvoiceTab = activeTab === 'purchases' || activeTab === 'purchases-bill';

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

  // Check if current logged-in user is permitted to access a specific tab
  const canAccessTab = useCallback(
    (tab: NavTabId): boolean => {
      if (!isAuthenticated || !user) return false;
      if (
        tab === 'user-passwords' ||
        tab === 'users-manage' ||
        tab === 'users' ||
        tab === 'roles-permissions'
      ) {
        return isSuperAdmin;
      }
      if (isSuperAdmin) return true;
      if (tab === 'dashboard') return true;

      if (
        tab === 'audit-logs' ||
        tab === 'system-settings' ||
        tab === 'company-settings' ||
        tab === 'printer-setup' ||
        tab === 'backup-restore' ||
        tab === 'data-import-export' ||
        tab === 'database' ||
        tab === 'system-info' ||
        tab === 'system-admin'
      ) {
        return true;
      }
      if (
        tab === 'sales-new' ||
        tab === 'sales-pos' ||
        tab === 'sales-register' ||
        tab === 'sales-held' ||
        tab === 'sales' ||
        tab === 'sales-reports' ||
        tab === 'sales-customer-wise' ||
        tab === 'sales-salesman-wise' ||
        tab === 'deliveryman-master' ||
        tab === 'delivery-tracking' ||
        tab === 'staff-salesmen' ||
        tab === 'staff-deliverymen' ||
        tab === 'staff-deliveries'
      ) {
        return hasPermission('sales') || hasPermission('reports');
      }
      if (tab === 'sales-return' || tab === 'sales-return-register' || tab === 'sale-returns') {
        return hasPermission('sale_returns') || hasPermission('sales');
      }
      if (
        tab === 'purchases' ||
        tab === 'purchases-bill' ||
        tab === 'purchase-history' ||
        tab === 'purchase-reports' ||
        tab === 'purchase-supplier-report'
      ) {
        return hasPermission('purchases') || hasPermission('reports');
      }
      if (tab === 'purchase-returns' || tab === 'purchases-return') {
        return hasPermission('purchase_returns') || hasPermission('purchases');
      }
      if (
        tab === 'items' ||
        tab === 'items-master' ||
        tab === 'item-categories' ||
        tab === 'item-groups' ||
        tab === 'item-search' ||
        tab === 'item-offers' ||
        tab === 'item-claims' ||
        tab === 'item-log' ||
        tab === 'item-import-export'
      ) {
        return hasPermission('items') || hasPermission('inventory');
      }
      if (
        tab === 'inventory' ||
        tab.startsWith('inv-') ||
        tab === 'inventory-overview' ||
        tab === 'stock-datasheet' ||
        tab === 'batch-expiry' ||
        tab === 'stock-adjustment' ||
        tab === 'item-ledger' ||
        tab === 'stock-movement' ||
        tab === 'stock-transfer' ||
        tab === 'warehouses-master' ||
        tab === 'stock-valuation' ||
        tab === 'expiry-alerts' ||
        tab === 'low-stock' ||
        tab === 'near-expiry' ||
        tab === 'expired-items' ||
        tab === 'physical-verification'
      ) {
        return hasPermission('inventory') || hasPermission('items') || user.role === 'Administrator';
      }
      if (
        tab === 'accounts' ||
        tab === 'accounts-master' ||
        tab === 'party-customers' ||
        tab === 'party-suppliers' ||
        tab === 'party-master' ||
        tab === 'account-groups' ||
        tab === 'coa-hierarchy' ||
        tab === 'cash-book-unified' ||
        tab === 'cash-book-Daily'
      ) {
        return hasPermission('accounts') || hasPermission('ledgers') || hasPermission('payments');
      }
      if (
        tab.startsWith('ledger-') ||
        tab === 'party-ledger' ||
        tab === 'bank-ledger' ||
        tab === 'general-ledger' ||
        tab === 'cash-book' ||
        tab === 'account-statement'
      ) {
        return hasPermission('ledgers') || hasPermission('accounts');
      }
      if (
        tab.startsWith('voucher-') ||
        tab.startsWith('payment-') ||
        tab === 'receipt-voucher' ||
        tab === 'payment-voucher' ||
        tab === 'bank-receipt' ||
        tab === 'bank-payment' ||
        tab === 'journal-voucher' ||
        tab === 'contra-voucher' ||
        tab === 'expense-entry' ||
        tab === 'financial-income' ||
        tab === 'recovery-sheet' ||
        tab === 'supplier-payments'
      ) {
        return hasPermission('payments') || hasPermission('accounts');
      }
      if (tab.startsWith('tax-') || tab === 'advance-management') {
        return hasPermission('tax') || hasPermission('accounts');
      }
      if (
        tab.startsWith('fin-') ||
        tab.startsWith('report-') ||
        tab.startsWith('sales-') ||
        tab === 'profit-loss' ||
        tab === 'financial-reports' ||
        tab === 'trial-balance' ||
        tab === 'balance-sheet' ||
        tab === 'aging-receivables' ||
        tab === 'aging-payables'
      ) {
        return hasPermission('reports') || hasPermission('accounts') || hasPermission('sales');
      }
      return true;
    },
    [isAuthenticated, user, isSuperAdmin, hasPermission]
  );

  // Protect direct URLs: when unauthenticated, force URL to root and block direct path/hash bypass
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      if (window.location.pathname !== '/' || window.location.hash) {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [authLoading, isAuthenticated]);

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

  // 2. Uninitialized System: First-Time Super Admin Setup
  if (!isInitialized) {
    return <FirstTimeSetupScreen />;
  }

  // 3. Unauthenticated: Display Login Screen First (Never reveal dashboard or menus before login)
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // 3b. Forced Password Change Gate (if Super Admin required password change on next login)
  const handleForcedPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdChangeError(null);
    if (!currentPwd || !newPwd) {
      setPwdChangeError('Please enter both your current password and a new password.');
      return;
    }
    if (newPwd.length < 4) {
      setPwdChangeError('New password must be at least 4 characters long.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdChangeError('New password and confirmation do not match.');
      return;
    }
    try {
      setPwdChangeBusy(true);
      await api.changeMyPassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      await refreshAuth();
    } catch (err: any) {
      setPwdChangeError(err?.message || 'Failed to update password.');
    } finally {
      setPwdChangeBusy(false);
    }
  };

  // 4. Authenticated: Render Full Medical Store ERP Workspace
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
        return { title: 'Item Stock — Consolidated Item-Level Inventory Summary', crumbs: ['Item Management', 'Item Stock'] };
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
      case 'staff-salesmen':
        return { title: 'Salesman Sales Report — Commissions & Performance', crumbs: ['Sales Management', 'Salesman Sales Report'] };
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
        return { title: 'Item Reports — Comprehensive Medicine Sales & Stock Analytics', crumbs: ['Reports & Analytics', 'Item Reports'] };
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
      case 'sales-daily-summary':
      case 'report-daily-sales':
        return { title: 'Sales Analysis — Daily & Period Sales Breakdown', crumbs: ['Reports & Analytics', 'Sales Analysis'] };
      case 'report-purchase-analysis':
        return { title: 'Purchase Analysis — Procurement Trends & Supplier Breakdown', crumbs: ['Reports & Analytics', 'Purchase Analysis'] };
      case 'sales-discount-report':
      case 'report-discount':
        return { title: 'Discount Report — Invoice & Line Discount Audit', crumbs: ['Reports & Analytics', 'Discount Report'] };
      case 'sales-return-report':
      case 'report-sales-return':
        return { title: 'Sales Return Report — Returned Items & Credit Analysis', crumbs: ['Reports & Analytics', 'Sales Return Report'] };

      // H. SYSTEM & SETTINGS
      case 'users':
      case 'users-manage':
        return { title: 'User Management — Staff Accounts & Access Control', crumbs: ['System & Settings', 'User Management'] };
      case 'roles-permissions':
        return { title: 'Roles & Permissions — Module Access Matrix', crumbs: ['System & Settings', 'Roles & Permissions'] };
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
        return { title: 'System Logs — Authentication & Security Audit Trail', crumbs: ['System & Settings', 'System Logs'] };
      case 'user-passwords':
        return { title: 'User Passwords — Super Admin Credential & Access Control', crumbs: ['System & Settings', 'User Passwords'] };

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
      {/* Expandable / Collapsible Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        roleName={user?.role}
        databaseConnected={diagnostics?.connected ?? false}
        totalTables={tables.length}
        hasUnsavedInvoiceItems={hasUnsavedInvoiceItems}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 print:h-auto print:overflow-visible print:block">
        <TopHeader
          currentViewTitle={headerInfo.title}
          breadcrumbs={headerInfo.crumbs}
          diagnostics={diagnostics}
          loading={loading}
          onRefresh={fetchSystemData}
          onNavigateToUsers={() => setActiveTab('users')}
          onNavigateToAudit={() => setActiveTab('audit-logs')}
          onNavigateToClearDemoData={() => setActiveTab('database')}
          compact={isSalesInvoiceTab || isPurchaseInvoiceTab}
        />

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
            isSalesInvoiceTab || isPurchaseInvoiceTab
              ? 'p-0.5 overflow-hidden flex flex-col'
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
                onClick={() => setActiveTab('dashboard')}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Return to Executive Dashboard</span>
              </button>
            </div>
          ) : (
            <>
              {/* EXECUTIVE DASHBOARD */}
              {activeTab === 'dashboard' && <DashboardView onSelectTab={setActiveTab} />}

              {/* H. SYSTEM & SETTINGS — USER MANAGEMENT & LOGS */}
              {activeTab === 'user-passwords' && isSuperAdmin && <UserPasswordManagementView />}
              {(activeTab === 'users-manage' ||
                activeTab === 'users' ||
                activeTab === 'roles-permissions') && <UserManagementView />}
              {activeTab === 'audit-logs' && (
                <SecurityAuditView onNavigateToClearDemoData={() => setActiveTab('database')} />
              )}

              {/* C. SALES MANAGEMENT (Kept mounted once visited to preserve active draft lines) */}
              {hasPermission('sales') && hasVisitedSales && (
                <div className={isSalesInvoiceTab ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden' : 'hidden'}>
                  <SalesInvoiceDatasheet
                    resumeInvoiceId={resumeInvoiceId}
                    onClearResume={() => setResumeInvoiceId(null)}
                    onDraftItemsStateChange={setHasUnsavedInvoiceItems}
                    onNavigateToSalesReturn={() => setActiveTab('sales-return')}
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
              {(activeTab === 'staff-salesmen' || activeTab === 'sales-salesman-wise') && (
                <StaffAndDeliveryWorkspaceView initialTab="salesmen" />
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
              {(activeTab === 'report-daily-sales' || activeTab === 'sales-daily-summary') && (
                <SalesReportsView initialReport="daily-sales" />
              )}
              {(activeTab === 'report-monthly-sales' ||
                activeTab === 'sales-reports' ||
                activeTab === 'report-quarterly') && (
                <SalesReportsView initialReport="monthly-sales" />
              )}
              {(activeTab === 'report-item-sales' ||
                activeTab === 'sales-item-wise' ||
                activeTab === 'report-item-reports') && (
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
                activeTab === 'item-search' ||
                activeTab === 'item-offers') && <ItemsMasterView initialOpenImport={false} />}

              {(activeTab === 'item-import-export' || activeTab === 'data-import-export') && (
                <ItemsMasterView initialOpenImport={true} />
              )}

              {hasPermission('purchases') && hasVisitedPurchases && (
                <div className={isPurchaseInvoiceTab ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden' : 'hidden'}>
                  <PurchasesWorkspaceView initialSubTab="new-invoice" />
                </div>
              )}
              {(activeTab === 'purchase-returns' || activeTab === 'purchases-return') && (
                <PurchasesWorkspaceView initialSubTab="purchase-return" />
              )}
              {activeTab === 'purchase-history' && (
                <PurchasesWorkspaceView initialSubTab="register" />
              )}
              {(activeTab === 'purchase-reports' ||
                activeTab === 'purchase-supplier-report' ||
                activeTab === 'report-item-purchases' ||
                activeTab === 'report-purchase-analysis') && (
                <PurchasesWorkspaceView initialSubTab="reports" />
              )}
              {activeTab === 'inventory' && <PurchasesWorkspaceView initialSubTab="batch-stock" />}

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

      {/* Mandatory Password Change Modal (when force_password_change === 1) */}
      {user?.force_password_change === 1 && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold">Password Change Required</h4>
                <p className="text-[11px] text-slate-400">
                  Your Super Administrator requires you to set a new password before continuing.
                </p>
              </div>
            </div>
            <form onSubmit={handleForcedPasswordSubmit} className="p-5 space-y-3.5 text-xs">
              {pwdChangeError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-medium">
                  {pwdChangeError}
                </div>
              )}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Current / Temporary Password *</label>
                <input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs"
                  placeholder="Enter temporary password"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">New Personal Password *</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs"
                  placeholder="Minimum 4 characters"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Confirm New Password *</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs"
                  placeholder="Re-enter new password"
                  required
                />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Sign Out
                </button>
                <button
                  type="submit"
                  disabled={pwdChangeBusy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{pwdChangeBusy ? 'Updating...' : 'Save New Password'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
