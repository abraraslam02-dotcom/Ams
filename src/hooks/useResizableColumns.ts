import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ResizableColumnsOptions {
  storageKey: string;
  defaultWidths: Record<string, number>;
  minWidth?: number;
  columnMinWidths?: Record<string, number>;
}

/**
 * Smooth drag-and-drop column resizing hook for Sales & Purchase Datasheets.
 * - Supports increasing or decreasing any column width smoothly via border drag.
 * - Double-clicking a resize handle restores that column's default width.
 * - Persists user-adjusted widths in localStorage without touching the database.
 */
export function useResizableColumns({
  storageKey,
  defaultWidths,
  minWidth = 40,
  columnMinWidths = {},
}: ResizableColumnsOptions) {
  const defaultsRef = useRef(defaultWidths);
  defaultsRef.current = defaultWidths;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const merged: Record<string, number> = { ...defaultWidths };
          for (const key of Object.keys(defaultWidths)) {
            const val = Number(parsed[key]);
            const colMin = columnMinWidths[key] ?? minWidth;
            if (Number.isFinite(val) && val >= colMin && val <= 1200) {
              merged[key] = Math.round(val);
            }
          }
          return merged;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return { ...defaultWidths };
  });

  const latestWidthsRef = useRef(colWidths);
  latestWidthsRef.current = colWidths;

  const [resizingCol, setResizingCol] = useState<string | null>(null);

  const persistWidths = useCallback(
    (next: Record<string, number>) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    },
    [storageKey]
  );

  const handleResizeStart = useCallback(
    (colKey: string, e: React.MouseEvent | React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = latestWidthsRef.current[colKey] ?? defaultsRef.current[colKey] ?? 100;
      const colMin = columnMinWidths[colKey] ?? minWidth;

      setResizingCol(colKey);
      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      let rafId: number | null = null;
      let latestClientX = startX;

      const applyResize = () => {
        rafId = null;
        const diff = latestClientX - startX;
        const nextWidth = Math.max(colMin, Math.round(startWidth + diff));
        setColWidths((prev) => {
          if (prev[colKey] === nextWidth) return prev;
          const updated = { ...prev, [colKey]: nextWidth };
          latestWidthsRef.current = updated;
          return updated;
        });
      };

      const onMove = (moveEvent: MouseEvent | PointerEvent) => {
        latestClientX = moveEvent.clientX;
        if (rafId === null) {
          rafId = window.requestAnimationFrame(applyResize);
        }
      };

      const onUp = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
          applyResize();
        }
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
        setResizingCol(null);
        persistWidths(latestWidthsRef.current);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [columnMinWidths, minWidth, persistWidths]
  );

  const resetColumnWidth = useCallback(
    (colKey: string, e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const def = defaultsRef.current[colKey];
      if (!def) return;
      setColWidths((prev) => {
        const updated = { ...prev, [colKey]: def };
        latestWidthsRef.current = updated;
        persistWidths(updated);
        return updated;
      });
    },
    [persistWidths]
  );

  // Cleanup safety if component unmounts mid-drag
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const totalWidth = useMemo(
    () => Object.values(colWidths).reduce((sum, w) => sum + (Number(w) || 0), 0),
    [colWidths]
  );

  return {
    colWidths,
    totalWidth,
    resizingCol,
    handleResizeStart,
    resetColumnWidth,
  };
}
