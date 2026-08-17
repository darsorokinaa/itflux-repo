import { describe, expect, it } from "vitest";

import {
  clientToNormalized,
  computeScreenShareContentRect,
  getContainedContentRect,
  normalizedToClient,
} from "./contentRect";
import {
  applyScreenshareOperation,
  annotationsFromList,
  findAnnotationAt,
  lastOwnAnnotationId,
} from "./annotationModel";

describe("screen-share content rect", () => {
  it("letterboxes 16:9 content inside a 4:3 host after chrome insets", () => {
    const layout = computeScreenShareContentRect({
      hostRect: { left: 0, top: 0, width: 800, height: 600 },
      contentWidth: 1920,
      contentHeight: 1080,
    });
    expect(layout.content.width / layout.content.height).toBeCloseTo(16 / 9, 5);
    expect(layout.content.left).toBeGreaterThanOrEqual(0);
    expect(layout.content.top).toBeGreaterThanOrEqual(0);
  });

  it("pillarboxes 4:3 content inside a wide host", () => {
    const layout = computeScreenShareContentRect({
      hostRect: { left: 0, top: 0, width: 1600, height: 900 },
      contentWidth: 1024,
      contentHeight: 768,
    });
    expect(layout.content.width / layout.content.height).toBeCloseTo(4 / 3, 5);
  });

  it("maps the same normalized point across different viewports", () => {
    const teacher = getContainedContentRect(
      { left: 0, top: 0, width: 1920, height: 1080 },
      1920,
      1080,
    );
    const phone = getContainedContentRect(
      { left: 0, top: 80, width: 390, height: 700 },
      1920,
      1080,
    );
    const norm = { x: 0.41, y: 0.32 };
    const a = normalizedToClient(norm.x, norm.y, teacher);
    const b = normalizedToClient(norm.x, norm.y, phone);
    expect(clientToNormalized(a.x, a.y, teacher)).toEqual(norm);
    expect(clientToNormalized(b.x, b.y, phone).x).toBeCloseTo(0.41, 5);
    expect(clientToNormalized(b.x, b.y, phone).y).toBeCloseTo(0.32, 5);
  });
});

describe("annotation operations", () => {
  it("appends stroke updates without duplicating ids", () => {
    let map = annotationsFromList([]);
    map = applyScreenshareOperation(map, {
      action: "stroke_start",
      payload: { annotation: { id: "s1", tool: "pen", points: [{ x: 0.1, y: 0.1 }], authorId: 2 } },
    });
    map = applyScreenshareOperation(map, {
      action: "stroke_update",
      payload: { annotation: { id: "s1", points: [{ x: 0.12, y: 0.11 }] } },
    });
    map = applyScreenshareOperation(map, {
      action: "stroke_update",
      payload: { annotation: { id: "s1", points: [{ x: 0.12, y: 0.11 }] } },
      operation_id: "dup",
    });
    expect(map.get("s1").points).toHaveLength(3);
  });

  it("undo removes only the current author's last object", () => {
    let map = annotationsFromList([
      { id: "t1", authorId: 1, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      { id: "s1", authorId: 2, points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }] },
    ]);
    expect(lastOwnAnnotationId(map, 2)).toBe("s1");
    map = applyScreenshareOperation(map, { action: "annotation_deleted", payload: { id: "s1" }, authorId: 2 });
    expect([...map.keys()]).toEqual(["t1"]);
  });

  it("eraser hits a whole stroke", () => {
    const map = annotationsFromList([
      { id: "line", tool: "line", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] },
    ]);
    expect(findAnnotationAt(map, 0.5, 0.1)?.id).toBe("line");
    expect(findAnnotationAt(map, 0.5, 0.8)).toBeNull();
  });

  it("clear_mine keeps other authors", () => {
    let map = annotationsFromList([
      { id: "t1", authorId: 1, points: [{ x: 0.1, y: 0.1 }] },
      { id: "s1", authorId: 2, points: [{ x: 0.2, y: 0.2 }] },
    ]);
    map = applyScreenshareOperation(map, { action: "clear_mine", author_id: 2 });
    expect([...map.keys()]).toEqual(["t1"]);
  });
});
