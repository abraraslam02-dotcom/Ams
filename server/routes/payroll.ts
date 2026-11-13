import { Router } from 'express';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';

export const payrollRouter = Router();

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function getActor(req: Request): { username: string; role: string } {
  const authReq = req as AuthenticatedRequest;
  return {
    username: authReq.user?.full_name || authReq.user?.username || 'Super Admin',
    role: authReq.user?.role || 'Super Admin',
  };
}

function hasPayrollActionPermission(
  req: Request,
  modKey: string,
  action: 'view' | 'create' | 'edit' | 'delete' = 'create'
): boolean {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) return false;
  if (
    authReq.user.role === 'Super Admin' ||
    authReq.user.role === 'Administrator' ||
    authReq.user.role === 'Accountant'
  ) {
    return true;
  }
  const perms = authReq.permissions;
  if (!perms) return false;
  const flag = `can_${action}` as const;
  return Boolean(perms[modKey]?.[flag] || perms['payroll']?.[flag]);
}

function ensurePayrollSystemAccounts(db: Database.Database): {
  salaryExpenseAcc: { id: number; account_code: string; account_name: string };
  salaryPayableAcc: { id: number; account_code: string; account_name: string };
  advanceAssetAcc: { id: number; account_code: string; account_name: string };
  loanAssetAcc: { id: number; account_code: string; account_name: string };
} {
  const ensureAcc = (
    code: string,
    name: string,
    mainGroup: string,
    accountGroup: string,
    accountType: string,
    financialCategory: string,
    balType: 'Debit' | 'Credit',
    notes: string
  ) => {
    let row = db
      .prepare('SELECT id, account_code, account_name FROM accounts WHERE account_code = ?')
      .get(code) as { id: number; account_code: string; account_name: string } | undefined;
    if (!row) {
      db.prepare(`
        INSERT INTO accounts (
          account_code, account_name, main_group, account_group, account_type, financial_category,
          opening_balance, opening_balance_type, current_balance, current_balance_type,
          filer_status, status, is_system_account, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, 0.0, ?, 'Filer', 'Active', 1, ?)
      `).run(code, name, mainGroup, accountGroup, accountType, financialCategory, balType, balType, notes);
      row = db
        .prepare('SELECT id, account_code, account_name FROM accounts WHERE account_code = ?')
        .get(code) as { id: number; account_code: string; account_name: string };
    }
    return row;
  };

  return {
    salaryExpenseAcc: ensureAcc(
      'EXP-5030',
      'Staff Salaries & Wages',
      'INCOME & EXPENSE ACCOUNTS',
      'Salaries',
      'Expense',
      'Expenses',
      'Debit',
      'Pharmacist and store staff monthly salary expense account'
    ),
    salaryPayableAcc: ensureAcc(
      'LIA-2030',
      'Staff Salary Payable',
      'FINANCIAL ACCOUNTS',
      'Liabilities',
      'Liability',
      'Liabilities',
      'Credit',
      'Accrued staff salaries payable liability account'
    ),
    advanceAssetAcc: ensureAcc(
      'AST-1060',
      'Employee Salary Advances',
      'FINANCIAL ACCOUNTS',
      'Assets',
      'Asset',
      'Assets',
      'Debit',
      'Short-term salary advances disbursed to employees receivable'
    ),
    loanAssetAcc: ensureAcc(
      'AST-1070',
      'Employee Loans Receivable',
      'FINANCIAL ACCOUNTS',
      'Assets',
      'Asset',
      'Assets',
      'Debit',
      'Employee loans receivable recovered through monthly payroll installments'
    ),
  };
}

function recalculateAccountBalance(db: Database.Database, accountId: number): void {
  const acc = db
    .prepare('SELECT id, opening_balance, opening_balance_type FROM accounts WHERE id = ?')
    .get(accountId) as { id: number; opening_balance: number; opening_balance_type: string } | undefined;
  if (!acc) return;

  const sums = db
    .prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount), 0) as sum_debit,
        COALESCE(SUM(jl.credit_amount), 0) as sum_credit
      FROM journal_entry_lines jl
      INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = ? AND je.status = 'posted'
    `)
    .get(accountId) as { sum_debit: number; sum_credit: number };

  const openDebit = acc.opening_balance_type === 'Debit' ? Number(acc.opening_balance) || 0 : 0;
  const openCredit = acc.opening_balance_type === 'Credit' ? Number(acc.opening_balance) || 0 : 0;

  const totalDebit = round2(openDebit + (Number(sums.sum_debit) || 0));
  const totalCredit = round2(openCredit + (Number(sums.sum_credit) || 0));

  const net = round2(totalDebit - totalCredit);
  const currentBalance = Math.abs(net);
  const currentBalanceType = net >= 0 ? 'Debit' : 'Credit';

  db.prepare(`
    UPDATE accounts SET
      total_debit = ?,
      total_credit = ?,
      current_balance = ?,
      current_balance_type = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(totalDebit, totalCredit, currentBalance, currentBalanceType, accountId);
}

function getNextJournalEntryNumber(db: Database.Database): string {
  const rows = db.prepare('SELECT entry_number FROM journal_entries').all() as Array<{ entry_number: string }>;
  let maxNum = 1000;
  for (const r of rows) {
    const m = String(r.entry_number || '').match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `JE-${maxNum + 1}`;
}

function createCashBookPaymentEntry(
  db: Database.Database,
  params: {
    voucherDate: string;
    headAccountId: number;
    headAccountCode: string;
    headAccountName: string;
    cashBankAccountId: number;
    cashBankAccountCode: string;
    cashBankAccountName: string;
    paymentAmount: number;
    narration: string;
    referenceNumber: string;
    journalEntryId: number;
    createdBy: string;
  }
): number | null {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_book_sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_key TEXT NOT NULL UNIQUE,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const maxVoucherRow = db
      .prepare('SELECT COALESCE(MAX(sequence_number), 0) as max_seq FROM cash_book_vouchers')
      .get() as { max_seq: number } | undefined;
    const seqRow = db
      .prepare("SELECT last_sequence FROM cash_book_sequences WHERE sequence_key = 'CASH_BOOK_MAIN'")
      .get() as { last_sequence: number } | undefined;
    const currentHigh = Math.max(Number(maxVoucherRow?.max_seq || 0), Number(seqRow?.last_sequence || 0));
    const nextSeq = currentHigh + 1;

    if (!seqRow) {
      db.prepare(
        "INSERT INTO cash_book_sequences (sequence_key, last_sequence, updated_at) VALUES ('CASH_BOOK_MAIN', ?, CURRENT_TIMESTAMP)"
      ).run(nextSeq);
    } else {
      db.prepare(
        "UPDATE cash_book_sequences SET last_sequence = ?, updated_at = CURRENT_TIMESTAMP WHERE sequence_key = 'CASH_BOOK_MAIN'"
      ).run(nextSeq);
    }

    const voucherNumber = `CB-${String(nextSeq).padStart(5, '0')}`;
    const res = db
      .prepare(`
        INSERT INTO cash_book_vouchers (
          voucher_number, sequence_number, voucher_date, transaction_type, category,
          head_account_id, head_account_code, head_account_name,
          cash_bank_account_id, cash_bank_account_code, cash_bank_account_name,
          receipt_amount, payment_amount, net_amount, narration, reference_number,
          journal_entry_id, status, created_by
        ) VALUES (?, ?, ?, 'Payment', 'other_payment', ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?, ?, 'posted', ?)
      `)
      .run(
        voucherNumber,
        nextSeq,
        params.voucherDate,
        params.headAccountId,
        params.headAccountCode,
        params.headAccountName,
        params.cashBankAccountId,
        params.cashBankAccountCode,
        params.cashBankAccountName,
        round2(params.paymentAmount),
        round2(params.paymentAmount),
        params.narration,
        params.referenceNumber,
        params.journalEntryId,
        params.createdBy
      );
    return Number(res.lastInsertRowid);
  } catch {
    return null;
  }
}

