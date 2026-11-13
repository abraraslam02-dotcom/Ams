import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type UserPermissions = Record<string, any>;

export type NavTabId =
  | 'dashboard'
  // A. ITEM MANAGEMENT
  | 'items-master'
  | 'items'
  | 'item-categories'
  | 'item-groups'
  | 'item-search'
  | 'stock-datasheet'
  | 'stock-statement'
  | 'batch-expiry'
  | 'item-offers'
  | 'item-claims'
  | 'stock-adjustment'
  | 'item-ledger'
  | 'item-log'
  | 'item-import-export'
  // B. PARTY & ACCOUNTS
  | 'party-customers'
  | 'party-suppliers'
  | 'party-master'
  | 'accounts-master'
  | 'accounts'
  | 'account-groups'
  | 'coa-hierarchy'
  | 'party-ledger'
  | 'ledger-customer'
  | 'ledger-supplier'
  | 'aging-receivables'
  | 'aging-payables'
  | 'recovery-sheet'
  | 'supplier-payments'
  // C. SALES MANAGEMENT
  | 'sales-pos'
  | 'sales-new'
  | 'sales'
  | 'sales-return'
  | 'sale-returns'
  | 'sales-register'
  | 'sales-reports'
  | 'sales-customer-wise'
  | 'sales-salesman-wise'
  | 'sales-held'
  | 'sales-return-register'
  | 'deliveryman-master'
  | 'delivery-tracking'
  | 'staff-salesmen'
  | 'staff-deliverymen'
  | 'staff-deliveries'
  // D. PURCHASE MANAGEMENT
  | 'purchases-bill'
  | 'purchases'
  | 'purchases-return'
  | 'purchase-returns'
  | 'purchase-history'
  | 'purchase-reports'
  | 'purchase-supplier-report'
  // E. FINANCIAL MANAGEMENT
  | 'cash-book-unified'
  | 'cash-book-Daily'
  | 'bank-ledger'
  | 'ledger-bank'
  | 'financial-income'
  | 'expense-entry'
  | 'receipt-voucher'
  | 'payment-voucher'
  | 'profit-loss'
  | 'financial-reports'
  | 'trial-balance'
  | 'advance-management'
  | 'bank-receipt'
  | 'bank-payment'
  | 'journal-voucher'
  | 'contra-voucher'
  | 'voucher-crv'
  | 'voucher-cpv'
  | 'voucher-brv'
  | 'voucher-bpv'
  | 'voucher-jv'
  | 'voucher-cv'
  | 'payment-receive'
  | 'payment-customer-receipt'
  | 'payment-cash'
  | 'payment-bank'
  | 'general-ledger'
  | 'ledger-general'
  | 'cash-book'
  | 'ledger-cash'
  | 'account-statement'
  | 'ledger-statement'
  | 'balance-sheet'
  | 'fin-trial-balance'
  | 'fin-profit-loss'
  | 'fin-balance-sheet'
  | 'fin-cash-flow'
  | 'fin-day-book'
  | 'fin-account-summary'
  | 'fin-customer-outstanding'
  | 'fin-supplier-outstanding'
  | 'fin-expense-summary'
  | 'fin-income-summary'
  | 'fin-advance-tax-report'
  | 'tax-advance-accounting'
  | 'tax-settings'
  | 'tax-summary'
  | 'tax-invoice-history'
  | 'tax-history'
  // F. INVENTORY & WAREHOUSE
  | 'inventory-overview'
  | 'inventory'
  | 'stock-movement'
  | 'stock-transfer'
  | 'warehouses-master'
  | 'stock-valuation'
  | 'expiry-alerts'
  | 'low-stock'
  | 'near-expiry'
  | 'expired-items'
  | 'physical-verification'
  | 'inv-overview'
  | 'inv-current'
  | 'inv-stock-statement'
  | 'inv-detailed-stock'
  | 'inv-datasheet'
  | 'inv-expiry'
  | 'inv-near-expiry'
  | 'inv-expired'
  | 'inv-low-stock'
  | 'inv-adjustment'
  | 'inv-transfer'
  | 'inv-ledger'
  | 'inv-verification'
  // G. REPORTS & ANALYTICS
  | 'top-performance-reports'
  | 'report-item-reports'
  | 'detailed-stock-report'
  | 'sales-item-wise'
  | 'report-item-purchases'
  | 'sales-profit-report'
  | 'report-quarterly'
  | 'report-account-profit'
  | 'sales-daily-summary'
  | 'report-purchase-analysis'
  | 'sales-discount-report'
  | 'sales-return-report'
  | 'report-daily-sales'
  | 'report-monthly-sales'
  | 'report-item-sales'
  | 'report-customer-sales'
  | 'report-profit'
  | 'report-discount'
  | 'report-sales-return'
  // H. SYSTEM & SETTINGS
  | 'company-settings'
  | 'system-settings'
  | 'more-options'
  | 'printer-setup'
  | 'backup-restore'
  | 'data-import-export'
  | 'database'
  | 'audit-logs'
  | 'users'
  | 'users-manage'
  | 'system-info'
  | 'system-admin'
  // I. SUPPLY & DISTRIBUTION MANAGEMENT SYSTEM
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
  | 'supply-reports'
  | 'mobile-booking-app'
  | 'trade-deals-offers'
  | 'party-special-discounts'
  | 'fifo-batch-control'
  | 'offer-discount-reports'
  | 'master-reset';

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  permissions?: UserPermissions | null;
  roleName?: string;
  databaseConnected?: boolean;
  totalTables?: number;
  hasUnsavedInvoiceItems?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Icon set (24x24 outline icons, no extra dependency needed)         */
/* ------------------------------------------------------------------ */

