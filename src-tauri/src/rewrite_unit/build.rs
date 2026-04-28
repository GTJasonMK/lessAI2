use crate::{
    models::{RewriteUnitStatus, SegmentationPreset},
    text_boundaries::contains_paragraph_separator,
};

use super::{RewriteUnit, WritebackSlot, WritebackSlotRole};

const SENTENCE_BOUNDARIES: [char; 8] = ['。', '！', '？', '；', '!', '?', ';', '.'];
const CLAUSE_BOUNDARIES: [char; 10] = ['。', '！', '？', '；', '!', '?', ';', '.', '，', ','];
const CLOSING_PUNCTUATION: [char; 13] = [
    '"', '\'', '”', '’', '）', ')', '】', ']', '}', '」', '』', '》', '〉',
];
const MIN_REWRITE_UNIT_CHARS: usize = 4;

pub(crate) fn build_rewrite_units(
    slots: &[WritebackSlot],
    preset: SegmentationPreset,
) -> Vec<RewriteUnit> {
    let mut groups: Vec<Vec<&WritebackSlot>> = Vec::new();
    let mut current: Vec<&WritebackSlot> = Vec::new();

    for slot in slots {
        current.push(slot);
        if !should_close_unit(&current, preset) {
            continue;
        }
        if should_skip_unit(&current) {
            current.clear();
            continue;
        }
        groups.push(std::mem::take(&mut current));
        current.clear();
    }

    if !current.is_empty() && !should_skip_unit(&current) {
        groups.push(current);
    }

    if preset != SegmentationPreset::Paragraph {
        merge_short_units(&mut groups, MIN_REWRITE_UNIT_CHARS);
    }

    groups
        .into_iter()
        .enumerate()
        .map(|(order, group)| build_unit(order, preset, &group))
        .collect()
}

fn should_skip_unit(current: &[&WritebackSlot]) -> bool {
    is_standalone_separator_unit(current) || is_blank_only_unit(current)
}

fn build_unit(order: usize, preset: SegmentationPreset, slots: &[&WritebackSlot]) -> RewriteUnit {
    RewriteUnit {
        id: format!("unit-{order}"),
        order,
        slot_ids: slots.iter().map(|slot| slot.id.clone()).collect(),
        display_text: display_text(slots),
        segmentation_preset: preset,
        status: if slots.iter().any(|slot| slot.editable) {
            RewriteUnitStatus::Idle
        } else {
            RewriteUnitStatus::Done
        },
        error_message: None,
    }
}

fn display_text(slots: &[&WritebackSlot]) -> String {
    slots
        .iter()
        .map(|slot| format!("{}{}", slot.text, slot.separator_after))
        .collect()
}

fn should_close_unit(current: &[&WritebackSlot], preset: SegmentationPreset) -> bool {
    let Some(last) = current.last() else {
        return false;
    };
    if last.role == WritebackSlotRole::ParagraphBreak
        || contains_paragraph_separator(&last.separator_after)
    {
        return true;
    }
    if preset == SegmentationPreset::Paragraph {
        return false;
    }
    if has_inline_line_break_boundary(last) {
        return true;
    }
    ends_semantic_group(current, preset)
}

fn has_inline_line_break_boundary(slot: &WritebackSlot) -> bool {
    slot.anchor.is_some() && slot.separator_after.contains('\n')
}

fn is_standalone_separator_unit(current: &[&WritebackSlot]) -> bool {
    current.len() == 1
        && current[0].role == WritebackSlotRole::ParagraphBreak
        && current[0].text.is_empty()
}

fn is_blank_only_unit(current: &[&WritebackSlot]) -> bool {
    display_text(current).trim().is_empty()
}

fn merge_short_units(groups: &mut Vec<Vec<&WritebackSlot>>, min_chars: usize) {
    if groups.len() <= 1 {
        return;
    }

    let mut index = 0usize;
    while index < groups.len() {
        if unit_char_count(&groups[index]) >= min_chars {
            index += 1;
            continue;
        }

        if index + 1 < groups.len() {
            let mut current = groups.remove(index);
            current.append(&mut groups[index]);
            groups[index] = current;
            continue;
        }

        index += 1;
    }
}

fn unit_char_count(group: &[&WritebackSlot]) -> usize {
    display_text(group).trim().chars().count()
}

