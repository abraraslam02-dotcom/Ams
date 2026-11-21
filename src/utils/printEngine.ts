export type PaperSizeOption = 'a4' | 'legal' | '80mm' | '58mm';
export type PageOrientationOption = 'portrait' | 'landscape';
export type PageMarginOption = 'none' | 'minimum' | 'compact' | 'standard';
export type FontSizeScaleOption = 'small' | 'normal' | 'large';

/**
 * Five independent printing configurations supported by Abrar Medical Store ERP:
 * 1. A4 Sales Invoices (210mm x 297mm)
 * 2. A4 Purchase Invoices (210mm x 297mm)
 * 3. A4 Reports (210mm x 297mm)
 * 4. 80mm Thermal Invoices (80mm x 297mm PDF page)
 * 5. 58mm Thermal Invoices (58mm x auto dynamic height)
 */
export type PrintConfigurationProfileId =
  | 'a4-sales-invoice'
  | 'a4-purchase-invoice'
  | 'a4-report'
  | 'thermal-80mm'
  | 'thermal-58mm';

export interface PrintConfigurationSpec {
  id: PrintConfigurationProfileId;
  label: string;
  paperSize: PaperSizeOption;
  widthMm: number;
  heightMm: number | 'auto';
  defaultMargin: PageMarginOption;
  defaultOrientation: PageOrientationOption;
  pageSizeCss: (orientation: PageOrientationOption) => string;
  printableWidthCss: (orientation: PageOrientationOption) => string;
  previewWidthCss: (orientation: PageOrientationOption) => string;
  previewMinHeightCss: (orientation: PageOrientationOption) => string;
  isThermal: boolean;
}

export const PRINT_CONFIGURATION_PROFILES: Record<
  PrintConfigurationProfileId,
  PrintConfigurationSpec
> = {
  'a4-sales-invoice': {
    id: 'a4-sales-invoice',
    label: 'A4 Sales Invoice (210 × 297 mm)',
    paperSize: 'a4',
    widthMm: 210,
    heightMm: 297,
    defaultMargin: 'standard',
    defaultOrientation: 'portrait',
    pageSizeCss: (o) => (o === 'landscape' ? '297mm 210mm' : '210mm 297mm'),
    printableWidthCss: (o) => (o === 'landscape' ? '281mm' : '194mm'),
    previewWidthCss: (o) => (o === 'landscape' ? '297mm' : '210mm'),
    previewMinHeightCss: (o) => (o === 'landscape' ? '210mm' : '297mm'),
    isThermal: false,
  },
  'a4-purchase-invoice': {
    id: 'a4-purchase-invoice',
    label: 'A4 Purchase Invoice (210 × 297 mm)',
    paperSize: 'a4',
    widthMm: 210,
    heightMm: 297,
    defaultMargin: 'standard',
    defaultOrientation: 'portrait',
    pageSizeCss: (o) => (o === 'landscape' ? '297mm 210mm' : '210mm 297mm'),
    printableWidthCss: (o) => (o === 'landscape' ? '281mm' : '194mm'),
    previewWidthCss: (o) => (o === 'landscape' ? '297mm' : '210mm'),
    previewMinHeightCss: (o) => (o === 'landscape' ? '210mm' : '297mm'),
    isThermal: false,
  },
  'a4-report': {
    id: 'a4-report',
    label: 'A4 Report (210 × 297 mm)',
    paperSize: 'a4',
    widthMm: 210,
    heightMm: 297,
    defaultMargin: 'standard',
    defaultOrientation: 'portrait',
    pageSizeCss: (o) => (o === 'landscape' ? '297mm 210mm' : '210mm 297mm'),
    printableWidthCss: (o) => (o === 'landscape' ? '281mm' : '194mm'),
    previewWidthCss: (o) => (o === 'landscape' ? '297mm' : '210mm'),
    previewMinHeightCss: (o) => (o === 'landscape' ? '210mm' : '297mm'),
    isThermal: false,
  },
  'thermal-80mm': {
    id: 'thermal-80mm',
    label: '80mm Thermal Receipt (80mm × 297mm PDF Page)',
    paperSize: '80mm',
    widthMm: 80,
    heightMm: 297,
    defaultMargin: 'none',
    defaultOrientation: 'portrait',
    pageSizeCss: () => '80mm 297mm',
    printableWidthCss: () => '76mm',
    previewWidthCss: () => '80mm',
    previewMinHeightCss: () => 'auto',
    isThermal: true,
  },
  'thermal-58mm': {
    id: 'thermal-58mm',
    label: '58mm Thermal Receipt (58mm × Auto)',
    paperSize: '58mm',
    widthMm: 58,
    heightMm: 'auto',
    defaultMargin: 'none',
    defaultOrientation: 'portrait',
    pageSizeCss: () => '58mm auto',
    printableWidthCss: () => '54mm',
    previewWidthCss: () => '58mm',
    previewMinHeightCss: () => 'auto',
    isThermal: true,
  },
};

