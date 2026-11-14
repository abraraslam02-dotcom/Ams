/**
 * Abrar Medical Store - Offline Synchronization Manager
 * Orchestrates simple, reliable incremental synchronization between IndexedDB and Central Database.
 * Supports multiple counters/devices with unique Device IDs, batched sync, auto-retry, and idempotent transactions.
 */

import { offlineStorage } from './offlineStorage';
import { prepareItemIndex, searchItems } from '../utils/itemSearch';

export type SyncStatusType = 'synced' | 'pending' | 'syncing' | 'failed' | 'offline';

export interface SyncState {
  isOnline: boolean;
  serverConnected: boolean;
  syncStatus: SyncStatusType;
  statusMessage: string;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
  deviceId: string;
  counterName: string;
  terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts';
  lastError: string | null;
  justCompletedSync: boolean;
}

type SyncListener = (state: SyncState) => void;

const SYNC_BATCH_SIZE = 20;

function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function parseLocalUnitsPerPack(packingStr?: string | null): number {
  const clean = String(packingStr || '1x1').trim();
  const multMatch = clean.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  if (multMatch) {
    return Math.max(1, parseInt(multMatch[1], 10) * parseInt(multMatch[2], 10));
  }
  const numMatch = clean.match(/(\d+)/);
  if (numMatch) {
    return Math.max(1, parseInt(numMatch[1], 10));
  }
  return 1;
}

function getStoredAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    try {
      const rawSession =
        window.sessionStorage.getItem('ams_active_tab_session_v2') ||
        window.localStorage.getItem('ams_active_auth_session_v2');
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        if (parsed?.token) {
          headers['Authorization'] = `Bearer ${parsed.token}`;
          return headers;
        }
      }
      const legacyToken = window.localStorage.getItem('ams_session_token');
      if (legacyToken) {
        headers['Authorization'] = `Bearer ${legacyToken}`;
      }
    } catch {
      // ignore storage parse error
    }
  }
  return headers;
}

