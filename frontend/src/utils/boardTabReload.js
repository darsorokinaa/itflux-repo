import { isLiveSessionPath } from "./liveSessionGuard";

export const STALE_BOARD_TITLE = "Доска обновилась — перезагрузите вкладку доски";

/**
 * A video call. /cabinet/boards/ is live for the service worker, but it is not
 * the call itself — liveSessionGuard still owns /cabinet/meetings/ and /lesson/join.
 */
export function isCallSessionPath(pathname) {
  const path = String(pathname || "");
  if (!path || !isLiveSessionPath(path)) return false;
  return !path.includes("/cabinet/boards/");
}

/** True when this window is an iframe whose parent is a meeting or the join page. */
export function isBoardInsideMeetingFrame(win = typeof window !== "undefined" ? window : null) {
  if (!win) return false;
  try {
    const top = win.top;
    if (!top || top === win) return false;
    return isCallSessionPath(top.location?.pathname || "");
  } catch {
    return true;
  }
}

/**
 * One automatic reload is allowed only on a top-level /cabinet/boards/ tab.
 * Never inside a meeting iframe, and never on /cabinet/meetings/ or /lesson/join.
 */
export function canAutoReloadBoardTab(win = typeof window !== "undefined" ? window : null) {
  if (!win) return false;
  let path = "";
  try {
    path = String(win.location?.pathname || "");
  } catch {
    return false;
  }
  if (!path.includes("/cabinet/boards/")) return false;
  if (isCallSessionPath(path)) return false;
  if (isBoardInsideMeetingFrame(win)) return false;
  return true;
}

export function reloadBoardTab(win = typeof window !== "undefined" ? window : null) {
  try {
    win?.location?.reload();
  } catch {
    /* ignore */
  }
}
