import { TOOLS } from "../../screenshare/constants";

/** Zoom-like screen-share annotation UI: toolbar starts closed. */

export const ANNOTATION_POINTER = TOOLS.POINTER;

export function collapsedAnnotationUi() {
  return { toolbarOpen: false, tool: ANNOTATION_POINTER };
}

/** Open the toolbar on Mouse so the share stays clickable until a draw tool is chosen. */
export function openedAnnotationUi() {
  return { toolbarOpen: true, tool: ANNOTATION_POINTER };
}

export function shouldShowAnnotationTrigger({ active = false, canAnnotate = false } = {}) {
  return Boolean(active && canAnnotate);
}

export function revokeStudentAnnotationUi() {
  return collapsedAnnotationUi();
}

/**
 * Reset UI when sharing stops, or when swapping one real session for another.
 * Do not reset when sessionId hydrates from "" → uuid (that closed the toolbar
 * the moment the teacher clicked Annotate).
 */
export function shouldResetAnnotationUi({
  active = false,
  prevSessionId = "",
  sessionId = "",
} = {}) {
  if (!active) return true;
  const prev = String(prevSessionId || "");
  const next = String(sessionId || "");
  return Boolean(prev && next && prev !== next);
}
