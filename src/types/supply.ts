export type SupplyLifecycleStatus =
  | 'Booking Pending'
  | 'Packing Pending'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'Return Pending'
  | 'Partially Returned'
  | 'Partially Billed'
  | 'Fully Billed'
  | 'Completed'
  | 'Cancelled';

export type OrderFormPrintLayout =
  | '1-col'
  | '2-col'
  | '3-col'
  | 'thermal-58'
  | 'thermal-80';

export interface SupplySalesman {
  id: number;
  salesman_code: string;
  full_name: string;
  phone: string;
  address: string;
  assigned_area: string;
  commission_percent: number;
  monthly_target: number;
  opening_balance: number;
  opening_balance_type: 'Debit' | 'Credit';
  status: 'Active' | 'Inactive';
  notes: string;
  assigned_towns: Array<{ town_id: number; town_name: string }>;
  assigned_areas: Array<{ area_id: number; area_name: string; town_id: number | null; town_name: string }>;
  assigned_parties: Array<{
    party_account_id: number;
    party_name: string;
    town_name: string;
    area_name: string;
    current_balance: number;
    current_balance_type: 'Debit' | 'Credit';
    phone?: string;
  }>;
  bookings_count: number;
  bookings_amount: number;
  supplies_count: number;
  supplies_amount: number;
  returns_count: number;
  returns_amount: number;
  sales_count: number;
  sales_amount: number;
  recoveries_count: number;
  recoveries_amount: number;
  parties_outstanding_balance: number;
  outstanding_balance: number;
}

export interface TownAreaRecord {
  id: number;
  area_code: string;
  area_name: string;
  town_id: number;
  town_name: string;
  status: 'Active' | 'Inactive';
  notes: string;
}

export interface TownPartyRecord {
  id: number;
  account_code: string;
  account_name: string;
  contact_person?: string;
  phone?: string;
  address?: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  assigned_salesman_id: number | null;
  assigned_salesman_name: string;
  current_balance: number;
  current_balance_type: 'Debit' | 'Credit';
  status: string;
}

export interface TownRecord {
  id: number;
  town_code: string;
  town_name: string;
  status: 'Active' | 'Inactive';
  notes: string;
  areas: TownAreaRecord[];
  assigned_salesmen: Array<{
    town_id: number;
    salesman_id: number;
    salesman_name: string;
    salesman_code: string;
  }>;
  parties: TownPartyRecord[];
  total_parties: number;
  total_areas: number;
  total_supply_amount: number;
  total_return_amount: number;
  total_sales_amount: number;
  total_recovery_amount: number;
  outstanding_balance: number;
}

export interface SupplyOrderFormItem {
  id?: number;
  order_form_id?: number;
  s_no: number;
  item_id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  trade_price: number;
  quantity: number;
  amount: number;
  remarks: string;
}

export interface SupplyOrderForm {
  id: number;
  order_number: string;
  store_name: string;
  order_date: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  party_account_id: number | null;
  party_name: string;
  print_layout: OrderFormPrintLayout;
  total_items: number;
  total_quantity: number;
  total_amount: number;
  status: 'Draft' | 'Saved' | 'Converted' | 'Cancelled';
  converted_booking_id: number | null;
  converted_booking_number: string;
  remarks: string;
  items: SupplyOrderFormItem[];
  created_at?: string;
}

export interface SupplyBookingItem {
  id: number;
  booking_id: number;
  s_no: number;
  item_id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  quantity: number;
  supplied_quantity: number;
  pending_quantity: number;
  bonus_quantity: number;
  trade_price: number;
  discount_percent: number;
  discount_amount: number;
  amount: number;
  remarks: string;
  available_packs?: number;
  net_packable_packs?: number;
  batch_number?: string;
  expiry_date?: string;
  inventory_id?: number | null;
}

export interface SupplyBooking {
  id: number;
  booking_number: string;
  booking_date: string;
  order_form_id: number | null;
  order_number: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  party_account_id: number;
  party_name: string;
  total_items: number;
  total_quantity: number;
  supplied_quantity?: number;
  pending_quantity?: number;
  total_bonus: number;
  gross_amount: number;
  discount_amount: number;
  total_amount: number;
  status: 'Booking Pending' | 'Partially Supplied' | 'Supplied' | 'Cancelled';
  remarks: string;
  items: SupplyBookingItem[];
}

export interface PartySupplyItem {
  id: number;
  town_supply_id: number;
  party_supply_id: number;
  booking_id: number | null;
  booking_item_id: number | null;
  booking_number: string;
  party_account_id: number;
  party_name: string;
  s_no: number;
  item_id: number;
  inventory_id: number | null;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  batch_number: string;
  expiry_date: string;
  ordered_quantity: number;
  supply_quantity: number;
  bonus_quantity: number;
  packed_quantity: number;
  remaining_pack_quantity: number;
  packing_status: 'Pending' | 'Partial' | 'Packed';
  returned_quantity: number;
  accepted_return_qty: number;
  damaged_return_qty: number;
  billed_quantity: number;
  net_billable_qty: number;
  trade_price: number;
  discount_percent: number;
  discount_amount: number;
  amount: number;
  return_amount: number;
  net_billable_amount: number;
  available_packs?: number;
  net_packable_packs?: number;
}

