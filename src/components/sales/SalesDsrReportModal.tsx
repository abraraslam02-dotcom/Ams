import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Receipt, FileText, X, ClipboardList, AlertCircle } from 'lucide-react';
import { DatasheetRow, FastSearchItem } from '../../types/sales';
import { api } from '../../services/api';
import { executePrintElement } from '../../utils/printEngine';

export interface SalesDsrReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  isSavedInvoice?: boolean;
  rows: DatasheetRow[];
  catalogItems?: FastSearchItem[];
}

export interface DsrItemEntry {
  rowId: string;
  sNo: number;
  itemName: string;
  companyName: string;
  qty: number;
  bonusQty: number;
  looseQty: number;
}

export interface DsrCompanyGroup {
  companyName: string;
  items: DsrItemEntry[];
  groupQty: number;
  groupBonusQty: number;
  groupLooseQty: number;
}

function formatQtyValue(val: number): string {
  const n = Number(val || 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round((n + Number.EPSILON) * 100) / 100);
}

export const SalesDsrReportModal: React.FC<SalesDsrReportModalProps> = ({
  isOpen,
  onClose,
  storeName: propStoreName,
  invoiceNumber,
  invoiceDate,
  customerName,
  rows,
  catalogItems = [],
}) => {
  const [resolvedStoreName, setResolvedStoreName] = useState<string>(
    propStoreName?.trim() || 'Abrar Medical Store'
  );
  const [activeLayout, setActiveLayout] = useState<'a4' | 'thermal'>('a4');

  const a4PrintRef = useRef<HTMLDivElement | null>(null);
  const thermalPrintRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (propStoreName && propStoreName.trim()) {
      setResolvedStoreName(propStoreName.trim());
    }
  }, [propStoreName]);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    api
      .getCompanySettings()
      .then((res) => {
        if (!mounted || !res?.data?.store_name) return;
        setResolvedStoreName(String(res.data.store_name).trim() || 'Abrar Medical Store');
      })
      .catch(() => {
        // Keep current store name fallback
      });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Build company-wise grouped and alphabetically sorted DSR data from live invoice rows
  const dsrData = useMemo(() => {
    const populatedRows = rows.filter(
      (r) =>
        (r.item_id !== null && Number(r.item_id) > 0) ||
        Boolean(r.item_code?.trim()) ||
        Boolean(r.item_name?.trim())
    );

    const groupMap = new Map<
      string,
      Array<{
        rowId: string;
        itemName: string;
        companyName: string;
        qty: number;
        bonusQty: number;
        looseQty: number;
      }>
    >();

    let totalQty = 0;
    let totalBonusQty = 0;
    let totalLooseQty = 0;

    for (let i = 0; i < populatedRows.length; i++) {
      const r = populatedRows[i];
      let rawCompany = String(r.company_name || '').trim();
      if (!rawCompany && catalogItems.length > 0) {
        const matchedCatalogItem = catalogItems.find(
          (c) =>
            (r.item_id !== null && c.id === Number(r.item_id)) ||
            (r.item_code && c.item_code.toLowerCase() === r.item_code.trim().toLowerCase())
        );
        if (matchedCatalogItem?.company_name) {
          rawCompany = String(matchedCatalogItem.company_name).trim();
        }
      }

      const companyName = rawCompany || 'Unassigned Company';
      const itemName = String(r.item_name || r.item_code || 'Unnamed Item').trim();
      const qty = Math.max(0, Number(r.quantity || 0));
      const bonusQty = Math.max(0, Number(r.bonus_quantity || 0));
      const looseQty = Math.max(0, Number(r.loose_quantity || 0));

      totalQty += qty;
      totalBonusQty += bonusQty;
      totalLooseQty += looseQty;

      if (!groupMap.has(companyName)) {
        groupMap.set(companyName, []);
      }
      groupMap.get(companyName)!.push({
        rowId: r.row_id || `dsr_row_${i}`,
        itemName,
        companyName,
        qty,
        bonusQty,
        looseQty,
      });
    }

    // Sort company names in ascending alphabetical order (A–Z)
    const sortedCompanyNames = Array.from(groupMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    );

    const groups: DsrCompanyGroup[] = sortedCompanyNames.map((companyName) => {
      const rawItems = groupMap.get(companyName) || [];
      // Sort item names in ascending alphabetical order (A–Z) within each company group
      const sortedItems = [...rawItems].sort((a, b) =>
        a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base', numeric: true })
      );

      let groupQty = 0;
      let groupBonusQty = 0;
      let groupLooseQty = 0;

      const itemsWithSerial: DsrItemEntry[] = sortedItems.map((item, idx) => {
        groupQty += item.qty;
        groupBonusQty += item.bonusQty;
        groupLooseQty += item.looseQty;
        return {
          ...item,
          // S.No restarts from 1 within each company group
          sNo: idx + 1,
        };
      });

      return {
        companyName,
        items: itemsWithSerial,
        groupQty,
        groupBonusQty,
        groupLooseQty,
      };
    });

    return {
      hasItems: populatedRows.length > 0,
      totalItems: populatedRows.length,
      totalQty: Math.round((totalQty + Number.EPSILON) * 100) / 100,
      totalBonusQty: Math.round((totalBonusQty + Number.EPSILON) * 100) / 100,
      totalLooseQty: Math.round((totalLooseQty + Number.EPSILON) * 100) / 100,
      groups,
    };
  }, [rows, catalogItems]);

  if (!isOpen) return null;

  const displayStoreName = resolvedStoreName || 'Abrar Medical Store';
  const displayInvoiceNumber = invoiceNumber?.trim() || 'N/A';
  const displayInvoiceDate = invoiceDate?.trim() || new Date().toISOString().slice(0, 10);
  const displayCustomerName = customerName?.trim() || 'Walk-in Cash Customer';

  const handlePrintA4 = () => {
    setActiveLayout('a4');
    setTimeout(() => {
      executePrintElement(a4PrintRef.current, {
        title: `${displayStoreName} - DSR Report - ${displayInvoiceNumber} (A4)`,
        paperSize: 'a4',
        orientation: 'portrait',
        margin: 'standard',
        fontSizeScale: 'normal',
        copies: 1,
      });
    }, 40);
  };

  const handlePrintThermal = () => {
    setActiveLayout('thermal');
    setTimeout(() => {
      executePrintElement(thermalPrintRef.current, {
        title: `${displayStoreName} - DSR Report - ${displayInvoiceNumber} (80mm Thermal)`,
        paperSize: '80mm',
        orientation: 'portrait',
        margin: 'none',
        fontSizeScale: 'normal',
        copies: 1,
      });
    }, 40);
  };

  return (
    <div className="print-modal-container fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 lg:p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden print:shadow-none print:border-0 print:max-w-none print:max-h-none">
        {/* Top Action Bar (Hidden when printing) */}
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">
                DSR – Daily Stock Requisition ({displayInvoiceNumber})
              </h3>
              <p className="text-[11px] text-slate-400">
                Warehouse Stock Picking List · Company-wise A–Z · {dsrData.totalItems} Item
                {dsrData.totalItems === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {/* Preview Layout Switcher + Required 3 Print Controls (Print A4, Print Thermal, Close) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 mr-1">
              <button
                type="button"
                onClick={() => setActiveLayout('a4')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayout === 'a4'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Preview A4 Paper Layout"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>A4 View</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveLayout('thermal')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayout === 'thermal'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Preview 80mm Thermal Layout"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>80mm Thermal View</span>
              </button>
            </div>

            {/* 1. Print A4 */}
            <button
              type="button"
              disabled={!dsrData.hasItems}
              onClick={handlePrintA4}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4</span>
            </button>

            {/* 2. Print Thermal */}
            <button
              type="button"
              disabled={!dsrData.hasItems}
              onClick={handlePrintThermal}
              className="px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Print Thermal</span>
            </button>

            {/* 3. Close */}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Report Viewport */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-100 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          {!dsrData.hasItems ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md w-full text-center my-auto space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-slate-900">
                No Items in Current Sales Invoice
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                The currently open Sales Invoice ({displayInvoiceNumber}) does not contain any
                items yet. Please add at least one medicine item to the invoice to generate the DSR
                (Daily Stock Requisition) picking report.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* =========================================================================
                 1. STANDARD A4 DSR REPORT LAYOUT
                 ========================================================================= */}
              <div
                className={activeLayout === 'a4' ? 'w-full flex justify-center' : 'hidden'}
              >
                <div
                  ref={a4PrintRef}
                  className="bg-white border border-slate-300 shadow-xs w-full max-w-[210mm] p-6 lg:p-8 text-slate-900 text-xs print:border-0 print:shadow-none print:p-0 print:max-w-none"
                >
                  <style>{`
                    @media print {
                      .dsr-a4-table {
                        width: 100% !important;
                        border-collapse: collapse !important;
                      }
                      .dsr-a4-table thead {
                        display: table-header-group !important;
                      }
                      .dsr-a4-company-row {
                        page-break-after: avoid !important;
                        break-after: avoid !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                      .dsr-a4-item-row {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                      .dsr-a4-totals-block {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                    }
                  `}</style>

                  {/* Top Report Header */}
                  <div className="border-b-2 border-slate-900 pb-3 mb-3 text-center">
                    <h1 className="text-xl font-black tracking-tight text-slate-950 uppercase">
                      {displayStoreName}
                    </h1>
                    <h2 className="text-sm font-bold tracking-wide text-slate-800 mt-0.5">
                      DSR – Daily Stock Requisition
                    </h2>
                  </div>

                  {/* Invoice Metadata Bar */}
                  <div className="grid grid-cols-3 gap-4 mb-4 p-3 rounded-lg bg-slate-50 border border-slate-300 text-xs">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Invoice Number
                      </span>
                      <span className="font-mono font-bold text-slate-950 text-sm">
                        {displayInvoiceNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Invoice Date
                      </span>
                      <span className="font-mono font-bold text-slate-950 text-sm">
                        {displayInvoiceDate}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Customer / Party Name
                      </span>
                      <span className="font-bold text-slate-950 text-sm break-words">
                        {displayCustomerName}
                      </span>
                    </div>
                  </div>

                  {/* Company-wise Grouped Table with Repeating Multi-Page Header */}
                  <table className="dsr-a4-table w-full border-collapse border border-slate-400 mb-4">
                    <thead>
                      {/* Repeating Page Header Row for Multi-Page A4 Printouts */}
                      <tr className="bg-slate-100 border-b border-slate-400 text-[10px] text-slate-700">
                        <th colSpan={5} className="py-1.5 px-3 text-left font-bold">
                          <div className="flex items-center justify-between">
                            <span>
                              {displayStoreName} — DSR – Daily Stock Requisition
                            </span>
                            <span className="font-mono">
                              Inv: {displayInvoiceNumber} · Date: {displayInvoiceDate} · Party:{' '}
                              {displayCustomerName}
                            </span>
                          </div>
                        </th>
                      </tr>
                      {/* Exact Required Column Order: S.No | Item Name | Qty | Bonus Qty | Loose Qty */}
                      <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                        <th className="py-2 px-2.5 text-center border border-slate-700 w-14">
                          S.No
                        </th>
                        <th className="py-2 px-3 text-left border border-slate-700">
                          Item Name
                        </th>
                        <th className="py-2 px-3 text-right border border-slate-700 w-24">
                          Qty
                        </th>
                        <th className="py-2 px-3 text-right border border-slate-700 w-24">
                          Bonus Qty
                        </th>
                        <th className="py-2 px-3 text-right border border-slate-700 w-24">
                          Loose Qty
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dsrData.groups.map((group) => (
                        <React.Fragment key={group.companyName}>
                          {/* Company Group Heading Row */}
                          <tr className="dsr-a4-company-row bg-slate-200/90 border-t-2 border-b border-slate-400">
                            <td
                              colSpan={5}
                              className="py-1.5 px-3 font-black text-slate-950 text-xs tracking-wide"
                            >
                              Company: {group.companyName}
                            </td>
                          </tr>
                          {/* Sorted Items within Company Group */}
                          {group.items.map((item) => (
                            <tr
                              key={item.rowId}
                              className="dsr-a4-item-row border-b border-slate-300 text-xs hover:bg-slate-50/70"
                            >
                              <td className="py-1.5 px-2.5 border-r border-slate-300 text-center font-mono tabular-nums text-slate-700">
                                {item.sNo}
                              </td>
                              <td className="py-1.5 px-3 border-r border-slate-300 font-semibold text-slate-950 break-words">
                                {item.itemName}
                              </td>
                              <td className="py-1.5 px-3 border-r border-slate-300 text-right font-mono tabular-nums font-bold text-slate-950">
                                {formatQtyValue(item.qty)}
                              </td>
                              <td className="py-1.5 px-3 border-r border-slate-300 text-right font-mono tabular-nums font-bold text-slate-950">
                                {formatQtyValue(item.bonusQty)}
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono tabular-nums font-bold text-slate-950">
                                {formatQtyValue(item.looseQty)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>

                  {/* Final Totals Section */}
                  <div className="dsr-a4-totals-block border-2 border-slate-900 rounded-lg p-3.5 bg-slate-50">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">
                      Final Requisition Totals
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-xs">
                      <div className="bg-white border border-slate-300 rounded-md p-2.5">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Items
                        </span>
                        <span className="text-base font-mono tabular-nums font-black text-slate-950">
                          {dsrData.totalItems}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-md p-2.5">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Qty
                        </span>
                        <span className="text-base font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalQty)}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-md p-2.5">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Bonus Qty
                        </span>
                        <span className="text-base font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalBonusQty)}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-md p-2.5">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Loose Qty
                        </span>
                        <span className="text-base font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalLooseQty)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* =========================================================================
                 2. 80MM THERMAL RECEIPT DSR REPORT LAYOUT (COMPACT & PAGE-OPTIMIZED)
                 ========================================================================= */}
              <div
                className={activeLayout === 'thermal' ? 'w-full flex justify-center' : 'hidden'}
              >
                <div
                  ref={thermalPrintRef}
                  className="dsr-thermal-root bg-white border border-slate-300 shadow-xs w-full max-w-[76mm] px-1.5 py-1 text-slate-950 print:border-0 print:shadow-none print:px-0.5 print:py-0 print:max-w-[74mm]"
                >
                  <style>{`
                    .dsr-thermal-root {
                      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      font-size: 8.5px;
                      line-height: 1.12;
                      color: #000000;
                    }
                    .dsr-thermal-table {
                      width: 100% !important;
                      border-collapse: collapse !important;
                      table-layout: fixed !important;
                      margin: 0 !important;
                    }
                    .dsr-thermal-table th,
                    .dsr-thermal-table td {
                      padding-top: 1px !important;
                      padding-bottom: 1px !important;
                      vertical-align: top !important;
                      box-sizing: border-box !important;
                    }
                    .dsr-thermal-company-row td {
                      font-size: 8.5px !important;
                      line-height: 1.12 !important;
                      font-weight: 700 !important;
                      padding: 1.5px 2px !important;
                      background-color: #f1f5f9 !important;
                      border-top: 1px solid #0f172a !important;
                      border-bottom: 1px solid #334155 !important;
                      word-break: normal !important;
                      overflow-wrap: break-word !important;
                    }
                    .dsr-thermal-item-row td {
                      font-size: 8px !important;
                      line-height: 1.1 !important;
                      padding-top: 1px !important;
                      padding-bottom: 1px !important;
                      border-bottom: 0.5px dotted #94a3b8 !important;
                    }
                    .dsr-thermal-item-name {
                      font-size: 8px !important;
                      line-height: 1.1 !important;
                      font-weight: 600 !important;
                      letter-spacing: -0.1px !important;
                      word-break: normal !important;
                      overflow-wrap: break-word !important;
                      overflow: hidden !important;
                    }
                    .dsr-thermal-num {
                      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                      font-variant-numeric: tabular-nums !important;
                      white-space: nowrap !important;
                      overflow: hidden !important;
                    }
                    @media print {
                      @page {
                        size: 80mm auto;
                        margin: 0.5mm 1mm !important;
                      }
                      .dsr-thermal-root {
                        width: 100% !important;
                        max-width: 74mm !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        font-size: 8.5px !important;
                        line-height: 1.1 !important;
                      }
                      .dsr-thermal-table {
                        page-break-inside: auto !important;
                        break-inside: auto !important;
                      }
                      .dsr-thermal-table thead {
                        display: table-header-group !important;
                      }
                      .dsr-thermal-table tbody {
                        page-break-inside: auto !important;
                        break-inside: auto !important;
                      }
                      .dsr-thermal-company-row {
                        page-break-before: auto !important;
                        break-before: auto !important;
                        page-break-after: avoid !important;
                        break-after: avoid !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                      .dsr-thermal-item-row {
                        page-break-before: auto !important;
                        break-before: auto !important;
                        page-break-after: auto !important;
                        break-after: auto !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                      .dsr-thermal-totals {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                      }
                    }
                  `}</style>

                  {/* Store Name & Report Title (Compact) */}
                  <div className="text-center border-b border-dashed border-slate-900 pb-0.5 mb-0.5">
                    <div className="text-[10.5px] font-black uppercase tracking-tight leading-none">
                      {displayStoreName}
                    </div>
                    <div className="text-[8.5px] font-bold leading-tight mt-[1px]">
                      DSR – Daily Stock Requisition
                    </div>
                  </div>

                  {/* Ultra-Compact Invoice Metadata */}
                  <div className="border-b border-dashed border-slate-900 pb-0.5 mb-0.5 text-[8px] leading-tight">
                    <div className="flex justify-between items-baseline gap-1">
                      <span className=" truncate">
                        <span className="font-semibold text-slate-700">Inv:</span>{' '}
                        <span className="font-mono font-bold text-slate-950">
                          {displayInvoiceNumber}
                        </span>
                      </span>
                      <span className="shrink-0">
                        <span className="font-semibold text-slate-700">Date:</span>{' '}
                        <span className="font-mono font-bold text-slate-950">
                          {displayInvoiceDate}
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline gap-1 mt-[1px]">
                      <span className="font-semibold text-slate-700 shrink-0">Customer:</span>
                      <span className="font-bold text-slate-950 text-right break-words leading-tight">
                        {displayCustomerName}
                      </span>
                    </div>
                  </div>

                  {/* 80mm Thermal Table: S.No | Item Name | Qty | Bonus | Loose */}
                  <table className="dsr-thermal-table w-full border-collapse table-fixed">
                    <colgroup>
                      <col style={{ width: '8.5%' }} />
                      <col style={{ width: '53.5%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '13%' }} />
                      <col style={{ width: '13%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-900 text-[8px] font-extrabold uppercase leading-none">
                        <th className="pr-0.5 text-left whitespace-nowrap">S.No</th>
                        <th className="px-0.5 text-left whitespace-nowrap">Item Name</th>
                        <th className="px-0.5 text-right whitespace-nowrap">Qty</th>
                        <th className="px-0.5 text-right whitespace-nowrap">Bonus</th>
                        <th className="pl-0.5 text-right whitespace-nowrap">Loose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dsrData.groups.map((group) => (
                        <React.Fragment key={group.companyName}>
                          {/* Compact Company Group Heading */}
                          <tr className="dsr-thermal-company-row">
                            <td colSpan={5} className="text-slate-950">
                              {group.companyName}
                            </td>
                          </tr>
                          {/* Compact Items inside Company Group */}
                          {group.items.map((item) => (
                            <tr key={item.rowId} className="dsr-thermal-item-row">
                              <td className="dsr-thermal-num pr-0.5 text-left text-slate-800">
                                {item.sNo}
                              </td>
                              <td className="dsr-thermal-item-name px-0.5 text-slate-950">
                                {item.itemName}
                              </td>
                              <td className="dsr-thermal-num px-0.5 text-right font-bold text-slate-950">
                                {formatQtyValue(item.qty)}
                              </td>
                              <td className="dsr-thermal-num px-0.5 text-right font-bold text-slate-950">
                                {formatQtyValue(item.bonusQty)}
                              </td>
                              <td className="dsr-thermal-num pl-0.5 text-right font-bold text-slate-950">
                                {formatQtyValue(item.looseQty)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>

                  {/* 80mm Thermal Compact Final Totals (2x2 Grid) */}
                  <div className="dsr-thermal-totals border-t border-b border-dashed border-slate-900 py-0.5 mt-0.5 text-[8px] leading-tight">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-[1px]">
                      <div className="flex justify-between font-bold">
                        <span>Total Items:</span>
                        <span className="dsr-thermal-num">{dsrData.totalItems}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Total Qty:</span>
                        <span className="dsr-thermal-num">
                          {formatQtyValue(dsrData.totalQty)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Bonus Qty:</span>
                        <span className="dsr-thermal-num">
                          {formatQtyValue(dsrData.totalBonusQty)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Loose Qty:</span>
                        <span className="dsr-thermal-num">
                          {formatQtyValue(dsrData.totalLooseQty)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
