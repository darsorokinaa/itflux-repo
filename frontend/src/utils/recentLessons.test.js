/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { pickTryNowLessons, similarLessons, subscriptionBreakEven } from "./recentLessons";

describe("pickTryNowLessons", () => {
  it("prefers the selected subject when enough ready lessons exist", () => {
    const lessons = [
      { slug: "a", subject: "Математика", is_new: true, archive_url: "/a.zip", views_count: 1 },
      { slug: "b", subject: "Информатика", is_new: true, archive_url: "/b.zip", views_count: 90 },
      { slug: "c", subject: "Информатика", archive_url: "/c.zip", views_count: 20 },
      { slug: "d", subject: "Информатика", file_url: "/d.html", views_count: 10 },
    ];
    const picked = pickTryNowLessons(lessons, { subject: "Информатика", limit: 3 });
    expect(picked.map((row) => row.slug)).toEqual(["b", "c", "d"]);
  });
});

describe("similarLessons", () => {
  it("ranks by real subject/topic/grade overlap and ignores unrelated items", () => {
    const current = { slug: "base", subject: "Информатика", grade: 9, topic: "Графы", exam_type: "oge" };
    const related = similarLessons([
      current,
      { slug: "same-topic", subject: "Информатика", grade: 9, topic: "Графы" },
      { slug: "other-subject", subject: "Химия", grade: 9, topic: "Графы" },
      { slug: "same-subject-only", subject: "Информатика" },
    ], current, 4);
    expect(related.map((row) => row.slug)).toEqual(["same-topic"]);
  });
});

describe("subscriptionBreakEven", () => {
  it("uses current prices instead of a hardcoded count", () => {
    expect(subscriptionBreakEven(500, 1990)).toBe(4);
    expect(subscriptionBreakEven(0, 1990)).toBeNull();
  });
});