export interface PartySupplyDocument {
  id: number;
  town_supply_id: number;
  supply_number: string;
  party_supply_number: string;
  supply_date: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  party_account_id: number;
  party_name: string;
  booking_numbers: string;
  total_items: number;
  ordered_qty: number;
  supply_qty: number;
  bonus_qty: number;
  gross_amount: number;
  discount_amount: number;
  supply_amount: number;
  return_qty: number;
  return_amount: number;
  net_billable_amount: number;
  billed_amount: number;
  recovered_amount: number;
  final_sale_id: number | null;
  final_invoice_number: string;
  packing_status: 'Pending' | 'Partial' | 'Packed';
  delivery_status: 'Pending' | 'Dispatched' | 'Delivered';
  supply_status: SupplyLifecycleStatus;
  remarks: string;
  items: PartySupplyItem[];
}

export interface SupplyDispatchRecord {
  id: number;
  dispatch_number: string;
  town_supply_id: number;
  supply_number: string;
  dispatch_date: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  vehicle_number: string;
  delivery_person: string;
  total_parties: number;
  total_items: number;
  total_quantity: number;
  total_amount: number;
  delivery_status: 'Dispatched' | 'Delivered' | 'Pending';
  remarks: string;
}

export interface SupplyReturnItemRecord {
  id: number;
  supply_return_id: number;
  town_supply_id: number;
  party_supply_id: number;
  party_supply_item_id: number;
  party_account_id: number;
  party_name: string;
  item_id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  packing: string;
  batch_number: string;
  supplied_quantity: number;
  previously_returned_qty: number;
  new_return_quantity: number;
  accepted_quantity: number;
  damaged_quantity: number;
  trade_price: number;
  discount_percent: number;
  return_amount: number;
  return_reason: string;
}

export interface SupplyReturnRecord {
  id: number;
  return_number: string;
  return_date: string;
  town_supply_id: number;
  party_supply_id: number | null;
  supply_number: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  party_account_id: number | null;
  party_name: string;
  total_returned_qty: number;
  total_accepted_qty: number;
  total_damaged_qty: number;
  total_return_amount: number;
  status: string;
  remarks: string;
  items: SupplyReturnItemRecord[];
}

export interface SupplyRecoveryRecord {
  id: number;
  recovery_receipt_number: string;
  recovery_date: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  party_account_id: number;
  party_name: string;
  town_supply_id: number | null;
  party_supply_id: number | null;
  supply_number: string;
  sale_id: number | null;
  invoice_number: string;
  previous_outstanding: number;
  recovery_amount: number;
  remaining_balance: number;
  payment_method: 'Cash' | 'Bank' | 'Cheque' | 'Online';
  payment_account_id: number | null;
  payment_account_name: string;
  is_settled: number;
  settlement_id: number | null;
  status: string;
  remarks: string;
}

export interface SalesmanSettlementRecord {
  id: number;
  settlement_number: string;
  settlement_date: string;
  from_date: string;
  to_date: string;
  salesman_id: number;
  salesman_name: string;
  total_supplies: number;
  total_returns: number;
  total_final_billing: number;
  total_cash_collected: number;
  total_bank_collections: number;
  total_outstanding: number;
  cash_submitted_to_store: number;
  remaining_cash_in_hand: number;
  difference_amount: number;
  status: string;
  settled_by: string;
  remarks: string;
}

export interface TownSupplyRecord {
  id: number;
  supply_number: string;
  supply_date: string;
  salesman_id: number | null;
  salesman_name: string;
  town_id: number | null;
  town_name: string;
  area_id: number | null;
  area_name: string;
  total_parties: number;
  total_items: number;
  total_ordered_qty: number;
  total_supply_qty: number;
  total_bonus_qty: number;
  gross_amount: number;
  discount_amount: number;
  total_supply_amount: number;
  total_return_qty: number;
  total_return_amount: number;
  net_billable_amount: number;
  total_billed_amount: number;
  total_recovered_amount: number;
  packing_status: 'Pending' | 'Partial' | 'Packed';
  supply_status: SupplyLifecycleStatus;
  stock_deducted: number;
  packed_by?: string;
  dispatched_by?: string;
  billed_by?: string;
  remarks: string;
  party_supplies: PartySupplyDocument[];
  items: PartySupplyItem[];
  dispatches: SupplyDispatchRecord[];
  returns: SupplyReturnRecord[];
  invoices: Array<Record<string, unknown>>;
  recoveries: SupplyRecoveryRecord[];
}
