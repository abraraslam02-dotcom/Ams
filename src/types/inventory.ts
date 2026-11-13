export interface StockDatasheetItem {
  id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  generic_name: string;
  category: string;
  company_name: string;
  dosage_form: string;
  strength: string;
  barcode: string;
  packing: string;
  units_per_pack: number;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  days_to_expiry: number;
  expiry_status: 'EXPIRED' | 'NEAR_EXPIRY' | 'GOOD';
  purchase_rate: number;
  sale_price: number;
  retail_price: number;
  opening_stock: number;
  purchased_qty: number;
  bonus_qty: number;
  sold_qty: number;
  purchase_return_qty: number;
  sales_return_qty: number;
  adjusted_qty: number;
  current_stock: number;
  current_pack_qty: number;
  current_loose_qty: number;
  total_stock_units: number;
  stock_value: number;
  retail_value: number;
  rack_location: string;
  min_stock_level: number;
  reorder_level: number;
}

export interface CurrentStockSummary {
  item_id: number;
  item_code: string;
  item_name: string;
  generic_name: string;
  category: string;
  company_name: string;
  packing: string;
  units_per_pack: number;
  barcode: string;
  min_stock_level: number;
  reorder_level: number;
  batch_count: number;
  total_packs: number;
  total_loose: number;
  total_units: number;
  weighted_avg_purchase_rate: number;
  latest_retail_price: number;
  total_cost_value: number;
  total_retail_value: number;
  nearest_expiry: string | null;
  stock_status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OPTIMAL' | 'OVER_STOCKED';
}

export interface InventoryOverview {
  total_items: number;
  active_batches: number;
  total_packs_in_stock: number;
  total_units_in_stock: number;
  total_cost_valuation: number;
  total_retail_valuation: number;
  potential_margin_value: number;
  near_expiry_count: number;
  expired_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  near_expiry_days_setting: number;
}

export interface ExpiryAlertItem {
  id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  batch_number: string;
  expiry_date: string;
  mfg_date: string;
  days_to_expiry: number;
  expiry_tier: 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS' | 'BEYOND_90';
  current_pack_qty: number;
  current_loose_qty: number;
  total_units: number;
  purchase_rate: number;
  retail_price: number;
  total_cost_at_risk: number;
  rack_location: string;
}

export interface LowStockItem {
  item_id: number;
  item_code: string;
  item_name: string;
  generic_name: string;
  company_name: string;
  category: string;
  packing: string;
  units_per_pack: number;
  min_stock_level: number;
  reorder_level: number;
  current_packs: number;
  current_loose: number;
  total_current_units: number;
  deficit_packs: number;
  suggested_order_packs: number;
  last_purchase_rate: number;
  estimated_reorder_cost: number;
  status: 'OUT_OF_STOCK' | 'LOW_STOCK';
}

export interface StockAdjustment {
  id: number;
  adjustment_no: string;
  adjustment_date: string;
  reference_no: string | null;
  reason_category: 'INCREASE' | 'DECREASE' | 'DAMAGE' | 'EXPIRED' | 'PHYSICAL_DIFFERENCE' | 'CORRECTION';
  description: string;
  total_items: number;
  total_cost_impact: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
  journal_voucher_id: number | null;
  items?: StockAdjustmentItem[];
}

export interface StockAdjustmentItem {
  id: number;
  adjustment_id: number;
  inventory_id: number;
  item_id: number;
  batch_number: string;
  direction: 'INCREASE' | 'DECREASE';
  quantity_packs: number;
  quantity_loose: number;
  unit_cost: number;
  total_cost: number;
  reason_note: string | null;
  item_name?: string;
  item_code?: string;
  packing?: string;
  expiry_date?: string;
}

export interface StockTransfer {
  id: number;
  transfer_no: string;
  transfer_date: string;
  from_location: string;
  to_location: string;
  reference_no: string | null;
  remarks: string | null;
  total_items: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
  items?: StockTransferItem[];
}

export interface StockTransferItem {
  id: number;
  transfer_id: number;
  inventory_id: number;
  item_id: number;
  batch_number: string;
  quantity_packs: number;
  quantity_loose: number;
  item_name?: string;
  item_code?: string;
  packing?: string;
  from_rack?: string;
  to_rack?: string;
}

