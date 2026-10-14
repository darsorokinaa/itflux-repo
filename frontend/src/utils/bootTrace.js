/**
 * Метки старта. Время — performance.now() от начала навигации.
 * Не пишет токены, адреса и тела запросов.
 */

const LABELS = {
  html: "HTML загружен",
  main_js_start: "загрузка основного JS началась",
  main_js_done: "загрузка основного JS завершилась",
  main_jsx: "main.jsx начал выполнение",
  react_root: "React root создан",
  first_ui: "первый интерфейс отображён",
  auth_start: "запущена авторизация",
  auth_ok: "авторизация завершилась",
  auth_error: "авторизация завершилась ошибкой",
  api_ok: "первый API-запрос завершился",
  api_error: "первый API-запрос завершился ошибкой",
  sw_ok: "Service Worker зарегистрирован",
  sw_error: "Service Worker вернул ошибку",
  watchdog_hang: "watchdog обнаружил возможное зависание",
};

function bootNow() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return Math.round(performance.now());
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export function markBoot(stage, status) {
  if (typeof window === "undefined") return;
  const key = String(stage || "").slice(0, 40);
  if (!key) return;
  try {
    const existing = window.__itfluxBootMark;
    if (typeof existing === "function") {
      existing(key, status);
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    const seen = window.__ITFLUX_BOOT_SEEN || (window.__ITFLUX_BOOT_SEEN = {});
    if (seen[key]) return;
    seen[key] = 1;
    const entry = { t: bootNow(), stage: key };
    const note = status ? String(status).slice(0, 24) : "";
    if (note) entry.status = note;
    const log = window.__ITFLUX_BOOT_LOG || (window.__ITFLUX_BOOT_LOG = []);
    log.push(entry);
    if (log.length > 40) log.shift();
    const label = LABELS[key] || key;
    const suffix = note === "error" ? " ошибка" : "";
    console.info(`[ITFLUX_BOOT] +${entry.t}ms ${key} — ${label}${suffix}`);
  } catch {
    /* диагностика не должна ломать запуск */
  }
}

let authStarted = false;
let authFinished = false;

export function markBootAuthStart() {
  if (authStarted || authFinished) return;
  authStarted = true;
  markBoot("auth_start");
}

export function markBootAuthEnd(ok) {
  if (authFinished || !authStarted) return;
  authFinished = true;
  markBoot(ok ? "auth_ok" : "auth_error");
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

/** Первая завершившаяся /api/ отметка. Обёртка сразу возвращает исходный промис. */
export function installFirstApiProbe() {
  if (typeof window === "undefined" || window.__ITFLUX_API_PROBE) return;
  if (typeof window.fetch !== "function") return;
  window.__ITFLUX_API_PROBE = 1;
  const orig = window.fetch.bind(window);
  window.fetch = function itfluxBootFetch(input, init) {
    const result = orig(input, init);
    try {
      if (!window.__ITFLUX_API_MARKED && /\/api\//.test(requestUrl(input))) {
        window.__ITFLUX_API_MARKED = 1;
        Promise.resolve(result).then(
          (res) => {
            markBoot(res && res.ok === false ? "api_error" : "api_ok");
          },
          () => {
            markBoot("api_error");
          },
        );
      }
    } catch {
      /* ignore */
    }
    return result;
  };
}
