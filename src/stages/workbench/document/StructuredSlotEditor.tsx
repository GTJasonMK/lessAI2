import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
import type {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent
} from "react";

import {
  applyEditorSlotOverride,
  buildEditorSlotEdits,
  buildEditorTextFromSession,
  resolveEditorSlotText
} from "../../../lib/editorSlots";
import { diffTextByChars } from "../../../lib/diff";
import { normalizeNewlines } from "../../../lib/helpers";
import type {
  DocumentEditorHandle,
  DocumentEditorProps,
  DocumentEditorPreviewResult,
  DocumentEditorSelectionSnapshot,
  EditorSlotSelectionRange,
  MultiSlotSelectionSnapshot,
  SlotSelectionSnapshot
} from "./documentEditorTypes";
import {
  normalizeSelectionComparableText,
  resolveSnapshotRangeInText,
  selectionPointOffset
} from "./editorSelectionShared";
import { SelectionDecorationOverlay } from "./SelectionDecorationOverlay";
import { StructuredEditorUnit } from "./StructuredEditorUnit";
import { useEditorSaveShortcut } from "./useEditorSaveShortcut";
import {
  type SelectionDecorationContext,
  useSelectionDecorationRects
} from "./useSelectionDecorationRects";
import { useProgressiveRevealCount } from "../hooks/useProgressiveRevealCount";

function replaceSelectionText(
  currentText: string,
  snapshot: SlotSelectionSnapshot,
  replacementText: string
) {
  const replacement = normalizeNewlines(replacementText);
  if (replacement.trim().length === 0) {
    return { ok: false, error: "模型返回内容为空，已取消替换。" } as const;
  }

  const resolvedRange = resolveSnapshotRangeInText(currentText, snapshot);
  if (!resolvedRange) {
    return { ok: false, error: "选区已变化或文本已被修改，请重新选中后再试。" } as const;
  }

  return {
    ok: true,
    text: `${currentText.slice(0, resolvedRange.startOffset)}${replacement}${currentText.slice(
      resolvedRange.endOffset
    )}`
  } as const;
}

