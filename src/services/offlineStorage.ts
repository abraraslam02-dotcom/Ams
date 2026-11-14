/**
 * Abrar Medical Store - Offline-First Client Database (IndexedDB)
 * High-performance, transaction-safe persistent client storage for full offline operation.
 *
 * Complies with strict POS & ERP requirements:
 * - Operates 100% offline without network connectivity
 * - Stores items, accounts, inventory, sales, purchases, cash_book, vouchers, api_cache, and sync_queue
 * - Fast indexed lookups by item name, generic name, barcode, company, and party names
 * - Atomic local transactions and idempotent UUID sync tracking
 */

const DB_NAME = 'AbrarMedicalStore_LocalDB';
const DB_VERSION = 4;

export type OfflineSyncAction =
  | 'CREATE_SALE'
  | 'UPDATE_SALE'
  | 'HOLD_SALE'
  | 'CANCEL_SALE'
  | 'CREATE_SALE_RETURN'
  | 'CREATE_PURCHASE'
  | 'UPDATE_PURCHASE'
  | 'HOLD_PURCHASE'
  | 'CREATE_PURCHASE_RETURN'
  | 'CREATE_ITEM'
  | 'UPDATE_ITEM'
  | 'UPDATE_ITEM_PRICE_CASCADE'
  | 'CREATE_ACCOUNT'
  | 'UPDATE_ACCOUNT'
  | 'CREATE_CASH_BOOK_VOUCHER'
  | 'UPDATE_CASH_BOOK_VOUCHER'
  | 'CREATE_VOUCHER'
  | 'STOCK_ADJUSTMENT';

export type OfflineSyncEntity =
  | 'sales'
  | 'purchases'
  | 'sale_returns'
  | 'purchase_returns'
  | 'items'
  | 'accounts'
  | 'inventory'
  | 'vouchers'
  | 'cash_book';

export interface OfflineSyncItem {
  client_tx_id: string; // Unique UUID generated on creation
  device_id: string; // Counter / Device ID
  action: OfflineSyncAction;
  entity: OfflineSyncEntity;
  local_id: string | number;
  payload: any;
  created_at: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retry_count: number;
  error?: string | null;
  server_id?: string | number | null;
  server_invoice_number?: string | null;
  synced_at?: string | null;
}

export interface OfflineMetaRecord {
  key: string;
  value: any;
  updated_at: string;
}

export interface SyncErrorLogRecord {
  id?: number;
  timestamp: string;
  entity: 'items' | 'invoices' | 'connection' | 'sync' | string;
  record_key: string;
  operation: string;
  code: string;
  message: string;
  details?: string;
}

class OfflineStorage {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initializes or opens the IndexedDB database
   */
  async getDb(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this runtime environment.'));
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Items Store
        if (!db.objectStoreNames.contains('items')) {
          const itemsStore = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
          itemsStore.createIndex('item_code', 'item_code', { unique: false });
          itemsStore.createIndex('barcode', 'barcode', { unique: false });
          itemsStore.createIndex('item_name', 'item_name', { unique: false });
          itemsStore.createIndex('company_name', 'company_name', { unique: false });
          itemsStore.createIndex('status', 'status', { unique: false });
        }

        // 2. Accounts Store (Customers, Suppliers, Financial)
        if (!db.objectStoreNames.contains('accounts')) {
          const accountsStore = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
          accountsStore.createIndex('account_code', 'account_code', { unique: false });
          accountsStore.createIndex('account_name', 'account_name', { unique: false });
          accountsStore.createIndex('account_group', 'account_group', { unique: false });
          accountsStore.createIndex('phone', 'phone', { unique: false });
          accountsStore.createIndex('status', 'status', { unique: false });
        }

        // 3. Inventory / Batches Store
        if (!db.objectStoreNames.contains('inventory')) {
          const invStore = db.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
          invStore.createIndex('item_id', 'item_id', { unique: false });
          invStore.createIndex('batch_number', 'batch_number', { unique: false });
          invStore.createIndex('expiry_date', 'expiry_date', { unique: false });
          invStore.createIndex('status', 'status', { unique: false });
        }

        // 4. Sales Invoices Store
        if (!db.objectStoreNames.contains('sales')) {
          const salesStore = db.createObjectStore('sales', { keyPath: 'client_tx_id' });
          salesStore.createIndex('invoice_number', 'invoice_number', { unique: false });
          salesStore.createIndex('invoice_date', 'invoice_date', { unique: false });
          salesStore.createIndex('customer_name', 'customer_name', { unique: false });
          salesStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        // 5. Purchases Invoices Store
        if (!db.objectStoreNames.contains('purchases')) {
          const purchasesStore = db.createObjectStore('purchases', { keyPath: 'client_tx_id' });
          purchasesStore.createIndex('invoice_number', 'invoice_number', { unique: false });
          purchasesStore.createIndex('bill_date', 'bill_date', { unique: false });
          purchasesStore.createIndex('supplier_name', 'supplier_name', { unique: false });
          purchasesStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        // 6. Payment Vouchers Store
        if (!db.objectStoreNames.contains('vouchers')) {
          const vouchersStore = db.createObjectStore('vouchers', { keyPath: 'client_tx_id' });
          vouchersStore.createIndex('voucher_number', 'voucher_number', { unique: false });
          vouchersStore.createIndex('voucher_date', 'voucher_date', { unique: false });
          vouchersStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        // 7. Store / Company Settings Store
        if (!db.objectStoreNames.contains('company_settings')) {
          db.createObjectStore('company_settings', { keyPath: 'id' });
        }

        // 8. Synchronization Queue Store
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'client_tx_id' });
          syncStore.createIndex('status', 'status', { unique: false });
          syncStore.createIndex('created_at', 'created_at', { unique: false });
          syncStore.createIndex('action', 'action', { unique: false });
        }

        // 9. Sync Meta Store (Device ID, Last Synced Version, Counters)
        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }

