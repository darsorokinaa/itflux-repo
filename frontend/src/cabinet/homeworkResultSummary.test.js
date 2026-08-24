import { describe, expect, it } from "vitest";
import {
  formatAutoCheckLine,
  formatResultLine,
  formatResultPercent,
} from "./homeworkResultSummary";

describe("homeworkResultSummary", () => {
  it("formats checked counts and percent", () => {
    expect(formatResultLine({
      is_final: true,
      correct_count: 8,
      total_count: 10,
      percentage: 80,
    })).toBe("8 из 10 · 80%");
  });

  it("does not format unchecked as 0%", () => {
    expect(formatResultLine({
      is_final: false,
      percentage: 0,
      correct_count: 0,
      total_count: 0,
    })).toBe("");
    expect(formatResultPercent({ is_final: false, percentage: 0 })).toBe(null);
  });

  it("shows auto-check preview only before final review", () => {
    expect(formatAutoCheckLine({
      is_final: false,
      auto_correct_count: 7,
      auto_total_count: 8,
    })).toBe("Автоматически: 7 / 8");
    expect(formatAutoCheckLine({
      is_final: true,
      auto_correct_count: 7,
      auto_total_count: 8,
    })).toBe("");
  });
});
