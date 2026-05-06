use std::path::Path;

use chrono::Utc;
use tauri::{AppHandle, State};

use crate::{
    detection,
    editor_session::ensure_editor_base_snapshot_matches_path,
    models::{DetectionResult, DocumentSession, DocumentSnapshot},
    session_access::{access_current_session, CurrentSessionRequest},
    session_flow::allow_session,
    session_messages::ACTIVE_REWRITE_SESSION_ERROR,
    state::AppState,
    storage,
};

#[tauri::command]
pub async fn start_detection(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<DocumentSession, String> {
    let session = access_current_session(
        CurrentSessionRequest::guarded_refresh(&app, state.inner(), &session_id, allow_session)
            .with_active_job_error(ACTIVE_REWRITE_SESSION_ERROR),
        Ok,
    )?;
    let settings = storage::load_settings(&app)?;
    let detection_result = detection::detect_session(&settings, &session).await?;

    access_current_session(
        CurrentSessionRequest::guarded_refresh(&app, state.inner(), &session_id, allow_session)
            .with_active_job_error(ACTIVE_REWRITE_SESSION_ERROR),
        |mut latest| {
            if latest.source_text != session.source_text {
                return Err("文档内容已变化，请重新发起 AI 检测。".to_string());
            }
            latest.detection_result = Some(detection_result);
            latest.updated_at = Utc::now();
            storage::save_session(&app, &latest)?;
            Ok(latest)
        },
    )
}

#[tauri::command]
pub async fn detect_selection(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
    editor_base_snapshot: Option<DocumentSnapshot>,
) -> Result<DetectionResult, String> {
    if text.trim().is_empty() {
        return Err("选区内容为空。".to_string());
    }

    let snapshot = editor_base_snapshot.clone();
    let session = access_current_session(
        CurrentSessionRequest::guarded_refresh(
            &app,
            state.inner(),
            &session_id,
            |session: &DocumentSession| {
                if snapshot.is_some() {
                    ensure_editor_base_snapshot_matches_path(
                        Path::new(&session.document_path),
                        snapshot.as_ref(),
                    )?;
                }
                Ok(())
            },
        )
        .with_active_job_error(ACTIVE_REWRITE_SESSION_ERROR),
        Ok,
    )?;
    let settings = storage::load_settings(&app)?;
    detection::detect_selection_text(&settings, &text, session.source_snapshot.clone()).await
}
