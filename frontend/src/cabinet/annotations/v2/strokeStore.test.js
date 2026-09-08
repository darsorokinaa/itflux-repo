import { describe, expect, it } from "vitest";

import { createStrokeStore } from "./strokeStore";

describe("stroke store", () => {
  it("is idempotent for repeated sequence packets", () => {
    const store = createStrokeStore();
    store.start({ id: "s1", points: [{ x: 0.1, y: 0.1 }], sourceRevision: 0 });
    store.appendPoints("s1", [{ x: 0.2, y: 0.2 }], { sequence: 3 });
    store.appendPoints("s1", [{ x: 0.2, y: 0.2 }], { sequence: 3 });
    expect(store.get("s1").points).toHaveLength(2);
  });

  it("keeps strokes when the captured surface revision changes inside the same share", () => {
    const store = createStrokeStore();
    store.setSourceRevision(1);
    store.start({ id: "s1", points: [{ x: 0.1, y: 0.1 }], sourceRevision: 1 });
    store.setSourceRevision(2);
    expect(store.size()).toBe(1);
    expect(store.get("s1")).toBeTruthy();
  });

  it("does not put vanishing strokes into a late-join snapshot", () => {
    const store = createStrokeStore();
    store.start({ id: "pen", tool: "pen", points: [{ x: 0.1, y: 0.1 }] });
    store.start({ id: "fade", tool: "vanishing", points: [{ x: 0.2, y: 0.2 }] });
    expect(store.persistentList().map((s) => s.id)).toEqual(["pen"]);
    store.loadSnapshot(store.list());
    expect(store.get("fade")).toBeNull();
    expect(store.get("pen")).toBeTruthy();
  });

  it("does not clear a legacy snapshot when first learning revision 1", () => {
    const store = createStrokeStore();
    store.loadSnapshot([{ id: "legacy", points: [{ x: 0.4, y: 0.4 }] }]);
    store.setSourceRevision(1);
    expect(store.get("legacy")).toBeTruthy();
  });
});
