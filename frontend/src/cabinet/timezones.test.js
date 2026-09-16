import { describe, expect, it } from "vitest";
import {
  formatWallClockInTimeZone,
  pickDefaultTimezone,
  studentTimezoneNote,
  timezoneCityLabel,
  wallClockToUtcMs,
} from "./timezones";

describe("timezone helpers", () => {
  it("converts teacher Moscow wall clock to Yekaterinburg", () => {
    expect(
      formatWallClockInTimeZone("2026-09-16", "15:00", "Europe/Moscow", "Asia/Yekaterinburg"),
    ).toBe("17:00");
  });

  it("keeps the same instant when zones match", () => {
    expect(
      formatWallClockInTimeZone("2026-09-16", "15:00", "Europe/Moscow", "Europe/Moscow"),
    ).toBe("15:00");
  });

  it("builds a student-facing timezone note", () => {
    expect(studentTimezoneNote("Asia/Vladivostok")).toBe("по вашему времени · Владивосток");
  });

  it("prefers a known profile timezone over an unknown value", () => {
    expect(pickDefaultTimezone("Asia/Irkutsk")).toBe("Asia/Irkutsk");
    expect(pickDefaultTimezone("Not/AZone")).toMatch(/^[A-Za-z]+\/[A-Za-z_+\-]+$/);
  });

  it("parses naive wall clock in Kamchatka as a later UTC instant than Moscow", () => {
    const moscow = wallClockToUtcMs("2026-09-16", "12:00", "Europe/Moscow");
    const kamchatka = wallClockToUtcMs("2026-09-16", "12:00", "Asia/Kamchatka");
    expect(kamchatka).toBeLessThan(moscow);
  });

  it("uses the first city from a compound label", () => {
    expect(timezoneCityLabel("Asia/Yekaterinburg")).toBe("Екатеринбург");
  });
});
