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
const ACTIVE_AUTH_SESSION_KEY = 'ams_active_auth_session_v2';
const ACTIVE_TAB_SESSION_KEY = 'ams_active_tab_session_v2';
const OFFLINE_AUTH_VAULT_KEY = 'ams_offline_auth_vault_v2';
const WORKSTATION_AUTHORIZED_KEY = 'ams_workstation_authorized_v2';
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

async function deriveBrowserPbkdf2Hash(password: string, saltHex: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser.');
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password).trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltHex),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function saveOfflineAuthVault(users: any[]): Promise<void> {
  if (!Array.isArray(users) || users.length === 0) return;
  try {
    await offlineStorage.bulkPut('auth_vault', users);
  } catch {
    // ignore IDB error
  }
  try {
    localStorage.setItem(OFFLINE_AUTH_VAULT_KEY, JSON.stringify(users));
    localStorage.setItem(WORKSTATION_AUTHORIZED_KEY, '1');
  } catch {
    // ignore quota error
  }
}

async function loadOfflineAuthVault(): Promise<any[]> {
  const byId = new Map<number, any>();
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_VAULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const u of parsed) {
          if (u && u.id) byId.set(Number(u.id), u);
        }
      }
    }
  } catch {
    // ignore
  }
  try {
    const idbUsers = await offlineStorage.getAll<any>('auth_vault');
    for (const u of idbUsers) {
      if (u && u.id) byId.set(Number(u.id), u);
    }
  } catch {
    // ignore
  }
  return Array.from(byId.values());
}

async function saveActiveAuthSession(payload: {
  user: User;
  permissions: any;
  rememberMe: boolean;
  offlineLogin?: boolean;
}): Promise<void> {
  const record = {
    ...payload,
    savedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, JSON.stringify(record));
    if (payload.rememberMe) {
      localStorage.setItem(ACTIVE_AUTH_SESSION_KEY, JSON.stringify(record));
    } else {
      localStorage.removeItem(ACTIVE_AUTH_SESSION_KEY);
    }
  } catch {
    // ignore
  }
  try {
    await offlineStorage.setMeta('active_auth_session', record);
  } catch {
    // ignore
  }
}

async function clearActiveAuthSession(): Promise<void> {
  try {
    sessionStorage.removeItem(ACTIVE_TAB_SESSION_KEY);
    localStorage.removeItem(ACTIVE_AUTH_SESSION_KEY);
  } catch {
    // ignore
  }
  try {
    await offlineStorage.setMeta('active_auth_session', null);
  } catch {
    // ignore
  }
}

