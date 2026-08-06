/**
 * Client-side material state reducer — mirrors Cabinet/material_adapters.py.
 * Server remains authoritative; this keeps optimistic + remote apply identical.
 */

import {
  MAX_ANNOTATIONS,
  MAX_FIELD_VALUE_LEN,
  MAX_POINTS_PER_STROKE,
} from "./constants";

export function initialMaterialState() {
  return {
    page: 1,
    zoom: 1.0,
    scroll: 0.0,
    scrollX: 0.0,
    tab: "",
    annotations: [],
    answers: {},
    fields: {},
    items: {},
    pairs: [],
    notes: [],
    sheets: {},
    activeSheetId: "",
    activeCell: "",
    selection: null,
  };
}

function ensureList(state, key) {
  if (!Array.isArray(state[key])) state[key] = [];
  return state[key];
}

function ensureDict(state, key) {
  if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) {
    state[key] = {};
  }
  return state[key];
}

function isRow(value) {
  return Boolean(value && typeof value === "object" && ("value" in value || "author_id" in value));
}

function userAnswerBucket(state, key, authorId) {
  const root = ensureDict(state, key);
  const userKey = String(authorId);
  if (root && Object.keys(root).length && Object.values(root).every(isRow)) {
    const legacy = { ...root };
    Object.keys(root).forEach((k) => delete root[k]);
    for (const [itemId, row] of Object.entries(legacy)) {
      const owner = String(row.author_id ?? authorId);
      if (!root[owner] || typeof root[owner] !== "object") root[owner] = {};
      root[owner][String(itemId).slice(0, 64)] = row;
    }
  }
  if (!root[userKey] || typeof root[userKey] !== "object" || isRow(root[userKey])) {
    root[userKey] = {};
  }
  return root[userKey];
}

function normalizeAnnotation(payload, authorId, authorRole) {
  const annotation = payload?.annotation && typeof payload.annotation === "object"
    ? payload.annotation
    : payload;
  const annId = String(annotation?.id || "").slice(0, 64);
  if (!annId) throw new Error("annotation.id required");
  const points = Array.isArray(annotation.points) ? annotation.points : [];
  const cleanPoints = [];
  for (const point of points.slice(0, MAX_POINTS_PER_STROKE)) {
    if (!Array.isArray(point) || point.length < 2) continue;
    cleanPoints.push([Number(point[0]), Number(point[1])]);
  }
  return {
    id: annId,
    tool: String(annotation.tool || "pen").slice(0, 32),
    color: String(annotation.color || "#e11d48").slice(0, 32),
    width: Number(annotation.width) || 2,
    points: cleanPoints,
    text: String(annotation.text || "").slice(0, 500),
    page: Number(annotation.page) || 1,
    author_id: authorId,
    author_role: authorRole,
    created_at: annotation.created_at || annotation.createdAt,
    version: Number(annotation.version) || 1,
  };
}

/**
 * Apply one durable material operation to state. Returns a new state object.
 * @param {object} state
 * @param {{ action: string, payload?: object, authorId?: number|string, authorRole?: string }} op
 */
