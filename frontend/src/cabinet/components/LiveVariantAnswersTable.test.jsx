import { describe, expect, it } from "vitest";
import {
  liveAnswerVerdict,
  liveStudentAnswer,
  liveStudentChecked,
} from "./LiveVariantAnswersTable.jsx";

describe("liveStudentAnswer with duplicate bank numbers", () => {
  const tasks = [
    { id: 101, number: 8, answer: "501" },
    { id: 102, number: 8, answer: "100810" },
    { id: 103, number: 8, answer: "28175" },
  ];

  it("does not copy one answer onto every row when numbers collide", () => {
    const result = {
      by_task_id: { "101": "501" },
      by_number: { "8": "501" },
      checked: { "101": true },
    };

    expect(liveStudentAnswer(result, tasks[0], tasks)).toBe("501");
    expect(liveStudentAnswer(result, tasks[1], tasks)).toBe("");
    expect(liveStudentAnswer(result, tasks[2], tasks)).toBe("");

    expect(liveStudentChecked(result, tasks[0], tasks)).toBe(true);
    expect(liveStudentChecked(result, tasks[1], tasks)).toBe(null);
    expect(liveStudentChecked(result, tasks[2], tasks)).toBe(null);
  });

  it("still resolves by_number when the number is unique", () => {
    const uniqueTasks = [
      { id: 1, number: 1, answer: "a" },
      { id: 2, number: 2, answer: "b" },
    ];
    const result = {
      by_task_id: {},
      by_number: { "2": "99" },
      checked: { "2": false },
    };
    expect(liveStudentAnswer(result, uniqueTasks[1], uniqueTasks)).toBe("99");
    expect(liveStudentChecked(result, uniqueTasks[1], uniqueTasks)).toBe(false);
  });
});

describe("liveAnswerVerdict", () => {
  it("marks case-only difference as correct even if checked=false", () => {
    const tasks = [{ id: 10, number: 1, answer: "нетерпеливого" }];
    const result = {
      by_task_id: { "10": "Нетерпеливого" },
      checked: { "10": false },
    };
    expect(liveAnswerVerdict(result, tasks[0], tasks)).toBe(true);
  });

  it("keeps null when student has not answered", () => {
    const tasks = [{ id: 10, number: 1, answer: "гуава" }];
    const result = { by_task_id: {}, checked: {} };
    expect(liveAnswerVerdict(result, tasks[0], tasks)).toBe(null);
  });
});
