/** Клиентский рендер PDF-страниц через pdf.js. */

import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  BOARD_PDF_FORMAT_ERROR,
  BOARD_PDF_INSERT_ERROR,
  MAX_BOARD_PDF_BYTES,
  MAX_BOARD_PDF_PAGES,
  sniffPdfBytes,
} from "./boardPdf";

const RENDER_SCALE = 1.6;
const MAX_PAGE_EDGE = 1600;
const JPEG_QUALITY = 0.86;

export type OpenedBoardPdf = {
  doc: pdfjs.PDFDocumentProxy;
  pageCount: number;
  truncated: boolean;
};

export type RenderedPdfPage = {
  pageNumber: number;
  blob: Blob;
  width: number;
  height: number;
};

let workerReady = false;

function ensureWorker(): typeof pdfjs {
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    workerReady = true;
  }
  return pdfjs;
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
    });
  }
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  }
}

export async function openBoardPdf(source: Blob | ArrayBuffer): Promise<
  | { ok: true; opened: OpenedBoardPdf }
  | { ok: false; reason: "empty" | "size" | "format"; message: string }
> {
  let bytes: Uint8Array;
  try {
    const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } catch {
    return { ok: false, reason: "format", message: BOARD_PDF_INSERT_ERROR };
  }
  if (!bytes.length) {
    return { ok: false, reason: "empty", message: BOARD_PDF_INSERT_ERROR };
  }
  if (bytes.byteLength > MAX_BOARD_PDF_BYTES) {
    return { ok: false, reason: "size", message: "PDF слишком большой (макс. 20 МБ)" };
  }
  if (!sniffPdfBytes(bytes)) {
    return { ok: false, reason: "format", message: BOARD_PDF_FORMAT_ERROR };
  }

  try {
    const lib = ensureWorker();
    const task = lib.getDocument({
      data: bytes.slice(),
      disableAutoFetch: true,
      disableStream: true,
    });
    const doc = await task.promise;
    const pageCount = Math.max(1, Number(doc.numPages) || 1);
    const truncated = pageCount > MAX_BOARD_PDF_PAGES;
    return {
      ok: true,
      opened: {
        doc,
        pageCount: Math.min(pageCount, MAX_BOARD_PDF_PAGES),
        truncated,
      },
    };
  } catch {
    return { ok: false, reason: "format", message: BOARD_PDF_FORMAT_ERROR };
  }
}

export async function renderBoardPdfPage(
  doc: pdfjs.PDFDocumentProxy,
  pageNumber: number,
): Promise<RenderedPdfPage> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      RENDER_SCALE,
      MAX_PAGE_EDGE / Math.max(1, base.width),
      MAX_PAGE_EDGE / Math.max(1, base.height),
    );
    const viewport = page.getViewport({ scale: Math.max(0.4, scale) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("pdf_canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToJpeg(canvas);
    if (!blob || blob.size <= 0) throw new Error("pdf_encode");
    return {
      pageNumber,
      blob,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    page.cleanup();
  }
}

export async function closeBoardPdf(doc: pdfjs.PDFDocumentProxy | null | undefined): Promise<void> {
  if (!doc) return;
  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
}
