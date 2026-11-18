/** Код приглашения коллеги. Хранится отдельно от UTM (itflux_acq). */

export const COLLEAGUE_STORAGE_KEY = "cabinet_colleague_code";
export const COLLEAGUE_COOKIE = "itflux_colleague";
export const DEVICE_STORAGE_KEY = "itflux_device";
const DEVICE_COOKIE = "itflux_device";
const MAX_AGE = 60 * 60 * 24 * 90;
const CODE_RE = /^[A-Za-z0-9]{6,32}$/;

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function writeCookie(name, value) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${MAX_AGE};SameSite=Lax`;
}

export function cleanColleagueCode(value) {
  const text = String(value || "").trim().slice(0, 32);
  return CODE_RE.test(text) ? text : "";
}

export function captureColleagueCode(code) {
  const value = cleanColleagueCode(code);
  if (!value || typeof window === "undefined") return value;
  try {
    window.sessionStorage.setItem(COLLEAGUE_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
  writeCookie(COLLEAGUE_COOKIE, value);
  return value;
}

export function readColleagueCode() {
  if (typeof window === "undefined") return "";
  try {
    return cleanColleagueCode(
      window.sessionStorage.getItem(COLLEAGUE_STORAGE_KEY) || readCookie(COLLEAGUE_COOKIE),
    );
  } catch {
    return cleanColleagueCode(readCookie(COLLEAGUE_COOKIE));
  }
}

export function formatRuDays(count) {
  const number = Math.abs(Number(count) || 0);
  const tail = number % 100;
  const last = number % 10;
  let word = "дней";
  if (!(tail > 10 && tail < 20)) {
    if (last === 1) word = "день";
    else if (last >= 2 && last <= 4) word = "дня";
  }
  return `${number} ${word}`;
}

/** Keeps a stored colleague code on the registration entry, without changing other links. */
export function currentColleagueCode() {
  const stored = readColleagueCode();
  if (stored) return stored;
  if (typeof window === "undefined") return "";
  return cleanColleagueCode(new URLSearchParams(window.location.search).get("colleague"));
}

export function loginHrefWithColleague(href) {
  const code = currentColleagueCode();
  const raw = String(href || "");
  if (!code || !raw.startsWith("/cabinet/login")) return raw;
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  params.set("colleague", code);
  if (!params.get("mode")) params.set("mode", "register");
  if (!params.get("role")) params.set("role", "teacher");
  return `${path}?${params.toString()}`;
}

export function ensureDeviceId() {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY) || readCookie(DEVICE_COOKIE);
    if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) {
      writeCookie(DEVICE_COOKIE, existing);
      return existing;
    }
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
    writeCookie(DEVICE_COOKIE, id);
    return id;
  } catch {
    return "";
  }
}
