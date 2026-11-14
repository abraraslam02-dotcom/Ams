/**
 * Abrar Medical Store - Firestore Cloud Persistence & Sync Service
 *
 * Implements reliable bidirectional synchronization between local IndexedDB and Firebase Firestore:
 * - Connects strictly to the configured Firestore database (`items`, `invoices`, `test/connection`)
 * - Never deletes local or cloud records during synchronization
 * - Prevents stale local data from overwriting newer cloud records via getDocFromServer timestamp checks
 * - Verifies every Firestore write via getDocFromServer before marking records as 'synced'
 * - Logs structured diagnostic errors to IndexedDB `sync_error_logs` and via `handleFirestoreError`
 */

import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
  FirestoreConnectionState,
} from '../lib/firebase';
import { offlineStorage } from './offlineStorage';

export const FIRESTORE_SYNC_KEY = 'ams_erp_cloud_sync_v2_2026';

export type RecordSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncOperationResult {
  success: boolean;
  cloudDocId: string;
  status: RecordSyncStatus;
  verifiedAt?: string;
  action?: 'created' | 'updated' | 'kept_newer_cloud';
  error?: string;
}

export interface BatchSyncSummary {
  connected: boolean;
  pushedItems: number;
  pushedInvoices: number;
  pulledItems: number;
  pulledInvoices: number;
  failedCount: number;
  errors: string[];
}

function sanitizeIdPart(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned || fallback;
  return base.slice(0, 110);
}

export function getItemCloudDocId(item: any): string {
  if (
    item?.cloud_doc_id &&
    typeof item.cloud_doc_id === 'string' &&
    /^[a-zA-Z0-9_\-]{1,128}$/.test(item.cloud_doc_id)
  ) {
    return item.cloud_doc_id;
  }
  const suffix = sanitizeIdPart(item?.item_code || item?.id, `LOCAL_${Date.now()}`);
  return `ITEM_${suffix}`.slice(0, 128);
}

export function getInvoiceCloudDocId(sale: any): string {
  if (
    sale?.cloud_doc_id &&
    typeof sale.cloud_doc_id === 'string' &&
    /^[a-zA-Z0-9_\-]{1,128}$/.test(sale.cloud_doc_id)
  ) {
    return sale.cloud_doc_id;
  }
  const suffix = sanitizeIdPart(
    sale?.client_tx_id || sale?.client_request_id || sale?.invoice_number || sale?.id,
    `LOCAL_${Date.now()}`
  );
  return `INV_${suffix}`.slice(0, 128);
}

export function toUtcIsoTimestamp(val?: unknown, fallbackNow?: string): string {
  const fallback = fallbackNow || new Date().toISOString();
  if (!val) return fallback;
  const raw = String(val).trim();
  if (!raw) return fallback;
  // Handle SQLite 'YYYY-MM-DD HH:MM:SS' format cleanly as UTC ISO
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function finiteNum(val: unknown, defaultVal = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 10000) / 10000 : defaultVal;
}

function clampStr(val: unknown, maxLen: number): string | undefined {
  if (val === null || val === undefined) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  return s.slice(0, maxLen);
}

function normalizeRecordSyncStatus(rawStatus: unknown): RecordSyncStatus | undefined {
  const s = String(rawStatus || '').toLowerCase();
  if (s === 'synced') return 'synced';
  if (s === 'syncing') return 'syncing';
  if (s === 'failed') return 'failed';
  if (s === 'pending' || s === 'pending_sync') return 'pending';
  return undefined;
}

function isPermissionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('permission') || msg.includes('permission_denied');
}

function extractErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') {
    return (err as any).code;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('permission')) return 'permission-denied';
  if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('network')) {
    return 'unavailable';
  }
  return 'sync-error';
}

