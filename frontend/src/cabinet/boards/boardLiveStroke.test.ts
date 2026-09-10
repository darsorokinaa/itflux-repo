import { describe, expect, it } from "vitest";
import { isActiveFreedrawGesture } from "./boardLiveStroke";

describe("isActiveFreedrawGesture", () => {
  it("is false when no canvas gesture is in progress", () => {
    expect(isActiveFreedrawGesture(false, { activeTool: { type: "freedraw" } })).toBe(false);
  });

  it("is true for freedraw during a pointer gesture", () => {
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "freedraw" } })).toBe(true);
  });

  it("is true when Excalidraw still holds a new freedraw element", () => {
    expect(isActiveFreedrawGesture(true, {
      activeTool: { type: "selection" },
      newElement: { type: "freedraw" },
    })).toBe(true);
  });

  it("does not treat selection, pan, or eraser as live freehand", () => {
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "selection" } })).toBe(false);
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "hand" } })).toBe(false);
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "eraser" } })).toBe(false);
  });
});
