import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import { executePurchasePosting } from './purchases.ts';
import { processSaleUpsert } from './sales.ts';
import { recalculateAccountBalance } from './accounts.ts';
import { allocateNextAccountCode } from '../utils/accountCodeGenerator.ts';
import { ensureAuthTables, getOfflineAuthVaultProfiles } from '../services/authService.ts';
import { authenticateToken } from '../middleware/authMiddleware.ts';
import { getDbResetEpoch, getDbResetTimestamp } from '../db/resetState.ts';
import {
  ensureCloudPersistenceReady,
  getCloudPersistenceStatus,
  hydrateSqliteFromCloudRecords,
  syncDatabaseToCloudSQL,
} from '../services/cloudPersistenceService.ts';

export const syncRouter = Router();

function normalizeIsoTs(ts: unknown): string {
  const s = String(ts || '').trim();
  if (!s) return '';
  if (s.includes('T')) return s.endsWith('Z') ? s : `${s}Z`;
  return `${s.replace(' ', 'T')}.000Z`;
}

function isIncomingStale(existingRow: any, payload: any): boolean {
  if (!existingRow) return false;
  const existingTs = normalizeIsoTs(existingRow.updated_at || existingRow.created_at);
  const incomingTs = normalizeIsoTs(payload?.updated_at || payload?.updatedAt);
  if (!existingTs || !incomingTs) return false;
  return existingTs > incomingTs;
}

function normSqlTs(col = 'COALESCE(updated_at, created_at)'): string {
  return `CASE WHEN instr(${col}, 'T') > 0 THEN ${col} ELSE replace(${col}, ' ', 'T') || '.000Z' END`;
}

