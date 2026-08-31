import { describe, expect, it } from "vitest";
import { getLessonOpenUrl, getLessonViewerUrl, lessonPreviewUrl } from "./lessonCardUtils";

describe("lesson shareable urls", () => {
  it("opens the description preview for gated and unlocked catalog lessons", () => {
    expect(getLessonOpenUrl({
      slug: "paid-lesson",
      access: { can_view: false, allowed: false },
    })).toBe("/lessons?preview=paid-lesson");

    expect(getLessonOpenUrl({
      slug: "html-lesson",
      file_url: "/media/lessons/files/index.html",
      access: { can_view: true, allowed: true },
    })).toBe("/lessons?preview=html-lesson");
  });

  it("keeps preview query for paywall links", () => {
    expect(lessonPreviewUrl("paid-lesson")).toBe("/lessons?preview=paid-lesson");
    expect(getLessonViewerUrl("paid-lesson")).toBe("/lessons/paid-lesson/view");
  });
});
