const JOIN_URL_RE = /^https:\/\/telemost(?:\.360)?\.yandex\.(ru|com)\/j\/[A-Za-z0-9_-]+\/?(\?[^\s]*)?$/i;

export const TELEMOST_CALL_POPUP_NAME = "itflux-telemost-call";
export const TELEMOST_CALL_POPUP_WIDTH = 1280;
export const TELEMOST_CALL_POPUP_HEIGHT = 800;

export const POPUP_BLOCKED_MESSAGE = (
  "Браузер заблокировал окно Телемоста. Разрешите всплывающие окна и нажмите ещё раз."
);
export const IFRAME_NOTE = (
  "Яндекс не позволяет открыть Телемост в окне на странице урока. Звонок откроется отдельно."
);
export const INVALID_LINK_MESSAGE = "Не удалось получить ссылку на видеовстречу.";

export function isSafeTelemostJoinUrl(url) {
  if (typeof url !== "string" || !JOIN_URL_RE.test(url.trim())) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function popupFeatures() {
  const width = Math.min(TELEMOST_CALL_POPUP_WIDTH, Math.max(720, window.screen.availWidth - 80));
  const height = Math.min(TELEMOST_CALL_POPUP_HEIGHT, Math.max(480, window.screen.availHeight - 80));
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));
  return [
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    `left=${left}`,
    `top=${top}`,
    "toolbar=no",
    "menubar=no",
    "location=yes",
    "status=no",
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

export function reserveTelemostCallWindow() {
  let popup = window.open("about:blank", TELEMOST_CALL_POPUP_NAME, popupFeatures());
  if (!popup) {
    popup = window.open("about:blank", "_blank");
  }
  return popup || null;
}

export function navigateTelemostCallWindow(popup, url) {
  if (!isSafeTelemostJoinUrl(url)) {
    try { popup?.close(); } catch { /* ignore */ }
    return false;
  }
  if (popup && !popup.closed) {
    try {
      popup.location.href = url;
      popup.focus();
      return true;
    } catch {
      /* fall through to a new tab */
    }
  }
  const fallback = window.open(url, "_blank");
  return Boolean(fallback);
}