function appendEmployeeLedgerEntry(
  db: Database.Database,
  params: {
    employeeId: number;
    transactionDate: string;
    transactionType: string;
    referenceCode: string;
    referenceId?: number | null;
    description: string;
    debitAmount: number;
    creditAmount: number;
    journalEntryId?: number | null;
    createdBy: string;
  }
): void {
  const prev = db
    .prepare(
      'SELECT COALESCE(SUM(credit_amount - debit_amount), 0) as bal FROM employee_financial_ledger WHERE employee_id = ?'
    )
    .get(params.employeeId) as { bal: number } | undefined;
  const runningBalance = round2((Number(prev?.bal) || 0) + (Number(params.creditAmount) || 0) - (Number(params.debitAmount) || 0));

  db.prepare(`
    INSERT INTO employee_financial_ledger (
      employee_id, transaction_date, transaction_type, reference_code, reference_id,
      description, debit_amount, credit_amount, running_balance, journal_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.employeeId,
    params.transactionDate,
    params.transactionType,
    params.referenceCode,
    params.referenceId ?? null,
    params.description,
    round2(params.debitAmount),
    round2(params.creditAmount),
    runningBalance,
    params.journalEntryId ?? null,
    params.createdBy
  );
}

function logPayrollAudit(
  db: Database.Database,
  params: {
    action: string;
    moduleSection: string;
    recordReference?: string;
    employeeId?: number | null;
    performedBy: string;
    performedByRole: string;
    details?: Record<string, unknown>;
  }
): void {
  db.prepare(`
    INSERT INTO payroll_audit_logs (
      action, module_section, record_reference, employee_id, performed_by, performed_by_role, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.action,
    params.moduleSection,
    params.recordReference || '',
    params.employeeId ?? null,
    params.performedBy,
    params.performedByRole,
    JSON.stringify(params.details || {})
  );
}

function getNextEmployeeCodePreview(db: Database.Database): { nextNumber: number; nextCode: string } {
  db.prepare(`
    INSERT OR IGNORE INTO employee_sequences (prefix, last_number, updated_at)
    VALUES ('EMP', 0, CURRENT_TIMESTAMP)
  `).run();

  const seqRow = db
    .prepare("SELECT last_number FROM employee_sequences WHERE prefix = 'EMP'")
    .get() as { last_number: number } | undefined;

  const existingCodes = db
    .prepare('SELECT employee_code FROM employees')
    .all() as Array<{ employee_code: string }>;

  let maxExisting = Number(seqRow?.last_number || 0);
  for (const r of existingCodes) {
    const m = String(r.employee_code || '').match(/^EMP-(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxExisting) maxExisting = n;
    }
  }

  const nextNumber = maxExisting + 1;
  const nextCode = `EMP-${String(nextNumber).padStart(3, '0')}`;
  return { nextNumber, nextCode };
}

function allocateNextEmployeeCode(db: Database.Database): string {
  const { nextNumber, nextCode } = getNextEmployeeCodePreview(db);
  db.prepare(`
    UPDATE employee_sequences
    SET last_number = ?, updated_at = CURRENT_TIMESTAMP
    WHERE prefix = 'EMP'
  `).run(nextNumber);
  return nextCode;
}

interface PayrollCalculationResult {
  employee_id: number;
  employee_code: string;
  full_name: string;
  father_name: string;
  department: string;
  designation: string;
  employment_status: string;
  payroll_month: number;
  payroll_year: number;
  period_label: string;
  working_days: number;
  present_days: number;
  half_days: number;
  absent_days: number;
  paid_leaves: number;
  unpaid_leaves: number;
  holidays: number;
  late_count: number;
  overtime_hours: number;
  basic_salary: number;
  house_allowance: number;
  medical_allowance: number;
  conveyance_allowance: number;
  other_allowances: number;
  overtime_amount: number;
  bonus_amount: number;
  gross_salary: number;
  absent_deduction: number;
  late_deduction: number;
  unpaid_leave_deduction: number;
  advance_recovery: number;
  loan_recovery: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  existing_payroll_id: number | null;
  existing_status: string | null;
  existing_payment_status: string | null;
  existing_paid_amount: number;
}

function calculateEmployeeMonthlyPayroll(
  db: Database.Database,
  employeeId: number,
  month: number,
  year: number,
  overrides?: Partial<{
    working_days: number;
    present_days: number;
    half_days: number;
    absent_days: number;
    paid_leaves: number;
    unpaid_leaves: number;
    holidays: number;
    late_count: number;
    overtime_hours: number;
    basic_salary: number;
    house_allowance: number;
    medical_allowance: number;
    conveyance_allowance: number;
    other_allowances: number;
    overtime_amount: number;
    bonus_amount: number;
    absent_deduction: number;
    late_deduction: number;
    unpaid_leave_deduction: number;
    advance_recovery: number;
    loan_recovery: number;
    other_deductions: number;
  }>
): PayrollCalculationResult | null {
  const emp = db
    .prepare('SELECT * FROM employees WHERE id = ?')
    .get(employeeId) as Record<string, any> | undefined;
  if (!emp) return null;

  let struct = db
    .prepare('SELECT * FROM employee_salary_structures WHERE employee_id = ?')
    .get(employeeId) as Record<string, any> | undefined;

  if (!struct) {
    db.prepare(`
      INSERT INTO employee_salary_structures (employee_id, basic_salary)
      VALUES (?, ?)
    `).run(employeeId, Number(emp.basic_salary) || 0);
    struct = db
      .prepare('SELECT * FROM employee_salary_structures WHERE employee_id = ?')
      .get(employeeId) as Record<string, any>;
  }

  const daysInMonth = getDaysInMonth(month, year);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const startDate = `${monthPrefix}-01`;
  const endDate = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;

  const attRows = db
    .prepare(
      'SELECT * FROM employee_attendance WHERE employee_id = ? AND attendance_date >= ? AND attendance_date <= ?'
    )
    .all(employeeId, startDate, endDate) as Array<Record<string, any>>;

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let paidLeaves = 0;
  let unpaidLeaves = 0;
  let holidays = 0;
  let lateCount = 0;
  let overtimeHours = 0;

  for (const a of attRows) {
    const st = String(a.status || '');
    if (st === 'Present') presentDays += 1;
    else if (st === 'Half Day') halfDays += 1;
    else if (st === 'Absent') absentDays += 1;
    else if (st === 'Holiday') holidays += 1;
    else if (st === 'Leave') {
      if (String(a.leave_type || '') === 'Unpaid Leave') unpaidLeaves += 1;
      else paidLeaves += 1;
    }
    if (Number(a.is_late) === 1 || Number(a.late_minutes) > 0) lateCount += 1;
    overtimeHours = round2(overtimeHours + (Number(a.overtime_hours) || 0));
  }

  // If no attendance records exist yet for this month, check approved leaves in this month and default remaining working days to present
  if (attRows.length === 0) {
    const approvedLeaves = db
      .prepare(`
        SELECT leave_type, total_days, is_paid
        FROM employee_leaves
        WHERE employee_id = ? AND status = 'Approved'
          AND start_date <= ? AND end_date >= ?
      `)
      .all(employeeId, endDate, startDate) as Array<Record<string, any>>;
    for (const lv of approvedLeaves) {
      const d = Number(lv.total_days) || 0;
      if (lv.leave_type === 'Unpaid Leave' || Number(lv.is_paid) === 0) {
        unpaidLeaves += d;
      } else {
        paidLeaves += d;
      }
    }
    presentDays = Math.max(0, daysInMonth - paidLeaves - unpaidLeaves);
  }

  const workingDays = overrides?.working_days !== undefined ? Number(overrides.working_days) : daysInMonth;
  if (overrides?.present_days !== undefined) presentDays = Number(overrides.present_days);
  if (overrides?.half_days !== undefined) halfDays = Number(overrides.half_days);
  if (overrides?.absent_days !== undefined) absentDays = Number(overrides.absent_days);
  if (overrides?.paid_leaves !== undefined) paidLeaves = Number(overrides.paid_leaves);
  if (overrides?.unpaid_leaves !== undefined) unpaidLeaves = Number(overrides.unpaid_leaves);
  if (overrides?.holidays !== undefined) holidays = Number(overrides.holidays);
  if (overrides?.late_count !== undefined) lateCount = Number(overrides.late_count);
  if (overrides?.overtime_hours !== undefined) overtimeHours = Number(overrides.overtime_hours);

  const basicSalary = round2(
    overrides?.basic_salary !== undefined
      ? Number(overrides.basic_salary)
      : Number(struct.basic_salary || emp.basic_salary || 0)
  );

  const calcAllowance = (val: number, type: string): number => {
    if (type === 'Percent') return round2((basicSalary * (Number(val) || 0)) / 100);
    return round2(Number(val) || 0);
  };

  const houseAllowance =
    overrides?.house_allowance !== undefined
      ? round2(Number(overrides.house_allowance))
      : calcAllowance(Number(struct.house_allowance || 0), String(struct.house_allowance_type || 'Fixed'));

  const medicalAllowance =
    overrides?.medical_allowance !== undefined
      ? round2(Number(overrides.medical_allowance))
      : calcAllowance(Number(struct.medical_allowance || 0), String(struct.medical_allowance_type || 'Fixed'));

  const conveyanceAllowance =
    overrides?.conveyance_allowance !== undefined
      ? round2(Number(overrides.conveyance_allowance))
      : calcAllowance(Number(struct.conveyance_allowance || 0), String(struct.conveyance_allowance_type || 'Fixed'));

  const otherAllowances =
    overrides?.other_allowances !== undefined
      ? round2(Number(overrides.other_allowances))
      : round2(Number(struct.other_allowance || 0));

  const perDayBasic = basicSalary / 30;
  const autoHourlyOvertimeRate = (perDayBasic / 8) * 1.5;
  const effectiveOvertimeRate =
    String(struct.overtime_calculation_method) === 'Fixed_Rate' && Number(struct.overtime_hourly_rate) > 0
      ? Number(struct.overtime_hourly_rate)
      : Number(struct.overtime_hourly_rate) > 0
      ? Number(struct.overtime_hourly_rate)
      : autoHourlyOvertimeRate;

  const overtimeAmount =
    overrides?.overtime_amount !== undefined
      ? round2(Number(overrides.overtime_amount))
      : round2(overtimeHours * effectiveOvertimeRate);

  const bonusAmount =
    overrides?.bonus_amount !== undefined
      ? round2(Number(overrides.bonus_amount))
      : round2(Number(struct.default_bonus || 0));

  const grossSalary = round2(
    basicSalary +
      houseAllowance +
      medicalAllowance +
      conveyanceAllowance +
      otherAllowances +
      overtimeAmount +
      bonusAmount
  );

  // Deductions
  const effectiveAbsentUnits = absentDays + halfDays * 0.5;
  let computedAbsentDeduction = 0;
  const absentMethod = String(struct.absent_deduction_method || 'Per_Day_Basic');
  if (absentMethod === 'Per_Day_Basic') {
    computedAbsentDeduction = round2(effectiveAbsentUnits * (basicSalary / 30));
  } else if (absentMethod === 'Per_Day_Gross') {
    computedAbsentDeduction = round2(effectiveAbsentUnits * (grossSalary / 30));
  } else if (absentMethod === 'Fixed_Rate') {
    computedAbsentDeduction = round2(effectiveAbsentUnits * (Number(struct.absent_deduction_rate) || 0));
  }

  const absentDeduction =
    overrides?.absent_deduction !== undefined ? round2(Number(overrides.absent_deduction)) : computedAbsentDeduction;

  let computedLateDeduction = 0;
  const lateMethod = String(struct.late_deduction_method || 'Per_3_Lates_1_Day');
  if (lateMethod === 'Per_3_Lates_1_Day') {
    computedLateDeduction = round2(Math.floor(lateCount / 3) * (basicSalary / 30));
  } else if (lateMethod === 'Fixed_Per_Late') {
    computedLateDeduction = round2(lateCount * (Number(struct.late_deduction_rate) || 0));
  }

  const lateDeduction =
    overrides?.late_deduction !== undefined ? round2(Number(overrides.late_deduction)) : computedLateDeduction;

  const unpaidLeaveDeduction =
    overrides?.unpaid_leave_deduction !== undefined
      ? round2(Number(overrides.unpaid_leave_deduction))
      : round2(unpaidLeaves * (basicSalary / 30));

  // Active Advances & Loans recovery
  const activeAdvances = db
    .prepare(`
      SELECT id, remaining_balance, monthly_installment
      FROM employee_advances_loans
      WHERE employee_id = ? AND transaction_type = 'Advance' AND status = 'Active' AND auto_recover_in_payroll = 1 AND remaining_balance > 0
    `)
    .all(employeeId) as Array<{ id: number; remaining_balance: number; monthly_installment: number }>;

  let autoAdvanceRecovery = 0;
  for (const adv of activeAdvances) {
    const inst = Number(adv.monthly_installment) > 0 ? Number(adv.monthly_installment) : Number(adv.remaining_balance);
    autoAdvanceRecovery = round2(autoAdvanceRecovery + Math.min(Number(adv.remaining_balance), inst));
  }

  const activeLoans = db
    .prepare(`
      SELECT id, remaining_balance, monthly_installment
      FROM employee_advances_loans
      WHERE employee_id = ? AND transaction_type = 'Loan' AND status = 'Active' AND auto_recover_in_payroll = 1 AND remaining_balance > 0
    `)
    .all(employeeId) as Array<{ id: number; remaining_balance: number; monthly_installment: number }>;

  let autoLoanRecovery = 0;
  for (const ln of activeLoans) {
    const inst = Number(ln.monthly_installment) > 0 ? Number(ln.monthly_installment) : Number(ln.remaining_balance);
    autoLoanRecovery = round2(autoLoanRecovery + Math.min(Number(ln.remaining_balance), inst));
  }

  const advanceRecovery =
    overrides?.advance_recovery !== undefined ? round2(Number(overrides.advance_recovery)) : autoAdvanceRecovery;
  const loanRecovery =
    overrides?.loan_recovery !== undefined ? round2(Number(overrides.loan_recovery)) : autoLoanRecovery;

  const otherDeductions =
    overrides?.other_deductions !== undefined
      ? round2(Number(overrides.other_deductions))
      : round2(Number(struct.other_deduction || 0));

  const totalDeductions = round2(
    absentDeduction +
      lateDeduction +
      unpaidLeaveDeduction +
      advanceRecovery +
      loanRecovery +
      otherDeductions
  );

  const netSalary = Math.max(0, round2(grossSalary - totalDeductions));

  const existingPayroll = db
    .prepare(
      'SELECT id, status, payment_status, paid_amount FROM payroll_records WHERE employee_id = ? AND payroll_month = ? AND payroll_year = ?'
    )
    .get(employeeId, month, year) as
    | { id: number; status: string; payment_status: string; paid_amount: number }
    | undefined;

  return {
    employee_id: employeeId,
    employee_code: String(emp.employee_code),
    full_name: String(emp.full_name),
    father_name: String(emp.father_name || ''),
    department: String(emp.department || ''),
    designation: String(emp.designation || ''),
    employment_status: String(emp.employment_status || 'Active'),
    payroll_month: month,
    payroll_year: year,
    period_label: `${MONTH_NAMES[month - 1] || 'Month'} ${year}`,
    working_days: workingDays,
    present_days: presentDays,
    half_days: halfDays,
    absent_days: absentDays,
    paid_leaves: paidLeaves,
    unpaid_leaves: unpaidLeaves,
    holidays,
    late_count: lateCount,
    overtime_hours: overtimeHours,
    basic_salary: basicSalary,
    house_allowance: houseAllowance,
    medical_allowance: medicalAllowance,
    conveyance_allowance: conveyanceAllowance,
    other_allowances: otherAllowances,
    overtime_amount: overtimeAmount,
    bonus_amount: bonusAmount,
    gross_salary: grossSalary,
    absent_deduction: absentDeduction,
    late_deduction: lateDeduction,
    unpaid_leave_deduction: unpaidLeaveDeduction,
    advance_recovery: advanceRecovery,
    loan_recovery: loanRecovery,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_salary: netSalary,
    existing_payroll_id: existingPayroll?.id ?? null,
    existing_status: existingPayroll?.status ?? null,
    existing_payment_status: existingPayroll?.payment_status ?? null,
    existing_paid_amount: round2(Number(existingPayroll?.paid_amount || 0)),
  };
}

// ============================================================================
// 1. PAYROLL & HR DASHBOARD KPIs
// ============================================================================
payrollRouter.get('/dashboard', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    ensurePayrollSystemAccounts(db);

    const today = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    const empStats = db
      .prepare(`
        SELECT
          COUNT(*) as total_employees,
          SUM(CASE WHEN employment_status = 'Active' THEN 1 ELSE 0 END) as active_employees,
          SUM(CASE WHEN employment_status = 'Inactive' THEN 1 ELSE 0 END) as inactive_employees,
          COALESCE(SUM(CASE WHEN employment_status = 'Active' THEN basic_salary ELSE 0 END), 0) as total_active_basic
        FROM employees
      `)
      .get() as Record<string, number>;

    const todayAttendance = db
      .prepare(`
        SELECT
          SUM(CASE WHEN status IN ('Present', 'Half Day') THEN 1 ELSE 0 END) as present_today,
          SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) as absent_today,
          SUM(CASE WHEN status = 'Leave' THEN 1 ELSE 0 END) as on_leave_today,
          SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late_today
        FROM employee_attendance
        WHERE attendance_date = ?
      `)
      .get(today) as Record<string, number>;

    const monthPayrollStats = db
      .prepare(`
        SELECT
          COUNT(*) as processed_count,
          SUM(CASE WHEN status = 'Finalized' THEN 1 ELSE 0 END) as finalized_count,
          COALESCE(SUM(gross_salary), 0) as current_month_gross,
          COALESCE(SUM(total_deductions), 0) as current_month_deductions,
          COALESCE(SUM(net_salary), 0) as current_month_payroll,
          COALESCE(SUM(paid_amount), 0) as current_month_paid,
          COALESCE(SUM(remaining_amount), 0) as current_month_payable
        FROM payroll_records
        WHERE payroll_month = ? AND payroll_year = ?
      `)
      .get(month, year) as Record<string, number>;

    const allTimePayable = db
      .prepare(`
        SELECT
          COALESCE(SUM(paid_amount), 0) as total_salary_paid,
          COALESCE(SUM(CASE WHEN status = 'Finalized' THEN remaining_amount ELSE 0 END), 0) as remaining_salary_payable
        FROM payroll_records
      `)
      .get() as Record<string, number>;

    const advancesLoansStats = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'Advance' AND status = 'Active' THEN remaining_balance ELSE 0 END), 0) as outstanding_advances,
          COALESCE(SUM(CASE WHEN transaction_type = 'Loan' AND status = 'Active' THEN remaining_balance ELSE 0 END), 0) as outstanding_loans
        FROM employee_advances_loans
      `)
      .get() as Record<string, number>;

    const departments = db
      .prepare(`
        SELECT
          department,
          COUNT(*) as employee_count,
          SUM(CASE WHEN employment_status = 'Active' THEN 1 ELSE 0 END) as active_count,
          COALESCE(SUM(CASE WHEN employment_status = 'Active' THEN basic_salary ELSE 0 END), 0) as basic_salary_sum
        FROM employees
        GROUP BY department
        ORDER BY employee_count DESC
      `)
      .all();

    const financialAccounts = db
      .prepare(`
        SELECT id, account_code, account_name, account_group, current_balance, current_balance_type
        FROM accounts
        WHERE status = 'Active'
          AND (
            account_group IN ('Cash in Hand', 'Bank', 'Cash', 'Banks')
            OR account_code IN ('FIN-1010', 'FIN-1021', 'FIN-1020')
          )
        ORDER BY CASE WHEN account_code = 'FIN-1010' THEN 0 WHEN account_code = 'FIN-1021' THEN 1 ELSE 2 END, account_name ASC
      `)
      .all();

    const recentLogs = db
      .prepare(`
        SELECT l.*, e.employee_code, e.full_name as employee_name
        FROM payroll_audit_logs l
        LEFT JOIN employees e ON e.id = l.employee_id
        ORDER BY l.id DESC
        LIMIT 12
      `)
      .all();

    return res.json({
      success: true,
      data: {
        today,
        month,
        year,
        period_label: `${MONTH_NAMES[month - 1]} ${year}`,
        kpis: {
          total_employees: Number(empStats?.total_employees || 0),
          active_employees: Number(empStats?.active_employees || 0),
          inactive_employees: Number(empStats?.inactive_employees || 0),
          total_active_basic: round2(Number(empStats?.total_active_basic || 0)),
          present_today: Number(todayAttendance?.present_today || 0),
          absent_today: Number(todayAttendance?.absent_today || 0),
          on_leave_today: Number(todayAttendance?.on_leave_today || 0),
          late_today: Number(todayAttendance?.late_today || 0),
          processed_count: Number(monthPayrollStats?.processed_count || 0),
          finalized_count: Number(monthPayrollStats?.finalized_count || 0),
          current_month_gross: round2(Number(monthPayrollStats?.current_month_gross || 0)),
          current_month_deductions: round2(Number(monthPayrollStats?.current_month_deductions || 0)),
          current_month_payroll: round2(Number(monthPayrollStats?.current_month_payroll || 0)),
          current_month_paid: round2(Number(monthPayrollStats?.current_month_paid || 0)),
          current_month_payable: round2(Number(monthPayrollStats?.current_month_payable || 0)),
          total_salary_paid: round2(Number(allTimePayable?.total_salary_paid || 0)),
          remaining_salary_payable: round2(Number(allTimePayable?.remaining_salary_payable || 0)),
          outstanding_advances: round2(Number(advancesLoansStats?.outstanding_advances || 0)),
          outstanding_loans: round2(Number(advancesLoansStats?.outstanding_loans || 0)),
        },
        departments,
        financial_accounts: financialAccounts,
        recent_logs: recentLogs,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load Payroll Dashboard',
    });
  }
});

// ============================================================================
// 2. EMPLOYEE MANAGEMENT
// ============================================================================
payrollRouter.get('/employees/next-code', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const preview = getNextEmployeeCodePreview(db);
    return res.json({ success: true, data: preview });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate next employee code',
    });
  }
});

payrollRouter.get('/employees', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'all').trim();
    const department = String(req.query.department || 'all').trim();

    let sql = `
      SELECT
        e.*,
        COALESCE(s.house_allowance, 0) as house_allowance,
        COALESCE(s.house_allowance_type, 'Fixed') as house_allowance_type,
        COALESCE(s.medical_allowance, 0) as medical_allowance,
        COALESCE(s.medical_allowance_type, 'Fixed') as medical_allowance_type,
        COALESCE(s.conveyance_allowance, 0) as conveyance_allowance,
        COALESCE(s.conveyance_allowance_type, 'Fixed') as conveyance_allowance_type,
        COALESCE(s.other_allowance, 0) as other_allowance,
        COALESCE(s.overtime_hourly_rate, 0) as overtime_hourly_rate,
        COALESCE(s.overtime_calculation_method, 'Auto_From_Basic') as overtime_calculation_method,
        COALESCE(s.default_bonus, 0) as default_bonus,
        COALESCE(s.absent_deduction_method, 'Per_Day_Basic') as absent_deduction_method,
        COALESCE(s.absent_deduction_rate, 0) as absent_deduction_rate,
        COALESCE(s.late_deduction_method, 'Per_3_Lates_1_Day') as late_deduction_method,
        COALESCE(s.late_deduction_rate, 0) as late_deduction_rate,
        COALESCE(s.other_deduction, 0) as other_deduction,
        COALESCE((
          SELECT SUM(remaining_balance) FROM employee_advances_loans al
          WHERE al.employee_id = e.id AND al.transaction_type = 'Advance' AND al.status = 'Active'
        ), 0) as outstanding_advance,
        COALESCE((
          SELECT SUM(remaining_balance) FROM employee_advances_loans al
          WHERE al.employee_id = e.id AND al.transaction_type = 'Loan' AND al.status = 'Active'
        ), 0) as outstanding_loan,
        COALESCE((
          SELECT SUM(remaining_amount) FROM payroll_records pr
          WHERE pr.employee_id = e.id AND pr.status = 'Finalized'
        ), 0) as unpaid_salary_balance
      FROM employees e
      LEFT JOIN employee_salary_structures s ON s.employee_id = e.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status && status !== 'all') {
      sql += ` AND e.employment_status = ?`;
      params.push(status);
    }
    if (department && department !== 'all') {
      sql += ` AND e.department = ?`;
      params.push(department);
    }
    if (search) {
      sql += ` AND (
        e.employee_code LIKE ? OR
        e.full_name LIKE ? OR
        e.father_name LIKE ? OR
        e.phone LIKE ? OR
        e.cnic LIKE ? OR
        e.designation LIKE ? OR
        e.department LIKE ?
      )`;
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like, like);
    }

    sql += ` ORDER BY e.id ASC`;
    const rows = db.prepare(sql).all(...params);
    const nextCode = getNextEmployeeCodePreview(db).nextCode;

    return res.json({
      success: true,
      data: rows,
      next_employee_code: nextCode,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch employees',
    });
  }
});

payrollRouter.post('/employees', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_employees', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to add employees.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const body = req.body || {};

    const fullName = String(body.full_name || '').trim();
    if (!fullName) {
      return res.status(400).json({ success: false, error: 'Employee name is required.' });
    }

    const joiningDate = String(body.joining_date || new Date().toISOString().slice(0, 10)).trim();
    const basicSalary = round2(Number(body.basic_salary) || 0);
    const paymentMethod = ['Cash', 'Bank', 'Cheque', 'Online'].includes(body.payment_method)
      ? body.payment_method
      : 'Cash';
    const employmentStatus = body.employment_status === 'Inactive' ? 'Inactive' : 'Active';

    const created = db.transaction(() => {
      const employeeCode = allocateNextEmployeeCode(db);

      const ins = db
        .prepare(`
          INSERT INTO employees (
            employee_code, full_name, father_name, photo_url, cnic, phone,
            emergency_contact_name, emergency_contact_phone, address,
            department, designation, joining_date, leaving_date, employment_status,
            basic_salary, payment_method, bank_name, bank_account_title, bank_account_number,
            annual_casual_leave_quota, annual_sick_leave_quota, annual_earned_leave_quota,
            remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          employeeCode,
          fullName,
          String(body.father_name || '').trim(),
          String(body.photo_url || '').trim(),
          String(body.cnic || '').trim(),
          String(body.phone || '').trim(),
          String(body.emergency_contact_name || '').trim(),
          String(body.emergency_contact_phone || '').trim(),
          String(body.address || '').trim(),
          String(body.department || 'Pharmacy Operations').trim(),
          String(body.designation || 'Staff').trim(),
          joiningDate,
          String(body.leaving_date || '').trim(),
          employmentStatus,
          basicSalary,
          paymentMethod,
          String(body.bank_name || '').trim(),
          String(body.bank_account_title || '').trim(),
          String(body.bank_account_number || '').trim(),
          Number(body.annual_casual_leave_quota) || 12,
          Number(body.annual_sick_leave_quota) || 10,
          Number(body.annual_earned_leave_quota) || 14,
          String(body.remarks || '').trim(),
          actor.username
        );

      const employeeId = Number(ins.lastInsertRowid);

      db.prepare(`
        INSERT INTO employee_salary_structures (
          employee_id, basic_salary,
          house_allowance, house_allowance_type,
          medical_allowance, medical_allowance_type,
          conveyance_allowance, conveyance_allowance_type,
          other_allowance, overtime_hourly_rate, overtime_calculation_method,
          default_bonus, absent_deduction_method, absent_deduction_rate,
          late_deduction_method, late_deduction_rate, other_deduction, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        employeeId,
        basicSalary,
        round2(Number(body.house_allowance) || 0),
        body.house_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.medical_allowance) || 0),
        body.medical_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.conveyance_allowance) || 0),
        body.conveyance_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.other_allowance) || 0),
        round2(Number(body.overtime_hourly_rate) || 0),
        body.overtime_calculation_method === 'Fixed_Rate' ? 'Fixed_Rate' : 'Auto_From_Basic',
        round2(Number(body.default_bonus) || 0),
        body.absent_deduction_method || 'Per_Day_Basic',
        round2(Number(body.absent_deduction_rate) || 0),
        body.late_deduction_method || 'Per_3_Lates_1_Day',
        round2(Number(body.late_deduction_rate) || 0),
        round2(Number(body.other_deduction) || 0),
        actor.username
      );

      logPayrollAudit(db, {
        action: 'EMPLOYEE_CREATED',
        moduleSection: 'Employees',
        recordReference: employeeCode,
        employeeId,
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { employee_code: employeeCode, full_name: fullName, basic_salary: basicSalary },
      });

      return db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    })();

    return res.status(201).json({
      success: true,
      message: 'Employee registered successfully.',
      data: created,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create employee',
    });
  }
});

