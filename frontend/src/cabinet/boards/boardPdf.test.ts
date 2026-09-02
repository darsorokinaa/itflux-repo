import { describe, expect, it } from "vitest";
import {
  buildItfluxPdfMeta,
  createBoardFrameElement,
  dataTransferHasPdf,
  fileLooksLikePdf,
  findPackedPdfSelection,
  frameRectAroundImage,
  getPackedPdfMeta,
  layoutUnpackedPages,
  packedPdfFrameName,
  pdfPageLabel,
  sniffPdfBytes,
  withPackedPdfMeta,
} from "./boardPdf";

describe("boardPdf", () => {
  it("распознаёт PDF по имени, MIME и magic bytes", () => {
    expect(fileLooksLikePdf({ name: "a.pdf", type: "" })).toBe(true);
    expect(fileLooksLikePdf({ name: "a.PNG", type: "image/png" })).toBe(false);
    expect(fileLooksLikePdf({ name: "x", type: "application/pdf" })).toBe(true);
    expect(sniffPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(sniffPdfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("видит PDF в DataTransfer", () => {
    const pdf = new File(["%PDF"], "doc.pdf", { type: "application/pdf" });
    const dt = {
      files: [pdf],
      items: [{ kind: "file", type: "application/pdf", getAsFile: () => pdf }],
    } as unknown as DataTransfer;
    expect(dataTransferHasPdf(dt)).toBe(true);
    expect(dataTransferHasPdf({ files: [], items: [] } as unknown as DataTransfer)).toBe(false);
  });

  it("склоняет подпись страниц и имя фрейма", () => {
    expect(pdfPageLabel(1)).toBe("1 страница");
    expect(pdfPageLabel(2)).toBe("2 страницы");
    expect(pdfPageLabel(5)).toBe("5 страниц");
    expect(pdfPageLabel(21)).toBe("21 страница");
    expect(packedPdfFrameName("урок.pdf", 3)).toBe("урок.pdf · 3 страницы");
  });

  it("читает и пишет customData.itfluxPdf", () => {
    const meta = buildItfluxPdfMeta({
      fileName: "a.pdf",
      pageCount: 8,
      pdfAssetId: "asset-1",
      pdfUrl: "/api/pdf",
    });
    const el = withPackedPdfMeta({ id: "img", type: "image", customData: { keep: 1 } }, meta);
    expect(getPackedPdfMeta(el)).toMatchObject({
      fileName: "a.pdf",
      pageCount: 8,
      pdfAssetId: "asset-1",
      pdfUrl: "/api/pdf",
      unpacked: false,
    });
    expect((el.customData as { keep: number }).keep).toBe(1);
  });

  it("находит packed PDF по картинке и по фрейму", () => {
    const image = withPackedPdfMeta(
      { id: "img", type: "image", x: 10, y: 20, width: 100, height: 80, frameId: "fr" },
      buildItfluxPdfMeta({ fileName: "a.pdf", pageCount: 4, pdfAssetId: "a", pdfUrl: "/p" }),
    );
    const frame = createBoardFrameElement({ id: "fr", name: "a.pdf", x: 0, y: 0, width: 120, height: 110 });
    expect(findPackedPdfSelection([frame, image], { img: true })?.elementId).toBe("img");
    expect(findPackedPdfSelection([frame, image], { fr: true })?.origin).toEqual({
      x: 0, y: 0, width: 120, height: 110,
    });
    expect(findPackedPdfSelection([frame, image], { other: true })).toBeNull();
  });

  it("раскладывает страницы сеткой справа от документа", () => {
    const rects = layoutUnpackedPages(
      [{ width: 80, height: 100 }, { width: 80, height: 100 }, { width: 80, height: 100 }],
      { x: 0, y: 10, width: 50, height: 40 },
      { gap: 10, columns: 2 },
    );
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 60, y: 10, width: 80, height: 100 });
    expect(rects[1]).toEqual({ x: 150, y: 10, width: 80, height: 100 });
    expect(rects[2]).toEqual({ x: 60, y: 120, width: 80, height: 100 });
  });

  it("строит фрейм вокруг превью", () => {
    expect(frameRectAroundImage({ x: 40, y: 50, width: 100, height: 80 }, 10, 20)).toEqual({
      x: 30,
      y: 30,
      width: 120,
      height: 110,
    });
  });
});
