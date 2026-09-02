import { describe, expect, it } from "vitest";
import { isEraserTool, restoreImagesErasedByEraser } from "./boardImageErase";

describe("boardImageErase", () => {
  it("распознаёт инструмент ластика", () => {
    expect(isEraserTool({ activeTool: { type: "eraser" } })).toBe(true);
    expect(isEraserTool({ activeTool: { type: "selection" } })).toBe(false);
    expect(isEraserTool({})).toBe(false);
  });

  it("возвращает стёртую картинку при ластике и не трогает обычное удаление", () => {
    const image = { id: "img", type: "image", isDeleted: false, version: 2 };
    const stroke = { id: "draw", type: "freedraw", isDeleted: false, version: 1 };

    const erased = restoreImagesErasedByEraser(
      [image, stroke],
      [{ ...image, isDeleted: true, version: 3 }, { ...stroke, isDeleted: true, version: 2 }],
      { activeTool: { type: "eraser" } },
    );
    expect(erased.restored).toBe(true);
    const restoredImg = erased.elements.find((raw) => (raw as { id?: string }).id === "img") as { isDeleted?: boolean; version?: number };
    const restoredStroke = erased.elements.find((raw) => (raw as { id?: string }).id === "draw") as { isDeleted?: boolean };
    expect(restoredImg.isDeleted).toBe(false);
    expect(restoredImg.version).toBe(2);
    expect(restoredStroke.isDeleted).toBe(true);

    const deleted = restoreImagesErasedByEraser(
      [image],
      [{ ...image, isDeleted: true, version: 3 }],
      { activeTool: { type: "selection" } },
    );
    expect(deleted.restored).toBe(false);
    expect((deleted.elements[0] as { isDeleted?: boolean }).isDeleted).toBe(true);
  });

  it("не трогает уже удалённые картинки", () => {
    const image = { id: "img", type: "image", isDeleted: true, version: 4 };
    const next = restoreImagesErasedByEraser(
      [image],
      [{ ...image }],
      { activeTool: { type: "eraser" } },
    );
    expect(next.restored).toBe(false);
  });

  it("не выкидывает только что добавленную картинку", () => {
    const old = { id: "img", type: "image", isDeleted: false, version: 2 };
    const added = { id: "new", type: "image", isDeleted: false, version: 1 };
    const next = restoreImagesErasedByEraser(
      [old],
      [old, added],
      { activeTool: { type: "selection" } },
    );
    expect(next.restored).toBe(false);
    expect((next.elements as { id?: string }[]).map((el) => el.id)).toEqual(["img", "new"]);
  });
});
