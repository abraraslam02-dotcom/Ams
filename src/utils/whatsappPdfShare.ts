import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { formatAppDate, replaceIsoDatesInText } from './formatters';
import { PageOrientationOption, PaperSizeOption } from './printEngine';

export interface GeneratePrintPdfOptions {
  filename: string;
  paperSize?: PaperSizeOption;
  orientation?: PageOrientationOption;
  fixedThermalHeightMm?: number;
}

export interface GeneratedPdfResult {
  blob: Blob;
  file: File;
  filename: string;
}

export interface DirectWhatsAppShareResult {
  method: 'web_share_file' | 'whatsapp_desktop_protocol' | 'cancelled';
  filename: string;
  webFallbackUrl: string;
}

/**
 * Sanitizes any document/report title into a clean .pdf filename with dd-MMM-yy date.
 */
export function buildReportPdfFilename(title: string, dateInput?: string | Date | null): string {
  const cleanTitle = String(title || 'abrar_medical_store_report')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  const datePart = formatAppDate(dateInput || new Date());
  const base = `${cleanTitle || 'report'}_${datePart}`;
  return base.endsWith('.pdf') ? base : `${base}.pdf`;
}

/**
 * Builds the direct WhatsApp Desktop protocol URI (whatsapp://send?...) so the OS opens
 * the installed WhatsApp app directly without opening Google Chrome or a browser chooser.
 */
export function buildWhatsAppDesktopUri(
  normalizedPhone?: string | null,
  message?: string
): string {
  const params = new URLSearchParams();
  if (normalizedPhone && normalizedPhone.trim()) {
    params.set('phone', normalizedPhone.trim());
  }
  if (message && message.trim()) {
    params.set('text', message);
  }
  const qs = params.toString();
  return qs ? `whatsapp://send?${qs}` : 'whatsapp://send';
}

/**
 * Builds a WhatsApp Web fallback URL (used ONLY if the user explicitly clicks the fallback link
 * because WhatsApp Desktop is not installed). Uses web.whatsapp.com directly instead of wa.me
 * to avoid external redirect browser-chooser prompts.
 */
export function buildWhatsAppWebUrl(
  normalizedPhone?: string | null,
  message?: string
): string {
  const params = new URLSearchParams();
  if (normalizedPhone && normalizedPhone.trim()) {
    params.set('phone', normalizedPhone.trim());
  }
  if (message && message.trim()) {
    params.set('text', message);
  }
  const qs = params.toString();
  return qs ? `https://web.whatsapp.com/send?${qs}` : 'https://web.whatsapp.com/';
}

/**
 * Invokes the native whatsapp:// protocol directly without opening a new browser tab
 * (preventing repeated Chrome/browser selection prompts on Windows, macOS, and Android).
 */
