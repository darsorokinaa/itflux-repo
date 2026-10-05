import { Store } from "@tldraw/store";
import { b64Vecs, createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { describe, expect, it, vi } from "vitest";

import "./lessonCustomColor";
import {
  attachLegacyExcalidrawScene,
  publishLegacyEdits,
  convertExcalidrawToTldraw,
  isExcalidrawSnapshot,
  isTldrawSnapshot,
  loadLegacyExcalidrawScene,
} from "./excalidrawToTldraw";

const PNG = "/api/cabinet/interactive-boards/board-1/assets/11111111-1111-4111-8111-111111111111/";
const JPEG = "/api/cabinet/interactive-boards/board-1/assets/22222222-2222-4222-8222-222222222222/";
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function scene() {
  return {
    elements: [
      { id: "gone", type: "rectangle", isDeleted: true, x: 0, y: 0, width: 10, height: 10 },
      {
        id: "box",
        type: "rectangle",
        x: 40,
        y: 50,
        width: 120,
        height: 80,
        angle: 0.4,
        strokeColor: "#1e1e1e",
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 0,
        opacity: 80,
        groupIds: ["g1"],
      },
      {
        id: "label",
        type: "text",
        containerId: "box",
        x: 48,
        y: 70,
        width: 100,
        height: 24,
        text: "Урок",
        originalText: "Урок",
        fontSize: 20,
        fontFamily: 2,
        textAlign: "center",
      },
      {
        id: "note",
        type: "text",
        x: 12,
        y: 16,
        width: 90,
        height: 28,
        angle: 0.2,
        text: "Первая\nстрока",
        originalText: "Первая\nстрока",
        fontSize: 28,
        fontFamily: 1,
        textAlign: "left",
        strokeColor: "#e03131",
      },
      { id: "oval", type: "ellipse", x: 200, y: 30, width: 70, height: 40, strokeColor: "#2f9e44", backgroundColor: "transparent", strokeWidth: 1 },
      { id: "gem", type: "diamond", x: 300, y: 30, width: 60, height: 60, strokeColor: "#f08c00", backgroundColor: "#fff3bf", fillStyle: "hachure" },
      {
        id: "rule",
        type: "line",
        x: 10,
        y: 180,
        width: 100,
        height: 0,
        strokeColor: "#1971c2",
        strokeWidth: 4,
        points: [[0, 0], [40, 10], [100, 0]],
      },
      {
        id: "pointer",
        type: "arrow",
        x: 20,
        y: 220,
        width: 80,
        height: 30,
        strokeColor: "#9c36b5",
        strokeWidth: 2,
        points: [[0, 0], [40, 20], [80, 0]],
        startArrowhead: null,
        endArrowhead: "arrow",
      },
      {
        id: "ink",
        type: "freedraw",
        x: 15,
        y: 260,
        width: 30,
        height: 12,
        strokeColor: "#212529",
        strokeWidth: 1,
        points: [[0, 0], [10, 8], [30, 2]],
        pressures: [0.2, 0.8, 0.4],
      },
      { id: "photo", type: "image", fileId: "png", x: 400, y: 80, width: 160, height: 90, angle: 0.1, opacity: 100 },
      { id: "scan", type: "image", fileId: "jpeg", x: 420, y: 200, width: 80, height: 60 },
      { id: "again", type: "image", fileId: "png", x: 600, y: 80, width: 40, height: 40 },
      { id: "missing", type: "image", fileId: "absent", x: 8, y: 8, width: 20, height: 20 },
    ],
    appState: { scrollX: -120, scrollY: 30, zoom: { value: 1.25 } },
    files: {
      png: { id: "png", url: PNG, mimeType: "image/png", dataURL: PIXEL },
      jpeg: { id: "jpeg", dataURL: JPEG, mimeType: "image/jpeg" },
    },
  };
}

function shapesOf(records: { typeName?: string; type?: string }[]) {
  return records.filter((record) => record.typeName === "shape");
}

describe("excalidraw snapshot detection", () => {
  it("recognises both formats and ignores broken values", () => {
    expect(isExcalidrawSnapshot(scene())).toBe(true);
    expect(isTldrawSnapshot(scene())).toBe(false);
    expect(isExcalidrawSnapshot({ elements: [], appState: {}, files: {} })).toBe(true);
    expect(isTldrawSnapshot({
      store: { "page:page": { id: "page:page", typeName: "page" } },
      schema: { schemaVersion: 2 },
    })).toBe(true);
    expect(isExcalidrawSnapshot({
      store: { "document:document": { id: "document:document", typeName: "document" } },
      schema: {},
    })).toBe(false);
    for (const value of [null, undefined, "scene", 1, { elements: "no" }, { records: [{ typeName: "nope" }] }]) {
      expect(isTldrawSnapshot(value)).toBe(false);
      expect(isExcalidrawSnapshot(value)).toBe(false);
      expect(convertExcalidrawToTldraw(value)).toEqual([]);
    }
  });
});

describe("convertExcalidrawToTldraw", () => {
  it("keeps text, geometry, ink, arrows and both images", () => {
    const records = convertExcalidrawToTldraw(scene());
    const again = convertExcalidrawToTldraw(scene());
    expect(records.map((record) => record.id)).toEqual(again.map((record) => record.id));

    const shapes = shapesOf(records);
    const box = shapes.find((shape) => shape.id === "shape:excalidraw-box");
    const note = shapes.find((shape) => shape.id === "shape:excalidraw-note");
    const oval = shapes.find((shape) => shape.id === "shape:excalidraw-oval");
    const gem = shapes.find((shape) => shape.id === "shape:excalidraw-gem");
    const rule = shapes.find((shape) => shape.id === "shape:excalidraw-rule");
    const pointer = shapes.find((shape) => shape.id === "shape:excalidraw-pointer");
    const ink = shapes.find((shape) => shape.id === "shape:excalidraw-ink");
    const photo = shapes.find((shape) => shape.id === "shape:excalidraw-photo");
    const scan = shapes.find((shape) => shape.id === "shape:excalidraw-scan");
    const copy = shapes.find((shape) => shape.id === "shape:excalidraw-again");
    expect(shapes.find((shape) => shape.id === "shape:excalidraw-gone")).toBeUndefined();
    expect(shapes.find((shape) => shape.id === "shape:excalidraw-label")).toBeUndefined();
    expect(shapes.find((shape) => shape.id === "shape:excalidraw-missing")).toBeUndefined();

    expect(box).toMatchObject({
      type: "geo",
      x: 40,
      y: 50,
      rotation: 0.4,
      opacity: 0.8,
      props: { geo: "rectangle", w: 120, h: 80, fill: "solid", color: "c1e1e1e", dash: "solid" },
    });
    expect(box?.props.richText.content[0].content[0].text).toBe("Урок");
    expect(note?.props.richText.content.map((block: { content?: { text: string }[] }) => block.content?.[0]?.text || "")).toEqual(["Первая", "строка"]);
    expect(note).toMatchObject({ x: 12, y: 16, rotation: 0.2, props: { font: "draw", textAlign: "start", color: "ce03131" } });
    expect(oval?.props.geo).toBe("ellipse");
    expect(oval?.props.fill).toBe("none");
    expect(gem?.props.geo).toBe("diamond");
    expect(gem?.props.fill).toBe("pattern");
    expect(Object.values(rule?.props.points || {})).toHaveLength(3);
    expect(pointer?.props.arrowheadEnd).toBe("arrow");
    expect(pointer?.props.arrowheadStart).toBe("none");
    expect(pointer?.props.start).toEqual({ x: 0, y: 0 });
    expect(pointer?.props.end).toEqual({ x: 80, y: 0 });
    const decoded = b64Vecs.decodePoints(ink?.props.segments[0].path);
    expect(decoded.map((point: { x: number; y: number }) => [Math.round(point.x), Math.round(point.y)])).toEqual([[0, 0], [10, 8], [30, 2]]);

    const assets = records.filter((record) => record.typeName === "asset");
    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.props.src).sort()).toEqual([PNG, JPEG]);
    expect(photo?.props.assetId).toBe(copy?.props.assetId);
    expect(photo?.props.assetId).not.toBe(scan?.props.assetId);
    expect(photo).toMatchObject({ x: 400, y: 80, rotation: 0.1, props: { w: 160, h: 90 } });

    const indexes = shapes.map((shape) => shape.index);
    const ordered = [...indexes].sort();
    expect(indexes).toEqual(ordered);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("stores records the current tldraw schema accepts", () => {
    const schema = createTLSchema({ shapes: defaultShapeSchemas });
    const store = new Store({ schema, props: {} });
    const records = convertExcalidrawToTldraw(scene());
    records.forEach((record) => store.put([record]));
    expect(store.allRecords().filter((record) => record.typeName === "shape").length).toBe(shapesOf(records).length);
  });

  it("prefers a backend url and falls back to a data url", () => {
    const urlOnly = convertExcalidrawToTldraw({
      elements: [{ id: "img", type: "image", fileId: "f", x: 1, y: 2, width: 3, height: 4 }],
      files: { f: { id: "f", url: PNG, mimeType: "image/png" } },
    });
    expect(urlOnly.find((record) => record.typeName === "asset")?.props.src).toBe(PNG);

    const dataOnly = convertExcalidrawToTldraw({
      elements: [{ id: "img", type: "image", fileId: "f", x: 1, y: 2, width: 3, height: 4 }],
      files: { f: { id: "f", dataURL: PIXEL, mimeType: "image/png" } },
    });
    expect(dataOnly.find((record) => record.typeName === "asset")?.props.src).toBe(PIXEL);
  });
});

describe("loadLegacyExcalidrawScene", () => {
  function editorWith(existing: { id: string; typeName: string; index?: string }[] = []) {
    const put: unknown[] = [];
    let remote = false;
    const setCamera = vi.fn();
    return {
      put,
      setCamera,
      editor: {
        getCurrentPageId: () => "page:page",
        setCamera,
        store: {
          allRecords: () => existing,
          mergeRemoteChanges(fn: () => void) {
            remote = true;
            fn();
            remote = false;
          },
          put(records: unknown[]) {
            if (!remote) throw new Error("import was stored as a user edit");
            put.push(...records);
          },
        },
      },
    };
  }

  it("imports an old scene without marking it as a user edit", () => {
    const { editor, put, setCamera } = editorWith();
    expect(loadLegacyExcalidrawScene(editor, scene())).toBe(true);
    expect(put.some((record) => (record as { id?: string }).id === "shape:excalidraw-note")).toBe(true);
    expect(setCamera).toHaveBeenCalledWith({ x: 120, y: -30, z: 1.25 });
  });

  it("leaves a tldraw document and an empty excalidraw scene untouched", () => {
    const tldraw = editorWith();
    expect(loadLegacyExcalidrawScene(tldraw.editor, {
      store: { "shape:1": { id: "shape:1", typeName: "shape", type: "geo" } },
      schema: { schemaVersion: 2 },
    })).toBe(false);
    expect(tldraw.put).toEqual([]);

    const empty = editorWith();
    expect(loadLegacyExcalidrawScene(empty.editor, { elements: [], appState: {}, files: {} })).toBe(false);
    expect(empty.put).toEqual([]);
    expect(empty.setCamera).not.toHaveBeenCalled();
  });

  it("does not replace shapes that are already on the tldraw board", () => {
    const { editor, put, setCamera } = editorWith([
      { id: "shape:excalidraw-note", typeName: "shape", index: "a1" },
      { id: "shape:new", typeName: "shape", index: "a2" },
    ]);
    expect(loadLegacyExcalidrawScene(editor, scene())).toBe(true);
    expect(put.some((record) => (record as { id?: string }).id === "shape:excalidraw-note")).toBe(false);
    expect(put.some((record) => (record as { id?: string }).id === "shape:excalidraw-box")).toBe(true);
    expect(setCamera).not.toHaveBeenCalled();
    const indexes = put
      .filter((record) => (record as { typeName?: string }).typeName === "shape")
      .map((record) => (record as { index?: string }).index);
    expect(indexes.every((index) => index && index < "a1")).toBe(true);
  });

  it("puts the old scene back after the room document is replaced", () => {
    const stored: { id: string; typeName: string }[] = [];
    let onRemote = () => {};
    const setCamera = vi.fn();
    const editor = {
      getCurrentPageId: () => "page:page",
      setCamera,
      store: {
        allRecords: () => stored,
        mergeRemoteChanges(fn: () => void) {
          fn();
        },
        put(records: { id: string; typeName: string }[]) {
          records.forEach((record) => {
            if (!stored.some((item) => item.id === record.id)) stored.push(record);
          });
        },
        listen(fn: () => void, filters?: { source?: string }) {
          if (filters?.source === "remote") onRemote = fn;
          return () => {};
        },
      },
    };
    const attached = attachLegacyExcalidrawScene(editor, scene());
    expect(attached.restored).toBe(true);
    expect(setCamera).toHaveBeenCalledTimes(1);
    const before = stored.length;
    stored.splice(0, stored.length);
    onRemote();
    expect(stored.length).toBe(before);
    expect(setCamera).toHaveBeenCalledTimes(1);
    attached.dispose();
  });

  it("sends the first edit of an old shape as a full record", () => {
    const before = { id: "shape:excalidraw-note", typeName: "shape", x: 10, y: 20 };
    const moved = { ...before, x: 90 };
    const other = { id: "shape:excalidraw-box", typeName: "shape", x: 1, y: 2 };
    const fresh = { id: "shape:new", typeName: "shape", x: 0, y: 0 };
    const movedFresh = { ...fresh, x: 5 };
    const diff = {
      added: {} as Record<string, unknown>,
      updated: {
        [before.id]: [before, moved],
        [fresh.id]: [fresh, movedFresh],
      } as Record<string, [unknown, unknown]>,
      removed: {} as Record<string, unknown>,
    };
    const client = { unsentChanges: { nextDiff: diff } };
    const editor = { store: { allRecords: () => [moved, other, movedFresh] } };
    const legacyIds = new Set([before.id, other.id]);

    expect(publishLegacyEdits(client, editor, legacyIds)).toBe(true);
    expect(diff.added[before.id]).toEqual(moved);
    expect(diff.added[other.id]).toEqual(other);
    expect(diff.updated[before.id]).toBeUndefined();
    expect(diff.updated[fresh.id]).toEqual([fresh, movedFresh]);

    const untouched = {
      added: {},
      updated: { [fresh.id]: [fresh, movedFresh] },
      removed: {},
    };
    expect(publishLegacyEdits({ unsentChanges: { nextDiff: untouched } }, editor, legacyIds)).toBe(false);
    expect(untouched.updated[fresh.id]).toEqual([fresh, movedFresh]);
  });
});