        // 10. Cash Book Vouchers Store (Added in v2)
        if (!db.objectStoreNames.contains('cash_book')) {
          const cbStore = db.createObjectStore('cash_book', { keyPath: 'client_tx_id' });
          cbStore.createIndex('voucher_number', 'voucher_number', { unique: false });
          cbStore.createIndex('voucher_date', 'voucher_date', { unique: false });
          cbStore.createIndex('transaction_type', 'transaction_type', { unique: false });
        }

        // 11. API Response Cache Store (Added in v2 for offline Dashboard, Ledgers, Reports)
        if (!db.objectStoreNames.contains('api_cache')) {
          db.createObjectStore('api_cache', { keyPath: 'key' });
        }

        // 12. Offline Auth Vault Store (Added in v3 for offline login & permissions)
        if (!db.objectStoreNames.contains('auth_vault')) {
          const authStore = db.createObjectStore('auth_vault', { keyPath: 'id' });
          authStore.createIndex('username', 'username', { unique: false });
          authStore.createIndex('email', 'email', { unique: false });
        }

        // 13. Sale Returns Store (Added in v3)
        if (!db.objectStoreNames.contains('sale_returns')) {
          const srStore = db.createObjectStore('sale_returns', { keyPath: 'client_tx_id' });
          srStore.createIndex('return_number', 'return_number', { unique: false });
          srStore.createIndex('return_date', 'return_date', { unique: false });
        }

        // 14. Purchase Returns Store (Added in v3)
        if (!db.objectStoreNames.contains('purchase_returns')) {
          const prStore = db.createObjectStore('purchase_returns', { keyPath: 'client_tx_id' });
          prStore.createIndex('return_number', 'return_number', { unique: false });
          prStore.createIndex('return_date', 'return_date', { unique: false });
        }

        // 15. Stock Adjustments Store (Added in v3)
        if (!db.objectStoreNames.contains('stock_adjustments')) {
          db.createObjectStore('stock_adjustments', { keyPath: 'client_tx_id' });
        }

        // 16. Salesmen Store (Added in v3)
        if (!db.objectStoreNames.contains('salesmen')) {
          db.createObjectStore('salesmen', { keyPath: 'id', autoIncrement: true });
        }

        // 17. Local Backups Store (Added in v3)
        if (!db.objectStoreNames.contains('local_backups')) {
          db.createObjectStore('local_backups', { keyPath: 'id' });
        }

