import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assertIncludes,
  assertMatches,
  assertNotIncludes,
  read
} from "./test-helpers.mjs";

function hasRule(css, selector, property, value) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prop = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const val = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{[\\s\\S]*?${prop}\\s*:\\s*${val}\\s*;`, "m");
  return re.test(css);
}

function assertRule(css, selector, property, value) {
  assert.ok(
    hasRule(css, selector, property, value),
    `期望 CSS 存在：${selector} { ${property}: ${value}; }`
  );
}

function assertNoRule(css, selector, property, value) {
  assert.ok(
    !hasRule(css, selector, property, value),
    `期望 CSS 不存在：${selector} { ${property}: ${value}; }`
  );
}

function rewriteRelativeImports(code) {
  return code.replace(/from\s+["']((?:\.\.?\/)[^"']+)["']/g, 'from "$1.mjs"');
}

async function loadProtectedTextModule() {
  const tempRoot = join(process.cwd(), ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "lessai-protected-text-"));
  const modules = [
    ["src/lib/protectedText.tsx", "protectedText.tsx"],
    [
      "src/lib/protectedTextPlaceholderLabels.generated.ts",
      "protectedTextPlaceholderLabels.generated.ts"
    ],
    ["src/lib/markdownProtectedSegments.ts", "markdownProtectedSegments.ts"],
    ["src/lib/path.ts", "path.ts"],
    ["src/lib/protectedTextShared.ts", "protectedTextShared.ts"],
    ["src/lib/texProtectedSegments.ts", "texProtectedSegments.ts"]
  ];
  const file = join(dir, "protectedText.mjs");

  try {
    for (const [path, fileName] of modules) {
      const source = read(path);
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        },
        fileName
      }).outputText;
      const rewritten = rewriteRelativeImports(transpiled);
      writeFileSync(join(dir, fileName.replace(/\.(ts|tsx)$/, ".mjs")), rewritten, "utf8");
    }
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadReviewSuggestionRowModel() {
  const tempRoot = join(process.cwd(), ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "lessai-review-row-model-"));

  try {
    const source = read("src/stages/workbench/review/reviewSuggestionRowModel.ts");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022
      },
      fileName: "reviewSuggestionRowModel.ts"
    }).outputText;
    const rewritten = rewriteRelativeImports(transpiled);
    writeFileSync(join(dir, "reviewSuggestionRowModel.mjs"), rewritten, "utf8");

    return await import(pathToFileURL(join(dir, "reviewSuggestionRowModel.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadDocumentFlowNavigationModule() {
  const tempRoot = join(process.cwd(), ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "lessai-document-flow-navigation-"));

  try {
    const source = read("src/stages/workbench/document/documentFlowNavigation.ts");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022
      },
      fileName: "documentFlowNavigation.ts"
    }).outputText;
    const rewritten = rewriteRelativeImports(transpiled);
    writeFileSync(join(dir, "documentFlowNavigation.mjs"), rewritten, "utf8");

    return await import(pathToFileURL(join(dir, "documentFlowNavigation.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadHelpersModule() {
  const tempRoot = join(process.cwd(), ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "lessai-helpers-"));
  const modules = [
    ["src/lib/helpers.ts", "helpers.ts"],
    ["src/lib/textNormalize.ts", "textNormalize.ts"],
    ["src/lib/slotText.ts", "slotText.ts"],
    ["src/lib/documentCapabilities.ts", "documentCapabilities.ts"],
    ["src/lib/path.ts", "path.ts"]
  ];

  try {
    for (const [path, fileName] of modules) {
      const source = read(path);
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022
        },
        fileName
      }).outputText;
      const rewritten = rewriteRelativeImports(transpiled);
      writeFileSync(join(dir, fileName.replace(/\.ts$/, ".mjs")), rewritten, "utf8");
    }

    return await import(pathToFileURL(join(dir, "helpers.mjs")).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const part01 = read("src/styles/part-01.css");
const part02 = read("src/styles/part-02.css");
const part03 = read("src/styles/part-03.css");
const part04 = read("src/styles/part-04.css");
const part06 = read("src/styles/part-06.css");
const documentActionBar = read("src/stages/workbench/document/DocumentActionBar.tsx");
const documentPanel = read("src/stages/workbench/DocumentPanel.tsx");
const documentFlow = read("src/stages/workbench/document/DocumentFlow.tsx");
const paragraphDocumentFlow = read("src/stages/workbench/document/ParagraphDocumentFlow.tsx");
const structuredSlotEditor = read("src/stages/workbench/document/StructuredSlotEditor.tsx");
const plainTextDocumentEditor = read("src/stages/workbench/document/PlainTextDocumentEditor.tsx");
const structuredSlotEditorShared = read("src/stages/workbench/document/structuredEditorShared.tsx");
const documentEditorTypes = read("src/stages/workbench/document/documentEditorTypes.ts");
const selectionDecorationOverlay = read("src/stages/workbench/document/SelectionDecorationOverlay.tsx");
const selectionDecorationHook = read("src/stages/workbench/document/useSelectionDecorationRects.ts");
const busyActionHook = read("src/hooks/useBusyAction.ts");
const workspaceBar = read("src/app/components/WorkspaceBar.tsx");
const helpersSource = read("src/lib/helpers.ts");
const webBridgeAutoJobRuntime = read("src/lib/webBridgeAutoJobRuntime.ts");
const webBridgeModelApi = read("src/lib/webBridgeModelApi.ts");
const textNormalize = read("src/lib/textNormalize.ts");
const slotText = read("src/lib/slotText.ts");
const webBridgeTextCore = read("src/lib/webBridgeTextCore.ts");
const webBridgeSessionUtils = read("src/lib/webBridgeSessionUtils.ts");
const settingsTypes = read("src/lib/types.ts");
const settingsConstants = read("src/lib/constants.ts");
const frontendDiff = read("src/lib/diff.ts");
const webBridgeSelectionText = read("src/lib/webBridgeSelectionText.ts");
const rewriteStrategyPage = read("src/components/settings/RewriteStrategyPage.tsx");
const settingsHandlers = read("src/app/hooks/useSettingsHandlers.ts");
const documentActions = read("src/app/hooks/useDocumentActions.ts");
const documentFinalizeActions = read("src/app/hooks/useDocumentFinalizeActions.ts");
const documentScrollRestore = read("src/app/hooks/useDocumentScrollRestore.ts");
const appSource = read("src/App.tsx");
const rewriteUnitSelection = read("src/lib/rewriteUnitSelection.ts");
const workbenchStage = read("src/stages/WorkbenchStage.tsx");
const reviewPanel = read("src/stages/workbench/ReviewPanel.tsx");
const reviewActionBar = read("src/stages/workbench/review/ReviewActionBar.tsx");
const reviewEmptyState = read("src/stages/workbench/review/ReviewEmptyState.tsx");
const detectionReviewPane = read("src/stages/workbench/review/DetectionReviewPane.tsx");
const suggestionReviewPane = read("src/stages/workbench/review/SuggestionReviewPane.tsx");
const reviewSuggestionRow = read("src/stages/workbench/review/ReviewSuggestionRow.tsx");
const progressiveRevealHook = read("src/stages/workbench/hooks/useProgressiveRevealCount.ts");
const useEditorHunks = read("src/stages/workbench/hooks/useEditorHunks.ts");
const useRewriteActions = read("src/app/hooks/useRewriteActions.ts");
const useEditorSelectionRewrite = read("src/app/hooks/useEditorSelectionRewrite.ts");
const editorSelectionSlotUpdates = read("src/app/hooks/editorSelectionSlotUpdates.ts");
const useSuggestionActions = read("src/app/hooks/useSuggestionActions.ts");
const editorSaveShortcut = read("src/stages/workbench/document/useEditorSaveShortcut.ts");
const rustDomainModels = read("src-tauri/src/domain/models.rs");
const rustLlmValidate = read("src-tauri/src/rewrite/llm/validate.rs");
const docxAdapterMod = read("src-tauri/src/adapters/mod.rs");
const docxXml = read("src-tauri/src/adapters/docx/xml.rs");
const docxNumbering = read("src-tauri/src/adapters/docx/numbering.rs");
const docxStyles = read("src-tauri/src/adapters/docx/styles.rs");
const markdownBlockSupport = read("src-tauri/src/adapters/markdown/block_support.rs");
const texBlockSupport = read("src-tauri/src/adapters/tex/block_support.rs");
const markdownInline = read("src-tauri/src/adapters/markdown/inline.rs");
const texCommands = read("src-tauri/src/adapters/tex/commands.rs");
const rustTextBoundaries = read("src-tauri/src/core/text_boundaries.rs");
const startLessaiBat = read("start-lessai.bat");
const buildLessaiBat = read("build-lessai.bat");
const windowsCommonBat = read("scripts/lessai-windows-common.bat");
const { renderInlineProtectedText } = await loadProtectedTextModule();
const {
  buildSuggestionRowActionState,
  buildSuggestionRowPrimaryActionLabel,
  buildSuggestionRowTitle
} = await loadReviewSuggestionRowModel();
const { shouldScrollToActiveRewriteUnit } = await loadDocumentFlowNavigationModule();
const { getSessionStats, summarizeRewriteUnitSuggestions } = await loadHelpersModule();

assertIncludes(workspaceBar, 'className="workspace-bar-status-row"');
assertIncludes(workspaceBar, 'className="workspace-bar-path-line"');
assertIncludes(workspaceBar, 'className="workspace-bar-path-text"');
assertIncludes(appSource, 'from "./lib/windowDrag"');
assertIncludes(workspaceBar, 'from "../../lib/windowDrag"');
assertIncludes(appSource, "isWindowDragExcludedTarget(event.target)");
assertIncludes(workspaceBar, "isWindowDragExcludedTarget(event.target)");
assertNotIncludes(appSource, "const WINDOW_DRAG_EXCLUDED_SELECTOR = [");
assertNotIncludes(workspaceBar, "const HEADER_DRAG_EXCLUDED_SELECTOR = [");
assert.equal(
  existsSync("src-tauri/src/editor/editor_diff.rs"),
  false,
  "孤立的后端 editor_diff.rs 不应重新出现，编辑 diff 由前端 useEditorHunks 维护"
);
assert.equal(
  existsSync("docs/images/setupui.png"),
  false,
  "setupui.png 与 settings.png 完全重复且未引用，不应重新加入仓库"
);
assertNotIncludes(
  frontendDiff,
  "buildDiffHunks(",
  "未使用的 buildDiffHunks 不应重新引入"
);
assertNotIncludes(
  frontendDiff,
  "DEFAULT_CONTEXT_CHARS",
  "buildDiffHunks 删除后不应保留孤立 hunk 上下文常量"
);
assertIncludes(
  textNormalize,
  "export function normalizeNewlines",
  "换行归一化实现应集中在 textNormalize"
);
assert.equal(
  [helpersSource, webBridgeTextCore, webBridgeSelectionText, textNormalize].filter((source) =>
    source.includes('replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n")')
  ).length,
  1,
  "前端换行归一化的正则实现应只保留一份"
);
assertIncludes(helpersSource, 'from "./textNormalize"');
assertIncludes(webBridgeTextCore, 'from "./textNormalize"');
assertIncludes(webBridgeSelectionText, 'from "./textNormalize"');
assertIncludes(
  slotText,
  "export function mergedTextFromSlots",
  "slot 文本拼接实现应集中在 slotText"
);
assertIncludes(slotText, "export function rewriteUnitSourceText");
assertIncludes(helpersSource, 'from "./slotText"');
assertIncludes(webBridgeSessionUtils, 'from "./slotText"');
assertNotIncludes(webBridgeSessionUtils, "slots.find((item) => item.id === slotId)");
assertIncludes(settingsTypes, "unitsPerBatch: number;");
assertIncludes(settingsConstants, "unitsPerBatch: 1");
assertIncludes(settingsConstants, 'baseUrl: "https://api.deepseek.com/v1"');
assertIncludes(rustDomainModels, 'base_url: "https://api.deepseek.com/v1".to_string()');
assertIncludes(settingsConstants, 'model: "deepseek-v4-flash"');
assertIncludes(rustDomainModels, 'model: "deepseek-v4-flash".to_string()');
assertIncludes(settingsConstants, "timeoutMs: 45_000");
assertIncludes(rustDomainModels, "timeout_ms: 45_000");
assertIncludes(settingsConstants, "promptPresetId: \"humanizer_zh\"");
assertIncludes(rustDomainModels, "\"humanizer_zh\".to_string()");
for (const unwantedMetaPattern of [
  "i am claude",
  "made by anthropic",
  "helpful, harmless, and honest",
  "i'm an ai assistant",
  "i am an ai assistant",
  "as an ai language model",
  "as an ai assistant",
  "happy to help you",
  "i don't have information about the specific model version",
  "i don't have information about the specific model version or id"
]) {
  assertIncludes(webBridgeSelectionText, unwantedMetaPattern);
  assertIncludes(rustLlmValidate, unwantedMetaPattern);
}
assertIncludes(
  docxXml,
  "pub(super) fn capture_subtree_events",
  "DOCX 子树捕获 helper 应集中在 xml.rs"
);
assertIncludes(
  docxXml,
  "pub(super) fn capture_subtree_events_from_slice",
  "DOCX event-slice 子树捕获 helper 也应集中在 xml.rs"
);
assertIncludes(docxNumbering, "xml::{attr_value, capture_subtree_events, local_name}");
assertIncludes(docxStyles, "use super::xml::{attr_value, capture_subtree_events, local_name};");
assertNotIncludes(docxNumbering, "fn attr_value(");
assertNotIncludes(docxStyles, "fn attr_value(");
assertIncludes(
  rustTextBoundaries,
  "pub(crate) fn split_indexed_lines_with_offsets",
  "Markdown/TeX 行切分实现应集中在 text_boundaries"
);
assertIncludes(markdownBlockSupport, "split_indexed_lines_with_offsets(text)");
assertIncludes(texBlockSupport, "split_indexed_lines_with_offsets(text)");
assertIncludes(docxAdapterMod, "pub(crate) fn into_template_region");
assertNotIncludes(markdownInline, "fn build_region(");
assertNotIncludes(texCommands, "fn build_region(");
assertIncludes(editorSaveShortcut, "export function useEditorSaveShortcut");
assertIncludes(plainTextDocumentEditor, "useEditorSaveShortcut({ busy, dirty, onSave });");
assertIncludes(structuredSlotEditor, "useEditorSaveShortcut({ busy, dirty, onSave });");
assertIncludes(selectionDecorationHook, "export function useSelectionDecorationRects");
assertIncludes(documentFlow, "rootRef: flowRootRef");
assertIncludes(documentFlow, "resolveRange: resolveSelectionDecorationRange");
assertIncludes(plainTextDocumentEditor, "useSelectionDecorationRects({");
assertIncludes(structuredSlotEditor, "useSelectionDecorationRects({");
assertNotIncludes(documentFlow, 'document.addEventListener("selectionchange"');
assertNotIncludes(plainTextDocumentEditor, 'document.addEventListener("selectionchange"');
assertNotIncludes(structuredSlotEditor, 'document.addEventListener("selectionchange"');
assertIncludes(selectionDecorationHook, "cancelAnimationFrame(frameRef.current)");
assertIncludes(busyActionHook, "Promise.resolve().then(operation)");
assertIncludes(webBridgeAutoJobRuntime, "function isCurrentJob");
assertIncludes(webBridgeAutoJobRuntime, "deps.autoJobs.get(sessionId) === job");
assertIncludes(webBridgeAutoJobRuntime, "stopCurrentJob(sessionId, job)");
assertIncludes(webBridgeAutoJobRuntime, "if (!activeSession || !isCurrentJob(sessionId, job))");
assertIncludes(webBridgeModelApi, "function createModelRequestSignal");
assertIncludes(webBridgeModelApi, "settings.timeoutMs");
assertIncludes(webBridgeModelApi, "if (json == null)");
assertIncludes(startLessaiBat, 'call "scripts\\lessai-windows-common.bat" ensure_deps');
assertIncludes(buildLessaiBat, 'call "scripts\\lessai-windows-common.bat" ensure_deps');
assertIncludes(windowsCommonBat, ":ensure_deps");
assertIncludes(rewriteStrategyPage, "单批处理单元数");
assertIncludes(rewriteStrategyPage, 'onUpdateNumberSetting("unitsPerBatch", event.target.value)');
assertIncludes(settingsHandlers, '"unitsPerBatch"');
assertNotIncludes(workspaceBar, 'className="workspace-bar-session"');
assertNotIncludes(workspaceBar, "title={rawTitle}");
assertNotIncludes(workspaceBar, 'className="workspace-bar-session-text"');
assertNotIncludes(workspaceBar, "workspace-bar-path-chip");
assertNotIncludes(workspaceBar, "formatTopbarTitle");
assertNotIncludes(workspaceBar, "formatTopbarPath");
assertRule(part02, ".workspace-bar-status-row", "display", "flex");
assertRule(part02, ".workspace-bar-path-line", "display", "flex");
assertRule(part02, ".workspace-bar-path-text", "text-overflow", "ellipsis");
assertRule(part03, ".status-badge", "white-space", "nowrap");
assertRule(
  part04,
  ".structured-editor-slot.is-editable.is-underline:focus",
  "text-decoration",
  "none"
);
assertRule(
  part04,
  ".structured-editor-slot.is-editable.is-link:focus",
  "text-decoration",
  "none"
);
assertRule(part04, ".review-suggestion-row-mainline .status-badge", "flex", "0 0 auto");
assertNotIncludes(
  paragraphDocumentFlow,
  "[activeChunkIndex, groups, sessionId]",
  "写回刷新 session 时，不应因为 groups/sessionId 变化再次自动滚动到激活块"
);
assertNotIncludes(
  structuredSlotEditor,
  "chunkNodesRef.current[firstEditable.index]?.focus();\n    }, [session.chunks]);",
  "结构化编辑器写回后不应因为旧 chunks 语义再次聚焦首个可编辑块"
);
assertIncludes(
  structuredSlotEditor,
  "visibleRewriteUnits.map((rewriteUnit) => (",
  "结构化编辑页应与主页面一致，按 rewrite unit 作为展示分组骨架"
);
assertIncludes(
  structuredSlotEditor,
  "session.rewriteUnits.slice(0, renderedUnitCount)",
  "结构化编辑页应只遍历当前可见 rewrite unit，避免大文档渐进渲染时全量扫描"
);
assertIncludes(
  structuredSlotEditor,
  "useProgressiveRevealCount({",
  "结构化编辑器应启用渐进渲染，避免大文档首帧卡顿"
);
assertNotIncludes(
  structuredSlotEditor,
  "session.writebackSlots.map((slot) => {",
  "结构化编辑页不应再按 writeback slot 平铺渲染，避免与主页面分块不一致"
);
assertIncludes(
  documentEditorTypes,
  "slotStartOffsets: number[];",
  "结构化编辑器跨槽位选区应记录每个槽位内的真实起点"
);
assertIncludes(
  documentEditorTypes,
  "slotEndOffsets: number[];",
  "结构化编辑器跨槽位选区应记录每个槽位内的真实终点"
);
assertIncludes(
  structuredSlotEditor,
  "selectionStartOffset - nodeStartOffset",
  "结构化编辑器应按编辑器全文坐标与槽位坐标求交，避免 DOM 边界误判"
);
assertIncludes(
  structuredSlotEditor,
  "if (endOffset <= startOffset) return null;",
  "结构化编辑器不应把只贴到选区边界的槽位算进 AI 处理范围"
);
assertNotIncludes(
  structuredSlotEditor,
  "range.intersectsNode(node)",
  "结构化编辑器选区范围不应再依赖 DOM intersectsNode，避免边界外槽位被误算"
);
assertIncludes(
  structuredSlotEditor,
  "contentEditable={!busy}",
  "结构化编辑器应使用单一父级编辑宿主，允许浏览器跨槽位拖选"
);
assertNotIncludes(
  structuredSlotEditorShared,
  "contentEditable={!busy}",
  "结构化编辑器不应让每个槽位成为独立编辑宿主，否则无法跨句选择"
);
assertIncludes(
  structuredSlotEditor,
  "slotStartOffsets: slotInfos.map((s) => s.startOffset)",
  "结构化编辑器跨槽位快照不应退化为整槽位"
);
assertIncludes(
  useEditorSelectionRewrite,
  "buildSelectionSlotInputs(snapshot)",
  "编辑选区改写应只提交真实选区文本，而不是完整槽位文本"
);
assertNotIncludes(
  useEditorSelectionRewrite,
  "text: snapshot.slotFullTexts[i]",
  "编辑选区改写不应把跨槽位快照的完整槽位文本发给模型"
);
assertIncludes(
  editorSelectionSlotUpdates,
  "spliceSelection(currentText, range, replacement)",
  "编辑选区改写结果应拼回原槽位局部位置，而不是覆盖整个槽位"
);
assertIncludes(
  part01,
  "--selection-bg:",
  "亮色主题应提供原生文本选区色变量"
);
assertIncludes(
  part06,
  "--selection-bg:",
  "暗色主题应覆盖原生文本选区色变量"
);
assertIncludes(
  part01,
  "--editor-selection-bg:",
  "亮色主题应提供编辑器专用选区背景变量"
);
assertIncludes(
  part06,
  "--editor-selection-bg:",
  "暗色主题应覆盖编辑器专用选区背景变量"
);
assertIncludes(
  part01,
  "--editor-selection-border:",
  "亮色主题应提供编辑器选区边框变量"
);
assertIncludes(
  part06,
  "--editor-selection-border:",
  "暗色主题应覆盖编辑器选区边框变量"
);
assertIncludes(
  part01,
  "--editor-selection-bg: transparent;",
  "亮色主题编辑器选区应去掉填充底色，仅保留边框装饰"
);
assertIncludes(
  part06,
  "--editor-selection-bg: transparent;",
  "暗色主题编辑器选区应去掉填充底色，仅保留边框装饰"
);
assertIncludes(
  documentFlow,
  "<SelectionDecorationOverlay rects={selectionDecorationRects} />",
  "非编辑 AI 改写模式的真实文本选区应复用编辑器选区装饰层"
);
assertIncludes(
  documentFlow,
  "onDoubleClick={scheduleSelectionStateSync}",
  "非编辑 AI 改写模式双击选中文本后应刷新选区装饰层"
);
assertIncludes(
  part04,
  ".document-flow *::selection",
  "非编辑 AI 改写模式真实文本选区应使用透明原生选区并由 overlay 绘制"
);
assertIncludes(
  part04,
  ".document-flow-selection-shell",
  "非编辑 AI 改写模式选区 overlay 不应继承编辑器 min-height"
);
assertIncludes(
  part04,
  ".workbench-editor-editable *::selection",
  "编辑器内部槽位文本应使用主题化选区样式"
);
assertIncludes(
  part04,
  ".workbench-editor-selection-shape",
  "编辑器应使用独立 SVG path 装饰层绘制选区边框和光晕"
);
assertIncludes(
  selectionDecorationOverlay,
  "range.getClientRects()",
  "选区装饰层应基于真实 Range 矩形计算选区范围"
);
assertIncludes(
  selectionDecorationOverlay,
  "mergeLineRects(rects)",
  "选区装饰层应先按视觉行合并 Range 矩形"
);
assertIncludes(
  selectionDecorationOverlay,
  "normalizeLineRectsForOutline(rects)",
  "选区装饰层应在视觉层桥接相邻行，避免每行一个独立框"
);
assertIncludes(
  selectionDecorationOverlay,
  "horizontalOverlap(current, next)",
  "跨行选区只应在相邻行水平重叠时桥接，避免外框覆盖无关文本"
);
assertIncludes(
  selectionDecorationOverlay,
  "buildSelectionOutlinePath(rects)",
  "选区装饰层应基于矩形并集绘制完整外轮廓"
);
assertIncludes(
  selectionDecorationOverlay,
  "<path",
  "选区装饰层应绘制正交外轮廓 path，而不是每行独立矩形框"
);
assertNotIncludes(
  selectionDecorationOverlay,
  "buildConnectedSelectionPath",
  "跨行选区不应再用单个 path 连接相邻行，避免错位折线"
);
assertIncludes(
  structuredSlotEditor,
  "<SelectionDecorationOverlay rects={selectionDecorationRects} />",
  "结构化编辑器应渲染选区装饰层"
);
assertIncludes(
  plainTextDocumentEditor,
  "<SelectionDecorationOverlay rects={selectionDecorationRects} />",
  "纯文本编辑器也应渲染选区装饰层"
);
assertIncludes(
  useEditorSelectionRewrite,
  "selectionRanges: resolved.selectionRanges",
  "编辑选区 AI 改写后应重新选中实际替换后的区域"
);
assertIncludes(
  documentPanel,
  "const rewriteSelectionDisabled = !editorMode || !canRewriteSelection || anyBusy;",
  "编辑模式选区优化按钮应仅在存在正文选区时可点击"
);
assertIncludes(
  structuredSlotEditor,
  "onPointerUp={scheduleSelectionStateSync}",
  "结构化编辑器应在拖选结束后主动同步选区状态，不能只依赖 selectionchange"
);
assertIncludes(
  structuredSlotEditor,
  "onSelect={scheduleSelectionStateSync}",
  "结构化编辑器应监听内容选中事件来刷新选区按钮启用态"
);
assertIncludes(
  structuredSlotEditor,
  "setEditorSelectionAvailable(false)",
  "编辑器内部新点击应立即清空旧选区启用态"
);
assertIncludes(
  documentActionBar,
  "event.preventDefault();",
  "点击选区优化按钮时不应抢走编辑器焦点并清空原生选区"
);
assertIncludes(
  structuredSlotEditor,
  "restoreSlotSelection(slotNodesRef.current, options.selectionRanges)",
  "结构化编辑器应按替换后的新文本长度恢复选区"
);
assertIncludes(
  structuredSlotEditor,
  "return lastSnapshotRef.current;",
  "点击选区优化按钮时应回退到最近一次真实选区缓存，不应因等待时间失效"
);
assertIncludes(
  structuredSlotEditor,
  "clearSnapshotOnCollapsedSelectionRef.current &&",
  "工具栏点击造成的折叠选区不应清掉真实选区缓存"
);
assertIncludes(
  structuredSlotEditor,
  "onPointerDown={markSelectionCacheClearOnEditorIntent}",
  "只有编辑器内交互才应主动使旧选区缓存失效"
);
assertNotIncludes(
  structuredSlotEditor,
  "buildRewriteUnitSnapshot",
  "选区优化不应在选区丢失或光标折叠时回退为整分块优化"
);
assertIncludes(
  useEditorHunks,
  "for (const rewriteUnit of currentSession.rewriteUnits)",
  "槽位编辑模式的 diff 应按 rewrite unit 分块展示，而不是按单个 slot 展示"
);
assertIncludes(
  useEditorHunks,
  "id: `rewrite-unit-${rewriteUnit.id}`",
  "槽位编辑模式的 diff hunk id 应沿用 rewrite unit 粒度"
);
assertNotIncludes(
  useEditorHunks,
  "id: `slot-${slot.id}`",
  "槽位编辑模式不应生成单槽位 diff hunk"
);
assertIncludes(
  paragraphDocumentFlow,
  "useProgressiveRevealCount({",
  "正文流应启用渐进渲染，避免大文档切换模式时阻塞"
);
assertNotIncludes(
  documentActions,
  "applySessionState(updated, selectDefaultChunkIndex(updated));",
  "编辑保存后应保留当前激活块，而不是重置到默认块"
);
assertIncludes(documentScrollRestore, "export function useDocumentScrollRestore()");
assertIncludes(documentScrollRestore, "const documentScrollRef = useRef<HTMLDivElement | null>(null);");
assertIncludes(
  documentScrollRestore,
  "const pendingRestoreRef = useRef<ScrollRestoreProgress | null>(null);"
);
assertIncludes(documentScrollRestore, "node.scrollTop = pending.targetScrollTop;");
assertIncludes(documentPanel, "documentScrollRef: MutableRefObject<HTMLDivElement | null>;");
assertIncludes(documentPanel, "const flowScrollRef = useRef<HTMLDivElement | null>(null);");
assertIncludes(documentPanel, "const editorScrollRef = useRef<HTMLDivElement | null>(null);");
assertIncludes(
  documentPanel,
  "documentScrollRef.current = editorMode ? editorScrollRef.current : flowScrollRef.current;"
);
assertIncludes(documentPanel, 'className="paper-content workbench-mode-host"');
assertIncludes(documentPanel, 'className="workbench-mode-content workbench-doc-mode-content"');
assertIncludes(documentActions, "captureDocumentScrollPosition: () => number | null;");
assertIncludes(documentActions, "const preservedScrollTop = captureDocumentScrollPosition();");
assertIncludes(documentActions, "runSessionActionWithScroll({");
assertIncludes(documentFinalizeActions, "captureDocumentScrollPosition: () => number | null;");
assertIncludes(documentFinalizeActions, "const preservedScrollTop = captureDocumentScrollPosition();");
assertIncludes(documentFinalizeActions, "restoreLoadedSessionWithScroll({");
assertIncludes(appSource, 'import { useDocumentScrollRestore } from "./app/hooks/useDocumentScrollRestore";');
assertIncludes(appSource, "const { documentScrollRef, captureDocumentScrollPosition, restoreDocumentScrollPosition } =");
assertIncludes(reviewPanel, 'title="审阅"');
assertIncludes(reviewPanel, 'AI 检测');
assertIncludes(reviewPanel, "reviewPane === \"detection\"");
assertIncludes(detectionReviewPane, "export const DetectionReviewPane");
assertIncludes(detectionReviewPane, "检测全文");
assertIncludes(detectionReviewPane, "检测选区");
assertIncludes(suggestionReviewPane, 'className="review-summary-strip"');
assertNotIncludes(suggestionReviewPane, '当前 #{');
assertIncludes(suggestionReviewPane, "待处理：{currentStats.unitsProposed}");
assertNotIncludes(suggestionReviewPane, "待审阅：{currentStats.unitsProposed}");
assertNotIncludes(suggestionReviewPane, "待审阅：{currentStats.suggestionsProposed}");
assertIncludes(suggestionReviewPane, "<ReviewSuggestionRow");
assertIncludes(
  suggestionReviewPane,
  "useProgressiveRevealCount({",
  "建议列表应启用渐进渲染，降低大列表一次性渲染开销"
);
assertNotIncludes(reviewSuggestionRow, "StatusBadge");
assertIncludes(reviewSuggestionRow, "buildSuggestionRowPrimaryActionLabel(suggestion.decision)");
assertIncludes(reviewSuggestionRow, '`is-${suggestion.decision}`');
assertIncludes(reviewSuggestionRow, 'className="review-suggestion-row-state-dot"');
assertIncludes(reviewSuggestionRow, '<span>删除</span>');
assertIncludes(reviewSuggestionRow, '<span>···</span>');
assertRule(part04, ".review-suggestion-row.is-proposed", "border-color", "rgba(239, 193, 34, 0.28)");
assertRule(part04, ".review-suggestion-row.is-applied", "border-color", "rgba(31, 122, 60, 0.24)");
assertRule(part04, ".review-suggestion-row.is-dismissed", "border-color", "rgba(20, 20, 20, 0.12)");
assertRule(part04, ".review-suggestion-row-state-dot", "width", "8px");
assertNotIncludes(suggestionReviewPane, 'className="diff-view"');
assertNotIncludes(workbenchStage, "reviewView");
assertNotIncludes(reviewPanel, "reviewView");
assertNotIncludes(reviewActionBar, "reviewView");
assertNotIncludes(appSource, "reviewView");
assertNotIncludes(useRewriteActions, "setReviewView");
assertNotIncludes(useSuggestionActions, "setReviewView");
assertNotIncludes(useRewriteActions, "修改对");
assertNotIncludes(reviewEmptyState, 'label="打开文件"');
assertNotIncludes(reviewEmptyState, "审阅区会展示");
assertIncludes(reviewEmptyState, "这里会展示建议与候选稿");
assertIncludes(rewriteUnitSelection, "normalizeSelectedRewriteUnitIds");
assertIncludes(rewriteUnitSelection, "resolveOptimisticManualRunningRewriteUnitId");
assertIncludes(documentFinalizeActions, "stats.unitsProposed > 0");
assertIncludes(documentFinalizeActions, "仍有 ${stats.unitsProposed} 段待处理");
assertIncludes(documentFinalizeActions, "待处理：${stats.unitsProposed}（会一起删除）");
assertIncludes(documentFinalizeActions, "待处理：0");
assertNotIncludes(documentFinalizeActions, "stats.suggestionsProposed > 0");
assertNotIncludes(documentFinalizeActions, "待审阅");
assertNotIncludes(documentPanel, "右侧审阅");
assertNotIncludes(useRewriteActions, "请在右侧审阅");
assertNotIncludes(documentFlow, "审阅最小单元");
assertNotIncludes(settingsHandlers, "审阅");
assertIncludes(
  progressiveRevealHook,
  "export function useProgressiveRevealCount(options: UseProgressiveRevealCountOptions)",
  "应提供通用渐进渲染 hook 作为性能优化基线"
);

const sampleSuggestion = {
  id: "sg-1",
  sequence: 12,
  rewriteUnitId: "unit-1",
  beforeText: "手工统计问卷结果",
  afterText: "自动汇总问卷结果，压缩后半句长度",
  diffSpans: [],
  decision: "applied",
  slotUpdates: [],
  createdAt: "2026-04-18T10:42:00.000Z",
  updatedAt: "2026-04-18T10:42:00.000Z"
};

assert.equal(
  buildSuggestionRowTitle(sampleSuggestion, 40),
  "#12 自动汇总问卷结果，压缩后半句长度"
);

assert.equal(buildSuggestionRowPrimaryActionLabel("proposed"), "应用");
assert.equal(buildSuggestionRowPrimaryActionLabel("applied"), "忽略");
assert.equal(buildSuggestionRowPrimaryActionLabel("dismissed"), "应用");
assertIncludes(
  reviewSuggestionRow,
  'const showMenu = actionState.retryVisible;'
);
assertIncludes(reviewSuggestionRow, 'suggestion.decision === "applied"');
assertIncludes(reviewSuggestionRow, "onClick: onApply");

assert.deepEqual(
  buildSuggestionRowActionState({
    suggestionId: "sg-1",
    decision: "applied",
    busyAction: null,
    anyBusy: false,
    editorMode: false,
    rewriteRunning: false,
    rewritePaused: false,
    settingsReady: true,
    rewriteUnitFailed: true
  }),
  {
    applyBusy: false,
    applyDisabled: true,
    deleteBusy: false,
    deleteDisabled: false,
    dismissBusy: false,
    dismissDisabled: false,
    retryBusy: false,
    retryDisabled: false,
    retryVisible: true
  }
);

const mixedUnitSuggestions = [
  {
    id: "sg-applied",
    sequence: 1,
    rewriteUnitId: "unit-1",
    beforeText: "原文一",
    afterText: "已应用版本",
    diffSpans: [],
    decision: "applied",
    slotUpdates: [],
    createdAt: "2026-04-18T10:40:00.000Z",
    updatedAt: "2026-04-18T10:40:00.000Z"
  },
  {
    id: "sg-proposed-after-applied",
    sequence: 2,
    rewriteUnitId: "unit-1",
    beforeText: "原文一",
    afterText: "新的待审阅版本",
    diffSpans: [],
    decision: "proposed",
    slotUpdates: [],
    createdAt: "2026-04-18T10:41:00.000Z",
    updatedAt: "2026-04-18T10:41:00.000Z"
  }
];

const mixedSummary = summarizeRewriteUnitSuggestions(mixedUnitSuggestions);
assert.equal(Boolean(mixedSummary.applied), true);
assert.equal(Boolean(mixedSummary.proposed), true);

const sessionStats = getSessionStats({
  id: "session-1",
  title: "demo",
  documentPath: "demo.docx",
  sourceText: "原文一原文二",
  sourceSnapshot: null,
  normalizedText: "原文一原文二",
  writeBackSupported: true,
  writeBackBlockReason: null,
  plainTextEditorSafe: true,
  plainTextEditorBlockReason: null,
  segmentationPreset: "paragraph",
  rewriteHeadings: false,
  writebackSlots: [],
  rewriteUnits: [
    {
      id: "unit-1",
      order: 0,
      slotIds: [],
      displayText: "原文一",
      segmentationPreset: "paragraph",
      status: "done",
      errorMessage: null
    },
    {
      id: "unit-2",
      order: 1,
      slotIds: [],
      displayText: "原文二",
      segmentationPreset: "paragraph",
      status: "done",
      errorMessage: null
    }
  ],
  suggestions: [
    ...mixedUnitSuggestions,
    {
      id: "sg-proposed",
      sequence: 3,
      rewriteUnitId: "unit-2",
      beforeText: "原文二",
      afterText: "待审阅版本",
      diffSpans: [],
      decision: "proposed",
      slotUpdates: [],
      createdAt: "2026-04-18T10:42:00.000Z",
      updatedAt: "2026-04-18T10:42:00.000Z"
    }
  ],
  nextSuggestionSequence: 4,
  status: "idle",
  createdAt: "2026-04-18T10:39:00.000Z",
  updatedAt: "2026-04-18T10:42:00.000Z"
});

assert.equal(sessionStats.unitsApplied, 1);
assert.equal(
  sessionStats.unitsProposed,
  1,
  "存在已应用 suggestion 的块，不应再同时计入待审阅块"
);

assert.deepEqual(
  buildSuggestionRowActionState({
    suggestionId: "sg-1",
    decision: "dismissed",
    busyAction: null,
    anyBusy: false,
    editorMode: false,
    rewriteRunning: false,
    rewritePaused: false,
    settingsReady: true,
    rewriteUnitFailed: false
  }),
  {
    applyBusy: false,
    applyDisabled: false,
    deleteBusy: false,
    deleteDisabled: false,
    dismissBusy: false,
    dismissDisabled: true,
    retryBusy: false,
    retryDisabled: true,
    retryVisible: false
  }
);

assert.equal(
  shouldScrollToActiveRewriteUnit(
    {
      sessionId: "session-1",
      rewriteUnitId: "unit-1",
      suggestionId: "suggestion-1",
      navigationRequestId: 1
    },
    {
      sessionId: "session-1",
      rewriteUnitId: "unit-1",
      suggestionId: "suggestion-2",
      navigationRequestId: 2
    }
  ),
  true,
  "同一 rewrite unit 下切换 suggestion 时，也应重新定位到左侧正文位置"
);

assert.equal(
  shouldScrollToActiveRewriteUnit(
    {
      sessionId: "session-1",
      rewriteUnitId: "unit-1",
      suggestionId: "suggestion-2",
      navigationRequestId: 2
    },
    {
      sessionId: "session-1",
      rewriteUnitId: "unit-1",
      suggestionId: "suggestion-2",
      navigationRequestId: 3
    }
  ),
  true,
  "即使目标未变化，只要用户再次显式点击定位，也应重新滚动到正文位置"
);

function renderTexMarkup(text) {
  return renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderInlineProtectedText(text, "tex", "ui-regression")
    )
  );
}

function renderMarkdownMarkup(text) {
  return renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderInlineProtectedText(text, "markdown", "ui-regression")
    )
  );
}

function renderPdfMarkup(text, slot = null) {
  return renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderInlineProtectedText(text, "pdf", "ui-regression", { slot })
    )
  );
}

// 1) 审阅区动作按钮不应依赖横向滚动（避免“左滑右滑”）
assertNoRule(
  part02,
  ".workbench-review-panel .workbench-review-actionbar-buttons",
  "overflow-x",
  "auto"
);

// 2) 审阅视图切换条不应依赖横向滚动（按钮应固定在一个位置）
assertNoRule(part04, ".review-switches", "overflow-x", "auto");

// 3) 文档面板 header 的 action 区域应保持固定宽度，避免动作栏在切换时被压缩裁切
assertRule(part02, ".workbench-doc-panel .panel-action", "flex", "0 0 auto");

// 4) “已选 N 段”不能继续占用顶部 action bar
assertNotIncludes(documentActionBar, "已选 {selectedChunkCount} 段");

// 5) “已选 N 段”不能塞进面板副标题
assertNotIncludes(documentPanel, "已选 ${selectedChunkIndices.length} 段");

// 6) “已选 N 段”应显示在内容区状态条
assertIncludes(documentFlow, "document-flow-status");

// 7) 选择状态条必须是内容区右上角浮层，不能参与正常文档流
assertRule(part04, ".document-flow-wrap", "position", "relative");
assertRule(part04, ".document-flow-status", "position", "absolute");
assertRule(part04, ".document-flow-status", "top", "0");
assertRule(part04, ".document-flow-status", "right", "0");

// 8) 文案切换时，“处理所选 / 开始批处理 / 暂停 / 继续”主按钮不能改变整排布局
// 使用统一变量，避免按钮宽度策略调整后与测试断言漂移。
assertRule(part02, ".workbench-doc-actionbar-right .toolbar-button.is-run-action", "inline-size", "var(--doc-action-primary-width)");
assertRule(part02, ".workbench-doc-actionbar-right .toolbar-button.is-run-action", "min-width", "var(--doc-action-primary-width)");

// 9) TeX 的 \\texttt{...} 应被标成单个保护区
const textttMarkup = renderTexMarkup(
  "还包含一段命令 token: \\texttt{cargo fmt --check}。"
);
assertMatches(
  textttMarkup,
  /<span[^>]*class="inline-protected"[^>]*>\\texttt\{cargo fmt --check\}<\/span>/,
  "期望 \\texttt{...} 被渲染为单个保护区"
);

// 10) TeX 的 \\href{...}{...} 应整体标成保护区
const hrefMarkup = renderTexMarkup(
  "这段里还有一个链接：\\href{https://example.com/docs}{https://example.com/docs}。"
);
assertMatches(
  hrefMarkup,
  /<span[^>]*class="inline-protected"[^>]*>\\href\{https:\/\/example\.com\/docs\}\{https:\/\/example\.com\/docs\}<\/span>/,
  "期望 \\href{...}{...} 被整体渲染为保护区"
);

// 11) 可改写文本命令不应把正文参数整段锁死，只高亮命令壳
const textbfMarkup = renderTexMarkup("这是 \\textbf{很重要} 的句子。");
assertMatches(
  textbfMarkup,
  /\\textbf\{<\/span>很重要<span[^>]*class="inline-protected"[^>]*>\}<\/span>/,
  "期望 \\textbf{...} 只高亮命令语法，不锁死正文参数"
);

// 12) Markdown 裸 URL 遇到中文全角标点时，保护区必须只覆盖 URL 本体
const markdownBareUrlMarkup = renderMarkdownMarkup(
  "裸地址 https://example.com/report/final；后面的中文正文不应被一起判成保护区。"
);
assertMatches(
  markdownBareUrlMarkup,
  /<span[^>]*class="inline-protected"[^>]*>https:\/\/example\.com\/report\/final<\/span>；后面的中文正文/,
  "期望 Markdown 裸 URL 在中文全角标点前正确收口"
);

// 13) PDF 占位符文本在无 slot 上下文时也应能高亮
const pdfPlaceholderMarkup = renderPdfMarkup("正文[链接]后文");
assertMatches(
  pdfPlaceholderMarkup,
  /正文<span[^>]*class="inline-protected"[^>]*>\[链接\]<\/span>后文/,
  "期望 PDF 占位符在无 slot 上下文时也能高亮"
);

// 14) PDF slot 携带 protectKind 时，应优先按 slot 保护区渲染
const pdfSlotProtectedMarkup = renderPdfMarkup("[图形]", {
  presentation: { protectKind: "pdf-graphics" }
});
assertMatches(
  pdfSlotProtectedMarkup,
  /<span[^>]*class="inline-protected"[^>]*data-protect-kind="pdf-graphics"[^>]*>\[图形\]<\/span>/,
  "期望 PDF protectKind 来自 slot.presentation，且渲染标记一致"
);

console.log("[ui-regression] OK");