payrollRouter.put('/employees/:id', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_employees', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to edit employees.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const employeeId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const body = req.body || {};
    const fullName = String(body.full_name ?? existing.full_name).trim();
    if (!fullName) {
      return res.status(400).json({ success: false, error: 'Employee name is required.' });
    }

    const basicSalary =
      body.basic_salary !== undefined ? round2(Number(body.basic_salary) || 0) : Number(existing.basic_salary);
    const paymentMethod = ['Cash', 'Bank', 'Cheque', 'Online'].includes(body.payment_method)
      ? body.payment_method
      : existing.payment_method;
    const employmentStatus =
      body.employment_status === 'Inactive'
        ? 'Inactive'
        : body.employment_status === 'Active'
        ? 'Active'
        : existing.employment_status;

    const updated = db.transaction(() => {
      db.prepare(`
        UPDATE employees SET
          full_name = ?,
          father_name = ?,
          photo_url = ?,
          cnic = ?,
          phone = ?,
          emergency_contact_name = ?,
          emergency_contact_phone = ?,
          address = ?,
          department = ?,
          designation = ?,
          joining_date = ?,
          leaving_date = ?,
          employment_status = ?,
          basic_salary = ?,
          payment_method = ?,
          bank_name = ?,
          bank_account_title = ?,
          bank_account_number = ?,
          annual_casual_leave_quota = ?,
          annual_sick_leave_quota = ?,
          annual_earned_leave_quota = ?,
          remarks = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        fullName,
        String(body.father_name ?? existing.father_name ?? '').trim(),
        String(body.photo_url ?? existing.photo_url ?? '').trim(),
        String(body.cnic ?? existing.cnic ?? '').trim(),
        String(body.phone ?? existing.phone ?? '').trim(),
        String(body.emergency_contact_name ?? existing.emergency_contact_name ?? '').trim(),
        String(body.emergency_contact_phone ?? existing.emergency_contact_phone ?? '').trim(),
        String(body.address ?? existing.address ?? '').trim(),
        String(body.department ?? existing.department ?? 'Pharmacy Operations').trim(),
        String(body.designation ?? existing.designation ?? 'Staff').trim(),
        String(body.joining_date ?? existing.joining_date).trim(),
        String(body.leaving_date ?? existing.leaving_date ?? '').trim(),
        employmentStatus,
        basicSalary,
        paymentMethod,
        String(body.bank_name ?? existing.bank_name ?? '').trim(),
        String(body.bank_account_title ?? existing.bank_account_title ?? '').trim(),
        String(body.bank_account_number ?? existing.bank_account_number ?? '').trim(),
        Number(body.annual_casual_leave_quota ?? existing.annual_casual_leave_quota ?? 12),
        Number(body.annual_sick_leave_quota ?? existing.annual_sick_leave_quota ?? 10),
        Number(body.annual_earned_leave_quota ?? existing.annual_earned_leave_quota ?? 14),
        String(body.remarks ?? existing.remarks ?? '').trim(),
        employeeId
      );

      db.prepare(`
        UPDATE employee_salary_structures
        SET basic_salary = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ?
      `).run(basicSalary, actor.username, employeeId);

      logPayrollAudit(db, {
        action: 'EMPLOYEE_UPDATED',
        moduleSection: 'Employees',
        recordReference: existing.employee_code,
        employeeId,
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { full_name: fullName, basic_salary: basicSalary, employment_status: employmentStatus },
      });

      return db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    })();

    return res.json({
      success: true,
      message: 'Employee updated successfully.',
      data: updated,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update employee',
    });
  }
});

payrollRouter.patch('/employees/:id/status', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_employees', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to change employee status.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const employeeId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const status = req.body?.employment_status === 'Inactive' ? 'Inactive' : 'Active';
    const leavingDate =
      status === 'Inactive'
        ? String(req.body?.leaving_date || existing.leaving_date || new Date().toISOString().slice(0, 10))
        : '';

    db.prepare(`
      UPDATE employees
      SET employment_status = ?, leaving_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, leavingDate, employeeId);

    logPayrollAudit(db, {
      action: status === 'Active' ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
      moduleSection: 'Employees',
      recordReference: existing.employee_code,
      employeeId,
      performedBy: actor.username,
      performedByRole: actor.role,
      details: { employment_status: status, leaving_date: leavingDate },
    });

    return res.json({
      success: true,
      message: `Employee marked as ${status}.`,
      data: db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update employee status',
    });
  }
});

payrollRouter.get('/employees/:id/ledger', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const employeeId = Number(req.params.id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const ledger = db
      .prepare('SELECT * FROM employee_financial_ledger WHERE employee_id = ? ORDER BY id ASC')
      .all(employeeId);
    const payrolls = db
      .prepare('SELECT * FROM payroll_records WHERE employee_id = ? ORDER BY payroll_year DESC, payroll_month DESC')
      .all(employeeId);
    const payments = db
      .prepare('SELECT * FROM salary_payments WHERE employee_id = ? ORDER BY payment_date DESC, id DESC')
      .all(employeeId);
    const advancesLoans = db
      .prepare('SELECT * FROM employee_advances_loans WHERE employee_id = ? ORDER BY disbursement_date DESC, id DESC')
      .all(employeeId);

    return res.json({
      success: true,
      data: {
        employee,
        ledger,
        payrolls,
        payments,
        advances_loans: advancesLoans,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load employee ledger',
    });
  }
});

// ============================================================================
// 3. SALARY STRUCTURE CONFIGURATION
// ============================================================================
payrollRouter.get('/salary-structures', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db
      .prepare(`
        SELECT
          e.id as employee_id,
          e.employee_code,
          e.full_name,
          e.father_name,
          e.department,
          e.designation,
          e.employment_status,
          e.basic_salary as employee_basic_salary,
          COALESCE(s.basic_salary, e.basic_salary, 0) as basic_salary,
          COALESCE(s.house_allowance, 0) as house_allowance,
          COALESCE(s.house_allowance_type, 'Fixed') as house_allowance_type,
          COALESCE(s.medical_allowance, 0) as medical_allowance,
          COALESCE(s.medical_allowance_type, 'Fixed') as medical_allowance_type,
          COALESCE(s.conveyance_allowance, 0) as conveyance_allowance,
          COALESCE(s.conveyance_allowance_type, 'Fixed') as conveyance_allowance_type,
          COALESCE(s.other_allowance, 0) as other_allowance,
          COALESCE(s.overtime_hourly_rate, 0) as overtime_hourly_rate,
          COALESCE(s.overtime_calculation_method, 'Auto_From_Basic') as overtime_calculation_method,
          COALESCE(s.default_bonus, 0) as default_bonus,
          COALESCE(s.absent_deduction_method, 'Per_Day_Basic') as absent_deduction_method,
          COALESCE(s.absent_deduction_rate, 0) as absent_deduction_rate,
          COALESCE(s.late_deduction_method, 'Per_3_Lates_1_Day') as late_deduction_method,
          COALESCE(s.late_deduction_rate, 0) as late_deduction_rate,
          COALESCE(s.other_deduction, 0) as other_deduction,
          s.updated_by,
          s.updated_at
        FROM employees e
        LEFT JOIN employee_salary_structures s ON s.employee_id = e.id
        ORDER BY e.id ASC
      `)
      .all();

    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch salary structures',
    });
  }
});

payrollRouter.put('/salary-structures/:employeeId', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_employees', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to update salary structure.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const employeeId = Number(req.params.employeeId);
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Record<string, any> | undefined;
    if (!emp) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const body = req.body || {};
    const basicSalary = round2(Number(body.basic_salary ?? emp.basic_salary) || 0);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO employee_salary_structures (
          employee_id, basic_salary,
          house_allowance, house_allowance_type,
          medical_allowance, medical_allowance_type,
          conveyance_allowance, conveyance_allowance_type,
          other_allowance, overtime_hourly_rate, overtime_calculation_method,
          default_bonus, absent_deduction_method, absent_deduction_rate,
          late_deduction_method, late_deduction_rate, other_deduction,
          updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(employee_id) DO UPDATE SET
          basic_salary = excluded.basic_salary,
          house_allowance = excluded.house_allowance,
          house_allowance_type = excluded.house_allowance_type,
          medical_allowance = excluded.medical_allowance,
          medical_allowance_type = excluded.medical_allowance_type,
          conveyance_allowance = excluded.conveyance_allowance,
          conveyance_allowance_type = excluded.conveyance_allowance_type,
          other_allowance = excluded.other_allowance,
          overtime_hourly_rate = excluded.overtime_hourly_rate,
          overtime_calculation_method = excluded.overtime_calculation_method,
          default_bonus = excluded.default_bonus,
          absent_deduction_method = excluded.absent_deduction_method,
          absent_deduction_rate = excluded.absent_deduction_rate,
          late_deduction_method = excluded.late_deduction_method,
          late_deduction_rate = excluded.late_deduction_rate,
          other_deduction = excluded.other_deduction,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        employeeId,
        basicSalary,
        round2(Number(body.house_allowance) || 0),
        body.house_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.medical_allowance) || 0),
        body.medical_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.conveyance_allowance) || 0),
        body.conveyance_allowance_type === 'Percent' ? 'Percent' : 'Fixed',
        round2(Number(body.other_allowance) || 0),
        round2(Number(body.overtime_hourly_rate) || 0),
        body.overtime_calculation_method === 'Fixed_Rate' ? 'Fixed_Rate' : 'Auto_From_Basic',
        round2(Number(body.default_bonus) || 0),
        ['Per_Day_Basic', 'Per_Day_Gross', 'Fixed_Rate', 'None'].includes(body.absent_deduction_method)
          ? body.absent_deduction_method
          : 'Per_Day_Basic',
        round2(Number(body.absent_deduction_rate) || 0),
        ['Per_3_Lates_1_Day', 'Fixed_Per_Late', 'None'].includes(body.late_deduction_method)
          ? body.late_deduction_method
          : 'Per_3_Lates_1_Day',
        round2(Number(body.late_deduction_rate) || 0),
        round2(Number(body.other_deduction) || 0),
        actor.username
      );

      db.prepare('UPDATE employees SET basic_salary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        basicSalary,
        employeeId
      );

      logPayrollAudit(db, {
        action: 'SALARY_STRUCTURE_UPDATED',
        moduleSection: 'Salary Structure',
        recordReference: emp.employee_code,
        employeeId,
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { basic_salary: basicSalary },
      });
    })();

    const updated = db
      .prepare('SELECT * FROM employee_salary_structures WHERE employee_id = ?')
      .get(employeeId);

    return res.json({
      success: true,
      message: 'Salary structure saved successfully.',
      data: updated,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update salary structure',
    });
  }
});

// ============================================================================
// 4. ATTENDANCE MANAGEMENT
// ============================================================================
function computeAttendanceTimings(entry: Record<string, any>) {
  const status = ['Present', 'Absent', 'Half Day', 'Leave', 'Holiday'].includes(entry.status)
    ? entry.status
    : 'Present';
  const checkIn = String(entry.check_in_time || '').trim();
  const checkOut = String(entry.check_out_time || '').trim();

  let isLate = entry.is_late !== undefined ? (Number(entry.is_late) ? 1 : 0) : 0;
  let lateMinutes = Number(entry.late_minutes) || 0;
  let isEarly = entry.is_early_departure !== undefined ? (Number(entry.is_early_departure) ? 1 : 0) : 0;
  let earlyMinutes = Number(entry.early_departure_minutes) || 0;

  if ((status === 'Present' || status === 'Half Day') && checkIn && entry.late_minutes === undefined) {
    const parts = checkIn.split(':');
    if (parts.length >= 2) {
      const mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      const standardIn = 9 * 60 + 15; // 09:15 AM grace
      if (mins > standardIn) {
        isLate = 1;
        lateMinutes = mins - 9 * 60;
      }
    }
  }
  if (lateMinutes > 0) isLate = 1;

  if (status === 'Present' && checkOut && entry.early_departure_minutes === undefined) {
    const parts = checkOut.split(':');
    if (parts.length >= 2) {
      const mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      const standardOut = 17 * 60; // 05:00 PM
      if (mins > 0 && mins < standardOut) {
        isEarly = 1;
        earlyMinutes = standardOut - mins;
      }
    }
  }
  if (earlyMinutes > 0) isEarly = 1;

  return {
    status,
    leave_type: status === 'Leave' ? String(entry.leave_type || 'Casual Leave') : '',
    check_in_time: status === 'Absent' || status === 'Leave' || status === 'Holiday' ? '' : checkIn,
    check_out_time: status === 'Absent' || status === 'Leave' || status === 'Holiday' ? '' : checkOut,
    is_late: status === 'Present' || status === 'Half Day' ? isLate : 0,
    late_minutes: status === 'Present' || status === 'Half Day' ? lateMinutes : 0,
    is_early_departure: status === 'Present' || status === 'Half Day' ? isEarly : 0,
    early_departure_minutes: status === 'Present' || status === 'Half Day' ? earlyMinutes : 0,
    overtime_hours: status === 'Absent' || status === 'Leave' ? 0 : round2(Number(entry.overtime_hours) || 0),
    remarks: String(entry.remarks || '').trim(),
  };
}

payrollRouter.get('/attendance', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const date = String(req.query.date || '').trim();
    const startDate = String(req.query.start_date || '').trim();
    const endDate = String(req.query.end_date || '').trim();
    const month = Number(req.query.month) || 0;
    const year = Number(req.query.year) || 0;
    const employeeId = Number(req.query.employee_id) || 0;
    const department = String(req.query.department || 'all').trim();
    const status = String(req.query.status || 'all').trim();

    let sql = `
      SELECT
        a.*,
        e.employee_code,
        e.full_name,
        e.father_name,
        e.department,
        e.designation,
        e.employment_status
      FROM employee_attendance a
      INNER JOIN employees e ON e.id = a.employee_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (date) {
      sql += ` AND a.attendance_date = ?`;
      params.push(date);
    }
    if (startDate) {
      sql += ` AND a.attendance_date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND a.attendance_date <= ?`;
      params.push(endDate);
    }
    if (month >= 1 && month <= 12 && year >= 2000) {
      const mPrefix = `${year}-${String(month).padStart(2, '0')}`;
      sql += ` AND a.attendance_date LIKE ?`;
      params.push(`${mPrefix}-%`);
    }
    if (employeeId > 0) {
      sql += ` AND a.employee_id = ?`;
      params.push(employeeId);
    }
    if (department && department !== 'all') {
      sql += ` AND e.department = ?`;
      params.push(department);
    }
    if (status && status !== 'all') {
      sql += ` AND a.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY a.attendance_date DESC, e.id ASC`;
    const rows = db.prepare(sql).all(...params);

    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch attendance records',
    });
  }
});

payrollRouter.get('/attendance/monthly-calendar', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    const daysInMonth = getDaysInMonth(month, year);
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = `${monthPrefix}-01`;
    const endDate = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;

    const employees = db
      .prepare('SELECT id, employee_code, full_name, department, designation, employment_status FROM employees ORDER BY id ASC')
      .all() as Array<Record<string, any>>;

    const attRows = db
      .prepare('SELECT * FROM employee_attendance WHERE attendance_date >= ? AND attendance_date <= ?')
      .all(startDate, endDate) as Array<Record<string, any>>;

    const byEmpDate = new Map<string, Record<string, any>>();
    for (const r of attRows) {
      byEmpDate.set(`${r.employee_id}_${r.attendance_date}`, r);
    }

    const calendarRows = employees.map((emp) => {
      const days: Record<string, any> = {};
      let present = 0;
      let absent = 0;
      let halfDay = 0;
      let leave = 0;
      let holiday = 0;
      let lateCount = 0;
      let overtimeHours = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
        const cell = byEmpDate.get(`${emp.id}_${dateStr}`) || null;
        days[dateStr] = cell;
        if (cell) {
          if (cell.status === 'Present') present += 1;
          else if (cell.status === 'Absent') absent += 1;
          else if (cell.status === 'Half Day') halfDay += 1;
          else if (cell.status === 'Leave') leave += 1;
          else if (cell.status === 'Holiday') holiday += 1;
          if (Number(cell.is_late) === 1) lateCount += 1;
          overtimeHours = round2(overtimeHours + (Number(cell.overtime_hours) || 0));
        }
      }

      return {
        ...emp,
        days,
        summary: {
          present_days: present,
          absent_days: absent,
          half_days: halfDay,
          leave_days: leave,
          holidays: holiday,
          late_count: lateCount,
          overtime_hours: overtimeHours,
        },
      };
    });

    return res.json({
      success: true,
      data: {
        month,
        year,
        days_in_month: daysInMonth,
        period_label: `${MONTH_NAMES[month - 1]} ${year}`,
        employees: calendarRows,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to build monthly attendance calendar',
    });
  }
});

payrollRouter.post('/attendance', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_attendance', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to record attendance.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const body = req.body || {};

    const employeeId = Number(body.employee_id);
    const attendanceDate = String(body.attendance_date || '').trim();
    if (!employeeId || !attendanceDate) {
      return res.status(400).json({ success: false, error: 'Employee and attendance date are required.' });
    }

    const computed = computeAttendanceTimings(body);

    db.prepare(`
      INSERT INTO employee_attendance (
        employee_id, attendance_date, status, leave_type,
        check_in_time, check_out_time, is_late, late_minutes,
        is_early_departure, early_departure_minutes, overtime_hours,
        remarks, recorded_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
        status = excluded.status,
        leave_type = excluded.leave_type,
        check_in_time = excluded.check_in_time,
        check_out_time = excluded.check_out_time,
        is_late = excluded.is_late,
        late_minutes = excluded.late_minutes,
        is_early_departure = excluded.is_early_departure,
        early_departure_minutes = excluded.early_departure_minutes,
        overtime_hours = excluded.overtime_hours,
        remarks = excluded.remarks,
        recorded_by = excluded.recorded_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      employeeId,
      attendanceDate,
      computed.status,
      computed.leave_type,
      computed.check_in_time,
      computed.check_out_time,
      computed.is_late,
      computed.late_minutes,
      computed.is_early_departure,
      computed.early_departure_minutes,
      computed.overtime_hours,
      computed.remarks,
      actor.username
    );

    const saved = db
      .prepare('SELECT * FROM employee_attendance WHERE employee_id = ? AND attendance_date = ?')
      .get(employeeId, attendanceDate);

    return res.json({
      success: true,
      message: 'Attendance recorded successfully.',
      data: saved,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save attendance',
    });
  }
});

