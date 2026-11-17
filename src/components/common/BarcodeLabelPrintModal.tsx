import React, { useMemo, useState } from 'react';
import { Barcode, Printer, X } from 'lucide-react';
import { formatPKR } from '../../utils/formatters';

interface BarcodeLabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  itemCode: string;
  barcode: string;
  price?: number;
  packing?: string;
  availableBarcodes?: string[];
}

// Standard Code 128-B bar patterns (11 modules per character, 13 for Stop)
const CODE128_PATTERNS: string[] = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

function encodeCode128B(text: string): Array<{ x: number; w: number }> {
  const clean = (text || '000000').replace(/[^\x20-\x7e]/g, '');
  const codes: number[] = [104]; // Start B
  let checksum = 104;
  for (let i = 0; i < clean.length; i++) {
    const val = Math.max(0, Math.min(94, clean.charCodeAt(i) - 32));
    codes.push(val);
    checksum += val * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106); // Stop

  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;
  for (const c of codes) {
    const pattern = CODE128_PATTERNS[c] || CODE128_PATTERNS[0];
    for (let j = 0; j < pattern.length; j++) {
      const width = Number(pattern[j]);
      if (j % 2 === 0) {
        bars.push({ x: cursor, w: width });
      }
      cursor += width;
    }
  }
  return bars;
}

function renderCode128SvgString(code: string, widthPx = 180, heightPx = 38): string {
  const bars = encodeCode128B(code);
  const last = bars[bars.length - 1];
  const totalUnits = last ? last.x + last.w : 100;
  const rects = bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="100" fill="#0f172a" />`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalUnits} 100" width="${widthPx}" height="${heightPx}" preserveAspectRatio="none">${rects}</svg>`;
}

export const BarcodeLabelPrintModal: React.FC<BarcodeLabelPrintModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  itemCode,
  barcode,
  price,
  packing,
  availableBarcodes,
}) => {
  const uniqueCodes = useMemo(() => {
    const list = [barcode, ...(availableBarcodes || [])].map((x) => String(x || '').trim()).filter(Boolean);
    return Array.from(new Set(list));
  }, [barcode, availableBarcodes]);

  const [selectedCode, setSelectedCode] = useState(barcode || itemCode);
  const [copies, setCopies] = useState(1);
  const [labelSize, setLabelSize] = useState<'50x25' | '38x25' | 'a4_sheet'>('50x25');
  const [showPrice, setShowPrice] = useState(true);

  const activeCode = (uniqueCodes.includes(selectedCode) ? selectedCode : uniqueCodes[0]) || barcode || itemCode;

  const previewSvg = useMemo(() => renderCode128SvgString(activeCode, 210, 44), [activeCode]);

  if (!isOpen) return null;

  const handlePrint = () => {
    const safeCopies = Math.max(1, Math.min(100, Number(copies) || 1));
    const svgHtml = renderCode128SvgString(
      activeCode,
      labelSize === '38x25' ? 128 : 168,
      labelSize === '38x25' ? 28 : 34
    );

    const cardHtml = `
      <div class="label-card">
        <div class="store">ABRAR MEDICAL STORE</div>
        <div class="prod">${title.replace(/</g, '&lt;')}</div>
        ${subtitle ? `<div class="sub">${subtitle.replace(/</g, '&lt;')}</div>` : ''}
        <div class="bars">${svgHtml}</div>
        <div class="meta">
          <span>${activeCode}</span>
          ${showPrice && price !== undefined && price > 0 ? `<span class="price">${formatPKR(price)}</span>` : ''}
        </div>
      </div>
    `;

    const allCards = Array.from({ length: safeCopies }, () => cardHtml).join('\n');

    const pageCss =
      labelSize === 'a4_sheet'
        ? `@page { size: A4 portrait; margin: 10mm; }
           body { margin: 0; font-family: Arial, sans-serif; }
           .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
           .label-card { border: 1px dashed #cbd5e1; padding: 3mm; text-align: center; break-inside: avoid; }`
        : labelSize === '38x25'
        ? `@page { size: 38mm 25mm; margin: 1mm; }
           body { margin: 0; font-family: Arial, sans-serif; }
           .label-card { width: 36mm; height: 23mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; overflow: hidden; }`
        : `@page { size: 50mm 25mm; margin: 1.5mm; }
           body { margin: 0; font-family: Arial, sans-serif; }
           .label-card { width: 47mm; height: 22mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; overflow: hidden; }`;

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Barcode Labels - ${activeCode}</title>
          <style>
            ${pageCss}
            .store { font-size: 7px; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; color: #0f172a; }
            .prod { font-size: 8.5px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
            .sub { font-size: 7.5px; color: #334155; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
            .bars { margin: 1.5px 0; display: flex; justify-content: center; }
            .meta { width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 7.5px; font-family: monospace; font-weight: 700; color: #0f172a; padding: 0 2px; box-sizing: border-box; }
            .price { font-family: Arial, sans-serif; font-weight: 800; }
          </style>
        </head>
        <body>
          <div class="sheet">${allCards}</div>
        </body>
      </html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        window.setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1200);
      }, 150);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/65 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden text-xs">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <span className="font-bold text-sm flex items-center gap-2">
            <Barcode className="w-4 h-4 text-emerald-400" />
            <span>Print Barcode Label</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Live Sticker Preview */}
          <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <div className="bg-white border border-slate-300 rounded-lg px-4 py-2.5 shadow-xs text-center w-64 space-y-0.5">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-700">
                ABRAR MEDICAL STORE
              </div>
              <div className="text-xs font-bold text-slate-900 truncate">{title}</div>
              {subtitle && (
                <div className="text-[11px] font-semibold text-slate-600 truncate">
                  {subtitle} {packing ? `• ${packing}` : ''}
                </div>
              )}
              <div
                className="flex justify-center pt-1"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-900 pt-0.5">
                <span>{activeCode}</span>
                {showPrice && price !== undefined && price > 0 && (
                  <span className="font-sans font-extrabold">{formatPKR(price)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {uniqueCodes.length > 1 && (
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Barcode to Print
                </label>
                <select
                  value={activeCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                >
                  {uniqueCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Label Size</label>
              <select
                value={labelSize}
                onChange={(e) => setLabelSize(e.target.value as any)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              >
                <option value="50x25">50 × 25 mm Sticker</option>
                <option value="38x25">38 × 25 mm Sticker</option>
                <option value="a4_sheet">A4 Multi-Label Sheet</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Number of Labels
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={showPrice}
              onChange={(e) => setShowPrice(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span>Include Retail Price (MRP) on label</span>
          </label>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print {copies > 1 ? `${copies} Labels` : 'Label'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
