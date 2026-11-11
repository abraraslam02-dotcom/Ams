/**
 * Abrar Medical Store - Offline Synchronization Manager
 * Orchestrates seamless background synchronization between IndexedDB and Server.
 * Supports multiple counters/devices with unique Device IDs and idempotent transactions.
 */

import { offlineStorage } from './offlineStorage';

export type SyncStatusType = 'synced' | 'pending' | 'syncing' | 'failed' | 'offline';

export interface SyncState {
  isOnline: boolean;
  syncStatus: SyncStatusType;
  pendingCount: number;
  lastSyncedAt: string | null;
  deviceId: string;
  counterName: string;
  terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts';
  lastError: string | null;
  justCompletedSync: boolean;
}

type SyncListener = (state: SyncState) => void;

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
  try {
    const token =
      localStorage.getItem('ams_session_token') || sessionStorage.getItem('ams_session_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // ignore storage errors
  }
  return headers;
}

class OfflineSyncManager {
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private syncStatus: SyncStatusType = 'synced';
  private pendingCount = 0;
  private lastSyncedAt: string | null = null;
  private deviceId = 'POS-INITIALIZING';
  private counterName = 'Computer 1: Main Counter';
  private terminalType: 'Main Counter' | 'Second Counter' | 'Office / Accounts' = 'Main Counter';
  private lastError: string | null = null;
  private justCompletedSync = false;
  private listeners: Set<SyncListener> = new Set();
  private syncTimer: any = null;
  private isSyncing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private async init() {
    this.deviceId = await offlineStorage.getOrCreateDeviceId();
    const savedCounterName = await offlineStorage.getMeta('counter_name');
    const savedTerminalType = await offlineStorage.getMeta('terminal_type');
    if (savedCounterName) this.counterName = String(savedCounterName);
    if (savedTerminalType) this.terminalType = savedTerminalType;
    this.lastSyncedAt = await offlineStorage.getMeta('last_synced_at');
    await this.refreshPendingCount();

    // Listen to browser network state
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notify();
      this.syncNow();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.syncStatus = 'offline';
      this.notify();
    });

    // Start background sync timer (every 15 seconds)
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.syncNow();
      }
    }, 15000);

    // Initial sync
    setTimeout(() => {
      this.syncNow();
    }, 600);
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

  public getState(): SyncState {
    return {
      isOnline: this.isOnline,
      syncStatus: !this.isOnline ? 'offline' : this.syncStatus,
      pendingCount: this.pendingCount,
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
      const items = await offlineStorage.getPendingSyncItems();
      this.pendingCount = items.length;
      if (this.pendingCount > 0 && this.syncStatus === 'synced') {
        this.syncStatus = 'pending';
      }
      this.notify();
      return this.pendingCount;
    } catch {
      return 0;
    }
  }

  /**
   * Main sync method: Pushes pending local items to server and pulls latest canonical updates.
   */
  public async syncNow(): Promise<boolean> {
    if (this.isSyncing) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.isOnline = false;
      this.syncStatus = 'offline';
      this.notify();
      return false;
    }

    this.isSyncing = true;
    const hadPendingBefore = this.pendingCount > 0;
    this.syncStatus = 'syncing';
    this.notify();

    try {
      // Register terminal heartbeat with LAN / Cloud server
      fetch('/api/sync/register-terminal', {
        method: 'POST',
        headers: getStoredAuthHeaders(),
        body: JSON.stringify({
          deviceId: this.deviceId,
          counterName: this.counterName,
          terminalType: this.terminalType,
        }),
      }).catch(() => {});

      // Step 1: Push any pending offline transactions in chronological order
      const pendingItems = await offlineStorage.getPendingSyncItems();
      if (pendingItems.length > 0) {
        const res = await fetch('/api/sync/push', {
          method: 'POST',
          headers: getStoredAuthHeaders(),
          body: JSON.stringify({
            deviceId: this.deviceId,
            counterName: this.counterName,
            items: pendingItems,
          }),
        });

        if (!res.ok) {
          throw new Error(`Push failed with HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.success && Array.isArray(data.results)) {
          for (const resItem of data.results) {
            await offlineStorage.updateSyncItemStatus(resItem.client_tx_id, resItem.status, {
              server_id: resItem.server_id,
              server_invoice_number: resItem.invoice_number,
              error: resItem.error,
            });
          }
        }
      }

      // Step 2: Pull latest items, accounts, inventory, sales, purchases, cash_book, settings to IndexedDB
      const pullRes = await fetch(
        `/api/sync/pull?device_id=${encodeURIComponent(this.deviceId)}&counter_name=${encodeURIComponent(this.counterName)}`,
        { headers: getStoredAuthHeaders() }
      );
      if (!pullRes.ok) {
        throw new Error(`Pull failed with HTTP ${pullRes.status}`);
      }

      const pullData = await pullRes.json();
      if (pullData.success) {
        if (Array.isArray(pullData.items) && pullData.items.length > 0) {
          await offlineStorage.bulkPut('items', pullData.items);
        }
        if (Array.isArray(pullData.accounts) && pullData.accounts.length > 0) {
          await offlineStorage.bulkPut('accounts', pullData.accounts);
        }
        if (Array.isArray(pullData.inventory) && pullData.inventory.length > 0) {
          await offlineStorage.bulkPut('inventory', pullData.inventory);
        }
        if (Array.isArray(pullData.sales) && pullData.sales.length > 0) {
          await offlineStorage.bulkPut('sales', pullData.sales);
        }
        if (Array.isArray(pullData.purchases) && pullData.purchases.length > 0) {
          await offlineStorage.bulkPut('purchases', pullData.purchases);
        }
        if (Array.isArray(pullData.cashBookVouchers) && pullData.cashBookVouchers.length > 0) {
          await offlineStorage.bulkPut('cash_book', pullData.cashBookVouchers);
        }
        if (pullData.companySettings) {
          await offlineStorage.put('company_settings', pullData.companySettings);
        }
        if (pullData.advanceTaxSettings) {
          await offlineStorage.cacheApiData('advance_tax_settings', pullData.advanceTaxSettings);
        }
      }

      const now = new Date().toISOString();
      this.lastSyncedAt = now;
      await offlineStorage.setMeta('last_synced_at', now);
      await this.refreshPendingCount();

      this.isOnline = true;
      this.syncStatus = this.pendingCount === 0 ? 'synced' : 'pending';
      this.lastError = null;
      if (hadPendingBefore && this.pendingCount === 0) {
        this.justCompletedSync = true;
        setTimeout(() => {
          this.justCompletedSync = false;
          this.notify();
        }, 8000);
      }
      this.notify();
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('NetworkError') ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        this.isOnline = false;
        this.syncStatus = 'offline';
      } else {
        this.lastError = errorMsg;
        this.syncStatus = 'failed';
      }
      this.notify();
      return false;
    } finally {
      this.isSyncing = false;
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

    const fullSale = {
      id: Date.now(),
      ...payload,
      items: rawLines,
      lines: rawLines,
      item_count: rawLines.length,
      client_tx_id: clientTxId,
      client_request_id: clientTxId,
      invoice_number: localInvNo,
      invoice_date: payload.invoice_date || now.toISOString().slice(0, 10),
      status: isHeldOrDraft ? 'held' : 'completed',
      sync_status: 'pending',
      created_at: now.toISOString(),
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
   * Fast indexed search of items from local IndexedDB (instant search with zero latency!)
   */
  public async searchLocalItems(query = '', limit = 50): Promise<any[]> {
    try {
      const allItems = await offlineStorage.getAll<any>('items');
      if (!query.trim()) {
        return allItems.slice(0, limit);
      }
      const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return allItems
        .filter((item) => {
          const searchCorpus = [
            item.item_code,
            item.barcode,
            item.item_name,
            item.generic_name,
            item.company_name,
            item.category,
            item.packing,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return tokens.every((token) => searchCorpus.includes(token));
        })
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Fast indexed search of accounts from local IndexedDB
   */
  public async searchLocalAccounts(query = '', limit = 50): Promise<any[]> {
    try {
      const allAccounts = await offlineStorage.getAll<any>('accounts');
      if (!query.trim()) {
        return allAccounts.slice(0, limit);
      }
      const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return allAccounts
        .filter((acc) => {
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
        })
        .slice(0, limit);
    } catch {
      return [];
    }
  }
}

export const offlineSyncManager = new OfflineSyncManager();
