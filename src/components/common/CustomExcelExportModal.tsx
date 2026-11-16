import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  X,
  CheckSquare,
  Square,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  Star,
  Edit3,
  Download,
  Eye,
  Plus,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  SALES_CUSTOM_EXPORT_FIELDS,
  PURCHASE_CUSTOM_EXPORT_FIELDS,
  CustomExportFieldDef,
  CustomExportCategory,
  buildCustomExportRows,
  exportCustomInvoicesToExcel,
} from '../../utils/invoiceExcelExport';
import { api } from '../../services/api';

export interface SavedExportTemplate {
  id: number;
  module_type: 'SALES' | 'PURCHASE';
  template_name: string;
  fields: string[];
  is_default: boolean;
  created_by?: string;
  updated_at?: string;
}

export interface CustomExcelExportModalProps {
  isOpen: boolean;
  moduleType: 'SALES' | 'PURCHASE';
  /** Invoices passed directly (e.g. current invoice or current register selection) */
  initialInvoices?: Array<Record<string, any>>;
  records?: Array<Record<string, any>>;
  defaultFilename?: string;
  /** Optional callback to load all saved invoices from the database when user selects "All Saved Invoices" */
  onFetchAllInvoices?: () => Promise<Array<Record<string, any>>>;
  defaultScope?: 'current' | 'all';
  onClose: () => void;
  onExportSuccess?: (message: string) => void;
}

const CATEGORIES: CustomExportCategory[] = [
  'Invoice Information',
  'Item Information',
  'Financial Information',
];