payrollRouter.post('/attendance/bulk', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_attendance', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to record bulk attendance.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const attendanceDate = String(req.body?.attendance_date || new Date().toISOString().slice(0, 10)).trim();
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

    if (entries.length === 0) {
      return res.status(400).json({ success: false, error: 'No attendance entries provided.' });
    }

    const stmt = db.prepare(`
      INSERT INTO employee_attendance (
        employee_id, attendance_date, status, leave_type,
        check_in_time, check_out_time, is_late, late_minutes,
        is_early_departure, early_departure_minutes, overtime_hours,
        remarks, recorded_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
        status = excluded.status,
        leave_type = excluded.leave_type,
        check_in_time = excluded.check_in_time,
        check_out_time = excluded.check_out_time,
        is_late = excluded.is_late,
        late_minutes = excluded.late_minutes,
        is_early_departure = excluded.is_early_departure,
        early_departure_minutes = excluded.early_departure_minutes,
        overtime_hours = excluded.overtime_hours,
        remarks = excluded.remarks,
        recorded_by = excluded.recorded_by,
        updated_at = CURRENT_TIMESTAMP
    `);

    const count = db.transaction(() => {
      let c = 0;
      for (const item of entries) {
        const empId = Number(item.employee_id);
        if (!empId) continue;
        const dateStr = String(item.attendance_date || attendanceDate).trim();
        const computed = computeAttendanceTimings(item);
        stmt.run(
          empId,
          dateStr,
          computed.status,
          computed.leave_type,
          computed.check_in_time,
          computed.check_out_time,
          computed.is_late,
          computed.late_minutes,
          computed.is_early_departure,
          computed.early_departure_minutes,
          computed.overtime_hours,
          computed.remarks,
          actor.username
        );
        c++;
      }
      return c;
    })();

    logPayrollAudit(db, {
      action: 'BULK_ATTENDANCE_SAVED',
      moduleSection: 'Attendance',
      recordReference: attendanceDate,
      performedBy: actor.username,
      performedByRole: actor.role,
      details: { attendance_date: attendanceDate, count },
    });

    return res.json({
      success: true,
      message: `Saved attendance for ${count} employee(s) on ${attendanceDate}.`,
      count,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save bulk attendance',
    });
  }
});

payrollRouter.put('/attendance/:id/correct', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_attendance', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to correct attendance.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Attendance record not found.' });
    }

    const body = req.body || {};
    const correctionReason = String(body.correction_reason || body.remarks || 'Authorized attendance correction').trim();
    const computed = computeAttendanceTimings(body);

    db.prepare(`
      UPDATE employee_attendance SET
        status = ?,
        leave_type = ?,
        check_in_time = ?,
        check_out_time = ?,
        is_late = ?,
        late_minutes = ?,
        is_early_departure = ?,
        early_departure_minutes = ?,
        overtime_hours = ?,
        remarks = ?,
        corrected_by = ?,
        correction_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      computed.status,
      computed.leave_type,
      computed.check_in_time,
      computed.check_out_time,
      computed.is_late,
      computed.late_minutes,
      computed.is_early_departure,
      computed.early_departure_minutes,
      computed.overtime_hours,
      computed.remarks,
      actor.username,
      correctionReason,
      id
    );

    logPayrollAudit(db, {
      action: 'ATTENDANCE_CORRECTED',
      moduleSection: 'Attendance',
      recordReference: `${existing.attendance_date}`,
      employeeId: Number(existing.employee_id),
      performedBy: actor.username,
      performedByRole: actor.role,
      details: {
        attendance_id: id,
        previous_status: existing.status,
        new_status: computed.status,
        correction_reason: correctionReason,
      },
    });

    return res.json({
      success: true,
      message: 'Attendance corrected with audit trail.',
      data: db.prepare('SELECT * FROM employee_attendance WHERE id = ?').get(id),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to correct attendance',
    });
  }
});

// ============================================================================
// 5. LEAVE MANAGEMENT
// ============================================================================
function syncApprovedLeaveToAttendance(
  db: Database.Database,
  leave: { employee_id: number; leave_type: string; start_date: string; end_date: string; reason: string },
  recordedBy: string
) {
  const start = new Date(`${leave.start_date}T00:00:00Z`);
  const end = new Date(`${leave.end_date}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;

  const stmt = db.prepare(`
    INSERT INTO employee_attendance (
      employee_id, attendance_date, status, leave_type, remarks, recorded_by, updated_at
    ) VALUES (?, ?, 'Leave', ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
      status = 'Leave',
      leave_type = excluded.leave_type,
      remarks = excluded.remarks,
      recorded_by = excluded.recorded_by,
      updated_at = CURRENT_TIMESTAMP
  `);

  const cur = new Date(start);
  let safety = 0;
  while (cur <= end && safety < 120) {
    const dStr = cur.toISOString().slice(0, 10);
    stmt.run(leave.employee_id, dStr, leave.leave_type, leave.reason || leave.leave_type, recordedBy);
    cur.setUTCDate(cur.getUTCDate() + 1);
    safety++;
  }
}

payrollRouter.get('/leaves', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const employeeId = Number(req.query.employee_id) || 0;
    const status = String(req.query.status || 'all').trim();
    const leaveType = String(req.query.leave_type || 'all').trim();
    const year = Number(req.query.year) || 0;

    let sql = `
      SELECT
        l.*,
        e.employee_code,
        e.full_name,
        e.department,
        e.designation
      FROM employee_leaves l
      INNER JOIN employees e ON e.id = l.employee_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (employeeId > 0) {
      sql += ` AND l.employee_id = ?`;
      params.push(employeeId);
    }
    if (status && status !== 'all') {
      sql += ` AND l.status = ?`;
      params.push(status);
    }
    if (leaveType && leaveType !== 'all') {
      sql += ` AND l.leave_type = ?`;
      params.push(leaveType);
    }
    if (year >= 2000) {
      sql += ` AND l.start_date LIKE ?`;
      params.push(`${year}-%`);
    }

    sql += ` ORDER BY l.id DESC`;
    const rows = db.prepare(sql).all(...params);
    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch leaves',
    });
  }
});

payrollRouter.get('/leaves/balances', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const year = Number(req.query.year) || new Date().getFullYear();
    const yearPrefix = `${year}-%`;

    const employees = db
      .prepare(`
        SELECT
          id, employee_code, full_name, department, designation, employment_status,
          annual_casual_leave_quota, annual_sick_leave_quota, annual_earned_leave_quota
        FROM employees
        ORDER BY id ASC
      `)
      .all() as Array<Record<string, any>>;

    const leaves = db
      .prepare(`
        SELECT employee_id, leave_type, status, COALESCE(SUM(total_days), 0) as days
        FROM employee_leaves
        WHERE start_date LIKE ?
        GROUP BY employee_id, leave_type, status
      `)
      .all(yearPrefix) as Array<Record<string, any>>;

    const balances = employees.map((emp) => {
      const empLeaves = leaves.filter((l) => Number(l.employee_id) === Number(emp.id));
      const sumApproved = (type: string) =>
        empLeaves
          .filter((l) => l.leave_type === type && l.status === 'Approved')
          .reduce((acc, r) => acc + (Number(r.days) || 0), 0);
      const sumPending = (type: string) =>
        empLeaves
          .filter((l) => l.leave_type === type && l.status === 'Pending')
          .reduce((acc, r) => acc + (Number(r.days) || 0), 0);

      const casualUsed = sumApproved('Casual Leave');
      const sickUsed = sumApproved('Sick Leave');
      const annualUsed = sumApproved('Annual Leave');
      const unpaidUsed = sumApproved('Unpaid Leave');

      const casualQuota = Number(emp.annual_casual_leave_quota) || 12;
      const sickQuota = Number(emp.annual_sick_leave_quota) || 10;
      const annualQuota = Number(emp.annual_earned_leave_quota) || 14;

      return {
        employee_id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        department: emp.department,
        designation: emp.designation,
        employment_status: emp.employment_status,
        year,
        casual_quota: casualQuota,
        casual_used: casualUsed,
        casual_remaining: Math.max(0, casualQuota - casualUsed),
        sick_quota: sickQuota,
        sick_used: sickUsed,
        sick_remaining: Math.max(0, sickQuota - sickUsed),
        annual_quota: annualQuota,
        annual_used: annualUsed,
        annual_remaining: Math.max(0, annualQuota - annualUsed),
        unpaid_used: unpaidUsed,
        pending_days:
          sumPending('Casual Leave') +
          sumPending('Sick Leave') +
          sumPending('Annual Leave') +
          sumPending('Unpaid Leave'),
      };
    });

    return res.json({ success: true, data: balances });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to calculate leave balances',
    });
  }
});

payrollRouter.post('/leaves', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_leave', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to submit leave applications.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const body = req.body || {};

    const employeeId = Number(body.employee_id);
    const leaveType = ['Casual Leave', 'Sick Leave', 'Annual Leave', 'Unpaid Leave'].includes(body.leave_type)
      ? body.leave_type
      : 'Casual Leave';
    const startDate = String(body.start_date || '').trim();
    const endDate = String(body.end_date || startDate).trim();

    if (!employeeId || !startDate) {
      return res.status(400).json({ success: false, error: 'Employee and leave start date are required.' });
    }

    const sDate = new Date(`${startDate}T00:00:00Z`);
    const eDate = new Date(`${endDate}T00:00:00Z`);
    const computedDays =
      !isNaN(sDate.getTime()) && !isNaN(eDate.getTime()) && eDate >= sDate
        ? Math.floor((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
        : 1;
    const totalDays = Number(body.total_days) > 0 ? Number(body.total_days) : computedDays;
    const isPaid = leaveType === 'Unpaid Leave' ? 0 : body.is_paid !== undefined ? (Number(body.is_paid) ? 1 : 0) : 1;
    const status = ['Pending', 'Approved', 'Rejected'].includes(body.status) ? body.status : 'Approved';
    const reason = String(body.reason || '').trim();

    const maxIdRow = db.prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM employee_leaves').get() as { max_id: number };
    const leaveCode = `LV-${new Date().getFullYear()}-${String((maxIdRow?.max_id || 0) + 1).padStart(4, '0')}`;

    const saved = db.transaction(() => {
      const ins = db
        .prepare(`
          INSERT INTO employee_leaves (
            leave_code, employee_id, leave_type, start_date, end_date,
            total_days, is_paid, reason, status, approved_by, approved_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          leaveCode,
          employeeId,
          leaveType,
          startDate,
          endDate,
          totalDays,
          isPaid,
          reason,
          status,
          status === 'Approved' ? actor.username : '',
          status === 'Approved' ? new Date().toISOString() : null,
          actor.username
        );

      if (status === 'Approved') {
        syncApprovedLeaveToAttendance(
          db,
          { employee_id: employeeId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason },
          actor.username
        );
      }

      logPayrollAudit(db, {
        action: `LEAVE_${status.toUpperCase()}`,
        moduleSection: 'Leaves',
        recordReference: leaveCode,
        employeeId,
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { leave_type: leaveType, start_date: startDate, end_date: endDate, total_days: totalDays },
      });

      return db.prepare('SELECT * FROM employee_leaves WHERE id = ?').get(Number(ins.lastInsertRowid));
    })();

    return res.status(201).json({
      success: true,
      message: `Leave application (${leaveCode}) saved as ${status}.`,
      data: saved,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create leave application',
    });
  }
});

payrollRouter.patch('/leaves/:id/status', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_leave', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to approve/reject leaves.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employee_leaves WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Leave record not found.' });
    }

    const status = ['Approved', 'Rejected', 'Pending'].includes(req.body?.status) ? req.body.status : 'Approved';
    const rejectionReason = String(req.body?.rejection_reason || '').trim();

    db.transaction(() => {
      db.prepare(`
        UPDATE employee_leaves SET
          status = ?,
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP,
          rejection_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, actor.username, rejectionReason, id);

      if (status === 'Approved') {
        syncApprovedLeaveToAttendance(
          db,
          {
            employee_id: Number(existing.employee_id),
            leave_type: String(existing.leave_type),
            start_date: String(existing.start_date),
            end_date: String(existing.end_date),
            reason: String(existing.reason || ''),
          },
          actor.username
        );
      }

      logPayrollAudit(db, {
        action: `LEAVE_${status.toUpperCase()}`,
        moduleSection: 'Leaves',
        recordReference: existing.leave_code,
        employeeId: Number(existing.employee_id),
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { status, rejection_reason: rejectionReason },
      });
    })();

    return res.json({
      success: true,
      message: `Leave application marked as ${status}.`,
      data: db.prepare('SELECT * FROM employee_leaves WHERE id = ?').get(id),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update leave status',
    });
  }
});

// ============================================================================
// 6. MONTHLY PAYROLL PROCESSING, FINALIZATION & REOPENING
// ============================================================================
payrollRouter.get('/processing', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const month = Number(req.query.month) || 0;
    const year = Number(req.query.year) || 0;
    const employeeId = Number(req.query.employee_id) || 0;
    const status = String(req.query.status || 'all').trim();
    const paymentStatus = String(req.query.payment_status || 'all').trim();

    let sql = `
      SELECT
        pr.*,
        e.employee_code,
        e.full_name,
        e.father_name,
        e.department,
        e.designation,
        e.cnic,
        e.phone,
        e.payment_method,
        e.bank_name,
        e.bank_account_number,
        je.entry_number as journal_entry_number
      FROM payroll_records pr
      INNER JOIN employees e ON e.id = pr.employee_id
      LEFT JOIN journal_entries je ON je.id = pr.journal_entry_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (month >= 1 && month <= 12) {
      sql += ` AND pr.payroll_month = ?`;
      params.push(month);
    }
    if (year >= 2000) {
      sql += ` AND pr.payroll_year = ?`;
      params.push(year);
    }
    if (employeeId > 0) {
      sql += ` AND pr.employee_id = ?`;
      params.push(employeeId);
    }
    if (status && status !== 'all') {
      sql += ` AND pr.status = ?`;
      params.push(status);
    }
    if (paymentStatus && paymentStatus !== 'all') {
      sql += ` AND pr.payment_status = ?`;
      params.push(paymentStatus);
    }

    sql += ` ORDER BY pr.payroll_year DESC, pr.payroll_month DESC, e.id ASC`;
    const rows = db.prepare(sql).all(...params);
    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch payroll records',
    });
  }
});

payrollRouter.post('/processing/preview', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const now = new Date();
    const month = Number(req.body?.payroll_month || req.body?.month) || now.getMonth() + 1;
    const year = Number(req.body?.payroll_year || req.body?.year) || now.getFullYear();
    const employeeId = Number(req.body?.employee_id) || 0;

    let empIds: number[] = [];
    if (employeeId > 0) {
      empIds = [employeeId];
    } else {
      const activeEmps = db
        .prepare("SELECT id FROM employees WHERE employment_status = 'Active' ORDER BY id ASC")
        .all() as Array<{ id: number }>;
      empIds = activeEmps.map((e) => e.id);
    }

    const previews: PayrollCalculationResult[] = [];
    for (const id of empIds) {
      const calc = calculateEmployeeMonthlyPayroll(db, id, month, year);
      if (calc) previews.push(calc);
    }

    return res.json({
      success: true,
      data: {
        payroll_month: month,
        payroll_year: year,
        period_label: `${MONTH_NAMES[month - 1]} ${year}`,
        previews,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to preview monthly payroll',
    });
  }
});

