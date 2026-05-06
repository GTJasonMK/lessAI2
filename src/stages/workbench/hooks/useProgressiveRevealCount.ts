import { useEffect, useState } from "react";

const PROGRESSIVE_REVEAL_INTERVAL_MS = 40;

interface UseProgressiveRevealCountOptions {
  total: number;
  key: string | number;
  enabled: boolean;
  initial: number;
  step: number;
  focusIndex?: number | null;
}

function clampPositive(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function useProgressiveRevealCount(options: UseProgressiveRevealCountOptions) {
  const { total, key, enabled, initial, step, focusIndex = null } = options;
  const safeTotal = Math.max(0, total);
  const safeInitial = clampPositive(initial);
  const safeStep = clampPositive(step);
  const [count, setCount] = useState(safeTotal);

  useEffect(() => {
    if (!enabled) {
      setCount(safeTotal);
      return;
    }

    const base = Math.min(safeTotal, safeInitial);
    setCount(base);
    if (base >= safeTotal) return;

    let timerId: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setCount((current) => {
        const next = Math.min(safeTotal, current + safeStep);
        if (next < safeTotal) {
          timerId = window.setTimeout(tick, PROGRESSIVE_REVEAL_INTERVAL_MS);
        }
        return next;
      });
    };

    timerId = window.setTimeout(tick, PROGRESSIVE_REVEAL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
    };
  }, [enabled, key, safeInitial, safeStep, safeTotal]);

  useEffect(() => {
    if (!enabled || focusIndex == null || focusIndex < 0) {
      return;
    }
    const target = Math.min(safeTotal, focusIndex + safeStep);
    setCount((current) => (target > current ? target : current));
  }, [enabled, focusIndex, safeStep, safeTotal]);

  return count;
}
