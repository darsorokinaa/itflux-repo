export function messagingWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/messaging/`;
}

let activeSocket = null;

export function sendMessagingFrame(frame) {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  activeSocket.send(JSON.stringify(frame));
}

export function connectMessagingSocket({ onEvent, onOpenChange }) {
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const connect = () => {
    if (closed) return;
    try {
      socket = new WebSocket(messagingWsUrl());
    } catch {
      onOpenChange(false);
      return;
    }
    socket.onopen = () => {
      attempt = 0;
      activeSocket = socket;
      onOpenChange(true);
    };
    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onerror = () => {
      onOpenChange(false);
    };
    socket.onclose = () => {
      if (activeSocket === socket) activeSocket = null;
      onOpenChange(false);
      if (closed) return;
      attempt += 1;
      const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
      timer = window.setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    if (socket && socket.readyState < 2) socket.close();
  };
}
