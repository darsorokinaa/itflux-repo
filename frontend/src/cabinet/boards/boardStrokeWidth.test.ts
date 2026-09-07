import { describe, expect, it } from "vitest";
import {
  BOARD_STROKE_WIDTH_DEFAULT,
  BOARD_STROKE_WIDTH_LEGACY_MIN,
  BOARD_STROKE_WIDTH_MAX,
  BOARD_STROKE_WIDTH_MIN,
  applyStrokeWidthToScene,
  clampBoardStrokeWidth,
  sliderToStrokeWidth,
  strokeWidthPreviewPx,
  strokeWidthToSlider,
  withBoardStrokeWidthDefault,
} from "./boardStrokeWidth";

describe("boardStrokeWidth", () => {
  it("uses a minimum noticeably below Excalidraw thin=1", () => {
    expect(BOARD_STROKE_WIDTH_MIN).toBeLessThan(BOARD_STROKE_WIDTH_LEGACY_MIN);
    expect(BOARD_STROKE_WIDTH_DEFAULT).toBeLessThan(BOARD_STROKE_WIDTH_LEGACY_MIN);
    expect(BOARD_STROKE_WIDTH_MAX).toBe(4);
  });

  it("clamps to editor units and keeps saved in-range values", () => {
    expect(clampBoardStrokeWidth(1)).toBe(1);
    expect(clampBoardStrokeWidth(2)).toBe(2);
    expect(clampBoardStrokeWidth(4)).toBe(4);
    expect(clampBoardStrokeWidth(0)).toBe(BOARD_STROKE_WIDTH_MIN);
    expect(clampBoardStrokeWidth(99)).toBe(BOARD_STROKE_WIDTH_MAX);
    expect(withBoardStrokeWidthDefault(undefined)).toBe(BOARD_STROKE_WIDTH_DEFAULT);
    expect(withBoardStrokeWidthDefault(1)).toBe(1);
  });

  it("maps the slider continuously, not to three presets", () => {
    const values = [0, 25, 50, 75, 100].map((t) => sliderToStrokeWidth(t));
    expect(values[0]).toBe(BOARD_STROKE_WIDTH_MIN);
    expect(values[4]).toBe(BOARD_STROKE_WIDTH_MAX);
    const unique = new Set(values);
    expect(unique.size).toBe(5);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    expect(strokeWidthToSlider(BOARD_STROKE_WIDTH_MIN)).toBe(0);
    expect(strokeWidthToSlider(BOARD_STROKE_WIDTH_MAX)).toBe(100);
  });

  it("gives a visible preview that grows with width", () => {
    expect(strokeWidthPreviewPx(BOARD_STROKE_WIDTH_MIN)).toBeLessThan(
      strokeWidthPreviewPx(BOARD_STROKE_WIDTH_MAX),
    );
  });

  it("updates selected elements without touching others", () => {
    const elements = [
      { id: "a", type: "freedraw", strokeWidth: 1, version: 1 },
      { id: "b", type: "rectangle", strokeWidth: 2, version: 3 },
      { id: "c", type: "text", fontSize: 16, version: 1 },
    ];
    const next = applyStrokeWidthToScene({
      elements,
      selectedIds: ["a", "c"],
      width: 0.4,
    }) as Record<string, unknown>[];
    expect(next).not.toBeNull();
    expect(next[0].strokeWidth).toBe(0.4);
    expect(Number(next[0].version)).toBe(2);
    expect(next[1]).toBe(elements[1]);
    expect(next[2]).toBe(elements[2]);
  });

  it("does not rewrite the scene when nothing selected", () => {
    expect(applyStrokeWidthToScene({ elements: [{ id: "a", strokeWidth: 1 }], selectedIds: [], width: 2 })).toBeNull();
  });
});
