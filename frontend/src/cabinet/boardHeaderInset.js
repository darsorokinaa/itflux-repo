import { useEffect, useState } from "react";

// r149: плавающий «Видеоурок» не должен перекрывать шапку «Доски рядом»
// (переключатель «Моя доска / Доска группы», выбор ученика, вкладки на мобильном).
export const BOARD_HEADER_SELECTORS = [
  ".vb-panel:not(.vb-panel--hidden) .vb-panel-head",
  ".vb-tabs",
  ".vb-panel:not(.vb-panel--hidden) .vb-board-body > .vb-switch",
];
export const BOARD_HEADER_GAP = 8;

/** Нижняя граница видимых элементов шапки доски (px от верха окна), 0 — доски нет. */
export function boardHeaderBottom(doc = typeof document === "undefined" ? null : document) {
  if (!doc?.querySelectorAll) return 0;
  let bottom = 0;
  for (const sel of BOARD_HEADER_SELECTORS) {
    doc.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect?.();
      if (r && r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom);
    });
  }
  return Math.ceil(bottom);
}

/** Минимальный top для плавающего окна: ниже шапки доски, иначе fallback. */
export function floatingTopBelowBoard(headerBottom, fallback = 8) {
  return headerBottom > 0 ? Math.max(fallback, headerBottom + BOARD_HEADER_GAP) : fallback;
}

export function useBoardHeaderInset() {
  const [bottom, setBottom] = useState(() => boardHeaderBottom());
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setBottom(boardHeaderBottom()));
    };
    update();
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    mo?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      mo?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return bottom;
}
