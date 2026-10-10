import { describe, expect, it } from "vitest";

import {
  eraserSamplePoints,
  imageSurvivesEraser,
  installCoalescedEraserInput,
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
