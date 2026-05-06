use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    models::{AppSettings, DetectionResult, DetectionSegment, DocumentSession, DocumentSnapshot},
    rewrite_unit::{rewrite_unit_text, RewriteUnit},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectionUnitInput {
    rewrite_unit_id: Option<String>,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDetectionResponse {
    #[serde(default, alias = "overall_score", alias = "score", alias = "aiProbability")]
    overall_score: Option<f32>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    segments: Vec<RawDetectionSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDetectionSegment {
    #[serde(default, alias = "rewrite_unit_id", alias = "unitId", alias = "id")]
    rewrite_unit_id: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    start: Option<usize>,
    #[serde(default)]
    end: Option<usize>,
    #[serde(default, alias = "aiProbability", alias = "probability")]
    score: Option<f32>,
    #[serde(default)]
    reason: Option<String>,
}

pub(crate) fn validate_detection_settings(settings: &AppSettings) -> Result<(), String> {
    if !settings.detection_enabled {
        return Err("AI 检测未启用，请先在设置中开启检测接口。".to_string());
    }
    if settings.detection_base_url.trim().is_empty() {
        return Err("检测 Base URL 不能为空。".to_string());
    }
    if settings.detection_api_key.trim().is_empty() {
        return Err("检测 API Key 不能为空。".to_string());
    }
    if settings.detection_model.trim().is_empty() {
        return Err("检测模型名称不能为空。".to_string());
    }
    Ok(())
}

pub(crate) async fn detect_session(
    settings: &AppSettings,
    session: &DocumentSession,
) -> Result<DetectionResult, String> {
    let inputs = detection_units_from_session(session)?;
    if inputs.is_empty() {
        return Err("当前文档没有可检测文本。".to_string());
    }
    detect_inputs(
        settings,
        inputs,
        session.source_snapshot.clone(),
        Utc::now(),
    )
    .await
}

pub(crate) async fn detect_selection_text(
    settings: &AppSettings,
    text: &str,
    source_snapshot: Option<DocumentSnapshot>,
) -> Result<DetectionResult, String> {
    if text.trim().is_empty() {
        return Err("选区内容为空。".to_string());
    }
    detect_inputs(
        settings,
        vec![DetectionUnitInput {
            rewrite_unit_id: None,
            text: text.to_string(),
        }],
        source_snapshot,
        Utc::now(),
    )
    .await
}

async fn detect_inputs(
    settings: &AppSettings,
    inputs: Vec<DetectionUnitInput>,
    source_snapshot: Option<DocumentSnapshot>,
    created_at: DateTime<Utc>,
) -> Result<DetectionResult, String> {
    validate_detection_settings(settings)?;
    let model_settings = detection_model_settings(settings);
    let client = crate::rewrite::build_client(&model_settings)?;
    let raw = crate::rewrite::call_chat_model(
        &client,
        &model_settings,
        detection_system_prompt(),
        &detection_user_prompt(&inputs),
        0.0,
    )
    .await?;
    parse_detection_result(
        &raw,
        &inputs,
        created_at,
        model_settings.model,
        source_snapshot,
    )
}

fn detection_model_settings(settings: &AppSettings) -> AppSettings {
    let mut model_settings = settings.clone();
    model_settings.base_url = settings.detection_base_url.clone();
    model_settings.api_key = settings.detection_api_key.clone();
    model_settings.model = settings.detection_model.clone();
    model_settings.temperature = 0.0;
    model_settings
}

fn detection_units_from_session(
    session: &DocumentSession,
) -> Result<Vec<DetectionUnitInput>, String> {
    let mut inputs = Vec::new();
    for unit in &session.rewrite_units {
        if !rewrite_unit_has_editable_slot(session, unit) {
            continue;
        }
        let text = rewrite_unit_text(session, &unit.id)?;
        if text.trim().is_empty() {
            continue;
        }
        inputs.push(DetectionUnitInput {
            rewrite_unit_id: Some(unit.id.clone()),
            text,
        });
    }
    Ok(inputs)
}

fn rewrite_unit_has_editable_slot(session: &DocumentSession, unit: &RewriteUnit) -> bool {
    unit.slot_ids.iter().any(|slot_id| {
        session
            .writeback_slots
            .iter()
            .any(|slot| slot.id == *slot_id && slot.editable)
    })
}

fn detection_system_prompt() -> &'static str {
    "你是一个文本 AI 生成概率检测器。只输出 JSON，不要输出 Markdown。\
分数含义固定为 0-100 的 AI 生成概率，越高越像 AI 生成。"
}

fn detection_user_prompt(inputs: &[DetectionUnitInput]) -> String {
    let payload = json!({
        "task": "detect_ai_generated_text",
        "scoreMeaning": "0-100 AI-generated probability; higher means more likely AI-generated",
        "requiredJsonShape": {
            "overallScore": "number 0-100",
            "summary": "short Chinese explanation",
            "segments": [
                {
                    "rewriteUnitId": "copy from input when available",
                    "score": "number 0-100",
                    "reason": "short Chinese explanation",
                    "text": "optional suspicious excerpt",
                    "start": "optional character start offset",
                    "end": "optional character end offset"
                }
            ]
        },
        "units": inputs,
    });
    format!(
        "请检测以下文本的 AI 生成概率。必须返回一个 JSON 对象，字段使用 camelCase。\n{}",
        serde_json::to_string_pretty(&payload).expect("detection payload should serialize")
    )
}

fn parse_detection_result(
    raw: &str,
    inputs: &[DetectionUnitInput],
    created_at: DateTime<Utc>,
    model: String,
    source_snapshot: Option<DocumentSnapshot>,
) -> Result<DetectionResult, String> {
    let json_text = extract_json_object(raw)?;
    let parsed: RawDetectionResponse = serde_json::from_str(&json_text)
        .map_err(|error| format!("检测结果 JSON 解析失败：{error}"))?;
    let overall_score = normalize_score(parsed.overall_score.unwrap_or(0.0));
    let mut segments = parsed
        .segments
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            normalize_segment(index, segment, overall_score, inputs)
        })
        .collect::<Vec<_>>();

    if segments.is_empty() {
        segments = fallback_segments(inputs, overall_score);
    }

    Ok(DetectionResult {
        overall_score,
        summary: parsed
            .summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "检测完成。".to_string()),
        segments,
        created_at,
        model,
        source_snapshot,
    })
}