export function openWhatsAppDesktopDirect(
  normalizedPhone?: string | null,
  message?: string
): { protocolUri: string; webFallbackUrl: string } {
  const protocolUri = buildWhatsAppDesktopUri(normalizedPhone, message);
  const webFallbackUrl = buildWhatsAppWebUrl(normalizedPhone, message);

  try {
    // Use a temporary anchor without target="_blank" so the OS protocol handler
    // hands off directly to installed WhatsApp without spawning a new browser window/picker.
    const link = document.createElement('a');
    link.href = protocolUri;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch {
    try {
      window.location.href = protocolUri;
    } catch {
      // ignore protocol error
    }
  }

  return { protocolUri, webFallbackUrl };
}

/**
 * Captures an existing printable DOM element using its real print layout (A4 Portrait,
 * A4 Landscape, 80mm Thermal, or 58mm Thermal) and renders a real multi-page or thermal PDF File.
 */
export async function generatePdfFromPrintElement(
  element: HTMLElement,
  options: GeneratePrintPdfOptions
): Promise<GeneratedPdfResult> {
  const rawPaperSize = options.paperSize || 'a4';
  const paperSize: PaperSizeOption = rawPaperSize === 'legal' ? 'a4' : rawPaperSize;
  const isThermal = paperSize === '80mm' || paperSize === '58mm';
  const orientation: PageOrientationOption = isThermal
    ? 'portrait'
    : options.orientation || 'portrait';

  const filename = options.filename.toLowerCase().endsWith('.pdf')
    ? options.filename
    : `${options.filename}.pdf`;

  // Exact capture width in CSS px (96 DPI equivalent of mm)
  const targetWidthPx =
    paperSize === '58mm'
      ? 220
      : paperSize === '80mm'
      ? 302
      : orientation === 'landscape'
      ? 1122
      : 794;

  // Render an isolated offscreen clone so preview zoom/scroll/overflow never distort the PDF
  const stage = document.createElement('div');
  stage.setAttribute('data-ams-pdf-stage', 'true');
  stage.style.position = 'fixed';
  stage.style.left = '-100000px';
  stage.style.top = '0';
  stage.style.width = `${targetWidthPx}px`;
  stage.style.maxWidth = `${targetWidthPx}px`;
  stage.style.background = '#ffffff';
  stage.style.color = '#000000';
  stage.style.zIndex = '-1';
  stage.style.pointerEvents = 'none';
  stage.style.overflow = 'visible';

  const clone = element.cloneNode(true) as HTMLElement;

  // Strip preview transforms/shadows and ensure crisp full-width rendering
  clone.style.transform = 'none';
  clone.style.zoom = '1';
  clone.style.width = `${targetWidthPx}px`;
  clone.style.maxWidth = `${targetWidthPx}px`;
  clone.style.minHeight = '0';
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';
  clone.style.background = '#ffffff';

  // Hide print-only-hidden elements and interactive buttons inside the cloned report
  clone
    .querySelectorAll('.print\\:hidden, .no-print, button, [data-pdf-exclude="true"]')
    .forEach((node) => {
      (node as HTMLElement).style.display = 'none';
    });

  // Reveal elements that are normally hidden on screen but shown in print
  clone.querySelectorAll('.hidden.print\\:block').forEach((node) => {
    (node as HTMLElement).style.display = 'block';
  });
  clone.querySelectorAll('.hidden.print\\:flex').forEach((node) => {
    (node as HTMLElement).style.display = 'flex';
  });

  // Expand scroll containers so wide tables and tall lists aren't clipped
  clone.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (
      cls.includes('overflow-x-auto') ||
      cls.includes('overflow-y-auto') ||
      cls.includes('overflow-auto') ||
      cls.includes('overflow-hidden')
    ) {
      el.style.overflow = 'visible';
      el.style.maxHeight = 'none';
    }
  });

  // Standardize any remaining ISO dates inside printed text nodes to dd-MMM-yy
  try {
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue && /\d{4}-\d{2}-\d{2}/.test(node.nodeValue)) {
        node.nodeValue = replaceIsoDatesInText(node.nodeValue);
      }
      node = walker.nextNode();
    }
  } catch {
    // ignore text walker errors
  }

  stage.appendChild(clone);
  document.body.appendChild(stage);

  try {
    // Wait a frame for layout and fonts to settle
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const canvas = await html2canvas(clone, {
      scale: isThermal ? 2.5 : 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: targetWidthPx,
      windowWidth: targetWidthPx,
    });

    const imgData = canvas.toDataURL('image/png');
    const canvasWidth = canvas.width || 1;
    const canvasHeight = canvas.height || 1;

    if (isThermal) {
      const pageW = paperSize === '58mm' ? 58 : 80;
      const marginMm = 1;
      const printableW = pageW - marginMm * 2;
      const contentHeightMm = (canvasHeight / canvasWidth) * printableW;
      const minHeight =
        typeof options.fixedThermalHeightMm === 'number' && options.fixedThermalHeightMm > 0
          ? options.fixedThermalHeightMm
          : 50;
      const pageH = Math.max(minHeight, Math.ceil(contentHeightMm + marginMm * 2 + 2));

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pageW, pageH],
        compress: true,
      });

      pdf.addImage(imgData, 'PNG', marginMm, marginMm, printableW, contentHeightMm, undefined, 'FAST');

      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      return { blob, file, filename };
    }

    // A4 Portrait (210x297mm) or A4 Landscape (297x210mm) with clean multi-page slicing
    const pageW = orientation === 'landscape' ? 297 : 210;
    const pageH = orientation === 'landscape' ? 210 : 297;
    const marginMm = 8;
    const printableW = pageW - marginMm * 2;
    const printableH = pageH - marginMm * 2;

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const totalPdfHeightMm = (canvasHeight / canvasWidth) * printableW;

    if (totalPdfHeightMm <= printableH + 0.5) {
      pdf.addImage(
        imgData,
        'PNG',
        marginMm,
        marginMm,
        printableW,
        totalPdfHeightMm,
        undefined,
        'FAST'
      );
    } else {
      // Slice source canvas into crisp per-page strips so nothing overlaps or clips
      const pxPerMm = canvasWidth / printableW;
      const sliceHeightPx = Math.max(1, Math.floor(printableH * pxPerMm));
      let offsetY = 0;
      let pageIdx = 0;

      while (offsetY < canvasHeight) {
        const remainingPx = canvasHeight - offsetY;
        const currentSlicePx = Math.min(sliceHeightPx, remainingPx);

        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvasWidth;
        sliceCanvas.height = currentSlicePx;
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0,
            offsetY,
            canvasWidth,
            currentSlicePx,
            0,
            0,
            canvasWidth,
            currentSlicePx
          );
        }

        const sliceImg = sliceCanvas.toDataURL('image/png');
        const sliceHeightMm = currentSlicePx / pxPerMm;

        if (pageIdx > 0) {
          pdf.addPage('a4', orientation);
        }
        pdf.addImage(
          sliceImg,
          'PNG',
          marginMm,
          marginMm,
          printableW,
          sliceHeightMm,
          undefined,
          'FAST'
        );

        offsetY += currentSlicePx;
        pageIdx += 1;
      }
    }

    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    return { blob, file, filename };
  } finally {
    stage.remove();
  }
}

