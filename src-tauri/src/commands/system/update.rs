use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use reqwest::{
    header::{ACCEPT, USER_AGENT},
    Client, Proxy, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{utils::config::BundleType, utils::platform::bundle_type, AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::network_proxy::normalize_proxy_url;
use crate::storage;

const GITHUB_RELEASES_API_URL: &str =
    "https://api.github.com/repos/GTJasonMK/lessAI/releases?per_page=50";
const GITHUB_RELEASE_BY_TAG_API_URL_TEMPLATE: &str =
    "https://api.github.com/repos/GTJasonMK/lessAI/releases/tags/{tag}";
const RELEASE_MANIFEST_URL_TEMPLATE: &str =
    "https://github.com/GTJasonMK/lessAI/releases/download/{tag}/latest.json";
const SYSTEM_PACKAGE_MANIFEST_ASSET_NAME: &str = "system-packages.json";
const SYSTEM_PACKAGE_MANIFEST_SIGNATURE_ASSET_NAME: &str = "system-packages.json.sig";
const RELEASES_USER_AGENT: &str = "LessAI-VersionManager/1.0";
const UPDATE_PROGRESS_EVENT: &str = "update_progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseVersionSummary {
    pub tag: String,
    pub version: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub updater_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgressEvent {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemPackagesManifest {
    schema_version: u32,
    packages: Vec<SystemPackageManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemPackageManifestEntry {
    name: String,
    kind: String,
    arch: String,
    sha256: String,
}

#[derive(Debug, Clone, Copy)]
enum SystemPackageKind {
    Deb,
    Rpm,
}

fn is_safe_release_tag_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_')
}

fn normalize_release_tag(tag: &str) -> Result<String, String> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("版本号不能为空。".to_string());
    }

    let raw = tag
        .strip_prefix('v')
        .or_else(|| tag.strip_prefix('V'))
        .unwrap_or(tag);
    if raw.is_empty() {
        return Err("版本号不能为空。".to_string());
    }

    let normalized = format!("v{raw}");

    if !normalized.chars().all(is_safe_release_tag_char) {
        return Err("版本号包含非法字符，仅允许字母、数字、点、下划线和短横线。".to_string());
    }

    Ok(normalized)
}

fn normalize_version_from_tag(tag: &str) -> String {
    tag.trim_start_matches(['v', 'V']).to_string()
}

fn current_system_package_kind() -> Option<SystemPackageKind> {
    match bundle_type() {
        Some(BundleType::Deb) => Some(SystemPackageKind::Deb),
        Some(BundleType::Rpm) => Some(SystemPackageKind::Rpm),
        _ => None,
    }
}

fn target_package_extension(kind: SystemPackageKind) -> &'static str {
    match kind {
        SystemPackageKind::Deb => ".deb",
        SystemPackageKind::Rpm => ".rpm",
    }
}

fn emit_update_progress(
    app: &AppHandle,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        UpdateProgressEvent {
            phase: phase.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

fn current_arch_aliases() -> Vec<String> {
    match std::env::consts::ARCH {
        "x86_64" => vec!["x86_64".to_string(), "amd64".to_string()],
        "aarch64" => vec!["aarch64".to_string(), "arm64".to_string()],
        "arm" => vec!["armv7".to_string(), "armhf".to_string(), "arm".to_string()],
        other => vec![other.to_ascii_lowercase()],
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn find_release_asset_by_name<'a>(
    assets: &'a [GithubReleaseAsset],
    name: &str,
) -> Option<&'a GithubReleaseAsset> {
    assets.iter().find(|asset| asset.name == name)
}

fn kind_as_manifest_str(kind: SystemPackageKind) -> &'static str {
    match kind {
        SystemPackageKind::Deb => "deb",
        SystemPackageKind::Rpm => "rpm",
    }
}

fn score_manifest_arch(arch: &str, aliases: &[String]) -> i32 {
    let normalized = arch.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return -1;
    }

    if let Some(index) = aliases.iter().position(|alias| alias == &normalized) {
        return 100 - index as i32;
    }

    if matches!(normalized.as_str(), "all" | "any" | "noarch" | "universal") {
        return 10;
    }

    -1
}

