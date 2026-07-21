/** Фон бумаги: клетки / линии для письма / точки. */

export type BoardGridStyle = "none" | "cells" | "ruled" | "dots";

export const GRID_STYLE_KEY = "itfluxGridStyle";
export const BG_COLOR_KEY = "itfluxBgColor";
/** Шаг клеток и точек при zoom 100% (в 2 раза крупнее стандартного Excalidraw) */
export const DEFAULT_GRID_SIZE = 40;
/** Высота строки для линий письма при zoom 100% */
export const RULED_LINE_SIZE = 56;

export function normalizeGridStyle(value: unknown, gridModeEnabled?: unknown): BoardGridStyle {
  if (value === "cells" || value === "ruled" || value === "dots" || value === "none") {
    return value;
  }
  // Старое значение «lines» = клетки
  if (value === "lines") return "cells";
  if (gridModeEnabled) return "cells";
  return "none";
}

export function usesPaperOverlay(style: BoardGridStyle): boolean {
  return style === "cells" || style === "ruled" || style === "dots";
}

/** Цвет бумаги (не transparent из режима оверлея). */
export function resolveBoardBgColor(appState: Record<string, unknown> | null | undefined): string {
  const stored = appState?.[BG_COLOR_KEY];
  if (typeof stored === "string" && stored && stored !== "transparent") return stored;
  const view = appState?.viewBackgroundColor;
  if (typeof view === "string" && view && view !== "transparent") return view;
  return "#ffffff";
}

export function gridAppStatePatch(
  style: BoardGridStyle,
  bgColor: string,
): Record<string, unknown> {
  const solid = bgColor || "#ffffff";
  const overlay = usesPaperOverlay(style);
  return {
    [GRID_STYLE_KEY]: style,
    [BG_COLOR_KEY]: solid,
    // Нативная сетка Excalidraw выключена — рисуем свою бумагу
    gridModeEnabled: false,
    gridSize: style === "ruled" ? RULED_LINE_SIZE : DEFAULT_GRID_SIZE,
    viewBackgroundColor: overlay ? "transparent" : solid,
  };
}

function readZoomScroll(appState: Record<string, unknown> | null | undefined) {
  const zoomRaw = appState?.zoom;
  const zoom =
    typeof zoomRaw === "object" && zoomRaw && "value" in zoomRaw
      ? Number((zoomRaw as { value: number }).value) || 1
      : 1;
  const scrollX = Number(appState?.scrollX) || 0;
  const scrollY = Number(appState?.scrollY) || 0;
  return { zoom, scrollX, scrollY };
}

/** Смещение CSS-паттерна под pan/zoom Excalidraw. */
export function paperOverlayStyle(
  style: BoardGridStyle,
  appState: Record<string, unknown> | null | undefined,
): { backgroundSize: string; backgroundPosition: string } {
  const { zoom, scrollX, scrollY } = readZoomScroll(appState);
  if (style === "ruled") {
    const step = RULED_LINE_SIZE;
    const size = Math.max(6, step * zoom);
    const posY = (scrollY % step) * zoom;
    return {
      backgroundSize: `100% ${size}px`,
      backgroundPosition: `0 ${posY}px`,
    };
  }
  const step = DEFAULT_GRID_SIZE;
  const size = Math.max(4, step * zoom);
  const posX = (scrollX % step) * zoom;
  const posY = (scrollY % step) * zoom;
  return {
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${posX}px ${posY}px`,
  };
}

/** @deprecated используйте paperOverlayStyle */
export function dotsOverlayStyle(
  appState: Record<string, unknown> | null | undefined,
): { backgroundSize: string; backgroundPosition: string } {
  return paperOverlayStyle("dots", appState);
}
