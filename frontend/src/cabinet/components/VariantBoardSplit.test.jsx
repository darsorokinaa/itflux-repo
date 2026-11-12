import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VariantBoardSplit, {
  clampBoardWidth,
  variantBoardFrameSrc,
  variantBoardRequest,
  VB_MIN,
} from "./VariantBoardSplit";
import { boardSplitSyncBody, studentSplitStamp, visibleStudentSplit } from "./variantBoardSplitSync";
import { isVariantEmbed } from "../boards/variantEmbed";
import { fetchVariantBoard, postVariantBoardSplit } from "../../utils/cabinetAuth";

vi.mock("../../utils/cabinetAuth", () => ({
  fetchVariantBoard: vi.fn(),
  fetchVideoMeetingStatus: vi.fn(),
  postVariantBoardSplit: vi.fn(),
}));

vi.mock("../meetingMaterialCollab", () => ({
  createMeetingMaterialCollab: vi.fn(() => ({ close: vi.fn() })),
}));

describe("VariantBoardSplit helpers", () => {
  it("clamps width", () => {
    expect(clampBoardWidth(100, 1400)).toBe(VB_MIN);
    expect(clampBoardWidth(5000, 1400)).toBe(1040);
    expect(clampBoardWidth(600, 1400)).toBe(600);
    expect(clampBoardWidth(null, 1000)).toBe(450);
  });
  it("builds request by priority, never with a board id", () => {
    expect(variantBoardRequest({ meetingUuid: "m", liveSessionId: "s", homeworkId: 3 })).toEqual({ meeting: "m" });
    expect(variantBoardRequest({ liveSessionId: "s", homeworkId: 3 })).toEqual({ live_session: "s" });
    expect(variantBoardRequest({ homeworkId: 3 })).toEqual({ homework_id: 3 });
    expect(variantBoardRequest({})).toBeNull();
  });
  it("embeds board in variant mode", () => {
    expect(variantBoardFrameSrc("a b")).toBe("/cabinet/boards/a%20b?embed=variant");
    expect(isVariantEmbed("?embed=variant")).toBe(true);
    expect(isVariantEmbed("?embed=other")).toBe(false);
    expect(isVariantEmbed("")).toBe(false);
  });
});

import { variantBoardPickBody } from "./VariantBoardSplit";
describe("r148 pick body", () => {
  it("only group/mine/student_id, never a board id", () => {
    expect(variantBoardPickBody({ meeting: "m" }, "group")).toEqual({ meeting: "m", target: "group" });
    expect(variantBoardPickBody({ meeting: "m" }, "mine")).toEqual({ meeting: "m", target: "mine" });
    expect(variantBoardPickBody({ meeting: "m" }, 5)).toEqual({ meeting: "m", student_id: 5 });
    expect(variantBoardPickBody({ meeting: "m" }, null)).toEqual({ meeting: "m" });
  });
});

describe("board split sync", () => {
  it("sends open and target, never a board id", () => {
    expect(boardSplitSyncBody(true, "group")).toEqual({ open: true, target: "group" });
    expect(boardSplitSyncBody(true, 5)).toEqual({ open: true, studentId: 5 });
    expect(boardSplitSyncBody(false, 5)).toEqual({ open: false });
    expect(JSON.stringify(boardSplitSyncBody(true, 5))).not.toMatch(/board/i);
    expect(visibleStudentSplit({ boardSplit: { open: true, boardId: "b1", kind: "group" } })).toEqual({
      open: true, kind: "group", boardId: "b1", studentId: null,
    });
    expect(visibleStudentSplit({ boardSplit: { open: true } })).toBeNull();
    expect(visibleStudentSplit({ boardSplit: { open: false, boardId: "b1" } })).toBeNull();
    expect(studentSplitStamp({ presentedAt: "t", boardSplit: { open: true, boardId: "b" } })).toContain("t");
  });
});

function presentedSplit(at, open, boardId = "board-1") {
  return {
    kind: "variant",
    presentedAt: at,
    boardSplit: open ? { open: true, kind: "student", boardId, studentId: 7 } : { open: false },
  };
}