export const CustomExcelExportModal: React.FC<CustomExcelExportModalProps> = ({
  isOpen,
  moduleType,
  initialInvoices,
  records,
  onFetchAllInvoices,
  defaultScope = 'current',
  onClose,
  onExportSuccess,
}) => {
  const resolvedInitialInvoices = useMemo(
    () => (Array.isArray(records) && records.length > 0 ? records : initialInvoices || []),
    [records, initialInvoices]
  );

  const resolvedFetchAllInvoices = useMemo(() => {
    if (onFetchAllInvoices) return onFetchAllInvoices;
    return async () => {
      if (moduleType === 'PURCHASE') {
        const res = await api.getPurchases();
        return res?.purchases || res?.data || [];
      }
      const res = await api.getSales({ status: 'completed', exportAll: true });
      return res?.data || res?.sales || [];
    };
  }, [onFetchAllInvoices, moduleType]);

  const catalog: CustomExportFieldDef[] = useMemo(
    () => (moduleType === 'PURCHASE' ? PURCHASE_CUSTOM_EXPORT_FIELDS : SALES_CUSTOM_EXPORT_FIELDS),
    [moduleType]
  );

  const catalogByKey = useMemo(() => {
    const map = new Map<string, CustomExportFieldDef>();
    catalog.forEach((f) => map.set(f.key, f));
    return map;
  }, [catalog]);

  // Selected field keys in exact export order
  const [selectedFields, setSelectedFields] = useState<string[]>(() =>
    catalog.slice(0, 12).map((f) => f.key)
  );

  // Saved templates state
  const [templates, setTemplates] = useState<SavedExportTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState<boolean>(false);

  // Template management UI states
  const [showSavePrompt, setShowSavePrompt] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [newTemplateDefault, setNewTemplateDefault] = useState<boolean>(false);
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    templateName: string;
    isDefault: boolean;
  } | null>(null);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Drag and drop state for column reordering
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Data scope ('current' = resolvedInitialInvoices, 'all' = fetched all saved invoices)
  const [exportScope, setExportScope] = useState<'current' | 'all'>(
    resolvedInitialInvoices.length > 0 ? defaultScope : 'all'
  );
  const [allInvoicesCache, setAllInvoicesCache] = useState<Array<Record<string, any>> | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState<boolean>(false);

  // Status messages
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [exporting, setExporting] = useState<boolean>(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => {
      setStatusMsg((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Load saved templates for this module when modal opens
  const fetchTemplates = async (autoApplyDefault = false) => {
    try {
      setLoadingTemplates(true);
      const res = await api.getExcelExportTemplates(moduleType);
      const list = Array.isArray(res?.templates) ? res.templates : [];
      setTemplates(list);

      if (autoApplyDefault && list.length > 0) {
        const defTpl = list.find((t) => t.is_default) || list[0];
        if (defTpl && Array.isArray(defTpl.fields) && defTpl.fields.length > 0) {
          const validKeys = defTpl.fields.filter((k) => catalogByKey.has(k));
          if (validKeys.length > 0) {
            setSelectedFields(validKeys);
            setActiveTemplateId(defTpl.id);
          }
        }
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Could not load saved templates.');
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setAllInvoicesCache(null);
    setExportScope(resolvedInitialInvoices.length > 0 ? defaultScope : 'all');
    fetchTemplates(true);
  }, [isOpen, moduleType, resolvedInitialInvoices.length, defaultScope]);

  // Load all invoices when exportScope === 'all'
  useEffect(() => {
    if (!isOpen) return;
    if (exportScope === 'all' && !allInvoicesCache) {
      let mounted = true;
      setLoadingInvoices(true);
      resolvedFetchAllInvoices()
        .then((rows) => {
          if (mounted) {
            setAllInvoicesCache(Array.isArray(rows) ? rows : []);
          }
        })
        .catch((err: any) => {
          if (mounted) {
            showToast('error', err?.message || 'Failed to fetch invoices for export.');
          }
        })
        .finally(() => {
          if (mounted) setLoadingInvoices(false);
        });
      return () => {
        mounted = false;
      };
    }
  }, [isOpen, exportScope, allInvoicesCache, resolvedFetchAllInvoices]);

  const activeInvoices = useMemo(() => {
    if (exportScope === 'all' && allInvoicesCache) {
      return allInvoicesCache;
    }
    return resolvedInitialInvoices;
  }, [exportScope, allInvoicesCache, resolvedInitialInvoices]);

  // Live preview data (first 12 item rows)
  const previewData = useMemo(() => {
    const sampleInvoices = activeInvoices.slice(0, 15);
    const { headers, rows } = buildCustomExportRows(moduleType, sampleInvoices, selectedFields);
    return {
      headers,
      rows: rows.slice(0, 10),
      totalPreviewRows: rows.length,
    };
  }, [moduleType, activeInvoices, selectedFields]);

  if (!isOpen) return null;

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) || null;

  // Toggle individual field
  const handleToggleField = (key: string) => {
    setSelectedFields((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  // Select All / Deselect All
  const handleSelectAll = () => {
    // Keep existing order of already-selected fields, and append remaining fields in catalog order
    setSelectedFields((prev) => {
      const existingSet = new Set(prev);
      const remaining = catalog.map((f) => f.key).filter((k) => !existingSet.has(k));
      return [...prev, ...remaining];
    });
  };

  const handleDeselectAll = () => {
    setSelectedFields([]);
  };

  const handleSelectCategory = (category: CustomExportCategory, select: boolean) => {
    const catKeys = catalog.filter((f) => f.category === category).map((f) => f.key);
    const catSet = new Set(catKeys);
    if (select) {
      setSelectedFields((prev) => {
        const existing = new Set(prev);
        const toAdd = catKeys.filter((k) => !existing.has(k));
        return [...prev, ...toAdd];
      });
    } else {
      setSelectedFields((prev) => prev.filter((k) => !catSet.has(k)));
    }
  };

  // Move column Up / Down
  const handleMoveField = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= selectedFields.length) return;
    setSelectedFields((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  };

  // Drag-and-Drop handlers for selected columns
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragOverIdx !== idx) {
      setDragOverIdx(idx);
    }
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === dropIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    setSelectedFields((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(draggedIdx, 1);
      copy.splice(dropIdx, 0, moved);
      return copy;
    });
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Load a saved template
  const handleSelectTemplate = (tplIdStr: string) => {
    const id = Number(tplIdStr);
    if (!id) {
      setActiveTemplateId(null);
      return;
    }
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const validKeys = tpl.fields.filter((k) => catalogByKey.has(k));
    setSelectedFields(validKeys);
    setActiveTemplateId(tpl.id);
    showToast('success', `Loaded template "${tpl.template_name}" (${validKeys.length} columns).`);
  };

  // Save a new template
  const handleSaveTemplate = async (forceOverwrite = false) => {
    const cleanName = (overwriteConfirm ? overwriteConfirm.templateName : newTemplateName).trim();
    const isDef = overwriteConfirm ? overwriteConfirm.isDefault : newTemplateDefault;

    if (!cleanName) {
      showToast('error', 'Please enter a template name.');
      return;
    }
    if (selectedFields.length === 0) {
      showToast('error', 'Please select at least one column before saving a template.');
      return;
    }

    try {
      const res = await api.saveExcelExportTemplate({
        module_type: moduleType,
        template_name: cleanName,
        fields: selectedFields,
        is_default: isDef,
        overwrite: forceOverwrite,
      });

      if (res.exists && !forceOverwrite) {
        setOverwriteConfirm({ templateName: cleanName, isDefault: isDef });
        return;
      }

      setOverwriteConfirm(null);
      setShowSavePrompt(false);
      setNewTemplateName('');
      setNewTemplateDefault(false);
      await fetchTemplates(false);
      if (res.id) {
        setActiveTemplateId(res.id);
      }
      showToast('success', res.message || `Template "${cleanName}" saved.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save template.');
    }
  };

  // Update currently active template with current fields / order
  const handleUpdateCurrentTemplate = async () => {
    if (!activeTemplate) return;
    if (selectedFields.length === 0) {
      showToast('error', 'Please select at least one field.');
      return;
    }
    try {
      await api.updateExcelExportTemplate(activeTemplate.id, {
        fields: selectedFields,
      });
      await fetchTemplates(false);
      showToast('success', `Updated columns & order for "${activeTemplate.template_name}".`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update template.');
    }
  };

  // Toggle Default status on active template
  const handleToggleDefaultTemplate = async () => {
    if (!activeTemplate) return;
    try {
      await api.updateExcelExportTemplate(activeTemplate.id, {
        is_default: !activeTemplate.is_default,
      });
      await fetchTemplates(false);
      showToast(
        'success',
        !activeTemplate.is_default
          ? `"${activeTemplate.template_name}" set as Default ${moduleType} Template.`
          : `Removed default status from "${activeTemplate.template_name}".`
      );
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update default template.');
    }
  };

  // Rename active template
  const handleConfirmRename = async () => {
    if (!renamingId || !renameText.trim()) return;
    try {
      await api.updateExcelExportTemplate(renamingId, {
        template_name: renameText.trim(),
      });
      setRenamingId(null);
      setRenameText('');
      await fetchTemplates(false);
      showToast('success', 'Template renamed successfully.');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to rename template.');
    }
  };

  // Delete active template
  const handleConfirmDelete = async (id: number) => {
    try {
      await api.deleteExcelExportTemplate(id);
      setDeleteConfirmId(null);
      if (activeTemplateId === id) {
        setActiveTemplateId(null);
      }
      await fetchTemplates(false);
      showToast('success', 'Template deleted.');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete template.');
    }
  };

  // Execute Custom Excel Export
  const handleExecuteExport = async () => {
    if (selectedFields.length === 0) {
      showToast('error', 'Please select at least one column to export.');
      return;
    }

    try {
      setExporting(true);
      let targetInvoices = activeInvoices;

      if (targetInvoices.length === 0) {
        const fetched = await resolvedFetchAllInvoices();
        targetInvoices = Array.isArray(fetched) ? fetched : [];
        setAllInvoicesCache(targetInvoices);
      }

      if (targetInvoices.length === 0) {
        showToast('error', 'No invoice records available to export.');
        return;
      }

      const tplSlug = activeTemplate
        ? `_${activeTemplate.template_name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        : '';
      const dateStr = new Date().toISOString().slice(0, 10);
      const customFileName = `${
        moduleType === 'PURCHASE' ? 'Purchase' : 'Sales'
      }_Custom_Export${tplSlug}_${dateStr}.xlsx`;

      const result = exportCustomInvoicesToExcel(
        moduleType,
        targetInvoices,
        selectedFields,
        customFileName
      );

      const msg = `Exported ${result.rowCount} item row(s) across ${targetInvoices.length} ${
        moduleType === 'PURCHASE' ? 'Purchase' : 'Sales'
      } invoice(s) (${result.columnCount} columns) to ${result.fileName}.`;

      showToast('success', msg);
      if (onExportSuccess) {
        onExportSuccess(msg);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 lg:p-4 overflow-y-auto print:hidden">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-7xl max-h-[95vh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">
                {moduleType === 'PURCHASE'
                  ? 'Purchase Invoice — Custom Excel Export & Templates'
                  : 'Sales Invoice — Custom Excel Export & Templates'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Select fields, drag-and-drop to reorder columns, preview live data, and save reusable templates
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Data Scope Switcher if both current invoice and all saved invoices are available */}
            {resolvedInitialInvoices.length > 0 && (
              <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setExportScope('current')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                    exportScope === 'current'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Current Selection ({resolvedInitialInvoices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExportScope('all')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                    exportScope === 'all'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  All Saved Invoices {allInvoicesCache ? `(${allInvoicesCache.length})` : ''}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleExecuteExport}
              disabled={exporting || selectedFields.length === 0 || loadingInvoices}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>
                {exporting
                  ? 'Exporting...'
                  : `Export ${selectedFields.length} Selected Column${
                      selectedFields.length === 1 ? '' : 's'
                    } (.xlsx)`}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Saved Templates Bar */}
        <div className="bg-slate-100 border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Saved {moduleType === 'PURCHASE' ? 'Purchase' : 'Sales'} Templates:
            </span>

            <select
              value={activeTemplateId || ''}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              disabled={loadingTemplates}
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-600 min-w-[220px]"
            >
              <option value="">-- Custom Unsaved Selection --</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.is_default ? '★ ' : ''}
                  {tpl.template_name} ({tpl.fields.length} cols)
                </option>
              ))}
            </select>

            {activeTemplate && (
              <>
                <button
                  type="button"
                  onClick={handleUpdateCurrentTemplate}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center gap-1 cursor-pointer"
                  title="Save current checked fields and column order to this template"
                >
                  <Save className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Update Template</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleDefaultTemplate}
                  className={`px-2.5 py-1.5 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${
                    activeTemplate.is_default
                      ? 'bg-amber-50 border-amber-400 text-amber-800'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Set or unset as default template for this module"
                >
                  <Star
                    className={`w-3.5 h-3.5 ${
                      activeTemplate.is_default ? 'fill-amber-500 text-amber-500' : 'text-slate-400'
                    }`}
                  />
                  <span>{activeTemplate.is_default ? 'Default Template' : 'Set as Default'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(activeTemplate.id);
                    setRenameText(activeTemplate.template_name);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer"
                  title="Rename selected template"
                >
                  <Edit3 className="w-3.5 h-3.5 text-sky-600" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(activeTemplate.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 font-semibold flex items-center gap-1 cursor-pointer"
                  title="Delete selected template"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {statusMsg && (
              <span
                className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1 ${
                  statusMsg.type === 'success'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{statusMsg.text}</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setShowSavePrompt((v) => !v);
                setOverwriteConfirm(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save as New Template</span>
            </button>
          </div>
        </div>

        {/* Inline Save / Rename / Overwrite / Delete Prompts */}
        {showSavePrompt && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-bold text-emerald-950">New Template Name:</span>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder={
                  moduleType === 'PURCHASE'
                    ? 'e.g. Monthly Supplier Purchase Audit'
                    : 'e.g. Daily Counter Sales Summary'
                }
                className="bg-white border border-emerald-400 rounded-lg px-3 py-1 text-xs text-slate-900 font-semibold w-64 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-emerald-900 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newTemplateDefault}
                  onChange={(e) => setNewTemplateDefault(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>Set as Default {moduleType === 'PURCHASE' ? 'Purchase' : 'Sales'} Template</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              {overwriteConfirm ? (
                <div className="flex items-center gap-2 bg-amber-100 border border-amber-400 px-3 py-1 rounded-lg text-amber-950">
                  <span className="font-bold">
                    Template &quot;{overwriteConfirm.templateName}&quot; already exists. Overwrite?
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSaveTemplate(true)}
                    className="px-2.5 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer"
                  >
                    Yes, Overwrite
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverwriteConfirm(null)}
                    className="px-2.5 py-0.5 rounded bg-white border border-amber-300 text-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleSaveTemplate(false)}
                    className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Template</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSavePrompt(false)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {renamingId !== null && (
          <div className="bg-sky-50 border-b border-sky-200 px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sky-950">Rename Template:</span>
              <input
                type="text"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                className="bg-white border border-sky-400 rounded-lg px-3 py-1 text-xs text-slate-900 font-semibold w-64"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmRename}
                className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold cursor-pointer"
              >
                Save New Name
              </button>
              <button
                type="button"
                onClick={() => setRenamingId(null)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {deleteConfirmId !== null && (
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <span className="font-bold text-rose-900">
              Are you sure you want to permanently delete template &quot;{activeTemplate?.template_name}&quot;?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConfirmDelete(deleteConfirmId)}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
              >
                Yes, Delete Template
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Main Workspace: Left = Field Checkboxes | Right = Drag & Drop Column Order + Live Preview */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 bg-slate-50">
          {/* LEFT 7 COLUMNS: Available Database Fields by Category */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  1. Select Fields to Include ({selectedFields.length} of {catalog.length} Selected)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Check or uncheck fields from Invoice Header, Item Details, and Financial Totals
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>Select All</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Deselect All</span>
                </button>
              </div>
            </div>

            {CATEGORIES.map((category) => {
              const catFields = catalog.filter((f) => f.category === category);
              const selectedInCat = catFields.filter((f) => selectedFields.includes(f.key)).length;
              const allInCatSelected = selectedInCat === catFields.length;

              return (
                <div
                  key={category}
                  className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{category}</span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[10px] font-bold">
                        {selectedInCat}/{catFields.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectCategory(category, !allInCatSelected)}
                      className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-600 cursor-pointer"
                    >
                      {allInCatSelected ? 'Uncheck Group' : 'Check Entire Group'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {catFields.map((field) => {
                      const isChecked = selectedFields.includes(field.key);
                      const orderPos = isChecked ? selectedFields.indexOf(field.key) + 1 : null;
                      return (
                        <label
                          key={field.key}
                          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition ${
                            isChecked
                              ? 'bg-emerald-50/70 border-emerald-400 text-slate-900 font-semibold'
                              : 'bg-slate-50/60 border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleField(field.key)}
                              className="rounded text-emerald-600 focus:ring-emerald-500 shrink-0"
                            />
                            <span className="truncate" title={field.label}>
                              {field.label}
                            </span>
                          </div>
                          {orderPos !== null && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-600 text-white font-mono text-[10px] font-bold shrink-0">
                              #{orderPos}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT 5 COLUMNS: Drag-and-Drop Column Order List */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs flex-1 flex flex-col max-h-[470px]">
              <div className="border-b border-slate-200 pb-2.5 mb-2.5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    2. Column Order (Drag & Drop to Reorder)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Drag rows or use Up/Down arrows to set the exact Excel column sequence
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs font-bold">
                  {selectedFields.length} Cols
                </span>
              </div>

              {selectedFields.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 text-xs">
                  No columns selected. Check fields on the left or click &quot;Select All&quot;.
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {selectedFields.map((key, idx) => {
                    const def = catalogByKey.get(key);
                    if (!def) return null;
                    const isDragged = draggedIdx === idx;
                    const isDragOver = dragOverIdx === idx;

                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        onDragEnd={() => {
                          setDraggedIdx(null);
                          setDragOverIdx(null);
                        }}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition cursor-grab active:cursor-grabbing ${
                          isDragged
                            ? 'opacity-50 bg-slate-100 border-slate-400'
                            : isDragOver
                            ? 'bg-emerald-50 border-emerald-500 border-dashed'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="w-6 text-center font-mono text-[11px] font-bold text-slate-500 bg-slate-100 rounded py-0.5 shrink-0">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-slate-900 truncate">{def.label}</span>
                          <span className="text-[10px] text-slate-400 hidden sm:inline">
                            ({def.category.replace(' Information', '')})
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveField(idx, -1)}
                            disabled={idx === 0}
                            title="Move Column Left / Up"
                            className="p-1 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveField(idx, 1)}
                            disabled={idx === selectedFields.length - 1}
                            title="Move Column Right / Down"
                            className="p-1 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleField(key)}
                            title="Remove Column"
                            className="p-1 rounded hover:bg-rose-50 text-rose-500 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM FULL-WIDTH: Live Excel Column & Row Preview Table */}
          <div className="lg:col-span-12 bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  3. Live Excel Column & Data Preview (1 Row Per Invoice Item)
                </h4>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                {loadingInvoices ? (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Loading invoices...
                  </span>
                ) : (
                  `Showing first ${previewData.rows.length} row(s) · ${activeInvoices.length} invoice(s) ready`
                )}
              </span>
            </div>

            {selectedFields.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                Select one or more fields above to preview the Excel table structure.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-300 rounded-lg max-h-56">
                <table className="w-full border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="bg-slate-900 text-white text-[11px] sticky top-0">
                      <th className="py-2 px-2.5 text-center border-r border-slate-700 font-mono w-10">
                        Row
                      </th>
                      {previewData.headers.map((h, i) => (
                        <th
                          key={`${h}-${i}`}
                          className="py-2 px-3 text-left border-r border-slate-700 whitespace-nowrap font-bold"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {previewData.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={previewData.headers.length + 1}
                          className="py-4 px-3 text-center text-slate-500"
                        >
                          Column headers ready. No sample rows in current view (will export all matching records).
                        </td>
                      </tr>
                    ) : (
                      previewData.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="odd:bg-white even:bg-slate-50/70">
                          <td className="py-1.5 px-2.5 text-center font-mono text-slate-400 border-r border-slate-200">
                            {rIdx + 1}
                          </td>
                          {previewData.headers.map((h, cIdx) => {
                            const val = row[h];
                            const isNum = typeof val === 'number';
                            return (
                              <td
                                key={`${rIdx}-${cIdx}`}
                                className={`py-1.5 px-3 border-r border-slate-200 whitespace-nowrap ${
                                  isNum ? 'text-right font-mono text-slate-900' : 'text-left text-slate-800'
                                }`}
                              >
                                {isNum
                                  ? Number.isInteger(val)
                                    ? val
                                    : val.toFixed(2)
                                  : String(val ?? '') || '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