function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function parseUnitsPerPack(packingStr?: string | null): number {
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

// Ensure sync_audit_log, device_registry, and sync_tombstones tables & triggers exist
let syncTablesInitialized = false;
function ensureSyncTables() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_tx_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      invoice_number TEXT,
      status TEXT NOT NULL DEFAULT 'synced',
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_registry (
      device_id TEXT PRIMARY KEY,
      device_name TEXT,
      counter_name TEXT,
      terminal_type TEXT DEFAULT 'Main Counter',
      notes TEXT,
      last_sync_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      client_tx_id TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sync_audit_tx ON sync_audit_log(client_tx_id);
    CREATE INDEX IF NOT EXISTS idx_sync_audit_device ON sync_audit_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_table ON sync_tombstones(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);
  `);

  if (!syncTablesInitialized) {
    const safeAddColumn = (table: string, colDef: string) => {
      try {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN ${colDef}`);
      } catch {
        // column already exists
      }
    };
    safeAddColumn('sales', 'client_request_id TEXT');
    safeAddColumn('purchases', 'client_request_id TEXT');
    safeAddColumn('cash_book_vouchers', 'client_tx_id TEXT');
    safeAddColumn('sale_returns', 'client_tx_id TEXT');
    safeAddColumn('purchase_returns', 'client_tx_id TEXT');

    // Create AFTER DELETE triggers so any hard delete in SQLite records a tombstone for offline clients
    const triggerSpecs: Array<{ table: string; txCol?: string }> = [
      { table: 'items' },
      { table: 'accounts' },
      { table: 'inventory' },
      { table: 'sales', txCol: 'client_request_id' },
      { table: 'purchases', txCol: 'client_request_id' },
      { table: 'cash_book_vouchers', txCol: 'client_tx_id' },
      { table: 'sale_returns', txCol: 'client_tx_id' },
      { table: 'purchase_returns', txCol: 'client_tx_id' },
      { table: 'salesmen' },
      { table: 'users' },
    ];

    for (const spec of triggerSpecs) {
      try {
        const txExpr = spec.txCol ? `OLD.${spec.txCol}` : 'NULL';
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_sync_tombstone_${spec.table}_del
          AFTER DELETE ON "${spec.table}"
          BEGIN
            INSERT INTO sync_tombstones (table_name, record_id, client_tx_id, deleted_at)
            VALUES ('${spec.table}', CAST(OLD.id AS TEXT), ${txExpr}, CURRENT_TIMESTAMP);
          END;
        `);
      } catch {
        // ignore if table does not exist yet
      }
    }

    syncTablesInitialized = true;
  }
}

function getNextContinuousCashBookVoucherNumber(db: any): {
  nextSequence: number;
  nextVoucherNumber: string;
} {
  const curMaxVoucher = Number(
    (
      db.prepare('SELECT COALESCE(MAX(sequence_number), 0) as m FROM cash_book_vouchers').get() as {
        m: number;
      }
    )?.m || 0
  );

  let seqRow = db
    .prepare("SELECT last_sequence FROM cash_book_sequences WHERE sequence_key = 'voucher_continuous'")
    .get() as { last_sequence: number } | undefined;

  if (!seqRow) {
    db.prepare(`
      INSERT INTO cash_book_sequences (sequence_key, last_sequence, updated_at)
      VALUES ('voucher_continuous', ?, CURRENT_TIMESTAMP)
    `).run(curMaxVoucher);
    seqRow = { last_sequence: curMaxVoucher };
  }

  const baseSeq = Math.max(seqRow.last_sequence, curMaxVoucher);
  let nextSeq = baseSeq + 1;
  let formattedNo = String(nextSeq).padStart(3, '0');

  while (
    db
      .prepare('SELECT id FROM cash_book_vouchers WHERE voucher_number = ? OR sequence_number = ?')
      .get(formattedNo, nextSeq)
  ) {
    nextSeq++;
    formattedNo = String(nextSeq).padStart(3, '0');
  }

  return { nextSequence: nextSeq, nextVoucherNumber: formattedNo };
}

/**
 * GET /api/sync/status
 * Check central synchronization state
 */
syncRouter.get('/status', (_req: Request, res: Response) => {
  try {
    ensureSyncTables();
    const db = getDatabase();

    const totalSynced = db.prepare('SELECT count(*) as c FROM sync_audit_log').get() as { c: number };
    const devices = db.prepare('SELECT count(*) as c FROM device_registry').get() as { c: number };
    const lastSyncRow = db
      .prepare('SELECT synced_at FROM sync_audit_log ORDER BY id DESC LIMIT 1')
      .get() as { synced_at?: string } | undefined;

    return res.json({
      success: true,
      online: true,
      databaseProvider: getCloudPersistenceStatus().provider,
      serverTime: new Date().toISOString(),
      totalSyncedTransactions: totalSynced.c,
      registeredDevicesCount: devices.c,
      lastSyncAt: lastSyncRow?.synced_at || null,
      dbResetEpoch: getDbResetEpoch(db),
      dbResetAt: getDbResetTimestamp(db),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/sync/pull
 * Pull complete canonical data snapshot from server to local device IndexedDB
 */
syncRouter.get('/pull', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    await ensureCloudPersistenceReady();
    ensureSyncTables();
    const db = getDatabase();
    const deviceId = String(req.query.device_id || 'unknown');
    const counterName = String(req.query.counter_name || 'Main Counter');
    const lastTombstoneId = Math.max(0, Number(req.query.last_tombstone_id || 0));
    const rawSince = String(req.query.since || '').trim();
    const forceFull = String(req.query.full || '') === '1' || String(req.query.full || '') === 'true';
    const clientResetEpoch = String(req.query.reset_epoch || '').trim();
    const serverResetEpoch = getDbResetEpoch(db);

    let sinceIso: string | null = null;
    if (rawSince && !Number.isNaN(Date.parse(rawSince))) {
      sinceIso = new Date(rawSince).toISOString();
    }
    const isIncremental = Boolean(
      sinceIso &&
        !forceFull &&
        (!serverResetEpoch || !clientResetEpoch || clientResetEpoch === serverResetEpoch)
    );

    // Update device registry heartbeat
    db.prepare(`
      INSERT INTO device_registry (device_id, counter_name, last_sync_at, ip_address, user_agent)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        counter_name = COALESCE(excluded.counter_name, device_registry.counter_name),
        last_sync_at = CURRENT_TIMESTAMP,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent
    `).run(deviceId, counterName, req.ip || '127.0.0.1', String(req.headers['user-agent'] || ''));

    const items = isIncremental
      ? (db
          .prepare(`SELECT * FROM items WHERE ${normSqlTs()} > ? ORDER BY item_name ASC`)
          .all(sinceIso) as Array<Record<string, any>>)
      : (db.prepare('SELECT * FROM items ORDER BY item_name ASC').all() as Array<Record<string, any>>);
    const accounts = isIncremental
      ? (db
          .prepare(`SELECT * FROM accounts WHERE ${normSqlTs()} > ? ORDER BY account_name ASC`)
          .all(sinceIso) as Array<Record<string, any>>)
      : (db.prepare('SELECT * FROM accounts ORDER BY account_name ASC').all() as Array<Record<string, any>>);
    const inventory = isIncremental
      ? (db
          .prepare(`SELECT * FROM inventory WHERE ${normSqlTs()} > ? ORDER BY expiry_date ASC`)
          .all(sinceIso) as Array<Record<string, any>>)
      : (db.prepare('SELECT * FROM inventory ORDER BY expiry_date ASC').all() as Array<Record<string, any>>);
    const companySettings = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as Record<string, any> | undefined;
    const advanceTaxSettings = db
      .prepare('SELECT * FROM advance_tax_settings ORDER BY id ASC LIMIT 1')
      .get() as Record<string, any> | undefined;

    // Pull active or delta sales with line items
    const rawSales = (isIncremental
      ? db
          .prepare(`
            SELECT s.*,
                   a.account_code as customer_code,
                   a.phone as customer_phone,
                   a.city as customer_city,
                   payAcc.account_name as payment_account_name
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            LEFT JOIN accounts payAcc ON s.payment_account_id = payAcc.id
            WHERE ${normSqlTs('COALESCE(s.updated_at, s.created_at)')} > ?
            ORDER BY s.invoice_date DESC, s.id DESC
            LIMIT 5000
          `)
          .all(sinceIso)
      : db
          .prepare(`
            SELECT s.*,
                   a.account_code as customer_code,
                   a.phone as customer_phone,
                   a.city as customer_city,
                   payAcc.account_name as payment_account_name
            FROM sales s
            LEFT JOIN accounts a ON s.customer_account_id = a.id
            LEFT JOIN accounts payAcc ON s.payment_account_id = payAcc.id
            ORDER BY s.invoice_date DESC, s.id DESC
            LIMIT 5000
          `)
          .all()) as Array<Record<string, any>>;

    const saleIds = rawSales.map((s) => Number(s.id));
    const saleItemsBySaleId = new Map<number, any[]>();
    if (saleIds.length > 0) {
      const CHUNK = 800;
      for (let i = 0; i < saleIds.length; i += CHUNK) {
        const slice = saleIds.slice(i, i + CHUNK);
        const ph = slice.map(() => '?').join(',');
        const chunkItems = db
          .prepare(`SELECT * FROM sale_items WHERE sale_id IN (${ph}) ORDER BY id ASC`)
          .all(...slice) as Array<Record<string, any>>;
        for (const si of chunkItems) {
          const sid = Number(si.sale_id);
          if (!saleItemsBySaleId.has(sid)) saleItemsBySaleId.set(sid, []);
          saleItemsBySaleId.get(sid)!.push(si);
        }
      }
    }

    const sales = rawSales.map((s) => {
      const lines = saleItemsBySaleId.get(Number(s.id)) || [];
      return {
        ...s,
        server_id: s.id,
        client_tx_id: s.client_request_id || `SERVER-SALE-${s.id}`,
        item_count: lines.length,
        items: lines,
        lines,
        sync_status: 'synced',
      };
    });

    // Pull active or delta purchases with line items
    const rawPurchases = (isIncremental
      ? db
          .prepare(`
            SELECT p.*,
                   a.account_code as supplier_code,
                   a.phone as supplier_phone,
                   payAcc.account_name as payment_account_name
            FROM purchases p
            LEFT JOIN accounts a ON p.supplier_account_id = a.id
            LEFT JOIN accounts payAcc ON p.payment_account_id = payAcc.id
            WHERE ${normSqlTs('COALESCE(p.updated_at, p.created_at)')} > ?
            ORDER BY p.bill_date DESC, p.id DESC
            LIMIT 5000
          `)
          .all(sinceIso)
      : db
          .prepare(`
            SELECT p.*,
                   a.account_code as supplier_code,
                   a.phone as supplier_phone,
                   payAcc.account_name as payment_account_name
            FROM purchases p
            LEFT JOIN accounts a ON p.supplier_account_id = a.id
            LEFT JOIN accounts payAcc ON p.payment_account_id = payAcc.id
            ORDER BY p.bill_date DESC, p.id DESC
            LIMIT 5000
          `)
          .all()) as Array<Record<string, any>>;

    const purchaseIds = rawPurchases.map((p) => Number(p.id));
    const purchaseItemsByPurId = new Map<number, any[]>();
    if (purchaseIds.length > 0) {
      const CHUNK = 800;
      for (let i = 0; i < purchaseIds.length; i += CHUNK) {
        const slice = purchaseIds.slice(i, i + CHUNK);
        const ph = slice.map(() => '?').join(',');
        const chunkPurItems = db
          .prepare(`SELECT * FROM purchase_items WHERE purchase_id IN (${ph}) ORDER BY id ASC`)
          .all(...slice) as Array<Record<string, any>>;
        for (const pi of chunkPurItems) {
          const pid = Number(pi.purchase_id);
          if (!purchaseItemsByPurId.has(pid)) purchaseItemsByPurId.set(pid, []);
          purchaseItemsByPurId.get(pid)!.push(pi);
        }
      }
    }

    const purchases = rawPurchases.map((p) => {
      const lines = purchaseItemsByPurId.get(Number(p.id)) || [];
      return {
        ...p,
        server_id: p.id,
        client_tx_id: p.client_request_id || `SERVER-PUR-${p.id}`,
        invoice_number: p.bill_number || p.invoice_number || `PUR-${p.id}`,
        item_count: lines.length,
        items: lines,
        sync_status: 'synced',
      };
    });

    // Pull Cash Book Vouchers
    let cashBookVouchers: any[] = [];
    try {
      const cbRows = (isIncremental
        ? db
            .prepare(`
              SELECT cb.*,
                     ha.account_code as head_code, ha.account_name as head_name, ha.account_group as head_group,
                     ca.account_code as cb_code, ca.account_name as cb_name, ca.account_group as cb_group
              FROM cash_book_vouchers cb
              LEFT JOIN accounts ha ON ha.id = cb.head_account_id
              LEFT JOIN accounts ca ON ca.id = cb.cash_bank_account_id
              WHERE ${normSqlTs('COALESCE(cb.updated_at, cb.created_at)')} > ?
              ORDER BY cb.sequence_number DESC, cb.id DESC
              LIMIT 5000
            `)
            .all(sinceIso)
        : db
            .prepare(`
              SELECT cb.*,
                     ha.account_code as head_code, ha.account_name as head_name, ha.account_group as head_group,
                     ca.account_code as cb_code, ca.account_name as cb_name, ca.account_group as cb_group
              FROM cash_book_vouchers cb
              LEFT JOIN accounts ha ON ha.id = cb.head_account_id
              LEFT JOIN accounts ca ON ca.id = cb.cash_bank_account_id
              ORDER BY cb.sequence_number DESC, cb.id DESC
              LIMIT 5000
            `)
            .all()) as Array<Record<string, any>>;

      cashBookVouchers = cbRows.map((cb) => ({
        ...cb,
        server_id: cb.id,
        client_tx_id: cb.client_tx_id || `SERVER-CB-${cb.id}`,
        sync_status: 'synced',
      }));
    } catch {
      // ignore if table not yet queried
    }

    // Pull Sale Returns & Purchase Returns (with their return items)
    let saleReturns: any[] = [];
    try {
      const srRows = (isIncremental
        ? db
            .prepare(`SELECT * FROM sale_returns WHERE ${normSqlTs('created_at')} > ? ORDER BY return_date DESC, id DESC LIMIT 2000`)
            .all(sinceIso)
        : db
            .prepare('SELECT * FROM sale_returns ORDER BY return_date DESC, id DESC LIMIT 2000')
            .all()) as Array<Record<string, any>>;
      const srIds = srRows.map((sr) => Number(sr.id));
      const srMap = new Map<number, any[]>();
      if (srIds.length > 0) {
        const ph = srIds.map(() => '?').join(',');
        const srItems = db
          .prepare(`SELECT * FROM sale_return_items WHERE sale_return_id IN (${ph}) ORDER BY id ASC`)
          .all(...srIds) as Array<Record<string, any>>;
        for (const sri of srItems) {
          const id = Number(sri.sale_return_id);
          if (!srMap.has(id)) srMap.set(id, []);
          srMap.get(id)!.push(sri);
        }
      }
      saleReturns = srRows.map((sr) => ({
        ...sr,
        server_id: sr.id,
        client_tx_id: sr.client_tx_id || `SERVER-SR-${sr.id}`,
        items: srMap.get(Number(sr.id)) || [],
        sync_status: 'synced',
      }));
    } catch {
      // ignore
    }

    let purchaseReturns: any[] = [];
    try {
      const prRows = (isIncremental
        ? db
            .prepare(`SELECT * FROM purchase_returns WHERE ${normSqlTs('created_at')} > ? ORDER BY return_date DESC, id DESC LIMIT 2000`)
            .all(sinceIso)
        : db
            .prepare('SELECT * FROM purchase_returns ORDER BY return_date DESC, id DESC LIMIT 2000')
            .all()) as Array<Record<string, any>>;
      const prIds = prRows.map((pr) => Number(pr.id));
      const prMap = new Map<number, any[]>();
      if (prIds.length > 0) {
        const ph = prIds.map(() => '?').join(',');
        const prItems = db
          .prepare(`SELECT * FROM purchase_return_items WHERE purchase_return_id IN (${ph}) ORDER BY id ASC`)
          .all(...prIds) as Array<Record<string, any>>;
        for (const pri of prItems) {
          const id = Number(pri.purchase_return_id);
          if (!prMap.has(id)) prMap.set(id, []);
          prMap.get(id)!.push(pri);
        }
      }
      purchaseReturns = prRows.map((pr) => ({
        ...pr,
        server_id: pr.id,
        client_tx_id: pr.client_tx_id || `SERVER-PR-${pr.id}`,
        items: prMap.get(Number(pr.id)) || [],
        sync_status: 'synced',
      }));
    } catch {
      // ignore
    }

    // Pull Salesmen & Supply Snapshot
    let salesmen: any[] = [];
    try {
      salesmen = isIncremental
        ? db.prepare(`SELECT * FROM salesmen WHERE ${normSqlTs()} > ? ORDER BY name ASC`).all(sinceIso)
        : db.prepare('SELECT * FROM salesmen ORDER BY name ASC').all();
    } catch {
      // ignore
    }

    let supplySnapshot: Record<string, any> = {};
    try {
      const towns = db.prepare('SELECT * FROM towns ORDER BY town_name ASC').all();
      const areas = db.prepare('SELECT * FROM town_areas ORDER BY area_name ASC').all();
      const bookings = db.prepare('SELECT * FROM supply_bookings ORDER BY id DESC LIMIT 500').all();
      supplySnapshot = { towns, areas, bookings };
    } catch {
      // ignore
    }

    // Pull Payroll Snapshot
    let payrollSnapshot: Record<string, any> = {};
    try {
      const employees = db.prepare('SELECT * FROM employees ORDER BY id ASC').all();
      const payrollRuns = db.prepare('SELECT * FROM payroll_records ORDER BY id DESC LIMIT 120').all();
      payrollSnapshot = { employees, payrollRuns };
    } catch {
      // ignore
    }

    // Pull Offline Auth Vault Profiles (active users + permissions + PBKDF2 verifiers)
    let offlineUsers: any[] = [];
    try {
      ensureAuthTables(db);
      offlineUsers = getOfflineAuthVaultProfiles(db);
    } catch {
      // ignore
    }

    // Pull Deletion Tombstones for incremental deletion sync
    let tombstones: Array<{
      id: number;
      table_name: string;
      record_id: string;
      client_tx_id: string | null;
      deleted_at: string;
    }> = [];
    let maxTombstoneId = lastTombstoneId;
    try {
      tombstones = db
        .prepare('SELECT * FROM sync_tombstones WHERE id > ? ORDER BY id ASC LIMIT 5000')
        .all(lastTombstoneId) as any[];
      if (tombstones.length > 0) {
        maxTombstoneId = Number(tombstones[tombstones.length - 1].id || lastTombstoneId);
      } else {
        const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM sync_tombstones').get() as { m: number };
        maxTombstoneId = Number(maxRow?.m || 0);
      }
    } catch {
      // ignore
    }

    const nowIso = new Date().toISOString();
    const buildMeta = (rows: any[]) => {
      let maxId = 0;
      let latestUpdatedAt = '';
      for (const r of rows) {
        const numId = Number(r?.id || 0);
        if (numId > maxId) maxId = numId;
        const ts = String(r?.updated_at || r?.created_at || '')
          .trim()
          .replace(' ', 'T');
        if (ts > latestUpdatedAt) latestUpdatedAt = ts;
      }
      return {
        rowCount: rows.length,
        maxId,
        latestUpdatedAt: latestUpdatedAt || nowIso,
        syncedAt: nowIso,
      };
    };

    const tableMeta = {
      items: buildMeta(items),
      accounts: buildMeta(accounts),
      inventory: buildMeta(inventory),
      sales: buildMeta(sales),
      purchases: buildMeta(purchases),
      cash_book: buildMeta(cashBookVouchers),
      sale_returns: buildMeta(saleReturns),
      purchase_returns: buildMeta(purchaseReturns),
      salesmen: buildMeta(salesmen),
      auth_vault: buildMeta(offlineUsers),
      company_settings: buildMeta(companySettings ? [companySettings] : []),
    };

    return res.json({
      success: true,
      isIncremental,
      since: sinceIso,
      serverTime: nowIso,
      dbResetEpoch: serverResetEpoch,
      dbResetAt: getDbResetTimestamp(db),
      items,
      accounts,
      inventory,
      companySettings: companySettings || null,
      advanceTaxSettings: advanceTaxSettings || null,
      sales,
      purchases,
      cashBookVouchers,
      saleReturns,
      purchaseReturns,
      salesmen,
      supplySnapshot,
      payrollSnapshot,
      offlineUsers,
      tombstones,
      maxTombstoneId,
      tableMeta,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/sync/push
 * Batch push offline transactions with strict duplicate prevention and atomic transaction execution
 */
syncRouter.post('/push', (req: Request, res: Response) => {
  try {
    ensureSyncTables();
    const db = getDatabase();

    const deviceId = req.body?.deviceId || req.body?.device_id || 'POS-TERMINAL';
    const items = req.body?.items || req.body?.operations;

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ success: true, results: [] });
    }

    const results: Array<{
      client_tx_id: string;
      status: 'synced' | 'failed';
      server_id?: number | null;
      invoice_number?: string | null;
      error?: string | null;
    }> = [];

    for (const item of items) {
      const { client_tx_id, action, payload } = item;

      if (!client_tx_id) {
        results.push({ client_tx_id: 'unknown', status: 'failed', error: 'Missing client_tx_id' });
        continue;
      }

      // Idempotency check: if this transaction UUID was already processed, skip duplication!
      const existingSync = db
        .prepare('SELECT * FROM sync_audit_log WHERE client_tx_id = ?')
        .get(client_tx_id) as any;
      if (existingSync && existingSync.status === 'synced') {
        results.push({
          client_tx_id,
          status: 'synced',
          server_id: existingSync.entity_id,
          invoice_number: existingSync.invoice_number,
        });
        continue;
      }

      try {
        if (action === 'CREATE_SALE' || action === 'HOLD_SALE') {
          const existingSale = db
            .prepare('SELECT id, invoice_number FROM sales WHERE client_request_id = ? LIMIT 1')
            .get(client_tx_id) as { id: number; invoice_number: string } | undefined;

          if (existingSale) {
            db.prepare(`
              INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
              VALUES (?, ?, ?, 'sales', ?, ?, 'synced', ?)
            `).run(
              client_tx_id,
              deviceId,
              action,
              existingSale.id,
              existingSale.invoice_number,
              JSON.stringify(payload)
            );
            results.push({
              client_tx_id,
              status: 'synced',
              server_id: existingSale.id,
              invoice_number: existingSale.invoice_number,
            });
            continue;
          }

          const targetStatus = action === 'HOLD_SALE' ? 'held' : payload.status || 'completed';
          const rawSaleItems = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.lines)
            ? payload.lines
            : [];
          const normalizedSaleItems = rawSaleItems.map((line: any) => ({
            ...line,
            quantity: Number(line.quantity ?? line.pack_qty ?? line.pack_quantity ?? 0),
            loose_quantity: Number(line.loose_quantity ?? line.loose_qty ?? line.loose_units ?? 0),
            bonus_quantity: Number(line.bonus_quantity ?? line.bonus_qty ?? line.bonus_units ?? 0),
          }));
          const normalizedPayload = {
            ...payload,
            status: targetStatus,
            items: normalizedSaleItems,
            allow_negative_stock: true,
          };

          const saleId = processSaleUpsert(null, normalizedPayload);
          const nowStamp = new Date().toISOString();
          db.prepare('UPDATE sales SET client_request_id = ?, updated_at = ? WHERE id = ?').run(
            client_tx_id,
            nowStamp,
            saleId
          );
          const saleRow = db
            .prepare('SELECT invoice_number FROM sales WHERE id = ?')
            .get(saleId) as { invoice_number: string } | undefined;
          const finalInvNo = saleRow?.invoice_number || `INV-${saleId}`;

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, ?, 'sales', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, action, saleId, finalInvNo, JSON.stringify(payload));

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: saleId,
            invoice_number: finalInvNo,
          });
        } else if (action === 'UPDATE_SALE') {
          const targetId = Number(payload.id || item.local_id);
          if (!targetId || Number.isNaN(targetId)) {
            throw new Error('Valid numeric sale ID is required for UPDATE_SALE');
          }
          const existingSaleRow = db.prepare('SELECT id, invoice_number, created_at, updated_at FROM sales WHERE id = ?').get(targetId) as any;
          if (isIncomingStale(existingSaleRow, payload)) {
            db.prepare(`
              INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
              VALUES (?, ?, 'UPDATE_SALE', 'sales', ?, ?, 'synced', ?)
            `).run(client_tx_id, deviceId, targetId, existingSaleRow?.invoice_number || '', JSON.stringify(payload));
            results.push({
              client_tx_id,
              status: 'synced',
              server_id: targetId,
              invoice_number: existingSaleRow?.invoice_number || null,
            });
            continue;
          }
          const rawUpdateItems = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.lines)
            ? payload.lines
            : [];
          const saleId = processSaleUpsert(targetId, {
            ...payload,
            items: rawUpdateItems.map((line: any) => ({
              ...line,
              quantity: Number(line.quantity ?? line.pack_qty ?? line.pack_quantity ?? 0),
              loose_quantity: Number(line.loose_quantity ?? line.loose_qty ?? line.loose_units ?? 0),
              bonus_quantity: Number(line.bonus_quantity ?? line.bonus_qty ?? line.bonus_units ?? 0),
            })),
            allow_negative_stock: true,
          });
          db.prepare('UPDATE sales SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), saleId);
          const saleRow = db
            .prepare('SELECT invoice_number FROM sales WHERE id = ?')
            .get(saleId) as { invoice_number: string } | undefined;

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'UPDATE_SALE', 'sales', ?, ?, 'synced', ?)
          `).run(
            client_tx_id,
            deviceId,
            saleId,
            saleRow?.invoice_number || '',
            JSON.stringify(payload)
          );

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: saleId,
            invoice_number: saleRow?.invoice_number || null,
          });
        } else if (action === 'CREATE_PURCHASE' || action === 'HOLD_PURCHASE') {
          const targetStatus = action === 'HOLD_PURCHASE' ? 'held' : 'completed';
          const rawPurItems = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.lines)
            ? payload.lines
            : [];
          const normalizedPurItems = rawPurItems.map((line: any) => ({
            ...line,
            quantity: Number(line.quantity ?? line.pack_qty ?? line.pack_quantity ?? 0),
            bonus_quantity: Number(line.bonus_quantity ?? line.bonus_qty ?? line.bonus_units ?? 0),
            loose_quantity: Number(line.loose_quantity ?? line.loose_qty ?? line.loose_units ?? 0),
          }));
          const purchaseId = executePurchasePosting({
            ...payload,
            items: normalizedPurItems,
            status: targetStatus,
            client_request_id: client_tx_id,
          });
          try {
            db.prepare('UPDATE purchases SET client_request_id = ? WHERE id = ?').run(client_tx_id, purchaseId);
          } catch {
            // ignore
          }

          const purRow = db
            .prepare('SELECT bill_number FROM purchases WHERE id = ?')
            .get(purchaseId) as { bill_number: string } | undefined;
          const billNo = purRow?.bill_number || `PUR-${purchaseId}`;

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, ?, 'purchases', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, action, purchaseId, billNo, JSON.stringify(payload));

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: purchaseId,
            invoice_number: billNo,
          });
        } else if (action === 'UPDATE_PURCHASE') {
          const targetId = Number(payload.id || item.local_id);
          const rawUpdatePurItems = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.lines)
            ? payload.lines
            : [];
          const purchaseId = executePurchasePosting({
            ...payload,
            items: rawUpdatePurItems.map((line: any) => ({
              ...line,
              quantity: Number(line.quantity ?? line.pack_qty ?? line.pack_quantity ?? 0),
              bonus_quantity: Number(line.bonus_quantity ?? line.bonus_qty ?? line.bonus_units ?? 0),
              loose_quantity: Number(line.loose_quantity ?? line.loose_qty ?? line.loose_units ?? 0),
            })),
            existingPurchaseId: targetId,
          });
          const purRow = db
            .prepare('SELECT bill_number FROM purchases WHERE id = ?')
            .get(purchaseId) as { bill_number: string } | undefined;
          const billNo = purRow?.bill_number || `PUR-${purchaseId}`;

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'UPDATE_PURCHASE', 'purchases', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, purchaseId, billNo, JSON.stringify(payload));

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: purchaseId,
            invoice_number: billNo,
          });
        } else if (action === 'CREATE_ITEM') {
          const code = String(payload.item_code || `MED-${Date.now().toString().slice(-5)}`).trim();
          const existingByCode = db
            .prepare('SELECT id, item_code FROM items WHERE LOWER(item_code) = LOWER(?) LIMIT 1')
            .get(code) as { id: number; item_code: string } | undefined;

          const nowStamp = new Date().toISOString();
          let itemId: number;
          if (existingByCode) {
            itemId = existingByCode.id;
          } else {
            const packing = String(payload.packing || '1x1');
            const unitsPerPack = parseUnitsPerPack(packing);
            const retailPrice = round2(payload.retail_price || 0);
            const looseRate =
              Number(payload.loose_rate || 0) > 0
                ? round2(payload.loose_rate)
                : round2(retailPrice / unitsPerPack);

            const insertItem = db
              .prepare(`
                INSERT INTO items (
                  item_code, barcode, item_name, generic_name, category, company_name,
                  packing, purchase_price, trade_price, wholesale_price, retail_price,
                  loose_rate, tax_percent, discount_percent, reorder_level, opening_stock,
                  rack_location, status, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
              `)
              .run(
                code,
                payload.barcode || null,
                String(payload.item_name || 'Medicine Item').trim(),
                payload.generic_name || '',
                payload.category || 'Medicine',
                payload.company_name || '',
                packing,
                round2(payload.purchase_price || 0),
                round2(payload.trade_price || payload.purchase_price || 0),
                round2(payload.wholesale_price || payload.retail_price || 0),
                retailPrice,
                looseRate,
                round2(payload.tax_percent || 0),
                round2(payload.discount_percent || 0),
                Number(payload.reorder_level || 10),
                Number(payload.opening_stock || 0),
                payload.rack_location || '',
                payload.notes || '',
                nowStamp,
                nowStamp
              );
            itemId = Number(insertItem.lastInsertRowid);
          }

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'CREATE_ITEM', 'items', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, itemId, code, JSON.stringify(payload));

          results.push({ client_tx_id, status: 'synced', server_id: itemId, invoice_number: code });
        } else if (action === 'UPDATE_ITEM') {
          const itemId = Number(payload.id || item.local_id);
          if (itemId > 0) {
            const existingItemRow = db.prepare('SELECT id, created_at, updated_at FROM items WHERE id = ?').get(itemId) as any;
            if (!isIncomingStale(existingItemRow, payload)) {
              const packing = String(payload.packing || '1x1');
              const unitsPerPack = parseUnitsPerPack(packing);
              const retailPrice = round2(payload.retail_price || 0);
              const looseRate =
                Number(payload.loose_rate || 0) > 0
                  ? round2(payload.loose_rate)
                  : round2(retailPrice / unitsPerPack);

              db.prepare(`
                UPDATE items
                SET item_name = COALESCE(?, item_name),
                    generic_name = COALESCE(?, generic_name),
                    company_name = COALESCE(?, company_name),
                    category = COALESCE(?, category),
                    packing = COALESCE(?, packing),
                    purchase_price = COALESCE(?, purchase_price),
                    trade_price = COALESCE(?, trade_price),
                    wholesale_price = COALESCE(?, wholesale_price),
                    retail_price = COALESCE(?, retail_price),
                    loose_rate = ?,
                    reorder_level = COALESCE(?, reorder_level),
                    rack_location = COALESCE(?, rack_location),
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ?
              `).run(
                payload.item_name ?? null,
                payload.generic_name ?? null,
                payload.company_name ?? null,
                payload.category ?? null,
                payload.packing ?? null,
                payload.purchase_price !== undefined ? round2(payload.purchase_price) : null,
                payload.trade_price !== undefined ? round2(payload.trade_price) : null,
                payload.wholesale_price !== undefined ? round2(payload.wholesale_price) : null,
                payload.retail_price !== undefined ? retailPrice : null,
                looseRate,
                payload.reorder_level ?? null,
                payload.rack_location ?? null,
                payload.status ?? null,
                new Date().toISOString(),
                itemId
              );
            }
          }

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, status, payload_json)
            VALUES (?, ?, 'UPDATE_ITEM', 'items', ?, 'synced', ?)
          `).run(client_tx_id, deviceId, itemId, JSON.stringify(payload));

          results.push({ client_tx_id, status: 'synced', server_id: itemId });
        } else if (action === 'UPDATE_ITEM_PRICE_CASCADE') {
          const itemId = Number(payload.id || item.local_id);
          const existingItem = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as any;
          if (existingItem) {
            const newPurPrice = round2(payload.new_purchase_price);
            const unitsPerPack = parseUnitsPerPack(existingItem.packing);
            const calcRetail = newPurPrice > 0 ? round2(newPurPrice / 0.85) : 0;
            const finalPur = payload.update_purchase_price
              ? newPurPrice
              : round2(existingItem.purchase_price);
            const finalRetail = payload.update_retail_price
              ? calcRetail
              : round2(existingItem.retail_price);
            const finalLoose = round2(finalRetail / unitsPerPack);

            db.prepare(`
              UPDATE items
              SET purchase_price = ?,
                  trade_price = ?,
                  retail_price = ?,
                  loose_rate = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(finalPur, finalPur, finalRetail, finalLoose, itemId);
          }

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, status, payload_json)
            VALUES (?, ?, 'UPDATE_ITEM_PRICE_CASCADE', 'items', ?, 'synced', ?)
          `).run(client_tx_id, deviceId, itemId, JSON.stringify(payload));

          results.push({ client_tx_id, status: 'synced', server_id: itemId });
        } else if (action === 'CREATE_ACCOUNT') {
          const accountGroup = String(payload.account_group || 'Customer');
          const mainGroup = String(payload.main_group || 'PARTY ACCOUNTS');
          const accountType = String(payload.account_type || accountGroup || mainGroup).trim();
          const generated = allocateNextAccountCode(db, accountGroup, mainGroup);
          const openBal = round2(payload.opening_balance || 0);
          const openType = payload.opening_balance_type === 'Credit' ? 'Credit' : 'Debit';

          const insertAcc = db
            .prepare(`
              INSERT INTO accounts (
                account_code, account_name, main_group, account_group, account_type,
                opening_balance, opening_balance_type, current_balance, current_balance_type,
                contact_person, phone, email, ntn, strn, filer_status, address, city, credit_limit,
                status, is_system_account
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 0)
            `)
            .run(
              generated.nextCode,
              String(payload.account_name || 'New Account').trim(),
              mainGroup,
              accountGroup,
              accountType,
              openBal,
              openType,
              openBal,
              openType,
              payload.contact_person || null,
              payload.phone || null,
              payload.email || null,
              payload.ntn || null,
              payload.strn || null,
              payload.filer_status || 'Non-Filer',
              payload.address || null,
              payload.city || null,
              round2(payload.credit_limit || 0)
            );

          const accId = Number(insertAcc.lastInsertRowid);
          recalculateAccountBalance(accId);

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'CREATE_ACCOUNT', 'accounts', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, accId, generated.nextCode, JSON.stringify(payload));

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: accId,
            invoice_number: generated.nextCode,
          });
        } else if (action === 'UPDATE_ACCOUNT') {
          const accId = Number(payload.id || item.local_id);
          if (accId > 0) {
            const existingAccRow = db.prepare('SELECT id, created_at, updated_at FROM accounts WHERE id = ?').get(accId) as any;
            if (!isIncomingStale(existingAccRow, payload)) {
              const nextSyncType =
                payload.account_type ??
                (payload.account_group ? String(payload.account_group).trim() : null);
              db.prepare(`
                UPDATE accounts
                SET account_name = COALESCE(?, account_name),
                    account_group = COALESCE(?, account_group),
                    account_type = COALESCE(?, account_type),
                    contact_person = COALESCE(?, contact_person),
                    phone = COALESCE(?, phone),
                    email = COALESCE(?, email),
                    filer_status = COALESCE(?, filer_status),
                    address = COALESCE(?, address),
                    city = COALESCE(?, city),
                    credit_limit = COALESCE(?, credit_limit),
                    opening_balance = COALESCE(?, opening_balance),
                    opening_balance_type = COALESCE(?, opening_balance_type),
                    updated_at = ?
                WHERE id = ?
              `).run(
                payload.account_name ?? null,
                payload.account_group ?? null,
                nextSyncType,
                payload.contact_person ?? null,
                payload.phone ?? null,
                payload.email ?? null,
                payload.filer_status ?? null,
                payload.address ?? null,
                payload.city ?? null,
                payload.credit_limit !== undefined ? round2(payload.credit_limit) : null,
                payload.opening_balance !== undefined ? round2(payload.opening_balance) : null,
                payload.opening_balance_type ?? null,
                new Date().toISOString(),
                accId
              );
              recalculateAccountBalance(accId);
            }
          }

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, status, payload_json)
            VALUES (?, ?, 'UPDATE_ACCOUNT', 'accounts', ?, 'synced', ?)
          `).run(client_tx_id, deviceId, accId, JSON.stringify(payload));

          results.push({ client_tx_id, status: 'synced', server_id: accId });
        } else if (action === 'CREATE_CASH_BOOK_VOUCHER') {
          const cleanDate = String(
            payload.voucher_date || new Date().toISOString().slice(0, 10)
          ).trim();
          const cleanType = String(payload.transaction_type || 'Receipt');
          const recAmt = round2(Math.max(0, Number(payload.receipt_amount || 0)));
          const payAmt = round2(Math.max(0, Number(payload.payment_amount || 0)));
          const netAmt = recAmt > 0 ? recAmt : payAmt;

          const headAcc = db
            .prepare('SELECT * FROM accounts WHERE id = ?')
            .get(Number(payload.head_account_id)) as any;
          const cbAcc = db
            .prepare('SELECT * FROM accounts WHERE id = ?')
            .get(Number(payload.cash_bank_account_id)) as any;

          if (!headAcc || !cbAcc || netAmt <= 0) {
            throw new Error('Invalid Cash Book accounts or amount for offline voucher sync.');
          }

          const { nextSequence, nextVoucherNumber } = getNextContinuousCashBookVoucherNumber(db);

          const cbResult = db.transaction(() => {
            let debitAccountId: number;
            let debitLedgerType: 'general' | 'customer' | 'supplier' = 'general';
            let creditAccountId: number;
            let creditLedgerType: 'general' | 'customer' | 'supplier' = 'general';

            let autoNarration = String(payload.narration || '').trim();

            if (recAmt > 0) {
              debitAccountId = cbAcc.id;
              creditAccountId = headAcc.id;
              if (headAcc.account_group === 'Customer') creditLedgerType = 'customer';
              if (headAcc.account_group === 'Supplier') creditLedgerType = 'supplier';
              if (!autoNarration) {
                autoNarration = `Cash Book Voucher #${nextVoucherNumber} Receipt from ${headAcc.account_name}`;
              }
            } else {
              debitAccountId = headAcc.id;
              creditAccountId = cbAcc.id;
              if (headAcc.account_group === 'Customer') debitLedgerType = 'customer';
              if (headAcc.account_group === 'Supplier') debitLedgerType = 'supplier';
              if (!autoNarration) {
                autoNarration = `Cash Book Voucher #${nextVoucherNumber} Payment to ${headAcc.account_name}`;
              }
            }

            const jeNumber = `JE-CB-${nextVoucherNumber}`;
            const jeRes = db
              .prepare(`
                INSERT INTO journal_entries (
                  entry_number, entry_date, reference_type, reference_id, description,
                  total_debit, total_credit, is_balanced, status
                ) VALUES (?, ?, 'VOUCHER', 0, ?, ?, ?, 1, 'posted')
              `)
              .run(jeNumber, cleanDate, autoNarration, netAmt, netAmt);
            const jeId = Number(jeRes.lastInsertRowid);

            db.prepare(`
              INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
              ) VALUES (?, ?, ?, ?, 0.0, ?)
            `).run(jeId, debitAccountId, debitLedgerType, netAmt, autoNarration);

            db.prepare(`
              INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
              ) VALUES (?, ?, ?, 0.0, ?, ?)
            `).run(jeId, creditAccountId, creditLedgerType, netAmt, autoNarration);

            const cbInsert = db
              .prepare(`
                INSERT INTO cash_book_vouchers (
                  voucher_number, sequence_number, voucher_date, transaction_type, category,
                  head_account_id, head_account_code, head_account_name,
                  cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
                  receipt_amount, payment_amount, net_amount,
                  narration, reference_number, journal_entry_id, status, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)
              `)
              .run(
                nextVoucherNumber,
                nextSequence,
                cleanDate,
                cleanType,
                payload.category || (recAmt > 0 ? 'customer_receipt' : 'shop_expense'),
                headAcc.id,
                headAcc.account_code,
                headAcc.account_name,
                cbAcc.id,
                cbAcc.account_code,
                cbAcc.account_name,
                recAmt,
                payAmt,
                netAmt,
                autoNarration,
                payload.reference_number || '',
                jeId,
                payload.created_by || 'Super Admin'
              );

            const cbVoucherId = Number(cbInsert.lastInsertRowid);
            try {
              db.prepare('UPDATE cash_book_vouchers SET client_tx_id = ? WHERE id = ?').run(
                client_tx_id,
                cbVoucherId
              );
            } catch {
              // ignore
            }
            db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(
              cbVoucherId,
              jeId
            );
            db.prepare(`
              UPDATE cash_book_sequences
              SET last_sequence = MAX(last_sequence, ?), updated_at = CURRENT_TIMESTAMP
              WHERE sequence_key = 'voucher_continuous'
            `).run(nextSequence);

            recalculateAccountBalance(debitAccountId);
            recalculateAccountBalance(creditAccountId);

            return { cbVoucherId, nextVoucherNumber };
          })();

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'CREATE_CASH_BOOK_VOUCHER', 'cash_book', ?, ?, 'synced', ?)
          `).run(
            client_tx_id,
            deviceId,
            cbResult.cbVoucherId,
            cbResult.nextVoucherNumber,
            JSON.stringify(payload)
          );

          results.push({
            client_tx_id,
            status: 'synced',
            server_id: cbResult.cbVoucherId,
            invoice_number: cbResult.nextVoucherNumber,
          });
        } else if (action === 'UPDATE_CASH_BOOK_VOUCHER') {
          const targetId = Number(payload.id || item.local_id);
          if (targetId > 0) {
            const existingCb = db
              .prepare('SELECT * FROM cash_book_vouchers WHERE id = ?')
              .get(targetId) as any;
            if (existingCb) {
              const recAmt = round2(Math.max(0, Number(payload.receipt_amount ?? existingCb.receipt_amount ?? 0)));
              const payAmt = round2(Math.max(0, Number(payload.payment_amount ?? existingCb.payment_amount ?? 0)));
              const netAmt = recAmt > 0 ? recAmt : payAmt;
              const headId = Number(payload.head_account_id || existingCb.head_account_id);
              const cbId = Number(payload.cash_bank_account_id || existingCb.cash_bank_account_id);
              db.prepare(`
                UPDATE cash_book_vouchers
                SET voucher_date = COALESCE(?, voucher_date),
                    transaction_type = COALESCE(?, transaction_type),
                    head_account_id = ?,
                    cash_bank_account_id = ?,
                    receipt_amount = ?,
                    payment_amount = ?,
                    net_amount = ?,
                    narration = COALESCE(?, narration),
                    reference_number = COALESCE(?, reference_number),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(
                payload.voucher_date ?? null,
                payload.transaction_type ?? null,
                headId,
                cbId,
                recAmt,
                payAmt,
                netAmt,
                payload.narration ?? null,
                payload.reference_number ?? null,
                targetId
              );
              recalculateAccountBalance(headId);
              recalculateAccountBalance(cbId);
            }
          }
          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, status, payload_json)
            VALUES (?, ?, 'UPDATE_CASH_BOOK_VOUCHER', 'cash_book', ?, 'synced', ?)
          `).run(client_tx_id, deviceId, targetId, JSON.stringify(payload));
          results.push({ client_tx_id, status: 'synced', server_id: targetId });
        } else if (action === 'CREATE_SALE_RETURN') {
          const returnNumber = String(payload.return_number || `SR-${Date.now().toString().slice(-6)}`);
          const returnDate = String(payload.return_date || new Date().toISOString().slice(0, 10));
          const netReturnAmt = round2(payload.net_return_amount || payload.total_amount || 0);
          const refundPaid = round2(payload.refund_paid || 0);
          const customerAccId = payload.customer_account_id ? Number(payload.customer_account_id) : null;
          const returnLines = Array.isArray(payload.items) ? payload.items : [];

          const srId = db.transaction(() => {
            const ins = db
              .prepare(`
                INSERT INTO sale_returns (
                  return_number, return_date, original_sale_id, original_invoice_number,
                  customer_account_id, customer_name, return_mode, settlement_mode,
                  payment_account_id, subtotal_amount, discount_amount, tax_amount,
                  net_return_amount, refund_paid, credit_adjusted, reason, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `)
              .run(
                returnNumber,
                returnDate,
                payload.original_sale_id || null,
                payload.original_invoice_number || null,
                customerAccId,
                payload.customer_name || 'Walk-in Customer',
                payload.return_mode || 'direct',
                payload.settlement_mode || 'Cash Refund',
                payload.payment_account_id || null,
                round2(payload.subtotal_amount || netReturnAmt),
                round2(payload.discount_amount || 0),
                round2(payload.tax_amount || 0),
                netReturnAmt,
                refundPaid,
                round2(netReturnAmt - refundPaid),
                payload.reason || 'Customer Return (Synced)',
                payload.notes || null
              );
            const newSrId = Number(ins.lastInsertRowid);
            try {
              db.prepare('UPDATE sale_returns SET client_tx_id = ? WHERE id = ?').run(
                client_tx_id,
                newSrId
              );
            } catch {
              // ignore
            }

            for (const line of returnLines) {
              const itemId = Number(line.item_id || 0);
              const unitsReturned = Number(line.total_units_returned || line.quantity_returned || 0);
              const uPerPack = Math.max(1, Number(line.units_per_pack || 1));
              const packRet = Number(line.pack_qty || Math.floor(unitsReturned / uPerPack));
              const looseRet = Number(line.loose_qty || unitsReturned % uPerPack);

              db.prepare(`
                INSERT INTO sale_return_items (
                  sale_return_id, item_id, item_name, batch_id, batch_number,
                  sale_mode, units_per_pack, pack_qty, loose_qty, quantity_returned,
                  total_units_returned, unit_price, discount_percent, discount_amount, line_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                newSrId,
                itemId,
                line.item_name || 'Item',
                line.batch_id || null,
                line.batch_number || 'DEFAULT',
                line.sale_mode || 'pack',
                uPerPack,
                packRet,
                looseRet,
                unitsReturned,
                unitsReturned,
                round2(line.unit_price || 0),
                round2(line.discount_percent || 0),
                round2(line.discount_amount || 0),
                round2(line.line_total || 0)
              );

              if (itemId > 0 && unitsReturned > 0) {
                const batchRow = line.batch_id
                  ? (db.prepare('SELECT * FROM inventory WHERE id = ?').get(Number(line.batch_id)) as any)
                  : (db.prepare('SELECT * FROM inventory WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as any);
                if (batchRow) {
                  const prevUnits = Number(
                    batchRow.total_stock_units ?? batchRow.quantity_in_stock ?? 0
                  );
                  const nextTotalUnits = prevUnits + unitsReturned;
                  const bUnitsPerPack = Math.max(1, Number(batchRow.units_per_pack || uPerPack));
                  db.prepare(`
                    UPDATE inventory
                    SET total_stock_units = ?,
                        current_pack_qty = ?,
                        quantity_in_stock = ?,
                        pack_quantity = ?,
                        loose_units = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                  `).run(
                    nextTotalUnits,
                    round2(nextTotalUnits / bUnitsPerPack),
                    nextTotalUnits,
                    Math.floor(nextTotalUnits / bUnitsPerPack),
                    nextTotalUnits % bUnitsPerPack,
                    batchRow.id
                  );
                }
              }
            }

            if (customerAccId) recalculateAccountBalance(customerAccId);
            if (payload.payment_account_id) recalculateAccountBalance(Number(payload.payment_account_id));
            return newSrId;
          })();

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'CREATE_SALE_RETURN', 'sale_returns', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, srId, returnNumber, JSON.stringify(payload));
          results.push({ client_tx_id, status: 'synced', server_id: srId, invoice_number: returnNumber });
        } else if (action === 'CREATE_PURCHASE_RETURN') {
          const returnNumber = String(payload.return_number || `PR-${Date.now().toString().slice(-6)}`);
          const returnDate = String(payload.return_date || new Date().toISOString().slice(0, 10));
          const netReturnAmt = round2(payload.net_return_amount || payload.total_amount || 0);
          const refundReceived = round2(payload.refund_received || 0);
          const supplierAccId = payload.supplier_account_id ? Number(payload.supplier_account_id) : null;
          const returnLines = Array.isArray(payload.items) ? payload.items : [];

          const prId = db.transaction(() => {
            const ins = db
              .prepare(`
                INSERT INTO purchase_returns (
                  return_number, return_date, original_purchase_id, original_bill_number,
                  supplier_account_id, supplier_name, return_mode, settlement_mode,
                  payment_account_id, subtotal_amount, discount_amount, tax_amount,
                  net_return_amount, refund_received, debit_adjusted, reason, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `)
              .run(
                returnNumber,
                returnDate,
                payload.original_purchase_id || null,
                payload.original_bill_number || null,
                supplierAccId,
                payload.supplier_name || 'Supplier',
                payload.return_mode || 'direct',
                payload.settlement_mode || 'Account Adjustment',
                payload.payment_account_id || null,
                round2(payload.subtotal_amount || netReturnAmt),
                round2(payload.discount_amount || 0),
                round2(payload.tax_amount || 0),
                netReturnAmt,
                refundReceived,
                round2(netReturnAmt - refundReceived),
                payload.reason || 'Purchase Return (Synced)',
                payload.notes || null
              );
            const newPrId = Number(ins.lastInsertRowid);
            try {
              db.prepare('UPDATE purchase_returns SET client_tx_id = ? WHERE id = ?').run(
                client_tx_id,
                newPrId
              );
            } catch {
              // ignore
            }

            for (const line of returnLines) {
              const itemId = Number(line.item_id || 0);
              const unitsReturned = Number(line.total_units_returned || line.quantity_returned || 0);
              const uPerPack = Math.max(1, Number(line.units_per_pack || 1));
              const packRet = Number(line.pack_qty || Math.floor(unitsReturned / uPerPack));
              const looseRet = Number(line.loose_qty || unitsReturned % uPerPack);

              db.prepare(`
                INSERT INTO purchase_return_items (
                  purchase_return_id, item_id, item_name, batch_id, batch_number,
                  units_per_pack, pack_qty, loose_qty, quantity_returned,
                  total_units_returned, purchase_price, discount_percent, discount_amount, line_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                newPrId,
                itemId,
                line.item_name || 'Item',
                line.batch_id || null,
                line.batch_number || 'DEFAULT',
                uPerPack,
                packRet,
                looseRet,
                unitsReturned,
                unitsReturned,
                round2(line.purchase_price || line.unit_price || 0),
                round2(line.discount_percent || 0),
                round2(line.discount_amount || 0),
                round2(line.line_total || 0)
              );

              if (itemId > 0 && unitsReturned > 0) {
                const batchRow = line.batch_id
                  ? (db.prepare('SELECT * FROM inventory WHERE id = ?').get(Number(line.batch_id)) as any)
                  : (db.prepare('SELECT * FROM inventory WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as any);
                if (batchRow) {
                  const prevUnits = Number(
                    batchRow.total_stock_units ?? batchRow.quantity_in_stock ?? 0
                  );
                  const nextTotalUnits = Math.max(0, prevUnits - unitsReturned);
                  const bUnitsPerPack = Math.max(1, Number(batchRow.units_per_pack || uPerPack));
                  db.prepare(`
                    UPDATE inventory
                    SET total_stock_units = ?,
                        current_pack_qty = ?,
                        quantity_in_stock = ?,
                        pack_quantity = ?,
                        loose_units = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                  `).run(
                    nextTotalUnits,
                    round2(nextTotalUnits / bUnitsPerPack),
                    nextTotalUnits,
                    Math.floor(nextTotalUnits / bUnitsPerPack),
                    nextTotalUnits % bUnitsPerPack,
                    batchRow.id
                  );
                }
              }
            }

            if (supplierAccId) recalculateAccountBalance(supplierAccId);
            if (payload.payment_account_id) recalculateAccountBalance(Number(payload.payment_account_id));
            return newPrId;
          })();

          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, invoice_number, status, payload_json)
            VALUES (?, ?, 'CREATE_PURCHASE_RETURN', 'purchase_returns', ?, ?, 'synced', ?)
          `).run(client_tx_id, deviceId, prId, returnNumber, JSON.stringify(payload));
          results.push({ client_tx_id, status: 'synced', server_id: prId, invoice_number: returnNumber });
        } else if (action === 'STOCK_ADJUSTMENT') {
          const itemId = Number(payload.item_id || 0);
          const batchId = payload.batch_id ? Number(payload.batch_id) : null;
          if (itemId > 0) {
            const batchRow = batchId
              ? (db.prepare('SELECT * FROM inventory WHERE id = ?').get(batchId) as any)
              : (db.prepare('SELECT * FROM inventory WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as any);
            if (batchRow) {
              const uPerPack = Math.max(1, Number(batchRow.units_per_pack || 1));
              const newPackQty =
                payload.new_pack_quantity !== undefined
                  ? Number(payload.new_pack_quantity)
                  : Number(batchRow.pack_quantity || 0);
              const newLooseUnits =
                payload.new_loose_units !== undefined
                  ? Number(payload.new_loose_units)
                  : Number(batchRow.loose_units || 0);
              const totalUnits =
                payload.new_total_units !== undefined
                  ? Number(payload.new_total_units)
                  : newPackQty * uPerPack + newLooseUnits;

              db.prepare(`
                UPDATE inventory
                SET total_stock_units = ?,
                    current_pack_qty = ?,
                    pack_quantity = ?,
                    loose_units = ?,
                    quantity_in_stock = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(
                totalUnits,
                round2(totalUnits / uPerPack),
                Math.floor(totalUnits / uPerPack),
                totalUnits % uPerPack,
                totalUnits,
                batchRow.id
              );
            }
          }
          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, entity_id, status, payload_json)
            VALUES (?, ?, 'STOCK_ADJUSTMENT', 'inventory', ?, 'synced', ?)
          `).run(client_tx_id, deviceId, itemId, JSON.stringify(payload));
          results.push({ client_tx_id, status: 'synced', server_id: itemId });
        } else {
          // Record other actions cleanly
          db.prepare(`
            INSERT OR REPLACE INTO sync_audit_log (client_tx_id, device_id, action, entity, status, payload_json)
            VALUES (?, ?, ?, 'vouchers', 'synced', ?)
          `).run(client_tx_id, deviceId, String(action), JSON.stringify(payload));
          results.push({ client_tx_id, status: 'synced' });
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ client_tx_id, status: 'failed', error: errorMsg });
      }
    }

    return res.json({
      success: true,
      deviceId,
      processedCount: results.length,
      results,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/sync/terminals
 * Super Admin & Counters: List all registered LAN computers/terminals
 */
syncRouter.get('/terminals', (_req: Request, res: Response) => {
  try {
    ensureSyncTables();
    const db = getDatabase();
    const terminals = db
      .prepare(`
        SELECT device_id, device_name, counter_name, terminal_type, notes,
               last_sync_at, ip_address, user_agent, created_at,
               CASE
                 WHEN datetime(last_sync_at, '+3 minutes') >= datetime('now') THEN 'online'
                 ELSE 'offline'
               END as connection_status
        FROM device_registry
        ORDER BY last_sync_at DESC
      `)
      .all();

    return res.json({ success: true, terminals });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/sync/register-terminal
 * Register or update counter name and LAN terminal details
 */
syncRouter.post('/register-terminal', (req: Request, res: Response) => {
  try {
    ensureSyncTables();
    const db = getDatabase();
    const device_id = req.body?.device_id || req.body?.deviceId;
    const device_name = req.body?.device_name || req.body?.deviceName;
    const counter_name = req.body?.counter_name || req.body?.counterName;
    const terminal_type = req.body?.terminal_type || req.body?.terminalType;
    const notes = req.body?.notes;

    if (!device_id) {
      return res.status(400).json({ success: false, error: 'device_id is required' });
    }

    db.prepare(`
      INSERT INTO device_registry (device_id, device_name, counter_name, terminal_type, notes, last_sync_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        device_name = COALESCE(excluded.device_name, device_registry.device_name),
        counter_name = COALESCE(excluded.counter_name, device_registry.counter_name),
        terminal_type = COALESCE(excluded.terminal_type, device_registry.terminal_type),
        notes = COALESCE(excluded.notes, device_registry.notes),
        last_sync_at = CURRENT_TIMESTAMP,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent
    `).run(
      device_id,
      device_name || 'Terminal',
      counter_name || 'Counter 1: Main Counter',
      terminal_type || 'Main Counter',
      notes || null,
      req.ip || '127.0.0.1',
      String(req.headers['user-agent'] || '')
    );

    const updated = db.prepare('SELECT * FROM device_registry WHERE device_id = ?').get(device_id);
    return res.json({ success: true, terminal: updated });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/sync/audit-logs
 * List sync history and audit trail
 */
syncRouter.get('/audit-logs', (req: Request, res: Response) => {
  try {
    ensureSyncTables();
    const db = getDatabase();
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
    const logs = db
      .prepare(`
        SELECT s.*, d.counter_name, d.device_name
        FROM sync_audit_log s
        LEFT JOIN device_registry d ON d.device_id = s.device_id
        ORDER BY s.id DESC
        LIMIT ?
      `)
      .all(limit);

    return res.json({ success: true, logs });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/sync/rehydrate
 * Non-destructively merges any client IndexedDB records that are missing on the server
 * (INSERT OR IGNORE, strictly respecting sync_tombstones so deleted records are never resurrected)
 * and persists the merged superset to Google Cloud Firestore.
 */
syncRouter.post('/rehydrate', authenticateToken, async (req: Request, res: Response) => {
  try {
    await ensureCloudPersistenceReady();
    ensureSyncTables();
    const rawBodyItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const rawBodyInvoices = Array.isArray(req.body?.invoices)
      ? req.body.invoices
      : Array.isArray(req.body?.sales)
      ? req.body.sales
      : [];
    const rawAccounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    const rawInventory = Array.isArray(req.body?.inventory) ? req.body.inventory : [];
    const rawPurchases = Array.isArray(req.body?.purchases) ? req.body.purchases : [];
    const rawVouchers = Array.isArray(req.body?.cashBookVouchers) ? req.body.cashBookVouchers : [];

    const result = hydrateSqliteFromCloudRecords(rawBodyItems, rawBodyInvoices, {
      accounts: rawAccounts,
      inventory: rawInventory,
      purchases: rawPurchases,
      cashBookVouchers: rawVouchers,
    });

    const totalRestored =
      result.restoredItems +
      result.restoredInvoices +
      result.restoredAccounts +
      result.restoredInventory +
      result.restoredPurchases +
      result.restoredVouchers;

    if (totalRestored > 0) {
      await syncDatabaseToCloudSQL('client_indexeddb_rehydrate');
    }

    return res.json({
      success: true,
      ...result,
      totalRestored,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * POST /api/sync/restore-cloud-records
 * Manual Super Admin endpoint only.
 */
syncRouter.post('/restore-cloud-records', authenticateToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as Request & { user?: { id?: number; username?: string; role?: string } }).user;
    if (!authUser || authUser.role !== 'Super Admin') {
      return res.status(403).json({
        success: false,
        error: 'Access Denied: Only Super Admin can perform a confirmed manual restore.',
      });
    }
    if (req.body?.confirmRestore !== true) {
      return res.status(400).json({
        success: false,
        error: 'Explicit confirmation (confirmRestore: true) is required to restore records manually.',
      });
    }

    await ensureCloudPersistenceReady();
    ensureSyncTables();
    const rawBodyItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const rawBodyInvoices = Array.isArray(req.body?.invoices)
      ? req.body.invoices
      : Array.isArray(req.body?.sales)
      ? req.body.sales
      : [];
    const rawAccounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    const rawInventory = Array.isArray(req.body?.inventory) ? req.body.inventory : [];
    const rawPurchases = Array.isArray(req.body?.purchases) ? req.body.purchases : [];
    const rawVouchers = Array.isArray(req.body?.cashBookVouchers) ? req.body.cashBookVouchers : [];

    const result = hydrateSqliteFromCloudRecords(rawBodyItems, rawBodyInvoices, {
      accounts: rawAccounts,
      inventory: rawInventory,
      purchases: rawPurchases,
      cashBookVouchers: rawVouchers,
    });

    const totalRestored =
      result.restoredItems +
      result.restoredInvoices +
      result.restoredAccounts +
      result.restoredInventory +
      result.restoredPurchases +
      result.restoredVouchers;

    if (totalRestored > 0) {
      await syncDatabaseToCloudSQL('restore-cloud-records');
    }

    return res.json({
      success: true,
      ...result,
      totalRestored,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});
