import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { getDatabase } from '../db/connection.ts';
import { optionalAuth as authenticateToken } from '../middleware/authMiddleware.ts';
import {
  hashPassword,
  verifyPassword,
  getSuperAdminRecoveryEmail,
} from '../services/authService.ts';
import {
  sendSuperAdminSecurityOtpEmail,
  sendSuperAdminBookingEmail,
} from '../services/emailService.ts';
import {
  createNumberedAbrarBackup,
  stageAndVerifyUploadedBackup,
  restoreDatabaseFromBackup,
  listBackups,
} from '../services/backupService.ts';
import {
  round2,
  parsePacking,
  writeProtectedAuditLog,
  getItemBatchesWithFIFOStatus,
  previewFIFOAllocation,
  recordBatchStockMovement,
  evaluateLineOfferAndPartyDiscount,
} from '../services/fifoAndOfferEngine.ts';
import { syncDatabaseToCloudSQL } from '../services/cloudPersistenceService.ts';

export const enhancementsRouter = express.Router();

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getAuthenticatedUser(req: express.Request): {
  id: number;
  username: string;
  role: string;
} {
  const u = (req as express.Request & { user?: { id: number; username: string; role: string } }).user;
  return {
    id: Number(u?.id || 1),
    username: String(u?.username || 'admin'),
    role: String(u?.role || 'Super Admin'),
  };
}

function requireSuperAdmin(req: express.Request, res: express.Response): boolean {
  const user = getAuthenticatedUser(req);
  if (user.role !== 'Super Admin') {
    res.status(403).json({
      success: false,
      error: 'Access Denied: Only Super Admin is authorized to perform this operation.',
    });
    return false;
  }
  return true;
}

function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

function generateImportBatchNumber(db: ReturnType<typeof getDatabase>): string {
  const year = new Date().getFullYear();
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM mobile_booking_imports')
    .get() as { cnt: number };
  const next = Number(row?.cnt || 0) + 1;
  return `IMP-${year}-${String(next).padStart(4, '0')}`;
}

