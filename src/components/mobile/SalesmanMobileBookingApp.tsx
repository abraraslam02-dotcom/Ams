import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  LogOut,
  RefreshCw,
  Plus,
  Trash2,
  Send,
  Download,
  CheckCircle2,
  AlertCircle,
  Search,
  MapPin,
  Users,
  Package,
  FileText,
  Sparkles,
  Percent,
  Gift,
  Lock,
  UserCheck,
  ArrowLeft,
  Clock,
  CheckCheck,
  ShieldCheck,
} from 'lucide-react';

interface MobileSalesman {
  id: number;
  salesman_code: string;
  name: string;
  username: string;
  mobile: string;
  assigned_towns: string[];
  assigned_areas: string[];
  assigned_parties: number[];
}

interface CatalogTown {
  id: number;
  town_code: string;
  town_name: string;
  areas: Array<{ id: number; area_name: string; town_id: number; town_name: string }>;
}

interface CatalogParty {
  id: number;
  account_code: string;
  account_name: string;
  town: string;
  area: string;
  phone: string;
  current_balance: number;
  balance_type: string;
  credit_limit: number;
}

interface CatalogItem {
  id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  category_name: string;
  packing: string;
  trade_price: number;
  retail_price: number;
  available_packs: number;
}

interface CatalogOffer {
  id: number;
  offer_code: string;
  offer_name: string;
  offer_type: 'percentage_discount' | 'bonus_quantity' | 'fixed_discount' | 'slab_offer';
  scope_type: 'all_items' | 'selected_items' | 'company';
  company_name: string;
  item_id: number | null;
  item_code: string;
  town_name: string;
  party_account_id: number | null;
  salesman_id: number | null;
  min_quantity: number;
  max_quantity: number;
  discount_percent: number;
  fixed_discount_amount: number;
  bonus_quantity: number;
  slabs_json: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface CatalogPartyDiscount {
  id: number;
  discount_code: string;
  party_account_id: number;
  party_name: string;
  scope_type: 'item' | 'company' | 'all_items';
  company_name: string;
  item_id: number | null;
  item_code: string;
  discount_percent: number;
  fixed_discount_amount: number;
  start_date: string;
  end_date: string;
  status: string;
}

export interface MobileBookingLine {
  sno: number;
  item_id: number;
  item_code: string;
  item_name: string;
  company_name: string;
  packing: string;
  trade_price: number;
  quantity: number;
  bonus_quantity: number;
  offer_discount_percent: number;
  party_discount_percent: number;
  discount_percent: number;
  discount_amount: number;
  net_amount: number;
  applied_offer_name: string;
  remarks: string;
}

export type MobileBookingStatus =
  | 'Saved on Mobile'
  | 'Pending Upload'
  | 'Submitted'
  | 'Received'
  | 'Imported'
  | 'Supply Generated';

export interface MobileBookingRecord {
  booking_number: string;
  booking_date: string;
  salesman_id: number;
  salesman_code: string;
  salesman_name: string;
  town_name: string;
  area_name: string;
  party_account_id: number;
  party_code: string;
  party_name: string;
  payment_type: 'Credit' | 'Cash';
  remarks: string;
  status: MobileBookingStatus;
  created_at: string;
  submitted_at?: string;
  items: MobileBookingLine[];
  total_items: number;
  total_quantity: number;
  total_bonus: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
}

const SESSION_STORAGE_KEY = 'ams_mobile_salesman_session_v1';
const CATALOG_CACHE_KEY = 'ams_mobile_catalog_cache_v1';
const BOOKINGS_STORAGE_KEY = 'ams_mobile_bookings_queue_v1';

function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function generateMobileBookingNumber(salesmanCode: string, existingCount: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cleanCode = (salesmanCode || 'SM').replace(/[^A-Z0-9]/gi, '').slice(-4).toUpperCase();
  const seq = String(existingCount + 1).padStart(3, '0');
  return `MBK-${cleanCode}-${datePart}-${seq}`;
}

export const SalesmanMobileBookingApp: React.FC<{
  onExitMobileMode?: () => void;
}> = ({ onExitMobileMode }) => {
  const [salesman, setSalesman] = useState<MobileSalesman | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Online / Offline & Catalog state
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');
  const [towns, setTowns] = useState<CatalogTown[]>([]);
  const [parties, setParties] = useState<CatalogParty[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [partyDiscounts, setPartyDiscounts] = useState<CatalogPartyDiscount[]>([]);
  const [stackingRule, setStackingRule] = useState<'higher_only' | 'combine_both'>('higher_only');

  // Saved bookings on mobile
  const [bookings, setBookings] = useState<MobileBookingRecord[]>(() => {
    try {
      const raw = localStorage.getItem(BOOKINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Active tab in Mobile App: 'new-booking' | 'saved-bookings' | 'offers-catalog'
  const [mobileTab, setMobileTab] = useState<'new-booking' | 'saved-bookings' | 'offers-catalog'>('new-booking');

  // Booking Header state
  const [bookingDate, setBookingDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bookingNumber, setBookingNumber] = useState<string>('');
  const [selectedTown, setSelectedTown] = useState<string>('');
  const [selectedArea, setSelectedArea] = useState<string>('');
  const [selectedPartyId, setSelectedPartyId] = useState<number>(0);
  const [paymentType, setPaymentType] = useState<'Credit' | 'Cash'>('Credit');
  const [bookingRemarks, setBookingRemarks] = useState<string>('');
  const [lines, setLines] = useState<MobileBookingLine[]>([]);

  // Fast item entry bar
  const [itemSearch, setItemSearch] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [entryQty, setEntryQty] = useState<string>('1');
  const [entryRemarks, setEntryRemarks] = useState<string>('');

  // Status banner
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [sendingToAdmin, setSendingToAdmin] = useState(false);

  // Monitor browser online/offline state
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist bookings queue in localStorage for offline support
  useEffect(() => {
    try {
      localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(bookings));
    } catch {
      // ignore storage quota errors
    }
  }, [bookings]);

  // Load cached catalog on startup
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CATALOG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        setTowns(parsed.towns || []);
        setParties(parsed.parties || []);
        setItems(parsed.items || []);
        setOffers(parsed.offers || []);
        setPartyDiscounts(parsed.partyDiscounts || []);
        setStackingRule(parsed.stackingRule || 'higher_only');
        setLastSyncedAt(parsed.syncedAt || '');
      }
    } catch {
      // ignore
    }
  }, []);

  const syncCatalog = useCallback(async (salesmanId: number) => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/enhancements/mobile/catalog/${salesmanId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to sync salesman catalog');
      }
      const nowStr = new Date().toLocaleString();
      setTowns(data.towns || []);
      setParties(data.parties || []);
      setItems(data.items || []);
      setOffers(data.offers || []);
      setPartyDiscounts(data.party_discounts || []);
      setStackingRule(data.discount_stacking_rule || 'higher_only');
      setLastSyncedAt(nowStr);

      // Update salesman profile from server
      if (data.salesman) {
        setSalesman((prev) => {
          const updated = {
            ...(prev || {}),
            ...data.salesman,
          };
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      }

      localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify({
          towns: data.towns || [],
          parties: data.parties || [],
          items: data.items || [],
          offers: data.offers || [],
          partyDiscounts: data.party_discounts || [],
          stackingRule: data.discount_stacking_rule || 'higher_only',
          syncedAt: nowStr,
        })
      );
    } catch (err: unknown) {
      setBanner({
        type: 'info',
        message: `Working in Offline Mode using cached catalog. (${err instanceof Error ? err.message : 'Offline'})`,
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (salesman?.id) {
      syncCatalog(salesman.id);
    }
  }, [salesman?.id, syncCatalog]);

  // Initialize booking number when salesman or bookings change
  useEffect(() => {
    if (salesman && !bookingNumber) {
      setBookingNumber(generateMobileBookingNumber(salesman.salesman_code, bookings.length));
    }
  }, [salesman, bookings.length, bookingNumber]);

  // Local client-side Offer & Party Discount evaluation (works 100% offline!)
  const evaluateOfflineLineOfferAndDiscount = useCallback(
    (item: CatalogItem, qty: number, partyId: number, townName: string) => {
      const today = bookingDate || new Date().toISOString().slice(0, 10);
      const tradePrice = round2(item.trade_price || 0);
      const gross = round2(qty * tradePrice);

      // 1. Evaluate active trade offers
      let bestOfferDiscPct = 0;
      let bestOfferFixed = 0;
      let bestBonusQty = 0;
      let bestOfferName = '';

      for (const off of offers) {
        if (off.status === 'Disabled') continue;
        if (off.start_date && off.start_date > today) continue;
        if (off.end_date && off.end_date < today) continue;

        // Scope check
        if (off.scope_type === 'selected_items' && Number(off.item_id) !== item.id && off.item_code !== item.item_code) {
          continue;
        }
        if (
          off.scope_type === 'company' &&
          String(off.company_name || '').toLowerCase() !== String(item.company_name || '').toLowerCase()
        ) {
          continue;
        }
        if (off.town_name && townName && off.town_name.toLowerCase() !== townName.toLowerCase()) continue;
        if (off.party_account_id && partyId && Number(off.party_account_id) !== partyId) continue;

        let discPct = 0;
        let fixedAmt = 0;
        let bonus = 0;

        if (off.offer_type === 'slab_offer') {
          try {
            const slabs = JSON.parse(off.slabs_json || '[]') as Array<{
              min_qty: number;
              max_qty?: number;
              discount_percent?: number;
              bonus_qty?: number;
              fixed_discount?: number;
            }>;
            const matchedSlab = slabs
              .filter((s) => qty >= Number(s.min_qty || 1) && (!s.max_qty || qty <= Number(s.max_qty)))
              .sort((a, b) => Number(b.min_qty || 0) - Number(a.min_qty || 0))[0];
            if (matchedSlab) {
              discPct = Number(matchedSlab.discount_percent || 0);
              bonus = Number(matchedSlab.bonus_qty || 0);
              fixedAmt = Number(matchedSlab.fixed_discount || 0);
            } else {
              continue;
            }
          } catch {
            continue;
          }
        } else {
          const minQty = Number(off.min_quantity || 1);
          if (qty < minQty) continue;
          if (off.offer_type === 'percentage_discount') {
            discPct = Number(off.discount_percent || 0);
          } else if (off.offer_type === 'bonus_quantity') {
            const multiplier = Math.floor(qty / Math.max(1, minQty));
            bonus = multiplier * Number(off.bonus_quantity || 0);
          } else if (off.offer_type === 'fixed_discount') {
            fixedAmt = Number(off.fixed_discount_amount || 0);
          }
        }

        const candidateBenefit = round2((gross * discPct) / 100 + fixedAmt + bonus * tradePrice);
        const currentBestBenefit = round2(
          (gross * bestOfferDiscPct) / 100 + bestOfferFixed + bestBonusQty * tradePrice
        );
        if (candidateBenefit > currentBestBenefit) {
          bestOfferDiscPct = discPct;
          bestOfferFixed = fixedAmt;
          bestBonusQty = bonus;
          bestOfferName = off.offer_name;
        }
      }

      // 2. Evaluate Party-Wise Special Discount
      let partyDiscPct = 0;
      let partyFixedAmt = 0;
      if (partyId) {
        const matchingPartyRules = partyDiscounts.filter((pd) => {
          if (Number(pd.party_account_id) !== partyId) return false;
          if (pd.status !== 'Active') return false;
          if (pd.start_date && pd.start_date > today) return false;
          if (pd.end_date && pd.end_date < today) return false;
          if (pd.scope_type === 'item') return Number(pd.item_id) === item.id || pd.item_code === item.item_code;
          if (pd.scope_type === 'company') {
            return String(pd.company_name || '').toLowerCase() === String(item.company_name || '').toLowerCase();
          }
          return pd.scope_type === 'all_items';
        });

        // Prioritize item > company > all_items
        const sortedRules = matchingPartyRules.sort((a, b) => {
          const rank = (s: string) => (s === 'item' ? 3 : s === 'company' ? 2 : 1);
          return rank(b.scope_type) - rank(a.scope_type);
        });
        if (sortedRules[0]) {
          partyDiscPct = Number(sortedRules[0].discount_percent || 0);
          partyFixedAmt = Number(sortedRules[0].fixed_discount_amount || 0);
        }
      }

      // 3. Apply stacking rule
      const offerAmt = round2((gross * bestOfferDiscPct) / 100 + bestOfferFixed);
      const partyAmt = round2((gross * partyDiscPct) / 100 + partyFixedAmt);

      let effectiveDiscPct = 0;
      let totalDiscAmt = 0;
      if (stackingRule === 'combine_both') {
        totalDiscAmt = round2(Math.min(gross, offerAmt + partyAmt));
        effectiveDiscPct = gross > 0 ? round2((totalDiscAmt / gross) * 100) : 0;
      } else {
        if (partyAmt > offerAmt) {
          totalDiscAmt = partyAmt;
          effectiveDiscPct = partyDiscPct;
        } else {
          totalDiscAmt = offerAmt;
          effectiveDiscPct = bestOfferDiscPct;
        }
      }

      const netAmt = round2(Math.max(0, gross - totalDiscAmt));
      return {
        bonus_quantity: bestBonusQty,
        offer_discount_percent: bestOfferDiscPct,
        party_discount_percent: partyDiscPct,
        discount_percent: effectiveDiscPct,
        discount_amount: totalDiscAmt,
        net_amount: netAmt,
        applied_offer_name: bestOfferName,
      };
    },
    [bookingDate, offers, partyDiscounts, stackingRule]
  );

  // Recalculate existing lines if Party or Town changes
  useEffect(() => {
    if (lines.length === 0) return;
    setLines((prev) =>
      prev.map((ln, idx) => {
        const catalogItem = items.find((i) => i.id === ln.item_id);
        if (!catalogItem) return { ...ln, sno: idx + 1 };
        const calc = evaluateOfflineLineOfferAndDiscount(
          catalogItem,
          ln.quantity,
          selectedPartyId,
          selectedTown
        );
        return {
          ...ln,
          sno: idx + 1,
          ...calc,
        };
      })
    );
  }, [selectedPartyId, selectedTown, items, evaluateOfflineLineOfferAndDiscount]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!username.trim() || !password) {
      setLoginError('Please enter your Salesman Username/Code and Password.');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch('/api/enhancements/mobile/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid salesman credentials');
      }
      const sm: MobileSalesman = data.salesman;
      setSalesman(sm);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sm));
      setBookingNumber(generateMobileBookingNumber(sm.salesman_code, bookings.length));
      await syncCatalog(sm.id);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setSalesman(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setUsername('');
    setPassword('');
  };

  // Filtered areas for selected town
  const availableAreas = useMemo(() => {
    if (!selectedTown) return [];
    const townObj = towns.find(
      (t) => t.town_name.toLowerCase() === selectedTown.toLowerCase()
    );
    return townObj?.areas || [];
  }, [towns, selectedTown]);

  // Filtered parties for selected town/area
  const availableParties = useMemo(() => {
    return parties.filter((p) => {
      if (selectedTown && p.town && p.town.toLowerCase() !== selectedTown.toLowerCase()) {
        return false;
      }
      if (selectedArea && p.area && p.area.toLowerCase() !== selectedArea.toLowerCase()) {
        return false;
      }
      return true;
    });
  }, [parties, selectedTown, selectedArea]);

  // Filtered items for search
  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 20);
    return items
      .filter(
        (it) =>
          String(it.item_name || '').toLowerCase().includes(q) ||
          String(it.item_code || '').toLowerCase().includes(q) ||
          String(it.company_name || '').toLowerCase().includes(q)
      )
      .slice(0, 25);
  }, [items, itemSearch]);

  const handleAddItemLine = () => {
    if (!selectedItem) {
      setBanner({ type: 'error', message: 'Please select an item from the search list first.' });
      return;
    }
    const qty = round2(Number(entryQty || 0));
    if (qty <= 0) {
      setBanner({ type: 'error', message: 'Quantity must be greater than 0.' });
      return;
    }

    const calc = evaluateOfflineLineOfferAndDiscount(
      selectedItem,
      qty,
      selectedPartyId,
      selectedTown
    );

    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.item_id === selectedItem.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        const newQty = round2(updated[existingIdx].quantity + qty);
        const reCalc = evaluateOfflineLineOfferAndDiscount(
          selectedItem,
          newQty,
          selectedPartyId,
          selectedTown
        );
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: newQty,
          ...reCalc,
          remarks: entryRemarks.trim() || updated[existingIdx].remarks,
        };
        return updated;
      }
      return [
        ...prev,
        {
          sno: prev.length + 1,
          item_id: selectedItem.id,
          item_code: selectedItem.item_code,
          item_name: selectedItem.item_name,
          company_name: selectedItem.company_name || '-',
          packing: selectedItem.packing || '1x1',
          trade_price: round2(selectedItem.trade_price || 0),
          quantity: qty,
          ...calc,
          remarks: entryRemarks.trim(),
        },
      ];
    });

    setSelectedItem(null);
    setItemSearch('');
    setEntryQty('1');
    setEntryRemarks('');
    setBanner(null);
  };

  const handleUpdateLineQty = (idx: number, rawQty: string) => {
    const qty = Math.max(0, round2(Number(rawQty || 0)));
    setLines((prev) =>
      prev.map((ln, i) => {
        if (i !== idx) return ln;
        const catalogItem = items.find((it) => it.id === ln.item_id) || {
          id: ln.item_id,
          item_code: ln.item_code,
          item_name: ln.item_name,
          company_name: ln.company_name,
          category_name: '',
          packing: ln.packing,
          trade_price: ln.trade_price,
          retail_price: ln.trade_price,
          available_packs: 0,
        };
        const calc = evaluateOfflineLineOfferAndDiscount(
          catalogItem,
          qty,
          selectedPartyId,
          selectedTown
        );
        return {
          ...ln,
          quantity: qty,
          ...calc,
        };
      })
    );
  };

  const handleRemoveLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx).map((ln, i) => ({ ...ln, sno: i + 1 })));
  };

  const currentTotals = useMemo(() => {
    const totalQty = round2(lines.reduce((s, l) => s + Number(l.quantity || 0), 0));
    const totalBonus = round2(lines.reduce((s, l) => s + Number(l.bonus_quantity || 0), 0));
    const gross = round2(lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.trade_price || 0), 0));
    const discount = round2(lines.reduce((s, l) => s + Number(l.discount_amount || 0), 0));
    const net = round2(lines.reduce((s, l) => s + Number(l.net_amount || 0), 0));
    return { totalQty, totalBonus, gross, discount, net };
  }, [lines]);

  const handleSaveBookingOnMobile = (targetStatus: MobileBookingStatus = 'Saved on Mobile'): MobileBookingRecord | null => {
    if (!salesman) return null;
    if (!selectedTown) {
      setBanner({ type: 'error', message: 'Please select a Town.' });
      return null;
    }
    const party = parties.find((p) => p.id === selectedPartyId);
    if (!party) {
      setBanner({ type: 'error', message: 'Please select an assigned Party / Customer.' });
      return null;
    }
    const validLines = lines.filter((l) => l.quantity > 0);
    if (validLines.length === 0) {
      setBanner({ type: 'error', message: 'Please add at least one item with Quantity > 0.' });
      return null;
    }

    const num =
      bookingNumber.trim() || generateMobileBookingNumber(salesman.salesman_code, bookings.length);

    const record: MobileBookingRecord = {
      booking_number: num,
      booking_date: bookingDate,
      salesman_id: salesman.id,
      salesman_code: salesman.salesman_code,
      salesman_name: salesman.name,
      town_name: selectedTown,
      area_name: selectedArea || party.area || '',
      party_account_id: party.id,
      party_code: party.account_code,
      party_name: party.account_name,
      payment_type: paymentType,
      remarks: bookingRemarks.trim(),
      status: targetStatus,
      created_at: new Date().toISOString(),
      items: validLines,
      total_items: validLines.length,
      total_quantity: currentTotals.totalQty,
      total_bonus: currentTotals.totalBonus,
      gross_amount: currentTotals.gross,
      discount_amount: currentTotals.discount,
      net_amount: currentTotals.net,
    };

    setBookings((prev) => {
      const filtered = prev.filter((b) => b.booking_number !== record.booking_number);
      return [record, ...filtered];
    });

    // Reset form for next party booking
    const nextBookingNum = generateMobileBookingNumber(salesman.salesman_code, bookings.length + 1);
    setBookingNumber(nextBookingNum);
    setSelectedPartyId(0);
    setBookingRemarks('');
    setLines([]);
    setBanner({
      type: 'success',
      message: `Booking ${record.booking_number} for "${record.party_name}" saved on mobile (${targetStatus}).`,
    });
    return record;
  };

  // Export structured JSON file locally + send to Super Admin email
  const handleSendBookingsToSuperAdmin = async (recordsToSend?: MobileBookingRecord[]) => {
    if (!salesman) return;

    // If salesman has unsaved items on screen, save them first
    let list = recordsToSend;
    if (!list) {
      if (lines.length > 0 && selectedPartyId) {
        const newlySaved = handleSaveBookingOnMobile('Pending Upload');
        if (!newlySaved) return;
        list = [
          newlySaved,
          ...bookings.filter(
            (b) => b.status === 'Saved on Mobile' || b.status === 'Pending Upload'
          ),
        ];
      } else {
        list = bookings.filter(
          (b) => b.status === 'Saved on Mobile' || b.status === 'Pending Upload'
        );
      }
    }

    if (!list || list.length === 0) {
      setBanner({
        type: 'error',
        message: 'No pending bookings to send. Add items to a booking or select saved bookings first.',
      });
      return;
    }

    const fileName = `Abrar_Bookings_${salesman.salesman_code}_${new Date()
      .toISOString()
      .slice(0, 10)}_${Date.now().toString().slice(-4)}.json`;

    const payload = {
      schema_version: '1.0',
      application: 'ABRAR MEDICAL STORE - SALESMAN MOBILE BOOKING',
      exported_at: new Date().toISOString(),
      file_name: fileName,
      salesman: {
        id: salesman.id,
        salesman_code: salesman.salesman_code,
        name: salesman.name,
        mobile: salesman.mobile,
      },
      total_bookings: list.length,
      bookings: list,
    };

    // Always download a local structured JSON file copy so the salesman can also share via WhatsApp/File if offline
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore download error
    }

    if (!isOnline) {
      setBookings((prev) =>
        prev.map((b) =>
          list!.some((sent) => sent.booking_number === b.booking_number)
            ? { ...b, status: 'Pending Upload' }
            : b
        )
      );
      setBanner({
        type: 'info',
        message: `Device is offline. Booking file "${fileName}" saved & downloaded. Bookings marked as "Pending Upload".`,
      });
      return;
    }

    setSendingToAdmin(true);
    try {
      const res = await fetch('/api/enhancements/mobile/send-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salesman_id: salesman.id,
          salesman_code: salesman.salesman_code,
          salesman_name: salesman.name,
          file_name: fileName,
          bookings: list,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to transmit booking to Super Admin');
      }

      const submittedNums = new Set(list.map((b) => b.booking_number));
      setBookings((prev) =>
        prev.map((b) =>
          submittedNums.has(b.booking_number)
            ? {
                ...b,
                status: 'Received',
                submitted_at: new Date().toISOString(),
              }
            : b
        )
      );

      setBanner({
        type: 'success',
        message: `Sent ${list.length} booking(s) to Super Admin (${data.super_admin_email || 'Super Admin'}) & downloaded "${fileName}". Batch: ${data.import_batch_number || 'Recorded'}.`,
      });
      setMobileTab('saved-bookings');
    } catch (err: unknown) {
      setBookings((prev) =>
        prev.map((b) =>
          list!.some((sent) => sent.booking_number === b.booking_number)
            ? { ...b, status: 'Pending Upload' }
            : b
        )
      );
      setBanner({
        type: 'error',
        message: `Local JSON file "${fileName}" downloaded, but server upload failed: ${
          err instanceof Error ? err.message : 'Network error'
        }`,
      });
    } finally {
      setSendingToAdmin(false);
    }
  };

  // ============================================================================
  // 1. SALESMAN LOGIN SCREEN (Part 2 — Separate Salesman Login)
  // ============================================================================
  if (!salesman) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-4 sm:p-6 select-none">
        <div className="max-w-md w-full mx-auto my-auto space-y-6">
          {onExitMobileMode && (
            <button
              type="button"
              onClick={onExitMobileMode}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Main ERP Desktop
            </button>
          )}

          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  Android / Mobile PWA
                </span>
                <h1 className="text-lg font-extrabold tracking-tight text-white mt-0.5">
                  ABRAR MEDICAL STORE
                </h1>
                <p className="text-xs text-slate-400">
                  Salesman Field Order Booking Application
                </p>
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Salesman Username or Code
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. SM-001 or salesman username"
                  className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter salesman password"
                  className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                {loginLoading ? 'Signing in...' : 'Sign In to Salesman Booking App'}
              </button>
            </form>

            <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Restricted Territory & Offline Ready</span>
              </div>
              <p>
                Salesmen can only access their assigned Towns, Areas, Parties, and permitted items. Bookings work offline and sync directly to the Super Admin.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 2. AUTHENTICATED SALESMAN MOBILE WORKSPACE
  // ============================================================================
  const pendingUploadCount = bookings.filter(
    (b) => b.status === 'Saved on Mobile' || b.status === 'Pending Upload'
  ).length;

  return (
    <div className="min-h-full bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 overflow-hidden shadow-xl flex flex-col">
      {/* Top Mobile Status Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {onExitMobileMode && (
            <button
              type="button"
              onClick={onExitMobileMode}
              title="Back to Desktop ERP"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center font-bold text-sm text-white">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">{salesman.name}</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700">
                {salesman.salesman_code}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2">
              <span>Assigned Towns: {salesman.assigned_towns?.join(', ') || 'All Assigned'}</span>
              {lastSyncedAt && <span>• Synced: {lastSyncedAt}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
              isOnline
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/50'
                : 'bg-amber-950/90 text-amber-300 border border-amber-700/50'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>

          <button
            type="button"
            onClick={() => syncCatalog(salesman.id)}
            disabled={syncing}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="px-2.5 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800/60 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Bar */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setMobileTab('new-booking')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
            mobileTab === 'new-booking'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          New Party Booking
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('saved-bookings')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
            mobileTab === 'saved-bookings'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Saved Bookings ({bookings.length})
          {pendingUploadCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-amber-400 text-slate-950 text-[10px] font-extrabold">
              {pendingUploadCount} Pending
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('offers-catalog')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer ${
            mobileTab === 'offers-catalog'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Gift className="w-3.5 h-3.5" />
          Active Trade Deals ({offers.length}) & Party Discounts ({partyDiscounts.length})
        </button>
      </div>

      {/* Notification Banner */}
      {banner && (
        <div
          className={`mx-4 mt-3 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
              : banner.type === 'error'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-sky-950/90 border-sky-700 text-sky-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: NEW PARTY BOOKING ENTRY */}
      {mobileTab === 'new-booking' && (
        <div className="p-4 space-y-4 flex-1">
          {/* Booking Header Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Booking Number (Auto)
              </label>
              <input
                type="text"
                value={bookingNumber}
                readOnly
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Booking Date
              </label>
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Select Town *
              </label>
              <select
                value={selectedTown}
                onChange={(e) => {
                  setSelectedTown(e.target.value);
                  setSelectedArea('');
                  setSelectedPartyId(0);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              >
                <option value="">-- Choose Assigned Town --</option>
                {towns.map((t) => (
                  <option key={t.id} value={t.town_name}>
                    {t.town_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Select Area
              </label>
              <select
                value={selectedArea}
                onChange={(e) => {
                  setSelectedArea(e.target.value);
                  setSelectedPartyId(0);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              >
                <option value="">-- All Areas in Town --</option>
                {availableAreas.map((a) => (
                  <option key={a.id} value={a.area_name}>
                    {a.area_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Select Party / Customer * ({availableParties.length} Assigned)
              </label>
              <select
                value={selectedPartyId}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  setSelectedPartyId(pid);
                  const found = parties.find((p) => p.id === pid);
                  if (found && !selectedTown && found.town) setSelectedTown(found.town);
                  if (found && !selectedArea && found.area) setSelectedArea(found.area);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              >
                <option value={0}>-- Select Party Account --</option>
                {availableParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.account_name} ({p.town || 'No Town'}{p.area ? ` / ${p.area}` : ''}) — Bal: Rs.{' '}
                    {Number(p.current_balance || 0).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Payment Type
              </label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as 'Credit' | 'Cash')}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              >
                <option value="Credit">Credit</option>
                <option value="Cash">Cash</option>
              </select>
            </div>

            <div className="sm:col-span-5">
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Booking Remarks / Delivery Instructions
              </label>
              <input
                type="text"
                value={bookingRemarks}
                onChange={(e) => setBookingRemarks(e.target.value)}
                placeholder="Optional order notes, urgent delivery timing, etc."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              />
            </div>
          </div>

          {/* Fast Mobile Item Search & Add Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Fast Medicine Lookup & Automatic Offer / Party Discount Calculator
              </span>
              <span className="text-[11px] text-slate-400">
                Stacking Rule: <strong className="text-slate-200">{stackingRule === 'combine_both' ? 'Combine Offer + Party' : 'Higher Discount Only'}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
              <div className="md:col-span-6 relative">
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setSelectedItem(null);
                  }}
                  placeholder="Search by Item Name, Item Code, or Company..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                {itemSearch.trim() && !selectedItem && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800">
                    {filteredItems.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400">No matching permitted items found.</div>
                    ) : (
                      filteredItems.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => {
                            setSelectedItem(it);
                            setItemSearch(`${it.item_code} — ${it.item_name} (${it.company_name || 'General'})`);
                          }}
                          className="w-full px-3.5 py-2.5 text-left hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div>
                            <div className="text-xs font-bold text-white">
                              {it.item_name}{' '}
                              <span className="text-[10px] font-mono text-emerald-400">[{it.item_code}]</span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Company: {it.company_name || '-'} • Packing: {it.packing || '1x1'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-emerald-300">
                              T.P: Rs. {Number(it.trade_price || 0).toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Stock: {Number(it.available_packs || 0)} Packs
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={entryQty}
                  onChange={(e) => setEntryQty(e.target.value)}
                  placeholder="Qty"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-bold text-center"
                />
              </div>

              <div className="md:col-span-2">
                <input
                  type="text"
                  value={entryRemarks}
                  onChange={(e) => setEntryRemarks(e.target.value)}
                  placeholder="Line remarks"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
              </div>

              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={handleAddItemLine}
                  className="w-full h-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>
            </div>
          </div>

          {/* Booking Item Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                Booking Item Grid ({lines.length} Items)
              </span>
              <span className="text-xs font-mono text-emerald-400">
                Net Booking Value: Rs. {currentTotals.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
                    <th className="py-2.5 px-3">S.No</th>
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Item Code</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3 text-right">Trade Price</th>
                    <th className="py-2.5 px-3 text-center">Quantity</th>
                    <th className="py-2.5 px-3 text-center">Bonus</th>
                    <th className="py-2.5 px-3 text-center">Discount</th>
                    <th className="py-2.5 px-3 text-right">Net Amount</th>
                    <th className="py-2.5 px-3">Remarks</th>
                    <th className="py-2.5 px-2 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-500 text-xs">
                        No items added yet. Search and add medicines above to create a party booking.
                      </td>
                    </tr>
                  ) : (
                    lines.map((ln, idx) => (
                      <tr key={`${ln.item_id}-${idx}`} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-mono text-slate-400">{ln.sno}</td>
                        <td className="py-2 px-3 text-slate-300">{ln.company_name}</td>
                        <td className="py-2 px-3 font-mono text-emerald-300">{ln.item_code}</td>
                        <td className="py-2 px-3 font-semibold text-white">
                          {ln.item_name}
                          {ln.applied_offer_name && (
                            <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                              {ln.applied_offer_name}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {ln.trade_price.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <input
                            type="number"
                            min="1"
                            value={ln.quantity}
                            onChange={(e) => handleUpdateLineQty(idx, e.target.value)}
                            className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-center font-bold text-white"
                          />
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-amber-300 font-bold">
                          {ln.bonus_quantity > 0 ? `+${ln.bonus_quantity}` : '0'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="font-mono text-sky-300 font-semibold">
                            {ln.discount_percent.toFixed(1)}% (Rs. {ln.discount_amount.toFixed(2)})
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Offer: {ln.offer_discount_percent}% | Party: {ln.party_discount_percent}%
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-300">
                          {ln.net_amount.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{ln.remarks || '-'}</td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            className="p-1 rounded hover:bg-rose-950 text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Totals & Action Buttons */}
            <div className="bg-slate-950/90 border-t border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-slate-400">Total Qty:</span>{' '}
                  <strong className="text-white font-mono">{currentTotals.totalQty}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Total Bonus:</span>{' '}
                  <strong className="text-amber-300 font-mono">{currentTotals.totalBonus}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Gross:</span>{' '}
                  <strong className="text-slate-200 font-mono">Rs. {currentTotals.gross.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Discount:</span>{' '}
                  <strong className="text-sky-300 font-mono">Rs. {currentTotals.discount.toFixed(2)}</strong>
                </div>
                <div className="text-sm">
                  <span className="text-slate-400">Net Total:</span>{' '}
                  <strong className="text-emerald-400 font-mono">Rs. {currentTotals.net.toFixed(2)}</strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSaveBookingOnMobile('Saved on Mobile')}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 border border-slate-700 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-sky-400" />
                  Save Booking on Mobile (Add Another Party)
                </button>

                <button
                  type="button"
                  disabled={sendingToAdmin}
                  onClick={() => handleSendBookingsToSuperAdmin()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {sendingToAdmin ? 'Sending to Super Admin...' : 'SEND BOOKING TO SUPER ADMIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SAVED MOBILE BOOKINGS & BATCH UPLOAD */}
      {mobileTab === 'saved-bookings' && (
        <div className="p-4 space-y-4 flex-1">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                Mobile Booking Queue & Status Tracker
              </h3>
              <p className="text-xs text-slate-400">
                Multiple party bookings can be saved offline and transmitted together in a single structured file to the Super Admin.
              </p>
            </div>
            <button
              type="button"
              disabled={sendingToAdmin || pendingUploadCount === 0}
              onClick={() =>
                handleSendBookingsToSuperAdmin(
                  bookings.filter(
                    (b) => b.status === 'Saved on Mobile' || b.status === 'Pending Upload'
                  )
                )
              }
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              SEND BOOKING TO SUPER ADMIN ({pendingUploadCount} Pending)
            </button>
          </div>

          <div className="space-y-2.5">
            {bookings.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
                No saved bookings on this mobile device yet.
              </div>
            ) : (
              bookings.map((b) => (
                <div
                  key={b.booking_number}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-emerald-300">
                        {b.booking_number}
                      </span>
                      <span className="text-xs font-bold text-white">{b.party_name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {b.town_name}{b.area_name ? ` / ${b.area_name}` : ''}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          b.status === 'Received' || b.status === 'Imported' || b.status === 'Supply Generated'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Date: {b.booking_date} • Items: {b.total_items} • Total Qty: {b.total_quantity} • Bonus:{' '}
                      {b.total_bonus} • Discount: Rs. {Number(b.discount_amount || 0).toFixed(2)} •{' '}
                      <strong className="text-emerald-300">Net: Rs. {Number(b.net_amount || 0).toFixed(2)}</strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendBookingsToSuperAdmin([b])}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Resend / Export JSON
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ACTIVE OFFERS & PARTY DISCOUNTS */}
      {mobileTab === 'offers-catalog' && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Gift className="w-4 h-4" />
              Active Trade Deals & Schemes ({offers.length})
            </h3>
            {offers.length === 0 ? (
              <p className="text-xs text-slate-400">No active trade deals configured.</p>
            ) : (
              <div className="space-y-2">
                {offers.map((o) => (
                  <div key={o.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{o.offer_name}</span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        {o.offer_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Scope: {o.scope_type} {o.item_code ? `(${o.item_code})` : o.company_name ? `(${o.company_name})` : '(All Items)'} • Min Qty: {o.min_quantity} •{' '}
                      {o.discount_percent > 0 && `Disc: ${o.discount_percent}% `}
                      {o.bonus_quantity > 0 && `Bonus: +${o.bonus_quantity} `}
                      {o.fixed_discount_amount > 0 && `Fixed: Rs.${o.fixed_discount_amount}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
              <Percent className="w-4 h-4" />
              Party-Wise Special Discounts ({partyDiscounts.length})
            </h3>
            {partyDiscounts.length === 0 ? (
              <p className="text-xs text-slate-400">No party-specific special discounts configured.</p>
            ) : (
              <div className="space-y-2">
                {partyDiscounts.map((pd) => (
                  <div key={pd.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{pd.party_name}</span>
                      <span className="font-mono font-bold text-sky-300">
                        {pd.discount_percent}% Off
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Applies to: {pd.scope_type === 'item' ? `Item ${pd.item_code}` : pd.scope_type === 'company' ? `Company ${pd.company_name}` : 'All Items'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
