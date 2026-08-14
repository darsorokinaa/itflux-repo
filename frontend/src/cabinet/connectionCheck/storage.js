/**
 * Последний результат проверки связи — только локально.
 * Не является гарантией качества будущего звонка.
 */

export const CONNECTION_CHECK_STORAGE_KEY = "itflux.connectionCheck.v1";
export const CONNECTION_CHECK_MAX_AGE_MS = 18 * 60 * 60 * 1000;

export function browserHint() {
  if (typeof navigator === "undefined") return "";
  const ua = String(navigator.userAgent || "");
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

export function deviceHint() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = String(navigator.userAgent || "");
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function readConnectionCheckResult() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONNECTION_CHECK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.checked_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const CONNECTION_CHECK_RESULT_EVENT = "cabinet:connection-check-result";

export function writeConnectionCheckResult(result) {
  if (typeof window === "undefined") return null;
  const payload = {
    checked_at: result.checked_at || new Date().toISOString(),
    camera: result.camera || "unknown",
    microphone: result.microphone || "unknown",
    speaker: result.speaker || "unknown",
    connection: result.connection || "unknown",
    jitsi: result.jitsi || "unknown",
    browser: browserHint(),
    device_type: deviceHint(),
  };
  try {
    window.localStorage.setItem(CONNECTION_CHECK_STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(CONNECTION_CHECK_RESULT_EVENT, { detail: payload }));
  } catch {
    /* quota / private mode */
  }
  return payload;
}

export function isConnectionCheckFresh(result = readConnectionCheckResult(), now = Date.now()) {
  if (!result?.checked_at) return false;
  const checked = new Date(result.checked_at).getTime();
  if (Number.isNaN(checked)) return false;
  if (now - checked > CONNECTION_CHECK_MAX_AGE_MS) return false;
  const checkedDay = new Date(checked);
  const today = new Date(now);
  if (
    checkedDay.getFullYear() !== today.getFullYear()
    || checkedDay.getMonth() !== today.getMonth()
    || checkedDay.getDate() !== today.getDate()
  ) {
    return false;
  }
  if (result.browser && result.browser !== browserHint()) return false;
  if (result.device_type && result.device_type !== deviceHint()) return false;
  return true;
}

export function formatCheckedAt(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function minutesUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return null;
  return Math.round((start - now) / 60000);
}

export function shouldRemindBeforeLesson(startsAt, now = Date.now()) {
  if (!startsAt) return false;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  const minutes = (start - now) / 60000;
  return minutes > 0 && minutes <= 10 && !isConnectionCheckFresh(readConnectionCheckResult(), now);
}
