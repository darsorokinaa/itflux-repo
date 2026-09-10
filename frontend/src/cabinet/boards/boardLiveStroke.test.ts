import { describe, expect, it, vi } from "vitest";
import {
  flushScheduledFrame,
  isActiveFreedrawGesture,
  scheduleOncePerFrame,
} from "./boardLiveStroke";

describe("isActiveFreedrawGesture", () => {
  it("is false when no canvas gesture is in progress", () => {
    expect(isActiveFreedrawGesture(false, { activeTool: { type: "freedraw" } })).toBe(false);
  });

  it("is true for freedraw during a pointer gesture", () => {
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "freedraw" } })).toBe(true);
  });

  it("is true when Excalidraw still holds a new freedraw element", () => {
    expect(isActiveFreedrawGesture(true, {
      activeTool: { type: "selection" },
      newElement: { type: "freedraw" },
    })).toBe(true);
  });

  it("does not treat selection, pan, or eraser as live freehand", () => {
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "selection" } })).toBe(false);
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "hand" } })).toBe(false);
    expect(isActiveFreedrawGesture(true, { activeTool: { type: "eraser" } })).toBe(false);
  });
});

describe("scheduleOncePerFrame", () => {
  it("coalesces many calls into one rAF callback", () => {
    let queued: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queued = cb;
      return 7;
    });
    const raf = { current: null as number | null };
    const fn = vi.fn();
    scheduleOncePerFrame(raf, fn);
    scheduleOncePerFrame(raf, fn);
    scheduleOncePerFrame(raf, fn);
    expect(fn).not.toHaveBeenCalled();
    queued?.(16);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(raf.current).toBeNull();
    vi.unstubAllGlobals();
  });

  it("flushScheduledFrame runs immediately and cancels the pending frame", () => {
    let cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      void cb;
      return 9;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      cancelled += 1;
    });
    const raf = { current: null as number | null };
    const fn = vi.fn();
    scheduleOncePerFrame(raf, fn);
    flushScheduledFrame(raf, fn);
    expect(cancelled).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(raf.current).toBeNull();
    vi.unstubAllGlobals();
  });
});
