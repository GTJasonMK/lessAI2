import type {
  AppSettings,
  DetectionResult,
  DetectionSegment,
  DocumentSession
} from "./types";
import { rewriteUnitHasEditableSlot } from "./helpers";
import { rewriteUnitSourceText } from "./slotText";

export type DetectionRiskLevel = "low" | "medium" | "high";

export interface DetectionInput {
  rewriteUnitId: string | null;
  text: string;
}

export function detectionRiskLevel(score: number): DetectionRiskLevel {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function detectionRiskLabel(score: number) {
  const level = detectionRiskLevel(score);
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

export function formatDetectionScore(score: number) {
  return `${Math.round(score)}%`;
}

export function detectionScoreForRewriteUnit(
  result: DetectionResult | null | undefined,
  rewriteUnitId: string
) {
  if (!result) return null;
  let maxScore: number | null = null;
  for (const segment of result.segments) {
    if (segment.rewriteUnitId !== rewriteUnitId) continue;
    maxScore = maxScore == null ? segment.score : Math.max(maxScore, segment.score);
  }
  return maxScore;
}

export function buildDetectionScoreByRewriteUnit(
  result: DetectionResult | null | undefined
) {
  const scores = new Map<string, number>();
  if (!result) return scores;

  for (const segment of result.segments) {
    if (!segment.rewriteUnitId) continue;
    const current = scores.get(segment.rewriteUnitId);
    if (current == null || segment.score > current) {
      scores.set(segment.rewriteUnitId, segment.score);
    }
  }

  return scores;
}

export function detectionSegmentsForRewriteUnit(
  result: DetectionResult | null | undefined,
  rewriteUnitId: string
) {
  if (!result) return [];
  return result.segments.filter((segment) => segment.rewriteUnitId === rewriteUnitId);
}

export function detectionModelSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    baseUrl: settings.detectionBaseUrl,
    apiKey: settings.detectionApiKey,
    model: settings.detectionModel,
    temperature: 0
  };
}

export function detectionInputsFromSession(session: DocumentSession): DetectionInput[] {
  return session.rewriteUnits
    .filter((rewriteUnit) => rewriteUnitHasEditableSlot(session, rewriteUnit))
    .map((rewriteUnit) => ({
      rewriteUnitId: rewriteUnit.id,
      text: rewriteUnitSourceText(session, rewriteUnit)
    }))
    .filter((input) => input.text.trim().length > 0);
}

export function detectionSystemPrompt() {
  return [
    "你是一个文本 AI 生成概率检测器。",
    "只输出 JSON，不要输出 Markdown。",
    "分数含义固定为 0-100 的 AI 生成概率，越高越像 AI 生成。"
  ].join("");
}

export function detectionUserPrompt(inputs: DetectionInput[]) {
  return `请检测以下文本的 AI 生成概率。必须返回一个 JSON 对象，字段使用 camelCase。\n${JSON.stringify(
    {
      task: "detect_ai_generated_text",
      scoreMeaning: "0-100 AI-generated probability; higher means more likely AI-generated",
      requiredJsonShape: {
        overallScore: "number 0-100",
        summary: "short Chinese explanation",
        segments: [
          {
            rewriteUnitId: "copy from input when available",
            score: "number 0-100",
            reason: "short Chinese explanation",
            text: "optional suspicious excerpt",
            start: "optional character start offset",
            end: "optional character end offset"
          }
        ]
      },
      units: inputs
    },
    null,
    2
  )}`;
}

export function parseDetectionResult(
  raw: string,
  inputs: DetectionInput[],
  model: string,
  sourceSnapshot: DetectionResult["sourceSnapshot"] = null
): DetectionResult {
  const payload = JSON.parse(extractJsonObject(raw)) as {
    overallScore?: unknown;
    overall_score?: unknown;
    score?: unknown;
    aiProbability?: unknown;
    summary?: unknown;
    segments?: unknown;
  };
  const overallScore = normalizeScore(
    numeric(payload.overallScore) ??
      numeric(payload.overall_score) ??
      numeric(payload.score) ??
      numeric(payload.aiProbability) ??
      0
  );
  const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
  const segments = rawSegments.map((item, index) =>
    normalizeSegment(item, index, inputs, overallScore)
  );

  return {
    overallScore,
    summary:
      typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : "检测完成。",
    segments: segments.length > 0 ? segments : fallbackSegments(inputs, overallScore),
    createdAt: new Date().toISOString(),
    model,
    sourceSnapshot
  };
}

function normalizeSegment(
  item: unknown,
  index: number,
  inputs: DetectionInput[],
  fallbackScore: number
): DetectionSegment {
  const record = isRecord(item) ? item : {};
  const rewriteUnitId = normalizeRewriteUnitId(
    stringValue(record.rewriteUnitId) ??
      stringValue(record.rewrite_unit_id) ??
      stringValue(record.unitId) ??
      stringValue(record.id),
    inputs
  );
  return {
    id: `segment-${index}`,
    rewriteUnitId,
    text:
      stringValue(record.text)?.trim() ||
      inputs.find((input) => input.rewriteUnitId === rewriteUnitId)?.text ||
      "",
    start: numeric(record.start),
    end: numeric(record.end),
    score: normalizeScore(
      numeric(record.score) ??
        numeric(record.aiProbability) ??
        numeric(record.probability) ??
        fallbackScore
    ),
    reason: stringValue(record.reason)?.trim() || null
  };
}

function fallbackSegments(inputs: DetectionInput[], score: number): DetectionSegment[] {
  return inputs.map((input, index) => ({
    id: `segment-${index}`,
    rewriteUnitId: input.rewriteUnitId,
    text: input.text,
    start: null,
    end: null,
    score,
    reason: null
  }));
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unfenced.startsWith("{") && unfenced.endsWith("}")) {
    return unfenced;
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("检测结果没有包含 JSON 对象。");
  }
  return unfenced.slice(start, end + 1);
}

function normalizeRewriteUnitId(value: string | null, inputs: DetectionInput[]) {
  if (!value) return null;
  const trimmed = value.trim();
  return inputs.some((input) => input.rewriteUnitId === trimmed) ? trimmed : null;
}

function normalizeScore(value: number) {
  const finite = Number.isFinite(value) ? value : 0;
  const scaled = finite > 0 && finite <= 1 ? finite * 100 : finite;
  return Math.max(0, Math.min(100, scaled));
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
