// r124: доска, зависшая в «loading», переподключается сама.
// У ученика на iPhone 30.10 доска 4 минуты висела в «Подключаем доску…»:
// токен выдан, а сокет до сервера синхронизации так и не дошёл.

/** Сколько ждём первого «synced», прежде чем пересоздать соединение. */
export const BOARD_LOADING_STALL_MS = 12_000;
/** Пауза перед каждой автоматической попыткой (1-я, 2-я, …). */
export const BOARD_RECONNECT_BACKOFF_MS = [500, 2_000, 4_000, 8_000, 15_000];
export const BOARD_MAX_AUTO_RECONNECTS = BOARD_RECONNECT_BACKOFF_MS.length;

export function boardReconnectDelay(autoAttempt) {
  const index = Math.max(0, Math.min(Number(autoAttempt) || 0, BOARD_RECONNECT_BACKOFF_MS.length - 1));
  return BOARD_RECONNECT_BACKOFF_MS[index];
}

export function canAutoReconnect(autoAttempt) {
  return (Number(autoAttempt) || 0) < BOARD_MAX_AUTO_RECONNECTS;
}

export function isBoardSyncPending(status) {
  return status === "loading" || status === "error";
}

/**
 * Вызывает onWake, когда документ доски снова видим: вкладка вернулась
 * (visibilitychange / pageshow из bfcache в iOS Safari), сеть вернулась,
 * или рамка доски из нулевого размера (display:none при скрытии учителем)
 * снова получила размер.
 */
export function watchBoardWake({ node, onWake, win = typeof window !== "undefined" ? window : null }) {
  if (!win) return () => {};
  const doc = win.document;
  const fire = (reason) => {
    if (doc && doc.visibilityState === "hidden") return;
    onWake(reason);
  };
  const onVisibility = () => fire("visible");
  const onPageShow = (event) => fire(event?.persisted ? "pageshow-bfcache" : "pageshow");
  const onOnline = () => fire("online");
  doc?.addEventListener?.("visibilitychange", onVisibility);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("online", onOnline);
  // Сигнал от страницы урока: учитель снова показал доску.
  const onMessage = (event) => {
    if (event?.origin && win.location && event.origin !== win.location.origin) return;
    const data = event?.data;
    if (data?.source === "itflux-lesson-room" && data?.type === "board-visible") fire("reshown");
  };
  win.addEventListener("message", onMessage);
  let observer = null;
  if (node && typeof win.ResizeObserver === "function") {
    let wasZero = false;
    observer = new win.ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      const zero = !(rect.width > 0 && rect.height > 0);
      if (wasZero && !zero) fire("reshown");
      wasZero = zero;
    });
    observer.observe(node);
  }
  return () => {
    doc?.removeEventListener?.("visibilitychange", onVisibility);
    win.removeEventListener("pageshow", onPageShow);
    win.removeEventListener("online", onOnline);
    win.removeEventListener("message", onMessage);
    observer?.disconnect();
  };
}