payrollRouter.post('/processing/generate', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_process', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to process payroll.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const now = new Date();
    const month = Number(req.body?.payroll_month || req.body?.month) || now.getMonth() + 1;
    const year = Number(req.body?.payroll_year || req.body?.year) || now.getFullYear();
    const employeeId = Number(req.body?.employee_id) || 0;
    const customItems = Array.isArray(req.body?.items) ? req.body.items : null;

    let targetEmployees: Array<{ id: number; overrides?: Record<string, any> }> = [];
    if (customItems && customItems.length > 0) {
      targetEmployees = customItems.map((it: Record<string, any>) => ({
        id: Number(it.employee_id),
        overrides: it,
      }));
    } else if (employeeId > 0) {
      targetEmployees = [{ id: employeeId, overrides: req.body?.overrides }];
    } else {
      const activeEmps = db
        .prepare("SELECT id FROM employees WHERE employment_status = 'Active' ORDER BY id ASC")
        .all() as Array<{ id: number }>;
      targetEmployees = activeEmps.map((e) => ({ id: e.id }));
    }

    if (targetEmployees.length === 0) {
      return res.status(400).json({ success: false, error: 'No active employees found to process payroll.' });
    }

    const result = db.transaction(() => {
      const createdIds: number[] = [];
      const skippedDuplicates: string[] = [];

      for (const item of targetEmployees) {
        const existing = db
          .prepare(
            'SELECT id, payroll_code, status FROM payroll_records WHERE employee_id = ? AND payroll_month = ? AND payroll_year = ?'
          )
          .get(item.id, month, year) as { id: number; payroll_code: string; status: string } | undefined;

        if (existing) {
          skippedDuplicates.push(existing.payroll_code);
          continue;
        }

        const calc = calculateEmployeeMonthlyPayroll(db, item.id, month, year, item.overrides);
        if (!calc) continue;

        const maxRow = db
          .prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM payroll_records')
          .get() as { max_id: number };
        const payrollCode = `PAY-${year}${String(month).padStart(2, '0')}-${String((maxRow?.max_id || 0) + 1).padStart(3, '0')}`;

        const ins = db
          .prepare(`
            INSERT INTO payroll_records (
              payroll_code, employee_id, payroll_month, payroll_year, period_label,
              working_days, present_days, half_days, absent_days, paid_leaves, unpaid_leaves,
              holidays, late_count, overtime_hours,
              basic_salary, house_allowance, medical_allowance, conveyance_allowance,
              other_allowances, overtime_amount, bonus_amount, gross_salary,
              absent_deduction, late_deduction, unpaid_leave_deduction,
              advance_recovery, loan_recovery, other_deductions, total_deductions,
              net_salary, paid_amount, remaining_amount, payment_status, status,
              remarks, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, 'Unpaid', 'Processed', ?, ?)
          `)
          .run(
            payrollCode,
            calc.employee_id,
            month,
            year,
            calc.period_label,
            calc.working_days,
            calc.present_days,
            calc.half_days,
            calc.absent_days,
            calc.paid_leaves,
            calc.unpaid_leaves,
            calc.holidays,
            calc.late_count,
            calc.overtime_hours,
            calc.basic_salary,
            calc.house_allowance,
            calc.medical_allowance,
            calc.conveyance_allowance,
            calc.other_allowances,
            calc.overtime_amount,
            calc.bonus_amount,
            calc.gross_salary,
            calc.absent_deduction,
            calc.late_deduction,
            calc.unpaid_leave_deduction,
            calc.advance_recovery,
            calc.loan_recovery,
            calc.other_deductions,
            calc.total_deductions,
            calc.net_salary,
            calc.net_salary,
            String(item.overrides?.remarks || ''),
            actor.username
          );

        const newId = Number(ins.lastInsertRowid);
        createdIds.push(newId);

        logPayrollAudit(db, {
          action: 'PAYROLL_GENERATED',
          moduleSection: 'Payroll Processing',
          recordReference: payrollCode,
          employeeId: calc.employee_id,
          performedBy: actor.username,
          performedByRole: actor.role,
          details: {
            period_label: calc.period_label,
            gross_salary: calc.gross_salary,
            total_deductions: calc.total_deductions,
            net_salary: calc.net_salary,
          },
        });
      }

      return { createdIds, skippedDuplicates };
    })();

    if (result.createdIds.length === 0 && result.skippedDuplicates.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Payroll already exists for the selected employee(s) and period (${MONTH_NAMES[month - 1]} ${year}). Duplicate payroll generation is prevented.`,
        skipped_duplicates: result.skippedDuplicates,
      });
    }

    const records = db
      .prepare(`
        SELECT pr.*, e.employee_code, e.full_name, e.department, e.designation
        FROM payroll_records pr
        INNER JOIN employees e ON e.id = pr.employee_id
        WHERE pr.payroll_month = ? AND pr.payroll_year = ?
        ORDER BY e.id ASC
      `)
      .all(month, year);

    return res.status(201).json({
      success: true,
      message: `Processed ${result.createdIds.length} payroll record(s) for ${MONTH_NAMES[month - 1]} ${year}.${
        result.skippedDuplicates.length > 0 ? ` (${result.skippedDuplicates.length} existing skipped)` : ''
      }`,
      created_count: result.createdIds.length,
      skipped_duplicates: result.skippedDuplicates,
      data: records,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate monthly payroll',
    });
  }
});

payrollRouter.put('/processing/:id', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_process', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to edit payroll records.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM payroll_records WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payroll record not found.' });
    }
    if (existing.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        error: 'Finalized payroll cannot be modified directly. Please reopen the payroll with authorized permission first.',
      });
    }

    const body = req.body || {};
    const calc = calculateEmployeeMonthlyPayroll(
      db,
      Number(existing.employee_id),
      Number(existing.payroll_month),
      Number(existing.payroll_year),
      {
        working_days: body.working_days ?? existing.working_days,
        present_days: body.present_days ?? existing.present_days,
        half_days: body.half_days ?? existing.half_days,
        absent_days: body.absent_days ?? existing.absent_days,
        paid_leaves: body.paid_leaves ?? existing.paid_leaves,
        unpaid_leaves: body.unpaid_leaves ?? existing.unpaid_leaves,
        holidays: body.holidays ?? existing.holidays,
        late_count: body.late_count ?? existing.late_count,
        overtime_hours: body.overtime_hours ?? existing.overtime_hours,
        basic_salary: body.basic_salary ?? existing.basic_salary,
        house_allowance: body.house_allowance ?? existing.house_allowance,
        medical_allowance: body.medical_allowance ?? existing.medical_allowance,
        conveyance_allowance: body.conveyance_allowance ?? existing.conveyance_allowance,
        other_allowances: body.other_allowances ?? existing.other_allowances,
        overtime_amount: body.overtime_amount ?? existing.overtime_amount,
        bonus_amount: body.bonus_amount ?? existing.bonus_amount,
        absent_deduction: body.absent_deduction ?? existing.absent_deduction,
        late_deduction: body.late_deduction ?? existing.late_deduction,
        unpaid_leave_deduction: body.unpaid_leave_deduction ?? existing.unpaid_leave_deduction,
        advance_recovery: body.advance_recovery ?? existing.advance_recovery,
        loan_recovery: body.loan_recovery ?? existing.loan_recovery,
        other_deductions: body.other_deductions ?? existing.other_deductions,
      }
    );

    if (!calc) {
      return res.status(400).json({ success: false, error: 'Failed to recalculate payroll.' });
    }

    const paidAmount = round2(Number(existing.paid_amount) || 0);
    const remainingAmount = Math.max(0, round2(calc.net_salary - paidAmount));
    const paymentStatus =
      paidAmount <= 0 ? 'Unpaid' : remainingAmount <= 0.009 ? 'Paid' : 'Partially Paid';

    db.prepare(`
      UPDATE payroll_records SET
        working_days = ?, present_days = ?, half_days = ?, absent_days = ?,
        paid_leaves = ?, unpaid_leaves = ?, holidays = ?, late_count = ?, overtime_hours = ?,
        basic_salary = ?, house_allowance = ?, medical_allowance = ?, conveyance_allowance = ?,
        other_allowances = ?, overtime_amount = ?, bonus_amount = ?, gross_salary = ?,
        absent_deduction = ?, late_deduction = ?, unpaid_leave_deduction = ?,
        advance_recovery = ?, loan_recovery = ?, other_deductions = ?, total_deductions = ?,
        net_salary = ?, remaining_amount = ?, payment_status = ?, remarks = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      calc.working_days,
      calc.present_days,
      calc.half_days,
      calc.absent_days,
      calc.paid_leaves,
      calc.unpaid_leaves,
      calc.holidays,
      calc.late_count,
      calc.overtime_hours,
      calc.basic_salary,
      calc.house_allowance,
      calc.medical_allowance,
      calc.conveyance_allowance,
      calc.other_allowances,
      calc.overtime_amount,
      calc.bonus_amount,
      calc.gross_salary,
      calc.absent_deduction,
      calc.late_deduction,
      calc.unpaid_leave_deduction,
      calc.advance_recovery,
      calc.loan_recovery,
      calc.other_deductions,
      calc.total_deductions,
      calc.net_salary,
      remainingAmount,
      paymentStatus,
      String(body.remarks ?? existing.remarks ?? ''),
      id
    );

    logPayrollAudit(db, {
      action: 'PAYROLL_ADJUSTED',
      moduleSection: 'Payroll Processing',
      recordReference: existing.payroll_code,
      employeeId: Number(existing.employee_id),
      performedBy: actor.username,
      performedByRole: actor.role,
      details: { gross_salary: calc.gross_salary, total_deductions: calc.total_deductions, net_salary: calc.net_salary },
    });

    return res.json({
      success: true,
      message: 'Payroll record updated successfully.',
      data: db.prepare('SELECT * FROM payroll_records WHERE id = ?').get(id),
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update payroll record',
    });
  }
});

function finalizeSinglePayrollRecord(
  db: Database.Database,
  payrollId: number,
  actor: { username: string; role: string }
): Record<string, any> {
  const payroll = db
    .prepare(`
      SELECT pr.*, e.employee_code, e.full_name
      FROM payroll_records pr
      INNER JOIN employees e ON e.id = pr.employee_id
      WHERE pr.id = ?
    `)
    .get(payrollId) as Record<string, any> | undefined;

  if (!payroll) {
    throw new Error(`Payroll record #${payrollId} not found.`);
  }
  if (payroll.status === 'Finalized' && payroll.journal_entry_id) {
    return payroll;
  }

  const sysAccounts = ensurePayrollSystemAccounts(db);
  const netSalary = round2(Number(payroll.net_salary) || 0);
  const advanceRecovery = round2(Number(payroll.advance_recovery) || 0);
  const loanRecovery = round2(Number(payroll.loan_recovery) || 0);
  const salaryExpenseAmount = round2(netSalary + advanceRecovery + loanRecovery);

  const entryDate = new Date().toISOString().slice(0, 10);
  let journalEntryId: number | null = null;

  if (salaryExpenseAmount > 0) {
    const entryNumber = getNextJournalEntryNumber(db);
    const description = `Payroll Accrual (${payroll.payroll_code}) - ${payroll.full_name} (${payroll.employee_code}) for ${payroll.period_label}`;

    const jeIns = db
      .prepare(`
        INSERT INTO journal_entries (
          entry_number, entry_date, reference_type, reference_id,
          description, total_debit, total_credit, is_balanced, status
        ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')
      `)
      .run(
        entryNumber,
        entryDate,
        payrollId,
        description,
        salaryExpenseAmount,
        salaryExpenseAmount
      );

    journalEntryId = Number(jeIns.lastInsertRowid);

    const lineStmt = db.prepare(`
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
      ) VALUES (?, ?, 'general', ?, ?, ?)
    `);

    // 1. Debit Staff Salaries & Wages Expense
    lineStmt.run(
      journalEntryId,
      sysAccounts.salaryExpenseAcc.id,
      salaryExpenseAmount,
      0,
      `Salary Expense (${payroll.payroll_code}) - ${payroll.full_name} (${payroll.period_label})`
    );

    // 2. Credit Employee Salary Advances (if advance recovery > 0)
    if (advanceRecovery > 0) {
      lineStmt.run(
        journalEntryId,
        sysAccounts.advanceAssetAcc.id,
        0,
        advanceRecovery,
        `Advance Salary Recovery (${payroll.payroll_code}) - ${payroll.full_name} (${payroll.period_label})`
      );
    }

    // 3. Credit Employee Loans Receivable (if loan recovery > 0)
    if (loanRecovery > 0) {
      lineStmt.run(
        journalEntryId,
        sysAccounts.loanAssetAcc.id,
        0,
        loanRecovery,
        `Employee Loan Installment Recovery (${payroll.payroll_code}) - ${payroll.full_name} (${payroll.period_label})`
      );
    }

    // 4. Credit Staff Salary Payable
    if (netSalary > 0) {
      lineStmt.run(
        journalEntryId,
        sysAccounts.salaryPayableAcc.id,
        0,
        netSalary,
        `Net Payable Salary (${payroll.payroll_code}) - ${payroll.full_name} (${payroll.period_label})`
      );
    }

    recalculateAccountBalance(db, sysAccounts.salaryExpenseAcc.id);
    if (advanceRecovery > 0) recalculateAccountBalance(db, sysAccounts.advanceAssetAcc.id);
    if (loanRecovery > 0) recalculateAccountBalance(db, sysAccounts.loanAssetAcc.id);
    if (netSalary > 0) recalculateAccountBalance(db, sysAccounts.salaryPayableAcc.id);
  }

  // Apply Advance Recovery across active advances for this employee
  if (advanceRecovery > 0) {
    let remToRecover = advanceRecovery;
    const activeAdvances = db
      .prepare(`
        SELECT * FROM employee_advances_loans
        WHERE employee_id = ? AND transaction_type = 'Advance' AND status = 'Active' AND remaining_balance > 0
        ORDER BY disbursement_date ASC, id ASC
      `)
      .all(payroll.employee_id) as Array<Record<string, any>>;

    for (const adv of activeAdvances) {
      if (remToRecover <= 0) break;
      const deduct = round2(Math.min(remToRecover, Number(adv.remaining_balance)));
      if (deduct <= 0) continue;

      const newRecovered = round2(Number(adv.recovered_amount) + deduct);
      const newRemaining = Math.max(0, round2(Number(adv.principal_amount) - newRecovered));
      const newStatus = newRemaining <= 0.009 ? 'Completed' : 'Active';

      db.prepare(`
        UPDATE employee_advances_loans
        SET recovered_amount = ?, remaining_balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newRecovered, newRemaining, newStatus, adv.id);

      db.prepare(`
        INSERT INTO employee_advance_loan_recoveries (
          advance_loan_id, employee_id, payroll_id, recovery_date, recovery_month, recovery_year,
          amount, recovery_method, journal_entry_id, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Payroll_Deduction', ?, ?, ?)
      `).run(
        adv.id,
        payroll.employee_id,
        payrollId,
        entryDate,
        payroll.payroll_month,
        payroll.payroll_year,
        deduct,
        journalEntryId,
        `Recovered via Payroll ${payroll.payroll_code}`,
        actor.username
      );

      remToRecover = round2(remToRecover - deduct);
    }
  }

  // Apply Loan Recovery across active loans for this employee
  if (loanRecovery > 0) {
    let remToRecover = loanRecovery;
    const activeLoans = db
      .prepare(`
        SELECT * FROM employee_advances_loans
        WHERE employee_id = ? AND transaction_type = 'Loan' AND status = 'Active' AND remaining_balance > 0
        ORDER BY disbursement_date ASC, id ASC
      `)
      .all(payroll.employee_id) as Array<Record<string, any>>;

    for (const ln of activeLoans) {
      if (remToRecover <= 0) break;
      const deduct = round2(Math.min(remToRecover, Number(ln.remaining_balance)));
      if (deduct <= 0) continue;

      const newRecovered = round2(Number(ln.recovered_amount) + deduct);
      const newRemaining = Math.max(0, round2(Number(ln.principal_amount) - newRecovered));
      const newStatus = newRemaining <= 0.009 ? 'Completed' : 'Active';

      db.prepare(`
        UPDATE employee_advances_loans
        SET recovered_amount = ?, remaining_balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newRecovered, newRemaining, newStatus, ln.id);

      db.prepare(`
        INSERT INTO employee_advance_loan_recoveries (
          advance_loan_id, employee_id, payroll_id, recovery_date, recovery_month, recovery_year,
          amount, recovery_method, journal_entry_id, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Payroll_Deduction', ?, ?, ?)
      `).run(
        ln.id,
        payroll.employee_id,
        payrollId,
        entryDate,
        payroll.payroll_month,
        payroll.payroll_year,
        deduct,
        journalEntryId,
        `Loan installment recovered via Payroll ${payroll.payroll_code}`,
        actor.username
      );

      remToRecover = round2(remToRecover - deduct);
    }
  }

  const paidAmount = round2(Number(payroll.paid_amount) || 0);
  const remainingAmount = Math.max(0, round2(netSalary - paidAmount));
  // CRITICAL RULE: Do NOT mark salary as Paid when payroll is finalized unless paid_amount already covers it
  const paymentStatus =
    paidAmount <= 0 ? 'Unpaid' : remainingAmount <= 0.009 ? 'Paid' : 'Partially Paid';

  db.prepare(`
    UPDATE payroll_records SET
      status = 'Finalized',
      payment_status = ?,
      remaining_amount = ?,
      journal_entry_id = ?,
      finalized_by = ?,
      finalized_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(paymentStatus, remainingAmount, journalEntryId, actor.username, payrollId);

  appendEmployeeLedgerEntry(db, {
    employeeId: Number(payroll.employee_id),
    transactionDate: entryDate,
    transactionType: 'Payroll_Accrual',
    referenceCode: payroll.payroll_code,
    referenceId: payrollId,
    description: `Finalized Salary for ${payroll.period_label} (Gross: Rs ${payroll.gross_salary}, Deductions: Rs ${payroll.total_deductions}, Net Payable: Rs ${netSalary})`,
    debitAmount: 0,
    creditAmount: netSalary,
    journalEntryId,
    createdBy: actor.username,
  });

  logPayrollAudit(db, {
    action: 'PAYROLL_FINALIZED',
    moduleSection: 'Payroll Processing',
    recordReference: payroll.payroll_code,
    employeeId: Number(payroll.employee_id),
    performedBy: actor.username,
    performedByRole: actor.role,
    details: {
      payroll_id: payrollId,
      net_salary: netSalary,
      advance_recovery: advanceRecovery,
      loan_recovery: loanRecovery,
      journal_entry_id: journalEntryId,
    },
  });

  return db.prepare('SELECT * FROM payroll_records WHERE id = ?').get(payrollId) as Record<string, any>;
}

payrollRouter.post('/processing/:id/finalize', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_approve', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to finalize payroll.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);

    const finalized = db.transaction(() => finalizeSinglePayrollRecord(db, id, actor))();

    return res.json({
      success: true,
      message: `Payroll ${finalized.payroll_code} finalized and accrued to Staff Salary Payable (LIA-2030).`,
      data: finalized,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize payroll',
    });
  }
});

payrollRouter.post('/processing/finalize-batch', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_approve', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to finalize payroll batch.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const ids: number[] = Array.isArray(req.body?.payroll_ids)
      ? req.body.payroll_ids.map((n: unknown) => Number(n)).filter((n: number) => n > 0)
      : [];

    if (ids.length === 0 && req.body?.payroll_month && req.body?.payroll_year) {
      const pendingRows = db
        .prepare(
          "SELECT id FROM payroll_records WHERE payroll_month = ? AND payroll_year = ? AND status != 'Finalized'"
        )
        .all(Number(req.body.payroll_month), Number(req.body.payroll_year)) as Array<{ id: number }>;
      for (const r of pendingRows) ids.push(r.id);
    }

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No pending payroll records selected to finalize.' });
    }

    const results = db.transaction(() => {
      return ids.map((id) => finalizeSinglePayrollRecord(db, id, actor));
    })();

    return res.json({
      success: true,
      message: `Finalized ${results.length} payroll record(s) and posted salary accrual journals.`,
      data: results,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize payroll batch',
    });
  }
});

payrollRouter.post('/processing/:id/reopen', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_approve', 'edit')) {
      return res.status(403).json({
        success: false,
        error: 'Only Super Admin or users with Approve Payroll permission can reopen a finalized payroll.',
      });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an audit reason for reopening this finalized payroll.',
      });
    }

    const existing = db.prepare('SELECT * FROM payroll_records WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payroll record not found.' });
    }
    if (existing.status !== 'Finalized') {
      return res.status(400).json({ success: false, error: 'Only Finalized payroll records need to be reopened.' });
    }
    if (Number(existing.paid_amount) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot reopen a payroll that already has salary payment(s) recorded against it.',
      });
    }

    const reopened = db.transaction(() => {
      const sysAccounts = ensurePayrollSystemAccounts(db);

      // 1. Restore any advance/loan recoveries linked to this payroll
      const recoveries = db
        .prepare('SELECT * FROM employee_advance_loan_recoveries WHERE payroll_id = ?')
        .all(id) as Array<Record<string, any>>;

      for (const rec of recoveries) {
        const advLoan = db
          .prepare('SELECT * FROM employee_advances_loans WHERE id = ?')
          .get(rec.advance_loan_id) as Record<string, any> | undefined;
        if (advLoan) {
          const restoredRecovered = Math.max(0, round2(Number(advLoan.recovered_amount) - Number(rec.amount)));
          const restoredRemaining = round2(Number(advLoan.principal_amount) - restoredRecovered);
          db.prepare(`
            UPDATE employee_advances_loans
            SET recovered_amount = ?, remaining_balance = ?, status = 'Active', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(restoredRecovered, restoredRemaining, advLoan.id);
        }
      }
      db.prepare('DELETE FROM employee_advance_loan_recoveries WHERE payroll_id = ?').run(id);

      // 2. Delete accrual journal entry & recalculate affected accounts
      const oldJeId = Number(existing.journal_entry_id) || 0;
      if (oldJeId > 0) {
        db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(oldJeId);
        db.prepare('DELETE FROM journal_entries WHERE id = ?').run(oldJeId);
        recalculateAccountBalance(db, sysAccounts.salaryExpenseAcc.id);
        recalculateAccountBalance(db, sysAccounts.salaryPayableAcc.id);
        recalculateAccountBalance(db, sysAccounts.advanceAssetAcc.id);
        recalculateAccountBalance(db, sysAccounts.loanAssetAcc.id);
      }

      // 3. Mark payroll as Reopened
      db.prepare(`
        UPDATE payroll_records SET
          status = 'Reopened',
          journal_entry_id = NULL,
          reopened_by = ?,
          reopened_at = CURRENT_TIMESTAMP,
          reopen_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(actor.username, reason, id);

      appendEmployeeLedgerEntry(db, {
        employeeId: Number(existing.employee_id),
        transactionDate: new Date().toISOString().slice(0, 10),
        transactionType: 'Payroll_Reopened',
        referenceCode: existing.payroll_code,
        referenceId: id,
        description: `Reopened Finalized Payroll (${existing.period_label}) - Reason: ${reason}`,
        debitAmount: round2(Number(existing.net_salary) || 0),
        creditAmount: 0,
        journalEntryId: null,
        createdBy: actor.username,
      });

      logPayrollAudit(db, {
        action: 'PAYROLL_REOPENED',
        moduleSection: 'Payroll Processing',
        recordReference: existing.payroll_code,
        employeeId: Number(existing.employee_id),
        performedBy: actor.username,
        performedByRole: actor.role,
        details: { reason, reversed_journal_entry_id: oldJeId },
      });

      return db.prepare('SELECT * FROM payroll_records WHERE id = ?').get(id);
    })();

    return res.json({
      success: true,
      message: `Payroll ${existing.payroll_code} reopened and accrual journal reversed cleanly.`,
      data: reopened,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reopen payroll',
    });
  }
});

// ============================================================================
// 7. SALARY PAYMENTS (FULL & PARTIAL)
// ============================================================================
payrollRouter.get('/payments', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const employeeId = Number(req.query.employee_id) || 0;
    const month = Number(req.query.month) || 0;
    const year = Number(req.query.year) || 0;
    const startDate = String(req.query.start_date || '').trim();
    const endDate = String(req.query.end_date || '').trim();

    let sql = `
      SELECT
        sp.*,
        pr.payroll_code,
        pr.period_label,
        pr.net_salary,
        e.employee_code,
        e.full_name,
        e.department,
        e.designation,
        je.entry_number as journal_entry_number
      FROM salary_payments sp
      INNER JOIN payroll_records pr ON pr.id = sp.payroll_id
      INNER JOIN employees e ON e.id = sp.employee_id
      LEFT JOIN journal_entries je ON je.id = sp.journal_entry_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (employeeId > 0) {
      sql += ` AND sp.employee_id = ?`;
      params.push(employeeId);
    }
    if (month >= 1 && month <= 12) {
      sql += ` AND sp.payroll_month = ?`;
      params.push(month);
    }
    if (year >= 2000) {
      sql += ` AND sp.payroll_year = ?`;
      params.push(year);
    }
    if (startDate) {
      sql += ` AND sp.payment_date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND sp.payment_date <= ?`;
      params.push(endDate);
    }

    sql += ` ORDER BY sp.payment_date DESC, sp.id DESC`;
    const rows = db.prepare(sql).all(...params);
    return res.json({ success: true, data: rows });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch salary payments',
    });
  }
});

