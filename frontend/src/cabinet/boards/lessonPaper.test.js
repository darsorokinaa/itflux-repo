import { describe, expect, it } from "vitest";

import { lessonPaperOffset, readLessonPaper, withLessonPaper } from "./lessonPaper";

describe("lesson paper", () => {
  it("falls back when the stored paper is unknown", () => {
    expect(readLessonPaper({ lessonPaper: { mode: "yjs", color: "red" } })).toEqual({
      mode: "blank",
      color: "#ffffff",
    });
  });

  it("keeps other document meta when the paper changes", () => {
    const meta = withLessonPaper({ author: "lesson" }, { mode: "grid", color: "#eef5ff" });
    expect(meta.author).toBe("lesson");
    expect(meta.lessonPaper).toEqual({ mode: "grid", color: "#eef5ff" });
  });

  it("ignores a color outside the lesson palette", () => {
    const meta = withLessonPaper({}, { mode: "slant", color: "#000000" });
    expect(meta.lessonPaper).toEqual({ mode: "slant", color: "#ffffff" });
  });

  it("keeps the dark and green-board colors", () => {
    expect(withLessonPaper({}, { color: "#1c2430" }).lessonPaper.color).toBe("#1c2430");
    expect(withLessonPaper({}, { color: "#1a6b45" }).lessonPaper.color).toBe("#1a6b45");
  });

  it("wraps a negative camera so the ruling stays on the page", () => {
    const offset = lessonPaperOffset(-10, -4, 1, 32);
    expect(offset.size).toBe(32);
    expect(offset.x).toBeCloseTo(22.5);
    expect(offset.y).toBeCloseTo(28.5);
  });
});