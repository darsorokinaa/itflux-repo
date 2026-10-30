import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveVariantAnswersTable, { part2ScoreLabel, lockedScoreFor } from "./LiveVariantAnswersTable.jsx";

describe("r122 compact part-2 score", () => {
  it("label", () => {
    expect(part2ScoreLabel({ lockedScores: { 7: { score: 2 } } }, { id: 7, maxScore: 3 })).toBe("2/3");
    expect(part2ScoreLabel({}, { id: 7, maxScore: 3 })).toBe("—");
    expect(lockedScoreFor({ lockedScores: { 7: 1 } }, { id: 7 })).toBe(1);
  });
  it("table has no inputs or criteria, part-1 rows unchanged", () => {
    const answers = {
      tasks: [
        { id: 1, number: 1, answer: "15", part: 1, maxScore: 1 },
        { id: 7, number: 20, answer: "", part: 2, maxScore: 3 },
      ],
      students: [{ studentId: 1, displayName: "У", result: { by_task_id: { 1: "15", 7: "x" }, checked: { 1: true } }, lockedScores: { 7: { score: 2 } } }],
    };
    const { container } = render(<LiveVariantAnswersTable answers={answers} compact />);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getByText("верно")).toBeTruthy();
  });
});