payrollRouter.post('/payments', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_payments', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to record salary payments.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const body = req.body || {};

    const payrollId = Number(body.payroll_id);
    const paymentAmount = round2(Number(body.payment_amount) || 0);
    const paymentDate = String(body.payment_date || new Date().toISOString().slice(0, 10)).trim();
    const paymentMode = ['Cash', 'Bank', 'Cheque', 'Online', 'Other'].includes(body.payment_mode)
      ? body.payment_mode
      : 'Cash';
    const financialAccountId = Number(body.financial_account_id) || 0;
    const referenceNumber = String(body.reference_number || '').trim();
    const remarks = String(body.remarks || '').trim();

    if (!payrollId) {
      return res.status(400).json({ success: false, error: 'Please select a finalized payroll record to pay.' });
    }
    if (paymentAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Payment amount must be greater than zero.' });
    }

    const payroll = db
      .prepare(`
        SELECT pr.*, e.employee_code, e.full_name
        FROM payroll_records pr
        INNER JOIN employees e ON e.id = pr.employee_id
        WHERE pr.id = ?
      `)
      .get(payrollId) as Record<string, any> | undefined;

    if (!payroll) {
      return res.status(404).json({ success: false, error: 'Payroll record not found.' });
    }
    if (payroll.status !== 'Finalized') {
      return res.status(400).json({
        success: false,
        error: 'Salary payment can only be recorded against a Finalized payroll record.',
      });
    }

    const currentRemaining = round2(Number(payroll.remaining_amount) || 0);
    if (paymentAmount > currentRemaining + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Payment amount (Rs ${paymentAmount.toLocaleString()}) exceeds remaining payable balance (Rs ${currentRemaining.toLocaleString()}).`,
      });
    }

    let finAccount = db
      .prepare('SELECT id, account_code, account_name FROM accounts WHERE id = ?')
      .get(financialAccountId) as { id: number; account_code: string; account_name: string } | undefined;

    if (!finAccount) {
      const defaultCode = paymentMode === 'Cash' ? 'FIN-1010' : 'FIN-1021';
      finAccount = db
        .prepare('SELECT id, account_code, account_name FROM accounts WHERE account_code = ?')
        .get(defaultCode) as { id: number; account_code: string; account_name: string } | undefined;
    }
    if (!finAccount) {
      return res.status(400).json({ success: false, error: 'Valid Cash or Bank financial account is required.' });
    }

    const savedPayment = db.transaction(() => {
      const sysAccounts = ensurePayrollSystemAccounts(db);
      const maxIdRow = db.prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM salary_payments').get() as {
        max_id: number;
      };
      const paymentCode = `SLP-${new Date().getFullYear()}-${String((maxIdRow?.max_id || 0) + 1).padStart(4, '0')}`;

      const previouslyPaid = round2(Number(payroll.paid_amount) || 0);
      const newPaidAmount = round2(previouslyPaid + paymentAmount);
      const remainingAfter = Math.max(0, round2(Number(payroll.net_salary) - newPaidAmount));
      const newPaymentStatus = remainingAfter <= 0.009 ? 'Paid' : 'Partially Paid';

      // Post Double-Entry Journal: Debit Staff Salary Payable (LIA-2030), Credit Cash/Bank
      const entryNumber = getNextJournalEntryNumber(db);
      const description = `Salary Payment (${paymentCode}) to ${payroll.full_name} (${payroll.employee_code}) for ${payroll.period_label} via ${finAccount!.account_name}`;

      const jeIns = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id,
            description, total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(
          entryNumber,
          paymentDate,
          payrollId,
          description,
          paymentAmount,
          paymentAmount
        );

      const journalEntryId = Number(jeIns.lastInsertRowid);

      const lineStmt = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, 'general', ?, ?, ?)
      `);

      lineStmt.run(
        journalEntryId,
        sysAccounts.salaryPayableAcc.id,
        paymentAmount,
        0,
        `Salary Paid (${paymentCode}) - ${payroll.full_name} (${payroll.period_label})`
      );

      lineStmt.run(
        journalEntryId,
        finAccount!.id,
        0,
        paymentAmount,
        `Salary Disbursed (${paymentCode}) - ${payroll.full_name}`
      );

      recalculateAccountBalance(db, sysAccounts.salaryPayableAcc.id);
      recalculateAccountBalance(db, finAccount!.id);

      const cbVoucherId = createCashBookPaymentEntry(db, {
        voucherDate: paymentDate,
        headAccountId: sysAccounts.salaryPayableAcc.id,
        headAccountCode: sysAccounts.salaryPayableAcc.account_code,
        headAccountName: sysAccounts.salaryPayableAcc.account_name,
        cashBankAccountId: finAccount!.id,
        cashBankAccountCode: finAccount!.account_code,
        cashBankAccountName: finAccount!.account_name,
        paymentAmount,
        narration: description,
        referenceNumber: referenceNumber || paymentCode,
        journalEntryId,
        createdBy: actor.username,
      });

      const spIns = db
        .prepare(`
          INSERT INTO salary_payments (
            payment_code, payroll_id, employee_id, payroll_month, payroll_year,
            payment_date, total_payable_before, previously_paid_amount,
            payment_amount, remaining_balance_after, payment_mode,
            financial_account_id, financial_account_code, financial_account_name,
            reference_number, journal_entry_id, cash_book_voucher_id, remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          paymentCode,
          payrollId,
          payroll.employee_id,
          payroll.payroll_month,
          payroll.payroll_year,
          paymentDate,
          currentRemaining,
          previouslyPaid,
          paymentAmount,
          remainingAfter,
          paymentMode,
          finAccount!.id,
          finAccount!.account_code,
          finAccount!.account_name,
          referenceNumber,
          journalEntryId,
          cbVoucherId,
          remarks,
          actor.username
        );

      const paymentId = Number(spIns.lastInsertRowid);

      db.prepare(`
        UPDATE payroll_records SET
          paid_amount = ?,
          remaining_amount = ?,
          payment_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newPaidAmount, remainingAfter, newPaymentStatus, payrollId);

      appendEmployeeLedgerEntry(db, {
        employeeId: Number(payroll.employee_id),
        transactionDate: paymentDate,
        transactionType: 'Salary_Payment',
        referenceCode: paymentCode,
        referenceId: paymentId,
        description: `Salary Payment (${paymentMode} - ${finAccount!.account_name}) for ${payroll.period_label}`,
        debitAmount: paymentAmount,
        creditAmount: 0,
        journalEntryId,
        createdBy: actor.username,
      });

      logPayrollAudit(db, {
        action: 'SALARY_PAYMENT_POSTED',
        moduleSection: 'Salary Payment',
        recordReference: paymentCode,
        employeeId: Number(payroll.employee_id),
        performedBy: actor.username,
        performedByRole: actor.role,
        details: {
          payroll_code: payroll.payroll_code,
          payment_amount: paymentAmount,
          remaining_balance_after: remainingAfter,
          payment_status: newPaymentStatus,
          financial_account: finAccount!.account_code,
          journal_entry_id: journalEntryId,
        },
      });

      return db.prepare('SELECT * FROM salary_payments WHERE id = ?').get(paymentId);
    })();

    return res.status(201).json({
      success: true,
      message: 'Salary payment posted and accounting ledgers updated.',
      data: savedPayment,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record salary payment',
    });
  }
});

// ============================================================================
// 8. EMPLOYEE ADVANCES & LOANS
// ============================================================================
payrollRouter.get('/advances-loans', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const employeeId = Number(req.query.employee_id) || 0;
    const type = String(req.query.transaction_type || 'all').trim();
    const status = String(req.query.status || 'all').trim();

    let sql = `
      SELECT
        al.*,
        e.employee_code,
        e.full_name,
        e.department,
        e.designation,
        je.entry_number as journal_entry_number
      FROM employee_advances_loans al
      INNER JOIN employees e ON e.id = al.employee_id
      LEFT JOIN journal_entries je ON je.id = al.journal_entry_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (employeeId > 0) {
      sql += ` AND al.employee_id = ?`;
      params.push(employeeId);
    }
    if (type && type !== 'all') {
      sql += ` AND al.transaction_type = ?`;
      params.push(type);
    }
    if (status && status !== 'all') {
      sql += ` AND al.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY al.disbursement_date DESC, al.id DESC`;
    const rows = db.prepare(sql).all(...params) as Array<Record<string, any>>;

    const recoveries = db
      .prepare(`
        SELECT r.*, e.employee_code, e.full_name, al.voucher_code, al.transaction_type
        FROM employee_advance_loan_recoveries r
        INNER JOIN employee_advances_loans al ON al.id = r.advance_loan_id
        INNER JOIN employees e ON e.id = r.employee_id
        ORDER BY r.recovery_date DESC, r.id DESC
      `)
      .all();

    return res.json({
      success: true,
      data: rows,
      recoveries,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch advances & loans',
    });
  }
});

payrollRouter.post('/advances-loans', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_advances_loans', 'create')) {
      return res.status(403).json({ success: false, error: 'Not authorized to disburse employee advances or loans.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const body = req.body || {};

    const employeeId = Number(body.employee_id);
    const transactionType = body.transaction_type === 'Loan' ? 'Loan' : 'Advance';
    const disbursementDate = String(body.disbursement_date || new Date().toISOString().slice(0, 10)).trim();
    const principalAmount = round2(Number(body.principal_amount) || 0);
    const monthlyInstallment = round2(Number(body.monthly_installment) || principalAmount);
    const autoRecover = body.auto_recover_in_payroll !== undefined ? (Number(body.auto_recover_in_payroll) ? 1 : 0) : 1;
    const paymentMode = ['Cash', 'Bank', 'Cheque', 'Online', 'Other'].includes(body.payment_mode)
      ? body.payment_mode
      : 'Cash';
    const financialAccountId = Number(body.financial_account_id) || 0;
    const referenceNumber = String(body.reference_number || '').trim();
    const remarks = String(body.remarks || '').trim();

    if (!employeeId || principalAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Employee and a principal amount greater than zero are required.',
      });
    }

    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Record<string, any> | undefined;
    if (!emp) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    let finAccount = db
      .prepare('SELECT id, account_code, account_name FROM accounts WHERE id = ?')
      .get(financialAccountId) as { id: number; account_code: string; account_name: string } | undefined;

    if (!finAccount) {
      const defaultCode = paymentMode === 'Cash' ? 'FIN-1010' : 'FIN-1021';
      finAccount = db
        .prepare('SELECT id, account_code, account_name FROM accounts WHERE account_code = ?')
        .get(defaultCode) as { id: number; account_code: string; account_name: string } | undefined;
    }
    if (!finAccount) {
      return res.status(400).json({ success: false, error: 'Valid Cash or Bank financial account is required.' });
    }

    const created = db.transaction(() => {
      const sysAccounts = ensurePayrollSystemAccounts(db);
      const maxIdRow = db
        .prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM employee_advances_loans')
        .get() as { max_id: number };
      const prefix = transactionType === 'Loan' ? 'LON' : 'ADV';
      const voucherCode = `${prefix}-${new Date().getFullYear()}-${String((maxIdRow?.max_id || 0) + 1).padStart(4, '0')}`;

      const targetAssetAcc =
        transactionType === 'Loan' ? sysAccounts.loanAssetAcc : sysAccounts.advanceAssetAcc;

      const entryNumber = getNextJournalEntryNumber(db);
      const description = `Employee ${transactionType} Disbursed (${voucherCode}) to ${emp.full_name} (${emp.employee_code}) via ${finAccount!.account_name}`;

      const jeIns = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id,
            description, total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'VOUCHER', NULL, ?, ?, ?, 1, 'posted')
        `)
        .run(entryNumber, disbursementDate, description, principalAmount, principalAmount);

      const journalEntryId = Number(jeIns.lastInsertRowid);

      const lineStmt = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, 'general', ?, ?, ?)
      `);

      // Debit Employee Advance / Loan Asset Account
      lineStmt.run(
        journalEntryId,
        targetAssetAcc.id,
        principalAmount,
        0,
        `${transactionType} to ${emp.full_name} (${voucherCode})`
      );

      // Credit Cash / Bank Account
      lineStmt.run(
        journalEntryId,
        finAccount!.id,
        0,
        principalAmount,
        `${transactionType} Disbursed (${voucherCode}) - ${emp.full_name}`
      );

      recalculateAccountBalance(db, targetAssetAcc.id);
      recalculateAccountBalance(db, finAccount!.id);

      const cbVoucherId = createCashBookPaymentEntry(db, {
        voucherDate: disbursementDate,
        headAccountId: targetAssetAcc.id,
        headAccountCode: targetAssetAcc.account_code,
        headAccountName: targetAssetAcc.account_name,
        cashBankAccountId: finAccount!.id,
        cashBankAccountCode: finAccount!.account_code,
        cashBankAccountName: finAccount!.account_name,
        paymentAmount: principalAmount,
        narration: description,
        referenceNumber: referenceNumber || voucherCode,
        journalEntryId,
        createdBy: actor.username,
      });

      const ins = db
        .prepare(`
          INSERT INTO employee_advances_loans (
            voucher_code, employee_id, transaction_type, disbursement_date,
            principal_amount, monthly_installment, recovered_amount, remaining_balance,
            auto_recover_in_payroll, payment_mode,
            financial_account_id, financial_account_code, financial_account_name,
            reference_number, journal_entry_id, cash_book_voucher_id, status, remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)
        `)
        .run(
          voucherCode,
          employeeId,
          transactionType,
          disbursementDate,
          principalAmount,
          monthlyInstallment,
          principalAmount,
          autoRecover,
          paymentMode,
          finAccount!.id,
          finAccount!.account_code,
          finAccount!.account_name,
          referenceNumber,
          journalEntryId,
          cbVoucherId,
          remarks,
          actor.username
        );

      const recordId = Number(ins.lastInsertRowid);
      db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(recordId, journalEntryId);

      appendEmployeeLedgerEntry(db, {
        employeeId,
        transactionDate: disbursementDate,
        transactionType: transactionType === 'Loan' ? 'Loan_Disbursed' : 'Advance_Disbursed',
        referenceCode: voucherCode,
        referenceId: recordId,
        description: `${transactionType} Disbursed (${finAccount!.account_name}) - Installment: Rs ${monthlyInstallment}/mo`,
        debitAmount: principalAmount,
        creditAmount: 0,
        journalEntryId,
        createdBy: actor.username,
      });

      logPayrollAudit(db, {
        action: `EMPLOYEE_${transactionType.toUpperCase()}_DISBURSED`,
        moduleSection: 'Advances & Loans',
        recordReference: voucherCode,
        employeeId,
        performedBy: actor.username,
        performedByRole: actor.role,
        details: {
          principal_amount: principalAmount,
          monthly_installment: monthlyInstallment,
          financial_account: finAccount!.account_code,
          journal_entry_id: journalEntryId,
        },
      });

      return db.prepare('SELECT * FROM employee_advances_loans WHERE id = ?').get(recordId);
    })();

    return res.status(201).json({
      success: true,
      message: `${transactionType} disbursed and posted to financial accounts.`,
      data: created,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to disburse advance/loan',
    });
  }
});

payrollRouter.post('/advances-loans/:id/recover', (req: Request, res: Response) => {
  try {
    if (!hasPayrollActionPermission(req, 'payroll_advances_loans', 'edit')) {
      return res.status(403).json({ success: false, error: 'Not authorized to record advance/loan recovery.' });
    }
    const db = getDatabase();
    const actor = getActor(req);
    const id = Number(req.params.id);
    const body = req.body || {};

    const existing = db
      .prepare(`
        SELECT al.*, e.employee_code, e.full_name
        FROM employee_advances_loans al
        INNER JOIN employees e ON e.id = al.employee_id
        WHERE al.id = ?
      `)
      .get(id) as Record<string, any> | undefined;

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Advance/Loan record not found.' });
    }
    if (existing.status !== 'Active' || Number(existing.remaining_balance) <= 0) {
      return res.status(400).json({ success: false, error: 'This Advance/Loan is already fully recovered.' });
    }

    const amount = round2(Number(body.amount) || 0);
    const recoveryDate = String(body.recovery_date || new Date().toISOString().slice(0, 10)).trim();
    const financialAccountId = Number(body.financial_account_id) || Number(existing.financial_account_id);
    const remarks = String(body.remarks || 'Direct cash/bank recovery receipt').trim();

    if (amount <= 0 || amount > Number(existing.remaining_balance) + 0.01) {
      return res.status(400).json({
        success: false,
        error: `Recovery amount must be between 1 and Rs ${Number(existing.remaining_balance).toLocaleString()}.`,
      });
    }

    let finAccount = db
      .prepare('SELECT id, account_code, account_name FROM accounts WHERE id = ?')
      .get(financialAccountId) as { id: number; account_code: string; account_name: string } | undefined;
    if (!finAccount) {
      finAccount = db
        .prepare("SELECT id, account_code, account_name FROM accounts WHERE account_code = 'FIN-1010'")
        .get() as { id: number; account_code: string; account_name: string };
    }

    const updated = db.transaction(() => {
      const sysAccounts = ensurePayrollSystemAccounts(db);
      const targetAssetAcc =
        existing.transaction_type === 'Loan' ? sysAccounts.loanAssetAcc : sysAccounts.advanceAssetAcc;

      const entryNumber = getNextJournalEntryNumber(db);
      const description = `Direct ${existing.transaction_type} Recovery (${existing.voucher_code}) from ${existing.full_name}`;

      const jeIns = db
        .prepare(`
          INSERT INTO journal_entries (
            entry_number, entry_date, reference_type, reference_id,
            description, total_debit, total_credit, is_balanced, status
          ) VALUES (?, ?, 'VOUCHER', ?, ?, ?, ?, 1, 'posted')
        `)
        .run(entryNumber, recoveryDate, id, description, amount, amount);

      const journalEntryId = Number(jeIns.lastInsertRowid);

      const lineStmt = db.prepare(`
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, ledger_type, debit_amount, credit_amount, narration
        ) VALUES (?, ?, 'general', ?, ?, ?)
      `);

      // Debit Cash / Bank Account
      lineStmt.run(
        journalEntryId,
        finAccount!.id,
        amount,
        0,
        description
      );

      // Credit Employee Advance / Loan Asset Account
      lineStmt.run(
        journalEntryId,
        targetAssetAcc.id,
        0,
        amount,
        description
      );

      recalculateAccountBalance(db, finAccount!.id);
      recalculateAccountBalance(db, targetAssetAcc.id);

      const newRecovered = round2(Number(existing.recovered_amount) + amount);
      const newRemaining = Math.max(0, round2(Number(existing.principal_amount) - newRecovered));
      const newStatus = newRemaining <= 0.009 ? 'Completed' : 'Active';

      db.prepare(`
        UPDATE employee_advances_loans
        SET recovered_amount = ?, remaining_balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newRecovered, newRemaining, newStatus, id);

      const dObj = new Date(`${recoveryDate}T00:00:00Z`);
      db.prepare(`
        INSERT INTO employee_advance_loan_recoveries (
          advance_loan_id, employee_id, payroll_id, recovery_date, recovery_month, recovery_year,
          amount, recovery_method, financial_account_id, journal_entry_id, remarks, created_by
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'Direct_Receipt', ?, ?, ?, ?)
      `).run(
        id,
        existing.employee_id,
        recoveryDate,
        dObj.getUTCMonth() + 1,
        dObj.getUTCFullYear(),
        amount,
        finAccount!.id,
        journalEntryId,
        remarks,
        actor.username
      );

      appendEmployeeLedgerEntry(db, {
        employeeId: Number(existing.employee_id),
        transactionDate: recoveryDate,
        transactionType: existing.transaction_type === 'Loan' ? 'Loan_Recovered' : 'Advance_Recovered',
        referenceCode: existing.voucher_code,
        referenceId: id,
        description: `Direct ${existing.transaction_type} Recovery Receipt (${finAccount!.account_name})`,
        debitAmount: 0,
        creditAmount: amount,
        journalEntryId,
        createdBy: actor.username,
      });

      return db.prepare('SELECT * FROM employee_advances_loans WHERE id = ?').get(id);
    })();

    return res.json({
      success: true,
      message: 'Recovery installment recorded and ledger updated.',
      data: updated,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record recovery',
    });
  }
});

