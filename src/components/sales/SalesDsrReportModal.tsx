import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Receipt, FileText, X, ClipboardList, AlertCircle } from 'lucide-react';
import { DatasheetRow, FastSearchItem } from '../../types/sales';
import { api } from '../../services/api';
import { executePrintElement } from '../../utils/printEngine';
import { usePreviewZoom, PreviewZoomToolbar } from '../common/PreviewZoomControls';

export interface SalesDsrReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
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

const DSR_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// 2026-11-14  ->  14-nov-2026
function formatDateDMY(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!str) return '';
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${DSR_MONTHS[Number(m[2]) - 1] || m[2]}-${m[1]}`;
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, '0')}-${DSR_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  }
  return str;
}

export const SalesDsrReportModal: React.FC<SalesDsrReportModalProps> = ({
  isOpen,
  onClose,
  storeName: propStoreName,
  invoiceNumber,
  invoiceDate,
  customerName,
  customerPhone,
  customerAddress,
  rows,
  catalogItems = [],
}) => {
  const [resolvedStoreName, setResolvedStoreName] = useState<string>(
    propStoreName?.trim() || 'Abrar Medical Store'
  );
  const [activeLayout, setActiveLayout] = useState<'a4' | 'thermal'>('a4');
  const [printOpts, setPrintOpts] = useState<{ margin: any; fontSizeScale: any; selectedPrinter?: string }>({
    margin: 'standard',
    fontSizeScale: 'normal',
  });

  const a4PrintRef = useRef<HTMLDivElement | null>(null);
  const thermalPrintRef = useRef<HTMLDivElement | null>(null);
  const zoomState = usePreviewZoom({
    initialZoom: 100,
    naturalWidthPx: activeLayout === 'thermal' ? 302 : 794,
    naturalHeightPx: 1123,
    isThermal: activeLayout === 'thermal',
  });

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
        if (!mounted || !res?.data) return;
        if (res.data.store_name) {
          setResolvedStoreName(String(res.data.store_name).trim() || 'Abrar Medical Store');
        }
        setPrintOpts({
          margin: res.data.page_margin || 'standard',
          fontSizeScale: res.data.font_size_scale || 'normal',
          selectedPrinter: res.data.default_printer || undefined,
        });
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
  const displayCustomerPhone = customerPhone?.trim() || '';
  const displayCustomerAddress = customerAddress?.trim() || '';

  const handlePrintA4 = () => {
    setActiveLayout('a4');
    setTimeout(() => {
      executePrintElement(a4PrintRef.current, {
        title: `${displayStoreName} - DSR Report - ${displayInvoiceNumber} (A4 Portrait)`,
        paperSize: 'a4',
        profileId: 'a4-report',
        orientation: 'portrait',
        margin: 'none',
        fontSizeScale: 'normal',
        copies: 1,
        showPageNumbers: true,
      });
    }, 40);
  };

  const handlePrintThermal = () => {
    setActiveLayout('thermal');
    setTimeout(() => {
      executePrintElement(thermalPrintRef.current, {
        title: `${displayStoreName} - DSR Report - ${displayInvoiceNumber} (80mm Thermal)`,
        paperSize: '80mm',
        profileId: 'thermal-80mm',
        orientation: 'portrait',
        margin: 'none',
        fontSizeScale: printOpts.fontSizeScale,
        copies: 1,
        selectedPrinter: printOpts.selectedPrinter,
      });
    }, 40);
  };

  return (
    <div
      className={`print-modal-container fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center ${
        zoomState.isFullScreen ? 'p-0' : 'p-2 lg:p-3'
      } overflow-hidden print:static print:bg-white print:p-0`}
    >
      <div
        className={`bg-white shadow-2xl border border-slate-300 w-full flex flex-col overflow-hidden print:shadow-none print:border-0 print:max-w-none print:max-h-none ${
          zoomState.isFullScreen
            ? 'h-screen max-w-none max-h-none rounded-none border-0'
            : 'max-w-[96vw] xl:max-w-6xl h-[95vh] max-h-[95vh] rounded-xl'
        }`}
      >
        {/* Top Action Bar (Hidden when printing) */}
        <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">
                DSR – Daily Stock Requisition ({displayInvoiceNumber})
              </h3>
              <p className="text-[11px] text-slate-400">
                {activeLayout === 'a4'
                  ? `A4 Standard (210 × 297 mm) · Company-wise A–Z · ${dsrData.totalItems} Item(s)`
                  : `80mm Thermal Roll (80mm × Dynamic Height) · ${dsrData.totalItems} Item(s)`}
              </p>
            </div>
          </div>

          {/* Preview Layout Switcher + Print Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 mr-1">
              <button
                type="button"
                onClick={() => setActiveLayout('a4')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayout === 'a4'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Preview A4 Paper Layout (210 × 297 mm)"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>A4 (210×297mm)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveLayout('thermal')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeLayout === 'thermal'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Preview 80mm Thermal Layout (Dynamic Height)"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>80mm Thermal</span>
              </button>
            </div>

            <PreviewZoomToolbar
              zoomState={zoomState}
              dark
              compact
              showPageNav
              showFullScreenButton
            />

            {/* 1. Print A4 Portrait */}
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
              <span>Close Preview</span>
            </button>
          </div>
        </div>

        {/* MS Access / Windows Desktop-Style Grey Print Preview Workspace */}
        <div
          ref={zoomState.viewportRef}
          onWheel={zoomState.handleWheelZoom}
          className="flex-1 overflow-auto p-6 lg:p-8 bg-[#525659] flex justify-center items-start print:p-0 print:bg-white print:overflow-visible"
        >
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
            <div
              ref={zoomState.contentRef}
              style={{ zoom: `${zoomState.zoom}%` } as React.CSSProperties}
              className="ams-screen-zoom-wrapper inline-flex justify-center items-start h-auto min-h-0 transition-all duration-75"
            >
              {/* =========================================================================
                 1. STANDARD A4 PORTRAIT (210mm x 297mm) DSR REPORT LAYOUT
                 ========================================================================= */}
              <div
                className={activeLayout === 'a4' ? 'inline-flex justify-center' : 'hidden'}
              >
                <div
                  ref={a4PrintRef}
                  className="bg-white border border-slate-400 shadow-[0_12px_32px_rgba(0,0,0,0.45)] w-[210mm] max-w-[210mm] min-h-[297mm] p-3 lg:p-4 text-slate-900 text-xs relative print:border-0 print:shadow-none print:p-0 print:w-full print:max-w-none print:min-h-0"
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
                  <div className="border-b-2 border-slate-900 pb-1.5 mb-1.5 text-center">
                    <h1 className="text-base font-black tracking-tight text-slate-950 uppercase">
                      {displayStoreName}
                    </h1>
                    <h2 className="text-xs font-bold tracking-wide text-slate-800 mt-0">
                      DSR – Daily Stock Requisition
                    </h2>
                  </div>

                  {/* Invoice Metadata Bar */}
                  <div className="grid grid-cols-3 gap-2 mb-2 p-1.5 rounded-md bg-slate-50 border border-slate-300 text-xs">
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
                    {(displayCustomerPhone || displayCustomerAddress) && (
                      <div className="col-span-3 grid grid-cols-3 gap-2 pt-1 border-t border-slate-300">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                            Mobile No
                          </span>
                          <span className="font-mono font-bold text-slate-950 text-sm">
                            {displayCustomerPhone || '—'}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                            Address
                          </span>
                          <span className="font-semibold text-slate-950 text-sm break-words">
                            {displayCustomerAddress || '—'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Company-wise Grouped Table with Repeating Multi-Page Header */}
                  <table className="dsr-a4-table w-full border-collapse border border-slate-400 mb-2">
                    <thead>
                      {/* Repeating Page Header Row for Multi-Page A4 Printouts */}
                      <tr className="bg-slate-100 border-b border-slate-400 text-[10px] text-slate-700">
                        <th colSpan={5} className="py-0.5 px-1.5 text-left font-bold">
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
                        <th className="py-1 px-1.5 text-center border border-slate-700 w-12">
                          S.No
                        </th>
                        <th className="py-1 px-2 text-left border border-slate-700">
                          Item Name
                        </th>
                        <th className="py-1 px-2 text-right border border-slate-700 w-20">
                          Qty
                        </th>
                        <th className="py-1 px-2 text-right border border-slate-700 w-20">
                          Bonus Qty
                        </th>
                        <th className="py-1 px-2 text-right border border-slate-700 w-20">
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
                              className="py-0.5 px-1.5 font-black text-slate-950 text-[10px] tracking-wide leading-tight"
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
                              <td className="py-0.5 px-1.5 border-r border-slate-300 text-center font-mono tabular-nums text-slate-700 text-[10px]">
                                {item.sNo}
                              </td>
                              <td className="py-0.5 px-1.5 border-r border-slate-300 font-medium text-[10px] leading-tight text-slate-950 break-words">
                                {item.itemName}
                              </td>
                              <td className="py-0.5 px-1.5 border-r border-slate-300 text-right font-mono tabular-nums font-bold text-[10px] text-slate-950">
                                {formatQtyValue(item.qty)}
                              </td>
                              <td className="py-0.5 px-1.5 border-r border-slate-300 text-right font-mono tabular-nums font-bold text-[10px] text-slate-950">
                                {formatQtyValue(item.bonusQty)}
                              </td>
                              <td className="py-0.5 px-1.5 text-right font-mono tabular-nums font-bold text-[10px] text-slate-950">
                                {formatQtyValue(item.looseQty)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>

                  {/* Final Totals Section */}
                  <div className="dsr-a4-totals-block border border-slate-900 rounded-md p-1.5 bg-slate-50">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Final Requisition Totals
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      <div className="bg-white border border-slate-300 rounded-sm p-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Items
                        </span>
                        <span className="text-sm font-mono tabular-nums font-black text-slate-950">
                          {dsrData.totalItems}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-sm p-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Qty
                        </span>
                        <span className="text-sm font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalQty)}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-sm p-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Bonus Qty
                        </span>
                        <span className="text-sm font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalBonusQty)}
                        </span>
                      </div>
                      <div className="bg-white border border-slate-300 rounded-sm p-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Total Loose Qty
                        </span>
                        <span className="text-sm font-mono tabular-nums font-black text-slate-950">
                          {formatQtyValue(dsrData.totalLooseQty)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* =========================================================================
                 2. 80MM THERMAL RECEIPT DSR REPORT LAYOUT (EXACT 80MM WIDTH & DYNAMIC HEIGHT)
                 ========================================================================= */}
              <div
                className={activeLayout === 'thermal' ? 'inline-flex justify-center items-start' : 'hidden'}
              >
                <div
                  ref={thermalPrintRef}
                  style={{ width: '80mm', maxWidth: '80mm', height: 'auto', minHeight: 0 }}
                  className="thermal-receipt thermal-80mm bg-white border border-slate-400 shadow-[0_12px_32px_rgba(0,0,0,0.45)] text-black font-sans tabular-nums leading-tight w-[80mm] max-w-[80mm] h-auto min-h-0 self-start px-[2.5mm] py-[2.5mm] text-[12px] relative print:border-0 print:shadow-none print:p-1"
                >
                  {/* Header: Store name + report title (same style as Sales thermal invoice) */}
                  <div className="text-center pb-1">
                    <div className="font-black text-black tracking-tight leading-tight text-[15px]">
                      {displayStoreName}
                    </div>
                    <div className="font-semibold text-black leading-tight mt-0 text-[10px]">
                      DSR – Daily Stock Requisition
                    </div>
                  </div>

                  {/* Boxed meta: Customer, Date, Invoice No */}
                  <table className="w-full border-collapse border border-black text-black text-[10px]">
                    <tbody>
                      <tr>
                        <td className="border border-black px-1 py-0 font-semibold whitespace-nowrap w-[26%]">
                          Customer
                        </td>
                        <td className="border border-black px-1 py-0 font-black break-words text-[11px]">
                          {displayCustomerName}
                        </td>
                      </tr>
                      {displayCustomerPhone && (
                        <tr>
                          <td className="border border-black px-1 py-0 font-semibold whitespace-nowrap">
                            Mobile No
                          </td>
                          <td className="border border-black px-1 py-0 font-bold font-mono">
                            {displayCustomerPhone}
                          </td>
                        </tr>
                      )}
                      {displayCustomerAddress && (
                        <tr>
                          <td className="border border-black px-1 py-0 font-semibold whitespace-nowrap align-top">
                            Address
                          </td>
                          <td className="border border-black px-1 py-0 font-semibold break-words">
                            {displayCustomerAddress}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="border border-black px-1 py-0 font-semibold whitespace-nowrap">
                          Date
                        </td>
                        <td className="border border-black px-1 py-0 font-semibold">
                          {formatDateDMY(displayInvoiceDate)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1 py-0 font-semibold whitespace-nowrap">
                          Invoice No
                        </td>
                        <td className="border border-black px-1 py-0 font-black font-mono text-[11px]">
                          {displayInvoiceNumber}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Boxed items table: # | Item Name | Qty | LQty | Bonus (company-wise A-Z) */}
                  <table className="w-full border-collapse border border-black border-t-0 text-black text-[11.5px]">
                    <thead>
                      <tr className="font-black text-black bg-white">
                        <th className="border border-black px-1 py-1 text-center font-black w-[22px]">#</th>
                        <th className="border border-black px-1 py-0.5 text-center font-black">Item Name</th>
                        <th className="border border-black px-0.5 py-0.5 text-center font-black whitespace-nowrap text-[10.5px] w-[38px]">
                          Qty
                        </th>
                        <th className="border border-black px-0.5 py-0.5 text-center font-black whitespace-nowrap text-[10.5px] w-[38px]">
                          LQty
                        </th>
                        <th className="border border-black px-0.5 py-0.5 text-center font-black whitespace-nowrap text-[10.5px] w-[42px]">
                          Bonus
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dsrData.groups.map((group) => (
                        <React.Fragment key={group.companyName}>
                          <tr>
                            <td
                              colSpan={5}
                              className="border border-black px-1 py-0 bg-slate-100 font-black uppercase text-[11px] break-words"
                            >
                              {group.companyName}
                            </td>
                          </tr>
                          {group.items.map((item) => (
                            <tr key={item.rowId} className="align-middle">
                              <td className="border border-black px-1 py-0.5 text-center font-bold">
                                {item.sNo}
                              </td>
                              <td className="border border-black px-1 py-0.5 font-bold break-words leading-tight text-[10px]">
                                {item.itemName}
                              </td>
                              <td className="border border-black px-0.5 py-0.5 text-center font-mono font-black whitespace-nowrap text-[10px]">
                                {formatQtyValue(item.qty)}
                              </td>
                              <td className="border border-black px-0.5 py-0.5 text-center font-mono font-bold whitespace-nowrap text-[10px]">
                                {item.looseQty > 0 ? formatQtyValue(item.looseQty) : '-'}
                              </td>
                              <td className="border border-black px-0.5 py-0.5 text-center font-mono font-bold whitespace-nowrap text-[10px]">
                                {item.bonusQty > 0 ? formatQtyValue(item.bonusQty) : '-'}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>

                  {/* Last line: Total Items only */}
                  <table className="w-full border-collapse border border-black border-t-0 text-black">
                    <tbody>
                      <tr className="font-black text-[11px]">
                        <td className="border-2 border-black px-1.5 py-0.5 text-left font-black uppercase tracking-wide">
                          Total Items
                        </td>
                        <td className="border-2 border-black px-1.5 py-0.5 text-right font-mono font-black w-[30%]">
                          {dsrData.totalItems}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
