import { memo, useMemo } from "react";

export interface SelectionDecorationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const LINE_MERGE_TOLERANCE = 3;
const HORIZONTAL_PADDING = 2;
const VERTICAL_PADDING = 1;
const MAX_LINE_BRIDGE_GAP = 18;
const MIN_LINE_BRIDGE_OVERLAP = 1;
const COORDINATE_PRECISION = 100;

function mergeLineRects(rects: SelectionDecorationRect[]) {
  const sortedRects = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: SelectionDecorationRect[] = [];

  for (const rect of sortedRects) {
    const last = merged[merged.length - 1];
    if (!last || Math.abs(last.top - rect.top) > LINE_MERGE_TOLERANCE) {
      merged.push(rect);
      continue;
    }

    const left = Math.min(last.left, rect.left);
    const top = Math.min(last.top, rect.top);
    const right = Math.max(last.left + last.width, rect.left + rect.width);
    const bottom = Math.max(last.top + last.height, rect.top + rect.height);
    merged[merged.length - 1] = {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  return merged;
}

function roundCoordinate(value: number) {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

function formatCoordinate(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");
}

function horizontalOverlap(a: SelectionDecorationRect, b: SelectionDecorationRect) {
  return Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
}

function normalizeLineRectsForOutline(rects: SelectionDecorationRect[]) {
  const normalizedRects = rects.map((rect) => ({
    left: roundCoordinate(rect.left),
    top: roundCoordinate(rect.top),
    width: roundCoordinate(rect.width),
    height: roundCoordinate(rect.height)
  }));

  for (let index = 0; index < normalizedRects.length - 1; index += 1) {
    const current = normalizedRects[index];
    const next = normalizedRects[index + 1];
    const currentBottom = current.top + current.height;
    const gap = next.top - currentBottom;

    if (
      gap <= 0 ||
      gap > MAX_LINE_BRIDGE_GAP ||
      horizontalOverlap(current, next) <= MIN_LINE_BRIDGE_OVERLAP
    ) {
      continue;
    }

    const seam = roundCoordinate(currentBottom + gap / 2);
    current.height = roundCoordinate(seam - current.top);
    next.height = roundCoordinate(next.top + next.height - seam);
    next.top = seam;
  }

  return normalizedRects.filter((rect) => rect.width > 0 && rect.height > 0);
}

function coordinateKey(x: number, y: number) {
  return `${x}:${y}`;
}

interface OutlinePoint {
  x: number;
  y: number;
}

interface OutlineEdge {
  id: string;
  start: OutlinePoint;
  end: OutlinePoint;
}

function simplifyLoop(points: OutlinePoint[]) {
  if (points.length <= 3) return points;

  const loop = points.slice(0, -1);
  const simplified: OutlinePoint[] = [];

  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const sameVertical = previous.x === current.x && current.x === next.x;
    const sameHorizontal = previous.y === current.y && current.y === next.y;
    if (!sameVertical && !sameHorizontal) {
      simplified.push(current);
    }
  }

  if (simplified.length === 0) return points;
  return [...simplified, simplified[0]];
}

export function buildSelectionOutlinePath(rects: SelectionDecorationRect[]) {
  const outlineRects = normalizeLineRectsForOutline(rects);
  if (outlineRects.length === 0) return "";

  const xs = Array.from(
    new Set(outlineRects.flatMap((rect) => [rect.left, rect.left + rect.width]).map(roundCoordinate))
  ).sort((a, b) => a - b);
  const ys = Array.from(
    new Set(outlineRects.flatMap((rect) => [rect.top, rect.top + rect.height]).map(roundCoordinate))
  ).sort((a, b) => a - b);

  const columnCount = Math.max(0, xs.length - 1);
  const rowCount = Math.max(0, ys.length - 1);
  if (columnCount === 0 || rowCount === 0) return "";

  const occupied = Array.from({ length: rowCount }, () => Array(columnCount).fill(false));
  const xIndexByCoordinate = new Map(xs.map((value, index) => [value, index] as const));
  const yIndexByCoordinate = new Map(ys.map((value, index) => [value, index] as const));

  for (const rect of outlineRects) {
    const leftIndex = xIndexByCoordinate.get(rect.left);
    const rightIndex = xIndexByCoordinate.get(roundCoordinate(rect.left + rect.width));
    const topIndex = yIndexByCoordinate.get(rect.top);
    const bottomIndex = yIndexByCoordinate.get(roundCoordinate(rect.top + rect.height));
    if (
      leftIndex == null ||
      rightIndex == null ||
      topIndex == null ||
      bottomIndex == null ||
      rightIndex <= leftIndex ||
      bottomIndex <= topIndex
    ) {
      continue;
    }

    for (let row = topIndex; row < bottomIndex; row += 1) {
      const rowCells = occupied[row];
      for (let column = leftIndex; column < rightIndex; column += 1) {
        rowCells[column] = true;
      }
    }
  }

  const edges: OutlineEdge[] = [];
  const addEdge = (start: OutlinePoint, end: OutlinePoint) => {
    const id = `${edges.length}`;
    edges.push({ id, start, end });
  };
  const isOccupied = (row: number, column: number) =>
    row >= 0 && row < rowCount && column >= 0 && column < columnCount && occupied[row][column];

  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      if (!occupied[row][column]) continue;

      const left = xs[column];
      const right = xs[column + 1];
      const top = ys[row];
      const bottom = ys[row + 1];

      if (!isOccupied(row - 1, column)) {
        addEdge({ x: left, y: top }, { x: right, y: top });
      }
      if (!isOccupied(row, column + 1)) {
        addEdge({ x: right, y: top }, { x: right, y: bottom });
      }
      if (!isOccupied(row + 1, column)) {
        addEdge({ x: right, y: bottom }, { x: left, y: bottom });
      }
      if (!isOccupied(row, column - 1)) {
        addEdge({ x: left, y: bottom }, { x: left, y: top });
      }
    }
  }

  const edgesByStart = new Map<string, OutlineEdge[]>();
  for (const edge of edges) {
    const key = coordinateKey(edge.start.x, edge.start.y);
    edgesByStart.set(key, [...(edgesByStart.get(key) ?? []), edge]);
  }

  const usedEdgeIds = new Set<string>();
  const loops: OutlinePoint[][] = [];

  for (const firstEdge of edges) {
    if (usedEdgeIds.has(firstEdge.id)) continue;

    const firstKey = coordinateKey(firstEdge.start.x, firstEdge.start.y);
    const points: OutlinePoint[] = [firstEdge.start];
    let currentEdge: OutlineEdge | undefined = firstEdge;

    while (currentEdge && !usedEdgeIds.has(currentEdge.id)) {
      usedEdgeIds.add(currentEdge.id);
      points.push(currentEdge.end);

      const endKey = coordinateKey(currentEdge.end.x, currentEdge.end.y);
      if (endKey === firstKey) break;

      currentEdge = (edgesByStart.get(endKey) ?? []).find((edge) => !usedEdgeIds.has(edge.id));
    }

    if (points.length > 3 && coordinateKey(points[0].x, points[0].y) === coordinateKey(
      points[points.length - 1].x,
      points[points.length - 1].y
    )) {
      loops.push(simplifyLoop(points));
    }
  }

  return loops
    .map((points) => {
      const [start, ...rest] = points;
      return [
        `M ${formatCoordinate(start.x)} ${formatCoordinate(start.y)}`,
        ...rest.slice(0, -1).map((point) => `L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`),
        "Z"
      ].join(" ");
    })
    .join(" ");
}

