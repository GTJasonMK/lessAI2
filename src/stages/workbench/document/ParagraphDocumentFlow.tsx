import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  logScrollRestore,
  snapshotScrollNode
} from "../../../app/hooks/documentScrollRestoreDebug";
import {
  rewriteUnitHasEditableSlot,
  summarizeRewriteUnitSuggestions
} from "../../../lib/helpers";
import {
  buildDetectionScoreByRewriteUnit,
  detectionRiskLabel,
  detectionRiskLevel,
  formatDetectionScore
} from "../../../lib/detection";
import { isRewriteUnitSelected } from "../../../lib/rewriteUnitSelection";
import type { DocumentFlowBodyProps } from "./documentFlowShared";
import {
  shouldScrollToActiveRewriteUnit,
  type ActiveRewriteUnitTarget
} from "./documentFlowNavigation";
import {
  renderRewriteUnitContent,
  rewriteUnitTitle
} from "./documentFlowShared";
import { useProgressiveRevealCount } from "../hooks/useProgressiveRevealCount";

interface ParagraphDocumentFlowProps extends DocumentFlowBodyProps {
  sessionId: string;
}

function buildRewriteUnitClassNames(
  hasActiveRewriteUnit: boolean,
  hasSelectedRewriteUnit: boolean,
  hasEditableSlot: boolean,
  isRunning: boolean,
  isFailed: boolean,
  hasAppliedSuggestion: boolean,
  hasProposedSuggestion: boolean,
  documentView: DocumentFlowBodyProps["documentView"],
  detectionScore: number | null
) {
  const detectionClassName =
    detectionScore == null ? "" : `is-detect-${detectionRiskLevel(detectionScore)}`;
  return [
    "doc-unit",
    "doc-paragraph-unit",
    hasActiveRewriteUnit ? "is-active" : "",
    hasSelectedRewriteUnit ? "is-selected" : "",
    !hasEditableSlot ? "is-protected" : "",
    isRunning ? "is-running" : "",
    isFailed ? "is-failed" : "",
    documentView === "markup" && hasAppliedSuggestion ? "is-applied" : "",
    documentView === "markup" && !hasAppliedSuggestion && hasProposedSuggestion
      ? "is-proposed"
      : "",
    detectionClassName
  ]
    .filter(Boolean)
    .join(" ");
}

function rewriteUnitTitleWithDetection(
  baseTitle: string,
  detectionScore: number | null
) {
  if (detectionScore == null) return baseTitle;
  return `${baseTitle}；AI 检测：${formatDetectionScore(detectionScore)}（${detectionRiskLabel(
    detectionScore
  )}）`;
}

function snapshotRewriteUnitNode(node: HTMLSpanElement | null) {
  if (!node) {
    return { present: false } as const;
  }

  const rect = node.getBoundingClientRect();
  return {
    present: true,
    connected: node.isConnected,
    top: rect.top,
    bottom: rect.bottom,
    height: rect.height
  } as const;
}

function findScrollContainer(node: HTMLSpanElement | null) {
  const container = node?.closest(".paper-content");
  return container instanceof HTMLDivElement ? container : null;
}

