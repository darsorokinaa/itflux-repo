/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatResultLine } from "./homeworkResultSummary";
import { scoreVariantAttempt, tasksForStoredAttempt } from "../utils/variantResult";

afterEach(() => cleanup());

const storedAttempt = {
  tasks_snapshot: [
    { id: 1, number: 1, max_score: 1, exam_part: 1 },
    { id: 2, number: 13, max_score: 3, exam_part: 2 },
  ],
  grading_snapshot: [
    { id: 1, number: 1, max_score: 1, exam_part: 1, answer: "10" },
    { id: 2, number: 13, max_score: 3, exam_part: 2, answer: "" },
  ],
};

function Pages({ summary, scoring }) {
  const caption = scoring.preliminary ? "Предварительно" : "Подтверждено";
  return (
    <main>
      <p data-testid="student-card">{formatResultLine(summary)}</p>
      <p data-testid="teacher-review">{scoring.earned_points} из {scoring.max_points}. {caption}</p>
      <p data-testid="journal">{summary.earned_points} из {summary.max_points}</p>
    </main>
  );
}

describe("one attempt on student card, review and journal", () => {
  it("shows the same primary score and does not treat a pending part as a final grade", () => {
    const live = [
      { id: 1, number: 1, max_score: 5, exam_part: 1, answer: "ДРУГОЙ" },
      { id: 2, number: 13, max_score: 9, exam_part: 2 },
      { id: 9, number: 9, max_score: 1, exam_part: 1, answer: "лишнее" },
    ];
    const tasks = tasksForStoredAttempt(live, storedAttempt, "ege", "math");
    const pending = scoreVariantAttempt({
      tasks,
      level: "ege",
      subject: "math",
      answers: { 1: "10", 2: "текст" },
      scores: {},
    });
    const pendingSummary = {
      is_final: true,
      earned_points: null,
      max_points: null,
      percentage: null,
      correct_count: null,
      total_count: null,
      review_status: pending.review_status,
    };
    render(<Pages summary={pendingSummary} scoring={pending} />);
    expect(pending.review_status).toBe("pending_review");
    expect(pending.earned_points).toBe(1);
    expect(screen.getByTestId("student-card").textContent).toBe("");
    expect(screen.getByTestId("teacher-review").textContent).toContain("Предварительно");
    expect(screen.getByTestId("teacher-review").textContent).not.toContain("Подтверждено");
    cleanup();

    const finalScoring = scoreVariantAttempt({
      tasks,
      level: "ege",
      subject: "math",
      answers: { 1: "10", 2: "текст" },
      scores: { 2: 3 },
    });
    const finalSummary = {
      is_final: true,
      earned_points: finalScoring.earned_points,
      max_points: finalScoring.max_points,
      percentage: finalScoring.percentage,
      correct_count: finalScoring.correct_count,
      total_count: finalScoring.total_tasks,
      review_status: finalScoring.review_status,
    };
    render(<Pages summary={finalSummary} scoring={finalScoring} />);
    expect(finalScoring.earned_points).toBe(4);
    expect(finalScoring.max_points).toBe(4);
    expect(screen.getByTestId("student-card").textContent).toContain("4 из 4");
    expect(screen.getByTestId("teacher-review").textContent).toContain("4 из 4");
    expect(screen.getByTestId("teacher-review").textContent).toContain("Подтверждено");
    expect(screen.getByTestId("journal").textContent).toBe("4 из 4");
    expect(screen.getByTestId("student-card").textContent).not.toContain("лишнее");
    expect(screen.getByTestId("teacher-review").textContent).not.toContain("ДРУГОЙ");
  });
});
