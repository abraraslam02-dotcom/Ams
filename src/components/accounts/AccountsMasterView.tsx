import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users2,
  Search,
  Plus,
  Download,
  Upload,
  RefreshCw,
  Edit2,
  Trash2,
  Eye,
  GitBranch,
  Scale,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  Lock,
  Phone,
  MapPin,
  Layers,
  CornerDownRight,
} from 'lucide-react';
import {
  Account,
  AccountStats,
  MainAccountGroup,
  MAIN_ACCOUNT_GROUPS,
  STANDARD_ACCOUNT_GROUPS,
  ParentAccountCandidate,
} from '../../types/account';
import { api } from '../../services/api';
import { AccountFormModal } from './AccountFormModal';
import { AccountViewModal } from './AccountViewModal';
import { OpeningBalanceModal } from './OpeningBalanceModal';
import { AccountsExcelImportModal } from './AccountsExcelImportModal';
import { exportAccountsToExcel } from '../../utils/accountExcel';
import { formatPKR } from '../../utils/formatters';

interface AccountsMasterViewProps {
  initialLedgerView?: 'all' | 'customer' | 'supplier';
  initialHierarchyMode?: boolean;
}

export const AccountsMasterView: React.FC<AccountsMasterViewProps> = ({
  initialLedgerView = 'all',
  initialHierarchyMode = true,
}) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<AccountStats>({
    totalAccounts: 0,
    activeAccounts: 0,
    partyAccountsCount: 0,
    financialAccountsCount: 0,
    incomeExpenseCount: 0,
    customerLedgerCount: 0,
    supplierLedgerCount: 0,
    totalOpeningDebit: 0,
    totalOpeningCredit: 0,
    grandTotalDebit: 0,
    grandTotalCredit: 0,
    totalCustomerReceivables: 0,
    totalSupplierPayables: 0,
  });
  const [groupsByMain, setGroupsByMain] = useState<Record<string, string[]>>(
    STANDARD_ACCOUNT_GROUPS
  );
  const [parentCandidates, setParentCandidates] = useState<ParentAccountCandidate[]>([]);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMainGroup, setSelectedMainGroup] = useState<string>('all');
  const [selectedAccountGroup, setSelectedAccountGroup] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedTownId, setSelectedTownId] = useState<string>('all');
  const [selectedAreaId, setSelectedAreaId] = useState<string>('all');
  const [ledgerView, setLedgerView] = useState<'all' | 'customer' | 'supplier'>(initialLedgerView);
  const [hierarchyMode, setHierarchyMode] = useState<boolean>(initialHierarchyMode);
  const [sortBy, setSortBy] = useState<string>('account_code');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Filter option lists
  const [townsFilterList, setTownsFilterList] = useState<
    Array<{ id: number; town_code: string; town_name: string }>
  >([]);
  const [areasFilterList, setAreasFilterList] = useState<
    Array<{ id: number; area_code: string; area_name: string; town_id: number; town_name: string }>
  >([]);

  useEffect(() => {
    setLedgerView(initialLedgerView);
    setHierarchyMode(initialHierarchyMode);
  }, [initialLedgerView, initialHierarchyMode]);

  // Status States
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Modals
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [defaultParentForNew, setDefaultParentForNew] = useState<Account | null>(null);
  const [viewingAccount, setViewingAccount] = useState<Account | null>(null);
  const [isOpeningModalOpen, setIsOpeningModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAccounts({
        q: searchQuery,
        mainGroup: selectedMainGroup,
        accountGroup: selectedAccountGroup,
        status: selectedStatus,
        townId: selectedTownId !== 'all' ? selectedTownId : undefined,
        areaId: selectedAreaId !== 'all' ? selectedAreaId : undefined,
        ledgerView,
        sortBy,
        sortOrder,
      });

      setAccounts(res.accounts || []);
      if (res.stats) setStats(res.stats);
      if (res.filters) {
        if (res.filters.groupsByMain) setGroupsByMain(res.filters.groupsByMain);
        if (res.filters.parentCandidates) setParentCandidates(res.filters.parentCandidates);
        if (Array.isArray(res.filters.towns)) setTownsFilterList(res.filters.towns);
        if (Array.isArray(res.filters.areas)) setAreasFilterList(res.filters.areas);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [
    searchQuery,
    selectedMainGroup,
    selectedAccountGroup,
    selectedStatus,
    selectedTownId,
    selectedAreaId,
    ledgerView,
    sortBy,
    sortOrder,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAccounts();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchAccounts]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('asc');
    }
  };

  // Organize accounts hierarchically when hierarchyMode is active
  const displayAccounts = useMemo(() => {
    if (!hierarchyMode || searchQuery.trim().length > 0) {
      return accounts.map((a) => ({ account: a, depth: 0 }));
    }

    const byId = new Map<number, Account>();
    accounts.forEach((a) => byId.set(a.id, a));

    const childrenMap = new Map<number | null, Account[]>();
    accounts.forEach((a) => {
      const pid = a.parent_account_id && byId.has(a.parent_account_id) ? a.parent_account_id : null;
      const list = childrenMap.get(pid) || [];
      list.push(a);
      childrenMap.set(pid, list);
    });

    const result: Array<{ account: Account; depth: number }> = [];
    const visited = new Set<number>();

    const traverse = (parentId: number | null, depth: number) => {
      const children = childrenMap.get(parentId) || [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        result.push({ account: child, depth });
        traverse(child.id, depth + 1);
      }
    };

    traverse(null, 0);

    // Include any remaining accounts whose parent wasn't in the current filtered set
    accounts.forEach((a) => {
      if (!visited.has(a.id)) {
        result.push({ account: a, depth: 0 });
      }
    });

    return result;
  }, [accounts, hierarchyMode, searchQuery]);

  // Available sub-groups based on selectedMainGroup
  const availableSubGroups = useMemo(() => {
    if (selectedMainGroup === 'all') {
      return [
        ...(groupsByMain['PARTY ACCOUNTS'] || []),
        ...(groupsByMain['FINANCIAL ACCOUNTS'] || []),
        ...(groupsByMain['INCOME & EXPENSE ACCOUNTS'] || []),
      ];
    }
    return groupsByMain[selectedMainGroup] || [];
  }, [selectedMainGroup, groupsByMain]);

  // Dependent areas filtered by selected Town in search bar
  const availableFilterAreas = useMemo(() => {
    if (selectedTownId === 'all') return areasFilterList;
    const tId = parseInt(selectedTownId, 10);
    return areasFilterList.filter((a) => Number(a.town_id) === tId);
  }, [areasFilterList, selectedTownId]);

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setDefaultParentForNew(null);
    setIsFormModalOpen(true);
  };

  const handleOpenAddSubAccount = (parentAcc: Account) => {
    setEditingAccount(null);
    setDefaultParentForNew(parentAcc);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setDefaultParentForNew(null);
    setIsFormModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAccount) return;
    try {
      setIsDeleting(true);
      const res = await api.deleteAccount(deletingAccount.id);
      setSuccessNotice(res.message);
      setDeletingAccount(null);
      fetchAccounts();
      setTimeout(() => setSuccessNotice(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setDeletingAccount(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportExcel = () => {
    if (accounts.length === 0) return;
    exportAccountsToExcel(
      accounts,
      `Abrar_Medical_Store_Accounts_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const getMainGroupBadgeStyle = (mg: MainAccountGroup) => {
    switch (mg) {
      case 'PARTY ACCOUNTS':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      case 'FINANCIAL ACCOUNTS':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'INCOME & EXPENSE ACCOUNTS':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* Top Header & Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <Users2 className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Accounts Master & Chart of Accounts
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              Active Module
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            3-Group Hierarchical Chart of Accounts &bull; Separate Customer & Supplier Ledgers &bull; Debit/Credit Opening Balances
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsOpeningModalOpen(true)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Manage Opening Balances (Debit & Credit) across all accounts"
          >
            <Scale className="w-3.5 h-3.5 text-emerald-400" />
            <span>Opening Balances</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-600" />
            <span>Import Excel</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Account</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-rose-700 hover:text-rose-950 font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Accounting Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Total Accounts
          </span>
          <div className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">
            {stats.totalAccounts}
          </div>
          <span className="text-[10px] text-emerald-700 font-semibold">
            {stats.activeAccounts} Active Heads
          </span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
            Party Accounts
          </span>
          <div className="text-xl font-extrabold text-purple-900 font-mono mt-0.5">
            {stats.partyAccountsCount}
          </div>
          <span className="text-[10px] text-slate-500">
            {stats.customerLedgerCount} Cust &bull; {stats.supplierLedgerCount} Sup
          </span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Financial & Inc/Exp
          </span>
          <div className="text-xl font-extrabold text-blue-900 font-mono mt-0.5">
            {stats.financialAccountsCount + stats.incomeExpenseCount}
          </div>
          <span className="text-[10px] text-slate-500">
            {stats.financialAccountsCount} Fin &bull; {stats.incomeExpenseCount} P&L
          </span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            Total Debit (Dr)
          </span>
          <div className="text-sm font-extrabold text-emerald-900 font-mono truncate mt-1">
            {formatPKR(stats.grandTotalDebit)}
          </div>
          <span className="text-[10px] text-slate-500">Opening + Ledger Dr</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
            Total Credit (Cr)
          </span>
          <div className="text-sm font-extrabold text-blue-900 font-mono truncate mt-1">
            {formatPKR(stats.grandTotalCredit)}
          </div>
          <span className="text-[10px] text-slate-500">Opening + Ledger Cr</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Party Receivables / Payables
          </span>
          <div className="text-[11px] font-bold text-emerald-800 font-mono truncate mt-1">
            Rec: {formatPKR(stats.totalCustomerReceivables)}
          </div>
          <div className="text-[11px] font-bold text-blue-800 font-mono truncate">
            Pay: {formatPKR(stats.totalSupplierPayables)}
          </div>
        </div>
      </div>

      {/* 3 Main Account Groups Selector Tabs + Separate Customer/Supplier Ledger Switch */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          {/* 3 Main Account Groups */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                setSelectedMainGroup('all');
                setSelectedAccountGroup('all');
                setLedgerView('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMainGroup === 'all' && ledgerView === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Groups ({stats.totalAccounts})
            </button>

            <button
              onClick={() => {
                setSelectedMainGroup('PARTY ACCOUNTS');
                setSelectedAccountGroup('all');
                setLedgerView('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMainGroup === 'PARTY ACCOUNTS'
                  ? 'bg-purple-700 text-white shadow-2xs'
                  : 'bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100'
              }`}
            >
              1. PARTY ACCOUNTS ({stats.partyAccountsCount})
            </button>

            <button
              onClick={() => {
                setSelectedMainGroup('FINANCIAL ACCOUNTS');
                setSelectedAccountGroup('all');
                setLedgerView('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMainGroup === 'FINANCIAL ACCOUNTS'
                  ? 'bg-blue-700 text-white shadow-2xs'
                  : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              2. FINANCIAL ACCOUNTS ({stats.financialAccountsCount})
            </button>

            <button
              onClick={() => {
                setSelectedMainGroup('INCOME & EXPENSE ACCOUNTS');
                setSelectedAccountGroup('all');
                setLedgerView('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMainGroup === 'INCOME & EXPENSE ACCOUNTS'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              3. INCOME & EXPENSE ({stats.incomeExpenseCount})
            </button>
          </div>

          {/* Separate Customer Ledger vs Supplier Ledger View Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase mr-1">
              Sub-Ledgers:
            </span>
            <button
              onClick={() => {
                setLedgerView(ledgerView === 'customer' ? 'all' : 'customer');
                setSelectedMainGroup('PARTY ACCOUNTS');
                setSelectedAccountGroup('all');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                ledgerView === 'customer'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
              title="Includes both Customer and Dual Customer & Supplier accounts"
            >
              Customer Ledger ({stats.customerLedgerCount})
            </button>

            <button
              onClick={() => {
                setLedgerView(ledgerView === 'supplier' ? 'all' : 'supplier');
                setSelectedMainGroup('PARTY ACCOUNTS');
                setSelectedAccountGroup('all');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                ledgerView === 'supplier'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-50/70 text-blue-800 border-blue-200 hover:bg-blue-100'
              }`}
              title="Includes both Supplier and Dual Customer & Supplier accounts"
            >
              Supplier Ledger ({stats.supplierLedgerCount})
            </button>
          </div>
        </div>

        {/* Search, Sub-Group Filter, Status Filter & Hierarchy Toggle */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Fast search by Code, Name, Town, Area, Phone, Address..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>

          {/* Sub-Group Filter */}
          <div className="md:col-span-3">
            <select
              value={selectedAccountGroup}
              onChange={(e) => setSelectedAccountGroup(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Account Sub-Groups</option>
              {availableSubGroups.map((sg) => (
                <option key={sg} value={sg}>
                  {sg}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>

          {/* Hierarchy Mode & Refresh */}
          <div className="md:col-span-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setHierarchyMode(!hierarchyMode)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                hierarchyMode
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
              }`}
              title="Toggle Hierarchical Parent / Sub-Account Tree indentation"
            >
              <GitBranch className="w-3.5 h-3.5 text-emerald-600" />
              <span>{hierarchyMode ? 'Hierarchy Tree: ON' : 'Flat List'}</span>
            </button>

            <button
              onClick={fetchAccounts}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Refresh Accounts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Territory Route Filters: Town Master & Dependent Area */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-2.5 border-t border-slate-100">
          <div className="md:col-span-3 flex items-center gap-1.5 text-xs text-slate-600 font-bold">
            <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Territory Route Filter:</span>
          </div>

          {/* Town Filter */}
          <div className="md:col-span-4">
            <select
              value={selectedTownId}
              onChange={(e) => {
                const newTownId = e.target.value;
                setSelectedTownId(newTownId);
                setSelectedAreaId('all');
              }}
              className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Towns ({townsFilterList.length})</option>
              {townsFilterList.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.town_code}] {t.town_name}
                </option>
              ))}
            </select>
          </div>

          {/* Dependent Area Filter */}
          <div className="md:col-span-4">
            <select
              value={selectedAreaId}
              onChange={(e) => setSelectedAreaId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">
                {selectedTownId !== 'all'
                  ? `All Areas in Town (${availableFilterAreas.length})`
                  : `All Areas (${areasFilterList.length})`}
              </option>
              {availableFilterAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.area_code}] {a.area_name}
                </option>
              ))}
            </select>
          </div>

          {/* Reset button */}
          <div className="md:col-span-1 flex justify-end">
            {(selectedTownId !== 'all' || selectedAreaId !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedTownId('all');
                  setSelectedAreaId('all');
                }}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 cursor-pointer underline whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Chart of Accounts Desktop Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider select-none">
                <th
                  onClick={() => handleSort('account_code')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center gap-1">
                    <span>Account Code</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('account_name')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center gap-1">
                    <span>Account Name & Hierarchy</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('main_group')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  Main Group
                </th>
                <th
                  onClick={() => handleSort('account_group')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700"
                >
                  Account Group
                </th>
                <th
                  onClick={() => handleSort('town_name')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700 whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    <span>Town</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('area_name')}
                  className="py-2.5 px-3 cursor-pointer hover:text-emerald-700 whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    <span>Area</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('opening_balance')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Opening Balance</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-2 text-center">Dr / Cr</th>
                <th
                  onClick={() => handleSort('current_balance')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-700"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Net Balance</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-2.5 px-3">Contact & Address</th>
                <th className="py-2.5 px-2.5 text-center">Status</th>
                <th className="py-2.5 px-3 text-right sticky right-0 bg-slate-50 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading && displayAccounts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                    <span>Loading Chart of Accounts...</span>
                  </td>
                </tr>
              ) : displayAccounts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-500">
                    <div className="max-w-md mx-auto space-y-2">
                      <Users2 className="w-8 h-8 text-slate-400 mx-auto" />
                      <div className="font-bold text-slate-800 text-sm">
                        No matching accounts found
                      </div>
                      <p className="text-xs text-slate-500">
                        Adjust your category filter or create a new account under Party, Financial, or Income & Expense groups.
                      </p>
                      <button
                        onClick={handleOpenAdd}
                        className="mt-2 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create New Account</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                displayAccounts.map(({ account: acc, depth }) => {
                  const isProtected =
                    acc.is_system_account === 1 ||
                    (acc.sub_accounts_count || 0) > 0 ||
                    (acc.linked_transactions_count || 0) > 0;

                  // Determine balance display depending on active ledgerView
                  let displayBal = acc.current_balance;
                  let displayBalType = acc.current_balance_type;
                  if (ledgerView === 'customer') {
                    const diff = acc.customer_debit - acc.customer_credit;
                    displayBal = Math.abs(diff);
                    displayBalType = diff >= 0 ? 'Debit' : 'Credit';
                  } else if (ledgerView === 'supplier') {
                    const diff = acc.supplier_credit - acc.supplier_debit;
                    displayBal = Math.abs(diff);
                    displayBalType = diff >= 0 ? 'Credit' : 'Debit';
                  }

                  return (
                    <tr
                      key={acc.id}
                      className={`hover:bg-slate-50/90 transition-colors ${
                        acc.is_system_account === 1 && depth === 0 ? 'bg-slate-50/40' : ''
                      }`}
                    >
                      {/* Account Code */}
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800">
                          {acc.account_code}
                        </span>
                      </td>

                      {/* Account Name & Hierarchy Indentation */}
                      <td className="py-2.5 px-3">
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: `${depth * 18}px` }}
                        >
                          {depth > 0 && (
                            <CornerDownRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{acc.account_name}</span>
                              {(acc.sub_accounts_count || 0) > 0 && (
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 text-slate-700"
                                  title={`${acc.sub_accounts_count} sub-account(s)`}
                                >
                                  {acc.sub_accounts_count} sub
                                </span>
                              )}
                            </div>
                            {acc.parent_account_name && !hierarchyMode && (
                              <div className="text-[10px] text-slate-400">
                                Parent: [{acc.parent_account_code}] {acc.parent_account_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Main Group */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getMainGroupBadgeStyle(
                            acc.main_group
                          )}`}
                        >
                          {acc.main_group === 'PARTY ACCOUNTS'
                            ? 'PARTY'
                            : acc.main_group === 'FINANCIAL ACCOUNTS'
                            ? 'FINANCIAL'
                            : 'INC & EXP'}
                        </span>
                      </td>

                      {/* Account Sub-Group */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            acc.account_group === 'Customer & Supplier'
                              ? 'bg-purple-100 text-purple-900 border border-purple-300 font-bold'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {acc.account_group}
                        </span>
                      </td>

                      {/* Town */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {acc.town_name || acc.city ? (
                          <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                            {acc.town_name || acc.city}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Area */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {acc.area_name ? (
                          <span className="text-[11px] font-medium bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                            {acc.area_name}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Opening Balance */}
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                        {acc.opening_balance > 0
                          ? `Rs. ${acc.opening_balance.toFixed(2)}`
                          : '0.00'}
                      </td>

                      {/* Opening Balance Type (Dr / Cr) */}
                      <td className="py-2.5 px-2 text-center whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            acc.opening_balance_type === 'Debit'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {acc.opening_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                        </span>
                      </td>

                      {/* Current Net Balance */}
                      <td className="py-2.5 px-3 text-right font-mono font-black whitespace-nowrap">
                        <span
                          className={
                            displayBal === 0
                              ? 'text-slate-400 font-normal'
                              : displayBalType === 'Debit'
                              ? 'text-emerald-900'
                              : 'text-blue-900'
                          }
                        >
                          Rs. {displayBal.toFixed(2)}{' '}
                          <span className="text-[10px] font-bold">
                            {displayBal > 0 ? (displayBalType === 'Debit' ? 'Dr' : 'Cr') : ''}
                          </span>
                        </span>
                      </td>

                      {/* Contact & Address */}
                      <td className="py-2.5 px-3 max-w-[210px]">
                        {acc.contact_person || acc.phone || acc.address ? (
                          <div className="truncate space-y-0.5">
                            {(acc.contact_person || acc.phone) && (
                              <div className="text-[11px] text-slate-800 font-medium truncate">
                                {acc.contact_person}
                                {acc.contact_person && acc.phone ? ' • ' : ''}
                                <span className="font-mono text-slate-600">{acc.phone}</span>
                              </div>
                            )}
                            {(acc.address || acc.city) && (
                              <div className="text-[10px] text-slate-500 truncate">
                                {acc.address}
                                {acc.address && acc.city ? `, ${acc.city}` : acc.city}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            acc.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {acc.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 bg-white/95 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewingAccount(acc)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="View Account Ledger & Hierarchy Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleOpenAddSubAccount(acc)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-purple-700 hover:bg-purple-50 transition-colors cursor-pointer"
                            title={`Create Sub-Account under ${acc.account_name}`}
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(acc)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                            title="Edit Account"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => setDeletingAccount(acc)}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              isProtected
                                ? 'text-slate-300 hover:text-amber-600 hover:bg-amber-50'
                                : 'text-slate-400 hover:text-rose-700 hover:bg-rose-50'
                            }`}
                            title={
                              isProtected
                                ? 'Protected Account (Control head, has sub-accounts, or linked to transactions)'
                                : 'Delete Account'
                            }
                          >
                            {isProtected ? (
                              <Lock className="w-3.5 h-3.5" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>
            Showing <strong>{displayAccounts.length}</strong> accounts &bull;{' '}
            {ledgerView === 'customer'
              ? 'Customer Receivable Sub-Ledger View'
              : ledgerView === 'supplier'
              ? 'Supplier Payable Sub-Ledger View'
              : 'Complete Chart of Accounts'}
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            Double-Entry Architecture Ready &bull; Unsafe Deletion Protection Enforced
          </span>
        </div>
      </div>

      {/* Add / Edit Account Modal */}
      <AccountFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        editingAccount={editingAccount}
        defaultParentAccount={defaultParentForNew}
        groupsByMain={groupsByMain}
        parentCandidates={parentCandidates}
        onSaved={(savedAcc) => {
          setSuccessNotice(
            `Account "${savedAcc.account_name}" (${savedAcc.account_code}) saved permanently to Chart of Accounts.`
          );
          fetchAccounts();
          setTimeout(() => setSuccessNotice(null), 4000);
        }}
      />

      {/* View Account Details Modal */}
      <AccountViewModal
        isOpen={Boolean(viewingAccount)}
        account={viewingAccount}
        onClose={() => setViewingAccount(null)}
        onEdit={(acc) => handleOpenEdit(acc)}
        onAddSubAccount={(parentAcc) => handleOpenAddSubAccount(parentAcc)}
      />

      {/* Opening Balance Management Modal */}
      <OpeningBalanceModal
        isOpen={isOpeningModalOpen}
        onClose={() => setIsOpeningModalOpen(false)}
        accounts={accounts}
        onSaved={() => {
          setSuccessNotice('Opening balances updated and Debit/Credit ledgers recalculated.');
          fetchAccounts();
          setTimeout(() => setSuccessNotice(null), 4000);
        }}
      />

      {/* Excel Import Modal */}
      <AccountsExcelImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={() => {
          setSuccessNotice('Accounts imported from Excel successfully.');
          fetchAccounts();
          setTimeout(() => setSuccessNotice(null), 4000);
        }}
      />

      {/* Delete / Protection Confirmation Modal */}
      {deletingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Account Verification</h3>
                <p className="text-xs text-slate-500">
                  Protected against unsafe deletion if linked to transactions or sub-accounts
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900">{deletingAccount.account_name}</div>
              <div className="font-mono text-slate-600 text-[11px]">
                Code: {deletingAccount.account_code} &bull; {deletingAccount.main_group} ({deletingAccount.account_group})
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to delete this account? If this account is a system control head, has sub-accounts, or is linked to financial transactions, the server will safely block deletion.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingAccount(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Checking & Deleting...' : 'Confirm Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
