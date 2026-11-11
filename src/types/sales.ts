export type SalesInvoiceType = 'Retail' | 'Wholesale';
export type SalesPaymentMode = 'Cash' | 'Credit' | 'Partial' | 'Bank';
export type SalesStatus = 'draft' | 'held' | 'completed' | 'cancelled';

export interface FastSearchBatch {
  id: number;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
  current_pack_qty: number;
  current_strip_qty: number;
  current_loose_qty: number;
  total_stock_units: number;
  units_per_pack: number;
  mrp_per_pack: number;
  purchase_price_per_pack: number;
  status: string;
}

export interface FastSearchItem {
  id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string;
  category: string;
  packing: string;
  barcode: string;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  discount_percent: number;
  tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  rack_number: string;
  status: string;
  strips_per_box: number;
  units_per_strip: number;
  units_per_pack: number;
  loose_rate?: number;
  retail_loose_rate: number;
  wholesale_loose_rate: number;
  cost_price_per_unit: number;
  total_available_units: number;
  total_available_packs: number;
  default_batch: {
    inventory_id: number | null;
    batch_number: string;
    expiry_date: string;
    available_packs: number;
    available_units: number;
  };
  batches: FastSearchBatch[];
}

export interface DatasheetRow {
  row_id: string;
  item_id: number | null;
  inventory_id: number | null;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  strips_per_box: number;
  units_per_strip: number;
  units_per_pack: number;
  batch_number: string;
  expiry_date: string;
  available_stock_packs: number;
  available_stock_units: number;
  quantity: number; // Full Box/Pack Quantity
  bonus_quantity?: number; // Free bonus items deducted from stock
  unit_price: number; // Price per Pack
  discount_percent: number;
  discount_amount: number;
  loose_quantity: number; // Loose Units (Tablets / Capsules)
  loose_rate: number; // Loose Unit Rate
  total_units: number; // quantity * units_per_pack + loose_quantity
  gross_amount: number;
  taxable_amount: number;
  tax_percent: number;
  tax_amount: number;
  line_total: number;
  retail_price_ref: number;
  wholesale_price_ref: number;
  item_loose_rate_ref?: number;
  batches: FastSearchBatch[];
  // Rate suggestion & manual override tracking
  isRateManuallyEdited?: boolean;
  isLooseRateManuallyEdited?: boolean;
  rateSuggestionSource?: 'customer_last_sale' | 'standard_retail' | 'standard_wholesale' | 'manual';
  lastCustomerSaleRate?: number | null;
  lastCustomerDiscountPercent?: number | null;
  lastCustomerSaleDate?: string | null;
  lastCustomerInvoiceNo?: string | null;
  lastCustomerSoldQty?: number | null;
  previousCustomerSaleRateBeforeLast?: number | null;
  lastPurchaseCostRate?: number | null;
  lastPurchaseDate?: string | null;
  lastSupplierName?: string | null;
}

