/** Isolated pdf.js worker bootstrap — not coupled to the board renderer. */

import { getDocument, GlobalWorkerOptions, PDFWorker } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

let pdfWorker = null;

export function ensureMaterialPdfWorker() {
  if (pdfWorker && !pdfWorker.destroyed) return pdfWorker;
  try {
    pdfWorker = new PDFWorker({ port: new PdfJsWorker() });
    return pdfWorker;
  } catch {
    GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    pdfWorker = new PDFWorker();
    return pdfWorker;
  }
}

export function openMaterialPdf(url) {
  const worker = ensureMaterialPdfWorker();
  return getDocument({
    url,
    withCredentials: true,
    worker,
  });
}
