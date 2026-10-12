/**
 * Камера открытой доски.
 *
 * Excalidraw: левый верх видимой области в координатах сцены — это (-scrollX, -scrollY).
 * tldraw: левый верх видимой области — это (-camera.x, -camera.y).
 * Поэтому camera.x = scrollX, а не -scrollX. Минус ставит взгляд на противоположную
 * сторону листа: фигуры есть, счётчик листа заполнен, на экране пусто.
 * Превью списка досок снимает все фигуры без камеры, поэтому материалы там видны.
 */

export type BoardRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function cameraFromExcalidrawScroll(scrollX: number, scrollY: number, zoom: number) {
  const z = Number(zoom);
  return {
    x: scrollX,
    y: scrollY,
    z: Number.isFinite(z) && z > 0 ? z : 1,
  };
}

/** true, когда прямоугольники не пересекаются. Нулевой viewport ещё не готов — это не промах. */
export function viewportMissesContent(
  view: BoardRect | null | undefined,
  content: BoardRect | null | undefined,
): boolean {
  if (!view || !content) return false;
  if (!(view.w > 8) || !(view.h > 8)) return false;
  if (!(content.w > 0) || !(content.h > 0)) return false;
  return view.x + view.w <= content.x
    || content.x + content.w <= view.x
    || view.y + view.h <= content.y
    || content.y + content.h <= view.y;
}

type FrameEditor = {
  getInstanceState?: () => { followingUserId?: string | null };
  getCurrentPageBounds?: () => BoardRect | null;
  getViewportPageBounds?: () => BoardRect | null;
  zoomToFit?: (opts?: { animation?: { duration: number } }) => void;
};

/** Показать лист, если камера смотрит мимо всех фигур. Слежение за участником не перебиваем. */
export function frameBoardIfContentIsOffscreen(editor: FrameEditor | null | undefined): boolean {
  if (!editor?.zoomToFit) return false;
  if (editor.getInstanceState?.().followingUserId) return false;
  const content = editor.getCurrentPageBounds?.() ?? null;
  const view = editor.getViewportPageBounds?.() ?? null;
  if (!viewportMissesContent(view, content)) return false;
  editor.zoomToFit({ animation: { duration: 0 } });
  return true;
}

/** Повтор после раскладки: на onMount размер viewport ещё бывает 0. */
export function revealBoardContent(editor: FrameEditor): () => void {
  let cancelled = false;
  const attempt = () => {
    if (!cancelled) frameBoardIfContentIsOffscreen(editor);
  };
  attempt();
  let second = 0;
  const first = requestAnimationFrame(() => {
    attempt();
    second = requestAnimationFrame(attempt);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(first);
    if (second) cancelAnimationFrame(second);
  };
}
