export type PaperSizeOption = 'a4' | '80mm' | '58mm';
export type PageOrientationOption = 'portrait' | 'landscape';
export type PageMarginOption = 'none' | 'minimum' | 'compact' | 'standard';
export type FontSizeScaleOption = 'small' | 'normal' | 'large';

export interface PrintJobConfig {
  title: string;
  paperSize: PaperSizeOption;
  orientation?: PageOrientationOption;
  margin?: PageMarginOption;
  fontSizeScale?: FontSizeScaleOption;
  copies?: number;
  selectedPrinter?: string;
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
  'A4 Laser / InkJet Printer (HP / Canon / Brother)',
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
      'For A4 Laser/InkJet invoices & reports: Choose your installed A4 printer or "Save as PDF", Paper Size: A4, Scale: 100% / Default.',
      'For 80mm / 58mm Thermal Receipt printers: Select your ESC/POS thermal driver in the OS print dialog, set Margins to "None" or "Minimum", and uncheck "Headers and footers".',
    ],
  };
}

function getMarginMm(paperSize: PaperSizeOption, margin: PageMarginOption = 'standard'): string {
  if (paperSize === '80mm' || paperSize === '58mm') {
    if (margin === 'none') return '0mm';
    if (margin === 'minimum') return '1mm';
    if (margin === 'compact') return '1.5mm';
    return '2mm';
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

/**
 * Prints an HTML element cleanly using an isolated hidden iframe so:
 * - No popup windows (window.open) are required
 * - Complete CSS styles, Tailwind utility classes, custom fonts, borders, and colors are synchronously inlined
 * - Paper size (A4 / 80mm / 58mm), orientation, margins, font scaling, and multiple copies are applied accurately
 * - Long reports and invoices paginate cleanly with repeating table headers and zero trailing blank pages
 */
export function executePrintElement(element: HTMLElement | null, config: PrintJobConfig): void {
  if (!element) {
    window.print();
    return;
  }

  const copies = Math.max(1, Math.min(10, Number(config.copies) || 1));
  const paperSize = config.paperSize || 'a4';
  const orientation = paperSize === 'a4' ? config.orientation || 'portrait' : 'portrait';
  const marginMm = getMarginMm(paperSize, config.margin || 'standard');
  const zoomPercent = getFontZoomPercent(config.fontSizeScale || 'normal');

  const pageSizeCss =
    paperSize === '80mm'
      ? '80mm auto'
      : paperSize === '58mm'
      ? '58mm auto'
      : `A4 ${orientation}`;

  const containerMaxWidth =
    paperSize === '80mm'
      ? '74mm'
      : paperSize === '58mm'
      ? '52mm'
      : orientation === 'landscape'
      ? '280mm'
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
        margin: ${marginMm};
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
        height: auto !important;
        min-height: 0 !important;
        background: #ffffff !important;
        color: #000000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
        line-height: 1.3 !important;
        zoom: ${zoomPercent};
      }
      .ams-print-root {
        width: 100%;
        max-width: ${containerMaxWidth};
        margin: 0 auto !important;
        background: #ffffff !important;
      }
      .ams-print-root > .ams-print-copy-wrapper > * {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      .thermal-receipt,
      .thermal-receipt * {
        color: #000000 !important;
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
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.print();
    }
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
 * Standard utility to print any report or document element with A4/thermal settings.
 */
export function printReportDocument(
  element: HTMLElement | null,
  title: string,
  options?: Partial<PrintJobConfig>
): void {
  executePrintElement(element, {
    title,
    paperSize: options?.paperSize || 'a4',
    orientation: options?.orientation || 'portrait',
    margin: options?.margin || 'standard',
    fontSizeScale: options?.fontSizeScale || 'normal',
    copies: options?.copies || 1,
    selectedPrinter: options?.selectedPrinter || 'System Default Printer (OS Print Spooler)',
  });
}
