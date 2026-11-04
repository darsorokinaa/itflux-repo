import { describe, expect, it } from "vitest";
import { boardHeaderBottom, floatingTopBelowBoard } from "./boardHeaderInset";

const el = (r) => ({ getBoundingClientRect: () => r });
const doc = (map) => ({ querySelectorAll: (sel) => map[sel] || [] });

describe("r149 board header inset", () => {
  it("no board → fallback top", () => {
    expect(boardHeaderBottom(doc({}))).toBe(0);
    expect(floatingTopBelowBoard(0, 16)).toBe(16);
  });
  it("desktop head and mobile switch → below the lowest", () => {
    const d = doc({
      ".vb-panel:not(.vb-panel--hidden) .vb-panel-head": [el({ bottom: 47.2, width: 600, height: 47 })],
      ".vb-tabs": [el({ bottom: 0, width: 0, height: 0 })],
      ".vb-panel:not(.vb-panel--hidden) .vb-board-body > .vb-switch": [el({ bottom: 84, width: 180, height: 30 })],
    });
    expect(boardHeaderBottom(d)).toBe(84);
    expect(floatingTopBelowBoard(84, 16)).toBe(92);
  });
});
