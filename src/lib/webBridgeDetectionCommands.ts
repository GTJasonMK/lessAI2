import {
  detectionInputsFromSession,
  detectionModelSettings,
  detectionSystemPrompt,
  detectionUserPrompt,
  parseDetectionResult
} from "./detection";
import { callChatModel, ensureDetectionSettingsReady } from "./webBridgeModelApi";
import type {
  AppSettings,
  DetectionResult,
  DocumentSession,
  DocumentSnapshot
} from "./types";

interface DetectionCommandDeps {
  deepClone: <T>(value: T) => T;
  getSettings: () => AppSettings;
  getSessionOrThrow: (sessionId: string) => DocumentSession;
  ensureNoActiveJob: (sessionId: string, errorMessage: string) => void;
  ensureEditorBaseSnapshotMatches: (
    session: DocumentSession,
    editorBaseSnapshot: DocumentSnapshot | null | undefined
  ) => void;
  updateSessionTimestamp: (session: DocumentSession) => void;
  activeRewriteSessionError: string;
}

export function createDetectionCommands(deps: DetectionCommandDeps) {
  async function startDetectionCommand(sessionId: string) {
    deps.ensureNoActiveJob(sessionId, deps.activeRewriteSessionError);
    const session = deps.getSessionOrThrow(sessionId);
    const settings = deps.getSettings();
    ensureDetectionSettingsReady(settings);

    const inputs = detectionInputsFromSession(session);
    if (inputs.length === 0) {
      throw new Error("当前文档没有可检测文本。");
    }

    const modelSettings = detectionModelSettings(settings);
    const raw = await callChatModel(
      modelSettings,
      detectionSystemPrompt(),
      detectionUserPrompt(inputs),
      undefined,
      0
    );
    session.detectionResult = parseDetectionResult(
      raw,
      inputs,
      modelSettings.model,
      session.sourceSnapshot ?? null
    );
    deps.updateSessionTimestamp(session);
    return deps.deepClone(session);
  }

  async function detectSelectionCommand(
    sessionId: string,
    text: string,
    editorBaseSnapshot: DocumentSnapshot | null | undefined
  ): Promise<DetectionResult> {
    if (!text.trim()) {
      throw new Error("选区内容为空。");
    }
    deps.ensureNoActiveJob(sessionId, deps.activeRewriteSessionError);
    const session = deps.getSessionOrThrow(sessionId);
    if (editorBaseSnapshot) {
      deps.ensureEditorBaseSnapshotMatches(session, editorBaseSnapshot);
    }
    const settings = deps.getSettings();
    ensureDetectionSettingsReady(settings);
    const inputs = [{ rewriteUnitId: null, text }];
    const modelSettings = detectionModelSettings(settings);
    const raw = await callChatModel(
      modelSettings,
      detectionSystemPrompt(),
      detectionUserPrompt(inputs),
      undefined,
      0
    );
    return parseDetectionResult(raw, inputs, modelSettings.model, session.sourceSnapshot ?? null);
  }

  return {
    startDetectionCommand,
    detectSelectionCommand
  };
}
