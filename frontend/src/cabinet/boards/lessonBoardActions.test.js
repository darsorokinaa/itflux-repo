/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import { DefaultColorStyle } from "@tldraw/tlschema";
import { DEFAULT_THEME } from "@tldraw/editor";

import {
  customColorEntriesFromChanges,
  installLessonColorSync,
  installLessonThickness,
  lessonInkHexFromInstance,
  lessonPresenceAppearance,
} from "./lessonBoardActions";
import { LESSON_THICKNESS_DEFAULT, lessonStrokeScale, setLessonThickness } from "./lessonShell";

afterEach(() => {
  setLessonThickness(LESSON_THICKNESS_DEFAULT);
});

describe("lesson ink color", () => {
  const red = DEFAULT_THEME.colors.light.red.solid;
  const black = DEFAULT_THEME.colors.light.black.solid;

  it("uses the pen color for the cursor and keeps the role color for the person chip", () => {
    expect(lessonInkHexFromInstance({ stylesForNextShape: { [DefaultColorStyle.id]: "red" } })).toBe(red);
    expect(lessonInkHexFromInstance({ stylesForNextShape: { [DefaultColorStyle.id]: "c112233" } })).toBe("#112233");
    expect(lessonInkHexFromInstance({})).toBe(black);
    expect(lessonPresenceAppearance(
      { color: "#2563eb" },
      { stylesForNextShape: { [DefaultColorStyle.id]: "red" } },
    )).toEqual({ color: red, identityColor: "#2563eb" });
  });

  it("reads a custom color from an added or updated shape", () => {
    expect(customColorEntriesFromChanges({
      added: { "shape:a": { typeName: "shape", props: { color: "c112233", labelColor: "black" } } },
      updated: { "shape:b": [{}, { typeName: "shape", props: { labelColor: "c445566" } }] },
    })).toEqual([["c112233", "112233"], ["c445566", "445566"]]);
  });

  it("paints a remote custom color and points the laser with the local pen", async () => {
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
    const dispose = installLessonColorSync(editor);
    editor.setStyleForNextShapes(DefaultColorStyle, "red");
    expect(editor.getCurrentTheme().colors.light.laser).toBe(red);
    expect(editor.getCurrentTheme().colors.dark.laser).toBe(red);

    const id = tldraw.createShapeId();
    editor.store.mergeRemoteChanges(() => {
      editor.createShapes([{ id, type: "draw", x: 0, y: 0, props: { color: "cab12cd" } }]);
    });
    expect(editor.getCurrentTheme().colors.light.cab12cd.solid).toBe("#ab12cd");
    expect(editor.getShape(id)?.props.color).toBe("cab12cd");

    dispose();
    editor.dispose();
    container.remove();
  });
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
