import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  FileSpreadsheet,
  Printer,
  Search,
  CheckCircle2,
  Building2,
  UserCheck,
  Hash,
  FileBarChart,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  SupplySalesman,
  TownRecord,
  TownSupplyRecord,
  SupplyRecoveryRecord,
  SalesmanSettlementRecord,
} from '../../types/supply';
import { exportSupplyTableToExcel } from '../../utils/supplyExcelExport';
import type { SupplyDocumentPrintType } from './SupplyPrintModal';

interface SupplyReportsAndRecoveryProps {
  activeSection: 'supply-recovery' | 'supply-settlement' | 'supply-reports';
  salesmen: SupplySalesman[];
  towns: TownRecord[];
  supplies: TownSupplyRecord[];
  onRefreshCore: () => void;
  onOpenPrint: (config: {
    docType: SupplyDocumentPrintType;
    title: string;
    subtitle?: string;
    headerMeta?: Array<{ label: string; value: string | number }>;
    columns?: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
    rows?: Array<Record<string, unknown>>;
    totals?: Array<{ label: string; value: string | number; highlight?: boolean }>;
    footerNotes?: string;
  }) => void;
}

const REPORT_CATALOG: Record<
  string,
  {
    label: string;
    reports: Array<{ key: string; label: string }>;
  }
> = {
  booking: {
    label: '1. Booking & Order Form Reports',
    reports: [
      { key: 'order-form-report', label: 'Order Form Register Report' },
      { key: 'company-wise-order-form', label: 'Company-Wise Order Form Report' },
      { key: 'salesman-wise-booking', label: 'Salesman-Wise Booking Report' },
      { key: 'town-wise-booking', label: 'Town-Wise Booking Report' },
      { key: 'party-wise-booking', label: 'Party-Wise Booking Report' },
      { key: 'pending-booking', label: 'Pending Booking Report' },
    ],
  },
  supply: {
    label: '2. Supply, Packing & Dispatch Reports',
    reports: [
      { key: 'town-wise-supply', label: 'Town-Wise Supply Report' },
      { key: 'party-wise-supply', label: 'Party-Wise Supply Report' },
      { key: 'supply-number-wise', label: 'Supply Number-Wise Report' },
      { key: 'salesman-wise-supply', label: 'Salesman-Wise Supply Report' },
      { key: 'item-wise-supply', label: 'Item-Wise Supply Report' },
      { key: 'packing-list', label: 'Packing List Report' },
      { key: 'pending-packing', label: 'Pending Packing Report' },
      { key: 'dispatch-report', label: 'Dispatch Challan Report' },
      { key: 'pending-dispatch', label: 'Pending Dispatch Report' },
    ],
  },
  return: {
    label: '3. Salesman Return Reports',
    reports: [
      { key: 'salesman-wise-return', label: 'Salesman-Wise Return Report' },
      { key: 'town-wise-return', label: 'Town-Wise Return Report' },
      { key: 'party-wise-return', label: 'Party-Wise Return Report' },
      { key: 'supply-number-wise-return', label: 'Supply Number-Wise Return Report' },
      { key: 'item-wise-return', label: 'Item-Wise Return Report' },
      { key: 'damaged-stock-return', label: 'Damaged Stock Return Report' },
      { key: 'date-wise-return', label: 'Date-Wise Return Report' },
    ],
  },
  billing: {
    label: '4. Final Billing & Sales Reports',
    reports: [
      { key: 'final-billing-report', label: 'Final Billing Register Report' },
      { key: 'supply-vs-return-vs-final', label: 'Supply vs Return vs Final Bill Report' },
      { key: 'party-wise-final-sales', label: 'Party-Wise Final Sales Report' },
      { key: 'town-wise-final-sales', label: 'Town-Wise Final Sales Report' },
      { key: 'salesman-wise-final-sales', label: 'Salesman-Wise Final Sales Report' },
      { key: 'pending-billing', label: 'Pending Billing Report' },
      { key: 'partial-billing', label: 'Partial Billing Report' },
    ],
  },
  recovery: {
    label: '5. Recovery & Settlement Reports',
    reports: [
      { key: 'party-wise-recovery', label: 'Party-Wise Recovery Report' },
      { key: 'town-wise-recovery', label: 'Town-Wise Recovery Report' },
      { key: 'supply-number-wise-recovery', label: 'Supply Number-Wise Recovery Report' },
      { key: 'salesman-wise-recovery', label: 'Salesman-Wise Recovery Report' },
      { key: 'daily-recovery', label: 'Daily Recovery Report' },
      { key: 'date-wise-recovery', label: 'Date-Wise Recovery Report' },
      { key: 'pending-recovery', label: 'Pending Recovery / Receivable Report' },
      { key: 'aging-outstanding', label: 'Aging / Outstanding Balance Report' },
      { key: 'salesman-settlement-report', label: 'Salesman Settlement Report' },
    ],
  },
};

