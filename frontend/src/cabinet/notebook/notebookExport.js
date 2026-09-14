import { PAGE_HEIGHT, PAGE_WIDTH } from "./notebookGeometry";
import { drawAnnotation } from "./notebookRender";

function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function exportScaleForPage(page, image) {
  const logicalW = page?.width || PAGE_WIDTH;
  const logicalH = page?.height || PAGE_HEIGHT;
  const nativeW = image?.naturalWidth || 0;
  const nativeH = image?.naturalHeight || 0;
  const fromImage = Math.max(nativeW / logicalW, nativeH / logicalH, 0);
  return Math.min(4, Math.max(2, fromImage || 2));
}

export async function renderPageToCanvas(page, objects, { backgroundUrl, pdfCanvas } = {}) {
  const width = page?.width || PAGE_WIDTH;
  const height = page?.height || PAGE_HEIGHT;
  const image = pdfCanvas || await loadImage(backgroundUrl);
  const scale = exportScaleForPage(page, image);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const fit = Math.min(canvas.width / iw, canvas.height / ih);
    const dw = iw * fit;
    const dh = ih * fit;
    ctx.drawImage(image, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }
  ctx.save();
  ctx.scale(scale, scale);
  for (const obj of objects || []) {
    drawAnnotation(ctx, obj);
  }
  ctx.restore();
  return canvas;
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function exportNotebookBlobs(pages, {
  backgroundUrlForPage,
  pdfCanvasForPage,
} = {}) {
  const blobs = [];
  for (const page of pages || []) {
    const objects = Array.isArray(page?.state?.objects) ? page.state.objects : [];
    const canvas = await renderPageToCanvas(page, objects, {
      backgroundUrl: backgroundUrlForPage?.(page) || page.background_url || page.source_attachment?.url || "",
      pdfCanvas: pdfCanvasForPage?.(page) || null,
    });
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    blobs.push(blob);
  }
  return blobs;
}
