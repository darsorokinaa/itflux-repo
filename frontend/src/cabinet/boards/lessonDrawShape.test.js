import { b64Vecs } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";

import {
  lessonDrawDashArray,
  lessonDrawPath,
  lessonDrawPoints,
  lessonDrawStrokeWidth,
} from "./lessonDrawShape";

describe("lesson draw stroke", () => {
  it("follows the samples with straight segments and no outline curves", () => {
    const path = b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.5 },
      { x: 10, y: 0, z: 0.4 },
      { x: 10, y: 12, z: 0.8 },
    ]);
    const points = lessonDrawPoints([{ path, type: "free" }], 2, 1);
    const d = lessonDrawPath(points, false);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 12 },
    ]);
    expect(d).toBe("M 0 0 L 20 0 L 20 12");
    expect(d).not.toMatch(/[QTCAqta]/);
  });

  it("drops a repeated sample so a turn does not grow a hook", () => {
    const path = b64Vecs.encodePoints([
      { x: 1, y: 1, z: 0.5 },
      { x: 1, y: 1, z: 0.5 },
      { x: 4, y: 2, z: 0.5 },
    ]);
    const points = lessonDrawPoints([{ path, type: "free" }]);
    expect(points).toEqual([{ x: 1, y: 1 }, { x: 4, y: 2 }]);
    expect(lessonDrawPath(points)).toBe("M 1 1 L 4 2");
  });

  it("closes only when asked and keeps a tap as a round cap, not a blob", () => {
    expect(lessonDrawPath([{ x: 3, y: 4 }], true)).toBe("M 3 4 L 3 4");
    expect(lessonDrawPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], true)).toBe("M 0 0 L 2 0 L 2 2 Z");
  });

  it("keeps the lesson thickness and dash on the same stroke", () => {
    expect(lessonDrawStrokeWidth(3.5, 2)).toBe(9);
    expect(lessonDrawDashArray("draw", 4)).toBeUndefined();
    expect(lessonDrawDashArray("dashed", 4)).toBe("8 8");
    expect(lessonDrawDashArray("dotted", 4)).toBe("0.1 8");
  });
});
