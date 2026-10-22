import { reportClientEvent } from "../../utils/clientTelemetry";
import { navigationInfo } from "./boardLoadFailures";

export function boardDocumentSnapshot(boardId, {
  doc = typeof document !== "undefined" ? document : null,
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  return {
    board_id: String(boardId || "").slice(0, 64),
    visibilityState: String(doc?.visibilityState || "").slice(0, 16),
    innerWidth: Math.round(Number(win?.innerWidth) || 0),
    innerHeight: Math.round(Number(win?.innerHeight) || 0),
  };
}

export function bindBoardDocumentTelemetry(boardId, {
  doc = typeof document !== "undefined" ? document : null,
  win = typeof window !== "undefined" ? window : null,
  report = reportClientEvent,
} = {}) {
  if (!doc || !win || typeof win.addEventListener !== "function") return () => {};
  const send = (event, extra = {}) => {
    try {
      report(event, { ...boardDocumentSnapshot(boardId, { doc, win }), ...extra });
    } catch {
      /* ignore */
    }
  };
  const onHide = () => send("board_document_pagehide");
  const onUnload = () => send("board_document_unload");
  // r98: persisted=true → bfcache restore; nav_type=reload after a killed tab.
  const onShow = (event) => send("board_document_pageshow", { persisted: Boolean(event?.persisted), ...navigationInfo(win) });
  const onVis = () => send("board_document_visibility");
  send("board_document_mount", navigationInfo(win));
  win.addEventListener("pagehide", onHide);
  win.addEventListener("beforeunload", onUnload);
  win.addEventListener("pageshow", onShow);
  doc.addEventListener("visibilitychange", onVis);
  return () => {
    win.removeEventListener("pagehide", onHide);
    win.removeEventListener("beforeunload", onUnload);
    win.removeEventListener("pageshow", onShow);
    doc.removeEventListener("visibilitychange", onVis);
  };
}

export function boardSyncStatusName(status) {
  if (status === "error") return "error";
  if (status === "loading") return "loading";
  if (status === "synced-remote" || status === "synced-local") return "synced";
  return String(status || "").slice(0, 32);
}

export function nextCanvasGeometry(previous, width, height) {
  const next = {
    width: Math.round(Number(width) || 0),
    height: Math.round(Number(height) || 0),
  };
  if (previous && previous.width === next.width && previous.height === next.height) return null;
  return next;
}
