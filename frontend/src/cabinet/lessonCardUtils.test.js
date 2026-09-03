import { describe, expect, it } from "vitest";
import {
  getLessonCardActionLabel,
  getLessonOpenUrl,
  getLessonViewerUrl,
  inferLessonIncludes,
  lessonPreviewUrl,
  userFacingAccessCtaLabel,
} from "./lessonCardUtils";

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

  it("shows only includes that exist in the lesson text", () => {
    expect(inferLessonIncludes({
      short_description: "Теория и практика по графам",
    }).map((item) => item.id)).toEqual(["theory", "practice"]);
    expect(inferLessonIncludes({ title: "Пустой" })).toEqual([]);
  });

  it("uses action labels without demo as the main CTA", () => {
    expect(getLessonCardActionLabel({ access: { can_view: false } })).toBe("Открыть урок");
    expect(userFacingAccessCtaLabel({ type: "demo" })).toBe("Открыть урок");
    expect(userFacingAccessCtaLabel({ type: "demo" }, { demoActive: true })).toBe("Продолжить урок");
    expect(userFacingAccessCtaLabel({ type: "purchase", label: "Купить за 790 ₽" }))
      .toBe("Открыть этот урок отдельно · 790 ₽");
    expect(userFacingAccessCtaLabel({ type: "upgrade" })).toBe("Получить доступ ко всем материалам");
  });
});
