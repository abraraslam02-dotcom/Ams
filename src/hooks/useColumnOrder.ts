import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseColumnOrderOptions {
  storageKey: string;
  defaultOrder: readonly string[];
  userKey?: string | number | null;
  legacyExpand?: Record<string, string[]>;
}

export function reconcileColumnOrder(
  saved: unknown,
  defaultOrder: readonly string[],
  legacyExpand?: Record<string, string[]>
): string[] {
  const allowedSet = new Set(defaultOrder);
  const seen = new Set<string>();
  const validSaved: string[] = [];

  if (Array.isArray(saved)) {
    for (const raw of saved) {
      const key = typeof raw === 'string' ? raw : '';
      if (!key) continue;
      if (legacyExpand && legacyExpand[key]) {
        for (const expandedKey of legacyExpand[key]) {
          if (allowedSet.has(expandedKey) && !seen.has(expandedKey)) {
            seen.add(expandedKey);
            validSaved.push(expandedKey);
          }
        }
        continue;
      }
      if (allowedSet.has(key) && !seen.has(key)) {
        seen.add(key);
        validSaved.push(key);
      }
    }
  }

  for (const key of defaultOrder) {
    if (!seen.has(key)) {
      seen.add(key);
      validSaved.push(key);
    }
  }

  return validSaved.length > 0 ? validSaved : [...defaultOrder];
}

function readStoredOrder(
  fullKey: string,
  defaultOrder: readonly string[],
  legacyExpand?: Record<string, string[]>
): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [...defaultOrder];
    }
    const raw = window.localStorage.getItem(fullKey);
    if (!raw) return [...defaultOrder];
    const parsed = JSON.parse(raw);
    return reconcileColumnOrder(parsed, defaultOrder, legacyExpand);
  } catch {
    return [...defaultOrder];
  }
}

function writeStoredOrder(fullKey: string, order: string[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(fullKey, JSON.stringify(order));
    }
  } catch {
    // Ignore storage quota / private mode errors
  }
}