// ============================================================================
// 9. SALARY SLIP GENERATION
// ============================================================================
payrollRouter.get('/salary-slips/:payrollId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const payrollId = Number(req.params.payrollId);

    const payroll = db
      .prepare(`
        SELECT
          pr.*,
          e.employee_code,
          e.full_name,
          e.father_name,
          e.cnic,
          e.phone,
          e.address,
          e.department,
          e.designation,
          e.joining_date,
          e.payment_method,
          e.bank_name,
          e.bank_account_title,
          e.bank_account_number,
          je.entry_number as journal_entry_number
        FROM payroll_records pr
        INNER JOIN employees e ON e.id = pr.employee_id
        LEFT JOIN journal_entries je ON je.id = pr.journal_entry_id
        WHERE pr.id = ?
      `)
      .get(payrollId) as Record<string, any> | undefined;

    if (!payroll) {
      return res.status(404).json({ success: false, error: 'Salary slip / payroll record not found.' });
    }

    const payments = db
      .prepare('SELECT * FROM salary_payments WHERE payroll_id = ? ORDER BY payment_date ASC, id ASC')
      .all(payrollId);

    const company = db.prepare('SELECT * FROM company_settings ORDER BY id ASC LIMIT 1').get() || {
      store_name: 'Abrar Medical Store',
      address: 'Main Commercial Market, Lahore',
      phone: '+92 42 35789000',
    };

    const activeBalances = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'Advance' AND status = 'Active' THEN remaining_balance ELSE 0 END), 0) as remaining_advance_balance,
          COALESCE(SUM(CASE WHEN transaction_type = 'Loan' AND status = 'Active' THEN remaining_balance ELSE 0 END), 0) as remaining_loan_balance
        FROM employee_advances_loans
        WHERE employee_id = ?
      `)
      .get(payroll.employee_id);

    return res.json({
      success: true,
      data: {
        company,
        payroll,
        payments,
        active_balances: activeBalances,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load salary slip',
    });
  }
});

// ============================================================================
// 10. ALL 25 PAYROLL & HR REPORTS
// ============================================================================
payrollRouter.get('/reports/:reportKey', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const reportKey = String(req.params.reportKey || '').trim();
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    const employeeId = Number(req.query.employee_id) || 0;
    const department = String(req.query.department || 'all').trim();
    const status = String(req.query.status || 'all').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const startDate = String(req.query.start_date || `${year}-${String(month).padStart(2, '0')}-01`).trim();
    const endDate = String(
      req.query.end_date || `${year}-${String(month).padStart(2, '0')}-${String(getDaysInMonth(month, year)).padStart(2, '0')}`
    ).trim();

    let title = '';
    let category = '';
    let columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }> = [];
    let rows: Array<Record<string, any>> = [];
    let summary: Record<string, any> = {};

    const filterBySearch = (list: Array<Record<string, any>>) => {
      if (!search) return list;
      return list.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(search))
      );
    };

    switch (reportKey) {
      // ----------------- EMPLOYEE REPORTS (1 - 5) -----------------
      case 'employee-list': {
        title = '1. Employee Master List Report';
        category = 'Employee Reports';
        columns = [
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'father_name', label: 'Father Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'department', label: 'Department' },
          { key: 'phone', label: 'Mobile' },
          { key: 'cnic', label: 'CNIC' },
          { key: 'joining_date', label: 'Joining Date', align: 'center' },
          { key: 'payment_method', label: 'Pay Mode', align: 'center' },
          { key: 'basic_salary', label: 'Basic Salary', align: 'right' },
          { key: 'employment_status', label: 'Status', align: 'center' },
        ];
        let sql = `SELECT * FROM employees WHERE 1=1`;
        const p: unknown[] = [];
        if (department !== 'all') {
          sql += ` AND department = ?`;
          p.push(department);
        }
        if (status !== 'all') {
          sql += ` AND employment_status = ?`;
          p.push(status);
        }
        if (employeeId > 0) {
          sql += ` AND id = ?`;
          p.push(employeeId);
        }
        sql += ` ORDER BY id ASC`;
        rows = filterBySearch(db.prepare(sql).all(...p) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          total_basic_salary: round2(rows.reduce((s, r) => s + (Number(r.basic_salary) || 0), 0)),
        };
        break;
      }

      case 'active-inactive-employees': {
        title = '2. Active / Inactive Employees Report';
        category = 'Employee Reports';
        columns = [
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'joining_date', label: 'Joining Date', align: 'center' },
          { key: 'leaving_date', label: 'Leaving Date', align: 'center' },
          { key: 'employment_status', label: 'Status', align: 'center' },
          { key: 'basic_salary', label: 'Basic Salary', align: 'right' },
        ];
        let sql = `SELECT * FROM employees WHERE 1=1`;
        const p: unknown[] = [];
        if (status !== 'all') {
          sql += ` AND employment_status = ?`;
          p.push(status);
        }
        if (department !== 'all') {
          sql += ` AND department = ?`;
          p.push(department);
        }
        sql += ` ORDER BY employment_status ASC, id ASC`;
        rows = filterBySearch(db.prepare(sql).all(...p) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          active_count: rows.filter((r) => r.employment_status === 'Active').length,
          inactive_count: rows.filter((r) => r.employment_status === 'Inactive').length,
          total_basic_salary: round2(rows.reduce((s, r) => s + (Number(r.basic_salary) || 0), 0)),
        };
        break;
      }

      case 'department-wise-employees': {
        title = '3. Department-Wise Employees Report';
        category = 'Employee Reports';
        columns = [
          { key: 'department', label: 'Department' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'phone', label: 'Mobile' },
          { key: 'employment_status', label: 'Status', align: 'center' },
          { key: 'basic_salary', label: 'Basic Salary', align: 'right' },
        ];
        let sql = `SELECT * FROM employees WHERE 1=1`;
        const p: unknown[] = [];
        if (department !== 'all') {
          sql += ` AND department = ?`;
          p.push(department);
        }
        sql += ` ORDER BY department ASC, id ASC`;
        rows = filterBySearch(db.prepare(sql).all(...p) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          total_basic_salary: round2(rows.reduce((s, r) => s + (Number(r.basic_salary) || 0), 0)),
        };
        break;
      }

      case 'employee-joining': {
        title = '4. Employee Joining Report';
        category = 'Employee Reports';
        columns = [
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'father_name', label: 'Father Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'joining_date', label: 'Joining Date', align: 'center' },
          { key: 'basic_salary', label: 'Starting Basic Salary', align: 'right' },
          { key: 'employment_status', label: 'Current Status', align: 'center' },
        ];
        let sql = `SELECT * FROM employees WHERE 1=1`;
        const p: unknown[] = [];
        if (req.query.start_date) {
          sql += ` AND joining_date >= ?`;
          p.push(startDate);
        }
        if (req.query.end_date) {
          sql += ` AND joining_date <= ?`;
          p.push(endDate);
        }
        sql += ` ORDER BY joining_date DESC, id DESC`;
        rows = filterBySearch(db.prepare(sql).all(...p) as Array<Record<string, any>>);
        summary = {
          total_joined: rows.length,
          total_basic_salary: round2(rows.reduce((s, r) => s + (Number(r.basic_salary) || 0), 0)),
        };
        break;
      }

      case 'employee-leaving': {
        title = '5. Employee Leaving / Deactivation Report';
        category = 'Employee Reports';
        columns = [
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'joining_date', label: 'Joining Date', align: 'center' },
          { key: 'leaving_date', label: 'Leaving Date', align: 'center' },
          { key: 'employment_status', label: 'Status', align: 'center' },
          { key: 'remarks', label: 'Remarks' },
        ];
        const sql = `SELECT * FROM employees WHERE employment_status = 'Inactive' OR (leaving_date IS NOT NULL AND leaving_date != '') ORDER BY leaving_date DESC, id DESC`;
        rows = filterBySearch(db.prepare(sql).all() as Array<Record<string, any>>);
        summary = { total_left: rows.length };
        break;
      }

      // ----------------- ATTENDANCE REPORTS (6 - 12) -----------------
      case 'daily-attendance': {
        title = '6. Daily Attendance Report';
        category = 'Attendance Reports';
        columns = [
          { key: 'attendance_date', label: 'Date', align: 'center' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'status', label: 'Status', align: 'center' },
          { key: 'check_in_time', label: 'Check-In', align: 'center' },
          { key: 'check_out_time', label: 'Check-Out', align: 'center' },
          { key: 'late_minutes', label: 'Late (Mins)', align: 'right' },
          { key: 'overtime_hours', label: 'OT (Hrs)', align: 'right' },
          { key: 'remarks', label: 'Remarks' },
        ];
        let sql = `
          SELECT a.*, e.employee_code, e.full_name, e.department, e.designation
          FROM employee_attendance a
          INNER JOIN employees e ON e.id = a.employee_id
          WHERE a.attendance_date >= ? AND a.attendance_date <= ?
        `;
        const p: unknown[] = [startDate, endDate];
        if (employeeId > 0) {
          sql += ` AND a.employee_id = ?`;
          p.push(employeeId);
        }
        if (department !== 'all') {
          sql += ` AND e.department = ?`;
          p.push(department);
        }
        sql += ` ORDER BY a.attendance_date DESC, e.id ASC`;
        rows = filterBySearch(db.prepare(sql).all(...p) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          present_count: rows.filter((r) => r.status === 'Present').length,
          absent_count: rows.filter((r) => r.status === 'Absent').length,
          leave_count: rows.filter((r) => r.status === 'Leave').length,
          total_overtime_hours: round2(rows.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0)),
        };
        break;
      }

      case 'monthly-attendance':
      case 'attendance-summary': {
        title =
          reportKey === 'monthly-attendance'
            ? `7. Monthly Attendance Report (${MONTH_NAMES[month - 1]} ${year})`
            : `12. Attendance Summary Report (${MONTH_NAMES[month - 1]} ${year})`;
        category = 'Attendance Reports';
        columns = [
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'present_days', label: 'Present', align: 'right' },
          { key: 'half_days', label: 'Half Days', align: 'right' },
          { key: 'absent_days', label: 'Absent', align: 'right' },
          { key: 'leave_days', label: 'Leaves', align: 'right' },
          { key: 'holidays', label: 'Holidays', align: 'right' },
          { key: 'late_count', label: 'Late Days', align: 'right' },
          { key: 'overtime_hours', label: 'Overtime (Hrs)', align: 'right' },
        ];
        const mPrefix = `${year}-${String(month).padStart(2, '0')}-%`;
        const sql = `
          SELECT
            e.id as employee_id,
            e.employee_code,
            e.full_name,
            e.department,
            e.designation,
            COALESCE(SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END), 0) as present_days,
            COALESCE(SUM(CASE WHEN a.status = 'Half Day' THEN 1 ELSE 0 END), 0) as half_days,
            COALESCE(SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END), 0) as absent_days,
            COALESCE(SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END), 0) as leave_days,
            COALESCE(SUM(CASE WHEN a.status = 'Holiday' THEN 1 ELSE 0 END), 0) as holidays,
            COALESCE(SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END), 0) as late_count,
            COALESCE(SUM(a.overtime_hours), 0) as overtime_hours
          FROM employees e
          LEFT JOIN employee_attendance a ON a.employee_id = e.id AND a.attendance_date LIKE ?
          WHERE (? = 0 OR e.id = ?) AND (? = 'all' OR e.department = ?)
          GROUP BY e.id
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(mPrefix, employeeId, employeeId, department, department) as Array<Record<string, any>>
        );
        summary = {
          total_employees: rows.length,
          total_present: rows.reduce((s, r) => s + (Number(r.present_days) || 0), 0),
          total_absent: rows.reduce((s, r) => s + (Number(r.absent_days) || 0), 0),
          total_overtime_hours: round2(rows.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0)),
        };
        break;
      }

      case 'late-arrival': {
        title = '8. Late Arrival Report';
        category = 'Attendance Reports';
        columns = [
          { key: 'attendance_date', label: 'Date', align: 'center' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'check_in_time', label: 'Check-In Time', align: 'center' },
          { key: 'late_minutes', label: 'Late Minutes', align: 'right' },
          { key: 'remarks', label: 'Remarks' },
        ];
        const sql = `
          SELECT a.*, e.employee_code, e.full_name, e.department
          FROM employee_attendance a
          INNER JOIN employees e ON e.id = a.employee_id
          WHERE (a.is_late = 1 OR a.late_minutes > 0)
            AND a.attendance_date >= ? AND a.attendance_date <= ?
            AND (? = 0 OR a.employee_id = ?)
          ORDER BY a.attendance_date DESC, a.late_minutes DESC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(startDate, endDate, employeeId, employeeId) as Array<Record<string, any>>
        );
        summary = {
          total_late_instances: rows.length,
          total_late_minutes: rows.reduce((s, r) => s + (Number(r.late_minutes) || 0), 0),
        };
        break;
      }

      case 'absentee-report': {
        title = '9. Absentee Report';
        category = 'Attendance Reports';
        columns = [
          { key: 'attendance_date', label: 'Date', align: 'center' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'status', label: 'Status', align: 'center' },
          { key: 'remarks', label: 'Remarks' },
        ];
        const sql = `
          SELECT a.*, e.employee_code, e.full_name, e.department, e.designation
          FROM employee_attendance a
          INNER JOIN employees e ON e.id = a.employee_id
          WHERE a.status IN ('Absent', 'Half Day')
            AND a.attendance_date >= ? AND a.attendance_date <= ?
            AND (? = 0 OR a.employee_id = ?)
          ORDER BY a.attendance_date DESC, e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(startDate, endDate, employeeId, employeeId) as Array<Record<string, any>>
        );
        summary = {
          total_absent_records: rows.length,
        };
        break;
      }

      case 'overtime-report': {
        title = '10. Overtime Report';
        category = 'Attendance Reports';
        columns = [
          { key: 'attendance_date', label: 'Date', align: 'center' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'check_out_time', label: 'Check-Out', align: 'center' },
          { key: 'overtime_hours', label: 'Overtime Hours', align: 'right' },
          { key: 'remarks', label: 'Remarks' },
        ];
        const sql = `
          SELECT a.*, e.employee_code, e.full_name, e.department
          FROM employee_attendance a
          INNER JOIN employees e ON e.id = a.employee_id
          WHERE a.overtime_hours > 0
            AND a.attendance_date >= ? AND a.attendance_date <= ?
            AND (? = 0 OR a.employee_id = ?)
          ORDER BY a.attendance_date DESC, a.overtime_hours DESC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(startDate, endDate, employeeId, employeeId) as Array<Record<string, any>>
        );
        summary = {
          total_overtime_entries: rows.length,
          total_overtime_hours: round2(rows.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0)),
        };
        break;
      }

      case 'leave-history': {
        title = '11. Employee Leave History Report';
        category = 'Attendance Reports';
        columns = [
          { key: 'leave_code', label: 'Leave Code' },
          { key: 'employee_code', label: 'Employee ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'leave_type', label: 'Leave Type' },
          { key: 'start_date', label: 'Start Date', align: 'center' },
          { key: 'end_date', label: 'End Date', align: 'center' },
          { key: 'total_days', label: 'Total Days', align: 'right' },
          { key: 'status', label: 'Status', align: 'center' },
          { key: 'reason', label: 'Reason' },
        ];
        const sql = `
          SELECT l.*, e.employee_code, e.full_name, e.department
          FROM employee_leaves l
          INNER JOIN employees e ON e.id = l.employee_id
          WHERE (? = 0 OR l.employee_id = ?)
          ORDER BY l.start_date DESC, l.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_applications: rows.length,
          total_days: round2(rows.reduce((s, r) => s + (Number(r.total_days) || 0), 0)),
        };
        break;
      }

      // ----------------- PAYROLL REPORTS (13 - 25) -----------------
      case 'monthly-payroll-summary': {
        title = `13. Monthly Payroll Summary Report (${MONTH_NAMES[month - 1]} ${year})`;
        category = 'Payroll Reports';
        columns = [
          { key: 'payroll_code', label: 'Payroll Code' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'present_days', label: 'Present', align: 'right' },
          { key: 'basic_salary', label: 'Basic Salary', align: 'right' },
          { key: 'gross_salary', label: 'Gross Salary', align: 'right' },
          { key: 'total_deductions', label: 'Deductions', align: 'right' },
          { key: 'net_salary', label: 'Net Salary', align: 'right' },
          { key: 'paid_amount', label: 'Paid', align: 'right' },
          { key: 'remaining_amount', label: 'Payable', align: 'right' },
          { key: 'status', label: 'Status', align: 'center' },
          { key: 'payment_status', label: 'Pay Status', align: 'center' },
        ];
        const sql = `
          SELECT pr.*, e.employee_code, e.full_name, e.department, e.designation
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE pr.payroll_month = ? AND pr.payroll_year = ?
            AND (? = 0 OR pr.employee_id = ?)
            AND (? = 'all' OR e.department = ?)
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(month, year, employeeId, employeeId, department, department) as Array<Record<string, any>>
        );
        summary = {
          total_employees: rows.length,
          total_gross_salary: round2(rows.reduce((s, r) => s + (Number(r.gross_salary) || 0), 0)),
          total_deductions: round2(rows.reduce((s, r) => s + (Number(r.total_deductions) || 0), 0)),
          total_net_salary: round2(rows.reduce((s, r) => s + (Number(r.net_salary) || 0), 0)),
          total_paid: round2(rows.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)),
          total_remaining: round2(rows.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)),
        };
        break;
      }

      case 'employee-wise-salary': {
        title = '14. Employee-Wise Salary Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'period_label', label: 'Period' },
          { key: 'payroll_code', label: 'Payroll Code' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'basic_salary', label: 'Basic', align: 'right' },
          { key: 'gross_salary', label: 'Gross', align: 'right' },
          { key: 'total_deductions', label: 'Deductions', align: 'right' },
          { key: 'net_salary', label: 'Net Salary', align: 'right' },
          { key: 'paid_amount', label: 'Paid', align: 'right' },
          { key: 'remaining_amount', label: 'Balance', align: 'right' },
          { key: 'payment_status', label: 'Pay Status', align: 'center' },
        ];
        const sql = `
          SELECT pr.*, e.employee_code, e.full_name, e.department
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE (? = 0 OR pr.employee_id = ?)
            AND (? = 'all' OR e.department = ?)
          ORDER BY pr.payroll_year DESC, pr.payroll_month DESC, e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(employeeId, employeeId, department, department) as Array<Record<string, any>>
        );
        summary = {
          total_records: rows.length,
          total_net_salary: round2(rows.reduce((s, r) => s + (Number(r.net_salary) || 0), 0)),
          total_paid: round2(rows.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)),
          total_remaining: round2(rows.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)),
        };
        break;
      }

      case 'salary-payment-register': {
        title = '15. Salary Payment Register';
        category = 'Payroll Reports';
        columns = [
          { key: 'payment_code', label: 'Payment Voucher' },
          { key: 'payment_date', label: 'Payment Date', align: 'center' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'period_label', label: 'Payroll Period' },
          { key: 'payment_mode', label: 'Mode', align: 'center' },
          { key: 'financial_account_name', label: 'Financial Account' },
          { key: 'payment_amount', label: 'Amount Paid', align: 'right' },
          { key: 'remaining_balance_after', label: 'Remaining After', align: 'right' },
        ];
        const sql = `
          SELECT sp.*, pr.period_label, e.employee_code, e.full_name, e.department
          FROM salary_payments sp
          INNER JOIN payroll_records pr ON pr.id = sp.payroll_id
          INNER JOIN employees e ON e.id = sp.employee_id
          WHERE (? = 0 OR sp.employee_id = ?)
          ORDER BY sp.payment_date DESC, sp.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_payments: rows.length,
          total_amount_paid: round2(rows.reduce((s, r) => s + (Number(r.payment_amount) || 0), 0)),
        };
        break;
      }

      case 'basic-salary-report': {
        title = '16. Basic Salary & Structure Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'basic_salary', label: 'Basic Salary', align: 'right' },
          { key: 'house_allowance', label: 'House Allow.', align: 'right' },
          { key: 'medical_allowance', label: 'Medical Allow.', align: 'right' },
          { key: 'conveyance_allowance', label: 'Conveyance', align: 'right' },
          { key: 'other_allowance', label: 'Other Allow.', align: 'right' },
          { key: 'employment_status', label: 'Status', align: 'center' },
        ];
        const sql = `
          SELECT
            e.employee_code, e.full_name, e.department, e.designation, e.employment_status,
            COALESCE(s.basic_salary, e.basic_salary, 0) as basic_salary,
            COALESCE(s.house_allowance, 0) as house_allowance,
            COALESCE(s.medical_allowance, 0) as medical_allowance,
            COALESCE(s.conveyance_allowance, 0) as conveyance_allowance,
            COALESCE(s.other_allowance, 0) as other_allowance
          FROM employees e
          LEFT JOIN employee_salary_structures s ON s.employee_id = e.id
          WHERE (? = 0 OR e.id = ?) AND (? = 'all' OR e.department = ?)
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(employeeId, employeeId, department, department) as Array<Record<string, any>>
        );
        summary = {
          total_employees: rows.length,
          total_basic_salary: round2(rows.reduce((s, r) => s + (Number(r.basic_salary) || 0), 0)),
        };
        break;
      }

      case 'allowances-report': {
        title = `17. Allowances & Overtime Report (${MONTH_NAMES[month - 1]} ${year})`;
        category = 'Payroll Reports';
        columns = [
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'period_label', label: 'Period' },
          { key: 'house_allowance', label: 'House Allow.', align: 'right' },
          { key: 'medical_allowance', label: 'Medical Allow.', align: 'right' },
          { key: 'conveyance_allowance', label: 'Conveyance', align: 'right' },
          { key: 'other_allowances', label: 'Other Allow.', align: 'right' },
          { key: 'overtime_amount', label: 'Overtime Pay', align: 'right' },
          { key: 'bonus_amount', label: 'Bonus', align: 'right' },
          { key: 'total_allowances', label: 'Total Additions', align: 'right' },
        ];
        const sql = `
          SELECT
            pr.*,
            e.employee_code, e.full_name, e.department,
            (pr.house_allowance + pr.medical_allowance + pr.conveyance_allowance + pr.other_allowances + pr.overtime_amount + pr.bonus_amount) as total_allowances
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE pr.payroll_month = ? AND pr.payroll_year = ?
            AND (? = 0 OR pr.employee_id = ?)
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(db.prepare(sql).all(month, year, employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          total_allowances: round2(rows.reduce((s, r) => s + (Number(r.total_allowances) || 0), 0)),
        };
        break;
      }

      case 'deductions-report': {
        title = `18. Salary Deductions Report (${MONTH_NAMES[month - 1]} ${year})`;
        category = 'Payroll Reports';
        columns = [
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'period_label', label: 'Period' },
          { key: 'absent_deduction', label: 'Absent Ded.', align: 'right' },
          { key: 'late_deduction', label: 'Late Ded.', align: 'right' },
          { key: 'unpaid_leave_deduction', label: 'Unpaid Leave Ded.', align: 'right' },
          { key: 'advance_recovery', label: 'Advance Rec.', align: 'right' },
          { key: 'loan_recovery', label: 'Loan Rec.', align: 'right' },
          { key: 'other_deductions', label: 'Other Ded.', align: 'right' },
          { key: 'total_deductions', label: 'Total Deductions', align: 'right' },
        ];
        const sql = `
          SELECT pr.*, e.employee_code, e.full_name, e.department
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE pr.payroll_month = ? AND pr.payroll_year = ?
            AND (? = 0 OR pr.employee_id = ?)
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(db.prepare(sql).all(month, year, employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_records: rows.length,
          total_deductions: round2(rows.reduce((s, r) => s + (Number(r.total_deductions) || 0), 0)),
        };
        break;
      }

      case 'unpaid-salary-report': {
        title = '19. Unpaid / Partially Paid Salary Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'payroll_code', label: 'Payroll Code' },
          { key: 'period_label', label: 'Period' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'net_salary', label: 'Net Salary', align: 'right' },
          { key: 'paid_amount', label: 'Paid Amount', align: 'right' },
          { key: 'remaining_amount', label: 'Unpaid Balance', align: 'right' },
          { key: 'payment_status', label: 'Pay Status', align: 'center' },
          { key: 'status', label: 'Payroll Status', align: 'center' },
        ];
        const sql = `
          SELECT pr.*, e.employee_code, e.full_name, e.department
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE pr.remaining_amount > 0
            AND (? = 0 OR pr.employee_id = ?)
          ORDER BY pr.payroll_year DESC, pr.payroll_month DESC, e.id ASC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_unpaid_records: rows.length,
          total_unpaid_amount: round2(rows.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0)),
        };
        break;
      }

      case 'paid-salary-report': {
        title = '20. Paid Salary Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'payroll_code', label: 'Payroll Code' },
          { key: 'period_label', label: 'Period' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'net_salary', label: 'Net Salary', align: 'right' },
          { key: 'paid_amount', label: 'Paid Amount', align: 'right' },
          { key: 'remaining_amount', label: 'Remaining', align: 'right' },
          { key: 'payment_status', label: 'Pay Status', align: 'center' },
        ];
        const sql = `
          SELECT pr.*, e.employee_code, e.full_name, e.department
          FROM payroll_records pr
          INNER JOIN employees e ON e.id = pr.employee_id
          WHERE pr.paid_amount > 0
            AND (? = 0 OR pr.employee_id = ?)
          ORDER BY pr.payroll_year DESC, pr.payroll_month DESC, e.id ASC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_paid_records: rows.length,
          total_paid_amount: round2(rows.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)),
        };
        break;
      }

      case 'advance-salary-report': {
        title = '21. Employee Salary Advance Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'voucher_code', label: 'Advance Code' },
          { key: 'disbursement_date', label: 'Date', align: 'center' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'financial_account_name', label: 'Paid From' },
          { key: 'principal_amount', label: 'Advance Amount', align: 'right' },
          { key: 'recovered_amount', label: 'Recovered', align: 'right' },
          { key: 'remaining_balance', label: 'Remaining', align: 'right' },
          { key: 'status', label: 'Status', align: 'center' },
        ];
        const sql = `
          SELECT al.*, e.employee_code, e.full_name, e.department
          FROM employee_advances_loans al
          INNER JOIN employees e ON e.id = al.employee_id
          WHERE al.transaction_type = 'Advance'
            AND (? = 0 OR al.employee_id = ?)
          ORDER BY al.disbursement_date DESC, al.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_advances: rows.length,
          total_disbursed: round2(rows.reduce((s, r) => s + (Number(r.principal_amount) || 0), 0)),
          total_recovered: round2(rows.reduce((s, r) => s + (Number(r.recovered_amount) || 0), 0)),
          total_outstanding: round2(rows.reduce((s, r) => s + (Number(r.remaining_balance) || 0), 0)),
        };
        break;
      }

      case 'loan-recovery-report': {
        title = '22. Employee Loan & Recovery Report';
        category = 'Payroll Reports';
        columns = [
          { key: 'voucher_code', label: 'Loan Code' },
          { key: 'disbursement_date', label: 'Disbursed Date', align: 'center' },
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'principal_amount', label: 'Loan Amount', align: 'right' },
          { key: 'monthly_installment', label: 'Monthly Inst.', align: 'right' },
          { key: 'recovered_amount', label: 'Recovered', align: 'right' },
          { key: 'remaining_balance', label: 'Outstanding', align: 'right' },
          { key: 'status', label: 'Status', align: 'center' },
        ];
        const sql = `
          SELECT al.*, e.employee_code, e.full_name, e.department
          FROM employee_advances_loans al
          INNER JOIN employees e ON e.id = al.employee_id
          WHERE al.transaction_type = 'Loan'
            AND (? = 0 OR al.employee_id = ?)
          ORDER BY al.disbursement_date DESC, al.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all(employeeId, employeeId) as Array<Record<string, any>>);
        summary = {
          total_loans: rows.length,
          total_loan_disbursed: round2(rows.reduce((s, r) => s + (Number(r.principal_amount) || 0), 0)),
          total_loan_recovered: round2(rows.reduce((s, r) => s + (Number(r.recovered_amount) || 0), 0)),
          total_loan_outstanding: round2(rows.reduce((s, r) => s + (Number(r.remaining_balance) || 0), 0)),
        };
        break;
      }

      case 'annual-salary-statement': {
        title = `23. Annual Salary Statement (${year})`;
        category = 'Payroll Reports';
        columns = [
          { key: 'employee_code', label: 'Emp ID' },
          { key: 'full_name', label: 'Employee Name' },
          { key: 'department', label: 'Department' },
          { key: 'months_processed', label: 'Months', align: 'right' },
          { key: 'annual_basic', label: 'Basic Total', align: 'right' },
          { key: 'annual_gross', label: 'Gross Total', align: 'right' },
          { key: 'annual_deductions', label: 'Deductions Total', align: 'right' },
          { key: 'annual_net', label: 'Net Salary Total', align: 'right' },
          { key: 'annual_paid', label: 'Total Paid', align: 'right' },
          { key: 'annual_payable', label: 'Remaining Payable', align: 'right' },
        ];
        const sql = `
          SELECT
            e.employee_code,
            e.full_name,
            e.department,
            COUNT(pr.id) as months_processed,
            COALESCE(SUM(pr.basic_salary), 0) as annual_basic,
            COALESCE(SUM(pr.gross_salary), 0) as annual_gross,
            COALESCE(SUM(pr.total_deductions), 0) as annual_deductions,
            COALESCE(SUM(pr.net_salary), 0) as annual_net,
            COALESCE(SUM(pr.paid_amount), 0) as annual_paid,
            COALESCE(SUM(pr.remaining_amount), 0) as annual_payable
          FROM employees e
          LEFT JOIN payroll_records pr ON pr.employee_id = e.id AND pr.payroll_year = ?
          WHERE (? = 0 OR e.id = ?) AND (? = 'all' OR e.department = ?)
          GROUP BY e.id
          ORDER BY e.id ASC
        `;
        rows = filterBySearch(
          db.prepare(sql).all(year, employeeId, employeeId, department, department) as Array<Record<string, any>>
        );
        summary = {
          year,
          total_annual_gross: round2(rows.reduce((s, r) => s + (Number(r.annual_gross) || 0), 0)),
          total_annual_net: round2(rows.reduce((s, r) => s + (Number(r.annual_net) || 0), 0)),
          total_annual_paid: round2(rows.reduce((s, r) => s + (Number(r.annual_paid) || 0), 0)),
          total_annual_payable: round2(rows.reduce((s, r) => s + (Number(r.annual_payable) || 0), 0)),
        };
        break;
      }

      case 'payroll-expense-report': {
        title = '24. Payroll Expense Accounting Report (EXP-5030)';
        category = 'Payroll Reports';
        columns = [
          { key: 'entry_date', label: 'Journal Date', align: 'center' },
          { key: 'entry_number', label: 'Journal No' },
          { key: 'reference_number', label: 'Account Code' },
          { key: 'description', label: 'Particulars' },
          { key: 'debit_amount', label: 'Salary Expense (Dr)', align: 'right' },
          { key: 'credit_amount', label: 'Reversal (Cr)', align: 'right' },
        ];
        const sql = `
          SELECT
            je.entry_date,
            je.entry_number,
            a.account_code as reference_number,
            COALESCE(jl.narration, je.description, '') as description,
            jl.debit_amount,
            jl.credit_amount
          FROM journal_entry_lines jl
          INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
          INNER JOIN accounts a ON a.id = jl.account_id
          WHERE a.account_code = 'EXP-5030' AND je.status = 'posted'
          ORDER BY je.entry_date DESC, je.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all() as Array<Record<string, any>>);
        summary = {
          total_entries: rows.length,
          total_salary_expense: round2(
            rows.reduce((s, r) => s + (Number(r.debit_amount) || 0) - (Number(r.credit_amount) || 0), 0)
          ),
        };
        break;
      }

      case 'salary-payable-report': {
        title = '25. Staff Salary Payable Ledger Report (LIA-2030)';
        category = 'Payroll Reports';
        columns = [
          { key: 'entry_date', label: 'Date', align: 'center' },
          { key: 'entry_number', label: 'Journal No' },
          { key: 'reference_number', label: 'Account Code' },
          { key: 'description', label: 'Description' },
          { key: 'debit_amount', label: 'Paid / Debited (Dr)', align: 'right' },
          { key: 'credit_amount', label: 'Accrued Payable (Cr)', align: 'right' },
        ];
        const sql = `
          SELECT
            je.entry_date,
            je.entry_number,
            a.account_code as reference_number,
            COALESCE(jl.narration, je.description, '') as description,
            jl.debit_amount,
            jl.credit_amount
          FROM journal_entry_lines jl
          INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
          INNER JOIN accounts a ON a.id = jl.account_id
          WHERE a.account_code = 'LIA-2030' AND je.status = 'posted'
          ORDER BY je.entry_date DESC, je.id DESC
        `;
        rows = filterBySearch(db.prepare(sql).all() as Array<Record<string, any>>);
        const totalCr = round2(rows.reduce((s, r) => s + (Number(r.credit_amount) || 0), 0));
        const totalDr = round2(rows.reduce((s, r) => s + (Number(r.debit_amount) || 0), 0));
        summary = {
          total_accrued_credit: totalCr,
          total_paid_debit: totalDr,
          net_salary_payable: round2(totalCr - totalDr),
        };
        break;
      }

      default:
        return res.status(404).json({ success: false, error: `Unknown report key: ${reportKey}` });
    }

    return res.json({
      success: true,
      data: {
        report_key: reportKey,
        title,
        category,
        columns,
        rows,
        summary,
        filters: { month, year, employee_id: employeeId, department, status, start_date: startDate, end_date: endDate },
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate payroll report',
    });
  }
});
