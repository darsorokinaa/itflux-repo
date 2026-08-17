import { describe, expect, it } from "vitest";

import {
  journalEventPk,
  lessonJournalFromMeetingPath,
  lessonSummaryPath,
} from "./openLessonSummary";

describe("openLessonSummary", () => {
  it("builds journal path for a numeric event id", () => {
    expect(journalEventPk("42")).toBe(42);
    expect(lessonSummaryPath("42")).toBe("/cabinet/journal/lesson/42");
    expect(lessonJournalFromMeetingPath("42")).toBe(
      "/cabinet/journal/lesson/42?from=meeting",
    );
  });

  it("accepts local-prefixed schedule ids", () => {
    expect(lessonJournalFromMeetingPath("local-7")).toBe(
      "/cabinet/journal/lesson/7?from=meeting",
    );
  });
});
