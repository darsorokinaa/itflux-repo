import { describe, expect, it } from "vitest";

import { imageSurvivesEraser, keepImagesUnderEraser, withoutImageEraseTargets } from "./lessonEraser";

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
