import { describe, expect, it } from "vitest";

import { TOOLS } from "../../screenshare/constants";
import {
  collapsedAnnotationUi,
  openedAnnotationUi,
  revokeStudentAnnotationUi,
  shouldShowAnnotationTrigger,
} from "./zoomSession";

describe("zoom-like annotation session", () => {
  it("starts collapsed on Pointer and does not show a toolbar", () => {
    expect(collapsedAnnotationUi()).toEqual({ toolbarOpen: false, tool: TOOLS.POINTER });
  });

  it("reopens on Pointer so the overlay does not capture clicks", () => {
    expect(openedAnnotationUi()).toEqual({ toolbarOpen: true, tool: TOOLS.POINTER });
  });

  it("shows the compact trigger only to people who may annotate", () => {
    expect(shouldShowAnnotationTrigger({ active: true, canAnnotate: true })).toBe(true);
    expect(shouldShowAnnotationTrigger({ active: true, canAnnotate: false })).toBe(false);
    expect(shouldShowAnnotationTrigger({ active: false, canAnnotate: true })).toBe(false);
  });

  it("revoking student drawing collapses the UI without implying a clear", () => {
    expect(revokeStudentAnnotationUi()).toEqual({ toolbarOpen: false, tool: TOOLS.POINTER });
  });
});
