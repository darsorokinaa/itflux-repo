import { describe, expect, it } from "vitest";

import {
  abandonNonPenGesture,
  endOpenBoardGesture,
  eraserSamplePoints,
  imageSurvivesEraser,
  installCoalescedEraserInput,
  isOpenBoardGesture,
  keepImagesUnderEraser,
  sameActivePointer,
  shouldDensifyEraserMove,
  shouldFillIosPenDraw,
  tldrawSkipsCoalescedEvents,
  withoutImageEraseTargets,
} from "./lessonEraser";

describe("lesson eraser pointer", () => {
  it("densifies pen and touch while the eraser is active and leaves the mouse alone", () => {
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "pen" }, true)).toBe(true);
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "touch", buttons: 1 }, true)).toBe(true);
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "pen", buttons: 0, pressure: 0.4 }, true)).toBe(true);
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "pen", buttons: 0, pressure: 0 }, true)).toBe(false);
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "mouse" }, true)).toBe(false);
    expect(shouldDensifyEraserMove({ type: "pointermove", pointerType: "pen" }, false)).toBe(false);
    expect(shouldDensifyEraserMove({ type: "pointerdown", pointerType: "pen" }, true)).toBe(false);
    const sparse = eraserSamplePoints([], { x: 0, y: 0 }, { x: 30, y: 0 }, 6);
    expect(sparse.length).toBeGreaterThan(1);
    expect(sparse[0].x).toBeGreaterThan(0);
    expect(sparse.at(-1).x).toBeLessThan(30);
    expect(eraserSamplePoints([{ clientX: 1 }, { clientX: 2 }], { x: 0, y: 0 }, { x: 30, y: 0 })).toEqual([{ clientX: 1 }]);
  });

  it("keeps one active pointer and fills coalesced pen samples only when tldraw skips them", () => {
    expect(sameActivePointer(null, 4)).toBe(true);
    expect(sameActivePointer(7, 7)).toBe(true);
    expect(sameActivePointer(7, 4)).toBe(false);
    expect(tldrawSkipsCoalescedEvents("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe(true);
    expect(tldrawSkipsCoalescedEvents("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(tldrawSkipsCoalescedEvents(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    )).toBe(true);
    expect(tldrawSkipsCoalescedEvents("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(false);
    const penMove = { type: "pointermove", pointerType: "pen", buttons: 1, pressure: 0.4 };
    expect(shouldFillIosPenDraw(penMove, "draw", true)).toBe(true);
    expect(shouldFillIosPenDraw(penMove, "highlight", true)).toBe(true);
    expect(shouldFillIosPenDraw(penMove, "draw", false)).toBe(false);
    expect(shouldFillIosPenDraw(penMove, "eraser", true)).toBe(false);
    expect(shouldFillIosPenDraw({ ...penMove, pointerType: "touch" }, "draw", true)).toBe(false);
    expect(shouldFillIosPenDraw({ ...penMove, pointerType: "mouse" }, "draw", true)).toBe(false);
    expect(shouldFillIosPenDraw({ ...penMove, type: "pointerdown" }, "draw", true)).toBe(false);
    expect(shouldFillIosPenDraw({ ...penMove, buttons: 0, pressure: 0 }, "draw", true)).toBe(false);
  });

  it("injects only confirmed coalesced pen samples and ignores a second pointer", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const moves = [];
    let predictedReads = 0;
    let tool = "draw";
    const editor = {
      getContainer: () => host,
      isIn: (path) => path === "eraser" && tool === "eraser",
      getCurrentToolId: () => tool,
      dispatch(info) {
        moves.push({ pointerId: info.pointerId, x: info.point.x, y: info.point.y, z: info.point.z });
      },
    };
    const previousAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    });
    const dispose = installCoalescedEraserInput(editor);

    function fire(type, init) {
      const event = new PointerEvent(type, {
        bubbles: true,
        clientX: init.clientX,
        clientY: init.clientY,
        pointerId: init.pointerId,
        button: 0,
        buttons: init.buttons,
      });
      Object.defineProperty(event, "pointerType", { value: init.pointerType });
      Object.defineProperty(event, "pressure", { value: init.pressure });
      if (init.coalesced) {
        Object.defineProperty(event, "getCoalescedEvents", { value: () => init.coalesced });
      }
      Object.defineProperty(event, "getPredictedEvents", {
        value: () => {
          predictedReads += 1;
          return [{ clientX: 99, clientY: 99, pressure: 1 }];
        },
      });
      host.ownerDocument.dispatchEvent(event);
    }

    fire("pointermove", {
      pointerType: "pen",
      pointerId: 3,
      buttons: 1,
      pressure: 0.4,
      clientX: 8,
      clientY: 4,
      coalesced: [
        { clientX: 2, clientY: 1, pressure: 0.2 },
        { clientX: 5, clientY: 2, pressure: 0.3 },
        { clientX: 8, clientY: 4, pressure: 0.4 },
      ],
    });
    expect(moves).toEqual([
      { pointerId: 3, x: 2, y: 1, z: 0.2 },
      { pointerId: 3, x: 5, y: 2, z: 0.3 },
    ]);
    expect(predictedReads).toBe(0);

    fire("pointermove", {
      pointerType: "touch",
      pointerId: 9,
      buttons: 1,
      pressure: 1,
      clientX: 40,
      clientY: 40,
      coalesced: [
        { clientX: 30, clientY: 30, pressure: 1 },
        { clientX: 40, clientY: 40, pressure: 1 },
      ],
    });
    expect(moves).toHaveLength(2);

    fire("pointerup", { pointerType: "touch", pointerId: 9, buttons: 0, pressure: 0, clientX: 40, clientY: 40 });
    fire("pointermove", {
      pointerType: "touch",
      pointerId: 9,
      buttons: 1,
      pressure: 1,
      clientX: 42,
      clientY: 42,
      coalesced: [
        { clientX: 41, clientY: 41, pressure: 1 },
        { clientX: 42, clientY: 42, pressure: 1 },
      ],
    });
    expect(moves).toHaveLength(2);

    fire("pointercancel", { pointerType: "pen", pointerId: 3, buttons: 0, pressure: 0, clientX: 8, clientY: 4 });
    tool = "eraser";
    fire("pointermove", {
      pointerType: "pen",
      pointerId: 4,
      buttons: 1,
      pressure: 0.5,
      clientX: 12,
      clientY: 6,
      coalesced: [
        { clientX: 10, clientY: 5, pressure: 0.5 },
        { clientX: 12, clientY: 6, pressure: 0.5 },
      ],
    });
    expect(moves.at(-1)).toEqual({ pointerId: 4, x: 10, y: 5, z: 0.5 });

    fire("pointerup", { pointerType: "pen", pointerId: 4, buttons: 0, pressure: 0, clientX: 12, clientY: 6 });
    moves.length = 0;
    fire("pointermove", {
      pointerType: "touch",
      pointerId: 9,
      buttons: 1,
      pressure: 1,
      clientX: 40,
      clientY: 40,
      coalesced: [
        { clientX: 30, clientY: 30, pressure: 1 },
        { clientX: 40, clientY: 40, pressure: 1 },
      ],
    });
    expect(moves).toEqual([{ pointerId: 9, x: 30, y: 30, z: 1 }]);
    fire("pointermove", {
      pointerType: "pen",
      pointerId: 11,
      buttons: 1,
      pressure: 0.6,
      clientX: 16,
      clientY: 8,
      coalesced: [
        { clientX: 14, clientY: 7, pressure: 0.6 },
        { clientX: 16, clientY: 8, pressure: 0.6 },
      ],
    });
    expect(moves).toEqual([{ pointerId: 9, x: 30, y: 30, z: 1 }]);
    fire("pointermove", {
      pointerType: "pen",
      pointerId: 11,
      buttons: 1,
      pressure: 0.7,
      clientX: 18,
      clientY: 9,
      coalesced: [
        { clientX: 17, clientY: 8, pressure: 0.7 },
        { clientX: 18, clientY: 9, pressure: 0.7 },
      ],
    });
    expect(moves.at(-1)).toEqual({ pointerId: 11, x: 17, y: 8, z: 0.7 });
    fire("pointermove", {
      pointerType: "touch",
      pointerId: 9,
      buttons: 1,
      pressure: 1,
      clientX: 50,
      clientY: 50,
      coalesced: [
        { clientX: 48, clientY: 48, pressure: 1 },
        { clientX: 50, clientY: 50, pressure: 1 },
      ],
    });
    expect(moves.at(-1).pointerId).toBe(11);

    dispose();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: previousAgent });
    host.remove();
  });

  it("does not inject pen or mouse samples when tldraw already reads coalesced events", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const moves = [];
    const editor = {
      getContainer: () => host,
      isIn: () => false,
      getCurrentToolId: () => "draw",
      dispatch(info) {
        moves.push(info.pointerId);
      },
    };
    const previousAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    });
    const dispose = installCoalescedEraserInput(editor);
    function fire(init) {
      const event = new PointerEvent("pointermove", {
        bubbles: true,
        clientX: init.clientX,
        clientY: init.clientY,
        pointerId: init.pointerId,
        button: 0,
        buttons: 1,
      });
      Object.defineProperty(event, "pointerType", { value: init.pointerType });
      Object.defineProperty(event, "pressure", { value: 0.5 });
      Object.defineProperty(event, "getCoalescedEvents", {
        value: () => [
          { clientX: 1, clientY: 1, pressure: 0.4 },
          { clientX: init.clientX, clientY: init.clientY, pressure: 0.5 },
        ],
      });
      host.ownerDocument.dispatchEvent(event);
    }
    fire({ pointerType: "pen", pointerId: 2, clientX: 4, clientY: 4 });
    fire({ pointerType: "mouse", pointerId: 1, clientX: 6, clientY: 6 });
    fire({ pointerType: "touch", pointerId: 8, clientX: 8, clientY: 8 });
    expect(moves).toEqual([]);
    dispose();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: previousAgent });
    host.remove();
  });

  it("stops a palm touch while the pen is down so tldraw cannot start a second stroke", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const doc = host.ownerDocument;
    const seen = [];
    const onBubble = (event) => seen.push(event.pointerType);
    doc.addEventListener("pointerdown", onBubble);
    doc.addEventListener("pointermove", onBubble);
    const editor = {
      getContainer: () => host,
      isIn: () => false,
      getCurrentToolId: () => "draw",
      dispatch() {},
    };
    const previousAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    });
    const dispose = installCoalescedEraserInput(editor);
    const fire = (type, pointerType, pointerId) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        pointerId,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      Object.defineProperty(event, "pressure", { value: pointerType === "pen" ? 0.4 : 1 });
      doc.dispatchEvent(event);
    };
    fire("pointerdown", "pen", 3);
    fire("pointermove", "pen", 3);
    fire("pointerdown", "touch", 9);
    fire("pointermove", "touch", 9);
    fire("pointerup", "touch", 9);
    fire("pointerup", "pen", 3);
    fire("pointerdown", "touch", 9);
    expect(seen).toEqual(["pen", "pen", "touch"]);
    dispose();
    doc.removeEventListener("pointerdown", onBubble);
    doc.removeEventListener("pointermove", onBubble);
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: previousAgent });
    host.remove();
  });
});

