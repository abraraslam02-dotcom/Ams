import React, { useState, useMemo, useRef } from 'react';
import { Printer, X, Columns, FileText, Filter } from 'lucide-react';
import type { OrderFormPrintLayout } from '../../types/supply';
import { executePrintElement } from '../../utils/printEngine';
import { formatItemNameWithRemarks } from '../../utils/itemDisplay';
import { usePreviewZoom, PreviewZoomToolbar } from '../common/PreviewZoomControls';

export type SupplyDocumentPrintType =
  | 'order-form'
  | 'booking-slip'
  | 'packing-list'
  | 'supply-challan'
  | 'dispatch-challan'
  | 'return-voucher'
  | 'final-invoice'
  | 'recovery-receipt'
  | 'salesman-settlement'
  | 'report';

interface SupplyPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  docType: SupplyDocumentPrintType;
  title: string;
  subtitle?: string;
  headerMeta?: Array<{ label: string; value: string | number }>;
  /** For Order Form: items with company_name, item_code, item_name, trade_price, quantity, remarks */
  orderFormItems?: Array<{
    s_no?: number;
    company_name: string;
    item_code: string;
    item_name: string;
    packing?: string;
    trade_price: number;
    quantity?: number;
    remarks?: string;
  }>;
  initialOrderLayout?: OrderFormPrintLayout;
  /** Generic table columns & rows for Slips, Challans, Vouchers, Receipts, Settlements, and Reports */
  columns?: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows?: Array<Record<string, unknown>>;
  totals?: Array<{ label: string; value: string | number; highlight?: boolean }>;
  footerNotes?: string;
}

