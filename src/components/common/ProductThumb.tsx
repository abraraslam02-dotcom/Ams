import React, { useEffect, useState } from 'react';
import { Package, X, ZoomIn } from 'lucide-react';

interface ProductThumbProps {
  src?: string | null;
  fullSrc?: string | null;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  enableZoom?: boolean;
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-6 h-6 rounded',
  sm: 'w-8 h-8 rounded-md',
  md: 'w-12 h-12 rounded-lg',
  lg: 'w-20 h-20 rounded-xl',
};

const ICON_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
};

export const ProductThumb: React.FC<ProductThumbProps> = ({
  src,
  fullSrc,
  alt,
  size = 'sm',
  className = '',
  enableZoom = false,
}) => {
  const [imgError, setImgError] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  useEffect(() => {
    if (!zoomOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomOpen]);

  const effectiveSrc = !imgError && src ? src : '';
  const zoomSrc = fullSrc || effectiveSrc;

  return (
    <>
      <div
        onClick={(e) => {
          if (enableZoom && zoomSrc) {
            e.stopPropagation();
            setZoomOpen(true);
          }
        }}
        title={enableZoom && zoomSrc ? `${alt} (Click to preview)` : alt}
        className={`relative shrink-0 overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center ${SIZE_CLASSES[size]} ${
          enableZoom && zoomSrc ? 'cursor-zoom-in group' : ''
        } ${className}`}
      >
        {effectiveSrc ? (
          <>
            <img
              src={effectiveSrc}
              alt={alt}
              loading="lazy"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
            {enableZoom && (
              <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/25 transition-colors flex items-center justify-center">
                <ZoomIn className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
              </span>
            )}
          </>
        ) : (
          <Package className={`${ICON_CLASSES[size]} text-slate-400`} />
        )}
      </div>

      {zoomOpen && zoomSrc && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setZoomOpen(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <span className="text-xs font-bold text-slate-900 truncate pr-4">{alt}</span>
              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 cursor-pointer"
                aria-label="Close picture preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 flex items-center justify-center max-h-[70vh]">
              <img
                src={zoomSrc}
                alt={alt}
                className="max-w-full max-h-[62vh] object-contain rounded-lg shadow-sm bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
