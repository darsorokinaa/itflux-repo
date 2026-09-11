import { describe, expect, it } from "vitest";
import {
  homeworkJournalStatusKey,
  homeworkJournalStatusLabel,
  homeworkJournalStatusTone,
  isHomeworkTurnedIn,
  isUnsubmittedOverdue,
  wasHomeworkSubmittedLate,
} from "./homeworkStatus";

describe("homeworkJournalStatus", () => {
  it("keeps submitted late work as submitted, not overdue", () => {
    const entry = {
      status: "submitted",
      status_label: "Сдано",
      submitted_at: "2026-09-10T12:00:00Z",
      is_overdue: true,
    };
    expect(isHomeworkTurnedIn(entry)).toBe(true);
    expect(wasHomeworkSubmittedLate(entry)).toBe(true);
    expect(isUnsubmittedOverdue(entry)).toBe(false);
    expect(homeworkJournalStatusKey(entry)).toBe("submitted");
    expect(homeworkJournalStatusLabel(entry)).toBe("Сдано");
    expect(homeworkJournalStatusTone(entry)).toBe("info");
  });

  it("shows checked late work as checked", () => {
    const entry = {
      status: "checked",
      status_label: "Проверено",
      submitted_at: "2026-09-10T12:00:00Z",
      is_overdue: true,
      submitted_late: true,
    };
    expect(homeworkJournalStatusLabel(entry)).toBe("Проверено");
    expect(homeworkJournalStatusTone(entry)).toBe("success");
    expect(wasHomeworkSubmittedLate(entry)).toBe(true);
  });

  it("still shows overdue when the work was not turned in", () => {
    const entry = {
      status: "overdue",
      status_label: "Просрочено",
      is_overdue: true,
    };
    expect(isHomeworkTurnedIn(entry)).toBe(false);
    expect(wasHomeworkSubmittedLate(entry)).toBe(false);
    expect(isUnsubmittedOverdue(entry)).toBe(true);
    expect(homeworkJournalStatusLabel(entry)).toBe("Просрочено");
    expect(homeworkJournalStatusTone(entry)).toBe("danger");
  });

  it("treats overdue status with submitted_at as submitted late", () => {
    const entry = {
      status: "overdue",
      status_label: "Просрочено",
      submitted_at: "2026-09-10T12:00:00Z",
      is_overdue: true,
    };
    expect(homeworkJournalStatusLabel(entry)).toBe("Сдано");
    expect(wasHomeworkSubmittedLate(entry)).toBe(true);
    expect(isUnsubmittedOverdue(entry)).toBe(false);
  });
});
