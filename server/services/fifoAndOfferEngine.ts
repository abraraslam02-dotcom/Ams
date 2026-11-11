import { getDatabase } from '../db/connection.ts';

export function round2(val: unknown): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val || 0));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

export function parsePacking(packingStr: string): {
  stripsPerBox: number;
  unitsPerStrip: number;
  unitsPerPack: number;
  packing: string;
} {
  const clean = String(packingStr || '1x1').trim();
  const matrixMatch = clean.match(/^(\d+)\s*[xX*]\s*(\d+)/);
  if (matrixMatch) {
    const strips = Math.max(1, parseInt(matrixMatch[1], 10) || 1);
    const units = Math.max(1, parseInt(matrixMatch[2], 10) || 1);
    return {
      stripsPerBox: strips,
      unitsPerStrip: units,
      unitsPerPack: strips * units,
      packing: `${strips}x${units}`,
    };
  }
  const singleMatch = clean.match(/^(\d+)\s*(tab|cap|sachet|amp|vial|strip|pack|unit)s?$/i);
  if (singleMatch) {
    const units = Math.max(1, parseInt(singleMatch[1], 10) || 1);
    return {
      stripsPerBox: 1,
      unitsPerStrip: units,
      unitsPerPack: units,
      packing: `${units}`,
    };
  }
  return { stripsPerBox: 1, unitsPerStrip: 1, unitsPerPack: 1, packing: clean || '1x1' };
}

export interface ProtectedAuditParams {
  userId?: number | null;
  username?: string;
  userRole?: string;
  action: string;
  module: string;
  recordReference?: string;
  oldValue?: unknown;
  newValue?: unknown;
  result?: 'SUCCESS' | 'WARNING' | 'FAILED';
  ipAddress?: string;
  details?: string;
}

/**
 * Writes an immutable audit log entry into protected_audit_logs AND auth_audit_logs.
 * Master Reset never deletes protected_audit_logs.
 */
export function writeProtectedAuditLog(params: ProtectedAuditParams): void {
  try {
    const db = getDatabase();
    const oldJson =
      params.oldValue !== undefined && params.oldValue !== null
        ? typeof params.oldValue === 'string'
          ? params.oldValue
          : JSON.stringify(params.oldValue)
        : '';
    const newJson =
      params.newValue !== undefined && params.newValue !== null
        ? typeof params.newValue === 'string'
          ? params.newValue
          : JSON.stringify(params.newValue)
        : '';

    db.prepare(`
      INSERT INTO protected_audit_logs (
        user_id, username, user_role, action, module,
        record_reference, old_value_json, new_value_json,
        result, ip_address, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId ?? null,
      params.username || 'Super Admin',
      params.userRole || 'Super Admin',
      params.action,
      params.module,
      params.recordReference || '',
      oldJson,
      newJson,
      params.result || 'SUCCESS',
      params.ipAddress || '',
      params.details || ''
    );

    db.prepare(`
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      params.userId ?? null,
      params.username || 'Super Admin',
      params.action,
      params.result || 'SUCCESS',
      params.ipAddress || '',
      params.details || `${params.module}: ${params.recordReference || ''}`
    );
  } catch (err) {
    console.warn('[AMS Protected Audit] Failed to write audit log:', err);
  }
}

export interface FIFOBatchRecord {
  id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  packing: string;
  units_per_pack: number;
  batch_number: string;
  expiry_date: string;
  purchase_date: string;
  purchase_invoice_number: string;
  supplier_name: string;
  purchase_rate: number;
  trade_price: number;
  retail_price: number;
  current_pack_qty: number;
  reserved_pack_qty: number;
  dispatched_pack_qty: number;
  damaged_pack_qty: number;
  available_pack_qty: number;
  is_blocked: boolean;
  blocked_reason: string;
  is_expired: boolean;
  is_near_expiry: boolean;
  days_to_expiry: number;
  batch_status: 'Active' | 'Near Expiry' | 'Expired' | 'Blocked' | 'Out of Stock';
}

export interface FIFOAllocationSlice {
  inventory_id: number;
  batch_number: string;
  expiry_date: string;
  purchase_date: string;
  purchase_invoice_number: string;
  supplier_name: string;
  allocated_sale_qty: number;
  allocated_bonus_qty: number;
  allocated_total_qty: number;
  allocated_units: number;
  available_before: number;
  remaining_after: number;
  purchase_rate: number;
  trade_price: number;
}

