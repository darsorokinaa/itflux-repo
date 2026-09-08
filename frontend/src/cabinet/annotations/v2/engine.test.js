/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { createAnnotationEngine } from "./engine";
import { createAnnotationHistory, invertHistoryEntry } from "./history";
import { densifySegment, translatePoints } from "./smoothStroke";

describe("annotation history", () => {
  it("undoes only the local stack and supports redo", () => {
    const history = createAnnotationHistory();
    history.push({ type: "create", annotation: { id: "a" } });
    history.push({ type: "create", annotation: { id: "b" } });
    expect(history.popUndo().annotation.id).toBe("b");
    expect(history.popRedo().annotation.id).toBe("b");
    expect(invertHistoryEntry({ type: "create", annotation: { id: "a" } }).type).toBe("delete");
  });
});

describe("smooth stroke densify", () => {
  it("inserts midpoints for a large jump so lines are not sparse segments", () => {
    const extra = densifySegment({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 });
    expect(extra.length).toBeGreaterThan(2);
    expect(extra.at(-1).x).toBeCloseTo(0.4);
    const moved = translatePoints([{ x: 0.2, y: 0.2 }], 0.1, -0.1)[0];
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBeCloseTo(0.1);
  });
});

describe("annotation engine permissions and history", () => {
  it("undoes only the current user's last create via annotation_deleted", () => {
    const sent = [];
    const engine = createAnnotationEngine({
      authorId: 7,
      displayName: "Иван",
      onSend: (action, payload) => sent.push({ action, payload }),
    });
    engine.applyRemote({
      action: "object_upsert",
      author_id: 1,
      payload: { annotation: { id: "teacher", tool: "line", authorId: 1, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] } },
    });
    engine.commitText({ x: 0.5, y: 0.5 }, "hello");
    expect(engine.undo()).toBe(true);
    expect(sent.some((item) => item.action === "annotation_deleted")).toBe(true);
    expect(engine.list().some((item) => item.id === "teacher")).toBe(true);
    engine.dispose();
  });
});