class OfflineSyncManager {
  private isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  private serverConnected = false;
  private syncStatus: SyncStatusType = 'synced';
  private pendingCount = 0;
  private failedCount = 0;
  private lastSyncedAt: string | null = null;
  private deviceId = 'POS-INITIALIZING';
  private counterName = 'Computer 1: Main Counter';
  private terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts' = 'Main Counter';
  private lastError: string | null = null;
  private justCompletedSync = false;
  private listeners: Set<SyncListener> = new Set();
  private syncTimer: any = null;
  private isSyncing = false;
  private isRehydrating = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private async init() {
    await offlineStorage.getDb().catch(() => {});

    this.deviceId = await offlineStorage.getOrCreateDeviceId();
    const savedCounterName = await offlineStorage.getMeta('counter_name');
    const savedTerminalType = await offlineStorage.getMeta('terminal_type');
    if (savedCounterName) this.counterName = String(savedCounterName);
    if (savedTerminalType) this.terminalType = savedTerminalType;
    this.lastSyncedAt = await offlineStorage.getMeta('last_synced_at');
    await this.refreshPendingCount();

    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notify();
      this.syncNow();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.serverConnected = false;
      this.syncStatus = 'offline';
      this.notify();
    });

    this.syncTimer = setInterval(() => {
      const browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (browserOnline && !this.isSyncing) {
        this.syncNow();
      }
    }, 15000);

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      this.syncNow();
    } else {
      this.isOnline = false;
      this.syncStatus = 'offline';
      this.notify();
    }
  }

  /**
   * Automatically re-hydrates the server SQLite database from local IndexedDB records
   * whenever a newly republished Cloud Run container starts up empty or is missing local records.
   */
  public async rehydrateServerFromLocal(): Promise<number> {
    if (this.isRehydrating) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

    this.isRehydrating = true;
    try {
      const [items, accounts, inventory, sales, purchases, cashBookVouchers] = await Promise.all([
        offlineStorage.getAll<any>('items').catch(() => []),
        offlineStorage.getAll<any>('accounts').catch(() => []),
        offlineStorage.getAll<any>('inventory').catch(() => []),
        offlineStorage.getAll<any>('sales').catch(() => []),
        offlineStorage.getAll<any>('purchases').catch(() => []),
        offlineStorage.getAll<any>('cash_book').catch(() => []),
      ]);

      const customAccounts = accounts.filter((a) => !a?.is_system_account);

      if (
        items.length === 0 &&
        customAccounts.length === 0 &&
        inventory.length === 0 &&
        sales.length === 0 &&
        purchases.length === 0 &&
        cashBookVouchers.length === 0
      ) {
        return 0;
      }

      const res = await fetch('/api/sync/restore-cloud-records', {
        method: 'POST',
        headers: getStoredAuthHeaders(),
        cache: 'no-store',
        body: JSON.stringify({
          items,
          invoices: sales,
          accounts: customAccounts,
          inventory,
          purchases,
          cashBookVouchers,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return Number(data?.totalRestored || 0);
      }
      return 0;
    } catch {
      return 0;
    } finally {
      this.isRehydrating = false;
    }
  }

  public async setTerminalDesignation(
    counterName: string,
    terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts'
  ): Promise<void> {
    this.counterName = counterName;
    this.terminalType = terminalType;
    await offlineStorage.setMeta('counter_name', counterName);
    await offlineStorage.setMeta('terminal_type', terminalType);
    this.notify();

    if (this.isOnline) {
      try {
        await fetch('/api/sync/register-terminal', {
          method: 'POST',
          headers: getStoredAuthHeaders(),
          body: JSON.stringify({
            deviceId: this.deviceId,
            counterName: this.counterName,
            terminalType: this.terminalType,
          }),
        });
      } catch {
        // Ignore network errors while offline
      }
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private getStatusMessage(): string {
    if (!this.isOnline || this.syncStatus === 'offline') {
      return 'Offline – Working Locally.';
    }
    if (this.isSyncing || this.syncStatus === 'syncing') {
      return 'Syncing – Please Wait.';
    }
    if (this.failedCount > 0 || this.syncStatus === 'failed') {
      return 'Failed – Changes Pending.';
    }
    if (this.justCompletedSync && this.pendingCount === 0) {
      return 'Synced – All Changes Saved.';
    }
    if (this.pendingCount > 0) {
      return 'Failed – Changes Pending.';
    }
    return this.lastSyncedAt ? 'Synced – All Changes Saved.' : 'Online – Connected.';
  }

  public getState(): SyncState {
    return {
      isOnline: this.isOnline,
      serverConnected: this.serverConnected,
      syncStatus: !this.isOnline ? 'offline' : this.syncStatus,
      statusMessage: this.getStatusMessage(),
      pendingCount: this.pendingCount,
      failedCount: this.failedCount,
      lastSyncedAt: this.lastSyncedAt,
      deviceId: this.deviceId,
      counterName: this.counterName,
      terminalType: this.terminalType,
      lastError: this.lastError,
      justCompletedSync: this.justCompletedSync,
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('Sync listener error:', err);
      }
    });
  }

  public async refreshPendingCount(): Promise<number> {
    try {
      const [queueItems, queueFailed, allItems, allSales] = await Promise.all([
        offlineStorage.getPendingSyncItems(),
        offlineStorage.getFailedSyncItems(),
        offlineStorage.getAll<any>('items'),
        offlineStorage.getAll<any>('sales'),
      ]);

      const pendingQueueTxIds = new Set(queueItems.map((q) => q.client_tx_id));
      const failedQueueTxIds = new Set(queueFailed.map((q) => q.client_tx_id));

      const extraPendingItems = allItems.filter(
        (i) => i?.sync_status === 'pending' && !pendingQueueTxIds.has(`ITEM-${i.id}`)
      ).length;
      const extraPendingSales = allSales.filter(
        (s) => s?.sync_status === 'pending' && !pendingQueueTxIds.has(String(s.client_tx_id || ''))
      ).length;

      const extraFailedItems = allItems.filter(
        (i) => i?.sync_status === 'failed' && !failedQueueTxIds.has(`ITEM-${i.id}`)
      ).length;
      const extraFailedSales = allSales.filter(
        (s) => s?.sync_status === 'failed' && !failedQueueTxIds.has(String(s.client_tx_id || ''))
      ).length;

      this.pendingCount = queueItems.length + extraPendingItems + extraPendingSales;
      this.failedCount = queueFailed.length + extraFailedItems + extraFailedSales;

      if (!this.isSyncing) {
        if (!this.isOnline) {
          this.syncStatus = 'offline';
        } else if (this.failedCount > 0) {
          this.syncStatus = 'failed';
        } else if (this.pendingCount > 0) {
          this.syncStatus = 'pending';
        } else {
          this.syncStatus = 'synced';
        }
      }
      this.notify();
      return this.pendingCount;
    } catch {
      return 0;
    }
  }

  private normalizeTimestamp(ts: unknown): string {
    const clean = String(ts || '').trim();
    if (!clean) return '';
    return clean.replace(' ', 'T');
  }

  private async mergeIdKeyedTable(
    storeName: string,
    remoteRows: any[],
    protectedIds: Set<number>,
    serverSyncTime: string,
    isIncremental: boolean
  ): Promise<void> {
    if (!Array.isArray(remoteRows)) return;

    const localRows = await offlineStorage.getAll<any>(storeName);
    if (!isIncremental && remoteRows.length === 0 && localRows.length > 0) {
      return;
    }
    if (remoteRows.length === 0) {
      await offlineStorage.setTableSyncMeta(storeName, {
        lastSyncedAt: serverSyncTime,
        rowCount: localRows.length,
        latestUpdatedAt: serverSyncTime,
        maxId: localRows.reduce((m, r) => Math.max(m, Number(r?.id || 0)), 0),
        status: 'synced',
      });
      return;
    }

    const localById = new Map<number, any>();
    for (const loc of localRows) {
      const id = Number(loc?.id);
      if (!Number.isNaN(id) && id > 0) {
        localById.set(id, loc);
      }
    }

    const toUpsert: any[] = [];
    let maxId = 0;
    let latestUpdatedAt = '';

    for (const remote of remoteRows) {
      const id = Number(remote?.id);
      if (Number.isNaN(id) || id <= 0) continue;
      if (id > maxId) maxId = id;

      const remoteTs = this.normalizeTimestamp(remote.updated_at || remote.created_at);
      if (remoteTs > latestUpdatedAt) latestUpdatedAt = remoteTs;

      if (protectedIds.has(id)) {
        continue;
      }

      const existing = localById.get(id);
      if (existing) {
        if (existing.sync_status === 'pending' || existing.sync_status === 'syncing' || existing.sync_status === 'failed') {
          continue;
        }
        const localTs = this.normalizeTimestamp(existing.updated_at || existing.created_at);
        if (localTs && remoteTs && localTs > remoteTs && existing.local_modified === true) {
          continue;
        }
      }

      toUpsert.push({
        ...remote,
        sync_status: 'synced',
        local_modified: false,
      });
    }

    if (toUpsert.length > 0) {
      await offlineStorage.bulkPut(storeName, toUpsert);
    }

    await offlineStorage.setTableSyncMeta(storeName, {
      lastSyncedAt: serverSyncTime,
      rowCount: Math.max(remoteRows.length, localById.size),
      latestUpdatedAt: latestUpdatedAt || serverSyncTime,
      maxId,
      status: 'synced',
    });
  }

  private async mergeTxKeyedTable(
    storeName: string,
    remoteRows: any[],
    pendingTxIds: Set<string>,
    serverSyncTime: string,
    isIncremental: boolean
  ): Promise<void> {
    if (!Array.isArray(remoteRows)) return;

    const localRows = await offlineStorage.getAll<any>(storeName);
    if (!isIncremental && remoteRows.length === 0 && localRows.length > 0) {
      return;
    }
    if (remoteRows.length === 0) {
      await offlineStorage.setTableSyncMeta(storeName, {
        lastSyncedAt: serverSyncTime,
        rowCount: localRows.length,
        latestUpdatedAt: serverSyncTime,
        maxId: localRows.reduce((m, r) => Math.max(m, Number(r?.server_id || r?.id || 0)), 0),
        status: 'synced',
      });
      return;
    }

    const localByTxId = new Map<string, any>();
    const localByServerId = new Map<number, any>();
    for (const loc of localRows) {
      if (loc?.client_tx_id) {
        localByTxId.set(String(loc.client_tx_id), loc);
      }
      const srvId = Number(loc?.server_id || loc?.id || 0);
      if (srvId > 0 && srvId < 1_000_000_000_000) {
        localByServerId.set(srvId, loc);
      }
    }

    const toUpsert: any[] = [];
    let maxId = 0;
    let latestUpdatedAt = '';

    for (const remote of remoteRows) {
      const remoteTxId = String(remote?.client_tx_id || '');
      if (!remoteTxId) continue;
      if (pendingTxIds.has(remoteTxId)) continue;

      const srvId = Number(remote?.server_id || remote?.id || 0);
      if (srvId > maxId) maxId = srvId;

      const remoteTs = this.normalizeTimestamp(remote.updated_at || remote.created_at);
      if (remoteTs > latestUpdatedAt) latestUpdatedAt = remoteTs;

      const existingByServerId = srvId > 0 ? localByServerId.get(srvId) : undefined;
      if (existingByServerId && String(existingByServerId.client_tx_id) !== remoteTxId) {
        if (pendingTxIds.has(String(existingByServerId.client_tx_id))) {
          continue;
        }
        await offlineStorage.delete(storeName, String(existingByServerId.client_tx_id)).catch(() => {});
      }

      const existingByTx = localByTxId.get(remoteTxId);
      if (
        existingByTx &&
        (existingByTx.sync_status === 'pending' ||
          existingByTx.sync_status === 'syncing' ||
          existingByTx.sync_status === 'failed')
      ) {
        continue;
      }

      toUpsert.push({
        ...remote,
        sync_status: 'synced',
        local_modified: false,
      });
    }

    if (toUpsert.length > 0) {
      await offlineStorage.bulkPut(storeName, toUpsert);
    }

    await offlineStorage.setTableSyncMeta(storeName, {
      lastSyncedAt: serverSyncTime,
      rowCount: Math.max(remoteRows.length, localByTxId.size),
      latestUpdatedAt: latestUpdatedAt || serverSyncTime,
      maxId,
      status: 'synced',
    });
  }

  private async applyTombstones(
    tombstones: Array<{
      id: number;
      table_name: string;
      record_id: string;
      client_tx_id?: string | null;
      deleted_at: string;
    }>,
    pendingItemIds: Set<number>,
    pendingAccountIds: Set<number>,
    pendingTxIds: Set<string>
  ): Promise<void> {
    if (!Array.isArray(tombstones) || tombstones.length === 0) return;

    const txStoreMap: Record<string, string> = {
      sales: 'sales',
      purchases: 'purchases',
      cash_book_vouchers: 'cash_book',
      sale_returns: 'sale_returns',
      purchase_returns: 'purchase_returns',
    };

    for (const tomb of tombstones) {
      const table = String(tomb.table_name || '');
      const numId = Number(tomb.record_id || 0);
      const txId = tomb.client_tx_id ? String(tomb.client_tx_id) : '';

      try {
        if (table === 'items' && numId > 0 && !pendingItemIds.has(numId)) {
          await offlineStorage.delete('items', numId);
          const invRows = await offlineStorage.getAll<any>('inventory');
          for (const b of invRows) {
            if (Number(b.item_id) === numId) {
              await offlineStorage.delete('inventory', Number(b.id));
            }
          }
        } else if (table === 'accounts' && numId > 0 && !pendingAccountIds.has(numId)) {
          await offlineStorage.delete('accounts', numId);
        } else if (table === 'inventory' && numId > 0) {
          const b = await offlineStorage.get<any>('inventory', numId);
          if (!b || !pendingItemIds.has(Number(b.item_id))) {
            await offlineStorage.delete('inventory', numId);
          }
        } else if (table === 'salesmen' && numId > 0) {
          await offlineStorage.delete('salesmen', numId);
        } else if (table === 'users' && numId > 0) {
          await offlineStorage.delete('auth_vault', numId);
        } else if (txStoreMap[table]) {
          const targetStore = txStoreMap[table];
          if (txId && !pendingTxIds.has(txId)) {
            await offlineStorage.delete(targetStore, txId);
          }
          if (numId > 0) {
            const allRows = await offlineStorage.getAll<any>(targetStore);
            for (const row of allRows) {
              if (
                (Number(row.id) === numId || Number(row.server_id) === numId) &&
                !pendingTxIds.has(String(row.client_tx_id))
              ) {
                await offlineStorage.delete(targetStore, String(row.client_tx_id));
              }
            }
          }
        }
      } catch {
        // ignore single tombstone error
      }
    }
  }

  /**
   * Main sync method:
   * 1. Checks server connection status (never wipes local IndexedDB on container restart/republish)
   * 2. Auto-retries previously failed queue items and pushes pending changes in small batches (20 per batch)
   * 3. Rehydrates server SQLite from local IndexedDB if a newly republished container started empty
   * 4. Pulls incremental delta updates since lastSyncedAt + last_tombstone_id
   */
  public async syncNow(): Promise<boolean> {
    if (this.isSyncing) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.isOnline = false;
      this.serverConnected = false;
      this.syncStatus = 'offline';
      this.notify();
      return false;
    }

    this.isSyncing = true;
    const hadPendingBefore = this.pendingCount > 0 || this.failedCount > 0;
    this.syncStatus = 'syncing';
    this.notify();

    let serverSyncTime = new Date().toISOString();
    let syncErrorMsg: string | null = null;

    try {
      await offlineStorage.getDb();

      // Step 1: Check central database status
      try {
        const statusRes = await fetch(`/api/sync/status?_t=${Date.now()}`, {
          headers: getStoredAuthHeaders(),
          cache: 'no-store',
        });
        if (!statusRes.ok && statusRes.status !== 401) {
          throw new Error(`Server status HTTP ${statusRes.status}`);
        }
        this.serverConnected = true;
        this.isOnline = true;
      } catch (connErr: unknown) {
        const msg = connErr instanceof Error ? connErr.message : String(connErr);
        this.serverConnected = false;
        this.isOnline = false;
        this.syncStatus = 'offline';
        this.lastError = msg;
        this.notify();
        return false;
      }

      fetch('/api/sync/register-terminal', {
        method: 'POST',
        headers: getStoredAuthHeaders(),
        cache: 'no-store',
        body: JSON.stringify({
          deviceId: this.deviceId,
          counterName: this.counterName,
          terminalType: this.terminalType,
        }),
      }).catch(() => {});

      // Step 2: Re-queue any previously failed records automatically on reconnect / Sync Now, then push in batches
      await offlineStorage.retryFailedSyncItems();
      const pendingItems = await offlineStorage.getPendingSyncItems();

      for (let i = 0; i < pendingItems.length; i += SYNC_BATCH_SIZE) {
        const batch = pendingItems.slice(i, i + SYNC_BATCH_SIZE);
        const batchByTxId = new Map(batch.map((p) => [p.client_tx_id, p]));

        const res = await fetch('/api/sync/push', {
          method: 'POST',
          headers: getStoredAuthHeaders(),
          cache: 'no-store',
          body: JSON.stringify({
            deviceId: this.deviceId,
            counterName: this.counterName,
            items: batch,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.results)) {
            for (const resItem of data.results) {
              await offlineStorage.updateSyncItemStatus(resItem.client_tx_id, resItem.status, {
                server_id: resItem.server_id,
                server_invoice_number: resItem.invoice_number,
                error: resItem.error,
              });

              const origQueueItem = batchByTxId.get(resItem.client_tx_id);
              if (!origQueueItem) continue;
              const { entity, local_id } = origQueueItem;
              const srvId = Number(resItem.server_id || 0);

              if (resItem.status === 'synced') {
                try {
                  if (entity === 'items' && Number(local_id) > 0) {
                    const oldLocal = await offlineStorage.get<any>('items', Number(local_id));
                    if (oldLocal) {
                      if (srvId > 0 && Number(local_id) !== srvId) {
                        await offlineStorage.put('items', {
                          ...oldLocal,
                          id: srvId,
                          server_id: srvId,
                          sync_status: 'synced',
                          local_modified: false,
                        });
                        await offlineStorage.delete('items', Number(local_id));
                      } else {
                        await offlineStorage.put('items', {
                          ...oldLocal,
                          sync_status: 'synced',
                          local_modified: false,
                        });
                      }
                    }
                  } else if (entity === 'accounts' && Number(local_id) > 0) {
                    const oldAcc = await offlineStorage.get<any>('accounts', Number(local_id));
                    if (srvId > 0 && Number(local_id) !== srvId) {
                      if (oldAcc) {
                        await offlineStorage.put('accounts', {
                          ...oldAcc,
                          id: srvId,
                          server_id: srvId,
                          sync_status: 'synced',
                          local_modified: false,
                        });
                      }
                      await offlineStorage.delete('accounts', Number(local_id));
                    } else if (oldAcc) {
                      await offlineStorage.put('accounts', {
                        ...oldAcc,
                        sync_status: 'synced',
                        local_modified: false,
                      });
                    }
                  } else if (
                    entity === 'sales' ||
                    entity === 'purchases' ||
                    entity === 'cash_book' ||
                    entity === 'sale_returns' ||
                    entity === 'purchase_returns'
                  ) {
                    const existingTx = await offlineStorage.get<any>(entity, resItem.client_tx_id);
                    if (existingTx) {
                      existingTx.sync_status = 'synced';
                      existingTx.local_modified = false;
                      if (srvId > 0) {
                        existingTx.id = srvId;
                        existingTx.server_id = srvId;
                      }
                      if (resItem.invoice_number) {
                        existingTx.invoice_number = resItem.invoice_number;
                        if (entity === 'purchases') existingTx.bill_number = resItem.invoice_number;
                        if (entity === 'cash_book') existingTx.voucher_number = resItem.invoice_number;
                      }
                      await offlineStorage.put(entity, existingTx);
                    }
                  }
                } catch {
                  // ignore local store update warning
                }
              } else {
                syncErrorMsg = resItem.error || 'One or more changes failed to sync.';
              }
            }
          }
        } else if (res.status !== 401) {
          syncErrorMsg = `Sync push HTTP ${res.status}`;
          break;
        }
      }

      // Step 2.5: Ensure server SQLite has all records from local IndexedDB (prevents data loss after Cloud Run Republish)
      await this.rehydrateServerFromLocal().catch(() => 0);

      // Step 3: Build protected IDs for any remaining pending/failed local records
      const [remainingPending, remainingFailed] = await Promise.all([
        offlineStorage.getPendingSyncItems(),
        offlineStorage.getFailedSyncItems(),
      ]);
      const stillQueued = [...remainingPending, ...remainingFailed];
      const pendingTxIds = new Set(stillQueued.map((p) => p.client_tx_id));
      const pendingItemIds = new Set(
        stillQueued
          .filter(
            (p) =>
              p.entity === 'items' ||
              p.entity === 'inventory' ||
              p.action === 'STOCK_ADJUSTMENT'
          )
          .map((p) => Number(p.local_id || p.payload?.item_id || p.payload?.id))
          .filter((id) => !Number.isNaN(id) && id > 0)
      );
      for (const p of stillQueued) {
        if (p.entity === 'sales' || p.entity === 'purchases') {
          const lines = Array.isArray(p.payload?.items)
            ? p.payload.items
            : Array.isArray(p.payload?.lines)
            ? p.payload.lines
            : [];
          for (const ln of lines) {
            const iid = Number(ln?.item_id || 0);
            if (iid > 0) pendingItemIds.add(iid);
          }
        }
      }

      const pendingAccountIds = new Set(
        stillQueued
          .filter((p) => p.entity === 'accounts')
          .map((p) => Number(p.local_id || p.payload?.id))
          .filter((id) => !Number.isNaN(id) && id > 0)
      );

      // Step 4: Incremental pull using since + last_tombstone_id
      const lastTombstoneId = Number((await offlineStorage.getMeta('last_tombstone_id')) || 0);
      const sinceParam = this.lastSyncedAt ? `&since=${encodeURIComponent(this.lastSyncedAt)}` : '';
      const pullRes = await fetch(
        `/api/sync/pull?device_id=${encodeURIComponent(this.deviceId)}&counter_name=${encodeURIComponent(
          this.counterName
        )}&last_tombstone_id=${lastTombstoneId}${sinceParam}&_t=${Date.now()}`,
        {
          headers: getStoredAuthHeaders(),
          cache: 'no-store',
        }
      );

      if (pullRes.ok) {
        const pullData = await pullRes.json();
        if (pullData && pullData.success) {
          serverSyncTime = String(pullData.serverTime || serverSyncTime);
          const isIncremental = Boolean(pullData.isIncremental);

          if (Array.isArray(pullData.tombstones) && pullData.tombstones.length > 0) {
            await this.applyTombstones(
              pullData.tombstones,
              pendingItemIds,
              pendingAccountIds,
              pendingTxIds
            );
          }
          if (typeof pullData.maxTombstoneId === 'number') {
            await offlineStorage.setMeta('last_tombstone_id', pullData.maxTombstoneId);
          }

          if (Array.isArray(pullData.items)) {
            await this.mergeIdKeyedTable('items', pullData.items, pendingItemIds, serverSyncTime, isIncremental);
          }
          if (Array.isArray(pullData.accounts)) {
            await this.mergeIdKeyedTable('accounts', pullData.accounts, pendingAccountIds, serverSyncTime, isIncremental);
          }
          if (Array.isArray(pullData.inventory)) {
            const localBatches = await offlineStorage.getAll<any>('inventory');
            const safeRemoteBatches = pullData.inventory.filter(
              (b: any) => !pendingItemIds.has(Number(b.item_id))
            );
            if (safeRemoteBatches.length > 0) {
              await offlineStorage.bulkPut('inventory', safeRemoteBatches);
            }
            if (pullData.inventory.length > 0 || localBatches.length === 0 || isIncremental) {
              await offlineStorage.setTableSyncMeta('inventory', {
                lastSyncedAt: serverSyncTime,
                rowCount: isIncremental ? localBatches.length : pullData.inventory.length,
                latestUpdatedAt: pullData.tableMeta?.inventory?.latestUpdatedAt || serverSyncTime,
                maxId: pullData.tableMeta?.inventory?.maxId || 0,
                status: 'synced',
              });
            }
          }
          if (Array.isArray(pullData.sales)) {
            await this.mergeTxKeyedTable('sales', pullData.sales, pendingTxIds, serverSyncTime, isIncremental);
          }
          if (Array.isArray(pullData.purchases)) {
            await this.mergeTxKeyedTable('purchases', pullData.purchases, pendingTxIds, serverSyncTime, isIncremental);
          }
          if (Array.isArray(pullData.cashBookVouchers)) {
            await this.mergeTxKeyedTable(
              'cash_book',
              pullData.cashBookVouchers,
              pendingTxIds,
              serverSyncTime,
              isIncremental
            );
          }
          if (Array.isArray(pullData.saleReturns)) {
            await this.mergeTxKeyedTable(
              'sale_returns',
              pullData.saleReturns,
              pendingTxIds,
              serverSyncTime,
              isIncremental
            );
          }
          if (Array.isArray(pullData.purchaseReturns)) {
            await this.mergeTxKeyedTable(
              'purchase_returns',
              pullData.purchaseReturns,
              pendingTxIds,
              serverSyncTime,
              isIncremental
            );
          }
          if (Array.isArray(pullData.salesmen)) {
            await this.mergeIdKeyedTable('salesmen', pullData.salesmen, new Set(), serverSyncTime, isIncremental);
          }
          if (pullData.supplySnapshot) {
            await offlineStorage.cacheApiData('supply_snapshot', pullData.supplySnapshot);
          }
          if (pullData.payrollSnapshot) {
            await offlineStorage.cacheApiData('payroll_snapshot', pullData.payrollSnapshot);
          }
          if (Array.isArray(pullData.offlineUsers) && pullData.offlineUsers.length > 0) {
            await offlineStorage.bulkPut('auth_vault', pullData.offlineUsers);
            await offlineStorage.setTableSyncMeta('auth_vault', {
              lastSyncedAt: serverSyncTime,
              rowCount: pullData.offlineUsers.length,
              latestUpdatedAt: serverSyncTime,
              maxId: pullData.tableMeta?.auth_vault?.maxId || 0,
              status: 'synced',
            });
            try {
              localStorage.setItem('ams_offline_auth_vault_v2', JSON.stringify(pullData.offlineUsers));
              localStorage.setItem('ams_workstation_authorized_v2', '1');
            } catch {
              // ignore quota
            }
          }
          if (pullData.companySettings) {
            await offlineStorage.put('company_settings', pullData.companySettings);
            await offlineStorage.setTableSyncMeta('company_settings', {
              lastSyncedAt: serverSyncTime,
              rowCount: 1,
              latestUpdatedAt: this.normalizeTimestamp(pullData.companySettings.updated_at) || serverSyncTime,
              maxId: Number(pullData.companySettings.id || 1),
              status: 'synced',
            });
          }
          if (pullData.advanceTaxSettings) {
            await offlineStorage.cacheApiData('advance_tax_settings', pullData.advanceTaxSettings);
          }

          this.lastSyncedAt = serverSyncTime;
          await offlineStorage.setMeta('last_synced_at', serverSyncTime);
        }
      } else if (pullRes.status !== 401) {
        syncErrorMsg = `Sync pull HTTP ${pullRes.status}`;
      }

      await offlineStorage.invalidateDynamicApiCache([
        'inventory_',
        'stock_',
        'ledger_',
        'cash_book_',
        'sale_details_',
        'purchase_details_',
        'sale_returns_',
        'purchase_returns_',
        'payment_vouchers_',
      ]);

      await this.refreshPendingCount();

      if (this.failedCount > 0 || syncErrorMsg) {
        this.syncStatus = 'failed';
        this.lastError = syncErrorMsg || `${this.failedCount} record(s) failed to sync.`;
      } else if (this.pendingCount > 0) {
        this.syncStatus = 'pending';
        this.lastError = null;
      } else {
        this.syncStatus = 'synced';
        this.lastError = null;
        if (hadPendingBefore || pullRes.ok) {
          this.justCompletedSync = true;
          setTimeout(() => {
            this.justCompletedSync = false;
            this.notify();
          }, 8000);
        }
      }

      this.notify();

      if (typeof window !== 'undefined' && this.isOnline) {
        window.dispatchEvent(
          new CustomEvent('ams-data-synchronized', {
            detail: { syncedAt: this.lastSyncedAt, serverTime: serverSyncTime },
          })
        );
      }

      return this.failedCount === 0 && !syncErrorMsg;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('NetworkError') ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      ) {
        this.isOnline = false;
        this.serverConnected = false;
        this.syncStatus = 'offline';
      } else {
        this.lastError = errorMsg;
        this.syncStatus = 'failed';
      }
      this.notify();
      return false;
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  /**
   * Records an offline Sales Invoice into IndexedDB, updates local stock & customer balance, and queues for sync
   */
  public async queueOfflineSale(payload: any): Promise<{
    success: boolean;
    client_tx_id: string;
    invoice_number: string;
    sale: any;
  }> {
    const clientTxId =
      payload.client_request_id ||
      (crypto.randomUUID
        ? crypto.randomUUID()
        : `TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    const isHeldOrDraft =
      payload.status === 'held' ||
      payload.status === 'draft' ||
      payload.status === 'Held' ||
      payload.status === 'Draft';

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const allSales = await offlineStorage.getAll<any>('sales');
    const nextSeq = allSales.length + 1;
    const localInvNo = isHeldOrDraft
      ? `HLD-${ym}-${String(nextSeq).padStart(2, '0')}`
      : payload.invoice_number && !String(payload.invoice_number).includes('OFF')
      ? payload.invoice_number
      : `Inv-${ym}-${String(nextSeq).padStart(2, '0')}`;

    const rawLines = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.lines)
      ? payload.lines
      : [];

    const nowIso = now.toISOString();
    const fullSale = {
      id: Date.now(),
      ...payload,
      items: rawLines,
      lines: rawLines,
      item_count: rawLines.length,
      client_tx_id: clientTxId,
      client_request_id: clientTxId,
      invoice_number: localInvNo,
      invoice_date: payload.invoice_date || nowIso.slice(0, 10),
      status: isHeldOrDraft ? 'held' : 'completed',
      sync_status: 'pending',
      local_modified: true,
      created_at: payload.created_at || nowIso,
      updated_at: nowIso,
    };

    // 1. Store in local sales object store
    await offlineStorage.put('sales', fullSale);

    // 2. Decrement local stock immediately & update customer balance if confirmed
    if (!isHeldOrDraft) {
      const allBatches = await offlineStorage.getAll<any>('inventory');
      for (const line of rawLines) {
        const itemId = Number(line.item_id || 0);
        if (!itemId) continue;
        const item = await offlineStorage.get<any>('items', itemId);
        const unitsPerPack = parseLocalUnitsPerPack(line.packing || item?.packing);
        const packsQty = Number(line.quantity ?? line.packs_quantity ?? 0);
        const looseQty = Number(line.loose_quantity || 0);
        const totalUnitsSold = round2(packsQty * unitsPerPack + looseQty);
        const packsEquiv = round2(totalUnitsSold / unitsPerPack);

        if (item) {
          item.opening_stock = round2((Number(item.opening_stock) || 0) - packsEquiv);
          await offlineStorage.put('items', item);
        }

        // Update matching batch in inventory store
        const targetBatch =
          allBatches.find(
            (b) =>
              Number(b.item_id) === itemId &&
              (Number(b.id) === Number(line.inventory_id) ||
                String(b.batch_number) === String(line.batch_number))
          ) || allBatches.find((b) => Number(b.item_id) === itemId);

        if (targetBatch) {
          targetBatch.sold_qty = round2((Number(targetBatch.sold_qty) || 0) + packsEquiv);
          targetBatch.total_stock_units = round2(
            (Number(targetBatch.total_stock_units) || 0) - totalUnitsSold
          );
          targetBatch.current_pack_qty = round2(targetBatch.total_stock_units / unitsPerPack);
          targetBatch.status =
            targetBatch.current_pack_qty <= 0 ? 'out_of_stock' : 'in_stock';
          await offlineStorage.put('inventory', targetBatch);
        }
      }

      // Update customer account balance if balance_amount > 0
      const custId = Number(payload.customer_account_id || 0);
      const netTotal = round2(payload.net_total || 0);
      const paidAmt = round2(payload.paid_amount || 0);
      const balDiff = round2(netTotal - paidAmt);
      if (custId > 0 && balDiff !== 0) {
        const custAcc = await offlineStorage.get<any>('accounts', custId);
        if (custAcc) {
          custAcc.total_debit = round2((Number(custAcc.total_debit) || 0) + netTotal);
          custAcc.total_credit = round2((Number(custAcc.total_credit) || 0) + paidAmt);
          const signed =
            (custAcc.current_balance_type === 'Credit'
              ? -Number(custAcc.current_balance || 0)
              : Number(custAcc.current_balance || 0)) + balDiff;
          custAcc.current_balance = round2(Math.abs(signed));
          custAcc.current_balance_type = signed < 0 ? 'Credit' : 'Debit';
          await offlineStorage.put('accounts', custAcc);
        }
      }
    }

    // 3. Queue for synchronization
    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: isHeldOrDraft ? 'HOLD_SALE' : 'CREATE_SALE',
      entity: 'sales',
      local_id: clientTxId,
      payload: fullSale,
      created_at: now.toISOString(),
    });

    await this.refreshPendingCount();

    if (this.isOnline) {
      this.syncNow();
    }

    return {
      success: true,
      client_tx_id: clientTxId,
      invoice_number: localInvNo,
      sale: fullSale,
    };
  }

  /**
   * Records an offline Purchase Invoice into IndexedDB, increments local stock & supplier balance, and queues for sync
   */
  public async queueOfflinePurchase(payload: any): Promise<{
    success: boolean;
    client_tx_id: string;
    invoice_number: string;
    purchase: any;
  }> {
    const clientTxId =
      payload.client_request_id ||
      (crypto.randomUUID
        ? crypto.randomUUID()
        : `PUR-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    const isHeldOrDraft =
      payload.status === 'Held' ||
      payload.status === 'Draft' ||
      payload.status === 'held' ||
      payload.status === 'draft';

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const allPurchases = await offlineStorage.getAll<any>('purchases');
    const nextSeq = allPurchases.length + 1;
    const localInvNo = isHeldOrDraft
      ? `HLD-PUR-${ym}-${String(nextSeq).padStart(2, '0')}`
      : payload.bill_number || `Inv-${ym}-${String(nextSeq).padStart(2, '0')}`;

    const rawLines = Array.isArray(payload.items) ? payload.items : [];

    const fullPurchase = {
      id: Date.now(),
      ...payload,
      items: rawLines,
      item_count: rawLines.length,
      client_tx_id: clientTxId,
      client_request_id: clientTxId,
      bill_number: localInvNo,
      invoice_number: localInvNo,
      bill_date: payload.bill_date || now.toISOString().slice(0, 10),
      status: isHeldOrDraft ? 'Held' : 'Completed',
      sync_status: 'pending',
      created_at: now.toISOString(),
    };

    // 1. Store in local purchases object store
    await offlineStorage.put('purchases', fullPurchase);

    // 2. Increment local stock immediately & update supplier balance if confirmed
    if (!isHeldOrDraft) {
      const allBatches = await offlineStorage.getAll<any>('inventory');
      for (const line of rawLines) {
        const itemId = Number(line.item_id || 0);
        if (!itemId) continue;
        const item = await offlineStorage.get<any>('items', itemId);
        const unitsPerPack = parseLocalUnitsPerPack(line.packing || item?.packing);
        const totalPacksAdded = round2(
          Number(line.quantity || 0) + Number(line.bonus_quantity || 0)
        );
        const totalUnitsAdded = round2(
          totalPacksAdded * unitsPerPack + Number(line.loose_quantity || 0)
        );

        if (item) {
          item.opening_stock = round2((Number(item.opening_stock) || 0) + totalPacksAdded);
          await offlineStorage.put('items', item);
        }

        const batchNo = String(line.batch_number || `BATCH-${item?.item_code || itemId}-01`).trim();
        const existingBatch = allBatches.find(
          (b) => Number(b.item_id) === itemId && String(b.batch_number) === batchNo
        );

        if (existingBatch) {
          existingBatch.purchased_qty = round2(
            (Number(existingBatch.purchased_qty) || 0) + Number(line.quantity || 0)
          );
          existingBatch.bonus_qty = round2(
            (Number(existingBatch.bonus_qty) || 0) + Number(line.bonus_quantity || 0)
          );
          existingBatch.total_stock_units = round2(
            (Number(existingBatch.total_stock_units) || 0) + totalUnitsAdded
          );
          existingBatch.current_pack_qty = round2(
            existingBatch.total_stock_units / unitsPerPack
          );
          existingBatch.status = 'in_stock';
          await offlineStorage.put('inventory', existingBatch);
        } else {
          await offlineStorage.put('inventory', {
            id: Date.now() + Math.floor(Math.random() * 1000),
            item_id: itemId,
            batch_number: batchNo,
            manufacturing_date: line.manufacturing_date || '2025-01-01',
            expiry_date: line.expiry_date || '2028-12-31',
            packing: line.packing || item?.packing || '1x1',
            strips_per_box: 1,
            units_per_strip: unitsPerPack,
            units_per_pack: unitsPerPack,
            cost_price: round2(Number(line.purchase_price || 0) / unitsPerPack),
            trade_price: round2(line.trade_price || line.purchase_price || 0),
            wholesale_price: round2(line.wholesale_price || line.retail_price || 0),
            retail_price: round2(line.retail_price || item?.retail_price || 0),
            pack_cost: round2(line.purchase_price || item?.purchase_price || 0),
            pack_retail: round2(line.retail_price || item?.retail_price || 0),
            purchased_qty: Number(line.quantity || 0),
            bonus_qty: Number(line.bonus_quantity || 0),
            returned_qty: 0,
            sold_qty: 0,
            current_pack_qty: totalPacksAdded,
            current_strip_qty: totalPacksAdded,
            current_loose_qty: Number(line.loose_quantity || 0),
            total_stock_units: totalUnitsAdded,
            status: 'in_stock',
          });
        }
      }

      const supId = Number(payload.supplier_account_id || 0);
      const totalPayable = round2(payload.total_payable || payload.net_total || 0);
      const paidAmt = round2(payload.paid_amount || 0);
      const balDue = round2(totalPayable - paidAmt);
      if (supId > 0 && balDue !== 0) {
        const supAcc = await offlineStorage.get<any>('accounts', supId);
        if (supAcc) {
          supAcc.total_credit = round2((Number(supAcc.total_credit) || 0) + totalPayable);
          supAcc.total_debit = round2((Number(supAcc.total_debit) || 0) + paidAmt);
          const signedCredit =
            (supAcc.current_balance_type === 'Credit'
              ? Number(supAcc.current_balance || 0)
              : -Number(supAcc.current_balance || 0)) + balDue;
          supAcc.current_balance = round2(Math.abs(signedCredit));
          supAcc.current_balance_type = signedCredit >= 0 ? 'Credit' : 'Debit';
          await offlineStorage.put('accounts', supAcc);
        }
      }
    }

    // 3. Queue for synchronization
    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: isHeldOrDraft ? 'HOLD_PURCHASE' : 'CREATE_PURCHASE',
      entity: 'purchases',
      local_id: clientTxId,
      payload: fullPurchase,
      created_at: now.toISOString(),
    });

    await this.refreshPendingCount();

    if (this.isOnline) {
      this.syncNow();
    }

    return {
      success: true,
      client_tx_id: clientTxId,
      invoice_number: localInvNo,
      purchase: fullPurchase,
    };
  }

  /**
   * Records an offline Cash Book Voucher into IndexedDB, updates account balances locally, and queues for sync
   */
  public async queueOfflineCashBookVoucher(payload: any): Promise<{
    success: boolean;
    voucher_number: string;
    voucher: any;
    message: string;
  }> {
    const clientTxId = crypto.randomUUID
      ? crypto.randomUUID()
      : `CB-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const allCb = await offlineStorage.getAll<any>('cash_book');
    const maxSeq = allCb.reduce((m, r) => Math.max(m, Number(r.sequence_number || 0)), 0);
    const nextSeq = maxSeq + 1;
    const voucherNo = String(nextSeq).padStart(3, '0');

    const headAcc = await offlineStorage.get<any>('accounts', Number(payload.head_account_id));
    const cbAcc = await offlineStorage.get<any>('accounts', Number(payload.cash_bank_account_id));

    const recAmt = round2(Math.max(0, Number(payload.receipt_amount || 0)));
    const payAmt = round2(Math.max(0, Number(payload.payment_amount || 0)));
    const netAmt = recAmt > 0 ? recAmt : payAmt;
    const cleanDate = String(payload.voucher_date || new Date().toISOString().slice(0, 10));
    const cleanType = String(payload.transaction_type || (recAmt > 0 ? 'Receipt' : 'Payment'));

    const record = {
      id: Date.now(),
      client_tx_id: clientTxId,
      voucher_number: voucherNo,
      sequence_number: nextSeq,
      voucher_date: cleanDate,
      transaction_type: cleanType,
      category: payload.category || (recAmt > 0 ? 'customer_receipt' : 'shop_expense'),
      head_account_id: Number(payload.head_account_id),
      head_account_code: headAcc?.account_code || '',
      head_account_name: headAcc?.account_name || 'Account',
      head_code: headAcc?.account_code || '',
      head_name: headAcc?.account_name || 'Account',
      head_group: headAcc?.account_group || '',
      cash_bank_account_id: Number(payload.cash_bank_account_id),
      cash_bank_account_code: cbAcc?.account_code || 'FIN-1010',
      cash_bank_account_name: cbAcc?.account_name || 'Cash in Hand',
      cb_code: cbAcc?.account_code || 'FIN-1010',
      cb_name: cbAcc?.account_name || 'Cash in Hand',
      cb_group: cbAcc?.account_group || 'Cash in Hand',
      receipt_amount: recAmt,
      payment_amount: payAmt,
      net_amount: netAmt,
      narration:
        payload.narration ||
        `Cash Book Voucher #${voucherNo} ${recAmt > 0 ? 'Receipt from' : 'Payment to'} ${headAcc?.account_name || 'Account'}`,
      reference_number: payload.reference_number || '',
      status: 'posted',
      sync_status: 'pending',
      created_by: payload.created_by || 'Super Admin',
      created_at: new Date().toISOString(),
    };

    await offlineStorage.put('cash_book', record);

    // Update local balances in accounts store
    if (cbAcc) {
      const signedCb =
        (cbAcc.current_balance_type === 'Credit'
          ? -Number(cbAcc.current_balance || 0)
          : Number(cbAcc.current_balance || 0)) +
        recAmt -
        payAmt;
      cbAcc.current_balance = round2(Math.abs(signedCb));
      cbAcc.current_balance_type = signedCb < 0 ? 'Credit' : 'Debit';
      await offlineStorage.put('accounts', cbAcc);
    }

    if (headAcc) {
      // Receipt credits head account (-debit/+credit); Payment debits head account (+debit/-credit)
      const signedHead =
        (headAcc.current_balance_type === 'Credit'
          ? -Number(headAcc.current_balance || 0)
          : Number(headAcc.current_balance || 0)) +
        payAmt -
        recAmt;
      headAcc.current_balance = round2(Math.abs(signedHead));
      headAcc.current_balance_type = signedHead < 0 ? 'Credit' : 'Debit';
      await offlineStorage.put('accounts', headAcc);
    }

    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: 'CREATE_CASH_BOOK_VOUCHER',
      entity: 'cash_book',
      local_id: clientTxId,
      payload: record,
      created_at: new Date().toISOString(),
    });

    await this.refreshPendingCount();

    return {
      success: true,
      voucher_number: voucherNo,
      voucher: record,
      message: `Voucher #${voucherNo} saved locally (Offline Mode). Will automatically synchronize when online.`,
    };
  }

  /**
   * Records an offline Sales Return into IndexedDB, restores local stock & updates customer balance, and queues for sync
   */
  public async queueOfflineSaleReturn(payload: any): Promise<{
    success: boolean;
    return_number: string;
    saleReturn: any;
  }> {
    const clientTxId = crypto.randomUUID
      ? crypto.randomUUID()
      : `SR-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const allSr = await offlineStorage.getAll<any>('sale_returns');
    const returnNo =
      payload.return_number || `SR-${now.getFullYear()}-${String(allSr.length + 1).padStart(3, '0')}`;
    const lines = Array.isArray(payload.items) ? payload.items : [];
    const netAmt = round2(payload.net_return_amount || payload.total_amount || 0);

    const record = {
      id: Date.now(),
      ...payload,
      client_tx_id: clientTxId,
      return_number: returnNo,
      return_date: payload.return_date || now.toISOString().slice(0, 10),
      net_return_amount: netAmt,
      items: lines,
      sync_status: 'pending',
      created_at: now.toISOString(),
    };

    await offlineStorage.put('sale_returns', record);

    // Restore stock in local inventory
    const allBatches = await offlineStorage.getAll<any>('inventory');
    for (const line of lines) {
      const itemId = Number(line.item_id || 0);
      if (!itemId) continue;
      const item = await offlineStorage.get<any>('items', itemId);
      const uPerPack = parseLocalUnitsPerPack(line.packing || item?.packing);
      const unitsReturned = Number(
        line.total_units_returned ||
          line.quantity_returned ||
          Number(line.pack_qty || 0) * uPerPack + Number(line.loose_qty || 0)
      );
      if (item && unitsReturned > 0) {
        item.opening_stock = round2((Number(item.opening_stock) || 0) + unitsReturned / uPerPack);
        await offlineStorage.put('items', item);
      }
      const batch = allBatches.find((b) => Number(b.item_id) === itemId);
      if (batch && unitsReturned > 0) {
        batch.total_stock_units = round2((Number(batch.total_stock_units) || 0) + unitsReturned);
        batch.current_pack_qty = round2(batch.total_stock_units / uPerPack);
        await offlineStorage.put('inventory', batch);
      }
    }

    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: 'CREATE_SALE_RETURN',
      entity: 'sale_returns',
      local_id: clientTxId,
      payload: record,
      created_at: now.toISOString(),
    });
    await this.refreshPendingCount();

    return {
      success: true,
      return_number: returnNo,
      saleReturn: record,
    };
  }

  /**
   * Records an offline Purchase Return into IndexedDB, deducts local stock & updates supplier balance, and queues for sync
   */
  public async queueOfflinePurchaseReturn(payload: any): Promise<{
    success: boolean;
    return_number: string;
    purchaseReturn: any;
  }> {
    const clientTxId = crypto.randomUUID
      ? crypto.randomUUID()
      : `PR-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const allPr = await offlineStorage.getAll<any>('purchase_returns');
    const returnNo =
      payload.return_number || `PR-${now.getFullYear()}-${String(allPr.length + 1).padStart(3, '0')}`;
    const lines = Array.isArray(payload.items) ? payload.items : [];
    const netAmt = round2(payload.net_return_amount || payload.total_amount || 0);

    const record = {
      id: Date.now(),
      ...payload,
      client_tx_id: clientTxId,
      return_number: returnNo,
      return_date: payload.return_date || now.toISOString().slice(0, 10),
      net_return_amount: netAmt,
      items: lines,
      sync_status: 'pending',
      created_at: now.toISOString(),
    };

    await offlineStorage.put('purchase_returns', record);

    const allBatches = await offlineStorage.getAll<any>('inventory');
    for (const line of lines) {
      const itemId = Number(line.item_id || 0);
      if (!itemId) continue;
      const item = await offlineStorage.get<any>('items', itemId);
      const uPerPack = parseLocalUnitsPerPack(line.packing || item?.packing);
      const unitsReturned = Number(
        line.total_units_returned ||
          line.quantity_returned ||
          Number(line.pack_qty || 0) * uPerPack + Number(line.loose_qty || 0)
      );
      if (item && unitsReturned > 0) {
        item.opening_stock = round2(
          Math.max(0, (Number(item.opening_stock) || 0) - unitsReturned / uPerPack)
        );
        await offlineStorage.put('items', item);
      }
      const batch = allBatches.find((b) => Number(b.item_id) === itemId);
      if (batch && unitsReturned > 0) {
        batch.total_stock_units = round2(
          Math.max(0, (Number(batch.total_stock_units) || 0) - unitsReturned)
        );
        batch.current_pack_qty = round2(batch.total_stock_units / uPerPack);
        await offlineStorage.put('inventory', batch);
      }
    }

    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: 'CREATE_PURCHASE_RETURN',
      entity: 'purchase_returns',
      local_id: clientTxId,
      payload: record,
      created_at: now.toISOString(),
    });
    await this.refreshPendingCount();

    return {
      success: true,
      return_number: returnNo,
      purchaseReturn: record,
    };
  }

  /**
   * Records an offline Stock Adjustment into IndexedDB and queues for sync
   */
  public async queueOfflineStockAdjustment(payload: any): Promise<{
    success: boolean;
    adjustment: any;
  }> {
    const clientTxId = crypto.randomUUID
      ? crypto.randomUUID()
      : `ADJ-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const itemId = Number(payload.item_id || 0);
    const record = {
      id: Date.now(),
      ...payload,
      client_tx_id: clientTxId,
      created_at: now.toISOString(),
    };

    await offlineStorage.put('stock_adjustments', record);

    if (itemId > 0) {
      const item = await offlineStorage.get<any>('items', itemId);
      const uPerPack = parseLocalUnitsPerPack(item?.packing);
      const allBatches = await offlineStorage.getAll<any>('inventory');
      const batch =
        allBatches.find((b) => Number(b.id) === Number(payload.batch_id)) ||
        allBatches.find((b) => Number(b.item_id) === itemId);
      if (batch) {
        const totalUnits =
          payload.new_total_units !== undefined
            ? Number(payload.new_total_units)
            : Number(payload.new_pack_quantity || 0) * uPerPack + Number(payload.new_loose_units || 0);
        batch.total_stock_units = totalUnits;
        batch.quantity_in_stock = totalUnits;
        batch.current_pack_qty = round2(totalUnits / uPerPack);
        batch.pack_quantity = Math.floor(totalUnits / uPerPack);
        batch.loose_units = totalUnits % uPerPack;
        await offlineStorage.put('inventory', batch);
      }
      if (item && payload.new_pack_quantity !== undefined) {
        item.opening_stock = Number(payload.new_pack_quantity);
        await offlineStorage.put('items', item);
      }
    }

    await offlineStorage.enqueueSync({
      client_tx_id: clientTxId,
      device_id: this.deviceId,
      action: 'STOCK_ADJUSTMENT',
      entity: 'inventory',
      local_id: clientTxId,
      payload: record,
      created_at: now.toISOString(),
    });
    await this.refreshPendingCount();

    return {
      success: true,
      adjustment: record,
    };
  }

  /**
   * Fast indexed search of items from local IndexedDB (instant search with zero latency!)
   */
  public async searchLocalItems(query = '', limit = 0): Promise<any[]> {
    try {
      const allItems = await offlineStorage.getAll<any>('items');
      const activeItems = allItems.filter(
        (it) => String(it?.status || 'Active').toLowerCase() === 'active'
      );
      if (!query.trim()) {
        activeItems.sort((a, b) =>
          String(a.item_name || '').localeCompare(String(b.item_name || ''))
        );
        return limit > 0 ? activeItems.slice(0, limit) : activeItems;
      }
      const indexed = prepareItemIndex(activeItems);
      const effectiveLimit = limit > 0 ? limit : activeItems.length;
      return searchItems(indexed, query, effectiveLimit);
    } catch {
      return [];
    }
  }

  /**
   * Fast indexed search of accounts from local IndexedDB
   */
  public async searchLocalAccounts(query = '', limit = 0): Promise<any[]> {
    try {
      const allAccounts = await offlineStorage.getAll<any>('accounts');
      allAccounts.sort((a, b) =>
        String(a.account_name || '').localeCompare(String(b.account_name || ''))
      );
      if (!query.trim()) {
        return limit > 0 ? allAccounts.slice(0, limit) : allAccounts;
      }
      const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matched = allAccounts.filter((acc) => {
        const searchCorpus = [
          acc.account_code,
          acc.account_name,
          acc.account_group,
          acc.main_group,
          acc.phone,
          acc.contact_person,
          acc.city,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return tokens.every((token) => searchCorpus.includes(token));
      });
      return limit > 0 ? matched.slice(0, limit) : matched;
    } catch {
      return [];
    }
  }
}

export const offlineSyncManager = new OfflineSyncManager();
