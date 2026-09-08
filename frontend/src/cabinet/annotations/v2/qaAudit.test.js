/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

import {
  clampCoordinates,
  computeContentRect,
  normalizeShapePoints,
  normalizedToClient,
  pointerToNormalized,
  sanitizeNormalizedPoint,
} from "./coordinateMapper";
import { continueStrokeSegment } from "./smoothStroke";
import { createAnnotationEngine, hitTest } from "./engine";
import { createStrokeStore } from "./strokeStore";
import { createPointerMachine } from "./pointerMachine";
import {
  operationBelongsToSession,
  shouldHydrateEngineSnapshot,
} from "./sessionFilter";
import {
  OBJECT_FIT,
  computeScreenShareContentRect,
  getFittedContentRect,
} from "../../screenshare/contentRect";
import { TOOLS } from "../../screenshare/constants";
import { resolvePresenterOverlayPlan, OVERLAY_MODES } from "./overlays/presenterAdapter";

function ptr(type, clientX, clientY, extra = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: extra.pointerType || "mouse",
    isPrimary: extra.isPrimary !== false,
    button: type === "pointerdown" ? 0 : 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX,
    clientY,
    pressure: 0.5,
    ...extra,
  });
}

function setupEngine(layout = { left: 100, top: 100, width: 400, height: 225 }) {
  const host = document.createElement("canvas");
  document.body.appendChild(host);
  const sent = [];
  const engine = createAnnotationEngine({
    authorId: 7,
    sessionId: "sess-a",
    canAnnotate: true,
    onSend: (action, payload) => sent.push({ action, payload }),
  });
  engine.attachHost(host);
  engine.setLayout({ content: layout });
  engine.setCanAnnotate(true);
  engine.setDrawingEnabled(true);
  engine.setTool(TOOLS.PEN);
  return { engine, host, sent, layout };
}