fn pick_manifest_package_entry(
    manifest: &SystemPackagesManifest,
    kind: SystemPackageKind,
) -> Option<&SystemPackageManifestEntry> {
    let target_kind = kind_as_manifest_str(kind);
    let aliases = current_arch_aliases();

    manifest
        .packages
        .iter()
        .filter(|entry| {
            entry.kind.trim().eq_ignore_ascii_case(target_kind)
                && entry
                    .name
                    .to_ascii_lowercase()
                    .ends_with(target_package_extension(kind))
        })
        .filter_map(|entry| {
            let score = score_manifest_arch(&entry.arch, &aliases);
            if score < 0 {
                None
            } else {
                Some((entry, score))
            }
        })
        .max_by_key(|(_, score)| *score)
        .map(|(entry, _)| entry)
}

fn sanitize_asset_file_name(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "_");
    }
    while sanitized.starts_with('.') {
        sanitized.remove(0);
    }

    if sanitized.is_empty() {
        "lessai-update-package.bin".to_string()
    } else {
        sanitized
    }
}

fn prepare_download_path(tag: &str, file_name: &str) -> Result<PathBuf, String> {
    let mut dir = std::env::temp_dir();
    dir.push("lessai-system-update");
    let tag_hash = sha256_hex(tag.as_bytes());
    let cache_key = tag_hash.chars().take(16).collect::<String>();
    dir.push(cache_key);
    fs::create_dir_all(&dir).map_err(|error| format!("创建下载目录失败：{error}"))?;
    dir.push(file_name);
    Ok(dir)
}

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {name} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

async fn download_release_asset_bytes(
    client: &Client,
    asset: &GithubReleaseAsset,
) -> Result<Vec<u8>, String> {
    download_release_asset_bytes_with_progress(client, asset, |_, _| {}).await
}

async fn download_release_asset_bytes_with_progress<F>(
    client: &Client,
    asset: &GithubReleaseAsset,
    mut on_progress: F,
) -> Result<Vec<u8>, String>
where
    F: FnMut(u64, Option<u64>),
{
    let mut response = client
        .get(&asset.browser_download_url)
        .header(USER_AGENT, RELEASES_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("下载资产 {} 失败：{error}", asset.name))?;

    if !response.status().is_success() {
        return Err(format!(
            "下载资产 {} 失败：HTTP {}",
            asset.name,
            response.status()
        ));
    }

    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0_u64;
    let mut bytes = Vec::with_capacity(
        total_bytes
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(0),
    );
    on_progress(downloaded_bytes, total_bytes);

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取资产 {} 失败：{error}", asset.name))?
    {
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        bytes.extend_from_slice(&chunk);
        on_progress(downloaded_bytes, total_bytes);
    }

    Ok(bytes)
}

fn parse_system_packages_manifest(bytes: &[u8]) -> Result<SystemPackagesManifest, String> {
    let manifest: SystemPackagesManifest = serde_json::from_slice(bytes)
        .map_err(|error| format!("解析 system-packages.json 失败：{error}"))?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持的 system-packages.json 版本：{}（当前仅支持 1）",
            manifest.schema_version
        ));
    }
    if manifest.packages.is_empty() {
        return Err("system-packages.json 不包含任何包条目。".to_string());
    }
    Ok(manifest)
}

fn parse_updater_public_key(pubkey_b64: &str) -> Result<PublicKey, String> {
    let encoded = pubkey_b64.trim();
    if encoded.is_empty() {
        return Err("更新公钥为空，无法校验系统安装清单签名。".to_string());
    }

    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("解析更新公钥失败（base64）：{error}"))?;
    let decoded_text = String::from_utf8(decoded_bytes)
        .map_err(|error| format!("解析更新公钥失败（UTF-8）：{error}"))?;
    let decoded_text = decoded_text.trim();

    PublicKey::decode(decoded_text)
        .or_else(|_| PublicKey::from_base64(decoded_text))
        .map_err(|error| format!("解析更新公钥失败：{error}"))
}

fn updater_public_key_from_config(app: &AppHandle) -> Result<PublicKey, String> {
    let updater_config =
        app.config().plugins.0.get("updater").ok_or_else(|| {
            "应用配置缺少 updater 插件配置，无法校验系统安装清单签名。".to_string()
        })?;
    let updater_object = updater_config.as_object().ok_or_else(|| {
        "应用配置中的 updater 插件格式无效，无法校验系统安装清单签名。".to_string()
    })?;
    let pubkey_b64 = updater_object
        .get("pubkey")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "应用配置缺少 updater.pubkey，无法校验系统安装清单签名。".to_string())?;
    parse_updater_public_key(pubkey_b64)
}

