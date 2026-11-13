import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
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
  Gift,
  Percent,
  Lock,
  ArrowLeft,
  ShieldCheck,
  Calendar,
  MapPin,
  FileSpreadsheet,
  FileJson,
  CheckCheck,
  Edit3,
  Copy,
  Check,
  Share2,
  Sun,
  Moon,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface MobileSalesman {
  id: number;
  salesman_code: string;
  name: string;
  salesman_name?: string;
  username: string;
  mobile: string;
  working_days?: string[];
  assigned_area?: string;
  assigned_towns?: string[];
  assigned_areas?: string[];
  assigned_parties?: number[];
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
  town_name?: string;
  town_id?: number;
  area: string;
  area_name?: string;
  area_id?: number;
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
  offer_type: 'percentage_discount' | 'bonus_quantity' | 'fixed_discount' | 'slab_offer' | 'slab_based';
  scope_type: 'all_items' | 'selected_items' | 'item' | 'company';
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
  | 'Finalized'
  | 'Pending Upload'
  | 'Submitted'
  | 'Received'
  | 'Imported'
  | 'Supply Generated';

export interface MobileBookingRecord {
  booking_uuid: string;
  booking_number: string;
  booking_date: string;
  salesman_id: number;
  salesman_code: string;
  salesman_name: string;
  town_id?: number;
  town_name: string;
  area_id?: number;
  area_name: string;
  party_account_id: number;
  party_code: string;
  party_name: string;
  payment_type: 'Credit' | 'Cash';
  remarks: string;
  status: MobileBookingStatus;
  finalized_at?: string;
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
const OFFLINE_CREDENTIALS_KEY = 'ams_mobile_offline_creds_v1';
const CATALOG_CACHE_KEY = 'ams_mobile_catalog_cache_v1';
const BOOKINGS_STORAGE_KEY = 'ams_mobile_bookings_queue_v1';
const ALL_WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function generateMobileBookingNumber(salesmanCode: string, existingCount: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cleanCode = (salesmanCode || 'SAL').replace(/[^A-Z0-9]/gi, '').slice(-5).toUpperCase();
  const seq = String(existingCount + 1).padStart(3, '0');
  return `MBK-${cleanCode}-${datePart}-${seq}`;
}

function generateBookingUuid(salesmanCode: string): string {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `UUID-${salesmanCode || 'SAL'}-${Date.now()}-${rand}`;
}

export const SalesmanMobileBookingApp: React.FC<{
  onExitMobileMode?: () => void;
  isStandalonePWA?: boolean;
}> = ({ onExitMobileMode, isStandalonePWA = false }) => {
  const [salesman, setSalesman] = useState<MobileSalesman | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalledPWA, setIsInstalledPWA] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

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
  const [workingDays, setWorkingDays] = useState<string[]>([
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]);
  const [superAdminEmail, setSuperAdminEmail] = useState<string>('abrar.aslam02@gmail.com');
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

  // Active tab in Mobile App
  const [mobileTab, setMobileTab] = useState<'new-booking' | 'saved-bookings' | 'offers-catalog'>('new-booking');

  // Booking Header state
  const [bookingDate, setBookingDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bookingNumber, setBookingNumber] = useState<string>('');
  const [editingBookingUuid, setEditingBookingUuid] = useState<string | null>(null);
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
  const autoSyncTriggeredRef = useRef(false);

  const salesmanPwaUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/salesman';
    return `${window.location.origin}/salesman`;
  }, []);

  const currentDayName = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }, []);

  const isTodayWorkingDay = useMemo(() => {
    return workingDays.some((d) => d.toLowerCase() === currentDayName.toLowerCase());
  }, [workingDays, currentDayName]);

  // Listen for PWA install events
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalledPWA(true);
      setDeferredPrompt(null);
      setShowInstallModal(false);
      setBanner({
        type: 'success',
        message: 'AMS Salesman Booking App installed on your device home screen!',
      });
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      setShowInstallModal(true);
    }
  };

  const handleCopyPwaUrl = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(salesmanPwaUrl).then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2500);
      });
    }
  };

  // Persist bookings queue in localStorage for offline support
  useEffect(() => {
    try {
      localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(bookings));
    } catch {
      // ignore quota error
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
        if (Array.isArray(parsed.workingDays) && parsed.workingDays.length > 0) {
          setWorkingDays(parsed.workingDays);
        }
        if (parsed.superAdminEmail) {
          setSuperAdminEmail(parsed.superAdminEmail);
        }
        setLastSyncedAt(parsed.syncedAt || '');
      }
    } catch {
      // ignore
    }
  }, []);

  const syncCatalog = useCallback(async (salesmanId: number, isMorningSync = false) => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/enhancements/mobile/catalog/${salesmanId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to sync salesman catalog');
      }
      const nowStr = new Date().toLocaleString();
      const syncedTowns: CatalogTown[] = data.towns || [];
      const syncedParties: CatalogParty[] = data.parties || [];
      const syncedItems: CatalogItem[] = data.items || [];
      const syncedOffers: CatalogOffer[] = data.offers || [];
      const syncedPartyDiscounts: CatalogPartyDiscount[] = data.party_discounts || [];
      const syncedWorkingDays: string[] =
        Array.isArray(data.working_days) && data.working_days.length > 0
          ? data.working_days
          : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      setTowns(syncedTowns);
      setParties(syncedParties);
      setItems(syncedItems);
      setOffers(syncedOffers);
      setPartyDiscounts(syncedPartyDiscounts);
      setWorkingDays(syncedWorkingDays);
      setStackingRule(data.discount_stacking_rule || 'higher_only');
      if (data.super_admin_email) {
        setSuperAdminEmail(data.super_admin_email);
      }
      setLastSyncedAt(nowStr);

      if (data.salesman) {
        setSalesman((prev) => {
          const updated: MobileSalesman = {
            ...(prev || {}),
            ...data.salesman,
            name: data.salesman.salesman_name || data.salesman.name || prev?.name || 'Salesman',
            working_days: syncedWorkingDays,
            assigned_towns: syncedTowns.map((t) => t.town_name),
          };
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      }

      localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify({
          towns: syncedTowns,
          parties: syncedParties,
          items: syncedItems,
          offers: syncedOffers,
          partyDiscounts: syncedPartyDiscounts,
          workingDays: syncedWorkingDays,
          superAdminEmail: data.super_admin_email || 'abrar.aslam02@gmail.com',
          stackingRule: data.discount_stacking_rule || 'higher_only',
          syncedAt: nowStr,
        })
      );

      if (isMorningSync) {
        setBanner({
          type: 'success',
          message: `Morning Sync Complete! Downloaded ${syncedTowns.length} Assigned Town(s), ${syncedParties.length} Assigned Parties, ${syncedItems.length} Items & Prices, and ${syncedOffers.length} Offers for offline booking.`,
        });
      }
    } catch (err: unknown) {
      setBanner({
        type: 'info',
        message: `Offline Mode Active — using locally cached catalog (${err instanceof Error ? err.message : 'Offline'}).`,
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (salesman?.id) {
      syncCatalog(salesman.id, false);
    }
  }, [salesman?.id, syncCatalog]);

  // Initialize booking number when salesman or bookings change
  useEffect(() => {
    if (salesman && !bookingNumber && !editingBookingUuid) {
      setBookingNumber(generateMobileBookingNumber(salesman.salesman_code, bookings.length));
    }
  }, [salesman, bookings.length, bookingNumber, editingBookingUuid]);

  // Local client-side Offer & Party Discount evaluation (works 100% offline!)
  const evaluateOfflineLineOfferAndDiscount = useCallback(
    (item: CatalogItem, qty: number, partyId: number, townName: string) => {
      const today = bookingDate || new Date().toISOString().slice(0, 10);
      const tradePrice = round2(item.trade_price || 0);
      const gross = round2(qty * tradePrice);

      let bestOfferDiscPct = 0;
      let bestOfferFixed = 0;
      let bestBonusQty = 0;
      let bestOfferName = '';

      for (const off of offers) {
        if (off.status === 'Disabled' || off.status === 'Inactive') continue;
        if (off.start_date && off.start_date.slice(0, 10) > today) continue;
        if (off.end_date && off.end_date.slice(0, 10) < today) continue;

        if (
          (off.scope_type === 'selected_items' || off.scope_type === 'item') &&
          Number(off.item_id) !== item.id &&
          off.item_code !== item.item_code
        ) {
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

        if (off.offer_type === 'slab_offer' || off.offer_type === 'slab_based') {
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

      let partyDiscPct = 0;
      let partyFixedAmt = 0;
      if (partyId) {
        const matchingPartyRules = partyDiscounts.filter((pd) => {
          if (Number(pd.party_account_id) !== partyId) return false;
          if (pd.status !== 'Active') return false;
          if (pd.start_date && pd.start_date.slice(0, 10) > today) return false;
          if (pd.end_date && pd.end_date.slice(0, 10) < today) return false;
          if (pd.scope_type === 'item') return Number(pd.item_id) === item.id || pd.item_code === item.item_code;
          if (pd.scope_type === 'company') {
            return String(pd.company_name || '').toLowerCase() === String(item.company_name || '').toLowerCase();
          }
          return pd.scope_type === 'all_items';
        });

        const sortedRules = matchingPartyRules.sort((a, b) => {
          const rank = (s: string) => (s === 'item' ? 3 : s === 'company' ? 2 : 1);
          return rank(b.scope_type) - rank(a.scope_type);
        });
        if (sortedRules[0]) {
          partyDiscPct = Number(sortedRules[0].discount_percent || 0);
          partyFixedAmt = Number(sortedRules[0].fixed_discount_amount || 0);
        }
      }

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
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setLoginError('Please enter your Salesman Username/Code and Password.');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch('/api/enhancements/mobile/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid salesman credentials');
      }
      const sm: MobileSalesman = {
        ...data.salesman,
        name: data.salesman.salesman_name || data.salesman.name || 'Salesman',
        working_days: data.working_days || data.salesman.working_days || [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ],
        assigned_towns: (data.towns || []).map((t: CatalogTown) => t.town_name),
      };
      setSalesman(sm);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sm));
      localStorage.setItem(
        OFFLINE_CREDENTIALS_KEY,
        JSON.stringify({ username: cleanUser.toLowerCase(), salesman: sm })
      );
      setBookingNumber(generateMobileBookingNumber(sm.salesman_code, bookings.length));
      await syncCatalog(sm.id, true);
    } catch (err: unknown) {
      // Allow offline login if salesman previously authenticated on this device
      if (!navigator.onLine) {
        try {
          const cachedCreds = JSON.parse(localStorage.getItem(OFFLINE_CREDENTIALS_KEY) || '{}');
          if (
            cachedCreds?.salesman &&
            (cachedCreds.username === cleanUser.toLowerCase() ||
              String(cachedCreds.salesman.salesman_code || '').toLowerCase() === cleanUser.toLowerCase())
          ) {
            setSalesman(cachedCreds.salesman);
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(cachedCreds.salesman));
            setBanner({
              type: 'info',
              message: 'Signed in using Offline Cached Session.',
            });
            setLoginLoading(false);
            return;
          }
        } catch {
          // ignore
        }
      }
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
      const partyTown = p.town || p.town_name || '';
      const partyArea = p.area || p.area_name || '';
      if (selectedTown && partyTown && partyTown.toLowerCase() !== selectedTown.toLowerCase()) {
        return false;
      }
      if (selectedArea && partyArea && partyArea.toLowerCase() !== selectedArea.toLowerCase()) {
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
      setBanner({ type: 'error', message: 'Please select an Assigned Town.' });
      return null;
    }
    const party = parties.find((p) => p.id === selectedPartyId);
    if (!party) {
      setBanner({ type: 'error', message: 'Please select an Assigned Party / Customer.' });
      return null;
    }
    const validLines = lines.filter((l) => l.quantity > 0);
    if (validLines.length === 0) {
      setBanner({ type: 'error', message: 'Please add at least one item with Quantity > 0.' });
      return null;
    }

    const townObj = towns.find((t) => t.town_name.toLowerCase() === selectedTown.toLowerCase());
    const areaObj = availableAreas.find((a) => a.area_name.toLowerCase() === selectedArea.toLowerCase());

    const num =
      bookingNumber.trim() || generateMobileBookingNumber(salesman.salesman_code, bookings.length);
    const uuid = editingBookingUuid || generateBookingUuid(salesman.salesman_code);

    const record: MobileBookingRecord = {
      booking_uuid: uuid,
      booking_number: num,
      booking_date: bookingDate,
      salesman_id: salesman.id,
      salesman_code: salesman.salesman_code,
      salesman_name: salesman.name,
      town_id: townObj?.id || party.town_id || 0,
      town_name: selectedTown,
      area_id: areaObj?.id || party.area_id || 0,
      area_name: selectedArea || party.area || party.area_name || '',
      party_account_id: party.id,
      party_code: party.account_code,
      party_name: party.account_name,
      payment_type: paymentType,
      remarks: bookingRemarks.trim(),
      status: targetStatus,
      finalized_at: targetStatus === 'Finalized' ? new Date().toISOString() : undefined,
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
      const filtered = prev.filter(
        (b) => b.booking_number !== record.booking_number && b.booking_uuid !== record.booking_uuid
      );
      return [record, ...filtered];
    });

    const nextBookingNum = generateMobileBookingNumber(salesman.salesman_code, bookings.length + 1);
    setBookingNumber(nextBookingNum);
    setEditingBookingUuid(null);
    setSelectedPartyId(0);
    setBookingRemarks('');
    setLines([]);
    setBanner({
      type: 'success',
      message: `Booking ${record.booking_number} for "${record.party_name}" saved locally (${targetStatus}).`,
    });
    return record;
  };

  const handleEditSavedBooking = (bk: MobileBookingRecord) => {
    if (bk.status === 'Submitted' || bk.status === 'Received' || bk.status === 'Imported' || bk.status === 'Supply Generated') {
      setBanner({
        type: 'error',
        message: `Booking ${bk.booking_number} has already been submitted to Super Admin and cannot be modified.`,
      });
      return;
    }
    setEditingBookingUuid(bk.booking_uuid);
    setBookingNumber(bk.booking_number);
    setBookingDate(bk.booking_date);
    setSelectedTown(bk.town_name);
    setSelectedArea(bk.area_name);
    setSelectedPartyId(bk.party_account_id);
    setPaymentType(bk.payment_type || 'Credit');
    setBookingRemarks(bk.remarks || '');
    setLines(bk.items || []);
    setMobileTab('new-booking');
    setBanner({
      type: 'info',
      message: `Loaded Booking ${bk.booking_number} (${bk.party_name}) for review/editing.`,
    });
  };

  const handleDeleteSavedBooking = (bk: MobileBookingRecord) => {
    if (bk.status === 'Submitted' || bk.status === 'Received' || bk.status === 'Imported') {
      setBanner({
        type: 'error',
        message: 'Submitted bookings cannot be deleted.',
      });
      return;
    }
    setBookings((prev) => prev.filter((item) => item.booking_number !== bk.booking_number));
    setBanner({
      type: 'info',
      message: `Removed draft booking ${bk.booking_number}.`,
    });
  };

  const handleFinalizeBookings = (targetBookingNumbers?: string[]) => {
    const nowIso = new Date().toISOString();
    let count = 0;
    setBookings((prev) =>
      prev.map((b) => {
        const isEligible = b.status === 'Saved on Mobile';
        const isTarget = !targetBookingNumbers || targetBookingNumbers.includes(b.booking_number);
        if (isEligible && isTarget) {
          count++;
          return {
            ...b,
            status: 'Finalized',
            finalized_at: nowIso,
          };
        }
        return b;
      })
    );
    if (count > 0) {
      setBanner({
        type: 'success',
        message: `Evening Review Complete: ${count} booking(s) finalized and locked for export & Super Admin dispatch.`,
      });
    } else {
      setBanner({
        type: 'info',
        message: 'All pending bookings are already finalized.',
      });
    }
  };

  // Download structured JSON file
  const downloadStructuredJsonFile = useCallback(
    (list: MobileBookingRecord[], fileName: string) => {
      if (!salesman || list.length === 0) return;
      const payload = {
        schema_version: 'AMS_MOBILE_BOOKING_V1',
        application: 'ABRAR MEDICAL STORE - SALESMAN MOBILE BOOKING PWA',
        exported_at: new Date().toISOString(),
        file_name: fileName,
        salesman: {
          id: salesman.id,
          salesman_code: salesman.salesman_code,
          salesman_name: salesman.name,
          name: salesman.name,
          mobile: salesman.mobile,
        },
        total_bookings: list.length,
        bookings: list.map((b) => ({
          ...b,
          booking_no: b.booking_number,
          party_id: b.party_account_id,
          items: b.items.map((it) => ({
            ...it,
            pack_size: it.packing,
            bonus_qty: it.bonus_quantity,
          })),
        })),
      };

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
    },
    [salesman]
  );

  // Download structured Excel (.xlsx) workbook
  const downloadStructuredExcelFile = useCallback(
    (list: MobileBookingRecord[], excelFileName: string) => {
      if (!salesman || list.length === 0) return;
      try {
        const summaryRows = list.map((b, i) => ({
          S_No: i + 1,
          Booking_UUID: b.booking_uuid || b.booking_number,
          Booking_Number: b.booking_number,
          Booking_Date: b.booking_date,
          Salesman_ID: b.salesman_id,
          Salesman_Code: b.salesman_code,
          Salesman_Name: b.salesman_name,
          Town_ID: b.town_id || 0,
          Town_Name: b.town_name,
          Area_ID: b.area_id || 0,
          Area_Name: b.area_name,
          Party_ID: b.party_account_id,
          Party_Code: b.party_code,
          Party_Name: b.party_name,
          Payment_Type: b.payment_type,
          Total_Items: b.total_items,
          Total_Qty: b.total_quantity,
          Total_Bonus: b.total_bonus,
          Gross_Amount: b.gross_amount,
          Discount_Amount: b.discount_amount,
          Net_Amount: b.net_amount,
          Status: b.status,
          Remarks: b.remarks || '',
        }));

        const lineRows: Array<Record<string, string | number>> = [];
        for (const b of list) {
          for (const it of b.items) {
            lineRows.push({
              Booking_UUID: b.booking_uuid || b.booking_number,
              Booking_Number: b.booking_number,
              Booking_Date: b.booking_date,
              Salesman_ID: b.salesman_id,
              Salesman_Code: b.salesman_code,
              Salesman_Name: b.salesman_name,
              Town_ID: b.town_id || 0,
              Town_Name: b.town_name,
              Area_ID: b.area_id || 0,
              Area_Name: b.area_name,
              Party_ID: b.party_account_id,
              Party_Code: b.party_code,
              Party_Name: b.party_name,
              Line_SNo: it.sno,
              Item_ID: it.item_id,
              Item_Code: it.item_code,
              Item_Name: it.item_name,
              Company_Name: it.company_name,
              Packing: it.packing,
              Trade_Price: it.trade_price,
              Quantity: it.quantity,
              Bonus_Qty: it.bonus_quantity,
              Offer_Discount_Pct: it.offer_discount_percent,
              Party_Discount_Pct: it.party_discount_percent,
              Effective_Discount_Pct: it.discount_percent,
              Discount_Amount: it.discount_amount,
              Net_Amount: it.net_amount,
              Applied_Offer: it.applied_offer_name || '',
              Remarks: it.remarks || '',
            });
          }
        }

        const wb = XLSX.utils.book_new();
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        const wsLines = XLSX.utils.json_to_sheet(lineRows);
        XLSX.utils.book_append_sheet(wb, wsLines, 'Booking_Items');
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Bookings_Summary');
        XLSX.writeFile(wb, excelFileName);
      } catch {
        // ignore excel download error
      }
    },
    [salesman]
  );

  // Finalize & Send bookings to Super Admin email (with duplicate submission prevention)
  const handleSendBookingsToSuperAdmin = useCallback(
    async (recordsToSend?: MobileBookingRecord[], options?: { downloadJson?: boolean; downloadExcel?: boolean; silentAutoSync?: boolean }) => {
      if (!salesman) return;
      const shouldDownloadJson = options?.downloadJson ?? true;
      const shouldDownloadExcel = options?.downloadExcel ?? false;

      let list = recordsToSend;
      if (!list) {
        if (lines.length > 0 && selectedPartyId) {
          const newlySaved = handleSaveBookingOnMobile('Finalized');
          if (!newlySaved) return;
          list = [
            newlySaved,
            ...bookings.filter(
              (b) =>
                b.status === 'Saved on Mobile' ||
                b.status === 'Finalized' ||
                b.status === 'Pending Upload'
            ),
          ];
        } else {
          list = bookings.filter(
            (b) =>
              b.status === 'Saved on Mobile' ||
              b.status === 'Finalized' ||
              b.status === 'Pending Upload'
          );
        }
      }

      // Filter out already-submitted bookings to prevent duplicate submissions
      const unsubmittedList = (list || []).filter(
        (b) => b.status !== 'Submitted' && b.status !== 'Received' && b.status !== 'Imported' && b.status !== 'Supply Generated'
      );

      if (unsubmittedList.length === 0) {
        if (!options?.silentAutoSync) {
          setBanner({
            type: 'error',
            message: 'Duplicate submission prevented: All selected bookings have already been submitted to Super Admin.',
          });
        }
        return;
      }

      const dateSlug = new Date().toISOString().slice(0, 10);
      const timeSlug = Date.now().toString().slice(-4);
      const jsonFileName = `AMS_Booking_${salesman.salesman_code}_${dateSlug}_${timeSlug}.json`;
      const excelFileName = `AMS_Booking_${salesman.salesman_code}_${dateSlug}_${timeSlug}.xlsx`;

      if (shouldDownloadJson && !options?.silentAutoSync) {
        downloadStructuredJsonFile(unsubmittedList, jsonFileName);
      }
      if (shouldDownloadExcel && !options?.silentAutoSync) {
        downloadStructuredExcelFile(unsubmittedList, excelFileName);
      }

      if (!navigator.onLine) {
        setBookings((prev) =>
          prev.map((b) =>
            unsubmittedList.some((sent) => sent.booking_number === b.booking_number)
              ? { ...b, status: 'Pending Upload', finalized_at: b.finalized_at || new Date().toISOString() }
              : b
          )
        );
        setBanner({
          type: 'info',
          message: `Offline Mode: ${unsubmittedList.length} finalized booking(s) saved as "Pending Upload" and exported locally. They will auto-sync to Super Admin (${superAdminEmail}) as soon as internet returns.`,
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
            file_name: jsonFileName,
            device_info: isStandalonePWA ? 'Installed Salesman Booking PWA (/salesman)' : 'Salesman Mobile Booking PWA',
            bookings: unsubmittedList.map((b) => ({
              ...b,
              booking_no: b.booking_number,
              party_id: b.party_account_id,
              items: b.items.map((it) => ({
                ...it,
                pack_size: it.packing,
                bonus_qty: it.bonus_quantity,
              })),
            })),
          }),
        });
        const data = await res.json();

        if (res.status === 409 || data.is_duplicate_submission) {
          const submittedNums = new Set(unsubmittedList.map((b) => b.booking_number));
          setBookings((prev) =>
            prev.map((b) =>
              submittedNums.has(b.booking_number)
                ? { ...b, status: 'Submitted', submitted_at: b.submitted_at || new Date().toISOString() }
                : b
            )
          );
          setBanner({
            type: 'info',
            message: data.error || 'Duplicate submission prevented: This booking batch was already received by Super Admin.',
          });
          return;
        }

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to transmit booking to Super Admin');
        }

        const submittedNums = new Set(unsubmittedList.map((b) => b.booking_number));
        setBookings((prev) =>
          prev.map((b) =>
            submittedNums.has(b.booking_number)
              ? {
                  ...b,
                  status: 'Submitted',
                  finalized_at: b.finalized_at || new Date().toISOString(),
                  submitted_at: new Date().toISOString(),
                }
              : b
          )
        );

        setBanner({
          type: 'success',
          message: `Evening Finalize & Dispatch Complete! Sent ${unsubmittedList.length} booking(s) to Super Admin (${data.recipient_email || superAdminEmail}) & queued in Supply & Distribution -> Import Booking.`,
        });
        setMobileTab('saved-bookings');
      } catch (err: unknown) {
        setBookings((prev) =>
          prev.map((b) =>
            unsubmittedList.some((sent) => sent.booking_number === b.booking_number)
              ? { ...b, status: 'Pending Upload' }
              : b
          )
        );
        setBanner({
          type: 'error',
          message: `Saved locally as "Pending Upload". Server transmission will retry when online (${
            err instanceof Error ? err.message : 'Network error'
          }).`,
        });
      } finally {
        setSendingToAdmin(false);
      }
    },
    [
      salesman,
      lines,
      selectedPartyId,
      bookings,
      superAdminEmail,
      isStandalonePWA,
      downloadStructuredJsonFile,
      downloadStructuredExcelFile,
    ]
  );

  // Monitor browser online/offline state & auto-synchronize when internet returns
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (salesman?.id) {
        syncCatalog(salesman.id, false);
        const pendingUploads = bookings.filter((b) => b.status === 'Pending Upload');
        if (pendingUploads.length > 0 && !autoSyncTriggeredRef.current) {
          autoSyncTriggeredRef.current = true;
          handleSendBookingsToSuperAdmin(pendingUploads, {
            downloadJson: false,
            downloadExcel: false,
            silentAutoSync: true,
          }).finally(() => {
            autoSyncTriggeredRef.current = false;
          });
        }
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [salesman?.id, bookings, syncCatalog, handleSendBookingsToSuperAdmin]);

  // ============================================================================
  // PWA INSTALLATION MODAL (Android Chrome & iOS Safari)
  // ============================================================================
  const renderInstallModal = () => {
    if (!showInstallModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-5 space-y-4 text-white shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">
                  Install Salesman Booking PWA
                </h3>
                <p className="text-[11px] text-slate-400">
                  Standalone Android & Mobile Offline Application
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowInstallModal(false)}
              className="text-slate-400 hover:text-white text-sm font-bold px-2 py-1"
            >
              ✕
            </button>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Dedicated Salesman Application URL
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={salesmanPwaUrl}
                className="flex-1 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-emerald-300"
              />
              <button
                type="button"
                onClick={handleCopyPwaUrl}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-slate-300">
            <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 space-y-1.5">
              <div className="font-bold text-emerald-300">
                Android (Google Chrome) Installation:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300">
                <li>Open the URL above in <strong>Google Chrome</strong> on your Android phone.</li>
                <li>Tap the <strong>⋮ (Three Dots Menu)</strong> in the top-right corner of Chrome.</li>
                <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
                <li>Launch <strong>AMS Booking</strong> directly from your Android home screen anytime (works offline!).</li>
              </ol>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
              <div className="font-bold text-sky-300">
                iPhone / iPad (Safari) Installation:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300">
                <li>Open the URL above in <strong>Safari</strong>.</li>
                <li>Tap the <strong>Share</strong> icon at the bottom of the screen.</li>
                <li>Select <strong>"Add to Home Screen"</strong> and tap <strong>Add</strong>.</li>
              </ol>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowInstallModal(false)}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    );
  };

  // ============================================================================
  // 1. SALESMAN LOGIN SCREEN
  // ============================================================================
  if (!salesman) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-4 sm:p-6 select-none">
        {renderInstallModal()}
        <div className="max-w-md w-full mx-auto my-auto space-y-5">
          <div className="flex items-center justify-between gap-2">
            {!isStandalonePWA && onExitMobileMode ? (
              <button
                type="button"
                onClick={onExitMobileMode}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Main ERP Desktop
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800/60">
                <Smartphone className="w-3.5 h-3.5" />
                Standalone Salesman Booking PWA
              </span>
            )}

            {!isInstalledPWA && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 shadow-md cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Install Android App
              </button>
            )}
          </div>

          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    Offline-First PWA
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      isOnline
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                        : 'bg-amber-950 text-amber-300 border border-amber-700/50'
                    }`}
                  >
                    {isOnline ? 'Online' : 'Offline Ready'}
                  </span>
                </div>
                <h1 className="text-lg font-extrabold tracking-tight text-white mt-0.5">
                  ABRAR MEDICAL STORE
                </h1>
                <p className="text-xs text-slate-400">
                  Salesman Field Order Booking & Sync App
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
                  placeholder="Enter assigned username or code (e.g. SAL-001)"
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
                  placeholder="Enter assigned password"
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
                {loginLoading ? 'Signing in & Syncing...' : 'Sign In & Run Morning Sync'}
              </button>
            </form>

            <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Assigned Territory & Offline Queue</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallModal(true)}
                  className="text-emerald-400 hover:underline font-bold cursor-pointer"
                >
                  How to Install on Android?
                </button>
              </div>
              <p>
                Displays only your assigned Towns, Working Days, and Parties. Morning sync downloads items & prices for offline booking; evening finalization exports JSON/Excel and emails Super Admin ({superAdminEmail}).
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
  const draftCount = bookings.filter((b) => b.status === 'Saved on Mobile').length;
  const finalizedOrPendingCount = bookings.filter(
    (b) => b.status === 'Saved on Mobile' || b.status === 'Finalized' || b.status === 'Pending Upload'
  ).length;
  const submittedCount = bookings.filter(
    (b) => b.status === 'Submitted' || b.status === 'Received' || b.status === 'Imported' || b.status === 'Supply Generated'
  ).length;

  return (
    <div
      className={`${
        isStandalonePWA ? 'min-h-screen' : 'min-h-full rounded-2xl border border-slate-800'
      } bg-slate-950 text-slate-100 overflow-hidden shadow-xl flex flex-col`}
    >
      {renderInstallModal()}

      {/* Top Mobile Status Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {!isStandalonePWA && onExitMobileMode && (
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-white">{salesman.name}</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700">
                {salesman.salesman_code}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isTodayWorkingDay
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {currentDayName}: {isTodayWorkingDay ? 'Scheduled Working Day' : 'Off-Schedule Day'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
              <span>
                Assigned Towns: <strong className="text-slate-200">{towns.map((t) => t.town_name).join(', ') || 'All Assigned'}</strong>
              </span>
              {lastSyncedAt && <span>• Morning Sync: {lastSyncedAt}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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

          {!isInstalledPWA && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install PWA</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => syncCatalog(salesman.id, true)}
            disabled={syncing}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Sun className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Morning Sync'}</span>
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

      {/* Assigned Territory & Working Days Strip */}
      <div className="bg-slate-900/90 border-b border-slate-800/80 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400 font-bold flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            Working Days:
          </span>
          {ALL_WEEK_DAYS.map((day) => {
            const isAssigned = workingDays.some((d) => d.toLowerCase() === day.toLowerCase());
            const isToday = day.toLowerCase() === currentDayName.toLowerCase();
            return (
              <span
                key={day}
                className={`px-2 py-0.5 rounded font-semibold ${
                  isAssigned
                    ? isToday
                      ? 'bg-emerald-600 text-white font-extrabold ring-1 ring-emerald-300'
                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                    : 'bg-slate-900 text-slate-600 line-through'
                }`}
              >
                {day.slice(0, 3)}
              </span>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-slate-400">
          <span>
            Towns: <strong className="text-white">{towns.length}</strong>
          </span>
          <span>
            Assigned Parties: <strong className="text-white">{parties.length}</strong>
          </span>
          <span>
            Offline Items: <strong className="text-white">{items.length}</strong>
          </span>
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
          {editingBookingUuid ? 'Edit Party Booking' : 'New Party Booking'}
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
          <Moon className="w-3.5 h-3.5" />
          Evening Review & Finalize ({bookings.length})
          {finalizedOrPendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-amber-400 text-slate-950 text-[10px] font-extrabold">
              {finalizedOrPendingCount} Ready
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
          Deals ({offers.length}) & Party Discounts ({partyDiscounts.length})
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
                Assigned Town * ({towns.length})
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
                Assigned Area
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
                Assigned Party / Customer * ({availableParties.length} Available)
              </label>
              <select
                value={selectedPartyId}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  setSelectedPartyId(pid);
                  const found = parties.find((p) => p.id === pid);
                  const pTown = found?.town || found?.town_name || '';
                  const pArea = found?.area || found?.area_name || '';
                  if (found && !selectedTown && pTown) setSelectedTown(pTown);
                  if (found && !selectedArea && pArea) setSelectedArea(pArea);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              >
                <option value={0}>-- Select Assigned Party Account --</option>
                {availableParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.account_name} ({p.town || p.town_name || 'No Town'}
                    {p.area || p.area_name ? ` / ${p.area || p.area_name}` : ''}) — Bal: Rs.{' '}
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Offline Medicine Lookup & Automatic Offer / Party Discount Calculator
              </span>
              <span className="text-[11px] text-slate-400">
                Stacking Rule:{' '}
                <strong className="text-slate-200">
                  {stackingRule === 'combine_both' ? 'Combine Offer + Party' : 'Higher Discount Only'}
                </strong>
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
                        No items added yet. Search and add medicines above to create an offline party booking.
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
                        <td className="py-2 px-3 text-right font-mono">{ln.trade_price.toFixed(2)}</td>
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
                  Save Offline (Add Next Party)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const saved = handleSaveBookingOnMobile('Finalized');
                    if (saved) setMobileTab('saved-bookings');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4" />
                  Save & Finalize for Evening
                </button>

                <button
                  type="button"
                  disabled={sendingToAdmin}
                  onClick={() => handleSendBookingsToSuperAdmin(undefined, { downloadJson: true, downloadExcel: true })}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {sendingToAdmin ? 'Sending...' : 'FINALIZE, EXPORT & SEND TO SUPER ADMIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EVENING REVIEW, FINALIZATION, JSON/EXCEL EXPORT & SUPER ADMIN DISPATCH */}
      {mobileTab === 'saved-bookings' && (
        <div className="p-4 space-y-4 flex-1">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Moon className="w-4 h-4 text-amber-400" />
                  Evening Booking Review, Finalization & Export Center
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review your offline bookings, finalize them for the day, export structured JSON or Excel (.xlsx) files, and dispatch directly to Super Admin ({superAdminEmail}).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {draftCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleFinalizeBookings()}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCheck className="w-4 h-4" />
                    Finalize All Drafts ({draftCount})
                  </button>
                )}

                <button
                  type="button"
                  disabled={bookings.length === 0}
                  onClick={() => {
                    const target = bookings.filter((b) => b.status !== 'Submitted' && b.status !== 'Imported');
                    const listToExport = target.length > 0 ? target : bookings;
                    const fn = `AMS_Booking_${salesman.salesman_code}_${new Date().toISOString().slice(0, 10)}.json`;
                    downloadStructuredJsonFile(listToExport, fn);
                    setBanner({ type: 'success', message: `Exported structured JSON file: ${fn}` });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileJson className="w-4 h-4" />
                  Export JSON (.json)
                </button>

                <button
                  type="button"
                  disabled={bookings.length === 0}
                  onClick={() => {
                    const target = bookings.filter((b) => b.status !== 'Submitted' && b.status !== 'Imported');
                    const listToExport = target.length > 0 ? target : bookings;
                    const fn = `AMS_Booking_${salesman.salesman_code}_${new Date().toISOString().slice(0, 10)}.xlsx`;
                    downloadStructuredExcelFile(listToExport, fn);
                    setBanner({ type: 'success', message: `Exported structured Excel file: ${fn}` });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Export Excel (.xlsx)
                </button>

                <button
                  type="button"
                  disabled={sendingToAdmin || finalizedOrPendingCount === 0}
                  onClick={() =>
                    handleSendBookingsToSuperAdmin(
                      bookings.filter(
                        (b) =>
                          b.status === 'Saved on Mobile' ||
                          b.status === 'Finalized' ||
                          b.status === 'Pending Upload'
                      ),
                      { downloadJson: true, downloadExcel: true }
                    )
                  }
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {sendingToAdmin
                    ? 'Sending...'
                    : `SEND FINALIZED TO SUPER ADMIN (${finalizedOrPendingCount})`}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center text-xs">
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase text-slate-400 font-bold">Saved Offline Drafts</div>
                <div className="text-base font-extrabold text-amber-300 font-mono">{draftCount}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase text-slate-400 font-bold">Ready for Dispatch</div>
                <div className="text-base font-extrabold text-sky-300 font-mono">{finalizedOrPendingCount}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase text-slate-400 font-bold">Submitted to Admin</div>
                <div className="text-base font-extrabold text-emerald-400 font-mono">{submittedCount}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {bookings.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
                No saved bookings on this mobile device yet.
              </div>
            ) : (
              bookings.map((b) => {
                const isLocked =
                  b.status === 'Submitted' ||
                  b.status === 'Received' ||
                  b.status === 'Imported' ||
                  b.status === 'Supply Generated';
                return (
                  <div
                    key={b.booking_number}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-xs text-emerald-300">
                          {b.booking_number}
                        </span>
                        <span className="text-xs font-bold text-white">{b.party_name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {b.town_name}
                          {b.area_name ? ` / ${b.area_name}` : ''}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isLocked
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : b.status === 'Finalized'
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {b.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Date: {b.booking_date} • Items: {b.total_items} • Total Qty: {b.total_quantity} • Bonus:{' '}
                        {b.total_bonus} • Discount: Rs. {Number(b.discount_amount || 0).toFixed(2)} •{' '}
                        <strong className="text-emerald-300">
                          Net: Rs. {Number(b.net_amount || 0).toFixed(2)}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {!isLocked && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleEditSavedBooking(b)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Review / Edit
                          </button>

                          {b.status === 'Saved on Mobile' && (
                            <button
                              type="button"
                              onClick={() => handleFinalizeBookings([b.booking_number])}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                              Finalize
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleSendBookingsToSuperAdmin([b], { downloadJson: true, downloadExcel: false })
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Send to Admin
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteSavedBooking(b)}
                            className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 cursor-pointer"
                            title="Delete Draft Booking"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {isLocked && (
                        <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Submitted (Duplicate Locked)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
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
                      Scope: {o.scope_type}{' '}
                      {o.item_code ? `(${o.item_code})` : o.company_name ? `(${o.company_name})` : '(All Items)'} • Min
                      Qty: {o.min_quantity} • {o.discount_percent > 0 && `Disc: ${o.discount_percent}% `}
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
                      <span className="font-mono font-bold text-sky-300">{pd.discount_percent}% Off</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Applies to:{' '}
                      {pd.scope_type === 'item'
                        ? `Item ${pd.item_code}`
                        : pd.scope_type === 'company'
                        ? `Company ${pd.company_name}`
                        : 'All Items'}
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
