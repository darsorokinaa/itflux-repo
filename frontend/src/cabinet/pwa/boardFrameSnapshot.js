/** DOM snapshot of the lesson board iframe. Path only: the query can carry a lesson title. */
export const BOARD_IFRAME_HEALTH_MS = 2500;

function clip(value, limit) {
  return String(value ?? "").slice(0, limit);
}

function box(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") {
    return { width: 0, height: 0 };
  }
  const rect = node.getBoundingClientRect();
  return {
    width: Math.round(Number(rect?.width) || 0),
    height: Math.round(Number(rect?.height) || 0),
  };
}

function styleOf(node, win) {
  if (!node || !win || typeof win.getComputedStyle !== "function") {
    return { display: "", visibility: "", opacity: "" };
  }
  const style = win.getComputedStyle(node);
  return {
    display: clip(style?.display, 24),
    visibility: clip(style?.visibility, 16),
    opacity: clip(style?.opacity, 8),
  };
}

export function iframeSrcPath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value, "https://local.invalid");
    return clip(url.pathname, 120);
  } catch {
    return clip(value.split("?")[0], 120);
  }
}

export function readBoardFrameSnapshot(doc = typeof document !== "undefined" ? document : null, event = "") {
  const win = doc?.defaultView || (typeof window !== "undefined" ? window : null);
  const iframe = doc?.querySelector?.('iframe[src*="/cabinet/boards/"]') || null;
  const workspace = doc?.querySelector?.(".video-lesson-workspace") || null;
  const iframeStyle = styleOf(iframe, win);
  const workspaceStyle = styleOf(workspace, win);
  const iframeBox = box(iframe);
  const workspaceBox = box(workspace);
  return {
    event: clip(event, 32),
    document_visibilityState: clip(doc?.visibilityState, 16),
    board_id: clip(iframe?.getAttribute?.("data-board-id"), 64),
    frame_key: clip(iframe?.getAttribute?.("data-frame-key"), 96),
    iframe_isConnected: Boolean(iframe?.isConnected),
    iframe_src: iframeSrcPath(iframe?.getAttribute?.("src")),
    iframe_rect_width: iframeBox.width,
    iframe_rect_height: iframeBox.height,
    iframe_display: iframeStyle.display,
    iframe_visibility: iframeStyle.visibility,
    iframe_opacity: iframeStyle.opacity,
    workspace_display: workspaceStyle.display,
    workspace_visibility: workspaceStyle.visibility,
    workspace_width: workspaceBox.width,
    workspace_height: workspaceBox.height,
    workspace_className: clip(workspace?.className, 80),
  };
}

export function boardFrameGeometryKey(snapshot) {
  if (!snapshot) return "";
  return [
    snapshot.iframe_rect_width,
    snapshot.iframe_rect_height,
    snapshot.iframe_display,
    snapshot.iframe_visibility,
    snapshot.workspace_width,
    snapshot.workspace_height,
    snapshot.workspace_display,
    snapshot.workspace_visibility,
  ].join(":");
}

export function startBoardIframeHealth({
  doc = typeof document !== "undefined" ? document : null,
  report = () => {},
  intervalMs = BOARD_IFRAME_HEALTH_MS,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
} = {}) {
  const tick = () => {
    const snapshot = readBoardFrameSnapshot(doc, "health");
    report("board_iframe_health", snapshot);
  };
  tick();
  const timer = setIntervalImpl(tick, intervalMs);
  return () => clearIntervalImpl(timer);
}
