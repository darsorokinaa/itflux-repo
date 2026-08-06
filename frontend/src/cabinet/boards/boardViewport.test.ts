import { describe, expect, it } from "vitest";
import {
  isNewerViewport,
  normalizeViewportPayload,
  viewportAppStatePatch,
  viewportDriftTooFar,
  zoomValueOf,
} from "./boardViewport";

describe("boardViewport", () => {
  it("zoomValueOf читает number и { value }", () => {
    expect(zoomValueOf(1.5)).toBe(1.5);
    expect(zoomValueOf({ value: 2 })).toBe(2);
    expect(zoomValueOf(null)).toBe(1);
  });

  it("normalizeViewportPayload отклоняет битые данные", () => {
    expect(normalizeViewportPayload({ scrollX: 1 }, "c1")).toBeNull();
    const ok = normalizeViewportPayload(
      { scrollX: 10, scrollY: -20, zoom: 1.25, seq: 3 },
      "c1",
      7,
    );
    expect(ok).toMatchObject({
      scrollX: 10,
      scrollY: -20,
      zoom: 1.25,
      seq: 3,
      clientId: "c1",
      userId: 7,
    });
  });

  it("isNewerViewport предпочитает больший seq", () => {
    const a = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, seq: 1 },
      "t",
    )!;
    const b = normalizeViewportPayload(
      { scrollX: 5, scrollY: 5, zoom: 1, seq: 2 },
      "t",
    )!;
    expect(isNewerViewport(a, b)).toBe(true);
    expect(isNewerViewport(b, a)).toBe(false);
  });

  it("viewportAppStatePatch не вызывает scrollToContent", () => {
    const patch = viewportAppStatePatch({
      scrollX: 100,
      scrollY: 200,
      zoom: 1.5,
      seq: 1,
      clientId: "t",
      updatedAt: 1,
    });
    expect(patch).toEqual({
      scrollX: 100,
      scrollY: 200,
      zoom: { value: 1.5 },
    });
  });

  it("viewportDriftTooFar ловит ручной pan", () => {
    const target = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, seq: 1 },
      "t",
    )!;
    expect(viewportDriftTooFar({ scrollX: 10, scrollY: 10, zoom: 1 }, target)).toBe(false);
    expect(viewportDriftTooFar({ scrollX: 200, scrollY: 0, zoom: 1 }, target)).toBe(true);
    expect(viewportDriftTooFar({ scrollX: 0, scrollY: 0, zoom: 2 }, target)).toBe(true);
  });
});
