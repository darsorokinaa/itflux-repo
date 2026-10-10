import { b64Vecs } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";

import {
  lessonDrawDashArray,
  lessonDrawMarkGeometry,
  lessonDrawPath,
  lessonDrawPoints,
  lessonDrawShapePath,
  lessonDrawStrokeWidth,
} from "./lessonDrawShape";

describe("lesson draw stroke", () => {
  it("rounds a corner on the samples without leaving their box", () => {
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
    expect(d).toBe("M 0 0 L 10 0 Q 20 0 20 6 L 20 12");
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("L 20 12")).toBe(true);
    expect(d).not.toMatch(/[CAca]/);
    const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(20);
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

  it("keeps a straight run on the samples", () => {
    expect(lessonDrawPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ])).toBe("M 0 0 L 5 0 Q 10 0 15 0 L 20 0");
  });

  it("closes only when asked and keeps a tap as a round cap, not a blob", () => {
    expect(lessonDrawPath([{ x: 3, y: 4 }], true)).toBe("M 3 4 L 3 4");
    expect(lessonDrawPath([{ x: 0, y: 0 }, { x: 4, y: 0 }], true)).toBe("M 0 0 L 4 0");
    expect(lessonDrawPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], true)).toBe(
      "M 1 1 Q 0 0 1 0 Q 2 0 2 1 Q 2 2 1 1 Z",
    );
  });

  it("keeps the lesson thickness and dash on the same stroke", () => {
    expect(lessonDrawStrokeWidth(3.5, 2)).toBe(9);
    expect(lessonDrawDashArray("draw", 4)).toBeUndefined();
    expect(lessonDrawDashArray("dashed", 4)).toBe("8 8");
    expect(lessonDrawDashArray("dotted", 4)).toBe("0.1 8");
  });

  it("keeps a sharp corner and a closed letter inside the samples", () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
    ];
    const d = lessonDrawPath(corner, false);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("L 8 3")).toBe(true);
    expect(d).toContain("Q 8 0");
    const quad = quadraticPoint({ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 1.5 }, 0.5);
    expect(quad.x).toBeGreaterThanOrEqual(0);
    expect(quad.x).toBeLessThanOrEqual(8);
    expect(quad.y).toBeGreaterThanOrEqual(0);
    expect(quad.y).toBeLessThanOrEqual(3);

    const crowded = lessonDrawPath([
      { x: 1, y: 1 },
      { x: 1.004, y: 1.004 },
      { x: 1.008, y: 1.001 },
      { x: 1.2, y: 1.4 },
    ], false);
    expect(crowded).not.toMatch(/NaN|Infinity/);
    const nums = crowded.match(/-?\d+(?:\.\d+)?/g).map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...nums)).toBeLessThanOrEqual(1.4);

    const loop = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ];
    const closed = lessonDrawPath(loop, true);
    const again = lessonDrawPath([...loop, { x: 0, y: 0 }], true);
    expect(again).toBe(closed);
    expect(closed.startsWith("M 2 2")).toBe(true);
    expect(closed.endsWith("Z")).toBe(true);
  });

  it("smooths only a pen freehand and keeps mouse and straight segments as lines", () => {
    const free = b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.4 },
      { x: 10, y: 0, z: 0.5 },
      { x: 10, y: 6, z: 0.5 },
    ]);
    const straight = b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.5 },
      { x: 10, y: 0, z: 0.5 },
    ]);
    const continued = b64Vecs.encodePoints([
      { x: 10, y: 0, z: 0.5 },
      { x: 10, y: 6, z: 0.5 },
      { x: 4, y: 6, z: 0.5 },
    ]);
    const pen = lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, true);
    const savedAgain = lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, true);
    expect(savedAgain).toBe(pen);
    expect(pen).toBe("M 0 0 L 5 0 Q 10 0 10 3 L 10 6");
    expect(lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, false)).toBe("M 0 0 L 10 0 L 10 6");
    expect(lessonDrawShapePath([
      { type: "straight", path: straight },
      { type: "free", path: continued },
    ], 1, 1, false, true)).toBe("M 0 0 L 10 0 L 10 6 L 4 6");
    expect(lessonDrawShapePath([{ type: "free", path: free }], 1, 1, true, false)).toBe("M 0 0 L 10 0 L 10 6 Z");
  });

  it("does not stroke back to the start when tldraw marks the stroke closed", () => {
    const free = b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.5 },
      { x: 12, y: 0, z: 0.5 },
      { x: 12, y: 10, z: 0.5 },
      { x: 0.4, y: 0.4, z: 0.5 },
    ]);
    const shape = {
      segments: [{ type: "free", path: free }],
      scaleX: 1,
      scaleY: 1,
      isPen: true,
      isClosed: true,
      fill: "none",
    };
    const ink = lessonDrawMarkGeometry(shape);
    expect(ink.stroke.endsWith("Z")).toBe(false);
    expect(ink.stroke.startsWith("M 0 0")).toBe(true);
    expect(ink.stroke.endsWith("L 0.4 0.4")).toBe(true);
    expect(ink.fill).toBe("");
    const filled = lessonDrawMarkGeometry({ ...shape, fill: "solid" });
    expect(filled.stroke).toBe(ink.stroke);
    expect(filled.fill.endsWith("Z")).toBe(true);
  });
});

function quadraticPoint(start, control, end, t) {
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
  };
}
