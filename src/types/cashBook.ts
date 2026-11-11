export type CashBookTransactionType =
  | 'Receipt'
  | 'Payment'
  | 'Contra'
  | 'Expense'
  | 'Capital';

export type CashBookCategory =
  | 'customer_receipt'
  | 'supplier_payment'
  | 'shop_expense'
  | 'capital_introduced'
  | 'drawings'
  | 'cash_deposit_bank'
  | 'cash_withdrawal_bank'
  | 'bank_transfer'
  | 'other_receipt'
  | 'other_payment';

export interface CashBookVoucher {
  id: number;
  voucher_number: string;
  sequence_number: number;
  voucher_date: string;
  transaction_type: CashBookTransactionType;
  category: CashBookCategory;
  head_account_id: number;
  head_account_code: string;
  head_account_name: string;
  head_group?: string;
  head_balance?: number;
  cash_bank_account_id: number;
  cash_bank_account_code: string;
  cash_bank_account_name: string;
  cb_group?: string;
  cb_balance?: number;
  receipt_amount: number;
  payment_amount: number;
  net_amount: number;
  narration: string;
  reference_number: string;
  journal_entry_id?: number | null;
  accounting_voucher_id?: number | null;
  status: 'posted' | 'cancelled';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DailyCashBookRegisterRow {
  date: string;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  closingCash: number;
  openingBank: number;
  bankIn: number;
  bankOut: number;
  closingBank: number;
  voucherCount: number;
}

export interface CashBookSummaryResponse {
  success: boolean;
  startDate: string;
  endDate: string;
  openingCashBalance: number;
  totalCashReceived: number;
  totalCashPaid: number;
  closingCashBalance: number;
  openingBankBalance: number;
  totalBankDeposits: number;
  totalBankWithdrawals: number;
  totalBankPayments: number;
  totalBankReceipts: number;
  closingBankBalance: number;
  totalIncome: number;
  totalExpenses: number;
  totalOwnerCapital: number;
  totalOwnerDrawings: number;
  dailyRegister: DailyCashBookRegisterRow[];
  totalVouchersCount: number;
}

export interface CashBookBreakdownResponse {
  success: boolean;
  startDate: string;
  endDate: string;
  whoPaidUs: Array<{
    id: number;
    voucher_number: string;
    voucher_date: string;
    amount: number;
    payer_name: string;
    payer_code: string;
    account_group: string;
    phone?: string;
    payment_account: string;
    narration: string;
    reference_number: string;
  }>;
  whomDidWePay: Array<{
    id: number;
    voucher_number: string;
    voucher_date: string;
    amount: number;
    payee_name: string;
    payee_code: string;
    account_group: string;
    payment_account: string;
    category: string;
    narration: string;
    reference_number: string;
  }>;
  moneyFromCategories: Array<{
    category_label: string;
    voucher_count: number;
    total_amount: number;
  }>;
  moneySpentCategories: Array<{
    category_label: string;
    voucher_count: number;
    total_amount: number;
  }>;
  bankContra: Array<{
    id: number;
    voucher_number: string;
    voucher_date: string;
    category: string;
    net_amount: number;
    head_account_name: string;
    cash_bank_account_name: string;
    narration: string;
    reference_number: string;
  }>;
  cashAndBankAccounts: Array<{
    id: number;
    account_code: string;
    account_name: string;
    account_group: string;
    opening_balance: number;
    opening_balance_type: string;
    total_debit: number;
    total_credit: number;
    current_balance: number;
    current_balance_type: 'Debit' | 'Credit';
  }>;
}

export interface CashBookAccountsResponse {
  success: boolean;
  defaultCashAccount: any;
  cashAccounts: any[];
  bankAccounts: any[];
  customerAccounts: any[];
  supplierAccounts: any[];
  expenseAccounts: any[];
  capitalAccounts: any[];
  incomeAccounts: any[];
  allAccounts: any[];
}
