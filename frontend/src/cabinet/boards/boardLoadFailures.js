import { reportClientEvent } from "../../utils/clientTelemetry";

/**
 * r98: unhandled rejections / failed image+asset loads on the board page.
 * Board-specific allowance: at most BOARD_FAILURE_MAX_PER_MINUTE events per minute,
 * each asset URL reported once per page. Still goes through reportClientEvent,
 * so the global 40 POST/min cap and 429 Retry-After keep applying.
 */
export const BOARD_FAILURE_MAX_PER_MINUTE = 12;

let windowStart = 0;
let windowCount = 0;
const seenUrls = new Set();

export function resetBoardFailureBudget() {
  windowStart = 0;
  windowCount = 0;
  seenUrls.clear();
}

function takeBudget(now) {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= BOARD_FAILURE_MAX_PER_MINUTE) return false;
  windowCount += 1;
  return true;
}

/** Path only, never query/hash (signed tokens). data:/blob: are collapsed to their scheme. */
export function safeAssetUrl(raw, base = typeof window !== "undefined" ? window.location.href : "http://localhost/") {
  const value = String(raw || "");
  if (!value) return "";
  if (/^data:/i.test(value)) return `data:${(value.slice(5).split(/[;,]/, 1)[0] || "").slice(0, 40)}`;
  if (/^blob:/i.test(value)) return "blob:";
  try {
    const url = new URL(value, base);
    const sameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
    return (sameOrigin ? url.pathname : `${url.origin}${url.pathname}`).slice(0, 200);
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 200);
  }
}

export function navigationInfo(win = typeof window !== "undefined" ? window : null) {
  let type = "";
  try {
    const entry = win?.performance?.getEntriesByType?.("navigation")?.[0];
    if (entry?.type) type = String(entry.type);
    else {
      const legacy = win?.performance?.navigation?.type;
      type = ({ 0: "navigate", 1: "reload", 2: "back_forward" })[legacy] || "";
    }
  } catch {
    type = "";
  }
  return { nav_type: type.slice(0, 16) };
}

function report(event, extra, now = Date.now(), send = reportClientEvent) {
  if (!takeBudget(now)) return false;
  try {
    return send(event, extra);
  } catch {
    return false;
  }
}

async function probeStatus(url, fetchImpl) {
  if (!fetchImpl || !url || /^(data|blob):/i.test(url)) return 0;
  try {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin) return 0;
    const res = await fetchImpl(target.href, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    return Number(res?.status) || 0;
  } catch {
    return -1; // network failure
  }
}

function isBoardAssetElement(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "IMG" || tag === "IMAGE" || tag === "VIDEO" || tag === "SOURCE";
}

/**
 * Binds listeners on the board document. onFatal(reason) fires for an
 * unhandled rejection while the board is not ready yet (isReady() false).
 */
export function bindBoardLoadFailures(boardId, {
  win = typeof window !== "undefined" ? window : null,
  send = reportClientEvent,
  fetchImpl = typeof fetch !== "undefined" ? (...args) => fetch(...args) : null,
  isReady = () => true,
  onFatal = null,
} = {}) {
  if (!win || typeof win.addEventListener !== "function") return () => {};
  const id = String(boardId || "").slice(0, 64);

  const onRejection = (event) => {
    const reason = event?.reason;
    const ready = Boolean(isReady());
    report("board_unhandled_rejection", {
      board_id: id,
      message: String(reason?.message || reason || "rejection").slice(0, 200),
      name: String(reason?.name || "").slice(0, 40),
      ready,
    }, Date.now(), send);
    if (!ready && typeof onFatal === "function") onFatal("rejection");
  };

  const onResourceError = (event) => {
    const target = event?.target;
    if (!isBoardAssetElement(target)) return;
    const rawUrl = target.currentSrc || target.src || target.getAttribute?.("href") || "";
    const url = safeAssetUrl(rawUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    void probeStatus(rawUrl, fetchImpl).then((status) => {
      report("board_asset_load_failed", {
        board_id: id,
        url,
        status,
        tag: String(target.tagName || "").toLowerCase().slice(0, 12),
      }, Date.now(), send);
    });
  };

  win.addEventListener("unhandledrejection", onRejection);
  // Resource errors do not bubble: capture phase.
  win.addEventListener("error", onResourceError, true);
  return () => {
    win.removeEventListener("unhandledrejection", onRejection);
    win.removeEventListener("error", onResourceError, true);
  };
}

/** Asset store resolve/upload failures that never reach an <img>. */
export function reportBoardAssetFailure(boardId, url, status, send = reportClientEvent) {
  const safe = safeAssetUrl(url);
  if (safe && seenUrls.has(safe)) return false;
  if (safe) seenUrls.add(safe);
  return report("board_asset_load_failed", {
    board_id: String(boardId || "").slice(0, 64),
    url: safe,
    status: Number(status) || 0,
    tag: "store",
  }, Date.now(), send);
}