function buildFirestoreItemPayload(
  item: any,
  cloudDocId: string,
  deviceId: string,
  createdAt: string,
  updatedAt: string
): Record<string, any> {
  const statusVal = String(item?.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  const itemCode = String(item?.item_code || `MED-${item?.id || Date.now()}`)
    .trim()
    .slice(0, 64);
  const itemName = String(item?.item_name || itemCode || 'Unnamed Item')
    .trim()
    .slice(0, 200);

  const payload: Record<string, any> = {
    syncKey: FIRESTORE_SYNC_KEY,
    cloudDocId,
    item_code: itemCode,
    item_name: itemName,
    status: statusVal,
    createdAt,
    updatedAt,
  };

  if (typeof item?.id === 'number' && Number.isFinite(item.id) && item.id > 0) {
    payload.localId = item.id;
  }
  const serverId = Number(item?.server_id ?? item?.id);
  if (Number.isFinite(serverId) && serverId > 0 && serverId < 1_000_000_000_000) {
    payload.serverId = serverId;
  }

  const companyName = clampStr(item?.company_name, 120);
  if (companyName !== undefined) payload.company_name = companyName;
  const genericName = clampStr(item?.generic_name, 200);
  if (genericName !== undefined) payload.generic_name = genericName;
  const category = clampStr(item?.category, 80);
  if (category !== undefined) payload.category = category;
  const packing = clampStr(item?.packing, 60);
  if (packing !== undefined) payload.packing = packing;
  const barcode = clampStr(item?.barcode, 80);
  if (barcode !== undefined) payload.barcode = barcode;
  const rackNumber = clampStr(item?.rack_number ?? item?.rack_location, 60);
  if (rackNumber !== undefined) payload.rack_number = rackNumber;
  const devStr = clampStr(deviceId, 80);
  if (devStr !== undefined) payload.deviceId = devStr;

  payload.purchase_price = finiteNum(item?.purchase_price, 0);
  payload.trade_price = finiteNum(item?.trade_price, 0);
  payload.wholesale_price = finiteNum(item?.wholesale_price, 0);
  payload.retail_price = finiteNum(item?.retail_price, 0);
  payload.loose_rate = finiteNum(item?.loose_rate, 0);
  payload.discount_percent = finiteNum(item?.discount_percent, 0);
  payload.tax_percent = finiteNum(item?.tax_percent, 0);
  payload.opening_stock = finiteNum(item?.opening_stock ?? item?.current_stock, 0);
  payload.minimum_stock = finiteNum(item?.minimum_stock ?? item?.reorder_level, 10);

  return payload;
}

function sanitizeLineItems(rawItems: any): Array<Record<string, any>> {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 500).map((ln) => {
    const clean: Record<string, any> = {};
    if (ln?.item_id !== undefined && ln?.item_id !== null) clean.item_id = Number(ln.item_id) || 0;
    if (ln?.item_code) clean.item_code = String(ln.item_code).slice(0, 64);
    if (ln?.item_name) clean.item_name = String(ln.item_name).slice(0, 200);
    if (ln?.packing) clean.packing = String(ln.packing).slice(0, 60);
    if (ln?.batch_number) clean.batch_number = String(ln.batch_number).slice(0, 64);
    if (ln?.expiry_date) clean.expiry_date = String(ln.expiry_date).slice(0, 32);
    clean.quantity = finiteNum(ln?.quantity ?? ln?.packs_quantity, 0);
    clean.bonus_quantity = finiteNum(ln?.bonus_quantity, 0);
    clean.loose_quantity = finiteNum(ln?.loose_quantity, 0);
    clean.unit_price = finiteNum(ln?.unit_price, 0);
    clean.loose_rate = finiteNum(ln?.loose_rate, 0);
    clean.discount_percent = finiteNum(ln?.discount_percent, 0);
    clean.discount_amount = finiteNum(ln?.discount_amount, 0);
    clean.tax_percent = finiteNum(ln?.tax_percent, 0);
    clean.tax_amount = finiteNum(ln?.tax_amount, 0);
    clean.line_total = finiteNum(ln?.line_total, 0);
    return clean;
  });
}

function buildFirestoreInvoicePayload(
  sale: any,
  cloudDocId: string,
  deviceId: string,
  createdAt: string,
  updatedAt: string
): Record<string, any> {
  const allowedStatuses = new Set([
    'completed',
    'held',
    'draft',
    'cancelled',
    'Completed',
    'Held',
    'Draft',
    'Cancelled',
  ]);
  const rawStatus = String(sale?.status || 'completed').trim();
  const statusVal = allowedStatuses.has(rawStatus) ? rawStatus : 'completed';

  const clientTxId = String(
    sale?.client_tx_id || sale?.client_request_id || sale?.invoice_number || cloudDocId
  )
    .trim()
    .slice(0, 128);
  const invoiceNumber = String(sale?.invoice_number || clientTxId)
    .trim()
    .slice(0, 64);

  const lines = sanitizeLineItems(
    Array.isArray(sale?.items) ? sale.items : Array.isArray(sale?.lines) ? sale.lines : []
  );

  const payload: Record<string, any> = {
    syncKey: FIRESTORE_SYNC_KEY,
    cloudDocId,
    clientTxId,
    invoice_number: invoiceNumber,
    net_total: finiteNum(sale?.net_total ?? sale?.total_amount, 0),
    status: statusVal,
    items: lines,
    item_count: lines.length || finiteNum(sale?.item_count, 0),
    createdAt,
    updatedAt,
  };

  if (typeof sale?.id === 'number' && Number.isFinite(sale.id) && sale.id > 0 && sale.id < 1_000_000_000_000) {
    payload.localId = sale.id;
  }
  const serverId = Number(sale?.server_id ?? sale?.id);
  if (Number.isFinite(serverId) && serverId > 0 && serverId < 1_000_000_000_000) {
    payload.serverId = serverId;
  }

  const invoiceDate = clampStr(sale?.invoice_date ?? sale?.sale_date, 32);
  if (invoiceDate !== undefined) payload.invoice_date = invoiceDate;
  if (sale?.customer_account_id !== undefined && sale?.customer_account_id !== null && Number.isFinite(Number(sale.customer_account_id))) {
    payload.customer_account_id = Number(sale.customer_account_id);
  }
  const customerName = clampStr(sale?.customer_name, 160);
  if (customerName !== undefined) payload.customer_name = customerName;
  const filerStatus = clampStr(sale?.customer_filer_status, 32);
  if (filerStatus !== undefined) payload.customer_filer_status = filerStatus;
  const salesman = clampStr(sale?.salesman, 120);
  if (salesman !== undefined) payload.salesman = salesman;
  const invoiceType = clampStr(sale?.invoice_type, 40);
  if (invoiceType !== undefined) payload.invoice_type = invoiceType;
  const paymentMode = clampStr(sale?.payment_mode, 40);
  if (paymentMode !== undefined) payload.payment_mode = paymentMode;
  const remarks = clampStr(sale?.remarks, 500);
  if (remarks !== undefined) payload.remarks = remarks;
  const devStr = clampStr(deviceId, 80);
  if (devStr !== undefined) payload.deviceId = devStr;

  payload.gross_total = finiteNum(sale?.gross_total ?? sale?.subtotal_gross, 0);
  payload.discount_total = finiteNum(sale?.discount_total ?? sale?.discount_amount ?? sale?.total_discount, 0);
  payload.tax_total = finiteNum(sale?.tax_total ?? sale?.tax_amount ?? sale?.total_tax, 0);
  payload.paid_amount = finiteNum(sale?.paid_amount ?? sale?.received_amount, 0);
  payload.balance_amount = finiteNum(sale?.balance_amount ?? sale?.balance_due, 0);

  return payload;
}

