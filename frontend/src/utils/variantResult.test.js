import { describe, expect, it } from "vitest";
import { scoreInformaticsTableTask } from "./examAnswerCheck";
import { scoreVariantAttempt, taskMaxPoints, tasksForStoredAttempt } from "./variantResult";

function task(id, extra = {}) {
  return {
    id,
    number: extra.number ?? id,
    max_score: extra.max_score ?? 1,
    part: extra.part ?? 1,
    exam_part: extra.exam_part,
    part_title: extra.part_title || "",
    answer: extra.answer ?? "42",
  };
}

function assertInvariant(summary) {
  expect(summary.earned_points).toBeGreaterThanOrEqual(0);
  expect(summary.earned_points).toBeLessThanOrEqual(summary.max_points);
  expect(
    summary.correct_count
      + summary.incorrect_count
      + summary.partial_count
      + summary.unanswered_count
      + summary.pending_review_count,
  ).toBe(summary.total_tasks);
}

describe("scoreVariantAttempt", () => {
  it("uses the real composition as the maximum", () => {
    const cases = [
      { count: 1, max: 1, expected: 1 },
      { count: 5, max: 1, expected: 5 },
      { count: 10, max: 1, expected: 10 },
      { count: 12, max: 2, expected: 24 },
      { count: 20, max: 1, expected: 20 },
      { count: 27, max: 1, expected: 27 },
    ];
    for (const item of cases) {
      const tasks = Array.from({ length: item.count }, (_, index) => (
        task(index + 1, { max_score: item.max, exam_part: 1 })
      ));
      const answers = Object.fromEntries(tasks.map((row) => [row.id, "42"]));
      const summary = scoreVariantAttempt({ tasks, answers, level: "ege", subject: "hist" });
      expect(summary.max_points).toBe(item.expected);
      expect(summary.earned_points).toBe(item.expected);
      expect(summary.correct_count).toBe(item.count);
      assertInvariant(summary);
    }

    const mixed = [
      ...Array.from({ length: 8 }, (_, index) => task(index + 1, { max_score: 1 })),
      ...Array.from({ length: 4 }, (_, index) => task(100 + index, { max_score: 3, exam_part: 2, answer: "" })),
    ];
    const mixedSummary = scoreVariantAttempt({
      tasks: mixed,
      answers: Object.fromEntries(mixed.filter((row) => row.exam_part !== 2).map((row) => [row.id, "42"])),
      scores: Object.fromEntries(mixed.filter((row) => row.exam_part === 2).map((row) => [row.id, 3])),
      level: "ege",
      subject: "math",
    });
    expect(mixedSummary.max_points).toBe(20);
    expect(mixedSummary.earned_points).toBe(20);
    assertInvariant(mixedSummary);
  });

  it("does not invent 3 points when max_score is missing", () => {
    expect(taskMaxPoints({})).toBe(1);
    const summary = scoreVariantAttempt({
      tasks: [{ id: 1, number: 1, part: 1, answer: "a" }],
      answers: { 1: "a" },
    });
    expect(summary.max_points).toBe(1);
    expect(summary.earned_points).toBe(1);
  });

  it("keeps skips, mistakes and partial credit apart", () => {
    const tasks = [1, 2, 3, 4, 5].map((id) => task(id, { max_score: 2 }));
    const wrong = scoreVariantAttempt({
      tasks,
      answers: Object.fromEntries(tasks.map((row) => [row.id, "нет"])),
    });
    expect(wrong.incorrect_count).toBe(5);
    expect(wrong.earned_points).toBe(0);
    expect(wrong.percentage).toBe(0);
    assertInvariant(wrong);

    const skipped = scoreVariantAttempt({ tasks, answers: {} });
    expect(skipped.unanswered_count).toBe(5);
    expect(skipped.incorrect_count).toBe(0);
    assertInvariant(skipped);

    const mixed = scoreVariantAttempt({
      tasks: [
        task(1),
        task(2),
        task(3),
        task(4, { max_score: 3, exam_part: 2, answer: "" }),
      ],
      answers: { 1: "42", 2: "нет", 4: "решение" },
      scores: { 4: 1 },
      level: "ege",
      subject: "math",
    });
    expect(mixed.correct_count).toBe(1);
    expect(mixed.incorrect_count).toBe(1);
    expect(mixed.unanswered_count).toBe(1);
    expect(mixed.partial_count).toBe(1);
    expect(mixed.earned_points).toBe(2);
    expect(mixed.max_points).toBe(6);
    assertInvariant(mixed);
  });

  it("does not treat a manual answer as wrong before a score exists", () => {
    const summary = scoreVariantAttempt({
      tasks: [
        task(1, { answer: "1" }),
        task(2, { max_score: 3, exam_part: 2, answer: "" }),
      ],
      answers: { 1: "1", 2: "текст" },
      level: "ege",
      subject: "rus",
    });
    expect(summary.pending_review_count).toBe(1);
    expect(summary.incorrect_count).toBe(0);
    expect(summary.percentage).toBeNull();
    expect(summary.preliminary).toBe(true);
    assertInvariant(summary);
  });

  it("treats an explicit zero differently from a missing score", () => {
    const row = task(7, { max_score: 4, exam_part: 2, answer: "" });
    const pending = scoreVariantAttempt({ tasks: [row], answers: { 7: "решение" } });
    const zero = scoreVariantAttempt({ tasks: [row], answers: { 7: "решение" }, scores: { 7: 0 } });
    expect(pending.pending_review_count).toBe(1);
    expect(pending.percentage).toBeNull();
    expect(zero.incorrect_count).toBe(1);
    expect(zero.percentage).toBe(0);
  });

  it("replaces a teacher score instead of adding it", () => {
    const row = task(3, { max_score: 3, exam_part: 2, answer: "" });
    const first = scoreVariantAttempt({ tasks: [row], answers: { 3: "x" }, scores: { 3: 1 } });
    const second = scoreVariantAttempt({ tasks: [row], answers: { 3: "x" }, scores: { 3: 3 } });
    expect(first.earned_points).toBe(1);
    expect(first.partial_count).toBe(1);
    expect(second.earned_points).toBe(3);
    expect(second.correct_count).toBe(1);
  });

  it("clamps a score to the task maximum", () => {
    const summary = scoreVariantAttempt({
      tasks: [task(3, { max_score: 2, exam_part: 2, answer: "" })],
      scores: { 3: 9 },
    });
    expect(summary.earned_points).toBe(2);
    expect(summary.max_points).toBe(2);
  });

  it("does not divide by zero when the variant has no tasks", () => {
    const summary = scoreVariantAttempt({ tasks: [] });
    expect(summary.total_tasks).toBe(0);
    expect(summary.max_points).toBe(0);
    expect(summary.percentage).toBeNull();
    expect(summary.review_status).toBe("empty");
    assertInvariant(summary);
  });

  it("keeps informatics 26 and 27 partial credit", () => {
    expect(scoreInformaticsTableTask(26, "5\t7", "5\t7")).toBe(2);
    expect(scoreInformaticsTableTask(26, "5\t0", "5\t7")).toBe(1);
    expect(scoreInformaticsTableTask(27, "1\t2\n3\t4", "1\t2\n3\t4")).toBe(2);
    expect(scoreInformaticsTableTask(27, "1\t2\n0\t0", "1\t2\n3\t4")).toBe(1);
    const row = task(26, { number: 26, max_score: 2, answer: "5\t7" });
    const partial = scoreVariantAttempt({
      tasks: [row],
      level: "ege",
      subject: "inf",
      answers: { 26: "5\t0" },
    });
    expect(partial.partial_count).toBe(1);
    expect(partial.earned_points).toBe(1);
    expect(partial.correct_count).toBe(0);
  });

  it("awards a two-point part 1 task its full value", () => {
    const summary = scoreVariantAttempt({
      tasks: [task(6, { number: 6, max_score: 2, answer: "15" })],
      level: "ege",
      subject: "chem",
      answers: { 6: "15" },
    });
    expect(summary.earned_points).toBe(2);
    expect(summary.correct_count).toBe(1);
  });
});

