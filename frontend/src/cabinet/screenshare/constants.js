export const TOOLS = Object.freeze({
  POINTER: "pointer",
  LASER: "laser",
  PEN: "pen",
  HIGHLIGHTER: "highlighter",
  LINE: "line",
  ARROW: "arrow",
  RECT: "rect",
  ELLIPSE: "ellipse",
  TEXT: "text",
  ERASER: "eraser",
});

export const DRAWING_TOOLS = new Set([
  TOOLS.PEN,
  TOOLS.HIGHLIGHTER,
  TOOLS.LINE,
  TOOLS.ARROW,
  TOOLS.RECT,
  TOOLS.ELLIPSE,
  TOOLS.TEXT,
  TOOLS.ERASER,
  TOOLS.LASER,
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
];

export const WIDTHS = [2, 3, 5, 8];
export const MAX_TEXT_LEN = 280;
export const MAX_POINTS_PER_STROKE = 800;
export const MAX_POINTS_PER_BATCH = 40;
export const STROKE_FLUSH_MS = 40;
export const POINTER_THROTTLE_MS = 50;
export const LASER_TTL_MS = 2500;
export const MAX_ANNOTATIONS = 400;

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
