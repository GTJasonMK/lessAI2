import { useCallback } from "react";
import type { MutableRefObject } from "react";

import { detectSelection, startDetection } from "../../lib/api";
import { isDetectionSettingsReady, normalizeNewlines, readableError } from "../../lib/helpers";
import type {
  AppSettings,
  DetectionResult,
  DocumentSession,
  DocumentSnapshot
} from "../../lib/types";
import type { DocumentEditorHandle } from "../../stages/workbench/document/DocumentEditor";
import {
  applyUpdatedSessionState,
  type ApplySessionState,
  type ShowNotice,
  type WithBusy
} from "./sessionActionShared";

export function useDetectionActions(options: {
  settings: AppSettings;
  stageRef: MutableRefObject<"workbench" | "editor">;
  currentSessionRef: MutableRefObject<DocumentSession | null>;
  activeRewriteUnitIdRef: MutableRefObject<string | null>;
  activeSuggestionIdRef: MutableRefObject<string | null>;
  documentSelectionTextRef: MutableRefObject<string>;
  editorBaseSnapshotRef: MutableRefObject<DocumentSnapshot | null>;
  editorRef: MutableRefObject<DocumentEditorHandle | null>;
  captureDocumentScrollPosition: () => number | null;
  applySessionState: ApplySessionState;
  setSelectionDetectionResult: React.Dispatch<
    React.SetStateAction<DetectionResult | null>
  >;
  showNotice: ShowNotice;
  withBusy: WithBusy;
}) {
  const {
    settings,
    stageRef,
    currentSessionRef,
    activeRewriteUnitIdRef,
    activeSuggestionIdRef,
    documentSelectionTextRef,
    editorBaseSnapshotRef,
    editorRef,
    captureDocumentScrollPosition,
    applySessionState,
    setSelectionDetectionResult,
    showNotice,
    withBusy
  } = options;

  const ensureDetectionReady = useCallback(() => {
    if (isDetectionSettingsReady(settings)) {
      return true;
    }
    showNotice("warning", "请先在设置中启用并填写 AI 检测接口。");
    return false;
  }, [settings, showNotice]);

  const handleStartDetection = useCallback(async () => {
    if (stageRef.current === "editor") {
      showNotice("warning", "全文检测请先返回工作台后再执行。");
      return;
    }

    const session = currentSessionRef.current;
    if (!session) {
      showNotice("warning", "请先打开一个文档。");
      return;
    }
    if (session.status === "running" || session.status === "paused") {
      showNotice("warning", "文档正在执行自动任务，请先取消或等待完成后再检测。");
      return;
    }
    if (!ensureDetectionReady()) {
      return;
    }

    const preservedScrollTop = captureDocumentScrollPosition();
    try {
      const updated = await withBusy("start-detection", () => startDetection(session.id));
      applyUpdatedSessionState({
        session: updated,
        applySessionState,
        preferredRewriteUnitId: activeRewriteUnitIdRef.current,
        preferredSuggestionId: activeSuggestionIdRef.current,
        preservedScrollTop
      });
      setSelectionDetectionResult(null);
      showNotice("success", "AI 检测完成，结果已写入当前文档记录。");
    } catch (error) {
      showNotice("error", `AI 检测失败：${readableError(error)}`);
    }
  }, [
    activeRewriteUnitIdRef,
    activeSuggestionIdRef,
    applySessionState,
    captureDocumentScrollPosition,
    currentSessionRef,
    ensureDetectionReady,
    setSelectionDetectionResult,
    showNotice,
    stageRef,
    withBusy
  ]);

  const handleDetectSelection = useCallback(async () => {
    const session = currentSessionRef.current;
    if (!session) {
      showNotice("warning", "请先打开一个文档。");
      return;
    }
    if (session.status === "running" || session.status === "paused") {
      showNotice("warning", "文档正在执行自动任务，请先取消或等待完成后再检测。");
      return;
    }
    if (!ensureDetectionReady()) {
      return;
    }

    const editorSnapshot =
      stageRef.current === "editor" ? editorRef.current?.captureSelection() ?? null : null;
    const text = normalizeNewlines(
      editorSnapshot?.text ?? documentSelectionTextRef.current
    ).trim();
    if (!text) {
      showNotice("warning", "请先在正文中选中需要检测的文本。");
      return;
    }

    try {
      const result = await withBusy("detect-selection", () =>
        detectSelection(
          session.id,
          text,
          stageRef.current === "editor" ? editorBaseSnapshotRef.current : null
        )
      );
      setSelectionDetectionResult(result);
      showNotice("success", "选区 AI 检测完成，可在右侧查看结果。");
    } catch (error) {
      showNotice("error", `选区检测失败：${readableError(error)}`);
    }
  }, [
    currentSessionRef,
    documentSelectionTextRef,
    editorBaseSnapshotRef,
    editorRef,
    ensureDetectionReady,
    setSelectionDetectionResult,
    showNotice,
    stageRef,
    withBusy
  ]);

  return { handleStartDetection, handleDetectSelection } as const;
}
