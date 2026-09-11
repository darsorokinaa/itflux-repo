import { describe, expect, it } from "vitest";
import { datetimeLocalToIso, toDateTimeLocalValue } from "./homeworkDueAt";

describe("homeworkDueAt", () => {
  it("converts datetime-local values as local calendar time, not UTC midnight", () => {
    const iso = datetimeLocalToIso("2026-09-18T23:59");
    expect(iso).toBeTruthy();
    const roundTrip = toDateTimeLocalValue(iso);
    expect(roundTrip).toBe("2026-09-18T23:59");
  });

  it("keeps a changed date after converting to ISO and back", () => {
    const original = toDateTimeLocalValue("2026-09-11T21:00:00.000Z");
    const nextLocal = original.replace(/^\d{4}-\d{2}-\d{2}/, "2026-09-22");
    expect(nextLocal).not.toBe(original);
    const saved = datetimeLocalToIso(nextLocal);
    expect(toDateTimeLocalValue(saved).slice(0, 10)).toBe("2026-09-22");
  });

  it("returns null for an empty deadline instead of reusing the previous ISO", () => {
    expect(datetimeLocalToIso("")).toBeNull();
    expect(datetimeLocalToIso("not-a-date")).toBeNull();
  });
});
