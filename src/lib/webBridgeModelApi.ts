import type { AppSettings } from "./types";

export function ensureSettingsReady(settings: AppSettings) {
  if (!settings.baseUrl.trim()) {
    throw new Error("Base URL 不能为空。");
  }
  if (!settings.apiKey.trim()) {
    throw new Error("API Key 不能为空。");
  }
  if (!settings.model.trim()) {
    throw new Error("模型名称不能为空。");
  }
}

export function ensureDetectionSettingsReady(settings: AppSettings) {
  if (!settings.detectionEnabled) {
    throw new Error("AI 检测未启用，请先在设置中开启检测接口。");
  }
  if (!settings.detectionBaseUrl.trim()) {
    throw new Error("检测 Base URL 不能为空。");
  }
  if (!settings.detectionApiKey.trim()) {
    throw new Error("检测 API Key 不能为空。");
  }
  if (!settings.detectionModel.trim()) {
    throw new Error("检测模型名称不能为空。");
  }
}

export function validateSettings(settings: AppSettings): AppSettings {
  if (settings.timeoutMs < 1_000) {
    throw new Error("超时（毫秒）必须大于等于 1000。");
  }
  if (settings.maxConcurrency < 1 || settings.maxConcurrency > 8) {
    throw new Error("自动并发数必须在 1 到 8 之间。");
  }
  if (settings.unitsPerBatch < 1) {
    throw new Error("单批处理单元数必须大于等于 1。");
  }
  if (settings.temperature < 0 || settings.temperature > 2) {
    throw new Error("Temperature 必须在 0 到 2 之间。");
  }
  return settings;
}

function chatUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/g, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessageFromPayload(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }
  const message = payload.error.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function previewText(value: string, maxChars = 200) {
  return Array.from(value.trim()).slice(0, maxChars).join("");
}

function extractChatContent(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("模型返回格式不受支持。");
  }

  const providerError = errorMessageFromPayload(payload);
  if (providerError) {
    throw new Error(providerError);
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new Error("模型没有返回可用结果。");
  }

  const choice = choices[0];
  const message = isRecord(choice.message) ? choice.message : null;
  const content = message?.content ?? choice.text;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("模型返回内容为空。");
    }
    return trimmed;
  }
  if (Array.isArray(content)) {
    const merged = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          typeof item === "object" &&
          item &&
          "text" in item &&
          typeof (item as { text: unknown }).text === "string"
        ) {
          return (item as { text: string }).text;
        }
        return "";
      })
      .join("")
      .trim();
    if (!merged) {
      throw new Error("模型返回内容为空。");
    }
    return merged;
  }
  throw new Error("模型返回格式不受支持。");
}

function createModelRequestSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timeoutError: Error | null = null;

  const abort = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  const handleExternalAbort = () => abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    abort(externalSignal.reason);
  } else {
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        timedOut = true;
        timeoutError = new Error(`模型调用超时：超过 ${timeoutMs}ms。`);
        abort(timeoutError);
        reject(timeoutError);
      }
    }, timeoutMs);
  });

  return {
    signal: controller.signal,
    timeoutPromise,
    timedOut: () => timedOut,
    timeoutError: () => timeoutError,
    cleanup: () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  };
}

export async function callChatModel(
  settings: AppSettings,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  temperatureOverride?: number
) {
  const requestSignal = createModelRequestSignal(settings.timeoutMs, signal);
  let response: Response;
  let raw: string;
  try {
    response = await Promise.race([
      fetch(chatUrl(settings.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey.trim()}`
        },
        body: JSON.stringify({
          model: settings.model.trim(),
          temperature:
            typeof temperatureOverride === "number"
              ? temperatureOverride
              : settings.temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: requestSignal.signal
      }),
      requestSignal.timeoutPromise
    ]);
    raw = await Promise.race([response.text(), requestSignal.timeoutPromise]);
  } catch (error) {
    if (requestSignal.timedOut()) {
      throw (
        requestSignal.timeoutError() ??
        new Error(`模型调用超时：超过 ${settings.timeoutMs}ms。`)
      );
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }

  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message =
      typeof json === "object" &&
      json &&
      "error" in json &&
      typeof (json as { error?: { message?: unknown } }).error?.message === "string"
        ? (json as { error: { message: string } }).error.message
        : previewText(raw);
    throw new Error(`模型调用失败：HTTP ${response.status} ${message}`);
  }

  if (json == null) {
    const preview = previewText(raw);
    throw new Error(
      preview
        ? `模型返回格式不受支持：${preview}`
        : "模型返回格式不受支持。"
    );
  }

  return extractChatContent(json);
}