fn ends_semantic_group(current: &[&WritebackSlot], preset: SegmentationPreset) -> bool {
    let boundary_set: &[char] = match preset {
        SegmentationPreset::Clause => &CLAUSE_BOUNDARIES,
        SegmentationPreset::Sentence => &SENTENCE_BOUNDARIES,
        SegmentationPreset::Paragraph => return false,
    };

    // 从末尾反向扫描 slots，避免重建完整 display_text（消除 String + Vec<char> 分配）
    let mut skipping = true; // 先跳过空白，再跳过 CLOSING_PUNCTUATION

    for slot in current.iter().rev() {
        // separator_after 在拼接字符串中最靠后，先处理
        for ch in slot.separator_after.chars().rev() {
            if skipping && ch.is_whitespace() {
                continue;
            }
            skipping = false;
            if CLOSING_PUNCTUATION.contains(&ch) {
                continue;
            }
            return boundary_set.contains(&ch);
        }
        for ch in slot.text.chars().rev() {
            if skipping && ch.is_whitespace() {
                continue;
            }
            skipping = false;
            if CLOSING_PUNCTUATION.contains(&ch) {
                continue;
            }
            return boundary_set.contains(&ch);
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use crate::models::SegmentationPreset;

    use super::{build_rewrite_units, WritebackSlot};

    #[test]
    fn merges_adjacent_editable_slots_into_one_sentence_unit_when_no_boundary_exists() {
        let slots = vec![
            WritebackSlot::editable("slot-1", 0, "甲"),
            WritebackSlot::editable("slot-2", 1, "乙"),
        ];

        let units = build_rewrite_units(&slots, SegmentationPreset::Sentence);

        assert_eq!(units.len(), 1);
        assert_eq!(units[0].slot_ids, vec!["slot-1", "slot-2"]);
        assert_eq!(units[0].display_text, "甲乙");
    }

    #[test]
    fn paragraph_builder_skips_standalone_unit_for_empty_paragraph_break_slot() {
        let mut first = WritebackSlot::editable("slot-1", 0, "封面标题");
        first.separator_after = "\n\n".to_string();
        let mut empty_break = WritebackSlot::locked("slot-2", 1, "");
        empty_break.role = crate::rewrite_unit::WritebackSlotRole::ParagraphBreak;
        empty_break.separator_after = "\n\n".to_string();
        let second = WritebackSlot::editable("slot-3", 2, "正文开始");

        let units =
            build_rewrite_units(&[first, empty_break, second], SegmentationPreset::Paragraph);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].slot_ids, vec!["slot-1"]);
        assert_eq!(units[0].display_text, "封面标题\n\n");
        assert_eq!(units[1].slot_ids, vec!["slot-3"]);
        assert_eq!(units[1].display_text, "正文开始");
    }

    #[test]
    fn paragraph_builder_skips_blank_whitespace_unit_even_when_editable() {
        let mut blank = WritebackSlot::editable("slot-1", 0, "　　");
        blank.separator_after = "\n\n".to_string();
        let next = WritebackSlot::editable("slot-2", 1, "正文开始");

        let units = build_rewrite_units(&[blank, next], SegmentationPreset::Paragraph);

        assert_eq!(units.len(), 1);
        assert_eq!(units[0].slot_ids, vec!["slot-2"]);
        assert_eq!(units[0].display_text, "正文开始");
    }

    #[test]
    fn short_unit_is_merged_into_next_unit_when_below_min_chars() {
        let first = WritebackSlot::editable("slot-1", 0, "短。");
        let second = WritebackSlot::editable("slot-2", 1, "这是第二句。");

        let units = build_rewrite_units(&[first, second], SegmentationPreset::Sentence);

        assert_eq!(units.len(), 1);
        assert_eq!(units[0].slot_ids, vec!["slot-1", "slot-2"]);
        assert_eq!(units[0].display_text, "短。这是第二句。");
    }

    #[test]
    fn paragraph_preset_keeps_short_paragraph_as_independent_unit() {
        let mut first = WritebackSlot::editable("slot-1", 0, "短段");
        first.separator_after = "\n\n".to_string();
        let second = WritebackSlot::editable("slot-2", 1, "下一段");

        let units = build_rewrite_units(&[first, second], SegmentationPreset::Paragraph);

        assert_eq!(units.len(), 2);
        assert_eq!(units[0].display_text, "短段\n\n");
        assert_eq!(units[1].display_text, "下一段");
    }
}
