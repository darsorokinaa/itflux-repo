import { describe, expect, it, vi } from "vitest";
import {
  BOARD_STROKE_WIDTH_PANEL_TESTID,
  createBoardStrokeWidthPanel,
  findBoardStrokeWidthFieldset,
  insertBoardStrokeWidthPanel,
} from "./boardStrokeWidthToolbar";

describe("boardStrokeWidthToolbar", () => {
  it("ставит slider в fieldset толщины вместо трёх кнопок", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="selected-shape-actions">
        <fieldset>
          <legend>Толщина штриха</legend>
          <div class="buttonList">
            <label><input type="radio" data-testid="strokeWidth-thin" /></label>
            <label><input type="radio" data-testid="strokeWidth-bold" /></label>
            <label><input type="radio" data-testid="strokeWidth-extraBold" /></label>
          </div>
        </fieldset>
      </div>
    `;
    const fieldset = findBoardStrokeWidthFieldset(root);
    expect(fieldset).toBeTruthy();
    const setWidth = vi.fn();
    const { node, destroy } = createBoardStrokeWidthPanel({ getWidth: () => 4, setWidth });
    insertBoardStrokeWidthPanel(fieldset!, node);
    insertBoardStrokeWidthPanel(fieldset!, createBoardStrokeWidthPanel({ getWidth: () => 1, setWidth: () => {} }).node);
    expect(fieldset!.querySelectorAll(`[data-testid="${BOARD_STROKE_WIDTH_PANEL_TESTID}"]`)).toHaveLength(1);
    const slider = node.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(Number(slider.value)).toBe(100);
    expect(node.textContent).toContain("0");
    expect(node.textContent).toContain("100");
    slider.value = "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setWidth).toHaveBeenCalled();
    expect(setWidth.mock.calls[0][0]).toBeLessThan(1);
    destroy();
  });

  it("находит fieldset толщины даже вне selected-shape-actions", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <fieldset>
        <legend>Stroke</legend>
        <input type="radio" data-testid="strokeWidth-thin" />
      </fieldset>
    `;
    expect(findBoardStrokeWidthFieldset(root)?.querySelector("legend")?.textContent).toBe("Stroke");
  });
});
