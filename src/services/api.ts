import { HealthResponse, SettingsResponse } from '../types/system';
import { DatabaseStatusResponse, ModulesResponse } from '../types/database';
import {
  AuthStatusResponse,
  LoginResponse,
  User,
  AuditLog,
} from '../types/auth';
import {
  StockDatasheetItem,
  CurrentStockSummary,
  InventoryOverview,
  ExpiryAlertItem,
  LowStockItem,
  StockAdjustment,
  StockTransfer,
  StockLedgerEntry,
  PhysicalVerification,
} from '../types/inventory';
import { offlineStorage } from './offlineStorage';
import { offlineSyncManager } from './offlineSyncManager';

const LEGACY_TOKEN_KEY = 'ams_session_token';
const LEGACY_CACHED_SESSION_KEY = 'ams_cached_auth_session';
const LEGACY_OFFLINE_VERIFIERS_KEY = 'ams_offline_auth_verifiers';
const DEVICE_ID_KEY = 'ams_registered_device_id';
const DEVICE_NAME_KEY = 'ams_registered_device_name';

function purgeLegacyAuthStorage(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_CACHED_SESSION_KEY);
    localStorage.removeItem(LEGACY_OFFLINE_VERIFIERS_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_CACHED_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getClientDeviceId(): string {
  try {
    let existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const randPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    existing = `DEV-${randPart}`;
    localStorage.setItem(DEVICE_ID_KEY, existing);
    return existing;
  } catch {
    return 'DEV-LOCAL-WORKSTATION';
  }
}

export function getClientDeviceName(): string {
  try {
    const saved = localStorage.getItem(DEVICE_NAME_KEY);
    if (saved && saved.trim()) return saved.trim();

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    let os = 'Workstation';
    if (/Windows/i.test(ua)) os = 'Windows PC';
    else if (/Android/i.test(ua)) os = 'Android Device';
    else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS Device';
    else if (/Macintosh|Mac OS/i.test(ua)) os = 'Mac';
    else if (/Linux/i.test(ua)) os = 'Linux PC';

    let browser = 'Browser';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

    const label = `${os} (${browser})`;
    localStorage.setItem(DEVICE_NAME_KEY, label);
    return label;
  } catch {
    return 'Store Workstation';
  }
}

export function getAuthToken(): string | null {
  return null;
}

export function setAuthToken(_token: string | null, _rememberMe: boolean = false) {
  purgeLegacyAuthStorage();
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', getClientDeviceId());
  }
  if (!headers.has('X-Device-Name')) {
    headers.set('X-Device-Name', getClientDeviceName());
  }
  const res = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers,
  });
  if (
    res.status === 401 &&
    !url.includes('/api/auth/login') &&
    !url.includes('/api/auth/status') &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  ) {
    purgeLegacyAuthStorage();
    window.dispatchEvent(new CustomEvent('ams-session-expired'));
  }
  return res;
}

function round2Local(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function getLocalPrefixForAccountGroup(accountGroup: string, mainGroup?: string): string {
  const g = String(accountGroup || '').trim().toLowerCase();
  const m = String(mainGroup || '').trim().toLowerCase();
  if (g === 'customer' || g === 'customers') return 'Cus';
  if (g === 'supplier' || g === 'suppliers' || g === 'customer & supplier') return 'Sup';
  if (g === 'cash in hand' || g === 'cash') return 'Cash';
  if (g === 'bank' || g === 'bank accounts') return 'Bank';
  if (g === 'capital' || g === 'drawings') return 'Cap';
  if (g.includes('income') || g === 'sales income') return 'Inc';
  if (g.includes('salary') || g.includes('employee')) return 'Emp';
  if (
    g.includes('expense') ||
    g === 'electricity' ||
    g === 'rent' ||
    g === 'salaries' ||
    m.includes('expense')
  ) {
    return 'Exp';
  }
  if (m.includes('financial') || g === 'loans' || g === 'assets' || g === 'liabilities') {
    return 'Fin';
  }
  const letters = String(accountGroup || 'Oth').replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 3) {
    return letters.charAt(0).toUpperCase() + letters.slice(1, 3).toLowerCase();
  }
  return 'Oth';
}

