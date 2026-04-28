use super::inline_scans::{
    count_run, find_backtick_closing, find_markdown_math_span_end, find_matching_bracket,
    find_matching_paren,
};

pub(super) fn find_markdown_link_end(line: &str, start: usize) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut index = start;
    if index >= bytes.len() {
        return None;
    }

    if bytes[index] == b'!' {
        if index + 1 >= bytes.len() || bytes[index + 1] != b'[' {
            return None;
        }
        index += 1;
    }

    if bytes[index] != b'[' {
        return None;
    }

    let close = find_matching_bracket(line, index)?;
    let mut pos = close;
    while pos < bytes.len() && matches!(bytes[pos], b' ' | b'\t') {
        pos += 1;
    }
    if pos >= bytes.len() {
        return None;
    }

    match bytes[pos] {
        b'(' => find_matching_paren(line, pos),
        b'[' => find_matching_bracket(line, pos),
        _ => None,
    }
}

pub(super) fn find_markdown_protected_spans(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'`' => {
                let run_len = count_run(bytes, index, b'`');
                if let Some(end) = find_backtick_closing(bytes, index + run_len, run_len) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                index += run_len.max(1);
            }
            b'!' => {
                if index + 1 < bytes.len() && bytes[index + 1] == b'[' {
                    if let Some(end) = find_markdown_link_end(line, index) {
                        spans.push((index, end));
                        index = end;
                        continue;
                    }
                }
                index += 1;
            }
            b'[' => {
                if let Some(end) = find_markdown_link_end(line, index) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                if is_reference_like_span(bytes, index) {
                    if let Some(end) = find_matching_bracket(line, index) {
                        spans.push((index, end));
                        index = end;
                        continue;
                    }
                }
                index += 1;
            }
            b'<' => {
                if let Some(end) = find_html_comment_end(line, index) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                if let Some(end) = find_autolink_end(line, index) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                if let Some(end) = find_inline_html_tag_end(line, index) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                index += 1;
            }
            b'$' => {
                if let Some(end) = find_markdown_math_span_end(line, index) {
                    spans.push((index, end));
                    index = end;
                    continue;
                }
                index += 1;
            }
            _ => index += 1,
        }
    }

    spans
}

fn is_reference_like_span(bytes: &[u8], index: usize) -> bool {
    index + 1 < bytes.len()
        && (bytes[index + 1] == b'^'
            || bytes[index + 1] == b'@'
            || (bytes[index + 1] == b'-' && index + 2 < bytes.len() && bytes[index + 2] == b'@'))
}

fn find_autolink_end(line: &str, start: usize) -> Option<usize> {
    let bytes = line.as_bytes();
    if start >= bytes.len() || bytes[start] != b'<' {
        return None;
    }
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'>' {
            let inner = &line[start + 1..index];
            let lower = inner.to_ascii_lowercase();
            if lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("mailto:")
            {
                return Some(index + 1);
            }
            return None;
        }
        index += 1;
    }
    None
}

fn find_html_comment_end(line: &str, start: usize) -> Option<usize> {
    if start >= line.len() || !line[start..].starts_with("<!--") {
        return None;
    }
    let from = start + "<!--".len();
    line[from..]
        .find("-->")
        .map(|offset| from + offset + "-->".len())
}

fn find_inline_html_tag_end(line: &str, start: usize) -> Option<usize> {
    let bytes = line.as_bytes();
    if start >= bytes.len() || bytes[start] != b'<' {
        return None;
    }

    let mut pos = start + 1;
    if pos >= bytes.len() {
        return None;
    }
    if !(bytes[pos] == b'/' || bytes[pos].is_ascii_alphabetic()) {
        return None;
    }

    let mut in_single = false;
    let mut in_double = false;
    while pos < bytes.len() {
        match bytes[pos] {
            b'\'' if !in_double => in_single = !in_single,
            b'"' if !in_single => in_double = !in_double,
            b'>' if !in_single && !in_double => return Some(pos + 1),
            b'\n' | b'\r' => return None,
            _ => {}
        }
        pos += 1;
    }

    None
}
