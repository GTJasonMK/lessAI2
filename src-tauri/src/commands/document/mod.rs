mod detection;
mod editor;
mod export;
mod snippet;
mod suggestions;

pub use detection::{detect_selection, start_detection};
pub use editor::run_document_writeback;
pub use export::{export_document, finalize_document};
pub use snippet::{rewrite_editor_slots, rewrite_selection};
pub use suggestions::{apply_suggestion, delete_suggestion, dismiss_suggestion};
