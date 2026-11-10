import { describe, expect, it } from "vitest";
import { checkMode, scoreVprSpec, valuesEqual } from "./vprAnswerCheck";
import { scoreVariantAttempt } from "./variantResult";

describe("vpr answer spec on the variant page", () => {
  it("keeps a fraction and does not accept its decimal", () => {
    expect(valuesEqual("8/3", "16/6")).toBe(true);
    expect(valuesEqual("8/3", "2,666")).toBe(false);
    expect(checkMode("fraction", 1)).toBe("auto");
    const fraction = scoreVprSpec(
      { answer_format: "fraction", answer_data: { value: "1/6" } },
      "0,166",
      1,
    );
    expect(fraction.status).toBe("incorrect");
    expect(scoreVprSpec(
      { answer_format: "fraction", answer_data: { value: "1/6" } },
      "2/12",
      1,
    ).status).toBe("correct");
    expect(valuesEqual("0,9375", "0.9375")).toBe(true);
    expect(valuesEqual("4√7 - 2", "4√7-2")).toBe(true);
  });

  it("does not auto-grade a file or a program", () => {
    expect(checkMode("document_file", 3)).toBe("manual");
    expect(checkMode("program_file", 4)).toBe("manual");
    expect(checkMode("any_of_programs", 1)).toBe("manual");
    const row = scoreVprSpec(
      { answer_format: "program_file", answer_data: { checker: "tools/kumir_robot.py" } },
      "программа",
      4,
    );
    expect(row.status).toBe("pending_review");
    expect(row.points).toBe(0);
  });

  it("gives one point for a single missing digit when the maximum is 2", () => {
    const graded = scoreVprSpec(
      { answer_format: "multiple_choice_set", answer_data: { choices: ["1", "8"], order: "ascending, без разделителей" } },
      "1",
      2,
    );
    expect(graded.status).toBe("partial");
    expect(graded.points).toBe(1);
  });

  it("scores a truth-table column without the site widget", () => {
    const spec = {
      answer_format: "truth_table_column",
      answer_data: { rows: [{ F: 1 }, { F: 0 }, { F: 1 }, { F: 1 }] },
    };
    expect(scoreVprSpec(spec, "1, 0, 1, 1", 1).status).toBe("correct");
    expect(scoreVprSpec(spec, "1, 0, 1, 0", 2).points).toBe(1);
  });

  it("keeps a graphic task pending inside the variant total", () => {
    const summary = scoreVariantAttempt({
      tasks: [{
        id: 9,
        number: 9,
        max_score: 2,
        answer: "1) 100; 2) график",
        answer_check: { mode: "mixed", format: "two_parts: number; graph_points" },
        answer_spec: {
          answer_format: "two_parts: number; graph_points",
          answer_data: { "9.1": { value: "100", score: 1 } },
        },
      }],
      answers: { 9: "1) 100; 2) ломаная" },
      level: "vpr",
      subject: "math",
    });
    expect(summary.tasks[0].status).toBe("pending_review");
    expect(summary.tasks[0].points).toBe(1);
    expect(summary.incorrect_count).toBe(0);
    expect(summary.correct_count).toBe(0);
  });

  it("accepts a widget table when variables are not alphabetical", () => {
    const prompt = (
      "<p>Заполните таблицу истинности выражения.</p>"
      + '<p><span class="math-inline">&#92;(\\lnot A \\land B&#92;&#41;</span></p>'
      + "<p>строк &#92;((B&#123;=&#125;0,A&#123;=&#125;0)&#92;&#41;</p>"
    );
    const spec = {
      answer_format: "truth_table_column",
      answer_data: {
        rows: [
          { inputs: [0, 0], F: 0 },
          { inputs: [0, 1], F: 1 },
          { inputs: [1, 0], F: 0 },
          { inputs: [1, 1], F: 0 },
        ],
      },
    };
    const widget = {
      id: 6,
      number: 6,
      max_score: 2,
      part: 1,
      answer: "0010",
      text: prompt,
      truth_table_enabled: true,
      answer_spec: spec,
    };
    const accepted = scoreVariantAttempt({
      tasks: [widget, {
        id: 1,
        number: 1,
        max_score: 1,
        part: 1,
        answer: "15",
        answer_spec: { answer_format: "number", answer_data: { value: "15" } },
      }],
      answers: { 6: "10 00 11 00", 1: "15" },
      level: "vpr",
      subject: "inf",
    });
    expect(accepted.tasks[0].status).toBe("correct");
    expect(accepted.tasks[0].points).toBe(2);
    expect(accepted.tasks[0].max_points).toBe(2);
    expect(accepted.tasks[1].status).toBe("correct");
    expect(accepted.earned_points).toBe(3);
    const rejected = scoreVariantAttempt({
      tasks: [widget],
      answers: { 6: "11 00 11 00" },
      level: "vpr",
      subject: "inf",
    });
    expect(rejected.tasks[0].status).toBe("incorrect");
    expect(rejected.tasks[0].points).toBe(0);
    expect(rejected.max_points).toBe(2);
    const columnOnly = scoreVariantAttempt({
      tasks: [{
        id: 7,
        number: 7,
        max_score: 1,
        answer: "0100",
        text: "Запишите столбец F.",
        truth_table_enabled: false,
        answer_spec: spec,
      }],
      answers: { 7: "0100" },
      level: "vpr",
      subject: "inf",
    });
    expect(columnOnly.tasks[0].status).toBe("correct");
    expect(scoreVprSpec(spec, "0100", 1).status).toBe("correct");
    expect(scoreVprSpec(spec, "10 00 11 00", 1).status).toBe("incorrect");
  });
});
