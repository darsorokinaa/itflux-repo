import { describe, expect, it } from "vitest";

import { TOOLS } from "../../screenshare/constants";
import {
  collapsedAnnotationUi,
  openedAnnotationUi,
  revokeStudentAnnotationUi,
  shouldResetAnnotationUi,
  shouldShowAnnotationTrigger,
} from "./zoomSession";

describe("zoom-like annotation session", () => {
  it("starts collapsed on Pointer and does not show a toolbar", () => {
    expect(collapsedAnnotationUi()).toEqual({ toolbarOpen: false, tool: TOOLS.POINTER });
  });

  it("opens on Mouse so the first click after Аннотации does not capture the share", () => {
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

  it("does not reset when the backend session id arrives after sharing started", () => {
    expect(shouldResetAnnotationUi({ active: true, prevSessionId: "", sessionId: "abc" })).toBe(false);
    expect(shouldResetAnnotationUi({ active: true, prevSessionId: "abc", sessionId: "abc" })).toBe(false);
  });

  it("resets when sharing stops or the session is replaced", () => {
    expect(shouldResetAnnotationUi({ active: false, prevSessionId: "abc", sessionId: "abc" })).toBe(true);
    expect(shouldResetAnnotationUi({ active: true, prevSessionId: "abc", sessionId: "xyz" })).toBe(true);
  });
});
