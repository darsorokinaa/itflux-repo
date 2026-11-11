/** First-touch UTM/ref and the promo code. Kept in localStorage and a cookie. */

export const ACQUISITION_STORAGE_KEY = "cabinet_acquisition";
export const PROMO_STORAGE_KEY = "itflux_promo_code";
const ACQUISITION_COOKIE = "itflux_acq";
const PROMO_COOKIE = "itflux_promo";
const MAX_AGE = 60 * 60 * 24 * 90;

const EMPTY_ACQUISITION = {
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  ref: "",
  referrer: "",
};

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function writeCookie(name, value) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${MAX_AGE};SameSite=Lax`;
}

function parseAcquisition(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      utm_source: String(parsed.utm_source || "").slice(0, 32),
      utm_medium: String(parsed.utm_medium || "").slice(0, 32),
      utm_campaign: String(parsed.utm_campaign || "").slice(0, 64),
      utm_content: String(parsed.utm_content || "").slice(0, 64),
      ref: String(parsed.ref || "").slice(0, 64),
      referrer: String(parsed.referrer || "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

function hasSignal(payload) {
  return Boolean(
    payload.utm_source || payload.utm_medium || payload.utm_campaign
    || payload.utm_content || payload.ref || payload.referrer,
  );
}

export function captureAcquisition({ search = "", referrer = "" } = {}) {
  const params = new URLSearchParams(search || "");
  const payload = {
    utm_source: (params.get("utm_source") || "").trim().slice(0, 32),
    utm_medium: (params.get("utm_medium") || "").trim().slice(0, 32),
    utm_campaign: (params.get("utm_campaign") || "").trim().slice(0, 64),
    utm_content: (params.get("utm_content") || "").trim().slice(0, 64),
    ref: (params.get("ref") || "").trim().slice(0, 64),
    referrer: String(referrer || "").slice(0, 200),
  };
  if (!hasSignal(payload) || typeof window === "undefined") return payload;
  try {
    if (!window.localStorage.getItem(ACQUISITION_STORAGE_KEY)) {
      const encoded = JSON.stringify(payload);
      window.localStorage.setItem(ACQUISITION_STORAGE_KEY, encoded);
      writeCookie(ACQUISITION_COOKIE, encoded);
    }
  } catch {
    /* ignore */
  }
  return payload;
}

export function readAcquisition() {
  if (typeof window === "undefined") return { ...EMPTY_ACQUISITION };
  try {
    const stored = parseAcquisition(window.localStorage.getItem(ACQUISITION_STORAGE_KEY))
      || parseAcquisition(readCookie(ACQUISITION_COOKIE))
      || parseAcquisition(window.sessionStorage.getItem(ACQUISITION_STORAGE_KEY));
    return stored || { ...EMPTY_ACQUISITION };
  } catch {
    return { ...EMPTY_ACQUISITION };
  }
}

export function savePromoCode(code) {
  const value = String(code || "").trim().slice(0, 64);
  if (!value || typeof window === "undefined") return "";
  try {
    window.localStorage.setItem(PROMO_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
  writeCookie(PROMO_COOKIE, value);
  return value;
}

export function clearPromoCode() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PROMO_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== "undefined") {
    document.cookie = `${PROMO_COOKIE}=;path=/;max-age=0;SameSite=Lax`;
  }
}

export function readPromoCode() {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(PROMO_STORAGE_KEY) || readCookie(PROMO_COOKIE);
    return String(stored || "").trim().slice(0, 64);
  } catch {
    return readCookie(PROMO_COOKIE).trim().slice(0, 64);
  }
}
