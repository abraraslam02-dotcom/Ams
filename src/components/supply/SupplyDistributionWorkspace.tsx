import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  Users,
  MapPin,
  ClipboardList,
  BookOpen,
  Layers,
  PackageCheck,
  Send,
  RotateCcw,
  Receipt,
  Wallet,
  Scale,
  FileBarChart,
  Plus,
  Printer,
  FileSpreadsheet,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  SupplySalesman,
  TownRecord,
  SupplyOrderForm,
  SupplyBooking,
  TownSupplyRecord,
  SupplyDispatchRecord,
  SupplyReturnRecord,
  OrderFormPrintLayout,
} from '../../types/supply';
import { SupplyPrintModal, type SupplyDocumentPrintType } from './SupplyPrintModal';
import { SupplyReportsAndRecoverySection } from './SupplyReportsAndRecoverySection';
import { ImportSalesmanBookingsPanel } from './ImportSalesmanBookingsPanel';
import { exportSupplyTableToExcel } from '../../utils/supplyExcelExport';

export type SupplySubView =
  | 'supply-dashboard'
  | 'supply-salesmen'
  | 'supply-towns'
  | 'supply-order-forms'
  | 'supply-bookings'
  | 'supply-import-bookings'
  | 'supply-creation'
  | 'supply-packing'
  | 'supply-dispatch'
  | 'supply-returns'
  | 'supply-billing'
  | 'supply-recovery'
  | 'supply-settlement'
  | 'supply-reports';

interface SupplyDistributionWorkspaceProps {
  initialView?: SupplySubView;
  onNavigate?: (view: SupplySubView) => void;
}

const NAV_TABS: Array<{ id: SupplySubView; label: string; icon: React.ComponentType<any> }> = [
  { id: 'supply-dashboard', label: 'Dashboard', icon: Truck },
  { id: 'supply-salesmen', label: '1. Salesmen', icon: Users },
  { id: 'supply-towns', label: '2. Towns / Areas', icon: MapPin },
  { id: 'supply-order-forms', label: '3. Order Form', icon: ClipboardList },
  { id: 'supply-bookings', label: '4. Booking', icon: BookOpen },
  { id: 'supply-import-bookings', label: 'Import Mobile Bookings', icon: Plus },
  { id: 'supply-creation', label: '5. Town Supply', icon: Layers },
  { id: 'supply-packing', label: '6. Packing', icon: PackageCheck },
  { id: 'supply-dispatch', label: '7. Dispatch', icon: Send },
  { id: 'supply-returns', label: '8. Return', icon: RotateCcw },
  { id: 'supply-billing', label: '9. Final Billing', icon: Receipt },
  { id: 'supply-recovery', label: '10. Recovery', icon: Wallet },
  { id: 'supply-settlement', label: '11. Settlement', icon: Scale },
  { id: 'supply-reports', label: '12. Reports (38)', icon: FileBarChart },
];

