/**
 * r93: автопереход звонка на запасной канал cdn.itflux-academy.ru при повторяющихся обрывах сигнализации.
 * Только поведение (не IP/провайдер): ≥2 обрыва XMPP/конференции за 3 мин или таймаут входа на основном хосте.
 * Сессия переносится одноразовым серверным токеном (/api/cdn-handoff/issue/ → redeem на cdn).
 * ?itflux_nocdn=1 отключает (window.__ITFLUX_NO_CDN из r86).
 */
export const CDN_HOST = "cdn.itflux-academy.ru";
export const MAIN_HOSTS = ["itflux-academy.ru", "www.itflux-academy.ru"];
export const PREFER_KEY = "itfluxPreferCdn"; // флаг r86 (7 дней)
export const DROP_THRESHOLD = 2;
export const DROP_WINDOW_MS = 3 * 60 * 1000;
export const NOTICE_TEXT = "Связь нестабильна — переключаем на запасной канал";
const GUARD_KEY = "itfluxCdnSwitchAt";

export function isMainHost(hostname) {
  return MAIN_HOSTS.includes(String(hostname || "").toLowerCase());
}

export function stripVersionParam(search) {
  const params = new URLSearchParams(search || "");
  params.delete("_itflux_v");
  params.delete("itflux_nocdn");
  params.delete("itflux_cdn");
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Скользящее окно событий обрыва. */
export function createDropDetector({ threshold = DROP_THRESHOLD, windowMs = DROP_WINDOW_MS, now = () => Date.now() } = {}) {
  let events = [];
  return {
    record(kind = "drop") {
      const t = now();
      events = events.filter((e) => t - e.t < windowMs);
      events.push({ t, kind });
      return events.length >= threshold;
    },
    count() {
      const t = now();
      return events.filter((e) => t - e.t < windowMs).length;
    },
  };
}

/** Классификация событий Jitsi External API: что считаем обрывом сигнализации. */
export function isSignalingDropEvent(name, event) {
  if (name === "connectionFailed") return true;
  if (name === "conferenceFailed") {
    const err = String(event?.error || event?.name || "").toLowerCase();
    return !/auth|password|members_only|not_allowed/.test(err);
  }
  if (name === "errorOccurred") {
    const n = String(event?.name || "").toLowerCase();
    const type = String(event?.type || "").toUpperCase();
    return type === "CONNECTION" || n.startsWith("connection.");
  }
  return false;
}

export function cdnSwitchAllowed(win = typeof window !== "undefined" ? window : null) {
  if (!win?.location) return false;
  if (!isMainHost(win.location.hostname)) return false;
  if (win.__ITFLUX_NO_CDN) return false;
  if (/[?&]itflux_nocdn=1(&|$)/.test(win.location.search || "")) return false;
  try {
    const at = Number(win.sessionStorage?.getItem(GUARD_KEY)) || 0;
    if (at && Date.now() - at < 5 * 60 * 1000) return false; // без циклов
  } catch {
    /* ignore */
  }
  return true;
}

function readCsrf(doc) {
  const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc?.cookie || "");
  return m ? decodeURIComponent(m[1]) : "";
}

export function showSwitchNotice(doc = typeof document !== "undefined" ? document : null) {
  if (!doc?.body) return;
  let box = doc.getElementById("itflux-cdn-hint");
  if (!box) {
    box = doc.createElement("div");
    box.id = "itflux-cdn-hint";
    box.setAttribute("role", "status");
    doc.body.appendChild(box);
  }
  box.textContent = NOTICE_TEXT;
}

let switching = false;

/** Переводит эту же вкладку на ту же встречу на cdn. Возвращает Promise<boolean>. */
export async function switchToCdn(reason = "call_drops", {
  win = typeof window !== "undefined" ? window : null,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  delayMs = 1500,
} = {}) {
  if (switching || !cdnSwitchAllowed(win)) return false;
  switching = true;
  const loc = win.location;
  const next = `${loc.pathname}${stripVersionParam(loc.search)}${loc.hash || ""}`;
  try {
    win.sessionStorage?.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  try {
    win.localStorage?.setItem(PREFER_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  if (reason !== "pinned") showSwitchNotice(win.document);
  let target = `https://${CDN_HOST}${next}`;
  for (let attempt = 0; attempt < 2 && fetchImpl; attempt += 1) {
    try {
      const res = await fetchImpl("/api/cdn-handoff/issue/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": readCsrf(win.document) },
        body: JSON.stringify({ next, reason }),
      });
      if (res?.ok) {
        const data = await res.json();
        if (typeof data?.url === "string" && data.url.startsWith(`https://${CDN_HOST}/`)) {
          target = data.url;
          break;
        }
      }
    } catch {
      /* основной хост недоступен — уходим на cdn без токена (там вход) */
    }
  }
  await new Promise((r) => setTimeout(r, delayMs));
  try {
    (win.__ITFLUX_NAVIGATE || ((u) => win.location.replace(u)))(target);
  } catch {
    /* ignore */
  }
  return true;
}

/** Подписывает детектор на события одного Jitsi External API. */
export function attachCdnAutoSwitch(api, { detector = createDropDetector(), onSwitch = switchToCdn, win } = {}) {
  if (!api?.addListener) return () => {};
  if (!cdnSwitchAllowed(win || (typeof window !== "undefined" ? window : null))) return () => {};
  let joins = 0;
  const handlers = [];
  const on = (name, fn) => {
    try {
      api.addListener(name, fn);
      handlers.push([name, fn]);
    } catch {
      /* ignore */
    }
  };
  const drop = (kind) => {
    if (detector.record(kind)) void onSwitch("call_drops");
  };
  ["connectionFailed", "conferenceFailed", "errorOccurred"].forEach((name) => {
    on(name, (ev) => {
      if (isSignalingDropEvent(name, ev)) drop(name);
    });
  });
  // Повторный videoConferenceJoined в том же API = переподключение после обрыва.
  on("videoConferenceJoined", () => {
    joins += 1;
    if (joins > 1) drop("rejoin");
  });
  return () => {
    for (const [n, fn] of handlers) {
      try {
        api.removeListener?.(n, fn);
      } catch {
        /* ignore */
      }
    }
  };
}

/** r93b: серверный флаг cdn (закреплён вручную или недавние обрывы) — сразу на cdn с токеном. */
export async function redirectIfServerPrefersCdn({
  win = typeof window !== "undefined" ? window : null,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
} = {}) {
  if (!fetchImpl || !cdnSwitchAllowed(win)) return false;
  try {
    const res = await fetchImpl("/api/cdn-handoff/pref/", { credentials: "same-origin" });
    if (!res?.ok) return false;
    const data = await res.json();
    if (!data?.prefer_cdn) return false;
    return switchToCdn(data.reason === "pinned" ? "pinned" : "call_drops", { win, fetchImpl, delayMs: 0 });
  } catch {
    return false;
  }
}
