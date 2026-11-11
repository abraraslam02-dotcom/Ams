import React, { useState, useEffect, useCallback } from 'react';
import {
  Sliders,
  Building2,
  Printer,
  Database,
  ShieldCheck,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Server,
  Upload,
  RefreshCw,
  FileWarning,
  Network,
  Trash2,
} from 'lucide-react';
import {
  CompanySettings,
  BackupRecord,
  BackupVerificationResult,
  SystemErrorLog,
  InvoiceFieldVisibility,
  DEFAULT_FIELD_VISIBILITY,
  parseFieldVisibility,
} from '../../types/system';
import { api } from '../../services/api';

export type AdminSubTab = 'store-printing' | 'backup-restore' | 'system-admin';

interface SystemSettingsViewProps {
  settings: CompanySettings | null;
  initialSubTab?: AdminSubTab;
  onSettingsUpdated?: (updated: CompanySettings) => void;
  onNavigateToAuditLogs?: () => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  settings: propSettings,
  initialSubTab = 'store-printing',
  onSettingsUpdated,
  onNavigateToAuditLogs,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const [form, setForm] = useState<Partial<CompanySettings>>({});
  const [fieldVisibility, setFieldVisibility] = useState<InvoiceFieldVisibility>({
    ...DEFAULT_FIELD_VISIBILITY,
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Backups & Restore State
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupDir, setBackupDir] = useState<string>('');
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupNotes, setBackupNotes] = useState('');
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verificationResult, setVerificationResult] = useState<BackupVerificationResult | null>(
    null
  );
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  // System Info & Error Logs State
  const [sysInfo, setSysInfo] = useState<any | null>(null);
  const [errorLogs, setErrorLogs] = useState<SystemErrorLog[]>([]);

  // Demo / Temporary Data Management State
  const [demoSummary, setDemoSummary] = useState<any | null>(null);
  const [genuineProtected, setGenuineProtected] = useState<any | null>(null);
  const [loadingDemoData, setLoadingDemoData] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showDemoLogsModal, setShowDemoLogsModal] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);
  const [clearingDemoLogs, setClearingDemoLogs] = useState(false);
  const [demoClearResult, setDemoClearResult] = useState<any | null>(null);
  const [demoLogsClearResult, setDemoLogsClearResult] = useState<any | null>(null);

  const loadSettingsIntoForm = useCallback((s: CompanySettings | null) => {
    if (!s) return;
    setForm({
      ...s,
      default_printer: s.default_printer || 'System Default Printer (OS Print Spooler)',
      default_paper_size: s.default_paper_size || 'a4',
      thermal_printer_width: s.thermal_printer_width || '80mm',
      page_orientation: s.page_orientation || 'portrait',
      page_margin: s.page_margin || 'compact',
      font_size_scale: s.font_size_scale || 'normal',
      print_copies: Number(s.print_copies || 1),
      invoice_heading: s.invoice_heading || 'SALES INVOICE / CASH MEMO',
      invoice_footer_note:
        s.invoice_footer_note ||
        'Thank you for choosing Abrar Medical Store. Medicines once sold are only returnable within 7 days with original invoice & intact batch.',
      backup_directory: s.backup_directory || 'data/backups',
      auto_daily_backup: Number(s.auto_daily_backup ?? 1),
      auto_backup_before_changes: Number(s.auto_backup_before_changes ?? 1),
      backup_retention_days: Number(s.backup_retention_days || 30),
      auto_whatsapp_on_save: Number(s.auto_whatsapp_on_save ?? 0),
      allow_negative_stock: Number(s.allow_negative_stock ?? 1),
      batch_wise_sales: Number(s.batch_wise_sales ?? 1),
      batch_wise_purchase: Number(s.batch_wise_purchase ?? 1),
    });
    try {
      localStorage.setItem(
        'ams_batch_wise_sales',
        Number(s.batch_wise_sales ?? 1) !== 0 ? 'true' : 'false'
      );
      localStorage.setItem(
        'ams_batch_wise_purchase',
        Number(s.batch_wise_purchase ?? 1) !== 0 ? 'true' : 'false'
      );
    } catch {}
    setFieldVisibility(parseFieldVisibility(s.field_visibility_json));
  }, []);

  useEffect(() => {
    loadSettingsIntoForm(propSettings);
  }, [propSettings, loadSettingsIntoForm]);

  const fetchAdminData = useCallback(async () => {
    try {
      const [settingsRes, backupsRes, infoRes, logsRes, demoRes] = await Promise.all([
        api.getCompanySettings().catch(() => null),
        api.getBackups().catch(() => null),
        api.getSystemInfo().catch(() => null),
        api.getSystemErrorLogs().catch(() => null),
        api.getDemoDataSummary().catch(() => null),
      ]);
      if (settingsRes?.data) {
        loadSettingsIntoForm(settingsRes.data);
      }
      if (backupsRes) {
        setBackups(backupsRes.backups || []);
        setBackupDir(backupsRes.backupDirectory || '');
      }
      if (infoRes) {
        setSysInfo(infoRes);
      }
      if (logsRes) {
        setErrorLogs(logsRes.logs || []);
      }
      if (demoRes?.demoSummary) {
        setDemoSummary(demoRes.demoSummary);
        setGenuineProtected(demoRes.genuineProtected);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [loadSettingsIntoForm]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  const handleOpenDemoModal = async () => {
    setDemoClearResult(null);
    setErrorMsg(null);
    setShowDemoModal(true);
    try {
      setLoadingDemoData(true);
      const res = await api.getDemoDataSummary();
      if (res?.demoSummary) {
        setDemoSummary(res.demoSummary);
        setGenuineProtected(res.genuineProtected);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDemoData(false);
    }
  };

  const handleOpenDemoLogsModal = async () => {
    setDemoLogsClearResult(null);
    setErrorMsg(null);
    setShowDemoLogsModal(true);
    try {
      setLoadingDemoData(true);
      const res = await api.getDemoDataSummary();
      if (res?.demoSummary) {
        setDemoSummary(res.demoSummary);
        setGenuineProtected(res.genuineProtected);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDemoData(false);
    }
  };

  const handleExecuteClearDemoData = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setClearingDemo(true);
      setErrorMsg(null);
      const res = await api.clearDemoData();
      setDemoClearResult(res);
      setSuccessMsg(res.message);
      await fetchAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingDemo(false);
    }
  };

  const handleExecuteClearDemoLogs = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setClearingDemoLogs(true);
      setErrorMsg(null);
      const res = await api.clearDemoLogs();
      setDemoLogsClearResult(res);
      setSuccessMsg(res.message);
      await fetchAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingDemoLogs(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const payload = {
        ...form,
        field_visibility_json: JSON.stringify(fieldVisibility),
      };
      const res = await api.updateCompanySettings(payload);
      setSuccessMsg(res.message || 'Store & Printing Settings saved permanently to database.');
      if (res.data) {
        loadSettingsIntoForm(res.data);
        try {
          localStorage.setItem(
            'ams_allow_negative_stock_sales',
            Number(res.data.allow_negative_stock ?? 1) === 1 ? 'true' : 'false'
          );
          localStorage.setItem(
            'ams_batch_wise_sales',
            Number(res.data.batch_wise_sales ?? 1) !== 0 ? 'true' : 'false'
          );
          localStorage.setItem(
            'ams_batch_wise_purchase',
            Number(res.data.batch_wise_purchase ?? 1) !== 0 ? 'true' : 'false'
          );
        } catch {}
        onSettingsUpdated?.(res.data);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, logo_data_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleManualBackupNow = async () => {
    try {
      setCreatingBackup(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await api.createBackup(
        backupNotes.trim() || 'Manual on-demand database backup'
      );
      setSuccessMsg(res.message || 'Database backup created and verified.');
      setBackupNotes('');
      await fetchAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleVerifyBackup = async (backupId: number) => {
    try {
      setVerifyingId(backupId);
      setErrorMsg(null);
      const res = await api.verifyBackup(backupId);
      setVerificationResult(res.verification);
      setSuccessMsg(
        `Verified "${res.verification?.filename}" — Integrity: ${res.verification?.integrityCheck}`
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleConfirmRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreTarget) return;
    if (restoreConfirmText.trim() !== 'RESTORE') {
      setErrorMsg('Please type RESTORE in capital letters to confirm database restoration.');
      return;
    }
    try {
      setRestoring(true);
      setErrorMsg(null);
      const res = await api.restoreBackup(restoreTarget.id, 'RESTORE');
      setSuccessMsg(res.message);
      setRestoreTarget(null);
      setRestoreConfirmText('');
      await fetchAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  };

  const handleResolveErrorLog = async (id: number) => {
    try {
      await api.resolveSystemErrorLog(id);
      await fetchAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12 text-xs">
      {/* Top Sub-Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('store-printing')}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all cursor-pointer ${
              subTab === 'store-printing'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>1. Store Profile & Printing Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('backup-restore')}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all cursor-pointer ${
              subTab === 'backup-restore'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>2. Automatic Database Backup & Recovery ({backups.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('system-admin')}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all cursor-pointer ${
              subTab === 'system-admin'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>3. Clear Demo Data &amp; System Logs</span>
          </button>
        </div>

        <button
          type="button"
          onClick={fetchAdminData}
          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between">
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
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between">
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
          TAB 1: STORE PROFILE & PRINTING SETTINGS
      ===================================================================== */}
      {subTab === 'store-printing' && (
        <form onSubmit={handleSaveSettings} className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Store Identity & Logo */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Store Profile, Licenses & Logo
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold">
                  Printed on Invoices
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Store Trade Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.store_name || ''}
                    onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Legal Entity Name
                  </label>
                  <input
                    type="text"
                    value={form.legal_name || ''}
                    onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Drug Sale License #
                  </label>
                  <input
                    type="text"
                    value={form.drug_license_number || ''}
                    onChange={(e) => setForm({ ...form, drug_license_number: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    National Tax Number (NTN)
                  </label>
                  <input
                    type="text"
                    value={form.ntn_tax_number || ''}
                    onChange={(e) => setForm({ ...form, ntn_tax_number: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Store Physical Address
                  </label>
                  <input
                    type="text"
                    value={form.address || ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Official Email</label>
                  <input
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>

                {/* Store Logo Upload */}
                <div className="sm:col-span-2 p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {form.logo_data_url ? (
                      <img
                        src={form.logo_data_url}
                        alt="Store Logo"
                        className="w-12 h-12 object-contain rounded border border-slate-300 bg-white p-1"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-emerald-900 text-white font-bold flex items-center justify-center">
                        AMS
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-slate-900">Store Logo for Printed Invoices</div>
                      <div className="text-[11px] text-slate-500">
                        Displayed on A4 & Thermal invoices when Logo visibility is enabled
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Logo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                    {form.logo_data_url && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, logo_data_url: '' })}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-700 font-bold cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Default Printer, Paper Size & Layout Controls */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Printer className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Default Printer, Paper Size & Thermal Roll Settings
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-bold">
                  A4 • 80mm • 58mm
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Default Printer Name
                  </label>
                  <input
                    type="text"
                    value={form.default_printer || ''}
                    onChange={(e) => setForm({ ...form, default_printer: e.target.value })}
                    placeholder="e.g. EPSON TM-T88VI / HP LaserJet"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Default Paper Size
                  </label>
                  <select
                    value={form.default_paper_size || 'a4'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        default_paper_size: e.target.value as 'a4' | '80mm' | '58mm',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="a4">A4 Full Page (210mm × 297mm)</option>
                    <option value="80mm">80mm Thermal Receipt Roll</option>
                    <option value="58mm">58mm Compact Thermal Roll</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Thermal Roll Width
                  </label>
                  <select
                    value={form.thermal_printer_width || '80mm'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        thermal_printer_width: e.target.value as '80mm' | '58mm',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="80mm">80mm Standard POS Roll</option>
                    <option value="58mm">58mm Narrow POS Roll</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Page Orientation (A4)
                  </label>
                  <select
                    value={form.page_orientation || 'portrait'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        page_orientation: e.target.value as 'portrait' | 'landscape',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Page Margins</label>
                  <select
                    value={form.page_margin || 'compact'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        page_margin: e.target.value as
                          | 'none'
                          | 'minimum'
                          | 'compact'
                          | 'standard',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="none">None (0mm)</option>
                    <option value="minimum">Minimum (3mm)</option>
                    <option value="compact">Compact (6mm)</option>
                    <option value="standard">Standard (10mm)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Default Font Size Scale
                  </label>
                  <select
                    value={form.font_size_scale || 'normal'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        font_size_scale: e.target.value as 'small' | 'normal' | 'large',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold bg-white"
                  >
                    <option value="small">Small (High Density)</option>
                    <option value="normal">Normal (Balanced)</option>
                    <option value="large">Large (High Legibility)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Number of Print Copies
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={form.print_copies || 1}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        print_copies: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Invoice Headings, Terms & Field Visibility Controls */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2.5">
              Invoice Headings, Footer Note & Optional Field Visibility
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Invoice Heading
                </label>
                <input
                  type="text"
                  value={form.invoice_heading || ''}
                  onChange={(e) => setForm({ ...form, invoice_heading: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Invoice Footer Note / Terms & Conditions
                </label>
                <input
                  type="text"
                  value={form.invoice_footer_note || ''}
                  onChange={(e) => setForm({ ...form, invoice_footer_note: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="pt-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Show / Hide Individual Invoice Fields on Printouts (Including Salesman &
                Deliveryman)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                {(
                  [
                    { key: 'showLogo', label: 'Store Logo' },
                    { key: 'showDrugLicense', label: 'Drug License #' },
                    { key: 'showNtn', label: 'NTN Tax #' },
                    { key: 'showItemCode', label: 'Item Code' },
                    { key: 'showCompany', label: 'Manufacturer' },
                    { key: 'showPacking', label: 'Packing' },
                    { key: 'showBatchExpiry', label: 'Batch & Expiry' },
                    { key: 'showBonus', label: 'Bonus Qty' },
                    { key: 'showDiscount', label: 'Discount Col' },
                    { key: 'showTax', label: 'Tax / GST Col' },
                    { key: 'showPreviousBalance', label: 'Previous Balance' },
                    { key: 'showSalesman', label: 'Salesman Name' },
                    { key: 'showDeliveryman', label: 'Deliveryman Name' },
                    { key: 'showFooter', label: 'Footer Notes' },
                    { key: 'showSignature', label: 'Signature Line' },
                  ] as Array<{ key: keyof InvoiceFieldVisibility; label: string }>
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(fieldVisibility[item.key])}
                      onChange={(e) =>
                        setFieldVisibility((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>

              {/* Sales & Purchase Batch / Stock / WhatsApp Toggles */}
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-blue-50/80 border border-blue-200 cursor-pointer">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <span>Batch-Wise Sales</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          (form.batch_wise_sales ?? 1) !== 0
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-400 text-white'
                        }`}
                      >
                        {(form.batch_wise_sales ?? 1) !== 0 ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      When ON: Select batch with expiry date &amp; stock during sales and deduct from
                      selected batch. When OFF: Hide batch selection from sales form and bill
                      item-wise while preserving existing batch records.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={(form.batch_wise_sales ?? 1) !== 0}
                    onChange={(e) => {
                      const nextVal = e.target.checked ? 1 : 0;
                      setForm((prev) => ({ ...prev, batch_wise_sales: nextVal }));
                      try {
                        localStorage.setItem('ams_batch_wise_sales', nextVal === 1 ? 'true' : 'false');
                      } catch {}
                      api
                        .updateBatchSettings({ batch_wise_sales: nextVal })
                        .then((r) => {
                          if (r?.data) onSettingsUpdated?.(r.data);
                        })
                        .catch(() => {});
                    }}
                    className="w-4 h-4 rounded border-blue-400 text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-indigo-50/80 border border-indigo-200 cursor-pointer">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <span>Batch-Wise Purchase</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          (form.batch_wise_purchase ?? 1) !== 0
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-400 text-white'
                        }`}
                      >
                        {(form.batch_wise_purchase ?? 1) !== 0 ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      When ON: Enter batch number, expiry date &amp; batch quantity during purchase.
                      When OFF: Hide batch fields from purchase form and update total item stock
                      while preserving existing batch records.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={(form.batch_wise_purchase ?? 1) !== 0}
                    onChange={(e) => {
                      const nextVal = e.target.checked ? 1 : 0;
                      setForm((prev) => ({ ...prev, batch_wise_purchase: nextVal }));
                      try {
                        localStorage.setItem(
                          'ams_batch_wise_purchase',
                          nextVal === 1 ? 'true' : 'false'
                        );
                      } catch {}
                      api
                        .updateBatchSettings({ batch_wise_purchase: nextVal })
                        .then((r) => {
                          if (r?.data) onSettingsUpdated?.(r.data);
                        })
                        .catch(() => {});
                    }}
                    className="w-4 h-4 rounded border-indigo-400 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50/80 border border-amber-200 cursor-pointer">
                  <div>
                    <div className="font-bold text-slate-900">
                      Allow Negative Stock for Sales Invoices
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      When enabled, counter staff can bill and complete Sales Invoices even when an
                      item&apos;s current batch stock is zero or negative (stock automatically
                      reconciles when purchase bills are entered).
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.allow_negative_stock !== undefined ? Boolean(form.allow_negative_stock) : true}
                    onChange={(e) =>
                      setForm({ ...form, allow_negative_stock: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-green-50/70 border border-green-200 cursor-pointer">
                  <div>
                    <div className="font-bold text-slate-900">
                      Auto-send via WhatsApp on Sales Invoice Save
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      When enabled, saving a Sales Invoice automatically opens/sends the customer&apos;s
                      WhatsApp invoice message &amp; PDF using their saved mobile number.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(form.auto_whatsapp_on_save)}
                    onChange={(e) =>
                      setForm({ ...form, auto_whatsapp_on_save: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4 rounded border-green-400 text-green-600 focus:ring-green-500"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {saving
                  ? 'Saving Settings...'
                  : 'Save Store Profile & Printing Settings Permanently'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* =====================================================================
          TAB 2: AUTOMATIC DATABASE BACKUP & DATA RECOVERY
      ===================================================================== */}
      {subTab === 'backup-restore' && (
        <div className="space-y-5">
          {/* Backup Controls & Configuration Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-600" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      On-Demand & Automatic Database Backup
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Uses SQLite WAL-safe VACUUM INTO snapshot with automatic PRAGMA integrity
                      verification
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-emerald-400 font-mono font-bold text-[11px]">
                  Snapshots: {backups.length}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={backupNotes}
                  onChange={(e) => setBackupNotes(e.target.value)}
                  placeholder="Optional backup label (e.g. Before Month-End Closing)..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300"
                />
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={handleManualBackupNow}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Database className="w-4 h-4" />
                  <span>{creatingBackup ? 'Creating Backup...' : 'Backup Now'}</span>
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Active Backup Directory:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {backupDir || form.backup_directory || 'data/backups'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Number(form.auto_daily_backup ?? 1) === 1}
                      onChange={async (e) => {
                        const val = e.target.checked ? 1 : 0;
                        const next = { ...form, auto_daily_backup: val };
                        setForm(next);
                        await api.updateCompanySettings(next);
                      }}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Automatic Daily Backup</span>
                  </label>
                  <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Number(form.auto_backup_before_changes ?? 1) === 1}
                      onChange={async (e) => {
                        const val = e.target.checked ? 1 : 0;
                        const next = { ...form, auto_backup_before_changes: val };
                        setForm(next);
                        await api.updateCompanySettings(next);
                      }}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Auto-Backup Before Major Changes</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Data Protection & Recovery Safeguards Card */}
            <div className="lg:col-span-5 bg-slate-900 text-white rounded-2xl p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">
                    Data Recovery & Safety Architecture
                  </h3>
                </div>
                <ul className="space-y-1.5 text-[11px] text-slate-300 list-disc pl-4">
                  <li>
                    <strong>Pre-Restore Safety Snapshot:</strong> Restoring any backup automatically
                    creates a fresh <code>pre_restore_safety</code> backup of the current database
                    first.
                  </li>
                  <li>
                    <strong>Integrity Check:</strong> Every backup is validated with{' '}
                    <code>PRAGMA integrity_check</code> and core table verification before restore.
                  </li>
                  <li>
                    <strong>Zero Silent Overwrites:</strong> Explicit administrator confirmation is
                    required before restoring.
                  </li>
                </ul>
              </div>

              {verificationResult && (
                <div className="p-3 rounded-xl bg-slate-950 border border-emerald-700/60 text-[11px] space-y-1">
                  <div className="font-bold text-emerald-400">
                    Verified: {verificationResult.filename} ({verificationResult.integrityCheck})
                  </div>
                  <div className="font-mono text-slate-300">
                    Tables: {verificationResult.tablesCount} • Items:{' '}
                    {verificationResult.coreCounts?.items} • Accounts:{' '}
                    {verificationResult.coreCounts?.accounts} • Sales:{' '}
                    {verificationResult.coreCounts?.sales} • Purchases:{' '}
                    {verificationResult.coreCounts?.purchases}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Backup History Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Backup History & Point-in-Time Restore Center
                </h3>
                <p className="text-[11px] text-slate-400">
                  Download backup files to external storage or restore any verified snapshot
                </p>
              </div>
              <span className="font-mono text-[11px] text-emerald-400">
                Total Snapshots: {backups.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3">Backup Filename</th>
                    <th className="py-3 px-2.5">Type</th>
                    <th className="py-3 px-2.5">Date & Time</th>
                    <th className="py-3 px-2.5 text-right">Size</th>
                    <th className="py-3 px-2.5 text-center">Integrity Status</th>
                    <th className="py-3 px-2.5">Created By / Notes</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No database backups recorded yet. Click "Backup Now" to create one.
                      </td>
                    </tr>
                  ) : (
                    backups.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          {b.filename}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              b.backup_type === 'manual'
                                ? 'bg-emerald-100 text-emerald-800'
                                : b.backup_type === 'pre_restore_safety'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {b.backup_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 font-mono">{b.created_at}</td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-semibold">
                          {formatBytes(b.file_size_bytes)}
                        </td>
                        <td className="py-2.5 px-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              b.status === 'completed' && b.file_exists !== false
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {b.file_exists === false ? 'Missing File' : b.integrity_status || 'OK'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-semibold text-slate-800">{b.created_by}</div>
                          <div className="text-[10px] text-slate-500">{b.notes || ''}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={verifyingId === b.id || b.file_exists === false}
                              onClick={() => handleVerifyBackup(b.id)}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer disabled:opacity-40"
                            >
                              {verifyingId === b.id ? 'Checking...' : 'Verify'}
                            </button>
                            {b.file_exists !== false && (
                              <button
                                type="button"
                                onClick={() => api.downloadBackup(b.id, b.filename)}
                                className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={b.file_exists === false}
                              onClick={() => {
                                setRestoreTarget(b);
                                setRestoreConfirmText('');
                              }}
                              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Restore
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Restore Confirmation Modal */}
          {restoreTarget && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <form
                onSubmit={handleConfirmRestore}
                className="bg-white rounded-2xl border border-amber-300 shadow-2xl w-full max-w-md p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-amber-800 border-b border-slate-200 pb-3">
                  <RotateCcw className="w-5 h-5" />
                  <h3 className="text-sm font-bold">Confirm Database Restoration</h3>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1 text-[11px]">
                  <div>
                    <span className="text-slate-500">Selected Backup File: </span>
                    <strong className="font-mono text-slate-900">{restoreTarget.filename}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Backup Date & Time: </span>
                    <strong className="font-mono">{restoreTarget.created_at}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">File Size: </span>
                    <strong className="font-mono">
                      {formatBytes(restoreTarget.file_size_bytes)}
                    </strong>
                  </div>
                  <div className="text-emerald-800 font-semibold pt-1">
                    ✓ A safety backup of your current database will be created automatically before
                    restoring.
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    Type <code className="text-rose-600 font-mono">RESTORE</code> to confirm:
                  </label>
                  <input
                    type="text"
                    required
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder="RESTORE"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRestoreTarget(null)}
                    className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={restoring || restoreConfirmText !== 'RESTORE'}
                    className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer disabled:opacity-40"
                  >
                    {restoring ? 'Restoring Database...' : 'Confirm & Restore Backup'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 3: SYSTEM ADMINISTRATION, CLEAR DEMO DATA & LOGS
      ===================================================================== */}
      {subTab === 'system-admin' && (
        <div className="space-y-4">
          {/* 1. Clear Temporary / Demo Data Card (Strictly Protects Genuine Business Records) */}
          <div className="bg-white rounded-2xl border border-rose-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3 bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-700/80 text-white">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Clear Temporary / Demo Data</h3>
                  <p className="text-[11px] text-rose-200">
                    Purge test and sample records while strictly safeguarding genuine business items, accounts, and transactions
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-rose-950/80 border border-rose-600/50 text-rose-300 font-mono text-xs font-bold">
                Detected Demo Records: {demoSummary?.totalDemoRecords ?? 0}
              </span>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                  <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Genuine Business Data Protection Guarantee</span>
                  </h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    This utility permanently protects your genuine master data. It will <strong>never delete</strong> real catalog medicines, chart of accounts, active customer/supplier ledgers, genuine purchase bills, or confirmed sales invoices.
                  </p>
                  {genuineProtected && (
                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-1.5 rounded bg-white border border-slate-200">
                        Protected Items: <strong>{genuineProtected.genuineItems}</strong>
                      </div>
                      <div className="p-1.5 rounded bg-white border border-slate-200">
                        Protected Accounts: <strong>{genuineProtected.genuineAccounts}</strong>
                      </div>
                      <div className="p-1.5 rounded bg-white border border-slate-200">
                        Genuine Sales: <strong>{genuineProtected.genuineSales}</strong>
                      </div>
                      <div className="p-1.5 rounded bg-white border border-slate-200">
                        Genuine Purchases: <strong>{genuineProtected.genuinePurchases}</strong>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200 text-xs space-y-2 flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-rose-900 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      <span>Targeted Demo & Sample Data</span>
                    </h4>
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      Removes only records explicitly tagged with demo or test flags, sample test invoices, test vouchers, unlinked test stock adjustments, and expired sessions.
                    </p>
                    {demoSummary && (
                      <div className="flex flex-wrap gap-2 pt-2 text-[11px] font-mono text-rose-800">
                        <span>Test Sales: <strong>{demoSummary.demoSales}</strong></span> •
                        <span>Test Purchases: <strong>{demoSummary.demoPurchases}</strong></span> •
                        <span>Test Vouchers: <strong>{demoSummary.demoVouchers}</strong></span> •
                        <span>Expired Sessions: <strong>{demoSummary.expiredSessions}</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleOpenDemoModal}
                      disabled={loadingDemoData}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>{loadingDemoData ? 'Inspecting Data...' : 'Clear Demo Data'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenDemoLogsModal}
                      disabled={loadingDemoData}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <FileWarning className="w-4 h-4" />
                      <span>Clear Demo Logs</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Application Error & Exception Audit Log */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold">System Error & Exception Audit Log</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400">
                  Entries: {errorLogs.length}
                </span>
                <button
                  type="button"
                  onClick={handleOpenDemoLogsModal}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Demo Logs</span>
                </button>
                {onNavigateToAuditLogs && (
                  <button
                    type="button"
                    onClick={onNavigateToAuditLogs}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Open Security &amp; Login Audit Logs ↗
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Timestamp</th>
                    <th className="p-2.5">Severity</th>
                    <th className="p-2.5">Module / Operation</th>
                    <th className="p-2.5">Message</th>
                    <th className="p-2.5">User</th>
                    <th className="p-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {errorLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-5 text-center text-emerald-700 font-semibold">
                        ✓ Zero unresolved application errors recorded.
                      </td>
                    </tr>
                  ) : (
                    errorLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono">{log.created_at}</td>
                        <td className="p-2.5 font-bold uppercase text-rose-700">{log.severity}</td>
                        <td className="p-2.5 font-mono">
                          {log.module} {log.operation ? `(${log.operation})` : ''}
                        </td>
                        <td className="p-2.5 text-slate-800">{log.user_message}</td>
                        <td className="p-2.5 font-mono">{log.username || 'system'}</td>
                        <td className="p-2.5 text-right">
                          {log.resolved ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Resolved
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleResolveErrorLog(log.id)}
                              className="px-2.5 py-1 rounded bg-slate-900 text-white text-[10px] font-bold cursor-pointer"
                            >
                              Mark Resolved
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Runtime & LAN Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Application Version & Runtime */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 font-bold">
                <Sliders className="w-4 h-4" />
                <span>Application Version & Architecture</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div>
                  Version: <strong>{sysInfo?.appInfo?.version || '2.10.0-ERP'}</strong>
                </div>
                <div>
                  Node Runtime: <strong>{sysInfo?.appInfo?.nodeVersion || 'v22+'}</strong> (
                  {sysInfo?.appInfo?.platform || 'linux'})
                </div>
                <div>
                  Memory Usage: <strong>{sysInfo?.appInfo?.memoryUsageMb || 0} MB</strong>
                </div>
              </div>
            </div>

            {/* Database Record Counts */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-bold">
                <Database className="w-4 h-4" />
                <span>Live SQLite WAL Database Metrics</span>
              </div>
              {sysInfo?.recordCounts && (
                <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Items: <strong>{sysInfo.recordCounts.items}</strong>
                  </div>
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Batches: <strong>{sysInfo.recordCounts.inventoryBatches}</strong>
                  </div>
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Accounts: <strong>{sysInfo.recordCounts.accounts}</strong>
                  </div>
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Sales: <strong>{sysInfo.recordCounts.sales}</strong>
                  </div>
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Purchases: <strong>{sysInfo.recordCounts.purchases}</strong>
                  </div>
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                    Vouchers: <strong>{sysInfo.recordCounts.vouchers}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Local Area Network (LAN) Multi-Counter Access */}
            <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <Network className="w-4 h-4" />
                <span>Multi-Computer LAN Access Ready</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Other counter computers on the store Wi-Fi/LAN can connect to this central server on
                port <strong>{sysInfo?.networkReadiness?.port || 3000}</strong>:
              </p>
              <div className="font-mono text-[11px] text-emerald-300 space-y-0.5">
                {((sysInfo?.networkReadiness?.lanEndpoints as Array<
                  string | { interfaceName?: string; address?: string; url?: string }
                >) || ['http://localhost:3000']).map((endpoint, idx) => {
                  const displayUrl =
                    typeof endpoint === 'string'
                      ? endpoint
                      : endpoint?.url || endpoint?.address || 'http://localhost:3000';
                  const iface =
                    typeof endpoint === 'object' && endpoint?.interfaceName
                      ? ` (${endpoint.interfaceName})`
                      : '';
                  return (
                    <div key={`${displayUrl}-${idx}`}>
                      {displayUrl}
                      {iface}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Clear Demo Data Confirmation Modal */}
          {showDemoModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <form
                onSubmit={handleExecuteClearDemoData}
                className="bg-white rounded-2xl border border-rose-300 shadow-2xl w-full max-w-xl p-5 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2 text-rose-800">
                    <Trash2 className="w-5 h-5 text-rose-600" />
                    <h3 className="text-sm font-bold">Clear Temporary / Demo Data Confirmation</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDemoModal(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Safety Protection & Automatic Snapshot</span>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Before any records are deleted, the system automatically takes a fresh snapshot backup of your SQLite database. Genuine catalog items, ledger accounts, inventory, and real customer/supplier transactions will be preserved without modification.
                  </p>
                </div>

                {/* Comparison Breakdown */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-1.5">
                    <div className="font-bold text-rose-900 uppercase text-[10px] tracking-wider">
                      Demo Records To Be Cleared
                    </div>
                    <ul className="space-y-1 text-[11px] text-rose-800 font-mono">
                      <li>• Demo / Test Sales: <strong>{demoSummary?.demoSales || 0}</strong></li>
                      <li>• Demo / Test Purchases: <strong>{demoSummary?.demoPurchases || 0}</strong></li>
                      <li>• Demo Vouchers: <strong>{demoSummary?.demoVouchers || 0}</strong></li>
                      <li>• Demo Stock Adjustments: <strong>{demoSummary?.demoStockAdjustments || 0}</strong></li>
                      <li>• Expired Sessions: <strong>{demoSummary?.expiredSessions || 0}</strong></li>
                      <li>• Error Logs: <strong>{demoSummary?.resolvedErrorLogs || 0}</strong></li>
                      <li>• Demo Items: <strong>{demoSummary?.demoItems || 0}</strong></li>
                    </ul>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 uppercase text-[10px] tracking-wider">
                      Genuine Data Protected
                    </div>
                    <ul className="space-y-1 text-[11px] text-slate-700 font-mono">
                      <li>✓ Genuine Items Catalog: <strong>{genuineProtected?.genuineItems || 0}</strong></li>
                      <li>✓ Chart of Accounts: <strong>{genuineProtected?.genuineAccounts || 0}</strong></li>
                      <li>✓ Confirmed Sales: <strong>{genuineProtected?.genuineSales || 0}</strong></li>
                      <li>✓ Confirmed Purchases: <strong>{genuineProtected?.genuinePurchases || 0}</strong></li>
                      <li>✓ Stock Batches: <strong>{genuineProtected?.inventoryBatches || 0}</strong></li>
                    </ul>
                  </div>
                </div>

                {demoClearResult && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 space-y-1">
                    <div className="font-bold">✓ {demoClearResult.message}</div>
                    <div className="text-[11px] font-mono text-emerald-800">
                      Safety Backup Created: <strong>{demoClearResult.safetyBackup?.filename}</strong>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowDemoModal(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 font-semibold text-xs cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={clearingDemo}
                    className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{clearingDemo ? 'Clearing Demo Data...' : 'Confirm & Clear Demo Data'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Clear Demo Logs Confirmation Modal */}
          {showDemoLogsModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <form
                onSubmit={handleExecuteClearDemoLogs}
                className="bg-white rounded-2xl border border-amber-300 shadow-2xl w-full max-w-lg p-5 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2 text-amber-800">
                    <FileWarning className="w-5 h-5 text-amber-600" />
                    <h3 className="text-sm font-bold">Clear Demo &amp; Temporary Logs Confirmation</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDemoLogsModal(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-1.5">
                  <div className="font-bold">What will be cleared:</div>
                  <ul className="space-y-1 text-[11px] font-mono">
                    <li>• System Error Logs: <strong>{demoSummary?.resolvedErrorLogs ?? errorLogs.length}</strong></li>
                    <li>• Demo / Session Audit Logs: <strong>{demoSummary?.demoAuditLogs ?? 0}</strong></li>
                    <li>• Expired User Sessions: <strong>{demoSummary?.expiredSessions ?? 0}</strong></li>
                  </ul>
                  <p className="text-[11px] text-emerald-800 font-semibold pt-1">
                    ✓ Genuine business transaction logs, sales, purchases, stock, and accounts are never deleted.
                  </p>
                </div>

                {demoLogsClearResult && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 font-bold">
                    ✓ {demoLogsClearResult.message}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowDemoLogsModal(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 font-semibold text-xs cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={clearingDemoLogs}
                    className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{clearingDemoLogs ? 'Clearing Logs...' : 'Confirm & Clear Demo Logs'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
