import { newObjectId } from "./notebookGeometry";

export const TOOL = {
  HAND: "hand",
  SELECT: "select",
  PEN: "pen",
  MARKER: "marker",
  ERASER: "eraser",
  TEXT: "text",
  LINE: "line",
  ARROW: "arrow",
  RECT: "rect",
  ELLIPSE: "ellipse",
};

export const ERASER_MODE = {
  STROKE: "stroke",
  OBJECT: "object",
};

export const QUICK_COLORS = [
  "#111827",
  "#DC2626",
  "#2563EB",
  "#059669",
  "#7C3AED",
  "#D97706",
  "#FACC15",
];

export function nowIso() {
  return new Date().toISOString();
}

export function pageAnnotations(page) {
  return Array.isArray(page?.state?.objects) ? page.state.objects : [];
}

export function withPageAnnotations(page, annotations) {
  return {
    ...page,
    state: {
      version: 1,
      objects: annotations,
    },
  };
}

export function replacePage(doc, pageId, nextPage) {
  return {
    ...doc,
    pages: (doc.pages || []).map((page) => (page.id === pageId ? nextPage : page)),
  };
}

export function setPageAnnotations(doc, pageId, annotations) {
  const page = (doc.pages || []).find((item) => item.id === pageId);
  if (!page) return doc;
  return replacePage(doc, pageId, withPageAnnotations(page, annotations));
}

export function normalizeAnnotation(raw, pageId = "") {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "pen");
  const id = String(raw.id || "").trim() || newObjectId();
  const stroke = raw.stroke || raw.color || "#DC2626";
  const strokeWidth = Number(raw.strokeWidth || raw.width || 3);
  const opacity = Number(raw.opacity ?? (type === "marker" ? 0.28 : 1));
  const base = {
    id,
    type,
    pageId: raw.pageId || pageId || "",
    rotation: Number(raw.rotation || 0),
    stroke,
    fill: raw.fill || "none",
    opacity,
    strokeWidth,
    fontSize: Number(raw.fontSize || 24),
    text: raw.text || "",
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
  };
  if (type === "pen" || type === "marker") {
    return {
      ...base,
      points: Array.isArray(raw.points) ? raw.points.map((pt) => ({
        x: Number(pt.x || 0),
        y: Number(pt.y || 0),
        pressure: Number(pt.pressure ?? 0.5),
      })) : [],
    };
  }
  if (type === "line" || type === "arrow") {
    return {
      ...base,
      x1: Number(raw.x1 || 0),
      y1: Number(raw.y1 || 0),
      x2: Number(raw.x2 || 0),
      y2: Number(raw.y2 || 0),
    };
  }
  if (type === "rect" || type === "rectangle") {
    return {
      ...base,
      type: "rect",
      x: Number(raw.x || 0),
      y: Number(raw.y || 0),
      w: Number(raw.w ?? raw.width ?? 0),
      h: Number(raw.h ?? raw.height ?? 0),
    };
  }
  if (type === "ellipse" || type === "circle") {
    return {
      ...base,
      type: "ellipse",
      cx: Number(raw.cx ?? raw.x ?? 0),
      cy: Number(raw.cy ?? raw.y ?? 0),
      rx: Math.abs(Number(raw.rx ?? raw.w ?? 20)),
      ry: Math.abs(Number(raw.ry ?? raw.h ?? 20)),
    };
  }
  if (type === "text") {
    return {
      ...base,
      x: Number(raw.x || 0),
      y: Number(raw.y || 0),
      w: Number(raw.w || 0),
      text: String(raw.text || ""),
    };
  }
  return base;
}

export function createAnnotation(type, props, pageId) {
  return normalizeAnnotation({
    id: newObjectId(),
    type,
    pageId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...props,
  }, pageId);
}

export function cloneAnnotation(annotation, dx = 16, dy = 16) {
  const next = normalizeAnnotation({
    ...annotation,
    id: newObjectId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, annotation.pageId);
  if (next.points) {
    next.points = next.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy }));
  }
  if (next.x != null) next.x += dx;
  if (next.y != null) next.y += dy;
  if (next.x1 != null) {
    next.x1 += dx;
    next.y1 += dy;
    next.x2 += dx;
    next.y2 += dy;
  }
  if (next.cx != null) {
    next.cx += dx;
    next.cy += dy;
  }
  return next;
}

export function toPersistedAnnotation(annotation) {
  const item = { ...annotation };
  if (item.stroke && !item.color) item.color = item.stroke;
  if (item.strokeWidth != null && item.width == null) item.width = item.strokeWidth;
  return item;
}
