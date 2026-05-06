import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  buildSelectionDecorationRects,
  type SelectionDecorationRect
} from "./SelectionDecorationOverlay";

export interface SelectionDecorationContext<T extends HTMLElement> {
  root: T | null;
  selection: Selection | null;
  range: Range | null;
}

export function resolveContainedSelectionDecorationRange<T extends HTMLElement>({
  root,
  range
}: SelectionDecorationContext<T>) {
  if (
    !root ||
    !range ||
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }
  return range;
}

export function useSelectionDecorationRects<T extends HTMLElement>({
  rootRef,
  resolveRange = resolveContainedSelectionDecorationRange
}: {
  rootRef: RefObject<T | null>;
  resolveRange?: (context: SelectionDecorationContext<T>) => Range | null;
}) {
  const [selectionDecorationRects, setSelectionDecorationRects] = useState<
    SelectionDecorationRect[]
  >([]);
  const frameRef = useRef<number | null>(null);
  const latestRectsRef = useRef<SelectionDecorationRect[]>([]);

  const updateSelectionDecorationRects = useCallback((nextRects: SelectionDecorationRect[]) => {
    const previousRects = latestRectsRef.current;
    const unchanged =
      previousRects.length === nextRects.length &&
      previousRects.every((previous, index) => {
        const next = nextRects[index];
        return (
          next != null &&
          previous.left === next.left &&
          previous.top === next.top &&
          previous.width === next.width &&
          previous.height === next.height
        );
      });
    if (unchanged) return;
    latestRectsRef.current = nextRects;
    setSelectionDecorationRects(nextRects);
  }, []);

  const cancelScheduledSelectionStateSync = useCallback(() => {
    if (frameRef.current == null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const clearSelectionDecoration = useCallback(() => {
    cancelScheduledSelectionStateSync();
    updateSelectionDecorationRects([]);
  }, [cancelScheduledSelectionStateSync, updateSelectionDecorationRects]);

  const syncSelectionState = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const activeRange = resolveRange({ root, selection: selection ?? null, range });
    updateSelectionDecorationRects(
      activeRange ? buildSelectionDecorationRects(root, activeRange) : []
    );
  }, [resolveRange, rootRef, updateSelectionDecorationRects]);

  const scheduleSelectionStateSync = useCallback(() => {
    cancelScheduledSelectionStateSync();
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      syncSelectionState();
    });
  }, [cancelScheduledSelectionStateSync, syncSelectionState]);

  useEffect(() => {
    document.addEventListener("selectionchange", scheduleSelectionStateSync);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelectionStateSync);
      cancelScheduledSelectionStateSync();
    };
  }, [cancelScheduledSelectionStateSync, scheduleSelectionStateSync]);

  return {
    selectionDecorationRects,
    clearSelectionDecoration,
    scheduleSelectionStateSync,
    syncSelectionState
  };
}
