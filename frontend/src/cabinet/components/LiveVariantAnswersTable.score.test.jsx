import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Part2ScoreCell, lockedScoreFor } from "./LiveVariantAnswersTable.jsx";

const task = { id: 101, part: 2, maxScore: 3 };

describe("r120 Part2ScoreCell", () => {
  it("locked score is read-only", () => {
    render(<Part2ScoreCell meetingUuid="u" row={{ studentId: 1, lockedScores: { 101: { score: 2 } } }} task={task} />);
    expect(screen.getByTestId("part2-locked").textContent).toContain("2 / 3");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("saves once then becomes read-only", async () => {
    window.confirm = () => true;
    const saveFn = vi.fn().mockResolvedValue({ ok: true });
    render(<Part2ScoreCell meetingUuid="u" row={{ studentId: 1 }} task={task} saveFn={saveFn} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("part2-locked")).toBeTruthy());
    expect(saveFn).toHaveBeenCalledWith("u", { studentId: 1, taskId: 101, score: 3 });
  });
  it("rejects out-of-range", () => {
    const saveFn = vi.fn();
    render(<Part2ScoreCell meetingUuid="u" row={{ studentId: 1 }} task={task} saveFn={saveFn} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button"));
    expect(saveFn).not.toHaveBeenCalled();
  });
  it("lockedScoreFor", () => {
    expect(lockedScoreFor({ lockedScores: { 7: 1 } }, { id: 7 })).toBe(1);
    expect(lockedScoreFor({}, { id: 7 })).toBeNull();
  });
});
