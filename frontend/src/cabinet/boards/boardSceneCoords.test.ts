import { describe, expect, it } from "vitest";
import { boardClientCoordsFromScene, boardSceneCoordsFromClient, boardZoomValue } from "./boardSceneCoords";

describe("boardSceneCoordsFromClient", () => {
  it("matches Excalidraw viewportCoordsToSceneCoords at 50/100/200% zoom", () => {
    const clientX = 120.5;
    const clientY = 80.25;
    const app = {
      offsetLeft: 10,
      offsetTop: 20,
      scrollX: 4.5,
      scrollY: -2,
    };
    const at = (zoom: number) => boardSceneCoordsFromClient(clientX, clientY, { ...app, zoom: { value: zoom } });
    expect(boardZoomValue({ zoom: { value: 0.5 } })).toBe(0.5);
    expect(boardZoomValue({ zoom: { value: 1 } })).toBe(1);
    expect(boardZoomValue({ zoom: { value: 2 } })).toBe(2);

    expect(at(0.5)).toEqual({
      x: (120.5 - 10) / 0.5 - 4.5,
      y: (80.25 - 20) / 0.5 - -2,
    });
    expect(at(1)).toEqual({
      x: (120.5 - 10) / 1 - 4.5,
      y: (80.25 - 20) / 1 - -2,
    });
    expect(at(2)).toEqual({
      x: (120.5 - 10) / 2 - 4.5,
      y: (80.25 - 20) / 2 - -2,
    });
    expect(at(0.5).x).not.toBe(Math.round(at(0.5).x));
    expect(at(2).y).not.toBe(Math.round(at(2).y));
  });

  it("round-trips client → scene → client at 50/100/200% zoom", () => {
    const app = {
      offsetLeft: 48.25,
      offsetTop: 12.5,
      scrollX: -80,
      scrollY: 33.5,
    };
    const client = { clientX: 412.75, clientY: 208.125 };
    for (const zoom of [0.5, 1, 2]) {
      const scene = boardSceneCoordsFromClient(client.clientX, client.clientY, { ...app, zoom: { value: zoom } });
      const back = boardClientCoordsFromScene(scene.x, scene.y, { ...app, zoom: { value: zoom } });
      expect(back.clientX).toBeCloseTo(client.clientX, 10);
      expect(back.clientY).toBeCloseTo(client.clientY, 10);
    }
  });

  it("does not use bounding-rect math: offsetLeft is not interchangeable with canvas rect.left", () => {
    const app = { zoom: { value: 1 }, offsetLeft: 100, offsetTop: 40, scrollX: 0, scrollY: 0 };
    const scene = boardSceneCoordsFromClient(160, 90, app);
    expect(scene).toEqual({ x: 60, y: 50 });
    const ifUsedCanvasRect = { x: 160 - 20, y: 90 - 8 };
    expect(scene.x).not.toBe(ifUsedCanvasRect.x);
    expect(scene.y).not.toBe(ifUsedCanvasRect.y);
  });

  it("does not shift existing object math when zoom is identity", () => {
    expect(boardSceneCoordsFromClient(40, 60, { zoom: 1, offsetLeft: 0, offsetTop: 0, scrollX: 0, scrollY: 0 })).toEqual({
      x: 40,
      y: 60,
    });
  });
});
