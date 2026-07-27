import { describe, expect, it } from "vitest";
import { isNewerBoardElement, mergeBoardElements, mergeCollabScenes } from "./boardSceneMerge";

describe("boardSceneMerge", () => {
  it("picks newer element by version", () => {
    expect(
      isNewerBoardElement({ id: "a", version: 3 }, { id: "a", version: 2 }),
    ).toBe(true);
    expect(
      isNewerBoardElement({ id: "a", version: 2 }, { id: "a", version: 3 }),
    ).toBe(false);
  });

  it("keeps both local and remote strokes when ids differ", () => {
    const local = [
      { id: "teacher-1", version: 1, type: "freedraw" },
      { id: "teacher-2", version: 2, type: "freedraw" },
    ];
    const remote = [
      { id: "student-1", version: 1, type: "freedraw" },
    ];
    const merged = mergeBoardElements(local, remote) as { id: string }[];
    expect(merged.map((e) => e.id).sort()).toEqual(["student-1", "teacher-1", "teacher-2"]);
  });

  it("does not overwrite a newer local stroke with an older remote copy", () => {
    const local = [{ id: "shared", version: 5, type: "rectangle", x: 10 }];
    const remote = [
      { id: "shared", version: 2, type: "rectangle", x: 0 },
      { id: "peer", version: 1, type: "ellipse" },
    ];
    const merged = mergeBoardElements(local, remote) as { id: string; version: number; x?: number }[];
    const shared = merged.find((e) => e.id === "shared");
    expect(shared?.version).toBe(5);
    expect(shared?.x).toBe(10);
    expect(merged.some((e) => e.id === "peer")).toBe(true);
  });

  it("keeps newer soft-deleted element instead of resurrecting from older remote", () => {
    const local = [{ id: "gone", version: 4, isDeleted: true, type: "rectangle" }];
    const remote = [{ id: "gone", version: 2, isDeleted: false, type: "rectangle", x: 1 }];
    const merged = mergeBoardElements(local, remote) as { id: string; isDeleted?: boolean; version: number }[];
    const gone = merged.find((e) => e.id === "gone");
    expect(gone?.isDeleted).toBe(true);
    expect(gone?.version).toBe(4);
  });

  it("prefers isDeleted when version markers are equal", () => {
    const local = [{ id: "x", version: 3, versionNonce: 1, isDeleted: true }];
    const remote = [{ id: "x", version: 3, versionNonce: 1, isDeleted: false }];
    const merged = mergeBoardElements(local, remote) as { isDeleted?: boolean }[];
    expect(merged[0]?.isDeleted).toBe(true);
  });

  it("mergeCollabScenes preserves local scroll/selection", () => {
    const out = mergeCollabScenes(
      {
        elements: [{ id: "a", version: 1 }],
        appState: { scrollX: 40, selectedElementIds: { a: true }, theme: "dark" },
        files: { f1: { id: "f1" } },
      },
      {
        elements: [{ id: "b", version: 1 }],
        appState: { scrollX: 0, theme: "light", viewBackgroundColor: "#fff" },
        files: { f2: { id: "f2" } },
      },
    );
    expect(out.appState.scrollX).toBe(40);
    expect(out.appState.theme).toBe("dark");
    expect(out.appState.viewBackgroundColor).toBe("#fff");
    expect(Object.keys(out.files).sort()).toEqual(["f1", "f2"]);
  });
});
