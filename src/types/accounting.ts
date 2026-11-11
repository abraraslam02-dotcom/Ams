export type FinancialPillar =
  | 'Assets'
  | 'Liabilities'
  | 'Capital / Equity'
  | 'Income'
  | 'Expenses';

export type VoucherTypeCode = 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV' | 'CV';

export interface AccountingVoucherLine {
  id?: number;
  voucher_id?: number;
  account_id: number;
  account_code: string;
  account_name: string;
  account_group?: string;
  financial_category?: FinancialPillar;
  ledger_type?: 'general' | 'customer' | 'supplier';
  debit_amount: number;
  credit_amount: number;
  description: string;
  line_order?: number;
}

export interface AccountingVoucher {
  id: number;
  voucher_number: string;
  voucher_type: VoucherTypeCode;
  voucher_date: string;
  reference_number: string;
  narration: string;
  total_debit: number;
  total_credit: number;
  status: 'draft' | 'posted' | 'reversed' | 'cancelled';
  approval_status: 'Draft' | 'Pending' | 'Approved' | 'Reversed' | 'Cancelled';
  created_by: string;
  approved_by?: string | null;
  journal_entry_id?: number | null;
  reversal_voucher_id?: number | null;
  reversed_from_voucher_id?: number | null;
  created_at: string;
  updated_at: string;
  lines: AccountingVoucherLine[];
}

export interface LedgerEntryRow {
  id: number;
  journal_entry_id: number;
  entry_date: string;
  entry_number: string;
  document_number: string;
  reference_type: string;
  reference_id: number;
  description: string;
  narration: string;
  ledger_type: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
  running_balance_type: 'Debit' | 'Credit';
}

export interface DetailedAccountLedger {
  account: {
    id: number;
    account_code: string;
    account_name: string;
    main_group: string;
    account_group: string;
    financial_category?: FinancialPillar;
    phone?: string;
    city?: string;
    ntn?: string;
    strn?: string;
    filer_status?: string;
  };
  openingBalance: number;
  openingBalanceType: 'Debit' | 'Credit';
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  closingBalanceType: 'Debit' | 'Credit';
  breakdown: {
    salesAmount: number;
    salesReturnsAmount: number;
    customerReceiptsAmount: number;
    purchasesAmount: number;
    purchaseReturnsAmount: number;
    supplierPaymentsAmount: number;
    adjustmentsAmount: number;
  };
  entries: LedgerEntryRow[];
}

export type FinancialReportKey =
  | 'trial-balance'
  | 'profit-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'day-book'
  | 'account-summary'
  | 'customer-outstanding'
  | 'supplier-outstanding'
  | 'expense-summary'
  | 'income-summary'
  | 'advance-tax-report';