describe("open gesture end", () => {
  function harness(path = "draw.drawing") {
    const calls = [];
    let current = path;
    const editor = {
      capturedPointerId: 3,
      getPath: () => current,
      getEditingShapeId: () => null,
      getStateDescendant: () => ({ markId: "draw-mark" }),
      getInstanceState: () => ({ screenBounds: { x: 12, y: 20 }, isPenMode: false }),
      bailToMark(id) { calls.push(["bail", id]); },
      cancel() {
        calls.push(["cancel"]);
        current = "draw.idle";
      },
      complete() {
        calls.push(["complete"]);
        current = "draw.idle";
      },
      dispatch(info) {
        calls.push([info.name, info.isPen, info.point.x, info.point.y, info.pointerId]);
        current = "draw.idle";
      },
      inputs: {
        getIsPen: () => false,
        getIsPinching: () => false,
        getIsEditing: () => false,
        getCurrentScreenPoint: () => ({ x: 4, y: 6 }),
        setIsPointing(value) { calls.push(["pointing", value]); },
        setIsDragging(value) { calls.push(["dragging", value]); },
        buttons: { delete(button) { calls.push(["button", button]); } },
      },
    };
    return { editor, calls, setPath: (next) => { current = next; } };
  }

  it("treats idle and text editing as closed", () => {
    expect(isOpenBoardGesture({ getPath: () => "eraser.idle" })).toBe(false);
    expect(isOpenBoardGesture({ getPath: () => "select.idle", getEditingShapeId: () => null })).toBe(false);
    expect(isOpenBoardGesture({ getPath: () => "select.editing_shape", getEditingShapeId: () => "shape:1" })).toBe(false);
    expect(isOpenBoardGesture({ getPath: () => "eraser.erasing", getEditingShapeId: () => null })).toBe(true);
  });

  it("drops only the in-progress finger stroke when the pen comes down", () => {
    const { editor, calls } = harness("draw.drawing");
    expect(abandonNonPenGesture(editor)).toBe(true);
    expect(calls).toEqual([
      ["bail", "draw-mark"],
      ["cancel"],
      ["pointing", false],
      ["dragging", false],
      ["button", 0],
    ]);
    editor.inputs.getIsPen = () => true;
    calls.length = 0;
    expect(abandonNonPenGesture({ ...editor, getPath: () => "draw.drawing" })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("cancels an in-progress finger erase without bailing a draw mark", () => {
    const { editor, calls } = harness("eraser.erasing");
    editor.getStateDescendant = () => { throw new Error("draw node"); };
    expect(abandonNonPenGesture(editor)).toBe(true);
    expect(calls[0]).toEqual(["cancel"]);
    expect(calls.some((item) => item[0] === "bail")).toBe(false);
  });

  it("finishes a pinched gesture with complete because pointer_up is dropped", () => {
    const { editor, calls } = harness("eraser.erasing");
    editor.inputs.getIsPinching = () => true;
    editor.complete = () => {
      calls.push(["complete"]);
    };
    expect(endOpenBoardGesture(editor, "pinch")).toBe(true);
    expect(calls.map((item) => item[0])).toEqual(["complete", "cancel", "pointing", "dragging", "button"]);
    expect(calls.some((item) => item[0] === "pointer_up")).toBe(false);
  });

  it("finishes a visible gesture with one stock pointer_up", () => {
    const { editor, calls } = harness("draw.drawing");
    expect(endOpenBoardGesture(editor, "hidden")).toBe(true);
    expect(calls[0]).toEqual(["pointer_up", false, 16, 26, 3]);
    expect(calls.some((item) => item[0] === "complete")).toBe(false);
  });

  it("keeps isPen on the closing pointer_up while pen mode is on", () => {
    const { editor, calls } = harness("eraser.erasing");
    editor.getInstanceState = () => ({ screenBounds: { x: 0, y: 0 }, isPenMode: true });
    endOpenBoardGesture(editor);
    expect(calls[0][1]).toBe(true);
  });

  it("does not close an idle board when the page hides or a pinch starts", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const calls = [];
    let path = "select.idle";
    const listeners = new Set();
    const editor = {
      getContainer: () => host,
      getPath: () => path,
      getEditingShapeId: () => null,
      isIn: () => false,
      getCurrentToolId: () => "select",
      on(_name, fn) { listeners.add(fn); },
      off(_name, fn) { listeners.delete(fn); },
      complete() { calls.push("complete"); },
      cancel() { calls.push("cancel"); },
      dispatch(info) { calls.push(info.name); },
      inputs: { getIsPen: () => false, getIsPinching: () => true },
    };
    const dispose = installCoalescedEraserInput(editor);
    const previousVisibility = document.visibilityState;
    try {
      listeners.forEach((fn) => fn({ type: "pinch", name: "pinch_start" }));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("blur"));
      expect(calls).toEqual([]);
      path = "draw.drawing";
      editor.inputs.getIsPinching = () => true;
      listeners.forEach((fn) => fn({ type: "pinch", name: "pinch_start" }));
      expect(calls).toEqual(["complete", "cancel"]);
      dispose();
      calls.length = 0;
      listeners.forEach((fn) => fn({ type: "pinch", name: "pinch_start" }));
      document.dispatchEvent(new Event("visibilitychange"));
      expect(calls).toEqual([]);
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: previousVisibility });
      dispose();
      host.remove();
    }
  });

  it("ends a gesture after lost pointer capture only if it is still open", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const calls = [];
    let path = "draw.drawing";
    const editor = {
      capturedPointerId: 4,
      getContainer: () => host,
      getPath: () => path,
      getEditingShapeId: () => null,
      isIn: () => false,
      getCurrentToolId: () => "draw",
      getInstanceState: () => ({ screenBounds: { x: 0, y: 0 }, isPenMode: true }),
      inputs: {
        getIsPen: () => true,
        getIsPinching: () => false,
        getCurrentScreenPoint: () => ({ x: 1, y: 2 }),
      },
      dispatch(info) {
        calls.push([info.name, info.pointerId]);
        path = "draw.idle";
      },
    };
    const dispose = installCoalescedEraserInput(editor);
    host.ownerDocument.dispatchEvent(new PointerEvent("lostpointercapture", {
      bubbles: true,
      pointerId: 4,
    }));
    await Promise.resolve();
    expect(calls).toEqual([["pointer_up", 4]]);
    calls.length = 0;
    host.ownerDocument.dispatchEvent(new PointerEvent("lostpointercapture", {
      bubbles: true,
      pointerId: 4,
    }));
    await Promise.resolve();
    expect(calls).toEqual([]);
    dispose();
    host.remove();
  });

  it("still delivers the pen down after abandoning the finger stroke", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const doc = host.ownerDocument;
    const seen = [];
    const calls = [];
    const onDown = (event) => seen.push(event.pointerType);
    doc.addEventListener("pointerdown", onDown);
    const editor = {
      getContainer: () => host,
      getPath: () => "draw.drawing",
      getEditingShapeId: () => null,
      isIn: () => false,
      getCurrentToolId: () => "draw",
      getStateDescendant: () => ({ markId: "mark-1" }),
      bailToMark(id) { calls.push(id); },
      cancel() { calls.push("cancel"); },
      inputs: { getIsPen: () => false, buttons: { delete() {} }, setIsPointing() {}, setIsDragging() {} },
    };
    const dispose = installCoalescedEraserInput(editor);
    const mouse = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 8,
      clientY: 8,
    });
    Object.defineProperty(mouse, "pointerType", { value: "mouse" });
    doc.dispatchEvent(mouse);
    expect(calls).toEqual([]);
    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 5,
      button: 0,
      buttons: 1,
      clientX: 3,
      clientY: 4,
    });
    Object.defineProperty(event, "pointerType", { value: "pen" });
    Object.defineProperty(event, "pressure", { value: 0.4 });
    doc.dispatchEvent(event);
    expect(calls).toEqual(["mark-1", "cancel"]);
    expect(seen).toEqual(["mouse", "pen"]);
    dispose();
    doc.removeEventListener("pointerdown", onDown);
    host.remove();
  });
});

