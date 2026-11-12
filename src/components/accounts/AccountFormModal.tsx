import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Save,
  AlertCircle,
  GitBranch,
  Building2,
  Phone,
  MapPin,
  Scale,
  Plus,
  Lock,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  Account,
  AccountFormData,
  MainAccountGroup,
  MAIN_ACCOUNT_GROUPS,
  STANDARD_ACCOUNT_GROUPS,
  ParentAccountCandidate,
} from '../../types/account';
import { TownRecord, TownAreaRecord } from '../../types/supply';
import { api } from '../../services/api';
import { NumericInput } from '../common/NumericInput';

interface AccountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (account: Account) => void;
  editingAccount?: Account | null;
  defaultParentAccount?: Account | null;
  groupsByMain: Record<string, string[]>;
  parentCandidates: ParentAccountCandidate[];
}

interface SalesmanOption {
  id: number;
  salesman_code: string;
  full_name: string;
  phone?: string;
  status: string;
}

const CREDIT_DEFAULT_GROUPS = new Set([
  'Supplier',
  'Capital',
  'Loans',
  'Liabilities',
  'Sales Income',
  'Purchase Discount',
  'Other Income',
]);

export const AccountFormModal: React.FC<AccountFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  editingAccount,
  defaultParentAccount,
  groupsByMain,
  parentCandidates,
}) => {
  const isEditing = Boolean(editingAccount);

  const initialForm: AccountFormData = {
    account_code: '',
    account_name: '',
    main_group: 'PARTY ACCOUNTS',
    account_group: 'Customer',
    parent_account_id: null,
    opening_balance: 0,
    opening_balance_type: 'Debit',
    contact_person: '',
    phone: '',
    email: '',
    ntn_cnic: '',
    ntn: '',
    strn: '',
    filer_status: 'Filer',
    tax_registration_details: '',
    address: '',
    city: 'Lahore',
    town_id: null,
    town_name: '',
    area_id: null,
    area_name: '',
    assigned_salesman_id: null,
    assigned_salesman_name: '',
    credit_limit: 0,
    status: 'Active',
    notes: '',
  };

  const [formData, setFormData] = useState<AccountFormData>(initialForm);
  const [isCustomGroup, setIsCustomGroup] = useState<boolean>(false);
  const [customGroupName, setCustomGroupName] = useState<string>('');
  const [codeChecking, setCodeChecking] = useState<boolean>(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Territory & Supply Route state
  const [townsList, setTownsList] = useState<TownRecord[]>([]);
  const [areasList, setAreasList] = useState<TownAreaRecord[]>([]);
  const [salesmenList, setSalesmenList] = useState<SalesmanOption[]>([]);
  const [loadingTerritory, setLoadingTerritory] = useState<boolean>(false);

  // Fetch active Towns, Areas, and Salesmen
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoadingTerritory(true);

    Promise.all([
      api.getSupplyTowns().catch(() => ({ towns: [], areas: [] })),
      api.getSupplySalesmen({ status: 'Active' }).catch(() => ({ salesmen: [] })),
    ])
      .then(([townsRes, salesmenRes]) => {
        if (!isMounted) return;
        if (Array.isArray(townsRes?.towns)) {
          setTownsList(townsRes.towns.filter((t: TownRecord) => t.status === 'Active'));
        }
        if (Array.isArray(townsRes?.areas)) {
          setAreasList(townsRes.areas.filter((a: TownAreaRecord) => a.status === 'Active'));
        }
        if (Array.isArray(salesmenRes?.salesmen)) {
          setSalesmenList(salesmenRes.salesmen.filter((s: SalesmanOption) => s.status === 'Active'));
        }
      })
      .finally(() => {
        if (isMounted) setLoadingTerritory(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const fetchNextCode = useCallback(async (targetGroup: string, targetMain?: string) => {
    if (!targetGroup.trim()) return;
    try {
      setCodeChecking(true);
      const res = await api.getNextAccountCode(targetGroup.trim(), targetMain);
      if (res?.next_code) {
        setFormData((prev) => ({ ...prev, account_code: res.next_code }));
      }
    } catch (err) {
      console.error('Failed to load next account code', err);
    } finally {
      setCodeChecking(false);
    }
  }, []);

  useEffect(() => {
    if (editingAccount) {
      setFormData({
        account_code: editingAccount.account_code,
        account_name: editingAccount.account_name,
        main_group: editingAccount.main_group,
        account_group: editingAccount.account_group,
        parent_account_id: editingAccount.parent_account_id,
        opening_balance: editingAccount.opening_balance,
        opening_balance_type: editingAccount.opening_balance_type,
        contact_person: editingAccount.contact_person || '',
        phone: editingAccount.phone || '',
        email: editingAccount.email || '',
        ntn_cnic: editingAccount.ntn_cnic || '',
        ntn: editingAccount.ntn || editingAccount.ntn_cnic || '',
        strn: editingAccount.strn || '',
        filer_status: editingAccount.filer_status || 'Filer',
        tax_registration_details: editingAccount.tax_registration_details || '',
        address: editingAccount.address || '',
        city: editingAccount.city || editingAccount.town_name || 'Lahore',
        town_id: editingAccount.town_id ?? null,
        town_name: editingAccount.town_name || '',
        area_id: editingAccount.area_id ?? null,
        area_name: editingAccount.area_name || '',
        assigned_salesman_id: editingAccount.assigned_salesman_id ?? null,
        assigned_salesman_name: editingAccount.assigned_salesman_name || '',
        credit_limit: editingAccount.credit_limit || 0,
        status: editingAccount.status,
        notes: editingAccount.notes || '',
      });
      setIsCustomGroup(false);
      setCustomGroupName('');
      setCodeError(null);
    } else {
      const initialGroup = defaultParentAccount?.account_group || 'Customer';
      const initialMain = defaultParentAccount?.main_group || 'PARTY ACCOUNTS';
      const naturalType = CREDIT_DEFAULT_GROUPS.has(initialGroup) ? 'Credit' : 'Debit';
      setFormData({
        ...initialForm,
        account_code: 'Loading...',
        main_group: initialMain,
        account_group: initialGroup,
        parent_account_id:
          defaultParentAccount?.id ??
          (initialGroup === 'Customer'
            ? parentCandidates.find((c) => c.account_code === 'ACC-1000')?.id ?? null
            : null),
        opening_balance_type: naturalType,
      });
      setIsCustomGroup(false);
      setCustomGroupName('');
      setCodeError(null);
      fetchNextCode(initialGroup, initialMain);
    }
    setFormError(null);
  }, [editingAccount, defaultParentAccount, isOpen, fetchNextCode]);

  // Dependent areas: strictly filtered by the currently selected Town ID
  const availableAreasForTown = useMemo(() => {
    if (!formData.town_id) return [];
    return areasList.filter(
      (a) => Number(a.town_id) === Number(formData.town_id) && a.status === 'Active'
    );
  }, [areasList, formData.town_id]);

  const handleTownChange = (selectedTownIdStr: string) => {
    if (!selectedTownIdStr) {
      setFormData((prev) => ({
        ...prev,
        town_id: null,
        town_name: '',
        area_id: null,
        area_name: '',
      }));
      return;
    }

    const tId = parseInt(selectedTownIdStr, 10);
    const matchedTown = townsList.find((t) => t.id === tId);
    if (!matchedTown) return;

    // Verify whether existing selected area belongs to the new town
    const areaBelongsToNewTown = areasList.some(
      (a) => a.id === formData.area_id && Number(a.town_id) === tId
    );

    // Auto-suggest town's assigned salesman if account does not have one yet
    let autoSalesmanId = formData.assigned_salesman_id;
    let autoSalesmanName = formData.assigned_salesman_name;
    if (
      !autoSalesmanId &&
      matchedTown.assigned_salesmen &&
      matchedTown.assigned_salesmen.length > 0
    ) {
      autoSalesmanId = matchedTown.assigned_salesmen[0].salesman_id;
      autoSalesmanName = matchedTown.assigned_salesmen[0].salesman_name;
    }

    setFormData((prev) => ({
      ...prev,
      town_id: tId,
      town_name: matchedTown.town_name,
      city: matchedTown.town_name, // keep city consistent with selected town
      area_id: areaBelongsToNewTown ? prev.area_id : null,
      area_name: areaBelongsToNewTown ? prev.area_name : '',
      assigned_salesman_id: autoSalesmanId,
      assigned_salesman_name: autoSalesmanName,
    }));
  };

  const handleAreaChange = (selectedAreaIdStr: string) => {
    if (!selectedAreaIdStr) {
      setFormData((prev) => ({
        ...prev,
        area_id: null,
        area_name: '',
      }));
      return;
    }

    const aId = parseInt(selectedAreaIdStr, 10);
    const matchedArea = areasList.find((a) => a.id === aId);
    if (!matchedArea) return;

    setFormData((prev) => ({
      ...prev,
      area_id: aId,
      area_name: matchedArea.area_name,
    }));
  };

  const handleSalesmanChange = (selectedSalesmanIdStr: string) => {
    if (!selectedSalesmanIdStr) {
      setFormData((prev) => ({
        ...prev,
        assigned_salesman_id: null,
        assigned_salesman_name: '',
      }));
      return;
    }

    const sId = parseInt(selectedSalesmanIdStr, 10);
    const matchedSalesman = salesmenList.find((s) => s.id === sId);
    if (!matchedSalesman) return;

    setFormData((prev) => ({
      ...prev,
      assigned_salesman_id: sId,
      assigned_salesman_name: matchedSalesman.full_name,
    }));
  };

  if (!isOpen) return null;

  const availableGroups =
    groupsByMain[formData.main_group] || STANDARD_ACCOUNT_GROUPS[formData.main_group] || [];

  const filteredParents = parentCandidates.filter(
    (p) => p.main_group === formData.main_group && (!editingAccount || p.id !== editingAccount.id)
  );

  const handleMainGroupChange = (newMain: MainAccountGroup) => {
    const subGroups = groupsByMain[newMain] || STANDARD_ACCOUNT_GROUPS[newMain];
    const firstGroup = subGroups[0] || '';
    const defaultType = CREDIT_DEFAULT_GROUPS.has(firstGroup) ? 'Credit' : 'Debit';

    let suggestedParent: number | null = null;
    if (newMain === 'PARTY ACCOUNTS') {
      const p = parentCandidates.find((c) => c.account_code === 'ACC-1000');
      if (p) suggestedParent = p.id;
    }

    setFormData((prev) => ({
      ...prev,
      main_group: newMain,
      account_group: firstGroup,
      parent_account_id: suggestedParent,
      opening_balance_type: isEditing ? prev.opening_balance_type : defaultType,
    }));
    setIsCustomGroup(false);
    if (!isEditing) {
      fetchNextCode(firstGroup, newMain);
    }
  };

  const handleAccountGroupChange = (newGroup: string) => {
    const defaultType = CREDIT_DEFAULT_GROUPS.has(newGroup) ? 'Credit' : 'Debit';

    let suggestedParent = formData.parent_account_id;
    if (!isEditing && formData.main_group === 'PARTY ACCOUNTS') {
      if (newGroup === 'Customer') {
        suggestedParent = parentCandidates.find((c) => c.account_code === 'ACC-1000')?.id ?? null;
      } else if (newGroup === 'Supplier') {
        suggestedParent = parentCandidates.find((c) => c.account_code === 'ACC-2000')?.id ?? null;
      } else if (newGroup === 'Customer & Supplier') {
        suggestedParent = parentCandidates.find((c) => c.account_code === 'ACC-3000')?.id ?? null;
      }
    } else if (!isEditing && newGroup === 'Bank') {
      suggestedParent = parentCandidates.find((c) => c.account_code === 'FIN-1020')?.id ?? null;
    }

    setFormData((prev) => ({
      ...prev,
      account_group: newGroup,
      parent_account_id: suggestedParent,
      opening_balance_type: isEditing ? prev.opening_balance_type : defaultType,
    }));
    if (!isEditing) {
      fetchNextCode(newGroup, formData.main_group);
    }
  };

  const handleCustomGroupNameChange = (val: string) => {
    setCustomGroupName(val);
    if (!isEditing && val.trim().length >= 2) {
      fetchNextCode(val.trim(), formData.main_group);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const finalGroup = isCustomGroup ? customGroupName.trim() : formData.account_group.trim();
    if (!formData.account_name.trim()) {
      setFormError('Account Name is required.');
      return;
    }
    if (!finalGroup) {
      setFormError('Account Group is required.');
      return;
    }

    const payload = {
      ...formData,
      account_group: finalGroup,
    };

    try {
      setSaving(true);
      if (isEditing && editingAccount) {
        const res = await api.updateAccount(editingAccount.id, payload);
        onSaved(res.account);
      } else {
        const res = await api.createAccount(payload);
        onSaved(res.account);
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const showPartyOrBankDetails =
    formData.main_group === 'PARTY ACCOUNTS' ||
    ['Bank', 'Loans', 'Liabilities'].includes(formData.account_group);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 text-white px-6 py-4 flex items-center justify-between border-b border-emerald-800/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>
                {isEditing
                  ? `Edit Account: ${editingAccount?.account_name}`
                  : defaultParentAccount
                  ? `Create Sub-Account under ${defaultParentAccount.account_name}`
                  : 'Create New Account in Chart of Accounts'}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Double-Entry Ready
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Abrar Medical Store Accounting Structure • Party, Financial & Income/Expense Ledgers
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {formError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium">{formError}</span>
            </div>
          )}

          {/* Section 1: Chart of Accounts Classification & Hierarchy */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-emerald-600" />
              <span>1. Chart of Accounts Group & Hierarchy</span>
            </h4>

            {/* Main Group 3-Tab Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {MAIN_ACCOUNT_GROUPS.map((mg) => {
                const active = formData.main_group === mg;
                return (
                  <button
                    key={mg}
                    type="button"
                    onClick={() => handleMainGroupChange(mg)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-[11px] font-black tracking-wide uppercase">{mg}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? 'text-emerald-100' : 'text-slate-500'}`}>
                      {mg === 'PARTY ACCOUNTS' && 'Customer, Supplier, Customer & Supplier'}
                      {mg === 'FINANCIAL ACCOUNTS' && 'Cash, Bank, Capital, Drawings, Loans, Assets, Liabilities'}
                      {mg === 'INCOME & EXPENSE ACCOUNTS' && 'Sales, Discounts, Rent, Electricity, Salaries, Shop Exp'}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
              {/* Account Code - Universal Read-Only Auto Code */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Account Code <span className="text-emerald-700 font-bold">*</span>
                  </label>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-200/70 px-1.5 py-0.5 rounded border border-slate-300">
                    <Lock className="w-2.5 h-2.5 text-slate-500" /> Read-Only
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={formData.account_code || ''}
                    placeholder="Auto-generating..."
                    className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-slate-100 text-slate-900 cursor-not-allowed select-all focus:outline-none"
                  />
                  {codeChecking && (
                    <span className="absolute right-2 top-2 text-[10px] font-bold text-emerald-600 animate-pulse">
                      generating...
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <p className="text-[10px] text-slate-500 font-medium leading-tight">
                    Permanent account identifier. Cannot be modified.
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-700 font-medium leading-tight flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                    Auto-generated sequential code (PREFIX-001)
                  </p>
                )}
              </div>

              {/* Account Name */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Account Name / Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.account_name}
                  onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                  placeholder="e.g. Al-Shifa Medicos, Meezan Bank Current A/C, Generator Fuel Expense"
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })
                  }
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              {/* Account Group (Standard or Custom) */}
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Account Group <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIsCustom = !isCustomGroup;
                      setIsCustomGroup(nextIsCustom);
                      if (!isEditing) {
                        if (nextIsCustom && customGroupName.trim()) {
                          fetchNextCode(customGroupName.trim(), formData.main_group);
                        } else if (!nextIsCustom) {
                          fetchNextCode(formData.account_group, formData.main_group);
                        }
                      }
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{isCustomGroup ? 'Select Standard Group' : 'New Custom Group'}</span>
                  </button>
                </div>

                {!isCustomGroup ? (
                  <select
                    value={formData.account_group}
                    onChange={(e) => handleAccountGroupChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {availableGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={customGroupName}
                    onChange={(e) => handleCustomGroupNameChange(e.target.value)}
                    placeholder={`Enter custom group under ${formData.main_group}...`}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-400 bg-emerald-50/30 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                )}
              </div>

              {/* Hierarchical Parent Account */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Parent Account (Hierarchical Chart of Accounts)
                </label>
                <select
                  value={formData.parent_account_id ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      parent_account_id: e.target.value ? parseInt(e.target.value, 10) : null,
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">— Top-Level / Root Account (No Parent) —</option>
                  {filteredParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.account_code}] {p.account_name} ({p.account_group})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Opening Balance & Double-Entry Debit/Credit Nature */}
          <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-emerald-700" />
                <span>2. Opening Balance & Debit/Credit Nature (PKR)</span>
              </h4>
              {formData.account_group === 'Customer & Supplier' && (
                <span className="text-[11px] font-bold text-purple-800 bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-200">
                  Dual Ledger: Maintains both Customer Receivable & Supplier Payable Sub-Ledgers
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              {/* Opening Balance Amount */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Opening Balance (PKR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1.5 text-xs font-mono text-slate-500">Rs.</span>
                  <NumericInput
                    step="0.01"
                    min="0"
                    value={formData.opening_balance}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        opening_balance: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs font-mono font-black rounded-lg border border-emerald-400 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>

              {/* Debit / Credit Selector */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Opening Balance Type (Dr / Cr)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, opening_balance_type: 'Debit' })}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      formData.opening_balance_type === 'Debit'
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Debit (Dr)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, opening_balance_type: 'Credit' })}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      formData.opening_balance_type === 'Credit'
                        ? 'bg-blue-700 text-white border-blue-700 shadow-2xs'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Credit (Cr)
                  </button>
                </div>
              </div>

              {/* Credit Limit (For Party / Bank accounts) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Credit Limit (PKR) {formData.main_group !== 'PARTY ACCOUNTS' && '(Optional)'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1.5 text-xs font-mono text-slate-400">Rs.</span>
                  <NumericInput
                    step="100"
                    min="0"
                    value={formData.credit_limit}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        credit_limit: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="w-full pl-9 pr-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-600">
              {formData.opening_balance_type === 'Debit'
                ? 'Debit (Dr) Opening Balance: Standard for Customers (Receivables), Cash, Bank, Assets, Drawings, and Expense accounts.'
                : 'Credit (Cr) Opening Balance: Standard for Suppliers (Payables), Capital, Liabilities, Loans, and Income accounts.'}
            </p>
          </div>

          {/* Section 3: Territory, Town, Area & Route Assignment */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 space-y-3.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>
                  3. Territory & Supply Route Assignment (Town & Dependent Area Master)
                </span>
              </h4>
              <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                {formData.town_name ? `${formData.town_name}${formData.area_name ? ` → ${formData.area_name}` : ''}` : 'Select Town & Area'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* Town Dropdown */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Town Master <span className="text-emerald-600 font-bold">*</span>
                  </label>
                  {loadingTerritory && (
                    <span className="text-[10px] text-slate-400 animate-pulse">Loading towns...</span>
                  )}
                </div>
                <select
                  value={formData.town_id ?? ''}
                  onChange={(e) => handleTownChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">— Select Town (Town Master) —</option>
                  {townsList.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.town_code}] {t.town_name} {t.areas?.length ? `(${t.areas.length} Areas)` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Defines the primary delivery and booking town.
                </p>
              </div>

              {/* Dependent Area Dropdown */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Dependent Area / Sector
                  </label>
                  {formData.town_id && (
                    <span className="text-[10px] text-emerald-700 font-medium">
                      {availableAreasForTown.length} Area(s) available
                    </span>
                  )}
                </div>
                <select
                  value={formData.area_id ?? ''}
                  onChange={(e) => handleAreaChange(e.target.value)}
                  disabled={!formData.town_id || availableAreasForTown.length === 0}
                  className={`w-full px-3 py-1.5 text-xs font-medium rounded-lg border focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                    !formData.town_id
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'border-slate-300 bg-white text-slate-900'
                  }`}
                >
                  {!formData.town_id ? (
                    <option value="">— Select Town First —</option>
                  ) : availableAreasForTown.length === 0 ? (
                    <option value="">— No Areas defined for this Town —</option>
                  ) : (
                    <>
                      <option value="">— Select Area / Sector (Optional) —</option>
                      {availableAreasForTown.map((a) => (
                        <option key={a.id} value={a.id}>
                          [{a.area_code}] {a.area_name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <p className="text-[10px] text-slate-500">
                  Filtered automatically to areas belonging to selected Town.
                </p>
              </div>

              {/* Assigned Field Salesman */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Assigned Field Salesman
                </label>
                <select
                  value={formData.assigned_salesman_id ?? ''}
                  onChange={(e) => handleSalesmanChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">— Select Field Salesman (Optional) —</option>
                  {salesmenList.map((s) => (
                    <option key={s.id} value={s.id}>
                      [{s.salesman_code}] {s.full_name} {s.phone ? `(${s.phone})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Assigned order booking & recovery agent for this party.
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: Contact Details & Physical Location */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-600" />
              <span>
                4. Contact Details & Address{' '}
                {showPartyOrBankDetails ? '(Party / Bank Details)' : '(Optional where applicable)'}
              </span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Contact Person / Representative
                </label>
                <input
                  type="text"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  placeholder="e.g. Mr. Bilal Ahmed"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Phone / Mobile Number
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. +92 300 1234567"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. accounts@distributor.pk"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  NTN / CNIC / Bank Account #
                </label>
                <input
                  type="text"
                  value={formData.ntn_cnic}
                  onChange={(e) => setFormData({ ...formData, ntn_cnic: e.target.value })}
                  placeholder="NTN, CNIC, or IBAN"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Street Address / Market Location
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="e.g. Shop #14, Medicine Market, Circular Road"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">City / Town Name</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="e.g. Lahore"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Notes / Remarks</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Payment terms or ledger notes"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Supplier Tax & Filer Settings (shown for Supplier / Customer & Supplier / Party accounts) */}
          {formData.main_group === 'PARTY ACCOUNTS' && (
            <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-amber-700" />
                  <span>5. Supplier Tax & Advance Tax Filer Settings (FBR Pakistan)</span>
                </h4>
                <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200">
                  Auto-selects Advance Tax Rate on Purchase Invoices
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Filer / Non-Filer / Exempt Status
                  </label>
                  <select
                    value={formData.filer_status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        filer_status: e.target.value as 'Filer' | 'Non-Filer' | 'Exempt',
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-400 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    <option value="Filer">Filer (Active Taxpayer - Default 0.5%)</option>
                    <option value="Non-Filer">Non-Filer (Default 2.5%)</option>
                    <option value="Exempt">Exempt (0.0% Tax Exempt)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    NTN (National Tax Number)
                  </label>
                  <input
                    type="text"
                    value={formData.ntn}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        ntn: e.target.value,
                        ntn_cnic: formData.ntn_cnic || e.target.value,
                      })
                    }
                    placeholder="e.g. NTN-4198201-7"
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    STRN (Sales Tax Registration #)
                  </label>
                  <input
                    type="text"
                    value={formData.strn}
                    onChange={(e) => setFormData({ ...formData, strn: e.target.value })}
                    placeholder="e.g. STRN-03-04-9182-001"
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Tax Registration Details
                  </label>
                  <input
                    type="text"
                    value={formData.tax_registration_details}
                    onChange={(e) =>
                      setFormData({ ...formData, tax_registration_details: e.target.value })
                    }
                    placeholder="e.g. ATL Verified FBR u/s 236H"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              Protected by relational integrity &bull; Prepared for Double-Entry Accounting
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || Boolean(codeError)}
                className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>
                  {saving ? 'Saving...' : isEditing ? 'Update Account' : 'Save Account to Ledger'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