async function getSavedActiveAuthSession(): Promise<{
  user: User;
  permissions: any;
  rememberMe: boolean;
  offlineLogin?: boolean;
} | null> {
  try {
    const tabRaw = sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY);
    if (tabRaw) {
      const parsed = JSON.parse(tabRaw);
      if (parsed && parsed.user) return parsed;
    }
  } catch {
    // ignore
  }
  try {
    const localRaw = localStorage.getItem(ACTIVE_AUTH_SESSION_KEY);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (parsed && parsed.user) return parsed;
    }
  } catch {
    // ignore
  }
  try {
    const metaSession = await offlineStorage.getMeta('active_auth_session');
    if (metaSession && metaSession.user && metaSession.rememberMe) {
      return metaSession;
    }
  } catch {
    // ignore
  }
  return null;
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
  const method = String(init?.method || 'GET').toUpperCase();
  const res = await fetch(url, {
    ...init,
    cache: init?.cache ?? 'no-store',
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

  // Whenever an online mutation succeeds, schedule a fast background sync so IndexedDB always holds the latest records
  if (
    res.ok &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    url.startsWith('/api/') &&
    !url.startsWith('/api/sync/') &&
    !url.startsWith('/api/auth/logout')
  ) {
    setTimeout(() => {
      offlineSyncManager.syncNow().catch(() => {});
    }, 200);
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
          const existingLocal = await offlineStorage.getAll<any>('items').catch(() => []);

          const localById = new Map<number, any>();
          const localByCode = new Map<string, any>();
          for (const loc of existingLocal) {
            if (loc?.id) localById.set(Number(loc.id), loc);
            if (loc?.item_code) localByCode.set(String(loc.item_code).toLowerCase(), loc);
          }

          const toCache: any[] = [];
          const seenIds = new Set<number>();
          const seenCodes = new Set<string>();
          const enrichedItems = data.items.map((srvItem: any) => {
            seenIds.add(Number(srvItem.id));
            if (srvItem?.item_code) seenCodes.add(String(srvItem.item_code).toLowerCase());
            const loc =
              localById.get(Number(srvItem.id)) ||
              localByCode.get(String(srvItem.item_code || '').toLowerCase());
            if (
              loc &&
              (loc.sync_status === 'pending' || loc.sync_status === 'syncing' || loc.sync_status === 'failed')
            ) {
              return loc;
            }
            const merged = {
              ...srvItem,
              sync_status: 'synced' as const,
              sync_error: null,
              local_modified: false,
            };
            toCache.push(merged);
            return merged;
          });

          // If server returned 0 items on an unfiltered query while local IndexedDB has items,
          // rehydrate server + Firestore from local IndexedDB automatically
          if (data.items.length === 0 && existingLocal.length > 0 && !params?.q && !params?.category && !params?.company) {
            await offlineSyncManager.rehydrateServerFromLocal();
          }

          let mergedExtraCount = 0;
          const qLower = String(params?.q || '').trim().toLowerCase();
          for (const loc of existingLocal) {
            const isUnsynced =
              loc?.sync_status === 'pending' || loc?.sync_status === 'syncing' || loc?.sync_status === 'failed';
            const serverWasEmpty = data.items.length === 0 && !params?.q;
            if (!isUnsynced && !serverWasEmpty) {
              continue;
            }
            const locCode = String(loc?.item_code || '').toLowerCase();
            if (seenIds.has(Number(loc.id)) || (locCode && seenCodes.has(locCode))) {
              continue;
            }
            if (qLower) {
              const hay = `${loc.item_code || ''} ${loc.item_name || ''} ${loc.generic_name || ''} ${loc.company_name || ''} ${loc.barcode || ''}`.toLowerCase();
              if (!hay.includes(qLower)) continue;
            }
            if (params?.category && params.category !== 'all' && String(loc.category || '') !== params.category) {
              continue;
            }
            if (params?.company && params.company !== 'all' && String(loc.company_name || '') !== params.company) {
              continue;
            }
            if (
              params?.status &&
              params.status !== 'all' &&
              String(loc.status || 'Active').toLowerCase() !== params.status.toLowerCase()
            ) {
              continue;
            }
            if (
              params?.lowStock &&
              Number(loc.opening_stock ?? loc.current_stock ?? 0) >
                Number(loc.minimum_stock ?? loc.reorder_level ?? 10)
            ) {
              continue;
            }
            enrichedItems.push(loc);
            mergedExtraCount++;
          }

          if (toCache.length > 0) {
            offlineStorage.bulkPut('items', toCache).catch(() => {});
          }

          if (mergedExtraCount > 0) {
            const sortKey = params?.sortBy || 'item_name';
            const dir = params?.sortOrder === 'desc' ? -1 : 1;
            enrichedItems.sort((a: any, b: any) => {
              const av = a?.[sortKey];
              const bv = b?.[sortKey];
              if (typeof av === 'number' || typeof bv === 'number') {
                return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
              }
              return String(av || '').localeCompare(String(bv || '')) * dir;
            });

            const allForStats = data.items.length === 0 ? existingLocal : enrichedItems;
            const cats = Array.from(new Set(allForStats.map((i: any) => i.category).filter(Boolean))).sort();
            const comps = Array.from(new Set(allForStats.map((i: any) => i.company_name).filter(Boolean))).sort();
            const computedStats = {
              totalItems: allForStats.length,
              activeItems: allForStats.filter((i: any) => String(i.status || 'Active') === 'Active').length,
              lowStockItems: allForStats.filter(
                (i: any) =>
                  Number(i.opening_stock ?? i.current_stock ?? 0) <=
                  Number(i.minimum_stock ?? i.reorder_level ?? 10)
              ).length,
              totalTradeValue: round2Local(
                allForStats.reduce(
                  (s: number, i: any) =>
                    s + Math.max(0, Number(i.opening_stock ?? i.current_stock ?? 0)) * Number(i.trade_price || i.purchase_price || 0),
                  0
                )
              ),
              totalRetailValue: round2Local(
                allForStats.reduce(
                  (s: number, i: any) =>
                    s + Math.max(0, Number(i.opening_stock ?? i.current_stock ?? 0)) * Number(i.retail_price || 0),
                  0
                )
              ),
              totalStockUnits: round2Local(
                allForStats.reduce(
                  (s: number, i: any) => s + Math.max(0, Number(i.opening_stock ?? i.current_stock ?? 0)),
                  0
                )
              ),
            };
            return {
              ...data,
              items: enrichedItems,
              stats: data.items.length === 0 ? computedStats : data.stats || computedStats,
              filters: {
                categories: cats.length > 0 ? cats : data.filters?.categories || [],
                companies: comps.length > 0 ? comps : data.filters?.companies || [],
              },
            };
          }

          return { ...data, items: enrichedItems };
        }
        return data;
      }
    } catch {
      // Offline fallback: serve directly from latest synchronized IndexedDB
    }
    const [allLocalItems, allBatches] = await Promise.all([
      offlineSyncManager.searchLocalItems(params?.q || '', 0),
      offlineStorage.getAll<any>('inventory'),
    ]);

    const packStockByItemId = new Map<number, number>();
    for (const b of allBatches) {
      const iid = Number(b.item_id || 0);
      if (iid <= 0) continue;
      const upp = Math.max(1, Number(b.units_per_pack || 1));
      const units = Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0);
      const packs = b.current_pack_qty !== undefined ? Number(b.current_pack_qty) : units / upp;
      packStockByItemId.set(iid, (packStockByItemId.get(iid) || 0) + packs);
    }

    const categoriesSet = new Set<string>();
    const companiesSet = new Set<string>();
    for (const it of allLocalItems) {
      if (it.category) categoriesSet.add(String(it.category));
      if (it.company_name) companiesSet.add(String(it.company_name));
    }

    let filtered = allLocalItems.map((it) => {
      const livePacks = packStockByItemId.has(Number(it.id))
        ? round2Local(packStockByItemId.get(Number(it.id))!)
        : Number(it.opening_stock ?? it.current_stock ?? 0);
      return {
        ...it,
        opening_stock: livePacks,
        current_stock: livePacks,
      };
    });

    if (params?.category && params.category !== 'all') {
      filtered = filtered.filter((i) => String(i.category || '') === params.category);
    }
    if (params?.company && params.company !== 'all') {
      filtered = filtered.filter((i) => String(i.company_name || '') === params.company);
    }
    if (params?.status && params.status !== 'all') {
      filtered = filtered.filter(
        (i) => String(i.status || 'Active').toLowerCase() === params.status!.toLowerCase()
      );
    }
    if (params?.lowStock) {
      filtered = filtered.filter(
        (i) =>
          Number(i.opening_stock || 0) <=
          Number(i.minimum_stock ?? i.reorder_level ?? 10)
      );
    }

    const stats = {
      totalItems: allLocalItems.length,
      activeItems: allLocalItems.filter((i) => String(i.status || 'Active') === 'Active').length,
      lowStockItems: allLocalItems.filter((i) => {
        const st = packStockByItemId.has(Number(i.id))
          ? packStockByItemId.get(Number(i.id))!
          : Number(i.opening_stock || 0);
        return st <= Number(i.minimum_stock ?? i.reorder_level ?? 10);
      }).length,
      totalStockValue: round2Local(
        allLocalItems.reduce((sum, i) => {
          const st = packStockByItemId.has(Number(i.id))
            ? packStockByItemId.get(Number(i.id))!
            : Number(i.opening_stock || 0);
          return sum + Math.max(0, st) * Number(i.purchase_price || 0);
        }, 0)
      ),
    };

    return {
      success: true,
      items: filtered,
      stats,
      categories: Array.from(categoriesSet).sort(),
      companies: Array.from(companiesSet).sort(),
      offline: true,
    };
  },

  /**
   * Items Master - Get Next Automatic Sequential Item Code (from persistent SQLite DB with Offline Support)
   */
  async getNextItemCode(): Promise<{
    success: boolean;
    prefix: string;
    next_number: number;
    next_code: string;
  }> {
    try {
      const res = await authFetch('/api/items/next-code');
      if (res.ok) {
        const data = await res.json();
        if (data && data.next_code) {
          return data;
        }
      }
    } catch {
      // Offline fallback: compute highest numeric item code from local IndexedDB
    }
    const localItems = await offlineStorage.getAll<any>('items');
    let maxNum = 10000;
    let latestPrefix = '';
    for (const it of localItems) {
      const code = String(it?.item_code || '').trim();
      const m = code.match(/^([^\d]*?)(\d+)$/);
      if (m) {
        latestPrefix = m[1] || '';
        const n = parseInt(m[2], 10);
        if (!Number.isNaN(n) && n > maxNum) {
          maxNum = n;
        }
      }
    }
    const nextNum = maxNum + 1;
    const nextCode = `${latestPrefix}${nextNum}`;
    return {
      success: true,
      prefix: latestPrefix,
      next_number: nextNum,
      next_code: nextCode,
    };
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
    const nowIso = new Date().toISOString();
    const deviceId = offlineSyncManager.getState().deviceId;
    try {
      const res = await authFetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.item) {
          const syncedItem = {
            ...data.item,
            sync_status: 'synced' as const,
            local_modified: false,
            sync_error: null,
            updated_at: data.item.updated_at || nowIso,
            created_at: data.item.created_at || nowIso,
          };
          await offlineStorage.put('items', syncedItem);
          data.item = syncedItem;
          await offlineSyncManager.refreshPendingCount();
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
    const codeInfo = await this.getNextItemCode();
    const nextCode = String(item.item_code || '').trim() || codeInfo.next_code;
    const localItem: any = {
      id: maxId + 1,
      item_code: nextCode,
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
      minimum_stock: Number(item.minimum_stock ?? item.reorder_level ?? 10),
      reorder_level: Number(item.reorder_level ?? item.minimum_stock ?? 10),
      opening_stock: Number(item.opening_stock || 0),
      rack_number: item.rack_number || item.rack_location || '',
      rack_location: item.rack_location || item.rack_number || '',
      status: item.status || 'Active',
      sync_status: 'pending',
      local_modified: true,
      sync_error: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await offlineStorage.put('items', localItem);
    const txId = `ITEM-CREATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: deviceId,
      action: 'CREATE_ITEM',
      entity: 'items',
      local_id: localItem.id,
      payload: localItem,
      created_at: nowIso,
    });
    await offlineSyncManager.refreshPendingCount();
    return {
      success: true,
      offline: true,
      item: localItem,
      data: localItem,
      message: 'Item saved locally (Offline Mode). Will sync automatically when online.',
    };
  },

  /**
   * Items Master - Update Item (with Offline Local Persistence & Sync Queue)
   */
  async updateItem(id: number, item: any) {
    const nowIso = new Date().toISOString();
    const deviceId = offlineSyncManager.getState().deviceId;
    const prevLocal = await offlineStorage.get<any>('items', Number(id)).catch(() => undefined);
    try {
      const res = await authFetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.item) {
          const syncedItem = {
            ...data.item,
            sync_status: 'synced' as const,
            local_modified: false,
            sync_error: null,
            updated_at: data.item.updated_at || nowIso,
            created_at: prevLocal?.created_at || data.item.created_at || nowIso,
          };
          await offlineStorage.put('items', syncedItem);
          data.item = syncedItem;
          await offlineSyncManager.refreshPendingCount();
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

    const existing = prevLocal || { id: Number(id) };
    const updatedItem: any = {
      ...existing,
      ...item,
      id: Number(id),
      sync_status: 'pending',
      local_modified: true,
      sync_error: null,
      created_at: existing.created_at || nowIso,
      updated_at: nowIso,
    };
    await offlineStorage.put('items', updatedItem);
    const txId = `ITEM-UPD-${id}-${Date.now()}`;
    await offlineStorage.enqueueSync({
      client_tx_id: txId,
      device_id: deviceId,
      action: 'UPDATE_ITEM',
      entity: 'items',
      local_id: id,
      payload: updatedItem,
      created_at: nowIso,
    });
    await offlineSyncManager.refreshPendingCount();
    return {
      success: true,
      offline: true,
      item: updatedItem,
      data: updatedItem,
      message: 'Item updated locally (Offline Mode). Will sync automatically when online.',
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
    await offlineStorage.delete('items', Number(id)).catch(() => {});
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
          const existingLocal = await offlineStorage.getAll<any>('accounts').catch(() => []);
          const seenCodes = new Set<string>(
            data.accounts.map((a: any) => String(a?.account_code || '').toLowerCase()).filter(Boolean)
          );
          const seenIds = new Set<number>(
            data.accounts.map((a: any) => Number(a?.id || 0)).filter((n: number) => n > 0)
          );
          const serverCustomCount = data.accounts.filter((a: any) => Number(a?.is_system_account || 0) === 0).length;
          const localCustomCount = existingLocal.filter((a: any) => Number(a?.is_system_account || 0) === 0).length;
          if (serverCustomCount === 0 && localCustomCount > 0 && !params?.q) {
            await offlineSyncManager.rehydrateServerFromLocal();
          }

          for (const loc of existingLocal) {
            const isUnsynced =
              loc?.sync_status === 'pending' || loc?.sync_status === 'syncing' || loc?.sync_status === 'failed';
            const shouldRecoverCustom =
              serverCustomCount === 0 && Number(loc?.is_system_account || 0) === 0 && !params?.q;
            if (!isUnsynced && !shouldRecoverCustom) {
              continue;
            }
            const code = String(loc?.account_code || '').toLowerCase();
            if ((code && seenCodes.has(code)) || seenIds.has(Number(loc?.id || 0))) continue;
            data.accounts.push(loc);
          }
          offlineStorage.bulkPut('accounts', data.accounts).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback: serve directly from latest synchronized IndexedDB
    }
    let localAccounts = await offlineSyncManager.searchLocalAccounts(params?.q || '', 0);
    if (params?.mainGroup && params.mainGroup !== 'all') {
      localAccounts = localAccounts.filter((a) => String(a.main_group || '') === params.mainGroup);
    }
    if (params?.accountGroup && params.accountGroup !== 'all') {
      localAccounts = localAccounts.filter(
        (a) => String(a.account_group || '') === params.accountGroup
      );
    }
    if (params?.parentAccountId && params.parentAccountId !== 'all') {
      localAccounts = localAccounts.filter(
        (a) => String(a.parent_account_id || '') === String(params.parentAccountId)
      );
    }
    if (params?.status && params.status !== 'all') {
      localAccounts = localAccounts.filter(
        (a) => String(a.status || 'Active').toLowerCase() === params.status!.toLowerCase()
      );
    }
    if (params?.ledgerView === 'customer') {
      localAccounts = localAccounts.filter(
        (a) =>
          a.account_group === 'Customer' ||
          a.account_group === 'Customer & Supplier' ||
          Number(a.enable_customer_ledger) === 1
      );
    } else if (params?.ledgerView === 'supplier') {
      localAccounts = localAccounts.filter(
        (a) =>
          a.account_group === 'Supplier' ||
          a.account_group === 'Customer & Supplier' ||
          Number(a.enable_supplier_ledger) === 1
      );
    }
    if (params?.townId && params.townId !== 'all') {
      localAccounts = localAccounts.filter((a) => String(a.town_id || '') === String(params.townId));
    }
    if (params?.town && params.town !== 'all') {
      localAccounts = localAccounts.filter(
        (a) => String(a.town_name || a.city || '').toLowerCase() === params.town!.toLowerCase()
      );
    }
    if (params?.areaId && params.areaId !== 'all') {
      localAccounts = localAccounts.filter((a) => String(a.area_id || '') === String(params.areaId));
    }
    if (params?.area && params.area !== 'all') {
      localAccounts = localAccounts.filter(
        (a) => String(a.area_name || '').toLowerCase() === params.area!.toLowerCase()
      );
    }
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
   * Accounts Master - Fetch all existing Party Cities from database & saved party records
   */
  async getPartyCities(): Promise<{ success: boolean; cities: string[] }> {
    try {
      const res = await authFetch('/api/accounts/cities');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.cities)) {
          offlineStorage.cacheApiData('party_cities_list', data.cities).catch(() => {});
          return data;
        }
      }
    } catch {
      // Offline fallback
    }
    const cached = (await offlineStorage.getCachedApiData<string[]>('party_cities_list')) || [];
    const allAccs = await offlineStorage.getAll<any>('accounts').catch(() => []);
    const byKey = new Map<string, string>();
    for (const c of cached) {
      const clean = String(c || '').trim().replace(/\s+/g, ' ');
      if (clean && !byKey.has(clean.toLowerCase())) {
        byKey.set(clean.toLowerCase(), clean);
      }
    }
    for (const acc of allAccs) {
      for (const raw of [acc?.city, acc?.town_name]) {
        const clean = String(raw || '').trim().replace(/\s+/g, ' ');
        if (clean && !byKey.has(clean.toLowerCase())) {
          byKey.set(clean.toLowerCase(), clean);
        }
      }
    }
    const cities = Array.from(byKey.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    return { success: true, cities };
  },

  /**
   * Accounts Master - Permanently add a new Party City to database with duplicate prevention
   */
  async createPartyCity(cityName: string): Promise<{
    success: boolean;
    city: string;
    cities: string[];
    message?: string;
  }> {
    const cleanCity = String(cityName || '').trim().replace(/\s+/g, ' ');
    if (!cleanCity) {
      throw new Error('City name is required.');
    }
    try {
      const res = await authFetch('/api/accounts/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city_name: cleanCity }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.cities)) {
          offlineStorage.cacheApiData('party_cities_list', data.cities).catch(() => {});
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

    const current = await this.getPartyCities();
    const dup = current.cities.find((c) => c.toLowerCase() === cleanCity.toLowerCase());
    if (dup) {
      throw new Error(`City "${dup}" already exists.`);
    }
    const updated = [...current.cities, cleanCity].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    await offlineStorage.cacheApiData('party_cities_list', updated).catch(() => {});
    return {
      success: true,
      city: cleanCity,
      cities: updated,
      message: `City "${cleanCity}" added successfully.`,
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
    await offlineStorage.delete('accounts', Number(id)).catch(() => {});
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
          const srvList = Array.isArray(data.purchases)
            ? data.purchases
            : Array.isArray(data.data)
            ? data.data
            : [];
          const existingLocal = await offlineStorage.getAll<any>('purchases').catch(() => []);
          const seenBills = new Set<string>(
            srvList
              .map((p: any) => String(p?.bill_number || p?.invoice_number || '').toLowerCase())
              .filter(Boolean)
          );
          let extraCount = 0;
          for (const loc of existingLocal) {
            if (loc?.sync_status !== 'pending' && loc?.sync_status !== 'syncing' && loc?.sync_status !== 'failed') {
              continue;
            }
            const bNo = String(loc?.bill_number || loc?.invoice_number || '').toLowerCase();
            if (bNo && seenBills.has(bNo)) continue;
            srvList.push(loc);
            extraCount++;
          }
          if (srvList.length > 0) {
            const toStore = srvList.map((p: any) => ({
              ...p,
              client_tx_id: p.client_tx_id || `PUR-${p.id || p.bill_number || p.invoice_number || Date.now()}`,
            }));
            offlineStorage.bulkPut('purchases', toStore).catch(() => {});
          }
          if (extraCount > 0) {
            data.purchases = srvList;
            data.data = srvList;
          }
          return data;
        }
      }
    } catch {
      // Offline fallback from IndexedDB
    }
    let localPurchases = await offlineStorage.getAll<any>('purchases');
    if (params?.status && params.status !== 'all') {
      localPurchases = localPurchases.filter(
        (p) => String(p.status || '').toLowerCase() === params.status!.toLowerCase()
      );
    }
    if (params?.supplierId && params.supplierId !== 'all') {
      localPurchases = localPurchases.filter(
        (p) => String(p.supplier_account_id || '') === String(params.supplierId)
      );
    }
    if (params?.paymentMode && params.paymentMode !== 'all') {
      localPurchases = localPurchases.filter(
        (p) => String(p.payment_mode || '').toLowerCase() === params.paymentMode!.toLowerCase()
      );
    }
    if (params?.startDate) {
      localPurchases = localPurchases.filter(
        (p) => String(p.bill_date || p.invoice_date || '') >= params.startDate!
      );
    }
    if (params?.endDate) {
      localPurchases = localPurchases.filter(
        (p) => String(p.bill_date || p.invoice_date || '') <= params.endDate!
      );
    }
    if (params?.q) {
      const qLower = params.q.toLowerCase();
      localPurchases = localPurchases.filter(
        (p) =>
          String(p.bill_number || p.invoice_number || '').toLowerCase().includes(qLower) ||
          String(p.supplier_name || '').toLowerCase().includes(qLower) ||
          String(p.supplier_invoice_no || '').toLowerCase().includes(qLower)
      );
    }
    localPurchases.sort((a, b) => {
      const da = String(a.bill_date || a.invoice_date || '');
      const db = String(b.bill_date || b.invoice_date || '');
      if (da !== db) return db.localeCompare(da);
      return Number(b.id || 0) - Number(a.id || 0);
    });
    return {
      success: true,
      purchases: localPurchases,
      data: localPurchases,
      summary: {
        totalPurchases: localPurchases.length,
        totalGrossAmount: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.gross_amount ?? p.subtotal_gross ?? 0), 0)
        ),
        totalDiscount: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.discount_amount ?? p.total_discount ?? 0), 0)
        ),
        totalTaxableAmount: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.taxable_amount ?? 0), 0)
        ),
        totalAdvanceTax: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.advance_tax_amount ?? 0), 0)
        ),
        totalGstAmount: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.gst_amount ?? p.tax_total ?? 0), 0)
        ),
        totalPayableAmount: round2Local(
          localPurchases.reduce(
            (s, p) => s + Number(p.total_payable ?? p.net_total ?? p.total_amount ?? 0),
            0
          )
        ),
        totalPaidAmount: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.paid_amount ?? 0), 0)
        ),
        totalBalanceDue: round2Local(
          localPurchases.reduce((s, p) => s + Number(p.balance_due ?? p.balance_amount ?? 0), 0)
        ),
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
      // Offline fallback: read from synchronized IndexedDB purchases store first
    }
    const allPurchases = await offlineStorage.getAll<any>('purchases');
    const found = allPurchases.find(
      (p) =>
        String(p.id) === String(id) ||
        String(p.server_id) === String(id) ||
        String(p.client_tx_id) === String(id)
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
    const cached = await offlineStorage.getCachedApiData<any>(`purchase_details_${id}`);
    if (cached) return { ...cached, offline: true };
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
        const savedPur = data.purchase || data.data || {};
        const purRecord = {
          ...payload,
          ...savedPur,
          id: savedPur.id || data.purchaseId || Date.now(),
          bill_number: savedPur.bill_number || savedPur.invoice_number || data.billNumber || payload.bill_number,
          invoice_number: savedPur.invoice_number || savedPur.bill_number || data.billNumber || payload.invoice_number,
          client_tx_id:
            payload.client_tx_id ||
            savedPur.client_tx_id ||
            `PUR-${savedPur.id || data.purchaseId || Date.now()}`,
          items: Array.isArray(payload.items) ? payload.items : savedPur.items || [],
          sync_status: 'synced',
        };
        offlineStorage.put('purchases', purRecord).catch(() => {});
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
        const savedPur = data.purchase || data.data || {};
        const purRecord = {
          ...payload,
          ...savedPur,
          id: savedPur.id || id,
          client_tx_id: savedPur.client_tx_id || payload.client_tx_id || `PUR-${id}`,
          items: Array.isArray(payload.items) ? payload.items : savedPur.items || [],
          sync_status: 'synced',
        };
        offlineStorage.put('purchases', purRecord).catch(() => {});
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
    const localReturns = await offlineStorage.getAll<any>('purchase_returns');
    if (cached && Array.isArray(cached.returns)) {
      const merged = [...localReturns, ...cached.returns];
      return { ...cached, returns: merged, data: merged, offline: true };
    }
    return { success: true, offline: true, returns: localReturns, data: localReturns };
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
    const localReturns = await offlineStorage.getAll<any>('purchase_returns');
    const found = localReturns.find(
      (r) => String(r.id) === String(id) || String(r.client_tx_id) === String(id)
    );
    if (found) {
      return { success: true, offline: true, purchaseReturn: found, items: found.items || [] };
    }
    throw new Error('Purchase return details not found in offline cache');
  },

  async createPurchaseReturn(payload: any) {
    try {
      const res = await authFetch('/api/purchases/returns', {
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
    }
    const offlineRes = await offlineSyncManager.queueOfflinePurchaseReturn(payload);
    return {
      success: true,
      offline: true,
      return_number: offlineRes.return_number,
      purchaseReturn: offlineRes.purchaseReturn,
      message: `Purchase Return ${offlineRes.return_number} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
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
      const packingStr = String(item.packing || item.pack_size || '1x1').trim();
      const multMatch = packingStr.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
      const numMatch = packingStr.match(/(\d+)/);
      const parsedUpp = multMatch
        ? Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10))
        : numMatch
        ? Math.max(1, parseInt(numMatch[1], 10))
        : 1;
      const upp = Math.max(1, Number(item.units_per_pack) || parsedUpp);
      const itemBatches = localBatches
        .filter((b) => Number(b.item_id) === Number(item.id))
        .map((b) => {
          const bUpp = Math.max(1, Number(b.units_per_pack) || upp);
          const qtyUnits = Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0);
          const packSale = Number(
            b.pack_retail ?? b.retail_price ?? b.sale_price ?? item.retail_price ?? item.sale_price ?? 0
          );
          const packPurchase = Number(b.pack_cost ?? b.purchase_price ?? item.purchase_price ?? 0);
          return {
            ...b,
            units_per_pack: bUpp,
            available_units: qtyUnits,
            available_packs: Number((qtyUnits / bUpp).toFixed(2)),
            sale_price: packSale,
            retail_price: packSale,
            purchase_price: packPurchase,
            loose_sale_price: Number((packSale / bUpp).toFixed(2)),
            loose_purchase_price: Number((packPurchase / bUpp).toFixed(2)),
          };
        });
      const totalUnits =
        itemBatches.length > 0
          ? itemBatches.reduce((sum, b) => sum + (Number(b.available_units) || 0), 0)
          : (Number(item.opening_stock ?? item.current_stock ?? 0) || 0) * upp;
      const salePrice = Number(item.retail_price ?? item.sale_price ?? item.wholesale_price ?? 0);
      const retailPrice = Number(item.retail_price ?? item.mrp ?? salePrice);
      const defaultBatch = itemBatches.find((b) => b.available_units > 0) || itemBatches[0] || null;
      return {
        ...item,
        units_per_pack: upp,
        loose_rate: Number(item.loose_rate || (salePrice / upp).toFixed(2)),
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
    if (params?.q) query.append('q', qParam(params.q));
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

    function qParam(v: string) {
      return v;
    }

    try {
      const res = await authFetch(`/api/sales?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const rows: any[] = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.sales)
            ? data.sales
            : [];
          const existingLocal = await offlineStorage.getAll<any>('sales').catch(() => []);

          const localByTx = new Map<string, any>();
          const localBySrvId = new Map<number, any>();
          for (const loc of existingLocal) {
            if (loc?.client_tx_id) localByTx.set(String(loc.client_tx_id), loc);
            const sid = Number(loc?.server_id || loc?.id || 0);
            if (sid > 0 && sid < 1_000_000_000_000) localBySrvId.set(sid, loc);
          }

          const toCache: any[] = [];
          const seenKeys = new Set<string>();
          const seenInvNos = new Set<string>();
          const enriched = rows.map((srvSale: any) => {
            const txKey = String(srvSale.client_tx_id || `SRV-SALE-${srvSale.id}`);
            seenKeys.add(txKey);
            if (srvSale.invoice_number) seenInvNos.add(String(srvSale.invoice_number).toLowerCase());
            const loc = localByTx.get(txKey) || localBySrvId.get(Number(srvSale.id));
            if (loc?.client_tx_id) seenKeys.add(String(loc.client_tx_id));
            if (
              loc &&
              (loc.sync_status === 'pending' || loc.sync_status === 'syncing' || loc.sync_status === 'failed')
            ) {
              return { ...srvSale, ...loc };
            }
            const merged = {
              ...srvSale,
              client_tx_id: loc?.client_tx_id || txKey,
              sync_status: 'synced' as const,
              sync_error: null,
            };
            toCache.push(merged);
            return merged;
          });

          // Include ONLY genuinely unsynced offline invoices (pending/syncing/failed) not yet pushed to server
          let mergedExtraCount = 0;
          const qLower = String(params?.q || '').trim().toLowerCase();
          for (const loc of existingLocal) {
            if (loc?.sync_status !== 'pending' && loc?.sync_status !== 'syncing' && loc?.sync_status !== 'failed') {
              continue;
            }
            const key = String(loc?.client_tx_id || '');
            const invNoLower = String(loc?.invoice_number || '').toLowerCase();
            if ((key && seenKeys.has(key)) || (invNoLower && seenInvNos.has(invNoLower))) {
              continue;
            }
            if (params?.status && params.status !== 'all') {
              const locSt = String(loc.status || '').toLowerCase();
              if (params.status === 'held_or_draft') {
                if (locSt !== 'held' && locSt !== 'draft') continue;
              } else if (locSt !== params.status.toLowerCase()) {
                continue;
              }
            }
            if (params?.customerId && params.customerId !== 'All' && params.customerId !== 'all') {
              if (String(loc.customer_account_id || '') !== String(params.customerId)) continue;
            }
            if (params?.paymentMode && params.paymentMode !== 'All' && params.paymentMode !== 'all') {
              if (String(loc.payment_mode || '').toLowerCase() !== params.paymentMode.toLowerCase()) continue;
            }
            if (params?.startDate && String(loc.invoice_date || loc.sale_date || '') < params.startDate) {
              continue;
            }
            if (params?.endDate && String(loc.invoice_date || loc.sale_date || '') > params.endDate) {
              continue;
            }
            if (qLower) {
              const hay = `${loc.invoice_number || ''} ${loc.customer_name || ''} ${loc.salesman || ''}`.toLowerCase();
              if (!hay.includes(qLower)) continue;
            }
            enriched.push(loc);
            mergedExtraCount++;
          }

          if (toCache.length > 0) {
            offlineStorage.bulkPut('sales', toCache).catch(() => {});
          }

          if (mergedExtraCount > 0) {
            enriched.sort((a: any, b: any) => {
              const da = String(a.invoice_date || a.sale_date || '');
              const db = String(b.invoice_date || b.sale_date || '');
              if (da !== db) return db.localeCompare(da);
              return Number(b.id || 0) - Number(a.id || 0);
            });
            const computedSummary = {
              ...(data.summary || {}),
              totalInvoices: enriched.length,
              totalNet: round2Local(
                enriched.reduce((acc: number, s: any) => acc + Number(s.net_total ?? s.total_amount ?? 0), 0)
              ),
              totalDiscount: round2Local(
                enriched.reduce((acc: number, s: any) => acc + Number(s.discount_total ?? s.discount_amount ?? 0), 0)
              ),
              totalPaid: round2Local(
                enriched.reduce((acc: number, s: any) => acc + Number(s.paid_amount ?? s.received_amount ?? 0), 0)
              ),
              totalBalance: round2Local(
                enriched.reduce((acc: number, s: any) => acc + Number(s.balance_amount ?? s.balance_due ?? 0), 0)
              ),
            };
            return {
              ...data,
              data: enriched,
              sales: enriched,
              summary: rows.length === 0 ? computedSummary : data.summary || computedSummary,
              totalCount: Math.max(Number(data.totalCount || 0), enriched.length),
            };
          }

          return {
            ...data,
            data: enriched,
            sales: enriched,
            totalCount: Math.max(Number(data.totalCount || 0), enriched.length),
          };
        }
      }
    } catch {
      // Offline fallback from latest synchronized IndexedDB
    }
    let localSales = await offlineStorage.getAll<any>('sales');
    if (params?.status && params.status !== 'all') {
      localSales = localSales.filter(
        (s) => String(s.status || '').toLowerCase() === params.status!.toLowerCase()
      );
    }
    if (params?.customerId && params.customerId !== 'all') {
      localSales = localSales.filter(
        (s) => String(s.customer_account_id || '') === String(params.customerId)
      );
    }
    if (params?.paymentMode && params.paymentMode !== 'all') {
      localSales = localSales.filter(
        (s) => String(s.payment_mode || '').toLowerCase() === params.paymentMode!.toLowerCase()
      );
    }
    if (params?.startDate) {
      localSales = localSales.filter(
        (s) => String(s.invoice_date || s.sale_date || '') >= params.startDate!
      );
    }
    if (params?.endDate) {
      localSales = localSales.filter(
        (s) => String(s.invoice_date || s.sale_date || '') <= params.endDate!
      );
    }
    if (params?.q) {
      const qLower = params.q.toLowerCase();
      localSales = localSales.filter(
        (s) =>
          String(s.invoice_number || '').toLowerCase().includes(qLower) ||
          String(s.customer_name || '').toLowerCase().includes(qLower)
      );
    }
    localSales.sort((a, b) => {
      const da = String(a.invoice_date || a.sale_date || '');
      const db = String(b.invoice_date || b.sale_date || '');
      if (da !== db) return db.localeCompare(da);
      return Number(b.id || 0) - Number(a.id || 0);
    });
    return {
      success: true,
      sales: localSales,
      data: localSales,
      summary: {
        totalInvoices: localSales.length,
        totalGrossAmount: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.gross_total ?? s.subtotal_gross ?? 0), 0)
        ),
        totalDiscountAmount: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.discount_total ?? s.total_discount ?? 0), 0)
        ),
        totalTaxAmount: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.tax_total ?? s.total_tax ?? 0), 0)
        ),
        totalNetPayable: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.net_total ?? s.total_amount ?? 0), 0)
        ),
        totalReceivedAmount: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.paid_amount ?? s.received_amount ?? 0), 0)
        ),
        totalBalanceDue: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.balance_amount ?? s.balance_due ?? 0), 0)
        ),
        totalProfitAmount: round2Local(
          localSales.reduce((acc, s) => acc + Number(s.total_profit ?? s.invoice_profit ?? 0), 0)
        ),
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
      // Offline fallback: read from synchronized IndexedDB sales store first
    }
    const allSales = await offlineStorage.getAll<any>('sales');
    const found = allSales.find(
      (s) =>
        String(s.id) === String(id) ||
        String(s.server_id) === String(id) ||
        String(s.client_tx_id) === String(id)
    );
    if (found) {
      return {
        success: true,
        offline: true,
        invoice: found,
        sale: found,
        items: found.items || found.lines || [],
        journalLines: [],
      };
    }
    const cached = await offlineStorage.getCachedApiData<any>(`sale_details_${id}`);
    if (cached) return { ...cached, offline: true };
    throw new Error('Sales invoice details not found in local storage');
  },

  /**
   * Sales & Billing Module - Create Sales Invoice (completed, held, or draft)
   */
  async createSale(payload: any) {
    const nowIso = new Date().toISOString();
    const deviceId = offlineSyncManager.getState().deviceId;
    const clientTxId =
      payload.client_request_id ||
      payload.client_tx_id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `TX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const payloadWithTx = { ...payload, client_request_id: clientTxId, client_tx_id: clientTxId };

    try {
      const res = await authFetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithTx),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const savedInvoice = data.invoice || data.data || data.sale;
        if (savedInvoice) {
          const saleRecord = {
            ...payloadWithTx,
            ...savedInvoice,
            id: savedInvoice.id || Date.now(),
            server_id: savedInvoice.id,
            client_tx_id: savedInvoice.client_tx_id || clientTxId,
            items: savedInvoice.items || payload.items || [],
            sync_status: 'synced' as const,
            local_modified: false,
            sync_error: null,
            created_at: savedInvoice.created_at || nowIso,
            updated_at: savedInvoice.updated_at || nowIso,
          };
          await offlineStorage.put('sales', saleRecord);
          if (data.invoice) data.invoice = saleRecord;
          if (data.data) data.data = saleRecord;
          await offlineSyncManager.refreshPendingCount();
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
      // Offline fallback: save locally to IndexedDB & queue for automatic background sync
    }

    const offlineRes = await offlineSyncManager.queueOfflineSale(payloadWithTx);
    const latestSale =
      (await offlineStorage.get<any>('sales', offlineRes.client_tx_id)) || offlineRes.sale;
    await offlineSyncManager.refreshPendingCount();
    return {
      offline: true,
      message: 'Invoice saved locally (Offline Mode). Will sync automatically when online.',
      invoice: {
        ...latestSale,
        id: latestSale.id || offlineRes.client_tx_id,
        invoice_number: offlineRes.invoice_number,
      },
      ...offlineRes,
    };
  },

  /**
   * Sales & Billing Module - Update Sales Invoice
   */
  async updateSale(id: number | string, payload: any) {
    const nowIso = new Date().toISOString();
    const deviceId = offlineSyncManager.getState().deviceId;
    const allSales = await offlineStorage.getAll<any>('sales').catch(() => []);
    const existing = allSales.find(
      (s) =>
        String(s.id) === String(id) ||
        String(s.server_id) === String(id) ||
        String(s.client_tx_id) === String(id)
    );

    try {
      const res = await authFetch(`/api/sales/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const savedInvoice = data.invoice || data.data || data.sale;
        const txKey = String(
          savedInvoice?.client_tx_id || existing?.client_tx_id || `SRV-SALE-${id}`
        );
        const saleRecord = {
          ...(existing || {}),
          ...payload,
          ...(savedInvoice || {}),
          id: savedInvoice?.id || existing?.id || id,
          server_id: savedInvoice?.id || existing?.server_id,
          client_tx_id: txKey,
          items: savedInvoice?.items || payload.items || existing?.items || [],
          sync_status: 'synced' as const,
          local_modified: false,
          sync_error: null,
          created_at: existing?.created_at || savedInvoice?.created_at || nowIso,
          updated_at: savedInvoice?.updated_at || nowIso,
        };
        await offlineStorage.put('sales', saleRecord);
        if (data.invoice) data.invoice = saleRecord;
        if (data.data) data.data = saleRecord;
        await offlineSyncManager.refreshPendingCount();
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

    const client_tx_id = `TX-UPD-SALE-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const recordKey = existing?.client_tx_id || String(id);
    const updatedRecord = {
      ...(existing || {}),
      ...payload,
      id,
      client_tx_id: recordKey,
      sync_status: 'pending',
      local_modified: true,
      sync_error: null,
      created_at: existing?.created_at || nowIso,
      updated_at: nowIso,
    };
    await offlineStorage.put('sales', updatedRecord);
    await offlineStorage.enqueueSync({
      client_tx_id,
      device_id: deviceId,
      action: 'UPDATE_SALE',
      entity: 'sales',
      local_id: String(id),
      payload: { ...payload, id },
      created_at: nowIso,
    });
    await offlineSyncManager.refreshPendingCount();
    return {
      success: true,
      offline: true,
      invoice: updatedRecord,
      data: updatedRecord,
      message: 'Sales invoice updated locally (Offline Mode). Will sync automatically when online.',
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
    const localReturns = await offlineStorage.getAll<any>('sale_returns');
    if (cached && Array.isArray(cached.returns)) {
      const merged = [...localReturns, ...cached.returns];
      return { ...cached, returns: merged, data: merged, offline: true };
    }
    return { success: true, offline: true, returns: localReturns, data: localReturns };
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
    const localReturns = await offlineStorage.getAll<any>('sale_returns');
    const found = localReturns.find(
      (r) => String(r.id) === String(id) || String(r.client_tx_id) === String(id)
    );
    if (found) {
      return { success: true, offline: true, saleReturn: found, items: found.items || [] };
    }
    throw new Error('Sales return details not found in offline cache');
  },

  async createSaleReturn(payload: any) {
    try {
      const res = await authFetch('/api/sales/returns', {
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
    }
    const offlineRes = await offlineSyncManager.queueOfflineSaleReturn(payload);
    return {
      success: true,
      offline: true,
      return_number: offlineRes.return_number,
      saleReturn: offlineRes.saleReturn,
      message: `Sales Return ${offlineRes.return_number} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
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
   * Authentication - System status & session verification (HttpOnly Cookie + Offline Session Restoration)
   */
  async getAuthStatus(): Promise<AuthStatusResponse> {
    purgeLegacyAuthStorage();
    try {
      const res = await authFetch('/api/auth/status');
      const data = await res.json();
      if (res.ok && data.authenticated && data.user) {
        if (Array.isArray(data.offlineUsers) && data.offlineUsers.length > 0) {
          await saveOfflineAuthVault(data.offlineUsers);
        }
        await saveActiveAuthSession({
          user: data.user,
          permissions: data.permissions || {},
          rememberMe: Boolean(data.rememberMe ?? true),
          offlineLogin: false,
        });
        return data;
      }
      if (res.ok && data.authenticated === false) {
        // If user logged in while offline during this session, preserve their offline session
        const savedSession = await getSavedActiveAuthSession();
        if (savedSession && savedSession.offlineLogin) {
          return {
            initialized: true,
            authenticated: true,
            rememberMe: savedSession.rememberMe,
            user: savedSession.user,
            permissions: savedSession.permissions,
          };
        }
        await clearActiveAuthSession();
        return data;
      }
    } catch {
      // Offline fallback: restore active session from local storage / IndexedDB without requiring cloud connection
    }

    const savedSession = await getSavedActiveAuthSession();
    if (savedSession && savedSession.user) {
      return {
        initialized: true,
        authenticated: true,
        rememberMe: Boolean(savedSession.rememberMe),
        user: savedSession.user,
        permissions: savedSession.permissions,
      };
    }

    return {
      initialized: true,
      authenticated: false,
      userCount: 1,
    };
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
   * Authentication - Login with HttpOnly Cookie Session, Remember Me & Secure Offline PBKDF2 Authentication
   */
  async login(data: {
    username: string;
    password: string;
    remember_me?: boolean;
  }): Promise<LoginResponse> {
    purgeLegacyAuthStorage();
    const device_id = getClientDeviceId();
    const device_name = getClientDeviceName();
    const rememberMe = Boolean(data.remember_me);

    try {
      const res = await authFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          remember_me: rememberMe,
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

      // Persist offline auth vault & current user's PBKDF2 verifier for future offline logins
      const vaultList = Array.isArray(result.offlineUsers) ? [...result.offlineUsers] : await loadOfflineAuthVault();
      if (result.user) {
        let salt = result.offlineVerifier?.salt;
        let hash = result.offlineVerifier?.hash;
        if (!salt || !hash) {
          try {
            salt = `ams-salt-${result.user.id}`;
            hash = await deriveBrowserPbkdf2Hash(String(data.password), salt);
          } catch {
            // ignore
          }
        }
        const selfVaultRecord = {
          ...result.user,
          offline_verifier_salt: salt,
          offline_verifier_hash: hash,
          permissions: result.permissions || {},
          updated_at: new Date().toISOString(),
        };
        const idx = vaultList.findIndex((u: any) => Number(u.id) === Number(result.user.id));
        if (idx >= 0) {
          vaultList[idx] = { ...vaultList[idx], ...selfVaultRecord };
        } else {
          vaultList.push(selfVaultRecord);
        }
      }
      await saveOfflineAuthVault(vaultList);

      if (result.user) {
        await saveActiveAuthSession({
          user: result.user,
          permissions: result.permissions || {},
          rememberMe,
          offlineLogin: false,
        });
      }

      return result;
    } catch (err: any) {
      // Re-throw explicit HTTP authentication failures (wrong password, locked account, deactivated) when server responded
      const msg = String(err?.message || '');
      const isNetworkOfflineError =
        !err?.code &&
        !err?.locked &&
        err?.attemptsRemaining === undefined &&
        (msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('Load failed') ||
          msg.includes('fetch') ||
          (typeof navigator !== 'undefined' && !navigator.onLine));

      if (!isNetworkOfflineError) {
        throw err;
      }
    }

    // OFFLINE LOGIN VERIFICATION USING STORED PBKDF2-HMAC-SHA256 AUTH VAULT
    const vaultUsers = await loadOfflineAuthVault();
    const isWorkstationAuthorized =
      vaultUsers.length > 0 || localStorage.getItem(WORKSTATION_AUTHORIZED_KEY) === '1';

    if (!isWorkstationAuthorized || vaultUsers.length === 0) {
      throw new Error(
        'This computer has not been authorized online yet. Please connect to the internet once to sign in and authorize this workstation for offline use.'
      );
    }

    const cleanIdentifier = String(data.username || '').trim().toLowerCase();
    const matchedUser = vaultUsers.find(
      (u: any) =>
        String(u.username || '').trim().toLowerCase() === cleanIdentifier ||
        (u.email && String(u.email).trim().toLowerCase() === cleanIdentifier)
    );

    if (!matchedUser) {
      throw new Error(
        'User account is not cached on this computer. New users must log in with internet connection at least once.'
      );
    }

    if (matchedUser.status && matchedUser.status !== 'Active') {
      throw new Error(
        `Your account is currently ${String(matchedUser.status).toLowerCase()}. Please contact the Super Administrator.`
      );
    }

    if (!matchedUser.offline_verifier_salt || !matchedUser.offline_verifier_hash) {
      throw new Error(
        'Offline security verifier not initialized for this user. Please log in once while connected to the internet.'
      );
    }

    const computedHash = await deriveBrowserPbkdf2Hash(
      String(data.password),
      String(matchedUser.offline_verifier_salt)
    );

    if (computedHash !== String(matchedUser.offline_verifier_hash)) {
      throw new Error('Invalid username/email or password');
    }

    const safeUser: User = {
      id: matchedUser.id,
      username: matchedUser.username,
      full_name: matchedUser.full_name,
      email: matchedUser.email || null,
      phone: matchedUser.phone || null,
      role: matchedUser.role,
      status: matchedUser.status || 'Active',
      failed_login_attempts: 0,
      last_login: new Date().toISOString(),
      created_at: matchedUser.created_at || new Date().toISOString(),
      updated_at: matchedUser.updated_at || new Date().toISOString(),
    };
    const permissions = matchedUser.permissions || {};

    await saveActiveAuthSession({
      user: safeUser,
      permissions,
      rememberMe,
      offlineLogin: true,
    });

    return {
      success: true,
      message: `Welcome back, ${safeUser.full_name} (Offline Mode)!`,
      rememberMe,
      user: safeUser,
      permissions,
    };
  },

  /**
   * Authentication - Voluntary Logout (Supports Offline Logout while preserving Auth Vault for subsequent Offline Login)
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    await clearActiveAuthSession();
    purgeLegacyAuthStorage();
    try {
      const res = await authFetch('/api/auth/logout', { method: 'POST' });
      return await res.json();
    } catch {
      return { success: true, message: 'You have been logged out (Offline Mode).' };
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
    try {
      const res = await authFetch('/api/system/sales-invoice-more-options');
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback from synchronized company_settings
    }
    const allSettings = await offlineStorage.getAll<any>('company_settings');
    return {
      success: true,
      data: allSettings[0] || {},
    };
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
    try {
      const res = await authFetch('/api/auth/users');
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback: load latest synchronized users from auth_vault
    }
    const localUsers = await loadOfflineAuthVault();
    return {
      success: true,
      users: localUsers as User[],
    };
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
        return data;
      }
    } catch {
      // Offline fallback: always compute from latest synchronized IndexedDB items & inventory
    }

    const [items, batches] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('inventory'),
    ]);
    const now = new Date().toISOString().split('T')[0];
    let totalCostVal = 0;
    let totalRetailVal = 0;
    let expiredCount = 0;
    let totalUnits = 0;
    let totalPacks = 0;
    const itemPacksMap = new Map<number, number>();

    for (const b of batches) {
      const upp = Math.max(1, Number(b.units_per_pack) || 1);
      const qtyUnits = Math.max(
        0,
        Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0)
      );
      const packs =
        b.current_pack_qty !== undefined && Number(b.current_pack_qty) >= 0
          ? Number(b.current_pack_qty)
          : qtyUnits / upp;
      const pCost = Number(b.pack_cost ?? b.purchase_price ?? 0);
      const pRetail = Number(b.pack_retail ?? b.retail_price ?? b.sale_price ?? 0);
      totalUnits += qtyUnits;
      totalPacks += packs;
      totalCostVal += packs * pCost;
      totalRetailVal += packs * pRetail;
      if (b.expiry_date && b.expiry_date < now && qtyUnits > 0) expiredCount++;
      const iid = Number(b.item_id || 0);
      if (iid > 0) itemPacksMap.set(iid, (itemPacksMap.get(iid) || 0) + packs);
    }

    let outOfStock = 0;
    let lowStock = 0;
    for (const it of items) {
      const st = itemPacksMap.has(Number(it.id))
        ? itemPacksMap.get(Number(it.id))!
        : Number(it.opening_stock ?? it.current_stock ?? 0);
      const minSt = Number(it.minimum_stock ?? it.reorder_level ?? 10);
      if (st <= 0) outOfStock++;
      else if (st <= minSt) lowStock++;
    }

    return {
      success: true,
      overview: {
        total_items: items.length,
        active_batches: batches.filter(
          (b) => Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0) > 0
        ).length,
        total_packs: round2Local(totalPacks),
        total_loose_units: totalUnits,
        cost_valuation: round2Local(totalCostVal),
        retail_valuation: round2Local(totalRetailVal),
        potential_profit: round2Local(totalRetailVal - totalCostVal),
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
        return data;
      }
    } catch {
      // Offline fallback: always compute from latest synchronized IndexedDB items & inventory
    }

    const [items, batches] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('inventory'),
    ]);
    const itemById = new Map<number, any>();
    for (const it of items) {
      itemById.set(Number(it.id), it);
    }

    let rows: StockDatasheetItem[] = batches.map((b) => {
      const it = itemById.get(Number(b.item_id)) || {};
      const upp = Math.max(1, Number(b.units_per_pack || it.units_per_pack || 1));
      const qtyUnits = Number(
        b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0
      );
      const packs = Math.floor(qtyUnits / upp);
      const loose = qtyUnits % upp;
      const pRate = Number(b.pack_cost ?? b.purchase_price ?? it.purchase_price ?? 0);
      const sRate = Number(
        b.pack_retail ?? b.retail_price ?? b.sale_price ?? it.retail_price ?? it.sale_price ?? 0
      );
      return {
        inventory_id: b.id,
        item_id: b.item_id,
        item_code: it.item_code || b.item_code || '',
        barcode: it.barcode || '',
        item_name: it.item_name || b.item_name || 'Item',
        generic_name: it.generic_name || '',
        company_name: it.company_name || b.company_name || '',
        category: it.category || '',
        pack_size: it.packing || it.pack_size || b.packing || `${upp}'s`,
        units_per_pack: upp,
        batch_number: b.batch_number || 'DEFAULT',
        expiry_date: b.expiry_date || '2027-12-31',
        quantity_packs: packs,
        quantity_loose: loose,
        total_units: qtyUnits,
        purchase_price: pRate,
        sale_price: sRate,
        mrp: Number(b.mrp || it.mrp || sRate),
        cost_valuation: round2Local((qtyUnits / upp) * pRate),
        retail_valuation: round2Local((qtyUnits / upp) * sRate),
        rack_location: b.rack_no || it.rack_location || '',
        expiry_status: 'SAFE',
        days_to_expiry: 365,
      } as any;
    });

    if (params?.search) {
      const qLower = params.search.toLowerCase();
      rows = rows.filter(
        (r: any) =>
          String(r.item_name || '').toLowerCase().includes(qLower) ||
          String(r.item_code || '').toLowerCase().includes(qLower) ||
          String(r.company_name || '').toLowerCase().includes(qLower) ||
          String(r.batch_number || '').toLowerCase().includes(qLower)
      );
    }
    if (params?.company && params.company !== 'ALL') {
      rows = rows.filter((r: any) => String(r.company_name || '') === params.company);
    }
    if (params?.category && params.category !== 'ALL') {
      rows = rows.filter((r: any) => String(r.category || '') === params.category);
    }

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
        total_packs: round2Local(rows.reduce((s, r: any) => s + (Number(r.quantity_packs) || 0), 0)),
        total_units: round2Local(rows.reduce((s, r: any) => s + (Number(r.total_units) || 0), 0)),
        total_cost_valuation: round2Local(
          rows.reduce((s, r: any) => s + (Number(r.cost_valuation) || 0), 0)
        ),
        total_retail_valuation: round2Local(
          rows.reduce((s, r: any) => s + (Number(r.retail_valuation) || 0), 0)
        ),
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
        return data;
      }
    } catch {
      // Offline fallback: compute directly from synchronized IndexedDB items & inventory
    }

    const [items, batches] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('inventory'),
    ]);
    const batchesByItem = new Map<number, any[]>();
    for (const b of batches) {
      const iid = Number(b.item_id || 0);
      if (iid <= 0) continue;
      if (!batchesByItem.has(iid)) batchesByItem.set(iid, []);
      batchesByItem.get(iid)!.push(b);
    }

    let data: CurrentStockSummary[] = items.map((it) => {
      const packingStr = String(it.packing || it.pack_size || '1x1').trim();
      const multMatch = packingStr.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
      const numMatch = packingStr.match(/(\d+)/);
      const parsedUpp = multMatch
        ? Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10))
        : numMatch
        ? Math.max(1, parseInt(numMatch[1], 10))
        : 1;
      const upp = Math.max(1, Number(it.units_per_pack) || parsedUpp);
      const itemBatches = batchesByItem.get(Number(it.id)) || [];
      const totalUnits =
        itemBatches.length > 0
          ? itemBatches.reduce(
              (sum, b) =>
                sum + Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0),
              0
            )
          : Number(it.opening_stock ?? it.current_stock ?? 0) * upp;
      const packs = round2Local(totalUnits / upp);
      const pRate = Number(it.purchase_price || 0);
      const sRate = Number(it.retail_price ?? it.sale_price ?? 0);
      const minSt = Number(it.minimum_stock ?? it.reorder_level ?? 10);
      return {
        item_id: it.id,
        item_code: it.item_code || '',
        item_name: it.item_name || '',
        generic_name: it.generic_name || '',
        company_name: it.company_name || '',
        category: it.category || '',
        pack_size: it.packing || it.pack_size || `${upp}'s`,
        units_per_pack: upp,
        total_packs: packs,
        total_loose_units: totalUnits,
        active_batches_count: itemBatches.filter(
          (b) => Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0) > 0
        ).length,
        avg_purchase_price: pRate,
        sale_price: sRate,
        cost_valuation: round2Local(packs * pRate),
        retail_valuation: round2Local(packs * sRate),
        reorder_level: minSt,
        stock_status: packs <= 0 ? 'OUT_OF_STOCK' : packs <= minSt ? 'LOW_STOCK' : 'IN_STOCK',
      } as any;
    });

    if (params?.search) {
      const qLower = params.search.toLowerCase();
      data = data.filter(
        (d: any) =>
          String(d.item_name || '').toLowerCase().includes(qLower) ||
          String(d.item_code || '').toLowerCase().includes(qLower) ||
          String(d.company_name || '').toLowerCase().includes(qLower)
      );
    }
    if (params?.company && params.company !== 'ALL') {
      data = data.filter((d: any) => String(d.company_name || '') === params.company);
    }
    if (params?.category && params.category !== 'ALL') {
      data = data.filter((d: any) => String(d.category || '') === params.category);
    }
    if (params?.status && params.status !== 'ALL') {
      data = data.filter((d: any) => String(d.stock_status || '') === params.status);
    }

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
        return data;
      }
    } catch {
      // Offline fallback from IndexedDB inventory
    }
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
        return data;
      }
    } catch {
      // Offline fallback from synchronized IndexedDB items & inventory
    }
    const currentRes = await this.getCurrentStock({
      search: params?.search,
      company: params?.company,
    });
    const lowItems = currentRes.data.filter(
      (i: any) => i.stock_status === 'OUT_OF_STOCK' || i.stock_status === 'LOW_STOCK'
    );
    return {
      success: true,
      data: lowItems as any,
      summary: {
        out_of_stock_count: lowItems.filter((i: any) => i.stock_status === 'OUT_OF_STOCK').length,
        low_stock_count: lowItems.filter((i: any) => i.stock_status === 'LOW_STOCK').length,
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
        return data;
      }
    } catch {
      // Offline fallback from IndexedDB stock_adjustments
    }
    const localAdj = await offlineStorage.getAll<any>('stock_adjustments');
    return { success: true, adjustments: localAdj as StockAdjustment[] };
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
    try {
      const res = await authFetch('/api/inventory/adjustments', {
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
    }
    const batches = await offlineStorage.getAll<any>('inventory');
    for (const line of payload.items || []) {
      const batch = batches.find((b) => Number(b.id) === Number(line.inventory_id));
      const upp = Math.max(1, Number(batch?.units_per_pack || 1));
      const deltaUnits =
        (Number(line.quantity_packs || 0) * upp + Number(line.quantity_loose || 0)) *
        (line.direction === 'DECREASE' ? -1 : 1);
      const currentUnits = Number(batch?.total_stock_units ?? batch?.quantity_in_stock ?? 0);
      const newTotalUnits = Math.max(0, currentUnits + deltaUnits);
      await offlineSyncManager.queueOfflineStockAdjustment({
        item_id: batch?.item_id || 0,
        batch_id: line.inventory_id,
        new_total_units: newTotalUnits,
        new_pack_quantity: Math.floor(newTotalUnits / upp),
        new_loose_units: newTotalUnits % upp,
        reason: payload.description || payload.reason_category,
      });
    }
    const adjNo = `ADJ-OFF-${Date.now().toString().slice(-5)}`;
    return {
      success: true,
      adjustment_no: adjNo,
      adjustment_id: Date.now(),
      journal_voucher_id: null,
      message: `Stock adjustment ${adjNo} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
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
    try {
      const res = await authFetch('/api/inventory/companies-items-meta');
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback from latest synchronized IndexedDB items
    }
    const items = await offlineStorage.getAll<any>('items');
    const companiesMap = new Map<string, number>();
    const categoriesSet = new Set<string>();
    for (const it of items) {
      if (it.company_name) {
        const c = String(it.company_name);
        companiesMap.set(c, (companiesMap.get(c) || 0) + 1);
      }
      if (it.category) categoriesSet.add(String(it.category));
    }
    return {
      success: true,
      companies: Array.from(companiesMap.entries()).map(([company_name, item_count]) => ({
        company_name,
        item_count,
      })),
      categories: Array.from(categoriesSet),
      items: items.map((it) => ({
        id: it.id,
        item_code: it.item_code || '',
        item_name: it.item_name || '',
        generic_name: it.generic_name || '',
        company_name: it.company_name || '',
        category: it.category || '',
        pack_size: it.packing || '1x1',
        units_per_pack: Number(it.units_per_pack || 1),
      })),
    } as any;
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

    try {
      const res = await authFetch(`/api/inventory/item-stock-report?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        return data;
      }
    } catch {
      // Offline fallback from latest synchronized IndexedDB items & inventory
    }
    const [items, batches] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('inventory'),
    ]);
    const packsByItem = new Map<number, number>();
    for (const b of batches) {
      const iid = Number(b.item_id || 0);
      if (iid <= 0) continue;
      const upp = Math.max(1, Number(b.units_per_pack || 1));
      const units = Number(b.total_stock_units ?? b.quantity_in_stock ?? b.quantity ?? 0);
      packsByItem.set(iid, (packsByItem.get(iid) || 0) + units / upp);
    }
    return {
      success: true,
      count: items.length,
      data: items.map((it) => {
        const closingQty = packsByItem.has(Number(it.id))
          ? round2Local(packsByItem.get(Number(it.id))!)
          : Number(it.opening_stock || 0);
        return {
          item_id: it.id,
          item_code: it.item_code || '',
          item_name: it.item_name || '',
          company_name: it.company_name || '',
          category: it.category || '',
          pack_size: it.packing || '1x1',
          opening_qty: Number(it.opening_stock || 0),
          purchased_qty: 0,
          sold_qty: 0,
          closing_qty: closingQty,
          purchase_price: Number(it.purchase_price || 0),
          sale_price: Number(it.retail_price || 0),
          stock_value: round2Local(closingQty * Number(it.purchase_price || 0)),
        };
      }) as any,
      totals: {},
    };
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

    try {
      const res = await authFetch(`/api/inventory/stock-statement?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`stock_statement_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`stock_statement_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    return { success: true, companies: [], grandTotals: {} } as any;
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

    try {
      const res = await authFetch(`/api/inventory/detailed-stock-report?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`detailed_stock_report_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`detailed_stock_report_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    return { success: true, count: 0, data: [], totals: {} };
  },

  // ==========================================
  // COMPLETE ACCOUNTING & LEDGER SYSTEM (TASK 7)
  // ==========================================

  async getHierarchicalCOA(params?: { q?: string; pillar?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.pillar) query.append('pillar', params.pillar);
    if (params?.status) query.append('status', params.status);

    try {
      const res = await authFetch(`/api/accounting/coa?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`accounting_coa_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`accounting_coa_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const accounts = await offlineStorage.getAll<any>('accounts');
    return { success: true, offline: true, accounts, tree: [], summary: {} };
  },

  async createCOAAccount(payload: any) {
    try {
      const res = await authFetch('/api/accounting/coa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return this.createAccount(payload);
  },

  async getNextAccountingVoucherNumber(type: string = 'JV') {
    try {
      const res = await authFetch(`/api/accounting/vouchers/next-number?type=${encodeURIComponent(type)}`);
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    return { success: true, nextVoucherNumber: `${type}-OFF-${Date.now().toString().slice(-4)}` };
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

    try {
      const res = await authFetch(`/api/accounting/vouchers?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`accounting_vouchers_${query.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`accounting_vouchers_${query.toString()}`);
    if (cached) return { ...cached, offline: true };
    const vouchers = await offlineStorage.getAll<any>('vouchers');
    return { success: true, offline: true, vouchers, data: vouchers };
  },

  async createAccountingVoucher(payload: any) {
    try {
      const res = await authFetch('/api/accounting/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    const clientTxId = `JV-OFF-${Date.now()}`;
    const record = { id: Date.now(), client_tx_id: clientTxId, ...payload, status: 'posted' };
    await offlineStorage.put('vouchers', record);
    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: getClientDeviceId(),
      action: 'CREATE_VOUCHER',
      entity: 'vouchers',
      local_id: clientTxId,
      payload: record,
      created_at: new Date().toISOString(),
    });
    return { success: true, offline: true, voucher: record, message: 'Voucher saved offline.' };
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
        return data;
      }
    } catch {
      // Offline fallback: compute directly from latest synchronized IndexedDB accounts, sales & cash_book
    }

    const localAccs = await offlineStorage.getAll<any>('accounts');
    const customerAccs = localAccs.filter(
      (a) =>
        ['Customer', 'Customers', 'Customer & Supplier'].includes(a.account_group) ||
        ['Customer', 'Customers'].includes(a.account_type)
    );
    const selectedAcc = params?.accountId
      ? localAccs.find((a) => String(a.id) === String(params.accountId))
      : null;
    const openingBal = selectedAcc
      ? (selectedAcc.opening_balance_type === 'Credit' ? -1 : 1) *
        Number(selectedAcc.opening_balance || 0)
      : 0;

    const localSales = await offlineStorage.getAll<any>('sales');
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    const entries: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const s of localSales) {
      if (s.status === 'cancelled' || s.status === 'held' || s.status === 'draft') continue;
      if (params?.accountId && String(s.customer_account_id) !== String(params.accountId)) continue;
      const amt = Number(s.net_total ?? s.total_amount ?? 0);
      const rcv = Number(s.paid_amount ?? s.received_amount ?? 0);
      totalDebit += amt;
      totalCredit += rcv;
      entries.push({
        id: s.id || s.client_tx_id,
        entry_date: s.invoice_date || s.sale_date || (s.created_at || '').split('T')[0],
        voucher_number: s.invoice_number,
        voucher_type: 'Sales Invoice',
        narration: `Sales Invoice ${s.invoice_number}`,
        debit: amt,
        credit: rcv,
        running_balance: openingBal + totalDebit - totalCredit,
      });
    }

    for (const v of localVouchers) {
      if (v.status === 'cancelled' || v.status === 'Cancelled') continue;
      if (params?.accountId && String(v.head_account_id) !== String(params.accountId)) continue;
      const dr = Number(v.payment_amount || 0);
      const cr = Number(v.receipt_amount || 0);
      totalDebit += dr;
      totalCredit += cr;
      entries.push({
        id: v.id || v.client_tx_id,
        entry_date: v.voucher_date,
        voucher_number: v.voucher_number,
        voucher_type: v.transaction_type,
        narration: v.narration || v.category || v.transaction_category,
        debit: dr,
        credit: cr,
        running_balance: openingBal + totalDebit - totalCredit,
      });
    }

    return {
      success: true,
      offline: true,
      accounts: customerAccs,
      entries,
      summary: {
        openingBalance: openingBal,
        totalDebit: round2Local(totalDebit),
        totalCredit: round2Local(totalCredit),
        closingBalance: round2Local(openingBal + totalDebit - totalCredit),
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
        return data;
      }
    } catch {
      // Offline fallback: compute directly from latest synchronized IndexedDB accounts, purchases & cash_book
    }

    const localAccs = await offlineStorage.getAll<any>('accounts');
    const supplierAccs = localAccs.filter(
      (a) =>
        ['Supplier', 'Suppliers', 'Customer & Supplier'].includes(a.account_group) ||
        ['Supplier', 'Suppliers'].includes(a.account_type)
    );
    const selectedAcc = params?.accountId
      ? localAccs.find((a) => String(a.id) === String(params.accountId))
      : null;
    const openingBal = selectedAcc
      ? (selectedAcc.opening_balance_type === 'Debit' ? -1 : 1) *
        Number(selectedAcc.opening_balance || 0)
      : 0;

    const localPurchases = await offlineStorage.getAll<any>('purchases');
    const localVouchers = await offlineStorage.getAll<any>('cash_book');
    const entries: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const p of localPurchases) {
      if (p.status === 'cancelled' || p.status === 'held' || p.status === 'draft') continue;
      if (params?.accountId && String(p.supplier_account_id) !== String(params.accountId)) continue;
      const amt = Number(p.total_payable ?? p.net_total ?? p.net_amount ?? p.total_amount ?? 0);
      const paid = Number(p.paid_amount ?? 0);
      totalCredit += amt;
      totalDebit += paid;
      entries.push({
        id: p.id || p.client_tx_id,
        entry_date: p.bill_date || p.invoice_date || (p.created_at || '').split('T')[0],
        voucher_number: p.bill_number || p.invoice_number,
        voucher_type: 'Purchase Invoice',
        narration: `Purchase Invoice ${p.bill_number || p.invoice_number}`,
        debit: paid,
        credit: amt,
        running_balance: openingBal + totalCredit - totalDebit,
      });
    }

    for (const v of localVouchers) {
      if (v.status === 'cancelled' || v.status === 'Cancelled') continue;
      if (params?.accountId && String(v.head_account_id) !== String(params.accountId)) continue;
      const dr = Number(v.payment_amount || 0);
      const cr = Number(v.receipt_amount || 0);
      totalDebit += dr;
      totalCredit += cr;
      entries.push({
        id: v.id || v.client_tx_id,
        entry_date: v.voucher_date,
        voucher_number: v.voucher_number,
        voucher_type: v.transaction_type,
        narration: v.narration || v.category || v.transaction_category,
        debit: dr,
        credit: cr,
        running_balance: openingBal + totalCredit - totalDebit,
      });
    }

    return {
      success: true,
      offline: true,
      accounts: supplierAccs,
      entries,
      summary: {
        openingBalance: openingBal,
        totalDebit: round2Local(totalDebit),
        totalCredit: round2Local(totalCredit),
        closingBalance: round2Local(openingBal + totalCredit - totalDebit),
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
        return data;
      }
    } catch {
      // Offline fallback from latest synchronized IndexedDB accounts
    }
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
    try {
      const res = await authFetch(`/api/staff/salesmen?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.salesmen)) {
          offlineStorage.bulkPut('salesmen', data.salesmen).catch(() => {});
        }
        return data;
      }
    } catch {
      // Offline fallback
    }
    const localSalesmen = await offlineStorage.getAll<any>('salesmen');
    return { success: true, offline: true, salesmen: localSalesmen, data: localSalesmen };
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
    try {
      const res = await authFetch('/api/supply/next-numbers');
      const data = await res.json();
      if (res.ok && data.success) return data;
    } catch {
      // Offline fallback
    }
    const suffix = Date.now().toString().slice(-4);
    return {
      success: true,
      offline: true,
      nextOrderFormNumber: `OF-OFF-${suffix}`,
      nextBookingNumber: `BK-OFF-${suffix}`,
      nextSupplyNumber: `SUP-OFF-${suffix}`,
      nextDispatchNumber: `DSP-OFF-${suffix}`,
      nextReturnNumber: `SRT-OFF-${suffix}`,
      nextRecoveryNumber: `RCV-OFF-${suffix}`,
    };
  },

  async getSupplyDashboard(date?: string) {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    try {
      const res = await authFetch(`/api/supply/dashboard${q}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('supply_dashboard', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('supply_dashboard');
    if (cached) return { ...cached, offline: true };
    return { success: true, offline: true, kpis: {}, recentBookings: [], recentSupplies: [] };
  },

  async getSupplySalesmen(params?: { q?: string; status?: string }) {
    const q = new URLSearchParams();
    if (params?.q) q.set('q', params.q);
    if (params?.status) q.set('status', params.status);
    try {
      const res = await authFetch(`/api/supply/salesmen?${q.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('supply_salesmen', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('supply_salesmen');
    if (cached) return { ...cached, offline: true };
    const localSalesmen = await offlineStorage.getAll<any>('salesmen');
    return { success: true, offline: true, salesmen: localSalesmen, data: localSalesmen };
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
    try {
      const res = await authFetch('/api/supply/towns');
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('supply_towns', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('supply_towns');
    if (cached) return { ...cached, offline: true };
    const snap = await offlineStorage.getCachedApiData<any>('supply_snapshot');
    return {
      success: true,
      offline: true,
      towns: snap?.towns || [],
      areas: snap?.areas || [],
    };
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
    try {
      const res = await authFetch(`/api/supply/order-forms/catalog?${q.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData(`supply_catalog_${q.toString()}`, data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>(`supply_catalog_${q.toString()}`);
    if (cached) return { ...cached, offline: true };
    const items = await offlineStorage.getAll<any>('items');
    return { success: true, offline: true, items, companies: [] };
  },

  async getSupplyOrderForms(params?: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') q.set(k, String(v));
      });
    }
    try {
      const res = await authFetch(`/api/supply/order-forms?${q.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('supply_order_forms', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('supply_order_forms');
    if (cached) return { ...cached, offline: true };
    return { success: true, offline: true, orderForms: [], data: [] };
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
    try {
      const res = await authFetch(`/api/supply/bookings?${q.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        await offlineStorage.cacheApiData('supply_bookings', data);
        return data;
      }
    } catch {
      // Offline fallback
    }
    const cached = await offlineStorage.getCachedApiData<any>('supply_bookings');
    if (cached) return { ...cached, offline: true };
    const snap = await offlineStorage.getCachedApiData<any>('supply_snapshot');
    return { success: true, offline: true, bookings: snap?.bookings || [], data: snap?.bookings || [] };
  },

  async saveSupplyBooking(payload: Record<string, unknown>, id?: number) {
    try {
      const res = await authFetch(id ? `/api/supply/bookings/${id}` : '/api/supply/bookings', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) return data;
      if (res.status >= 400 && res.status < 500 && data.error) throw new Error(data.error);
    } catch (err: any) {
      if (err?.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }
    }
    const clientTxId = `BK-OFF-${Date.now()}`;
    const bookingRecord = { id: id || Date.now(), booking_number: clientTxId, ...payload, status: 'Confirmed' };
    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: getClientDeviceId(),
      action: 'CREATE_VOUCHER',
      entity: 'vouchers',
      local_id: clientTxId,
      payload: bookingRecord,
      created_at: new Date().toISOString(),
    });
    return { success: true, offline: true, booking: bookingRecord, message: 'Order Booking saved locally (Offline Mode).' };
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



