import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
const tauriBundlesWorkflowPath = resolve(root, ".github/workflows/tauri-bundles.yml");
const appImagePatchPath = resolve(root, "scripts/patch-linux-appimage.sh");
const linuxDepsPath = resolve(root, "scripts/install-tauri-linux-deps.sh");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const tauriBundlesWorkflow = readFileSync(tauriBundlesWorkflowPath, "utf8");
const appImagePatch = readFileSync(appImagePatchPath, "utf8");
const linuxDeps = readFileSync(linuxDepsPath, "utf8");

assert.ok(Array.isArray(tauriConfig.bundle?.icon), "bundle.icon 必须为数组");
assert.ok(tauriConfig.bundle.icon.length > 0, "bundle.icon 不能为空");

for (const relativePath of tauriConfig.bundle.icon) {
  const absolutePath = resolve(root, "src-tauri", relativePath);
  assert.ok(existsSync(absolutePath), `打包图标不存在：${relativePath}`);
}

const windowsBundle = tauriConfig.bundle?.windows;
assert.ok(windowsBundle, "必须配置 bundle.windows");

const nsis = windowsBundle?.nsis ?? tauriConfig.bundle?.nsis;
assert.ok(nsis, "必须配置 bundle.nsis");
for (const key of ["installerIcon", "headerImage", "sidebarImage"]) {
  assert.equal(typeof nsis[key], "string", `nsis.${key} 必须为字符串`);
  assert.notEqual(nsis[key].trim(), "", `nsis.${key} 不能为空`);

  const assetPath = resolve(root, "src-tauri", nsis[key]);
  assert.ok(existsSync(assetPath), `NSIS 资源不存在：${nsis[key]}`);
}

const wix = windowsBundle?.wix;
assert.ok(wix, "必须配置 bundle.windows.wix");
for (const key of ["bannerPath", "dialogImagePath"]) {
  assert.equal(typeof wix[key], "string", `wix.${key} 必须为字符串`);
  assert.notEqual(wix[key].trim(), "", `wix.${key} 不能为空`);

  const assetPath = resolve(root, "src-tauri", wix[key]);
  assert.ok(existsSync(assetPath), `WiX 资源不存在：${wix[key]}`);
}

assert.ok(
  tauriBundlesWorkflow.includes("## 文档兼容边界（重要）"),
  "发布流程必须在 Release 说明中包含文档兼容边界提示"
);
assert.ok(
  tauriBundlesWorkflow.includes("DOCX / PDF 当前采用“安全优先”的原文件写回策略。"),
  "发布流程缺少 DOCX/PDF 安全优先写回口径"
);
assert.ok(
  tauriBundlesWorkflow.includes("Report updater signing mode (tag release)"),
  "发布流程应在缺少 updater key 时报告降级模式"
);
assert.ok(
  tauriBundlesWorkflow.includes("manual-download only"),
  "缺少 updater key 的发布应降级为仅手动下载"
);
assert.ok(
  tauriBundlesWorkflow.includes("skipping latest.json and signed system-package manifests"),
  "缺少 updater key 时应跳过 latest.json 和系统包签名清单"
);
assert.ok(
  tauriBundlesWorkflow.includes("若本 Release 未包含 `latest.json`"),
  "Release 说明应提示无 latest.json 时仅支持手动下载安装"
);
assert.ok(
  !tauriBundlesWorkflow.includes("[ERROR] Missing updater signing key secrets."),
  "缺少 updater key 不应再导致 tag release 直接失败"
);

for (const expected of [
  "libgstapp.so",
  "gst-plugin-scanner",
  "GST_PLUGIN_SYSTEM_PATH_1_0",
  "GST_PLUGIN_SCANNER_1_0"
]) {
  assert.ok(appImagePatch.includes(expected), `AppImage 补丁缺少 GStreamer 配置：${expected}`);
}

for (const expected of ["GStreamer", "appsink", "gst-plugin-scanner", "libgstapp"]) {
  assert.ok(
    tauriBundlesWorkflow.includes(expected),
    `AppImage smoke test 缺少 GStreamer 致命特征匹配：${expected}`
  );
}

for (const expected of ["gstreamer1.0-plugins-base", "gstreamer1.0-tools"]) {
  assert.ok(linuxDeps.includes(expected), `Linux 打包依赖缺少 GStreamer 包：${expected}`);
}

assert.ok(
  !appImagePatch.includes('LESSAI_LINUX_GRAPHICS_MODE="${LESSAI_LINUX_GRAPHICS_MODE:-safe}"'),
  "AppImage 不应默认启用 safe 图形模式，否则会强制 CPU 软件渲染导致严重卡顿"
);
assert.ok(
  appImagePatch.includes('LESSAI_LINUX_GRAPHICS_MODE="${LESSAI_LINUX_GRAPHICS_MODE:-auto}"'),
  "AppImage 应默认启用 auto 图形模式，兼顾渲染兼容与 GPU 路径"
);
assert.ok(
  appImagePatch.includes("Safe mode forces") &&
    appImagePatch.includes("should only be opt-in"),
  "AppImage safe 图形模式应只作为显式故障规避选项，不能默认启用"
);
assert.ok(
  appImagePatch.includes("LESSAI_LINUX_GRAPHICS_MODE=safe ./LessAI_*.AppImage"),
  "AppImage 应保留 safe 图形模式的显式启用说明"
);
assert.ok(
  appImagePatch.includes("LESSAI_LINUX_GRAPHICS_MODE=${LESSAI_LINUX_GRAPHICS_MODE:-<auto-default>}"),
  "AppImage debug 输出应显示实际图形模式，便于定位渲染降级"
);

console.log("[packaging-regression] OK");
