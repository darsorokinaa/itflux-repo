import { describe, expect, it } from "vitest";

import {
  appendStrokePoint,
  createStroke,
  isMatchingActivePointer,
  isStrokePointerHeld,
  shouldIgnorePointerDown,
} from "./pointerStroke";
import { resolveAnnotationTarget } from "./AnnotationContext";

describe("pointer stroke isolation", () => {
  it("ignores pen hover and non-primary pointers", () => {
    expect(shouldIgnorePointerDown({ isPrimary: true, pointerType: "pen", buttons: 0, button: 0 })).toBe(true);
    expect(shouldIgnorePointerDown({ isPrimary: false, pointerType: "touch", buttons: 1, button: 0 })).toBe(true);
    expect(shouldIgnorePointerDown({ isPrimary: true, pointerType: "mouse", button: 2, buttons: 2 })).toBe(true);
    expect(shouldIgnorePointerDown({ isPrimary: true, pointerType: "mouse", button: 0, buttons: 1 })).toBe(false);
    expect(shouldIgnorePointerDown({ isPrimary: true, pointerType: "pen", buttons: 1, button: 0 })).toBe(false);
  });

  it("does not continue a stroke for a different pointer id", () => {
    expect(isMatchingActivePointer({ pointerId: 2 }, 1)).toBe(false);
    expect(isStrokePointerHeld({ pointerId: 1, pointerType: "mouse", buttons: 0 }, 1)).toBe(false);
    expect(isStrokePointerHeld({ pointerId: 1, pointerType: "mouse", buttons: 1 }, 1)).toBe(true);
  });

  it("does not join points across independent strokes", () => {
    const a = createStroke({ id: "s1", tool: "pen", color: "#ef4444", width: 3, point: { x: 0.1, y: 0.1 } });
    appendStrokePoint(a, { x: 0.2, y: 0.2 });
    const b = createStroke({ id: "s2", tool: "pen", color: "#ef4444", width: 3, point: { x: 0.8, y: 0.8 } });
    expect(a.id).not.toBe(b.id);
    expect(a.points).toHaveLength(2);
    expect(b.points).toEqual([{ x: 0.8, y: 0.8 }]);
  });
});

describe("annotation target", () => {
  it("uses the current work surface, not only the call", () => {
    expect(resolveAnnotationTarget({
      enabled: true,
      workspaceOpen: true,
      focusCall: false,
      materialAnnotatable: true,
      screenshareActive: true,
    })).toBe("material");
    expect(resolveAnnotationTarget({
      enabled: true,
      workspaceOpen: false,
      screenshareActive: true,
    })).toBe("screenshare");
    expect(resolveAnnotationTarget({
      enabled: false,
      screenshareActive: true,
      materialAnnotatable: true,
    })).toBe("none");
  });
});
