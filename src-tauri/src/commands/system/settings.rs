use tauri::AppHandle;

use crate::{
    models::AppSettings, rewrite, settings_validation::validate_numeric_settings, storage,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateDraft {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    storage::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    storage::save_settings(&app, &settings)
}

#[tauri::command]
pub async fn test_provider(
    settings: AppSettings,
) -> Result<crate::models::ProviderCheckResult, String> {
    rewrite::test_provider(&settings).await
}

#[tauri::command]
pub async fn infer_prompt_template(
    settings: AppSettings,
    sample_text: String,
) -> Result<PromptTemplateDraft, String> {
    validate_prompt_inference_settings(&settings)?;
    let sample_text = normalize_prompt_inference_sample(&sample_text)?;
    let client = rewrite::build_client(&settings)?;
    let raw = rewrite::call_chat_model(
        &client,
        &settings,
        prompt_inference_system_prompt(),
        &prompt_inference_user_prompt(&sample_text),
        0.2,
    )
    .await?;

    parse_prompt_template_draft(&raw)
}

fn validate_prompt_inference_settings(settings: &AppSettings) -> Result<(), String> {
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

fn normalize_prompt_inference_sample(sample_text: &str) -> Result<String, String> {
    const MAX_SAMPLE_CHARS: usize = 12_000;
    let trimmed = sample_text.trim();
    if trimmed.is_empty() {
        return Err("请先输入用于提炼风格的示例文本。".to_string());
    }
    if trimmed.chars().count() < 20 {
        return Err("示例文本太短，至少需要 20 个字符才能提炼稳定风格。".to_string());
    }
    Ok(trimmed.chars().take(MAX_SAMPLE_CHARS).collect())
}

fn prompt_inference_system_prompt() -> &'static str {
    "你是提示词工程师。你的任务是从用户提供的示例文本中提炼可复用的中文改写提示词模板。只输出 JSON，不要输出 Markdown。"
}

fn prompt_inference_user_prompt(sample_text: &str) -> String {
    format!(
        r#"请分析下面示例文本的语言风格、句式节奏、用词倾向、结构组织和表达约束，生成一个可直接用于“把任意文章改写成这种风格”的提示词模板。

要求：
1. 只返回 JSON 对象，字段为 name 和 content。
2. name 是 6-18 个中文字符，概括风格，不要包含“模板”二字。
3. content 必须是中文提示词，可以直接作为改写系统提示词使用。
4. content 要指导模型保留原文事实、数据、专有名词、引用、段落层级和格式，不得编造信息。
5. content 要提炼风格规则，不要复述示例文本的具体事实或主题。
6. content 必须包含“风格用词示例”小节，列出 6-12 个可迁移的词语、短语或句式示例，用于指导模型模仿语气；示例只能体现表达方式，不得包含示例文本中的具体事实、人物、地点、数据或主题。
7. content 要适合本项目按片段/槽位改写：只改写可编辑文本，不要求模型输出解释。

示例文本：
{sample_text}"#
    )
}

fn parse_prompt_template_draft(raw: &str) -> Result<PromptTemplateDraft, String> {
    let json_text = extract_json_object(raw)?;
    let value: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|error| format!("解析提示词提炼结果失败：{error}"))?;
    let name = value
        .get("name")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "提示词提炼结果缺少 name 字段。".to_string())?;
    let content = value
        .get("content")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "提示词提炼结果缺少 content 字段。".to_string())?;

    Ok(PromptTemplateDraft {
        name: name.chars().take(40).collect(),
        content: content.to_string(),
    })
}

fn extract_json_object(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let unfenced = strip_markdown_json_fence(trimmed);

    if unfenced.starts_with('{') && unfenced.ends_with('}') {
        return Ok(unfenced.to_string());
    }

    let start = unfenced
        .find('{')
        .ok_or_else(|| "提示词提炼结果没有包含 JSON 对象。".to_string())?;
    let end = unfenced
        .rfind('}')
        .ok_or_else(|| "提示词提炼结果没有包含完整 JSON 对象。".to_string())?;
    if end <= start {
        return Err("提示词提炼结果没有包含完整 JSON 对象。".to_string());
    }
    Ok(unfenced[start..=end].to_string())
}

fn strip_markdown_json_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(after_opening) = trimmed.strip_prefix("```") else {
        return trimmed;
    };

    let after_opening = after_opening.trim_start();
    let after_language = if after_opening
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("json"))
    {
        &after_opening[4..]
    } else {
        after_opening
    }
    .trim();
    after_language
        .strip_suffix("```")
        .unwrap_or(after_language)
        .trim()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_prompt_template_draft_accepts_fenced_json() {
        let draft = super::parse_prompt_template_draft(
            r#"```json
{"name":"冷静分析风格","content":"保留事实，使用冷静、克制、分析性的中文表达。"}
```"#,
        )
        .expect("expected draft");

        assert_eq!(draft.name, "冷静分析风格");
        assert!(draft.content.contains("保留事实"));
    }

    #[test]
    fn normalize_prompt_inference_sample_rejects_short_text() {
        let error = super::normalize_prompt_inference_sample("太短")
            .expect_err("expected short sample rejection");

        assert!(error.contains("示例文本太短"));
    }

    #[test]
    fn parse_prompt_template_draft_accepts_surrounded_json() {
        let draft = super::parse_prompt_template_draft(
            r#"结果如下：
{"name":"新闻纪实风格","content":"保留事实，用清晰、克制的新闻纪实语言重写。"}
请确认。"#,
        )
        .expect("expected draft");

        assert_eq!(draft.name, "新闻纪实风格");
        assert!(draft.content.contains("新闻纪实"));
    }
}
