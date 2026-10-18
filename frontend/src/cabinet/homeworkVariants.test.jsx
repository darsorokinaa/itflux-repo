import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  homeworkVariantList,
  homeworkVariantListFromTasks,
  journalRowKey,
  otherVariantsWithoutAnswers,
  resultForVariant,
  startsVariantGroup,
} from "./homeworkVariants";
import { buildStudentHomeworkReviewRows, homeworkTaskAnswer } from "./cabinetReviewUtils";
import { tasksForStoredAttempt } from "../utils/variantResult";
import { homeworkResultToUiState } from "../utils/cabinetHomework";
import ReviewVariantTabs from "./ReviewVariantTabs";

// Два варианта с одинаковыми номерами заданий, как в реальных ДЗ (например, ДЗ 91, 758).
const v1Tasks = [
  { id: 11, number: 1, max_score: 1, exam_part: 1, answer: "10" },
  { id: 12, number: 2, max_score: 1, exam_part: 1, answer: "20" },
];
const v2Tasks = [
  { id: 21, number: 1, max_score: 1, exam_part: 1, answer: "30" },
  { id: 22, number: 2, max_score: 1, exam_part: 1, answer: "40" },
];
const result = {
  by_task_id: { 11: "10", 21: "30", 22: "41" },
  by_number: { 1: "30", 2: "41" },
  tasks_snapshot: [
    { id: 11, number: 1, max_score: 1, variant_id: 1 },
    { id: 12, number: 2, max_score: 1, variant_id: 1 },
    { id: 21, number: 1, max_score: 1, variant_id: 2 },
    { id: 22, number: 2, max_score: 1, variant_id: 2 },
  ],
  scoring: {
    total_tasks: 4,
    earned_points: 2,
    max_points: 4,
    tasks: [
      { id: 11, status: "correct", variant_id: 1 },
      { id: 12, status: "unanswered", variant_id: 1 },
      { id: 21, status: "correct", variant_id: 2 },
      { id: 22, status: "incorrect", variant_id: 2 },
    ],
    variants: [
      { variant_id: 1, earned_points: 1, max_points: 2 },
      { variant_id: 2, earned_points: 1, max_points: 2 },
    ],
  },
};

describe("homework with several variants (r75)", () => {
  it("lists every variant of the homework context, first one first", () => {
    const list = homeworkVariantList({
      variant_id: 1,
      variants: [
        { variant_id: 1, level: "ege", subject: "math", title: "Вариант 1" },
        { variant_id: 2, level: "oge", subject: "math", title: "Вариант 2" },
      ],
    });
    expect(list.map((row) => row.variantId)).toEqual([1, 2]);
    expect(list[1].level).toBe("oge");
    // Старый ответ API без variants — один вариант, как раньше.
    expect(homeworkVariantList({ variant_id: 5, level: "oge", subject: "math" }).map((r) => r.variantId)).toEqual([5]);
  });

  it("builds variants from homework tasks (student card)", () => {
    const list = homeworkVariantListFromTasks([
      { id: 1, is_variant: true, title: "A", open_url: "/ege/math/variant/7?homework_mode=1" },
      { id: 2, task_type: "file", is_variant: false },
      { id: 3, is_variant: true, title: "B", variant_id: 8, open_url: "/oge/math/variant/8" },
    ]);
    expect(list.map((row) => [row.variantId, row.level])).toEqual([[7, "ege"], [8, "oge"]]);
  });

  it("scopes snapshot, scoring and drops ambiguous by_number per variant", () => {
    const second = resultForVariant(result, 2, [1, 2]);
    expect(second.by_number).toBeUndefined();
    expect(second.tasks_snapshot.map((row) => row.id)).toEqual([21, 22]);
    expect(second.scoring.tasks.map((row) => row.id)).toEqual([21, 22]);
    expect(second.scoring.earned_points).toBe(1);
    expect(second.scoring.max_points).toBe(2);
    // Один вариант — без изменений.
    expect(resultForVariant(result, 1, [1])).toBe(result);
  });

  it("untagged snapshot of an old attempt belongs to the first variant only", () => {
    const old = { by_task_id: { 11: "10" }, tasks_snapshot: [{ id: 11, number: 1 }, { id: 12, number: 2 }] };
    expect(resultForVariant(old, 1, [1, 2]).tasks_snapshot).toHaveLength(2);
    const scoped = resultForVariant(old, 2, [1, 2]);
    expect(scoped.tasks_snapshot).toEqual([]);
    // Второй вариант строится по своим живым задачам, а не по снимку первого.
    expect(tasksForStoredAttempt(v2Tasks, scoped).map((t) => t.id)).toEqual([21, 22]);
  });

  it("first variant does not show answers of the second through by_number", () => {
    // Задание 12 первого варианта без ответа; by_number["2"] — ответ второго варианта.
    expect(homeworkTaskAnswer(result, 12, 2, v1Tasks)).toBe("41");
    const scoped = resultForVariant(result, 1, [1, 2]);
    expect(homeworkTaskAnswer(scoped, 12, 2, v1Tasks)).toBe("");
    const ui = homeworkResultToUiState(scoped, new Map(v1Tasks.map((t) => [String(t.number), t])), v1Tasks);
    expect(ui.userAnswers[11]).toBe("10");
    expect(ui.userAnswers[12]).toBeUndefined();
  });

  it("student review rows exist for the second variant", () => {
    const rows = buildStudentHomeworkReviewRows(v2Tasks, resultForVariant(result, 2, [1, 2]), "oge", "math");
    expect(rows.part1.map((row) => [row.taskId, row.answer])).toEqual([["21", "30"], ["22", "41"]]);
  });

  it("warns about other variants without answers", () => {
    const variants = [
      { variantId: 1, taskCount: 2, answeredCount: 1 },
      { variantId: 2, taskCount: 2, answeredCount: 0 },
      { variantId: 3, taskCount: 0, answeredCount: 0 },
    ];
    expect(otherVariantsWithoutAnswers(variants, 1).map((row) => row.variantId)).toEqual([2]);
    expect(otherVariantsWithoutAnswers(variants, 2)).toEqual([]);
  });

  it("groups journal rows by variant with unique keys", () => {
    const rows = [
      { id: 11, number: 1, variant_id: 1 },
      { id: 12, number: 2, variant_id: 1 },
      { id: 11, number: 1, variant_id: 2 },
    ];
    expect(rows.map((_, i) => startsVariantGroup(rows, i))).toEqual([true, false, true]);
    expect(new Set(rows.map((row) => journalRowKey("hw", row))).size).toBe(3);
    expect(startsVariantGroup([{ id: 1 }, { id: 2 }], 0)).toBe(false);
  });

  it("teacher sees a tab with the result of each variant", () => {
    const parts = [
      { row: { variantId: 1, title: "Вариант №1" }, level: "ege", subject: "math", tasks: v1Tasks, part1: v1Tasks, part2: [], result: resultForVariant(result, 1, [1, 2]) },
      { row: { variantId: 2, title: "Вариант №2" }, level: "oge", subject: "math", tasks: v2Tasks, part1: v2Tasks, part2: [], result: resultForVariant(result, 2, [1, 2]) },
    ];
    render(<ReviewVariantTabs variantParts={parts} activeId={1} onSelect={() => {}} result={result} scores={{}} />);
    const first = screen.getByRole("button", { name: /Вариант №1/ });
    const second = screen.getByRole("button", { name: /Вариант №2/ });
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(first.textContent).toContain("Ответов 1 из 2");
    expect(second.textContent).toContain("Ответов 2 из 2");
    expect(second.textContent).toContain("из 2 баллов");
  });
});
