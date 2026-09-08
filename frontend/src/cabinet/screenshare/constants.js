export const TOOLS = Object.freeze({
  POINTER: "pointer",
  MOUSE: "pointer",
  SELECT: "select",
  LASER: "laser",
  SPOTLIGHT: "spotlight",
  PEN: "pen",
  HIGHLIGHTER: "highlighter",
  VANISHING: "vanishing",
  LINE: "line",
  ARROW: "arrow",
  RECT: "rect",
  ELLIPSE: "ellipse",
  TEXT: "text",
  STAMP: "stamp",
  ARROW_POINTER: "arrow_pointer",
  ERASER: "eraser",
});

export const DRAWING_TOOLS = new Set([
  TOOLS.PEN,
  TOOLS.HIGHLIGHTER,
  TOOLS.VANISHING,
  TOOLS.LINE,
  TOOLS.ARROW,
  TOOLS.RECT,
  TOOLS.ELLIPSE,
  TOOLS.TEXT,
  TOOLS.STAMP,
  TOOLS.ARROW_POINTER,
  TOOLS.ERASER,
  TOOLS.LASER,
  TOOLS.SPOTLIGHT,
  TOOLS.SELECT,
]);

export const PASSTHROUGH_TOOLS = new Set([TOOLS.POINTER, TOOLS.MOUSE]);

export const EPHEMERAL_TOOLS = new Set([
  TOOLS.LASER,
  TOOLS.SPOTLIGHT,
  TOOLS.VANISHING,
]);

export const SHAPE_TOOLS = new Set([
  TOOLS.LINE,
  TOOLS.ARROW,
  TOOLS.RECT,
  TOOLS.ELLIPSE,
]);

export const PRESENTER_ONLY_TOOLS = new Set([
  TOOLS.SELECT,
  TOOLS.SPOTLIGHT,
  TOOLS.VANISHING,
]);

export const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#0f172a",
  "#ffffff",
];

export const WIDTHS = [1, 2, 4, 8];
export const WIDTH_PRESETS = [
  { value: 1, label: "Тонкая" },
  { value: 2, label: "Средняя" },
  { value: 4, label: "Толстая" },
  { value: 8, label: "Очень толстая" },
];
export const TEXT_SIZES = [
  { value: 14, label: "S" },
  { value: 18, label: "M" },
  { value: 24, label: "L" },
  { value: 32, label: "XL" },
];
export const TEXT_WEIGHTS = [
  { value: 500, label: "Обычный" },
  { value: 700, label: "Жирный" },
];
export const STAMP_KINDS = [
  { id: "star", label: "Звезда" },
  { id: "check", label: "Галочка" },
  { id: "cross", label: "Крестик" },
  { id: "heart", label: "Сердце" },
  { id: "arrow", label: "Стрелка" },
];
export const MAX_TEXT_LEN = 280;
export const MAX_POINTS_PER_STROKE = 800;
export const MAX_POINTS_PER_BATCH = 40;
export const STROKE_FLUSH_MS = 40;
export const POINTER_THROTTLE_MS = 50;
export const LASER_TTL_MS = 2500;
export const VANISHING_TTL_MS = 3200;
export const NAME_LABEL_TTL_MS = 2200;
export const MAX_ANNOTATIONS = 400;
export const HIGHLIGHTER_OPACITY_DEFAULT = 0.38;

export function isPassthroughTool(tool) {
  return PASSTHROUGH_TOOLS.has(String(tool || ""));
}

export function isEphemeralTool(tool) {
  return EPHEMERAL_TOOLS.has(String(tool || ""));
}

export function participantColor(userId) {
  const n = Number(userId);
  if (!Number.isFinite(n) || n <= 0) return PALETTE[0];
  return PALETTE[Math.abs(n) % PALETTE.length];
}

export function newAnnotationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Teacher always draws. Student only after an explicit teacher grant. */
export function canDrawScreenShareAnnotations({
  canManage = false,
  participantsCanAnnotate = false,
} = {}) {
  return Boolean(canManage || participantsCanAnnotate === true);
}