describe("QA: contain rect and coordinate conversion", () => {
  it("letterboxes 1920×1080 inside 1000×800 exactly", () => {
    const box = getFittedContentRect(
      { left: 0, top: 0, width: 1000, height: 800 },
      1920,
      1080,
      OBJECT_FIT.CONTAIN,
    );
    expect(box.width).toBeCloseTo(1000);
    expect(box.height).toBeCloseTo(562.5);
    expect(box.offsetX).toBeCloseTo(0);
    expect(box.offsetY).toBeCloseTo(118.75);
    expect(pointerToNormalized(10, 10, box)).toBeNull();
    expect(pointerToNormalized(500, 118.75 + 281.25, box).x).toBeCloseTo(0.5, 5);
  });

  it("does not treat unknown source as filling the stage", () => {
    const unknown = getFittedContentRect(
      { left: 0, top: 0, width: 1000, height: 800 },
      0,
      0,
      OBJECT_FIT.CONTAIN,
    );
    expect(unknown.sourceUnknown).toBe(true);
    expect(unknown.height).toBeCloseTo(562.5);
    expect(unknown.offsetY).toBeCloseTo(118.75);
    expect(unknown.height).toBeLessThan(800);
  });

  it("maps the same normalized point across two viewports", () => {
    const teacher = computeContentRect({
      container: { left: 0, top: 0, width: 1920, height: 1080 },
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    const student = computeContentRect({
      container: { left: 40, top: 80, width: 1000, height: 800 },
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    const nx = 0.41;
    const ny = 0.32;
    const a = normalizedToClient(nx, ny, teacher);
    const b = normalizedToClient(nx, ny, student);
    expect(pointerToNormalized(a.x, a.y, teacher).x).toBeCloseTo(nx, 6);
    expect(pointerToNormalized(b.x, b.y, student).y).toBeCloseTo(ny, 6);
  });

  it("rejects letterbox clicks after chrome insets", () => {
    const layout = computeScreenShareContentRect({
      hostRect: { left: 0, top: 0, width: 1000, height: 800 },
      contentWidth: 1920,
      contentHeight: 1080,
    });
    expect(layout.content.height).toBeLessThan(layout.stage.height);
    const letterboxY = layout.stage.top + 2;
    expect(pointerToNormalized(layout.content.left + 10, letterboxY, layout.content)).toBeNull();
  });
});

describe("QA: clamp / invalid coordinates", () => {
  it("rejects NaN and Infinity instead of mapping them to 0,0", () => {
    expect(sanitizeNormalizedPoint({ x: Number.NaN, y: 0.5 })).toBeNull();
    expect(sanitizeNormalizedPoint({ x: 0.2, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(clampCoordinates(undefined, 0.1)).toBeNull();
    expect(clampCoordinates(0.2, 0.3)).toEqual({ x: 0.2, y: 0.3 });
  });

  it("clamps a tiny overshoot to the edge", () => {
    expect(sanitizeNormalizedPoint({ x: 1.01, y: -0.01 })).toEqual({ x: 1, y: 0 });
  });
});

describe("QA: shapes", () => {
  it("normalizes negative rect width/height without swapping arrow ends", () => {
    const rect = normalizeShapePoints("rect", [
      { x: 0.4, y: 0.5 },
      { x: 0.1, y: 0.2 },
    ]);
    expect(rect[0].x).toBeCloseTo(0.1);
    expect(rect[0].y).toBeCloseTo(0.2);
    expect(rect[1].x).toBeCloseTo(0.4);
    expect(rect[1].y).toBeCloseTo(0.5);
    const arrow = normalizeShapePoints("arrow", [
      { x: 0.4, y: 0.5 },
      { x: 0.1, y: 0.2 },
    ]);
    expect(arrow[0].x).toBeCloseTo(0.4);
    expect(arrow[1].x).toBeCloseTo(0.1);
  });
});

describe("QA: eraser hit area", () => {
  const rect = {
    id: "box",
    tool: "rect",
    points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
  };

  it("does not delete a rect from a click in its interior", () => {
    expect(hitTest(rect, 0.5, 0.5, 0.012, { interior: false })).toBe(false);
  });

  it("hits a rect near its edge", () => {
    expect(hitTest(rect, 0.2, 0.5, 0.012, { interior: false })).toBe(true);
  });

  it("lets select use the interior", () => {
    expect(hitTest(rect, 0.5, 0.5, 0.02, { interior: true })).toBe(true);
  });
});

describe("QA: stroke lifecycle and stray lines", () => {
  it("does not densify across a content-rect gap", () => {
    const added = continueStrokeSegment(
      { x: 0.05, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { gap: true },
    );
    expect(added).toHaveLength(1);
    expect(added[0].gap).toBe(true);
    expect(added[0].x).toBeCloseTo(0.95);
  });

  it("still densifies a fast in-content jump", () => {
    const added = continueStrokeSegment({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }, { gap: false });
    expect(added.length).toBeGreaterThan(2);
  });

  it("click without move does not create a line from 0,0", () => {
    const { engine, host, layout } = setupEngine();
    const x = layout.left + layout.width * 0.5;
    const y = layout.top + layout.height * 0.5;
    host.dispatchEvent(ptr("pointerdown", x, y));
    host.dispatchEvent(ptr("pointerup", x, y));
    const stroke = engine.list()[0];
    expect(stroke).toBeTruthy();
    expect(stroke.points.every((p) => p.x > 0.4 && p.x < 0.6)).toBe(true);
    expect(stroke.points.some((p) => p.x === 0 && p.y === 0)).toBe(false);
    engine.dispose();
    host.remove();
  });

  it("starts a new stroke without joining the previous one", () => {
    const { engine, host, layout } = setupEngine();
    const x1 = layout.left + 10;
    const y1 = layout.top + 10;
    const x2 = layout.left + layout.width - 10;
    const y2 = layout.top + layout.height - 10;
    host.dispatchEvent(ptr("pointerdown", x1, y1));
    host.dispatchEvent(ptr("pointermove", x1 + 8, y1 + 4));
    host.dispatchEvent(ptr("pointerup", x1 + 8, y1 + 4, { buttons: 0 }));
    host.dispatchEvent(ptr("pointerdown", x2, y2));
    host.dispatchEvent(ptr("pointermove", x2 - 6, y2 - 4));
    host.dispatchEvent(ptr("pointerup", x2 - 6, y2 - 4, { buttons: 0 }));
    expect(engine.list()).toHaveLength(2);
    const a = engine.list()[0].points;
    const b = engine.list()[1].points;
    expect(Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y)).toBeGreaterThan(0.5);
    engine.dispose();
    host.remove();
  });

  it("does not draw a letterbox diagonal after leaving and re-entering", () => {
    const { engine, host, layout } = setupEngine();
    const insideA = { x: layout.left + 20, y: layout.top + 20 };
    const outside = { x: layout.left - 40, y: layout.top + 20 };
    const insideB = { x: layout.left + layout.width - 20, y: layout.top + layout.height - 20 };
    host.dispatchEvent(ptr("pointerdown", insideA.x, insideA.y));
    host.dispatchEvent(ptr("pointermove", insideA.x + 6, insideA.y + 4));
    host.dispatchEvent(ptr("pointermove", outside.x, outside.y));
    host.dispatchEvent(ptr("pointermove", insideB.x, insideB.y));
    host.dispatchEvent(ptr("pointerup", insideB.x, insideB.y, { buttons: 0 }));
    const pts = engine.list()[0].points;
    const bridged = pts.some((p, i) => i > 0 && !p.gap && Math.abs(p.x - pts[i - 1].x) > 0.4);
    expect(bridged).toBe(false);
    engine.dispose();
    host.remove();
  });

  it("pointercancel clears drawing state so the next move is not a stroke", () => {
    const { engine, host, layout } = setupEngine();
    host.dispatchEvent(ptr("pointerdown", layout.left + 20, layout.top + 20));
    host.dispatchEvent(ptr("pointercancel", layout.left + 20, layout.top + 20));
    expect(engine.list()).toHaveLength(0);
    host.dispatchEvent(ptr("pointermove", layout.left + 80, layout.top + 80));
    expect(engine.list()).toHaveLength(0);
    engine.dispose();
    host.remove();
  });

  it("ignores a second pointer id while the first is drawing", () => {
    const onPoint = vi.fn();
    const machine = createPointerMachine({ onPoint, onStart: vi.fn(), onEnd: vi.fn() });
    machine.pointerdown({ pointerId: 1, isPrimary: true, pointerType: "pen", button: 0, buttons: 1, currentTarget: { setPointerCapture: vi.fn() } }, { x: 0.2, y: 0.2 }, { strokeId: "s1" });
    machine.pointermove({ pointerId: 99, buttons: 1 }, { x: 0.9, y: 0.9 });
    expect(onPoint).not.toHaveBeenCalled();
  });

  it("revoking permission ends the in-progress stroke", () => {
    const { engine, host, layout } = setupEngine();
    host.dispatchEvent(ptr("pointerdown", layout.left + 30, layout.top + 30));
    expect(engine.machine.state).toBe("DRAWING");
    engine.setCanAnnotate(false);
    expect(engine.machine.state).toBe("IDLE");
    host.dispatchEvent(ptr("pointermove", layout.left + 80, layout.top + 80));
    engine.dispose();
    host.remove();
  });
});

describe("QA: remote ordering, duplicates, sessions", () => {
  it("buffers stroke_update that arrives before stroke_start", () => {
    const engine = createAnnotationEngine({ authorId: 2, sessionId: "s1" });
    engine.applyRemote({
      action: "stroke_update",
      session_id: "s1",
      payload: { annotation: { id: "late", points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.25 }] } },
    });
    expect(engine.list()).toHaveLength(0);
    engine.applyRemote({
      action: "stroke_start",
      session_id: "s1",
      payload: { annotation: { id: "late", tool: "pen", points: [{ x: 0.1, y: 0.1 }] } },
    });
    expect(engine.getSessionId()).toBe("s1");
    expect(engine.list()[0].points.length).toBeGreaterThanOrEqual(3);
    engine.dispose();
  });

  it("ignores operations from a previous share session", () => {
    const engine = createAnnotationEngine({ authorId: 2, sessionId: "new" });
    engine.applyRemote({
      action: "object_upsert",
      session_id: "old",
      payload: { annotation: { id: "stale", tool: "pen", points: [{ x: 0.1, y: 0.1 }] } },
    });
    expect(engine.list()).toHaveLength(0);
    engine.dispose();
  });

  it("does not shrink a local stroke when a duplicate start arrives", () => {
    const store = createStrokeStore();
    store.start({ id: "s1", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }] });
    store.start({ id: "s1", points: [{ x: 0.1, y: 0.1 }] });
    expect(store.get("s1").points).toHaveLength(3);
  });

  it("drops NaN points instead of storing the origin", () => {
    const store = createStrokeStore();
    store.start({ id: "s1", points: [{ x: 0.4, y: 0.4 }] });
    store.appendPoints("s1", [{ x: Number.NaN, y: 0 }, { x: 0.5, y: 0.5 }]);
    expect(store.get("s1").points).toHaveLength(2);
    expect(store.get("s1").points[1]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("filters ops and snapshot hydration by session id", () => {
    expect(operationBelongsToSession({ session_id: "a" }, "a")).toBe(true);
    expect(operationBelongsToSession({ session_id: "a" }, "b")).toBe(false);
    expect(shouldHydrateEngineSnapshot("a", "b")).toBe(false);
    expect(shouldHydrateEngineSnapshot("", "b")).toBe(true);
    expect(shouldHydrateEngineSnapshot("b", "b")).toBe(true);
  });
});

describe("QA: presenter overlay coordinate space", () => {
  it("does not draw browser-tab shares in a separate viewport space", () => {
    const plan = resolvePresenterOverlayPlan({ localSharing: true, displaySurface: "browser" });
    expect(plan.drawingSurface).toBe(OVERLAY_MODES.FALLBACK_WEB);
  });
});
