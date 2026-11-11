import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderTree,
  Plus,
  Search,
  RefreshCw,
  Download,
  Printer,
  ChevronRight,
  ChevronDown,
  Lock,
  BookOpen,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import { FinancialPillar } from '../../types/accounting';
import { NumericInput } from '../common/NumericInput';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface ChartOfAccountsViewProps {
  onOpenGeneralLedger?: (accountId: number) => void;
  onOpenAccountsMaster?: () => void;
}

const PILLAR_STYLES: Record<
  FinancialPillar,
  { badge: string; headerBg: string; border: string; codePrefix: string; defaultGroup: string }
> = {
  Assets: {
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    headerBg: 'bg-emerald-900/5 border-emerald-200',
    border: 'border-emerald-300',
    codePrefix: 'AST',
    defaultGroup: 'Assets',
  },
  Liabilities: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    headerBg: 'bg-amber-900/5 border-amber-200',
    border: 'border-amber-300',
    codePrefix: 'LIA',
    defaultGroup: 'Liabilities',
  },
  'Capital / Equity': {
    badge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    headerBg: 'bg-indigo-900/5 border-indigo-200',
    border: 'border-indigo-300',
    codePrefix: 'EQT',
    defaultGroup: 'Capital',
  },
  Income: {
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
    headerBg: 'bg-sky-900/5 border-sky-200',
    border: 'border-sky-300',
    codePrefix: 'INC',
    defaultGroup: 'Other Income',
  },
  Expenses: {
    badge: 'bg-rose-50 text-rose-800 border-rose-200',
    headerBg: 'bg-rose-900/5 border-rose-200',
    border: 'border-rose-300',
    codePrefix: 'EXP',
    defaultGroup: 'Other Expenses',
  },
};

const PILLAR_SUBGROUPS: Record<FinancialPillar, string[]> = {
  Assets: ['Cash in Hand', 'Bank', 'Customer', 'Assets'],
  Liabilities: ['Supplier', 'Liabilities', 'Loans'],
  'Capital / Equity': ['Capital', 'Drawings'],
  Income: ['Sales Income', 'Purchase Discount', 'Other Income'],
  Expenses: [
    'Purchases',
    'Purchase Returns',
    'Rent',
    'Electricity',
    'Salaries',
    'Shop Expenses',
    'Other Expenses',
  ],
};

