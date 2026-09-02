import { describe, expect, it } from "vitest";
import {
  applyPlanDates,
  calendarDaysBetween,
  compressPlanDatesAfterRemove,
  describeDateDeviation,
  generatePlanDates,
  inferPlanDateInterval,
  isManualDateOverride,
  nextPlanDateAfter,
  plannedDateAtIndex,
  willCompressDatesAfterRemove,
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

  it("compresses remaining lessons into existing date slots after a deletion", () => {
    const sessions = [
      { title: "T1", scheduledDate: "2026-09-05" },
      { title: "T2", scheduledDate: "2026-09-12" },
      { title: "T3", scheduledDate: "2026-09-19" },
      { title: "T4", scheduledDate: "2026-09-26" },
    ];
    expect(compressPlanDatesAfterRemove(sessions, [1]).map((s) => [s.title, s.scheduledDate])).toEqual([
      ["T1", "2026-09-05"],
      ["T3", "2026-09-12"],
      ["T4", "2026-09-19"],
    ]);
    expect(compressPlanDatesAfterRemove(sessions, [0]).map((s) => [s.title, s.scheduledDate])).toEqual([
      ["T2", "2026-09-05"],
      ["T3", "2026-09-12"],
      ["T4", "2026-09-19"],
    ]);
    expect(compressPlanDatesAfterRemove(sessions, [3]).map((s) => [s.title, s.scheduledDate])).toEqual([
      ["T1", "2026-09-05"],
      ["T2", "2026-09-12"],
      ["T3", "2026-09-19"],
    ]);
    const afterFirst = compressPlanDatesAfterRemove(sessions, [1]);
    expect(compressPlanDatesAfterRemove(afterFirst, [1]).map((s) => [s.title, s.scheduledDate])).toEqual([
      ["T1", "2026-09-05"],
      ["T4", "2026-09-12"],
    ]);
  });

  it("compresses twice-weekly slots without subtracting a week", () => {
    const sessions = [
      { title: "A", scheduledDate: "2026-09-01" },
      { title: "B", scheduledDate: "2026-09-04" },
      { title: "C", scheduledDate: "2026-09-08" },
      { title: "D", scheduledDate: "2026-09-11" },
    ];
    expect(compressPlanDatesAfterRemove(sessions, [1]).map((s) => s.scheduledDate)).toEqual([
      "2026-09-01",
      "2026-09-04",
      "2026-09-08",
    ]);
  });

  it("compresses a whole topic range of consecutive lessons", () => {
    const sessions = [
      { title: "A1", scheduledDate: "2026-09-05" },
      { title: "B1", scheduledDate: "2026-09-12" },
      { title: "B2", scheduledDate: "2026-09-19" },
      { title: "C1", scheduledDate: "2026-09-26" },
    ];
    expect(compressPlanDatesAfterRemove(sessions, [1, 2]).map((s) => [s.title, s.scheduledDate])).toEqual([
      ["A1", "2026-09-05"],
      ["C1", "2026-09-12"],
    ]);
  });

  it("keeps later dates when the last item is removed", () => {
    expect(willCompressDatesAfterRemove([
      { scheduledDate: "2026-09-05" },
      { scheduledDate: "2026-09-12" },
    ], [1])).toBe(false);
    expect(willCompressDatesAfterRemove([
      { scheduledDate: "2026-09-05" },
      { scheduledDate: "2026-09-12" },
    ], [0])).toBe(true);
  });

  it("describes calendar-day deviations without treating same-day as an error", () => {
    expect(calendarDaysBetween("2026-09-12", "2026-09-12T18:00:00")).toBe(0);
    expect(describeDateDeviation("2026-09-12", "2026-09-12").message).toBe("");
    expect(describeDateDeviation("2026-09-12", "2026-09-13").message).toBe(
      "Эта дата отличается от текущего плана на 1 день.",
    );
    expect(describeDateDeviation("2026-09-12", "2026-09-15").message).toBe(
      "Эта дата отличается от текущего плана на 3 дня.",
    );
    expect(describeDateDeviation("2026-09-12", "2026-09-19").message).toBe(
      "Эта дата отличается от текущего плана примерно на 1 неделю.",
    );
    expect(describeDateDeviation("2026-09-20", "2026-09-13").message).toBe(
      "Новая дата раньше текущего плана примерно на 1 неделю.",
    );
    expect(describeDateDeviation("2026-09-12", "2026-09-26").extra).toBe(
      "Это сдвинет занятие примерно на два занятия относительно плана.",
    );
  });

  it("marks a later lesson as a manual override against the generated plan", () => {
    const sessions = [
      { scheduledDate: "2026-09-05" },
      { scheduledDate: "2026-09-12" },
      { scheduledDate: "2026-09-26" },
    ];
    expect(plannedDateAtIndex(sessions, 2, "weekly")).toBe("2026-09-19");
    expect(isManualDateOverride(sessions, 2, "weekly")).toBe(true);
    expect(isManualDateOverride(sessions, 1, "weekly")).toBe(false);
    expect(isManualDateOverride(sessions, 0, "weekly")).toBe(false);
  });
});
