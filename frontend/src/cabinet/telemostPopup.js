export function isTelemostMeetingUrl(url) {
  return /telemost(?:\.360)?\.yandex\.(ru|com)\/j\/[A-Za-z0-9_-]+/i.test(url || "");
}

export const TELEMOST_POPUP_NAME = "itflux-telemost";
export const TELEMOST_POPUP_WIDTH = 420;
export const TELEMOST_POPUP_HEIGHT = 720;

function popupPosition() {
  const left = Math.max(0, window.screenX + window.outerWidth - TELEMOST_POPUP_WIDTH - 24);
  const top = Math.max(0, window.screenY + window.outerHeight - TELEMOST_POPUP_HEIGHT - 24);
  return { left, top };
}

export function telemostPopupFeatures() {
  const { left, top } = popupPosition();
  return [
    `width=${TELEMOST_POPUP_WIDTH}`,
    `height=${TELEMOST_POPUP_HEIGHT}`,
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

function writeLoadingPage(popup) {
  try {
    popup.document.open();
    popup.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Телемост</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      color: #e2e8f0;
      font: 14px/1.4 system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body><p>Подключение к Телемосту…</p></body>
</html>`);
    popup.document.close();
  } catch {
    /* cross-origin after navigation */
  }
}

export function openTelemostPlaceholder(popupRef) {
  const features = telemostPopupFeatures();
  let popup = null;

  if (popupRef.current && !popupRef.current.closed) {
    popup = popupRef.current;
    popup.focus();
  } else {
    popup = window.open("about:blank", TELEMOST_POPUP_NAME, features);
    popupRef.current = popup;
  }

  if (!popup) return null;

  writeLoadingPage(popup);
  return popup;
}

export function navigateTelemostPopup(popupRef, url) {
  if (!url) return null;

  let popup = popupRef.current;
  if (!popup || popup.closed) {
    popup = window.open(url, TELEMOST_POPUP_NAME, telemostPopupFeatures());
    popupRef.current = popup;
  } else {
    popup.location.href = url;
    popup.focus();
  }

  return popup;
}

export function closeTelemostPopup(popupRef) {
  if (popupRef.current && !popupRef.current.closed) {
    popupRef.current.close();
  }
  popupRef.current = null;
}