fn verify_manifest_signature(
    manifest_bytes: &[u8],
    signature_bytes: &[u8],
    public_key: &PublicKey,
) -> Result<(), String> {
    let signature_text = std::str::from_utf8(signature_bytes)
        .map_err(|error| format!("system-packages.json.sig 不是合法 UTF-8 文本：{error}"))?;
    let signature = Signature::decode(signature_text.trim())
        .map_err(|error| format!("解析 system-packages.json.sig 失败：{error}"))?;
    public_key
        .verify(manifest_bytes, &signature, false)
        .map_err(|error| format!("system-packages.json 签名校验失败：{error}"))?;
    Ok(())
}

fn run_pkexec_install(kind: SystemPackageKind, package_path: &Path) -> Result<(), String> {
    if !command_exists("pkexec") {
        return Err(
            "当前系统未找到 pkexec，无法弹出管理员授权。请安装 polkit 并确保图形会话有授权代理。"
                .to_string(),
        );
    }

    let script = match kind {
        SystemPackageKind::Deb => {
            r#"set -eu
pkg="$1"
if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y "$pkg"
elif command -v apt >/dev/null 2>&1; then
  apt install -y "$pkg"
elif command -v dpkg >/dev/null 2>&1; then
  dpkg -i "$pkg"
else
  echo "No supported deb package manager found." >&2
  exit 127
fi"#
        }
        SystemPackageKind::Rpm => {
            r#"set -eu
pkg="$1"
if command -v dnf >/dev/null 2>&1; then
  dnf install -y "$pkg"
elif command -v yum >/dev/null 2>&1; then
  yum install -y "$pkg"
elif command -v zypper >/dev/null 2>&1; then
  zypper --non-interactive install "$pkg"
elif command -v rpm >/dev/null 2>&1; then
  rpm -Uvh --replacepkgs "$pkg"
else
  echo "No supported rpm package manager found." >&2
  exit 127
fi"#
        }
    };

    let status = Command::new("pkexec")
        .arg("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("lessai-system-update")
        .arg(package_path.as_os_str())
        .status()
        .map_err(|error| format!("启动系统安装器失败：{error}"))?;

    if !status.success() {
        return Err(format!("系统安装器执行失败（退出码：{status}）。"));
    }

    Ok(())
}

fn build_reqwest_client(proxy: Option<String>, timeout_secs: u64) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(Duration::from_secs(timeout_secs));
    if let Some(proxy) = proxy {
        Url::parse(&proxy).map_err(|error| format!("代理地址无效：{error}"))?;
        let reqwest_proxy = Proxy::all(proxy).map_err(|error| format!("代理配置失败：{error}"))?;
        builder = builder.proxy(reqwest_proxy);
    }
    builder
        .build()
        .map_err(|error| format!("网络客户端初始化失败：{error}"))
}

fn resolve_effective_proxy(app: &AppHandle, proxy: Option<String>) -> Option<String> {
    if let Some(proxy) = proxy.as_deref().and_then(normalize_proxy_url) {
        return Some(proxy);
    }

    storage::load_settings(app)
        .ok()
        .and_then(|settings| normalize_proxy_url(&settings.update_proxy))
}

fn extract_github_api_error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value["message"]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn format_github_api_error(error: reqwest::Error, action: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("{action}失败：{error}"));

    if error.is_timeout() {
        lines.push(
            "提示：请求超时。可尝试在网络设置中配置代理（如 http://127.0.0.1:7890）后重试。"
                .to_string(),
        );
    }
    if error.is_connect() {
        lines.push(
            "提示：连接失败。常见原因：代理未生效 / DNS 异常 / 网络被拦截。\n\
             GitHub API 在某些地区可能无法直连，请在“模型与接口”设置页填写网络代理后重试。"
                .to_string(),
        );
    }
    if error.is_request() {
        lines.push("提示：请求构造失败，可能是代理 URL 格式不正确。".to_string());
    }

    let mut source = error.source();
    while let Some(cause) = source {
        lines.push(format!("底层错误：{cause}"));
        source = cause.source();
    }

    lines.join("\n")
}

