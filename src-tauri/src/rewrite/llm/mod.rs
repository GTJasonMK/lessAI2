use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::models::{AppSettings, DocumentFormat, ProviderCheckResult};
use crate::network_proxy::normalize_proxy_url;
use crate::rewrite_unit::{
    parse_rewrite_batch_response, parse_rewrite_unit_response, RewriteBatchRequest,
    RewriteBatchResponse, RewriteUnitRequest, RewriteUnitResponse, SlotUpdate,
};
use crate::settings_validation::validate_numeric_settings;

mod plain_support;
mod selection;
pub(in crate::rewrite) mod transport;
mod validate;

pub(crate) use transport::call_chat_model;

/// 编辑器逐槽位改写输入：前端直接传入已定义好的槽位文本与分隔符。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotTextInput {
    pub slot_id: String,
    pub text: String,
    pub separator_after: String,
}

pub fn build_client(settings: &AppSettings) -> Result<reqwest::Client, String> {
    let mut builder =
        reqwest::Client::builder().timeout(Duration::from_millis(settings.timeout_ms));

    if let Some(proxy_url) = normalize_proxy_url(&settings.update_proxy) {
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|error| format!("代理地址无效（{proxy_url}）：{error}"))?;
        builder = builder.no_proxy().proxy(proxy);
    }

    builder.build().map_err(|error| error.to_string())
}

pub async fn test_provider(settings: &AppSettings) -> Result<ProviderCheckResult, String> {
    validate_settings(settings)?;

    let client = build_client(settings)?;
    let probe =
        transport::call_chat_model(&client, settings, "你是连通性探针。只回复 OK。", "OK", 0.0)
            .await;

    if let Err(error) = probe {
        return Ok(ProviderCheckResult {
            ok: false,
            message: format!("chat/completions 调用失败：{error}"),
        });
    }

    Ok(ProviderCheckResult {
        ok: true,
        message: "连接测试通过，chat/completions 可访问。".to_string(),
    })
}

pub async fn rewrite_selection_text_with_client(
    client: &reqwest::Client,
    settings: &AppSettings,
    source_text: &str,
    format: DocumentFormat,
    rewrite_headings: bool,
) -> Result<String, String> {
    selection::rewrite_selection_text_with_client(
        client,
        settings,
        source_text,
        format,
        rewrite_headings,
    )
    .await
}

pub async fn rewrite_unit_with_client(
    client: &reqwest::Client,
    settings: &AppSettings,
    request: &RewriteUnitRequest,
) -> Result<RewriteUnitResponse, String> {
    let system_prompt = request.system_prompt();
    let user_prompt = request.user_prompt();
    let raw = transport::call_chat_model(
        client,
        settings,
        &system_prompt,
        &user_prompt,
        settings.temperature,
    )
    .await?;
    parse_rewrite_unit_response(request, &raw)
}

pub async fn rewrite_batch_with_client(
    client: &reqwest::Client,
    settings: &AppSettings,
    request: &RewriteBatchRequest,
) -> Result<RewriteBatchResponse, String> {
    let system_prompt = request.system_prompt();
    let user_prompt = request.user_prompt();
    let raw = transport::call_chat_model(
        client,
        settings,
        &system_prompt,
        &user_prompt,
        settings.temperature,
    )
    .await?;
    parse_rewrite_batch_response(request, &raw)
}

pub async fn rewrite_selection_text(
    settings: &AppSettings,
    source_text: &str,
    format: DocumentFormat,
    rewrite_headings: bool,
) -> Result<String, String> {
    let client = build_client(settings)?;
    rewrite_selection_text_with_client(&client, settings, source_text, format, rewrite_headings)
        .await
}

/// 对已有槽位执行逐槽位改写，直接返回 `Vec<SlotUpdate>`。
/// 复用 `rewrite_unit_with_client` 管线，避免前端合并后再 diff 拆分。
pub async fn rewrite_slot_texts_with_client(
    client: &reqwest::Client,
    settings: &AppSettings,
    slot_inputs: &[SlotTextInput],
    format: DocumentFormat,
) -> Result<Vec<SlotUpdate>, String> {
    validate_settings(settings)?;

    let slots: Vec<crate::rewrite_unit::WritebackSlot> = slot_inputs
        .iter()
        .enumerate()
        .map(|(i, input)| crate::rewrite_unit::WritebackSlot {
            id: input.slot_id.clone(),
            order: i,
            text: input.text.clone(),
            editable: true,
            role: crate::rewrite_unit::WritebackSlotRole::EditableText,
            presentation: None,
            anchor: None,
            separator_after: input.separator_after.clone(),
        })
        .collect();

    if !slots
        .iter()
        .any(|s| s.editable && !s.text.trim().is_empty())
    {
        return Err("选区不包含可改写文本。".to_string());
    }

    let request = crate::rewrite_unit::build_rewrite_unit_request_from_slots(
        "editor-selection",
        &slots,
        format,
    );
    let response = rewrite_unit_with_client(client, settings, &request).await?;
    selection::normalize_selection_updates(&slots, response)
}

pub async fn rewrite_slot_texts(
    settings: &AppSettings,
    slot_inputs: &[SlotTextInput],
    format: DocumentFormat,
) -> Result<Vec<SlotUpdate>, String> {
    let client = build_client(settings)?;
    rewrite_slot_texts_with_client(&client, settings, slot_inputs, format).await
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    validate_numeric_settings(settings)?;
    if settings.base_url.trim().is_empty() {
        return Err("Base URL 不能为空。".to_string());
    }
    if settings.api_key.trim().is_empty() {
        return Err("API Key 不能为空。".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("模型名称不能为空。".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_client, validate_settings};
    use crate::models::AppSettings;

    #[test]
    fn validate_settings_rejects_zero_units_per_batch() {
        let mut settings = valid_settings();
        settings.units_per_batch = 0;

        let error = validate_settings(&settings).expect_err("expected invalid batch size");

        assert_eq!(error, "单批处理单元数必须大于等于 1。");
    }

    #[test]
    fn validate_settings_rejects_max_concurrency_above_limit() {
        let mut settings = valid_settings();
        settings.max_concurrency = 9;

        let error = validate_settings(&settings).expect_err("expected invalid max concurrency");

        assert_eq!(error, "自动并发数必须在 1 到 8 之间。");
    }

    #[test]
    fn build_client_rejects_invalid_proxy() {
        let mut settings = valid_settings();
        settings.update_proxy = "://bad".to_string();

        let error = build_client(&settings).expect_err("expected invalid proxy url");

        assert!(error.contains("代理地址无效"), "unexpected error: {error}");
    }

    fn valid_settings() -> AppSettings {
        AppSettings {
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "test-key".to_string(),
            model: "deepseek-v4-flash".to_string(),
            ..AppSettings::default()
        }
    }
}
