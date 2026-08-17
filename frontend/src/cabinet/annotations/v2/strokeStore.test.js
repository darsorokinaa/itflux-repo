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

  it("drops packets from another sourceRevision after the first non-zero revision", () => {
    const store = createStrokeStore();
    store.setSourceRevision(1);
    store.start({ id: "s1", points: [{ x: 0.1, y: 0.1 }], sourceRevision: 1 });
    store.setSourceRevision(2);
    expect(store.size()).toBe(0);
    store.start({ id: "old", points: [{ x: 0.9, y: 0.9 }], sourceRevision: 1 });
    expect(store.get("old")).toBeNull();
  });

  it("does not clear a legacy snapshot when first learning revision 1", () => {
    const store = createStrokeStore();
    store.loadSnapshot([{ id: "legacy", points: [{ x: 0.4, y: 0.4 }] }]);
    store.setSourceRevision(1);
    expect(store.get("legacy")).toBeTruthy();
  });
});
