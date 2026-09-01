import { describe, expect, it } from "vitest";
import {
  applyFloatingResize,
  clampFloatingBox,
  readFloatingLayout,
} from "./useFloatingDrag";

describe("useFloatingDrag layout", () => {
  it("reads old position-only storage and new size", () => {
    expect(readFloatingLayout({ left: 10, top: 20 })).toEqual({ left: 10, top: 20 });
    expect(readFloatingLayout({ left: 10, top: 20, width: 300, height: 180 })).toEqual({
      left: 10,
      top: 20,
      width: 300,
      height: 180,
    });
    expect(readFloatingLayout({ width: 200, height: 120 })).toEqual({ width: 200, height: 120 });
    expect(readFloatingLayout(null)).toBeNull();
  });

  it("clamps a box inside the viewport and min size", () => {
    const next = clampFloatingBox(
      { left: -40, top: 900, width: 40, height: 40 },
      { width: 800, height: 600 },
      160,
      120,
    );
    expect(next.width).toBe(160);
    expect(next.height).toBe(120);
    expect(next.left).toBe(8);
    expect(next.top).toBe(600 - 120 - 8);
  });

  it("grows and shrinks from the south-east corner", () => {
    const grown = applyFloatingResize({
      edge: "se",
      origLeft: 100,
      origTop: 80,
      origWidth: 200,
      origHeight: 160,
      dx: 80,
      dy: 40,
      viewport: { width: 1000, height: 800 },
      minWidth: 160,
      minHeight: 120,
    });
    expect(grown).toEqual({ left: 100, top: 80, width: 280, height: 200 });

    const shrunk = applyFloatingResize({
      edge: "se",
      origLeft: 100,
      origTop: 80,
      origWidth: 200,
      origHeight: 160,
      dx: -80,
      dy: -80,
      viewport: { width: 1000, height: 800 },
      minWidth: 160,
      minHeight: 120,
    });
    expect(shrunk).toEqual({ left: 100, top: 80, width: 160, height: 120 });
  });

  it("keeps the opposite corner fixed when resizing from the north-west", () => {
    const next = applyFloatingResize({
      edge: "nw",
      origLeft: 200,
      origTop: 180,
      origWidth: 240,
      origHeight: 180,
      dx: -40,
      dy: -30,
      viewport: { width: 1000, height: 800 },
      minWidth: 160,
      minHeight: 120,
    });
    expect(next.width).toBe(280);
    expect(next.height).toBe(210);
    expect(next.left).toBe(160);
    expect(next.top).toBe(150);
  });
});
