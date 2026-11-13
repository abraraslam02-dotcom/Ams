import { FilerStatus } from './account';

export type AdvanceTaxBasis = 'taxable_plus_gst' | 'taxable_amount' | 'gross_amount';

export interface AdvanceTaxSettings {
  id: number;
  tax_name: string;
  filer_rate: number;
  non_filer_rate: number;
  exempt_rate: number;
  calculation_basis: AdvanceTaxBasis;
  effective_from: string;
  status: 'Active' | 'Inactive';
  tax_applicability: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface AdvanceTaxHistoryEntry {
  id: number;
  tax_name: string;
  filer_rate: number;
  non_filer_rate: number;
  exempt_rate: number;
  calculation_basis: AdvanceTaxBasis;
  effective_from: string;
  status: string;
  tax_applicability: string;
  change_reason: string;
  changed_by: string;
  changed_at: string;
}

export type PurchasePaymentMode = 'Credit' | 'Cash' | 'Bank' | 'Partial';

export interface PurchaseLineItem {
  id?: number;
  purchase_id?: number;
  item_id: number;
  inventory_id?: number;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  units_per_pack: number;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
  quantity: number;
  bonus_quantity: number;
  pack_quantity?: number;
  loose_quantity?: number;
  total_units?: number;
  purchase_rate: number;
  mrp_rate: number;
  gross_amount: number;
  discount_percent: number;
  discount_amount: number;
  taxable_amount: number;
  tax_percent: number;
  tax_amount: number;
  line_total: number;
  returned_quantity?: number;
  master_purchase_price?: number;
  master_retail_price?: number;
  last_prompted_purchase_rate?: number;
  update_master_purchase_price?: boolean;
  update_master_retail_price?: boolean;
}

export interface PurchaseInvoice {
  id: number;
  bill_number: string;
  supplier_invoice_number: string;
  bill_date: string;
  supplier_account_id: number;
  supplier_code?: string;
  supplier_name?: string;
  supplier_ntn?: string;
  supplier_strn?: string;
  supplier_phone?: string;
  supplier_address?: string;
  supplier_city?: string;
  supplier_filer_status: FilerStatus;
  gross_total: number;
  item_discount_amount: number;
  invoice_discount_percent: number;
  invoice_discount_amount: number;
  discount_amount: number;
  taxable_amount: number;
  gst_amount: number;
  tax_amount: number;
  advance_tax_name: string;
  advance_tax_rate: number;
  advance_tax_basis: AdvanceTaxBasis;
  advance_tax_amount: number;
  is_tax_overridden: number;
  tax_override_reason: string | null;
  tax_override_authorized_by: string | null;
  net_total: number;
  previous_supplier_balance: number;
  previous_balance_type: 'Debit' | 'Credit';
  total_payable: number;
  paid_amount: number;
  remaining_balance: number;
  payment_mode: PurchasePaymentMode;
  payment_account_id: number | null;
  payment_account_code?: string | null;
  payment_account_name?: string | null;
  payment_status: 'unpaid' | 'partial' | 'paid';
  journal_entry_id: number | null;
  status: 'draft' | 'held' | 'completed' | 'cancelled';
  remarks: string | null;
  item_count?: number;
  total_packs?: number;
  created_at: string;
  updated_at: string;
}

export interface PurchaseReturnLineItem {
  id?: number;
  purchase_return_id?: number;
  original_purchase_item_id: number;
  item_id: number;
  inventory_id?: number;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  units_per_pack: number;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
  purchased_quantity: number;
  already_returned_quantity?: number;
  eligible_quantity?: number;
  return_quantity: number;
  return_units?: number;
  debit_unit_rate: number;
  discount_percent: number;
  discount_amount: number;
  taxable_amount: number;
  tax_percent: number;
  gst_amount: number;
  advance_tax_rate: number;
  advance_tax_amount: number;
  line_total: number;
  return_reason: string;
}

export interface PurchaseReturn {
  id: number;
  debit_note_number: string;
  return_date: string;
  original_purchase_id: number;
  original_bill_number: string;
  supplier_account_id: number;
  supplier_code?: string;
  supplier_name?: string;
  supplier_ntn?: string;
  supplier_strn?: string;
  supplier_phone?: string;
  supplier_address?: string;
  supplier_city?: string;
  supplier_filer_status: FilerStatus;
  gross_return_amount: number;
  return_discount_amount: number;
  taxable_return_amount: number;
  gst_adjustment_amount: number;
  advance_tax_rate: number;
  advance_tax_adjustment_amount: number;
  total_debit_amount: number;
  settlement_mode: 'Account Adjustment' | 'Cash Refund' | 'Bank Refund';
  settlement_account_id: number | null;
  return_reason: string;
  journal_entry_id: number | null;
  status: 'completed' | 'cancelled';
  item_count?: number;
  created_at: string;
  updated_at: string;
}

export interface BatchInventoryItem {
  id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  generic_name?: string;
  category: string;
  minimum_stock?: number;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string;
  packing: string;
  strips_per_box: number;
  units_per_strip: number;
  units_per_pack: number;
  cost_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  purchased_qty: number;
  bonus_qty: number;
  returned_qty: number;
  sold_qty: number;
  current_pack_qty: number;
  current_strip_qty: number;
  current_loose_qty: number;
  total_stock_units: number;
  rack_shelf: string | null;
  last_purchase_id: number | null;
  last_supplier_id: number | null;
  last_supplier_name?: string | null;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'expired';
  updated_at: string;
}

export interface JournalEntryLineView {
  id: number;
  journal_entry_id: number;
  account_id: number;
  account_code: string;
  account_name: string;
  ledger_type: 'general' | 'customer' | 'supplier';
  debit_amount: number;
  credit_amount: number;
  narration: string;
}

export type PurchaseReportType =
  | 'purchase-register'
  | 'supplier-wise'
  | 'item-wise'
  | 'batch-wise'
  | 'return-register'
  | 'supplier-outstanding'
  | 'advance-tax-summary'
  | 'expiry-wise'
  | 'top-performance';

