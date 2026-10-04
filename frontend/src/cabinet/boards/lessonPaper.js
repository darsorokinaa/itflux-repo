/** Фон урока. Хранится в документе tldraw, поэтому его видят оба браузера. */

export const LESSON_PAPER_CELL = 32;

export const LESSON_PAPER_MODES = [
  { id: "blank", label: "Чистый" },
  { id: "grid", label: "Клетка" },
  { id: "dots", label: "Точки" },
  { id: "lines", label: "Линия" },
  { id: "slant", label: "Косая" },
];

export const LESSON_PAPER_COLORS = [
  { id: "white", label: "Белый", value: "#ffffff" },
  { id: "gray", label: "Серый", value: "#f4f5f7" },
  { id: "cream", label: "Крем", value: "#fff8ee" },
  { id: "blue", label: "Голубой", value: "#eef5ff" },
  { id: "green", label: "Зелёный", value: "#f3faf4" },
  { id: "yellow", label: "Жёлтый", value: "#fff6d8" },
  { id: "dark", label: "Тёмный", value: "#1c2430", marks: "light" },
  { id: "board", label: "Доска", value: "#1a6b45", marks: "light" },
];

const MODE_IDS = new Set(LESSON_PAPER_MODES.map((item) => item.id));
const COLOR_VALUES = new Set(LESSON_PAPER_COLORS.map((item) => item.value));

export function readLessonPaper(meta) {
  const raw = meta && typeof meta.lessonPaper === "object" ? meta.lessonPaper : null;
  return {
    mode: MODE_IDS.has(raw?.mode) ? raw.mode : "blank",
    color: COLOR_VALUES.has(raw?.color) ? raw.color : "#ffffff",
  };
}

export function withLessonPaper(meta, patch) {
  const current = readLessonPaper(meta);
  const next = {
    mode: MODE_IDS.has(patch?.mode) ? patch.mode : current.mode,
    color: COLOR_VALUES.has(patch?.color) ? patch.color : current.color,
  };
  return { ...(meta || {}), lessonPaper: next };
}

export function lessonPaperOffset(cameraX, cameraY, zoom, cell = LESSON_PAPER_CELL) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const size = cell * z;
  return {
    size,
    x: positiveMod(0.5 + Number(cameraX || 0) * z, size),
    y: positiveMod(0.5 + Number(cameraY || 0) * z, size),
  };
}

function positiveMod(value, size) {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return 0;
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}
