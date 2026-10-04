import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindBoardDocumentTelemetry,
  boardSyncStatusName,
  nextCanvasGeometry,
} from "./boardDocumentTelemetry";

describe("bindBoardDocumentTelemetry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports mount, pagehide, beforeunload, pageshow and visibility from the board document", () => {
    const report = vi.fn();
    const stop = bindBoardDocumentTelemetry("fac021", { report });
    expect(report).toHaveBeenCalledWith("board_document_mount", expect.objectContaining({
      board_id: "fac021",
      visibilityState: "visible",
    }));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    window.dispatchEvent(new Event("pageshow"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(report).toHaveBeenCalledWith("board_document_pagehide", expect.objectContaining({
      board_id: "fac021",
    }));
    expect(report).toHaveBeenCalledWith("board_document_unload", expect.objectContaining({
      board_id: "fac021",
    }));
    expect(report).toHaveBeenCalledWith("board_document_pageshow", expect.objectContaining({
      board_id: "fac021",
    }));
    expect(report).toHaveBeenCalledWith("board_document_visibility", expect.objectContaining({
      board_id: "fac021",
      visibilityState: "hidden",
    }));
    const before = report.mock.calls.length;
    stop();
    window.dispatchEvent(new Event("pagehide"));
    expect(report.mock.calls.length).toBe(before);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
});

describe("board sync and canvas geometry", () => {
  it("maps tldraw statuses and ignores an unchanged canvas size", () => {
    expect(boardSyncStatusName("loading")).toBe("loading");
    expect(boardSyncStatusName("synced-remote")).toBe("synced");
    expect(boardSyncStatusName("synced-local")).toBe("synced");
    expect(boardSyncStatusName("error")).toBe("error");
    expect(nextCanvasGeometry(null, 10.2, 20.8)).toEqual({ width: 10, height: 21 });
    expect(nextCanvasGeometry({ width: 10, height: 21 }, 10, 21)).toBeNull();
    expect(nextCanvasGeometry({ width: 10, height: 21 }, 0, 0)).toEqual({ width: 0, height: 0 });
  });
});
