import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import NotebookCanvas from "./NotebookCanvas";
import { TOOL } from "./notebookModel";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {},
    fill() {},
    closePath() {},
    strokeRect() {},
    fillRect() {},
    fillText() {},
    ellipse() {},
    translate() {},
    rotate() {},
    setLineDash() {},
    rect() {},
    arc() {},
  }));
});

function pagePoint(canvas, x, y) {
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1414, right: 1000, bottom: 1414 });
  return { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, pressure: 0.5 };
}

describe("NotebookCanvas pointer smoke", () => {
  it("commits one pen stroke as a single annotation", () => {
    const onCommit = vi.fn();
    const page = { id: "p1", width: 1000, height: 1414 };
    const { container } = render(
      <NotebookCanvas
        page={page}
        objects={[]}
        tool={TOOL.PEN}
        color="#DC2626"
        strokeWidth={3}
        selectedIds={[]}
        onSelectIds={() => {}}
        onObjectsCommit={onCommit}
      />,
    );
    const canvas = container.querySelector("canvas");
    fireEvent.pointerDown(canvas, pagePoint(canvas, 10, 10));
    fireEvent.pointerMove(canvas, pagePoint(canvas, 40, 50));
    fireEvent.pointerMove(canvas, pagePoint(canvas, 80, 90));
    fireEvent.pointerUp(canvas, pagePoint(canvas, 80, 90));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [objects, historyType] = onCommit.mock.calls[0];
    expect(historyType).toBe("ADD_ANNOTATION");
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("pen");
    expect(objects[0].points.length).toBeGreaterThan(1);
    expect(objects[0].id).not.toBe("0");
  });

  it("opens an inline text editor instead of window.prompt", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const page = { id: "p1", width: 1000, height: 1414 };
    const { container } = render(
      <NotebookCanvas
        page={page}
        objects={[]}
        tool={TOOL.TEXT}
        color="#111827"
        fontSize={24}
        selectedIds={[]}
        onSelectIds={() => {}}
        onObjectsCommit={() => {}}
      />,
    );
    const canvas = container.querySelector("canvas");
    fireEvent.pointerDown(canvas, pagePoint(canvas, 100, 120));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeTruthy();
    promptSpy.mockRestore();
  });
});
