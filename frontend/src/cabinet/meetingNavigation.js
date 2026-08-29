/**
 * Навигация в комнату урока для авторизованных teacher/student.
 *
 * Jitsi (lesson.itflux-academy.ru) — технический endpoint (script/iframe/wss).
 * Top-level browser origin должен оставаться origin приложения
 * (/cabinet/meetings/:uuid). Иначе iOS PWA (другой origin) выкидывает из сессии.
 */

export { STUDENT_HOME_ROUTE } from "./jitsiLeave";

const MEETING_PATH_RE = /^\/cabinet\/meetings\/([^/]+)\/?/;

export function cabinetMeetingPathFromHref(href) {
  if (!href || typeof href !== "string") return "";
  const raw = href.trim();
  if (!raw) return "";

  const fromPathname = (pathname) => {
    const match = String(pathname || "").match(MEETING_PATH_RE);
    const uuid = match?.[1] ? decodeURIComponent(match[1]).split(/[?#]/)[0] : "";
    return uuid ? `/cabinet/meetings/${uuid}` : "";
  };

  if (raw.startsWith("/")) {
    return fromPathname(raw.split(/[?#]/)[0]);
  }

  try {
    const absolute = new URL(raw);
    return fromPathname(absolute.pathname);
  } catch {
    return "";
  }
}

export function isCabinetMeetingHref(href) {
  return Boolean(cabinetMeetingPathFromHref(href));
}

/** Прямой URL комнаты Jitsi (не SPA кабинета). Нельзя делать top-level destination. */
export function isJitsiMeetPageUrl(href) {
  if (!href || typeof href !== "string") return false;
  if (cabinetMeetingPathFromHref(href)) return false;
  try {
    const absolute = new URL(href, "https://invalid.example");
    if (!/^https?:$/i.test(absolute.protocol)) return false;
    const host = absolute.hostname.toLowerCase();
    if (host === "meet.jit.si" || host === "8x8.vc") return true;
    if (host.startsWith("lesson.")) return true;
    const path = absolute.pathname.replace(/^\//, "").replace(/\/$/, "");
    const singleSegment = path.length > 0 && !path.includes("/");
    if (singleSegment && absolute.searchParams.has("jwt")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Куда вести авторизованного пользователя при «войти в комнату».
 * internal path — router navigate; external — публичные invite/Telemost;
 * jitsi — не открывать top-level.
 */
export function resolveAuthenticatedMeetingNavigation(href) {
  const path = cabinetMeetingPathFromHref(href);
  if (path) {
    return { kind: "internal", href: path };
  }
  if (isJitsiMeetPageUrl(href)) {
    return { kind: "jitsi-embed", href: "" };
  }
  const raw = typeof href === "string" ? href.trim() : "";
  if (/^https?:\/\//i.test(raw)) {
    return { kind: "external", href: raw };
  }
  return { kind: "none", href: "" };
}
