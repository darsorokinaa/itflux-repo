/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportClientEvent } from "../../utils/clientTelemetry";
import LessonBoardWorkspaceFrame from "./lessonBoardWorkspaceFrame";
import {
  RESUME_TIMING,
  createPwaResumeController,
  shouldRemountBoardWorkspace,
} from "./pwaResumeLifecycle";

vi.mock("../../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

function setVisibility(value) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function BoardFrameHarness({ nowRef, onResume, remount }) {
  const [frameKey, setFrameKey] = useState(0);
  const material = useMemo(() => ({
    kind: "board",
    boardId: "board-1",
    url: "/cabinet/boards/board-1",
    title: "Доска",
  }), []);

  useEffect(() => {
    const ctl = createPwaResumeController({
      now: () => nowRef.current,
      onResume: () => {
        onResume();
        if (remount === "always") {
          setFrameKey((value) => value + 1);
          return;
        }
        const frame = document.querySelector("iframe.video-lesson-workspace__frame--board");
        if (shouldRemountBoardWorkspace({ frameConnected: Boolean(frame?.isConnected) })) {
          setFrameKey((value) => value + 1);
        }
      },
    });
    return () => ctl.detach();
  }, [nowRef, onResume, remount]);

  return (
    <LessonBoardWorkspaceFrame
      material={material}
      frameKey={frameKey}
      src="/cabinet/boards/board-1"
    />
  );
}

function boardFrame() {
  return document.querySelector("iframe.video-lesson-workspace__frame--board");
}

describe("board iframe resume", () => {
  let nowRef;

  beforeEach(() => {
    nowRef = { current: 1_000_000 };
    reportClientEvent.mockClear();
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    setVisibility("visible");
  });

  it("does not remount the board iframe when focus fires while visibility is hidden", async () => {
    const onResume = vi.fn();
    render(
      <BoardFrameHarness nowRef={nowRef} onResume={onResume} remount="always" />,
    );
    const before = boardFrame();
    expect(before).toBeTruthy();
    expect(before.dataset.frameKey).toBe("board:board-1:0");

    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    nowRef.current += RESUME_TIMING.MIN_BACKGROUND_MS + 50;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const after = boardFrame();
    expect(after).toBe(before);
    expect(after.isConnected).toBe(true);
    expect(after.dataset.frameKey).toBe("board:board-1:0");
    expect(onResume).not.toHaveBeenCalled();
    expect(reportClientEvent).not.toHaveBeenCalledWith("PWA_FOREGROUND", expect.anything());
    expect(reportClientEvent).not.toHaveBeenCalledWith("RESUME_START", expect.anything());
    expect(reportClientEvent).not.toHaveBeenCalledWith("board_iframe_unmount", expect.anything());
    expect(reportClientEvent).not.toHaveBeenCalledWith("board_iframe_key_change", expect.anything());
    expect(reportClientEvent).toHaveBeenCalledWith(
      "board_iframe_lifecycle",
      expect.objectContaining({
        event: "focus",
        document_visibilityState: "hidden",
        board_id: "board-1",
        frame_key: "board:board-1:0",
        iframe_isConnected: true,
        iframe_src: "/cabinet/boards/board-1",
      }),
    );
  });

  it("keeps the same board iframe across pagehide, hidden, and visible", async () => {
    const onResume = vi.fn();
    render(
      <BoardFrameHarness nowRef={nowRef} onResume={onResume} remount="if-detached" />,
    );
    const before = boardFrame();
    expect(before).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    nowRef.current += RESUME_TIMING.MIN_BACKGROUND_MS + 50;
    expect(onResume).not.toHaveBeenCalled();
    expect(boardFrame()).toBe(before);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const after = boardFrame();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(after).toBe(before);
    expect(after.isConnected).toBe(true);
    expect(after.dataset.frameKey).toBe(before.dataset.frameKey);
    expect(after.getAttribute("src")).toBe("/cabinet/boards/board-1");
    expect(reportClientEvent).not.toHaveBeenCalledWith("board_iframe_unmount", expect.anything());
    expect(reportClientEvent).not.toHaveBeenCalledWith("board_iframe_key_change", expect.anything());
  });

  it("logs resize when the board iframe geometry changes and skips a repeat", async () => {
    const onResume = vi.fn();
    render(
      <BoardFrameHarness nowRef={nowRef} onResume={onResume} remount="always" />,
    );
    const frame = boardFrame();
    const box = (width, height) => () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() { return {}; },
    });
    frame.getBoundingClientRect = box(320, 480);
    reportClientEvent.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });
    const resizeCalls = () => reportClientEvent.mock.calls.filter(
      (call) => call[0] === "board_iframe_lifecycle" && call[1]?.event === "resize",
    );
    expect(resizeCalls()).toHaveLength(1);
    expect(resizeCalls()[0][1]).toEqual(expect.objectContaining({
      iframe_isConnected: true,
      iframe_rect_width: 320,
      iframe_rect_height: 480,
      frame_key: "board:board-1:0",
    }));
    frame.getBoundingClientRect = box(0, 0);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(resizeCalls()).toHaveLength(2);
    expect(resizeCalls()[1][1].iframe_rect_width).toBe(0);
    expect(resizeCalls()[1][1].iframe_rect_height).toBe(0);
    expect(onResume).not.toHaveBeenCalled();
    expect(boardFrame()).toBe(frame);
  });
});
