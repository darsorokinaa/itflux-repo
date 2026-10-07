/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import { installLessonThickness } from "./lessonBoardActions";
import { LESSON_THICKNESS_DEFAULT, lessonStrokeScale, setLessonThickness } from "./lessonShell";

afterEach(() => {
  setLessonThickness(LESSON_THICKNESS_DEFAULT);
});

describe("installLessonThickness", () => {
  it("leaves non-stroke and remote shapes intact", async () => {
    const tldraw = await import("tldraw");
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new tldraw.Editor({
      store: tldraw.createTLStore({ shapeUtils: tldraw.defaultShapeUtils }),
      shapeUtils: tldraw.defaultShapeUtils,
      bindingUtils: tldraw.defaultBindingUtils,
      tools: [],
      getContainer: () => container,
    });
    setLessonThickness(32);
    const dispose = installLessonThickness(editor);

    expect(() => {
      editor.createShapes([
        { type: "geo", x: 0, y: 0, props: { w: 40, h: 24, geo: "rectangle" } },
        { type: "draw", x: 12, y: 12 },
      ]);
    }).not.toThrow();

    const shapes = editor.getCurrentPageShapes();
    const geo = shapes.find((shape) => shape.type === "geo");
    const draw = shapes.find((shape) => shape.type === "draw");
    expect(geo?.props.w).toBe(40);
    expect(draw?.props.size).toBe("m");
    expect(draw?.props.scale).toBeCloseTo(lessonStrokeScale(1, 32));

    const remoteId = tldraw.createShapeId();
    editor.store.mergeRemoteChanges(() => {
      editor.store.put([
        {
          ...draw,
          id: remoteId,
          props: { ...draw.props, size: "s", scale: 1 },
        },
      ]);
    });
    const remote = editor.getShape(remoteId);
    expect(remote?.props.size).toBe("s");
    expect(remote?.props.scale).toBe(1);

    dispose();
    editor.dispose();
    container.remove();
  });
});
