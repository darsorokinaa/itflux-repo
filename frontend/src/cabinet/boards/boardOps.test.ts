import { describe, expect, it } from "vitest";
import {
  applyBoardOps,
  coalesceBoardOps,
  diffBoardElements,
  shouldPublishFullScene,
} from "./boardOps";

describe("boardOps", () => {
  it("diffBoardElements находит upsert и delete", () => {
    const prev = [
      { id: "a", version: 1, isDeleted: false },
      { id: "b", version: 1, isDeleted: false },
    ];
    const next = [
      { id: "a", version: 2, isDeleted: false },
      { id: "c", version: 1, isDeleted: false },
    ];
    const ops = diffBoardElements(prev, next);
    expect(ops.some((o) => o.op === "upsert" && o.op === "upsert" && (o as { element: { id: string } }).element.id === "a")).toBe(true);
    expect(ops.some((o) => o.op === "upsert" && (o as { element: { id: string } }).element.id === "c")).toBe(true);
    expect(ops.some((o) => o.op === "delete" && o.id === "b")).toBe(true);
  });

  it("applyBoardOps применяет upsert и tombstone", () => {
    const local = {
      elements: [{ id: "a", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    };
    const next = applyBoardOps(local, {
      ops: [
        { op: "upsert", element: { id: "b", version: 1, isDeleted: false } },
        { op: "delete", id: "a", version: 2 },
      ],
    });
    const a = next.elements.find((e) => (e as { id: string }).id === "a") as { isDeleted?: boolean };
    const b = next.elements.find((e) => (e as { id: string }).id === "b");
    expect(a?.isDeleted).toBe(true);
    expect(b).toBeTruthy();
  });

  it("shouldPublishFullScene не требует full на мелких правках", () => {
    expect(shouldPublishFullScene(20, 3)).toBe(false);
    expect(shouldPublishFullScene(200, 120)).toBe(true);
  });

  it("cursor-sized diff не равен полной сцене", () => {
    // Движение одного элемента — 1 op.
    const prev = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, version: 1, x: 0 }));
    const next = prev.map((el, i) => (i === 7 ? { ...el, version: 2, x: 10 } : el));
    const ops = diffBoardElements(prev, next);
    expect(ops).toHaveLength(1);
    expect(shouldPublishFullScene(50, ops.length)).toBe(false);
  });

  it("coalesceBoardOps оставляет последнюю версию штриха и delete", () => {
    const ops = coalesceBoardOps([
      { op: "upsert", element: { id: "stroke", version: 1, points: [0] } },
      { op: "upsert", element: { id: "other", version: 1 } },
      { op: "upsert", element: { id: "stroke", version: 5, points: [0, 1, 2, 3, 4] } },
      { op: "delete", id: "other", version: 2 },
    ]);
    expect(ops).toHaveLength(2);
    const stroke = ops.find((o) => o.op === "upsert") as unknown as {
      element: { id: string; version: number; points: number[] };
    };
    expect(stroke.element.id).toBe("stroke");
    expect(stroke.element.version).toBe(5);
    expect(stroke.element.points).toHaveLength(5);
    expect(ops.some((o) => o.op === "delete" && o.id === "other")).toBe(true);
  });

  it("applyBoardOps не откатывает более новый isDeleted устаревшим upsert", () => {
    const local = {
      elements: [{ id: "gone", version: 4, isDeleted: true }],
      appState: {},
      files: {},
    };
    const next = applyBoardOps(local, {
      ops: [{ op: "upsert", element: { id: "gone", version: 2, isDeleted: false, x: 1 } }],
    });
    const gone = next.elements.find((e) => (e as { id: string }).id === "gone") as {
      isDeleted?: boolean;
      version: number;
    };
    expect(gone?.isDeleted).toBe(true);
    expect(gone?.version).toBe(4);
  });
});
