import { describe, expect, it } from "vitest";
import {
  fileLooksLikeBoardImage,
  isAllowedBoardImageMime,
  isHeicMime,
  normalizeBoardImageMime,
  resolveBoardImageMime,
  sniffBoardImageMime,
} from "./boardImageMime";

function pngHeader(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

function jpegHeader(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function heicHeader(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  return bytes;
}

describe("boardImageMime", () => {
  it("нормализует image/jpg и пустой MIME", () => {
    expect(normalizeBoardImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeBoardImageMime("image/pjpeg")).toBe("image/jpeg");
    expect(normalizeBoardImageMime("")).toBe("");
    expect(normalizeBoardImageMime("application/octet-stream")).toBe("");
  });

  it("sniff определяет png/jpeg/heic по magic bytes", () => {
    expect(sniffBoardImageMime(pngHeader())).toBe("image/png");
    expect(sniffBoardImageMime(jpegHeader())).toBe("image/jpeg");
    expect(sniffBoardImageMime(heicHeader())).toBe("image/heic");
    expect(isHeicMime("image/heif")).toBe(true);
  });

  it("resolve берёт sniff, если type пустой", () => {
    expect(resolveBoardImageMime("", jpegHeader())).toBe("image/jpeg");
    expect(resolveBoardImageMime("image/jpg", pngHeader())).toBe("image/jpeg");
    expect(isAllowedBoardImageMime("image/jpeg")).toBe(true);
    expect(isAllowedBoardImageMime("image/heic")).toBe(false);
  });

  it("r83: GIF по сигнатуре, загружаемые форматы и расширения", async () => {
    const m = await import("./boardImageMime");
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
    expect(sniffBoardImageMime(gif)).toBe("image/gif");
    expect(resolveBoardImageMime("", gif)).toBe("image/gif");
    expect(m.isUploadableBoardImageMime("image/gif")).toBe(true);
    expect(m.isUploadableBoardImageMime("image/heic")).toBe(true);
    expect(m.isUploadableBoardImageMime("image/svg+xml")).toBe(false);
    expect(m.boardImageExtForMime("image/jpeg")).toBe("jpg");
    expect(m.boardImageExtForMime("image/heic")).toBe("heic");
    expect(m.boardImageExtForMime("")).toBe("png");
  });

  it("fileLooksLikeBoardImage по имени, если type пустой", () => {
    expect(fileLooksLikeBoardImage({ type: "", name: "IMG_0001.JPG" })).toBe(true);
    expect(fileLooksLikeBoardImage({ type: "", name: "note.txt" })).toBe(false);
  });
});