/**
 * Shares a generated PDF File directly to WhatsApp:
 * 1. Primary (Direct PDF Attachment — Desktop & Mobile): Uses Web Share API Level 2
 *    (`navigator.share({ files: [file], title, text })`) on EVERY platform that supports
 *    file sharing (Windows 10/11 Edge & Chrome, macOS Safari & Chrome, Android, iOS).
 *    This attaches the actual PDF directly to WhatsApp without opening Chrome or requiring
 *    manual download & attach.
 * 2. Fallback (when OS file sharing is unavailable in the browser):
 *    Saves the PDF file automatically and opens installed WhatsApp Desktop directly via
 *    `whatsapp://send?...` (avoiding `https://wa.me/...` browser-selection prompts).
 */
export async function sharePdfFileViaWhatsApp(params: {
  file: File;
  blob: Blob;
  filename: string;
  title: string;
  message: string;
  normalizedPhone?: string | null;
}): Promise<DirectWhatsAppShareResult> {
  const { file, blob, filename, title, message, normalizedPhone } = params;
  const webFallbackUrl = buildWhatsAppWebUrl(normalizedPhone, message);

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  // 1. Direct native file sharing (works on desktop Windows/macOS AND mobile Android/iOS)
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    let canShareFiles = false;
    try {
      canShareFiles = nav.canShare({ files: [file] });
    } catch {
      canShareFiles = false;
    }

    if (canShareFiles) {
      try {
        await nav.share({
          title,
          text: message,
          files: [file],
        });
        return {
          method: 'web_share_file',
          filename,
          webFallbackUrl,
        };
      } catch (err: unknown) {
        // User explicitly cancelled the native Share Sheet -> exit cleanly, never open browser!
        if (err instanceof DOMException && err.name === 'AbortError') {
          return {
            method: 'cancelled',
            filename,
            webFallbackUrl,
          };
        }
        // Try sharing file only if OS rejected combining text + files
        try {
          await nav.share({
            title,
            files: [file],
          });
          return {
            method: 'web_share_file',
            filename,
            webFallbackUrl,
          };
        } catch (err2: unknown) {
          if (err2 instanceof DOMException && err2.name === 'AbortError') {
            return {
              method: 'cancelled',
              filename,
              webFallbackUrl,
            };
          }
          // Fall through to WhatsApp Desktop protocol fallback
        }
      }
    }
  }

  // 2. Simplest Desktop Fallback when OS Web Share with files is not supported:
  //    Save the generated PDF + invoke whatsapp:// protocol directly (NO Chrome/browser picker!).
  try {
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = filename;
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch {
    // ignore download error
  }

  openWhatsAppDesktopDirect(normalizedPhone, message);

  return {
    method: 'whatsapp_desktop_protocol',
    filename,
    webFallbackUrl,
  };
}