class FirestoreSyncService {
  private notifyListenersCallback: (() => void) | null = null;

  public setOnRecordStatusChange(cb: () => void) {
    this.notifyListenersCallback = cb;
  }

  private emitChange() {
    try {
      this.notifyListenersCallback?.();
    } catch {
      // ignore
    }
  }

  public async verifyConnection(): Promise<FirestoreConnectionState> {
    return testFirestoreConnection();
  }

  private async logSyncError(params: {
    entity: 'items' | 'invoices' | 'connection' | 'sync';
    recordKey: string;
    cloudDocId?: string;
    operation: string;
    error: unknown;
    path: string;
  }): Promise<string> {
    const code = extractErrorCode(params.error);
    const rawMsg =
      params.error instanceof Error ? params.error.message : String(params.error);
    await offlineStorage.addSyncErrorLog({
      entity: params.entity,
      record_key: params.recordKey,
      cloud_doc_id: params.cloudDocId,
      operation: params.operation,
      code,
      message: rawMsg,
      details: `Path: ${params.path} | Code: ${code}`,
    });
    return rawMsg;
  }

  /**
   * Synchronizes a single Medicine Item to Firestore with strict conflict checking
   * and server read-back verification before marking local IndexedDB as 'synced'.
   */
  public async syncItemToFirestore(
    item: any,
    deviceId: string,
    options?: { prefetchedRemote?: Record<string, any> | null; skipUiEmit?: boolean }
  ): Promise<SyncOperationResult> {
    const cloudDocId = getItemCloudDocId(item);
    const docPath = `items/${cloudDocId}`;
    const docRef = doc(db, 'items', cloudDocId);
    const nowIso = new Date().toISOString();

    // Step 1: Mark local item as 'syncing'
    if (item?.id !== undefined && item?.id !== null && !options?.skipUiEmit) {
      await offlineStorage
        .put('items', {
          ...item,
          cloud_doc_id: cloudDocId,
          sync_status: 'syncing',
          sync_error: null,
        })
        .catch(() => {});
      this.emitChange();
    }

    try {
      // Step 2: Check existing Firestore server document to prevent stale local overwrite & preserve createdAt
      let existingData: Record<string, any> | null = null;
      if (options && options.prefetchedRemote !== undefined) {
        existingData = options.prefetchedRemote;
      } else {
        try {
          const existingSnap = await getDocFromServer(docRef);
          existingData = existingSnap.exists() ? existingSnap.data() : null;
        } catch (err) {
          if (isPermissionError(err)) {
            handleFirestoreError(err, OperationType.GET, docPath);
          }
          throw err;
        }
      }

      const localCreatedAt = toUtcIsoTimestamp(item?.created_at, nowIso);
      const localUpdatedAt = toUtcIsoTimestamp(item?.updated_at ?? item?.created_at, nowIso);

      if (existingData) {
        const remote = existingData;
        const remoteUpdatedAt = toUtcIsoTimestamp(remote?.updatedAt, '');
        if (
          remoteUpdatedAt &&
          (remoteUpdatedAt > localUpdatedAt || (remoteUpdatedAt >= localUpdatedAt && !item?.local_modified))
        ) {
          // Never overwrite newer or already-matching cloud data; reconcile local IndexedDB as verified
          const mergedLocal = {
            ...item,
            item_code: remote.item_code ?? item.item_code,
            item_name: remote.item_name ?? item.item_name,
            company_name: remote.company_name ?? item.company_name ?? '',
            generic_name: remote.generic_name ?? item.generic_name ?? '',
            category: remote.category ?? item.category ?? 'Medicine',
            packing: remote.packing ?? item.packing ?? '1x1',
            barcode: remote.barcode ?? item.barcode ?? '',
            purchase_price: remote.purchase_price ?? item.purchase_price ?? 0,
            trade_price: remote.trade_price ?? item.trade_price ?? 0,
            wholesale_price: remote.wholesale_price ?? item.wholesale_price ?? 0,
            retail_price: remote.retail_price ?? item.retail_price ?? 0,
            loose_rate: remote.loose_rate ?? item.loose_rate ?? 0,
            discount_percent: remote.discount_percent ?? item.discount_percent ?? 0,
            tax_percent: remote.tax_percent ?? item.tax_percent ?? 0,
            opening_stock: remote.opening_stock ?? item.opening_stock ?? 0,
            minimum_stock: remote.minimum_stock ?? item.minimum_stock ?? 10,
            rack_number: remote.rack_number ?? item.rack_number ?? '',
            status: remote.status ?? item.status ?? 'Active',
            created_at: remote.createdAt ?? item.created_at ?? localCreatedAt,
            updated_at: remoteUpdatedAt,
            cloud_doc_id: cloudDocId,
            cloud_synced_at: nowIso,
            sync_status: 'synced' as const,
            local_modified: false,
            sync_error: null,
          };
          if (mergedLocal.id !== undefined) {
            await offlineStorage.put('items', mergedLocal);
          }
          if (!options?.skipUiEmit) this.emitChange();
          return {
            success: true,
            cloudDocId,
            status: 'synced',
            verifiedAt: nowIso,
            action: 'kept_newer_cloud',
          };
        }
      }

      const createdAt = existingData
        ? toUtcIsoTimestamp(existingData?.createdAt, localCreatedAt)
        : localCreatedAt;
      const updatedAt = existingData
        ? localUpdatedAt >= toUtcIsoTimestamp(existingData?.updatedAt, localUpdatedAt)
          ? localUpdatedAt
          : nowIso
        : localUpdatedAt;

      const payload = buildFirestoreItemPayload(item, cloudDocId, deviceId, createdAt, updatedAt);

      // Step 3: Write to Firestore
      try {
        await setDoc(docRef, payload);
      } catch (err) {
        if (isPermissionError(err)) {
          handleFirestoreError(
            err,
            existingData ? OperationType.UPDATE : OperationType.CREATE,
            docPath
          );
        }
        throw err;
      }

      // Step 4: Verify successful write directly from Firestore server before marking Synced
      const verifySnap = await getDocFromServer(docRef);
      if (!verifySnap.exists() || verifySnap.data()?.updatedAt !== payload.updatedAt) {
        throw new Error(
          `Firestore write verification failed for ${docPath}: server read-back mismatch`
        );
      }

      const verifiedAt = new Date().toISOString();
      if (item?.id !== undefined && item?.id !== null) {
        await offlineStorage.put('items', {
          ...item,
          cloud_doc_id: cloudDocId,
          cloud_synced_at: verifiedAt,
          updated_at: payload.updatedAt,
          created_at: payload.createdAt,
          sync_status: 'synced',
          local_modified: false,
          sync_error: null,
        });
      }
      if (!options?.skipUiEmit) this.emitChange();

      return {
        success: true,
        cloudDocId,
        status: 'synced',
        verifiedAt,
        action: existingData ? 'updated' : 'created',
      };
    } catch (error) {
      const msg = await this.logSyncError({
        entity: 'items',
        recordKey: String(item?.id ?? item?.item_code ?? cloudDocId),
        cloudDocId,
        operation: 'syncItemToFirestore',
        error,
        path: docPath,
      });

      const isOffline =
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        msg.toLowerCase().includes('client is offline') ||
        msg.toLowerCase().includes('unavailable');

      const nextStatus: RecordSyncStatus = isOffline ? 'pending' : 'failed';
      if (item?.id !== undefined && item?.id !== null) {
        await offlineStorage
          .put('items', {
            ...item,
            cloud_doc_id: cloudDocId,
            sync_status: nextStatus,
            sync_error: msg,
          })
          .catch(() => {});
      }
      this.emitChange();

      return {
        success: false,
        cloudDocId,
        status: nextStatus,
        error: msg,
      };
    }
  }

