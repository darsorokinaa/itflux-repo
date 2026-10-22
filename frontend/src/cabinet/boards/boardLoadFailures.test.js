/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_FAILURE_MAX_PER_MINUTE,
  bindBoardLoadFailures,
  navigationInfo,
  reportBoardAssetFailure,
  resetBoardFailureBudget,
  safeAssetUrl,
} from "./boardLoadFailures";
import { bindBoardDocumentTelemetry } from "./boardDocumentTelemetry";
import { CLIENT_TELEMETRY_EVENTS } from "../../utils/clientTelemetry";

afterEach(() => resetBoardFailureBudget());

function rejection(reason) {
  const event = new Event("unhandledrejection");
  event.reason = reason;
  return event;
}

describe("safeAssetUrl", () => {
  it("drops query and hash, keeps same-origin path", () => {
    expect(safeAssetUrl(`${window.location.origin}/api/cabinet/interactive-boards/b/assets/a/?token=secret#x`))
      .toBe("/api/cabinet/interactive-boards/b/assets/a/");
  });
  it("collapses data and blob urls", () => {
    expect(safeAssetUrl("data:image/png;base64,AAAA")).toBe("data:image/png");
    expect(safeAssetUrl("blob:http://x/123")).toBe("blob:");
  });
  it("keeps origin for foreign urls", () => {
    expect(safeAssetUrl("https://cdn.example.com/a.png?sig=1")).toBe("https://cdn.example.com/a.png");
  });
});

describe("bindBoardLoadFailures", () => {
  it("reports an unhandled rejection and flags fatal before ready", () => {
    const send = vi.fn(() => true);
    const onFatal = vi.fn();
    const stop = bindBoardLoadFailures("board-1", { send, isReady: () => false, onFatal, fetchImpl: null });
    window.dispatchEvent(rejection(new Error("boom")));
    expect(send).toHaveBeenCalledWith("board_unhandled_rejection", expect.objectContaining({ board_id: "board-1", message: "boom", ready: false }));
    expect(onFatal).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(rejection(new Error("after")));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not flag fatal once the board is ready", () => {
    const send = vi.fn(() => true);
    const onFatal = vi.fn();
    const stop = bindBoardLoadFailures("b", { send, isReady: () => true, onFatal });
    window.dispatchEvent(rejection("x"));
    expect(onFatal).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1].ready).toBe(true);
    stop();
  });

  it("reports a failed image once with the probed status", async () => {
    const send = vi.fn(() => true);
    const fetchImpl = vi.fn(async () => ({ status: 404 }));
    const stop = bindBoardLoadFailures("b", { send, fetchImpl });
    const img = document.createElement("img");
    img.src = "/api/cabinet/interactive-boards/b/assets/a/?t=1";
    document.body.appendChild(img);
    img.dispatchEvent(new Event("error"));
    img.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith("board_asset_load_failed", expect.objectContaining({
      url: "/api/cabinet/interactive-boards/b/assets/a/", status: 404, tag: "img",
    }));
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    stop();
    img.remove();
  });

  it("caps board events per minute", () => {
    const send = vi.fn(() => true);
    for (let i = 0; i < BOARD_FAILURE_MAX_PER_MINUTE + 5; i += 1) {
      reportBoardAssetFailure("b", `/a/${i}`, 500, send);
    }
    expect(send).toHaveBeenCalledTimes(BOARD_FAILURE_MAX_PER_MINUTE);
  });
});

describe("navigation telemetry", () => {
  it("reads the navigation entry type", () => {
    const win = { performance: { getEntriesByType: () => [{ type: "reload" }] } };
    expect(navigationInfo(win)).toEqual({ nav_type: "reload" });
    expect(navigationInfo({ performance: { navigation: { type: 2 } } })).toEqual({ nav_type: "back_forward" });
  });

  it("sends nav_type on mount and persisted on pageshow", () => {
    const report = vi.fn();
    const stop = bindBoardDocumentTelemetry("b", { report });
    expect(report.mock.calls[0][0]).toBe("board_document_mount");
    expect(report.mock.calls[0][1]).toHaveProperty("nav_type");
    const ev = new Event("pageshow");
    ev.persisted = true;
    window.dispatchEvent(ev);
    const show = report.mock.calls.find((c) => c[0] === "board_document_pageshow");
    expect(show[1]).toMatchObject({ persisted: true, board_id: "b" });
    stop();
  });

  it("new events are allowed by client telemetry", () => {
    for (const e of ["board_unhandled_rejection", "board_asset_load_failed", "board_retry_click"]) {
      expect(CLIENT_TELEMETRY_EVENTS).toContain(e);
    }
  });
});
