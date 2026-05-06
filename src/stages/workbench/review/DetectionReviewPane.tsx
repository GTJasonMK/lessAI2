import { memo, useMemo } from "react";
import { BadgePercent, LoaderCircle, ScanSearch } from "lucide-react";

import { formatDate } from "../../../lib/helpers";
import {
  detectionRiskLabel,
  detectionRiskLevel,
  formatDetectionScore
} from "../../../lib/detection";
import type { DetectionResult, DetectionSegment, DocumentSession } from "../../../lib/types";
import { useProgressiveRevealCount } from "../hooks/useProgressiveRevealCount";

interface DetectionReviewPaneProps {
  currentSession: DocumentSession;
  activeRewriteUnitId: string | null;
  selectionDetectionResult: DetectionResult | null;
  busyAction: string | null;
  editorMode: boolean;
  detectionSettingsReady: boolean;
  selectionDetectionAvailable: boolean;
  onStartDetection: () => void;
  onDetectSelection: () => void;
  onSelectRewriteUnit: (rewriteUnitId: string, options?: { multiSelect?: boolean }) => void;
}

function truncateText(value: string, maxChars = 96) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, maxChars).join("")}…`;
}

function sortedSegments(segments: DetectionSegment[]) {
  return [...segments].sort((left, right) => right.score - left.score);
}

function DetectionScoreCard({
  title,
  result,
  segmentTitle,
  activeRewriteUnitId,
  onSelectRewriteUnit
}: {
  title: string;
  result: DetectionResult;
  segmentTitle: string;
  activeRewriteUnitId: string | null;
  onSelectRewriteUnit: (rewriteUnitId: string, options?: { multiSelect?: boolean }) => void;
}) {
  const riskLevel = detectionRiskLevel(result.overallScore);
  const segments = useMemo(() => sortedSegments(result.segments), [result.segments]);
  const renderedSegmentCount = useProgressiveRevealCount({
    total: segments.length,
    key: `${title}-${result.createdAt}`,
    enabled: segments.length > 220,
    initial: 180,
    step: 220
  });
  const visibleSegments = useMemo(
    () => segments.slice(0, renderedSegmentCount),
    [renderedSegmentCount, segments]
  );

  return (
    <section className={`detection-result-card is-${riskLevel}`}>
      <div className="detection-result-head">
        <div>
          <strong>{title}</strong>
          <span>
            {result.model} · {formatDate(result.createdAt)}
          </span>
        </div>
        <div className={`detection-score is-${riskLevel}`}>
          <BadgePercent />
          <span>{formatDetectionScore(result.overallScore)}</span>
        </div>
      </div>

      <div className="detection-summary">
        <span className={`detection-risk is-${riskLevel}`}>
          {detectionRiskLabel(result.overallScore)}
        </span>
        <p>{result.summary}</p>
      </div>

      {segments.length > 0 ? (
        <div className="detection-segment-list">
          <span className="detection-section-label">{segmentTitle}</span>
          {visibleSegments.map((segment) => {
            const segmentRisk = detectionRiskLevel(segment.score);
            const clickable = Boolean(segment.rewriteUnitId);
            const className = [
              "detection-segment-row",
              `is-${segmentRisk}`,
              segment.rewriteUnitId === activeRewriteUnitId ? "is-active" : "",
              clickable ? "is-clickable" : ""
            ]
              .filter(Boolean)
              .join(" ");
            const content = (
              <>
                <span className="detection-segment-score">
                  {formatDetectionScore(segment.score)}
                </span>
                <span className="detection-segment-text">
                  {truncateText(segment.text || segment.reason || "未返回片段文本")}
                </span>
                {segment.reason ? (
                  <span className="detection-segment-reason">{segment.reason}</span>
                ) : null}
              </>
            );

            return clickable ? (
              <button
                key={segment.id}
                type="button"
                className={className}
                onClick={() => onSelectRewriteUnit(segment.rewriteUnitId!)}
                title="定位到对应正文片段"
              >
                {content}
              </button>
            ) : (
              <div key={segment.id} className={className}>
                {content}
              </div>
            );
          })}
          {renderedSegmentCount < segments.length ? (
            <div className="empty-inline" aria-hidden="true">
              <span>正在加载更多检测片段…</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export const DetectionReviewPane = memo(function DetectionReviewPane({
  currentSession,
  activeRewriteUnitId,
  selectionDetectionResult,
  busyAction,
  editorMode,
  detectionSettingsReady,
  selectionDetectionAvailable,
  onStartDetection,
  onDetectSelection,
  onSelectRewriteUnit
}: DetectionReviewPaneProps) {
  const fullResult = currentSession.detectionResult ?? null;
  const rewriteRunning =
    currentSession.status === "running" || currentSession.status === "paused";
  const startBusy = busyAction === "start-detection";
  const selectionBusy = busyAction === "detect-selection";
  const anyBusy = Boolean(busyAction);
  const startDisabled =
    editorMode ||
    !detectionSettingsReady ||
    rewriteRunning ||
    startBusy ||
    (anyBusy && busyAction !== "start-detection");
  const selectionDisabled =
    !detectionSettingsReady ||
    !selectionDetectionAvailable ||
    rewriteRunning ||
    selectionBusy ||
    (anyBusy && busyAction !== "detect-selection");

  return (
    <div className="detection-pane scroll-region">
      <div className="review-summary-strip">
        <span className="context-chip">
          全文：{fullResult ? formatDetectionScore(fullResult.overallScore) : "未检测"}
        </span>
        <span className="context-chip">
          选区：{selectionDetectionResult ? formatDetectionScore(selectionDetectionResult.overallScore) : "临时"}
        </span>
      </div>

      <div className="detection-pane-actions">
        <button
          type="button"
          className="switch-chip"
          onClick={onStartDetection}
          disabled={startDisabled}
          title={
            editorMode
              ? "全文检测请先返回工作台"
              : detectionSettingsReady
              ? "重新检测全文 AI 生成概率"
              : "请先在设置中启用并填写 AI 检测接口"
          }
        >
          {startBusy ? <LoaderCircle className="spin" /> : <ScanSearch />}
          <span>{fullResult ? "重新检测全文" : "检测全文"}</span>
        </button>
        <button
          type="button"
          className="switch-chip"
          onMouseDown={(event) => {
            if (!selectionDisabled) {
              event.preventDefault();
            }
          }}
          onClick={onDetectSelection}
          disabled={selectionDisabled}
          title={
            !detectionSettingsReady
              ? "请先在设置中启用并填写 AI 检测接口"
              : !selectionDetectionAvailable
                ? "请先在正文中选中需要检测的文本"
                : rewriteRunning
                  ? "请先取消或等待当前自动任务完成"
                  : "检测当前正文选区"
          }
        >
          {selectionBusy ? <LoaderCircle className="spin" /> : <BadgePercent />}
          <span>检测选区</span>
        </button>
      </div>

      {selectionDetectionResult ? (
        <DetectionScoreCard
          title="选区检测"
          result={selectionDetectionResult}
          segmentTitle="选区风险片段"
          activeRewriteUnitId={activeRewriteUnitId}
          onSelectRewriteUnit={onSelectRewriteUnit}
        />
      ) : null}

      {fullResult ? (
        <DetectionScoreCard
          title="全文检测"
          result={fullResult}
          segmentTitle="高风险片段"
          activeRewriteUnitId={activeRewriteUnitId}
          onSelectRewriteUnit={onSelectRewriteUnit}
        />
      ) : (
        <div className="empty-inline">
          <span>
            还没有全文 AI 检测结果。点击“检测全文”后，结果会写入当前文档记录并在正文中高亮。
          </span>
        </div>
      )}
    </div>
  );
});
