/**
 * r92b: живой звонок переживает SPA-навигацию внутри вкладки.
 *
 * VideoMeetingPage монтируется один раз в PersistentMeetingHost (корень App),
 * а не внутри маршрута. Пока звонок live, страница встречи остаётся
 * смонтированной на любых маршрутах приложения и показывается мини-плеером;
 * возврат на /cabinet/meetings/:uuid лишь меняет CSS (iframe не переносится в
 * DOM — перенос перезагрузил бы Jitsi). Явный выход/завершение очищает сессию.
 */
import { useSyncExternalStore } from "react";

let activeUuid = "";
const listeners = new Set();

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function getActiveLiveMeeting() {
  return activeUuid;
}

export function setActiveLiveMeeting(uuid) {
  const next = String(uuid || "");
  if (next === activeUuid) return;
  activeUuid = next;
  emit();
}

/** Снимает сессию; с uuid — только если активна именно эта встреча. */
export function clearActiveLiveMeeting(uuid) {
  if (!activeUuid) return;
  if (uuid && String(uuid) !== activeUuid) return;
  activeUuid = "";
  emit();
}

export function subscribeActiveLiveMeeting(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useActiveLiveMeeting() {
  return useSyncExternalStore(subscribeActiveLiveMeeting, getActiveLiveMeeting, getActiveLiveMeeting);
}

const MEETING_ROUTE_RE = /^\/cabinet\/meetings\/([^/?#]+)\/?$/;

export function meetingUuidFromPath(pathname) {
  const match = String(pathname || "").match(MEETING_ROUTE_RE);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Что рендерить в постоянном слое:
 * - на странице встречи — её же, во весь экран;
 * - на любом другом маршруте при живом звонке — мини-плеер этой встречи;
 * - иначе ничего.
 */
export function resolvePersistentMeetingView({ pathname, activeUuid: active = "" } = {}) {
  const routeUuid = meetingUuidFromPath(pathname);
  if (routeUuid) return { uuid: routeUuid, mode: "full" };
  if (active) return { uuid: String(active), mode: "mini" };
  return null;
}

/** Ссылку материала «в новой вкладке» во время звонка ведём SPA-переходом в этой вкладке. */
export function inAppPathForSameTab(url, origin = typeof window !== "undefined" ? window.location.origin : "") {
  if (!url) return "";
  try {
    const parsed = new URL(url, origin || "https://invalid.example");
    if (origin && parsed.origin !== origin) return "";
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    // Django-страницы (admin, api, media) — не SPA; их оставляем как есть.
    if (/^\/(admin|api|media|static)(\/|$)/.test(parsed.pathname)) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}
