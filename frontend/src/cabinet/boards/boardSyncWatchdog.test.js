/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  BOARD_LOADING_STALL_MS,
  BOARD_MAX_AUTO_RECONNECTS,
  boardReconnectDelay,
  canAutoReconnect,
  isBoardSyncPending,
  watchBoardWake,
} from "./boardSyncWatchdog";

describe("boardSyncWatchdog (r124)", () => {
  it("stall threshold is 12s and five backoff retries", () => {
    expect(BOARD_LOADING_STALL_MS).toBe(12_000);
    expect(BOARD_MAX_AUTO_RECONNECTS).toBe(5);
    expect(boardReconnectDelay(0)).toBeLessThan(boardReconnectDelay(4));
    expect(boardReconnectDelay(99)).toBe(boardReconnectDelay(4));
    expect(canAutoReconnect(4)).toBe(true);
    expect(canAutoReconnect(5)).toBe(false);
  });

  it("pending only while loading/error", () => {
    expect(isBoardSyncPending("loading")).toBe(true);
    expect(isBoardSyncPending("error")).toBe(true);
    expect(isBoardSyncPending("synced-remote")).toBe(false);
  });

  it("fires on pageshow, online and visibility", () => {
    const onWake = vi.fn();
    const stop = watchBoardWake({ node: null, onWake });
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onWake).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event("online"));
    expect(onWake).toHaveBeenCalledTimes(3);
  });

  it("fires on the lesson page board-visible message only", () => {
    const onWake = vi.fn();
    const stop = watchBoardWake({ node: null, onWake });
    window.dispatchEvent(new MessageEvent("message", { data: { source: "itflux-lesson-room", type: "board-chrome" } }));
    expect(onWake).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data: { source: "itflux-lesson-room", type: "board-visible" } }));
    expect(onWake).toHaveBeenCalledWith("reshown");
    stop();
  });

  it("fires when the frame comes back from zero size", () => {
    let cb = null;
    const win = {
      document,
      addEventListener() {},
      removeEventListener() {},
      ResizeObserver: class { constructor(fn) { cb = fn; } observe() {} disconnect() {} },
    };
    let size = { width: 0, height: 0 };
    const node = { getBoundingClientRect: () => size };
    const onWake = vi.fn();
    watchBoardWake({ node, onWake, win });
    cb();
    expect(onWake).not.toHaveBeenCalled();
    size = { width: 300, height: 200 };
    cb();
    expect(onWake).toHaveBeenCalledWith("reshown");
  });
});
