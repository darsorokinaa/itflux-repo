import { describe, expect, it } from "vitest";
import { columnSlices, fitSheet, paginateBlocks, paginateColumns, paginateGrid, placeGrid } from "./worksheetLayout";

describe("paginateBlocks", () => {
  it("moves the next block onto a new page when it does not fit", () => {
    const blocks = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
    ];
    const pages = paginateBlocks(blocks, { a: 100, b: 100 }, { contentHeight: 150, gap: 10, firstUsed: 0 });
    expect(pages.map((page) => page.map((block) => block.id))).toEqual([["a"], ["b"]]);
  });

  it("keeps a heading with the following block", () => {
    const blocks = [
      { id: "h", type: "heading" },
      { id: "t", type: "task" },
    ];
    const pages = paginateBlocks(blocks, { h: 30, t: 40 }, { contentHeight: 200, gap: 10, firstUsed: 150 });
    expect(pages.map((page) => page.map((block) => block.id))).toEqual([[], ["h", "t"]]);
  });

  it("honours an explicit page break and keeps the empty page", () => {
    const blocks = [
      { id: "a", type: "task" },
      { id: "br", type: "page-break" },
      { id: "b", type: "task" },
    ];
    const pages = paginateBlocks(blocks, { a: 40, b: 40 }, { contentHeight: 400, gap: 10, firstUsed: 0 });
    expect(pages.map((page) => page.map((block) => block.id))).toEqual([["a"], ["b"]]);
  });

  it("uses one column while two pages are enough", () => {
    const blocks = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
    ];
    const fit = fitSheet(blocks, { a: 80, b: 80 }, { contentHeight: 200, gap: 10, firstUsed: 0 });
    expect(fit.columns).toBe(1);
    expect(fit.pages.map((page) => page.map((block) => block.id))).toEqual([["a", "b"]]);
  });

  it("switches to two columns when a single column needs a third page", () => {
    const blocks = ["a", "b", "c", "d"].map((id) => ({ id, type: "task" }));
    const heights = { a: 80, b: 80, c: 80, d: 80 };
    const fit = fitSheet(blocks, heights, { contentHeight: 100, gap: 10, firstUsed: 0 });
    expect(fit.columns).toBe(2);
    expect(fit.pages.length).toBeLessThanOrEqual(2);
    expect(fit.pages.flat().map((block) => block.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps full-width theory above the columns", () => {
    const blocks = [
      { id: "h", type: "heading", fullWidth: true },
      { id: "t", type: "text", fullWidth: true },
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
      { id: "d", type: "task" },
    ];
    const heights = { h: 30, t: 50, a: 80, b: 80, c: 80, d: 80 };
    const pages = paginateColumns(blocks, heights, {
      contentHeight: 220,
      columns: 2,
      gap: 10,
      firstUsed: 0,
    });
    expect(pages[0].slice(0, 2).map((block) => block.id)).toEqual(["h", "t"]);
    expect(pages[0].slice(2).map((block) => block.id)).toEqual(["a", "b"]);
    expect(pages[1].map((block) => block.id)).toEqual(["c", "d"]);
  });

  it("fills the left column before the right", () => {
    const blocks = ["a", "b", "c"].map((id) => ({ id, type: "task" }));
    const pages = paginateColumns(blocks, { a: 40, b: 40, c: 40 }, {
      contentHeight: 100,
      columns: 2,
      gap: 10,
      firstUsed: 0,
    });
    const cols = columnSlices(pages[0], { a: 40, b: 40, c: 40 }, {
      columns: 2,
      columnHeight: 100,
      gap: 10,
    });
    expect(cols.map((col) => col.map((block) => block.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("wraps blocks into rows and keeps the gutter", () => {
    const blocks = ["a", "b", "c"].map((id) => ({ id, type: "task" }));
    const pages = paginateGrid(blocks, { a: 40, b: 70, c: 40 }, {
      contentHeight: 200,
      columns: 2,
      gap: 16,
      firstUsed: 0,
    });
    expect(pages.map((page) => page.map((block) => block.id))).toEqual([["a", "b", "c"]]);
    expect(placeGrid(pages[0], 2).map((cell) => [cell.block.id, cell.row, cell.col, cell.span])).toEqual([
      ["a", 1, 1, 1],
      ["b", 1, 2, 1],
      ["c", 2, 1, 1],
    ]);
  });

  it("moves a block to the right column and lets another span the row", () => {
    const blocks = [
      { id: "wide", type: "text", fullWidth: true },
      { id: "left", type: "task", column: 0 },
      { id: "right", type: "task", column: 1 },
    ];
    const cells = placeGrid(blocks, 2);
    expect(cells.map((cell) => [cell.block.id, cell.row, cell.col, cell.span])).toEqual([
      ["wide", 1, 1, 2],
      ["left", 2, 1, 1],
      ["right", 2, 2, 1],
    ]);
  });

  it("does not drop a block that is taller than the page", () => {
    const blocks = [{ id: "tall", type: "task" }];
    const pages = paginateBlocks(blocks, { tall: 800 }, { contentHeight: 400, gap: 10, firstUsed: 0 });
    expect(pages.map((page) => page.map((block) => block.id))).toEqual([["tall"]]);
  });
});
