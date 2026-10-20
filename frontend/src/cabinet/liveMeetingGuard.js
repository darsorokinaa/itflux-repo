/**
 * Keep-alive живого звонка (r92). Навигацию внутри вкладки переживает
 * PersistentMeetingHost (r92b, см. liveMeetingSession.js).
 *
 * Скрытая вкладка (YaBrowser/Chromium) замораживается/выгружается браузером.
 * Вкладку, держащую Web Lock, Chromium не замораживает — держим lock, пока
 * звонок живой.
 */

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
