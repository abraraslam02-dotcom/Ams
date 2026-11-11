import React, { useState } from 'react';
import {
  X,
  Users,
  Truck,
  Wallet,
  Landmark,
  FileSpreadsheet,
  FileCheck,
  Zap,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { LedgersWorkspaceView, LedgerWorkspaceTab } from './LedgersWorkspaceView';
import { VoucherManagementView } from './VoucherManagementView';
import { AdvanceTaxAccountingView } from './AdvanceTaxAccountingView';
import { VoucherTypeCode } from '../../types/accounting';
import { CashBookModuleView } from './CashBookModuleView';

export type QuickShortcutAction =
  | 'customer-ledger'
  | 'supplier-ledger'
  | 'cash-ledger'
  | 'bank-ledger'
  | 'receive-payment'
  | 'make-payment'
  | 'cash-receipt'
  | 'cash-payment'
  | 'journal-voucher'
  | 'advance-tax-details';

interface QuickAccountShortcutsModalProps {
  isOpen: boolean;
  initialAction?: QuickShortcutAction;
  initialAccountId?: number | null;
  onClose: () => void;
}

export const QuickAccountShortcutsModal: React.FC<QuickAccountShortcutsModalProps> = ({
  isOpen,
  initialAction = 'customer-ledger',
  initialAccountId = null,
  onClose,
}) => {
  const [activeAction, setActiveAction] = useState<QuickShortcutAction>(initialAction);

  React.useEffect(() => {
    if (initialAction) {
      setActiveAction(initialAction);
    }
  }, [initialAction]);

  if (!isOpen) return null;

  const SHORTCUT_BUTTONS: Array<{
    key: QuickShortcutAction;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: 'customer-ledger', label: 'Customer Ledger', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'supplier-ledger', label: 'Supplier Ledger', icon: <Truck className="w-3.5 h-3.5" /> },
    { key: 'cash-ledger', label: 'Cash Ledger', icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: 'bank-ledger', label: 'Bank Ledger', icon: <Landmark className="w-3.5 h-3.5" /> },
    {
      key: 'receive-payment',
      label: 'Receive Payment (BRV/CRV)',
      icon: <ArrowDownLeft className="w-3.5 h-3.5" />,
    },
    {
      key: 'make-payment',
      label: 'Make Payment (BPV/CPV)',
      icon: <ArrowUpRight className="w-3.5 h-3.5" />,
    },
    {
      key: 'cash-receipt',
      label: 'Cash Receipt (CRV)',
      icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
    },
    {
      key: 'cash-payment',
      label: 'Cash Payment (CPV)',
      icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
    },
    {
      key: 'journal-voucher',
      label: 'Journal Voucher (JV)',
      icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
    },
    {
      key: 'advance-tax-details',
      label: 'Advance Tax Details',
      icon: <FileCheck className="w-3.5 h-3.5" />,
    },
  ];

  const resolveLedgerTab = (): LedgerWorkspaceTab | null => {
    if (activeAction === 'customer-ledger') return 'customer';
    if (activeAction === 'supplier-ledger') return 'supplier';
    if (activeAction === 'cash-ledger') return 'cash-book';
    if (activeAction === 'bank-ledger') return 'bank-book';
    return null;
  };

  const resolveVoucherType = (): VoucherTypeCode | null => {
    if (activeAction === 'receive-payment' || activeAction === 'cash-receipt') return 'CRV';
    if (activeAction === 'make-payment' || activeAction === 'cash-payment') return 'CPV';
    if (activeAction === 'journal-voucher') return 'JV';
    return null;
  };

  const ledgerTab = resolveLedgerTab();
  const voucherType = resolveVoucherType();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-[1px] flex items-center justify-center p-3">
      <div className="bg-slate-50 border border-slate-300 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded bg-emerald-600 text-white">
              <Zap className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold leading-tight">
                Quick Account & Voucher Shortcuts (Non-Destructive Workspace Overlay)
              </h2>
              <p className="text-[11px] text-slate-400">
                Your active Sales / Purchase Invoice or background screen remains untouched while using this window.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white rounded text-xs font-bold flex items-center gap-1 transition-colors"
          >
            <X className="w-4 h-4" />
            Return to Active Work (ESC)
          </button>
        </div>

        {/* 10 Quick Shortcut Selector Buttons */}
        <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap gap-1.5 shrink-0">
          {SHORTCUT_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={() => setActiveAction(btn.key)}
              className={`px-2.5 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeAction === btn.key
                  ? 'bg-emerald-800 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {btn.icon}
              {btn.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeAction === 'cash-ledger' && (
            <CashBookModuleView />
          )}
          {ledgerTab && activeAction !== 'cash-ledger' && (
            <LedgersWorkspaceView
              initialTab={ledgerTab}
              initialAccountId={initialAccountId}
            />
          )}
          {voucherType && <VoucherManagementView initialVoucherType={voucherType} />}
          {activeAction === 'advance-tax-details' && <AdvanceTaxAccountingView />}
        </div>
      </div>
    </div>
  );
};
