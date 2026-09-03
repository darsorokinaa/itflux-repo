import { describe, expect, it } from "vitest";
import { asCount, formatCompactCount } from "./catalogEngagement";

describe("asCount", () => {
  it("coerces missing and invalid values to 0", () => {
    expect(asCount(undefined)).toBe(0);
    expect(asCount(null)).toBe(0);
    expect(asCount("")).toBe(0);
    expect(asCount("abc")).toBe(0);
    expect(asCount(NaN)).toBe(0);
    expect(asCount(-3)).toBe(0);
  });

  it("keeps whole numbers", () => {
    expect(asCount(0)).toBe(0);
    expect(asCount(7)).toBe(7);
    expect(asCount("12")).toBe(12);
    expect(asCount(4.9)).toBe(4);
  });
});

describe("formatCompactCount", () => {
  it("shows raw counts below 1000", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("keeps thousands on one line", () => {
    expect(formatCompactCount(1000)).toBe("1\u00a0тыс.");
    expect(formatCompactCount(1200)).toBe("1,2\u00a0тыс.");
    expect(formatCompactCount(10_000)).toBe("10\u00a0тыс.");
  });

  it("formats millions", () => {
    expect(formatCompactCount(1_100_000)).toBe("1,1\u00a0млн");
  });

  it("does not render NaN or empty", () => {
    expect(formatCompactCount(undefined)).toBe("0");
    expect(formatCompactCount(null)).toBe("0");
  });
});