describe("lesson eraser keeps images", () => {
  it("drops only image ids from the erase preview", () => {
    const types = { img: "image", ink: "draw", note: "note" };
    expect(withoutImageEraseTargets(["img", "ink", "note"], (id) => types[id])).toEqual(["ink", "note"]);
    expect(withoutImageEraseTargets([{ id: "img" }, { id: "ink" }], (id) => types[id])).toEqual([{ id: "ink" }]);
    expect(withoutImageEraseTargets(null, () => "image")).toEqual([]);
  });

  it("blocks a local eraser delete of an image and leaves other deletes alone", () => {
    expect(imageSurvivesEraser({ type: "image" }, "user", true)).toBe(true);
    expect(imageSurvivesEraser({ type: "image" }, "user", false)).toBe(false);
    expect(imageSurvivesEraser({ type: "image" }, "remote", true)).toBe(false);
    expect(imageSurvivesEraser({ type: "draw" }, "user", true)).toBe(false);
  });

  it("filters the live eraser list and refuses the image delete", () => {
    const shapes = {
      img: { id: "img", type: "image" },
      ink: { id: "ink", type: "draw" },
    };
    let erasing = [];
    let tool = "eraser";
    const editor = {
      getShape: (id) => shapes[id],
      setErasingShapes(next) {
        erasing = next;
        return this;
      },
      isIn: (path) => path === "eraser" && tool === "eraser",
      sideEffects: {
        registerBeforeDeleteHandler(_type, handler) {
          editor.handler = handler;
          return () => {};
        },
      },
    };

    keepImagesUnderEraser(editor);
    keepImagesUnderEraser(editor);
    editor.setErasingShapes(["img", "ink"]);
    expect(erasing).toEqual(["ink"]);
    expect(editor.handler(shapes.img, "user")).toBe(false);
    expect(editor.handler(shapes.ink, "user")).toBeUndefined();
    tool = "select";
    expect(editor.handler(shapes.img, "user")).toBeUndefined();
  });
});
