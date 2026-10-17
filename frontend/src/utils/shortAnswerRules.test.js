import { describe, expect, it } from "vitest";
import { scoreShortAnswerRule, shortAnswerRule } from "./shortAnswerRules";
import { scoreVariantAttempt } from "./variantResult";
import { inferExamTaskPart } from "./examTaskPart";

describe("shortAnswerRules (ФИПИ 2026)", () => {
  it("positional one error", () => {
    expect(scoreShortAnswerRule("pos1", "124", "124", 2)).toBe(2);
    expect(scoreShortAnswerRule("pos1", "125", "124", 2)).toBe(1);
    expect(scoreShortAnswerRule("pos1", "421", "124", 2)).toBe(0);
    expect(scoreShortAnswerRule("pos1", "1245", "124", 2)).toBe(0);
  });
  it("set rule", () => {
    expect(scoreShortAnswerRule("set1", "31", "13", 2)).toBe(2);
    expect(scoreShortAnswerRule("set1", "14", "13", 2)).toBe(1);
    expect(scoreShortAnswerRule("set1", "1", "13", 2)).toBe(1);
    expect(scoreShortAnswerRule("set1", "134", "13", 2)).toBe(0);
  });
  it("positional decrement", () => {
    expect(scoreShortAnswerRule("posdec", "2122332", "1122332", 3)).toBe(2);
    expect(scoreShortAnswerRule("posdec", "2211332", "1122332", 3)).toBe(0);
  });
  it("non-digit answers fall back", () => {
    expect(scoreShortAnswerRule("unordered", "чахлый", "чахлый", 1)).toBeNull();
    expect(shortAnswerRule({ number: 1 }, "ege", "phys")).toBeNull();
  });
  it("variant scoring mirrors backend", () => {
    const tasks = [
      { id: 1, number: 1, max_score: 2, part: 1, answer: "124" },
      { id: 2, number: 14, max_score: 2, part: 1, answer: "13" },
    ];
    const s = scoreVariantAttempt({ tasks, level: "oge", subject: "phys", answers: { 1: "125", 2: "31" } });
    expect(s.tasks.map((r) => r.points)).toEqual([1, 2]);
  });
  it("OGE rus №1 is manual", () => {
    expect(inferExamTaskPart({ number: 1, part: 1, part_title: "Часть 1" }, "oge", "rus")).toBe(2);
    expect(inferExamTaskPart({ number: 2, part: 1, part_title: "Часть 1" }, "oge", "rus")).toBe(1);
  });
});
