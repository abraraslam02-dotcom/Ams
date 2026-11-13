import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { authFetch } from '../../services/api';
import {
  Users,
  UserPlus,
  CalendarCheck,
  CalendarDays,
  FileSpreadsheet,
  Wallet,
  Banknote,
  HandCoins,
  Receipt,
  BarChart3,
  LayoutDashboard,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Printer,
  Download,
  Edit3,
  Lock,
  Unlock,
  Plus,
  Eye,
  Building2,
  Clock,
  Check,
  X,
  ArrowUpDown,
} from 'lucide-react';

export type PayrollTabId =
  | 'payroll-dashboard'
  | 'payroll-employees'
  | 'payroll-attendance'
  | 'payroll-leaves'
  | 'payroll-structure'
  | 'payroll-processing'
  | 'payroll-payments'
  | 'payroll-advances-loans'
  | 'payroll-slips'
  | 'payroll-reports';

interface PayrollHRWorkspaceProps {
  initialTab?: PayrollTabId;
  onNavigateTab?: (tab: PayrollTabId) => void;
}

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

const DEPARTMENT_SUGGESTIONS = [
  'Pharmacy Operations',
  'Sales & Counter',
  'Supply & Distribution',
  'Warehouse & Inventory',
  'Accounts & Finance',
  'Administration',
  'Delivery & Logistics',
];

const REPORT_CATALOG: Array<{
  key: string;
  number: number;
  label: string;
  group: 'Employee Reports' | 'Attendance Reports' | 'Payroll Reports';
}> = [
  // Employee Reports (1-5)
  { key: 'employee-list', number: 1, label: 'Employee List Report', group: 'Employee Reports' },
  { key: 'active-inactive-employees', number: 2, label: 'Active / Inactive Employees Report', group: 'Employee Reports' },
  { key: 'department-wise-employees', number: 3, label: 'Department-Wise Employees Report', group: 'Employee Reports' },
  { key: 'employee-joining', number: 4, label: 'Employee Joining Report', group: 'Employee Reports' },
  { key: 'employee-leaving', number: 5, label: 'Employee Leaving Report', group: 'Employee Reports' },
  // Attendance Reports (6-12)
  { key: 'daily-attendance', number: 6, label: 'Daily Attendance Report', group: 'Attendance Reports' },
  { key: 'monthly-attendance', number: 7, label: 'Monthly Attendance Report', group: 'Attendance Reports' },
  { key: 'late-arrival', number: 8, label: 'Late Arrival Report', group: 'Attendance Reports' },
  { key: 'absentee-report', number: 9, label: 'Absentee Report', group: 'Attendance Reports' },
  { key: 'overtime-report', number: 10, label: 'Overtime Report', group: 'Attendance Reports' },
  { key: 'leave-history', number: 11, label: 'Leave History Report', group: 'Attendance Reports' },
  { key: 'attendance-summary', number: 12, label: 'Attendance Summary Report', group: 'Attendance Reports' },
  // Payroll Reports (13-25)
  { key: 'monthly-payroll-summary', number: 13, label: 'Monthly Payroll Summary Report', group: 'Payroll Reports' },
  { key: 'employee-wise-salary', number: 14, label: 'Employee-Wise Salary Report', group: 'Payroll Reports' },
  { key: 'salary-payment-register', number: 15, label: 'Salary Payment Register', group: 'Payroll Reports' },
  { key: 'basic-salary-report', number: 16, label: 'Basic Salary Report', group: 'Payroll Reports' },
  { key: 'allowances-report', number: 17, label: 'Allowances Report', group: 'Payroll Reports' },
  { key: 'deductions-report', number: 18, label: 'Deductions Report', group: 'Payroll Reports' },
  { key: 'unpaid-salary-report', number: 19, label: 'Unpaid Salary Report', group: 'Payroll Reports' },
  { key: 'paid-salary-report', number: 20, label: 'Paid Salary Report', group: 'Payroll Reports' },
  { key: 'advance-salary-report', number: 21, label: 'Advance Salary Report', group: 'Payroll Reports' },
  { key: 'loan-recovery-report', number: 22, label: 'Loan Recovery Report', group: 'Payroll Reports' },
  { key: 'annual-salary-statement', number: 23, label: 'Annual Salary Statement', group: 'Payroll Reports' },
  { key: 'payroll-expense-report', number: 24, label: 'Payroll Expense Report (EXP-5030)', group: 'Payroll Reports' },
  { key: 'salary-payable-report', number: 25, label: 'Salary Payable Report (LIA-2030)', group: 'Payroll Reports' },
];

