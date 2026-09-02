import { describe, expect, it } from "vitest";
import {
  BOARD_PDF_TOOL_TESTID,
  createBoardPdfToolbarButton,
  findBoardPdfToolbarSlot,
  insertBoardPdfToolbarButton,
} from "./boardPdfToolbar";

describe("boardPdfToolbar", () => {
  it("ставит кнопку сразу после инструмента изображения", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="App-toolbar">
        <label class="ToolIcon" data-testid="toolbar-text">T</label>
        <label class="ToolIcon" data-testid="toolbar-image">I</label>
        <button data-testid="extra-tools-icon">+</button>
      </div>
    `;
    const slot = findBoardPdfToolbarSlot(root);
    expect(slot?.after?.getAttribute("data-testid")).toBe("toolbar-image");
    const button = createBoardPdfToolbarButton(() => {});
    insertBoardPdfToolbarButton(slot!, button);
    const tools = Array.from(root.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid"));
    expect(tools).toEqual(["toolbar-text", "toolbar-image", BOARD_PDF_TOOL_TESTID, "extra-tools-icon"]);
  });

  it("на мобильном тулбаре предпочитает App-toolbar--mobile", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="App-toolbar"><label data-testid="toolbar-image">desk</label></div>
      <div class="App-toolbar--mobile"><label data-testid="toolbar-image">mob</label></div>
    `;
    const slot = findBoardPdfToolbarSlot(root);
    expect(slot?.toolbar.classList.contains("App-toolbar--mobile")).toBe(true);
    expect(slot?.after?.textContent).toBe("mob");
  });

  it("не дублирует кнопку", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="App-toolbar"><label data-testid="toolbar-image">I</label></div>`;
    const slot = findBoardPdfToolbarSlot(root)!;
    insertBoardPdfToolbarButton(slot, createBoardPdfToolbarButton(() => {}));
    insertBoardPdfToolbarButton(slot, createBoardPdfToolbarButton(() => {}));
    expect(root.querySelectorAll(`[data-testid="${BOARD_PDF_TOOL_TESTID}"]`)).toHaveLength(1);
  });
});
