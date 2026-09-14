import { describe, expect, it } from "vitest";
import {
  cloneAnnotation,
  createAnnotation,
  normalizeAnnotation,
  pageAnnotations,
  setPageAnnotations,
  toPersistedAnnotation,
} from "./notebookModel";
import { createHistory, replaceAnnotationsCommand } from "./notebookHistory";
import { constrainBox, constrainLine, hitTest, smoothStroke } from "./notebookGeometry";
import { isTypingTarget } from "./useEditorShortcuts";
import { exportScaleForPage } from "./notebookExport";

describe("notebook document model", () => {
  it("gives every annotation a stable UUID, not an index", () => {
    const a = createAnnotation("pen", { points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }, "page-1");
    const b = createAnnotation("pen", { points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }, "page-1");
    expect(a.id).toMatch(/[0-9a-f-]{8,}/i);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe("0");
  });

  it("keeps annotations as objects until persist, and copies stroke onto color for backend", () => {
    const raw = normalizeAnnotation({
      type: "arrow",
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      stroke: "#2563EB",
      strokeWidth: 4,
    }, "p1");
    expect(raw.stroke).toBe("#2563EB");
    expect(toPersistedAnnotation(raw).color).toBe("#2563EB");
    expect(toPersistedAnnotation(raw).width).toBe(4);
  });

  it("cloneAnnotation uses a new id and offsets geometry", () => {
    const src = createAnnotation("rect", { x: 10, y: 10, w: 20, h: 20 }, "p1");
    const copy = cloneAnnotation(src, 16, 16);
    expect(copy.id).not.toBe(src.id);
    expect(copy.x).toBe(26);
    expect(copy.y).toBe(26);
  });

  it("replaces annotations on the matching page only", () => {
    const doc = {
      pages: [
        { id: "a", state: { objects: [{ id: "1", type: "text", text: "a" }] } },
        { id: "b", state: { objects: [{ id: "2", type: "text", text: "b" }] } },
      ],
    };
    const next = setPageAnnotations(doc, "b", [{ id: "3", type: "text", text: "c" }]);
    expect(pageAnnotations(next.pages[0])[0].id).toBe("1");
    expect(pageAnnotations(next.pages[1])[0].text).toBe("c");
  });
});

describe("notebook command history", () => {
  it("undo/redo restores objects as one operation", () => {
    const history = createHistory();
    let doc = { pages: [{ id: "p", state: { objects: [] } }] };
    const after = [{ id: "s1", type: "pen", points: [{ x: 0, y: 0 }, { x: 2, y: 2 }] }];
    history.push(replaceAnnotationsCommand("p", [], after, "ADD_ANNOTATION"));
    doc = history.undo(doc);
    expect(pageAnnotations(doc.pages[0])).toEqual([]);
    doc = history.redo(doc);
    expect(pageAnnotations(doc.pages[0])[0].id).toBe("s1");
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });
});

describe("notebook geometry", () => {
  it("smooths a stroke without dropping endpoints", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 10 },
    ];
    const smooth = smoothStroke(pts, 1);
    expect(smooth[0]).toEqual(pts[0]);
    expect(smooth[smooth.length - 1]).toEqual(pts[2]);
    expect(smooth.length).toBeGreaterThan(pts.length);
  });

  it("constrains lines to 45° and boxes to squares", () => {
    const end = constrainLine({ x: 0, y: 0 }, { x: 10, y: 1 }, true);
    expect(Math.abs(end.y)).toBeLessThan(0.001);
    const box = constrainBox({ x: 0, y: 0 }, { x: 10, y: 4 }, { shift: true });
    expect(Math.abs(box.w)).toBe(Math.abs(box.h));
  });

  it("hits a pen stroke near its points and ignores far clicks", () => {
    const stroke = { type: "pen", points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], strokeWidth: 3 };
    expect(hitTest(stroke, { x: 25, y: 10 })).toBe(true);
    expect(hitTest(stroke, { x: 25, y: 80 })).toBe(false);
  });
});

describe("editor shortcuts targeting", () => {
  it("does not treat canvas as a typing target", () => {
    const canvas = document.createElement("canvas");
    expect(isTypingTarget(canvas)).toBe(false);
  });

  it("treats textarea and contenteditable as typing targets", () => {
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(div)).toBe(true);
  });
});

describe("export scale", () => {
  it("keeps native photo resolution instead of viewport size", () => {
    const scale = exportScaleForPage(
      { width: 1000, height: 1414 },
      { naturalWidth: 3000, naturalHeight: 4242 },
    );
    expect(scale).toBeGreaterThanOrEqual(3);
    expect(1000 * scale).toBeGreaterThanOrEqual(3000);
  });
});