export const ParagraphDocumentFlow = memo(function ParagraphDocumentFlow({
  sessionId,
  session,
  rewriteUnits,
  documentView,
  documentFormat,
  rewriteEnabled,
  rewriteBlockedReason,
  showMarkers,
  suggestionsByRewriteUnit,
  runningRewriteUnitIdSet,
  optimisticManualRunningRewriteUnitId,
  activeRewriteUnitId,
  activeSuggestionId,
  activeReviewNavigationRequestId,
  selectedRewriteUnitIds,
  onSelectRewriteUnit,
  onSelectSuggestion
}: ParagraphDocumentFlowProps) {
  const rewriteUnitNodesRef = useRef<Record<string, HTMLSpanElement | null>>({});
  const previousActiveTargetRef = useRef<ActiveRewriteUnitTarget | null>(null);
  const activeRewriteUnitIndex = useMemo(() => {
    if (!activeRewriteUnitId) return null;
    const index = rewriteUnits.findIndex((item) => item.id === activeRewriteUnitId);
    return index >= 0 ? index : null;
  }, [activeRewriteUnitId, rewriteUnits]);
  const renderedUnitCount = useProgressiveRevealCount({
    total: rewriteUnits.length,
    key: sessionId,
    enabled: rewriteUnits.length > 180,
    initial: 140,
    step: 180,
    focusIndex: activeRewriteUnitIndex
  });

  useEffect(() => {
    const previous = previousActiveTargetRef.current;
    const next = {
      sessionId,
      rewriteUnitId: activeRewriteUnitId,
      suggestionId: activeSuggestionId,
      navigationRequestId: activeReviewNavigationRequestId
    };
    previousActiveTargetRef.current = next;
    if (!previous) {
      logScrollRestore("paragraph-scroll-skip", {
        reason: "no-previous-target",
        next
      });
      return;
    }
    if (!shouldScrollToActiveRewriteUnit(previous, next)) {
      logScrollRestore("paragraph-scroll-skip", {
        reason: "target-unchanged",
        previous,
        next
      });
      return;
    }
    const targetRewriteUnitId = next.rewriteUnitId;
    if (!targetRewriteUnitId) {
      logScrollRestore("paragraph-scroll-skip", {
        reason: "missing-target-rewrite-unit",
        previous,
        next
      });
      return;
    }
    const targetNode = rewriteUnitNodesRef.current[targetRewriteUnitId] ?? null;
    const scrollContainer = findScrollContainer(targetNode);

    logScrollRestore("paragraph-scroll-into-view", {
      sessionId,
      previousActiveRewriteUnitId: previous?.rewriteUnitId ?? null,
      activeRewriteUnitId: targetRewriteUnitId,
      previousActiveSuggestionId: previous?.suggestionId ?? null,
      activeSuggestionId,
      previousNavigationRequestId: previous?.navigationRequestId ?? null,
      activeReviewNavigationRequestId,
      targetNode: snapshotRewriteUnitNode(targetNode),
      scrollContainer: snapshotScrollNode(scrollContainer)
    });
    if (!targetNode) {
      logScrollRestore("paragraph-scroll-skip", {
        reason: "target-node-missing",
        targetRewriteUnitId,
        knownNodeCount: Object.keys(rewriteUnitNodesRef.current).length,
        knownNodeIds: Object.keys(rewriteUnitNodesRef.current).slice(0, 12)
      });
      return;
    }
    targetNode.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
    window.requestAnimationFrame(() => {
      logScrollRestore("paragraph-scroll-after-frame", {
        sessionId,
        activeRewriteUnitId: targetRewriteUnitId,
        activeSuggestionId,
        activeReviewNavigationRequestId,
        targetNode: snapshotRewriteUnitNode(targetNode),
        scrollContainer: snapshotScrollNode(findScrollContainer(targetNode))
      });
    });
  }, [activeRewriteUnitId, activeReviewNavigationRequestId, activeSuggestionId, sessionId]);

  const visibleRewriteUnits = useMemo(
    () => rewriteUnits.slice(0, renderedUnitCount),
    [renderedUnitCount, rewriteUnits]
  );
  const detectionScoresByRewriteUnit = useMemo(
    () => buildDetectionScoreByRewriteUnit(session.detectionResult),
    [session.detectionResult]
  );

  const visibleUnitMeta = useMemo(
    () =>
      visibleRewriteUnits.map((rewriteUnit) => {
        const unitSuggestions = suggestionsByRewriteUnit.get(rewriteUnit.id) ?? [];
        const summary = summarizeRewriteUnitSuggestions(unitSuggestions);
        const displaySuggestion = summary.applied ?? summary.proposed ?? null;
        const detectionScore = detectionScoresByRewriteUnit.get(rewriteUnit.id) ?? null;
        const isRunning =
          rewriteUnit.status === "running" ||
          runningRewriteUnitIdSet.has(rewriteUnit.id) ||
          rewriteUnit.id === optimisticManualRunningRewriteUnitId;
        const hasEditableSlot = rewriteUnitHasEditableSlot(session, rewriteUnit);

        return {
          rewriteUnit,
          displaySuggestion,
          isRunning,
          classes: buildRewriteUnitClassNames(
            rewriteUnit.id === activeRewriteUnitId,
            isRewriteUnitSelected(selectedRewriteUnitIds, rewriteUnit.id),
            hasEditableSlot,
            isRunning,
            rewriteUnit.status === "failed",
            Boolean(summary.applied),
            Boolean(summary.proposed),
            documentView,
            detectionScore
          ),
          detectionScore
        };
      }),
    [
      activeRewriteUnitId,
      detectionScoresByRewriteUnit,
      documentView,
      optimisticManualRunningRewriteUnitId,
      runningRewriteUnitIdSet,
      selectedRewriteUnitIds,
      session,
      suggestionsByRewriteUnit,
      visibleRewriteUnits
    ]
  );

  // 委托点击处理：单个回调替代每个单元的 inline onClick，消除每次渲染 N 个闭包
  const handleUnitClick = useCallback(
    (event: React.MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-rewrite-unit-id]"
      );
      if (!target) return;
      const rewriteUnitId = target.dataset.rewriteUnitId;
      if (!rewriteUnitId) return;

      onSelectRewriteUnit(rewriteUnitId, {
        multiSelect: event.metaKey || event.ctrlKey
      });

      const suggestionId = target.dataset.displaySuggestionId;
      if (suggestionId) {
        onSelectSuggestion(suggestionId);
      }
    },
    [onSelectRewriteUnit, onSelectSuggestion]
  );

  return (
    <span onClick={handleUnitClick}>
      {visibleUnitMeta.map((item) => {
        const { rewriteUnit, displaySuggestion, classes, detectionScore } = item;
        const rendered = renderRewriteUnitContent(
          session,
          rewriteUnit,
          displaySuggestion,
          documentView,
          showMarkers,
          documentFormat
        );

        return (
          <span key={rewriteUnit.id} className="doc-unit-wrap">
            <span
              ref={(node) => {
                rewriteUnitNodesRef.current[rewriteUnit.id] = node;
              }}
              className={classes}
              data-rewrite-unit-id={rewriteUnit.id}
              data-display-suggestion-id={displaySuggestion?.id}
              title={rewriteUnitTitleWithDetection(
                rewriteUnitTitle(session, rewriteUnit, rewriteEnabled, rewriteBlockedReason),
                detectionScore
              )}
            >
              {rendered.body}
            </span>
            {rendered.separatorText ? (
              <span className="doc-unit-separator">{rendered.separatorText}</span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
});
