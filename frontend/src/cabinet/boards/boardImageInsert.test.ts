import { describe, expect, it } from "vitest";
import {
  BOARD_IMAGE_FORMAT_ERROR,
  createBoardImageElement,
  imageElementNeedsViewportFix,
  isBoardImageFileInput,
  patchedImageInViewport,
  prepareBoardImageFile,
} from "./boardImageInsert";

describe("boardImageInsert", () => {
  it("createBoardImageElement даёт ненулевой rect и fileId", () => {
    const el = createBoardImageElement({
      fileId: "f1",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(el.type).toBe("image");
    expect(el.fileId).toBe("f1");
    expect(el.width).toBe(100);
    expect(el.height).toBe(50);
    expect(el.status).toBe("saved");
    expect(el.frameId).toBeNull();
  });

  it("createBoardImageElement сохраняет frameId и customData", () => {
    const el = createBoardImageElement({
      fileId: "f2",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      frameId: "fr1",
      customData: { itfluxPdf: { fileName: "a.pdf" } },
    });
    expect(el.frameId).toBe("fr1");
    expect(el.customData).toEqual({ itfluxPdf: { fileName: "a.pdf" } });
  });

  it("imageElementNeedsViewportFix ловит 0×0 и координаты вне viewport", () => {
    const appState = { scrollX: 0, scrollY: 0, zoom: 1, width: 400, height: 300 };
    const host = { getBoundingClientRect: () => ({ width: 400, height: 300 }) } as unknown as Element;
    expect(imageElementNeedsViewportFix({
      type: "image",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }, appState, host)).toBe(true);
    expect(imageElementNeedsViewportFix({
      type: "image",
      x: 8000,
      y: 8000,
      width: 40,
      height: 40,
    }, appState, host)).toBe(true);
    expect(imageElementNeedsViewportFix({
      type: "image",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    }, appState, host)).toBe(false);
  });

  it("patchedImageInViewport центрирует элемент без zoom всей доски", () => {
    const appState = { scrollX: 100, scrollY: 50, zoom: 1, width: 200, height: 100 };
    const host = { getBoundingClientRect: () => ({ width: 200, height: 100 }) } as unknown as Element;
    const next = patchedImageInViewport(
      { id: "img", type: "image", fileId: "f1", x: 9999, y: 9999, width: 10, height: 10, version: 1 },
      40,
      20,
      appState,
      host,
    );
    expect(next.x).toBe(-100 + (200 - 40) / 2);
    expect(next.y).toBe(-50 + (100 - 20) / 2);
    expect(next.width).toBe(40);
    expect(next.height).toBe(20);
  });

  it("isBoardImageFileInput принимает скрытый input с PDF", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,.pdf,application/pdf";
    expect(isBoardImageFileInput(input)).toBe(true);
  });

  it("prepareBoardImageFile отклоняет пустой файл и неизвестный формат", async () => {
    const empty = await prepareBoardImageFile(new File([], "empty.png", { type: "image/png" }));
    expect(empty.ok).toBe(false);

    const junk = await prepareBoardImageFile(
      new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "a.bin", { type: "" }),
    );
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.message).toBe(BOARD_IMAGE_FORMAT_ERROR);
  });
});
