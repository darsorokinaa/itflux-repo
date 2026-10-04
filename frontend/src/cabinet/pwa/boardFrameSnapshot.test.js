import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_IFRAME_HEALTH_MS,
  readBoardFrameSnapshot,
  startBoardIframeHealth,
} from "./boardFrameSnapshot";

function mountBoardFrame({
  src = "/cabinet/boards/fac021?lesson_title=Анна",
  display = "block",
  visibility = "visible",
  width = 800,
  height = 600,
} = {}) {
  const workspace = document.createElement("section");
  workspace.className = "video-lesson-workspace is-open";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("src", src);
  iframe.setAttribute("data-board-id", "fac021");
  iframe.setAttribute("data-frame-key", "board:fac021:0");
  iframe.style.display = display;
  iframe.style.visibility = visibility;
  workspace.style.display = display;
  workspace.style.visibility = visibility;
  workspace.appendChild(iframe);
  document.body.appendChild(workspace);
  const rect = (w, h) => () => ({
    width: w,
    height: h,
    top: 0,
    left: 0,
    right: w,
    bottom: h,
    x: 0,
    y: 0,
    toJSON() { return {}; },
  });
  iframe.getBoundingClientRect = rect(width, height);
  workspace.getBoundingClientRect = rect(width, height);
  return { workspace, iframe };
}

describe("readBoardFrameSnapshot", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the board iframe from the DOM, including a hidden zero-size frame", () => {
    mountBoardFrame({
      display: "none",
      visibility: "hidden",
      width: 0,
      height: 0,
    });
    const snapshot = readBoardFrameSnapshot(document, "visibilitychange");
    expect(snapshot).toEqual(expect.objectContaining({
      event: "visibilitychange",
      board_id: "fac021",
      frame_key: "board:fac021:0",
      iframe_isConnected: true,
      iframe_src: "/cabinet/boards/fac021",
      iframe_rect_width: 0,
      iframe_rect_height: 0,
      iframe_display: "none",
      iframe_visibility: "hidden",
      workspace_display: "none",
      workspace_visibility: "hidden",
      workspace_width: 0,
      workspace_height: 0,
    }));
    expect(snapshot.iframe_src).not.toContain("lesson_title");
  });

  it("samples board_iframe_health on an interval while the frame stays connected", () => {
    vi.useFakeTimers();
    mountBoardFrame();
    const report = vi.fn();
    const stop = startBoardIframeHealth({ report, intervalMs: BOARD_IFRAME_HEALTH_MS });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe("board_iframe_health");
    expect(report.mock.calls[0][1]).toEqual(expect.objectContaining({
      board_id: "fac021",
      frame_key: "board:fac021:0",
      iframe_isConnected: true,
      iframe_src: "/cabinet/boards/fac021",
      iframe_rect_width: 800,
      iframe_rect_height: 600,
      document_visibilityState: "visible",
    }));
    vi.advanceTimersByTime(BOARD_IFRAME_HEALTH_MS);
    expect(report).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(BOARD_IFRAME_HEALTH_MS);
    expect(report).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
