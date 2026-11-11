import React, { useState, useEffect } from 'react';
import {
  SlidersHorizontal,
  Heading,
  FileText,
  Eye,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Building,
  Phone,
  FileCheck,
  Receipt,
  Printer,
  Sparkles,
  HelpCircle,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface VisibilityFields {
  customer_address: boolean;
  customer_phone: boolean;
  item_company: boolean;
  item_code: boolean;
  barcode: boolean;
  batch_number: boolean;
  expiry_date: boolean;
  discount: boolean;
  tax: boolean;
  bonus_quantity: boolean;
  loose_quantity: boolean;
  packing_details: boolean;
  previous_balance: boolean;
  paid_amount: boolean;
  remaining_balance: boolean;
  remarks: boolean;
  footer_note: boolean;
}

const FIELD_DEFINITIONS: Array<{ key: keyof VisibilityFields; label: string; desc: string }> = [
  { key: 'customer_address', label: 'Customer Address', desc: 'Customer shop / street address' },
  { key: 'customer_phone', label: 'Customer Phone', desc: 'Customer mobile / phone number' },
  { key: 'item_company', label: 'Item Company', desc: 'Manufacturer / Pharmaceutical brand name' },
  { key: 'item_code', label: 'Item Code', desc: 'Internal medicine SKU / product code' },
  { key: 'barcode', label: 'Barcode', desc: 'Scannable UPC / EAN barcode' },
  { key: 'batch_number', label: 'Batch Number', desc: 'Medicine manufacturing batch identifier' },
  { key: 'expiry_date', label: 'Expiry Date', desc: 'Month & year product expiration' },
  { key: 'discount', label: 'Discount', desc: 'Line item trade discount (%) and total discount' },
  { key: 'tax', label: 'Tax', desc: 'Sales / Advance Tax rates and computed tax amounts' },
  { key: 'bonus_quantity', label: 'Bonus Quantity', desc: 'Free bonus units given on scheme deals' },
  { key: 'loose_quantity', label: 'Loose Quantity', desc: 'Sub-unit / loose tablet or capsule counts' },
  { key: 'packing_details', label: 'Packing Details', desc: 'Unit package packaging (e.g. 10x10, 20x1)' },
  { key: 'previous_balance', label: 'Previous Balance', desc: 'Customer ledger balance before this invoice' },
  { key: 'paid_amount', label: 'Paid Amount', desc: 'Cash / payment tendered at time of invoice' },
  { key: 'remaining_balance', label: 'Remaining Balance', desc: 'Net outstanding receivables ledger balance' },
  { key: 'remarks', label: 'Remarks', desc: 'Optional salesperson instructions or delivery notes' },
  { key: 'footer_note', label: 'Footer Note', desc: 'Terms & conditions and thank you notice' },
];

export const MoreOptionsView: React.FC = () => {
  const { isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // A. Sales Invoice Headings
  const [storeName, setStoreName] = useState('ABRAR MEDICAL STORE');
  const [invoiceTitle, setInvoiceTitle] = useState('TAX / COMMERCIAL INVOICE');
  const [invoiceSubtitle, setInvoiceSubtitle] = useState('Retail & Wholesale Pharmacy Solutions');
  const [address, setAddress] = useState('Main Bazar, Mandi Ahmad Abad');
  const [phone, setPhone] = useState('0300-1234567');
  const [ntnStrn, setNtnStrn] = useState('1234567-8');
  const [customHeading, setCustomHeading] = useState('');

  // B. Sales Invoice Footer Note
  const [footerNote, setFooterNote] = useState('');
  const [customTerms, setCustomTerms] = useState('');
  const [thankYouMessage, setThankYouMessage] = useState('');

  // C. Field Visibility across 4 scopes
  const [visibility, setVisibility] = useState<{
    entry: VisibilityFields;
    preview: VisibilityFields;
    a4: VisibilityFields;
    thermal: VisibilityFields;
  }>({
    entry: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    preview: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    a4: {
      customer_address: true,
      customer_phone: true,
      item_company: true,
      item_code: true,
      barcode: true,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: true,
      loose_quantity: true,
      packing_details: true,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: true,
      footer_note: true,
    },
    thermal: {
      customer_address: false,
      customer_phone: false,
      item_company: false,
      item_code: false,
      barcode: false,
      batch_number: true,
      expiry_date: true,
      discount: true,
      tax: true,
      bonus_quantity: false,
      loose_quantity: false,
      packing_details: false,
      previous_balance: true,
      paid_amount: true,
      remaining_balance: true,
      remarks: false,
      footer_note: true,
    },
  });

  const [activeScope, setActiveScope] = useState<'entry' | 'preview' | 'a4' | 'thermal'>('entry');

  const fetchOptions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getSalesInvoiceMoreOptions();
      if (res?.data) {
        const d = res.data;
        if (d.store_name) setStoreName(d.store_name);
        if (d.invoice_title) setInvoiceTitle(d.invoice_title);
        if (d.invoice_subtitle) setInvoiceSubtitle(d.invoice_subtitle);
        if (d.address) setAddress(d.address);
        if (d.phone) setPhone(d.phone);
        if (d.ntn_strn) setNtnStrn(d.ntn_strn);
        if (d.custom_heading !== undefined) setCustomHeading(d.custom_heading);

        if (d.footer_note) setFooterNote(d.footer_note);
        if (d.custom_terms) setCustomTerms(d.custom_terms);
        if (d.thank_you_message) setThankYouMessage(d.thank_you_message);

        if (d.visibility) {
          setVisibility(d.visibility);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load Sales Invoice More Options');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, []);

  const handleToggleField = (fieldKey: keyof VisibilityFields) => {
    if (!isSuperAdmin) return;
    setVisibility((prev) => ({
      ...prev,
      [activeScope]: {
        ...prev[activeScope],
        [fieldKey]: !prev[activeScope][fieldKey],
      },
    }));
  };

  const handleToggleAllScope = (enableAll: boolean) => {
    if (!isSuperAdmin) return;
    setVisibility((prev) => {
      const updatedScope = { ...prev[activeScope] };
      FIELD_DEFINITIONS.forEach((f) => {
        updatedScope[f.key] = enableAll;
      });
      return {
        ...prev,
        [activeScope]: updatedScope,
      };
    });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isSuperAdmin) {
      setError('Only Super Admin is authorized to modify Sales Invoice More Options.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload = {
        store_name: storeName.trim(),
        invoice_title: invoiceTitle.trim(),
        invoice_subtitle: invoiceSubtitle.trim(),
        address: address.trim(),
        phone: phone.trim(),
        ntn_strn: ntnStrn.trim(),
        custom_heading: customHeading.trim(),
        footer_note: footerNote.trim(),
        custom_terms: customTerms.trim(),
        thank_you_message: thankYouMessage.trim(),
        visibility,
      };

      await api.updateSalesInvoiceMoreOptions(payload);

      setSuccess('Sales Invoice More Options saved permanently to database and applied immediately.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white rounded-2xl border border-rose-200 p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-bold text-base text-slate-800">Super Admin Access Required</h3>
        <p className="text-xs text-slate-500">
          Only the Super Administrator is authorized to modify Sales Invoice Headings, Footers, and Field Visibility configurations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-emerald-600/20">
            <SlidersHorizontal className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">More Options — Sales Invoice Settings</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                Sales Invoice Only
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize sales invoice header branding, live heading preview, multi-line footer terms, and independent field visibility.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={fetchOptions}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Reload saved settings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-600/20 disabled:opacity-50 shrink-0"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Settings Permanently</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
            ×
          </button>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2 font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            ×
          </button>
        </div>
      )}

      {/* SECTION A: SALES INVOICE HEADINGS & LIVE PREVIEW */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Heading className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-sm text-slate-900">A. Sales Invoice Headings & Live Layout Preview</h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Form */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Store Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. ABRAR MEDICAL STORE"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Invoice Title</label>
                <input
                  type="text"
                  value={invoiceTitle}
                  onChange={(e) => setInvoiceTitle(e.target.value)}
                  placeholder="e.g. TAX / COMMERCIAL INVOICE"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Invoice Subtitle</label>
                <input
                  type="text"
                  value={invoiceSubtitle}
                  onChange={(e) => setInvoiceSubtitle(e.target.value)}
                  placeholder="e.g. Retail & Wholesale Pharmacy Solutions"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 0300-1234567, 042-35789000"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Main Bazar, Mandi Ahmad Abad"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">NTN / STRN (Optional)</label>
                <input
                  type="text"
                  value={ntnStrn}
                  onChange={(e) => setNtnStrn(e.target.value)}
                  placeholder="e.g. NTN: 1234567-8 / STRN: 3277876"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Custom Invoice Heading (Optional Top Banner)</label>
              <input
                type="text"
                value={customHeading}
                onChange={(e) => setCustomHeading(e.target.value)}
                placeholder="e.g. BISMILLAH AR-RAHMAN AR-RAHEEM or OFFICIAL MEDICAL SUPPLIES"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Simple Live Preview Box */}
          <div className="lg:col-span-5 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-300 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <span>Invoice Heading Live Preview</span>
                <span className="text-emerald-700 font-bold bg-emerald-100/80 px-2 py-0.5 rounded text-[10px]">
                  Real-time
                </span>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs text-center space-y-1">
                {customHeading && (
                  <div className="text-[11px] font-bold text-slate-600 tracking-wider uppercase border-b border-slate-100 pb-1 mb-1">
                    {customHeading}
                  </div>
                )}
                <div className="text-base font-black tracking-tight text-slate-900 uppercase">
                  {storeName || 'STORE NAME'}
                </div>
                {invoiceSubtitle && (
                  <div className="text-[11px] text-slate-500 font-medium">{invoiceSubtitle}</div>
                )}
                <div className="text-[11px] text-slate-600">
                  {address} {phone ? `• Tel: ${phone}` : ''}
                </div>
                {ntnStrn && (
                  <div className="text-[10px] text-slate-500 font-mono">
                    {ntnStrn}
                  </div>
                )}
                <div className="pt-2">
                  <span className="inline-block px-3 py-0.5 rounded bg-slate-900 text-white font-bold text-[11px] tracking-wider uppercase">
                    {invoiceTitle || 'TAX / COMMERCIAL INVOICE'}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 text-center">
              This heading appears at the top of A4 and Thermal printed invoices.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION B: SALES INVOICE FOOTER NOTE */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <FileText className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-sm text-slate-900">B. Sales Invoice Multi-line Footer Note & Terms</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Main Footer Note (Multi-line supported)
              </label>
              <textarea
                rows={3}
                value={footerNote}
                onChange={(e) => setFooterNote(e.target.value)}
                placeholder="e.g. Thank you for choosing Abrar Medical Store! Medicines once sold will not be taken back without receipt."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Custom Terms & Conditions (Multi-line supported)
              </label>
              <textarea
                rows={3}
                value={customTerms}
                onChange={(e) => setCustomTerms(e.target.value)}
                placeholder="1. Expired/damaged items will be claimed as per company policy.&#10;2. Please check your medicines and change before leaving counter."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Optional Thank-You Message</label>
              <input
                type="text"
                value={thankYouMessage}
                onChange={(e) => setThankYouMessage(e.target.value)}
                placeholder="e.g. Get Well Soon & Thank You For Your Visit!"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Footer Print Preview
              </span>
              <div className="bg-white p-3 rounded-lg border border-slate-200 text-xs space-y-2 text-slate-700">
                {footerNote && <p className="italic text-slate-600 whitespace-pre-line text-[11px]">{footerNote}</p>}
                {customTerms && (
                  <div className="border-t border-slate-100 pt-1.5 whitespace-pre-line text-[10px] text-slate-500">
                    <strong className="block text-slate-700 mb-0.5">Terms:</strong>
                    {customTerms}
                  </div>
                )}
                {thankYouMessage && (
                  <div className="text-center font-bold text-[11px] text-emerald-800 border-t border-slate-100 pt-1">
                    {thankYouMessage}
                  </div>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              Automatically included on future sales invoice printouts.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION C: SALES INVOICE OPTIONAL FIELD VISIBILITY */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="font-bold text-sm text-slate-900">C. Sales Invoice Optional Field Visibility</h3>
              <p className="text-[11px] text-slate-500">
                ON/OFF toggles for 17 fields across 4 distinct sales invoice scopes. Calculations and database records are never lost.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggleAllScope(true)}
              className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-bold cursor-pointer"
            >
              Show All in Scope
            </button>
            <button
              type="button"
              onClick={() => handleToggleAllScope(false)}
              className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer"
            >
              Hide All in Scope
            </button>
          </div>
        </div>

        {/* 4 Scope Selector Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setActiveScope('entry')}
            className={`py-3 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeScope === 'entry'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>1. Sales Invoice Entry Screen</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveScope('preview')}
            className={`py-3 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeScope === 'preview'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>2. Print Preview Modal</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveScope('a4')}
            className={`py-3 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeScope === 'a4'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>3. A4 Sales Invoice</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveScope('thermal')}
            className={`py-3 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeScope === 'thermal'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>4. Thermal Sales Invoice</span>
          </button>
        </div>

        {/* Scope Information Banner */}
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
          <span>
            Configuring visibility for:{' '}
            <strong className="text-slate-900 uppercase">
              {activeScope === 'entry' && 'Sales Invoice Entry Screen (POS & Datasheet)'}
              {activeScope === 'preview' && 'Sales Invoice Print Preview Dialog'}
              {activeScope === 'a4' && 'A4 Full-Page Printable Invoice Document'}
              {activeScope === 'thermal' && 'Thermal 80mm / 58mm Pos Receipt Printout'}
            </strong>
          </span>
          <span className="text-[11px] text-slate-400">
            {Object.values(visibility[activeScope]).filter(Boolean).length} of 17 fields visible
          </span>
        </div>

        {/* 17 Field Switches Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FIELD_DEFINITIONS.map((f) => {
            const isVisible = visibility[activeScope][f.key];

            return (
              <div
                key={f.key}
                onClick={() => handleToggleField(f.key)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between select-none ${
                  isVisible
                    ? 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50'
                    : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100 opacity-70'
                }`}
              >
                <div className="pr-2">
                  <div className="font-bold text-xs text-slate-900">{f.label}</div>
                  <div className="text-[10.5px] text-slate-400 leading-tight mt-0.5">{f.desc}</div>
                </div>

                {/* Switch Toggle */}
                <div
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-0.5 shrink-0 ${
                    isVisible ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white shadow-xs transition-transform transform ${
                      isVisible ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION D: SAVE SETTINGS BAR */}
      <div className="sticky bottom-4 z-20 bg-slate-900 text-white rounded-2xl p-4 shadow-xl border border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <div className="text-xs">
            <span className="font-bold">Super Admin Authority:</span> Saved settings take effect immediately in Entry &amp; Print screens.
          </div>
        </div>

        <button
          onClick={() => handleSave()}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save Settings</span>
        </button>
      </div>
    </div>
  );
};