describe("tasksForStoredAttempt", () => {
  it("scores the frozen composition when the live variant gains a task and a new key", () => {
    const stored = {
      tasks_snapshot: [
        { id: 1, number: 1, max_score: 1, exam_part: 1 },
        { id: 2, number: 2, max_score: 3, exam_part: 2 },
      ],
      grading_snapshot: [
        { id: 1, number: 1, max_score: 1, exam_part: 1, answer: "10" },
        { id: 2, number: 2, max_score: 3, exam_part: 2, answer: "" },
      ],
    };
    const live = [
      { id: 1, number: 1, max_score: 1, exam_part: 1, answer: "НЕ-ТОТ", text: "условие" },
      { id: 2, number: 2, max_score: 3, exam_part: 2, text: "часть 2" },
      { id: 3, number: 3, max_score: 1, exam_part: 1, answer: "4" },
    ];
    const tasks = tasksForStoredAttempt(live, stored, "ege", "math");
    expect(tasks.map((item) => item.id)).toEqual([1, 2]);
    expect(tasks[0].answer).toBe("10");
    expect(tasks[0].text).toBe("условие");
    const summary = scoreVariantAttempt({
      tasks,
      level: "ege",
      subject: "math",
      answers: { 1: "10", 2: "решение" },
      scores: { 2: 1 },
    });
    expect(summary.total_tasks).toBe(2);
    expect(summary.earned_points).toBe(2);
    expect(summary.max_points).toBe(4);
    expect(summary.partial_count).toBe(1);
    expect(summary.correct_count).toBe(1);
  });
});
