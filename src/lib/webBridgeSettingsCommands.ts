import { DEFAULT_SETTINGS } from "./constants";
import { callChatModel, ensureSettingsReady, validateSettings } from "./webBridgeModelApi";
import type { AppSettings, PromptTemplateDraft, ReleaseVersionSummary } from "./types";

const PROMPT_INFERENCE_MAX_SAMPLE_CHARS = 12_000;

interface SettingsCommandDeps {
  deepClone: <T>(value: T) => T;
  getSettings: () => AppSettings;
  persistSettings: (settings: AppSettings) => void;
  setCachedSettings: (settings: AppSettings) => void;
}

export function createSettingsCommands(deps: SettingsCommandDeps) {
  async function loadSettingsCommand() {
    return deps.deepClone(deps.getSettings());
  }

  async function saveSettingsCommand(settings: AppSettings) {
    const validated = validateSettings({
      ...DEFAULT_SETTINGS,
      ...settings,
      customPrompts: Array.isArray(settings.customPrompts) ? settings.customPrompts : []
    });
    deps.setCachedSettings(deps.deepClone(validated));
    deps.persistSettings(validated);
    return deps.deepClone(validated);
  }

  async function testProviderCommand(settings: AppSettings) {
    const validated = validateSettings({
      ...DEFAULT_SETTINGS,
      ...settings,
      customPrompts: Array.isArray(settings.customPrompts) ? settings.customPrompts : []
    });
    ensureSettingsReady(validated);
    try {
      const text = await callChatModel(
        validated,
        "你是连通性探针。只回复 OK。",
        "OK",
        undefined,
        0
      );
      if (!text) {
        return { ok: false, message: "连接失败：模型返回空文本。" };
      }
      return { ok: true, message: "连接测试通过，chat/completions 可访问。" };
    } catch (error) {
      return {
        ok: false,
        message: `chat/completions 调用失败：${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
  }

  async function inferPromptTemplateCommand(
    settings: AppSettings,
    sampleText: string
  ): Promise<PromptTemplateDraft> {
    const validated = validateSettings({
      ...DEFAULT_SETTINGS,
      ...settings,
      customPrompts: Array.isArray(settings.customPrompts) ? settings.customPrompts : []
    });
    ensureSettingsReady(validated);
    const normalizedSample = normalizePromptInferenceSample(sampleText);
    const raw = await callChatModel(
      validated,
      promptInferenceSystemPrompt(),
      promptInferenceUserPrompt(normalizedSample),
      undefined,
      0.2
    );
    return parsePromptTemplateDraft(raw);
  }

  async function listReleaseVersionsCommand(): Promise<ReleaseVersionSummary[]> {
    return [];
  }

  async function switchReleaseVersionCommand() {
    throw new Error("网页版不支持应用内切换版本。");
  }

  async function installSystemPackageReleaseCommand() {
    throw new Error("网页版不支持系统安装包升级。");
  }

  return {
    loadSettingsCommand,
    saveSettingsCommand,
    testProviderCommand,
    inferPromptTemplateCommand,
    listReleaseVersionsCommand,
    switchReleaseVersionCommand,
    installSystemPackageReleaseCommand
  };
}

function normalizePromptInferenceSample(sampleText: string) {
  const trimmed = sampleText.trim();
  if (!trimmed) {
    throw new Error("请先输入用于提炼风格的示例文本。");
  }
  if (Array.from(trimmed).length < 20) {
    throw new Error("示例文本太短，至少需要 20 个字符才能提炼稳定风格。");
  }
  return Array.from(trimmed).slice(0, PROMPT_INFERENCE_MAX_SAMPLE_CHARS).join("");
}

function promptInferenceSystemPrompt() {
  return "你是提示词工程师。你的任务是从用户提供的示例文本中提炼可复用的中文改写提示词模板。只输出 JSON，不要输出 Markdown。";
}

function promptInferenceUserPrompt(sampleText: string) {
  return `请分析下面示例文本的语言风格、句式节奏、用词倾向、结构组织和表达约束，生成一个可直接用于“把任意文章改写成这种风格”的提示词模板。

要求：
1. 只返回 JSON 对象，字段为 name 和 content。
2. name 是 6-18 个中文字符，概括风格，不要包含“模板”二字。
3. content 必须是中文提示词，可以直接作为改写系统提示词使用。
4. content 要指导模型保留原文事实、数据、专有名词、引用、段落层级和格式，不得编造信息。
5. content 要提炼风格规则，不要复述示例文本的具体事实或主题。
6. content 必须包含“风格用词示例”小节，列出 6-12 个可迁移的词语、短语或句式示例，用于指导模型模仿语气；示例只能体现表达方式，不得包含示例文本中的具体事实、人物、地点、数据或主题。
7. content 要适合本项目按片段/槽位改写：只改写可编辑文本，不要求模型输出解释。

示例文本：
${sampleText}`;
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
    throw new Error("提示词提炼结果没有包含 JSON 对象。");
  }
  return unfenced.slice(start, end + 1);
}

function parsePromptTemplateDraft(raw: string): PromptTemplateDraft {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    name?: unknown;
    content?: unknown;
  };
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!name) {
    throw new Error("提示词提炼结果缺少 name 字段。");
  }
  if (!content) {
    throw new Error("提示词提炼结果缺少 content 字段。");
  }
  return {
    name: Array.from(name).slice(0, 40).join(""),
    content
  };
}