fn normalize_segment(
    index: usize,
    segment: RawDetectionSegment,
    fallback_score: f32,
    inputs: &[DetectionUnitInput],
) -> DetectionSegment {
    let rewrite_unit_id = segment
        .rewrite_unit_id
        .and_then(|value| normalize_rewrite_unit_id(&value, inputs));
    let text = segment
        .text
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| input_text_for_rewrite_unit(rewrite_unit_id.as_deref(), inputs))
        .unwrap_or_default();

    DetectionSegment {
        id: format!("segment-{index}"),
        rewrite_unit_id,
        text,
        start: segment.start,
        end: segment.end,
        score: normalize_score(segment.score.unwrap_or(fallback_score)),
        reason: segment
            .reason
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }
}

fn normalize_rewrite_unit_id(value: &str, inputs: &[DetectionUnitInput]) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    inputs
        .iter()
        .filter_map(|input| input.rewrite_unit_id.as_deref())
        .find(|unit_id| *unit_id == trimmed)
        .map(str::to_string)
}

fn input_text_for_rewrite_unit(
    rewrite_unit_id: Option<&str>,
    inputs: &[DetectionUnitInput],
) -> Option<String> {
    let rewrite_unit_id = rewrite_unit_id?;
    inputs
        .iter()
        .find(|input| input.rewrite_unit_id.as_deref() == Some(rewrite_unit_id))
        .map(|input| input.text.clone())
}

fn fallback_segments(inputs: &[DetectionUnitInput], score: f32) -> Vec<DetectionSegment> {
    inputs
        .iter()
        .enumerate()
        .map(|(index, input)| DetectionSegment {
            id: format!("segment-{index}"),
            rewrite_unit_id: input.rewrite_unit_id.clone(),
            text: input.text.clone(),
            start: None,
            end: None,
            score,
            reason: None,
        })
        .collect()
}

fn normalize_score(score: f32) -> f32 {
    let finite = if score.is_finite() { score } else { 0.0 };
    let scaled = if finite > 0.0 && finite <= 1.0 {
        finite * 100.0
    } else {
        finite
    };
    scaled.clamp(0.0, 100.0)
}

fn extract_json_object(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Ok(trimmed.to_string());
    }

    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    if without_fence.starts_with('{') && without_fence.ends_with('}') {
        return Ok(without_fence.to_string());
    }

    let start = without_fence
        .find('{')
        .ok_or_else(|| "检测结果没有包含 JSON 对象。".to_string())?;
    let end = without_fence
        .rfind('}')
        .ok_or_else(|| "检测结果 JSON 对象不完整。".to_string())?;
    if end <= start {
        return Err("检测结果 JSON 对象不完整。".to_string());
    }
    Ok(without_fence[start..=end].to_string())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::{parse_detection_result, DetectionUnitInput};

    #[test]
    fn parse_detection_result_accepts_fenced_json_and_scores() {
        let raw = r#"```json
{"overallScore":0.82,"summary":"整体偏高","segments":[{"rewriteUnitId":"unit-1","score":76,"reason":"句式规整"}]}
```"#;
        let result = parse_detection_result(
            raw,
            &[DetectionUnitInput {
                rewrite_unit_id: Some("unit-1".to_string()),
                text: "测试文本".to_string(),
            }],
            Utc::now(),
            "detector".to_string(),
            None,
        )
        .expect("parse detection result");

        assert_eq!(result.overall_score, 82.0);
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].rewrite_unit_id.as_deref(), Some("unit-1"));
        assert_eq!(result.segments[0].text, "测试文本");
        assert_eq!(result.segments[0].score, 76.0);
    }

    #[test]
    fn parse_detection_result_falls_back_to_unit_segments() {
        let result = parse_detection_result(
            r#"{"overallScore":45,"summary":"中等"}"#,
            &[
                DetectionUnitInput {
                    rewrite_unit_id: Some("unit-1".to_string()),
                    text: "第一段".to_string(),
                },
                DetectionUnitInput {
                    rewrite_unit_id: Some("unit-2".to_string()),
                    text: "第二段".to_string(),
                },
            ],
            Utc::now(),
            "detector".to_string(),
            None,
        )
        .expect("parse detection result");

        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.segments[1].rewrite_unit_id.as_deref(), Some("unit-2"));
        assert_eq!(result.segments[1].score, 45.0);
    }
}