#[tauri::command]
pub async fn list_release_versions(
    app: AppHandle,
    proxy: Option<String>,
) -> Result<Vec<ReleaseVersionSummary>, String> {
    let client = build_reqwest_client(resolve_effective_proxy(&app, proxy), 15)?;
    let response = client
        .get(GITHUB_RELEASES_API_URL)
        .header(USER_AGENT, RELEASES_USER_AGENT)
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format_github_api_error(error, "拉取版本列表"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail =
            extract_github_api_error_message(&body).unwrap_or_else(|| body.trim().to_string());
        if status.as_u16() == 403 && detail.to_lowercase().contains("rate limit") {
            return Err(format!(
                "拉取版本列表失败：GitHub API 请求次数超限（未认证限制 60 次/小时）。\n\
                 请在网络畅通的环境稍等片刻后重试，或前往 GitHub 页面手动下载安装。\n\
                 原始错误：{detail}"
            ));
        }
        if detail.is_empty() {
            return Err(format!("拉取版本列表失败：HTTP {status}"));
        }
        return Err(format!("拉取版本列表失败：HTTP {status} — {detail}"));
    }

    let releases: Vec<GithubRelease> = response
        .json()
        .await
        .map_err(|error| format!("解析版本列表失败：{error}"))?;

    let mut result = Vec::with_capacity(releases.len());
    for release in releases.into_iter().filter(|item| !item.draft) {
        let Ok(tag) = normalize_release_tag(&release.tag_name) else {
            continue;
        };
        let updater_available = release
            .assets
            .iter()
            .any(|asset| asset.name.eq_ignore_ascii_case("latest.json"));
        result.push(ReleaseVersionSummary {
            version: normalize_version_from_tag(&tag),
            tag,
            name: release.name,
            body: release.body,
            html_url: release.html_url,
            published_at: release.published_at,
            prerelease: release.prerelease,
            updater_available,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn switch_release_version(
    app: AppHandle,
    tag: String,
    proxy: Option<String>,
) -> Result<String, String> {
    if matches!(bundle_type(), Some(BundleType::Deb) | Some(BundleType::Rpm)) {
        return Err(
            "当前为 Linux Deb/Rpm 安装包，由系统包管理器维护，不支持应用内切换版本。请使用系统包管理器升级，或改用 AppImage 包。"
                .to_string(),
        );
    }

    emit_update_progress(&app, "checking", 0, None);

    let tag = normalize_release_tag(&tag)?;
    let endpoint = RELEASE_MANIFEST_URL_TEMPLATE.replace("{tag}", &tag);
    let endpoint = Url::parse(&endpoint).map_err(|error| format!("构建更新地址失败：{error}"))?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("配置版本更新源失败：{error}"))?
        .version_comparator(|current, remote| current != remote.version)
        .timeout(Duration::from_secs(20));

    if let Some(proxy) = resolve_effective_proxy(&app, proxy) {
        let proxy = Url::parse(&proxy).map_err(|error| format!("代理地址无效：{error}"))?;
        builder = builder.proxy(proxy);
    }

    let updater = builder
        .build()
        .map_err(|error| format!("初始化更新器失败：{error}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("检查目标版本失败：{error}"))?
    else {
        return Err(format!(
            "未发现可安装版本：{tag}。请确认该发布包含 latest.json 与当前平台更新包。"
        ));
    };

    let installed_version = update.version.to_string();
    emit_update_progress(&app, "downloading", 0, None);
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let total_bytes = Arc::new(AtomicU64::new(0));
    let download_progress_app = app.clone();
    let download_finished_app = app.clone();
    let downloaded_for_chunk = Arc::clone(&downloaded_bytes);
    let downloaded_for_finish = Arc::clone(&downloaded_bytes);
    let total_for_chunk = Arc::clone(&total_bytes);
    let total_for_finish = Arc::clone(&total_bytes);
    update
        .download_and_install(
            move |chunk_length, content_length| {
                if let Some(content_length) = content_length {
                    total_for_chunk.store(content_length, Ordering::Relaxed);
                }
                let chunk_length = chunk_length as u64;
                let downloaded = downloaded_for_chunk
                    .fetch_add(chunk_length, Ordering::Relaxed)
                    .saturating_add(chunk_length);
                let total = content_length.or_else(|| {
                    let stored_total = total_for_chunk.load(Ordering::Relaxed);
                    (stored_total > 0).then_some(stored_total)
                });
                emit_update_progress(&download_progress_app, "downloading", downloaded, total);
            },
            move || {
                let downloaded = downloaded_for_finish.load(Ordering::Relaxed);
                let stored_total = total_for_finish.load(Ordering::Relaxed);
                let total = (stored_total > 0).then_some(stored_total);
                emit_update_progress(&download_finished_app, "installing", downloaded, total);
            },
        )
        .await
        .map_err(|error| format!("安装版本 {tag} 失败：{error}"))?;

    Ok(installed_version)
}

#[tauri::command]
pub async fn install_system_package_release(
    app: AppHandle,
    tag: String,
    proxy: Option<String>,
) -> Result<String, String> {
    let Some(package_kind) = current_system_package_kind() else {
        return Err("当前安装包类型不需要系统包管理器安装。".to_string());
    };

    emit_update_progress(&app, "checking", 0, None);

    let tag = normalize_release_tag(&tag)?;
    let client = build_reqwest_client(resolve_effective_proxy(&app, proxy), 30)?;
    let endpoint = GITHUB_RELEASE_BY_TAG_API_URL_TEMPLATE.replace("{tag}", &tag);
    let endpoint =
        Url::parse(&endpoint).map_err(|error| format!("构建发布查询地址失败：{error}"))?;

    let response = client
        .get(endpoint)
        .header(USER_AGENT, RELEASES_USER_AGENT)
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format_github_api_error(error, "查询目标版本"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail =
            extract_github_api_error_message(&body).unwrap_or_else(|| body.trim().to_string());
        if status.as_u16() == 403 && detail.to_lowercase().contains("rate limit") {
            return Err(format!(
                "查询目标版本失败：GitHub API 请求次数超限（未认证限制 60 次/小时）。\n\
                 请在网络畅通的环境稍等片刻后重试，或前往 GitHub 页面手动下载安装。\n\
                 原始错误：{detail}"
            ));
        }
        if detail.is_empty() {
            return Err(format!("查询目标版本失败：HTTP {status}"));
        }
        return Err(format!("查询目标版本失败：HTTP {status} — {detail}"));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|error| format!("解析目标版本信息失败：{error}"))?;

    let manifest_asset = find_release_asset_by_name(&release.assets, SYSTEM_PACKAGE_MANIFEST_ASSET_NAME)
        .ok_or_else(|| {
            format!(
                "目标版本 {tag} 缺少 {SYSTEM_PACKAGE_MANIFEST_ASSET_NAME}，无法安全校验系统安装包。请手动下载并安装。"
            )
        })?;
    let manifest_sig_asset = find_release_asset_by_name(
        &release.assets,
        SYSTEM_PACKAGE_MANIFEST_SIGNATURE_ASSET_NAME,
    )
    .ok_or_else(|| {
        format!(
            "目标版本 {tag} 缺少 {SYSTEM_PACKAGE_MANIFEST_SIGNATURE_ASSET_NAME}，无法验证系统包清单来源。请手动下载并安装。"
        )
    })?;
    let manifest_bytes = download_release_asset_bytes(&client, manifest_asset).await?;
    let manifest_sig_bytes = download_release_asset_bytes(&client, manifest_sig_asset).await?;
    let updater_public_key = updater_public_key_from_config(&app)?;
    verify_manifest_signature(&manifest_bytes, &manifest_sig_bytes, &updater_public_key)?;
    let manifest = parse_system_packages_manifest(&manifest_bytes)?;
    let manifest_entry = pick_manifest_package_entry(&manifest, package_kind).ok_or_else(|| {
        format!(
            "目标版本 {tag} 未在 {SYSTEM_PACKAGE_MANIFEST_ASSET_NAME} 中声明当前架构的 {} 安装包。",
            target_package_extension(package_kind)
        )
    })?;
    let asset =
        find_release_asset_by_name(&release.assets, &manifest_entry.name).ok_or_else(|| {
            format!(
                "目标版本 {tag} 的系统包清单指向了不存在的资产：{}",
                manifest_entry.name
            )
        })?;

    let expected_sha256 = manifest_entry.sha256.trim().to_ascii_lowercase();
    if expected_sha256.len() != 64 || !expected_sha256.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(format!(
            "目标版本 {tag} 的系统包清单包含非法 sha256：{}",
            manifest_entry.sha256
        ));
    }

    let download_path = prepare_download_path(&tag, &sanitize_asset_file_name(&asset.name))?;

    emit_update_progress(&app, "downloading", 0, None);
    let package_bytes = download_release_asset_bytes_with_progress(&client, asset, {
        let app = app.clone();
        move |downloaded_bytes, total_bytes| {
            emit_update_progress(&app, "downloading", downloaded_bytes, total_bytes);
        }
    })
    .await?;
    let actual_sha256 = sha256_hex(&package_bytes);
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "安装包完整性校验失败：期望 sha256={}, 实际 sha256={actual_sha256}。已阻止提权安装。",
            expected_sha256
        ));
    }

    fs::write(&download_path, &package_bytes)
        .map_err(|error| format!("保存安装包失败：{error}"))?;

    emit_update_progress(
        &app,
        "installing",
        package_bytes.len() as u64,
        Some(package_bytes.len() as u64),
    );
    let install_path = download_path.clone();
    tauri::async_runtime::spawn_blocking(move || run_pkexec_install(package_kind, &install_path))
        .await
        .map_err(|error| format!("安装任务执行失败：{error}"))??;

    Ok(normalize_version_from_tag(&tag))
}

#[cfg(test)]
mod tests {
    use super::{
        current_arch_aliases, normalize_release_tag, parse_updater_public_key,
        pick_manifest_package_entry, sanitize_asset_file_name, sha256_hex,
        verify_manifest_signature, SystemPackageKind, SystemPackageManifestEntry,
        SystemPackagesManifest,
    };
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};

    #[test]
    fn normalize_release_tag_rejects_path_separator() {
        assert!(normalize_release_tag("../v0.3.3").is_err());
    }

    #[test]
    fn normalize_release_tag_normalizes_uppercase_prefix() {
        assert_eq!(
            normalize_release_tag("V0.3.3").expect("normalized tag"),
            "v0.3.3"
        );
    }

    #[test]
    fn normalize_release_tag_rejects_plus_character() {
        assert!(normalize_release_tag("v0.3.3+build").is_err());
    }

    #[test]
    fn pick_manifest_package_entry_prefers_exact_arch() {
        let preferred_arch = current_arch_aliases()
            .first()
            .cloned()
            .unwrap_or_else(|| "any".to_string());
        let manifest = SystemPackagesManifest {
            schema_version: 1,
            packages: vec![
                SystemPackageManifestEntry {
                    name: "lessai-universal.deb".to_string(),
                    kind: "deb".to_string(),
                    arch: "all".to_string(),
                    sha256: "a".repeat(64),
                },
                SystemPackageManifestEntry {
                    name: "lessai-amd64.deb".to_string(),
                    kind: "deb".to_string(),
                    arch: preferred_arch.clone(),
                    sha256: "b".repeat(64),
                },
            ],
        };

        let picked = pick_manifest_package_entry(&manifest, SystemPackageKind::Deb)
            .expect("expected deb asset");
        assert_eq!(picked.arch, preferred_arch);
    }

    #[test]
    fn sanitize_asset_file_name_replaces_path_separators() {
        let sanitized = sanitize_asset_file_name("../LessAI 0.3.3 amd64.deb");
        assert!(!sanitized.contains('/'));
        assert!(!sanitized.contains(".."));
        assert!(sanitized.ends_with(".deb"));
    }

    #[test]
    fn sha256_hex_matches_known_value() {
        let digest = sha256_hex(b"abc");
        assert_eq!(
            digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn parse_updater_public_key_accepts_base64_wrapped_minisign_pub() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(
            "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n",
        );
        let parsed = parse_updater_public_key(&encoded).expect("expected updater pubkey parse");
        let expected =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .expect("public key");
        let signature = Signature::decode(
            "untrusted comment: signature from minisign secret key\n\
             RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n\
             trusted comment: timestamp:1556193335\tfile:test\n\
             y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==",
        )
        .expect("signature");
        parsed
            .verify(b"test", &signature, false)
            .expect("parsed key should verify signature");
        expected
            .verify(b"test", &signature, false)
            .expect("expected key should verify signature");
    }

    #[test]
    fn verify_manifest_signature_accepts_valid_signature() {
        let public_key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .expect("public key");
        let signature = r#"untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1556193335	file:test
y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg=="#;
        verify_manifest_signature(b"test", signature.as_bytes(), &public_key)
            .expect("signature should verify");
    }

    #[test]
    fn verify_manifest_signature_rejects_tampered_bytes() {
        let public_key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .expect("public key");
        let signature = r#"untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1556193335	file:test
y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg=="#;
        let error = verify_manifest_signature(b"test-tampered", signature.as_bytes(), &public_key)
            .expect_err("signature should fail");
        assert!(error.contains("签名校验失败"));
    }
}
