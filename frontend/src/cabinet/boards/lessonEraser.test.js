import { describe, expect, it } from "vitest";

import {
  eraserSamplePoints,
  imageSurvivesEraser,
  keepImagesUnderEraser,
  shouldDensifyEraserMove,
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
