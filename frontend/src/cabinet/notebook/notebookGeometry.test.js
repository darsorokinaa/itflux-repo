import { describe, expect, it } from "vitest";
import { PAGE_HEIGHT, PAGE_WIDTH, clientToPage, newObjectId } from "./notebookGeometry";

describe("notebook page coordinates", () => {
  it("maps screen clicks into the logical page, independent of viewport size", () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 707 }),
    };
    const page = { width: PAGE_WIDTH, height: PAGE_HEIGHT };
    const mid = clientToPage({ clientX: 250, clientY: 353.5 }, canvas, page);
    expect(mid.x).toBeCloseTo(500, 0);
    expect(mid.y).toBeCloseTo(707, 0);
  });

  it("creates stable unique object ids", () => {
    const a = newObjectId();
    const b = newObjectId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
