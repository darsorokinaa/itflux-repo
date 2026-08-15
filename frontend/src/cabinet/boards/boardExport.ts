/** Хелперы экспорта доски (без зависимости от React). */

import { resolveBoardBgColor } from "./boardGrid";

/** Чуть ниже лимита API (200_000), чтобы JSON PATCH не раздувался. */
export const MAX_THUMBNAIL_DATA_URL_CHARS = 180_000;

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

/** Компактное JPEG-превью для списка досок. Пустая строка — очистить thumbnail. */
export async function captureBoardThumbnail(
  source: ThumbnailApi | ThumbnailScene | null | undefined,
): Promise<string | null> {
  const scene = resolveThumbnailSource(source);
  if (!scene) return null;
  try {
    const elements = (scene.elements || []).filter((el) => !el?.isDeleted);
    if (!elements.length) return "";

    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements,
      appState: buildThumbnailExportAppState(scene.appState),
      files: scene.files || {},
      mimeType: "image/jpeg",
      quality: 0.4,
      exportPadding: 16,
      maxWidthOrHeight: 280,
    });
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl && dataUrl.length <= MAX_THUMBNAIL_DATA_URL_CHARS) return dataUrl;
    return null;
  } catch {
    return null;
  }
}