describe("student split follows the teacher", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens and closes from presented.boardSplit", () => {
    const view = render(
      <VariantBoardSplit meetingUuid="meet-1" readOnly presented={presentedSplit("t1", true)} />,
    );
    const frame = screen.getByTestId("variant-board-frame");
    expect(frame.getAttribute("src")).toBe("/cabinet/boards/board-1?embed=variant");
    expect(screen.getByTestId("variant-board-panel")).toBeTruthy();
    expect(screen.queryByTestId("variant-board-toggle")).toBeNull();
    expect(screen.queryByTestId("variant-board-student")).toBeNull();

    view.rerender(<VariantBoardSplit meetingUuid="meet-1" readOnly presented={presentedSplit("t2", false)} />);
    expect(screen.queryByTestId("variant-board-panel")).toBeNull();
    expect(screen.queryByTestId("variant-board-frame")).toBeNull();
    expect(screen.queryByTestId("variant-board-show")).toBeNull();
  });

  it("hides a split that has no board id", () => {
    render(
      <VariantBoardSplit
        meetingUuid="meet-1"
        readOnly
        presented={{ presentedAt: "t", boardSplit: { open: true, kind: "student" } }}
      />,
    );
    expect(screen.queryByTestId("variant-board-panel")).toBeNull();
  });

  it("lets the student collapse locally until the teacher acts again", () => {
    const view = render(
      <VariantBoardSplit meetingUuid="meet-1" readOnly presented={presentedSplit("t1", true)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Скрыть доску" }));
    expect(screen.queryByTestId("variant-board-panel")).toBeNull();
    expect(screen.getByTestId("variant-board-show").textContent).toContain("Показать доску");

    view.rerender(<VariantBoardSplit meetingUuid="meet-1" readOnly presented={presentedSplit("t1", true)} />);
    expect(screen.getByTestId("variant-board-show")).toBeTruthy();

    fireEvent.click(screen.getByTestId("variant-board-show"));
    expect(screen.getByTestId("variant-board-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть доску" }));
    view.rerender(<VariantBoardSplit meetingUuid="meet-1" readOnly presented={presentedSplit("t2", true, "board-2")} />);
    expect(screen.getByTestId("variant-board-frame").getAttribute("src")).toBe("/cabinet/boards/board-2?embed=variant");
    expect(screen.queryByTestId("variant-board-show")).toBeNull();
  });
});

describe("teacher split posts the choice", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("posts open and close without a board id", async () => {
    fetchVariantBoard.mockResolvedValue({
      boardId: "server-board",
      kind: "student",
      studentId: 7,
      studentName: "Аня",
      title: "Доска Ани",
    });
    postVariantBoardSplit.mockResolvedValue({ success: true });
    render(<VariantBoardSplit meetingUuid="meet-1" />);
    fireEvent.click(screen.getByTestId("variant-board-toggle"));
    await waitFor(() => {
      expect(postVariantBoardSplit).toHaveBeenCalledWith("meet-1", { open: true, studentId: 7 });
    });
    expect(fetchVariantBoard).toHaveBeenCalledWith({ meeting: "meet-1" });
    const body = JSON.stringify(postVariantBoardSplit.mock.calls.at(-1)[1]);
    expect(body).not.toMatch(/board/i);
    expect(screen.getByTestId("variant-board-frame").getAttribute("src")).toBe(
      "/cabinet/boards/server-board?embed=variant",
    );

    fireEvent.click(screen.getByRole("button", { name: "Закрыть доску" }));
    await waitFor(() => {
      expect(postVariantBoardSplit).toHaveBeenCalledWith("meet-1", { open: false });
    });
    expect(screen.queryByTestId("variant-board-panel")).toBeNull();
  });

  it("does not sync while the teacher still has to pick a student", async () => {
    const err = new Error("Выберите ученика.");
    err.status = 409;
    err.data = { students: [{ id: 1, name: "Аня" }, { id: 2, name: "Боря" }], code: "choose_student" };
    fetchVariantBoard.mockRejectedValue(err);
    render(<VariantBoardSplit meetingUuid="meet-1" />);
    fireEvent.click(screen.getByTestId("variant-board-toggle"));
    expect(await screen.findByTestId("variant-board-pick")).toBeTruthy();
    expect(postVariantBoardSplit).not.toHaveBeenCalled();
  });
});