export interface StockLedgerEntry {
  transaction_id: string;
  date: string;
  type: 'OPENING' | 'PURCHASE' | 'PURCHASE_BONUS' | 'SALE' | 'PURCHASE_RETURN' | 'SALES_RETURN' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  type_label: string;
  ref_no: string;
  party_name?: string;
  item_id?: number;
  item_code?: string;
  item_name?: string;
  company_name?: string;
  item_group?: string;
  batch_number: string;
  expiry_date: string;
  opening_packs?: number;
  purchase_packs?: number;
  purchase_bonus_packs?: number;
  purchase_return_packs?: number;
  sale_packs?: number;
  sale_bonus_packs?: number;
  sale_return_packs?: number;
  transfer_in_packs?: number;
  transfer_out_packs?: number;
  in_packs: number;
  in_loose: number;
  out_packs: number;
  out_loose: number;
  net_pack_change: number;
  running_pack_balance: number;
  running_loose_balance: number;
  unit_cost: number;
  discount_amount?: number;
  debit_amount?: number;
  credit_amount?: number;
  remarks: string;
  user_name: string;
}

export interface PhysicalVerification {
  id: number;
  verification_no: string;
  verification_date: string;
  status: 'DRAFT' | 'RECONCILED' | 'CANCELLED';
  conducted_by: number;
  conducted_by_name: string;
  reconciled_by: number | null;
  reconciled_by_name: string | null;
  reconciled_at: string | null;
  remarks: string | null;
  adjustment_id: number | null;
  created_at: string;
  items?: PhysicalVerificationItem[];
}

export interface PhysicalVerificationItem {
  id: number;
  verification_id: number;
  inventory_id: number;
  item_id: number;
  batch_number: string;
  expiry_date: string;
  item_name?: string;
  item_code?: string;
  company_name?: string;
  item_group?: string;
  packing?: string;
  units_per_pack?: number;
  system_pack_qty: number;
  system_loose_qty: number;
  physical_pack_qty: number;
  physical_loose_qty: number;
  diff_pack_qty: number;
  diff_loose_qty: number;
  unit_cost: number;
  diff_cost_impact: number;
  reason_note: string | null;
}

export interface ReportMetaCompany {
  company_name: string;
  item_count: number;
}

export interface ReportMetaItem {
  id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  item_group: string;
  packing: string;
  units_per_pack: number;
  trade_price: number;
  purchase_price: number;
  retail_price: number;
}

export interface CompanyItemMetaResponse {
  success: boolean;
  companies: ReportMetaCompany[];
  itemGroups: string[];
  items: ReportMetaItem[];
}

export interface ItemStockReportRow {
  s_no: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  item_group: string;
  packing: string;
  units_per_pack: number;
  opening_stock: number;
  purchase_qty: number;
  purchase_bonus: number;
  purchase_return: number;
  sale_qty: number;
  sale_paid_qty: number;
  sale_bonus: number;
  sale_return: number;
  transfer_in: number;
  transfer_out: number;
  physical_adjustment: number;
  closing_stock: number;
  trade_price: number;
  stock_value: number;
}

export interface StockStatementRow {
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  item_group: string;
  trade_price: number;
  opening: number;
  rcvd: number;
  total: number;
  today: number;
  last_month_qty: number;
  last_month_bonus: number;
  sales_qty: number;
  sales_bonus: number;
  return_qty: number;
  return_bonus: number;
  net_sales_qty: number;
  net_sales_bonus: number;
  net_sales_amount: number;
  closing_qty: number;
  closing_amount: number;
}

export interface StockStatementSubtotal {
  opening: number;
  rcvd: number;
  total: number;
  today: number;
  last_month_qty: number;
  last_month_bonus: number;
  sales_qty: number;
  sales_bonus: number;
  return_qty: number;
  return_bonus: number;
  net_sales_qty: number;
  net_sales_bonus: number;
  net_sales_amount: number;
  closing_qty: number;
  closing_amount: number;
}

export interface StockStatementGroup {
  company_name: string;
  items: StockStatementRow[];
  subtotal: StockStatementSubtotal;
}

export interface StockStatementResponse {
  success: boolean;
  store?: {
    store_name?: string;
    address?: string;
    phone?: string;
    drug_license_number?: string;
    ntn_tax_number?: string;
  };
  fromDate: string;
  toDate: string;
  prevMonthRange?: { prevStart: string; prevEnd: string };
  companies: StockStatementGroup[];
  grandTotal: StockStatementSubtotal;
}

export interface DetailedItemStockRow {
  s_no: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  item_group: string;
  trade_price: number;
  last_month_sale: number;
  opening_stock: number;
  opening_bonus: number;
  purchase_qty: number;
  purchase_bonus: number;
  purchase_return: number;
  sale_qty: number;
  sale_paid_qty: number;
  sale_bonus_qty: number;
  sale_return: number;
  transfer_in: number;
  transfer_out: number;
  physical_adjustment: number;
  closing_stock: number;
  purchase_rate: number;
  sale_rate: number;
  total_purchase_value: number;
  total_sales_value: number;
  discount_amount: number;
  batch_number: string;
  expiry_date: string;
  packing: string;
  stock_value: number;
}