export interface FIFOAllocationPreviewResult {
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  packing: string;
  requested_sale_qty: number;
  requested_bonus_qty: number;
  requested_total_qty: number;
  total_eligible_available_qty: number;
  can_fulfill: boolean;
  shortfall_qty: number;
  primary_batch_number: string;
  primary_expiry_date: string;
  primary_inventory_id: number | null;
  allocations: FIFOAllocationSlice[];
  blocked_or_expired_batches_skipped: Array<{
    inventory_id: number;
    batch_number: string;
    expiry_date: string;
    reason: string;
    qty: number;
  }>;
  error?: string;
}

/**
 * Inspects all batches for an item (or all items) and computes their FIFO eligibility & status.
 */
export function getItemBatchesWithFIFOStatus(itemId?: number): FIFOBatchRecord[] {
  const db = getDatabase();
  const settings = db
    .prepare('SELECT near_expiry_days FROM company_settings LIMIT 1')
    .get() as { near_expiry_days?: number } | undefined;
  const nearExpiryDays = Number(settings?.near_expiry_days || 90);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(`${todayStr}T00:00:00`);

  const whereClause = itemId ? 'WHERE inv.item_id = ?' : '';
  const params = itemId ? [itemId] : [];

  const rows = db
    .prepare(`
      SELECT
        inv.*,
        i.item_code,
        i.item_name,
        i.company_name,
        i.packing as item_packing,
        i.purchase_price as item_purchase_price,
        i.trade_price as item_trade_price,
        i.wholesale_price as item_wholesale_price,
        i.retail_price as item_retail_price,
        p.bill_date as linked_bill_date,
        p.bill_number as linked_bill_number,
        a.account_name as linked_supplier_name
      FROM inventory inv
      INNER JOIN items i ON i.id = inv.item_id
      LEFT JOIN purchases p ON p.id = inv.last_purchase_id
      LEFT JOIN accounts a ON a.id = inv.last_supplier_id
      ${whereClause}
      ORDER BY
        COALESCE(NULLIF(inv.purchase_date, ''), p.bill_date, DATE(inv.created_at)) ASC,
        CASE WHEN inv.expiry_date IS NULL OR inv.expiry_date = '' THEN '9999-12-31' ELSE inv.expiry_date END ASC,
        inv.id ASC
    `)
    .all(...params) as Array<Record<string, any>>;

  return rows.map((r) => {
    const parsed = parsePacking(String(r.packing || r.item_packing || '1x1'));
    const currentPackQty = round2(
      Number(r.current_pack_qty || Number(r.total_stock_units || 0) / parsed.unitsPerPack)
    );
    const reservedPackQty = round2(Math.max(0, Number(r.reserved_pack_qty || 0)));
    const dispatchedPackQty = round2(Math.max(0, Number(r.dispatched_pack_qty || r.sold_qty || 0)));
    const damagedPackQty = round2(Math.max(0, Number(r.damaged_pack_qty || 0)));
    const availablePackQty = round2(Math.max(0, currentPackQty - reservedPackQty));

    const expiryDate = String(r.expiry_date || '').trim();
    let daysToExpiry = 9999;
    let isExpired = false;
    let isNearExpiry = false;

    if (expiryDate && /^\d{4}-\d{2}-\d{2}/.test(expiryDate)) {
      const expD = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
      daysToExpiry = Math.ceil((expD.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry < 0) {
        isExpired = true;
      } else if (daysToExpiry <= nearExpiryDays) {
        isNearExpiry = true;
      }
    }

    const isBlocked = Number(r.is_blocked || 0) === 1;
    let batchStatus: FIFOBatchRecord['batch_status'] = 'Active';
    if (isBlocked) batchStatus = 'Blocked';
    else if (isExpired) batchStatus = 'Expired';
    else if (availablePackQty <= 0 && currentPackQty <= 0) batchStatus = 'Out of Stock';
    else if (isNearExpiry) batchStatus = 'Near Expiry';

    const purchaseDate = String(
      r.purchase_date || r.linked_bill_date || String(r.created_at || '').slice(0, 10) || todayStr
    );
    const purchaseInvoiceNumber = String(r.purchase_invoice_number || r.linked_bill_number || '');
    const supplierName = String(r.supplier_name || r.linked_supplier_name || '');
    const purchaseRate = round2(Number(r.pack_cost || r.cost_price || r.item_purchase_price || 0));
    const tradePrice = round2(
      Number(r.trade_price || r.wholesale_price || r.item_trade_price || r.item_wholesale_price || r.retail_price || r.item_retail_price || 0)
    );
    const retailPrice = round2(Number(r.pack_retail || r.retail_price || r.item_retail_price || tradePrice));

    return {
      id: Number(r.id),
      item_id: Number(r.item_id),
      item_code: String(r.item_code || ''),
      item_name: String(r.item_name || ''),
      company_name: String(r.company_name || ''),
      packing: parsed.packing,
      units_per_pack: parsed.unitsPerPack,
      batch_number: String(r.batch_number || 'DEFAULT'),
      expiry_date: expiryDate,
      purchase_date: purchaseDate,
      purchase_invoice_number: purchaseInvoiceNumber,
      supplier_name: supplierName,
      purchase_rate: purchaseRate,
      trade_price: tradePrice,
      retail_price: retailPrice,
      current_pack_qty: currentPackQty,
      reserved_pack_qty: reservedPackQty,
      dispatched_pack_qty: dispatchedPackQty,
      damaged_pack_qty: damagedPackQty,
      available_pack_qty: availablePackQty,
      is_blocked: isBlocked,
      blocked_reason: String(r.blocked_reason || ''),
      is_expired: isExpired,
      is_near_expiry: isNearExpiry,
      days_to_expiry: daysToExpiry,
      batch_status: batchStatus,
    };
  });
}

/**
 * Computes strict FIFO batch allocation for an item across oldest eligible batches.
 * - Never allocates from expired, blocked, or 0-available batches.
 * - Splits saleQty + bonusQty across multiple batches in FIFO order when required.
 * - If preferredInventoryId is supplied (authorized batch override), allocates from that batch first (if eligible) before falling back to FIFO.
 */
export function previewFIFOAllocation(params: {
  itemId: number;
  saleQtyPacks: number;
  bonusQtyPacks?: number;
  preferredInventoryId?: number | null;
  preferredBatchNumber?: string | null;
  ignoreReservedForSelfPackQty?: number;
}): FIFOAllocationPreviewResult {
  const db = getDatabase();
  const itemRow = db
    .prepare('SELECT id, item_code, item_name, company_name, packing FROM items WHERE id = ?')
    .get(params.itemId) as Record<string, any> | undefined;

  if (!itemRow) {
    throw new Error(`Item #${params.itemId} not found.`);
  }

  const parsed = parsePacking(String(itemRow.packing || '1x1'));
  const reqSale = round2(Math.max(0, Number(params.saleQtyPacks || 0)));
  const reqBonus = round2(Math.max(0, Number(params.bonusQtyPacks || 0)));
  const reqTotal = round2(reqSale + reqBonus);

  const allBatches = getItemBatchesWithFIFOStatus(params.itemId);
  const skipped: FIFOAllocationPreviewResult['blocked_or_expired_batches_skipped'] = [];
  const eligible: FIFOBatchRecord[] = [];

  for (const b of allBatches) {
    if (b.is_blocked) {
      if (b.current_pack_qty > 0) {
        skipped.push({
          inventory_id: b.id,
          batch_number: b.batch_number,
          expiry_date: b.expiry_date,
          reason: `Blocked (${b.blocked_reason || 'Authorized Hold'})`,
          qty: b.current_pack_qty,
        });
      }
      continue;
    }
    if (b.is_expired) {
      if (b.current_pack_qty > 0) {
        skipped.push({
          inventory_id: b.id,
          batch_number: b.batch_number,
          expiry_date: b.expiry_date,
          reason: 'Expired Batch (Issuance Blocked)',
          qty: b.current_pack_qty,
        });
      }
      continue;
    }

    // If we are dispatching a supply that already reserved stock on this batch, include its reserved qty
    const effectiveAvail = round2(
      b.available_pack_qty +
        (params.ignoreReservedForSelfPackQty ? Math.min(b.reserved_pack_qty, params.ignoreReservedForSelfPackQty) : 0)
    );
    if (effectiveAvail > 0) {
      eligible.push({ ...b, available_pack_qty: effectiveAvail });
    }
  }

  // If an authorized user selected a specific preferred batch, place it first ONLY if it is eligible (not expired/blocked)
  if (params.preferredInventoryId || params.preferredBatchNumber) {
    eligible.sort((a, b) => {
      const aMatch =
        (params.preferredInventoryId && a.id === Number(params.preferredInventoryId)) ||
        (params.preferredBatchNumber &&
          a.batch_number.toLowerCase() === String(params.preferredBatchNumber).trim().toLowerCase());
      const bMatch =
        (params.preferredInventoryId && b.id === Number(params.preferredInventoryId)) ||
        (params.preferredBatchNumber &&
          b.batch_number.toLowerCase() === String(params.preferredBatchNumber).trim().toLowerCase());
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }

  const totalEligibleAvailable = round2(eligible.reduce((s, b) => s + b.available_pack_qty, 0));

  let remSale = reqSale;
  let remBonus = reqBonus;
  const allocations: FIFOAllocationSlice[] = [];

  for (const b of eligible) {
    if (remSale <= 0 && remBonus <= 0) break;
    let availInBatch = b.available_pack_qty;
    if (availInBatch <= 0) continue;

    const allocSale = round2(Math.min(remSale, availInBatch));
    remSale = round2(remSale - allocSale);
    availInBatch = round2(availInBatch - allocSale);

    const allocBonus = round2(Math.min(remBonus, availInBatch));
    remBonus = round2(remBonus - allocBonus);
    availInBatch = round2(availInBatch - allocBonus);

    const allocTotal = round2(allocSale + allocBonus);
    if (allocTotal > 0) {
      allocations.push({
        inventory_id: b.id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        purchase_date: b.purchase_date,
        purchase_invoice_number: b.purchase_invoice_number,
        supplier_name: b.supplier_name,
        allocated_sale_qty: allocSale,
        allocated_bonus_qty: allocBonus,
        allocated_total_qty: allocTotal,
        allocated_units: round2(allocTotal * parsed.unitsPerPack),
        available_before: b.available_pack_qty,
        remaining_after: availInBatch,
        purchase_rate: b.purchase_rate,
        trade_price: b.trade_price,
      });
    }
  }

  const shortfall = round2(remSale + remBonus);
  const canFulfill = shortfall <= 0.0001;
  const primary = allocations[0] || eligible[0] || null;

  return {
    item_id: Number(itemRow.id),
    item_code: String(itemRow.item_code || ''),
    item_name: String(itemRow.item_name || ''),
    company_name: String(itemRow.company_name || ''),
    packing: parsed.packing,
    requested_sale_qty: reqSale,
    requested_bonus_qty: reqBonus,
    requested_total_qty: reqTotal,
    total_eligible_available_qty: totalEligibleAvailable,
    can_fulfill: canFulfill,
    shortfall_qty: shortfall,
    primary_batch_number: primary ? primary.batch_number : '',
    primary_expiry_date: primary ? primary.expiry_date : '',
    primary_inventory_id: primary ? Number((primary as Record<string, any>).inventory_id || (primary as Record<string, any>).id || 0) || null : null,
    allocations,
    blocked_or_expired_batches_skipped: skipped,
    error: canFulfill
      ? undefined
      : `Insufficient eligible FIFO stock for "${String(itemRow.item_name)}". Requested: ${reqTotal} Packs (Sale: ${reqSale}, Bonus: ${reqBonus}), Available Eligible Stock: ${totalEligibleAvailable} Packs.`,
  };
}

/**
 * Records a batch stock movement row in batch_stock_movements.
 * Supports both camelCase and snake_case parameter keys.
 */
export function recordBatchStockMovement(params: {
  movementDate?: string;
  movement_date?: string;
  itemId?: number;
  item_id?: number;
  itemCode?: string;
  item_code?: string;
  itemName?: string;
  item_name?: string;
  companyName?: string;
  company_name?: string;
  inventoryId?: number;
  inventory_id?: number;
  batchNumber?: string;
  batch_number?: string;
  expiryDate?: string;
  expiry_date?: string;
  purchaseDate?: string;
  purchase_date?: string;
  movementType?:
    | 'PURCHASE_IN'
    | 'RESERVE_PACKING'
    | 'UNRESERVE_PACKING'
    | 'DISPATCH_OUT'
    | 'COUNTER_SALE_OUT'
    | 'BONUS_OUT'
    | 'RETURN_IN_SALEABLE'
    | 'RETURN_DAMAGED'
    | 'BATCH_ADJUSTMENT'
    | 'BATCH_BLOCK'
    | 'BATCH_UNBLOCK';
  movement_type?:
    | 'PURCHASE_IN'
    | 'RESERVE_PACKING'
    | 'UNRESERVE_PACKING'
    | 'DISPATCH_OUT'
    | 'COUNTER_SALE_OUT'
    | 'BONUS_OUT'
    | 'RETURN_IN_SALEABLE'
    | 'RETURN_DAMAGED'
    | 'BATCH_ADJUSTMENT'
    | 'BATCH_BLOCK'
    | 'BATCH_UNBLOCK';
  referenceType?: string;
  reference_type?: string;
  referenceId?: number | null;
  reference_id?: number | null;
  referenceNumber?: string;
  reference_number?: string;
  partyAccountId?: number | null;
  party_account_id?: number | null;
  partyName?: string;
  party_name?: string;
  salesmanId?: number | null;
  salesman_id?: number | null;
  salesmanName?: string;
  salesman_name?: string;
  townName?: string;
  town_name?: string;
  quantityPacks?: number;
  quantity_packs?: number;
  bonusPacks?: number;
  bonus_packs?: number;
  totalUnits?: number;
  total_units?: number;
  purchaseRate?: number;
  purchase_rate?: number;
  tradePrice?: number;
  trade_price?: number;
  balanceAfterPacks?: number;
  balance_after_packs?: number;
  remarks?: string;
  performedBy?: string;
  performed_by?: string;
}): void {
  const db = getDatabase();
  const qtyPacks = Number(params.quantityPacks ?? params.quantity_packs ?? 0);
  db.prepare(`
    INSERT INTO batch_stock_movements (
      movement_date, item_id, item_code, item_name, company_name,
      inventory_id, batch_number, expiry_date, purchase_date,
      movement_type, reference_type, reference_id, reference_number,
      party_account_id, party_name, salesman_id, salesman_name, town_name,
      quantity_packs, bonus_packs, total_units, purchase_rate, trade_price,
      balance_after_packs, remarks, performed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.movementDate || params.movement_date || new Date().toISOString().slice(0, 10),
    Number(params.itemId ?? params.item_id ?? 0),
    params.itemCode || params.item_code || '',
    params.itemName || params.item_name || '',
    params.companyName || params.company_name || '',
    Number(params.inventoryId ?? params.inventory_id ?? 0),
    params.batchNumber || params.batch_number || '',
    params.expiryDate || params.expiry_date || '',
    params.purchaseDate || params.purchase_date || '',
    params.movementType || params.movement_type || 'BATCH_ADJUSTMENT',
    params.referenceType || params.reference_type || '',
    params.referenceId ?? params.reference_id ?? null,
    params.referenceNumber || params.reference_number || '',
    params.partyAccountId ?? params.party_account_id ?? null,
    params.partyName || params.party_name || '',
    params.salesmanId ?? params.salesman_id ?? null,
    params.salesmanName || params.salesman_name || '',
    params.townName || params.town_name || '',
    round2(qtyPacks),
    round2(Number(params.bonusPacks ?? params.bonus_packs ?? 0)),
    round2(Number(params.totalUnits ?? params.total_units ?? qtyPacks)),
    round2(Number(params.purchaseRate ?? params.purchase_rate ?? 0)),
    round2(Number(params.tradePrice ?? params.trade_price ?? 0)),
    round2(Number(params.balanceAfterPacks ?? params.balance_after_packs ?? 0)),
    params.remarks || '',
    params.performedBy || params.performed_by || 'Super Admin'
  );
}

// ============================================================================
// PART 4, 5, 6: TRADE DEALS, PARTY DISCOUNTS & OFFER CALCULATION ENGINE
// ============================================================================

export interface OfferSlab {
  min_qty: number;
  max_qty?: number | null;
  discount_percent?: number;
  fixed_discount_amount?: number;
  bonus_quantity?: number;
  bonus_item_id?: number | null;
  bonus_item_name?: string;
}

export interface LineOfferEvaluationInput {
  itemId: number;
  itemCode?: string;
  itemName?: string;
  companyName?: string;
  quantity: number;
  tradePrice: number;
  partyAccountId?: number | null;
  townId?: number | null;
  townName?: string;
  salesmanId?: number | null;
  invoiceDate?: string;
  manualDiscountPercent?: number | null;
  manualBonusQuantity?: number | null;
  manualOverrideReason?: string;
  preferredInventoryId?: number | null;
}

export interface LineOfferEvaluationResult {
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  sale_quantity: number;
  trade_price: number;
  gross_amount: number;
  // Trade Offer evaluation
  offer_id: number | null;
  offer_code: string;
  offer_name: string;
  offer_type: string;
  offer_discount_percent: number;
  offer_fixed_discount: number;
  offer_discount_amount: number;
  bonus_quantity: number;
  bonus_item_id: number | null;
  bonus_item_name: string;
  // Party Discount evaluation
  party_discount_id: number | null;
  party_discount_code: string;
  party_discount_percent: number;
  party_fixed_discount: number;
  party_discount_amount: number;
  // Stacking & Final Applied Discount
  stacking_rule_applied: string;
  applied_discount_source: 'NONE' | 'TRADE_OFFER' | 'PARTY_DISCOUNT' | 'COMBINED' | 'MANUAL_OVERRIDE';
  effective_discount_percent: number;
  total_discount_amount: number;
  net_amount: number;
  // FIFO Batch Preview
  fifo_allocation: FIFOAllocationPreviewResult;
}

/**
 * Evaluates applicable Trade Offers, Party-Wise Special Discounts, and FIFO Batch Allocation
 * for a single line item entry across Counter Sales, Sales Invoices, Supply Management, Final Billing, and Salesman Booking.
 */
export function evaluateLineOfferAndPartyDiscount(
  input: LineOfferEvaluationInput
): LineOfferEvaluationResult {
  const db = getDatabase();
  const itemRow = db
    .prepare('SELECT id, item_code, item_name, company_name, packing, trade_price, wholesale_price, retail_price FROM items WHERE id = ?')
    .get(input.itemId) as Record<string, any> | undefined;

  const itemId = Number(input.itemId);
  const itemCode = String(input.itemCode || itemRow?.item_code || '');
  const itemName = String(input.itemName || itemRow?.item_name || '');
  const companyName = String(input.companyName || itemRow?.company_name || '');
  const saleQty = round2(Math.max(0, Number(input.quantity || 0)));
  const tradePrice = round2(
    Math.max(
      0,
      Number(
        input.tradePrice ??
          itemRow?.trade_price ??
          itemRow?.wholesale_price ??
          itemRow?.retail_price ??
          0
      )
    )
  );
  const grossAmount = round2(saleQty * tradePrice);
  const invoiceDate = String(input.invoiceDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const settings = db
    .prepare('SELECT discount_stacking_rule FROM company_settings LIMIT 1')
    .get() as { discount_stacking_rule?: string } | undefined;
  const stackingRule = String(settings?.discount_stacking_rule || 'higher_only');

  // 1. Evaluate Active Trade Offers matching Date, Item/Company/All, Town, Party, Salesman, and Quantity
  const activeOffers = db
    .prepare(`
      SELECT *
      FROM trade_offers
      WHERE status = 'Active'
        AND date(start_date) <= date(?)
        AND date(end_date) >= date(?)
      ORDER BY
        CASE
          WHEN scope_type = 'item' AND item_id = ? THEN 0
          WHEN scope_type = 'company' AND LOWER(company_name) = LOWER(?) THEN 1
          WHEN scope_type = 'all_items' THEN 2
          ELSE 3
        END ASC,
        min_quantity DESC,
        id DESC
    `)
    .all(invoiceDate, invoiceDate, itemId, companyName) as Array<Record<string, any>>;

  let matchedOffer: Record<string, any> | null = null;
  let offerDiscPct = 0;
  let offerFixedDisc = 0;
  let offerDiscAmt = 0;
  let bonusQty = 0;
  let bonusItemId: number | null = null;
  let bonusItemName = '';

  if (saleQty > 0) {
    for (const offer of activeOffers) {
      // Scope check
      const scope = String(offer.scope_type || 'item');
      if (scope === 'item' && Number(offer.item_id) !== itemId && String(offer.item_code || '').toLowerCase() !== itemCode.toLowerCase()) {
        continue;
      }
      if (scope === 'company' && String(offer.company_name || '').toLowerCase() !== companyName.toLowerCase()) {
        continue;
      }

      // Optional Territory / Party / Salesman filters
      if (offer.town_id && input.townId && Number(offer.town_id) !== Number(input.townId)) {
        continue;
      }
      if (offer.town_name && input.townName && String(offer.town_name).toLowerCase() !== String(input.townName).toLowerCase()) {
        continue;
      }
      if (offer.party_account_id && Number(offer.party_account_id) !== Number(input.partyAccountId || 0)) {
        continue;
      }
      if (offer.salesman_id && Number(offer.salesman_id) !== Number(input.salesmanId || 0)) {
        continue;
      }

      const offerType = String(offer.offer_type || 'percentage_discount');

      if (offerType === 'slab_based') {
        let slabs: OfferSlab[] = [];
        try {
          slabs = JSON.parse(String(offer.slabs_json || '[]'));
        } catch {
          slabs = [];
        }
        // Sort slabs by min_qty descending so highest qualifying slab matches
        const sortedSlabs = [...slabs].sort((a, b) => Number(b.min_qty || 0) - Number(a.min_qty || 0));
        const matchingSlab = sortedSlabs.find((sl) => {
          const minQ = Number(sl.min_qty || 0);
          const maxQ = sl.max_qty !== undefined && sl.max_qty !== null && Number(sl.max_qty) > 0 ? Number(sl.max_qty) : null;
          return saleQty >= minQ && (maxQ === null || saleQty <= maxQ);
        });

        if (matchingSlab) {
          matchedOffer = offer;
          offerDiscPct = round2(Number(matchingSlab.discount_percent || 0));
          offerFixedDisc = round2(Number(matchingSlab.fixed_discount_amount || 0));
          offerDiscAmt = round2((grossAmount * offerDiscPct) / 100 + offerFixedDisc);
          bonusQty = round2(Number(matchingSlab.bonus_quantity || 0));
          bonusItemId = matchingSlab.bonus_item_id ? Number(matchingSlab.bonus_item_id) : itemId;
          bonusItemName = String(matchingSlab.bonus_item_name || itemName);
          break;
        }
      } else {
        const minQ = Number(offer.min_quantity || 1);
        const maxQ =
          offer.max_quantity !== undefined && offer.max_quantity !== null && Number(offer.max_quantity) > 0
            ? Number(offer.max_quantity)
            : null;
        if (saleQty < minQ) continue;
        if (maxQ !== null && saleQty > maxQ) continue;

        matchedOffer = offer;
        if (offerType === 'percentage_discount') {
          offerDiscPct = round2(Number(offer.discount_percent || 0));
          offerDiscAmt = round2((grossAmount * offerDiscPct) / 100);
        } else if (offerType === 'fixed_discount') {
          offerFixedDisc = round2(Number(offer.fixed_discount_amount || 0));
          offerDiscAmt = round2(Math.min(grossAmount, offerFixedDisc));
          offerDiscPct = grossAmount > 0 ? round2((offerDiscAmt / grossAmount) * 100) : 0;
        } else if (offerType === 'bonus_quantity') {
          // If no max_quantity is set, check if there is a higher tier offer for the same item first (already sorted by min_quantity DESC!)
          const baseBonus = Number(offer.bonus_quantity || 0);
          const multiplier = maxQ === null && minQ > 0 ? Math.floor(saleQty / minQ) : 1;
          bonusQty = round2(baseBonus * Math.max(1, multiplier));
          bonusItemId = offer.bonus_item_id ? Number(offer.bonus_item_id) : itemId;
          bonusItemName = String(offer.bonus_item_name || itemName);
          // Optional accompanying discount on bonus offer
          offerDiscPct = round2(Number(offer.discount_percent || 0));
          offerDiscAmt = round2((grossAmount * offerDiscPct) / 100);
        }
        break;
      }
    }
  }

  // 2. Evaluate Active Party-Wise Special Discounts for partyAccountId
  let matchedPartyDiscount: Record<string, any> | null = null;
  let partyDiscPct = 0;
  let partyFixedDisc = 0;
  let partyDiscAmt = 0;

  if (saleQty > 0 && input.partyAccountId) {
    const partyDiscounts = db
      .prepare(`
        SELECT *
        FROM party_discounts
        WHERE party_account_id = ?
          AND status = 'Active'
          AND (start_date IS NULL OR start_date = '' OR date(start_date) <= date(?))
          AND (end_date IS NULL OR end_date = '' OR date(end_date) >= date(?))
        ORDER BY
          CASE
            WHEN scope_type = 'item' AND item_id = ? THEN 0
            WHEN scope_type = 'company' AND LOWER(company_name) = LOWER(?) THEN 1
            WHEN scope_type = 'all_items' THEN 2
            ELSE 3
          END ASC,
          id DESC
      `)
      .all(Number(input.partyAccountId), invoiceDate, invoiceDate, itemId, companyName) as Array<Record<string, any>>;

    for (const pd of partyDiscounts) {
      const scope = String(pd.scope_type || 'item');
      if (scope === 'item' && Number(pd.item_id) !== itemId && String(pd.item_code || '').toLowerCase() !== itemCode.toLowerCase()) {
        continue;
      }
      if (scope === 'company' && String(pd.company_name || '').toLowerCase() !== companyName.toLowerCase()) {
        continue;
      }
      matchedPartyDiscount = pd;
      partyDiscPct = round2(Number(pd.discount_percent || 0));
      partyFixedDisc = round2(Number(pd.fixed_discount_amount || 0));
      partyDiscAmt = round2(Math.min(grossAmount, (grossAmount * partyDiscPct) / 100 + partyFixedDisc));
      if (partyFixedDisc > 0 && partyDiscPct === 0 && grossAmount > 0) {
        partyDiscPct = round2((partyDiscAmt / grossAmount) * 100);
      }
      break;
    }
  }

  // 3. Apply Discount Calculation & Stacking Rules (Never silently combine unless 'combine_both' is configured)
  let appliedSource: LineOfferEvaluationResult['applied_discount_source'] = 'NONE';
  let effectiveDiscPct = 0;
  let totalDiscountAmt = 0;
  let finalOfferDiscPct = 0;
  let finalOfferDiscAmt = 0;
  let finalPartyDiscPct = 0;
  let finalPartyDiscAmt = 0;

  if (
    input.manualDiscountPercent !== undefined &&
    input.manualDiscountPercent !== null &&
    input.manualOverrideReason &&
    String(input.manualOverrideReason).trim() !== ''
  ) {
    appliedSource = 'MANUAL_OVERRIDE';
    effectiveDiscPct = round2(Math.max(0, Math.min(100, Number(input.manualDiscountPercent))));
    totalDiscountAmt = round2((grossAmount * effectiveDiscPct) / 100);
  } else if (offerDiscAmt > 0 && partyDiscAmt > 0) {
    if (stackingRule === 'combine_both') {
      appliedSource = 'COMBINED';
      finalOfferDiscPct = offerDiscPct;
      finalOfferDiscAmt = offerDiscAmt;
      finalPartyDiscPct = partyDiscPct;
      finalPartyDiscAmt = partyDiscAmt;
      totalDiscountAmt = round2(Math.min(grossAmount, offerDiscAmt + partyDiscAmt));
      effectiveDiscPct = grossAmount > 0 ? round2((totalDiscountAmt / grossAmount) * 100) : 0;
    } else if (stackingRule === 'offer_priority') {
      appliedSource = 'TRADE_OFFER';
      finalOfferDiscPct = offerDiscPct;
      finalOfferDiscAmt = offerDiscAmt;
      totalDiscountAmt = offerDiscAmt;
      effectiveDiscPct = offerDiscPct;
    } else if (stackingRule === 'party_priority') {
      appliedSource = 'PARTY_DISCOUNT';
      finalPartyDiscPct = partyDiscPct;
      finalPartyDiscAmt = partyDiscAmt;
      totalDiscountAmt = partyDiscAmt;
      effectiveDiscPct = partyDiscPct;
    } else {
      // Default: 'higher_only' — apply whichever gives the higher discount
      if (partyDiscAmt > offerDiscAmt) {
        appliedSource = 'PARTY_DISCOUNT';
        finalPartyDiscPct = partyDiscPct;
        finalPartyDiscAmt = partyDiscAmt;
        totalDiscountAmt = partyDiscAmt;
        effectiveDiscPct = partyDiscPct;
      } else {
        appliedSource = 'TRADE_OFFER';
        finalOfferDiscPct = offerDiscPct;
        finalOfferDiscAmt = offerDiscAmt;
        totalDiscountAmt = offerDiscAmt;
        effectiveDiscPct = offerDiscPct;
      }
    }
  } else if (offerDiscAmt > 0) {
    appliedSource = 'TRADE_OFFER';
    finalOfferDiscPct = offerDiscPct;
    finalOfferDiscAmt = offerDiscAmt;
    totalDiscountAmt = offerDiscAmt;
    effectiveDiscPct = offerDiscPct;
  } else if (partyDiscAmt > 0) {
    appliedSource = 'PARTY_DISCOUNT';
    finalPartyDiscPct = partyDiscPct;
    finalPartyDiscAmt = partyDiscAmt;
    totalDiscountAmt = partyDiscAmt;
    effectiveDiscPct = partyDiscPct;
  } else if (bonusQty > 0) {
    appliedSource = 'TRADE_OFFER';
  }

  if (input.manualBonusQuantity !== undefined && input.manualBonusQuantity !== null) {
    bonusQty = round2(Math.max(0, Number(input.manualBonusQuantity)));
  }

  const netAmount = round2(Math.max(0, grossAmount - totalDiscountAmt));

  // 4. Preview FIFO batch allocation for saleQty + bonusQty (if bonus is same item)
  const sameItemBonus = !bonusItemId || bonusItemId === itemId ? bonusQty : 0;
  const fifoAllocation = previewFIFOAllocation({
    itemId,
    saleQtyPacks: saleQty,
    bonusQtyPacks: sameItemBonus,
    preferredInventoryId: input.preferredInventoryId,
  });

  return {
    item_id: itemId,
    item_code: itemCode,
    item_name: itemName,
    company_name: companyName,
    sale_quantity: saleQty,
    trade_price: tradePrice,
    gross_amount: grossAmount,
    offer_id: matchedOffer ? Number(matchedOffer.id) : null,
    offer_code: matchedOffer ? String(matchedOffer.offer_code || '') : '',
    offer_name: matchedOffer ? String(matchedOffer.offer_name || '') : '',
    offer_type: matchedOffer ? String(matchedOffer.offer_type || '') : '',
    offer_discount_percent: finalOfferDiscPct,
    offer_fixed_discount: offerFixedDisc,
    offer_discount_amount: finalOfferDiscAmt,
    bonus_quantity: bonusQty,
    bonus_item_id: bonusQty > 0 ? bonusItemId || itemId : null,
    bonus_item_name: bonusQty > 0 ? bonusItemName || itemName : '',
    party_discount_id: matchedPartyDiscount ? Number(matchedPartyDiscount.id) : null,
    party_discount_code: matchedPartyDiscount ? String(matchedPartyDiscount.discount_code || '') : '',
    party_discount_percent: finalPartyDiscPct,
    party_fixed_discount: partyFixedDisc,
    party_discount_amount: finalPartyDiscAmt,
    stacking_rule_applied: stackingRule,
    applied_discount_source: appliedSource,
    effective_discount_percent: effectiveDiscPct,
    total_discount_amount: totalDiscountAmt,
    net_amount: netAmount,
    fifo_allocation: fifoAllocation,
  };
}