export const SupplyReportsAndRecoverySection: React.FC<SupplyReportsAndRecoveryProps> = ({
  activeSection,
  salesmen,
  towns,
  supplies,
  onRefreshCore,
  onOpenPrint,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ==========================================================================
  // A. RECOVERY MANAGEMENT & 3 RECOVERY REPORTS STATE
  // ==========================================================================
  const [recoveryTab, setRecoveryTab] = useState<
    'entry' | 'party-wise' | 'town-wise' | 'supply-wise'
  >('entry');
  const [recoveries, setRecoveries] = useState<SupplyRecoveryRecord[]>([]);
  const [recDate, setRecDate] = useState<string>(today);
  const [recSalesmanId, setRecSalesmanId] = useState<string>('');
  const [recTownId, setRecTownId] = useState<string>('');
  const [recPartyId, setRecPartyId] = useState<string>('');
  const [recTownSupplyId, setRecTownSupplyId] = useState<string>('');
  const [recInvoiceNo, setRecInvoiceNo] = useState<string>('');
  const [recAmount, setRecAmount] = useState<string>('');
  const [recMethod, setRecMethod] = useState<'Cash' | 'Bank' | 'Cheque' | 'Online'>('Cash');
  const [recRemarks, setRecRemarks] = useState<string>('');
  const [savingRecovery, setSavingRecovery] = useState(false);

  // Specialized 3 Recovery Reports state
  const [recFilterFrom, setRecFilterFrom] = useState<string>('');
  const [recFilterTo, setRecFilterTo] = useState<string>('');
  const [recFilterSalesman, setRecFilterSalesman] = useState<string>('');
  const [recFilterTown, setRecFilterTown] = useState<string>('');
  const [recFilterParty, setRecFilterParty] = useState<string>('');
  const [recFilterSupplyNo, setRecFilterSupplyNo] = useState<string>('');
  const [specialRecoveryData, setSpecialRecoveryData] = useState<any>(null);

  // ==========================================================================
  // B. SALESMAN SETTLEMENT STATE
  // ==========================================================================
  const [stlSalesmanId, setStlSalesmanId] = useState<string>('');
  const [stlFromDate, setStlFromDate] = useState<string>(today);
  const [stlToDate, setStlToDate] = useState<string>(today);
  const [stlPreview, setStlPreview] = useState<any>(null);
  const [stlCashSubmitted, setStlCashSubmitted] = useState<string>('');
  const [stlRemarks, setStlRemarks] = useState<string>('');
  const [settlementsList, setSettlementsList] = useState<SalesmanSettlementRecord[]>([]);
  const [savingSettlement, setSavingSettlement] = useState(false);

  // ==========================================================================
  // C. COMPLETE 38-REPORT SUITE STATE
  // ==========================================================================
  const [repCategory, setRepCategory] = useState<string>('booking');
  const [repKey, setRepKey] = useState<string>('order-form-report');
  const [repFromDate, setRepFromDate] = useState<string>('');
  const [repToDate, setRepToDate] = useState<string>('');
  const [repSalesmanId, setRepSalesmanId] = useState<string>('');
  const [repTownId, setRepTownId] = useState<string>('');
  const [repPartyId, setRepPartyId] = useState<string>('');
  const [repSupplyNo, setRepSupplyNo] = useState<string>('');
  const [repSearch, setRepSearch] = useState<string>('');
  const [repData, setRepData] = useState<{
    columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
    rows: Array<Record<string, unknown>>;
    grandTotals: Record<string, number>;
  }>({ columns: [], rows: [], grandTotals: {} });
  const [loadingReport, setLoadingReport] = useState(false);

  const allParties = React.useMemo(() => {
    const map = new Map<number, any>();
    towns.forEach((t) => {
      t.parties.forEach((p) => map.set(p.id, p));
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.account_name).localeCompare(String(b.account_name))
    );
  }, [towns]);

  const selectedPartyObj = React.useMemo(
    () => allParties.find((p) => Number(p.id) === Number(recPartyId)) || null,
    [allParties, recPartyId]
  );

  const loadRecoveries = useCallback(async () => {
    try {
      const res = await api.getSupplyRecoveries();
      setRecoveries(res.recoveries || []);
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to load recoveries' });
    }
  }, []);

  const loadSpecialRecoveryReport = useCallback(
    async (type: 'party-wise' | 'town-wise' | 'supply-wise') => {
      try {
        const res = await api.getSupplyRecoveryReports({
          type,
          from_date: recFilterFrom || undefined,
          to_date: recFilterTo || undefined,
          salesman_id: recFilterSalesman ? Number(recFilterSalesman) : undefined,
          town_id: recFilterTown ? Number(recFilterTown) : undefined,
          party_account_id: recFilterParty ? Number(recFilterParty) : undefined,
          supply_number: recFilterSupplyNo || undefined,
        });
        setSpecialRecoveryData(res);
      } catch (err: any) {
        setBanner({ type: 'error', msg: err.message || 'Failed to load recovery report' });
      }
    },
    [
      recFilterFrom,
      recFilterTo,
      recFilterSalesman,
      recFilterTown,
      recFilterParty,
      recFilterSupplyNo,
    ]
  );

  const loadSettlements = useCallback(async () => {
    try {
      const res = await api.getSalesmanSettlements(
        stlSalesmanId ? Number(stlSalesmanId) : undefined
      );
      setSettlementsList(res.settlements || []);
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to load settlements' });
    }
  }, [stlSalesmanId]);

  const loadReportSuite = useCallback(async () => {
    setLoadingReport(true);
    try {
      const res = await api.getSupplyDistributionReport(repCategory, repKey, {
        from_date: repFromDate || undefined,
        to_date: repToDate || undefined,
        salesman_id: repSalesmanId ? Number(repSalesmanId) : undefined,
        town_id: repTownId ? Number(repTownId) : undefined,
        party_account_id: repPartyId ? Number(repPartyId) : undefined,
        supply_number: repSupplyNo || undefined,
        q: repSearch || undefined,
      });
      setRepData({
        columns: res.columns || [],
        rows: res.rows || [],
        grandTotals: res.grandTotals || {},
      });
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to load report' });
    } finally {
      setLoadingReport(false);
    }
  }, [
    repCategory,
    repKey,
    repFromDate,
    repToDate,
    repSalesmanId,
    repTownId,
    repPartyId,
    repSupplyNo,
    repSearch,
  ]);

  useEffect(() => {
    if (activeSection === 'supply-recovery') {
      loadRecoveries();
      if (recoveryTab !== 'entry') {
        loadSpecialRecoveryReport(recoveryTab);
      }
    } else if (activeSection === 'supply-settlement') {
      loadSettlements();
    } else if (activeSection === 'supply-reports') {
      loadReportSuite();
    }
  }, [
    activeSection,
    recoveryTab,
    loadRecoveries,
    loadSpecialRecoveryReport,
    loadSettlements,
    loadReportSuite,
  ]);

  const handleSaveRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recPartyId || Number(recAmount) <= 0) {
      setBanner({ type: 'error', msg: 'Select a Party and enter a Recovery Amount > 0.' });
      return;
    }
    setSavingRecovery(true);
    setBanner(null);
    try {
      const res = await api.createSupplyRecovery({
        recovery_date: recDate,
        salesman_id: recSalesmanId
          ? Number(recSalesmanId)
          : selectedPartyObj?.assigned_salesman_id || null,
        town_id: recTownId ? Number(recTownId) : selectedPartyObj?.town_id || null,
        party_account_id: Number(recPartyId),
        town_supply_id: recTownSupplyId ? Number(recTownSupplyId) : null,
        invoice_number: recInvoiceNo,
        recovery_amount: Number(recAmount),
        payment_method: recMethod,
        remarks: recRemarks,
      });
      setBanner({
        type: 'success',
        msg: `Recovery Receipt ${res.recovery?.recovery_receipt_number || ''} posted! Party ledger & Cashbook updated.`,
      });
      setRecAmount('');
      setRecInvoiceNo('');
      setRecRemarks('');
      await loadRecoveries();
      onRefreshCore();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to post recovery' });
    } finally {
      setSavingRecovery(false);
    }
  };

  const handlePreviewSettlement = async () => {
    if (!stlSalesmanId) {
      setBanner({ type: 'error', msg: 'Please select a Salesman first.' });
      return;
    }
    setBanner(null);
    try {
      const res = await api.previewSalesmanSettlement({
        salesman_id: Number(stlSalesmanId),
        from_date: stlFromDate,
        to_date: stlToDate,
      });
      setStlPreview(res.preview);
      setStlCashSubmitted(String(res.preview.total_cash_collected || 0));
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to preview settlement' });
    }
  };

  const handleSaveSettlement = async () => {
    if (!stlPreview) return;
    setSavingSettlement(true);
    setBanner(null);
    try {
      const res = await api.createSalesmanSettlement({
        settlement_date: today,
        from_date: stlFromDate,
        to_date: stlToDate,
        salesman_id: stlPreview.salesman_id,
        total_supplies: stlPreview.total_supplies,
        total_returns: stlPreview.total_returns,
        total_final_billing: stlPreview.total_final_billing,
        total_cash_collected: stlPreview.total_cash_collected,
        total_bank_collections: stlPreview.total_bank_collections,
        total_outstanding: stlPreview.total_outstanding,
        cash_submitted_to_store: Number(stlCashSubmitted || 0),
        remarks: stlRemarks,
      });
      setBanner({
        type: 'success',
        msg: `Salesman Settlement ${res.settlement?.settlement_number} saved and recoveries marked settled!`,
      });
      setStlPreview(null);
      await loadSettlements();
      onRefreshCore();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to save settlement' });
    } finally {
      setSavingSettlement(false);
    }
  };

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={`p-3 rounded-lg border text-xs font-bold flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <span>{banner.msg}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          SECTION 10 & 11: RECOVERY / COLLECTION & 3 RECOVERY REPORTS
         ==================================================================== */}
      {activeSection === 'supply-recovery' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRecoveryTab('entry')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  recoveryTab === 'entry'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                Recovery Entry & Register
              </button>
              <button
                type="button"
                onClick={() => setRecoveryTab('party-wise')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  recoveryTab === 'party-wise'
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                A. Party-Wise Recovery Report
              </button>
              <button
                type="button"
                onClick={() => setRecoveryTab('town-wise')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  recoveryTab === 'town-wise'
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                B. Town-Wise Recovery Report
              </button>
              <button
                type="button"
                onClick={() => setRecoveryTab('supply-wise')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  recoveryTab === 'supply-wise'
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Hash className="w-3.5 h-3.5" />
                C. Supply Number-Wise Recovery
              </button>
            </div>
          </div>

          {recoveryTab === 'entry' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Recovery Entry Form */}
              <form
                onSubmit={handleSaveRecovery}
                className="lg:col-span-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
              >
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2 border-b pb-2">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  Post Party / Supply Recovery Receipt
                </h3>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Recovery Date
                    </label>
                    <input
                      type="date"
                      value={recDate}
                      onChange={(e) => setRecDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={recMethod}
                      onChange={(e) => setRecMethod(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold"
                    >
                      <option value="Cash">Cash (Cashbook)</option>
                      <option value="Bank">Bank Transfer</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Online">Online / JazzCash / EasyPaisa</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Town Filter
                    </label>
                    <select
                      value={recTownId}
                      onChange={(e) => setRecTownId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="">All Towns</option>
                      {towns.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.town_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Salesman
                    </label>
                    <select
                      value={recSalesmanId}
                      onChange={(e) => setRecSalesmanId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="">Auto from Party</option>
                      {salesmen.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Party Name *
                  </label>
                  <select
                    value={recPartyId}
                    onChange={(e) => setRecPartyId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold"
                    required
                  >
                    <option value="">Select Customer / Party...</option>
                    {allParties
                      .filter((p) => !recTownId || Number(p.town_id) === Number(recTownId))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.account_name} ({p.town_name || 'No Town'}) — Bal: Rs.{' '}
                          {Number(p.current_balance || 0).toLocaleString()} {p.current_balance_type}
                        </option>
                      ))}
                  </select>
                </div>

                {selectedPartyObj && (
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500">Previous Outstanding:</span>
                      <div className="font-black text-slate-900 text-sm">
                        Rs. {Number(selectedPartyObj.current_balance || 0).toLocaleString()} (
                        {selectedPartyObj.current_balance_type})
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500">Remaining After Recovery:</span>
                      <div className="font-black text-emerald-700 text-sm">
                        Rs.{' '}
                        {Math.max(
                          0,
                          Number(selectedPartyObj.current_balance || 0) - Number(recAmount || 0)
                        ).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Supply Number (Optional)
                    </label>
                    <select
                      value={recTownSupplyId}
                      onChange={(e) => setRecTownSupplyId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="">General / Any Supply</option>
                      {supplies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.supply_number} ({s.town_name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Invoice No (Optional)
                    </label>
                    <input
                      type="text"
                      value={recInvoiceNo}
                      onChange={(e) => setRecInvoiceNo(e.target.value)}
                      placeholder="e.g. INV-..."
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Recovery Amount (Rs.) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm font-black border-2 border-emerald-500 rounded-lg focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Remarks / Narration
                  </label>
                  <input
                    type="text"
                    value={recRemarks}
                    onChange={(e) => setRecRemarks(e.target.value)}
                    placeholder="Cash / Cheque / Slip reference..."
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingRecovery}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow disabled:opacity-50"
                >
                  {savingRecovery ? 'Posting Recovery...' : 'Post Recovery Receipt & Update Ledger'}
                </button>
              </form>

              {/* Recent Recovery Receipts Register */}
              <div className="lg:col-span-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                <div className="flex items-center justify-between border-b pb-2.5 mb-3">
                  <h3 className="font-bold text-sm text-slate-900">
                    Posted Recovery Receipts ({recoveries.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      exportSupplyTableToExcel({
                        title: 'Supply Recovery Receipts Register',
                        fileName: `Recovery_Receipts_${today}.xlsx`,
                        columns: [
                          { key: 'recovery_receipt_number', label: 'Receipt No' },
                          { key: 'recovery_date', label: 'Date' },
                          { key: 'party_name', label: 'Party Name' },
                          { key: 'town_name', label: 'Town' },
                          { key: 'salesman_name', label: 'Salesman' },
                          { key: 'supply_number', label: 'Supply No' },
                          { key: 'previous_outstanding', label: 'Previous Balance', align: 'right' },
                          { key: 'recovery_amount', label: 'Recovered Amount', align: 'right' },
                          { key: 'remaining_balance', label: 'Remaining Balance', align: 'right' },
                          { key: 'payment_method', label: 'Method' },
                        ],
                        rows: recoveries as unknown as Array<Record<string, unknown>>,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Export Excel
                  </button>
                </div>

                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 uppercase text-[10px]">
                        <th className="p-2 text-left">Receipt No</th>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Party Name</th>
                        <th className="p-2 text-left">Town</th>
                        <th className="p-2 text-left">Supply No</th>
                        <th className="p-2 text-right">Prev Bal</th>
                        <th className="p-2 text-right">Recovered</th>
                        <th className="p-2 text-right">Remaining</th>
                        <th className="p-2 text-center">Method</th>
                        <th className="p-2 text-center">Print</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {recoveries.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="p-2 font-mono font-bold text-slate-900">
                            {r.recovery_receipt_number}
                          </td>
                          <td className="p-2">{r.recovery_date}</td>
                          <td className="p-2 font-semibold">{r.party_name}</td>
                          <td className="p-2">{r.town_name || '—'}</td>
                          <td className="p-2 font-mono">{r.supply_number || 'General'}</td>
                          <td className="p-2 text-right font-mono">
                            {Number(r.previous_outstanding || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-700">
                            {Number(r.recovery_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {Number(r.remaining_balance || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold text-[10px]">
                              {r.payment_method}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenPrint({
                                  docType: 'recovery-receipt',
                                  title: 'RECOVERY RECEIPT VOUCHER',
                                  headerMeta: [
                                    { label: 'Receipt No', value: r.recovery_receipt_number },
                                    { label: 'Date', value: r.recovery_date },
                                    { label: 'Party Name', value: r.party_name },
                                    { label: 'Town', value: r.town_name || '—' },
                                    { label: 'Salesman', value: r.salesman_name || '—' },
                                    { label: 'Payment Method', value: r.payment_method },
                                  ],
                                  columns: [
                                    { key: 'supply_number', label: 'Supply No' },
                                    { key: 'invoice_number', label: 'Invoice No' },
                                    { key: 'previous_outstanding', label: 'Previous Balance', align: 'right' },
                                    { key: 'recovery_amount', label: 'Recovered Amount', align: 'right' },
                                    { key: 'remaining_balance', label: 'Remaining Balance', align: 'right' },
                                  ],
                                  rows: [r as unknown as Record<string, unknown>],
                                  totals: [
                                    { label: 'Recovered Amount', value: r.recovery_amount, highlight: true },
                                    { label: 'Closing Balance', value: r.remaining_balance },
                                  ],
                                  footerNotes: r.remarks,
                                })
                              }
                              className="p-1 rounded hover:bg-slate-200 text-slate-700"
                              title="Print Recovery Receipt"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Specialized 3 Recovery Reports View (Party-Wise, Town-Wise, Supply Number-Wise) */
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={recFilterFrom}
                    onChange={(e) => setRecFilterFrom(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={recFilterTo}
                    onChange={(e) => setRecFilterTo(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    Town
                  </label>
                  <select
                    value={recFilterTown}
                    onChange={(e) => setRecFilterTown(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  >
                    <option value="">All Towns</option>
                    {towns.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.town_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    Salesman
                  </label>
                  <select
                    value={recFilterSalesman}
                    onChange={(e) => setRecFilterSalesman(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  >
                    <option value="">All Salesmen</option>
                    {salesmen.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    Supply No
                  </label>
                  <input
                    type="text"
                    value={recFilterSupplyNo}
                    onChange={(e) => setRecFilterSupplyNo(e.target.value)}
                    placeholder="SUP-..."
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadSpecialRecoveryReport(recoveryTab)}
                  className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-1"
                >
                  <Search className="w-3.5 h-3.5" />
                  Apply Filters
                </button>
              </div>

              {recoveryTab === 'town-wise' && Array.isArray(specialRecoveryData?.rows) && (
                <div className="space-y-3">
                  {specialRecoveryData.rows.map((tr: any) => (
                    <div
                      key={tr.town_id}
                      className="border border-slate-200 rounded-lg overflow-hidden"
                    >
                      <div className="bg-slate-900 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold">
                          TOWN: {tr.town_name} ({tr.total_parties} Parties)
                        </span>
                        <div className="flex flex-wrap items-center gap-4 font-mono">
                          <span>Supplied: Rs. {Number(tr.total_supplied_amount || 0).toLocaleString()}</span>
                          <span>Return: Rs. {Number(tr.total_return_amount || 0).toLocaleString()}</span>
                          <span>Net Bill: Rs. {Number(tr.net_final_bill || 0).toLocaleString()}</span>
                          <span className="text-emerald-400 font-bold">
                            Recovered: Rs. {Number(tr.total_recovery || 0).toLocaleString()}
                          </span>
                          <span className="text-amber-300 font-bold">
                            Balance: Rs. {Number(tr.remaining_balance || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 text-[10px] uppercase">
                          <tr>
                            <th className="p-2 text-left">Party Name</th>
                            <th className="p-2 text-left">Area</th>
                            <th className="p-2 text-left">Salesman</th>
                            <th className="p-2 text-right">Supplied</th>
                            <th className="p-2 text-right">Return</th>
                            <th className="p-2 text-right">Net Final Bill</th>
                            <th className="p-2 text-right">Recovered</th>
                            <th className="p-2 text-right">Remaining Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {(tr.parties || []).map((p: any) => (
                            <tr key={p.party_account_id}>
                              <td className="p-2 font-semibold">{p.party_name}</td>
                              <td className="p-2">{p.area_name || '—'}</td>
                              <td className="p-2">{p.salesman_name || '—'}</td>
                              <td className="p-2 text-right font-mono">
                                {Number(p.supplied_amount || 0).toLocaleString()}
                              </td>
                              <td className="p-2 text-right font-mono">
                                {Number(p.return_amount || 0).toLocaleString()}
                              </td>
                              <td className="p-2 text-right font-mono">
                                {Number(p.net_final_bill || 0).toLocaleString()}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-emerald-700">
                                {Number(p.total_recovery || 0).toLocaleString()}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-rose-700">
                                {Number(p.remaining_balance || 0).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              {recoveryTab === 'supply-wise' && Array.isArray(specialRecoveryData?.rows) && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-100 text-[10px] uppercase">
                      <tr>
                        <th className="p-2 text-left">Supply Number</th>
                        <th className="p-2 text-left">Supply Date</th>
                        <th className="p-2 text-left">Salesman</th>
                        <th className="p-2 text-left">Town</th>
                        <th className="p-2 text-right">Supply Amount</th>
                        <th className="p-2 text-right">Return Amount</th>
                        <th className="p-2 text-right">Net Bill Amount</th>
                        <th className="p-2 text-right">Total Recovered</th>
                        <th className="p-2 text-right">Pending Balance</th>
                        <th className="p-2 text-center">Entries</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {specialRecoveryData.rows.map((sr: any) => (
                        <tr key={sr.town_supply_id} className="hover:bg-slate-50">
                          <td className="p-2 font-mono font-bold">{sr.supply_number}</td>
                          <td className="p-2">{sr.supply_date}</td>
                          <td className="p-2">{sr.salesman_name}</td>
                          <td className="p-2 font-semibold">{sr.town_name}</td>
                          <td className="p-2 text-right font-mono">
                            {Number(sr.total_supply_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {Number(sr.total_return_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold">
                            {Number(sr.net_bill_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-700">
                            {Number(sr.total_recovered_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-rose-700">
                            {Number(sr.pending_balance || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-center">
                            {(sr.recovery_entries || []).length} Receipt(s)
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {recoveryTab === 'party-wise' && Array.isArray(specialRecoveryData?.rows) && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-100 text-[10px] uppercase">
                      <tr>
                        <th className="p-2 text-left">Receipt No</th>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Party Name</th>
                        <th className="p-2 text-left">Town</th>
                        <th className="p-2 text-left">Salesman</th>
                        <th className="p-2 text-left">Supply No</th>
                        <th className="p-2 text-right">Previous Bal</th>
                        <th className="p-2 text-right">Recovered</th>
                        <th className="p-2 text-right">Remaining Bal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {specialRecoveryData.rows.map((r: any) => (
                        <tr key={r.id}>
                          <td className="p-2 font-mono font-bold">{r.recovery_receipt_number}</td>
                          <td className="p-2">{r.recovery_date}</td>
                          <td className="p-2 font-semibold">{r.party_name}</td>
                          <td className="p-2">{r.town_name}</td>
                          <td className="p-2">{r.salesman_name}</td>
                          <td className="p-2 font-mono">{r.supply_number || '—'}</td>
                          <td className="p-2 text-right font-mono">
                            {Number(r.previous_outstanding || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-700">
                            {Number(r.recovery_amount || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {Number(r.remaining_balance || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          SECTION 12: SALESMAN SETTLEMENT
         ==================================================================== */}
      {activeSection === 'supply-settlement' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2">
              Daily / Date-Wise Salesman Settlement
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Salesman</label>
                <select
                  value={stlSalesmanId}
                  onChange={(e) => setStlSalesmanId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="">Select Salesman...</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">From Date</label>
                <input
                  type="date"
                  value={stlFromDate}
                  onChange={(e) => setStlFromDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">To Date</label>
                <input
                  type="date"
                  value={stlToDate}
                  onChange={(e) => setStlToDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handlePreviewSettlement}
              className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
            >
              Calculate Salesman Settlement Summary
            </button>

            {stlPreview && (
              <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Salesman Name:</span>
                  <span className="font-bold">{stlPreview.salesman_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Supplies:</span>
                  <span className="font-mono font-bold">
                    Rs. {Number(stlPreview.total_supplies || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Returns:</span>
                  <span className="font-mono font-bold">
                    Rs. {Number(stlPreview.total_returns || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Final Billing:</span>
                  <span className="font-mono font-bold">
                    Rs. {Number(stlPreview.total_final_billing || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Cash Collected (Unsettled):</span>
                  <span className="font-mono font-bold text-emerald-700">
                    Rs. {Number(stlPreview.total_cash_collected || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Bank Collections:</span>
                  <span className="font-mono font-bold text-sky-700">
                    Rs. {Number(stlPreview.total_bank_collections || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-600">Total Party Outstanding:</span>
                  <span className="font-mono font-bold text-rose-700">
                    Rs. {Number(stlPreview.total_outstanding || 0).toLocaleString()}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cash Submitted to Store (Rs.)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={stlCashSubmitted}
                    onChange={(e) => setStlCashSubmitted(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-black border-2 border-emerald-500 rounded-lg"
                  />
                </div>

                <div className="flex justify-between pt-1">
                  <span className="font-bold text-slate-700">Remaining Cash in Hand:</span>
                  <span className="font-mono font-black text-amber-700">
                    Rs.{' '}
                    {Math.max(
                      0,
                      Number(stlPreview.total_cash_collected || 0) - Number(stlCashSubmitted || 0)
                    ).toLocaleString()}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={stlRemarks}
                    onChange={(e) => setStlRemarks(e.target.value)}
                    placeholder="Daily settlement notes..."
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveSettlement}
                  disabled={savingSettlement}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {savingSettlement ? 'Saving Settlement...' : 'Complete & Save Salesman Settlement'}
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Completed Salesman Settlements ({settlementsList.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Settlement No</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Salesman</th>
                    <th className="p-2 text-right">Supplies</th>
                    <th className="p-2 text-right">Final Billing</th>
                    <th className="p-2 text-right">Cash Collected</th>
                    <th className="p-2 text-right">Cash Submitted</th>
                    <th className="p-2 text-right">In Hand</th>
                    <th className="p-2 text-center">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {settlementsList.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="p-2 font-mono font-bold">{st.settlement_number}</td>
                      <td className="p-2">{st.settlement_date}</td>
                      <td className="p-2 font-semibold">{st.salesman_name}</td>
                      <td className="p-2 text-right font-mono">
                        {Number(st.total_supplies || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {Number(st.total_final_billing || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {Number(st.total_cash_collected || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {Number(st.cash_submitted_to_store || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono text-amber-700">
                        {Number(st.remaining_cash_in_hand || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenPrint({
                              docType: 'salesman-settlement',
                              title: 'SALESMAN SETTLEMENT SHEET',
                              headerMeta: [
                                { label: 'Settlement No', value: st.settlement_number },
                                { label: 'Settlement Date', value: st.settlement_date },
                                { label: 'Salesman', value: st.salesman_name },
                                { label: 'Period', value: `${st.from_date} to ${st.to_date}` },
                              ],
                              columns: [
                                { key: 'metric', label: 'Settlement Head' },
                                { key: 'amount', label: 'Amount (Rs.)', align: 'right' },
                              ],
                              rows: [
                                { metric: 'Total Supplies', amount: st.total_supplies },
                                { metric: 'Total Returns', amount: st.total_returns },
                                { metric: 'Total Final Billing', amount: st.total_final_billing },
                                { metric: 'Total Cash Collected', amount: st.total_cash_collected },
                                { metric: 'Total Bank Collections', amount: st.total_bank_collections },
                                { metric: 'Cash Submitted to Store', amount: st.cash_submitted_to_store },
                                { metric: 'Remaining Cash in Hand', amount: st.remaining_cash_in_hand },
                                { metric: 'Total Territory Outstanding', amount: st.total_outstanding },
                              ],
                              totals: [
                                {
                                  label: 'Cash Submitted to Store',
                                  value: st.cash_submitted_to_store,
                                  highlight: true,
                                },
                              ],
                              footerNotes: st.remarks,
                            })
                          }
                          className="p-1 rounded hover:bg-slate-200"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SECTION 13: COMPLETE SUPPLY & DISTRIBUTION REPORTING SUITE (All 38 Reports)
         ==================================================================== */}
      {activeSection === 'supply-reports' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
          {/* Category Pills */}
          <div className="flex flex-wrap gap-2 border-b pb-3">
            {Object.entries(REPORT_CATALOG).map(([catKey, catObj]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => {
                  setRepCategory(catKey);
                  setRepKey(catObj.reports[0].key);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  repCategory === catKey
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {catObj.label}
              </button>
            ))}
          </div>

          {/* Sub-report selector */}
          <div className="flex flex-wrap gap-1.5">
            {(REPORT_CATALOG[repCategory]?.reports || []).map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRepKey(r.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition ${
                  repKey === r.key
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Universal Report Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">
                From Date
              </label>
              <input
                type="date"
                value={repFromDate}
                onChange={(e) => setRepFromDate(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">
                To Date
              </label>
              <input
                type="date"
                value={repToDate}
                onChange={(e) => setRepToDate(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">
                Salesman
              </label>
              <select
                value={repSalesmanId}
                onChange={(e) => setRepSalesmanId(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              >
                <option value="">All Salesmen</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">Town</label>
              <select
                value={repTownId}
                onChange={(e) => setRepTownId(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              >
                <option value="">All Towns</option>
                {towns.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.town_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">Party</label>
              <select
                value={repPartyId}
                onChange={(e) => setRepPartyId(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              >
                <option value="">All Parties</option>
                {allParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.account_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase">
                Search / Supply No
              </label>
              <input
                type="text"
                value={repSearch}
                onChange={(e) => setRepSearch(e.target.value)}
                placeholder="Search keyword..."
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={loadReportSuite}
                className="flex-1 py-1.5 px-2 rounded bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? 'animate-spin' : ''}`} />
                Run
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeTitle =
                    REPORT_CATALOG[repCategory]?.reports.find((r) => r.key === repKey)?.label ||
                    'Distribution Report';
                  exportSupplyTableToExcel({
                    title: activeTitle,
                    fileName: `${repKey}_${today}.xlsx`,
                    columns: repData.columns,
                    rows: repData.rows,
                    grandTotals: repData.grandTotals,
                  });
                }}
                className="p-1.5 rounded bg-emerald-600 text-white"
                title="Export Report to Excel"
              >
                <FileSpreadsheet className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeTitle =
                    REPORT_CATALOG[repCategory]?.reports.find((r) => r.key === repKey)?.label ||
                    'Distribution Report';
                  onOpenPrint({
                    docType: 'report',
                    title: activeTitle,
                    headerMeta: [
                      { label: 'Category', value: REPORT_CATALOG[repCategory]?.label || '' },
                      { label: 'From Date', value: repFromDate || 'All' },
                      { label: 'To Date', value: repToDate || 'All' },
                      { label: 'Total Records', value: repData.rows.length },
                    ],
                    columns: repData.columns,
                    rows: repData.rows,
                    totals: Object.entries(repData.grandTotals).map(([k, v]) => ({
                      label: repData.columns.find((c) => c.key === k)?.label || k,
                      value: v,
                      highlight: true,
                    })),
                  });
                }}
                className="p-1.5 rounded bg-slate-800 text-white"
                title="Print / Save PDF"
              >
                <Printer className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Report Table with Grand Totals */}
          <div className="overflow-x-auto max-h-[540px] border border-slate-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-900 text-white uppercase text-[10px] sticky top-0">
                <tr>
                  {repData.columns.map((col) => (
                    <th
                      key={col.key}
                      className={`p-2 ${
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {repData.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, repData.columns.length)}
                      className="p-8 text-center text-slate-500"
                    >
                      <FileBarChart className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                      No matching records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  repData.rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      {repData.columns.map((col) => {
                        const val = r[col.key];
                        return (
                          <td
                            key={col.key}
                            className={`p-2 ${
                              col.align === 'right'
                                ? 'text-right font-mono'
                                : col.align === 'center'
                                ? 'text-center'
                                : 'text-left'
                            }`}
                          >
                            {typeof val === 'number' ? val.toLocaleString() : String(val ?? '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
              {repData.rows.length > 0 && Object.keys(repData.grandTotals).length > 0 && (
                <tfoot className="bg-slate-100 border-t-2 border-slate-900 font-black">
                  <tr>
                    {repData.columns.map((col, idx) => (
                      <td
                        key={col.key}
                        className={`p-2 ${
                          col.align === 'right' ? 'text-right font-mono' : 'text-left'
                        }`}
                      >
                        {idx === 0
                          ? `GRAND TOTAL (${repData.rows.length} rows)`
                          : repData.grandTotals[col.key] !== undefined
                          ? repData.grandTotals[col.key].toLocaleString()
                          : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
