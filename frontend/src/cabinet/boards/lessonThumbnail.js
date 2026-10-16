/**
 * Превью доски tldraw для списка досок. Пишет только поле thumbnail (PATCH без сцены и version),
 * содержимое доски не трогает. Best-effort: любые ошибки молча игнорируются.
 */
import { updateInteractiveBoard } from "../../utils/cabinetAuth";

const MAX_SIDE = 420;
const MAX_CHARS = 180_000;
const FIRST_DELAY_MS = 3500;
const CHANGE_DELAY_MS = 5000;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function captureTldrawThumbnail(editor) {
  if (!editor) return null;
  const ids = [...editor.getCurrentPageShapeIds()];
  if (!ids.length) return null;
  const bounds = editor.getCurrentPageBounds?.();
  const side = bounds ? Math.max(bounds.w, bounds.h, 1) : MAX_SIDE;
  const scale = Math.min(1, MAX_SIDE / side);
  const result = await editor.toImage(ids, {
    format: "jpeg",
    quality: 0.6,
    background: true,
    darkMode: false,
    padding: 16,
    scale,
    pixelRatio: 1,
  });
  if (!result?.blob) return null;
  const url = await blobToDataUrl(result.blob);
  if (!url || url.length > MAX_CHARS) return null;
  return url;
}

export function installLessonThumbnail(editor, { boardId, canEdit }) {
  if (!editor || !boardId || !canEdit || typeof editor.toImage !== "function") return () => {};
  let timer = null;
  let disposed = false;
  let busy = false;
  let last = "";
  const run = async () => {
    timer = null;
    if (disposed || busy) return;
    busy = true;
    try {
      const thumbnail = await captureTldrawThumbnail(editor);
      if (!disposed && thumbnail && thumbnail !== last) {
        await updateInteractiveBoard(boardId, { thumbnail });
        last = thumbnail;
      }
    } catch {
      /* preview is best-effort */
    } finally {
      busy = false;
    }
  };
  const schedule = (delay) => {
    if (disposed) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 8000 });
      else run();
    }, delay);
  };
  schedule(FIRST_DELAY_MS);
  const stop = editor.store.listen(() => schedule(CHANGE_DELAY_MS), { scope: "document" });
  const flush = () => { if (timer) { window.clearTimeout(timer); run(); } };
  window.addEventListener("pagehide", flush);
  return () => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
    window.removeEventListener("pagehide", flush);
    stop?.();
  };
}