export interface SalesInvoiceRecord {
  id: number;
  invoice_number: string;
  invoice_date: string;
  customer_account_id: number;
  customer_name: string;
  customer_code?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_city?: string;
  customer_ntn?: string;
  customer_filer_status: 'Filer' | 'Non-Filer' | 'Exempt';
  salesman_id?: number | null;
  salesman: string;
  deliveryman_id?: number | null;
  deliveryman_name?: string | null;
  delivery_status?: 'Pending' | 'Assigned' | 'Out for Delivery' | 'Delivered' | 'Failed' | 'Returned';
  delivery_date?: string | null;
  delivery_time?: string | null;
  delivery_notes?: string | null;
  delivery_charges?: number;
  delivery_completed_by?: string | null;
  delivery_completed_at?: string | null;
  invoice_type: SalesInvoiceType;
  payment_mode: SalesPaymentMode;
  payment_account_id: number | null;
  payment_account_name?: string;
  gross_total: number;
  item_discount_amount: number;
  invoice_discount_percent: number;
  invoice_discount_amount: number;
  discount_override_by?: string | null;
  discount_override_reason?: string | null;
  discount_amount: number;
  taxable_amount: number;
  gst_amount: number;
  advance_tax_applicable: number;
  advance_tax_rate: number;
  advance_tax_amount: number;
  is_tax_overridden: number;
  tax_override_reason?: string | null;
  tax_override_authorized_by?: string | null;
  tax_amount: number;
  net_total: number;
  previous_customer_balance: number;
  previous_balance_type: 'Debit' | 'Credit';
  total_receivable: number;
  paid_amount: number;
  balance_amount: number;
  allow_negative_stock: number;
  journal_entry_id: number | null;
  payment_journal_entry_id: number | null;
  status: SalesStatus;
  remarks?: string;
  item_count?: number;
  items?: Array<Record<string, any>>;
  journalLines?: Array<Record<string, any>>;
  created_by?: string;
  updated_by?: string;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerSaleHistoryEntry {
  sale_item_id: number;
  sale_id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  packing: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  bonus_quantity?: number;
  loose_quantity: number;
  total_units: number;
  unit_price: number;
  loose_rate: number;
  discount_percent: number;
  discount_amount: number;
  tax_percent: number;
  tax_amount: number;
  line_total: number;
  invoice_number: string;
  invoice_date: string;
  invoice_type: string;
  payment_mode: string;
  customer_account_id: number;
  customer_name: string;
  salesman: string;
}

export interface ItemPurchaseHistoryEntry {
  purchase_item_id: number;
  purchase_id: number;
  item_id: number;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
  packing: string;
  quantity: number;
  bonus_quantity: number;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  discount_percent: number;
  discount_amount: number;
  tax_percent: number;
  tax_amount: number;
  line_total: number;
  effective_cost_per_pack: number;
  bill_number: string;
  supplier_invoice_no: string;
  bill_date: string;
  supplier_account_id: number;
  supplier_name: string;
}

export interface CustomerItemHistoryResponse {
  success: boolean;
  item: Record<string, any>;
  customerId: number | null;
  hasCustomerHistory: boolean;
  lastCustomerSale: CustomerSaleHistoryEntry | null;
  previousCustomerSaleBeforeLast: CustomerSaleHistoryEntry | null;
  customerSalesHistory: CustomerSaleHistoryEntry[];
  lastPurchase: ItemPurchaseHistoryEntry | null;
  purchaseHistory: ItemPurchaseHistoryEntry[];
}

export interface SalesmanRecord {
  id: number;
  salesman_code: string;
  name: string;
  mobile: string;
  address: string;
  joining_date: string;
  commission_type: 'Percentage' | 'Fixed Amount';
  commission_rate: number;
  status: 'Active' | 'Inactive';
  notes?: string;
  completed_invoices_count?: number;
  invoice_count?: number;
  total_net_sales?: number;
  total_sales_amount?: number;
  total_commission_earned?: number;
  commission_earned?: number;
  total_commission_paid?: number;
  commission_paid?: number;
  commission_outstanding?: number;
}

export interface DeliverymanRecord {
  id: number;
  deliveryman_code: string;
  name: string;
  mobile: string;
  address: string;
  joining_date: string;
  status: 'Active' | 'Inactive';
  notes?: string;
  total_assigned_invoices?: number;
  total_assigned?: number;
  delivered_count?: number;
  pending_count?: number;
  failed_or_returned_count?: number;
  failed_count?: number;
  total_delivery_charges?: number;
}

export interface DeliveryTrackingRecord {
  id?: number;
  sale_id: number;
  invoice_number: string;
  invoice_date: string;
  customer_account_id?: number;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  salesman?: string;
  salesman_id?: number | null;
  deliveryman_id?: number | null;
  deliveryman_name?: string;
  delivery_status?: 'Pending' | 'Assigned' | 'Out for Delivery' | 'Delivered' | 'Failed' | 'Returned' | string;
  delivery_date?: string;
  delivery_time?: string;
  delivery_notes?: string;
  delivery_charges?: number;
  delivery_completed_by?: string;
  delivery_completed_at?: string;
  net_total?: number;
}

export interface SaleReturnRecord {
  id: number;
  return_number: string;
  return_date: string;
  original_sale_id: number;
  original_invoice_number: string;
  customer_account_id: number;
  customer_name: string;
  customer_code?: string;
  refund_mode: 'Account Adjustment' | 'Cash Refund' | 'Bank Refund';
  refund_account_id: number | null;
  gross_return_amount: number;
  return_discount_amount: number;
  taxable_return_amount: number;
  gst_adjustment_amount: number;
  advance_tax_adjustment_amount: number;
  total_refund_amount: number;
  return_reason: string;
  journal_entry_id: number | null;
  status: string;
  item_count?: number;
  items?: Array<Record<string, any>>;
  journalLines?: Array<Record<string, any>>;
}

export interface PaymentVoucherRecord {
  id: number;
  voucher_number: string;
  voucher_date: string;
  voucher_type: 'receive_payment' | 'customer_receipt' | 'cash_payment' | 'bank_payment';
  party_account_id: number;
  party_code?: string;
  party_name?: string;
  party_group?: string;
  financial_account_id: number;
  financial_code?: string;
  financial_name?: string;
  amount: number;
  payment_method: 'Cash' | 'Bank Transfer' | 'Cheque' | 'Online';
  reference_number: string;
  description: string;
  journal_entry_id: number | null;
  journal_entry_number?: string;
  status: string;
  created_at?: string;
}
