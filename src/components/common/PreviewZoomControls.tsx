import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Expand,
  Shrink,
  Printer,
  X,
} from 'lucide-react';
import { printReportDocument } from '../../utils/printEngine';

export type ZoomPreset = 50 | 75 | 100 | 125 | 150 | 200;
export type ZoomFitMode = 'manual' | 'fit-width' | 'fit-page';

export const ZOOM_PRESETS: ZoomPreset[] = [50, 75, 100, 125, 150, 200];

export interface PreviewZoomState {
  zoom: number;
  fitMode: ZoomFitMode;
  currentPage: number;
  totalPages: number;
  isFullScreen: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  setPresetZoom: (percent: number) => void;
  selectPreset: (val: number | string) => void;
  fitToWidth: (containerEl?: HTMLElement | null, paperWidthMm?: number) => void;
  fitToPage: (
    containerEl?: HTMLElement | null,
    paperWidthMm?: number,
    paperHeightMm?: number
  ) => void;
  goToPrevPage: () => void;
  goToNextPage: () => void;
  goToPage: (pageNumber: number) => void;
  toggleFullScreen: () => void;
  setIsFullScreen: React.Dispatch<React.SetStateAction<boolean>>;
  recalculatePages: () => void;
  handleWheelZoom: (e: React.WheelEvent | WheelEvent) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export interface UsePreviewZoomOptions {
  initialZoom?: number;
  naturalWidthPx?: number;
  naturalHeightPx?: number;
  isThermal?: boolean;
}

// A4 standard dimensions at 96 DPI: 210mm = 794px, 297mm = 1123px
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;
export const THERMAL_80MM_WIDTH_PX = 302;
export const THERMAL_58MM_WIDTH_PX = 219;

/**
 * Hook managing MS Access / Windows Desktop style print preview state:
 * - Screen-only zoom (50% - 200%, Fit to Width, Fit to Page, Ctrl + Mouse Wheel)
 * - Multi-page detection and Previous / Next page navigation
 * - Full-screen preview workspace toggle
 * Never alters print layout or @media print output.
 */
export function usePreviewZoom(options?: UsePreviewZoomOptions | number): PreviewZoomState {
  const opts: UsePreviewZoomOptions =
    typeof options === 'number' ? { initialZoom: options } : options || {};
  const [zoom, setZoom] = useState<number>(opts.initialZoom || 100);
  const [fitMode, setFitMode] = useState<ZoomFitMode>('manual');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const naturalWidth = opts.naturalWidthPx || A4_WIDTH_PX;
  const naturalHeight = opts.naturalHeightPx || A4_HEIGHT_PX;
  const isThermal = Boolean(opts.isThermal);

  const clampZoom = (val: number) => Math.max(50, Math.min(200, Math.round(val)));

  const recalculatePages = useCallback(() => {
    if (isThermal) {
      setTotalPages(1);
      setCurrentPage(1);
      return;
    }
    const ct = contentRef.current;
    if (!ct) {
      setTotalPages(1);
      return;
    }
    const targetPaper = ct.firstElementChild as HTMLElement | null;
    const rawHeight = targetPaper ? targetPaper.scrollHeight : ct.scrollHeight;
    // Account for small padding tolerance (e.g. 24px) so a single A4 page doesn't report 2 pages
    const computedPages = Math.max(1, Math.ceil(Math.max(1, rawHeight - 24) / naturalHeight));
    setTotalPages(computedPages);
    setCurrentPage((prev) => Math.min(prev, computedPages));
  }, [isThermal, naturalHeight]);

  useEffect(() => {
    const timer = setTimeout(recalculatePages, 120);
    return () => clearTimeout(timer);
  }, [recalculatePages, zoom, isFullScreen]);

  useEffect(() => {
    const ct = contentRef.current;
    if (!ct || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      recalculatePages();
    });
    observer.observe(ct);
    if (ct.firstElementChild) {
      observer.observe(ct.firstElementChild);
    }
    return () => observer.disconnect();
  }, [recalculatePages]);

  const zoomIn = useCallback(() => {
    setFitMode('manual');
    setZoom((prev) => {
      const nextPreset = ZOOM_PRESETS.find((p) => p > prev);
      return nextPreset ? nextPreset : clampZoom(prev + 25);
    });
  }, []);

