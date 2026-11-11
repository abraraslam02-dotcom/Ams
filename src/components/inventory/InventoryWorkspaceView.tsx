import React, { useState } from 'react';
import {
  Boxes,
  FileSpreadsheet,
  Layers,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Sliders,
  ArrowRightLeft,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { StockOverviewView } from './StockOverviewView';
import { StockDatasheetView } from './StockDatasheetView';
import { CurrentStockView } from './CurrentStockView';
import { ExpiryManagementView } from './ExpiryManagementView';
import { LowStockView } from './LowStockView';
import { StockAdjustmentView } from './StockAdjustmentView';
import { StockTransferView } from './StockTransferView';
import { StockLedgerView } from './StockLedgerView';
import { PhysicalVerificationView } from './PhysicalVerificationView';

export type InventorySubTab =
  | 'inv-overview'
  | 'inv-current'
  | 'inv-datasheet'
  | 'inv-expiry'
  | 'inv-near-expiry'
  | 'inv-expired'
  | 'inv-low-stock'
  | 'inv-adjustment'
  | 'inv-transfer'
  | 'inv-ledger'
  | 'inv-verification';

interface InventoryWorkspaceViewProps {
  initialSubTab?: InventorySubTab;
  onSubTabChange?: (tab: InventorySubTab) => void;
}

export const InventoryWorkspaceView: React.FC<InventoryWorkspaceViewProps> = ({
  initialSubTab = 'inv-overview',
  onSubTabChange,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<InventorySubTab>(initialSubTab);

  // Sync if prop changes
  React.useEffect(() => {
    if (initialSubTab && initialSubTab !== activeSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const handleSelectTab = (tab: InventorySubTab) => {
    setActiveSubTab(tab);
    onSubTabChange?.(tab);
  };

  const tabs: Array<{ id: InventorySubTab; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'inv-overview', label: 'Stock Overview', icon: Boxes },
    { id: 'inv-current', label: 'Current Stock', icon: Layers },
    { id: 'inv-datasheet', label: 'Batch-wise Stock', icon: FileSpreadsheet },
    { id: 'inv-expiry', label: 'Expiry Management', icon: Clock },
    { id: 'inv-near-expiry', label: 'Near Expiry Items', icon: Clock },
    { id: 'inv-expired', label: 'Expired Items', icon: ShieldAlert },
    { id: 'inv-low-stock', label: 'Low Stock', icon: AlertTriangle },
    { id: 'inv-adjustment', label: 'Stock Adjustment', icon: Sliders },
    { id: 'inv-transfer', label: 'Stock Transfer', icon: ArrowRightLeft },
    { id: 'inv-ledger', label: 'Stock Ledger', icon: Calendar },
    { id: 'inv-verification', label: 'Physical Stock Verification', icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-3 font-sans">
      {/* Top Quick-Navigation Sub-Tabs Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-1.5 flex items-center gap-1 overflow-x-auto shadow-xs select-none print:hidden">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => handleSelectTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Render Active View */}
      {activeSubTab === 'inv-overview' && (
        <StockOverviewView onNavigateSubTab={(id) => handleSelectTab(id as InventorySubTab)} />
      )}
      {activeSubTab === 'inv-current' && <CurrentStockView />}
      {activeSubTab === 'inv-datasheet' && <StockDatasheetView />}
      {activeSubTab === 'inv-expiry' && <ExpiryManagementView initialFilter="ALL" />}
      {activeSubTab === 'inv-near-expiry' && (
        <ExpiryManagementView initialFilter="30_DAYS" />
      )}
      {activeSubTab === 'inv-expired' && (
        <ExpiryManagementView initialFilter="EXPIRED" />
      )}
      {activeSubTab === 'inv-low-stock' && <LowStockView />}
      {activeSubTab === 'inv-adjustment' && <StockAdjustmentView />}
      {activeSubTab === 'inv-transfer' && <StockTransferView />}
      {activeSubTab === 'inv-ledger' && <StockLedgerView />}
      {activeSubTab === 'inv-verification' && <PhysicalVerificationView />}
    </div>
  );
};
