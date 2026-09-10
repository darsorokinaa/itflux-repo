import { describe, expect, it, vi } from "vitest";
import {
  MAX_COALESCED_PEN_EXTRAS,
  appendLiveFreedrawSamples,
  coalescedEventsOrFallback,
  coalescedMovesToInject,
  densifyPenGap,
  downsampleEvenly,
  isPointerReplayEvent,
  isReplayingPenPoints,
  mountCoalescedPointerReplay,
  penMovesToInject,
  pinPointerEventToClient,
  createPinnedPointerUp,
  withPenPointReplay,
  readCoalescedPointerEvents,
  readPenPressure,
  shouldReplayCoalescedPointerMove,
  smoothPenPressure,
} from "./boardPointerInput";

describe("boardPointerInput", () => {
  it("falls back to the native event when getCoalescedEvents is missing", () => {
    const native = { clientX: 1, clientY: 2, pressure: 0.4 };
    expect(readCoalescedPointerEvents({})).toBeNull();
    expect(coalescedEventsOrFallback(native)).toEqual([native]);
    expect(coalescedMovesToInject({ clientX: 1, clientY: 2 }, null)).toEqual([]);
  });

  it("uses coalesced intermediates and drops the duplicate last native point", () => {
    const native = { clientX: 10, clientY: 20 };
    const coalesced = [
      { clientX: 1, clientY: 2 },
      { clientX: 4, clientY: 8 },
      { clientX: 10, clientY: 20 },
    ];
    expect(coalescedMovesToInject(native, coalesced)).toEqual([
      { clientX: 1, clientY: 2 },
      { clientX: 4, clientY: 8 },
    ]);
  });

  it("keeps all coalesced points when the last sample differs from native", () => {
    const native = { clientX: 10, clientY: 20 };
    const coalesced = [
      { clientX: 1, clientY: 2 },
      { clientX: 9, clientY: 19 },
    ];
    expect(coalescedMovesToInject(native, coalesced)).toEqual(coalesced);
  });

  it("does not downsample a typical stylus frame", () => {
    const native = { clientX: 20, clientY: 20 };
    const coalesced = Array.from({ length: 16 }, (_, i) => ({ clientX: i, clientY: i }));
    coalesced.push(native);
    const extras = coalescedMovesToInject(native, coalesced);
    expect(extras).toHaveLength(16);
    expect(extras[0]).toEqual({ clientX: 0, clientY: 0 });
    expect(extras[extras.length - 1]).toEqual({ clientX: 15, clientY: 15 });
  });

  it("only caps extras in a pathological flood", () => {
    const native = { clientX: 100, clientY: 100 };
    const coalesced = Array.from({ length: 80 }, (_, i) => ({ clientX: i, clientY: i }));
    coalesced.push(native);
    const extras = coalescedMovesToInject(native, coalesced);
    expect(extras.length).toBeLessThanOrEqual(MAX_COALESCED_PEN_EXTRAS);
    expect(extras[0]).toEqual({ clientX: 0, clientY: 0 });
  });

  it("downsample keeps endpoints", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(downsampleEvenly(items, 3)).toEqual([0, 5, 9]);
  });

  it("does not replay hover or canvas pan (no buttons)", () => {
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 0, pointerType: "pen" })).toBe(false);
  });

  it("replays coalesced extras only for pen, not mouse or touch", () => {
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 0, pointerType: "pen" })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({
      type: "pointermove",
      buttons: 1,
      pointerType: "pen",
      __itfluxCoalescedReplay: true,
    })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({ type: "pointerdown", buttons: 1, pointerType: "pen" })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "pen" })).toBe(true);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "touch" })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "mouse" })).toBe(false);
  });

  it("marks replay so onChange persist can skip synthetic points", () => {
    expect(isReplayingPenPoints()).toBe(false);
    let seen = false;
    withPenPointReplay(() => {
      seen = isReplayingPenPoints();
    });
    expect(seen).toBe(true);
    expect(isReplayingPenPoints()).toBe(false);
  });

  it("marks replay events so capture does not loop", () => {
    expect(isPointerReplayEvent({ __itfluxCoalescedReplay: true })).toBe(true);
    expect(isPointerReplayEvent({})).toBe(false);
  });

  it("reads coalesced events when the browser API exists", () => {
    const event = {
      getCoalescedEvents: () => [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }],
    };
    expect(readCoalescedPointerEvents(event)).toHaveLength(2);
    expect(coalescedEventsOrFallback(event as never)).toHaveLength(2);
  });

  it("survives getCoalescedEvents throwing", () => {
    const event = {
      clientX: 3,
      clientY: 4,
      getCoalescedEvents: () => {
        throw new Error("unsupported");
      },
    };
    expect(readCoalescedPointerEvents(event)).toBeNull();
    expect(coalescedEventsOrFallback(event)).toEqual([event]);
  });

  it("interpolates a large Safari gap when coalesced extras are missing", () => {
    const last = { clientX: 0, clientY: 0, pressure: 0.4 };
    const native = { clientX: 20, clientY: 0, pressure: 0.5 };
    const extras = penMovesToInject({ native, coalesced: null, last });
    expect(extras.length).toBeGreaterThan(3);
    expect(extras[0].clientX).toBeGreaterThan(0);
    expect(extras[extras.length - 1].clientX).toBeLessThan(20);
  });

  it("fills a fast Safari swipe with more than a dozen samples, not 12-step chords", () => {
    const extras = densifyPenGap({ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 });
    expect(extras.length).toBeGreaterThan(12);
    expect(extras.length).toBeLessThanOrEqual(48);
    const step = extras[1].clientX - extras[0].clientX;
    expect(step).toBeLessThan(8);
  });

  it("densify keeps float coordinates", () => {
    const extras = densifyPenGap(
      { clientX: 1.25, clientY: 2.5 },
      { clientX: 11.25, clientY: 2.5 },
    );
    expect(extras.length).toBeGreaterThan(0);
    expect(extras.some((p) => p.clientX !== Math.round(p.clientX))).toBe(true);
  });

  it("does not invent extras when the gap is already small", () => {
    expect(densifyPenGap({ clientX: 0, clientY: 0 }, { clientX: 1, clientY: 1 })).toEqual([]);
  });

  it("stays on the chord when filling a sampling gap", () => {
    const extras = densifyPenGap(
      { clientX: 8, clientY: 2 },
      { clientX: 24, clientY: 0 },
    );
    expect(extras.length).toBeGreaterThan(2);
    extras.forEach((p) => {
      const t = (p.clientX - 8) / (24 - 8);
      const chordY = 2 + (0 - 2) * t;
      expect(p.clientY).toBeCloseTo(chordY, 10);
    });
  });

  it("stays on the chord for a 180° reversal so hooks are not invented", () => {
    const extras = densifyPenGap({ clientX: 16, clientY: 0 }, { clientX: 0, clientY: 0 });
    expect(extras.length).toBeGreaterThan(0);
    extras.forEach((p) => {
      expect(Math.abs(p.clientY)).toBeLessThan(1e-6);
    });
  });

  it("does not rewrite real coalesced coordinates or invent points between them", () => {
    const last = { clientX: 0, clientY: 0 };
    const native = { clientX: 10, clientY: 10 };
    const coalesced = [
      { clientX: 3.25, clientY: 4.5 },
      { clientX: 7.75, clientY: 8.125 },
      native,
    ];
    const extras = penMovesToInject({ native, coalesced, last });
    expect(extras).toEqual([
      { clientX: 3.25, clientY: 4.5 },
      { clientX: 7.75, clientY: 8.125 },
    ]);
  });

  it("smooths pressure with EMA and falls back when the device reports 0", () => {
    expect(readPenPressure(0, null)).toBe(0.5);
    expect(readPenPressure(0, 0.4)).toBe(0.4);
    expect(readPenPressure(0.9, 0.4)).toBe(0.9);
    expect(smoothPenPressure(1, 0)).toBeCloseTo(1);
    expect(smoothPenPressure(0.7, 0.3)).toBeCloseTo(0.7 * 0.7 + 0.3 * 0.3);
  });

  it("linear densify stays on the chord, not a second smoothing curve", () => {
    const from = { clientX: 0, clientY: 0 };
    const to = { clientX: 30, clientY: 40 };
    const extras = densifyPenGap(from, to);
    expect(extras.length).toBeGreaterThan(0);
    extras.forEach((p) => {
      const cross = (p.clientX - from.clientX) * (to.clientY - from.clientY)
        - (p.clientY - from.clientY) * (to.clientX - from.clientX);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    });
  });

  it("appends live freedraw samples in place without copying the buffer", () => {
    const points = [[0, 0]];
    const pressures = [0.4];
    const el = { x: 10, y: 20, type: "freedraw", points, pressures };
    const added = appendLiveFreedrawSamples(el, [
      { sceneX: 10.25, sceneY: 20.5, pressure: 0.5 },
      { sceneX: 11.5, sceneY: 21.25, pressure: 0.6 },
      { sceneX: 11.5, sceneY: 21.25, pressure: 0.7 },
    ]);
    expect(added).toBe(2);
    expect(el.points).toBe(points);
    expect(el.pressures).toBe(pressures);
    expect(el.points).toEqual([[0, 0], [0.25, 0.5], [1.5, 1.25]]);
    expect(el.pressures).toEqual([0.4, 0.5, 0.6]);
  });

  it("does not write pressures when the device is simulating them", () => {
    const el = { x: 0, y: 0, type: "freedraw", points: [[0, 0]], pressures: [] as number[], simulatePressure: true };
    appendLiveFreedrawSamples(el, [{ sceneX: 2, sceneY: 3, pressure: 0.9 }]);
    expect(el.points).toEqual([[0, 0], [2, 3]]);
    expect(el.pressures).toEqual([]);
  });

  it("writes coalesced pen samples into the live stroke instead of replaying events", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const points = [[0, 0]];
    const element = { x: 0, y: 0, type: "freedraw", points, pressures: [0.4] };
    const windowMoves: Event[] = [];
    const onWindowMove = (ev: Event) => windowMoves.push(ev);
    window.addEventListener("pointermove", onWindowMove);

    const mutated: number[] = [];
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => ({
        element,
        toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
      }),
      onLiveStrokeMutated: () => mutated.push(element.points.length),
    });

    const fire = (type: string, init: PointerEventInit & { coalesced?: Array<{ clientX: number; clientY: number }> }) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: 1,
        button: 0,
        ...init,
      });
      if (init.pointerType) Object.defineProperty(event, "pointerType", { value: init.pointerType });
      Object.defineProperty(event, "buttons", { value: 1 });
      if (init.coalesced) {
        Object.defineProperty(event, "getCoalescedEvents", { value: () => init.coalesced });
      }
      canvas.dispatchEvent(event);
    };

    fire("pointerdown", { pointerType: "pen", clientX: 0, clientY: 0, pressure: 0.4 });
    fire("pointermove", {
      pointerType: "pen",
      clientX: 10.25,
      clientY: 4.5,
      pressure: 0.5,
      coalesced: [
        { clientX: 3.25, clientY: 1.5 },
        { clientX: 7.5, clientY: 3.25 },
        { clientX: 10.25, clientY: 4.5 },
      ],
    });

    expect(element.points).toBe(points);
    expect(element.points.length).toBeGreaterThan(2);
    expect(element.points.some((p) => p[0] === 3.25 && p[1] === 1.5)).toBe(true);
    expect(element.points[element.points.length - 1]).toEqual([10.25, 4.5]);
    expect(mutated.length).toBeGreaterThan(0);
    expect(windowMoves).toEqual([]);

    unmount();
    window.removeEventListener("pointermove", onWindowMove);
    host.remove();
  });

  it("queues pen samples until the live freedraw element exists", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const points = [[0, 0]];
    const element = { x: 0, y: 0, type: "freedraw", points, pressures: [0.4] };
    let live: {
      element: typeof element | null;
      toScene: (x: number, y: number) => { x: number; y: number };
    } | null = {
      element: null,
      toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
    };

    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => live,
    });

    const fire = (type: string, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: 1,
        button: 0,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      Object.defineProperty(event, "buttons", { value: 1 });
      canvas.dispatchEvent(event);
    };

    fire("pointerdown", { clientX: 0, clientY: 0, pressure: 0.4 });
    fire("pointermove", { clientX: 4, clientY: 0, pressure: 0.4 });
    expect(element.points).toEqual([[0, 0]]);

    live = { element, toScene: (clientX, clientY) => ({ x: clientX, y: clientY }) };
    fire("pointermove", { clientX: 8, clientY: 0, pressure: 0.4 });
    expect(element.points).toBe(points);
    expect(element.points.some((p) => p[0] === 4 && p[1] === 0)).toBe(true);
    expect(element.points[element.points.length - 1]).toEqual([8, 0]);

    unmount();
    host.remove();
  });

  it("flushes queued pen samples on pointerup once the live element exists", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const points = [[0, 0]];
    const element = { x: 0, y: 0, type: "freedraw", points, pressures: [0.4] };
    let live: {
      element: typeof element | null;
      toScene: (x: number, y: number) => { x: number; y: number };
    } | null = {
      element: null,
      toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
    };

    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => live,
    });

    const fire = (type: string, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: type === "pointerup" ? 0 : 1,
        button: 0,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      if (type !== "pointerup") Object.defineProperty(event, "buttons", { value: 1 });
      canvas.dispatchEvent(event);
    };

    fire("pointerdown", { clientX: 0, clientY: 0, pressure: 0.4 });
    fire("pointermove", { clientX: 5.5, clientY: 1.25, pressure: 0.4 });
    live = { element, toScene: (clientX, clientY) => ({ x: clientX, y: clientY }) };
    fire("pointerup", { clientX: 5.5, clientY: 1.25, pressure: 0.4 });
    expect(element.points).toBe(points);
    expect(element.points.some((p) => p[0] === 5.5 && p[1] === 1.25)).toBe(true);

    unmount();
    host.remove();
  });

  it("pending freedraw (no element yet) still consumes pen moves so Excalidraw throttle cannot drop them", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const windowMoves: number[] = [];
    window.addEventListener("pointermove", () => windowMoves.push(1));
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => ({
        element: null,
        toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
      }),
    });

    const event = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      buttons: 1,
      clientX: 6.5,
      clientY: 1.25,
    });
    Object.defineProperty(event, "pointerType", { value: "pen" });
    Object.defineProperty(event, "buttons", { value: 1 });
    canvas.dispatchEvent(event);
    expect(windowMoves).toEqual([]);

    unmount();
    host.remove();
  });

  it("maps live samples through toScene without rounding", () => {
    const points = [[0, 0]];
    const el = { x: 0, y: 0, type: "freedraw" as const, points, pressures: [0.5] };
    const added = appendLiveFreedrawSamples(el, [
      { sceneX: 10.25 / 2, sceneY: 4.5 / 2, pressure: 0.5 },
    ]);
    expect(added).toBe(1);
    expect(el.points[1][0]).toBe(5.125);
    expect(el.points[1][1]).toBe(2.25);
    expect(el.points).toBe(points);
  });

  it("does not swallow pen pointermove when the live hook says this is not freedraw", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const windowMoves: number[] = [];
    const onWindowMove = () => windowMoves.push(1);
    window.addEventListener("pointermove", onWindowMove);

    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => null,
    });

    const event = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      isPrimary: true,
      buttons: 1,
      button: 0,
      clientX: 12,
      clientY: 8,
    });
    Object.defineProperty(event, "pointerType", { value: "pen" });
    Object.defineProperty(event, "buttons", { value: 1 });
    canvas.dispatchEvent(event);

    expect(windowMoves.length).toBeGreaterThan(0);

    unmount();
    window.removeEventListener("pointermove", onWindowMove);
    host.remove();
  });

  it("replays pen coalesced extras onto canvas and does not replay mouse", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const moves: Array<{ x: number; y: number; replay: boolean; pointerType: string }> = [];
    const downs: string[] = [];
    canvas.addEventListener("pointerdown", () => downs.push("down"));
    canvas.addEventListener("pointermove", (ev) => {
      const pe = ev as PointerEvent;
      moves.push({
        x: pe.clientX,
        y: pe.clientY,
        replay: isPointerReplayEvent(pe as never),
        pointerType: pe.pointerType,
      });
    }, true);

    const unmount = mountCoalescedPointerReplay(host);
    const fire = (type: string, init: PointerEventInit & { coalesced?: Array<{ clientX: number; clientY: number }> }) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: 1,
        button: 0,
        ...init,
      });
      if (init.pointerType) {
        Object.defineProperty(event, "pointerType", { value: init.pointerType });
      }
      Object.defineProperty(event, "buttons", { value: 1 });
      if (init.coalesced) {
        Object.defineProperty(event, "getCoalescedEvents", {
          value: () => init.coalesced,
        });
      }
      canvas.dispatchEvent(event);
    };

    fire("pointerdown", { pointerType: "pen", clientX: 0, clientY: 0, pressure: 0.4 });
    fire("pointermove", {
      pointerType: "pen",
      clientX: 10.25,
      clientY: 4.5,
      pressure: 0.5,
      coalesced: [
        { clientX: 3.25, clientY: 1.5 },
        { clientX: 7.5, clientY: 3.25 },
        { clientX: 10.25, clientY: 4.5 },
      ],
    });
    const penReplays = moves.filter((m) => m.replay);
    expect(penReplays.length).toBeGreaterThanOrEqual(2);
    expect(penReplays.every((m) => m.pointerType === "pen")).toBe(true);
    expect(penReplays.some((m) => m.x === 3.25 && m.y === 1.5)).toBe(true);
    expect(downs).toEqual(["down"]);

    const beforeMouse = moves.length;
    fire("pointermove", {
      pointerType: "mouse",
      clientX: 40,
      clientY: 40,
      coalesced: [
        { clientX: 20, clientY: 20 },
        { clientX: 30, clientY: 30 },
        { clientX: 40, clientY: 40 },
      ],
    });
    const mouseReplays = moves.slice(beforeMouse).filter((m) => m.replay);
    expect(mouseReplays).toEqual([]);

    unmount();
    host.remove();
  });

  it("keeps a long coalesced pen stroke on one mutable buffer without rounding", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const points = [[0, 0]];
    const element = { x: 0, y: 0, type: "freedraw", points, pressures: [0.4] };
    let mutated = 0;
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => ({
        element,
        toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
      }),
      onLiveStrokeMutated: () => {
        mutated += 1;
      },
    });

    const fire = (type: string, init: PointerEventInit & { coalesced?: Array<{ clientX: number; clientY: number }> }) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: type === "pointerup" ? 0 : 1,
        button: 0,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      if (type !== "pointerup") Object.defineProperty(event, "buttons", { value: 1 });
      if (init.coalesced) {
        Object.defineProperty(event, "getCoalescedEvents", { value: () => init.coalesced });
      }
      canvas.dispatchEvent(event);
    };

    fire("pointerdown", { clientX: 0.25, clientY: 0.5, pressure: 0.4 });
    for (let i = 0; i < 80; i += 1) {
      const x = (i + 1) * 1.25;
      const y = Math.sin(i / 6) * 8.25;
      fire("pointermove", {
        clientX: x,
        clientY: y,
        pressure: 0.4 + (i % 5) * 0.05,
        coalesced: [
          { clientX: x - 0.8, clientY: y - 0.4 },
          { clientX: x - 0.4, clientY: y - 0.2 },
          { clientX: x, clientY: y },
        ],
      });
    }
    fire("pointerup", { clientX: 100, clientY: 0, pressure: 0.4 });

    expect(element.points).toBe(points);
    expect(element.points.length).toBeGreaterThan(160);
    expect(element.points.some((p) => p[0] !== Math.round(p[0]) || p[1] !== Math.round(p[1]))).toBe(true);
    expect(mutated).toBe(80);

    unmount();
    host.remove();
  });

  it("pins freedraw pointerup to the last sample so a stylus lift does not add a hook", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const element = { x: 0, y: 0, type: "freedraw", points: [[0, 0]], pressures: [0.4] };
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => ({
        element,
        toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
      }),
    });

    const fire = (type: string, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        buttons: type === "pointerup" ? 0 : 1,
        button: 0,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      if (type !== "pointerup") Object.defineProperty(event, "buttons", { value: 1 });
      canvas.dispatchEvent(event);
      return event;
    };

    fire("pointerdown", { clientX: 0, clientY: 0, pressure: 0.4 });
    fire("pointermove", { clientX: 12.5, clientY: 3.25, pressure: 0.5 });
    const up = fire("pointerup", { clientX: 40, clientY: 28, pressure: 0.1 });
    expect(up.clientX).toBe(12.5);
    expect(up.clientY).toBe(3.25);
    expect(element.points[element.points.length - 1]).toEqual([12.5, 3.25]);

    unmount();
    host.remove();
  });

  it("does not rewrite pointerup when the pen is not drawing freedraw", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => null,
    });

    const fire = (type: string, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        buttons: type === "pointerup" ? 0 : 1,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      if (type !== "pointerup") Object.defineProperty(event, "buttons", { value: 1 });
      canvas.dispatchEvent(event);
      return event;
    };

    fire("pointerdown", { clientX: 1, clientY: 1 });
    fire("pointermove", { clientX: 8, clientY: 9 });
    const up = fire("pointerup", { clientX: 40, clientY: 28 });
    expect(up.clientX).toBe(40);
    expect(up.clientY).toBe(28);

    unmount();
    host.remove();
  });

  it("pinPointerEventToClient overwrites lift coordinates", () => {
    if (typeof PointerEvent !== "function") return;
    const event = new PointerEvent("pointerup", { clientX: 80, clientY: 90, bubbles: true });
    expect(pinPointerEventToClient(event, { clientX: 3.5, clientY: 4.25, pageX: 3.5, pageY: 4.25 })).toBe(true);
    expect(event.clientX).toBe(3.5);
    expect(event.clientY).toBe(4.25);
  });

  it("createPinnedPointerUp carries last sample coords for WebKit fallback", () => {
    if (typeof PointerEvent !== "function") return;
    const native = new PointerEvent("pointerup", {
      clientX: 80,
      clientY: 90,
      pointerId: 7,
      bubbles: true,
    });
    Object.defineProperty(native, "pointerType", { value: "pen" });
    const replay = createPinnedPointerUp(native, { clientX: 3.5, clientY: 4.25, pageX: 3.5, pageY: 4.25 });
    expect(replay).toBeTruthy();
    expect(replay?.type).toBe("pointerup");
    expect(replay?.clientX).toBe(3.5);
    expect(replay?.clientY).toBe(4.25);
    expect(isPointerReplayEvent(replay as never)).toBe(true);
  });

  it("dispatches a pinned window pointerup when the lift event cannot be overwritten", () => {
    if (typeof PointerEvent !== "function") return;

    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas interactive";
    host.appendChild(canvas);
    document.body.appendChild(host);

    const element = { x: 0, y: 0, type: "freedraw", points: [[0, 0]], pressures: [0.4] };
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => ({
        element,
        toScene: (clientX, clientY) => ({ x: clientX, y: clientY }),
      }),
    });

    const pinned: number[] = [];
    const onWin = (ev: Event) => {
      const pe = ev as PointerEvent;
      if (isPointerReplayEvent(pe as never)) pinned.push(pe.clientX, pe.clientY);
    };
    window.addEventListener("pointerup", onWin);

    const orig = Object.defineProperty;
    const spy = vi.spyOn(Object, "defineProperty").mockImplementation((target, property, attrs) => {
      // Safari: clientX is a non-writable getter. Only fail the pin overwrite
      // (configurable:true + value), not PointerEvent construction.
      if (
        property === "clientX"
        && attrs
        && attrs.configurable === true
        && Object.prototype.hasOwnProperty.call(attrs, "value")
      ) {
        throw new Error("webkit-readonly");
      }
      return orig.call(Object, target, property, attrs);
    });

    const fire = (type: string, init: PointerEventInit) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        buttons: type === "pointerup" ? 0 : 1,
        ...init,
      });
      Object.defineProperty(event, "pointerType", { value: "pen" });
      if (type !== "pointerup") Object.defineProperty(event, "buttons", { value: 1 });
      canvas.dispatchEvent(event);
    };

    try {
      fire("pointerdown", { clientX: 0, clientY: 0, pressure: 0.4 });
      fire("pointermove", { clientX: 11.5, clientY: 2.25, pressure: 0.5 });
      fire("pointerup", { clientX: 80, clientY: 90, pressure: 0.1 });
    } finally {
      spy.mockRestore();
      window.removeEventListener("pointerup", onWin);
      unmount();
      host.remove();
    }
    expect(pinned).toEqual([11.5, 2.25]);
  });
});