  const zoomOut = useCallback(() => {
    setFitMode('manual');
    setZoom((prev) => {
      const prevPresets = ZOOM_PRESETS.filter((p) => p < prev);
      return prevPresets.length > 0 ? prevPresets[prevPresets.length - 1] : clampZoom(prev - 25);
    });
  }, []);

  const setPresetZoom = useCallback((percent: number) => {
    setFitMode('manual');
    setZoom(clampZoom(percent));
  }, []);

  const computeFitToWidth = useCallback(
    (containerEl?: HTMLElement | null, paperWidthMm?: number) => {
      const vp = containerEl || viewportRef.current;
      const ct = contentRef.current;
      const availW = vp ? Math.max(280, vp.clientWidth - 64) : window.innerWidth - 120;
      const customWidthPx = paperWidthMm ? (paperWidthMm / 25.4) * 96 : naturalWidth;
      const targetPaper = ct?.firstElementChild as HTMLElement | null;
      const measuredW = targetPaper && targetPaper.offsetWidth > 100 ? targetPaper.offsetWidth : 0;
      const docW = paperWidthMm ? customWidthPx : measuredW || customWidthPx;
      const calculated = clampZoom((availW / Math.max(1, docW)) * 100);
      setZoom(calculated);
    },
    [naturalWidth]
  );

  const computeFitToPage = useCallback(
    (containerEl?: HTMLElement | null, paperWidthMm?: number, paperHeightMm?: number) => {
      const vp = containerEl || viewportRef.current;
      const ct = contentRef.current;
      const availW = vp ? Math.max(280, vp.clientWidth - 64) : window.innerWidth - 120;
      const availH = vp ? Math.max(320, vp.clientHeight - 64) : window.innerHeight - 200;
      const customWidthPx = paperWidthMm ? (paperWidthMm / 25.4) * 96 : naturalWidth;
      const targetPaper = ct?.firstElementChild as HTMLElement | null;
      const measuredH =
        isThermal && targetPaper && targetPaper.scrollHeight > 80
          ? targetPaper.scrollHeight
          : naturalHeight;
      const customHeightPx = paperHeightMm ? (paperHeightMm / 25.4) * 96 : measuredH;
      const scaleW = (availW / Math.max(1, customWidthPx)) * 100;
      const scaleH = (availH / Math.max(1, customHeightPx)) * 100;
      setZoom(clampZoom(Math.min(scaleW, scaleH)));
    },
    [naturalWidth, naturalHeight, isThermal]
  );

  const fitToWidth = useCallback(
    (containerEl?: HTMLElement | null, paperWidthMm?: number) => {
      setFitMode('fit-width');
      computeFitToWidth(containerEl, paperWidthMm);
    },
    [computeFitToWidth]
  );

  const fitToPage = useCallback(
    (containerEl?: HTMLElement | null, paperWidthMm?: number, paperHeightMm?: number) => {
      setFitMode('fit-page');
      computeFitToPage(containerEl, paperWidthMm, paperHeightMm);
    },
    [computeFitToPage]
  );

  const selectPreset = useCallback(
    (val: number | string) => {
      if (val === 'fit-width') {
        fitToWidth();
      } else if (val === 'fit-page') {
        fitToPage();
      } else {
        const num = Number(val);
        if (!Number.isNaN(num)) {
          setPresetZoom(num);
        }
      }
    },
    [fitToWidth, fitToPage, setPresetZoom]
  );

  const goToPage = useCallback(
    (pageNumber: number) => {
      const target = Math.max(1, Math.min(totalPages, pageNumber));
      setCurrentPage(target);
      const vp = viewportRef.current;
      if (vp) {
        const scaledPageHeight = naturalHeight * (zoom / 100);
        vp.scrollTo({
          top: Math.max(0, (target - 1) * scaledPageHeight),
          behavior: 'smooth',
        });
      }
    },
    [totalPages, naturalHeight, zoom]
  );

