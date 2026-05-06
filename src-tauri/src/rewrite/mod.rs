mod diff;
mod llm;
mod text;

pub use diff::{build_diff, build_diff_result};
pub use llm::{
    build_client, rewrite_batch_with_client, rewrite_selection_text, rewrite_slot_texts,
    test_provider, SlotTextInput,
};
pub(crate) use llm::call_chat_model;
pub use text::{
    convert_line_endings, detect_line_ending, has_trailing_spaces_per_line, normalize_text,
    strip_trailing_spaces_per_line,
};

#[cfg(test)]
mod llm_regression_tests;
#[cfg(test)]
mod tests;
