import { describe, expect, it } from "vitest";
import {
  MAX_COALESCED_EXTRA_MOVES,
  coalescedMovesToInject,
  downsampleEvenly,
  isPointerReplayEvent,
  readCoalescedPointerEvents,
  shouldReplayCoalescedPointerMove,
} from "./boardPointerInput";

describe("boardPointerInput", () => {
  it("falls back to empty extras when getCoalescedEvents is missing", () => {
    expect(readCoalescedPointerEvents({})).toBeNull();
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

  it("caps extras so one frame cannot flood the editor", () => {
    const native = { clientX: 100, clientY: 100 };
    const coalesced = Array.from({ length: 40 }, (_, i) => ({ clientX: i, clientY: i }));
    coalesced.push(native);
    const extras = coalescedMovesToInject(native, coalesced);
    expect(extras.length).toBeLessThanOrEqual(MAX_COALESCED_EXTRA_MOVES);
    expect(extras[0]).toEqual({ clientX: 0, clientY: 0 });
    expect(extras[extras.length - 1]).toEqual({ clientX: 39, clientY: 39 });
  });

  it("downsample keeps endpoints", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(downsampleEvenly(items, 3)).toEqual([0, 5, 9]);
  });

  it("does not replay hover, synthetic, or non-move events", () => {
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 0, pointerType: "pen" })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({
      type: "pointermove",
      buttons: 1,
      pointerType: "pen",
      __itfluxCoalescedReplay: true,
    })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({ type: "pointerdown", buttons: 1, pointerType: "pen" })).toBe(false);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "pen" })).toBe(true);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "touch" })).toBe(true);
    expect(shouldReplayCoalescedPointerMove({ type: "pointermove", buttons: 1, pointerType: "mouse" })).toBe(true);
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
  });

  it("survives getCoalescedEvents throwing", () => {
    const event = {
      getCoalescedEvents: () => {
        throw new Error("unsupported");
      },
    };
    expect(readCoalescedPointerEvents(event)).toBeNull();
  });
});