  const goToPrevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const goToNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen((prev) => !prev);
  }, []);

  // Sync currentPage when user scrolls the preview viewport manually
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || isThermal) return;
    const onScroll = () => {
      const scaledPageHeight = Math.max(200, naturalHeight * (zoom / 100));
      const pageIdx = Math.floor((vp.scrollTop + scaledPageHeight * 0.35) / scaledPageHeight) + 1;
      setCurrentPage((prev) => {
        const clamped = Math.max(1, Math.min(totalPages, pageIdx));
        return prev !== clamped ? clamped : prev;
      });
    };
    vp.addEventListener('scroll', onScroll, { passive: true });
    return () => vp.removeEventListener('scroll', onScroll);
  }, [naturalHeight, zoom, totalPages, isThermal]);

  useEffect(() => {
    if (fitMode === 'manual') return;
    const onResize = () => {
      if (fitMode === 'fit-width') computeFitToWidth();
      if (fitMode === 'fit-page') computeFitToPage();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitMode, computeFitToWidth, computeFitToPage]);

  const handleWheelZoom = useCallback((e: React.WheelEvent | WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    setFitMode('manual');
    const delta = e.deltaY < 0 ? 1 : -1;
    setZoom((prev) => {
      if (delta > 0) {
        const nextPreset = ZOOM_PRESETS.find((p) => p > prev);
        return nextPreset ? nextPreset : clampZoom(prev + 15);
      } else {
        const prevPresets = ZOOM_PRESETS.filter((p) => p < prev);
        return prevPresets.length > 0 ? prevPresets[prevPresets.length - 1] : clampZoom(prev - 15);
      }
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onNativeWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) {
        handleWheelZoom(ev);
      }
    };
    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', onNativeWheel);
  }, [handleWheelZoom]);

  return {
    zoom,
    fitMode,
    currentPage,
    totalPages,
    isFullScreen,
    zoomIn,
    zoomOut,
    setPresetZoom,
    selectPreset,
    fitToWidth,
    fitToPage,
    goToPrevPage,
    goToNextPage,
    goToPage,
    toggleFullScreen,
    setIsFullScreen,
    recalculatePages,
    handleWheelZoom,
    viewportRef,
    contentRef,
  };
}

export interface PreviewZoomToolbarProps {
  zoomState?: PreviewZoomState;
  zoom?: number;
  fitMode?: ZoomFitMode;
  currentPage?: number;
  totalPages?: number;
  isFullScreen?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onSelectZoom?: (val: number | string) => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onToggleFullScreen?: () => void;
  showPageNav?: boolean;
  showFullScreenButton?: boolean;
  theme?: 'dark' | 'light';
  dark?: boolean;
  compact?: boolean;
  className?: string;
}

