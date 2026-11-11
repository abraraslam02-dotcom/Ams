import React, { useState, useRef } from 'react';
import {
  X,
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Check,
} from 'lucide-react';
import { parseExcelFile, downloadExcelTemplate, ParsedExcelRow } from '../../utils/excel';
import { api } from '../../services/api';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState<boolean>(false);
  const [parsedRows, setParsedRows] = useState<ParsedExcelRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setParseError(null);
    setImportError(null);
    setImportSuccessMsg(null);
    setParsing(true);

    try {
      const result = await parseExcelFile(selected);
      setParsedRows(result.rows);
      if (result.rows.length === 0) {
        setParseError('The file contains no data rows.');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setParseError(errorMsg);
      setParsedRows([]);
    } finally {
      setParsing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedRows([]);
    setParseError(null);
    setImportError(null);
    setImportSuccessMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const validRows = parsedRows.filter((r) => r._isValid);
  const invalidRows = parsedRows.filter((r) => !r._isValid);

  const handleExecuteImport = async () => {
    if (validRows.length === 0) {
      setImportError('No valid items to import.');
      return;
    }

    try {
      setImporting(true);
      setImportError(null);

      const payload = validRows.map((r) => ({
        item_code: r.item_code,
        company_name: r.company_name,
        item_name: r.item_name,
        generic_name: r.generic_name,
        category: r.category,
        packing: r.packing,
        barcode: r.barcode,
        purchase_price: r.purchase_price,
        trade_price: r.trade_price,
        wholesale_price: r.wholesale_price,
        retail_price: r.retail_price,
        discount_percent: r.discount_percent,
        tax_percent: r.tax_percent,
        opening_stock: r.opening_stock,
        minimum_stock: r.minimum_stock,
        rack_number: r.rack_number,
        status: r.status,
      }));

      const res = await api.bulkImportItems(payload, updateExisting);
      setImportSuccessMsg(res.message);
      setTimeout(() => {
        onImportSuccess();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setImportError(errorMsg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Import Items from Excel (.xlsx / .csv)</h3>
              <p className="text-xs text-slate-300">
                Bulk upload items into Abrar Medical Store database with duplicate code validation.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Top Info & Template Download */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>Spreadsheet Format Specification</span>
              </span>
              <p className="text-xs text-slate-600">
                Download the standardized template containing all 17 Items Master columns.
              </p>
            </div>
            <button
              onClick={downloadExcelTemplate}
              className="px-3.5 py-2 text-xs font-bold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>Download Excel Template</span>
            </button>
          </div>

          {/* Upload Dropzone */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-8 text-center bg-slate-50/50 hover:bg-emerald-50/20 transition-all cursor-pointer space-y-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <span className="text-sm font-bold text-slate-800">
                  Click to browse or drop your Excel file here
                </span>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv) files
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Info Bar */}
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                  <div>
                    <span className="text-xs font-bold text-emerald-950 font-mono">{file.name}</span>
                    <span className="text-[11px] text-emerald-700 ml-2">
                      ({(file.size / 1024).toFixed(1)} KB) • {parsedRows.length} total rows parsed
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Change File
                </button>
              </div>

              {/* Status Alerts */}
              {parseError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {importError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-bold text-rose-700">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Import Error:</span>
                  </div>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap">{importError}</pre>
                </div>
              )}

              {importSuccessMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>{importSuccessMsg}</span>
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 font-medium">Total Rows:</span>
                  <div className="text-lg font-bold text-slate-900 font-mono">{parsedRows.length}</div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <span className="text-emerald-700 font-medium">Valid Items:</span>
                  <div className="text-lg font-bold text-emerald-900 font-mono">{validRows.length}</div>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200">
                  <span className="text-rose-700 font-medium">Invalid / Conflicts:</span>
                  <div className="text-lg font-bold text-rose-900 font-mono">{invalidRows.length}</div>
                </div>
              </div>

              {/* Duplicate Handling Option */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-3">
                <input
                  type="checkbox"
                  id="updateExisting"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <label htmlFor="updateExisting" className="text-xs text-slate-700 cursor-pointer">
                  <strong>Update existing items:</strong> If an Item Code already exists in the database, overwrite its prices, packing, and details with the spreadsheet row.
                </label>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Data Preview (First 15 Rows)</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    Showing {Math.min(parsedRows.length, 15)} of {parsedRows.length}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-2.5">Row</th>
                        <th className="py-2 px-2.5">Status</th>
                        <th className="py-2 px-2.5">Item Code</th>
                        <th className="py-2 px-2.5">Item Name</th>
                        <th className="py-2 px-2.5">Company</th>
                        <th className="py-2 px-2.5">Category</th>
                        <th className="py-2 px-2.5">Packing</th>
                        <th className="py-2 px-2.5">Retail Price</th>
                        <th className="py-2 px-2.5">Opening Stock</th>
                        <th className="py-2 px-2.5">Validation Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedRows.slice(0, 15).map((row, idx) => (
                        <tr
                          key={idx}
                          className={row._isValid ? 'hover:bg-slate-50/50' : 'bg-rose-50/60 text-rose-950'}
                        >
                          <td className="py-1.5 px-2.5 font-mono text-slate-400">{idx + 2}</td>
                          <td className="py-1.5 px-2.5">
                            {row._isValid ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                Valid
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                                Error
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono font-bold">{row.item_code}</td>
                          <td className="py-1.5 px-2.5 font-medium">{row.item_name}</td>
                          <td className="py-1.5 px-2.5">{row.company_name}</td>
                          <td className="py-1.5 px-2.5">{row.category}</td>
                          <td className="py-1.5 px-2.5 font-mono">{row.packing}</td>
                          <td className="py-1.5 px-2.5 font-mono font-bold">Rs. {row.retail_price.toFixed(2)}</td>
                          <td className="py-1.5 px-2.5 font-mono">{row.opening_stock}</td>
                          <td className="py-1.5 px-2.5 text-[11px]">
                            {row._isValid ? (
                              <span className="text-emerald-700">OK</span>
                            ) : (
                              <span className="text-rose-700 font-semibold">{row._errors.join('; ')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            {validRows.length > 0 && `${validRows.length} valid item(s) ready to import.`}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteImport}
              disabled={validRows.length === 0 || importing}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>
                {importing
                  ? 'Saving to Database...'
                  : `Save ${validRows.length} Items Permanently`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
