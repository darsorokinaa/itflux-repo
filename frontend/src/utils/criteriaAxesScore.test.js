import { describe, expect, it } from "vitest";
import {
  axesNeedScoreMatrix,
  axesScoreRows,
  computeAxesTaskScore,
  findAxisLevel,
} from "./criteriaAxesScore";

describe("computeAxesTaskScore", () => {
  const task4Axes = [
    { code: "content", max_score: 4 },
    { code: "organization", max_score: 3 },
    { code: "language", max_score: 3 },
  ];

  it("sums axes including when content is 0", () => {
    const r = computeAxesTaskScore(task4Axes, {
      content: 0,
      organization: 3,
      language: 3,
    });
    expect(r.total).toBe(6);
    expect(r.gated).toBe(false);
    expect(r.complete).toBe(true);
  });

  it("sums axes when all set", () => {
    const r = computeAxesTaskScore(task4Axes, {
      content: 3,
      organization: 2,
      language: 3,
    });
    expect(r.total).toBe(8);
    expect(r.complete).toBe(true);
  });

  it("counts binary questions", () => {
    const axes = [
      { code: "q1", max_score: 1 },
      { code: "q2", max_score: 1 },
      { code: "q3", max_score: 1 },
      { code: "q4", max_score: 1 },
    ];
    const r = computeAxesTaskScore(axes, { q1: 1, q2: 0, q3: 1, q4: 1 });
    expect(r.total).toBe(3);
    expect(r.complete).toBe(true);
  });
});

describe("axes table helpers", () => {
  it("builds descending score rows", () => {
    expect(
      axesScoreRows([
        { max_score: 4 },
        { max_score: 3 },
      ])
    ).toEqual([4, 3, 2, 1, 0]);
  });

  it("detects matrix vs binary table", () => {
    expect(axesNeedScoreMatrix([{ max_score: 4, levels: [{}, {}, {}] }])).toBe(true);
    expect(
      axesNeedScoreMatrix([
        { max_score: 1, levels: [{}, {}] },
        { max_score: 1, levels: [{}, {}] },
      ])
    ).toBe(false);
  });

  it("finds level by score", () => {
    const axis = {
      levels: [
        { id: 1, criteria_score: 3, criteria_text: "a" },
        { id: 2, criteria_score: 0, criteria_text: "b" },
      ],
    };
    expect(findAxisLevel(axis, 3)?.id).toBe(1);
    expect(findAxisLevel(axis, 1)).toBeNull();
  });
});