export const PreviewZoomToolbar: React.FC<PreviewZoomToolbarProps> = ({
  zoomState,
  zoom: propZoom,
  fitMode: propFitMode,
  currentPage: propCurrentPage,
  totalPages: propTotalPages,
  isFullScreen: propIsFullScreen,
  onZoomIn,
  onZoomOut,
  onSelectZoom,
  onFitWidth,
  onFitPage,
  onPrevPage,
  onNextPage,
  onToggleFullScreen,
  showPageNav = true,
  showFullScreenButton = true,
  theme,
  dark,
  compact = false,
  className = '',
}) => {
  const zoom = zoomState ? zoomState.zoom : propZoom ?? 100;
  const fitMode = zoomState ? zoomState.fitMode : propFitMode ?? 'manual';
  const currentPage = zoomState ? zoomState.currentPage : propCurrentPage ?? 1;
  const totalPages = zoomState ? zoomState.totalPages : propTotalPages ?? 1;
  const isFullScreen = zoomState ? zoomState.isFullScreen : propIsFullScreen ?? false;

  const zoomIn = zoomState ? zoomState.zoomIn : onZoomIn || (() => {});
  const zoomOut = zoomState ? zoomState.zoomOut : onZoomOut || (() => {});
  const fitToWidth = zoomState ? () => zoomState.fitToWidth() : onFitWidth || (() => {});
  const fitToPage = zoomState ? () => zoomState.fitToPage() : onFitPage || (() => {});
  const goToPrevPage = zoomState ? zoomState.goToPrevPage : onPrevPage;
  const goToNextPage = zoomState ? zoomState.goToNextPage : onNextPage;
  const toggleFullScreen = zoomState ? zoomState.toggleFullScreen : onToggleFullScreen;

  const handleSelect = (val: string) => {
    if (zoomState) {
      zoomState.selectPreset(val);
    } else if (onSelectZoom) {
      if (val === 'fit-width') {
        fitToWidth();
      } else if (val === 'fit-page') {
        fitToPage();
      } else {
        const num = Number(val);
        onSelectZoom(Number.isNaN(num) ? val : num);
      }
    }
  };

  const isDark = dark !== undefined ? dark : theme ? theme === 'dark' : true;

  const selectValue =
    fitMode === 'fit-width'
      ? 'fit-width'
      : fitMode === 'fit-page'
      ? 'fit-page'
      : ZOOM_PRESETS.includes(zoom as ZoomPreset)
      ? String(zoom)
      : 'custom';

  const btnBase = isDark
    ? 'hover:bg-slate-800 text-slate-200 border border-slate-700'
    : 'hover:bg-white text-slate-700 border border-slate-300 bg-white/80';

  return (
    <div
      className={`print:hidden no-print inline-flex flex-wrap items-center gap-1 rounded-lg ${
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
      } ${
        isDark
          ? 'bg-slate-900/90 border border-slate-700 text-slate-200'
          : 'bg-slate-100 border border-slate-300 text-slate-800'
      } ${className}`}
      title="Desktop Print Preview Controls (Ctrl + Mouse Wheel supported). Does not affect printed page size."
    >
      {/* Zoom Out (-) */}
      <button
        type="button"
        onClick={zoomOut}
        disabled={zoom <= 50 && fitMode === 'manual'}
        title="Zoom Out (-)"
        className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-40 ${btnBase}`}
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>

      {/* Percentage Selector (50%, 75%, 100%, 125%, 150%, 200%) */}
      <select
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
        aria-label="Zoom Percentage"
        className={`rounded px-1.5 py-0.5 text-xs font-mono font-bold cursor-pointer focus:outline-none ${
          isDark
            ? 'bg-slate-800 border border-slate-700 text-white'
            : 'bg-white border border-slate-300 text-slate-900'
        }`}
      >
        {ZOOM_PRESETS.map((p) => (
          <option key={p} value={String(p)}>
            {p}%
          </option>
        ))}
        {selectValue === 'custom' && <option value="custom">{zoom}%</option>}
        <option value="fit-width">Fit to Width ({zoom}%)</option>
        <option value="fit-page">Fit to Page ({zoom}%)</option>
      </select>

      {/* Zoom In (+) */}
      <button
        type="button"
        onClick={zoomIn}
        disabled={zoom >= 200 && fitMode === 'manual'}
        title="Zoom In (+)"
        className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-40 ${btnBase}`}
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>

      {/* Fit to Width */}
      <button
        type="button"
        onClick={fitToWidth}
        title="Fit Preview to Container Width"
        className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
          fitMode === 'fit-width'
            ? 'bg-emerald-600 text-white border border-emerald-500'
            : isDark
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'
        }`}
      >
        <Maximize2 className="w-3 h-3" />
        <span>Fit to Width</span>
      </button>

      {/* Fit to Page */}
      <button
        type="button"
        onClick={fitToPage}
        title="Fit Full Page in Preview"
        className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
          fitMode === 'fit-page'
            ? 'bg-emerald-600 text-white border border-emerald-500'
            : isDark
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'
        }`}
      >
        <Minimize2 className="w-3 h-3" />
        <span>Fit to Page</span>
      </button>

      {/* Previous & Next Page Navigation + Page X of Y */}
      {showPageNav && (goToPrevPage || goToNextPage) && (
        <div
          className={`inline-flex items-center gap-1 pl-1.5 ml-0.5 border-l ${
            isDark ? 'border-slate-700' : 'border-slate-300'
          }`}
        >
          <button
            type="button"
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            title="Previous Page"
            className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-40 ${btnBase}`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span
            className={`px-1.5 font-mono font-bold text-[11px] whitespace-nowrap ${
              isDark ? 'text-slate-200' : 'text-slate-700'
            }`}
          >
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            title="Next Page"
            className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-40 ${btnBase}`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Full-Screen Preview Toggle */}
      {showFullScreenButton && toggleFullScreen && (
        <button
          type="button"
          onClick={toggleFullScreen}
          title={isFullScreen ? 'Exit Full-Screen Preview' : 'Full-Screen Preview'}
          className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
            isFullScreen
              ? 'bg-sky-600 text-white border border-sky-500'
              : isDark
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'
          }`}
        >
          {isFullScreen ? <Shrink className="w-3 h-3" /> : <Expand className="w-3 h-3" />}
          <span>{isFullScreen ? 'Exit Full Screen' : 'Full Screen'}</span>
        </button>
      )}
    </div>
  );
};

export interface ReportZoomWrapperProps {
  children: React.ReactNode;
  title?: string;
  label?: string;
  paperWidthMm?: number;
  paperHeightMm?: number;
  theme?: 'dark' | 'light';
  className?: string;
  initialZoom?: number;
  showHeaderBar?: boolean;
  desktopPaperMode?: boolean;
}

/**
 * Self-contained Desktop-Style Print Preview & Zoom wrapper for inline Report screens.
 * Supports MS Access-style Full-Screen A4 Paper Preview mode as well as inline zoom controls.
 */
export const ReportZoomWrapper: React.FC<ReportZoomWrapperProps> = ({
  children,
  title,
  label,
  paperWidthMm = 210,
  paperHeightMm = 297,
  theme = 'light',
  className = '',
  initialZoom = 100,
  showHeaderBar = true,
  desktopPaperMode = false,
}) => {
  const naturalWidthPx = Math.round((paperWidthMm / 25.4) * 96);
  const naturalHeightPx = Math.round((paperHeightMm / 25.4) * 96);
  const zoomState = usePreviewZoom({ initialZoom, naturalWidthPx, naturalHeightPx });
  const [paperPreviewActive, setPaperPreviewActive] = useState<boolean>(desktopPaperMode);

  const handlePrintReport = () => {
    const targetEl = zoomState.contentRef.current;
    printReportDocument(targetEl, label || title || 'Abrar Medical Store Report', {
      paperSize: 'a4',
      profileId: 'a4-report',
      orientation: 'portrait',
      showPageNumbers: true,
    });
  };

  const isDesktopOverlay = zoomState.isFullScreen || paperPreviewActive;

  return (
    <div
      className={
        zoomState.isFullScreen
          ? 'fixed inset-0 z-50 bg-[#525659] flex flex-col overflow-hidden print:static print:bg-white'
          : `space-y-2 ${className}`
      }
    >
      {showHeaderBar && (
        <div
          className={`print:hidden no-print flex flex-wrap items-center justify-between gap-2 ${
            zoomState.isFullScreen
              ? 'bg-slate-900 text-white border-b border-slate-700 px-4 py-2.5 shrink-0'
              : 'bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-2xs'
          }`}
        >
          <div className="text-[11px] font-semibold flex items-center gap-2">
            <span className={zoomState.isFullScreen ? 'text-white font-bold text-xs' : 'text-slate-700'}>
              {label || title || 'A4 Report Print Preview (210 × 297 mm)'}
            </span>
            <span
              className={`text-[10px] font-normal hidden sm:inline ${
                zoomState.isFullScreen ? 'text-slate-400' : 'text-slate-400'
              }`}
            >
              (A4 210 × 297 mm · Hold Ctrl + Mouse Wheel to zoom)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaperPreviewActive((v) => !v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                isDesktopOverlay
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
              }`}
              title="Toggle Desktop A4 White-Paper-on-Grey Print Preview Workspace"
            >
              {isDesktopOverlay ? 'A4 Paper View: ON' : 'A4 Paper Preview'}
            </button>

            <PreviewZoomToolbar
              zoomState={zoomState}
              theme={zoomState.isFullScreen ? 'dark' : theme}
              showPageNav
              showFullScreenButton
            />

            {zoomState.isFullScreen && (
              <>
                <button
                  type="button"
                  onClick={handlePrintReport}
                  className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print A4</span>
                </button>
                <button
                  type="button"
                  onClick={() => zoomState.setIsFullScreen(false)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close Preview</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div
        ref={zoomState.viewportRef}
        onWheel={zoomState.handleWheelZoom}
        className={
          isDesktopOverlay
            ? 'flex-1 overflow-auto p-6 bg-[#525659] flex justify-center items-start rounded-xl print:p-0 print:bg-white print:overflow-visible'
            : 'w-full overflow-x-auto print:overflow-visible'
        }
      >
        <div
          ref={zoomState.contentRef}
          className={`ams-screen-zoom-wrapper transition-all duration-75 ${
            isDesktopOverlay
              ? 'bg-white shadow-2xl border border-slate-300 w-[210mm] min-h-[297mm] p-6 mx-auto text-slate-900 print:shadow-none print:border-0 print:p-0 print:w-full'
              : 'origin-top-left'
          }`}
          style={{ zoom: `${zoomState.zoom}%` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
