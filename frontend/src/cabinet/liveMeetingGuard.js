/**
 * Защита живого звонка от ухода со страницы встречи (r92).
 *
 * 20.10 (встречи 1156/1169): организатор во время урока переходил по ссылкам
 * кабинета (/cabinet, журнал, варианты) в той же вкладке — VideoMeetingPage
 * размонтировалась, Jitsi уходил с videoConferenceLeft, ученик видел обрыв.
 * Пока звонок идёт, внутренние ссылки, уводящие со страницы встречи,
 * открываем в новой вкладке; звонок остаётся в исходной.
 *
 * Скрытая вкладка (YaBrowser/Chromium) замораживается/выгружается браузером.
 * Вкладку, держащую Web Lock, Chromium не замораживает — держим lock, пока
 * звонок живой.
 */

const MEETING_PATH_RE = /^\/cabinet\/meetings\/([^/?#]+)\/?$/;

function normalizePath(pathname) {
  const p = String(pathname || "");
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Путь ведёт на эту же встречу (с query/hash) — уход не считаем. */
export function isSameMeetingPath(pathname, meetingUuid) {
  if (!meetingUuid) return false;
  const match = normalizePath(pathname).match(MEETING_PATH_RE);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === String(meetingUuid);
  } catch {
    return match[1] === String(meetingUuid);
  }
}

/**
 * Нужно ли открыть клик по ссылке в новой вкладке, чтобы не рвать звонок.
 * Чистая функция: на вход — данные клика и ссылки.
 */
export function shouldOpenLinkInNewTab({
  href,
  target = "",
  download = false,
  button = 0,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  defaultPrevented = false,
  allowInPlace = false,
  origin,
  currentHref,
  meetingUuid,
} = {}) {
  if (!meetingUuid || !href || defaultPrevented || allowInPlace || download) return false;
  // Модификаторы/средняя кнопка — браузер и так откроет новую вкладку.
  if (button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return false;
  const t = String(target || "").toLowerCase();
  if (t && t !== "_self") return false;
  let url;
  try {
    url = new URL(href, currentHref || origin);
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(url.protocol)) return false;
  if (origin && url.origin !== origin) return false; // внешние ссылки — не наша забота
  if (isSameMeetingPath(url.pathname, meetingUuid)) return false;
  return true;
}

/**
 * Вешает capture-обработчик кликов: ссылки внутри приложения, уводящие
 * со страницы встречи, открываются в новой вкладке. Возвращает отписку.
 * Ссылка с data-meeting-nav="in-place" уходит как обычно (явный выход).
 */
export function installLiveMeetingLinkGuard({
  meetingUuid,
  doc = typeof document !== "undefined" ? document : null,
  win = typeof window !== "undefined" ? window : null,
  onIntercept,
} = {}) {
  if (!doc || !win || !meetingUuid) return () => {};
  const onClick = (event) => {
    const start = event.target;
    const anchor = start && typeof start.closest === "function" ? start.closest("a[href]") : null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    const decision = shouldOpenLinkInNewTab({
      href,
      target: anchor.getAttribute("target") || "",
      download: anchor.hasAttribute("download"),
      button: event.button ?? 0,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      defaultPrevented: event.defaultPrevented,
      allowInPlace: anchor.closest("[data-meeting-nav='in-place']") != null,
      origin: win.location.origin,
      currentHref: win.location.href,
      meetingUuid,
    });
    if (!decision) return;
    event.preventDefault();
    event.stopPropagation();
    const absolute = new URL(href, win.location.href).toString();
    let opened = null;
    try {
      opened = win.open(absolute, "_blank", "noopener");
    } catch {
      opened = null;
    }
    onIntercept?.({ href: absolute, opened: Boolean(opened) });
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}

/**
 * Держит Web Lock, пока звонок живой: Chromium (вкл. YaBrowser) не замораживает
 * и не выгружает фоновые вкладки, удерживающие lock. Возвращает release().
 */
export function acquireLiveCallKeepAlive(meetingUuid, nav = typeof navigator !== "undefined" ? navigator : null) {
  const locks = nav?.locks;
  if (!meetingUuid || !locks || typeof locks.request !== "function") return () => {};
  let release = null;
  let released = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const p = locks.request(`itflux-live-call:${meetingUuid}:${Math.random().toString(36).slice(2, 8)}`, () => held);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    if (released) return;
    released = true;
    release?.();
  };
}
