/** @vitest-environment jsdom */
import { createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";

import { lessonAssetIsReferenced, lessonBoardAssetIdFromSrc } from "./lessonBoardAssetStore";
import { FormulaShapeUtil, GraphShapeUtil, TaskShapeUtil } from "./lessonShapes";

function lessonSchema() {
  return createTLSchema({
    shapes: {
      ...defaultShapeSchemas,
      formula: { props: FormulaShapeUtil.props, migrations: FormulaShapeUtil.migrations },
      graph: { props: GraphShapeUtil.props, migrations: GraphShapeUtil.migrations },
      task: { props: TaskShapeUtil.props, migrations: TaskShapeUtil.migrations },
    },
  });
}

function legacy(type, props) {
  return {
    id: `shape:${type}`,
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    meta: {},
    props,
  };
}

describe("lesson shape migrations", () => {
  it("fills props that an older formula did not store", () => {
    const schema = lessonSchema();
    const current = schema.serialize();
    const key = Object.keys(current.sequences).find((item) => item.endsWith("shape.formula"));
    const old = { ...current, sequences: { ...current.sequences, [key]: 1 } };
    const migrated = schema.migratePersistedRecord(
      legacy("formula", { w: 200, h: 80, latex: "x^2" }),
      old,
      "up",
    );
    expect(migrated.type).toBe("success");
    expect(migrated.value.props.fontSize).toBe(22);
    expect(migrated.value.props.latex).toBe("x^2");
  });

  it("does not replace a font size that was already stored", () => {
    const schema = lessonSchema();
    const current = schema.serialize();
    const key = Object.keys(current.sequences).find((item) => item.endsWith("shape.formula"));
    const old = { ...current, sequences: { ...current.sequences, [key]: 1 } };
    const migrated = schema.migratePersistedRecord(
      legacy("formula", { w: 200, h: 80, latex: "x^2", fontSize: 30 }),
      old,
      "up",
    );
    expect(migrated.value.props.fontSize).toBe(30);
  });

  it("fills an older graph and task the same way", () => {
    const schema = lessonSchema();
    const current = schema.serialize();
    const graphKey = Object.keys(current.sequences).find((item) => item.endsWith("shape.graph"));
    const taskKey = Object.keys(current.sequences).find((item) => item.endsWith("shape.task"));
    const old = {
      ...current,
      sequences: { ...current.sequences, [graphKey]: 1, [taskKey]: 1 },
    };
    const graph = schema.migratePersistedRecord(legacy("graph", { w: 10, h: 10, functions: ["sin(x)"] }), old, "up");
    const task = schema.migratePersistedRecord(legacy("task", { w: 10, h: 10, title: "Старое" }), old, "up");
    expect(graph.value.props.xMin).toBe(-4);
    expect(graph.value.props.functions).toEqual(["sin(x)"]);
    expect(task.value.props.condition).toBe("");
    expect(task.value.props.title).toBe("Старое");
  });
});

describe("lesson asset cleanup", () => {
  it("keeps an asset while a shape points at it", () => {
    const assetId = "asset:picture";
    expect(lessonAssetIsReferenced([
      { id: assetId, typeName: "asset", props: { src: "/api/cabinet/interactive-boards/b/assets/11111111-1111-4111-8111-111111111111/" } },
      { id: "shape:1", typeName: "shape", props: { assetId } },
    ], assetId)).toBe(true);
  });

  it("allows cleanup after the shape is gone", () => {
    const assetId = "asset:picture";
    expect(lessonAssetIsReferenced([
      { id: assetId, typeName: "asset", props: { src: "/api/cabinet/interactive-boards/b/assets/11111111-1111-4111-8111-111111111111/" } },
    ], assetId)).toBe(false);
    expect(lessonBoardAssetIdFromSrc("/api/cabinet/interactive-boards/b/assets/11111111-1111-4111-8111-111111111111/"))
      .toBe("11111111-1111-4111-8111-111111111111");
  });
});
