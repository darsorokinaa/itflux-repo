import { describe, expect, it } from "vitest";
import { formatParentDate, formatParentDateTime, parentStatusText } from "./parentFormat";

const now = new Date(2026, 9, 24, 12, 0);

describe("parentFormat", () => {
  it("formats dates in one Russian style", () => {
    expect(formatParentDate("2026-08-25", now)).toBe("25 авг.");
    expect(formatParentDate("2025-12-01", now)).toBe("1 дек. 2025");
    expect(formatParentDateTime(new Date(2026, 9, 24, 13, 5), now)).toBe("24 окт., 13:05");
    expect(formatParentDate(null, now)).toBe("—");
  });
  it("does not repeat overdue", () => {
    expect(parentStatusText({ status_label: "Просрочено" }, { overdueShown: true })).toBe("");
    expect(parentStatusText({ status_label: "Просрочено" })).toBe("Просрочено");
    expect(parentStatusText({ status_label: "Не сдано" }, { overdueShown: true })).toBe("Не сдано");
  });
});
