import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Truck,
  ClipboardCheck,
  Plus,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Banknote,
  BarChart3,
  Printer,
  RefreshCw,
  Search,
  Power,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { SalesmanRecord, DeliverymanRecord, DeliveryTrackingRecord } from '../../types/sales';
import { formatPKR } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

export type StaffWorkspaceTab = 'salesmen' | 'deliverymen' | 'deliveries';

interface StaffAndDeliveryWorkspaceViewProps {
  initialTab?: StaffWorkspaceTab;
}

type SalesmanReportType =
  | 'daily-sales'
  | 'monthly-performance'
  | 'customer-sales'
  | 'profit'
  | 'commission'
  | 'commission-outstanding';

type DeliveryReportType =
  | 'daily-deliveries'
  | 'monthly-deliveries'
  | 'pending-deliveries'
  | 'failed-deliveries'
  | 'delivery-charges';

export const StaffAndDeliveryWorkspaceView: React.FC<StaffAndDeliveryWorkspaceViewProps> = ({
  initialTab = 'salesmen',
}) => {
  const [activeTab, setActiveTab] = useState<StaffWorkspaceTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Global notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const salesmanReportPrintRef = useRef<HTMLDivElement>(null);
  const deliveryReportPrintRef = useRef<HTMLDivElement>(null);

  // =========================================================================
  // 1. SALESMEN MANAGEMENT & COMMISSION REPORTS STATE
  // =========================================================================
  const [salesmen, setSalesmen] = useState<SalesmanRecord[]>([]);
  const [salesmanSearch, setSalesmanSearch] = useState('');
  const [salesmanSubView, setSalesmanSubView] = useState<'directory' | 'reports'>('directory');

  // Salesman Form Modal
  const [salesmanModalOpen, setSalesmanModalOpen] = useState(false);
  const [editingSalesman, setEditingSalesman] = useState<SalesmanRecord | null>(null);
  const [smCode, setSmCode] = useState('');
  const [smName, setSmName] = useState('');
  const [smMobile, setSmMobile] = useState('');
  const [smAddress, setSmAddress] = useState('');
  const [smJoiningDate, setSmJoiningDate] = useState(new Date().toISOString().slice(0, 10));
  const [smCommissionType, setSmCommissionType] = useState<'Percentage' | 'Fixed Amount'>(
    'Percentage'
  );
  const [smCommissionRate, setSmCommissionRate] = useState<number>(1.5);
  const [smStatus, setSmStatus] = useState<'Active' | 'Inactive'>('Active');
  const [smNotes, setSmNotes] = useState('');

  // Commission Payment Modal
  const [commissionPayModal, setCommissionPayModal] = useState<SalesmanRecord | null>(null);
  const [commPayDate, setCommPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [commPayAmount, setCommPayAmount] = useState<number>(0);
  const [commPayMethod, setCommPayMethod] = useState<'Cash' | 'Bank'>('Cash');
  const [commPayRef, setCommPayRef] = useState('');
  const [commPayNotes, setCommPayNotes] = useState('');

  // Salesman Reports
  const [selectedSmReport, setSelectedSmReport] = useState<SalesmanReportType>('daily-sales');
  const [smReportFilterId, setSmReportFilterId] = useState<string>('');
  const [smReportFromDate, setSmReportFromDate] = useState<string>('2026-01-01');
  const [smReportToDate, setSmReportToDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [smReportData, setSmReportData] = useState<any[]>([]);
  const [smReportSummary, setSmReportSummary] = useState<any>(null);

  // =========================================================================
  // 2. DELIVERYMEN MANAGEMENT STATE
  // =========================================================================
  const [deliverymen, setDeliverymen] = useState<DeliverymanRecord[]>([]);
  const [deliverymanSearch, setDeliverymanSearch] = useState('');
  const [deliverymanModalOpen, setDeliverymanModalOpen] = useState(false);
  const [editingDeliveryman, setEditingDeliveryman] = useState<DeliverymanRecord | null>(null);
  const [dmCode, setDmCode] = useState('');
  const [dmName, setDmName] = useState('');
  const [dmMobile, setDmMobile] = useState('');
  const [dmAddress, setDmAddress] = useState('');
  const [dmJoiningDate, setDmJoiningDate] = useState(new Date().toISOString().slice(0, 10));
  const [dmStatus, setDmStatus] = useState<'Active' | 'Inactive'>('Active');
  const [dmNotes, setDmNotes] = useState('');

  // =========================================================================
  // 3. DELIVERY TRACKING & DELIVERY REPORTS STATE
  // =========================================================================
  const [deliverySubView, setDeliverySubView] = useState<'dispatch' | 'reports'>('dispatch');
  const [deliveries, setDeliveries] = useState<DeliveryTrackingRecord[]>([]);
  const [deliverySummary, setDeliverySummary] = useState<any>(null);
  const [delFilterStatus, setDelFilterStatus] = useState<string>('ALL');
  const [delFilterDeliverymanId, setDelFilterDeliverymanId] = useState<string>('');
  const [delSearch, setDelSearch] = useState<string>('');

  // Edit Delivery Modal
  const [editingDelivery, setEditingDelivery] = useState<DeliveryTrackingRecord | null>(null);
  const [editDelDeliverymanId, setEditDelDeliverymanId] = useState<string>('');
  const [editDelStatus, setEditDelStatus] = useState<
    'Pending' | 'Assigned' | 'Out for Delivery' | 'Delivered' | 'Failed' | 'Returned'
  >('Pending');
  const [editDelDate, setEditDelDate] = useState<string>('');
  const [editDelTime, setEditDelTime] = useState<string>('');
  const [editDelCharges, setEditDelCharges] = useState<number>(0);
  const [editDelNotes, setEditDelNotes] = useState<string>('');
  const [editDelCompletedBy, setEditDelCompletedBy] = useState<string>('');

  // Delivery Reports
  const [selectedDelReport, setSelectedDelReport] =
    useState<DeliveryReportType>('daily-deliveries');
  const [delReportFilterId, setDelReportFilterId] = useState<string>('');
  const [delReportFromDate, setDelReportFromDate] = useState<string>('2026-01-01');
  const [delReportToDate, setDelReportToDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [delReportData, setDelReportData] = useState<any[]>([]);
  const [delReportSummary, setDelReportSummary] = useState<any>(null);

  // =========================================================================
  // DATA LOADERS
  // =========================================================================
  const fetchAllStaffAndDeliveries = useCallback(async () => {
    try {
      setLoading(true);
      const [smRes, dmRes, delRes] = await Promise.all([
        api.getSalesmen({ q: salesmanSearch }),
        api.getDeliverymen({ q: deliverymanSearch }),
        api.getDeliveries({
          deliveryStatus: delFilterStatus === 'ALL' ? undefined : delFilterStatus,
          deliverymanId: delFilterDeliverymanId ? Number(delFilterDeliverymanId) : undefined,
          q: delSearch,
        }),
      ]);
      setSalesmen(smRes.data || []);
      setDeliverymen(dmRes.data || []);
      setDeliveries(delRes.data || []);
      setDeliverySummary(delRes.summary || null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [salesmanSearch, deliverymanSearch, delFilterStatus, delFilterDeliverymanId, delSearch]);

  useEffect(() => {
    fetchAllStaffAndDeliveries();
  }, [fetchAllStaffAndDeliveries]);

  const fetchSalesmanReport = useCallback(async () => {
    try {
      const res = await api.getSalesmanReport(selectedSmReport, {
        salesmanId: smReportFilterId ? Number(smReportFilterId) : undefined,
        startDate: smReportFromDate,
        endDate: smReportToDate,
      });
      setSmReportData(res.data || []);
      setSmReportSummary(res.summary || null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [selectedSmReport, smReportFilterId, smReportFromDate, smReportToDate]);

  useEffect(() => {
    if (activeTab === 'salesmen' && salesmanSubView === 'reports') {
      fetchSalesmanReport();
    }
  }, [activeTab, salesmanSubView, fetchSalesmanReport]);

  const fetchDeliveryReport = useCallback(async () => {
    try {
      const res = await api.getDeliveryReport(selectedDelReport, {
        deliverymanId: delReportFilterId ? Number(delReportFilterId) : undefined,
        startDate: delReportFromDate,
        endDate: delReportToDate,
      });
      setDelReportData(res.data || []);
      setDelReportSummary(res.summary || null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [selectedDelReport, delReportFilterId, delReportFromDate, delReportToDate]);

  useEffect(() => {
    if (activeTab === 'deliveries' && deliverySubView === 'reports') {
      fetchDeliveryReport();
    }
  }, [activeTab, deliverySubView, fetchDeliveryReport]);

  // =========================================================================
  // SALESMAN HANDLERS
  // =========================================================================
  const handleOpenNewSalesman = () => {
    setEditingSalesman(null);
    setSmCode(`SM-${String(salesmen.length + 1).padStart(3, '0')}`);
    setSmName('');
    setSmMobile('');
    setSmAddress('');
    setSmJoiningDate(new Date().toISOString().slice(0, 10));
    setSmCommissionType('Percentage');
    setSmCommissionRate(1.5);
    setSmStatus('Active');
    setSmNotes('');
    setSalesmanModalOpen(true);
  };

  const handleOpenEditSalesman = (sm: SalesmanRecord) => {
    setEditingSalesman(sm);
    setSmCode(sm.salesman_code);
    setSmName(sm.name);
    setSmMobile(sm.mobile || '');
    setSmAddress(sm.address || '');
    setSmJoiningDate(sm.joining_date || new Date().toISOString().slice(0, 10));
    setSmCommissionType(sm.commission_type || 'Percentage');
    setSmCommissionRate(Number(sm.commission_rate || 0));
    setSmStatus(sm.status || 'Active');
    setSmNotes(sm.notes || '');
    setSalesmanModalOpen(true);
  };

  const handleSaveSalesman = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErrorMsg(null);
      const payload = {
        salesman_code: smCode.trim(),
        name: smName.trim(),
        mobile: smMobile.trim(),
        address: smAddress.trim(),
        joining_date: smJoiningDate,
        commission_type: smCommissionType,
        commission_rate: Number(smCommissionRate || 0),
        status: smStatus,
        notes: smNotes.trim(),
      };
      if (editingSalesman) {
        const res = await api.updateSalesman(editingSalesman.id, payload);
        setSuccessMsg(res.message);
      } else {
        const res = await api.createSalesman(payload);
        setSuccessMsg(res.message);
      }
      setSalesmanModalOpen(false);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleSalesmanStatus = async (sm: SalesmanRecord) => {
    try {
      const nextStatus = sm.status === 'Active' ? 'Inactive' : 'Active';
      const res = await api.updateSalesmanStatus(sm.id, nextStatus);
      setSuccessMsg(res.message);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenPayCommission = (sm: SalesmanRecord) => {
    setCommissionPayModal(sm);
    setCommPayDate(new Date().toISOString().slice(0, 10));
    setCommPayAmount(Math.max(0, Number(sm.commission_outstanding || 0)));
    setCommPayMethod('Cash');
    setCommPayRef(`COM-${Date.now().toString().slice(-5)}`);
    setCommPayNotes(`Sales commission settlement for ${sm.name}`);
  };

  const handleSubmitCommissionPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commissionPayModal) return;
    try {
      setErrorMsg(null);
      const res = await api.paySalesmanCommission(commissionPayModal.id, {
        payment_date: commPayDate,
        amount: Number(commPayAmount || 0),
        payment_method: commPayMethod,
        reference_no: commPayRef,
        notes: commPayNotes,
      });
      setSuccessMsg(res.message);
      setCommissionPayModal(null);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // =========================================================================
  // DELIVERYMAN HANDLERS
  // =========================================================================
  const handleOpenNewDeliveryman = () => {
    setEditingDeliveryman(null);
    setDmCode(`DM-${String(deliverymen.length + 1).padStart(3, '0')}`);
    setDmName('');
    setDmMobile('');
    setDmAddress('');
    setDmJoiningDate(new Date().toISOString().slice(0, 10));
    setDmStatus('Active');
    setDmNotes('');
    setDeliverymanModalOpen(true);
  };

  const handleOpenEditDeliveryman = (dm: DeliverymanRecord) => {
    setEditingDeliveryman(dm);
    setDmCode(dm.deliveryman_code);
    setDmName(dm.name);
    setDmMobile(dm.mobile || '');
    setDmAddress(dm.address || '');
    setDmJoiningDate(dm.joining_date || new Date().toISOString().slice(0, 10));
    setDmStatus(dm.status || 'Active');
    setDmNotes(dm.notes || '');
    setDeliverymanModalOpen(true);
  };

  const handleSaveDeliveryman = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErrorMsg(null);
      const payload = {
        deliveryman_code: dmCode.trim(),
        name: dmName.trim(),
        mobile: dmMobile.trim(),
        address: dmAddress.trim(),
        joining_date: dmJoiningDate,
        status: dmStatus,
        notes: dmNotes.trim(),
      };
      if (editingDeliveryman) {
        const res = await api.updateDeliveryman(editingDeliveryman.id, payload);
        setSuccessMsg(res.message);
      } else {
        const res = await api.createDeliveryman(payload);
        setSuccessMsg(res.message);
      }
      setDeliverymanModalOpen(false);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleDeliverymanStatus = async (dm: DeliverymanRecord) => {
    try {
      const nextStatus = dm.status === 'Active' ? 'Inactive' : 'Active';
      const res = await api.updateDeliverymanStatus(dm.id, nextStatus);
      setSuccessMsg(res.message);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // =========================================================================
  // DELIVERY TRACKING HANDLERS
  // =========================================================================
  const handleOpenEditDelivery = (del: DeliveryTrackingRecord) => {
    setEditingDelivery(del);
    setEditDelDeliverymanId(del.deliveryman_id ? String(del.deliveryman_id) : '');
    setEditDelStatus((del.delivery_status as any) || 'Pending');
    setEditDelDate(del.delivery_date || new Date().toISOString().slice(0, 10));
    setEditDelTime(del.delivery_time || new Date().toTimeString().slice(0, 5));
    setEditDelCharges(Number(del.delivery_charges || 0));
    setEditDelNotes(del.delivery_notes || '');
    setEditDelCompletedBy(del.delivery_completed_by || '');
  };

  const handleSaveDeliveryTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDelivery) return;
    try {
      setErrorMsg(null);
      const chosenDm = deliverymen.find((d) => d.id === Number(editDelDeliverymanId));
      const targetSaleId = Number(editingDelivery.sale_id || editingDelivery.id || 0);
      const res = await api.updateDeliveryTracking(targetSaleId, {
        deliveryman_id: editDelDeliverymanId ? Number(editDelDeliverymanId) : null,
        deliveryman_name: chosenDm ? chosenDm.name : '',
        delivery_status: editDelStatus,
        delivery_date: editDelDate,
        delivery_time: editDelTime,
        delivery_charges: Number(editDelCharges || 0),
        delivery_notes: editDelNotes,
        delivery_completed_by: editDelCompletedBy,
      });
      setSuccessMsg(res.message);
      setEditingDelivery(null);
      await fetchAllStaffAndDeliveries();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Module Switcher */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('salesmen')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'salesmen'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>1. Salesman Management & Commissions ({salesmen.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('deliverymen')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'deliverymen'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>2. Deliveryman Management ({deliverymen.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('deliveries')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'deliveries'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>3. Delivery Management & Dispatch ({deliveries.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={fetchAllStaffAndDeliveries}
          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="font-bold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="font-bold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
          TAB 1: SALESMAN MANAGEMENT & 6 SALESMAN REPORTS
      ===================================================================== */}
      {activeTab === 'salesmen' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setSalesmanSubView('directory')}
                className={`px-3 py-1.5 rounded-md cursor-pointer ${
                  salesmanSubView === 'directory'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Salesmen Directory & Commission Settlement
              </button>
              <button
                type="button"
                onClick={() => setSalesmanSubView('reports')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer ${
                  salesmanSubView === 'reports'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                Salesman Performance & Commission Reports (6)
              </button>
            </div>

            {salesmanSubView === 'directory' && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={salesmanSearch}
                    onChange={(e) => setSalesmanSearch(e.target.value)}
                    placeholder="Search code, name, mobile..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleOpenNewSalesman}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Salesman</span>
                </button>
              </div>
            )}
          </div>

          {salesmanSubView === 'directory' ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-3">Code</th>
                      <th className="py-3 px-3">Salesman Name</th>
                      <th className="py-3 px-2.5">Mobile / Address</th>
                      <th className="py-3 px-2.5">Joining Date</th>
                      <th className="py-3 px-2.5">Commission Type & Rate</th>
                      <th className="py-3 px-2.5 text-right">Invoices</th>
                      <th className="py-3 px-2.5 text-right">Total Sales</th>
                      <th className="py-3 px-2.5 text-right">Earned Comm.</th>
                      <th className="py-3 px-2.5 text-right">Paid Comm.</th>
                      <th className="py-3 px-2.5 text-right">Outstanding</th>
                      <th className="py-3 px-2.5 text-center">Status</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {salesmen.map((sm) => (
                      <tr key={sm.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          {sm.salesman_code}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{sm.name}</td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-mono text-slate-800">{sm.mobile || '—'}</div>
                          <div className="text-[10px] text-slate-500">{sm.address || '—'}</div>
                        </td>
                        <td className="py-2.5 px-2.5 font-mono">{sm.joining_date}</td>
                        <td className="py-2.5 px-2.5">
                          <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono font-bold text-[11px]">
                            {sm.commission_type === 'Percentage'
                              ? `${Number(sm.commission_rate).toFixed(2)}% of Net Sale`
                              : `${formatPKR(Number(sm.commission_rate))} / Invoice`}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold">
                          {sm.completed_invoices_count ?? sm.invoice_count ?? 0}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900">
                          {formatPKR(Number(sm.total_net_sales ?? sm.total_sales_amount ?? 0))}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                          {formatPKR(
                            Number(sm.total_commission_earned ?? sm.commission_earned ?? 0)
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-sky-700">
                          {formatPKR(Number(sm.total_commission_paid ?? sm.commission_paid ?? 0))}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-black text-amber-800">
                          {formatPKR(Number(sm.commission_outstanding || 0))}
                        </td>
                        <td className="py-2.5 px-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              sm.status === 'Active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {sm.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenPayCommission(sm)}
                              className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Record Commission Payment"
                            >
                              <Banknote className="w-3 h-3" />
                              Pay
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditSalesman(sm)}
                              className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                              title="Edit Salesman"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleSalesmanStatus(sm)}
                              className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                              title={sm.status === 'Active' ? 'Deactivate' : 'Activate'}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* 6 Salesman Reports View */
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 print:hidden">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'daily-sales', label: '1. Salesman Daily Sales' },
                      { id: 'monthly-performance', label: '2. Monthly Performance' },
                      { id: 'customer-sales', label: '3. Customer-wise Sales' },
                      { id: 'profit', label: '4. Salesman Profit' },
                      { id: 'commission', label: '5. Commission Report' },
                      { id: 'commission-outstanding', label: '6. Commission Paid & Outstanding' },
                    ] as Array<{ id: SalesmanReportType; label: string }>
                  ).map((rep) => (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => setSelectedSmReport(rep.id)}
                      className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                        selectedSmReport === rep.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {rep.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (salesmanReportPrintRef.current) {
                      printReportDocument(
                        salesmanReportPrintRef.current,
                        `Abrar Medical Store - Salesman Report (${selectedSmReport})`,
                        { orientation: 'landscape', paperSize: 'a4' }
                      );
                    } else {
                      window.print();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs border border-slate-700"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  Print Report
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 print:hidden">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Filter Salesman
                  </label>
                  <select
                    value={smReportFilterId}
                    onChange={(e) => setSmReportFilterId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">All Salesmen</option>
                    {salesmen.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.salesman_code}] {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={smReportFromDate}
                    onChange={(e) => setSmReportFromDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={smReportToDate}
                    onChange={(e) => setSmReportToDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={fetchSalesmanReport}
                    className="w-full py-1.5 px-3 rounded bg-slate-900 text-white font-bold cursor-pointer"
                  >
                    Run Report
                  </button>
                </div>
              </div>

              {/* Printable Salesman Report */}
              <div ref={salesmanReportPrintRef} className="space-y-4">
                <PrintDocumentHeader
                  title={`SALESMAN PERFORMANCE REPORT — ${selectedSmReport.toUpperCase()}`}
                  subtitle="Staff commission tracking, sales volume, profit contribution, and payment reconciliation"
                  dateRange={{ fromDate: smReportFromDate, toDate: smReportToDate }}
                  metaFields={[
                    {
                      label: 'Salesman',
                      value: smReportFilterId
                        ? salesmen.find((s) => String(s.id) === String(smReportFilterId))?.name || 'Selected'
                        : 'All Salesmen',
                    },
                    { label: 'Report Mode', value: selectedSmReport },
                    { label: 'Total Records', value: `${smReportData.length}` },
                  ]}
                />

                {smReportSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(smReportSummary).map(([k, v]) => (
                    <div
                      key={k}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col"
                    >
                      <span className="text-[10px] uppercase font-bold text-slate-500">
                        {k.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-black font-mono text-slate-900 mt-0.5">
                        {typeof v === 'number' && !k.includes('count') && !k.includes('invoices')
                          ? formatPKR(v)
                          : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      {smReportData.length > 0 ? (
                        Object.keys(smReportData[0]).map((col) => (
                          <th key={col} className="p-2.5">
                            {col.replace(/_/g, ' ')}
                          </th>
                        ))
                      ) : (
                        <th className="p-2.5">Report Results</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {smReportData.length === 0 ? (
                      <tr>
                        <td className="p-6 text-center text-slate-400">
                          No records found for the selected filter criteria.
                        </td>
                      </tr>
                    ) : (
                      smReportData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {Object.entries(row).map(([col, val], cIdx) => (
                            <td key={cIdx} className="p-2.5 font-mono">
                              {typeof val === 'number' &&
                              (col.includes('amount') ||
                                col.includes('total') ||
                                col.includes('profit') ||
                                col.includes('commission') ||
                                col.includes('cost') ||
                                col.includes('revenue') ||
                                col.includes('outstanding') ||
                                col.includes('paid'))
                                ? formatPKR(val)
                                : String(val ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 2: DELIVERYMAN MANAGEMENT
      ===================================================================== */}
      {activeTab === 'deliverymen' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Deliveryman Directory & Rider Performance
              </h3>
              <p className="text-[11px] text-slate-500">
                Separate from Salesmen • Tracks assigned, delivered, pending, and failed deliveries
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={deliverymanSearch}
                  onChange={(e) => setDeliverymanSearch(e.target.value)}
                  placeholder="Search deliveryman..."
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={handleOpenNewDeliveryman}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Deliveryman</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-900 text-white uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-3">Code</th>
                  <th className="py-3 px-3">Deliveryman Name</th>
                  <th className="py-3 px-2.5">Mobile / Address</th>
                  <th className="py-3 px-2.5">Joining Date</th>
                  <th className="py-3 px-2.5 text-right">Total Assigned</th>
                  <th className="py-3 px-2.5 text-right">Delivered</th>
                  <th className="py-3 px-2.5 text-right">Pending / Out</th>
                  <th className="py-3 px-2.5 text-right">Failed / Returned</th>
                  <th className="py-3 px-2.5 text-right">Delivery Charges</th>
                  <th className="py-3 px-2.5 text-center">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {deliverymen.map((dm) => (
                  <tr key={dm.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      {dm.deliveryman_code}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">{dm.name}</td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-mono text-slate-800">{dm.mobile || '—'}</div>
                      <div className="text-[10px] text-slate-500">{dm.address || '—'}</div>
                    </td>
                    <td className="py-2.5 px-2.5 font-mono">{dm.joining_date}</td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold">
                      {dm.total_assigned_invoices ?? dm.total_assigned ?? 0}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold text-emerald-700">
                      {dm.delivered_count || 0}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold text-amber-700">
                      {dm.pending_count || 0}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono font-bold text-rose-700">
                      {dm.failed_or_returned_count ?? dm.failed_count ?? 0}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono">
                      {formatPKR(Number(dm.total_delivery_charges || 0))}
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          dm.status === 'Active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {dm.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditDeliveryman(dm)}
                          className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                          title="Edit Deliveryman"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleDeliverymanStatus(dm)}
                          className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                          title={dm.status === 'Active' ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: DELIVERY MANAGEMENT & 5 DELIVERY REPORTS
      ===================================================================== */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setDeliverySubView('dispatch')}
                className={`px-3 py-1.5 rounded-md cursor-pointer ${
                  deliverySubView === 'dispatch'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Live Delivery Dispatch & Status Board
              </button>
              <button
                type="button"
                onClick={() => setDeliverySubView('reports')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer ${
                  deliverySubView === 'reports'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                Delivery Reports (5)
              </button>
            </div>

            {deliverySubView === 'dispatch' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={delFilterStatus}
                  onChange={(e) => setDelFilterStatus(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="Assigned">Assigned</option>
                  <option value="Out for Delivery">Out for Delivery</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Failed">Failed</option>
                  <option value="Returned">Returned</option>
                </select>
                <select
                  value={delFilterDeliverymanId}
                  onChange={(e) => setDelFilterDeliverymanId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="">All Deliverymen</option>
                  {deliverymen.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      [{dm.deliveryman_code}] {dm.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={delSearch}
                  onChange={(e) => setDelSearch(e.target.value)}
                  placeholder="Search invoice # or customer..."
                  className="px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            )}
          </div>

          {deliverySubView === 'dispatch' ? (
            <>
              {deliverySummary && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Pending
                    </span>
                    <div className="text-base font-black font-mono text-amber-700">
                      {deliverySummary.pending_count || 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Assigned
                    </span>
                    <div className="text-base font-black font-mono text-blue-700">
                      {deliverySummary.assigned_count || 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Out for Delivery
                    </span>
                    <div className="text-base font-black font-mono text-purple-700">
                      {deliverySummary.out_for_delivery_count || 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Delivered
                    </span>
                    <div className="text-base font-black font-mono text-emerald-700">
                      {deliverySummary.delivered_count || 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Failed / Returned
                    </span>
                    <div className="text-base font-black font-mono text-rose-700">
                      {(deliverySummary.failed_count || 0) + (deliverySummary.returned_count || 0)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      Delivery Charges
                    </span>
                    <div className="text-base font-black font-mono text-slate-900">
                      {formatPKR(Number(deliverySummary.total_delivery_charges || 0))}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-3">Invoice #</th>
                      <th className="py-3 px-2.5">Invoice Date</th>
                      <th className="py-3 px-2.5">Customer & Address</th>
                      <th className="py-3 px-2.5">Salesman</th>
                      <th className="py-3 px-2.5">Assigned Deliveryman</th>
                      <th className="py-3 px-2.5 text-center">Delivery Status</th>
                      <th className="py-3 px-2.5">Delivery Date / Time</th>
                      <th className="py-3 px-2.5 text-right">Invoice Net</th>
                      <th className="py-3 px-2.5 text-right">Del. Charges</th>
                      <th className="py-3 px-3 text-right">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {deliveries.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-slate-400">
                          No sales invoices found matching the delivery filter.
                        </td>
                      </tr>
                    ) : (
                      deliveries.map((del) => (
                        <tr key={del.sale_id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                            {del.invoice_number}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono">{del.invoice_date}</td>
                          <td className="py-2.5 px-2.5">
                            <div className="font-bold text-slate-900">{del.customer_name}</div>
                            <div className="text-[10px] text-slate-500">
                              {del.customer_phone || ''} {del.customer_address || ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-2.5 font-medium text-slate-700">
                            {del.salesman || '—'}
                          </td>
                          <td className="py-2.5 px-2.5 font-bold text-teal-800">
                            {del.deliveryman_name || 'Unassigned'}
                          </td>
                          <td className="py-2.5 px-2.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                del.delivery_status === 'Delivered'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : del.delivery_status === 'Out for Delivery' ||
                                    del.delivery_status === 'Assigned'
                                  ? 'bg-blue-100 text-blue-800'
                                  : del.delivery_status === 'Failed' ||
                                    del.delivery_status === 'Returned'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {del.delivery_status || 'Pending'}
                            </span>
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-[11px]">
                            {del.delivery_date || '—'} {del.delivery_time || ''}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono font-bold">
                            {formatPKR(Number(del.net_total || 0))}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono">
                            {formatPKR(Number(del.delivery_charges || 0))}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleOpenEditDelivery(del)}
                              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Update Delivery
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            /* 5 Delivery Reports View */
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 print:hidden">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'daily-deliveries', label: '1. Daily Deliveries' },
                      { id: 'monthly-deliveries', label: '2. Monthly Delivery Report' },
                      { id: 'pending-deliveries', label: '3. Pending Deliveries' },
                      { id: 'failed-deliveries', label: '4. Failed / Returned Deliveries' },
                      { id: 'delivery-charges', label: '5. Delivery Charges Report' },
                    ] as Array<{ id: DeliveryReportType; label: string }>
                  ).map((rep) => (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => setSelectedDelReport(rep.id)}
                      className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                        selectedDelReport === rep.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {rep.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (deliveryReportPrintRef.current) {
                      printReportDocument(
                        deliveryReportPrintRef.current,
                        `Abrar Medical Store - Delivery Report (${selectedDelReport})`,
                        { orientation: 'landscape', paperSize: 'a4' }
                      );
                    } else {
                      window.print();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-xs border border-slate-700"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  Print Report
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 print:hidden">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Filter Deliveryman
                  </label>
                  <select
                    value={delReportFilterId}
                    onChange={(e) => setDelReportFilterId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">All Deliverymen</option>
                    {deliverymen.map((d) => (
                      <option key={d.id} value={d.id}>
                        [{d.deliveryman_code}] {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={delReportFromDate}
                    onChange={(e) => setDelReportFromDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={delReportToDate}
                    onChange={(e) => setDelReportToDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={fetchDeliveryReport}
                    className="w-full py-1.5 px-3 rounded bg-slate-900 text-white font-bold cursor-pointer"
                  >
                    Run Report
                  </button>
                </div>
              </div>

              {/* Printable Delivery Report */}
              <div ref={deliveryReportPrintRef} className="space-y-4">
                <PrintDocumentHeader
                  title={`DELIVERY DISPATCH & CHARGES REPORT — ${selectedDelReport.toUpperCase()}`}
                  subtitle="Rider performance, dispatched parcels, pending deliveries, and collected delivery charges"
                  dateRange={{ fromDate: delReportFromDate, toDate: delReportToDate }}
                  metaFields={[
                    {
                      label: 'Deliveryman',
                      value: delReportFilterId
                        ? deliverymen.find((d) => String(d.id) === String(delReportFilterId))?.name || 'Selected'
                        : 'All Deliverymen',
                    },
                    { label: 'Report Mode', value: selectedDelReport },
                    { label: 'Total Records', value: `${delReportData.length}` },
                  ]}
                />

                {delReportSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(delReportSummary).map(([k, v]) => (
                    <div
                      key={k}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col"
                    >
                      <span className="text-[10px] uppercase font-bold text-slate-500">
                        {k.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-black font-mono text-slate-900 mt-0.5">
                        {typeof v === 'number' &&
                        (k.includes('amount') || k.includes('charges') || k.includes('total'))
                          ? formatPKR(v)
                          : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      {delReportData.length > 0 ? (
                        Object.keys(delReportData[0]).map((col) => (
                          <th key={col} className="p-2.5">
                            {col.replace(/_/g, ' ')}
                          </th>
                        ))
                      ) : (
                        <th className="p-2.5">Delivery Report Results</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {delReportData.length === 0 ? (
                      <tr>
                        <td className="p-6 text-center text-slate-400">
                          No delivery records found for the selected filter criteria.
                        </td>
                      </tr>
                    ) : (
                      delReportData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {Object.entries(row).map(([col, val], cIdx) => (
                            <td key={cIdx} className="p-2.5 font-mono">
                              {typeof val === 'number' &&
                              (col.includes('amount') ||
                                col.includes('total') ||
                                col.includes('charges'))
                                ? formatPKR(val)
                                : String(val ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL 1: ADD / EDIT SALESMAN
      ===================================================================== */}
      {salesmanModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveSalesman}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-5 text-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingSalesman ? `Edit Salesman — ${editingSalesman.name}` : 'Add New Salesman'}
              </h3>
              <button
                type="button"
                onClick={() => setSalesmanModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Salesman Code *</label>
                <input
                  type="text"
                  required
                  value={smCode}
                  onChange={(e) => setSmCode(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={smName}
                  onChange={(e) => setSmName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={smMobile}
                  onChange={(e) => setSmMobile(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Joining Date</label>
                <input
                  type="date"
                  value={smJoiningDate}
                  onChange={(e) => setSmJoiningDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={smAddress}
                  onChange={(e) => setSmAddress(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Commission Type</label>
                <select
                  value={smCommissionType}
                  onChange={(e) =>
                    setSmCommissionType(e.target.value as 'Percentage' | 'Fixed Amount')
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                >
                  <option value="Percentage">Percentage of Net Sale (%)</option>
                  <option value="Fixed Amount">Fixed Amount per Invoice (PKR)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Commission Rate ({smCommissionType === 'Percentage' ? '%' : 'PKR'})
                </label>
                <NumericInput
                  step="0.01"
                  min="0"
                  value={smCommissionRate}
                  onChange={(e) => setSmCommissionRate(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={smStatus}
                  onChange={(e) => setSmStatus(e.target.value as 'Active' | 'Inactive')}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={smNotes}
                  onChange={(e) => setSmNotes(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setSalesmanModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Save Salesman
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: PAY SALESMAN COMMISSION
      ===================================================================== */}
      {commissionPayModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitCommissionPayment}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-5 text-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Pay Salesman Commission — {commissionPayModal.name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Outstanding Commission:{' '}
                  <strong className="font-mono text-amber-800">
                    {formatPKR(Number(commissionPayModal.commission_outstanding || 0))}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCommissionPayModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={commPayDate}
                  onChange={(e) => setCommPayDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Amount Paid (PKR) *
                </label>
                <NumericInput
                  step="0.01"
                  min="1"
                  required
                  value={commPayAmount}
                  onChange={(e) => setCommPayAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded-lg border border-emerald-400 font-mono font-black text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={commPayMethod}
                    onChange={(e) => setCommPayMethod(e.target.value as 'Cash' | 'Bank')}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reference #</label>
                  <input
                    type="text"
                    value={commPayRef}
                    onChange={(e) => setCommPayRef(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={commPayNotes}
                  onChange={(e) => setCommPayNotes(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCommissionPayModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Record Commission Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: ADD / EDIT DELIVERYMAN
      ===================================================================== */}
      {deliverymanModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDeliveryman}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-5 text-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingDeliveryman
                  ? `Edit Deliveryman — ${editingDeliveryman.name}`
                  : 'Add New Deliveryman'}
              </h3>
              <button
                type="button"
                onClick={() => setDeliverymanModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Deliveryman Code *
                </label>
                <input
                  type="text"
                  required
                  value={dmCode}
                  onChange={(e) => setDmCode(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={dmName}
                  onChange={(e) => setDmName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={dmMobile}
                  onChange={(e) => setDmMobile(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Joining Date</label>
                <input
                  type="date"
                  value={dmJoiningDate}
                  onChange={(e) => setDmJoiningDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={dmAddress}
                  onChange={(e) => setDmAddress(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={dmStatus}
                  onChange={(e) => setDmStatus(e.target.value as 'Active' | 'Inactive')}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={dmNotes}
                  onChange={(e) => setDmNotes(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDeliverymanModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Save Deliveryman
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: UPDATE DELIVERY TRACKING (WITHOUT ALTERING INVOICE TOTALS)
      ===================================================================== */}
      {editingDelivery && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDeliveryTracking}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-5 text-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Update Delivery Status — {editingDelivery.invoice_number}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Customer: <strong>{editingDelivery.customer_name}</strong> • Invoice Net:{' '}
                  <strong className="font-mono">
                    {formatPKR(Number(editingDelivery.net_total || 0))}
                  </strong>{' '}
                  (Protected)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDelivery(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assigned Deliveryman
                </label>
                <select
                  value={editDelDeliverymanId}
                  onChange={(e) => setEditDelDeliverymanId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                >
                  <option value="">— Unassigned —</option>
                  {deliverymen
                    .filter((d) => d.status === 'Active' || d.id === Number(editDelDeliverymanId))
                    .map((dm) => (
                      <option key={dm.id} value={dm.id}>
                        [{dm.deliveryman_code}] {dm.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Delivery Status *</label>
                <select
                  value={editDelStatus}
                  onChange={(e) => setEditDelStatus(e.target.value as any)}
                  className="w-full px-3 py-1.5 rounded-lg border border-emerald-400 font-bold bg-white"
                >
                  <option value="Pending">Pending</option>
                  <option value="Assigned">Assigned</option>
                  <option value="Out for Delivery">Out for Delivery</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Failed">Failed</option>
                  <option value="Returned">Returned</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Delivery Date</label>
                <input
                  type="date"
                  value={editDelDate}
                  onChange={(e) => setEditDelDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Delivery Time</label>
                <input
                  type="time"
                  value={editDelTime}
                  onChange={(e) => setEditDelTime(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Delivery Charges (Reference PKR)
                </label>
                <NumericInput
                  step="0.01"
                  min="0"
                  value={editDelCharges}
                  onChange={(e) => setEditDelCharges(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Delivery Completed / Verified By
                </label>
                <input
                  type="text"
                  value={editDelCompletedBy}
                  onChange={(e) => setEditDelCompletedBy(e.target.value)}
                  placeholder="Receiver / Rider Name"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Delivery Notes / Receiver Remarks
                </label>
                <input
                  type="text"
                  value={editDelNotes}
                  onChange={(e) => setEditDelNotes(e.target.value)}
                  placeholder="Address landmark, receiver signature ref, or failure reason..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingDelivery(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Save Delivery Update
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
