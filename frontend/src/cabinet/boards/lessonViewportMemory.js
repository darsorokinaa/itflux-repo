import {
  LESSON_VIEWPORT_SAVE_DELAY_MS,
  LESSON_ZOOM_STEPS,
  lessonViewportStorageKey,
  readLessonViewport,
  writeLessonViewport,
} from "./lessonShell";

/**
 * r114: камера доски переживает закрытие. Восстанавливаем в onMount (layout effect tldraw —
 * до первой отрисовки), сохраняем с задержкой и сразу при скрытии вкладки / уходе / размонтировании.
 * Слежение за участником (followingUserId) не трогаем: при слежении камеру не ставим
 * (setCamera в tldraw прекращает слежение) и чужой взгляд не сохраняем как свой.
 */
export function installLessonViewportMemory(editor, {
  userId,
  boardId,
  storage,
  target = typeof window !== "undefined" ? window : null,
  doc = typeof document !== "undefined" ? document : null,
  delay = LESSON_VIEWPORT_SAVE_DELAY_MS,
} = {}) {
  const key = lessonViewportStorageKey(userId, boardId);
  if (!editor || !key || !storage) return { restored: false, dispose() {} };

  const following = () => {
    try {
      return Boolean(editor.getInstanceState?.()?.followingUserId);
    } catch {
      return false;
    }
  };
  const snapshot = () => {
    const pageId = editor.getCurrentPageId?.();
    const camera = editor.getCamera?.();
    if (!pageId || !camera) return null;
    return { pageId, x: camera.x, y: camera.y, z: camera.z };
  };
  const same = (a, b) => Boolean(a && b)
    && a.pageId === b.pageId && a.x === b.x && a.y === b.y && a.z === b.z;

  let restored = false;
  if (!following()) {
    const saved = readLessonViewport(storage, userId, boardId, editor.getCurrentPageId?.());
    if (saved) {
      try {
        if (editor.setCameraOptions && editor.getCameraOptions) {
          editor.setCameraOptions({ ...editor.getCameraOptions(), zoomSteps: LESSON_ZOOM_STEPS });
        }
        editor.setCamera({ x: saved.x, y: saved.y, z: saved.z }, { immediate: true });
        restored = true;
      } catch (error) {
        console.error("failed to restore board viewport", error);
      }
    }
  }

  let last = snapshot();
  let pending = null;
  let timer = 0;
  let disposed = false;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    const value = pending;
    pending = null;
    if (!value) return;
    writeLessonViewport(storage, userId, boardId, value.pageId, value);
  };

  const onChange = () => {
    if (disposed || following()) return;
    const next = snapshot();
    if (!next || same(next, last)) return;
    last = next;
    pending = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };

  const flushNow = () => {
    onChange();
    flush();
  };
  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") flushNow();
  };

  const stopListen = editor.store?.listen?.(onChange, { scope: "session" }) || (() => {});
  target?.addEventListener?.("pagehide", flushNow);
  target?.addEventListener?.("beforeunload", flushNow);
  doc?.addEventListener?.("visibilitychange", onVisibility);

  return {
    restored,
    dispose() {
      if (disposed) return;
      flushNow();
      disposed = true;
      stopListen();
      target?.removeEventListener?.("pagehide", flushNow);
      target?.removeEventListener?.("beforeunload", flushNow);
      doc?.removeEventListener?.("visibilitychange", onVisibility);
    },
  };
}