export function applyMaterialOperation(state, op) {
  const action = op?.action || "";
  const payload = op?.payload && typeof op.payload === "object" ? op.payload : {};
  const authorId = op?.authorId ?? op?.author_id ?? null;
  const authorRole = op?.authorRole ?? op?.author_role ?? "student";
  const next = {
    ...initialMaterialState(),
    ...(state && typeof state === "object" ? state : {}),
    annotations: Array.isArray(state?.annotations) ? [...state.annotations] : [],
    answers: { ...(state?.answers || {}) },
    fields: { ...(state?.fields || {}) },
    items: { ...(state?.items || {}) },
    pairs: Array.isArray(state?.pairs) ? [...state.pairs] : [],
    notes: Array.isArray(state?.notes) ? [...state.notes] : [],
    sheets: { ...(state?.sheets || {}) },
  };

  switch (action) {
    case "page_changed": {
      const page = Math.max(1, Math.min(10000, Number(payload.page) || 1));
      next.page = page;
      break;
    }
    case "scrolled": {
      const scroll = Math.max(0, Math.min(1, Number(payload.scroll) || 0));
      const scrollX = Math.max(0, Math.min(1, Number(payload.scrollX ?? payload.scroll_x) || 0));
      next.scroll = scroll;
      next.scrollX = scrollX;
      break;
    }
    case "zoom_changed": {
      next.zoom = Math.max(0.25, Math.min(4, Number(payload.zoom) || 1));
      break;
    }
    case "tab_changed": {
      next.tab = String(payload.tab || "").slice(0, 120);
      break;
    }
    case "viewport_changed": {
      if ("page" in payload) next.page = Math.max(1, Math.min(10000, Number(payload.page) || 1));
      if ("zoom" in payload) next.zoom = Math.max(0.25, Math.min(4, Number(payload.zoom) || 1));
      if ("scroll" in payload || "scrollX" in payload || "scroll_x" in payload) {
        next.scroll = Math.max(0, Math.min(1, Number(payload.scroll) || 0));
        next.scrollX = Math.max(0, Math.min(1, Number(payload.scrollX ?? payload.scroll_x) || 0));
      }
      break;
    }
    case "annotation_added":
    case "annotation_updated": {
      const ann = normalizeAnnotation(payload, authorId, authorRole);
      const list = ensureList(next, "annotations");
      const idx = list.findIndex((a) => a.id === ann.id);
      if (idx >= 0) {
        if (authorRole === "student" && list[idx].author_id != null
          && Number(list[idx].author_id) !== Number(authorId)) {
          break;
        }
        ann.author_id = list[idx].author_id ?? authorId;
        ann.author_role = list[idx].author_role ?? authorRole;
        list[idx] = ann;
      } else if (list.length < MAX_ANNOTATIONS) {
        list.push(ann);
      }
      next.annotations = list;
      break;
    }
    case "annotation_deleted": {
      const id = String(payload.id || payload.annotation_id || "").slice(0, 64);
      next.annotations = (next.annotations || []).filter((a) => {
        if (a.id !== id) return true;
        if (authorRole === "student" && Number(a.author_id) !== Number(authorId)) return true;
        return false;
      });
      break;
    }
    case "answer_selected": {
      const questionId = String(payload.questionId || payload.question_id || "").slice(0, 64);
      if (!questionId || authorId == null) break;
      let value = payload.value;
      if (typeof value === "string") value = value.slice(0, MAX_FIELD_VALUE_LEN);
      const bucket = userAnswerBucket(next, "answers", authorId);
      const prev = bucket[questionId] && typeof bucket[questionId] === "object" ? bucket[questionId] : {};
      let status = String(payload.status || "draft").slice(0, 32);
      if (!["draft", "submitted", "checked", "needs_revision"].includes(status)) status = "draft";
      bucket[questionId] = {
        value,
        author_id: authorId,
        author_role: authorRole,
        status,
        updated_at: payload.updated_at || payload.updatedAt || new Date().toISOString(),
        attempt: Number(payload.attempt || prev.attempt || 1),
        typing: Boolean(payload.typing),
      };
      break;
    }
    case "field_changed": {
      const fieldId = String(payload.fieldId || payload.field_id || "").slice(0, 64);
      if (!fieldId || authorId == null) break;
      let value = payload.value;
      if (typeof value === "string") value = value.slice(0, MAX_FIELD_VALUE_LEN);
      const bucket = userAnswerBucket(next, "fields", authorId);
      let status = String(payload.status || "draft").slice(0, 32);
      if (!["draft", "submitted", "checked", "needs_revision"].includes(status)) status = "draft";
      bucket[fieldId] = {
        value,
        author_id: authorId,
        author_role: authorRole,
        status,
        updated_at: payload.updated_at || payload.updatedAt || new Date().toISOString(),
        typing: Boolean(payload.typing),
      };
      break;
    }
    case "item_moved": {
      const itemId = String(payload.itemId || payload.item_id || "").slice(0, 64);
      if (!itemId) break;
      next.items[itemId] = {
        x: Math.max(0, Math.min(1, Number(payload.x) || 0)),
        y: Math.max(0, Math.min(1, Number(payload.y) || 0)),
        author_id: authorId,
        author_role: authorRole,
      };
      break;
    }
    case "item_selected": {
      const itemId = String(payload.itemId || payload.item_id || "").slice(0, 64);
      if (!itemId) break;
      next.items[itemId] = {
        ...(next.items[itemId] || {}),
        selected: payload.selected !== false,
        author_id: authorId,
        author_role: authorRole,
      };
      break;
    }
    case "pair_connected": {
      const left = String(payload.leftId || payload.left_id || "").slice(0, 64);
      const right = String(payload.rightId || payload.right_id || "").slice(0, 64);
      if (!left || !right) break;
      next.pairs = (next.pairs || []).filter((p) => !(p.leftId === left && p.rightId === right));
      next.pairs.push({ leftId: left, rightId: right, author_id: authorId, author_role: authorRole });
      break;
    }
    case "pair_disconnected": {
      const left = String(payload.leftId || payload.left_id || "").slice(0, 64);
      const right = String(payload.rightId || payload.right_id || "").slice(0, 64);
      next.pairs = (next.pairs || []).filter((p) => !(p.leftId === left && p.rightId === right));
      break;
    }
    case "cards_flipped": {
      const cardId = String(payload.cardId || payload.card_id || "").slice(0, 64);
      if (!cardId) break;
      next.items[cardId] = {
        ...(next.items[cardId] || {}),
        flipped: payload.flipped !== false,
        author_id: authorId,
        author_role: authorRole,
      };
      break;
    }
    case "text_note_added":
    case "text_note_updated": {
      const noteId = String(payload.id || "").slice(0, 64);
      if (!noteId) break;
      next.notes = (next.notes || []).filter((n) => n.id !== noteId);
      next.notes.push({
        id: noteId,
        text: String(payload.text || "").slice(0, MAX_FIELD_VALUE_LEN),
        x: Number(payload.x) || 0.5,
        y: Number(payload.y) || 0.5,
        page: Number(payload.page) || 1,
        author_id: authorId,
        author_role: authorRole,
      });
      break;
    }
    case "text_note_deleted": {
      const noteId = String(payload.id || "").slice(0, 64);
      next.notes = (next.notes || []).filter((n) => n.id !== noteId);
      break;
    }
    case "cell_updated": {
      const sheetId = String(payload.sheetId || payload.sheet_id || "sheet-1").slice(0, 64);
      const cell = String(payload.cell || "").toUpperCase().slice(0, 16);
      if (!cell) break;
      const sheets = ensureDict(next, "sheets");
      if (!sheets[sheetId] || typeof sheets[sheetId] !== "object") sheets[sheetId] = { cells: {} };
      if (!sheets[sheetId].cells || typeof sheets[sheetId].cells !== "object") sheets[sheetId].cells = {};
      sheets[sheetId].cells[cell] = {
        value: payload.value ?? null,
        formula: payload.formula ?? null,
        author_id: authorId,
        author_role: authorRole,
        revision: Number(payload.revision) || 0,
        updated_at: payload.updated_at || payload.updatedAt || new Date().toISOString(),
      };
      next.activeSheetId = sheetId;
      next.activeCell = cell;
      break;
    }
    case "sheet_changed": {
      next.activeSheetId = String(payload.sheetId || payload.sheet_id || "").slice(0, 64);
      break;
    }
    case "selection_changed": {
      next.selection = payload.selection || payload.range || null;
      next.activeCell = String(payload.cell || payload.activeCell || next.activeCell || "").slice(0, 16);
      break;
    }
    case "state_updated": {
      const patch = payload.patch && typeof payload.patch === "object" ? payload.patch : payload;
      const allowed = new Set(["answers", "fields", "items", "pairs", "tab", "page", "zoom", "scroll", "scrollX", "sheets", "activeSheetId", "activeCell"]);
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.has(key)) continue;
        if (["answers", "fields", "items", "sheets"].includes(key) && value && typeof value === "object") {
          next[key] = { ...(next[key] || {}), ...value };
        } else if (key === "pairs" && Array.isArray(value)) {
          next.pairs = value.slice(0, 200);
        } else {
          next[key] = value;
        }
      }
      break;
    }
    default:
      break;
  }
  return next;
}

/** Whether a student in follow mode may send this action (answers etc.). */
export function isFollowContentAction(action) {
  return FOLLOW_MODE_CONTENT_ACTIONS_SET.has(action);
}

const FOLLOW_MODE_CONTENT_ACTIONS_SET = new Set([
  "answer_selected",
  "field_changed",
  "item_moved",
  "item_selected",
  "pair_connected",
  "pair_disconnected",
  "cards_flipped",
  "state_updated",
]);

export function isNavigationAction(action) {
  return new Set([
    "page_changed",
    "scrolled",
    "zoom_changed",
    "tab_changed",
    "viewport_changed",
  ]).has(action);
}

export function isDrawAction(action) {
  return new Set([
    "annotation_added",
    "annotation_updated",
    "annotation_deleted",
    "text_note_added",
    "text_note_updated",
    "text_note_deleted",
    "annotation_preview",
  ]).has(action);
}
