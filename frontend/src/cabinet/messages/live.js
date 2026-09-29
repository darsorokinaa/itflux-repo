export function messagingWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/messaging/`;
}

let activeSocket = null;
let connectionSeq = 0;

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const AUTH_CLOSE_CODES = new Set([4401, 4403]);

export function sendMessagingFrame(frame) {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  activeSocket.send(JSON.stringify(frame));
}

export function connectMessagingSocket({ onEvent, onOpenChange }) {
  const seq = ++connectionSeq;
  let socket = null;
  let closed = false;
  let attempt = 0;
  let everOpened = false;
  let timer = null;

  const connect = () => {
    if (closed || seq !== connectionSeq) return;
    try {
      socket = new WebSocket(messagingWsUrl());
    } catch {
      onOpenChange(false);
      return;
    }
    socket.onopen = () => {
      if (seq !== connectionSeq) {
        socket.close();
        return;
      }
      attempt = 0;
      everOpened = true;
      activeSocket = socket;
      onOpenChange(true);
    };
    socket.onmessage = (event) => {
      if (seq !== connectionSeq) return;
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onerror = () => {
      if (seq !== connectionSeq) return;
      onOpenChange(false);
    };
    socket.onclose = (event) => {
      if (activeSocket === socket) activeSocket = null;
      if (seq !== connectionSeq) return;
      onOpenChange(false);
      if (closed) return;
      const code = event && event.code;
      // 4401/4403 — сервер закрыл сокет: нет сессии, нет согласия или мессенджер выключен.
      // До accept браузер часто видит только 1006, поэтому после полной лестницы
      // backoff останавливаемся, если соединение ни разу не открылось.
      if (AUTH_CLOSE_CODES.has(code)) return;
      if (!everOpened && attempt >= RECONNECT_DELAYS_MS.length) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      attempt += 1;
      timer = window.setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    if (socket && socket.readyState < 2) socket.close();
    if (activeSocket === socket) activeSocket = null;
  };
}
