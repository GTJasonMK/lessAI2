import { infoRuntime } from "../../lib/runtimeLog";

const SCROLL_RESTORE_PREFIX = "[lessai::scroll_restore]";
const SCROLL_RESTORE_DEBUG_STORAGE_KEY = "lessai.debugScrollRestore";

function scrollRestoreDebugEnabled() {
  try {
    return globalThis.localStorage?.getItem(SCROLL_RESTORE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function snapshotScrollNode(node: HTMLDivElement | null) {
  if (!node) {
    return { present: false } as const;
  }

  return {
    present: true,
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    connected: node.isConnected
  } as const;
}

export function logScrollRestore(event: string, detail: Record<string, unknown>) {
  if (!scrollRestoreDebugEnabled()) return;
  void infoRuntime(`${SCROLL_RESTORE_PREFIX} ${event} ${JSON.stringify(detail)}`);
}
