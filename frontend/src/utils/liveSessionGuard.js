import { reportClientEvent } from "./clientTelemetry";

/**
 * A live lesson must not be hard-reloaded by recovery, updates, or the service worker.
 * Explicit user actions pass manual: true.
 */
export function isLiveSessionPath(pathname) {
  const raw =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "");
  const path = typeof raw === "string" ? raw : "";

  return (
    path.includes("/cabinet/meetings/") ||
    path.includes("/lesson/join")
  );
}

function pathOf(win) {
  try {
    const top = win?.top;
    if (top && top !== win && typeof top.location?.pathname === "string") {
      return top.location.pathname;
    }
  } catch {
    /* cross-origin top */
  }
  if (typeof win?.location?.pathname === "string") return win.location.pathname;
  return typeof window !== "undefined" && typeof window.location?.pathname === "string"
    ? window.location.pathname
    : "";
}

/**
 * Last step before any hard navigation.
 * Returns false without navigating when a live lesson would be reloaded automatically.
 */
export function requestHardReload({
  manual = false,
  reason = "",
  source = "",
  win,
  navigate,
} = {}) {
  const path = pathOf(win || (typeof window !== "undefined" ? window : null));
  if (!manual && isLiveSessionPath(path)) {
    reportClientEvent("APP_HARD_RELOAD_BLOCKED_LIVE_SESSION", {
      path,
      reason,
    });
    return false;
  }
  reportClientEvent("APP_HARD_RELOAD", {
    reason,
    path,
    source,
  });
  if (typeof navigate === "function") navigate();
  return true;
}
