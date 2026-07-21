import { describe, expect, it } from "vitest";
import {
  gridAppStatePatch,
  normalizeGridStyle,
  paperOverlayStyle,
  resolveBoardBgColor,
  usesPaperOverlay,
} from "./boardGrid";

describe("boardGrid", () => {
  it("normalizeGridStyle: клетки / линии / точки", () => {
    expect(normalizeGridStyle("cells")).toBe("cells");
    expect(normalizeGridStyle("ruled")).toBe("ruled");
    expect(normalizeGridStyle("dots")).toBe("dots");
    expect(normalizeGridStyle("lines")).toBe("cells");
    expect(normalizeGridStyle(undefined, true)).toBe("cells");
    expect(normalizeGridStyle(undefined, false)).toBe("none");
  });

  it("overlay для клеток/линий/точек, сплошной фон без сетки", () => {
    expect(usesPaperOverlay("cells")).toBe(true);
    expect(usesPaperOverlay("ruled")).toBe(true);
    expect(usesPaperOverlay("dots")).toBe(true);
    expect(usesPaperOverlay("none")).toBe(false);
    expect(gridAppStatePatch("cells", "#fafafa").viewBackgroundColor).toBe("transparent");
    expect(gridAppStatePatch("ruled", "#fafafa").gridSize).toBe(56);
    expect(gridAppStatePatch("none", "#eee").viewBackgroundColor).toBe("#eee");
  });

  it("resolveBoardBgColor не берёт transparent", () => {
    expect(resolveBoardBgColor({ viewBackgroundColor: "transparent", itfluxBgColor: "#abc" })).toBe("#abc");
  });

  it("paperOverlayStyle для линий письма и клеток", () => {
    const ruled = paperOverlayStyle("ruled", {
      zoom: { value: 2 },
      scrollX: 10,
      scrollY: 28,
    });
    expect(ruled.backgroundSize).toBe("100% 112px");
    expect(ruled.backgroundPosition).toBe("0 56px");

    const cells = paperOverlayStyle("cells", {
      zoom: { value: 1 },
      scrollX: 10,
      scrollY: 20,
    });
    expect(cells.backgroundSize).toBe("40px 40px");
    expect(cells.backgroundPosition).toBe("10px 20px");
  });
});