export const SupplyPrintModal: React.FC<SupplyPrintModalProps> = ({
  isOpen,
  onClose,
  docType,
  title,
  subtitle,
  headerMeta = [],
  orderFormItems = [],
  initialOrderLayout = '1-col',
  columns = [],
  rows = [],
  totals = [],
  footerNotes,
}) => {
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const [paperSize, setPaperSize] = useState<'a4' | 'thermal-80' | 'thermal-58'>(
    initialOrderLayout === 'thermal-80'
      ? 'thermal-80'
      : initialOrderLayout === 'thermal-58'
      ? 'thermal-58'
      : 'a4'
  );
  const isThermal = paperSize === 'thermal-80' || paperSize === 'thermal-58';
  const zoomState = usePreviewZoom({
    initialZoom: 100,
    naturalWidthPx:
      paperSize === 'thermal-58' ? 219 : paperSize === 'thermal-80' ? 302 : 794,
    naturalHeightPx: 1123,
    isThermal,
  });
  const [orderColLayout, setOrderColLayout] = useState<'1-col' | '2-col' | '3-col'>(
    initialOrderLayout === '2-col' ? '2-col' : initialOrderLayout === '3-col' ? '3-col' : '1-col'
  );
  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');

  const availableCompanies = useMemo(() => {
    const set = new Set<string>();
    orderFormItems.forEach((it) => {
      set.add(String(it.company_name || 'GENERAL').trim() || 'GENERAL');
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orderFormItems]);

  const groupedOrderItems = useMemo(() => {
    const filtered =
      selectedCompany === 'ALL'
        ? orderFormItems
        : orderFormItems.filter(
            (i) => (String(i.company_name || 'GENERAL').trim() || 'GENERAL') === selectedCompany
          );

    const sorted = [...filtered].sort((a, b) => {
      const cA = (String(a.company_name || 'GENERAL').trim() || 'GENERAL').toLowerCase();
      const cB = (String(b.company_name || 'GENERAL').trim() || 'GENERAL').toLowerCase();
      if (cA !== cB) return cA.localeCompare(cB);
      return String(a.item_name || '').toLowerCase().localeCompare(String(b.item_name || '').toLowerCase());
    });

    const groups: Array<{
      companyName: string;
      items: Array<{
        sNo: number;
        item_code: string;
        item_name: string;
        packing: string;
        trade_price: number;
        quantity: number;
        remarks: string;
      }>;
    }> = [];

    let globalSno = 1;
    for (const item of sorted) {
      const comp = String(item.company_name || 'GENERAL').trim() || 'GENERAL';
      let grp = groups.find((g) => g.companyName === comp);
      if (!grp) {
        grp = { companyName: comp, items: [] };
        groups.push(grp);
      }
      grp.items.push({
        sNo: globalSno++,
        item_code: String(item.item_code || ''),
        item_name: String(item.item_name || ''),
        packing: String(item.packing || ''),
        trade_price: Number(item.trade_price || 0),
        quantity: Number(item.quantity || 0),
        remarks: String(item.remarks || ''),
      });
    }
    return groups;
  }, [orderFormItems, selectedCompany]);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (printAreaRef.current) {
      executePrintElement(printAreaRef.current, {
        title: `Abrar Medical Store - ${title}`,
        paperSize:
          paperSize === 'thermal-80'
            ? '80mm'
            : paperSize === 'thermal-58'
            ? '58mm'
            : 'a4',
        profileId:
          paperSize === 'thermal-80'
            ? 'thermal-80mm'
            : paperSize === 'thermal-58'
            ? 'thermal-58mm'
            : 'a4-report',
        orientation: 'portrait',
        margin: paperSize === 'a4' ? 'standard' : 'none',
        showPageNumbers: paperSize === 'a4',
      });
    } else {
      window.print();
    }
  };

  const containerWidthClass =
    paperSize === 'thermal-58'
      ? 'thermal-receipt thermal-58mm w-[58mm] max-w-[58mm] h-auto min-h-0 self-start px-[1.5mm] py-[2mm] text-[10px]'
      : paperSize === 'thermal-80'
      ? 'thermal-receipt thermal-80mm w-[80mm] max-w-[80mm] h-auto min-h-0 self-start px-[2.5mm] py-[2.5mm] text-[11px]'
      : 'w-[210mm] max-w-[210mm] min-h-[297mm] p-6 text-xs';

  return (
    <div
      className={`print-modal-container fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 ${
        zoomState.isFullScreen ? 'p-0' : 'p-2 sm:p-3'
      } overflow-hidden print:bg-white print:p-0 print:m-0 ${
        isThermal ? 'print:block print:justify-start print:items-start' : ''
      }`}
    >
      <div
        className={`bg-white shadow-2xl w-full flex flex-col overflow-hidden print:shadow-none print:max-h-none print:rounded-none ${
          zoomState.isFullScreen
            ? 'h-screen max-w-none max-h-none rounded-none border-0'
            : 'max-w-[96vw] xl:max-w-7xl h-[95vh] max-h-[95vh] rounded-xl'
        }`}
      >
        {/* Toolbar (hidden when printing) */}
        <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-sm">{title} — Print & PDF Preview</h3>
              <p className="text-[11px] text-slate-300">
                {paperSize === 'a4'
                  ? 'A4 Standard (210 × 297 mm) · Multi-Page Repeating Headers'
                  : paperSize === 'thermal-80'
                  ? '80mm Thermal Roll (80mm Width × Dynamic Height)'
                  : '58mm Thermal Roll (58mm Width × Dynamic Height)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Paper size selector */}
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setPaperSize('a4')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  paperSize === 'a4' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5 inline mr-1" />
                A4 (210×297mm)
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('thermal-80')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  paperSize === 'thermal-80' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                80mm Thermal
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('thermal-58')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  paperSize === 'thermal-58' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                58mm Thermal
              </button>
            </div>

            {/* Order Form 1/2/3 Column & Company Selector */}
            {docType === 'order-form' && paperSize === 'a4' && (
              <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                <Columns className="w-3.5 h-3.5 text-amber-400 ml-2 mr-1" />
                <button
                  type="button"
                  onClick={() => setOrderColLayout('1-col')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    orderColLayout === '1-col' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  1 Column
                </button>
                <button
                  type="button"
                  onClick={() => setOrderColLayout('2-col')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    orderColLayout === '2-col' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  2 Columns
                </button>
                <button
                  type="button"
                  onClick={() => setOrderColLayout('3-col')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    orderColLayout === '3-col' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  3 Columns
                </button>
              </div>
            )}

            {docType === 'order-form' && availableCompanies.length > 1 && (
              <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
                <Filter className="w-3.5 h-3.5 text-sky-400" />
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  className="bg-slate-800 text-white text-xs font-semibold focus:outline-none"
                >
                  <option value="ALL">All Companies ({availableCompanies.length})</option>
                  {availableCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <PreviewZoomToolbar
              zoomState={zoomState}
              dark
              compact
              showPageNav
              showFullScreenButton
            />

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close Preview</span>
            </button>
          </div>
        </div>

        {/* MS Access / Windows Desktop-Style Grey Print Preview Area */}
        <div
          ref={zoomState.viewportRef}
          onWheel={zoomState.handleWheelZoom}
          className={`flex-1 overflow-auto p-6 lg:p-8 bg-[#525659] flex justify-center items-start print:bg-white print:p-0 print:m-0 print:overflow-visible ${
            isThermal ? 'print:block print:justify-start print:items-start' : ''
          }`}
        >
          <div
            ref={zoomState.contentRef}
            style={{ zoom: `${zoomState.zoom}%` } as React.CSSProperties}
            className={`ams-screen-zoom-wrapper inline-flex justify-center items-start h-auto min-h-0 transition-all duration-75 ${
              isThermal ? 'print:flex print:flex-col print:justify-start print:items-start print:m-0 print:p-0' : ''
            }`}
          >
            <div
              ref={printAreaRef}
              style={
                isThermal
                  ? {
                      width: paperSize === 'thermal-58' ? '58mm' : '80mm',
                      maxWidth: paperSize === 'thermal-58' ? '58mm' : '80mm',
                      height: 'auto',
                      minHeight: 0,
                    }
                  : undefined
              }
              className={`bg-white text-slate-950 shadow-[0_12px_32px_rgba(0,0,0,0.45)] border border-slate-400 relative print:shadow-none print:border-none ${
                isThermal ? 'print:p-0 print:m-0' : 'print:p-1'
              } ${containerWidthClass}`}
            >
            {/* Store & Document Header */}
            <div className="text-center border-b-2 border-slate-900 pb-2.5 mb-3">
              <h1 className={`font-black tracking-tight uppercase ${isThermal ? 'text-sm' : 'text-xl'}`}>
                ABRAR MEDICAL STORE
              </h1>
              <p className="text-[11px] font-semibold text-slate-700">
                Wholesale & Supply Distribution Division
              </p>
              <div className="mt-1.5 inline-block px-3 py-0.5 bg-slate-900 text-white font-bold uppercase tracking-wider text-xs rounded">
                {title}
              </div>
              {subtitle && <p className="text-[11px] font-medium text-slate-600 mt-1">{subtitle}</p>}
            </div>

            {/* Header Metadata Grid */}
            {headerMeta.length > 0 && (
              <div
                className={`grid gap-x-4 gap-y-1 border-b border-slate-300 pb-2.5 mb-3 ${
                  isThermal ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'
                }`}
              >
                {headerMeta.map((m, idx) => (
                  <div key={idx} className="flex items-baseline justify-between sm:justify-start gap-1.5">
                    <span className="font-bold text-slate-600 whitespace-nowrap">{m.label}:</span>
                    <span className="font-bold text-slate-950">{m.value || '—'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* CASE 1: ORDER FORM (Company-Wise 1-Col, 2-Col, 3-Col or Thermal) */}
            {docType === 'order-form' ? (
              <div className="space-y-3">
                {groupedOrderItems.map((group) => (
                  <div key={group.companyName} className="ams-company-group">
                    {/* Company Heading Banner */}
                    <div className="ams-keep-with-next bg-slate-900 text-white px-2.5 py-1 font-bold uppercase tracking-wide flex items-center justify-between text-[11px]">
                      <span>COMPANY: {group.companyName}</span>
                      <span>{group.items.length} Items</span>
                    </div>

                    {/* Single Column Detailed Layout or Thermal */}
                    {isThermal || orderColLayout === '1-col' ? (
                      <table className="w-full border-collapse border border-slate-400 text-left">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-400 text-[10px] uppercase">
                            <th className="border border-slate-300 px-1.5 py-1 w-8 text-center">S.No</th>
                            {!isThermal && (
                              <th className="border border-slate-300 px-1.5 py-1 w-24">Item Code</th>
                            )}
                            <th className="border border-slate-300 px-1.5 py-1">Item Name</th>
                            <th className="border border-slate-300 px-1.5 py-1 w-16 text-right">T.P</th>
                            <th className="border border-slate-300 px-1.5 py-1 w-16 text-center">Qty</th>
                            {!isThermal && (
                              <th className="border border-slate-300 px-1.5 py-1 w-32">Remarks</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((it) => (
                            <tr key={it.sNo} className="border-b border-slate-300">
                              <td className="border border-slate-300 px-1.5 py-1 text-center font-mono">
                                {it.sNo}
                              </td>
                              {!isThermal && (
                                <td className="border border-slate-300 px-1.5 py-1 font-mono text-[10px]">
                                  {it.item_code}
                                </td>
                              )}
                              <td className="border border-slate-300 px-1.5 py-1 font-semibold">
                                {formatItemNameWithRemarks(it.item_name, it.remarks)}
                              </td>
                              <td className="border border-slate-300 px-1.5 py-1 text-right font-mono">
                                {it.trade_price.toFixed(2)}
                              </td>
                              <td className="border border-slate-300 px-1.5 py-1 text-center font-bold">
                                {it.quantity > 0 ? it.quantity : '____'}
                              </td>
                              {!isThermal && (
                                <td className="border border-slate-300 px-1.5 py-1 text-[10px]">
                                  {it.remarks || ''}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      /* 2-Column or 3-Column Compact Full-Page Grid */
                      <div
                        className={`grid border-l border-t border-slate-400 ${
                          orderColLayout === '2-col' ? 'grid-cols-2' : 'grid-cols-3'
                        }`}
                      >
                        {group.items.map((it) => (
                          <div
                            key={it.sNo}
                            className="border-r border-b border-slate-400 px-1.5 py-1 flex items-center justify-between gap-1 text-[10px]"
                          >
                            <div className="truncate flex-1">
                              <span className="font-mono text-slate-500 mr-1">{it.sNo}.</span>
                              <span className="font-bold text-slate-900">
                                {formatItemNameWithRemarks(it.item_name, it.remarks)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-slate-700">
                                @{it.trade_price.toFixed(0)}
                              </span>
                              <span className="inline-block min-w-[34px] text-center border-b border-slate-800 font-bold">
                                {it.quantity > 0 ? it.quantity : '___'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* CASE 2: STANDARD TABLE (Booking Slip, Packing List, Supply/Dispatch Challan, Return Voucher, Final Invoice, Recovery Receipt, Settlement, Report) */
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100 border-b-2 border-slate-800 text-[10px] uppercase">
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className={`border border-slate-300 px-1.5 py-1 font-bold ${
                            col.align === 'right'
                              ? 'text-right'
                              : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, columns.length)}
                          className="text-center py-6 text-slate-500"
                        >
                          No records to display
                        </td>
                      </tr>
                    ) : (
                      rows.map((r, rIdx) => (
                        <tr key={rIdx} className="border-b border-slate-300">
                          {columns.map((col) => {
                            const rawVal = r[col.key];
                            const formatted =
                              typeof rawVal === 'number'
                                ? col.key.includes('qty') ||
                                  col.key.includes('quantity') ||
                                  col.key.includes('items') ||
                                  col.key.includes('parties') ||
                                  col.key === 's_no'
                                  ? rawVal
                                  : rawVal.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })
                                : String(rawVal ?? '');
                            return (
                              <td
                                key={col.key}
                                className={`border border-slate-300 px-1.5 py-1 ${
                                  col.align === 'right'
                                    ? 'text-right font-mono'
                                    : col.align === 'center'
                                    ? 'text-center'
                                    : 'text-left'
                                }`}
                              >
                                {formatted}
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

            {/* Totals Summary Block */}
            {totals.length > 0 && (
              <div className="mt-3 pt-2 border-t-2 border-slate-900 flex flex-wrap justify-end gap-4">
                {totals.map((t, idx) => (
                  <div
                    key={idx}
                    className={`px-2.5 py-1 rounded border ${
                      t.highlight
                        ? 'bg-slate-900 text-white border-slate-900 font-black'
                        : 'bg-slate-50 text-slate-900 border-slate-300 font-bold'
                    }`}
                  >
                    <span className="text-[10px] uppercase mr-1.5 opacity-80">{t.label}:</span>
                    <span className="font-mono">
                      {typeof t.value === 'number'
                        ? t.value.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : t.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {footerNotes && (
              <div className="mt-3 text-[11px] text-slate-700 border-t border-dashed border-slate-300 pt-2">
                <strong>Remarks / Notes:</strong> {footerNotes}
              </div>
            )}

            {/* Signatures */}
            <div className="mt-8 pt-4 border-t border-slate-300 grid grid-cols-3 gap-4 text-center text-[10px] font-semibold text-slate-700">
              <div>
                <div className="border-b border-slate-400 h-6 mb-1" />
                Prepared / Booked By
              </div>
              <div>
                <div className="border-b border-slate-400 h-6 mb-1" />
                Salesman / Delivery Sign
              </div>
              <div>
                <div className="border-b border-slate-400 h-6 mb-1" />
                Party / Store Stamp & Sign
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
