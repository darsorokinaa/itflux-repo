/** Shared material collaboration constants (mirrors Cabinet/material_adapters.py). */

export const NAVIGATION_ACTIONS = Object.freeze([
  "page_changed",
  "scrolled",
  "zoom_changed",
  "tab_changed",
  "viewport_changed",
]);

export const EPHEMERAL_ACTIONS = Object.freeze([
  "cursor",
  "pointer",
  "drag_preview",
  "annotation_preview",
  "student_viewport",
]);

export const VIEWPORT_THROTTLE_MS = 100;

export const FOLLOW_MODE_CONTENT_ACTIONS = Object.freeze([
  "answer_selected",
  "field_changed",
  "item_moved",
  "item_selected",
  "pair_connected",
  "pair_disconnected",
  "cards_flipped",
  "state_updated",
]);

export const COLLAB_PERMISSIONS = Object.freeze({
  ANSWERS_ONLY: "answers_only",
  ANNOTATE: "annotate",
  EDIT_CONTENT: "edit_content",
  FULL: "full",
});

export const MAX_ANNOTATIONS = 500;
export const MAX_POINTS_PER_STROKE = 800;
export const MAX_FIELD_VALUE_LEN = 4000;

/** Throttle / debounce budgets (ms). */
export const THROTTLE = Object.freeze({
  POINTER_MS: 40,
  CURSOR_MS: 50,
  SCROLL_MS: 80,
  ZOOM_MS: 120,
  ANSWER_DEBOUNCE_MS: 200,
  ANNOTATION_PREVIEW_MS: 40,
});

export const FOLLOW_STATUS = Object.freeze({
  FOLLOWING: "following",
  BROWSING_AWAY: "browsing_away",
});
