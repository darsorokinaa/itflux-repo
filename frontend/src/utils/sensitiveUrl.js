/** Убрать секреты из адресной строки после чтения (history.replaceState). */

const SENSITIVE_QUERY_KEYS = [
  "token",
  "lesson_token",
  "invite",
  "parent_invite",
];

export const LESSON_TOKEN_STORAGE_KEY = "itflux_lesson_token";

export function readAndStoreLessonTokenFromUrl() {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    const fromQuery =
      (url.searchParams.get("token") || url.searchParams.get("lesson_token") || "").trim();
    if (fromQuery) {
      sessionStorage.setItem(LESSON_TOKEN_STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    return (sessionStorage.getItem(LESSON_TOKEN_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function getStoredLessonToken() {
  if (typeof window === "undefined") return "";
  try {
    return (sessionStorage.getItem(LESSON_TOKEN_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** Удалить чувствительные query-параметры из текущего URL без перезагрузки. */
export function stripSensitiveParamsFromUrl(extraKeys = []) {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of [...SENSITIVE_QUERY_KEYS, ...extraKeys]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, "", next);
    }
  } catch {
    /* ignore */
  }
}