export function buildSelectionDecorationRects(
  root: HTMLElement | null,
  range: Range | null
): SelectionDecorationRect[] {
  if (!root || !range || range.collapsed) return [];

  const rootBounds = root.getBoundingClientRect();
  const rootWidth = rootBounds.width;
  const rootHeight = rootBounds.height;

  const rects = Array.from(range.getClientRects())
    .map((rangeBounds) => {
      const clippedLeft = Math.max(rangeBounds.left, rootBounds.left);
      const clippedTop = Math.max(rangeBounds.top, rootBounds.top);
      const clippedRight = Math.min(rangeBounds.right, rootBounds.right);
      const clippedBottom = Math.min(rangeBounds.bottom, rootBounds.bottom);
      if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

      const left = Math.max(
        0,
        clippedLeft - rootBounds.left + root.scrollLeft - HORIZONTAL_PADDING
      );
      const top = Math.max(0, clippedTop - rootBounds.top + root.scrollTop - VERTICAL_PADDING);
      const width = Math.min(
        rootWidth - left,
        clippedRight - clippedLeft + HORIZONTAL_PADDING * 2
      );
      const height = Math.min(
        rootHeight - top,
        clippedBottom - clippedTop + VERTICAL_PADDING * 2
      );
      if (width <= 0 || height <= 0) return null;
      return { left, top, width, height };
    })
    .filter((rect): rect is SelectionDecorationRect => rect != null);

  return mergeLineRects(rects);
}

export const SelectionDecorationOverlay = memo(function SelectionDecorationOverlay({
  rects
}: {
  rects: SelectionDecorationRect[];
}) {
  const outlinePath = useMemo(() => buildSelectionOutlinePath(rects), [rects]);
  if (!outlinePath) return null;

  return (
    <div className="workbench-editor-selection-overlay" aria-hidden="true">
      <svg className="workbench-editor-selection-svg">
        <path className="workbench-editor-selection-shape is-halo" d={outlinePath} />
        <path className="workbench-editor-selection-shape is-border" d={outlinePath} />
      </svg>
    </div>
  );
});