export function useColumnOrder({
  storageKey,
  defaultOrder,
  userKey,
  legacyExpand,
}: UseColumnOrderOptions) {
  const normalizedUserSuffix =
    userKey !== undefined && userKey !== null && String(userKey).trim() !== ''
      ? `::user:${String(userKey).trim()}`
      : '::user:guest';

  const fullStorageKey = `${storageKey}${normalizedUserSuffix}`;
  const defaultOrderSignature = defaultOrder.join('|');
  const defaultOrderRef = useRef<readonly string[]>(defaultOrder);
  defaultOrderRef.current = defaultOrder;
  const legacyExpandRef = useRef<Record<string, string[]> | undefined>(legacyExpand);
  legacyExpandRef.current = legacyExpand;

  const [state, setState] = useState<{ key: string; order: string[] }>(() => ({
    key: fullStorageKey,
    order: readStoredOrder(fullStorageKey, defaultOrder, legacyExpand),
  }));

  // Reload whenever user identity or module storage key changes
  useEffect(() => {
    setState({
      key: fullStorageKey,
      order: readStoredOrder(fullStorageKey, defaultOrderRef.current, legacyExpandRef.current),
    });
  }, [fullStorageKey, defaultOrderSignature]);

  const columnOrder = useMemo(
    () =>
      state.key === fullStorageKey
        ? state.order
        : readStoredOrder(fullStorageKey, defaultOrder, legacyExpand),
    [state, fullStorageKey, defaultOrder, legacyExpand]
  );

  const isCustomized = useMemo(
    () => columnOrder.some((colKey, idx) => colKey !== defaultOrder[idx]),
    [columnOrder, defaultOrder]
  );

  const commitOrder = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setState((prev) => {
        const base =
          prev.key === fullStorageKey
            ? prev.order
            : readStoredOrder(fullStorageKey, defaultOrderRef.current, legacyExpandRef.current);
        const next = reconcileColumnOrder(updater(base), defaultOrderRef.current, legacyExpandRef.current);
        writeStoredOrder(fullStorageKey, next);
        return { key: fullStorageKey, order: next };
      });
    },
    [fullStorageKey]
  );

  const moveColumnTo = useCallback(
    (fromKey: string, toKey: string) => {
      if (!fromKey || !toKey || fromKey === toKey) return;
      commitOrder((prev) => {
        const fromIdx = prev.indexOf(fromKey);
        const toIdx = prev.indexOf(toKey);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [commitOrder]
  );

  const canMoveLeft = useCallback(
    (selectedKeys: string[]): boolean => {
      if (selectedKeys.length === 0) return false;
      const selectedSet = new Set(selectedKeys);
      const indices = columnOrder
        .map((k, idx) => (selectedSet.has(k) ? idx : -1))
        .filter((idx) => idx >= 0);
      if (indices.length === 0) return false;
      return indices[0] > 0;
    },
    [columnOrder]
  );

  const canMoveRight = useCallback(
    (selectedKeys: string[]): boolean => {
      if (selectedKeys.length === 0) return false;
      const selectedSet = new Set(selectedKeys);
      const indices = columnOrder
        .map((k, idx) => (selectedSet.has(k) ? idx : -1))
        .filter((idx) => idx >= 0);
      if (indices.length === 0) return false;
      return indices[indices.length - 1] < columnOrder.length - 1;
    },
    [columnOrder]
  );

  const moveColumnsLeft = useCallback(
    (selectedKeys: string[]): boolean => {
      if (!canMoveLeft(selectedKeys)) return false;
      const selectedSet = new Set(selectedKeys);
      commitOrder((prev) => {
        const next = [...prev];
        // Move each selected item left from left-to-right if left neighbor isn't selected
        for (let i = 1; i < next.length; i++) {
          if (selectedSet.has(next[i]) && !selectedSet.has(next[i - 1])) {
            const tmp = next[i - 1];
            next[i - 1] = next[i];
            next[i] = tmp;
          }
        }
        return next;
      });
      return true;
    },
    [canMoveLeft, commitOrder]
  );

  const moveColumnsRight = useCallback(
    (selectedKeys: string[]): boolean => {
      if (!canMoveRight(selectedKeys)) return false;
      const selectedSet = new Set(selectedKeys);
      commitOrder((prev) => {
        const next = [...prev];
        // Move each selected item right from right-to-left if right neighbor isn't selected
        for (let i = next.length - 2; i >= 0; i--) {
          if (selectedSet.has(next[i]) && !selectedSet.has(next[i + 1])) {
            const tmp = next[i + 1];
            next[i + 1] = next[i];
            next[i] = tmp;
          }
        }
        return next;
      });
      return true;
    },
    [canMoveRight, commitOrder]
  );

  const resetColumnOrder = useCallback(() => {
    const defaults = [...defaultOrderRef.current];
    writeStoredOrder(fullStorageKey, defaults);
    setState({ key: fullStorageKey, order: defaults });
  }, [fullStorageKey]);

  // HTML5 Drag & Drop column reordering state & handlers
  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);
  const [dragDropSide, setDragDropSide] = useState<'left' | 'right' | null>(null);
  const draggedColRef = useRef<string | null>(null);

  const handleColDragStart = useCallback(
    (colKey: string, e: React.DragEvent, isResizing: boolean = false) => {
      const target = e.target as HTMLElement | null;
      if (isResizing || target?.closest('[data-col-resize-handle="true"]')) {
        e.preventDefault();
        return;
      }
      draggedColRef.current = colKey;
      setDraggedColKey(colKey);
      setDragOverColKey(null);
      setDragDropSide(null);
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', colKey);
      } catch {
        // Ignore browser dataTransfer restrictions
      }
    },
    []
  );

  const handleColDragOver = useCallback(
    (colKey: string, e: React.DragEvent) => {
      const activeFrom = draggedColRef.current;
      if (!activeFrom || activeFrom === colKey) {
        if (activeFrom === colKey) {
          setDragOverColKey(null);
          setDragDropSide(null);
        }
        return;
      }
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch {
        // ignore
      }
      const fromIdx = columnOrder.indexOf(activeFrom);
      const toIdx = columnOrder.indexOf(colKey);
      const side: 'left' | 'right' = fromIdx > toIdx ? 'left' : 'right';
      setDragOverColKey(colKey);
      setDragDropSide(side);
    },
    [columnOrder]
  );

  const handleColDrop = useCallback(
    (colKey: string, e: React.DragEvent, onAfterMove?: (movedKey: string) => void) => {
      e.preventDefault();
      let fromKey = draggedColRef.current;
      if (!fromKey) {
        try {
          fromKey = e.dataTransfer.getData('text/plain') || null;
        } catch {
          fromKey = null;
        }
      }
      if (fromKey && fromKey !== colKey) {
        moveColumnTo(fromKey, colKey);
        onAfterMove?.(fromKey);
      }
      draggedColRef.current = null;
      setDraggedColKey(null);
      setDragOverColKey(null);
      setDragDropSide(null);
    },
    [moveColumnTo]
  );

  const handleColDragEnd = useCallback(() => {
    draggedColRef.current = null;
    setDraggedColKey(null);
    setDragOverColKey(null);
    setDragDropSide(null);
  }, []);

  return {
    columnOrder,
    isCustomized,
    moveColumnTo,
    moveColumnsLeft,
    moveColumnsRight,
    canMoveLeft,
    canMoveRight,
    resetColumnOrder,
    draggedColKey,
    dragOverColKey,
    dragDropSide,
    handleColDragStart,
    handleColDragOver,
    handleColDrop,
    handleColDragEnd,
  };
}