export const ChartOfAccountsView: React.FC<ChartOfAccountsViewProps> = ({
  onOpenGeneralLedger,
  onOpenAccountsMaster,
}) => {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pillarSummary, setPillarSummary] = useState<any[]>([]);
  const [selectedPillar, setSelectedPillar] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'tree' | 'datasheet'>('tree');
  const [expandedPillars, setExpandedPillars] = useState<Record<string, boolean>>({
    Assets: true,
    Liabilities: true,
    'Capital / Equity': true,
    Income: true,
    Expenses: true,
  });

  // New Account Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const coaPrintRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    account_code: '',
    account_name: '',
    financial_category: 'Assets' as FinancialPillar,
    account_group: 'Assets',
    parent_account_id: '',
    opening_balance: '0',
    opening_balance_type: 'Debit' as 'Debit' | 'Credit',
    notes: '',
  });

  const loadCOA = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getHierarchicalCOA({
        q: searchQuery,
        pillar: selectedPillar,
      });
      setAccounts(res.accounts || []);
      setPillarSummary(res.pillarSummary || []);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load Chart of Accounts' });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedPillar]);

  useEffect(() => {
    loadCOA();
  }, [loadCOA]);

  const handlePillarChangeInModal = (pillar: FinancialPillar) => {
    const subGroups = PILLAR_SUBGROUPS[pillar] || ['Assets'];
    const defaultType = ['Liabilities', 'Capital / Equity', 'Income'].includes(pillar)
      ? 'Credit'
      : 'Debit';
    setForm((prev) => ({
      ...prev,
      financial_category: pillar,
      account_group: subGroups[0],
      opening_balance_type: defaultType,
      parent_account_id: '',
    }));
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.account_name.trim()) {
      setFeedback({ type: 'error', message: 'Account Name is required.' });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      await api.createCOAAccount({
        ...form,
        opening_balance: parseFloat(form.opening_balance || '0') || 0,
        parent_account_id: form.parent_account_id ? Number(form.parent_account_id) : null,
      });
      setFeedback({
        type: 'success',
        message: `Account "${form.account_name}" created successfully in Chart of Accounts.`,
      });
      setShowCreateModal(false);
      setForm({
        account_code: '',
        account_name: '',
        financial_category: 'Assets',
        account_group: 'Assets',
        parent_account_id: '',
        opening_balance: '0',
        opening_balance_type: 'Debit',
        notes: '',
      });
      loadCOA();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to create account' });
    } finally {
      setCreating(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Account Code',
      'Account Name',
      'Financial Pillar',
      'Sub Group',
      'Parent Account',
      'Opening Balance',
      'Opening Type',
      'Total Debit',
      'Total Credit',
      'Current Balance',
      'Balance Type',
      'Status',
    ];
    const csvRows = [
      headers.join(','),
      ...accounts.map((a) =>
        [
          `"${a.account_code}"`,
          `"${String(a.account_name).replace(/"/g, '""')}"`,
          `"${a.financial_category}"`,
          `"${a.account_group}"`,
          `"${a.parent_account_name || ''}"`,
          Number(a.opening_balance || 0).toFixed(2),
          a.opening_balance_type,
          Number(a.total_debit || 0).toFixed(2),
          Number(a.total_credit || 0).toFixed(2),
          Number(a.current_balance || 0).toFixed(2),
          a.current_balance_type,
          a.status,
        ].join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abrar_Medical_Chart_of_Accounts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderTreeNodes = (nodes: any[], depth = 0): React.ReactNode => {
    return nodes.map((node) => (
      <React.Fragment key={node.id}>
        <tr className="hover:bg-slate-50/90 border-b border-slate-200/80 transition-colors">
          <td className="px-3 py-1.5 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
            <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
              {depth > 0 && <span className="text-slate-400 mr-1.5">└─</span>}
              <span>{node.account_code}</span>
              {node.is_system_account === 1 && (
                <span title="Protected System Account" className="ml-1.5 text-slate-400">
                  <Lock className="w-3 h-3 inline" />
                </span>
              )}
            </div>
          </td>
          <td className="px-3 py-1.5 text-xs font-medium text-slate-900">
            <div style={{ paddingLeft: `${depth * 14}px` }} className="flex items-center gap-2">
              <span className={node.children?.length > 0 ? 'font-bold text-slate-900' : ''}>
                {node.account_name}
              </span>
              {node.children?.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                  {node.children.length} sub
                </span>
              )}
            </div>
          </td>
          <td className="px-3 py-1.5 text-xs text-slate-600">{node.account_group}</td>
          <td className="px-3 py-1.5 text-xs text-slate-500">
            {node.parent_account_code ? `${node.parent_account_code} - ${node.parent_account_name}` : 'Root Head'}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-xs text-slate-700">
            {Number(node.opening_balance || 0) > 0
              ? `${Number(node.opening_balance).toLocaleString('en-PK', {
                  minimumFractionDigits: 2,
                })} ${node.opening_balance_type === 'Debit' ? 'Dr' : 'Cr'}`
              : '0.00'}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-xs text-emerald-700">
            {Number(node.total_debit || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-xs text-rose-700">
            {Number(node.total_credit || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-slate-900">
            Rs.{' '}
            {Number(node.current_balance || 0).toLocaleString('en-PK', {
              minimumFractionDigits: 2,
            })}{' '}
            <span
              className={
                node.current_balance_type === 'Debit' ? 'text-emerald-700' : 'text-indigo-700'
              }
            >
              {node.current_balance_type === 'Debit' ? 'Dr' : 'Cr'}
            </span>
          </td>
          <td className="px-3 py-1.5 text-center">
            <button
              type="button"
              onClick={() => onOpenGeneralLedger && onOpenGeneralLedger(node.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors"
              title="Open General Ledger for this account"
            >
              <BookOpen className="w-3 h-3" />
              Ledger
            </button>
          </td>
        </tr>
        {node.children && node.children.length > 0 && renderTreeNodes(node.children, depth + 1)}
      </React.Fragment>
    ));
  };

  return (
    <div className="space-y-3">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-900 text-white flex items-center justify-center">
            <FolderTree className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              Hierarchical Chart of Accounts (5-Pillar Double-Entry Structure)
            </h1>
            <p className="text-xs text-slate-500">
              Assets • Liabilities • Capital / Equity • Income • Expenses — Integrated with Party & Financial Ledgers
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              className={`px-2.5 py-1 text-xs font-semibold rounded ${
                viewMode === 'tree'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hierarchical Tree
            </button>
            <button
              type="button"
              onClick={() => setViewMode('datasheet')}
              className={`px-2.5 py-1 text-xs font-semibold rounded ${
                viewMode === 'datasheet'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Flat Datasheet
            </button>
          </div>

          {onOpenAccountsMaster && (
            <button
              type="button"
              onClick={onOpenAccountsMaster}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              Party / Tax Master
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel/CSV
          </button>

          <button
            type="button"
            onClick={() => {
              if (coaPrintRef.current) {
                printReportDocument(coaPrintRef.current, 'Abrar Medical Store - Chart of Accounts');
              } else {
                window.print();
              }
            }}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print COA
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Account Head
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-3 py-2 rounded-md border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Printable COA Section */}
      <div ref={coaPrintRef} className="space-y-3">
        <PrintDocumentHeader
          title="CHART OF ACCOUNTS — HIERARCHICAL REGISTER"
          subtitle="5-Pillar Double-Entry Accounting Tree (Assets, Liabilities, Equity, Revenue & Expenses)"
          metaItems={[
            { label: 'Active Pillar Filter', value: selectedPillar === 'all' ? 'All 5 Financial Pillars' : selectedPillar },
            { label: 'Total Accounts in Registry', value: accounts.length },
          ]}
        />

        {/* 5 Financial Pillars Summary Strip */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => setSelectedPillar('all')}
          className={`text-left p-2.5 rounded-lg border transition-all ${
            selectedPillar === 'all'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
            All 5 Pillars
          </div>
          <div className="text-sm font-bold font-mono mt-0.5">{accounts.length} Accounts</div>
          <div className="text-[10px] opacity-75 mt-0.5">Complete Double-Entry COA</div>
        </button>

        {pillarSummary.map((pil) => {
          const isSelected = selectedPillar === pil.pillar;
          return (
            <button
              key={pil.pillar}
              type="button"
              onClick={() => setSelectedPillar(isSelected ? 'all' : pil.pillar)}
              className={`text-left p-2.5 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-emerald-900 text-white border-emerald-900'
                  : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider">{pil.pillar}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {pil.accountCount}
                </span>
              </div>
              <div className="text-xs font-bold font-mono mt-1">
                Rs. {Number(pil.netBalance || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] opacity-75">Net {pil.netBalanceType} Balance</div>
            </button>
          );
        })}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Fast search by Account Code (e.g., FIN-1010, INV-1030), Account Name, or Sub-Group..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-emerald-600"
          />
        </div>
        <button
          type="button"
          onClick={loadCOA}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main COA Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">Account Code</th>
                <th className="px-3 py-2 font-semibold">Account Title / Hierarchy</th>
                <th className="px-3 py-2 font-semibold">Sub-Group</th>
                <th className="px-3 py-2 font-semibold">Parent Control Head</th>
                <th className="px-3 py-2 text-right font-semibold">Opening Balance</th>
                <th className="px-3 py-2 text-right font-semibold">Total Debit</th>
                <th className="px-3 py-2 text-right font-semibold">Total Credit</th>
                <th className="px-3 py-2 text-right font-semibold">Current Balance</th>
                <th className="px-3 py-2 text-center font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                    Loading Hierarchical Chart of Accounts...
                  </td>
                </tr>
              ) : viewMode === 'tree' ? (
                pillarSummary
                  .filter((p) => selectedPillar === 'all' || p.pillar === selectedPillar)
                  .map((pil) => {
                    const isExpanded = expandedPillars[pil.pillar] ?? true;
                    const style =
                      PILLAR_STYLES[pil.pillar as FinancialPillar] || PILLAR_STYLES.Assets;
                    return (
                      <React.Fragment key={pil.pillar}>
                        <tr
                          onClick={() =>
                            setExpandedPillars((prev) => ({
                              ...prev,
                              [pil.pillar]: !isExpanded,
                            }))
                          }
                          className={`cursor-pointer border-y border-slate-300 ${style.headerBg}`}
                        >
                          <td colSpan={7} className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-slate-700" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-700" />
                              )}
                              <span
                                className={`px-2 py-0.5 text-xs font-bold rounded border ${style.badge}`}
                              >
                                {pil.pillar.toUpperCase()}
                              </span>
                              <span className="text-xs font-semibold text-slate-700">
                                ({pil.accountCount} Accounts)
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-bold text-slate-900">
                            Rs.{' '}
                            {Number(pil.netBalance || 0).toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                            })}{' '}
                            {pil.netBalanceType === 'Debit' ? 'Dr' : 'Cr'}
                          </td>
                          <td className="px-3 py-2 text-center text-[11px] text-slate-500">
                            Pillar Total
                          </td>
                        </tr>
                        {isExpanded && renderTreeNodes(pil.roots || [], 0)}
                      </React.Fragment>
                    );
                  })
              ) : (
                accounts.map((acc) => (
                  <tr
                    key={acc.id}
                    className="hover:bg-slate-50 border-b border-slate-200/80 text-xs"
                  >
                    <td className="px-3 py-1.5 font-mono font-semibold text-slate-800">
                      {acc.account_code}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-slate-900">{acc.account_name}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      <span className="font-semibold text-slate-800">{acc.financial_category}</span>{' '}
                      / {acc.account_group}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {acc.parent_account_name || 'Root'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {Number(acc.opening_balance || 0).toFixed(2)}{' '}
                      {acc.opening_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                      {Number(acc.total_debit || 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-rose-700">
                      {Number(acc.total_credit || 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">
                      Rs. {Number(acc.current_balance || 0).toFixed(2)}{' '}
                      {acc.current_balance_type === 'Debit' ? 'Dr' : 'Cr'}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenGeneralLedger && onOpenGeneralLedger(acc.id)}
                        className="px-2 py-0.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded"
                      >
                        Ledger
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/* Create New Account Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-lg overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">Create New Account Head in Chart of Accounts</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ESC / Close
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Financial Pillar *
                  </label>
                  <select
                    value={form.financial_category}
                    onChange={(e) =>
                      handlePillarChangeInModal(e.target.value as FinancialPillar)
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-emerald-600"
                  >
                    <option value="Assets">1. Assets</option>
                    <option value="Liabilities">2. Liabilities</option>
                    <option value="Capital / Equity">3. Capital / Equity</option>
                    <option value="Income">4. Income</option>
                    <option value="Expenses">5. Expenses</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Account Sub-Group *
                  </label>
                  <select
                    value={form.account_group}
                    onChange={(e) => setForm({ ...form, account_group: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-emerald-600"
                  >
                    {(PILLAR_SUBGROUPS[form.financial_category] || ['Assets']).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Account Code (Auto if blank)
                  </label>
                  <input
                    type="text"
                    value={form.account_code}
                    onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                    placeholder="e.g. EXP-5060"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Account Title / Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.account_name}
                    onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                    placeholder="e.g. Cold Chain Refrigerator Maintenance"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Parent Account (Optional — for Hierarchical Sub-Accounts)
                </label>
                <select
                  value={form.parent_account_id}
                  onChange={(e) => setForm({ ...form, parent_account_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                >
                  <option value="">-- Root Level Account (No Parent) --</option>
                  {accounts
                    .filter((a) => a.financial_category === form.financial_category)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Opening Balance (PKR)
                  </label>
                  <NumericInput
                    step="0.01"
                    min="0"
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Opening Balance Nature
                  </label>
                  <select
                    value={form.opening_balance_type}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        opening_balance_type: e.target.value as 'Debit' | 'Credit',
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  >
                    <option value="Debit">Debit (Dr)</option>
                    <option value="Credit">Credit (Cr)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Description / Notes
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional accounting notes..."
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded disabled:opacity-50"
                >
                  {creating ? 'Saving...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