  /**
   * Synchronizes a single Sales Invoice to Firestore with strict conflict checking
   * and server read-back verification before marking local IndexedDB as 'synced'.
   */
  public async syncInvoiceToFirestore(sale: any, deviceId: string): Promise<SyncOperationResult> {
    const cloudDocId = getInvoiceCloudDocId(sale);
    const docPath = `invoices/${cloudDocId}`;
    const docRef = doc(db, 'invoices', cloudDocId);
    const nowIso = new Date().toISOString();
    const clientTxKey = String(
      sale?.client_tx_id || sale?.client_request_id || `SRV-SALE-${sale?.id || Date.now()}`
    );

    const baseLocalRecord = {
      ...sale,
      client_tx_id: clientTxKey,
      cloud_doc_id: cloudDocId,
    };

    // Step 1: Mark local invoice as 'syncing'
    await offlineStorage
      .put('sales', {
        ...baseLocalRecord,
        sync_status: 'syncing',
        sync_error: null,
      })
      .catch(() => {});
    this.emitChange();

    try {
      // Step 2: Check existing cloud doc to prevent overwriting newer cloud state & preserve createdAt
      let existingSnap;
      try {
        existingSnap = await getDocFromServer(docRef);
      } catch (err) {
        if (isPermissionError(err)) {
          handleFirestoreError(err, OperationType.GET, docPath);
        }
        throw err;
      }

      const localCreatedAt = toUtcIsoTimestamp(sale?.created_at, nowIso);
      const localUpdatedAt = toUtcIsoTimestamp(sale?.updated_at ?? sale?.created_at, nowIso);

      if (existingSnap.exists()) {
        const remote = existingSnap.data();
        const remoteUpdatedAt = toUtcIsoTimestamp(remote?.updatedAt, '');
        if (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt) {
          await offlineStorage.put('sales', {
            ...baseLocalRecord,
            invoice_number: remote.invoice_number ?? baseLocalRecord.invoice_number,
            invoice_date: remote.invoice_date ?? baseLocalRecord.invoice_date,
            customer_account_id: remote.customer_account_id ?? baseLocalRecord.customer_account_id,
            customer_name: remote.customer_name ?? baseLocalRecord.customer_name,
            salesman: remote.salesman ?? baseLocalRecord.salesman,
            invoice_type: remote.invoice_type ?? baseLocalRecord.invoice_type,
            payment_mode: remote.payment_mode ?? baseLocalRecord.payment_mode,
            gross_total: remote.gross_total ?? baseLocalRecord.gross_total,
            discount_total: remote.discount_total ?? baseLocalRecord.discount_total,
            discount_amount: remote.discount_total ?? baseLocalRecord.discount_amount,
            tax_total: remote.tax_total ?? baseLocalRecord.tax_total,
            tax_amount: remote.tax_total ?? baseLocalRecord.tax_amount,
            net_total: remote.net_total ?? baseLocalRecord.net_total,
            paid_amount: remote.paid_amount ?? baseLocalRecord.paid_amount,
            balance_amount: remote.balance_amount ?? baseLocalRecord.balance_amount,
            status: remote.status ?? baseLocalRecord.status,
            items: Array.isArray(remote.items) ? remote.items : baseLocalRecord.items,
            updated_at: remoteUpdatedAt,
            cloud_synced_at: nowIso,
            sync_status: 'synced',
            local_modified: false,
            sync_error: null,
          });
          this.emitChange();
          return {
            success: true,
            cloudDocId,
            status: 'synced',
            verifiedAt: nowIso,
            action: 'kept_newer_cloud',
          };
        }
      }

      const createdAt = existingSnap.exists()
        ? toUtcIsoTimestamp(existingSnap.data()?.createdAt, localCreatedAt)
        : localCreatedAt;
      const updatedAt = existingSnap.exists()
        ? localUpdatedAt >= toUtcIsoTimestamp(existingSnap.data()?.updatedAt, localUpdatedAt)
          ? localUpdatedAt
          : nowIso
        : localUpdatedAt;

      const payload = buildFirestoreInvoicePayload(
        baseLocalRecord,
        cloudDocId,
        deviceId,
        createdAt,
        updatedAt
      );

      // Step 3: Write to Firestore
      try {
        await setDoc(docRef, payload);
      } catch (err) {
        if (isPermissionError(err)) {
          handleFirestoreError(
            err,
            existingSnap.exists() ? OperationType.UPDATE : OperationType.CREATE,
            docPath
          );
        }
        throw err;
      }

      // Step 4: Verify successful write from Firestore server before marking Synced
      const verifySnap = await getDocFromServer(docRef);
      if (!verifySnap.exists() || verifySnap.data()?.updatedAt !== payload.updatedAt) {
        throw new Error(
          `Firestore write verification failed for ${docPath}: server read-back mismatch`
        );
      }

      const verifiedAt = new Date().toISOString();
      await offlineStorage.put('sales', {
        ...baseLocalRecord,
        cloud_synced_at: verifiedAt,
        updated_at: payload.updatedAt,
        created_at: payload.createdAt,
        sync_status: 'synced',
        local_modified: false,
        sync_error: null,
      });
      this.emitChange();

      return {
        success: true,
        cloudDocId,
        status: 'synced',
        verifiedAt,
        action: existingSnap.exists() ? 'updated' : 'created',
      };
    } catch (error) {
      const msg = await this.logSyncError({
        entity: 'invoices',
        recordKey: clientTxKey,
        cloudDocId,
        operation: 'syncInvoiceToFirestore',
        error,
        path: docPath,
      });

      const isOffline =
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        msg.toLowerCase().includes('client is offline') ||
        msg.toLowerCase().includes('unavailable');

      const nextStatus: RecordSyncStatus = isOffline ? 'pending' : 'failed';
      await offlineStorage
        .put('sales', {
          ...baseLocalRecord,
          sync_status: nextStatus,
          sync_error: msg,
        })
        .catch(() => {});
      this.emitChange();

      return {
        success: false,
        cloudDocId,
        status: nextStatus,
        error: msg,
      };
    }
  }

