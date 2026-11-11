import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Save,
  History,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Info,
} from 'lucide-react';
import {
  AdvanceTaxSettings,
  AdvanceTaxHistoryEntry,
  AdvanceTaxBasis,
} from '../../types/purchase';
import { api } from '../../services/api';
import { formatPKTDateTime } from '../../utils/formatters';
import { NumericInput } from '../common/NumericInput';

interface AdvanceTaxSettingsPanelProps {
  settings?: AdvanceTaxSettings | null;
  history?: AdvanceTaxHistoryEntry[];
  onUpdated?: (newSettings: AdvanceTaxSettings, newHistory: AdvanceTaxHistoryEntry[]) => void;
}

export const AdvanceTaxSettingsPanel: React.FC<AdvanceTaxSettingsPanelProps> = ({
  settings: propSettings,
  history: propHistory,
  onUpdated,
}) => {
  const [localSettings, setLocalSettings] = useState<AdvanceTaxSettings | null>(propSettings || null);
  const [localHistory, setLocalHistory] = useState<AdvanceTaxHistoryEntry[]>(propHistory || []);

  const [formData, setFormData] = useState({
    tax_name: 'Advance Tax u/s 236H (Pharmaceuticals)',
    filer_rate: 0.5,
    non_filer_rate: 2.5,
    exempt_rate: 0.0,
    calculation_basis: 'taxable_plus_gst' as AdvanceTaxBasis,
    effective_from: '2026-01-01',
    status: 'Active' as 'Active' | 'Inactive',
    tax_applicability: 'All Taxable Medicine & Pharmaceutical Purchases',
    change_reason: '',
    changed_by: 'Authorized Administrator',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (propSettings) {
      setLocalSettings(propSettings);
    } else {
      api.getAdvanceTaxSettings().then((res) => {
        if (res.success && res.settings) {
          setLocalSettings(res.settings);
          setLocalHistory(res.history || []);
        }
      }).catch((e) => console.error(e));
    }
  }, [propSettings]);

  useEffect(() => {
    if (propHistory) {
      setLocalHistory(propHistory);
    }
  }, [propHistory]);

  useEffect(() => {
    if (localSettings) {
      setFormData({
        tax_name: localSettings.tax_name,
        filer_rate: localSettings.filer_rate,
        non_filer_rate: localSettings.non_filer_rate,
        exempt_rate: localSettings.exempt_rate ?? 0,
        calculation_basis: localSettings.calculation_basis,
        effective_from: localSettings.effective_from,
        status: localSettings.status,
        tax_applicability: localSettings.tax_applicability,
        change_reason: '',
        changed_by: localSettings.updated_by || 'Authorized Administrator',
      });
    }
  }, [localSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!formData.change_reason.trim()) {
      setError('Please enter a reason or statutory reference for the Advance Tax rate/settings change.');
      return;
    }

    try {
      setSaving(true);
      const res = await api.updateAdvanceTaxSettings(formData);
      setLocalSettings(res.settings);
      setLocalHistory(res.history || []);
      if (onUpdated) {
        onUpdated(res.settings, res.history);
      }
      setSuccessMsg(res.message);
      setFormData((prev) => ({ ...prev, change_reason: '' }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Statutory Policy Notice */}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-950 space-y-1">
          <div className="font-bold">
            Configurable Advance Tax Architecture (FBR Pakistan Statutory Compliance)
          </div>
          <p className="text-amber-800">
            Advance Tax rates are never hard-coded. Each confirmed Purchase Invoice permanently stores
            its applied Advance Tax rate and amount at the time of confirmation. Updating tax rates here
            applies only to new invoices and <strong>never modifies historical invoices</strong>. Advance
            Tax is posted to dedicated account <code className="font-mono font-bold">TAX-1040</code> and
            is never treated as a purchase discount.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-semibold">{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Configuration Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
      >
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold">Advance Tax Configuration Settings</h3>
              <p className="text-[11px] text-slate-400">
                Authorized administrator can update Filer, Non-Filer, and Exempt rates anytime
              </p>
            </div>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
              formData.status === 'Active'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-700 text-slate-300'
            }`}
          >
            {formData.status}
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Rate Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-emerald-950">Filer Tax Rate (%)</label>
                <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                  Default: 0.5%
                </span>
              </div>
              <div className="relative">
                <NumericInput
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={formData.filer_rate}
                  onChange={(e) =>
                    setFormData({ ...formData, filer_rate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 text-base font-mono font-black rounded-lg border border-emerald-400 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="absolute right-3 top-2.5 text-xs font-mono font-bold text-slate-500">
                  %
                </span>
              </div>
              <p className="text-[11px] text-emerald-800">
                Applied automatically when Supplier Filer Status is <strong>Filer</strong>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-amber-950">Non-Filer Tax Rate (%)</label>
                <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">
                  Default: 2.5%
                </span>
              </div>
              <div className="relative">
                <NumericInput
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={formData.non_filer_rate}
                  onChange={(e) =>
                    setFormData({ ...formData, non_filer_rate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 text-base font-mono font-black rounded-lg border border-amber-400 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="absolute right-3 top-2.5 text-xs font-mono font-bold text-slate-500">
                  %
                </span>
              </div>
              <p className="text-[11px] text-amber-800">
                Applied automatically when Supplier Filer Status is <strong>Non-Filer</strong>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-blue-950">Exempt Category Rate (%)</label>
                <span className="text-[10px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">
                  Exempt: 0.0%
                </span>
              </div>
              <div className="relative">
                <NumericInput
                  step="0.01"
                  min="0"
                  max="100"
                  value={formData.exempt_rate}
                  onChange={(e) =>
                    setFormData({ ...formData, exempt_rate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 text-base font-mono font-black rounded-lg border border-blue-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-2.5 text-xs font-mono font-bold text-slate-500">
                  %
                </span>
              </div>
              <p className="text-[11px] text-blue-800">
                Applied automatically when Supplier Filer Status is <strong>Exempt</strong>
              </p>
            </div>
          </div>

          {/* Detailed Settings Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                Tax Name / Statutory Section <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.tax_name}
                onChange={(e) => setFormData({ ...formData, tax_name: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Tax Calculation Basis <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.calculation_basis}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    calculation_basis: e.target.value as AdvanceTaxBasis,
                  })
                }
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              >
                <option value="taxable_plus_gst">Taxable Amount + GST (Standard)</option>
                <option value="taxable_amount">Taxable Amount (Net of Discounts)</option>
                <option value="gross_amount">Gross Invoice Amount</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Effective From Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={formData.effective_from}
                onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Active / Inactive Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.value as 'Active' | 'Inactive',
                  })
                }
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              >
                <option value="Active">Active (Apply Advance Tax)</option>
                <option value="Inactive">Inactive (0% Suspended)</option>
              </select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                Tax Applicability Scope
              </label>
              <input
                type="text"
                required
                value={formData.tax_applicability}
                onChange={(e) => setFormData({ ...formData, tax_applicability: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Authorized By</label>
              <input
                type="text"
                required
                value={formData.changed_by}
                onChange={(e) => setFormData({ ...formData, changed_by: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900"
              />
            </div>

            <div className="space-y-1 sm:col-span-4">
              <label className="block text-xs font-semibold text-slate-700">
                Change Reason / Statutory SRO Reference <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.change_reason}
                onChange={(e) => setFormData({ ...formData, change_reason: e.target.value })}
                placeholder="e.g. Updated per Finance Act / FBR Notification u/s 236H..."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-emerald-400 bg-emerald-50/20 focus:bg-white text-slate-900"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Ledger Account: <strong className="font-mono">TAX-1040 (Advance Tax Receivable)</strong>
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving Tax Settings...' : 'Save Advance Tax Configuration'}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Tax Rate History Audit Log */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Advance Tax Rate Change Audit History ({localHistory.length} Records)
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Immutable audit trail of all statutory and administrative rate updates
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                <th className="py-2.5 px-4">Changed At</th>
                <th className="py-2.5 px-3">Tax Name</th>
                <th className="py-2.5 px-3 text-right">Filer Rate</th>
                <th className="py-2.5 px-3 text-right">Non-Filer Rate</th>
                <th className="py-2.5 px-3">Basis</th>
                <th className="py-2.5 px-3">Effective From</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Authorized By</th>
                <th className="py-2.5 px-4">Reason / Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {localHistory.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                    {formatPKTDateTime(h.changed_at)}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900">{h.tax_name}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                    {Number(h.filer_rate).toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                    {Number(h.non_filer_rate).toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                    {h.calculation_basis}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">{h.effective_from}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        h.status === 'Active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {h.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{h.changed_by}</td>
                  <td className="py-2.5 px-4 text-slate-600">{h.change_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
