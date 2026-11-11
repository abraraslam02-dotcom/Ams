import * as XLSX from 'xlsx';
import { Account, MainAccountGroup, MAIN_ACCOUNT_GROUPS } from '../types/account';

export const ACCOUNT_EXCEL_COLUMNS = [
  { header: 'Account Code', key: 'account_code', width: 16 },
  { header: 'Account Name', key: 'account_name', width: 28 },
  { header: 'Main Group', key: 'main_group', width: 26 },
  { header: 'Account Group', key: 'account_group', width: 22 },
  { header: 'Parent Account Code', key: 'parent_account_code', width: 18 },
  { header: 'Opening Balance', key: 'opening_balance', width: 16 },
  { header: 'Opening Balance Type', key: 'opening_balance_type', width: 18 },
  { header: 'Current Balance', key: 'current_balance', width: 16 },
  { header: 'Current Balance Type', key: 'current_balance_type', width: 18 },
  { header: 'Contact Person', key: 'contact_person', width: 20 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 22 },
  { header: 'NTN / CNIC / Bank Acc', key: 'ntn_cnic', width: 20 },
  { header: 'Address', key: 'address', width: 28 },
  { header: 'City', key: 'city', width: 14 },
  { header: 'Credit Limit', key: 'credit_limit', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Notes', key: 'notes', width: 24 },
];

/**
 * Export Accounts Master to Excel (.xlsx)
 */
export function exportAccountsToExcel(
  accounts: Account[],
  filename: string = 'Abrar_Medical_Store_Accounts_Master.xlsx'
) {
  const data = accounts.map((acc) => ({
    'Account Code': acc.account_code,
    'Account Name': acc.account_name,
    'Main Group': acc.main_group,
    'Account Group': acc.account_group,
    'Parent Account Code': acc.parent_account_code || '',
    'Opening Balance': Number(acc.opening_balance.toFixed(2)),
    'Opening Balance Type': acc.opening_balance_type,
    'Current Balance': Number(acc.current_balance.toFixed(2)),
    'Current Balance Type': acc.current_balance_type,
    'Contact Person': acc.contact_person || '',
    Phone: acc.phone || '',
    Email: acc.email || '',
    'NTN / CNIC / Bank Acc': acc.ntn_cnic || '',
    Address: acc.address || '',
    City: acc.city || '',
    'Credit Limit': Number((acc.credit_limit || 0).toFixed(2)),
    Status: acc.status,
    Notes: acc.notes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = ACCOUNT_EXCEL_COLUMNS.map((c) => ({ wch: c.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Chart of Accounts');

  XLSX.writeFile(workbook, filename);
}

/**
 * Download standard Excel Template for Accounts Master Import
 */
export function downloadAccountsExcelTemplate() {
  const sampleRows = [
    {
      'Account Code': 'CUST-001',
      'Account Name': 'City Hospital Pharmacy',
      'Main Group': 'PARTY ACCOUNTS',
      'Account Group': 'Customer',
      'Parent Account Code': 'ACC-1000',
      'Opening Balance': 25000.0,
      'Opening Balance Type': 'Debit',
      'Contact Person': 'Dr. Tariq Mehmood',
      Phone: '+92 300 4112233',
      Email: 'pharmacy@cityhospital.pk',
      'NTN / CNIC / Bank Acc': 'NTN-4123980-1',
      Address: 'Jail Road, Gulberg',
      City: 'Lahore',
      'Credit Limit': 100000.0,
      Status: 'Active',
      Notes: 'Institutional credit customer',
    },
    {
      'Account Code': 'SUP-001',
      'Account Name': 'Premier Pharma Distributors',
      'Main Group': 'PARTY ACCOUNTS',
      'Account Group': 'Supplier',
      'Parent Account Code': 'ACC-2000',
      'Opening Balance': 85000.0,
      'Opening Balance Type': 'Credit',
      'Contact Person': 'Mr. Kamran Siddiqui',
      Phone: '+92 42 36301122',
      Email: 'orders@premierpharma.pk',
      'NTN / CNIC / Bank Acc': 'NTN-8891204-5',
      Address: 'Medicine Market, Lohari Gate',
      City: 'Lahore',
      'Credit Limit': 500000.0,
      Status: 'Active',
      Notes: 'Authorized distributor for GSK & Abbott',
    },
    {
      'Account Code': 'DUAL-001',
      'Account Name': 'Al-Shifa Medicos & Wholesale',
      'Main Group': 'PARTY ACCOUNTS',
      'Account Group': 'Customer & Supplier',
      'Parent Account Code': 'ACC-3000',
      'Opening Balance': 12000.0,
      'Opening Balance Type': 'Debit',
      'Contact Person': 'Haji Muhammad Aslam',
      Phone: '+92 321 9876543',
      Email: 'alshifa@medicos.pk',
      'NTN / CNIC / Bank Acc': '35202-1234567-1',
      Address: 'Circular Road, Wholesale Market',
      City: 'Lahore',
      'Credit Limit': 150000.0,
      Status: 'Active',
      Notes: 'Inter-store purchase and wholesale customer account',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  worksheet['!cols'] = ACCOUNT_EXCEL_COLUMNS.map((c) => ({ wch: c.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Accounts Template');

  XLSX.writeFile(workbook, 'AMS_Accounts_Master_Import_Template.xlsx');
}

export interface ParsedAccountExcelRow {
  account_code: string;
  account_name: string;
  main_group: MainAccountGroup;
  account_group: string;
  parent_account_code: string;
  opening_balance: number;
  opening_balance_type: 'Debit' | 'Credit';
  contact_person: string;
  phone: string;
  email: string;
  ntn_cnic: string;
  address: string;
  city: string;
  credit_limit: number;
  status: 'Active' | 'Inactive';
  notes: string;
  _isValid: boolean;
  _errors: string[];
}

/**
 * Helper to infer Main Group from Account Group if user only provided Account Group
 */
function resolveMainGroup(mainGroupRaw: string, accountGroupRaw: string): MainAccountGroup {
  const upperMain = mainGroupRaw.toUpperCase().trim();
  if (MAIN_ACCOUNT_GROUPS.includes(upperMain as MainAccountGroup)) {
    return upperMain as MainAccountGroup;
  }

  const g = accountGroupRaw.toLowerCase().trim();
  if (['customer', 'supplier', 'customer & supplier', 'party'].includes(g)) {
    return 'PARTY ACCOUNTS';
  }
  if (
    ['cash in hand', 'cash', 'bank', 'capital', 'drawings', 'loans', 'assets', 'liabilities'].includes(g)
  ) {
    return 'FINANCIAL ACCOUNTS';
  }
  return 'INCOME & EXPENSE ACCOUNTS';
}

/**
 * Parse uploaded Excel (.xlsx / .csv) file for Accounts Master
 */
export async function parseAccountsExcelFile(file: File): Promise<{
  rows: ParsedAccountExcelRow[];
  validCount: number;
  invalidCount: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('Spreadsheet does not contain any sheets.');
        }

        const sheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

        if (rawJson.length === 0) {
          throw new Error('Spreadsheet contains no data rows.');
        }

        const seenCodes = new Set<string>();

        const rows: ParsedAccountExcelRow[] = rawJson.map((row) => {
          const errors: string[] = [];

          const findVal = (keys: string[]): string => {
            for (const key of keys) {
              for (const rk of Object.keys(row)) {
                if (rk.trim().toLowerCase() === key.toLowerCase()) {
                  return String(row[rk]).trim();
                }
              }
            }
            return '';
          };

          const account_code = findVal(['Account Code', 'account_code', 'Code', 'Acc Code']);
          const account_name = findVal(['Account Name', 'account_name', 'Name', 'Title']);
          const account_group = findVal(['Account Group', 'account_group', 'Group', 'Category']) || 'Customer';
          const main_group_raw = findVal(['Main Group', 'main_group', 'Primary Group']);
          const main_group = resolveMainGroup(main_group_raw, account_group);
          const parent_account_code = findVal(['Parent Account Code', 'parent_account_code', 'Parent Code']);

          const parseNum = (keys: string[], def: number = 0): number => {
            const valStr = findVal(keys);
            if (!valStr) return def;
            const num = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
            return isNaN(num) ? def : Math.max(0, Math.round(num * 100) / 100);
          };

          const opening_balance = parseNum(['Opening Balance', 'opening_balance', 'Opening']);
          const openTypeRaw = findVal(['Opening Balance Type', 'opening_balance_type', 'Dr/Cr', 'Type']);
          const opening_balance_type: 'Debit' | 'Credit' =
            openTypeRaw.toLowerCase() === 'credit' || openTypeRaw.toLowerCase() === 'cr'
              ? 'Credit'
              : 'Debit';

          const contact_person = findVal(['Contact Person', 'contact_person', 'Contact']);
          const phone = findVal(['Phone', 'phone', 'Mobile', 'Contact Number']);
          const email = findVal(['Email', 'email']);
          const ntn_cnic = findVal(['NTN / CNIC / Bank Acc', 'ntn_cnic', 'NTN', 'CNIC', 'Tax Number']);
          const address = findVal(['Address', 'address']);
          const city = findVal(['City', 'city']);
          const credit_limit = parseNum(['Credit Limit', 'credit_limit']);
          const statusRaw = findVal(['Status', 'status']) || 'Active';
          const status: 'Active' | 'Inactive' =
            statusRaw.toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
          const notes = findVal(['Notes', 'notes', 'Remarks']);

          if (!account_code) {
            errors.push('Account Code is required');
          } else {
            const upper = account_code.toUpperCase();
            if (seenCodes.has(upper)) {
              errors.push(`Duplicate Account Code "${account_code}" in file`);
            } else {
              seenCodes.add(upper);
            }
          }

          if (!account_name) {
            errors.push('Account Name is required');
          }
          if (!account_group) {
            errors.push('Account Group is required');
          }

          return {
            account_code,
            account_name,
            main_group,
            account_group,
            parent_account_code,
            opening_balance,
            opening_balance_type,
            contact_person,
            phone,
            email,
            ntn_cnic,
            address,
            city,
            credit_limit,
            status,
            notes,
            _isValid: errors.length === 0,
            _errors: errors,
          };
        });

        const validCount = rows.filter((r) => r._isValid).length;
        resolve({
          rows,
          validCount,
          invalidCount: rows.length - validCount,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to parse Accounts Excel file: ${msg}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file from disk.'));
    reader.readAsBinaryString(file);
  });
}
