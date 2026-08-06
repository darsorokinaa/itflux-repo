/** Яндекс.Метрика только после согласия на cookie; токены из URL не уходят в аналитику. */

export const COOKIE_CONSENT_KEY = "cookie_consent_accepted";
export const METRIKA_COUNTER_ID = 109757711;

const SENSITIVE_QUERY_KEYS = [
  "token",
  "lesson_token",
  "invite",
  "parent_invite",
  "ref",
  "referral",
  "code",
];

export function hasCookieConsent() {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCookieConsentAccepted() {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** URL для аналитики без секретов в query/path. */
export function sanitizeAnalyticsUrl(href) {
  try {
    const u = new URL(href || (typeof location !== "undefined" ? location.href : ""), "https://local.invalid");
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, "[redacted]");
      }
    }
    u.pathname = u.pathname
      .replace(/\/invite\/[^/]+\/?/gi, "/invite/[redacted]/")
      .replace(/\/parent\/invite\/accept\/[^/]+\/?/gi, "/parent/invite/accept/[redacted]/");
    if (u.origin === "https://local.invalid" && typeof location !== "undefined") {
      return `${location.origin}${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return typeof location !== "undefined" ? location.origin + "/" : "/";
  }
}

function loadMetrikaTag() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    if (typeof window.ym === "function" && window.__itfluxMetrikaTagLoaded) {
      resolve();
      return;
    }
    window.ym =
      window.ym ||
      function (...args) {
        (window.ym.a = window.ym.a || []).push(args);
      };
    window.ym.l = Date.now();
    const src = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_COUNTER_ID}`;
    if ([...document.scripts].some((s) => s.src === src)) {
      window.__itfluxMetrikaTagLoaded = true;
      resolve();
      return;
    }
    const k = document.createElement("script");
    k.async = true;
    k.src = src;
    k.onload = () => {
      window.__itfluxMetrikaTagLoaded = true;
      resolve();
    };
    k.onerror = () => reject(new Error("metrika load failed"));
    document.head.appendChild(k);
  });
}

/** Запуск Метрики один раз после согласия. */
export async function initYandexMetrika() {
  if (typeof window === "undefined") return false;
  if (!hasCookieConsent()) return false;
  if (window.__itfluxMetrikaStarted) return true;
  window.__itfluxMetrikaStarted = true;
  try {
    await loadMetrikaTag();
    const safeUrl = sanitizeAnalyticsUrl(window.location.href);
    window.ym(METRIKA_COUNTER_ID, "init", {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: "dataLayer",
      referrer: document.referrer,
      url: safeUrl,
      accurateTrackBounce: true,
      trackLinks: true,
    });
    return true;
  } catch {
    window.__itfluxMetrikaStarted = false;
    return false;
  }
}

/** Hit при смене маршрута (без секретов в URL). */
export function trackPageView(href) {
  if (typeof window === "undefined" || !window.__itfluxMetrikaStarted || typeof window.ym !== "function") {
    return;
  }
  try {
    window.ym(METRIKA_COUNTER_ID, "hit", sanitizeAnalyticsUrl(href || window.location.href));
  } catch {
    /* ignore */
  }
}