const ICONS = {
  // module icons
  dashboard: ['M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z'],
  box: ['M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'],
  users: ['M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z'],
  cart: ['M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'],
  bag: ['M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z'],
  coins: ['M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  warehouse: ['M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10'],
  chart: ['M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'],
  settings: [
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  // item / page icons
  tag: ['M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
  search: ['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'],
  clock: ['M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'],
  doc: ['M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
  clipboard: ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'],
  checkClipboard: ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'],
  refresh: ['M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'],
  truck: ['M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0'],
  alert: ['M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'],
  lock: ['M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'],
  database: ['M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4'],
  printer: ['M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z'],
  swap: ['M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'],
  cash: ['M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z'],
  bank: ['M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z'],
  scale: ['M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3'],
  trendUp: ['M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'],
  trendDown: ['M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6'],
  shield: ['M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'],
  user: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
  info: ['M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  percent: ['M9 14l6-6M9.5 8.5h.01M14.5 13.5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  book: ['M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'],
  gift: ['M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7'],
  ban: ['M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'],
  pause: ['M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z'],
  pos: ['M9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z'],
  pencil: ['M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z'],
  // interface icons
  star: ['M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z'],
  chevron: ['M9 5l7 7-7 7'],
  chevronsLeft: ['M11 19l-7-7 7-7m8 14l-7-7 7-7'],
  chevronsRight: ['M13 5l7 7-7 7M5 5l7 7-7 7'],
  plus: ['M12 4v16m8-8H4'],
  x: ['M6 18L18 6M6 6l12 12'],
} as const;

type IconName = keyof typeof ICONS;

const Icon: React.FC<{ name: IconName; className?: string; filled?: boolean }> = ({
  name,
  className = 'w-[18px] h-[18px]',
  filled = false,
}) => (
  <svg
    className={className}
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    {ICONS[name].map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

/* Each module gets its own colour so people learn where things live. */
interface Accent {
  tile: string; // icon tile (resting)
  tileActive: string; // icon tile (module contains the open page)
  text: string; // coloured text / icon
  bar: string; // active indicator bar
}

const ACCENTS: Record<string, Accent> = {
  dashboard: { tile: 'bg-indigo-500/10 text-indigo-300', tileActive: 'bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/40', text: 'text-indigo-300', bar: 'bg-indigo-400' },
  'group-item-management': { tile: 'bg-sky-500/10 text-sky-300', tileActive: 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/40', text: 'text-sky-300', bar: 'bg-sky-400' },
  'group-party-accounts': { tile: 'bg-violet-500/10 text-violet-300', tileActive: 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/40', text: 'text-violet-300', bar: 'bg-violet-400' },
  'group-sales-management': { tile: 'bg-emerald-500/10 text-emerald-300', tileActive: 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40', text: 'text-emerald-300', bar: 'bg-emerald-400' },
  'group-supply-distribution': { tile: 'bg-teal-500/10 text-teal-300', tileActive: 'bg-teal-500/25 text-teal-200 ring-1 ring-teal-400/40', text: 'text-teal-300', bar: 'bg-teal-400' },
  'group-purchase-management': { tile: 'bg-amber-500/10 text-amber-300', tileActive: 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40', text: 'text-amber-300', bar: 'bg-amber-400' },
  'group-financial-management': { tile: 'bg-cyan-500/10 text-cyan-300', tileActive: 'bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-400/40', text: 'text-cyan-300', bar: 'bg-cyan-400' },
  'group-inventory-warehouse': { tile: 'bg-orange-500/10 text-orange-300', tileActive: 'bg-orange-500/25 text-orange-200 ring-1 ring-orange-400/40', text: 'text-orange-300', bar: 'bg-orange-400' },
  'group-reports-analytics': { tile: 'bg-pink-500/10 text-pink-300', tileActive: 'bg-pink-500/25 text-pink-200 ring-1 ring-pink-400/40', text: 'text-pink-300', bar: 'bg-pink-400' },
  'group-system-settings': { tile: 'bg-slate-500/15 text-slate-300', tileActive: 'bg-slate-400/25 text-slate-100 ring-1 ring-slate-400/40', text: 'text-slate-200', bar: 'bg-slate-300' },
};

const FALLBACK_ACCENT: Accent = ACCENTS['group-sales-management'];

/* One small icon per page, so every menu row is recognisable at a glance. */
const LEAF_ICON: Partial<Record<NavTabId, IconName>> = {
  'items-master': 'box',
  'item-categories': 'tag',
  'item-groups': 'layers',
  'item-search': 'search',
  'stock-datasheet': 'clipboard',
  'stock-statement': 'doc',
  'batch-expiry': 'clock',
  'item-offers': 'gift',
  'item-claims': 'alert',
  'stock-adjustment': 'pencil',
  'item-ledger': 'book',
  'item-log': 'doc',
  'item-import-export': 'swap',
  'party-customers': 'users',
  'party-suppliers': 'truck',
  'party-master': 'user',
  'accounts-master': 'bank',
  'account-groups': 'layers',
  'party-ledger': 'book',
  'aging-receivables': 'trendUp',
  'aging-payables': 'trendDown',
  'recovery-sheet': 'cash',
  'supplier-payments': 'coins',
  'staff-salesmen': 'users',
  'sales-pos': 'pos',
  'sales-return': 'refresh',
  'sales-register': 'doc',
  'sales-reports': 'chart',
  'sales-customer-wise': 'users',
  'sales-salesman-wise': 'user',
  'sales-held': 'pause',
  'sales-return-register': 'clipboard',
  'deliveryman-master': 'user',
  'delivery-tracking': 'truck',
  'supply-dashboard': 'truck',
  'supply-salesmen': 'users',
  'supply-towns': 'layers',
  'supply-order-forms': 'clipboard',
  'supply-bookings': 'book',
  'supply-import-bookings': 'swap',
  'supply-creation': 'truck',
  'supply-packing': 'checkClipboard',
  'supply-dispatch': 'truck',
  'supply-returns': 'refresh',
  'supply-billing': 'doc',
  'supply-recovery': 'cash',
  'supply-settlement': 'scale',
  'supply-reports': 'chart',
  'mobile-booking-app': 'pos',
  'trade-deals-offers': 'gift',
  'party-special-discounts': 'percent',
  'fifo-batch-control': 'clock',
  'offer-discount-reports': 'chart',
  'master-reset': 'lock',
  'purchases-bill': 'doc',
  'purchases-return': 'refresh',
  'purchase-history': 'clock',
  'purchase-reports': 'chart',
  'purchase-supplier-report': 'truck',
  'cash-book-unified': 'cash',
  'bank-ledger': 'bank',
  'financial-income': 'trendUp',
  'expense-entry': 'trendDown',
  'receipt-voucher': 'doc',
  'payment-voucher': 'doc',
  'profit-loss': 'scale',
  'financial-reports': 'chart',
  'trial-balance': 'scale',
  'advance-management': 'coins',
  'bank-receipt': 'bank',
  'bank-payment': 'bank',
  'journal-voucher': 'book',
  'contra-voucher': 'swap',
  'general-ledger': 'book',
  'cash-book': 'cash',
  'account-statement': 'doc',
  'balance-sheet': 'scale',
  'tax-settings': 'percent',
  'tax-summary': 'percent',
  'tax-invoice-history': 'clock',
  'inventory-overview': 'layers',
  'stock-movement': 'swap',
  'stock-transfer': 'swap',
  'warehouses-master': 'warehouse',
  'stock-valuation': 'coins',
  'expiry-alerts': 'clock',
  'low-stock': 'trendDown',
  'near-expiry': 'alert',
  'expired-items': 'ban',
  'physical-verification': 'checkClipboard',
  'top-performance-reports': 'trendUp',
  'report-item-reports': 'box',
  'detailed-stock-report': 'clipboard',
  'sales-item-wise': 'box',
  'report-item-purchases': 'bag',
  'sales-profit-report': 'trendUp',
  'report-quarterly': 'chart',
  'report-account-profit': 'scale',
  'sales-daily-summary': 'chart',
  'report-purchase-analysis': 'chart',
  'sales-discount-report': 'percent',
  'sales-return-report': 'refresh',
  'company-settings': 'settings',
  'more-options': 'settings',
  'printer-setup': 'printer',
  'backup-restore': 'database',
  'data-import-export': 'swap',
  database: 'database',
  'audit-logs': 'doc',
  users: 'users',
  'users-manage': 'users',
  'system-info': 'info',
};

interface MenuLeaf {
  id: NavTabId;
  label: string;
  badge?: string;
  canSee?: (p: UserPermissions, isAdmin: boolean) => boolean;
}

interface MenuNode {
  id: string;
  code: string;
  label: string;
  icon: IconName;
  tabId?: NavTabId;
  children?: MenuLeaf[];
  canSee?: (p: UserPermissions, isAdmin: boolean) => boolean;
}

const MENU: MenuNode[] = [
  {
    id: 'dashboard',
    code: '00',
    label: 'Dashboard Overview',
    tabId: 'dashboard',
    canSee: (p) => p.dashboard?.view !== false,
    icon: 'dashboard',
  },
  {
    id: 'group-item-management',
    code: 'A',
    label: 'Item Management',
    canSee: (p) => p.items?.view !== false || p.inventory?.view !== false,
    icon: 'box',
    children: [
      { id: 'items-master', label: 'Item Master', canSee: (p) => p.items?.view !== false },
      { id: 'item-categories', label: 'Item Categories', canSee: (p) => p.items?.view !== false },
      { id: 'item-groups', label: 'Item Groups', canSee: (p) => p.items?.view !== false },
      { id: 'item-search', label: 'Item Search', canSee: (p) => p.items?.view !== false },
      { id: 'stock-datasheet', label: 'Item Stock', canSee: (p) => p.inventory?.view !== false },
      { id: 'stock-statement', label: 'Company Stock Statement', canSee: (p) => p.inventory?.view !== false },
      { id: 'batch-expiry', label: 'Batch & Expiry', canSee: (p) => p.inventory?.view !== false },
      { id: 'fifo-batch-control', label: 'Batch-Wise FIFO Queue', badge: 'FIFO', canSee: (p) => p.inventory?.view !== false },
      { id: 'item-offers', label: 'Trade Deals & Offers', badge: 'Deals', canSee: (p) => p.items?.view !== false },
      { id: 'item-claims', label: 'Item Claims', canSee: (p) => p.items?.view !== false },
      { id: 'stock-adjustment', label: 'Stock Adjustment', canSee: (p) => p.inventory?.adjust !== false },
      { id: 'item-ledger', label: 'Item Ledger', canSee: (p) => p.inventory?.view !== false },
      { id: 'item-log', label: 'Item Log', canSee: (p) => p.items?.view !== false },
      { id: 'item-import-export', label: 'Item Import / Export', canSee: (p) => p.items?.view !== false },
    ],
  },
  {
    id: 'group-party-accounts',
    code: 'B',
    label: 'Party & Accounts',
    canSee: (p) => p.accounts?.view !== false,
    icon: 'users',
    children: [
      { id: 'party-customers', label: 'Customer Management' },
      { id: 'party-suppliers', label: 'Supplier Management' },
      { id: 'party-master', label: 'Party Master' },
      { id: 'party-special-discounts', label: 'Party Special Discounts', badge: 'Disc %' },
      { id: 'accounts-master', label: 'Account Management' },
      { id: 'account-groups', label: 'Account Groups' },
      { id: 'party-ledger', label: 'Party Ledger' },
      { id: 'aging-receivables', label: 'Customer Outstanding' },
      { id: 'aging-payables', label: 'Supplier Outstanding' },
      { id: 'recovery-sheet', label: 'Customer Recovery' },
      { id: 'supplier-payments', label: 'Supplier Payments' },
      { id: 'staff-salesmen', label: 'Salesman Management' },
    ],
  },
  {
    id: 'group-sales-management',
    code: 'C',
    label: 'Sales Management',
    canSee: (p) => p.sales?.view !== false,
    icon: 'cart',
    children: [
      { id: 'sales-pos', label: 'Sales Invoice', badge: 'POS' },
      { id: 'sales-return', label: 'Sales Return' },
      { id: 'sales-register', label: 'Sales History' },
      { id: 'sales-reports', label: 'Sales Reports' },
      { id: 'sales-customer-wise', label: 'Customer Sales Report' },
      { id: 'sales-salesman-wise', label: 'Salesman Sales Report' },
      { id: 'sales-held', label: 'Held / Draft Invoices' },
      { id: 'sales-return-register', label: 'Sales Return Register' },
      { id: 'deliveryman-master', label: 'Deliveryman Directory' },
      { id: 'delivery-tracking', label: 'Delivery Dispatch' },
    ],
  },
  {
    id: 'group-supply-distribution',
    code: 'S',
    label: 'Supply & Distribution',
    canSee: (p) => p.sales?.view !== false || p.supply_booking?.view !== false,
    icon: 'truck',
    children: [
      { id: 'supply-dashboard', label: 'Supply Dashboard', badge: 'ERP' },
      { id: 'supply-salesmen', label: 'Salesman Management' },
      { id: 'mobile-booking-app', label: 'Salesman Mobile Booking App', badge: 'PWA' },
      { id: 'supply-import-bookings', label: 'Import Salesman Bookings', badge: 'JSON' },
      { id: 'supply-towns', label: 'Town / Area / Party' },
      { id: 'supply-order-forms', label: 'Order Form (1/2/3 Col)' },
      { id: 'supply-bookings', label: 'Order Booking' },
      { id: 'supply-creation', label: 'Town-Wise Supply' },
      { id: 'supply-packing', label: 'Packing Management' },
      { id: 'supply-dispatch', label: 'Dispatch / Delivery' },
      { id: 'supply-returns', label: 'Salesman Return' },
      { id: 'supply-billing', label: 'Final Billing / Invoice' },
      { id: 'supply-recovery', label: 'Recovery & 3 Reports' },
      { id: 'supply-settlement', label: 'Salesman Settlement' },
      { id: 'supply-reports', label: 'Distribution Reports (38)' },
    ],
  },
  {
    id: 'group-purchase-management',
    code: 'D',
    label: 'Purchase Management',
    canSee: (p) => p.purchases?.view !== false,
    icon: 'bag',
    children: [
      { id: 'purchases-bill', label: 'Purchase Invoice' },
      { id: 'purchases-return', label: 'Purchase Return' },
      { id: 'purchase-history', label: 'Purchase History' },
      { id: 'purchase-reports', label: 'Purchase Reports' },
      { id: 'purchase-supplier-report', label: 'Supplier Purchase Report' },
    ],
  },
  {
    id: 'group-financial-management',
    code: 'E',
    label: 'Financial Management',
    canSee: (p) => p.accounts?.view !== false || p.reports?.financial !== false,
    icon: 'coins',
    children: [
      { id: 'cash-book-unified', label: 'Cash Book', badge: 'LIVE' },
      { id: 'bank-ledger', label: 'Bank Book' },
      { id: 'financial-income', label: 'Income' },
      { id: 'expense-entry', label: 'Expenses' },
      { id: 'receipt-voucher', label: 'Receipts (CRV)' },
      { id: 'payment-voucher', label: 'Payments (CPV)' },
      { id: 'profit-loss', label: 'Profit & Loss' },
      { id: 'financial-reports', label: 'Financial Reports' },
      { id: 'trial-balance', label: 'Account Balances' },
      { id: 'advance-management', label: 'Advance Management' },
      { id: 'bank-receipt', label: 'Bank Receipt (BRV)' },
      { id: 'bank-payment', label: 'Bank Payment (BPV)' },
      { id: 'journal-voucher', label: 'Journal Voucher (JV)' },
      { id: 'contra-voucher', label: 'Contra Transfer (CV)' },
      { id: 'general-ledger', label: 'General Ledger' },
      { id: 'cash-book', label: 'Cash Drawer Ledger' },
      { id: 'account-statement', label: 'Account Statement' },
      { id: 'balance-sheet', label: 'Balance Sheet' },
      { id: 'tax-settings', label: 'Tax Settings' },
      { id: 'tax-summary', label: 'Tax Summary' },
      { id: 'tax-invoice-history', label: 'Invoice Tax History' },
    ],
  },
  {
    id: 'group-inventory-warehouse',
    code: 'F',
    label: 'Inventory & Warehouse',
    canSee: (p) => p.inventory?.view !== false,
    icon: 'warehouse',
    children: [
      { id: 'inventory-overview', label: 'Stock Overview' },
      { id: 'stock-movement', label: 'Stock Movement' },
      { id: 'stock-transfer', label: 'Stock Transfer', canSee: (p) => p.inventory?.transfer !== false },
      { id: 'warehouses-master', label: 'Warehouse Management' },
      { id: 'stock-valuation', label: 'Stock Valuation' },
      { id: 'expiry-alerts', label: 'Expiry Reports' },
      { id: 'low-stock', label: 'Low Stock Reports' },
      { id: 'near-expiry', label: 'Near Expiry (30/60/90d)' },
      { id: 'expired-items', label: 'Expired Items' },
      { id: 'physical-verification', label: 'Physical Verification' },
    ],
  },
  {
    id: 'group-reports-analytics',
    code: 'G',
    label: 'Reports & Analytics',
    canSee: (p) => p.reports?.sales !== false || p.reports?.financial !== false || p.sales?.view !== false,
    icon: 'chart',
    children: [
      { id: 'top-performance-reports', label: 'Top Performance & Overall Reports', badge: 'TOP' },
      { id: 'report-item-reports', label: 'Detailed Item Stock Report' },
      { id: 'sales-item-wise', label: 'Item Sales Reports' },
      { id: 'report-item-purchases', label: 'Item Purchase Reports' },
      { id: 'sales-profit-report', label: 'Item Profit Reports' },
      { id: 'report-quarterly', label: 'Item Full Quarterly Report' },
      { id: 'report-account-profit', label: 'Account Profit Reports' },
      { id: 'sales-daily-summary', label: 'Sales Analysis' },
      { id: 'report-purchase-analysis', label: 'Purchase Analysis' },
      { id: 'sales-discount-report', label: 'Discount Report' },
      { id: 'offer-discount-reports', label: 'Offer & Party Discount Reports (11)', badge: '11' },
      { id: 'sales-return-report', label: 'Sales Return Report' },
    ],
  },
  {
    id: 'group-system-settings',
    code: 'H',
    label: 'System & Settings',
    canSee: (p, isAdmin) =>
      isAdmin || p.users?.view === true || p.settings?.view !== false || p.system?.view === true,
    icon: 'settings',
    children: [
      { id: 'company-settings', label: 'Company Settings', canSee: (_p, _isAdmin) => true },
      { id: 'more-options', label: 'More Options', badge: 'Sales', canSee: (_p, isAdmin) => isAdmin },
      { id: 'printer-setup', label: 'Printer Settings', canSee: (_p, _isAdmin) => true },
      { id: 'backup-restore', label: 'Local Backup & Restore', badge: '.db', canSee: (_p, _isAdmin) => true },
      { id: 'master-reset', label: 'Master Reset (Option A & B)', badge: 'Reset', canSee: (_p, isAdmin) => isAdmin },
      { id: 'data-import-export', label: 'Data Import / Export', canSee: (_p, _isAdmin) => true },
      { id: 'database', label: 'Database Status', canSee: (_p, _isAdmin) => true },
      { id: 'audit-logs', label: 'System Logs', canSee: (_p, isAdmin) => isAdmin },
      { id: 'users', label: 'User Management', badge: 'Admin', canSee: (_p, isAdmin) => isAdmin },
      { id: 'system-info', label: 'System Info', canSee: (_p, _isAdmin) => true },
    ],
  },
];

const LEGACY_TAB_MAP: Partial<Record<NavTabId, NavTabId>> = {
  'cash-book-Daily': 'cash-book-unified',
  items: 'items-master',
  accounts: 'accounts-master',
  'coa-hierarchy': 'account-groups',
  'ledger-customer': 'party-ledger',
  'ledger-supplier': 'party-ledger',
  'ledger-bank': 'bank-ledger',
  'ledger-general': 'general-ledger',
  'ledger-cash': 'cash-book',
  'ledger-statement': 'account-statement',
  'sales-new': 'sales-pos',
  sales: 'sales-pos',
  'sale-returns': 'sales-return',
  'staff-deliverymen': 'deliveryman-master',
  'staff-deliveries': 'delivery-tracking',
  purchases: 'purchases-bill',
  'purchase-returns': 'purchases-return',
  'voucher-crv': 'receipt-voucher',
  'voucher-cpv': 'payment-voucher',
  'voucher-brv': 'bank-receipt',
  'voucher-bpv': 'bank-payment',
  'voucher-jv': 'journal-voucher',
  'voucher-cv': 'contra-voucher',
  'payment-receive': 'receipt-voucher',
  'payment-customer-receipt': 'recovery-sheet',
  'payment-cash': 'payment-voucher',
  'payment-bank': 'bank-payment',
  'fin-trial-balance': 'trial-balance',
  'fin-profit-loss': 'profit-loss',
  'fin-balance-sheet': 'balance-sheet',
  'fin-customer-outstanding': 'aging-receivables',
  'fin-supplier-outstanding': 'aging-payables',
  'fin-expense-summary': 'expense-entry',
  'fin-income-summary': 'financial-income',
  'tax-advance-accounting': 'advance-management',
  'tax-history': 'tax-invoice-history',
  inventory: 'batch-expiry',
  'inv-overview': 'inventory-overview',
  'inv-current': 'stock-datasheet',
  'inv-stock-statement': 'stock-statement',
  'inv-detailed-stock': 'report-item-reports',
  'detailed-stock-report': 'report-item-reports',
  'inv-datasheet': 'batch-expiry',
  'inv-expiry': 'expiry-alerts',
  'inv-near-expiry': 'near-expiry',
  'inv-expired': 'expired-items',
  'inv-low-stock': 'low-stock',
  'inv-adjustment': 'stock-adjustment',
  'inv-transfer': 'stock-transfer',
  'inv-ledger': 'item-ledger',
  'inv-verification': 'physical-verification',
  'report-daily-sales': 'sales-daily-summary',
  'report-monthly-sales': 'sales-reports',
  'report-item-sales': 'sales-item-wise',
  'report-customer-sales': 'sales-customer-wise',
  'report-profit': 'sales-profit-report',
  'report-discount': 'sales-discount-report',
  'report-sales-return': 'sales-return-report',
  'system-settings': 'company-settings',
  'system-admin': 'database',
};

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'sidebar.v2';

interface Prefs {
  collapsed: boolean;
  pinned: NavTabId[];
  recent: NavTabId[];
}

const readPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        collapsed: !!p.collapsed,
        pinned: Array.isArray(p.pinned) ? p.pinned : [],
        recent: Array.isArray(p.recent) ? p.recent : [],
      };
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return { collapsed: false, pinned: [], recent: [] };
};

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-emerald-400/25 text-emerald-100 rounded-sm px-0.5">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
};

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-0';

/* One page link, with a pin (star) button. */
interface LeafRowProps {
  leaf: MenuLeaf;
  accent: Accent;
  active: boolean;
  pinned: boolean;
  query?: string;
  tabbable?: boolean;
  warn?: boolean;
  dataAttr: 'data-leaf-id' | 'data-quick-id';
  onSelect: (id: NavTabId) => void;
  onTogglePin: (id: NavTabId) => void;
}

const LeafRow: React.FC<LeafRowProps> = ({
  leaf,
  accent,
  active,
  pinned,
  query = '',
  tabbable = true,
  warn = false,
  dataAttr,
  onSelect,
  onTogglePin,
}) => {
  const icon: IconName = LEAF_ICON[leaf.id] ?? 'doc';
  return (
    <div className="group relative flex items-center" {...{ [dataAttr]: leaf.id }}>
      {active && (
        <span
          aria-hidden="true"
          className={`absolute -left-px top-1.5 bottom-1.5 w-[3px] rounded-full ${accent.bar}`}
        />
      )}
      <button
        type="button"
        data-nav-item
        tabIndex={tabbable ? 0 : -1}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(leaf.id)}
        title={leaf.label}
        className={`flex-1 min-w-0 flex items-center gap-2.5 pl-3.5 pr-2 py-2 rounded-lg text-[13px] text-left transition-colors ${FOCUS_RING} ${
          active
            ? 'bg-white/[0.08] text-white font-medium'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
        }`}
      >
        <Icon
          name={icon}
          className={`w-4 h-4 shrink-0 transition-colors ${
            active ? accent.text : 'text-slate-500 group-hover:text-slate-300'
          }`}
        />
        <span className="truncate">
          <Highlight text={leaf.label} query={query} />
        </span>
        {warn && (
          <span
            title="Invoice has unsaved items"
            className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse motion-reduce:animate-none"
          />
        )}
        {leaf.badge && (
          <span
            className={`${warn ? '' : 'ml-auto'} text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
              active ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {leaf.badge}
          </span>
        )}
      </button>
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${leaf.label}` : `Pin ${leaf.label} to the top`}
        title={pinned ? 'Unpin' : 'Pin to top'}
        onClick={() => onTogglePin(leaf.id)}
        className={`mx-0.5 p-1.5 rounded-md shrink-0 transition ${FOCUS_RING} ${
          pinned
            ? 'text-amber-300 opacity-100'
            : 'text-slate-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-amber-300'
        }`}
      >
        <Icon name="star" filled={pinned} className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  permissions,
  roleName,
  databaseConnected,
  totalTables,
  hasUnsavedInvoiceItems,
}) => {
  const isAdmin = roleName === 'Admin' || roleName === 'Administrator' || roleName === 'Super Admin';
  const normalizedActiveTab: NavTabId = LEGACY_TAB_MAP[activeTab] || activeTab;

  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const { collapsed, pinned, recent } = prefs;
  const [menuSearch, setMenuSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const searchLower = menuSearch.trim().toLowerCase();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage full or blocked: the sidebar still works */
    }
  }, [prefs]);

  const setCollapsed = (v: boolean) => setPrefs((p) => ({ ...p, collapsed: v }));

  /* ---- what this user is allowed to see ---- */
  const permittedMenu = useMemo<MenuNode[]>(
    () =>
      MENU.filter((node) => {
        if (!permissions) return true;
        return node.canSee ? node.canSee(permissions, isAdmin) : true;
      })
        .map((node) => {
          if (!node.children) return node;
          return {
            ...node,
            children: node.children.filter(
              (leaf) => !permissions || !leaf.canSee || leaf.canSee(permissions, isAdmin)
            ),
          };
        })
        .filter((node) => !node.children || node.children.length > 0),
    [permissions, isAdmin]
  );

  const leafIndex = useMemo(() => {
    const map = new Map<NavTabId, { leaf: MenuLeaf; node: MenuNode }>();
    permittedMenu.forEach((node) => node.children?.forEach((leaf) => map.set(leaf.id, { leaf, node })));
    return map;
  }, [permittedMenu]);

  /* ---- search filter ---- */
  const visibleMenu = useMemo<MenuNode[]>(() => {
    if (!searchLower) return permittedMenu;
    return permittedMenu
      .map((node) => {
        if (!node.children) return node;
        const groupHit = node.label.toLowerCase().includes(searchLower);
        return {
          ...node,
          children: node.children.filter(
            (leaf) => groupHit || leaf.label.toLowerCase().includes(searchLower)
          ),
        };
      })
      .filter((node) =>
        node.tabId ? node.label.toLowerCase().includes(searchLower) : (node.children?.length || 0) > 0
      );
  }, [permittedMenu, searchLower]);

  const moduleCount = permittedMenu.filter((n) => n.children).length;
  const canSell = leafIndex.has('sales-pos');

  /* ---- open / close groups ---- */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const node of MENU) {
      if (node.children) {
        const hasActiveChild = node.children.some((c) => c.id === normalizedActiveTab);
        initial[node.id] = hasActiveChild || node.id === 'group-sales-management';
      }
    }
    return initial;
  });

  useEffect(() => {
    for (const node of MENU) {
      if (node.children?.some((c) => c.id === normalizedActiveTab)) {
        setOpenGroups((prev) => (prev[node.id] ? prev : { ...prev, [node.id]: true }));
      }
    }
  }, [normalizedActiveTab]);

  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  const expandAll = () => {
    const next: Record<string, boolean> = {};
    MENU.forEach((n) => {
      if (n.children) next[n.id] = true;
    });
    setOpenGroups(next);
  };
  const collapseAll = () => setOpenGroups({});

  /* ---- recent pages & pins ---- */
  useEffect(() => {
    if (!leafIndex.has(normalizedActiveTab)) return;
    setPrefs((p) =>
      p.recent[0] === normalizedActiveTab
        ? p
        : { ...p, recent: [normalizedActiveTab, ...p.recent.filter((x) => x !== normalizedActiveTab)].slice(0, 4) }
    );
  }, [normalizedActiveTab, leafIndex]);

  const togglePin = useCallback((id: NavTabId) => {
    setPrefs((p) => ({
      ...p,
      pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
    }));
  }, []);

  /* keep the open page visible inside the scroll area */
  useEffect(() => {
    const t = window.setTimeout(() => {
      navRef.current
        ?.querySelector(`[data-leaf-id="${normalizedActiveTab}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, 230);
    return () => window.clearTimeout(t);
  }, [normalizedActiveTab]);

  /* ---- keyboard: Ctrl/Cmd+K or "/" jumps to search ---- */
  const focusSearch = useCallback(() => {
    setPrefs((p) => (p.collapsed ? { ...p, collapsed: false } : p));
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 40);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        focusSearch();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (menuSearch) setMenuSearch('');
      else searchRef.current?.blur();
    } else if (e.key === 'Enter') {
      const first = visibleMenu.find((n) => n.tabId || (n.children && n.children.length > 0));
      const target = first?.tabId ?? first?.children?.[0]?.id;
      if (target) {
        onSelectTab(target);
        setMenuSearch('');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navRef.current?.querySelector<HTMLElement>('[data-nav-item]:not([tabindex="-1"])')?.focus();
    }
  };

  const onNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const items = Array.from(
      navRef.current?.querySelectorAll<HTMLElement>('[data-nav-item]:not([tabindex="-1"])') ?? []
    );
    const active = document.activeElement as HTMLElement | null;
    const i = active ? items.indexOf(active) : -1;
    if (i < 0) return;
    const gid = active?.dataset.groupId;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[Math.min(i + 1, items.length - 1)]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (i === 0) searchRef.current?.focus();
        else items[i - 1]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'ArrowRight':
        if (gid && !openGroups[gid]) {
          e.preventDefault();
          setOpenGroups((p) => ({ ...p, [gid]: true }));
        }
        break;
      case 'ArrowLeft':
        if (gid && openGroups[gid]) {
          e.preventDefault();
          setOpenGroups((p) => ({ ...p, [gid]: false }));
        }
        break;
    }
  };

  const openFromRail = (id: string) => {
    setCollapsed(false);
    setOpenGroups((p) => ({ ...p, [id]: true }));
  };

  /* ---- pinned & recent lists (hidden while searching) ---- */
  const pinnedRows = pinned.map((id) => leafIndex.get(id)).filter(Boolean) as { leaf: MenuLeaf; node: MenuNode }[];
  const recentRows = recent
    .filter((id) => !pinned.includes(id) && id !== normalizedActiveTab)
    .map((id) => leafIndex.get(id))
    .filter(Boolean)
    .slice(0, 3) as { leaf: MenuLeaf; node: MenuNode }[];

  const dbText =
    databaseConnected === undefined ? '' : databaseConnected ? 'Database connected' : 'Database offline';
  const dbTitle = [dbText, typeof totalTables === 'number' ? `${totalTables} tables` : '']
    .filter(Boolean)
    .join(' - ');

  const brandMark = (
    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-900/40 shrink-0">
      <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
        <path
          d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"
          fill="white"
          stroke="white"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );

  /* ================================================================ */
  /*  Collapsed rail                                                   */
  /* ================================================================ */
  if (collapsed) {
    return (
      <aside
        aria-label="Main navigation"
        className="w-[68px] bg-slate-900 text-slate-300 flex flex-col items-center border-r border-slate-800 shrink-0 select-none"
      >
        <div className="py-3.5 border-b border-slate-800 w-full flex justify-center bg-slate-950/40">{brandMark}</div>

        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Open sidebar"
          aria-label="Open sidebar"
          className={`mt-2 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors ${FOCUS_RING}`}
        >
          <Icon name="chevronsRight" />
        </button>

        <nav
          ref={navRef}
          onKeyDown={onNavKeyDown}
          className="flex-1 w-full px-2 py-2 space-y-1.5 overflow-y-auto [scrollbar-width:none]"
        >
          <button
            type="button"
            data-nav-item
            onClick={focusSearch}
            title={`Search menu (${isMac ? 'Cmd' : 'Ctrl'}+K)`}
            aria-label="Search menu"
            className={`w-full h-11 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors ${FOCUS_RING}`}
          >
            <Icon name="search" />
          </button>
          {permittedMenu.map((node) => {
            const accent = ACCENTS[node.id] ?? FALLBACK_ACCENT;
            const isActive = node.tabId
              ? normalizedActiveTab === node.tabId
              : (node.children?.some((c) => c.id === normalizedActiveTab) ?? false);
            return (
              <button
                key={node.id}
                type="button"
                data-nav-item
                aria-label={node.label}
                aria-current={isActive ? 'page' : undefined}
                title={node.label}
                onClick={() => (node.tabId ? onSelectTab(node.tabId) : openFromRail(node.id))}
                className={`w-full h-11 rounded-xl flex items-center justify-center transition-colors ${FOCUS_RING} ${
                  isActive ? accent.tileActive : `${accent.tile} hover:brightness-125`
                }`}
              >
                <Icon name={node.icon} className="w-5 h-5" />
              </button>
            );
          })}
        </nav>

        <div className="w-full py-3 border-t border-slate-800 bg-slate-950/60 flex justify-center">
          <div
            title={[roleName, dbTitle].filter(Boolean).join(' - ')}
            className="relative w-9 h-9 rounded-full bg-slate-700 text-slate-100 text-sm font-semibold flex items-center justify-center"
          >
            {(roleName || 'U').charAt(0).toUpperCase()}
            {databaseConnected !== undefined && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-slate-950 ${
                  databaseConnected ? 'bg-emerald-400' : 'bg-red-500'
                }`}
              />
            )}
          </div>
        </div>
      </aside>
    );
  }

  /* ================================================================ */
  /*  Full sidebar                                                     */
  /* ================================================================ */
  return (
    <aside
      aria-label="Main navigation"
      className="w-72 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 select-none"
    >
      {/* Brand */}
      <div className="px-3.5 py-3.5 border-b border-slate-800 flex items-center gap-3 bg-slate-950/40">
        {brandMark}
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-white text-[15px] leading-tight truncate">Abrar Medical Store</h1>
          <p className="text-[11px] text-emerald-400 truncate">Pharmacy &amp; Accounting</p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Shrink sidebar"
          aria-label="Shrink sidebar"
          className={`p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors ${FOCUS_RING}`}
        >
          <Icon name="chevronsLeft" className="w-4 h-4" />
        </button>
      </div>

      {/* Primary action + search */}
      <div className="px-3 pt-3 pb-2.5 space-y-2.5 border-b border-slate-800/80">
        {canSell && (
          <button
            type="button"
            onClick={() => onSelectTab('sales-pos')}
            className="w-full flex items-center gap-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-emerald-950 font-semibold text-sm px-3 py-2.5 shadow-lg shadow-emerald-950/40 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <Icon name="pos" className="w-5 h-5" />
            <span>{hasUnsavedInvoiceItems ? 'Resume invoice' : 'New sale'}</span>
            {hasUnsavedInvoiceItems ? (
              <span className="ml-auto w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-emerald-300/60" title="Unsaved items" />
            ) : (
              <Icon name="plus" className="ml-auto w-4 h-4" />
            )}
          </button>
        )}

        <div className="relative">
          <Icon
            name="search"
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Find a page..."
            aria-label="Find a page in the menu"
            className="w-full h-9 bg-slate-800/80 text-slate-100 placeholder-slate-500 text-[13px] pl-9 pr-16 rounded-lg border border-slate-700/70 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25"
          />
          {menuSearch ? (
            <button
              type="button"
              onClick={() => {
                setMenuSearch('');
                searchRef.current?.focus();
              }}
              title="Clear search"
              aria-label="Clear search"
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 ${FOCUS_RING}`}
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 pointer-events-none">
              {isMac ? 'Cmd K' : 'Ctrl K'}
            </kbd>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{moduleCount} modules</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={expandAll}
              className={`px-2 py-1 rounded-md hover:text-emerald-300 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
            >
              Open all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className={`px-2 py-1 rounded-md hover:text-slate-200 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
            >
              Close all
            </button>
          </div>
        </div>
      </div>

      {/* Navigation tree */}
      <nav
        ref={navRef}
        onKeyDown={onNavKeyDown}
        className="flex-1 px-2 py-2 space-y-1 overflow-y-auto [scrollbar-width:thin]"
      >
        {/* Pinned + recent */}
        {!searchLower && pinnedRows.length > 0 && (
          <div className="pb-1.5 mb-1 border-b border-slate-800/80">
            <p className="px-3 pb-1 text-[11px] font-medium text-slate-500">Pinned</p>
            <div className="space-y-0.5">
              {pinnedRows.map(({ leaf, node }) => (
                <LeafRow
                  key={`pin-${leaf.id}`}
                  dataAttr="data-quick-id"
                  leaf={leaf}
                  accent={ACCENTS[node.id] ?? FALLBACK_ACCENT}
                  active={normalizedActiveTab === leaf.id}
                  pinned
                  warn={leaf.id === 'sales-pos' && !!hasUnsavedInvoiceItems}
                  onSelect={onSelectTab}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          </div>
        )}
        {!searchLower && recentRows.length > 0 && (
          <div className="pb-1.5 mb-1 border-b border-slate-800/80">
            <p className="px-3 pb-1 text-[11px] font-medium text-slate-500">Recent</p>
            <div className="space-y-0.5">
              {recentRows.map(({ leaf, node }) => (
                <LeafRow
                  key={`recent-${leaf.id}`}
                  dataAttr="data-quick-id"
                  leaf={leaf}
                  accent={ACCENTS[node.id] ?? FALLBACK_ACCENT}
                  active={false}
                  pinned={false}
                  onSelect={onSelectTab}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty search state */}
        {visibleMenu.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
              <Icon name="search" />
            </div>
            <p className="text-sm text-slate-200 font-medium">Nothing found for "{menuSearch.trim()}"</p>
            <p className="text-xs text-slate-500 mt-1">Try a shorter word, like "sale" or "stock".</p>
            <button
              type="button"
              onClick={() => setMenuSearch('')}
              className={`mt-3 text-xs text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded-md ${FOCUS_RING}`}
            >
              Clear search
            </button>
          </div>
        )}

        {visibleMenu.map((node) => {
          const accent = ACCENTS[node.id] ?? FALLBACK_ACCENT;

          /* Single top-level page (Dashboard) */
          if (node.tabId) {
            const isActive = normalizedActiveTab === node.tabId;
            return (
              <button
                key={node.id}
                type="button"
                data-nav-item
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectTab(node.tabId!)}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl text-[13px] font-semibold transition-colors ${FOCUS_RING} ${
                  isActive ? 'bg-white/[0.08] text-white' : 'text-slate-200 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive ? accent.tileActive : accent.tile
                  }`}
                >
                  <Icon name={node.icon} />
                </span>
                <span className="truncate">
                  <Highlight text={node.label} query={searchLower} />
                </span>
              </button>
            );
          }

          /* Module group */
          const children = node.children ?? [];
          const hasActiveChild = children.some((c) => c.id === normalizedActiveTab);
          const isOpen = searchLower ? true : (openGroups[node.id] ?? false);

          return (
            <div key={node.id} className={`rounded-xl transition-colors ${hasActiveChild ? 'bg-white/[0.03]' : ''}`}>
              <button
                type="button"
                data-nav-item
                data-group-id={node.id}
                aria-expanded={isOpen}
                onClick={() => toggleGroup(node.id)}
                title={`${node.code}. ${node.label}`}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl text-[13px] font-semibold text-left transition-colors ${FOCUS_RING} ${
                  hasActiveChild ? 'text-white' : 'text-slate-200 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    hasActiveChild ? accent.tileActive : accent.tile
                  }`}
                >
                  <Icon name={node.icon} />
                </span>
                <span className="truncate flex-1">{node.label}</span>
                <span className="text-[11px] text-slate-500 font-normal tabular-nums">{children.length}</span>
                <Icon
                  name="chevron"
                  className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${
                    isOpen ? 'rotate-90 text-slate-300' : ''
                  }`}
                />
              </button>

              <div
                aria-hidden={!isOpen}
                className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                  isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden min-h-0">
                  <div className="ml-6 border-l border-slate-800 py-1 space-y-0.5">
                    {children.map((leaf) => (
                      <LeafRow
                        key={leaf.id}
                        dataAttr="data-leaf-id"
                        leaf={leaf}
                        accent={accent}
                        active={normalizedActiveTab === leaf.id}
                        pinned={pinned.includes(leaf.id)}
                        query={searchLower}
                        tabbable={isOpen}
                        warn={leaf.id === 'sales-pos' && !!hasUnsavedInvoiceItems}
                        onSelect={onSelectTab}
                        onTogglePin={togglePin}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-950/60 flex items-center gap-2.5">
        <div className="relative w-9 h-9 rounded-full bg-slate-700 text-slate-100 text-sm font-semibold flex items-center justify-center shrink-0">
          {(roleName || 'U').charAt(0).toUpperCase()}
          {databaseConnected !== undefined && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-slate-950 ${
                databaseConnected ? 'bg-emerald-400' : 'bg-red-500'
              }`}
            />
          )}
        </div>
        <div className="min-w-0 flex-1" title={dbTitle || undefined}>
          <p className="text-[13px] text-slate-100 font-medium truncate">{roleName || 'Signed in'}</p>
          {dbText && (
            <p className={`text-[11px] truncate ${databaseConnected ? 'text-slate-500' : 'text-red-400'}`}>{dbText}</p>
          )}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">Rs. / UTC+5</span>
      </div>
    </aside>
  );
};

export default Sidebar;
