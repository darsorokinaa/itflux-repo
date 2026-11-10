import { describe, expect, it } from "vitest";

import { canAutoReloadBoardTab, isBoardInsideMeetingFrame, isCallSessionPath } from "./boardTabReload";

function frame(path, topPath) {
  const top = { location: { pathname: topPath } };
  const win = { location: { pathname: path }, top };
  if (topPath == null) win.top = win;
  return win;
}

describe("board tab reload", () => {
  it("allows an automatic reload only on a top-level board tab", () => {
    expect(isCallSessionPath("/cabinet/meetings/abc")).toBe(true);
    expect(isCallSessionPath("/lesson/join")).toBe(true);
    expect(isCallSessionPath("/cabinet/boards/b1")).toBe(false);
    expect(canAutoReloadBoardTab(frame("/cabinet/boards/b1", null))).toBe(true);
    expect(canAutoReloadBoardTab(frame("/cabinet", null))).toBe(false);
    expect(canAutoReloadBoardTab(frame("/teacher/boards/b1", null))).toBe(false);
  });

  it("never auto-reloads a board iframe inside a meeting or the join page", () => {
    const meeting = frame("/cabinet/boards/b1", "/cabinet/meetings/abc");
    expect(isBoardInsideMeetingFrame(meeting)).toBe(true);
    expect(canAutoReloadBoardTab(meeting)).toBe(false);
    const join = frame("/cabinet/boards/b1", "/lesson/join");
    expect(isBoardInsideMeetingFrame(join)).toBe(true);
    expect(canAutoReloadBoardTab(join)).toBe(false);
    expect(canAutoReloadBoardTab(frame("/cabinet/meetings/abc", null))).toBe(false);
    expect(canAutoReloadBoardTab(frame("/lesson/join", null))).toBe(false);
  });

  it("treats a cross-origin parent as a meeting frame", () => {
    const win = {
      location: { pathname: "/cabinet/boards/b1" },
      get top() {
        throw new Error("cross-origin");
      },
    };
    expect(isBoardInsideMeetingFrame(win)).toBe(true);
    expect(canAutoReloadBoardTab(win)).toBe(false);
  });
});