export const SupplyDistributionWorkspace: React.FC<SupplyDistributionWorkspaceProps> = ({
  initialView = 'supply-dashboard',
  onNavigate,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<SupplySubView>(initialView);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Core Shared Data
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [salesmen, setSalesmen] = useState<SupplySalesman[]>([]);
  const [towns, setTowns] = useState<TownRecord[]>([]);
  const [catalogCompanies, setCatalogCompanies] = useState<string[]>([]);
  const [catalogItems, setCatalogItems] = useState<Array<Record<string, any>>>([]);
  const [orderForms, setOrderForms] = useState<SupplyOrderForm[]>([]);
  const [bookings, setBookings] = useState<SupplyBooking[]>([]);
  const [supplies, setSupplies] = useState<TownSupplyRecord[]>([]);
  const [dispatches, setDispatches] = useState<SupplyDispatchRecord[]>([]);
  const [returnsList, setReturnsList] = useState<SupplyReturnRecord[]>([]);

  // Print Modal State
  const [printConfig, setPrintConfig] = useState<{
    isOpen: boolean;
    docType: SupplyDocumentPrintType;
    title: string;
    subtitle?: string;
    headerMeta?: Array<{ label: string; value: string | number }>;
    orderFormItems?: Array<any>;
    initialOrderLayout?: OrderFormPrintLayout;
    columns?: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
    rows?: Array<Record<string, unknown>>;
    totals?: Array<{ label: string; value: string | number; highlight?: boolean }>;
    footerNotes?: string;
  }>({
    isOpen: false,
    docType: 'order-form',
    title: '',
  });

  useEffect(() => {
    if (initialView && initialView !== activeTab) {
      setActiveTab(initialView);
    }
  }, [initialView]);

  const switchTab = (tab: SupplySubView) => {
    setActiveTab(tab);
    setBanner(null);
    if (onNavigate) onNavigate(tab);
  };

  const loadCoreData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, smRes, twnRes, catRes, ofRes, bkgRes, supRes, dspRes, retRes] =
        await Promise.all([
          api.getSupplyDashboard(),
          api.getSupplySalesmen(),
          api.getSupplyTowns(),
          api.getSupplyOrderFormCatalog(),
          api.getSupplyOrderForms(),
          api.getSupplyBookings(),
          api.getTownSupplies(),
          api.getSupplyDispatches(),
          api.getSupplyReturns(),
        ]);
      setDashboardData(dashRes);
      setSalesmen(smRes.salesmen || []);
      setTowns(twnRes.towns || []);
      setCatalogCompanies(catRes.companies || []);
      setCatalogItems(catRes.items || []);
      setOrderForms(ofRes.orderForms || []);
      setBookings(bkgRes.bookings || []);
      setSupplies(supRes.supplies || []);
      setDispatches(dspRes.dispatches || []);
      setReturnsList(retRes.returns || []);
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message || 'Failed to load supply data' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData]);

  const allParties = useMemo(() => {
    const map = new Map<number, any>();
    towns.forEach((t) => {
      t.parties.forEach((p) => map.set(p.id, p));
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.account_name).localeCompare(String(b.account_name))
    );
  }, [towns]);

  const allAreas = useMemo(() => {
    const list: Array<any> = [];
    towns.forEach((t) => {
      t.areas.forEach((a) => list.push(a));
    });
    return list;
  }, [towns]);

  // ==========================================================================
  // 1. SALESMAN FORM STATE
  // ==========================================================================
  const [editingSalesmanId, setEditingSalesmanId] = useState<number | null>(null);
  const [smCode, setSmCode] = useState('');
  const [smName, setSmName] = useState('');
  const [smUsername, setSmUsername] = useState('');
  const [smPassword, setSmPassword] = useState('');
  const [smPhone, setSmPhone] = useState('');
  const [smAddress, setSmAddress] = useState('');
  const [smOpeningBal, setSmOpeningBal] = useState('0');
  const [smStatus, setSmStatus] = useState<'Active' | 'Inactive'>('Active');
  const [smSelectedTownIds, setSmSelectedTownIds] = useState<number[]>([]);
  const [smSelectedAreaIds, setSmSelectedAreaIds] = useState<number[]>([]);
  const [smSelectedPartyIds, setSmSelectedPartyIds] = useState<number[]>([]);

  const handleEditSalesman = (s: SupplySalesman) => {
    setEditingSalesmanId(s.id);
    setSmCode(s.salesman_code);
    setSmName(s.full_name);
    setSmUsername((s as any).username || s.salesman_code || '');
    setSmPassword('');
    setSmPhone(s.phone || '');
    setSmAddress(s.address || '');
    setSmOpeningBal(String(s.opening_balance || 0));
    setSmStatus(s.status);
    setSmSelectedTownIds(s.assigned_towns.map((t) => t.town_id));
    setSmSelectedAreaIds(s.assigned_areas.map((a) => a.area_id));
    setSmSelectedPartyIds(s.assigned_parties.map((p) => p.party_account_id));
  };

  const resetSalesmanForm = () => {
    setEditingSalesmanId(null);
    setSmCode('');
    setSmName('');
    setSmUsername('');
    setSmPassword('');
    setSmPhone('');
    setSmAddress('');
    setSmOpeningBal('0');
    setSmStatus('Active');
    setSmSelectedTownIds([]);
    setSmSelectedAreaIds([]);
    setSmSelectedPartyIds([]);
  };

  const handleSaveSalesman = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.saveSupplySalesman(
        {
          salesman_code: smCode || undefined,
          full_name: smName,
          username: smUsername.trim() || undefined,
          password: smPassword || undefined,
          phone: smPhone,
          address: smAddress,
          opening_balance: Number(smOpeningBal || 0),
          status: smStatus,
          town_ids: smSelectedTownIds,
          area_ids: smSelectedAreaIds,
          party_account_ids: smSelectedPartyIds,
        } as any,
        editingSalesmanId || undefined
      );
      setBanner({
        type: 'success',
        msg: editingSalesmanId ? 'Salesman updated successfully.' : 'Salesman created successfully.',
      });
      resetSalesmanForm();
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  // ==========================================================================
  // 2. TOWN / AREA / PARTY MANAGEMENT STATE
  // ==========================================================================
  const [newTownName, setNewTownName] = useState('');
  const [newTownAreasInput, setNewTownAreasInput] = useState('');
  const [areaTargetTownId, setAreaTargetTownId] = useState('');
  const [newAreaName, setNewAreaName] = useState('');
  const [assignPartyIds, setAssignPartyIds] = useState<number[]>([]);
  const [assignTownId, setAssignTownId] = useState('');
  const [assignAreaId, setAssignAreaId] = useState('');
  const [assignSalesmanId, setAssignSalesmanId] = useState('');

  const handleCreateTown = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTownName.trim()) return;
    try {
      const areas = newTownAreasInput
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      await api.saveSupplyTown({ town_name: newTownName.trim(), areas });
      setNewTownName('');
      setNewTownAreasInput('');
      setBanner({ type: 'success', msg: `Town "${newTownName}" created.` });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!areaTargetTownId || !newAreaName.trim()) return;
    try {
      await api.createSupplyArea({
        town_id: Number(areaTargetTownId),
        area_name: newAreaName.trim(),
      });
      setNewAreaName('');
      setBanner({ type: 'success', msg: `Area "${newAreaName}" added to Town.` });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleAssignParties = async (e: React.FormEvent) => {
    e.preventDefault();
    if (assignPartyIds.length === 0 || !assignTownId) {
      setBanner({ type: 'error', msg: 'Select at least one Party and a Town.' });
      return;
    }
    try {
      await api.assignPartyTerritory({
        party_account_ids: assignPartyIds,
        town_id: Number(assignTownId),
        area_id: assignAreaId ? Number(assignAreaId) : null,
        salesman_id: assignSalesmanId ? Number(assignSalesmanId) : null,
      });
      setAssignPartyIds([]);
      setBanner({
        type: 'success',
        msg: `Assigned ${assignPartyIds.length} party(ies) to Town & Territory.`,
      });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  // ==========================================================================
  // 3. ORDER FORM STATE (Company-Wise A-Z, 1/2/3 Col Print, Convert to Booking)
  // ==========================================================================
  const [ofId, setOfId] = useState<number | null>(null);
  const [ofDate, setOfDate] = useState(today);
  const [ofSalesmanId, setOfSalesmanId] = useState('');
  const [ofTownId, setOfTownId] = useState('');
  const [ofAreaId, setOfAreaId] = useState('');
  const [ofPartyId, setOfPartyId] = useState('');
  const [ofLayout, setOfLayout] = useState<OrderFormPrintLayout>('1-col');
  const [ofRemarks, setOfRemarks] = useState('');
  const [ofCompanyFilter, setOfCompanyFilter] = useState('ALL');
  const [ofItemSearch, setOfItemSearch] = useState('');
  const [ofQuantities, setOfQuantities] = useState<Record<number, number>>({});
  const [ofItemRemarks, setOfItemRemarks] = useState<Record<number, string>>({});

  const filteredCatalogForOrderForm = useMemo(() => {
    return catalogItems.filter((it) => {
      if (ofCompanyFilter !== 'ALL' && String(it.company_name) !== ofCompanyFilter) return false;
      if (ofItemSearch.trim()) {
        const q = ofItemSearch.toLowerCase();
        if (
          !String(it.item_name || '').toLowerCase().includes(q) &&
          !String(it.item_code || '').toLowerCase().includes(q) &&
          !String(it.company_name || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [catalogItems, ofCompanyFilter, ofItemSearch]);

  const handleSaveOrderForm = async () => {
    const itemsToSave = catalogItems
      .filter((it) => (ofQuantities[it.id] || 0) > 0 || ofCompanyFilter !== 'ALL')
      .map((it) => ({
        item_id: it.id,
        trade_price: it.trade_price,
        quantity: Number(ofQuantities[it.id] || 0),
        remarks: ofItemRemarks[it.id] || '',
      }))
      .filter((it) => it.quantity > 0);

    // If user wants to save a blank/template order form for selected company or all items:
    const finalPayloadItems =
      itemsToSave.length > 0
        ? itemsToSave
        : filteredCatalogForOrderForm.map((it) => ({
            item_id: it.id,
            trade_price: it.trade_price,
            quantity: Number(ofQuantities[it.id] || 0),
            remarks: ofItemRemarks[it.id] || '',
          }));

    if (finalPayloadItems.length === 0) {
      setBanner({ type: 'error', msg: 'No items available to save in Order Form.' });
      return;
    }

    try {
      const res = await api.saveSupplyOrderForm(
        {
          order_date: ofDate,
          salesman_id: ofSalesmanId ? Number(ofSalesmanId) : null,
          town_id: ofTownId ? Number(ofTownId) : null,
          area_id: ofAreaId ? Number(ofAreaId) : null,
          party_account_id: ofPartyId ? Number(ofPartyId) : null,
          print_layout: ofLayout,
          remarks: ofRemarks,
          items: finalPayloadItems,
        },
        ofId || undefined
      );
      setBanner({
        type: 'success',
        msg: `Order Form ${res.orderForm.order_number} saved successfully!`,
      });
      setOfId(null);
      setOfQuantities({});
      setOfItemRemarks({});
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleConvertOrderFormToBooking = async (form: SupplyOrderForm) => {
    const targetPartyId = form.party_account_id || (ofPartyId ? Number(ofPartyId) : null);
    if (!targetPartyId) {
      setBanner({
        type: 'error',
        msg: 'Select a Party Name in the Order Form header (or edit the Order Form) before converting to Booking.',
      });
      return;
    }
    try {
      const res = await api.convertOrderFormToBooking(form.id, {
        party_account_id: targetPartyId,
        booking_date: today,
      });
      setBanner({
        type: 'success',
        msg: `Converted Order Form ${form.order_number} into Booking ${res.booking.booking_number}!`,
      });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  // ==========================================================================
  // 4. ORDER BOOKING STATE
  // ==========================================================================
  const [bkgDate, setBkgDate] = useState(today);
  const [bkgSalesmanId, setBkgSalesmanId] = useState('');
  const [bkgTownId, setBkgTownId] = useState('');
  const [bkgAreaId, setBkgAreaId] = useState('');
  const [bkgPartyId, setBkgPartyId] = useState('');
  const [bkgRemarks, setBkgRemarks] = useState('');
  const [bkgLines, setBkgLines] = useState<
    Array<{
      item_id: number;
      item_code: string;
      company_name: string;
      item_name: string;
      packing: string;
      quantity: number;
      bonus_quantity: number;
      trade_price: number;
      discount_percent: number;
    }>
  >([]);
  const [selectedBkgItemId, setSelectedBkgItemId] = useState('');

  const handleAddBkgLine = () => {
    const item = catalogItems.find((i) => Number(i.id) === Number(selectedBkgItemId));
    if (!item) return;
    setBkgLines((prev) => [
      ...prev,
      {
        item_id: item.id,
        item_code: item.item_code,
        company_name: item.company_name,
        item_name: item.item_name,
        packing: item.packing || '1x1',
        quantity: 1,
        bonus_quantity: 0,
        trade_price: Number(item.trade_price || 0),
        discount_percent: Number(item.discount_percent || 0),
      },
    ]);
    setSelectedBkgItemId('');
  };

  const handleSaveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bkgPartyId || bkgLines.length === 0) {
      setBanner({ type: 'error', msg: 'Select a Party Name and add at least one item.' });
      return;
    }
    try {
      const res = await api.saveSupplyBooking({
        booking_date: bkgDate,
        salesman_id: bkgSalesmanId ? Number(bkgSalesmanId) : null,
        town_id: bkgTownId ? Number(bkgTownId) : null,
        area_id: bkgAreaId ? Number(bkgAreaId) : null,
        party_account_id: Number(bkgPartyId),
        remarks: bkgRemarks,
        items: bkgLines,
      });
      setBanner({
        type: 'success',
        msg: `Order Booking ${res.booking.booking_number} saved (stock NOT deducted).`,
      });
      setBkgLines([]);
      setBkgRemarks('');
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  // ==========================================================================
  // 5. TOWN-WISE SUPPLY CREATION STATE
  // ==========================================================================
  const [supDate, setSupDate] = useState(today);
  const [supTownId, setSupTownId] = useState('');
  const [supSalesmanId, setSupSalesmanId] = useState('');
  const [supAreaId, setSupAreaId] = useState('');
  const [supRemarks, setSupRemarks] = useState('');
  const [townPendingBookings, setTownPendingBookings] = useState<SupplyBooking[]>([]);
  const [selectedSupplyLines, setSelectedSupplyLines] = useState<
    Array<{
      selected: boolean;
      booking_id: number | null;
      booking_item_id: number | null;
      booking_number: string;
      party_account_id: number;
      party_name: string;
      item_id: number;
      item_code: string;
      company_name: string;
      item_name: string;
      packing: string;
      ordered_quantity: number;
      supply_quantity: number;
      bonus_quantity: number;
      trade_price: number;
      discount_percent: number;
      available_packs: number;
    }>
  >([]);

  const loadPendingBookingsForTown = useCallback(async (tId: string, sId: string, aId: string) => {
    if (!tId) {
      setTownPendingBookings([]);
      setSelectedSupplyLines([]);
      return;
    }
    try {
      const res = await api.getTownPendingBookings({
        town_id: Number(tId),
        salesman_id: sId ? Number(sId) : undefined,
        area_id: aId ? Number(aId) : undefined,
      });
      const pendingList: SupplyBooking[] = res.pendingBookings || [];
      setTownPendingBookings(pendingList);

      const lines: typeof selectedSupplyLines = [];
      for (const b of pendingList) {
        for (const it of b.items) {
          lines.push({
            selected: true,
            booking_id: b.id,
            booking_item_id: it.id,
            booking_number: b.booking_number,
            party_account_id: b.party_account_id,
            party_name: b.party_name,
            item_id: it.item_id,
            item_code: it.item_code,
            company_name: it.company_name,
            item_name: it.item_name,
            packing: it.packing,
            ordered_quantity: Number(it.pending_quantity || it.quantity || 0),
            supply_quantity: Number(it.pending_quantity || it.quantity || 0),
            bonus_quantity: Number(it.bonus_quantity || 0),
            trade_price: Number(it.trade_price || 0),
            discount_percent: Number(it.discount_percent || 0),
            available_packs: Number(it.available_packs || 0),
          });
        }
      }
      setSelectedSupplyLines(lines);
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'supply-creation' && supTownId) {
      loadPendingBookingsForTown(supTownId, supSalesmanId, supAreaId);
    }
  }, [activeTab, supTownId, supSalesmanId, supAreaId, loadPendingBookingsForTown]);

  const handleCreateTownSupply = async () => {
    const chosen = selectedSupplyLines.filter((l) => l.selected && l.supply_quantity > 0);
    if (!supTownId || chosen.length === 0) {
      setBanner({
        type: 'error',
        msg: 'Select a Town and at least one pending booking item with Supply Quantity > 0.',
      });
      return;
    }
    try {
      const res = await api.createTownSupply({
        supply_date: supDate,
        town_id: Number(supTownId),
        salesman_id: supSalesmanId ? Number(supSalesmanId) : null,
        area_id: supAreaId ? Number(supAreaId) : null,
        remarks: supRemarks,
        items: chosen,
      });
      setBanner({
        type: 'success',
        msg: `Created Town Supply ${res.supply.supply_number} (${res.supply.total_parties} Party Supply Slips generated)!`,
      });
      await loadCoreData();
      switchTab('supply-packing');
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  // ==========================================================================
  // 6, 7, 8, 9. PACKING, DISPATCH, RETURN & FINAL BILLING STATE
  // ==========================================================================
  const [selectedSupplyId, setSelectedSupplyId] = useState<number | null>(null);
  const [dspVehicle, setDspVehicle] = useState('');
  const [dspDriver, setDspDriver] = useState('');
  const [dspRemarks, setDspRemarks] = useState('');

  // Return inputs: map party_supply_item_id -> { new_return_quantity, accepted_quantity, damaged_quantity, return_reason }
  const [returnInputs, setReturnInputs] = useState<
    Record<
      number,
      {
        new_return_quantity: number;
        accepted_quantity: number;
        damaged_quantity: number;
        return_reason: string;
      }
    >
  >({});

  const selectedSupplyObj = useMemo(
    () =>
      supplies.find((s) => s.id === selectedSupplyId) ||
      supplies[0] ||
      null,
    [supplies, selectedSupplyId]
  );

  const handlePackSupply = async (supplyId: number, packAll: boolean, partySupplyId?: number) => {
    try {
      const res = await api.packTownSupply(supplyId, {
        pack_all: packAll,
        party_supply_id: partySupplyId,
      });
      setBanner({
        type: 'success',
        msg: `Supply ${res.supply.supply_number} Packing Status: ${res.supply.packing_status} (${res.supply.supply_status})`,
      });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleDispatchSupply = async (supplyId: number) => {
    try {
      const res = await api.createSupplyDispatch({
        town_supply_id: supplyId,
        dispatch_date: today,
        vehicle_number: dspVehicle,
        delivery_person: dspDriver,
        remarks: dspRemarks,
      });
      setBanner({
        type: 'success',
        msg: `Dispatched Supply ${res.supply.supply_number} via Dispatch Challan ${res.dispatch.dispatch_number}! Inventory deducted once.`,
      });
      setDspVehicle('');
      setDspDriver('');
      setDspRemarks('');
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleRecordSalesmanReturn = async () => {
    if (!selectedSupplyObj) return;
    const itemsPayload = Object.entries(returnInputs)
      .filter(([, val]) => Number(val.new_return_quantity) > 0)
      .map(([itemIdStr, val]) => ({
        party_supply_item_id: Number(itemIdStr),
        new_return_quantity: Number(val.new_return_quantity),
        accepted_quantity: Number(val.accepted_quantity),
        damaged_quantity: Number(val.damaged_quantity),
        return_reason: val.return_reason || 'Unsold Return',
      }));

    if (itemsPayload.length === 0) {
      setBanner({ type: 'error', msg: 'Enter New Return Quantity > 0 for at least one item.' });
      return;
    }

    try {
      const res = await api.createSupplyReturn({
        town_supply_id: selectedSupplyObj.id,
        return_date: today,
        items: itemsPayload,
      });
      setBanner({
        type: 'success',
        msg: `Salesman Return ${res.returnRecord.return_number} saved! Accepted saleable stock restored to inventory.`,
      });
      setReturnInputs({});
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  const handleFinalizeBilling = async (supplyId: number, partySupplyId?: number) => {
    try {
      const res = await api.finalizeSupplyBilling(supplyId, {
        invoice_date: today,
        party_supply_id: partySupplyId,
      });
      setBanner({
        type: 'success',
        msg: `Generated ${res.invoices.length} Final Sales Invoice(s)! Party Ledgers & Sales Revenue updated without duplicate stock deduction.`,
      });
      await loadCoreData();
    } catch (err: any) {
      setBanner({ type: 'error', msg: err.message });
    }
  };

  return (
    <div className="p-3 sm:p-5 space-y-4 bg-slate-50 min-h-screen">
      {/* Header & Lifecycle Pipeline Bar */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-400">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black tracking-tight uppercase">
                Supply & Distribution Management System
              </h1>
              <p className="text-xs text-slate-300">
                Order Form → Booking → Town Supply → Packing → Dispatch → Return → Final Billing → Recovery → Settlement → Reports
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadCoreData}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
        </div>

        {/* Sub-Module Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800">
          {NAV_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-lg border text-xs font-bold flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <span>{banner.msg}</span>
          <button type="button" onClick={() => setBanner(null)} className="underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          0. SUPPLY DASHBOARD
         ==================================================================== */}
      {activeTab === 'supply-dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              {
                label: "Today's Order Forms",
                count: dashboardData?.kpis?.todayOrderForms?.count || 0,
                amount: dashboardData?.kpis?.todayOrderForms?.amount || 0,
                tab: 'supply-order-forms' as SupplySubView,
              },
              {
                label: "Today's Bookings",
                count: dashboardData?.kpis?.todayBookings?.count || 0,
                amount: dashboardData?.kpis?.todayBookings?.amount || 0,
                tab: 'supply-bookings' as SupplySubView,
              },
              {
                label: "Today's Supplies",
                count: dashboardData?.kpis?.todaySupplies?.count || 0,
                amount: dashboardData?.kpis?.todaySupplies?.amount || 0,
                tab: 'supply-creation' as SupplySubView,
              },
              {
                label: 'Pending Packing',
                count: dashboardData?.kpis?.pendingPacking?.count || 0,
                amount: dashboardData?.kpis?.pendingPacking?.amount || 0,
                tab: 'supply-packing' as SupplySubView,
              },
              {
                label: 'Ready for Dispatch',
                count: dashboardData?.kpis?.readyForDispatch?.count || 0,
                amount: dashboardData?.kpis?.readyForDispatch?.amount || 0,
                tab: 'supply-dispatch' as SupplySubView,
              },
              {
                label: 'Dispatched Supplies',
                count: dashboardData?.kpis?.dispatchedSupplies?.count || 0,
                amount: dashboardData?.kpis?.dispatchedSupplies?.amount || 0,
                tab: 'supply-dispatch' as SupplySubView,
              },
              {
                label: 'Pending Returns',
                count: dashboardData?.kpis?.pendingReturns?.count || 0,
                amount: dashboardData?.kpis?.pendingReturns?.amount || 0,
                tab: 'supply-returns' as SupplySubView,
              },
              {
                label: 'Pending Billing',
                count: dashboardData?.kpis?.pendingBilling?.count || 0,
                amount: dashboardData?.kpis?.pendingBilling?.amount || 0,
                tab: 'supply-billing' as SupplySubView,
              },
              {
                label: "Today's Final Sales",
                count: dashboardData?.kpis?.todayFinalSales?.count || 0,
                amount: dashboardData?.kpis?.todayFinalSales?.amount || 0,
                tab: 'supply-billing' as SupplySubView,
              },
              {
                label: "Today's Recovery",
                count: dashboardData?.kpis?.todayRecovery?.count || 0,
                amount: dashboardData?.kpis?.todayRecovery?.amount || 0,
                tab: 'supply-recovery' as SupplySubView,
              },
              {
                label: 'Total Outstanding',
                count: allParties.length,
                amount: dashboardData?.kpis?.totalOutstanding || 0,
                tab: 'supply-recovery' as SupplySubView,
              },
              {
                label: 'Active Towns / Salesmen',
                count: towns.length,
                amount: salesmen.length,
                isMeta: true,
                tab: 'supply-towns' as SupplySubView,
              },
            ].map((card, i) => (
              <button
                key={i}
                type="button"
                onClick={() => switchTab(card.tab)}
                className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-left hover:border-emerald-500 transition"
              >
                <div className="text-[11px] font-bold text-slate-500 uppercase">{card.label}</div>
                <div className="mt-1 text-lg font-black text-slate-900">
                  {card.isMeta
                    ? `${card.count} Towns / ${card.amount} SM`
                    : `Rs. ${Number(card.amount).toLocaleString()}`}
                </div>
                {!card.isMeta && (
                  <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                    {card.count} Record(s)
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Salesman-wise Performance */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
                Salesman-Wise Distribution Performance
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-[10px] uppercase">
                    <tr>
                      <th className="p-2 text-left">Salesman</th>
                      <th className="p-2 text-right">Bookings</th>
                      <th className="p-2 text-right">Supplies</th>
                      <th className="p-2 text-right">Returns</th>
                      <th className="p-2 text-right">Final Bill</th>
                      <th className="p-2 text-right">Recovery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(dashboardData?.salesmanPerformance || []).map((sp: any) => (
                      <tr key={sp.id}>
                        <td className="p-2 font-bold">{sp.salesman_name}</td>
                        <td className="p-2 text-right font-mono">
                          {Number(sp.bookings_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {Number(sp.supplies_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {Number(sp.returns_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono font-bold">
                          {Number(sp.billed_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-emerald-700">
                          {Number(sp.recovery_amount || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Town-wise Performance */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
                Town-Wise Distribution Performance
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-[10px] uppercase">
                    <tr>
                      <th className="p-2 text-left">Town</th>
                      <th className="p-2 text-right">Parties</th>
                      <th className="p-2 text-right">Supplies</th>
                      <th className="p-2 text-right">Final Sales</th>
                      <th className="p-2 text-right">Recovery</th>
                      <th className="p-2 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(dashboardData?.townPerformance || []).map((tp: any) => (
                      <tr key={tp.id}>
                        <td className="p-2 font-bold">{tp.town_name}</td>
                        <td className="p-2 text-right font-mono">{tp.total_parties}</td>
                        <td className="p-2 text-right font-mono">
                          {Number(tp.supply_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono font-bold">
                          {Number(tp.final_sales_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-emerald-700">
                          {Number(tp.recovery_amount || 0).toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-rose-700">
                          {Number(tp.outstanding_amount || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          1. SALESMAN MANAGEMENT
         ==================================================================== */}
      {activeTab === 'supply-salesmen' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form
            onSubmit={handleSaveSalesman}
            className="lg:col-span-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900">
                {editingSalesmanId ? 'Edit Salesman & Territories' : 'Add New Salesman'}
              </h3>
              {editingSalesmanId && (
                <button
                  type="button"
                  onClick={resetSalesmanForm}
                  className="text-xs text-slate-500 underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Salesman ID
                </label>
                <input
                  type="text"
                  value={smCode}
                  onChange={(e) => setSmCode(e.target.value)}
                  placeholder="Auto (e.g. SM-2026-0001)"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Status</label>
                <select
                  value={smStatus}
                  onChange={(e) => setSmStatus(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Salesman Name *
              </label>
              <input
                type="text"
                value={smName}
                onChange={(e) => setSmName(e.target.value)}
                placeholder="Full Name"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Mobile Login Username
                </label>
                <input
                  type="text"
                  value={smUsername}
                  onChange={(e) => setSmUsername(e.target.value)}
                  placeholder="e.g. ali.salesman"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Mobile App Password
                </label>
                <input
                  type="password"
                  value={smPassword}
                  onChange={(e) => setSmPassword(e.target.value)}
                  placeholder={editingSalesmanId ? 'Leave blank to keep' : 'Set login password'}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Mobile Number
                </label>
                <input
                  type="text"
                  value={smPhone}
                  onChange={(e) => setSmPhone(e.target.value)}
                  placeholder="+92 300 ..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Opening Balance
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={smOpeningBal}
                  onChange={(e) => setSmOpeningBal(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Address</label>
              <input
                type="text"
                value={smAddress}
                onChange={(e) => setSmAddress(e.target.value)}
                placeholder="Residential / Office address"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Assigned Towns (Select One or Multiple)
              </label>
              <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                {towns.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smSelectedTownIds.includes(t.id)}
                      onChange={(e) =>
                        setSmSelectedTownIds((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                        )
                      }
                    />
                    <span className="font-semibold">{t.town_name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Assigned Areas (Select Multiple)
              </label>
              <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                {allAreas.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smSelectedAreaIds.includes(a.id)}
                      onChange={(e) =>
                        setSmSelectedAreaIds((prev) =>
                          e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                        )
                      }
                    />
                    <span>
                      {a.area_name} <span className="text-slate-400">({a.town_name})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Assigned Parties ({smSelectedPartyIds.length} Selected)
              </label>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                {allParties.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smSelectedPartyIds.includes(p.id)}
                      onChange={(e) =>
                        setSmSelectedPartyIds((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                        )
                      }
                    />
                    <span className="truncate">
                      {p.account_name} <span className="text-slate-400">({p.town_name || 'No Town'})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow"
            >
              {editingSalesmanId ? 'Update Salesman' : 'Save Salesman'}
            </button>
          </form>

          <div className="lg:col-span-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Salesman Directory & Territory Ledger Summary ({salesmen.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">ID / Name</th>
                    <th className="p-2 text-left">Assigned Towns & Areas</th>
                    <th className="p-2 text-right">Parties</th>
                    <th className="p-2 text-right">Bookings</th>
                    <th className="p-2 text-right">Supplies</th>
                    <th className="p-2 text-right">Returns</th>
                    <th className="p-2 text-right">Final Sales</th>
                    <th className="p-2 text-right">Recovery</th>
                    <th className="p-2 text-right">Outstanding</th>
                    <th className="p-2 text-center">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {salesmen.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-bold text-slate-900">{s.full_name}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {s.salesman_code} • {s.phone || 'No Mobile'}
                        </div>
                      </td>
                      <td className="p-2 max-w-[180px]">
                        <div className="font-semibold text-slate-800 truncate">
                          {s.assigned_towns.map((t) => t.town_name).join(', ') || 'All Towns'}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {s.assigned_areas.map((a) => a.area_name).join(', ')}
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono">{s.assigned_parties.length}</td>
                      <td className="p-2 text-right font-mono">
                        {Number(s.bookings_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {Number(s.supplies_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {Number(s.returns_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(s.sales_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {Number(s.recoveries_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-rose-700">
                        {Number(s.outstanding_balance || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleEditSalesman(s)}
                          className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-[11px] font-bold"
                        >
                          Edit
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
          2. TOWN / AREA / PARTY MANAGEMENT (Strictly TOWN — Hierarchy: Salesman -> Town -> Area -> Party)
         ==================================================================== */}
      {activeTab === 'supply-towns' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Add Town */}
            <form
              onSubmit={handleCreateTown}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
            >
              <h3 className="font-bold text-sm text-slate-900 border-b pb-2">
                1. Add New Town
              </h3>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Town Name *
                </label>
                <input
                  type="text"
                  value={newTownName}
                  onChange={(e) => setNewTownName(e.target.value)}
                  placeholder="e.g. Lahore, Kasur, Sheikhupura..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Initial Areas under this Town (Comma separated)
                </label>
                <input
                  type="text"
                  value={newTownAreasInput}
                  onChange={(e) => setNewTownAreasInput(e.target.value)}
                  placeholder="e.g. Model Town, Gulberg, Johar Town"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
              >
                Save Town
              </button>
            </form>

            {/* Add Area under Town */}
            <form
              onSubmit={handleCreateArea}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
            >
              <h3 className="font-bold text-sm text-slate-900 border-b pb-2">
                2. Add Area Under Town
              </h3>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Select Town *
                </label>
                <select
                  value={areaTargetTownId}
                  onChange={(e) => setAreaTargetTownId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  required
                >
                  <option value="">Choose Town...</option>
                  {towns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.town_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Area Name *
                </label>
                <input
                  type="text"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  placeholder="e.g. Main Bazaar, Circular Road"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
              >
                Add Area to Town
              </button>
            </form>

            {/* Assign Existing Parties to Town / Area / Salesman */}
            <form
              onSubmit={handleAssignParties}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2.5"
            >
              <h3 className="font-bold text-sm text-slate-900 border-b pb-2">
                3. Assign Existing Parties to Town & Area
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600">Town *</label>
                  <select
                    value={assignTownId}
                    onChange={(e) => setAssignTownId(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                    required
                  >
                    <option value="">Town...</option>
                    {towns.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.town_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600">Area</label>
                  <select
                    value={assignAreaId}
                    onChange={(e) => setAssignAreaId(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  >
                    <option value="">Any Area</option>
                    {allAreas
                      .filter((a) => !assignTownId || Number(a.town_id) === Number(assignTownId))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.area_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600">Salesman</label>
                  <select
                    value={assignSalesmanId}
                    onChange={(e) => setAssignSalesmanId(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                  >
                    <option value="">Salesman...</option>
                    {salesmen.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="max-h-28 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50 space-y-1">
                {allParties.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assignPartyIds.includes(p.id)}
                      onChange={(e) =>
                        setAssignPartyIds((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                        )
                      }
                    />
                    <span className="truncate">
                      {p.account_name}{' '}
                      <span className="text-slate-400">
                        (Town: {p.town_name || 'Unassigned'})
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Assign Selected Parties ({assignPartyIds.length})
              </button>
            </form>
          </div>

          {/* Town Overview Table */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Town Hierarchy & Territory Summary ({towns.length} Towns)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Town Code & Name</th>
                    <th className="p-2 text-left">Areas under Town</th>
                    <th className="p-2 text-left">Assigned Salesmen</th>
                    <th className="p-2 text-right">Total Parties</th>
                    <th className="p-2 text-right">Town Supply</th>
                    <th className="p-2 text-right">Town Sales</th>
                    <th className="p-2 text-right">Town Recovery</th>
                    <th className="p-2 text-right">Town Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {towns.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-bold text-slate-900">{t.town_name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{t.town_code}</div>
                      </td>
                      <td className="p-2">
                        {t.areas.map((a) => a.area_name).join(', ') || 'Main Town'}
                      </td>
                      <td className="p-2">
                        {t.assigned_salesmen.map((s) => s.salesman_name).join(', ') || '—'}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">{t.total_parties}</td>
                      <td className="p-2 text-right font-mono">
                        {Number(t.total_supply_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(t.total_sales_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {Number(t.total_recovery_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-rose-700">
                        {Number(t.outstanding_balance || 0).toLocaleString()}
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
          3. ORDER FORM MODULE (Company-Wise A-Z, 1/2/3 Column Print, Convert to Booking)
         ==================================================================== */}
      {activeTab === 'supply-order-forms' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Company-Wise Order Form (Create / Print 1-Col, 2-Col, 3-Col A4 & Thermal)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Items are automatically grouped Company-Wise (A–Z) and sorted alphabetically inside each company. Does NOT deduct inventory.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintConfig({
                      isOpen: true,
                      docType: 'order-form',
                      title: 'COMPANY-WISE ORDER FORM',
                      initialOrderLayout: ofLayout,
                      headerMeta: [
                        { label: 'Store Name', value: 'ABRAR MEDICAL STORE' },
                        { label: 'Order Date', value: ofDate },
                        {
                          label: 'Salesman',
                          value:
                            salesmen.find((s) => s.id === Number(ofSalesmanId))?.full_name || '__________',
                        },
                        {
                          label: 'Town',
                          value:
                            towns.find((t) => t.id === Number(ofTownId))?.town_name || '__________',
                        },
                        {
                          label: 'Area',
                          value:
                            allAreas.find((a) => a.id === Number(ofAreaId))?.area_name || '__________',
                        },
                        {
                          label: 'Party Name',
                          value:
                            allParties.find((p) => p.id === Number(ofPartyId))?.account_name ||
                            '________________',
                        },
                      ],
                      orderFormItems: filteredCatalogForOrderForm.map((it) => ({
                        ...it,
                        quantity: Number(ofQuantities[it.id] || 0),
                        remarks: ofItemRemarks[it.id] || '',
                      })),
                      footerNotes: ofRemarks,
                    })
                  }
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Order Form (1 / 2 / 3 Columns)
                </button>
                <button
                  type="button"
                  onClick={handleSaveOrderForm}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow"
                >
                  Save Order Form
                </button>
              </div>
            </div>

            {/* Order Form Header Fields */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Order Date
                </label>
                <input
                  type="date"
                  value={ofDate}
                  onChange={(e) => setOfDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Salesman Name
                </label>
                <select
                  value={ofSalesmanId}
                  onChange={(e) => setOfSalesmanId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
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
                <label className="block text-[10px] font-bold text-slate-600 uppercase">Town</label>
                <select
                  value={ofTownId}
                  onChange={(e) => setOfTownId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Select Town...</option>
                  {towns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.town_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">Area</label>
                <select
                  value={ofAreaId}
                  onChange={(e) => setOfAreaId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Select Area...</option>
                  {allAreas
                    .filter((a) => !ofTownId || Number(a.town_id) === Number(ofTownId))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.area_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Party Name
                </label>
                <select
                  value={ofPartyId}
                  onChange={(e) => setOfPartyId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Select Party...</option>
                  {allParties
                    .filter((p) => !ofTownId || Number(p.town_id) === Number(ofTownId))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.account_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Print Layout Option
                </label>
                <select
                  value={ofLayout}
                  onChange={(e) => setOfLayout(e.target.value as OrderFormPrintLayout)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-bold"
                >
                  <option value="1-col">Option 1: Single Column (Detailed)</option>
                  <option value="2-col">Option 2: Two Columns (Medium)</option>
                  <option value="3-col">Option 3: Three Columns (Compact)</option>
                  <option value="thermal-80">80mm Thermal Roll</option>
                  <option value="thermal-58">58mm Thermal Roll</option>
                </select>
              </div>
            </div>

            {/* Company Filter & Search Bar */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-700">Company Filter:</span>
                <select
                  value={ofCompanyFilter}
                  onChange={(e) => setOfCompanyFilter(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded font-semibold bg-white"
                >
                  <option value="ALL">All Companies ({catalogCompanies.length})</option>
                  {catalogCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={ofItemSearch}
                onChange={(e) => setOfItemSearch(e.target.value)}
                placeholder="Search item code, item name, or company..."
                className="flex-1 min-w-[200px] px-2.5 py-1 text-xs border border-slate-300 rounded bg-white"
              />
              <input
                type="text"
                value={ofRemarks}
                onChange={(e) => setOfRemarks(e.target.value)}
                placeholder="Order Form Remarks..."
                className="w-60 px-2.5 py-1 text-xs border border-slate-300 rounded bg-white"
              />
            </div>

            {/* Company-Wise Item Entry Table */}
            <div className="max-h-[360px] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-900 text-white uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="p-2 text-center w-12">S.No</th>
                    <th className="p-2 text-left">Company Name</th>
                    <th className="p-2 text-left">Item Code</th>
                    <th className="p-2 text-left">Item Name</th>
                    <th className="p-2 text-right">Trade Price</th>
                    <th className="p-2 text-center w-28">Quantity</th>
                    <th className="p-2 text-left w-44">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredCatalogForOrderForm.map((it, idx) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="p-1.5 text-center font-mono">{idx + 1}</td>
                      <td className="p-1.5 font-bold text-slate-700">{it.company_name}</td>
                      <td className="p-1.5 font-mono">{it.item_code}</td>
                      <td className="p-1.5 font-semibold text-slate-900">{it.item_name}</td>
                      <td className="p-1.5 text-right font-mono">
                        {Number(it.trade_price || 0).toFixed(2)}
                      </td>
                      <td className="p-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={ofQuantities[it.id] || ''}
                          onChange={(e) =>
                            setOfQuantities((prev) => ({
                              ...prev,
                              [it.id]: Number(e.target.value || 0),
                            }))
                          }
                          placeholder="0"
                          className="w-20 px-2 py-1 text-center font-bold border border-slate-300 rounded"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={ofItemRemarks[it.id] || ''}
                          onChange={(e) =>
                            setOfItemRemarks((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder="Note..."
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Saved Order Forms Register */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Saved Order Forms ({orderForms.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Order No</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Salesman</th>
                    <th className="p-2 text-left">Town / Area</th>
                    <th className="p-2 text-left">Party Name</th>
                    <th className="p-2 text-right">Items</th>
                    <th className="p-2 text-right">Total Qty</th>
                    <th className="p-2 text-right">Total Amount</th>
                    <th className="p-2 text-center">Status</th>
                    <th className="p-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {orderForms.map((of) => (
                    <tr key={of.id} className="hover:bg-slate-50">
                      <td className="p-2 font-mono font-bold">{of.order_number}</td>
                      <td className="p-2">{of.order_date}</td>
                      <td className="p-2">{of.salesman_name || '—'}</td>
                      <td className="p-2">
                        {of.town_name || '—'} {of.area_name ? `/ ${of.area_name}` : ''}
                      </td>
                      <td className="p-2 font-semibold">{of.party_name || '—'}</td>
                      <td className="p-2 text-right font-mono">{of.total_items}</td>
                      <td className="p-2 text-right font-mono">{of.total_quantity}</td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(of.total_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            of.status === 'Converted'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {of.status}
                          {of.converted_booking_number ? ` (${of.converted_booking_number})` : ''}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setPrintConfig({
                                isOpen: true,
                                docType: 'order-form',
                                title: `ORDER FORM - ${of.order_number}`,
                                initialOrderLayout: of.print_layout || '1-col',
                                headerMeta: [
                                  { label: 'Order No', value: of.order_number },
                                  { label: 'Order Date', value: of.order_date },
                                  { label: 'Salesman', value: of.salesman_name || '—' },
                                  { label: 'Town', value: of.town_name || '—' },
                                  { label: 'Area', value: of.area_name || '—' },
                                  { label: 'Party Name', value: of.party_name || '—' },
                                ],
                                orderFormItems: of.items,
                                footerNotes: of.remarks,
                              })
                            }
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-bold text-[11px]"
                          >
                            Print
                          </button>
                          {of.status !== 'Converted' && (
                            <button
                              type="button"
                              onClick={() => handleConvertOrderFormToBooking(of)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1"
                            >
                              Convert to Booking <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
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
          4. ORDER BOOKING MODULE (Does NOT reduce inventory)
         ==================================================================== */}
      {activeTab === 'supply-bookings' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveBooking}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Create Customer / Salesman Order Booking
                </h3>
                <p className="text-[11px] text-slate-500">
                  Order Booking reserves customer order intent and does NOT reduce stock until Dispatched.
                </p>
              </div>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow"
              >
                Save Order Booking
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Booking Date
                </label>
                <input
                  type="date"
                  value={bkgDate}
                  onChange={(e) => setBkgDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Town *
                </label>
                <select
                  value={bkgTownId}
                  onChange={(e) => setBkgTownId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
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
                <label className="block text-[10px] font-bold text-slate-600 uppercase">Area</label>
                <select
                  value={bkgAreaId}
                  onChange={(e) => setBkgAreaId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Any Area</option>
                  {allAreas
                    .filter((a) => !bkgTownId || Number(a.town_id) === Number(bkgTownId))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.area_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Salesman
                </label>
                <select
                  value={bkgSalesmanId}
                  onChange={(e) => setBkgSalesmanId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Auto from Party</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Party Name *
                </label>
                <select
                  value={bkgPartyId}
                  onChange={(e) => setBkgPartyId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold"
                  required
                >
                  <option value="">Select Party...</option>
                  {allParties
                    .filter((p) => !bkgTownId || Number(p.town_id) === Number(bkgTownId))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.account_name} ({p.town_name || 'No Town'})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Add Item Picker */}
            <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              <select
                value={selectedBkgItemId}
                onChange={(e) => setSelectedBkgItemId(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Item to add to Booking...</option>
                {catalogItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.item_code} — {it.item_name} ({it.company_name}) | T.P: Rs.{' '}
                    {Number(it.trade_price || 0).toFixed(2)} | Stock: {it.available_packs}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddBkgLine}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            {/* Booking Line Grid */}
            {bkgLines.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      <th className="p-2 text-center">S.No</th>
                      <th className="p-2 text-left">Item Code</th>
                      <th className="p-2 text-left">Company</th>
                      <th className="p-2 text-left">Item Name</th>
                      <th className="p-2 text-center">Packing</th>
                      <th className="p-2 text-center">Quantity</th>
                      <th className="p-2 text-center">Bonus</th>
                      <th className="p-2 text-right">Trade Price</th>
                      <th className="p-2 text-center">Disc %</th>
                      <th className="p-2 text-right">Amount</th>
                      <th className="p-2 text-center">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {bkgLines.map((l, idx) => {
                      const gross = l.quantity * l.trade_price;
                      const net = gross * (1 - l.discount_percent / 100);
                      return (
                        <tr key={idx}>
                          <td className="p-1.5 text-center font-mono">{idx + 1}</td>
                          <td className="p-1.5 font-mono">{l.item_code}</td>
                          <td className="p-1.5">{l.company_name}</td>
                          <td className="p-1.5 font-semibold">{l.item_name}</td>
                          <td className="p-1.5 text-center">{l.packing}</td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="1"
                              value={l.quantity}
                              onChange={(e) =>
                                setBkgLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, quantity: Number(e.target.value || 1) }
                                      : row
                                  )
                                )
                              }
                              className="w-16 px-1.5 py-1 text-center font-bold border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              value={l.bonus_quantity}
                              onChange={(e) =>
                                setBkgLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, bonus_quantity: Number(e.target.value || 0) }
                                      : row
                                  )
                                )
                              }
                              className="w-14 px-1.5 py-1 text-center border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={l.trade_price}
                              onChange={(e) =>
                                setBkgLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, trade_price: Number(e.target.value || 0) }
                                      : row
                                  )
                                )
                              }
                              className="w-20 px-1.5 py-1 text-right font-mono border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={l.discount_percent}
                              onChange={(e) =>
                                setBkgLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, discount_percent: Number(e.target.value || 0) }
                                      : row
                                  )
                                )
                              }
                              className="w-14 px-1.5 py-1 text-center border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-right font-mono font-bold">
                            {net.toFixed(2)}
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setBkgLines((prev) => prev.filter((_, rIdx) => rIdx !== idx))
                              }
                              className="text-rose-600 hover:text-rose-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </form>

          {/* Bookings List */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <h3 className="font-bold text-sm text-slate-900">
                Order Bookings Register ({bookings.length})
              </h3>
              <button
                type="button"
                onClick={() => switchTab('supply-creation')}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5"
              >
                Convert Bookings to Town Supply <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Booking No</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Salesman</th>
                    <th className="p-2 text-left">Town / Area</th>
                    <th className="p-2 text-left">Party Name</th>
                    <th className="p-2 text-right">Booked Qty</th>
                    <th className="p-2 text-right">Supplied Qty</th>
                    <th className="p-2 text-right">Pending Qty</th>
                    <th className="p-2 text-right">Booking Amount</th>
                    <th className="p-2 text-center">Status</th>
                    <th className="p-2 text-center">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="p-2 font-mono font-bold">{b.booking_number}</td>
                      <td className="p-2">{b.booking_date}</td>
                      <td className="p-2">{b.salesman_name || '—'}</td>
                      <td className="p-2">
                        {b.town_name || '—'} {b.area_name ? `/ ${b.area_name}` : ''}
                      </td>
                      <td className="p-2 font-semibold">{b.party_name}</td>
                      <td className="p-2 text-right font-mono">{b.total_quantity}</td>
                      <td className="p-2 text-right font-mono text-emerald-700">
                        {b.supplied_quantity || 0}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-amber-700">
                        {b.pending_quantity ?? b.total_quantity}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(b.total_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">
                          {b.status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setPrintConfig({
                              isOpen: true,
                              docType: 'booking-slip',
                              title: `ORDER BOOKING SLIP - ${b.booking_number}`,
                              headerMeta: [
                                { label: 'Booking No', value: b.booking_number },
                                { label: 'Booking Date', value: b.booking_date },
                                { label: 'Party Name', value: b.party_name },
                                { label: 'Town', value: b.town_name || '—' },
                                { label: 'Salesman', value: b.salesman_name || '—' },
                                { label: 'Status', value: b.status },
                              ],
                              columns: [
                                { key: 's_no', label: 'S.No', align: 'center' },
                                { key: 'item_code', label: 'Code' },
                                { key: 'company_name', label: 'Company' },
                                { key: 'item_name', label: 'Item Name' },
                                { key: 'packing', label: 'Pack', align: 'center' },
                                { key: 'quantity', label: 'Qty', align: 'right' },
                                { key: 'bonus_quantity', label: 'Bonus', align: 'right' },
                                { key: 'trade_price', label: 'T.P', align: 'right' },
                                { key: 'discount_percent', label: 'Disc %', align: 'right' },
                                { key: 'amount', label: 'Amount', align: 'right' },
                              ],
                              rows: b.items as unknown as Array<Record<string, unknown>>,
                              totals: [
                                { label: 'Total Booked Qty', value: b.total_quantity },
                                { label: 'Booking Net Total', value: b.total_amount, highlight: true },
                              ],
                              footerNotes: b.remarks,
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
          5. TOWN-WISE SUPPLY CREATION (Combines multiple bookings per party, generates Common Supply Number)
         ==================================================================== */}
      {activeTab === 'supply-creation' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Town-Wise Supply Creation (Batch Multiple Parties & Pending Bookings)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Generates a common unique Supply Number for the Town and separate Party-Wise Supply Documents.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateTownSupply}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow"
              >
                Generate Town-Wise Supply Sheet
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Supply Date
                </label>
                <input
                  type="date"
                  value={supDate}
                  onChange={(e) => setSupDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Select Town *
                </label>
                <select
                  value={supTownId}
                  onChange={(e) => setSupTownId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border-2 border-emerald-500 rounded-lg font-bold"
                >
                  <option value="">Choose Town to Load Bookings...</option>
                  {towns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.town_name} ({t.total_parties} Parties)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Salesman
                </label>
                <select
                  value={supSalesmanId}
                  onChange={(e) => setSupSalesmanId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">All Town Salesmen</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">Area</label>
                <select
                  value={supAreaId}
                  onChange={(e) => setSupAreaId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">All Areas in Town</option>
                  {allAreas
                    .filter((a) => !supTownId || Number(a.town_id) === Number(supTownId))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.area_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Supply Remarks
                </label>
                <input
                  type="text"
                  value={supRemarks}
                  onChange={(e) => setSupRemarks(e.target.value)}
                  placeholder="Route / Vehicle notes..."
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Pending Bookings Grid for Selected Town */}
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="p-2 text-center">Inc</th>
                    <th className="p-2 text-left">Booking No</th>
                    <th className="p-2 text-left">Party Name</th>
                    <th className="p-2 text-left">Item Code</th>
                    <th className="p-2 text-left">Company</th>
                    <th className="p-2 text-left">Item Name</th>
                    <th className="p-2 text-center">Packing</th>
                    <th className="p-2 text-right">Stock</th>
                    <th className="p-2 text-right">Ordered Qty</th>
                    <th className="p-2 text-center">Supply Qty</th>
                    <th className="p-2 text-center">Bonus</th>
                    <th className="p-2 text-right">T.P</th>
                    <th className="p-2 text-right">Disc %</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selectedSupplyLines.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-6 text-center text-slate-500">
                        {supTownId
                          ? 'No pending bookings found for the selected Town.'
                          : 'Select a Town above to automatically load assigned parties & pending bookings.'}
                      </td>
                    </tr>
                  ) : (
                    selectedSupplyLines.map((l, idx) => {
                      const amt =
                        l.supply_quantity * l.trade_price * (1 - l.discount_percent / 100);
                      return (
                        <tr key={idx} className={l.selected ? 'bg-white' : 'bg-slate-100 opacity-60'}>
                          <td className="p-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={l.selected}
                              onChange={(e) =>
                                setSelectedSupplyLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, selected: e.target.checked } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="p-1.5 font-mono">{l.booking_number}</td>
                          <td className="p-1.5 font-bold">{l.party_name}</td>
                          <td className="p-1.5 font-mono">{l.item_code}</td>
                          <td className="p-1.5">{l.company_name}</td>
                          <td className="p-1.5 font-semibold">{l.item_name}</td>
                          <td className="p-1.5 text-center">{l.packing}</td>
                          <td className="p-1.5 text-right font-mono text-emerald-700">
                            {l.available_packs}
                          </td>
                          <td className="p-1.5 text-right font-mono">{l.ordered_quantity}</td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max={l.ordered_quantity}
                              value={l.supply_quantity}
                              onChange={(e) =>
                                setSelectedSupplyLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, supply_quantity: Number(e.target.value || 0) }
                                      : row
                                  )
                                )
                              }
                              className="w-16 px-1.5 py-1 text-center font-bold border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              value={l.bonus_quantity}
                              onChange={(e) =>
                                setSelectedSupplyLines((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, bonus_quantity: Number(e.target.value || 0) }
                                      : row
                                  )
                                )
                              }
                              className="w-14 px-1.5 py-1 text-center border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-right font-mono">
                            {l.trade_price.toFixed(2)}
                          </td>
                          <td className="p-1.5 text-right font-mono">{l.discount_percent}%</td>
                          <td className="p-1.5 text-right font-mono font-bold">
                            {amt.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Existing Town Supplies List */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Generated Town Supplies ({supplies.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Supply No</th>
                    <th className="p-2 text-left">Supply Date</th>
                    <th className="p-2 text-left">Town</th>
                    <th className="p-2 text-left">Salesman</th>
                    <th className="p-2 text-right">Parties</th>
                    <th className="p-2 text-right">Supply Qty</th>
                    <th className="p-2 text-right">Supply Amount</th>
                    <th className="p-2 text-center">Packing Status</th>
                    <th className="p-2 text-center">Lifecycle Status</th>
                    <th className="p-2 text-center">Print Challan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {supplies.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-2 font-mono font-bold">{s.supply_number}</td>
                      <td className="p-2">{s.supply_date}</td>
                      <td className="p-2 font-bold">{s.town_name}</td>
                      <td className="p-2">{s.salesman_name || '—'}</td>
                      <td className="p-2 text-right font-mono">{s.total_parties}</td>
                      <td className="p-2 text-right font-mono">{s.total_supply_qty}</td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(s.total_supply_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">
                          {s.packing_status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-bold">
                          {s.supply_status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setPrintConfig({
                              isOpen: true,
                              docType: 'supply-challan',
                              title: `TOWN SUPPLY CHALLAN - ${s.supply_number}`,
                              headerMeta: [
                                { label: 'Supply No', value: s.supply_number },
                                { label: 'Supply Date', value: s.supply_date },
                                { label: 'Town', value: s.town_name },
                                { label: 'Salesman', value: s.salesman_name || '—' },
                                { label: 'Total Parties', value: s.total_parties },
                                { label: 'Status', value: s.supply_status },
                              ],
                              columns: [
                                { key: 'party_name', label: 'Party Name' },
                                { key: 'item_code', label: 'Code' },
                                { key: 'company_name', label: 'Company' },
                                { key: 'item_name', label: 'Item Name' },
                                { key: 'packing', label: 'Pack', align: 'center' },
                                { key: 'ordered_quantity', label: 'Ord Qty', align: 'right' },
                                { key: 'supply_quantity', label: 'Sup Qty', align: 'right' },
                                { key: 'bonus_quantity', label: 'Bonus', align: 'right' },
                                { key: 'trade_price', label: 'T.P', align: 'right' },
                                { key: 'discount_percent', label: 'Disc %', align: 'right' },
                                { key: 'amount', label: 'Amount', align: 'right' },
                              ],
                              rows: s.items as unknown as Array<Record<string, unknown>>,
                              totals: [
                                { label: 'Total Supply Qty', value: s.total_supply_qty },
                                { label: 'Total Supply Amount', value: s.total_supply_amount, highlight: true },
                              ],
                              footerNotes: s.remarks,
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
          6. PACKING MANAGEMENT (Reserves stock without duplicate deduction)
         ==================================================================== */}
      {activeTab === 'supply-packing' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Packing Management & Stock Reservation
                </h3>
                <p className="text-[11px] text-slate-500">
                  Validates available stock, reserves packed quantities, and marks supplies Ready for Dispatch.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSupplyObj?.id || ''}
                  onChange={(e) => setSelectedSupplyId(Number(e.target.value))}
                  className="px-3 py-1.5 text-xs border-2 border-slate-800 rounded-lg font-bold"
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supply_number} — {s.town_name} ({s.packing_status} / {s.supply_status})
                    </option>
                  ))}
                </select>
                {selectedSupplyObj && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPrintConfig({
                          isOpen: true,
                          docType: 'packing-list',
                          title: `PACKING LIST - ${selectedSupplyObj.supply_number}`,
                          headerMeta: [
                            { label: 'Supply No', value: selectedSupplyObj.supply_number },
                            { label: 'Town', value: selectedSupplyObj.town_name },
                            { label: 'Salesman', value: selectedSupplyObj.salesman_name || '—' },
                            { label: 'Packing Status', value: selectedSupplyObj.packing_status },
                          ],
                          columns: [
                            { key: 'party_name', label: 'Party Name' },
                            { key: 'item_name', label: 'Item Name' },
                            { key: 'packing', label: 'Packing', align: 'center' },
                            { key: 'supply_quantity', label: 'Required Qty', align: 'right' },
                            { key: 'packed_quantity', label: 'Packed Qty', align: 'right' },
                            { key: 'remaining_pack_quantity', label: 'Remaining', align: 'right' },
                            { key: 'packing_status', label: 'Status', align: 'center' },
                          ],
                          rows: selectedSupplyObj.items as unknown as Array<Record<string, unknown>>,
                          totals: [
                            { label: 'Total Required Qty', value: selectedSupplyObj.total_supply_qty },
                          ],
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print Packing List
                    </button>
                    {selectedSupplyObj.stock_deducted === 0 && (
                      <button
                        type="button"
                        onClick={() => handlePackSupply(selectedSupplyObj.id, true)}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Entire Town Supply Packed
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {selectedSupplyObj ? (
              <div className="space-y-3">
                {selectedSupplyObj.party_supplies.map((ps) => (
                  <div key={ps.id} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-slate-100 px-3 py-2 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900">
                          Party: {ps.party_name} ({ps.party_supply_number})
                        </span>
                        <span className="ml-3 text-slate-600">
                          Status: <strong>{ps.packing_status}</strong>
                        </span>
                      </div>
                      {selectedSupplyObj.stock_deducted === 0 && ps.packing_status !== 'Packed' && (
                        <button
                          type="button"
                          onClick={() => handlePackSupply(selectedSupplyObj.id, false, ps.id)}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold"
                        >
                          Mark Party Order Packed
                        </button>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase">
                        <tr>
                          <th className="p-2 text-left">Item Name</th>
                          <th className="p-2 text-center">Packing</th>
                          <th className="p-2 text-right">Available Stock</th>
                          <th className="p-2 text-right">Required Qty</th>
                          <th className="p-2 text-right">Packed Qty</th>
                          <th className="p-2 text-right">Remaining Qty</th>
                          <th className="p-2 text-center">Packing Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {ps.items.map((it) => (
                          <tr key={it.id}>
                            <td className="p-2 font-semibold">{it.item_name}</td>
                            <td className="p-2 text-center">{it.packing}</td>
                            <td className="p-2 text-right font-mono text-emerald-700">
                              {it.available_packs}
                            </td>
                            <td className="p-2 text-right font-mono font-bold">
                              {it.supply_quantity}
                            </td>
                            <td className="p-2 text-right font-mono text-emerald-700 font-bold">
                              {it.packed_quantity}
                            </td>
                            <td className="p-2 text-right font-mono text-amber-700">
                              {it.remaining_pack_quantity}
                            </td>
                            <td className="p-2 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  it.packing_status === 'Packed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {it.packing_status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                No Town Supplies created yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          7. DISPATCH / SUPPLY DELIVERY (Deducts Stock ONCE)
         ==================================================================== */}
      {activeTab === 'supply-dispatch' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2">
              Dispatch Packed Supply & Print Dispatch Challan (Single Stock Deduction)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Select Supply Number to Dispatch
                </label>
                <select
                  value={selectedSupplyObj?.id || ''}
                  onChange={(e) => setSelectedSupplyId(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs border-2 border-slate-800 rounded-lg font-bold"
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supply_number} — {s.town_name} ({s.supply_status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Vehicle / Van Number
                </label>
                <input
                  type="text"
                  value={dspVehicle}
                  onChange={(e) => setDspVehicle(e.target.value)}
                  placeholder="e.g. LEB-2026 / Carry Van"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Delivery Person
                </label>
                <input
                  type="text"
                  value={dspDriver}
                  onChange={(e) => setDspDriver(e.target.value)}
                  placeholder="Driver / Salesman name"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                {selectedSupplyObj && selectedSupplyObj.stock_deducted === 0 ? (
                  <button
                    type="button"
                    onClick={() => handleDispatchSupply(selectedSupplyObj.id)}
                    className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow"
                  >
                    Dispatch Supply & Deduct Stock
                  </button>
                ) : (
                  <div className="py-1.5 px-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold text-center">
                    Already Dispatched
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Dispatch Challan Register ({dispatches.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Dispatch No</th>
                    <th className="p-2 text-left">Supply No</th>
                    <th className="p-2 text-left">Dispatch Date</th>
                    <th className="p-2 text-left">Town</th>
                    <th className="p-2 text-left">Salesman / Delivery</th>
                    <th className="p-2 text-left">Vehicle</th>
                    <th className="p-2 text-right">Parties</th>
                    <th className="p-2 text-right">Total Qty</th>
                    <th className="p-2 text-right">Total Amount</th>
                    <th className="p-2 text-center">Status</th>
                    <th className="p-2 text-center">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {dispatches.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="p-2 font-mono font-bold">{d.dispatch_number}</td>
                      <td className="p-2 font-mono">{d.supply_number}</td>
                      <td className="p-2">{d.dispatch_date}</td>
                      <td className="p-2 font-bold">{d.town_name}</td>
                      <td className="p-2">{d.delivery_person || d.salesman_name}</td>
                      <td className="p-2">{d.vehicle_number || '—'}</td>
                      <td className="p-2 text-right font-mono">{d.total_parties}</td>
                      <td className="p-2 text-right font-mono">{d.total_quantity}</td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(d.total_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          {d.delivery_status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setPrintConfig({
                              isOpen: true,
                              docType: 'dispatch-challan',
                              title: `DISPATCH CHALLAN - ${d.dispatch_number}`,
                              headerMeta: [
                                { label: 'Dispatch No', value: d.dispatch_number },
                                { label: 'Supply No', value: d.supply_number },
                                { label: 'Dispatch Date', value: d.dispatch_date },
                                { label: 'Town', value: d.town_name },
                                { label: 'Salesman', value: d.salesman_name || '—' },
                                { label: 'Vehicle', value: d.vehicle_number || '—' },
                              ],
                              columns: [
                                { key: 'party_name', label: 'Party Name' },
                                { key: 'item_code', label: 'Code' },
                                { key: 'item_name', label: 'Item Name' },
                                { key: 'batch_number', label: 'Batch' },
                                { key: 'dispatched_qty', label: 'Dispatched Qty', align: 'right' },
                                { key: 'bonus_qty', label: 'Bonus', align: 'right' },
                                { key: 'amount', label: 'Amount', align: 'right' },
                              ],
                              rows: (d as any).items || [],
                              totals: [
                                { label: 'Total Quantity', value: d.total_quantity },
                                { label: 'Total Dispatch Amount', value: d.total_amount, highlight: true },
                              ],
                              footerNotes: d.remarks,
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
          8. SALES RETURN FROM SALESMAN (Restores Saleable Stock, Isolates Damaged Stock)
         ==================================================================== */}
      {activeTab === 'supply-returns' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Salesman Return Entry (Against Original Supply Number)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Restores Accepted (Saleable) returns back to Inventory and tracks Damaged stock separately.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSupplyObj?.id || ''}
                  onChange={(e) => {
                    setSelectedSupplyId(Number(e.target.value));
                    setReturnInputs({});
                  }}
                  className="px-3 py-1.5 text-xs border-2 border-slate-800 rounded-lg font-bold"
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supply_number} — {s.town_name} ({s.supply_status})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRecordSalesmanReturn}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow"
                >
                  Save Salesman Return & Restore Stock
                </button>
              </div>
            </div>

            {selectedSupplyObj && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      <th className="p-2 text-left">Party Name</th>
                      <th className="p-2 text-left">Item Name</th>
                      <th className="p-2 text-right">Supplied Qty</th>
                      <th className="p-2 text-right">Prev Returned</th>
                      <th className="p-2 text-right">Billed Qty</th>
                      <th className="p-2 text-right">Remaining</th>
                      <th className="p-2 text-center">New Return Qty</th>
                      <th className="p-2 text-center">Accepted (Saleable)</th>
                      <th className="p-2 text-center">Damaged Qty</th>
                      <th className="p-2 text-left">Return Reason</th>
                      <th className="p-2 text-right">Return Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedSupplyObj.items.map((it) => {
                      const rem = Math.max(
                        0,
                        Number(it.supply_quantity || 0) -
                          Number(it.returned_quantity || 0) -
                          Number(it.billed_quantity || 0)
                      );
                      const inp = returnInputs[it.id] || {
                        new_return_quantity: 0,
                        accepted_quantity: 0,
                        damaged_quantity: 0,
                        return_reason: '',
                      };
                      const netRate = it.trade_price * (1 - it.discount_percent / 100);
                      const retAmt = inp.new_return_quantity * netRate;

                      return (
                        <tr key={it.id}>
                          <td className="p-1.5 font-bold">{it.party_name}</td>
                          <td className="p-1.5 font-semibold">{it.item_name}</td>
                          <td className="p-1.5 text-right font-mono">{it.supply_quantity}</td>
                          <td className="p-1.5 text-right font-mono text-rose-700">
                            {it.returned_quantity}
                          </td>
                          <td className="p-1.5 text-right font-mono text-emerald-700">
                            {it.billed_quantity}
                          </td>
                          <td className="p-1.5 text-right font-mono font-bold">{rem}</td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max={rem}
                              value={inp.new_return_quantity || ''}
                              onChange={(e) => {
                                const newQ = Math.min(rem, Math.max(0, Number(e.target.value || 0)));
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    new_return_quantity: newQ,
                                    accepted_quantity: newQ,
                                    damaged_quantity: 0,
                                    return_reason: prev[it.id]?.return_reason || 'Unsold Return',
                                  },
                                }));
                              }}
                              placeholder="0"
                              className="w-16 px-1.5 py-1 text-center font-bold border border-slate-300 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max={inp.new_return_quantity}
                              value={inp.accepted_quantity || ''}
                              onChange={(e) => {
                                const acc = Math.min(
                                  inp.new_return_quantity,
                                  Math.max(0, Number(e.target.value || 0))
                                );
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    ...inp,
                                    accepted_quantity: acc,
                                    damaged_quantity: Math.max(0, inp.new_return_quantity - acc),
                                  },
                                }));
                              }}
                              className="w-16 px-1.5 py-1 text-center border border-emerald-400 rounded font-semibold text-emerald-800"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="number"
                              min="0"
                              max={inp.new_return_quantity}
                              value={inp.damaged_quantity || ''}
                              onChange={(e) => {
                                const dmg = Math.min(
                                  inp.new_return_quantity,
                                  Math.max(0, Number(e.target.value || 0))
                                );
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    ...inp,
                                    damaged_quantity: dmg,
                                    accepted_quantity: Math.max(0, inp.new_return_quantity - dmg),
                                  },
                                }));
                              }}
                              className="w-16 px-1.5 py-1 text-center border border-rose-300 rounded text-rose-700"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={inp.return_reason}
                              onChange={(e) =>
                                setReturnInputs((prev) => ({
                                  ...prev,
                                  [it.id]: { ...inp, return_reason: e.target.value },
                                }))
                              }
                              placeholder="Reason..."
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                            />
                          </td>
                          <td className="p-1.5 text-right font-mono font-bold text-rose-700">
                            {retAmt.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Salesman Return Vouchers Register */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2 mb-3">
              Salesman Return Vouchers ({returnsList.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-100 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 text-left">Return No</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Supply No</th>
                    <th className="p-2 text-left">Town / Salesman</th>
                    <th className="p-2 text-right">Returned Qty</th>
                    <th className="p-2 text-right">Saleable Restored</th>
                    <th className="p-2 text-right">Damaged Qty</th>
                    <th className="p-2 text-right">Return Amount</th>
                    <th className="p-2 text-center">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {returnsList.map((r) => (
                    <tr key={r.id}>
                      <td className="p-2 font-mono font-bold">{r.return_number}</td>
                      <td className="p-2">{r.return_date}</td>
                      <td className="p-2 font-mono">{r.supply_number}</td>
                      <td className="p-2">
                        {r.town_name} / {r.salesman_name}
                      </td>
                      <td className="p-2 text-right font-mono">{r.total_returned_qty}</td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {r.total_accepted_qty}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-rose-700">
                        {r.total_damaged_qty}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">
                        {Number(r.total_return_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setPrintConfig({
                              isOpen: true,
                              docType: 'return-voucher',
                              title: `SALESMAN RETURN VOUCHER - ${r.return_number}`,
                              headerMeta: [
                                { label: 'Return No', value: r.return_number },
                                { label: 'Return Date', value: r.return_date },
                                { label: 'Supply No', value: r.supply_number },
                                { label: 'Town', value: r.town_name },
                                { label: 'Salesman', value: r.salesman_name || '—' },
                              ],
                              columns: [
                                { key: 'party_name', label: 'Party' },
                                { key: 'item_name', label: 'Item Name' },
                                { key: 'supplied_quantity', label: 'Supplied', align: 'right' },
                                { key: 'new_return_quantity', label: 'Returned', align: 'right' },
                                { key: 'accepted_quantity', label: 'Saleable', align: 'right' },
                                { key: 'damaged_quantity', label: 'Damaged', align: 'right' },
                                { key: 'return_amount', label: 'Return Amt', align: 'right' },
                                { key: 'return_reason', label: 'Reason' },
                              ],
                              rows: r.items as unknown as Array<Record<string, unknown>>,
                              totals: [
                                { label: 'Total Returned Qty', value: r.total_returned_qty },
                                { label: 'Total Return Amount', value: r.total_return_amount, highlight: true },
                              ],
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
          9. FINAL BILLING / INVOICE COMPLETION (Original Supply - Return = Final Net Bill)
         ==================================================================== */}
      {activeTab === 'supply-billing' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Final Billing / Invoice Completion (Original Supply Amount − Return Amount = Final Net Bill)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Generates official Party Sales Invoices and posts to Accounts Receivable & Sales Revenue without deducting stock a second time.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSupplyObj?.id || ''}
                  onChange={(e) => setSelectedSupplyId(Number(e.target.value))}
                  className="px-3 py-1.5 text-xs border-2 border-slate-800 rounded-lg font-bold"
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supply_number} — {s.town_name} ({s.supply_status})
                    </option>
                  ))}
                </select>
                {selectedSupplyObj && (
                  <button
                    type="button"
                    onClick={() => handleFinalizeBilling(selectedSupplyObj.id)}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow"
                  >
                    Generate Final Invoices for All Parties in Supply
                  </button>
                )}
              </div>
            </div>

            {selectedSupplyObj && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500">Original Supply Amount:</span>
                    <div className="font-black text-slate-900 text-sm">
                      Rs. {Number(selectedSupplyObj.total_supply_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Accepted Return Amount:</span>
                    <div className="font-black text-rose-700 text-sm">
                      Rs. {Number(selectedSupplyObj.total_return_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Final Net Billable:</span>
                    <div className="font-black text-emerald-700 text-sm">
                      Rs. {Number(selectedSupplyObj.net_billable_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Total Billed So Far:</span>
                    <div className="font-black text-slate-900 text-sm">
                      Rs. {Number(selectedSupplyObj.total_billed_amount || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Lifecycle Status:</span>
                    <div className="font-black text-indigo-700 text-sm">
                      {selectedSupplyObj.supply_status}
                    </div>
                  </div>
                </div>

                {/* Party-wise Final Billing Cards */}
                {selectedSupplyObj.party_supplies.map((ps) => {
                  const unbilledAmt = Math.max(
                    0,
                    Number(ps.net_billable_amount || 0) - Number(ps.billed_amount || 0)
                  );
                  return (
                    <div
                      key={ps.id}
                      className="border border-slate-200 rounded-lg overflow-hidden bg-white"
                    >
                      <div className="bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-900">
                            Party: {ps.party_name} ({ps.party_supply_number})
                          </span>
                          {ps.final_invoice_number && (
                            <span className="ml-3 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-bold">
                              Invoice: {ps.final_invoice_number}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span>Supply: Rs. {Number(ps.supply_amount || 0).toLocaleString()}</span>
                          <span className="text-rose-700">
                            Return: Rs. {Number(ps.return_amount || 0).toLocaleString()}
                          </span>
                          <span className="font-bold text-emerald-700">
                            Final Net Bill: Rs. {Number(ps.net_billable_amount || 0).toLocaleString()}
                          </span>
                          {unbilledAmt > 0.01 && (
                            <button
                              type="button"
                              onClick={() => handleFinalizeBilling(selectedSupplyObj.id, ps.id)}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white font-sans font-bold text-[11px]"
                            >
                              Generate Party Final Bill
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPrintConfig({
                                isOpen: true,
                                docType: 'final-invoice',
                                title: `FINAL SALES INVOICE - ${
                                  ps.final_invoice_number || ps.party_supply_number
                                }`,
                                headerMeta: [
                                  {
                                    label: 'Invoice No',
                                    value: ps.final_invoice_number || 'PENDING',
                                  },
                                  { label: 'Supply No', value: selectedSupplyObj.supply_number },
                                  { label: 'Party Name', value: ps.party_name },
                                  { label: 'Town', value: ps.town_name },
                                  { label: 'Salesman', value: ps.salesman_name || '—' },
                                  { label: 'Date', value: ps.supply_date },
                                ],
                                columns: [
                                  { key: 's_no', label: 'S.No', align: 'center' },
                                  { key: 'item_name', label: 'Item Name' },
                                  { key: 'packing', label: 'Pack', align: 'center' },
                                  { key: 'supply_quantity', label: 'Supplied', align: 'right' },
                                  { key: 'returned_quantity', label: 'Returned', align: 'right' },
                                  { key: 'net_billable_qty', label: 'Net Billed Qty', align: 'right' },
                                  { key: 'trade_price', label: 'Rate', align: 'right' },
                                  { key: 'discount_percent', label: 'Disc %', align: 'right' },
                                  { key: 'net_billable_amount', label: 'Net Amount', align: 'right' },
                                ],
                                rows: ps.items as unknown as Array<Record<string, unknown>>,
                                totals: [
                                  { label: 'Original Supply', value: ps.supply_amount },
                                  { label: 'Less Return', value: ps.return_amount },
                                  {
                                    label: 'Final Net Bill',
                                    value: ps.net_billable_amount,
                                    highlight: true,
                                  },
                                ],
                              })
                            }
                            className="p-1 rounded bg-white border border-slate-300 text-slate-700"
                            title="Print Final Sales Invoice"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'supply-import-bookings' && (
        <ImportSalesmanBookingsPanel onImportCompleted={loadCoreData} />
      )}

      {/* ====================================================================
          10, 11, 12. RECOVERY, SETTLEMENT & 38 DISTRIBUTION REPORTS
         ==================================================================== */}
      {(activeTab === 'supply-recovery' ||
        activeTab === 'supply-settlement' ||
        activeTab === 'supply-reports') && (
        <SupplyReportsAndRecoverySection
          activeSection={activeTab}
          salesmen={salesmen}
          towns={towns}
          supplies={supplies}
          onRefreshCore={loadCoreData}
          onOpenPrint={(cfg) =>
            setPrintConfig({
              isOpen: true,
              ...cfg,
            })
          }
        />
      )}

      {/* Universal Print & PDF Preview Modal */}
      <SupplyPrintModal
        isOpen={printConfig.isOpen}
        onClose={() => setPrintConfig((prev) => ({ ...prev, isOpen: false }))}
        docType={printConfig.docType}
        title={printConfig.title}
        subtitle={printConfig.subtitle}
        headerMeta={printConfig.headerMeta}
        orderFormItems={printConfig.orderFormItems}
        initialOrderLayout={printConfig.initialOrderLayout}
        columns={printConfig.columns}
        rows={printConfig.rows}
        totals={printConfig.totals}
        footerNotes={printConfig.footerNotes}
      />
    </div>
  );
};
