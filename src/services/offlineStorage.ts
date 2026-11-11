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
const DB_VERSION = 2;

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

  // --- META & DEVICE ID ---

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
