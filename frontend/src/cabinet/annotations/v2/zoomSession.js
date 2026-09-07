import { TOOLS } from "../../screenshare/constants";

/** Zoom-like screen-share annotation UI: toolbar starts closed, Pointer is safe. */
export const ANNOTATION_POINTER = TOOLS.POINTER;

export function collapsedAnnotationUi() {
  return { toolbarOpen: false, tool: ANNOTATION_POINTER };
}

export function openedAnnotationUi() {
  return { toolbarOpen: true, tool: ANNOTATION_POINTER };
}

export function shouldShowAnnotationTrigger({ active = false, canAnnotate = false } = {}) {
  return Boolean(active && canAnnotate);
}

export function revokeStudentAnnotationUi() {
  return collapsedAnnotationUi();
}
