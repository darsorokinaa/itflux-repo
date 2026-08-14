/** Хелперы экспорта доски (без зависимости от React). */

import {
  GRID_STYLE_KEY,
  normalizeGridStyle,
  resolveBoardBgColor,
  usesPaperOverlay,
  type BoardGridStyle,
} from "./boardGrid";

/** Чуть ниже лимита API (200_000), чтобы JSON PATCH не раздувался. */
export const MAX_THUMBNAIL_DATA_URL_CHARS = 180_000;

/** Шаг бумаги на крошечном превью (как у плейсхолдера карточки). */
const THUMBNAIL_PAPER_STEP = 16;

export function boardFileSlug(title: string): string {
  const base = (title || "board").trim() || "board";
  return base
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

type ThumbnailApi = {
  getSceneElements: () => Array<{ isDeleted?: boolean } & Record<string, unknown>>;
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
};

type ThumbnailScene = {
  elements?: Array<{ isDeleted?: boolean } & Record<string, unknown>>;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

function resolveThumbnailSource(source: ThumbnailApi | ThumbnailScene | null | undefined): ThumbnailScene | null {
  if (!source) return null;
  if (typeof (source as ThumbnailApi).getSceneElements === "function") {
    const api = source as ThumbnailApi;
    return {
      elements: api.getSceneElements() || [],
      appState: api.getAppState() || {},
      files: api.getFiles() || {},
    };
  }
  return source as ThumbnailScene;
}

/**
 * Excalidraw в тёмной теме и с transparent-холстом (бумага — CSS-оверлей)
 * экспортирует JPEG почти чёрным. Для превью берём цвет бумаги и светлую тему.
 */
export function buildThumbnailExportAppState(
  appState: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const paper = resolveBoardBgColor(appState);
  return {
    ...(appState || {}),
    viewBackgroundColor: paper,
    exportBackground: true,
    exportWithDarkMode: false,
    theme: "light",
  };
}

export function paintThumbnailPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: BoardGridStyle,
  bgColor: string,
) {
  ctx.fillStyle = bgColor || "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (!usesPaperOverlay(style)) return;

  const step = THUMBNAIL_PAPER_STEP;
  if (style === "dots") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  ctx.lineWidth = 1;
  ctx.beginPath();
  if (style === "ruled") {
    ctx.strokeStyle = "rgba(90, 120, 190, 0.45)";
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
  } else {
    ctx.strokeStyle = "rgba(70, 90, 140, 0.22)";
    for (let x = 0; x <= width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
  }
  ctx.stroke();
}

function compositeThumbnailCanvas(
  drawing: HTMLCanvasElement,
  appState: Record<string, unknown> | null | undefined,
): HTMLCanvasElement {
  const paper = resolveBoardBgColor(appState);
  const style = normalizeGridStyle(appState?.[GRID_STYLE_KEY], appState?.gridModeEnabled);
  const canvas = document.createElement("canvas");
  canvas.width = drawing.width;
  canvas.height = drawing.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return drawing;
  paintThumbnailPaper(ctx, canvas.width, canvas.height, style, paper);
  ctx.drawImage(drawing, 0, 0);
  return canvas;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

/** Компактное JPEG-превью для списка досок. Пустая строка — очистить thumbnail. */
export async function captureBoardThumbnail(
  source: ThumbnailApi | ThumbnailScene | null | undefined,
): Promise<string | null> {
  const scene = resolveThumbnailSource(source);
  if (!scene) return null;
  try {
    const elements = (scene.elements || []).filter((el) => !el?.isDeleted);
    if (!elements.length) return "";

    const { exportToBlob, exportToCanvas } = await import("@excalidraw/excalidraw");
    const sizes = [420, 280];
    const qualities = [0.55, 0.4];
    const exportAppState = buildThumbnailExportAppState(scene.appState);
    const files = scene.files || {};

    for (const maxWidthOrHeight of sizes) {
      for (const quality of qualities) {
        let blob: Blob | null = null;
        try {
          if (typeof exportToCanvas === "function") {
            const drawing = await exportToCanvas({
              elements,
              appState: {
                ...exportAppState,
                exportBackground: false,
                viewBackgroundColor: "transparent",
              },
              files,
              exportPadding: 20,
              maxWidthOrHeight,
            });
            blob = await canvasToJpegBlob(
              compositeThumbnailCanvas(drawing, scene.appState),
              quality,
            );
          }
        } catch {
          blob = null;
        }
        if (!blob) {
          blob = await exportToBlob({
            elements,
            appState: exportAppState,
            files,
            mimeType: "image/jpeg",
            quality,
            exportPadding: 20,
            maxWidthOrHeight,
          });
        }
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl && dataUrl.length <= MAX_THUMBNAIL_DATA_URL_CHARS) {
          return dataUrl;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