export function resolvePrintConfigurationProfile(
  paperSize: PaperSizeOption = 'a4',
  category: 'sales' | 'purchase' | 'report' = 'report'
): PrintConfigurationSpec {
  if (paperSize === '80mm') return PRINT_CONFIGURATION_PROFILES['thermal-80mm'];
  if (paperSize === '58mm') return PRINT_CONFIGURATION_PROFILES['thermal-58mm'];
  if (category === 'sales') return PRINT_CONFIGURATION_PROFILES['a4-sales-invoice'];
  if (category === 'purchase') return PRINT_CONFIGURATION_PROFILES['a4-purchase-invoice'];
  return PRINT_CONFIGURATION_PROFILES['a4-report'];
}

export interface PrintJobConfig {
  title: string;
  paperSize: PaperSizeOption;
  profileId?: PrintConfigurationProfileId;
  orientation?: PageOrientationOption;
  margin?: PageMarginOption;
  fontSizeScale?: FontSizeScaleOption;
  copies?: number;
  selectedPrinter?: string;
  showPageNumbers?: boolean;
}

export interface BrowserPrintCapabilities {
  browserPrintSupported: boolean;
  iframePrintSupported: boolean;
  webUsbAvailable: boolean;
  webSerialAvailable: boolean;
  availablePrinterProfiles: string[];
  setupNotes: string[];
}

export const STANDARD_PRINTER_PROFILES = [
  'System Default Printer (OS Print Spooler)',
  'A4 Laser / InkJet Printer (HP / Canon / Brother - 210×297mm)',
  '80mm Thermal POS Receipt Printer (ESC/POS Spooler)',
  '58mm Thermal POS Receipt Printer (ESC/POS Spooler)',
  'Save as PDF Document (Browser Native PDF)',
];

/**
 * Detects browser and operating system printing capabilities without assuming a physical printer is attached.
 */
export function detectPrintCapabilities(configuredDefaultPrinter?: string): BrowserPrintCapabilities {
  const isBrowser = typeof window !== 'undefined';
  const browserPrintSupported = isBrowser && typeof window.print === 'function';
  const webUsbAvailable = isBrowser && 'usb' in navigator;
  const webSerialAvailable = isBrowser && 'serial' in navigator;

  const profiles = [...STANDARD_PRINTER_PROFILES];
  if (
    configuredDefaultPrinter &&
    configuredDefaultPrinter.trim() !== '' &&
    !profiles.includes(configuredDefaultPrinter.trim())
  ) {
    profiles.unshift(configuredDefaultPrinter.trim());
  }

  return {
    browserPrintSupported,
    iframePrintSupported: isBrowser && typeof document !== 'undefined',
    webUsbAvailable,
    webSerialAvailable,
    availablePrinterProfiles: profiles,
    setupNotes: [
      'Browser security delegates final hardware selection to the Operating System Print Spooler dialog.',
      'For A4 Laser/InkJet invoices & reports: Choose your installed printer or "Save as PDF", Paper Size: A4 (210mm × 297mm), Portrait, Scale: 100% / Default.',
      'For 80mm / 58mm Thermal Receipt printers: Select your ESC/POS thermal driver in the OS print dialog, Paper Size: 80mm or 58mm Roll (dynamic height), Margins: None.',
    ],
  };
}

