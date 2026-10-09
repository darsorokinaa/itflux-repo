import { describe, expect, it } from "vitest";
import { expectedUpdatedAtForWrite, savedEventWhen, scheduleConflictMessage } from "./scheduleConflict";

describe("scheduleConflictMessage", () => {
  it("keeps both the saved version and the unsaved edit", () => {
    const view = scheduleConflictMessage(
      {
        message: "Это занятие уже изменили в другой вкладке.",
        serverEvent: { startsAt: "2026-10-14T16:00:00+03:00", startTime: "16:00" },
      },
      { targetDate: "2026-10-15", targetStartTime: "18:30" },
    );
    expect(view.saved).toBe("2026-10-14 16:00");
    expect(view.mine).toBe("2026-10-15 18:30");
    expect(view.text).toContain("другой вкладке");
    expect(savedEventWhen(null)).toBe("нет данных");
  });

  it("retries with the current server version and keeps the check", () => {
    const event = { updatedAt: "2026-10-14T10:00:00+03:00" };
    const conflict = { serverEvent: { updatedAt: "2026-10-14T10:05:00+03:00" } };
    expect(expectedUpdatedAtForWrite(event, conflict)).toBe("2026-10-14T10:05:00+03:00");
    expect(expectedUpdatedAtForWrite(event, null)).toBe("2026-10-14T10:00:00+03:00");
    const again = { serverEvent: { updatedAt: "2026-10-14T10:09:00+03:00" } };
    expect(expectedUpdatedAtForWrite(event, again)).toBe("2026-10-14T10:09:00+03:00");
    expect(expectedUpdatedAtForWrite({}, null)).toBe("");
  });
});
