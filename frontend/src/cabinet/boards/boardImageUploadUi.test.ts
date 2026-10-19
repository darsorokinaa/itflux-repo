import { describe, expect, it } from "vitest";
import { fileNeedsBoardImageInterception, uploadErrorMessage } from "./boardImageUploadUi";

describe("boardImageUploadUi", () => {
  it("перехватывает HEIC, GIF и файлы без типа", () => {
    expect(fileNeedsBoardImageInterception({ type: "image/heic", name: "IMG_1.HEIC" })).toBe(true);
    expect(fileNeedsBoardImageInterception({ type: "", name: "IMG_1.HEIC" })).toBe(true);
    expect(fileNeedsBoardImageInterception({ type: "image/gif", name: "a.gif" })).toBe(true);
    expect(fileNeedsBoardImageInterception({ type: "", name: "image" })).toBe(true);
    expect(fileNeedsBoardImageInterception({ type: "image/png", name: "image.png" })).toBe(false);
    expect(fileNeedsBoardImageInterception({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
    expect(fileNeedsBoardImageInterception({ type: "application/pdf", name: "a.pdf" })).toBe(false);
  });

  it("показывает detail сервера вместо общего текста", () => {
    const err = Object.assign(new Error("x"), { data: { detail: "SVG не поддерживается." } });
    expect(uploadErrorMessage(err, "fallback")).toBe("SVG не поддерживается.");
    expect(uploadErrorMessage(new Error("Формат HEIC не поддерживается"), "fb")).toBe("Формат HEIC не поддерживается");
    expect(uploadErrorMessage(new Error("Failed to fetch"), "fb")).toBe("fb");
    expect(uploadErrorMessage(null, "fb")).toBe("fb");
  });
});