function formatPKR(val: unknown): string {
  const n = Number(val) || 0;
  return `Rs ${n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function payrollFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  const res = await authFetch(`/api/payroll${path}`, {
    ...options,
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

export const PayrollHRWorkspace: React.FC<PayrollHRWorkspaceProps> = ({
  initialTab = 'payroll-dashboard',
  onNavigateTab,
}) => {
  const [activeTab, setActiveTab] = useState<PayrollTabId>(initialTab);
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = useCallback(
    (tab: PayrollTabId) => {
      setActiveTab(tab);
      onNavigateTab?.(tab);
    },
    [onNavigateTab]
  );

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());

  const [loading, setLoading] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Master State
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [employees, setEmployees] = useState<Array<Record<string, any>>>([]);
  const [nextEmployeeCode, setNextEmployeeCode] = useState<string>('EMP-001');
  const [financialAccounts, setFinancialAccounts] = useState<Array<Record<string, any>>>([]);

  // Employee Filters & Modal
  const [empSearch, setEmpSearch] = useState<string>('');
  const [empStatusFilter, setEmpStatusFilter] = useState<string>('all');
  const [empDeptFilter, setEmpDeptFilter] = useState<string>('all');
  const [showEmployeeModal, setShowEmployeeModal] = useState<boolean>(false);
  const [editingEmployee, setEditingEmployee] = useState<Record<string, any> | null>(null);
  const [empForm, setEmpForm] = useState({
    full_name: '',
    father_name: '',
    photo_url: '',
    cnic: '',
    phone: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    address: '',
    department: 'Pharmacy Operations',
    designation: 'Pharmacist',
    joining_date: todayStr,
    leaving_date: '',
    employment_status: 'Active',
    basic_salary: '',
    payment_method: 'Cash',
    bank_name: '',
    bank_account_title: '',
    bank_account_number: '',
    annual_casual_leave_quota: '12',
    annual_sick_leave_quota: '10',
    annual_earned_leave_quota: '14',
    remarks: '',
  });
  const [ledgerEmployeeDetail, setLedgerEmployeeDetail] = useState<Record<string, any> | null>(null);

  // Attendance State
  const [attendanceViewMode, setAttendanceViewMode] = useState<'daily' | 'calendar'>('daily');
  const [attendanceDate, setAttendanceDate] = useState<string>(todayStr);
  const [bulkAttendanceRows, setBulkAttendanceRows] = useState<Record<number, Record<string, any>>>({});
  const [monthlyCalendar, setMonthlyCalendar] = useState<any>(null);

  // Leaves State
  const [leavesList, setLeavesList] = useState<Array<Record<string, any>>>([]);
  const [leaveBalances, setLeaveBalances] = useState<Array<Record<string, any>>>([]);
  const [leaveForm, setLeaveForm] = useState({
    employee_id: '',
    leave_type: 'Casual Leave',
    start_date: todayStr,
    end_date: todayStr,
    total_days: '',
    reason: '',
    status: 'Approved',
  });

  // Salary Structure State
  const [structures, setStructures] = useState<Array<Record<string, any>>>([]);
  const [editingStructure, setEditingStructure] = useState<Record<string, any> | null>(null);
  const [structForm, setStructForm] = useState({
    basic_salary: '',
    house_allowance: '',
    house_allowance_type: 'Fixed',
    medical_allowance: '',
    medical_allowance_type: 'Fixed',
    conveyance_allowance: '',
    conveyance_allowance_type: 'Fixed',
    other_allowance: '',
    overtime_hourly_rate: '',
    overtime_calculation_method: 'Auto_From_Basic',
    default_bonus: '',
    absent_deduction_method: 'Per_Day_Basic',
    absent_deduction_rate: '',
    late_deduction_method: 'Per_3_Lates_1_Day',
    late_deduction_rate: '',
    other_deduction: '',
  });

  // Payroll Processing State
  const [payrollRecords, setPayrollRecords] = useState<Array<Record<string, any>>>([]);
  const [payrollPreviews, setPayrollPreviews] = useState<Array<Record<string, any>>>([]);
  const [processFilterEmpId, setProcessFilterEmpId] = useState<string>('0');
  const [editingPayrollRow, setEditingPayrollRow] = useState<Record<string, any> | null>(null);
  const [reopenTargetRow, setReopenTargetRow] = useState<Record<string, any> | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');

  // Salary Payment State
  const [salaryPayments, setSalaryPayments] = useState<Array<Record<string, any>>>([]);
  const [paymentForm, setPaymentForm] = useState({
    payroll_id: '',
    payment_amount: '',
    payment_date: todayStr,
    payment_mode: 'Cash',
    financial_account_id: '',
    reference_number: '',
    remarks: '',
  });

  // Advances & Loans State
  const [advancesLoans, setAdvancesLoans] = useState<Array<Record<string, any>>>([]);
  const [advanceRecoveries, setAdvanceRecoveries] = useState<Array<Record<string, any>>>([]);
  const [advLoanForm, setAdvLoanForm] = useState({
    employee_id: '',
    transaction_type: 'Advance',
    disbursement_date: todayStr,
    principal_amount: '',
    monthly_installment: '',
    auto_recover_in_payroll: true,
    payment_mode: 'Cash',
    financial_account_id: '',
    reference_number: '',
    remarks: '',
  });
  const [directRecoveryTarget, setDirectRecoveryTarget] = useState<Record<string, any> | null>(null);
  const [directRecoveryAmount, setDirectRecoveryAmount] = useState<string>('');

  // Salary Slip State
  const [selectedSlipPayrollId, setSelectedSlipPayrollId] = useState<number>(0);
  const [salarySlipData, setSalarySlipData] = useState<any>(null);

  // 25 Reports State
  const [activeReportKey, setActiveReportKey] = useState<string>('monthly-payroll-summary');
  const [reportData, setReportData] = useState<any>(null);
  const [reportSearch, setReportSearch] = useState<string>('');
  const [reportEmpId, setReportEmpId] = useState<string>('0');
  const [reportDept, setReportDept] = useState<string>('all');
  const [reportStartDate, setReportStartDate] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [reportEndDate, setReportEndDate] = useState<string>(todayStr);
  const [reportSortCol, setReportSortCol] = useState<string>('');
  const [reportSortDir, setReportSortDir] = useState<'asc' | 'desc'>('asc');

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Load core data
  const loadCoreData = useCallback(async () => {
    try {
      setLoading(true);
      const [dashRes, empRes] = await Promise.all([
        payrollFetch(`/dashboard?month=${selectedMonth}&year=${selectedYear}&date=${attendanceDate}`),
        payrollFetch(`/employees?status=${empStatusFilter}&department=${empDeptFilter}&search=${encodeURIComponent(empSearch)}`),
      ]);
      setDashboardData(dashRes.data);
      setFinancialAccounts(dashRes.data?.financial_accounts || []);
      setEmployees(empRes.data || []);
      if (empRes.next_employee_code) {
        setNextEmployeeCode(empRes.next_employee_code);
      }
      if (!paymentForm.financial_account_id && dashRes.data?.financial_accounts?.length > 0) {
        const defaultCash = dashRes.data.financial_accounts[0];
        setPaymentForm((prev) => ({ ...prev, financial_account_id: String(defaultCash.id) }));
        setAdvLoanForm((prev) => ({ ...prev, financial_account_id: String(defaultCash.id) }));
      }
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load payroll data');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear, attendanceDate, empStatusFilter, empDeptFilter, empSearch, paymentForm.financial_account_id]);

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData]);

  // Tab-specific data loaders
  const loadAttendanceData = useCallback(async () => {
    try {
      const [dailyRes, calRes] = await Promise.all([
        payrollFetch(`/attendance?date=${attendanceDate}`),
        payrollFetch(`/attendance/monthly-calendar?month=${selectedMonth}&year=${selectedYear}`),
      ]);
      const map: Record<number, Record<string, any>> = {};
      for (const emp of employees) {
        map[emp.id] = {
          employee_id: emp.id,
          status: 'Present',
          leave_type: '',
          check_in_time: '09:00',
          check_out_time: '17:00',
          late_minutes: '',
          early_departure_minutes: '',
          overtime_hours: '',
          remarks: '',
        };
      }
      for (const r of dailyRes.data || []) {
        map[r.employee_id] = {
          id: r.id,
          employee_id: r.employee_id,
          status: r.status || 'Present',
          leave_type: r.leave_type || '',
          check_in_time: r.check_in_time || '',
          check_out_time: r.check_out_time || '',
          late_minutes: r.late_minutes ? String(r.late_minutes) : '',
          early_departure_minutes: r.early_departure_minutes ? String(r.early_departure_minutes) : '',
          overtime_hours: r.overtime_hours ? String(r.overtime_hours) : '',
          remarks: r.remarks || '',
        };
      }
      setBulkAttendanceRows(map);
      setMonthlyCalendar(calRes.data);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load attendance');
    }
  }, [attendanceDate, selectedMonth, selectedYear, employees]);

  const loadLeavesData = useCallback(async () => {
    try {
      const [lvRes, balRes] = await Promise.all([
        payrollFetch(`/leaves?year=${selectedYear}`),
        payrollFetch(`/leaves/balances?year=${selectedYear}`),
      ]);
      setLeavesList(lvRes.data || []);
      setLeaveBalances(balRes.data || []);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load leaves');
    }
  }, [selectedYear]);

  const loadStructuresData = useCallback(async () => {
    try {
      const res = await payrollFetch('/salary-structures');
      setStructures(res.data || []);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load salary structures');
    }
  }, []);

  const loadPayrollProcessingData = useCallback(async () => {
    try {
      const [recRes, prevRes] = await Promise.all([
        payrollFetch(`/processing?month=${selectedMonth}&year=${selectedYear}`),
        payrollFetch('/processing/preview', {
          method: 'POST',
          body: JSON.stringify({
            payroll_month: selectedMonth,
            payroll_year: selectedYear,
            employee_id: Number(processFilterEmpId) || 0,
          }),
        }),
      ]);
      setPayrollRecords(recRes.data || []);
      setPayrollPreviews(prevRes.data?.previews || []);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load payroll records');
    }
  }, [selectedMonth, selectedYear, processFilterEmpId]);

  const loadPaymentsData = useCallback(async () => {
    try {
      const [payRes, prRes] = await Promise.all([
        payrollFetch(`/payments?month=${selectedMonth}&year=${selectedYear}`),
        payrollFetch('/processing'),
      ]);
      setSalaryPayments(payRes.data || []);
      setPayrollRecords(prRes.data || []);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load salary payments');
    }
  }, [selectedMonth, selectedYear]);

  const loadAdvancesLoansData = useCallback(async () => {
    try {
      const res = await payrollFetch('/advances-loans');
      setAdvancesLoans(res.data || []);
      setAdvanceRecoveries(res.recoveries || []);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load advances and loans');
    }
  }, []);

  const loadSalarySlipDetail = useCallback(async (payrollId: number) => {
    if (!payrollId) return;
    try {
      const res = await payrollFetch(`/salary-slips/${payrollId}`);
      setSalarySlipData(res.data);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load salary slip');
    }
  }, []);

  const loadActiveReport = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        month: String(selectedMonth),
        year: String(selectedYear),
        employee_id: reportEmpId,
        department: reportDept,
        search: reportSearch,
        start_date: reportStartDate,
        end_date: reportEndDate,
      });
      const res = await payrollFetch(`/reports/${activeReportKey}?${qs.toString()}`);
      setReportData(res.data);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load report');
    }
  }, [activeReportKey, selectedMonth, selectedYear, reportEmpId, reportDept, reportSearch, reportStartDate, reportEndDate]);

  useEffect(() => {
    if (activeTab === 'payroll-attendance') loadAttendanceData();
    else if (activeTab === 'payroll-leaves') loadLeavesData();
    else if (activeTab === 'payroll-structure') loadStructuresData();
    else if (activeTab === 'payroll-processing') loadPayrollProcessingData();
    else if (activeTab === 'payroll-payments') loadPaymentsData();
    else if (activeTab === 'payroll-advances-loans') loadAdvancesLoansData();
    else if (activeTab === 'payroll-slips') {
      loadPayrollProcessingData();
    } else if (activeTab === 'payroll-reports') {
      loadActiveReport();
    }
  }, [
    activeTab,
    loadAttendanceData,
    loadLeavesData,
    loadStructuresData,
    loadPayrollProcessingData,
    loadPaymentsData,
    loadAdvancesLoansData,
    loadActiveReport,
  ]);

  useEffect(() => {
    if (activeTab === 'payroll-slips' && payrollRecords.length > 0 && !selectedSlipPayrollId) {
      const firstId = Number(payrollRecords[0].id);
      setSelectedSlipPayrollId(firstId);
      loadSalarySlipDetail(firstId);
    }
  }, [activeTab, payrollRecords, selectedSlipPayrollId, loadSalarySlipDetail]);

  // Handlers
  const openAddEmployeeModal = async () => {
    try {
      const codeRes = await payrollFetch('/employees/next-code');
      if (codeRes.data?.nextCode) setNextEmployeeCode(codeRes.data.nextCode);
    } catch {
      // ignore
    }
    setEditingEmployee(null);
    setEmpForm({
      full_name: '',
      father_name: '',
      photo_url: '',
      cnic: '',
      phone: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      address: '',
      department: 'Pharmacy Operations',
      designation: 'Pharmacist',
      joining_date: todayStr,
      leaving_date: '',
      employment_status: 'Active',
      basic_salary: '',
      payment_method: 'Cash',
      bank_name: '',
      bank_account_title: '',
      bank_account_number: '',
      annual_casual_leave_quota: '12',
      annual_sick_leave_quota: '10',
      annual_earned_leave_quota: '14',
      remarks: '',
    });
    setShowEmployeeModal(true);
  };

  const openEditEmployeeModal = (emp: Record<string, any>) => {
    setEditingEmployee(emp);
    setEmpForm({
      full_name: String(emp.full_name || ''),
      father_name: String(emp.father_name || ''),
      photo_url: String(emp.photo_url || ''),
      cnic: String(emp.cnic || ''),
      phone: String(emp.phone || ''),
      emergency_contact_name: String(emp.emergency_contact_name || ''),
      emergency_contact_phone: String(emp.emergency_contact_phone || ''),
      address: String(emp.address || ''),
      department: String(emp.department || 'Pharmacy Operations'),
      designation: String(emp.designation || 'Staff'),
      joining_date: String(emp.joining_date || todayStr),
      leaving_date: String(emp.leaving_date || ''),
      employment_status: String(emp.employment_status || 'Active'),
      basic_salary: emp.basic_salary ? String(emp.basic_salary) : '',
      payment_method: String(emp.payment_method || 'Cash'),
      bank_name: String(emp.bank_name || ''),
      bank_account_title: String(emp.bank_account_title || ''),
      bank_account_number: String(emp.bank_account_number || ''),
      annual_casual_leave_quota: String(emp.annual_casual_leave_quota ?? 12),
      annual_sick_leave_quota: String(emp.annual_sick_leave_quota ?? 10),
      annual_earned_leave_quota: String(emp.annual_earned_leave_quota ?? 14),
      remarks: String(emp.remarks || ''),
    });
    setShowEmployeeModal(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEmpForm((prev) => ({ ...prev, photo_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEmployee) {
        await payrollFetch(`/employees/${editingEmployee.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...empForm,
            basic_salary: Number(empForm.basic_salary) || 0,
          }),
        });
        showToast('success', `Updated employee ${editingEmployee.employee_code}.`);
      } else {
        const res = await payrollFetch('/employees', {
          method: 'POST',
          body: JSON.stringify({
            ...empForm,
            basic_salary: Number(empForm.basic_salary) || 0,
          }),
        });
        showToast('success', `Registered ${res.data?.employee_code} - ${res.data?.full_name}.`);
      }
      setShowEmployeeModal(false);
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save employee');
    }
  };

  const handleToggleEmployeeStatus = async (emp: Record<string, any>) => {
    const nextStatus = emp.employment_status === 'Active' ? 'Inactive' : 'Active';
    try {
      await payrollFetch(`/employees/${emp.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          employment_status: nextStatus,
          leaving_date: nextStatus === 'Inactive' ? todayStr : '',
        }),
      });
      showToast('success', `${emp.employee_code} marked as ${nextStatus}.`);
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to change status');
    }
  };

  const handleOpenEmployeeLedger = async (empId: number) => {
    try {
      const res = await payrollFetch(`/employees/${empId}/ledger`);
      setLedgerEmployeeDetail(res.data);
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load employee ledger');
    }
  };

  const handleSaveBulkAttendance = async () => {
    try {
      const entries = Object.values(bulkAttendanceRows).map((r) => ({
        ...r,
        attendance_date: attendanceDate,
        late_minutes: Number(r.late_minutes) || 0,
        early_departure_minutes: Number(r.early_departure_minutes) || 0,
        overtime_hours: Number(r.overtime_hours) || 0,
      }));
      const res = await payrollFetch('/attendance/bulk', {
        method: 'POST',
        body: JSON.stringify({ attendance_date: attendanceDate, entries }),
      });
      showToast('success', res.message || 'Attendance saved.');
      await loadAttendanceData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save bulk attendance');
    }
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await payrollFetch('/leaves', {
        method: 'POST',
        body: JSON.stringify({
          ...leaveForm,
          employee_id: Number(leaveForm.employee_id),
          total_days: leaveForm.total_days ? Number(leaveForm.total_days) : undefined,
        }),
      });
      showToast('success', res.message || 'Leave application submitted.');
      setLeaveForm((prev) => ({ ...prev, total_days: '', reason: '' }));
      await loadLeavesData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to submit leave');
    }
  };

  const handleUpdateLeaveStatus = async (leaveId: number, status: 'Approved' | 'Rejected') => {
    try {
      await payrollFetch(`/leaves/${leaveId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('success', `Leave request ${status}.`);
      await loadLeavesData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update leave status');
    }
  };

  const handleOpenEditStructure = (row: Record<string, any>) => {
    setEditingStructure(row);
    setStructForm({
      basic_salary: row.basic_salary ? String(row.basic_salary) : '',
      house_allowance: row.house_allowance ? String(row.house_allowance) : '',
      house_allowance_type: row.house_allowance_type || 'Fixed',
      medical_allowance: row.medical_allowance ? String(row.medical_allowance) : '',
      medical_allowance_type: row.medical_allowance_type || 'Fixed',
      conveyance_allowance: row.conveyance_allowance ? String(row.conveyance_allowance) : '',
      conveyance_allowance_type: row.conveyance_allowance_type || 'Fixed',
      other_allowance: row.other_allowance ? String(row.other_allowance) : '',
      overtime_hourly_rate: row.overtime_hourly_rate ? String(row.overtime_hourly_rate) : '',
      overtime_calculation_method: row.overtime_calculation_method || 'Auto_From_Basic',
      default_bonus: row.default_bonus ? String(row.default_bonus) : '',
      absent_deduction_method: row.absent_deduction_method || 'Per_Day_Basic',
      absent_deduction_rate: row.absent_deduction_rate ? String(row.absent_deduction_rate) : '',
      late_deduction_method: row.late_deduction_method || 'Per_3_Lates_1_Day',
      late_deduction_rate: row.late_deduction_rate ? String(row.late_deduction_rate) : '',
      other_deduction: row.other_deduction ? String(row.other_deduction) : '',
    });
  };

  const handleSaveStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStructure) return;
    try {
      await payrollFetch(`/salary-structures/${editingStructure.employee_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          basic_salary: Number(structForm.basic_salary) || 0,
          house_allowance: Number(structForm.house_allowance) || 0,
          house_allowance_type: structForm.house_allowance_type,
          medical_allowance: Number(structForm.medical_allowance) || 0,
          medical_allowance_type: structForm.medical_allowance_type,
          conveyance_allowance: Number(structForm.conveyance_allowance) || 0,
          conveyance_allowance_type: structForm.conveyance_allowance_type,
          other_allowance: Number(structForm.other_allowance) || 0,
          overtime_hourly_rate: Number(structForm.overtime_hourly_rate) || 0,
          overtime_calculation_method: structForm.overtime_calculation_method,
          default_bonus: Number(structForm.default_bonus) || 0,
          absent_deduction_method: structForm.absent_deduction_method,
          absent_deduction_rate: Number(structForm.absent_deduction_rate) || 0,
          late_deduction_method: structForm.late_deduction_method,
          late_deduction_rate: Number(structForm.late_deduction_rate) || 0,
          other_deduction: Number(structForm.other_deduction) || 0,
        }),
      });
      showToast('success', `Updated salary structure for ${editingStructure.full_name}.`);
      setEditingStructure(null);
      await loadStructuresData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save structure');
    }
  };

  const handleGeneratePayroll = async () => {
    try {
      const res = await payrollFetch('/processing/generate', {
        method: 'POST',
        body: JSON.stringify({
          payroll_month: selectedMonth,
          payroll_year: selectedYear,
          employee_id: Number(processFilterEmpId) || 0,
        }),
      });
      showToast('success', res.message || 'Payroll generated.');
      await loadPayrollProcessingData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to generate payroll');
    }
  };

  const handleSavePayrollAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayrollRow) return;
    try {
      await payrollFetch(`/processing/${editingPayrollRow.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingPayrollRow),
      });
      showToast('success', `Updated payroll ${editingPayrollRow.payroll_code}.`);
      setEditingPayrollRow(null);
      await loadPayrollProcessingData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update payroll');
    }
  };

  const handleFinalizeSinglePayroll = async (id: number) => {
    try {
      const res = await payrollFetch(`/processing/${id}/finalize`, { method: 'POST' });
      showToast('success', res.message || 'Payroll finalized and posted to accounts.');
      await loadPayrollProcessingData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to finalize payroll');
    }
  };

  const handleFinalizeAllMonthPayrolls = async () => {
    try {
      const res = await payrollFetch('/processing/finalize-batch', {
        method: 'POST',
        body: JSON.stringify({ payroll_month: selectedMonth, payroll_year: selectedYear }),
      });
      showToast('success', res.message || 'All pending payrolls finalized.');
      await loadPayrollProcessingData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to finalize batch');
    }
  };

  const handleConfirmReopenPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTargetRow) return;
    try {
      const res = await payrollFetch(`/processing/${reopenTargetRow.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason: reopenReason }),
      });
      showToast('success', res.message || 'Payroll reopened.');
      setReopenTargetRow(null);
      setReopenReason('');
      await loadPayrollProcessingData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to reopen payroll');
    }
  };

  const selectedPayablePayroll = useMemo(
    () => payrollRecords.find((r) => String(r.id) === String(paymentForm.payroll_id)) || null,
    [payrollRecords, paymentForm.payroll_id]
  );

  const handleRecordSalaryPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await payrollFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          payroll_id: Number(paymentForm.payroll_id),
          payment_amount: Number(paymentForm.payment_amount) || 0,
          payment_date: paymentForm.payment_date,
          payment_mode: paymentForm.payment_mode,
          financial_account_id: Number(paymentForm.financial_account_id),
          reference_number: paymentForm.reference_number,
          remarks: paymentForm.remarks,
        }),
      });
      showToast('success', res.message || 'Salary payment recorded.');
      setPaymentForm((prev) => ({
        ...prev,
        payroll_id: '',
        payment_amount: '',
        reference_number: '',
        remarks: '',
      }));
      await loadPaymentsData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to record salary payment');
    }
  };

  const handleDisburseAdvanceLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await payrollFetch('/advances-loans', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: Number(advLoanForm.employee_id),
          transaction_type: advLoanForm.transaction_type,
          disbursement_date: advLoanForm.disbursement_date,
          principal_amount: Number(advLoanForm.principal_amount) || 0,
          monthly_installment: Number(advLoanForm.monthly_installment) || Number(advLoanForm.principal_amount) || 0,
          auto_recover_in_payroll: advLoanForm.auto_recover_in_payroll ? 1 : 0,
          payment_mode: advLoanForm.payment_mode,
          financial_account_id: Number(advLoanForm.financial_account_id),
          reference_number: advLoanForm.reference_number,
          remarks: advLoanForm.remarks,
        }),
      });
      showToast('success', res.message || 'Disbursed successfully.');
      setAdvLoanForm((prev) => ({
        ...prev,
        principal_amount: '',
        monthly_installment: '',
        reference_number: '',
        remarks: '',
      }));
      await loadAdvancesLoansData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to disburse');
    }
  };

  const handleDirectRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directRecoveryTarget) return;
    try {
      const res = await payrollFetch(`/advances-loans/${directRecoveryTarget.id}/recover`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(directRecoveryAmount) || 0,
          recovery_date: todayStr,
          financial_account_id: Number(advLoanForm.financial_account_id),
        }),
      });
      showToast('success', res.message || 'Recovery recorded.');
      setDirectRecoveryTarget(null);
      setDirectRecoveryAmount('');
      await loadAdvancesLoansData();
      await loadCoreData();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Failed to record recovery');
    }
  };

  // Export Report to Excel
  const handleExportReportExcel = () => {
    if (!reportData?.rows) return;
    const cols: Array<{ key: string; label: string }> = reportData.columns || [];
    const dataForSheet = reportData.rows.map((r: Record<string, any>, idx: number) => {
      const rowObj: Record<string, any> = { '#': idx + 1 };
      for (const c of cols) {
        rowObj[c.label] = r[c.key] ?? '';
      }
      return rowObj;
    });
    const ws = XLSX.utils.json_to_sheet(dataForSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll Report');
    XLSX.writeFile(wb, `${reportData.report_key || 'payroll_report'}_${selectedYear}_${selectedMonth}.xlsx`);
  };

  const sortedReportRows = useMemo(() => {
    const list = [...(reportData?.rows || [])];
    if (!reportSortCol) return list;
    return list.sort((a, b) => {
      const va = a[reportSortCol];
      const vb = b[reportSortCol];
      const na = Number(va);
      const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') {
        return reportSortDir === 'asc' ? na - nb : nb - na;
      }
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      return reportSortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [reportData, reportSortCol, reportSortDir]);

  const navItems: Array<{ id: PayrollTabId; label: string; icon: React.ReactNode }> = [
    { id: 'payroll-dashboard', label: 'Payroll Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'payroll-employees', label: 'Employees', icon: <Users className="w-4 h-4" /> },
    { id: 'payroll-attendance', label: 'Attendance', icon: <CalendarCheck className="w-4 h-4" /> },
    { id: 'payroll-leaves', label: 'Leave Management', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'payroll-structure', label: 'Salary Structure', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'payroll-processing', label: 'Monthly Payroll', icon: <Wallet className="w-4 h-4" /> },
    { id: 'payroll-payments', label: 'Salary Payment', icon: <Banknote className="w-4 h-4" /> },
    { id: 'payroll-advances-loans', label: 'Advances & Loans', icon: <HandCoins className="w-4 h-4" /> },
    { id: 'payroll-slips', label: 'Salary Slips', icon: <Receipt className="w-4 h-4" /> },
    { id: 'payroll-reports', label: 'Payroll & HR Reports (25)', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  const kpis = dashboardData?.kpis || {};

  return (
    <div className="space-y-4">
      {/* Top Sub-Navigation Bar */}
      <div className="bg-slate-900 text-white rounded-xl p-3 shadow-sm border border-slate-800 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-white shadow">
              HR
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">
                PAYROLL & EMPLOYEE MANAGEMENT SYSTEM
              </h1>
              <p className="text-[11px] text-slate-400">
                Complete HR, Attendance, Leave, Monthly Payroll Accruals, Salary Payments, Advances/Loans & 25 Reports
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-white"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-white"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadCoreData}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toast Notification */}
      {notice && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold print:hidden ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1: PAYROLL DASHBOARD                                            */}
      {/* =================================================================== */}
      {activeTab === 'payroll-dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-slate-500">1. Total Employees</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{kpis.total_employees ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                Active: <span className="font-bold text-emerald-700">{kpis.active_employees ?? 0}</span> | Inactive:{' '}
                <span className="font-bold text-slate-700">{kpis.inactive_employees ?? 0}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-emerald-700">2. Active Employees</div>
              <div className="text-2xl font-black text-emerald-700 mt-1">{kpis.active_employees ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                Monthly Basic Pool: <span className="font-bold text-slate-800">{formatPKR(kpis.total_active_basic)}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-teal-700">3. Present Today ({todayStr})</div>
              <div className="text-2xl font-black text-teal-700 mt-1">{kpis.present_today ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">
                On Leave: <span className="font-bold">{kpis.on_leave_today ?? 0}</span> | Late:{' '}
                <span className="font-bold text-amber-600">{kpis.late_today ?? 0}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-rose-700">4. Absent Today</div>
              <div className="text-2xl font-black text-rose-700 mt-1">{kpis.absent_today ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">Unexcused daily absences recorded</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-indigo-700">
                5. Current Month Payroll ({dashboardData?.period_label})
              </div>
              <div className="text-2xl font-black text-indigo-700 mt-1">{formatPKR(kpis.current_month_payroll)}</div>
              <div className="text-xs text-slate-500 mt-1">
                Gross: {formatPKR(kpis.current_month_gross)} | Deductions: {formatPKR(kpis.current_month_deductions)}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-emerald-700">6. Total Salary Paid</div>
              <div className="text-2xl font-black text-emerald-700 mt-1">{formatPKR(kpis.total_salary_paid)}</div>
              <div className="text-xs text-slate-500 mt-1">
                Paid This Month: <span className="font-bold">{formatPKR(kpis.current_month_paid)}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-amber-700">
                7. Remaining Salary Payable (LIA-2030)
              </div>
              <div className="text-2xl font-black text-amber-700 mt-1">{formatPKR(kpis.remaining_salary_payable)}</div>
              <div className="text-xs text-slate-500 mt-1">Finalized unpaid / partially paid net balances</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-sky-700">
                8. Outstanding Employee Advances (AST-1060)
              </div>
              <div className="text-2xl font-black text-sky-700 mt-1">{formatPKR(kpis.outstanding_advances)}</div>
              <div className="text-xs text-slate-500 mt-1">Short-term salary advances receivable</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="text-[11px] font-bold uppercase text-purple-700">
                9. Outstanding Employee Loans (AST-1070)
              </div>
              <div className="text-2xl font-black text-purple-700 mt-1">{formatPKR(kpis.outstanding_loans)}</div>
              <div className="text-xs text-slate-500 mt-1">Active employee installment loans receivable</div>
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-800">Quick HR & Payroll Operations</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  switchTab('payroll-employees');
                  openAddEmployeeModal();
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add New Employee ({nextEmployeeCode})</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('payroll-attendance')}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <CalendarCheck className="w-3.5 h-3.5" />
                <span>Daily Attendance</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('payroll-processing')}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>Process Monthly Payroll</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('payroll-payments')}
                className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Pay Employee Salary</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('payroll-reports')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>All 25 Payroll & HR Reports</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Department Breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-700 mb-3 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span>Department-Wise Workforce Summary</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-2.5 text-left">Department</th>
                      <th className="py-2 px-2.5 text-right">Total</th>
                      <th className="py-2 px-2.5 text-right">Active</th>
                      <th className="py-2 px-2.5 text-right">Monthly Basic Salary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(dashboardData?.departments || []).map((d: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-semibold text-slate-800">{d.department}</td>
                        <td className="py-2 px-2.5 text-right">{d.employee_count}</td>
                        <td className="py-2 px-2.5 text-right font-bold text-emerald-700">{d.active_count}</td>
                        <td className="py-2 px-2.5 text-right font-mono font-semibold">
                          {formatPKR(d.basic_salary_sum)}
                        </td>
                      </tr>
                    ))}
                    {(dashboardData?.departments || []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">
                          No employees registered yet. Click &ldquo;Add New Employee&rdquo; to begin.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Audit Logs */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-700 mb-3 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span>Recent Payroll & HR Activity Log</span>
              </h3>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-2 text-left">Action</th>
                      <th className="py-2 px-2 text-left">Ref</th>
                      <th className="py-2 px-2 text-left">Employee</th>
                      <th className="py-2 px-2 text-left">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(dashboardData?.recent_logs || []).map((log: any) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-semibold text-slate-800">{log.action}</td>
                        <td className="py-1.5 px-2 font-mono text-emerald-700">{log.record_reference}</td>
                        <td className="py-1.5 px-2 text-slate-600">
                          {log.employee_name ? `${log.employee_name} (${log.employee_code})` : '-'}
                        </td>
                        <td className="py-1.5 px-2 text-slate-500">{log.performed_by}</td>
                      </tr>
                    ))}
                    {(dashboardData?.recent_logs || []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">
                          No recent activity logged yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: EMPLOYEE MANAGEMENT                                          */}
      {/* =================================================================== */}
      {activeTab === 'payroll-employees' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search ID (EMP-001), Name, CNIC, Phone..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <select
                value={empStatusFilter}
                onChange={(e) => setEmpStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="Active">Active Only</option>
                <option value="Inactive">Inactive Only</option>
              </select>
              <select
                value={empDeptFilter}
                onChange={(e) => setEmpDeptFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                <option value="all">All Departments</option>
                {DEPARTMENT_SUGGESTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={openAddEmployeeModal}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Employee (Next: {nextEmployeeCode})</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 text-left">Emp ID</th>
                    <th className="py-2.5 px-3 text-left">Employee & Father Name</th>
                    <th className="py-2.5 px-3 text-left">Designation / Dept</th>
                    <th className="py-2.5 px-3 text-left">Mobile & CNIC</th>
                    <th className="py-2.5 px-3 text-center">Joining Date</th>
                    <th className="py-2.5 px-3 text-right">Basic Salary</th>
                    <th className="py-2.5 px-3 text-right">Adv / Loan Bal</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">{emp.employee_code}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {emp.photo_url ? (
                            <img
                              src={emp.photo_url}
                              alt={emp.full_name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-300"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center">
                              {String(emp.full_name || 'E').charAt(0)}
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900">{emp.full_name}</div>
                            <div className="text-[11px] text-slate-500">
                              S/O, D/O: {emp.father_name || '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">{emp.designation}</div>
                        <div className="text-[11px] text-slate-500">{emp.department}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{emp.phone || '-'}</div>
                        <div className="text-[11px] font-mono text-slate-500">{emp.cnic || '-'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{emp.joining_date}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPKR(emp.basic_salary)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px]">
                        <div>Adv: {formatPKR(emp.outstanding_advance)}</div>
                        <div>Loan: {formatPKR(emp.outstanding_loan)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            emp.employment_status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {emp.employment_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEmployeeLedger(emp.id)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer"
                            title="View Employee Financial Ledger"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ledger</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditEmployeeModal(emp)}
                            className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleEmployeeStatus(emp)}
                            className={`px-2 py-1 rounded font-semibold cursor-pointer ${
                              emp.employment_status === 'Active'
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {emp.employment_status === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-400">
                        No employees found matching your filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add / Edit Employee Modal */}
          {showEmployeeModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-5 max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {editingEmployee
                        ? `Edit Employee — ${editingEmployee.employee_code}`
                        : `Register New Employee — Auto ID: ${nextEmployeeCode}`}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Complete employee personal, employment, salary, bank, and emergency contact details
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEmployeeModal(false)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveEmployee} className="space-y-4 mt-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Auto Employee ID</label>
                      <input
                        type="text"
                        disabled
                        value={editingEmployee ? editingEmployee.employee_code : nextEmployeeCode}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-300 font-mono font-bold text-emerald-700"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Employee Full Name *</label>
                      <input
                        type="text"
                        required
                        value={empForm.full_name}
                        onChange={(e) => setEmpForm({ ...empForm, full_name: e.target.value })}
                        placeholder="e.g. Muhammad Usman"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Father Name</label>
                      <input
                        type="text"
                        value={empForm.father_name}
                        onChange={(e) => setEmpForm({ ...empForm, father_name: e.target.value })}
                        placeholder="e.g. Abdul Majeed"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">CNIC Number</label>
                      <input
                        type="text"
                        value={empForm.cnic}
                        onChange={(e) => setEmpForm({ ...empForm, cnic: e.target.value })}
                        placeholder="35202-1234567-1"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Mobile Number</label>
                      <input
                        type="text"
                        value={empForm.phone}
                        onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                        placeholder="0300-1234567"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Photograph Upload</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="w-full text-[11px] file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Department</label>
                      <input
                        type="text"
                        list="payroll-dept-list"
                        value={empForm.department}
                        onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                      <datalist id="payroll-dept-list">
                        {DEPARTMENT_SUGGESTIONS.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Designation</label>
                      <input
                        type="text"
                        value={empForm.designation}
                        onChange={(e) => setEmpForm({ ...empForm, designation: e.target.value })}
                        placeholder="e.g. Senior Pharmacist"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Joining Date *</label>
                      <input
                        type="date"
                        required
                        value={empForm.joining_date}
                        onChange={(e) => setEmpForm({ ...empForm, joining_date: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Basic Monthly Salary (PKR) *</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={empForm.basic_salary}
                        onChange={(e) => setEmpForm({ ...empForm, basic_salary: e.target.value })}
                        placeholder="Enter monthly basic salary"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Payment Method</label>
                      <select
                        value={empForm.payment_method}
                        onChange={(e) => setEmpForm({ ...empForm, payment_method: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank">Bank Transfer</option>
                        <option value="Cheque">Cheque</option>
                        <option value="Online">Online / Mobile Wallet</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Employment Status</label>
                      <select
                        value={empForm.employment_status}
                        onChange={(e) => setEmpForm({ ...empForm, employment_status: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Bank Name</label>
                      <input
                        type="text"
                        value={empForm.bank_name}
                        onChange={(e) => setEmpForm({ ...empForm, bank_name: e.target.value })}
                        placeholder="e.g. Meezan Bank"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Bank Account Title</label>
                      <input
                        type="text"
                        value={empForm.bank_account_title}
                        onChange={(e) => setEmpForm({ ...empForm, bank_account_title: e.target.value })}
                        placeholder="Account Title"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Bank Account / IBAN</label>
                      <input
                        type="text"
                        value={empForm.bank_account_number}
                        onChange={(e) => setEmpForm({ ...empForm, bank_account_number: e.target.value })}
                        placeholder="Account Number or IBAN"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Emergency Contact Name</label>
                      <input
                        type="text"
                        value={empForm.emergency_contact_name}
                        onChange={(e) => setEmpForm({ ...empForm, emergency_contact_name: e.target.value })}
                        placeholder="Relative / Guardian Name"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Emergency Contact Phone</label>
                      <input
                        type="text"
                        value={empForm.emergency_contact_phone}
                        onChange={(e) => setEmpForm({ ...empForm, emergency_contact_phone: e.target.value })}
                        placeholder="0300-0000000"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Residential Address</label>
                      <input
                        type="text"
                        value={empForm.address}
                        onChange={(e) => setEmpForm({ ...empForm, address: e.target.value })}
                        placeholder="Full residential address"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Remarks / Notes</label>
                    <input
                      type="text"
                      value={empForm.remarks}
                      onChange={(e) => setEmpForm({ ...empForm, remarks: e.target.value })}
                      placeholder="Optional employment remarks..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setShowEmployeeModal(false)}
                      className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                    >
                      {editingEmployee ? 'Save Employee Changes' : 'Register Employee'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Employee Financial Ledger Modal */}
          {ledgerEmployeeDetail && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full p-5 max-h-[90vh] overflow-y-auto space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Employee Financial Ledger — {ledgerEmployeeDetail.employee?.full_name} (
                      {ledgerEmployeeDetail.employee?.employee_code})
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      {ledgerEmployeeDetail.employee?.designation} • {ledgerEmployeeDetail.employee?.department} • Basic
                      Salary: {formatPKR(ledgerEmployeeDetail.employee?.basic_salary)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLedgerEmployeeDetail(null)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        <th className="py-2 px-2.5 text-left">Date</th>
                        <th className="py-2 px-2.5 text-left">Type</th>
                        <th className="py-2 px-2.5 text-left">Reference</th>
                        <th className="py-2 px-2.5 text-left">Description</th>
                        <th className="py-2 px-2.5 text-right">Debit (Paid/Disbursed)</th>
                        <th className="py-2 px-2.5 text-right">Credit (Accrued/Recovered)</th>
                        <th className="py-2 px-2.5 text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(ledgerEmployeeDetail.ledger || []).map((row: any) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-mono">{row.transaction_date}</td>
                          <td className="py-2 px-2.5 font-semibold">{row.transaction_type}</td>
                          <td className="py-2 px-2.5 font-mono text-emerald-700">{row.reference_code}</td>
                          <td className="py-2 px-2.5">{row.description}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-rose-700">
                            {row.debit_amount > 0 ? formatPKR(row.debit_amount) : '-'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono text-emerald-700">
                            {row.credit_amount > 0 ? formatPKR(row.credit_amount) : '-'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono font-bold">
                            {formatPKR(row.running_balance)}
                          </td>
                        </tr>
                      ))}
                      {(ledgerEmployeeDetail.ledger || []).length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            No financial ledger transactions recorded for this employee yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: ATTENDANCE MANAGEMENT                                        */}
      {/* =================================================================== */}
      {activeTab === 'payroll-attendance' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAttendanceViewMode('daily')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  attendanceViewMode === 'daily'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Daily Bulk Attendance Entry
              </button>
              <button
                type="button"
                onClick={() => setAttendanceViewMode('calendar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  attendanceViewMode === 'calendar'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Monthly Attendance Calendar ({MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear})
              </button>
            </div>

            {attendanceViewMode === 'daily' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-slate-700">Attendance Date:</label>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={handleSaveBulkAttendance}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Attendance Sheet ({attendanceDate})</span>
                </button>
              </div>
            )}
          </div>

          {attendanceViewMode === 'daily' ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="py-2.5 px-3 text-left">Emp ID</th>
                      <th className="py-2.5 px-3 text-left">Employee Name</th>
                      <th className="py-2.5 px-3 text-left">Department</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-center">Check-In</th>
                      <th className="py-2.5 px-3 text-center">Check-Out</th>
                      <th className="py-2.5 px-3 text-right">Late (Mins)</th>
                      <th className="py-2.5 px-3 text-right">Early Out (Mins)</th>
                      <th className="py-2.5 px-3 text-right">Overtime (Hrs)</th>
                      <th className="py-2.5 px-3 text-left">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {employees
                      .filter((e) => e.employment_status === 'Active')
                      .map((emp) => {
                        const row = bulkAttendanceRows[emp.id] || {
                          employee_id: emp.id,
                          status: 'Present',
                          check_in_time: '09:00',
                          check_out_time: '17:00',
                          late_minutes: '',
                          early_departure_minutes: '',
                          overtime_hours: '',
                          remarks: '',
                        };
                        const updateCell = (field: string, value: any) => {
                          setBulkAttendanceRows((prev) => ({
                            ...prev,
                            [emp.id]: { ...row, [field]: value },
                          }));
                        };
                        return (
                          <tr key={emp.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono font-bold text-emerald-700">{emp.employee_code}</td>
                            <td className="py-2 px-3 font-bold text-slate-900">{emp.full_name}</td>
                            <td className="py-2 px-3 text-slate-600">{emp.department}</td>
                            <td className="py-2 px-3 text-center">
                              <select
                                value={row.status}
                                onChange={(e) => updateCell('status', e.target.value)}
                                className="px-2 py-1 rounded border border-slate-300 font-semibold text-xs"
                              >
                                <option value="Present">Present</option>
                                <option value="Absent">Absent</option>
                                <option value="Half Day">Half Day</option>
                                <option value="Leave">Leave</option>
                                <option value="Holiday">Holiday</option>
                              </select>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <input
                                type="time"
                                value={row.check_in_time}
                                onChange={(e) => updateCell('check_in_time', e.target.value)}
                                className="px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <input
                                type="time"
                                value={row.check_out_time}
                                onChange={(e) => updateCell('check_out_time', e.target.value)}
                                className="px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                value={row.late_minutes}
                                onChange={(e) => updateCell('late_minutes', e.target.value)}
                                placeholder="0"
                                className="w-16 px-2 py-1 rounded border border-slate-300 text-right font-mono"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                value={row.early_departure_minutes}
                                onChange={(e) => updateCell('early_departure_minutes', e.target.value)}
                                placeholder="0"
                                className="w-16 px-2 py-1 rounded border border-slate-300 text-right font-mono"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step="0.5"
                                value={row.overtime_hours}
                                onChange={(e) => updateCell('overtime_hours', e.target.value)}
                                placeholder="0"
                                className="w-16 px-2 py-1 rounded border border-slate-300 text-right font-mono"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={row.remarks}
                                onChange={(e) => updateCell('remarks', e.target.value)}
                                placeholder="Remarks..."
                                className="w-full px-2 py-1 rounded border border-slate-300"
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden p-4">
              <h3 className="text-xs font-bold uppercase text-slate-700 mb-3">
                Monthly Attendance Summary & Calendar — {monthlyCalendar?.period_label}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="py-2 px-2.5 text-left">Emp ID</th>
                      <th className="py-2 px-2.5 text-left">Employee Name</th>
                      <th className="py-2 px-2.5 text-right">Present</th>
                      <th className="py-2 px-2.5 text-right">Half Day</th>
                      <th className="py-2 px-2.5 text-right">Absent</th>
                      <th className="py-2 px-2.5 text-right">Leaves</th>
                      <th className="py-2 px-2.5 text-right">Holidays</th>
                      <th className="py-2 px-2.5 text-right">Late Days</th>
                      <th className="py-2 px-2.5 text-right">Overtime (Hrs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(monthlyCalendar?.employees || []).map((emp: any) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-mono font-bold text-emerald-700">{emp.employee_code}</td>
                        <td className="py-2 px-2.5 font-bold text-slate-900">{emp.full_name}</td>
                        <td className="py-2 px-2.5 text-right font-bold text-emerald-700">
                          {emp.summary?.present_days ?? 0}
                        </td>
                        <td className="py-2 px-2.5 text-right">{emp.summary?.half_days ?? 0}</td>
                        <td className="py-2 px-2.5 text-right font-bold text-rose-700">
                          {emp.summary?.absent_days ?? 0}
                        </td>
                        <td className="py-2 px-2.5 text-right text-amber-700">{emp.summary?.leave_days ?? 0}</td>
                        <td className="py-2 px-2.5 text-right">{emp.summary?.holidays ?? 0}</td>
                        <td className="py-2 px-2.5 text-right">{emp.summary?.late_count ?? 0}</td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold">
                          {emp.summary?.overtime_hours ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: LEAVE MANAGEMENT                                             */}
      {/* =================================================================== */}
      {activeTab === 'payroll-leaves' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Leave Application Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-800 border-b border-slate-200 pb-2">
              Record / Apply Employee Leave
            </h3>
            <form onSubmit={handleSubmitLeave} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Employee *</label>
                <select
                  required
                  value={leaveForm.employee_id}
                  onChange={(e) => setLeaveForm({ ...leaveForm, employee_id: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Leave Type *</label>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="Casual Leave">Casual Leave (Paid)</option>
                  <option value="Sick Leave">Sick Leave (Paid)</option>
                  <option value="Annual Leave">Annual Leave (Paid)</option>
                  <option value="Unpaid Leave">Unpaid Leave (Salary Deductible)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Total Days (Auto if blank)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={leaveForm.total_days}
                    onChange={(e) => setLeaveForm({ ...leaveForm, total_days: e.target.value })}
                    placeholder="Auto calculated"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Approval Status</label>
                  <select
                    value={leaveForm.status}
                    onChange={(e) => setLeaveForm({ ...leaveForm, status: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  >
                    <option value="Approved">Approved Immediately</option>
                    <option value="Pending">Pending Approval</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Reason / Medical Note</label>
                <input
                  type="text"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  placeholder="Enter reason for leave..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                Save Leave Application
              </button>
            </form>
          </div>

          {/* Leave Balances & History */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-800 mb-3">
                Annual Leave Balances ({selectedYear})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="py-2 px-2.5 text-left">Employee</th>
                      <th className="py-2 px-2.5 text-right">Casual (Used/Rem)</th>
                      <th className="py-2 px-2.5 text-right">Sick (Used/Rem)</th>
                      <th className="py-2 px-2.5 text-right">Annual (Used/Rem)</th>
                      <th className="py-2 px-2.5 text-right">Unpaid Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {leaveBalances.map((b) => (
                      <tr key={b.employee_id} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-semibold">
                          {b.employee_code} — {b.full_name}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">
                          {b.casual_used} / <span className="font-bold text-emerald-700">{b.casual_remaining}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">
                          {b.sick_used} / <span className="font-bold text-emerald-700">{b.sick_remaining}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">
                          {b.annual_used} / <span className="font-bold text-emerald-700">{b.annual_remaining}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-rose-700 font-bold">{b.unpaid_used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-800 mb-3">Leave Applications Register</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="py-2 px-2 text-left">Code</th>
                      <th className="py-2 px-2 text-left">Employee</th>
                      <th className="py-2 px-2 text-left">Leave Type</th>
                      <th className="py-2 px-2 text-center">Dates</th>
                      <th className="py-2 px-2 text-right">Days</th>
                      <th className="py-2 px-2 text-center">Status</th>
                      <th className="py-2 px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {leavesList.map((lv) => (
                      <tr key={lv.id} className="hover:bg-slate-50">
                        <td className="py-2 px-2 font-mono font-bold text-emerald-700">{lv.leave_code}</td>
                        <td className="py-2 px-2 font-semibold">{lv.full_name}</td>
                        <td className="py-2 px-2">{lv.leave_type}</td>
                        <td className="py-2 px-2 text-center font-mono">
                          {lv.start_date} → {lv.end_date}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold">{lv.total_days}</td>
                        <td className="py-2 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              lv.status === 'Approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : lv.status === 'Rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {lv.status}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {lv.status === 'Pending' && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateLeaveStatus(lv.id, 'Approved')}
                                className="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateLeaveStatus(lv.id, 'Rejected')}
                                className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {leavesList.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          No leave applications recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: SALARY STRUCTURE                                             */}
      {/* =================================================================== */}
      {activeTab === 'payroll-structure' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-800">
                  Employee Salary Structure & Deduction Rules Configuration
                </h3>
                <p className="text-[11px] text-slate-500">
                  Configure Basic Salary, House/Medical/Conveyance/Other Allowances, Overtime Rate, and Absent/Late Deduction Formulas
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 text-left">Emp ID</th>
                    <th className="py-2.5 px-3 text-left">Employee Name</th>
                    <th className="py-2.5 px-3 text-right">Basic Salary</th>
                    <th className="py-2.5 px-3 text-right">House Allow.</th>
                    <th className="py-2.5 px-3 text-right">Medical Allow.</th>
                    <th className="py-2.5 px-3 text-right">Conveyance</th>
                    <th className="py-2.5 px-3 text-right">Other / Bonus</th>
                    <th className="py-2.5 px-3 text-center">Absent / Late Rules</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {structures.map((st) => (
                    <tr key={st.employee_id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">{st.employee_code}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{st.full_name}</div>
                        <div className="text-[11px] text-slate-500">{st.designation}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{formatPKR(st.basic_salary)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {st.house_allowance_type === 'Percent'
                          ? `${st.house_allowance}%`
                          : formatPKR(st.house_allowance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {st.medical_allowance_type === 'Percent'
                          ? `${st.medical_allowance}%`
                          : formatPKR(st.medical_allowance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {st.conveyance_allowance_type === 'Percent'
                          ? `${st.conveyance_allowance}%`
                          : formatPKR(st.conveyance_allowance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {formatPKR((Number(st.other_allowance) || 0) + (Number(st.default_bonus) || 0))}
                      </td>
                      <td className="py-2.5 px-3 text-center text-[11px] text-slate-600">
                        {st.absent_deduction_method} • {st.late_deduction_method}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenEditStructure(st)}
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {editingStructure && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Configure Salary Structure — {editingStructure.full_name} ({editingStructure.employee_code})
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingStructure(null)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveStructure} className="space-y-4 mt-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Basic Monthly Salary (PKR)</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={structForm.basic_salary}
                        onChange={(e) => setStructForm({ ...structForm, basic_salary: e.target.value })}
                        placeholder="Enter basic salary"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">House Allowance</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="any"
                          value={structForm.house_allowance}
                          onChange={(e) => setStructForm({ ...structForm, house_allowance: e.target.value })}
                          placeholder="Amount or %"
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                        />
                        <select
                          value={structForm.house_allowance_type}
                          onChange={(e) => setStructForm({ ...structForm, house_allowance_type: e.target.value })}
                          className="px-2 py-1.5 rounded-lg border border-slate-300"
                        >
                          <option value="Fixed">PKR</option>
                          <option value="Percent">% Basic</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Medical Allowance</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="any"
                          value={structForm.medical_allowance}
                          onChange={(e) => setStructForm({ ...structForm, medical_allowance: e.target.value })}
                          placeholder="Amount or %"
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                        />
                        <select
                          value={structForm.medical_allowance_type}
                          onChange={(e) => setStructForm({ ...structForm, medical_allowance_type: e.target.value })}
                          className="px-2 py-1.5 rounded-lg border border-slate-300"
                        >
                          <option value="Fixed">PKR</option>
                          <option value="Percent">% Basic</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Conveyance Allowance</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="any"
                          value={structForm.conveyance_allowance}
                          onChange={(e) => setStructForm({ ...structForm, conveyance_allowance: e.target.value })}
                          placeholder="Amount or %"
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                        />
                        <select
                          value={structForm.conveyance_allowance_type}
                          onChange={(e) => setStructForm({ ...structForm, conveyance_allowance_type: e.target.value })}
                          className="px-2 py-1.5 rounded-lg border border-slate-300"
                        >
                          <option value="Fixed">PKR</option>
                          <option value="Percent">% Basic</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Other Allowances (PKR)</label>
                      <input
                        type="number"
                        step="any"
                        value={structForm.other_allowance}
                        onChange={(e) => setStructForm({ ...structForm, other_allowance: e.target.value })}
                        placeholder="Optional other allowance"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Default Monthly Bonus / Incentive</label>
                      <input
                        type="number"
                        step="any"
                        value={structForm.default_bonus}
                        onChange={(e) => setStructForm({ ...structForm, default_bonus: e.target.value })}
                        placeholder="Optional bonus"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Absent Deduction Method</label>
                      <select
                        value={structForm.absent_deduction_method}
                        onChange={(e) => setStructForm({ ...structForm, absent_deduction_method: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      >
                        <option value="Per_Day_Basic">Per-Day Basic Salary (Basic / 30)</option>
                        <option value="Per_Day_Gross">Per-Day Gross Salary (Gross / 30)</option>
                        <option value="Fixed_Rate">Fixed Rate per Absent Day</option>
                        <option value="None">No Absent Deduction</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Late Arrival Deduction Method</label>
                      <select
                        value={structForm.late_deduction_method}
                        onChange={(e) => setStructForm({ ...structForm, late_deduction_method: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                      >
                        <option value="Per_3_Lates_1_Day">Every 3 Late Arrivals = 1 Day Basic Deduction</option>
                        <option value="Fixed_Per_Late">Fixed Rate per Late Arrival</option>
                        <option value="None">No Late Deduction</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setEditingStructure(null)}
                      className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                    >
                      Save Salary Structure
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 6: MONTHLY PAYROLL PROCESSING                                   */}
      {/* =================================================================== */}
      {activeTab === 'payroll-processing' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-700">
                Payroll Period: {MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear}
              </span>
              <select
                value={processFilterEmpId}
                onChange={(e) => setProcessFilterEmpId(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold"
              >
                <option value="0">All Active Employees</option>
                {employees
                  .filter((e) => e.employment_status === 'Active')
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.full_name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGeneratePayroll}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Wallet className="w-4 h-4" />
                <span>
                  Generate / Process Payroll ({MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear})
                </span>
              </button>
              <button
                type="button"
                onClick={handleFinalizeAllMonthPayrolls}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>Finalize All Pending Payrolls</span>
              </button>
            </div>
          </div>

          {/* Processed / Finalized Payroll Sheet for Selected Month */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase text-slate-800">
                Monthly Payroll Sheet — {MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear}
              </h3>
              <span className="text-[11px] text-slate-500">
                Finalizing accrues salary to Staff Salary Payable (LIA-2030) and Staff Salaries Expense (EXP-5030)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-2.5 text-left">Payroll Code</th>
                    <th className="py-2.5 px-2.5 text-left">Employee</th>
                    <th className="py-2.5 px-2.5 text-right">Attendance (P/A/L)</th>
                    <th className="py-2.5 px-2.5 text-right">Basic</th>
                    <th className="py-2.5 px-2.5 text-right">Allowances + OT</th>
                    <th className="py-2.5 px-2.5 text-right">Gross Salary</th>
                    <th className="py-2.5 px-2.5 text-right">Deductions (Adv/Loan)</th>
                    <th className="py-2.5 px-2.5 text-right">Net Payable</th>
                    <th className="py-2.5 px-2.5 text-right">Paid / Rem</th>
                    <th className="py-2.5 px-2.5 text-center">Status</th>
                    <th className="py-2.5 px-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {payrollRecords.map((pr) => {
                    const additions =
                      Number(pr.house_allowance || 0) +
                      Number(pr.medical_allowance || 0) +
                      Number(pr.conveyance_allowance || 0) +
                      Number(pr.other_allowances || 0) +
                      Number(pr.overtime_amount || 0) +
                      Number(pr.bonus_amount || 0);
                    return (
                      <tr key={pr.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-2.5 font-mono font-bold text-indigo-700">
                          <div>{pr.payroll_code}</div>
                          {pr.journal_entry_number && (
                            <div className="text-[10px] text-emerald-700">{pr.journal_entry_number}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-bold text-slate-900">{pr.full_name}</div>
                          <div className="text-[11px] text-slate-500">
                            {pr.employee_code} • {pr.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono">
                          P:{pr.present_days} / A:{pr.absent_days} / L:{Number(pr.paid_leaves) + Number(pr.unpaid_leaves)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono">{formatPKR(pr.basic_salary)}</td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700">{formatPKR(additions)}</td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold">{formatPKR(pr.gross_salary)}</td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-rose-700">
                          <div>{formatPKR(pr.total_deductions)}</div>
                          {(Number(pr.advance_recovery) > 0 || Number(pr.loan_recovery) > 0) && (
                            <div className="text-[10px] text-slate-500">
                              Adv:{pr.advance_recovery} | Loan:{pr.loan_recovery}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-black text-slate-900">
                          {formatPKR(pr.net_salary)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-[11px]">
                          <div className="text-emerald-700">Paid: {formatPKR(pr.paid_amount)}</div>
                          <div className="font-bold text-amber-700">Rem: {formatPKR(pr.remaining_amount)}</div>
                        </td>
                        <td className="py-2.5 px-2.5 text-center space-y-1">
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                pr.status === 'Finalized'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : pr.status === 'Reopened'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              {pr.status}
                            </span>
                          </div>
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                pr.payment_status === 'Paid'
                                  ? 'bg-emerald-600 text-white'
                                  : pr.payment_status === 'Partially Paid'
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {pr.payment_status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {pr.status !== 'Finalized' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingPayrollRow({ ...pr })}
                                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                                >
                                  Adjust
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleFinalizeSinglePayroll(pr.id)}
                                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                >
                                  Finalize
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSlipPayrollId(pr.id);
                                    loadSalarySlipDetail(pr.id);
                                    switchTab('payroll-slips');
                                  }}
                                  className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold cursor-pointer"
                                >
                                  Slip
                                </button>
                                {Number(pr.remaining_amount) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPaymentForm((prev) => ({
                                        ...prev,
                                        payroll_id: String(pr.id),
                                        payment_amount: String(pr.remaining_amount),
                                      }));
                                      switchTab('payroll-payments');
                                    }}
                                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                  >
                                    Pay
                                  </button>
                                )}
                                {Number(pr.paid_amount) === 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReopenTargetRow(pr);
                                      setReopenReason('');
                                    }}
                                    className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold cursor-pointer"
                                    title="Reopen Finalized Payroll"
                                  >
                                    <Unlock className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {payrollRecords.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-400">
                        No payroll processed for {MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear} yet. Review the
                        preview below and click &ldquo;Generate / Process Payroll&rdquo;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Calculation Preview Table */}
          {payrollPreviews.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-700 mb-3">
                Automatic Calculation Preview ({MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="py-2 px-2 text-left">Emp ID</th>
                      <th className="py-2 px-2 text-left">Employee Name</th>
                      <th className="py-2 px-2 text-right">Basic</th>
                      <th className="py-2 px-2 text-right">Allowances</th>
                      <th className="py-2 px-2 text-right">Overtime</th>
                      <th className="py-2 px-2 text-right">Gross</th>
                      <th className="py-2 px-2 text-right">Abs/Late Ded</th>
                      <th className="py-2 px-2 text-right">Adv/Loan Rec</th>
                      <th className="py-2 px-2 text-right">Net Payable</th>
                      <th className="py-2 px-2 text-center">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollPreviews.map((pv) => (
                      <tr key={pv.employee_id}>
                        <td className="py-1.5 px-2 font-mono font-bold">{pv.employee_code}</td>
                        <td className="py-1.5 px-2 font-semibold">{pv.full_name}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{formatPKR(pv.basic_salary)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {formatPKR(
                            pv.house_allowance + pv.medical_allowance + pv.conveyance_allowance + pv.other_allowances
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{formatPKR(pv.overtime_amount)}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold">{formatPKR(pv.gross_salary)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-rose-700">
                          {formatPKR(pv.absent_deduction + pv.late_deduction + pv.unpaid_leave_deduction)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-amber-700">
                          {formatPKR(pv.advance_recovery + pv.loan_recovery)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-black text-emerald-700">
                          {formatPKR(pv.net_salary)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {pv.existing_payroll_id ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Already Generated ({pv.existing_status})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                              Ready to Generate
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Adjust Payroll Modal */}
          {editingPayrollRow && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    Adjust Payroll — {editingPayrollRow.full_name} ({editingPayrollRow.payroll_code})
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditingPayrollRow(null)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleSavePayrollAdjustment} className="space-y-3 mt-4 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-bold mb-1">Basic Salary</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.basic_salary}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, basic_salary: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">House Allowance</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.house_allowance}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, house_allowance: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Medical Allowance</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.medical_allowance}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, medical_allowance: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Conveyance Allowance</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.conveyance_allowance}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, conveyance_allowance: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Overtime Pay</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.overtime_amount}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, overtime_amount: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Bonus / Incentive</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.bonus_amount}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, bonus_amount: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Absent Deduction</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.absent_deduction}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, absent_deduction: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Advance Recovery</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.advance_recovery}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, advance_recovery: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Loan Recovery</label>
                      <input
                        type="number"
                        step="any"
                        value={editingPayrollRow.loan_recovery}
                        onChange={(e) =>
                          setEditingPayrollRow({ ...editingPayrollRow, loan_recovery: Number(e.target.value) })
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setEditingPayrollRow(null)}
                      className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold">
                      Recalculate & Save
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Reopen Finalized Payroll Modal */}
          {reopenTargetRow && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Reopen Finalized Payroll — {reopenTargetRow.payroll_code}
                </h3>
                <p className="text-xs text-slate-600">
                  Reopening reverses the salary accrual journal entry and restores any advance/loan recoveries linked to
                  this payroll so you can adjust and re-finalize cleanly.
                </p>
                <form onSubmit={handleConfirmReopenPayroll} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Audit Reason for Reopening *</label>
                    <input
                      type="text"
                      required
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="e.g. Overtime adjustment needed before disbursement"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setReopenTargetRow(null)}
                      className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-amber-600 text-white font-bold">
                      Confirm Reopen
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 7: SALARY PAYMENT                                               */}
      {/* =================================================================== */}
      {activeTab === 'payroll-payments' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Salary Payment Entry Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-800 border-b border-slate-200 pb-2">
              Record Salary Payment (Full or Partial)
            </h3>
            <form onSubmit={handleRecordSalaryPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Select Finalized Unpaid / Partially Paid Payroll *
                </label>
                <select
                  required
                  value={paymentForm.payroll_id}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const found = payrollRecords.find((r) => String(r.id) === pid);
                    setPaymentForm({
                      ...paymentForm,
                      payroll_id: pid,
                      payment_amount: found ? String(found.remaining_amount) : '',
                    });
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="">-- Select Employee Payroll --</option>
                  {payrollRecords
                    .filter((r) => r.status === 'Finalized' && Number(r.remaining_amount) > 0)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.employee_code} — {r.full_name} ({r.period_label}) — Rem: {formatPKR(r.remaining_amount)}
                      </option>
                    ))}
                </select>
              </div>

              {selectedPayablePayroll && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Net Salary Payable:</span>
                    <span className="font-mono font-bold">{formatPKR(selectedPayablePayroll.net_salary)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Previously Paid Amount:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {formatPKR(selectedPayablePayroll.paid_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Remaining Payable Before Payment:</span>
                    <span className="font-mono font-bold text-amber-700">
                      {formatPKR(selectedPayablePayroll.remaining_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-700 font-bold">Remaining Balance After This Payment:</span>
                    <span className="font-mono font-black text-indigo-700">
                      {formatPKR(
                        Math.max(
                          0,
                          Number(selectedPayablePayroll.remaining_amount) - (Number(paymentForm.payment_amount) || 0)
                        )
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Current Payment Amount *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={paymentForm.payment_amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_amount: e.target.value })}
                    placeholder="Enter payment amount"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Mode</label>
                  <select
                    value={paymentForm.payment_mode}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_mode: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Online">Online</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Financial Account (Cash/Bank) *</label>
                  <select
                    required
                    value={paymentForm.financial_account_id}
                    onChange={(e) => setPaymentForm({ ...paymentForm, financial_account_id: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  >
                    {financialAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.account_code} — {acc.account_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Reference / Cheque / Txn No</label>
                <input
                  type="text"
                  value={paymentForm.reference_number}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })}
                  placeholder="Optional voucher/bank reference"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={paymentForm.remarks}
                  onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                  placeholder="Payment narration..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                Post Salary Payment & Update Ledgers
              </button>
            </form>
          </div>

          {/* Salary Payment Register */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase text-slate-800 mb-3">
              Salary Payment Register ({MONTH_OPTIONS[selectedMonth - 1]?.label} {selectedYear})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2 px-2.5 text-left">Voucher</th>
                    <th className="py-2 px-2.5 text-center">Date</th>
                    <th className="py-2 px-2.5 text-left">Employee</th>
                    <th className="py-2 px-2.5 text-left">Account / Mode</th>
                    <th className="py-2 px-2.5 text-right">Paid Amount</th>
                    <th className="py-2 px-2.5 text-right">Remaining After</th>
                    <th className="py-2 px-2.5 text-right">Slip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {salaryPayments.map((sp) => (
                    <tr key={sp.id} className="hover:bg-slate-50">
                      <td className="py-2 px-2.5 font-mono font-bold text-emerald-700">
                        <div>{sp.payment_code}</div>
                        <div className="text-[10px] text-slate-500">{sp.journal_entry_number}</div>
                      </td>
                      <td className="py-2 px-2.5 text-center font-mono">{sp.payment_date}</td>
                      <td className="py-2 px-2.5">
                        <div className="font-bold text-slate-900">{sp.full_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {sp.employee_code} • {sp.period_label}
                        </div>
                      </td>
                      <td className="py-2 px-2.5">
                        <div className="font-semibold">{sp.financial_account_name}</div>
                        <div className="text-[11px] text-slate-500">{sp.payment_mode}</div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">
                        {formatPKR(sp.payment_amount)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono text-amber-700">
                        {formatPKR(sp.remaining_balance_after)}
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSlipPayrollId(sp.payroll_id);
                            loadSalarySlipDetail(sp.payroll_id);
                            switchTab('payroll-slips');
                          }}
                          className="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold cursor-pointer"
                        >
                          Salary Slip
                        </button>
                      </td>
                    </tr>
                  ))}
                  {salaryPayments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No salary payments recorded for this period yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 8: EMPLOYEE ADVANCES & LOANS                                    */}
      {/* =================================================================== */}
      {activeTab === 'payroll-advances-loans' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Disburse Advance / Loan Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-800 border-b border-slate-200 pb-2">
              Disburse Salary Advance or Employee Loan
            </h3>
            <form onSubmit={handleDisburseAdvanceLoan} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Employee *</label>
                <select
                  required
                  value={advLoanForm.employee_id}
                  onChange={(e) => setAdvLoanForm({ ...advLoanForm, employee_id: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Transaction Type *</label>
                  <select
                    value={advLoanForm.transaction_type}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, transaction_type: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                  >
                    <option value="Advance">Salary Advance (AST-1060)</option>
                    <option value="Loan">Employee Loan (AST-1070)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Disbursement Date</label>
                  <input
                    type="date"
                    required
                    value={advLoanForm.disbursement_date}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, disbursement_date: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Principal Amount (PKR) *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={advLoanForm.principal_amount}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, principal_amount: e.target.value })}
                    placeholder="Enter amount"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Monthly Recovery Installment</label>
                  <input
                    type="number"
                    step="any"
                    value={advLoanForm.monthly_installment}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, monthly_installment: e.target.value })}
                    placeholder="Full or monthly amount"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Mode</label>
                  <select
                    value={advLoanForm.payment_mode}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, payment_mode: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Paid From Account *</label>
                  <select
                    required
                    value={advLoanForm.financial_account_id}
                    onChange={(e) => setAdvLoanForm({ ...advLoanForm, financial_account_id: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  >
                    {financialAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.account_code} — {acc.account_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={advLoanForm.auto_recover_in_payroll}
                  onChange={(e) => setAdvLoanForm({ ...advLoanForm, auto_recover_in_payroll: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span className="font-semibold text-slate-700">
                  Automatically deduct monthly installment during Monthly Payroll Processing
                </span>
              </label>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={advLoanForm.remarks}
                  onChange={(e) => setAdvLoanForm({ ...advLoanForm, remarks: e.target.value })}
                  placeholder="Optional remarks..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                Disburse & Post Accounting Voucher
              </button>
            </form>
          </div>

          {/* Advances & Loans Ledger */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase text-slate-800 mb-3">
                Employee Advances & Loans Register
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="py-2 px-2.5 text-left">Voucher</th>
                      <th className="py-2 px-2.5 text-left">Type</th>
                      <th className="py-2 px-2.5 text-left">Employee</th>
                      <th className="py-2 px-2.5 text-right">Principal</th>
                      <th className="py-2 px-2.5 text-right">Installment/Mo</th>
                      <th className="py-2 px-2.5 text-right">Recovered</th>
                      <th className="py-2 px-2.5 text-right">Remaining</th>
                      <th className="py-2 px-2.5 text-center">Status</th>
                      <th className="py-2 px-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {advancesLoans.map((al) => (
                      <tr key={al.id} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-mono font-bold text-indigo-700">
                          <div>{al.voucher_code}</div>
                          <div className="text-[10px] text-slate-500">{al.disbursement_date}</div>
                        </td>
                        <td className="py-2 px-2.5 font-bold">{al.transaction_type}</td>
                        <td className="py-2 px-2.5">
                          <div className="font-bold text-slate-900">{al.full_name}</div>
                          <div className="text-[11px] text-slate-500">{al.employee_code}</div>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold">
                          {formatPKR(al.principal_amount)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">{formatPKR(al.monthly_installment)}</td>
                        <td className="py-2 px-2.5 text-right font-mono text-emerald-700">
                          {formatPKR(al.recovered_amount)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-black text-amber-700">
                          {formatPKR(al.remaining_balance)}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              al.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {al.status}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {al.status === 'Active' && Number(al.remaining_balance) > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setDirectRecoveryTarget(al);
                                setDirectRecoveryAmount(String(Math.min(al.remaining_balance, al.monthly_installment)));
                              }}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                            >
                              Direct Receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {advancesLoans.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          No advances or loans disbursed yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {advanceRecoveries.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <h3 className="text-xs font-bold uppercase text-slate-800 mb-3">
                  Advance & Loan Installment Recovery Ledger
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="py-2 px-2 text-left">Date</th>
                        <th className="py-2 px-2 text-left">Voucher</th>
                        <th className="py-2 px-2 text-left">Employee</th>
                        <th className="py-2 px-2 text-left">Method</th>
                        <th className="py-2 px-2 text-right">Recovered Amount</th>
                        <th className="py-2 px-2 text-left">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {advanceRecoveries.map((rec) => (
                        <tr key={rec.id}>
                          <td className="py-1.5 px-2 font-mono">{rec.recovery_date}</td>
                          <td className="py-1.5 px-2 font-mono font-bold">{rec.voucher_code}</td>
                          <td className="py-1.5 px-2 font-semibold">{rec.full_name}</td>
                          <td className="py-1.5 px-2">{rec.recovery_method}</td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-700">
                            {formatPKR(rec.amount)}
                          </td>
                          <td className="py-1.5 px-2 text-slate-500">{rec.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {directRecoveryTarget && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Direct Recovery Receipt — {directRecoveryTarget.voucher_code} ({directRecoveryTarget.full_name})
                </h3>
                <form onSubmit={handleDirectRecoverySubmit} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold mb-1">
                      Recovery Amount (Remaining: {formatPKR(directRecoveryTarget.remaining_balance)})
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={directRecoveryAmount}
                      onChange={(e) => setDirectRecoveryAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDirectRecoveryTarget(null)}
                      className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold">
                      Post Recovery Receipt
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 9: SALARY SLIP (PRINTABLE A4 & EXPORTABLE)                      */}
      {/* =================================================================== */}
      {activeTab === 'payroll-slips' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-700">Select Employee Salary Slip:</label>
              <select
                value={selectedSlipPayrollId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedSlipPayrollId(id);
                  loadSalarySlipDetail(id);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold min-w-[280px]"
              >
                <option value={0}>-- Choose Processed / Finalized Payroll --</option>
                {payrollRecords.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.payroll_code} — {pr.employee_code} {pr.full_name} ({pr.period_label})
                  </option>
                ))}
              </select>
            </div>

            {salarySlipData && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print A4 Salary Slip / Save PDF</span>
                </button>
              </div>
            )}
          </div>

          {salarySlipData?.payroll ? (
            <div className="bg-white rounded-2xl border border-slate-300 shadow-sm max-w-4xl mx-auto p-8 print:shadow-none print:border-0 print:p-2 space-y-6">
              {/* Store Header */}
              <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-900 uppercase">
                    {salarySlipData.company?.store_name || 'ABRAR MEDICAL STORE'}
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {salarySlipData.company?.address || 'Main Commercial Market'} • Phone:{' '}
                    {salarySlipData.company?.phone || '+92 42 35789000'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="inline-block px-3 py-1 rounded bg-slate-900 text-white text-xs font-black uppercase tracking-wider">
                    EMPLOYEE SALARY SLIP
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-700 mt-1">
                    Period: {salarySlipData.payroll.period_label}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Slip No: {salarySlipData.payroll.payroll_code}
                  </div>
                </div>
              </div>

              {/* Employee Bio Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Employee ID</div>
                  <div className="font-mono font-black text-emerald-700 text-sm">
                    {salarySlipData.payroll.employee_code}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Employee Name</div>
                  <div className="font-bold text-slate-900">{salarySlipData.payroll.full_name}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Father Name</div>
                  <div className="font-semibold text-slate-800">{salarySlipData.payroll.father_name || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Designation & Dept</div>
                  <div className="font-semibold text-slate-800">
                    {salarySlipData.payroll.designation} ({salarySlipData.payroll.department})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">CNIC</div>
                  <div className="font-mono text-slate-800">{salarySlipData.payroll.cnic || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Attendance Breakdown</div>
                  <div className="font-mono text-slate-800">
                    Work: {salarySlipData.payroll.working_days}d | Pres: {salarySlipData.payroll.present_days}d | Abs:{' '}
                    {salarySlipData.payroll.absent_days}d
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Leaves & Overtime</div>
                  <div className="font-mono text-slate-800">
                    Leaves: {Number(salarySlipData.payroll.paid_leaves) + Number(salarySlipData.payroll.unpaid_leaves)}d
                    | OT: {salarySlipData.payroll.overtime_hours}h
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500 font-bold">Payment Status</div>
                  <div className="font-bold text-emerald-700">{salarySlipData.payroll.payment_status}</div>
                </div>
              </div>

              {/* Earnings vs Deductions Two-Column Table */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-300 rounded-xl overflow-hidden">
                  <div className="bg-emerald-900 text-white px-3 py-2 text-xs font-bold uppercase flex justify-between">
                    <span>Earnings & Allowances</span>
                    <span>Amount (PKR)</span>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    <div className="px-3 py-2 flex justify-between">
                      <span>Basic Monthly Salary</span>
                      <span className="font-mono font-semibold">
                        {formatPKR(salarySlipData.payroll.basic_salary)}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>House Rent Allowance</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.house_allowance)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Medical Allowance</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.medical_allowance)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Conveyance Allowance</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.conveyance_allowance)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Other Allowances</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.other_allowances)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Overtime Payment ({salarySlipData.payroll.overtime_hours} hrs)</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.overtime_amount)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Bonus / Incentives</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.bonus_amount)}</span>
                    </div>
                    <div className="px-3 py-2.5 bg-emerald-50 font-bold flex justify-between text-emerald-950">
                      <span>Total Gross Salary</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.gross_salary)}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-xl overflow-hidden">
                  <div className="bg-rose-900 text-white px-3 py-2 text-xs font-bold uppercase flex justify-between">
                    <span>Deductions & Recoveries</span>
                    <span>Amount (PKR)</span>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    <div className="px-3 py-2 flex justify-between">
                      <span>Absent Deduction ({salarySlipData.payroll.absent_days}d)</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.absent_deduction)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Late Arrival Deduction ({salarySlipData.payroll.late_count} lates)</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.late_deduction)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Unpaid Leave Deduction ({salarySlipData.payroll.unpaid_leaves}d)</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.unpaid_leave_deduction)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Salary Advance Recovery</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.advance_recovery)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Employee Loan Installment Recovery</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.loan_recovery)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between">
                      <span>Other Deductions</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.other_deductions)}</span>
                    </div>
                    <div className="px-3 py-2 flex justify-between text-slate-400">
                      <span>-</span>
                      <span>-</span>
                    </div>
                    <div className="px-3 py-2.5 bg-rose-50 font-bold flex justify-between text-rose-950">
                      <span>Total Deductions</span>
                      <span className="font-mono">{formatPKR(salarySlipData.payroll.total_deductions)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Payable & Payment Summary Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900 text-white p-4 rounded-xl">
                <div>
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Net Payable Salary</div>
                  <div className="text-xl font-mono font-black text-emerald-400">
                    {formatPKR(salarySlipData.payroll.net_salary)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Total Paid Amount</div>
                  <div className="text-xl font-mono font-black text-white">
                    {formatPKR(salarySlipData.payroll.paid_amount)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Remaining Payable Balance</div>
                  <div className="text-xl font-mono font-black text-amber-400">
                    {formatPKR(salarySlipData.payroll.remaining_amount)}
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-3 gap-8 pt-10 text-xs text-center text-slate-600">
                <div className="border-t border-slate-400 pt-2 font-semibold">Prepared By (HR / Accounts)</div>
                <div className="border-t border-slate-400 pt-2 font-semibold">Approved By (Super Admin)</div>
                <div className="border-t border-slate-400 pt-2 font-semibold">Employee Signature & Thumb</div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-xs">
              Select a processed or finalized payroll record above to view and print its official A4 Salary Slip.
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 10: ALL 25 PAYROLL & HR REPORTS                                 */}
      {/* =================================================================== */}
      {activeTab === 'payroll-reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left Report Selector (25 Reports) */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-3 max-h-[82vh] overflow-y-auto print:hidden">
            {(['Employee Reports', 'Attendance Reports', 'Payroll Reports'] as const).map((groupName) => (
              <div key={groupName}>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 mb-1">
                  {groupName}
                </div>
                <div className="space-y-0.5">
                  {REPORT_CATALOG.filter((r) => r.group === groupName).map((rep) => {
                    const active = activeReportKey === rep.key;
                    return (
                      <button
                        key={rep.key}
                        type="button"
                        onClick={() => setActiveReportKey(rep.key)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer ${
                          active
                            ? 'bg-emerald-600 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${
                            active ? 'bg-emerald-800 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {rep.number}
                        </span>
                        <span className="truncate">{rep.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Right Report Content & Export */}
          <div className="lg:col-span-3 space-y-3">
            {/* Filters & Export Bar */}
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs space-y-3 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black text-slate-900">{reportData?.title || 'Payroll & HR Report'}</h2>
                  <p className="text-[11px] text-slate-500">
                    Category: {reportData?.category} • Showing {sortedReportRows.length} record(s)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportReportExcel}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / PDF</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
                <input
                  type="text"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Search in report..."
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300"
                />
                <select
                  value={reportEmpId}
                  onChange={(e) => setReportEmpId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="0">All Employees</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.full_name}
                    </option>
                  ))}
                </select>
                <select
                  value={reportDept}
                  onChange={(e) => setReportDept(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300"
                >
                  <option value="all">All Departments</option>
                  {DEPARTMENT_SUGGESTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            {/* Summary Strip */}
            {reportData?.summary && Object.keys(reportData.summary).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {Object.entries(reportData.summary).map(([k, v]) => (
                  <div key={k} className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs">
                    <div className="text-[10px] font-bold uppercase text-slate-500">
                      {k.replace(/_/g, ' ')}
                    </div>
                    <div className="text-sm font-mono font-black text-slate-900 mt-0.5">
                      {k.includes('salary') ||
                      k.includes('amount') ||
                      k.includes('paid') ||
                      k.includes('gross') ||
                      k.includes('net') ||
                      k.includes('deduction') ||
                      k.includes('allowances') ||
                      k.includes('disbursed') ||
                      k.includes('recovered') ||
                      k.includes('outstanding') ||
                      k.includes('payable') ||
                      k.includes('expense') ||
                      k.includes('credit') ||
                      k.includes('debit') ||
                      k.includes('remaining')
                        ? formatPKR(v)
                        : String(v)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Report Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900 text-white">
                      <th className="py-2.5 px-2.5 text-left w-10">#</th>
                      {(reportData?.columns || []).map((col: any) => (
                        <th
                          key={col.key}
                          onClick={() => {
                            if (reportSortCol === col.key) {
                              setReportSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            } else {
                              setReportSortCol(col.key);
                              setReportSortDir('asc');
                            }
                          }}
                          className={`py-2.5 px-2.5 cursor-pointer select-none ${
                            col.align === 'right'
                              ? 'text-right'
                              : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <span>{col.label}</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedReportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-mono text-slate-400">{idx + 1}</td>
                        {(reportData?.columns || []).map((col: any) => {
                          const val = row[col.key];
                          const isMoney =
                            col.align === 'right' &&
                            (col.key.includes('salary') ||
                              col.key.includes('allowance') ||
                              col.key.includes('amount') ||
                              col.key.includes('deduction') ||
                              col.key.includes('recovery') ||
                              col.key.includes('balance') ||
                              col.key.includes('installment') ||
                              col.key.includes('basic') ||
                              col.key.includes('gross') ||
                              col.key.includes('net') ||
                              col.key.includes('paid') ||
                              col.key.includes('payable'));
                          return (
                            <td
                              key={col.key}
                              className={`py-2 px-2.5 ${
                                col.align === 'right'
                                  ? 'text-right font-mono'
                                  : col.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                              }`}
                            >
                              {isMoney ? formatPKR(val) : String(val ?? '-')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {sortedReportRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={(reportData?.columns?.length || 1) + 1}
                          className="py-10 text-center text-slate-400"
                        >
                          No records found for this report and filter selection.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
