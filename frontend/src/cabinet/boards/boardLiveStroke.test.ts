import { describe, expect, it, vi } from "vitest";
import {
  flushScheduledFrame,
  isActiveFreedrawGesture,
  isFinishingLiveFreedraw,
  scheduleOncePerFrame,
  versionSumAfterLiveStroke,
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

describe("isFinishingLiveFreedraw", () => {
  it("is true only on the pointerup finalize after a live stroke", () => {
    expect(isFinishingLiveFreedraw(true, true)).toBe(false);
    expect(isFinishingLiveFreedraw(false, true)).toBe(true);
    expect(isFinishingLiveFreedraw(false, false)).toBe(false);
    expect(isFinishingLiveFreedraw(true, false)).toBe(false);
  });
});

describe("versionSumAfterLiveStroke", () => {
  it("adds only the live stroke version without scanning other objects", () => {
    expect(versionSumAfterLiveStroke(3999, { version: 12 })).toBe(4011);
    expect(versionSumAfterLiveStroke(10, null)).toBe(10);
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

describe("live stroke pipeline", () => {
  it("appends in place, paints once per frame, and publishes only the hot stroke", async () => {
    const { appendLiveFreedrawSamples } = await import("./boardPointerInput");
    const { buildLivePublishPayload, replacePublishedElementInPlace } = await import("./boardOps");

    const points = [[0, 0]];
    const el = { id: "stroke", x: 0, y: 0, type: "freedraw", version: 1, points, pressures: [0.4] };
    for (let i = 1; i <= 40; i += 1) {
      appendLiveFreedrawSamples(el, [{ sceneX: i + 0.25, sceneY: i / 3, pressure: 0.5 }]);
    }
    expect(el.points).toBe(points);
    expect(el.points.length).toBe(41);

    let queued: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queued = cb;
      return 3;
    });
    const raf = { current: null as number | null };
    const paint = vi.fn();
    scheduleOncePerFrame(raf, paint);
    scheduleOncePerFrame(raf, paint);
    expect(paint).not.toHaveBeenCalled();
    queued?.(16);
    expect(paint).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();

    const keep = { id: "keep", version: 1, points: [[9, 9]] };
    const prev = [keep, { id: "stroke", version: 1, points: [[0, 0]] }];
    const prevById = new Map<string, unknown>(prev.map((item) => [item.id, item]));
    const built = buildLivePublishPayload(
      prev,
      { elements: prev, appState: {}, files: { img: { dataURL: "https://cdn.example/a.png" } } },
      2,
      el,
      prevById,
    );
    expect(built.kind).toBe("ops");
    if (built.kind !== "ops") return;
    expect(built.payload.ops).toHaveLength(1);
    expect(built.payload.files).toEqual({});
    const published = (built.payload.ops[0] as { element: { points: number[][] } }).element;
    expect(published.points).not.toBe(el.points);
    expect(replacePublishedElementInPlace(prev, published)).toBe(true);
    expect(prev[0]).toBe(keep);
    expect(prev[1]).toBe(published);
  });
});
