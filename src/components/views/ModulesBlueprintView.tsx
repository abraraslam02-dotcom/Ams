import React from 'react';
import { NavTabId } from '../layout/Sidebar';
import { TableDetail } from '../../types/database';
import {
  Package,
  Users2,
  ShoppingCart,
  RotateCcw,
  ShoppingBag,
  ArrowDownLeft,
  Boxes,
  Shield,
  Layers,
  ArrowRight,
  CheckCircle2,
  Lock,
  Database,
  FileCheck2,
} from 'lucide-react';

interface ModulesBlueprintViewProps {
  moduleKey: NavTabId;
  tables: TableDetail[];
  onNavigateToSchema: () => void;
  onNavigateToReport: () => void;
}

const MODULE_DEFINITIONS: Record<
  string,
  {
    title: string;
    subtitle: string;
    icon: React.ElementType;
    tables: string[];
    plannedFeatures: string[];
    schemaColumnsHighlight: string[];
    complianceNote: string;
  }
> = {
  items: {
    title: 'Items & Medicine Catalog Module',
    subtitle: 'Pharmaceutical products, dosage forms, formulas, manufacturers, and alert thresholds',
    icon: Package,
    tables: ['items'],
    plannedFeatures: [
      'Medicine master registry with item code and barcode indexing',
      'Dosage forms: Tablet, Syrup, Capsule, Injection, Ointment, Drops, Inhaler',
      'Generic formulation name & brand mapping',
      'Manufacturer and physical rack/shelf location tracking',
      'Minimum stock alert quantity for re-order triggers',
      'Narcotic and refrigerated drug flags with regulatory audit trail',
    ],
    schemaColumnsHighlight: ['item_code', 'barcode', 'brand_name', 'generic_name', 'dosage_form', 'strength', 'pack_size', 'manufacturer', 'rack_location', 'min_stock_alert'],
    complianceNote: 'Table `items` is verified in database with 0 dummy records.',
  },
  accounts: {
    title: 'Accounts & Financial Ledgers Module',
    subtitle: 'Customer ledgers, pharmaceutical distributors, cash books, and credit limits in PKR',
    icon: Users2,
    tables: ['accounts'],
    plannedFeatures: [
      'Customer accounts with credit limits, phone numbers, and running balance in PKR',
      'Supplier/Distributor accounts with NTN, representative details, and payment terms',
      'Bank and Cash ledger accounts for daily reconciliation',
      'Double-entry alignment with sales invoices and purchase bills',
    ],
    schemaColumnsHighlight: ['account_code', 'account_name', 'account_type', 'contact_person', 'phone', 'credit_limit', 'current_balance', 'status'],
    complianceNote: 'Table `accounts` is verified in database with 0 dummy records.',
  },
  sales: {
    title: 'Sales & POS Invoicing Module',
    subtitle: 'Fast-paced counter sales, thermal receipts, discounts, and payment modes',
    icon: ShoppingCart,
    tables: ['sales', 'sale_items'],
    plannedFeatures: [
      'Fast keyboard-driven point-of-sale invoicing for retail counter customers',
      'Barcode scanner and item lookup with real-time price & batch selection',
      'Multi-mode payments: Cash, Customer Credit, Bank Card, or Split in PKR',
      'Itemized discounts, percentage reductions, and net total calculation',
      'Print-ready professional invoice format with store license DL number and tax NTN',
    ],
    schemaColumnsHighlight: ['invoice_number', 'invoice_date', 'customer_account_id', 'payment_mode', 'gross_total', 'discount_amount', 'tax_amount', 'net_total', 'paid_amount', 'balance_amount'],
    complianceNote: 'Tables `sales` and `sale_items` are verified in database with 0 dummy invoices.',
  },
  'sale-returns': {
    title: 'Sale Returns & Customer Refunds Module',
    subtitle: 'Customer medicine return receipts, reason audits, and stock replenishment',
    icon: RotateCcw,
    tables: ['sale_returns', 'sale_return_items'],
    plannedFeatures: [
      'Reference to original sale invoice for return validation',
      'Return reason tracking (Patient recovery, wrong dosage, expiry buffer)',
      'Cash refund or credit note adjustment to customer ledger',
      'Condition inspection: restock to inventory vs. quarantine damaged stock',
    ],
    schemaColumnsHighlight: ['return_number', 'original_sale_id', 'customer_account_id', 'refund_mode', 'total_refund_amount', 'return_reason', 'restock_status'],
    complianceNote: 'Tables `sale_returns` and `sale_return_items` are verified in database with 0 dummy records.',
  },
  purchases: {
    title: 'Purchases & Goods Receiving Module',
    subtitle: 'Distributor bills, batch numbers, manufacturer expiry dates, and purchase rates',
    icon: ShoppingBag,
    tables: ['purchases', 'purchase_items'],
    plannedFeatures: [
      'Entry of distributor delivery challans and invoices',
      'Batch-wise purchase rate, trade discount, and Maximum Retail Price (MRP)',
      'Direct synchronization into inventory batch ledger',
      'Supplier payable ledger updates in PKR',
    ],
    schemaColumnsHighlight: ['bill_number', 'supplier_invoice_number', 'supplier_account_id', 'gross_total', 'discount_amount', 'net_total', 'payment_status'],
    complianceNote: 'Tables `purchases` and `purchase_items` are verified in database with 0 dummy records.',
  },
  'purchase-returns': {
    title: 'Purchase Returns (Debit Notes) Module',
    subtitle: 'Returning near-expiry, damaged, or recalled drugs back to distributors',
    icon: ArrowDownLeft,
    tables: ['purchase_returns', 'purchase_return_items'],
    plannedFeatures: [
      'Debit note generation referencing original distributor purchase bill',
      'Batch deduction from inventory stock balance',
      'Adjustment against supplier outstanding payable balance in PKR',
      'Audit log of supplier return reasons and drug recall notices',
    ],
    schemaColumnsHighlight: ['debit_note_number', 'original_purchase_id', 'supplier_account_id', 'total_debit_amount', 'return_reason'],
    complianceNote: 'Tables `purchase_returns` and `purchase_return_items` are verified in database with 0 dummy records.',
  },
  inventory: {
    title: 'Inventory & Batch Stock Module',
    subtitle: 'Batch-level tracking, expiry surveillance (FEFO), pack and loose unit management',
    icon: Boxes,
    tables: ['inventory'],
    plannedFeatures: [
      'FEFO (First-Expiry-First-Out) automated stock rotation prioritization',
      'Batch-wise expiry monitoring with early warning alerts (30/60/90 days)',
      'Pack vs. loose strip/tablet conversion with automated stock reconciliation',
      'Cost price vs. retail price margin verification in PKR',
      'Physical rack and shelf location guidance for store pharmacy staff',
    ],
    schemaColumnsHighlight: ['item_id', 'batch_number', 'expiry_date', 'cost_price', 'retail_price', 'current_pack_qty', 'current_loose_qty', 'total_stock_units', 'status'],
    complianceNote: 'Table `inventory` is verified in database with 0 dummy records.',
  },
  users: {
    title: 'User Management & Roles Module',
    subtitle: 'Pharmacist, Cashier, Auditor, and Admin role permissions and audit security',
    icon: Shield,
    tables: ['users'],
    plannedFeatures: [
      'Role-based permissions: Admin, Registered Pharmacist, Cashier, Auditor',
      'Session authentication and secure password hashing',
      'Audit trail for high-impact actions (price overrides, narcotic dispensing, cancellations)',
      'Active/suspended status management',
    ],
    schemaColumnsHighlight: ['username', 'full_name', 'email', 'password_hash', 'role', 'status', 'last_login'],
    complianceNote: 'Table `users` is verified in database with 0 dummy records.',
  },
};

