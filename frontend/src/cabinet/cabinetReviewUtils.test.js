import { describe, expect, it } from "vitest";
import {
  buildStudentHomeworkReviewRows,
  homeworkTaskAnswer,
  resolvePart1Verdict,
} from "./cabinetReviewUtils";
import { homeworkResultToUiState, buildHomeworkResultPayload } from "../utils/cabinetHomework";

describe("homeworkTaskAnswer legacy number keys", () => {
  const tasks = [
    { id: 101, number: 1, answer: "26", part: 1 },
    { id: 102, number: 2, answer: "199", part: 1 },
    { id: 105, number: 5, answer: "208", part: 1 },
    { id: 106, number: 6, answer: "732", part: 1 },
    { id: 108, number: 8, answer: "109", part: 1 },
  ];

  it("maps by_task_id number-keys to the right task numbers", () => {
    const result = {
      by_task_id: { "1": "26", "2": "199", "3": "16", "6": "732", "8": "55" },
      by_number: {},
      checked: { "105": false, "108": false },
    };

    expect(homeworkTaskAnswer(result, 101, 1, tasks)).toBe("26");
    expect(homeworkTaskAnswer(result, 102, 2, tasks)).toBe("199");
    expect(homeworkTaskAnswer(result, 105, 5, tasks)).toBe("");
    expect(homeworkTaskAnswer(result, 106, 6, tasks)).toBe("732");
    expect(homeworkTaskAnswer(result, 108, 8, tasks)).toBe("55");
  });

  it("empty answer is Нет ответа even if checked=false", () => {
    const result = { checked: { "105": false } };
    expect(resolvePart1Verdict(tasks[2], "", result, "math")).toBe(null);
    expect(resolvePart1Verdict(tasks[3], "732", { checked: { "106": true } }, "math")).toBe(true);
  });

  it("builds one review row per task with correct verdicts", () => {
    const result = {
      by_task_id: { "1": "26", "2": "199", "3": "16", "6": "732", "8": "109" },
      checked: {},
    };
    const review = buildStudentHomeworkReviewRows(tasks, result, "ege", "math");
    expect(review.part1).toHaveLength(5);

    const byNum = Object.fromEntries(review.part1.map((r) => [r.number, r]));
    expect(byNum[1].answer).toBe("26");
    expect(byNum[1].verdict).toBe(true);
    expect(byNum[5].answer).toBe("");
    expect(byNum[5].verdict).toBe(null);
    expect(byNum[6].answer).toBe("732");
    expect(byNum[6].verdict).toBe(true);
    expect(byNum[8].answer).toBe("109");
    expect(byNum[8].verdict).toBe(true);
  });
});

describe("homeworkResultToUiState + payload", () => {
  it("hydrates number-keyed by_task_id onto real task ids and re-saves by_number", () => {
    const tasks = [
      { id: 101, number: 1 },
      { id: 106, number: 6 },
    ];
    const map = new Map(tasks.map((t) => [String(t.number), t]));
    const ui = homeworkResultToUiState(
      { by_task_id: { "1": "26", "6": "732" }, by_number: {} },
      map,
    );
    expect(ui.userAnswers["101"]).toBe("26");
    expect(ui.userAnswers["106"]).toBe("732");
    expect(ui.userAnswers["1"]).toBeUndefined();

    const payload = buildHomeworkResultPayload(tasks, ui.userAnswers, {}, {});
    expect(payload.by_task_id).toEqual({ "101": "26", "106": "732" });
    expect(payload.by_number).toEqual({ "1": "26", "6": "732" });
  });
});
