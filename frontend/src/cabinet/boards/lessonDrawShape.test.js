import { b64Vecs } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";

import {
  lessonDrawDashArray,
  lessonDrawMarkGeometry,
  lessonDrawPath,
  lessonDrawPoints,
  lessonDrawShapePath,
  lessonDrawStrokeWidth,
  lessonFreehandPoints,
} from "./lessonDrawShape";

const PEN = 4.5;

describe("lesson draw stroke", () => {
  it("scales samples and keeps a corner inside them", () => {
    const path = b64Vecs.encodePoints([
      { x: 0, y: 0, z: 0.5 },
      { x: 10, y: 0, z: 0.4 },
      { x: 10, y: 12, z: 0.8 },
    ]);
    const points = lessonDrawPoints([{ path, type: "free" }], 2, 1);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 12 },
    ]);
    const smoothed = lessonFreehandPoints(points, PEN);
    expect(near(smoothed[0], { x: 0, y: 0 })).toBe(true);
    expect(near(smoothed[smoothed.length - 1], { x: 20, y: 12 })).toBe(true);
    expect(closestDistance(smoothed, { x: 20, y: 0 })).toBeLessThan(8);
    for (const point of smoothed) {
      expect(point.x).toBeGreaterThanOrEqual(-0.5);
      expect(point.y).toBeGreaterThanOrEqual(-0.5);
      expect(point.x).toBeLessThanOrEqual(20.5);
      expect(point.y).toBeLessThanOrEqual(12.5);
    }
    const d = lessonDrawPath(points, false, PEN);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("drops a repeated sample so a turn does not grow a hook", () => {
    const path = b64Vecs.encodePoints([
      { x: 1, y: 1, z: 0.5 },
      { x: 1, y: 1, z: 0.5 },
      { x: 4, y: 2, z: 0.5 },
    ]);
    const points = lessonDrawPoints([{ path, type: "free" }]);
    expect(points).toEqual([{ x: 1, y: 1 }, { x: 4, y: 2 }]);
    const smoothed = lessonFreehandPoints(points, PEN);
    expect(near(smoothed[0], { x: 1, y: 1 })).toBe(true);
    expect(near(smoothed[smoothed.length - 1], { x: 4, y: 2 })).toBe(true);
  });

  it("keeps a straight run on the samples", () => {
    const smoothed = lessonFreehandPoints([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ], PEN);
    expect(near(smoothed[0], { x: 0, y: 0 })).toBe(true);
    expect(near(smoothed[smoothed.length - 1], { x: 20, y: 0 })).toBe(true);
    for (const point of smoothed) expect(Math.abs(point.y)).toBeLessThan(0.05);
  });

  it("closes only when asked and keeps a tap as a round cap, not a blob", () => {
    expect(lessonDrawPath([{ x: 3, y: 4 }], true, PEN)).toBe("M 3 4 L 3 4");
    const dash = lessonFreehandPoints([{ x: 0, y: 0 }, { x: 8, y: 0 }], PEN);
    expect(near(dash[0], { x: 0, y: 0 })).toBe(true);
    expect(near(dash[dash.length - 1], { x: 8, y: 0 })).toBe(true);
    const tap = lessonFreehandPoints([
      { x: 3, y: 4 },
      { x: 3.3, y: 4.2 },
      { x: 2.9, y: 4.4 },
    ], PEN);
    expect(tap).toHaveLength(1);
    const closed = lessonDrawPath([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 12 },
    ], true, PEN);
    const open = lessonDrawPath([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 12 },
    ], false, PEN);
    expect(closed.endsWith("Z")).toBe(true);
    expect(open.endsWith("Z")).toBe(false);
  });

  it("keeps the lesson thickness and dash on the same stroke", () => {
    expect(lessonDrawStrokeWidth(3.5, 2)).toBe(9);
    expect(lessonDrawDashArray("draw", 4)).toBeUndefined();
    expect(lessonDrawDashArray("dashed", 4)).toBe("8 8");
    expect(lessonDrawDashArray("dotted", 4)).toBe("0.1 8");
  });

  it("keeps a corner, a small loop and a short stroke", () => {
    const corner = line(0, 0, 32, 0, 6).concat(line(32, 0, 32, 28, 5).slice(1));
    const smoothed = lessonFreehandPoints(corner, PEN);
    expect(near(smoothed[0], corner[0])).toBe(true);
    expect(near(smoothed[smoothed.length - 1], corner[corner.length - 1])).toBe(true);
    expect(closestDistance(smoothed, { x: 32, y: 0 })).toBeLessThan(10);

    const loop = [{ x: 0, y: 8 }, { x: 6, y: 6 }];
    for (let index = 0; index <= 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      loop.push({ x: 12 + Math.cos(angle) * 6, y: 8 + Math.sin(angle) * 5 });
    }
    loop.push({ x: 20, y: 14 }, { x: 26, y: 22 });
    const loopPoints = lessonFreehandPoints(loop, PEN);
    const box = bounds(loopPoints);
    expect(box.maxX - box.minX).toBeGreaterThan(14);
    expect(box.maxY - box.minY).toBeGreaterThan(10);

    const short = lessonFreehandPoints(line(0, 0, 8, 0, 4), PEN);
    expect(short.length).toBeGreaterThan(1);
    expect(near(short[0], { x: 0, y: 0 })).toBe(true);
    expect(near(short[short.length - 1], { x: 8, y: 0 })).toBe(true);

    const crowded = lessonDrawPath([
      { x: 1, y: 1 },
      { x: 1.004, y: 1.004 },
      { x: 1.008, y: 1.001 },
      { x: 1.2, y: 1.4 },
    ], false, PEN);
    expect(crowded).not.toMatch(/NaN|Infinity/);
  });

  it("drops a pen-lift nub and keeps a check mark and a letter hook", () => {
    const nub = line(0, 0, 40, 0, 8);
    nub.push({ x: 37.2, y: 1.6 });
    const cleaned = lessonFreehandPoints(nub, PEN);
    expect(cleaned[cleaned.length - 1].x).toBeGreaterThan(39);
    expect(Math.abs(cleaned[cleaned.length - 1].y)).toBeLessThan(0.4);

    const jump = line(0, 0, 16, 0, 4);
    jump.push({ x: 8, y: 3 });
    const jumped = lessonFreehandPoints(jump, PEN);
    expect(jumped[jumped.length - 1].x).toBeGreaterThan(14);

    const check = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 34, y: 0 },
    ];
    const mark = lessonFreehandPoints(check, PEN);
    expect(near(mark[mark.length - 1], { x: 34, y: 0 })).toBe(true);

    const hook = line(0, 0, 16, 0, 4).concat([
      { x: 18, y: 4 },
      { x: 18, y: 8 },
      { x: 16, y: 12 },
      { x: 12, y: 14 },
    ]);
    const letter = lessonFreehandPoints(hook, PEN);
    expect(near(letter[letter.length - 1], { x: 12, y: 14 })).toBe(true);
    expect(letter[letter.length - 1].y).toBeGreaterThan(10);
  });

  it("uses one freehand path for pen and mouse and keeps a shifted straight segment", () => {
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
    const pen = lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, true, PEN);
    const mouse = lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, false, PEN);
    expect(mouse).toBe(pen);
    expect(lessonDrawShapePath([{ type: "free", path: free }], 1, 1, false, true, PEN)).toBe(pen);
    expect(pen.endsWith("Z")).toBe(false);
    expect(lessonDrawShapePath([
      { type: "straight", path: straight },
      { type: "free", path: continued },
    ], 1, 1, false, true, PEN)).toBe("M 0 0 L 10 0 L 10 6 L 4 6");
  });

  it("does not stroke back to the start and does not change after the pen lifts", () => {
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
      isComplete: false,
      fill: "none",
      strokeWidth: PEN,
    };
    const ink = lessonDrawMarkGeometry(shape);
    const finished = lessonDrawMarkGeometry({ ...shape, isComplete: true, isPen: false });
    expect(finished.stroke).toBe(ink.stroke);
    expect(ink.stroke.endsWith("Z")).toBe(false);
    expect(ink.fill).toBe("");
    const filled = lessonDrawMarkGeometry({ ...shape, fill: "solid" });
    expect(filled.stroke).toBe(ink.stroke);
    expect(filled.fill.endsWith("Z")).toBe(true);
    const drawn = lessonFreehandPoints(lessonDrawPoints(shape.segments), PEN);
    expect(near(drawn[0], { x: 0, y: 0 })).toBe(true);
    expect(near(drawn[drawn.length - 1], { x: 0.4, y: 0.4 })).toBe(true);
  });
});

function near(point, target) {
  return Math.hypot(point.x - target.x, point.y - target.y) < 0.6;
}

function closestDistance(points, target) {
  return Math.min(...points.map((point) => Math.hypot(point.x - target.x, point.y - target.y)));
}

function bounds(points) {
  return points.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x),
    minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x),
    maxY: Math.max(box.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function line(x0, y0, x1, y1, steps) {
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
  return points;
}
