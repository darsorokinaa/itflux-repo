import { describe, expect, it, vi } from "vitest";

import { POINTER_STATES, createPointerMachine } from "./pointerMachine";

function ev(partial = {}) {
  return {
    pointerId: 1,
    isPrimary: true,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    pressure: 0.5,
    currentTarget: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
    ...partial,
  };
}

function point(x, y) {
  return { x, y };
}

describe("pointer machine", () => {
  it("pointerdown → move → up draws one stroke", () => {
    const onStart = vi.fn();
    const onPoint = vi.fn();
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    const machine = createPointerMachine({ onStart, onPoint, onEnd, onCancel });
    machine.pointerdown(ev(), point(0.1, 0.1), { strokeId: "s1" });
    machine.pointermove(ev(), point(0.2, 0.2));
    machine.pointerup(ev({ buttons: 0 }), point(0.3, 0.3));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onPoint).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(machine.state).toBe(POINTER_STATES.IDLE);
  });

  it("mousemove without pointerdown never draws", () => {
    const onStart = vi.fn();
    const onPoint = vi.fn();
    const machine = createPointerMachine({ onStart, onPoint });
    machine.pointermove(ev(), point(0.4, 0.4));
    expect(onStart).not.toHaveBeenCalled();
    expect(onPoint).not.toHaveBeenCalled();
  });

  it("pointercancel does not leave an active stroke", () => {
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    const machine = createPointerMachine({ onCancel, onEnd, onStart: vi.fn() });
    machine.pointerdown(ev(), point(0.1, 0.1), { strokeId: "s1" });
    machine.pointercancel(ev());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(machine.state).toBe(POINTER_STATES.IDLE);
    machine.pointermove(ev(), point(0.9, 0.9));
    expect(machine.state).toBe(POINTER_STATES.IDLE);
  });

  it("lostpointercapture ends the stroke", () => {
    const onEnd = vi.fn();
    const machine = createPointerMachine({ onEnd, onStart: vi.fn() });
    machine.pointerdown(ev(), point(0.1, 0.1), { strokeId: "s1" });
    machine.lostpointercapture(ev());
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ reason: "lostcapture" }));
    expect(machine.state).toBe(POINTER_STATES.IDLE);
  });

  it("blur ends the stroke", () => {
    const onEnd = vi.fn();
    const machine = createPointerMachine({ onEnd, onStart: vi.fn() });
    machine.pointerdown(ev(), point(0.1, 0.1), { strokeId: "s1" });
    machine.blur();
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ reason: "blur" }));
  });

  it("source change while drawing ends the stroke and does not join the next", () => {
    const onEnd = vi.fn();
    const onStart = vi.fn();
    const machine = createPointerMachine({ onEnd, onStart });
    machine.pointerdown(ev(), point(0.1, 0.1), { strokeId: "s1" });
    machine.setSourceRevision(2);
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ reason: "source-change", strokeId: "s1" }));
    machine.pointerdown(ev(), point(0.8, 0.8), { strokeId: "s2" });
    expect(onStart.mock.calls[1][0].strokeId).toBe("s2");
    expect(onStart.mock.calls[1][0].sourceRevision).toBe(2);
  });

  it("disable while drawing ends the stroke", () => {
    const onEnd = vi.fn();
    const machine = createPointerMachine({ onEnd, onStart: vi.fn() });
    machine.pointerdown(ev(), point(0.2, 0.2), { strokeId: "s1" });
    machine.disable();
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ reason: "disable" }));
    expect(machine.state).toBe(POINTER_STATES.IDLE);
  });

  it("ignores a second pointer id while the first is drawing", () => {
    const onPoint = vi.fn();
    const onStart = vi.fn();
    const machine = createPointerMachine({ onPoint, onStart, onEnd: vi.fn() });
    machine.pointerdown(ev({ pointerId: 1 }), point(0.1, 0.1), { strokeId: "s1" });
    machine.pointermove(ev({ pointerId: 2 }), point(0.9, 0.9));
    expect(onPoint).not.toHaveBeenCalled();
    expect(machine.activePointerId).toBe(1);
  });

  it("touch and stylus follow the same lifecycle", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const machine = createPointerMachine({ onStart, onEnd });
    machine.pointerdown(ev({ pointerType: "touch", button: 0, buttons: 1 }), point(0.2, 0.3), { strokeId: "t1" });
    machine.pointerup(ev({ pointerType: "touch", buttons: 0 }), point(0.21, 0.31));
    machine.pointerdown(ev({ pointerType: "pen", buttons: 1, button: 0 }), point(0.4, 0.4), { strokeId: "p1" });
    machine.pointerup(ev({ pointerType: "pen", buttons: 0 }), point(0.41, 0.41));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("fast and slow moves only append while DRAWING", () => {
    const onPoint = vi.fn();
    const machine = createPointerMachine({ onPoint, onStart: vi.fn(), onEnd: vi.fn() });
    for (let i = 0; i < 20; i += 1) machine.pointermove(ev(), point(i / 20, 0.1));
    expect(onPoint).not.toHaveBeenCalled();
    machine.pointerdown(ev(), point(0, 0), { strokeId: "fast" });
    for (let i = 1; i <= 20; i += 1) machine.pointermove(ev(), point(i / 20, 0.1));
    expect(onPoint).toHaveBeenCalledTimes(20);
  });
});