function textPositionForOffset(root: HTMLElement, targetOffset: number) {
  let remaining = Math.max(0, targetOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let lastTextNode: Text | null = null;

  while (node) {
    const textNode = node as Text;
    lastTextNode = textNode;
    const length = textNode.data.length;
    if (remaining <= length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= length;
    node = walker.nextNode();
  }

  if (lastTextNode) {
    return { node: lastTextNode, offset: lastTextNode.data.length };
  }

  return { node: root, offset: root.childNodes.length };
}

function restoreSlotSelection(
  slotNodes: Record<string, HTMLSpanElement | null>,
  ranges: EditorSlotSelectionRange[]
) {
  const usableRanges = ranges
    .map((range) => {
      const node = slotNodes[range.slotId];
      if (!node) return null;
      return {
        start: textPositionForOffset(node, range.startOffset),
        end: textPositionForOffset(node, range.endOffset)
      };
    })
    .filter((range): range is NonNullable<typeof range> => range != null);

  if (usableRanges.length === 0) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.setStart(usableRanges[0].start.node, usableRanges[0].start.offset);
  const lastRange = usableRanges[usableRanges.length - 1];
  range.setEnd(lastRange.end.node, lastRange.end.offset);

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function clampOffset(offset: number, min: number, max: number) {
  return Math.min(max, Math.max(min, offset));
}

function splitRewrittenTextToSlots(
  slotInfos: Array<{ slotId: string; text: string; separatorAfter: string }>,
  rewrittenText: string
): Map<string, string> {
  const combinedBefore = slotInfos.map((s) => s.text + s.separatorAfter).join("");
  const spans = diffTextByChars(combinedBefore, rewrittenText);

  // 计算每个槽位文本在合并前文本中的起止位置，以及分隔符结束位置
  let pos = 0;
  const slotRegions = slotInfos.map((info) => {
    const textStart = pos;
    const textEnd = pos + info.text.length;
    const sepEnd = textEnd + info.separatorAfter.length;
    pos = sepEnd;
    return { slotId: info.slotId, textStart, textEnd, sepEnd };
  });

  // 初始化结果
  const result = new Map<string, string>();
  for (const info of slotInfos) {
    result.set(info.slotId, "");
  }

  const getSlotForBeforePos = (beforePos: number): string | null => {
    for (const r of slotRegions) {
      if (beforePos >= r.textStart && beforePos < r.textEnd) {
        return r.slotId;
      }
    }
    return null;
  };

  // 为插入文本找到归属槽位：先看当前位置，再看是否在分隔符区域，最后向前/后查找
  const getSlotForInsert = (beforePos: number): string => {
    const direct = getSlotForBeforePos(beforePos);
    if (direct) return direct;
    // 在分隔符区域插入 → 属于该分隔符前面的槽位
    for (const r of slotRegions) {
      if (beforePos >= r.textEnd && beforePos < r.sepEnd) {
        return r.slotId;
      }
    }
    // 向前查找已删除区域的槽位
    for (let p = beforePos - 1; p >= 0; p--) {
      const slot = getSlotForBeforePos(p);
      if (slot) return slot;
    }
    // 向后查找
    for (let p = beforePos + 1; p < combinedBefore.length; p++) {
      const slot = getSlotForBeforePos(p);
      if (slot) return slot;
    }
    // 极端情况回退到最后一个槽位
    return slotRegions[slotRegions.length - 1]?.slotId ?? "";
  };

  let beforePos = 0;

  for (const span of spans) {
    if (span.type === "unchanged") {
      for (const ch of span.text) {
        const slotId = getSlotForBeforePos(beforePos);
        if (slotId) {
          result.set(slotId, result.get(slotId)! + ch);
        }
        beforePos++;
      }
    } else if (span.type === "delete") {
      beforePos += span.text.length;
    } else {
      // insert
      const slotId = getSlotForInsert(beforePos);
      result.set(slotId, result.get(slotId)! + span.text);
    }
  }

  return result;
}

export const StructuredSlotEditor = memo(
  forwardRef<DocumentEditorHandle, DocumentEditorProps>(function StructuredSlotEditor(
    {
      session,
      slotOverrides,
      showMarkers,
      dirty,
      busy,
      onChange,
      onChangeSlotText,
      onSave,
      onSelectionChange
    },
    ref
  ) {
    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const slotNodesRef = useRef<Record<string, HTMLSpanElement | null>>({});
    const editableSlotIdSetRef = useRef<Set<string>>(new Set());
    const nodeSlotIdMapRef = useRef<WeakMap<Node, string>>(new WeakMap());
    const hasSelectionRef = useRef(false);
    const lastSnapshotRef = useRef<DocumentEditorSelectionSnapshot | null>(null);
    const clearSnapshotOnCollapsedSelectionRef = useRef(false);
    const slotOverridesRef = useRef(slotOverrides);
    slotOverridesRef.current = slotOverrides;

    const registerNode = useCallback((slotId: string, node: HTMLSpanElement | null) => {
      const previous = slotNodesRef.current[slotId];
      if (previous) {
        nodeSlotIdMapRef.current.delete(previous);
      }
      slotNodesRef.current[slotId] = node;
      if (node) {
        nodeSlotIdMapRef.current.set(node, slotId);
      }
    }, []);

    const resolveEditableSlotIdFromNode = useCallback((node: Node | null): string | null => {
      let current: Node | null = node;
      while (current) {
        const mapped = nodeSlotIdMapRef.current.get(current);
        if (mapped && editableSlotIdSetRef.current.has(mapped)) {
          return mapped;
        }
        if (current instanceof HTMLElement) {
          const direct = current.dataset.slotId;
          if (direct && editableSlotIdSetRef.current.has(direct)) {
            return direct;
          }
        }
        current = current.parentNode;
      }
      return null;
    }, []);

    const findSessionSlot = useCallback(
      (slotId: string) => session.writebackSlots.find((item) => item.id === slotId) ?? null,
      [session.writebackSlots]
    );

    useEffect(() => {
      const set = new Set<string>();
      for (const slot of session.writebackSlots) {
        if (slot.editable) {
          set.add(slot.id);
        }
      }
      editableSlotIdSetRef.current = set;
    }, [session.writebackSlots]);

    const captureSlotSelection = useCallback(() => {
      const root = editorRootRef.current;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!root || !range) return null;

      if (range.collapsed) {
        return null;
      }

      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        return null;
      }

      const selectionStartOffset = selectionPointOffset(
        root,
        range.startContainer,
        range.startOffset
      );
      const selectionEndOffset = selectionPointOffset(root, range.endContainer, range.endOffset);

      const overrides = slotOverridesRef.current;
      const slotInfos = session.writebackSlots
        .filter((slot) => slot.editable)
        .map((slot) => {
          const node = slotNodesRef.current[slot.id];
          if (!node) return null;

          const nodeStartOffset = selectionPointOffset(root, node, 0);
          const nodeEndOffset = selectionPointOffset(root, node, node.childNodes.length);
          const startOffset = clampOffset(
            selectionStartOffset - nodeStartOffset,
            0,
            nodeEndOffset - nodeStartOffset
          );
          const endOffset = clampOffset(
            selectionEndOffset - nodeStartOffset,
            0,
            nodeEndOffset - nodeStartOffset
          );
          if (endOffset <= startOffset) return null;

          const fullText = normalizeNewlines(resolveEditorSlotText(slot, overrides));
          const selectedText = fullText.slice(startOffset, endOffset);
          if (selectedText.trim().length === 0) return null;

          return {
            slotId: slot.id,
            fullText,
            startOffset,
            endOffset,
            selectedText: normalizeSelectionComparableText(selectedText),
            separatorAfter: slot.separatorAfter
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null);

      if (slotInfos.length === 0) return null;

      if (slotInfos.length === 1) {
        const info = slotInfos[0];
        return {
          kind: "slot",
          slotId: info.slotId,
          text: info.selectedText,
          startOffset: info.startOffset,
          endOffset: info.endOffset
        } satisfies SlotSelectionSnapshot;
      }

      const combinedText = slotInfos
        .map((info, index) => {
          const separatorAfter = index < slotInfos.length - 1 ? info.separatorAfter : "";
          return `${info.selectedText}${separatorAfter}`;
        })
        .join("");

      return {
        kind: "multiSlot",
        text: combinedText,
        startOffset: 0,
        endOffset: combinedText.length,
        slotIds: slotInfos.map((s) => s.slotId),
        slotFullTexts: slotInfos.map((s) => s.fullText),
        slotStartOffsets: slotInfos.map((s) => s.startOffset),
        slotEndOffsets: slotInfos.map((s) => s.endOffset),
        slotSeparators: slotInfos.map((s, index) =>
          index < slotInfos.length - 1 ? s.separatorAfter : ""
        )
      } satisfies MultiSlotSelectionSnapshot;
    }, [session]);

    useEditorSaveShortcut({ busy, dirty, onSave });

    useEffect(() => {
      const firstEditable = session.writebackSlots.find((slot) => slot.editable);
      if (!firstEditable) return;
      const id = requestAnimationFrame(() => {
        editorRootRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }, [session.id, session.writebackSlots]);

    const renderedUnitCount = useProgressiveRevealCount({
      total: session.rewriteUnits.length,
      key: session.id,
      enabled: session.rewriteUnits.length > 120,
      initial: 80,
      step: 120
    });

    const setEditorSelectionAvailable = useCallback(
      (next: boolean) => {
        if (next === hasSelectionRef.current) return;
        hasSelectionRef.current = next;
        onSelectionChange?.(next);
      },
      [onSelectionChange]
    );

    const resolveSelectionDecorationRange = useCallback(
      ({ root, range }: SelectionDecorationContext<HTMLDivElement>) => {
        const snapshot = captureSlotSelection();
        if (snapshot) {
          lastSnapshotRef.current = snapshot;
          clearSnapshotOnCollapsedSelectionRef.current = false;
          setEditorSelectionAvailable(true);
          return range;
        }

        if (
          clearSnapshotOnCollapsedSelectionRef.current &&
          range?.collapsed &&
          root?.contains(range.startContainer)
        ) {
          lastSnapshotRef.current = null;
          clearSnapshotOnCollapsedSelectionRef.current = false;
        }
        setEditorSelectionAvailable(false);
        return null;
      },
      [captureSlotSelection, setEditorSelectionAvailable]
    );

    const {
      selectionDecorationRects,
      clearSelectionDecoration,
      scheduleSelectionStateSync
    } = useSelectionDecorationRects({
      rootRef: editorRootRef,
      resolveRange: resolveSelectionDecorationRange
    });

    const resolveSelectionReplacement = useCallback(
      (
        snapshot: DocumentEditorSelectionSnapshot,
        replacementText: string
      ):
        | {
            ok: true;
            value: string;
            slotEdits: ReturnType<typeof buildEditorSlotEdits>;
            /** slotId → 新的完整槽位文本 */
            slotUpdates: Map<string, string>;
          }
        | {
            ok: false;
            error: string;
          } => {
        // ── 单槽位 ──────────────────────────────────────
        if (snapshot.kind === "slot") {
          const slot = findSessionSlot(snapshot.slotId);
          if (!slot || !slot.editable) {
            return { ok: false, error: "当前选区不在可编辑片段内，请重新选中后再试。" };
          }

          const currentText = normalizeNewlines(
            slotNodesRef.current[slot.id]?.innerText ?? resolveEditorSlotText(slot, slotOverrides)
          );
          const replaced = replaceSelectionText(currentText, snapshot, replacementText);
          if (!replaced.ok) return replaced;

          const nextOverrides = applyEditorSlotOverride(slotOverrides, slot, replaced.text);
          const slotUpdates = new Map<string, string>();
          slotUpdates.set(slot.id, replaced.text);

          return {
            ok: true,
            value: buildEditorTextFromSession(session, nextOverrides),
            slotEdits: buildEditorSlotEdits(session, nextOverrides),
            slotUpdates
          };
        }

        // ── 跨槽位 ──────────────────────────────────────
        if (snapshot.kind === "multiSlot") {
          const { slotIds, slotFullTexts, slotStartOffsets, slotEndOffsets, slotSeparators } =
            snapshot;

          // 校验所有槽位仍存在且可编辑
          const slotInfos = slotIds.map((slotId, i) => {
            const slot = findSessionSlot(slotId);
            if (!slot || !slot.editable) {
              return { ok: false as const, error: `槽位 ${slotId} 不可编辑或已不存在。` };
            }
            return {
              ok: true as const,
              slotId,
              text: slotFullTexts[i].slice(slotStartOffsets[i], slotEndOffsets[i]),
              fullText: slotFullTexts[i],
              startOffset: slotStartOffsets[i],
              endOffset: slotEndOffsets[i],
              separatorAfter: slotSeparators[i],
              slot
            };
          });

          const firstError = slotInfos.find((s) => !s.ok);
          if (firstError && !firstError.ok) {
            return { ok: false, error: firstError.error };
          }

          const validInfos = slotInfos
            .filter((s) => s.ok)
            .map((s) => ({
              slotId: s.slotId,
              text: s.text,
              fullText: s.fullText,
              startOffset: s.startOffset,
              endOffset: s.endOffset,
              separatorAfter: s.separatorAfter,
              slot: s.slot
            }));

          // 通过字符级 diff 将合并改写结果拆回各槽位的选中部分，再拼回完整槽位。
          const selectedSlotUpdates = splitRewrittenTextToSlots(validInfos, replacementText);
          const slotUpdates = new Map<string, string>();
          for (const info of validInfos) {
            const selectedUpdate = selectedSlotUpdates.get(info.slotId);
            if (selectedUpdate == null) continue;
            slotUpdates.set(
              info.slotId,
              `${info.fullText.slice(0, info.startOffset)}${selectedUpdate}${info.fullText.slice(
                info.endOffset
              )}`
            );
          }

          // 构建下一版 overrides 和完整文本
          let nextOverrides = { ...slotOverrides };
          for (const [slotId, newText] of slotUpdates) {
            const slot = validInfos.find((s) => s.slotId === slotId)!.slot;
            nextOverrides = applyEditorSlotOverride(nextOverrides, slot, newText);
          }

          return {
            ok: true,
            value: buildEditorTextFromSession(session, nextOverrides),
            slotEdits: buildEditorSlotEdits(session, nextOverrides),
            slotUpdates
          };
        }

        return { ok: false, error: "请在可编辑片段内重新选中后再试。" };
      },
      [findSessionSlot, session, slotOverrides]
    );

    const previewSelectionReplacement = useCallback(
      (
        snapshot: DocumentEditorSelectionSnapshot,
        replacementText: string
      ): DocumentEditorPreviewResult => {
        const resolved = resolveSelectionReplacement(snapshot, replacementText);
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: resolved.value,
          slotEdits: resolved.slotEdits
        };
      },
      [resolveSelectionReplacement]
    );

    useImperativeHandle(
      ref,
      (): DocumentEditorHandle => ({
        captureSelection: () => {
          // 优先实时捕捉（处理「选中文字局部改写」场景）
          const current = captureSlotSelection();
          if (current) return current;
          // 点击工具栏时焦点可能离开编辑器并折叠原生选区；回退到最近一次真实选区。
          return lastSnapshotRef.current;
        },
        previewSelectionReplacement,
        applySelectionReplacement: (snapshot, replacementText) => {
          const resolved = resolveSelectionReplacement(snapshot, replacementText);
          if (!resolved.ok) return resolved;

          for (const [slotId, newText] of resolved.slotUpdates) {
            const node = slotNodesRef.current[slotId];
            if (node) {
              node.innerText = newText;
            }
            onChangeSlotText(slotId, newText);
          }
          // 聚焦最后一个被更新的槽位
          const lastSlotId = [...resolved.slotUpdates.keys()].pop();
          if (lastSlotId) {
            editorRootRef.current?.focus();
          }
          onChange(resolved.value);
          return { ok: true };
        },
        applySlotUpdates: (slotUpdates: Map<string, string>, options) => {
          let nextOverrides = { ...slotOverrides };
          for (const [slotId, newText] of slotUpdates) {
            const node = slotNodesRef.current[slotId];
            if (node) {
              node.innerText = newText;
            }
            onChangeSlotText(slotId, newText);
            const slot = session.writebackSlots.find((s) => s.id === slotId);
            if (slot) {
              nextOverrides = applyEditorSlotOverride(nextOverrides, slot, newText);
            }
          }
          // 聚焦最后一个被更新的槽位
          const lastSlotId = [...slotUpdates.keys()].pop();
          if (lastSlotId) {
            editorRootRef.current?.focus();
          }
          if (options?.selectionRanges?.length) {
            restoreSlotSelection(slotNodesRef.current, options.selectionRanges);
            scheduleSelectionStateSync();
          }
          onChange(buildEditorTextFromSession(session, nextOverrides));
        },
        collectSlotEdits: () => buildEditorSlotEdits(session, slotOverrides)
      }),
      [
        captureSlotSelection,
        onChange,
        onChangeSlotText,
        previewSelectionReplacement,
        resolveSelectionReplacement,
        scheduleSelectionStateSync,
        session,
        slotOverrides
      ]
    );

    const getSingleEditableSlotSelection = useCallback(() => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) return null;

      const startSlotId = resolveEditableSlotIdFromNode(range.startContainer);
      const endSlotId = resolveEditableSlotIdFromNode(range.endContainer);
      if (!startSlotId || startSlotId !== endSlotId) return null;

      const node = slotNodesRef.current[startSlotId];
      if (!node || !node.contains(range.startContainer) || !node.contains(range.endContainer)) {
        return null;
      }

      return { slotId: startSlotId, node, range };
    }, [resolveEditableSlotIdFromNode]);

    const markSelectionCacheClearOnEditorIntent = useCallback(() => {
      lastSnapshotRef.current = null;
      clearSnapshotOnCollapsedSelectionRef.current = true;
      clearSelectionDecoration();
      setEditorSelectionAvailable(false);
    }, [clearSelectionDecoration, setEditorSelectionAvailable]);

    const handleEditorKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        markSelectionCacheClearOnEditorIntent();
      },
      [markSelectionCacheClearOnEditorIntent]
    );

    const syncEditableSlotText = useCallback(
      (slotId: string, node: HTMLElement) => {
        const slot = findSessionSlot(slotId);
        if (!slot || !slot.editable) return;

        const nextText = normalizeNewlines(node.innerText);
        const currentText = normalizeNewlines(
          resolveEditorSlotText(slot, slotOverridesRef.current)
        );
        if (nextText === currentText) return;

        onChangeSlotText(slotId, nextText);
      },
      [findSessionSlot, onChangeSlotText]
    );

    const handleEditorInput = useCallback(() => {
      for (const slot of session.writebackSlots) {
        if (!slot.editable) continue;
        const node = slotNodesRef.current[slot.id];
        if (node) {
          syncEditableSlotText(slot.id, node);
        }
      }
    }, [session.writebackSlots, syncEditableSlotText]);

    const handleEditorBeforeInput = useCallback(
      (event: FormEvent<HTMLDivElement>) => {
        const nativeEvent = event.nativeEvent as InputEvent;
        const inputType = nativeEvent.inputType ?? "";
        if (!inputType) return;

        const target = getSingleEditableSlotSelection();
        if (!target) {
          event.preventDefault();
          return;
        }

        if (!target.range.collapsed) return;

        if (inputType === "deleteContentBackward") {
          const offset = selectionPointOffset(
            target.node,
            target.range.startContainer,
            target.range.startOffset
          );
          if (offset <= 0) {
            event.preventDefault();
          }
          return;
        }

        if (inputType === "deleteContentForward") {
          const offset = selectionPointOffset(
            target.node,
            target.range.startContainer,
            target.range.startOffset
          );
          if (offset >= normalizeNewlines(target.node.innerText).length) {
            event.preventDefault();
          }
        }
      },
      [getSingleEditableSlotSelection]
    );

    const handleEditorPaste = useCallback(
      (event: ClipboardEvent<HTMLDivElement>) => {
        const target = getSingleEditableSlotSelection();
        if (!target) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        if (!text) return;

        if (!document.execCommand("insertText", false, text)) {
          const selection = window.getSelection();
          if (!selection?.rangeCount) return;
          selection.deleteFromDocument();
          selection.getRangeAt(0).insertNode(document.createTextNode(text));
          selection.collapseToEnd();
        }
        handleEditorInput();
      },
      [getSingleEditableSlotSelection, handleEditorInput]
    );

    const visibleRewriteUnits = useMemo(
      () => session.rewriteUnits.slice(0, renderedUnitCount),
      [renderedUnitCount, session.rewriteUnits]
    );

    const renderedUnits = visibleRewriteUnits.map((rewriteUnit) => (
      <StructuredEditorUnit
        key={rewriteUnit.id}
        session={session}
        rewriteUnit={rewriteUnit}
        slotOverrides={slotOverrides}
        registerNode={registerNode}
      />
    ));

    return (
      <div
        className={`document-flow-wrap structured-editor-wrap ${showMarkers ? "is-markers" : "is-quiet"}`}
      >
        {showMarkers ? (
          <div className="unit-legend" aria-label="高亮说明">
            <span className="legend-chip is-editable" title="可改写单元（包含可编辑槽位）">
              可改写
            </span>
            <span className="legend-chip is-protected" title="保护区（锁定内容，保持只读）">
              保护区
            </span>
          </div>
        ) : null}

        <div className="workbench-editor-selection-shell">
          <div
            ref={editorRootRef}
            className="workbench-editor-editable structured-editor-flow"
            contentEditable={!busy}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="编辑终稿"
            tabIndex={0}
            spellCheck={false}
            onPointerDown={markSelectionCacheClearOnEditorIntent}
            onPointerUp={scheduleSelectionStateSync}
            onSelect={scheduleSelectionStateSync}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={scheduleSelectionStateSync}
            onBeforeInput={handleEditorBeforeInput}
            onInput={handleEditorInput}
            onPaste={handleEditorPaste}
          >
            {renderedUnits}
            {renderedUnitCount < session.rewriteUnits.length ? (
              <span className="doc-unit-wrap" aria-hidden="true" />
            ) : null}
          </div>
          <SelectionDecorationOverlay rects={selectionDecorationRects} />
        </div>
      </div>
    );
  })
);
