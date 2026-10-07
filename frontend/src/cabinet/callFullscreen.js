/** Настоящий Fullscreen API для контейнера звонка. CSS — только если API нет. */

export function currentFullscreenElement() {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function fullscreenApiAvailable(node) {
  if (!node) return false;
  return typeof node.requestFullscreen === "function"
    || typeof node.webkitRequestFullscreen === "function";
}

export function requestNodeFullscreen(node) {
  if (!node) return Promise.reject(new Error("fullscreen_target"));
  if (typeof node.requestFullscreen === "function") {
    return Promise.resolve(node.requestFullscreen());
  }
  if (typeof node.webkitRequestFullscreen === "function") {
    try {
      node.webkitRequestFullscreen();
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return Promise.reject(Object.assign(new Error("fullscreen_unavailable"), { name: "NotSupportedError" }));
}

export function exitDocumentFullscreen() {
  if (typeof document === "undefined") return Promise.resolve();
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    return Promise.resolve(document.exitFullscreen());
  }
  if (document.webkitFullscreenElement && typeof document.webkitExitFullscreen === "function") {
    try {
      document.webkitExitFullscreen();
    } catch {
      /* ignore */
    }
  }
  return Promise.resolve();
}

/** iPadOS бросает NotSupportedError, если элемент нельзя развернуть. Это не отказ пользователя. */
export function fullscreenNeedsFallback(error) {
  const name = String(error?.name || "");
  if (name === "NotSupportedError" || name === "TypeError" || name === "InvalidStateError") return true;
  const message = String(error?.message || "");
  return message === "fullscreen_unavailable";
}
