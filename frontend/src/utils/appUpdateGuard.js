/**
 * Blocks automatic hard-reload when the user is mid-edit / in a live lesson.
 * Pages can also register custom blockers via registerAppUpdateBlocker.
 */

const blockers = new Set();

export function registerAppUpdateBlocker(fn) {
  if (typeof fn !== "function") return () => {};
  blockers.add(fn);
  return () => blockers.delete(fn);
}

function pathLooksUnsafe(pathname) {
  const path = pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  if (!path) return false;

  // Live lesson / meeting
  if (path.includes("/meetings/") || path.includes("/lesson/join")) return true;
  // Board editor
  if (/\/boards\/[^/]+\/?$/.test(path) && path.includes("/cabinet/")) return true;
  if (path.includes("/boards/") && (path.includes("/edit") || path.includes("/editor"))) return true;
  // Lesson plan editor
  if (path.includes("/lesson-plans/") && (path.includes("/edit") || path.includes("/editor"))) return true;
  // Homework / assignment fill
  if (path.includes("/assignments/") && !path.endsWith("/assignments/")) return true;
  if (path.includes("/homework/") && (path.includes("/edit") || path.includes("/do"))) return true;
  // Interactive editor / play
  if (path.includes("/interactives/") && (path.includes("/edit") || path.includes("/editor") || path.includes("/play"))) {
    return true;
  }
  return false;
}

function hasUnsavedDomSignals() {
  if (typeof document === "undefined") return false;
  // Common dirty markers used across cabinet UIs
  if (document.querySelector("[data-unsaved='true'], [data-dirty='true'], .is-dirty, .cb-notify-alert--warn")) {
    return true;
  }
  // Active file upload
  if (document.querySelector("input[type='file'][data-uploading='true'], [data-uploading='true']")) {
    return true;
  }
  return false;
}

export function isAppUpdateUnsafe() {
  if (pathLooksUnsafe()) return true;
  if (hasUnsavedDomSignals()) return true;
  for (const fn of blockers) {
    try {
      if (fn()) return true;
    } catch {
      /* ignore blocker errors */
    }
  }
  return false;
}