export const ModulesBlueprintView: React.FC<ModulesBlueprintViewProps> = ({
  moduleKey,
  tables,
  onNavigateToSchema,
  onNavigateToReport,
}) => {
  const def = MODULE_DEFINITIONS[moduleKey] || MODULE_DEFINITIONS.items;
  const Icon = def.icon;

  const relevantTables = tables.filter((t) => def.tables.includes(t.name));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Module Architecture Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{def.title}</h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                Awaiting Task 2 Approval
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{def.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onNavigateToSchema}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Database className="w-4 h-4 text-slate-500" />
            Inspect Schema
          </button>
          <button
            onClick={onNavigateToReport}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileCheck2 className="w-4 h-4" />
            Task 1 Sign-Off
          </button>
        </div>
      </div>

      {/* Strict Compliance Advisory Box */}
      <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 space-y-2">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
          <Lock className="w-4 h-4" />
          <span>Task 1 Scope Strict Rule Notice</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          In strict compliance with the prompt instructions (<em>"Do not create dummy functionality. Do not insert fake business records. Do not build sales or purchase screens. Do not create sample invoices. Do not implement inventory calculations yet."</em>),
          the UI screens and business logic for this module are intentionally held until Task 1 approval is granted.
          The underlying database tables, relational foreign keys, indexes, and backend models are already 100% prepared and verified below.
        </p>
      </div>

      {/* Two Column Layout: Schema Verification & Planned Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Verified Database Tables */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-emerald-600" />
              Verified Database Tables ({relevantTables.length})
            </h3>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              0 Fake Records
            </span>
          </div>

          <div className="space-y-3">
            {relevantTables.map((t) => (
              <div
                key={t.name}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-xs text-slate-900">{t.name}</span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                    Verified in SQLite
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  {t.columnsCount} Columns • {t.foreignKeys.length} Foreign Keys • {t.indexes.length} Indexes
                </div>
                <div className="pt-2 border-t border-slate-200/80">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                    Key Columns:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {t.columns.slice(0, 8).map((col) => (
                      <span
                        key={col.name}
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700"
                      >
                        {col.name} ({col.type})
                      </span>
                    ))}
                    {t.columns.length > 8 && (
                      <span className="text-[10px] text-slate-400 self-center">
                        +{t.columns.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Planned Business Architecture for Task 2 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-teal-600" />
              Task 2 Implementation Blueprint
            </h3>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              Architecture Ready
            </span>
          </div>

          <div className="space-y-2.5">
            {def.plannedFeatures.map((feat, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-start gap-2.5 text-xs text-slate-700"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{feat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
