export type MainAccountGroup =
  | 'PARTY ACCOUNTS'
  | 'FINANCIAL ACCOUNTS'
  | 'INCOME & EXPENSE ACCOUNTS';

export const MAIN_ACCOUNT_GROUPS: MainAccountGroup[] = [
  'PARTY ACCOUNTS',
  'FINANCIAL ACCOUNTS',
  'INCOME & EXPENSE ACCOUNTS',
];

export const STANDARD_ACCOUNT_GROUPS: Record<MainAccountGroup, string[]> = {
  'PARTY ACCOUNTS': ['Customer', 'Supplier', 'Customer & Supplier'],
  'FINANCIAL ACCOUNTS': [
    'Cash in Hand',
    'Bank',
    'Capital',
    'Drawings',
    'Loans',
    'Assets',
    'Liabilities',
  ],
  'INCOME & EXPENSE ACCOUNTS': [
    'Sales Income',
    'Purchase Discount',
    'Other Income',
    'Purchases',
    'Purchase Returns',
    'Rent',
    'Electricity',
    'Salaries',
    'Shop Expenses',
    'Other Expenses',
  ],
};

export type FilerStatus = 'Filer' | 'Non-Filer' | 'Exempt';

export interface Account {
  id: number;
  account_code: string;
  account_name: string;
  main_group: MainAccountGroup;
  account_group: string;
  parent_account_id: number | null;
  parent_account_name?: string | null;
  parent_account_code?: string | null;
  opening_balance: number;
  opening_balance_type: 'Debit' | 'Credit';
  total_debit: number;
  total_credit: number;
  current_balance: number;
  current_balance_type: 'Debit' | 'Credit';
  customer_debit: number;
  customer_credit: number;
  supplier_debit: number;
  supplier_credit: number;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  ntn_cnic: string | null;
  ntn: string | null;
  strn: string | null;
  filer_status: FilerStatus;
  tax_registration_details: string | null;
  address: string | null;
  city: string | null;
  credit_limit: number;
  is_system_account: number;
  status: 'Active' | 'Inactive';
  notes: string | null;
  sub_accounts_count?: number;
  linked_transactions_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AccountFormData {
  account_code: string;
  account_name: string;
  main_group: MainAccountGroup;
  account_group: string;
  parent_account_id: number | null;
  opening_balance: number;
  opening_balance_type: 'Debit' | 'Credit';
  contact_person: string;
  phone: string;
  email: string;
  ntn_cnic: string;
  ntn: string;
  strn: string;
  filer_status: FilerStatus;
  tax_registration_details: string;
  address: string;
  city: string;
  credit_limit: number;
  status: 'Active' | 'Inactive';
  notes: string;
}

export interface AccountStats {
  totalAccounts: number;
  activeAccounts: number;
  partyAccountsCount: number;
  financialAccountsCount: number;
  incomeExpenseCount: number;
  customerLedgerCount: number;
  supplierLedgerCount: number;
  totalOpeningDebit: number;
  totalOpeningCredit: number;
  grandTotalDebit: number;
  grandTotalCredit: number;
  totalCustomerReceivables: number;
  totalSupplierPayables: number;
}

export interface ParentAccountCandidate {
  id: number;
  account_code: string;
  account_name: string;
  main_group: MainAccountGroup;
  account_group: string;
}

export interface AccountProtectionInfo {
  total: number;
  sales: number;
  saleReturns: number;
  purchases: number;
  purchaseReturns: number;
  journalLines: number;
  subAccounts: number;
  isSystemAccount: boolean;
  canDelete: boolean;
}