        // 18. Sync Error & Diagnostic Logs Store
        if (!db.objectStoreNames.contains('sync_error_logs')) {
          const logStore = db.createObjectStore('sync_error_logs', {
            keyPath: 'id',
            autoIncrement: true,
          });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
          logStore.createIndex('entity', 'entity', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Failed to open local IndexedDB'));
      };
    });

    return this.dbPromise;
  }

  // --- GENERIC OPERATIONS ---

  async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async put<T>(storeName: string, item: T): Promise<T> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async bulkPut<T>(storeName: string, items: T[]): Promise<void> {
    if (!items || items.length === 0) return;
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      for (const item of items) {
        store.put(item);
      }
    });
  }

  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearStore(storeName: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- API SNAPSHOT CACHE HELPERS ---

  async cacheApiData(key: string, data: any): Promise<void> {
    try {
      await this.put('api_cache', {
        key,
        data,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // ignore storage errors
    }
  }

  async getCachedApiData<T>(key: string): Promise<T | undefined> {
    try {
      const row = await this.get<{ key: string; data: T; updated_at: string }>('api_cache', key);
      return row?.data;
    } catch {
      return undefined;
    }
  }

  // --- SYNC QUEUE OPERATIONS ---

  async enqueueSync(item: Omit<OfflineSyncItem, 'status' | 'retry_count'>): Promise<OfflineSyncItem> {
    const fullItem: OfflineSyncItem = {
      ...item,
      status: 'pending',
      retry_count: 0,
      error: null,
    };
    await this.put('sync_queue', fullItem);
    return fullItem;
  }

  async getPendingSyncItems(): Promise<OfflineSyncItem[]> {
    const all = await this.getAll<OfflineSyncItem>('sync_queue');
    return all
      .filter((i) => i.status === 'pending' || i.status === 'failed')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async getFailedSyncItems(): Promise<OfflineSyncItem[]> {
    const all = await this.getAll<OfflineSyncItem>('sync_queue');
    return all
      .filter((i) => i.status === 'failed')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async retryFailedSyncItems(): Promise<number> {
    const failed = await this.getFailedSyncItems();
    for (const item of failed) {
      item.status = 'pending';
      item.error = null;
      await this.put('sync_queue', item);
    }
    return failed.length;
  }

  async updateSyncItemStatus(
    clientTxId: string,
    status: 'pending' | 'syncing' | 'synced' | 'failed',
    extra?: { error?: string | null; server_id?: any; server_invoice_number?: string }
  ): Promise<void> {
    const existing = await this.get<OfflineSyncItem>('sync_queue', clientTxId);
    if (!existing) return;
    existing.status = status;
    if (status === 'synced') {
      existing.synced_at = new Date().toISOString();
      existing.error = null;
    }
    if (extra?.error !== undefined) existing.error = extra.error;
    if (extra?.server_id !== undefined) existing.server_id = extra.server_id;
    if (extra?.server_invoice_number !== undefined)
      existing.server_invoice_number = extra.server_invoice_number;
    if (status === 'failed') existing.retry_count = (existing.retry_count || 0) + 1;
    await this.put('sync_queue', existing);
  }

  // --- OFFLINE LOCAL BACKUP & RESTORATION ---

  async exportFullDatabaseSnapshot(): Promise<{
    format: 'AMS_LOCAL_SNAPSHOT_V1';
    createdAt: string;
    deviceId: string;
    stores: Record<string, any[]>;
    recordCounts: Record<string, number>;
  }> {
    const storeNames = [
      'items',
      'accounts',
      'inventory',
      'sales',
      'purchases',
      'sale_returns',
      'purchase_returns',
      'stock_adjustments',
      'cash_book',
      'vouchers',
      'salesmen',
      'company_settings',
      'sync_queue',
      'sync_meta',
      'api_cache',
    ];
    const stores: Record<string, any[]> = {};
    const recordCounts: Record<string, number> = {};
    for (const name of storeNames) {
      try {
        const rows = await this.getAll<any>(name);
        stores[name] = rows;
        recordCounts[name] = rows.length;
      } catch {
        stores[name] = [];
        recordCounts[name] = 0;
      }
    }
    const deviceId = await this.getOrCreateDeviceId();
    return {
      format: 'AMS_LOCAL_SNAPSHOT_V1',
      createdAt: new Date().toISOString(),
      deviceId,
      stores,
      recordCounts,
    };
  }

  async importFullDatabaseSnapshot(snapshot: any): Promise<{
    restoredStores: number;
    totalRecords: number;
  }> {
    if (!snapshot || snapshot.format !== 'AMS_LOCAL_SNAPSHOT_V1' || typeof snapshot.stores !== 'object') {
      throw new Error('Invalid local backup file format. Expected AMS_LOCAL_SNAPSHOT_V1.');
    }
    let restoredStores = 0;
    let totalRecords = 0;
    for (const [storeName, rows] of Object.entries(snapshot.stores)) {
      if (!Array.isArray(rows)) continue;
      if (storeName === 'auth_vault') continue; // Preserve device auth vault
      try {
        await this.clearStore(storeName);
        if (rows.length > 0) {
          await this.bulkPut(storeName, rows);
        }
        restoredStores++;
        totalRecords += rows.length;
      } catch {
        // ignore missing store
      }
    }
    return { restoredStores, totalRecords };
  }

  // --- META, TABLE SYNC TRACKING & DEVICE ID ---

  async getMeta(key: string): Promise<any> {
    const rec = await this.get<OfflineMetaRecord>('sync_meta', key);
    return rec?.value;
  }

  async setMeta(key: string, value: any): Promise<void> {
    await this.put<OfflineMetaRecord>('sync_meta', {
      key,
      value,
      updated_at: new Date().toISOString(),
    });
  }

  async getTableSyncMeta(): Promise<
    Record<
      string,
      {
        lastSyncedAt: string;
        rowCount: number;
        latestUpdatedAt: string;
        maxId: number;
        status: 'synced' | 'failed';
      }
    >
  > {
    const meta = await this.getMeta('table_sync_status');
    return meta && typeof meta === 'object' ? meta : {};
  }

  async setTableSyncMeta(
    tableName: string,
    info: {
      lastSyncedAt: string;
      rowCount: number;
      latestUpdatedAt: string;
      maxId: number;
      status: 'synced' | 'failed';
    }
  ): Promise<void> {
    const current = await this.getTableSyncMeta();
    current[tableName] = info;
    await this.setMeta('table_sync_status', current);
  }

  /**
   * Invalidates cached API response blobs that would otherwise shadow fresh IndexedDB records
   */
  async invalidateDynamicApiCache(prefixes?: string[]): Promise<void> {
    try {
      const allCached = await this.getAll<{ key: string }>('api_cache');
      const preserveKeys = new Set(['supply_snapshot', 'payroll_snapshot', 'advance_tax_settings']);
      for (const entry of allCached) {
        if (!entry?.key || preserveKeys.has(entry.key)) continue;
        if (!prefixes || prefixes.length === 0 || prefixes.some((p) => entry.key.startsWith(p))) {
          await this.delete('api_cache', entry.key);
        }
      }
    } catch {
      // ignore cache cleanup errors
    }
  }

  /**
   * Purges all cached business data, drafts, sync queues, and sync error logs when the server
   * signals a new database reset or backup restore epoch, while strictly preserving user credentials,
   * auth_vault, workstation authorization, and terminal identity.
   */
  async purgeBusinessDataForReset(newResetEpoch: string): Promise<void> {
    const storesToClear = [
      'items',
      'inventory',
      'sales',
      'purchases',
      'vouchers',
      'cash_book',
      'sale_returns',
      'purchase_returns',
      'stock_adjustments',
      'salesmen',
      'api_cache',
      'local_backups',
      'sync_queue',
      'sync_error_logs',
    ];

    for (const store of storesToClear) {
      try {
        await this.clearStore(store);
      } catch {
        // ignore if store absent
      }
    }

    try {
      await this.setMeta('last_synced_at', null);
      await this.setMeta('last_tombstone_id', 0);
      await this.setMeta('table_sync_status', {});
      await this.setMeta('db_reset_epoch', newResetEpoch);
    } catch {
      // ignore meta reset errors
    }

    if (typeof window !== 'undefined') {
      try {
        const draftAndMobileKeys = [
          'ams_sales_invoice_active_draft',
          'ams_active_sales_invoice_draft_v2',
          'ams_active_purchase_draft',
          'ams_active_purchase_draft_v2',
          'ams_mobile_salesman_session_v1',
          'ams_mobile_offline_creds_v1',
          'ams_mobile_catalog_cache_v1',
          'ams_mobile_bookings_queue_v1',
        ];
        for (const k of draftAndMobileKeys) {
          window.localStorage.removeItem(k);
        }
        window.localStorage.setItem('ams_db_reset_epoch', newResetEpoch);
      } catch {
        // ignore storage restrictions
      }
    }
  }

  // --- DIAGNOSTIC SYNC ERROR LOGGING (NON-DESTRUCTIVE) ---

  async addSyncErrorLog(entry: Omit<SyncErrorLogRecord, 'id' | 'timestamp'> & { timestamp?: string }): Promise<SyncErrorLogRecord> {
    const fullEntry: SyncErrorLogRecord = {
      timestamp: entry.timestamp || new Date().toISOString(),
      entity: entry.entity,
      record_key: entry.record_key,
      operation: entry.operation,
      code: entry.code,
      message: entry.message,
      details: entry.details,
    };
    try {
      const db = await this.getDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sync_error_logs', 'readwrite');
        const store = tx.objectStore('sync_error_logs');
        const req = store.add(fullEntry);
        req.onsuccess = () => {
          fullEntry.id = Number(req.result);
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback safely if store unavailable
    }
    return fullEntry;
  }

  async getSyncErrorLogs(limit = 50): Promise<SyncErrorLogRecord[]> {
    try {
      const all = await this.getAll<SyncErrorLogRecord>('sync_error_logs');
      return all
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Retrieves or generates a permanent unique Device / Counter ID for this browser station
   */
  async getOrCreateDeviceId(): Promise<string> {
    const stored = await this.getMeta('device_id');
    if (stored) return String(stored);

    // Generate permanent counter device ID
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newId = `POS-COUNTER-${randomSuffix}`;
    await this.setMeta('device_id', newId);
    return newId;
  }
}

export const offlineStorage = new OfflineStorage();