export const api = {
  /**
   * Fetch system health and database connectivity (with Offline Local Fallback)
   */
  async getHealth(): Promise<HealthResponse> {
    try {
      const res = await authFetch('/api/system/health');
      if (res.ok) {
        const data = await res.json();
        offlineStorage.cacheApiData('system_health', data).catch(() => {});
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<HealthResponse>('system_health');
    if (cached) return cached;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Abrar Medical Store ERP (Offline Local Mode)',
      version: '2.0.0',
      environment: 'offline-local',
      database: {
        connected: true,
        path: 'ams_medical.db (IndexedDB Local Mirror)',
        journalMode: 'WAL',
        foreignKeys: true,
        tableCount: 18,
      },
    } as any;
  },

  /**
   * Fetch comprehensive read-only dashboard analytics with optional date range filtering (with Offline Computation)
   */
  async getDashboardAnalytics(params?: { startDate?: string; endDate?: string }): Promise<any> {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    try {
      const res = await authFetch(`/api/system/dashboard-analytics${queryStr}`);
      const data = await res.json();
      if (res.ok && data.success) {
        offlineStorage.cacheApiData('dashboard_analytics', data).catch(() => {});
        return data;
      }
    } catch {
      // Offline fallback: compute live metrics from local IndexedDB
    }

    const cached = await offlineStorage.getCachedApiData<any>('dashboard_analytics');
    const [items, accounts, batches, sales, purchases, cashBook] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('accounts'),
      offlineStorage.getAll<any>('inventory'),
      offlineStorage.getAll<any>('sales'),
      offlineStorage.getAll<any>('purchases'),
      offlineStorage.getAll<any>('cash_book'),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const start = params?.startDate || today;
    const end = params?.endDate || today;

    const completedSales = sales.filter(
      (s) =>
        (s.status === 'completed' || s.status === 'Completed' || !s.status) &&
        String(s.invoice_date || today) >= start &&
        String(s.invoice_date || today) <= end
    );
    const completedPurchases = purchases.filter(
      (p) =>
        (p.status === 'completed' || p.status === 'Completed' || !p.status) &&
        String(p.bill_date || today) >= start &&
        String(p.bill_date || today) <= end
    );

    const periodSalesTotal = round2Local(
      completedSales.reduce((s, r) => s + Number(r.net_total || 0), 0)
    );
    const periodPurchasesTotal = round2Local(
      completedPurchases.reduce((s, r) => s + Number(r.total_payable || r.net_total || 0), 0)
    );

    const cashAccs = accounts.filter((a) => a.account_group === 'Cash in Hand');
    const bankAccs = accounts.filter((a) => a.account_group === 'Bank');
    const custAccs = accounts.filter(
      (a) => a.account_group === 'Customer' || a.account_group === 'Customer & Supplier'
    );
    const supAccs = accounts.filter(
      (a) => a.account_group === 'Supplier' || a.account_group === 'Customer & Supplier'
    );

    const cashInHand = round2Local(
      cashAccs.reduce(
        (s, a) =>
          s +
          (a.current_balance_type === 'Credit'
            ? -Number(a.current_balance || 0)
            : Number(a.current_balance || 0)),
        0
      )
    );
    const bankBalance = round2Local(
      bankAccs.reduce(
        (s, a) =>
          s +
          (a.current_balance_type === 'Credit'
            ? -Number(a.current_balance || 0)
            : Number(a.current_balance || 0)),
        0
      )
    );
    const customerReceivable = round2Local(
      custAccs.reduce(
        (s, a) => s + (a.current_balance_type === 'Debit' ? Number(a.current_balance || 0) : 0),
        0
      )
    );
    const supplierPayable = round2Local(
      supAccs.reduce(
        (s, a) => s + (a.current_balance_type === 'Credit' ? Number(a.current_balance || 0) : 0),
        0
      )
    );

    const stockValuationCost = round2Local(
      batches.reduce(
        (s, b) =>
          s + Math.max(0, Number(b.current_pack_qty || 0)) * Number(b.pack_cost || 0),
        0
      )
    );
    const stockValuationRetail = round2Local(
      batches.reduce(
        (s, b) =>
          s + Math.max(0, Number(b.current_pack_qty || 0)) * Number(b.pack_retail || b.retail_price || 0),
        0
      )
    );

    const periodExpenses = round2Local(
      cashBook
        .filter(
          (cb) =>
            cb.status !== 'cancelled' &&
            (cb.transaction_type === 'Expense' || cb.category === 'shop_expense') &&
            String(cb.voucher_date || today) >= start &&
            String(cb.voucher_date || today) <= end
        )
        .reduce((s, cb) => s + Number(cb.payment_amount || 0), 0)
    );

    if (cached && cached.success) {
      return {
        ...cached,
        offline: true,
        summaryCards: {
          ...(cached.summaryCards || {}),
          todaySales: periodSalesTotal || cached.summaryCards?.todaySales || 0,
          todayInvoicesCount: completedSales.length || cached.summaryCards?.todayInvoicesCount || 0,
          todayPurchases: periodPurchasesTotal || cached.summaryCards?.todayPurchases || 0,
          todayPurchaseBillsCount:
            completedPurchases.length || cached.summaryCards?.todayPurchaseBillsCount || 0,
          cashInHand: cashInHand || cached.summaryCards?.cashInHand || 0,
          bankBalance: bankBalance || cached.summaryCards?.bankBalance || 0,
          customerReceivables: customerReceivable || cached.summaryCards?.customerReceivables || 0,
          supplierPayables: supplierPayable || cached.summaryCards?.supplierPayables || 0,
          totalItems: items.length || cached.summaryCards?.totalItems || 0,
          stockValueCost: stockValuationCost || cached.summaryCards?.stockValueCost || 0,
          stockValueRetail: stockValuationRetail || cached.summaryCards?.stockValueRetail || 0,
          todayExpenses: periodExpenses || cached.summaryCards?.todayExpenses || 0,
        },
        recentSales: sales.slice(0, 10),
        recentPurchases: purchases.slice(0, 10),
      };
    }

    return {
      success: true,
      offline: true,
      period: { startDate: start, endDate: end },
      summaryCards: {
        todaySales: periodSalesTotal,
        todayInvoicesCount: completedSales.length,
        todayPurchases: periodPurchasesTotal,
        todayPurchaseBillsCount: completedPurchases.length,
        todaySalesReturns: 0,
        todayPurchaseReturns: 0,
        todayExpenses: periodExpenses,
        estimatedNetProfit: round2Local(periodSalesTotal * 0.15 - periodExpenses),
        cashInHand,
        bankBalance,
        customerReceivables: customerReceivable,
        supplierPayables: supplierPayable,
        totalItems: items.length,
        activeBatchesCount: batches.length,
        lowStockCount: items.filter((i) => Number(i.opening_stock || 0) <= Number(i.reorder_level || 10)).length,
        nearExpiryCount: 0,
        expiredCount: 0,
        stockValueCost: stockValuationCost,
        stockValueRetail: stockValuationRetail,
      },
      charts: {
        dailySalesTrend: [{ date: today, sales: periodSalesTotal, purchases: periodPurchasesTotal }],
        topSellingItems: [],
        salesByCategory: [],
        paymentModeBreakdown: [],
      },
      recentSales: sales.slice(0, 10),
      recentPurchases: purchases.slice(0, 10),
      lowStockItems: [],
      nearExpiryBatches: [],
    };
  },

  /**
   * Fetch detailed database diagnostics and table schemas (with Offline Local Fallback)
   */
  async getDatabaseStatus(): Promise<DatabaseStatusResponse> {
    try {
      const res = await authFetch('/api/system/database');
      if (res.ok) {
        const data = await res.json();
        offlineStorage.cacheApiData('database_status', data).catch(() => {});
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<DatabaseStatusResponse>('database_status');
    if (cached) return cached;
    return {
      success: true,
      diagnostics: {
        connected: true,
        databasePath: 'ams_medical.db (Local Offline Mode)',
        fileSizeBytes: 0,
        journalMode: 'WAL',
        foreignKeysEnabled: true,
        integrityCheck: 'ok',
        tablesCount: 18,
      },
      tables: [],
    } as any;
  },

  /**
   * Fetch company and localization settings (with Offline Local Fallback)
   */
  async getCompanySettings(): Promise<SettingsResponse> {
    try {
      const res = await authFetch('/api/system/settings');
      if (res.ok) {
        const data = await res.json();
        if (data?.data) {
          offlineStorage.put('company_settings', data.data).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const allSettings = await offlineStorage.getAll<any>('company_settings');
    const localSetting = allSettings[0] || {
      id: 1,
      store_name: 'ABRAR MEDICAL STORE',
      tagline: 'Complete Healthcare & Pharmaceutical Distributors',
      address: 'Main Commercial Market, Lahore',
      phone: '+92 42 35789000',
      currency_code: 'PKR',
      currency_symbol: 'Rs.',
      batch_wise_sales: 1,
      batch_wise_purchase: 1,
      allow_negative_stock: 1,
    };
    return {
      success: true,
      data: localSetting,
    } as any;
  },

  /**
   * Save Store, Printing & Backup Settings permanently
   */
  async updateCompanySettings(payload: Record<string, unknown>): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const res = await authFetch('/api/system/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save settings');
    }
    return data;
  },

  /**
   * Save independent Batch-Wise Sales / Batch-Wise Purchase / Negative Stock toggles permanently
   */
  async updateBatchSettings(payload: {
    batch_wise_sales?: number | boolean;
    batch_wise_purchase?: number | boolean;
    allow_negative_stock?: number | boolean;
  }): Promise<{
    success: boolean;
    data: any;
  }> {
    const res = await authFetch('/api/system/batch-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save batch settings');
    }
    return data;
  },

  /**
   * Backup & Recovery - List all backups and configuration
   */
  async getBackups(): Promise<{
    success: boolean;
    backupDirectory: string;
    configuredDirectory: string;
    autoDailyBackup: boolean;
    autoBackupBeforeChanges: boolean;
    backupRetentionDays: number;
    backups: any[];
  }> {
    const res = await authFetch('/api/system/backups');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load backup history');
    }
    return data;
  },

  /**
   * Backup & Recovery - Create Manual Backup Now
   */
  async createBackup(notes?: string): Promise<{
    success: boolean;
    message: string;
    backup: any;
  }> {
    const res = await authFetch('/api/system/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create backup');
    }
    return data;
  },

  /**
   * Backup & Recovery - Verify Backup Integrity Before Restoration
   */
  async verifyBackup(backupId: number): Promise<{
    success: boolean;
    verification: any;
  }> {
    const res = await authFetch('/api/system/backups/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Backup verification failed');
    }
    return data;
  },

  /**
   * Backup & Recovery - Restore Database from Backup (with automatic pre-restore safety backup)
   */
  async restoreBackup(backupId: number, confirmText: string): Promise<{
    success: boolean;
    safetyBackup: any;
    restoredVerification: any;
    message: string;
  }> {
    const res = await authFetch('/api/system/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId, confirmText }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Database restoration failed');
    }
    return data;
  },

  /**
   * Backup & Recovery - Download Backup File
   */
  async downloadBackup(backupId: number, filename: string): Promise<void> {
    const res = await authFetch(`/api/system/backups/download/${backupId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to download backup file');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  /**
   * System Administration - Get Demo / Testing Data Preview Summary
   */
  async getDemoDataSummary(): Promise<{
    success: boolean;
    demoSummary: {
      demoSales: number;
      demoPurchases: number;
      demoVouchers: number;
      demoStockAdjustments: number;
      expiredSessions: number;
      resolvedErrorLogs: number;
      demoAuditLogs?: number;
      demoItems: number;
      totalDemoRecords: number;
    };
    genuineProtected: {
      genuineItems: number;
      genuineAccounts: number;
      genuineSales: number;
      genuinePurchases: number;
      inventoryBatches: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-data');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to inspect system demo data');
    }
    return data;
  },

  /**
   * System Administration - Clear Temporary / Demo Data
   * Safeguards genuine business records and takes an automatic safety backup
   */
  async clearDemoData(): Promise<{
    success: boolean;
    message: string;
    result: {
      deletedSales: number;
      deletedSaleItems: number;
      deletedPurchases: number;
      deletedPurchaseItems: number;
      deletedVouchers: number;
      deletedAdjustments: number;
      deletedSessions: number;
      deletedResolvedErrors: number;
      deletedDemoItems: number;
      totalCleared: number;
    };
    safetyBackup: {
      filename: string;
      sizeBytes: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-data/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to clear temporary / demo data');
    }
    return data;
  },

  /**
   * System Administration - Clear Temporary / Demo Logs
   */
  async clearDemoLogs(): Promise<{
    success: boolean;
    message: string;
    result: {
      deletedErrorLogs: number;
      deletedDemoAuditLogs: number;
      deletedExpiredSessions: number;
      totalLogsCleared: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-logs/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to clear demo logs');
    }
    return data;
  },

  /**
   * System Administration - Fetch Application & Database Error Logs
   */
  async getSystemErrorLogs(): Promise<{ success: boolean; logs: any[] }> {
    const res = await authFetch('/api/system/error-logs');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch error logs');
    }
    return data;
  },

  /**
   * System Administration - Mark Error Log Resolved
   */
  async resolveSystemErrorLog(id: number): Promise<{ success: boolean; message: string }> {
    const res = await authFetch(`/api/system/error-logs/${id}/resolve`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to resolve error log');
    }
    return data;
  },

  /**
   * System Administration - Fetch Complete System Information, Version & LAN Readiness
   */
  async getSystemInfo(): Promise<any> {
    const res = await authFetch('/api/system/info');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load system information');
    }
    return data;
  },

  /**
   * Fetch module catalog and readiness states
   */
  async getModules(): Promise<ModulesResponse> {
    const res = await authFetch('/api/system/modules');
    if (!res.ok) {
      throw new Error(`Module catalog request failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Run live PRAGMA integrity check on the SQLite file
   */
  async runIntegrityCheck(): Promise<{ success: boolean; result: string; timestamp: string }> {
    const res = await authFetch('/api/system/integrity-check', { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Integrity check request failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Items Master - Fetch all items with search & filtering
   */
  async getItems(params?: {
    q?: string;
    category?: string;
    company?: string;
    status?: string;
    lowStock?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.category) query.append('category', params.category);
    if (params?.company) query.append('company', params.company);
    if (params?.status) query.append('status', params.status);
    if (params?.lowStock) query.append('lowStock', 'true');
    if (params?.sortBy) query.append('sortBy', params.sortBy);
    if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

    try {
      const res = await authFetch(`/api/items?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          offlineStorage.bulkPut('items', data.items).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback: serve directly from IndexedDB
    }
    const localItems = await offlineSyncManager.searchLocalItems(params?.q || '', 100);
    return { success: true, items: localItems, offline: true };
  },

  /**
   * Items Master - Check if Item Code exists
   */
  async checkItemCode(code: string, excludeId?: number): Promise<{ exists: boolean }> {
    try {
      const query = excludeId ? `?excludeId=${excludeId}` : '';
      const res = await authFetch(`/api/items/check-code/${encodeURIComponent(code)}${query}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Offline fallback
    }
    const localItems = await offlineStorage.getAll<any>('items');
    const exists = localItems.some(
      (i) =>
        String(i.item_code || '').toLowerCase() === String(code || '').trim().toLowerCase() &&
        (!excludeId || Number(i.id) !== Number(excludeId))
    );
    return { exists };
  },

  /**
   * Items Master - Create Item (with Offline Local Persistence & Sync Queue)
   */
  async createItem(item: any) {
    try {
      const res = await authFetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.item) {
          offlineStorage.put('items', data.item).catch(() => {});
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (
        err?.message &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        throw err;
      }
    }

    const allItems = await offlineStorage.getAll<any>('items');
    const maxId = allItems.reduce((m, i) => Math.max(m, Number(i.id || 0)), 0);
    const localItem = {
      id: maxId + 1,
      item_code: item.item_code || `MED-${String(maxId + 1).padStart(4, '0')}`,
      barcode: item.barcode || '',
      item_name: String(item.item_name || '').trim(),
      generic_name: item.generic_name || '',
      category: item.category || 'Medicine',
      company_name: item.company_name || '',
      packing: item.packing || '1x1',
      purchase_price: round2Local(item.purchase_price || 0),
      trade_price: round2Local(item.trade_price || item.purchase_price || 0),
      wholesale_price: round2Local(item.wholesale_price || item.retail_price || 0),
      retail_price: round2Local(item.retail_price || 0),
      loose_rate: round2Local(item.loose_rate || 0),
      tax_percent: round2Local(item.tax_percent || 0),
      discount_percent: round2Local(item.discount_percent || 0),
      reorder_level: Number(item.reorder_level || 10),
      opening_stock: Number(item.opening_stock || 0),
      rack_location: item.rack_location || '',
      status: item.status || 'Active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('items', localItem);
    const txId = `ITEM-CREATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: offlineSyncManager.getState().deviceId,
      action: 'CREATE_ITEM',
      entity: 'items',
      local_id: localItem.id,
      payload: localItem,
      created_at: new Date().toISOString(),
    });
    await offlineSyncManager.refreshPendingCount();
    return {
      success: true,
      offline: true,
      item: localItem,
      data: localItem,
      message: 'Item saved locally (Offline Mode). Will automatically synchronize when online.',
    };
  },

  /**
   * Items Master - Update Item (with Offline Local Persistence & Sync Queue)
   */
  async updateItem(id: number, item: any) {
    try {
      const res = await authFetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.item) {
          offlineStorage.put('items', data.item).catch(() => {});
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (
        err?.message &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        throw err;
      }
    }

    const existing = (await offlineStorage.get<any>('items', Number(id))) || { id: Number(id) };
    const updatedItem = {
      ...existing,
      ...item,
      id: Number(id),
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('items', updatedItem);
    const txId = `ITEM-UPD-${id}-${Date.now()}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: offlineSyncManager.getState().deviceId,
      action: 'UPDATE_ITEM',
      entity: 'items',
      local_id: id,
      payload: updatedItem,
      created_at: new Date().toISOString(),
    });
    await offlineSyncManager.refreshPendingCount();
    return {
      success: true,
      offline: true,
      item: updatedItem,
      data: updatedItem,
      message: 'Item updated locally (Offline Mode). Will automatically synchronize when online.',
    };
  },

  /**
   * Items Master - Safe Transactional Purchase Price & Retail/Loose Rate Cascade Update (with Offline Support)
   */
  async updateItemPriceCascade(
    id: number,
    payload: {
      new_purchase_price: number;
      update_purchase_price: boolean;
      update_retail_price: boolean;
    }
  ): Promise<{
    success: boolean;
    item: any;
    cascade: {
      item_id: number;
      item_code: string;
      item_name: string;
      packing: string;
      units_per_pack: number;
      old_purchase_price: number;
      new_purchase_price: number;
      retail_base: number;
      old_retail_price: number;
      new_retail_price: number;
      old_loose_rate: number;
      new_loose_rate: number;
      updated_purchase_price: boolean;
      updated_retail_price: boolean;
    };
  }> {
    try {
      const res = await authFetch(`/api/items/${id}/price-cascade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.item) {
          offlineStorage.put('items', data.item).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback: compute cascade locally, update IndexedDB, and queue sync
    }

    const existing = (await offlineStorage.get<any>('items', Number(id))) || {
      id: Number(id),
      item_code: `MED-${id}`,
      item_name: 'Item',
      packing: '1x1',
      purchase_price: 0,
      retail_price: 0,
      loose_rate: 0,
    };

    const packingStr = String(existing.packing || '1x1').trim();
    const multMatch = packingStr.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    const numMatch = packingStr.match(/(\d+)/);
    const unitsPerPack = multMatch
      ? Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10))
      : numMatch
      ? Math.max(1, parseInt(numMatch[1], 10))
      : 1;

    const oldPur = round2Local(existing.purchase_price || 0);
    const oldRet = round2Local(existing.retail_price || 0);
    const oldLoose =
      Number(existing.loose_rate || 0) > 0
        ? round2Local(existing.loose_rate)
        : round2Local(oldRet / unitsPerPack);

    const newPur = round2Local(payload.new_purchase_price);
    const retailBase = newPur > 0 ? round2Local(newPur / 0.85) : 0;
    const calcRetail = retailBase;

    const finalPur = payload.update_purchase_price ? newPur : oldPur;
    const finalRet = payload.update_retail_price ? calcRetail : oldRet;
    const finalLoose = round2Local(finalRet / unitsPerPack);

    const updatedItem = {
      ...existing,
      purchase_price: finalPur,
      trade_price: finalPur,
      retail_price: finalRet,
      loose_rate: finalLoose,
      updated_at: new Date().toISOString(),
    };

    await offlineStorage.put('items', updatedItem);
    const txId = `ITEM-CASCADE-${id}-${Date.now()}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: offlineSyncManager.getState().deviceId,
      action: 'UPDATE_ITEM_PRICE_CASCADE',
      entity: 'items',
      local_id: id,
      payload: { id: Number(id), ...payload },
      created_at: new Date().toISOString(),
    });
    await offlineSyncManager.refreshPendingCount();

    return {
      success: true,
      item: updatedItem,
      cascade: {
        item_id: Number(id),
        item_code: existing.item_code || '',
        item_name: existing.item_name || '',
        packing: packingStr,
        units_per_pack: unitsPerPack,
        old_purchase_price: oldPur,
        new_purchase_price: finalPur,
        retail_base: retailBase,
        old_retail_price: oldRet,
        new_retail_price: finalRet,
        old_loose_rate: oldLoose,
        new_loose_rate: finalLoose,
        updated_purchase_price: Boolean(payload.update_purchase_price),
        updated_retail_price: Boolean(payload.update_retail_price),
      },
    };
  },

  /**
   * Items Master - Delete Item
   */
  async deleteItem(id: number) {
    const res = await authFetch(`/api/items/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete item');
    }
    return data;
  },

  /**
   * Items Master - Excel Bulk Import
   */
  async bulkImportItems(items: any[], updateExisting: boolean = false) {
    const res = await authFetch('/api/items/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, updateExisting }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const detailMsg = data.errors ? `\n• ${data.errors.join('\n• ')}` : '';
      throw new Error((data.error || 'Import failed') + detailMsg);
    }
    return data;
  },

  /**
   * Accounts Master - Fetch all accounts with search, group, hierarchy & ledger filtering
   */
  async getAccounts(params?: {
    q?: string;
    mainGroup?: string;
    accountGroup?: string;
    parentAccountId?: string;
    status?: string;
    ledgerView?: 'all' | 'customer' | 'supplier';
    townId?: string;
    town?: string;
    areaId?: string;
    area?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.mainGroup) query.append('mainGroup', params.mainGroup);
    if (params?.accountGroup) query.append('accountGroup', params.accountGroup);
    if (params?.parentAccountId) query.append('parentAccountId', params.parentAccountId);
    if (params?.status) query.append('status', params.status);
    if (params?.ledgerView && params.ledgerView !== 'all') query.append('ledgerView', params.ledgerView);
    if (params?.townId) query.append('townId', params.townId);
    if (params?.town) query.append('town', params.town);
    if (params?.areaId) query.append('areaId', params.areaId);
    if (params?.area) query.append('area', params.area);
    if (params?.sortBy) query.append('sortBy', params.sortBy);
    if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

    try {
      const res = await authFetch(`/api/accounts?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.accounts)) {
          offlineStorage.bulkPut('accounts', data.accounts).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback: serve directly from IndexedDB
    }
    const localAccounts = await offlineSyncManager.searchLocalAccounts(params?.q || '', 100);
    return { success: true, accounts: localAccounts, offline: true };
  },

  /**
   * Accounts Master - Fetch single account details with sub-accounts & protection info
   */
  async getAccountDetails(id: number) {
    try {
      const res = await authFetch(`/api/accounts/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback
    }
    const localAcc = await offlineStorage.get<any>('accounts', Number(id));
    return {
      success: true,
      offline: true,
      account: localAcc || { id: Number(id), account_name: 'Account', account_code: '' },
      subAccounts: [],
    };
  },

  /**
   * Accounts Master - Check if Account Code exists
   */
  async checkAccountCode(code: string, excludeId?: number): Promise<{ exists: boolean }> {
    try {
      const query = excludeId ? `?excludeId=${excludeId}` : '';
      const res = await authFetch(`/api/accounts/check-code/${encodeURIComponent(code)}${query}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Offline fallback
    }
    const allAccs = await offlineStorage.getAll<any>('accounts');
    const exists = allAccs.some(
      (a) =>
        String(a.account_code || '').toLowerCase() === String(code || '').trim().toLowerCase() &&
        (!excludeId || Number(a.id) !== Number(excludeId))
    );
    return { exists };
  },

  /**
   * Accounts Master - Get Next Universal Automatic Account Code (with Offline Support)
   */
  async getNextAccountCode(
    accountGroup: string,
    mainGroup?: string
  ): Promise<{ success: boolean; prefix: string; next_code: string; next_number: number; account_type: string }> {
    try {
      const params = new URLSearchParams();
      if (accountGroup) params.append('account_group', accountGroup);
      if (mainGroup) params.append('main_group', mainGroup);
      const res = await authFetch(`/api/accounts/next-code?${params.toString()}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Offline fallback: compute highest assigned number for this prefix from local IndexedDB accounts
    }
    const prefix = getLocalPrefixForAccountGroup(accountGroup, mainGroup);
    const allAccs = await offlineStorage.getAll<any>('accounts');
    const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
    let maxNum = 0;
    for (const acc of allAccs) {
      const m = String(acc.account_code || '').trim().match(regex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    const nextNum = maxNum + 1;
    const nextCode = `${prefix}-${String(nextNum).padStart(3, '0')}`;
    return {
      success: true,
      prefix,
      next_code: nextCode,
      next_number: nextNum,
      account_type: accountGroup || 'Customer',
    };
  },

  /**
   * Accounts Master - Create Account (with Offline Local Persistence & Sync Queue)
   */
  async createAccount(account: any) {
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.account) {
          offlineStorage.put('accounts', data.account).catch(() => {});
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (
        err?.message &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        throw err;
      }
    }

    const codeInfo = await this.getNextAccountCode(
      account.account_group || 'Customer',
      account.main_group || 'PARTY ACCOUNTS'
    );
    const allAccs = await offlineStorage.getAll<any>('accounts');
    const maxId = allAccs.reduce((m, a) => Math.max(m, Number(a.id || 0)), 0);
    const openBal = round2Local(account.opening_balance || 0);
    const openType = account.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';

    const localAcc = {
      id: maxId + 1,
      account_code: codeInfo.next_code,
      account_name: String(account.account_name || '').trim(),
      main_group: account.main_group || 'PARTY ACCOUNTS',
      account_group: account.account_group || 'Customer',
      parent_account_id: account.parent_account_id || null,
      opening_balance: openBal,
      opening_balance_type: openType,
      total_debit: openType === 'Debit' ? openBal : 0,
      total_credit: openType === 'Credit' ? openBal : 0,
      current_balance: openBal,
      current_balance_type: openType,
      contact_person: account.contact_person || '',
      phone: account.phone || '',
      email: account.email || '',
      ntn: account.ntn || '',
      strn: account.strn || '',
      filer_status: account.filer_status || 'Non-Filer',
      address: account.address || '',
      city: account.city || '',
      credit_limit: round2Local(account.credit_limit || 0),
      is_system_account: 0,
      status: account.status || 'Active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await offlineStorage.put('accounts', localAcc);
    const txId = `ACC-CREATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: offlineSyncManager.getState().deviceId,
      action: 'CREATE_ACCOUNT',
      entity: 'accounts',
      local_id: localAcc.id,
      payload: localAcc,
      created_at: new Date().toISOString(),
    });
    await offlineSyncManager.refreshPendingCount();

    return {
      success: true,
      offline: true,
      account: localAcc,
      data: localAcc,
      message: `Account ${localAcc.account_code} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
  },

  /**
   * Accounts Master - Update Account (with Offline Local Persistence & Sync Queue)
   */
  async updateAccount(id: number, account: any) {
    try {
      const res = await authFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.account) {
          offlineStorage.put('accounts', data.account).catch(() => {});
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (
        err?.message &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        throw err;
      }
    }

    const existing = (await offlineStorage.get<any>('accounts', Number(id))) || { id: Number(id) };
    const updatedAcc = {
      ...existing,
      ...account,
      id: Number(id),
      account_code: existing.account_code || account.account_code,
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('accounts', updatedAcc);
    const txId = `ACC-UPD-${id}-${Date.now()}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: offlineSyncManager.getState().deviceId,
      action: 'UPDATE_ACCOUNT',
      entity: 'accounts',
      local_id: id,
      payload: updatedAcc,
      created_at: new Date().toISOString(),
    });
    await offlineSyncManager.refreshPendingCount();

    return {
      success: true,
      offline: true,
      account: updatedAcc,
      data: updatedAcc,
      message: 'Account updated locally (Offline Mode). Will automatically synchronize when online.',
    };
  },

  /**
   * Accounts Master - Update single account Opening Balance
   */
  async updateAccountOpeningBalance(
    id: number,
    opening_balance: number,
    opening_balance_type: 'Debit' | 'Credit'
  ) {
    const res = await authFetch(`/api/accounts/${id}/opening-balance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_balance, opening_balance_type }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update opening balance');
    }
    return data;
  },

  /**
   * Accounts Master - Bulk Update Opening Balances
   */
  async bulkUpdateOpeningBalances(
    entries: Array<{ id: number; opening_balance: number; opening_balance_type: 'Debit' | 'Credit' }>
  ) {
    const res = await authFetch('/api/accounts/opening-balances/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update opening balances');
    }
    return data;
  },

  /**
   * Accounts Master - Delete Account (with transaction & hierarchy protection)
   */
  async deleteAccount(id: number) {
    const res = await authFetch(`/api/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete account');
    }
    return data;
  },

  /**
   * Accounts Master - Excel Bulk Import
   */
  async bulkImportAccounts(accounts: any[], updateExisting: boolean = false) {
    const res = await authFetch('/api/accounts/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts, updateExisting }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const detailMsg = data.errors ? `\n• ${data.errors.join('\n• ')}` : '';
      throw new Error((data.error || 'Accounts import failed') + detailMsg);
    }
    return data;
  },

  /**
   * Advance Tax Settings & Audit History (with Offline Fallback)
   */
  async getAdvanceTaxSettings() {
    try {
      const res = await authFetch('/api/purchases/tax-settings');
      const data = await res.json();
      if (res.ok && data.success) {
        offlineStorage.cacheApiData('advance_tax_settings_resp', data).catch(() => {});
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('advance_tax_settings_resp');
    if (cached) return cached;
    return {
      success: true,
      offline: true,
      settings: {
        id: 1,
        filer_rate: 0.1,
        non_filer_rate: 2.0,
        exempt_rate: 0.0,
        apply_on_purchases: 1,
        apply_on_sales: 0,
      },
      data: {
        id: 1,
        filer_rate: 0.1,
        non_filer_rate: 2.0,
        exempt_rate: 0.0,
        apply_on_purchases: 1,
        apply_on_sales: 0,
      },
      history: [],
    };
  },

  async updateAdvanceTaxSettings(payload: any) {
    const res = await authFetch('/api/purchases/tax-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update Advance Tax settings');
    }
    return data;
  },

  /**
   * Purchase Module - Next Auto Numbers (Inv-YYYY-MM-XX) (with Offline Support)
   */
  async getNextPurchaseNumbers(date?: string): Promise<{
    success: boolean;
    nextPurchaseNumber: string;
    nextReturnNumber: string;
  }> {
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : '';
      const res = await authFetch(`/api/purchases/next-numbers${query}`);
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback
    }
    const now = date ? new Date(date) : new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const localPurchases = await offlineStorage.getAll<any>('purchases');
    const nextSeq = localPurchases.length + 1;
    return {
      success: true,
      nextPurchaseNumber: `Inv-${ym}-${String(nextSeq).padStart(2, '0')}`,
      nextReturnNumber: `PR-${ym}-${String(nextSeq).padStart(2, '0')}`,
    };
  },

  /**
   * Purchase Module - Fast Search Items (by Item Name, Generic Name, Brand/Category, Company, Item Code, Barcode)
   */
  async fastSearchPurchaseItems(q: string = '', limit: number = 40) {
    const query = new URLSearchParams();
    if (q) query.append('q', q);
    query.append('limit', String(limit));

    try {
      const res = await authFetch(`/api/purchases/fast-search?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          offlineStorage.bulkPut('items', data.items).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const localItems = await offlineSyncManager.searchLocalItems(q, limit);
    return { success: true, items: localItems, data: localItems, offline: true };
  },

  /**
   * Purchase Module - Fast Search Suppliers (by Supplier Name, Account Code, Mobile Number)
   */
  async fastSearchPurchaseSuppliers(q: string = '', limit: number = 40) {
    const query = new URLSearchParams();
    if (q) query.append('q', q);
    query.append('limit', String(limit));

    try {
      const res = await authFetch(`/api/purchases/fast-search-suppliers?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suppliers)) {
          offlineStorage.bulkPut('accounts', data.suppliers).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const accounts = await offlineSyncManager.searchLocalAccounts(q, limit);
    const suppliers = accounts.filter(
      (a: any) => a.account_group === 'Supplier' || a.account_group === 'Customer & Supplier'
    );
    return { success: true, suppliers, data: suppliers, offline: true };
  },

  /**
   * Purchase Module - List Purchase Invoices
   */
  async getPurchases(params?: {
    q?: string;
    supplierId?: string;
    filerStatus?: string;
    paymentMode?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);
    if (params?.paymentMode) query.append('paymentMode', params.paymentMode);
    if (params?.status) query.append('status', params.status);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);

    try {
      const res = await authFetch(`/api/purchases?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          return data;
        }
      }
    } catch {
      // Offline fallback from IndexedDB
    }
    const localPurchases = await offlineStorage.getAll<any>('purchases');
    return {
      success: true,
      purchases: localPurchases,
      data: localPurchases,
      summary: {
        totalPurchases: localPurchases.length,
        totalGrossAmount: 0,
        totalDiscount: 0,
        totalTaxableAmount: 0,
        totalAdvanceTax: 0,
        totalGstAmount: 0,
        totalPayableAmount: 0,
        totalPaidAmount: 0,
        totalBalanceDue: 0,
      },
      offline: true,
    };
  },

  /**
   * Purchase Module - Get Single Purchase Invoice with Items & Journal Lines
   */
  async getPurchaseDetails(id: number | string) {
    try {
      const res = await authFetch(`/api/purchases/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`purchase_details_${id}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`purchase_details_${id}`);
    if (cached) return { ...cached, offline: true };
    const allPurchases = await offlineStorage.getAll<any>('purchases');
    const found = allPurchases.find(
      (p) => String(p.id) === String(id) || String(p.client_tx_id) === String(id)
    );
    if (found) {
      return {
        success: true,
        offline: true,
        purchase: found,
        items: found.items || [],
        journalLines: [],
      };
    }
    throw new Error('Purchase invoice details not found in local storage');
  },

  /**
   * Purchase Module - Create Confirmed or Held/Draft Purchase Invoice (with offline fallback)
   */
  async createPurchase(payload: any) {
    try {
      const res = await authFetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
      // Offline fallback: save locally to IndexedDB & queue for automatic background sync
    }

    const offlineRes = await offlineSyncManager.queueOfflinePurchase(payload);
    return {
      ...offlineRes,
      success: true,
      offline: true,
      message:
        'Purchase invoice saved offline in local database. Will automatically synchronize when online.',
      purchase: {
        id: offlineRes.client_tx_id,
        invoice_number: offlineRes.invoice_number,
        ...payload,
      },
      data: {
        id: offlineRes.client_tx_id,
        invoice_number: offlineRes.invoice_number,
        ...payload,
      },
    };
  },

  /**
   * Purchase Module - Update Purchase Invoice (with Double-Entry Reversal & offline fallback)
   */
  async updatePurchase(id: number | string, payload: any) {
    try {
      const res = await authFetch(`/api/purchases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }

    const client_tx_id = `TX-UPD-PUR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const allPurchases = await offlineStorage.getAll<any>('purchases');
    const existing = allPurchases.find(
      (p) => String(p.id) === String(id) || String(p.client_tx_id) === String(id)
    );
    const updatedRecord = {
      ...(existing || {}),
      ...payload,
      id,
      client_tx_id: existing?.client_tx_id || String(id),
      sync_status: 'pending_sync',
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('purchases', updatedRecord);
    await offlineStorage.enqueueSync({
      client_tx_id,
      device_id: 'POS-LOCAL',
      action: 'UPDATE_PURCHASE',
      entity: 'purchases',
      local_id: String(id),
      payload: { ...payload, id },
      created_at: new Date().toISOString(),
    });
    return {
      success: true,
      offline: true,
      purchase: updatedRecord,
      data: updatedRecord,
      message: 'Purchase invoice updated locally (Offline Mode). Will synchronize when online.',
    };
  },

  /**
   * Purchase Module - Cancel Purchase Invoice (with Double-Entry Reversal)
   */
  async cancelPurchase(id: number, reason: string) {
    const res = await authFetch(`/api/purchases/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to cancel purchase invoice');
    }
    return data;
  },

  /**
   * Purchase Module - Discard Held Draft or Delete Purchase Invoice
   */
  async deletePurchase(id: number, reason?: string) {
    const res = await authFetch(`/api/purchases/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete purchase invoice');
    }
    return data;
  },

  /**
   * Purchase Returns - List & Get & Create
   */
  async getPurchaseReturns(params?: {
    q?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.status) query.append('status', params.status);

    try {
      const res = await authFetch(`/api/purchases/returns/list?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('purchase_returns_list', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('purchase_returns_list');
    if (cached) return { ...cached, offline: true };
    return { success: true, offline: true, returns: [], data: [] };
  },

  async getPurchaseReturnDetails(id: number) {
    try {
      const res = await authFetch(`/api/purchases/returns/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`purchase_return_${id}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`purchase_return_${id}`);
    if (cached) return { ...cached, offline: true };
    throw new Error('Purchase return details not found in offline cache');
  },

  async createPurchaseReturn(payload: any) {
    const res = await authFetch('/api/purchases/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create purchase return');
    }
    return data;
  },

  /**
   * Batch-wise Inventory Stock
   */
  async getInventoryBatches(params?: {
    itemId?: number;
    q?: string;
    status?: string;
    inStockOnly?: boolean;
  }) {
    const query = new URLSearchParams();
    if (params?.itemId) query.append('itemId', String(params.itemId));
    if (params?.q) query.append('q', params.q);
    if (params?.status) query.append('status', params.status);
    if (params?.inStockOnly) query.append('inStockOnly', 'true');

    try {
      const res = await authFetch(`/api/purchases/batches?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.batches)) {
          offlineStorage.bulkPut('inventory', data.batches).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const allBatches = await offlineStorage.getAll<any>('inventory');
    const filtered = params?.itemId
      ? allBatches.filter((b) => Number(b.item_id) === Number(params.itemId))
      : allBatches;
    return { success: true, batches: filtered, data: filtered, offline: true };
  },

  /**
   * 8 Purchase & Tax Reports
   */
  async getPurchaseReport(
    reportType: string,
    params?: {
      startDate?: string;
      endDate?: string;
      supplierId?: string;
      itemId?: string;
      filerStatus?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.itemId) query.append('itemId', params.itemId);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);

    try {
      const res = await authFetch(`/api/purchases/reports/${reportType}?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`purchase_report_${reportType}_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`purchase_report_${reportType}_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const localPurchases = await offlineStorage.getAll<any>('purchases');
    return {
      success: true,
      offline: true,
      reportType,
      rows: localPurchases,
      data: localPurchases,
      summary: {
        totalInvoices: localPurchases.length,
        totalNetAmount: localPurchases.reduce((s, p) => s + Number(p.net_amount || 0), 0),
      },
    };
  },

  /**
   * Sales & Billing Module - Next Auto Numbers (Inv-YYYY-MM-XX)
   */
  async getNextSalesNumbers(date?: string): Promise<{
    success: boolean;
    nextInvoiceNumber: string;
    nextReturnNumber: string;
    nextVoucherNumber: string;
  }> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    try {
      const res = await authFetch(`/api/sales/next-numbers${query}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) return data;
      }
    } catch {
      // Offline fallback
    }
    const d = date ? new Date(date) : new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const localSales = await offlineStorage.getAll<any>('sales');
    const nextSeq = String(localSales.length + 1).padStart(2, '0');
    return {
      success: true,
      nextInvoiceNumber: `Inv-${ym}-${nextSeq}`,
      nextReturnNumber: `SR-${ym}-01`,
      nextVoucherNumber: `PAY-${ym}-01`,
    };
  },

  /**
   * Sales & Billing Module - Ultra-Fast Item & Batch Search
   */
  async fastSearchSalesItems(q: string = '', limit: number = 30) {
    const query = new URLSearchParams();
    if (q) query.append('q', q);
    query.append('limit', String(limit));
    try {
      const res = await authFetch(`/api/sales/fast-search?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) return data;
      }
    } catch {
      // Offline fallback
    }
    const localItems = await offlineSyncManager.searchLocalItems(q, limit);
    const localBatches = await offlineStorage.getAll<any>('inventory');
    const enriched = localItems.map((item) => {
      const upp = Math.max(1, Number(item.units_per_pack) || 1);
      const itemBatches = localBatches
        .filter((b) => Number(b.item_id) === Number(item.id))
        .map((b) => {
          const bUpp = Math.max(1, Number(b.units_per_pack) || upp);
          const qtyUnits = Number(b.quantity) || 0;
          const packSale = Number(b.sale_price ?? item.sale_price ?? 0);
          const packPurchase = Number(b.purchase_price ?? item.purchase_price ?? 0);
          return {
            ...b,
            units_per_pack: bUpp,
            available_units: qtyUnits,
            available_packs: Number((qtyUnits / bUpp).toFixed(2)),
            sale_price: packSale,
            purchase_price: packPurchase,
            loose_sale_price: Number((packSale / bUpp).toFixed(2)),
            loose_purchase_price: Number((packPurchase / bUpp).toFixed(2)),
          };
        });
      const totalUnits =
        itemBatches.length > 0
          ? itemBatches.reduce((sum, b) => sum + (Number(b.available_units) || 0), 0)
          : (Number(item.current_stock) || 0) * upp;
      const salePrice = Number(item.sale_price) || 0;
      const retailPrice = Number(item.retail_price || item.mrp || salePrice) || 0;
      const defaultBatch = itemBatches.find((b) => b.available_units > 0) || itemBatches[0] || null;
      return {
        ...item,
        units_per_pack: upp,
        loose_rate: Number((salePrice / upp).toFixed(2)),
        retail_loose_rate: Number((retailPrice / upp).toFixed(2)),
        total_available_units: totalUnits,
        total_available_packs: Number((totalUnits / upp).toFixed(2)),
        default_batch: defaultBatch,
        batches: itemBatches,
      };
    });
    return { success: true, items: enriched, data: enriched, offline: true };
  },

  /**
   * Sales & Billing Module - Get Sales Register / Held & Draft Invoices
   */
  async getSales(params?: {
    q?: string;
    customerId?: string;
    paymentMode?: string;
    invoiceType?: string;
    status?: string;
    salesman?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
    exportAll?: boolean;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.paymentMode) query.append('paymentMode', params.paymentMode);
    if (params?.invoiceType) query.append('invoiceType', params.invoiceType);
    if (params?.status) query.append('status', params.status);
    if (params?.salesman) query.append('salesman', params.salesman);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.page) query.append('page', String(params.page));
    if (params?.pageSize) query.append('pageSize', String(params.pageSize));
    if (params?.exportAll) query.append('exportAll', 'true');

    try {
      const res = await authFetch(`/api/sales?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) return data;
      }
    } catch {
      // Offline fallback
    }
    let localSales = await offlineStorage.getAll<any>('sales');
    if (params?.status && params.status !== 'all') {
      localSales = localSales.filter(
        (s) => String(s.status || '').toLowerCase() === params.status!.toLowerCase()
      );
    }
    if (params?.q) {
      const qLower = params.q.toLowerCase();
      localSales = localSales.filter(
        (s) =>
          (s.invoice_number || '').toLowerCase().includes(qLower) ||
          (s.customer_name || '').toLowerCase().includes(qLower)
      );
    }
    return {
      success: true,
      sales: localSales,
      data: localSales,
      summary: {
        totalInvoices: localSales.length,
        totalGrossAmount: localSales.reduce((acc, s) => acc + (Number(s.subtotal_gross) || 0), 0),
        totalDiscountAmount: localSales.reduce((acc, s) => acc + (Number(s.total_discount) || 0), 0),
        totalTaxAmount: localSales.reduce((acc, s) => acc + (Number(s.total_tax) || 0), 0),
        totalNetPayable: localSales.reduce((acc, s) => acc + (Number(s.total_amount) || 0), 0),
        totalReceivedAmount: localSales.reduce((acc, s) => acc + (Number(s.received_amount) || 0), 0),
        totalBalanceDue: localSales.reduce((acc, s) => acc + (Number(s.balance_due) || 0), 0),
        totalProfitAmount: localSales.reduce((acc, s) => acc + (Number(s.invoice_profit) || 0), 0),
      },
      offline: true,
    };
  },

  /**
   * Sales & Billing Module - Get Single Sales Invoice with 14-col Items & Journal Lines
   */
  async getSaleDetails(id: number | string) {
    try {
      const res = await authFetch(`/api/sales/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`sale_details_${id}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`sale_details_${id}`);
    if (cached) return { ...cached, offline: true };
    const allSales = await offlineStorage.getAll<any>('sales');
    const found = allSales.find(
      (s) => String(s.id) === String(id) || String(s.client_tx_id) === String(id)
    );
    if (found) {
      return {
        success: true,
        offline: true,
        invoice: found,
        sale: found,
        items: found.items || [],
        journalLines: [],
      };
    }
    throw new Error('Sales invoice details not found in local storage');
  },

  /**
   * Sales & Billing Module - Create Sales Invoice (completed, held, or draft)
   */
  async createSale(payload: any) {
    try {
      const res = await authFetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
      // Offline fallback: save locally to IndexedDB & queue for automatic background sync
    }

    const offlineRes = await offlineSyncManager.queueOfflineSale(payload);
    return {
      offline: true,
      message: 'Invoice created offline in local database. Will automatically synchronize when online.',
      invoice: {
        id: offlineRes.client_tx_id,
        invoice_number: offlineRes.invoice_number,
        ...payload,
      },
      ...offlineRes,
    };
  },

  /**
   * Sales & Billing Module - Update Sales Invoice
   */
  async updateSale(id: number | string, payload: any) {
    try {
      const res = await authFetch(`/api/sales/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }

    const client_tx_id = `TX-UPD-SALE-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const allSales = await offlineStorage.getAll<any>('sales');
    const existing = allSales.find(
      (s) => String(s.id) === String(id) || String(s.client_tx_id) === String(id)
    );
    const updatedRecord = {
      ...(existing || {}),
      ...payload,
      id,
      client_tx_id: existing?.client_tx_id || String(id),
      sync_status: 'pending_sync',
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('sales', updatedRecord);
    await offlineStorage.enqueueSync({
      client_tx_id,
      device_id: 'POS-LOCAL',
      action: 'UPDATE_SALE',
      entity: 'sales',
      local_id: String(id),
      payload: { ...payload, id },
      created_at: new Date().toISOString(),
    });
    return {
      success: true,
      offline: true,
      invoice: updatedRecord,
      data: updatedRecord,
      message: 'Sales invoice updated locally (Offline Mode). Will synchronize when online.',
    };
  },

  /**
   * Sales & Billing Module - Delete Draft/Held or Cancel Completed Invoice
   */
  async deleteOrCancelSale(id: number) {
    const res = await authFetch(`/api/sales/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to discard/cancel invoice');
    }
    return data;
  },

  /**
   * Sales Return Module - List, Get & Create
   */
  async getSaleReturns(params?: {
    q?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);

    try {
      const res = await authFetch(`/api/sales/returns/list?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('sale_returns_list', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('sale_returns_list');
    if (cached) return { ...cached, offline: true };
    return { success: true, offline: true, returns: [], data: [] };
  },

  async getSaleReturnDetails(id: number) {
    try {
      const res = await authFetch(`/api/sales/returns/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`sale_return_${id}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`sale_return_${id}`);
    if (cached) return { ...cached, offline: true };
    throw new Error('Sales return details not found in offline cache');
  },

  async createSaleReturn(payload: any) {
    const res = await authFetch('/api/sales/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create sales return');
    }
    return data;
  },

  /**
   * Payments & Receipts Vouchers
   */
  async getPaymentVouchers(params?: {
    voucherType?: string;
    partyId?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.voucherType) query.append('voucherType', params.voucherType);
    if (params?.partyId) query.append('partyId', params.partyId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/sales/payments?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('payment_vouchers_list', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('payment_vouchers_list');
    if (cached) return { ...cached, offline: true };
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    return { success: true, offline: true, vouchers: localVouchers, data: localVouchers };
  },

  async createPaymentVoucher(payload: any) {
    try {
      const res = await authFetch('/api/sales/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback
    }
    const offlineVoucher = await offlineSyncManager.queueOfflineCashBookVoucher({
      voucher_date: payload.voucher_date || new Date().toISOString().split('T')[0],
      transaction_type: payload.voucher_type === 'Payment' ? 'Payment' : 'Receipt',
      transaction_category: payload.voucher_type === 'Payment' ? 'Supplier Payment' : 'Customer Receipt',
      head_account_id: payload.party_account_id || payload.account_id,
      cash_bank_account_id: payload.payment_account_id || 1,
      receipt_amount: payload.voucher_type === 'Receipt' ? Number(payload.amount || 0) : 0,
      payment_amount: payload.voucher_type === 'Payment' ? Number(payload.amount || 0) : 0,
      narration: payload.narration || payload.notes || 'Offline Payment/Receipt Voucher',
    });
    return {
      success: true,
      offline: true,
      voucher: offlineVoucher.voucher,
      message: 'Payment voucher saved locally (Offline Mode). Will synchronize when online.',
    };
  },

  /**
   * Accounts Ledgers & Account Statements
   */
  async getAccountLedger(params: {
    ledgerType: string;
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    query.append('ledgerType', params.ledgerType);
    if (params.accountId) query.append('accountId', String(params.accountId));
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);

    try {
      const res = await authFetch(`/api/sales/ledgers?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`account_ledger_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`account_ledger_${query.toString()}`,);
    if (cached) return { ...cached, offline: true };
    const localAccs = await offlineStorage.getAll<any>('accounts');
    return {
      success: true,
      offline: true,
      accounts: localAccs,
      entries: [],
      summary: { openingBalance: 0, totalDebit: 0, totalCredit: 0, closingBalance: 0 },
    };
  },

  /**
   * Sales & Tax Reports
   */
  async getSalesReport(
    reportType: string,
    params?: {
      periodPreset?: string;
      ranking?: string;
      startDate?: string;
      endDate?: string;
      customerId?: string;
      supplierId?: string;
      partyIds?: number[];
      itemId?: string;
      companies?: string[];
      itemIds?: number[];
      itemGroup?: string;
      salesmanId?: string;
      townName?: string;
      areaName?: string;
      year1?: string;
      year2?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.periodPreset) query.append('periodPreset', params.periodPreset);
    if (params?.ranking) query.append('ranking', params.ranking);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.partyIds && params.partyIds.length > 0) {
      query.append('partyIds', params.partyIds.join(','));
    }
    if (params?.itemId) query.append('itemId', params.itemId);
    if (params?.companies && params.companies.length > 0) {
      query.append('companies', params.companies.join(','));
    }
    if (params?.itemIds && params.itemIds.length > 0) {
      query.append('itemIds', params.itemIds.join(','));
    }
    if (params?.itemGroup && params.itemGroup !== 'ALL') {
      query.append('itemGroup', params.itemGroup);
    }
    if (params?.salesmanId && params.salesmanId !== 'ALL') {
      query.append('salesmanId', params.salesmanId);
    }
    if (params?.townName && params.townName !== 'ALL') {
      query.append('townName', params.townName);
    }
    if (params?.areaName && params.areaName !== 'ALL') {
      query.append('areaName', params.areaName);
    }
    if (params?.year1) query.append('year1', params.year1);
    if (params?.year2) query.append('year2', params.year2);

    try {
      const res = await authFetch(`/api/sales/reports/${reportType}?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`sales_report_${reportType}_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`sales_report_${reportType}_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const localSales = await offlineStorage.getAll<any>('sales');
    return {
      success: true,
      offline: true,
      reportType,
      rows: localSales,
      data: localSales,
      summary: {
        totalInvoices: localSales.length,
        totalNetAmount: localSales.reduce((s, inv) => s + Number(inv.total_amount || 0), 0),
      },
    };
  },

  /**
   * Authentication - System status & session verification (HttpOnly Cookie Session)
   */
  async getAuthStatus(): Promise<AuthStatusResponse> {
    purgeLegacyAuthStorage();
    try {
      const res = await authFetch('/api/auth/status');
      const data = await res.json();
      return data;
    } catch {
      return {
        initialized: true,
        authenticated: false,
        userCount: 1,
      };
    }
  },

  /**
   * Authentication - First-Time Owner & Super Admin Setup
   */
  async setupAdmin(data: {
    username: string;
    password: string;
    full_name: string;
    email?: string;
    phone?: string;
  }): Promise<LoginResponse> {
    purgeLegacyAuthStorage();
    const res = await authFetch('/api/auth/setup-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to complete Super Admin setup');
    }
    return result;
  },

  /**
   * Authentication - Login with HttpOnly Cookie Session & Remember Me support
   */
  async login(data: {
    username: string;
    password: string;
    remember_me?: boolean;
  }): Promise<LoginResponse> {
    purgeLegacyAuthStorage();
    const device_id = getClientDeviceId();
    const device_name = getClientDeviceName();
    const res = await authFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: data.username,
        password: data.password,
        remember_me: Boolean(data.remember_me),
        device_id,
        device_name,
      }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      const err: any = new Error(result.error || 'Invalid username/email or password');
      err.code = result.code;
      err.locked = result.locked;
      err.remainingMinutes = result.remainingMinutes;
      err.attemptsRemaining = result.attemptsRemaining;
      err.deviceApprovalRequired = Boolean(result.deviceApprovalRequired);
      err.registeredDeviceId = result.registeredDeviceId;
      err.registeredDeviceName = result.registeredDeviceName;
      err.requestedDeviceId = result.requestedDeviceId || device_id;
      err.requestedDeviceName = result.requestedDeviceName || device_name;
      throw err;
    }
    return result;
  },

  /**
   * Authentication - Voluntary Logout
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await authFetch('/api/auth/logout', { method: 'POST' });
      return await res.json();
    } catch {
      return { success: true, message: 'Logged out.' };
    } finally {
      purgeLegacyAuthStorage();
    }
  },

  /**
   * Authentication - Forgot Password Help
   */
  async forgotPassword(username: string): Promise<{ success: boolean; message: string; maskedEmail: string; code?: string; error?: string }> {
    const res = await authFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || data.error || 'Failed to request password recovery');
    }
    return data;
  },

  /**
   * Authentication - Verify Super Admin code & reset password
   */
  async resetPassword(payload: {
    username: string;
    code: string;
    new_password: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await authFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || data.error || 'Failed to reset password');
    }
    return data;
  },

  /**
   * User Management - Delete user (Super Admin only)
   */
  async deleteUser(id: number): Promise<{ success: boolean; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete user');
    }
    return data;
  },

  /**
   * User Management - Fetch permission modules metadata
   */
  async getPermissionModules(): Promise<{ success: boolean; modules: Array<{ key: string; label: string; description: string }> }> {
    const res = await authFetch('/api/auth/permissions/modules');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch permission modules');
    }
    return data;
  },

  /**
   * User Management - Get Super Admin recovery email
   */
  async getSuperAdminRecoveryEmail(): Promise<{ success: boolean; email: string }> {
    const res = await authFetch('/api/auth/recovery-email');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch recovery email');
    }
    return data;
  },

  /**
   * User Management - Update Super Admin recovery email
   */
  async updateSuperAdminRecoveryEmail(email: string): Promise<{ success: boolean; message: string; email: string }> {
    const res = await authFetch('/api/auth/recovery-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update recovery email');
    }
    return data;
  },

  /**
   * More Options - Fetch Sales Invoice headings, footer notes & 4-scope visibility
   */
  async getSalesInvoiceMoreOptions(): Promise<{ success: boolean; data: any }> {
    const res = await authFetch('/api/system/sales-invoice-more-options');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch Sales Invoice More Options');
    }
    return data;
  },

  /**
   * More Options - Save Sales Invoice headings, footer notes & 4-scope visibility (Super Admin only)
   */
  async updateSalesInvoiceMoreOptions(options: any): Promise<{ success: boolean; message: string; data: any }> {
    const res = await authFetch('/api/system/sales-invoice-more-options', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save Sales Invoice More Options');
    }
    return data;
  },

  /**
   * User Management - Fetch all staff users (Super Admin only)
   */
  async getUsers(): Promise<{ success: boolean; users: User[] }> {
    const res = await authFetch('/api/auth/users');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch users');
    }
    return data;
  },

  /**
   * Device Security - Approve a regular user's new device and unregister previous device (Super Admin only)
   */
  async approveUserDevice(
    userId: number,
    payload?: { device_id?: string; device_name?: string }
  ): Promise<{ success: boolean; message: string; user: User }> {
    const res = await authFetch(`/api/auth/users/${userId}/approve-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to approve user device');
    }
    return data;
  },

  /**
   * Device Security - Reject pending new-device request (Super Admin only)
   */
  async rejectUserDevice(
    userId: number
  ): Promise<{ success: boolean; message: string; user: User }> {
    const res = await authFetch(`/api/auth/users/${userId}/reject-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reject device request');
    }
    return data;
  },

  /**
   * Device Security - Unregister current device for a user (Super Admin only)
   */
  async unregisterUserDevice(
    userId: number
  ): Promise<{ success: boolean; message: string; user: User }> {
    const res = await authFetch(`/api/auth/users/${userId}/unregister-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to unregister device');
    }
    return data;
  },

  /**
   * User Management - Create staff user (Super Admin only)
   */
  async createUser(user: any): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create user');
    }
    return data;
  },

  /**
   * User Management - Update staff user info (Super Admin only)
   */
  async updateUser(id: number, user: any): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update user');
    }
    return data;
  },

  /**
   * User Management - Activate / Deactivate user (Super Admin only)
   */
  async updateUserStatus(id: number, status: 'Active' | 'Inactive'): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update user status');
    }
    return data;
  },

  /**
   * User Management - Reset user password (Super Admin only)
   */
  async resetUserPassword(
    id: number,
    new_password: string,
    force_password_change = false
  ): Promise<{ success: boolean; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password, force_password_change }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reset user password');
    }
    return data;
  },

  /**
   * User Management - Toggle force password change at next login (Super Admin only)
   */
  async toggleForcePasswordChange(
    id: number,
    force_password_change: boolean
  ): Promise<{ success: boolean; message: string; user?: any }> {
    const res = await authFetch(`/api/auth/users/${id}/force-password-change`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_password_change }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update forced password change setting');
    }
    return data;
  },

  /**
   * User Authentication - Change own password
   */
  async changeMyPassword(
    current_password: string,
    new_password: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await authFetch('/api/auth/change-my-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to change password');
    }
    return data;
  },

  /**
   * Security Audit Logs - View authentication and security events
   */
  async getAuditLogs(params?: {
    limit?: number;
    action?: string;
    username?: string;
  }): Promise<{ success: boolean; logs: AuditLog[] }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.action) query.append('action', params.action);
    if (params?.username) query.append('username', params.username);

    const res = await authFetch(`/api/auth/audit-logs?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch audit logs');
    }
    return data;
  },

  /**
   * Security - Get role permissions matrix
   */
  async getRolesPermissions(): Promise<{ success: boolean; permissions: any[] }> {
    const res = await authFetch('/api/auth/roles-permissions');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch permissions matrix');
    }
    return data;
  },

  /**
   * Security - Update role permissions for a module (Super Admin only)
   */
  async updateRolePermission(payload: {
    role: string;
    module_key: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_export: boolean;
  }): Promise<{ success: boolean; message: string; permissions: any[] }> {
    const res = await authFetch('/api/auth/roles-permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update role permissions');
    }
    return data;
  },

  // ==========================================
  // INVENTORY MANAGEMENT MODULE (TASK 6)
  // ==========================================

  async getInventoryOverview(): Promise<{ success: boolean; overview: InventoryOverview }> {
    try {
      const res = await authFetch('/api/inventory/overview');
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('inventory_overview', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('inventory_overview');
    if (cached) return { ...cached, offline: true };

    const items = await offlineStorage.getAll<any>('items');
    const batches = await offlineStorage.getAll<any>('inventory');
    const now = new Date().toISOString().split('T')[0];
    let totalCostVal = 0;
    let totalRetailVal = 0;
    let expiredCount = 0;
    let totalUnits = 0;
    let totalPacks = 0;
    for (const b of batches) {
      const upp = Math.max(1, Number(b.units_per_pack) || 1);
      const qty = Math.max(0, Number(b.quantity) || 0);
      const packs = qty / upp;
      totalUnits += qty;
      totalPacks += packs;
      totalCostVal += packs * (Number(b.purchase_price) || 0);
      totalRetailVal += packs * (Number(b.sale_price) || 0);
      if (b.expiry_date && b.expiry_date < now && qty > 0) expiredCount++;
    }
    const outOfStock = items.filter((i) => (Number(i.current_stock) || 0) <= 0).length;
    const lowStock = items.filter(
      (i) => (Number(i.current_stock) || 0) > 0 && (Number(i.current_stock) || 0) <= (Number(i.reorder_level) || 10)
    ).length;

    return {
      success: true,
      overview: {
        total_items: items.length,
        active_batches: batches.filter((b) => (Number(b.quantity) || 0) > 0).length,
        total_packs: Math.round(totalPacks),
        total_loose_units: totalUnits,
        cost_valuation: Math.round(totalCostVal),
        retail_valuation: Math.round(totalRetailVal),
        potential_profit: Math.round(totalRetailVal - totalCostVal),
        low_stock_count: lowStock,
        out_of_stock_count: outOfStock,
        expired_batches_count: expiredCount,
        near_expiry_30_count: 0,
        near_expiry_60_count: 0,
        near_expiry_90_count: 0,
      } as any,
    };
  },

  async getStockDatasheet(params?: {
    search?: string;
    code?: string;
    barcode?: string;
    company?: string;
    category?: string;
    batch?: string;
    expiry_status?: string;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    data: StockDatasheetItem[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    summary: {
      total_items: number;
      total_packs: number;
      total_units: number;
      total_cost_valuation: number;
      total_retail_valuation: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.code) query.append('code', params.code);
    if (params?.barcode) query.append('barcode', params.barcode);
    if (params?.company) query.append('company', params.company);
    if (params?.category) query.append('category', params.category);
    if (params?.batch) query.append('batch', params.batch);
    if (params?.expiry_status) query.append('expiry_status', params.expiry_status);
    if (params?.sort_by) query.append('sort_by', params.sort_by);
    if (params?.sort_order) query.append('sort_order', params.sort_order);
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));

    try {
      const res = await authFetch(`/api/inventory/datasheet?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`stock_datasheet_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`stock_datasheet_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const items = await offlineStorage.getAll<any>('items');
    const batches = await offlineStorage.getAll<any>('inventory');
    const rows: StockDatasheetItem[] = batches.map((b) => {
      const it = items.find((i) => Number(i.id) === Number(b.item_id)) || {};
      const upp = Math.max(1, Number(b.units_per_pack || it.units_per_pack || 1));
      const qtyUnits = Number(b.quantity) || 0;
      const packs = Math.floor(qtyUnits / upp);
      const loose = qtyUnits % upp;
      const pRate = Number(b.purchase_price || it.purchase_price || 0);
      const sRate = Number(b.sale_price || it.sale_price || 0);
      return {
        inventory_id: b.id,
        item_id: b.item_id,
        item_code: it.item_code || '',
        barcode: it.barcode || '',
        item_name: it.item_name || b.item_name || 'Item',
        generic_name: it.generic_name || '',
        company_name: it.company_name || b.company_name || '',
        category: it.category || '',
        pack_size: it.pack_size || `${upp}'s`,
        units_per_pack: upp,
        batch_number: b.batch_number || 'DEFAULT',
        expiry_date: b.expiry_date || '2027-12-31',
        quantity_packs: packs,
        quantity_loose: loose,
        total_units: qtyUnits,
        purchase_price: pRate,
        sale_price: sRate,
        mrp: Number(b.mrp || it.mrp || sRate),
        cost_valuation: Number(((qtyUnits / upp) * pRate).toFixed(2)),
        retail_valuation: Number(((qtyUnits / upp) * sRate).toFixed(2)),
        rack_location: b.rack_no || it.rack_location || '',
        expiry_status: 'SAFE',
        days_to_expiry: 365,
      } as any;
    });

    return {
      success: true,
      data: rows,
      pagination: {
        total: rows.length,
        page: 1,
        limit: rows.length || 50,
        totalPages: 1,
      },
      summary: {
        total_items: items.length,
        total_packs: rows.reduce((s, r: any) => s + (Number(r.quantity_packs) || 0), 0),
        total_units: rows.reduce((s, r: any) => s + (Number(r.total_units) || 0), 0),
        total_cost_valuation: rows.reduce((s, r: any) => s + (Number(r.cost_valuation) || 0), 0),
        total_retail_valuation: rows.reduce((s, r: any) => s + (Number(r.retail_valuation) || 0), 0),
      },
    };
  },

  async getCurrentStock(params?: {
    search?: string;
    company?: string;
    category?: string;
    status?: string;
  }): Promise<{ success: boolean; data: CurrentStockSummary[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.company) query.append('company', params.company);
    if (params?.category) query.append('category', params.category);
    if (params?.status) query.append('status', params.status);

    try {
      const res = await authFetch(`/api/inventory/current-stock?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`current_stock_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`current_stock_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const items = await offlineStorage.getAll<any>('items');
    const data: CurrentStockSummary[] = items.map((it) => {
      const upp = Math.max(1, Number(it.units_per_pack) || 1);
      const packs = Number(it.current_stock) || 0;
      const pRate = Number(it.purchase_price) || 0;
      const sRate = Number(it.sale_price) || 0;
      return {
        item_id: it.id,
        item_code: it.item_code || '',
        item_name: it.item_name || '',
        generic_name: it.generic_name || '',
        company_name: it.company_name || '',
        category: it.category || '',
        pack_size: it.pack_size || `${upp}'s`,
        units_per_pack: upp,
        total_packs: packs,
        total_loose_units: packs * upp,
        active_batches_count: 1,
        avg_purchase_price: pRate,
        sale_price: sRate,
        cost_valuation: Number((packs * pRate).toFixed(2)),
        retail_valuation: Number((packs * sRate).toFixed(2)),
        reorder_level: Number(it.reorder_level) || 10,
        stock_status: packs <= 0 ? 'OUT_OF_STOCK' : packs <= (Number(it.reorder_level) || 10) ? 'LOW_STOCK' : 'IN_STOCK',
      } as any;
    });
    return { success: true, data, count: data.length };
  },

  async getExpiryAlerts(params?: {
    filter?: 'ALL' | 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS';
    days?: number;
  }): Promise<{
    success: boolean;
    data: ExpiryAlertItem[];
    summary: {
      expired: number;
      days_30: number;
      days_60: number;
      days_90: number;
      total_cost_at_risk: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.filter) query.append('filter', params.filter);
    if (params?.days) query.append('days', String(params.days));

    try {
      const res = await authFetch(`/api/inventory/expiry-alerts?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`expiry_alerts_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`expiry_alerts_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    return {
      success: true,
      data: [],
      summary: { expired: 0, days_30: 0, days_60: 0, days_90: 0, total_cost_at_risk: 0 },
    };
  },

  async getLowStock(params?: {
    search?: string;
    company?: string;
  }): Promise<{
    success: boolean;
    data: LowStockItem[];
    summary: {
      out_of_stock_count: number;
      low_stock_count: number;
      total_reorder_cost_estimate: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.company) query.append('company', params.company);

    try {
      const res = await authFetch(`/api/inventory/low-stock?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`low_stock_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`low_stock_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const items = await offlineStorage.getAll<any>('items');
    const lowItems = items.filter((i) => (Number(i.current_stock) || 0) <= (Number(i.reorder_level) || 10));
    return {
      success: true,
      data: lowItems as any,
      summary: {
        out_of_stock_count: lowItems.filter((i) => (Number(i.current_stock) || 0) <= 0).length,
        low_stock_count: lowItems.filter((i) => (Number(i.current_stock) || 0) > 0).length,
        total_reorder_cost_estimate: 0,
      },
    };
  },

  async getStockAdjustments(params?: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    adjustments: StockAdjustment[];
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.offset) query.append('offset', String(params.offset));

    try {
      const res = await authFetch(`/api/inventory/adjustments?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('stock_adjustments', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('stock_adjustments');
    if (cached) return { ...cached, offline: true };
    return { success: true, adjustments: [] };
  },

  async getStockAdjustmentById(id: number): Promise<{ success: boolean; adjustment: StockAdjustment }> {
    const res = await authFetch(`/api/inventory/adjustments/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock adjustment');
    }
    return data;
  },

  async createStockAdjustment(payload: {
    adjustment_date: string;
    reason_category: 'INCREASE' | 'DECREASE' | 'DAMAGE' | 'EXPIRED' | 'PHYSICAL_DIFFERENCE' | 'CORRECTION';
    description: string;
    reference_no?: string;
    idempotency_key?: string;
    items: Array<{
      inventory_id: number;
      direction: 'INCREASE' | 'DECREASE';
      quantity_packs: number;
      quantity_loose?: number;
      unit_cost?: number;
      reason_note?: string;
    }>;
  }): Promise<{
    success: boolean;
    adjustment_no: string;
    adjustment_id: number;
    journal_voucher_id: number | null;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create stock adjustment');
    }
    return data;
  },

  async getStockTransfers(params?: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    transfers: StockTransfer[];
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.offset) query.append('offset', String(params.offset));

    try {
      const res = await authFetch(`/api/inventory/transfers?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('stock_transfers', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('stock_transfers');
    if (cached) return { ...cached, offline: true };
    return { success: true, transfers: [] };
  },

  async createStockTransfer(payload: {
    transfer_date: string;
    from_location: string;
    to_location: string;
    reference_no?: string;
    remarks?: string;
    idempotency_key?: string;
    items: Array<{
      inventory_id: number;
      quantity_packs: number;
      quantity_loose?: number;
      from_rack?: string;
      to_rack?: string;
    }>;
  }): Promise<{
    success: boolean;
    transfer_no: string;
    transfer_id: number;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create stock transfer');
    }
    return data;
  },

  async getStockLedger(params: {
    item_id?: number;
    batch_number?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<{
    success: boolean;
    ledger: StockLedgerEntry[];
    summary: {
      total_in_packs: number;
      total_out_packs: number;
      net_change_packs: number;
      closing_pack_balance: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params.item_id) query.append('item_id', String(params.item_id));
    if (params.batch_number) query.append('batch_number', params.batch_number);
    if (params.from_date) query.append('from_date', params.from_date);
    if (params.to_date) query.append('to_date', params.to_date);

    try {
      const res = await authFetch(`/api/inventory/stock-ledger?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`stock_ledger_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`stock_ledger_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const sales = await offlineStorage.getAll<any>('sales');
    const purchases = await offlineStorage.getAll<any>('purchases');
    const ledger: StockLedgerEntry[] = [];
    let totalIn = 0;
    let totalOut = 0;

    for (const p of purchases) {
      if (p.status === 'cancelled' || p.status === 'draft') continue;
      for (const line of p.items || []) {
        if (params.item_id && Number(line.item_id) !== Number(params.item_id)) continue;
        const packs = Number(line.quantity || line.pack_qty || 0) + Number(line.bonus_quantity || line.bonus_qty || 0);
        totalIn += packs;
        ledger.push({
          id: Number(p.id) || Date.now(),
          movement_date: p.invoice_date || p.created_at || new Date().toISOString().split('T')[0],
          movement_type: 'PURCHASE',
          reference_no: p.invoice_number || 'PUR',
          item_id: Number(line.item_id),
          item_name: line.item_name || 'Item',
          batch_number: line.batch_number || 'DEFAULT',
          qty_in_packs: packs,
          qty_out_packs: 0,
          balance_packs: totalIn - totalOut,
          unit_rate: Number(line.purchase_price || 0),
          party_name: p.supplier_name || 'Supplier',
          remarks: 'Purchase Invoice',
        } as any);
      }
    }

    for (const s of sales) {
      if (s.status === 'cancelled' || s.status === 'draft' || s.status === 'held') continue;
      for (const line of s.items || []) {
        if (params.item_id && Number(line.item_id) !== Number(params.item_id)) continue;
        const packs = Number(line.pack_qty || line.quantity || 0) + Number(line.bonus_qty || 0);
        totalOut += packs;
        ledger.push({
          id: Number(s.id) || Date.now(),
          movement_date: s.sale_date || s.created_at || new Date().toISOString().split('T')[0],
          movement_type: 'SALE',
          reference_no: s.invoice_number || 'INV',
          item_id: Number(line.item_id),
          item_name: line.item_name || 'Item',
          batch_number: line.batch_number || 'DEFAULT',
          qty_in_packs: 0,
          qty_out_packs: packs,
          balance_packs: totalIn - totalOut,
          unit_rate: Number(line.sale_price || 0),
          party_name: s.customer_name || 'Customer',
          remarks: 'Sales Invoice',
        } as any);
      }
    }

    return {
      success: true,
      ledger,
      summary: {
        total_in_packs: totalIn,
        total_out_packs: totalOut,
        net_change_packs: totalIn - totalOut,
        closing_pack_balance: totalIn - totalOut,
      },
    };
  },

  async getPhysicalVerifications(): Promise<{
    success: boolean;
    verifications: PhysicalVerification[];
  }> {
    try {
      const res = await authFetch('/api/inventory/physical-verifications');
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return { success: true, verifications: [] };
  },

  async getPhysicalVerificationById(id: number): Promise<{
    success: boolean;
    verification: PhysicalVerification;
  }> {
    const res = await authFetch(`/api/inventory/physical-verifications/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch physical verification audit');
    }
    return data;
  },

  async createPhysicalVerification(payload: {
    verification_date: string;
    remarks?: string;
    idempotency_key?: string;
    items: Array<{
      inventory_id: number;
      physical_pack_qty: number;
      physical_loose_qty?: number;
      reason_note?: string;
    }>;
  }): Promise<{
    success: boolean;
    verification_no: string;
    verification_id: number;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/physical-verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create physical verification');
    }
    return data;
  },

  async reconcilePhysicalVerification(
    id: number,
    payload?: { reason_category?: string; remarks?: string }
  ): Promise<{
    success: boolean;
    adjustment_no: string;
    adjustment_id: number;
    message: string;
  }> {
    const res = await authFetch(`/api/inventory/physical-verifications/${id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reconcile physical verification');
    }
    return data;
  },

  async getInventorySettings(): Promise<{ success: boolean; near_expiry_days: number }> {
    try {
      const res = await authFetch('/api/inventory/settings');
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return { success: true, near_expiry_days: 90 };
  },

  async updateInventorySettings(near_expiry_days: number): Promise<{ success: boolean; near_expiry_days: number }> {
    const res = await authFetch('/api/inventory/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ near_expiry_days }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update inventory settings');
    }
    return data;
  },

  async getInventoryCompaniesItemsMeta(): Promise<import('../types/inventory').CompanyItemMetaResponse> {
    const res = await authFetch('/api/inventory/companies-items-meta');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load company & item metadata');
    }
    return data;
  },

  async getItemStockReport(params?: {
    fromDate?: string;
    toDate?: string;
    companies?: string[];
    itemIds?: number[];
    itemGroup?: string;
    search?: string;
  }): Promise<{
    success: boolean;
    count: number;
    data: import('../types/inventory').ItemStockReportRow[];
    totals: Record<string, number>;
  }> {
    const query = new URLSearchParams();
    if (params?.fromDate) query.append('fromDate', params.fromDate);
    if (params?.toDate) query.append('toDate', params.toDate);
    if (params?.companies && params.companies.length > 0) query.append('companies', params.companies.join(','));
    if (params?.itemIds && params.itemIds.length > 0) query.append('itemIds', params.itemIds.join(','));
    if (params?.itemGroup && params.itemGroup !== 'ALL') query.append('itemGroup', params.itemGroup);
    if (params?.search) query.append('search', params.search);

    const res = await authFetch(`/api/inventory/item-stock-report?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load item stock report');
    }
    return data;
  },

  async getCompanyStockStatement(params?: {
    fromDate?: string;
    toDate?: string;
    companies?: string[];
    itemIds?: number[];
    itemGroup?: string;
  }): Promise<import('../types/inventory').StockStatementResponse> {
    const query = new URLSearchParams();
    if (params?.fromDate) query.append('fromDate', params.fromDate);
    if (params?.toDate) query.append('toDate', params.toDate);
    if (params?.companies && params.companies.length > 0) query.append('companies', params.companies.join(','));
    if (params?.itemIds && params.itemIds.length > 0) query.append('itemIds', params.itemIds.join(','));
    if (params?.itemGroup && params.itemGroup !== 'ALL') query.append('itemGroup', params.itemGroup);

    const res = await authFetch(`/api/inventory/stock-statement?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load company stock statement');
    }
    return data;
  },

  async getDetailedItemStockReport(params?: {
    fromDate?: string;
    toDate?: string;
    companies?: string[];
    itemIds?: number[];
    itemGroup?: string;
    search?: string;
  }): Promise<{
    success: boolean;
    count: number;
    data: import('../types/inventory').DetailedItemStockRow[];
    totals: Record<string, number>;
  }> {
    const query = new URLSearchParams();
    if (params?.fromDate) query.append('fromDate', params.fromDate);
    if (params?.toDate) query.append('toDate', params.toDate);
    if (params?.companies && params.companies.length > 0) query.append('companies', params.companies.join(','));
    if (params?.itemIds && params.itemIds.length > 0) query.append('itemIds', params.itemIds.join(','));
    if (params?.itemGroup && params.itemGroup !== 'ALL') query.append('itemGroup', params.itemGroup);
    if (params?.search) query.append('search', params.search);

    const res = await authFetch(`/api/inventory/detailed-stock-report?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load detailed item stock report');
    }
    return data;
  },

  // ==========================================
  // COMPLETE ACCOUNTING & LEDGER SYSTEM (TASK 7)
  // ==========================================

  async getHierarchicalCOA(params?: { q?: string; pillar?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.pillar) query.append('pillar', params.pillar);
    if (params?.status) query.append('status', params.status);

    const res = await authFetch(`/api/accounting/coa?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load Chart of Accounts');
    }
    return data;
  },

  async createCOAAccount(payload: any) {
    const res = await authFetch('/api/accounting/coa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create account');
    }
    return data;
  },

  async getNextAccountingVoucherNumber(type: string = 'JV') {
    const res = await authFetch(`/api/accounting/vouchers/next-number?type=${encodeURIComponent(type)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to get next voucher number');
    }
    return data;
  },

  async getAccountingVouchers(params?: {
    voucherType?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
    accountId?: string | number;
  }) {
    const query = new URLSearchParams();
    if (params?.voucherType) query.append('voucherType', params.voucherType);
    if (params?.status) query.append('status', params.status);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);
    if (params?.accountId) query.append('accountId', String(params.accountId));

    const res = await authFetch(`/api/accounting/vouchers?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load vouchers');
    }
    return data;
  },

  async createAccountingVoucher(payload: any) {
    const res = await authFetch('/api/accounting/vouchers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save voucher');
    }
    return data;
  },

  async updateAccountingVoucher(id: number, payload: any) {
    const res = await authFetch(`/api/accounting/vouchers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update voucher');
    }
    return data;
  },

  async postAccountingVoucher(id: number) {
    const res = await authFetch(`/api/accounting/vouchers/${id}/post`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to post voucher');
    }
    return data;
  },

  async reverseAccountingVoucher(id: number, reason: string = 'Authorized Accounting Reversal') {
    const res = await authFetch(`/api/accounting/vouchers/${id}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reverse voucher');
    }
    return data;
  },

  async getCustomerLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/accounting/ledgers/customer?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`customer_ledger_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`customer_ledger_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const localAccs = await offlineStorage.getAll<any>('accounts');
    const customerAccs = localAccs.filter((a) =>
      ['Customer', 'Customers'].includes(a.account_group) || ['Customer', 'Customers'].includes(a.account_type)
    );
    const localSales = await offlineStorage.getAll<any>('sales');
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    const entries: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const s of localSales) {
      if (params?.accountId && String(s.customer_account_id) !== String(params.accountId)) continue;
      const amt = Number(s.total_amount) || 0;
      const rcv = Number(s.received_amount) || 0;
      totalDebit += amt;
      totalCredit += rcv;
      entries.push({
        id: s.id || s.client_tx_id,
        entry_date: s.sale_date || (s.created_at || '').split('T')[0],
        voucher_number: s.invoice_number,
        voucher_type: 'Sales Invoice',
        narration: `Sales Invoice ${s.invoice_number}`,
        debit: amt,
        credit: rcv,
        running_balance: totalDebit - totalCredit,
      });
    }

    for (const v of localVouchers) {
      if (v.status === 'Cancelled') continue;
      if (params?.accountId && String(v.head_account_id) !== String(params.accountId)) continue;
      const dr = Number(v.payment_amount) || 0;
      const cr = Number(v.receipt_amount) || 0;
      totalDebit += dr;
      totalCredit += cr;
      entries.push({
        id: v.id || v.client_tx_id,
        entry_date: v.voucher_date,
        voucher_number: v.voucher_number,
        voucher_type: v.transaction_type,
        narration: v.narration || v.transaction_category,
        debit: dr,
        credit: cr,
        running_balance: totalDebit - totalCredit,
      });
    }

    return {
      success: true,
      offline: true,
      accounts: customerAccs,
      entries,
      summary: {
        openingBalance: 0,
        totalDebit,
        totalCredit,
        closingBalance: totalDebit - totalCredit,
      },
    };
  },

  async getSupplierLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/accounting/ledgers/supplier?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`supplier_ledger_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`supplier_ledger_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const localAccs = await offlineStorage.getAll<any>('accounts');
    const supplierAccs = localAccs.filter((a) =>
      ['Supplier', 'Suppliers'].includes(a.account_group) || ['Supplier', 'Suppliers'].includes(a.account_type)
    );
    const localPurchases = await offlineStorage.getAll<any>('purchases');
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    const entries: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const p of localPurchases) {
      if (params?.accountId && String(p.supplier_account_id) !== String(params.accountId)) continue;
      const amt = Number(p.net_amount || p.total_amount) || 0;
      const paid = Number(p.paid_amount) || 0;
      totalCredit += amt;
      totalDebit += paid;
      entries.push({
        id: p.id || p.client_tx_id,
        entry_date: p.invoice_date || (p.created_at || '').split('T')[0],
        voucher_number: p.invoice_number,
        voucher_type: 'Purchase Invoice',
        narration: `Purchase Invoice ${p.invoice_number}`,
        debit: paid,
        credit: amt,
        running_balance: totalCredit - totalDebit,
      });
    }

    for (const v of localVouchers) {
      if (v.status === 'Cancelled') continue;
      if (params?.accountId && String(v.head_account_id) !== String(params.accountId)) continue;
      const dr = Number(v.payment_amount) || 0;
      const cr = Number(v.receipt_amount) || 0;
      totalDebit += dr;
      totalCredit += cr;
      entries.push({
        id: v.id || v.client_tx_id,
        entry_date: v.voucher_date,
        voucher_number: v.voucher_number,
        voucher_type: v.transaction_type,
        narration: v.narration || v.transaction_category,
        debit: dr,
        credit: cr,
        running_balance: totalCredit - totalDebit,
      });
    }

    return {
      success: true,
      offline: true,
      accounts: supplierAccs,
      entries,
      summary: {
        openingBalance: 0,
        totalDebit,
        totalCredit,
        closingBalance: totalCredit - totalDebit,
      },
    };
  },

  async getGeneralLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/accounting/ledgers/general?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`general_ledger_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`general_ledger_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const localAccs = await offlineStorage.getAll<any>('accounts');
    return {
      success: true,
      offline: true,
      accounts: localAccs,
      entries: [],
      summary: { openingBalance: 0, totalDebit: 0, totalCredit: 0, closingBalance: 0 },
    };
  },

  async getCashBook(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/accounting/ledgers/cash-book?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    const localAccs = await offlineStorage.getAll<any>('accounts');
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    return {
      success: true,
      offline: true,
      accounts: localAccs.filter((a) => a.account_group === 'Cash in Hand' || a.account_type === 'Cash'),
      entries: localVouchers,
      summary: {
        openingBalance: 0,
        totalReceipts: localVouchers.reduce((s, v) => s + (Number(v.receipt_amount) || 0), 0),
        totalPayments: localVouchers.reduce((s, v) => s + (Number(v.payment_amount) || 0), 0),
        closingBalance: 0,
      },
    };
  },

  async getBankBook(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    try {
      const res = await authFetch(`/api/accounting/ledgers/bank-book?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    const localAccs = await offlineStorage.getAll<any>('accounts');
    return {
      success: true,
      offline: true,
      accounts: localAccs.filter((a) => a.account_group === 'Bank Accounts' || a.account_type === 'Bank'),
      entries: [],
      summary: { openingBalance: 0, totalDeposits: 0, totalWithdrawals: 0, closingBalance: 0 },
    };
  },

  async getAdvanceTaxAccounting(params?: {
    startDate?: string;
    endDate?: string;
    filerStatus?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/advance-tax?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load advance tax accounting');
    }
    return data;
  },

  async getFinancialReport(
    reportType: string,
    params?: {
      startDate?: string;
      endDate?: string;
      accountId?: string | number;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.accountId) query.append('accountId', String(params.accountId));

    try {
      const res = await authFetch(`/api/accounting/reports/${reportType}?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return {
      success: true,
      offline: true,
      rows: [],
      summary: {},
    };
  },

  /**
   * Customer-Wise Item Sale History & Item Purchase History
   */
  async getItemCustomerHistory(itemId: number, customerId?: number | null) {
    const query = new URLSearchParams();
    if (customerId && customerId > 0) {
      query.append('customerId', String(customerId));
    }
    try {
      const res = await authFetch(`/api/sales/item-history/${itemId}?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return { success: true, offline: true, customerHistory: [], purchaseHistory: [] };
  },

  /**
   * Live Account Balance Summary & Last Payment Info (Customer or Supplier)
   */
  async getAccountBalanceSummary(
    accountId: number,
    params?: {
      role?: 'customer' | 'supplier';
      excludeSaleId?: number | null;
      excludePurchaseId?: number | null;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.role) query.append('role', params.role);
    if (params?.excludeSaleId) query.append('excludeSaleId', String(params.excludeSaleId));
    if (params?.excludePurchaseId) query.append('excludePurchaseId', String(params.excludePurchaseId));

    try {
      const res = await authFetch(`/api/accounts/${accountId}/balance-summary?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback from IndexedDB accounts store
    }
    const allAccs = await offlineStorage.getAll<any>('accounts');
    const localAcc = allAccs.find((a) => Number(a.id) === Number(accountId));
    const bal = Number(localAcc?.current_balance || 0);
    const bType = localAcc?.current_balance_type || 'Debit';
    return {
      success: true,
      offline: true,
      account: localAcc || { id: accountId, account_name: 'Account', account_code: '' },
      totalDebit: Number(localAcc?.total_debit || 0),
      totalCredit: Number(localAcc?.total_credit || 0),
      previousBalance: bal,
      previousBalanceAbs: Math.abs(bal),
      previousBalanceType: bType,
      signedReceivable: bType === 'Debit' ? bal : -bal,
      signedPayable: bType === 'Credit' ? bal : -bal,
      lastPayment: null,
    };
  },

  /**
   * Salesman Management & 6 Salesman Reports
   */
  async getSalesmen(params?: { status?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/salesmen?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load salesmen');
    }
    return data;
  },

  async createSalesman(payload: any) {
    const res = await authFetch('/api/staff/salesmen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create salesman');
    }
    return data;
  },

  async updateSalesman(id: number, payload: any) {
    const res = await authFetch(`/api/staff/salesmen/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update salesman');
    }
    return data;
  },

  async updateSalesmanStatus(id: number, status: 'Active' | 'Inactive') {
    const res = await authFetch(`/api/staff/salesmen/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update salesman status');
    }
    return data;
  },

  async deleteSalesman(id: number) {
    const res = await authFetch(`/api/staff/salesmen/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete salesman');
    }
    return data;
  },

  async paySalesmanCommission(id: number, payload: any) {
    const res = await authFetch(`/api/staff/salesmen/${id}/pay-commission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to record commission payment');
    }
    return data;
  },

  async getSalesmanReport(
    reportType: string,
    params?: { salesmanId?: string | number; startDate?: string; endDate?: string }
  ) {
    const query = new URLSearchParams();
    if (params?.salesmanId) query.append('salesmanId', String(params.salesmanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const res = await authFetch(`/api/staff/salesmen/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load salesman report: ${reportType}`);
    }
    return data;
  },

  /**
   * Deliveryman Management & Delivery Tracking
   */
  async getDeliverymen(params?: { status?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/deliverymen?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load deliverymen');
    }
    return data;
  },

  async createDeliveryman(payload: any) {
    const res = await authFetch('/api/staff/deliverymen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create deliveryman');
    }
    return data;
  },

  async updateDeliveryman(id: number, payload: any) {
    const res = await authFetch(`/api/staff/deliverymen/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update deliveryman');
    }
    return data;
  },

  async updateDeliverymanStatus(id: number, status: 'Active' | 'Inactive') {
    const res = await authFetch(`/api/staff/deliverymen/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update deliveryman status');
    }
    return data;
  },

  async getDeliveries(params?: {
    deliveryStatus?: string;
    deliverymanId?: string | number;
    salesmanId?: string | number;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.deliveryStatus) query.append('deliveryStatus', params.deliveryStatus);
    if (params?.deliverymanId) query.append('deliverymanId', String(params.deliverymanId));
    if (params?.salesmanId) query.append('salesmanId', String(params.salesmanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/deliveries?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load deliveries');
    }
    return data;
  },

  async updateDeliveryTracking(saleId: number, payload: any) {
    const res = await authFetch(`/api/staff/deliveries/${saleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update delivery tracking');
    }
    return data;
  },

  async getDeliveryReport(
    reportType: string,
    params?: { deliverymanId?: string | number; startDate?: string; endDate?: string }
  ) {
    const query = new URLSearchParams();
    if (params?.deliverymanId) query.append('deliverymanId', String(params.deliverymanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const res = await authFetch(`/api/staff/deliveries/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load delivery report: ${reportType}`);
    }
    return data;
  },

  /**
   * WhatsApp Integration (Phase 1 Free wa.me + PDF & Phase 2 WhatsApp Business Cloud API)
   */
  async getWhatsAppLogs(params?: { invoiceId?: number; documentNumber?: string }) {
    const query = new URLSearchParams();
    if (params?.invoiceId) query.append('invoiceId', String(params.invoiceId));
    if (params?.documentNumber) query.append('documentNumber', params.documentNumber);
    const res = await authFetch(`/api/whatsapp/logs?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load WhatsApp logs');
    }
    return data;
  },

  async saveCustomerWhatsAppPhone(accountId: number, phone: string) {
    const res = await authFetch(`/api/whatsapp/customer-phone/${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save customer phone number');
    }
    return data;
  },

  async logWhatsAppSend(payload: {
    invoiceId?: number | null;
    documentType?: string;
    documentNumber: string;
    customerAccountId?: number | null;
    customerName: string;
    number: string;
    mode?: string;
    status: 'Sent' | 'Failed';
    error?: string | null;
  }) {
    const res = await authFetch('/api/whatsapp/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to log WhatsApp send');
    }
    return data;
  },

  async sendWhatsAppCloudApi(payload: {
    invoiceId?: number | null;
    reportType: 'invoice' | 'ledger' | 'statement' | 'report';
    params: Record<string, any>;
  }) {
    const res = await authFetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'WhatsApp Cloud API send failed');
    }
    return data;
  },

  // ================= CASH BOOK & CONTINUOUS VOUCHER MODULE =================
  async getCashBookNextNumber() {
    try {
      const res = await authFetch('/api/cash-book/next-number');
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback
    }
    const existingVouchers = await offlineStorage.getAll<any>('cash_book');
    let maxNum = 0;
    for (const v of existingVouchers) {
      const m = String(v.voucher_number || '').match(/(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    const nextNum = String(maxNum + 1).padStart(3, '0');
    return {
      success: true,
      offline: true,
      nextVoucherNumber: nextNum,
      sequenceValue: maxNum + 1,
    };
  },

  async getCashBookAccounts() {
    try {
      const res = await authFetch('/api/cash-book/accounts');
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.allAccounts)) {
          offlineStorage.bulkPut('accounts', data.allAccounts).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const allAccounts = await offlineStorage.getAll<any>('accounts');
    const cashAccounts = allAccounts.filter(
      (a) =>
        a.account_group === 'Cash in Hand' ||
        a.account_type === 'Cash' ||
        (a.account_name || '').toLowerCase().includes('cash')
    );
    const bankAccounts = allAccounts.filter(
      (a) =>
        a.account_group === 'Bank Accounts' ||
        a.account_type === 'Bank' ||
        (a.account_name || '').toLowerCase().includes('bank')
    );
    const defaultCash =
      cashAccounts.find((a) => (a.account_name || '').toLowerCase() === 'cash in hand') ||
      cashAccounts[0] ||
      null;

    return {
      success: true,
      offline: true,
      allAccounts,
      cashAccounts,
      bankAccounts,
      cashAndBankAccounts: [...cashAccounts, ...bankAccounts],
      defaultCashAccountId: defaultCash ? defaultCash.id : 1,
    };
  },

  async getCashBookSummary(params?: { startDate?: string; endDate?: string }) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    try {
      const res = await authFetch(`/api/cash-book/summary?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`cash_book_summary_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`cash_book_summary_${query.toString()}`);
    if (cached) return { ...cached, offline: true };

    const allAccounts = await offlineStorage.getAll<any>('accounts');
    const allVouchers = await offlineStorage.getAll<any>('cash_book');
    const activeVouchers = allVouchers.filter((v) => v.status !== 'Cancelled');
    const cashAcc =
      allAccounts.find((a) => (a.account_name || '').toLowerCase() === 'cash in hand') ||
      allAccounts.find((a) => a.account_group === 'Cash in Hand' || a.account_type === 'Cash');
    const bankAccs = allAccounts.filter(
      (a) => a.account_group === 'Bank Accounts' || a.account_type === 'Bank'
    );

    const totalCashReceipts = activeVouchers.reduce((s, v) => s + (Number(v.receipt_amount) || 0), 0);
    const totalCashPayments = activeVouchers.reduce((s, v) => s + (Number(v.payment_amount) || 0), 0);
    const closingCashBalance = cashAcc ? Number(cashAcc.current_balance) || 0 : totalCashReceipts - totalCashPayments;
    const openingCashBalance = closingCashBalance - totalCashReceipts + totalCashPayments;
    const totalBankClosingBalance = bankAccs.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);

    return {
      success: true,
      offline: true,
      summary: {
        startDate: params?.startDate || new Date().toISOString().split('T')[0],
        endDate: params?.endDate || new Date().toISOString().split('T')[0],
        openingCashBalance,
        totalCashReceipts,
        totalCashPayments,
        closingCashBalance,
        openingBankBalance: totalBankClosingBalance,
        totalBankReceipts: 0,
        totalBankPayments: 0,
        totalBankClosingBalance,
        netCashPlusBankClosing: closingCashBalance + totalBankClosingBalance,
        bankBreakdown: bankAccs.map((b) => ({
          id: b.id,
          account_code: b.account_code,
          account_name: b.account_name,
          openingBalance: Number(b.opening_balance) || 0,
          receipts: 0,
          payments: 0,
          closingBalance: Number(b.current_balance) || 0,
        })),
        categoryTotals: {
          customerReceipts: activeVouchers
            .filter((v) => v.transaction_category === 'Customer Receipt')
            .reduce((s, v) => s + (Number(v.receipt_amount) || 0), 0),
          supplierPayments: activeVouchers
            .filter((v) => v.transaction_category === 'Supplier Payment')
            .reduce((s, v) => s + (Number(v.payment_amount) || 0), 0),
          shopExpenses: activeVouchers
            .filter((v) => v.transaction_type === 'Expense' || v.transaction_category === 'Shop Expense')
            .reduce((s, v) => s + (Number(v.payment_amount) || 0), 0),
          capitalIntroduced: activeVouchers
            .filter((v) => v.transaction_category === 'Owner Capital Introduced')
            .reduce((s, v) => s + (Number(v.receipt_amount) || 0), 0),
          ownerDrawings: activeVouchers
            .filter((v) => v.transaction_category === 'Owner Drawings')
            .reduce((s, v) => s + (Number(v.payment_amount) || 0), 0),
          contraTransfers: activeVouchers
            .filter((v) => v.transaction_type === 'Contra')
            .reduce((s, v) => s + (Number(v.receipt_amount) || Number(v.payment_amount) || 0), 0),
        },
      },
    };
  },

  async getCashBookVouchers(params?: {
    q?: string;
    startDate?: string;
    endDate?: string;
    transactionType?: string;
    category?: string;
    accountId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.transactionType && params.transactionType !== 'all') {
      query.append('transactionType', params.transactionType);
    }
    if (params?.category && params.category !== 'all') {
      query.append('category', params.category);
    }
    if (params?.accountId && params.accountId !== 'all') {
      query.append('accountId', params.accountId);
    }
    if (params?.page) query.append('page', String(params.page));
    if (params?.pageSize) query.append('pageSize', String(params.pageSize));

    try {
      const res = await authFetch(`/api/cash-book/vouchers?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.vouchers)) {
          const withTxId = data.vouchers.map((v: any) => ({
            ...v,
            client_tx_id: v.client_tx_id || `CB-${v.id}`,
          }));
          offlineStorage.bulkPut('cash_book', withTxId).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }

    let vouchers = await offlineStorage.getAll<any>('cash_book');
    if (params?.startDate) {
      vouchers = vouchers.filter((v) => (v.voucher_date || '') >= params.startDate!);
    }
    if (params?.endDate) {
      vouchers = vouchers.filter((v) => (v.voucher_date || '') <= params.endDate!);
    }
    if (params?.transactionType && params.transactionType !== 'all') {
      vouchers = vouchers.filter((v) => v.transaction_type === params.transactionType);
    }
    if (params?.category && params.category !== 'all') {
      vouchers = vouchers.filter((v) => v.transaction_category === params.category);
    }
    if (params?.accountId && params.accountId !== 'all') {
      vouchers = vouchers.filter(
        (v) =>
          String(v.head_account_id) === String(params.accountId) ||
          String(v.cash_bank_account_id) === String(params.accountId)
      );
    }
    if (params?.q) {
      const qLower = params.q.toLowerCase();
      vouchers = vouchers.filter(
        (v) =>
          (v.voucher_number || '').toLowerCase().includes(qLower) ||
          (v.head_account_name || '').toLowerCase().includes(qLower) ||
          (v.cash_bank_account_name || '').toLowerCase().includes(qLower) ||
          (v.narration || '').toLowerCase().includes(qLower)
      );
    }

    vouchers.sort((a, b) => String(b.voucher_number || '').localeCompare(String(a.voucher_number || '')));
    const totalReceipts = vouchers
      .filter((v) => v.status !== 'Cancelled')
      .reduce((s, v) => s + (Number(v.receipt_amount) || 0), 0);
    const totalPayments = vouchers
      .filter((v) => v.status !== 'Cancelled')
      .reduce((s, v) => s + (Number(v.payment_amount) || 0), 0);

    return {
      success: true,
      offline: true,
      vouchers,
      pagination: {
        total: vouchers.length,
        page: 1,
        pageSize: vouchers.length || 50,
        totalPages: 1,
      },
      totals: {
        totalReceipts,
        totalPayments,
        netMovement: totalReceipts - totalPayments,
      },
    };
  },

  async getCashBookVoucher(id: number | string) {
    try {
      const res = await authFetch(`/api/cash-book/vouchers/${id}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    const allVouchers = await offlineStorage.getAll<any>('cash_book');
    const found = allVouchers.find(
      (v) => String(v.id) === String(id) || String(v.client_tx_id) === String(id)
    );
    if (found) {
      return { success: true, offline: true, voucher: found };
    }
    throw new Error('Cash Book voucher details not found locally');
  },

  async createCashBookVoucher(payload: any) {
    try {
      const res = await authFetch('/api/cash-book/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.voucher) {
          await offlineStorage.put('cash_book', {
            ...data.voucher,
            client_tx_id: data.voucher.client_tx_id || `CB-${data.voucher.id}`,
          });
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
      // Offline fallback
    }

    const offlineRes = await offlineSyncManager.queueOfflineCashBookVoucher(payload);
    return {
      success: true,
      offline: true,
      voucher: offlineRes.voucher,
      message: `Voucher #${offlineRes.voucher_number} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
  },

  async updateCashBookVoucher(id: number | string, payload: any) {
    try {
      const res = await authFetch(`/api/cash-book/vouchers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.voucher) {
          await offlineStorage.put('cash_book', {
            ...data.voucher,
            client_tx_id: data.voucher.client_tx_id || `CB-${data.voucher.id}`,
          });
        }
        return data;
      }
      if (res.status >= 400 && res.status < 500 && data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }

    const allVouchers = await offlineStorage.getAll<any>('cash_book');
    const existing = allVouchers.find(
      (v) => String(v.id) === String(id) || String(v.client_tx_id) === String(id)
    );
    const updated = {
      ...(existing || {}),
      ...payload,
      id,
      client_tx_id: existing?.client_tx_id || `CB-${id}`,
      sync_status: 'pending_sync',
      updated_at: new Date().toISOString(),
    };
    await offlineStorage.put('cash_book', updated);
    return {
      success: true,
      offline: true,
      voucher: updated,
      message: `Voucher #${updated.voucher_number || id} updated locally (Offline Mode).`,
    };
  },

  async deleteCashBookVoucher(id: number) {
    const res = await authFetch(`/api/cash-book/vouchers/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to cancel Cash Book voucher');
    }
    return data;
  },

  async getCashBookBreakdown(params?: { startDate?: string; endDate?: string }) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    try {
      const res = await authFetch(`/api/cash-book/reports/breakdown?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`cash_book_breakdown_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`cash_book_breakdown_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const vouchers = await offlineStorage.getAll<any>('cash_book');
    return {
      success: true,
      offline: true,
      customerReceipts: vouchers.filter((v) => v.transaction_category === 'Customer Receipt'),
      supplierPayments: vouchers.filter((v) => v.transaction_category === 'Supplier Payment'),
      expensesByHead: [],
      contraEntries: vouchers.filter((v) => v.transaction_type === 'Contra'),
      dailyBook: vouchers,
    };
  },

  async getCashBookAuditHistory(params?: { voucherNumber?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.voucherNumber) query.append('voucherNumber', params.voucherNumber);
    if (params?.limit) query.append('limit', String(params.limit));
    try {
      const res = await authFetch(`/api/cash-book/audit-history?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return { success: true, offline: true, logs: [] };
  },

  // ==========================================================================
  // SUPPLY & DISTRIBUTION MANAGEMENT SYSTEM
  // ==========================================================================

  async getSupplyNextNumbers() {
    const res = await authFetch('/api/supply/next-numbers');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to fetch supply sequence numbers');
    return data;
  },

  async getSupplyDashboard(date?: string) {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await authFetch(`/api/supply/dashboard${q}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Supply Dashboard');
    return data;
  },

  async getSupplySalesmen(params?: { q?: string; status?: string }) {
    const q = new URLSearchParams();
    if (params?.q) q.set('q', params.q);
    if (params?.status) q.set('status', params.status);
    const res = await authFetch(`/api/supply/salesmen?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load salesmen');
    return data;
  },

  async saveSupplySalesman(payload: Record<string, unknown>, id?: number) {
    const res = await authFetch(id ? `/api/supply/salesmen/${id}` : '/api/supply/salesmen', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save salesman');
    return data;
  },

  async updateSupplySalesmanStatus(id: number, status: 'Active' | 'Inactive') {
    const res = await authFetch(`/api/supply/salesmen/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update salesman status');
    return data;
  },

  async deleteSupplySalesman(id: number) {
    const res = await authFetch(`/api/supply/salesmen/${id}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete salesman');
    return data;
  },

  async getSupplyTowns() {
    const res = await authFetch('/api/supply/towns');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Towns & Areas');
    return data;
  },

  async saveSupplyTown(payload: Record<string, unknown>, id?: number) {
    const res = await authFetch(id ? `/api/supply/towns/${id}` : '/api/supply/towns', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save Town');
    return data;
  },

  async createSupplyArea(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create Area');
    return data;
  },

  async assignPartyTerritory(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/assign-party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to assign Party to Town/Area');
    return data;
  },

  async getSupplyOrderFormCatalog(params?: { company?: string; q?: string }) {
    const q = new URLSearchParams();
    if (params?.company) q.set('company', params.company);
    if (params?.q) q.set('q', params.q);
    const res = await authFetch(`/api/supply/order-forms/catalog?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load company-wise item catalog');
    return data;
  },

  async getSupplyOrderForms(params?: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/order-forms?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Order Forms');
    return data;
  },

  async saveSupplyOrderForm(payload: Record<string, unknown>, id?: number) {
    const res = await authFetch(id ? `/api/supply/order-forms/${id}` : '/api/supply/order-forms', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save Order Form');
    return data;
  },

  async convertOrderFormToBooking(id: number, payload: Record<string, unknown>) {
    const res = await authFetch(`/api/supply/order-forms/${id}/convert-to-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to convert Order Form to Booking');
    return data;
  },

  async getSupplyBookings(params?: Record<string, string | number | boolean | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/bookings?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Order Bookings');
    return data;
  },

  async saveSupplyBooking(payload: Record<string, unknown>, id?: number) {
    const res = await authFetch(id ? `/api/supply/bookings/${id}` : '/api/supply/bookings', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save Order Booking');
    return data;
  },

  async getTownPendingBookings(params: { town_id?: number; town_name?: string; salesman_id?: number; area_id?: number }) {
    const q = new URLSearchParams();
    if (params.town_id) q.set('town_id', String(params.town_id));
    if (params.town_name) q.set('town_name', params.town_name);
    if (params.salesman_id) q.set('salesman_id', String(params.salesman_id));
    if (params.area_id) q.set('area_id', String(params.area_id));
    const res = await authFetch(`/api/supply/town-pending-bookings?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load pending bookings for Town');
    return data;
  },

  async getTownSupplies(params?: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/supplies?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Town Supplies');
    return data;
  },

  async createTownSupply(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/supplies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create Town Supply');
    return data;
  },

  async packTownSupply(id: number, payload: Record<string, unknown>) {
    const res = await authFetch(`/api/supply/supplies/${id}/pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update packing');
    return data;
  },

  async getSupplyDispatches(params?: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/dispatches?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Dispatches');
    return data;
  },

  async createSupplyDispatch(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/dispatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to dispatch supply');
    return data;
  },

  async updateDispatchDeliveryStatus(id: number, payload: { delivery_status: string; party_supply_id?: number }) {
    const res = await authFetch(`/api/supply/dispatches/${id}/delivery`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update delivery status');
    return data;
  },

  async getSupplyReturns(params?: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/returns?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Salesman Returns');
    return data;
  },

  async createSupplyReturn(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to record Salesman Return');
    return data;
  },

  async finalizeSupplyBilling(townSupplyId: number, payload: Record<string, unknown>) {
    const res = await authFetch(`/api/supply/supplies/${townSupplyId}/finalize-billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to finalize billing');
    return data;
  },

  async getSupplyRecoveries(params?: Record<string, string | number | boolean | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/recoveries?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Recoveries');
    return data;
  },

  async createSupplyRecovery(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/recoveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to post Recovery');
    return data;
  },

  async getSupplyRecoveryReports(params: {
    type: 'party-wise' | 'town-wise' | 'supply-wise';
    from_date?: string;
    to_date?: string;
    salesman_id?: number;
    town_id?: number;
    party_account_id?: number;
    supply_number?: string;
  }) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const res = await authFetch(`/api/supply/recovery-reports?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Recovery Report');
    return data;
  },

  async previewSalesmanSettlement(params: { salesman_id: number; from_date?: string; to_date?: string }) {
    const q = new URLSearchParams();
    q.set('salesman_id', String(params.salesman_id));
    if (params.from_date) q.set('from_date', params.from_date);
    if (params.to_date) q.set('to_date', params.to_date);
    const res = await authFetch(`/api/supply/settlements/preview?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to preview Salesman Settlement');
    return data;
  },

  async getSalesmanSettlements(salesmanId?: number) {
    const q = salesmanId ? `?salesman_id=${salesmanId}` : '';
    const res = await authFetch(`/api/supply/settlements${q}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Settlements');
    return data;
  },

  async createSalesmanSettlement(payload: Record<string, unknown>) {
    const res = await authFetch('/api/supply/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save Salesman Settlement');
    return data;
  },

  async getSupplyDistributionReport(
    category: string,
    reportKey: string,
    params?: Record<string, string | number | undefined>
  ) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    const res = await authFetch(`/api/supply/reports/${category}/${reportKey}?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load distribution report');
    return data;
  },

  // =========================================================================
  // CLOSING & FINANCIAL PERIOD MANAGEMENT MODULE
  // =========================================================================

  async getClosingOverview() {
    const res = await authFetch('/api/closing/overview');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Closing Overview');
    return data;
  },

  async previewDailyClosing(date: string) {
    const q = new URLSearchParams({ date });
    const res = await authFetch(`/api/closing/daily/preview?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to preview Daily Closing');
    return data;
  },

  async executeDailyClosing(payload: {
    date: string;
    actual_physical_cash: number;
    discrepancy_explanation?: string;
    cash_discrepancy_reason?: string;
    post_discrepancy_adjustment?: boolean;
    notes?: string;
  }) {
    const body = {
      ...payload,
      discrepancy_explanation:
        payload.discrepancy_explanation ?? payload.cash_discrepancy_reason ?? '',
    };
    const res = await authFetch('/api/closing/daily/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to execute Daily Closing');
    return data;
  },

  async previewMonthlyClosing(params: {
    month?: string;
    startDate?: string;
    endDate?: string;
    start_date?: string;
    end_date?: string;
    periodName?: string;
  }) {
    const q = new URLSearchParams();
    if (params.month) q.set('month', params.month);
    if (params.startDate || params.start_date) q.set('startDate', (params.startDate || params.start_date)!);
    if (params.endDate || params.end_date) q.set('endDate', (params.endDate || params.end_date)!);
    if (params.periodName) q.set('periodName', params.periodName);
    const res = await authFetch(`/api/closing/monthly/preview?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to preview Monthly Closing');
    return data;
  },

  async executeMonthlyClosing(payload: {
    month?: string;
    start_date?: string;
    end_date?: string;
    period_name?: string;
    costing_method?: string;
    lock_period?: boolean;
    notes?: string;
  }) {
    const res = await authFetch('/api/closing/monthly/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to execute Monthly Closing');
    return data;
  },

  async previewStockClosing(params: {
    startDate?: string;
    endDate?: string;
    start_date?: string;
    end_date?: string;
    costing_method?: string;
  }) {
    const q = new URLSearchParams();
    if (params.startDate || params.start_date) q.set('startDate', (params.startDate || params.start_date)!);
    if (params.endDate || params.end_date) q.set('endDate', (params.endDate || params.end_date)!);
    const res = await authFetch(`/api/closing/stock/preview?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to preview Stock Closing');
    return data;
  },

  async executeStockClosing(payload: {
    start_date: string;
    end_date: string;
    costing_method?: string;
    period_name?: string;
    notes?: string;
  }) {
    const res = await authFetch('/api/closing/stock/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to execute Stock Closing');
    return data;
  },

  async previewYearlyClosing(params?: {
    startDate?: string;
    endDate?: string;
    start_date?: string;
    end_date?: string;
    costing_method?: string;
    periodName?: string;
  }) {
    const q = new URLSearchParams();
    if (params?.startDate || params?.start_date) q.set('startDate', (params.startDate || params.start_date)!);
    if (params?.endDate || params?.end_date) q.set('endDate', (params.endDate || params.end_date)!);
    if (params?.periodName) q.set('periodName', params.periodName);
    const res = await authFetch(`/api/closing/yearly/preview?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to preview Yearly Closing');
    return data;
  },

  async executeYearlyClosing(payload: {
    start_date: string;
    end_date: string;
    costing_method?: string;
    period_name?: string;
    lock_period?: boolean;
    advance_financial_year?: boolean;
    advance_financial_year_dates?: boolean;
    notes?: string;
  }) {
    const body = {
      ...payload,
      advance_financial_year_dates:
        payload.advance_financial_year_dates ?? payload.advance_financial_year ?? true,
    };
    const res = await authFetch('/api/closing/yearly/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to execute Yearly Closing');
    return data;
  },

  async updateFinancialYearConfig(payload: {
    current_financial_year_start?: string;
    current_financial_year_end?: string;
    start_date?: string;
    end_date?: string;
    costing_method?: string;
  }) {
    const body = {
      current_financial_year_start:
        payload.current_financial_year_start || payload.start_date || '2025-07-01',
      current_financial_year_end:
        payload.current_financial_year_end || payload.end_date || '2026-06-30',
      costing_method: payload.costing_method || 'Weighted Average / FIFO',
    };
    const res = await authFetch('/api/closing/financial-year-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update Financial Year configuration');
    return data;
  },

  async getClosingHistory(params?: {
    closingType?: string;
    closing_type?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    start_date?: string;
    end_date?: string;
    q?: string;
    search?: string;
  }) {
    const q = new URLSearchParams();
    if (params?.closingType || params?.closing_type) {
      q.set('closingType', (params.closingType || params.closing_type)!);
    }
    if (params?.status) q.set('status', params.status);
    if (params?.startDate || params?.start_date) {
      q.set('startDate', (params.startDate || params.start_date)!);
    }
    if (params?.endDate || params?.end_date) {
      q.set('endDate', (params.endDate || params.end_date)!);
    }
    if (params?.q || params?.search) {
      q.set('q', (params.q || params.search)!);
    }
    const res = await authFetch(`/api/closing/history?${q.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Closing History');
    return data;
  },

  async getClosingDetailById(id: number) {
    const res = await authFetch(`/api/closing/history/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load Closing Detail');
    return data;
  },

  async reopenClosedPeriod(id: number, reason: string) {
    const res = await authFetch(`/api/closing/${id}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reopen closed period');
    return data;
  },
};



