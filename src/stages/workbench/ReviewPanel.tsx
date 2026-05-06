import { memo, useEffect, useState } from "react";
import type {
  DetectionResult,
  DocumentSession,
  RewriteSuggestion,
  RewriteUnit
} from "../../lib/types";
import type { SessionStats } from "../../lib/helpers";
import type { EditorSlotOverrides } from "../../lib/editorSlots";
import { Panel } from "../../components/Panel";
import { EditorReviewPane } from "./review/EditorReviewPane";
import { DetectionReviewPane } from "./review/DetectionReviewPane";
import { ReviewActionBar } from "./review/ReviewActionBar";
import { ReviewEmptyState } from "./review/ReviewEmptyState";
import { SuggestionReviewPane } from "./review/SuggestionReviewPane";

interface ReviewPanelProps {
  settingsReady: boolean;
  currentSession: DocumentSession | null;
  currentStats: SessionStats | null;
  activeRewriteUnit: RewriteUnit | null;
  activeRewriteUnitSuggestions: RewriteSuggestion[];
  activeSuggestionId: string | null;
  activeSuggestion: RewriteSuggestion | null;
  detectionSettingsReady: boolean;
  selectionDetectionAvailable: boolean;
  selectionDetectionResult: DetectionResult | null;
  showMarkers: boolean;
  busyAction: string | null;
  editorMode: boolean;
  editorText: string;
  editorSlotOverrides: EditorSlotOverrides;
  editorDirty: boolean;
  orderedSuggestions: RewriteSuggestion[];
  onOpenSettings: () => void;
  onSelectRewriteUnit: (rewriteUnitId: string, options?: { multiSelect?: boolean }) => void;
  onSelectSuggestion: (suggestionId: string, options?: { forceScroll?: boolean }) => void;
  onApplySuggestion: (suggestionId: string) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onDeleteSuggestion: (suggestionId: string) => void;
  onRetry: () => void;
  onStartDetection: () => void;
  onDetectSelection: () => void;
}

export const ReviewPanel = memo(function ReviewPanel({
  settingsReady,
  currentSession,
  currentStats,
  activeRewriteUnit,
  activeRewriteUnitSuggestions,
  activeSuggestionId,
  activeSuggestion,
  detectionSettingsReady,
  selectionDetectionAvailable,
  selectionDetectionResult,
  showMarkers,
  busyAction,
  editorMode,
  editorText,
  editorSlotOverrides,
  editorDirty,
  orderedSuggestions,
  onOpenSettings,
  onSelectRewriteUnit,
  onSelectSuggestion,
  onApplySuggestion,
  onDismissSuggestion,
  onDeleteSuggestion,
  onRetry,
  onStartDetection,
  onDetectSelection
}: ReviewPanelProps) {
  const [reviewPane, setReviewPane] = useState<"suggestions" | "detection">("suggestions");
  const anyBusy = Boolean(busyAction);
  const rewriteRunning = currentSession?.status === "running";
  const rewritePaused = currentSession?.status === "paused";

  useEffect(() => {
    setReviewPane("suggestions");
  }, [currentSession?.id]);

  useEffect(() => {
    if (selectionDetectionResult || currentSession?.detectionResult) {
      setReviewPane("detection");
    }
  }, [currentSession?.detectionResult?.createdAt, selectionDetectionResult?.createdAt]);

  const paneSwitch = (
    <div className="summary-row review-switches" aria-label="审阅面板切换">
      <button
        type="button"
        className={`switch-chip ${reviewPane === "suggestions" ? "is-active" : ""}`}
        onClick={() => setReviewPane("suggestions")}
      >
        {editorMode ? "编辑信息" : "改写建议"}
      </button>
      <button
        type="button"
        className={`switch-chip ${reviewPane === "detection" ? "is-active" : ""}`}
        onClick={() => setReviewPane("detection")}
      >
        AI 检测
      </button>
    </div>
  );

  return (
    <Panel
      title="审阅"
      subtitle={reviewPane === "detection" ? "AI 检测结果" : editorMode ? "编辑信息" : "建议列表"}
      className="workbench-review-panel"
      bodyClassName="workbench-review-body"
      action={
        <ReviewActionBar
          editorMode={editorMode}
          settingsReady={settingsReady}
          currentSession={currentSession}
          activeRewriteUnit={activeRewriteUnit}
          activeRewriteUnitSuggestions={activeRewriteUnitSuggestions}
          activeSuggestion={activeSuggestion}
        />
      }
    >
      {currentSession && currentStats ? (
        <div className={`workbench-mode-switch workbench-review-mode-switch ${editorMode ? "is-editor" : ""}`}>
          <div
            className="workbench-mode-pane is-normal"
            aria-hidden={editorMode}
            inert={editorMode}
          >
            <div className="workbench-mode-content workbench-review-mode-content">
              {!editorMode ? (
                <>
                  {paneSwitch}
                  {reviewPane === "detection" ? (
                    <DetectionReviewPane
                      currentSession={currentSession}
                      activeRewriteUnitId={activeRewriteUnit?.id ?? null}
                      selectionDetectionResult={selectionDetectionResult}
                      busyAction={busyAction}
                      editorMode={editorMode}
                      detectionSettingsReady={detectionSettingsReady}
                      selectionDetectionAvailable={selectionDetectionAvailable}
                      onStartDetection={onStartDetection}
                      onDetectSelection={onDetectSelection}
                      onSelectRewriteUnit={onSelectRewriteUnit}
                    />
                  ) : (
                    <SuggestionReviewPane
                      settingsReady={settingsReady}
                      currentSession={currentSession}
                      currentStats={currentStats}
                      activeRewriteUnit={activeRewriteUnit}
                      activeSuggestionId={activeSuggestionId}
                      orderedSuggestions={orderedSuggestions}
                      anyBusy={anyBusy}
                      busyAction={busyAction}
                      rewriteRunning={rewriteRunning ?? false}
                      rewritePaused={rewritePaused ?? false}
                      onSelectRewriteUnit={onSelectRewriteUnit}
                      onSelectSuggestion={onSelectSuggestion}
                      onApplySuggestion={onApplySuggestion}
                      onDismissSuggestion={onDismissSuggestion}
                      onDeleteSuggestion={onDeleteSuggestion}
                      onRetry={onRetry}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>

          <div
            className="workbench-mode-pane is-editor"
            aria-hidden={!editorMode}
            inert={!editorMode}
          >
            <div className="workbench-mode-content workbench-review-mode-content">
              {editorMode ? (
                <>
                  {paneSwitch}
                  {reviewPane === "detection" ? (
                    <DetectionReviewPane
                      currentSession={currentSession}
                      activeRewriteUnitId={activeRewriteUnit?.id ?? null}
                      selectionDetectionResult={selectionDetectionResult}
                      busyAction={busyAction}
                      editorMode={editorMode}
                      detectionSettingsReady={detectionSettingsReady}
                      selectionDetectionAvailable={selectionDetectionAvailable}
                      onStartDetection={onStartDetection}
                      onDetectSelection={onDetectSelection}
                      onSelectRewriteUnit={onSelectRewriteUnit}
                    />
                  ) : (
                    <EditorReviewPane
                      currentSession={currentSession}
                      editorText={editorText}
                      editorSlotOverrides={editorSlotOverrides}
                      editorDirty={editorDirty}
                      showMarkers={showMarkers}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <ReviewEmptyState
          settingsReady={settingsReady}
          onOpenSettings={onOpenSettings}
        />
      )}
    </Panel>
  );
});
