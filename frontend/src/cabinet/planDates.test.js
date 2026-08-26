import { describe, expect, it } from "vitest";
import {
  applyPlanDates,
  generatePlanDates,
  inferPlanDateInterval,
  nextPlanDateAfter,
} from "./planDates";

describe("planDates", () => {
  it("fills weekly dates from the first lesson", () => {
    expect(generatePlanDates("2026-09-01", 3, "weekly")).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
    ]);
  });

  it("alternates 3 and 4 days for twice a week", () => {
    expect(generatePlanDates("2026-09-01", 4, "twice_weekly")).toEqual([
      "2026-09-01",
      "2026-09-04",
      "2026-09-08",
      "2026-09-11",
    ]);
  });

  it("keeps earlier sessions when filling from the first date", () => {
    const sessions = [
      { title: "A", scheduledDate: "" },
      { title: "B", scheduledDate: "2026-01-01" },
      { title: "C", scheduledDate: "" },
    ];
    expect(applyPlanDates(sessions, "2026-09-07", "weekly").map((s) => s.scheduledDate)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
  });

  it("infers twice-weekly interval from existing dates", () => {
    expect(inferPlanDateInterval([
      { scheduledDate: "2026-09-01" },
      { scheduledDate: "2026-09-04" },
    ])).toBe("twice_weekly");
  });

  it("computes the next date when adding a session", () => {
    expect(nextPlanDateAfter("2026-09-01", 0, "weekly")).toBe("2026-09-08");
  });

  it("fills three times a week", () => {
    expect(generatePlanDates("2026-09-01", 4, "thrice_weekly")).toEqual([
      "2026-09-01",
      "2026-09-03",
      "2026-09-05",
      "2026-09-08",
    ]);
  });

  it("fills four times a week", () => {
    expect(generatePlanDates("2026-09-01", 5, "four_weekly")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-04",
      "2026-09-05",
      "2026-09-08",
    ]);
  });

  it("fills every day", () => {
    expect(generatePlanDates("2026-09-01", 4, "daily")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });
});
