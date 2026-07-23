import { describe, expect, it } from "vitest";

import { canSyncPresentRow, inferSyncResourceKind } from "./meetingMaterialCollab";

describe("inferSyncResourceKind", () => {
  it("excludes board and variant", () => {
    expect(inferSyncResourceKind({ kind: "board" })).toBeNull();
    expect(inferSyncResourceKind({ kind: "variant" })).toBeNull();
    expect(canSyncPresentRow({ kind: "variant" })).toBe(false);
  });

  it("detects pdf and image by url", () => {
    expect(inferSyncResourceKind({ kind: "file", url: "/media/a.pdf" })).toBe("pdf");
    expect(inferSyncResourceKind({ kind: "file", url: "/media/a.PNG" })).toBe("image");
  });

  it("maps interactive subtypes", () => {
    expect(inferSyncResourceKind({ kind: "interactive", interactiveType: "flashcards" })).toBe("cards");
    expect(inferSyncResourceKind({ kind: "interactive", interactiveType: "quiz" })).toBe("test");
    expect(inferSyncResourceKind({ kind: "interactive", interactiveType: "matching" })).toBe("exercise");
  });

  it("maps notes and text", () => {
    expect(inferSyncResourceKind({ kind: "notes", text: "hello" })).toBe("notes");
    expect(inferSyncResourceKind({ kind: "material", text: "hello" })).toBe("text");
  });
});