  /**
   * Pushes all local Items and Invoices that are pending, failed, or not yet cloud-synced to Firestore.
   */
  public async pushPendingToFirestore(
    deviceId: string,
    options: { includeFailed?: boolean; includeUnsyncedCatalog?: boolean } = {}
  ): Promise<{
    pushedItems: number;
    pushedInvoices: number;
    failedCount: number;
    errors: string[];
  }> {
    let pushedItems = 0;
    let pushedInvoices = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const [localItems, localSales] = await Promise.all([
      offlineStorage.getAll<any>('items'),
      offlineStorage.getAll<any>('sales'),
    ]);

    const itemsToSync = localItems.filter((it) => {
      const st = normalizeRecordSyncStatus(it?.sync_status);
      if (st === 'pending' || st === 'syncing') return true;
      if (options.includeFailed && st === 'failed') return true;
      if (options.includeUnsyncedCatalog && !it?.cloud_synced_at) return true;
      return false;
    });

    if (itemsToSync.length > 0) {
      // Pre-fetch existing cloud items in 1 query when syncing multiple items to cut roundtrips & latency
      const remoteItemMap = new Map<string, Record<string, any>>();
      let prefetchedItemsAvailable = false;
      try {
        const snap = await getDocsFromServer(
          query(collection(db, 'items'), where('syncKey', '==', FIRESTORE_SYNC_KEY))
        );
        snap.forEach((d) => remoteItemMap.set(d.id, d.data()));
        prefetchedItemsAvailable = true;
      } catch {
        // Fallback to per-item getDocFromServer if batch list fails
      }

      const CONCURRENCY = 6;
      for (let i = 0; i < itemsToSync.length; i += CONCURRENCY) {
        const batch = itemsToSync.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((item) => {
            const docId = getItemCloudDocId(item);
            return this.syncItemToFirestore(item, deviceId, {
              prefetchedRemote: prefetchedItemsAvailable
                ? remoteItemMap.get(docId) ?? null
                : undefined,
              skipUiEmit: true,
            });
          })
        );
        for (let j = 0; j < batchResults.length; j++) {
          const res = batchResults[j];
          if (res.success) {
            pushedItems++;
          } else {
            failedCount++;
            if (res.error) {
              errors.push(`Item ${batch[j].item_code || batch[j].id}: ${res.error}`);
            }
          }
        }
        this.emitChange();
      }
    }

    const salesToSync = localSales.filter((s) => {
      const st = normalizeRecordSyncStatus(s?.sync_status);
      if (st === 'pending' || st === 'syncing') return true;
      if (options.includeFailed && st === 'failed') return true;
      if (options.includeUnsyncedCatalog && !s?.cloud_synced_at) return true;
      return false;
    });

