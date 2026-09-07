/**
 * Непрерывная толщина штриха в единицах Excalidraw (currentItemStrokeWidth /
 * element.strokeWidth). Не CSS px: редактор сам масштабирует по zoom.
 *
 * Штатные пресеты STROKE_WIDTH: thin=1, bold=2, extraBold=4.
 * Минимум слайдера заметно ниже thin — для письма стилусом.
 */

/** Текущий минимум трёх кнопок Excalidraw. */
export const BOARD_STROKE_WIDTH_LEGACY_MIN = 1;
export const BOARD_STROKE_WIDTH_MIN = 0.25;
/** Совпадает с extraBold — крупный маркер по-прежнему доступен. */
export const BOARD_STROKE_WIDTH_MAX = 4;
/** Чуть тоньше thin: формулы, цифры, рукописный текст. */
export const BOARD_STROKE_WIDTH_DEFAULT = 0.75;
export const BOARD_STROKE_SLIDER_MAX = 100;

export function clampBoardStrokeWidth(value: number): number {
  if (!Number.isFinite(value)) return BOARD_STROKE_WIDTH_DEFAULT;
  if (value < BOARD_STROKE_WIDTH_MIN) return BOARD_STROKE_WIDTH_MIN;
  if (value > BOARD_STROKE_WIDTH_MAX) return BOARD_STROKE_WIDTH_MAX;
  return value;
}

export function withBoardStrokeWidthDefault(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return clampBoardStrokeWidth(raw);
  return BOARD_STROKE_WIDTH_DEFAULT;
}

export function sliderToStrokeWidth(slider: number): number {
  const t = Number.isFinite(slider) ? slider / BOARD_STROKE_SLIDER_MAX : 0;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const width = BOARD_STROKE_WIDTH_MIN + u * (BOARD_STROKE_WIDTH_MAX - BOARD_STROKE_WIDTH_MIN);
  return Math.round(width * 100) / 100;
}

export function strokeWidthToSlider(width: number): number {
  const clamped = clampBoardStrokeWidth(width);
  const u = (clamped - BOARD_STROKE_WIDTH_MIN) / (BOARD_STROKE_WIDTH_MAX - BOARD_STROKE_WIDTH_MIN);
  return Math.round(u * BOARD_STROKE_SLIDER_MAX);
}

/** Высота превью-штриха в UI (не editor units). */
export function strokeWidthPreviewPx(width: number): number {
  const t = strokeWidthToSlider(width) / BOARD_STROKE_SLIDER_MAX;
  return Math.round((1.5 + t * 10) * 10) / 10;
}

export function patchElementStrokeWidth(
  el: Record<string, unknown>,
  width: number,
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(el, "strokeWidth")) return el;
  if (el.strokeWidth === width) return el;
  return {
    ...el,
    strokeWidth: width,
    version: (Number(el.version) || 0) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}

export function applyStrokeWidthToScene(opts: {
  elements: unknown[];
  selectedIds: string[];
  width: number;
}): unknown[] | null {
  const { elements, selectedIds, width } = opts;
  if (!selectedIds.length) return null;
  const idSet = new Set(selectedIds);
  let changed = false;
  const next = elements.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const el = raw as Record<string, unknown>;
    const id = el.id;
    if (typeof id !== "string" || !idSet.has(id)) return raw;
    const patched = patchElementStrokeWidth(el, width);
    if (patched !== el) changed = true;
    return patched;
  });
  return changed ? next : null;
}

export function selectedStrokeWidthIds(selectedElementIds: unknown): string[] {
  if (!selectedElementIds || typeof selectedElementIds !== "object") return [];
  return Object.entries(selectedElementIds as Record<string, unknown>)
    .filter(([, on]) => Boolean(on))
    .map(([id]) => id);
}
