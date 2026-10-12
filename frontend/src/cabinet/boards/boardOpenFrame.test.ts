import { describe, expect, it, vi } from "vitest";

import {
  cameraFromExcalidrawScroll,
  frameBoardIfContentIsOffscreen,
  viewportMissesContent,
} from "./boardOpenFrame";

describe("cameraFromExcalidrawScroll", () => {
  it("keeps the saved view on the same scene corner", () => {
    const scrollX = -4000;
    const scrollY = -2500;
    const camera = cameraFromExcalidrawScroll(scrollX, scrollY, 1.25);
    const excalidrawCorner = { x: -scrollX, y: -scrollY };
    expect({ x: -camera.x, y: -camera.y }).toEqual(excalidrawCorner);
    expect(camera.z).toBe(1.25);
  });

  it("falls back to zoom 1 when the saved zoom is not usable", () => {
    expect(cameraFromExcalidrawScroll(0, 0, Number.NaN).z).toBe(1);
    expect(cameraFromExcalidrawScroll(0, 0, 0).z).toBe(1);
  });
});

describe("viewportMissesContent", () => {
  const content = { x: 4000, y: 2500, w: 900, h: 700 };

  it("sees materials when the camera matches the excalidraw view", () => {
    const camera = cameraFromExcalidrawScroll(-4000, -2500, 1);
    const view = { x: -camera.x, y: -camera.y, w: 1400, h: 900 };
    expect(viewportMissesContent(view, content)).toBe(false);
  });

  it("misses materials when the camera is mirrored", () => {
    const scrollX = -4000;
    const scrollY = -2500;
    const mirrored = { x: -scrollX, y: -scrollY, w: 1400, h: 900 };
    expect(viewportMissesContent(
      { x: -mirrored.x, y: -mirrored.y, w: mirrored.w, h: mirrored.h },
      content,
    )).toBe(true);
  });

  it("does not treat an unmeasured viewport as a miss", () => {
    expect(viewportMissesContent({ x: 0, y: 0, w: 0, h: 0 }, content)).toBe(false);
    expect(viewportMissesContent(null, content)).toBe(false);
  });
});

describe("frameBoardIfContentIsOffscreen", () => {
  function editorAt(view: { x: number; y: number; w: number; h: number }, following = "") {
    const zoomToFit = vi.fn();
    return {
      zoomToFit,
      editor: {
        getInstanceState: () => ({ followingUserId: following }),
        getCurrentPageBounds: () => ({ x: 4000, y: 2500, w: 900, h: 700 }),
        getViewportPageBounds: () => view,
        zoomToFit,
      },
    };
  }

  it("fits the page when the open camera looks at empty space", () => {
    const { editor, zoomToFit } = editorAt({ x: -4000, y: -2500, w: 1400, h: 900 });
    expect(frameBoardIfContentIsOffscreen(editor)).toBe(true);
    expect(zoomToFit).toHaveBeenCalledWith({ animation: { duration: 0 } });
  });

  it("leaves a camera that already shows the materials", () => {
    const { editor, zoomToFit } = editorAt({ x: 4000, y: 2500, w: 1400, h: 900 });
    expect(frameBoardIfContentIsOffscreen(editor)).toBe(false);
    expect(zoomToFit).not.toHaveBeenCalled();
  });

  it("does not pull the camera away from a followed participant", () => {
    const { editor, zoomToFit } = editorAt({ x: -4000, y: -2500, w: 1400, h: 900 }, "user:2");
    expect(frameBoardIfContentIsOffscreen(editor)).toBe(false);
    expect(zoomToFit).not.toHaveBeenCalled();
  });
});
