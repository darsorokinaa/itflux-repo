export const KONTUR_TALK_PROVIDER = "kontur_talk";

export const POPUP_BLOCKED_MESSAGE =
  "Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и нажмите «Открыть видеовстречу» ещё раз.";

export function isKonturMeetingUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ktalk\.ru$/.test(url.hostname);
}

function defaultOpen(url, target) {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  return window.open(url, target);
}

/** Пустая вкладка открывается в том же клике, до запроса ссылки. */
export function reserveMeetingTab(openWindow = defaultOpen) {
  const popup = openWindow("about:blank", "_blank");
  if (!popup) return null;
  try {
    popup.opener = null;
  } catch {
    /* вкладка уже изолирована браузером */
  }
  return popup;
}

export function navigateReservedTab(popup, url) {
  if (!popup || !isKonturMeetingUrl(url)) return false;
  popup.location.href = url;
  return true;
}

export function closeReservedTab(popup) {
  if (!popup) return;
  try {
    popup.close();
  } catch {
    /* вкладка уже закрыта */
  }
}
