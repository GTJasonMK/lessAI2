import { memo, useCallback, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type {
  AppSettings,
  DetectionResult,
  DocumentSession,
  RewriteMode,
  RewriteProgress,
  RewriteSuggestion,
  RewriteUnit
} from "../lib/types";
import type { SessionStats } from "../lib/helpers";
import {
  buildRunningRewriteUnitIdSet,
  groupSuggestionsByRewriteUnit,
  isDetectionSettingsReady,
  isSettingsReady
} from "../lib/helpers";
import { resolveOptimisticManualRunningRewriteUnitId } from "../lib/rewriteUnitSelection";
import type { EditorSlotOverrides } from "../lib/editorSlots";
import { DocumentPanel } from "./workbench/DocumentPanel";
import { ReviewPanel } from "./workbench/ReviewPanel";
import type { DocumentEditorHandle } from "./workbench/document/DocumentEditor";

interface WorkbenchStageProps {
  settings: AppSettings;
  currentSession: DocumentSession | null;
  liveProgress: RewriteProgress | null;
  currentStats: SessionStats | null;
  activeRewriteUnit: RewriteUnit | null;
  activeRewriteUnitId: string | null;
  activeSuggestionId: string | null;
  activeReviewNavigationRequestId: number;
  selectedRewriteUnitIds: string[];
  documentSelectionText: string;
  selectionDetectionResult: DetectionResult | null;
  busyAction: string | null;
  editorMode: boolean;
  editorText: string;
  editorSlotOverrides: EditorSlotOverrides;
  editorDirty: boolean;
  editorHasSelection: boolean;
  editorRef: MutableRefObject<DocumentEditorHandle | null>;
  documentScrollRef: MutableRefObject<HTMLDivElement | null>;
  onOpenDocument: () => void;
  onSelectRewriteUnit: (rewriteUnitId: string, options?: { multiSelect?: boolean }) => void;
  onSelectSuggestion: (suggestionId: string, options?: { forceScroll?: boolean }) => void;
  onStartRewrite: (mode: RewriteMode) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onFinalizeDocument: () => void;
  onResetSession: () => void;
  onApplySuggestion: (suggestionId: string) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onDeleteSuggestion: (suggestionId: string) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onEnterEditor: () => void;
  onChangeEditorText: (value: string) => void;
  onChangeEditorSlotText: (slotId: string, value: string) => void;
  onChangeEditorHasSelection: (value: boolean) => void;
  onDocumentSelectionTextChange: (value: string) => void;
  onSaveEditor: () => void;
  onSaveEditorAndExit: () => void;
  onDiscardEditorChanges: () => void;
  onExitEditor: () => void;
  onRewriteSelection: () => void;
  onStartDetection: () => void;
  onDetectSelection: () => void;
}

export const WorkbenchStage = memo(function WorkbenchStage({
  settings,
  currentSession,
  liveProgress,
  currentStats,
  activeRewriteUnit,
  activeRewriteUnitId,
  activeSuggestionId,
  activeReviewNavigationRequestId,
  selectedRewriteUnitIds,
  documentSelectionText,
  selectionDetectionResult,
  busyAction,
  editorMode,
  editorText,
  editorSlotOverrides,
  editorDirty,
  editorHasSelection,
  editorRef,
  documentScrollRef,
  onOpenDocument,
  onSelectRewriteUnit,
  onSelectSuggestion,
  onStartRewrite,
  onPause,
  onResume,
  onCancel,
  onFinalizeDocument,
  onResetSession,
  onApplySuggestion,
  onDismissSuggestion,
  onDeleteSuggestion,
  onRetry,
  onOpenSettings,
  onEnterEditor,
  onChangeEditorText,
  onChangeEditorSlotText,
  onChangeEditorHasSelection,
  onDocumentSelectionTextChange,
  onSaveEditor,
  onSaveEditorAndExit,
  onDiscardEditorChanges,
  onExitEditor,
  onRewriteSelection,
  onStartDetection,
  onDetectSelection
}: WorkbenchStageProps) {
  const settingsReady = isSettingsReady(settings);
  const detectionSettingsReady = isDetectionSettingsReady(settings);

  const [showMarkers, setShowMarkers] = useState<boolean>(() => {
    try {
      const raw =
        typeof localStorage === "undefined" ? null : localStorage.getItem("lessai.showMarkers");
      if (!raw) return true;
      return raw === "1" || raw.toLowerCase() === "true";
    } catch {
      return true;
    }
  });

  const handleToggleMarkers = useCallback(() => {
    setShowMarkers((value) => !value);
  }, []);

  const suggestionsByRewriteUnit = useMemo(
    () => groupSuggestionsByRewriteUnit(currentSession?.suggestions ?? []),
    [currentSession?.suggestions]
  );

  const runningRewriteUnitIdSet = useMemo(
    () => buildRunningRewriteUnitIdSet(currentSession, liveProgress),
    [currentSession, liveProgress]
  );

  const optimisticManualRunningRewriteUnitId = useMemo(() => {
    if (!currentSession) return null;
    if (busyAction === "retry-rewrite-unit") {
      return activeRewriteUnitId;
    }
    if (busyAction !== "start-manual") {
      return null;
    }
    return resolveOptimisticManualRunningRewriteUnitId(
      currentSession,
      selectedRewriteUnitIds
    );
  }, [activeRewriteUnitId, busyAction, currentSession, selectedRewriteUnitIds]);

  const activeRewriteUnitSuggestions = useMemo(() => {
    if (!currentSession || !activeRewriteUnit) return [];
    return suggestionsByRewriteUnit.get(activeRewriteUnit.id) ?? [];
  }, [activeRewriteUnit, currentSession, suggestionsByRewriteUnit]);

  const orderedSuggestions = useMemo(() => {
    if (!currentSession) return [];
    return [...currentSession.suggestions].sort((a, b) => a.sequence - b.sequence);
  }, [currentSession?.suggestions]);

  const activeSuggestion = useMemo<RewriteSuggestion | null>(() => {
    if (!currentSession || !activeSuggestionId) return null;
    return currentSession.suggestions.find((item) => item.id === activeSuggestionId) ?? null;
  }, [currentSession, activeSuggestionId]);

  return (
    <div className="workbench-root">
      <div className="workbench-layout">
        <div className="workbench-column is-center">
          <DocumentPanel
            settings={settings}
            settingsReady={settingsReady}
            currentSession={currentSession}
            currentStats={currentStats}
            showMarkers={showMarkers}
            suggestionsByRewriteUnit={suggestionsByRewriteUnit}
            runningRewriteUnitIdSet={runningRewriteUnitIdSet}
            optimisticManualRunningRewriteUnitId={optimisticManualRunningRewriteUnitId}
            activeRewriteUnitId={activeRewriteUnitId}
            activeSuggestionId={activeSuggestionId}
            activeReviewNavigationRequestId={activeReviewNavigationRequestId}
            selectedRewriteUnitIds={selectedRewriteUnitIds}
            documentSelectionText={documentSelectionText}
            busyAction={busyAction}
            editorMode={editorMode}
            editorText={editorText}
            editorSlotOverrides={editorSlotOverrides}
            editorDirty={editorDirty}
            editorHasSelection={editorHasSelection}
            editorRef={editorRef}
            documentScrollRef={documentScrollRef}
            onOpenDocument={onOpenDocument}
            onOpenSettings={onOpenSettings}
            onSelectRewriteUnit={onSelectRewriteUnit}
            onSelectSuggestion={onSelectSuggestion}
            onStartRewrite={onStartRewrite}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            onFinalizeDocument={onFinalizeDocument}
            onResetSession={onResetSession}
            onEnterEditor={onEnterEditor}
            onChangeEditorText={onChangeEditorText}
            onChangeEditorSlotText={onChangeEditorSlotText}
            onChangeEditorHasSelection={onChangeEditorHasSelection}
            onDocumentSelectionTextChange={onDocumentSelectionTextChange}
            onSaveEditor={onSaveEditor}
            onSaveEditorAndExit={onSaveEditorAndExit}
            onDiscardEditorChanges={onDiscardEditorChanges}
            onExitEditor={onExitEditor}
            onRewriteSelection={onRewriteSelection}
            detectionSettingsReady={detectionSettingsReady}
            onStartDetection={onStartDetection}
            onDetectSelection={onDetectSelection}
            onToggleMarkers={handleToggleMarkers}
          />
        </div>

        <div className="workbench-column is-right">
          <ReviewPanel
            settingsReady={settingsReady}
            currentSession={currentSession}
            currentStats={currentStats}
            activeRewriteUnit={activeRewriteUnit}
            activeRewriteUnitSuggestions={activeRewriteUnitSuggestions}
            activeSuggestionId={activeSuggestionId}
            activeSuggestion={activeSuggestion}
            detectionSettingsReady={detectionSettingsReady}
            selectionDetectionAvailable={
              editorMode ? editorHasSelection : documentSelectionText.trim().length > 0
            }
            selectionDetectionResult={selectionDetectionResult}
            showMarkers={showMarkers}
            busyAction={busyAction}
            editorMode={editorMode}
            editorText={editorText}
            editorSlotOverrides={editorSlotOverrides}
            editorDirty={editorDirty}
            orderedSuggestions={orderedSuggestions}
            onOpenSettings={onOpenSettings}
            onSelectRewriteUnit={onSelectRewriteUnit}
            onSelectSuggestion={onSelectSuggestion}
            onApplySuggestion={onApplySuggestion}
            onDismissSuggestion={onDismissSuggestion}
            onDeleteSuggestion={onDeleteSuggestion}
            onRetry={onRetry}
            onStartDetection={onStartDetection}
            onDetectSelection={onDetectSelection}
          />
        </div>
      </div>
    </div>
  );
});
