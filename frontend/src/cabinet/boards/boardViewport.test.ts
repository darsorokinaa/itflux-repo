import { describe, expect, it } from "vitest";
import {
  imageIntersectsViewport,
  imageRectAtViewportCenter,
  isNewerViewport,
  normalizeViewportPayload,
  sceneViewportRect,
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
      centerX: -10,
      centerY: 20,
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

  it("viewportAppStatePatch без размера приёмника копирует scroll", () => {
    const patch = viewportAppStatePatch({
      scrollX: 100,
      scrollY: 200,
      zoom: 1.5,
      centerX: 0,
      centerY: 0,
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

  it("viewportDriftTooFar ловит ручной pan по центру сцены", () => {
    const target = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, width: 400, height: 300, seq: 1 },
      "t",
    )!;
    expect(viewportDriftTooFar({
      scrollX: 0, scrollY: 0, zoom: 1, width: 400, height: 300,
    }, target)).toBe(false);
    expect(viewportDriftTooFar({
      scrollX: 200, scrollY: 0, zoom: 1, width: 400, height: 300,
    }, target)).toBe(true);
    expect(viewportDriftTooFar({
      scrollX: 0, scrollY: 0, zoom: 2, width: 400, height: 300,
    }, target)).toBe(true);
  });

  it("imageRectAtViewportCenter ставит картинку в центр текущего viewport", () => {
    const appState = { scrollX: 40, scrollY: -20, zoom: { value: 2 }, width: 400, height: 200 };
    const vp = sceneViewportRect(appState);
    expect(vp.minX).toBe(-40);
    expect(vp.sceneWidth).toBe(200);
    const rect = imageRectAtViewportCenter(appState, 80, 40);
    expect(rect.width).toBe(80);
    expect(rect.height).toBe(40);
    expect(rect.x).toBe(-40 + (200 - 80) / 2);
    expect(rect.y).toBe(20 + (100 - 40) / 2);
    expect(imageIntersectsViewport({ ...rect }, appState)).toBe(true);
    expect(imageIntersectsViewport({ x: 9000, y: 9000, width: 10, height: 10 }, appState)).toBe(false);
  });

  it("sceneViewportRect берёт fallback, если appState.width=0 после file picker", () => {
    const vp = sceneViewportRect(
      { scrollX: 0, scrollY: 0, zoom: 1, width: 0, height: 0 },
      { width: 320, height: 180 },
    );
    expect(vp.cssWidth).toBe(320);
    expect(vp.cssHeight).toBe(180);
  });
});