    for (const sale of salesToSync) {
      const res = await this.syncInvoiceToFirestore(sale, deviceId);
      if (res.success) {
        pushedInvoices++;
      } else {
        failedCount++;
        if (res.error) errors.push(`Invoice ${sale.invoice_number || sale.client_tx_id}: ${res.error}`);
      }
    }

    return { pushedItems, pushedInvoices, failedCount, errors };
  }

  /**
   * Non-destructively pulls Items from Firestore and merges into IndexedDB without
   * overwriting unsynced local records or deleting any records.
   */
  public async pullItemsFromFirestore(): Promise<number> {
    const path = 'items';
    try {
      const q = query(collection(db, path), where('syncKey', '==', FIRESTORE_SYNC_KEY));
      const snap = await getDocsFromServer(q);
      if (snap.empty) return 0;

      const localItems = await offlineStorage.getAll<any>('items');
      const byCloudId = new Map<string, any>();
      const byCode = new Map<string, any>();
      let maxId = 0;

      for (const loc of localItems) {
        const lid = Number(loc?.id || 0);
        if (lid > maxId) maxId = lid;
        if (loc?.cloud_doc_id) byCloudId.set(String(loc.cloud_doc_id), loc);
        if (loc?.item_code) byCode.set(String(loc.item_code).toLowerCase(), loc);
      }

      const toPut: any[] = [];
      const nowIso = new Date().toISOString();

      for (const d of snap.docs) {
        const remote = d.data();
        const existing =
          byCloudId.get(d.id) ||
          byCode.get(String(remote.item_code || '').toLowerCase());

        if (existing) {
          const st = normalizeRecordSyncStatus(existing.sync_status);
          if (st === 'pending' || st === 'syncing' || st === 'failed') {
            continue;
          }
          const localTs = toUtcIsoTimestamp(existing.updated_at || existing.created_at, '');
          const remoteTs = toUtcIsoTimestamp(remote.updatedAt, '');
          if (localTs && remoteTs && localTs > remoteTs && existing.local_modified) {
            continue;
          }
          if (remoteTs && localTs && remoteTs <= localTs && existing.cloud_synced_at) {
            continue;
          }
          toPut.push({
            ...existing,
            item_code: remote.item_code ?? existing.item_code,
            item_name: remote.item_name ?? existing.item_name,
            company_name: remote.company_name ?? existing.company_name ?? '',
            generic_name: remote.generic_name ?? existing.generic_name ?? '',
            category: remote.category ?? existing.category ?? 'Medicine',
            packing: remote.packing ?? existing.packing ?? '1x1',
            barcode: remote.barcode ?? existing.barcode ?? '',
            purchase_price: remote.purchase_price ?? existing.purchase_price ?? 0,
            trade_price: remote.trade_price ?? existing.trade_price ?? 0,
            wholesale_price: remote.wholesale_price ?? existing.wholesale_price ?? 0,
            retail_price: remote.retail_price ?? existing.retail_price ?? 0,
            loose_rate: remote.loose_rate ?? existing.loose_rate ?? 0,
            discount_percent: remote.discount_percent ?? existing.discount_percent ?? 0,
            tax_percent: remote.tax_percent ?? existing.tax_percent ?? 0,
            opening_stock: remote.opening_stock ?? existing.opening_stock ?? 0,
            minimum_stock: remote.minimum_stock ?? existing.minimum_stock ?? 10,
            rack_number: remote.rack_number ?? existing.rack_number ?? '',
            status: remote.status ?? existing.status ?? 'Active',
            created_at: remote.createdAt ?? existing.created_at,
            updated_at: remote.updatedAt ?? existing.updated_at,
            cloud_doc_id: d.id,
            cloud_synced_at: nowIso,
            sync_status: 'synced',
            local_modified: false,
            sync_error: null,
          });
        } else {
          maxId += 1;
          const assignedId =
            typeof remote.serverId === 'number' && remote.serverId > 0
              ? remote.serverId
              : typeof remote.localId === 'number' && remote.localId > 0
              ? remote.localId
              : maxId;
          if (assignedId > maxId) maxId = assignedId;

          toPut.push({
            id: assignedId,
            item_code: remote.item_code,
            item_name: remote.item_name,
            company_name: remote.company_name || '',
            generic_name: remote.generic_name || '',
            category: remote.category || 'Medicine',
            packing: remote.packing || '1x1',
            barcode: remote.barcode || '',
            purchase_price: remote.purchase_price ?? 0,
            trade_price: remote.trade_price ?? 0,
            wholesale_price: remote.wholesale_price ?? 0,
            retail_price: remote.retail_price ?? 0,
            loose_rate: remote.loose_rate ?? 0,
            discount_percent: remote.discount_percent ?? 0,
            tax_percent: remote.tax_percent ?? 0,
            opening_stock: remote.opening_stock ?? 0,
            minimum_stock: remote.minimum_stock ?? 10,
            rack_number: remote.rack_number || '',
            status: remote.status || 'Active',
            created_at: remote.createdAt || nowIso,
            updated_at: remote.updatedAt || nowIso,
            cloud_doc_id: d.id,
            cloud_synced_at: nowIso,
            sync_status: 'synced',
            local_modified: false,
            sync_error: null,
          });
        }
      }

      if (toPut.length > 0) {
        await offlineStorage.bulkPut('items', toPut);
        this.emitChange();
      }
      return toPut.length;
    } catch (error) {
      await this.logSyncError({
        entity: 'items',
        recordKey: 'collection',
        operation: 'pullItemsFromFirestore',
        error,
        path,
      });
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      throw error;
    }
  }

  /**
   * Non-destructively pulls Invoices from Firestore and merges into IndexedDB without
   * overwriting unsynced local records or deleting any records.
   */
  public async pullInvoicesFromFirestore(): Promise<number> {
    const path = 'invoices';
    try {
      const q = query(collection(db, path), where('syncKey', '==', FIRESTORE_SYNC_KEY));
      const snap = await getDocsFromServer(q);
      if (snap.empty) return 0;

      const localSales = await offlineStorage.getAll<any>('sales');
      const byTxId = new Map<string, any>();
      const byCloudId = new Map<string, any>();

      for (const loc of localSales) {
        if (loc?.client_tx_id) byTxId.set(String(loc.client_tx_id), loc);
        if (loc?.cloud_doc_id) byCloudId.set(String(loc.cloud_doc_id), loc);
      }

      const toPut: any[] = [];
      const nowIso = new Date().toISOString();

      for (const d of snap.docs) {
        const remote = d.data();
        const txId = String(remote.clientTxId || d.id);
        const existing = byCloudId.get(d.id) || byTxId.get(txId);

        if (existing) {
          const st = normalizeRecordSyncStatus(existing.sync_status);
          if (st === 'pending' || st === 'syncing' || st === 'failed') {
            continue;
          }
          const localTs = toUtcIsoTimestamp(existing.updated_at || existing.created_at, '');
          const remoteTs = toUtcIsoTimestamp(remote.updatedAt, '');
          if (localTs && remoteTs && localTs > remoteTs && existing.local_modified) {
            continue;
          }
          if (remoteTs && localTs && remoteTs <= localTs && existing.cloud_synced_at) {
            continue;
          }
          toPut.push({
            ...existing,
            client_tx_id: existing.client_tx_id || txId,
            invoice_number: remote.invoice_number ?? existing.invoice_number,
            invoice_date: remote.invoice_date ?? existing.invoice_date,
            customer_account_id: remote.customer_account_id ?? existing.customer_account_id,
            customer_name: remote.customer_name ?? existing.customer_name ?? 'Walk-in Cash Customer',
            customer_filer_status: remote.customer_filer_status ?? existing.customer_filer_status,
            salesman: remote.salesman ?? existing.salesman ?? '',
            invoice_type: remote.invoice_type ?? existing.invoice_type ?? 'Retail',
            payment_mode: remote.payment_mode ?? existing.payment_mode ?? 'Cash',
            gross_total: remote.gross_total ?? existing.gross_total ?? 0,
            discount_total: remote.discount_total ?? existing.discount_total ?? 0,
            discount_amount: remote.discount_total ?? existing.discount_amount ?? 0,
            tax_total: remote.tax_total ?? existing.tax_total ?? 0,
            tax_amount: remote.tax_total ?? existing.tax_amount ?? 0,
            net_total: remote.net_total ?? existing.net_total ?? 0,
            paid_amount: remote.paid_amount ?? existing.paid_amount ?? 0,
            balance_amount: remote.balance_amount ?? existing.balance_amount ?? 0,
            status: remote.status ?? existing.status ?? 'completed',
            remarks: remote.remarks ?? existing.remarks ?? '',
            items: Array.isArray(remote.items) ? remote.items : existing.items || [],
            item_count: remote.item_count ?? existing.item_count ?? 0,
            created_at: remote.createdAt ?? existing.created_at,
            updated_at: remote.updatedAt ?? existing.updated_at,
            cloud_doc_id: d.id,
            cloud_synced_at: nowIso,
            sync_status: 'synced',
            local_modified: false,
            sync_error: null,
          });
        } else {
          toPut.push({
            id: remote.serverId || remote.localId || Date.now() + Math.floor(Math.random() * 1000),
            server_id: remote.serverId || remote.localId || undefined,
            client_tx_id: txId,
            invoice_number: remote.invoice_number,
            invoice_date: remote.invoice_date || nowIso.slice(0, 10),
            customer_account_id: remote.customer_account_id ?? 0,
            customer_name: remote.customer_name || 'Walk-in Cash Customer',
            customer_filer_status: remote.customer_filer_status || 'Non-Filer',
            salesman: remote.salesman || '',
            invoice_type: remote.invoice_type || 'Retail',
            payment_mode: remote.payment_mode || 'Cash',
            gross_total: remote.gross_total ?? 0,
            discount_total: remote.discount_total ?? 0,
            discount_amount: remote.discount_total ?? 0,
            tax_total: remote.tax_total ?? 0,
            tax_amount: remote.tax_total ?? 0,
            net_total: remote.net_total ?? 0,
            paid_amount: remote.paid_amount ?? 0,
            balance_amount: remote.balance_amount ?? 0,
            status: remote.status || 'completed',
            remarks: remote.remarks || '',
            items: Array.isArray(remote.items) ? remote.items : [],
            item_count: remote.item_count ?? (Array.isArray(remote.items) ? remote.items.length : 0),
            created_at: remote.createdAt || nowIso,
            updated_at: remote.updatedAt || nowIso,
            cloud_doc_id: d.id,
            cloud_synced_at: nowIso,
            sync_status: 'synced',
            local_modified: false,
            sync_error: null,
          });
        }
      }

      if (toPut.length > 0) {
        await offlineStorage.bulkPut('sales', toPut);
        this.emitChange();
      }
      return toPut.length;
    } catch (error) {
      await this.logSyncError({
        entity: 'invoices',
        recordKey: 'collection',
        operation: 'pullInvoicesFromFirestore',
        error,
        path,
      });
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      throw error;
    }
  }

  /**
   * Computes per-module synchronization counts from local IndexedDB stores.
   */
  public async getModuleStats(module?: 'items' | 'invoices'): Promise<{
    total: number;
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  }> {
    const stores =
      module === 'items'
        ? ['items']
        : module === 'invoices'
        ? ['sales']
        : ['items', 'sales'];

    let total = 0;
    let pending = 0;
    let syncing = 0;
    let synced = 0;
    let failed = 0;

    for (const storeName of stores) {
      const rows = await offlineStorage.getAll<any>(storeName).catch(() => []);
      for (const r of rows) {
        total++;
        const st = normalizeRecordSyncStatus(r?.sync_status);
        if (st === 'syncing') syncing++;
        else if (st === 'failed') failed++;
        else if (st === 'synced' && r?.cloud_synced_at) synced++;
        else pending++;
      }
    }

    return { total, pending, syncing, synced, failed };
  }

  /**
   * Full bidirectional Firestore sync:
   * 1. Probes server connectivity (`test/connection`)
   * 2. Pushes pending/unsynced local Items and Invoices with server read-back verification
   * 3. Non-destructively pulls newer Items and Invoices from Firestore
   */
  public async syncAll(
    deviceId: string,
    options: { includeFailed?: boolean; includeUnsyncedCatalog?: boolean } = {}
  ): Promise<BatchSyncSummary> {
    const conn = await this.verifyConnection();
    if (!conn.connected) {
      return {
        connected: false,
        pushedItems: 0,
        pushedInvoices: 0,
        pulledItems: 0,
        pulledInvoices: 0,
        failedCount: 0,
        errors: conn.lastError ? [conn.lastError] : ['Firestore server unreachable'],
      };
    }

    const pushResult = await this.pushPendingToFirestore(deviceId, options);
    let pulledItems = 0;
    let pulledInvoices = 0;
    const errors = [...pushResult.errors];

    try {
      pulledItems = await this.pullItemsFromFirestore();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    try {
      pulledInvoices = await this.pullInvoicesFromFirestore();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    return {
      connected: true,
      pushedItems: pushResult.pushedItems,
      pushedInvoices: pushResult.pushedInvoices,
      pulledItems,
      pulledInvoices,
      failedCount: pushResult.failedCount,
      errors,
    };
  }

  /**
   * Non-destructively hydrates the Express SQLite database with restored Firestore/IndexedDB records
   * so server-side searches, reports, and cloud snapshots stay aligned.
   */
  public async hydrateExpressFromLocal(): Promise<{ restoredItems: number; restoredInvoices: number }> {
    try {
      const [items, sales] = await Promise.all([
        offlineStorage.getAll<any>('items').catch(() => []),
        offlineStorage.getAll<any>('sales').catch(() => []),
      ]);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let resetEpoch = '';
      if (typeof window !== 'undefined') {
        try {
          resetEpoch = window.localStorage.getItem('ams_db_reset_epoch') || '';
          const rawSess =
            window.sessionStorage.getItem('ams_active_tab_session_v2') ||
            window.localStorage.getItem('ams_active_auth_session_v2');
          if (rawSess) {
            const parsed = JSON.parse(rawSess);
            if (parsed?.token) headers['x-session-token'] = String(parsed.token);
          }
        } catch {
          // ignore storage parse error
        }
      }
      const res = await fetch('/api/sync/restore-cloud-records', {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({
          items,
          invoices: sales,
          resetEpoch: resetEpoch || undefined,
          pullFromFirestore: true,
        }),
      });
      if (!res.ok) return { restoredItems: 0, restoredInvoices: 0 };
      const data = await res.json();
      return {
        restoredItems: Number(data?.restoredItems || 0),
        restoredInvoices: Number(data?.restoredInvoices || 0),
      };
    } catch {
      return { restoredItems: 0, restoredInvoices: 0 };
    }
  }

  /**
   * Restores the latest cloud update from Firestore into local IndexedDB and Express SQLite
   * non-destructively (never overwriting newer local pending mutations or deleting records).
   */
  public async restoreLastCloudUpdate(deviceId: string): Promise<{
    success: boolean;
    pulledItems: number;
    pulledInvoices: number;
    pushedItems: number;
    pushedInvoices: number;
    restoredToServer: number;
    errors: string[];
  }> {
    const conn = await this.verifyConnection();
    if (!conn.connected) {
      return {
        success: false,
        pulledItems: 0,
        pulledInvoices: 0,
        pushedItems: 0,
        pushedInvoices: 0,
        restoredToServer: 0,
        errors: [conn.lastError || 'Firestore server unreachable'],
      };
    }

    const errors: string[] = [];
    let pulledItems = 0;
    let pulledInvoices = 0;

    try {
      pulledItems = await this.pullItemsFromFirestore();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    try {
      pulledInvoices = await this.pullInvoicesFromFirestore();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    const pushResult = await this.pushPendingToFirestore(deviceId, {
      includeFailed: true,
      includeUnsyncedCatalog: true,
    });
    errors.push(...pushResult.errors);

    const srvHydrate = await this.hydrateExpressFromLocal();
    this.emitChange();

    return {
      success: errors.length === 0,
      pulledItems,
      pulledInvoices,
      pushedItems: pushResult.pushedItems,
      pushedInvoices: pushResult.pushedInvoices,
      restoredToServer: srvHydrate.restoredItems + srvHydrate.restoredInvoices,
      errors,
    };
  }
}

export const firestoreSyncService = new FirestoreSyncService();
