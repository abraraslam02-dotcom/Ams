import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileCheck2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  parseSalesInvoicesFromExcelFile,
  downloadSalesInvoiceImportTemplate,
  type ParsedExcelSaleInvoiceInput,
} from '../../utils/salesInvoiceExcelImport';

interface SalesInvoiceExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: () => void;
  sampleCustomer?: { account_code?: string; account_name?: string };
  sampleItems?: Array<{
    item_code?: string;
    item_name?: string;
    company_name?: string;
    packing?: string;
    retail_price?: number;
  }>;
}

export const SalesInvoiceExcelImportModal: React.FC<SalesInvoiceExcelImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  sampleCustomer,
  sampleItems,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [detectedFormat, setDetectedFormat] = useState<string>('');
  const [parsedInvoices, setParsedInvoices] = useState<ParsedExcelSaleInvoiceInput[]>([]);
  const [previewData, setPreviewData] = useState<{
    invoices: any[];
    summary: {
      totalInvoices: number;
      validInvoices: number;
      duplicateInvoices: number;
      invalidInvoices: number;
      missingCustomersCount: number;
      missingItemsCount: number;
      invalidQuantitiesCount: number;
      invalidValuesCount: number;
      totalMismatchesCount: number;
    };
  } | null>(null);

  const [commitResult, setCommitResult] = useState<{
    summary: {
      totalSubmitted: number;
      successfulCount: number;
      skippedDuplicatesCount: number;
      failedCount: number;
    };
    importedInvoices: Array<{
      id: number;
      invoiceNumber: string;
      invoiceDate: string;
      customerName: string;
      customerCode: string;
      itemsCount: number;
      netTotal: number;
      paidAmount: number;
      paymentMode: string;
    }>;
    skippedDuplicates: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      customerName: string;
      reason: string;
    }>;
    failedInvoices: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      customerName: string;
      errors: string[];
    }>;
  } | null>(null);

  const [isParsingOrValidating, setIsParsingOrValidating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState<Record<number, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'duplicate' | 'invalid'>('all');

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFileName('');
    setDetectedFormat('');
    setParsedInvoices([]);
    setPreviewData(null);
    setCommitResult(null);
    setErrorMessage(null);
    setExpandedInvoices({});
    setStatusFilter('all');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      setErrorMessage('Please select a valid Excel file (.xlsx).');
      return;
    }

    setErrorMessage(null);
    setCommitResult(null);
    setPreviewData(null);
    setSelectedFileName(file.name);
    setIsParsingOrValidating(true);

    try {
      const parsed = await parseSalesInvoicesFromExcelFile(file);
      if (parsed.invoices.length === 0) {
        throw new Error(
          'No valid sales invoice rows were found in the selected Excel file. Ensure the sheet contains headers like Invoice Number, Invoice Date, Customer Name/Code, Item Code/Name, Quantity, and Rate.'
        );
      }

      setParsedInvoices(parsed.invoices);
      setDetectedFormat(
        parsed.detectedFormat === 'standard_two_sheet'
          ? 'Standard AMS 2-Sheet Workbook (Invoice Summary + Invoice Details)'
          : `Single-Sheet Details Format (${parsed.sheetNames[0]})`
      );

      const previewRes = await api.previewSalesExcelImport(parsed.invoices);
      setPreviewData({
        invoices: previewRes.invoices,
        summary: previewRes.summary,
      });

      // Automatically expand invoices that have validation errors or up to first 5 invoices
      const autoExpanded: Record<number, boolean> = {};
      previewRes.invoices.forEach((inv: any, idx: number) => {
        if (inv.status === 'invalid' || idx < 3) {
          autoExpanded[inv.index] = true;
        }
      });
      setExpandedInvoices(autoExpanded);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to parse or validate Excel file.');
    } finally {
      setIsParsingOrValidating(false);
    }
  };

  const handleCommitImport = async () => {
    if (!previewData || parsedInvoices.length === 0) return;
    setErrorMessage(null);
    setIsCommitting(true);
    try {
      const result = await api.commitSalesExcelImport(parsedInvoices);
      setCommitResult(result);
      if (result.summary.successfulCount > 0 && onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to import sales invoices.');
    } finally {
      setIsCommitting(false);
    }
  };

  const toggleExpandInvoice = (idx: number) => {
    setExpandedInvoices((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const filteredPreviewInvoices =
    previewData?.invoices.filter((inv: any) => {
      if (statusFilter === 'all') return true;
      return inv.status === statusFilter;
    }) || [];

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-900 via-teal-800 to-emerald-900 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/10 border border-white/20">
              <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-wide">
                Import Sales Invoices from Excel (.xlsx)
              </h2>
              <p className="text-[11px] text-emerald-200">
                Supports single or multiple invoices • Compatible with Standard &amp; Custom Exported Excel files • Validates Customers, Items, Stock, Duplicates &amp; Totals
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadSalesInvoiceImportTemplate(sampleCustomer, sampleItems)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/25 text-xs font-semibold text-white transition cursor-pointer"
              title="Download Sample Excel Import Template (.xlsx)"
            >
              <Download className="w-3.5 h-3.5" />
              Sample Template (.xlsx)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-rose-600/80 text-white transition cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-slate-50">
          {/* File Upload Bar */}
          {!commitResult && (
            <div className="bg-white border-2 border-dashed border-emerald-300 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-800">
                    {selectedFileName
                      ? `Selected File: ${selectedFileName}`
                      : 'Select a Sales Invoice Excel File (.xlsx) to Preview & Validate'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {detectedFormat ? (
                      <span className="text-emerald-700 font-semibold">
                        Detected Format: {detectedFormat}
                      </span>
                    ) : (
                      'Matches Customer Code / Name and Item Code / Name automatically before saving.'
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {selectedFileName && (
                  <button
                    type="button"
                    onClick={resetState}
                    disabled={isParsingOrValidating || isCommitting}
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition cursor-pointer"
                  >
                    Clear / Choose Another
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isParsingOrValidating || isCommitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {selectedFileName ? 'Replace Excel File' : 'Select Excel File (.xlsx)'}
                </button>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-300 text-rose-800 rounded-xl p-3.5 flex items-start gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* Loading State */}
          {isParsingOrValidating && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mb-2" />
              <div className="text-sm font-bold text-slate-800">
                Reading Excel File &amp; Validating Against Database...
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Matching customers, items, FIFO stock batches, duplicate invoice numbers, and invoice totals.
              </div>
            </div>
          )}

          {/* STEP 2: IMPORT PREVIEW */}
          {!isParsingOrValidating && previewData && !commitResult && (
            <div className="space-y-3">
              {/* Validation Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    statusFilter === 'all'
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[11px] uppercase font-bold opacity-75">Total Invoices in File</div>
                  <div className="text-2xl font-black mt-0.5">{previewData.summary.totalInvoices}</div>
                  <div className="text-[11px] opacity-80 mt-0.5">Click to view all</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('valid')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    statusFilter === 'valid'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
                  }`}
                >
                  <div className="text-[11px] uppercase font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready to Import
                  </div>
                  <div className="text-2xl font-black mt-0.5">{previewData.summary.validInvoices}</div>
                  <div className="text-[11px] opacity-85 mt-0.5">Passed all validations</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('duplicate')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    statusFilter === 'duplicate'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100/70'
                  }`}
                >
                  <div className="text-[11px] uppercase font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Duplicate Invoices
                  </div>
                  <div className="text-2xl font-black mt-0.5">{previewData.summary.duplicateInvoices}</div>
                  <div className="text-[11px] opacity-85 mt-0.5">Will be skipped safely</div>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter('invalid')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    statusFilter === 'invalid'
                      ? 'bg-rose-700 text-white border-rose-700 shadow-xs'
                      : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100/70'
                  }`}
                >
                  <div className="text-[11px] uppercase font-bold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Invalid / Errors
                  </div>
                  <div className="text-2xl font-black mt-0.5">{previewData.summary.invalidInvoices}</div>
                  <div className="text-[11px] opacity-85 mt-0.5">
                    Missing Customer: {previewData.summary.missingCustomersCount} • Missing Item:{' '}
                    {previewData.summary.missingItemsCount}
                  </div>
                </button>
              </div>

              {/* Error Breakdown Pill Bar if any issues exist */}
              {(previewData.summary.missingCustomersCount > 0 ||
                previewData.summary.missingItemsCount > 0 ||
                previewData.summary.invalidQuantitiesCount > 0 ||
                previewData.summary.totalMismatchesCount > 0) && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-3 text-xs text-amber-900">
                  <span className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    Validation Issues Detected:
                  </span>
                  {previewData.summary.missingCustomersCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                      Missing Customers: {previewData.summary.missingCustomersCount}
                    </span>
                  )}
                  {previewData.summary.missingItemsCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                      Missing Items: {previewData.summary.missingItemsCount}
                    </span>
                  )}
                  {previewData.summary.invalidQuantitiesCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                      Invalid Quantities / Stock: {previewData.summary.invalidQuantitiesCount}
                    </span>
                  )}
                  {previewData.summary.totalMismatchesCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                      Total Mismatches: {previewData.summary.totalMismatchesCount}
                    </span>
                  )}
                  <span className="text-[11px] text-amber-800 ml-auto">
                    Only valid invoices will be saved. Invalid and duplicate invoices will not be imported.
                  </span>
                </div>
              )}

              {/* Preview Invoices Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800">
                    Import Preview ({filteredPreviewInvoices.length} of {previewData.invoices.length} invoice
                    {previewData.invoices.length === 1 ? '' : 's'})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Click any invoice row to inspect its line items and validation details
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[46vh]">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-800 text-white sticky top-0 z-10">
                      <tr>
                        <th className="py-2 px-2.5 text-left w-8">#</th>
                        <th className="py-2 px-2.5 text-left">Invoice Number</th>
                        <th className="py-2 px-2.5 text-left">Invoice Date</th>
                        <th className="py-2 px-2.5 text-left">Customer Match</th>
                        <th className="py-2 px-2.5 text-center">Mode</th>
                        <th className="py-2 px-2.5 text-center">Items</th>
                        <th className="py-2 px-2.5 text-right">Gross</th>
                        <th className="py-2 px-2.5 text-right">Discount</th>
                        <th className="py-2 px-2.5 text-right">Tax</th>
                        <th className="py-2 px-2.5 text-right">Net Amount</th>
                        <th className="py-2 px-2.5 text-right">Paid Amount</th>
                        <th className="py-2 px-2.5 text-center">Validation Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredPreviewInvoices.map((inv: any) => {
                        const isExpanded = Boolean(expandedInvoices[inv.index]);
                        const rowBg =
                          inv.status === 'valid'
                            ? 'hover:bg-emerald-50/40'
                            : inv.status === 'duplicate'
                            ? 'bg-amber-50/40 hover:bg-amber-50/80'
                            : 'bg-rose-50/40 hover:bg-rose-50/80';

                        return (
                          <React.Fragment key={inv.index}>
                            <tr
                              onClick={() => toggleExpandInvoice(inv.index)}
                              className={`cursor-pointer transition ${rowBg}`}
                            >
                              <td className="py-2.5 px-2.5 font-bold text-slate-600">
                                <div className="flex items-center gap-1">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                  )}
                                  {inv.index + 1}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 font-mono font-bold text-slate-800">
                                {inv.invoiceNumber ? (
                                  inv.invoiceNumber
                                ) : (
                                  <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px]">
                                    Auto-Generate SI #
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-2.5 text-slate-700 font-medium">
                                {inv.normalizedInvoiceDate}
                              </td>
                              <td className="py-2.5 px-2.5">
                                {inv.hasMissingCustomer ? (
                                  <div className="text-rose-700 font-bold flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      Missing: {inv.rawCustomerCode || ''} {inv.rawCustomerName || '(Unknown)'}
                                    </span>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="font-bold text-slate-800">
                                      {inv.matchedCustomerName}{' '}
                                      <span className="text-[10px] font-mono text-slate-500">
                                        ({inv.matchedCustomerCode})
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-emerald-700">
                                      {inv.customerMatchedBy === 'code'
                                        ? 'Matched by Customer Code'
                                        : inv.customerMatchedBy === 'name'
                                        ? 'Matched by Customer Name'
                                        : 'Default Walk-in Customer'}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-2.5 text-center">
                                <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 font-semibold text-slate-700 text-[11px]">
                                  {inv.paymentMode}
                                </span>
                              </td>
                              <td className="py-2.5 px-2.5 text-center font-bold text-slate-700">
                                {inv.lines.length}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono">
                                {Number(inv.calculatedGrossTotal || 0).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono text-amber-700">
                                {Number(inv.calculatedDiscountTotal || 0).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono text-indigo-700">
                                {Number(inv.calculatedTaxTotal || 0).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900">
                                {Number(inv.calculatedNetTotal || 0).toLocaleString()}
                                {inv.excelNetTotal !== null &&
                                  Math.abs(inv.excelNetTotal - inv.calculatedNetTotal) > 1 && (
                                    <div className="text-[10px] text-rose-600 font-normal">
                                      Excel: {Number(inv.excelNetTotal).toLocaleString()}
                                    </div>
                                  )}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                                {Number(inv.paidAmount || 0).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-2.5 text-center">
                                {inv.status === 'valid' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                                    <CheckCircle2 className="w-3 h-3" /> Ready
                                  </span>
                                )}
                                {inv.status === 'duplicate' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[11px]">
                                    <AlertTriangle className="w-3 h-3" /> Duplicate
                                  </span>
                                )}
                                {inv.status === 'invalid' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[11px]">
                                    <XCircle className="w-3 h-3" /> {inv.errors.length} Error
                                    {inv.errors.length === 1 ? '' : 's'}
                                  </span>
                                )}
                              </td>
                            </tr>

                            {/* Expanded Line Items & Errors */}
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={12} className="p-3 border-b border-slate-300">
                                  <div className="space-y-2.5">
                                    {/* Duplicate or Validation Error Details */}
                                    {inv.duplicateReason && (
                                      <div className="bg-amber-100/80 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                                        <span className="font-semibold">
                                          Skipped Duplicate: {inv.duplicateReason}
                                        </span>
                                      </div>
                                    )}

                                    {inv.errors && inv.errors.length > 0 && (
                                      <div className="bg-rose-100/80 border border-rose-300 text-rose-900 px-3 py-2 rounded-lg text-xs space-y-1">
                                        <div className="font-bold flex items-center gap-1.5">
                                          <XCircle className="w-4 h-4 text-rose-700 shrink-0" />
                                          Validation Errors Preventing Import of This Invoice:
                                        </div>
                                        <ul className="list-disc list-inside space-y-0.5 pl-1">
                                          {inv.errors.map((err: string, eIdx: number) => (
                                            <li key={eIdx}>{err}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Line Items Sub-Table */}
                                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                      <table className="w-full text-[11px] border-collapse">
                                        <thead className="bg-slate-200 text-slate-800">
                                          <tr>
                                            <th className="py-1.5 px-2 text-left">Excel Row</th>
                                            <th className="py-1.5 px-2 text-left">Item Code / Name (Excel)</th>
                                            <th className="py-1.5 px-2 text-left">Matched Database Item</th>
                                            <th className="py-1.5 px-2 text-left">Batch / Expiry</th>
                                            <th className="py-1.5 px-2 text-right">Qty</th>
                                            <th className="py-1.5 px-2 text-right">Loose</th>
                                            <th className="py-1.5 px-2 text-right">Bonus</th>
                                            <th className="py-1.5 px-2 text-right">Sale Rate</th>
                                            <th className="py-1.5 px-2 text-right">Discount</th>
                                            <th className="py-1.5 px-2 text-right">Tax</th>
                                            <th className="py-1.5 px-2 text-right">Net Amount</th>
                                            <th className="py-1.5 px-2 text-center">Line Status</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {inv.lines.map((line: any, lIdx: number) => (
                                            <tr
                                              key={lIdx}
                                              className={
                                                line.errors && line.errors.length > 0 ? 'bg-rose-50/70' : ''
                                              }
                                            >
                                              <td className="py-1.5 px-2 font-mono text-slate-500">
                                                #{line.rowNumber}
                                              </td>
                                              <td className="py-1.5 px-2">
                                                <div className="font-semibold text-slate-800">
                                                  {line.rawItemName || '(No Name)'}
                                                </div>
                                                {line.rawItemCode && (
                                                  <div className="text-[10px] font-mono text-slate-500">
                                                    Code: {line.rawItemCode}
                                                  </div>
                                                )}
                                              </td>
                                              <td className="py-1.5 px-2">
                                                {line.hasMissingItem ? (
                                                  <span className="text-rose-700 font-bold">
                                                    Not Found in Items Master
                                                  </span>
                                                ) : (
                                                  <div>
                                                    <div className="font-semibold text-emerald-900">
                                                      {line.matchedItemName}
                                                      {line.matchedVariantName
                                                        ? ` (${line.matchedVariantName})`
                                                        : ''}
                                                    </div>
                                                    <div className="text-[10px] text-slate-500">
                                                      Code: {line.matchedVariantCode || line.matchedItemCode} •
                                                      Matched by {line.matchedBy} • Stock: {line.availablePacks}{' '}
                                                      Packs
                                                    </div>
                                                  </div>
                                                )}
                                              </td>
                                              <td className="py-1.5 px-2 font-mono text-[10px] text-slate-600">
                                                <div>{line.batchNumber || 'FIFO'}</div>
                                                <div>{line.expiryDate || ''}</div>
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono font-bold">
                                                {line.quantity}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono">
                                                {line.looseQuantity || 0}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono">
                                                {line.bonusQuantity || 0}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono">
                                                {Number(line.unitPrice || 0).toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono text-amber-700">
                                                {Number(line.discountAmount || 0).toLocaleString()}
                                                {line.discountPercent > 0 && (
                                                  <span className="text-[10px] text-slate-500 ml-0.5">
                                                    ({line.discountPercent}%)
                                                  </span>
                                                )}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono text-indigo-700">
                                                {Number(line.taxAmount || 0).toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                                                {Number(line.calculatedNetAmount || 0).toLocaleString()}
                                              </td>
                                              <td className="py-1.5 px-2 text-center">
                                                {line.errors && line.errors.length > 0 ? (
                                                  <span className="text-rose-700 font-bold">Invalid</span>
                                                ) : (
                                                  <span className="text-emerald-700 font-bold">OK</span>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: FINAL IMPORT SUMMARY AFTER COMMIT */}
          {commitResult && (
            <div className="space-y-4">
              <div className="bg-emerald-900 text-white rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-white/10 border border-white/20">
                    <FileCheck2 className="w-6 h-6 text-emerald-300" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold">Sales Invoice Excel Import Complete</h3>
                    <p className="text-xs text-emerald-200 mt-0.5">
                      Stock batches, FIFO movements, customer ledgers, and cash/bank journal entries have been updated atomically.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-white/10 px-3 py-1.5 rounded-lg text-center">
                    <div className="text-[10px] uppercase text-emerald-200 font-bold">Imported</div>
                    <div className="text-lg font-black text-emerald-300">
                      {commitResult.summary.successfulCount}
                    </div>
                  </div>
                  <div className="bg-white/10 px-3 py-1.5 rounded-lg text-center">
                    <div className="text-[10px] uppercase text-amber-200 font-bold">Skipped Duplicates</div>
                    <div className="text-lg font-black text-amber-300">
                      {commitResult.summary.skippedDuplicatesCount}
                    </div>
                  </div>
                  <div className="bg-white/10 px-3 py-1.5 rounded-lg text-center">
                    <div className="text-[10px] uppercase text-rose-200 font-bold">Failed</div>
                    <div className="text-lg font-black text-rose-300">
                      {commitResult.summary.failedCount}
                    </div>
                  </div>
                </div>
              </div>

              {/* Successful Invoices List */}
              {commitResult.importedInvoices.length > 0 && (
                <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden">
                  <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-200 text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    Successfully Imported Invoices ({commitResult.importedInvoices.length})
                  </div>
                  <div className="overflow-x-auto max-h-48">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="py-1.5 px-3 text-left">Invoice Number</th>
                          <th className="py-1.5 px-3 text-left">Date</th>
                          <th className="py-1.5 px-3 text-left">Customer</th>
                          <th className="py-1.5 px-3 text-center">Payment Mode</th>
                          <th className="py-1.5 px-3 text-center">Items</th>
                          <th className="py-1.5 px-3 text-right">Net Total</th>
                          <th className="py-1.5 px-3 text-right">Paid Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {commitResult.importedInvoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-emerald-50/40">
                            <td className="py-1.5 px-3 font-mono font-bold text-emerald-800">
                              {inv.invoiceNumber}
                            </td>
                            <td className="py-1.5 px-3">{inv.invoiceDate}</td>
                            <td className="py-1.5 px-3 font-semibold">
                              {inv.customerName}{' '}
                              <span className="text-[10px] text-slate-500">({inv.customerCode})</span>
                            </td>
                            <td className="py-1.5 px-3 text-center">{inv.paymentMode}</td>
                            <td className="py-1.5 px-3 text-center">{inv.itemsCount}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-bold">
                              Rs. {Number(inv.netTotal || 0).toLocaleString()}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono text-emerald-700">
                              Rs. {Number(inv.paidAmount || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Skipped Duplicates List */}
              {commitResult.skippedDuplicates.length > 0 && (
                <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
                  <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    Skipped Duplicate Invoices ({commitResult.skippedDuplicates.length})
                  </div>
                  <div className="p-3 space-y-1.5 max-h-40 overflow-y-auto text-xs">
                    {commitResult.skippedDuplicates.map((dup, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between gap-2 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-1.5"
                      >
                        <div>
                          <span className="font-mono font-bold text-amber-900">{dup.invoiceNumber}</span> •{' '}
                          <span className="font-semibold">{dup.customerName}</span> ({dup.invoiceDate})
                        </div>
                        <div className="text-amber-800">{dup.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Failed Invoices List */}
              {commitResult.failedInvoices.length > 0 && (
                <div className="bg-white border border-rose-200 rounded-xl overflow-hidden">
                  <div className="bg-rose-50 px-4 py-2 border-b border-rose-200 text-xs font-bold text-rose-900 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-rose-700" />
                    Failed Invoices ({commitResult.failedInvoices.length})
                  </div>
                  <div className="p-3 space-y-2 max-h-48 overflow-y-auto text-xs">
                    {commitResult.failedInvoices.map((fail, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50/60 border border-rose-200 rounded-lg px-3 py-2 space-y-1"
                      >
                        <div className="font-bold text-rose-900">
                          {fail.invoiceNumber} • {fail.customerName} ({fail.invoiceDate})
                        </div>
                        <ul className="list-disc list-inside text-rose-800 space-y-0.5">
                          {fail.errors.map((e, eIdx) => (
                            <li key={eIdx}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 border-t border-slate-300 px-5 py-3 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-600">
            {commitResult ? (
              <span className="font-semibold text-emerald-800">
                Import summary ready. Existing records and export features were untouched.
              </span>
            ) : previewData ? (
              <span>
                Ready to import{' '}
                <strong className="text-emerald-700">{previewData.summary.validInvoices}</strong> valid
                invoice(s).{' '}
                {previewData.summary.duplicateInvoices > 0 &&
                  `${previewData.summary.duplicateInvoices} duplicate(s) will be skipped. `}
                {previewData.summary.invalidInvoices > 0 &&
                  `${previewData.summary.invalidInvoices} invalid invoice(s) will be excluded.`}
              </span>
            ) : (
              <span>Upload an .xlsx file to preview and validate sales invoices before saving.</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {commitResult ? (
              <>
                <button
                  type="button"
                  onClick={resetState}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
                >
                  Import Another File
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  Done &amp; Close
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isCommitting}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommitImport}
                  disabled={
                    !previewData ||
                    previewData.summary.validInvoices === 0 ||
                    isParsingOrValidating ||
                    isCommitting
                  }
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCommitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Importing Valid Invoices...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Save &amp; Import{' '}
                      {previewData ? `(${previewData.summary.validInvoices})` : ''} Valid Invoice
                      {previewData?.summary.validInvoices === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
