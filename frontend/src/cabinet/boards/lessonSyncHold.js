/**
 * iPad: на синхронизированной доске Safari оставляет «следы» штриха, на локальной — нет.
 * Проверка (r27): при синхронизации DOM штриха тот же (откатов точек, пересоздания узлов нет),
 * отличается только сетевая работа во время рисования. Поэтому на iOS, пока перо/маркер
 * рисует, исходящие сообщения синхронизации копятся и уходят сразу после отрыва пера
 * (в исходном порядке). Остальные видят штрих после отрыва. Входящие не трогаем.
 * ?tldebug=nohold — выключить, ?tldebug=hold — включить и на десктопе.
 */
import { boardDebug } from "./boardDebug";

export const LESSON_SYNC_HOLD_MAX_MS = 8000;
const SYNC_PATH = "/ws/tldraw/";

export function isAppleTouch() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let active = null; // { held: [[socket, data]], since, isDrawing }
let patched = false;

function patchSocket() {
  if (patched || typeof WebSocket === "undefined") return;
  patched = true;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function lessonHeldSend(data) {
    if (active && String(this.url || "").includes(SYNC_PATH) && (active.held.length || active.isDrawing())) {
      if (!active.held.length) active.since = Date.now();
      active.held.push([this, data, send]);
      return;
    }
    return send.call(this, data);
  };
}

function flush() {
  if (!active || !active.held.length) return;
  const held = active.held;
  active.held = [];
  for (const [socket, data, send] of held) {
    // Закрытый сокет: клиент tldraw сам перешлёт несохранённое при переподключении.
    if (socket.readyState === 1) send.call(socket, data);
  }
}

export function installSyncHold(editor) {
  const on = !boardDebug.has("nohold") && (boardDebug.has("hold") || isAppleTouch());
  if (!on) return () => {};
  patchSocket();
  const state = {
    held: [],
    since: 0,
    isDrawing: () => editor.isIn("draw.drawing") || editor.isIn("highlight.drawing"),
  };
  active = state;
  const onTick = () => {
    if (!state.held.length) return;
    if (!state.isDrawing() || Date.now() - state.since > LESSON_SYNC_HOLD_MAX_MS) flush();
  };
  editor.on("tick", onTick);
  return () => {
    editor.off("tick", onTick);
    flush();
    if (active === state) active = null;
  };
}
