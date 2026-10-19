/**
 * Точки freedraw с iPad/iPhone — float32 с ~15 знаками (-9.59991455078125).
 * Для сохранения достаточно 0.01 px: визуально неотличимо, JSON в 2+ раза меньше.
 * Локальную сцену Excalidraw не трогаем — только payload PATCH.
 * version/versionNonce не меняются (сервер делает то же самое в compact_scene_data).
 */

const STROKE_TYPES = new Set(["freedraw", "line", "arrow"]);

function round(value: unknown, digits: number): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function quantizeStrokeElement<T>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  const el = raw as Record<string, unknown>;
  if (!STROKE_TYPES.has(String(el.type)) || el.isDeleted) return raw;
  let changed = false;
  let points = el.points;
  if (Array.isArray(points)) {
    const next = points.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) return pt;
      const x = round(pt[0], 2);
      const y = round(pt[1], 2);
      if (x === pt[0] && y === pt[1]) return pt;
      changed = true;
      return [x, y, ...pt.slice(2)];
    });
    if (changed) points = next;
  }
  let pressures = el.pressures;
  if (Array.isArray(pressures)) {
    let pChanged = false;
    const next = pressures.map((p) => {
      const q = round(p, 3);
      if (q !== p) pChanged = true;
      return q;
    });
    if (pChanged) {
      pressures = next;
      changed = true;
    }
  }
  if (!changed) return raw;
  return { ...el, points, pressures } as T;
}

export function quantizeSceneElementsForPersist<T>(elements: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(elements)) return [];
  return elements.map((el) => quantizeStrokeElement(el));
}
