import { describe, expect, it } from "vitest";
import { createAnnotation, TOOL } from "./notebookModel";
import { hitTest, moveObject } from "./notebookGeometry";

describe("notebook editor smoke", () => {
  it("supports the professional tool set as document objects", () => {
    const tools = [TOOL.PEN, TOOL.MARKER, TOOL.TEXT, TOOL.LINE, TOOL.ARROW, TOOL.RECT, TOOL.ELLIPSE];
    const anns = tools.map((type) => createAnnotation(type, {
      points: [{ x: 0, y: 0 }, { x: 8, y: 8 }],
      x: 10,
      y: 10,
      w: 20,
      h: 12,
      x1: 0,
      y1: 0,
      x2: 12,
      y2: 0,
      cx: 20,
      cy: 20,
      rx: 8,
      ry: 8,
      text: "ok",
    }, "page-1"));
    expect(new Set(anns.map((item) => item.id)).size).toBe(tools.length);
    const moved = moveObject(anns[0], 5, 5);
    expect(moved.points[0].x).toBe(5);
    expect(hitTest(anns.find((item) => item.type === "text"), { x: 12, y: 8 })).toBe(true);
  });
});
