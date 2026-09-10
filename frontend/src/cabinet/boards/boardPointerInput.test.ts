import { describe, expect, it } from "vitest";
import {
  MAX_COALESCED_PEN_EXTRAS,
  appendLiveFreedrawSamples,
  coalescedEventsOrFallback,
  coalescedMovesToInject,
  densifyPenGap,
  downsampleEvenly,
  isPointerReplayEvent,
  isReplayingPenPoints,
  isSharpPenTurn,
  mountCoalescedPointerReplay,
  penMovesToInject,
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

  it("curves a gentle arc off the chord without moving the native endpoint", () => {
    const prev = { clientX: 0, clientY: 12 };
    const from = { clientX: 8, clientY: 2 };
    const to = { clientX: 24, clientY: 0 };
    expect(isSharpPenTurn(prev, from, to)).toBe(false);
    const extras = densifyPenGap(from, to, prev);
    expect(extras.length).toBeGreaterThan(2);
    const chordYAt = (x: number) => {
      const t = (x - from.clientX) / (to.clientX - from.clientX);
      return from.clientY + (to.clientY - from.clientY) * t;
    };
    expect(extras.some((p) => Math.abs(p.clientY - chordYAt(p.clientX)) > 0.35)).toBe(true);
    expect(extras.every((p) => p.clientX > from.clientX && p.clientX < to.clientX)).toBe(true);
  });

  it("stays on the chord for a 180° reversal so hooks are not invented", () => {
    const prev = { clientX: 0, clientY: 0 };
    const from = { clientX: 16, clientY: 0 };
    const to = { clientX: 0, clientY: 0 };
    expect(isSharpPenTurn(prev, from, to)).toBe(true);
    const extras = densifyPenGap(from, to, prev);
    expect(extras.length).toBeGreaterThan(0);
    extras.forEach((p) => {
      expect(Math.abs(p.clientY)).toBeLessThan(1e-6);
    });
  });

  it("does not rewrite real coalesced coordinates", () => {
    const last = { clientX: 0, clientY: 0 };
    const native = { clientX: 10, clientY: 10 };
    const coalesced = [
      { clientX: 3.25, clientY: 4.5 },
      { clientX: 7.75, clientY: 8.125 },
      native,
    ];
    const extras = penMovesToInject({ native, coalesced, last, prev: { clientX: -2, clientY: -1 } });
    expect(extras).toEqual(expect.arrayContaining([
      { clientX: 3.25, clientY: 4.5 },
      { clientX: 7.75, clientY: 8.125 },
    ]));
  });

  it("smooths pressure with EMA and falls back when the device reports 0", () => {
    expect(readPenPressure(0, null)).toBe(0.5);
    expect(readPenPressure(0, 0.4)).toBe(0.4);
    expect(readPenPressure(0.9, 0.4)).toBe(0.9);
    expect(smoothPenPressure(1, 0)).toBeCloseTo(1);
    expect(smoothPenPressure(0.7, 0.3)).toBeCloseTo(0.7 * 0.7 + 0.3 * 0.3);
  });

  it("densify of a coarsely sampled circle is closer to the arc than the chords", () => {
    const r = 40;
    const samples = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return { clientX: Math.cos(a) * r, clientY: Math.sin(a) * r };
    });
    const densified: Array<{ clientX: number; clientY: number }> = [];
    for (let i = 2; i < samples.length; i += 1) {
      densified.push(...densifyPenGap(samples[i - 1], samples[i], samples[i - 2]));
    }
    const radialErr = (pts: Array<{ clientX: number; clientY: number }>) => {
      let max = 0;
      for (const p of pts) {
        max = Math.max(max, Math.abs(Math.hypot(p.clientX, p.clientY) - r));
      }
      return max;
    };
    expect(densified.length).toBeGreaterThan(8);
    const sampleKey = (p: { clientX: number; clientY: number }) => `${p.clientX},${p.clientY}`;
    const sampleKeys = new Set(samples.map(sampleKey));
    const intermediates = densified.filter((p) => !sampleKeys.has(sampleKey(p)));
    const chordMidErr = r * (1 - Math.cos(Math.PI / samples.length));
    expect(intermediates.length).toBeGreaterThan(0);
    expect(radialErr(intermediates)).toBeLessThan(chordMidErr * 0.85);
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
});
