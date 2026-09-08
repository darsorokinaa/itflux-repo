import { describe, expect, it, vi } from "vitest";

import {
  GEOMETRY_MESSAGE_TYPE,
  GEOMETRY_SOURCE,
  geometryBelongsToSession,
  isTrustedJitsiGeometryEvent,
  mapIframeRectToParent,
  normalizeJitsiOrigin,
  parentRectsFromGeometryPayload,
} from "./jitsiGeometry";

describe("jitsi geometry bridge", () => {
  it("maps iframe-local rects into the parent client space", () => {
    const parent = mapIframeRectToParent(
      { left: 100, top: 40, width: 800, height: 600 },
      { left: 80, top: 60, width: 640, height: 360 },
      { width: 800, height: 600 },
    );
    expect(parent).toEqual({ left: 180, top: 100, width: 640, height: 360 });
  });

  it("applies iframe CSS scale using posted viewport size", () => {
    const parent = mapIframeRectToParent(
      { left: 0, top: 0, width: 400, height: 300 },
      { left: 80, top: 60, width: 640, height: 360 },
      { width: 800, height: 600 },
    );
    expect(parent.left).toBeCloseTo(40);
    expect(parent.top).toBeCloseTo(30);
    expect(parent.width).toBeCloseTo(320);
    expect(parent.height).toBeCloseTo(180);
  });

  it("rejects untrusted origins and non-geometry messages", () => {
    const iframe = { contentWindow: {} };
    const good = {
      origin: "https://lesson.itflux-academy.ru",
      source: iframe.contentWindow,
      data: { type: GEOMETRY_MESSAGE_TYPE, source: GEOMETRY_SOURCE, present: true },
    };
    expect(isTrustedJitsiGeometryEvent(good, {
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      iframe,
    })).toBe(true);
    expect(isTrustedJitsiGeometryEvent({ ...good, origin: "https://evil.example" }, {
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      iframe,
    })).toBe(false);
    expect(isTrustedJitsiGeometryEvent({ ...good, data: { type: "other" } }, {
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      iframe,
    })).toBe(false);
  });

  it("ignores late geometry from a previous share session or epoch", () => {
    expect(geometryBelongsToSession(
      { shareSessionId: "a", epoch: 1, participantId: "p1" },
      { shareSessionId: "b", epoch: 2, presenterJitsiId: "p2" },
    )).toBe(false);
    expect(geometryBelongsToSession(
      { shareSessionId: "b", epoch: 2, participantId: "p2" },
      { shareSessionId: "b", epoch: 2, presenterJitsiId: "p2" },
    )).toBe(true);
  });

  it("does not invent a 128px filmstrip offset when mapping", () => {
    const mapped = parentRectsFromGeometryPayload({
      iframeViewportWidth: 1000,
      iframeViewportHeight: 800,
      videoElementRect: { left: 0, top: 0, width: 872, height: 800 },
      contentRect: { left: 0, top: 118.75, width: 872, height: 490.5 },
    }, { left: 12, top: 8, width: 1000, height: 800 });
    expect(mapped.content.left).toBeCloseTo(12);
    expect(mapped.content.left).not.toBe(12 + 128);
    expect(mapped.content.top).toBeCloseTo(8 + 118.75);
  });

  it("normalizes a bare Jitsi domain to https origin", () => {
    expect(normalizeJitsiOrigin("lesson.itflux-academy.ru")).toBe("https://lesson.itflux-academy.ru");
  });

  it("ignores a geometry event from a different window than the Jitsi iframe", () => {
    const iframe = { contentWindow: {} };
    const event = {
      origin: "https://lesson.itflux-academy.ru",
      source: {},
      data: { type: GEOMETRY_MESSAGE_TYPE, source: GEOMETRY_SOURCE, present: true },
    };
    expect(isTrustedJitsiGeometryEvent(event, {
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      iframe,
    })).toBe(false);
  });
});

describe("geometry request isolation", () => {
  it("does not treat a previous epoch as current", () => {
    const spy = vi.fn();
    void spy;
    expect(geometryBelongsToSession({ epoch: 3 }, { epoch: 4 })).toBe(false);
  });
});