function getMarginMm(paperSize: PaperSizeOption, margin: PageMarginOption = 'standard'): string {
  if (paperSize === '80mm' || paperSize === '58mm') {
    if (margin === 'none') return '0mm';
    if (margin === 'minimum') return '0.5mm';
    if (margin === 'compact') return '1mm';
    return '1.5mm';
  }
  switch (margin) {
    case 'none':
      return '0mm';
    case 'minimum':
      return '4mm';
    case 'compact':
      return '6mm';
    case 'standard':
    default:
      return '8mm';
  }
}

function getFontZoomPercent(scale: FontSizeScaleOption = 'normal'): string {
  switch (scale) {
    case 'small':
      return '92%';
    case 'large':
      return '112%';
    case 'normal':
    default:
      return '100%';
  }
}

const PDF_TITLE_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/**
 * Formats an invoice date as DD-mmm-YYYY in lowercase (e.g. "2026-11-18" -> "18-nov-2026").
 */
export function formatDateDMYForPdf(raw?: unknown): string {
  const str = String(raw ?? '').trim();
  const now = new Date();
  if (!str) {
    return `${String(now.getDate()).padStart(2, '0')}-${PDF_TITLE_MONTHS[now.getMonth()]}-${now.getFullYear()}`;
  }
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const day = isoMatch[3];
    const mon = PDF_TITLE_MONTHS[Number(isoMatch[2]) - 1] || isoMatch[2];
    const yr = isoMatch[1];
    return `${day}-${mon}-${yr}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = String(dmyMatch[1]).padStart(2, '0');
    const mon = PDF_TITLE_MONTHS[Number(dmyMatch[2]) - 1] || dmyMatch[2];
    const yr = dmyMatch[3];
    return `${day}-${mon}-${yr}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getDate()).padStart(2, '0')}-${PDF_TITLE_MONTHS[parsed.getMonth()]}-${parsed.getFullYear()}`;
  }
  return str.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Builds the standardized Save-to-PDF document title / filename for Sales and Purchase invoices:
 * Format: `<customer_or_supplier_name>_invno:<invoiceNo>_<DD-mmm-YYYY>`
 * Example: `abrar_invno:123_18-nov-2026`
 */
export function buildInvoicePdfTitle(
  partyName?: unknown,
  invoiceNumber?: unknown,
  invoiceDate?: unknown
): string {
  const cleanParty = String(partyName || 'customer')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '')
    .replace(/\s+/g, '_');
  const cleanInvNo = String(invoiceNumber || '0')
    .trim()
    .replace(/\s+/g, '');
  const cleanDate = formatDateDMYForPdf(invoiceDate);
  return `${cleanParty || 'customer'}_invno:${cleanInvNo || '0'}_${cleanDate}`;
}

/**
 * Prints an HTML element cleanly using an isolated hidden iframe so:
 * - No popup windows (window.open) are required
 * - Complete CSS styles, Tailwind utility classes, custom fonts, borders, and colors are synchronously inlined
 * - Independent print configurations for A4 Sales, A4 Purchase, A4 Reports, 80mm Thermal, and 58mm Thermal are strictly enforced
 * - 80mm Thermal PDF documents use an explicit 80mm x 297mm page; 58mm remains dynamic height
 */
export function executePrintElement(element: HTMLElement | null, config: PrintJobConfig): void {
  if (!element) {
    const prevTitle = document.title;
    if (config.title) document.title = config.title;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 1000);
    return;
  }

  const copies = Math.max(1, Math.min(10, Number(config.copies) || 1));
  const rawPaperSize = config.paperSize || 'a4';
  // Normalize 'legal' fallback to 'a4' unless explicitly required, since A4 (210x297mm) is standard for all A4 invoices & reports
  const paperSize: PaperSizeOption = rawPaperSize === 'legal' ? 'a4' : rawPaperSize;
  const isThermal = paperSize === '80mm' || paperSize === '58mm';
  const isFullPage = !isThermal;
  const orientation: PageOrientationOption = isFullPage ? config.orientation || 'portrait' : 'portrait';
  const marginMm = getMarginMm(paperSize, isThermal ? (config.margin === 'none' ? 'none' : 'minimum') : config.margin || 'standard');
  const zoomPercent = getFontZoomPercent(config.fontSizeScale || 'normal');

  const pageSizeCss =
    paperSize === '80mm'
      ? '80mm 297mm'
      : paperSize === '58mm'
      ? '58mm auto'
      : orientation === 'landscape'
      ? '297mm 210mm'
      : '210mm 297mm';

  const containerWidthCss =
    paperSize === '80mm'
      ? '76mm'
      : paperSize === '58mm'
      ? '54mm'
      : orientation === 'landscape'
      ? '281mm'
      : '194mm';

  // Extract all CSS rules from active document stylesheets to ensure synchronous, complete CSS rendering
  let inlinedStyles = '';
  try {
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      try {
        const rules = Array.from(sheet.cssRules || []);
        for (const rule of rules) {
          inlinedStyles += rule.cssText + '\n';
        }
      } catch {
        // Cross-origin stylesheet access protection - handled by outerHTML fallback below
      }
    }
  } catch {
    // ignore
  }

  // Also collect all active <style> and <link rel="stylesheet"> tags from the main document
  const styleNodes = Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map((node) => node.outerHTML)
    .join('\n');

  // Build copies HTML (each copy separated by a clean page break except the last)
  const copyBlocks: string[] = [];
  for (let i = 0; i < copies; i++) {
    const isLast = i === copies - 1;
    copyBlocks.push(`
      <div class="ams-print-copy-wrapper ${!isLast ? 'ams-page-break-after' : ''}">
        ${
          copies > 1
            ? `<div style="text-align:right;font-size:9px;font-family:monospace;color:#475569;margin-bottom:4px;">COPY ${
                i + 1
              } OF ${copies}</div>`
            : ''
        }
        ${element.outerHTML}
      </div>
    `);
  }

  const showPageNumbers = Boolean(config.showPageNumbers && isFullPage);
  const effectiveMarginCss = isThermal
    ? '0mm'
    : showPageNumbers && (marginMm === '0mm' || marginMm === '4mm')
    ? `${marginMm} ${marginMm} 10mm ${marginMm}`
    : showPageNumbers
    ? `${marginMm} ${marginMm} 12mm ${marginMm}`
    : marginMm;

  const printDocumentHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <base href="${window.location.origin}/" />
    <title>${config.title || 'Abrar Medical Store Document'}</title>
    ${styleNodes}
    <style id="ams-runtime-inlined-styles">
      ${inlinedStyles}
    </style>
    <style>
      @page {
        size: ${pageSizeCss};
        margin: ${effectiveMarginCss};
        ${
          showPageNumbers
            ? `
        @bottom-left {
          content: "${(config.title || 'Abrar Medical Store').replace(/"/g, '\\"')}";
          font-size: 8.5px;
          color: #64748b;
          font-family: system-ui, sans-serif;
        }
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 9px;
          font-weight: 600;
          color: #334155;
          font-family: system-ui, sans-serif;
        }`
            : ''
        }
      }
      *, *::before, *::after {
        box-sizing: border-box !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${isThermal ? (paperSize === '80mm' ? '80mm' : '58mm') : '100%'} !important;
        max-width: ${isThermal ? (paperSize === '80mm' ? '80mm' : '58mm') : '100%'} !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        background: #ffffff !important;
        color: #000000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
        line-height: 1.3 !important;
        zoom: ${zoomPercent};
      }
      .ams-print-root {
        width: ${isThermal ? containerWidthCss : '100%'} !important;
        max-width: ${containerWidthCss} !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 auto !important;
        padding: ${isThermal ? '1mm 1.5mm' : '0'} !important;
        background: #ffffff !important;
      }
      .ams-print-root > .ams-print-copy-wrapper {
        height: auto !important;
        min-height: 0 !important;
      }
      .ams-print-root > .ams-print-copy-wrapper > * {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      .thermal-receipt,
      .thermal-receipt * {
        color: #000000 !important;
      }
      .thermal-receipt {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
      }
      .thermal-receipt table {
        width: 100% !important;
        border-collapse: collapse !important;
      }
      .thermal-receipt th,
      .thermal-receipt td {
        border: 1px solid #000000 !important;
      }
      .ams-page-break-after {
        page-break-after: always !important;
        break-after: page !important;
      }
      table {
        width: 100% !important;
        border-collapse: collapse !important;
        page-break-inside: auto !important;
      }
      thead {
        display: table-header-group !important;
      }
      tfoot {
        display: table-footer-group !important;
      }
      tr, .ams-avoid-break {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .ams-keep-with-next {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      .ams-company-group {
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      th, td {
        word-break: normal !important;
        overflow-wrap: break-word !important;
      }
      .print\\:hidden, .no-print, button {
        display: none !important;
      }
      .print\\:block {
        display: block !important;
      }
      .print\\:flex {
        display: flex !important;
      }
      .print\\:table-row {
        display: table-row !important;
      }
      .print\\:table-header-group {
        display: table-header-group !important;
      }
    </style>
  </head>
  <body>
    <div class="ams-print-root">
      ${copyBlocks.join('\n')}
    </div>
  </body>
</html>`;

  const existingFrame = document.getElementById('ams-isolated-print-frame');
  if (existingFrame) {
    existingFrame.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'ams-isolated-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    window.print();
    return;
  }

  doc.open();
  doc.write(printDocumentHtml);
  doc.close();

  const triggerPrint = () => {
    const previousTitle = document.title;
    if (config.title) {
      document.title = config.title;
    }
    const restoreTitle = () => {
      document.title = previousTitle;
    };
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = restoreTitle;
      }
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.print();
    }
    setTimeout(restoreTitle, 3000);
  };

  // Check if there are any images in the iframe document that need to load first
  const images = Array.from(doc.images || []);
  if (images.length > 0) {
    let loadedCount = 0;
    const total = images.length;
    const checkAllLoaded = () => {
      loadedCount++;
      if (loadedCount >= total) {
        setTimeout(triggerPrint, 100);
      }
    };
    images.forEach((img) => {
      if (img.complete) {
        checkAllLoaded();
      } else {
        img.onload = checkAllLoaded;
        img.onerror = checkAllLoaded;
      }
    });
    // Safety fallback timeout in case an image hangs
    setTimeout(triggerPrint, 400);
  } else {
    // Styles are inlined, can trigger immediately after event loop cycle
    setTimeout(triggerPrint, 180);
  }
}

/**
 * Standard utility to print any report or document element with A4 Portrait / thermal settings.
 */
export function printReportDocument(
  element: HTMLElement | null,
  title: string,
  options?: Partial<PrintJobConfig>
): void {
  executePrintElement(element, {
    title,
    paperSize: options?.paperSize || 'a4',
    profileId: options?.profileId || 'a4-report',
    orientation: options?.orientation || 'portrait',
    margin: options?.margin || 'standard',
    fontSizeScale: options?.fontSizeScale || 'normal',
    copies: options?.copies || 1,
    selectedPrinter: options?.selectedPrinter || 'System Default Printer (OS Print Spooler)',
    showPageNumbers: options?.showPageNumbers ?? true,
  });
}