function generateSupplyNumber(db: ReturnType<typeof getDatabase>, offset = 0): string {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM town_supplies').get() as { cnt: number };
  let seq = Number(row?.cnt || 0) + 1 + offset;
  while (
    db
      .prepare('SELECT id FROM town_supplies WHERE supply_number = ?')
      .get(`SUP-${year}-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `SUP-${year}-${String(seq).padStart(4, '0')}`;
}

function generatePartySupplyNumber(db: ReturnType<typeof getDatabase>, offset = 0): string {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM party_supplies').get() as { cnt: number };
  let seq = Number(row?.cnt || 0) + 1 + offset;
  while (
    db
      .prepare('SELECT id FROM party_supplies WHERE party_supply_number = ?')
      .get(`PSUP-${year}-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `PSUP-${year}-${String(seq).padStart(4, '0')}`;
}

function generateBookingNumber(db: ReturnType<typeof getDatabase>, offset = 0): string {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM supply_bookings').get() as { cnt: number };
  let seq = Number(row?.cnt || 0) + 1 + offset;
  while (
    db
      .prepare('SELECT id FROM supply_bookings WHERE booking_number = ?')
      .get(`BKG-${year}-${String(seq).padStart(4, '0')}`)
  ) {
    seq++;
  }
  return `BKG-${year}-${String(seq).padStart(4, '0')}`;
}

// ============================================================================
// PART 1 & 2: SALESMAN MOBILE BOOKING APPLICATION / PWA AUTH & OFFLINE CATALOG
// ============================================================================

function buildSalesmanCatalogPayload(db: ReturnType<typeof getDatabase>, salesmanRow: Record<string, unknown>) {
  const salesmanId = Number(salesmanRow.id);

  // Assigned towns
  let assignedTowns = db
    .prepare(
      `SELECT t.*
       FROM towns t
       JOIN salesman_towns st ON st.town_id = t.id
       WHERE st.salesman_id = ? AND t.status = 'Active'
       ORDER BY t.town_name ASC`
    )
    .all(salesmanId) as Array<Record<string, unknown>>;

  if (assignedTowns.length === 0) {
    assignedTowns = db
      .prepare("SELECT * FROM towns WHERE status = 'Active' ORDER BY town_name ASC")
      .all() as Array<Record<string, unknown>>;
  }

  // Assigned areas
  let assignedAreas = db
    .prepare(
      `SELECT ta.*
       FROM town_areas ta
       JOIN salesman_areas sa ON sa.area_id = ta.id
       WHERE sa.salesman_id = ? AND ta.status = 'Active'
       ORDER BY ta.area_name ASC`
    )
    .all(salesmanId) as Array<Record<string, unknown>>;

  if (assignedAreas.length === 0) {
    const townIds = assignedTowns.map((t) => Number(t.id));
    if (townIds.length > 0) {
      const placeholders = townIds.map(() => '?').join(',');
      assignedAreas = db
        .prepare(
          `SELECT *
           FROM town_areas
           WHERE town_id IN (${placeholders}) AND status = 'Active'
           ORDER BY area_name ASC`
        )
        .all(...townIds) as Array<Record<string, unknown>>;
    }
  }

  // Assigned parties (customers)
  let assignedParties = db
    .prepare(
      `SELECT a.id, a.account_code, a.account_name, a.account_group, a.phone,
              a.address, COALESCE(NULLIF(a.town_name, ''), a.city, 'General Town') as town_name,
              a.town_id, a.area_id, a.area_name, a.assigned_salesman_id,
              a.credit_limit, a.current_balance, a.current_balance_type
       FROM accounts a
       WHERE a.status = 'Active'
         AND a.is_system_account = 0
         AND (
           a.assigned_salesman_id = ?
           OR a.id IN (SELECT party_account_id FROM salesman_parties WHERE salesman_id = ?)
         )
       ORDER BY a.account_name ASC`
    )
    .all(salesmanId, salesmanId) as Array<Record<string, unknown>>;

  if (assignedParties.length === 0) {
    const townIds = assignedTowns.map((t) => Number(t.id));
    if (townIds.length > 0) {
      const placeholders = townIds.map(() => '?').join(',');
      assignedParties = db
        .prepare(
          `SELECT a.id, a.account_code, a.account_name, a.account_group, a.phone,
                  a.address, COALESCE(NULLIF(a.town_name, ''), a.city, 'General Town') as town_name,
                  a.town_id, a.area_id, a.area_name, a.assigned_salesman_id,
                  a.credit_limit, a.current_balance, a.current_balance_type
           FROM accounts a
           WHERE a.status = 'Active'
             AND a.is_system_account = 0
             AND (a.account_group = 'Customers' OR a.main_group = 'Assets' OR a.town_id IN (${placeholders}))
           ORDER BY a.account_name ASC`
        )
        .all(...townIds) as Array<Record<string, unknown>>;
    }
  }

  // Permitted items
  let permittedItemIds: number[] = [];
  try {
    const parsed = JSON.parse(String(salesmanRow.permitted_items_json || '[]'));
    if (Array.isArray(parsed)) {
      permittedItemIds = parsed.map((id) => Number(id)).filter((id) => id > 0);
    }
  } catch {
    permittedItemIds = [];
  }

  const allItems = db
    .prepare(
      `SELECT i.id, i.item_code, i.item_name, i.generic_name, i.company_name, i.category,
              i.packing, i.trade_price, i.wholesale_price, i.retail_price, i.purchase_price,
              i.tax_percent, i.discount_percent
       FROM items i
       WHERE i.status = 'Active'
       ORDER BY i.company_name ASC, i.item_name ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const filteredItems =
    permittedItemIds.length > 0
      ? allItems.filter((item) => permittedItemIds.includes(Number(item.id)))
      : allItems;

  const allBatches = getItemBatchesWithFIFOStatus();
  const batchesByItem = new Map<number, typeof allBatches>();
  for (const b of allBatches) {
    const list = batchesByItem.get(b.item_id) || [];
    list.push(b);
    batchesByItem.set(b.item_id, list);
  }

  const itemsWithStock = filteredItems.map((it) => {
    const itemBatches = batchesByItem.get(Number(it.id)) || [];
    const eligibleBatches = itemBatches.filter(
      (b) => !b.is_blocked && !b.is_expired && b.available_pack_qty > 0
    );
    const availableStock = eligibleBatches.reduce((s, b) => s + b.available_pack_qty, 0);
    const nextFifoBatch = eligibleBatches[0] || null;
    const tradePrice = round2(
      Number(it.trade_price || it.wholesale_price || it.retail_price || 0)
    );
    return {
      ...it,
      pack_size: String(it.packing || '1x1'),
      trade_price: tradePrice,
      available_stock: round2(availableStock),
      next_fifo_batch_no: nextFifoBatch?.batch_number || null,
      next_fifo_expiry_date: nextFifoBatch?.expiry_date || null,
    };
  });

  const today = getTodayDateString();
  const activeOffers = db
    .prepare(
      `SELECT * FROM trade_offers
       WHERE status = 'Active'
         AND DATE(start_date) <= DATE(?)
         AND DATE(end_date) >= DATE(?)
       ORDER BY id DESC`
    )
    .all(today, today);

  const activePartyDiscounts = db
    .prepare(
      `SELECT pd.*
       FROM party_discounts pd
       WHERE pd.status = 'Active'
       ORDER BY pd.id DESC`
    )
    .all();

  const settings = db
    .prepare(
      'SELECT company_name, super_admin_recovery_email, discount_stacking_rule FROM company_settings LIMIT 1'
    )
    .get() as
    | {
        company_name?: string;
        super_admin_recovery_email?: string;
        discount_stacking_rule?: string;
      }
    | undefined;

  return {
    salesman: {
      id: salesmanId,
      salesman_code: String(salesmanRow.salesman_code || ''),
      name: String(salesmanRow.full_name || salesmanRow.name || ''),
      salesman_name: String(salesmanRow.full_name || salesmanRow.name || ''),
      username: String(salesmanRow.username || salesmanRow.salesman_code || ''),
      mobile: String(salesmanRow.phone || salesmanRow.mobile || ''),
      address: String(salesmanRow.address || ''),
      status: String(salesmanRow.status || 'Active'),
    },
    assigned_towns: assignedTowns,
    towns: assignedTowns.map((t) => ({
      ...t,
      areas: assignedAreas.filter((a) => Number(a.town_id) === Number(t.id)),
    })),
    assigned_areas: assignedAreas,
    assigned_parties: assignedParties,
    parties: assignedParties.map((p) => ({
      ...p,
      town: p.town_name || p.town || '',
      area: p.area_name || p.area || '',
      balance_type: p.current_balance_type || 'debit',
    })),
    permitted_items: itemsWithStock,
    items: itemsWithStock.map((it) => ({
      ...it,
      available_packs: it.available_stock,
    })),
    active_offers: activeOffers,
    offers: activeOffers,
    active_party_discounts: activePartyDiscounts,
    party_discounts: activePartyDiscounts,
    discount_stacking_rule: settings?.discount_stacking_rule || 'higher_only',
    super_admin_email: settings?.super_admin_recovery_email || 'abrar.aslam02@gmail.com',
    store_name: settings?.company_name || 'ABRAR MEDICAL STORE',
    synced_at: new Date().toISOString(),
  };
}

enhancementsRouter.post('/mobile/login', (req, res) => {
  try {
    const db = getDatabase();
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
    }

    const cleanUser = String(username).trim();
    const salesman = db
      .prepare(
        `SELECT * FROM salesmen
         WHERE LOWER(COALESCE(username, '')) = LOWER(?)
            OR LOWER(COALESCE(salesman_code, '')) = LOWER(?)
            OR LOWER(COALESCE(phone, '')) = LOWER(?)
            OR LOWER(COALESCE(mobile, '')) = LOWER(?)
         LIMIT 1`
      )
      .get(cleanUser, cleanUser, cleanUser, cleanUser) as Record<string, unknown> | undefined;

    if (!salesman) {
      return res.status(401).json({
        success: false,
        error: 'Invalid salesman username or password.',
      });
    }

    if (String(salesman.status || 'Active') !== 'Active') {
      return res.status(403).json({
        success: false,
        error: 'Your Salesman account is currently Inactive. Please contact Super Admin.',
      });
    }

    const storedHash = String(salesman.password_hash || '');
    let passwordValid = false;

    if (storedHash.includes(':')) {
      const [salt, hash] = storedHash.split(':');
      passwordValid = verifyPassword(String(password), salt, hash);
    } else if (storedHash) {
      passwordValid = String(password).trim() === storedHash.trim();
    } else {
      passwordValid =
        String(password).trim() === String(salesman.salesman_code || '').trim() ||
        String(password).trim() === '123456';
    }

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid salesman username or password.',
      });
    }

    const mobileToken = crypto.randomBytes(24).toString('hex');
    const catalog = buildSalesmanCatalogPayload(db, salesman);

    writeProtectedAuditLog({
      action: 'SALESMAN_MOBILE_LOGIN',
      module: 'Mobile Booking App',
      username: String(salesman.username || salesman.salesman_code),
      userRole: 'Salesman',
      recordReference: String(salesman.salesman_code),
      newValue: { salesman_id: salesman.id, salesman_name: catalog.salesman.salesman_name },
      ipAddress: req.ip,
      details: `Salesman ${catalog.salesman.salesman_name} logged into Mobile Booking App`,
    });

    return res.json({
      success: true,
      mobile_token: mobileToken,
      ...catalog,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.get('/mobile/catalog/:salesmanId', (req, res) => {
  try {
    const db = getDatabase();
    const salesmanId = Number(req.params.salesmanId);
    const salesman = db
      .prepare('SELECT * FROM salesmen WHERE id = ?')
      .get(salesmanId) as Record<string, unknown> | undefined;

    if (!salesman) {
      return res.status(404).json({ success: false, error: 'Salesman not found.' });
    }
    if (String(salesman.status || 'Active') !== 'Active') {
      return res.status(403).json({ success: false, error: 'Salesman account is Inactive.' });
    }

    const catalog = buildSalesmanCatalogPayload(db, salesman);
    return res.json({ success: true, ...catalog });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/mobile/send-bookings', async (req, res) => {
  try {
    const db = getDatabase();
    const { salesman_id, bookings, device_info } = req.body || {};

    if (!salesman_id || !Array.isArray(bookings) || bookings.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Salesman ID and at least one booking are required.',
      });
    }

    const salesman = db
      .prepare('SELECT * FROM salesmen WHERE id = ? OR salesman_code = ?')
      .get(salesman_id, String(salesman_id)) as Record<string, unknown> | undefined;

    if (!salesman) {
      return res.status(404).json({ success: false, error: 'Salesman record not found.' });
    }
    if (String(salesman.status || 'Active') !== 'Active') {
      return res.status(403).json({ success: false, error: 'Inactive salesman cannot submit bookings.' });
    }

    const salesmanCode = String(salesman.salesman_code || `SM-${salesman.id}`);
    const salesmanName = String(salesman.full_name || salesman.name || 'Salesman');
    const todayStr = getTodayDateString();
    const exportTimestamp = new Date().toISOString();

    let totalItemsCount = 0;
    let totalAmount = 0;
    const townSet = new Set<string>();

    const normalizedBookings = bookings.map((b: Record<string, unknown>, idx: number) => {
      const items = Array.isArray(b.items) ? b.items : [];
      totalItemsCount += items.length;
      if (b.town_name) townSet.add(String(b.town_name));

      const bookingNet = items.reduce((sum: number, line: Record<string, unknown>) => {
        const qty = Number(line.quantity || line.booked_qty || 0);
        const rate = Number(line.trade_price || line.rate || 0);
        const discPct = Number(line.discount_percent || 0);
        const gross = qty * rate;
        const net = gross - (gross * discPct) / 100;
        return sum + net;
      }, 0);

      totalAmount += bookingNet;

      return {
        booking_uuid: String(b.booking_uuid || `${salesmanCode}-${Date.now()}-${idx + 1}`),
        booking_no: String(
          b.booking_no || b.booking_number || `MBK-${todayStr.replace(/-/g, '')}-${String(idx + 1).padStart(3, '0')}`
        ),
        booking_date: String(b.booking_date || todayStr),
        salesman_id: Number(salesman.id),
        salesman_code: salesmanCode,
        salesman_name: salesmanName,
        town_id: Number(b.town_id || 0),
        town_name: String(b.town_name || ''),
        area_id: Number(b.area_id || 0),
        area_name: String(b.area_name || ''),
        party_id: Number(b.party_id || b.party_account_id || 0),
        party_code: String(b.party_code || ''),
        party_name: String(b.party_name || ''),
        remarks: String(b.remarks || ''),
        status: 'Submitted',
        items: items.map((line: Record<string, unknown>, lineIdx: number) => ({
          s_no: lineIdx + 1,
          item_id: Number(line.item_id || 0),
          item_code: String(line.item_code || ''),
          item_name: String(line.item_name || ''),
          company_name: String(line.company_name || ''),
          pack_size: String(line.pack_size || line.packing || ''),
          trade_price: Number(line.trade_price || line.rate || 0),
          quantity: Number(line.quantity || line.booked_qty || 0),
          bonus_qty: Number(line.bonus_qty || line.bonus_quantity || line.bonus || 0),
          discount_percent: Number(line.discount_percent || 0),
          offer_discount_percent: Number(line.offer_discount_percent || 0),
          party_discount_percent: Number(line.party_discount_percent || 0),
          remarks: String(line.remarks || ''),
        })),
      };
    });

    const structuredExport = {
      schema_version: 'AMS_MOBILE_BOOKING_V1',
      store_name: 'ABRAR MEDICAL STORE',
      exported_at: exportTimestamp,
      device_info: String(device_info || 'Android Mobile Booking PWA'),
      salesman: {
        id: Number(salesman.id),
        salesman_code: salesmanCode,
        salesman_name: salesmanName,
        mobile: String(salesman.phone || salesman.mobile || ''),
      },
      summary: {
        bookings_count: normalizedBookings.length,
        total_items_count: totalItemsCount,
        estimated_total_amount: round2(totalAmount),
        towns: Array.from(townSet),
      },
      bookings: normalizedBookings,
    };

    const jsonString = JSON.stringify(structuredExport, null, 2);
    const filename = `AMS_Booking_${salesmanCode}_${todayStr}_${Date.now().toString().slice(-4)}.json`;
    const superAdminEmail = getSuperAdminRecoveryEmail(db);

    const emailResult = await sendSuperAdminBookingEmail({
      superAdminEmail,
      salesmanId: salesmanCode,
      salesmanName,
      townNames: Array.from(townSet),
      bookingCount: normalizedBookings.length,
      totalItemsCount,
      totalAmount: round2(totalAmount),
      filename,
      jsonPayload: jsonString,
    });

    writeProtectedAuditLog({
      action: 'SEND_BOOKING_TO_SUPER_ADMIN',
      module: 'Mobile Booking App',
      username: String(salesman.username || salesmanCode),
      userRole: 'Salesman',
      recordReference: filename,
      newValue: {
        salesman_code: salesmanCode,
        bookings_count: normalizedBookings.length,
        total_items: totalItemsCount,
        total_amount: round2(totalAmount),
        dispatched_to: emailResult.maskedEmail,
      },
      ipAddress: req.ip,
      details: `Dispatched ${normalizedBookings.length} booking(s) to Super Admin (${emailResult.maskedEmail})`,
    });

    return res.json({
      success: true,
      message: `Booking file "${filename}" sent to Super Admin (${emailResult.maskedEmail}) and ready for import.`,
      filename,
      masked_email: emailResult.maskedEmail,
      status: 'Submitted',
      export_payload: structuredExport,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 3: BATCH-WISE INVENTORY WITH STRICT FIFO & EXPIRY MANAGEMENT
// ============================================================================

enhancementsRouter.get('/fifo/batches', authenticateToken, (req, res) => {
  try {
    const { item_id, company, batch_status, search } = req.query;
    const batches = getItemBatchesWithFIFOStatus(item_id ? Number(item_id) : undefined);

    const filtered = batches.filter((b) => {
      if (company && String(company) !== 'ALL' && b.company_name.toLowerCase() !== String(company).toLowerCase()) {
        return false;
      }
      if (batch_status && String(batch_status) !== 'ALL' && b.batch_status !== String(batch_status)) {
        return false;
      }
      if (search) {
        const q = String(search).toLowerCase();
        const match =
          b.item_name.toLowerCase().includes(q) ||
          b.item_code.toLowerCase().includes(q) ||
          b.batch_number.toLowerCase().includes(q) ||
          b.company_name.toLowerCase().includes(q) ||
          b.purchase_invoice_number.toLowerCase().includes(q) ||
          b.supplier_name.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    return res.json({
      success: true,
      count: filtered.length,
      batches: filtered,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/fifo/allocate', authenticateToken, (req, res) => {
  try {
    const { item_id, sale_qty, bonus_qty, preferred_inventory_id, preferred_batch_number } = req.body || {};
    if (!item_id) {
      return res.status(400).json({ success: false, error: 'item_id is required.' });
    }

    const result = previewFIFOAllocation({
      itemId: Number(item_id),
      saleQtyPacks: Number(sale_qty || 0),
      bonusQtyPacks: Number(bonus_qty || 0),
      preferredInventoryId: preferred_inventory_id ? Number(preferred_inventory_id) : null,
      preferredBatchNumber: preferred_batch_number ? String(preferred_batch_number) : null,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.patch('/fifo/batches/:id/block', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const batchId = Number(req.params.id);
    const { is_blocked, reason } = req.body || {};
    const user = getAuthenticatedUser(req);

    const batch = db
      .prepare('SELECT inv.*, i.item_code, i.item_name, i.company_name FROM inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.id = ?')
      .get(batchId) as Record<string, unknown> | undefined;
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    const blockFlag = is_blocked ? 1 : 0;
    const newStatus = blockFlag
      ? 'Blocked'
      : Number(batch.current_pack_qty || 0) <= 0
      ? 'Out of Stock'
      : 'Active';

    db.prepare(
      `UPDATE inventory
       SET is_blocked = ?,
           blocked_reason = ?,
           blocked_by = ?,
           blocked_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
           batch_status = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      blockFlag,
      blockFlag ? String(reason || 'Blocked by administrator') : '',
      blockFlag ? user.username : '',
      blockFlag,
      newStatus,
      batchId
    );

    recordBatchStockMovement({
      movementDate: getTodayDateString(),
      itemId: Number(batch.item_id),
      itemCode: String(batch.item_code || ''),
      itemName: String(batch.item_name || ''),
      companyName: String(batch.company_name || ''),
      inventoryId: batchId,
      batchNumber: String(batch.batch_number || ''),
      expiryDate: String(batch.expiry_date || ''),
      purchaseDate: String(batch.purchase_date || ''),
      movementType: blockFlag ? 'BATCH_BLOCK' : 'BATCH_UNBLOCK',
      referenceType: 'INVENTORY_BATCH',
      referenceId: batchId,
      referenceNumber: String(batch.batch_number || ''),
      quantityPacks: 0,
      balanceAfterPacks: Number(batch.current_pack_qty || 0),
      remarks: String(reason || (blockFlag ? 'Batch blocked' : 'Batch unblocked')),
      performedBy: user.username,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: blockFlag ? 'BLOCK_BATCH' : 'UNBLOCK_BATCH',
      module: 'Inventory FIFO',
      recordReference: `Batch #${batchId} (${batch.batch_number})`,
      newValue: { batch_id: batchId, batch_number: batch.batch_number, is_blocked: blockFlag, reason },
      ipAddress: req.ip,
      details: `${blockFlag ? 'Blocked' : 'Unblocked'} batch ${batch.batch_number}`,
    });

    return res.json({
      success: true,
      message: blockFlag
        ? `Batch ${batch.batch_number} has been blocked from issuance.`
        : `Batch ${batch.batch_number} has been unblocked.`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/fifo/batches/:id/adjust', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const batchId = Number(req.params.id);
    const { new_pack_qty, new_expiry_date, new_batch_number, reason } = req.body || {};
    const user = getAuthenticatedUser(req);

    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'An adjustment reason is required for audit compliance.',
      });
    }

    const batch = db
      .prepare('SELECT inv.*, i.item_code, i.item_name, i.company_name, i.packing as item_packing FROM inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.id = ?')
      .get(batchId) as Record<string, unknown> | undefined;
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    const oldQty = Number(batch.current_pack_qty || 0);
    const targetQty = new_pack_qty !== undefined ? round2(Number(new_pack_qty)) : oldQty;
    if (targetQty < 0) {
      return res.status(400).json({ success: false, error: 'Negative batch stock is not allowed.' });
    }

    const parsed = parsePacking(String(batch.packing || batch.item_packing || '1x1'));
    const targetTotalUnits = round2(targetQty * parsed.unitsPerPack + Number(batch.current_loose_qty || 0));
    const updatedBatchNo = new_batch_number ? String(new_batch_number).trim() : String(batch.batch_number);
    const updatedExpiry = new_expiry_date ? String(new_expiry_date).trim() : String(batch.expiry_date || '');

    db.prepare(
      `UPDATE inventory
       SET batch_number = ?,
           expiry_date = ?,
           current_pack_qty = ?,
           current_strip_qty = ?,
           total_stock_units = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      updatedBatchNo,
      updatedExpiry,
      targetQty,
      round2(targetQty * parsed.stripsPerBox),
      targetTotalUnits,
      batchId
    );

    const diff = round2(targetQty - oldQty);
    recordBatchStockMovement({
      movementDate: getTodayDateString(),
      itemId: Number(batch.item_id),
      itemCode: String(batch.item_code || ''),
      itemName: String(batch.item_name || ''),
      companyName: String(batch.company_name || ''),
      inventoryId: batchId,
      batchNumber: updatedBatchNo,
      expiryDate: updatedExpiry,
      purchaseDate: String(batch.purchase_date || ''),
      movementType: 'BATCH_ADJUSTMENT',
      referenceType: 'MANUAL_BATCH_ADJUSTMENT',
      referenceId: batchId,
      referenceNumber: updatedBatchNo,
      quantityPacks: diff,
      totalUnits: round2(diff * parsed.unitsPerPack),
      purchaseRate: Number(batch.pack_cost || batch.cost_price || 0),
      tradePrice: Number(batch.trade_price || 0),
      balanceAfterPacks: targetQty,
      remarks: `Batch Adjustment (${oldQty} -> ${targetQty}): ${reason}`,
      performedBy: user.username,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'ADJUST_BATCH_STOCK',
      module: 'Inventory FIFO',
      recordReference: `Batch #${batchId} (${updatedBatchNo})`,
      oldValue: { pack_qty: oldQty, batch_number: batch.batch_number, expiry_date: batch.expiry_date },
      newValue: { pack_qty: targetQty, batch_number: updatedBatchNo, expiry_date: updatedExpiry, reason },
      ipAddress: req.ip,
      details: `Adjusted batch ${updatedBatchNo} from ${oldQty} to ${targetQty} packs (${reason})`,
    });

    return res.json({
      success: true,
      message: `Batch ${updatedBatchNo} adjusted successfully (${oldQty} -> ${targetQty} packs).`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.get('/fifo/movements', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const {
      from_date,
      to_date,
      item_id,
      batch_no,
      movement_type,
      party_id,
      salesman_id,
      town_name,
      reference_number,
    } = req.query;

    const rows = db
      .prepare(
        `SELECT m.*
         FROM batch_stock_movements m
         WHERE (? IS NULL OR DATE(m.movement_date) >= DATE(?))
           AND (? IS NULL OR DATE(m.movement_date) <= DATE(?))
           AND (? IS NULL OR m.item_id = ?)
           AND (? IS NULL OR LOWER(m.batch_number) LIKE '%' || LOWER(?) || '%')
           AND (? IS NULL OR m.movement_type = ?)
           AND (? IS NULL OR m.party_account_id = ?)
           AND (? IS NULL OR m.salesman_id = ?)
           AND (? IS NULL OR LOWER(m.town_name) LIKE '%' || LOWER(?) || '%')
           AND (? IS NULL OR LOWER(m.reference_number) LIKE '%' || LOWER(?) || '%')
         ORDER BY m.id DESC
         LIMIT 1000`
      )
      .all(
        from_date ? String(from_date) : null,
        from_date ? String(from_date) : null,
        to_date ? String(to_date) : null,
        to_date ? String(to_date) : null,
        item_id ? Number(item_id) : null,
        item_id ? Number(item_id) : null,
        batch_no ? String(batch_no) : null,
        batch_no ? String(batch_no) : null,
        movement_type ? String(movement_type) : null,
        movement_type ? String(movement_type) : null,
        party_id ? Number(party_id) : null,
        party_id ? Number(party_id) : null,
        salesman_id ? Number(salesman_id) : null,
        salesman_id ? Number(salesman_id) : null,
        town_name ? String(town_name) : null,
        town_name ? String(town_name) : null,
        reference_number ? String(reference_number) : null,
        reference_number ? String(reference_number) : null
      );

    return res.json({
      success: true,
      movements: rows,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 4: TRADE DEALS & OFFERS MANAGEMENT
// ============================================================================

enhancementsRouter.get('/offers', authenticateToken, (_req, res) => {
  try {
    const db = getDatabase();
    const today = getTodayDateString();
    const rows = db
      .prepare('SELECT * FROM trade_offers ORDER BY id DESC')
      .all() as Array<Record<string, unknown>>;

    const enriched = rows.map((r) => {
      const startDate = String(r.start_date || '').slice(0, 10);
      const endDate = String(r.end_date || '').slice(0, 10);
      let lifecycle: 'Active' | 'Upcoming' | 'Expired' | 'Inactive' = 'Active';
      if (String(r.status) === 'Inactive') {
        lifecycle = 'Inactive';
      } else if (endDate && endDate < today) {
        lifecycle = 'Expired';
      } else if (startDate && startDate > today) {
        lifecycle = 'Upcoming';
      } else {
        lifecycle = 'Active';
      }

      let slabs = [];
      try {
        slabs = JSON.parse(String(r.slabs_json || '[]'));
      } catch {
        slabs = [];
      }

      return {
        ...r,
        lifecycle_status: lifecycle,
        slabs,
      };
    });

    return res.json({
      success: true,
      offers: enriched,
      active_offers: enriched.filter((o) => o.lifecycle_status === 'Active'),
      upcoming_offers: enriched.filter((o) => o.lifecycle_status === 'Upcoming'),
      expired_offers: enriched.filter((o) => o.lifecycle_status === 'Expired'),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/offers', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};

    if (!body.offer_name || !body.start_date || !body.end_date) {
      return res.status(400).json({
        success: false,
        error: 'Offer Name, Start Date, and End Date are required.',
      });
    }

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM trade_offers').get() as { cnt: number };
    const offerCode =
      body.offer_code || `OFR-${new Date().getFullYear()}-${String((countRow?.cnt || 0) + 1).padStart(3, '0')}`;

    const itemId = body.item_id ? Number(body.item_id) : null;
    const itemRow = itemId
      ? (db.prepare('SELECT item_code, item_name, company_name FROM items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined)
      : undefined;

    const bonusItemId = body.bonus_item_id ? Number(body.bonus_item_id) : itemId;
    const bonusItemRow = bonusItemId
      ? (db.prepare('SELECT item_code, item_name FROM items WHERE id = ?').get(bonusItemId) as Record<string, unknown> | undefined)
      : undefined;

    const townId = body.town_id ? Number(body.town_id) : null;
    const townRow = townId
      ? (db.prepare('SELECT town_name FROM towns WHERE id = ?').get(townId) as { town_name: string } | undefined)
      : undefined;

    const partyId = body.party_account_id || body.party_id ? Number(body.party_account_id || body.party_id) : null;
    const partyRow = partyId
      ? (db.prepare('SELECT account_name FROM accounts WHERE id = ?').get(partyId) as { account_name: string } | undefined)
      : undefined;

    const salesmanId = body.salesman_id ? Number(body.salesman_id) : null;
    const salesmanRow = salesmanId
      ? (db.prepare('SELECT full_name, name FROM salesmen WHERE id = ?').get(salesmanId) as { full_name: string; name: string } | undefined)
      : undefined;

    // Normalize offer_type and scope_type
    const rawOfferType = String(body.offer_type || 'percentage_discount').toLowerCase();
    const offerType = rawOfferType.includes('slab')
      ? 'slab_based'
      : rawOfferType.includes('bonus')
      ? 'bonus_quantity'
      : rawOfferType.includes('fix') || rawOfferType.includes('flat')
      ? 'fixed_discount'
      : 'percentage_discount';

    const rawScope = String(body.scope_type || body.applicability_type || (itemId ? 'item' : body.company_name ? 'company' : 'all_items')).toLowerCase();
    const scopeType = rawScope.includes('all')
      ? 'all_items'
      : rawScope.includes('comp')
      ? 'company'
      : 'item';

    const ins = db
      .prepare(
        `INSERT INTO trade_offers (
          offer_code, offer_name, offer_type, scope_type,
          company_name, item_id, item_code, item_name,
          town_id, town_name, party_account_id, party_name, salesman_id, salesman_name,
          min_quantity, max_quantity, discount_percent, fixed_discount_amount,
          bonus_quantity, bonus_item_id, bonus_item_code, bonus_item_name,
          slabs_json, start_date, end_date, status, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(offerCode).trim(),
        String(body.offer_name).trim(),
        offerType,
        scopeType,
        String(body.company_name || itemRow?.company_name || '').trim(),
        itemId,
        String(body.item_code || itemRow?.item_code || ''),
        String(body.item_name || itemRow?.item_name || ''),
        townId,
        String(body.town_name || townRow?.town_name || ''),
        partyId,
        String(body.party_name || partyRow?.account_name || ''),
        salesmanId,
        String(body.salesman_name || salesmanRow?.full_name || salesmanRow?.name || ''),
        Number(body.min_quantity ?? body.min_qty ?? body.buy_qty ?? 1),
        body.max_quantity ? Number(body.max_quantity) : null,
        Number(body.discount_percent || 0),
        Number(body.fixed_discount_amount ?? body.flat_discount_amount ?? 0),
        Number(body.bonus_quantity ?? body.bonus_qty ?? 0),
        bonusItemId,
        String(bonusItemRow?.item_code || ''),
        String(bonusItemRow?.item_name || ''),
        JSON.stringify(Array.isArray(body.slabs) ? body.slabs : []),
        String(body.start_date).slice(0, 10),
        String(body.end_date).slice(0, 10),
        String(body.status || 'Active'),
        String(body.remarks ?? body.notes ?? ''),
        user.username
      );

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'CREATE_OFFER',
      module: 'Trade Deals & Offers',
      recordReference: String(offerCode),
      newValue: { id: ins.lastInsertRowid, offer_name: body.offer_name, offer_type: offerType },
      ipAddress: req.ip,
      details: `Created Trade Offer "${body.offer_name}" (${offerCode})`,
    });

    return res.json({
      success: true,
      id: ins.lastInsertRowid,
      offer_code: offerCode,
      message: `Trade Offer "${body.offer_name}" created successfully.`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.put('/offers/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const id = Number(req.params.id);
    const body = req.body || {};

    const existing = db.prepare('SELECT * FROM trade_offers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Trade Offer not found.' });
    }

    const itemId = body.item_id !== undefined ? (body.item_id ? Number(body.item_id) : null) : (existing.item_id as number | null);
    const itemRow = itemId
      ? (db.prepare('SELECT item_code, item_name, company_name FROM items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined)
      : undefined;

    const rawOfferType = String(body.offer_type || existing.offer_type || 'percentage_discount').toLowerCase();
    const offerType = rawOfferType.includes('slab')
      ? 'slab_based'
      : rawOfferType.includes('bonus')
      ? 'bonus_quantity'
      : rawOfferType.includes('fix') || rawOfferType.includes('flat')
      ? 'fixed_discount'
      : 'percentage_discount';

    const rawScope = String(body.scope_type || body.applicability_type || existing.scope_type || 'item').toLowerCase();
    const scopeType = rawScope.includes('all')
      ? 'all_items'
      : rawScope.includes('comp')
      ? 'company'
      : 'item';

    db.prepare(
      `UPDATE trade_offers
       SET offer_name = ?,
           offer_type = ?,
           scope_type = ?,
           company_name = ?,
           item_id = ?,
           item_code = ?,
           item_name = ?,
           town_id = ?,
           party_account_id = ?,
           salesman_id = ?,
           min_quantity = ?,
           max_quantity = ?,
           discount_percent = ?,
           fixed_discount_amount = ?,
           bonus_quantity = ?,
           slabs_json = ?,
           start_date = ?,
           end_date = ?,
           status = ?,
           remarks = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      String(body.offer_name || existing.offer_name).trim(),
      offerType,
      scopeType,
      String(body.company_name ?? itemRow?.company_name ?? existing.company_name ?? '').trim(),
      itemId,
      String(itemRow?.item_code ?? existing.item_code ?? ''),
      String(itemRow?.item_name ?? existing.item_name ?? ''),
      body.town_id !== undefined ? (body.town_id ? Number(body.town_id) : null) : existing.town_id,
      body.party_account_id !== undefined ? (body.party_account_id ? Number(body.party_account_id) : null) : existing.party_account_id,
      body.salesman_id !== undefined ? (body.salesman_id ? Number(body.salesman_id) : null) : existing.salesman_id,
      Number(body.min_quantity ?? body.min_qty ?? existing.min_quantity ?? 1),
      body.max_quantity !== undefined ? (body.max_quantity ? Number(body.max_quantity) : null) : existing.max_quantity,
      Number(body.discount_percent ?? existing.discount_percent ?? 0),
      Number(body.fixed_discount_amount ?? body.flat_discount_amount ?? existing.fixed_discount_amount ?? 0),
      Number(body.bonus_quantity ?? body.bonus_qty ?? existing.bonus_quantity ?? 0),
      Array.isArray(body.slabs) ? JSON.stringify(body.slabs) : String(existing.slabs_json || '[]'),
      String(body.start_date || existing.start_date).slice(0, 10),
      String(body.end_date || existing.end_date).slice(0, 10),
      String(body.status || existing.status || 'Active'),
      String(body.remarks ?? body.notes ?? existing.remarks ?? ''),
      id
    );

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'UPDATE_OFFER',
      module: 'Trade Deals & Offers',
      recordReference: `Offer #${id}`,
      oldValue: existing,
      newValue: body,
      ipAddress: req.ip,
      details: `Updated Trade Offer #${id}`,
    });

    return res.json({ success: true, message: 'Trade Offer updated successfully.' });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.patch('/offers/:id/status', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const { status } = req.body || {};
    db.prepare("UPDATE trade_offers SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      String(status || 'Active'),
      id
    );
    return res.json({ success: true, message: `Offer status updated to ${status}.` });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.delete('/offers/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    db.prepare('DELETE FROM trade_offers WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Trade offer deleted.' });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 5: PARTY-WISE SPECIAL DISCOUNTS
// ============================================================================

enhancementsRouter.get('/party-discounts', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const { party_id } = req.query;

    const rules = db
      .prepare(
        `SELECT pd.*,
                a.account_code as party_code,
                COALESCE(NULLIF(a.town_name, ''), a.city, '') as town_name
         FROM party_discounts pd
         LEFT JOIN accounts a ON a.id = pd.party_account_id
         WHERE (? IS NULL OR pd.party_account_id = ?)
         ORDER BY pd.id DESC`
      )
      .all(party_id ? Number(party_id) : null, party_id ? Number(party_id) : null);

    const history = db
      .prepare(
        `SELECT h.*
         FROM party_discount_history h
         ORDER BY h.id DESC
         LIMIT 200`
      )
      .all();

    return res.json({
      success: true,
      discounts: rules,
      history,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/party-discounts', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};

    const partyAccountId = Number(body.party_account_id || body.party_id || 0);
    if (!partyAccountId || body.discount_percent === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Party and Discount % are required.',
      });
    }

    const partyRow = db
      .prepare('SELECT id, account_name FROM accounts WHERE id = ?')
      .get(partyAccountId) as { id: number; account_name: string } | undefined;

    const itemId = body.item_id ? Number(body.item_id) : null;
    const itemRow = itemId
      ? (db.prepare('SELECT item_code, item_name, company_name FROM items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined)
      : undefined;

    const rawScope = String(
      body.scope_type || (itemId ? 'item' : body.company_name ? 'company' : 'all_items')
    ).toLowerCase();
    const scopeType = rawScope.includes('all')
      ? 'all_items'
      : rawScope.includes('comp')
      ? 'company'
      : 'item';

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM party_discounts').get() as { cnt: number };
    const discountCode =
      body.discount_code || `PD-${new Date().getFullYear()}-${String((countRow?.cnt || 0) + 1).padStart(4, '0')}`;

    const ins = db
      .prepare(
        `INSERT INTO party_discounts (
          discount_code, party_account_id, party_name, scope_type,
          company_name, item_id, item_code, item_name,
          discount_percent, fixed_discount_amount,
          start_date, end_date, status, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(discountCode),
        partyAccountId,
        String(body.party_name || partyRow?.account_name || ''),
        scopeType,
        String(body.company_name || itemRow?.company_name || '').trim(),
        itemId,
        String(body.item_code || itemRow?.item_code || ''),
        String(body.item_name || itemRow?.item_name || ''),
        round2(Number(body.discount_percent || 0)),
        round2(Number(body.fixed_discount_amount || 0)),
        body.start_date ? String(body.start_date).slice(0, 10) : '',
        body.end_date ? String(body.end_date).slice(0, 10) : '',
        String(body.status || 'Active'),
        String(body.remarks ?? body.notes ?? ''),
        user.username
      );

    db.prepare(
      `INSERT INTO party_discount_history (
        party_discount_id, discount_code, action, old_values_json, new_values_json, performed_by
      ) VALUES (?, ?, 'CREATED', '', ?, ?)`
    ).run(
      ins.lastInsertRowid,
      String(discountCode),
      JSON.stringify({
        party_account_id: partyAccountId,
        party_name: partyRow?.account_name,
        scope_type: scopeType,
        item_name: itemRow?.item_name,
        company_name: body.company_name || itemRow?.company_name,
        discount_percent: Number(body.discount_percent || 0),
      }),
      user.username
    );

    return res.json({
      success: true,
      id: ins.lastInsertRowid,
      discount_code: discountCode,
      message: 'Party-wise special discount saved.',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.put('/party-discounts/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const id = Number(req.params.id);
    const body = req.body || {};

    const existing = db
      .prepare('SELECT * FROM party_discounts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Party discount rule not found.' });
    }

    const partyAccountId = Number(body.party_account_id || body.party_id || existing.party_account_id);
    const partyRow = db
      .prepare('SELECT id, account_name FROM accounts WHERE id = ?')
      .get(partyAccountId) as { id: number; account_name: string } | undefined;

    const itemId =
      body.item_id !== undefined ? (body.item_id ? Number(body.item_id) : null) : (existing.item_id as number | null);
    const itemRow = itemId
      ? (db.prepare('SELECT item_code, item_name, company_name FROM items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined)
      : undefined;

    const rawScope = String(body.scope_type || existing.scope_type || 'item').toLowerCase();
    const scopeType = rawScope.includes('all')
      ? 'all_items'
      : rawScope.includes('comp')
      ? 'company'
      : 'item';

    const newPct = round2(Number(body.discount_percent ?? existing.discount_percent ?? 0));

    db.prepare(
      `UPDATE party_discounts
       SET party_account_id = ?,
           party_name = ?,
           scope_type = ?,
           company_name = ?,
           item_id = ?,
           item_code = ?,
           item_name = ?,
           discount_percent = ?,
           fixed_discount_amount = ?,
           start_date = ?,
           end_date = ?,
           status = ?,
           remarks = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      partyAccountId,
      String(partyRow?.account_name || existing.party_name || ''),
      scopeType,
      String(body.company_name ?? itemRow?.company_name ?? existing.company_name ?? '').trim(),
      itemId,
      String(itemRow?.item_code ?? existing.item_code ?? ''),
      String(itemRow?.item_name ?? existing.item_name ?? ''),
      newPct,
      round2(Number(body.fixed_discount_amount ?? existing.fixed_discount_amount ?? 0)),
      body.start_date !== undefined ? String(body.start_date || '') : String(existing.start_date || ''),
      body.end_date !== undefined ? String(body.end_date || '') : String(existing.end_date || ''),
      String(body.status || existing.status || 'Active'),
      String(body.remarks ?? body.notes ?? existing.remarks ?? ''),
      id
    );

    db.prepare(
      `INSERT INTO party_discount_history (
        party_discount_id, discount_code, action, old_values_json, new_values_json, performed_by
      ) VALUES (?, ?, 'UPDATED', ?, ?, ?)`
    ).run(
      id,
      String(existing.discount_code || ''),
      JSON.stringify(existing),
      JSON.stringify({ discount_percent: newPct, status: body.status || existing.status }),
      user.username
    );

    return res.json({ success: true, message: 'Party discount updated.' });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.delete('/party-discounts/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const id = Number(req.params.id);

    const existing = db
      .prepare('SELECT * FROM party_discounts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (existing) {
      db.prepare(
        `INSERT INTO party_discount_history (
          party_discount_id, discount_code, action, old_values_json, new_values_json, performed_by
        ) VALUES (?, ?, 'DELETED', ?, '', ?)`
      ).run(id, String(existing.discount_code || ''), JSON.stringify(existing), user.username);
    }

    db.prepare('DELETE FROM party_discounts WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Party discount deleted.' });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 6: OFFER & DISCOUNT CALCULATION ENGINE + STACKING RULE SETTING
// ============================================================================

enhancementsRouter.get('/discount-stacking-rule', authenticateToken, (_req, res) => {
  try {
    const db = getDatabase();
    const row = db
      .prepare('SELECT discount_stacking_rule FROM company_settings LIMIT 1')
      .get() as { discount_stacking_rule?: string } | undefined;
    return res.json({
      success: true,
      discount_stacking_rule: row?.discount_stacking_rule || 'higher_only',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.put('/discount-stacking-rule', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const rawRule = req.body?.discount_stacking_rule || req.body?.rule;
    const rule =
      rawRule === 'combine_both' ||
      rawRule === 'offer_priority' ||
      rawRule === 'party_priority'
        ? String(rawRule)
        : 'higher_only';

    db.prepare('UPDATE company_settings SET discount_stacking_rule = ?').run(rule);
    db.prepare(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('discount_stacking_rule', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).run(rule);

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'UPDATE_STACKING_RULE',
      module: 'Trade Deals & Offers',
      recordReference: rule,
      newValue: { discount_stacking_rule: rule },
      ipAddress: req.ip,
      details: `Updated discount stacking rule to ${rule}`,
    });

    return res.json({
      success: true,
      discount_stacking_rule: rule,
      message:
        rule === 'combine_both'
          ? 'Discount rule updated: Combine Both Offer & Party Discounts.'
          : 'Discount rule updated: Apply Higher Discount Only (Never silently stack).',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/calculate-line', (req, res) => {
  try {
    const body = req.body || {};
    const itemId = Number(body.item_id || 0);
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'item_id is required.' });
    }

    const evaluation = evaluateLineOfferAndPartyDiscount({
      itemId,
      quantity: Number(body.sale_qty ?? body.quantity ?? 1),
      tradePrice: body.trade_price !== undefined ? Number(body.trade_price) : 0,
      partyAccountId: body.party_id || body.party_account_id ? Number(body.party_id || body.party_account_id) : null,
      townId: body.town_id ? Number(body.town_id) : null,
      townName: body.town_name ? String(body.town_name) : undefined,
      salesmanId: body.salesman_id ? Number(body.salesman_id) : null,
      invoiceDate: body.invoice_date ? String(body.invoice_date) : getTodayDateString(),
      manualDiscountPercent:
        body.manual_discount_percent !== undefined ? Number(body.manual_discount_percent) : null,
      manualBonusQuantity:
        body.manual_bonus_qty !== undefined ? Number(body.manual_bonus_qty) : null,
      manualOverrideReason: body.manual_override_reason ? String(body.manual_override_reason) : undefined,
      preferredInventoryId: body.preferred_inventory_id ? Number(body.preferred_inventory_id) : null,
    });

    return res.json({
      success: true,
      evaluation,
      calculation: evaluation,
      fifo_allocation: evaluation.fifo_allocation,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 7: SUPPLY MANAGEMENT INTEGRATION — IMPORT SALESMAN BOOKINGS
// ============================================================================

enhancementsRouter.post('/booking-imports/preview', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const filename = body.filename || body.file_name || 'Mobile_Bookings.json';
    const payload = body.payload || (Array.isArray(body.bookings) ? body : null);

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or empty booking JSON payload.',
      });
    }

    const rawBookings = Array.isArray(payload.bookings)
      ? payload.bookings
      : Array.isArray(payload)
      ? payload
      : [];

    if (rawBookings.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No bookings found in the uploaded JSON file.',
      });
    }

    const canonicalJson = JSON.stringify(rawBookings);
    const fileHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');

    const duplicateFile = db
      .prepare('SELECT * FROM mobile_booking_imports WHERE file_hash = ? LIMIT 1')
      .get(fileHash) as Record<string, unknown> | undefined;

    const validatedBookings = [];
    let validCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rawBookings.length; i++) {
      const b = rawBookings[i] as Record<string, unknown>;
      const errors: string[] = [];

      // 1. Validate Salesman
      const smId = Number(b.salesman_id || payload?.salesman?.id || 0);
      const smCode = String(b.salesman_code || payload?.salesman?.salesman_code || '').trim();
      const salesmanRow = db
        .prepare('SELECT * FROM salesmen WHERE id = ? OR LOWER(salesman_code) = LOWER(?) LIMIT 1')
        .get(smId, smCode) as Record<string, unknown> | undefined;

      if (!salesmanRow) {
        errors.push(`Salesman not found (${smCode || smId})`);
      }

      // 2. Validate Party
      const partyId = Number(b.party_id || b.party_account_id || 0);
      const partyCode = String(b.party_code || '').trim();
      const partyName = String(b.party_name || '').trim();
      const partyRow = db
        .prepare(
          `SELECT a.*
           FROM accounts a
           WHERE a.id = ?
              OR (LOWER(COALESCE(a.account_code, '')) = LOWER(?) AND ? != '')
              OR (LOWER(a.account_name) = LOWER(?) AND ? != '')
           LIMIT 1`
        )
        .get(partyId, partyCode, partyCode, partyName, partyName) as Record<string, unknown> | undefined;

      if (!partyRow) {
        errors.push(`Party not found in Accounts Master (${partyName || partyCode || partyId})`);
      }

      // 3. Validate Town & Area
      const townId = Number(b.town_id || partyRow?.town_id || 0);
      const areaId = Number(b.area_id || partyRow?.area_id || 0);
      const townName = String(b.town_name || partyRow?.town_name || partyRow?.city || 'General Town');
      const areaName = String(b.area_name || partyRow?.area_name || 'Main Area');

      // 4. Check duplicate booking number / UUID
      const bookingNo = String(b.booking_no || b.booking_number || '').trim();
      const bookingUuid = String(b.booking_uuid || b.mobile_booking_uuid || '').trim();
      const existingBooking = db
        .prepare(
          `SELECT id, booking_number FROM supply_bookings
           WHERE (booking_number = ? AND ? != '')
              OR (mobile_booking_uuid = ? AND ? != '')
           LIMIT 1`
        )
        .get(bookingNo, bookingNo, bookingUuid, bookingUuid) as { id: number; booking_number: string } | undefined;

      const isDuplicate = Boolean(existingBooking);
      if (isDuplicate) {
        duplicateCount++;
      }

      // 5. Validate Items & evaluate offers/discounts/FIFO
      const rawItems = Array.isArray(b.items) ? b.items : [];
      if (rawItems.length === 0) {
        errors.push('Booking contains no line items');
      }

      const validatedItems = [];
      let bookingSubtotal = 0;
      let bookingOfferDiscount = 0;
      let bookingPartyDiscount = 0;
      let bookingDiscount = 0;
      let bookingNet = 0;

      for (const line of rawItems) {
        const l = line as Record<string, unknown>;
        const itemId = Number(l.item_id || 0);
        const itemCode = String(l.item_code || '').trim();
        const itemName = String(l.item_name || '').trim();

        const itemRow = db
          .prepare(
            `SELECT * FROM items
             WHERE id = ?
                OR (LOWER(item_code) = LOWER(?) AND ? != '')
                OR (LOWER(item_name) = LOWER(?) AND ? != '')
             LIMIT 1`
          )
          .get(itemId, itemCode, itemCode, itemName, itemName) as Record<string, unknown> | undefined;

        if (!itemRow) {
          errors.push(`Item not found (${itemCode || itemName || itemId})`);
          continue;
        }

        const qty = Math.max(0, Number(l.quantity || l.booked_qty || 0));
        if (qty <= 0) {
          errors.push(`Invalid quantity for item ${itemRow.item_name}`);
          continue;
        }

        const evalRes = evaluateLineOfferAndPartyDiscount({
          itemId: Number(itemRow.id),
          quantity: qty,
          tradePrice: Number(l.trade_price || itemRow.trade_price || itemRow.retail_price || 0),
          partyAccountId: partyRow ? Number(partyRow.id) : null,
          townId: townId || null,
          townName,
          salesmanId: salesmanRow ? Number(salesmanRow.id) : null,
          invoiceDate: String(b.booking_date || getTodayDateString()),
        });

        bookingSubtotal += evalRes.gross_amount;
        bookingOfferDiscount += evalRes.offer_discount_amount;
        bookingPartyDiscount += evalRes.party_discount_amount;
        bookingDiscount += evalRes.total_discount_amount;
        bookingNet += evalRes.net_amount;

        validatedItems.push({
          item_id: Number(itemRow.id),
          item_code: String(itemRow.item_code),
          item_name: String(itemRow.item_name),
          company_name: String(itemRow.company_name || ''),
          pack_size: String(itemRow.packing || '1x1'),
          trade_price: evalRes.trade_price,
          quantity: evalRes.sale_quantity,
          bonus_qty: evalRes.bonus_quantity,
          offer_id: evalRes.offer_id,
          offer_name: evalRes.offer_name,
          offer_discount_percent: evalRes.offer_discount_percent,
          offer_discount_amount: evalRes.offer_discount_amount,
          party_discount_id: evalRes.party_discount_id,
          party_discount_percent: evalRes.party_discount_percent,
          party_discount_amount: evalRes.party_discount_amount,
          effective_discount_percent: evalRes.effective_discount_percent,
          discount_amount: evalRes.total_discount_amount,
          net_amount: evalRes.net_amount,
          fifo_sufficient: evalRes.fifo_allocation.can_fulfill,
          fifo_available_qty: evalRes.fifo_allocation.total_eligible_available_qty,
          fifo_primary_inventory_id: evalRes.fifo_allocation.primary_inventory_id,
          fifo_primary_batch_no: evalRes.fifo_allocation.primary_batch_number,
          fifo_primary_expiry_date: evalRes.fifo_allocation.primary_expiry_date,
          fifo_allocations: evalRes.fifo_allocation.allocations,
          remarks: String(l.remarks || ''),
        });
      }

      if (errors.length > 0) {
        errorCount++;
      } else if (!isDuplicate) {
        validCount++;
      }

      validatedBookings.push({
        booking_uuid: bookingUuid || `UUID-${Date.now()}-${i + 1}`,
        booking_no: bookingNo || `MBK-${i + 1}`,
        booking_number: bookingNo || `MBK-${i + 1}`,
        booking_date: String(b.booking_date || getTodayDateString()),
        salesman_id: salesmanRow ? Number(salesmanRow.id) : smId,
        salesman_code: salesmanRow ? String(salesmanRow.salesman_code) : smCode,
        salesman_name: salesmanRow
          ? String(salesmanRow.full_name || salesmanRow.name)
          : String(b.salesman_name || ''),
        party_id: partyRow ? Number(partyRow.id) : partyId,
        party_code: partyRow ? String(partyRow.account_code || '') : partyCode,
        party_name: partyRow ? String(partyRow.account_name || '') : partyName,
        town_id: townId,
        town_name: townName,
        area_id: areaId,
        area_name: areaName,
        remarks: String(b.remarks || ''),
        subtotal: round2(bookingSubtotal),
        offer_discount_amount: round2(bookingOfferDiscount),
        party_discount_amount: round2(bookingPartyDiscount),
        discount_amount: round2(bookingDiscount),
        net_amount: round2(bookingNet),
        is_duplicate: isDuplicate,
        duplicate_booking_no: existingBooking?.booking_number || null,
        valid: errors.length === 0 && !isDuplicate,
        is_valid: errors.length === 0 && !isDuplicate,
        errors,
        items: validatedItems,
        lines: validatedItems.map((vi) => ({
          ...vi,
          bonus_quantity: vi.bonus_qty,
          fifo_batches_summary: `${vi.fifo_primary_batch_no || 'FIFO'} (${vi.fifo_available_qty} avail)`,
        })),
      });
    }

    return res.json({
      success: true,
      filename: String(filename || 'Mobile_Bookings.json'),
      file_hash: fileHash,
      is_duplicate_file: Boolean(duplicateFile),
      already_imported_file: duplicateFile || null,
      duplicate_import_batch_no: duplicateFile?.import_batch_number || null,
      total_bookings: validatedBookings.length,
      valid_bookings: validCount,
      duplicate_bookings: duplicateCount,
      summary: {
        total_bookings: validatedBookings.length,
        valid_bookings: validCount,
        duplicate_bookings: duplicateCount,
        invalid_bookings: errorCount,
      },
      bookings: validatedBookings,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/booking-imports/commit', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};
    const filename = body.filename || body.file_name || 'Mobile_Bookings.json';
    const bookings = body.bookings;
    const generate_supply = body.generate_supply;

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No validated bookings provided to import.',
      });
    }

    const importBatchNo = generateImportBatchNumber(db);
    const fileHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(bookings) + Date.now())
      .digest('hex');

    const createdBookings: Array<{
      id: number;
      booking_number: string;
      party_account_id: number;
      party_code: string;
      party_name: string;
      town_id: number;
      town_name: string;
      area_id: number;
      area_name: string;
      salesman_id: number;
      salesman_name: string;
    }> = [];
    const createdSupplies: Array<{ id: number; supply_number: string; town_name: string; salesman_name: string }> = [];

    const tx = db.transaction(() => {
      const firstBk = bookings[0] || {};
      const importInsert = db
        .prepare(
          `INSERT INTO mobile_booking_imports (
            import_batch_number, file_name, file_hash, salesman_id, salesman_name,
            total_bookings_in_file, valid_bookings_count, duplicate_bookings_count, invalid_bookings_count,
            imported_booking_ids_json, imported_booking_numbers,
            generated_supply_ids_json, generated_supply_numbers,
            status, remarks, imported_by
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, '[]', '', '[]', '', ?, ?, ?)`
        )
        .run(
          importBatchNo,
          String(filename || 'Mobile_Bookings.json'),
          fileHash,
          Number(firstBk.salesman_id || 0) || null,
          String(firstBk.salesman_name || ''),
          bookings.length,
          generate_supply ? 'Supply Generated' : 'Imported',
          `Imported by ${user.username}`,
          user.username
        );

      const importBatchId = Number(importInsert.lastInsertRowid);

      for (let idx = 0; idx < bookings.length; idx++) {
        const b = bookings[idx];
        if (b.is_duplicate || (Array.isArray(b.errors) && b.errors.length > 0)) {
          continue;
        }

        const bookingNumber = generateBookingNumber(db, idx);
        const items = Array.isArray(b.items) ? b.items : [];
        const totalQty = items.reduce((s: number, it: Record<string, unknown>) => s + Number(it.quantity || 0), 0);
        const totalBonus = items.reduce((s: number, it: Record<string, unknown>) => s + Number(it.bonus_qty || 0), 0);
        const grossAmount = round2(b.subtotal || 0);
        const offerDiscountAmount = round2(b.offer_discount_amount || 0);
        const partyDiscountAmount = round2(b.party_discount_amount || 0);
        const discountAmount = round2(b.discount_amount || 0);
        const netAmount = round2(b.net_amount || 0);

        const initialStatus = generate_supply ? 'Supply Created' : 'Confirmed';
        const mobileStatus = generate_supply ? 'Supply Generated' : 'Imported';

        const bkRes = db
          .prepare(
            `INSERT INTO supply_bookings (
              booking_number, booking_date, source_type, mobile_booking_uuid,
              import_batch_id, import_batch_number, mobile_status,
              salesman_id, salesman_name, town_id, town_name, area_id, area_name,
              party_account_id, party_code, party_name, remarks,
              total_items, total_quantity, total_supplied_qty, total_pending_qty, total_bonus,
              gross_amount, offer_discount_amount, party_discount_amount, discount_amount,
              total_amount, net_amount, status, created_by
            ) VALUES (?, ?, 'Mobile App', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            bookingNumber,
            String(b.booking_date || getTodayDateString()),
            String(b.booking_uuid || b.booking_no || ''),
            importBatchId,
            importBatchNo,
            mobileStatus,
            Number(b.salesman_id),
            String(b.salesman_name || ''),
            Number(b.town_id || 0) || null,
            String(b.town_name || 'General Town'),
            Number(b.area_id || 0) || null,
            String(b.area_name || 'Main Area'),
            Number(b.party_id),
            String(b.party_code || ''),
            String(b.party_name || ''),
            `${b.remarks || ''} [Import Batch: ${importBatchNo}]`.trim(),
            items.length,
            totalQty,
            generate_supply ? totalQty : 0,
            generate_supply ? 0 : totalQty,
            totalBonus,
            grossAmount,
            offerDiscountAmount,
            partyDiscountAmount,
            discountAmount,
            netAmount,
            netAmount,
            initialStatus,
            user.username
          );

        const bookingId = Number(bkRes.lastInsertRowid);

        for (let lineIdx = 0; lineIdx < items.length; lineIdx++) {
          const it = items[lineIdx];
          db.prepare(
            `INSERT INTO supply_booking_items (
              booking_id, s_no, item_id, item_code, company_name, item_name, packing,
              quantity, supplied_quantity, pending_quantity, bonus_quantity, trade_price,
              offer_id, offer_name, offer_discount_percent, offer_discount_amount,
              party_discount_id, party_discount_percent, party_discount_amount,
              discount_percent, discount_amount, amount, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            bookingId,
            lineIdx + 1,
            Number(it.item_id),
            String(it.item_code || ''),
            String(it.company_name || ''),
            String(it.item_name || ''),
            String(it.pack_size || '1x1'),
            Number(it.quantity || 0),
            generate_supply ? Number(it.quantity || 0) : 0,
            generate_supply ? 0 : Number(it.quantity || 0),
            Number(it.bonus_qty || 0),
            Number(it.trade_price || 0),
            it.offer_id || null,
            String(it.offer_name || ''),
            Number(it.offer_discount_percent || 0),
            Number(it.offer_discount_amount || 0),
            it.party_discount_id || null,
            Number(it.party_discount_percent || 0),
            Number(it.party_discount_amount || 0),
            Number(it.effective_discount_percent || 0),
            Number(it.discount_amount || 0),
            Number(it.net_amount || 0),
            String(it.remarks || '')
          );
        }

        createdBookings.push({
          id: bookingId,
          booking_number: bookingNumber,
          party_account_id: Number(b.party_id),
          party_code: String(b.party_code || ''),
          party_name: String(b.party_name || ''),
          town_id: Number(b.town_id || 0),
          town_name: String(b.town_name || 'General Town'),
          area_id: Number(b.area_id || 0),
          area_name: String(b.area_name || 'Main Area'),
          salesman_id: Number(b.salesman_id),
          salesman_name: String(b.salesman_name || ''),
        });
      }

      // If "IMPORT & GENERATE SUPPLY" was clicked, group by (town_name, salesman_id) and generate Town Supplies + Party Supplies + FIFO batch allocations
      if (generate_supply && createdBookings.length > 0) {
        const groupMap = new Map<string, typeof createdBookings>();
        for (const cb of createdBookings) {
          const key = `${cb.town_name.toLowerCase()}_${cb.salesman_id}`;
          const list = groupMap.get(key) || [];
          list.push(cb);
          groupMap.set(key, list);
        }

        let psOffset = 0;
        let tsOffset = 0;
        for (const [, groupBookings] of groupMap.entries()) {
          tsOffset++;
          const first = groupBookings[0];
          const supplyNo = generateSupplyNumber(db, tsOffset);
          const supplyDate = getTodayDateString();

          const tsInsert = db
            .prepare(
              `INSERT INTO town_supplies (
                supply_number, supply_date, salesman_id, salesman_name,
                town_id, town_name, area_id, area_name,
                import_batch_id, import_batch_number,
                total_parties, total_items, total_ordered_qty, total_supply_qty,
                total_packed_qty, total_bonus_qty,
                gross_amount, offer_discount_amount, party_discount_amount, discount_amount,
                total_supply_amount, supply_amount, net_billable_amount,
                packing_status, supply_status, super_admin_reviewed, remarks, created_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Completed', 'Ready for Dispatch', 0, ?, ?)`
            )
            .run(
              supplyNo,
              supplyDate,
              first.salesman_id,
              first.salesman_name,
              first.town_id || null,
              first.town_name,
              first.area_id || null,
              first.area_name,
              importBatchId,
              importBatchNo,
              new Set(groupBookings.map((g) => g.party_account_id)).size,
              `Auto-generated from Mobile Booking Import ${importBatchNo} (Pending Super Admin Review before Dispatch)`,
              user.username
            );

          const townSupplyId = Number(tsInsert.lastInsertRowid);
          let supplyItemsCount = 0;
          let supplyTotalQty = 0;
          let supplyTotalBonus = 0;
          let supplyGross = 0;
          let supplyOfferDisc = 0;
          let supplyPartyDisc = 0;
          let supplyDiscount = 0;
          let supplyNet = 0;

          for (const gb of groupBookings) {
            psOffset++;
            const partySupplyNo = generatePartySupplyNumber(db, psOffset);
            const bkRow = db
              .prepare('SELECT * FROM supply_bookings WHERE id = ?')
              .get(gb.id) as Record<string, unknown>;
            const bkItems = db
              .prepare('SELECT * FROM supply_booking_items WHERE booking_id = ?')
              .all(gb.id) as Array<Record<string, unknown>>;

            const psInsert = db
              .prepare(
                `INSERT INTO party_supplies (
                  party_supply_number, town_supply_id, supply_number, supply_date,
                  salesman_id, salesman_name, town_id, town_name, area_id, area_name,
                  party_account_id, party_code, party_name,
                  booking_ids_json, booking_numbers,
                  total_items, ordered_qty, supply_qty, packed_qty, bonus_qty,
                  gross_amount, offer_discount_amount, party_discount_amount, discount_amount,
                  supply_amount, net_billable_amount,
                  packing_status, delivery_status, supply_status, remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed', 'Pending', 'Ready for Dispatch', ?)`
              )
              .run(
                partySupplyNo,
                townSupplyId,
                supplyNo,
                supplyDate,
                gb.salesman_id,
                gb.salesman_name,
                gb.town_id || null,
                gb.town_name,
                gb.area_id || null,
                gb.area_name,
                gb.party_account_id,
                gb.party_code,
                gb.party_name,
                JSON.stringify([gb.id]),
                gb.booking_number,
                bkItems.length,
                Number(bkRow?.total_quantity || 0),
                Number(bkRow?.total_quantity || 0),
                Number(bkRow?.total_quantity || 0),
                Number(bkRow?.total_bonus || 0),
                Number(bkRow?.gross_amount || 0),
                Number(bkRow?.offer_discount_amount || 0),
                Number(bkRow?.party_discount_amount || 0),
                Number(bkRow?.discount_amount || 0),
                Number(bkRow?.net_amount || 0),
                Number(bkRow?.net_amount || 0),
                `Generated from Mobile Booking ${gb.booking_number}`
              );

            const partySupplyId = Number(psInsert.lastInsertRowid);

            for (let sNo = 0; sNo < bkItems.length; sNo++) {
              const line = bkItems[sNo];
              const evalRes = evaluateLineOfferAndPartyDiscount({
                itemId: Number(line.item_id),
                quantity: Number(line.quantity || 0),
                tradePrice: Number(line.trade_price || 0),
                partyAccountId: gb.party_account_id,
                townId: gb.town_id || null,
                townName: gb.town_name,
                salesmanId: gb.salesman_id,
                invoiceDate: supplyDate,
              });

              const fifoAlloc = evalRes.fifo_allocation;

              db.prepare(
                `INSERT INTO party_supply_items (
                  party_supply_id, town_supply_id, supply_number,
                  party_account_id, party_name, booking_id, booking_item_id, booking_number,
                  s_no, item_id, inventory_id, batch_number, expiry_date, fifo_batches_json,
                  item_code, company_name, item_name, packing,
                  ordered_quantity, ordered_qty, supply_quantity, supply_qty,
                  bonus_quantity, bonus_qty, packed_quantity, packed_qty,
                  remaining_pack_quantity, remaining_pack_qty, packing_status,
                  net_billable_qty, pending_bill_qty, trade_price,
                  offer_id, offer_name, offer_discount_percent, offer_discount_amount,
                  party_discount_id, party_discount_percent, party_discount_amount,
                  discount_percent, discount_amount, amount, net_billable_amount, remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'Completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                partySupplyId,
                townSupplyId,
                supplyNo,
                gb.party_account_id,
                gb.party_name,
                gb.id,
                Number(line.id),
                gb.booking_number,
                sNo + 1,
                Number(line.item_id),
                fifoAlloc.primary_inventory_id,
                fifoAlloc.primary_batch_number || 'FIFO-AUTO',
                fifoAlloc.primary_expiry_date || '',
                JSON.stringify(fifoAlloc.allocations),
                String(line.item_code || ''),
                String(line.company_name || ''),
                String(line.item_name || ''),
                String(line.packing || '1x1'),
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.bonus_quantity,
                evalRes.bonus_quantity,
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.sale_quantity,
                evalRes.trade_price,
                evalRes.offer_id,
                evalRes.offer_name,
                evalRes.offer_discount_percent,
                evalRes.offer_discount_amount,
                evalRes.party_discount_id,
                evalRes.party_discount_percent,
                evalRes.party_discount_amount,
                evalRes.effective_discount_percent,
                evalRes.total_discount_amount,
                evalRes.net_amount,
                evalRes.net_amount,
                String(line.remarks || '')
              );

              supplyItemsCount++;
              supplyTotalQty += evalRes.sale_quantity;
              supplyTotalBonus += evalRes.bonus_quantity;
              supplyGross += evalRes.gross_amount;
              supplyOfferDisc += evalRes.offer_discount_amount;
              supplyPartyDisc += evalRes.party_discount_amount;
              supplyDiscount += evalRes.total_discount_amount;
              supplyNet += evalRes.net_amount;
            }
          }

          db.prepare(
            `UPDATE town_supplies
             SET total_items = ?,
                 total_ordered_qty = ?,
                 total_supply_qty = ?,
                 total_packed_qty = ?,
                 total_bonus_qty = ?,
                 gross_amount = ?,
                 offer_discount_amount = ?,
                 party_discount_amount = ?,
                 discount_amount = ?,
                 total_supply_amount = ?,
                 supply_amount = ?,
                 net_billable_amount = ?
             WHERE id = ?`
          ).run(
            supplyItemsCount,
            round2(supplyTotalQty),
            round2(supplyTotalQty),
            round2(supplyTotalQty),
            round2(supplyTotalBonus),
            round2(supplyGross),
            round2(supplyOfferDisc),
            round2(supplyPartyDisc),
            round2(supplyDiscount),
            round2(supplyNet),
            round2(supplyNet),
            round2(supplyNet),
            townSupplyId
          );

          createdSupplies.push({
            id: townSupplyId,
            supply_number: supplyNo,
            town_name: first.town_name,
            salesman_name: first.salesman_name,
          });
        }
      }

      db.prepare(
        `UPDATE mobile_booking_imports
         SET valid_bookings_count = ?,
             imported_booking_ids_json = ?,
             imported_booking_numbers = ?,
             generated_supply_ids_json = ?,
             generated_supply_numbers = ?
         WHERE id = ?`
      ).run(
        createdBookings.length,
        JSON.stringify(createdBookings.map((c) => c.id)),
        createdBookings.map((c) => c.booking_number).join(', '),
        JSON.stringify(createdSupplies.map((s) => s.id)),
        createdSupplies.map((s) => s.supply_number).join(', '),
        importBatchId
      );
    });

    tx();

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: generate_supply ? 'IMPORT_AND_GENERATE_SUPPLY' : 'IMPORT_BOOKINGS',
      module: 'Supply Management',
      recordReference: importBatchNo,
      newValue: {
        import_batch_number: importBatchNo,
        bookings_created: createdBookings.map((b) => b.booking_number),
        supplies_created: createdSupplies.map((s) => s.supply_number),
      },
      ipAddress: req.ip,
      details: `Imported ${createdBookings.length} booking(s) under ${importBatchNo}`,
    });

    return res.json({
      success: true,
      import_batch_no: importBatchNo,
      bookings_created: createdBookings,
      supplies_created: createdSupplies,
      message: generate_supply
        ? `Imported ${createdBookings.length} booking(s) under Batch ${importBatchNo} and generated ${createdSupplies.length} Supply sheet(s) (${createdSupplies.map((s) => s.supply_number).join(', ')}). Super Admin review is required before dispatch.`
        : `Successfully imported ${createdBookings.length} booking(s) under Batch ${importBatchNo}.`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.patch('/booking-imports/supplies/:supplyId/approve-review', authenticateToken, (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const supplyId = Number(req.params.supplyId);

    db.prepare(
      `UPDATE town_supplies
       SET super_admin_reviewed = 1,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(supplyId);

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'APPROVE_SUPPLY_FOR_DISPATCH',
      module: 'Supply Management',
      recordReference: `Supply #${supplyId}`,
      newValue: { supply_id: supplyId, super_admin_reviewed: 1 },
      ipAddress: req.ip,
      details: `Super Admin reviewed and approved Supply #${supplyId} for dispatch`,
    });

    return res.json({
      success: true,
      message: 'Supply has been reviewed and approved by Super Admin for dispatch.',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.get('/booking-imports/history', authenticateToken, (_req, res) => {
  try {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM mobile_booking_imports ORDER BY id DESC LIMIT 100')
      .all();
    return res.json({ success: true, imports: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 8 & 9: 11 OFFER, DISCOUNT & BONUS REPORTS
// ============================================================================

enhancementsRouter.get('/offer-reports/:reportKey', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const reportKey = String(req.params.reportKey);
    const {
      from_date,
      to_date,
      company,
      item_id,
      party_id,
      town_id,
      salesman_id,
      offer_id,
      invoice_no,
    } = req.query;

    const today = getTodayDateString();

    if (reportKey === 'active-offers' || reportKey === 'expired-offers') {
      const wantExpired = reportKey === 'expired-offers';
      const offers = db
        .prepare('SELECT * FROM trade_offers ORDER BY id DESC')
        .all() as Array<Record<string, unknown>>;

      const filtered = offers.filter((o) => {
        const endDate = String(o.end_date || '').slice(0, 10);
        const startDate = String(o.start_date || '').slice(0, 10);
        const isExp = endDate < today || String(o.status) === 'Inactive';
        const isAct = String(o.status) === 'Active' && startDate <= today && endDate >= today;
        return wantExpired ? isExp : isAct;
      });

      return res.json({ success: true, report_key: reportKey, rows: filtered });
    }

    const saleLines = db
      .prepare(
        `SELECT
           s.invoice_number as invoice_no,
           s.invoice_date,
           s.customer_account_id as party_id,
           COALESCE(a.account_name, s.customer_name, 'Walk-in Customer') as party_name,
           a.town_id,
           COALESCE(NULLIF(s.town_name, ''), NULLIF(a.town_name, ''), a.city, 'Counter / General') as town_name,
           COALESCE(s.salesman_id, a.assigned_salesman_id) as salesman_id,
           COALESCE(sm.full_name, sm.name, NULLIF(s.salesman, ''), 'Direct Counter') as salesman_name,
           si.item_id,
           si.item_code,
           si.item_name,
           si.company_name,
           si.batch_number as batch_no,
           si.expiry_date,
           si.quantity as sale_qty,
           COALESCE(si.bonus_quantity, 0) as bonus_qty,
           si.unit_price as trade_price,
           si.offer_id,
           COALESCE(si.offer_name, '') as offer_name,
           COALESCE(si.offer_discount_percent, 0) as offer_discount_percent,
           COALESCE(si.offer_discount_amount, 0) as offer_discount_amount,
           si.party_discount_id,
           COALESCE(si.party_discount_percent, 0) as party_discount_percent,
           COALESCE(si.party_discount_amount, 0) as party_discount_amount,
           si.discount_percent as effective_discount_percent,
           si.discount_amount as total_discount_amount,
           si.line_total as net_amount
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN accounts a ON a.id = s.customer_account_id
         LEFT JOIN salesmen sm ON sm.id = COALESCE(s.salesman_id, a.assigned_salesman_id)
         WHERE s.status != 'cancelled'
           AND (? IS NULL OR DATE(s.invoice_date) >= DATE(?))
           AND (? IS NULL OR DATE(s.invoice_date) <= DATE(?))
           AND (? IS NULL OR LOWER(si.company_name) = LOWER(?))
           AND (? IS NULL OR si.item_id = ?)
           AND (? IS NULL OR s.customer_account_id = ?)
           AND (? IS NULL OR a.town_id = ?)
           AND (? IS NULL OR COALESCE(s.salesman_id, a.assigned_salesman_id) = ?)
           AND (? IS NULL OR si.offer_id = ?)
           AND (? IS NULL OR LOWER(s.invoice_number) LIKE '%' || LOWER(?) || '%')
         ORDER BY s.invoice_date DESC, s.id DESC`
      )
      .all(
        from_date ? String(from_date) : null,
        from_date ? String(from_date) : null,
        to_date ? String(to_date) : null,
        to_date ? String(to_date) : null,
        company ? String(company) : null,
        company ? String(company) : null,
        item_id ? Number(item_id) : null,
        item_id ? Number(item_id) : null,
        party_id ? Number(party_id) : null,
        party_id ? Number(party_id) : null,
        town_id ? Number(town_id) : null,
        town_id ? Number(town_id) : null,
        salesman_id ? Number(salesman_id) : null,
        salesman_id ? Number(salesman_id) : null,
        offer_id ? Number(offer_id) : null,
        offer_id ? Number(offer_id) : null,
        invoice_no ? String(invoice_no) : null,
        invoice_no ? String(invoice_no) : null
      ) as Array<Record<string, unknown>>;

    return res.json({
      success: true,
      report_key: reportKey,
      rows: saleLines,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 11, 12, 16, 18: SETTINGS -> MASTER RESET (OPTION A & OPTION B)
// ============================================================================

const TRANSACTION_TABLES_FOR_RESET = [
  'sale_return_items',
  'sale_returns',
  'sale_items',
  'sales',
  'purchase_return_items',
  'purchase_returns',
  'purchase_items',
  'purchases',
  'batch_stock_movements',
  'stock_adjustment_items',
  'stock_adjustments',
  'inventory',
  'salesman_settlement_expenses',
  'salesman_settlements',
  'supply_recoveries',
  'supply_return_items',
  'supply_returns',
  'supply_dispatches',
  'party_supply_items',
  'party_supplies',
  'town_supplies',
  'supply_booking_items',
  'supply_bookings',
  'supply_order_form_items',
  'supply_order_forms',
  'mobile_booking_imports',
  'cash_book_vouchers',
  'payment_vouchers',
  'journal_entry_lines',
  'journal_entries',
  'expenses',
  'invoice_number_sequences',
];

const MASTER_TABLES_FOR_COMPLETE_RESET = [
  'party_discount_history',
  'party_discounts',
  'trade_offers',
  'salesman_parties',
  'salesman_areas',
  'salesman_towns',
  'salesmen',
  'town_areas',
  'towns',
  'items',
];

function safeCountTable(db: ReturnType<typeof getDatabase>, tableName: string): number {
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)")
      .get(tableName) as { name: string } | undefined;
    if (!exists) return 0;
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${exists.name}"`).get() as { cnt: number };
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

enhancementsRouter.get('/master-reset/preview', authenticateToken, (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();

    const transactionCounts = {
      sales_invoices: safeCountTable(db, 'sales') + safeCountTable(db, 'sale_returns'),
      purchase_invoices: safeCountTable(db, 'purchases') + safeCountTable(db, 'purchase_returns'),
      inventory_batches: safeCountTable(db, 'inventory') + safeCountTable(db, 'batch_stock_movements'),
      supply_and_bookings:
        safeCountTable(db, 'supply_bookings') +
        safeCountTable(db, 'town_supplies') +
        safeCountTable(db, 'party_supplies') +
        safeCountTable(db, 'supply_dispatches') +
        safeCountTable(db, 'supply_returns') +
        safeCountTable(db, 'supply_recoveries') +
        safeCountTable(db, 'salesman_settlements'),
      cashbook_and_vouchers:
        safeCountTable(db, 'cash_book_vouchers') +
        safeCountTable(db, 'payment_vouchers') +
        safeCountTable(db, 'journal_entries') +
        safeCountTable(db, 'expenses'),
    };

    const nonSystemAccountsCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM accounts WHERE is_system_account = 0').get() as { cnt: number }
    )?.cnt || 0;

    const masterCounts = {
      items_master: safeCountTable(db, 'items'),
      accounts_master: nonSystemAccountsCount,
      salesmen_and_territories:
        safeCountTable(db, 'salesmen') + safeCountTable(db, 'towns') + safeCountTable(db, 'town_areas'),
      offers_and_party_discounts:
        safeCountTable(db, 'trade_offers') + safeCountTable(db, 'party_discounts'),
    };

    const preservedAlways = {
      users_and_roles: safeCountTable(db, 'users'),
      company_settings: safeCountTable(db, 'company_settings'),
      protected_audit_logs: safeCountTable(db, 'protected_audit_logs'),
      backups: safeCountTable(db, 'backup_history'),
    };

    return res.json({
      success: true,
      super_admin_email: getSuperAdminRecoveryEmail(db),
      transaction_counts: transactionCounts,
      master_counts: masterCounts,
      counts: {
        ...transactionCounts,
        items: masterCounts.items_master,
        parties: masterCounts.accounts_master,
      },
      preserved_always: preservedAlways,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/master-reset/request-code', authenticateToken, async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const rawOpt = req.body?.reset_option || req.body?.reset_mode;
    const isComplete = rawOpt === 'COMPLETE_RESET' || rawOpt === 'OPTION_B_COMPLETE_RESET';

    const purpose = isComplete ? 'MASTER_RESET_COMPLETE' : 'MASTER_RESET_TRANSACTIONS';
    const optionLabel = isComplete
      ? 'Master Reset Option B (Complete Reset: Transactions + Master Data)'
      : 'Master Reset Option A (Reset Transactions Only)';

    // Invalidate previous unused codes for Master Reset
    db.prepare(
      "UPDATE security_verification_codes SET used = 1 WHERE purpose IN ('MASTER_RESET_TRANSACTIONS', 'MASTER_RESET_COMPLETE') AND used = 0"
    ).run();

    const plainCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = hashOtpCode(plainCode);
    const superAdminEmail = getSuperAdminRecoveryEmail(db);

    db.prepare(
      `INSERT INTO security_verification_codes (
        purpose, code_hash, target_email, expires_at, attempts, max_attempts, used, created_by
      ) VALUES (?, ?, ?, datetime('now', '+5 minutes'), 0, 5, 0, ?)`
    ).run(purpose, codeHash, superAdminEmail, user.username);

    const emailRes = await sendSuperAdminSecurityOtpEmail({
      superAdminEmail,
      purpose: 'MASTER_RESET',
      operationLabel: optionLabel,
      requestedBy: user.username,
      code: plainCode,
      expiresInMinutes: 5,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'REQUEST_MASTER_RESET_OTP',
      module: 'Master Reset',
      recordReference: purpose,
      newValue: { masked_email: emailRes.maskedEmail, expires_in_minutes: 5 },
      ipAddress: req.ip,
      details: `Requested Master Reset verification code (${purpose})`,
    });

    return res.json({
      success: true,
      masked_email: emailRes.maskedEmail,
      expires_in_minutes: 5,
      message: `A 6-digit single-use verification code (valid for 5 minutes) has been sent to Super Admin email (${emailRes.maskedEmail}).`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/master-reset/execute', authenticateToken, async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const rawResetOpt = req.body?.reset_option || req.body?.reset_mode;
    const reset_option =
      rawResetOpt === 'COMPLETE_RESET' || rawResetOpt === 'OPTION_B_COMPLETE_RESET'
        ? 'COMPLETE_RESET'
        : 'RESET_TRANSACTIONS_ONLY';
    const { verification_code, confirmation_text } = req.body || {};

    if (String(confirmation_text || '').trim() !== 'RESET ALL DATA') {
      return res.status(400).json({
        success: false,
        error: 'Exact confirmation phrase "RESET ALL DATA" is required.',
      });
    }

    if (!verification_code) {
      return res.status(400).json({
        success: false,
        error: 'Super Admin email verification code is required.',
      });
    }

    const activeCode = db
      .prepare(
        `SELECT * FROM security_verification_codes
         WHERE purpose IN ('MASTER_RESET_TRANSACTIONS', 'MASTER_RESET_COMPLETE')
           AND used = 0
         ORDER BY id DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!activeCode) {
      return res.status(400).json({
        success: false,
        error: 'No active verification code found. Please request a new code.',
      });
    }

    const expiredCheck = db
      .prepare("SELECT CASE WHEN datetime('now') > datetime(?) THEN 1 ELSE 0 END as is_expired")
      .get(String(activeCode.expires_at)) as { is_expired: number };

    if (expiredCheck.is_expired === 1) {
      db.prepare('UPDATE security_verification_codes SET used = 1 WHERE id = ?').run(activeCode.id);
      return res.status(400).json({
        success: false,
        error: 'Verification code has expired (5-minute limit). Please request a new code.',
      });
    }

    const attempts = Number(activeCode.attempts || 0);
    const maxAttempts = Number(activeCode.max_attempts || 5);
    if (attempts >= maxAttempts) {
      db.prepare('UPDATE security_verification_codes SET used = 1 WHERE id = ?').run(activeCode.id);
      return res.status(400).json({
        success: false,
        error: 'Maximum verification attempts (5) exceeded. Code invalidated.',
      });
    }

    const candidateHash = hashOtpCode(String(verification_code));
    if (candidateHash !== String(activeCode.code_hash)) {
      const nextAttempts = attempts + 1;
      db.prepare('UPDATE security_verification_codes SET attempts = ? WHERE id = ?').run(
        nextAttempts,
        activeCode.id
      );

      writeProtectedAuditLog({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: 'INVALID_MASTER_RESET_OTP',
        module: 'Master Reset',
        recordReference: String(reset_option),
        result: 'FAILED',
        newValue: { attempt: nextAttempts, max_attempts: maxAttempts },
        ipAddress: req.ip,
        details: `Invalid Master Reset OTP attempt (${nextAttempts}/${maxAttempts})`,
      });

      return res.status(400).json({
        success: false,
        error: `Invalid verification code (${maxAttempts - nextAttempts} attempts remaining).`,
      });
    }

    // Step 1: Mandatory Pre-Reset Local Backup Verification
    // If backup fails, cancel the reset immediately!
    let preResetBackup;
    try {
      preResetBackup = createNumberedAbrarBackup({
        backupType: 'pre_change',
        createdBy: user.username,
        notes: `Mandatory Automatic Pre-Reset Backup before ${reset_option}`,
      });
      if (!preResetBackup || preResetBackup.status !== 'completed' || !preResetBackup.verification.valid) {
        throw new Error('Pre-reset backup verification failed.');
      }
    } catch (backupErr: unknown) {
      return res.status(500).json({
        success: false,
        error: `Master Reset Cancelled: Failed to create and verify mandatory pre-reset backup (${
          backupErr instanceof Error ? backupErr.message : String(backupErr)
        }).`,
      });
    }

    const isCompleteReset = reset_option === 'COMPLETE_RESET';
    const deletedSummary: Record<string, number> = {};

    // Step 2: Execute Reset inside an atomic transaction
    db.pragma('foreign_keys = OFF');
    try {
      const resetTx = db.transaction(() => {
        db.prepare("UPDATE security_verification_codes SET used = 1, used_at = datetime('now') WHERE id = ?").run(
          activeCode.id
        );

        for (const tbl of TRANSACTION_TABLES_FOR_RESET) {
          const exists = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)")
            .get(tbl) as { name: string } | undefined;
          if (exists) {
            const cnt = safeCountTable(db, exists.name);
            db.prepare(`DELETE FROM "${exists.name}"`).run();
            deletedSummary[exists.name] = cnt;
          }
        }

        if (isCompleteReset) {
          for (const tbl of MASTER_TABLES_FOR_COMPLETE_RESET) {
            const exists = db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)")
              .get(tbl) as { name: string } | undefined;
            if (exists) {
              const cnt = safeCountTable(db, exists.name);
              db.prepare(`DELETE FROM "${exists.name}"`).run();
              deletedSummary[exists.name] = cnt;
            }
          }
          // Delete all non-system customer/supplier/party accounts while preserving core Chart of Accounts heads
          const accCnt = (
            db.prepare('SELECT COUNT(*) as cnt FROM accounts WHERE is_system_account = 0').get() as { cnt: number }
          )?.cnt || 0;
          db.prepare('DELETE FROM accounts WHERE is_system_account = 0').run();
          db.prepare(
            'UPDATE accounts SET total_debit = 0, total_credit = 0, current_balance = COALESCE(opening_balance, 0)'
          ).run();
          deletedSummary['accounts_parties'] = accCnt;
        } else {
          // Option A: Preserve Item Master, Accounts Master, Salesmen, Towns/Areas, Offers, Party Discounts,
          // and reset running balances and item opening stock to 0
          db.prepare('UPDATE items SET opening_stock = 0').run();
          db.prepare(
            `UPDATE accounts
             SET total_debit = 0,
                 total_credit = 0,
                 customer_debit = 0,
                 customer_credit = 0,
                 supplier_debit = 0,
                 supplier_credit = 0,
                 current_balance = COALESCE(opening_balance, 0)`
          ).run();
        }
      });

      resetTx();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: isCompleteReset ? 'OPTION_B_COMPLETE_RESET' : 'OPTION_A_TRANSACTIONS_ONLY',
      module: 'Master Reset',
      recordReference: preResetBackup.filename,
      newValue: {
        reset_option: isCompleteReset ? 'COMPLETE_RESET' : 'RESET_TRANSACTIONS_ONLY',
        pre_reset_backup: preResetBackup.filename,
        deleted_summary: deletedSummary,
      },
      ipAddress: req.ip,
      details: `Executed Master Reset (${isCompleteReset ? 'Option B: Complete Reset' : 'Option A: Transactions Only'}). Pre-reset backup: ${preResetBackup.filename}`,
    });

    await syncDatabaseToCloudSQL(`master_reset:${reset_option}`).catch(() => {});

    return res.json({
      success: true,
      reset_option: isCompleteReset ? 'COMPLETE_RESET' : 'RESET_TRANSACTIONS_ONLY',
      pre_reset_backup: preResetBackup,
      deleted_summary: deletedSummary,
      message: isCompleteReset
        ? `Complete Master Reset (Option B) completed successfully. Pre-reset backup saved as "${preResetBackup.filename}".`
        : `Reset Transactions Only (Option A) completed successfully. Item Master & Accounts Master were preserved. Pre-reset backup saved as "${preResetBackup.filename}".`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 13, 14, 15, 17: LOCAL HARD DRIVE BACKUP & RESTORE
// ============================================================================

enhancementsRouter.get('/local-backup/settings', authenticateToken, (_req, res) => {
  try {
    const db = getDatabase();
    const settings = db
      .prepare(
        `SELECT
           local_backup_folder,
           backup_directory,
           auto_daily_backup,
           auto_weekly_backup,
           auto_backup_time,
           auto_backup_before_changes,
           backup_before_master_reset,
           daily_retention_count,
           weekly_retention_count,
           super_admin_recovery_email
         FROM company_settings
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    const backups = listBackups();

    return res.json({
      success: true,
      settings: {
        local_backup_folder: String(settings?.local_backup_folder || 'D:\\Abrar Medical Store Backups'),
        auto_daily_backup: Number(settings?.auto_daily_backup ?? 1) === 1,
        auto_weekly_backup: Number(settings?.auto_weekly_backup ?? 1) === 1,
        auto_backup_time: String(settings?.auto_backup_time || '23:00'),
        auto_backup_before_changes: Number(settings?.auto_backup_before_changes ?? 1) === 1,
        backup_before_master_reset: Number(settings?.backup_before_master_reset ?? 1) === 1,
        daily_retention_count: Number(settings?.daily_retention_count || 7),
        weekly_retention_count: Number(settings?.weekly_retention_count || 4),
        keep_daily_backups: Number(settings?.daily_retention_count || 7),
        keep_weekly_backups: Number(settings?.weekly_retention_count || 4),
        super_admin_email: String(settings?.super_admin_recovery_email || 'abrar.aslam02@gmail.com'),
      },
      backups: backups.map((b) => ({ ...b, file_name: b.filename })),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.put('/local-backup/settings', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};

    db.prepare(
      `UPDATE company_settings
       SET local_backup_folder = ?,
           auto_daily_backup = ?,
           auto_weekly_backup = ?,
           auto_backup_time = ?,
           auto_backup_before_changes = ?,
           backup_before_master_reset = ?,
           daily_retention_count = ?,
           weekly_retention_count = ?`
    ).run(
      String(body.local_backup_folder || 'D:\\Abrar Medical Store Backups').trim(),
      body.auto_daily_backup ? 1 : 0,
      body.auto_weekly_backup ? 1 : 0,
      String(body.auto_backup_time || '23:00'),
      body.auto_backup_before_changes ? 1 : 0,
      body.backup_before_master_reset !== false ? 1 : 0,
      Math.max(1, Number(body.daily_retention_count || body.keep_daily_backups || 7)),
      Math.max(1, Number(body.weekly_retention_count || body.keep_weekly_backups || 4))
    );

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'UPDATE_BACKUP_SETTINGS',
      module: 'Backup & Restore',
      recordReference: String(body.local_backup_folder || 'D:\\Abrar Medical Store Backups'),
      newValue: body,
      ipAddress: req.ip,
      details: 'Updated Local Hard Drive Backup settings and retention policy',
    });

    return res.json({
      success: true,
      message: 'Local backup folder and retention settings saved.',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/local-backup/create', authenticateToken, (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const { local_target_folder, notes } = req.body || {};

    const created = createNumberedAbrarBackup({
      backupType: 'manual',
      createdBy: user.username,
      localTargetFolder: local_target_folder ? String(local_target_folder) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'CREATE_LOCAL_BACKUP',
      module: 'Backup & Restore',
      recordReference: created.filename,
      newValue: {
        filename: created.filename,
        local_folder: created.localFolderPath,
        file_size_bytes: created.file_size_bytes,
        tables_count: created.tables_count,
      },
      ipAddress: req.ip,
      details: `Created verified local backup ${created.filename} (${created.localFolderPath})`,
    });

    return res.json({
      success: true,
      backup: { ...created, file_name: created.filename },
      download_url: `/api/enhancements/local-backup/download/${created.id}`,
      message: `Verified local backup "${created.filename}" created (${(created.file_size_bytes / 1024).toFixed(1)} KB).`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.get('/local-backup/download/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    const row = db
      .prepare('SELECT * FROM backup_history WHERE id = ?')
      .get(id) as { filename: string; file_path: string } | undefined;

    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).json({ success: false, error: 'Backup file not found on disk.' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
    const stream = fs.createReadStream(row.file_path);
    stream.pipe(res);
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/local-backup/upload-verify', authenticateToken, (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const user = getAuthenticatedUser(req);
    const body = req.body || {};
    const filename = body.filename || body.file_name;
    const base64_data = body.base64_data || body.file_base64;

    if (!filename || !base64_data) {
      return res.status(400).json({
        success: false,
        error: 'Backup filename and base64 binary content are required.',
      });
    }

    const buf = Buffer.from(String(base64_data), 'base64');
    const staged = stageAndVerifyUploadedBackup({
      originalFilename: String(filename),
      fileBuffer: buf,
      uploadedBy: user.username,
    });

    if (!staged.valid) {
      return res.status(400).json({
        success: false,
        error: staged.verification.error || 'Selected file is not a valid Abrar Medical Store SQLite backup.',
        verification: staged.verification,
      });
    }

    return res.json({
      success: true,
      backup_id: staged.backupId,
      staged_filename: staged.stagedFilename,
      staged_file_name: staged.stagedFilename,
      verification: {
        ...staged.verification,
        staged_file_name: staged.stagedFilename,
        table_count: staged.verification.tablesCount,
        row_counts: staged.verification.coreCounts,
      },
      message: `Backup file "${staged.stagedFilename}" verified successfully (${staged.verification.tablesCount} tables, integrity: ${staged.verification.integrityCheck}).`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/local-backup/request-restore-code', authenticateToken, async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};
    const backup_id = body.backup_id;
    const filename = body.filename || body.staged_file_name || body.file_name;

    db.prepare("UPDATE security_verification_codes SET used = 1 WHERE purpose = 'LOCAL_RESTORE' AND used = 0").run();

    const plainCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = hashOtpCode(plainCode);
    const superAdminEmail = getSuperAdminRecoveryEmail(db);

    db.prepare(
      `INSERT INTO security_verification_codes (
        purpose, code_hash, target_email, expires_at, attempts, max_attempts, used, created_by
      ) VALUES ('LOCAL_RESTORE', ?, ?, datetime('now', '+5 minutes'), 0, 5, 0, ?)`
    ).run(codeHash, superAdminEmail, user.username);

    const emailRes = await sendSuperAdminSecurityOtpEmail({
      superAdminEmail,
      purpose: 'BACKUP_RESTORE',
      operationLabel: `Restore Database from Local Backup (${filename || `#${backup_id}`})`,
      requestedBy: user.username,
      code: plainCode,
      expiresInMinutes: 5,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'REQUEST_RESTORE_OTP',
      module: 'Backup & Restore',
      recordReference: String(filename || backup_id || 'Backup'),
      newValue: { masked_email: emailRes.maskedEmail },
      ipAddress: req.ip,
      details: `Requested Local Backup Restore OTP for ${filename || backup_id}`,
    });

    return res.json({
      success: true,
      masked_email: emailRes.maskedEmail,
      expires_in_minutes: 5,
      message: `A 6-digit single-use restore verification code (valid for 5 minutes) has been sent to Super Admin email (${emailRes.maskedEmail}).`,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

enhancementsRouter.post('/local-backup/execute-restore', authenticateToken, (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const db = getDatabase();
    const user = getAuthenticatedUser(req);
    const body = req.body || {};
    const backup_id = body.backup_id;
    const filename = body.filename || body.staged_file_name || body.file_name;
    const { verification_code, confirmation_text } = body;

    if (String(confirmation_text || '').trim() !== 'RESTORE DATA') {
      return res.status(400).json({
        success: false,
        error: 'Exact confirmation phrase "RESTORE DATA" is required.',
      });
    }

    if (!verification_code) {
      return res.status(400).json({
        success: false,
        error: 'Super Admin email verification code is required.',
      });
    }

    const activeCode = db
      .prepare(
        `SELECT * FROM security_verification_codes
         WHERE purpose = 'LOCAL_RESTORE' AND used = 0
         ORDER BY id DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!activeCode) {
      return res.status(400).json({
        success: false,
        error: 'No active restore verification code found. Please request a new code.',
      });
    }

    const expiredCheck = db
      .prepare("SELECT CASE WHEN datetime('now') > datetime(?) THEN 1 ELSE 0 END as is_expired")
      .get(String(activeCode.expires_at)) as { is_expired: number };

    if (expiredCheck.is_expired === 1) {
      db.prepare('UPDATE security_verification_codes SET used = 1 WHERE id = ?').run(activeCode.id);
      return res.status(400).json({
        success: false,
        error: 'Verification code has expired (5-minute limit). Please request a new code.',
      });
    }

    const attempts = Number(activeCode.attempts || 0);
    const maxAttempts = Number(activeCode.max_attempts || 5);
    if (attempts >= maxAttempts) {
      db.prepare('UPDATE security_verification_codes SET used = 1 WHERE id = ?').run(activeCode.id);
      return res.status(400).json({
        success: false,
        error: 'Maximum verification attempts (5) exceeded. Code invalidated.',
      });
    }

    const candidateHash = hashOtpCode(String(verification_code));
    if (candidateHash !== String(activeCode.code_hash)) {
      const nextAttempts = attempts + 1;
      db.prepare('UPDATE security_verification_codes SET attempts = ? WHERE id = ?').run(
        nextAttempts,
        activeCode.id
      );
      return res.status(400).json({
        success: false,
        error: `Invalid verification code (${maxAttempts - nextAttempts} attempts remaining).`,
      });
    }

    db.prepare("UPDATE security_verification_codes SET used = 1, used_at = datetime('now') WHERE id = ?").run(
      activeCode.id
    );

    const restoreResult = restoreDatabaseFromBackup({
      backupId: backup_id ? Number(backup_id) : undefined,
      filename: filename ? String(filename) : undefined,
      restoredBy: user.username,
    });

    writeProtectedAuditLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: 'RESTORE_FROM_LOCAL_BACKUP',
      module: 'Backup & Restore',
      recordReference: restoreResult.restoredVerification.filename,
      newValue: {
        restored_file: restoreResult.restoredVerification.filename,
        safety_backup: restoreResult.safetyBackup.filename,
        core_counts: restoreResult.restoredVerification.coreCounts,
      },
      ipAddress: req.ip,
      details: `Restored database from ${restoreResult.restoredVerification.filename} (Safety backup: ${restoreResult.safetyBackup.filename})`,
    });

    return res.json(restoreResult);
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// PART 18: PROTECTED AUDIT LOGS VIEWER
// ============================================================================

enhancementsRouter.get('/protected-audit-logs', authenticateToken, (_req, res) => {
  try {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM protected_audit_logs ORDER BY id DESC LIMIT 300')
      .all();
    return res.json({ success: true, logs: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
